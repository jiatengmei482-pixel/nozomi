import { test } from "node:test";
import assert from "node:assert/strict";
import { EMBED_KEY_FORMAT, EMBED_LAYOUTS, embedKeyIssues, embedOriginAllowed, embedReturnUrl, embedSnippet, normalizeEmbedOrigin } from "./embed.ts";

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
  assert.deepEqual(embedKeyIssues(input, PROD), { issues: [], origins: [DEMO] });
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
