/**
 * 不怀好意的输入：超大请求体、错误的 Content-Type、SQL 注入式的字符串、分页参数边界、非法的路径编号、
 * 伪造的 X-Forwarded-For。要求：一律是统一格式的 4xx，不能是 500，更不能改动数据。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "@nozomi/config";
import { buildApp } from "./app.ts";
import { loadMigrationFiles } from "./db/migrate.ts";
import { type ApiResponse, type HttpMethod, type TenantFixture, type TestApi, createTestApi } from "./testing/api.ts";
import { testEnv } from "./testing/fixtures.ts";

let api: TestApi;
let platformToken: string;
let a: TenantFixture;

before(async () => {
  api = await createTestApi();
  platformToken = await api.superAdminToken();
  a = await api.tenantWithAdmin(platformToken, "车队甲", "admin@a.test");
});
after(() => api.close());

const cursorOf = (value: unknown): string => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
const SOME_ID = "00000000-0000-4000-8000-000000000000";

function assertErrorShape(res: ApiResponse, label: string): void {
  assert.equal(typeof res.body?.error?.code, "string", `${label}: 不是统一错误格式 ${res.text.slice(0, 120)}`);
  assert.equal(typeof res.body.error.message, "string", label);
  assert.equal(typeof res.body.error.details, "object", label);
}

/** 发一组请求，返回其中应答为 5xx 的那些（用于一次列出全部出问题的输入）。 */
async function serverErrors(cases: [string, HttpMethod, string, { token?: string; body?: unknown }][]): Promise<string[]> {
  const failed: string[] = [];
  for (const [label, method, url, options] of cases) {
    const res = await api.call(method, url, options);
    if (res.status >= 500) failed.push(`${label} → ${res.status}`);
  }
  return failed;
}

const LISTS: [string, () => string][] = [
  ["/tenant/v1/users", () => a.adminToken],
  ["/platform/v1/tenants", () => platformToken],
  ["/platform/v1/staff", () => platformToken],
  ["/platform/v1/audit-logs", () => platformToken],
];

test("分页 limit 的边界：1 和 200 可以；0、负数、201、小数、非数字、空、重复参数都是 400", async () => {
  for (const [path, token] of LISTS) {
    for (const ok of ["1", "200"]) {
      const res = await api.call("GET", `${path}?limit=${ok}`, { token: token() });
      assert.equal(res.status, 200, `${path}?limit=${ok}: ${res.text}`);
    }
    for (const bad of ["0", "-1", "201", "99999999999999999999", "1.5", "abc", "", "NaN", "Infinity", "1;drop table tenants", "1&limit=2"]) {
      const res = await api.call("GET", `${path}?limit=${bad}`, { token: token() });
      assert.equal(res.status, 400, `${path}?limit=${bad}: ${res.status} ${res.text}`);
      assert.equal(res.body.error.code, "VALIDATION_FAILED");
      assert.equal(res.body.error.details.location, "querystring");
    }
  }
});

test("乱写的游标（不是 base64、不是 JSON、字段类型不对、SQL 片段、超长、重复参数）：400，指出是 cursor", async () => {
  const bad = [
    "not-base64!!",
    cursorOf("just a string"),
    cursorOf(null),
    cursorOf([1, 2]),
    cursorOf({}),
    cursorOf({ t: 1, id: 2 }),
    cursorOf({ t: "2026-10-07 01:00:00+00", id: "x' or '1'='1" }),
    cursorOf({ t: "2026-10-07 01:00:00+00'; drop table tenants; --", id: SOME_ID }),
    cursorOf({ id: "1 or 1=1" }),
    cursorOf({ id: "-1" }),
    cursorOf({ id: 5 }),
    "A".repeat(501),
    "a&cursor=b",
  ];
  for (const [path, token] of LISTS) {
    for (const cursor of bad) {
      const res = await api.call("GET", `${path}?cursor=${cursor}`, { token: token() });
      assert.equal(res.status, 400, `${path} ${cursor.slice(0, 40)}: ${res.status} ${res.text}`);
      assert.equal(res.body.error.code, "VALIDATION_FAILED");
    }
  }
});

/**
 * 缺陷：游标只校验了「长得像」时间 / 数字，值不合法时（13 月、时区 +99、超过 bigint 的编号）
 * 直接被带进 SQL，数据库转换报错，接口返回 500 并记一条 error 日志。
 */
test("游标形状对但值不合法（不存在的日期、越界的时区、超出范围的编号）：应当 400，而不是 500", async () => {
  const cases: [string, HttpMethod, string, { token?: string }][] = [];
  const badTimes = ["2026-13-45 25:61:61+00", "2026-02-30 00:00:00+00", "0000-00-00 00:00:00+00", "2026-01-01 00:00:00+99", "2026-01-01 24:00:01.999999+00"];
  for (const [path, token] of LISTS.slice(0, 3)) {
    for (const t of badTimes) cases.push([`${path} 游标时间 ${t}`, "GET", `${path}?cursor=${cursorOf({ t, id: SOME_ID })}`, { token: token() }]);
  }
  cases.push(["/platform/v1/audit-logs 游标编号 9999999999999999999", "GET", `/platform/v1/audit-logs?cursor=${cursorOf({ id: "9999999999999999999" })}`, { token: platformToken }]);
  cases.push(["/platform/v1/audit-logs 游标编号 9223372036854775808", "GET", `/platform/v1/audit-logs?cursor=${cursorOf({ id: "9223372036854775808" })}`, { token: platformToken }]);
  assert.deepEqual(await serverErrors(cases), []);
  for (const [label, method, url, options] of cases) {
    const res = await api.call(method, url, options);
    assert.equal(res.status, 400, label);
  }
});

/**
 * 缺陷：字符串字段没有拦截 NUL 字符（JSON 里的 \u0000、查询串里的 %00）。PostgreSQL 的 text / jsonb 不接受它，
 * 写入或查询时报错，接口返回 500 并记一条 error 日志。任何登录用户（审计筛选是平台账号）都能随手触发。
 */
test("字符串里带 NUL 字符（姓名、租户名称、暂停原因、审计筛选条件）：应当 400，而不是 500", async () => {
  const nul = "甲\u0000乙";
  const cases: [string, HttpMethod, string, { token?: string; body?: unknown }][] = [
    ["邀请租户用户 name", "POST", "/tenant/v1/users", { token: a.adminToken, body: { email: "nul-1@a.test", name: nul, role: "readonly" } }],
    ["修改租户用户 name", "PUT", `/tenant/v1/users/${a.adminId}`, { token: a.adminToken, body: { name: nul, role: "admin", status: "active" } }],
    ["创建租户 name", "POST", "/platform/v1/tenants", { token: platformToken, body: { name: nul, admin: { email: "nul-2@c.test", name: "丙" } } }],
    ["创建租户 admin.name", "POST", "/platform/v1/tenants", { token: platformToken, body: { name: "车队丙", admin: { email: "nul-3@c.test", name: nul } } }],
    ["补发管理员邀请 name", "POST", `/platform/v1/tenants/${a.tenantId}/admin-invites`, { token: platformToken, body: { email: "nul-4@a.test", name: nul } }],
    ["创建平台账号 name", "POST", "/platform/v1/staff", { token: platformToken, body: { email: "nul-5@platform.test", name: nul, role: "readonly" } }],
    ["审计筛选 resource", "GET", "/platform/v1/audit-logs?resource=a%00b", { token: platformToken }],
    ["审计筛选 resource_id", "GET", "/platform/v1/audit-logs?resource_id=%00", { token: platformToken }],
    ["审计筛选 action", "GET", "/platform/v1/audit-logs?action=login%00", { token: platformToken }],
  ];
  const failed = await serverErrors(cases);
  // 暂停放在最后单独做：它一旦成功会改变租户状态，做完立即恢复
  const suspend = await api.call("POST", `/platform/v1/tenants/${a.tenantId}/suspend`, { token: platformToken, body: { reason: nul } });
  if (suspend.status >= 500) failed.push(`暂停租户 reason → ${suspend.status}`);
  if (suspend.status === 200) await api.call("POST", `/platform/v1/tenants/${a.tenantId}/resume`, { token: platformToken });
  assert.deepEqual(failed, []);
});

/**
 * 缺陷：审计查询的 from / to 通过了格式校验但换算不出时间（时区偏移 +99:99 之类）时，
 * 一个无效的时间被传给数据库，接口返回 500。
 */
test("审计查询的时间参数格式对但时区偏移越界：应当 400，而不是 500", async () => {
  const cases: [string, HttpMethod, string, { token?: string }][] = ["2026-10-07T00:00:00+99:99", "2026-10-07T00:00:00-24:60", "2026-10-07T00:00:00+25:00"].flatMap((value) =>
    (["from", "to"] as const).map((name): [string, HttpMethod, string, { token?: string }] => [
      `${name}=${value}`,
      "GET",
      `/platform/v1/audit-logs?${name}=${encodeURIComponent(value)}`,
      { token: platformToken },
    ]),
  );
  assert.deepEqual(await serverErrors(cases), []);
});

test("审计查询的时间参数：不带时区、不存在的日期、SQL 片段是 400；带偏移的合法时间按绝对时刻比较", async () => {
  for (const bad of ["2026-10-07", "2026-10-07T00:00:00", "2026-02-30T00:00:00Z", "2026-13-01T00:00:00Z", "now()", "2026-10-07T00:00:00Z'; drop table audit_logs; --", "1"]) {
    const res = await api.call("GET", `/platform/v1/audit-logs?from=${encodeURIComponent(bad)}`, { token: platformToken });
    assert.equal(res.status, 400, `${bad}: ${res.status} ${res.text}`);
  }
  // 测试时钟是 2026-10-07T01:00:00Z = 东京时间 10:00。用 +09:00 写的 10:00 就是这一刻
  const fromNow = await api.call("GET", `/platform/v1/audit-logs?from=${encodeURIComponent("2026-10-07T10:00:00+09:00")}`, { token: platformToken });
  assert.equal(fromNow.status, 200, fromNow.text);
  assert.ok(fromNow.body.items.length > 0, "from 等于发生时刻时应包含（含起点）");
  const toNow = await api.call("GET", `/platform/v1/audit-logs?to=${encodeURIComponent("2026-10-07T10:00:00+09:00")}`, { token: platformToken });
  assert.equal(toNow.body.items.length, 0, "to 等于发生时刻时不包含（不含终点）");
  const justAfter = await api.call("GET", `/platform/v1/audit-logs?to=${encodeURIComponent("2026-10-07T10:00:00.001+09:00")}`, { token: platformToken });
  assert.ok(justAfter.body.items.length > 0);
  const inverted = await api.call("GET", `/platform/v1/audit-logs?from=2026-10-08T00:00:00Z&to=2026-10-07T00:00:00Z`, { token: platformToken });
  assert.equal(inverted.status, 200);
  assert.equal(inverted.body.items.length, 0);
});

test("SQL 注入式的输入：登录、邀请、筛选、路径编号都不会执行，表还在、数据没变", async () => {
  const before = await api.db.owner.query("select (select count(*)::int from tenant_users) as users, (select count(*)::int from tenants) as tenants, (select count(*)::int from platform_users) as staff");
  const payloads = ["' or '1'='1", "'; drop table tenant_users; --", "admin@a.test' --", "\" or \"\"=\"", "1; select pg_sleep(5)", "$1", "\\", "%", "_"];
  for (const payload of payloads) {
    for (const entry of ["tenant", "platform"]) {
      const asEmail = await api.call("POST", `/${entry}/v1/auth/login`, { body: { email: payload, password: payload } });
      assert.equal(asEmail.status, 400, `${entry} 登录邮箱 ${payload}: ${asEmail.status}`);
    }
    for (const filter of ["resource", "resource_id", "action"]) {
      const res = await api.call("GET", `/platform/v1/audit-logs?${filter}=${encodeURIComponent(payload)}`, { token: platformToken });
      assert.equal(res.status, 200, `审计筛选 ${filter}=${payload}: ${res.status} ${res.text}`);
      assert.equal(res.body.items.length, 0, `审计筛选 ${filter}=${payload} 不应匹配到任何记录（通配符也不行）`);
    }
    for (const filter of ["actor_id", "tenant_id"]) {
      const res = await api.call("GET", `/platform/v1/audit-logs?${filter}=${encodeURIComponent(payload)}`, { token: platformToken });
      assert.equal(res.status, 400, `审计筛选 ${filter}=${payload}`);
    }
    const byId = await api.call("GET", `/platform/v1/tenants/${encodeURIComponent(payload)}`, { token: platformToken });
    assert.equal(byId.status, 404, `路径编号 ${payload}: ${byId.status}`);
  }
  // 密码里的注入片段：按普通的错误密码处理（只试一次，避免触发限速）
  const wrong = await api.call("POST", "/tenant/v1/auth/login", { body: { email: "admin@a.test", password: "' or '1'='1" } });
  assert.equal(wrong.status, 401);
  // 姓名是自由文本：原样保存、原样返回，不被解释
  const name = "Robert'); drop table tenant_users; --";
  const invited = await api.call("POST", "/tenant/v1/users", { token: a.adminToken, body: { email: "bobby@a.test", name, role: "readonly" } });
  assert.equal(invited.status, 201, invited.text);
  assert.equal(invited.body.user.name, name);
  const after = await api.db.owner.query("select (select count(*)::int from tenant_users) as users, (select count(*)::int from tenants) as tenants, (select count(*)::int from platform_users) as staff");
  assert.deepEqual(after.rows[0], { ...before.rows[0], users: before.rows[0].users + 1 });
});

test("每个带 {id} 的接口：编号不是 UUID（字母、SQL 片段、带花括号、空字节）都是统一格式的 404，超长的是 414", async () => {
  const routes = api.app.registeredRoutes.filter((route) => route.path.includes(":id") && route.method !== "HEAD");
  assert.ok(routes.length >= 8, "应当找得到带 {id} 的接口");
  const badIds = ["abc", "123", "1%20or%201=1", `{${SOME_ID}}`, `${SOME_ID}0`, SOME_ID.replaceAll("-", ""), "a".repeat(300), "%00", "null", "undefined", "..%2F..%2Fetc"];
  for (const route of routes) {
    const token = route.path.startsWith("/tenant/") ? a.adminToken : platformToken;
    for (const id of badIds) {
      const res = await api.call(route.method as HttpMethod, route.path.replace(":id", id), { token, body: {} });
      // 超长的路径段在路由阶段就被框架拒绝（414），其余的走到接口里按「不存在」处理
      const expected = id.length > 100 ? 414 : 404;
      assert.equal(res.status, expected, `${route.method} ${route.path} id=${id.slice(0, 20)}: ${res.status} ${res.text.slice(0, 100)}`);
      assertErrorShape(res, `${route.method} ${route.path}`);
      if (expected === 404) assert.equal(res.body.error.code, "NOT_FOUND");
    }
  }
});

test("超大请求体 413、错误的 Content-Type 415（纯文本 400）、不是合法 JSON 400、请求体不是对象 400：都是统一错误格式，登录不计入限速", async () => {
  const raw = async (payload: string, contentType: string, url = "/tenant/v1/auth/login"): Promise<ApiResponse> => {
    const res = await api.app.inject({ method: "POST", url, headers: { "content-type": contentType }, payload });
    return { status: res.statusCode, headers: res.headers, text: res.body, body: JSON.parse(res.body) as unknown };
  };
  const reserved = async (): Promise<number> => (await api.db.owner.query("select coalesce(sum(attempt_count), 0)::int as n from login_throttles")).rows[0].n;
  const reservedBefore = await reserved();
  const good = JSON.stringify({ email: "admin@a.test", password: "x" });
  const huge = await raw(JSON.stringify({ email: "admin@a.test", password: "x".repeat(1_100_000) }), "application/json");
  assert.equal(huge.status, 413, huge.text.slice(0, 100));
  assertErrorShape(huge, "超大请求体");
  for (const contentType of ["application/x-www-form-urlencoded", "application/xml", "multipart/form-data; boundary=x"]) {
    const res = await raw(good, contentType);
    assert.equal(res.status, 415, `${contentType}: ${res.status} ${res.text}`);
    assertErrorShape(res, contentType);
  }
  // text/plain 会被框架当成一个字符串读进来：不是对象，校验不过
  const plain = await raw(good, "text/plain");
  assert.equal(plain.status, 400, plain.text);
  assertErrorShape(plain, "text/plain");
  for (const [label, payload] of [["截断的 JSON", '{"email":'], ["不是 JSON", "email=admin@a.test"], ["重复的键和多余的逗号", '{"email":"a@a.test",}']] as const) {
    const res = await raw(payload, "application/json");
    assert.equal(res.status, 400, `${label}: ${res.status} ${res.text}`);
    assertErrorShape(res, label);
  }
  for (const payload of ["[]", '"text"', "123", "true", '[{"email":"admin@a.test","password":"x"}]']) {
    const res = await raw(payload, "application/json");
    assert.equal(res.status, 400, `${payload}: ${res.status} ${res.text}`);
    assert.equal((res.body as { error: { code: string } }).error.code, "VALIDATION_FAILED");
  }
  // 字段类型不对、原型污染式的键：400 或被忽略，不是 500
  for (const body of [{ email: ["admin@a.test"], password: "x" }, { email: { $ne: "" }, password: { $ne: "" } }, { email: "admin@a.test", password: 12345678 }, { email: null, password: null }]) {
    const res = await api.call("POST", "/tenant/v1/auth/login", { body });
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  const polluted = await raw('{"__proto__":{"email":"admin@a.test","password":"x"},"constructor":{"prototype":{"role":"admin"}}}', "application/json");
  assert.ok(polluted.status === 400, `原型污染式的请求体：${polluted.status}`);
  assert.equal(({} as { role?: string }).role, undefined);
  assert.equal(await reserved(), reservedBefore, "被拒绝的畸形请求不应占用登录次数");
});

test("X-Forwarded-For 默认不被信任：伪造它换不了来源地址，审计里记的是真实连接地址，限速也绕不过", async () => {
  const attempt = async (forwardedFor: string): Promise<number> => {
    const res = await api.app.inject({
      method: "POST",
      url: "/platform/v1/auth/login",
      headers: { "x-forwarded-for": forwardedFor, "x-real-ip": forwardedFor, forwarded: `for=${forwardedFor}` },
      payload: { email: "xff-victim@platform.test", password: "wrong-password" },
      remoteAddress: "198.51.100.7",
    });
    return res.statusCode;
  };
  const statuses: number[] = [];
  for (let i = 0; i < 6; i += 1) statuses.push(await attempt(`203.0.113.${i + 1}`));
  assert.deepEqual(statuses, [401, 401, 401, 401, 401, 429], "每次换一个伪造的地址就绕过了「同一邮箱 + 同一地址 5 次」的限制");
  const ips = await api.db.owner.query("select distinct ip from audit_logs where action = 'login_failed' and after->>'email' = 'xff-victim@platform.test'");
  assert.deepEqual(ips.rows, [{ ip: "198.51.100.7" }]);
});

test("TRUST_PROXY_HOPS=1：只信任最靠近服务的那一层代理写的地址，客户端自己塞在前面的不算", async () => {
  const proxied = buildApp({
    config: loadConfig({ ...testEnv(api.db.url), TRUST_PROXY_HOPS: "1" }),
    pool: api.db.pool,
    migrationFiles: await loadMigrationFiles(),
    now: api.clock.now,
    logger: false,
  });
  try {
    const res = await proxied.inject({
      method: "POST",
      url: "/platform/v1/auth/login",
      // 客户端伪造了 1.1.1.1；代理在后面追加了它看到的真实地址 203.0.113.50
      headers: { "x-forwarded-for": "1.1.1.1, 203.0.113.50" },
      payload: { email: "proxied@platform.test", password: "wrong-password" },
      remoteAddress: "10.0.0.2",
    });
    assert.equal(res.statusCode, 401);
    const ips = await api.db.owner.query("select ip from audit_logs where action = 'login_failed' and after->>'email' = 'proxied@platform.test'");
    assert.deepEqual(ips.rows, [{ ip: "203.0.113.50" }]);
  } finally {
    await proxied.close();
  }
});

test("/platform 和 /tenant 下的每一种应答（成功、401、403、404、400、429 之外的错误）都带 Cache-Control: no-store；公开的 /health 也不缓存", async () => {
  const responses = await Promise.all([
    api.call("GET", "/tenant/v1/auth/me", { token: a.adminToken }),
    api.call("GET", "/tenant/v1/auth/me"),
    api.call("GET", "/tenant/v1/users?limit=0", { token: a.adminToken }),
    api.call("PUT", `/tenant/v1/users/${SOME_ID}`, { token: a.adminToken, body: { name: "x", role: "readonly", status: "active" } }),
    api.call("GET", "/tenant/v1/no-such-endpoint", { token: a.adminToken }),
    api.call("GET", "/platform/v1/auth/me", { token: platformToken }),
    api.call("GET", "/platform/v1/tenants", { token: a.adminToken }),
    api.call("GET", "/platform/v1/integrations", { token: platformToken }),
    api.call("GET", "/platform/v1/audit-logs", { token: platformToken }),
    api.call("POST", "/platform/v1/auth/login", { body: {} }),
    api.call("GET", "/health"),
  ]);
  assert.deepEqual(responses.map((res) => res.status), [200, 401, 400, 404, 404, 200, 401, 200, 200, 400, 200]);
  for (const res of responses) assert.equal(res.headers["cache-control"], "no-store", `${res.status} ${res.text.slice(0, 60)}`);
});
