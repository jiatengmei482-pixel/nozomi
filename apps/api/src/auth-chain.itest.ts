/**
 * M0-09 要走通的主链路：命令行建平台管理员 → 平台登录 → 创建租户 → 租户管理员接受邀请 → 租户登录 → 访问自己的资源。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";

let api: TestApi;
before(async () => {
  api = await createTestApi();
});
after(() => api.close());

test("空库里没有任何账号和租户（不预置数据）", async () => {
  for (const table of ["platform_users", "tenants", "tenant_users", "platform_sessions", "tenant_sessions", "audit_logs"]) {
    const result = await api.db.pool.query(`select count(*)::int as n from ${table}`);
    assert.equal(result.rows[0].n, 0, table);
  }
});

test("主链路：建管理员 → 平台登录 → 建租户 → 接受邀请 → 租户登录 → 看自己的账号列表", async () => {
  const platformToken = await api.superAdminToken("owner@platform.test");

  const me = await api.call("GET", "/platform/v1/auth/me", { token: platformToken });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.email, "owner@platform.test");
  assert.equal(me.body.user.role, "super_admin");
  assert.ok(me.body.permissions.includes("tenant.create"));

  const created = await api.call("POST", "/platform/v1/tenants", {
    token: platformToken,
    body: { name: "测试车队甲", admin: { email: "Admin@Fleet-A.test", name: "甲管理员" } },
  });
  assert.equal(created.status, 201, created.text);
  assert.equal(created.body.tenant.status, "active");
  assert.deepEqual(
    { email: created.body.admin_user.email, role: created.body.admin_user.role, status: created.body.admin_user.status },
    { email: "admin@fleet-a.test", role: "admin", status: "invited" },
  );
  assert.match(created.body.invite.token, /^nzi_[A-Za-z0-9_-]{43}$/);

  const beforeAccept = await api.call("POST", "/tenant/v1/auth/login", {
    body: { email: "admin@fleet-a.test", password: TEST_PASSWORD },
  });
  assert.equal(beforeAccept.status, 401, "接受邀请之前不能登录");

  const accepted = await api.call("POST", "/tenant/v1/auth/accept-invite", {
    body: { token: created.body.invite.token, password: TEST_PASSWORD },
  });
  assert.equal(accepted.status, 200, accepted.text);
  assert.equal(accepted.body.user.status, "active");

  const login = await api.call("POST", "/tenant/v1/auth/login", {
    body: { email: "ADMIN@fleet-a.test", password: TEST_PASSWORD },
  });
  assert.equal(login.status, 200, login.text);
  assert.equal(login.body.token_type, "Bearer");
  assert.equal(login.body.tenant.id, created.body.tenant.id);
  assert.equal(login.headers["cache-control"], "no-store");

  const tenantMe = await api.call("GET", "/tenant/v1/auth/me", { token: login.body.access_token });
  assert.equal(tenantMe.status, 200);
  assert.equal(tenantMe.body.tenant.name, "测试车队甲");
  assert.deepEqual(tenantMe.body.permissions, ["user.read", "user.manage", "audit_log.read"]);

  const users = await api.call("GET", "/tenant/v1/users", { token: login.body.access_token });
  assert.equal(users.status, 200);
  assert.deepEqual(
    users.body.items.map((u: any) => u.email),
    ["admin@fleet-a.test"],
  );
  assert.equal(users.body.next_cursor, null);
});
