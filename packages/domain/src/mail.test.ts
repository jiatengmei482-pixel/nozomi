import { test } from "node:test";
import assert from "node:assert/strict";
import { isSingleMailAddress, mailMessageIssues, smtpAddressAllowed, smtpHostAllowed } from "./mail.ts";

const ok = { to: "someone@example.com", subject: "你好", text: "正文" };

test("邮件内容：合格的没有问题；中文主题、很长的正文、正文里的换行都可以", () => {
  assert.deepEqual(mailMessageIssues(ok), []);
  assert.deepEqual(mailMessageIssues({ ...ok, subject: "预订确认 #12", text: "第一行\r\n第二行\r\nBcc: x@y.z", html: "<p>x</p>" }), []);
});

test("防邮件头注入：主题里的换行和控制字符一律拒绝", () => {
  for (const subject of ["a\r\nBcc: evil@example.com", "a\nb", "a\rb", "a\tb", "a\u0000b", "a\u0085b", "a\u2028b", "a\u2029b", "a\u007fb"]) {
    assert.deepEqual(mailMessageIssues({ ...ok, subject }), [{ field: "subject", reason: "FORMAT" }], JSON.stringify(subject));
  }
});

test("防邮件头注入：收件人只能是一个地址", () => {
  for (const to of ["a@example.com\r\nBcc: evil@example.com", "a@example.com\n", "a@example.com, b@example.com", "a@example.com;b@example.com", "A <a@example.com>", "<a@example.com>", "a b@example.com", "a@example", "@example.com", "a@", "a@@example.com", "a@-x.com", "a@x-.com", "a@example..com", "用户@example.com", `${"a".repeat(250)}@b.co`]) {
    assert.deepEqual(mailMessageIssues({ ...ok, to }), [{ field: "to", reason: "FORMAT" }], JSON.stringify(to));
    assert.equal(isSingleMailAddress(to), false);
  }
  for (const to of ["a@example.com", "a.b+tag@mail.example.co.jp", "A_1@EXAMPLE.COM"]) assert.equal(isSingleMailAddress(to), true, to);
});

test("必填和长度", () => {
  assert.deepEqual(mailMessageIssues({ to: "", subject: "", text: "" }), [
    { field: "to", reason: "REQUIRED" },
    { field: "subject", reason: "REQUIRED" },
    { field: "text", reason: "REQUIRED" },
  ]);
  assert.deepEqual(mailMessageIssues({ ...ok, subject: "x".repeat(200) }), []);
  assert.deepEqual(mailMessageIssues({ ...ok, subject: "x".repeat(201) }), [{ field: "subject", reason: "TOO_LONG" }]);
});

const STRICT = { allowLoopback: false };
const LOCAL = { allowLoopback: true };

test("SMTP 主机：公网的名字和地址可以；内网、回环、链路本地、元数据地址、内网名字、数字写法都不行", () => {
  for (const host of ["smtp.example.com", "smtp.gmail.com", "8.8.8.8", "2606:4700:4700::1111"]) assert.equal(smtpHostAllowed(host, STRICT), true, host);
  for (const host of ["localhost", "127.0.0.1", "127.1.2.3", "::1", "10.0.0.8", "172.16.0.1", "192.168.1.1", "169.254.169.254", "fe80::1", "fc00::1", "fd00:ec2::254", "0.0.0.0", "::ffff:10.0.0.1", "::ffff:127.0.0.1", "100.64.0.1", "mail", "smtp.internal", "mail.local", "2130706433", "0x7f.1", "017700000001"]) {
    assert.equal(smtpHostAllowed(host, STRICT), false, host);
  }
});

test("local / ci 的例外只放开回环：内网、链路本地、元数据地址在任何环境都不行", () => {
  for (const host of ["localhost", "127.0.0.1", "::1"]) assert.equal(smtpHostAllowed(host, LOCAL), true, host);
  for (const host of ["10.0.0.8", "192.168.1.1", "169.254.169.254", "fe80::1", "fd00:ec2::254", "smtp.internal", "mail"]) assert.equal(smtpHostAllowed(host, LOCAL), false, host);
});

test("解析到的地址：只有公网的；local / ci 另外放开回环", () => {
  assert.equal(smtpAddressAllowed("8.8.8.8", STRICT), true);
  for (const address of ["127.0.0.1", "::1", "10.0.0.8", "169.254.169.254", "fe80::1", "garbage"]) assert.equal(smtpAddressAllowed(address, STRICT), false, address);
  assert.equal(smtpAddressAllowed("127.0.0.1", LOCAL), true);
  assert.equal(smtpAddressAllowed("10.0.0.8", LOCAL), false);
});
