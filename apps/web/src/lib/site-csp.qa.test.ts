/**
 * M3-08 测试角色补充：哪些路径放行 Stripe（ADR 0046）。`isSitePagePath` 决定 vite preview（端到端测试）给哪条策略，正式环境由 Caddy 的 path 匹配器决定；
 * 两边必须一致，否则端到端测试验证的就不是正式环境的行为。真实 Caddy 上的核对在 apps/api/src/deploy-web-csp-paths.qa.test.ts。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { MAPS_PICKER_PATH, contentSecurityPolicy, isMapsPickerPath, isSitePagePath, renderEdgeConfig } from "../../build/edge-config.ts";

const HASH = `sha256-${"A".repeat(43)}=`;

test("放行：/book、结尾斜杠、下面的页面、带查询串和 #", () => {
  for (const path of ["/book", "/book/", "/book/order", "/book/order/", "/book/checkout", "/book/new", "/book/new?from=NRT&date=2030-11-20", "/book/order?payment_intent=pi_1&redirect_status=failed", "/book?next=/platform", "/book/order#nzo_x"]) assert.equal(isSitePagePath(path), true, path);
});

test("不放行：长得像的、前缀在后面的、查询串和 # 里才有 /book 的、编码绕到后台的", () => {
  for (const path of [
    "/",
    "/bookx",
    "/books/order",
    "/book.html",
    "/book%20",
    "/book;x",
    "/book-order",
    "/platform/book",
    "/login/book/order",
    "/assets/book/x.js",
    "/login?next=/book",
    "/platform?x=/book/order",
    "/platform#/book",
    "/platform/..%2Fbook",
    "/login/..%2Fbook",
    "/platform%2F..%2Fbook",
    "",
  ]) assert.equal(isSitePagePath(path), false, path);
});

test("路径大小写和前端路由、Caddy 一致：/Book/order 前端照样渲染订单页、Caddy 放行，vite preview 也要放行", () => {
  for (const path of ["/Book", "/BOOK/order", "/Book/order"]) assert.equal(isSitePagePath(path), true, path);
});

test("Caddy 片段：恰好四条策略（M9E-16 嵌入预订页、M10-01 地图小页面各一条）；放行 Stripe 的只有官网和嵌入预订页；这三条都没有 unsafe-*、data:、blob:、裸通配符和 http 来源；Stripe 之外不多放一个站外来源", () => {
  const html = '<!doctype html><html><head><script>1</script></head></html>';
  const lines = renderEdgeConfig(html).split("\n");
  const policies = lines.filter((line) => line.includes("Content-Security-Policy"));
  assert.equal(policies.length, 4);
  assert.equal(policies.filter((line) => line.startsWith("header @maps_picker_pages ")).length, 1);
  const site = policies.find((line) => line.startsWith("header @site_pages ")) ?? "";
  const other = policies.find((line) => line.startsWith("header @other_pages ")) ?? "";
  const embed = policies.find((line) => line.startsWith("\t\theader Content-Security-Policy ")) ?? "";
  assert.match(site, /js\.stripe\.com/);
  assert.match(embed, /js\.stripe\.com/);
  assert.doesNotMatch(other, /stripe/);
  for (const policy of [site, other, embed, contentSecurityPolicy([HASH], [], { payments: true }), contentSecurityPolicy([HASH])]) {
    assert.doesNotMatch(policy, /unsafe-|data:|blob:|http:|\s\*(\s|;|")/, policy);
    const hosts = [...policy.matchAll(/https:\/\/([^\s;"]+)/g)].map((match) => match[1] ?? "");
    for (const host of hosts) assert.ok(host.endsWith("stripe.com"), host);
  }
});

test("地图小页面（M10-01 第 2 处）：只有 /maps/picker.html（可带查询串）用放宽的策略，大小写、前后缀、编码绕过的都不算；放宽的只有谷歌的来源，只许同源嵌入、不能提交表单；官网页面只多放行同源 iframe", () => {
  for (const path of [MAPS_PICKER_PATH, `${MAPS_PICKER_PATH}?key=AIza&lat=35.6`]) assert.equal(isMapsPickerPath(path), true, path);
  for (const path of ["/maps/picker.htm", "/maps/pickerXhtml", "/Maps/picker.html", "/x/maps/picker.html", "/maps/picker.html/x", "/maps/../maps/picker.html", "/maps/picker%2Ehtml", "/book/new", "/maps/picker.html#x"]) assert.equal(isMapsPickerPath(path), false, path);
  const lines = renderEdgeConfig('<!doctype html><html><head><script>1</script></head></html>').split("\n");
  const picker = lines.find((line) => line.startsWith("header @maps_picker_pages ")) ?? "";
  assert.match(picker, /frame-ancestors 'self'/);
  assert.match(picker, /form-action 'none'/);
  assert.doesNotMatch(picker, /stripe|http:/);
  const hosts = [...picker.matchAll(/https:\/\/([^\s;"]+)/g)].map((match) => match[1] ?? "");
  for (const host of hosts) assert.ok(/(^|\.)(googleapis|gstatic|google|googleusercontent)\.com$/.test(host), host);
  assert.ok(lines.some((line) => line.startsWith("@other_pages ") && line.includes("/maps/picker")), "普通页面的匹配器排除地图小页面，每个响应恰好一条策略");
});
