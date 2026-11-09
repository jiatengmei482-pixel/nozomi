/**
 * 官网路线小地图（M8-10，ADR 0072）：新预订页右侧「行程摘要」的路线图，谷歌 Maps Static API 出图，后端代调（密钥不进浏览器）。
 *
 * 一次出图 = 起终点取整成路线缓存键（domain 的 `routeCacheKey`，和报价、按两个坐标报价同一个键）+ 主题、尺寸、倍率 → 图的缓存键
 * → 同一个键正在出图的直接等那一次（并发只调一次谷歌）→ 查库里的图（1 天内有就直接给，不调任何谷歌）
 * → 现在生效的谷歌密钥（运营后台填写的优先，每次现取）→ 这把密钥的静态地图在冷却中就直接按上次的原因降级
 * → 路线折线：`RoutePreviewer.preview`（按两个坐标报价时取过的，10 分钟内在进程里，不再调 Routes；没有就按 ADR 0042 调，计入路线的每日上限）
 * → 生成请求参数（domain 的 `staticMapQuery`，灰色调、品牌色路线）→ 调谷歌（每次真正发请求前占一个今天的名额，`GOOGLE_STATIC_MAPS_DAILY_LIMIT`）
 * → 成功的写库（1 天）；失败记进今天的计数和「最近一次失败」，按原因冷却一会儿（时长同 ADR 0042）。
 *
 * 永远不抛异常：结果是图，或取不到的原因（给页面的只有两类，见 domain 的 `routeMapReason`）。日志只记原因代码，不记密钥、请求网址和谷歌返回的原文。
 * 只出图，不改报价、不改路线预估的结果（路线照旧由 `RoutePreviewer` 决定）。
 */
import { createHash } from "node:crypto";
import {
  type LatLng,
  type RouteMapFailure,
  type RouteMapReason,
  STATIC_MAP_RULES,
  type StaticMapFailureCode,
  type StaticMapSize,
  routeCacheKey,
  routeCallAllowed,
  routeMapReason,
  routeUsageDay,
  staticMapCacheKey,
  staticMapFailureCooldownMs,
  staticMapQuery,
} from "@nozomi/domain";
import { withPlatformTx } from "../db/context.ts";
import type { Pool } from "../db/pool.ts";
import type { StaticMapFetchResult, StaticMapImageType } from "../integrations/google-static-maps.ts";
import { findStaticMap, recordStaticMapOutcome, recordStaticMapRefused, reserveStaticMapCall, saveStaticMap } from "../repos/static-maps.ts";
import type { RoutePreviewer } from "./route-estimates.ts";

/** 读写缓存和计数的每条查询最多等多久（毫秒） */
const STATIC_MAP_DB_TIMEOUT_MS = 500;

export interface StaticMapLog {
  warn(obj: object, msg: string): void;
}

export interface RouteMapRequest extends StaticMapSize {
  from: LatLng;
  to: LatLng;
}

export type RouteMapResult =
  | { ok: true; contentType: StaticMapImageType; image: Buffer; source: "cache" | "google" }
  | { ok: false; reason: RouteMapReason; failure: RouteMapFailure };

export interface RouteMapRenderer {
  render(request: RouteMapRequest): Promise<RouteMapResult>;
}

export interface GoogleStaticMapServiceDeps {
  pool: Pool;
  now: () => Date;
  /** 现在生效的谷歌地图密钥；没有配置为 null */
  apiKey: () => string | null;
  /** 每天最多调用几次（配置 `GOOGLE_STATIC_MAPS_DAILY_LIMIT`） */
  dailyLimit: number;
  /** 路线折线从哪里来：和按两个坐标报价同一个（同一个进程内缓存、同一个冷却、同一个 Routes 每日上限） */
  routes: RoutePreviewer;
  /** 调一次谷歌静态地图（`integrations/google-static-maps.ts` 的 `fetchStaticMap`）；`beforeAttempt` 每次发请求前调用 */
  fetch: (apiKey: string, query: string, beforeAttempt: () => Promise<boolean>) => Promise<StaticMapFetchResult>;
  log: StaticMapLog;
}

const failed = (failure: RouteMapFailure): RouteMapResult => ({ ok: false, reason: routeMapReason(failure), failure });

/** 不接谷歌时：一律「没有配置」（只给不经 buildApp 的测试上下文用）。 */
export const NO_ROUTE_MAP: RouteMapRenderer = { render: async () => failed({ stage: "static_map", code: "NOT_CONFIGURED" }) };

/** 密钥的指纹（只在本进程的内存里，用来按密钥记冷却）：换了密钥，冷却不跟过去。 */
function fingerprint(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

export class GoogleStaticMapService implements RouteMapRenderer {
  readonly #deps: GoogleStaticMapServiceDeps;
  /** 正在出的图：同一个键同时来几次，只查一次、只调一次谷歌 */
  readonly #inflight = new Map<string, Promise<RouteMapResult>>();
  /** 上一次失败带来的冷却：哪把密钥、什么原因、到什么时候（单调时钟）、哪一天（东京时间，换天即失效） */
  #cooldown: { key: string; code: StaticMapFailureCode; until: number; day: string } | null = null;

  constructor(deps: GoogleStaticMapServiceDeps) {
    this.#deps = deps;
  }

  render(request: RouteMapRequest): Promise<RouteMapResult> {
    const route = routeCacheKey(request.from, request.to);
    if (route.samePoint) return Promise.resolve(failed({ stage: "map", code: "SAME_POINT" }));
    const size: StaticMapSize = { theme: request.theme, width: request.width, height: request.height, scale: request.scale };
    const key = staticMapCacheKey(route.key, size);
    const running = this.#inflight.get(key);
    if (running !== undefined) return running;
    const lookup = this.#render(key, route.from, route.to, size).finally(() => this.#inflight.delete(key));
    this.#inflight.set(key, lookup);
    return lookup;
  }

  async #render(key: string, from: LatLng, to: LatLng, size: StaticMapSize): Promise<RouteMapResult> {
    const { pool, log } = this.#deps;
    try {
      const cached = await withPlatformTx(pool, (db) => findStaticMap(db, key, this.#deps.now()), { queryTimeoutMs: STATIC_MAP_DB_TIMEOUT_MS });
      if (cached !== null) return { ok: true, contentType: cached.contentType, image: cached.image, source: "cache" };
    } catch (err) {
      log.warn({ err }, "读路线小地图的缓存失败，直接出图");
    }
    const apiKey = this.#deps.apiKey();
    if (apiKey === null) return failed({ stage: "static_map", code: "NOT_CONFIGURED" });
    const keyId = fingerprint(apiKey);
    const day = routeUsageDay(this.#deps.now());
    const cooling = this.#cooldown;
    if (cooling !== null && cooling.key === keyId && cooling.day === day && performance.now() < cooling.until) {
      if (cooling.code === "DAILY_LIMIT_REACHED") {
        await withPlatformTx(pool, (db) => recordStaticMapRefused(db, day), { queryTimeoutMs: STATIC_MAP_DB_TIMEOUT_MS }).catch((err: unknown) => log.warn({ err }, "记「被挡下」失败"));
      }
      return failed({ stage: "static_map", code: cooling.code });
    }

    // 路线折线：和按两个坐标报价同一个来源（不改路线预估的结果，只拿来画）
    const route = await this.#deps.routes.preview({ from, to }).catch((): null => null);
    if (route === null) return failed({ stage: "route", code: "UNEXPECTED" });
    if (!route.ok) return failed({ stage: "route", code: route.code });
    const query = route.route.polyline === null ? null : staticMapQuery(route.route.polyline, size);
    if (query === null) return failed({ stage: "map", code: "NO_POLYLINE" });

    let reserveFailed = false;
    const beforeAttempt = async (): Promise<boolean> => {
      try {
        return await withPlatformTx(pool, (db) => reserveStaticMapCall(db, day, (used) => routeCallAllowed(used, this.#deps.dailyLimit)), { queryTimeoutMs: STATIC_MAP_DB_TIMEOUT_MS });
      } catch (err) {
        // 记不了数就不调用（费用控制宁可少调）；原因按「暂时出错」报
        log.warn({ err }, "占用静态地图的每日调用名额失败，这次不调用谷歌");
        reserveFailed = true;
        return false;
      }
    };
    const fetched = await this.#deps.fetch(apiKey, query, beforeAttempt);
    const result: StaticMapFetchResult = !fetched.ok && fetched.code === "DAILY_LIMIT_REACHED" && reserveFailed ? { ok: false, code: "UNAVAILABLE" } : fetched;
    const at = this.#deps.now();
    if (!result.ok) {
      const cooldownMs = staticMapFailureCooldownMs(result.code);
      if (cooldownMs > 0) this.#cooldown = { key: keyId, code: result.code, until: performance.now() + cooldownMs, day };
      log.warn({ staticMapFailure: result.code }, "官网路线小地图取不到（谷歌静态地图），页面改用原来的地图或只显示时间和距离");
    } else if (this.#cooldown?.key === keyId) {
      this.#cooldown = null;
    }
    try {
      await withPlatformTx(
        pool,
        async (db) => {
          // 被每日上限挡下的不是一次调用：只在「被挡下」里计数（reserveStaticMapCall 已记）
          if (result.ok || result.code !== "DAILY_LIMIT_REACHED") await recordStaticMapOutcome(db, day, result.ok ? { ok: true } : { ok: false, code: result.code }, at);
          if (result.ok) await saveStaticMap(db, key, { contentType: result.contentType, image: result.image }, at, new Date(at.getTime() + STATIC_MAP_RULES.cacheTtlMs));
        },
        { queryTimeoutMs: STATIC_MAP_DB_TIMEOUT_MS },
      );
    } catch (err) {
      log.warn({ err }, "写路线小地图的缓存或调用计数失败（这次的图照常给）");
    }
    return result.ok ? { ok: true, contentType: result.contentType, image: result.image, source: "google" } : failed({ stage: "static_map", code: result.code });
  }
}
