/**
 * QA（M4-16，ADR 0049「邮件服务器拒收的归类」）：真实 nodemailer 对着本机按脚本应答的 SMTP 服务器，只构造通用的 RFC 写法。
 * 开发的 smtp.test.ts 用单行应答测了 MAIL、RCPT、DATA、正文之后；这里补多行应答、畸形状态码、4xx 的其他阶段（打招呼、EHLO、认证、STARTTLS）、应答后断开。
 * 从不连真实的邮件服务器，地址和账号都是虚构值。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { type Server, type Socket, createServer } from "node:net";
import type { SmtpSettings } from "@nozomi/config";
import { type MailSendResult, SMTP_FAILURE_MESSAGES, SmtpMailer, type SmtpFailureCode, classifySmtpError } from "./smtp.ts";

const RECIPIENT = "qa-private-recipient@example.com";
const USERNAME = "qa-private-account@example.com";
/** 服务器应答里带着收件人和账号：不能出现在结果里 */
const ECHO = `<${RECIPIENT}> account ${USERNAME} said no`;

type Stage = "greeting" | "ehlo" | "starttls" | "auth" | "mail" | "rcpt" | "data" | "dot";
interface Script {
  stage: Stage;
  reply: string;
  /** 回完这句就断开（421 的常见做法，RFC 5321 3.8） */
  close?: boolean;
  /** 打招呼之后在 EHLO 应答里声明 STARTTLS */
  advertiseStartTls?: boolean;
}

let script: Script = { stage: "mail", reply: "250 ok" };
const sockets = new Set<Socket>();
let server: Server;
let port = 0;

function handle(socket: Socket): void {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
  socket.on("error", () => undefined);
  const say = (line: string): void => void socket.write(`${line}\r\n`);
  const scripted = (stage: Stage): boolean => {
    if (script.stage !== stage) return false;
    say(script.reply);
    if (script.close === true) socket.end();
    return true;
  };
  if (scripted("greeting")) return;
  say("220 qa.test ESMTP");
  let inData = false;
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let index: number;
    while ((index = buffer.indexOf("\r\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      if (inData) {
        if (line === ".") {
          inData = false;
          if (!scripted("dot")) say("250 2.0.0 ok");
        }
        continue;
      }
      const verb = (line.split(" ")[0] ?? "").toUpperCase();
      if (verb === "EHLO" || verb === "HELO") {
        if (!scripted("ehlo")) {
          if (script.advertiseStartTls === true) say("250-qa.test");
          if (script.advertiseStartTls === true) say("250-STARTTLS");
          say(script.advertiseStartTls === true ? "250 AUTH PLAIN LOGIN" : "250-qa.test\r\n250 AUTH PLAIN LOGIN");
        }
      } else if (verb === "STARTTLS") {
        if (!scripted("starttls")) say("502 no");
      } else if (verb === "AUTH") {
        if (!scripted("auth")) say("235 2.7.0 ok");
      } else if (verb === "MAIL") {
        if (!scripted("mail")) say("250 2.1.0 ok");
      } else if (verb === "RCPT") {
        if (!scripted("rcpt")) say("250 2.1.5 ok");
      } else if (verb === "DATA") {
        if (!scripted("data")) {
          inData = true;
          say("354 go");
        }
      } else if (verb === "QUIT") {
        say("221 bye");
        socket.end();
      } else {
        say("250 ok");
      }
    }
  });
}

before(async () => {
  server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as { port: number }).port;
});
after(async () => {
  for (const socket of sockets) socket.destroy();
  await new Promise((resolve) => server.close(resolve));
});

const settings = (encryption: SmtpSettings["encryption"] = "none"): SmtpSettings => ({ host: "127.0.0.1", port, encryption, username: USERNAME, password: "qa-fake-password-1", fromName: "NOZOMI", fromAddress: "noreply@example.com" });

async function send(next: Script, encryption: SmtpSettings["encryption"] = "none"): Promise<MailSendResult> {
  script = next;
  return new SmtpMailer({ allowLoopback: true, deadlineMs: 1_000 }).send(settings(encryption), { to: RECIPIENT, subject: "主题", text: "正文" });
}

function assertCode(result: MailSendResult, code: SmtpFailureCode, label: string): void {
  assert.equal(result.ok, false, label);
  if (result.ok) return;
  assert.equal(result.code, code, label);
  assert.equal(result.message, SMTP_FAILURE_MESSAGES[code], label);
  const text = JSON.stringify(result);
  assert.ok(!text.includes(RECIPIENT) && !text.includes(USERNAME) && !text.includes("said no"), `${label}：结果里有服务器原文`);
}

test("多行应答（每行都带增强状态码，RFC 2034）：RCPT 按第一行的状态码归类，4xx 还是暂时拒绝", async () => {
  const cases: [string, SmtpFailureCode][] = [
    [`550-5.1.1 ${ECHO}\r\n550 5.1.1 see help`, "RECIPIENT_REJECTED"],
    [`550-5.2.1 ${ECHO}\r\n550-5.2.1 more\r\n550 5.2.1 see help`, "RECIPIENT_REJECTED"],
    [`553-5.1.8 ${ECHO}\r\n553 5.1.8 see help`, "SENDER_REJECTED"],
    [`550-5.7.1 ${ECHO}\r\n550 5.7.1 see help`, "MESSAGE_REJECTED"],
    [`450-4.2.1 ${ECHO}\r\n450 4.2.1 see help`, "TEMPORARILY_REJECTED"],
    [`421-4.7.0 ${ECHO}\r\n421 4.7.0 see help`, "TEMPORARILY_REJECTED"],
  ];
  for (const [reply, code] of cases) assertCode(await send({ stage: "rcpt", reply }), code, reply);
});

test("多行应答在 MAIL FROM、DATA 命令、正文之后：同样归类", async () => {
  assertCode(await send({ stage: "mail", reply: `550-5.7.1 ${ECHO}\r\n550 5.7.1 see help` }), "SENDER_REJECTED", "MAIL 5xx");
  assertCode(await send({ stage: "mail", reply: `451-4.3.2 ${ECHO}\r\n451 4.3.2 see help` }), "TEMPORARILY_REJECTED", "MAIL 4xx");
  assertCode(await send({ stage: "data", reply: `550-5.1.1 ${ECHO}\r\n550 5.1.1 see help` }), "RECIPIENT_REJECTED", "DATA 5.1.1");
  assertCode(await send({ stage: "dot", reply: `554-5.7.1 ${ECHO}\r\n554 5.7.1 see help` }), "MESSAGE_REJECTED", "正文 5.7.1");
  assertCode(await send({ stage: "dot", reply: `552-5.2.2 ${ECHO}\r\n552 5.2.2 see help` }), "RECIPIENT_REJECTED", "正文 5.2.2");
  assertCode(await send({ stage: "dot", reply: `451-4.7.1 ${ECHO}\r\n451 4.7.1 see help` }), "TEMPORARILY_REJECTED", "正文 4xx");
});

test("RCPT 的 5xx 按状态码逐类：ADR 表里的收件人代码、发件人代码，其余都是说不清", async () => {
  for (const status of ["5.1.1", "5.1.2", "5.1.3", "5.1.6", "5.1.10", "5.2.1", "5.2.2"]) assertCode(await send({ stage: "rcpt", reply: `550 ${status} ${ECHO}` }), "RECIPIENT_REJECTED", status);
  for (const status of ["5.1.7", "5.1.8"]) assertCode(await send({ stage: "rcpt", reply: `550 ${status} ${ECHO}` }), "SENDER_REJECTED", status);
  for (const status of ["5.1.0", "5.1.4", "5.1.100", "5.2.0", "5.2.3", "5.3.4", "5.4.1", "5.5.1", "5.7.1", "5.7.26"]) assertCode(await send({ stage: "rcpt", reply: `550 ${status} ${ECHO}` }), "MESSAGE_REJECTED", status);
});

test("RCPT 没有增强状态码：550–553 算收件人；其他 5xx（语法类、554、556）说不清", async () => {
  for (const code of [550, 551, 552, 553]) assertCode(await send({ stage: "rcpt", reply: `${code} ${ECHO}` }), "RECIPIENT_REJECTED", String(code));
  for (const code of [500, 501, 502, 503, 504, 521, 554, 556]) assertCode(await send({ stage: "rcpt", reply: `${code} ${ECHO}` }), "MESSAGE_REJECTED", String(code));
  assertCode(await send({ stage: "rcpt", reply: `551 5.0.0 ${ECHO}` }), "RECIPIENT_REJECTED", "X.0.0 等于没说");
  assertCode(await send({ stage: "rcpt", reply: `554 5.0.0 ${ECHO}` }), "MESSAGE_REJECTED", "554 的 X.0.0");
});

test("畸形的状态码不当状态码用：RCPT 按没有增强码处理，DATA 还是说不清；不崩、不抛", async () => {
  for (const malformed of ["5.1", "5.1.", "5..1", "5.1.1.1", "5.1.1234", "9.1.1", "#5.1.1", "x.1.1"]) {
    assertCode(await send({ stage: "rcpt", reply: `550 ${malformed} ${ECHO}` }), "RECIPIENT_REJECTED", `RCPT ${malformed}`);
    assertCode(await send({ stage: "dot", reply: `550 ${malformed} ${ECHO}` }), "MESSAGE_REJECTED", `正文 ${malformed}`);
  }
});

test("状态码后面紧跟说明文字（5.7.1:）是畸形写法，不是 RFC 3463 的状态码：RCPT 上和没有增强码一样；后面用空白隔开才算", async () => {
  assertCode(await send({ stage: "rcpt", reply: `550 5.1.1\t${ECHO}` }), "RECIPIENT_REJECTED", "制表符");
  assertCode(await send({ stage: "rcpt", reply: "550 5.7.1" }), "MESSAGE_REJECTED", "只有状态码，没有说明");
  assertCode(await send({ stage: "rcpt", reply: `550 5.1.1: ${ECHO}` }), "RECIPIENT_REJECTED", "冒号");
});

test("说明文字里的数字和发件人字样不影响归类", async () => {
  assertCode(await send({ stage: "rcpt", reply: "550 5.7.1 see 5.1.1 sender 5.1.8" }), "MESSAGE_REJECTED", "说明里有别的状态码");
  assertCode(await send({ stage: "rcpt", reply: "554 mailbox 5.1.1 unknown user" }), "MESSAGE_REJECTED", "554 说明里提到收件人");
  assertCode(await send({ stage: "rcpt", reply: "450 5.1.1 odd" }), "TEMPORARILY_REJECTED", "4xx 配 5.x.x");
  assertCode(await send({ stage: "dot", reply: "554 no such user" }), "MESSAGE_REJECTED", "正文之后只看码");
});

test("只有应答码、没有文字的应答（550）：不挂到超时，RCPT 算收件人", async () => {
  assertCode(await send({ stage: "rcpt", reply: "550" }), "RECIPIENT_REJECTED", "550");
});

test("421 之后服务器断开（RFC 5321 3.8）：MAIL、RCPT、DATA、正文之后都是暂时拒绝，不是连不上", async () => {
  for (const stage of ["mail", "rcpt", "data", "dot"] as const) assertCode(await send({ stage, reply: `421 4.7.0 ${ECHO}`, close: true }), "TEMPORARILY_REJECTED", stage);
});

test("打招呼就回 421（连接数满、限流）：ADR 说任何一步的 4xx 都是暂时拒绝，不能说「应答看不懂、请确认填的是 SMTP 服务」", async () => {
  assertCode(await send({ stage: "greeting", reply: `421 4.3.2 ${ECHO}`, close: true }), "TEMPORARILY_REJECTED", "greeting");
});

test("EHLO 回 421：同样是暂时拒绝", async () => {
  assertCode(await send({ stage: "ehlo", reply: `421 4.3.2 ${ECHO}` }), "TEMPORARILY_REJECTED", "EHLO");
});

test("认证回 454（临时认证失败，RFC 4954）：同样是暂时拒绝，不能让运营去改其实没错的密码", async () => {
  assertCode(await send({ stage: "auth", reply: `454 4.7.0 ${ECHO}` }), "TEMPORARILY_REJECTED", "AUTH 454");
});

test("认证的 5xx 还是认证失败，不受拒收归类影响", async () => {
  assertCode(await send({ stage: "auth", reply: `535 5.7.8 ${ECHO}` }), "AUTH_FAILED", "AUTH 535");
});

test("STARTTLS 回 454（TLS 暂时不可用，RFC 3207）：同样是暂时拒绝，不能说加密方式和端口不配", async () => {
  assertCode(await send({ stage: "starttls", reply: `454 4.7.0 ${ECHO}`, advertiseStartTls: true }, "starttls"), "TEMPORARILY_REJECTED", "STARTTLS 454");
});

test("classifySmtpError：配置错误类的归类没有被拒收逻辑影响", () => {
  const classify = (fields: Record<string, unknown>): SmtpFailureCode => classifySmtpError(Object.assign(new Error("x"), fields));
  assert.equal(classify({ code: "EAUTH", responseCode: 535 }), "AUTH_FAILED");
  assert.equal(classify({ code: "ENOAUTH" }), "AUTH_FAILED");
  assert.equal(classify({ code: "ETLS" }), "TLS_FAILED");
  assert.equal(classify({ code: "ESOCKET", originalCode: "CERT_HAS_EXPIRED" }), "TLS_FAILED");
  assert.equal(classify({ code: "ETIMEDOUT" }), "TIMEOUT");
  assert.equal(classify({ code: "EDNS" }), "UNREACHABLE");
  assert.equal(classify({ code: "ESOCKET" }), "UNREACHABLE");
  assert.equal(classifySmtpError(null), "UNEXPECTED");
  assert.equal(classify({ code: "EENVELOPE", command: "MAIL FROM", responseCode: "550", response: "550 5.7.1 odd" }), "SENDER_REJECTED", "应答码不是数字");
});

test("前端：后端能报的每个发信失败代码都有中文说明，文案里不夹代码（前端文件按文本读，api 的类型环境不引浏览器代码）", async () => {
  const source = await readFile(new URL("../../../web/src/lib/secret-form.ts", import.meta.url), "utf8");
  const block = /EMAIL_TEST_FAILURES[^=]*=\s*\{([\s\S]*?)\n\};/.exec(source)?.[1] ?? "";
  const failures = new Map([...block.matchAll(/^\s+([A-Z_]+): "(.*)",$/gm)].map((match) => [match[1] as string, match[2] as string]));
  assert.ok(failures.size > 0, "没有读到前端的说明表");
  for (const [code, serverText] of Object.entries(SMTP_FAILURE_MESSAGES)) {
    assert.match(serverText, /[\u4e00-\u9fff]/, code);
    const text = failures.get(code);
    assert.ok(text !== undefined, `前端没有 ${code} 的说明`);
    assert.match(text, /[\u4e00-\u9fff]/, code);
    assert.ok(!text.includes(code), code);
  }
});
