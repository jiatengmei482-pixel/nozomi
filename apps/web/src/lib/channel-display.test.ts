import assert from "node:assert/strict";
import { test } from "node:test";
import { approvalChanges, belowFloorRuleLines, pricingLines } from "./channel-display.ts";

const pricing = { default_markup_bp: 1000, markup_floor_bp: 1000, band_bp: 300, min_margin_minor: 0, sell_rounding: {} };

test("复核的「改之后」：对外价取整只写一遍币种（M1-17，不再是「JPY JPY 100」）", () => {
  const lines = approvalChanges("channel.pricing", pricing, { ...pricing, sell_rounding: { JPY: 100, USD: 50 } }, "JPY");
  assert.deepEqual(lines, [{ label: "对外价取整", before: "不取整", after: "向上取整到 JPY 100；向上取整到 USD 0.50" }]);
  for (const line of lines) assert.doesNotMatch(`${line.before} ${line.after}`, /\b([A-Z]{3}) \1\b/);
});

test("渠道详情的定价参数：对外价取整只写一遍币种", () => {
  const rounding = pricingLines({ default_markup_bp: 1000, markup_floor_bp: 1000, band_bp: 300, min_margin: 0, sell_rounding: { JPY: 100 } }, "JPY").find((line) => line.label === "对外价取整");
  assert.equal(rounding?.value, "向上取整到 JPY 100");
});

test("调高下限被拦：按 details.rule_ids 列出是哪几条规则；规则表里没有的写明刷新后再看", () => {
  const stamps = { created_at: "2026-10-06T00:12:00.000Z", updated_at: "2026-10-08T05:30:00.000Z", version: 1, note: null };
  const rules = [
    { id: "r1", level: 2 as const, tenant: { id: "t", name: "NOZOMI 车队" }, city: null, category: null, vehicle_group: null, markup_bp: 1200, valid_from: null, valid_to: null, ...stamps },
    { id: "r2", level: 4 as const, tenant: null, city: { id: "c", name: "东京" }, category: "airport_transfer" as const, vehicle_group: null, markup_bp: 1150, valid_from: "2026-12-01", valid_to: "2026-12-07", ...stamps },
  ];
  assert.deepEqual(belowFloorRuleLines({ rule_ids: ["r2", "r1", "gone"], floor_bp: 1300 }, rules), [
    "第 4 级 · 东京 · 接送机 = 11.5%（用车日期 2026-12-01 至 2026-12-07）",
    "第 2 级 · NOZOMI 车队 = 12%（用车日期 不限）",
    "有一条规则这里还没有显示（可能刚被改过），刷新页面后再看",
  ]);
  assert.deepEqual(belowFloorRuleLines({}, rules), []);
});
