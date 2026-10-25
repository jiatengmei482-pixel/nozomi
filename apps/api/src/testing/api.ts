/**
 * 接口集成测试的公共搭建：独立 schema 的真实数据库 + 仓库里的真实迁移 + 可拨动的时钟 + 常用的请求辅助。
 * 测试数据只在这里和各测试里构造，`close()` 时连同 schema 一起删除（规则 1）。
 */
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.ts";
import type { AppContext } from "../context.ts";
import type { Pool } from "../db/pool.ts";
import { FxCenter } from "../services/fx-center.ts";
import { type QuoteDeps, defaultQuoteDeps } from "../services/quote-deps.ts";
import type { PaymentProvider } from "../integrations/payments.ts";
import { SecretBox } from "../integrations/secret-box.ts";
import { HttpsWebhookSender, type WebhookSender } from "../integrations/webhook-sender.ts";
import type { AppConfig } from "@nozomi/config";
import { loadMigrationFiles } from "../db/migrate.ts";
import { createSuperAdmin } from "../services/platform-staff.ts";
import { type TestDatabase, createMigratedTestDatabase } from "./db.ts";
import { loadConfig } from "@nozomi/config";
import { testConfig, testEnv } from "./fixtures.ts";

/** 测试里的 Webhook 接收地址用的主机名：经接口保存时它是合格的 https 地址；测试的发送器把它换成本机的假接收方。 */
export const LOCAL_WEBHOOK_HOST = "hooks.nozomi.test";

/**
 * 测试用的发送器：把 `https://hooks.nozomi.test:<端口>` 换成 `http://127.0.0.1:<端口>`（本机的假接收方没有证书），交给真实的发送器
 * （打开 `allowLocalTargets` 只放行 http 和回环地址，其余防 SSRF 的检查照旧；那些检查本身在 webhook-sender.test.ts 里测）。
 */
export function localWebhookSender(options: { timeoutMs?: number } = {}): WebhookSender {
  const real = new HttpsWebhookSender({ allowLocalTargets: true, ...options });
  const prefix = `https://${LOCAL_WEBHOOK_HOST}:`;
  return {
    send: async (request) => {
      const result = await real.send({ ...request, url: request.url.startsWith(prefix) ? `http://127.0.0.1:${request.url.slice(prefix.length)}` : request.url });
      return request.url.startsWith(prefix) ? { ...result, targetHost: new URL(request.url).host } : result;
    },
  };
}

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
  /**
   * 平台创建租户 → 管理员接受邀请 → 登录，返回租户信息和管理员令牌。
   * 新建的供应商从「申请中」开始（ADR 0028）；不测入驻流程的测试要的是一家能上架、能参与比价的供应商，
   * 所以默认直接在库里把它摆成「正式」（`onboarding: "active"`）。测入驻的测试给 `"applying"`，走真实的审核流程。
   */
  tenantWithAdmin(platformToken: string, name: string, adminEmail: string, options?: { onboarding?: "applying" | "active" }): Promise<TenantFixture>;
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
  /** 报价引擎的外部依赖的替身（路线预估、汇率、加价规则、评分） */
  quote?: Partial<QuoteDeps>;
  /** 收款服务的替身（testing/payments.ts）；null = 没配置 Stripe。不给时：测试配置里的 Stripe 密钥是假的，下单会去连 Stripe，所以下单的测试都要给 */
  payments?: PaymentProvider | null;
  /** 推送给供应商的发送器；不给时用 `localWebhookSender`（推到本机的假接收方） */
  webhookSender?: WebhookSender;
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
    ...(options.quote === undefined ? {} : { quote: options.quote }),
    ...(options.payments === undefined ? {} : { payments: options.payments }),
    webhookSender: options.webhookSender ?? localWebhookSender(),
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
    async tenantWithAdmin(platformToken, name, adminEmail, options = {}) {
      const created = await call("POST", "/platform/v1/tenants", {
        token: platformToken,
        body: { name, admin: { email: adminEmail, name: `${name}管理员` } },
      });
      assert.equal(created.status, 201, created.text);
      const accepted = await call("POST", "/tenant/v1/auth/accept-invite", {
        body: { token: created.body.invite.token, password: TEST_PASSWORD },
      });
      assert.equal(accepted.status, 200, accepted.text);
      if ((options.onboarding ?? "active") === "active") {
        const now = clock.now();
        await db.owner.query("update tenants set status = 'active', signed_at = $2, trial_started_at = $2, activated_at = $2 where id = $1", [created.body.tenant.id, now]);
      }
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

/** 不经过 buildApp、直接调服务函数的测试用的上下文：真实的汇率中心（不启动定时任务、不记日志）和默认的报价依赖。 */
export function testContext(config: AppConfig, pool: Pool, now: () => Date, quote: Partial<QuoteDeps> = {}): AppContext {
  const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };
  const fx = new FxCenter({ pool, now, config: config.fx, log: silent });
  return {
    config,
    pool,
    now,
    fx,
    payments: null,
    quote: { ...defaultQuoteDeps(config, fx.rates, now), ...quote },
    secretBox: config.dataEncryptionKey === null ? null : new SecretBox(config.dataEncryptionKey),
    webhookSender: localWebhookSender(),
  };
}

/**
 * 双人复核里的审核人：一位「运营」平台员工（有 `tenant.approve`），每个测试环境只建一次，由 `rootToken`（超级管理员）邀请。
 * 不用第二位超级管理员：那样会让「最后一位超级管理员不能停用」这类测试的前提变掉。
 */
const approvers = new WeakMap<TestApi, Promise<string>>();
export function approverToken(api: TestApi, rootToken: string): Promise<string> {
  let token = approvers.get(api);
  if (token === undefined) {
    token = (async () => {
      const email = "approver@platform.test";
      const invited = await api.call("POST", "/platform/v1/staff", { token: rootToken, body: { email, name: "审核人", role: "operations" } });
      assert.equal(invited.status, 201, invited.text);
      const accepted = await api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.body.invite.token, password: TEST_PASSWORD } });
      assert.equal(accepted.status, 200, accepted.text);
      const login = await api.call("POST", "/platform/v1/auth/login", { body: { email, password: TEST_PASSWORD } });
      assert.equal(login.status, 200, login.text);
      return login.body.access_token as string;
    })();
    approvers.set(api, token);
  }
  return token;
}

/**
 * 人工暂停一家供应商：发起（双人复核，ADR 0028）→ 审核人（`approverToken`）批准。返回批准后的供应商。
 * `token` 是发起人，要有 `tenant.change_status`，并且是超级管理员（顺便用它邀请审核人）。
 */
export async function suspendTenantApproved(api: TestApi, token: string, tenantId: string, reason = "测试暂停"): Promise<any> {
  const approver = await approverToken(api, token);
  const requested = await api.call("POST", `/platform/v1/tenants/${tenantId}/suspend`, { token, body: { reason } });
  assert.equal(requested.status, 202, requested.text);
  const approved = await api.call("POST", `/platform/v1/approvals/${requested.body.approval.id}/approve`, { token: approver, body: {} });
  assert.equal(approved.status, 200, approved.text);
  const tenant = await api.call("GET", `/platform/v1/tenants/${tenantId}`, { token });
  assert.equal(tenant.status, 200, tenant.text);
  return tenant.body;
}

/** 恢复一家人工暂停的供应商（直接生效）。 */
export async function resumeTenantNow(api: TestApi, token: string, tenantId: string): Promise<any> {
  const resumed = await api.call("POST", `/platform/v1/tenants/${tenantId}/resume`, { token, body: {} });
  assert.equal(resumed.status, 200, resumed.text);
  return resumed.body;
}

/** 按原始字节上传一个文件（资质、合同扫描件；ADR 0028）。`contentType` 是请求头里声明的类型。 */
export async function uploadBytes(api: TestApi, url: string, bytes: Buffer, token: string, contentType: string): Promise<ApiResponse> {
  const res = await api.app.inject({ method: "POST", url, payload: bytes, headers: { "content-type": contentType, authorization: `Bearer ${token}` } });
  let body: unknown = null;
  try {
    body = res.body === "" ? null : res.json();
  } catch {
    body = null;
  }
  return { status: res.statusCode, headers: res.headers, text: res.body, body };
}
