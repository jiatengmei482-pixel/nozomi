/**
 * 下载公开数据文件的共用部分（机场数据 OurAirports、城市数据 GeoNames 都用它）：
 * 每次尝试有总时限、对「暂时不可用」有限次数地重试、边读边检查大小（超限立即中止）。不需要任何密钥。
 * 各数据源的模块把这里的失败换成自己的错误码。单元测试里用替身 `fetch`，不联网。
 */
import { setTimeout as sleep } from "node:timers/promises";

export type PublicFileFailure =
  /** 在时限内没有下载完 */
  | "TIMEOUT"
  /** 连不上，或对方暂时出错（5xx、429）；已经重试过 */
  | "UNAVAILABLE"
  /** 对方明确拒绝（4xx），或返回的内容大得不正常；重试没有意义 */
  | "BAD_RESPONSE";

export class PublicFileError extends Error {
  readonly failure: PublicFileFailure;
  constructor(failure: PublicFileFailure, message: string) {
    super(message);
    this.name = "PublicFileError";
    this.failure = failure;
  }
}

export interface DownloadOptions {
  /** 测试里换成替身 */
  fetch?: typeof fetch;
  /** 每次尝试的总时限（含读完响应体），毫秒 */
  timeoutMs?: number;
  /** 最多尝试几次 */
  attempts?: number;
  /** 两次尝试之间等多久，毫秒 */
  retryDelayMs?: number;
  /** 响应体的大小上限（字节） */
  maxBytes?: number;
}

const DEFAULTS = { timeoutMs: 60_000, attempts: 3, retryDelayMs: 2_000, maxBytes: 64 * 1024 * 1024 };

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

/** 边读边数：一超过上限就中止下载，不把超大的内容读进内存。 */
async function readLimited(response: Response, maxBytes: number, what: string): Promise<Uint8Array> {
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new PublicFileError("BAD_RESPONSE", `${what}文件大得不正常，已中止下载`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

/**
 * 下载一个公开文件的全部内容。
 * @param what 给人看的说明里怎么称呼这份数据，如「机场数据」
 */
export async function downloadPublicFile(url: string, what: string, options: DownloadOptions = {}): Promise<Uint8Array> {
  const doFetch = options.fetch ?? fetch;
  const { timeoutMs, attempts, retryDelayMs, maxBytes } = { ...DEFAULTS, ...options };
  let last = new PublicFileError("UNAVAILABLE", `下载${what}失败`);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) await sleep(retryDelayMs);
    try {
      const response = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
      if (response.status >= 500 || response.status === 429) {
        last = new PublicFileError("UNAVAILABLE", `${what}源暂时不可用（HTTP ${response.status}）`);
        continue;
      }
      if (!response.ok) throw new PublicFileError("BAD_RESPONSE", `${what}源拒绝了下载请求（HTTP ${response.status}）`);
      const declared = Number(response.headers.get("content-length") ?? "0");
      if (declared > maxBytes) throw new PublicFileError("BAD_RESPONSE", `${what}文件大得不正常，没有下载`);
      return await readLimited(response, maxBytes, what);
    } catch (err) {
      if (err instanceof PublicFileError) throw err;
      last = isTimeout(err)
        ? new PublicFileError("TIMEOUT", `下载${what}超时（${Math.round(timeoutMs / 1000)} 秒）`)
        : new PublicFileError("UNAVAILABLE", `连不上${what}源`);
    }
  }
  throw last;
}
