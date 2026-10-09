/**
 * 外部服务：GeoNames 的公开数据文件下载（城市主数据的来源，见 @nozomi/domain 的 geonames.ts；许可 CC BY 4.0）。
 *
 * 两个动作：下载城市文件、下载某个国家的各语言名称文件。下载到的是 zip，这里解出里面的文本并按 UTF-8 严格解码。
 * 有总时限、有限次数的重试、清楚的错误码（下载的共用部分在 public-file.ts）；不需要任何密钥。单元测试里用替身 `fetch`，不联网。
 */
import { GEONAMES, decodeUtf8Strict, geonamesNamesFile } from "@nozomi/domain";
import { type DownloadOptions, PublicFileError, downloadPublicFile } from "./public-file.ts";
import { ZipError, isZip, unzipEntry } from "./zip.ts";

export type GeoNamesErrorCode =
  /** 在时限内没有下载完 */
  | "GEONAMES_TIMEOUT"
  /** 连不上，或对方暂时出错（5xx、429）；已经重试过 */
  | "GEONAMES_UNAVAILABLE"
  /** 对方明确拒绝（4xx），或返回的内容大得不正常、不是预期的 zip、不是 UTF-8 文本；重试没有意义 */
  | "GEONAMES_BAD_RESPONSE";

export class GeoNamesError extends Error {
  readonly code: GeoNamesErrorCode;
  constructor(code: GeoNamesErrorCode, message: string) {
    super(message);
    this.name = "GeoNamesError";
    this.code = code;
  }
}

/** 各语言名称的压缩包比城市文件大（美国约 30MB），上限放宽一些 */
const MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024;

/**
 * 把 GeoNames 的文件内容变成文本：是 zip 就取出里面名为 `entry` 的文件，不是 zip 就当作已经解压好的文本。
 * 本地文件（`--file`）和下载两条路径都走这里。损坏的压缩包、不是 UTF-8 的内容都会抛错（ZipError / CsvError）。
 */
export function geonamesText(bytes: Uint8Array, entry: string): string {
  return decodeUtf8Strict(isZip(bytes) ? unzipEntry(bytes, entry) : bytes);
}

async function download(url: string, entry: string, what: string, options: DownloadOptions): Promise<string> {
  let bytes: Uint8Array;
  try {
    bytes = await downloadPublicFile(url, what, { maxBytes: MAX_DOWNLOAD_BYTES, timeoutMs: 120_000, ...options });
  } catch (err) {
    if (err instanceof PublicFileError) throw new GeoNamesError(`GEONAMES_${err.failure}`, err.message);
    throw err;
  }
  try {
    return geonamesText(bytes, entry);
  } catch (err) {
    const reason = err instanceof ZipError ? err.message : "不是 UTF-8 编码的文本";
    throw new GeoNamesError("GEONAMES_BAD_RESPONSE", `下载到的${what}不能用：${reason}`);
  }
}

/** 下载城市文件（cities15000），返回解压后的文本。 */
export function downloadCities(options: DownloadOptions = {}): Promise<string> {
  return download(GEONAMES.citiesUrl, GEONAMES.citiesEntry, "城市数据", options);
}

/** 下载某个国家的各语言名称文件，返回解压后的文本。 */
export function downloadCityNames(countryCode: string, options: DownloadOptions = {}): Promise<string> {
  const { url, entry } = geonamesNamesFile(countryCode);
  return download(url, entry, `${countryCode} 的城市名称数据`, options);
}
