/**
 * 发信模块（ADR 0048）：连本机的假 SMTP 服务器，从不连真实的邮件服务。
 * 加密方式、证书校验、错误归类、重试、时限、地址固定、防 SSRF、结果里没有密码和服务器原文。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { type SmtpSettings, smtpSettingsIssues } from "@nozomi/config";
import { isSingleMailAddress, renderMailHtml } from "@nozomi/domain";
import { type FakeSmtp, type FakeTlsCert, decodedMailHtml, decodedMailText, generateFakeTlsCert, startFakeSmtp } from "../testing/fake-integrations.ts";
import { type MailSendResult, SMTP_FAILURE_MESSAGES, SMTP_SEND_DEADLINE_MS, type SmtpFailureCode, type SmtpMailerOptions, SmtpMailer, classifySmtpError } from "./smtp.ts";

const PASSWORD = "unit-smtp-Pass-0001";
const MESSAGE = { to: "someone@example.com", subject: "主题 subject", text: "正文 text", html: "<p>正文 html</p>" };

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

const settingsOf = (fake: FakeSmtp, encryption: SmtpSettings["encryption"], extra: Partial<SmtpSettings> = {}): SmtpSettings => ({
  host: fake.host,
  port: fake.port,
  encryption,
  username: "user@example.com",
  password: PASSWORD,
  fromName: "NOZOMI 用车",
  fromAddress: "noreply@example.com",
  ...extra,
});
const mailer = (options: SmtpMailerOptions = {}): SmtpMailer => new SmtpMailer({ allowLoopback: true, tlsCa: cert.cert, deadlineMs: 1_500, ...options });

function assertFailed(result: MailSendResult, code: SmtpFailureCode): void {
  assert.equal(result.ok, false, JSON.stringify(result));
  if (result.ok) return;
  assert.equal(result.code, code, result.message);
  assert.equal(result.message, SMTP_FAILURE_MESSAGES[code]);
  assert.ok(!JSON.stringify(result).includes(PASSWORD));
}

test("总时限不超过 15 秒", () => {
  assert.equal(SMTP_SEND_DEADLINE_MS, 15_000);
});

test("明文（none）：认证、发件人、收件人、内容都到了服务器；认证只发给配置的账号", async () => {
  const result = await mailer().send(settingsOf(plain, "none"), MESSAGE);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(plain.auths.map((a) => [a.user, a.pass]), [["user@example.com", PASSWORD]]);
  const [message] = plain.messages;
  assert.equal(plain.messages.length, 1);
  assert.deepEqual([message?.from, message?.to, message?.secure], ["noreply@example.com", ["someone@example.com"], false]);
  assert.match(message?.data ?? "", /^From: .*<noreply@example\.com>/m);
  assert.match(message?.data ?? "", /^To: someone@example\.com/m);
  assert.ok(!(message?.data ?? "").includes(PASSWORD), "邮件内容里没有密码");
});

test("HTML 版（ADR 0067）：只给纯文字时按 renderMailHtml 排一份一起发；调用方给了 HTML 就用调用方的", async () => {
  const text = "王先生，您好：\n\n查看订单：\nhttps://nozomi.example/o?t=1\n\nNOZOMI 用车";
  assert.equal((await mailer().send(settingsOf(plain, "none"), { to: MESSAGE.to, subject: MESSAGE.subject, text })).ok, true);
  const data = plain.messages[0]?.data ?? "";
  assert.match(data, /^Content-Type: multipart\/alternative;/m);
  const lf = (value: string | null | undefined): string | undefined => value?.replace(/\r\n/g, "\n").trim();
  assert.equal(lf(decodedMailText(data)), text, "纯文字版原样（SMTP 传输时换行是 CRLF）");
  assert.equal(lf(decodedMailHtml(data)), renderMailHtml({ subject: MESSAGE.subject, text }).trim());

  plain.reset();
  assert.equal((await mailer().send(settingsOf(plain, "none"), MESSAGE)).ok, true);
  assert.equal(lf(decodedMailHtml(plain.messages[0]?.data ?? "")), MESSAGE.html);
});

test("STARTTLS：升级之后才认证、才发信；服务器不支持升级就失败，不退回明文，密码没有发出去", async () => {
  const ok = await mailer().send(settingsOf(starttls, "starttls"), MESSAGE);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(starttls.messages[0]?.secure, true);
  assert.equal(starttls.auths.length, 1);

  starttls.reset();
  starttls.behave({ refuseStartTls: true });
  assertFailed(await mailer().send(settingsOf(starttls, "starttls"), MESSAGE), "TLS_FAILED");
  assert.equal(starttls.auths.length, 0, "没升级成功不能发密码");

  plain.reset();
  assertFailed(await mailer().send(settingsOf(plain, "starttls"), MESSAGE), "TLS_FAILED");
  assert.equal(plain.auths.length, 0);
  assert.equal(plain.messages.length, 0);
});

test("TLS：一连上就是加密；对着明文服务器是 TLS 失败", async () => {
  const ok = await mailer().send(settingsOf(implicit, "tls"), MESSAGE);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(implicit.messages[0]?.secure, true);
  assertFailed(await mailer().send(settingsOf(plain, "tls"), MESSAGE), "TLS_FAILED");
  assert.equal(plain.auths.length, 0);
});

test("证书校验没有开关：不信任的证书（自签）、证书上的主机名对不上都失败，密码没有发出去", async () => {
  const untrusted = new SmtpMailer({ allowLoopback: true, deadlineMs: 1_500 });
  assertFailed(await untrusted.send(settingsOf(implicit, "tls"), MESSAGE), "TLS_FAILED");
  assertFailed(await untrusted.send(settingsOf(starttls, "starttls"), MESSAGE), "TLS_FAILED");
  assert.equal(implicit.auths.length + starttls.auths.length, 0);

  const otherName = generateFakeTlsCert("DNS:someone-else.test");
  const wrong = await startFakeSmtp({ tls: { mode: "implicit", cert: otherName } });
  try {
    assertFailed(await mailer({ tlsCa: otherName.cert }).send(settingsOf(wrong, "tls"), MESSAGE), "TLS_FAILED");
    assert.equal(wrong.auths.length, 0);
  } finally {
    await wrong.close();
  }
});

test("错误归类：认证失败、发件人被拒、收件人被拒、内容被拒、连接断开、看不懂的应答；结果里没有服务器返回的原文", async () => {
  const detail = "server-said-something-private";
  const cases: [Parameters<FakeSmtp["behave"]>[0], SmtpFailureCode][] = [
    [{ rejectAuth: true, errorDetail: detail }, "AUTH_FAILED"],
    [{ rejectSender: true, errorDetail: detail }, "SENDER_REJECTED"],
    [{ rejectRecipient: true, errorDetail: detail }, "RECIPIENT_REJECTED"],
    [{ rejectData: true, errorDetail: detail }, "MESSAGE_REJECTED"],
    [{ dropOnConnect: true }, "UNREACHABLE"],
    [{ garbageGreeting: true }, "UNEXPECTED"],
  ];
  for (const [behavior, code] of cases) {
    plain.reset();
    plain.behave(behavior);
    const result = await mailer().send(settingsOf(plain, "none"), MESSAGE);
    assertFailed(result, code);
    assert.ok(!JSON.stringify(result).includes(detail), `${code}：结果里有服务器的原文`);
    assert.equal(plain.messages.length, 0, code);
  }
});

test("超时：连上后不说话、中途不回话都在时限内返回 TIMEOUT；连上之后不重试（可能已经发出去了）", async () => {
  for (const behavior of [{ silent: true }, { stallOn: "EHLO" }, { stallOn: "AUTH" }, { stallOn: "MAIL" }, { stallOn: "DATA" }] as const) {
    plain.reset();
    plain.behave(behavior);
    const started = Date.now();
    assertFailed(await mailer({ deadlineMs: 300 }).send(settingsOf(plain, "none"), MESSAGE), "TIMEOUT");
    assert.ok(Date.now() - started < 1_500, `${JSON.stringify(behavior)} 没有按时返回`);
    assert.equal(plain.connections(), 1, "连上之后不重试");
  }
});

test("连不上：再试 1 次；域名解析不了是连接失败；优先 IPv4，第一个地址连不上换下一个", async () => {
  const closed = createServer();
  await new Promise<void>((resolve) => closed.listen(0, "127.0.0.1", () => resolve()));
  const address = closed.address();
  const closedPort = typeof address === "object" && address !== null ? address.port : 0;
  await new Promise<void>((resolve) => closed.close(() => resolve()));
  assertFailed(await mailer().send(settingsOf(plain, "none", { port: closedPort }), MESSAGE), "UNREACHABLE");

  const failing = mailer({
    resolve: async () => {
      throw new Error("ENOTFOUND");
    },
  });
  assertFailed(await failing.send(settingsOf(plain, "none", { host: "smtp.example.com" }), MESSAGE), "UNREACHABLE");
  assertFailed(await mailer({ resolve: async () => [] }).send(settingsOf(plain, "none", { host: "smtp.example.com" }), MESSAGE), "UNREACHABLE");

  const fallsBack = await mailer({ resolve: async () => ["::1", "127.0.0.1"] }).send(settingsOf(plain, "none", { host: "smtp.example.com" }), MESSAGE);
  assert.equal(fallsBack.ok, true, "IPv4 排在前面");

  plain.reset();
  const nextAddress = await mailer({ resolve: async () => ["127.0.0.2", "127.0.0.1"] }).send(settingsOf(plain, "none", { host: "smtp.example.com" }), MESSAGE);
  assert.equal(nextAddress.ok, true, "第一个地址连不上换下一个");
  assert.equal(plain.messages.length, 1);
});

test("防 SSRF：主机是内网直接拒绝，不解析、不连接；解析到的地址有一个不是公网就整体拒绝", async () => {
  let resolved = 0;
  const strict = new SmtpMailer({
    deadlineMs: 1_500,
    resolve: async () => {
      resolved += 1;
      return ["8.8.8.8"];
    },
  });
  for (const host of ["127.0.0.1", "localhost", "10.0.0.8", "192.168.1.1", "169.254.169.254", "::1", "fe80::1", "mail", "smtp.internal", "2130706433"]) {
    assertFailed(await strict.send(settingsOf(plain, "none", { host }), MESSAGE), "TARGET_FORBIDDEN");
  }
  assert.equal(resolved, 0, "不用解析就能拒绝");
  assert.equal(plain.connections(), 0);

  for (const addresses of [["127.0.0.1"], ["10.0.0.8"], ["169.254.169.254"], ["8.8.8.8", "10.0.0.8"], ["fe80::1"], ["::ffff:10.0.0.8"]]) {
    const rebound = new SmtpMailer({ deadlineMs: 1_500, resolve: async () => addresses });
    assertFailed(await rebound.send(settingsOf(plain, "none", { host: "smtp.example.com" }), MESSAGE), "TARGET_FORBIDDEN");
  }
  assert.equal(plain.connections(), 0);
});

test("local / ci 的例外只放开回环：解析到内网地址、元数据地址照样拒绝", async () => {
  for (const addresses of [["10.0.0.8"], ["169.254.169.254"], ["127.0.0.1", "10.0.0.8"]]) {
    assertFailed(await mailer({ resolve: async () => addresses }).send(settingsOf(plain, "none", { host: "smtp.example.com" }), MESSAGE), "TARGET_FORBIDDEN");
  }
  assertFailed(await mailer().send(settingsOf(plain, "none", { host: "10.0.0.8" }), MESSAGE), "TARGET_FORBIDDEN");
});

test("防 DNS 重绑定：只连解析时检查过的地址，只解析一次；TLS 证书仍按原来的域名校验", async () => {
  let resolved = 0;
  const pinned = mailer({
    resolve: async (name) => {
      resolved += 1;
      assert.equal(name, "smtp.pinned.test");
      return ["127.0.0.1"];
    },
  });
  const ok = await pinned.send(settingsOf(implicit, "tls", { host: "smtp.pinned.test" }), MESSAGE);
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(resolved, 1);
  assert.equal(implicit.messages.length, 1);

  const mismatch = mailer({ resolve: async () => ["127.0.0.1"] });
  assertFailed(await mismatch.send(settingsOf(implicit, "tls", { host: "not-on-the-cert.test" }), MESSAGE), "TLS_FAILED");
});

test("打招呼报配置的名字，不报这台机器的主机名", async () => {
  const lines: string[] = [];
  const server = createServer((socket) => {
    socket.write("220 x ESMTP\r\n");
    socket.on("data", (chunk) => {
      lines.push(chunk.toString());
      socket.write("502 no\r\n");
    });
    socket.on("error", () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  await mailer({ ehloName: "app.nozomi.test", deadlineMs: 500 }).send(settingsOf(plain, "none", { port }), MESSAGE);
  server.close();
  assert.match(lines[0] ?? "", /^EHLO app\.nozomi\.test/);
});

test("错误归类的函数：只看代码；奇怪的错误不抛异常", () => {
  assert.equal(classifySmtpError(Object.assign(new Error("x"), { code: "ESOCKET", originalCode: "ECONNRESET" })), "UNREACHABLE");
  assert.equal(classifySmtpError(Object.assign(new Error("x"), { code: "ESOCKET", originalCode: "DEPTH_ZERO_SELF_SIGNED_CERT" })), "TLS_FAILED");
  assert.equal(classifySmtpError(Object.assign(new Error("x"), { code: "ESOCKET", originalCode: "ERR_SSL_WRONG_VERSION_NUMBER" })), "TLS_FAILED");
  assert.equal(classifySmtpError(Object.assign(new Error("x"), { code: "EDNS" })), "UNREACHABLE");
  assert.equal(classifySmtpError(Object.assign(new Error("x"), { code: "EENVELOPE", command: "MAIL FROM" })), "SENDER_REJECTED");
  assert.equal(classifySmtpError(Object.assign(new Error("x"), { code: "EENVELOPE", command: "RCPT TO", responseCode: 550 })), "RECIPIENT_REJECTED");
  assert.equal(classifySmtpError(Object.assign(new Error("x"), { code: "EENVELOPE", command: "RCPT TO" })), "MESSAGE_REJECTED", "没有服务器应答码：说不清，不算收件人");
  for (const odd of [null, undefined, "x", 1, {}, new Error("x")]) assert.equal(classifySmtpError(odd), "UNEXPECTED");
});

test("发件人地址的写法：config 和 domain 两边规则一致（config 不依赖 domain）", () => {
  const base = { host: "smtp.example.com", port: 587, encryption: "starttls", username: "u", password: "12345678", fromName: "n" };
  for (const address of ["a@example.com", "a.b+tag@mail.example.co.jp", "a@example", "a@b.co, c@d.co", "A <a@b.co>", "a@-x.com", "a@x-.com", "用户@example.com", "a b@c.co", "a@b.co\r\nBcc: x@y.z", `${"a".repeat(250)}@b.co`]) {
    assert.equal(smtpSettingsIssues("ci", { ...base, fromAddress: address }).length === 0, isSingleMailAddress(address), address);
  }
});

test("服务器在各阶段拒收（真实 nodemailer + 假服务器）：能分清的分清，分不清的不算到收件人头上；原文不进结果", async () => {
  const detail = "b-private@guest.example said no";
  const cases: [NonNullable<Parameters<FakeSmtp["behave"]>[0]["rejectAt"]>, SmtpFailureCode][] = [
    // MAIL FROM
    [{ stage: "MAIL", reply: "550 5.7.1 refused" }, "SENDER_REJECTED"],
    [{ stage: "MAIL", reply: "553 refused" }, "SENDER_REJECTED"],
    [{ stage: "MAIL", reply: "451 4.3.2 later" }, "TEMPORARILY_REJECTED"],
    // RCPT TO：增强状态码说得清
    [{ stage: "RCPT", reply: "550 5.1.1 no such user" }, "RECIPIENT_REJECTED"],
    [{ stage: "RCPT", reply: "550 5.1.10 null mx" }, "RECIPIENT_REJECTED"],
    [{ stage: "RCPT", reply: "552 5.2.2 mailbox full" }, "RECIPIENT_REJECTED"],
    [{ stage: "RCPT", reply: "553 5.1.8 bad sender domain" }, "SENDER_REJECTED"],
    // RCPT TO：没有增强状态码，按应答码
    [{ stage: "RCPT", reply: "550 no such user" }, "RECIPIENT_REJECTED"],
    [{ stage: "RCPT", reply: "550 5.0.0 no such user" }, "RECIPIENT_REJECTED"],
    [{ stage: "RCPT", reply: "554 refused" }, "MESSAGE_REJECTED"],
    // RCPT TO：5.7.1 可能是发件人（Postfix 默认等到这一步才拒发件人）
    [{ stage: "RCPT", reply: "553 5.7.1 not owned by user" }, "MESSAGE_REJECTED"],
    [{ stage: "RCPT", reply: "554 5.7.1 relay access denied" }, "MESSAGE_REJECTED"],
    // RCPT TO：暂时的（灰名单、限流）
    [{ stage: "RCPT", reply: "450 4.2.1 greylisted" }, "TEMPORARILY_REJECTED"],
    [{ stage: "RCPT", reply: "421 4.7.0 closing" }, "TEMPORARILY_REJECTED"],
    [{ stage: "RCPT", reply: "451 4.1.1 try later" }, "TEMPORARILY_REJECTED"],
    // DATA 命令、正文发完
    [{ stage: "DATA", reply: "554 5.5.1 no valid recipients" }, "MESSAGE_REJECTED"],
    [{ stage: "DATA", reply: "451 later" }, "TEMPORARILY_REJECTED"],
    [{ stage: "DOT", reply: "554 5.7.1 domain blocked" }, "MESSAGE_REJECTED"],
    [{ stage: "DOT", reply: "550 refused" }, "MESSAGE_REJECTED"],
    [{ stage: "DOT", reply: "451 4.7.1 later" }, "TEMPORARILY_REJECTED"],
    [{ stage: "DOT", reply: "550 5.1.1 no such user" }, "RECIPIENT_REJECTED"],
    [{ stage: "DOT", reply: "550 5.1.7 bad sender" }, "SENDER_REJECTED"],
  ];
  for (const [rejectAt, code] of cases) {
    plain.reset();
    plain.behave({ rejectAt, errorDetail: detail });
    const result = await mailer().send(settingsOf(plain, "none"), MESSAGE);
    assertFailed(result, code);
    assert.ok(!JSON.stringify(result).includes(detail), `${rejectAt.reply}：结果里有服务器的原文`);
    assert.equal(plain.messages.length, 0, rejectAt.reply);
  }
});

test("归类不被说明文字带偏，本地校验不过（没有应答码）不算收件人", () => {
  const rejected = (fields: Record<string, unknown>): SmtpFailureCode => classifySmtpError(Object.assign(new Error("x"), fields));
  assert.equal(rejected({ code: "EENVELOPE", command: "RCPT TO", responseCode: 550, response: "550 5.7.1 recipient 5.1.1 unknown" }), "MESSAGE_REJECTED", "只看开头的增强状态码");
  assert.equal(rejected({ code: "EENVELOPE", command: "RCPT TO", responseCode: 554, response: "554 sender address rejected" }), "MESSAGE_REJECTED");
  assert.equal(rejected({ code: "EENVELOPE", command: "API" }), "MESSAGE_REJECTED");
  assert.equal(rejected({ code: "EMESSAGE", command: "MAIL FROM" }), "MESSAGE_REJECTED", "本地发现邮件超过大小限制");
  assert.equal(rejected({ code: "EMESSAGE", command: "API" }), "MESSAGE_REJECTED");
  assert.equal(rejected({ code: "EENVELOPE", command: "RCPT TO", responseCode: 450, response: "450 5.1.1 odd" }), "TEMPORARILY_REJECTED", "应答码是 4xx 就是暂时的");
});

test("多行应答：只有后面的行带状态码也认；各行说得不一样的当说不清，不算收件人", () => {
  const rcpt = (response: string, responseCode = 550): SmtpFailureCode => classifySmtpError(Object.assign(new Error("x"), { code: "EENVELOPE", command: "RCPT TO", responseCode, response }));
  assert.equal(rcpt("550-Mailbox gone\n550 5.1.1 see help"), "RECIPIENT_REJECTED");
  assert.equal(rcpt("550-Policy rejection\n550 5.7.1 see help"), "MESSAGE_REJECTED", "第一行没有状态码、后面是 5.7.1：不能按没有增强码算成收件人");
  assert.equal(rcpt("550-Policy rejection\r\n550-more\r\n550 5.1.8 see help"), "SENDER_REJECTED");
  assert.equal(rcpt("550-5.1.1 one\n550 5.7.1 other"), "MESSAGE_REJECTED", "各行不一样");
  assert.equal(rcpt("550-5.1.1 one\n550 5.0.0 other"), "MESSAGE_REJECTED", "有一行没说清");
  assert.equal(rcpt("550-5.1.1 one\n550 see help"), "RECIPIENT_REJECTED", "只有一行带");
  assert.equal(rcpt("550-no status\n550 see 5.1.1 help"), "RECIPIENT_REJECTED", "说明文字里的数字不算，这条按没有增强码");
  assert.equal(rcpt("554-no status\n554 see 5.1.1 help", 554), "MESSAGE_REJECTED");
  assert.equal(classifySmtpError(Object.assign(new Error("x"), { code: "EMESSAGE", command: "DATA", responseCode: 554, response: "554-no\n554 5.2.2 full" })), "RECIPIENT_REJECTED", "正文之后同样");
});

test("握手阶段：4xx 是暂时拒绝；5xx 和连接层错误还是配置或连接问题，不算成暂时", () => {
  const classify = (fields: Record<string, unknown>): SmtpFailureCode => classifySmtpError(Object.assign(new Error("x"), fields));
  assert.equal(classify({ code: "EPROTOCOL", command: "CONN", responseCode: 421, response: "421 busy" }), "TEMPORARILY_REJECTED");
  assert.equal(classify({ code: "ECONNECTION", command: "EHLO", responseCode: 421, response: "421 busy" }), "TEMPORARILY_REJECTED");
  assert.equal(classify({ code: "EAUTH", command: "AUTH PLAIN", responseCode: 454 }), "TEMPORARILY_REJECTED");
  assert.equal(classify({ code: "ETLS", command: "STARTTLS", responseCode: 454 }), "TEMPORARILY_REJECTED");
  assert.equal(classify({ code: "EAUTH", command: "AUTH PLAIN", responseCode: 535 }), "AUTH_FAILED");
  assert.equal(classify({ code: "EAUTH", command: "AUTH PLAIN", responseCode: 534 }), "AUTH_FAILED");
  assert.equal(classify({ code: "ETLS", command: "STARTTLS", responseCode: 502 }), "TLS_FAILED");
  assert.equal(classify({ code: "ETLS", message: "certificate has expired" }), "TLS_FAILED");
  assert.equal(classify({ code: "ECONNECTION", message: "Connection closed" }), "UNREACHABLE");
  assert.equal(classify({ code: "ESOCKET", originalCode: "ECONNRESET" }), "UNREACHABLE");
  assert.equal(classify({ code: "ETIMEDOUT" }), "TIMEOUT");
  assert.equal(classify({ code: "EPROTOCOL", command: "CONN", responseCode: 554 }), "UNEXPECTED");
});
