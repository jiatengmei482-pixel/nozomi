import assert from "node:assert/strict";
import { test } from "node:test";
import { approvalChanges, pricingLines } from "./channel-display.ts";

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
