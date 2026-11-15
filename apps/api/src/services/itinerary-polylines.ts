/**
 * 包车行程地图的折线（M9P-20 P1，ADR 0096 第二节第 2 小节）：一次 computeRoutes 带中间点，取经过全部点的折线，只用来画图。
 *
 * 一次取折线 = 有序点列取整成缓存键（domain 的 `itineraryPointsKey`）→ 同一个键正在取的直接等那一次（并发只调一次谷歌）
 * → 查库里的缓存（7 天内有就直接给）→ 现在生效的谷歌密钥 → 这把密钥在冷却中就直接按上次的原因降级
 * → 调谷歌（每次真正发请求前占一个今天的名额，**和路线预估同一个每日上限** `GOOGLE_ROUTES_DAILY_LIMIT`、同一张计数表）
 * → 有折线的写库（7 天）；失败记进今天的计数和「最近一次失败」，按原因冷却一会儿（时长同 ADR 0042）。
 *
 * 永远不抛异常。日志只记原因代码，不记密钥和谷歌返回的原文。不改报价、不写路线预估的缓存（报价仍按逐段两两的路线预估）。
 */
import { createHash } from "node:crypto";
import { ITINERARY_MAP_RULES, type LatLng, type RouteFailureCode, routeCallAllowed, routeFailureCooldownMs, routeUsageDay } from "@nozomi/domain";
import { withPlatformTx } from "../db/context.ts";
import type { Pool } from "../db/pool.ts";
import type { ComputedItineraryPolyline } from "../integrations/google-itinerary-routes.ts";
import { findItineraryPolylines, saveItineraryPolylines } from "../repos/itinerary-polylines.ts";
import { recordRouteOutcome, recordRouteRefused, reserveRouteCall } from "../repos/route-estimates.ts";
import { ROUTE_DB_TIMEOUT_MS } from "./route-estimates.ts";

export type ItineraryPolylineLookup = { ok: true; polylines: string[]; source: "cache" | "google" } | { ok: false; code: RouteFailureCode };

/** 取一组有序点（已经取整）的折线。实现应当自己处理超时和错误，永远不抛异常。 */
export interface ItineraryPolylineSource {
  polylines(key: string, points: readonly LatLng[]): Promise<ItineraryPolylineLookup>;
}

export const NO_ITINERARY_POLYLINES: ItineraryPolylineSource = { polylines: async () => ({ ok: false, code: "NOT_CONFIGURED" }) };

export interface ItineraryPolylineLog {
  warn(obj: object, msg: string): void;
}

export interface GoogleItineraryPolylinesDeps {
  pool: Pool;
  now: () => Date;
  /** 现在生效的谷歌地图密钥；没有配置为 null */
  apiKey: () => string | null;
  /** 每天最多调用几次：和路线预估同一个（配置 `GOOGLE_ROUTES_DAILY_LIMIT`） */
  dailyLimit: number;
  /** 调一次谷歌（`integrations/google-itinerary-routes.ts` 的 `computeItineraryPolyline`）；`beforeAttempt` 每次发请求前调用 */
  compute: (apiKey: string, points: readonly LatLng[], beforeAttempt: () => Promise<boolean>) => Promise<ComputedItineraryPolyline>;
  log: ItineraryPolylineLog;
  /** 读写缓存、占每日名额的事务时限（毫秒）；不给用 `ROUTE_DB_TIMEOUT_MS`。生产不传，只给数谷歌调用次数的集成测试放宽（同 M8-29） */
  dbTimeoutMs?: number;
}

function fingerprint(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

export class GoogleItineraryPolylines implements ItineraryPolylineSource {
  readonly #deps: GoogleItineraryPolylinesDeps;
  readonly #inflight = new Map<string, Promise<ItineraryPolylineLookup>>();
  #cooldown: { key: string; code: RouteFailureCode; until: number; day: string } | null = null;

  constructor(deps: GoogleItineraryPolylinesDeps) {
    this.#deps = deps;
  }

  polylines(key: string, points: readonly LatLng[]): Promise<ItineraryPolylineLookup> {
    const running = this.#inflight.get(key);
    if (running !== undefined) return running;
    const lookup = this.#lookup(key, points).finally(() => this.#inflight.delete(key));
    this.#inflight.set(key, lookup);
    return lookup;
  }

  async #lookup(key: string, points: readonly LatLng[]): Promise<ItineraryPolylineLookup> {
    const { pool, log } = this.#deps;
    const db = { queryTimeoutMs: this.#deps.dbTimeoutMs ?? ROUTE_DB_TIMEOUT_MS };
    try {
      const cached = await withPlatformTx(pool, (tx) => findItineraryPolylines(tx, key, this.#deps.now()), db);
      if (cached !== null) return { ok: true, polylines: cached, source: "cache" };
    } catch (err) {
      log.warn({ err }, "读行程折线的缓存失败，直接问谷歌");
    }
    const apiKey = this.#deps.apiKey();
    if (apiKey === null) return { ok: false, code: "NOT_CONFIGURED" };
    const keyId = fingerprint(apiKey);
    const day = routeUsageDay(this.#deps.now());
    const cooling = this.#cooldown;
    if (cooling !== null && cooling.key === keyId && cooling.day === day && performance.now() < cooling.until) {
      if (cooling.code === "DAILY_LIMIT_REACHED") await withPlatformTx(pool, (tx) => recordRouteRefused(tx, day), db).catch((err: unknown) => log.warn({ err }, "记「被挡下」失败"));
      return { ok: false, code: cooling.code };
    }
    let reserveFailed = false;
    const beforeAttempt = async (): Promise<boolean> => {
      try {
        return await withPlatformTx(pool, (tx) => reserveRouteCall(tx, day, (used) => routeCallAllowed(used, this.#deps.dailyLimit)), db);
      } catch (err) {
        log.warn({ err }, "占用路线的每日调用名额失败，这次不调用谷歌");
        reserveFailed = true;
        return false;
      }
    };
    const computed = await this.#deps.compute(apiKey, points, beforeAttempt);
    const result: ComputedItineraryPolyline = !computed.ok && computed.code === "DAILY_LIMIT_REACHED" && reserveFailed ? { ok: false, code: "UNAVAILABLE" } : computed;
    const at = this.#deps.now();
    if (!result.ok) {
      const cooldownMs = routeFailureCooldownMs(result.code);
      if (cooldownMs > 0) this.#cooldown = { key: keyId, code: result.code, until: performance.now() + cooldownMs, day };
      log.warn({ routeFailure: result.code }, "包车行程地图的折线取不到（谷歌地图），页面只显示行程列表");
    } else if (this.#cooldown?.key === keyId) {
      this.#cooldown = null;
    }
    try {
      await withPlatformTx(
        pool,
        async (tx) => {
          if (result.ok || result.code !== "DAILY_LIMIT_REACHED") await recordRouteOutcome(tx, day, result.ok ? { ok: true } : { ok: false, code: result.code }, at);
          if (result.ok && result.polylines.length > 0) await saveItineraryPolylines(tx, key, result.polylines, at, new Date(at.getTime() + ITINERARY_MAP_RULES.polylineCacheTtlMs));
        },
        db,
      );
    } catch (err) {
      log.warn({ err }, "写行程折线的缓存或调用计数失败（这次的结果照常使用）");
    }
    return result.ok ? { ok: true, polylines: result.polylines, source: "google" } : result;
  }
}
