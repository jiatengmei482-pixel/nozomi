/**
 * 接口集成测试的公共搭建：独立 schema 的真实数据库 + 仓库里的真实迁移 + 可拨动的时钟 + 常用的请求辅助。
 * 测试数据只在这里和各测试里构造，`close()` 时连同 schema 一起删除（规则 1）。
 */
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.ts";
import { loadMigrationFiles } from "../db/migrate.ts";
import { createSuperAdmin } from "../services/platform-staff.ts";
import { type TestDatabase, createMigratedTestDatabase } from "./db.ts";
import { loadConfig } from "@nozomi/config";
import { testConfig, testEnv } from "./fixtures.ts";

/** 测试里统一使用的密码：满足强度规则，且不含任何测试邮箱的邮箱名。 */
export const TEST_PASSWORD = "Quiet-Harbor-2026";

export interface ApiResponse {
  status: number;
  headers: Record<string, unknown>;
  text: string;
  body: any;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface CallOptions {
  token?: string;
  body?: unknown;
  /** 模拟不同的来源地址 */
  ip?: string;
  /** 额外的请求头（如修改主数据时的 If-Match） */
  headers?: Record<string, string>;
}

export interface TestClock {
  now: () => Date;
  advance(ms: number): void;
}

export interface TestApi {
  db: TestDatabase;
  app: FastifyInstance;
  clock: TestClock;
  /** 截到的全部日志行 */
  logs: () => string;
  call(method: HttpMethod, url: string, options?: CallOptions): Promise<ApiResponse>;
  /** 用命令行同样的流程建一个超级管理员并登录，返回令牌 */
  superAdminToken(email?: string): Promise<string>;
  /** 平台创建租户 → 管理员接受邀请 → 登录，返回租户信息和管理员令牌 */
  tenantWithAdmin(platformToken: string, name: string, adminEmail: string): Promise<TenantFixture>;
  close(): Promise<void>;
}

export interface TenantFixture {
  tenantId: string;
  adminId: string;
  adminEmail: string;
  adminToken: string;
}

export interface TestApiOptions {
  /** 在测试配置之上追加或覆盖的环境变量（如地图底图的配置） */
  env?: Record<string, string>;
}

export async function createTestApi(options: TestApiOptions = {}): Promise<TestApi> {
  const db = await createMigratedTestDatabase();
  const migrationFiles = await loadMigrationFiles();

  let current = new Date("2026-10-07T01:00:00.000Z").getTime();
  const clock: TestClock = {
    now: () => new Date(current),
    advance: (ms) => {
      current += ms;
    },
  };
  let logs = "";
  const app = buildApp({
    config: options.env === undefined ? testConfig(db.url) : loadConfig({ ...testEnv(db.url), ...options.env }),
    pool: db.pool,
    migrationFiles,
    now: clock.now,
    logDestination: { write: (line) => void (logs += line) },
  });

  const call: TestApi["call"] = async (method, url, options = {}) => {
    const res = await app.inject({
      method,
      url,
      headers: { ...options.headers, ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }) },
      ...(options.body === undefined ? {} : { payload: options.body as object }),
      ...(options.ip === undefined ? {} : { remoteAddress: options.ip }),
    });
    let body: unknown = null;
    try {
      body = res.body === "" ? null : res.json();
    } catch {
      body = null;
    }
    return { status: res.statusCode, headers: res.headers, text: res.body, body };
  };

  const login = async (prefix: "platform" | "tenant", email: string): Promise<ApiResponse> => {
    const res = await call("POST", `/${prefix}/v1/auth/login`, { body: { email, password: TEST_PASSWORD } });
    assert.equal(res.status, 200, res.text);
    return res;
  };

  return {
    db,
    app,
    clock,
    logs: () => logs,
    call,
    async superAdminToken(email = "root@platform.test") {
      await createSuperAdmin(db.pool, { email, name: "平台超管", password: TEST_PASSWORD }, clock.now());
      return (await login("platform", email)).body.access_token as string;
    },
    async tenantWithAdmin(platformToken, name, adminEmail) {
      const created = await call("POST", "/platform/v1/tenants", {
        token: platformToken,
        body: { name, admin: { email: adminEmail, name: `${name}管理员` } },
      });
      assert.equal(created.status, 201, created.text);
      const accepted = await call("POST", "/tenant/v1/auth/accept-invite", {
        body: { token: created.body.invite.token, password: TEST_PASSWORD },
      });
      assert.equal(accepted.status, 200, accepted.text);
      const loggedIn = await login("tenant", adminEmail);
      return {
        tenantId: created.body.tenant.id as string,
        adminId: created.body.admin_user.id as string,
        adminEmail,
        adminToken: loggedIn.body.access_token as string,
      };
    },
    async close() {
      await app.close();
      await db.drop();
    },
  };
}

/** 邀请一个子账号、接受邀请并登录，返回它的编号和令牌。 */
export async function addTenantUser(
  api: TestApi,
  adminToken: string,
  email: string,
  role: string,
): Promise<{ id: string; token: string }> {
  const invited = await api.call("POST", "/tenant/v1/users", { token: adminToken, body: { email, name: email, role } });
  assert.equal(invited.status, 201, invited.text);
  const accepted = await api.call("POST", "/tenant/v1/auth/accept-invite", {
    body: { token: invited.body.invite.token, password: TEST_PASSWORD },
  });
  assert.equal(accepted.status, 200, accepted.text);
  const loggedIn = await api.call("POST", "/tenant/v1/auth/login", { body: { email, password: TEST_PASSWORD } });
  assert.equal(loggedIn.status, 200, loggedIn.text);
  return { id: invited.body.user.id as string, token: loggedIn.body.access_token as string };
}
