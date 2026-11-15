/** 跨段费用（ADR 0100 第四节第 0–2、4–6 条；D4 口径监工 2026-11-15 确认）。 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { PriceRule } from "../pricing.ts";
import { type LodgingInput, bundleAddonDiscounts, feeSellMinor, idleDayFee, lodgingFee, returnFee, secondDriverFee, shortestPackagePrice } from "./fees.ts";
import { effectiveTripRules } from "./rules.ts";

const rules = effectiveTripRules(null, "JPY");
const night = (extra: Partial<LodgingInput> = {}): LodgingInput => ({ nightIndex: 1, endInBase: false, nextStartInBase: false, sameVehicleNext: true, overnightAreaIds: [], providedByGuest: false, surchargeOffsetMinor: null, ...extra });

test("住宿：任一端在①里、次日换车、关了 → 不收", () => {
  assert.equal(lodgingFee(night({ endInBase: true }), rules.lodging).choice, "none");
  assert.equal(lodgingFee(night({ nextStartInBase: true }), rules.lodging).choice, "none");
  assert.equal(lodgingFee(night({ sameVehicleNext: false }), rules.lodging).choice, "none");
  assert.equal(lodgingFee(night(), { ...rules.lodging, enabled: false }).choice, "none");
});

test("住宿：①外过夜、没有③加价 → 收 perNight；落在 byArea 区域取区域金额", () => {
  const plain = lodgingFee(night(), rules.lodging);
  assert.equal(plain.choice, "lodging");
  assert.deepEqual(plain.fees.map((f) => [f.type, f.settlementMinor, f.nightIndex]), [["lodging", 15_000, 1]]);
  assert.equal(plain.fees[0]?.calc.source, "perNight");
  const area = lodgingFee(night({ overnightAreaIds: ["hakone"] }), { ...rules.lodging, byArea: [{ areaId: "hakone", perNightMinor: 20_000 }] });
  assert.equal(area.fees[0]?.settlementMinor, 20_000);
  assert.equal(area.fees[0]?.areaId, "hakone");
});

test("住宿与③加价（D4）：住宿比两笔③空驶加价便宜 → 收住宿 + 负数抵扣；不便宜或相等 → 车回基地", () => {
  const stay = lodgingFee(night({ surchargeOffsetMinor: 24_000 }), rules.lodging);
  assert.equal(stay.choice, "lodging");
  assert.deepEqual(stay.fees.map((f) => [f.type, f.settlementMinor]), [["lodging", 15_000], ["lodging_offset", -24_000]]);
  assert.equal(stay.fees[1]?.calc.basis, "before_adjustment");
  assert.equal(lodgingFee(night({ surchargeOffsetMinor: 15_000 }), rules.lodging).choice, "return_to_base");
  assert.deepEqual(lodgingFee(night({ surchargeOffsetMinor: 10_000 }), rules.lodging).fees, []);
  const off = lodgingFee(night({ surchargeOffsetMinor: 24_000 }), { ...rules.lodging, offsetSurcharges: false });
  assert.deepEqual(off.fees.map((f) => f.type), ["lodging"]);
});

test("住宿：客人提供 → 记 0（仍抵掉③空驶）", () => {
  const provided = lodgingFee(night({ providedByGuest: true, surchargeOffsetMinor: 8_000 }), rules.lodging);
  assert.deepEqual(provided.fees.map((f) => [f.type, f.settlementMinor, f.calc.source ?? null]), [["lodging", 0, "provided_by_guest"], ["lodging_offset", -8_000, null]]);
  assert.deepEqual(lodgingFee(night({ providedByGuest: true }), rules.lodging).fees.map((f) => f.settlementMinor), [0]);
});

test("住宿：非日元商品没填金额 → 不收、标 missingPrice", () => {
  const usd = effectiveTripRules(null, "USD");
  assert.deepEqual(lodgingFee(night(), usd.lodging), { choice: "none", fees: [], missingPrice: true });
});

const pkg = (id: string, areaId: string | null, hours: number, minor: number, extra: Partial<PriceRule> = {}): PriceRule & { id: string } => ({
  id,
  areaId,
  vehicleGroupId: "eco7",
  direction: null,
  packageHours: hours,
  pricing: { model: "charter_package", packageKm: 100, packagePriceMinor: minor, overtimePerHourMinor: 5_000, overKmPerKmMinor: 300 },
  validFrom: "2026-01-01",
  validTo: null,
  status: "enabled",
  ...extra,
});

test("最短套餐价：先找过夜点所在的①，再退到商品所有①；只看当天有效、启用、同车型组", () => {
  const list = [pkg("t8", "tokyo", 8, 48_000), pkg("t4", "tokyo", 4, 30_000), pkg("h3", "hakone", 3, 35_000), pkg("x2", null, 2, 20_000, { status: "disabled" }), pkg("old", "tokyo", 1, 1, { validTo: "2026-06-30" }), pkg("big", "tokyo", 1, 1, { vehicleGroupId: "van10" })];
  assert.deepEqual(shortestPackagePrice(list, { vehicleGroupId: "eco7", date: "2027-03-28", preferAreaIds: ["hakone"] }), { minor: 35_000, priceRuleId: "h3", areaId: "hakone", packageHours: 3 });
  assert.deepEqual(shortestPackagePrice(list, { vehicleGroupId: "eco7", date: "2027-03-28", preferAreaIds: ["nikko"] }), { minor: 35_000, priceRuleId: "h3", areaId: "hakone", packageHours: 3 });
  assert.deepEqual(shortestPackagePrice(list, { vehicleGroupId: "eco7", date: "2026-03-28", preferAreaIds: [] })?.priceRuleId, "old");
  assert.equal(shortestPackagePrice(list, { vehicleGroupId: "suv", date: "2027-03-28", preferAreaIds: [] }), null);
  assert.equal(shortestPackagePrice([pkg("a", "tokyo", 4, 30_000), pkg("b", "tokyo", 4, 28_000)], { vehicleGroupId: "eco7", date: "2027-03-28", preferAreaIds: [] })?.priceRuleId, "b");
});

test("停驻：车能回基地 → 不收；留在当地 → min(停驻费, 最短套餐) + 当晚住宿", () => {
  const shortest = { minor: 8_000, priceRuleId: "p", areaId: "hakone", packageHours: 3 };
  const lodging = lodgingFee(night(), rules.lodging).fees;
  assert.deepEqual(idleDayFee({ dayIndex: 2, returnToBaseAvailable: true, shortestPackage: shortest, lodging }, rules.idleDay), { choice: "return_to_base", fees: [] });
  const stay = idleDayFee({ dayIndex: 2, returnToBaseAvailable: false, shortestPackage: shortest, lodging }, rules.idleDay);
  assert.ok("fees" in stay);
  assert.deepEqual(stay.fees.map((f) => [f.type, f.settlementMinor]), [["idle", 8_000], ["lodging", 15_000]]);
  const noPkg = idleDayFee({ dayIndex: 2, returnToBaseAvailable: false, shortestPackage: null, lodging: [] }, rules.idleDay);
  assert.ok("fees" in noPkg);
  assert.deepEqual(noPkg.fees.map((f) => [f.type, f.settlementMinor, f.calc.source]), [["idle", 10_000, "perDay"]]);
});

test("停驻：非日元、没最短套餐 → 报不出；关了停驻 → 只收住宿", () => {
  assert.deepEqual(idleDayFee({ dayIndex: 2, returnToBaseAvailable: false, shortestPackage: null, lodging: [] }, effectiveTripRules(null, "USD").idleDay), { unquoted: "IDLE_DAY_PRICE_UNAVAILABLE" });
  const off = idleDayFee({ dayIndex: 2, returnToBaseAvailable: false, shortestPackage: null, lodging: lodgingFee(night(), rules.lodging).fees }, { ...rules.idleDay, enabled: false });
  assert.ok("fees" in off);
  assert.deepEqual(off.fees.map((f) => f.type), ["lodging"]);
});

test("第二司机费：最短套餐价；取不到退固定金额；都没有为 null", () => {
  const shortest = { minor: 30_000, priceRuleId: "p", areaId: "tokyo", packageHours: 4 };
  assert.equal(secondDriverFee({ dayIndex: 1, reasons: ["BIND_OVER"], shortestPackage: shortest }, rules.secondDriver)?.settlementMinor, 30_000);
  assert.equal(secondDriverFee({ dayIndex: 1, reasons: [], shortestPackage: null }, rules.secondDriver), null);
  const fixed = { ...rules.secondDriver, mode: "fixed" as const, fixedMinor: 25_000 };
  assert.deepEqual([secondDriverFee({ dayIndex: 1, reasons: ["REST_SHORT"], shortestPackage: shortest }, fixed)?.settlementMinor, secondDriverFee({ dayIndex: 1, reasons: [], shortestPackage: shortest }, fixed)?.calc.source], [25_000, "fixed"]);
});

test("附加项去重：同一按次项第二次起负数抵掉；按件 / 按人照收；关了不抵", () => {
  const lines = [
    { dayIndex: 0, addonId: "seat", chargeUnit: "per_order" as const, amountMinor: 2_000 },
    { dayIndex: 0, addonId: "bag", chargeUnit: "per_item" as const, amountMinor: 500 },
    { dayIndex: 1, addonId: "seat", chargeUnit: "per_order" as const, amountMinor: 2_000 },
    { dayIndex: 1, addonId: "bag", chargeUnit: "per_item" as const, amountMinor: 500 },
    { dayIndex: 2, addonId: "seat", chargeUnit: "per_order" as const, amountMinor: 0 },
  ];
  assert.deepEqual(bundleAddonDiscounts(lines, rules.bundleAddons).map((f) => [f.type, f.dayIndex, f.settlementMinor]), [["bundle_discount", 1, -2_000]]);
  assert.deepEqual(bundleAddonDiscounts(lines, { enabled: false }), []);
});

test("返程（只做函数，P1 不接入）：比例价与城市固定价取低；超范围转人工", () => {
  const r = rules.returnTrip;
  assert.deepEqual(returnFee({ returnKm: 100, overKmPerKmMinor: 300, fixedByCityMinor: null }, r), { minor: 15_000, source: "ratio" });
  assert.deepEqual(returnFee({ returnKm: 100, overKmPerKmMinor: 300, fixedByCityMinor: 12_000 }, r), { minor: 12_000, source: "fixed" });
  assert.deepEqual(returnFee({ returnKm: 0.5, overKmPerKmMinor: 3, fixedByCityMinor: null }, r), { minor: 1, source: "ratio" });
  assert.deepEqual(returnFee({ returnKm: 601, overKmPerKmMinor: 300, fixedByCityMinor: null }, r), { handoff: "RETURN_TOO_FAR" });
  assert.deepEqual(returnFee({ returnKm: 10, overKmPerKmMinor: null, fixedByCityMinor: null }, r), { handoff: "RETURN_PRICE_UNAVAILABLE" });
  assert.equal(returnFee({ returnKm: 10, overKmPerKmMinor: 300, fixedByCityMinor: null }, { ...r, enabled: false }), null);
  assert.throws(() => returnFee({ returnKm: -1, overKmPerKmMinor: 300, fixedByCityMinor: null }, r), RangeError);
});

test("跨段费用对外价：按段的加价换算，不套最低毛利；负数取负；缺汇率为 null", () => {
  const same = { settlementCurrency: "JPY" as const, currency: "JPY" as const, markupBp: 1_500, fxBufferBp: 0, fx: null };
  assert.equal(feeSellMinor(15_000, same), 17_250);
  assert.equal(feeSellMinor(-24_000, same), -27_600);
  assert.equal(feeSellMinor(0, same), 0);
  assert.equal(feeSellMinor(15_000, { ...same, markupBp: 500 }), 15_750);
  assert.equal(feeSellMinor(15_000, { ...same, currency: "USD" }), null);
});
