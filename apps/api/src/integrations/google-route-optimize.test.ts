/**
 * 谷歌经停顺序优化调用（M9P-20 P2，ADR 0096 第三节第 2 小节）的单元测试：用替身 fetch，不联网。
 * - 读应答：是排列才认；没有 routes 是没有路线；坏 JSON、长度不对、重复、越界都是看不懂；
 * - 请求：一次 computeRoutes、字段掩码只要顺序、密钥放请求头、不跟随重定向；
 * - 重试会多花钱：只有连不上、超时、5xx 才在时间够时再试 1 次，而且再试之前要再问一次每日名额（beforeAttempt），名额没了就不再试；4xx 不重试；
 * - 第一次就没名额：不发请求，DAILY_LIMIT_REACHED。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { OPTIMIZE_FIELD_MASK, computeOptimizedOrder, optimizeRequestBody, parseOptimizedOrder } from "./google-route-optimize.ts";

const A = { lat: 35.69, lng: 139.7 };
const B = { lat: 35.45, lng: 139.63 };
const STOPS = [
  { lat: 35.5, lng: 138.77 },
  { lat: 35.45, lng: 139.63 },
  { lat: 35.23, lng: 139.1 },
];
const URL = "http://127.0.0.1:9/routes";

test("parseOptimizedOrder：排列才认；没有 routes / routes 为空是 NO_ROUTE；其余都是 UNEXPECTED", () => {
  assert.deepEqual(parseOptimizedOrder(JSON.stringify({ routes: [{ optimizedIntermediateWaypointIndex: [2, 0, 1] }] }), 3), { ok: true, order: [2, 0, 1] });
  assert.deepEqual(parseOptimizedOrder("{}", 3), { ok: false, code: "NO_ROUTE" });
  assert.deepEqual(parseOptimizedOrder(JSON.stringify({ routes: [] }), 3), { ok: false, code: "NO_ROUTE" });
  for (const bad of ["not json", "[]", "null", JSON.stringify({ routes: {} }), JSON.stringify({ routes: [null] }), JSON.stringify({ routes: [{}] })]) {
    assert.deepEqual(parseOptimizedOrder(bad, 3), { ok: false, code: "UNEXPECTED" }, bad);
  }
  for (const index of [[0, 1], [0, 1, 2, 3], [0, 0, 1], [0, 1, 3], [-1, 0, 1], [0, 1.5, 2], ["0", 1, 2]]) {
    assert.deepEqual(parseOptimizedOrder(JSON.stringify({ routes: [{ optimizedIntermediateWaypointIndex: index }] }), 3), { ok: false, code: "UNEXPECTED" }, JSON.stringify(index));
  }
});

test("请求体：驾车、不看路况、不要备选、要优化顺序；中间点按原顺序", () => {
  const body = JSON.parse(optimizeRequestBody(A, B, STOPS));
  assert.equal(body.travelMode, "DRIVE");
  assert.equal(body.routingPreference, "TRAFFIC_UNAWARE");
  assert.equal(body.computeAlternativeRoutes, false);
  assert.equal(body.optimizeWaypointOrder, true);
  assert.deepEqual(body.intermediates.map((p: { location: { latLng: { latitude: number } } }) => p.location.latLng.latitude), [35.5, 35.45, 35.23]);
});

/** 替身 fetch：按顺序回给定的应答（数字 = 状态码 + 空体；Error = 抛出） */
function fakeFetch(replies: (Response | Error)[]): { fetch: typeof fetch; calls: RequestInit[] } {
  const calls: RequestInit[] = [];
  return {
    calls,
    fetch: (async (_url: string | URL | Request, init?: RequestInit) => {
      calls.push(init ?? {});
      const next = replies.shift();
      if (next === undefined) throw new Error("没有更多应答");
      if (next instanceof Error) throw next;
      return next;
    }) as typeof fetch,
  };
}
const ok = (index: number[]) => new Response(JSON.stringify({ routes: [{ optimizedIntermediateWaypointIndex: index }] }), { status: 200 });

test("成功：一次请求，字段掩码只要顺序、密钥在请求头、不跟随重定向", async () => {
  const fake = fakeFetch([ok([1, 2, 0])]);
  let asked = 0;
  const result = await computeOptimizedOrder("test-key", A, B, STOPS, { url: URL, fetch: fake.fetch, beforeAttempt: async () => ((asked += 1), true) });
  assert.deepEqual(result, { ok: true, order: [1, 2, 0] });
  assert.equal(fake.calls.length, 1);
  assert.equal(asked, 1);
  const headers = fake.calls[0]?.headers as Record<string, string>;
  assert.equal(headers["x-goog-fieldmask"], OPTIMIZE_FIELD_MASK);
  assert.equal(headers["x-goog-api-key"], "test-key");
  assert.equal(fake.calls[0]?.redirect, "manual");
});

test("5xx / 连不上：再试 1 次，再试之前再问一次名额；第二次成功就用", async () => {
  for (const first of [new Response("oops", { status: 503 }), new TypeError("fetch failed")]) {
    const fake = fakeFetch([first, ok([0, 2, 1])]);
    let asked = 0;
    const result = await computeOptimizedOrder("k", A, B, STOPS, { url: URL, fetch: fake.fetch, beforeAttempt: async () => ((asked += 1), true) });
    assert.deepEqual(result, { ok: true, order: [0, 2, 1] });
    assert.equal(fake.calls.length, 2);
    assert.equal(asked, 2, "重试也要占名额");
  }
});

test("再试之前名额没了：不再发请求，结果是第一次的失败（不是 DAILY_LIMIT_REACHED）", async () => {
  const fake = fakeFetch([new Response("oops", { status: 500 }), ok([0, 1, 2])]);
  let asked = 0;
  const result = await computeOptimizedOrder("k", A, B, STOPS, { url: URL, fetch: fake.fetch, beforeAttempt: async () => (asked += 1) === 1 });
  assert.equal(fake.calls.length, 1, "名额没了，第二次没发");
  assert.equal(result.ok, false);
  assert.notEqual(!result.ok && result.code, "DAILY_LIMIT_REACHED");
});

test("4xx 不重试（多试一次只会多花钱）", async () => {
  const fake = fakeFetch([new Response(JSON.stringify({ error: { status: "INVALID_ARGUMENT", message: "x" } }), { status: 400 }), ok([0, 1, 2])]);
  let asked = 0;
  const result = await computeOptimizedOrder("k", A, B, STOPS, { url: URL, fetch: fake.fetch, beforeAttempt: async () => ((asked += 1), true) });
  assert.equal(result.ok, false);
  assert.equal(fake.calls.length, 1);
  assert.equal(asked, 1);
});

test("第一次就没名额：不发请求，DAILY_LIMIT_REACHED；两次都失败最多发 2 次", async () => {
  const none = fakeFetch([ok([0, 1, 2])]);
  assert.deepEqual(await computeOptimizedOrder("k", A, B, STOPS, { url: URL, fetch: none.fetch, beforeAttempt: async () => false }), { ok: false, code: "DAILY_LIMIT_REACHED" });
  assert.equal(none.calls.length, 0);
  const twice = fakeFetch([new Response("", { status: 502 }), new Response("", { status: 502 }), ok([0, 1, 2])]);
  const result = await computeOptimizedOrder("k", A, B, STOPS, { url: URL, fetch: twice.fetch, beforeAttempt: async () => true });
  assert.equal(result.ok, false);
  assert.equal(twice.calls.length, 2);
});
