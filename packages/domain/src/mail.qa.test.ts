/**
 * QA（M4-14，ADR 0048）：SMTP 主机和解析结果的防 SSRF 对照表、邮件头注入的字符边界。开发的 mail.test.ts 只抽了几个代表，这里把写法铺开。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isSingleMailAddress, mailMessageIssues, smtpAddressAllowed, smtpHostAllowed } from "./index.ts";

const STRICT = { allowLoopback: false };
const LOCAL = { allowLoopback: true };

const FORBIDDEN_HOSTS = [
  // 私网、回环、链路本地、元数据、运营商级 NAT
  "10.0.0.1", "10.255.255.255", "172.16.0.1", "172.31.255.255", "192.168.0.1", "127.0.0.1", "127.255.255.254", "169.254.0.1", "169.254.169.254", "100.64.0.1", "100.127.255.255", "0.0.0.0", "0.1.2.3",
  // 组播、广播、保留
  "224.0.0.1", "255.255.255.255", "240.0.0.1", "192.0.0.1", "198.18.0.1",
  // 十进制、八进制、十六进制、缩写、前导零
  "2130706433", "017700000001", "0x7f000001", "0X7F000001", "0x7f.1", "0x7F.0.0.1", "127.0x0.0.1", "0x7f.0x0.0x0.0x1", "127.1", "127.0.1", "0177.0.0.1", "127.000.000.001", "010.0.0.1", "3232235521", "0xc0a80001", "0xa9fea9fe", "2852039166", "0",
  // IPv6：回环、未指定、唯一本地、链路本地、站点本地、组播
  "::1", "::", "0:0:0:0:0:0:0:1", "0000:0000:0000:0000:0000:0000:0000:0001", "fc00::1", "fd12:3456::1", "fd00:ec2::254", "fe80::1", "febf::1", "fec0::1", "ff02::1", "2001:db8::1", "100::1",
  // IPv6 嵌 IPv4（映射、兼容、NAT64、本地 NAT64、6to4、Teredo）
  "::ffff:127.0.0.1", "::ffff:7f00:1", "::FFFF:7F00:1", "0:0:0:0:0:ffff:7f00:1", "::ffff:10.0.0.8", "::ffff:a00:8", "::ffff:169.254.169.254", "::ffff:a9fe:a9fe", "::127.0.0.1", "::7f00:1", "::10.0.0.8", "64:ff9b::7f00:1", "64:ff9b::127.0.0.1", "64:ff9b::a9fe:a9fe", "64:ff9b:1::a00:1", "2002:7f00:1::", "2002:a00:8::", "2002:a9fe:a9fe::", "2001:0:4136:e378:8000:63bf:3fff:fdd2",
  // 只在内网解析的名字
  "localhost", "LOCALHOST", "localhost.", "foo.localhost", "mail", "mail.local", "smtp.internal", "metadata.google.internal", "smtp.corp", "smtp.lan", "smtp.home", "smtp.intranet", "smtp.localdomain", "smtp.home.arpa",
  // 尾点不能绕过
  "127.0.0.1.", "169.254.169.254.", "smtp.internal.", "mail.local.",
  // 方括号的 IPv6
  "[::1]", "[::ffff:127.0.0.1]",
];

for (const host of FORBIDDEN_HOSTS) {
  test(`主机 ${host}：任何环境都不是可连的公网目标`, () => {
    assert.equal(smtpHostAllowed(host, STRICT), false);
  });
}

test("公网的名字和地址不会被误伤", () => {
  for (const host of ["smtp.gmail.example", "smtp.example.com", "SMTP.Example.COM", "mail-1.example.co.jp", "8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "192.167.0.1", "100.63.0.1", "100.128.0.1", "2606:4700:4700::1111", "::ffff:8.8.8.8", "2002:808:808::"]) {
    assert.equal(smtpHostAllowed(host, STRICT), true, host);
  }
});

test("local / ci 的例外只有回环：回环的各种写法放行，内网、链路本地、元数据和数字写法仍然拒绝", () => {
  for (const host of ["127.0.0.1", "localhost", "::1"]) assert.equal(smtpHostAllowed(host, LOCAL), true, host);
  for (const host of ["10.0.0.1", "192.168.0.1", "169.254.169.254", "fe80::1", "fd00:ec2::254", "::ffff:10.0.0.8", "0.0.0.0", "::", "2130706433", "0x7f.1", "0177.0.0.1", "smtp.internal", "mail.local"]) assert.equal(smtpHostAllowed(host, LOCAL), false, host);
});

test("解析结果：嵌在 IPv6 里的内网地址、带区域标识的地址、不是地址的文字都不算公网", () => {
  for (const address of ["10.0.0.8", "127.0.0.1", "169.254.169.254", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "::ffff:a9fe:a9fe", "::7f00:1", "64:ff9b::a00:8", "64:ff9b:1::a00:8", "2002:a00:8::", "2001:0:4136:e378:8000:63bf:3fff:fdd2", "fe80::1%eth0", "fe80::1", "fc00::1", "not-an-address", "", "2130706433", "0x7f.1"]) {
    assert.equal(smtpAddressAllowed(address, STRICT), false, address);
  }
  assert.equal(smtpAddressAllowed("8.8.8.8", STRICT), true);
  assert.equal(smtpAddressAllowed("2606:4700:4700::1111", STRICT), true);
  for (const address of ["10.0.0.8", "169.254.169.254", "::ffff:10.0.0.8", "fe80::1"]) assert.equal(smtpAddressAllowed(address, LOCAL), false, address);
});

test("主题：每一种能断行的字符都拒绝（C0、DEL、C1 含 NEL、行分隔符、段分隔符）", () => {
  for (const code of [0x00, 0x01, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x1b, 0x1f, 0x7f, 0x80, 0x85, 0x9f, 0x2028, 0x2029]) {
    const subject = `预订${String.fromCharCode(code)}Bcc: attacker@example.test`;
    assert.deepEqual(mailMessageIssues({ to: "guest@example.test", subject, text: "正文" }), [{ field: "subject", reason: "FORMAT" }], code.toString(16));
  }
});

test("收件人：能多塞一个地址或一行邮件头的写法都拒绝", () => {
  for (const to of ["a@example.test\n", "a@example.test\r\n", "\na@example.test", "a@example.test ", "a@example.test\u0085", "a@example.test;b@example.test", "a@example.test b@example.test", "a@example.test,", "<a@example.test>", "\"a b\"@example.test", "a@example.test\u0000", "a@[127.0.0.1]", "a@127.0.0.1.", "a@localhost", "a@b@example.test", "ａ@example.test"]) {
    assert.equal(isSingleMailAddress(to), false, JSON.stringify(to));
  }
  assert.equal(isSingleMailAddress(`${"a".repeat(243)}@example.test`), false, "超过 254");
});

test("主题和正文都要有内容：只有空白的不算内容（接口的错误说明写的就是「都要有内容」）", () => {
  const issues = (subject: string, text: string): string[] => mailMessageIssues({ to: "guest@example.test", subject, text }).map((issue) => issue.field);
  assert.deepEqual(issues("   ", "正文"), ["subject"]);
  assert.deepEqual(issues("主题", "   "), ["text"]);
  assert.deepEqual(issues("　", "正文"), ["subject"]);
});
