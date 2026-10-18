/**
 * M2-04 测试角色补充：双人复核和加价规则的边界（ADR 0023），经真实接口、真实 PostgreSQL。
 * - 并发：两个人同时批准、一个批准一个驳回同一条，只成功一个；两条同维度的新增规则并发批准，只生效一条；
 * - 撤回之后不能批准、驳回；驳回、撤回各留一条审计；
 * - 发起后对象被改过：同一条规则的两条修改、规则已被删除、渠道被暂停 / 启用之后的定价复核，批准都是 409 APPROVAL_STALE；
 * - 每个平台角色：除渠道经理和超级管理员外都不能批准；只读、运营不能发起；超级管理员也不能审自己发起的；
 * - 数据库兜底：审核人不能是发起人（插入时也不行）、下限 / 默认加价 / 价格带 / 规则比例 / 第 5 级必须带日期；复核记录、报价、询价日志平台角色删不掉；
 * - 下限、价格带、规则比例、日期的精确边界；调高下限时只看还没结束的规则（按城市当地日期）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { PLATFORM_ROLES, type PlatformRole } from "@nozomi/domain";
import { withPlatformTx, withTenantTx } from "./db/context.ts";
import { type ApiResponse, TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";
import { deniedByDatabase } from "./testing/db.ts";
import { type Market, approvedBy, buildMarket, newChannel, ok, ruleRequest } from "./testing/market.ts";

let api: TestApi;
let m: Market;

before(async () => {
  api = await createTestApi();
  m = await buildMarket(api);
});
after(() => api.close());

const decide = (id: string, decision: "approve" | "reject" | "withdraw", token: string): Promise<ApiResponse> => api.call("POST", `/platform/v1/approvals/${id}/${decision}`, { token, body: {} });
const approvalOf = async (id: string): Promise<any> => (await ok(api.call("GET", `/platform/v1/approvals/${id}`, { token: m.root }))).approval;
const rulesOf = async (channelId: string): Promise<any[]> => (await ok(api.call("GET", `/platform/v1/channels/${channelId}/markup-rules`, { token: m.root }))).items;
const pricing = (channelId: string, body: Record<string, unknown>, token = m.staff.cm1.token): Promise<ApiResponse> => api.call("POST", `/platform/v1/channels/${channelId}/pricing-changes`, { token, body });

test("并发：两位审核人同时批准同一条，只有一个成功（另一个 409 APPROVAL_NOT_PENDING），规则只生效一次、批准的审计只有一条", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "QA 并发批准" });
  const dims = [{ tenant_id: m.a.tenantId }, { tenant_id: m.b.tenantId }, { city_id: m.ids.tokyo, category: "airport_transfer" }, { city_id: m.ids.osaka, category: "airport_transfer" }];
  for (const [round, dim] of dims.entries()) {
    const pending = (await ok(ruleRequest(api, m, channel.id, { ...dim, markup_bp: 1_300 }), 202)).approval;
    const results = await Promise.all([decide(pending.id, "approve", m.staff.cm2.token), decide(pending.id, "approve", m.root)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409], results.map((r) => r.text).join(" | "));
    assert.equal(results.find((r) => r.status === 409)?.body.error.code, "APPROVAL_NOT_PENDING", `第 ${round + 1} 轮`);
    assert.equal((await rulesOf(channel.id)).length, round + 1);
    const audits = await api.db.owner.query("select action from audit_logs where resource = 'approval' and resource_id = $1 order by id", [pending.id]);
    assert.deepEqual(audits.rows.map((row) => row.action), ["request", "approve"]);
    const created = await api.db.owner.query("select count(*)::int as n from audit_logs where resource = 'markup_rule' and action = 'create' and after->>'approval_id' = $1", [pending.id]);
    assert.equal(created.rows[0].n, 1);
  }
});

test("并发：一个批准、一个驳回同一条，只有一个成功；结论和数据一致", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "QA 并发批驳" });
  const pending = (await ok(pricing(channel.id, { default_markup_bp: 1_250 }), 202)).approval;
  const [approve, reject] = await Promise.all([decide(pending.id, "approve", m.staff.cm2.token), decide(pending.id, "reject", m.root)]);
  assert.deepEqual([approve.status, reject.status].sort(), [200, 409]);
  const final = await approvalOf(pending.id);
  const markup = (await ok(api.call("GET", `/platform/v1/channels/${channel.id}`, { token: m.root }))).channel.pricing.default_markup_bp;
  if (final.status === "approved") assert.equal(markup, 1_250);
  else assert.deepEqual([final.status, markup], ["rejected", 1_000]);
});

test("并发：同一组维度的两条新增规则（发起时都还不冲突）同时被批准，只生效一条，另一条 409 MARKUP_RULE_CONFLICT 仍是待审核", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "QA 并发冲突" });
  const one = (await ok(ruleRequest(api, m, channel.id, { city_id: m.ids.tokyo, category: "airport_transfer", markup_bp: 1_200 }), 202)).approval;
  const two = (await ok(ruleRequest(api, m, channel.id, { city_id: m.ids.tokyo, category: "airport_transfer", markup_bp: 1_400 }), 202)).approval;
  const results = await Promise.all([decide(one.id, "approve", m.staff.cm2.token), decide(two.id, "approve", m.root)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409], results.map((r) => r.text).join(" | "));
  assert.equal(results.find((r) => r.status === 409)?.body.error.code, "MARKUP_RULE_CONFLICT");
  assert.equal((await rulesOf(channel.id)).length, 1);
  const statuses = [(await approvalOf(one.id)).status, (await approvalOf(two.id)).status].sort();
  assert.deepEqual(statuses, ["approved", "pending"]);
});

test("撤回之后不能批准、驳回、再撤回；驳回、撤回各留一条审计（操作者、前后状态）", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "QA 撤回" });
  const withdrawn = (await ok(pricing(channel.id, { default_markup_bp: 1_300 }), 202)).approval;
  assert.equal((await decide(withdrawn.id, "withdraw", m.staff.cm1.token)).status, 200);
  for (const [decision, token] of [["approve", m.staff.cm2.token], ["reject", m.staff.cm2.token], ["withdraw", m.staff.cm1.token]] as const) {
    const res = await decide(withdrawn.id, decision, token);
    assert.deepEqual([res.status, res.body.error.code], [409, "APPROVAL_NOT_PENDING"], decision);
  }
  const rejected = (await ok(pricing(channel.id, { default_markup_bp: 1_400 }), 202)).approval;
  await ok(api.call("POST", `/platform/v1/approvals/${rejected.id}/reject`, { token: m.staff.cm2.token, body: { note: "不同意" } }));
  const audit = await api.db.owner.query(
    "select resource_id, action, actor_email, before->>'status' as before, after->>'status' as after, after->>'note' as note from audit_logs where resource = 'approval' and resource_id = any($1::text[]) and action <> 'request' order by id",
    [[withdrawn.id, rejected.id]],
  );
  assert.deepEqual(audit.rows, [
    { resource_id: withdrawn.id, action: "withdraw", actor_email: "cm1@platform.test", before: "pending", after: "withdrawn", note: null },
    { resource_id: rejected.id, action: "reject", actor_email: "cm2@platform.test", before: "pending", after: "rejected", note: "不同意" },
  ]);
  assert.equal((await ok(api.call("GET", `/platform/v1/channels/${channel.id}`, { token: m.root }))).channel.pricing.default_markup_bp, 1_000, "驳回、撤回都不改");
});

test("发起后对象被改过：同一条规则的两条修改批了一条，另一条 APPROVAL_STALE；规则已被删除，修改的复核 APPROVAL_STALE；都仍是待审核", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "QA 规则过时" });
  await approvedBy(api, m, ruleRequest(api, m, channel.id, { tenant_id: m.b.tenantId, markup_bp: 1_500 }));
  const [rule] = await rulesOf(channel.id);
  const url = `/platform/v1/channels/${channel.id}/markup-rules/${rule.id}`;
  const update = (bp: number) => ok(api.call("PUT", url, { token: m.staff.cm1.token, headers: { "if-match": `"${rule.version}"` }, body: { tenant_id: m.b.tenantId, markup_bp: bp } }), 202);
  const first = (await update(1_600)).approval;
  const second = (await update(1_700)).approval;
  const removal = (await ok(api.call("DELETE", url, { token: m.staff.cm1.token, headers: { "if-match": `"${rule.version}"` } }), 202)).approval;
  await ok(decide(first.id, "approve", m.staff.cm2.token));
  const stale = await decide(second.id, "approve", m.staff.cm2.token);
  assert.deepEqual([stale.status, stale.body.error.code], [409, "APPROVAL_STALE"]);
  const staleRemoval = await decide(removal.id, "approve", m.staff.cm2.token);
  assert.deepEqual([staleRemoval.status, staleRemoval.body.error.code], [409, "APPROVAL_STALE"], "删除也核对规则的版本");
  // 按新版本删除、批准；之前那条修改的复核再批准：规则已经不在了
  const third = (await ok(api.call("PUT", url, { token: m.staff.cm1.token, headers: { "if-match": '"2"' }, body: { tenant_id: m.b.tenantId, markup_bp: 1_800 } }), 202)).approval;
  await approvedBy(api, m, api.call("DELETE", url, { token: m.staff.cm1.token, headers: { "if-match": '"2"' } }));
  const gone = await decide(third.id, "approve", m.staff.cm2.token);
  assert.deepEqual([gone.status, gone.body.error.code], [409, "APPROVAL_STALE"]);
  assert.deepEqual([(await approvalOf(second.id)).status, (await approvalOf(removal.id)).status, (await approvalOf(third.id)).status], ["pending", "pending", "pending"]);
  assert.deepEqual(await rulesOf(channel.id), []);
});

test("渠道状态变了（暂停批准、直接启用）也让之前发起的定价复核过时（pricing_version）", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "QA 状态过时" });
  const beforePause = (await ok(pricing(channel.id, { default_markup_bp: 1_300 }), 202)).approval;
  await approvedBy(api, m, api.call("POST", `/platform/v1/channels/${channel.id}/pause`, { token: m.staff.cm1.token, body: {} }));
  const stale = await decide(beforePause.id, "approve", m.staff.cm2.token);
  assert.deepEqual([stale.status, stale.body.error.code], [409, "APPROVAL_STALE"]);
  const beforeActivate = (await ok(pricing(channel.id, { default_markup_bp: 1_400 }), 202)).approval;
  await ok(api.call("POST", `/platform/v1/channels/${channel.id}/activate`, { token: m.staff.cm1.token }));
  const stale2 = await decide(beforeActivate.id, "approve", m.staff.cm2.token);
  assert.deepEqual([stale2.status, stale2.body.error.code], [409, "APPROVAL_STALE"]);
  // 暂停的复核：已经是暂停时再批第二条暂停 409，不会重复写
  const pauseA = (await ok(api.call("POST", `/platform/v1/channels/${channel.id}/pause`, { token: m.staff.cm1.token, body: {} }), 202)).approval;
  const pauseB = (await ok(api.call("POST", `/platform/v1/channels/${channel.id}/pause`, { token: m.staff.cm1.token, body: {} }), 202)).approval;
  await ok(decide(pauseA.id, "approve", m.staff.cm2.token));
  const again = await decide(pauseB.id, "approve", m.staff.cm2.token);
  assert.deepEqual([again.status, again.body.error.code], [409, "CHANNEL_STATUS_UNCHANGED"]);
});

test("每个平台角色：只有渠道经理、超级管理员能批准；其余角色 403 / 404 且记录仍是待审核；只读、运营不能发起；超级管理员也不能审自己发起的", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "QA 角色矩阵" });
  const pending = (await ok(pricing(channel.id, { default_markup_bp: 1_200 }), 202)).approval;
  const others = PLATFORM_ROLES.map((role) => role.key).filter((role): role is PlatformRole => role !== "super_admin" && role !== "channel_manager");
  for (const role of others) {
    const email = `qa-${role.replaceAll("_", "-")}@platform.test`;
    const invited = await ok(api.call("POST", "/platform/v1/staff", { token: m.root, body: { email, name: role, role } }), 201);
    await ok(api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.invite.token, password: TEST_PASSWORD } }));
    const token = (await ok(api.call("POST", "/platform/v1/auth/login", { body: { email, password: TEST_PASSWORD } }))).access_token as string;
    for (const decision of ["approve", "reject"] as const) {
      const res = await decide(pending.id, decision, token);
      assert.ok(res.status === 403 || res.status === 404, `${role} ${decision}: ${res.status} ${res.text}`);
    }
    for (const [path, body] of [["pricing-changes", { default_markup_bp: 1_300 }], ["markup-rules", { tenant_id: m.a.tenantId, markup_bp: 1_300 }], ["pause", {}]] as const) {
      const res = await api.call("POST", `/platform/v1/channels/${channel.id}/${path}`, { token, body });
      assert.ok(res.status === 403 || res.status === 404, `${role} 发起 ${path}: ${res.status}`);
    }
  }
  assert.equal((await approvalOf(pending.id)).status, "pending");
  const mine = (await ok(pricing(channel.id, { default_markup_bp: 1_350 }, m.root), 202)).approval;
  const self = await decide(mine.id, "approve", m.root);
  assert.deepEqual([self.status, self.body.error.code], [409, "APPROVAL_SELF_REVIEW"]);
  assert.equal((await decide(mine.id, "approve", m.staff.cm1.token)).status, 200, "渠道经理可以审超级管理员发起的");
});

test("数据库兜底：插入时审核人就是发起人也被拒；下限 < 10%、默认加价 < 下限、价格带 > 5%、规则比例 < 10%、第 5 级不带日期都被约束拒绝", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "QA 约束" });
  const owner = api.db.owner;
  await assert.rejects(
    owner.query("insert into approvals (kind, resource, resource_id, summary, payload, status, requested_by, requested_at, decided_by, decided_at) values ('channel.pricing', 'channel', $1, 'x', '{}'::jsonb, 'approved', $2, now(), $2, now())", [channel.id, m.staff.cm1.id]),
    { code: "23514" },
  );
  await assert.rejects(owner.query("insert into approvals (kind, resource, resource_id, summary, payload, status, requested_by, requested_at, decided_at) values ('channel.pricing', 'channel', $1, 'x', '{}'::jsonb, 'approved', $2, now(), now())", [channel.id, m.staff.cm1.id]), { code: "23514" }, "批准了却没有审核人");
  for (const [sql, label] of [
    ["update channels set markup_floor_bp = 999, default_markup_bp = 1000 where id = $1", "下限 9.99%"],
    ["update channels set default_markup_bp = 1099, markup_floor_bp = 1100 where id = $1", "默认加价低于下限"],
    ["update channels set band_bp = 501 where id = $1", "价格带 5.01%"],
    ["update channels set band_bp = -1 where id = $1", "价格带负数"],
    ["insert into markup_rules (channel_id, level, city_id, category, markup_bp, created_at, updated_at) values ($1, 4, (select id from cities limit 1), 'airport_transfer', 999, now(), now())", "规则 9.99%"],
    ["insert into markup_rules (channel_id, level, markup_bp, created_at, updated_at) values ($1, 5, 1200, now(), now())", "第 5 级不带日期"],
    ["insert into markup_rules (channel_id, level, markup_bp, valid_from, valid_to, created_at, updated_at) values ($1, 5, 1200, '2026-12-02', '2026-12-01', now(), now())", "开始晚于结束"],
  ] as const) {
    await assert.rejects(owner.query(sql, [channel.id]), { code: "23514" }, label);
  }
  // 边界上的值可以
  await owner.query("update channels set markup_floor_bp = 1000, default_markup_bp = 1000, band_bp = 500 where id = $1", [channel.id]);
  await owner.query("update channels set band_bp = 0 where id = $1", [channel.id]);
});

test("平台角色删不掉复核记录、报价、询价日志（只增改结论 / 只追加）", async () => {
  for (const table of ["approvals", "quotes", "quote_logs", "channels", "markup_rules", "channel_api_clients"]) {
    await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query(`delete from ${table}`)), deniedByDatabase, table);
  }
  for (const table of ["quotes", "quote_logs"]) {
    await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query(`update ${table} set created_at = created_at`)), deniedByDatabase, `${table} 不能改`);
  }
});

test("租户数据库角色对九张新表连写也不行（插入、改、删全部被数据库拒绝）", async () => {
  const tables = ["channels", "channel_tenants", "channel_cities", "markup_rules", "approvals", "channel_api_clients", "quote_logs", "quotes", "sales_rate_limits"];
  for (const table of tables) {
    await assert.rejects(withTenantTx(api.db.pool, m.a.tenantId, (db) => db.query(`delete from ${table}`)), deniedByDatabase, `${table} 删`);
    await assert.rejects(withTenantTx(api.db.pool, m.a.tenantId, (db) => db.query(`update ${table} set ${table === "sales_rate_limits" ? "attempt_count = 0" : table === "channel_tenants" || table === "channel_cities" ? "channel_id = channel_id" : "id = id"}`)), deniedByDatabase, `${table} 改`);
  }
  await assert.rejects(withTenantTx(api.db.pool, m.a.tenantId, (db) => db.query("insert into sales_rate_limits (bucket, window_started_at, attempt_count) values ('x', now(), 0)")), deniedByDatabase, "插入");
});

test("接口的精确边界：下限 9.99% 拦、10% 可以；默认加价 = 下限可以、少 1 个基点拦；价格带 5% 可以、5.01% 拦；规则 = 下限可以、少 1 个基点拦", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "QA 精确边界", pricing: { markup_floor_bp: 1_200, default_markup_bp: 1_200 } });
  const reasons = (res: ApiResponse): string[] => res.body.error.details.issues.map((i: any) => i.reason);
  const floor = await pricing(channel.id, { markup_floor_bp: 999, default_markup_bp: 1_200 });
  assert.deepEqual([floor.status, reasons(floor)], [400, ["BELOW_PLATFORM_FLOOR"]]);
  const defaultBelow = await pricing(channel.id, { markup_floor_bp: 1_200, default_markup_bp: 1_199 });
  assert.deepEqual([defaultBelow.status, reasons(defaultBelow)], [400, ["BELOW_FLOOR"]]);
  const band = await pricing(channel.id, { markup_floor_bp: 1_200, default_markup_bp: 1_200, band_bp: 501 });
  assert.equal(band.status, 400);
  assert.equal((await pricing(channel.id, { markup_floor_bp: 1_200, default_markup_bp: 1_200, band_bp: 500 })).status, 202);
  assert.equal((await pricing(channel.id, { markup_floor_bp: 1_000, default_markup_bp: 1_000, band_bp: 0 })).status, 202, "降回平台下限、价格带 0 也可以发起");
  const ruleBelow = await ruleRequest(api, m, channel.id, { tenant_id: m.a.tenantId, markup_bp: 1_199 });
  assert.deepEqual([ruleBelow.status, reasons(ruleBelow), ruleBelow.body.error.details.issues[0].detail.floor_bp], [400, ["BELOW_FLOOR"], 1_200]);
  assert.equal((await ruleRequest(api, m, channel.id, { tenant_id: m.a.tenantId, markup_bp: 1_200 })).status, 202);
  const fraction = await ruleRequest(api, m, channel.id, { tenant_id: m.b.tenantId, markup_bp: 1_250.5 });
  assert.equal(fraction.status, 400, "基点必须是整数");
});

test("规则日期：相邻的日期范围可以并存，重叠一天就冲突；不存在的日期、开始晚于结束拦下", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "QA 日期" });
  const dims = { city_id: m.ids.tokyo, category: "airport_transfer" };
  await approvedBy(api, m, ruleRequest(api, m, channel.id, { ...dims, markup_bp: 1_200, valid_from: "2026-12-01", valid_to: "2026-12-07" }));
  assert.equal((await ruleRequest(api, m, channel.id, { ...dims, markup_bp: 1_300, valid_from: "2026-12-08", valid_to: "2026-12-10" })).status, 202, "相邻");
  assert.equal((await ruleRequest(api, m, channel.id, { ...dims, markup_bp: 1_300, valid_from: null, valid_to: "2026-11-30" })).status, 202, "开始不限、结束在前一天");
  const overlap = await ruleRequest(api, m, channel.id, { ...dims, markup_bp: 1_300, valid_from: "2026-11-20", valid_to: "2026-12-01" });
  assert.deepEqual([overlap.status, overlap.body.error.code], [409, "MARKUP_RULE_CONFLICT"]);
  const fake = await ruleRequest(api, m, channel.id, { ...dims, markup_bp: 1_300, valid_from: "2026-02-29", valid_to: "2026-03-01" });
  assert.deepEqual([fake.status, fake.body.error.details.issues.map((i: any) => i.reason)], [400, ["INVALID_DATE"]]);
  const order = await ruleRequest(api, m, channel.id, { ...dims, markup_bp: 1_300, valid_from: "2027-01-02", valid_to: "2027-01-01" });
  assert.deepEqual(order.body.error.details.issues.map((i: any) => i.reason), ["DATE_ORDER"]);
});

test("调高下限：已经结束的规则不挡、今天结束的还挡（按测试时钟 2026-10-07 东京上午）", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "QA 下限与结束的规则" });
  await approvedBy(api, m, ruleRequest(api, m, channel.id, { city_id: m.ids.tokyo, category: "airport_transfer", markup_bp: 1_100, valid_from: "2026-10-01", valid_to: "2026-10-06" }));
  assert.equal((await pricing(channel.id, { markup_floor_bp: 1_200, default_markup_bp: 1_200 })).status, 202, "昨天就结束的规则不挡");
  await approvedBy(api, m, ruleRequest(api, m, channel.id, { city_id: m.ids.tokyo, category: "airport_transfer", markup_bp: 1_100, valid_from: "2026-10-07", valid_to: "2026-10-07" }));
  const blocked = await pricing(channel.id, { markup_floor_bp: 1_200, default_markup_bp: 1_200 });
  assert.deepEqual([blocked.status, blocked.body.error.code], [409, "RULES_BELOW_FLOOR"]);
});

test("调高下限时「规则结束了没有」按规则所在城市的当地日期判断：东京已经是 10-08 凌晨，10-07 结束的东京规则不再挡住调高下限", async () => {
  const channel = await newChannel(api, m.staff.cm1.token, { name: "QA 下限与当地日期" });
  await approvedBy(api, m, ruleRequest(api, m, channel.id, { city_id: m.ids.tokyo, category: "airport_transfer", markup_bp: 1_100, valid_from: "2026-10-01", valid_to: "2026-10-07" }));
  // 测试时钟 2026-10-07T01:00Z；拨到 2026-10-07T16:00Z = 东京 10-08 01:00：这条规则在东京已经结束
  api.clock.advance(15 * 3_600_000);
  const manager = (await ok(api.call("POST", "/platform/v1/auth/login", { body: { email: m.staff.cm1.email, password: TEST_PASSWORD } }))).access_token as string;
  const raise = await pricing(channel.id, { markup_floor_bp: 1_200, default_markup_bp: 1_200 }, manager);
  assert.equal(raise.status, 202, `东京已经过了规则的结束日期，不该挡：${raise.text}`);
});

test("调高下限时没有城市的规则（按供应商、全渠道）要在最晚的时区（UTC−12）也过了结束日期才算结束", async () => {
  // 前面的用例拨过时钟：先把时钟拨到 2026-10-08T00:00Z，重新登录两位渠道经理
  api.clock.advance(new Date("2026-10-08T00:00:00Z").getTime() - api.clock.now().getTime());
  const login = async (email: string): Promise<string> => (await ok(api.call("POST", "/platform/v1/auth/login", { body: { email, password: TEST_PASSWORD } }))).access_token as string;
  const requester = await login(m.staff.cm1.email);
  const reviewer = await login(m.staff.cm2.email);
  const channel = await newChannel(api, requester, { name: "QA 下限与无城市规则" });
  const requested = await ok(api.call("POST", `/platform/v1/channels/${channel.id}/markup-rules`, { token: requester, body: { tenant_id: m.a.tenantId, markup_bp: 1_100, valid_from: "2026-10-01", valid_to: "2026-10-07" } }), 202);
  await ok(api.call("POST", `/platform/v1/approvals/${requested.approval.id}/approve`, { token: reviewer, body: {} }));
  // 拨到 2026-10-08T11:00Z：UTC−12 还是 10-07 23:00，这条规则在某些地方还在用
  api.clock.advance(11 * 3_600_000);
  let manager = (await ok(api.call("POST", "/platform/v1/auth/login", { body: { email: m.staff.cm1.email, password: TEST_PASSWORD } }))).access_token as string;
  const early = await pricing(channel.id, { markup_floor_bp: 1_200, default_markup_bp: 1_200 }, manager);
  assert.deepEqual([early.status, early.body.error?.code], [409, "RULES_BELOW_FLOOR"]);
  // 再过 2 小时：UTC−12 也到了 10-08，规则在哪里都结束了
  api.clock.advance(2 * 3_600_000);
  manager = (await ok(api.call("POST", "/platform/v1/auth/login", { body: { email: m.staff.cm1.email, password: TEST_PASSWORD } }))).access_token as string;
  const late = await pricing(channel.id, { markup_floor_bp: 1_200, default_markup_bp: 1_200 }, manager);
  assert.equal(late.status, 202, late.text);
});
