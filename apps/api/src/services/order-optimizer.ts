/**
 * 包车经停顺序建议的谷歌优化调用（M9P-20 P2，ADR 0096 第三节第 2、3 小节）。
 *
 * 一次优化 = 每段（≥ 2 个可动经停）算一个顺序无关的缓存键 → 库里 24 小时内有就直接用（拖动、上移下移、改停留都不再调谷歌）
 * → 没有的段要问谷歌：现在生效的密钥 → 冷却中直接放弃 → **一次占齐所有段的名额**（`GOOGLE_ROUTES_OPTIMIZE_DAILY_LIMIT`，不够整次不调，不出半截建议）
 * → 每段一次 computeRoutes + optimizeWaypointOrder（Pro 档）；重试再各占一个名额 → 成功的存「按建议顺序排好的取整坐标」，没有路线的存 1 天。
 * 同一个键并发只调一次。永远不抛异常；日志只记原因代码。
 */
import { createHash } from "node:crypto";
import { type LatLng, ORDER_SUGGESTION_RULES, type RouteFailureCode, type SuggestionSegment, orderSuggestionCacheKey, orderedPoints, routeFailureCooldownMs, routeUsageDay } from "@nozomi/domain";
import { withPlatformTx } from "../db/context.ts";
import type { Pool } from "../db/pool.ts";
import type { ComputedOptimizedOrder } from "../integrations/google-route-optimize.ts";
import { type CachedOrder, findCachedOrder, recordOptimizeOutcome, recordOptimizeRefused, reserveOptimizeCalls, saveCachedOrder } from "../repos/order-suggestions.ts";
import { ROUTE_DB_TIMEOUT_MS } from "./route-estimates.ts";

/** 每段的建议顺序（取整后的坐标，按建议顺序）；`source` 只要有一段问了谷歌就是 google。 */
export type OptimizeOutcome = { ok: true; orders: LatLng[][]; source: "cache" | "google" } | { ok: false; reason: "NO_ROUTE" | "UNAVAILABLE" | "RATE_LIMITED"; code: RouteFailureCode | "RATE_LIMITED" };

export interface OptimizeOptions {
  /** 真要调谷歌之前问一次（按会话、按地址只数要调谷歌的请求的限频）：false 就不调，结果 `RATE_LIMITED`；缓存全命中时不问 */
  beforeGoogle?: () => Promise<boolean>;
}

export interface OrderOptimizer {
  optimize(segments: readonly SuggestionSegment[], options?: OptimizeOptions): Promise<OptimizeOutcome>;
}

export const NO_ORDER_OPTIMIZER: OrderOptimizer = { optimize: async () => ({ ok: false, reason: "UNAVAILABLE", code: "NOT_CONFIGURED" }) };

export interface GoogleOrderOptimizerDeps {
  pool: Pool;
  now: () => Date;
  apiKey: () => string | null;
  /** 每天最多几次优化调用（`GOOGLE_ROUTES_OPTIMIZE_DAILY_LIMIT`） */
  dailyLimit: number;
  compute: (apiKey: string, from: LatLng, to: LatLng, movable: readonly LatLng[], beforeAttempt: () => Promise<boolean>) => Promise<ComputedOptimizedOrder>;
  log: { warn(obj: object, msg: string): void };
  /** 事务时限（毫秒）；生产不传，只给数调用次数的集成测试放宽（同 M8-29） */
  dbTimeoutMs?: number;
}

function fingerprint(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

const cacheable = (code: RouteFailureCode): code is "NO_ROUTE" | "INVALID_POINTS" => code === "NO_ROUTE" || code === "INVALID_POINTS";

export class GoogleOrderOptimizer implements OrderOptimizer {
  readonly #deps: GoogleOrderOptimizerDeps;
  readonly #inflight = new Map<string, Promise<OptimizeOutcome>>();
  #cooldown: { key: string; code: RouteFailureCode; until: number; day: string } | null = null;

  constructor(deps: GoogleOrderOptimizerDeps) {
    this.#deps = deps;
  }

  optimize(segments: readonly SuggestionSegment[], options: OptimizeOptions = {}): Promise<OptimizeOutcome> {
    const key = segments.map(orderSuggestionCacheKey).join("&");
    const running = this.#inflight.get(key);
    if (running !== undefined) return running;
    const lookup = this.#optimize(segments, options).finally(() => this.#inflight.delete(key));
    this.#inflight.set(key, lookup);
    return lookup;
  }

  async #optimize(segments: readonly SuggestionSegment[], options: OptimizeOptions): Promise<OptimizeOutcome> {
    const { pool, log } = this.#deps;
    const db = { queryTimeoutMs: this.#deps.dbTimeoutMs ?? ROUTE_DB_TIMEOUT_MS };
    const keys = segments.map(orderSuggestionCacheKey);
    const found: (CachedOrder | null)[] = await withPlatformTx(pool, async (tx) => Promise.all(keys.map((key) => findCachedOrder(tx, key, this.#deps.now()))), db).catch((err: unknown) => {
      log.warn({ err }, "读建议顺序的缓存失败，直接问谷歌");
      return keys.map(() => null);
    });
    const failedCached = found.find((entry) => entry !== null && !entry.ok);
    if (failedCached !== undefined && failedCached !== null && !failedCached.ok) return { ok: false, reason: "NO_ROUTE", code: failedCached.code };
    const missing = segments.flatMap((segment, index) => (found[index] === null ? [index] : []));
    const orders: LatLng[][] = found.map((entry) => (entry !== null && entry.ok ? entry.points : []));
    if (missing.length === 0) return { ok: true, orders, source: "cache" };

    const apiKey = this.#deps.apiKey();
    if (apiKey === null) return { ok: false, reason: "UNAVAILABLE", code: "NOT_CONFIGURED" };
    const keyId = fingerprint(apiKey);
    const day = routeUsageDay(this.#deps.now());
    const cooling = this.#cooldown;
    if (cooling !== null && cooling.key === keyId && cooling.day === day && performance.now() < cooling.until) {
      if (cooling.code === "DAILY_LIMIT_REACHED") await withPlatformTx(pool, (tx) => recordOptimizeRefused(tx, day), db).catch(() => undefined);
      return { ok: false, reason: "UNAVAILABLE", code: cooling.code };
    }
    if (options.beforeGoogle !== undefined && !(await options.beforeGoogle().catch(() => false))) return { ok: false, reason: "RATE_LIMITED", code: "RATE_LIMITED" };
    // 一次占齐：几段要问谷歌就占几个名额，不够整次不调
    let reserved: boolean;
    try {
      reserved = await withPlatformTx(pool, (tx) => reserveOptimizeCalls(tx, day, missing.length, this.#deps.dailyLimit), db);
    } catch (err) {
      log.warn({ err }, "占用优化调用的每日名额失败，这次不调用谷歌");
      return { ok: false, reason: "UNAVAILABLE", code: "UNAVAILABLE" };
    }
    if (!reserved) {
      this.#cooldown = { key: keyId, code: "DAILY_LIMIT_REACHED", until: performance.now() + routeFailureCooldownMs("DAILY_LIMIT_REACHED"), day };
      return { ok: false, reason: "UNAVAILABLE", code: "DAILY_LIMIT_REACHED" };
    }
    const results = await Promise.all(
      missing.map(async (index) => {
        const segment = segments[index] as SuggestionSegment;
        let first = true;
        const beforeAttempt = async (): Promise<boolean> => {
          if (first) {
            first = false;
            return true;
          }
          return withPlatformTx(pool, (tx) => reserveOptimizeCalls(tx, day, 1, this.#deps.dailyLimit), db).catch(() => false);
        };
        const computed = await this.#deps.compute(apiKey, segment.from, segment.to, segment.movable.map((stop) => ({ lat: stop.lat, lng: stop.lng })), beforeAttempt);
        return { index, computed };
      }),
    );
    const at = this.#deps.now();
    let failure: { code: RouteFailureCode } | null = null;
    await withPlatformTx(
      pool,
      async (tx) => {
        for (const { index, computed } of results) {
          const key = keys[index] as string;
          const segment = segments[index] as SuggestionSegment;
          if (computed.ok) {
            const points = orderedPoints(segment, computed.order);
            if (points === null) {
              failure ??= { code: "UNEXPECTED" };
              continue;
            }
            orders[index] = points;
            await recordOptimizeOutcome(tx, day, { ok: true }, at);
            await saveCachedOrder(tx, key, { ok: true, points }, at, new Date(at.getTime() + ORDER_SUGGESTION_RULES.cacheTtlMs));
          } else {
            failure ??= { code: computed.code };
            if (computed.code !== "DAILY_LIMIT_REACHED") await recordOptimizeOutcome(tx, day, { ok: false, code: computed.code }, at);
            if (cacheable(computed.code)) await saveCachedOrder(tx, key, { ok: false, code: computed.code }, at, new Date(at.getTime() + ORDER_SUGGESTION_RULES.negativeTtlMs));
          }
        }
      },
      db,
    ).catch((err: unknown) => log.warn({ err }, "写建议顺序的缓存或调用计数失败（这次的结果照常使用）"));
    if (failure !== null) {
      const code = (failure as { code: RouteFailureCode }).code;
      const cooldownMs = routeFailureCooldownMs(code);
      if (cooldownMs > 0) this.#cooldown = { key: keyId, code, until: performance.now() + cooldownMs, day };
      log.warn({ optimizeFailure: code }, "经停顺序建议取不到（谷歌优化），这次不提示建议");
      return { ok: false, reason: cacheable(code) ? "NO_ROUTE" : "UNAVAILABLE", code };
    }
    if (this.#cooldown?.key === keyId) this.#cooldown = null;
    return { ok: true, orders, source: "google" };
  }
}
