/**
 * 外部服务：OurAirports 的公开数据文件下载（机场主数据的来源，见 @nozomi/domain 的 ourairports.ts）。
 *
 * 只有一个动作：把 airports.csv 下载成文本。有总时限、有限次数的重试、清楚的错误码（下载的共用部分在 public-file.ts）；
 * 不需要任何密钥。单元测试里用替身 `fetch`，不联网。
 */
import { OURAIRPORTS, decodeUtf8Strict } from "@nozomi/domain";
import { type DownloadOptions as PublicDownloadOptions, PublicFileError, downloadPublicFile } from "./public-file.ts";

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

export interface DownloadOptions extends PublicDownloadOptions {
  url?: string;
}

export async function downloadAirportsCsv(options: DownloadOptions = {}): Promise<string> {
  let bytes: Uint8Array;
  try {
    bytes = await downloadPublicFile(options.url ?? OURAIRPORTS.downloadUrl, "机场数据", options);
  } catch (err) {
    if (err instanceof PublicFileError) throw new OurAirportsError(`OURAIRPORTS_${err.failure}`, err.message);
    throw err;
  }
  try {
    return decodeUtf8Strict(bytes);
  } catch {
    throw new OurAirportsError("OURAIRPORTS_BAD_RESPONSE", "下载到的机场数据不是 UTF-8 编码的文本，没有使用");
  }
}
