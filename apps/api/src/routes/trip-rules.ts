/**
 * 跨段规则配置（M9T-02，ADR 0101 第五节）：
 * - `GET /tenant/v1/products/{id}/trip-rules`（`product.read`）、`PUT`（`product.manage`，带 `If-Match` 商品版本号，整体替换）；
 * - `GET /platform/v1/products/{id}/trip-rules`（`product.read`）：运营只读。
 * 金额只有结算价（规则 4）；字段名沿用配置本身的写法（camelCase），因为它整份存进 `trip_rule_configs.config`。
 */
import type { TripRuleConfig } from "@nozomi/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { bearerToken } from "../auth/token.ts";
import type { AppContext } from "../context.ts";
import { authenticatePlatform, platformCredentials } from "../services/platform-auth.ts";
import { authenticateTenant } from "../services/tenant-auth.ts";
import { type TripRulesView, getPlatformTripRules, getTripRules, putTripRules } from "../services/trip-rules.ts";
import { ifMatchVersion, parseInput, resourceId } from "../validation.ts";

/** 外层只要求是对象；逐项的键、类型、范围由 domain `tripRuleIssues` 校验（报 `/lodging/perNightMinor` 这样的路径） */
const configSchema = z.record(z.string(), z.unknown());

export function tripRulesJson(view: TripRulesView) {
  return {
    product_id: view.productId,
    version: view.version,
    rules_version: view.rulesVersion,
    settlement_currency: view.settlementCurrency,
    saved: view.saved,
    effective: view.effective,
  };
}

export function registerTripRuleRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/tenant/v1/products/:id/trip-rules", async (request) => {
    const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "product.read" });
    return tripRulesJson(await getTripRules(ctx, principal.tenantId, resourceId(request.params, "商品")));
  });

  app.put("/tenant/v1/products/:id/trip-rules", async (request) => {
    const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "product.manage" });
    const productId = resourceId(request.params, "商品");
    const version = ifMatchVersion(request.headers["if-match"]);
    const config = parseInput(configSchema, request.body, "body") as TripRuleConfig;
    return tripRulesJson(await putTripRules(ctx, { principal, ip: request.ip }, productId, version, config));
  });

  app.get("/platform/v1/products/:id/trip-rules", async (request) => {
    await authenticatePlatform(ctx, platformCredentials(request), { action: "product.read" });
    return tripRulesJson(await getPlatformTripRules(ctx, resourceId(request.params, "商品")));
  });
}
