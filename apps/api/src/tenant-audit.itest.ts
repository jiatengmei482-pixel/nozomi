/**
 * 租户侧的操作日志查询 GET /tenant/v1/audit-logs（需求文档 01「操作日志」）。
 * 跨租户隔离的测试在 tenant-isolation.itest.ts；这里验证权限、内容范围（不含平台内部记录）、筛选和分页。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { TENANT_ROLES } from "@nozomi/domain";
import { TEST_PASSWORD, type TenantFixture, type TestApi, addTenantUser, createTestApi } from "./testing/api.ts";

let api: TestApi;
let platformToken: string;
let platformUserId: string;
let tenant: TenantFixture;
let dispatcher: { id: string; token: string };

const TENANT_IP = "198.51.100.77";
const PLATFORM_IP = "203.0.113.99";

async function all(query = ""): Promise<any[]> {
  const res = await api.call("GET", `/tenant/v1/audit-logs?limit=200${query ? `&${query}` : ""}`, { token: tenant.adminToken });
  assert.equal(res.status, 200, res.text);
  return res.body.items;
}

before(async () => {
  api = await createTestApi();
  platformToken = await api.superAdminToken("root@platform.test");
  platformUserId = (await api.call("GET", "/platform/v1/auth/me", { token: platformToken })).body.user.id;
  tenant = await api.tenantWithAdmin(platformToken, "车队甲", "admin@a.test");
  api.clock.advance(60_000);
  dispatcher = await addTenantUser(api, tenant.adminToken, "dispatch@a.test", "dispatch");
  await api.call("PUT", `/tenant/v1/users/${dispatcher.id}`, { token: tenant.adminToken, ip: TENANT_IP, body: { name: "老王", role: "finance", status: "active" } });
  await api.call("POST", "/tenant/v1/auth/login", { ip: TENANT_IP, body: { email: "dispatch@a.test", password: "Wrong-Password-000" } });
  // 平台对这个租户做的操作：暂停（带内部原因）、恢复、代发管理员邀请、给管理员发重置令牌
  const asPlatform = { token: platformToken, ip: PLATFORM_IP };
  await api.call("POST", `/platform/v1/tenants/${tenant.tenantId}/suspend`, { ...asPlatform, body: { reason: "内部备注：风控怀疑刷单" } });
  await api.call("POST", `/platform/v1/tenants/${tenant.tenantId}/resume`, asPlatform);
  await api.call("POST", `/platform/v1/tenants/${tenant.tenantId}/admin-invites`, { ...asPlatform, body: { email: "admin2@a.test", name: "平台代邀" } });
  await api.call("POST", `/platform/v1/tenants/${tenant.tenantId}/admin-password-resets`, { ...asPlatform, body: { email: "admin@a.test" } });
});
after(() => api.close());

test("只有租户管理员能看操作日志；其他角色 403，没登录 401，平台令牌 401", async () => {
  for (const { key } of TENANT_ROLES) {
    if (key === "admin" || key === "finance") continue;
    const user = await addTenantUser(api, tenant.adminToken, `${key}-audit@a.test`, key);
    const res = await api.call("GET", "/tenant/v1/audit-logs", { token: user.token });
    assert.equal(res.status, 403, key);
    assert.deepEqual(res.body.error.details, { required: "audit_log.read" });
  }
  assert.equal((await api.call("GET", "/tenant/v1/audit-logs", { token: dispatcher.token })).status, 403, "finance");
  assert.equal((await api.call("GET", "/tenant/v1/audit-logs")).status, 401);
  assert.equal((await api.call("GET", "/tenant/v1/audit-logs", { token: platformToken })).status, 401);
  assert.equal((await api.call("GET", "/tenant/v1/audit-logs", { token: tenant.adminToken })).status, 200);
});

test("内容：本租户用户的操作和针对本租户账号的登录失败；从新到旧；字段与接口定义一致，没有 tenant_id", async () => {
  const logs = await all();
  const ids = logs.map((l) => BigInt(l.id));
  assert.deepEqual(ids, [...ids].sort((x, y) => (x < y ? 1 : -1)));
  for (const log of logs) {
    assert.deepEqual(Object.keys(log), ["id", "occurred_at", "actor", "ip", "source", "resource", "resource_id", "action", "before", "after"]);
    assert.ok(["tenant_user", "anonymous"].includes(log.actor.type), log.actor.type);
  }
  const history = (await all(`resource_id=${dispatcher.id}`)).reverse().map((l) => ({ action: l.action, actor: l.actor.email, before: l.before, after: l.after }));
  assert.deepEqual(history, [
    { action: "invite", actor: "admin@a.test", before: null, after: { email: "dispatch@a.test", name: "dispatch@a.test", role: "dispatch", status: "invited" } },
    { action: "accept_invite", actor: "dispatch@a.test", before: { status: "invited" }, after: { status: "active" } },
    { action: "login", actor: "dispatch@a.test", before: null, after: null },
    { action: "update", actor: "admin@a.test", before: { name: "dispatch@a.test" }, after: { name: "老王" } },
    { action: "change_role", actor: "admin@a.test", before: { role: "dispatch" }, after: { role: "finance" } },
    { action: "login_failed", actor: null, before: null, after: { email: "dispatch@a.test", reason: "wrong_password" } },
  ]);
});

test("不包含平台内部的记录：平台员工对这个租户做的操作（创建、暂停及原因、恢复、代发邀请、发重置令牌）和平台级记录都看不到", async () => {
  const visibleToPlatform = await api.call("GET", `/platform/v1/audit-logs?limit=200&tenant_id=${tenant.tenantId}&actor_id=${platformUserId}`, { token: platformToken });
  const platformActions = visibleToPlatform.body.items.map((l: any) => `${l.resource}:${l.action}`).sort();
  assert.deepEqual(platformActions, ["tenant:create", "tenant:resume", "tenant:suspend", "tenant_user:invite", "tenant_user:invite", "tenant_user:request_password_reset"], "前提：平台确实在这个租户名下留了这些记录");

  const logs = await all();
  const text = JSON.stringify(logs);
  for (const leaked of ["root@platform.test", platformUserId, PLATFORM_IP, "内部备注", "风控怀疑", "platform_user", "suspend", "resume"]) {
    assert.ok(!text.includes(leaked), `租户的操作日志里出现了平台内部内容：${leaked}`);
  }
  assert.ok(!logs.some((l) => l.resource === "tenant" || l.resource === "platform_user" || l.resource === "integration"));
  for (const query of [`actor_id=${platformUserId}`, "resource=tenant", "action=suspend", "resource=platform_user"]) {
    assert.deepEqual(await all(query), [], query);
  }
  const expected = await api.db.owner.query(
    "select count(*)::int as n from audit_logs where tenant_id = $1 and actor_type in ('tenant_user', 'anonymous')",
    [tenant.tenantId],
  );
  assert.equal(logs.length, expected.rows[0].n);
});

test("筛选：按人、按对象、按动作、按时间，条件可以组合；翻页不重不漏", async () => {
  const byActor = await all(`actor_id=${tenant.adminId}`);
  assert.ok(byActor.length >= 3 && byActor.every((l) => l.actor.id === tenant.adminId));
  assert.deepEqual((await all("action=change_role")).map((l) => l.resource_id), [dispatcher.id]);
  const combined = await all(`actor_id=${tenant.adminId}&resource_id=${dispatcher.id}&action=update`);
  assert.equal(combined.length, 1);
  assert.equal(combined[0].ip, TENANT_IP);

  const boundary = (await all("action=update"))[0].occurred_at;
  const from = await all(`from=${encodeURIComponent(boundary)}`);
  const to = await all(`to=${encodeURIComponent(boundary)}`);
  assert.ok(from.length > 0 && to.length > 0);
  assert.equal(from.length + to.length, (await all()).length);
  assert.ok(to.every((l) => l.occurred_at < boundary) && from.every((l) => l.occurred_at >= boundary));

  const paged: string[] = [];
  let cursor: string | null = null;
  do {
    const res = await api.call("GET", `/tenant/v1/audit-logs?limit=3${cursor ? `&cursor=${cursor}` : ""}`, { token: tenant.adminToken });
    assert.ok(res.body.items.length <= 3);
    paged.push(...res.body.items.map((l: any) => l.id));
    cursor = res.body.next_cursor;
  } while (cursor);
  assert.deepEqual(paged, (await all()).map((l) => l.id));
});

test("参数校验：编号、时间、分页参数不对是 400，不是 500；没有修改和删除的入口", async () => {
  for (const query of ["actor_id=abc", "from=yesterday", "to=2026-10-07T00:00:00%2B99:99", "limit=0", "limit=0x10", "limit=1e2", "cursor=xyz", "resource=a%00b"]) {
    const res = await api.call("GET", `/tenant/v1/audit-logs?${query}`, { token: tenant.adminToken });
    assert.equal(res.status, 400, query);
    assert.equal(res.body.error.code, "VALIDATION_FAILED");
  }
  for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
    assert.equal((await api.call(method, "/tenant/v1/audit-logs", { token: tenant.adminToken, body: {} })).status, 404, method);
  }
});

test("查看操作日志不依赖租户状态：暂停期间管理员照常能查", async () => {
  await api.call("POST", `/platform/v1/tenants/${tenant.tenantId}/suspend`, { token: platformToken });
  try {
    assert.equal((await api.call("GET", "/tenant/v1/audit-logs", { token: tenant.adminToken })).status, 200);
    const login = await api.call("POST", "/tenant/v1/auth/login", { body: { email: "admin@a.test", password: TEST_PASSWORD } });
    assert.equal(login.status, 200);
  } finally {
    await api.call("POST", `/platform/v1/tenants/${tenant.tenantId}/resume`, { token: platformToken });
  }
});
