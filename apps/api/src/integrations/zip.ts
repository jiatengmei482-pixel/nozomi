/**
 * 从 zip 压缩包里取出一个文件（GeoNames 的数据文件、上传的 .xlsx 都是 zip），以及拼出一个 zip（导出 .xlsx）。
 * 只在内存里做，不写磁盘，不引入第三方库（ADR 0001）。压缩包里的文件名只用来在包内查找，从不当作磁盘路径使用。
 *
 * 只支持用得到的那一小部分格式：不加密、不分卷、存储或 deflate 压缩；认 ZIP64 和数据描述符的写法（内容本身仍受大小上限约束）。
 * 解出来的内容有大小上限，并核对 CRC——损坏的或恶意构造的压缩包会被拒绝，而不是解出一堆垃圾或撑爆内存。
 */
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

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

const ZIP64_END_LOCATOR = 0x07064b50;
const ZIP64_END_RECORD = 0x06064b50;

interface CentralEntry {
  name: string;
  flags: number;
  method: number;
  crc: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

function safe(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) throw new ZipError("压缩包里的数字大得不正常");
  return Number(value);
}

/**
 * 读出压缩包的目录。认 ZIP64 的写法：有的软件（.NET、Go 写的工具）即使文件很小也把大小、位置写在 ZIP64 的扩展字段里，
 * 普通字段填成全 1。目录读不出来返回 null。
 */
function centralDirectory(bytes: Uint8Array): CentralEntry[] | null {
  const zip = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // 结尾记录在文件末尾，后面最多跟 65535 字节的注释：从后往前找它的标记
  let end = -1;
  for (let offset = zip.length - 22; offset >= Math.max(0, zip.length - 22 - 0xffff); offset -= 1) {
    if (zip.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) {
      end = offset;
      break;
    }
  }
  if (end < 0) return null;
  let count = zip.readUInt16LE(end + 10);
  let cursor = zip.readUInt32LE(end + 16);
  if (count === 0xffff || cursor === 0xffffffff) {
    const locator = end - 20;
    if (locator < 0 || zip.readUInt32LE(locator) !== ZIP64_END_LOCATOR) return null;
    const record = safe(zip.readBigUInt64LE(locator + 8));
    if (record + 56 > zip.length || zip.readUInt32LE(record) !== ZIP64_END_RECORD) return null;
    count = safe(zip.readBigUInt64LE(record + 32));
    cursor = safe(zip.readBigUInt64LE(record + 48));
  }
  if (count > 100_000) throw new ZipError("压缩包里的文件多得不正常");
  const entries: CentralEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (cursor + 46 > zip.length || zip.readUInt32LE(cursor) !== CENTRAL_FILE_HEADER) return null;
    const nameLength = zip.readUInt16LE(cursor + 28);
    const extraLength = zip.readUInt16LE(cursor + 30);
    const entry: CentralEntry = {
      name: zip.toString("utf8", cursor + 46, cursor + 46 + nameLength),
      flags: zip.readUInt16LE(cursor + 8),
      method: zip.readUInt16LE(cursor + 10),
      crc: zip.readUInt32LE(cursor + 16),
      compressedSize: zip.readUInt32LE(cursor + 20),
      size: zip.readUInt32LE(cursor + 24),
      localOffset: zip.readUInt32LE(cursor + 42),
    };
    // ZIP64 扩展字段（编号 1）：按「原大小、压缩后大小、位置」的顺序，只包含普通字段里填成全 1 的那几项
    const extraEnd = Math.min(zip.length, cursor + 46 + nameLength + extraLength);
    for (let at = cursor + 46 + nameLength; at + 4 <= extraEnd; ) {
      const id = zip.readUInt16LE(at);
      const length = zip.readUInt16LE(at + 2);
      if (id === 1) {
        let field = at + 4;
        const next = (): number => {
          if (field + 8 > at + 4 + length || field + 8 > zip.length) throw new ZipError("压缩包的目录已损坏");
          const value = safe(zip.readBigUInt64LE(field));
          field += 8;
          return value;
        };
        if (entry.size === 0xffffffff) entry.size = next();
        if (entry.compressedSize === 0xffffffff) entry.compressedSize = next();
        if (entry.localOffset === 0xffffffff) entry.localOffset = next();
      }
      at += 4 + length;
    }
    entries.push(entry);
    cursor += 46 + nameLength + extraLength + zip.readUInt16LE(cursor + 32);
  }
  return entries;
}

/**
 * 取出压缩包里名为 `entryName` 的文件的内容。
 * @param maxBytes 解压后的大小上限
 */
export function unzipEntry(bytes: Uint8Array, entryName: string, maxBytes: number = DEFAULT_MAX_UNZIPPED_BYTES): Buffer {
  const zip = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = centralDirectory(bytes);
  if (entries === null) throw new ZipError(zip.length >= 22 && isZip(bytes) ? "压缩包的目录已损坏" : "不是 zip 压缩包，或者压缩包不完整");
  const entry = entries.find((candidate) => candidate.name === entryName);
  if (!entry) throw new ZipError(`压缩包里没有 ${entryName}${entries.length > 0 ? `（里面有：${entries.slice(0, 5).map((candidate) => candidate.name).join("、")}）` : ""}`);
  if ((entry.flags & 0x1) !== 0) throw new ZipError(`压缩包里的 ${entryName} 是加密的`);
  if (entry.size > maxBytes) throw new ZipError(`压缩包里的 ${entryName} 解压后大得不正常，没有解压`);
  const { localOffset, compressedSize } = entry;
  if (localOffset + 30 > zip.length || zip.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) throw new ZipError("压缩包已损坏");
  // 大小以目录里的为准：带「数据描述符」的写法（Excel 存盘就是）本地文件头里的大小是 0
  const dataStart = localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
  if (dataStart + compressedSize > zip.length) throw new ZipError("压缩包不完整");
  const compressed = zip.subarray(dataStart, dataStart + compressedSize);
  let content: Buffer;
  if (entry.method === 0) content = Buffer.from(compressed);
  else if (entry.method === 8) {
    try {
      content = inflateRawSync(compressed, { maxOutputLength: maxBytes });
    } catch {
      throw new ZipError(`压缩包里的 ${entryName} 解不开（已损坏，或解压后大得不正常）`);
    }
  } else throw new ZipError(`压缩包里的 ${entryName} 用了不支持的压缩方式`);
  if (content.length !== entry.size || crc32(content) !== entry.crc) throw new ZipError(`压缩包里的 ${entryName} 校验不通过，文件已损坏`);
  return content;
}

/** 压缩包里有没有名为 `entryName` 的文件（只看目录，不解压）。目录读不出来时返回 false。 */
export function hasZipEntry(bytes: Uint8Array, entryName: string): boolean {
  try {
    return centralDirectory(bytes)?.some((entry) => entry.name === entryName) ?? false;
  } catch {
    return false;
  }
}

/** 拼出一个 zip 压缩包（deflate 压缩，不加密）。文件的修改时间固定写成 1980-01-01：同样的内容拼出来的压缩包逐字节相同。 */
export function createZip(entries: readonly { name: string; content: Buffer }[]): Buffer {
  const parts: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = deflateRawSync(entry.content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_FILE_HEADER, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // 文件名是 UTF-8
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0x0021, 12); // 日期 1980-01-01
    local.writeUInt32LE(crc32(entry.content), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(entry.content.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_FILE_HEADER, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    local.copy(central, 8, 6, 30); // 标志、压缩方式、时间、日期、校验、两个大小、文件名长度：和本地文件头里的一样
    central.writeUInt16LE(0, 30);
    central.writeUInt32LE(offset, 42);
    parts.push(local, name, data);
    directory.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const directoryBytes = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directoryBytes.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directoryBytes, end]);
}
