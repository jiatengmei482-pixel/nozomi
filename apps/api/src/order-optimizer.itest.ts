/**
 * 包车经停顺序建议的谷歌优化调度（M9P-20 P2，ADR 0096 第三节第 2、3 小节）`GoogleOrderOptimizer`，连真实 PostgreSQL，谷歌调用是替身（数调用次数）：
 * - 同一组段并发只调一次谷歌；
 * - 一次占齐所有段的名额，不够整次不调；重试再占 1 个名额，名额没了重试不发；
 * - 没有路线（NO_ROUTE）存 1 天：1 天内同一组点不再调，过了 1 天再调；
 * - 连不上之后冷却：冷却中换一组点也不调谷歌；
 * - 会话 / 地址限频（beforeGoogle）不放行：不调谷歌、不占名额，RATE_LIMITED；缓存全命中时不问限频。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { type LatLng, type SuggestionSegment, routeUsageDay } from "@nozomi/domain";
import type { ComputedOptimizedOrder } from "./integrations/google-route-optimize.ts";
import { GoogleOrderOptimizer } from "./services/order-optimizer.ts";
import { createTestApi, type TestApi } from "./testing/api.ts";

let api: TestApi;
before(async () => {
  api = await createTestApi();
});
after(() => api.close());

let seq = 0;
/** 每个用例自己的一组点（缓存表是共用的）：一段、3 个可动经停 */
function segments(): SuggestionSegment[] {
  seq += 1;
  const d = seq * 0.002;
  return [{ from: { lat: 35.69, lng: 139.7 }, to: { lat: 35.69, lng: 139.7 }, movable: [{ ref: "a", lat: 35.5 + d, lng: 138.77 }, { ref: "b", lat: 35.45 + d, lng: 139.63 }, { ref: "c", lat: 35.23 + d, lng: 139.1 }] }];
}
const usage = async (): Promise<number> => ((await api.db.owner.query("select calls from route_optimize_api_usage where day = $1", [routeUsageDay(api.clock.now())])).rows[0]?.calls as number | undefined) ?? 0;
const silent = { warn() {} };

type Compute = (apiKey: string, from: LatLng, to: LatLng, movable: readonly LatLng[], beforeAttempt: () => Promise<boolean>) => Promise<ComputedOptimizedOrder>;
function optimizer(compute: Compute, dailyLimit = 1_000): GoogleOrderOptimizer {
  return new GoogleOrderOptimizer({ pool: api.db.pool, now: () => api.clock.now(), apiKey: () => "test-key", dailyLimit, compute, log: silent, dbTimeoutMs: 5_000 });
}

test("同一组段并发只调一次谷歌，两个请求拿到同一个结果；之后同一组点走缓存", async () => {
  let calls = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const o = optimizer(async () => {
    calls += 1;
    await gate;
    return { ok: true, order: [1, 2, 0] };
  });
  const segs = segments();
  const first = o.optimize(segs);
  const second = o.optimize(segs);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.deepEqual(a, b);
  assert.equal(a.ok && a.source, "google");
  const cached = await o.optimize(segs);
  assert.equal(cached.ok && cached.source, "cache");
  assert.equal(calls, 1);
});

test("名额：一次占齐所有段；不够整次不调；重试再占 1 个名额，名额没了 beforeAttempt 返回 false", async () => {
  const start = await usage();
  // 名额只剩 0：不调
  let called = 0;
  const full = optimizer(async () => ((called += 1), { ok: true, order: [0, 1, 2] }), start);
  assert.deepEqual(await full.optimize(segments()), { ok: false, reason: "UNAVAILABLE", code: "DAILY_LIMIT_REACHED" });
  assert.equal(called, 0);
  assert.equal(await usage(), start, "没占名额");
  // 名额只剩 1：第一次放行（已占），重试要再占 1 个 → 不放行
  const answers: boolean[] = [];
  const one = optimizer(async (_key, _from, _to, _movable, beforeAttempt) => {
    answers.push(await beforeAttempt(), await beforeAttempt());
    return { ok: false, code: "UNREACHABLE" };
  }, start + 1);
  await one.optimize(segments());
  assert.deepEqual(answers, [true, false]);
  assert.equal(await usage(), start + 1, "重试没占到名额");
  // 名额还够：重试占到第 2 个
  const twice: boolean[] = [];
  const more = optimizer(async (_key, _from, _to, _movable, beforeAttempt) => {
    twice.push(await beforeAttempt(), await beforeAttempt());
    return { ok: true, order: [2, 1, 0] };
  });
  await more.optimize(segments());
  assert.deepEqual(twice, [true, true]);
  assert.equal(await usage(), start + 3);
});

test("没有路线存 1 天：1 天内同一组点不再调谷歌（NO_ROUTE），过了 1 天再调", async () => {
  let calls = 0;
  const o = optimizer(async () => ((calls += 1), { ok: false, code: "NO_ROUTE" }));
  const segs = segments();
  assert.deepEqual(await o.optimize(segs), { ok: false, reason: "NO_ROUTE", code: "NO_ROUTE" });
  assert.deepEqual(await o.optimize(segs), { ok: false, reason: "NO_ROUTE", code: "NO_ROUTE" });
  assert.equal(calls, 1, "1 天内走缓存");
  api.clock.advance(24 * 3_600_000 + 1_000);
  await o.optimize(segs);
  assert.equal(calls, 2, "过了 1 天再问");
});

test("连不上之后冷却：冷却中换一组点也不调谷歌，UNAVAILABLE", async () => {
  let calls = 0;
  const o = optimizer(async () => ((calls += 1), { ok: false, code: "UNREACHABLE" }));
  assert.deepEqual(await o.optimize(segments()), { ok: false, reason: "UNAVAILABLE", code: "UNREACHABLE" });
  assert.deepEqual(await o.optimize(segments()), { ok: false, reason: "UNAVAILABLE", code: "UNREACHABLE" });
  assert.equal(calls, 1);
});

test("限频不放行：不调谷歌、不占名额，RATE_LIMITED；缓存全命中时不问限频", async () => {
  let calls = 0;
  const o = optimizer(async () => ((calls += 1), { ok: true, order: [0, 2, 1] }));
  const start = await usage();
  const segs = segments();
  assert.deepEqual(await o.optimize(segs, { beforeGoogle: async () => false }), { ok: false, reason: "RATE_LIMITED", code: "RATE_LIMITED" });
  assert.equal(calls, 0);
  assert.equal(await usage(), start);
  await o.optimize(segs);
  let asked = 0;
  const hit = await o.optimize(segs, { beforeGoogle: async () => ((asked += 1), false) });
  assert.equal(hit.ok && hit.source, "cache");
  assert.equal(asked, 0);
});
