/** 跨段规则配置：默认值、合并、校验（ADR 0100 第四节表、第五节、第九节 Q2 / Q3）。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { TRIP_RULE_DEFAULTS, effectiveTripRules, tripRuleIssues } from "./rules.ts";

const ctx = { productAreaIds: new Set(["hakone", "tokyo"]), cityIds: new Set(["tyo", "osa"]) };
const reasons = (config: unknown): string[] => tripRuleIssues(config, ctx).map((i) => `${i.path}:${i.reason}`);

test("没存配置：日元商品用默认值（住宿 15,000、停驻 10,000、拘束 13 h 等）", () => {
  const rules = effectiveTripRules(null, "JPY");
  assert.equal(rules.lodging.perNightMinor, 15_000);
  assert.equal(rules.lodging.offsetSurcharges, true);
  assert.equal(rules.idleDay.perDayMinor, 10_000);
  assert.deepEqual(rules.workHours, TRIP_RULE_DEFAULTS.workHours);
  assert.equal(rules.secondDriver.mode, "shortest_package");
  assert.equal(rules.secondDriver.fixedMinor, null);
  assert.equal(rules.bundleAddons.enabled, true);
  assert.equal(rules.returnTrip.ratioBp, 5_000);
  assert.equal(rules.returnTrip.maxOneWayKm, 600);
});

test("非日元商品：默认的住宿 / 停驻金额不生效，只用供应商填的（Q3）", () => {
  assert.equal(effectiveTripRules({}, "USD").lodging.perNightMinor, null);
  assert.equal(effectiveTripRules({}, "USD").idleDay.perDayMinor, null);
  assert.equal(effectiveTripRules({ lodging: { perNightMinor: 9_000 } }, "USD").lodging.perNightMinor, 9_000);
});

test("存的键覆盖默认值，其余照默认", () => {
  const rules = effectiveTripRules({ workHours: { maxBindMinutes: 720 }, lodging: { byArea: [{ areaId: "hakone", perNightMinor: 20_000 }] } }, "JPY");
  assert.equal(rules.workHours.maxBindMinutes, 720);
  assert.equal(rules.workHours.hardMaxBindMinutes, 900);
  assert.deepEqual(rules.lodging.byArea, [{ areaId: "hakone", perNightMinor: 20_000 }]);
  assert.equal(rules.lodging.perNightMinor, 15_000);
});

test("校验：合法配置没有问题", () => {
  assert.deepEqual(
    tripRuleIssues(
      {
        lodging: { enabled: true, perNightMinor: 0, byArea: [{ areaId: "hakone", perNightMinor: 20_000 }], offsetSurcharges: false },
        idleDay: { enabled: false, perDayMinor: 8_000, orShortestPackage: false },
        workHours: { maxBindMinutes: 780, hardMaxBindMinutes: 780, garageMinutes: 0 },
        secondDriver: { enabled: true, mode: "fixed", fixedMinor: 30_000 },
        bundleAddons: { enabled: false },
        returnTrip: { enabled: true, ratioBp: 10_000, fixedByCity: [{ cityId: "osa", minor: 50_000 }], maxOneWayKm: 800 },
      },
      ctx,
    ),
    [],
  );
});

test("校验：未知键、类型、范围", () => {
  assert.deepEqual(reasons(null), [":INVALID"]);
  assert.deepEqual(reasons({ foo: {}, lodging: { enabled: "yes", perNightMinor: -1, extra: 1 } }), ["/foo:UNKNOWN_KEY", "/lodging/extra:UNKNOWN_KEY", "/lodging/enabled:INVALID", "/lodging/perNightMinor:OUT_OF_RANGE"]);
  assert.deepEqual(reasons({ returnTrip: { ratioBp: 10_001, maxOneWayKm: 5_001 } }), ["/returnTrip/ratioBp:OUT_OF_RANGE", "/returnTrip/maxOneWayKm:OUT_OF_RANGE"]);
  assert.deepEqual(reasons({ workHours: { garageMinutes: 2_881 }, secondDriver: { mode: "half" } }), ["/workHours/garageMinutes:OUT_OF_RANGE", "/secondDriver/mode:INVALID"]);
  assert.deepEqual(reasons({ lodging: { perNightMinor: 1_000_000_001 } }), ["/lodging/perNightMinor:OUT_OF_RANGE"]);
  assert.deepEqual(reasons({ idleDay: 3 }), ["/idleDay:INVALID"]);
});

test("校验：拘束上限不能低于常规、绝对最短休息不能长于常规（合并默认值后比较）", () => {
  assert.deepEqual(reasons({ workHours: { maxBindMinutes: 901 } }), ["/workHours/maxBindMinutes:ORDER"]);
  assert.deepEqual(reasons({ workHours: { absoluteMinRestMinutes: 661 } }), ["/workHours/absoluteMinRestMinutes:ORDER"]);
});

test("校验：byArea 只认本商品区域、不重复；fixedByCity 只认启用城市、≤ 50 条", () => {
  assert.deepEqual(reasons({ lodging: { byArea: [{ areaId: "kyoto", perNightMinor: 1 }, { areaId: "tokyo", perNightMinor: 1 }, { areaId: "tokyo", perNightMinor: 2 }] } }), ["/lodging/byArea/0/areaId:AREA_NOT_FOUND", "/lodging/byArea/2/areaId:DUPLICATE"]);
  assert.deepEqual(reasons({ lodging: { byArea: [{ areaId: "tokyo" }, { areaId: "hakone", perNightMinor: 1, x: 1 }] } }), ["/lodging/byArea/0/perNightMinor:OUT_OF_RANGE", "/lodging/byArea/1:INVALID"]);
  assert.deepEqual(reasons({ returnTrip: { fixedByCity: [{ cityId: "nyc", minor: 1 }] } }), ["/returnTrip/fixedByCity/0/cityId:CITY_NOT_FOUND"]);
  assert.deepEqual(reasons({ returnTrip: { fixedByCity: Array.from({ length: 51 }, () => ({ cityId: "tyo", minor: 1 })) } }), ["/returnTrip/fixedByCity:OUT_OF_RANGE"]);
  assert.deepEqual(reasons({ returnTrip: { fixedByCity: "tyo" } }), ["/returnTrip/fixedByCity:INVALID"]);
});
