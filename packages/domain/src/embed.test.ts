import { test } from "node:test";
import assert from "node:assert/strict";
import { EMBED_KEY_FORMAT, EMBED_LAYOUTS, EMBED_SNIPPET_FALLBACKS, embedBookingUrlCheck, embedKeyIssues, embedOriginAllowed, embedReturnUrl, embedSnippet, embedSnippets, normalizeEmbedBookingUrl, normalizeEmbedOrigin } from "./embed.ts";

const PROD = { allowLocalHttp: false };
const TEST = { allowLocalHttp: true };
const DEMO = "https://embed-demo.moveglobal.io";

test("白名单的一项：规范化成 origin（小写、punycode、去默认端口、去结尾斜杠）", () => {
  assert.equal(normalizeEmbedOrigin("https://Embed-Demo.MoveGlobal.io", PROD), DEMO);
  assert.equal(normalizeEmbedOrigin("https://embed-demo.moveglobal.io/", PROD), DEMO);
  assert.equal(normalizeEmbedOrigin("https://embed-demo.moveglobal.io:443", PROD), DEMO);
  assert.equal(normalizeEmbedOrigin("https://embed-demo.moveglobal.io:8443", PROD), "https://embed-demo.moveglobal.io:8443");
  assert.equal(normalizeEmbedOrigin("https://例え.jp", PROD), "https://xn--r8jz45g.jp");
  assert.equal(normalizeEmbedOrigin("  https://a.example  ", PROD), "https://a.example");
});

test("白名单的一项：路径、查询、片段、用户名密码、通配符、非 https 都拒；本机 http 只在测试类环境收", () => {
  for (const bad of ["https://a.example/path", "https://a.example/?", "https://a.example?x=1", "https://a.example#x", "https://u:p@a.example", "https://*.a.example", "http://a.example", "ftp://a.example", "a.example", "", "javascript:alert(1)"]) {
    assert.equal(normalizeEmbedOrigin(bad, TEST), null, bad);
  }
  assert.equal(normalizeEmbedOrigin("http://localhost:5173", PROD), null);
  assert.equal(normalizeEmbedOrigin("http://localhost:5173", TEST), "http://localhost:5173");
  assert.equal(normalizeEmbedOrigin("http://127.0.0.1:4173", TEST), "http://127.0.0.1:4173");
  assert.equal(normalizeEmbedOrigin("http://192.168.0.2:4173", TEST), null);
});

test("请求的 Origin：缺失、null、不在白名单、只差一点的都不放行；完全相等才放行", () => {
  const allowed = [DEMO];
  assert.equal(embedOriginAllowed(DEMO, allowed, PROD), DEMO);
  assert.equal(embedOriginAllowed("https://EMBED-demo.moveglobal.io", allowed, PROD), DEMO, "大小写不同还是同一个 origin");
  for (const header of [null, undefined, "", "null", "https://embed-demo.moveglobal.io.evil.example", "http://embed-demo.moveglobal.io", "https://moveglobal.io", "https://x.embed-demo.moveglobal.io", "https://embed-demo.moveglobal.io:8443"]) {
    assert.equal(embedOriginAllowed(header, allowed, PROD), null, String(header));
  }
});

test("return_url：ADR 0090 第五节第 2 小节列出的用例", () => {
  const allowed = [DEMO, "https://other.example"];
  const ok = (value: unknown, origin = DEMO) => embedReturnUrl(value, origin, allowed, PROD);
  assert.equal(ok(`${DEMO}/thanks`), `${DEMO}/thanks`);
  assert.equal(ok(`${DEMO}/thanks?lang=ja#done`), `${DEMO}/thanks?lang=ja#done`);
  for (const bad of [
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "https://user:pass@embed-demo.moveglobal.io/",
    "https://embed-demo.moveglobal.io.evil.example/",
    "https://evil.example/?u=https://embed-demo.moveglobal.io",
    "https://embed-demo.moveglobal.io:8443/",
    "http://embed-demo.moveglobal.io/",
    "blob:https://embed-demo.moveglobal.io/x",
    "//embed-demo.moveglobal.io/",
    "/thanks",
    42,
    null,
  ]) {
    assert.equal(ok(bad), null, String(bad));
  }
  assert.equal(ok("https://other.example/thanks"), null, "白名单里有、但不等于建草稿请求的 Origin");
  assert.equal(embedReturnUrl(`${DEMO}/x`, DEMO, ["https://other.example"], PROD), null, "不在当前白名单（建草稿后被移除）");
  const base = `${DEMO}/`;
  assert.equal(ok(base + "a".repeat(2_000 - base.length)), base + "a".repeat(2_000 - base.length), "正好 2,000 字符");
  assert.equal(ok(base + "a".repeat(2_001 - base.length)), null, "2,001 字符");
});

test("嵌入码的新建 / 修改校验：名称、白名单 1–20 个（规范化、去重）、默认语言、默认标签、备注", () => {
  const input = { name: "MoveGlobal 演示站", allowed_origins: ["https://Embed-Demo.moveglobal.io/"], default_lang: "ja", default_services: ["transfer", "charter"], note: null };
  assert.deepEqual(embedKeyIssues(input, PROD), { issues: [], origins: [DEMO], bookingUrl: null });
  const reasons = (changes: Partial<typeof input> | Record<string, unknown>) => embedKeyIssues({ ...input, ...changes } as typeof input, PROD).issues.map((issue) => `${issue.path}:${issue.reason}`);
  assert.deepEqual(reasons({ name: " " }), ["/name:REQUIRED"]);
  assert.deepEqual(reasons({ name: "名".repeat(61) }), ["/name:OUT_OF_RANGE"]);
  assert.deepEqual(reasons({ allowed_origins: [] }), ["/allowed_origins:REQUIRED"]);
  assert.deepEqual(reasons({ allowed_origins: Array.from({ length: 21 }, (_, i) => `https://s${i}.example`) }), ["/allowed_origins:OUT_OF_RANGE"]);
  assert.deepEqual(reasons({ allowed_origins: Array.from({ length: 20 }, (_, i) => `https://s${i}.example`) }), []);
  assert.deepEqual(reasons({ allowed_origins: [DEMO, "https://embed-demo.moveglobal.io:443/"] }), ["/allowed_origins/1:DUPLICATE"]);
  assert.deepEqual(reasons({ allowed_origins: [DEMO, "https://*.moveglobal.io"] }), ["/allowed_origins/1:INVALID"]);
  assert.deepEqual(reasons({ default_lang: "ko" }), ["/default_lang:INVALID"]);
  assert.deepEqual(reasons({ default_services: [] }), ["/default_services:REQUIRED"]);
  assert.deepEqual(reasons({ default_services: ["airport"] }), ["/default_services:INVALID"]);
  assert.deepEqual(reasons({ default_services: ["charter", "charter"] }), ["/default_services:DUPLICATE"]);
  assert.deepEqual(reasons({ note: "x".repeat(501) }), ["/note:OUT_OF_RANGE"]);
  assert.deepEqual(reasons({ layout: "auto" }), []);
  assert.deepEqual(reasons({ layout: "card" }), []);
  assert.deepEqual(reasons({ layout: "bar" }), []);
  assert.deepEqual(reasons({ layout: "banner" }), ["/layout:INVALID"]);
  assert.deepEqual(reasons({ layout: "" }), ["/layout:INVALID"]);
});

test("外观三种：自动（默认，在前）、卡片、横条", () => {
  assert.deepEqual([...EMBED_LAYOUTS], ["auto", "card", "bar"]);
});

test("嵌入码写法和合作网站要放的代码", () => {
  assert.match("nze_" + "A".repeat(32), EMBED_KEY_FORMAT);
  assert.doesNotMatch("nze_" + "A".repeat(31), EMBED_KEY_FORMAT);
  const snippet = embedSnippet("https://nozomi.moveglobal.io", "nze_" + "A".repeat(32), "ja", ["transfer", "charter"]);
  assert.match(snippet, /<script src="https:\/\/nozomi\.moveglobal\.io\/embed\/widget-v1\.js" defer><\/script>/);
  assert.match(snippet, /NozomiBooking\.init\(\{ key: "nze_A{32}", root: "#nozomi-booking", lang: "ja", services: \["transfer","charter"\] \}\);/);
  // 外观不写进代码（M9E-14）：组件从配置里取，后台改了不用合作网站改代码
  assert.doesNotMatch(snippet, /layout/);
});

const KEY = "nze_" + "A".repeat(32);
const SITE = "https://nozomi.moveglobal.io";
const BOOKING = `${DEMO}/booking/`;

test("预订页地址（M9E-26）：https、同源带路径，规范化（主机名小写、去默认端口），保留查询和 #；本机 http 只在测试类环境收", () => {
  const allowed = [DEMO, "https://other.example"];
  const check = (value: string) => embedBookingUrlCheck(value, allowed, PROD);
  assert.deepEqual(check(BOOKING), { url: BOOKING });
  assert.deepEqual(check("  https://EMBED-demo.moveglobal.io:443/booking/?a=1#top  "), { url: `${DEMO}/booking/?a=1#top` });
  assert.deepEqual(check("https://other.example/ja/booking"), { url: "https://other.example/ja/booking" });
  assert.deepEqual(check(DEMO), { url: `${DEMO}/` }, "只写到域名也算（预订页就是首页）");
  for (const bad of ["http://embed-demo.moveglobal.io/booking/", "https://u:p@embed-demo.moveglobal.io/booking/", "//embed-demo.moveglobal.io/booking/", "/booking/", "javascript:alert(1)", "https://*.moveglobal.io/booking/", "https://embed-demo.moveglobal.io/boo king/", "ftp://embed-demo.moveglobal.io/"]) {
    assert.deepEqual(check(bad), { reason: "INVALID" }, bad);
  }
  for (const outside of ["https://embed-demo.moveglobal.io.evil.example/booking/", "https://moveglobal.io/booking/", "https://www.embed-demo.moveglobal.io/booking/", "https://embed-demo.moveglobal.io:8443/booking/", "https://evil.example/?u=https://embed-demo.moveglobal.io/booking/"]) {
    assert.deepEqual(check(outside), { reason: "NOT_ALLOWED_ORIGIN" }, outside);
  }
  assert.deepEqual(embedBookingUrlCheck("http://localhost:4174/booking/", ["http://localhost:4174"], PROD), { reason: "INVALID" });
  assert.deepEqual(embedBookingUrlCheck("http://localhost:4174/booking/", ["http://localhost:4174"], TEST), { url: "http://localhost:4174/booking/" });
  const base = `${DEMO}/`;
  assert.deepEqual(check(base + "a".repeat(2_000 - base.length)), { url: base + "a".repeat(2_000 - base.length) }, "正好 2,000 字符");
  assert.deepEqual(check(base + "a".repeat(2_001 - base.length)), { reason: "OUT_OF_RANGE" }, "2,001 字符");
  assert.equal(normalizeEmbedBookingUrl("", PROD), null);
  // 原文不到 2,000，百分号编码后超了：算太长（OUT_OF_RANGE），不算写法不对
  const encoded = `${base}${"あ".repeat(400)}`;
  assert.ok(encoded.length <= 2_000 && new URL(encoded).href.length > 2_000);
  assert.deepEqual(check(encoded), { reason: "OUT_OF_RANGE" });
  assert.equal(normalizeEmbedBookingUrl(encoded, PROD), null);
});

test("预订页地址和白名单的国际化域名（M9E-26）：两边写中文 / 日文域名或 punycode 都按 punycode 比，对得上", () => {
  const unicodeList = embedKeyIssues({ name: "x", allowed_origins: ["https://例え.jp"], default_lang: "ja", default_services: ["transfer"], booking_url: "https://xn--r8jz45g.jp/booking/", note: null }, PROD);
  assert.deepEqual(unicodeList, { issues: [], origins: ["https://xn--r8jz45g.jp"], bookingUrl: "https://xn--r8jz45g.jp/booking/" }, "白名单写中文域名、预订页写 punycode");
  const punyList = embedKeyIssues({ name: "x", allowed_origins: ["https://xn--r8jz45g.jp"], default_lang: "ja", default_services: ["transfer"], booking_url: "https://例え.jp/booking/", note: null }, PROD);
  assert.deepEqual(punyList, { issues: [], origins: ["https://xn--r8jz45g.jp"], bookingUrl: "https://xn--r8jz45g.jp/booking/" }, "白名单写 punycode、预订页写中文域名");
  assert.deepEqual(embedBookingUrlCheck("https://例え.jp/booking/", ["https://xn--r8jz45g.jp"], PROD), { url: "https://xn--r8jz45g.jp/booking/" });
  assert.deepEqual(embedBookingUrlCheck("https://例え.com/booking/", ["https://xn--r8jz45g.jp"], PROD), { reason: "NOT_ALLOWED_ORIGIN" }, "顶级域不同");
});

test("嵌入码校验带预订页地址（M9E-26）：按这次提交的白名单核对；白名单本身不对时只报白名单", () => {
  const input = { name: "演示站", allowed_origins: [DEMO], default_lang: "ja", default_services: ["transfer"], note: null };
  assert.deepEqual(embedKeyIssues({ ...input, booking_url: "https://Embed-Demo.moveglobal.io/booking/" }, PROD), { issues: [], origins: [DEMO], bookingUrl: BOOKING });
  assert.equal(embedKeyIssues({ ...input, booking_url: null }, PROD).bookingUrl, null);
  assert.deepEqual(embedKeyIssues({ ...input, booking_url: "   " }, PROD), { issues: [], origins: [DEMO], bookingUrl: null }, "空白 = 没填");
  assert.equal(embedKeyIssues(input, PROD).bookingUrl, null, "不填 = 没有");
  const reasons = (changes: Record<string, unknown>) => embedKeyIssues({ ...input, ...changes } as typeof input, PROD).issues.map((issue) => `${issue.path}:${issue.reason}`);
  assert.deepEqual(reasons({ booking_url: "https://other.example/booking/" }), ["/booking_url:NOT_ALLOWED_ORIGIN"]);
  assert.deepEqual(reasons({ booking_url: "http://embed-demo.moveglobal.io/booking/" }), ["/booking_url:INVALID"]);
  // 改白名单：拿掉了预订页的网站、预订页地址没跟着改 → 不让保存
  assert.deepEqual(reasons({ allowed_origins: ["https://other.example"], booking_url: BOOKING }), ["/booking_url:NOT_ALLOWED_ORIGIN"]);
  assert.deepEqual(reasons({ allowed_origins: ["https://other.example"], booking_url: null }), []);
  assert.deepEqual(reasons({ allowed_origins: ["https://other.example", DEMO], booking_url: BOOKING }), []);
  assert.deepEqual(reasons({ allowed_origins: ["bad"], booking_url: BOOKING }), ["/allowed_origins/0:INVALID"]);
  assert.deepEqual(reasons({ allowed_origins: [], booking_url: BOOKING }), ["/allowed_origins:REQUIRED"]);
});

test("两段代码（M9E-26）：填了预订页地址、开了整页嵌入、地址在白名单里才有②，①带 bookingUrl", () => {
  const key = { key: KEY, lang: "ja" as const, services: ["transfer", "charter"] as const, allowedOrigins: [DEMO], allowHostPage: true, bookingUrl: BOOKING as string | null };
  const both = embedSnippets(SITE, key);
  assert.equal(both.fallback, null);
  assert.equal(
    both.entry,
    [
      '<div id="nozomi-booking"></div>',
      '<script src="https://nozomi.moveglobal.io/embed/widget-v1.js" defer></script>',
      "<script>",
      '  window.addEventListener("DOMContentLoaded", function () {',
      `    NozomiBooking.init({ key: "${KEY}", root: "#nozomi-booking", lang: "ja", services: ["transfer","charter"], bookingUrl: "https://embed-demo.moveglobal.io/booking/" });`,
      "  });",
      "</script>",
    ].join("\n"),
  );
  assert.equal(
    both.booking,
    [
      '<div id="nozomi-booking-flow"></div>',
      '<script src="https://nozomi.moveglobal.io/embed/widget-v1.js" defer></script>',
      "<script>",
      '  window.addEventListener("DOMContentLoaded", function () {',
      `    NozomiBooking.mountBooking({ key: "${KEY}", root: "#nozomi-booking-flow", lang: "ja" });`,
      "  });",
      "</script>",
    ].join("\n"),
  );
  // 兜底：只有①，①和以前逐字一样（不带 bookingUrl，客人照旧跳主站）
  const legacy = embedSnippet(SITE, KEY, "ja", ["transfer", "charter"]);
  const cases: [Partial<typeof key>, string][] = [
    [{ bookingUrl: null }, "no_booking_url"],
    [{ allowHostPage: false }, "host_page_off"],
    [{ bookingUrl: null, allowHostPage: false }, "no_booking_url"],
    [{ allowedOrigins: ["https://other.example"] }, "booking_url_not_allowed"],
    [{ bookingUrl: "not a url" }, "booking_url_not_allowed"],
  ];
  for (const [changes, fallback] of cases) {
    const only = embedSnippets(SITE, { ...key, ...changes });
    assert.deepEqual(only, { entry: legacy, booking: null, fallback }, JSON.stringify(changes));
    assert.doesNotMatch(only.entry, /bookingUrl/);
  }
  assert.deepEqual([...EMBED_SNIPPET_FALLBACKS], ["no_booking_url", "host_page_off", "booking_url_not_allowed"]);
});

test("①里的 bookingUrl 按 JS 字符串转义，地址里有引号或 </script> 也跳不出 <script>", () => {
  const entry = embedSnippet(SITE, KEY, "zh", ["charter"], 'https://a.example/b?q="</script><script>alert(1)</script>');
  assert.ok(entry.includes('bookingUrl: "https://a.example/b?q=\\"\\u003c/script>\\u003cscript>alert(1)\\u003c/script>" });'), entry);
  assert.equal(entry.split("</script>").length - 1, 2, "只有两处 </script>：引脚本那行和结尾");
});
