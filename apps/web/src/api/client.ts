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

export interface RequestOptions {
  body?: unknown;
  token?: string;
  /** 额外的请求头（例如修改主数据时的 If-Match） */
  headers?: Readonly<Record<string, string>>;
}

function call<T>(portal: Portal, endpoint: AuthEndpoint, options: RequestOptions = {}): Promise<T> {
  const { method, path } = AUTH_ENDPOINTS[endpoint];
  return apiRequest<T>(method, `${PORTALS[portal].apiBase}${path}`, options);
}

/**
 * 所有接口共用的请求函数：相对路径、JSON、10 秒超时（覆盖到读完响应体）、不带 Cookie。
 * `url` 必须是站内的相对路径。
 */
export async function apiRequest<T>(method: string, url: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json", ...options.headers };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.token !== undefined) headers["authorization"] = `Bearer ${options.token}`;

  // 超时覆盖到读完响应体为止：响应头到了、响应体卡住，同样算没拿到应答
  const sent = await send(method, url, { headers, body: options.body !== undefined ? JSON.stringify(options.body) : null, timeoutMs: REQUEST_TIMEOUT_MS });
  try {
    const { response } = sent;
    if (!response.ok) {
      const failure = await toApiError(response);
      if (sent.aborted()) throw new NetworkError();
      throw failure;
    }
    if (response.status === 204) return undefined as T;
    try {
      return (await response.json()) as T;
    } catch {
      if (sent.aborted()) throw new NetworkError();
      throw malformedResponse();
    }
  } finally {
    sent.done();
  }
}

interface Sent {
  response: Response;
  /** 读完响应体以后调用：停掉超时 */
  done(): void;
  /** 请求已经被中止（超时，或用户取消） */
  aborted(): boolean;
  timedOut(): boolean;
}

/**
 * 唯一发请求的地方：相对路径、不带 Cookie、不走缓存、带超时。连不上、超时抛 NetworkError；用户自己取消抛 CancelledError。
 */
async function send(method: string, url: string, init: { headers: Record<string, string>; body: BodyInit | null; timeoutMs: number; signal?: AbortSignal | undefined }): Promise<Sent> {
  const abort = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    abort.abort();
  }, init.timeoutMs);
  const cancel = (): void => abort.abort();
  init.signal?.addEventListener("abort", cancel);
  const done = (): void => {
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", cancel);
  };
  try {
    const response = await fetch(url, { method, headers: init.headers, signal: abort.signal, cache: "no-store", credentials: "omit", ...(init.body !== null ? { body: init.body } : {}) });
    return { response, done, aborted: () => abort.signal.aborted, timedOut: () => timedOut };
  } catch {
    done();
    throw init.signal?.aborted === true && !timedOut ? new CancelledError() : new NetworkError();
  }
}

/** 用户自己取消的请求：不算出错。 */
export class CancelledError extends Error {
  constructor() {
    super("cancelled");
    this.name = "CancelledError";
  }
}

/** 状态码是成功，内容却不是约定的样子：按服务端出错处理。 */
function malformedResponse(): ApiError {
  return new ApiError(502, "UNKNOWN", "", {}, null);
}

/** 登录应答必须带可用的令牌、合法的过期时间和「是否必须先改密码」；否则不能当作登录成功。 */
function isLoginResponse(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const { access_token: accessToken, expires_at: expiresAt, must_change_password: mustChangePassword } = value as Record<string, unknown>;
  return (
    typeof accessToken === "string" &&
    accessToken !== "" &&
    typeof expiresAt === "string" &&
    !Number.isNaN(Date.parse(expiresAt)) &&
    typeof mustChangePassword === "boolean"
  );
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

// ───────────── 文件：上传 .xlsx、下载导出的文件 ─────────────

export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
/** 上传和下载文件给的时间比普通请求长（文件最大 1 MB，正常几秒内完成）。 */
export const FILE_TIMEOUT_MS = 30_000;

export interface FileRequestOptions {
  token: string;
  headers?: Readonly<Record<string, string>>;
  /** 用户点了「取消」 */
  signal?: AbortSignal;
}

function fileFetch(method: string, url: string, body: Blob | null, accept: string, options: FileRequestOptions): Promise<Sent> {
  return send(method, url, { headers: { accept, authorization: `Bearer ${options.token}`, ...(body !== null ? { "content-type": XLSX_CONTENT_TYPE } : {}), ...options.headers }, body, timeoutMs: FILE_TIMEOUT_MS, signal: options.signal });
}

/** 把一个文件原样传上去（请求体就是文件本身），应答是 JSON。令牌只走请求头。 */
export async function apiUpload<T>(url: string, file: Blob, options: FileRequestOptions): Promise<T> {
  const { response, done, timedOut } = await fileFetch("POST", url, file, "application/json", options);
  try {
    if (!response.ok) throw await toApiError(response);
    return (await response.json()) as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw options.signal?.aborted === true && !timedOut() ? new CancelledError() : timedOut() ? new NetworkError() : malformedResponse();
  } finally {
    done();
  }
}

export interface DownloadedFile {
  blob: Blob;
  /** 应答头里的文件名；没有时是 null */
  filename: string | null;
}

/** `Content-Disposition` 里的文件名：先认 `filename*=UTF-8''…`，再认 `filename="…"`。 */
export function parseFilename(header: string | null): string | null {
  if (header === null) return null;
  const encoded = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (encoded?.[1]) {
    try {
      return decodeURIComponent(encoded[1].trim());
    } catch {
      return null;
    }
  }
  const plain = /filename\s*=\s*"([^"]+)"/i.exec(header) ?? /filename\s*=\s*([^;]+)/i.exec(header);
  return plain?.[1]?.trim() ?? null;
}

/** 取回一个要下载的文件。失败时接口返回的是 JSON 的错误格式；状态是成功、拿到的却不是文件，同样按出错处理。 */
export async function apiDownload(url: string, options: FileRequestOptions): Promise<DownloadedFile> {
  const { response, done, timedOut } = await fileFetch("GET", url, null, `${XLSX_CONTENT_TYPE}, application/json`, options);
  try {
    if (!response.ok) throw await toApiError(response);
    if ((response.headers.get("content-type") ?? "").includes("application/json")) throw malformedResponse();
    return { blob: await response.blob(), filename: parseFilename(response.headers.get("content-disposition")) };
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw timedOut() ? new NetworkError() : malformedResponse();
  } finally {
    done();
  }
}
