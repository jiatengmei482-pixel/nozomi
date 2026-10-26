/**
 * 官网的地址搜索和坐标反查（M3-12，ADR 0044）：客人按关键字找地点、在地图上点一个位置后查它的地址。后端代调谷歌，密钥不进浏览器。
 *
 * 一次查询 = 缓存键（搜索：城市 + 规范化的关键字；反查：坐标取整到 4 位 + 国家）→ 同一个键正在查的直接等那一次（并发只调一次谷歌）
 * → 进程内的短时缓存（10 分钟；谷歌返回的名称、地址不存库，见 ADR 0044「缓存」）→ 现在生效的谷歌密钥（运营后台填写的优先，每次现取）
 * → 这把密钥在冷却中就直接按上次的原因降级 → 调谷歌（每次真正发请求前占一个今天的名额，到了每日上限不发）
 * → 失败记进今天的计数和「最近一次失败」，按原因冷却一会儿。
 *
 * 永远不抛异常：结果是候选地点 / 地址，或原因代码。客人只看到「暂时用不了」，页面退回常用地点、地图点选和手填。
 * 日志只记原因代码，不记密钥、关键字、坐标和谷歌返回的原文。
 */
import { createHash } from "node:crypto";
import { type LatLng, type LatLngBounds, type PlaceCandidate, type PlaceFailureCode, PLACE_SEARCH_RULES, placeFailureCooldownMs, placeReverseKey, placeSearchCacheKey, routeCallAllowed, routeUsageDay } from "@nozomi/domain";
import { withPlatformTx } from "../db/context.ts";
import type { Pool } from "../db/pool.ts";
import type { PlaceCallResult, PlaceSearchRequest } from "../integrations/google-places.ts";
import { recordPlaceOutcome, recordPlaceRefused, reservePlaceCall } from "../repos/place-search.ts";

/** 读写计数的每条查询最多等多久（毫秒） */
const PLACE_DB_TIMEOUT_MS = 500;

export type PlaceLookup<T> = { ok: true; value: T; source: "cache" | "google" } | { ok: false; code: PlaceFailureCode };

export interface PlaceSearchLog {
  warn(obj: object, msg: string): void;
}

export interface GooglePlaceSearchDeps {
  pool: Pool;
  now: () => Date;
  /** 现在生效的谷歌地图密钥；没有配置为 null */
  apiKey: () => string | null;
  /** 每天最多调用几次（配置 `GOOGLE_PLACES_DAILY_LIMIT`，搜索和反查合计） */
  dailyLimit: number;
  /** 调谷歌搜索（`integrations/google-places.ts` 的 `searchPlaces`）；`beforeAttempt` 每次发请求前调用 */
  search: (apiKey: string, request: PlaceSearchRequest, beforeAttempt: () => Promise<boolean>) => Promise<PlaceCallResult<PlaceCandidate[]>>;
  /** 调谷歌反查（`reverseGeocode`） */
  reverse: (apiKey: string, point: LatLng, regionCode: string, beforeAttempt: () => Promise<boolean>) => Promise<PlaceCallResult<string | null>>;
  log: PlaceSearchLog;
  /** 进程内短时缓存保留多久（毫秒）；不给用 `PLACE_SEARCH_RULES.cacheTtlMs`。测试用它验证过期 */
  cacheTtlMs?: number;
}

/** 密钥的指纹（只在本进程的内存里，按密钥记冷却）：换了密钥，冷却不跟过去。 */
function fingerprint(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex");
}

type Cached = { ok: true; value: unknown } | { ok: false; code: "INVALID_REQUEST" };

export class GooglePlaceSearch {
  readonly #deps: GooglePlaceSearchDeps;
  readonly #inflight = new Map<string, Promise<PlaceLookup<unknown>>>();
  /** 进程内短时缓存：键 → 结果和到期时刻（单调时钟）；先进先出，最多 `PLACE_SEARCH_RULES.cacheMaxEntries` 条 */
  readonly #cache = new Map<string, { result: Cached; until: number }>();
  #cooldown: { key: string; code: PlaceFailureCode; until: number } | null = null;

  constructor(deps: GooglePlaceSearchDeps) {
    this.#deps = deps;
  }

  /** 官网要不要显示地址搜索：配置了谷歌密钥、每日上限不是 0。（冷却、到了上限照样显示，用的时候再告诉客人暂时用不了） */
  get enabled(): boolean {
    return this.#deps.apiKey() !== null && this.#deps.dailyLimit > 0;
  }

  /** 按关键字（已规范化、长短合格）在城市附近搜。 */
  search(input: { cityId: string; query: string; bounds: LatLngBounds; regionCode: string }): Promise<PlaceLookup<PlaceCandidate[]>> {
    const key = placeSearchCacheKey(input.cityId, input.query);
    const request: PlaceSearchRequest = { query: input.query, bounds: input.bounds, regionCode: input.regionCode };
    return this.#once(key, (apiKey, beforeAttempt) => this.#deps.search(apiKey, request, beforeAttempt)) as Promise<PlaceLookup<PlaceCandidate[]>>;
  }

  /** 查一个坐标的地址（坐标先取整，调谷歌也用取整后的）。没有地址是 `value: null`。 */
  reverse(input: { point: LatLng; regionCode: string }): Promise<PlaceLookup<string | null>> {
    const rounded = placeReverseKey(input.point);
    const key = `${rounded.key}:${input.regionCode}`;
    return this.#once(key, (apiKey, beforeAttempt) => this.#deps.reverse(apiKey, rounded.point, input.regionCode, beforeAttempt)) as Promise<PlaceLookup<string | null>>;
  }

  #once(key: string, run: (apiKey: string, beforeAttempt: () => Promise<boolean>) => Promise<PlaceCallResult<unknown>>): Promise<PlaceLookup<unknown>> {
    const running = this.#inflight.get(key);
    if (running !== undefined) return running;
    const lookup = this.#lookup(key, run).finally(() => this.#inflight.delete(key));
    this.#inflight.set(key, lookup);
    return lookup;
  }

  #fromCache(key: string): Cached | null {
    const hit = this.#cache.get(key);
    if (hit === undefined) return null;
    if (performance.now() >= hit.until) {
      this.#cache.delete(key);
      return null;
    }
    return hit.result;
  }

  #remember(key: string, result: Cached): void {
    const ttl = this.#deps.cacheTtlMs ?? PLACE_SEARCH_RULES.cacheTtlMs;
    if (ttl <= 0) return;
    this.#cache.delete(key);
    while (this.#cache.size >= PLACE_SEARCH_RULES.cacheMaxEntries) {
      const oldest = this.#cache.keys().next().value;
      if (oldest === undefined) break;
      this.#cache.delete(oldest);
    }
    this.#cache.set(key, { result, until: performance.now() + ttl });
  }

  async #lookup(key: string, run: (apiKey: string, beforeAttempt: () => Promise<boolean>) => Promise<PlaceCallResult<unknown>>): Promise<PlaceLookup<unknown>> {
    const { pool, log } = this.#deps;
    const cached = this.#fromCache(key);
    if (cached !== null) return cached.ok ? { ok: true, value: cached.value, source: "cache" } : cached;
    const apiKey = this.#deps.apiKey();
    if (apiKey === null) return { ok: false, code: "NOT_CONFIGURED" };
    const keyId = fingerprint(apiKey);
    const cooling = this.#cooldown;
    if (cooling !== null && cooling.key === keyId && performance.now() < cooling.until) {
      if (cooling.code === "DAILY_LIMIT_REACHED") {
        await withPlatformTx(pool, (db) => recordPlaceRefused(db, routeUsageDay(this.#deps.now())), { queryTimeoutMs: PLACE_DB_TIMEOUT_MS }).catch((err: unknown) => log.warn({ err }, "记「被挡下」失败（地址搜索）"));
      }
      return { ok: false, code: cooling.code };
    }

    const day = routeUsageDay(this.#deps.now());
    let reserveFailed = false;
    const beforeAttempt = async (): Promise<boolean> => {
      try {
        return await withPlatformTx(pool, (db) => reservePlaceCall(db, day, (used) => routeCallAllowed(used, this.#deps.dailyLimit)), { queryTimeoutMs: PLACE_DB_TIMEOUT_MS });
      } catch (err) {
        // 记不了数就不调用（费用控制宁可少调）
        log.warn({ err }, "占用地址搜索的每日调用名额失败，这次不调用谷歌");
        reserveFailed = true;
        return false;
      }
    };
    const called = await run(apiKey, beforeAttempt);
    const result: PlaceCallResult<unknown> = !called.ok && called.code === "DAILY_LIMIT_REACHED" && reserveFailed ? { ok: false, code: "UNAVAILABLE" } : called;

    if (!result.ok) {
      const cooldownMs = placeFailureCooldownMs(result.code);
      if (cooldownMs > 0) this.#cooldown = { key: keyId, code: result.code, until: performance.now() + cooldownMs };
      log.warn({ placeFailure: result.code }, "官网地址搜索 / 反查取不到（谷歌地图），页面退回常用地点和手填");
    } else if (this.#cooldown?.key === keyId) {
      this.#cooldown = null;
    }
    if (result.ok) this.#remember(key, { ok: true, value: result.value });
    else if (result.code === "INVALID_REQUEST") this.#remember(key, { ok: false, code: "INVALID_REQUEST" });

    if (result.ok || result.code !== "DAILY_LIMIT_REACHED") {
      const at = this.#deps.now();
      await withPlatformTx(pool, (db) => recordPlaceOutcome(db, day, result.ok ? { ok: true } : { ok: false, code: result.code }, at), { queryTimeoutMs: PLACE_DB_TIMEOUT_MS }).catch((err: unknown) =>
        log.warn({ err }, "写地址搜索的调用计数失败（这次的结果照常使用）"),
      );
    }
    return result.ok ? { ok: true, value: result.value, source: "google" } : result;
  }
}
