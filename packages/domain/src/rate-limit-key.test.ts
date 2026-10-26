import assert from "node:assert/strict";
import { test } from "node:test";
import { IPV6_RATE_LIMIT_PREFIX, RATE_LIMIT_KEY_NO_ADDRESS, rateLimitKeyOf } from "./rate-limit-key.ts";

test("IPv4 原样；首尾空白、端口、方括号去掉", () => {
  assert.equal(rateLimitKeyOf("203.0.113.5"), "203.0.113.5");
  assert.equal(rateLimitKeyOf(" 203.0.113.5 \n"), "203.0.113.5");
  assert.equal(rateLimitKeyOf("203.0.113.5:8080"), "203.0.113.5");
  assert.equal(rateLimitKeyOf("[203.0.113.5]:8080"), "203.0.113.5");
  assert.notEqual(rateLimitKeyOf("203.0.113.5"), rateLimitKeyOf("203.0.113.6"), "IPv4 不按网段合并，相邻地址各算各的");
  assert.equal(rateLimitKeyOf("0.0.0.0"), "0.0.0.0");
  assert.equal(rateLimitKeyOf("255.255.255.255"), "255.255.255.255");
});

test("IPv4 映射的 IPv6（点分写法、十六进制写法、大写、带方括号和端口）当作 IPv4", () => {
  for (const text of ["::ffff:203.0.113.5", "::FFFF:203.0.113.5", "0:0:0:0:0:ffff:203.0.113.5", "::ffff:cb00:7105", "[::ffff:203.0.113.5]", "[::ffff:203.0.113.5]:443", "0000:0000:0000:0000:0000:FFFF:CB00:7105"]) {
    assert.equal(rateLimitKeyOf(text), "203.0.113.5", text);
  }
});

test("IPv6 取前 64 位：同一个 /64 里换后 64 位都是同一个键", () => {
  assert.equal(IPV6_RATE_LIMIT_PREFIX, 64);
  const key = "2001:db8:1:2::/64";
  for (const text of [
    "2001:db8:1:2::1",
    "2001:db8:1:2:ffff:ffff:ffff:ffff",
    "2001:db8:1:2:a1b2:c3d4:e5f6:789",
    "2001:db8:1:2::",
    "2001:0db8:0001:0002:0000:0000:0000:0001",
    "2001:DB8:1:2::ABCD",
    "2001:db8:1:2:0:0:0:1",
    "2001:db8:1:2::203.0.113.5",
  ]) {
    assert.equal(rateLimitKeyOf(text), key, text);
  }
});

test("IPv6 的外壳：方括号、端口、区域标识（含 URL 编码的 %25）去掉", () => {
  assert.equal(rateLimitKeyOf("[2001:db8:1:2::1]"), "2001:db8:1:2::/64");
  assert.equal(rateLimitKeyOf("[2001:db8:1:2::1]:443"), "2001:db8:1:2::/64");
  assert.equal(rateLimitKeyOf("fe80::1%eth0"), "fe80::/64");
  assert.equal(rateLimitKeyOf("fe80::1%25eth0"), "fe80::/64");
  assert.equal(rateLimitKeyOf("[fe80::abcd%eth0]:8080"), "fe80::/64");
  assert.equal(rateLimitKeyOf("  2001:db8:1:2::1  "), "2001:db8:1:2::/64");
});

test("不同的 /64 是不同的键；只差第 64 位也不同", () => {
  assert.notEqual(rateLimitKeyOf("2001:db8:1:2::1"), rateLimitKeyOf("2001:db8:1:3::1"));
  assert.equal(rateLimitKeyOf("2001:db8:0:0:8000::1"), "2001:db8::/64", "第 65 位不影响");
  assert.equal(rateLimitKeyOf("2001:db8:0:1::1"), "2001:db8:0:1::/64", "第 64 位影响");
  assert.notEqual(rateLimitKeyOf("2001:db8:0:1::1"), rateLimitKeyOf("2001:db8::1"));
});

test("网段的写法是规范的压缩写法（小写、去前导 0、最长一段连续 0 压成 ::）", () => {
  assert.equal(rateLimitKeyOf("2001:0DB8:0000:0000:1234:5678:9abc:def0"), "2001:db8::/64");
  assert.equal(rateLimitKeyOf("2400:4050:a0:100::1"), "2400:4050:a0:100::/64");
  assert.equal(rateLimitKeyOf("::1"), "::/64");
  assert.equal(rateLimitKeyOf("::"), "::/64");
  assert.equal(rateLimitKeyOf("1:2:3:4:5:6:7:8"), "1:2:3:4::/64");
  assert.equal(rateLimitKeyOf("ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff"), "ffff:ffff:ffff:ffff::/64");
});

test("解析不了的：raw: 加原文，各自一个键，和任何合法地址的键都不同", () => {
  const junk = ["unknown", "", "1.2.3", "256.1.1.1", "2001:db8::1::2", "2001:db8:1:2::/64", "203.0.113.5.", "[2001:db8::1", "010.0.0.1", "abc%eth0"];
  const keys = junk.map(rateLimitKeyOf);
  junk.forEach((text, i) => assert.equal(keys[i], `raw:${text}`, text));
  assert.equal(new Set(keys).size, junk.length, "不同的原文不会共用一个桶");
  assert.notEqual(rateLimitKeyOf("2001:db8:1:2::/64"), rateLimitKeyOf("2001:db8:1:2::1"), "把网段写法当来源地址传进来，不会撞上真实网段的键");
});

test("末 32 位内嵌 IPv4 的写法（IPv4 兼容、NAT64 64:ff9b::/96、SIIT ::ffff:0:0:0/96）按那个 IPv4 计；:: 和 ::1 照常按 /64", () => {
  for (const text of ["::203.0.113.5", "64:ff9b::203.0.113.5", "64:FF9B::CB00:7105", "[64:ff9b::cb00:7105]:443", "::ffff:0:203.0.113.5", "::ffff:0:cb00:7105"]) {
    assert.equal(rateLimitKeyOf(text), "203.0.113.5", text);
  }
  assert.equal(rateLimitKeyOf("::"), "::/64");
  assert.equal(rateLimitKeyOf("::1"), "::/64");
  assert.equal(rateLimitKeyOf("::2"), "0.0.0.2");
  assert.equal(rateLimitKeyOf("64:ff9b:1::203.0.113.5"), "64:ff9b:1::/64", "NAT64 的本地前缀（64:ff9b:1::/48）不是知名前缀，照常按 /64");
});

test("Teredo（2001::/32）按完整地址计（/128）；2001:db8 等其他 2001: 开头的照常按 /64", () => {
  assert.equal(rateLimitKeyOf("2001:0:4136:E378:8000:63bf:3fff:fdd2"), "2001:0:4136:e378:8000:63bf:3fff:fdd2/128");
  assert.notEqual(rateLimitKeyOf("2001:0:4136:e378:8000:63bf:3fff:fdd2"), rateLimitKeyOf("2001:0:4136:e378:8000:63bf:fbff:fffe"));
  assert.equal(rateLimitKeyOf("2001:1:4136:e378::1"), "2001:1:4136:e378::/64");
});

test("来源地址不是字符串（连接已断开）：固定的 raw:(none)，不抛异常", () => {
  assert.equal(rateLimitKeyOf(undefined), RATE_LIMIT_KEY_NO_ADDRESS);
  assert.equal(rateLimitKeyOf(null), RATE_LIMIT_KEY_NO_ADDRESS);
  assert.equal(RATE_LIMIT_KEY_NO_ADDRESS, "raw:(none)");
});
