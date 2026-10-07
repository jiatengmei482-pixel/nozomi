/**
 * 租户账号管理：角色权限的强制执行、邀请、改角色、停用、「管理员至少保留一个」。
 * 跨租户访问的测试在 tenant-isolation.itest.ts。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { TENANT_ROLES, type TenantRole, tenantPermissions } from "@nozomi/domain";
import { TEST_PASSWORD, type TenantFixture, type TestApi, addTenantUser, createTestApi } from "./testing/api.ts";

let api: TestApi;
let platformToken: string;
let tenant: TenantFixture;
const staff = new Map<TenantRole, { id: string; token: string }>();

before(async () => {
  api = await createTestApi();
  platformToken = await api.superAdminToken();
  tenant = await api.tenantWithAdmin(platformToken, "车队甲", "admin@a.test");
  staff.set("admin", { id: tenant.adminId, token: tenant.adminToken });
  for (const { key } of TENANT_ROLES) {
    if (key === "admin") continue;
    api.clock.advance(1_000);
    staff.set(key, await addTenantUser(api, tenant.adminToken, `${key}@a.test`, key));
  }
});
after(() => api.close());

const MISSING = "99999999-9999-4999-8999-999999999999";

test("权限：账号管理只有管理员能做；只读角色能看列表；其他角色看也不行", async () => {
  for (const { key: role } of TENANT_ROLES) {
    const token = staff.get(role)!.token;
    const list = await api.call("GET", "/tenant/v1/users", { token });
    const invite = await api.call("POST", "/tenant/v1/users", { token, body: {} });
    const update = await api.call("PUT", `/tenant/v1/users/${MISSING}`, { token, body: {} });
    const remove = await api.call("DELETE", `/tenant/v1/users/${MISSING}`, { token });
    const canRead = role === "admin" || role === "readonly";
    assert.equal(list.status, canRead ? 200 : 403, `${role} 看列表`);
    assert.equal(invite.status, role === "admin" ? 400 : 403, `${role} 邀请`);
    assert.equal(update.status, role === "admin" ? 400 : 403, `${role} 修改`);
    assert.equal(remove.status, role === "admin" ? 404 : 403, `${role} 停用`);
    if (role !== "admin") assert.deepEqual(invite.body.error.details, { required: "user.manage" });

    const me = await api.call("GET", "/tenant/v1/auth/me", { token });
    assert.equal(me.status, 200, `${role} 都能看自己`);
    assert.deepEqual(me.body.permissions, tenantPermissions(role));
  }
});

test("列表：按创建时间从早到晚，字段里没有密码、令牌、租户编号以外的内部信息；游标分页不重不漏", async () => {
  const all = await api.call("GET", "/tenant/v1/users", { token: tenant.adminToken });
  assert.deepEqual(
    all.body.items.map((u: any) => u.email),
    ["admin@a.test", "pricing@a.test", "dispatch@a.test", "finance@a.test", "readonly@a.test"],
  );
  for (const item of all.body.items) {
    assert.deepEqual(Object.keys(item).sort(), ["created_at", "email", "id", "name", "role", "status", "updated_at"]);
  }
  const paged: string[] = [];
  let cursor: string | null = null;
  do {
    const res = await api.call("GET", `/tenant/v1/users?limit=2${cursor ? `&cursor=${cursor}` : ""}`, { token: tenant.adminToken });
    paged.push(...res.body.items.map((u: any) => u.email));
    cursor = res.body.next_cursor;
  } while (cursor);
  assert.deepEqual(paged, all.body.items.map((u: any) => u.email));
});

test("邀请：校验邮箱和角色；本租户里已激活的邮箱 409", async () => {
  const bad = await api.call("POST", "/tenant/v1/users", { token: tenant.adminToken, body: { email: "nope", name: "", role: "super_admin" } });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body.error.details.issues.map((i: any) => i.path), ["/email", "/name", "/role"]);
  const taken = await api.call("POST", "/tenant/v1/users", { token: tenant.adminToken, body: { email: "Dispatch@A.test", name: "重复", role: "dispatch" } });
  assert.equal(taken.status, 409);
  assert.equal(taken.body.error.code, "EMAIL_TAKEN");
});

test("改角色：立即生效（不用重新登录），旧令牌按新角色判断权限", async () => {
  const pricing = staff.get("pricing")!;
  assert.equal((await api.call("GET", "/tenant/v1/users", { token: pricing.token })).status, 403);
  const promoted = await api.call("PUT", `/tenant/v1/users/${pricing.id}`, {
    token: tenant.adminToken,
    body: { name: "升职了", role: "admin", status: "active" },
  });
  assert.equal(promoted.status, 200, promoted.text);
  assert.deepEqual({ name: promoted.body.name, role: promoted.body.role }, { name: "升职了", role: "admin" });
  assert.equal((await api.call("GET", "/tenant/v1/users", { token: pricing.token })).status, 200);

  const demoted = await api.call("PUT", `/tenant/v1/users/${pricing.id}`, {
    token: tenant.adminToken,
    body: { name: "升职了", role: "pricing", status: "active" },
  });
  assert.equal(demoted.status, 200);
  assert.equal((await api.call("GET", "/tenant/v1/users", { token: pricing.token })).status, 403);
});

test("管理员至少保留一个：唯一的管理员不能降级自己、不能停用自己（PUT 和 DELETE 都拦）", async () => {
  const self = `/tenant/v1/users/${tenant.adminId}`;
  const demote = await api.call("PUT", self, { token: tenant.adminToken, body: { name: "甲", role: "readonly", status: "active" } });
  const disable = await api.call("PUT", self, { token: tenant.adminToken, body: { name: "甲", role: "admin", status: "disabled" } });
  const remove = await api.call("DELETE", self, { token: tenant.adminToken });
  for (const res of [demote, disable, remove]) {
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, "LAST_ADMIN_REQUIRED");
  }
  const me = await api.call("GET", "/tenant/v1/auth/me", { token: tenant.adminToken });
  assert.deepEqual({ role: me.body.user.role, status: me.body.user.status }, { role: "admin", status: "active" });
  const rename = await api.call("PUT", self, { token: tenant.adminToken, body: { name: "只改名字", role: "admin", status: "active" } });
  assert.equal(rename.status, 200, "不影响管理员身份的修改放行");
});

test("管理员至少保留一个：待激活的管理员不算数；有第二个在用的管理员后才能降级第一个", async () => {
  const pending = await api.call("POST", "/tenant/v1/users", { token: tenant.adminToken, body: { email: "admin2@a.test", name: "第二个管理员", role: "admin" } });
  assert.equal(pending.status, 201);
  const self = `/tenant/v1/users/${tenant.adminId}`;
  const tooEarly = await api.call("DELETE", self, { token: tenant.adminToken });
  assert.equal(tooEarly.status, 409, "第二个管理员还没激活");

  await api.call("POST", "/tenant/v1/auth/accept-invite", { body: { token: pending.body.invite.token, password: TEST_PASSWORD } });
  const second = await api.call("POST", "/tenant/v1/auth/login", { body: { email: "admin2@a.test", password: TEST_PASSWORD } });
  const demote = await api.call("PUT", self, { token: tenant.adminToken, body: { name: "甲", role: "readonly", status: "active" } });
  assert.equal(demote.status, 200);
  assert.equal((await api.call("POST", "/tenant/v1/users", { token: tenant.adminToken, body: {} })).status, 403, "降级后自己也不能再管账号");
  const restore = await api.call("PUT", self, { token: second.body.access_token, body: { name: "甲", role: "admin", status: "active" } });
  assert.equal(restore.status, 200);
});

test("两个管理员同时把对方降级：只有一个成功，租户不会一个管理员都不剩", async () => {
  const second = await api.call("POST", "/tenant/v1/auth/login", { body: { email: "admin2@a.test", password: TEST_PASSWORD } });
  const secondId = second.body.user.id;
  for (let round = 0; round < 3; round++) {
    const results = await Promise.all([
      api.call("PUT", `/tenant/v1/users/${secondId}`, { token: tenant.adminToken, body: { name: "乙", role: "readonly", status: "active" } }),
      api.call("PUT", `/tenant/v1/users/${tenant.adminId}`, { token: second.body.access_token, body: { name: "甲", role: "readonly", status: "active" } }),
    ]);
    const admins = await api.db.pool.query(
      "select id from tenant_users where tenant_id = $1 and role = 'admin' and status = 'active'",
      [tenant.tenantId],
    );
    assert.equal(admins.rows.length, 1, `第 ${round + 1} 轮：${JSON.stringify(results.map((r) => r.status))}`);
    // 恢复成两个管理员再来一轮
    const survivorToken = admins.rows[0].id === tenant.adminId ? tenant.adminToken : second.body.access_token;
    const demotedId = admins.rows[0].id === tenant.adminId ? secondId : tenant.adminId;
    const restore = await api.call("PUT", `/tenant/v1/users/${demotedId}`, { token: survivorToken, body: { name: "恢复", role: "admin", status: "active" } });
    assert.equal(restore.status, 200);
  }
});

test("状态：停用后可以重新启用（要重新登录）；不能改回待激活；没激活过的不能直接启用", async () => {
  const finance = staff.get("finance")!;
  const url = `/tenant/v1/users/${finance.id}`;
  const body = { name: "财务", role: "finance" };
  assert.equal((await api.call("PUT", url, { token: tenant.adminToken, body: { ...body, status: "disabled" } })).body.status, "disabled");
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: finance.token })).status, 401);
  assert.equal((await api.call("DELETE", url, { token: tenant.adminToken })).status, 204, "重复停用不报错");

  const toInvited = await api.call("PUT", url, { token: tenant.adminToken, body: { ...body, status: "invited" } });
  assert.equal(toInvited.status, 409);
  assert.equal(toInvited.body.error.code, "STATUS_INVITED_IS_NOT_SETTABLE");

  assert.equal((await api.call("PUT", url, { token: tenant.adminToken, body: { ...body, status: "active" } })).body.status, "active");
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: finance.token })).status, 401, "旧令牌不会复活");
  assert.equal((await api.call("POST", "/tenant/v1/auth/login", { body: { email: "finance@a.test", password: TEST_PASSWORD } })).status, 200);

  const pending = await api.call("POST", "/tenant/v1/users", { token: tenant.adminToken, body: { email: "pending@a.test", name: "待激活", role: "dispatch" } });
  const pendingUrl = `/tenant/v1/users/${pending.body.user.id}`;
  const keep = await api.call("PUT", pendingUrl, { token: tenant.adminToken, body: { name: "改个名", role: "finance", status: "invited" } });
  assert.equal(keep.status, 200, "待激活的账号可以改姓名和角色");
  const activate = await api.call("PUT", pendingUrl, { token: tenant.adminToken, body: { name: "x", role: "dispatch", status: "active" } });
  assert.equal(activate.status, 409);
  assert.equal(activate.body.error.code, "ACCOUNT_NOT_ACTIVATED");
  const login = await api.call("POST", "/tenant/v1/auth/login", { body: { email: "pending@a.test", password: TEST_PASSWORD } });
  assert.equal(login.status, 401);
});

test("修改时的参数校验和不存在的账号", async () => {
  const dispatch = staff.get("dispatch")!;
  const bad = await api.call("PUT", `/tenant/v1/users/${dispatch.id}`, { token: tenant.adminToken, body: { name: "x", role: "boss", status: "gone" } });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body.error.details.issues.map((i: any) => i.path), ["/role", "/status"]);
  for (const id of [MISSING, "abc"]) {
    const res = await api.call("PUT", `/tenant/v1/users/${id}`, { token: tenant.adminToken, body: { name: "x", role: "dispatch", status: "active" } });
    assert.equal(res.status, 404);
  }
});
