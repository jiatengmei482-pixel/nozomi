/**
 * 外部服务：谷歌地图（M4-09，ADR 0041）。现在只有运营后台的「测试一下」用到：验证一把密钥能不能调用 Routes API。
 *
 * - 调用：Routes API 的 computeRoutes，东京站 → 新宿站、驾车、不考虑实时路况，只要 `routes.distanceMeters` 一个字段——
 *   这是 Routes API 最便宜的一档（Essentials），每次测试只产生一次调用，费用极少（在谷歌每月的免费额度内基本不计费）。
 *   报价要用的「里程 + 时长」用的也是这个 API，所以测它最能说明密钥能不能用。
 * - 密钥放在请求头 `X-Goog-Api-Key` 里，不放在网址里（网址会进各种日志）；不跟随重定向。
 * - 每次尝试最多等 5 秒；连不上、超时、对方 5xx 时再试 1 次。429（超限）不重试。应答体边读边截，只读前 64 KB。
 * - 失败换成 `IntegrationCheckCode`：按谷歌返回的 `error.details[].reason`（`API_KEY_INVALID`、`SERVICE_DISABLED`、`API_KEY_SERVICE_BLOCKED`、`BILLING_DISABLED` 等）归类；
 *   说明是我们自己写的，不带谷歌返回的原文。
 * 单元测试和集成测试都用本机的假服务器（地址由配置 `GOOGLE_MAPS_ROUTES_URL` 指定，只有 local / ci 能改），不联网。
 */
import { type IntegrationCheckResult, checkFailed } from "./integration-check.ts";

export const GOOGLE_MAPS_TIMEOUT_MS = 5_000;
export const GOOGLE_MAPS_ATTEMPTS = 2;
/** 应答正常不到 1 KB：最多读这么多字节，后面的不读（边读边截，不先把整个应答读进内存） */
export const MAX_RESPONSE_BYTES = 64 * 1024;

/** 读应答体的前 `MAX_RESPONSE_BYTES` 字节，够了就取消剩下的。 */
async function readCapped(res: Response): Promise<string> {
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

function classify(httpStatus: number, text: string): IntegrationCheckResult {
  const { status, reasons } = errorReasons(text);
  const has = (...names: string[]): boolean => names.some((name) => reasons.includes(name));
  if (has("API_KEY_INVALID", "API_KEY_EXPIRED") || httpStatus === 401) return checkFailed("KEY_INVALID");
  if (has("SERVICE_DISABLED", "ACCESS_NOT_CONFIGURED")) return checkFailed("API_NOT_ENABLED");
  if (has("API_KEY_SERVICE_BLOCKED", "API_KEY_HTTP_REFERRER_BLOCKED", "API_KEY_IP_ADDRESS_BLOCKED", "API_KEY_ANDROID_APP_BLOCKED", "API_KEY_IOS_APP_BLOCKED")) return checkFailed("KEY_RESTRICTED");
  if (has("BILLING_DISABLED")) return checkFailed("BILLING_DISABLED");
  if (httpStatus === 429 || has("RATE_LIMIT_EXCEEDED", "RESOURCE_EXHAUSTED") || status === "RESOURCE_EXHAUSTED") return checkFailed("QUOTA_EXCEEDED");
  if (httpStatus === 403 || status === "PERMISSION_DENIED") return checkFailed("PERMISSION_DENIED");
  if (httpStatus >= 500) return checkFailed("UNAVAILABLE");
  return checkFailed("UNEXPECTED");
}

function isTimeout(err: unknown): boolean {
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
