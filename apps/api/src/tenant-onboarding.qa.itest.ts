/**
 * M4-01 测试角色补充（ADR 0028）：状态机的多原因暂停与先后消除、并发（每日检查与人工恢复同时、两条复核先后批准）、
 * 双人复核的边界（发起人自审、批准时状态已变、合同批准时生效日期已过）、每次变化的审计 / 状态记录 / 提醒各一条、
 * 文件按内容判断类型与下载安全头、跨租户（平台路径里的供应商编号与资质编号不配套、合同引用别家文件）、供应商视角不含平台内部信息。
 * 真实 PostgreSQL、真实接口；测试数据都在本文件里建，随测试库一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { type ApiResponse, type TenantFixture, type TestApi, TEST_PASSWORD, addTenantUser, approverToken, createTestApi, uploadBytes } from "./testing/api.ts";
import { type Market, buildMarket, ok } from "./testing/market.ts";

let api: TestApi;
let m: Market;
const DAY = 86_400_000;
let seq = 0;

const pdf = (label: string): Buffer => Buffer.from(`%PDF-1.7\n${label}\n%%EOF`);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

before(async () => {
  api = await createTestApi();
  m = await buildMarket(api);
  const invited = await ok(api.call("POST", "/platform/v1/staff", { token: m.root, body: { email: "bd@platform.test", name: "招商", role: "tenant_onboarding" } }), 201);
  await ok(api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.invite.token, password: TEST_PASSWORD } }));
  await approverToken(api, m.root);
});
after(() => api.close());

/** 时钟一次拨好几天，会话 8 小时过期：每次现登录。 */
async function platformLogin(email: string): Promise<string> {
  return (await ok(api.call("POST", "/platform/v1/auth/login", { body: { email, password: TEST_PASSWORD } }))).access_token;
}
async function tenantLogin(who: TenantFixture): Promise<string> {
  return (await ok(api.call("POST", "/tenant/v1/auth/login", { body: { email: who.adminEmail, password: TEST_PASSWORD } }))).access_token;
}
const root = (): Promise<string> => platformLogin("root@platform.test");
const bd = (): Promise<string> => platformLogin("bd@platform.test");
const ops = (): Promise<string> => platformLogin("ops@platform.test");
const approver = (): Promise<string> => platformLogin("approver@platform.test");
const approve = async (approvalId: string, token: string): Promise<ApiResponse> => api.call("POST", `/platform/v1/approvals/${approvalId}/approve`, { token, body: {} });
const tenantOf = async (who: TenantFixture): Promise<any> => ok(api.call("GET", `/platform/v1/tenants/${who.tenantId}`, { token: await root() }));
const today = (): string => new Date(api.clock.now().getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
const plusDays = (days: number): string => new Date(api.clock.now().getTime() + 9 * 3_600_000 + days * DAY).toISOString().slice(0, 10);

const JP_TYPES: [string, boolean][] = [
  ["commercial_registration", false],
  ["passenger_transport_license", true],
  ["passenger_liability_insurance", true],
  ["vehicle_insurance", true],
  ["settlement_account", false],
];

async function submitDocument(who: TenantFixture, type: string, expiresOn: string | null): Promise<any> {
  const token = await tenantLogin(who);
  api.clock.advance(1_000);
  const file = await uploadBytes(api, `/tenant/v1/company/files?file_name=${type}.pdf`, pdf(`${type}-${(seq += 1)}`), token, "application/pdf");
  assert.equal(file.status, 201, file.text);
  return ok(api.call("POST", "/tenant/v1/company/documents", { token, body: { type, file_id: file.body.id, expires_on: expiresOn } }), 201);
}

/**
 * 一家资料齐全、全部审核通过的日本供应商，摆成 `status`（试运营或正式）。`vehicleInsuranceDays`：营运车辆商业保险还有几天到期。
 */
async function onboarded(name: string, status: "trial" | "active", vehicleInsuranceDays = 400): Promise<TenantFixture> {
  const n = (seq += 1);
  const who = await api.tenantWithAdmin(await root(), name, `admin@qa-${n}.test`, { onboarding: "applying" });
  await ok(api.call("PUT", "/tenant/v1/company/profile", { token: who.adminToken, body: { country_code: "JP", legal_name: `${name}株式会社`, registration_no: `R-${n}`, address: "东京都", contact_name: name, contact_phone: "+81312345678", contact_email: `ops@qa-${n}.test` } }));
  for (const [type, expires] of JP_TYPES) {
    const document = await submitDocument(who, type, expires ? (type === "vehicle_insurance" ? plusDays(vehicleInsuranceDays) : plusDays(400)) : null);
    await ok(api.call("POST", `/platform/v1/tenants/${who.tenantId}/documents/${document.id}/approve`, { token: await bd(), body: {} }));
  }
  const now = api.clock.now();
  await api.db.owner.query("update tenants set status = $2, signed_at = $3, trial_started_at = $3, activated_at = $4 where id = $1", [who.tenantId, status, now, status === "active" ? now : null]);
  return who;
}

async function requestSuspend(who: TenantFixture, token: string, reason = "QA 人工暂停"): Promise<ApiResponse> {
  return api.call("POST", `/platform/v1/tenants/${who.tenantId}/suspend`, { token, body: { reason } });
}

/** 这家供应商的状态记录（时间正序）、审计里状态类的记录、给供应商的状态提醒。 */
async function trail(who: TenantFixture): Promise<{ events: any[]; audits: any[]; notices: any[] }> {
  const events = (await ok(api.call("GET", `/platform/v1/tenants/${who.tenantId}/status-events?limit=200`, { token: await root() }))).items.reverse();
  const audits = (await api.db.owner.query("select action, before, after from audit_logs where tenant_id = $1 and resource = 'tenant' and action <> 'create' order by id", [who.tenantId])).rows;
  const notices = (await api.db.owner.query("select kind, dedupe_key, data from tenant_notices where tenant_id = $1 and kind in ('status_changed', 'observation_started', 'observation_ended') order by created_at, dedupe_key", [who.tenantId])).rows;
  return { events, audits, notices };
}

/** 状态记录前后相接（每一条的「之前」是上一条的「之后」），而且和审计一一对应（同样的动作、同样的前后状态）。 */
function assertChained(t: { events: any[]; audits: any[] }): void {
  for (let index = 1; index < t.events.length; index += 1) {
    const [prev, next] = [t.events[index - 1], t.events[index]];
    assert.equal(next.from_status, prev.to_status, `第 ${index} 条的之前状态接不上`);
    assert.deepEqual(next.suspension_before, prev.suspension_after, `第 ${index} 条的之前暂停原因接不上`);
  }
  assert.equal(t.audits.length, t.events.length, "审计和状态记录一一对应");
  t.events.forEach((event, index) => {
    const audit = t.audits[index];
    assert.equal(audit.before.status, event.from_status);
    assert.equal(audit.after.status, event.to_status);
    assert.deepEqual(audit.after.suspension_reasons, event.suspension_after);
  });
}

// ---- 状态机：多个暂停原因 ----

test("两个暂停原因先后消除：人工暂停中资质又到期 → 人工恢复被拒（DOCUMENTS_INVALID）→ 换证通过只去掉「资质过期」、仍暂停 → 人工恢复回到暂停前的试运营；每一步审计、状态记录、提醒各一条", async () => {
  const t = await onboarded("多原因车队", "trial", 3);
  const requested = await requestSuspend(t, await bd());
  assert.equal(requested.status, 202, requested.text);
  assert.equal((await approve(requested.body.approval.id, await ops())).status, 200);
  let tenant = await tenantOf(t);
  assert.deepEqual([tenant.status, tenant.suspended_from, tenant.suspension_reasons], ["suspended", "trial", ["manual"]]);

  // 第 3 天：保险到期（东京日期），每日检查加上第二个原因
  api.clock.advance(3 * DAY);
  await api.app.tenantJobs.tick();
  tenant = await tenantOf(t);
  assert.deepEqual([tenant.status, tenant.suspended_from, [...tenant.suspension_reasons].sort()], ["suspended", "trial", ["document_expired", "manual"]]);
  const refused = await api.call("POST", `/platform/v1/tenants/${t.tenantId}/resume`, { token: await ops(), body: {} });
  assert.deepEqual([refused.status, refused.body.error.code], [409, "DOCUMENTS_INVALID"]);

  // 换证：通过以后只去掉「资质过期」，人工暂停还在
  const renewal = await submitDocument(t, "vehicle_insurance", plusDays(365));
  const reviewed = await ok(api.call("POST", `/platform/v1/tenants/${t.tenantId}/documents/${renewal.id}/approve`, { token: await bd(), body: {} }));
  assert.deepEqual([reviewed.tenant.status, reviewed.tenant.suspension_reasons, reviewed.tenant.suspended_from], ["suspended", ["manual"], "trial"]);

  // 人工恢复：回到暂停之前的试运营
  const resumed = await ok(api.call("POST", `/platform/v1/tenants/${t.tenantId}/resume`, { token: await ops(), body: {} }));
  assert.deepEqual([resumed.status, resumed.suspension_reasons, resumed.suspended_from, resumed.suspended_at], ["trial", [], null, null]);

  const record = await trail(t);
  assert.deepEqual(record.events.map((event) => [event.trigger, event.from_status, event.to_status, [...event.suspension_after].sort()]), [
    ["suspend", "trial", "suspended", ["manual"]],
    ["suspend", "suspended", "suspended", ["document_expired", "manual"]],
    ["suspend", "suspended", "suspended", ["manual"]],
    ["resume", "suspended", "trial", []],
  ]);
  assertChained(record);
  const statusNotices = record.notices.filter((notice) => notice.kind === "status_changed");
  assert.equal(statusNotices.length, 4, "每次状态或暂停原因变化一条提醒");
  assert.equal(new Set(statusNotices.map((notice) => notice.dedupe_key)).size, 4);
  // 再跑一次今天的检查、再跑一次第二天的检查：没有新的变化就不写
  await api.app.tenantJobs.tick();
  api.clock.advance(DAY);
  await api.app.tenantJobs.tick();
  assert.equal((await trail(t)).events.length, 4);
});

test("系统暂停（资质过期）+ 人工暂停批准：顺序反过来（先过期、后人工），换证后仍暂停；只因资质过期暂停的正式供应商换证后回到正式", async () => {
  const t = await onboarded("先过期车队", "active", 1);
  api.clock.advance(DAY);
  await api.app.tenantJobs.tick();
  let tenant = await tenantOf(t);
  assert.deepEqual([tenant.status, tenant.suspended_from, tenant.suspension_reasons], ["suspended", "active", ["document_expired"]]);
  // 已经因为资质暂停：还能发起人工暂停（多一个原因）
  const requested = await requestSuspend(t, await bd());
  assert.equal(requested.status, 202, requested.text);
  assert.equal((await approve(requested.body.approval.id, await approver())).status, 200);
  tenant = await tenantOf(t);
  assert.deepEqual([...tenant.suspension_reasons].sort(), ["document_expired", "manual"]);
  const renewal = await submitDocument(t, "vehicle_insurance", plusDays(365));
  const reviewed = await ok(api.call("POST", `/platform/v1/tenants/${t.tenantId}/documents/${renewal.id}/approve`, { token: await bd(), body: {} }));
  assert.deepEqual([reviewed.tenant.status, reviewed.tenant.suspension_reasons], ["suspended", ["manual"]]);
  assert.equal((await ok(api.call("POST", `/platform/v1/tenants/${t.tenantId}/resume`, { token: await ops(), body: {} }))).status, "active");

  // 另一家：只因资质过期暂停 → 换证通过直接回到正式
  const u = await onboarded("只过期车队", "active", 1);
  api.clock.advance(DAY);
  await api.app.tenantJobs.tick();
  assert.equal((await tenantOf(u)).status, "suspended");
  const renewed = await submitDocument(u, "vehicle_insurance", plusDays(365));
  const back = await ok(api.call("POST", `/platform/v1/tenants/${u.tenantId}/documents/${renewed.id}/approve`, { token: await bd(), body: {} }));
  assert.deepEqual([back.tenant.status, back.tenant.suspension_reasons, back.tenant.suspended_from], ["active", [], null]);
  assertChained(await trail(u));
});

test("到期当天按东京日期：到期日前一天东京 23:59:59 跑检查不暂停，东京 0 点过后的第一轮暂停", async () => {
  const t = await onboarded("午夜车队", "active", 2);
  await api.app.tenantJobs.tick();
  // 拨到「到期日前一天」东京 23:59:59.000（UTC 14:59:59）
  const expiry = plusDays(2);
  const lastSecond = Date.parse(`${expiry}T00:00:00+09:00`) - 1_000;
  api.clock.advance(lastSecond - api.clock.now().getTime());
  await api.app.tenantJobs.tick();
  assert.equal((await tenantOf(t)).status, "active", "到期日前一天还有效");
  api.clock.advance(1_001);
  await api.app.tenantJobs.tick();
  const tenant = await tenantOf(t);
  assert.deepEqual([tenant.status, tenant.suspension_reasons], ["suspended", ["document_expired"]]);
  // 收尾：换证
  const renewal = await submitDocument(t, "vehicle_insurance", plusDays(365));
  await ok(api.call("POST", `/platform/v1/tenants/${t.tenantId}/documents/${renewal.id}/approve`, { token: await bd(), body: {} }));
});

test("非法转换都是 409、不写任何记录：试运营 / 正式不能人工恢复；已签约不能暂停；已清退不能恢复、暂停、签约、开始试运营、审核资质", async () => {
  const active = await onboarded("非法转换车队", "active");
  const before = (await trail(active)).events.length;
  const token = await ops();
  for (const path of ["resume", "sign"]) {
    const res = await api.call("POST", `/platform/v1/tenants/${active.tenantId}/${path}`, { token, body: {} });
    assert.deepEqual([res.status, res.body.error.code], [409, "TENANT_STATE_INVALID"], path);
  }
  const trial = await api.call("POST", `/platform/v1/tenants/${active.tenantId}/start-trial`, { token, body: { test_order_note: "x" } });
  assert.deepEqual([trial.status, trial.body.error.code], [409, "TENANT_STATE_INVALID"]);
  assert.equal((await trail(active)).events.length, before);

  await api.db.owner.query("update tenants set status = 'signed' where id = $1", [active.tenantId]);
  const signedSuspend = await requestSuspend(active, token);
  assert.deepEqual([signedSuspend.status, signedSuspend.body.error.code], [409, "TENANT_STATE_INVALID"]);

  // 清退（双人复核），之后什么都不能做
  const terminate = await api.call("POST", `/platform/v1/tenants/${active.tenantId}/terminate`, { token, body: { reason: "QA 清退" } });
  assert.equal(terminate.status, 202, terminate.text);
  assert.equal((await approve(terminate.body.approval.id, await approver())).status, 200);
  const doc = (await ok(api.call("GET", `/platform/v1/tenants/${active.tenantId}/company`, { token }))).documents[0];
  for (const [path, body] of [["resume", {}], ["sign", {}], ["start-trial", { test_order_note: "x" }], ["suspend", { reason: "x" }], ["terminate", { reason: "x" }], [`documents/${doc.id}/reject`, { reason: "x" }]] as const) {
    const res = await api.call("POST", `/platform/v1/tenants/${active.tenantId}/${path}`, { token, body });
    assert.equal(res.status, 409, `${path}: ${res.text}`);
  }
  const terminated = await tenantOf(active);
  assert.deepEqual([terminated.status, terminated.suspension_reasons, terminated.observation_reasons], ["terminated", [], []]);
});

// ---- 并发 ----

test("并发：每日检查（要因资质过期自动暂停）和运营人工恢复同时发生——无论谁先，最终状态和状态记录、审计前后相接，不丢原因、不重复写", async () => {
  for (let round = 0; round < 3; round += 1) {
    const t = await onboarded(`并发车队${round}`, "active", 1);
    await api.app.tenantJobs.tick();
    const requested = await requestSuspend(t, await bd());
    assert.equal((await approve(requested.body.approval.id, await ops())).status, 200);
    api.clock.advance(DAY);
    const token = await ops();
    const [, resume] = await Promise.all([api.app.tenantJobs.tick(), api.call("POST", `/platform/v1/tenants/${t.tenantId}/resume`, { token, body: {} })]);
    // 被检查锁住时跳过的，下一轮补做
    await api.app.tenantJobs.tick();
    const tenant = await tenantOf(t);
    if (resume.status === 200) {
      // 恢复先做：回到正式，随后的检查发现资质过期再暂停
      assert.deepEqual([tenant.status, tenant.suspension_reasons], ["suspended", ["document_expired"]]);
    } else {
      assert.deepEqual([resume.status, resume.body.error.code], [409, "DOCUMENTS_INVALID"], resume.text);
      assert.deepEqual([tenant.status, [...tenant.suspension_reasons].sort()], ["suspended", ["document_expired", "manual"]]);
    }
    assert.equal(tenant.suspended_from, "active");
    const record = await trail(t);
    assertChained(record);
    assert.equal(record.notices.filter((notice) => notice.kind === "status_changed").length, record.events.filter((event) => event.from_status !== event.to_status || JSON.stringify([...event.suspension_before].sort()) !== JSON.stringify([...event.suspension_after].sort())).length);
  }
});

test("并发：同一家的两条人工暂停复核（发起时都还没暂停）——第一条批准生效，第二条批准 409 且不改状态；两条清退同时批准只有一条生效", async () => {
  const t = await onboarded("两条复核车队", "active");
  const first = await requestSuspend(t, await bd(), "第一条");
  const second = await requestSuspend(t, await root(), "第二条");
  assert.deepEqual([first.status, second.status], [202, 202]);
  assert.equal((await approve(first.body.approval.id, await ops())).status, 200);
  const late = await approve(second.body.approval.id, await ops());
  assert.equal(late.status, 409, late.text);
  const pending = await ok(api.call("GET", `/platform/v1/approvals/${second.body.approval.id}`, { token: await root() }));
  assert.equal((pending.approval ?? pending).status, "pending", "生效失败整个回滚，复核仍待审");
  assert.equal((await trail(t)).events.length, 1);
  await ok(api.call("POST", `/platform/v1/tenants/${t.tenantId}/resume`, { token: await ops(), body: {} }));

  const x = await api.call("POST", `/platform/v1/tenants/${t.tenantId}/terminate`, { token: await bd(), body: { reason: "清退一" } });
  const y = await api.call("POST", `/platform/v1/tenants/${t.tenantId}/terminate`, { token: await root(), body: { reason: "清退二" } });
  const [opsToken, approverTok] = [await ops(), await approver()];
  const results = await Promise.all([approve(x.body.approval.id, opsToken), approve(y.body.approval.id, approverTok)]);
  assert.deepEqual(results.map((res) => res.status).sort(), [200, 409], results.map((res) => res.text).join(" | "));
  const events = (await trail(t)).events;
  assert.equal(events.filter((event) => event.trigger === "terminate").length, 1);
});

// ---- 双人复核 ----

test("双人复核：暂停、清退的发起人不能自审（APPROVAL_SELF_REVIEW）；渠道经理、只读不能审；批准前状态不变", async () => {
  const t = await onboarded("自审车队", "active");
  const bdToken = await bd();
  for (const [path, body] of [["suspend", { reason: "自审暂停" }], ["terminate", { reason: "自审清退" }]] as const) {
    const requested = await api.call("POST", `/platform/v1/tenants/${t.tenantId}/${path}`, { token: bdToken, body });
    assert.equal(requested.status, 202, requested.text);
    const self = await approve(requested.body.approval.id, bdToken);
    assert.deepEqual([self.status, self.body.error.code], [409, "APPROVAL_SELF_REVIEW"], path);
    assert.equal((await approve(requested.body.approval.id, await platformLogin("cm1@platform.test"))).status, 403);
    assert.equal((await approve(requested.body.approval.id, await platformLogin("ro@platform.test"))).status, 403);
    assert.equal((await tenantOf(t)).status, "active", "批准之前不生效");
    assert.equal((await api.call("POST", `/platform/v1/approvals/${requested.body.approval.id}/withdraw`, { token: bdToken, body: {} })).status, 200);
  }
  // 超级管理员自己发起的也不能自己批
  const rootToken = await root();
  const mine = await requestSuspend(t, rootToken);
  assert.deepEqual([(await approve(mine.body.approval.id, rootToken)).status], [409]);
  await api.call("POST", `/platform/v1/approvals/${mine.body.approval.id}/withdraw`, { token: rootToken, body: {} });
});

test("合同复核：两条新版本同时待审，先批的生效，后批的 APPROVAL_STALE；合同版本号连续", async () => {
  const t = await onboarded("合同车队", "active");
  const bdToken = await bd();
  const v1 = await api.call("POST", `/platform/v1/tenants/${t.tenantId}/contracts`, { token: bdToken, body: { valid_from: today(), settle_currency: "JPY" } });
  assert.equal(v1.status, 202, v1.text);
  assert.equal((await approve(v1.body.approval.id, await ops())).status, 200);
  const a = await api.call("POST", `/platform/v1/tenants/${t.tenantId}/contracts`, { token: bdToken, body: { valid_from: plusDays(10), settle_currency: "USD" } });
  const b = await api.call("POST", `/platform/v1/tenants/${t.tenantId}/contracts`, { token: bdToken, body: { valid_from: plusDays(20), settle_currency: "KRW" } });
  assert.deepEqual([a.status, b.status], [202, 202]);
  assert.equal((await approve(a.body.approval.id, await ops())).status, 200);
  const stale = await approve(b.body.approval.id, await ops());
  assert.deepEqual([stale.status, stale.body.error.code], [409, "APPROVAL_STALE"]);
  const contracts = (await ok(api.call("GET", "/tenant/v1/company/contracts", { token: await tenantLogin(t) }))).items;
  assert.deepEqual(contracts.map((contract: any) => [contract.version, contract.settle_currency]), [[1, "JPY"], [2, "USD"]]);
});

test("合同新版本发起时生效日期是今天，第二天才批准——生效日期已在过去，批准 409 CONTRACT_VALID_FROM_PASSED（不追溯修改结算条款），复核仍待审核、可以驳回", async () => {
  const t = await onboarded("追溯合同车队", "active");
  const requested = await api.call("POST", `/platform/v1/tenants/${t.tenantId}/contracts`, { token: await bd(), body: { valid_from: today(), settle_currency: "JPY" } });
  assert.equal(requested.status, 202, requested.text);
  const requestedFor = today();
  api.clock.advance(DAY);
  const approved = await approve(requested.body.approval.id, await ops());
  const contracts = (await ok(api.call("GET", "/tenant/v1/company/contracts", { token: await tenantLogin(t) }))).items;
  // 期望：ADR 0028「生效日期不早于今天（不追溯）」在批准时也成立——要么拒绝（409），要么写入的生效日期不早于批准当天
  const retroactive = approved.status === 200 && contracts.some((contract: any) => contract.valid_from < today());
  assert.ok(!retroactive, `批准于 ${today()}，写入的合同生效日期 ${requestedFor} 已在过去：${approved.status} ${JSON.stringify(contracts.map((contract: any) => contract.valid_from))}`);
  assert.deepEqual([approved.status, approved.body.error?.code], [409, "CONTRACT_VALID_FROM_PASSED"], approved.text);
  const rejected = await api.call("POST", `/platform/v1/approvals/${requested.body.approval.id}/reject`, { token: await ops(), body: { note: "生效日期已过，重新发起" } });
  assert.equal(rejected.status, 200, rejected.text);
});

// ---- 文件 ----

test("文件按内容判断：SVG、HTML、伪装成 PDF 扩展名的 PNG、只有签名前缀的半截文件都拒；声明带参数的类型照样认；正好 10 MB 收、多 1 字节 413；0 字节 400", async () => {
  const t = await onboarded("文件车队", "active");
  const token = await tenantLogin(t);
  const countFiles = async (): Promise<number> => (await api.db.owner.query<{ n: number }>("select count(*)::int as n from tenant_files where tenant_id = $1", [t.tenantId])).rows[0]?.n ?? 0;
  const filesBefore = await countFiles();
  const up = (bytes: Buffer, type: string, name = "x.pdf"): Promise<ApiResponse> => uploadBytes(api, `/tenant/v1/company/files?file_name=${encodeURIComponent(name)}`, bytes, token, type);
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
  for (const [bytes, type] of [[svg, "image/svg+xml"], [svg, "application/octet-stream"], [svg, "application/pdf"], [Buffer.from("<!doctype html><script>alert(1)</script>"), "application/octet-stream"], [Buffer.from("%PDF"), "application/pdf"], [Buffer.from([0x89, 0x50, 0x4e, 0x47]), "image/png"]] as const) {
    const res = await up(bytes, type);
    assert.equal(res.status, 415, `${type} ${bytes.subarray(0, 10).toString()}: ${res.status} ${res.text}`);
  }
  // 扩展名写 .pdf、内容是 PNG：按内容认成 PNG（声明 octet-stream）
  const disguised = await up(PNG, "application/octet-stream", "license.pdf");
  assert.deepEqual([disguised.status, disguised.body.content_type], [201, "image/png"]);
  const lyingJpeg = await up(pdf("x"), "image/jpeg");
  assert.equal(lyingJpeg.status, 415);
  assert.equal((await up(JPEG, "image/jpeg; charset=binary")).status, 201);
  assert.equal((await up(pdf("p"), "Application/PDF")).status, 201, "类型名大小写不敏感");
  // 大小边界
  const exact = Buffer.concat([pdf("10mb"), Buffer.alloc(10 * 1024 * 1024 - pdf("10mb").length)]);
  assert.equal(exact.length, 10 * 1024 * 1024);
  const ten = await up(exact, "application/pdf");
  assert.deepEqual([ten.status, ten.body?.byte_size], [201, 10 * 1024 * 1024], ten.text.slice(0, 200));
  const over = await up(Buffer.concat([exact, Buffer.from([0])]), "application/pdf");
  assert.deepEqual([over.status, over.body?.error?.code], [413, "PAYLOAD_TOO_LARGE"]);
  const empty = await up(Buffer.alloc(0), "application/octet-stream");
  assert.equal(empty.status, 400, empty.text);
  // 失败的请求一个文件都没写进库：只多了成功的 4 个
  assert.equal(await countFiles(), filesBefore + 4);
});

test("下载：以 %PDF- 开头、里面夹着 HTML 的文件原样返回 application/pdf + attachment + nosniff + CSP sandbox；文件名里的换行、引号、双向控制字符不进响应头", async () => {
  const t = await onboarded("下载车队", "active");
  const token = await tenantLogin(t);
  const polyglot = Buffer.from("%PDF-1.4\n<html><body><script>alert(document.cookie)</script></body></html>");
  const name = 'evil\r\nSet-Cookie: x=1‮gnp."<b>.pdf';
  const up = await uploadBytes(api, `/tenant/v1/company/files?file_name=${encodeURIComponent(name)}`, polyglot, token, "application/octet-stream");
  assert.deepEqual([up.status, up.body.content_type], [201, "application/pdf"]);
  assert.ok(!/[\r\n"‮]/.test(up.body.file_name), JSON.stringify(up.body.file_name));
  for (const [url, auth] of [[`/tenant/v1/company/files/${up.body.id}`, token], [`/platform/v1/tenants/${t.tenantId}/files/${up.body.id}`, await bd()]] as const) {
    const res = await api.app.inject({ method: "GET", url, headers: { authorization: `Bearer ${auth}` } });
    assert.equal(res.statusCode, 200, url);
    assert.deepEqual(res.rawPayload, polyglot);
    assert.equal(res.headers["content-type"], "application/pdf");
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.equal(res.headers["content-security-policy"], "default-src 'none'; sandbox");
    assert.equal(res.headers["cache-control"], "no-store");
    assert.equal(res.headers["set-cookie"], undefined);
    const disposition = String(res.headers["content-disposition"]);
    assert.match(disposition, /^attachment; /);
    assert.ok(!/[\r\n]/.test(disposition));
  }
});

test("下载权限：供应商的财务、只读能下载自己的，定价、调度不能；平台超级管理员、运营、招商能，只读、渠道经理、主数据运营不能；别家的文件 404", async () => {
  const t = await onboarded("权限车队", "active");
  const other = await onboarded("别家车队", "active");
  const token = await tenantLogin(t);
  const file = await uploadBytes(api, "/tenant/v1/company/files?file_name=a.pdf", pdf("权限"), token, "application/pdf");
  const otherFile = await uploadBytes(api, "/tenant/v1/company/files?file_name=b.pdf", pdf("别家"), await tenantLogin(other), "application/pdf");
  const get = async (url: string, auth: string): Promise<number> => (await api.app.inject({ method: "GET", url, headers: { authorization: `Bearer ${auth}` } })).statusCode;
  for (const role of ["finance", "readonly", "pricing", "dispatch"] as const) {
    const user = await addTenantUser(api, token, `${role}-${(seq += 1)}@qa-files.test`, role);
    assert.equal(await get(`/tenant/v1/company/files/${file.body.id}`, user.token), role === "finance" || role === "readonly" ? 200 : 403, role);
    assert.equal(await get(`/tenant/v1/company/files/${otherFile.body.id}`, user.token), role === "finance" || role === "readonly" ? 404 : 403, `${role} 别家`);
  }
  const platformUrl = `/platform/v1/tenants/${t.tenantId}/files/${file.body.id}`;
  for (const [who, expected] of [["root@platform.test", 200], ["ops@platform.test", 200], ["bd@platform.test", 200], ["ro@platform.test", 403], ["cm1@platform.test", 403], ["md@platform.test", 403]] as const) {
    assert.equal(await get(platformUrl, await platformLogin(who)), expected, who);
  }
  // 平台路径里供应商编号和文件不配套：404（不会因为平台能看所有租户就返回别家的文件）
  assert.equal(await get(`/platform/v1/tenants/${t.tenantId}/files/${otherFile.body.id}`, await bd()), 404);
});

// ---- 跨租户（平台路径）、供应商视角 ----

test("跨租户：平台按甲的路径审乙的资质 404、乙的资质不变；给甲发起合同引用乙的合同扫描件 400 UNKNOWN_FILE；供应商的资质不能引用别家的文件", async () => {
  const a = await api.tenantWithAdmin(await root(), "跨租户甲", `admin@qa-x${(seq += 1)}.test`, { onboarding: "applying" });
  const b = await api.tenantWithAdmin(await root(), "跨租户乙", `admin@qa-x${(seq += 1)}.test`, { onboarding: "applying" });
  const bDoc = await submitDocument(b, "settlement_account", null);
  const token = await bd();
  for (const action of ["approve", "reject", "request-supplement"]) {
    const res = await api.call("POST", `/platform/v1/tenants/${a.tenantId}/documents/${bDoc.id}/${action}`, { token, body: action === "approve" ? {} : { reason: "x" } });
    assert.equal(res.status, 404, `${action}: ${res.text}`);
  }
  const bCompany = await ok(api.call("GET", `/platform/v1/tenants/${b.tenantId}/company`, { token }));
  assert.equal(bCompany.documents.find((document: any) => document.id === bDoc.id).status, "pending");

  const scan = await uploadBytes(api, `/platform/v1/tenants/${b.tenantId}/files?file_name=b.pdf`, pdf("乙的合同"), token, "application/pdf");
  assert.equal(scan.status, 201, scan.text);
  const contract = await api.call("POST", `/platform/v1/tenants/${a.tenantId}/contracts`, { token, body: { valid_from: plusDays(1), settle_currency: "JPY", file_id: scan.body.id } });
  assert.deepEqual([contract.status, contract.body.error?.details?.issues?.[0]?.reason], [400, "UNKNOWN_FILE"]);
  // 乙看得到平台给它传的合同扫描件，甲拿同一个编号下载 404
  assert.equal((await api.app.inject({ method: "GET", url: `/tenant/v1/company/files/${scan.body.id}`, headers: { authorization: `Bearer ${await tenantLogin(b)}` } })).statusCode, 200);
  assert.equal((await api.app.inject({ method: "GET", url: `/tenant/v1/company/files/${scan.body.id}`, headers: { authorization: `Bearer ${await tenantLogin(a)}` } })).statusCode, 404);
  // 甲用平台给乙传的合同文件提交资质：当作不存在
  const stolen = await api.call("POST", "/tenant/v1/company/documents", { token: await tenantLogin(a), body: { type: "settlement_account", file_id: scan.body.id } });
  assert.deepEqual([stolen.status, stolen.body.error.details.issues[0].reason], [400, "UNKNOWN_FILE"]);
  // 乙自己用平台传的合同文件交资质：用途不对
  const wrongPurpose = await api.call("POST", "/tenant/v1/company/documents", { token: await tenantLogin(b), body: { type: "settlement_account", file_id: scan.body.id } });
  assert.deepEqual([wrongPurpose.status, wrongPurpose.body.error.details.issues[0].reason], [400, "WRONG_FILE_PURPOSE"]);
});

test("供应商视角：企业资质、状态记录、提醒、评分里没有审核人、平台员工邮箱、人工暂停的内部原因、复核编号、别家供应商；规则 4 的字段也没有", async () => {
  const t = await onboarded("视角车队", "active");
  const other = await onboarded("视角别家", "active");
  const requested = await requestSuspend(t, await bd(), "内部：怀疑刷单 QA-SECRET");
  assert.equal((await approve(requested.body.approval.id, await ops())).status, 200);
  await ok(api.call("POST", `/platform/v1/tenants/${t.tenantId}/resume`, { token: await ops(), body: { note: "内部恢复说明 QA-SECRET2" } }));
  api.clock.advance(DAY);
  await api.app.tenantJobs.tick();
  const token = await tenantLogin(t);
  const forbidden = ["bd@platform.test", "ops@platform.test", "root@platform.test", "QA-SECRET", requested.body.approval.id, other.tenantId, "视角别家", "reviewed_by", "approval_id"];
  for (const path of ["/tenant/v1/company", "/tenant/v1/company/status-events?limit=200", "/tenant/v1/company/notices?limit=200", "/tenant/v1/performance", "/tenant/v1/company/contracts"]) {
    const res = await api.call("GET", path, { token });
    assert.equal(res.status, 200, path);
    for (const secret of forbidden) assert.ok(!res.text.includes(secret), `${path} 里出现了 ${secret}`);
    assert.doesNotMatch(res.text, /markup|sell_price|selling_price|public_price|rank_price|对外价|加价/i, path);
  }
  // 供应商的操作日志里也没有
  const audit = await api.call("GET", "/tenant/v1/audit-logs?limit=200", { token });
  assert.equal(audit.status, 200);
  for (const secret of forbidden) assert.ok(!audit.text.includes(secret), `操作日志里出现了 ${secret}`);
  // 平台看得到这些
  const platformEvents = await ok(api.call("GET", `/platform/v1/tenants/${t.tenantId}/status-events`, { token: await root() }));
  assert.ok(JSON.stringify(platformEvents).includes("QA-SECRET"));
});
