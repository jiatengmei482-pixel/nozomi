/**
 * M9P-10（规格步骤 2、步骤 5；ADR 0098）：经停点上限只有一个常量、各处引用它；超限提醒「大于」才提醒、先用时后距离、阈值按商品配置。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHARTER_ITINERARY_LIMITS, itineraryWarnings } from "./charter-itinerary-limits.ts";
import { MANUAL_QUOTE_RULES } from "./manual-quote.ts";
import { DEFAULT_CHARTER_ITINERARY, PRODUCT_LIMITS, charterItineraryOf, emptyServiceRules, normalizeServiceRules, serviceRuleIssues } from "./products.ts";
import { QUOTE_RULES } from "./quote.ts";

test("经停点上限 25 个（路径接口一次最多 25 个中间点）：询价、人工报价都引用同一个常量", () => {
  assert.equal(CHARTER_ITINERARY_LIMITS.maxWaypoints, 25);
  assert.equal(QUOTE_RULES.maxWaypoints, CHARTER_ITINERARY_LIMITS.maxWaypoints);
  assert.equal(MANUAL_QUOTE_RULES.maxWaypoints, CHARTER_ITINERARY_LIMITS.maxWaypoints);
});

test("超限提醒：T 大于提醒线 LONG_DURATION、全程大于提醒公里数 LONG_DISTANCE；正好等于不提醒；先用时后距离", () => {
  const defaults = { warnMinutes: 720, warnKm: 360 };
  assert.deepEqual(itineraryWarnings(defaults, { estimatedMinutes: 720, routeMeters: 360_000 }), []);
  assert.deepEqual(itineraryWarnings(defaults, { estimatedMinutes: 721, routeMeters: 360_000 }), ["LONG_DURATION"]);
  assert.deepEqual(itineraryWarnings(defaults, { estimatedMinutes: 720, routeMeters: 360_001 }), ["LONG_DISTANCE"]);
  assert.deepEqual(itineraryWarnings(defaults, { estimatedMinutes: 810, routeMeters: 454_000 }), ["LONG_DURATION", "LONG_DISTANCE"]);
  // 阈值按商品
  assert.deepEqual(itineraryWarnings({ warnMinutes: 600, warnKm: 200 }, { estimatedMinutes: 601, routeMeters: 200_001 }), ["LONG_DURATION", "LONG_DISTANCE"]);
  assert.deepEqual(itineraryWarnings({ warnMinutes: 900, warnKm: 500 }, { estimatedMinutes: 810, routeMeters: 454_000 }), []);
});

test("商品配置：提醒线默认 12 小时 / 360 公里、默认值不存；可设 60–1440 分钟、1–5000 公里的整数；只有包车能设", () => {
  assert.deepEqual([DEFAULT_CHARTER_ITINERARY.warnMinutes, DEFAULT_CHARTER_ITINERARY.warnKm], [720, 360]);
  assert.deepEqual(charterItineraryOf({ charterItinerary: { warnKm: 500 } }), { ...DEFAULT_CHARTER_ITINERARY, warnKm: 500 });
  const allow = (): boolean => true;
  assert.equal("charterItinerary" in normalizeServiceRules({ ...emptyServiceRules(), charterItinerary: { warnMinutes: 720, warnKm: 360 } }, allow), false, "默认值不存");
  assert.deepEqual(normalizeServiceRules({ ...emptyServiceRules(), charterItinerary: { warnMinutes: 600, warnKm: 360 } }, allow).charterItinerary, { warnMinutes: 600 });
  const charter = { pickupPlace: null, category: "charter" as const };
  const issues = (itinerary: Record<string, number>, context: Parameters<typeof serviceRuleIssues>[1] = charter) => serviceRuleIssues({ ...emptyServiceRules(), charterItinerary: itinerary }, context).map((issue) => `${issue.path}:${issue.reason}`);
  assert.deepEqual(issues({ warnMinutes: PRODUCT_LIMITS.minWarnMinutes, warnKm: PRODUCT_LIMITS.minWarnKm }), []);
  assert.deepEqual(issues({ warnMinutes: PRODUCT_LIMITS.maxWarnMinutes, warnKm: PRODUCT_LIMITS.maxWarnKm }), []);
  assert.deepEqual([PRODUCT_LIMITS.minWarnMinutes, PRODUCT_LIMITS.maxWarnMinutes, PRODUCT_LIMITS.minWarnKm, PRODUCT_LIMITS.maxWarnKm], [60, 1_440, 1, 5_000]);
  assert.deepEqual(issues({ warnMinutes: 59, warnKm: 0 }), ["/charter_itinerary/warn_minutes:OUT_OF_RANGE", "/charter_itinerary/warn_km:OUT_OF_RANGE"]);
  assert.deepEqual(issues({ warnMinutes: 1_441, warnKm: 5_001 }), ["/charter_itinerary/warn_minutes:OUT_OF_RANGE", "/charter_itinerary/warn_km:OUT_OF_RANGE"]);
  assert.deepEqual(issues({ warnMinutes: 720.5, warnKm: 360.5 }), ["/charter_itinerary/warn_minutes:NOT_INTEGER", "/charter_itinerary/warn_km:NOT_INTEGER"]);
  assert.deepEqual(issues({ warnKm: 500 }, { pickupPlace: null, category: "point_to_point" }), ["/charter_itinerary:NOT_APPLICABLE"]);
});
