/**
 * 外部服务：谷歌地图（M4-09，ADR 0041；M2-02，ADR 0042）。两处用到：运营后台的「测试一下」（`checkGoogleMapsKey`）、报价的路线预估（`computeRoute`）。
 *
 * 「测试一下」：
 * - 调用：Routes API 的 computeRoutes，东京站 → 新宿站、驾车、不考虑实时路况，只要 `routes.distanceMeters` 一个字段——
 *   这是 Routes API 最便宜的一档（Essentials），每次测试只产生一次调用，费用极少（在谷歌每月的免费额度内基本不计费）。
 *   报价要用的「里程 + 时长」用的也是这个 API，所以测它最能说明密钥能不能用。
 * - 密钥放在请求头 `X-Goog-Api-Key` 里，不放在网址里（网址会进各种日志）；不跟随重定向。
 * - 每次尝试最多等 5 秒；连不上、超时、对方 5xx 时再试 1 次。429（超限）不重试。应答体边读边截，只读前 64 KB。
 * - 失败换成 `IntegrationCheckCode`：按谷歌返回的 `error.details[].reason`（`API_KEY_INVALID`、`SERVICE_DISABLED`、`API_KEY_SERVICE_BLOCKED`、`BILLING_DISABLED` 等）归类；
 *   说明是我们自己写的，不带谷歌返回的原文。
 *
 * 路线预估（`computeRoute`）：同一个 computeRoutes，驾车、不考虑实时路况（Essentials 一档），字段掩码只要 `routes.distanceMeters,routes.duration`。
 * 询价要等它，所以时限更短：整次最多 `ROUTE_BUDGET_MS`，每次尝试最多 `ROUTE_ATTEMPT_TIMEOUT_MS`；连不上、超时、5xx 在剩余时间够时再试 1 次。
 * 每次真正发请求之前问一次 `beforeAttempt`（每日调用上限，ADR 0042），不允许就不发。结果只有里程（米）、时长（秒）或原因代码，不带对方的原文。
 *
 * 单元测试和集成测试都用本机的假服务器（地址由配置 `GOOGLE_MAPS_ROUTES_URL` 指定，只有 local / ci 能改），不联网。
 */
import { type LatLng, type RouteFailureCode, routeValuesUsable } from "@nozomi/domain";
import { type IntegrationCheckCode, type IntegrationCheckResult, checkFailed } from "./integration-check.ts";

export const GOOGLE_MAPS_TIMEOUT_MS = 5_000;
export const GOOGLE_MAPS_ATTEMPTS = 2;
/** 应答正常不到 1 KB：最多读这么多字节，后面的不读（边读边截，不先把整个应答读进内存） */
export const MAX_RESPONSE_BYTES = 64 * 1024;

/** 读应答体的前 `MAX_RESPONSE_BYTES` 字节，够了就取消剩下的。 */
export async function readCapped(res: Response): Promise<string> {
  if (res.body === null) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < MAX_RESPONSE_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      const room = MAX_RESPONSE_BYTES - size;
      const chunk = value.byteLength > room ? value.subarray(0, room) : value;
      chunks.push(chunk);
      size += chunk.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** 测试用的固定路线：东京站 → 新宿站 */
const PROBE_BODY = JSON.stringify({
  origin: { location: { latLng: { latitude: 35.6812, longitude: 139.7671 } } },
  destination: { location: { latLng: { latitude: 35.6896, longitude: 139.7006 } } },
  travelMode: "DRIVE",
});

export interface GoogleMapsCheckOptions {
  /** computeRoutes 的地址（配置 `integrationEndpoints.googleMapsRoutesUrl`） */
  url: string;
  timeoutMs?: number;
  attempts?: number;
  /** 只给单元测试用的替身 */
  fetch?: typeof fetch;
}

/** 谷歌的错误应答里的原因代码（`error.details[].reason`）和状态（`error.status`）。 */
function errorReasons(text: string): { status: string | null; reasons: string[] } {
  try {
    const body = JSON.parse(text) as { error?: { status?: unknown; details?: unknown } };
    const details = Array.isArray(body.error?.details) ? (body.error.details as { reason?: unknown }[]) : [];
    return { status: typeof body.error?.status === "string" ? body.error.status : null, reasons: details.map((d) => (typeof d?.reason === "string" ? d.reason : "")).filter((r) => r !== "") };
  } catch {
    return { status: null, reasons: [] };
  }
}

/** 谷歌的错误应答归类（「测试一下」和路线预估共用）。 */
export function classifyCode(httpStatus: number, text: string): IntegrationCheckCode {
  const { status, reasons } = errorReasons(text);
  const has = (...names: string[]): boolean => names.some((name) => reasons.includes(name));
  if (has("API_KEY_INVALID", "API_KEY_EXPIRED") || httpStatus === 401) return "KEY_INVALID";
  if (has("SERVICE_DISABLED", "ACCESS_NOT_CONFIGURED")) return "API_NOT_ENABLED";
  if (has("API_KEY_SERVICE_BLOCKED", "API_KEY_HTTP_REFERRER_BLOCKED", "API_KEY_IP_ADDRESS_BLOCKED", "API_KEY_ANDROID_APP_BLOCKED", "API_KEY_IOS_APP_BLOCKED")) return "KEY_RESTRICTED";
  if (has("BILLING_DISABLED")) return "BILLING_DISABLED";
  if (httpStatus === 429 || has("RATE_LIMIT_EXCEEDED", "RESOURCE_EXHAUSTED") || status === "RESOURCE_EXHAUSTED") return "QUOTA_EXCEEDED";
  if (httpStatus === 403 || status === "PERMISSION_DENIED") return "PERMISSION_DENIED";
  if (httpStatus >= 500) return "UNAVAILABLE";
  return "UNEXPECTED";
}

function classify(httpStatus: number, text: string): IntegrationCheckResult {
  return checkFailed(classifyCode(httpStatus, text));
}

export function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

/** 用这把密钥调一次 Routes API。永远不抛异常：结果就是「可用」或「不可用 + 原因」。 */
export async function checkGoogleMapsKey(apiKey: string, options: GoogleMapsCheckOptions): Promise<IntegrationCheckResult> {
  const doFetch = options.fetch ?? fetch;
  const attempts = options.attempts ?? GOOGLE_MAPS_ATTEMPTS;
  let last: IntegrationCheckResult = checkFailed("UNREACHABLE");
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await doFetch(options.url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey, "x-goog-fieldmask": "routes.distanceMeters" },
        body: PROBE_BODY,
        redirect: "manual",
        signal: AbortSignal.timeout(options.timeoutMs ?? GOOGLE_MAPS_TIMEOUT_MS),
      });
      const text = await readCapped(res);
      if (res.status === 200) {
        try {
          const body = JSON.parse(text) as unknown;
          return typeof body === "object" && body !== null && !Array.isArray(body) ? { ok: true } : checkFailed("UNEXPECTED");
        } catch {
          return checkFailed("UNEXPECTED");
        }
      }
      last = classify(res.status, text);
      if (res.status < 500) return last;
    } catch (err) {
      last = checkFailed(isTimeout(err) ? "TIMEOUT" : "UNREACHABLE");
    }
  }
  return last;
}

// ---- 路线预估（M2-02，ADR 0042） ----

/** 整次路线预估最多花多久（毫秒）：报价这一层的兜底是 2 秒（`QUOTE_EXTERNAL_TIMEOUT_MS`），这里留出余量 */
export const ROUTE_BUDGET_MS = 1_600;
/** 每次尝试最多等多久（毫秒）。正常的应答一般在 300 毫秒以内 */
export const ROUTE_ATTEMPT_TIMEOUT_MS = 1_000;
/** 剩下的时间不到这么多就不再重试 */
const ROUTE_MIN_RETRY_MS = 300;
/** 路线预估要的字段：只要里程和时长（Essentials 一档，不多取任何字段） */
export const ROUTE_FIELD_MASK = "routes.distanceMeters,routes.duration";

export type ComputedRoute = { ok: true; meters: number; seconds: number } | { ok: false; code: RouteFailureCode };

export interface ComputeRouteOptions {
  /** computeRoutes 的地址（配置 `integrationEndpoints.googleMapsRoutesUrl`） */
  url: string;
  /** 每次真正发请求之前调用：返回 false 就不发（到了每日上限），结果是 `DAILY_LIMIT_REACHED` */
  beforeAttempt?: () => Promise<boolean>;
  budgetMs?: number;
  attemptTimeoutMs?: number;
  /** 只给单元测试用的替身 */
  fetch?: typeof fetch;
}

/** computeRoutes 的请求体：驾车、不考虑实时路况，不要备选路线。 */
export function routeRequestBody(from: LatLng, to: LatLng): string {
  return JSON.stringify({
    origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
    destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_UNAWARE",
    computeAlternativeRoutes: false,
  });
}

/**
 * 读成功的应答：`{ routes: [{ distanceMeters, duration: "123s" }] }`。
 * 谷歌的 JSON 省略取默认值的字段：没有 `distanceMeters` 是 0 米；没有 `routes`（空对象）是两点之间没有路线。
 */
function parseRoute(text: string): ComputedRoute {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return { ok: false, code: "UNEXPECTED" };
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, code: "UNEXPECTED" };
  const routes = (body as { routes?: unknown }).routes;
  if (routes === undefined || (Array.isArray(routes) && routes.length === 0)) return { ok: false, code: "NO_ROUTE" };
  if (!Array.isArray(routes)) return { ok: false, code: "UNEXPECTED" };
  const first = routes[0] as { distanceMeters?: unknown; duration?: unknown } | null;
  if (typeof first !== "object" || first === null) return { ok: false, code: "UNEXPECTED" };
  const meters = first.distanceMeters === undefined ? 0 : first.distanceMeters;
  const duration = typeof first.duration === "string" ? /^(\d{1,9})(?:\.\d{1,9})?s$/.exec(first.duration) : null;
  if (typeof meters !== "number" || duration === null) return { ok: false, code: "UNEXPECTED" };
  const seconds = Number(duration[1]);
  return routeValuesUsable(meters, seconds) ? { ok: true, meters, seconds } : { ok: false, code: "UNEXPECTED" };
}

/** 400 而又不是密钥的问题：谷歌认为请求的内容（起终点）无效。 */
function routeFailure(httpStatus: number, text: string): RouteFailureCode {
  const code = classifyCode(httpStatus, text);
  if (code === "UNEXPECTED" && httpStatus === 400) return "INVALID_POINTS";
  return code === "MODE_MISMATCH" ? "UNEXPECTED" : code;
}

/** 两点之间的驾车路线：里程（米）和时长（秒）。永远不抛异常：结果就是路线，或取不到的原因。 */
export async function computeRoute(apiKey: string, from: LatLng, to: LatLng, options: ComputeRouteOptions): Promise<ComputedRoute> {
  const doFetch = options.fetch ?? fetch;
  const deadline = performance.now() + (options.budgetMs ?? ROUTE_BUDGET_MS);
  const attemptTimeout = options.attemptTimeoutMs ?? ROUTE_ATTEMPT_TIMEOUT_MS;
  const body = routeRequestBody(from, to);
  let last: ComputedRoute = { ok: false, code: "UNREACHABLE" };
  for (let attempt = 1; attempt <= GOOGLE_MAPS_ATTEMPTS; attempt++) {
    const remaining = deadline - performance.now();
    if (attempt > 1 && remaining < ROUTE_MIN_RETRY_MS) break;
    if (options.beforeAttempt !== undefined && !(await options.beforeAttempt())) return attempt === 1 ? { ok: false, code: "DAILY_LIMIT_REACHED" } : last;
    try {
      const res = await doFetch(options.url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey, "x-goog-fieldmask": ROUTE_FIELD_MASK },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(Math.max(1, Math.floor(Math.min(attemptTimeout, deadline - performance.now())))),
      });
      const text = await readCapped(res);
      if (res.status === 200) return parseRoute(text);
      last = { ok: false, code: routeFailure(res.status, text) };
      if (res.status < 500) return last;
    } catch (err) {
      last = { ok: false, code: isTimeout(err) ? "TIMEOUT" : "UNREACHABLE" };
    }
  }
  return last;
}
