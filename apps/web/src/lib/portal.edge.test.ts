/**
 * 登录后回跳地址的边界情况（开放重定向）与路由前缀的边界。
 * 判断「会不会跳到站外」用的是浏览器自己的 URL 解析规则（WHATWG URL），不是字符串前缀。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isApiPath } from "./api-prefixes.ts";
import { PORTALS, type Portal, portalOfPath, safeReturnPath } from "./portal.ts";

const SITE = "https://console.nozomi.example";

/** 浏览器把这个回跳地址解析到哪个站点。 */
function originOf(target: string): string {
  return new URL(target, `${SITE}/login`).origin;
}

const OFF_SITE_CANDIDATES: readonly string[] = [
  "https://evil.example/",
  "http://evil.example",
  "//evil.example",
  "//evil.example/account/password",
  "///evil.example",
  "/\\evil.example",
  "\\\\evil.example",
  "/\\/evil.example",
  "javascript:alert(1)",
  "JaVaScRiPt:alert(1)",
  " javascript:alert(1)",
  "data:text/html,<script>alert(1)</script>",
  "vbscript:msgbox(1)",
  "mailto:someone@evil.example",
  "evil.example",
  "@evil.example",
  "https:evil.example",
  "\t//evil.example",
  " //evil.example",
];

test("回跳地址：站外地址、协议地址、相对地址一律回本后台首页", () => {
  for (const portal of ["tenant", "platform"] as const) {
    for (const candidate of OFF_SITE_CANDIDATES) {
      assert.equal(safeReturnPath(portal, candidate), PORTALS[portal].paths.home, `${portal}: ${JSON.stringify(candidate)}`);
    }
  }
});

test("回跳地址：不是字符串的值（对象、数组、数字、布尔）一律回首页，不抛错", () => {
  for (const candidate of [undefined, null, 0, 1, true, {}, [], ["/account/password"], { toString: () => "//evil.example" }, Symbol("x")]) {
    assert.equal(safeReturnPath("tenant", candidate), "/");
    assert.equal(safeReturnPath("platform", candidate), "/platform");
  }
});

test("回跳地址：凡是放行的，浏览器解析后都还在本站", () => {
  const candidates = [
    ...OFF_SITE_CANDIDATES,
    "/account/password",
    "/account/password?next=//evil.example",
    "/account/password#//evil.example",
    "/%2F%2Fevil.example",
    "/%5Cevil.example",
    "/%09/evil.example",
    "/.//evil.example",
    "/..//evil.example",
    "/platform/..//evil.example",
    "/platform//evil.example",
    "/@evil.example",
    "/:evil.example",
    "/https://evil.example",
    "/?//evil.example",
  ];
  for (const portal of ["tenant", "platform"] as const) {
    for (const candidate of candidates) {
      const allowed = safeReturnPath(portal, candidate);
      assert.equal(originOf(allowed), SITE, `${portal}: ${JSON.stringify(candidate)} 被放行为 ${JSON.stringify(allowed)}，浏览器会跳到 ${originOf(allowed)}`);
    }
  }
});

test("【缺陷】回跳地址：浏览器解析网址时会去掉制表符和换行，「/<Tab>/evil.example」等于「//evil.example」，必须挡掉", () => {
  for (const candidate of ["/\t/evil.example", "/\n/evil.example", "/\r/evil.example", "/\r\n/evil.example/account/password", "/\t\\evil.example"]) {
    assert.notEqual(originOf(candidate), SITE, `前提：浏览器确实会把 ${JSON.stringify(candidate)} 解析到站外`);
    for (const portal of ["tenant", "platform"] as const) {
      const allowed = safeReturnPath(portal, candidate);
      assert.equal(originOf(allowed), SITE, `${portal}: ${JSON.stringify(candidate)} 被放行，浏览器会跳到 ${originOf(allowed)}`);
    }
  }
});

test("回跳地址：只回本后台的页面；登录、接受邀请、重设密码这些不需要登录的页面不回跳（带参数、带 # 也一样）", () => {
  const cases: [Portal, string, string][] = [
    ["tenant", "/login?x=1", "/"],
    ["tenant", "/login#x", "/"],
    ["tenant", "/accept-invite#token=abc", "/"],
    ["tenant", "/reset-password?token=abc", "/"],
    ["tenant", "/platform/account/password", "/"],
    ["tenant", "/platform?x=1", "/"],
    ["platform", "/platform/login?x=1", "/platform"],
    ["platform", "/platform/reset-password#token=abc", "/platform"],
    ["platform", "/", "/platform"],
    ["platform", "/login", "/platform"],
    ["platform", "/platformx", "/platform"],
    ["tenant", "/platformx", "/platformx"],
    ["tenant", "/account/password?tab=1#top", "/account/password?tab=1#top"],
    ["platform", "/platform/no-such-page", "/platform/no-such-page"],
  ];
  for (const [portal, candidate, expected] of cases) {
    assert.equal(safeReturnPath(portal, candidate), expected, `${portal}: ${candidate}`);
  }
});

test("路径归哪个后台：相似前缀、带点的路径、空路径", () => {
  assert.equal(portalOfPath("/platform/"), "platform");
  assert.equal(portalOfPath("/platform-admin"), "tenant");
  assert.equal(portalOfPath("/platform.html"), "tenant");
  assert.equal(portalOfPath(""), "tenant");
});

test("API 前缀：只按整段路径匹配，相似的前端路径不会被当成接口", () => {
  for (const path of ["/platform/v1", "/platform/v1/", "/platform/v1/auth/me", "/tenant/v1/x", "/sales/v1", "/webhooks/stripe", "/health"]) {
    assert.equal(isApiPath(path), true, path);
  }
  for (const path of ["/", "/platform", "/platform/", "/platform/v10", "/platform/v1x", "/platform/v2", "/tenant", "/tenant/v", "/healthz", "/health-check", "/webhooksx", "/sales", "/login", "/account/password"]) {
    assert.equal(isApiPath(path), false, path);
  }
});
