import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, NetworkError, acceptInvite, changePassword, fetchMe, login, logout, parseRetryAfter } from "./client.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

interface Seen {
  url: string;
  init: RequestInit;
}

function stubFetch(respond: () => Response | Promise<Response>): Seen[] {
  const seen: Seen[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), init: init ?? {} });
    return respond();
  }) as typeof fetch;
  return seen;
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

test("登录：相对路径、POST、JSON 请求体，不带令牌和 Cookie", async () => {
  const seen = stubFetch(() => json(200, { access_token: "t", token_type: "Bearer", expires_at: "2026-01-01T08:00:00.000Z" }));
  await login("tenant", { email: "a@b.co", password: "x" });
  await login("platform", { email: "a@b.co", password: "x" });
  assert.deepEqual(seen.map((call) => call.url), ["/tenant/v1/auth/login", "/platform/v1/auth/login"]);
  const first = seen[0]?.init;
  assert.equal(first?.method, "POST");
  assert.equal(first?.body, JSON.stringify({ email: "a@b.co", password: "x" }));
  assert.equal(first?.credentials, "omit");
  const headers = first?.headers as Record<string, string>;
  assert.equal(headers["content-type"], "application/json");
  assert.equal("authorization" in headers, false);
});

test("需要登录的接口把令牌放在 Authorization: Bearer 里", async () => {
  const seen = stubFetch(() => json(200, { user: {}, permissions: [] }));
  await fetchMe("platform", "abc.def");
  assert.equal(seen[0]?.url, "/platform/v1/auth/me");
  assert.equal(seen[0]?.init.method, "GET");
  assert.equal((seen[0]?.init.headers as Record<string, string>)["authorization"], "Bearer abc.def");
  assert.equal(seen[0]?.init.body, undefined);
});

test("204 的接口正常返回", async () => {
  const seen = stubFetch(() => new Response(null, { status: 204 }));
  assert.equal(await logout("tenant", "t"), undefined);
  assert.equal(await changePassword("tenant", "t", { current_password: "a", new_password: "b" }), undefined);
  assert.deepEqual(seen.map((call) => call.url), ["/tenant/v1/auth/logout", "/tenant/v1/auth/change-password"]);
});

test("后端的错误应答变成 ApiError，带状态码、错误码、说明和 details", async () => {
  stubFetch(() => json(400, { error: { code: "WEAK_PASSWORD", message: "密码强度不够", details: { issues: [{ code: "X", message: "Y" }] } } }));
  await assert.rejects(acceptInvite("tenant", { token: "t", password: "p" }), (err) => {
    assert.ok(err instanceof ApiError);
    assert.equal(err.status, 400);
    assert.equal(err.code, "WEAK_PASSWORD");
    assert.equal(err.message, "密码强度不够");
    assert.deepEqual(err.details, { issues: [{ code: "X", message: "Y" }] });
    assert.equal(err.retryAfterSeconds, null);
    return true;
  });
});

test("429：等待时间取响应头 Retry-After；没有响应头时取 details.retry_after_seconds", async () => {
  const body = { error: { code: "TOO_MANY_LOGIN_ATTEMPTS", message: "尝试次数过多", details: { retry_after_seconds: 30 } } };
  stubFetch(() => json(429, body, { "retry-after": "840" }));
  await assert.rejects(login("tenant", { email: "a@b.co", password: "x" }), (err) => err instanceof ApiError && err.retryAfterSeconds === 840);
  stubFetch(() => json(429, body));
  await assert.rejects(login("tenant", { email: "a@b.co", password: "x" }), (err) => err instanceof ApiError && err.retryAfterSeconds === 30);
});

test("应答不是约定的错误格式（比如代理返回的 502 页面）时仍是 ApiError，不带后端说明", async () => {
  stubFetch(() => new Response("<html>Bad Gateway</html>", { status: 502 }));
  await assert.rejects(fetchMe("tenant", "t"), (err) => err instanceof ApiError && err.status === 502 && err.message === "" && err.code === "UNKNOWN");
});

test("没拿到应答（断网、超时被中止）是 NetworkError", async () => {
  stubFetch(() => {
    throw new TypeError("fetch failed");
  });
  await assert.rejects(fetchMe("tenant", "t"), NetworkError);
});

test("成功应答却不是 JSON 时按服务端错误处理", async () => {
  stubFetch(() => new Response("<html></html>", { status: 200 }));
  await assert.rejects(fetchMe("tenant", "t"), (err) => err instanceof ApiError && err.status === 502);
});

test("登录应答没有可用的令牌或过期时间不合法：按服务端错误处理，不当作登录成功", async () => {
  const good = { access_token: "t", token_type: "Bearer", expires_at: "2026-01-01T08:00:00.000Z", user: {} };
  for (const body of [{}, { ...good, access_token: "" }, { ...good, access_token: 1 }, { ...good, expires_at: "明天" }, { ...good, expires_at: null }, null, []]) {
    stubFetch(() => json(200, body));
    await assert.rejects(login("platform", { email: "a@b.co", password: "x" }), (err) => err instanceof ApiError && err.status === 502, JSON.stringify(body));
  }
  stubFetch(() => json(200, good));
  assert.equal((await login("platform", { email: "a@b.co", password: "x" })).access_token, "t");
});

test("Retry-After 支持秒数和 HTTP 日期", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  assert.equal(parseRetryAfter(null, now), null);
  assert.equal(parseRetryAfter("120", now), 120);
  assert.equal(parseRetryAfter(" 7 ", now), 7);
  assert.equal(parseRetryAfter("Thu, 01 Jan 2026 00:01:30 GMT", now), 90);
  assert.equal(parseRetryAfter("Thu, 01 Jan 2025 00:00:00 GMT", now), 0);
  assert.equal(parseRetryAfter("soon", now), null);
});
