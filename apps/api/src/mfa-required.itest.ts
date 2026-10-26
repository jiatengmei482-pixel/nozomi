/**
 * 两步验证没完成的会话（ADR 0030）：遍历全部已注册的路由——平台一侧除了查看自己、退出、两步验证本身之外，
 * 每个需要登录的接口都是 403 `MFA_REQUIRED`，而且不产生任何效果。以后新增的平台接口默认也被拦。
 * 做法和 password-change-required.itest.ts 一样（那里测「必须先修改密码」）。
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

/** 待验证的会话还能调的平台接口 */
const ALLOWED = ["GET /platform/v1/auth/me", "POST /platform/v1/auth/logout", "POST /platform/v1/auth/mfa/verify", "POST /platform/v1/auth/mfa/enrollment", "POST /platform/v1/auth/mfa/enrollment/confirm"].sort();

let api: TestApi;
before(async () => {
  api = await createTestApi();
  await api.superAdminToken("root@platform.test");
});
after(() => api.close());

function isPublic(method: string, fastifyPath: string): boolean {
  const operation = doc.paths[fastifyPath.replace(/:([A-Za-z_]+)/g, "{$1}")]?.[method.toLowerCase()];
  assert.ok(operation, `openapi.yaml 里没有 ${method} ${fastifyPath}`);
  return Array.isArray(operation.security) && operation.security.length === 0;
}

async function walk(token: string): Promise<{ blocked: string[]; passed: string[]; responses: Map<string, ApiResponse> }> {
  const routes = api.app.registeredRoutes
    .filter((route) => route.method !== "HEAD" && route.method !== "OPTIONS" && route.path.startsWith("/platform/v1/"))
    .filter((route) => !isPublic(route.method, route.path))
    .sort((a, b) => Number(a.path.endsWith("/auth/logout")) - Number(b.path.endsWith("/auth/logout")));
  const blocked: string[] = [];
  const passed: string[] = [];
  const responses = new Map<string, ApiResponse>();
  for (const route of routes) {
    const key = `${route.method} ${route.path}`;
    const res = await api.call(route.method as HttpMethod, route.path.replace(/:[A-Za-z_]+/g, randomUUID()), { token });
    responses.set(key, res);
    if (res.status === 403 && res.body?.error?.code === "MFA_REQUIRED") blocked.push(key);
    else passed.push(key);
  }
  return { blocked, passed, responses };
}

test("遍历全部平台路由：没绑定的会话除查看自己、退出、两步验证本身外一律 403 MFA_REQUIRED，且不产生效果", async () => {
  await createSuperAdmin(api.db.pool, { email: "walk@platform.test", name: "遍历", password: TEST_PASSWORD }, api.clock.now());
  const login = await api.call("POST", "/platform/v1/auth/login", { body: { email: "walk@platform.test", password: TEST_PASSWORD } });
  const counts = async (): Promise<unknown> => (await api.db.owner.query("select (select count(*) from tenants) as t, (select count(*) from platform_users) as u, (select count(*) from platform_roles) as r, (select count(*) from approvals) as a, (select count(*) from channels) as c")).rows[0];
  const before = await counts();
  const { blocked, passed, responses } = await walk(login.body.access_token);
  assert.deepEqual([...passed].sort(), ALLOWED);
  assert.ok(blocked.length >= 60, `被拦的接口数量不对：${blocked.length}`);
  for (const key of blocked) {
    assert.deepEqual(responses.get(key)?.body.error.details, { status: "enrollment_required" }, key);
  }
  assert.deepEqual(await counts(), before);
  assert.equal(responses.get("GET /platform/v1/auth/me")?.status, 200);
  assert.equal(responses.get("POST /platform/v1/auth/logout")?.status, 204);
});

test("对照：完成了两步验证的会话把同样的路由走一遍，没有一个返回 MFA_REQUIRED", async () => {
  const login = await api.platformLogin({ body: { email: "root@platform.test", password: TEST_PASSWORD } });
  const { blocked } = await walk(login.body.access_token);
  assert.deepEqual(blocked, []);
});

test("判断顺序：MFA_REQUIRED 先于权限（FORBIDDEN）和参数校验——被拦的请求不暴露本来有没有这个权限", async () => {
  const root = await api.platformLogin({ body: { email: "root@platform.test", password: TEST_PASSWORD } });
  const invited = await api.call("POST", "/platform/v1/staff", { token: root.body.access_token, body: { email: "ro@platform.test", name: "只读", role: "readonly" } });
  await api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.body.invite.token, password: TEST_PASSWORD } });
  const pending = (await api.call("POST", "/platform/v1/auth/login", { body: { email: "ro@platform.test", password: TEST_PASSWORD } })).body.access_token as string;
  for (const [method, url, body] of [["POST", "/platform/v1/tenants", { bad: true }], ["GET", "/platform/v1/staff", undefined], ["GET", "/platform/v1/audit-logs?limit=abc", undefined]] as const) {
    const res = await api.call(method, url, { token: pending, body });
    assert.equal(res.body.error.code, "MFA_REQUIRED", url);
  }
});
