/**
 * 统一的错误返回格式：`{ error: { code, message, details } }`。
 *
 * - 业务代码抛 AppError，接口层不自己拼错误响应。
 * - 未预期的异常一律变成 500 INTERNAL_ERROR，响应里不带任何内部信息（原始异常只进日志）。
 * - 这里只做「异常 → 响应」的换算，是纯函数；挂到 Fastify 上的动作在 app.ts。
 */

export type ErrorDetails = Record<string, unknown>;

export interface ErrorBody {
  error: { code: string; message: string; details: ErrorDetails };
}

export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details: ErrorDetails;
  constructor(statusCode: number, code: string, message: string, details: ErrorDetails = {}) {
    super(message);
    this.name = "AppError";
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export function errorBody(code: string, message: string, details: ErrorDetails = {}): ErrorBody {
  return { error: { code, message, details } };
}

/** 框架自身抛出的 4xx（请求体不是合法 JSON、请求体过大等）按状态码归类。 */
const CLIENT_ERRORS: Readonly<Record<number, { code: string; message: string }>> = {
  400: { code: "BAD_REQUEST", message: "请求格式不正确" },
  404: { code: "NOT_FOUND", message: "接口不存在" },
  405: { code: "METHOD_NOT_ALLOWED", message: "不支持的请求方法" },
  408: { code: "REQUEST_TIMEOUT", message: "请求发送超时" },
  413: { code: "PAYLOAD_TOO_LARGE", message: "请求体过大" },
  415: { code: "UNSUPPORTED_MEDIA_TYPE", message: "不支持的请求内容类型" },
  429: { code: "TOO_MANY_REQUESTS", message: "请求过于频繁" },
  431: { code: "REQUEST_HEADER_FIELDS_TOO_LARGE", message: "请求头过大" },
};

interface ValidationIssue {
  instancePath?: unknown;
  message?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * 数据库主动放弃了这个事务、重做一遍多半就能成功的报错：死锁（40P01）、序列化失败（40001）。
 * 事务已经整体回滚，什么都没有改动；这不是服务器故障，不能当成 500。
 */
export function isRetryableDbError(err: unknown): boolean {
  if (!isRecord(err)) return false;
  return err["code"] === "40P01" || err["code"] === "40001";
}

export interface ErrorResponse {
  statusCode: number;
  body: ErrorBody;
  /** 是否属于未预期的异常（需要按 error 级别记日志） */
  unexpected: boolean;
}

/** 把任意异常换算成对外的状态码和响应体。 */
export function toErrorResponse(err: unknown): ErrorResponse {
  if (err instanceof AppError) {
    return {
      statusCode: err.statusCode,
      body: errorBody(err.code, err.message, err.details),
      unexpected: err.statusCode >= 500,
    };
  }
  if (isRecord(err)) {
    if (Array.isArray(err["validation"])) {
      const issues = (err["validation"] as ValidationIssue[]).map((v) => ({
        path: typeof v.instancePath === "string" ? v.instancePath : "",
        message: typeof v.message === "string" ? v.message : "",
      }));
      const location = typeof err["validationContext"] === "string" ? err["validationContext"] : null;
      return {
        statusCode: 400,
        body: errorBody("VALIDATION_FAILED", "请求参数校验未通过", { location, issues }),
        unexpected: false,
      };
    }
    if (isRetryableDbError(err)) {
      return {
        statusCode: 409,
        body: errorBody("CONCURRENT_UPDATE", "这次操作和别人同时进行的修改撞上了，什么都没有改动，请重试"),
        unexpected: false,
      };
    }
    const statusCode = err["statusCode"];
    if (typeof statusCode === "number" && statusCode >= 400 && statusCode < 500) {
      const known = CLIENT_ERRORS[statusCode] ?? { code: "BAD_REQUEST", message: "请求无法处理" };
      return { statusCode, body: errorBody(known.code, known.message), unexpected: false };
    }
  }
  return {
    statusCode: 500,
    body: errorBody("INTERNAL_ERROR", "服务器内部错误，请稍后重试"),
    unexpected: true,
  };
}

const REASON_PHRASES: Readonly<Record<number, string>> = {
  400: "Bad Request",
  408: "Request Timeout",
  431: "Request Header Fields Too Large",
};

/**
 * 请求在 HTTP 解析阶段就被拒绝时（请求头过大、内容不是 HTTP、迟迟发不完请求），还没有路由和 reply 可用，
 * 只能直接往套接字写一段完整的 HTTP 应答。这里按解析器的错误码生成这段应答，响应体仍是统一错误格式。
 */
export function rawClientErrorResponse(parserErrorCode: string | null): string {
  const statusCode =
    parserErrorCode === "HPE_HEADER_OVERFLOW" ? 431 : parserErrorCode === "ERR_HTTP_REQUEST_TIMEOUT" ? 408 : 400;
  const body = JSON.stringify(toErrorResponse({ statusCode }).body);
  return [
    `HTTP/1.1 ${statusCode} ${REASON_PHRASES[statusCode]}`,
    "Content-Type: application/json; charset=utf-8",
    `Content-Length: ${Buffer.byteLength(body)}`,
    "Connection: close",
    "",
    body,
  ].join("\r\n");
}
