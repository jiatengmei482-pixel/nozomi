import { test } from "node:test";
import assert from "node:assert/strict";
import { buildZip } from "../testing/zip.ts";
import { ZipError, isZip, unzipEntry } from "./zip.ts";

const text = Buffer.from("1850147\tTokyo\t東京\n".repeat(200), "utf8");

test("取出压缩包里指定的文件：deflate 和存储两种方式、多个文件、带注释的压缩包都行", () => {
  const zip = buildZip([{ name: "readme.txt", content: Buffer.from("hi") }, { name: "JP.txt", content: text }, { name: "stored.txt", content: text, method: "store" }], "made in a test");
  assert.equal(isZip(zip), true);
  assert.deepEqual(unzipEntry(zip, "JP.txt"), text);
  assert.deepEqual(unzipEntry(zip, "stored.txt"), text);
  assert.equal(unzipEntry(zip, "readme.txt").toString(), "hi");
  assert.ok(zip.length < text.length * 2, "确实压缩了");
  assert.deepEqual(unzipEntry(buildZip([{ name: "empty.txt", content: Buffer.alloc(0) }]), "empty.txt"), Buffer.alloc(0));
});

test("不是压缩包、要的文件不在里面：报错并说明（列出里面有什么）", () => {
  assert.equal(isZip(Buffer.from("geonameid\tname\n")), false);
  assert.equal(isZip(Buffer.alloc(0)), false);
  assert.throws(() => unzipEntry(Buffer.from("just some text, long enough to look for the end record"), "a.txt"), (err: unknown) => err instanceof ZipError && /不是 zip 压缩包/.test(err.message));
  assert.throws(() => unzipEntry(Buffer.alloc(3), "a.txt"), ZipError);
  const zip = buildZip([{ name: "KR.txt", content: text }]);
  assert.throws(() => unzipEntry(zip, "JP.txt"), (err: unknown) => err instanceof ZipError && /没有 JP\.txt（里面有：KR\.txt）/.test(err.message));
});

test("损坏的压缩包：被截断、内容被改、目录被改——都报错，不会解出一堆垃圾", () => {
  const zip = buildZip([{ name: "JP.txt", content: text }]);
  assert.throws(() => unzipEntry(zip.subarray(0, zip.length - 10), "JP.txt"), ZipError);
  const flipped = Buffer.from(zip);
  flipped[40] = (flipped[40] as number) ^ 0xff;
  assert.throws(() => unzipEntry(flipped, "JP.txt"), (err: unknown) => err instanceof ZipError && /解不开|校验不通过/.test(err.message));
  const stored = buildZip([{ name: "JP.txt", content: text, method: "store" }]);
  stored[40] = (stored[40] as number) ^ 0x01;
  assert.throws(() => unzipEntry(stored, "JP.txt"), (err: unknown) => err instanceof ZipError && /校验不通过/.test(err.message));
  const badDirectory = Buffer.from(zip);
  badDirectory.writeUInt32LE(0, badDirectory.length - 22 - 46 - "JP.txt".length);
  assert.throws(() => unzipEntry(badDirectory, "JP.txt"), (err: unknown) => err instanceof ZipError && /目录已损坏/.test(err.message));
});

test("解压后的大小有上限：声明得太大、或实际解出来太大（压缩炸弹），都拒绝", () => {
  const bomb = buildZip([{ name: "big.txt", content: Buffer.alloc(5_000_000) }]);
  assert.ok(bomb.length < 20_000, "五百万个零压缩后很小");
  assert.throws(() => unzipEntry(bomb, "big.txt", 1_000_000), (err: unknown) => err instanceof ZipError && /大得不正常/.test(err.message));
  // 把目录里声明的大小改小，骗过第一道检查：实际解压时仍然被上限拦住
  const lying = Buffer.from(bomb);
  const central = lying.length - 22 - 46 - "big.txt".length;
  lying.writeUInt32LE(10, central + 24);
  assert.throws(() => unzipEntry(lying, "big.txt", 1_000_000), (err: unknown) => err instanceof ZipError && /解不开/.test(err.message));
  assert.equal(unzipEntry(bomb, "big.txt", 5_000_000).length, 5_000_000);
});

test("加密的、用了别的压缩方式的：明确说不支持", () => {
  const zip = buildZip([{ name: "a.txt", content: text }]);
  const central = zip.length - 22 - 46 - "a.txt".length;
  const encrypted = Buffer.from(zip);
  encrypted.writeUInt16LE(1, central + 8);
  assert.throws(() => unzipEntry(encrypted, "a.txt"), (err: unknown) => err instanceof ZipError && /加密/.test(err.message));
  const bzip = Buffer.from(zip);
  bzip.writeUInt16LE(12, central + 10);
  assert.throws(() => unzipEntry(bzip, "a.txt"), (err: unknown) => err instanceof ZipError && /不支持的压缩方式/.test(err.message));
});

test("别的工具写出的压缩包：带数据描述符（本地头里大小是 0）、ZIP64（大小和位置写在扩展字段里）、不同的压缩级别——都以目录里的大小为准读出来", () => {
  const entries = [{ name: "readme.txt", content: Buffer.from("hi") }, { name: "JP.txt", content: text }, { name: "stored.txt", content: text, method: "store" as const }];
  for (const options of [{ dataDescriptor: true }, { zip64: true }, { zip64: true, dataDescriptor: true }, { level: 0 }, { level: 1 }, { level: 9 }, { zip64: true, comment: "注释" }]) {
    const zip = buildZip(entries, options);
    assert.equal(isZip(zip), true);
    for (const entry of entries) assert.deepEqual(unzipEntry(zip, entry.name), entry.content, `${JSON.stringify(options)} ${entry.name}`);
    assert.throws(() => unzipEntry(zip, "missing.txt"), (err: unknown) => err instanceof ZipError && /里面有：/.test(err.message));
  }
});

test("损坏的 ZIP64：定位记录指到包外、目录位置不对——报错，不越界读", () => {
  const zip = buildZip([{ name: "JP.txt", content: text }], { zip64: true });
  const locator = zip.length - 22 - 20;
  assert.equal(zip.readUInt32LE(locator), 0x07064b50);
  const outside = Buffer.from(zip);
  outside.writeBigUInt64LE(BigInt(zip.length * 4), locator + 8);
  assert.throws(() => unzipEntry(outside, "JP.txt"), ZipError);
  const huge = Buffer.from(zip);
  huge.writeBigUInt64LE(2n ** 60n, locator + 8);
  assert.throws(() => unzipEntry(huge, "JP.txt"), ZipError);
  const record = locator - 56;
  assert.equal(zip.readUInt32LE(record), 0x06064b50);
  const badOffset = Buffer.from(zip);
  badOffset.writeBigUInt64LE(2n ** 40n, record + 48);
  assert.throws(() => unzipEntry(badOffset, "JP.txt"), ZipError);
  const manyEntries = Buffer.from(zip);
  manyEntries.writeBigUInt64LE(2n ** 50n, record + 32);
  assert.throws(() => unzipEntry(manyEntries, "JP.txt"), ZipError);
});
