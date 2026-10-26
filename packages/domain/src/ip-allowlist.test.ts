import assert from "node:assert/strict";
import { test } from "node:test";
import {
  IP_ALLOWLIST_MAX_ENTRIES,
  effectiveAllowlist,
  formatIpAddress,
  ipAllowed,
  normalizeAllowlist,
  parseCidr,
  parseIpAddress,
} from "./ip-allowlist.ts";

const canonical = (text: string): string | null => {
  const parsed = parseCidr(text);
  return parsed.ok ? normalizeAllowlist([text]).cidrs[0] ?? null : null;
};

test("IPv4 地址：四段 0–255，不收前导 0、空段、多余的段", () => {
  assert.equal(formatIpAddress(parseIpAddress("203.0.113.5")!), "203.0.113.5");
  assert.equal(formatIpAddress(parseIpAddress(" 0.0.0.0 ")!), "0.0.0.0");
  for (const bad of ["256.0.0.1", "1.2.3", "1.2.3.4.5", "01.2.3.4", "1..3.4", "1.2.3.-4", "a.b.c.d", "", "1.2.3.4/32"]) assert.equal(parseIpAddress(bad), null, bad);
});

test("IPv6 地址：压缩写法、大小写、末尾嵌 IPv4；规范写法按 RFC 5952", () => {
  const cases: [string, string][] = [
    ["2001:DB8:0:0:0:0:0:1", "2001:db8::1"],
    ["2001:db8::1", "2001:db8::1"],
    ["::", "::"],
    ["::1", "::1"],
    ["fe80::", "fe80::"],
    ["2001:db8:0:1:0:0:0:1", "2001:db8:0:1::1"],
    ["2001:0:0:1:0:0:0:1", "2001:0:0:1::1"],
    ["2001:db8:1:1:1:1:1:1", "2001:db8:1:1:1:1:1:1"],
    ["2001:db8::1:0:0:1", "2001:db8::1:0:0:1"],
    ["::192.0.2.1", "::c000:201"],
  ];
  for (const [input, expected] of cases) assert.equal(formatIpAddress(parseIpAddress(input)!), expected, input);
  for (const bad of ["1:2:3:4:5:6:7:8:9", "1::2::3", ":1", "1:", "12345::", "g::1", "fe80::1%eth0", "1:2:3:4:5:6:7::8:9"]) assert.equal(parseIpAddress(bad), null, bad);
});

test("IPv4 映射的 IPv6 地址当作 IPv4：来源和名单两边都是", () => {
  assert.deepEqual(parseIpAddress("::ffff:203.0.113.5"), parseIpAddress("203.0.113.5"));
  assert.deepEqual(parseIpAddress("::FFFF:cb00:7105"), parseIpAddress("203.0.113.5"));
  assert.equal(canonical("::ffff:203.0.113.0/120"), "203.0.113.0/24");
  assert.equal(canonical("::ffff:0:0/96"), "0.0.0.0/0");
  assert.equal(canonical("::ffff:0:0/95"), null, "跨出映射段的前缀：主机位不为 0");
  assert.equal(ipAllowed("::ffff:203.0.113.5", ["203.0.113.0/24"]), true);
  assert.equal(ipAllowed("203.0.113.5", ["::ffff:203.0.113.0/120"].map((e) => canonical(e)!)), true);
  assert.equal(ipAllowed("::ffff:198.51.100.1", ["203.0.113.0/24"]), false);
});

test("地址段：没写前缀 = 单个地址；主机位不为 0 拒绝并给出正确写法；前缀超范围拒绝", () => {
  assert.equal(canonical("203.0.113.5"), "203.0.113.5/32");
  assert.equal(canonical("2001:db8::1"), "2001:db8::1/128");
  assert.equal(canonical("10.0.0.0/8"), "10.0.0.0/8");
  assert.equal(canonical("2001:DB8::/32"), "2001:db8::/32");
  assert.deepEqual(parseCidr("10.1.2.3/8"), { ok: false, reason: "HOST_BITS_SET", suggestion: "10.0.0.0/8" });
  assert.deepEqual(parseCidr("2001:db8::1/64"), { ok: false, reason: "HOST_BITS_SET", suggestion: "2001:db8::/64" });
  for (const bad of ["10.0.0.0/33", "2001:db8::/129", "10.0.0.0/", "10.0.0.0/08", "10.0.0.0/-1", "10.0.0.0/8/9", "/8", "example.com"]) {
    assert.deepEqual(parseCidr(bad), { ok: false, reason: "INVALID" }, bad);
  }
});

test("匹配：IPv4、IPv6 各自比较；/0 放行同一族的全部；不同族互不相干", () => {
  const list = ["203.0.113.0/24", "2001:db8:abcd::/48"];
  assert.equal(ipAllowed("203.0.113.0", list), true);
  assert.equal(ipAllowed("203.0.113.255", list), true);
  assert.equal(ipAllowed("203.0.114.0", list), false);
  assert.equal(ipAllowed("2001:db8:abcd:ffff::1", list), true);
  assert.equal(ipAllowed("2001:db8:abce::1", list), false);
  assert.equal(ipAllowed("::1", ["0.0.0.0/0"]), false);
  assert.equal(ipAllowed("127.0.0.1", ["::/0"]), false);
  assert.equal(ipAllowed("198.51.100.7", ["0.0.0.0/0"]), true);
  assert.equal(ipAllowed("198.51.100.7", ["198.51.100.7/32"]), true);
  assert.equal(ipAllowed("198.51.100.8", ["198.51.100.7/32"]), false);
  assert.equal(ipAllowed("198.51.100.8", ["198.51.100.6/31"]), false);
  assert.equal(ipAllowed("198.51.100.7", ["198.51.100.6/31"]), true);
});

test("空名单 = 不限制；名单不空时解析不了的来源地址一律拒绝", () => {
  assert.equal(ipAllowed("anything", []), true);
  assert.equal(ipAllowed("not-an-ip", ["0.0.0.0/0"]), false);
  assert.equal(ipAllowed("", ["0.0.0.0/0"]), false);
});

test("整份名单的校验：逐条给出问题；规范写法相同的算重复", () => {
  const result = normalizeAllowlist(["10.0.0.0/8", " 2001:db8::/32 ", "::ffff:10.0.0.0/104", "10.1.0.0/8", "bad"]);
  assert.deepEqual(result.cidrs, ["10.0.0.0/8", "2001:db8::/32"]);
  assert.deepEqual(result.issues, [
    { index: 2, value: "::ffff:10.0.0.0/104", reason: "DUPLICATE" },
    { index: 3, value: "10.1.0.0/8", reason: "HOST_BITS_SET", suggestion: "10.0.0.0/8" },
    { index: 4, value: "bad", reason: "INVALID" },
  ]);
  assert.ok(IP_ALLOWLIST_MAX_ENTRIES >= 10);
});

test("实际生效的名单：员工自己的不空用员工的，否则用角色的", () => {
  assert.deepEqual(effectiveAllowlist(["10.0.0.0/8"], ["192.0.2.0/24"]), ["10.0.0.0/8"]);
  assert.deepEqual(effectiveAllowlist([], ["192.0.2.0/24"]), ["192.0.2.0/24"]);
  assert.deepEqual(effectiveAllowlist([], []), []);
});
