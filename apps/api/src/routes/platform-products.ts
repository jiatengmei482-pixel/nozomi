/**
 * /platform/v1 查看供应商的商品（M1-12，ADR 0021）。只有两个读接口，平台没有修改租户商品的接口。
 * 这里只做鉴权（`product.read`）、校验查询参数、调用、返回；流程在 services/platform-products.ts。
 *
 * 应答里的各部分和租户侧对应接口的结构完全一样（同一组序列化函数），页面可以共用同一套展示组件；
 * 平台侧多出「属于哪个供应商」和「有没有可以卖的价格」。平台可以看结算价（规则 4 只限制 `/tenant/v1`），这里没有对外价和加价比例。
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { PRODUCT_STATUSES, SERVICE_CATEGORIES } from "@nozomi/domain";
import { bearerToken } from "../auth/token.ts";
import type { AppContext } from "../context.ts";
import { decodeTimeCursor } from "../pagination.ts";
import { authenticatePlatform, platformCredentials } from "../services/platform-auth.ts";
import { type PlatformProductListEntry, type ProductTenantRef, getPlatformProduct, listPlatformProducts } from "../services/platform-products.ts";
import { pageQuerySchema, parseInput, resourceId, uuidSchema } from "../validation.ts";
import { adjustRulesJson, priceRulesJson } from "./prices.ts";
import { contentJson, productJson, publishCheckJson, serviceRulesJson } from "./products.ts";

type Json = Record<string, unknown>;

const id = uuidSchema.transform((value) => value.toLowerCase());

const listQuerySchema = pageQuerySchema.extend({
  q: z.string().trim().min(1).max(100).optional(),
  tenant_id: id.optional(),
  city_id: id.optional(),
  category: z.enum(SERVICE_CATEGORIES).optional(),
  status: z.enum([...PRODUCT_STATUSES, "all"]).default("all"),
  brand_id: id.optional(),
  has_active_price: z.enum(["true", "false"]).optional(),
});

function tenantRefJson(tenant: ProductTenantRef): Json {
  return { id: tenant.id, name: tenant.name, status: tenant.status };
}

function listItemJson(entry: PlatformProductListEntry): Json {
  return {
    ...productJson(entry.view),
    tenant_id: entry.tenant.id,
    tenant: tenantRefJson(entry.tenant),
    has_active_price: entry.activePriceRuleCount > 0,
    active_price_rule_count: entry.activePriceRuleCount,
  };
}

export function registerPlatformProductRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/platform/v1/products", async (request) => {
    await authenticatePlatform(ctx, platformCredentials(request), { action: "product.read" });
    const query = parseInput(listQuerySchema, request.query, "querystring");
    const page = await listPlatformProducts(
      ctx,
      {
        tenantId: query.tenant_id,
        search: query.q,
        status: query.status === "all" ? undefined : query.status,
        category: query.category,
        cityId: query.city_id,
        brandId: query.brand_id,
        hasActivePrice: query.has_active_price === undefined ? undefined : query.has_active_price === "true",
      },
      query.limit,
      decodeTimeCursor(query.cursor ?? null),
    );
    return { items: page.items.map(listItemJson), next_cursor: page.nextCursor, total: page.total };
  });

  app.get("/platform/v1/products/:id", async (request) => {
    await authenticatePlatform(ctx, platformCredentials(request), { action: "product.read" });
    const found = await getPlatformProduct(ctx, resourceId(request.params, "商品"));
    return {
      tenant: tenantRefJson(found.tenant),
      product: productJson(found.view),
      service_rules: serviceRulesJson(found.serviceRules),
      content: contentJson(found.view.product.content),
      price_rules: priceRulesJson(found.prices),
      adjust_rules: adjustRulesJson(found.adjusts),
      inventory: { mode: found.inventory.mode, sellable_days_ahead: found.inventory.sellableDaysAhead },
      publish_check: publishCheckJson(found.publishCheck),
    };
  });
}
