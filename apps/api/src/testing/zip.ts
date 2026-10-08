/** 测试里现场拼一个 zip 压缩包（只支持存储和 deflate 两种方式），用来测解压和 GeoNames 的下载，不依赖任何真实文件。 */
import { crc32, deflateRawSync } from "node:zlib";

export interface TestZipEntry {
  name: string;
  content: Buffer;
  /** 默认 deflate */
  method?: "store" | "deflate";
}

export function buildZip(entries: readonly TestZipEntry[], comment = ""): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const method = entry.method === "store" ? 0 : 8;
    const data = method === 0 ? entry.content : deflateRawSync(entry.content);
    const sizes = Buffer.alloc(12);
    sizes.writeUInt32LE(crc32(entry.content), 0);
    sizes.writeUInt32LE(data.length, 4);
    sizes.writeUInt32LE(entry.content.length, 8);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    sizes.copy(local, 14);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    sizes.copy(central, 16);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const commentBytes = Buffer.from(comment, "utf8");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(commentBytes.length, 20);
  return Buffer.concat([...locals, directory, end, commentBytes]);
}
