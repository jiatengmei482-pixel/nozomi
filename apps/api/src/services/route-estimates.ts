/**
 * 路线预估（M2-02，ADR 0042）：报价引擎第 6 步「里程 + 时长」要的预估里程和时长，来自谷歌地图 Routes API。
 *
 * 一次预估 = 起终点取整成缓存键（domain 的 `routeCacheKey`）→ 同一个键正在查的直接等那一次（同一组起终点并发只调一次谷歌）
 * → 查库里的缓存（没过期就用）→ 现在生效的谷歌密钥（运营后台填写的优先，ADR 0041；每次现取，换了立即用新的）
 * → 这把密钥在冷却中就直接按上次的原因降级 → 调谷歌（每次真正发请求前占一个今天的调用名额，到了每日上限不发）
 * → 成功的写缓存（7 天），没有路线 / 坐标无效也写（1 天）；失败记进今天的计数和「最近一次失败」，按原因冷却一会儿。
 *
 * 永远不抛异常：结果是路线（带来源），或取不到的原因代码。日志只记原因代码，不记密钥和谷歌返回的原文。
 */
import { createHash } from "node:crypto";
import { type LatLng, type RouteCacheKey, type RouteFailureCode, type RouteLookup, routeCacheExpiry, routeCacheKey, routeCallAllowed, routeFailureCacheable, routeFailureCooldownMs, routeMinutesFromSeconds, routeUsageDay } from "@nozomi/domain";
import { withPlatformTx } from "../db/context.ts";
import type { Pool } from "../db/pool.ts";
import type { ComputedRoute } from "../integrations/google-maps.ts";
import { type CachedRoute, findRouteEstimate, recordRouteOutcome, recordRouteRefused, reserveRouteCall, saveRouteEstimate } from "../repos/route-estimates.ts";
import type { RouteEstimator } from "./quote-deps.ts";

/** 读写缓存和计数的每条查询最多等多久（毫秒）：库慢的时候不拖住询价 */
const ROUTE_DB_TIMEOUT_MS = 500;

export interface RouteEstimatorLog {
  warn(obj: object, msg: string): void;
}

export interface GoogleRouteEstimatorDeps {
  pool: Pool;
  now: () => Date;
  /** 现在生效的谷歌地图密钥；没有配置为 null */
  apiKey: () => string | null;
  /** 每天最多调用几次（配置 `GOOGLE_ROUTES_DAILY_LIMIT`） */
  dailyLimit: number;
  /** 调一次谷歌（`integrations/google-maps.ts` 的 `computeRoute`）；`beforeAttempt` 每次发请求前调用 */
  compute: (apiKey: string, from: LatLng, to: LatLng, beforeAttempt: () => Promise<boolean>) => Promise<ComputedRoute>;
  log: RouteEstimatorLog;
}

const fail = (code: RouteFailureCode): RouteLookup => ({ ok: false, code });

function fromCached(cached: CachedRoute, source: "cache" | "google"): RouteLookup {
  return cached.ok ? { ok: true, route: { meters: cached.meters, minutes: routeMinutesFromSeconds(cached.seconds) }, source } : fail(cached.code);
}

/** 密钥的指纹（只在本进程的内存里，用来按密钥记冷却）：换了密钥，冷却不跟过去。 */
function fingerprint(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

export class GoogleRouteEstimator implements RouteEstimator {
  readonly #deps: GoogleRouteEstimatorDeps;
  /** 正在查的缓存键：同一组起终点同时来几次，只查一次、只调一次谷歌 */
  readonly #inflight = new Map<string, Promise<RouteLookup>>();
  /** 上一次失败带来的冷却：哪把密钥、什么原因、到什么时候（单调时钟） */
  #cooldown: { key: string; code: RouteFailureCode; until: number; day: string } | null = null;

  constructor(deps: GoogleRouteEstimatorDeps) {
    this.#deps = deps;
  }

  estimate(input: { from: LatLng; to: LatLng }): Promise<RouteLookup> {
    const cacheKey = routeCacheKey(input.from, input.to);
    if (cacheKey.samePoint) return Promise.resolve({ ok: true, route: { meters: 0, minutes: 0 }, source: "same_point" });
    const running = this.#inflight.get(cacheKey.key);
    if (running !== undefined) return running;
    const lookup = this.#lookup(cacheKey).finally(() => this.#inflight.delete(cacheKey.key));
    this.#inflight.set(cacheKey.key, lookup);
    return lookup;
  }

  async #lookup(cacheKey: RouteCacheKey): Promise<RouteLookup> {
    const { pool, log } = this.#deps;
    try {
      const cached = await withPlatformTx(pool, (db) => findRouteEstimate(db, cacheKey.key, this.#deps.now()), { queryTimeoutMs: ROUTE_DB_TIMEOUT_MS });
      if (cached !== null) return fromCached(cached, "cache");
    } catch (err) {
      log.warn({ err }, "读路线缓存失败，直接问谷歌");
    }
    const apiKey = this.#deps.apiKey();
    if (apiKey === null) return fail("NOT_CONFIGURED");
    const keyId = fingerprint(apiKey);
    const cooling = this.#cooldown;
    // 冷却只在记下它的那一天（东京时间）有效：0 点换了新的一天，前一天的「到了上限」不再挡人，也不记到新的一天
    if (cooling !== null && cooling.key === keyId && cooling.day === routeUsageDay(this.#deps.now()) && performance.now() < cooling.until) {
      // 到了每日上限后的冷却期里直接挡下的，同样记一次「被挡下」（记不了不影响报价）
      if (cooling.code === "DAILY_LIMIT_REACHED") {
        await withPlatformTx(pool, (db) => recordRouteRefused(db, routeUsageDay(this.#deps.now())), { queryTimeoutMs: ROUTE_DB_TIMEOUT_MS }).catch((err: unknown) => log.warn({ err }, "记「被挡下」失败"));
      }
      return fail(cooling.code);
    }

    const day = routeUsageDay(this.#deps.now());
    let reserveFailed = false;
    const beforeAttempt = async (): Promise<boolean> => {
      try {
        return await withPlatformTx(pool, (db) => reserveRouteCall(db, day, (used) => routeCallAllowed(used, this.#deps.dailyLimit)), { queryTimeoutMs: ROUTE_DB_TIMEOUT_MS });
      } catch (err) {
        // 记不了数就不调用（费用控制宁可少调）；原因按「暂时出错」报
        log.warn({ err }, "占用路线预估的每日调用名额失败，这次不调用谷歌");
        reserveFailed = true;
        return false;
      }
    };
    const computed = await this.#deps.compute(apiKey, cacheKey.from, cacheKey.to, beforeAttempt);
    const result: ComputedRoute = !computed.ok && computed.code === "DAILY_LIMIT_REACHED" && reserveFailed ? { ok: false, code: "UNAVAILABLE" } : computed;
    const at = this.#deps.now();

    if (!result.ok) {
      const cooldownMs = routeFailureCooldownMs(result.code);
      if (cooldownMs > 0) this.#cooldown = { key: keyId, code: result.code, until: performance.now() + cooldownMs, day };
      log.warn({ routeFailure: result.code }, "路线预估取不到（谷歌地图），用得到它的商品暂时无法报价");
    } else if (this.#cooldown?.key === keyId) {
      this.#cooldown = null;
    }
    try {
      await withPlatformTx(
        pool,
        async (db) => {
          // 被每日上限挡下的不是一次调用：只在「被挡下」里计数（reserveRouteCall 已记）
          if (result.ok || result.code !== "DAILY_LIMIT_REACHED") await recordRouteOutcome(db, day, result.ok ? { ok: true } : { ok: false, code: result.code }, at);
          if (result.ok) await saveRouteEstimate(db, cacheKey.key, { ok: true, meters: result.meters, seconds: result.seconds }, at, routeCacheExpiry(at, true));
          else if (routeFailureCacheable(result.code)) await saveRouteEstimate(db, cacheKey.key, { ok: false, code: result.code as "NO_ROUTE" | "INVALID_POINTS" }, at, routeCacheExpiry(at, false));
        },
        { queryTimeoutMs: ROUTE_DB_TIMEOUT_MS },
      );
    } catch (err) {
      log.warn({ err }, "写路线缓存或调用计数失败（这次的结果照常使用）");
    }
    return result.ok ? fromCached(result, "google") : fail(result.code);
  }
}
