/**
 * 外部服务：谷歌地图的地点搜索和坐标反查（M3-12，ADR 0044），给官网的地址输入用。浏览器从不直接连谷歌，密钥只在服务端。
 *
 * - 搜索：Places API (New) 的 Text Search（`POST places:searchText`）。只要 `places.id,places.displayName,places.formattedAddress,places.location` 四个字段
 *   （字段掩码），结果限制在城市中心周围的正方形里（`locationRestriction`），最多 5 条，中文（`zh-CN`）。
 * - 反查：Geocoding API 的反查（`GET …/geocode/location/纬度,经度`），只要 `results.formattedAddress`。
 *
 * 安全处理和路线预估一样（ADR 0042）：地址只认配置（`GOOGLE_PLACES_SEARCH_URL`、`GOOGLE_GEOCODE_URL`，只有 local / ci 能改）；密钥只放请求头 `X-Goog-Api-Key`，
 * 不放网址；不跟随重定向；应答边读边截，只读前 64 KB；整次有时限，连不上、超时、5xx 在剩余时间够时再试 1 次，4xx（含 429）不重试；
 * 每次真正发请求之前问一次 `beforeAttempt`（每日调用上限），不允许就不发。
 * 永远不抛异常：结果是候选地点 / 地址，或原因代码（不带对方返回的原文）。
 */
import { type LatLng, type LatLngBounds, type PlaceCandidate, type PlaceFailureCode, PLACE_SEARCH_RULES, cleanPlaceText, inBounds, isValidLatLng } from "@nozomi/domain";
import { GOOGLE_MAPS_ATTEMPTS, classifyCode, isTimeout, readCapped } from "./google-maps.ts";

/** 整次最多花多久（毫秒）：客人在页面上等着，但不像询价那样还要等别的 */
export const PLACE_BUDGET_MS = 3_000;
/** 每次尝试最多等多久（毫秒） */
export const PLACE_ATTEMPT_TIMEOUT_MS = 2_000;
/** 剩下的时间不到这么多就不再重试 */
const PLACE_MIN_RETRY_MS = 500;
/** 搜索要的字段（Text Search 的 Pro 一档；不多取电话、评分、营业时间等更贵的字段） */
export const PLACE_SEARCH_FIELD_MASK = "places.id,places.displayName,places.formattedAddress,places.location";
/** 反查要的字段：只要地址文字 */
export const REVERSE_FIELD_MASK = "results.formattedAddress";
/** 结果的语言：官网是中文页面 */
export const PLACE_LANGUAGE = "zh-CN";

export type PlaceCallResult<T> = { ok: true; value: T } | { ok: false; code: PlaceFailureCode };

export interface PlaceCallOptions {
  /** 地址（配置 `integrationEndpoints.googlePlacesSearchUrl` / `googleGeocodeUrl`） */
  url: string;
  /** 每次真正发请求之前调用：返回 false 就不发（到了每日上限），结果是 `DAILY_LIMIT_REACHED` */
  beforeAttempt?: () => Promise<boolean>;
  budgetMs?: number;
  attemptTimeoutMs?: number;
  /** 只给单元测试用的替身 */
  fetch?: typeof fetch;
}

/** 400 而又不是密钥的问题：谷歌认为请求（关键字、坐标）无效。 */
function failureOf(httpStatus: number, text: string): PlaceFailureCode {
  const code = classifyCode(httpStatus, text);
  if (code === "UNEXPECTED" && httpStatus === 400) return "INVALID_REQUEST";
  return code === "MODE_MISMATCH" ? "UNEXPECTED" : code;
}

/** 发一次请求（必要时重试一次），成功的应答交给 `parse`。 */
async function call<T>(apiKey: string, request: { url: string; method: "GET" | "POST"; fieldMask: string; body?: string }, parse: (body: unknown) => PlaceCallResult<T>, options: PlaceCallOptions): Promise<PlaceCallResult<T>> {
  const doFetch = options.fetch ?? fetch;
  const deadline = performance.now() + (options.budgetMs ?? PLACE_BUDGET_MS);
  const attemptTimeout = options.attemptTimeoutMs ?? PLACE_ATTEMPT_TIMEOUT_MS;
  let last: PlaceCallResult<T> = { ok: false, code: "UNREACHABLE" };
  for (let attempt = 1; attempt <= GOOGLE_MAPS_ATTEMPTS; attempt++) {
    if (attempt > 1 && deadline - performance.now() < PLACE_MIN_RETRY_MS) break;
    if (options.beforeAttempt !== undefined && !(await options.beforeAttempt())) return attempt === 1 ? { ok: false, code: "DAILY_LIMIT_REACHED" } : last;
    try {
      const res = await doFetch(request.url, {
        method: request.method,
        headers: { ...(request.body === undefined ? {} : { "content-type": "application/json" }), "x-goog-api-key": apiKey, "x-goog-fieldmask": request.fieldMask },
        ...(request.body === undefined ? {} : { body: request.body }),
        redirect: "manual",
        signal: AbortSignal.timeout(Math.max(1, Math.floor(Math.min(attemptTimeout, deadline - performance.now())))),
      });
      const text = await readCapped(res);
      if (res.status === 200) {
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          return { ok: false, code: "UNEXPECTED" };
        }
        if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, code: "UNEXPECTED" };
        return parse(body);
      }
      last = { ok: false, code: failureOf(res.status, text) };
      if (res.status < 500) return last;
    } catch (err) {
      last = { ok: false, code: isTimeout(err) ? "TIMEOUT" : "UNREACHABLE" };
    }
  }
  return last;
}

export interface PlaceSearchRequest {
  /** 规范化过的关键字 */
  query: string;
  /** 只要这个范围里的结果（城市中心周围） */
  bounds: LatLngBounds;
  /** 城市所在的国家（ISO 3166-1 两位） */
  regionCode: string;
}

/** Text Search 的请求体。 */
export function placeSearchBody(request: PlaceSearchRequest): string {
  return JSON.stringify({
    textQuery: request.query,
    languageCode: PLACE_LANGUAGE,
    regionCode: request.regionCode,
    pageSize: PLACE_SEARCH_RULES.maxResults,
    locationRestriction: {
      rectangle: {
        low: { latitude: request.bounds.low.lat, longitude: request.bounds.low.lng },
        high: { latitude: request.bounds.high.lat, longitude: request.bounds.high.lng },
      },
    },
  });
}

/**
 * 读 Text Search 的应答：`{ places: [{ id, displayName: { text }, formattedAddress, location: { latitude, longitude } }] }`；
 * 没有 `places`（空对象）是没找到。缺名称或坐标、坐标不合法、不在范围里的那一条丢掉；`places` 不是数组当作看不懂。
 */
export function parsePlaceSearch(body: unknown, bounds: LatLngBounds): PlaceCallResult<PlaceCandidate[]> {
  const places = (body as { places?: unknown }).places;
  if (places === undefined) return { ok: true, value: [] };
  if (!Array.isArray(places)) return { ok: false, code: "UNEXPECTED" };
  const found: PlaceCandidate[] = [];
  for (const entry of places as unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const place = entry as { id?: unknown; displayName?: { text?: unknown } | null; formattedAddress?: unknown; location?: { latitude?: unknown; longitude?: unknown } | null };
    const id = typeof place.id === "string" && /^[A-Za-z0-9_-]{1,300}$/.test(place.id) ? place.id : null;
    const name = cleanPlaceText(place.displayName?.text, PLACE_SEARCH_RULES.nameMaxLength);
    const address = cleanPlaceText(place.formattedAddress, PLACE_SEARCH_RULES.addressMaxLength) ?? "";
    const lat = place.location?.latitude;
    const lng = place.location?.longitude;
    if (id === null || name === null || typeof lat !== "number" || typeof lng !== "number") continue;
    const location = { lat, lng };
    if (!isValidLatLng(location) || !inBounds(location, bounds)) continue;
    if (found.some((other) => other.id === id)) continue;
    found.push({ id, name, address, location });
    if (found.length >= PLACE_SEARCH_RULES.maxResults) break;
  }
  return { ok: true, value: found };
}

/** 按关键字在城市附近搜地点。 */
export function searchPlaces(apiKey: string, request: PlaceSearchRequest, options: PlaceCallOptions): Promise<PlaceCallResult<PlaceCandidate[]>> {
  return call(apiKey, { url: options.url, method: "POST", fieldMask: PLACE_SEARCH_FIELD_MASK, body: placeSearchBody(request) }, (body) => parsePlaceSearch(body, request.bounds), options);
}

/** 反查的网址：`前缀/纬度,经度?languageCode=…&regionCode=…`（坐标是取整后的，不含密钥）。 */
export function reverseGeocodeUrl(base: string, point: LatLng, regionCode: string): string {
  const url = new URL(`${base.replace(/\/+$/, "")}/${point.lat},${point.lng}`);
  url.searchParams.set("languageCode", PLACE_LANGUAGE);
  url.searchParams.set("regionCode", regionCode);
  return url.toString();
}

/** 读反查的应答：`{ results: [{ formattedAddress }] }`，取第一条；没有 `results` 或空数组是这里没有地址（null）。 */
export function parseReverse(body: unknown): PlaceCallResult<string | null> {
  const results = (body as { results?: unknown }).results;
  if (results === undefined) return { ok: true, value: null };
  if (!Array.isArray(results)) return { ok: false, code: "UNEXPECTED" };
  for (const entry of results as unknown[]) {
    const address = cleanPlaceText((entry as { formattedAddress?: unknown } | null)?.formattedAddress, PLACE_SEARCH_RULES.addressMaxLength);
    if (address !== null) return { ok: true, value: address };
  }
  return { ok: true, value: null };
}

/** 查一个坐标的地址文字。 */
export function reverseGeocode(apiKey: string, point: LatLng, regionCode: string, options: PlaceCallOptions): Promise<PlaceCallResult<string | null>> {
  return call(apiKey, { url: reverseGeocodeUrl(options.url, point, regionCode), method: "GET", fieldMask: REVERSE_FIELD_MASK }, parseReverse, options);
}
