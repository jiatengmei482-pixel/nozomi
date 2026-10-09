/**
 * 库存的接口（M1-05）：模式、库存日历、批量设置。这里只做鉴权、校验字段的类型、调用、返回；
 * 规则在 @nozomi/domain 的 inventory.ts，流程在 services/inventory.ts。
 * 租户编号只来自令牌（`principal.tenantId`）：这里没有任何地方从请求参数或请求体读 tenant_id。
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { INVENTORY_MODES, type TenantAction, weekdayOf } from "@nozomi/domain";
import { bearerToken } from "../auth/token.ts";
import type { AppContext } from "../context.ts";
import { type InventoryView, batchSetInventory, getInventory, setInventoryMode } from "../services/inventory.ts";
import { type TenantPrincipal, authenticateTenant } from "../services/tenant-auth.ts";
import { ifMatchVersion, parseInput, resourceId } from "../validation.ts";

type Json = Record<string, unknown>;

const date = z.string().max(10);
const rangeQuerySchema = z.object({ from: date, to: date });
const modeSchema = z.object({ mode: z.enum(INVENTORY_MODES) });
// 这里只管类型；日期、星期、数量的范围由 domain 查，报出原因代码
const batchSchema = z.object({
  from: date,
  to: date,
  weekdays: z.array(z.number().finite()).max(50).default([]),
  total: z.number().finite().nullable().default(null),
});

export function inventoryJson(view: InventoryView): Json {
  return {
    version: view.version,
    mode: view.mode,
    today: view.today,
    days: view.days.map((day) => ({ date: day.date, weekday: weekdayOf(day.date), total: day.total, held: day.held, sold: day.sold, remaining: day.remaining, status: day.status })),
  };
}

export function registerInventoryRoutes(app: FastifyInstance, ctx: AppContext): void {
  const authenticate = (request: FastifyRequest, action: TenantAction): Promise<TenantPrincipal> => authenticateTenant(ctx, bearerToken(request.headers.authorization), { action });

  app.get("/tenant/v1/products/:id/inventory", async (request) => {
    const principal = await authenticate(request, "product.read");
    const productId = resourceId(request.params, "商品");
    const query = parseInput(rangeQuerySchema, request.query, "querystring");
    return inventoryJson(await getInventory(ctx, principal.tenantId, productId, query.from, query.to));
  });

  app.put("/tenant/v1/products/:id/inventory", async (request) => {
    const principal = await authenticate(request, "product.manage");
    const productId = resourceId(request.params, "商品");
    const version = ifMatchVersion(request.headers["if-match"]);
    const input = parseInput(modeSchema, request.body, "body");
    return setInventoryMode(ctx, { principal, ip: request.ip }, productId, version, input.mode);
  });

  app.post("/tenant/v1/products/:id/inventory/batch-set", async (request) => {
    const principal = await authenticate(request, "product.manage");
    const productId = resourceId(request.params, "商品");
    const version = ifMatchVersion(request.headers["if-match"]);
    const input = parseInput(batchSchema, request.body, "body");
    const saved = await batchSetInventory(ctx, { principal, ip: request.ip }, productId, version, input);
    return { ...inventoryJson(saved), changed_days: saved.changedDays };
  });
}
