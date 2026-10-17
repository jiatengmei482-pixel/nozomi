import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHANNEL_RULES,
  type MarkupRule,
  channelPricingIssues,
  channelScopeRefusal,
  channelSellsTenant,
  conflictingMarkupRules,
  markupLevelOf,
  markupRuleInEffect,
  markupRuleIssues,
  resolveMarkup,
  rulesBelowFloor,
  samePricing,
} from "./channels.ts";

const T = "tenant-relax";
const OTHER_T = "tenant-other";
const TYO = "city-tyo";
const OSA = "city-osa";
const BIZ7 = "vg-biz7";
const VAN9 = "vg-van9";

const rule = (id: string, dims: Partial<MarkupRule>, markupBp: number, validFrom: string | null = null, validTo: string | null = null): MarkupRule => ({
  id,
  tenantId: null,
  cityId: null,
  category: null,
  vehicleGroupId: null,
  ...dims,
  markupBp,
  validFrom,
  validTo,
});

// 需求文档「加价规则」表里的五个例子
const L1 = rule("r1", { tenantId: T, cityId: TYO, category: "charter", vehicleGroupId: BIZ7 }, 1_200);
const L2 = rule("r2", { tenantId: T }, 1_500);
const L3 = rule("r3", { cityId: TYO, category: "charter", vehicleGroupId: BIZ7 }, 1_250);
const L4 = rule("r4", { cityId: TYO, category: "airport_transfer" }, 1_100);
const ALL = [L4, L3, L2, L1];
const pricing = { defaultMarkupBp: 1_000, rules: ALL };
const ask = (over: Partial<Parameters<typeof resolveMarkup>[1]> = {}) => ({ tenantId: T, cityId: TYO, category: "charter" as const, vehicleGroupId: BIZ7, serviceDate: "2026-11-01", ...over });

test("五级匹配：从最具体的一级往下找，命中第一条即停", () => {
  assert.deepEqual(resolveMarkup(pricing, ask()), { markupBp: 1_200, level: 1, ruleId: "r1" });
  // 换了车型组：第 1 级对不上 → 第 2 级（渠道 × 租户）
  assert.deepEqual(resolveMarkup(pricing, ask({ vehicleGroupId: VAN9 })), { markupBp: 1_500, level: 2, ruleId: "r2" });
  // 换了租户：第 1、2 级都对不上 → 第 3 级
  assert.deepEqual(resolveMarkup(pricing, ask({ tenantId: OTHER_T })), { markupBp: 1_250, level: 3, ruleId: "r3" });
  // 别的租户、接送机：第 4 级
  assert.deepEqual(resolveMarkup(pricing, ask({ tenantId: OTHER_T, category: "airport_transfer", vehicleGroupId: VAN9 })), { markupBp: 1_100, level: 4, ruleId: "r4" });
  // 别的城市：渠道默认
  assert.deepEqual(resolveMarkup(pricing, ask({ tenantId: OTHER_T, cityId: OSA })), { markupBp: 1_000, level: 5, ruleId: null });
});

test("五级匹配：第 2 级（渠道 × 租户）比第 3、4 级的城市规则优先，哪怕比例更低", () => {
  const cheap = rule("r2b", { tenantId: T }, 1_000);
  const res = resolveMarkup({ defaultMarkupBp: 1_000, rules: [L3, cheap] }, ask());
  assert.deepEqual(res, { markupBp: 1_000, level: 2, ruleId: "r2b" });
});

test("日期范围：两端都含；同一级里在促销期内的带日期规则优先于不带日期的", () => {
  const promo = rule("promo", { tenantId: T }, 1_050, "2026-12-01", "2026-12-07");
  const rules = [L2, promo];
  const at = (serviceDate: string) => resolveMarkup({ defaultMarkupBp: 1_000, rules }, ask({ vehicleGroupId: VAN9, serviceDate })).ruleId;
  assert.equal(at("2026-11-30"), "r2");
  assert.equal(at("2026-12-01"), "promo");
  assert.equal(at("2026-12-07"), "promo");
  assert.equal(at("2026-12-08"), "r2");
  assert.equal(markupRuleInEffect({ validFrom: null, validTo: "2026-12-07" }, "1999-01-01"), true);
  assert.equal(markupRuleInEffect({ validFrom: "2026-12-01", validTo: null }, "2026-11-30"), false);
});

test("日期范围：不在范围里的规则当作没有，接着往下一级找；全渠道促销（第 5 级带日期）优先于渠道默认", () => {
  const onlyPromo = rule("p1", { tenantId: T, cityId: TYO, category: "charter", vehicleGroupId: BIZ7 }, 1_100, "2026-12-01", "2026-12-31");
  const channelPromo = rule("p5", {}, 1_050, "2026-11-01", "2026-11-03");
  const rules = [onlyPromo, channelPromo];
  assert.deepEqual(resolveMarkup({ defaultMarkupBp: 1_300, rules }, ask({ serviceDate: "2026-12-31" })), { markupBp: 1_100, level: 1, ruleId: "p1" });
  assert.deepEqual(resolveMarkup({ defaultMarkupBp: 1_300, rules }, ask({ serviceDate: "2026-11-02" })), { markupBp: 1_050, level: 5, ruleId: "p5" });
  assert.deepEqual(resolveMarkup({ defaultMarkupBp: 1_300, rules }, ask({ serviceDate: "2026-11-04" })), { markupBp: 1_300, level: 5, ruleId: null });
});

test("维度组合：只认五种；第 5 级规则必须带日期", () => {
  assert.equal(markupLevelOf(L1), 1);
  assert.equal(markupLevelOf(L2), 2);
  assert.equal(markupLevelOf(L3), 3);
  assert.equal(markupLevelOf(L4), 4);
  assert.equal(markupLevelOf(rule("x", {}, 1_000)), 5);
  assert.equal(markupLevelOf(rule("x", { tenantId: T, cityId: TYO }, 1_000)), null);
  assert.equal(markupLevelOf(rule("x", { cityId: TYO }, 1_000)), null);
  assert.equal(markupLevelOf(rule("x", { cityId: TYO, vehicleGroupId: BIZ7 }, 1_000)), null);
  const { id: _id, ...bad } = rule("x", { tenantId: T, cityId: TYO }, 1_200);
  assert.deepEqual(markupRuleIssues(bad, 1_000), [{ path: "/", reason: "UNSUPPORTED_COMBINATION" }]);
  const { id: _id2, ...undatedChannelWide } = rule("x", {}, 1_200);
  assert.deepEqual(markupRuleIssues(undatedChannelWide, 1_000), [{ path: "/valid_from", reason: "DATES_REQUIRED" }]);
});

test("低于下限被拦：低于渠道下限、低于平台下限（即使渠道下限写低了）都拦；正好等于下限可以", () => {
  const { id: _id, ...base } = L2;
  assert.deepEqual(markupRuleIssues({ ...base, markupBp: 1_199 }, 1_200), [{ path: "/markup_bp", reason: "BELOW_FLOOR" }]);
  assert.deepEqual(markupRuleIssues({ ...base, markupBp: 1_200 }, 1_200), []);
  assert.deepEqual(markupRuleIssues({ ...base, markupBp: 900 }, 500), [{ path: "/markup_bp", reason: "BELOW_FLOOR" }]);
  assert.deepEqual(markupRuleIssues({ ...base, markupBp: 12.5 }, 1_000), [{ path: "/markup_bp", reason: "OUT_OF_RANGE" }]);
  assert.deepEqual(markupRuleIssues({ ...base, markupBp: CHANNEL_RULES.maxMarkupBp + 1 }, 1_000), [{ path: "/markup_bp", reason: "OUT_OF_RANGE" }]);
});

test("日期：要是真实的日期，开始不晚于结束（同一天可以）", () => {
  const { id: _id, ...base } = L2;
  assert.deepEqual(markupRuleIssues({ ...base, validFrom: "2026-02-30", validTo: null }, 1_000), [{ path: "/valid_from", reason: "INVALID_DATE" }]);
  assert.deepEqual(markupRuleIssues({ ...base, validFrom: "2026-12-02", validTo: "2026-12-01" }, 1_000), [{ path: "/valid_to", reason: "DATE_ORDER" }]);
  assert.deepEqual(markupRuleIssues({ ...base, validFrom: "2026-12-01", validTo: "2026-12-01" }, 1_000), []);
});

test("冲突：同一组维度上不带日期的最多一条，带日期的不能重叠；带日期和不带日期可以并存；修改时不和自己比", () => {
  const promo = rule("promo", { tenantId: T }, 1_050, "2026-12-01", "2026-12-07");
  const rules = [L2, promo, L4];
  const { id: _a, ...again } = rule("new", { tenantId: T }, 1_300);
  assert.deepEqual(conflictingMarkupRules(rules, again).map((r) => r.id), ["r2"]);
  assert.deepEqual(conflictingMarkupRules(rules, again, "r2").map((r) => r.id), []);
  const { id: _b, ...touching } = rule("new", { tenantId: T }, 1_300, "2026-12-07", "2026-12-10");
  assert.deepEqual(conflictingMarkupRules(rules, touching).map((r) => r.id), ["promo"]);
  const { id: _c, ...after } = rule("new", { tenantId: T }, 1_300, "2026-12-08", null);
  assert.deepEqual(conflictingMarkupRules(rules, after), []);
  const { id: _d, ...otherTenant } = rule("new", { tenantId: OTHER_T }, 1_300);
  assert.deepEqual(conflictingMarkupRules(rules, otherTenant), []);
});

test("调高下限：列出还用得上、又低于新下限的规则（已经结束的不算）", () => {
  const ended = rule("old", { tenantId: OTHER_T }, 1_000, "2026-01-01", "2026-10-16");
  const today = rule("today", { tenantId: T }, 1_000, "2026-10-01", "2026-10-17");
  assert.deepEqual(rulesBelowFloor([ended, today, L1, L4], 1_150, "2026-10-17").map((r) => r.id), ["today", "r4"]);
});

test("渠道定价参数：下限不低于平台下限 10%，默认加价不低于下限，价格带 0–5%，取整单位是正整数、币种要支持", () => {
  const ok = { defaultMarkupBp: 1_000, markupFloorBp: 1_000, bandBp: 300, minMarginMinor: 0, sellRounding: { JPY: 100 } };
  assert.deepEqual(channelPricingIssues(ok), []);
  assert.deepEqual(channelPricingIssues({ ...ok, markupFloorBp: 999, defaultMarkupBp: 999 }).map((i) => i.reason), ["BELOW_PLATFORM_FLOOR", "BELOW_FLOOR"]);
  assert.deepEqual(channelPricingIssues({ ...ok, markupFloorBp: 1_200 }).map((i) => [i.path, i.reason]), [["/default_markup_bp", "BELOW_FLOOR"]]);
  assert.deepEqual(channelPricingIssues({ ...ok, bandBp: 501 }).map((i) => i.path), ["/band_bp"]);
  assert.deepEqual(channelPricingIssues({ ...ok, bandBp: 0 }), []);
  assert.deepEqual(channelPricingIssues({ ...ok, minMarginMinor: -1 }).map((i) => i.path), ["/min_margin"]);
  assert.deepEqual(channelPricingIssues({ ...ok, sellRounding: { JPY: 0 } }).map((i) => i.path), ["/sell_rounding/JPY"]);
  assert.deepEqual(channelPricingIssues({ ...ok, sellRounding: { EUR: 100 } as never }).map((i) => i.reason), ["UNSUPPORTED_CURRENCY"]);
  assert.equal(samePricing(ok, { ...ok, sellRounding: { JPY: 100 } }), true);
  assert.equal(samePricing(ok, { ...ok, sellRounding: {} }), false);
});

test("授权范围：全部 / 白名单 / 黑名单；城市不限或指定；品类", () => {
  assert.equal(channelSellsTenant({ tenantScope: "all", tenantIds: [] }, T), true);
  assert.equal(channelSellsTenant({ tenantScope: "allow", tenantIds: [T] }, T), true);
  assert.equal(channelSellsTenant({ tenantScope: "allow", tenantIds: [T] }, OTHER_T), false);
  assert.equal(channelSellsTenant({ tenantScope: "deny", tenantIds: [T] }, T), false);
  assert.equal(channelSellsTenant({ tenantScope: "deny", tenantIds: [T] }, OTHER_T), true);
  assert.equal(channelScopeRefusal({ cityIds: null, categories: ["charter"] }, OSA, "charter"), null);
  assert.equal(channelScopeRefusal({ cityIds: [TYO], categories: ["charter"] }, OSA, "charter"), "CITY_NOT_AUTHORIZED");
  assert.equal(channelScopeRefusal({ cityIds: [TYO], categories: ["charter"] }, TYO, "airport_transfer"), "CATEGORY_NOT_AUTHORIZED");
});
