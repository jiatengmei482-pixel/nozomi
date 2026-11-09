import assert from "node:assert/strict";
import { test } from "node:test";
import { ROUTE_FAILURE_CODES, routeCacheKey, routeFailureCooldownMs } from "./route-estimate.ts";
import {
  STATIC_MAP_FAILURE_CODES,
  STATIC_MAP_FAILURE_MESSAGES,
  STATIC_MAP_PALETTES,
  STATIC_MAP_RULES,
  type StaticMapSize,
  decodePolyline,
  encodePolyline,
  isStaticMapSize,
  routeMapReason,
  staticMapCacheKey,
  staticMapFailureCooldownMs,
  staticMapQuery,
  staticMapStyles,
} from "./static-map.ts";

/** 谷歌文档里的例子：(38.5, -120.2) → (40.7, -120.95) → (43.252, -126.453) */
const GOOGLE_EXAMPLE = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";
const SIZE: StaticMapSize = { theme: "light", width: 320, height: 200, scale: 2 };

test("折线：按谷歌文档的例子解码、编码互为逆运算；字符不对、最后一段没写完、坐标超出范围为 null", () => {
  assert.deepEqual(decodePolyline(GOOGLE_EXAMPLE), [
    { lat: 38.5, lng: -120.2 },
    { lat: 40.7, lng: -120.95 },
    { lat: 43.252, lng: -126.453 },
  ]);
  assert.equal(encodePolyline(decodePolyline(GOOGLE_EXAMPLE) ?? []), GOOGLE_EXAMPLE);
  const tokyo = [
    { lat: 35.68123, lng: 139.76712 },
    { lat: 35.68, lng: 139.75 },
    { lat: -33.86785, lng: 151.20732 },
  ];
  assert.deepEqual(decodePolyline(encodePolyline(tokyo)), tokyo);
  assert.equal(decodePolyline(""), null);
  assert.equal(decodePolyline("abc def"), null, "空格不是折线的字符");
  assert.equal(decodePolyline("_p~iF~ps|U_"), null, "最后一个数没写完");
  assert.equal(decodePolyline("_p~iF"), null, "只有纬度没有经度");
  assert.equal(decodePolyline(encodePolyline([{ lat: 89, lng: 0 }]) + encodePolyline([{ lat: 89, lng: 0 }])), null, "累加后纬度超过 90 度");
});

test("尺寸：宽 200–640、高 150–640 的整数，倍率 1 或 2，主题亮色或暗色", () => {
  assert.ok(isStaticMapSize(SIZE));
  for (const ok of [{ width: 200, height: 150 }, { width: 640, height: 640 }]) assert.ok(isStaticMapSize({ ...SIZE, ...ok }), JSON.stringify(ok));
  for (const bad of [{ width: 199 }, { width: 641 }, { height: 149 }, { height: 641 }, { width: 320.5 }, { scale: 3 }, { theme: "sepia" }]) {
    assert.ok(!isStaticMapSize({ ...SIZE, ...bad } as StaticMapSize), JSON.stringify(bad));
  }
});

test("缓存键：样式版本 + 主题 + 尺寸 + 倍率 + 路线缓存键；尺寸不对抛错", () => {
  const route = routeCacheKey({ lat: 35.6812, lng: 139.7671 }, { lat: 35.6586, lng: 139.7454 });
  assert.equal(staticMapCacheKey(route.key, SIZE), `s${STATIC_MAP_RULES.styleVersion}:light:320x200@2|v1:35.681,139.767>35.659,139.745`);
  assert.notEqual(staticMapCacheKey(route.key, { ...SIZE, theme: "dark" }), staticMapCacheKey(route.key, SIZE));
  assert.notEqual(staticMapCacheKey(route.key, { ...SIZE, scale: 1 }), staticMapCacheKey(route.key, SIZE));
  assert.throws(() => staticMapCacheKey(route.key, { ...SIZE, width: 1000 }), RangeError);
});

test("底图：两套都是灰色调（底色、道路、水面的 R、G、B 相差不超过 0x20）；亮色路线是品牌色 #1B2A5C，暗色换成 #A9BBFF；去掉兴趣点和公交", () => {
  assert.equal(STATIC_MAP_PALETTES.light.route, "1B2A5C");
  assert.equal(STATIC_MAP_PALETTES.dark.route, "A9BBFF");
  for (const palette of Object.values(STATIC_MAP_PALETTES)) {
    for (const color of [palette.base, palette.road, palette.highway, palette.water, palette.labelStroke]) {
      const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(color.slice(i, i + 2), 16)) as [number, number, number];
      assert.ok(Math.max(r, g, b) - Math.min(r, g, b) <= 0x20, `${color} 不是灰色`);
    }
  }
  for (const theme of ["light", "dark"] as const) {
    const styles = staticMapStyles(theme);
    assert.ok(styles.includes("feature:poi|visibility:off"));
    assert.ok(styles.includes("feature:transit|visibility:off"));
    assert.ok(styles.includes(`element:geometry|color:0x${STATIC_MAP_PALETTES[theme].base}`));
  }
});

test("请求参数：尺寸、倍率、PNG、中文地名、样式、品牌色路线（enc 折线）、起点 A 终点 B 取折线两端；没有密钥", () => {
  const query = staticMapQuery(GOOGLE_EXAMPLE, SIZE);
  assert.ok(query !== null);
  const params = new URLSearchParams(query);
  assert.equal(params.get("size"), "320x200");
  assert.equal(params.get("scale"), "2");
  assert.equal(params.get("format"), "png");
  assert.equal(params.get("maptype"), "roadmap");
  assert.equal(params.get("language"), "zh-CN");
  assert.deepEqual(params.getAll("style"), staticMapStyles("light"));
  assert.equal(params.get("path"), `color:0x1B2A5Cff|weight:5|enc:${GOOGLE_EXAMPLE}`);
  assert.deepEqual(params.getAll("markers"), ["size:mid|color:0x1B2A5C|label:A|38.50000,-120.20000", "size:mid|color:0x1B2A5C|label:B|43.25200,-126.45300"]);
  assert.ok(!params.has("key"));
  const dark = new URLSearchParams(staticMapQuery(GOOGLE_EXAMPLE, { ...SIZE, theme: "dark" }) ?? "");
  assert.match(dark.get("path") ?? "", /^color:0xA9BBFFff\|/);
  assert.deepEqual(dark.getAll("style"), staticMapStyles("dark"));
});

test("请求参数：折线太长时抽稀到网址放得下，起终点不动；看不懂、只有一个点、尺寸不对为 null", () => {
  const points = Array.from({ length: 6_000 }, (_, i) => ({ lat: 35 + i * 0.0001 + (i % 7) * 0.00003, lng: 139 + i * 0.00013 - (i % 5) * 0.00002 }));
  const long = encodePolyline(points);
  assert.ok(long.length > STATIC_MAP_RULES.maxQueryLength / 3);
  const query = staticMapQuery(long, SIZE);
  assert.ok(query !== null);
  assert.ok(query.length <= STATIC_MAP_RULES.maxQueryLength, String(query.length));
  const params = new URLSearchParams(query);
  const drawn = decodePolyline((params.get("path") ?? "").split("|enc:")[1] ?? "");
  assert.ok(drawn !== null && drawn.length >= 2 && drawn.length < points.length);
  assert.deepEqual(drawn[0], { lat: Math.round(points[0]!.lat * 1e5) / 1e5, lng: Math.round(points[0]!.lng * 1e5) / 1e5 });
  const lastPoint = points[points.length - 1]!;
  assert.deepEqual(drawn[drawn.length - 1], { lat: Math.round(lastPoint.lat * 1e5) / 1e5, lng: Math.round(lastPoint.lng * 1e5) / 1e5 });
  assert.equal(staticMapQuery("_p~iF~ps|U_", SIZE), null);
  assert.equal(staticMapQuery(encodePolyline([{ lat: 35, lng: 139 }]), SIZE), null);
  assert.equal(staticMapQuery(GOOGLE_EXAMPLE, { ...SIZE, height: 100 }), null);
});

test("失败原因：两类给页面——没配密钥、静态地图没开通 / 密钥不允许 / 无效 / 没绑卡 / 没权限是 NOT_ENABLED，其余都是 UNAVAILABLE；路线自己的「没开通」不算", () => {
  const notEnabled = ["NOT_CONFIGURED", "KEY_INVALID", "API_NOT_ENABLED", "KEY_RESTRICTED", "BILLING_DISABLED", "PERMISSION_DENIED"];
  for (const code of STATIC_MAP_FAILURE_CODES) assert.equal(routeMapReason({ stage: "static_map", code }), notEnabled.includes(code) ? "NOT_ENABLED" : "UNAVAILABLE", code);
  for (const code of ROUTE_FAILURE_CODES) assert.equal(routeMapReason({ stage: "route", code }), code === "NOT_CONFIGURED" ? "NOT_ENABLED" : "UNAVAILABLE", code);
  for (const code of ["NO_POLYLINE", "SAME_POINT", "SITE_NOT_OPEN"] as const) assert.equal(routeMapReason({ stage: "map", code }), "UNAVAILABLE");
  for (const code of STATIC_MAP_FAILURE_CODES) assert.ok(STATIC_MAP_FAILURE_MESSAGES[code].length > 0);
});

test("冷却：和路线预估同一套时长（密钥、配额、上限 60 秒，网络 15 秒，没配置不冷却）；图太大不冷却", () => {
  for (const code of STATIC_MAP_FAILURE_CODES) {
    if (code === "IMAGE_TOO_LARGE") assert.equal(staticMapFailureCooldownMs(code), 0);
    else assert.equal(staticMapFailureCooldownMs(code), routeFailureCooldownMs(code), code);
  }
  assert.equal(staticMapFailureCooldownMs("API_NOT_ENABLED"), 60_000);
  assert.equal(staticMapFailureCooldownMs("TIMEOUT"), 15_000);
  assert.equal(staticMapFailureCooldownMs("NOT_CONFIGURED"), 0);
  assert.equal(STATIC_MAP_RULES.defaultDailyLimit, 300);
});
