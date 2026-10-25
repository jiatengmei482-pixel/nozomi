import assert from "node:assert/strict";
import { test } from "node:test";
import { approvalChanges, approvalSummaryText, belowFloorRuleLines, pricingLines, relatedPending } from "./channel-display.ts";
import type { Approval } from "../api/channels.ts";
import { formatLocalDateTime } from "./master-display.ts";

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

test("发起前的提醒只看渠道类复核：汇率锁定的复核不算（M1-17 × M2-06）", () => {
  const base = { status: "pending", payload: {} } as unknown as Approval;
  const pending = [{ ...base, id: "p", kind: "channel.pricing" }, { ...base, id: "f", kind: "fx_lock.create" }, { ...base, id: "u", kind: "markup_rule.update", payload: { rule_id: "r1" } }, { ...base, id: "c", kind: "markup_rule.create" }] as Approval[];
  assert.deepEqual(relatedPending({ kind: "pricing" }, pending).map((item) => item.id), ["p", "u", "c"]);
  assert.deepEqual(relatedPending({ kind: "rule", ruleId: "r1" }, pending).map((item) => item.id), ["p", "u"]);
  assert.deepEqual(relatedPending({ kind: "rule", ruleId: null }, pending).map((item) => item.id), ["p"]);
});

test("复核摘要里的 UTC 时刻按查看者本地时区写，和「改了什么」表格里的到期时间一致（M1-18）", () => {
  const expires = "2026-10-26T03:00:00.000Z";
  const shown = approvalSummaryText("锁定 JPY 汇率：1 USD = 151.2 JPY（中央汇率 150，偏离 +0.80%），到 2026-10-26 03:00 UTC");
  assert.equal(shown, `锁定 JPY 汇率：1 USD = 151.2 JPY（中央汇率 150，偏离 +0.80%），到 ${formatLocalDateTime(expires)}`);
  const table = approvalChanges("fx_lock.create", null, { currency: "JPY", rate: "151.2", expires_at: expires, central_rate: "150", deviation_bp: 80 }, null);
  assert.equal(table.find((line) => line.label === "到期时间")?.after, formatLocalDateTime(expires));
  assert.equal(approvalSummaryText("解除 JPY 的锁定（1 USD = 151.2 JPY，原定到 2026-01-01 00:00 UTC），恢复用中央汇率 150"), `解除 JPY 的锁定（1 USD = 151.2 JPY，原定到 ${formatLocalDateTime("2026-01-01T00:00:00Z")}），恢复用中央汇率 150`);
  assert.equal(approvalSummaryText("把默认加价比例从 10% 改为 12%"), "把默认加价比例从 10% 改为 12%", "没有时刻的摘要原样");
});
