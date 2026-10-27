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
import { registerOrderActionRoutes } from "./routes/order-actions.ts";
import { registerRescueRoutes } from "./routes/rescues.ts";
import { registerOrderCenterRoutes } from "./routes/order-center.ts";
import { registerBillingRoutes } from "./routes/billing.ts";
import { registerWebhookRoutes } from "./routes/webhooks.ts";
import { registerTenantOnboardingRoutes } from "./routes/tenant-onboarding.ts";
import type { PaymentProvider } from "./integrations/payments.ts";
import { StripePaymentProvider, checkStripeKey } from "./integrations/stripe.ts";
import { checkGoogleMapsKey, computeRoute } from "./integrations/google-maps.ts";
import { GoogleRouteEstimator } from "./services/route-estimates.ts";
import { reverseGeocode, searchPlaces } from "./integrations/google-places.ts";
import { GooglePlaceSearch } from "./services/place-search.ts";
import { type IntegrationChecks, IntegrationSecretCache } from "./services/integration-secrets.ts";
import { registerIntegrationSecretRoutes } from "./routes/integration-secrets.ts";
import { OrderJobs } from "./services/order-jobs.ts";
import { TenantJobs } from "./services/tenant-jobs.ts";
import { BillingJobs } from "./services/billing.ts";
import { WebhookJobs } from "./services/webhook-jobs.ts";
import { SecretBox } from "./integrations/secret-box.ts";
import { HttpsWebhookSender, type WebhookSender } from "./integrations/webhook-sender.ts";
import { registerFleetRoutes } from "./routes/fleet.ts";
import { registerDispatchRoutes } from "./routes/dispatch.ts";
import { registerDriverRoutes } from "./routes/driver.ts";
import { registerTenantWebhookRoutes } from "./routes/tenant-webhooks.ts";
import { registerSiteRoutes } from "./routes/site.ts";
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
   * 收款服务（ADR 0026）。不给：生效的 Stripe 密钥（运营后台填写的优先，其次配置文件，ADR 0041）有就用 Stripe，没有为 null（不能下单）。
   * 测试给替身（testing/payments.ts），不连 Stripe；给 null 模拟没配置。
   */
  payments?: PaymentProvider | null;
  /**
   * 推送给供应商的 Webhook 的发送器（ADR 0027）。不给：真实的 HTTPS 发送器（防 SSRF：只连公网地址）。
   * 集成测试给一个打开了 `allowLocalTargets` 的发送器，推到本机的假服务器。
   */
  webhookSender?: WebhookSender;
  /** 运营后台填写的第三方密钥在本进程的缓存多久重读一次（毫秒，ADR 0041）；不给用 5 秒。测试用它模拟「另一个进程改了密钥」 */
  integrationSecretsTtlMs?: number;
  /** 官网地址搜索、反查的进程内短时缓存保留多久（毫秒，ADR 0044）；不给用 10 分钟。测试用它验证过期 */
  placeCacheTtlMs?: number;
  /** 是否启动后台定时任务（汇率定时拉取和过期告警、待支付超时取消、Webhook 投递、供应商每日检查、供应商账单）。只有服务进程（server.ts）打开；测试直接调 `FxCenter.tick`、`OrderJobs.tick` */
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
    /** 供应商的每日检查：资质到期、评分、自动观察 / 暂停 / 转正式（服务进程用 `jobs` 启动它；测试直接调 `tick`） */
    tenantJobs: TenantJobs;
    /** 推送给供应商的 Webhook 的投递任务（服务进程用 `jobs` 启动它；测试直接调 `tick`） */
    webhookJobs: WebhookJobs;
    /** 供应商账单：每月出上个月的账、确认期满视为确认（服务进程用 `jobs` 启动它；测试直接调 `tick`） */
    billingJobs: BillingJobs;
  }
}

/**
 * 日志规则（细节见 logging.ts）：
 * - 请求只记方法、路由模板（不是实际路径，ADR 0041）、来源地址；不记请求头和请求体。
 * - 异常只记类型、错误码、说明、调用栈，并抹掉其中的密钥原文和连接串。
 * - 再加一层兜底：万一以后有人把请求头打进日志，凭证类字段也会被抹掉。
 */
function loggerOptions(deps: AppDeps, extraSecrets: () => readonly string[]): NonNullable<FastifyServerOptions["logger"]> {
  const secrets = secretValues(deps.config);
  const allSecrets = (): string[] => [...secrets, ...extraSecrets()].sort((a, b) => b.length - a.length);
  return {
    level: deps.config.appEnv === "local" ? "debug" : "info",
    serializers: {
      // 运营后台填写的密钥（ADR 0041）随时会变：每次现取
      req: (request: Parameters<typeof serializeRequest>[0]) => serializeRequest(request, allSecrets()),
      err: (err: unknown) => serializeError(err, allSecrets()),
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
  // 日志脱敏要抹掉运营后台填写的密钥：缓存在 Fastify 建好之后才有（它要用 Fastify 的日志）
  let integrations: IntegrationSecretCache | null = null;
  const app = Fastify({
    logger: deps.logger === false ? false : loggerOptions(deps, () => integrations?.secretValues() ?? []),
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
    if (path.startsWith("/platform/") || path.startsWith("/tenant/") || path.startsWith("/sales/") || path.startsWith("/driver/") || path.startsWith("/site/")) reply.header("cache-control", "no-store");
  });

  const secretBox = config.dataEncryptionKey === null ? null : new SecretBox(config.dataEncryptionKey);
  const secretCache = new IntegrationSecretCache({ pool, config, secretBox, log: app.log, ...(deps.integrationSecretsTtlMs === undefined ? {} : { ttlMs: deps.integrationSecretsTtlMs }) });
  integrations = secretCache;
  // 每个请求开始前看一眼运营后台填写的密钥过没过期（ADR 0041）：过期了先重读（最多等 0.5 秒），所以别的进程改了密钥，这里最迟 5 秒后用上
  app.addHook("onRequest", async () => {
    await secretCache.ensureFresh();
  });

  app.get("/health", async (_request, reply) => {
    const report = await checkHealth({
      config,
      effective: secretCache.effective,
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
  // 收款服务跟着生效的 Stripe 密钥走（ADR 0041）：密钥变了才新建一个，没变一直用同一个
  const stripeEndpoint = config.integrationEndpoints.stripeApi;
  let stripeProvider: { signature: string; provider: StripePaymentProvider } | null = null;
  const currentPayments = (): PaymentProvider | null => {
    const stripe = secretCache.effective.stripe.config;
    if (stripe === null) return null;
    const signature = [stripe.secretKey, stripe.publishableKey, stripe.webhookSecret].join("\n");
    if (stripeProvider?.signature !== signature) stripeProvider = { signature, provider: new StripePaymentProvider(stripe, { endpoint: stripeEndpoint }) };
    return stripeProvider.provider;
  };
  const integrationChecks: IntegrationChecks = {
    googleMaps: (apiKey) => checkGoogleMapsKey(apiKey, { url: config.integrationEndpoints.googleMapsRoutesUrl }),
    stripe: (stripe) => checkStripeKey(stripe, { endpoint: stripeEndpoint }),
  };
  // 路线预估（ADR 0042）：每次现取生效的谷歌密钥（运营后台填写的优先），换了密钥下一次询价就用新的
  const routes = new GoogleRouteEstimator({
    pool,
    now,
    apiKey: () => secretCache.effective.googleMaps.apiKey,
    dailyLimit: config.routes.dailyLimit,
    compute: (apiKey, from, to, beforeAttempt) => computeRoute(apiKey, from, to, { url: config.integrationEndpoints.googleMapsRoutesUrl, beforeAttempt }),
    log: app.log,
  });
  // 官网的地址搜索和反查（ADR 0044）：同样每次现取生效的谷歌密钥；每日上限和路线分开计
  const places = new GooglePlaceSearch({
    pool,
    now,
    apiKey: () => secretCache.effective.googleMaps.apiKey,
    dailyLimit: config.places.dailyLimit,
    search: (apiKey, request, beforeAttempt) => searchPlaces(apiKey, request, { url: config.integrationEndpoints.googlePlacesSearchUrl, beforeAttempt }),
    reverse: (apiKey, point, regionCode, beforeAttempt) => reverseGeocode(apiKey, point, regionCode, { url: config.integrationEndpoints.googleGeocodeUrl, beforeAttempt }),
    log: app.log,
    ...(deps.placeCacheTtlMs === undefined ? {} : { cacheTtlMs: deps.placeCacheTtlMs }),
  });
  const context: AppContext = {
    config,
    pool,
    now,
    fx,
    get payments() {
      return deps.payments !== undefined ? deps.payments : currentPayments();
    },
    integrations: secretCache,
    integrationChecks,
    quote: { ...defaultQuoteDeps(config, fx.rates, routes, now), ...deps.quote },
    secretBox,
    webhookSender: deps.webhookSender ?? new HttpsWebhookSender(),
    places,
  };
  const orderJobs = new OrderJobs(context, app.log);
  app.decorate("orderJobs", orderJobs);
  const webhookJobs = new WebhookJobs(context, app.log);
  app.decorate("webhookJobs", webhookJobs);
  const tenantJobs = new TenantJobs(context, app.log);
  app.decorate("tenantJobs", tenantJobs);
  const billingJobs = new BillingJobs(context, app.log);
  app.decorate("billingJobs", billingJobs);
  if (deps.jobs) {
    fx.start();
    orderJobs.start();
    webhookJobs.start();
    tenantJobs.start();
    billingJobs.start();
    app.addHook("onClose", () => fx.stop());
    app.addHook("onClose", () => orderJobs.stop());
    app.addHook("onClose", () => webhookJobs.stop());
    app.addHook("onClose", () => tenantJobs.stop());
    app.addHook("onClose", () => billingJobs.stop());
  }
  registerPlatformRoutes(app, context);
  registerPlatformSecurityRoutes(app, context);
  registerIntegrationSecretRoutes(app, context);
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
  registerOrderActionRoutes(app, context);
  registerRescueRoutes(app, context);
  registerOrderCenterRoutes(app, context);
  registerBillingRoutes(app, context);
  registerWebhookRoutes(app, context);
  registerFleetRoutes(app, context);
  registerDispatchRoutes(app, context);
  registerDriverRoutes(app, context);
  registerTenantWebhookRoutes(app, context);
  registerTenantOnboardingRoutes(app, context);
  registerSiteRoutes(app, context);

  return app;
}
