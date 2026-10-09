/**
 * 临时密码与强制修改密码（M0-12，ADR 0013）：接口一侧的行为，平台和租户两边都测。
 *
 * - 标记为「必须先修改密码」的账号照常能登录，登录应答和 auth/me 里带 `must_change_password: true`；
 * - 改密码之前，除「查看自己、修改密码、退出」外的每一个需要登录的接口都是 403 `PASSWORD_CHANGE_REQUIRED`
 *   ——遍历全部已注册的路由来验证，以后新增的接口默认也被拦；
 * - 改完密码恢复正常，临时密码作废。
 *
 * 平台一侧的标记由「命令行用临时密码创建超级管理员」的同一个流程（`createSuperAdmin`）产生；
 * 租户一侧没有生成临时密码的途径，标记由测试直接改库构造。命令行本身的测试在 cli/admin-temporary-password.itest.ts。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { createSuperAdmin, resetSuperAdminPassword } from "./services/platform-staff.ts";
import {
  type ApiResponse,
  type HttpMethod,
  TEST_PASSWORD,
  type TenantFixture,
  type TestApi,
  addTenantUser,
  createTestApi,
} from "./testing/api.ts";

const TEMPORARY = "Tmp7k-Qw3zR-9vBn2-XyLp4";
const NEW_PASSWORD = "Fresh-Lantern-2027";
const CODE = "PASSWORD_CHANGE_REQUIRED";

/** 强制改密期间仍然可用的、需要登录的接口。除此之外（以及不需要登录的接口之外）全部被拦。 */
const SELF_SERVICE = ["GET auth/me", "POST auth/change-password", "POST auth/logout"];

interface OpenApiDoc {
  paths: Record<string, Record<string, { security?: unknown[] }>>;
}
const doc = parse(await readFile(new URL("../openapi.yaml", import.meta.url), "utf8")) as OpenApiDoc;

let api: TestApi;
let rootToken: string;
let tenantA: TenantFixture;
let tenantB: TenantFixture;
let ipCounter = 0;
const freshIp = (): string => `10.12.0.${(ipCounter++ % 250) + 1}`;

before(async () => {
  api = await createTestApi();
  rootToken = await api.superAdminToken("root@platform.test");
  tenantA = await api.tenantWithAdmin(rootToken, "车队甲", "admin@a.test");
  tenantB = await api.tenantWithAdmin(rootToken, "车队乙", "admin@b.test");
});
after(() => api.close());

type Entry = "platform" | "tenant";

function tryLogin(entry: Entry, email: string, password: string): Promise<ApiResponse> {
  return api.call("POST", `/${entry}/v1/auth/login`, { ip: freshIp(), body: { email, password } });
}

async function login(entry: Entry, email: string, password: string): Promise<ApiResponse> {
  const res = await tryLogin(entry, email, password);
  assert.equal(res.status, 200, res.text);
  return res;
}

/** 和 `pnpm admin:create --temporary-password` 同一个流程建一个带临时密码的超级管理员。 */
async function temporarySuperAdmin(email: string, password = TEMPORARY): Promise<void> {
  await createSuperAdmin(api.db.pool, { email, name: "临时密码超管", password, temporaryPassword: true }, api.clock.now());
}

/** 租户一侧没有生成临时密码的途径：直接改库把标记置为 true。 */
async function flagTenantUser(userId: string): Promise<void> {
  const updated = await api.db.owner.query("update tenant_users set must_change_password = true where id = $1", [userId]);
  assert.equal(updated.rowCount, 1);
}

async function flagOf(table: "platform_users" | "tenant_users", email: string): Promise<boolean> {
  return (await api.db.owner.query(`select must_change_password from ${table} where email = $1`, [email])).rows[0]
    .must_change_password;
}

function assertBlocked(res: ApiResponse, label: string): void {
  assert.equal(res.status, 403, `${label}: ${res.text}`);
  assert.deepEqual(res.body, { error: { code: CODE, message: "请先修改密码，再继续使用", details: {} } }, label);
}

/** openapi.yaml 里这个接口是否声明为不需要登录（`security: []`）。 */
function isPublic(method: string, fastifyPath: string): boolean {
  const operation = doc.paths[fastifyPath.replace(/:([A-Za-z_]+)/g, "{$1}")]?.[method.toLowerCase()];
  assert.ok(operation, `openapi.yaml 里没有 ${method} ${fastifyPath}`);
  return Array.isArray(operation.security) && operation.security.length === 0;
}

/**
 * 用给定的令牌把全部已注册的路由各调一遍（路径参数填一个随机编号，不带请求体），
 * 返回每个接口有没有被 `PASSWORD_CHANGE_REQUIRED` 拦下。退出登录放在最后调。
 */
async function walkRoutes(tokens: Record<Entry, string>): Promise<{ blocked: string[]; passed: string[]; responses: Map<string, ApiResponse> }> {
  const routes = api.app.registeredRoutes
    .filter((route) => route.method !== "HEAD" && route.method !== "OPTIONS")
    .sort((a, b) => Number(a.path.endsWith("/auth/logout")) - Number(b.path.endsWith("/auth/logout")));
  const blocked: string[] = [];
  const passed: string[] = [];
  const responses = new Map<string, ApiResponse>();
  for (const route of routes) {
    const key = `${route.method} ${route.path}`;
    if (isPublic(route.method, route.path)) continue;
    const entry: Entry | null = route.path.startsWith("/platform/v1/")
      ? "platform"
      : route.path.startsWith("/tenant/v1/")
        ? "tenant"
        : null;
    assert.ok(entry, `${key} 需要登录但不在 /platform/v1、/tenant/v1 下：请在这个测试里说明强制改密期间它该怎么表现`);
    const url = route.path.replace(/:[A-Za-z_]+/g, randomUUID());
    const res = await api.call(route.method as HttpMethod, url, { token: tokens[entry] });
    responses.set(key, res);
    if (res.status === 403 && res.body?.error?.code === CODE) {
      assertBlocked(res, key);
      blocked.push(key);
    } else {
      assert.notEqual(res.body?.error?.code, CODE, key);
      passed.push(key);
    }
  }
  return { blocked, passed, responses };
}

test("遍历全部已注册的路由：必须先改密码的账号，除查看自己、改密码、退出外，每个需要登录的接口都是 403 PASSWORD_CHANGE_REQUIRED（平台和租户两侧；新增接口默认被拦）", async () => {
  await temporarySuperAdmin("walk@platform.test");
  const member = await addTenantUser(api, tenantA.adminToken, "walk@a.test", "admin");
  await flagTenantUser(member.id);
  const tokens = {
    platform: (await login("platform", "walk@platform.test", TEMPORARY)).body.access_token as string,
    tenant: (await login("tenant", "walk@a.test", TEST_PASSWORD)).body.access_token as string,
  };

  const tenantsBefore = (await api.db.owner.query("select count(*)::int as n from tenants")).rows[0].n;
  const { blocked, passed, responses } = await walkRoutes(tokens);

  const expectedPassed = (["platform", "tenant"] as const)
    .flatMap((entry) => SELF_SERVICE.map((item) => item.replace(" ", ` /${entry}/v1/`)))
    .sort();
  assert.deepEqual([...passed].sort(), expectedPassed, "强制改密期间放行的接口应当恰好是这六个");
  assert.ok(blocked.length >= 16, `被拦的接口数量不对：${blocked.length}`);
  for (const key of blocked) assert.ok(!key.includes("/auth/"), `${key} 不应被拦`);

  for (const entry of ["platform", "tenant"] as const) {
    assert.equal(responses.get(`GET /${entry}/v1/auth/me`)?.status, 200);
    // 没带请求体：过了鉴权，停在参数校验
    assert.equal(responses.get(`POST /${entry}/v1/auth/change-password`)?.body.error.code, "VALIDATION_FAILED");
    assert.equal(responses.get(`POST /${entry}/v1/auth/logout`)?.status, 204);
  }

  // 每一个已注册的路由要么不需要登录、要么放行、要么被拦，没有漏网的
  const all = api.app.registeredRoutes.filter((route) => route.method !== "HEAD" && route.method !== "OPTIONS");
  const publicRoutes = all.filter((route) => isPublic(route.method, route.path));
  assert.equal(blocked.length + passed.length + publicRoutes.length, all.length);
  assert.equal((await api.db.owner.query("select count(*)::int as n from tenants")).rows[0].n, tenantsBefore);
});

test("对照：没有标记的账号把同样的路由走一遍，没有任何一个接口返回 PASSWORD_CHANGE_REQUIRED", async () => {
  await createSuperAdmin(api.db.pool, { email: "plain@platform.test", name: "普通超管", password: TEST_PASSWORD }, api.clock.now());
  const member = await addTenantUser(api, tenantA.adminToken, "plain@a.test", "admin");
  const platform = await login("platform", "plain@platform.test", TEST_PASSWORD);
  assert.equal(platform.body.must_change_password, false);
  const { blocked, passed } = await walkRoutes({ platform: platform.body.access_token, tenant: member.token });
  assert.deepEqual(blocked, []);
  assert.ok(passed.length >= 22);
});

test("平台：用临时密码登录照常成功，登录应答和 auth/me 的顶层带 must_change_password: true；账号对象里没有这个字段", async () => {
  await temporarySuperAdmin("first@platform.test");
  const loggedIn = await login("platform", "first@platform.test", TEMPORARY);
  assert.equal(loggedIn.body.must_change_password, true);
  assert.deepEqual(Object.keys(loggedIn.body).sort(), ["access_token", "expires_at", "must_change_password", "token_type", "user"]);
  assert.deepEqual(Object.keys(loggedIn.body.user).sort(), ["created_at", "email", "id", "name", "role", "status", "updated_at"]);

  const me = await api.call("GET", "/platform/v1/auth/me", { token: loggedIn.body.access_token });
  assert.equal(me.status, 200, me.text);
  assert.equal(me.body.must_change_password, true);
  assert.deepEqual(Object.keys(me.body).sort(), ["must_change_password", "permissions", "user"]);
  assert.ok(!("must_change_password" in me.body.user));
  assert.ok(me.body.permissions.includes("tenant.create"), "权限清单照常给出，前端据此准备改密之后的界面");

  // 令牌里没有这个标记：每个请求都以数据库为准
  const claims = JSON.parse(Buffer.from((loggedIn.body.access_token as string).split(".")[1] as string, "base64url").toString("utf8"));
  assert.deepEqual(Object.keys(claims).sort(), ["aud", "exp", "iat", "role", "sid", "sub", "tid"]);
});

test("平台：改密码之前被拦的请求不产生任何效果（不建租户、不写查看集成的审计记录），错误先于权限和参数校验", async () => {
  const token = (await login("platform", "first@platform.test", TEMPORARY)).body.access_token as string;
  const counts = async (): Promise<unknown> =>
    (
      await api.db.owner.query(
        `select (select count(*)::int from tenants) as tenants, (select count(*)::int from platform_users) as staff,
                (select count(*)::int from audit_logs where action = 'view') as views`,
      )
    ).rows[0];
  const before = await counts();

  assertBlocked(
    await api.call("POST", "/platform/v1/tenants", { token, body: { name: "不该出现的车队", admin: { email: "x@c.test", name: "某人" } } }),
    "创建租户",
  );
  assertBlocked(await api.call("POST", "/platform/v1/staff", { token, body: { email: "y@platform.test", name: "某人", role: "finance" } }), "邀请员工");
  assertBlocked(await api.call("GET", "/platform/v1/integrations", { token }), "查看集成");
  assertBlocked(await api.call("GET", `/platform/v1/tenants/${tenantA.tenantId}`, { token }), "查看租户");
  // 参数不合法也先返回这个错误，不是 400
  assertBlocked(await api.call("POST", "/platform/v1/tenants", { token, body: { name: "" } }), "参数不合法");
  assertBlocked(await api.call("GET", "/platform/v1/staff?limit=99999", { token }), "查询串不合法");
  assert.deepEqual(await counts(), before);
});

test("平台：改密码——当前密码不对、新密码与临时密码相同、新密码太弱都改不了，标记还在；改成功后同一个令牌立即恢复正常，临时密码作废", async () => {
  const first = (await login("platform", "first@platform.test", TEMPORARY)).body.access_token as string;
  const second = (await login("platform", "first@platform.test", TEMPORARY)).body.access_token as string;
  const change = (body: unknown, ip = freshIp()): Promise<ApiResponse> =>
    api.call("POST", "/platform/v1/auth/change-password", { token: first, ip, body });

  const wrong = await change({ current_password: "Not-The-Temp-0000", new_password: NEW_PASSWORD });
  assert.equal(wrong.body.error.code, "CURRENT_PASSWORD_INCORRECT");
  const same = await change({ current_password: TEMPORARY, new_password: TEMPORARY });
  assert.equal(same.status, 400);
  assert.equal(same.body.error.code, "PASSWORD_UNCHANGED", "新密码不能就是临时密码");
  const weak = await change({ current_password: TEMPORARY, new_password: "short" });
  assert.equal(weak.body.error.code, "WEAK_PASSWORD");
  assert.equal(await flagOf("platform_users", "first@platform.test"), true);
  assertBlocked(await api.call("GET", "/platform/v1/staff", { token: first }), "改密失败之后仍然被拦");

  const changed = await change({ current_password: TEMPORARY, new_password: NEW_PASSWORD });
  assert.equal(changed.status, 204, changed.text);
  assert.equal(await flagOf("platform_users", "first@platform.test"), false);

  const me = await api.call("GET", "/platform/v1/auth/me", { token: first });
  assert.equal(me.body.must_change_password, false);
  assert.equal((await api.call("GET", "/platform/v1/staff", { token: first })).status, 200, "不用重新登录");
  assert.equal((await api.call("GET", "/platform/v1/tenants", { token: first })).status, 200);
  assert.equal((await api.call("GET", "/platform/v1/auth/me", { token: second })).status, 401, "用临时密码登录的其他会话失效");

  const old = await tryLogin("platform", "first@platform.test", TEMPORARY);
  assert.equal(old.status, 401, "临时密码作废");
  assert.equal(old.body.error.code, "INVALID_CREDENTIALS");
  const relogin = await login("platform", "first@platform.test", NEW_PASSWORD);
  assert.equal(relogin.body.must_change_password, false);
});

test("平台审计：创建时记下「用了临时密码」这件事；改密沿用 change_password；审计、应用日志、数据库里都没有临时密码和新密码原文", async () => {
  const userId = (await api.db.owner.query("select id from platform_users where email = 'first@platform.test'")).rows[0].id;
  const rows = (
    await api.db.owner.query(
      "select actor_type, source, action, after from audit_logs where resource = 'platform_user' and resource_id = $1 and action in ('create', 'change_password') order by id",
      [userId],
    )
  ).rows;
  assert.deepEqual(rows, [
    {
      actor_type: "system",
      source: "cli",
      action: "create",
      after: { email: "first@platform.test", name: "临时密码超管", role: "super_admin", status: "active", temporary_password: true },
    },
    { actor_type: "platform_user", source: "console", action: "change_password", after: null },
  ]);

  const plain = (await api.db.owner.query("select after from audit_logs where action = 'create' and after ->> 'email' = 'plain@platform.test'")).rows[0];
  assert.ok(!("temporary_password" in plain.after), "没用临时密码时审计详情不变");

  const everything =
    JSON.stringify((await api.db.owner.query("select * from audit_logs")).rows) +
    JSON.stringify((await api.db.owner.query("select * from platform_users")).rows) +
    api.logs();
  assert.ok(!everything.includes(TEMPORARY) && !everything.includes(NEW_PASSWORD));

  const viaApi = await api.call("GET", `/platform/v1/audit-logs?resource_id=${userId}&action=create`, { token: rootToken });
  assert.equal(viaApi.body.items[0].after.temporary_password, true, "平台的审计查询里看得到这件事");
});

test("平台：退出登录在改密码之前也可用；没带令牌仍是 401，停用的账号仍是 401，都不是 PASSWORD_CHANGE_REQUIRED", async () => {
  await temporarySuperAdmin("leave@platform.test");
  const token = (await login("platform", "leave@platform.test", TEMPORARY)).body.access_token as string;
  assert.equal((await api.call("GET", "/platform/v1/staff")).body.error.code, "UNAUTHENTICATED");
  assert.equal((await api.call("POST", "/platform/v1/auth/logout", { token })).status, 204);
  assert.equal((await api.call("GET", "/platform/v1/auth/me", { token })).status, 401);
  assert.equal(await flagOf("platform_users", "leave@platform.test"), true, "退出不会清掉标记");

  const again = (await login("platform", "leave@platform.test", TEMPORARY)).body.access_token as string;
  const id = (await api.call("GET", "/platform/v1/auth/me", { token: again })).body.user.id;
  assert.equal((await api.call("POST", `/platform/v1/staff/${id}/disable`, { token: rootToken })).status, 200);
  assert.equal((await api.call("GET", "/platform/v1/staff", { token: again })).body.error.code, "UNAUTHENTICATED");
  assert.equal((await tryLogin("platform", "leave@platform.test", TEMPORARY)).body.error.code, "ACCOUNT_DISABLED");
});

test("平台：没有权限的角色被标记时，返回的也是 PASSWORD_CHANGE_REQUIRED 而不是 FORBIDDEN（不提前暴露权限情况）", async () => {
  const invited = await api.call("POST", "/platform/v1/staff", { token: rootToken, body: { email: "fin@platform.test", name: "财务", role: "finance" } });
  await api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.body.invite.token, password: TEST_PASSWORD } });
  const token = (await login("platform", "fin@platform.test", TEST_PASSWORD)).body.access_token as string;
  assert.equal((await api.call("GET", "/platform/v1/staff", { token })).body.error.code, "FORBIDDEN");
  await api.db.owner.query("update platform_users set must_change_password = true where email = 'fin@platform.test'");
  assertBlocked(await api.call("GET", "/platform/v1/staff", { token }), "已有会话下一次请求就被拦");
  const change = await api.call("POST", "/platform/v1/auth/change-password", {
    token,
    body: { current_password: TEST_PASSWORD, new_password: NEW_PASSWORD },
  });
  assert.equal(change.status, 204, change.text);
  assert.equal((await api.call("GET", "/platform/v1/staff", { token })).body.error.code, "FORBIDDEN", "改完密码回到原来的权限判断");
});

test("平台：超级管理员给带标记的账号发重置链接——发出时标记不变；本人凭链接设了密码后标记清除，临时密码作废", async () => {
  await temporarySuperAdmin("link@platform.test");
  const id = (await api.db.owner.query("select id from platform_users where email = 'link@platform.test'")).rows[0].id;
  const issued = await api.call("POST", `/platform/v1/staff/${id}/password-reset`, { token: rootToken });
  assert.equal(issued.status, 201, issued.text);
  assert.ok(!("must_change_password" in issued.body.user));
  assert.equal(await flagOf("platform_users", "link@platform.test"), true);

  const reset = await api.call("POST", "/platform/v1/auth/reset-password", { body: { token: issued.body.reset.token, password: NEW_PASSWORD } });
  assert.equal(reset.status, 200, reset.text);
  assert.ok(!("must_change_password" in reset.body) && !("must_change_password" in reset.body.user));
  assert.equal(await flagOf("platform_users", "link@platform.test"), false);
  assert.equal((await tryLogin("platform", "link@platform.test", TEMPORARY)).status, 401);
  const loggedIn = await login("platform", "link@platform.test", NEW_PASSWORD);
  assert.equal(loggedIn.body.must_change_password, false);
  assert.equal((await api.call("GET", "/platform/v1/staff", { token: loggedIn.body.access_token })).status, 200);
});

test("平台：命令行不带临时密码开关重设密码（操作人自己设的密码）会清掉之前的标记；带开关则置上并记审计", async () => {
  await temporarySuperAdmin("cli@platform.test");
  await resetSuperAdminPassword(api.db.pool, { email: "cli@platform.test", password: NEW_PASSWORD }, api.clock.now());
  assert.equal(await flagOf("platform_users", "cli@platform.test"), false);
  assert.equal((await login("platform", "cli@platform.test", NEW_PASSWORD)).body.must_change_password, false);

  await resetSuperAdminPassword(api.db.pool, { email: "cli@platform.test", password: TEMPORARY, temporaryPassword: true }, api.clock.now());
  assert.equal(await flagOf("platform_users", "cli@platform.test"), true);
  assert.equal((await login("platform", "cli@platform.test", TEMPORARY)).body.must_change_password, true);
  const audit = await api.db.owner.query(
    `select after from audit_logs where action = 'reset_password'
        and resource_id = (select id::text from platform_users where email = 'cli@platform.test') order by id`,
  );
  assert.deepEqual(audit.rows, [{ after: null }, { after: { temporary_password: true } }]);
});

test("平台：邀请链接激活的账号没有标记；账号列表、邀请应答里都没有 must_change_password 字段", async () => {
  const invited = await api.call("POST", "/platform/v1/staff", { token: rootToken, body: { email: "ops@platform.test", name: "运营", role: "operations" } });
  assert.ok(!JSON.stringify(invited.body).includes("must_change_password"));
  const accepted = await api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.body.invite.token, password: TEST_PASSWORD } });
  assert.ok(!JSON.stringify(accepted.body).includes("must_change_password"));
  assert.equal(await flagOf("platform_users", "ops@platform.test"), false);
  assert.equal((await login("platform", "ops@platform.test", TEST_PASSWORD)).body.must_change_password, false);

  assert.equal(await flagOf("platform_users", "walk@platform.test"), true);
  const staff = await api.call("GET", "/platform/v1/staff?limit=200", { token: rootToken });
  assert.equal(staff.status, 200);
  assert.ok(staff.body.items.some((item: { email: string }) => item.email === "walk@platform.test"));
  assert.ok(!staff.text.includes("must_change_password"), "别人看不到谁还在用临时密码");
});

test("租户：标记置上后，已有的会话下一次请求就被拦；登录照常成功并带 must_change_password: true；auth/me 可用", async () => {
  const member = await addTenantUser(api, tenantA.adminToken, "driver@a.test", "admin");
  assert.equal((await api.call("GET", "/tenant/v1/users", { token: member.token })).status, 200);
  await flagTenantUser(member.id);
  assertBlocked(await api.call("GET", "/tenant/v1/users", { token: member.token }), "已有会话");

  const loggedIn = await login("tenant", "driver@a.test", TEST_PASSWORD);
  assert.equal(loggedIn.body.must_change_password, true);
  assert.deepEqual(Object.keys(loggedIn.body).sort(), ["access_token", "expires_at", "must_change_password", "tenant", "token_type", "user"]);
  assert.ok(!("must_change_password" in loggedIn.body.user) && !("must_change_password" in loggedIn.body.tenant));

  const me = await api.call("GET", "/tenant/v1/auth/me", { token: loggedIn.body.access_token });
  assert.equal(me.status, 200, me.text);
  assert.deepEqual(Object.keys(me.body).sort(), ["must_change_password", "permissions", "tenant", "user"]);
  assert.equal(me.body.must_change_password, true);
  assert.equal(me.body.tenant.id, tenantA.tenantId);
});

test("租户：改密码之前每个业务接口都被拦且不产生效果；没有权限的角色拿到的也是 PASSWORD_CHANGE_REQUIRED", async () => {
  const token = (await login("tenant", "driver@a.test", TEST_PASSWORD)).body.access_token as string;
  const usersBefore = (await api.db.owner.query("select id, name, role, status from tenant_users order by id")).rows;

  assertBlocked(await api.call("GET", "/tenant/v1/users", { token }), "账号列表");
  assertBlocked(await api.call("POST", "/tenant/v1/users", { token, body: { email: "new@a.test", name: "新人", role: "dispatch" } }), "邀请");
  assertBlocked(
    await api.call("PUT", `/tenant/v1/users/${tenantA.adminId}`, { token, body: { name: "被改了", role: "finance", status: "disabled" } }),
    "改别人",
  );
  assertBlocked(await api.call("DELETE", `/tenant/v1/users/${tenantA.adminId}`, { token }), "停用别人");
  assertBlocked(await api.call("POST", `/tenant/v1/users/${tenantA.adminId}/password-reset`, { token }), "发重置");
  assertBlocked(await api.call("GET", "/tenant/v1/audit-logs", { token }), "操作日志");
  assert.deepEqual((await api.db.owner.query("select id, name, role, status from tenant_users order by id")).rows, usersBefore);

  const dispatcher = await addTenantUser(api, tenantA.adminToken, "dispatch@a.test", "dispatch");
  assert.equal((await api.call("POST", "/tenant/v1/users", { token: dispatcher.token, body: {} })).body.error.code, "FORBIDDEN");
  await flagTenantUser(dispatcher.id);
  assertBlocked(await api.call("POST", "/tenant/v1/users", { token: dispatcher.token, body: {} }), "没有权限的角色");
});

test("租户隔离不受影响：甲的一个用户被标记，只拦他自己——同租户的其他人、乙租户的人照常；标记不出现在任何列表、审计和别人的应答里", async () => {
  assert.equal((await api.call("GET", "/tenant/v1/users", { token: tenantA.adminToken })).status, 200, "同租户的其他人不受影响");
  assert.equal((await api.call("GET", "/tenant/v1/users", { token: tenantB.adminToken })).status, 200, "别的租户不受影响");
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: tenantB.adminToken })).body.must_change_password, false);

  const list = await api.call("GET", "/tenant/v1/users?limit=200", { token: tenantA.adminToken });
  assert.ok(list.body.items.some((item: { email: string }) => item.email === "driver@a.test"));
  assert.ok(!list.text.includes("must_change_password"), "管理员的账号列表里没有这个标记");
  const audit = await api.call("GET", "/tenant/v1/audit-logs?limit=200", { token: tenantA.adminToken });
  assert.ok(!audit.text.includes("must_change_password") && !audit.text.includes("temporary_password"));
  const platformView = await api.call("GET", `/platform/v1/tenants/${tenantA.tenantId}`, { token: rootToken });
  assert.ok(!platformView.text.includes("must_change_password"));

  // 被标记的甲用户拿自己的令牌去碰乙的资源：和碰自己租户的一样被拦，乙的数据不动
  const flagged = (await login("tenant", "driver@a.test", TEST_PASSWORD)).body.access_token as string;
  assertBlocked(await api.call("PUT", `/tenant/v1/users/${tenantB.adminId}`, { token: flagged, body: { name: "x", role: "admin", status: "disabled" } }), "碰乙的账号");
  assertBlocked(await api.call("POST", `/tenant/v1/users/${tenantB.adminId}/password-reset`, { token: flagged }), "给乙发重置");
  const b = (await api.db.owner.query("select status, must_change_password, reset_token_hash from tenant_users where id = $1", [tenantB.adminId])).rows[0];
  assert.deepEqual(b, { status: "active", must_change_password: false, reset_token_hash: null });

  // 乙的用户被标记，同样只拦乙的那个人；甲这边一切照旧
  const bMember = await addTenantUser(api, tenantB.adminToken, "driver@b.test", "admin");
  await flagTenantUser(bMember.id);
  assertBlocked(await api.call("GET", "/tenant/v1/users", { token: bMember.token }), "乙的被标记用户");
  assert.equal((await api.call("GET", "/tenant/v1/users", { token: tenantA.adminToken })).status, 200);
  // 租户令牌进不了平台接口、平台令牌进不了租户接口：仍是 401，不因为标记变成 403
  assert.equal((await api.call("GET", "/platform/v1/auth/me", { token: bMember.token })).status, 401);
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: rootToken })).status, 401);
});

test("租户：改密码成功后标记清除、同一个令牌恢复正常、旧密码作废；只改自己的——同租户和别的租户被标记的人仍然被拦", async () => {
  const first = (await login("tenant", "driver@a.test", TEST_PASSWORD)).body.access_token as string;
  const second = (await login("tenant", "driver@a.test", TEST_PASSWORD)).body.access_token as string;
  const change = (body: unknown): Promise<ApiResponse> =>
    api.call("POST", "/tenant/v1/auth/change-password", { token: first, ip: freshIp(), body });

  assert.equal((await change({ current_password: TEST_PASSWORD, new_password: TEST_PASSWORD })).body.error.code, "PASSWORD_UNCHANGED");
  assert.equal(await flagOf("tenant_users", "driver@a.test"), true);
  const changed = await change({ current_password: TEST_PASSWORD, new_password: NEW_PASSWORD });
  assert.equal(changed.status, 204, changed.text);

  assert.equal(await flagOf("tenant_users", "driver@a.test"), false);
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: first })).body.must_change_password, false);
  assert.equal((await api.call("GET", "/tenant/v1/users", { token: first })).status, 200);
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: second })).status, 401);
  assert.equal((await tryLogin("tenant", "driver@a.test", TEST_PASSWORD)).status, 401);
  assert.equal((await login("tenant", "driver@a.test", NEW_PASSWORD)).body.must_change_password, false);

  assert.equal(await flagOf("tenant_users", "dispatch@a.test"), true, "同租户另一个被标记的人不受影响");
  assert.equal(await flagOf("tenant_users", "driver@b.test"), true, "别的租户被标记的人不受影响");
  const audit = await api.db.owner.query(
    "select tenant_id, actor_email, after from audit_logs where action = 'change_password' and actor_email = 'driver@a.test'",
  );
  assert.deepEqual(audit.rows, [{ tenant_id: tenantA.tenantId, actor_email: "driver@a.test", after: null }]);
});

test("租户：退出登录在改密码之前可用；管理员发的重置链接、平台发的重置链接、邀请链接设置密码后标记都是 false", async () => {
  const flagged = (await login("tenant", "dispatch@a.test", TEST_PASSWORD)).body.access_token as string;
  assert.equal((await api.call("POST", "/tenant/v1/auth/logout", { token: flagged })).status, 204);
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: flagged })).status, 401);

  const dispatcherId = (await api.db.owner.query("select id from tenant_users where email = 'dispatch@a.test'")).rows[0].id;
  const issued = await api.call("POST", `/tenant/v1/users/${dispatcherId}/password-reset`, { token: tenantA.adminToken });
  assert.equal(issued.status, 201, issued.text);
  assert.equal(await flagOf("tenant_users", "dispatch@a.test"), true, "发出链接不改变标记");
  const reset = await api.call("POST", "/tenant/v1/auth/reset-password", { body: { token: issued.body.reset.token, password: NEW_PASSWORD } });
  assert.equal(reset.status, 200, reset.text);
  assert.ok(!reset.text.includes("must_change_password"));
  assert.equal(await flagOf("tenant_users", "dispatch@a.test"), false);
  assert.equal((await login("tenant", "dispatch@a.test", NEW_PASSWORD)).body.must_change_password, false);

  // 平台给租户管理员发重置链接
  await flagTenantUser(tenantB.adminId);
  assertBlocked(await api.call("GET", "/tenant/v1/users", { token: tenantB.adminToken }), "乙的管理员被标记");
  const byPlatform = await api.call("POST", `/platform/v1/tenants/${tenantB.tenantId}/admin-password-resets`, {
    token: rootToken,
    body: { email: tenantB.adminEmail },
  });
  assert.equal(byPlatform.status, 201, byPlatform.text);
  assert.ok(!byPlatform.text.includes("must_change_password"));
  await api.call("POST", "/tenant/v1/auth/reset-password", { body: { token: byPlatform.body.reset.token, password: NEW_PASSWORD } });
  assert.equal(await flagOf("tenant_users", tenantB.adminEmail), false);
  const admin = await login("tenant", tenantB.adminEmail, NEW_PASSWORD);
  assert.equal(admin.body.must_change_password, false);
  assert.equal((await api.call("GET", "/tenant/v1/users", { token: admin.body.access_token })).status, 200);

  // 邀请链接
  const invited = await api.call("POST", "/tenant/v1/users", { token: tenantA.adminToken, body: { email: "invited@a.test", name: "受邀", role: "finance" } });
  assert.ok(!invited.text.includes("must_change_password"));
  await api.call("POST", "/tenant/v1/auth/accept-invite", { body: { token: invited.body.invite.token, password: TEST_PASSWORD } });
  assert.equal(await flagOf("tenant_users", "invited@a.test"), false);
  assert.equal((await login("tenant", "invited@a.test", TEST_PASSWORD)).body.must_change_password, false);
});

test("数据库约束：还没设过密码（待激活）的账号不能被标记为必须先修改密码", async () => {
  const invited = await api.call("POST", "/platform/v1/staff", { token: rootToken, body: { email: "pending@platform.test", name: "待激活", role: "finance" } });
  assert.equal(invited.status, 201);
  await assert.rejects(
    api.db.owner.query("update platform_users set must_change_password = true where email = 'pending@platform.test'"),
    { code: "23514", constraint: "platform_users_must_change_needs_password" },
  );
  const pending = await api.call("POST", "/tenant/v1/users", { token: tenantA.adminToken, body: { email: "pending@a.test", name: "待激活", role: "finance" } });
  assert.equal(pending.status, 201);
  await assert.rejects(api.db.owner.query("update tenant_users set must_change_password = true where email = 'pending@a.test'"), {
    code: "23514",
    constraint: "tenant_users_must_change_needs_password",
  });
});
