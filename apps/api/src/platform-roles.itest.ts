/**
 * 自建角色与数据范围（M4-05，ADR 0030），真实 PostgreSQL：
 * - 内置角色是只读模板（接口 409，数据库触发器兜底），在角色页上显示成勾选表；
 * - 新建自建角色（校验勾选、名字、数据范围、IP 白名单），把员工改成这个角色后权限立即按勾选生效；
 * - 修改走双人复核，批准后立即生效（不用重新登录），过时的复核不能生效；
 * - 数据范围：渠道（列表、详情和下面的一切、渠道类的复核、按渠道试算）、城市和渠道（订单）；
 * - 删除、改员工的角色（不能改自己的、最后一个超级管理员）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PLATFORM_ROLES, grantsOfActions, platformPermissions } from "@nozomi/domain";
import { type ApiResponse, TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";
import { DROPOFF, type Market, SERVICE_TIME, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { assertMatchesOperation } from "./testing/openapi.ts";

let api: TestApi;
let m: Market;
let root2: string;
let channelA: string;
let channelB: string;

before(async () => {
  api = await createTestApi({ payments: new FakePaymentProvider() });
  m = await buildMarket(api);
  root2 = await addStaff("root2@platform.test", "super_admin").then((s) => s.token);
  channelA = (await newChannel(api, m.staff.cm1.token, { name: "官网甲" })).id;
  channelB = (await newChannel(api, m.staff.cm1.token, { name: "分销乙" })).id;
});
after(() => api.close());

async function addStaff(email: string, role: string): Promise<{ id: string; token: string }> {
  const invited = await ok(api.call("POST", "/platform/v1/staff", { token: m.root, body: { email, name: email.split("@")[0], role } }), 201);
  await ok(api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.invite.token, password: TEST_PASSWORD } }));
  return { id: invited.user.id, token: (await ok(api.platformLogin({ body: { email, password: TEST_PASSWORD } }))).access_token };
}

const createRole = (body: Record<string, unknown>, token = m.root): Promise<ApiResponse> => api.call("POST", "/platform/v1/roles", { token, body });

/** 发起修改并让第二位超级管理员批准。 */
async function changeRole(key: string, body: Record<string, unknown>): Promise<any> {
  const requested = await ok(api.call("POST", `/platform/v1/roles/${key}/changes`, { token: m.root, body }), 202);
  return ok(api.call("POST", `/platform/v1/approvals/${requested.approval.id}/approve`, { token: root2, body: {} }));
}

test("角色列表：10 个内置角色是只读模板，按需求文档的顺序在前，勾选表和代码里的权限一致；接口形状和 openapi 一致", async () => {
  const res = await api.call("GET", "/platform/v1/roles", { token: m.root });
  assert.equal(res.status, 200, res.text);
  assertMatchesOperation("GET", "/platform/v1/roles", res.status, res.body);
  const builtin = res.body.items.filter((r: any) => r.builtin);
  assert.deepEqual(builtin.map((r: any) => r.key), PLATFORM_ROLES.map((r) => r.key));
  for (const role of builtin) {
    assert.deepEqual(role.permissions, [...platformPermissions(role.key)], role.key);
    assert.deepEqual(role.grants, grantsOfActions(platformPermissions(role.key)), role.key);
    assert.deepEqual(role.data_scope, { city_ids: null, channel_ids: null, cities: [], channels: [] });
  }
  assert.equal(builtin.find((r: any) => r.key === "super_admin").staff_count, 2);
});

test("内置角色不能改、不能删：接口 409 ROLE_BUILTIN_READONLY；数据库触发器同样拒绝（迁移账号也不行）", async () => {
  const change = await api.call("POST", "/platform/v1/roles/finance/changes", { token: m.root, body: { name: "财务", grants: ["orders:view"] } });
  assert.equal(change.status, 409);
  assert.equal(change.body.error.code, "ROLE_BUILTIN_READONLY");
  const removed = await api.call("DELETE", "/platform/v1/roles/finance", { token: m.root });
  assert.equal(removed.body.error.code, "ROLE_BUILTIN_READONLY");
  await assert.rejects(api.db.owner.query("update platform_roles set grants = '{orders:view}' where key = 'finance'"), /内置角色是只读模板/);
  await assert.rejects(api.db.owner.query("delete from platform_roles where key = 'readonly'"), /内置角色是只读模板/);
  await assert.rejects(api.db.owner.query("insert into platform_roles (key, name, builtin, sort_order) values ('boss', '老板', true, 99)"), /内置角色只能由迁移写入/);
  const missing = await api.call("GET", "/platform/v1/roles/custom_0123456789abcdef", { token: m.root });
  assert.equal(missing.status, 404);
});

test("新建自建角色：勾选、名字、数据范围、IP 白名单都要合规；只归超级管理员的三格勾不了", async () => {
  const issues = async (body: Record<string, unknown>): Promise<ApiResponse> => createRole({ name: "试试", ...body });
  const viewRequired = await issues({ grants: ["channels:edit"] });
  assert.equal(viewRequired.status, 400);
  assert.deepEqual(viewRequired.body.error.details.issues, [{ grant: "channels:edit", reason: "VIEW_REQUIRED" }]);
  const restricted = await issues({ grants: ["staff:view", "staff:edit", "roles:view", "roles:review"] });
  assert.deepEqual(restricted.body.error.details.issues.map((i: any) => i.reason), ["SUPER_ADMIN_ONLY", "SUPER_ADMIN_ONLY"]);
  assert.equal((await issues({ grants: ["orders:export"] })).body.error.code, "ROLE_GRANTS_INVALID");
  const scope = await issues({ grants: [], data_scope: { city_ids: [randomUUID()], channel_ids: null } });
  assert.equal(scope.body.error.code, "ROLE_SCOPE_INVALID");
  const cidr = await issues({ grants: [], ip_allowlist: ["10.1.2.3/8"] });
  assert.equal(cidr.body.error.code, "IP_ALLOWLIST_INVALID");
  assert.equal(cidr.body.error.details.issues[0].suggestion, "10.0.0.0/8");
  const sameAsBuiltin = await createRole({ name: " 财务 ", grants: [] });
  assert.equal(sameAsBuiltin.status, 409);
  assert.equal(sameAsBuiltin.body.error.code, "ROLE_NAME_TAKEN");
  const notAllowed = await createRole({ name: "x", grants: [] }, m.staff.readonly.token);
  assert.equal(notAllowed.status, 403);

  const created = await createRole({ name: "订单专员", description: "只看订单", grants: ["orders:view", "master_data:view"], ip_allowlist: ["2001:DB8::/32"] });
  assert.equal(created.status, 201, created.text);
  assertMatchesOperation("POST", "/platform/v1/roles", created.status, created.body);
  assert.match(created.body.key, /^custom_[0-9a-f]{16}$/);
  assert.equal(created.body.builtin, false);
  assert.deepEqual(created.body.permissions, ["master_data.read", "order.read"]);
  assert.deepEqual(created.body.ip_allowlist, ["2001:db8::/32"]);
  assert.equal(created.body.version, 1);
  assert.equal((await createRole({ name: "订单专员", grants: [] })).body.error.code, "ROLE_NAME_TAKEN");
  const audit = await api.db.owner.query("select action, after from audit_logs where resource = 'platform_role' and resource_id = $1", [created.body.key]);
  assert.equal(audit.rows[0].action, "create");
  assert.deepEqual(audit.rows[0].after.grants, ["orders:view", "master_data:view"]);
});

test("员工改成自建角色后，权限立即按勾选生效（不用重新登录）；修改角色走双人复核，批准后立即生效", async () => {
  const role = await ok(createRole({ name: "渠道观察员", grants: ["channels:view"] }), 201);
  const staff = await addStaff("watcher@platform.test", "readonly");
  const patched = await api.call("PATCH", `/platform/v1/staff/${staff.id}`, { token: m.root, body: { role: role.key } });
  assert.equal(patched.status, 200, patched.text);
  assert.equal(patched.body.role, role.key);
  assert.equal(patched.body.role_name, "渠道观察员");
  const me = await ok(api.call("GET", "/platform/v1/auth/me", { token: staff.token }));
  assert.deepEqual(me.permissions, ["channel.read"]);
  assert.equal((await api.call("GET", "/platform/v1/channels", { token: staff.token })).status, 200);
  assert.equal((await api.call("GET", "/platform/v1/tenants", { token: staff.token })).status, 403, "readonly 原来能看供应商，改了角色立即没有");

  // 修改：发起不生效；发起人不能批准；第二位超级管理员批准后立即生效
  const requested = await api.call("POST", `/platform/v1/roles/${role.key}/changes`, { token: m.root, body: { name: "渠道观察员", grants: ["channels:view", "tenants:view"], request_note: "要看供应商" } });
  assert.equal(requested.status, 202, requested.text);
  assert.equal(requested.body.approval.kind, "platform_role.update");
  assert.equal((await api.call("GET", "/platform/v1/tenants", { token: staff.token })).status, 403, "发起不生效");
  assert.equal((await api.call("POST", `/platform/v1/approvals/${requested.body.approval.id}/approve`, { token: m.root, body: {} })).body.error.code, "APPROVAL_SELF_REVIEW");
  const approved = await api.call("POST", `/platform/v1/approvals/${requested.body.approval.id}/approve`, { token: root2, body: {} });
  assert.equal(approved.status, 200, approved.text);
  assert.equal((await api.call("GET", "/platform/v1/tenants", { token: staff.token })).status, 200, "批准后立即生效");
  const after = await ok(api.call("GET", `/platform/v1/roles/${role.key}`, { token: m.root }));
  assert.equal(after.version, 2);
  assert.deepEqual(after.grants, ["channels:view", "tenants:view"]);

  // 和现在一样的不发起；同一角色上挂着两条，批了一条，另一条过时
  assert.equal((await api.call("POST", `/platform/v1/roles/${role.key}/changes`, { token: m.root, body: { name: "渠道观察员", grants: ["channels:view", "tenants:view"] } })).status, 400);
  const first = await ok(api.call("POST", `/platform/v1/roles/${role.key}/changes`, { token: m.root, body: { name: "渠道观察员", grants: ["channels:view"] } }), 202);
  const second = await ok(api.call("POST", `/platform/v1/roles/${role.key}/changes`, { token: m.root, body: { name: "渠道观察员", grants: ["orders:view"] } }), 202);
  await ok(api.call("POST", `/platform/v1/approvals/${first.approval.id}/approve`, { token: root2, body: {} }));
  const stale = await api.call("POST", `/platform/v1/approvals/${second.approval.id}/approve`, { token: root2, body: {} });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, "APPROVAL_STALE");
  // 只有超级管理员能审核角色的修改：渠道经理看不到这一类
  assert.equal((await api.call("GET", `/platform/v1/approvals/${second.approval.id}`, { token: m.staff.cm2.token })).status, 404);
});

test("数据范围（渠道）：列表只有范围内的；范围外的渠道和它下面的一切 404；不能新建渠道；渠道类的复核只看得到范围内的；按渠道试算范围外 404", async () => {
  const role = await ok(createRole({ name: "甲渠道运营", grants: ["channels:view", "channels:edit", "approvals:view", "quote_preview:view"], data_scope: { city_ids: null, channel_ids: [channelA] } }), 201);
  assert.deepEqual(role.data_scope.channels, [{ id: channelA, name: "官网甲" }]);
  const staff = await addStaff("scoped@platform.test", role.key);
  const me = await ok(api.call("GET", "/platform/v1/auth/me", { token: staff.token }));
  assert.deepEqual(me.data_scope, { city_ids: null, channel_ids: [channelA] });

  const list = await ok(api.call("GET", "/platform/v1/channels", { token: staff.token }));
  assert.deepEqual(list.items.map((c: any) => c.id), [channelA]);
  assert.equal(list.total, 1);
  assert.equal((await api.call("GET", `/platform/v1/channels/${channelA}`, { token: staff.token })).status, 200);
  for (const path of ["", "/markup-rules", "/api-clients", "/quote-logs"]) {
    const res = await api.call("GET", `/platform/v1/channels/${channelB}${path}`, { token: staff.token });
    assert.equal(res.status, 404, path);
  }
  for (const [method, path] of [["PATCH", ""], ["POST", "/pause"], ["POST", "/pricing-changes"], ["POST", "/markup-rules"], ["POST", "/api-clients"], ["POST", "/activate"]] as const) {
    const res = await api.call(method, `/platform/v1/channels/${channelB}${path}`, { token: staff.token, body: {}, headers: { "if-match": '"1"' } });
    assert.equal(res.status, 404, `${method} ${path}`);
  }
  const create = await api.call("POST", "/platform/v1/channels", { token: staff.token, body: { name: "新渠道", type: "own", settle_currency: "JPY" } });
  assert.equal(create.status, 403);
  assert.equal(create.body.error.code, "DATA_SCOPE_DENIED");

  // 渠道类的复核：两个渠道各发起一条暂停
  const pauseA = await ok(api.call("POST", `/platform/v1/channels/${channelA}/pause`, { token: m.staff.cm1.token, body: {} }), 202);
  const pauseB = await ok(api.call("POST", `/platform/v1/channels/${channelB}/pause`, { token: m.staff.cm1.token, body: {} }), 202);
  const approvals = await ok(api.call("GET", "/platform/v1/approvals?status=pending", { token: staff.token }));
  const ids = approvals.items.map((a: any) => a.id);
  assert.ok(ids.includes(pauseA.approval.id));
  assert.ok(!ids.includes(pauseB.approval.id));
  assert.equal(approvals.total, ids.length);
  assert.equal((await api.call("GET", `/platform/v1/approvals/${pauseB.approval.id}`, { token: staff.token })).status, 404);
  assert.equal((await api.call("POST", `/platform/v1/approvals/${pauseB.approval.id}/reject`, { token: staff.token, body: {} })).status, 404);
  for (const a of [pauseA, pauseB]) await ok(api.call("POST", `/platform/v1/approvals/${a.approval.id}/withdraw`, { token: m.staff.cm1.token, body: {} }));

  const preview = { city_id: m.ids.tokyo, category: "airport_transfer", place_id: m.ids.narita, direction: "pickup", dropoff: DROPOFF, service_time: SERVICE_TIME, passengers: 2, luggage: 1, currency: "JPY" };
  assert.equal((await api.call("POST", "/platform/v1/quotes/preview", { token: staff.token, body: { ...preview, channel_id: channelB } })).status, 404);
  assert.equal((await api.call("POST", "/platform/v1/quotes/preview", { token: staff.token, body: { ...preview, channel_id: channelA } })).status, 200);
});

test("数据范围（订单）：按渠道、按城市过滤列表和详情，范围外的和不存在一样", async () => {
  // 两个渠道各下一单（东京）
  const orderIn = async (channelId: string): Promise<string> => {
    const creds = await salesCredentials(api, m, channelId);
    api.clock.advance(1_000);
    const quotes = await ok(api.call("POST", "/sales/v1/quotes", { token: creds.token, body: { city_id: m.ids.tokyo, category: "airport_transfer", place_id: m.ids.narita, direction: "pickup", dropoff: DROPOFF, service_time: SERVICE_TIME, passengers: 2, luggage: 1, currency: "JPY", vehicle_group_ids: [m.ids.biz7] } }));
    api.clock.advance(1_000);
    const placed = await ok(api.call("POST", "/sales/v1/orders", {
      token: creds.token,
      headers: { "idempotency-key": randomUUID() },
      body: { quote_id: quotes.quotes[0].quote_id, passenger: { name: "王小明", phone: "+81 90-1234-5678", email: "guest@example.com" }, flight_no: "NH211", dropoff_address: "东京站", save_payment_method: true },
    }), 201);
    return placed.order.id as string;
  };
  const inA = await orderIn(channelA);
  const inB = await orderIn(channelB);

  const byChannel = await ok(createRole({ name: "甲渠道订单", grants: ["orders:view"], data_scope: { city_ids: null, channel_ids: [channelA] } }), 201);
  const byCity = await ok(createRole({ name: "大阪订单", grants: ["orders:view"], data_scope: { city_ids: [m.ids.osaka], channel_ids: null } }), 201);
  const a = await addStaff("orders-a@platform.test", byChannel.key);
  const osaka = await addStaff("orders-osaka@platform.test", byCity.key);

  const listA = await ok(api.call("GET", "/platform/v1/orders", { token: a.token }));
  assert.deepEqual(listA.items.map((o: any) => o.id), [inA]);
  assert.equal(listA.total, 1);
  assert.equal((await api.call("GET", `/platform/v1/orders/${inA}`, { token: a.token })).status, 200);
  assert.equal((await api.call("GET", `/platform/v1/orders/${inB}`, { token: a.token })).status, 404);
  const listOsaka = await ok(api.call("GET", "/platform/v1/orders", { token: osaka.token }));
  assert.deepEqual(listOsaka.items, []);
  assert.equal((await api.call("GET", `/platform/v1/orders/${inA}`, { token: osaka.token })).status, 404);
  // 不限范围的内置角色两单都看得到
  const all = await ok(api.call("GET", "/platform/v1/orders", { token: m.staff.operations.token }));
  assert.ok([inA, inB].every((id) => all.items.some((o: any) => o.id === id)));

  // 改了数据范围（复核批准后）立即生效
  await changeRole(byCity.key, { name: "大阪订单", grants: ["orders:view"], data_scope: { city_ids: [m.ids.osaka, m.ids.tokyo], channel_ids: null } });
  assert.equal((await ok(api.call("GET", "/platform/v1/orders", { token: osaka.token }))).total, 2);
});

test("删除自建角色：有人用（含待激活、已停用）时 409 ROLE_IN_USE；没人用了可以删；删掉的角色不能再给人", async () => {
  const role = await ok(createRole({ name: "临时角色", grants: ["orders:view"] }), 201);
  const invited = await ok(api.call("POST", "/platform/v1/staff", { token: m.root, body: { email: "temp-role@platform.test", name: "临时", role: role.key } }), 201);
  const inUse = await api.call("DELETE", `/platform/v1/roles/${role.key}`, { token: m.root });
  assert.equal(inUse.status, 409);
  assert.deepEqual(inUse.body.error.details, { staff_count: 1 });
  await ok(api.call("PATCH", `/platform/v1/staff/${invited.user.id}`, { token: m.root, body: { role: "readonly" } }));
  assert.equal((await api.call("DELETE", `/platform/v1/roles/${role.key}`, { token: m.root })).status, 204);
  assert.equal((await api.call("GET", `/platform/v1/roles/${role.key}`, { token: m.root })).status, 404);
  const reuse = await api.call("POST", "/platform/v1/staff", { token: m.root, body: { email: "late@platform.test", name: "晚到", role: role.key } });
  assert.equal(reuse.status, 400);
  assert.equal(reuse.body.error.details.issues[0].reason, "UNKNOWN_ROLE");
});

test("改员工的角色：不能改自己的；两位超级管理员同时把对方降级，只有一个成功（至少保留一个）；改动有审计", async () => {
  const solo = await createTestApi();
  try {
    const rootA = await solo.superAdminToken("a@platform.test");
    const invited = await ok(solo.call("POST", "/platform/v1/staff", { token: rootA, body: { email: "b@platform.test", name: "乙", role: "super_admin" } }), 201);
    await ok(solo.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.invite.token, password: TEST_PASSWORD } }));
    const rootB = (await ok(solo.platformLogin({ body: { email: "b@platform.test", password: TEST_PASSWORD } }))).access_token as string;
    const idA = (await ok(solo.call("GET", "/platform/v1/auth/me", { token: rootA }))).user.id as string;
    const idB = invited.user.id as string;

    const own = await solo.call("PATCH", `/platform/v1/staff/${idA}`, { token: rootA, body: { role: "readonly" } });
    assert.equal(own.status, 409);
    assert.equal(own.body.error.code, "OWN_ROLE_UNCHANGEABLE");
    const renamed = await ok(solo.call("PATCH", `/platform/v1/staff/${idA}`, { token: rootA, body: { name: "甲（改名）" } }));
    assert.equal(renamed.name, "甲（改名）");

    const results = await Promise.all([
      solo.call("PATCH", `/platform/v1/staff/${idB}`, { token: rootA, body: { role: "readonly" } }),
      solo.call("PATCH", `/platform/v1/staff/${idA}`, { token: rootB, body: { role: "readonly" } }),
    ]);
    // 先完成的一方成功；后到的一方要么在加锁后发现对方已是唯一的超级管理员（409 LAST_ADMIN_REQUIRED），要么鉴权时自己已经被降级（403）
    assert.equal(results.filter((r) => r.status === 200).length, 1, results.map((r) => r.text).join("\n"));
    const refused = results.find((r) => r.status !== 200) as ApiResponse;
    assert.ok((refused.status === 409 && refused.body.error.code === "LAST_ADMIN_REQUIRED") || (refused.status === 403 && refused.body.error.code === "FORBIDDEN"), refused.text);
    const supers = (await solo.db.owner.query("select count(*)::int as n from platform_users where role = 'super_admin' and status = 'active'")).rows[0].n;
    assert.equal(supers, 1);
    const audit = await solo.db.owner.query("select before, after from audit_logs where action = 'change_role'");
    assert.equal(audit.rows.length, 1);
    assert.deepEqual(audit.rows[0].after, { role: "readonly" });
  } finally {
    await solo.close();
  }
});
