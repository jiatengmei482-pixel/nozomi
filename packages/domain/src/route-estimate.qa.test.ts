/**
 * 路线预估规则的边界（M2-02，ADR 0042，测试角色补充）：
 * 坐标取整正好落在 0.0005 上（逐个格子扫一遍，防二进制误差）、负数和 0 附近、经纬度的极值与缓存表的键格式约束、
 * 同一个格子 / 相邻格子、方向；秒换分钟的每个 30 秒边界；过期时间按毫秒；东京日期的跨午夜、跨月、跨年、闰日；
 * 14 个原因代码的冷却 / 负缓存 / 客人原因全表。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ROUTE_FAILURE_CODES,
  ROUTE_RULES,
  type RouteFailureCode,
  guestRouteReason,
  routeCacheExpiry,
  routeCacheKey,
  routeCallAllowed,
  routeCoordinateText,
  routeFailureCacheable,
  routeFailureCooldownMs,
  routeMinutesFromSeconds,
  routeUsageDay,
} from "./route-estimate.ts";

/** 迁移 0110 里 route_estimates.cache_key 的格式约束（原样抄过来）：domain 生成的键必须都能写进库。 */
const DB_KEY_FORMAT = /^v1:-?[0-9]{1,3}\.[0-9]{3},-?[0-9]{1,3}\.[0-9]{3}>-?[0-9]{1,3}\.[0-9]{3},-?[0-9]{1,3}\.[0-9]{3}$/;

const pad3 = (n: number): string => String(n).padStart(3, "0");

test("坐标正好落在两个格子中间（x.xxx5）：一律向远离 0 的方向进位——东京一带 1000 个格子逐个核对，不受二进制误差影响", () => {
  for (const whole of [35, 139, 0]) {
    for (let i = 0; i < 1000; i++) {
      const value = Number(`${whole}.${pad3(i)}5`);
      const up = i === 999 ? `${whole + 1}.000` : `${whole}.${pad3(i + 1)}`;
      assert.equal(routeCoordinateText(value), up, `${whole}.${pad3(i)}5`);
      assert.equal(routeCoordinateText(-value), `-${up}`, `-${whole}.${pad3(i)}5`);
    }
  }
});

test("坐标差一点到中间（x.xxx4999）：舍去；刚过中间（x.xxx5001）：进位", () => {
  for (let i = 0; i < 1000; i += 7) {
    assert.equal(routeCoordinateText(Number(`35.${pad3(i)}4999`)), `35.${pad3(i)}`);
    assert.equal(routeCoordinateText(Number(`139.${pad3(i)}5001`)), i === 999 ? "140.000" : `139.${pad3(i + 1)}`);
  }
});

test("0 附近：-0.0004 和 0.0004 是同一个格子（0.000，不写成 -0.000）；-0.0005 进到 -0.001", () => {
  assert.equal(routeCoordinateText(-0.0004), "0.000");
  assert.equal(routeCoordinateText(0.0004), "0.000");
  assert.equal(routeCoordinateText(-0), "0.000");
  assert.equal(routeCoordinateText(-0.0005), "-0.001");
  assert.equal(routeCoordinateText(0.0005), "0.001");
  assert.equal(routeCacheKey({ lat: -0.0004, lng: 0.0004 }, { lat: 1, lng: 1 }).key, routeCacheKey({ lat: 0.0004, lng: -0.0004 }, { lat: 1, lng: 1 }).key);
});

test("经纬度的极值：生成的键都符合缓存表的格式约束（写得进库），取整后的坐标仍然合法", () => {
  const extremes = [
    { lat: 90, lng: 180 },
    { lat: -90, lng: -180 },
    { lat: 89.9996, lng: 179.9996 },
    { lat: -89.9996, lng: -179.9996 },
    { lat: 0, lng: 0 },
    { lat: 1e-12, lng: -1e-12 },
    { lat: 35.6812, lng: 139.7671 },
  ];
  for (const from of extremes) {
    for (const to of extremes) {
      const key = routeCacheKey(from, to);
      assert.match(key.key, DB_KEY_FORMAT, JSON.stringify([from, to]));
      for (const point of [key.from, key.to]) {
        assert.ok(point.lat >= -90 && point.lat <= 90 && point.lng >= -180 && point.lng <= 180, JSON.stringify(point));
      }
    }
  }
  assert.equal(routeCacheKey({ lat: 89.9996, lng: 179.9996 }, { lat: 0, lng: 0 }).key, "v1:90.000,180.000>0.000,0.000");
});

test("随机的合法坐标：键都符合库的格式约束；取整后的坐标再取整一次不变（调谷歌用的点就是键里的点）", () => {
  let seed = 20261026;
  const random = (): number => {
    seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
    return seed / 2_147_483_648;
  };
  for (let n = 0; n < 2_000; n++) {
    const from = { lat: random() * 180 - 90, lng: random() * 360 - 180 };
    const to = { lat: random() * 180 - 90, lng: random() * 360 - 180 };
    const key = routeCacheKey(from, to);
    assert.match(key.key, DB_KEY_FORMAT);
    assert.equal(routeCacheKey(key.from, key.to).key, key.key);
    assert.ok(Math.abs(key.from.lat - from.lat) <= 0.0005 + 1e-12 && Math.abs(key.to.lng - to.lng) <= 0.0005 + 1e-12);
  }
});

test("同一个点：取整后同一个格子才算（不调用、按 0）；跨过格子边界哪怕只差 1 米也不算，要调用", () => {
  // 同一格子的两个对角：约 0.0009 度 × 0.0009 度，仍是同一个点
  assert.equal(routeCacheKey({ lat: 35.6805, lng: 139.7665 }, { lat: 35.68149, lng: 139.76749 }).samePoint, true);
  // 边界两侧：35.68049 → 35.680，35.6805 → 35.681
  const across = routeCacheKey({ lat: 35.68049, lng: 139.767 }, { lat: 35.6805, lng: 139.767 });
  assert.equal(across.samePoint, false);
  assert.notEqual(across.from.lat, across.to.lat);
});

test("方向：A → B 和 B → A 是两个键，互为镜像", () => {
  const a = { lat: 35.7647, lng: 140.3864 };
  const b = { lat: 35.6812, lng: 139.7671 };
  const ab = routeCacheKey(a, b).key;
  const ba = routeCacheKey(b, a).key;
  assert.notEqual(ab, ba);
  const [left, right] = ab.slice(3).split(">") as [string, string];
  assert.equal(ba, `v1:${right}>${left}`);
});

test("秒换分钟：每个 30 秒的边界都按四舍五入（n 分 29 秒舍、n 分 30 秒进），最大的合理时长也能换", () => {
  for (let minute = 0; minute < 600; minute++) {
    assert.equal(routeMinutesFromSeconds(minute * 60 + 29), minute);
    assert.equal(routeMinutesFromSeconds(minute * 60 + 30), minute + 1);
    assert.equal(routeMinutesFromSeconds(minute * 60 + 59), minute + 1);
  }
  assert.equal(routeMinutesFromSeconds(ROUTE_RULES.maxSeconds), 7 * 24 * 60);
});

test("缓存过期时间按毫秒算：成功的正好 604,800,000 毫秒，没有路线 / 坐标无效的正好 86,400,000 毫秒", () => {
  const now = new Date("2026-10-31T14:59:59.123Z");
  assert.equal(routeCacheExpiry(now, true).getTime() - now.getTime(), 604_800_000);
  assert.equal(routeCacheExpiry(now, false).getTime() - now.getTime(), 86_400_000);
  assert.equal(routeCacheExpiry(now, true).toISOString(), "2026-11-07T14:59:59.123Z");
});

test("每日计数的日期（东京）：跨午夜、跨月、跨年、闰日、日本没有夏令时（3 月 / 11 月的 UTC 切换日照常 +9）", () => {
  const cases: [string, string][] = [
    ["2026-10-31T14:59:59.999Z", "2026-10-31"],
    ["2026-10-31T15:00:00.000Z", "2026-11-01"],
    ["2026-12-31T14:59:59.999Z", "2026-12-31"],
    ["2026-12-31T15:00:00.000Z", "2027-01-01"],
    ["2028-02-28T15:00:00.000Z", "2028-02-29"],
    ["2028-02-29T15:00:00.000Z", "2028-03-01"],
    ["2026-03-08T15:00:00.000Z", "2026-03-09"],
    ["2026-11-01T14:59:59.999Z", "2026-11-01"],
    ["2026-10-26T00:00:00.000Z", "2026-10-26"],
  ];
  for (const [instant, day] of cases) assert.equal(routeUsageDay(new Date(instant)), day, instant);
});

test("每日上限：上限 1 时只允许第一次；最大上限 100 万的边界", () => {
  assert.equal(routeCallAllowed(0, 1), true);
  assert.equal(routeCallAllowed(1, 1), false);
  assert.equal(routeCallAllowed(999_999, 1_000_000), true);
  assert.equal(routeCallAllowed(1_000_000, 1_000_000), false);
});

test("14 个原因代码的全表：冷却多久、要不要负缓存、客人看到什么（和 ADR 0042 的表逐条对照）", () => {
  const table: Record<RouteFailureCode, [cooldownMs: number, cacheable: boolean, guest: "NO_ROUTE" | "TEMPORARILY_UNAVAILABLE"]> = {
    NOT_CONFIGURED: [0, false, "TEMPORARILY_UNAVAILABLE"],
    DAILY_LIMIT_REACHED: [60_000, false, "TEMPORARILY_UNAVAILABLE"],
    KEY_INVALID: [60_000, false, "TEMPORARILY_UNAVAILABLE"],
    API_NOT_ENABLED: [60_000, false, "TEMPORARILY_UNAVAILABLE"],
    KEY_RESTRICTED: [60_000, false, "TEMPORARILY_UNAVAILABLE"],
    BILLING_DISABLED: [60_000, false, "TEMPORARILY_UNAVAILABLE"],
    PERMISSION_DENIED: [60_000, false, "TEMPORARILY_UNAVAILABLE"],
    QUOTA_EXCEEDED: [60_000, false, "TEMPORARILY_UNAVAILABLE"],
    TIMEOUT: [15_000, false, "TEMPORARILY_UNAVAILABLE"],
    UNREACHABLE: [15_000, false, "TEMPORARILY_UNAVAILABLE"],
    UNAVAILABLE: [15_000, false, "TEMPORARILY_UNAVAILABLE"],
    UNEXPECTED: [15_000, false, "TEMPORARILY_UNAVAILABLE"],
    INVALID_POINTS: [0, true, "NO_ROUTE"],
    NO_ROUTE: [0, true, "NO_ROUTE"],
  };
  assert.equal(ROUTE_FAILURE_CODES.length, 14);
  assert.equal(new Set(ROUTE_FAILURE_CODES).size, 14);
  assert.deepEqual([...ROUTE_FAILURE_CODES].sort(), Object.keys(table).sort());
  for (const code of ROUTE_FAILURE_CODES) {
    const [cooldown, cacheable, guest] = table[code];
    assert.deepEqual([routeFailureCooldownMs(code), routeFailureCacheable(code), guestRouteReason(code)], [cooldown, cacheable, guest], code);
    // 负缓存的不冷却（只跟这组点有关），冷却的不负缓存
    assert.ok(!(cacheable && cooldown > 0), code);
  }
});
