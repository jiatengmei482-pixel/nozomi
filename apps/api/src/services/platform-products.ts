/**
 * 运营后台查看供应商的商品（M1-12，ADR 0021）：所有供应商的商品列表、一个商品的只读详情。
 *
 * - 只读：在平台事务里以只读快照执行（`begin … read only`），平台角色对这些租户表也只有 SELECT（迁移 0013、0016、0017）。
 *   这里没有任何写入，也不写审计日志（和查看租户列表一样，是平台员工的日常查询）。
 * - 详情和供应商自己看到的是同一份：基础信息、服务规则、价格规则、调价规则、上架校验都调用租户侧的同一组函数，
 *   只是租户编号来自「这个商品属于谁」，而不是登录令牌——这是平台员工的跨租户操作（ADR 0003）。
 * - 平台可以看结算价（规则 4 只限制 `/tenant/v1`）；这里不算对外价、不取加价比例。
 */
import type { InventoryMode } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { withPlatformTx } from "../db/context.ts";
import type { TimeCursor } from "../pagination.ts";
import { findAreaCities } from "../repos/areas.ts";
import { countSellableDays, findInventoryMode } from "../repos/inventory.ts";
import {
  type Brand,
  type PlatformProductFilter,
  findBrands,
  findPlacesForProduct,
  findProductAcrossTenants,
  listProductsAcrossTenants,
} from "../repos/products.ts";
import { type TenantStatus, findTenantForPlatform } from "../repos/tenants.ts";
import { notFound } from "./errors.ts";
import { type AdjustRulesView, type PriceRulesView, adjustRulesView, loadPricingContext, priceRulesView } from "./prices.ts";
import { type ProductView, type PublishCheckView, type ServiceRulesView, detail, publishCheckOf, serviceRulesView } from "./products.ts";

export interface ProductTenantRef {
  id: string;
  name: string;
  status: TenantStatus;
}

export interface PlatformProductListEntry {
  view: ProductView;
  tenant: ProductTenantRef;
  activePriceRuleCount: number;
}

export async function listPlatformProducts(
  ctx: AppContext,
  filter: PlatformProductFilter,
  limit: number,
  after: TimeCursor | null,
): Promise<{ items: PlatformProductListEntry[]; nextCursor: string | null; total: number }> {
  const now = ctx.now();
  return withPlatformTx(
    ctx.pool,
    async (db) => {
      const page = await listProductsAcrossTenants(db, filter, now, limit, after);
      // 子品牌按租户分开取（每个租户一条查询，条件里带着租户编号）
      const brands = new Map<string, Brand>();
      for (const tenantId of new Set(page.items.map((item) => item.tenantId))) {
        const ids = [...new Set(page.items.filter((item) => item.tenantId === tenantId).map((item) => item.brandId))];
        for (const [id, brand] of await findBrands(db, tenantId, ids)) brands.set(id, brand);
      }
      const cities = await findAreaCities(db, [...new Set(page.items.map((item) => item.cityId))]);
      const places = await findPlacesForProduct(db, [...new Set(page.items.flatMap((item) => (item.poiId === null ? [] : [item.poiId])))]);
      const items = page.items.map((item): PlatformProductListEntry => {
        const { areaCount, vehicleGroupCount, tenantId: _owner, tenant, activePriceRuleCount, ...product } = item;
        return {
          view: {
            product,
            brand: brands.get(item.brandId) ?? null,
            city: cities.get(item.cityId) ?? null,
            poi: item.poiId === null ? null : (places.get(item.poiId) ?? null),
            areaCount,
            vehicleGroupCount,
            areas: null,
            vehicleGroups: null,
            dispatchers: null,
            check: null,
          },
          tenant,
          activePriceRuleCount,
        };
      });
      return { items, nextCursor: page.nextCursor, total: page.total };
    },
    { snapshot: true },
  );
}

export interface PlatformProductDetail {
  tenant: ProductTenantRef;
  view: ProductView;
  serviceRules: ServiceRulesView;
  prices: PriceRulesView;
  adjusts: AdjustRulesView;
  inventory: { mode: InventoryMode; sellableDaysAhead: number };
  publishCheck: PublishCheckView;
}

/** 一个商品的只读详情。不存在的编号 404（不区分属于哪个供应商）。 */
export function getPlatformProduct(ctx: AppContext, id: string): Promise<PlatformProductDetail> {
  const now = ctx.now();
  return withPlatformTx(
    ctx.pool,
    async (db) => {
      const found = await findProductAcrossTenants(db, id);
      if (!found) throw notFound("商品");
      const { tenantId, product } = found;
      const tenant = await findTenantForPlatform(db, tenantId, { lock: false });
      if (!tenant) throw notFound("商品");
      const pricing = await loadPricingContext(db, tenantId, product.id, now, { lock: false });
      return {
        tenant: { id: tenant.id, name: tenant.name, status: tenant.status },
        view: await detail(db, tenantId, product),
        serviceRules: await serviceRulesView(db, tenantId, product),
        prices: priceRulesView(pricing, product, pricing.priceRules),
        adjusts: adjustRulesView(pricing),
        inventory: {
          mode: (await findInventoryMode(db, tenantId, product.id)) ?? "unlimited",
          sellableDaysAhead: await countSellableDays(db, tenantId, product.id, pricing.today),
        },
        publishCheck: await publishCheckOf(db, tenantId, product, now),
      };
    },
    { snapshot: true },
  );
}
