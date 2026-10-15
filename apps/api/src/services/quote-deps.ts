/**
 * 报价引擎要用、但属于别的任务的四样东西，各留一个接口（ADR 0020）。本任务只提供「还没有」时的默认实现：
 * - 路线预估（M2-02，谷歌地图 Routes API）：取不到 → 里程 + 时长的价格报不出，一口价和包车套餐不受影响；
 * - 汇率（M2-03，汇率中心）：没有 → 只有结算币种和客人支付币种相同的能报；
 * - 加价规则和渠道参数（M2-04）：用配置里的默认加价比例、需求文档的默认下限和价格带；
 * - 评分和观察期（M4-01）：每个租户都按默认分、0 单、不在观察期。
 */
import { type CurrencyCode, DEFAULT_TENANT_STANDING, type FxQuote, type LatLng, QUOTE_RULES, type RouteEstimate, type ServiceCategory, type TenantStanding } from "@nozomi/domain";
import type { AppConfig } from "@nozomi/config";
import type { Db } from "../db/context.ts";
import type { QuoteCandidate } from "../repos/quotes.ts";
import { QuoteCatalogCache } from "./quote-catalog.ts";

/**
 * 路线预估：两点之间的预估里程（米）和时长（分钟）。取不到（没有配置、服务不可用、超时）返回 null。
 * 实现应当自己处理超时和错误；万一抛了异常或超过 `externalTimeoutMs`，报价这一层也按取不到处理。
 */
export interface RouteEstimator {
  estimate(input: { from: LatLng; to: LatLng; departAt: Date }): Promise<RouteEstimate | null>;
}

/**
 * 中央汇率：1 个 `from` 的主单位等于多少 `to` 的主单位（不含缓冲）。没有返回 null。超过 48 小时没更新的不该给；给了引擎也不用（domain 的 `fxQuoteUsable`）。
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

export function defaultQuoteDeps(config: AppConfig, now: () => Date = () => new Date()): QuoteDeps {
  return {
    catalog: new QuoteCatalogCache({ now: () => now().getTime() }),
    externalTimeoutMs: QUOTE_EXTERNAL_TIMEOUT_MS,
    routes: { estimate: async () => null },
    fx: { quote: async () => null },
    markup: { floorBp: QUOTE_RULES.defaultMarkupFloorBp, bandBp: QUOTE_RULES.defaultBandBp, markupBp: () => config.quote.defaultMarkupBp },
    standings: { load: async (_db, tenantIds) => new Map(tenantIds.map((tenantId) => [tenantId, DEFAULT_TENANT_STANDING])) },
  };
}
