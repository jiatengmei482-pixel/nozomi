/**
 * 外部服务：免费汇率源（ADR 0022；格式和解析见 @nozomi/domain 的 fx-source.ts）。
 *
 * 只做「把响应原文取回来」：每次尝试有总时限、对暂时不可用有限次数地重试、边读边检查大小、按 UTF-8 严格解码；
 * 失败换成本模块的错误码。不需要密钥。地址只在这里用，不写进日志、库和接口（付费档的地址里带密钥）——对外只说主机名。
 * 单元测试里用替身 `fetch`；集成测试用本机的假数据源，不联网。
 */
import { decodeUtf8Strict } from "@nozomi/domain";
import { type DownloadOptions, PublicFileError, downloadPublicFile } from "./public-file.ts";

export type FxSourceErrorCode =
  /** 在时限内没有取回来 */
  | "FX_SOURCE_TIMEOUT"
  /** 连不上，或对方暂时出错（5xx、429）；已经重试过 */
  | "FX_SOURCE_UNAVAILABLE"
  /** 对方明确拒绝（4xx），或内容大得不正常、不是 UTF-8 文本 */
  | "FX_SOURCE_BAD_RESPONSE";

export class FxSourceError extends Error {
  readonly code: FxSourceErrorCode;
  constructor(code: FxSourceErrorCode, message: string) {
    super(message);
    this.name = "FxSourceError";
    this.code = code;
  }
}

/** 汇率响应正常只有几 KB；超过 1MB 一定不对 */
const MAX_BYTES = 1024 * 1024;

/** 定时拉取：每次最多等 10 秒，最多试 3 次。 */
export const SCHEDULED_FETCH: DownloadOptions = { timeoutMs: 10_000, attempts: 3, retryDelayMs: 2_000 };
/** 后台「立即拉取」：有人在页面上等着，只试 1 次、最多等 8 秒（前端的请求时限是 10 秒）。 */
export const MANUAL_FETCH: DownloadOptions = { timeoutMs: 8_000, attempts: 1 };

/** 取回汇率源的响应原文。 */
export async function downloadFxSource(url: string, options: DownloadOptions = {}): Promise<string> {
  let bytes: Uint8Array;
  try {
    bytes = await downloadPublicFile(url, "汇率", { maxBytes: MAX_BYTES, ...options });
  } catch (err) {
    if (err instanceof PublicFileError) throw new FxSourceError(`FX_SOURCE_${err.failure}`, err.message);
    throw err;
  }
  try {
    return decodeUtf8Strict(bytes);
  } catch {
    throw new FxSourceError("FX_SOURCE_BAD_RESPONSE", "汇率源返回的不是 UTF-8 文本");
  }
}

/** 对外（库、日志、接口）只说数据源的主机名，不说完整地址。 */
export function fxSourceHost(url: string): string {
  return new URL(url).host;
}
