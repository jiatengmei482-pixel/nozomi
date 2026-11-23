/**
 * 法律页面（M9E-24，ADR 0107）：取消费表和「ちょうど…」那句按后台当前的取消政策生成；默认政策下和业主定稿逐字相同。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CANCELLATION_POLICY } from "@nozomi/domain";
import type { CancellationPolicyRule } from "../api/order-money.ts";
import { LEGAL_LINKS, legalBoundarySentence, legalCancellationTable, legalDateText, legalFeeText, legalTierPeriods } from "./legal-pages.ts";

const defaults: CancellationPolicyRule[] = DEFAULT_CANCELLATION_POLICY.map((rule) => ({
  category: rule.category,
  level: rule.level,
  tiers: rule.tiers.map((tier) => ({ min_hours_before: tier.minHoursBefore, fee_bp: tier.feeBp })),
}));

test("默认政策：三行，和定稿的表逐字相同；比例作列（無料 / 50% / 100%）", () => {
  const table = legalCancellationTable(defaults);
  assert.deepEqual(table.feeColumns, ["無料", "50%", "100%"]);
  assert.deepEqual(
    table.rows.map((row) => [row.service, row.vehicles, ...row.tiers.map((tier) => tier.period)]),
    [
      ["空港送迎・地点間送迎", "エコノミー・コンフォート", "24 時間前まで", "24 時間前〜6 時間前", "6 時間前以降"],
      ["空港送迎・地点間送迎", "ビジネス・ラグジュアリー・マイクロバス（10 名以上）", "48 時間前まで", "48 時間前〜24 時間前", "24 時間前以降"],
      ["貸切（チャーター）", "全車種", "48 時間前まで", "48 時間前〜24 時間前", "24 時間前以降"],
    ],
  );
  assert.equal(legalBoundarySentence(defaults), "ちょうど 24 時間前は無料、ちょうど 6 時間前は 50% とします。");
});

test("后台改了：点对点经济型改成 72 小时免费、30% 一档 → 拆开成单独一行（另一种车型阶梯仍相同的照旧合并）；比例序列不一致时不按比例作列；句子跟着「空港送迎・エコノミー」变", () => {
  const changed = defaults.map((rule) =>
    rule.category === "point_to_point" && rule.level === "economy"
      ? { ...rule, tiers: [{ min_hours_before: 72, fee_bp: 0 }, { min_hours_before: 12, fee_bp: 3000 }, { min_hours_before: 0, fee_bp: 10000 }] }
      : rule.category === "airport_transfer" && rule.level === "economy"
        ? { ...rule, tiers: [{ min_hours_before: 36, fee_bp: 0 }, { min_hours_before: 0, fee_bp: 10000 }] }
        : rule,
  );
  const table = legalCancellationTable(changed);
  assert.equal(table.feeColumns, null);
  assert.deepEqual(
    table.rows.map((row) => [row.service, row.vehicles]),
    [
      ["空港送迎", "エコノミー"],
      ["空港送迎・地点間送迎", "コンフォート"],
      ["空港送迎・地点間送迎", "ビジネス・ラグジュアリー・マイクロバス（10 名以上）"],
      ["地点間送迎", "エコノミー"],
      ["貸切（チャーター）", "全車種"],
    ],
  );
  assert.deepEqual(table.rows[3]?.tiers, [
    { period: "72 時間前まで", fee: "無料" },
    { period: "72 時間前〜12 時間前", fee: "30%" },
    { period: "12 時間前以降", fee: "100%" },
  ]);
  assert.equal(legalBoundarySentence(changed), "ちょうど 36 時間前は無料とします。");
});

test("小工具：比例、时间段（只有一档、乱序给的也按从早到晚）、日期", () => {
  assert.equal(legalFeeText(0), "無料");
  assert.equal(legalFeeText(10000), "100%");
  assert.equal(legalFeeText(1250), "12.5%");
  assert.deepEqual(legalTierPeriods([{ min_hours_before: 0, fee_bp: 10000 }]), ["いつでも"]);
  assert.deepEqual(legalTierPeriods([{ min_hours_before: 0, fee_bp: 10000 }, { min_hours_before: 24, fee_bp: 0 }]), ["24 時間前まで", "24 時間前以降"]);
  assert.equal(legalBoundarySentence([{ category: "airport_transfer", level: "economy", tiers: [{ min_hours_before: 0, fee_bp: 10000 }] }]), null);
  assert.equal(legalBoundarySentence([]), null);
  assert.equal(legalDateText("2026-12-01"), "2026 年 12 月 1 日");
  assert.deepEqual(LEGAL_LINKS.map((link) => link.to), ["/legal/tokushoho", "/legal/cancellation", "/legal/privacy"]);
});
