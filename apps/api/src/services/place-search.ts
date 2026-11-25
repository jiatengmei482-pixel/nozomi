/**
 * 官网的地址搜索和坐标反查（M3-12，ADR 0044）：客人按关键字找地点、在地图上点一个位置后查它的地址。后端代调谷歌，密钥不进浏览器。
 *
 * 一次查询 = 缓存键（搜索：城市 + 规范化的关键字；反查：坐标取整到 4 位 + 国家）→ 同一个键正在查的直接等那一次（并发只调一次谷歌）
 * → 进程内的短时缓存（10 分钟；谷歌返回的名称、地址不存库，见 ADR 0044「缓存」）→ 现在生效的谷歌密钥（运营后台填写的优先，每次现取）
 * → 这把密钥在冷却中就直接按上次的原因降级 → 调谷歌（每次真正发请求前占一个今天的名额，到了每日上限不发）
 * → 失败记进今天的计数和「最近一次失败」，按原因冷却一会儿。
 *
 * 输入即提示（M8-02，ADR 0069 B1）：`autocomplete`（键：渠道授权范围 + 关键字，不含会话令牌）和选中后的 `details`（键：地点 ID）走同一套缓存、并发、冷却和每日上限。
 *
 * 语言（M12-07，ADR 0108）：每次查询带请求谷歌的语言（调用方按关键字 / 页面语言判断好），**所有缓存键都带语言**，不同语言的结果不互相覆盖。
 * 输入即提示记下这个会话令牌用的语言（进程内，10 分钟），同一会话选中后取坐标沿用它；记不到（没带会话、过期、换了进程）用调用方给的页面语言。
 *
 * 每个来源地址每天的额度（M8-45，ADR 0069 补记）：调用方可以给一个 `beforeGoogle`（带着来源地址），**只在真要调谷歌时**（命中缓存、
 * 跟着别人正在查的同一次、没配置、冷却中都不问）、和全站每日名额同一处问一次；不放行就不调谷歌，结果是 `IP_DAILY_LIMIT`——
 * 只跟这个地址有关：不冷却、不缓存、不记进全站的计数和「最近一次失败」。
 *
 * 永远不抛异常：结果是候选地点 / 地址，或原因代码。客人只看到「暂时用不了」，页面退回常用地点、地图点选和手填。
 * 日志只记原因代码，不记密钥、关键字、坐标和谷歌返回的原文。
 */
import { createHash } from "node:crypto";
import { type LatLng, type LatLngBounds, type PlaceCandidate, type PlaceFailureCode, type PlaceLanguage, type PlacePrediction, PLACE_SEARCH_RULES, placeAutocompleteCacheKey, placeDetailsCacheKey, placeFailureCooldownMs, placeReverseCacheKey, placeReverseKey, placeSearchCacheKey, routeCallAllowed, routeUsageDay } from "@nozomi/domain";
import { withPlatformTx } from "../db/context.ts";
import type { Pool } from "../db/pool.ts";
import type { PlaceAutocompleteRequest, PlaceCallResult, PlaceDetails, PlaceDetailsRequest, PlaceReverseRequest, PlaceSearchRequest } from "../integrations/google-places.ts";
import { recordPlaceOutcome, recordPlaceRefused, reservePlaceCall } from "../repos/place-search.ts";

/** 读写计数的每条查询最多等多久（毫秒） */
const PLACE_DB_TIMEOUT_MS = 500;

/** 这个来源地址今天调谷歌的额度用完了（M8-45）：只跟这个地址有关，不是谷歌的问题 */
export type PlaceIpLimited = "IP_DAILY_LIMIT";

export type PlaceLookup<T> = { ok: true; value: T; source: "cache" | "google" } | { ok: false; code: PlaceFailureCode | PlaceIpLimited };

/** 真要调谷歌之前问一次（M8-45）：返回 false 就不调，结果是 `IP_DAILY_LIMIT`；抛异常按「记不了数」处理（不调，`UNAVAILABLE`）。 */
export type PlaceBeforeGoogle = () => Promise<boolean>;

/** 每次查询的附加选项 */
export interface PlaceLookupOptions {
  beforeGoogle?: PlaceBeforeGoogle;
}

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
  reverse: (apiKey: string, request: PlaceReverseRequest, beforeAttempt: () => Promise<boolean>) => Promise<PlaceCallResult<string | null>>;
  /** 调谷歌输入即提示（`autocompletePlaces`） */
  autocomplete: (apiKey: string, request: PlaceAutocompleteRequest, beforeAttempt: () => Promise<boolean>) => Promise<PlaceCallResult<PlacePrediction[]>>;
  /** 调谷歌取一个地点的坐标和类型（`placeDetails`） */
  details: (apiKey: string, request: PlaceDetailsRequest, beforeAttempt: () => Promise<boolean>) => Promise<PlaceCallResult<PlaceDetails>>;
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
  #cooldown: { key: string; code: PlaceFailureCode; until: number; day: string } | null = null;
  /** 输入即提示的会话令牌 → 它用的语言和到期时刻（单调时钟）；先进先出，最多 `PLACE_SEARCH_RULES.sessionLanguageMaxEntries` 个 */
  readonly #sessionLanguages = new Map<string, { language: PlaceLanguage; until: number }>();

  constructor(deps: GooglePlaceSearchDeps) {
    this.#deps = deps;
  }

  /** 官网要不要显示地址搜索：配置了谷歌密钥、每日上限不是 0。（冷却、到了上限照样显示，用的时候再告诉客人暂时用不了） */
  get enabled(): boolean {
    return this.#deps.apiKey() !== null && this.#deps.dailyLimit > 0;
  }

  /**
   * 按关键字（已规范化、长短合格）在城市附近搜。`cityId` 是缓存键里的范围：带城市时是城市编号，不带城市时是渠道授权范围的标识（M8-02）；
   * `accept` 是范围里的结果再筛一遍（不带城市时：在不在某个授权城市的范围里）。
   */
  search(input: { cityId: string; query: string; bounds: LatLngBounds; regionCode: string | null; accept?: (location: LatLng) => boolean; language: PlaceLanguage }, options: PlaceLookupOptions = {}): Promise<PlaceLookup<PlaceCandidate[]>> {
    const key = placeSearchCacheKey(input.language, input.cityId, input.query);
    const request: PlaceSearchRequest = { query: input.query, bounds: input.bounds, regionCode: input.regionCode, language: input.language, ...(input.accept === undefined ? {} : { accept: input.accept }) };
    return this.#once(key, (apiKey, beforeAttempt) => this.#deps.search(apiKey, request, beforeAttempt), options) as Promise<PlaceLookup<PlaceCandidate[]>>;
  }

  /**
   * 输入即提示：`scope` 是渠道授权范围的标识（缓存键用），会话令牌照传给谷歌但不进缓存键。
   * 记下这个会话用的语言（命中缓存也记）：同一会话选中后取坐标沿用它（`details`）。
   */
  autocomplete(input: { scope: string; query: string; sessionToken: string; regionCodes: readonly string[]; bounds: LatLngBounds | null; language: PlaceLanguage }, options: PlaceLookupOptions = {}): Promise<PlaceLookup<PlacePrediction[]>> {
    this.#rememberSessionLanguage(input.sessionToken, input.language);
    const key = placeAutocompleteCacheKey(input.language, input.scope, input.query);
    const request: PlaceAutocompleteRequest = { query: input.query, sessionToken: input.sessionToken, regionCodes: input.regionCodes, bounds: input.bounds, language: input.language };
    return this.#once(key, (apiKey, beforeAttempt) => this.#deps.autocomplete(apiKey, request, beforeAttempt), options) as Promise<PlaceLookup<PlacePrediction[]>>;
  }

  /**
   * 选中的地点的坐标、地址、类型（地点 ID 已核对过格式）。语言：同一会话的输入即提示用的语言；没带会话或记不到时用 `fallbackLanguage`（页面语言）。
   */
  details(input: { placeId: string; sessionToken: string | null; fallbackLanguage: PlaceLanguage }, options: PlaceLookupOptions = {}): Promise<PlaceLookup<PlaceDetails>> {
    const language = this.sessionLanguage(input.sessionToken) ?? input.fallbackLanguage;
    const key = placeDetailsCacheKey(language, input.placeId);
    const request: PlaceDetailsRequest = { placeId: input.placeId, sessionToken: input.sessionToken, language };
    return this.#once(key, (apiKey, beforeAttempt) => this.#deps.details(apiKey, request, beforeAttempt), options) as Promise<PlaceLookup<PlaceDetails>>;
  }

  /** 查一个坐标的地址（坐标先取整，调谷歌也用取整后的）。没有地址是 `value: null`。语言是页面语言（反查没有输入的文字）。 */
  reverse(input: { point: LatLng; regionCode: string; language: PlaceLanguage }, options: PlaceLookupOptions = {}): Promise<PlaceLookup<string | null>> {
    const rounded = placeReverseKey(input.point);
    const key = placeReverseCacheKey(input.language, input.point, input.regionCode);
    const request: PlaceReverseRequest = { point: rounded.point, regionCode: input.regionCode, language: input.language };
    return this.#once(key, (apiKey, beforeAttempt) => this.#deps.reverse(apiKey, request, beforeAttempt), options) as Promise<PlaceLookup<string | null>>;
  }

  /** 这个会话令牌的输入即提示用的语言；没带会话、没记下或过期了为 null。 */
  sessionLanguage(sessionToken: string | null): PlaceLanguage | null {
    if (sessionToken === null) return null;
    const hit = this.#sessionLanguages.get(sessionToken);
    if (hit === undefined) return null;
    if (performance.now() >= hit.until) {
      this.#sessionLanguages.delete(sessionToken);
      return null;
    }
    return hit.language;
  }

  #rememberSessionLanguage(sessionToken: string, language: PlaceLanguage): void {
    this.#sessionLanguages.delete(sessionToken);
    while (this.#sessionLanguages.size >= PLACE_SEARCH_RULES.sessionLanguageMaxEntries) {
      const oldest = this.#sessionLanguages.keys().next().value;
      if (oldest === undefined) break;
      this.#sessionLanguages.delete(oldest);
    }
    this.#sessionLanguages.set(sessionToken, { language, until: performance.now() + PLACE_SEARCH_RULES.sessionLanguageTtlMs });
  }

  async #once(key: string, run: (apiKey: string, beforeAttempt: () => Promise<boolean>) => Promise<PlaceCallResult<unknown>>, options: PlaceLookupOptions): Promise<PlaceLookup<unknown>> {
    const running = this.#inflight.get(key);
    if (running !== undefined) {
      const shared = await running;
      // 正在查的那一次因为「它的来源地址今天的额度用完了」没调谷歌：那不是这一位的结果，自己再查一次（按自己的地址问额度）
      if (!shared.ok && shared.code === "IP_DAILY_LIMIT") return this.#once(key, run, options);
      return shared;
    }
    const lookup = this.#lookup(key, run, options.beforeGoogle).finally(() => this.#inflight.delete(key));
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

  async #lookup(key: string, run: (apiKey: string, beforeAttempt: () => Promise<boolean>) => Promise<PlaceCallResult<unknown>>, beforeGoogle: PlaceBeforeGoogle | undefined): Promise<PlaceLookup<unknown>> {
    const { pool, log } = this.#deps;
    const cached = this.#fromCache(key);
    if (cached !== null) return cached.ok ? { ok: true, value: cached.value, source: "cache" } : cached;
    const apiKey = this.#deps.apiKey();
    if (apiKey === null) return { ok: false, code: "NOT_CONFIGURED" };
    const keyId = fingerprint(apiKey);
    const cooling = this.#cooldown;
    // 冷却只在记下它的那一天（东京时间）有效：0 点换了新的一天，前一天的「到了上限」不再挡人，也不记到新的一天
    if (cooling !== null && cooling.key === keyId && cooling.day === routeUsageDay(this.#deps.now()) && performance.now() < cooling.until) {
      if (cooling.code === "DAILY_LIMIT_REACHED") {
        await withPlatformTx(pool, (db) => recordPlaceRefused(db, routeUsageDay(this.#deps.now())), { queryTimeoutMs: PLACE_DB_TIMEOUT_MS }).catch((err: unknown) => log.warn({ err }, "记「被挡下」失败（地址搜索）"));
      }
      return { ok: false, code: cooling.code };
    }

    const day = routeUsageDay(this.#deps.now());
    let reserveFailed = false;
    let ipAsked = false;
    let ipLimited = false;
    const beforeAttempt = async (): Promise<boolean> => {
      // 来源地址的额度：一次查询只问一次（谷歌超时重试的那一次不再扣），先于全站名额（被这一层挡下的不占全站名额）
      if (beforeGoogle !== undefined && !ipAsked) {
        ipAsked = true;
        try {
          if (!(await beforeGoogle())) {
            ipLimited = true;
            return false;
          }
        } catch (err) {
          log.warn({ err }, "占用来源地址的地址提示每日额度失败，这次不调用谷歌");
          reserveFailed = true;
          return false;
        }
      }
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
    // 只是这个地址今天的额度用完了：谷歌没调，不冷却（别的地址照常）、不缓存、不记进全站的计数
    if (ipLimited) return { ok: false, code: "IP_DAILY_LIMIT" };
    const result: PlaceCallResult<unknown> = !called.ok && called.code === "DAILY_LIMIT_REACHED" && reserveFailed ? { ok: false, code: "UNAVAILABLE" } : called;

    if (!result.ok) {
      const cooldownMs = placeFailureCooldownMs(result.code);
      if (cooldownMs > 0) this.#cooldown = { key: keyId, code: result.code, until: performance.now() + cooldownMs, day };
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
