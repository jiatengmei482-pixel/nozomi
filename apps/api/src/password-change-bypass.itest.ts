/**
 * 强制修改密码（M0-12，ADR 0013）的绕过与边界：测试角色补的用例。
 *
 * password-change-required.itest.ts 已经按「注册的路由原样各调一遍」验证过拦截；这里专门找旁路：
 * 路径和方法的变体、HEAD / OPTIONS、被拦请求是否真的什么都没写、标记在停用 / 启用 / 会话过期 / 请求体里夹带字段时的表现、
 * 改密失败和限速之后标记是否还在、改密的同时并发调别的接口、两个会话同时改密。
 * 数据全部在本文件里构造，结束时连同 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { createSuperAdmin } from "./services/platform-staff.ts";
import { type ApiResponse, type HttpMethod, TEST_PASSWORD, type TenantFixture, type TestApi, addTenantUser, createTestApi } from "./testing/api.ts";

const TEMPORARY = "Tmp7k-Qw3zR-9vBn2-XyLp4";
const NEW_PASSWORD = "Fresh-Lantern-2027";
const OTHER_PASSWORD = "Amber-Compass-2028";
const CODE = "PASSWORD_CHANGE_REQUIRED";
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

type Entry = "platform" | "tenant";

let api: TestApi;
let rootToken: string;
let tenantA: TenantFixture;
let tenantB: TenantFixture;
let ipCounter = 0;
const freshIp = (): string => `10.14.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

before(async () => {
  api = await createTestApi();
  rootToken = await api.superAdminToken("root@platform.test");
  tenantA = await api.tenantWithAdmin(rootToken, "车队甲", "admin@a.test");
  tenantB = await api.tenantWithAdmin(rootToken, "车队乙", "admin@b.test");
});
after(() => api.close());

async function login(entry: Entry, email: string, password: string): Promise<ApiResponse> {
  const res = await api.call("POST", `/${entry}/v1/auth/login`, { ip: freshIp(), body: { email, password } });
  assert.equal(res.status, 200, res.text);
  return res;
}

async function temporarySuperAdmin(email: string): Promise<string> {
  await createSuperAdmin(api.db.pool, { email, name: "临时密码超管", password: TEMPORARY, temporaryPassword: true }, api.clock.now());
  return (await login("platform", email, TEMPORARY)).body.access_token as string;
}

/** 租户一侧没有生成临时密码的途径：建一个用户后直接改库置上标记，再登录。 */
async function flaggedTenantUser(tenant: TenantFixture, email: string, role = "admin"): Promise<{ id: string; token: string }> {
  const member = await addTenantUser(api, tenant.adminToken, email, role);
  const updated = await api.db.owner.query("update tenant_users set must_change_password = true where id = $1", [member.id]);
  assert.equal(updated.rowCount, 1);
  return { id: member.id, token: (await login("tenant", email, TEST_PASSWORD)).body.access_token as string };
}

async function flagOf(table: "platform_users" | "tenant_users", email: string): Promise<boolean> {
  return (await api.db.owner.query(`select must_change_password from ${table} where email = $1`, [email])).rows[0].must_change_password;
}

async function hashOf(table: "platform_users" | "tenant_users", email: string): Promise<string> {
  return (await api.db.owner.query(`select password_hash from ${table} where email = $1`, [email])).rows[0].password_hash;
}

/** 整个测试 schema 里每张表的「行数 + 全部内容的摘要」。两次快照相等 = 这期间数据库里什么都没变。 */
async function snapshot(): Promise<Record<string, string>> {
  const tables = (
    await api.db.owner.query("select table_name from information_schema.tables where table_schema = $1 and table_type = 'BASE TABLE' order by 1", [
      api.db.schema,
    ])
  ).rows.map((row) => row.table_name as string);
  const result: Record<string, string> = {};
  for (const table of tables) {
    const row = (await api.db.owner.query(`select count(*)::int as n, coalesce(md5(string_agg(x::text, '|' order by x::text)), '') as h from "${table}" x`)).rows[0];
    result[table] = `${row.n}:${row.h}`;
  }
  return result;
}

async function raw(method: string, url: string, token: string, headers: Record<string, string> = {}, body?: unknown): Promise<ApiResponse> {
  const res = await api.app.inject({
    method: method as "GET",
    url,
    headers: { authorization: `Bearer ${token}`, ...headers },
    ...(body === undefined ? {} : { payload: body as object }),
  });
  let parsed: unknown = null;
  try {
    parsed = res.body === "" ? null : res.json();
  } catch {
    parsed = null;
  }
  return { status: res.statusCode, headers: res.headers, text: res.body, body: parsed };
}

/** 主数据四类资源的接口形状相同（M1-01）；鉴权先于参数校验，所以请求体给空对象即可。 */
const MASTER_RESOURCES = ["cities", "places", "vehicle-groups", "addons"] as const;

/** 一份合格的区域请求体（城市编号是随便写的：被拦的请求根本走不到查城市那一步）。 */
const AREA_BODY = {
  city_id: "99999999-9999-4999-8999-999999999999",
  name: { zh: "不该出现的区域" },
  biz_type: "general",
  polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [[[139, 35], [140, 35], [140, 36], [139, 35]]] } }],
};

/** 每个被拦的业务接口配一份「本来会成功」的请求体：证明被拦不是因为参数不对。 */
function generalRequests(entry: Entry, ids: { tenantId: string; userId: string }): [HttpMethod, string, unknown?][] {
  if (entry === "platform") {
    return [
      ["GET", "/platform/v1/dashboard/summary"],
      ["GET", "/platform/v1/staff"],
      ["POST", "/platform/v1/staff", { email: `bypass-${randomUUID().slice(0, 8)}@platform.test`, name: "不该出现", role: "finance" }],
      ["POST", `/platform/v1/staff/${ids.userId}/disable`],
      ["POST", `/platform/v1/staff/${ids.userId}/enable`],
      ["POST", `/platform/v1/staff/${ids.userId}/password-reset`],
      ["GET", "/platform/v1/tenants"],
      ["POST", "/platform/v1/tenants", { name: "不该出现的车队", admin: { email: `bypass-${randomUUID().slice(0, 8)}@c.test`, name: "某人" } }],
      ["GET", `/platform/v1/tenants/${ids.tenantId}`],
      ["POST", `/platform/v1/tenants/${ids.tenantId}/suspend`, { reason: "不该生效" }],
      ["POST", `/platform/v1/tenants/${ids.tenantId}/resume`],
      ["POST", `/platform/v1/tenants/${ids.tenantId}/admin-invites`, { email: `bypass-${randomUUID().slice(0, 8)}@a.test`, name: "某人" }],
      ["POST", `/platform/v1/tenants/${ids.tenantId}/admin-password-resets`, { email: "admin@a.test" }],
      ["GET", "/platform/v1/audit-logs"],
      ["GET", "/platform/v1/integrations"],
      ...MASTER_RESOURCES.flatMap((resource): [HttpMethod, string, unknown?][] => [
        ["GET", `/platform/v1/master/${resource}`],
        ["POST", `/platform/v1/master/${resource}`, {}],
        ["GET", `/platform/v1/master/${resource}/${ids.userId}`],
        ["PATCH", `/platform/v1/master/${resource}/${ids.userId}`, {}],
        ["POST", `/platform/v1/master/${resource}/${ids.userId}/disable`],
        ["POST", `/platform/v1/master/${resource}/${ids.userId}/enable`],
      ]),
    ];
  }
  return [
    ...MASTER_RESOURCES.flatMap((resource): [HttpMethod, string, unknown?][] => [
      ["GET", `/tenant/v1/master/${resource}`],
      ["GET", `/tenant/v1/master/${resource}/${ids.userId}`],
    ]),
    ["GET", "/tenant/v1/users"],
    ["POST", "/tenant/v1/users", { email: `bypass-${randomUUID().slice(0, 8)}@a.test`, name: "不该出现", role: "dispatch" }],
    ["PUT", `/tenant/v1/users/${ids.userId}`, { name: "被改了", role: "finance", status: "disabled" }],
    ["DELETE", `/tenant/v1/users/${ids.userId}`],
    ["POST", `/tenant/v1/users/${ids.userId}/password-reset`],
    ["GET", "/tenant/v1/audit-logs"],
    ["GET", "/tenant/v1/areas"],
    ["POST", "/tenant/v1/areas", AREA_BODY],
    ["GET", `/tenant/v1/areas/${ids.userId}`],
    ["PUT", `/tenant/v1/areas/${ids.userId}`, AREA_BODY],
    ["DELETE", `/tenant/v1/areas/${ids.userId}`],
    ["POST", `/tenant/v1/areas/${ids.userId}/disable`],
    ["POST", `/tenant/v1/areas/${ids.userId}/enable`],
    ["POST", `/tenant/v1/areas/${ids.userId}/check-point`, { lat: 35.5, lng: 139.5 }],
    ["GET", "/tenant/v1/map/config"],
    ["GET", "/tenant/v1/dashboard/summary"],
  ];
}

function assertBlocked(res: ApiResponse, label: string): void {
  assert.equal(res.status, 403, `${label}: ${res.status} ${res.text}`);
  assert.equal(res.body?.error?.code, CODE, label);
}

test("清单没有漏：上面手写的「业务接口」覆盖了全部已注册的、不在 auth/ 下的平台和租户路由", () => {
  const registered = api.app.registeredRoutes
    .filter((route) => route.method !== "HEAD" && route.method !== "OPTIONS" && !route.path.includes("/auth/") && route.path !== "/health")
    .map((route) => `${route.method} ${route.path}`)
    .sort();
  const listed = (["platform", "tenant"] as const)
    .flatMap((entry) => generalRequests(entry, { tenantId: ":id", userId: ":id" }).map(([method, url]) => `${method} ${url}`))
    .sort();
  assert.deepEqual(listed, registered, "新增了业务接口：请把它加进 generalRequests，让下面的用例也覆盖到它");
});

test("被拦的请求带着本来会成功的参数也一律 403，并且数据库里一个字节都没变（两侧全部业务接口；包括会话、审计、限速表）", async () => {
  const platform = await temporarySuperAdmin("nothing@platform.test");
  const tenant = await flaggedTenantUser(tenantA, "nothing@a.test");
  const victim = (await api.db.owner.query("select id from platform_users where email = 'root@platform.test'")).rows[0].id as string;

  const before = await snapshot();
  assert.notEqual(before["audit_logs"]?.split(":")[0], "0", "快照读得到数据（否则这条用例什么都证明不了）");
  for (const [method, url, body] of generalRequests("platform", { tenantId: tenantA.tenantId, userId: victim })) {
    assertBlocked(await api.call(method, url, { token: platform, ...(body === undefined ? {} : { body }) }), `${method} ${url}`);
  }
  for (const [method, url, body] of generalRequests("tenant", { tenantId: tenantA.tenantId, userId: tenantA.adminId })) {
    assertBlocked(await api.call(method, url, { token: tenant.token, ...(body === undefined ? {} : { body }) }), `${method} ${url}`);
  }
  // 查看自己也不留痕迹（不写审计、不更新会话）
  assert.equal((await api.call("GET", "/platform/v1/auth/me", { token: platform })).status, 200);
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: tenant.token })).status, 200);
  assert.deepEqual(await snapshot(), before);
});

test("对照：同样的请求换成没有标记的账号是会成功的（证明上一条被拦的不是参数问题）", async () => {
  const created = await api.call("POST", "/platform/v1/tenants", {
    token: rootToken,
    body: { name: "对照车队", admin: { email: "control@c.test", name: "某人" } },
  });
  assert.equal(created.status, 201, created.text);
  const invited = await api.call("POST", "/tenant/v1/users", { token: tenantA.adminToken, body: { email: "control@a.test", name: "对照", role: "dispatch" } });
  assert.equal(invited.status, 201, invited.text);
  assert.equal((await api.call("GET", "/platform/v1/integrations", { token: rootToken })).status, 200);
});

test("路径变体绕不过去：结尾斜杠、大小写、百分号编码、双斜杠、分号参数、点段、查询串里夹带 purpose——没有一个返回 2xx，数据库不变", async () => {
  const tokens: Record<Entry, string> = {
    platform: await temporarySuperAdmin("path@platform.test"),
    tenant: (await flaggedTenantUser(tenantA, "path@a.test")).token,
  };
  const before = await snapshot();
  const seen: string[] = [];
  for (const entry of ["platform", "tenant"] as const) {
    for (const [method, url, body] of generalRequests(entry, { tenantId: tenantA.tenantId, userId: tenantA.adminId })) {
      const last = url.slice(url.lastIndexOf("/") + 1);
      const variants = [
        `${url}/`,
        `${url}//`,
        url.toUpperCase(),
        url.replace(`/${entry}/`, `/${entry.toUpperCase()}/`),
        url.replace("/v1/", "/V1/"),
        url.replace("/v1/", "/v1//"),
        `/${url}`,
        url.replace("/v1/", "/%76%31/"),
        url.replace("/v1/", "/v1/%2e/"),
        url.replace("/v1/", "/v1/auth/me/../"),
        url.replace("/v1/", "/v1/auth/me/%2e%2e/"),
        url.replace("/v1/", "/v1/auth/%2e%2e/"),
        `${url.slice(0, url.lastIndexOf("/") + 1)}%${last.charCodeAt(0).toString(16)}${last.slice(1)}`,
        `${url};purpose=self_service`,
        `${url}?purpose=self_service`,
        `${url}?must_change_password=false`,
        `${url}#/auth/me`,
        `${url}%00`,
        `${url}%20`,
      ];
      for (const variant of variants) {
        const res = await raw(method, variant, tokens[entry], {}, body);
        seen.push(`${res.status}`);
        assert.ok(res.status >= 400 && res.status < 500, `${method} ${variant} → ${res.status} ${res.text.slice(0, 200)}`);
        // 路由认得的写法必须是「先改密码」；不认得的是 404 / 400。无论哪种都不能把数据交出去
        if (res.status === 403) assert.equal(res.body?.error?.code, CODE, `${method} ${variant}`);
        else assert.ok([400, 404].includes(res.status), `${method} ${variant} → ${res.status} ${res.text.slice(0, 200)}`);
        assert.ok(!res.text.includes('"items"') && !res.text.includes('"token"'), `${method} ${variant} 的应答里有业务数据`);
      }
    }
  }
  assert.ok(seen.includes("403"), "至少有一种变体被路由认得并走到了鉴权");
  assert.deepEqual(await snapshot(), before);
});

test("方法变体绕不过去：HEAD 和 GET 一样被拦（查看集成的 HEAD 不写审计），OPTIONS / 换方法 / 方法覆盖请求头都拿不到数据，数据库不变", async () => {
  const tokens: Record<Entry, string> = {
    platform: await temporarySuperAdmin("method@platform.test"),
    tenant: (await flaggedTenantUser(tenantA, "method@a.test")).token,
  };
  const before = await snapshot();
  const overrides = { "x-http-method-override": "GET", "x-http-method": "GET", "x-method-override": "GET" };
  for (const entry of ["platform", "tenant"] as const) {
    for (const [method, url, body] of generalRequests(entry, { tenantId: tenantA.tenantId, userId: tenantA.adminId })) {
      if (method === "GET") {
        const head = await raw("HEAD", url, tokens[entry]);
        assert.equal(head.status, 403, `HEAD ${url}`);
      }
      for (const other of ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"]) {
        const res = await raw(other, url, tokens[entry], overrides, other === "GET" || other === "HEAD" ? undefined : body);
        assert.ok(res.status >= 400 && res.status < 500, `${other} ${url} → ${res.status} ${res.text.slice(0, 200)}`);
        if (res.status === 403 && other !== "HEAD") assert.equal(res.body?.error?.code, CODE, `${other} ${url}`);
        assert.ok(!res.text.includes('"items"'), `${other} ${url} 的应答里有业务数据`);
      }
    }
    // 把「放行的接口」的地址换个方法，不会变成别的什么
    for (const other of ["PUT", "PATCH", "DELETE"]) {
      for (const path of ["auth/me", "auth/change-password", "auth/logout"]) {
        const res = await raw(other, `/${entry}/v1/${path}`, tokens[entry], {}, { current_password: TEMPORARY, new_password: NEW_PASSWORD });
        assert.equal(res.status, 404, `${other} ${path}`);
      }
    }
    // GET 去调改密码 / 退出：不是已注册的路由
    assert.equal((await raw("GET", `/${entry}/v1/auth/change-password?current_password=${TEMPORARY}&new_password=${NEW_PASSWORD}`, tokens[entry])).status, 404);
    assert.equal((await raw("GET", `/${entry}/v1/auth/logout`, tokens[entry])).status, 404);
  }
  assert.deepEqual(await snapshot(), before);
  assert.equal(await flagOf("platform_users", "method@platform.test"), true);
  assert.equal((await api.call("GET", "/platform/v1/auth/me", { token: tokens.platform })).status, 200, "会话还在：上面没有一个请求把它退出");
});

test("令牌的写法变体：小写 bearer、多余空格、查询串 / 请求体 / Cookie 里带令牌——要么照常被拦，要么 401，没有一种变成放行", async () => {
  const token = await temporarySuperAdmin("scheme@platform.test");
  const send = async (headers: Record<string, string>, url = "/platform/v1/staff"): Promise<ApiResponse> => {
    const res = await api.app.inject({ method: "GET", url, headers });
    return { status: res.statusCode, headers: res.headers, text: res.body, body: res.body === "" ? null : res.json() };
  };
  for (const [label, headers, url] of [
    ["小写 bearer", { authorization: `bearer ${token}` }],
    ["大写 BEARER", { authorization: `BEARER ${token}` }],
    ["两个空格", { authorization: `Bearer  ${token}` }],
    ["结尾空格", { authorization: `Bearer ${token} ` }],
    ["没有 Bearer", { authorization: token }],
    ["Cookie", { cookie: `access_token=${token}` }],
    ["查询串", {}, `/platform/v1/staff?access_token=${token}`],
    ["自定义请求头", { "x-access-token": token }],
  ] as [string, Record<string, string>, string?][]) {
    const res = await send(headers, url);
    assert.ok(res.status === 401 || res.status === 403, `${label} → ${res.status}`);
    assert.equal(res.body.error.code, res.status === 401 ? "UNAUTHENTICATED" : CODE, label);
  }
});

test("请求里夹带标记字段没有用：登录、改密、租户管理员改用户、平台邀请员工的请求体里写 must_change_password: false，标记都不变", async () => {
  const platformToken = await temporarySuperAdmin("mass@platform.test");
  const tenant = await flaggedTenantUser(tenantA, "mass@a.test");

  const loggedIn = await api.call("POST", "/platform/v1/auth/login", {
    ip: freshIp(),
    body: { email: "mass@platform.test", password: TEMPORARY, must_change_password: false, purpose: "self_service" },
  });
  if (loggedIn.status === 200) assert.equal(loggedIn.body.must_change_password, true);
  else assert.equal(loggedIn.status, 400, loggedIn.text);

  const noop = await api.call("POST", "/platform/v1/auth/change-password", {
    token: platformToken,
    ip: freshIp(),
    body: { current_password: TEMPORARY, new_password: TEMPORARY, must_change_password: false },
  });
  assert.equal(noop.status, 400, noop.text);
  assert.equal(await flagOf("platform_users", "mass@platform.test"), true);

  // 租户管理员对被标记的同事做一次合法的资料修改：改得了资料，清不了标记
  const updated = await api.call("PUT", `/tenant/v1/users/${tenant.id}`, {
    token: tenantA.adminToken,
    body: { name: "改了名字", role: "admin", status: "active", must_change_password: false, mustChangePassword: false },
  });
  assert.ok(updated.status === 200 || updated.status === 400, updated.text);
  assert.ok(!updated.text.includes("must_change_password") || updated.status === 400);
  assert.equal(await flagOf("tenant_users", "mass@a.test"), true);
  assertBlocked(await api.call("GET", "/tenant/v1/users", { token: tenant.token }), "被管理员改过资料之后仍然被拦");

  // 邀请时夹带 must_change_password: true 也不会造出一个带标记的待激活账号
  const invited = await api.call("POST", "/platform/v1/staff", {
    token: rootToken,
    body: { email: "mass-invited@platform.test", name: "受邀", role: "finance", must_change_password: true },
  });
  assert.ok(invited.status === 201 || invited.status === 400, invited.text);
  if (invited.status === 201) assert.equal(await flagOf("platform_users", "mass-invited@platform.test"), false);
});

test("停用再启用：标记不变、停用前的令牌不复活；启用后用临时密码登录仍然必须先改密码（平台和租户）", async () => {
  const platform = await temporarySuperAdmin("toggle@platform.test");
  const platformId = (await api.call("GET", "/platform/v1/auth/me", { token: platform })).body.user.id as string;
  assert.equal((await api.call("POST", `/platform/v1/staff/${platformId}/disable`, { token: rootToken })).status, 200);
  assert.equal(await flagOf("platform_users", "toggle@platform.test"), true);
  const enabled = await api.call("POST", `/platform/v1/staff/${platformId}/enable`, { token: rootToken });
  assert.equal(enabled.status, 200, enabled.text);
  assert.ok(!enabled.text.includes("must_change_password"));
  assert.equal(await flagOf("platform_users", "toggle@platform.test"), true);
  assert.equal((await api.call("GET", "/platform/v1/auth/me", { token: platform })).status, 401, "停用前的令牌不复活");
  const again = await login("platform", "toggle@platform.test", TEMPORARY);
  assert.equal(again.body.must_change_password, true);
  assertBlocked(await api.call("GET", "/platform/v1/staff", { token: again.body.access_token }), "启用后");

  const tenant = await flaggedTenantUser(tenantA, "toggle@a.test", "dispatch");
  const body = { name: "toggle@a.test", role: "dispatch" };
  assert.equal((await api.call("PUT", `/tenant/v1/users/${tenant.id}`, { token: tenantA.adminToken, body: { ...body, status: "disabled" } })).status, 200);
  assert.equal(await flagOf("tenant_users", "toggle@a.test"), true);
  assert.equal((await api.call("PUT", `/tenant/v1/users/${tenant.id}`, { token: tenantA.adminToken, body: { ...body, status: "active" } })).status, 200);
  assert.equal(await flagOf("tenant_users", "toggle@a.test"), true);
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: tenant.token })).status, 401);
  const tenantAgain = await login("tenant", "toggle@a.test", TEST_PASSWORD);
  assert.equal(tenantAgain.body.must_change_password, true);
  assertBlocked(await api.call("GET", "/tenant/v1/audit-logs", { token: tenantAgain.body.access_token }), "租户用户启用后");

  // 换角色也不清标记
  assert.equal((await api.call("PUT", `/tenant/v1/users/${tenant.id}`, { token: tenantA.adminToken, body: { name: "x", role: "admin", status: "active" } })).status, 200);
  assert.equal(await flagOf("tenant_users", "toggle@a.test"), true);
  assertBlocked(await api.call("GET", "/tenant/v1/users", { token: tenantAgain.body.access_token }), "升成管理员之后");
});

test("租户被暂停、被标记的用户：登录照常、仍然只能改密码；改完恢复（暂停不影响强制逻辑，强制逻辑也不影响别的租户）", async () => {
  const created = await api.tenantWithAdmin(rootToken, "暂停的车队", "admin@suspended.test");
  await api.db.owner.query("update tenant_users set must_change_password = true where id = $1", [created.adminId]);
  assert.equal((await api.call("POST", `/platform/v1/tenants/${created.tenantId}/suspend`, { token: rootToken, body: { reason: "测试" } })).status, 200);
  const loggedIn = await login("tenant", "admin@suspended.test", TEST_PASSWORD);
  assert.equal(loggedIn.body.must_change_password, true);
  assert.equal(loggedIn.body.tenant.status, "suspended");
  const token = loggedIn.body.access_token as string;
  assertBlocked(await api.call("GET", "/tenant/v1/users", { token }), "暂停的租户里被标记的用户");
  const changed = await api.call("POST", "/tenant/v1/auth/change-password", { token, ip: freshIp(), body: { current_password: TEST_PASSWORD, new_password: NEW_PASSWORD } });
  assert.equal(changed.status, 204, changed.text);
  assert.equal((await api.call("GET", "/tenant/v1/users", { token })).status, 200);
  // 甲、乙两个租户的管理员从头到尾没被标记过
  assert.equal(await flagOf("tenant_users", "admin@a.test"), false);
  assert.equal(await flagOf("tenant_users", "admin@b.test"), false);
  assert.equal((await api.call("GET", "/tenant/v1/users", { token: tenantB.adminToken })).status, 200);
});

test("改密失败的每一种情况之后标记和密码哈希都原样（两侧）：缺字段、类型不对、当前密码错、与当前相同、太短、太长、类别不够、重复字符、含邮箱名", async () => {
  await temporarySuperAdmin("failures@platform.test");
  await flaggedTenantUser(tenantA, "failures@a.test");
  for (const [entry, table, email, current] of [
    ["platform", "platform_users", "failures@platform.test", TEMPORARY],
    ["tenant", "tenant_users", "failures@a.test", TEST_PASSWORD],
  ] as const) {
    const token = (await login(entry, email, current)).body.access_token as string;
    const hash = await hashOf(table, email);
    const cases: [string, unknown, number, string][] = [
      ["没有请求体", undefined, 400, "VALIDATION_FAILED"],
      ["缺新密码", { current_password: current }, 400, "VALIDATION_FAILED"],
      ["缺当前密码", { new_password: NEW_PASSWORD }, 400, "VALIDATION_FAILED"],
      ["新密码是数字", { current_password: current, new_password: 123456789012 }, 400, "VALIDATION_FAILED"],
      ["新密码是 null", { current_password: current, new_password: null }, 400, "VALIDATION_FAILED"],
      ["当前密码错", { current_password: "Not-The-Right-One-1", new_password: NEW_PASSWORD }, 400, "CURRENT_PASSWORD_INCORRECT"],
      ["当前密码为空", { current_password: "", new_password: NEW_PASSWORD }, 400, ""],
      ["与当前相同", { current_password: current, new_password: current }, 400, "PASSWORD_UNCHANGED"],
      ["太短", { current_password: current, new_password: "Ab1-xyz" }, 400, "WEAK_PASSWORD"],
      ["类别不够", { current_password: current, new_password: "abcdefghijklmnop" }, 400, "WEAK_PASSWORD"],
      ["重复字符", { current_password: current, new_password: "Aa1Aa1Aa1Aa1" }, 400, "WEAK_PASSWORD"],
      ["含邮箱名", { current_password: current, new_password: "Failures-Lantern-2027" }, 400, "WEAK_PASSWORD"],
      ["太长", { current_password: current, new_password: `Aa1-${"xyz9".repeat(40)}` }, 400, ""],
    ];
    for (const [label, body, status, code] of cases) {
      const res = await api.call("POST", `/${entry}/v1/auth/change-password`, { token, ip: freshIp(), ...(body === undefined ? {} : { body }) });
      assert.equal(res.status, status, `${entry} ${label}: ${res.text}`);
      if (code !== "") assert.equal(res.body.error.code, code, `${entry} ${label}`);
      assert.equal(await flagOf(table, email), true, `${entry} ${label}：标记被清掉了`);
      assert.equal(await hashOf(table, email), hash, `${entry} ${label}：密码被改了`);
      assertBlocked(await api.call("GET", `/${entry}/v1/${entry === "platform" ? "staff" : "users"}`, { token }), `${entry} ${label} 之后`);
    }
    assert.ok(!api.logs().includes(current) || current === TEST_PASSWORD, "应用日志里没有临时密码");
  }
  assert.ok(!api.logs().includes(TEMPORARY), "应用日志里没有临时密码");
});

test("猜临时密码被限速：同一来源连续 5 次当前密码不对之后是 429，标记还在、其他接口仍然被拦；换个来源用对的临时密码照样能改", async () => {
  const token = await temporarySuperAdmin("throttle@platform.test");
  const ip = freshIp();
  const guess = (current: string, from = ip): Promise<ApiResponse> =>
    api.call("POST", "/platform/v1/auth/change-password", { token, ip: from, body: { current_password: current, new_password: NEW_PASSWORD } });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal((await guess(`Wrong-Guess-000${attempt}`)).body.error.code, "CURRENT_PASSWORD_INCORRECT");
  }
  const throttled = await guess(TEMPORARY);
  assert.equal(throttled.status, 429, "第 6 次即使猜对也不验证");
  assert.ok(Number(throttled.headers["retry-after"]) > 0);
  assert.equal(await flagOf("platform_users", "throttle@platform.test"), true);
  assertBlocked(await api.call("GET", "/platform/v1/staff", { token }), "被限速期间");
  assert.equal((await api.call("GET", "/platform/v1/auth/me", { token })).body.must_change_password, true);

  const elsewhere = await guess(TEMPORARY, freshIp());
  assert.equal(elsewhere.status, 204, elsewhere.text);
  assert.equal(await flagOf("platform_users", "throttle@platform.test"), false);
});

test("重复提交：改密成功后把同一个请求原样再发一次——400 当前密码不正确，密码仍是第一次改成的那个，标记保持 false，只有一条 change_password 审计", async () => {
  const token = await temporarySuperAdmin("replay@platform.test");
  const body = { current_password: TEMPORARY, new_password: NEW_PASSWORD };
  assert.equal((await api.call("POST", "/platform/v1/auth/change-password", { token, ip: freshIp(), body })).status, 204);
  const hash = await hashOf("platform_users", "replay@platform.test");
  const replay = await api.call("POST", "/platform/v1/auth/change-password", { token, ip: freshIp(), body });
  assert.equal(replay.status, 400, replay.text);
  assert.equal(replay.body.error.code, "CURRENT_PASSWORD_INCORRECT");
  assert.equal(await hashOf("platform_users", "replay@platform.test"), hash);
  assert.equal(await flagOf("platform_users", "replay@platform.test"), false);
  assert.equal((await api.call("GET", "/platform/v1/staff", { token })).status, 200, "重复提交不会把自己的会话弄丢");
  const audit = await api.db.owner.query(
    "select count(*)::int as n from audit_logs where action = 'change_password' and actor_email = 'replay@platform.test'",
  );
  assert.equal(audit.rows[0].n, 1);
});

test("改密的同时并发调别的接口：每个应答要么是「先改密码」要么是正常结果，没有 5xx、没有半成品；改完之后全部正常（平台和租户）", async () => {
  const platform = await temporarySuperAdmin("mixed@platform.test");
  const tenant = await flaggedTenantUser(tenantB, "mixed@b.test");
  for (const [entry, token, current, path] of [
    ["platform", platform, TEMPORARY, "staff"],
    ["tenant", tenant.token, TEST_PASSWORD, "users"],
  ] as const) {
    const others = Array.from({ length: 24 }, (_, index) =>
      new Promise<ApiResponse>((resolve, reject) => {
        setTimeout(() => api.call("GET", `/${entry}/v1/${index % 2 === 0 ? path : "auth/me"}`, { token }).then(resolve, reject), index * 15);
      }),
    );
    const change = api.call("POST", `/${entry}/v1/auth/change-password`, { token, ip: freshIp(), body: { current_password: current, new_password: NEW_PASSWORD } });
    const [changed, ...responses] = await Promise.all([change, ...others]);
    assert.equal(changed?.status, 204, changed?.text);
    let sawAllowedAfterBlocked = false;
    let allowed = false;
    for (const [index, res] of responses.entries()) {
      if (index % 2 === 1) {
        assert.equal(res.status, 200, `auth/me 第 ${index} 个: ${res.text}`);
        assert.equal(typeof res.body.must_change_password, "boolean");
        continue;
      }
      assert.ok(res.status === 200 || (res.status === 403 && res.body.error.code === CODE), `${entry} 第 ${index} 个: ${res.status} ${res.text}`);
      if (res.status === 200) allowed = true;
      // 一旦放行就不会再回到被拦（请求按发出顺序排列；标记只会从 true 变成 false）
      if (res.status === 403 && allowed) sawAllowedAfterBlocked = true;
    }
    assert.equal(sawAllowedAfterBlocked, false, "放行之后又被拦了一次");
    assert.equal((await api.call("GET", `/${entry}/v1/${path}`, { token })).status, 200);
  }
});

test("【缺陷】两个会话同时用同一个临时密码改密：只能有一个成功；现在两个都返回 204，后写的悄悄盖掉先写的，先成功的人的新密码和会话都没了（平台）", async () => {
  await createSuperAdmin(api.db.pool, { email: "race@platform.test", name: "并发", password: TEMPORARY, temporaryPassword: true }, api.clock.now());
  const first = (await login("platform", "race@platform.test", TEMPORARY)).body.access_token as string;
  const second = (await login("platform", "race@platform.test", TEMPORARY)).body.access_token as string;
  const change = (token: string, next: string): Promise<ApiResponse> =>
    api.call("POST", "/platform/v1/auth/change-password", { token, ip: freshIp(), body: { current_password: TEMPORARY, new_password: next } });

  const [a, b] = await Promise.all([change(first, NEW_PASSWORD), change(second, OTHER_PASSWORD)]);
  const statuses = [a.status, b.status].sort();
  // 无论谁赢，下面这些都必须成立
  assert.equal(await flagOf("platform_users", "race@platform.test"), false);
  assert.equal((await api.call("POST", "/platform/v1/auth/login", { ip: freshIp(), body: { email: "race@platform.test", password: TEMPORARY } })).status, 401);
  const works = await Promise.all(
    [NEW_PASSWORD, OTHER_PASSWORD].map(async (password) => (await api.call("POST", "/platform/v1/auth/login", { ip: freshIp(), body: { email: "race@platform.test", password } })).status),
  );
  assert.equal(works.filter((status) => status === 200).length, 1, "最后只有一个新密码有效");

  assert.equal(statuses[0], 204, `至少一个成功：${a.text} ${b.text}`);
  assert.notEqual(statuses[1], 204, "临时密码被用了两次：两个请求都被告知「改好了」，但只有后写的那个密码有效");
  // 被告知成功的那一方，它的新密码必须真的能登录、它的会话必须还在
  for (const [res, token, password] of [
    [a, first, NEW_PASSWORD],
    [b, second, OTHER_PASSWORD],
  ] as const) {
    if (res.status !== 204) continue;
    assert.equal((await api.call("GET", "/platform/v1/auth/me", { token })).status, 200, "被告知成功的会话却失效了");
    assert.equal(works[password === NEW_PASSWORD ? 0 : 1], 200, "被告知成功的新密码却登录不了");
  }
});

test("【缺陷】两个会话同时用同一个密码改密：只能有一个成功（租户一侧同样的问题）", async () => {
  const member = await addTenantUser(api, tenantB.adminToken, "race@b.test", "dispatch");
  await api.db.owner.query("update tenant_users set must_change_password = true where id = $1", [member.id]);
  const first = (await login("tenant", "race@b.test", TEST_PASSWORD)).body.access_token as string;
  const second = (await login("tenant", "race@b.test", TEST_PASSWORD)).body.access_token as string;
  const change = (token: string, next: string): Promise<ApiResponse> =>
    api.call("POST", "/tenant/v1/auth/change-password", { token, ip: freshIp(), body: { current_password: TEST_PASSWORD, new_password: next } });

  const [a, b] = await Promise.all([change(first, NEW_PASSWORD), change(second, OTHER_PASSWORD)]);
  assert.equal(await flagOf("tenant_users", "race@b.test"), false);
  assert.equal([a.status, b.status].filter((status) => status === 204).length, 1, `两个请求的结果：${a.status}、${b.status}（应当恰好一个 204）`);
});

test("同一个会话把改密请求同时发两次（双击）：密码最终是这个新密码、标记清除、会话还在；不会两个都失败", async () => {
  const token = await temporarySuperAdmin("double@platform.test");
  const body = { current_password: TEMPORARY, new_password: NEW_PASSWORD };
  const [a, b] = await Promise.all([
    api.call("POST", "/platform/v1/auth/change-password", { token, ip: freshIp(), body }),
    api.call("POST", "/platform/v1/auth/change-password", { token, ip: freshIp(), body }),
  ]);
  assert.ok(a.status === 204 || b.status === 204, `${a.text} ${b.text}`);
  for (const res of [a, b]) assert.ok(res.status === 204 || res.status === 400, res.text);
  assert.equal(await flagOf("platform_users", "double@platform.test"), false);
  assert.equal((await api.call("GET", "/platform/v1/staff", { token })).status, 200);
  assert.equal((await login("platform", "double@platform.test", NEW_PASSWORD)).body.must_change_password, false);
});

test("标记不进令牌、不进别人看得到的任何地方：租户令牌的内容、平台和租户两边的审计查询、租户详情、发重置 / 启用停用的应答", async () => {
  const tenant = await flaggedTenantUser(tenantA, "hidden@a.test");
  const claims = JSON.parse(Buffer.from(tenant.token.split(".")[1] as string, "base64url").toString("utf8"));
  assert.deepEqual(Object.keys(claims).sort(), ["aud", "exp", "iat", "role", "sid", "sub", "tid"]);
  assert.ok(!JSON.stringify(claims).includes("must") && !JSON.stringify(claims).includes("temporary"));

  const responses = await Promise.all([
    api.call("GET", "/tenant/v1/users?limit=200", { token: tenantA.adminToken }),
    api.call("GET", "/tenant/v1/audit-logs?limit=200", { token: tenantA.adminToken }),
    api.call("GET", `/tenant/v1/audit-logs?resource_id=${tenant.id}&limit=200`, { token: tenantA.adminToken }),
    api.call("POST", `/tenant/v1/users/${tenant.id}/password-reset`, { token: tenantA.adminToken }),
    api.call("GET", `/platform/v1/tenants/${tenantA.tenantId}`, { token: rootToken }),
    api.call("GET", "/platform/v1/tenants?limit=200", { token: rootToken }),
    api.call("GET", "/platform/v1/staff?limit=200", { token: rootToken }),
    api.call("GET", `/platform/v1/audit-logs?tenant_id=${tenantA.tenantId}&limit=200`, { token: rootToken }),
  ]);
  for (const res of responses) {
    assert.ok(res.status === 200 || res.status === 201, res.text);
    assert.ok(!res.text.includes("must_change_password"), `应答里出现了标记：${res.text.slice(0, 300)}`);
  }
  // 租户的审计查询里连「用过临时密码」这件事也没有（那是平台账号的事）
  assert.ok(!(responses[1] as ApiResponse).text.includes("temporary_password"));
  // 审计表里任何一行都没有记下标记本身
  const audit = JSON.stringify((await api.db.owner.query("select before, after from audit_logs")).rows);
  assert.ok(!audit.includes("must_change_password"));
});

test("错误应答与 openapi.yaml 对账：PASSWORD_CHANGE_REQUIRED 的应答是定义里的 ErrorResponse；登录和 auth/me 的真实字段与定义的必填字段、类型一致（两侧）", async () => {
  interface Schema {
    type?: string;
    required?: string[];
    properties?: Record<string, { $ref?: string; type?: string }>;
    additionalProperties?: boolean;
  }
  const doc = parse(await readFile(new URL("../openapi.yaml", import.meta.url), "utf8")) as {
    info: { description: string };
    paths: Record<string, Record<string, { responses: Record<string, { content?: Record<string, { schema: Schema & { $ref?: string } }> }> }>>;
    components: { schemas: Record<string, Schema> };
  };
  assert.equal(doc.components.schemas["MustChangePassword"]?.type, "boolean");
  assert.match(doc.info.description, /403 `PASSWORD_CHANGE_REQUIRED`/);
  for (const path of ["GET auth/me", "POST auth/change-password", "POST auth/logout"]) {
    assert.ok(doc.info.description.includes(`\`${path}\``), `总说明里列出了放行的接口 ${path}`);
  }

  const platformToken = await temporarySuperAdmin("contract@platform.test");
  const tenant = await flaggedTenantUser(tenantA, "contract@a.test");
  const blocked = await api.call("GET", "/platform/v1/staff", { token: platformToken });
  const errorSchema = doc.components.schemas["ErrorResponse"] as Schema;
  assert.deepEqual(Object.keys(blocked.body), errorSchema.required);
  assert.deepEqual(Object.keys(blocked.body.error).sort(), ["code", "details", "message"]);
  assert.equal(blocked.headers["cache-control"], "no-store");
  assert.match(String(blocked.headers["content-type"]), /^application\/json/);

  for (const [entry, schemaName, email, password, token] of [
    ["platform", "PlatformLoginResponse", "contract@platform.test", TEMPORARY, platformToken],
    ["tenant", "TenantLoginResponse", "contract@a.test", TEST_PASSWORD, tenant.token],
  ] as const) {
    const loginSchema = doc.components.schemas[schemaName] as Schema;
    assert.equal(loginSchema.additionalProperties, false);
    assert.equal(loginSchema.properties?.["must_change_password"]?.$ref, "#/components/schemas/MustChangePassword");
    const loggedIn = await login(entry, email, password);
    assert.deepEqual(Object.keys(loggedIn.body).sort(), [...(loginSchema.required ?? [])].sort());
    assert.deepEqual(Object.keys(loggedIn.body).sort(), Object.keys(loginSchema.properties ?? {}).sort());
    assert.equal(loggedIn.body.must_change_password, true);

    const meSchema = doc.paths[`/${entry}/v1/auth/me`]?.["get"]?.responses["200"]?.content?.["application/json"]?.schema as Schema;
    const me = await api.call("GET", `/${entry}/v1/auth/me`, { token });
    assert.deepEqual(Object.keys(me.body).sort(), [...(meSchema.required ?? [])].sort());
    assert.deepEqual(Object.keys(me.body).sort(), Object.keys(meSchema.properties ?? {}).sort());
    assert.equal(me.body.must_change_password, true);

    // 账号对象的定义里没有这个字段，真实应答里也没有
    const userSchema = doc.components.schemas[entry === "platform" ? "PlatformUser" : "TenantUser"] as Schema;
    assert.ok(!("must_change_password" in (userSchema.properties ?? {})));
    assert.deepEqual(Object.keys(me.body.user).sort(), Object.keys(userSchema.properties ?? {}).sort());
  }
});

// 放在文件最后：它把时钟拨过了 8 小时，before() 里建的会话此后全部过期。
test("会话过期后是 401 而不是 403：过期的令牌连「先改密码」都不该知道；标记留在账号上，重新登录仍然要改", async () => {
  await createSuperAdmin(api.db.pool, { email: "expire@platform.test", name: "过期", password: TEMPORARY, temporaryPassword: true }, api.clock.now());
  const member = await addTenantUser(api, tenantB.adminToken, "expire@b.test", "admin");
  await api.db.owner.query("update tenant_users set must_change_password = true where id = $1", [member.id]);
  const platform = (await login("platform", "expire@platform.test", TEMPORARY)).body.access_token as string;
  const tenant = (await login("tenant", "expire@b.test", TEST_PASSWORD)).body.access_token as string;

  api.clock.advance(SESSION_TTL_MS - 1_000);
  assertBlocked(await api.call("GET", "/platform/v1/staff", { token: platform }), "到期前一秒（平台）");
  assertBlocked(await api.call("GET", "/tenant/v1/users", { token: tenant }), "到期前一秒（租户）");
  assert.equal((await api.call("GET", "/platform/v1/auth/me", { token: platform })).status, 200);

  api.clock.advance(1_000);
  for (const [entry, token, path] of [
    ["platform", platform, "staff"],
    ["tenant", tenant, "users"],
  ] as const) {
    for (const [method, url] of [
      ["GET", `/${entry}/v1/${path}`],
      ["GET", `/${entry}/v1/auth/me`],
      ["POST", `/${entry}/v1/auth/logout`],
    ] as const) {
      const res = await api.call(method, url, { token });
      assert.equal(res.status, 401, `${method} ${url}: ${res.text}`);
      assert.equal(res.body.error.code, "UNAUTHENTICATED");
    }
    const change = await api.call("POST", `/${entry}/v1/auth/change-password`, {
      token,
      body: { current_password: entry === "platform" ? TEMPORARY : TEST_PASSWORD, new_password: NEW_PASSWORD },
    });
    assert.equal(change.status, 401, "过期的会话改不了密码");
  }
  assert.equal(await flagOf("platform_users", "expire@platform.test"), true);
  assert.equal(await flagOf("tenant_users", "expire@b.test"), true);
  assert.equal((await login("platform", "expire@platform.test", TEMPORARY)).body.must_change_password, true);
  assert.equal((await login("tenant", "expire@b.test", TEST_PASSWORD)).body.must_change_password, true);
});
