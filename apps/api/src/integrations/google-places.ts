/**
 * 外部服务：谷歌地图的地点搜索和坐标反查（M3-12，ADR 0044），给官网的地址输入用。浏览器从不直接连谷歌，密钥只在服务端。
 *
 * - 搜索：Places API (New) 的 Text Search（`POST places:searchText`）。只要 `places.id,places.displayName,places.formattedAddress,places.location,places.primaryType` 五个字段
 *   （字段掩码；`primaryType` 和名称同一档，M8-02 用它认机场），结果限制在城市中心周围的正方形里（`locationRestriction`；不带城市时是渠道授权的几个城市合起来的范围），
 *   最多 5 条，中文（`zh-CN`）。
 * - 输入即提示（M8-02，ADR 0069 B1）：Places API (New) 的 Autocomplete（`POST places:autocomplete`），带会话令牌，只要地点预测的 ID、名称和地址两段、类型；
 *   选中后取坐标用 Place Details（`GET places/{id}`，同一个会话令牌，只要 `id,formattedAddress,location,types`——Essentials 一档）。
 * - 反查：Geocoding API 的反查（`GET …/geocode/location/纬度,经度`），只要 `results.formattedAddress`。
 *
 * 安全处理和路线预估一样（ADR 0042）：地址只认配置（`GOOGLE_PLACES_SEARCH_URL`、`GOOGLE_GEOCODE_URL`，只有 local / ci 能改）；密钥只放请求头 `X-Goog-Api-Key`，
 * 不放网址；不跟随重定向；应答边读边截，只读前 64 KB；整次有时限，连不上、超时、5xx 在剩余时间够时再试 1 次，4xx（含 429）不重试；
 * 每次真正发请求之前问一次 `beforeAttempt`（每日调用上限），不允许就不发。
 * 永远不抛异常：结果是候选地点 / 地址，或原因代码（不带对方返回的原文）。
 */
import { type LatLng, type LatLngBounds, type PlaceCandidate, type PlaceFailureCode, type PlaceKind, type PlacePrediction, PLACE_SEARCH_RULES, cleanPlaceText, inBounds, isGooglePlaceId, isValidLatLng, placeKindOfGoogleTypes } from "@nozomi/domain";
import { GOOGLE_MAPS_ATTEMPTS, classifyCode, isTimeout, readCapped } from "./google-maps.ts";

/** 整次最多花多久（毫秒）：客人在页面上等着，但不像询价那样还要等别的 */
export const PLACE_BUDGET_MS = 3_000;
/** 每次尝试最多等多久（毫秒） */
export const PLACE_ATTEMPT_TIMEOUT_MS = 2_000;
/** 剩下的时间不到这么多就不再重试 */
const PLACE_MIN_RETRY_MS = 500;
/** 搜索要的字段（Text Search 的 Pro 一档；不多取电话、评分、营业时间等更贵的字段） */
export const PLACE_SEARCH_FIELD_MASK = "places.id,places.displayName,places.formattedAddress,places.location,places.primaryType";
/** 输入即提示要的字段：地点预测的 ID、名称和地址两段、类型（不要查询预测） */
export const PLACE_AUTOCOMPLETE_FIELD_MASK = "suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.text,suggestions.placePrediction.types";
/** 取坐标和类型要的字段：Place Details 的 Essentials 一档（名称用输入即提示给的，不多取更贵的 `displayName`） */
export const PLACE_DETAILS_FIELD_MASK = "id,formattedAddress,location,types";
/** 输入即提示的 `includedRegionCodes` 最多几个国家（谷歌的上限） */
export const AUTOCOMPLETE_MAX_REGIONS = 15;
/** 反查要的字段：只要地址文字 */
export const REVERSE_FIELD_MASK = "results.formattedAddress";
/** 结果的语言：官网是中文页面 */
export const PLACE_LANGUAGE = "zh-CN";

export type PlaceCallResult<T> = { ok: true; value: T } | { ok: false; code: PlaceFailureCode };

export interface PlaceCallOptions {
  /** 地址（配置 `integrationEndpoints.googlePlacesSearchUrl` / `googlePlacesAutocompleteUrl` / `googlePlaceDetailsUrl` / `googleGeocodeUrl`） */
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
  /** 只要这个范围里的结果（城市中心周围；不带城市时是几个城市合起来的外接矩形） */
  bounds: LatLngBounds;
  /** 城市所在的国家（ISO 3166-1 两位）；不带城市、授权了几个国家时为 null（不给谷歌） */
  regionCode: string | null;
  /** 范围里的结果再筛一遍（不带城市时：在不在某个城市的范围里）；不给就只看 `bounds` */
  accept?: (location: LatLng) => boolean;
}

/** Text Search 的请求体。 */
export function placeSearchBody(request: PlaceSearchRequest): string {
  return JSON.stringify({
    textQuery: request.query,
    languageCode: PLACE_LANGUAGE,
    ...(request.regionCode === null ? {} : { regionCode: request.regionCode }),
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
export function parsePlaceSearch(body: unknown, bounds: LatLngBounds, accept: (location: LatLng) => boolean = () => true): PlaceCallResult<PlaceCandidate[]> {
  const places = (body as { places?: unknown }).places;
  if (places === undefined) return { ok: true, value: [] };
  if (!Array.isArray(places)) return { ok: false, code: "UNEXPECTED" };
  const found: PlaceCandidate[] = [];
  for (const entry of places as unknown[]) {
    if (typeof entry !== "object" || entry === null) continue;
    const place = entry as { id?: unknown; displayName?: { text?: unknown } | null; formattedAddress?: unknown; location?: { latitude?: unknown; longitude?: unknown } | null; primaryType?: unknown };
    const id = isGooglePlaceId(place.id) ? place.id : null;
    const name = cleanPlaceText(place.displayName?.text, PLACE_SEARCH_RULES.nameMaxLength);
    const address = cleanPlaceText(place.formattedAddress, PLACE_SEARCH_RULES.addressMaxLength) ?? "";
    const lat = place.location?.latitude;
    const lng = place.location?.longitude;
    if (id === null || name === null || typeof lat !== "number" || typeof lng !== "number") continue;
    const location = { lat, lng };
    if (!isValidLatLng(location) || !inBounds(location, bounds) || !accept(location)) continue;
    if (found.some((other) => other.id === id)) continue;
    found.push({ id, name, address, location, kind: placeKindOfGoogleTypes(place.primaryType) });
    if (found.length >= PLACE_SEARCH_RULES.maxResults) break;
  }
  return { ok: true, value: found };
}

/** 按关键字在城市附近搜地点。 */
export function searchPlaces(apiKey: string, request: PlaceSearchRequest, options: PlaceCallOptions): Promise<PlaceCallResult<PlaceCandidate[]>> {
  return call(apiKey, { url: options.url, method: "POST", fieldMask: PLACE_SEARCH_FIELD_MASK, body: placeSearchBody(request) }, (body) => parsePlaceSearch(body, request.bounds, request.accept), options);
}

export interface PlaceAutocompleteRequest {
  /** 规范化过的关键字 */
  query: string;
  /** 浏览器给的会话令牌（一次「输入 → 选中」同一个，谷歌按会话计费） */
  sessionToken: string;
  /** 只要这几个国家的结果（渠道授权的城市所在的国家，最多 15 个） */
  regionCodes: readonly string[];
  /** 只要这个范围里的结果（渠道授权的几个城市合起来的外接矩形）；null = 不限 */
  bounds: LatLngBounds | null;
}

/** Autocomplete 的请求体。 */
export function placeAutocompleteBody(request: PlaceAutocompleteRequest): string {
  const regions = request.regionCodes.slice(0, AUTOCOMPLETE_MAX_REGIONS);
  return JSON.stringify({
    input: request.query,
    sessionToken: request.sessionToken,
    languageCode: PLACE_LANGUAGE,
    ...(regions.length === 0 ? {} : { includedRegionCodes: regions }),
    ...(request.bounds === null
      ? {}
      : { locationRestriction: { rectangle: { low: { latitude: request.bounds.low.lat, longitude: request.bounds.low.lng }, high: { latitude: request.bounds.high.lat, longitude: request.bounds.high.lng } } } }),
  });
}

/**
 * 读 Autocomplete 的应答：`{ suggestions: [{ placePrediction: { placeId, text: { text }, structuredFormat: { mainText: { text }, secondaryText: { text } }, types } }] }`；
 * 没有 `suggestions` 是没有候选。只要地点预测（查询预测 `queryPrediction` 丢掉）；缺 ID 或名称的丢掉；最多 5 条。`suggestions` 不是数组当作看不懂。
 */
export function parsePlaceAutocomplete(body: unknown): PlaceCallResult<PlacePrediction[]> {
  const suggestions = (body as { suggestions?: unknown }).suggestions;
  if (suggestions === undefined) return { ok: true, value: [] };
  if (!Array.isArray(suggestions)) return { ok: false, code: "UNEXPECTED" };
  const found: PlacePrediction[] = [];
  for (const entry of suggestions as unknown[]) {
    const prediction = (entry as { placePrediction?: unknown } | null)?.placePrediction as
      | { placeId?: unknown; text?: { text?: unknown } | null; structuredFormat?: { mainText?: { text?: unknown } | null; secondaryText?: { text?: unknown } | null } | null; types?: unknown }
      | null
      | undefined;
    if (typeof prediction !== "object" || prediction === null) continue;
    const id = isGooglePlaceId(prediction.placeId) ? prediction.placeId : null;
    const name = cleanPlaceText(prediction.structuredFormat?.mainText?.text, PLACE_SEARCH_RULES.nameMaxLength) ?? cleanPlaceText(prediction.text?.text, PLACE_SEARCH_RULES.nameMaxLength);
    const address = cleanPlaceText(prediction.structuredFormat?.secondaryText?.text, PLACE_SEARCH_RULES.addressMaxLength) ?? "";
    if (id === null || name === null || found.some((other) => other.id === id)) continue;
    found.push({ id, name, address, kind: placeKindOfGoogleTypes(undefined, prediction.types) });
    if (found.length >= PLACE_SEARCH_RULES.maxResults) break;
  }
  return { ok: true, value: found };
}

/** 输入即提示：按关键字给候选（还没有坐标）。 */
export function autocompletePlaces(apiKey: string, request: PlaceAutocompleteRequest, options: PlaceCallOptions): Promise<PlaceCallResult<PlacePrediction[]>> {
  return call(apiKey, { url: options.url, method: "POST", fieldMask: PLACE_AUTOCOMPLETE_FIELD_MASK, body: placeAutocompleteBody(request) }, parsePlaceAutocomplete, options);
}

/** 选中的地点的坐标、地址、类型（Place Details）。 */
export interface PlaceDetails {
  id: string;
  address: string;
  location: LatLng;
  kind: PlaceKind;
}

/** Place Details 的网址：`前缀/地点ID?languageCode=…&sessionToken=…`（地点 ID 已核对过格式；不含密钥）。 */
export function placeDetailsUrl(base: string, placeId: string, sessionToken: string | null): string {
  const url = new URL(`${base.replace(/\/+$/, "")}/${encodeURIComponent(placeId)}`);
  url.searchParams.set("languageCode", PLACE_LANGUAGE);
  if (sessionToken !== null) url.searchParams.set("sessionToken", sessionToken);
  return url.toString();
}

/** 读 Place Details 的应答：`{ id, formattedAddress, location: { latitude, longitude }, types }`。缺坐标或坐标不合法当作看不懂。 */
export function parsePlaceDetails(body: unknown, placeId: string): PlaceCallResult<PlaceDetails> {
  const place = body as { id?: unknown; formattedAddress?: unknown; location?: { latitude?: unknown; longitude?: unknown } | null; types?: unknown };
  const lat = place.location?.latitude;
  const lng = place.location?.longitude;
  if (typeof lat !== "number" || typeof lng !== "number" || !isValidLatLng({ lat, lng })) return { ok: false, code: "UNEXPECTED" };
  return { ok: true, value: { id: placeId, address: cleanPlaceText(place.formattedAddress, PLACE_SEARCH_RULES.addressMaxLength) ?? "", location: { lat, lng }, kind: placeKindOfGoogleTypes(undefined, place.types) } };
}

/** 取一个地点的坐标和类型（输入即提示选中之后，同一个会话令牌）。 */
export function placeDetails(apiKey: string, placeId: string, sessionToken: string | null, options: PlaceCallOptions): Promise<PlaceCallResult<PlaceDetails>> {
  return call(apiKey, { url: placeDetailsUrl(options.url, placeId, sessionToken), method: "GET", fieldMask: PLACE_DETAILS_FIELD_MASK }, (body) => parsePlaceDetails(body, placeId), options);
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
