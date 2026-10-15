/** 汇率源模块：超时、重试、错误码、大小上限、编码（替身 fetch，不联网）。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FxSourceError, downloadFxSource, fxSourceHost } from "./fx-source.ts";

const URL_WITH_KEY = "https://v6.exchangerate-api.example/v6/SECRET-KEY-123/latest/USD";

function fakeFetch(responses: (() => Response | Promise<Response>)[]): { fetch: typeof fetch; calls: () => number } {
  let calls = 0;
  return {
    fetch: (async () => {
      const next = responses[Math.min(calls, responses.length - 1)] as () => Response | Promise<Response>;
      calls += 1;
      return next();
    }) as typeof fetch,
    calls: () => calls,
  };
}

async function code(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "ok";
  } catch (err) {
    assert.ok(err instanceof FxSourceError, String(err));
    assert.doesNotMatch(err.message, /SECRET-KEY/, "错误说明里不带地址");
    return err.code;
  }
}

test("取回响应原文；对方暂时出错（503 / 429）会重试，重试后成功就用", async () => {
  const fake = fakeFetch([() => new Response("", { status: 503 }), () => new Response("", { status: 429 }), () => new Response('{"result":"success"}')]);
  assert.equal(await downloadFxSource(URL_WITH_KEY, { fetch: fake.fetch, attempts: 3, retryDelayMs: 1 }), '{"result":"success"}');
  assert.equal(fake.calls(), 3);
});

test("错误码：一直不可用 → FX_SOURCE_UNAVAILABLE；对方拒绝（4xx）不重试 → FX_SOURCE_BAD_RESPONSE；超时 → FX_SOURCE_TIMEOUT", async () => {
  const down = fakeFetch([() => new Response("", { status: 502 })]);
  assert.equal(await code(downloadFxSource(URL_WITH_KEY, { fetch: down.fetch, attempts: 2, retryDelayMs: 1 })), "FX_SOURCE_UNAVAILABLE");
  assert.equal(down.calls(), 2);
  const refused = fakeFetch([() => new Response("", { status: 403 })]);
  assert.equal(await code(downloadFxSource(URL_WITH_KEY, { fetch: refused.fetch, attempts: 3, retryDelayMs: 1 })), "FX_SOURCE_BAD_RESPONSE");
  assert.equal(refused.calls(), 1);
  const unreachable = fakeFetch([() => Promise.reject(new TypeError("fetch failed"))]);
  assert.equal(await code(downloadFxSource(URL_WITH_KEY, { fetch: unreachable.fetch, attempts: 1 })), "FX_SOURCE_UNAVAILABLE");
  const slow: typeof fetch = (async (_url: string, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal?.reason)))) as typeof fetch;
  assert.equal(await code(downloadFxSource(URL_WITH_KEY, { fetch: slow, attempts: 1, timeoutMs: 20 })), "FX_SOURCE_TIMEOUT");
});

test("内容大得不正常（超过 1MB）、不是 UTF-8：FX_SOURCE_BAD_RESPONSE", async () => {
  const huge = fakeFetch([() => new Response("x".repeat(1024 * 1024 + 1))]);
  assert.equal(await code(downloadFxSource(URL_WITH_KEY, { fetch: huge.fetch, attempts: 1 })), "FX_SOURCE_BAD_RESPONSE");
  const latin1 = fakeFetch([() => new Response(new Uint8Array([0x7b, 0xe9, 0x7d]))]);
  assert.equal(await code(downloadFxSource(URL_WITH_KEY, { fetch: latin1.fetch, attempts: 1 })), "FX_SOURCE_BAD_RESPONSE");
});

test("对外只说主机名：付费档的地址里带密钥，不能出现在库、日志、接口里", () => {
  assert.equal(fxSourceHost(URL_WITH_KEY), "v6.exchangerate-api.example");
  assert.equal(fxSourceHost("https://open.er-api.com/v6/latest/USD"), "open.er-api.com");
});
