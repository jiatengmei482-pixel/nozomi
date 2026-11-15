/**
 * 包车机场开始 / 机场结束套餐的机场绑定（M9P-21，ADR 0098 第三节第 2 小节）：
 * - `GET /tenant/v1/products/{id}/charter-airports`：本商品的机场绑定；
 * - `PUT /tenant/v1/products/{id}/charter-airports`：整组替换（带 `If-Match` 商品版本号）。
 * 租户只能读写自己的商品（`tenant_id` 只来自登录令牌）。
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { AIRPORT_SCENARIO_KINDS } from "@nozomi/domain";
import { authenticateTenant } from "../services/tenant-auth.ts";
import { bearerToken } from "../auth/token.ts";
import type { AppContext } from "../context.ts";
import { type CharterAirportsView, getCharterAirports, putCharterAirports } from "../services/charter-airports.ts";
import { ifMatchVersion, parseInput, resourceId, uuidSchema } from "../validation.ts";

const bindingsSchema = z
  .object({
    bindings: z
      .array(
        z.object({
          scenario: z.enum(AIRPORT_SCENARIO_KINDS),
          place_id: uuidSchema.transform((value) => value.toLowerCase()),
          area_id: uuidSchema.transform((value) => value.toLowerCase()),
          short_name_zh: z.string().trim().max(100).nullable().default(null),
        }),
      )
      .max(100),
  })
  .strict();

export function charterAirportsJson(view: CharterAirportsView) {
  return {
    version: view.version,
    bindings: view.bindings.map((binding) => ({
      scenario: binding.scenario,
      place_id: binding.placeId,
      place_code: binding.placeCode,
      place_name: binding.placeName,
      area_id: binding.areaId,
      area_name: binding.areaName,
      short_name_zh: binding.shortNameZh,
      effective: binding.effective,
    })),
  };
}

export function registerCharterAirportRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/tenant/v1/products/:id/charter-airports", async (request) => {
    const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "product.read" });
    return charterAirportsJson(await getCharterAirports(ctx, principal.tenantId, resourceId(request.params, "商品")));
  });

  app.put("/tenant/v1/products/:id/charter-airports", async (request) => {
    const principal = await authenticateTenant(ctx, bearerToken(request.headers.authorization), { action: "product.manage" });
    const productId = resourceId(request.params, "商品");
    const version = ifMatchVersion(request.headers["if-match"]);
    const input = parseInput(bindingsSchema, request.body, "body");
    const bindings = input.bindings.map((entry) => ({ scenario: entry.scenario, placeId: entry.place_id, areaId: entry.area_id, shortNameZh: entry.short_name_zh === null || entry.short_name_zh === "" ? null : entry.short_name_zh }));
    return charterAirportsJson(await putCharterAirports(ctx, { principal, ip: request.ip }, productId, version, bindings));
  });
}
