/**
 * 平台侧：角色权限的强制执行、平台账号管理、租户管理、集成详情。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { PLATFORM_ACTIONS, PLATFORM_ROLES, type PlatformAction, type PlatformRole, platformRoleCan } from "@nozomi/domain";
import { TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";
import { FAKE_SECRETS, leakedSecrets } from "./testing/fixtures.ts";

let api: TestApi;
let rootToken: string;
const tokens = new Map<PlatformRole, string>();
const ids = new Map<PlatformRole, string>();

async function addStaff(email: string, role: PlatformRole): Promise<{ id: string; token: string }> {
  const invited = await api.call("POST", "/platform/v1/staff", { token: rootToken, body: { email, name: `员工-${role}`, role } });
  assert.equal(invited.status, 201, invited.text);
  await api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.body.invite.token, password: TEST_PASSWORD } });
  const login = await api.call("POST", "/platform/v1/auth/login", { body: { email, password: TEST_PASSWORD } });
  assert.equal(login.status, 200, login.text);
  return { id: invited.body.user.id, token: login.body.access_token };
}

before(async () => {
  api = await createTestApi();
  rootToken = await api.superAdminToken("root@platform.test");
  tokens.set("super_admin", rootToken);
  for (const { key } of PLATFORM_ROLES) {
    if (key === "super_admin") continue;
    const staff = await addStaff(`${key.replace("_", "-")}@platform.test`, key);
    tokens.set(key, staff.token);
    ids.set(key, staff.id);
  }
});
after(() => api.close());

/** 每个需要权限的平台接口，和它要求的操作。用不存在的编号调用：有权限时得到 404 / 校验错误，没权限时一定是 403。 */
const MISSING = "99999999-9999-4999-8999-999999999999";
const MASTER_PATHS = ["cities", "places", "vehicle-groups", "addons"];
/** 不要求特定操作、任何已登录的平台员工都能调的接口（内容按角色裁剪，各自有测试）。 */
const ANY_STAFF = ["GET /platform/v1/dashboard/summary"];
const HOLIDAY = "/platform/v1/holidays/JP/2027-01-01";
const PROTECTED: { method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE"; url: string; action: PlatformAction; body?: unknown }[] = [
  // 节假日日历是平台主数据（ADR 0018）：看用 master_data.read，登记、修改、删除用 master_data.manage
  { method: "GET", url: "/platform/v1/holidays", action: "master_data.read" },
  { method: "PUT", url: HOLIDAY, action: "master_data.manage", body: {} },
  { method: "DELETE", url: "/platform/v1/holidays/JP/2027-12-31", action: "master_data.manage" },
  { method: "GET", url: "/platform/v1/staff", action: "staff.read" },
  { method: "POST", url: "/platform/v1/staff", action: "staff.manage", body: {} },
  { method: "POST", url: `/platform/v1/staff/${MISSING}/disable`, action: "staff.manage" },
  { method: "POST", url: `/platform/v1/staff/${MISSING}/enable`, action: "staff.manage" },
  { method: "POST", url: `/platform/v1/staff/${MISSING}/password-reset`, action: "staff.manage" },
  { method: "GET", url: "/platform/v1/tenants", action: "tenant.read" },
  { method: "GET", url: `/platform/v1/tenants/${MISSING}`, action: "tenant.read" },
  { method: "POST", url: "/platform/v1/tenants", action: "tenant.create", body: {} },
  { method: "POST", url: `/platform/v1/tenants/${MISSING}/admin-invites`, action: "tenant.create", body: {} },
  { method: "POST", url: `/platform/v1/tenants/${MISSING}/admin-password-resets`, action: "tenant.create", body: {} },
  { method: "POST", url: `/platform/v1/tenants/${MISSING}/suspend`, action: "tenant.change_status" },
  { method: "POST", url: `/platform/v1/tenants/${MISSING}/resume`, action: "tenant.change_status" },
  { method: "GET", url: "/platform/v1/audit-logs", action: "audit_log.read" },
  { method: "GET", url: "/platform/v1/integrations", action: "integration.read" },
  ...MASTER_PATHS.flatMap((path) => [
    { method: "GET", url: `/platform/v1/master/${path}`, action: "master_data.read" } as const,
    { method: "GET", url: `/platform/v1/master/${path}/${MISSING}`, action: "master_data.read" } as const,
    { method: "POST", url: `/platform/v1/master/${path}`, action: "master_data.manage", body: {} } as const,
    { method: "PATCH", url: `/platform/v1/master/${path}/${MISSING}`, action: "master_data.manage", body: {} } as const,
    { method: "POST", url: `/platform/v1/master/${path}/${MISSING}/disable`, action: "master_data.manage" } as const,
    { method: "POST", url: `/platform/v1/master/${path}/${MISSING}/enable`, action: "master_data.manage" } as const,
  ]),
];

test("权限矩阵：10 个平台角色 × 每个受保护的接口，没有对应操作的一律 403，有的不是 403", async () => {
  for (const { key: role } of PLATFORM_ROLES) {
    for (const route of PROTECTED) {
      const res = await api.call(route.method, route.url, { token: tokens.get(role)!, body: route.body });
      const label = `${role} → ${route.method} ${route.url}`;
      if (platformRoleCan(role, route.action)) {
        assert.notEqual(res.status, 403, label);
        assert.notEqual(res.status, 401, label);
      } else {
        assert.equal(res.status, 403, label);
        assert.deepEqual(res.body.error, {
          code: "FORBIDDEN",
          message: "当前角色没有这个操作的权限",
          details: { required: route.action },
        });
      }
    }
  }
});

test("权限矩阵覆盖了全部平台操作，以及登录接口之外的全部平台接口", () => {
  assert.deepEqual([...new Set(PROTECTED.map((r) => r.action))].sort(), [...PLATFORM_ACTIONS].sort());
  const registered = api.app.registeredRoutes
    .filter((r) => r.method !== "HEAD" && r.path.startsWith("/platform/v1/") && !r.path.includes("/auth/"))
    .map((r) => `${r.method} ${r.path}`)
    .sort();
  const tested = [...PROTECTED.map((r) => `${r.method} ${r.url.replace(MISSING, ":id").replace(/\/holidays\/[A-Z]{2}\/[\d-]+$/, "/holidays/:country/:date")}`), ...ANY_STAFF].sort();
  assert.deepEqual(tested, registered);
});

test("首页统计：每个角色都能调；租户数量只给有 tenant.read 的角色，其余角色拿到 null；没登录 401", async () => {
  for (const { key: role } of PLATFORM_ROLES) {
    const res = await api.call("GET", "/platform/v1/dashboard/summary", { token: tokens.get(role)! });
    assert.equal(res.status, 200, role);
    assert.equal(res.body.tenants === null, !platformRoleCan(role, "tenant.read"), role);
    assert.notEqual(res.body.master_data, null, role);
  }
  assert.equal((await api.call("GET", "/platform/v1/dashboard/summary")).status, 401);
});

test("me：返回当前账号和它的操作清单；每个角色都能调", async () => {
  for (const { key: role } of PLATFORM_ROLES) {
    const res = await api.call("GET", "/platform/v1/auth/me", { token: tokens.get(role)! });
    assert.equal(res.status, 200, role);
    assert.equal(res.body.user.role, role);
    assert.deepEqual(res.body.permissions, PLATFORM_ACTIONS.filter((action) => platformRoleCan(role, action)));
    assert.deepEqual(Object.keys(res.body.user).sort(), ["created_at", "email", "id", "name", "role", "status", "updated_at"]);
  }
});

test("运营能创建和暂停租户；只读能看不能建", async () => {
  const created = await api.call("POST", "/platform/v1/tenants", {
    token: tokens.get("operations")!,
    body: { name: "运营建的车队", admin: { email: "admin@ops-fleet.test", name: "管理员" } },
  });
  assert.equal(created.status, 201, created.text);
  const id = created.body.tenant.id;
  const seen = await api.call("GET", `/platform/v1/tenants/${id}`, { token: tokens.get("readonly")! });
  assert.equal(seen.status, 200);
  assert.deepEqual(seen.body, created.body.tenant);
  assert.equal((await api.call("POST", `/platform/v1/tenants/${id}/suspend`, { token: tokens.get("readonly")! })).status, 403);
  assert.equal((await api.call("POST", `/platform/v1/tenants/${id}/suspend`, { token: tokens.get("tenant_onboarding")! })).status, 200);
});

test("创建租户：参数校验；管理员邮箱已被别的租户使用时 409，并且不会留下半个租户", async () => {
  const bad = await api.call("POST", "/platform/v1/tenants", { token: rootToken, body: { name: "  ", admin: { email: "x", name: "" } } });
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body.error.details.issues.map((i: any) => i.path), ["/name", "/admin/email", "/admin/name"]);

  const first = await api.call("POST", "/platform/v1/tenants", {
    token: rootToken,
    body: { name: "先来的车队", admin: { email: "dup@fleet.test", name: "管理员" } },
  });
  assert.equal(first.status, 201);
  const count = async (): Promise<number> => (await api.db.owner.query("select count(*)::int as n from tenants")).rows[0].n;
  const before = await count();
  const second = await api.call("POST", "/platform/v1/tenants", {
    token: rootToken,
    body: { name: "后到的车队", admin: { email: "DUP@fleet.test", name: "管理员" } },
  });
  assert.equal(second.status, 409);
  assert.equal(second.body.error.code, "EMAIL_TAKEN");
  assert.equal(await count(), before, "失败的创建不应该留下租户");
});

test("租户列表：游标分页翻完全部，不重不漏，顺序稳定", async () => {
  for (let i = 0; i < 5; i++) {
    api.clock.advance(1_000);
    const res = await api.call("POST", "/platform/v1/tenants", {
      token: rootToken,
      body: { name: `分页车队${i}`, admin: { email: `admin@page-${i}.test`, name: "管理员" } },
    });
    assert.equal(res.status, 201);
  }
  const all = (await api.call("GET", "/platform/v1/tenants?limit=200", { token: rootToken })).body.items.map((t: any) => t.id);
  assert.ok(all.length >= 7);
  const paged: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const res = await api.call("GET", `/platform/v1/tenants?limit=3${cursor ? `&cursor=${cursor}` : ""}`, { token: rootToken });
    assert.equal(res.status, 200);
    assert.ok(res.body.items.length <= 3);
    paged.push(...res.body.items.map((t: any) => t.id));
    cursor = res.body.next_cursor;
    pages++;
  } while (cursor);
  assert.deepEqual(paged, all);
  assert.equal(pages, Math.ceil(all.length / 3));
  const bad = await api.call("GET", "/platform/v1/tenants?cursor=garbage", { token: rootToken });
  assert.equal(bad.status, 400);
  assert.equal((await api.call("GET", "/platform/v1/tenants?limit=201", { token: rootToken })).status, 400);
});

test("不存在的租户、格式不对的编号：404", async () => {
  for (const id of [MISSING, "not-a-uuid", "1"]) {
    for (const [method, suffix] of [["GET", ""], ["POST", "/suspend"], ["POST", "/resume"]] as const) {
      const res = await api.call(method, `/platform/v1/tenants/${id}${suffix}`, { token: rootToken });
      assert.equal(res.status, 404, `${method} ${id}${suffix}`);
      assert.equal(res.body.error.code, "NOT_FOUND");
    }
  }
  const invite = await api.call("POST", `/platform/v1/tenants/${MISSING}/admin-invites`, {
    token: rootToken,
    body: { email: "x@nowhere.test", name: "x" },
  });
  assert.equal(invite.status, 404);
});

test("补发管理员邀请：第一个邀请过期后，平台可以重发；也可以再加一个管理员", async () => {
  const created = await api.call("POST", "/platform/v1/tenants", {
    token: rootToken,
    body: { name: "邀请过期的车队", admin: { email: "first@expired.test", name: "第一个管理员" } },
  });
  const tenantId = created.body.tenant.id;
  const reissued = await api.call("POST", `/platform/v1/tenants/${tenantId}/admin-invites`, {
    token: tokens.get("tenant_onboarding")!,
    body: { email: "first@expired.test", name: "第一个管理员" },
  });
  assert.equal(reissued.status, 201, reissued.text);
  assert.equal(reissued.body.user.id, created.body.admin_user.id);
  assert.equal((await api.call("POST", "/tenant/v1/auth/accept-invite", { body: { token: created.body.invite.token, password: TEST_PASSWORD } })).status, 400);
  assert.equal((await api.call("POST", "/tenant/v1/auth/accept-invite", { body: { token: reissued.body.invite.token, password: TEST_PASSWORD } })).status, 200);

  const second = await api.call("POST", `/platform/v1/tenants/${tenantId}/admin-invites`, {
    token: rootToken,
    body: { email: "second@expired.test", name: "第二个管理员" },
  });
  assert.equal(second.status, 201);
  assert.equal(second.body.user.role, "admin");
  const tenantOf = await api.db.owner.query("select tenant_id from tenant_users where id = $1", [second.body.user.id]);
  assert.equal(tenantOf.rows[0].tenant_id, tenantId);

  const taken = await api.call("POST", `/platform/v1/tenants/${tenantId}/admin-invites`, {
    token: rootToken,
    body: { email: "first@expired.test", name: "已经激活了" },
  });
  assert.equal(taken.status, 409);
});

test("平台账号：创建时校验角色和邮箱；邮箱已激活时 409；列表能看到全部账号", async () => {
  const bad = await api.call("POST", "/platform/v1/staff", { token: rootToken, body: { email: "a@b.test", name: "x", role: "admin" } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.details.issues[0].path, "/role");
  const taken = await api.call("POST", "/platform/v1/staff", {
    token: rootToken,
    body: { email: "Root@Platform.test", name: "重复", role: "readonly" },
  });
  assert.equal(taken.status, 409);
  assert.equal(taken.body.error.code, "EMAIL_TAKEN");
  const list = await api.call("GET", "/platform/v1/staff?limit=200", { token: rootToken });
  assert.equal(list.status, 200);
  assert.equal(list.body.items.length, PLATFORM_ROLES.length);
  assert.ok(list.body.items.some((u: any) => u.email === "root@platform.test" && u.role === "super_admin"));
  assert.ok(!list.text.includes("password") && !list.text.includes("scrypt") && !list.text.includes("invite"));
});

test("超级管理员至少保留一个：唯一的超级管理员不能停用自己；有第二个之后可以", async () => {
  const me = await api.call("GET", "/platform/v1/auth/me", { token: rootToken });
  const rootId = me.body.user.id;
  const refused = await api.call("POST", `/platform/v1/staff/${rootId}/disable`, { token: rootToken });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error.code, "LAST_ADMIN_REQUIRED");
  assert.equal((await api.call("GET", "/platform/v1/auth/me", { token: rootToken })).status, 200);

  const second = await addStaff("root2@platform.test", "super_admin");
  const ok = await api.call("POST", `/platform/v1/staff/${rootId}/disable`, { token: second.token });
  assert.equal(ok.status, 200);
  assert.equal((await api.call("GET", "/platform/v1/auth/me", { token: rootToken })).status, 401);
  const last = await api.call("POST", `/platform/v1/staff/${second.id}/disable`, { token: second.token });
  assert.equal(last.status, 409, "现在第二个成了唯一的超级管理员");
  assert.equal((await api.call("POST", `/platform/v1/staff/${rootId}/enable`, { token: second.token })).status, 200);
  rootToken = (await api.call("POST", "/platform/v1/auth/login", { body: { email: "root@platform.test", password: TEST_PASSWORD } })).body.access_token;
});

test("两个超级管理员同时停用对方：只有一个成功，不会一个都不剩", async () => {
  const other = await api.call("POST", "/platform/v1/auth/login", { body: { email: "root2@platform.test", password: TEST_PASSWORD } });
  const rootId = (await api.call("GET", "/platform/v1/auth/me", { token: rootToken })).body.user.id;
  const otherId = other.body.user.id;
  const results = await Promise.all([
    api.call("POST", `/platform/v1/staff/${otherId}/disable`, { token: rootToken }),
    api.call("POST", `/platform/v1/staff/${rootId}/disable`, { token: other.body.access_token }),
  ]);
  const statuses = results.map((r) => r.status).sort();
  assert.ok(statuses.includes(200), JSON.stringify(statuses));
  const remaining = await api.db.owner.query("select count(*)::int as n from platform_users where role = 'super_admin' and status = 'active'");
  assert.equal(remaining.rows[0].n, 1);
  // 恢复现场：让 root 继续可用
  const survivor = (await api.db.owner.query("select email from platform_users where role = 'super_admin' and status = 'active'")).rows[0].email;
  const survivorToken = (await api.call("POST", "/platform/v1/auth/login", { body: { email: survivor, password: TEST_PASSWORD } })).body.access_token;
  await api.call("POST", `/platform/v1/staff/${rootId}/enable`, { token: survivorToken });
  rootToken = (await api.call("POST", "/platform/v1/auth/login", { body: { email: "root@platform.test", password: TEST_PASSWORD } })).body.access_token;
});

test("启用：从未激活过的账号不能直接启用（要重新邀请）；重复停用 / 启用直接返回当前状态", async () => {
  const invited = await api.call("POST", "/platform/v1/staff", { token: rootToken, body: { email: "never@platform.test", name: "没激活", role: "readonly" } });
  const id = invited.body.user.id;
  assert.equal((await api.call("POST", `/platform/v1/staff/${id}/enable`, { token: rootToken })).status, 409);
  assert.equal((await api.call("POST", `/platform/v1/staff/${id}/disable`, { token: rootToken })).body.status, "disabled");
  assert.equal((await api.call("POST", `/platform/v1/staff/${id}/disable`, { token: rootToken })).status, 200);
  const enable = await api.call("POST", `/platform/v1/staff/${id}/enable`, { token: rootToken });
  assert.equal(enable.status, 409);
  assert.equal(enable.body.error.code, "ACCOUNT_NOT_ACTIVATED");
  const reinvited = await api.call("POST", "/platform/v1/staff", { token: rootToken, body: { email: "never@platform.test", name: "没激活", role: "readonly" } });
  assert.equal(reinvited.status, 201);
  assert.equal(reinvited.body.user.status, "invited");
});

test("集成详情：技术和超级管理员能看到脱敏说明，里面没有任何密钥原文；公开的 /health 没有 detail", async () => {
  for (const role of ["tech", "super_admin"] as const) {
    const token = role === "super_admin" ? rootToken : tokens.get(role)!;
    const res = await api.call("GET", "/platform/v1/integrations", { token });
    assert.equal(res.status, 200, role);
    assert.deepEqual(res.body.items.map((i: any) => i.key), ["database", "auth", "stripe", "googleMaps", "fx"]);
    for (const item of res.body.items) assert.deepEqual(Object.keys(item), ["key", "label", "state", "detail"]);
    const byKey = new Map<string, any>(res.body.items.map((i: any) => [i.key, i]));
    assert.match(byKey.get("database").detail, /:•••@/);
    assert.equal(byKey.get("auth").detail, `${FAKE_SECRETS.authJwtSecret.length} 个字符`);
    assert.match(byKey.get("stripe").detail, /^测试模式 · sk_test…/);
    assert.deepEqual(leakedSecrets(res.text), []);
    assert.ok(!res.text.includes(`:${new URL(api.db.url).password}@`));
  }
  const health = await api.call("GET", "/health");
  assert.equal(health.status, 200);
  for (const item of health.body.integrations) assert.deepEqual(Object.keys(item), ["key", "label", "state"]);
  assert.ok(!health.text.includes("detail") && !health.text.includes("sk_test") && !health.text.includes("•"));
});
