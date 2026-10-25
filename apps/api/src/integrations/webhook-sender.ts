/**
 * 把推送真正发出去（M3-02，ADR 0027）：一次 HTTPS POST，带超时、限制应答大小、不跟随重定向，并防 SSRF。
 * 重试不在这里（由推送任务按退避排期，services/webhook-jobs.ts）；这里每次只发一次，结果归成清楚的错误码。
 *
 * 防 SSRF（接收地址是供应商自己填的，不能让它把平台的请求引到内网去）：
 * 1. 地址只认 https、不带账号密码、主机不是内网 / 回环 / 元数据地址或只在内网解析的名字（@nozomi/domain 的 `webhookUrlIssue`）；
 * 2. 发送前解析域名，**解析到的每一个地址**都必须是公网地址（有一个不是就整体拒绝），否则 `WEBHOOK_TARGET_FORBIDDEN`；
 * 3. 连接时只连第 2 步检查过的那个地址（自己提供 `lookup`），不再解析第二次——防「检查时是公网、连接时变成内网」的 DNS 重绑定；
 *    TLS 证书仍按域名校验（SNI 和 Host 都是原来的域名）；
 * 4. 不跟随重定向：3xx 一律算失败（`WEBHOOK_REDIRECT_NOT_FOLLOWED`），重定向的目标不检查也不访问；
 * 5. 总时限 5 秒（含解析、连接、TLS、等应答）；应答最多读 64 KB，只看状态码；不复用连接。
 *
 * `allowLocalTargets` 只给集成测试用（本机的假服务器是 http://127.0.0.1）：放行 http 和回环地址，其余检查不变。服务进程从不打开它。
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LookupFunction } from "node:net";
import { WEBHOOK_RULES, ipAddressAllowed, ipAddressClass, parseIpv4, webhookAccepted, webhookUrlIssue } from "@nozomi/domain";

export type WebhookErrorCode =
  /** 地址写得不对（只会出现在库里的旧数据上：保存时已经校验过） */
  | "WEBHOOK_URL_INVALID"
  /** 地址或解析到的地址是内网 / 回环 / 元数据地址，或不是 https */
  | "WEBHOOK_TARGET_FORBIDDEN"
  /** 域名解析不了 */
  | "WEBHOOK_DNS_FAILED"
  /** 连不上（拒绝连接、网络不通、连接被重置） */
  | "WEBHOOK_CONNECT_FAILED"
  /** TLS 握手失败（证书不对、过期、自签） */
  | "WEBHOOK_TLS_FAILED"
  /** 5 秒内没有应答 */
  | "WEBHOOK_TIMEOUT"
  /** 对方应答了，但状态码不是 2xx */
  | "WEBHOOK_HTTP_STATUS"
  /** 对方回了重定向：不跟随，算失败 */
  | "WEBHOOK_REDIRECT_NOT_FOLLOWED";

export interface WebhookRequest {
  url: string;
  body: string;
  headers: Record<string, string>;
}

export interface WebhookResult {
  /** 对方的状态码；没收到应答为 null */
  statusCode: number | null;
  /** 成功为 null */
  errorCode: WebhookErrorCode | null;
  durationMs: number;
  /** 目标主机（不含路径和查询串），记录用 */
  targetHost: string;
}

export interface WebhookSender {
  send(request: WebhookRequest): Promise<WebhookResult>;
}

export interface HttpsWebhookSenderOptions {
  timeoutMs?: number;
  maxResponseBytes?: number;
  /** 域名解析（测试替换）；默认系统解析，返回全部地址 */
  resolve?: (hostname: string) => Promise<string[]>;
  /** 只给集成测试：放行 http 和回环地址（本机的假服务器） */
  allowLocalTargets?: boolean;
}

class SendFailure extends Error {
  readonly code: WebhookErrorCode;
  constructor(code: WebhookErrorCode) {
    super(code);
    this.code = code;
  }
}

const TLS_ERROR = /^(ERR_TLS_|ERR_SSL_|CERT_|UNABLE_TO_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|HOSTNAME_MISMATCH|ERR_TLS_CERT_ALTNAME_INVALID)/;

function failureOf(err: unknown): WebhookErrorCode {
  if (err instanceof SendFailure) return err.code;
  const code = typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined;
  if (typeof code === "string") {
    if (code === "ENOTFOUND" || code === "EAI_AGAIN" || code === "ENODATA") return "WEBHOOK_DNS_FAILED";
    if (TLS_ERROR.test(code)) return "WEBHOOK_TLS_FAILED";
  }
  return "WEBHOOK_CONNECT_FAILED";
}

async function systemResolve(hostname: string): Promise<string[]> {
  const found = await dnsLookup(hostname, { all: true, verbatim: true });
  return found.map((entry) => entry.address);
}

export class HttpsWebhookSender implements WebhookSender {
  private readonly timeoutMs: number;
  private readonly maxResponseBytes: number;
  private readonly resolve: (hostname: string) => Promise<string[]>;
  private readonly allowLocal: boolean;

  constructor(options: HttpsWebhookSenderOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? WEBHOOK_RULES.timeoutMs;
    this.maxResponseBytes = options.maxResponseBytes ?? WEBHOOK_RULES.maxResponseBytes;
    this.resolve = options.resolve ?? systemResolve;
    this.allowLocal = options.allowLocalTargets === true;
  }

  /** 地址能不能连：公网地址；测试时另外放行回环。 */
  private addressAllowed(address: string): boolean {
    return ipAddressAllowed(address) || (this.allowLocal && ipAddressClass(address) === "loopback");
  }

  private checkUrl(raw: string): URL {
    if (!URL.canParse(raw)) throw new SendFailure("WEBHOOK_URL_INVALID");
    const url = new URL(raw);
    const local = this.allowLocal && url.protocol === "http:";
    const issue = webhookUrlIssue(local ? `https:${raw.slice("http:".length)}` : raw);
    if (local && (issue === null || (issue === "FORBIDDEN_HOST" && ipAddressClass(url.hostname) === "loopback"))) return url;
    if (issue === "INVALID_URL" || issue === "TOO_LONG" || issue === "HAS_FRAGMENT" || issue === "HAS_CREDENTIALS") throw new SendFailure("WEBHOOK_URL_INVALID");
    if (issue !== null) throw new SendFailure("WEBHOOK_TARGET_FORBIDDEN");
    return url;
  }

  async send(request: WebhookRequest): Promise<WebhookResult> {
    const started = Date.now();
    let targetHost = "";
    const deadline = started + this.timeoutMs;
    try {
      const url = this.checkUrl(request.url);
      targetHost = url.host;
      const hostname = url.hostname.replace(/^\[|\]$/g, "");
      const literal = parseIpv4(hostname) !== null || hostname.includes(":");
      const addresses = literal ? [hostname] : await withDeadline(this.resolve(hostname), deadline, "WEBHOOK_TIMEOUT").catch((err: unknown) => {
        throw err instanceof SendFailure ? err : new SendFailure("WEBHOOK_DNS_FAILED");
      });
      if (addresses.length === 0) throw new SendFailure("WEBHOOK_DNS_FAILED");
      if (!addresses.every((address) => this.addressAllowed(address))) throw new SendFailure("WEBHOOK_TARGET_FORBIDDEN");
      const pinned = addresses[0] as string;
      const statusCode = await this.post(url, pinned, request, deadline);
      const errorCode: WebhookErrorCode | null = webhookAccepted(statusCode) ? null : statusCode >= 300 && statusCode < 400 ? "WEBHOOK_REDIRECT_NOT_FOLLOWED" : "WEBHOOK_HTTP_STATUS";
      return { statusCode, errorCode, durationMs: Date.now() - started, targetHost };
    } catch (err) {
      return { statusCode: null, errorCode: failureOf(err), durationMs: Date.now() - started, targetHost };
    }
  }

  private post(url: URL, pinned: string, request: WebhookRequest, deadline: number): Promise<number> {
    const family = pinned.includes(":") ? 6 : 4;
    // 只连检查过的那个地址：Node 按 `all` 的不同要一个地址或一个列表
    const lookup = ((_hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
      if (options.all) callback(null, [{ address: pinned, family }]);
      else callback(null, pinned, family);
    }) as unknown as LookupFunction;
    const send = url.protocol === "https:" ? httpsRequest : httpRequest;
    const body = Buffer.from(request.body, "utf8");
    return new Promise<number>((resolve, reject) => {
      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };
      const req = send(
        {
          protocol: url.protocol,
          hostname: url.hostname.replace(/^\[|\]$/g, ""),
          port: url.port === "" ? undefined : Number(url.port),
          path: `${url.pathname}${url.search}`,
          method: "POST",
          headers: { ...request.headers, "content-length": String(body.length) },
          lookup,
          agent: false,
        },
        (res: IncomingMessage) => {
          const statusCode = res.statusCode ?? 0;
          let received = 0;
          res.on("data", (chunk: Buffer) => {
            received += chunk.length;
            // 只看状态码：内容读到上限就不再要了
            if (received > this.maxResponseBytes) {
              finish(() => resolve(statusCode));
              res.destroy();
            }
          });
          res.on("end", () => finish(() => resolve(statusCode)));
          res.on("error", () => finish(() => resolve(statusCode)));
        },
      );
      const timer = setTimeout(() => {
        finish(() => reject(new SendFailure("WEBHOOK_TIMEOUT")));
        req.destroy();
      }, Math.max(0, deadline - Date.now()));
      req.on("error", (err) => finish(() => reject(err)));
      req.end(body);
    });
  }
}

function withDeadline<T>(promise: Promise<T>, deadline: number, code: WebhookErrorCode): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new SendFailure(code)), Math.max(0, deadline - Date.now()));
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
