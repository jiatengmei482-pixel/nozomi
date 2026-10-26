/**
 * 第三方密钥（M4-09，ADR 0041）的补充单元测试（测试角色）：打码不泄露长度、后台填写的写法的边界、
 * 测试用的服务地址在 staging / production 不能改（包括看起来像官方地址的各种写法）。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { adminSecretFormatIssue, googleMapsKeyIssues, loadConfig, maskLast4 } from "./index.ts";

const base = { DATABASE_URL: "postgres://app:pw@localhost:5432/nozomi", AUTH_JWT_SECRET: "x".repeat(40) };
const DEFAULT_ROUTES = "https://routes.googleapis.com/directions/v2:computeRoutes";

test("打码不泄露长度：0–300 个字符的值，打码后只有两种样子（4 个圆点，或 4 个圆点 + 末 4 位），长度和原值无关", () => {
  for (let length = 0; length <= 300; length++) {
    const value = "a".repeat(Math.max(0, length - 4)) + "WXYZ".slice(Math.max(0, 4 - length));
    const masked = maskLast4(value.slice(0, length));
    assert.ok(masked === "••••" || masked === "••••WXYZ", `${length} 个字符：${masked}`);
  }
  for (const short of ["abcd", "abcde", "x".repeat(15)]) assert.equal(maskLast4(short), "••••", `${short.length} 个字符只有圆点`);
});

test("后台填写的写法：恰好 20 和 255 个字符收，19 和 256 不收；中间的空白、全角、零宽字符、非 ASCII 字母都是 FORMAT", () => {
  assert.equal(adminSecretFormatIssue("api_key", "a".repeat(20)), null);
  assert.equal(adminSecretFormatIssue("api_key", "a".repeat(255)), null);
  assert.deepEqual(adminSecretFormatIssue("api_key", "a".repeat(19)), { field: "api_key", reason: "TOO_SHORT" });
  assert.deepEqual(adminSecretFormatIssue("api_key", "a".repeat(256)), { field: "api_key", reason: "TOO_LONG" });
  const key = "AIzaSyQaQaQaQaQaQaQaQaQaQaQaQaQaQaQaQaQ";
  for (const bad of [`${key.slice(0, 9)} ${key.slice(9)}`, `${key}\n`, `　${key}`, `${key}​`, key.replace("Q", "Ｑ"), key.replace("a", "а"), `${key}é`]) {
    assert.deepEqual(googleMapsKeyIssues(bad), [{ field: "api_key", reason: "FORMAT" }], JSON.stringify(bad));
  }
});

test("测试用的服务地址：staging / production 只认官方地址原样；改个大小写、加斜杠、加查询串、用户信息骗局、换成 http 都拒绝；Stripe 的地址给什么都拒绝", () => {
  for (const env of ["staging", "production"] as const) {
    const extra = env === "production" ? { AUTH_JWT_SECRET: "x".repeat(64), DATA_ENCRYPTION_KEY: "k".repeat(40) } : {};
    assert.equal(loadConfig({ ...base, ...extra, APP_ENV: env, GOOGLE_MAPS_ROUTES_URL: DEFAULT_ROUTES }).integrationEndpoints.googleMapsRoutesUrl, DEFAULT_ROUTES, `${env}：原样写官方地址可以`);
    const variants = [
      `${DEFAULT_ROUTES}/`,
      DEFAULT_ROUTES.replace("routes.googleapis.com", "ROUTES.googleapis.com"),
      `${DEFAULT_ROUTES}?key=x`,
      DEFAULT_ROUTES.replace("https://", "http://"),
      DEFAULT_ROUTES.replace("routes.googleapis.com", "routes.googleapis.com@evil.example"),
      DEFAULT_ROUTES.replace("routes.googleapis.com", "routes.googleapis.com.evil.example"),
      "https://evil.example/directions/v2:computeRoutes",
    ];
    for (const url of variants) {
      assert.throws(() => loadConfig({ ...base, ...extra, APP_ENV: env, GOOGLE_MAPS_ROUTES_URL: url }), /GOOGLE_MAPS_ROUTES_URL/, `${env} ${url}`);
    }
    for (const url of ["https://api.stripe.com", "https://api.stripe.com:443", "http://127.0.0.1:12111"]) {
      assert.throws(() => loadConfig({ ...base, ...extra, APP_ENV: env, STRIPE_API_URL: url }), /STRIPE_API_URL/, `${env} ${url}`);
    }
  }
});
