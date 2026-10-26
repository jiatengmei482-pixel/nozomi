/**
 * 资质清单「到期日」一列的说法（M4-10）：审核中的那一份也写出供应商填的到期日。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { CompanyOverview } from "../api/onboarding.ts";
import { TENANT_STATUS_HINTS, progressHint, requirementExpiryText } from "./onboarding-display.ts";

const item = (changes: Partial<Parameters<typeof requirementExpiryText>[0]> = {}): Parameters<typeof requirementExpiryText>[0] => ({ expiry: "required", approved_document_id: null, expires_on: null, days_left: null, ...changes });

test("还没有通过的：审核中那一份填了到期日就写出来并标「审核中」；没填、没交、被驳回的写「—」；不需要到期日的写「无到期日」", () => {
  assert.equal(requirementExpiryText(item(), { id: "d1", status: "pending", expires_on: "2027-10-31" }), "2027-10-31（审核中）");
  assert.equal(requirementExpiryText(item(), { id: "d1", status: "pending", expires_on: null }), "—");
  assert.equal(requirementExpiryText(item(), undefined), "—");
  assert.equal(requirementExpiryText(item(), { id: "d1", status: "rejected", expires_on: "2027-10-31" }), "—");
  assert.equal(requirementExpiryText(item({ expiry: "none" }), undefined), "无到期日");
  assert.equal(requirementExpiryText(item({ expiry: "optional" }), { id: "d1", status: "pending", expires_on: "2028-01-01" }), "2028-01-01（审核中）");
});

test("已通过的：写通过的那一份的到期日（快到期带剩几天）；换证时新交的一份在审核中，到期日不同就一并写出", () => {
  const approved = item({ approved_document_id: "d1", expires_on: "2026-11-20", days_left: 25 });
  assert.equal(requirementExpiryText(approved, { id: "d1", status: "approved", expires_on: "2026-11-20" }), "2026-11-20（还有 25 天）");
  assert.equal(requirementExpiryText(item({ approved_document_id: "d1", expires_on: "2026-10-01", days_left: 0 }), { id: "d1", status: "approved", expires_on: "2026-10-01" }), "2026-10-01");
  assert.equal(requirementExpiryText(approved, { id: "d2", status: "pending", expires_on: "2027-11-20" }), "2026-11-20（还有 25 天）；新的一份 2027-11-20（审核中）");
  assert.equal(requirementExpiryText(approved, { id: "d2", status: "pending", expires_on: "2026-11-20" }), "2026-11-20（还有 25 天）");
  assert.equal(requirementExpiryText(approved, { id: "d2", status: "pending", expires_on: null }), "2026-11-20（还有 25 天）");
});

test("入驻进度（审核中）按实际阶段说：资质没审完说正在审核；资质通过只差合同说等合同；都齐了说可以签约；别的状态照常", () => {
  const reviewing = { status: "reviewing" } as CompanyOverview["tenant"];
  const at = (paths: string[], audience: "tenant" | "platform" = "platform") => progressHint({ tenant: reviewing, next_step_issues: paths.map((path) => ({ path, reason: "X" })) }, audience);
  assert.equal(at(["/documents/vehicle_insurance", "/contract"]), "资质正在审核。审核通过、合同生效后签约。");
  assert.equal(at(["/documents/vehicle_insurance"]), "资质正在审核（合同已生效）。审核通过后签约。");
  assert.equal(at(["/contract"]), "资质已全部审核通过。合同生效后可以签约。");
  assert.equal(at([]), "资质已全部审核通过、合同已生效，可以签约。");
  assert.equal(at([], "tenant"), "资质已全部审核通过、合同已生效，等平台签约。");
  assert.equal(at(["/contract"], "tenant"), "资质已全部审核通过。等合同生效后签约。");
  assert.equal(progressHint({ tenant: { status: "signed" } as CompanyOverview["tenant"], next_step_issues: [] }, "platform"), TENANT_STATUS_HINTS.signed);
});
