/**
 * M4-34：供应商名称和企业信息的维护（ADR 0071）。真实 PostgreSQL、真实接口，应答逐个按 openapi.yaml 核对。
 * - 平台直接改对外显示名称（If-Match 供应商的版本）、企业信息（If-Match 企业信息的版本）：权限、乐观锁、审计；
 * - 供应商审核通过以后：联系信息直接改（审计、通知平台运营），国家、法定名称、登记号不能直接改；
 * - 改名称、法定名称、登记号的申请：审核期间旧值照常用；平台一位发起复核、另一位批准才生效，发起人自己批不了；驳回、撤回、过期；
 * - 通知中心：提交、直接改通知平台员工，生效、驳回通知供应商管理员。跨租户见 tenant-isolation.itest.ts。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { type ApiResponse, type HttpMethod, type TenantFixture, type TestApi, addTenantUser, createTestApi } from "./testing/api.ts";
import { type Staff, addStaff, ok } from "./testing/market.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";

let api: TestApi;
let root: string;
let bd: Staff;
let ops: Staff;
let readonly: Staff;
let channels: Staff;
let t: TenantFixture;

const PROFILE = { country_code: "JP", legal_name: "株式会社テスト交通", registration_no: "0100-01-000001", address: "東京都千代田区1-1", contact_name: "山田", contact_phone: "+81 3-0000-0000", contact_email: "ops@profile-t.test" };

before(async () => {
  api = await createTestApi();
  root = await api.superAdminToken();
  bd = await addStaff(api, root, "bd@platform.test", "tenant_onboarding");
  ops = await addStaff(api, root, "ops@platform.test", "operations");
  readonly = await addStaff(api, root, "ro@platform.test", "readonly");
  channels = await addStaff(api, root, "cm@platform.test", "channel_manager");
  t = await api.tenantWithAdmin(root, "测试车队", "admin@profile-t.test");
});
after(() => api.close());

async function call(method: HttpMethod, url: string, template: string, options: { token: string; body?: unknown; headers?: Record<string, string> }): Promise<ApiResponse> {
  const res = await api.call(method, url, options);
  assertMatchesOpenApi(method, template, res);
  return res;
}
const ifMatch = (version: number): Record<string, string> => ({ "if-match": `"${version}"` });

async function tenantRow(id: string): Promise<{ name: string; version: number }> {
  return (await api.db.owner.query<{ name: string; version: number }>("select name, version from tenants where id = $1", [id])).rows[0] as { name: string; version: number };
}
async function profileRow(id: string): Promise<Record<string, unknown> | undefined> {
  return (await api.db.owner.query("select legal_name, registration_no, address, contact_name, version from tenant_profiles where tenant_id = $1", [id])).rows[0];
}
async function audits(resource: string, resourceId: string): Promise<{ action: string; actor_type: string; actor_email: string | null; before: any; after: any }[]> {
  const result = await api.db.owner.query("select action, actor_type, actor_email, before, after from audit_logs where resource = $1 and resource_id = $2 order by occurred_at, id", [resource, resourceId]);
  return result.rows;
}
async function events(tenantId: string, event: string): Promise<{ id: string; data: any }[]> {
  return (await api.db.owner.query("select id, data from notification_events where tenant_id = $1 and event = $2 order by occurred_at, id", [tenantId, event])).rows;
}
/** 展开发件箱，返回这个事件的收件人和接收方类型。 */
async function recipients(eventId: string): Promise<string[]> {
  await api.app.notificationJobs.expandEvents(api.clock.now());
  return (await api.db.owner.query<{ who: string }>("select audience || ':' || recipient as who from notifications where event_id = $1 order by recipient", [eventId])).rows.map((row) => row.who);
}

/** 一家新的「正式」供应商，企业信息已填好（平台填）。 */
async function activeTenant(label: string): Promise<TenantFixture> {
  const tenant = await api.tenantWithAdmin(root, `${label}车队`, `admin@${label}.test`);
  await ok(api.call("PUT", `/platform/v1/tenants/${tenant.tenantId}/company/profile`, { token: bd.token, body: { ...PROFILE, contact_email: `ops@${label}.test` } }));
  return tenant;
}

test("平台改对外显示名称：要 If-Match（供应商的版本），版本不对 409；一样的不写；记审计；有 tenant.edit 才行", async () => {
  const before = await tenantRow(t.tenantId);
  const noVersion = await call("PATCH", `/platform/v1/tenants/${t.tenantId}`, "/platform/v1/tenants/{id}", { token: bd.token, body: { name: "新名字" } });
  assert.deepEqual([noVersion.status, noVersion.body.error.code], [428, "PRECONDITION_REQUIRED"]);
  const stale = await call("PATCH", `/platform/v1/tenants/${t.tenantId}`, "/platform/v1/tenants/{id}", { token: bd.token, body: { name: "新名字" }, headers: ifMatch(before.version + 1) });
  assert.deepEqual([stale.status, stale.body.error.code, stale.body.error.details.current_version], [409, "VERSION_CONFLICT", before.version]);
  const blank = await call("PATCH", `/platform/v1/tenants/${t.tenantId}`, "/platform/v1/tenants/{id}", { token: bd.token, body: { name: "  " }, headers: ifMatch(before.version) });
  assert.equal(blank.status, 400);
  const extra = await call("PATCH", `/platform/v1/tenants/${t.tenantId}`, "/platform/v1/tenants/{id}", { token: bd.token, body: { name: "x", status: "active" }, headers: ifMatch(before.version) });
  assert.equal(extra.status, 400, "只允许改 name");
  // 没有 tenant.edit：只读、渠道经理 403，数据不变
  for (const staff of [readonly, channels]) {
    const denied = await call("PATCH", `/platform/v1/tenants/${t.tenantId}`, "/platform/v1/tenants/{id}", { token: staff.token, body: { name: "偷改" }, headers: ifMatch(before.version) });
    assert.deepEqual([denied.status, denied.body.error.code], [403, "FORBIDDEN"], staff.email);
  }
  assert.deepEqual(await tenantRow(t.tenantId), before);

  const renamed = await call("PATCH", `/platform/v1/tenants/${t.tenantId}`, "/platform/v1/tenants/{id}", { token: bd.token, body: { name: "  测试车队（东京）  " }, headers: ifMatch(before.version) });
  assert.deepEqual([renamed.status, renamed.body.name, renamed.body.version], [200, "测试车队（东京）", before.version + 1]);
  // 一样的不写：版本不变，不多一条审计
  const same = await call("PATCH", `/platform/v1/tenants/${t.tenantId}`, "/platform/v1/tenants/{id}", { token: ops.token, body: { name: "测试车队（东京）" }, headers: ifMatch(before.version + 1) });
  assert.deepEqual([same.status, same.body.version], [200, before.version + 1]);
  const logged = (await audits("tenant", t.tenantId)).filter((row) => row.action === "update");
  assert.deepEqual(logged.map((row) => [row.actor_email, row.before, row.after]), [["bd@platform.test", { name: "测试车队" }, { name: "测试车队（东京）" }]]);
  // 供应商那边马上看到新名称
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: t.adminToken })).body.tenant.name, "测试车队（东京）");
  // 不存在的供应商 404
  assert.equal((await api.call("PATCH", "/platform/v1/tenants/00000000-0000-4000-8000-000000000000", { token: bd.token, body: { name: "x" }, headers: ifMatch(1) })).status, 404);
});

test("平台改企业信息：任何状态都能改；第一次不带 If-Match，以后要带当前版本；记审计（改前改后）；只读 403", async () => {
  const applying = await api.tenantWithAdmin(root, "申请中车队", "admin@profile-applying.test", { onboarding: "applying" });
  for (const target of [t, applying]) {
    const url = `/platform/v1/tenants/${target.tenantId}/company/profile`;
    const denied = await call("PUT", url, "/platform/v1/tenants/{id}/company/profile", { token: readonly.token, body: PROFILE });
    assert.deepEqual([denied.status, denied.body.error.code], [403, "FORBIDDEN"]);
    const wrongFirst = await call("PUT", url, "/platform/v1/tenants/{id}/company/profile", { token: bd.token, body: PROFILE, headers: ifMatch(1) });
    assert.deepEqual([wrongFirst.status, wrongFirst.body.error.code], [409, "VERSION_CONFLICT"]);
    const created = await call("PUT", url, "/platform/v1/tenants/{id}/company/profile", { token: bd.token, body: PROFILE });
    assert.deepEqual([created.status, created.body.version, created.body.legal_name], [200, 1, PROFILE.legal_name]);
    const stale = await call("PUT", url, "/platform/v1/tenants/{id}/company/profile", { token: ops.token, body: { ...PROFILE, address: "大阪" } });
    assert.deepEqual([stale.status, stale.body.error.code], [409, "VERSION_CONFLICT"]);
    const updated = await call("PUT", url, "/platform/v1/tenants/{id}/company/profile", { token: ops.token, body: { ...PROFILE, legal_name: "株式会社改名", address: "大阪" }, headers: ifMatch(1) });
    assert.deepEqual([updated.status, updated.body.version, updated.body.legal_name, updated.body.address], [200, 2, "株式会社改名", "大阪"]);
    const same = await call("PUT", url, "/platform/v1/tenants/{id}/company/profile", { token: ops.token, body: { ...PROFILE, legal_name: "株式会社改名", address: "大阪" }, headers: ifMatch(2) });
    assert.deepEqual([same.status, same.body.version], [200, 2], "一样的不写");
    const logged = await audits("tenant_profile", target.tenantId);
    assert.deepEqual(
      logged.map((row) => [row.action, row.actor_type, row.actor_email, row.before?.legal_name ?? null, row.after.legal_name, row.after.address]),
      [
        ["create", "platform_user", "bd@platform.test", null, PROFILE.legal_name, PROFILE.address],
        ["update", "platform_user", "ops@platform.test", PROFILE.legal_name, "株式会社改名", "大阪"],
      ],
    );
  }
  // 平台详情页读得到
  const company = await call("GET", `/platform/v1/tenants/${t.tenantId}/company`, "/platform/v1/tenants/{id}/company", { token: readonly.token });
  assert.equal(company.body.profile.legal_name, "株式会社改名");
});

test("供应商审核通过以后：注册地址、联系信息直接改（审计、通知平台运营）；国家、法定名称、登记号不能直接改；什么都没改不写", async () => {
  const u = await activeTenant("direct");
  const url = "/tenant/v1/company/profile";
  const contact = { ...PROFILE, contact_email: "ops@direct.test", contact_name: "佐藤", contact_phone: "+81 3-1111-1111", address: "東京都港区2-2" };
  const changed = await call("PUT", url, url, { token: u.adminToken, body: contact, headers: ifMatch(1) });
  assert.deepEqual([changed.status, changed.body.version, changed.body.contact_name, changed.body.address], [200, 2, "佐藤", "東京都港区2-2"]);
  const logged = (await audits("tenant_profile", u.tenantId)).at(-1);
  assert.deepEqual([logged?.action, logged?.actor_type, logged?.before.contact_name, logged?.after.contact_name], ["update", "tenant_user", "山田", "佐藤"]);
  const [event] = await events(u.tenantId, "tenant.profile_updated");
  assert.deepEqual(event?.data, { tenant_name: "direct车队", profile_fields: ["address", "contact_name", "contact_phone"] });
  // 发给有 tenant.edit 的平台员工（超级管理员、运营、招商），只读和渠道经理收不到；供应商自己也收不到这封
  assert.deepEqual(await recipients(event?.id as string), ["staff:bd@platform.test", "staff:ops@platform.test", "staff:root@platform.test"]);

  for (const [key, value] of [["legal_name", "株式会社別名"], ["registration_no", "9999"], ["country_code", "KR"]] as const) {
    const locked = await call("PUT", url, url, { token: u.adminToken, body: { ...contact, [key]: value }, headers: ifMatch(2) });
    assert.deepEqual([locked.status, locked.body.error.code, locked.body.error.details.fields], [409, "PROFILE_FIELDS_LOCKED", key], key);
  }
  const same = await call("PUT", url, url, { token: u.adminToken, body: contact, headers: ifMatch(2) });
  assert.deepEqual([same.status, same.body.version], [200, 2]);
  assert.equal((await events(u.tenantId, "tenant.profile_updated")).length, 1, "没改就不通知");
  assert.deepEqual(await profileRow(u.tenantId), { legal_name: PROFILE.legal_name, registration_no: PROFILE.registration_no, address: "東京都港区2-2", contact_name: "佐藤", version: 2 });
  // 只有管理员能改；财务能看不能改
  const finance = await addTenantUser(api, u.adminToken, "finance@direct.test", "finance");
  assert.equal((await api.call("PUT", url, { token: finance.token, body: { ...contact, contact_name: "财务改" }, headers: ifMatch(2) })).status, 403);
});

test("申请中：仍按原来的做法每一项都能直接改，不通知平台", async () => {
  const applying = await api.tenantWithAdmin(root, "新车队", "admin@profile-new.test", { onboarding: "applying" });
  const url = "/tenant/v1/company/profile";
  assert.equal((await call("PUT", url, url, { token: applying.adminToken, body: PROFILE })).status, 200);
  const changed = await call("PUT", url, url, { token: applying.adminToken, body: { ...PROFILE, legal_name: "株式会社改", country_code: "KR" }, headers: ifMatch(1) });
  assert.deepEqual([changed.status, changed.body.legal_name, changed.body.country_code], [200, "株式会社改", "KR"]);
  assert.equal((await events(applying.tenantId, "tenant.profile_updated")).length, 0);
});

test("改名称、法定名称、登记号：提交申请 → 审核期间旧值照常用 → 平台一位发起复核、自己批不了 → 另一位批准后生效，通知双方", async () => {
  const u = await activeTenant("change");
  const changes = "/tenant/v1/company/profile-changes";
  const empty = await call("POST", changes, changes, { token: u.adminToken, body: {} });
  assert.deepEqual([empty.status, empty.body.error.details.issues[0].reason], [400, "REQUIRED"]);
  const unchanged = await call("POST", changes, changes, { token: u.adminToken, body: { legal_name: PROFILE.legal_name } });
  assert.deepEqual([unchanged.status, unchanged.body.error.details.issues[0].reason], [400, "UNCHANGED"]);
  const withStatus = await call("POST", changes, changes, { token: u.adminToken, body: { name: "x", status: "approved" } });
  assert.equal(withStatus.status, 400, "不认识的字段一律 400");

  const submitted = await call("POST", changes, changes, { token: u.adminToken, body: { name: "  新车队  ", legal_name: "株式会社新交通", note: "公司更名" } });
  assert.equal(submitted.status, 201, submitted.text);
  assert.deepEqual(
    [submitted.body.status, submitted.body.fields, submitted.body.proposed, submitted.body.previous, submitted.body.note],
    ["pending", ["name", "legal_name"], { name: "新车队", legal_name: "株式会社新交通" }, { name: "change车队", legal_name: PROFILE.legal_name }, "公司更名"],
  );
  assert.equal(submitted.body.submitted_by.email, undefined, "供应商的应答里没有邮箱以外的平台信息，提交人只有姓名");
  const again = await call("POST", changes, changes, { token: u.adminToken, body: { registration_no: "1" } });
  assert.deepEqual([again.status, again.body.error.code], [409, "PROFILE_CHANGE_PENDING_EXISTS"]);
  // 审核期间旧值照常用
  assert.equal((await tenantRow(u.tenantId)).name, "change车队");
  assert.equal((await profileRow(u.tenantId))?.legal_name, PROFILE.legal_name);
  const [submittedEvent] = await events(u.tenantId, "tenant.profile_change_submitted");
  assert.deepEqual(submittedEvent?.data, { tenant_name: "change车队", profile_fields: ["name", "legal_name"] });
  assert.deepEqual(await recipients(submittedEvent?.id as string), ["staff:bd@platform.test", "staff:ops@platform.test", "staff:root@platform.test"], "发给有 tenant.review 的");

  // 平台看到申请（带提交人）；只读能看不能处理
  const listUrl = `/platform/v1/tenants/${u.tenantId}/profile-changes`;
  const listed = await call("GET", listUrl, "/platform/v1/tenants/{id}/profile-changes", { token: readonly.token });
  assert.deepEqual([listed.body.items.length, listed.body.items[0].submitted_by.email, listed.body.items[0].pending_approval_id], [1, "admin@change.test", null]);
  const reviewUrl = `${listUrl}/${submitted.body.id}/approval`;
  assert.equal((await call("POST", reviewUrl, "/platform/v1/tenants/{id}/profile-changes/{changeId}/approval", { token: readonly.token, body: {} })).status, 403);
  // 别的供应商的路径下找不到这条
  assert.equal((await api.call("POST", `/platform/v1/tenants/${t.tenantId}/profile-changes/${submitted.body.id}/approval`, { token: bd.token, body: {} })).status, 404);

  const requested = await call("POST", reviewUrl, "/platform/v1/tenants/{id}/profile-changes/{changeId}/approval", { token: bd.token, body: { note: "已核对登记簿" } });
  assert.equal(requested.status, 202, requested.text);
  assert.equal(requested.body.approval.kind, "tenant.profile_change");
  const twice = await call("POST", reviewUrl, "/platform/v1/tenants/{id}/profile-changes/{changeId}/approval", { token: ops.token, body: {} });
  assert.deepEqual([twice.status, twice.body.error.code], [409, "PROFILE_CHANGE_REVIEW_PENDING"]);
  const rejectWhilePending = await api.call("POST", `${listUrl}/${submitted.body.id}/reject`, { token: ops.token, body: { reason: "x" } });
  assert.deepEqual([rejectWhilePending.status, rejectWhilePending.body.error.code], [409, "PROFILE_CHANGE_REVIEW_PENDING"]);
  const approvalId = requested.body.approval.id as string;
  // 发起人自己批不了；只读没有审核权限
  const self = await api.call("POST", `/platform/v1/approvals/${approvalId}/approve`, { token: bd.token, body: {} });
  assert.deepEqual([self.status, self.body.error.code], [409, "APPROVAL_SELF_REVIEW"]);
  assert.equal((await api.call("POST", `/platform/v1/approvals/${approvalId}/approve`, { token: readonly.token, body: {} })).status, 403);
  assert.equal((await tenantRow(u.tenantId)).name, "change车队", "还没批准，旧值照常用");

  const approved = await api.call("POST", `/platform/v1/approvals/${approvalId}/approve`, { token: ops.token, body: {} });
  assert.equal(approved.status, 200, approved.text);
  assert.equal((await tenantRow(u.tenantId)).name, "新车队");
  assert.deepEqual(await profileRow(u.tenantId), { legal_name: "株式会社新交通", registration_no: PROFILE.registration_no, address: PROFILE.address, contact_name: PROFILE.contact_name, version: 2 });
  const own = await call("GET", changes, changes, { token: u.adminToken });
  assert.deepEqual([own.body.items[0].status, own.body.items[0].rejected_by, own.body.items[0].approval_id], ["approved", undefined, undefined], "供应商看不到平台员工和复核编号");
  // 审计：申请的提交和生效、名称和企业信息的改动（操作者是审核人，带复核编号）
  assert.deepEqual((await audits("tenant_profile_change", submitted.body.id)).map((row) => [row.action, row.actor_type, row.actor_email]), [["submit", "tenant_user", "admin@change.test"], ["approve", "platform_user", "ops@platform.test"]]);
  const renamed = (await audits("tenant", u.tenantId)).filter((row) => row.action === "update").at(-1);
  assert.deepEqual([renamed?.actor_email, renamed?.before, renamed?.after.name, renamed?.after.approval_id], ["ops@platform.test", { name: "change车队" }, "新车队", approvalId]);
  const profileAudit = (await audits("tenant_profile", u.tenantId)).at(-1);
  assert.deepEqual([profileAudit?.before.legal_name, profileAudit?.after.legal_name, profileAudit?.after.change_id], [PROFILE.legal_name, "株式会社新交通", submitted.body.id]);
  const [approvedEvent] = await events(u.tenantId, "tenant.profile_change_approved");
  assert.deepEqual(approvedEvent?.data, { profile_fields: ["name", "legal_name"] });
  assert.deepEqual(await recipients(approvedEvent?.id as string), ["tenant:admin@change.test"], "发给供应商的管理员");
  // 有结论以后不能再处理
  const late = await api.call("POST", `${listUrl}/${submitted.body.id}/reject`, { token: ops.token, body: { reason: "x" } });
  assert.deepEqual([late.status, late.body.error.code], [409, "PROFILE_CHANGE_STATE_INVALID"]);
});

test("驳回：原因必填，供应商看得到；名称和企业信息不变；通知供应商；之后可以重新提交", async () => {
  const u = await activeTenant("reject");
  const changes = "/tenant/v1/company/profile-changes";
  const submitted = await ok(api.call("POST", changes, { token: u.adminToken, body: { registration_no: "0100-01-999999" } }), 201);
  const rejectUrl = `/platform/v1/tenants/${u.tenantId}/profile-changes/${submitted.id}/reject`;
  assert.equal((await api.call("POST", rejectUrl, { token: bd.token, body: { reason: " " } })).status, 400);
  assert.equal((await api.call("POST", rejectUrl, { token: readonly.token, body: { reason: "x" } })).status, 403);
  const rejected = await call("POST", rejectUrl, "/platform/v1/tenants/{id}/profile-changes/{changeId}/reject", { token: bd.token, body: { reason: "和登记簿上的号码对不上" } });
  assert.deepEqual([rejected.status, rejected.body.change.status, rejected.body.change.rejected_by.email], [200, "rejected", "bd@platform.test"]);
  assert.equal((await profileRow(u.tenantId))?.registration_no, PROFILE.registration_no);
  const own = await call("GET", changes, changes, { token: u.adminToken });
  assert.deepEqual([own.body.items[0].status, own.body.items[0].reject_reason], ["rejected", "和登记簿上的号码对不上"]);
  const [event] = await events(u.tenantId, "tenant.profile_change_rejected");
  assert.deepEqual(event?.data, { profile_fields: ["registration_no"], reject_reason: "和登记簿上的号码对不上" });
  // 驳回的不能再发起复核；可以重新提交
  const review = await api.call("POST", `/platform/v1/tenants/${u.tenantId}/profile-changes/${submitted.id}/approval`, { token: bd.token, body: {} });
  assert.deepEqual([review.status, review.body.error.code], [409, "PROFILE_CHANGE_STATE_INVALID"]);
  assert.equal((await api.call("POST", changes, { token: u.adminToken, body: { registration_no: "0100-01-999998" } })).status, 201);
});

test("过期：发起复核以后平台直接改过、或供应商撤回了，批准 409 APPROVAL_STALE、什么都不写，复核仍待审核；驳回复核以后再处理申请", async () => {
  const u = await activeTenant("stale");
  const changes = "/tenant/v1/company/profile-changes";
  const listUrl = `/platform/v1/tenants/${u.tenantId}/profile-changes`;
  // 1. 平台在审核期间直接改了名称
  const first = await ok(api.call("POST", changes, { token: u.adminToken, body: { name: "供应商要的名字" } }), 201);
  const review = await ok(api.call("POST", `${listUrl}/${first.id}/approval`, { token: bd.token, body: {} }), 202);
  const version = (await tenantRow(u.tenantId)).version;
  await ok(api.call("PATCH", `/platform/v1/tenants/${u.tenantId}`, { token: ops.token, body: { name: "平台改的名字" }, headers: ifMatch(version) }));
  const stale = await api.call("POST", `/platform/v1/approvals/${review.approval.id}/approve`, { token: ops.token, body: {} });
  assert.deepEqual([stale.status, stale.body.error.code], [409, "APPROVAL_STALE"]);
  assert.equal((await tenantRow(u.tenantId)).name, "平台改的名字");
  assert.equal((await api.db.owner.query("select status from approvals where id = $1", [review.approval.id])).rows[0].status, "pending");
  assert.equal((await api.db.owner.query("select status from tenant_profile_changes where id = $1", [first.id])).rows[0].status, "pending");
  // 驳回这条复核，再驳回申请（供应商的申请不会因为复核被驳回而自己变掉）
  await ok(api.call("POST", `/platform/v1/approvals/${review.approval.id}/reject`, { token: ops.token, body: { note: "平台已改名" } }));
  await ok(api.call("POST", `${listUrl}/${first.id}/reject`, { token: bd.token, body: { reason: "平台已按营业执照改好名称" } }));

  // 2. 供应商撤回了：批准过期；撤回只能撤自己等处理的
  const second = await ok(api.call("POST", changes, { token: u.adminToken, body: { legal_name: "株式会社撤回" } }), 201);
  const review2 = await ok(api.call("POST", `${listUrl}/${second.id}/approval`, { token: bd.token, body: {} }), 202);
  const withdrawn = await call("POST", `${changes}/${second.id}/withdraw`, "/tenant/v1/company/profile-changes/{id}/withdraw", { token: u.adminToken });
  assert.deepEqual([withdrawn.status, withdrawn.body.status], [200, "withdrawn"]);
  const twice = await call("POST", `${changes}/${second.id}/withdraw`, "/tenant/v1/company/profile-changes/{id}/withdraw", { token: u.adminToken });
  assert.deepEqual([twice.status, twice.body.error.code], [409, "PROFILE_CHANGE_STATE_INVALID"]);
  const stale2 = await api.call("POST", `/platform/v1/approvals/${review2.approval.id}/approve`, { token: ops.token, body: {} });
  assert.deepEqual([stale2.status, stale2.body.error.code], [409, "APPROVAL_STALE"]);
  assert.equal((await profileRow(u.tenantId))?.legal_name, PROFILE.legal_name);
  assert.deepEqual((await audits("tenant_profile_change", second.id)).map((row) => row.action), ["submit", "withdraw"]);
});

test("权限：供应商只有管理员能提交、撤回；财务、只读能看；平台的发起、驳回要 tenant.review，批准要 tenant.approve（渠道经理两样都没有）", async () => {
  const u = await activeTenant("perm");
  const changes = "/tenant/v1/company/profile-changes";
  const finance = await addTenantUser(api, u.adminToken, "finance@perm.test", "finance");
  const dispatch = await addTenantUser(api, u.adminToken, "dispatch@perm.test", "dispatch");
  assert.equal((await api.call("GET", changes, { token: finance.token })).status, 200);
  assert.equal((await api.call("GET", changes, { token: dispatch.token })).status, 403);
  assert.equal((await api.call("POST", changes, { token: finance.token, body: { name: "财务改名" } })).status, 403);
  const submitted = await ok(api.call("POST", changes, { token: u.adminToken, body: { name: "perm 新名" } }), 201);
  assert.equal((await api.call("POST", `${changes}/${submitted.id}/withdraw`, { token: finance.token })).status, 403);
  const listUrl = `/platform/v1/tenants/${u.tenantId}/profile-changes`;
  assert.equal((await api.call("GET", listUrl, { token: channels.token })).status, 200, "渠道经理有 tenant.read，能看");
  assert.equal((await api.call("POST", `${listUrl}/${submitted.id}/approval`, { token: channels.token, body: {} })).status, 403);
  assert.equal((await api.call("POST", `${listUrl}/${submitted.id}/reject`, { token: channels.token, body: { reason: "x" } })).status, 403);
  const review = await ok(api.call("POST", `${listUrl}/${submitted.id}/approval`, { token: ops.token, body: {} }), 202);
  // 渠道经理看得到这一类（tenant.read），但没有审核权限
  assert.equal((await api.call("POST", `/platform/v1/approvals/${review.approval.id}/approve`, { token: channels.token, body: {} })).status, 403);
  // 招商审运营发起的
  assert.equal((await api.call("POST", `/platform/v1/approvals/${review.approval.id}/approve`, { token: bd.token, body: {} })).status, 200);
  assert.equal((await tenantRow(u.tenantId)).name, "perm 新名");
});

test("数据库层面：供应商对申请只能读；新申请只能是等处理；有结论的不能再变；生效的必须有属于它的已批准复核", async () => {
  const u = await activeTenant("db");
  const submitted = await ok(api.call("POST", "/tenant/v1/company/profile-changes", { token: u.adminToken, body: { name: "db 新名" } }), 201);
  const owner = api.db.owner;
  await assert.rejects(owner.query("insert into tenant_profile_changes (tenant_id, fields, proposed, previous, status, submitted_by, submitted_at, updated_at) values ($1, '{name}', '{}', '{}', 'approved', $2, now(), now())", [u.tenantId, u.adminId]), /只能是等处理|tenant_profile_changes_approved/);
  await assert.rejects(owner.query("update tenant_profile_changes set status = 'approved', approval_id = (select id from approvals limit 1), decided_at = now() where id = $1", [submitted.id]), /已批准复核|violates/);
  await ok(api.call("POST", `/tenant/v1/company/profile-changes/${submitted.id}/withdraw`, { token: u.adminToken }));
  await assert.rejects(owner.query("update tenant_profile_changes set status = 'pending', decided_at = null where id = $1", [submitted.id]), /不能从 withdrawn 变成 pending/);
});
