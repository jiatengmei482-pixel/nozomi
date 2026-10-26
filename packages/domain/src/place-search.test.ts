import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PLACE_FAILURE_CODES,
  PLACE_SEARCH_RULES,
  cityBounds,
  cleanPlaceText,
  inBounds,
  normalizePlaceQuery,
  placeFailureCooldownMs,
  placeQueryIssue,
  placeReverseKey,
  placeSearchCacheKey,
} from "./place-search.ts";

test("关键字规范化：全角转半角、控制字符当空白、连续空白并成一个、去掉首尾空白", () => {
  assert.equal(normalizePlaceQuery("  ＡＢＣ　ホテル\t\n新宿  "), "ABC ホテル 新宿");
  assert.equal(normalizePlaceQuery("东京\u0000站"), "东京 站");
  assert.equal(normalizePlaceQuery("a​b"), "a b");
  assert.equal(normalizePlaceQuery("   "), "");
});

test("关键字长短：至少 2 个字、最多 100 个字，按字符数（不按 UTF-16）", () => {
  assert.equal(placeQueryIssue(""), "TOO_SHORT");
  assert.equal(placeQueryIssue("站"), "TOO_SHORT");
  assert.equal(placeQueryIssue("𠮷"), "TOO_SHORT");
  assert.equal(placeQueryIssue("新宿"), null);
  assert.equal(placeQueryIssue("𠮷".repeat(100)), null);
  assert.equal(placeQueryIssue("a".repeat(101)), "TOO_LONG");
});

test("搜索的缓存键：城市 + 关键字，不分大小写", () => {
  assert.equal(placeSearchCacheKey("c1", "Hilton Tokyo"), placeSearchCacheKey("c1", "hilton tokyo"));
  assert.notEqual(placeSearchCacheKey("c1", "hilton"), placeSearchCacheKey("c2", "hilton"));
});

test("反查的键：坐标取整到 4 位（约 11 米），同一个键调谷歌用同一组坐标；无效坐标报错", () => {
  const a = placeReverseKey({ lat: 35.68124, lng: 139.76712 });
  const b = placeReverseKey({ lat: 35.681249, lng: 139.767149 });
  assert.equal(a.key, "reverse:35.6812,139.7671");
  assert.equal(a.key, b.key);
  assert.deepEqual(a.point, { lat: 35.6812, lng: 139.7671 });
  assert.equal(placeReverseKey({ lat: 35.68125, lng: 139.76715 }).key, "reverse:35.6813,139.7672");
  assert.equal(placeReverseKey({ lat: -33.86785, lng: 151.2 }).key, "reverse:-33.8679,151.2000");
  assert.throws(() => placeReverseKey({ lat: 91, lng: 0 }), RangeError);
});

test("城市范围：中心周围 80 公里的正方形；成田（东京站约 60 公里）在里面，大阪不在；纬度、经度夹在合法范围", () => {
  const tokyo = { lat: 35.6812, lng: 139.7671 };
  const bounds = cityBounds(tokyo);
  assert.ok(inBounds({ lat: 35.772, lng: 140.3929 }, bounds));
  assert.ok(!inBounds({ lat: 34.6937, lng: 135.5023 }, bounds));
  assert.ok(Math.abs(bounds.high.lat - tokyo.lat - 80 / 111.32) < 1e-9);
  // 经度方向按纬度放宽：东京一带 1 度经度约 90 公里
  assert.ok(bounds.high.lng - tokyo.lng > bounds.high.lat - tokyo.lat);
  const polar = cityBounds({ lat: 84.9, lng: 179.9 });
  assert.equal(polar.high.lat, 85);
  assert.equal(polar.high.lng, 180);
  assert.equal(PLACE_SEARCH_RULES.cityReachKm, 80);
});

test("冷却：密钥、配额、每日上限 60 秒；网络和对方 15 秒；请求无效、没配置不冷却；每个原因都有归属", () => {
  assert.equal(placeFailureCooldownMs("KEY_INVALID"), 60_000);
  assert.equal(placeFailureCooldownMs("QUOTA_EXCEEDED"), 60_000);
  assert.equal(placeFailureCooldownMs("DAILY_LIMIT_REACHED"), 60_000);
  assert.equal(placeFailureCooldownMs("TIMEOUT"), 15_000);
  assert.equal(placeFailureCooldownMs("UNEXPECTED"), 15_000);
  assert.equal(placeFailureCooldownMs("INVALID_REQUEST"), 0);
  assert.equal(placeFailureCooldownMs("NOT_CONFIGURED"), 0);
  for (const code of PLACE_FAILURE_CODES) assert.equal(typeof placeFailureCooldownMs(code), "number");
});

test("给客人看的文字：去掉控制字符、并空白、超长截短加「…」，不是字符串或清理后为空的是 null", () => {
  assert.equal(cleanPlaceText("  東京駅\n丸の内口 ", 50), "東京駅 丸の内口");
  assert.equal(cleanPlaceText("abcdef", 4), "abc…");
  assert.equal(cleanPlaceText("𠮷𠮷𠮷", 3), "𠮷𠮷𠮷");
  assert.equal(cleanPlaceText("𠮷𠮷𠮷𠮷", 3), "𠮷𠮷…");
  assert.equal(cleanPlaceText("\u0000 ", 10), null);
  assert.equal(cleanPlaceText(42, 10), null);
  assert.equal(cleanPlaceText(undefined, 10), null);
});
