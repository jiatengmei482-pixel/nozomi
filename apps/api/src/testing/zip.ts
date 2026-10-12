/** 测试里现场拼一个 zip 压缩包（只支持存储和 deflate 两种方式），用来测解压和 GeoNames 的下载，不依赖任何真实文件。 */
import { crc32, deflateRawSync } from "node:zlib";

export interface TestZipEntry {
  name: string;
  content: Buffer;
  /** 默认 deflate */
  method?: "store" | "deflate";
}

export interface TestZipOptions {
  comment?: string;
  /** 带「数据描述符」：本地文件头里的校验和大小写成 0，真实的值跟在数据后面（Excel 存盘、流式写出的工具都这样） */
  dataDescriptor?: boolean;
  /** 用 ZIP64 的写法：大小和位置写在扩展字段里，普通字段填成全 1；结尾另有 ZIP64 的记录（.NET、Go 的一些工具对小文件也这样写） */
  zip64?: boolean;
  /** deflate 的压缩级别 0–9 */
  level?: number;
}

export function buildZip(entries: readonly TestZipEntry[], commentOrOptions: string | TestZipOptions = ""): Buffer {
  const options: TestZipOptions = typeof commentOrOptions === "string" ? { comment: commentOrOptions } : commentOrOptions;
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const method = entry.method === "store" ? 0 : 8;
    const data = method === 0 ? entry.content : deflateRawSync(entry.content, options.level === undefined ? {} : { level: options.level });
    const crc = crc32(entry.content);
    const flags = options.dataDescriptor ? 0x0008 : 0;
    const localExtra = options.zip64 && !options.dataDescriptor ? Buffer.alloc(20) : Buffer.alloc(0);
    if (localExtra.length > 0) {
      localExtra.writeUInt16LE(1, 0);
      localExtra.writeUInt16LE(16, 2);
      localExtra.writeBigUInt64LE(BigInt(entry.content.length), 4);
      localExtra.writeBigUInt64LE(BigInt(data.length), 12);
    }
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(options.zip64 ? 45 : 20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(options.dataDescriptor ? 0 : crc, 14);
    local.writeUInt32LE(options.dataDescriptor ? 0 : options.zip64 ? 0xffffffff : data.length, 18);
    local.writeUInt32LE(options.dataDescriptor ? 0 : options.zip64 ? 0xffffffff : entry.content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(localExtra.length, 28);
    const descriptor = Buffer.alloc(options.dataDescriptor ? 16 : 0);
    if (options.dataDescriptor) {
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(data.length, 8);
      descriptor.writeUInt32LE(entry.content.length, 12);
    }
    const centralExtra = options.zip64 ? Buffer.alloc(28) : Buffer.alloc(0);
    if (options.zip64) {
      centralExtra.writeUInt16LE(1, 0);
      centralExtra.writeUInt16LE(24, 2);
      centralExtra.writeBigUInt64LE(BigInt(entry.content.length), 4);
      centralExtra.writeBigUInt64LE(BigInt(data.length), 12);
      centralExtra.writeBigUInt64LE(BigInt(offset), 20);
    }
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(options.zip64 ? 45 : 20, 4);
    central.writeUInt16LE(options.zip64 ? 45 : 20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(options.zip64 ? 0xffffffff : data.length, 20);
    central.writeUInt32LE(options.zip64 ? 0xffffffff : entry.content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(centralExtra.length, 30);
    central.writeUInt32LE(options.zip64 ? 0xffffffff : offset, 42);
    locals.push(local, name, localExtra, data, descriptor);
    centrals.push(central, name, centralExtra);
    offset += local.length + name.length + localExtra.length + data.length + descriptor.length;
  }
  const directory = Buffer.concat(centrals);
  const commentBytes = Buffer.from(options.comment ?? "", "utf8");
  const zip64End = Buffer.alloc(options.zip64 ? 76 : 0);
  if (options.zip64) {
    zip64End.writeUInt32LE(0x06064b50, 0);
    zip64End.writeBigUInt64LE(44n, 4);
    zip64End.writeUInt16LE(45, 12);
    zip64End.writeUInt16LE(45, 14);
    zip64End.writeBigUInt64LE(BigInt(entries.length), 24);
    zip64End.writeBigUInt64LE(BigInt(entries.length), 32);
    zip64End.writeBigUInt64LE(BigInt(directory.length), 40);
    zip64End.writeBigUInt64LE(BigInt(offset), 48);
    zip64End.writeUInt32LE(0x07064b50, 56);
    zip64End.writeBigUInt64LE(BigInt(offset + directory.length), 64);
    zip64End.writeUInt32LE(1, 72);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(options.zip64 ? 0xffff : entries.length, 8);
  end.writeUInt16LE(options.zip64 ? 0xffff : entries.length, 10);
  end.writeUInt32LE(options.zip64 ? 0xffffffff : directory.length, 12);
  end.writeUInt32LE(options.zip64 ? 0xffffffff : offset, 16);
  end.writeUInt16LE(commentBytes.length, 20);
  return Buffer.concat([...locals, directory, zip64End, end, commentBytes]);
}
