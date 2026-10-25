import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TENANT_WEBHOOK_EVENTS,
  TENANT_WEBHOOK_EVENT_NAMES,
  WEBHOOK_MAX_ATTEMPTS,
  WEBHOOK_RULES,
  ipAddressAllowed,
  ipAddressClass,
  parseIpv6,
  webhookAccepted,
  webhookHostAllowed,
  webhookRetryDelaySeconds,
  webhookSignedContent,
  webhookUrlIssue,
} from "./webhooks.ts";

test("退避：失败后按 1 分钟、5 分钟、30 分钟、2 小时、6 小时、24 小时重试，第 7 次失败后不再重试", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(webhookRetryDelaySeconds), [60, 300, 1_800, 7_200, 21_600, 86_400]);
  assert.equal(webhookRetryDelaySeconds(7), null);
  assert.equal(webhookRetryDelaySeconds(100), null);
  assert.equal(WEBHOOK_MAX_ATTEMPTS, 7);
  assert.throws(() => webhookRetryDelaySeconds(0), RangeError);
  assert.throws(() => webhookRetryDelaySeconds(1.5), RangeError);
  const total = WEBHOOK_RULES.retryDelaysSeconds.reduce((sum, seconds) => sum + seconds, 0);
  assert.equal(total, 117_360, "从第一次失败到最后一次重试约 32.6 小时");
});

test("只有 2xx 算接收成功；重定向不跟随、算失败", () => {
  assert.equal(webhookAccepted(200), true);
  assert.equal(webhookAccepted(204), true);
  assert.equal(webhookAccepted(299), true);
  for (const status of [199, 301, 302, 307, 400, 404, 429, 500, 503]) assert.equal(webhookAccepted(status), false, String(status));
});

test("签名的原文是「时间戳.请求体」", () => {
  assert.equal(webhookSignedContent(1_760_000_000, '{"a":1}'), '1760000000.{"a":1}');
});

test("事件清单：每个事件都有说明；测试事件不在可订阅的清单里", () => {
  for (const event of TENANT_WEBHOOK_EVENTS) assert.ok(TENANT_WEBHOOK_EVENT_NAMES[event].length > 0);
  assert.ok(!(TENANT_WEBHOOK_EVENTS as readonly string[]).includes("webhook.test"));
  assert.ok(TENANT_WEBHOOK_EVENTS.includes("rescue.offered") && TENANT_WEBHOOK_EVENTS.includes("order.rescued_away"), "第五轮新增的两个事件");
});

test("接收地址：只认 https，不能带账号密码、不能带 #，不能指向内网 / 回环 / 元数据地址", () => {
  assert.equal(webhookUrlIssue("https://dispatch.example.com/nozomi/webhook?k=1"), null);
  assert.equal(webhookUrlIssue("https://dispatch.example.com:8443/hook"), null);
  assert.equal(webhookUrlIssue("http://dispatch.example.com/hook"), "NOT_HTTPS");
  assert.equal(webhookUrlIssue("ftp://dispatch.example.com/hook"), "NOT_HTTPS");
  assert.equal(webhookUrlIssue("https://user:pass@dispatch.example.com/hook"), "HAS_CREDENTIALS");
  assert.equal(webhookUrlIssue("https://dispatch.example.com/hook#x"), "HAS_FRAGMENT");
  assert.equal(webhookUrlIssue("not a url"), "INVALID_URL");
  assert.equal(webhookUrlIssue(`https://example.com/${"a".repeat(2_048)}`), "TOO_LONG");
  for (const url of [
    "https://localhost/hook",
    "https://api.localhost/hook",
    "https://127.0.0.1/hook",
    "https://127.1/hook",
    "https://2130706433/hook",
    "https://0x7f000001/hook",
    "https://0177.0.0.1/hook",
    "https://10.0.0.5/hook",
    "https://192.168.1.10/hook",
    "https://172.20.0.3/hook",
    "https://169.254.169.254/latest/meta-data",
    "https://metadata.google.internal/computeMetadata/v1/",
    "https://[::1]/hook",
    "https://[::ffff:127.0.0.1]/hook",
    "https://[fd00:ec2::254]/hook",
    "https://[fe80::1]/hook",
    "https://printer.local/hook",
    "https://intranet/hook",
    "https://0.0.0.0/hook",
  ]) {
    assert.equal(webhookUrlIssue(url), "FORBIDDEN_HOST", url);
  }
});

test("主机名：公网 IP 写法可以；数字形式的地址、单标签名字不可以", () => {
  assert.equal(webhookHostAllowed("93.184.216.34"), true);
  assert.equal(webhookHostAllowed("[2606:4700:4700::1111]"), true);
  assert.equal(webhookHostAllowed("example.com."), true, "末尾带点的完全限定名");
  assert.equal(webhookHostAllowed("1.2.3"), false);
  assert.equal(webhookHostAllowed("0x7f.0.0.1"), false);
  assert.equal(webhookHostAllowed("dispatch"), false);
  assert.equal(webhookHostAllowed(""), false);
  assert.equal(webhookHostAllowed("home.arpa"), false);
});

test("IPv4 分类：内网、回环、链路本地、元数据、运营商级 NAT、组播、广播、文档地址都拒绝，公网可以", () => {
  const cases: Record<string, string> = {
    "8.8.8.8": "public",
    "93.184.216.34": "public",
    "0.0.0.0": "unspecified",
    "0.1.2.3": "unspecified",
    "10.1.2.3": "private",
    "100.64.0.1": "shared",
    "100.127.255.255": "shared",
    "100.128.0.1": "public",
    "127.0.0.1": "loopback",
    "127.255.255.254": "loopback",
    "169.254.169.254": "metadata",
    "169.254.1.1": "link_local",
    "172.15.255.255": "public",
    "172.16.0.1": "private",
    "172.31.255.255": "private",
    "172.32.0.1": "public",
    "192.0.0.8": "reserved",
    "192.0.2.1": "documentation",
    "192.88.99.1": "reserved",
    "192.168.0.1": "private",
    "198.18.0.1": "benchmark",
    "198.19.255.255": "benchmark",
    "198.51.100.7": "documentation",
    "203.0.113.9": "documentation",
    "224.0.0.1": "multicast",
    "239.255.255.250": "multicast",
    "240.0.0.1": "reserved",
    "255.255.255.255": "broadcast",
  };
  for (const [ip, expected] of Object.entries(cases)) assert.equal(ipAddressClass(ip), expected, ip);
  assert.equal(ipAddressAllowed("8.8.8.8"), true);
  assert.equal(ipAddressAllowed("10.0.0.1"), false);
});

test("IPv4 分类：写法不标准的（前导零、段数不对、越界）当作无效，不放行", () => {
  for (const ip of ["010.0.0.1", "1.2.3", "1.2.3.4.5", "256.1.1.1", "1.2.3.-1", "", "abc"]) {
    assert.equal(ipAddressClass(ip), "invalid", ip);
    assert.equal(ipAddressAllowed(ip), false, ip);
  }
});

test("IPv6 分类：回环、未指定、内网（含 AWS 元数据 fd00:ec2::254）、链路本地、组播、文档、保留都拒绝；嵌着 IPv4 的按 IPv4 判断", () => {
  const cases: Record<string, string> = {
    "2606:4700:4700::1111": "public",
    "2a00:1450:4001:82a::200e": "public",
    "::": "unspecified",
    "::1": "loopback",
    "[::1]": "loopback",
    "::ffff:127.0.0.1": "loopback",
    "::ffff:7f00:1": "loopback",
    "::ffff:10.0.0.1": "private",
    "::ffff:8.8.8.8": "public",
    "::127.0.0.1": "loopback",
    "64:ff9b::a9fe:a9fe": "metadata",
    "64:ff9b::808:808": "public",
    "2002:7f00:0001::": "loopback",
    "2002:0808:0808::1": "public",
    "fd00:ec2::254": "metadata",
    "fc00::1": "private",
    "fdff:ffff::1": "private",
    "fe80::1": "link_local",
    "febf::1": "link_local",
    "fec0::1": "private",
    "ff02::1": "multicast",
    "2001:db8::1": "documentation",
    "2001::1": "reserved",
    "100::1": "reserved",
    "3fff::1": "public",
    "4000::1": "reserved",
  };
  for (const [ip, expected] of Object.entries(cases)) assert.equal(ipAddressClass(ip), expected, ip);
});

test("IPv6 解析：缩写展开、嵌 IPv4、写错的拒绝", () => {
  assert.deepEqual(parseIpv6("::1"), [0, 0, 0, 0, 0, 0, 0, 1]);
  assert.deepEqual(parseIpv6("1::"), [1, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(parseIpv6("1:2:3:4:5:6:7:8"), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(parseIpv6("::ffff:1.2.3.4"), [0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304]);
  assert.deepEqual(parseIpv6("1:2:3:4:5:6:1.2.3.4"), [1, 2, 3, 4, 5, 6, 0x0102, 0x0304]);
  for (const bad of ["1:2:3:4:5:6:7:8:9", "1::2::3", "12345::", "fe80::1%eth0", "1:2:3:4:5:6:7", "::ffff:1.2.3", "g::1", ":::"]) {
    assert.equal(parseIpv6(bad), null, bad);
    assert.equal(ipAddressAllowed(bad), false, bad);
  }
});
