/**
 * 从 zip 压缩包里取出一个文件（GeoNames 的数据文件是 zip）。只读、只在内存里做，不写磁盘，不引入第三方库（ADR 0001）。
 *
 * 只支持用得到的那一小部分格式：不加密、不分卷、小于 4GB（不支持 ZIP64）、存储或 deflate 压缩。
 * 解出来的内容有大小上限，并核对 CRC——损坏的或恶意构造的压缩包会被拒绝，而不是解出一堆垃圾或撑爆内存。
 */
import { crc32, inflateRawSync } from "node:zlib";

export class ZipError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ZipError";
  }
}

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
/** 解压后的大小上限（字节）：GeoNames 最大的单个国家名称文件约 100MB */
export const DEFAULT_MAX_UNZIPPED_BYTES = 512 * 1024 * 1024;

/** 内容是不是 zip 压缩包（看开头的标记）。 */
export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05) && (bytes[3] === 0x04 || bytes[3] === 0x06);
}

/**
 * 取出压缩包里名为 `entryName` 的文件的内容。
 * @param maxBytes 解压后的大小上限
 */
export function unzipEntry(bytes: Uint8Array, entryName: string, maxBytes: number = DEFAULT_MAX_UNZIPPED_BYTES): Buffer {
  const zip = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // 结尾记录在文件末尾，后面最多跟 65535 字节的注释：从后往前找它的标记
  let end = -1;
  for (let offset = zip.length - 22; offset >= Math.max(0, zip.length - 22 - 0xffff); offset -= 1) {
    if (zip.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) {
      end = offset;
      break;
    }
  }
  if (end < 0) throw new ZipError("不是 zip 压缩包，或者压缩包不完整");
  const entries = zip.readUInt16LE(end + 10);
  let cursor = zip.readUInt32LE(end + 16);
  const names: string[] = [];
  for (let index = 0; index < entries; index += 1) {
    if (cursor + 46 > zip.length || zip.readUInt32LE(cursor) !== CENTRAL_FILE_HEADER) throw new ZipError("压缩包的目录已损坏");
    const flags = zip.readUInt16LE(cursor + 8);
    const method = zip.readUInt16LE(cursor + 10);
    const expectedCrc = zip.readUInt32LE(cursor + 16);
    const compressedSize = zip.readUInt32LE(cursor + 20);
    const size = zip.readUInt32LE(cursor + 24);
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const commentLength = zip.readUInt16LE(cursor + 32);
    const localOffset = zip.readUInt32LE(cursor + 42);
    const name = zip.toString("utf8", cursor + 46, cursor + 46 + nameLength);
    cursor += 46 + nameLength + extraLength + commentLength;
    names.push(name);
    if (name !== entryName) continue;

    if ((flags & 0x1) !== 0) throw new ZipError(`压缩包里的 ${entryName} 是加密的`);
    if (compressedSize === 0xffffffff || size === 0xffffffff || localOffset === 0xffffffff) throw new ZipError("不支持超过 4GB 的压缩包");
    if (size > maxBytes) throw new ZipError(`压缩包里的 ${entryName} 解压后大得不正常，没有解压`);
    if (localOffset + 30 > zip.length || zip.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) throw new ZipError("压缩包已损坏");
    const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    if (dataStart + compressedSize > zip.length) throw new ZipError("压缩包不完整");
    const compressed = zip.subarray(dataStart, dataStart + compressedSize);
    let content: Buffer;
    if (method === 0) content = Buffer.from(compressed);
    else if (method === 8) {
      try {
        content = inflateRawSync(compressed, { maxOutputLength: maxBytes });
      } catch {
        throw new ZipError(`压缩包里的 ${entryName} 解不开（已损坏，或解压后大得不正常）`);
      }
    } else throw new ZipError(`压缩包里的 ${entryName} 用了不支持的压缩方式`);
    if (content.length !== size || crc32(content) !== expectedCrc) throw new ZipError(`压缩包里的 ${entryName} 校验不通过，文件已损坏`);
    return content;
  }
  throw new ZipError(`压缩包里没有 ${entryName}${names.length > 0 ? `（里面有：${names.slice(0, 5).join("、")}）` : ""}`);
}
