/**
 * 日志的脱敏规则（规则 5：日志里不能出现密钥原文）。三道防线，互不依赖：
 *
 * 1. 请求日志只记方法和路径：不记查询串（可能带令牌）、请求头、请求体。
 * 2. 异常只记类型、错误码、说明和调用栈，其余字段一律丢弃
 *    （例如 `new URL()` 抛出的异常带 `input` 字段，里面就是完整的连接串）。
 * 3. 记下来的文字再过一遍：凡是 `协议://…` 形式的内容，以及当前配置里的每一个密钥原文，都替换掉。
 *
 * 这里全是纯函数；挂到 Fastify 上的动作在 app.ts。
 */
import type { AppConfig } from "@nozomi/config";

export const REDACTED = "[已隐藏]";

/**
 * `协议://` 之后直到空白或引号为止的内容：连接串、带凭证的网址都长这样。
 * `file://` 除外：那是调用栈里的源码路径，抹掉就没法排查了。
 */
const URL_LIKE = /\b(?!file:\/\/)([a-z][a-z0-9+.-]*:\/\/)[^\s"'`<>]+/gi;

/** 短于这个长度的值不做原文替换：太短的串会误伤正常日志，而且配置校验保证真正的密钥都比它长。 */
const MIN_SECRET_LENGTH = 8;

/** 当前配置里所有不能进日志的原文：各密钥、数据库连接串及其中的密码（原样和解码后各一份）。 */
export function secretValues(config: AppConfig): string[] {
  const values = [
    config.databaseUrl,
    config.authJwtSecret,
    config.stripe?.secretKey,
    config.stripe?.webhookSecret,
    config.googleMapsApiKey,
  ];
  if (URL.canParse(config.databaseUrl)) {
    const url = new URL(config.databaseUrl);
    values.push(url.password, decodeURIComponentSafe(url.password), url.searchParams.get("password"));
  }
  const unique = new Set(values.filter((v): v is string => typeof v === "string" && v.length >= MIN_SECRET_LENGTH));
  return [...unique].sort((a, b) => b.length - a.length);
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** 把文字里的密钥原文和 `协议://…` 内容替换掉。 */
export function redactText(text: string, secrets: readonly string[]): string {
  let result = text;
  for (const secret of secrets) result = result.replaceAll(secret, REDACTED);
  return result.replace(URL_LIKE, `$1${REDACTED}`);
}

export type LoggedError = {
  type: string;
  code: string | null;
  message: string;
  stack: string;
};

/** 异常的日志形态：只留四个字段，文字部分全部过一遍脱敏。 */
export function serializeError(err: unknown, secrets: readonly string[]): LoggedError {
  if (typeof err !== "object" || err === null) {
    return { type: typeof err, code: null, message: redactText(String(err), secrets), stack: "" };
  }
  const record = err as { name?: unknown; code?: unknown; message?: unknown; stack?: unknown };
  return {
    type: typeof record.name === "string" ? record.name : "Error",
    code: typeof record.code === "string" ? redactText(record.code, secrets) : null,
    message: typeof record.message === "string" ? redactText(record.message, secrets) : "",
    stack: typeof record.stack === "string" ? redactText(record.stack, secrets) : "",
  };
}

/** 去掉查询串和片段，只留路径。 */
export function pathOnly(url: string): string {
  const end = url.search(/[?#]/);
  return end === -1 ? url : url.slice(0, end);
}

export type LoggedRequest = {
  method: string;
  path: string;
  /** 来源地址；拿不到时为空串 */
  remoteAddress: string;
};

/** 请求的日志形态：方法、路径（不含查询串）、来源地址。 */
export function serializeRequest(request: { method?: string; url?: string; ip?: string }): LoggedRequest {
  return {
    method: request.method ?? "",
    path: pathOnly(request.url ?? ""),
    remoteAddress: request.ip ?? "",
  };
}
