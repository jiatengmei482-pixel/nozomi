/**
 * 外部服务：谷歌 Maps Static API（官网路线小地图，M8-10，ADR 0072）。后端代调，密钥不进浏览器。
 *
 * - 请求：`GET <GOOGLE_STATIC_MAPS_URL>?<参数>&key=<密钥>`。参数由 domain 的 `staticMapQuery` 生成（尺寸、样式、路线、标记，不含密钥）；
 *   这个 API 只认网址里的 `key`，所以密钥只出现在发给谷歌的这一个网址里——这个网址不进日志、不进错误、不进返回值（结果只有图或原因代码）。
 * - 不跟随重定向（3xx 当作看不懂）；整次最多 `STATIC_MAP_BUDGET_MS`，每次尝试最多 `STATIC_MAP_ATTEMPT_TIMEOUT_MS`；
 *   连不上、超时、5xx 在剩余时间够时再试 1 次，4xx（含 429）不重试。每次真正发请求之前问一次 `beforeAttempt`（每日调用上限），不允许就不发。
 * - 成功：200、`content-type` 是图片、内容开头确实是 PNG / JPEG / GIF，边读边数，超过 `STATIC_MAP_RULES.maxImageBytes` 就停（`IMAGE_TOO_LARGE`）。
 * - 失败：谷歌的错误应答是一句英文（如「This API is not activated on your API project」「API keys with referer restrictions cannot be used with this API」），
 *   只读前 64 KB、只用来归类成原因代码，原文（谷歌有时回显密钥）不往任何地方转述。
 *
 * 单元测试和集成测试都用本机的假服务器（地址由配置 `GOOGLE_STATIC_MAPS_URL` 指定，只有 local / ci 能改），不联网。
 */
import { STATIC_MAP_RULES, type StaticMapFailureCode } from "@nozomi/domain";
import { MAX_RESPONSE_BYTES, classifyCode, isTimeout } from "./google-maps.ts";

/** 整次最多花多久（毫秒）：页面在等这张图，但不在询价的路上，可以比路线预估宽一些 */
export const STATIC_MAP_BUDGET_MS = 5_000;
/** 每次尝试最多等多久（毫秒） */
export const STATIC_MAP_ATTEMPT_TIMEOUT_MS = 3_000;
/** 剩下的时间不到这么多就不再重试 */
const STATIC_MAP_MIN_RETRY_MS = 500;
const ATTEMPTS = 2;

export type StaticMapImageType = "image/png" | "image/jpeg" | "image/gif";

export type StaticMapFetchResult = { ok: true; contentType: StaticMapImageType; image: Buffer } | { ok: false; code: StaticMapFailureCode };

export interface StaticMapFetchOptions {
  /** Maps Static API 的地址（配置 `integrationEndpoints.googleStaticMapsUrl`） */
  url: string;
  /** 每次真正发请求之前调用：返回 false 就不发（到了每日上限），结果是 `DAILY_LIMIT_REACHED` */
  beforeAttempt?: () => Promise<boolean>;
  budgetMs?: number;
  attemptTimeoutMs?: number;
  /** 图最大多少字节；不给用 `STATIC_MAP_RULES.maxImageBytes` */
  maxBytes?: number;
  /** 只给单元测试用的替身 */
  fetch?: typeof fetch;
}

/** 读应答体，最多 `max` 字节；超过就停下、取消剩下的（`overflow`）。 */
async function readBytes(res: Response, max: number): Promise<{ bytes: Buffer; overflow: boolean }> {
  if (res.body === null) return { bytes: Buffer.alloc(0), overflow: false };
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let overflow = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.byteLength > max) {
        overflow = true;
        break;
      }
      chunks.push(value);
      size += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return { bytes: Buffer.concat(chunks), overflow };
}

/** 按内容开头的几个字节认图片类型（不信应答头）：PNG、JPEG、GIF；都不是为 null。 */
export function sniffImageType(bytes: Uint8Array): StaticMapImageType | null {
  const starts = (...sig: number[]): boolean => bytes.length >= sig.length && sig.every((byte, i) => bytes[i] === byte);
  if (starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (starts(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (starts(0x47, 0x49, 0x46, 0x38, 0x37, 0x61) || starts(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)) return "image/gif";
  return null;
}

/**
 * 谷歌静态地图的错误应答归类。它一般回一句纯文本；也兼容谷歌通用的 JSON 错误（`error.details[].reason`）。
 * 「没开通」「项目不允许用这个 API」「密钥无效」「密钥限制（referer、IP）」「没绑卡」「配额」各自一类；其余 403 是没权限，5xx 是对方出错。
 */
export function classifyStaticMapError(httpStatus: number, text: string): StaticMapFailureCode {
  const generic = classifyCode(httpStatus, text);
  if (generic !== "UNEXPECTED" && generic !== "PERMISSION_DENIED" && generic !== "MODE_MISMATCH" && generic !== "UNAVAILABLE" && generic !== "QUOTA_EXCEEDED") return generic;
  const message = text.toLowerCase();
  const has = (...phrases: string[]): boolean => phrases.some((phrase) => message.includes(phrase));
  if (has("api key is invalid", "invalid api key", "api key expired", "api_key_invalid", "key is not valid")) return "KEY_INVALID";
  if (has("not activated", "not been used in project", "is disabled", "service_disabled", "project is not authorized to use this api")) return "API_NOT_ENABLED";
  if (has("referer", "referrer", "not authorized to use this api key", "ip, site or mobile application", "api_key_service_blocked", "not authorized to use this service or api")) return "KEY_RESTRICTED";
  if (has("billing")) return "BILLING_DISABLED";
  if (httpStatus === 429 || has("quota", "rate-limit", "rate limit", "resource_exhausted")) return "QUOTA_EXCEEDED";
  if (httpStatus === 401) return "KEY_INVALID";
  if (httpStatus === 403) return "PERMISSION_DENIED";
  if (httpStatus >= 500) return "UNAVAILABLE";
  return "UNEXPECTED";
}

/**
 * 取一张静态地图。`query` 是 domain 的 `staticMapQuery` 生成的参数（不含密钥），密钥在这里接到最后。
 * 永远不抛异常：结果就是图（类型和字节），或取不到的原因代码。
 */
export async function fetchStaticMap(apiKey: string, query: string, options: StaticMapFetchOptions): Promise<StaticMapFetchResult> {
  const doFetch = options.fetch ?? fetch;
  const deadline = performance.now() + (options.budgetMs ?? STATIC_MAP_BUDGET_MS);
  const attemptTimeout = options.attemptTimeoutMs ?? STATIC_MAP_ATTEMPT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? STATIC_MAP_RULES.maxImageBytes;
  const target = `${options.url}?${query}&key=${encodeURIComponent(apiKey)}`;
  let last: StaticMapFetchResult = { ok: false, code: "UNREACHABLE" };
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const remaining = deadline - performance.now();
    if (attempt > 1 && remaining < STATIC_MAP_MIN_RETRY_MS) break;
    if (options.beforeAttempt !== undefined && !(await options.beforeAttempt())) return attempt === 1 ? { ok: false, code: "DAILY_LIMIT_REACHED" } : last;
    try {
      const res = await doFetch(target, {
        method: "GET",
        headers: { accept: "image/png,image/*;q=0.8" },
        redirect: "manual",
        signal: AbortSignal.timeout(Math.max(1, Math.floor(Math.min(attemptTimeout, deadline - performance.now())))),
      });
      if (res.status === 200) {
        const { bytes, overflow } = await readBytes(res, maxBytes);
        if (overflow) return { ok: false, code: "IMAGE_TOO_LARGE" };
        const type = sniffImageType(bytes);
        const declared = (res.headers.get("content-type") ?? "").toLowerCase();
        if (type === null || !declared.startsWith("image/")) return { ok: false, code: "UNEXPECTED" };
        return { ok: true, contentType: type, image: bytes };
      }
      const { bytes } = await readBytes(res, MAX_RESPONSE_BYTES);
      if (res.status >= 300 && res.status < 400) return { ok: false, code: "UNEXPECTED" };
      last = { ok: false, code: classifyStaticMapError(res.status, bytes.toString("utf8")) };
      if (res.status < 500) return last;
    } catch (err) {
      last = { ok: false, code: isTimeout(err) ? "TIMEOUT" : "UNREACHABLE" };
    }
  }
  return last;
}
