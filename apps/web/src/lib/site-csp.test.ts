/**
 * 官网页面的内容安全策略（M3-08，ADR 0046）：只有 `/book` 和它下面的页面放行 Stripe.js 必需的来源，别的页面一个都不放；
 * 放行的来源恰好是 Stripe 官方文档里本站用得到的那几个；Stripe.js 的地址在放行范围里；路径前缀和前端路由一致。
 * 生成的 Caddy 片段由 apps/api/src/deploy-web.test.ts 核对，浏览器里的效果由 e2e/security.spec.ts、e2e/site-payment.spec.ts 核对。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { SITE_PAGE_PREFIX, STRIPE_CSP_SOURCES, contentSecurityPolicy, isSitePagePath } from "../../build/edge-config.ts";
import { EXTERNAL_SCRIPTS } from "./external-scripts.ts";
import { SITE_CHECKOUT_PATH, SITE_HOME_PATH, SITE_ORDER_PATH } from "./site-display.ts";

const HASH = `sha256-${"A".repeat(43)}=`;

function directives(policy: string): Map<string, string> {
  return new Map(policy.split("; ").map((part) => [part.slice(0, part.indexOf(" ")), part.slice(part.indexOf(" ") + 1)]));
}

test("官网页面的路径前缀就是前端路由的 /book；前缀本身、下面的页面、带查询串（从银行验证页回来）都算，长得像的不算", () => {
  assert.equal(SITE_PAGE_PREFIX, SITE_HOME_PATH);
  for (const path of [SITE_HOME_PATH, SITE_CHECKOUT_PATH, SITE_ORDER_PATH, `${SITE_ORDER_PATH}?payment_intent=pi_1&redirect_status=succeeded`, "/book/", "/book?x=1", "/book/order#nzo_x"]) assert.equal(isSitePagePath(path), true, path);
  for (const path of ["/", "/login", "/platform", "/platform/login", "/bookx", "/books/order", "/platform/book", "/assets/book.js", "/driver/abc", "/site/v1/config"]) assert.equal(isSitePagePath(path), false, path);
});

test("放行付款的那一条：只在 script-src、connect-src 上加 Stripe，另加 frame-src；其余指令和普通页面完全一样", () => {
  const plain = directives(contentSecurityPolicy([HASH], ["https://tiles.example.com"]));
  const site = directives(contentSecurityPolicy([HASH], ["https://tiles.example.com"], { payments: true }));
  assert.equal(site.get("script-src"), `'self' '${HASH}' https://js.stripe.com https://*.js.stripe.com`);
  assert.equal(site.get("connect-src"), "'self' https://api.stripe.com");
  assert.equal(site.get("frame-src"), "https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com");
  assert.equal(plain.get("frame-src"), undefined, "普通页面的 iframe 只按 default-src 'self'");
  for (const [name, value] of plain) if (name !== "script-src" && name !== "connect-src") assert.equal(site.get(name), value, name);
  assert.deepEqual([...site.keys()].filter((name) => !plain.has(name)), ["frame-src"]);
  assert.equal(site.get("frame-ancestors"), "'none'", "本站页面仍不许被别人嵌入");
  assert.equal(site.get("form-action"), "'self'");
  assert.ok(!/unsafe-inline|unsafe-eval|data:|blob:/.test(contentSecurityPolicy([HASH], [], { payments: true })));
  assert.ok(!/stripe/.test(contentSecurityPolicy([HASH])), "默认（两个后台、登录页）不放行 Stripe");
});

test("Stripe 的来源只有官方文档里的这几个，都是 https 的 stripe.com 子域；Stripe.js 的地址在 script-src 的放行范围里", () => {
  const all = [...STRIPE_CSP_SOURCES.script, ...STRIPE_CSP_SOURCES.frame, ...STRIPE_CSP_SOURCES.connect];
  for (const source of all) assert.match(source, /^https:\/\/(\*\.)?[a-z.]*stripe\.com$/, source);
  assert.deepEqual([...new Set(all)].sort(), ["https://*.js.stripe.com", "https://api.stripe.com", "https://hooks.stripe.com", "https://js.stripe.com"]);
  assert.ok(STRIPE_CSP_SOURCES.script.includes(new URL(EXTERNAL_SCRIPTS.stripe).origin as "https://js.stripe.com"));
});
