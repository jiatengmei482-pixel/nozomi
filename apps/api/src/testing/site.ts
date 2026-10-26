/**
 * 官网接口（`/site/v1`，ADR 0032）的集成测试搭建：官网的渠道和 API 客户端要先经运营后台的接口建出来，
 * 它的 client_id 才能写进配置 `SITE_CLIENT_ID`，所以在同一个测试库上另起一个带这项配置的应用（同一个连接池、同一个时钟）。
 */
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@nozomi/config";
import { type AppDeps, buildApp } from "../app.ts";
import { loadMigrationFiles } from "../db/migrate.ts";
import type { PaymentProvider } from "../integrations/payments.ts";
import type { ApiResponse, CallOptions, HttpMethod, TestApi } from "./api.ts";
import { UNREACHABLE_INTEGRATIONS, testEnv } from "./fixtures.ts";

export interface SiteApi {
  app: FastifyInstance;
  call(method: HttpMethod, url: string, options?: CallOptions): Promise<ApiResponse>;
  close(): Promise<void>;
}

/**
 * 在 `api` 的库上起一个官网用 `clientId`（null = 没配置）的应用。`payments` 为 null 模拟没配置 Stripe；`env` 是额外的配置项（如客服电话、假谷歌的地址）；
 * `deps` 是额外的应用依赖（日志去向、地址搜索的缓存时长、密钥缓存的重读间隔）。
 */
export async function siteApi(api: TestApi, clientId: string | null, payments: PaymentProvider | null, env: Record<string, string> = {}, deps: Pick<AppDeps, "logDestination" | "placeCacheTtlMs" | "integrationSecretsTtlMs"> = {}): Promise<SiteApi> {
  const app = buildApp({
    config: loadConfig({ ...testEnv(api.db.url), ...UNREACHABLE_INTEGRATIONS, ...(clientId === null ? {} : { SITE_CLIENT_ID: clientId }), ...env }),
    pool: api.db.pool,
    migrationFiles: await loadMigrationFiles(),
    now: api.clock.now,
    payments,
    logger: deps.logDestination !== undefined,
    ...deps,
  });
  const call: SiteApi["call"] = async (method, url, options = {}) => {
    const res = await app.inject({
      method,
      url,
      headers: { ...options.headers, ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }) },
      ...(options.body === undefined ? {} : { payload: options.body as object }),
      remoteAddress: options.ip ?? "203.0.113.10",
    });
    let body: unknown = null;
    try {
      body = res.body === "" ? null : res.json();
    } catch {
      body = null;
    }
    return { status: res.statusCode, headers: res.headers, text: res.body, body };
  };
  return { app, call, close: () => app.close() };
}
