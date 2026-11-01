/**
 * QA（M4-14，ADR 0048）：发信模块的异常路径，开发的 smtp.test.ts 没有覆盖的部分。
 * 只连本机的假服务器和测试里现写的小服务器，从不连真实的邮件服务。账号密码都是虚构的。
 */
import { after, before, beforeEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import net, { type Server, type Socket, createServer } from "node:net";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer as createTlsServer } from "node:tls";
import type { SmtpSettings } from "@nozomi/config";
import { type FakeSmtp, type FakeTlsCert, generateFakeTlsCert, startFakeSmtp } from "../testing/fake-integrations.ts";
import { type MailSendResult, SMTP_FAILURE_MESSAGES, SmtpMailer, type SmtpMailerOptions } from "./smtp.ts";

const PASSWORD = "qa-fake-smtp-Pass-0001";
const USERNAME = "qa-mailer@example.test";
const MESSAGE = { to: "guest@example.test", subject: "预订确认", text: "正文" };

let cert: FakeTlsCert;
let plain: FakeSmtp;
let starttls: FakeSmtp;
let implicit: FakeSmtp;

before(async () => {
  cert = generateFakeTlsCert();
  plain = await startFakeSmtp();
  starttls = await startFakeSmtp({ tls: { mode: "starttls", cert } });
  implicit = await startFakeSmtp({ tls: { mode: "implicit", cert } });
});
after(async () => {
  await Promise.all([plain.close(), starttls.close(), implicit.close()]);
});
beforeEach(() => {
  for (const fake of [plain, starttls, implicit]) fake.reset();
});

const settings = (port: number, encryption: SmtpSettings["encryption"], extra: Partial<SmtpSettings> = {}): SmtpSettings => ({ host: "127.0.0.1", port, encryption, username: USERNAME, password: PASSWORD, fromName: "NOZOMI 用车", fromAddress: "noreply@example.test", ...extra });
const mailer = (options: SmtpMailerOptions = {}): SmtpMailer => new SmtpMailer({ allowLoopback: true, tlsCa: cert.cert, deadlineMs: 1_000, ...options });

function failedWith(result: MailSendResult, code: string): void {
  assert.equal(result.ok, false, JSON.stringify(result));
  if (result.ok) return;
  assert.equal(result.code, code, result.message);
  assert.equal(result.message, SMTP_FAILURE_MESSAGES[result.code], "说明只能是我们自己写的那一句");
}

/** 取一封信里某个邮件头（展开折行）。 */
function header(data: string, name: string): string[] {
  const head = data.slice(0, data.indexOf("\r\n\r\n")).replace(/\r\n[ \t]+/g, " ");
  return head.split("\r\n").filter((line) => line.toLowerCase().startsWith(`${name.toLowerCase()}:`)).map((line) => line.slice(name.length + 1).trim());
}

/** 解开 RFC 2047 的编码词（B 和 Q）。 */
function decodeWords(value: string): string {
  return value.replace(/\?=\s+=\?/g, "?==?").replace(/=\?utf-8\?([bq])\?([^?]*)\?=/gi, (_, kind: string, text: string) =>
    kind.toLowerCase() === "b" ? Buffer.from(text, "base64").toString("utf8") : Buffer.from(text.replace(/_/g, " ").replace(/=([0-9a-f]{2})/gi, "%$1").replace(/%([0-9a-f]{2})/gi, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16))), "latin1").toString("utf8"),
  );
}

/** 现写的小服务器：按脚本应答，记下收到的所有行。 */
async function scripted(handler: (socket: Socket, line: string, lines: string[]) => void, onConnect: (socket: Socket) => void = (socket) => void socket.write("220 fake ESMTP\r\n")): Promise<{ port: number; lines: string[]; connections: () => number; closed: () => number; close(): Promise<void> }> {
  const lines: string[] = [];
  const open = new Set<Socket>();
  let connections = 0;
  let closed = 0;
  const server: Server = createServer((socket) => {
    connections += 1;
    open.add(socket);
    socket.on("error", () => undefined);
    socket.on("close", () => {
      closed += 1;
      open.delete(socket);
    });
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString("latin1");
      let at = buffer.indexOf("\r\n");
      while (at !== -1) {
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        lines.push(line);
        handler(socket, line, lines);
        at = buffer.indexOf("\r\n");
      }
    });
    onConnect(socket);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as { port: number };
  return {
    port: address.port,
    lines,
    connections: () => connections,
    closed: () => closed,
    close: async () => {
      for (const socket of open) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

const elapsed = async <T>(work: () => Promise<T>): Promise<{ value: T; ms: number }> => {
  const started = performance.now();
  const value = await work();
  return { value, ms: performance.now() - started };
};

// ---- 邮件头 ----

test("非 ASCII 的发件人名称按 RFC 2047 编码，邮件头里没有 8 位字节；解开后和填的一样；地址不变", async () => {
  const name = "NOZOMI 用车・日本語サポート";
  const sent = await mailer().send(settings(plain.port, "none", { fromName: name }), MESSAGE);
  assert.equal(sent.ok, true, JSON.stringify(sent));
  const message = plain.messages[0]!;
  const [from] = header(message.data, "From");
  assert.ok(from !== undefined);
  assert.match(from, /^[\x20-\x7e]+$/, "邮件头只有 ASCII");
  assert.match(from, /<noreply@example\.test>$/);
  assert.equal(decodeWords(from.replace(/\s*<[^>]*>$/, "")).replace(/^"|"$/g, ""), name);
  assert.equal(message.from, "noreply@example.test", "信封的发件人只看地址");
});

test("发件人名称里的引号、逗号、尖括号、分号：From 仍然只有一个地址，不能伪造另一个发件人", async () => {
  for (const fromName of ['客服" <attacker@example.test>, "x', "a@attacker.example, b", "客服 <attacker@example.test>", "x; attacker@example.test", 'back\\slash"', "=?UTF-8?B?eA==?= <attacker@example.test>"]) {
    plain.reset();
    const sent = await mailer().send(settings(plain.port, "none", { fromName }), MESSAGE);
    assert.equal(sent.ok, true, JSON.stringify(sent));
    const message = plain.messages[0]!;
    const from = header(message.data, "From");
    assert.equal(from.length, 1, fromName);
    assert.match(from[0]!, /<noreply@example\.test>$/, fromName);
    assert.ok(!/<attacker@example\.test>\s*$/.test(from[0]!), fromName);
    // 去掉引号里的和编码过的内容之后，只剩一个尖括号地址
    const outside = from[0]!.replace(/"(?:[^"\\]|\\.)*"/g, "").replace(/=\?[^?]*\?[bq]\?[^?]*\?=/gi, "");
    assert.deepEqual(outside.match(/[^\s<>,;]+@[^\s<>,;]+/g), ["noreply@example.test"], `${fromName} → ${from[0]}`);
    assert.deepEqual(message.to, ["guest@example.test"], "收件人没有多");
    assert.equal(header(message.data, "Bcc").length, 0);
  }
});

test("很长的中文主题（200 个字）：折行后每行不超过 998 字节，解开后和原文一样，没有多出邮件头", async () => {
  const subject = "预".repeat(200);
  const sent = await mailer().send(settings(plain.port, "none"), { ...MESSAGE, subject });
  assert.equal(sent.ok, true, JSON.stringify(sent));
  const data = plain.messages[0]!.data;
  const head = data.slice(0, data.indexOf("\r\n\r\n"));
  for (const line of head.split("\r\n")) assert.ok(line.length <= 998, "单行不超过 RFC 5322 的上限");
  assert.equal(decodeWords(header(data, "Subject")[0]!), subject);
});

test("防 SMTP 走私：正文里的「\\r\\n.\\r\\n」和裸换行不能提前结束 DATA，也不能多出一封信", async () => {
  const smuggle = "MAIL FROM:<attacker@example.test>\r\nRCPT TO:<victim@example.test>\r\nDATA\r\nFrom: attacker@example.test\r\n\r\nfake\r\n.\r\n";
  for (const text of [`开头\r\n.\r\n${smuggle}结尾`, `开头\n.\n${smuggle}结尾`, `开头\r.\r${smuggle}结尾`, `开头\n.\r\n${smuggle}结尾`, `.\r\n${smuggle}`]) {
    plain.reset();
    const sent = await mailer().send(settings(plain.port, "none"), { ...MESSAGE, text });
    assert.equal(sent.ok, true, JSON.stringify(sent));
    assert.equal(plain.messages.length, 1, JSON.stringify(text.slice(0, 12)));
    assert.deepEqual(plain.messages[0]!.to, ["guest@example.test"]);
    assert.equal(plain.messages[0]!.from, "noreply@example.test");
  }
});

test("html 也不能走私，也不能借网址、路径让服务器去取内容", async () => {
  const sent = await mailer().send(settings(plain.port, "none"), { ...MESSAGE, html: `<p>a</p>\r\n.\r\nMAIL FROM:<attacker@example.test>\r\n<img src="http://169.254.169.254/latest/meta-data/"><a href="file:///etc/passwd">x</a>` });
  assert.equal(sent.ok, true, JSON.stringify(sent));
  assert.equal(plain.messages.length, 1);
  assert.deepEqual(plain.messages[0]!.to, ["guest@example.test"]);
  assert.ok(!plain.messages[0]!.data.includes("root:"), "没有把本地文件读进信里");
});

// ---- TLS ----

test("STARTTLS：服务器在能力里写了支持，但执行时回 454（暂时不可用，归类见 ADR 0049）：失败，不退回明文，密码和发件人都没有发出去", async () => {
  const server = await scripted((socket, line) => {
    const verb = line.split(" ")[0]?.toUpperCase();
    if (verb === "EHLO") socket.write("250-fake\r\n250-STARTTLS\r\n250 AUTH PLAIN LOGIN\r\n");
    else if (verb === "STARTTLS") socket.write("454 4.7.0 TLS not available now\r\n");
    else socket.write("250 ok\r\n");
  });
  try {
    failedWith(await mailer().send(settings(server.port, "starttls"), MESSAGE), "TEMPORARILY_REJECTED");
    assert.ok(!server.lines.some((line) => /^(AUTH|MAIL|RCPT|DATA)/i.test(line)), server.lines.join(" | "));
    assert.ok(!server.lines.join("\n").includes(Buffer.from(PASSWORD).toString("base64")));
  } finally {
    await server.close();
  }
});

test("STARTTLS：应答 220 之后对方不做 TLS（中间人剥离）：失败，明文线路上看不到认证", async () => {
  const server = await scripted((socket, line) => {
    const verb = line.split(" ")[0]?.toUpperCase();
    if (verb === "EHLO") socket.write("250-fake\r\n250-STARTTLS\r\n250 AUTH PLAIN LOGIN\r\n");
    else if (verb === "STARTTLS") socket.write("220 go ahead\r\n250 AUTH PLAIN\r\n235 ok\r\n");
    else socket.write("250 ok\r\n");
  });
  try {
    const result = await mailer().send(settings(server.port, "starttls"), MESSAGE);
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.ok(!server.lines.some((line) => /^(AUTH|MAIL|RCPT)/i.test(line)), server.lines.join(" | "));
  } finally {
    await server.close();
  }
});

/** 现场签一张已经过期的证书（两种写法：有的 openssl 不认负数天）。 */
function expiredCert(): FakeTlsCert {
  const dir = mkdtempSync(join(tmpdir(), "nozomi-qa-smtp-"));
  try {
    const keyPath = join(dir, "key.pem");
    const certPath = join(dir, "cert.pem");
    const common = ["req", "-x509", "-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes", "-keyout", keyPath, "-out", certPath, "-subj", "/CN=fake-smtp", "-addext", "subjectAltName=IP:127.0.0.1"];
    try {
      execFileSync("openssl", [...common, "-not_before", "20200101000000Z", "-not_after", "20200102000000Z"], { stdio: "ignore" });
    } catch {
      execFileSync("openssl", [...common, "-days", "-1"], { stdio: "ignore" });
    }
    return { key: readFileSync(keyPath, "utf8"), cert: readFileSync(certPath, "utf8") };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("证书过期：TLS 和 STARTTLS 都失败，密码没有发出去（即使这张证书在信任名单里）", async () => {
  const old = expiredCert();
  const tlsServer = await startFakeSmtp({ tls: { mode: "implicit", cert: old } });
  const upgrade = await startFakeSmtp({ tls: { mode: "starttls", cert: old } });
  try {
    const trusting = mailer({ tlsCa: old.cert });
    failedWith(await trusting.send(settings(tlsServer.port, "tls"), MESSAGE), "TLS_FAILED");
    failedWith(await trusting.send(settings(upgrade.port, "starttls"), MESSAGE), "TLS_FAILED");
    assert.equal(tlsServer.auths.length + upgrade.auths.length, 0);
  } finally {
    await Promise.all([tlsServer.close(), upgrade.close()]);
  }
});

test("服务器只支持 TLS 1.1：失败，不降级（我们要求至少 1.2）", async () => {
  let handshakes = 0;
  const server = createTlsServer({ key: cert.key, cert: cert.cert, minVersion: "TLSv1", maxVersion: "TLSv1.1", ciphers: "DEFAULT@SECLEVEL=0" }, (socket) => {
    handshakes += 1;
    socket.on("error", () => undefined);
    socket.write("220 fake ESMTP\r\n");
  });
  server.on("tlsClientError", () => undefined);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  try {
    failedWith(await mailer().send(settings((server.address() as { port: number }).port, "tls"), MESSAGE), "TLS_FAILED");
    assert.equal(handshakes, 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("加密方式和端口不配：STARTTLS 对着一连上就是 TLS 的服务器，在时限内失败，密码没有发出去", async () => {
  const { value, ms } = await elapsed(() => mailer({ deadlineMs: 500 }).send(settings(implicit.port, "starttls"), MESSAGE));
  assert.equal(value.ok, false);
  assert.ok(!value.ok && ["TLS_FAILED", "TIMEOUT"].includes(value.code), JSON.stringify(value));
  assert.ok(ms < 1_500, `用了 ${ms} 毫秒`);
  assert.equal(implicit.auths.length, 0);
});

test("明文（none）对着支持 STARTTLS 的服务器：local / ci 才有这个选项；认证照常", async () => {
  const sent = await mailer().send(settings(starttls.port, "none"), MESSAGE);
  assert.equal(sent.ok, true, JSON.stringify(sent));
  assert.equal(starttls.messages[0]?.secure, false);
});

// ---- 时限 ----

test("域名解析一直不回：到总时限返回 TIMEOUT；解析在时限之后才回来，也不再去连接", async () => {
  let release: (addresses: string[]) => void = () => undefined;
  const hung = new Promise<string[]>((resolve) => {
    release = resolve;
  });
  const { value, ms } = await elapsed(() => mailer({ deadlineMs: 200, resolve: () => hung }).send(settings(plain.port, "none", { host: "smtp.slow.test" }), MESSAGE));
  failedWith(value, "TIMEOUT");
  assert.ok(ms < 1_000, `用了 ${ms} 毫秒`);
  release(["127.0.0.1"]);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(plain.connections(), 0, "时限过后不能再连");
});

test("服务器一直在说话但永远说不完（每次重置空闲计时）：总时限照样把连接断开", async () => {
  let timer: NodeJS.Timeout | undefined;
  const server = await scripted((socket, line) => {
    if (line.split(" ")[0]?.toUpperCase() !== "EHLO") return;
    timer = setInterval(() => socket.write("250-still talking\r\n"), 50);
  });
  try {
    const { value, ms } = await elapsed(() => mailer({ deadlineMs: 400 }).send(settings(server.port, "none"), MESSAGE));
    failedWith(value, "TIMEOUT");
    assert.ok(ms < 1_200, `用了 ${ms} 毫秒`);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(server.closed(), server.connections(), "连接已断开");
  } finally {
    clearInterval(timer);
    await server.close();
  }
});

test("发送成功、认证失败、超时之后，连接都断开了，不留下打开的连接（配置换了不会沿用旧连接）", async () => {
  const track = await scripted((socket, line) => {
    const verb = line.split(" ")[0]?.toUpperCase();
    if (verb === "EHLO") socket.write("250-fake\r\n250 AUTH PLAIN LOGIN\r\n");
    else if (verb === "AUTH") socket.write("535 5.7.8 nope\r\n");
    else socket.write("250 ok\r\n");
  });
  try {
    failedWith(await mailer().send(settings(track.port, "none"), MESSAGE), "AUTH_FAILED");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual([track.connections(), track.closed()], [1, 1]);
  } finally {
    await track.close();
  }
  const before = plain.connections();
  for (let index = 0; index < 2; index += 1) assert.equal((await mailer().send(settings(plain.port, "none"), MESSAGE)).ok, true);
  assert.equal(plain.connections(), before + 2, "每封新建连接");
});

test("连接一直连不上（既不成功也不报错）：到总时限返回 TIMEOUT，插口被销毁，只试了解析到的地址", async () => {
  const sockets: Socket[] = [];
  const hosts: unknown[] = [];
  const stub = mock.method(net, "connect", (options: { host: string }) => {
    hosts.push(options.host);
    const socket = new net.Socket();
    sockets.push(socket);
    return socket;
  });
  syncBuiltinESMExports();
  try {
    const { value, ms } = await elapsed(() => mailer({ deadlineMs: 200, resolve: async () => ["8.8.8.8"] }).send(settings(587, "none", { host: "smtp.blackhole.test" }), MESSAGE));
    failedWith(value, "TIMEOUT");
    assert.ok(ms < 800, `用了 ${ms} 毫秒`);
    assert.deepEqual(hosts, ["8.8.8.8"], "连的是检查过的地址，不是域名");
    assert.ok(sockets.every((socket) => socket.destroyed));
  } finally {
    stub.mock.restore();
    syncBuiltinESMExports();
  }
});

test("连接一步最多 5 秒：第一个地址一直连不上时，5 秒后换下一个地址再试 1 次", { timeout: 10_000 }, async () => {
  const hosts: string[] = [];
  const stub = mock.method(net, "connect", (options: { host: string }) => {
    hosts.push(options.host);
    return new net.Socket();
  });
  syncBuiltinESMExports();
  try {
    const { value, ms } = await elapsed(() => mailer({ deadlineMs: 6_000, resolve: async () => ["8.8.8.8", "1.1.1.1"] }).send(settings(587, "none", { host: "smtp.blackhole.test" }), MESSAGE));
    failedWith(value, "TIMEOUT");
    assert.deepEqual(hosts, ["8.8.8.8", "1.1.1.1"]);
    assert.ok(ms >= 5_000 && ms < 6_500, `用了 ${ms} 毫秒`);
  } finally {
    stub.mock.restore();
    syncBuiltinESMExports();
  }
});

// ---- 错误不外泄、不抛异常 ----

test("服务器的错误应答回显账号密码：结果里只有我们自己的一句话", async () => {
  const echo = `${USERNAME}:${PASSWORD}`;
  const cases = [
    [{ rejectAuth: true, errorDetail: echo }, "AUTH_FAILED"],
    [{ rejectSender: true, errorDetail: echo }, "SENDER_REJECTED"],
    [{ rejectRecipient: true, errorDetail: echo }, "RECIPIENT_REJECTED"],
    [{ rejectData: true, errorDetail: echo }, "MESSAGE_REJECTED"],
  ] as const;
  for (const [behavior, code] of cases) {
    plain.reset();
    plain.behave(behavior);
    const result = await mailer().send(settings(plain.port, "none"), MESSAGE);
    failedWith(result, code);
    assert.ok(!JSON.stringify(result).includes(PASSWORD));
    assert.ok(!JSON.stringify(result).includes(USERNAME));
  }
});

test("服务器在错误里说到 TLS 不改变分类：认证失败仍是认证失败（归类不被对方文字带偏）", async () => {
  plain.behave({ rejectAuth: true, errorDetail: "tls certificate ssl" });
  failedWith(await mailer().send(settings(plain.port, "none"), MESSAGE), "AUTH_FAILED");
});

test("服务器发来一大段垃圾、乱码或非法的多行应答：返回失败，不抛异常", async () => {
  const replies = ["\x00\x01\x02\xff\xfe\r\n", `220-${"x".repeat(100_000)}\r\n`, "999 ?\r\n", "\r\n\r\n\r\n"];
  for (const reply of replies) {
    const server = await scripted(() => undefined, (socket) => void socket.write(reply, "latin1"));
    try {
      const result = await mailer({ deadlineMs: 300 }).send(settings(server.port, "none"), MESSAGE);
      assert.equal(result.ok, false, JSON.stringify(reply.slice(0, 8)));
    } finally {
      await server.close();
    }
  }
});

test("连接断在各个阶段：都是返回值，进程没有未处理的异常", async () => {
  const unhandled: unknown[] = [];
  const onUnhandled = (err: unknown): void => void unhandled.push(err);
  process.on("unhandledRejection", onUnhandled);
  process.on("uncaughtException", onUnhandled);
  try {
    for (const dropAt of ["EHLO", "AUTH", "MAIL", "RCPT", "DATA"]) {
      const server = await scripted((socket, line) => {
        const verb = line.split(" ")[0]?.toUpperCase();
        if (verb === dropAt) return void socket.destroy();
        if (verb === "EHLO") socket.write("250-fake\r\n250 AUTH PLAIN LOGIN\r\n");
        else if (verb === "AUTH") socket.write("235 ok\r\n");
        else if (verb === "DATA") socket.write("354 go\r\n");
        else socket.write("250 ok\r\n");
      });
      try {
        const result = await mailer().send(settings(server.port, "none"), MESSAGE);
        assert.equal(result.ok, false, dropAt);
        assert.equal(server.connections(), 1, `${dropAt}：连上之后不重试（可能已经发出去了）`);
      } finally {
        await server.close();
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", onUnhandled);
    process.off("uncaughtException", onUnhandled);
  }
});

// ---- 防 SSRF：真实的默认设置 ----

test("默认设置（测试环境、正式环境的样子）：回环和内网的写法都不连接，连 local 的例外也打不开", async () => {
  const strict = new SmtpMailer({ deadlineMs: 500, resolve: async () => ["127.0.0.1"] });
  for (const host of ["127.0.0.1", "localhost", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "2130706433", "0x7f.1", "169.254.169.254", "10.0.0.8"]) {
    failedWith(await strict.send(settings(plain.port, "none", { host }), MESSAGE), "TARGET_FORBIDDEN");
  }
  for (const addresses of [["127.0.0.1"], ["::1"], ["::ffff:127.0.0.1"], ["::ffff:7f00:1"], ["8.8.8.8", "127.0.0.1"], ["8.8.8.8", "::ffff:169.254.169.254"], ["64:ff9b::7f00:1"], ["2002:7f00:1::"], ["not-an-address"]]) {
    const mapped = new SmtpMailer({ deadlineMs: 500, resolve: async () => addresses });
    failedWith(await mapped.send(settings(plain.port, "none", { host: "smtp.rebind.test" }), MESSAGE), "TARGET_FORBIDDEN");
  }
  assert.equal(plain.connections(), 0);
});

test("默认的系统解析：解析不了的名字是连接失败（.invalid 按规定解析不出来），不抛异常", async () => {
  const result = await new SmtpMailer({ deadlineMs: 3_000 }).send(settings(587, "starttls", { host: "smtp.qa-nonexistent.invalid" }), MESSAGE);
  assert.equal(result.ok, false);
  assert.ok(!result.ok && ["UNREACHABLE", "TIMEOUT"].includes(result.code), JSON.stringify(result));
});
