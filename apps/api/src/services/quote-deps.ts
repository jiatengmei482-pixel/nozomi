/**
 * 报价引擎要用、但属于别的任务的四样东西，各留一个接口（ADR 0020）。本任务只提供「还没有」时的默认实现：
 * - 路线预估（M2-02，谷歌地图 Routes API）：已由 services/route-estimates.ts 的 `GoogleRouteEstimator` 实现（缓存、每日上限、降级，ADR 0042），由 buildApp 传进来；
 *   取不到 → 里程 + 时长的价格报不出（`ROUTE_UNAVAILABLE` + 原因代码），一口价和包车套餐不受影响；
 * - 汇率（M2-03）：已由汇率中心实现（services/fx-center.ts 的 `FxCenter.rates`），由 buildApp 传进来；
 * - 加价规则和渠道参数（M2-04）：用配置里的默认加价比例、需求文档的默认下限和价格带；
 * - 评分、完成订单数和观察期（M4-01）：每日检查写在供应商主体上的最新结果（services/tenant-standings.ts，ADR 0028）。
 */
import { type CurrencyCode, type FxQuote, type LatLng, QUOTE_RULES, type RouteLookup, type ServiceCategory, type TenantStanding } from "@nozomi/domain";
import type { AppConfig } from "@nozomi/config";
import type { Db } from "../db/context.ts";
import type { QuoteCandidate } from "../repos/quotes.ts";
import { QuoteCatalogCache } from "./quote-catalog.ts";
import { DB_TENANT_STANDINGS } from "./tenant-standings.ts";

/**
 * 路线预估：两点之间的预估里程（米）和时长（分钟），带来源（缓存 / 谷歌 / 同一个点）；取不到时给原因代码（没有配置、超时、配额、没有路线……）。
 * 实现应当自己处理超时和错误；万一抛了异常或超过 `externalTimeoutMs`，报价这一层按取不到处理（异常是 `UNEXPECTED`，超时是 `TIMEOUT`）。
 * 不考虑实时路况（ADR 0042），所以入参里没有用车时间。
 */
export interface RouteEstimator {
  estimate(input: { from: LatLng; to: LatLng }): Promise<RouteLookup>;
}

/**
 * 中央汇率：1 个 `from` 的主单位等于多少 `to` 的主单位（不含缓冲）。没有返回 null。超过 48 小时没更新的不该给；给了引擎也不用（domain 的 `fxQuoteUsable`）。
 * 实现是汇率中心（`FxCenter.rates`，ADR 0022）：交叉汇率先用精确分数算，再写成 12 位小数的十进制字符串。
 * 抛异常或超过 `externalTimeoutMs` 时，报价这一层按没有汇率处理（`FX_RATE_UNAVAILABLE`）。
 */
export interface FxRates {
  quote(from: CurrencyCode, to: CurrencyCode, at: Date): Promise<FxQuote | null>;
}

/** 这次询价适用的加价规则和渠道参数（M2-04 里按渠道 × 租户 × 城市 × 品类 × 车型组匹配）。 */
export interface MarkupRules {
  /** 加价比例的下限、价格带 δ（都是基点） */
  floorBp: number;
  bandBp: number;
  markupBp(input: { tenantId: string; cityId: string; category: ServiceCategory; vehicleGroupId: string }): number;
}

/** 租户在比价里的身份：评分、已完成订单数、是不是在观察期。 */
export interface TenantStandings {
  load(db: Db, tenantIds: readonly string[]): Promise<Map<string, TenantStanding>>;
}

export interface QuoteDeps {
  routes: RouteEstimator;
  fx: FxRates;
  markup: MarkupRules;
  standings: TenantStandings;
  /** 候选商品和它们的规则的缓存（进程内，30 秒） */
  catalog: QuoteCatalogCache<QuoteCandidate[]>;
  /**
   * 调一次路线预估、汇率最多等多少毫秒（默认 `QUOTE_EXTERNAL_TIMEOUT_MS`）。超时、抛异常都当作「取不到」：
   * 用得到它的商品报 `ROUTE_UNAVAILABLE` / `FX_RATE_UNAVAILABLE`，别的照常（services/quotes.ts 的 `callExternal`）。
   * 各外部服务模块自己也该有更短的超时和重试；这里是报价这一层的兜底，保证询价的总耗时有上限。
   */
  externalTimeoutMs: number;
}

/** 报价时一次外部调用（路线预估、汇率）的默认等待上限：2 秒。需求的单次报价 P95 ≤ 300 ms 是正常情况；这是外部服务卡住时的上限 */
export const QUOTE_EXTERNAL_TIMEOUT_MS = 2_000;

/** 不接路线服务时的路线预估：一律「没有配置」（只给不经 buildApp 的测试上下文用）。 */
export const NO_ROUTES: RouteEstimator = { estimate: async () => ({ ok: false, code: "NOT_CONFIGURED" }) };

export function defaultQuoteDeps(config: AppConfig, fx: FxRates, routes: RouteEstimator, now: () => Date = () => new Date()): QuoteDeps {
  return {
    catalog: new QuoteCatalogCache({ now: () => now().getTime() }),
    externalTimeoutMs: QUOTE_EXTERNAL_TIMEOUT_MS,
    routes,
    fx,
    markup: { floorBp: QUOTE_RULES.defaultMarkupFloorBp, bandBp: QUOTE_RULES.defaultBandBp, markupBp: () => config.quote.defaultMarkupBp },
    standings: DB_TENANT_STANDINGS,
  };
}
