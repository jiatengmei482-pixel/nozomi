/**
 * 外部服务：OurAirports 的公开数据文件下载（机场主数据的来源，见 @nozomi/domain 的 ourairports.ts）。
 *
 * 只有一个动作：把 airports.csv 下载成文本。有总时限、有限次数的重试、清楚的错误码；
 * 不需要任何密钥。单元测试里用替身 `fetch`，不联网。
 */
import { setTimeout as sleep } from "node:timers/promises";
import { OURAIRPORTS, decodeUtf8Strict } from "@nozomi/domain";

export type OurAirportsErrorCode =
  /** 在时限内没有下载完 */
  | "OURAIRPORTS_TIMEOUT"
  /** 连不上，或对方暂时出错（5xx、429）；已经重试过 */
  | "OURAIRPORTS_UNAVAILABLE"
  /** 对方明确拒绝（4xx），或返回的内容大得不正常、不是 UTF-8 文本；重试没有意义 */
  | "OURAIRPORTS_BAD_RESPONSE";

export class OurAirportsError extends Error {
  readonly code: OurAirportsErrorCode;
  constructor(code: OurAirportsErrorCode, message: string) {
    super(message);
    this.name = "OurAirportsError";
    this.code = code;
  }
}

export interface DownloadOptions {
  /** 测试里换成替身 */
  fetch?: typeof fetch;
  url?: string;
  /** 每次尝试的总时限（含读完响应体），毫秒 */
  timeoutMs?: number;
  /** 最多尝试几次 */
  attempts?: number;
  /** 两次尝试之间等多久，毫秒 */
  retryDelayMs?: number;
  /** 响应体的大小上限（字节）；真实文件约 13MB */
  maxBytes?: number;
}

const DEFAULTS = { timeoutMs: 60_000, attempts: 3, retryDelayMs: 2_000, maxBytes: 64 * 1024 * 1024 };

function isTimeout(err: unknown): boolean {
  return err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
}

/** 边读边数：一超过上限就中止下载，不把超大的内容读进内存。 */
async function readLimited(response: Response, maxBytes: number): Promise<Uint8Array> {
  const tooLarge = (): OurAirportsError => new OurAirportsError("OURAIRPORTS_BAD_RESPONSE", "机场数据文件大得不正常，已中止下载");
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
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, total);
}

function decode(bytes: Uint8Array): string {
  try {
    return decodeUtf8Strict(bytes);
  } catch {
    throw new OurAirportsError("OURAIRPORTS_BAD_RESPONSE", "下载到的机场数据不是 UTF-8 编码的文本，没有使用");
  }
}

export async function downloadAirportsCsv(options: DownloadOptions = {}): Promise<string> {
  const doFetch = options.fetch ?? fetch;
  const url = options.url ?? OURAIRPORTS.downloadUrl;
  const { timeoutMs, attempts, retryDelayMs, maxBytes } = { ...DEFAULTS, ...options };
  let last = new OurAirportsError("OURAIRPORTS_UNAVAILABLE", "下载机场数据失败");
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (attempt > 1) await sleep(retryDelayMs);
    try {
      const response = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
      if (response.status >= 500 || response.status === 429) {
        last = new OurAirportsError("OURAIRPORTS_UNAVAILABLE", `机场数据源暂时不可用（HTTP ${response.status}）`);
        continue;
      }
      if (!response.ok) throw new OurAirportsError("OURAIRPORTS_BAD_RESPONSE", `机场数据源拒绝了下载请求（HTTP ${response.status}）`);
      const declared = Number(response.headers.get("content-length") ?? "0");
      if (declared > maxBytes) throw new OurAirportsError("OURAIRPORTS_BAD_RESPONSE", "机场数据文件大得不正常，没有下载");
      return decode(await readLimited(response, maxBytes));
    } catch (err) {
      if (err instanceof OurAirportsError) throw err;
      last = isTimeout(err)
        ? new OurAirportsError("OURAIRPORTS_TIMEOUT", `下载机场数据超时（${Math.round(timeoutMs / 1000)} 秒）`)
        : new OurAirportsError("OURAIRPORTS_UNAVAILABLE", "连不上机场数据源");
    }
  }
  throw last;
}
