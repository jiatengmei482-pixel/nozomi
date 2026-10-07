/**
 * 登录相关接口的客户端。
 *
 * - 一律用相对路径：前端和 API 同源部署，由反向代理按路径前缀分流。
 * - 失败只有两种：`ApiError`（后端给出了应答）和 `NetworkError`（没拿到应答：断网、超时）。
 * - 令牌由调用方传入，这里不读不写任何存储。
 */
import { PORTALS, type Portal } from "../lib/portal.ts";
import type { ChangePasswordRequest, ErrorBody, LoginRequest, PortalTypes, SetPasswordRequest } from "./types.ts";

/** 超过这个时间没有结果按网络错误处理（设计规范：10 秒）。 */
export const REQUEST_TIMEOUT_MS = 10_000;

export const AUTH_ENDPOINTS = {
  login: { method: "POST", path: "/auth/login" },
  logout: { method: "POST", path: "/auth/logout" },
  me: { method: "GET", path: "/auth/me" },
  acceptInvite: { method: "POST", path: "/auth/accept-invite" },
  resetPassword: { method: "POST", path: "/auth/reset-password" },
  changePassword: { method: "POST", path: "/auth/change-password" },
} as const;

export type AuthEndpoint = keyof typeof AUTH_ENDPOINTS;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;
  /** 429 时还要等多少秒（响应头 Retry-After）；后端没给时为 null */
  readonly retryAfterSeconds: number | null;

  constructor(status: number, code: string, message: string, details: Record<string, unknown>, retryAfterSeconds: number | null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class NetworkError extends Error {
  constructor() {
    super("网络连接失败");
    this.name = "NetworkError";
  }
}

/** Retry-After 可以是秒数，也可以是一个 HTTP 日期。 */
export function parseRetryAfter(header: string | null, now: Date): number | null {
  if (header === null) return null;
  const value = header.trim();
  if (/^\d+$/.test(value)) return Number(value);
  const at = Date.parse(value);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.ceil((at - now.getTime()) / 1000));
}

function isErrorBody(value: unknown): value is ErrorBody {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const error = (value as { error: unknown }).error;
  if (typeof error !== "object" || error === null) return false;
  const { code, message, details } = error as Record<string, unknown>;
  return typeof code === "string" && typeof message === "string" && typeof details === "object" && details !== null;
}

async function toApiError(response: Response): Promise<ApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const headerSeconds = parseRetryAfter(response.headers.get("retry-after"), new Date());
  if (!isErrorBody(body)) return new ApiError(response.status, "UNKNOWN", "", {}, headerSeconds);
  const fromDetails = body.error.details["retry_after_seconds"];
  const retryAfter = headerSeconds ?? (typeof fromDetails === "number" ? fromDetails : null);
  return new ApiError(response.status, body.error.code, body.error.message, body.error.details, retryAfter);
}

interface RequestOptions {
  body?: unknown;
  token?: string;
}

async function call<T>(portal: Portal, endpoint: AuthEndpoint, options: RequestOptions = {}): Promise<T> {
  const { method, path } = AUTH_ENDPOINTS[endpoint];
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.token !== undefined) headers["authorization"] = `Bearer ${options.token}`;

  // 超时覆盖到读完响应体为止：响应头到了、响应体卡住，同样算没拿到应答
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), REQUEST_TIMEOUT_MS);
  try {
    let response: Response;
    try {
      response = await fetch(`${PORTALS[portal].apiBase}${path}`, {
        method,
        headers,
        signal: abort.signal,
        cache: "no-store",
        credentials: "omit",
        ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      });
    } catch {
      throw new NetworkError();
    }

    if (!response.ok) {
      const failure = await toApiError(response);
      if (abort.signal.aborted) throw new NetworkError();
      throw failure;
    }
    if (response.status === 204) return undefined as T;
    try {
      return (await response.json()) as T;
    } catch {
      if (abort.signal.aborted) throw new NetworkError();
      throw malformedResponse();
    }
  } finally {
    clearTimeout(timer);
  }
}

/** 状态码是成功，内容却不是约定的样子：按服务端出错处理。 */
function malformedResponse(): ApiError {
  return new ApiError(502, "UNKNOWN", "", {}, null);
}

/** 登录应答必须带可用的令牌和合法的过期时间；否则不能当作登录成功。 */
function isLoginResponse(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const { access_token: accessToken, expires_at: expiresAt } = value as Record<string, unknown>;
  return typeof accessToken === "string" && accessToken !== "" && typeof expiresAt === "string" && !Number.isNaN(Date.parse(expiresAt));
}

export async function login<P extends Portal>(portal: P, request: LoginRequest): Promise<PortalTypes[P]["login"]> {
  const response = await call<PortalTypes[P]["login"]>(portal, "login", { body: request });
  if (!isLoginResponse(response)) throw malformedResponse();
  return response;
}

export function fetchMe<P extends Portal>(portal: P, token: string): Promise<PortalTypes[P]["me"]> {
  return call(portal, "me", { token });
}

export function logout(portal: Portal, token: string): Promise<void> {
  return call(portal, "logout", { token });
}

export function acceptInvite<P extends Portal>(portal: P, request: SetPasswordRequest): Promise<{ user: PortalTypes[P]["user"] }> {
  return call(portal, "acceptInvite", { body: request });
}

export function resetPassword<P extends Portal>(portal: P, request: SetPasswordRequest): Promise<{ user: PortalTypes[P]["user"] }> {
  return call(portal, "resetPassword", { body: request });
}

export function changePassword(portal: Portal, token: string, request: ChangePasswordRequest): Promise<void> {
  return call(portal, "changePassword", { token, body: request });
}
