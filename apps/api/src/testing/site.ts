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

/**
 * 「邮件已配置」的 SMTP 配置，指向本机一个没有服务的端口：查订单要求邮件能发（ADR 0061），只看「排没排信」的测试用它，
 * 不跑通知中心的发送，所以从不连任何邮件服务。密码是虚构的。
 */
export const SITE_MAIL_CONFIGURED: Readonly<Record<string, string>> = {
  SMTP_HOST: "127.0.0.1",
  SMTP_PORT: "9",
  SMTP_ENCRYPTION: "none",
  SMTP_USERNAME: "mailer",
  SMTP_PASSWORD: "fictional-smtp-password-Kq2",
  SMTP_FROM_NAME: "NOZOMI",
  SMTP_FROM_ADDRESS: "noreply@example.test",
};

/**
 * 查订单（ADR 0061）：发请求、等应答之后的后台任务做完，返回应答和「这次有没有给这张单排一封订单链接邮件」——
 * 原来用 200 / 404 判断的「对没对上」，现在只能从发件箱看（应答一律 202）。
 */
export async function lookupQueued(api: TestApi, site: SiteApi, input: { orderNo: string; email: string; ip?: string }): Promise<{ res: ApiResponse; queued: boolean }> {
  const count = async (): Promise<number> =>
    (await api.db.owner.query<{ n: number }>("select count(*)::int as n from notification_events e join orders o on o.id = e.order_id where e.event = 'order.view_link' and o.order_no = $1", [input.orderNo.trim().toUpperCase()])).rows[0]?.n ?? 0;
  const before = await count();
  const res = await site.call("POST", "/site/v1/orders/lookup", { body: { order_no: input.orderNo, email: input.email }, ...(input.ip === undefined ? {} : { ip: input.ip }) });
  await site.app.backgroundIdle();
  return { res, queued: (await count()) > before };
}

/** 清掉查订单按订单号、邮箱的限速计数（ADR 0061）：测「对没对上」的用例对同一张单连查好几次，不是在测限速。 */
export async function resetLinkLimits(api: TestApi): Promise<void> {
  await api.db.owner.query("delete from sales_rate_limits where bucket like 'site_link_%'");
}
