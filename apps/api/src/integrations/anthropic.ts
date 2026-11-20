/**
 * 外部服务：Claude（Anthropic API，ADR 0104 第六节）。运营后台的「测试一下」（`checkAnthropicKey`，M9T-31）和 AI 行程解析的调用（`createClaudeJsonCaller`，M9T-32）。
 *
 * 「测试一下」：
 * - 调用：模型列表 `GET /v1/models?limit=1`。不生成任何内容，**不产生 token 费用**；密钥无效、没权限时 Anthropic 照样返回 401 / 403，正好用来判断。
 *   不按某个型号查（型号还没定，ADR 0104 第二节【需业主决定】Q1），只看这把密钥能不能用。
 * - 密钥放在请求头 `x-api-key` 里，不放在网址里；带 `anthropic-version`；不跟随重定向。（解析调用走官方 SDK，SDK 1.x 放在 `Authorization: Bearer` 里，同样不在网址里。）
 * - 每次尝试最多等 5 秒；连不上、超时、对方 5xx（含 529 过载）时再试 1 次。429 不重试。应答体只读前 64 KB。
 * - 失败换成 `IntegrationCheckCode`：按 HTTP 状态和 `error.type`（`authentication_error`、`permission_error`、`rate_limit_error`、`overloaded_error` 等）归类；
 *   说明是我们自己写的，不带对方返回的原文。
 *
 * 单元测试和集成测试都用本机的假服务器（地址由配置 `ANTHROPIC_MODELS_URL` 指定，只有 local / ci 能改），不联网。
 */
import Anthropic from "@anthropic-ai/sdk";
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

// ---------- AI 一句话行程：调 Claude 拿结构化 JSON（M9T-32，ADR 0104 第四节第 2 小节） ----------

/** 一次结构化输出请求。系统提示字节不变（进缓存）；今天的日期和客人的话放在用户消息里。 */
export interface ClaudeJsonRequest {
  model: string;
  system: string;
  user: string;
  schema: Record<string, unknown>;
  maxTokens: number;
  timeoutMs: number;
}

export interface ClaudeUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
}

/**
 * 结果：`ok` 时 `text` 是模型给的 JSON 文字（结构由调用方再用 zod 校验）。
 * 失败只给归类，不带对方返回的原文（可能回显客人的话，ADR 0104 第九节）：
 * `refused`（安全分类器拒答）、`max_tokens`（到了上限，不用半截结果）、`timeout`、`model_unavailable`（型号不存在 / 没权限用）、`error`（其余）。
 */
export type ClaudeJsonResult =
  | { ok: true; text: string; usage: ClaudeUsage }
  | { ok: false; failure: "refused" | "max_tokens" | "timeout" | "model_unavailable" | "error"; usage: ClaudeUsage | null; httpStatus: number | null };

export type ClaudeJsonCaller = (apiKey: string, request: ClaudeJsonRequest) => Promise<ClaudeJsonResult>;

const usageOf = (usage: Anthropic.Usage): ClaudeUsage => ({ inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, cacheReadTokens: usage.cache_read_input_tokens ?? 0 });

/**
 * 用官方 SDK 调 `POST /v1/messages`。`baseURL` 是配置 `ANTHROPIC_API_URL`（只有 local / ci 能改到本机的假服务器）。
 * - `effort: low` + 结构化输出 `output_config.format`；不传 `thinking`（两个型号默认自适应）、不传采样参数；
 * - 系统提示加 `cache_control`；SDK 自带重试 1 次（只重试 429 / 5xx / 断线）；超时按请求给。
 * 每把密钥一个 SDK 客户端，换了密钥下一次就用新的。
 */
export function createClaudeJsonCaller(baseURL: string): ClaudeJsonCaller {
  let cached: { apiKey: string; client: Anthropic } | null = null;
  const clientFor = (apiKey: string): Anthropic => {
    if (cached?.apiKey !== apiKey) cached = { apiKey, client: new Anthropic({ apiKey, baseURL, maxRetries: 1 }) };
    return cached.client;
  };
  return async (apiKey, request) => {
    try {
      const response = await clientFor(apiKey).messages.create(
        {
          model: request.model,
          max_tokens: request.maxTokens,
          system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
          messages: [{ role: "user", content: request.user }],
          output_config: { effort: "low", format: { type: "json_schema", schema: request.schema } },
        },
        { timeout: request.timeoutMs },
      );
      const usage = usageOf(response.usage);
      if (response.stop_reason === "refusal") return { ok: false, failure: "refused", usage, httpStatus: 200 };
      if (response.stop_reason === "max_tokens" || response.stop_reason === "model_context_window_exceeded") return { ok: false, failure: "max_tokens", usage, httpStatus: 200 };
      const text = response.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
      return { ok: true, text, usage };
    } catch (err) {
      if (err instanceof Anthropic.APIConnectionTimeoutError) return { ok: false, failure: "timeout", usage: null, httpStatus: null };
      if (err instanceof Anthropic.NotFoundError || err instanceof Anthropic.PermissionDeniedError) return { ok: false, failure: "model_unavailable", usage: null, httpStatus: err.status };
      if (err instanceof Anthropic.APIError) return { ok: false, failure: "error", usage: null, httpStatus: typeof err.status === "number" ? err.status : null };
      return { ok: false, failure: "error", usage: null, httpStatus: null };
    }
  };
}
