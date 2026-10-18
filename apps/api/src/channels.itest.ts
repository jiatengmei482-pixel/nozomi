/**
 * M2-04：渠道、加价规则（五级匹配、日期范围、下限拦截）、双人复核、API 客户端与密钥，经真实接口、真实 PostgreSQL（ADR 0023）。
 * 每个应答都按 openapi.yaml 核对。测试数据在 testing/market.ts 和这里构造，结束时连同 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { type ApiResponse, type HttpMethod, TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";
import { type Market, DROPOFF, approvedBy, buildMarket, newChannel, ok, ruleRequest, salesCredentials } from "./testing/market.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";

let api: TestApi;
let m: Market;

before(async () => {
  api = await createTestApi();
  m = await buildMarket(api);
});
after(() => api.close());

/** 调用并按定义核对应答。`template` 是定义里的路径写法。 */
async function checked(method: HttpMethod, url: string, template: string, options: { token: string; body?: unknown; headers?: Record<string, string> }): Promise<ApiResponse> {
  const res = await api.call(method, url, options);
  assertMatchesOpenApi(method, template, res);
  return res;
}

const previewAsk = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ city_id: m.ids.tokyo, category: "airport_transfer", place_id: m.ids.narita, currency: "JPY", direction: "pickup", dropoff: DROPOFF, service_time: "2026-10-20T10:00", passengers: 2, luggage: 1, ...extra });
const candidateOf = (body: any, vehicleGroupId: string, tenantId: string): any => body.groups.find((g: any) => g.vehicle_group_id === vehicleGroupId)?.candidates.find((c: any) => c.tenant_id === tenantId);

test("新建渠道：渠道经理能建，状态是「测试」，定价参数是默认值（加价 10%、下限 10%、价格带 3%）；只读能看不能建，主数据运营看不到；没有预置任何渠道", async () => {
  assert.equal((await api.db.owner.query("select count(*)::int as n from channels")).rows[0].n, 0);
  const empty = await checked("GET", "/platform/v1/channels", "/platform/v1/channels", { token: m.staff.readonly.token });
  assert.deepEqual([empty.status, empty.body.total], [200, 0]);
  const created = await checked("POST", "/platform/v1/channels", "/platform/v1/channels", { token: m.staff.cm1.token, body: { name: "NOZOMI 官网", type: "own", settle_currency: "JPY", company: "NOZOMI" } });
  assert.equal(created.status, 201, created.text);
  const channel = created.body.channel;
  assert.deepEqual([channel.status, channel.pricing, channel.scope], ["testing", { default_markup_bp: 1_000, markup_floor_bp: 1_000, band_bp: 300, min_margin: 0, sell_rounding: {} }, { tenant_scope: "all", tenants: [], cities: null, categories: ["airport_transfer", "point_to_point", "charter"] }]);
  assert.equal((await api.call("POST", "/platform/v1/channels", { token: m.staff.readonly.token, body: { name: "x", type: "own", settle_currency: "JPY" } })).status, 403);
  const hidden = await api.call("GET", "/platform/v1/channels", { token: m.staff.masterData.token });
  assert.deepEqual([hidden.status, hidden.body.error.details.required], [403, "channel.read"]);
  const same = await checked("POST", "/platform/v1/channels", "/platform/v1/channels", { token: m.staff.cm1.token, body: { name: "nozomi 官网", type: "own", settle_currency: "JPY" } });
  assert.deepEqual([same.status, same.body.error.code], [409, "CHANNEL_NAME_TAKEN"]);
  const audit = await api.db.owner.query("select actor_email, action, after->>'name' as name from audit_logs where resource = 'channel' and resource_id = $1", [channel.id]);
  assert.deepEqual(audit.rows, [{ actor_email: "cm1@platform.test", action: "create", name: "NOZOMI 官网" }]);
});

test("加价下限：低于平台下限 10% 拦截；默认加价低于下限拦截；价格带超过 5% 拦截", async () => {
  const send = (pricing: Record<string, unknown>) => checked("POST", "/platform/v1/channels", "/platform/v1/channels", { token: m.staff.cm1.token, body: { name: `低价-${JSON.stringify(pricing)}`, type: "api", settle_currency: "JPY", pricing } });
  const below = await send({ markup_floor_bp: 999, default_markup_bp: 1_200 });
  assert.deepEqual([below.status, below.body.error.details.issues.map((i: any) => i.reason)], [400, ["BELOW_PLATFORM_FLOOR"]]);
  const defaultBelow = await send({ markup_floor_bp: 1_200, default_markup_bp: 1_100 });
  assert.deepEqual(defaultBelow.body.error.details.issues.map((i: any) => [i.path, i.reason]), [["/default_markup_bp", "BELOW_FLOOR"]]);
  assert.equal((await send({ band_bp: 501 })).status, 400);
  // 数据库自己也拦：绕过接口直接写低于 10% 的下限、默认加价低于下限、加价规则低于 10%
  const channel = await newChannel(api, m.staff.cm1.token, { name: "约束测试" });
  await assert.rejects(api.db.owner.query("update channels set markup_floor_bp = 900, default_markup_bp = 900 where id = $1", [channel.id]), { code: "23514" });
  await assert.rejects(api.db.owner.query("update channels set default_markup_bp = 999 where id = $1", [channel.id]), { code: "23514" });
  await assert.rejects(api.db.owner.query("insert into markup_rules (channel_id, level, supplier_tenant_id, markup_bp, created_at, updated_at) values ($1, 2, $2, 900, now(), now())", [channel.id, m.a.tenantId]), { code: "23514" });
});

test("双人复核：改定价参数要另一个人批准才生效；发起人不能批准、也不能驳回自己发起的；没有审核权限的不能批准；全部留审计", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "复核渠道" });
  const requested = await checked("POST", `/platform/v1/channels/${channel.id}/pricing-changes`, "/platform/v1/channels/{id}/pricing-changes", { token: m.staff.cm1.token, body: { default_markup_bp: 1_200, markup_floor_bp: 1_100, band_bp: 200, request_note: "旺季提价" } });
  assert.equal(requested.status, 202, requested.text);
  const approval = requested.body.approval;
  assert.deepEqual([approval.status, approval.kind, approval.requested_by.email, approval.can], ["pending", "channel.pricing", "cm1@platform.test", { approve: false, reject: false, withdraw: true }]);
  assert.match(approval.summary, /默认加价 10% → 12%，加价下限 10% → 11%，价格带 3% → 2%/);
  // 还没生效
  const unchanged = await checked("GET", `/platform/v1/channels/${channel.id}`, "/platform/v1/channels/{id}", { token: m.staff.readonly.token });
  assert.equal(unchanged.body.channel.pricing.default_markup_bp, 1_000);
  // 发起人自己批准、驳回：409
  for (const decision of ["approve", "reject"]) {
    const self = await checked("POST", `/platform/v1/approvals/${approval.id}/${decision}`, `/platform/v1/approvals/{id}/${decision}`, { token: m.staff.cm1.token, body: {} });
    assert.deepEqual([self.status, self.body.error.code], [409, "APPROVAL_SELF_REVIEW"], decision);
  }
  // 只读、运营能看到队列，但不能批准（403 channel.review）
  const queue = await checked("GET", `/platform/v1/approvals?resource_id=${channel.id}`, "/platform/v1/approvals", { token: m.staff.readonly.token });
  assert.deepEqual([queue.body.total, queue.body.items[0].can], [1, { approve: false, reject: false, withdraw: false }]);
  const denied = await checked("POST", `/platform/v1/approvals/${approval.id}/approve`, "/platform/v1/approvals/{id}/approve", { token: m.staff.operations.token, body: {} });
  assert.deepEqual([denied.status, denied.body.error.details.required], [403, "channel.review"]);
  // 别人不能撤回
  const notMine = await checked("POST", `/platform/v1/approvals/${approval.id}/withdraw`, "/platform/v1/approvals/{id}/withdraw", { token: m.staff.cm2.token, body: {} });
  assert.deepEqual([notMine.status, notMine.body.error.code], [409, "APPROVAL_NOT_REQUESTER"]);
  // 主数据运营看不到这一类：404
  assert.equal((await api.call("GET", `/platform/v1/approvals/${approval.id}`, { token: m.staff.masterData.token })).status, 403);
  // 另一位渠道经理批准：生效
  const cm2View = await checked("GET", `/platform/v1/approvals/${approval.id}`, "/platform/v1/approvals/{id}", { token: m.staff.cm2.token });
  assert.deepEqual(cm2View.body.approval.can, { approve: true, reject: true, withdraw: false });
  const approved = await checked("POST", `/platform/v1/approvals/${approval.id}/approve`, "/platform/v1/approvals/{id}/approve", { token: m.staff.cm2.token, body: { note: "同意" } });
  assert.deepEqual([approved.status, approved.body.approval.status, approved.body.approval.decided_by.email, approved.body.approval.decision_note], [200, "approved", "cm2@platform.test", "同意"]);
  const after = await checked("GET", `/platform/v1/channels/${channel.id}`, "/platform/v1/channels/{id}", { token: m.staff.readonly.token });
  assert.deepEqual(after.body.channel.pricing, { default_markup_bp: 1_200, markup_floor_bp: 1_100, band_bp: 200, min_margin: 0, sell_rounding: {} });
  // 已经有结论了：不能再批准、驳回、撤回
  for (const [decision, token] of [["approve", m.staff.cm2.token], ["reject", m.staff.cm2.token], ["withdraw", m.staff.cm1.token]] as const) {
    const again = await api.call("POST", `/platform/v1/approvals/${approval.id}/${decision}`, { token, body: {} });
    assert.deepEqual([again.status, again.body.error.code], [409, "APPROVAL_NOT_PENDING"]);
  }
  // 审计：发起（cm1）、批准（cm2）、渠道的定价被改（cm2，带复核编号和发起人）
  const audit = await api.db.owner.query(
    "select resource, action, actor_email, after->>'approval_id' as approval_id, after->>'requested_by' as requested_by from audit_logs where (resource = 'approval' and resource_id = $1) or (resource = 'channel' and resource_id = $2 and action = 'update') order by id",
    [approval.id, channel.id],
  );
  assert.deepEqual(audit.rows, [
    { resource: "approval", action: "request", actor_email: "cm1@platform.test", approval_id: null, requested_by: null },
    { resource: "channel", action: "update", actor_email: "cm2@platform.test", approval_id: approval.id, requested_by: "cm1@platform.test" },
    { resource: "approval", action: "approve", actor_email: "cm2@platform.test", approval_id: null, requested_by: null },
  ]);
  // 数据库约束：审核人不能是发起人（绕过接口也不行）
  await assert.rejects(api.db.owner.query("update approvals set decided_by = requested_by where id = $1", [approval.id]), { code: "23514" });
});

test("双人复核：驳回、撤回之后什么都不改；和现在一样的不发起；发起之后被别的复核改过的，批准时 409 APPROVAL_STALE（仍是待审核，可以驳回）", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "驳回渠道" });
  const same = await api.call("POST", `/platform/v1/channels/${channel.id}/pricing-changes`, { token: m.staff.cm1.token, body: {} });
  assert.deepEqual([same.status, same.body.error.details.issues[0].reason], [400, "UNCHANGED"]);
  const first = (await ok(api.call("POST", `/platform/v1/channels/${channel.id}/pricing-changes`, { token: m.staff.cm1.token, body: { default_markup_bp: 1_300 } }), 202)).approval;
  const second = (await ok(api.call("POST", `/platform/v1/channels/${channel.id}/pricing-changes`, { token: m.staff.cm1.token, body: { default_markup_bp: 1_400 } }), 202)).approval;
  const third = (await ok(api.call("POST", `/platform/v1/channels/${channel.id}/pricing-changes`, { token: m.staff.cm1.token, body: { default_markup_bp: 1_500 } }), 202)).approval;
  const rejected = await ok(api.call("POST", `/platform/v1/approvals/${first.id}/reject`, { token: m.staff.cm2.token, body: { note: "太高" } }));
  assert.equal(rejected.approval.status, "rejected");
  const withdrawn = await ok(api.call("POST", `/platform/v1/approvals/${second.id}/withdraw`, { token: m.staff.cm1.token, body: {} }));
  assert.deepEqual([withdrawn.approval.status, withdrawn.approval.decided_by], ["withdrawn", null]);
  assert.equal((await ok(api.call("GET", `/platform/v1/channels/${channel.id}`, { token: m.root }))).channel.pricing.default_markup_bp, 1_000);
  // 第四条批准之后，第三条就过时了
  const fourth = (await ok(api.call("POST", `/platform/v1/channels/${channel.id}/pricing-changes`, { token: m.staff.cm1.token, body: { default_markup_bp: 1_600 } }), 202)).approval;
  await ok(api.call("POST", `/platform/v1/approvals/${fourth.id}/approve`, { token: m.root, body: {} }));
  const stale = await checked("POST", `/platform/v1/approvals/${third.id}/approve`, "/platform/v1/approvals/{id}/approve", { token: m.staff.cm2.token, body: {} });
  assert.deepEqual([stale.status, stale.body.error.code], [409, "APPROVAL_STALE"]);
  assert.equal((await ok(api.call("GET", `/platform/v1/approvals/${third.id}`, { token: m.root }))).approval.status, "pending");
  assert.equal((await ok(api.call("GET", `/platform/v1/channels/${channel.id}`, { token: m.root }))).channel.pricing.default_markup_bp, 1_600);
  assert.equal((await ok(api.call("POST", `/platform/v1/approvals/${third.id}/reject`, { token: m.staff.cm2.token, body: {} }))).approval.status, "rejected");
  const history = await checked("GET", `/platform/v1/approvals?status=all&resource_id=${channel.id}`, "/platform/v1/approvals", { token: m.staff.readonly.token });
  // 同一时刻发起的几条按编号排，先后不固定：只比各有几条
  assert.deepEqual(history.body.items.map((item: any) => item.status).sort(), ["approved", "rejected", "rejected", "withdrawn"]);
});

test("加价规则：低于渠道下限的发起时就拦（BELOW_FLOOR）；维度组合不对、全渠道不带日期也拦；同一组维度不带日期的只能一条，带日期的不能重叠", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "规则校验", pricing: { markup_floor_bp: 1_100, default_markup_bp: 1_100 } });
  const below = await checked("POST", `/platform/v1/channels/${channel.id}/markup-rules`, "/platform/v1/channels/{id}/markup-rules", { token: m.staff.cm1.token, body: { tenant_id: m.a.tenantId, markup_bp: 1_050 } });
  assert.deepEqual([below.status, below.body.error.details.issues.map((i: any) => [i.reason, i.detail?.floor_bp])], [400, [["BELOW_FLOOR", 1_100]]]);
  const combo = await ruleRequest(api, m, channel.id, { tenant_id: m.a.tenantId, city_id: m.ids.tokyo, markup_bp: 1_200 });
  assert.deepEqual(combo.body.error.details.issues.map((i: any) => i.reason), ["UNSUPPORTED_COMBINATION"]);
  const undated = await ruleRequest(api, m, channel.id, { markup_bp: 1_200 });
  assert.deepEqual(undated.body.error.details.issues.map((i: any) => i.reason), ["DATES_REQUIRED"]);
  const unknown = await ruleRequest(api, m, channel.id, { tenant_id: "99999999-9999-4999-8999-999999999999", markup_bp: 1_200 });
  assert.deepEqual(unknown.body.error.details.issues.map((i: any) => i.reason), ["UNKNOWN_TENANT"]);
  await approvedBy(api, m, ruleRequest(api, m, channel.id, { tenant_id: m.a.tenantId, markup_bp: 1_500 }));
  await approvedBy(api, m, ruleRequest(api, m, channel.id, { tenant_id: m.a.tenantId, markup_bp: 1_200, valid_from: "2026-12-01", valid_to: "2026-12-07" }));
  const dup = await checked("POST", `/platform/v1/channels/${channel.id}/markup-rules`, "/platform/v1/channels/{id}/markup-rules", { token: m.staff.cm1.token, body: { tenant_id: m.a.tenantId, markup_bp: 1_300 } });
  assert.deepEqual([dup.status, dup.body.error.code], [409, "MARKUP_RULE_CONFLICT"]);
  const overlap = await ruleRequest(api, m, channel.id, { tenant_id: m.a.tenantId, markup_bp: 1_300, valid_from: "2026-12-07", valid_to: "2026-12-31" });
  assert.deepEqual([overlap.status, overlap.body.error.code], [409, "MARKUP_RULE_CONFLICT"]);
  await approvedBy(api, m, ruleRequest(api, m, channel.id, { tenant_id: m.a.tenantId, markup_bp: 1_300, valid_from: "2026-12-08", valid_to: null }));
  const rules = await checked("GET", `/platform/v1/channels/${channel.id}/markup-rules`, "/platform/v1/channels/{id}/markup-rules", { token: m.staff.readonly.token });
  assert.deepEqual(rules.body.items.map((r: any) => [r.level, r.tenant.name, r.markup_bp, r.valid_from, r.valid_to]), [[2, "甲车队", 1_500, null, null], [2, "甲车队", 1_200, "2026-12-01", "2026-12-07"], [2, "甲车队", 1_300, "2026-12-08", null]]);
});

test("加价规则：批准时按那一刻再校验——发起后下限被调高了，批准就被拦下（仍是待审核）；调高下限时还有低于新下限的规则，发起就被拦下", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "批准时再校验" });
  const pending = (await ok(ruleRequest(api, m, channel.id, { city_id: m.ids.tokyo, category: "airport_transfer", markup_bp: 1_150 }), 202)).approval;
  await approvedBy(api, m, api.call("POST", `/platform/v1/channels/${channel.id}/pricing-changes`, { token: m.staff.cm1.token, body: { markup_floor_bp: 1_200, default_markup_bp: 1_200 } }));
  const late = await checked("POST", `/platform/v1/approvals/${pending.id}/approve`, "/platform/v1/approvals/{id}/approve", { token: m.staff.cm2.token, body: {} });
  assert.deepEqual([late.status, late.body.error.details.issues.map((i: any) => i.reason)], [400, ["BELOW_FLOOR"]]);
  assert.equal((await ok(api.call("GET", `/platform/v1/approvals/${pending.id}`, { token: m.root }))).approval.status, "pending");
  assert.deepEqual((await ok(api.call("GET", `/platform/v1/channels/${channel.id}/markup-rules`, { token: m.root }))).items, []);
  // 有一条 12% 的规则时把下限调到 13%：发起就拦
  await approvedBy(api, m, ruleRequest(api, m, channel.id, { city_id: m.ids.tokyo, category: "airport_transfer", markup_bp: 1_200 }));
  const raise = await checked("POST", `/platform/v1/channels/${channel.id}/pricing-changes`, "/platform/v1/channels/{id}/pricing-changes", { token: m.staff.cm1.token, body: { markup_floor_bp: 1_300, default_markup_bp: 1_300 } });
  assert.deepEqual([raise.status, raise.body.error.code, raise.body.error.details.rule_ids.length], [409, "RULES_BELOW_FLOOR", 1]);
});

test("加价规则的修改、删除也走复核；版本号不对 409；删除后不再参与匹配，但库里留着（报价快照引用得到）", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "改删规则" });
  await approvedBy(api, m, ruleRequest(api, m, channel.id, { tenant_id: m.b.tenantId, markup_bp: 1_500 }));
  const [rule] = (await ok(api.call("GET", `/platform/v1/channels/${channel.id}/markup-rules`, { token: m.root }))).items;
  const url = `/platform/v1/channels/${channel.id}/markup-rules/${rule.id}`;
  const template = "/platform/v1/channels/{id}/markup-rules/{ruleId}";
  const wrongVersion = await checked("PUT", url, template, { token: m.staff.cm1.token, headers: { "if-match": '"9"' }, body: { tenant_id: m.b.tenantId, markup_bp: 1_400 } });
  assert.deepEqual([wrongVersion.status, wrongVersion.body.error.code], [409, "VERSION_CONFLICT"]);
  assert.equal((await api.call("PUT", url, { token: m.staff.cm1.token, body: { tenant_id: m.b.tenantId, markup_bp: 1_400 } })).status, 428);
  const update = await checked("PUT", url, template, { token: m.staff.cm1.token, headers: { "if-match": '"1"' }, body: { tenant_id: m.b.tenantId, markup_bp: 1_400 } });
  assert.equal(update.status, 202, update.text);
  assert.equal((await ok(api.call("GET", `/platform/v1/channels/${channel.id}/markup-rules`, { token: m.root }))).items[0].markup_bp, 1_500, "批准前不变");
  await ok(api.call("POST", `/platform/v1/approvals/${update.body.approval.id}/approve`, { token: m.staff.cm2.token, body: {} }));
  const updated = (await ok(api.call("GET", `/platform/v1/channels/${channel.id}/markup-rules`, { token: m.root }))).items[0];
  assert.deepEqual([updated.markup_bp, updated.version], [1_400, 2]);
  const removal = await checked("DELETE", url, template, { token: m.staff.cm1.token, headers: { "if-match": '"2"' } });
  assert.equal(removal.status, 202, removal.text);
  await ok(api.call("POST", `/platform/v1/approvals/${removal.body.approval.id}/approve`, { token: m.staff.cm2.token, body: {} }));
  assert.deepEqual((await ok(api.call("GET", `/platform/v1/channels/${channel.id}/markup-rules`, { token: m.root }))).items, []);
  assert.equal((await api.db.owner.query("select count(*)::int as n from markup_rules where id = $1 and deleted_at is not null", [rule.id])).rows[0].n, 1);
  const gone = await checked("PUT", url, template, { token: m.staff.cm1.token, headers: { "if-match": '"3"' }, body: { tenant_id: m.b.tenantId, markup_bp: 1_400 } });
  assert.equal(gone.status, 404);
});

test("五级匹配（平台试算选渠道）：渠道 × 租户 × 城市 × 品类 × 车型组 → 渠道 × 租户 → 渠道 × 城市 × 品类 × 车型组 → 渠道 × 城市 × 品类 → 渠道默认，命中第一条即停", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "五级匹配", pricing: { default_markup_bp: 1_050, markup_floor_bp: 1_000 } });
  const at = async (serviceTime = "2026-10-20T10:00"): Promise<any> => (await checked("POST", "/platform/v1/quotes/preview", "/platform/v1/quotes/preview", { token: m.staff.cm1.token, body: previewAsk({ channel_id: channel.id, service_time: serviceTime }) })).body;
  const levels = (body: any): [string, string, number, number | null][] =>
    [[m.ids.biz7, m.a.tenantId], [m.ids.eco4, m.a.tenantId], [m.ids.biz7, m.b.tenantId]].map(([vg, tenant]) => {
      const candidate = candidateOf(body, vg as string, tenant as string);
      return [vg === m.ids.biz7 ? "biz7" : "eco4", tenant === m.a.tenantId ? "甲" : "乙", candidate.markup_bp, candidate.markup_level];
    });
  // 只有渠道默认
  assert.deepEqual(levels(await at()), [["biz7", "甲", 1_050, 5], ["eco4", "甲", 1_050, 5], ["biz7", "乙", 1_050, 5]]);
  const rule = (body: Record<string, unknown>) => approvedBy(api, m, ruleRequest(api, m, channel.id, body));
  await rule({ city_id: m.ids.tokyo, category: "airport_transfer", markup_bp: 1_100 });
  assert.deepEqual(levels(await at()), [["biz7", "甲", 1_100, 4], ["eco4", "甲", 1_100, 4], ["biz7", "乙", 1_100, 4]]);
  await rule({ city_id: m.ids.tokyo, category: "airport_transfer", vehicle_group_id: m.ids.biz7, markup_bp: 1_250 });
  assert.deepEqual(levels(await at()), [["biz7", "甲", 1_250, 3], ["eco4", "甲", 1_100, 4], ["biz7", "乙", 1_250, 3]]);
  await rule({ tenant_id: m.b.tenantId, markup_bp: 1_500 });
  assert.deepEqual(levels(await at()), [["biz7", "甲", 1_250, 3], ["eco4", "甲", 1_100, 4], ["biz7", "乙", 1_500, 2]]);
  await rule({ tenant_id: m.a.tenantId, city_id: m.ids.tokyo, category: "airport_transfer", vehicle_group_id: m.ids.biz7, markup_bp: 1_200 });
  const full = await at();
  assert.deepEqual(levels(full), [["biz7", "甲", 1_200, 1], ["eco4", "甲", 1_100, 4], ["biz7", "乙", 1_500, 2]]);
  // 比的是各自的对外价：甲 20,000 × 1.12 = 22,400，乙 19,800 × 1.15 = 22,770 → 甲中标（都在 3% 价格带里，按排序价低者）
  const biz = full.groups.find((g: any) => g.vehicle_group_id === m.ids.biz7);
  assert.deepEqual([biz.winner.tenant_name, biz.winner.sell, full.channel.name, full.band_bp, full.markup_floor_bp], ["甲车队", 22_400, "五级匹配", 300, 1_000]);
  // 日期范围（促销期）：甲的第 2 级促销 10-20 当天 10.1%；经济 4 座当天命中第 2 级，10-21 回到第 4 级；商务 7 座始终是第 1 级
  await rule({ tenant_id: m.a.tenantId, markup_bp: 1_010, valid_from: "2026-10-20", valid_to: "2026-10-20" });
  assert.deepEqual(levels(await at("2026-10-20T23:59")), [["biz7", "甲", 1_200, 1], ["eco4", "甲", 1_010, 2], ["biz7", "乙", 1_500, 2]]);
  assert.deepEqual(levels(await at("2026-10-21T00:00")), [["biz7", "甲", 1_200, 1], ["eco4", "甲", 1_100, 4], ["biz7", "乙", 1_500, 2]]);
  assert.deepEqual(levels(await at("2026-10-19T23:59")), [["biz7", "甲", 1_200, 1], ["eco4", "甲", 1_100, 4], ["biz7", "乙", 1_500, 2]]);
  // 每个候选带命中的规则编号；用渠道默认的是 null
  const ruleIds = (await ok(api.call("GET", `/platform/v1/channels/${channel.id}/markup-rules`, { token: m.root }))).items.map((r: any) => r.id);
  assert.ok(ruleIds.includes(candidateOf(full, m.ids.biz7, m.a.tenantId).markup_rule_id));
});

test("平台试算选渠道：授权范围之外的租户不参加（列在 excluded）；城市、品类不在授权范围里 422；渠道不存在 400；不选渠道照旧用平台默认参数", async () => {
  const onlyA = await newChannel(api, m.staff.cm1.token, { name: "只卖甲", scope: { tenant_scope: "allow", tenant_ids: [m.a.tenantId] } });
  const body = (await checked("POST", "/platform/v1/quotes/preview", "/platform/v1/quotes/preview", { token: m.root, body: previewAsk({ channel_id: onlyA.id }) })).body;
  assert.deepEqual([body.candidate_count, body.excluded.map((e: any) => e.tenant_name), candidateOf(body, m.ids.biz7, m.b.tenantId)], [1, ["乙车队"], undefined]);
  const osakaOnly = await newChannel(api, m.staff.cm1.token, { name: "只卖大阪", scope: { city_ids: [m.ids.osaka] } });
  const city = await checked("POST", "/platform/v1/quotes/preview", "/platform/v1/quotes/preview", { token: m.root, body: previewAsk({ channel_id: osakaOnly.id }) });
  assert.deepEqual([city.status, city.body.error.code, city.body.error.details.reason], [422, "CHANNEL_SCOPE_DENIED", "CITY_NOT_AUTHORIZED"]);
  const charterOnly = await newChannel(api, m.staff.cm1.token, { name: "只卖包车", scope: { categories: ["charter"] } });
  const category = await checked("POST", "/platform/v1/quotes/preview", "/platform/v1/quotes/preview", { token: m.root, body: previewAsk({ channel_id: charterOnly.id }) });
  assert.deepEqual([category.status, category.body.error.details.reason], [422, "CATEGORY_NOT_AUTHORIZED"]);
  const missing = await checked("POST", "/platform/v1/quotes/preview", "/platform/v1/quotes/preview", { token: m.root, body: previewAsk({ channel_id: "99999999-9999-4999-8999-999999999999" }) });
  assert.deepEqual([missing.status, missing.body.error.details.issues[0].reason], [400, "UNKNOWN_CHANNEL"]);
  const plain = (await checked("POST", "/platform/v1/quotes/preview", "/platform/v1/quotes/preview", { token: m.root, body: previewAsk() })).body;
  assert.deepEqual([plain.channel, plain.excluded, candidateOf(plain, m.ids.biz7, m.a.tenantId).markup_level, candidateOf(plain, m.ids.biz7, m.a.tenantId).markup_bp], [null, [], null, 1_000]);
});

test("最低毛利和对外价取整（按渠道）：加价不足最低毛利时补到最低毛利，再向上取整到渠道的取整单位", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "取整渠道" });
  await approvedBy(api, m, api.call("POST", `/platform/v1/channels/${channel.id}/pricing-changes`, { token: m.staff.cm1.token, body: { min_margin: 2_100, sell_rounding: { JPY: 1_000 } } }));
  const body = await ok(api.call("POST", "/platform/v1/quotes/preview", { token: m.root, body: previewAsk({ channel_id: channel.id }) }));
  // 乙：19,800 × 10% = 1,980 < 2,100 → 21,900 → 22,000；甲：20,000 × 10% = 2,000 < 2,100 → 22,100 → 23,000
  const b = candidateOf(body, m.ids.biz7, m.b.tenantId);
  const a = candidateOf(body, m.ids.biz7, m.a.tenantId);
  assert.deepEqual([b.sell, b.sell_exact, b.min_margin_applied, a.sell, a.min_margin_applied], [22_000, "21900", true, 23_000, true]);
  assert.deepEqual([body.channel.min_margin, body.channel.rounding_unit], [2_100, 1_000]);
  // 经济 4 座：12,000 × 10% = 1,200 → 补到 2,100 → 14,100 → 15,000
  assert.equal(candidateOf(body, m.ids.eco4, m.a.tenantId).sell, 15_000);
});

test("改定价参数只给一项：没给的保持现在的值（合并），不会被重置成默认值；合并后不合规则的照样拦", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "合并定价参数", pricing: { markup_floor_bp: 1_200, default_markup_bp: 1_300, band_bp: 200, min_margin: 300, sell_rounding: { JPY: 100 } } });
  const requested = await checked("POST", `/platform/v1/channels/${channel.id}/pricing-changes`, "/platform/v1/channels/{id}/pricing-changes", { token: m.staff.cm1.token, body: { band_bp: 400 } });
  assert.equal(requested.status, 202, requested.text);
  assert.deepEqual(requested.body.approval.payload, { default_markup_bp: 1_300, markup_floor_bp: 1_200, band_bp: 400, min_margin_minor: 300, sell_rounding: { JPY: 100 } });
  assert.match(requested.body.approval.summary, /价格带 2% → 4%$/);
  await ok(api.call("POST", `/platform/v1/approvals/${requested.body.approval.id}/approve`, { token: m.staff.cm2.token, body: {} }));
  const after = await ok(api.call("GET", `/platform/v1/channels/${channel.id}`, { token: m.root }));
  assert.deepEqual(after.channel.pricing, { default_markup_bp: 1_300, markup_floor_bp: 1_200, band_bp: 400, min_margin: 300, sell_rounding: { JPY: 100 } });
  // 只调高下限、超过了现在的默认加价：合并后默认加价低于下限，拦下
  const tooHigh = await checked("POST", `/platform/v1/channels/${channel.id}/pricing-changes`, "/platform/v1/channels/{id}/pricing-changes", { token: m.staff.cm1.token, body: { markup_floor_bp: 1_400 } });
  assert.deepEqual([tooHigh.status, tooHigh.body.error.details.issues.map((i: any) => [i.path, i.reason])], [400, [["/default_markup_bp", "BELOW_FLOOR"]]]);
  // 给了 sell_rounding 就整体替换
  const rounding = await ok(api.call("POST", `/platform/v1/channels/${channel.id}/pricing-changes`, { token: m.staff.cm1.token, body: { sell_rounding: {} } }), 202);
  assert.deepEqual(rounding.approval.payload.sell_rounding, {});
  assert.equal(rounding.approval.payload.band_bp, 400);
});

test("基本信息和授权范围：直接改（If-Match）；名单里的租户、城市要存在；全部租户时不能带名单；启用直接生效，暂停要复核", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "改基本信息" });
  const url = `/platform/v1/channels/${channel.id}`;
  const patched = await checked("PATCH", url, "/platform/v1/channels/{id}", { token: m.staff.cm1.token, headers: { "if-match": '"1"' }, body: { contact_name: "张三", scope: { tenant_scope: "deny", tenant_ids: [m.b.tenantId], city_ids: [m.ids.tokyo], categories: ["airport_transfer"] } } });
  assert.equal(patched.status, 200, patched.text);
  assert.deepEqual([patched.body.channel.contact_name, patched.body.channel.scope], ["张三", { tenant_scope: "deny", tenants: [{ id: m.b.tenantId, name: "乙车队" }], cities: [{ id: m.ids.tokyo, name: "东京" }], categories: ["airport_transfer"] }]);
  const stale = await checked("PATCH", url, "/platform/v1/channels/{id}", { token: m.staff.cm1.token, headers: { "if-match": '"1"' }, body: { notes: "x" } });
  assert.deepEqual([stale.status, stale.body.error.code], [409, "VERSION_CONFLICT"]);
  const bad = await checked("PATCH", url, "/platform/v1/channels/{id}", { token: m.staff.cm1.token, headers: { "if-match": '"2"' }, body: { scope: { tenant_scope: "all", tenant_ids: [m.a.tenantId] } } });
  assert.deepEqual(bad.body.error.details.issues.map((i: any) => i.reason), ["NOT_APPLICABLE"]);
  const unknown = await checked("PATCH", url, "/platform/v1/channels/{id}", { token: m.staff.cm1.token, headers: { "if-match": '"2"' }, body: { scope: { city_ids: ["99999999-9999-4999-8999-999999999999"] } } });
  assert.deepEqual(unknown.body.error.details.issues.map((i: any) => i.reason), ["UNKNOWN_CITY"]);
  assert.equal((await api.call("PATCH", url, { token: m.staff.readonly.token, headers: { "if-match": '"2"' }, body: { notes: "x" } })).status, 403);
  const activated = await checked("POST", `${url}/activate`, "/platform/v1/channels/{id}/activate", { token: m.staff.cm1.token });
  assert.equal(activated.body.channel.status, "active");
  const again = await checked("POST", `${url}/activate`, "/platform/v1/channels/{id}/activate", { token: m.staff.cm1.token });
  assert.deepEqual([again.status, again.body.error.code], [409, "CHANNEL_STATUS_UNCHANGED"]);
  const pause = await checked("POST", `${url}/pause`, "/platform/v1/channels/{id}/pause", { token: m.staff.cm1.token, body: { request_note: "合同到期" } });
  assert.equal(pause.status, 202);
  assert.equal((await ok(api.call("GET", url, { token: m.root }))).channel.status, "active", "批准前还是启用");
  await ok(api.call("POST", `/platform/v1/approvals/${pause.body.approval.id}/approve`, { token: m.staff.cm2.token, body: {} }));
  assert.equal((await ok(api.call("GET", url, { token: m.root }))).channel.status, "paused");
  const already = await checked("POST", `${url}/pause`, "/platform/v1/channels/{id}/pause", { token: m.staff.cm1.token, body: {} });
  assert.deepEqual([already.status, already.body.error.code], [409, "CHANNEL_STATUS_UNCHANGED"]);
  const list = await checked("GET", "/platform/v1/channels?status=paused&q=基本", "/platform/v1/channels", { token: m.staff.readonly.token });
  assert.deepEqual([list.body.total, list.body.items[0].id], [1, channel.id]);
});

test("API 客户端：密钥只在新建时显示一次，库里只有 SHA-256，列表、审计日志、服务日志里都没有原文；只读能看列表不能发", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "密钥渠道" });
  const url = `/platform/v1/channels/${channel.id}/api-clients`;
  const created = await checked("POST", url, "/platform/v1/channels/{id}/api-clients", { token: m.staff.cm1.token, body: { name: "官网正式" } });
  assert.equal(created.status, 201, created.text);
  const secret = created.body.client_secret as string;
  assert.match(secret, /^nzs_[A-Za-z0-9_-]{43}$/);
  assert.equal(created.body.api_client.secret_last4, secret.slice(-4));
  const listed = await checked("GET", url, "/platform/v1/channels/{id}/api-clients", { token: m.staff.readonly.token });
  assert.equal(listed.body.items.length, 1);
  assert.ok(!listed.text.includes(secret));
  const stored = (await api.db.owner.query("select secret_hash from channel_api_clients where id = $1", [created.body.api_client.id])).rows[0];
  assert.equal(stored.secret_hash, createHash("sha256").update(secret).digest("hex"));
  const everything = JSON.stringify((await api.db.owner.query("select * from audit_logs")).rows) + JSON.stringify((await api.db.owner.query("select * from channel_api_clients")).rows);
  assert.ok(!everything.includes(secret), "库里不能有密钥原文");
  await salesCredentialsFrom(created.body.api_client.client_id, secret);
  assert.ok(!api.logs().includes(secret), "日志里不能有密钥原文");
  assert.equal((await api.call("POST", url, { token: m.staff.readonly.token, body: { name: "x" } })).status, 403);
  assert.equal((await api.call("GET", `/platform/v1/channels/99999999-9999-4999-8999-999999999999/api-clients`, { token: m.root })).status, 404);
});

async function salesCredentialsFrom(clientId: string, secret: string, ip = "198.51.100.20"): Promise<ApiResponse> {
  api.clock.advance(1_000);
  return api.call("POST", "/sales/v1/oauth/token", { ip, body: { grant_type: "client_credentials", client_id: clientId, client_secret: secret } });
}

test("轮换：旧密钥默认还能用 24 小时，宽限期里用旧密钥换的令牌在宽限期过后也失效；立即作废时旧令牌马上失效；吊销后一律 401", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "轮换渠道" });
  const creds = await salesCredentials(api, m, channel.id, "198.51.100.30");
  const ask = (token: string) => {
    api.clock.advance(1_000);
    return api.call("GET", "/sales/v1/quotes/QT20261007AAAAAAAAAA", { token });
  };
  assert.equal((await ask(creds.token)).status, 404, "令牌有效（报价不存在是 404）");
  const rotateUrl = `/platform/v1/channels/${channel.id}/api-clients/${creds.id}/rotate`;
  const rotated = await checked("POST", rotateUrl, "/platform/v1/channels/{id}/api-clients/{clientId}/rotate", { token: m.staff.cm1.token, body: {} });
  assert.deepEqual([rotated.status, rotated.body.api_client.secret_generation], [200, 2]);
  assert.notEqual(rotated.body.client_secret, creds.secret);
  assert.equal((await ask(creds.token)).status, 404, "宽限期里旧令牌照样能用");
  assert.equal((await salesCredentialsFrom(creds.clientId, rotated.body.client_secret)).status, 200, "新密钥能用");
  api.clock.advance(23 * 3_600_000);
  const oldSecretToken = await salesCredentialsFrom(creds.clientId, creds.secret);
  assert.equal(oldSecretToken.status, 200, "宽限期里旧密钥还能换令牌");
  api.clock.advance(3_600_000);
  assert.equal((await ask(oldSecretToken.body.access_token)).status, 401, "宽限期过了，用旧密钥换的令牌失效");
  const expired = await salesCredentialsFrom(creds.clientId, creds.secret);
  assert.deepEqual([expired.status, expired.body.error.code], [401, "INVALID_CLIENT"]);
  // 时钟走过了 24 小时，平台会话（8 小时）早过期了：重新登录
  const manager = (await ok(api.call("POST", "/platform/v1/auth/login", { body: { email: m.staff.cm1.email, password: TEST_PASSWORD } }))).access_token as string;
  // 立即作废
  const fresh = await salesCredentialsFrom(creds.clientId, rotated.body.client_secret);
  const immediate = await ok(api.call("POST", rotateUrl, { token: manager, body: { immediate: true } }));
  assert.equal((await ask(fresh.body.access_token)).status, 401);
  assert.equal((await salesCredentialsFrom(creds.clientId, rotated.body.client_secret)).status, 401);
  const newest = await salesCredentialsFrom(creds.clientId, immediate.client_secret);
  assert.equal((await ask(newest.body.access_token)).status, 404);
  // 吊销
  const revoked = await checked("POST", `/platform/v1/channels/${channel.id}/api-clients/${creds.id}/revoke`, "/platform/v1/channels/{id}/api-clients/{clientId}/revoke", { token: manager });
  assert.equal(revoked.body.api_client.status, "revoked");
  assert.equal((await ask(newest.body.access_token)).status, 401);
  assert.equal((await salesCredentialsFrom(creds.clientId, immediate.client_secret)).status, 401);
  const twice = await checked("POST", `/platform/v1/channels/${channel.id}/api-clients/${creds.id}/revoke`, "/platform/v1/channels/{id}/api-clients/{clientId}/revoke", { token: manager });
  assert.deepEqual([twice.status, twice.body.error.code], [409, "API_CLIENT_REVOKED"]);
  const audit = await api.db.owner.query("select action from audit_logs where resource = 'api_client' and resource_id = $1 order by id", [creds.id]);
  assert.deepEqual(audit.rows.map((row) => row.action), ["create", "rotate", "rotate", "revoke"]);
  // 别的渠道的路径下找不到这个客户端
  const other = await newChannel(api, manager, { name: "别的渠道" });
  assert.equal((await api.call("POST", `/platform/v1/channels/${other.id}/api-clients/${creds.id}/rotate`, { token: manager, body: {} })).status, 404);
});

