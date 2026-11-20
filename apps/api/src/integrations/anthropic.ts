/**
 * 外部服务：Claude（Anthropic API，ADR 0104 第六节）。M9T-31 只有运营后台的「测试一下」（`checkAnthropicKey`）；AI 行程解析（M9T-32）另写。
 *
 * 「测试一下」：
 * - 调用：模型列表 `GET /v1/models?limit=1`。不生成任何内容，**不产生 token 费用**；密钥无效、没权限时 Anthropic 照样返回 401 / 403，正好用来判断。
 *   不按某个型号查（型号还没定，ADR 0104 第二节【需业主决定】Q1），只看这把密钥能不能用。
 * - 密钥放在请求头 `x-api-key` 里，不放在网址里；带 `anthropic-version`；不跟随重定向。
 * - 每次尝试最多等 5 秒；连不上、超时、对方 5xx（含 529 过载）时再试 1 次。429 不重试。应答体只读前 64 KB。
 * - 失败换成 `IntegrationCheckCode`：按 HTTP 状态和 `error.type`（`authentication_error`、`permission_error`、`rate_limit_error`、`overloaded_error` 等）归类；
 *   说明是我们自己写的，不带对方返回的原文。
 *
 * 单元测试和集成测试都用本机的假服务器（地址由配置 `ANTHROPIC_MODELS_URL` 指定，只有 local / ci 能改），不联网。
 */
import { readCapped } from "./google-maps.ts";
import { type IntegrationCheckCode, type IntegrationCheckResult, checkFailed } from "./integration-check.ts";

export const ANTHROPIC_TIMEOUT_MS = 5_000;
export const ANTHROPIC_ATTEMPTS = 2;
/** Anthropic API 的版本请求头（所有接口都要带） */
export const ANTHROPIC_VERSION = "2023-06-01";

export interface AnthropicCheckOptions {
  /** 模型列表的地址（配置 `ANTHROPIC_MODELS_URL`，默认正式地址） */
  url: string;
  timeoutMs?: number;
  attempts?: number;
  /** 只给单元测试用的替身 */
  fetch?: typeof fetch;
}

/** Anthropic 错误应答里的 `error.type` */
function errorType(text: string): string | null {
  try {
    const body = JSON.parse(text) as { error?: { type?: unknown } };
    return typeof body.error?.type === "string" ? body.error.type : null;
  } catch {
    return null;
  }
}

/** Anthropic 的错误应答归类 */
export function classifyAnthropic(httpStatus: number, text: string): IntegrationCheckCode {
  const type = errorType(text);
  if (httpStatus === 401 || type === "authentication_error") return "KEY_INVALID";
  if (httpStatus === 403 || type === "permission_error") return "PERMISSION_DENIED";
  if (httpStatus === 429 || type === "rate_limit_error") return "QUOTA_EXCEEDED";
  if (httpStatus >= 500 || type === "overloaded_error" || type === "api_error") return "UNAVAILABLE";
  return "UNEXPECTED";
}

const isTimeout = (err: unknown): boolean => err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");

/** 用这把密钥查一次模型列表。永远不抛异常：结果就是「可用」或「不可用 + 原因」。 */
export async function checkAnthropicKey(apiKey: string, options: AnthropicCheckOptions): Promise<IntegrationCheckResult> {
  const doFetch = options.fetch ?? fetch;
  const attempts = options.attempts ?? ANTHROPIC_ATTEMPTS;
  const url = new URL(options.url);
  url.searchParams.set("limit", "1");
  let last: IntegrationCheckResult = checkFailed("UNREACHABLE");
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await doFetch(url, {
        method: "GET",
        headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION, accept: "application/json" },
        redirect: "manual",
        signal: AbortSignal.timeout(options.timeoutMs ?? ANTHROPIC_TIMEOUT_MS),
      });
      const text = await readCapped(res);
      if (res.status === 200) {
        try {
          const body = JSON.parse(text) as { data?: unknown };
          return Array.isArray(body.data) ? { ok: true } : checkFailed("UNEXPECTED");
        } catch {
          return checkFailed("UNEXPECTED");
        }
      }
      last = checkFailed(classifyAnthropic(res.status, text));
      if (res.status < 500) return last;
    } catch (err) {
      last = checkFailed(isTimeout(err) ? "TIMEOUT" : "UNREACHABLE");
    }
  }
  return last;
}
