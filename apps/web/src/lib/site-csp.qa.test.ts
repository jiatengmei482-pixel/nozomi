/**
 * M3-08 测试角色补充：哪些路径放行 Stripe（ADR 0046）。`isSitePagePath` 决定 vite preview（端到端测试）给哪条策略，正式环境由 Caddy 的 path 匹配器决定；
 * 两边必须一致，否则端到端测试验证的就不是正式环境的行为。真实 Caddy 上的核对在 apps/api/src/deploy-web-csp-paths.qa.test.ts。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { contentSecurityPolicy, isSitePagePath, renderEdgeConfig } from "../../build/edge-config.ts";

const HASH = `sha256-${"A".repeat(43)}=`;

test("放行：/book、结尾斜杠、下面的页面、带查询串和 #", () => {
  for (const path of ["/book", "/book/", "/book/order", "/book/order/", "/book/checkout", "/book/order?payment_intent=pi_1&redirect_status=failed", "/book?next=/platform", "/book/order#nzo_x"]) assert.equal(isSitePagePath(path), true, path);
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

test("Caddy 片段：恰好两条策略；放行 Stripe 的那条只挂在官网匹配器上；两条都没有 unsafe-*、data:、blob:、裸通配符和 http 来源；Stripe 之外不多放一个站外来源", () => {
  const html = '<!doctype html><html><head><script>1</script></head></html>';
  const lines = renderEdgeConfig(html).split("\n");
  const policies = lines.filter((line) => line.includes("Content-Security-Policy"));
  assert.equal(policies.length, 2);
  const site = policies.find((line) => line.startsWith("header @site_pages ")) ?? "";
  const other = policies.find((line) => line.startsWith("header @other_pages ")) ?? "";
  assert.match(site, /js\.stripe\.com/);
  assert.doesNotMatch(other, /stripe/);
  for (const policy of [site, other, contentSecurityPolicy([HASH], [], { payments: true }), contentSecurityPolicy([HASH])]) {
    assert.doesNotMatch(policy, /unsafe-|data:|blob:|http:|\s\*(\s|;|")/, policy);
    const hosts = [...policy.matchAll(/https:\/\/([^\s;"]+)/g)].map((match) => match[1] ?? "");
    for (const host of hosts) assert.ok(host.endsWith("stripe.com"), host);
  }
});
