/**
 * 测试角色补充（M4-05，ADR 0030）：未完成两步验证的会话，换几种状态再遍历全部路由。
 * - 「已绑定、待输入动态码」（verify_required）的会话：除白名单接口外一律 403 MFA_REQUIRED，`details.status` 是 verify_required；
 * - 同时「必须先修改密码」的待验证会话：先拦两步验证（不是 PASSWORD_CHANGE_REQUIRED）；
 * - 平台的待验证令牌拿去调租户、销售、司机等其他入口（含 M3-02 新增的）：一个都不放行。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { createSuperAdmin } from "./services/platform-staff.ts";
import { type ApiResponse, type HttpMethod, TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";

interface OpenApiDoc {
  paths: Record<string, Record<string, { security?: unknown[] }>>;
}
const doc = parse(await readFile(new URL("../openapi.yaml", import.meta.url), "utf8")) as OpenApiDoc;

const ALLOWED = ["GET /platform/v1/auth/me", "POST /platform/v1/auth/logout", "POST /platform/v1/auth/mfa/verify", "POST /platform/v1/auth/mfa/enrollment", "POST /platform/v1/auth/mfa/enrollment/confirm"].sort();

let api: TestApi;
before(async () => {
  api = await createTestApi();
  await api.superAdminToken("root@platform.test");
});
after(() => api.close());

function operationOf(method: string, fastifyPath: string): { security?: unknown[] } | undefined {
  return doc.paths[fastifyPath.replace(/:([A-Za-z_]+)/g, "{$1}")]?.[method.toLowerCase()];
}

function routes(filter: (path: string) => boolean): { method: string; path: string }[] {
  return api.app.registeredRoutes
    .filter((route) => route.method !== "HEAD" && route.method !== "OPTIONS" && filter(route.path))
    .filter((route) => {
      const operation = operationOf(route.method, route.path);
      return !(operation && Array.isArray(operation.security) && operation.security.length === 0);
    })
    .sort((a, b) => Number(a.path.endsWith("/auth/logout")) - Number(b.path.endsWith("/auth/logout")));
}

async function walk(token: string, filter: (path: string) => boolean): Promise<Map<string, ApiResponse>> {
  const responses = new Map<string, ApiResponse>();
  for (const route of routes(filter)) {
    responses.set(`${route.method} ${route.path}`, await api.call(route.method as HttpMethod, route.path.replace(/:[A-Za-z_]+/g, randomUUID()), { token, body: {} }));
  }
  return responses;
}

const counts = async (): Promise<unknown> =>
  (await api.db.owner.query("select (select count(*) from tenants) as t, (select count(*) from platform_users) as u, (select count(*) from platform_roles) as r, (select count(*) from approvals) as a, (select count(*) from channels) as c, (select count(*) from platform_recovery_codes) as rc")).rows[0];

test("已绑定、待输入动态码的会话：遍历全部平台路由，除白名单外一律 403 MFA_REQUIRED（verify_required），且不产生效果", async () => {
  await createSuperAdmin(api.db.pool, { email: "bound@platform.test", name: "已绑定", password: TEST_PASSWORD }, api.clock.now());
  await api.platformLogin({ body: { email: "bound@platform.test", password: TEST_PASSWORD } });
  const login = await api.call("POST", "/platform/v1/auth/login", { body: { email: "bound@platform.test", password: TEST_PASSWORD } });
  assert.equal(login.body.second_factor.status, "verify_required");
  const before = await counts();
  const responses = await walk(login.body.access_token, (path) => path.startsWith("/platform/v1/"));
  const passed = [...responses].filter(([, res]) => !(res.status === 403 && res.body?.error?.code === "MFA_REQUIRED")).map(([key]) => key).sort();
  assert.deepEqual(passed, ALLOWED);
  for (const [key, res] of responses) {
    if (ALLOWED.includes(key)) continue;
    assert.deepEqual(res.body.error.details, { status: "verify_required" }, key);
  }
  assert.deepEqual(await counts(), before);
  // 白名单里的两步验证接口对这个状态也不给捷径：开始绑定 409（不能借「重新绑定」绕过），确认 409
  assert.equal(responses.get("POST /platform/v1/auth/mfa/enrollment")?.body.error.code, "MFA_ALREADY_ENROLLED");
  assert.equal(responses.get("POST /platform/v1/auth/mfa/enrollment/confirm")?.status, 400, "空的确认请求参数不对");
});

test("必须先修改密码、又没完成两步验证的会话：其余接口拦的是 MFA_REQUIRED，不是 PASSWORD_CHANGE_REQUIRED", async () => {
  const temporary = "Tmp9k-Zx3wR-8vBn2-QyLp5";
  await createSuperAdmin(api.db.pool, { email: "temp-walk@platform.test", name: "临时", password: temporary, temporaryPassword: true }, api.clock.now());
  const login = await api.call("POST", "/platform/v1/auth/login", { body: { email: "temp-walk@platform.test", password: temporary } });
  assert.equal(login.body.must_change_password, true);
  const responses = await walk(login.body.access_token, (path) => path.startsWith("/platform/v1/"));
  for (const [key, res] of responses) {
    if (ALLOWED.includes(key)) continue;
    assert.equal(res.body?.error?.code, "MFA_REQUIRED", key);
  }
});

test("平台的待验证令牌调其他入口（租户、销售、司机等，含 M3-02 新增的）：一个也不放行（官网 /site/v1 本来就不看登录令牌，不在此列）", async () => {
  await createSuperAdmin(api.db.pool, { email: "cross@platform.test", name: "串门", password: TEST_PASSWORD }, api.clock.now());
  const login = await api.call("POST", "/platform/v1/auth/login", { body: { email: "cross@platform.test", password: TEST_PASSWORD } });
  const responses = await walk(login.body.access_token, (path) => !path.startsWith("/platform/v1/") && !path.startsWith("/site/") && Object.keys(doc.paths).includes(path.replace(/:([A-Za-z_]+)/g, "{$1}")));
  assert.ok(responses.size >= 20, `遍历到的其他入口太少：${responses.size}`);
  const leaked = [...responses].filter(([, res]) => res.status < 400).map(([key, res]) => `${key} → ${res.status}`);
  assert.deepEqual(leaked, []);
});
