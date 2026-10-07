/**
 * 验收标准 3：租户 A 读不到、改不了租户 B 的任何数据。
 * 逐个覆盖 /tenant/v1 的每个接口；最后一个测试会核对「这里覆盖的接口清单」和实际注册的租户接口一致，
 * 以后新增租户接口而没有在这里补跨租户测试，测试会失败。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { signAccessToken, verifyAccessToken } from "./auth/token.ts";
import { TEST_PASSWORD, type TenantFixture, type TestApi, addTenantUser, createTestApi } from "./testing/api.ts";
import { FAKE_SECRETS } from "./testing/fixtures.ts";

let api: TestApi;
let platformToken: string;
let a: TenantFixture;
let b: TenantFixture;
let bDispatcher: { id: string; token: string };

/** 本文件里做过跨租户验证的接口；与实际注册的租户接口核对。 */
const covered = new Set<string>();
const cover = (route: string): void => void covered.add(route);

before(async () => {
  api = await createTestApi();
  platformToken = await api.superAdminToken();
  a = await api.tenantWithAdmin(platformToken, "车队甲", "admin@a.test");
  b = await api.tenantWithAdmin(platformToken, "车队乙", "admin@b.test");
  bDispatcher = await addTenantUser(api, b.adminToken, "dispatch@b.test", "dispatch");
});
after(() => api.close());

async function userRow(id: string): Promise<Record<string, unknown>> {
  const result = await api.db.pool.query(
    "select tenant_id, email, name, role, status, password_hash is not null as has_password from tenant_users where id = $1",
    [id],
  );
  return result.rows[0];
}

test("GET /tenant/v1/users：只列出自己租户的账号，翻到底也没有别的租户的", async () => {
  cover("GET /tenant/v1/users");
  const emails: string[] = [];
  let cursor: string | null = null;
  do {
    const res = await api.call("GET", `/tenant/v1/users?limit=1${cursor ? `&cursor=${cursor}` : ""}`, { token: a.adminToken });
    assert.equal(res.status, 200);
    emails.push(...res.body.items.map((u: any) => u.email));
    cursor = res.body.next_cursor;
  } while (cursor);
  assert.deepEqual(emails, ["admin@a.test"]);
  assert.ok(!JSON.stringify(emails).includes("b.test"));
});

test("GET /tenant/v1/users：查询串里带别的租户的 tenant_id 不生效", async () => {
  const res = await api.call("GET", `/tenant/v1/users?tenant_id=${b.tenantId}`, { token: a.adminToken });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.items.map((u: any) => u.email), ["admin@a.test"]);
});

test("GET /tenant/v1/users：拿租户乙的翻页游标到租户甲用，也翻不出乙的数据", async () => {
  const bPage = await api.call("GET", "/tenant/v1/users?limit=1", { token: b.adminToken });
  assert.ok(bPage.body.next_cursor, "租户乙有两个账号，应该有下一页");
  const res = await api.call("GET", `/tenant/v1/users?cursor=${bPage.body.next_cursor}`, { token: a.adminToken });
  assert.equal(res.status, 200);
  assert.ok(res.body.items.every((u: any) => u.email.endsWith("@a.test")));
});

test("GET /tenant/v1/auth/me：返回的是令牌所属的租户和账号", async () => {
  cover("GET /tenant/v1/auth/me");
  const res = await api.call("GET", `/tenant/v1/auth/me?tenant_id=${b.tenantId}`, { token: a.adminToken });
  assert.equal(res.status, 200);
  assert.equal(res.body.tenant.id, a.tenantId);
  assert.equal(res.body.user.id, a.adminId);
  assert.ok(!res.text.includes(b.tenantId));
});

test("PUT /tenant/v1/users/{id}：改租户乙的账号返回 404，乙的数据原样不动", async () => {
  cover("PUT /tenant/v1/users/:id");
  const before = await userRow(bDispatcher.id);
  const res = await api.call("PUT", `/tenant/v1/users/${bDispatcher.id}`, {
    token: a.adminToken,
    body: { name: "被甲改了", role: "admin", status: "disabled", tenant_id: b.tenantId },
  });
  assert.equal(res.status, 404);
  assert.equal(res.body.error.code, "NOT_FOUND");
  assert.deepEqual(await userRow(bDispatcher.id), before);
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: bDispatcher.token })).status, 200);
});

test("PUT /tenant/v1/users/{id}：别的租户的账号和根本不存在的账号，返回完全一样（不暴露是否存在）", async () => {
  const body = { name: "x", role: "readonly", status: "active" };
  const foreign = await api.call("PUT", `/tenant/v1/users/${bDispatcher.id}`, { token: a.adminToken, body });
  const missing = await api.call("PUT", "/tenant/v1/users/99999999-9999-4999-8999-999999999999", { token: a.adminToken, body });
  assert.equal(foreign.status, 404);
  assert.equal(foreign.text, missing.text);
});

test("DELETE /tenant/v1/users/{id}：停用租户乙的账号返回 404，乙的账号照常能用", async () => {
  cover("DELETE /tenant/v1/users/:id");
  const res = await api.call("DELETE", `/tenant/v1/users/${bDispatcher.id}`, { token: a.adminToken });
  assert.equal(res.status, 404);
  assert.equal((await userRow(bDispatcher.id))["status"], "active");
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: bDispatcher.token })).status, 200);
  const missing = await api.call("DELETE", "/tenant/v1/users/99999999-9999-4999-8999-999999999999", { token: a.adminToken });
  assert.equal(res.text, missing.text);
});

test("POST /tenant/v1/users：请求体和查询串里的 tenant_id 不生效，账号建在令牌所属的租户", async () => {
  cover("POST /tenant/v1/users");
  const res = await api.call("POST", `/tenant/v1/users?tenant_id=${b.tenantId}`, {
    token: a.adminToken,
    body: { email: "new@a.test", name: "新同事", role: "dispatch", tenant_id: b.tenantId, tenantId: b.tenantId },
  });
  assert.equal(res.status, 201, res.text);
  assert.equal((await userRow(res.body.user.id))["tenant_id"], a.tenantId);
  const bUsers = await api.call("GET", "/tenant/v1/users", { token: b.adminToken });
  assert.ok(!bUsers.body.items.some((u: any) => u.email === "new@a.test"));
});

test("POST /tenant/v1/users：邀请一个已经属于租户乙的邮箱，只说「已被使用」，不动乙的账号、不透露它在哪个租户", async () => {
  const before = await userRow(bDispatcher.id);
  const res = await api.call("POST", "/tenant/v1/users", {
    token: a.adminToken,
    body: { email: "dispatch@b.test", name: "挖人", role: "admin" },
  });
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, "EMAIL_TAKEN");
  assert.ok(!res.text.includes(b.tenantId) && !res.text.includes(bDispatcher.id) && !res.text.includes("车队乙"));
  assert.deepEqual(await userRow(bDispatcher.id), before);
});

test("POST /tenant/v1/users：租户乙有一个还没激活的邀请，租户甲用同一个邮箱再邀请，抢不走也重置不了它", async () => {
  const pending = await api.call("POST", "/tenant/v1/users", {
    token: b.adminToken,
    body: { email: "pending@b.test", name: "乙的新人", role: "finance" },
  });
  assert.equal(pending.status, 201);
  const hijack = await api.call("POST", "/tenant/v1/users", {
    token: a.adminToken,
    body: { email: "pending@b.test", name: "甲的人", role: "admin" },
  });
  assert.equal(hijack.status, 409);
  const accepted = await api.call("POST", "/tenant/v1/auth/accept-invite", {
    body: { token: pending.body.invite.token, password: TEST_PASSWORD },
  });
  assert.equal(accepted.status, 200, "乙发出的邀请应该仍然有效");
  assert.deepEqual(
    { tenant_id: (await userRow(pending.body.user.id))["tenant_id"], role: accepted.body.user.role },
    { tenant_id: b.tenantId, role: "finance" },
  );
});

test("POST /tenant/v1/auth/login：登录到的是邮箱所属的租户，请求体里的 tenant_id 不生效", async () => {
  cover("POST /tenant/v1/auth/login");
  const res = await api.call("POST", "/tenant/v1/auth/login", {
    body: { email: "admin@a.test", password: TEST_PASSWORD, tenant_id: b.tenantId },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.tenant.id, a.tenantId);
  const claims = verifyAccessToken(FAKE_SECRETS.authJwtSecret, "tenant", res.body.access_token, api.clock.now());
  assert.equal(claims?.tid, a.tenantId);
});

test("POST /tenant/v1/auth/accept-invite：激活的是令牌对应的那个账号，请求体里的 tenant_id 不生效", async () => {
  cover("POST /tenant/v1/auth/accept-invite");
  const invited = await api.call("POST", "/tenant/v1/users", {
    token: a.adminToken,
    body: { email: "invitee@a.test", name: "受邀人", role: "readonly" },
  });
  const res = await api.call("POST", "/tenant/v1/auth/accept-invite", {
    body: { token: invited.body.invite.token, password: TEST_PASSWORD, tenant_id: b.tenantId },
  });
  assert.equal(res.status, 200);
  assert.equal((await userRow(invited.body.user.id))["tenant_id"], a.tenantId);
});

test("POST /tenant/v1/auth/logout：只结束自己的会话，别的租户的会话不受影响", async () => {
  cover("POST /tenant/v1/auth/logout");
  const extra = await api.call("POST", "/tenant/v1/auth/login", { body: { email: "admin@a.test", password: TEST_PASSWORD } });
  const res = await api.call("POST", `/tenant/v1/auth/logout?tenant_id=${b.tenantId}`, { token: extra.body.access_token });
  assert.equal(res.status, 204);
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: extra.body.access_token })).status, 401);
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: b.adminToken })).status, 200);
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: a.adminToken })).status, 200);
});

test("POST /tenant/v1/auth/change-password：只改自己的密码，只让自己的其他会话失效；别的租户的密码和会话不受影响", async () => {
  cover("POST /tenant/v1/auth/change-password");
  const other = await api.call("POST", "/tenant/v1/auth/login", { body: { email: "admin@a.test", password: TEST_PASSWORD } });
  const bHashBefore = (await api.db.pool.query("select password_hash from tenant_users where id = $1", [b.adminId])).rows[0].password_hash;
  const res = await api.call("POST", `/tenant/v1/auth/change-password?tenant_id=${b.tenantId}`, {
    token: a.adminToken,
    body: { current_password: TEST_PASSWORD, new_password: "Changed-Harbor-2027", tenant_id: b.tenantId, user_id: b.adminId },
  });
  assert.equal(res.status, 204, res.text);
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: other.body.access_token })).status, 401, "自己的其他会话应失效");
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: a.adminToken })).status, 200, "当前会话保留");
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: b.adminToken })).status, 200, "租户乙的会话不受影响");
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: bDispatcher.token })).status, 200);
  const bHashAfter = (await api.db.pool.query("select password_hash from tenant_users where id = $1", [b.adminId])).rows[0].password_hash;
  assert.equal(bHashAfter, bHashBefore);
  // 改回去，后面的测试还用统一的密码
  const back = await api.call("POST", "/tenant/v1/auth/change-password", { token: a.adminToken, body: { current_password: "Changed-Harbor-2027", new_password: TEST_PASSWORD } });
  assert.equal(back.status, 204, back.text);
});

test("POST /tenant/v1/users/{id}/password-reset：给租户乙的账号发重置令牌返回 404（与不存在的账号一样），乙的账号上没有留下令牌", async () => {
  cover("POST /tenant/v1/users/:id/password-reset");
  const foreign = await api.call("POST", `/tenant/v1/users/${bDispatcher.id}/password-reset?tenant_id=${b.tenantId}`, { token: a.adminToken, body: { tenant_id: b.tenantId } });
  const missing = await api.call("POST", "/tenant/v1/users/99999999-9999-4999-8999-999999999999/password-reset", { token: a.adminToken });
  assert.equal(foreign.status, 404);
  assert.equal(foreign.text, missing.text);
  const row = (await api.db.pool.query("select reset_token_hash from tenant_users where id = $1", [bDispatcher.id])).rows[0];
  assert.equal(row.reset_token_hash, null);
});

test("POST /tenant/v1/auth/reset-password：令牌只对发给它的那个租户的那个账号有效；把令牌里的租户换成乙、或请求体里带乙的 tenant_id，都改不了乙的任何密码", async () => {
  cover("POST /tenant/v1/auth/reset-password");
  const target = await addTenantUser(api, a.adminToken, "reset-target@a.test", "readonly");
  const issued = await api.call("POST", `/tenant/v1/users/${target.id}/password-reset`, { token: a.adminToken });
  assert.equal(issued.status, 201, issued.text);
  const token = issued.body.reset.token as string;
  const hashes = async (): Promise<unknown> =>
    (await api.db.pool.query("select id, password_hash from tenant_users where tenant_id = $1 order by id", [b.tenantId])).rows;
  const bBefore = await hashes();

  const swapped = `nzr_${b.tenantId.replaceAll("-", "")}.${token.split(".")[1]}`;
  const forged = await api.call("POST", "/tenant/v1/auth/reset-password", { body: { token: swapped, password: "Forged-Harbor-2027" } });
  assert.equal(forged.status, 400);
  assert.equal(forged.body.error.code, "RESET_TOKEN_INVALID");
  assert.deepEqual(await hashes(), bBefore);

  const ok = await api.call("POST", "/tenant/v1/auth/reset-password", { body: { token, password: "Fresh-Harbor-2027", tenant_id: b.tenantId, user_id: b.adminId } });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.user.id, target.id);
  assert.deepEqual(await hashes(), bBefore, "租户乙的密码不应有任何变化");
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: b.adminToken })).status, 200);
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: target.token })).status, 401, "被重置的账号自己的旧会话失效");
});

test("GET /tenant/v1/audit-logs：只有自己租户的记录；翻到底、带别的租户的 tenant_id、用别的租户的对象编号筛选，都看不到乙的任何内容", async () => {
  cover("GET /tenant/v1/audit-logs");
  const everything: any[] = [];
  let cursor: string | null = null;
  do {
    const res = await api.call("GET", `/tenant/v1/audit-logs?limit=5&tenant_id=${b.tenantId}${cursor ? `&cursor=${cursor}` : ""}`, { token: a.adminToken });
    assert.equal(res.status, 200, res.text);
    everything.push(...res.body.items);
    cursor = res.body.next_cursor;
  } while (cursor);
  assert.ok(everything.length >= 5);
  const text = JSON.stringify(everything);
  for (const leaked of [b.tenantId, b.adminId, bDispatcher.id, "@b.test", "车队乙"]) {
    assert.ok(!text.includes(leaked), `租户甲的操作日志里出现了租户乙的内容：${leaked}`);
  }
  const own = await api.db.pool.query("select id::text as log_id from audit_logs where tenant_id = $1 and actor_type in ('tenant_user', 'anonymous') order by id desc", [a.tenantId]);
  assert.deepEqual(everything.map((l) => l.id), own.rows.map((r) => r.log_id));

  for (const query of [`resource_id=${bDispatcher.id}`, `actor_id=${b.adminId}`]) {
    const res = await api.call("GET", `/tenant/v1/audit-logs?${query}`, { token: a.adminToken });
    assert.deepEqual(res.body.items, [], query);
  }
  const bPage = await api.call("GET", "/tenant/v1/audit-logs?limit=1", { token: b.adminToken });
  assert.ok(bPage.body.next_cursor);
  const withForeignCursor = await api.call("GET", `/tenant/v1/audit-logs?cursor=${bPage.body.next_cursor}`, { token: a.adminToken });
  assert.ok(!withForeignCursor.text.includes("@b.test") && !withForeignCursor.text.includes(b.tenantId));
});

test("假设签名密钥泄露：把租户甲会话的令牌改签成租户乙的租户编号，仍然进不了乙（会话不在乙名下）", async () => {
  const claims = verifyAccessToken(FAKE_SECRETS.authJwtSecret, "tenant", a.adminToken, api.clock.now());
  assert.ok(claims);
  const forged = signAccessToken(FAKE_SECRETS.authJwtSecret, { ...claims, tid: b.tenantId });
  for (const [method, url] of [
    ["GET", "/tenant/v1/users"],
    ["GET", "/tenant/v1/auth/me"],
    ["DELETE", `/tenant/v1/users/${bDispatcher.id}`],
  ] as const) {
    assert.equal((await api.call(method, url, { token: forged })).status, 401, `${method} ${url}`);
  }
  const forgedUser = signAccessToken(FAKE_SECRETS.authJwtSecret, { ...claims, sub: b.adminId });
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: forgedUser })).status, 401);
});

test("平台令牌进不了租户接口，租户令牌进不了平台接口", async () => {
  for (const route of api.app.registeredRoutes) {
    if (route.method === "HEAD") continue;
    const url = route.path.replace(":id", b.tenantId);
    const isPublic = /\/auth\/(login|accept-invite|reset-password)$/.test(route.path);
    if (route.path.startsWith("/tenant/v1/") && !isPublic) {
      const res = await api.call(route.method as "GET", url, { token: platformToken, body: {} });
      assert.equal(res.status, 401, `平台令牌访问 ${route.method} ${route.path}`);
      assert.equal(res.body.error.code, "UNAUTHENTICATED");
    }
    if (route.path.startsWith("/platform/v1/") && !isPublic) {
      const res = await api.call(route.method as "GET", url, { token: a.adminToken, body: {} });
      assert.equal(res.status, 401, `租户令牌访问 ${route.method} ${route.path}`);
    }
  }
  assert.equal((await api.call("GET", `/platform/v1/tenants/${b.tenantId}`, { token: a.adminToken })).status, 401);
});

test("/tenant/v1 的每个接口都在本文件里做过跨租户验证", () => {
  const registered = api.app.registeredRoutes
    .filter((r) => r.method !== "HEAD" && r.path.startsWith("/tenant/v1/"))
    .map((r) => `${r.method} ${r.path}`)
    .sort();
  assert.deepEqual([...covered].sort(), registered);
});

test("规则 4：/tenant/v1 的返回里没有对外价和加价比例相关的字段", async () => {
  const responses = [
    await api.call("GET", "/tenant/v1/auth/me", { token: a.adminToken }),
    await api.call("GET", "/tenant/v1/users", { token: a.adminToken }),
    await api.call("POST", "/tenant/v1/auth/login", { body: { email: "admin@a.test", password: TEST_PASSWORD } }),
  ];
  for (const res of responses) assert.doesNotMatch(res.text, /markup|sell_price|selling_price|public_price|对外价|加价/i);
});
