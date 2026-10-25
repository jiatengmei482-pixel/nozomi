import assert from "node:assert/strict";
import { test } from "node:test";
import {
  type DocumentFact,
  type ScoreInput,
  type StandingInput,
  TENANT_RULES,
  TENANT_STATUSES,
  TENANT_TRIGGERS,
  cleanFileName,
  computeTenantScore,
  contractIssues,
  daysUntilExpiry,
  detectDocumentFileType,
  documentInputIssues,
  documentRequirements,
  documentValidOn,
  effectiveContract,
  evaluateTenantStanding,
  expiryReminderDue,
  requiredDocumentsExpired,
  noShowWindowStart,
  requiredDocumentTypes,
  requiredDocumentsValid,
  scoreWindowStart,
  signIssues,
  startTrialIssues,
  submitIssues,
  tenantBids,
  tenantCanPublish,
  tenantDayStart,
  tenantDate,
  tenantReadOnly,
  tenantTransition,
  trialPromotionDue,
} from "./tenants.ts";

// ---- 状态机 ----

test("状态机：申请中 → 审核中（供应商）→ 已签约（运营）→ 试运营（运营）→ 正式（系统）；暂停 / 恢复回到暂停之前的状态；清退", () => {
  assert.deepEqual(tenantTransition("applying", "submit", "tenant"), { ok: true, to: "reviewing" });
  assert.deepEqual(tenantTransition("reviewing", "return", "platform"), { ok: true, to: "applying" });
  assert.deepEqual(tenantTransition("reviewing", "sign", "platform"), { ok: true, to: "signed" });
  assert.deepEqual(tenantTransition("signed", "start_trial", "platform"), { ok: true, to: "trial" });
  assert.deepEqual(tenantTransition("trial", "promote", "system"), { ok: true, to: "active" });
  assert.deepEqual(tenantTransition("active", "suspend", "platform"), { ok: true, to: "suspended" });
  assert.deepEqual(tenantTransition("trial", "suspend", "system"), { ok: true, to: "suspended" });
  assert.deepEqual(tenantTransition("suspended", "resume", "platform", "trial"), { ok: true, to: "trial" });
  assert.deepEqual(tenantTransition("suspended", "resume", "system", "active"), { ok: true, to: "active" });
  for (const from of ["applying", "reviewing", "signed", "trial", "active", "suspended"] as const) assert.deepEqual(tenantTransition(from, "terminate", "platform"), { ok: true, to: "terminated" }, from);
});

test("状态机：谁能触发——提交审核只有供应商，签约 / 试运营只有运营，转正式只有系统，清退只有运营", () => {
  assert.deepEqual(tenantTransition("applying", "submit", "platform"), { ok: false, refusal: "TENANT_TRIGGER_NOT_ALLOWED" });
  assert.deepEqual(tenantTransition("reviewing", "sign", "tenant"), { ok: false, refusal: "TENANT_TRIGGER_NOT_ALLOWED" });
  assert.deepEqual(tenantTransition("signed", "start_trial", "system"), { ok: false, refusal: "TENANT_TRIGGER_NOT_ALLOWED" });
  assert.deepEqual(tenantTransition("trial", "promote", "platform"), { ok: false, refusal: "TENANT_TRIGGER_NOT_ALLOWED" });
  assert.deepEqual(tenantTransition("active", "terminate", "system"), { ok: false, refusal: "TENANT_TRIGGER_NOT_ALLOWED" });
  assert.deepEqual(tenantTransition("active", "suspend", "tenant"), { ok: false, refusal: "TENANT_TRIGGER_NOT_ALLOWED" });
});

test("状态机：当前状态不允许的一律拒绝；全部组合里只有表里列出的那些能走通；已清退是终态", () => {
  const allowed = new Set([
    "applying:submit", "reviewing:return", "reviewing:sign", "signed:start_trial", "trial:promote",
    "trial:suspend", "active:suspend", "suspended:suspend", "suspended:resume",
    ...["applying", "reviewing", "signed", "trial", "active", "suspended"].map((from) => `${from}:terminate`),
  ]);
  for (const status of TENANT_STATUSES) {
    for (const trigger of TENANT_TRIGGERS) {
      const results = (["tenant", "platform", "system"] as const).map((by) => tenantTransition(status, trigger, by, "active"));
      const ok = results.some((result) => result.ok);
      assert.equal(ok, allowed.has(`${status}:${trigger}`), `${status} · ${trigger}`);
    }
  }
  // 恢复要知道回到哪里：暂停之前只能是试运营或正式
  assert.deepEqual(tenantTransition("suspended", "resume", "platform", null), { ok: false, refusal: "TENANT_STATE_INVALID" });
  assert.deepEqual(tenantTransition("suspended", "resume", "platform", "signed"), { ok: false, refusal: "TENANT_STATE_INVALID" });
});

test("哪些状态参与比价、能上架、只读：只有试运营和正式参与比价；暂停的可以上架（不参与比价）；已清退只读", () => {
  assert.deepEqual(TENANT_STATUSES.filter(tenantBids), ["trial", "active"]);
  assert.deepEqual(TENANT_STATUSES.filter(tenantCanPublish), ["trial", "active", "suspended"]);
  assert.deepEqual(TENANT_STATUSES.filter(tenantReadOnly), ["terminated"]);
});

// ---- 资质 ----

const doc = (type: DocumentFact["type"], status: DocumentFact["status"], expiresOn: string | null, submittedAt: string, id = `${type}-${submittedAt}`): DocumentFact => ({ id, type, status, expiresOn, seq: Date.parse(submittedAt) });

test("必交资料清单按国家：日本五项（含营运车辆商业保险），其他国家按《用车报价服务平台》的四项", () => {
  assert.deepEqual(requiredDocumentTypes("JP"), ["commercial_registration", "passenger_transport_license", "passenger_liability_insurance", "vehicle_insurance", "settlement_account"]);
  assert.deepEqual(requiredDocumentTypes("KR"), ["business_license", "passenger_transport_license", "vehicle_insurance", "settlement_account"]);
  assert.deepEqual(requiredDocumentTypes(null), requiredDocumentTypes("KR"));
});

test("到期：到期日当天起不算有效（「到期当天租户自动转暂停」）；前一天还有效；没有到期日一直有效", () => {
  assert.equal(daysUntilExpiry("2026-11-01", "2026-10-31"), 1);
  assert.equal(daysUntilExpiry("2026-11-01", "2026-11-01"), 0);
  assert.equal(daysUntilExpiry("2026-11-01", "2026-11-03"), -2);
  assert.equal(documentValidOn({ expiresOn: "2026-11-01" }, "2026-10-31"), true);
  assert.equal(documentValidOn({ expiresOn: "2026-11-01" }, "2026-11-01"), false);
  assert.equal(documentValidOn({ expiresOn: null }, "2099-01-01"), true);
  // 跨夏令时、跨年都按日历天算
  assert.equal(daysUntilExpiry("2027-01-01", "2026-12-31"), 1);
});

test("资质现状：通过的最新一份生效；30 天内到期是 expiring、到期当天起 expired；没通过的看最近一次提交；补充材料列在后面", () => {
  const today = "2026-10-25";
  const documents = [
    doc("passenger_transport_license", "approved", "2026-11-20", "2026-01-01T00:00:00Z"),
    doc("passenger_transport_license", "pending", "2027-11-20", "2026-10-20T00:00:00Z"),
    doc("vehicle_insurance", "approved", "2026-10-25", "2026-01-02T00:00:00Z"),
    doc("passenger_liability_insurance", "rejected", "2027-01-01", "2026-10-01T00:00:00Z"),
    doc("commercial_registration", "supplement_requested", null, "2026-10-02T00:00:00Z"),
    doc("settlement_account", "approved", null, "2026-01-01T00:00:00Z"),
    doc("other", "pending", null, "2026-10-03T00:00:00Z"),
  ];
  const items = documentRequirements("JP", documents, today);
  assert.deepEqual(items.map((item) => [item.type, item.required, item.state, item.daysLeft]), [
    ["commercial_registration", true, "supplement_requested", null],
    ["passenger_transport_license", true, "expiring", 26],
    ["passenger_liability_insurance", true, "rejected", null],
    ["vehicle_insurance", true, "expired", 0],
    ["settlement_account", true, "approved", null],
    ["other", false, "pending", null],
  ]);
  assert.equal(items[1]?.latest?.status, "pending", "换证的那份在审核中，原来的照常生效");
  assert.equal(requiredDocumentsValid(items), false);
  // 「过期」只算通过过、到了到期日的；没交过、被驳回的不算过期（M4-01 之前就在运营的供应商不会因为没有资质记录被自动暂停）
  assert.deepEqual(requiredDocumentsExpired(items), ["vehicle_insurance"]);
  assert.deepEqual(requiredDocumentsExpired(documentRequirements("JP", [], today)), []);
  const fine = documentRequirements("JP", documents.map((entry) => ({ ...entry, status: "approved", expiresOn: entry.expiresOn === null ? null : "2027-06-01" })), today);
  assert.equal(requiredDocumentsValid(fine), true);
  // 没有交过的是 missing；被取代的不算
  assert.equal(documentRequirements("JP", [doc("settlement_account", "superseded", null, "2026-01-01T00:00:00Z")], today).find((item) => item.type === "settlement_account")?.state, "missing");
});

test("提交审核：企业信息每项必填、必交资质每项要有在审核中或已通过且没过期的；签约要全部通过加一份已生效的合同", () => {
  const today = "2026-10-25";
  const profile = { countryCode: "JP", legalName: "株式会社 例", registrationNo: "0100-01-000000", address: "东京都", contactName: "山田", contactPhone: "+81312345678", contactEmail: "a@example.com" };
  const all = requiredDocumentTypes("JP").map((type, index) => doc(type, "pending", type === "commercial_registration" || type === "settlement_account" ? null : "2027-10-01", `2026-10-0${index + 1}T00:00:00Z`));
  assert.deepEqual(submitIssues(profile, documentRequirements("JP", all, today)), []);
  assert.deepEqual(submitIssues(null, documentRequirements("JP", [], today)).map((issue) => `${issue.path}:${issue.reason}`), [
    "/company/country_code:REQUIRED", "/company/legal_name:REQUIRED", "/company/registration_no:REQUIRED", "/company/address:REQUIRED", "/company/contact_name:REQUIRED", "/company/contact_phone:REQUIRED", "/company/contact_email:REQUIRED",
    ...requiredDocumentTypes("JP").map((type) => `/documents/${type}:DOCUMENT_MISSING`),
  ]);
  const rejected = all.map((entry) => (entry.type === "vehicle_insurance" ? { ...entry, status: "rejected" as const } : entry));
  assert.deepEqual(submitIssues({ ...profile, address: "  " }, documentRequirements("JP", rejected, today)).map((issue) => issue.reason), ["REQUIRED", "DOCUMENT_NEEDS_RESUBMISSION"]);
  // 交上来以后（还在审核中）就过了到期日：要换一份
  const stale = all.map((entry) => (entry.type === "vehicle_insurance" ? { ...entry, expiresOn: "2026-10-25" } : entry));
  assert.deepEqual(submitIssues(profile, documentRequirements("JP", stale, today)).map((issue) => `${issue.path}:${issue.reason}`), ["/documents/vehicle_insurance:DOCUMENT_EXPIRED"]);

  const approved = all.map((entry) => ({ ...entry, status: "approved" as const }));
  assert.deepEqual(signIssues(documentRequirements("JP", approved, today), true), []);
  assert.deepEqual(signIssues(documentRequirements("JP", approved, today), false).map((issue) => issue.reason), ["CONTRACT_NOT_EFFECTIVE"]);
  assert.deepEqual(signIssues(documentRequirements("JP", all, today), true).map((issue) => issue.reason), requiredDocumentTypes("JP").map(() => "DOCUMENT_NOT_APPROVED"));
});

test("开始试运营：至少 1 个商品通过上架校验、测试单说明必填、资质仍然有效", () => {
  assert.deepEqual(startTrialIssues({ publishableProducts: 1, testOrderNote: "测试单 NZ… 已完成", documentsValid: true }), []);
  assert.deepEqual(startTrialIssues({ publishableProducts: 0, testOrderNote: " ", documentsValid: false }).map((issue) => issue.reason), ["NO_PUBLISHABLE_PRODUCT", "REQUIRED", "DOCUMENTS_INVALID"]);
});

test("转正式：试运营满 30 天（按时刻，差 1 毫秒都不行）、完成 ≥ 20 单、没有重大投诉，三条同时满足", () => {
  const trialStartedAt = new Date("2026-09-01T03:00:00Z");
  const exactly = new Date(trialStartedAt.getTime() + 30 * 86_400_000);
  assert.equal(trialPromotionDue({ trialStartedAt, now: exactly, completedSinceTrial: 20, majorComplaintsSinceTrial: 0 }), true);
  assert.equal(trialPromotionDue({ trialStartedAt, now: new Date(exactly.getTime() - 1), completedSinceTrial: 20, majorComplaintsSinceTrial: 0 }), false);
  assert.equal(trialPromotionDue({ trialStartedAt, now: exactly, completedSinceTrial: 19, majorComplaintsSinceTrial: 0 }), false);
  assert.equal(trialPromotionDue({ trialStartedAt, now: exactly, completedSinceTrial: 100, majorComplaintsSinceTrial: 1 }), false);
});

test("提交资质的检查：有到期日的类型必填到期日、不能已到期（今天到期也不行）；没有到期日的类型不能填；日期要真实存在", () => {
  const today = "2026-10-25";
  assert.deepEqual(documentInputIssues({ type: "vehicle_insurance", expiresOn: "2026-10-26", note: null }, today), []);
  assert.deepEqual(documentInputIssues({ type: "vehicle_insurance", expiresOn: null, note: null }, today), [{ path: "/expires_on", reason: "REQUIRED" }]);
  assert.deepEqual(documentInputIssues({ type: "vehicle_insurance", expiresOn: "2026-10-25", note: null }, today), [{ path: "/expires_on", reason: "ALREADY_EXPIRED", detail: { today } }]);
  assert.deepEqual(documentInputIssues({ type: "vehicle_insurance", expiresOn: "2027-02-30", note: null }, today), [{ path: "/expires_on", reason: "INVALID_DATE" }]);
  assert.deepEqual(documentInputIssues({ type: "settlement_account", expiresOn: "2027-01-01", note: null }, today), [{ path: "/expires_on", reason: "NOT_APPLICABLE" }]);
  assert.deepEqual(documentInputIssues({ type: "business_license", expiresOn: null, note: null }, today), [], "营业执照的到期日可填可不填");
  assert.deepEqual(documentInputIssues({ type: "passport", expiresOn: null, note: null }, today), [{ path: "/type", reason: "UNKNOWN_DOCUMENT_TYPE" }]);
  assert.deepEqual(documentInputIssues({ type: "other", expiresOn: null, note: "x".repeat(501) }, today), [{ path: "/note", reason: "TOO_LONG", detail: { max: 500 } }]);
});

test("到期提醒：到期前 30 天、7 天各一次；7 天内只发 7 天那档（30 天那档错过不补）；到期当天及以后不发「快到期」", () => {
  assert.equal(expiryReminderDue(31, []), null);
  assert.equal(expiryReminderDue(30, []), 30);
  assert.equal(expiryReminderDue(30, [30]), null);
  assert.equal(expiryReminderDue(8, [30]), null);
  assert.equal(expiryReminderDue(7, [30]), 7);
  assert.equal(expiryReminderDue(3, []), 7);
  assert.equal(expiryReminderDue(3, [7]), null);
  assert.equal(expiryReminderDue(0, []), null);
  assert.equal(expiryReminderDue(null, []), null);
});

test("文件格式按开头的字节判断：PDF、JPEG、PNG；别的（GIF、HTML、空文件、只有一半签名）都不认", () => {
  const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);
  assert.equal(detectDocumentFileType(new TextEncoder().encode("%PDF-1.7\n")), "application/pdf");
  assert.equal(detectDocumentFileType(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00)), "image/jpeg");
  assert.equal(detectDocumentFileType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00)), "image/png");
  assert.equal(detectDocumentFileType(new TextEncoder().encode("GIF89a")), null);
  assert.equal(detectDocumentFileType(new TextEncoder().encode("<html><script>")), null);
  assert.equal(detectDocumentFileType(bytes()), null);
  assert.equal(detectDocumentFileType(bytes(0x89, 0x50, 0x4e)), null);
  assert.equal(detectDocumentFileType(new TextEncoder().encode("%PDF")), null);
});

test("文件名：去掉路径、控制字符和引号，最长 200 个字符；空的叫「文件」", () => {
  assert.equal(cleanFileName("C:\\Users\\a\\营业执照.pdf"), "营业执照.pdf");
  assert.equal(cleanFileName("../../etc/passwd"), "passwd");
  assert.equal(cleanFileName('a"b\u0000c\u202e.png'), "abc.png");
  assert.equal(cleanFileName(null), "文件");
  assert.equal(cleanFileName("   "), "文件");
  assert.equal([...cleanFileName("証".repeat(300))].length, 200);
});

test("合同版本：生效日期不早于今天、晚于已有的最后一个版本；某一天生效的是生效日期不晚于它的最后一个", () => {
  assert.deepEqual(contractIssues({ validFrom: "2026-10-25", note: null }, { today: "2026-10-25", latestValidFrom: null }), []);
  assert.deepEqual(contractIssues({ validFrom: "2026-10-24", note: null }, { today: "2026-10-25", latestValidFrom: null }).map((issue) => issue.reason), ["IN_THE_PAST"]);
  assert.deepEqual(contractIssues({ validFrom: "2026-11-01", note: null }, { today: "2026-10-25", latestValidFrom: "2026-11-01" }).map((issue) => issue.reason), ["NOT_AFTER_LATEST"]);
  assert.deepEqual(contractIssues({ validFrom: "2026-13-01", note: null }, { today: "2026-10-25", latestValidFrom: null }).map((issue) => issue.reason), ["INVALID_DATE"]);
  const versions = [{ validFrom: "2026-10-01", v: 1 }, { validFrom: "2026-11-01", v: 2 }];
  assert.equal(effectiveContract(versions, "2026-09-30"), null);
  assert.equal(effectiveContract(versions, "2026-10-31")?.v, 1);
  assert.equal(effectiveContract(versions, "2026-11-01")?.v, 2);
});

// ---- 评分 ----

const input = (extra: Partial<ScoreInput> = {}): ScoreInput => ({
  completedOrders: 40,
  dispatch: { onTime: 40, total: 40 },
  arrival: { onTime: 40, total: 40 },
  ratings: { sum: 200, count: 40 },
  upheldComplaints: 0,
  failures: 0,
  ...extra,
});

test("评分：全部满分是 5.00；五项按 25 / 25 / 20 / 20 / 10 加权", () => {
  const full = computeTenantScore(input());
  assert.deepEqual([full.rawScoreCenti, full.scoreCenti, full.isDefault], [500, 500, false]);
  assert.deepEqual(Object.values(full.components).map((component) => component.weightBp), [2_500, 2_500, 2_000, 2_000, 1_000]);
  // 按时派车率 80%（4 分）、准时到达率 90%（4.5 分）、均分 4.2、投诉 2/40（4.75 分）、失败 1/41（≈4.878 分）
  const mixed = computeTenantScore(input({ dispatch: { onTime: 32, total: 40 }, arrival: { onTime: 36, total: 40 }, ratings: { sum: 168, count: 40 }, upheldComplaints: 2, failures: 1 }));
  // 0.25×4 + 0.25×4.5 + 0.2×4.2 + 0.2×4.75 + 0.1×(5×40/41) = 1 + 1.125 + 0.84 + 0.95 + 0.48780… = 4.40280… → 4.40
  assert.equal(mixed.rawScoreCenti, 440);
  assert.deepEqual(mixed.components.dispatch, { value: 8_000, pointsCenti: 400, weightBp: 2_500 });
  assert.deepEqual(mixed.components.rating, { value: 420, pointsCenti: 420, weightBp: 2_000 });
  assert.deepEqual(mixed.components.complaint, { value: 500, pointsCenti: 475, weightBp: 2_000 });
  assert.deepEqual(mixed.components.failure, { value: 244, pointsCenti: 488, weightBp: 1_000 });
});

test("评分：没有数据的项不算，其余权重按比例放大；一项都没有为 null（用默认分）", () => {
  // 只有完成订单（没有派车、到达、评价记录）：投诉 0（5 分）和失败 0（5 分）两项，各占 20/30、10/30
  const onlyOrders = computeTenantScore({ completedOrders: 25, dispatch: { onTime: 0, total: 0 }, arrival: { onTime: 0, total: 0 }, ratings: { sum: 0, count: 0 }, upheldComplaints: 5, failures: 0 });
  // (20×(5×20/25) + 10×5) / 30 = (80 + 50) / 30 = 4.333… → 4.33
  assert.equal(onlyOrders.rawScoreCenti, 433);
  assert.deepEqual([onlyOrders.components.dispatch.weightBp, onlyOrders.components.complaint.weightBp, onlyOrders.components.failure.weightBp], [0, 6_667, 3_333]);
  assert.equal(onlyOrders.components.dispatch.pointsCenti, null);
  const nothing = computeTenantScore({ completedOrders: 0, dispatch: { onTime: 0, total: 0 }, arrival: { onTime: 0, total: 0 }, ratings: { sum: 0, count: 0 }, upheldComplaints: 0, failures: 0 });
  assert.deepEqual([nothing.rawScoreCenti, nothing.scoreCenti, nothing.isDefault], [null, 450, true]);
});

test("评分：完成不足 20 单用默认 4.5（按数据的分照样算出来给人看）；正好 20 单开始用真实的分", () => {
  const nineteen = computeTenantScore(input({ completedOrders: 19, ratings: { sum: 19, count: 19 } }));
  assert.equal(nineteen.isDefault, true);
  assert.equal(nineteen.scoreCenti, 450);
  assert.ok(nineteen.rawScoreCenti !== null && nineteen.rawScoreCenti < 450);
  const twenty = computeTenantScore(input({ completedOrders: 20, ratings: { sum: 20, count: 20 } }));
  assert.equal(twenty.isDefault, false);
  assert.equal(twenty.scoreCenti, twenty.rawScoreCenti);
});

test("评分：投诉多于完成单数按 100% 算；按时数多于总数按总数算；四舍五入到百分之一分（.005 进位）；输入不是非负整数时报错", () => {
  const worst = computeTenantScore(input({ upheldComplaints: 99, dispatch: { onTime: 50, total: 40 } }));
  assert.equal(worst.components.complaint.pointsCenti, 0);
  assert.equal(worst.components.dispatch.pointsCenti, 500);
  // 只有评价一项：均分 4.125 → 4.13（四舍五入，进位）
  const rounding = computeTenantScore({ completedOrders: 0, dispatch: { onTime: 0, total: 0 }, arrival: { onTime: 0, total: 0 }, ratings: { sum: 33, count: 8 }, upheldComplaints: 0, failures: 0 });
  assert.equal(rounding.rawScoreCenti, 413);
  assert.throws(() => computeTenantScore(input({ failures: -1 })), RangeError);
  assert.throws(() => computeTenantScore(input({ completedOrders: 1.5 })), RangeError);
});

test("评分窗口：90 天（今天往前 89 天起）；司机未到 30 天；「今天」和 0 点按东京时间", () => {
  assert.equal(scoreWindowStart("2026-10-25"), "2026-07-28");
  assert.equal(noShowWindowStart("2026-10-25"), "2026-09-26");
  assert.equal(TENANT_RULES.timeZone, "Asia/Tokyo");
  // 东京 10-25 00:30 = UTC 10-24 15:30
  assert.equal(tenantDate(new Date("2026-10-24T15:30:00Z")), "2026-10-25");
  assert.equal(tenantDate(new Date("2026-10-24T14:59:59Z")), "2026-10-24");
  assert.equal(tenantDayStart(new Date("2026-10-24T15:30:00Z")).toISOString(), "2026-10-24T15:00:00.000Z");
});

// ---- 每天的自动判断 ----

const standing = (extra: Partial<StandingInput> = {}): StandingInput => ({
  status: "active",
  suspensionReasons: [],
  previousDataScoreCenti: 450,
  scoreCenti: 450,
  isDefaultScore: false,
  previousNoShows: 0,
  noShows: 0,
  documentsValid: true,
  ...extra,
});

test("观察期：评分低于 4.00 进入（3.99 进、4.00 不进）；默认分不触发；回到 4.00 自动退出", () => {
  assert.deepEqual(evaluateTenantStanding(standing({ scoreCenti: 399 })).observation, ["score_below_threshold"]);
  assert.deepEqual(evaluateTenantStanding(standing({ scoreCenti: 400 })).observation, []);
  assert.deepEqual(evaluateTenantStanding(standing({ scoreCenti: 300, isDefaultScore: true })).observation, []);
  assert.deepEqual(evaluateTenantStanding(standing({ status: "trial", scoreCenti: 380 })).observation, ["score_below_threshold"]);
  assert.deepEqual(evaluateTenantStanding(standing({ status: "suspended", suspensionReasons: ["manual"], scoreCenti: 380 })).observation, ["score_below_threshold"], "暂停中照样重算，恢复后马上生效");
  for (const status of ["applying", "reviewing", "signed", "terminated"] as const) assert.deepEqual(evaluateTenantStanding(standing({ status, scoreCenti: 100, documentsValid: false })), { observation: [], suspend: [], clearDocumentExpired: false }, status);
});

test("自动暂停：评分跌破 3.50（3.49 暂停、3.50 不暂停）；上一次已经低于 3.50（运营恢复后还没回升）不再触发；回升后再跌破又触发；第一次算就低于也触发", () => {
  assert.deepEqual(evaluateTenantStanding(standing({ previousDataScoreCenti: 360, scoreCenti: 349 })).suspend, ["score_below_red_line"]);
  assert.deepEqual(evaluateTenantStanding(standing({ previousDataScoreCenti: 360, scoreCenti: 350 })).suspend, []);
  assert.deepEqual(evaluateTenantStanding(standing({ previousDataScoreCenti: 340, scoreCenti: 330 })).suspend, []);
  assert.deepEqual(evaluateTenantStanding(standing({ previousDataScoreCenti: 350, scoreCenti: 349 })).suspend, ["score_below_red_line"]);
  assert.deepEqual(evaluateTenantStanding(standing({ previousDataScoreCenti: null, scoreCenti: 300 })).suspend, ["score_below_red_line"]);
  assert.deepEqual(evaluateTenantStanding(standing({ previousDataScoreCenti: 450, scoreCenti: 300, isDefaultScore: true })).suspend, [], "默认分不触发");
  // 低于 3.5 同时也低于 4.0：观察和暂停一起
  assert.deepEqual(evaluateTenantStanding(standing({ previousDataScoreCenti: 420, scoreCenti: 340 })), { observation: ["score_below_threshold"], suspend: ["score_below_red_line"], clearDocumentExpired: false });
  // 已经因为别的原因暂停：加上这个原因
  assert.deepEqual(evaluateTenantStanding(standing({ status: "suspended", suspensionReasons: ["manual"], previousDataScoreCenti: 360, scoreCenti: 340 })).suspend, ["score_below_red_line"]);
  assert.deepEqual(evaluateTenantStanding(standing({ status: "suspended", suspensionReasons: ["score_below_red_line"], previousDataScoreCenti: 360, scoreCenti: 340 })).suspend, [], "已有这个原因不重复加");
});

test("司机未到：近 30 天 2 次进入观察期、3 次自动暂停（达到 3 次的那一天触发，之后一直 ≥ 3 不重复触发）", () => {
  assert.deepEqual(evaluateTenantStanding(standing({ noShows: 1 })).observation, []);
  assert.deepEqual(evaluateTenantStanding(standing({ noShows: 2 })).observation, ["driver_no_show"]);
  assert.deepEqual(evaluateTenantStanding(standing({ previousNoShows: 2, noShows: 3 })).suspend, ["driver_no_show"]);
  assert.deepEqual(evaluateTenantStanding(standing({ previousNoShows: 3, noShows: 3 })).suspend, []);
  assert.deepEqual(evaluateTenantStanding(standing({ previousNoShows: null, noShows: 4 })).suspend, ["driver_no_show"]);
  assert.deepEqual(evaluateTenantStanding(standing({ previousNoShows: 2, noShows: 3, scoreCenti: 380 })).observation, ["score_below_threshold", "driver_no_show"]);
});

test("资质：必交资质有过期的自动暂停；暂停原因只有它、资质恢复有效后可以去掉", () => {
  assert.deepEqual(evaluateTenantStanding(standing({ documentsValid: false })).suspend, ["document_expired"]);
  assert.deepEqual(evaluateTenantStanding(standing({ status: "trial", documentsValid: false })).suspend, ["document_expired"]);
  assert.deepEqual(evaluateTenantStanding(standing({ status: "suspended", suspensionReasons: ["document_expired"], documentsValid: false })), { observation: [], suspend: [], clearDocumentExpired: false });
  assert.deepEqual(evaluateTenantStanding(standing({ status: "suspended", suspensionReasons: ["document_expired", "manual"], documentsValid: true })).clearDocumentExpired, true);
  assert.equal(evaluateTenantStanding(standing({ status: "suspended", suspensionReasons: ["manual"], documentsValid: true })).clearDocumentExpired, false);
});
