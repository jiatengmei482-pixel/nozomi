/**
 * 正式询价 `POST /sales/v1/quotes`、`GET /sales/v1/quotes/{quote_id}`（M2-04，ADR 0023）。
 *
 * 一次询价 = 在渠道的授权范围里比价（`previewPlatformQuote` 带渠道、`fresh: false`：候选商品和规则用 30 秒内的缓存，库存、节假日、评分现查）
 * → 每个车型组（包车再按套餐）生成一个 `quote_id`、把快照存进 `quotes`（有效期 30 分钟，下单以它为准）→ 一行询价日志（全部候选和没报出价的原因）。
 *
 * 给渠道的应答只有：quote_id、有效期、车型组、对外价（客人支付的币种）、汇率和取数时间、免费等待。
 * **没有中标租户、结算价、加价比例**（需求「付款前不显示中标租户」「参与比价的租户和它们的报价只在平台内部记录」；规则 4 的精神）。
 * 报不出价的车型组只给面向客人的原因（不在服务范围、提前量不够、售罄……），不给供应商内部的原因（暂停、子品牌停用、缺价格）。
 */
import { randomInt } from "node:crypto";
import { performance } from "node:perf_hooks";
import { type ComparisonRefusal, type CurrencyCode, type LatLng, type MarkupMatch, type QuoteSnapshot, type ServiceCategory, type TripDirection, formatMajor, instantToLocal, isPickupPlaceType, quoteSnapshotValid } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { withPlatformTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import { findQuoteCity, findQuotePlace } from "../repos/quotes.ts";
import { type InputIssue, validationFailed } from "../validation.ts";
import { type PlatformQuotePreview, type QuoteLog, markupKey, previewPlatformQuote } from "./quotes.ts";
import type { SalesPrincipal } from "./sales-auth.ts";

/** 起点 / 终点：坐标，或主数据里的地点（机场、车站、POI）编号——给了地点就用地点的坐标。 */
export type SalesPoint = { placeId: string } | LatLng;

export interface SalesQuoteInput {
  cityId: string;
  category: ServiceCategory;
  placeId: string | null;
  direction: TripDirection | null;
  pickup: SalesPoint | null;
  dropoff: SalesPoint | null;
  /** 带时区的用车时间（ISO 8601）：按城市的时区换成当地时间 */
  serviceTime: Date;
  packageHours: number | null;
  passengers: number;
  luggage: number;
  addons: { addonId: string; quantity: number }[];
  driverLanguage: string | null;
  vehicleGroupIds: string[];
  currency: string;
}

/** 给渠道看的「为什么没有这个车型组的价」：只有面向客人的几种。 */
export const SALES_UNAVAILABLE_REASONS = ["NO_PRODUCT", "OUT_OF_SERVICE_AREA", "LEAD_TIME_TOO_SHORT", "SOLD_OUT", "OUTSIDE_SERVICE_TIME", "SERVICE_TIME_PASSED", "CAPACITY_EXCEEDED", "ADDON_NOT_OFFERED", "DRIVER_LANGUAGE_NOT_OFFERED", "NOT_AVAILABLE"] as const;
export type SalesUnavailableReason = (typeof SALES_UNAVAILABLE_REASONS)[number];

function salesReason(reason: ComparisonRefusal): SalesUnavailableReason {
  switch (reason) {
    case "OUT_OF_SERVICE_AREA":
    case "IN_FORBIDDEN_AREA":
      return "OUT_OF_SERVICE_AREA";
    case "LEAD_TIME_TOO_SHORT":
      return "LEAD_TIME_TOO_SHORT";
    case "SOLD_OUT":
    case "URGENT_SOLD_OUT":
      return "SOLD_OUT";
    case "OUTSIDE_SERVICE_TIME":
    case "OUTSIDE_SALE_PERIOD":
      return "OUTSIDE_SERVICE_TIME";
    case "SERVICE_TIME_PASSED":
    case "CAPACITY_EXCEEDED":
    case "ADDON_NOT_OFFERED":
    case "DRIVER_LANGUAGE_NOT_OFFERED":
      return reason;
    default:
      // 供应商内部的原因（暂停、子品牌停用、缺价格、汇率……）不告诉渠道
      return "NOT_AVAILABLE";
  }
}

/** 存进 quotes.snapshot 的完整快照：domain 的快照 + quote_id + 渠道 + 加价规则的出处。 */
export interface StoredQuoteSnapshot extends QuoteSnapshot {
  quoteId: string;
  channel: { id: string; bandBp: number; markupFloorBp: number; minMarginMinor: number; settleCurrency: CurrencyCode; roundingUnit: number };
  markup: MarkupMatch;
  /** 用车日期（城市当地）、是不是走了加急 */
  serviceDate: string;
  urgent: boolean;
}

export interface SalesQuote {
  quoteId: string;
  createdAt: string;
  expiresAt: string;
  vehicleGroupId: string;
  packageHours: number | null;
  serviceDate: string;
  currency: CurrencyCode;
  sellMinor: number;
  fx: { rate: string; asOf: string } | null;
  freeWaitMinutes: number | null;
  urgent: boolean;
}

export interface SalesQuoteResult {
  quotes: SalesQuote[];
  unavailable: { vehicleGroupId: string | null; reasons: SalesUnavailableReason[] }[];
}

const ID_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** `QT` + 日期（UTC）+ 10 位随机的数字和大写字母，如 `QT20261006A8F3K2X9Q1`。 */
export function newQuoteId(now: Date): string {
  const date = now.toISOString().slice(0, 10).replaceAll("-", "");
  let random = "";
  for (let i = 0; i < 10; i += 1) random += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  return `QT${date}${random}`;
}

function toSalesQuote(snapshot: StoredQuoteSnapshot): SalesQuote {
  const { winner } = snapshot;
  const freeWait = winner.offer.settlement.freeWait.value;
  return {
    quoteId: snapshot.quoteId,
    createdAt: snapshot.createdAt,
    expiresAt: snapshot.expiresAt,
    vehicleGroupId: winner.offer.vehicleGroupId,
    packageHours: winner.offer.packageHours,
    serviceDate: snapshot.serviceDate,
    currency: snapshot.currency,
    sellMinor: winner.sell.sellMinor,
    fx: winner.sell.fx === null ? null : { rate: winner.sell.fx.rate, asOf: winner.sell.fx.asOf },
    freeWaitMinutes: freeWait === null ? null : freeWait.mode === "limited" ? freeWait.minutes : null,
    urgent: snapshot.urgent,
  };
}

/** 起点 / 终点里的地点编号换成坐标；地点要存在、启用、在这个城市。 */
async function resolvePoints(ctx: AppContext, input: SalesQuoteInput): Promise<{ timezone: string; pickup: LatLng | null; dropoff: LatLng | null }> {
  return withPlatformTx(
    ctx.pool,
    async (db) => {
      const city = await findQuoteCity(db, input.cityId);
      if (!city) throw validationFailed("body", [{ path: "/city_id", reason: "UNKNOWN_CITY", message: "城市不存在" }]);
      const issues: InputIssue[] = [];
      const resolve = async (point: SalesPoint | null, path: string): Promise<LatLng | null> => {
        if (point === null || !("placeId" in point)) return point;
        const place = await findQuotePlace(db, point.placeId);
        if (!place || place.cityId !== city.id || !place.active) {
          issues.push({ path, reason: "UNKNOWN_PLACE", message: "地点不存在、已停用，或者不在这个城市" });
          return null;
        }
        if (input.category === "airport_transfer" && isPickupPlaceType(place.type as never) && place.id === input.placeId) {
          issues.push({ path, reason: "NOT_APPLICABLE", message: "接送机的机场 / 车站那一端用 place_id，这里填另一端" });
        }
        return place.location;
      };
      const pickup = await resolve(input.pickup, "/pickup/place_id");
      const dropoff = await resolve(input.dropoff, "/dropoff/place_id");
      if (issues.length > 0) throw validationFailed("body", issues);
      return { timezone: city.timezone, pickup, dropoff };
    },
    { snapshot: true },
  );
}

/** 询价：比价、生成 quote_id、存快照和询价日志。 */
export async function createSalesQuotes(ctx: AppContext, principal: SalesPrincipal, input: SalesQuoteInput, options: { log?: QuoteLog; request: Record<string, unknown> }): Promise<SalesQuoteResult> {
  const started = performance.now();
  const points = await resolvePoints(ctx, input);
  const serviceLocal = instantToLocal(input.serviceTime, points.timezone).dateTime;
  const preview = await previewPlatformQuote(
    ctx,
    {
      cityId: input.cityId,
      category: input.category,
      placeId: input.placeId,
      currency: input.currency,
      channelId: principal.channelId,
      pickup: points.pickup,
      dropoff: points.dropoff,
      direction: input.direction,
      packageHours: input.packageHours,
      serviceLocal,
      passengers: input.passengers,
      luggage: input.luggage,
      addons: input.addons,
      driverLanguage: input.driverLanguage,
      vehicleGroupIds: input.vehicleGroupIds,
      assumeRoute: null,
    },
    { fresh: false, ...(options.log === undefined ? {} : { log: options.log }) },
  );
  const now = ctx.now();
  const snapshots = storedSnapshots(preview, now);
  const result: SalesQuoteResult = { quotes: snapshots.map(toSalesQuote), unavailable: unavailable(preview, input.vehicleGroupIds) };
  const durationMs = Math.round(performance.now() - started);
  await withPlatformTx(ctx.pool, async (db) => {
    const log = await db.query<{ id: string }>(
      `insert into quote_logs (channel_id, api_client_id, created_at, request, currency, city_id, category, candidate_count, quote_count, bids, rejects, duration_ms)
       values ($1, $2, $3, $4::jsonb, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12) returning id`,
      [
        principal.channelId,
        principal.apiClientId,
        now,
        JSON.stringify(options.request),
        preview.currency,
        input.cityId,
        input.category,
        preview.candidates.length,
        snapshots.length,
        JSON.stringify(snapshots.map((snapshot) => ({ quote_id: snapshot.quoteId, vehicle_group_id: snapshot.winner.offer.vehicleGroupId, package_hours: snapshot.winner.offer.packageHours, winner_tenant_id: snapshot.winner.tenantId, winner_product_id: snapshot.winner.productId, markup: snapshot.markup, candidates: snapshot.candidates }))),
        JSON.stringify([
          ...preview.comparison.refused.map((entry) => ({ tenant_id: entry.tenantId, product_id: entry.productId, vehicle_group_id: entry.vehicleGroupId, reason: entry.reason })),
          ...preview.excluded.map((candidate) => ({ tenant_id: candidate.product.tenantId, product_id: candidate.product.productId, vehicle_group_id: null, reason: "NOT_IN_CHANNEL_SCOPE" })),
        ]),
        durationMs,
      ],
    );
    const logId = (log.rows[0] as { id: string }).id;
    for (const snapshot of snapshots) {
      const { winner } = snapshot;
      await db.query(
        `insert into quotes (id, channel_id, quote_log_id, vehicle_group_id, package_hours, winner_tenant_id, product_id, product_version, currency, sell_minor, settlement_minor, settlement_currency,
                             markup_bp, markup_rule_id, markup_level, snapshot, created_at, expires_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16::jsonb, $17, $18)`,
        [
          snapshot.quoteId, principal.channelId, logId, winner.offer.vehicleGroupId, winner.offer.packageHours, winner.tenantId, winner.productId, winner.productVersion, snapshot.currency,
          winner.sell.sellMinor, winner.offer.settlement.totalMinor, winner.offer.settlement.currency, winner.sell.markupBp, snapshot.markup.ruleId, snapshot.markup.level,
          JSON.stringify(snapshot), snapshot.createdAt, snapshot.expiresAt,
        ],
      );
    }
  });
  return result;
}

function storedSnapshots(preview: PlatformQuotePreview, now: Date): StoredQuoteSnapshot[] {
  const channel = preview.channel;
  if (channel === null) throw new Error("正式询价必须带渠道");
  return preview.comparison.groups.map((group) => {
    const winner = group.snapshot.winner;
    const markup = preview.markups.get(markupKey(winner.productId, winner.offer.vehicleGroupId)) ?? { markupBp: winner.sell.markupBp, level: 5, ruleId: null };
    return {
      ...group.snapshot,
      quoteId: newQuoteId(now),
      channel: { id: channel.id, bandBp: preview.bandBp, markupFloorBp: preview.markupFloorBp, minMarginMinor: channel.pricing.minMarginMinor, settleCurrency: channel.settleCurrency, roundingUnit: channel.pricing.sellRounding[preview.currency] ?? 1 },
      markup,
      serviceDate: group.snapshot.request.serviceLocal.slice(0, 10),
      urgent: winner.offer.settlement.urgentTier !== null,
    };
  });
}

function unavailable(preview: PlatformQuotePreview, requested: readonly string[]): SalesQuoteResult["unavailable"] {
  const quoted = new Set(preview.comparison.groups.map((group) => group.vehicleGroupId));
  const reasonsFor = (vehicleGroupId: string | null): SalesUnavailableReason[] => {
    if (preview.candidates.length === 0) return ["NO_PRODUCT"];
    const reasons = preview.comparison.refused.filter((entry) => entry.vehicleGroupId === null || entry.vehicleGroupId === vehicleGroupId || vehicleGroupId === null).map((entry) => salesReason(entry.reason));
    const distinct = [...new Set(reasons)].sort();
    return distinct.length === 0 ? ["NOT_AVAILABLE"] : distinct;
  };
  if (requested.length === 0) return quoted.size === 0 ? [{ vehicleGroupId: null, reasons: reasonsFor(null) }] : [];
  return [...new Set(requested)].filter((id) => !quoted.has(id)).map((id) => ({ vehicleGroupId: id, reasons: reasonsFor(id) }));
}

export class QuoteExpired extends AppError {
  constructor(expiresAt: string) {
    super(410, "QUOTE_EXPIRED", "报价已过有效期，请重新询价", { expires_at: expiresAt });
  }
}

/** 查一个报价：只查得到本渠道的（别的渠道的和不存在一样 404）；过了有效期 410 `QUOTE_EXPIRED`。 */
export async function getSalesQuote(ctx: AppContext, principal: SalesPrincipal, quoteId: string): Promise<SalesQuote> {
  const row = await withPlatformTx(ctx.pool, async (db) => {
    const result = await db.query<{ snapshot: StoredQuoteSnapshot }>("select snapshot from quotes where id = $1 and channel_id = $2", [quoteId, principal.channelId]);
    return result.rows[0] ?? null;
  });
  if (!row) throw new AppError(404, "NOT_FOUND", "报价不存在");
  if (!quoteSnapshotValid(row.snapshot, ctx.now())) throw new QuoteExpired(row.snapshot.expiresAt);
  return toSalesQuote(row.snapshot);
}

/** 应答里的金额：`{ amount: "119800", currency: "JPY" }`（主单位的十进制字符串，需求「API 通用约定」）。 */
export function salesMoney(minor: number, currency: CurrencyCode): { amount: string; currency: CurrencyCode } {
  return { amount: formatMajor(minor, currency), currency };
}
