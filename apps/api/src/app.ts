/**
 * 构建 Fastify 应用（不监听端口）。监听和进程信号在 server.ts；
 * 测试直接用这里的 `buildApp` + `app.inject`，不占端口。
 *
 * 依赖（配置、连接池、迁移文件列表）都由调用方传入，这里不读环境变量、不建连接。
 */
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyServerOptions } from "fastify";
import type { AppConfig } from "@nozomi/config";
import { type Pool, driverErrorCode } from "./db/pool.ts";
import type { MigrationFile } from "./db/migration-plan.ts";
import { errorBody, rawClientErrorResponse, toErrorResponse } from "./errors.ts";
import type { AppContext } from "./context.ts";
import { type QuoteDeps, defaultQuoteDeps } from "./services/quote-deps.ts";
import { checkHealth } from "./health.ts";
import { FxCenter } from "./services/fx-center.ts";
import { REDACTED, pathOnly, secretValues, serializeError, serializeRequest } from "./logging.ts";
import { registerAreaRoutes } from "./routes/areas.ts";
import { registerMasterDataRoutes } from "./routes/master-data.ts";
import { registerImportExportRoutes } from "./routes/import-export.ts";
import { registerQuoteRoutes } from "./routes/quotes.ts";
import { registerFxRoutes } from "./routes/fx.ts";
import { registerInventoryRoutes } from "./routes/inventory.ts";
import { registerPriceRoutes } from "./routes/prices.ts";
import { registerProductRoutes } from "./routes/products.ts";
import { registerPlatformRoutes } from "./routes/platform.ts";
import { registerPlatformProductRoutes } from "./routes/platform-products.ts";
import { registerTenantRoutes } from "./routes/tenant.ts";
import { registerChannelRoutes } from "./routes/channels.ts";
import { registerSalesRoutes } from "./routes/sales.ts";
import { registerOrderRoutes } from "./routes/orders.ts";
import { registerWebhookRoutes } from "./routes/webhooks.ts";
import type { PaymentProvider } from "./integrations/payments.ts";
import { StripePaymentProvider } from "./integrations/stripe.ts";
import { OrderJobs } from "./services/order-jobs.ts";
import { WebhookJobs } from "./services/webhook-jobs.ts";
import { SecretBox } from "./integrations/secret-box.ts";
import { HttpsWebhookSender, type WebhookSender } from "./integrations/webhook-sender.ts";
import { registerFleetRoutes } from "./routes/fleet.ts";
import { registerDispatchRoutes } from "./routes/dispatch.ts";
import { registerDriverRoutes } from "./routes/driver.ts";
import { registerTenantWebhookRoutes } from "./routes/tenant-webhooks.ts";
import { registerPlatformSecurityRoutes } from "./routes/platform-security.ts";

export interface AppDeps {
  config: AppConfig;
  pool: Pool;
  /** 启动时读好的迁移文件列表，/health 用它判断迁移是否执行完 */
  migrationFiles: readonly MigrationFile[];
  /** 是否输出日志；测试里关掉 */
  logger?: boolean;
  /** 日志写到哪里；默认标准输出。测试用它截取日志内容 */
  logDestination?: { write(line: string): void };
  /** /health 整个检查的时限（毫秒） */
  healthTimeoutMs?: number;
  /** 时钟；默认系统时间。测试用它验证会话过期、限速窗口、邀请过期 */
  now?: () => Date;
  /** 报价引擎的外部依赖（路线预估、汇率、加价规则、评分）；不给的用默认实现（汇率是汇率中心） */
  quote?: Partial<QuoteDeps>;
  /**
   * 收款服务（ADR 0026）。不给：配置了 Stripe 就用 Stripe，没配置为 null（不能下单）。
   * 测试给替身（testing/payments.ts），不连 Stripe；给 null 模拟没配置。
   */
  payments?: PaymentProvider | null;
  /**
   * 推送给供应商的 Webhook 的发送器（ADR 0027）。不给：真实的 HTTPS 发送器（防 SSRF：只连公网地址）。
   * 集成测试给一个打开了 `allowLocalTargets` 的发送器，推到本机的假服务器。
   */
  webhookSender?: WebhookSender;
  /** 是否启动后台定时任务（汇率定时拉取和过期告警、待支付超时取消、Webhook 投递）。只有服务进程（server.ts）打开；测试直接调 `FxCenter.tick`、`OrderJobs.tick` */
  jobs?: boolean;
}

export interface RegisteredRoute {
  method: string;
  path: string;
}

declare module "fastify" {
  interface FastifyInstance {
    /** 已注册的全部路由，用于和 OpenAPI 定义对账 */
    registeredRoutes: RegisteredRoute[];
    /** 汇率中心：定时任务的入口（服务进程用 `jobs` 启动它；测试直接调 `tick`、`fetch`） */
    fxCenter: FxCenter;
    /** 订单的定时任务：待支付超时取消、超时未派车和未出发的提醒（服务进程用 `jobs` 启动它；测试直接调 `tick`） */
    orderJobs: OrderJobs;
    /** 推送给供应商的 Webhook 的投递任务（服务进程用 `jobs` 启动它；测试直接调 `tick`） */
    webhookJobs: WebhookJobs;
  }
}

/**
 * 日志规则（细节见 logging.ts）：
 * - 请求只记方法、路径（不含查询串）、来源地址；不记请求头和请求体。
 * - 异常只记类型、错误码、说明、调用栈，并抹掉其中的密钥原文和连接串。
 * - 再加一层兜底：万一以后有人把请求头打进日志，凭证类字段也会被抹掉。
 */
function loggerOptions(deps: AppDeps): NonNullable<FastifyServerOptions["logger"]> {
  const secrets = secretValues(deps.config);
  return {
    level: deps.config.appEnv === "local" ? "debug" : "info",
    serializers: {
      req: serializeRequest,
      err: (err: unknown) => serializeError(err, secrets),
    },
    redact: {
      paths: [
        "req.headers.authorization",
        "req.headers.cookie",
        'req.headers["stripe-signature"]',
        'req.headers["x-api-key"]',
        'res.headers["set-cookie"]',
      ],
      censor: REDACTED,
    },
    ...(deps.logDestination ? { stream: deps.logDestination } : {}),
  };
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const { config, pool, migrationFiles } = deps;
  const app = Fastify({
    logger: deps.logger === false ? false : loggerOptions(deps),
    // 前面有自己的反向代理时，从 X-Forwarded-For 取客户端地址（审计日志、登录限速用）；层数来自配置
    trustProxy: config.trustProxyHops > 0 ? (_address: string, hop: number) => hop < config.trustProxyHops : false,
    // 路由阶段就出错的请求（畸形的百分号编码等）也走统一错误格式
    frameworkErrors: (err, _request, reply) => {
      const response = toErrorResponse(err);
      void (reply as unknown as FastifyReply).code(response.statusCode).send(response.body);
    },
    // HTTP 解析阶段就被拒绝的请求（请求头过大、不是 HTTP 的内容）：直接往套接字写统一格式的应答
    clientErrorHandler: (err, socket) => {
      const code = driverErrorCode(err);
      if (code === "ECONNRESET" || socket.destroyed) return;
      if (socket.writable) {
        socket.end(rawClientErrorResponse(code));
      } else {
        socket.destroy();
      }
    },
  });

  const registeredRoutes: RegisteredRoute[] = [];
  app.decorate("registeredRoutes", registeredRoutes);
  app.addHook("onRoute", (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) registeredRoutes.push({ method, path: route.url });
  });

  // 优雅关闭：开始关闭后，正在处理的请求在应答里带上 Connection: close，
  // 这样保持连接（keep-alive）的客户端收到应答后连接随即断开，进程不用等到连接空闲超时。
  let closing = false;
  app.addHook("preClose", async () => {
    closing = true;
  });
  app.addHook("onSend", async (_request, reply) => {
    if (closing) reply.header("connection", "close");
  });

  app.setNotFoundHandler((request, reply) => {
    return reply
      .code(404)
      .send(errorBody("NOT_FOUND", "接口不存在", { method: request.method, path: pathOnly(request.url) }));
  });

  app.setErrorHandler((err, request, reply) => {
    const response = toErrorResponse(err);
    if (response.unexpected) {
      request.log.error({ err }, "未预期的异常");
    }
    const retryAfter = response.body.error.details["retry_after_seconds"];
    if (response.statusCode === 429 && typeof retryAfter === "number") reply.header("retry-after", retryAfter);
    return reply.code(response.statusCode).send(response.body);
  });

  // 带令牌或账号数据的响应不允许被任何缓存保存
  app.addHook("onSend", async (request, reply) => {
    const path = pathOnly(request.url);
    if (path.startsWith("/platform/") || path.startsWith("/tenant/") || path.startsWith("/sales/") || path.startsWith("/driver/")) reply.header("cache-control", "no-store");
  });

  app.get("/health", async (_request, reply) => {
    const report = await checkHealth({
      config,
      pool,
      migrationFiles,
      timeoutMs: deps.healthTimeoutMs ?? 2_000,
    });
    return reply
      .code(report.status === "ok" ? 200 : 503)
      .header("cache-control", "no-store")
      .send(report);
  });

  const now = deps.now ?? (() => new Date());
  const fx = new FxCenter({ pool, now, config: config.fx, log: app.log });
  app.decorate("fxCenter", fx);
  const payments = deps.payments !== undefined ? deps.payments : config.stripe === null ? null : new StripePaymentProvider(config.stripe);
  const context: AppContext = {
    config,
    pool,
    now,
    fx,
    payments,
    quote: { ...defaultQuoteDeps(config, fx.rates, now), ...deps.quote },
    secretBox: config.dataEncryptionKey === null ? null : new SecretBox(config.dataEncryptionKey),
    webhookSender: deps.webhookSender ?? new HttpsWebhookSender(),
  };
  const orderJobs = new OrderJobs(context, app.log);
  app.decorate("orderJobs", orderJobs);
  const webhookJobs = new WebhookJobs(context, app.log);
  app.decorate("webhookJobs", webhookJobs);
  if (deps.jobs) {
    fx.start();
    orderJobs.start();
    webhookJobs.start();
    app.addHook("onClose", () => fx.stop());
    app.addHook("onClose", () => orderJobs.stop());
    app.addHook("onClose", () => webhookJobs.stop());
  }
  registerPlatformRoutes(app, context);
  registerPlatformSecurityRoutes(app, context);
  registerTenantRoutes(app, context);
  registerMasterDataRoutes(app, context);
  registerAreaRoutes(app, context);
  registerProductRoutes(app, context);
  registerPriceRoutes(app, context);
  registerInventoryRoutes(app, context);
  registerImportExportRoutes(app, context);
  registerQuoteRoutes(app, context);
  registerFxRoutes(app, context);
  registerPlatformProductRoutes(app, context);
  registerChannelRoutes(app, context);
  registerSalesRoutes(app, context);
  registerOrderRoutes(app, context);
  registerWebhookRoutes(app, context);
  registerFleetRoutes(app, context);
  registerDispatchRoutes(app, context);
  registerDriverRoutes(app, context);
  registerTenantWebhookRoutes(app, context);

  return app;
}
