/**
 * 接口客户端的边界情况：超时、Retry-After 的各种写法、不合约定的应答、令牌只走请求头。
 */
import { afterEach, mock, test } from "node:test";
import assert from "node:assert/strict";
import { throttledText } from "../lib/failure.ts";
import {
  AUTH_ENDPOINTS,
  ApiError,
  NetworkError,
  REQUEST_TIMEOUT_MS,
  acceptInvite,
  changePassword,
  fetchMe,
  login,
  logout,
  parseRetryAfter,
  resetPassword,
} from "./client.ts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  mock.timers.reset();
});

interface Seen {
  url: string;
  init: RequestInit;
}

function stubFetch(respond: (init: RequestInit) => Response | Promise<Response>): Seen[] {
  const seen: Seen[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    seen.push({ url: String(input), init: init ?? {} });
    return respond(init ?? {});
  }) as typeof fetch;
  return seen;
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

/** 一个永远等不到应答的请求；被中止时按浏览器的行为抛 AbortError。 */
function neverResponds(init: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
  });
}

type Outcome = { state: "pending" } | { state: "resolved" } | { state: "rejected"; error: unknown };

function track(promise: Promise<unknown>): { current(): Outcome } {
  let outcome: Outcome = { state: "pending" };
  promise.then(
    () => {
      outcome = { state: "resolved" };
    },
    (error: unknown) => {
      outcome = { state: "rejected", error };
    },
  );
  return { current: () => outcome };
}

const settle = async (): Promise<void> => {
  for (let round = 0; round < 20; round += 1) await Promise.resolve();
};

test("超时：规范写的是 10 秒", () => {
  assert.equal(REQUEST_TIMEOUT_MS, 10_000);
});

test("超时：10 秒没有应答就中止请求并按网络错误处理；不到 10 秒不放弃", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  stubFetch(neverResponds);
  const result = track(login("tenant", { email: "a@b.co", password: "x" }));

  mock.timers.tick(REQUEST_TIMEOUT_MS - 1);
  await settle();
  assert.equal(result.current().state, "pending", "差 1 毫秒到 10 秒时还在等");

  mock.timers.tick(1);
  await settle();
  const outcome = result.current();
  assert.equal(outcome.state, "rejected");
  assert.ok(outcome.state === "rejected" && outcome.error instanceof NetworkError);
});

test("超时：每个接口都带中止信号", async () => {
  const seen = stubFetch(() => new Response(null, { status: 204 }));
  await logout("tenant", "t");
  await changePassword("platform", "t", { current_password: "a", new_password: "b" });
  for (const call of seen) assert.ok(call.init.signal instanceof AbortSignal, `${call.url} 没有中止信号，超时后请求不会被放弃`);
});

test("【缺陷】超时：后端发回了响应头、响应体却一直不来，10 秒后也应按网络错误处理，不能永远卡在「提交中」", async () => {
  mock.timers.enable({ apis: ["setTimeout"] });
  stubFetch((init) => {
    const stalledBody = new ReadableStream<Uint8Array>({
      start(controller) {
        init.signal?.addEventListener("abort", () => controller.error(new DOMException("The operation was aborted.", "AbortError")));
      },
    });
    return new Response(stalledBody, { status: 200, headers: { "content-type": "application/json" } });
  });
  const result = track(login("tenant", { email: "a@b.co", password: "x" }));
  await settle(); // 响应头已经到了，客户端开始读响应体

  mock.timers.tick(REQUEST_TIMEOUT_MS + 1);
  await settle();
  // 响应体的读取是真正的异步 I/O，多等几轮事件循环
  for (let round = 0; round < 5 && result.current().state === "pending"; round += 1) await new Promise((resolve) => setImmediate(resolve));

  const outcome = result.current();
  const seenAs = outcome.state === "rejected" ? `rejected: ${outcome.error instanceof Error ? outcome.error.name : String(outcome.error)}` : outcome.state;
  assert.equal(seenAs, "rejected: NetworkError", "响应体迟迟不来时，过了 10 秒请求应该被放弃；否则登录按钮会一直转圈、输入框一直只读");
});

test("令牌只放在 Authorization 请求头里：不进网址、不进请求体；一次性令牌只进请求体", async () => {
  const seen = stubFetch(() => json(200, { user: {} }));
  const accessToken = "ACCESS-TOKEN-VALUE";
  const oneTimeToken = "ONE-TIME-TOKEN-VALUE";
  await fetchMe("tenant", accessToken);
  await logout("platform", accessToken).catch(() => undefined);
  await changePassword("tenant", accessToken, { current_password: "a", new_password: "b" }).catch(() => undefined);
  await acceptInvite("tenant", { token: oneTimeToken, password: "p" });
  await resetPassword("platform", { token: oneTimeToken, password: "p" });

  assert.equal(seen.length, 5);
  for (const call of seen) {
    assert.match(call.url, /^\/(tenant|platform)\/v1\/auth\/[a-z-]+$/, `${call.url} 应是不带参数的相对路径`);
    assert.equal(call.url.includes(accessToken) || call.url.includes(oneTimeToken), false, "令牌进了网址");
    assert.equal(typeof call.init.body === "string" && call.init.body.includes(accessToken), false, "访问令牌进了请求体");
    assert.equal(call.init.credentials, "omit");
    assert.equal(call.init.cache, "no-store");
  }
  const withOneTimeToken = seen.slice(3);
  for (const call of withOneTimeToken) {
    assert.deepEqual(JSON.parse(String(call.init.body)), { token: oneTimeToken, password: "p" });
    assert.equal("authorization" in (call.init.headers as Record<string, string>), false);
  }
});

test("接口清单：只有 auth/me 是 GET，其余都是 POST；路径都以 /auth/ 开头", () => {
  for (const [name, endpoint] of Object.entries(AUTH_ENDPOINTS)) {
    assert.equal(endpoint.method, name === "me" ? "GET" : "POST", name);
    assert.match(endpoint.path, /^\/auth\/[a-z-]+$/);
  }
});

test("各种状态码都变成 ApiError 并带上状态码；应答体不是 JSON 时也一样", async () => {
  for (const status of [400, 401, 403, 404, 409, 413, 422, 429, 500, 502, 503, 504]) {
    stubFetch(() => json(status, { error: { code: "SOME_CODE", message: "说明", details: {} } }));
    await assert.rejects(fetchMe("tenant", "t"), (err) => err instanceof ApiError && err.status === status && err.code === "SOME_CODE");
    stubFetch(() => new Response("<html><body>nginx</body></html>", { status, headers: { "content-type": "text/html" } }));
    await assert.rejects(fetchMe("tenant", "t"), (err) => err instanceof ApiError && err.status === status && err.code === "UNKNOWN" && err.message === "");
    stubFetch(() => new Response("", { status }));
    await assert.rejects(fetchMe("tenant", "t"), (err) => err instanceof ApiError && err.status === status);
  }
});

test("JSON 但不是约定的错误结构（字段类型不对、缺字段、是数组或 null）时不取其中的说明", async () => {
  const bodies: unknown[] = [
    null,
    [],
    "text",
    42,
    {},
    { error: null },
    { error: "boom" },
    { error: { code: 1, message: "m", details: {} } },
    { error: { code: "C", message: { html: "<b>x</b>" }, details: {} } },
    { error: { code: "C", message: "m" } },
    { error: { code: "C", message: "m", details: null } },
    { message: "m", statusCode: 500 },
  ];
  for (const body of bodies) {
    stubFetch(() => json(500, body));
    await assert.rejects(
      fetchMe("tenant", "t"),
      (err) => err instanceof ApiError && err.code === "UNKNOWN" && err.message === "" && Object.keys(err.details).length === 0,
      JSON.stringify(body),
    );
  }
});

test("成功应答是 200 但内容是空的或不是 JSON：按服务端错误处理，不把 undefined 交给页面", async () => {
  for (const body of ["", "OK", "<!doctype html><html></html>", "{"]) {
    stubFetch(() => new Response(body, { status: 200 }));
    await assert.rejects(login("tenant", { email: "a@b.co", password: "x" }), (err) => err instanceof ApiError && err.status === 502, JSON.stringify(body));
  }
});

test("fetch 抛出任何错误（断网、DNS、被中止、TLS）都是 NetworkError，不把原始错误带出去", async () => {
  for (const failure of [new TypeError("Failed to fetch"), new DOMException("aborted", "AbortError"), new Error("net::ERR_CERT_AUTHORITY_INVALID"), "string failure"]) {
    stubFetch(() => {
      throw failure;
    });
    await assert.rejects(fetchMe("tenant", "t"), (err) => err instanceof NetworkError && err.message === "网络连接失败");
  }
});

test("Retry-After：秒数、HTTP 日期、缺失、乱写", () => {
  const now = new Date("2026-12-31T23:59:30Z");
  assert.equal(parseRetryAfter("0", now), 0);
  assert.equal(parseRetryAfter("900", now), 900);
  assert.equal(parseRetryAfter("Fri, 01 Jan 2027 00:00:30 GMT", now), 60, "跨年、跨月、跨午夜的 HTTP 日期");
  assert.equal(parseRetryAfter("Thu, 31 Dec 2026 23:59:30 GMT", now), 0, "正好是现在");
  for (const garbage of ["", "   ", "soon", "abc123", "NaN", "Infinity", "十分钟"]) {
    assert.equal(parseRetryAfter(garbage, now), null, JSON.stringify(garbage));
  }
});

test("Retry-After：负数、小数这类不合规的写法不会变成负的或离谱的等待时间", () => {
  const now = new Date("2026-06-15T12:00:00Z");
  for (const odd of ["-5", "-1", "1.5", "+30", "30s", "1e3", "0x10"]) {
    const seconds = parseRetryAfter(odd, now);
    assert.ok(seconds === null || (seconds >= 0 && seconds <= 3600), `${JSON.stringify(odd)} 被读成了 ${seconds} 秒`);
  }
});

test("限流提示：等待时间的各种取值都给出能读的话，不出现 NaN、负数、小数分钟", () => {
  for (const seconds of [null, 0, -1, -600, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(throttledText(seconds), "尝试次数过多，请稍后再试。", String(seconds));
  }
  assert.equal(throttledText(0.4), "尝试次数过多，请 1 分钟后再试。");
  assert.equal(throttledText(59.9), "尝试次数过多，请 1 分钟后再试。");
  assert.equal(throttledText(60.1), "尝试次数过多，请 2 分钟后再试。");
  assert.equal(throttledText(3600), "尝试次数过多，请 60 分钟后再试。");
});

test("429 的等待时间：响应头优先；响应头读不懂时用 details；details 不是数字时当作没给", async () => {
  const body = (retry: unknown) => ({ error: { code: "TOO_MANY_LOGIN_ATTEMPTS", message: "尝试次数过多", details: { retry_after_seconds: retry } } });
  const attempt = () => login("tenant", { email: "a@b.co", password: "x" });

  stubFetch(() => json(429, body(30), { "retry-after": "soon" }));
  await assert.rejects(attempt(), (err) => err instanceof ApiError && err.retryAfterSeconds === 30);
  for (const notANumber of ["30", null, { seconds: 30 }, [30], true]) {
    stubFetch(() => json(429, body(notANumber)));
    await assert.rejects(attempt(), (err) => err instanceof ApiError && err.retryAfterSeconds === null, JSON.stringify(notANumber));
  }
  stubFetch(() => new Response("Too Many Requests", { status: 429, headers: { "retry-after": "120" } }));
  await assert.rejects(attempt(), (err) => err instanceof ApiError && err.status === 429 && err.retryAfterSeconds === 120, "代理自己返回的 429（不是 JSON）也读响应头");
});
