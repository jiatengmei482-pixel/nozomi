/**
 * 报价（M2-01，ADR 0020）：把请求、数据库里的商品和规则、外部依赖（路线、汇率、加价、评分）接到 domain 的报价引擎上。
 *
 * - 平台侧试算（`previewPlatformQuote`）：所有供应商一起比，返回每个车型组的中标和全部候选（结算价、对外价、明细、排序依据），
 *   以及每个没报出价的商品 / 车型组的原因——供运营排查「为什么没报出价」。不生成可以下单的报价，不写库。
 * - 租户侧试算（`previewTenantQuote`）：供应商对自己的一个商品（没上架的也可以）试算，只有结算价和明细。
 *   这条路径上根本不算对外价、不取加价比例，也不读别的供应商的数据（租户事务 + 行级安全）。
 * - 正式的询价接口 `/sales/v1/quotes`（M2-04，services/sales-quotes.ts）走的是这里同一个函数（`previewPlatformQuote` 带渠道、`fresh: false`）。
 *
 * 带渠道时（M2-04，ADR 0023）：城市、品类不在渠道的授权范围里直接拒绝（`CHANNEL_SCOPE_DENIED`）；不卖的租户不参加比价（单独列出）；
 * 加价比例按渠道的五级规则匹配（`resolveMarkup`，用车日期按城市当地），下限、价格带、最低毛利、对外价取整用渠道的。
 * 不带渠道（只有运营后台的试算）：用平台默认的参数（`ctx.quote.markup`：配置的默认加价比例、10% 下限、3% 价格带），没有最低毛利和取整。
 */
import {
  type ComparisonEntry,
  type CurrencyCode,
  type LatLng,
  type HolidayLookup,
  type InventoryDay,
  type ProductQuote,
  type QuoteComparison,
  type QuoteRequest,
  type RouteEstimate,
  type ServiceCategory,
  type TripDirection,
  type ChannelSellRules,
  type MarkupMatch,
  addDays,
  channelScopeRefusal,
  channelSellsTenant,
  compareQuotes,
  resolveMarkup,
  holidayLookup,
  instantToLocal,
  isCurrencyCode,
  isPickupPlaceType,
  localDateTimeToInstant,
  quoteProduct,
  quoteRequestIssues,
  TENANT_RULES,
  tenantDayStart,
} from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type Db, withPlatformTx, withTenantTx } from "../db/context.ts";
import { type Channel, type StoredMarkupRule, findChannel, listMarkupRules } from "../repos/channels.ts";
import { listHolidays } from "../repos/prices.ts";
import { AppError } from "../errors.ts";
import { type QuoteCandidate, type QuoteCandidateFilter, findQuoteCity, findQuotePlace, loadInventoryOnDay, loadQuoteCandidates } from "../repos/quotes.ts";
import { countUrgentOrders } from "../repos/orders.ts";
import { countOrdersSince } from "../repos/tenant-onboarding.ts";
import { type InputIssue, validationFailed } from "../validation.ts";
import { masterDataNotReady, notFound } from "./errors.ts";

/** 试算的请求（两个试算接口共用的部分）。 */
export interface QuotePreviewInput {
  pickup: LatLng | null;
  dropoff: LatLng | null;
  direction: TripDirection | null;
  packageHours: number | null;
  /** 城市当地的用车时间 `YYYY-MM-DDTHH:mm` */
  serviceLocal: string;
  passengers: number;
  luggage: number;
  addons: { addonId: string; quantity: number }[];
  driverLanguage: string | null;
  vehicleGroupIds: string[];
  /** 试算时假定的路线里程和时长：给了就不去估路线（路线服务还没接上、或想看某个里程下的价时用） */
  assumeRoute: RouteEstimate | null;
}

const REQUEST_MESSAGES: Readonly<Record<string, string>> = {
  REQUIRED: "必填",
  NOT_APPLICABLE: "这个品类不填这一项",
  OUT_OF_RANGE: "超出了允许的范围",
  INVALID_SERVICE_TIME: "用车时间要写成当地时间 YYYY-MM-DDTHH:mm，而且是真实存在的日期",
  DUPLICATE: "重复了",
};

function assertRequest(request: QuoteRequest, assumeRoute: RouteEstimate | null): void {
  const issues: InputIssue[] = quoteRequestIssues(request).map((issue) => ({ path: issue.path, reason: issue.reason, message: REQUEST_MESSAGES[issue.reason] ?? issue.reason }));
  if (assumeRoute !== null && (!Number.isInteger(assumeRoute.meters) || !Number.isInteger(assumeRoute.minutes) || assumeRoute.meters < 0 || assumeRoute.minutes < 0 || assumeRoute.meters > 5_000_000 || assumeRoute.minutes > 10_080)) {
    issues.push({ path: "/assume_route", reason: "OUT_OF_RANGE", message: "里程要在 0 到 5000 公里之间（米），时长要在 0 到 7 天之间（分钟），都是整数" });
  }
  if (issues.length > 0) throw validationFailed("body", issues);
}

function toRequest(category: ServiceCategory, input: QuotePreviewInput): QuoteRequest {
  return {
    category,
    pickup: input.pickup,
    dropoff: input.dropoff,
    direction: input.direction,
    packageHours: input.packageHours,
    serviceLocal: input.serviceLocal,
    passengers: input.passengers,
    luggage: input.luggage,
    addons: input.addons,
    driverLanguage: input.driverLanguage,
    vehicleGroupIds: input.vehicleGroupIds,
  };
}

/**
 * 报价时外部调用（路线预估、汇率）出了错的日志。只记依赖名和异常：异常经 Fastify 的 `err` 序列化器脱敏（logging.ts），
 * 不会把密钥、连接串写进日志。路由传 `request.log`；不传就不记。
 */
export interface QuoteLog {
  warn(entry: { err: unknown; dependency: QuoteDependency }, message: string): void;
}
type QuoteDependency = "route" | "fx";
const SILENT: QuoteLog = { warn: () => undefined };

/** 外部调用超过了 `QuoteDeps.externalTimeoutMs` 还没有结果。 */
export class QuoteDependencyTimeout extends Error {
  readonly code = "QUOTE_DEPENDENCY_TIMEOUT";
  constructor(message: string) {
    super(message);
    this.name = "QuoteDependencyTimeout";
  }
}

/**
 * 调一次外部服务（路线预估、汇率）：限时（`ctx.quote.externalTimeoutMs`），超时或抛异常都记一条日志、当作「取不到」（null）——
 * 一个外部服务出问题只让用得到它的商品报不出（`ROUTE_UNAVAILABLE` / `FX_RATE_UNAVAILABLE`），不让整次比价失败。
 */
async function callExternal<T>(ctx: AppContext, log: QuoteLog, dependency: QuoteDependency, run: () => Promise<T | null>): Promise<T | null> {
  const timeoutMs = ctx.quote.externalTimeoutMs;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new QuoteDependencyTimeout(`${dependency === "route" ? "路线预估" : "汇率"}超过 ${timeoutMs} 毫秒没有结果`)), timeoutMs);
    });
    return await Promise.race([run(), timeout]);
  } catch (err) {
    log.warn({ err, dependency }, dependency === "route" ? "路线预估取不到，用得到它的商品报 ROUTE_UNAVAILABLE" : "汇率取不到，跨币种的报价报 FX_RATE_UNAVAILABLE");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 这次用车的路线预估（报价引擎第 6 步）：只有里程 + 时长的价格、按小时的夜间费、按时长的附加服务用得到。
 * 接送机：机场 / 车站那一端用接送点的坐标。包车不估（按套餐时长）。两端的坐标不全、或路线服务取不到（含超时、出错），返回 null。
 * 在数据库事务之外调用：不占着连接等外部服务。
 */
async function estimateRoute(ctx: AppContext, log: QuoteLog, request: QuoteRequest, placeLocation: LatLng | null, departAt: Date, assumeRoute: RouteEstimate | null): Promise<RouteEstimate | null> {
  if (assumeRoute !== null) return assumeRoute;
  if (request.category === "charter") return null;
  const from = request.category === "airport_transfer" && request.direction === "pickup" ? placeLocation : request.pickup;
  const to = request.category === "airport_transfer" && request.direction === "dropoff" ? placeLocation : request.dropoff;
  if (from === null || to === null) return null;
  return callExternal(ctx, log, "route", () => ctx.quote.routes.estimate({ from, to, departAt }));
}

/** 这批商品有没有哪个用得到路线预估（用不到就不去调路线服务）。 */
function needsRoute(candidates: readonly QuoteCandidate[]): boolean {
  return candidates.some(({ product }) => {
    const rules = product.serviceRules;
    return product.priceRules.some((rule) => rule.pricing.model === "mileage_time") || (rules.night.enabled && rules.night.chargeUnit === "per_hour") || product.addonCatalog.some((addon) => addon.chargeUnit === "per_duration");
  });
}

interface Quoted {
  candidate: QuoteCandidate;
  quote: ProductQuote;
}

/** 报价要从库里现查的事实（不进目录缓存）：用车那一天的库存、已经用掉的加急库存（按商品）、节假日。 */
interface QuoteFacts {
  inventory: Map<string, InventoryDay>;
  urgentUsed: Map<string, number>;
  holidays: HolidayLookup;
  /** 今天已经接满每日订单上限的试运营供应商（ADR 0028） */
  trialCapped: Set<string>;
}

/** 给一批候选商品取库存、加急库存的已用量、节假日（各一次查询）。在事务里调用。 */
async function loadQuoteFacts(db: Db, candidates: readonly QuoteCandidate[], request: QuoteRequest, now: Date): Promise<QuoteFacts> {
  // 用车那一天（各商品所在城市的当地日期；同一批商品同城，时区一样）
  const dated = candidates.flatMap((candidate) => {
    const instant = localDateTimeToInstant(request.serviceLocal, candidate.product.timeZone);
    return instant === null ? [] : [{ candidate, date: instantToLocal(instant, candidate.product.timeZone).date }];
  });
  const inventory = await loadInventoryOnDay(db, dated.filter(({ candidate }) => candidate.product.inventoryMode === "limited").map(({ candidate, date }) => ({ tenantId: candidate.product.tenantId, productId: candidate.product.productId, date })));
  // 每日加急库存（M3-01）：这一天走加急、没取消的单数。只数设了每日加急库存的商品
  const quota = dated.filter(({ candidate }) => candidate.product.serviceRules.urgent.enabled && candidate.product.serviceRules.urgent.dailyQuota !== null);
  const counted = await countUrgentOrders(db, quota.map(({ candidate, date }) => ({ tenantId: candidate.product.tenantId, productId: candidate.product.productId, date })));
  const urgentUsed = new Map(quota.map(({ candidate, date }) => [candidate.product.productId, counted.get(`${candidate.product.productId}|${date}`) ?? 0]));
  // 节假日：调价规则里提到的国家；跨午夜的时段算在开始那天头上，所以多取前一天
  const countries = [...new Set(candidates.flatMap(({ product }) => product.adjustRules.flatMap((rule) => (rule.cycle.type === "holidays" ? rule.cycle.countries : []))))];
  const dates = dated.map((entry) => entry.date).sort();
  const first = dates[0];
  const holidays = countries.length === 0 || first === undefined ? [] : await listHolidays(db, { countryCodes: countries, from: addDays(first, -1), to: dates[dates.length - 1] as string }, 5_000);
  // 试运营的每日订单上限（「准入过滤：试运营当日未达 10 单上限」）：今天（东京时间 0 点起）接的、没取消的单
  const trial = [...new Set(candidates.filter((candidate) => candidate.tenantStatus === "trial").map((candidate) => candidate.product.tenantId))];
  const todayOrders = await countOrdersSince(db, trial, tenantDayStart(now));
  const trialCapped = new Set(trial.filter((tenantId) => (todayOrders.get(tenantId) ?? 0) >= TENANT_RULES.trialDailyOrderLimit));
  return { inventory, urgentUsed, holidays: holidayLookup(holidays), trialCapped };
}

/** 给一批候选商品各报一次价（纯计算）。 */
function quoteCandidates(candidates: readonly QuoteCandidate[], facts: QuoteFacts, request: QuoteRequest, now: Date, route: RouteEstimate | null, forOwner: boolean): Quoted[] {
  return candidates.map((candidate) => ({
    candidate,
    quote: quoteProduct(candidate.product, request, { now, holidays: facts.holidays, route, inventoryDay: facts.inventory.get(candidate.product.productId) ?? null, urgentUsed: facts.urgentUsed.get(candidate.product.productId) ?? 0, trialLimitReached: facts.trialCapped.has(candidate.product.tenantId) }, { forOwner }),
  }));
}

// ---- 平台侧试算 ----

export interface PlatformQuoteInput extends QuotePreviewInput {
  cityId: string;
  category: ServiceCategory;
  /** 接送机：机场或车站 */
  placeId: string | null;
  /** 客人支付的币种 */
  currency: string;
  /** 按哪个渠道的规则报价；null = 平台默认参数（只有运营后台的试算） */
  channelId: string | null;
}

/** 城市或品类不在渠道的授权范围里。 */
export function channelScopeDenied(reason: string): AppError {
  return new AppError(422, "CHANNEL_SCOPE_DENIED", reason === "CITY_NOT_AUTHORIZED" ? "这个渠道没有被授权卖这个城市" : "这个渠道没有被授权卖这个品类", { reason });
}

export interface PlatformQuotePreview {
  currency: CurrencyCode;
  bandBp: number;
  markupFloorBp: number;
  /** 这次试算用到的路线预估；没用到、或取不到为 null */
  route: RouteEstimate | null;
  /** 找到了几个候选商品（已上架、同城市同品类同接送点；带渠道时只算渠道卖的租户） */
  candidates: QuoteCandidate[];
  comparison: QuoteComparison;
  /** 按渠道报价时的渠道；平台默认参数时为 null */
  channel: Channel | null;
  /** 渠道不卖这些租户：它们的商品没参加比价 */
  excluded: QuoteCandidate[];
  /** 每个报出价的「商品 | 车型组」用的是哪条加价规则（第几级） */
  markups: Map<string, MarkupMatch>;
}

export const markupKey = (productId: string, vehicleGroupId: string): string => `${productId}|${vehicleGroupId}`;

/**
 * 平台侧试算：所有供应商一起比。
 * `fresh`（默认）：不用缓存里的旧目录，现取现算——试算要看的是现在的规则。正式的询价（M2-04）走同一个函数、`fresh: false`：
 * 候选商品和规则用 30 秒内的缓存，库存、节假日、评分仍然现查。
 */
export async function previewPlatformQuote(ctx: AppContext, input: PlatformQuoteInput, options: { fresh?: boolean; log?: QuoteLog } = {}): Promise<PlatformQuotePreview> {
  const now = ctx.now();
  const log = options.log ?? SILENT;
  const request = toRequest(input.category, input);
  const issues: InputIssue[] = [];
  if (!isCurrencyCode(input.currency)) issues.push({ path: "/currency", reason: "UNSUPPORTED_CURRENCY", message: "不支持这个币种" });
  if ((input.category === "airport_transfer") !== (input.placeId !== null)) {
    issues.push({ path: "/place_id", reason: input.category === "airport_transfer" ? "REQUIRED" : "NOT_APPLICABLE", message: input.category === "airport_transfer" ? "接送机要给机场或车站" : REQUEST_MESSAGES["NOT_APPLICABLE"] as string });
  }
  if (issues.length > 0) throw validationFailed("body", issues);
  assertRequest(request, input.assumeRoute);
  const currency = input.currency as CurrencyCode;

  // 先在一个只读事务里把库里的东西一次取齐；路线预估、汇率这些外部调用放在事务之外，不占着连接等
  const loaded = await withPlatformTx(
    ctx.pool,
    async (db) => {
      const city = await findQuoteCity(db, input.cityId);
      if (!city) throw validationFailed("body", [{ path: "/city_id", reason: "UNKNOWN_CITY", message: "城市不存在" }]);
      const place = input.placeId === null ? null : await findQuotePlace(db, input.placeId);
      if (input.placeId !== null && (!place || !isPickupPlaceType(place.type as never) || place.cityId !== city.id)) {
        throw validationFailed("body", [{ path: "/place_id", reason: "UNKNOWN_PLACE", message: "接送点不存在、不是机场或车站，或者不在这个城市" }]);
      }
      // 停用的城市、接送点不报价：明说原因，而不是返回 0 个候选让人猜
      if (!city.active) throw masterDataNotReady("CITY_DISABLED", "这个城市已被平台停用，现在不报价");
      if (place !== null && !place.active) throw masterDataNotReady("PLACE_DISABLED", "这个机场或车站已被平台停用，现在不报价");
      const filter: QuoteCandidateFilter = { cityId: city.id, category: input.category, poiId: input.placeId, publishedOnly: true };
      let channel: { channel: Channel; rules: StoredMarkupRule[] } | null = null;
      if (input.channelId !== null) {
        const found = await findChannel(db, input.channelId);
        if (!found) throw validationFailed("body", [{ path: "/channel_id", reason: "UNKNOWN_CHANNEL", message: "渠道不存在" }]);
        const refusal = channelScopeRefusal(found.scope, city.id, input.category);
        if (refusal !== null) throw channelScopeDenied(refusal);
        channel = { channel: found, rules: await listMarkupRules(db, found.id) };
      }
      const all = await ctx.quote.catalog.get(`${city.id}|${input.category}|${input.placeId ?? ""}`, () => loadQuoteCandidates(db, filter), { fresh: options.fresh !== false });
      const sold = (candidate: QuoteCandidate): boolean => channel === null || channelSellsTenant(channel.channel.scope, candidate.product.tenantId);
      const candidates = all.filter(sold);
      const facts = await loadQuoteFacts(db, candidates, request, now);
      const standings = await ctx.quote.standings.load(db, [...new Set(candidates.map((candidate) => candidate.product.tenantId))]);
      return { city, place, candidates, excluded: all.filter((candidate) => !sold(candidate)), facts, standings, channel };
    },
    { snapshot: true },
  );
  const { city, place, candidates, excluded, facts, standings, channel } = loaded;
  const pricing = channel?.channel.pricing ?? null;
  const bandBp = pricing?.bandBp ?? ctx.quote.markup.bandBp;
  const markupFloorBp = pricing?.markupFloorBp ?? ctx.quote.markup.floorBp;
  // 最低毛利是渠道结算币种的金额：客人付别的币种时要汇率
  const marginCurrency = channel !== null && pricing !== null && pricing.minMarginMinor > 0 && channel.channel.settleCurrency !== currency ? channel.channel.settleCurrency : null;

  const departAt = localDateTimeToInstant(request.serviceLocal, city.timezone) as Date;
  const currencies = [...new Set([...candidates.map((candidate) => candidate.product.currency), ...(marginCurrency === null ? [] : [marginCurrency])].filter((from) => from !== currency))];
  const [route, fxQuotes] = await Promise.all([
    input.assumeRoute !== null || needsRoute(candidates) ? estimateRoute(ctx, log, request, place?.location ?? null, departAt, input.assumeRoute) : Promise.resolve(null),
    Promise.all(currencies.map(async (from) => [from, await callExternal(ctx, log, "fx", () => ctx.quote.fx.quote(from, currency, now))] as const)),
  ]);
  const rates = new Map(fxQuotes);
  const quoted = quoteCandidates(candidates, facts, request, now, route, false);
  const markups = new Map<string, MarkupMatch>();
  const entries = quoted.map(({ candidate, quote }): ComparisonEntry => ({
    quote,
    productVersion: candidate.version,
    standing: standings.get(candidate.product.tenantId) ?? { scoreCenti: null, completedOrders: 0, observation: false },
    markupBp: (vehicleGroupId) => {
      const query = { tenantId: candidate.product.tenantId, cityId: candidate.cityId, category: input.category, vehicleGroupId };
      if (channel === null) return ctx.quote.markup.markupBp(query);
      // 只有报出了价的商品才会问加价比例；用车日期是城市当地的日期
      const match = resolveMarkup({ defaultMarkupBp: channel.channel.pricing.defaultMarkupBp, rules: channel.rules }, { ...query, serviceDate: quote.ok ? quote.serviceDate : request.serviceLocal.slice(0, 10) });
      markups.set(markupKey(candidate.product.productId, vehicleGroupId), match);
      return match.markupBp;
    },
    fx: rates.get(candidate.product.currency) ?? null,
  }));
  const sellRules: ChannelSellRules | undefined =
    channel === null
      ? undefined
      : {
          roundingUnit: channel.channel.pricing.sellRounding[currency] ?? 1,
          minMargin: channel.channel.pricing.minMarginMinor === 0 ? null : { minor: channel.channel.pricing.minMarginMinor, currency: channel.channel.settleCurrency, fx: marginCurrency === null ? null : (rates.get(marginCurrency) ?? null) },
        };
  const comparison = compareQuotes({ request, currency, entries, now, bandBp, markupFloorBp, fxBufferBp: ctx.config.fx.bufferBp, ...(sellRules === undefined ? {} : { channel: sellRules }) });
  return { currency, bandBp, markupFloorBp, route, candidates, comparison, channel: channel?.channel ?? null, excluded, markups };
}

// ---- 租户侧试算 ----

export interface TenantQuotePreview {
  candidate: QuoteCandidate;
  quote: ProductQuote;
  route: RouteEstimate | null;
}

/** 租户侧试算：供应商自己的一个商品（任何状态）。只算结算价。别的供应商的商品当作不存在（404）。 */
export async function previewTenantQuote(ctx: AppContext, tenantId: string, productId: string, input: QuotePreviewInput, options: { log?: QuoteLog } = {}): Promise<TenantQuotePreview> {
  const now = ctx.now();
  // 库里的东西在租户事务里取齐；路线预估在事务之外
  const { request, candidates, facts } = await withTenantTx(
    ctx.pool,
    tenantId,
    async (db) => {
      const found = await db.query<{ city_id: string; category: ServiceCategory; poi_id: string | null }>("select city_id, category, poi_id from products where tenant_id = $1 and id = $2", [tenantId, productId]);
      const row = found.rows[0];
      if (!row) throw notFound("商品");
      const request = toRequest(row.category, input);
      assertRequest(request, input.assumeRoute);
      const candidates = await loadQuoteCandidates(db, { cityId: row.city_id, category: row.category, poiId: row.poi_id, productId, publishedOnly: false });
      // 城市或接送点被平台停用了：这个商品现在报不了价
      if (candidates.length === 0) throw masterDataNotReady("CITY_OR_PLACE_DISABLED", "这个商品所在的城市或它的接送点已被平台停用，现在报不了价");
      return { request, candidates, facts: await loadQuoteFacts(db, candidates, request, now) };
    },
    { snapshot: true },
  );
  const candidate = candidates[0] as QuoteCandidate;
  const departAt = localDateTimeToInstant(request.serviceLocal, candidate.product.timeZone) as Date;
  const route = input.assumeRoute !== null || needsRoute(candidates) ? await estimateRoute(ctx, options.log ?? SILENT, request, candidate.pickupPlaceLocation, departAt, input.assumeRoute) : null;
  const [quoted] = quoteCandidates(candidates, facts, request, now, route, true);
  return { candidate, quote: (quoted as Quoted).quote, route };
}
