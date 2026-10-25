/**
 * 报价试算的两个接口（M2-01，ADR 0020）。
 * - `POST /platform/v1/quotes/preview`：平台员工用，所有供应商一起比，看得到结算价、对外价、加价比例和每个没报出价的原因。
 * - `POST /tenant/v1/products/:id/quote-preview`：供应商对自己的一个商品试算，**只有结算价和明细**——
 *   这条路径不算对外价、不取加价比例，应答的结构里也没有这些字段（规则 4）。
 * 金额是最小货币单位的整数；`exact` 里是取整之前的精确值（十进制写法的字符串）。
 */
import { type ComparisonRefusal, type FxQuote, type PlatformRole, platformRoleCan, PRICE_LIMITS, type PlatformAction, QUOTE_RULES, SERVICE_CATEGORIES, type SettlementBreakdown, TRIP_DIRECTIONS, type TenantAction, type VehicleOffer } from "@nozomi/domain";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.ts";
import { type PlatformPrincipal, authenticatePlatform } from "../services/platform-auth.ts";
import { type QuotePreviewInput, markupKey, previewPlatformQuote, previewTenantQuote } from "../services/quotes.ts";
import { type TenantPrincipal, authenticateTenant } from "../services/tenant-auth.ts";
import { bearerToken } from "../auth/token.ts";
import { forbidden } from "../services/errors.ts";
import { parseInput, resourceId, uuidSchema } from "../validation.ts";

type Json = Record<string, unknown>;

/** 报价用的汇率；有人工锁定时 `lock` 里写明哪一边锁定、锁定值和到期时间（M2-06，ADR 0025），没有为 null。 */
export function fxJson(fx: FxQuote): Json {
  return {
    from: fx.from,
    to: fx.to,
    rate: fx.rate,
    as_of: fx.asOf,
    lock: fx.lock === undefined ? null : { legs: fx.lock.legs.map((leg) => ({ currency: leg.currency, rate: leg.rate, lock_id: leg.lockId, expires_at: leg.expiresAt })), uses_source: fx.lock.usesSource },
  };
}

const pointSchema = z.object({ lng: z.number().min(-180).max(180), lat: z.number().min(-90).max(90) }).strict();

const previewShape = {
  pickup: pointSchema.nullable().default(null),
  dropoff: pointSchema.nullable().default(null),
  direction: z.enum(TRIP_DIRECTIONS).nullable().default(null),
  package_hours: z.number().int().min(1).max(PRICE_LIMITS.maxPackageHours).nullable().default(null),
  service_time: z.string().max(16),
  passengers: z.number().int(),
  luggage: z.number().int().default(0),
  addons: z.array(z.object({ addon_id: uuidSchema, quantity: z.number().int().default(1) }).strict()).max(QUOTE_RULES.maxAddonKinds).default([]),
  driver_language: z.string().max(10).nullable().default(null),
  vehicle_group_ids: z.array(uuidSchema).max(30).default([]),
  assume_route: z.object({ meters: z.number().int(), minutes: z.number().int() }).strict().nullable().default(null),
};
const tenantPreviewSchema = z.object(previewShape).strict();
const platformPreviewSchema = z
  .object({ ...previewShape, city_id: uuidSchema, category: z.enum(SERVICE_CATEGORIES), place_id: uuidSchema.nullable().default(null), currency: z.string().max(3), channel_id: uuidSchema.nullable().default(null) })
  .strict();

function previewInput(input: z.output<typeof tenantPreviewSchema>): QuotePreviewInput {
  return {
    pickup: input.pickup,
    dropoff: input.dropoff,
    direction: input.direction,
    packageHours: input.package_hours,
    serviceLocal: input.service_time,
    passengers: input.passengers,
    luggage: input.luggage,
    addons: input.addons.map((addon) => ({ addonId: addon.addon_id, quantity: addon.quantity })),
    driverLanguage: input.driver_language,
    vehicleGroupIds: input.vehicle_group_ids,
    assumeRoute: input.assume_route,
  };
}

/** 报不出价的原因，写给人看。 */
export const REFUSAL_MESSAGES: Readonly<Record<ComparisonRefusal, string>> = {
  PRODUCT_NOT_PUBLISHED: "商品没有上架",
  TENANT_SUSPENDED: "供应商已被平台暂停，商品不参与比价",
  BRAND_DISABLED: "商品的子品牌已停用",
  SERVICE_RULES_INCOMPLETE: "服务规则还没填全（服务时间、提前预订时长）",
  INVALID_SERVICE_TIME: "用车时间写得不对",
  OUTSIDE_SALE_PERIOD: "今天不在这个商品的下单有效期里",
  OUTSIDE_SERVICE_TIME: "用车时间不在这个商品每天的服务时间里",
  SERVICE_TIME_PASSED: "用车时间已经过去了",
  LEAD_TIME_TOO_SHORT: "离用车的时间不够提前预订时长，而且没开加急（或没有够用的一档）",
  URGENT_SOLD_OUT: "这一天的加急库存用完了",
  OUT_OF_SERVICE_AREA: "地址不在这个商品任何一个区域的营运区里",
  IN_FORBIDDEN_AREA: "地址在禁行区里",
  ADDON_NOT_OFFERED: "要的附加服务这个商品不提供",
  DRIVER_LANGUAGE_NOT_OFFERED: "要的司机语言这个商品不提供",
  SOLD_OUT: "这一天的库存不足",
  VEHICLE_GROUP_NOT_OFFERED: "这个商品没有选这个车型组",
  VEHICLE_GROUP_DISABLED: "这个车型组已被平台停用",
  CAPACITY_EXCEEDED: "人数或行李数超过了这个车型组的组合",
  NO_PRICE_RULE: "这个区域、车型组、方向或套餐没有价格",
  PRICE_NOT_IN_EFFECT: "有价格，但用车日期不在它的生效期里",
  PRICE_RULE_DISABLED: "对得上的那条价格停用了",
  ROUTE_UNAVAILABLE: "价格是「里程 + 时长」，需要路线预估，而现在取不到",
  PRICE_NOT_POSITIVE: "调价、取整之后价格不大于 0",
  PRICE_OVER_LIMIT: "价格超过了结算价的上限",
  FX_RATE_UNAVAILABLE: "商品的结算币种和客人支付的币种不同，而现在没有可用的汇率（没有，或超过 48 小时没更新）",
  SELL_PRICE_OVER_LIMIT: "对外价超过了上限",
};

/** 结算价的明细。两个接口共用——里面只有供应商自己的结算价，没有对外价和加价比例。 */
function settlementJson(settlement: SettlementBreakdown): Json {
  return {
    currency: settlement.currency,
    rounding_unit: settlement.roundingUnit,
    total: settlement.totalMinor,
    base: settlement.baseMinor,
    adjust: settlement.adjustMinor,
    urgent: settlement.urgentMinor,
    night: settlement.nightMinor,
    addons: settlement.addonsMinor,
    driver_language: settlement.driverLanguageMinor,
    exact: settlement.exact,
    adjusts: settlement.adjusts.map((entry) => ({ rule_id: entry.ruleId, name: entry.name, steps: entry.steps })),
    urgent_tier: settlement.urgentTier === null ? null : { within_hours: settlement.urgentTier.withinHours, surcharge: settlement.urgentTier.surchargeMinor },
    night_detail: settlement.night === null ? null : { charge_unit: settlement.night.chargeUnit, overlap_minutes: settlement.night.overlapMinutes },
    addon_items: settlement.addons.map((addon) => ({ addon_id: addon.addonId, charge_unit: addon.chargeUnit, quantity: addon.quantity, charged_quantity: addon.chargedQuantity, first_free: addon.firstFree, unit_price: addon.unitPriceMinor, amount: addon.amountMinor, amount_exact: addon.amountExact })),
    driver_language_code: settlement.driverLanguage,
    usage: settlement.usage,
    free_wait: {
      item: settlement.freeWait.item,
      mode: settlement.freeWait.value?.mode ?? null,
      minutes: settlement.freeWait.value?.mode === "limited" ? settlement.freeWait.value.minutes : null,
      platform_minimum_minutes: settlement.freeWait.platformMinimumMinutes,
    },
  };
}

const offerJson = (offer: VehicleOffer): Json => ({ vehicle_group_id: offer.vehicleGroupId, package_hours: offer.packageHours, area_id: offer.areaId, price_rule_id: offer.priceRuleId, settlement: settlementJson(offer.settlement) });

/**
 * 按渠道试算会看到渠道的加价规则：除了 `quote.preview`，另要能看渠道（`channel.read`），否则 403。
 * 显式检查，不依赖「有试算权限的角色恰好都能看渠道」。
 */
export function assertChannelPreviewAllowed(role: PlatformRole, channelId: string | null): void {
  if (channelId !== null && !platformRoleCan(role, "channel.read")) throw forbidden("channel.read");
}

export function registerQuoteRoutes(app: FastifyInstance, ctx: AppContext): void {
  const platform = (request: FastifyRequest, action: PlatformAction): Promise<PlatformPrincipal> => authenticatePlatform(ctx, bearerToken(request.headers.authorization), { action });
  const tenant = (request: FastifyRequest, action: TenantAction): Promise<TenantPrincipal> => authenticateTenant(ctx, bearerToken(request.headers.authorization), { action });

  app.post("/platform/v1/quotes/preview", async (request) => {
    const principal = await platform(request, "quote.preview");
    const input = parseInput(platformPreviewSchema, request.body, "body");
    assertChannelPreviewAllowed(principal.user.role, input.channel_id);
    const preview = await previewPlatformQuote(ctx, { ...previewInput(input), cityId: input.city_id, category: input.category, placeId: input.place_id, currency: input.currency, channelId: input.channel_id }, { log: request.log });
    const byProduct = new Map([...preview.candidates, ...preview.excluded].map((candidate) => [candidate.product.productId, candidate]));
    const who = (productId: string): Json => {
      const candidate = byProduct.get(productId);
      return { tenant_id: candidate?.product.tenantId ?? null, tenant_name: candidate?.tenantName ?? null, product_id: productId, product_code: candidate?.code ?? null };
    };
    return {
      currency: preview.currency,
      band_bp: preview.bandBp,
      markup_floor_bp: preview.markupFloorBp,
      channel: preview.channel === null ? null : { id: preview.channel.id, name: preview.channel.name, status: preview.channel.status, min_margin: preview.channel.pricing.minMarginMinor, settle_currency: preview.channel.settleCurrency, rounding_unit: preview.channel.pricing.sellRounding[preview.currency] ?? 1 },
      route: preview.route,
      candidate_count: preview.candidates.length,
      groups: preview.comparison.groups.map((group) => ({
        vehicle_group_id: group.vehicleGroupId,
        package_hours: group.packageHours,
        created_at: group.snapshot.createdAt,
        expires_at: group.snapshot.expiresAt,
        winner: { ...who(group.snapshot.winner.productId), sell: group.snapshot.winner.sell.sellMinor, settlement: group.snapshot.winner.offer.settlement.totalMinor, settlement_currency: group.snapshot.winner.offer.settlement.currency },
        candidates: group.ranked.map(({ candidate, rankPrice, inBand, position }) => ({
          position,
          in_band: inBand,
          rank_price: rankPrice,
          ...who(candidate.productId),
          product_version: candidate.productVersion,
          observation: candidate.observation,
          score_centi: candidate.scoreCenti,
          completed_orders: candidate.completedOrders,
          sell: candidate.sell.sellMinor,
          sell_exact: candidate.sell.exact,
          markup_bp: candidate.sell.markupBp,
          markup_level: preview.markups.get(markupKey(candidate.productId, candidate.offer.vehicleGroupId))?.level ?? null,
          markup_rule_id: preview.markups.get(markupKey(candidate.productId, candidate.offer.vehicleGroupId))?.ruleId ?? null,
          min_margin_applied: candidate.sell.channel?.minMarginApplied ?? false,
          fx_buffer_bp: candidate.sell.fxBufferBp,
          fx: candidate.sell.fx === null ? null : fxJson(candidate.sell.fx),
          offer: offerJson(candidate.offer),
        })),
      })),
      refused: preview.comparison.refused.map((entry) => ({ ...who(entry.productId), vehicle_group_id: entry.vehicleGroupId, reason: entry.reason, message: REFUSAL_MESSAGES[entry.reason] })),
      excluded: preview.excluded.map((candidate) => who(candidate.product.productId)),
    };
  });

  app.post("/tenant/v1/products/:id/quote-preview", async (request) => {
    const principal = await tenant(request, "product.read");
    const productId = resourceId(request.params, "商品");
    const input = parseInput(tenantPreviewSchema, request.body, "body");
    const { candidate, quote, route } = await previewTenantQuote(ctx, principal.tenantId, productId, previewInput(input), { log: request.log });
    return {
      product_id: candidate.product.productId,
      code: candidate.code,
      status: candidate.product.status,
      version: candidate.version,
      currency: candidate.product.currency,
      rounding_unit: candidate.product.roundingUnit,
      route,
      // 商品层面就报不出（对所有车型组都一样）时给原因；否则每个车型组各有一个价或一个原因
      refusal: quote.ok ? null : { reason: quote.reason, message: REFUSAL_MESSAGES[quote.reason] },
      service_date: quote.ok ? quote.serviceDate : null,
      urgent: quote.ok ? quote.urgent : false,
      offers: quote.ok ? quote.offers.map(offerJson) : [],
      refused: quote.ok ? quote.refused.map((entry) => ({ vehicle_group_id: entry.vehicleGroupId, reason: entry.reason, message: REFUSAL_MESSAGES[entry.reason] })) : [],
    };
  });
}
