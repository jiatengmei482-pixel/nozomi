/**
 * M4-01：供应商入驻、资质审核、合同、状态机（ADR 0028）。真实 PostgreSQL、真实接口，应答逐个按 openapi.yaml 核对。
 * - 完整流程：申请中 →（填企业信息、交资质）提交审核 → 驳回退回 → 再提交 → 审核通过 → 合同（双人复核）→ 签约 → 不能上架 → 开始试运营 → 上架、参与比价；
 * - 人工暂停（双人复核）/ 恢复 / 清退（双人复核，要求订单都履约完）；已清退只读；
 * - 资质到期：30 天、7 天提醒，到期当天自动暂停，换证审核通过后自动恢复；
 * - 文件：格式按字节判断、大小限制、下载的安全头、谁能下载；
 * - 权限：平台各角色、供应商各角色。跨租户见 tenant-isolation.itest.ts。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { type HttpMethod, type TenantFixture, type TestApi, TEST_PASSWORD, type ApiResponse, addTenantUser, approverToken, createTestApi, uploadBytes } from "./testing/api.ts";
import { type Market, DROPOFF, buildMarket, marketProduct, ok } from "./testing/market.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { QUOTE_CATALOG_TTL_MS } from "./services/quote-catalog.ts";

let api: TestApi;
let m: Market;
let c: TenantFixture;
let onboarding: string;
const DAY = 86_400_000;
const TODAY = "2026-10-07";

const pdf = (label: string): Buffer => Buffer.from(`%PDF-1.7\n${label}\n%%EOF`);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);

before(async () => {
  api = await createTestApi();
  m = await buildMarket(api);
  c = await api.tenantWithAdmin(m.root, "丙车队", "admin@onboarding-c.test", { onboarding: "applying" });
  const invited = await ok(api.call("POST", "/platform/v1/staff", { token: m.root, body: { email: "bd@platform.test", name: "招商", role: "tenant_onboarding" } }), 201);
  await ok(api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.invite.token, password: TEST_PASSWORD } }));
  onboarding = (await ok(api.call("POST", "/platform/v1/auth/login", { body: { email: "bd@platform.test", password: TEST_PASSWORD } }))).access_token;
});
after(() => api.close());

/** 发一个请求并按 openapi.yaml 核对应答（`template` 是定义里的路径写法）。 */
async function call(method: HttpMethod, url: string, template: string, options: { token: string; body?: unknown; headers?: Record<string, string> }): Promise<ApiResponse> {
  const res = await api.call(method, url, options);
  assertMatchesOpenApi(method, template, res);
  return res;
}
const own = (method: HttpMethod, path: string, template: string, body?: unknown, token = c.adminToken): Promise<ApiResponse> => call(method, `/tenant/v1${path}`, `/tenant/v1${template}`, { token, ...(body === undefined ? {} : { body }) });
const platform = (method: HttpMethod, path: string, template: string, body?: unknown, token = onboarding): Promise<ApiResponse> => call(method, `/platform/v1${path}`, `/platform/v1${template}`, { token, ...(body === undefined ? {} : { body }) });

async function uploadDocument(who: TenantFixture, label: string, type = "application/pdf", bytes: Buffer = pdf(label)): Promise<ApiResponse> {
  const res = await uploadBytes(api, `/tenant/v1/company/files?file_name=${encodeURIComponent(`${label}.pdf`)}`, bytes, who.adminToken, type);
  assertMatchesOpenApi("POST", "/tenant/v1/company/files", res);
  return res;
}
async function submitDocument(who: TenantFixture, type: string, expiresOn: string | null): Promise<any> {
  api.clock.advance(1_000);
  const file = await uploadDocument(who, type);
  assert.equal(file.status, 201, file.text);
  const res = await own("POST", "/company/documents", "/company/documents", { type, file_id: file.body.id, expires_on: expiresOn }, who.adminToken);
  assert.equal(res.status, 201, res.text);
  return res.body;
}
const JP_PROFILE = { country_code: "JP", legal_name: "株式会社丙交通", registration_no: "0100-01-123456", address: "东京都千代田区", contact_name: "丙", contact_phone: "+81312345678", contact_email: "ops@onboarding-c.test" };
const JP_DOCUMENTS: [string, string | null][] = [
  ["commercial_registration", null],
  ["passenger_transport_license", "2027-10-01"],
  ["passenger_liability_insurance", "2027-10-01"],
  ["vehicle_insurance", "2027-10-01"],
  ["settlement_account", null],
];
const approve = (approvalId: string, token: string): Promise<ApiResponse> => api.call("POST", `/platform/v1/approvals/${approvalId}/approve`, { token, body: {} });

test("完整入驻：申请中 → 提交审核 → 驳回退回 → 再提交 → 审核通过 → 合同（双人复核）→ 签约（不能上架）→ 开始试运营 → 上架、参与比价", async () => {
  // 申请中：什么都没填，国家还没定（按通用清单）；提交审核被拦，逐项说明缺什么
  let company = await own("GET", "/company", "/company");
  assert.deepEqual([company.body.tenant.status, company.body.profile, company.body.today], ["applying", null, TODAY]);
  assert.deepEqual(company.body.requirements.map((item: any) => [item.type, item.state]), [["business_license", "missing"], ["passenger_transport_license", "missing"], ["vehicle_insurance", "missing"], ["settlement_account", "missing"]]);
  let submit = await own("POST", "/company/submit", "/company/submit");
  assert.deepEqual([submit.status, submit.body.error.code], [409, "TENANT_CONDITIONS_UNMET"]);
  assert.ok(submit.body.error.details.issues.some((issue: any) => issue.path === "/company/country_code"));

  // 企业信息：第一次不带 If-Match；以后要带当前版本
  const saved = await own("PUT", "/company/profile", "/company/profile", JP_PROFILE);
  assert.deepEqual([saved.status, saved.body.version, saved.body.country_code], [200, 1, "JP"]);
  const stale = await own("PUT", "/company/profile", "/company/profile", JP_PROFILE);
  assert.deepEqual([stale.status, stale.body.error.code], [409, "VERSION_CONFLICT"]);
  assert.equal((await call("PUT", "/tenant/v1/company/profile", "/tenant/v1/company/profile", { token: c.adminToken, body: { ...JP_PROFILE, address: "东京都港区" }, headers: { "if-match": '"1"' } })).body.version, 2);
  company = await own("GET", "/company", "/company");
  assert.deepEqual(company.body.required_document_types, JP_DOCUMENTS.map(([type]) => type), "日本的必交清单");

  // 交资质：营运许可要到期日、不能已到期；登记簿没有到期日
  const file = await uploadDocument(c, "绿牌");
  const missingExpiry = await own("POST", "/company/documents", "/company/documents", { type: "passenger_transport_license", file_id: file.body.id });
  assert.deepEqual([missingExpiry.status, missingExpiry.body.error.details.issues[0].reason], [400, "REQUIRED"]);
  const expired = await own("POST", "/company/documents", "/company/documents", { type: "passenger_transport_license", file_id: file.body.id, expires_on: TODAY });
  assert.deepEqual([expired.status, expired.body.error.details.issues[0].reason], [400, "ALREADY_EXPIRED"]);
  const documents: Record<string, any> = {};
  for (const [type, expiresOn] of JP_DOCUMENTS) documents[type] = await submitDocument(c, type, expiresOn);
  const reused = await own("POST", "/company/documents", "/company/documents", { type: "other", file_id: documents["settlement_account"].file.id });
  assert.deepEqual([reused.status, reused.body.error.code], [409, "FILE_ALREADY_USED"]);

  submit = await own("POST", "/company/submit", "/company/submit");
  assert.deepEqual([submit.status, submit.body.status], [200, "reviewing"]);
  // 审核中不能改企业信息
  const locked = await call("PUT", "/tenant/v1/company/profile", "/tenant/v1/company/profile", { token: c.adminToken, body: JP_PROFILE, headers: { "if-match": '"2"' } });
  assert.deepEqual([locked.status, locked.body.error.code], [409, "TENANT_STATE_INVALID"]);

  // 审核队列：这 5 份都在，提交得早的在前
  const queue = await platform("GET", "/tenant-documents?kind=pending", "/tenant-documents");
  assert.deepEqual(queue.body.items.filter((item: any) => item.tenant.id === c.tenantId).map((item: any) => item.document.type), JP_DOCUMENTS.map(([type]) => type));
  assert.equal(queue.body.total, 5);

  // 驳回要写原因；驳回一项必交的：退回申请中，供应商收到提醒（带原因）
  const noReason = await api.call("POST", `/platform/v1/tenants/${c.tenantId}/documents/${documents["vehicle_insurance"].id}/reject`, { token: onboarding, body: {} });
  assert.equal(noReason.status, 400);
  const rejected = await platform("POST", `/tenants/${c.tenantId}/documents/${documents["vehicle_insurance"].id}/reject`, "/tenants/{id}/documents/{documentId}/reject", { reason: "保单上的车牌看不清" });
  assert.deepEqual([rejected.status, rejected.body.document.status, rejected.body.tenant.status], [200, "rejected", "applying"]);
  assert.equal(rejected.body.document.reviewed_by.email, "bd@platform.test");
  const notices = await own("GET", "/company/notices", "/company/notices");
  assert.deepEqual(notices.body.items.find((notice: any) => notice.kind === "document_reviewed").data, { document_id: documents["vehicle_insurance"].id, type: "vehicle_insurance", status: "rejected", reason: "保单上的车牌看不清" });
  company = await own("GET", "/company", "/company");
  assert.equal(company.body.requirements.find((item: any) => item.type === "vehicle_insurance").state, "rejected");
  assert.equal(company.body.documents.find((item: any) => item.id === documents["vehicle_insurance"].id).reviewed_by, undefined, "供应商看不到是哪位员工审的");
  // 审过的不能再审
  const again = await platform("POST", `/tenants/${c.tenantId}/documents/${documents["vehicle_insurance"].id}/approve`, "/tenants/{id}/documents/{documentId}/approve", {});
  assert.deepEqual([again.status, again.body.error.code], [409, "DOCUMENT_NOT_PENDING"]);
  // 重交一份，再提交
  documents["vehicle_insurance"] = await submitDocument(c, "vehicle_insurance", "2027-10-01");
  assert.equal((await own("POST", "/company/submit", "/company/submit")).body.status, "reviewing");

  // 全部通过（运营照证件把一份的到期日改正）；签约要合同
  for (const [type] of JP_DOCUMENTS) {
    const body = type === "passenger_transport_license" ? { expires_on: "2027-09-30" } : {};
    const approved = await platform("POST", `/tenants/${c.tenantId}/documents/${documents[type].id}/approve`, "/tenants/{id}/documents/{documentId}/approve", body);
    assert.equal(approved.status, 200, approved.text);
  }
  company = await platform("GET", `/tenants/${c.tenantId}/company`, "/tenants/{id}/company");
  assert.ok(company.body.requirements.every((item: any) => item.state === "approved"));
  assert.equal(company.body.documents.find((item: any) => item.id === documents["passenger_transport_license"].id).expires_on, "2027-09-30");
  assert.deepEqual(company.body.next_step_issues, [{ path: "/contract", reason: "CONTRACT_NOT_EFFECTIVE" }]);
  const unsigned = await platform("POST", `/tenants/${c.tenantId}/sign`, "/tenants/{id}/sign", {});
  assert.deepEqual([unsigned.status, unsigned.body.error.details.issues], [409, [{ path: "/contract", reason: "CONTRACT_NOT_EFFECTIVE" }]]);

  // 合同：运营上传扫描件、发起（双人复核）；发起人自己批不了，只读的批不了，另一位批准后生效
  const scan = await uploadBytes(api, `/platform/v1/tenants/${c.tenantId}/files?file_name=${encodeURIComponent("合同.pdf")}`, pdf("合同"), onboarding, "application/pdf");
  assertMatchesOpenApi("POST", "/platform/v1/tenants/{id}/files", scan);
  assert.deepEqual([scan.status, scan.body.purpose], [201, "contract"]);
  const wrongFile = await platform("POST", `/tenants/${c.tenantId}/contracts`, "/tenants/{id}/contracts", { valid_from: TODAY, settle_currency: "JPY", file_id: file.body.id });
  assert.deepEqual([wrongFile.status, wrongFile.body.error.details.issues[0].reason], [400, "WRONG_FILE_PURPOSE"]);
  const past = await platform("POST", `/tenants/${c.tenantId}/contracts`, "/tenants/{id}/contracts", { valid_from: "2026-10-06", settle_currency: "JPY" });
  assert.deepEqual([past.status, past.body.error.details.issues[0].reason], [400, "IN_THE_PAST"]);
  const requested = await platform("POST", `/tenants/${c.tenantId}/contracts`, "/tenants/{id}/contracts", { valid_from: TODAY, settle_currency: "JPY", file_id: scan.body.id, note: "首份合同" });
  assert.deepEqual([requested.status, requested.body.approval.kind, requested.body.approval.status], [202, "tenant.contract", "pending"]);
  assert.equal((await own("GET", "/company/contracts", "/company/contracts")).body.items.length, 0, "批准之前没有生效");
  const self = await approve(requested.body.approval.id, onboarding);
  assert.deepEqual([self.status, self.body.error.code], [409, "APPROVAL_SELF_REVIEW"]);
  assert.equal((await approve(requested.body.approval.id, m.staff.readonly.token)).status, 403);
  assert.equal((await approve(requested.body.approval.id, m.staff.cm1.token)).status, 403, "渠道经理看得到供应商，但不能审核供应商的复核");
  assert.equal((await approve(requested.body.approval.id, await approverToken(api, m.root))).status, 200);
  const contracts = await own("GET", "/company/contracts", "/company/contracts");
  assert.deepEqual(contracts.body.items.map((item: any) => [item.version, item.valid_from, item.settle_currency, item.settle_cycle, item.payment_day, item.service_fee_bp, item.deposit, item.file_id]), [[1, TODAY, "JPY", "monthly", 20, 0, 0, scan.body.id]]);
  // 第二版：生效日期要晚于第一版
  const same = await platform("POST", `/tenants/${c.tenantId}/contracts`, "/tenants/{id}/contracts", { valid_from: TODAY, settle_currency: "USD" });
  assert.deepEqual([same.status, same.body.error.details.issues[0].reason], [400, "NOT_AFTER_LATEST"]);

  // 签约：已签约能建商品，不能上架
  const signed = await platform("POST", `/tenants/${c.tenantId}/sign`, "/tenants/{id}/sign", { note: "合同已回签" });
  assert.deepEqual([signed.status, signed.body.status], [200, "signed"]);
  assert.ok(signed.body.signed_at);
  const noProduct = await platform("POST", `/tenants/${c.tenantId}/start-trial`, "/tenants/{id}/start-trial", { test_order_note: "NZ 测试单已完成" });
  assert.deepEqual([noProduct.status, noProduct.body.error.details.issues.map((issue: any) => issue.reason)], [409, ["NO_PUBLISHABLE_PRODUCT"]]);
  const productId = await marketProduct(api, c, m.ids, [[m.ids.biz7, 18_000]], { publish: false });
  const blocked = await api.call("POST", `/tenant/v1/products/${productId}/publish`, { token: c.adminToken });
  assert.deepEqual([blocked.status, blocked.body.error.code, blocked.body.error.details.status], [409, "TENANT_NOT_ONBOARDED", "signed"]);
  const noNote = await api.call("POST", `/platform/v1/tenants/${c.tenantId}/start-trial`, { token: onboarding, body: {} });
  assert.equal(noNote.status, 400);

  // 开始试运营：上架、参与比价（最便宜的丙中标）
  const trial = await platform("POST", `/tenants/${c.tenantId}/start-trial`, "/tenants/{id}/start-trial", { test_order_note: "测试单 NZ2026… 已完成接送" });
  assert.deepEqual([trial.status, trial.body.status], [200, "trial"]);
  assert.equal((await api.call("POST", `/tenant/v1/products/${productId}/publish`, { token: c.adminToken })).status, 200);
  api.clock.advance(QUOTE_CATALOG_TTL_MS + 1);
  const preview = await ok(api.call("POST", "/platform/v1/quotes/preview", { token: m.root, body: { city_id: m.ids.tokyo, category: "airport_transfer", place_id: m.ids.narita, currency: "JPY", direction: "pickup", dropoff: DROPOFF, service_time: "2026-10-20T10:00", passengers: 2, luggage: 1, vehicle_group_ids: [m.ids.biz7] } }));
  assert.equal(preview.groups[0].winner.tenant_id, c.tenantId);

  // 状态记录：每一步都在；供应商看到的没有员工身份和说明，运营看到的有
  const mine = await own("GET", "/company/status-events", "/company/status-events");
  assert.deepEqual(mine.body.items.map((event: any) => [event.trigger, event.from_status, event.to_status, event.actor]).reverse(), [
    ["submit", "applying", "reviewing", { type: "tenant_user" }],
    ["return", "reviewing", "applying", { type: "platform_user" }],
    ["submit", "applying", "reviewing", { type: "tenant_user" }],
    ["sign", "reviewing", "signed", { type: "platform_user" }],
    ["start_trial", "signed", "trial", { type: "platform_user" }],
  ]);
  const theirs = await platform("GET", `/tenants/${c.tenantId}/status-events`, "/tenants/{id}/status-events");
  assert.deepEqual(theirs.body.items.map((event: any) => [event.trigger, event.actor.email, event.note]).reverse(), [
    ["submit", c.adminEmail, null],
    ["return", "bd@platform.test", "保单上的车牌看不清"],
    ["submit", c.adminEmail, null],
    ["sign", "bd@platform.test", "合同已回签"],
    ["start_trial", "bd@platform.test", "测试单 NZ2026… 已完成接送"],
  ]);
  // 审计日志：每次状态变化一条
  const audit = await ok(api.call("GET", `/platform/v1/audit-logs?resource=tenant&resource_id=${c.tenantId}&limit=50`, { token: m.root }));
  assert.deepEqual(audit.items.map((log: any) => log.action).reverse(), ["create", "submit", "return", "submit", "sign", "start_trial"]);
});

test("人工暂停走双人复核（批准前不生效）；恢复直接生效；已有人工暂停的不能重复发起；还在入驻中的不能暂停", async () => {
  const requested = await platform("POST", `/tenants/${c.tenantId}/suspend`, "/tenants/{id}/suspend", { reason: "客诉集中，先停下来核查" });
  assert.deepEqual([requested.status, requested.body.approval.kind, requested.body.approval.resource_id], [202, "tenant.suspend", c.tenantId]);
  assert.equal((await platform("GET", `/tenants/${c.tenantId}`, "/tenants/{id}")).body.status, "trial", "批准之前不生效");
  // 招商发起、运营批准
  assert.equal((await approve(requested.body.approval.id, m.staff.operations.token)).status, 200);
  const suspended = (await platform("GET", `/tenants/${c.tenantId}`, "/tenants/{id}")).body;
  assert.deepEqual([suspended.status, suspended.suspended_from, suspended.suspension_reasons], ["suspended", "trial", ["manual"]]);
  const twice = await platform("POST", `/tenants/${c.tenantId}/suspend`, "/tenants/{id}/suspend", { reason: "再来一次" });
  assert.deepEqual([twice.status, twice.body.error.code], [409, "TENANT_STATE_INVALID"]);
  // 暂停中仍能登录、读自己的资料，状态记录里供应商只看到原因代码
  const status = await own("GET", "/company/status-events", "/company/status-events");
  assert.deepEqual(status.body.items[0].suspension_after, ["manual"]);
  assert.ok(!status.text.includes("客诉集中"));
  const resumed = await platform("POST", `/tenants/${c.tenantId}/resume`, "/tenants/{id}/resume", {});
  assert.deepEqual([resumed.status, resumed.body.status, resumed.body.suspension_reasons], [200, "trial", []]);
  const notSuspended = await platform("POST", `/tenants/${c.tenantId}/resume`, "/tenants/{id}/resume", {});
  assert.deepEqual([notSuspended.status, notSuspended.body.error.code], [409, "TENANT_STATE_INVALID"]);
  const applying = await api.tenantWithAdmin(m.root, "戊车队", "admin@onboarding-e.test", { onboarding: "applying" });
  const early = await platform("POST", `/tenants/${applying.tenantId}/suspend`, "/tenants/{id}/suspend", { reason: "x" });
  assert.deepEqual([early.status, early.body.error.code], [409, "TENANT_STATE_INVALID"]);
});

test("资质到期：到期前 30 天、7 天各提醒一次；到期当天自动暂停（不能人工恢复）；换上新证件审核通过后自动恢复", async () => {
  const d = await api.tenantWithAdmin(m.root, "丁车队", "admin@onboarding-d.test", { onboarding: "applying" });
  await call("PUT", "/tenant/v1/company/profile", "/tenant/v1/company/profile", { token: d.adminToken, body: { ...JP_PROFILE, contact_email: "ops@onboarding-d.test" } });
  // 营运车辆商业保险 31 天后到期
  const expiresOn = "2026-11-07";
  const ids: Record<string, string> = {};
  for (const [type, expiry] of JP_DOCUMENTS) ids[type] = (await submitDocument(d, type, type === "vehicle_insurance" ? expiresOn : expiry)).id;
  for (const id of Object.values(ids)) assert.equal((await platform("POST", `/tenants/${d.tenantId}/documents/${id}/approve`, "/tenants/{id}/documents/{documentId}/approve", {})).status, 200);
  await api.db.owner.query("update tenants set status = 'active', activated_at = now() where id = $1", [d.tenantId]);
  const kinds = async (): Promise<string[]> => {
    const login = await ok(api.call("POST", "/tenant/v1/auth/login", { body: { email: d.adminEmail, password: TEST_PASSWORD } }));
    return (await ok(api.call("GET", "/tenant/v1/company/notices?limit=200", { token: login.access_token }))).items.map((notice: any) => `${notice.kind}:${notice.data.days_left ?? ""}`).filter((kind: string) => kind.startsWith("document_expir"));
  };
  const statusOf = async (): Promise<any> => ok(api.call("GET", `/platform/v1/tenants/${d.tenantId}`, { token: await login("root@platform.test") }));
  await api.app.tenantJobs.tick();
  assert.deepEqual(await kinds(), [], "31 天：还不提醒");
  api.clock.advance(DAY);
  await api.app.tenantJobs.tick();
  assert.deepEqual(await kinds(), ["document_expiring:30"]);
  api.clock.advance(DAY);
  await api.app.tenantJobs.tick();
  assert.deepEqual(await kinds(), ["document_expiring:30"], "同一档只提醒一次");
  api.clock.advance(22 * DAY);
  await api.app.tenantJobs.tick();
  assert.deepEqual(await kinds(), ["document_expiring:7", "document_expiring:30"]);
  // 运营的审核队列能看到快到期的
  const expiring = await ok(api.call("GET", "/platform/v1/tenant-documents?kind=expiring&within_days=7", { token: await login("root@platform.test") }));
  assert.deepEqual(expiring.items.filter((item: any) => item.tenant.id === d.tenantId).map((item: any) => item.document.type), ["vehicle_insurance"]);
  api.clock.advance(7 * DAY);
  await api.app.tenantJobs.tick();
  let tenant = await statusOf();
  assert.deepEqual([tenant.status, tenant.suspended_from, tenant.suspension_reasons], ["suspended", "active", ["document_expired"]], "到期当天暂停");
  assert.deepEqual((await kinds())[0], "document_expired:");
  const manual = await api.call("POST", `/platform/v1/tenants/${d.tenantId}/resume`, { token: await login("root@platform.test"), body: {} });
  assert.deepEqual([manual.status, manual.body.error.code], [409, "DOCUMENTS_INVALID"]);
  // 换证：新的一份审核中时仍然暂停；通过后自动恢复，旧的那份被取代
  const dToken = (await ok(api.call("POST", "/tenant/v1/auth/login", { body: { email: d.adminEmail, password: TEST_PASSWORD } }))).access_token;
  const renewalFile = await uploadBytes(api, "/tenant/v1/company/files?file_name=renewal.pdf", pdf("续保"), dToken, "application/pdf");
  const renewal = await ok(api.call("POST", "/tenant/v1/company/documents", { token: dToken, body: { type: "vehicle_insurance", file_id: renewalFile.body.id, expires_on: "2027-11-07" } }), 201);
  assert.equal((await statusOf()).status, "suspended");
  const approved = await ok(api.call("POST", `/platform/v1/tenants/${d.tenantId}/documents/${renewal.id}/approve`, { token: await login("bd@platform.test"), body: {} }));
  assert.deepEqual([approved.tenant.status, approved.tenant.suspension_reasons], ["active", []]);
  const company = await ok(api.call("GET", "/tenant/v1/company", { token: dToken }));
  assert.deepEqual(company.documents.filter((item: any) => item.type === "vehicle_insurance").map((item: any) => item.status), ["superseded", "approved"]);
  tenant = await statusOf();
  assert.equal(tenant.status, "active");
});

async function login(email: string): Promise<string> {
  return (await ok(api.call("POST", "/platform/v1/auth/login", { body: { email, password: TEST_PASSWORD } }))).access_token;
}

test("文件：只认 PDF / JPEG / PNG（按开头的字节，和声明的类型要一致）；空文件 400、超过 10 MB 413；下载原样返回并带安全头；只有做审核的平台员工能下载", async () => {
  const token = await ok(api.call("POST", "/tenant/v1/auth/login", { body: { email: c.adminEmail, password: TEST_PASSWORD } }));
  const t = token.access_token as string;
  const lying = await uploadBytes(api, "/tenant/v1/company/files", PNG, t, "application/pdf");
  assert.deepEqual([lying.status, lying.body.error.code, lying.body.error.details.detected], [415, "UNSUPPORTED_MEDIA_TYPE", "image/png"]);
  const gif = await uploadBytes(api, "/tenant/v1/company/files", Buffer.from("GIF89a...."), t, "application/octet-stream");
  assert.deepEqual([gif.status, gif.body.error.code], [415, "UNSUPPORTED_MEDIA_TYPE"]);
  const html = await uploadBytes(api, "/tenant/v1/company/files", Buffer.from("<html><script>alert(1)</script>"), t, "text/html");
  assert.equal(html.status, 415);
  assert.equal((await uploadBytes(api, "/tenant/v1/company/files", Buffer.alloc(0), t, "application/pdf")).status, 400);
  const big = Buffer.concat([pdf("big"), Buffer.alloc(10 * 1024 * 1024)]);
  const tooBig = await uploadBytes(api, "/tenant/v1/company/files", big, t, "application/pdf");
  assert.equal(tooBig.status, 413);
  assert.equal(tooBig.body.error.code, "PAYLOAD_TOO_LARGE");
  const png = await uploadBytes(api, `/tenant/v1/company/files?file_name=${encodeURIComponent("../../营业执照\"x.png")}`, PNG, t, "image/png");
  assert.deepEqual([png.status, png.body.content_type, png.body.file_name, png.body.byte_size], [201, "image/png", "营业执照x.png", PNG.length]);
  const download = await api.app.inject({ method: "GET", url: `/tenant/v1/company/files/${png.body.id}`, headers: { authorization: `Bearer ${t}` } });
  assert.equal(download.statusCode, 200);
  assert.deepEqual(download.rawPayload, PNG);
  assert.equal(download.headers["content-type"], "image/png");
  assert.equal(download.headers["x-content-type-options"], "nosniff");
  assert.equal(download.headers["content-security-policy"], "default-src 'none'; sandbox");
  assert.equal(download.headers["cache-control"], "no-store");
  assert.match(String(download.headers["content-disposition"]), /^attachment; filename="[^"]*"; filename\*=UTF-8''%E8%90%A5/);
  // 平台：做审核的能下载；只读、渠道经理不能
  const asPlatform = (who: string) => api.app.inject({ method: "GET", url: `/platform/v1/tenants/${c.tenantId}/files/${png.body.id}`, headers: { authorization: `Bearer ${who}` } });
  assert.equal((await asPlatform(await login("bd@platform.test"))).statusCode, 200);
  assert.equal((await asPlatform(await login("ro@platform.test"))).statusCode, 403);
  assert.equal((await asPlatform(await login("cm1@platform.test"))).statusCode, 403);
  // 文件编号对、供应商不对：404
  assert.equal((await api.app.inject({ method: "GET", url: `/platform/v1/tenants/${m.a.tenantId}/files/${png.body.id}`, headers: { authorization: `Bearer ${await login("bd@platform.test")}` } })).statusCode, 404);
});

test("权限：供应商只有管理员能填资料和交资质，财务、只读能看；评分每个角色都能看；平台只读能看不能审，主数据运营看不到", async () => {
  const admin = (await ok(api.call("POST", "/tenant/v1/auth/login", { body: { email: c.adminEmail, password: TEST_PASSWORD } }))).access_token as string;
  for (const role of ["pricing", "dispatch", "finance", "readonly"] as const) {
    const user = await addTenantUser(api, admin, `${role}@onboarding-c.test`, role);
    const read = await api.call("GET", "/tenant/v1/company", { token: user.token });
    assert.equal(read.status, role === "finance" || role === "readonly" ? 200 : 403, `${role} 看企业信息`);
    assert.equal((await uploadBytes(api, "/tenant/v1/company/files", pdf("x"), user.token, "application/pdf")).status, 403, `${role} 上传`);
    assert.equal((await api.call("POST", "/tenant/v1/company/submit", { token: user.token })).status, 403, `${role} 提交`);
    assert.equal((await api.call("GET", "/tenant/v1/performance", { token: user.token })).status, 200, `${role} 看评分`);
  }
  const readonly = await login("ro@platform.test");
  assert.equal((await api.call("GET", `/platform/v1/tenants/${c.tenantId}/company`, { token: readonly })).status, 200);
  assert.equal((await api.call("GET", "/platform/v1/tenant-documents", { token: readonly })).status, 200);
  const document = (await ok(api.call("GET", `/platform/v1/tenants/${c.tenantId}/company`, { token: readonly }))).documents[0];
  assert.equal((await api.call("POST", `/platform/v1/tenants/${c.tenantId}/documents/${document.id}/approve`, { token: readonly, body: {} })).status, 403);
  assert.equal((await api.call("POST", `/platform/v1/tenants/${c.tenantId}/sign`, { token: readonly, body: {} })).status, 403);
  assert.equal((await api.call("GET", `/platform/v1/tenants/${c.tenantId}/company`, { token: await login("md@platform.test") })).status, 403);
  // 规则 4：供应商侧这几个接口里没有对外价、加价比例
  for (const path of ["/tenant/v1/company", "/tenant/v1/company/contracts", "/tenant/v1/company/status-events", "/tenant/v1/company/notices", "/tenant/v1/performance"]) {
    const res = await api.call("GET", path, { token: admin });
    assert.doesNotMatch(res.text, /markup|sell_price|selling_price|对外价|加价/i, path);
  }
});

test("清退走双人复核：还有没履约完的订单不能发起；批准后只能查看、所有修改都拒绝，商品不再参与比价", async () => {
  const bd = await login("bd@platform.test");
  // 丙有一张已确认、还没完成的单
  const orderId = (await api.db.owner.query<{ id: string }>(
    `insert into orders (tenant_id, order_no, status, category, city_id, place_id, direction, product_id, product_version, vehicle_group_id, service_at, service_local, timezone, service_date,
                         urgent, passengers, luggage, addons, passenger, settlement_minor, settlement_currency, settlement, inventory_held, payment_due_at, confirmed_at, dispatch_due_at, created_at, updated_at)
     select $1, 'NZ20261007NBQARD12', 'confirmed', 'airport_transfer', $2, $3, 'pickup', p.id, 1, $4, now(), '2026-10-20T10:00', 'Asia/Tokyo', '2026-10-20', false, 2, 1, '[]', '{}', 1000, 'JPY', '{}', false, now() + interval '30 minutes', now(), now(), now(), now()
       from products p where p.tenant_id = $1 limit 1 returning id`,
    [c.tenantId, m.ids.tokyo, m.ids.narita, m.ids.biz7],
  )).rows[0]?.id;
  const open = await api.call("POST", `/platform/v1/tenants/${c.tenantId}/terminate`, { token: bd, body: { reason: "合同解除" } });
  assertMatchesOpenApi("POST", "/platform/v1/tenants/{id}/terminate", open);
  assert.deepEqual([open.status, open.body.error.code, open.body.error.details.open_orders], [409, "TENANT_HAS_OPEN_ORDERS", 1]);
  await api.db.owner.query("update orders set status = 'completed' where id = $1", [orderId]);
  const requested = await api.call("POST", `/platform/v1/tenants/${c.tenantId}/terminate`, { token: bd, body: { reason: "合同解除" } });
  assert.deepEqual([requested.status, requested.body.approval.kind], [202, "tenant.terminate"]);
  assert.equal((await approve(requested.body.approval.id, await login("ops@platform.test"))).status, 200);
  const tenant = await ok(api.call("GET", `/platform/v1/tenants/${c.tenantId}`, { token: bd }));
  assert.deepEqual([tenant.status, tenant.suspension_reasons, tenant.observation_reasons], ["terminated", [], []]);
  assert.ok(tenant.terminated_at);
  // 只能查看
  const admin = (await ok(api.call("POST", "/tenant/v1/auth/login", { body: { email: c.adminEmail, password: TEST_PASSWORD } }))).access_token as string;
  assert.equal((await api.call("GET", "/tenant/v1/company", { token: admin })).status, 200);
  assert.equal((await api.call("GET", "/tenant/v1/products", { token: admin })).status, 200);
  for (const [method, url, body] of [["POST", "/tenant/v1/company/submit", undefined], ["POST", "/tenant/v1/users", { email: "late@onboarding-c.test", name: "迟到", role: "readonly" }], ["POST", "/tenant/v1/brands", { name: "新品牌", currency: "JPY" }]] as const) {
    const res = await api.call(method, url, { token: admin, ...(body === undefined ? {} : { body }) });
    assert.deepEqual([res.status, res.body.error.code], [409, "TENANT_TERMINATED"], url);
  }
  const upload = await uploadBytes(api, "/tenant/v1/company/files", pdf("late"), admin, "application/pdf");
  assert.deepEqual([upload.status, upload.body.error.code], [409, "TENANT_TERMINATED"]);
  // 不参与比价：原因 TENANT_NOT_ONBOARDED；运营也不能再审、不能再签合同
  api.clock.advance(QUOTE_CATALOG_TTL_MS + 1);
  const preview = await ok(api.call("POST", "/platform/v1/quotes/preview", { token: await login("root@platform.test"), body: { city_id: m.ids.tokyo, category: "airport_transfer", place_id: m.ids.narita, currency: "JPY", direction: "pickup", dropoff: DROPOFF, service_time: "2026-10-20T10:00", passengers: 2, luggage: 1, vehicle_group_ids: [m.ids.biz7] } }));
  assert.deepEqual(preview.refused.filter((entry: any) => entry.tenant_id === c.tenantId).map((entry: any) => entry.reason), ["TENANT_NOT_ONBOARDED"]);
  const contract = await api.call("POST", `/platform/v1/tenants/${c.tenantId}/contracts`, { token: bd, body: { valid_from: "2026-12-01", settle_currency: "JPY" } });
  assert.deepEqual([contract.status, contract.body.error.code], [409, "TENANT_STATE_INVALID"]);
  // 清退以后每日检查不再做
  const evaluatedBefore = (await api.db.owner.query("select evaluated_on::text from tenants where id = $1", [c.tenantId])).rows[0].evaluated_on;
  api.clock.advance(DAY);
  await api.app.tenantJobs.tick();
  assert.equal((await api.db.owner.query("select evaluated_on::text from tenants where id = $1", [c.tenantId])).rows[0].evaluated_on, evaluatedBefore);
});
