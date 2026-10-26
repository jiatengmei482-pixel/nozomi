import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ROUTE_FAILURE_CODES,
  ROUTE_FAILURE_MESSAGES,
  ROUTE_RULES,
  guestRouteReason,
  roundCoordinate,
  routeCacheExpiry,
  routeCacheKey,
  routeCallAllowed,
  routeFailureCacheable,
  routeFailureCooldownMs,
  routeMinutesFromSeconds,
  routeUsageDay,
  routeValuesUsable,
} from "./route-estimate.ts";

test("坐标取整：3 位小数、四舍五入、离 0 远的方向进位，不受二进制误差影响", () => {
  assert.equal(roundCoordinate(35.6812), "35.681");
  assert.equal(roundCoordinate(139.7675), "139.768");
  assert.equal(roundCoordinate(139.7674999), "139.767");
  assert.equal(roundCoordinate(35.6815), "35.682");
  assert.equal(roundCoordinate(-33.8675), "-33.868");
  assert.equal(roundCoordinate(-0.0004), "0.000");
  assert.equal(roundCoordinate(0), "0.000");
  assert.equal(roundCoordinate(179.9996), "180.000");
  assert.equal(roundCoordinate(1.2345, 2), "1.23");
  assert.equal(roundCoordinate(9.5, 0), "10");
  assert.throws(() => roundCoordinate(Number.NaN), RangeError);
});

test("缓存键：取整后的起终点、有方向；同一个约 100 米格子里的点共用一个键", () => {
  const tokyo = { lat: 35.6812, lng: 139.7671 };
  const shinjuku = { lat: 35.6896, lng: 139.7006 };
  const a = routeCacheKey(tokyo, shinjuku);
  assert.equal(a.key, "v1:35.681,139.767>35.690,139.701");
  assert.deepEqual(a.from, { lat: 35.681, lng: 139.767 });
  assert.deepEqual(a.to, { lat: 35.69, lng: 139.701 });
  assert.equal(a.samePoint, false);
  // 几十米之内的点：同一个键
  assert.equal(routeCacheKey({ lat: 35.68104, lng: 139.76703 }, shinjuku).key, a.key);
  // 反方向是另一条路线
  assert.notEqual(routeCacheKey(shinjuku, tokyo).key, a.key);
  // 跨过取整的边界：另一个键
  assert.notEqual(routeCacheKey({ lat: 35.6804, lng: 139.7671 }, shinjuku).key, a.key);
});

test("缓存键：取整后起终点是同一个点时标出来（不调用谷歌）；无效坐标抛错", () => {
  assert.equal(routeCacheKey({ lat: 35.68101, lng: 139.767 }, { lat: 35.68099, lng: 139.76704 }).samePoint, true);
  assert.throws(() => routeCacheKey({ lat: 91, lng: 0 }, { lat: 0, lng: 0 }), RangeError);
  assert.throws(() => routeCacheKey({ lat: 0, lng: 0 }, { lat: 0, lng: Number.POSITIVE_INFINITY }), RangeError);
});

test("时长：秒换整分钟，四舍五入（30 秒进一分钟）", () => {
  assert.equal(routeMinutesFromSeconds(0), 0);
  assert.equal(routeMinutesFromSeconds(29), 0);
  assert.equal(routeMinutesFromSeconds(30), 1);
  assert.equal(routeMinutesFromSeconds(89), 1);
  assert.equal(routeMinutesFromSeconds(90), 2);
  assert.equal(routeMinutesFromSeconds(1_080), 18);
  assert.throws(() => routeMinutesFromSeconds(-1), RangeError);
  assert.throws(() => routeMinutesFromSeconds(1.5), RangeError);
});

test("谷歌给的里程、时长要在合理范围里", () => {
  assert.equal(routeValuesUsable(0, 0), true);
  assert.equal(routeValuesUsable(ROUTE_RULES.maxMeters, ROUTE_RULES.maxSeconds), true);
  assert.equal(routeValuesUsable(ROUTE_RULES.maxMeters + 1, 0), false);
  assert.equal(routeValuesUsable(0, ROUTE_RULES.maxSeconds + 1), false);
  assert.equal(routeValuesUsable(-1, 10), false);
  assert.equal(routeValuesUsable(10.5, 10), false);
});

test("降级判定：密钥 / 配额类冷却 60 秒，网络类 15 秒，只跟这组点有关的不冷却而是缓存", () => {
  for (const code of ["KEY_INVALID", "API_NOT_ENABLED", "KEY_RESTRICTED", "BILLING_DISABLED", "PERMISSION_DENIED", "QUOTA_EXCEEDED", "DAILY_LIMIT_REACHED"] as const) {
    assert.equal(routeFailureCooldownMs(code), 60_000, code);
    assert.equal(routeFailureCacheable(code), false, code);
  }
  for (const code of ["TIMEOUT", "UNREACHABLE", "UNAVAILABLE", "UNEXPECTED"] as const) {
    assert.equal(routeFailureCooldownMs(code), 15_000, code);
    assert.equal(routeFailureCacheable(code), false, code);
  }
  for (const code of ["INVALID_POINTS", "NO_ROUTE"] as const) {
    assert.equal(routeFailureCooldownMs(code), 0, code);
    assert.equal(routeFailureCacheable(code), true, code);
  }
  assert.equal(routeFailureCooldownMs("NOT_CONFIGURED"), 0);
  assert.equal(routeFailureCacheable("NOT_CONFIGURED"), false);
});

test("给客人看的原因：没有路线 / 暂时无法报价；密钥、配额这些内部原因一律是暂时无法报价", () => {
  assert.equal(guestRouteReason("NO_ROUTE"), "NO_ROUTE");
  assert.equal(guestRouteReason("INVALID_POINTS"), "NO_ROUTE");
  for (const code of ROUTE_FAILURE_CODES.filter((c) => c !== "NO_ROUTE" && c !== "INVALID_POINTS")) assert.equal(guestRouteReason(code), "TEMPORARILY_UNAVAILABLE", code);
});

test("每个原因都有说明，说明里没有英文的原因代码", () => {
  for (const code of ROUTE_FAILURE_CODES) {
    assert.ok(ROUTE_FAILURE_MESSAGES[code].length > 0, code);
    assert.doesNotMatch(ROUTE_FAILURE_MESSAGES[code], new RegExp(code));
  }
});

test("费用上限：今天用了 n 次，n < 上限才能再调；上限 0 = 不调用", () => {
  assert.equal(routeCallAllowed(0, ROUTE_RULES.defaultDailyLimit), true);
  assert.equal(routeCallAllowed(999, 1_000), true);
  assert.equal(routeCallAllowed(1_000, 1_000), false);
  assert.equal(routeCallAllowed(1_001, 1_000), false);
  assert.equal(routeCallAllowed(0, 0), false);
});

test("每日计数按东京时间的日期：UTC 15:00 是东京的第二天 0 点", () => {
  assert.equal(routeUsageDay(new Date("2026-10-26T14:59:59.999Z")), "2026-10-26");
  assert.equal(routeUsageDay(new Date("2026-10-26T15:00:00.000Z")), "2026-10-27");
});

test("缓存过期：成功的 7 天，失败的 1 天", () => {
  const now = new Date("2026-10-26T00:00:00.000Z");
  assert.equal(routeCacheExpiry(now, true).toISOString(), "2026-11-02T00:00:00.000Z");
  assert.equal(routeCacheExpiry(now, false).toISOString(), "2026-10-27T00:00:00.000Z");
});
