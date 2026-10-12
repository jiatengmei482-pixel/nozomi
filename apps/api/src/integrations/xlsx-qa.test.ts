/**
 * M1-05 测试工程师补充：上传的 .xlsx / zip 是不可信的输入——恶意的、畸形的、别的软件写法的，
 * 结果只能是「读对」或「受控的拒绝（XlsxError / ZipError）」，不能抛别的错（接口上就是 500）、不能卡住、不能悄悄读错。
 * 样本全部在这里现场拼出来，不依赖任何文件。名字以「【缺陷】」开头的是现在会失败的测试，交回开发处理。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32, deflateRawSync } from "node:zlib";
import { type TestZipEntry, buildZip } from "../testing/zip.ts";
import { XLSX_LIMITS, type XlsxCell, XlsxError, type XlsxErrorCode, readXlsx, readXlsxSheet, writeXlsx } from "./xlsx.ts";
import { ZipError, hasZipEntry, unzipEntry } from "./zip.ts";

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const RELS = '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>';
const WORKBOOK = `${HEAD}<workbook xmlns:r="x"><sheets><sheet name="价格" sheetId="1" r:id="rId1"/></sheets></workbook>`;
const ws = (data: string): string => `${HEAD}<worksheet><sheetData>${data}</sheetData></worksheet>`;

interface Parts {
  sst?: string;
  rels?: string;
  workbook?: string;
  rootRels?: string;
  extra?: TestZipEntry[];
}

function parts(sheetXml: string | Buffer, options: Parts = {}): TestZipEntry[] {
  return [
    { name: "[Content_Types].xml", content: Buffer.from("<Types/>") },
    ...(options.rootRels === undefined ? [] : [{ name: "_rels/.rels", content: Buffer.from(options.rootRels) }]),
    { name: "xl/workbook.xml", content: Buffer.from(options.workbook ?? WORKBOOK) },
    { name: "xl/_rels/workbook.xml.rels", content: Buffer.from(options.rels ?? RELS) },
    ...(options.sst === undefined ? [] : [{ name: "xl/sharedStrings.xml", content: Buffer.from(options.sst) }]),
    { name: "xl/worksheets/sheet1.xml", content: typeof sheetXml === "string" ? Buffer.from(sheetXml) : sheetXml },
    ...(options.extra ?? []),
  ];
}
const pkg = (sheetXml: string | Buffer, options: Parts = {}): Buffer => buildZip(parts(sheetXml, options));

const plain = (rows: XlsxCell[][]): (string | null)[][] => rows.map((cells) => cells.map((cell) => (cell.type === "empty" ? null : cell.type === "formula" ? "#FORMULA" : `${cell.type === "number" ? "n:" : "t:"}${cell.text}`)));

/** 读一个文件：读出来就给内容，受控的拒绝给错误代码；抛了别的错（接口上会是 500）或超时就让测试失败。 */
function outcome(bytes: Uint8Array, limitMs = 10_000): { rows: (string | null)[][] } | { code: XlsxErrorCode; message: string } {
  const started = performance.now();
  try {
    const rows = plain(readXlsx(bytes));
    assert.ok(performance.now() - started < limitMs, `读了 ${Math.round(performance.now() - started)} ms`);
    return { rows };
  } catch (err) {
    assert.ok(performance.now() - started < limitMs, `读了 ${Math.round(performance.now() - started)} ms`);
    if (!(err instanceof XlsxError)) throw new assert.AssertionError({ message: `抛出的不是 XlsxError（接口上会是 500）：${(err as Error).name} ${(err as Error).message}` });
    assert.ok(err.message.length > 0 && /[\u4e00-\u9fff]/.test(err.message), "拒绝的说明是给人看的中文");
    return { code: err.code, message: err.message };
  }
}
const rejected = (bytes: Uint8Array, codes: readonly XlsxErrorCode[], label = ""): void => {
  const result = outcome(bytes);
  assert.ok("code" in result && codes.includes(result.code), `${label} 应当被拒绝为 ${codes.join(" / ")}，实际：${JSON.stringify(result).slice(0, 200)}`);
};
const rowsOf = (bytes: Uint8Array): (string | null)[][] => {
  const result = outcome(bytes);
  assert.ok("rows" in result, `应当读得出来，实际被拒绝：${JSON.stringify(result)}`);
  return result.rows;
};

/** 可重复的伪随机数（mulberry32）：模糊测试失败时能按种子复现。 */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 改压缩包里的原始字段：在第 n 个本地头 / 目录项 / 结尾记录的某个偏移写一个数。 */
function patch(zip: Buffer, signature: number, nth: number, offset: number, value: number, width: 2 | 4): Buffer {
  const copy = Buffer.from(zip);
  let seen = 0;
  for (let at = 0; at + 4 <= copy.length; at += 1) {
    if (copy.readUInt32LE(at) !== signature) continue;
    if (seen === nth) {
      if (width === 2) copy.writeUInt16LE(value, at + offset);
      else copy.writeUInt32LE(value >>> 0, at + offset);
      return copy;
    }
    seen += 1;
  }
  throw new Error("没有找到要改的记录");
}
const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const SHEET_INDEX = 3; // parts() 默认的顺序里工作表是第 4 个

const SIMPLE = ws('<row r="1"><c r="A1" t="inlineStr"><is><t>区域</t></is></c><c r="B1"><v>20000</v></c></row>');
const SIMPLE_ROWS = [["t:区域", "n:20000"]];

// ---- zip ----

test("zip 炸弹：高压缩比、谎报解压后的大小（报小、报大）、多个目录项指向同一段数据——解压有上限，不看自报的大小，用时有上限", () => {
  // 30 KB 的上传解出 64 MB：解压过程中就截断
  const bomb = Buffer.alloc(64 * 1024 * 1024, 0x20);
  const packed = pkg(bomb);
  assert.ok(packed.length < 200_000, "样本本身很小");
  rejected(packed, ["TOO_LARGE", "CORRUPT"], "64 MB 的工作表");
  // 目录里把解压后的大小报成 10 字节：照样只解到上限，然后因为对不上被拒绝
  rejected(patch(packed, CENTRAL, SHEET_INDEX, 24, 10, 4), ["TOO_LARGE", "CORRUPT"], "谎报成 10 字节");
  // 正常的小文件把大小报成 3 GB：不去申请内存
  rejected(patch(pkg(SIMPLE), CENTRAL, SHEET_INDEX, 24, 3_000_000_000, 4), ["TOO_LARGE"], "谎报成 3 GB");
  // 共享字符串、工作簿、关系文件各自是炸弹
  rejected(pkg(SIMPLE, { sst: " ".repeat(40 * 1024 * 1024) }), ["TOO_LARGE", "CORRUPT"], "共享字符串炸弹");
  rejected(pkg(SIMPLE, { workbook: `${WORKBOOK}${" ".repeat(40 * 1024 * 1024)}` }), ["TOO_LARGE", "CORRUPT"], "工作簿炸弹");
  rejected(pkg(SIMPLE, { rels: `${RELS}${" ".repeat(40 * 1024 * 1024)}` }), ["TOO_LARGE", "CORRUPT"], "关系文件炸弹");
  // 重叠条目：五个部件的目录项都指向同一段 15 MB 的数据（每个都在上限之内）——读得慢一点可以，不能失控
  const big = Buffer.from(ws(`<row r="1"><c r="A1"><v>1</v></c></row>${" ".repeat(15 * 1024 * 1024)}`));
  const overlapped = buildZip([{ name: "xl/worksheets/sheet1.xml", content: big }, { name: "xl/workbook.xml", content: big }, { name: "xl/_rels/workbook.xml.rels", content: big }, { name: "xl/sharedStrings.xml", content: big }, { name: "_rels/.rels", content: big }]);
  let aliased = overlapped;
  for (let index = 1; index < 5; index += 1) aliased = patch(aliased, CENTRAL, index, 42, 0, 4);
  assert.ok("rows" in outcome(aliased) || "code" in outcome(aliased));
  // 嵌套：工作表的内容本身又是一个压缩包——不递归解；读不懂的内容报文件已损坏（修缺陷之后不再当成一张空表：空在库存表里等于清除）
  rejected(pkg(pkg(SIMPLE)), ["CORRUPT"], "工作表是一个压缩包");
});

test("zip 里的名字：路径穿越、绝对路径、盘符、反斜杠、超长名字、重复的名字——名字只在包内查找，指到 xl/ 之外的工作表被拒绝", () => {
  for (const target of ["../../../../etc/passwd", "/etc/passwd", "..\\..\\windows\\win.ini", "C:\\windows\\win.ini", "file:///etc/passwd", "http://127.0.0.1/x", "//server/share/x.xml", "worksheets/../../secret.xml", "/xl/../etc/passwd"]) {
    const rels = `<Relationships><Relationship Id="rId1" Type="http://x/worksheet" Target="${target}"/></Relationships>`;
    rejected(pkg(SIMPLE, { rels, extra: [{ name: "etc/passwd", content: Buffer.from(SIMPLE) }, { name: "../../../../etc/passwd", content: Buffer.from(SIMPLE) }, { name: "/etc/passwd", content: Buffer.from(SIMPLE) }] }), ["UNSAFE", "CORRUPT"], target);
  }
  // 根关系把工作簿指到 xl/ 之外
  for (const target of ["../workbook.xml", "/etc/workbook.xml", "docProps/workbook.xml"]) {
    const result = outcome(pkg(SIMPLE, { rootRels: `<Relationships><Relationship Id="rId1" Type="http://x/officeDocument" Target="${target}"/></Relationships>`, extra: [{ name: "docProps/workbook.xml", content: Buffer.from(WORKBOOK) }, { name: "etc/workbook.xml", content: Buffer.from(WORKBOOK) }] }));
    assert.ok("code" in result ? result.code === "UNSAFE" : true, target);
    if ("rows" in result) assert.deepEqual(result.rows, SIMPLE_ROWS, "没被拒绝的话读的只能是 xl/ 里的那张表");
  }
  // 包里另有名字危险的条目（不被引用）：不妨碍，也不会被当成路径
  assert.deepEqual(rowsOf(pkg(SIMPLE, { extra: [{ name: "../../evil.sh", content: Buffer.from("x") }, { name: "/etc/cron.d/x", content: Buffer.from("x") }, { name: "C:\\x", content: Buffer.from("x") }, { name: "a".repeat(60_000), content: Buffer.from("x") }, { name: "", content: Buffer.from("x") }, { name: "xl/\u0000.xml", content: Buffer.from("x") }] })), SIMPLE_ROWS);
  // 重复的名字：读到的是其中一份（先出现的），不崩
  const duplicated = buildZip([...parts(SIMPLE), { name: "xl/worksheets/sheet1.xml", content: Buffer.from(ws('<row r="1"><c r="A1"><v>666</v></c></row>')) }]);
  assert.deepEqual(rowsOf(duplicated), SIMPLE_ROWS);
  // 6 万个条目的目录
  const many = buildZip([...parts(SIMPLE), ...Array.from({ length: 60_000 }, (_, index) => ({ name: `x/${index}`, content: Buffer.alloc(0), method: "store" as const }))]);
  if (many.length <= XLSX_LIMITS.maxFileBytes) assert.deepEqual(rowsOf(many), SIMPLE_ROWS);
  else rejected(many, ["TOO_LARGE"]);
});

test("zip 的各种不支持和损坏：加密、未知压缩方式、分卷、目录和本地头不一致、校验不对、注释里藏着假的结尾记录——明确拒绝或按目录读对", () => {
  const good = pkg(SIMPLE);
  assert.deepEqual(rowsOf(good), SIMPLE_ROWS);
  rejected(patch(good, CENTRAL, SHEET_INDEX, 8, 0x0001, 2), ["CORRUPT"], "加密标志");
  rejected(patch(good, CENTRAL, SHEET_INDEX, 8, 0x0041, 2), ["CORRUPT"], "强加密标志");
  for (const method of [1, 9, 12, 14, 93, 95, 99, 0xffff]) rejected(patch(good, CENTRAL, SHEET_INDEX, 10, method, 2), ["CORRUPT"], `压缩方式 ${method}`);
  // 目录说是「存储」，实际是 deflate 的数据：大小、校验对不上
  rejected(patch(good, CENTRAL, SHEET_INDEX, 10, 0, 2), ["CORRUPT"], "目录谎称没压缩");
  rejected(patch(good, CENTRAL, SHEET_INDEX, 16, 0xdeadbeef, 4), ["CORRUPT"], "校验值不对");
  rejected(patch(good, CENTRAL, SHEET_INDEX, 20, 0x7fffffff, 4), ["CORRUPT"], "压缩后的大小超出文件");
  rejected(patch(good, CENTRAL, SHEET_INDEX, 42, 0x7ffffff0, 4), ["CORRUPT"], "位置超出文件");
  rejected(patch(good, CENTRAL, SHEET_INDEX, 42, good.length - 2, 4), ["CORRUPT"], "位置在文件末尾");
  // 本地头里的名字、大小、压缩方式和目录不一致：以目录为准（ADR 0019），读得出来或者拒绝都行，不能崩
  for (const [offset, value, width] of [[8, 0, 2], [14, 0, 4], [18, 0, 4], [22, 0xffffffff, 4], [6, 0x0001, 2]] as const) {
    const result = outcome(patch(good, LOCAL, SHEET_INDEX, offset, value, width));
    if ("rows" in result) assert.deepEqual(result.rows, SIMPLE_ROWS);
  }
  // 本地头的名字长度、扩展长度被改大：数据的位置算到别处去了
  rejected(patch(good, LOCAL, SHEET_INDEX, 26, 0xffff, 2), ["CORRUPT"], "本地头名字长度");
  rejected(patch(good, LOCAL, SHEET_INDEX, 28, 0xffff, 2), ["CORRUPT"], "本地头扩展长度");
  // 目录里的名字长度、扩展长度、注释长度被改大
  for (const offset of [28, 30, 32]) {
    const result = outcome(patch(good, CENTRAL, 0, offset, 0xffff, 2));
    assert.ok("code" in result && ["CORRUPT", "NOT_XLSX"].includes(result.code), `目录偏移 ${offset}：${JSON.stringify(result)}`);
  }
  // 结尾记录：条目数、目录位置、分卷号被改
  for (const [offset, value, width] of [[10, 0, 2], [10, 1, 2], [10, 60_000, 2], [16, 0, 4], [16, 0x7fffffff, 4], [16, good.length - 1, 4], [12, 0xfffffffe, 4]] as const) {
    const result = outcome(patch(good, END, 0, offset, value, width));
    if ("rows" in result) assert.deepEqual(result.rows, SIMPLE_ROWS);
    else assert.ok(["CORRUPT", "NOT_XLSX"].includes(result.code), `结尾记录偏移 ${offset} = ${value}：${JSON.stringify(result)}`);
  }
  // 最长的注释（65535 字节），和注释里藏一个假的结尾记录（从后往前找会先找到它）
  assert.deepEqual(rowsOf(buildZip(parts(SIMPLE), "备".repeat(21_845))), SIMPLE_ROWS);
  const fakeEnd = Buffer.alloc(22);
  fakeEnd.writeUInt32LE(END, 0);
  fakeEnd.writeUInt16LE(3, 10);
  fakeEnd.writeUInt32LE(0xfffffff0, 16);
  const withFake = outcome(buildZip(parts(SIMPLE), fakeEnd.toString("latin1")));
  assert.ok("rows" in withFake || ["CORRUPT", "NOT_XLSX"].includes(withFake.code));
  // 文件后面跟着垃圾、前面垫着垃圾（自解压包的写法）
  for (const variant of [Buffer.concat([good, Buffer.alloc(70_000, 0x41)]), Buffer.concat([Buffer.from("MZ junk"), good])]) {
    const result = outcome(variant);
    if ("rows" in result) assert.deepEqual(result.rows, SIMPLE_ROWS);
  }
});

test("ZIP64 的各种谎报：条目数、目录位置、大小写成天文数字或指到包外——拒绝，不越界读、不申请内存", () => {
  const good = buildZip(parts(SIMPLE), { zip64: true });
  assert.deepEqual(rowsOf(good), SIMPLE_ROWS);
  const record = good.indexOf(Buffer.from([0x50, 0x4b, 0x06, 0x06]));
  const locator = good.indexOf(Buffer.from([0x50, 0x4b, 0x06, 0x07]));
  assert.ok(record > 0 && locator > record);
  const set64 = (at: number, value: bigint): Buffer => {
    const copy = Buffer.from(good);
    copy.writeBigUInt64LE(value, at);
    return copy;
  };
  const lies: [string, Buffer][] = [
    ["条目数 2^63", set64(record + 32, 2n ** 63n)],
    ["条目数 100 万", set64(record + 32, 1_000_000n)],
    ["条目数 99999", set64(record + 32, 99_999n)],
    ["条目数 0", set64(record + 32, 0n)],
    ["目录位置 2^64-1", set64(record + 48, 2n ** 64n - 1n)],
    ["目录位置 2^53", set64(record + 48, 2n ** 53n)],
    ["目录位置在文件末尾", set64(record + 48, BigInt(good.length - 1))],
    ["定位记录指到 2^63", set64(locator + 8, 2n ** 63n)],
    ["定位记录指到文件末尾", set64(locator + 8, BigInt(good.length - 4))],
    ["定位记录指到 0", set64(locator + 8, 0n)],
  ];
  // 每个目录项的 ZIP64 扩展字段：原大小、压缩后大小、位置
  let seen = 0;
  for (let at = 0; at + 4 <= good.length; at += 1) {
    if (good.readUInt32LE(at) !== CENTRAL) continue;
    if (seen === SHEET_INDEX) {
      const extra = at + 46 + good.readUInt16LE(at + 28);
      lies.push(["原大小 2^63", set64(extra + 4, 2n ** 63n)], ["原大小 2^40", set64(extra + 4, 2n ** 40n)], ["压缩后大小 2^63", set64(extra + 12, 2n ** 63n)], ["压缩后大小 2^40", set64(extra + 12, 2n ** 40n)], ["位置 2^63", set64(extra + 20, 2n ** 63n)], ["位置 2^40", set64(extra + 20, 2n ** 40n)]);
      // 扩展字段的长度写短 / 写长
      for (const length of [0, 4, 8, 0xffff]) {
        const copy = Buffer.from(good);
        copy.writeUInt16LE(length, extra + 2);
        lies.push([`扩展字段长度 ${length}`, copy]);
      }
    }
    seen += 1;
  }
  for (const [label, bytes] of lies) {
    const result = outcome(bytes);
    if ("rows" in result) assert.deepEqual(result.rows, SIMPLE_ROWS, label);
    else assert.ok(["CORRUPT", "NOT_XLSX", "TOO_LARGE"].includes(result.code), `${label}：${JSON.stringify(result)}`);
  }
  // 直接用 zip 的函数：也只会是 ZipError
  for (const [label, bytes] of lies) {
    assert.equal(typeof hasZipEntry(bytes, "xl/workbook.xml"), "boolean", label);
    try {
      unzipEntry(bytes, "xl/worksheets/sheet1.xml", 1024 * 1024);
    } catch (err) {
      assert.ok(err instanceof ZipError, `${label}：${(err as Error).name} ${(err as Error).message}`);
    }
  }
});

test("截断：合法文件在每一个长度截断（三种压缩包写法）——只会是读对或受控的拒绝", () => {
  for (const options of [{}, { dataDescriptor: true }, { zip64: true }]) {
    const good = buildZip(parts(SIMPLE, { sst: "<sst><si><t>x</t></si></sst>", rootRels: '<Relationships><Relationship Id="rId1" Type="http://x/officeDocument" Target="xl/workbook.xml"/></Relationships>' }), options);
    for (let length = 0; length < good.length; length += 1) {
      const result = outcome(good.subarray(0, length));
      assert.ok("code" in result, `截到 ${length} 字节不应当还读得出来`);
    }
  }
  // 空文件、只有标记、只有结尾记录
  rejected(Buffer.alloc(0), ["NOT_XLSX"]);
  rejected(Buffer.from("PK\u0003\u0004"), ["NOT_XLSX", "CORRUPT"]);
  rejected(buildZip([]), ["NOT_XLSX", "CORRUPT"]);
  rejected(Buffer.alloc(XLSX_LIMITS.maxFileBytes + 1, 0x50), ["TOO_LARGE"]);
});

// ---- XML ----

test("XML 的危险写法：DOCTYPE、实体（内部、外部、参数实体、十亿笑声）、XInclude、处理指令——拒绝或不解析，绝不去读外面的东西", () => {
  const lol = `<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;"><!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">]>`;
  const cell = '<row r="1"><c r="A1" t="inlineStr"><is><t>&xxe;&lol3;</t></is></c></row>';
  const dangerous = [
    `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><worksheet><sheetData>${cell}</sheetData></worksheet>`,
    `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY % ext SYSTEM "http://127.0.0.1:9/x.dtd">%ext;]><worksheet><sheetData>${cell}</sheetData></worksheet>`,
    `<?xml version="1.0"?>${lol}<worksheet><sheetData>${cell}</sheetData></worksheet>`,
    `<?xml version="1.0"?><!doctype foo SYSTEM "http://127.0.0.1:9/x.dtd"><worksheet><sheetData>${cell}</sheetData></worksheet>`,
    `<?xml version="1.0"?>\n\n  <!DOCTYPE\nfoo [<!ENTITY xxe SYSTEM "file:///etc/hostname">]><worksheet><sheetData>${cell}</sheetData></worksheet>`,
  ];
  for (const xml of dangerous) {
    rejected(pkg(xml), ["UNSAFE"], "工作表");
    rejected(pkg(SIMPLE, { sst: xml }), ["UNSAFE"], "共享字符串");
    rejected(pkg(SIMPLE, { workbook: xml.replace("<worksheet>", '<workbook xmlns:r="x"><sheets><sheet name="a" r:id="rId1"/></sheets></workbook><worksheet>') }), ["UNSAFE"], "工作簿");
    rejected(pkg(SIMPLE, { rels: `${xml}${RELS}` }), ["UNSAFE"], "关系文件");
  }
  // 没有声明的实体：不展开，原样留着；预定义的五个和数字引用照认；越界的、代理区的数字引用丢掉
  assert.deepEqual(rowsOf(pkg(ws('<row r="1"><c r="A1" t="inlineStr"><is><t>&xxe;|&amp;&lt;&gt;&quot;&apos;|&#x4e1c;&#20140;|&#xD800;&#0;&#x110000;&#99999999;|&amp;lt;</t></is></c></row>'))), [["t:&xxe;|&<>\"'|东京|&#99999999;|&lt;"]]);
  // XInclude、处理指令、外部样式表：不认识的标签一律不管
  assert.deepEqual(rowsOf(pkg(`${HEAD}<?xml-stylesheet href="http://127.0.0.1:9/x.xsl"?><worksheet xmlns:xi="http://www.w3.org/2001/XInclude"><xi:include href="file:///etc/passwd" parse="text"/><sheetData><row r="1"><c r="A1"><v>7</v></c></row></sheetData></worksheet>`)), [["n:7"]]);
  // 指向外部的关系（超链接、外部工作簿）：忽略
  assert.deepEqual(rowsOf(pkg(SIMPLE, { rels: `<Relationships><Relationship Id="rId9" Type="http://x/hyperlink" Target="http://127.0.0.1:9/" TargetMode="External"/><Relationship Id="rId8" Type="http://x/externalLinkPath" Target="file:///C:/a.xlsx" TargetMode="External"/>${RELS.slice("<Relationships>".length)}` })), SIMPLE_ROWS);
});

test("刁难解析的 XML：百万层嵌套、8 MB 的属性、百万个重复的行 / 单元格 / 公式标签、没有尽头的标签——几万字节的上传最多读几秒，不卡死", () => {
  const cases: [string, string, Parts?][] = [
    ["50 万层嵌套", ws(`<row r="1"><c r="A1" t="inlineStr"><is>${"<r>".repeat(500_000)}<t>x</t>${"</r>".repeat(500_000)}</is></c></row>`)],
    ["只开不关的 100 万层", ws("<a>".repeat(1_000_000))],
    ["8 MB 的属性", ws(`<row r="1" x="${"a".repeat(8_000_000)}"><c r="A1"><v>1</v></c></row>`)],
    ["400 万个假属性", ws(`<row r="1"${" r".repeat(4_000_000)}><c r="A1"><v>1</v></c></row>`)],
    ["130 万个同一行", ws('<row r="1"/>'.repeat(1_300_000))],
    ["140 万个同一格", ws(`<row r="1">${'<c r="A1"/>'.repeat(1_400_000)}</row>`)],
    ["70 万个同一格带值", ws(`<row r="1">${'<c r="A1"><v>1</v></c>'.repeat(700_000)}</row>`)],
    ["一格里 390 万个公式标签", ws(`<row r="1"><c r="A1"><v>1</v>${"<f/>".repeat(3_900_000)}</c></row>`)],
    ["300 万个带前缀的残缺标签", ws("<a:".repeat(3_000_000))],
    ["800 万字的标签名不结束", ws(`<${"a".repeat(8_000_000)}`)],
    ["400 万个 <a", ws("<a".repeat(4_000_000))],
    ["15 MB 的 <", ws("<".repeat(15_000_000))],
    ["15 MB 的 &", ws(`<row r="1"><c r="A1" t="inlineStr"><is><t>${"&".repeat(15_000_000)}</t></is></c></row>`)],
    ["共享字符串 19 万条", ws('<row r="1"><c r="A1" t="s"><v>0</v></c></row>'), { sst: `<sst>${"<si><t>a</t></si>".repeat(190_000)}</sst>` }],
    ["共享字符串里 100 万段富文本", ws('<row r="1"><c r="A1" t="s"><v>0</v></c></row>'), { sst: `<sst><si>${"<r><t>a</t></r>".repeat(1_000_000)}</si></sst>` }],
    ["只开不关的 si 100 万个", ws('<row r="1"><c r="A1" t="s"><v>0</v></c></row>'), { sst: `<sst>${"<si>".repeat(1_000_000)}</sst>` }],
    ["工作簿里 50 万张表", SIMPLE, { workbook: `<workbook><sheets>${'<sheet name="a" r:id="rId1"/>'.repeat(500_000)}</sheets></workbook>` }],
    ["关系文件 20 万条", SIMPLE, { rels: `<Relationships>${'<Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/>'.repeat(200_000)}</Relationships>` }],
  ];
  for (const [label, xml, options] of cases) {
    const bytes = pkg(xml, options ?? {});
    assert.ok(bytes.length < XLSX_LIMITS.maxFileBytes, `${label}：样本 ${bytes.length} 字节，能通过上传的大小限制`);
    const started = performance.now();
    const result = outcome(bytes);
    assert.ok(performance.now() - started < 10_000, `${label} 用了 ${Math.round(performance.now() - started)} ms`);
    if ("code" in result) assert.ok(["TOO_LARGE", "CORRUPT"].includes(result.code), `${label}：${JSON.stringify(result)}`);
  }
});

test("行列和文字的上限：第 5001 行、第 61 列、2001 个字的单元格、XFD 列、行号写成天文数字——TOO_LARGE，刚好在上限上的读得出来", () => {
  const at = (row: string, cellRef: string): string => ws(`<row r="${row}"><c r="${cellRef}"><v>1</v></c></row>`);
  assert.equal(rowsOf(pkg(at("5000", "A5000"))).length, 5000);
  rejected(pkg(at("5001", "A5001")), ["TOO_LARGE"]);
  for (const row of ["1048576", "99999999", "1e9", "9007199254740993"]) rejected(pkg(at(row, "A1")), ["TOO_LARGE"], `行号 ${row}`);
  assert.equal(rowsOf(pkg(at("1", "BH1")))[0]?.length, 60);
  for (const column of ["BI1", "XFD1", "ZZZ1"]) rejected(pkg(at("1", column)), ["TOO_LARGE"], column);
  // 不带位置的单元格一个接一个：第 61 个被拒绝
  assert.equal(rowsOf(pkg(ws(`<row>${"<c><v>1</v></c>".repeat(60)}</row>`)))[0]?.length, 60);
  rejected(pkg(ws(`<row>${"<c><v>1</v></c>".repeat(61)}</row>`)), ["TOO_LARGE"]);
  rejected(pkg(ws("<row/>".repeat(5001))), ["TOO_LARGE"]);
  const text = (length: number): string => ws(`<row r="1"><c r="A1" t="inlineStr"><is><t>${"字".repeat(length)}</t></is></c></row>`);
  assert.equal(rowsOf(pkg(text(2000)))[0]?.[0]?.length, 2002);
  rejected(pkg(text(2001)), ["TOO_LARGE"]);
  rejected(pkg(ws('<row r="1"><c r="A1" t="s"><v>0</v></c></row>'), { sst: `<sst><si><t>${"字".repeat(2001)}</t></si></sst>` }), ["TOO_LARGE"]);
  // 位置写法不对：小写、带 $、四个字母、没有行号、空
  for (const reference of ["a1", "$A$1", "AAAA1", "A", "1", "", "A1:B2", "A-1", "Ａ１"]) rejected(pkg(at("1", reference)), ["CORRUPT"], `位置 ${JSON.stringify(reference)}`);
});

test("单元格的各种类型：共享字符串、富文本、行内字符串、布尔、错误值、ISO 日期、公式（带缓存值、共享公式、数组公式、空公式）、数字原文一位不改", () => {
  const sst = "<sst><si><t>区域</t></si><si><r><rPr><b/></rPr><t>东京</t></r><r><t xml:space=\"preserve\"> 市区</t></r><rPh sb=\"0\" eb=\"2\"><t>トウキョウ</t></rPh><phoneticPr fontId=\"1\"/></si><si><t/></si><si/><si><t>'=1+1</t></si></sst>";
  const sheet = ws(
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c></row>' +
      '<row r="2"><c r="A2" t="b"><v>1</v></c><c r="B2" t="e"><v>#N/A</v></c><c r="C2" t="e"><v>#DIV/0!</v></c><c r="D2" t="d"><v>2026-10-01T00:00:00Z</v></c><c r="E2" t="str"><v>文字结果</v></c></row>' +
      '<row r="3"><c r="A3"><f>SUM(B3:C3)</f><v>20000</v></c><c r="B3"><f t="shared" ref="B3:B9" si="0">A3*2</f><v>1</v></c><c r="C3"><f t="shared" si="0"/><v>2</v></c><c r="D3" t="str"><f>"a"&amp;"b"</f><v>ab</v></c><c r="E3"><f t="array" ref="E3">{1}</f></c><c r="F3"><f/></c></row>' +
      '<row r="4"><c r="A4"><v>0.30000000000000004</v></c><c r="B4"><v>1E+21</v></c><c r="C4"><v>18500.000000001</v></c><c r="D4"><v>-0</v></c><c r="E4"><v> 12 </v></c><c r="F4"><v>1.2e-7</v></c><c r="G4"><v>9007199254740993</v></c><c r="H4"><v>0012</v></c></row>' +
      '<row r="5"><c r="A5" t="n"><v>NaN</v></c><c r="B5"><v>abc</v></c><c r="C5"><v></v></c><c r="D5"><v/></c><c r="E5" t="inlineStr"><is><t></t></is></c><c r="F5" t="wat"><v>5</v></c><c r="G5" s="3"/></row>',
  );
  const rows = rowsOf(pkg(sheet, { sst }));
  assert.deepEqual(rows[0], ["t:区域", "t:东京 市区", null, null, "t:=1+1"]);
  // 逻辑值读成 TRUE / FALSE（修缺陷之后不再是 1 / 0），和错误值一样各有自己的类型，不混进数字里
  assert.deepEqual(rows[1], ["t:TRUE", "t:#N/A", "t:#DIV/0!", "t:2026-10-01T00:00:00Z", "t:文字结果"]);
  assert.deepEqual(readXlsx(pkg(sheet, { sst }))[1]?.slice(0, 3).map((cell) => cell.type), ["boolean", "error", "error"]);
  assert.deepEqual(rows[2], ["#FORMULA", "#FORMULA", "#FORMULA", "#FORMULA", "#FORMULA", "#FORMULA"], "公式一律不取缓存值");
  assert.deepEqual(rows[3], ["n:0.30000000000000004", "n:1E+21", "n:18500.000000001", "n:-0", "n:12", "n:1.2e-7", "n:9007199254740993", "n:0012"], "数字是文件里的原文，不经过浮点数");
  assert.deepEqual(rows[4]?.slice(0, 5), ["n:NaN", "n:abc", null, null, null]);
});

test("表的结构：乱序的行、重复的行号、缺位置的单元格、夹在中间的空行、合并单元格、隐藏的行列和表、同名的表、多张表、UTF-8 BOM", () => {
  // 行乱序、中间空着：按行号放，空行是空数组
  assert.deepEqual(rowsOf(pkg(ws('<row r="4"><c r="B4"><v>4</v></c></row><row r="1"><c r="A1"><v>1</v></c></row><row r="2"/>'))), [["n:1"], [], [], [null, "n:4"]]);
  // 单元格乱序、带和不带位置混着
  assert.deepEqual(rowsOf(pkg(ws('<row r="1"><c r="C1"><v>3</v></c><c r="A1"><v>1</v></c><c><v>2</v></c></row>'))), [["n:1", "n:2", "n:3"]]);
  // 隐藏的行列照样读；合并单元格只有左上角有值
  const merged = `${HEAD}<worksheet><cols><col min="2" max="2" hidden="1"/></cols><sheetData><row r="1" hidden="1"><c r="A1"><v>1</v></c><c r="B1"><v>2</v></c></row><row r="2"><c r="A2" s="1"/><c r="B2"/></row></sheetData><mergeCells count="1"><mergeCell ref="A1:A2"/></mergeCells></worksheet>`;
  assert.deepEqual(rowsOf(pkg(merged)), [["n:1", "n:2"], [null, null]]);
  // 多张表、隐藏的表、同名的表：按名字找到第一张叫这个名字的；没有就读排第一的
  const book = (sheets: string): string => `${HEAD}<workbook xmlns:r="x"><sheets>${sheets}</sheets></workbook>`;
  const rels = '<Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="t" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="t" Target="worksheets/sheet3.xml"/></Relationships>';
  const extra = [2, 3].map((n) => ({ name: `xl/worksheets/sheet${n}.xml`, content: Buffer.from(ws(`<row r="1"><c r="A1"><v>${n}</v></c></row>`)) }));
  const read = (sheets: string, names: string[]): [string, (string | null)[][]] => {
    const sheet = readXlsxSheet(pkg(ws('<row r="1"><c r="A1"><v>1</v></c></row>'), { workbook: book(sheets), rels, extra }), names);
    return [sheet.name, plain(sheet.rows)];
  };
  assert.deepEqual(read('<sheet name="说明" r:id="rId1"/><sheet name="库存" state="hidden" r:id="rId2"/><sheet name="库存" r:id="rId3"/>', ["库存"]), ["库存", [["n:2"]]]);
  assert.deepEqual(read('<sheet name="说明" state="veryHidden" r:id="rId1"/><sheet name=" 价格 " r:id="rId3"/>', ["库存", "价格"]), [" 价格 ", [["n:3"]]]);
  assert.deepEqual(read('<sheet name="Sheet1" r:id="rId2"/><sheet name="Sheet2" r:id="rId3"/>', ["库存"]), ["Sheet1", [["n:2"]]]);
  // 工作簿里的表指到不存在的部件
  rejected(pkg(SIMPLE, { workbook: book('<sheet name="a" r:id="rId3"/>'), rels }), ["CORRUPT"]);
  // UTF-8 BOM
  assert.deepEqual(rowsOf(pkg(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(SIMPLE)]))), SIMPLE_ROWS);
  // 非法的 UTF-8 字节、控制字符：不崩。标签对得上的读得出来；原来这个样本的标签是对不上的（多了一组结束标签），现在按文件已损坏拒绝
  const garbage = Buffer.from([0xff, 0xfe, 0xc0, 0x80, 0x00, 0x01, 0xed, 0xa0, 0x80]);
  const invalid = outcome(pkg(Buffer.concat([Buffer.from(`${HEAD}<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>`), garbage, Buffer.from("</t></is></c></row></sheetData></worksheet>")])));
  assert.ok("rows" in invalid && invalid.rows.length === 1);
  rejected(pkg(Buffer.concat([Buffer.from(ws('<row r="1"><c r="A1" t="inlineStr"><is><t>')), garbage, Buffer.from("</t></is></c></row></sheetData></worksheet>")])), ["CORRUPT"], "标签对不上");
});

test("公式注入字符和前导单引号的往返：导出的文字在文件里都带着单引号保护；读回来和写进去的一样", () => {
  const values = ["=1+1", "+1", "-1", "@SUM(A1)", "\t=1", "\r=1", "=cmd|' /C calc'!A0", "正常", "a=b", "'", "'普通", "it's", " =1", "＝1", "<b>&\"x\"</b>", "]]>", "<!--x-->", "\u0000\u0001x\u000b", "a\nb", "\ud83d\ude95 \u200f"];
  const bytes = writeXlsx([{ name: "价格", rows: [values] }]);
  const xml = unzipEntry(bytes, "xl/worksheets/sheet1.xml").toString("utf8");
  assert.ok(!/<f[\s>/]/.test(xml), "导出从不写公式");
  for (const match of xml.matchAll(/<t xml:space="preserve">([^<]*)<\/t>/g)) assert.ok(!/^[=+\-@\t\r]/.test(match[1] as string), `文件里的文字不能以公式字符开头：${match[1]}`);
  const read = rowsOf(bytes)[0] as string[];
  assert.deepEqual(read, values.map((value) => `t:${value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")}`));
});

// ---- 模糊测试 ----

test("模糊测试（压缩包层）：对合法文件随机翻转、截断、重复、删除、覆写字节 4000 次——只会是读出来或受控的拒绝", () => {
  const seeds: Buffer[] = [
    writeXlsx([{ name: "价格", rows: [["区域", "基础价"], ["东京市区", { number: "20000" }], ["=横滨", { number: "123.45" }]], header: true }, { name: "填写说明", rows: [["说明"]] }]),
    buildZip(parts(SIMPLE, { sst: "<sst><si><t>x</t></si></sst>" }).map((part) => ({ ...part, method: "store" as const }))),
    buildZip(parts(SIMPLE), { zip64: true }),
    buildZip(parts(SIMPLE), { dataDescriptor: true, comment: "注释" }),
  ];
  const next = random(20261009);
  const pick = (max: number): number => Math.floor(next() * max);
  const started = performance.now();
  let accepted = 0;
  let refused = 0;
  for (let round = 0; round < 4000; round += 1) {
    const seed = seeds[round % seeds.length] as Buffer;
    let bytes = Buffer.from(seed);
    for (let step = 1 + pick(4); step > 0; step -= 1) {
      const at = pick(bytes.length);
      const kind = pick(6);
      if (kind === 0) bytes[at] = (bytes[at] as number) ^ (1 << pick(8));
      else if (kind === 1) bytes[at] = pick(256);
      else if (kind === 2) bytes = bytes.subarray(0, at);
      else if (kind === 3) bytes = Buffer.concat([bytes.subarray(0, at), bytes.subarray(at, Math.min(bytes.length, at + 1 + pick(64))), bytes.subarray(at)]);
      else if (kind === 4) bytes = Buffer.concat([bytes.subarray(0, at), bytes.subarray(Math.min(bytes.length, at + 1 + pick(32)))]);
      else bytes.fill([0x00, 0xff, 0x50, 0x4b][pick(4)] as number, at, Math.min(bytes.length, at + 1 + pick(8)));
      if (bytes.length === 0) break;
    }
    let result: ReturnType<typeof outcome>;
    try {
      result = outcome(bytes, 2_000);
    } catch (err) {
      throw new assert.AssertionError({ message: `第 ${round} 轮（种子 20261009）：${(err as Error).message}；样本 base64：${bytes.toString("base64").slice(0, 400)}` });
    }
    if ("rows" in result) accepted += 1;
    else refused += 1;
  }
  assert.ok(refused > 1000 && accepted > 50, `读出来 ${accepted} 次，拒绝 ${refused} 次`);
  assert.ok(performance.now() - started < 60_000);
});

test("模糊测试（XML 层）：对工作表、共享字符串、工作簿、关系文件的文字随机变异后重新打包（校验值是对的，内容一定会进到解析里）3000 次", () => {
  const sheet = ws(
    '<row r="1" spans="1:3"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><r><t xml:space="preserve">基础价</t></r></is></c><c r="C1" s="1"><v>1.5E+3</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><f>A1</f><v>3</v></c><c r="C2" t="b"><v>1</v></c><c r="D2" t="e"><v>#N/A</v></c></row>',
  );
  const sst = '<sst count="2"><si><t>区域 &amp; &#x4e1c;</t></si><si><r><t>东</t></r><rPh><t>ひがし</t></rPh></si></sst>';
  const rootRels = '<Relationships><Relationship Id="rId1" Type="http://x/officeDocument" Target="xl/workbook.xml"/></Relationships>';
  const relsXml = '<Relationships><Relationship Id="rId1" Type="http://x/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://x/sharedStrings" Target="sharedStrings.xml"/></Relationships>';
  const book = `${HEAD}<workbook xmlns:r="x"><workbookPr date1904="1"/><sheets><sheet name="价格" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  const fragments = ["<", ">", "/", "</c>", "<c>", "<c r=\"A1\">", "<row>", "</row>", "<v>", "</v>", "<f/>", "&", "&#x110000;", "&#0;", "&amp;", "\"", "'", "=", " r=\"ZZ99\"", " r=\"1e9\"", " t=\"s\"", "<v>99999</v>", "<v>-1</v>", "<si>", "</si>", "<t>", "</t>", "<!--", "-->", "<![CDATA[", "]]>", "<?", "?>", "\u0000", "\ufeff", "../", "<sheet name=\"价格\" r:id=\"rId1\"/>", "<Relationship Id=\"rId1\" Target=\"../x\"/>", "<rPh>", "xl/"];
  const next = random(5_2026);
  const pick = (max: number): number => Math.floor(next() * max);
  const mutate = (text: string): string => {
    let out = text;
    for (let step = 1 + pick(5); step > 0; step -= 1) {
      const at = pick(out.length + 1);
      const kind = pick(5);
      if (kind === 0) out = out.slice(0, at) + (fragments[pick(fragments.length)] as string) + out.slice(at);
      else if (kind === 1) out = out.slice(0, at) + out.slice(at + 1 + pick(12));
      else if (kind === 2) out = out.slice(0, at) + out.slice(at, at + 1 + pick(40)).repeat(2 + pick(3)) + out.slice(at);
      else if (kind === 3) out = out.slice(0, at);
      else out = out.slice(0, at) + String.fromCharCode(pick(0x250)) + out.slice(at + 1);
    }
    return out;
  };
  const started = performance.now();
  const seen = { rows: 0, code: 0 };
  for (let round = 0; round < 3000; round += 1) {
    const target = round % 5;
    const bytes = pkg(target === 0 ? mutate(sheet) : sheet, { sst: target === 1 ? mutate(sst) : sst, workbook: target === 2 ? mutate(book) : book, rels: target === 3 ? mutate(relsXml) : relsXml, rootRels: target === 4 ? mutate(rootRels) : rootRels });
    let result: ReturnType<typeof outcome>;
    try {
      result = outcome(bytes, 2_000);
    } catch (err) {
      throw new assert.AssertionError({ message: `第 ${round} 轮（种子 52026，变异的是第 ${target} 个部件）：${(err as Error).message}` });
    }
    seen["rows" in result ? "rows" : "code"] += 1;
  }
  // 两种结果都要有相当的数量（样本没有偏到一边）。扫描器改成严格的之后，标签对不上的一律拒绝，读得出来的比例比原来低
  assert.ok(seen.rows > 100 && seen.code > 100, JSON.stringify(seen));
  assert.ok(performance.now() - started < 60_000);
});

// ---- 缺陷 ----

test("【缺陷】共享字符串的下标越界（或不是整数）被悄悄当成空单元格——库存表里空 = 清除；应当报文件已损坏", () => {
  const sst = "<sst><si><t>日期</t></si></sst>";
  for (const index of ["7", "-1", "abc", "0.5", "1e3"]) {
    const result = outcome(pkg(ws(`<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>${index}</v></c></row>`), { sst }));
    assert.ok("code" in result && result.code === "CORRUPT", `下标 ${index}：期望 CORRUPT，实际 ${JSON.stringify(result)}`);
  }
});

test("【缺陷】属性用单引号或等号两边有空白（合法的 XML）：单元格的位置和类型都读丢——B 列的共享字符串被读成 A 列的数字；应当读对或拒绝", () => {
  const sst = "<sst><si><t>不相干</t></si><si><t>区域</t></si></sst>";
  for (const sheet of [ws("<row r='1'><c r='B1' t='s'><v>1</v></c></row>"), ws('<row r = "1"><c r = "B1" t = "s"><v>1</v></c></row>')]) {
    const result = outcome(pkg(sheet, { sst }));
    if ("rows" in result) assert.deepEqual(result.rows, [[null, "t:区域"]], "没有拒绝的话就要读对");
  }
});

test("【缺陷】XML 注释里的内容被当成真的单元格（注释掉的 <c> 读出了值）；CDATA 里的文字带着 <![CDATA[ 标记原样出来", () => {
  const commented = outcome(pkg(ws('<row r="1"><c r="A1"><v>1</v></c><!-- <c r="B1"><v>999</v></c> --></row>')));
  if ("rows" in commented) assert.deepEqual(commented.rows, [["n:1"]], "注释里的不算");
  const cdata = outcome(pkg(ws('<row r="1"><c r="A1" t="inlineStr"><is><t><![CDATA[a<b>&amp;c]]></t></is></c></row>')));
  if ("rows" in cdata) assert.deepEqual(cdata.rows, [["t:a<b>&amp;c"]], "CDATA 里的是原文");
});

test("【缺陷】工作簿的关系里有指向 ../customXml/ 的部件（带敏感度标签、从 SharePoint / OneDrive 下载的 Excel 文件常见，仍在包内）——整份文件被当成不安全拒绝", () => {
  const rels = `<Relationships>${RELS.slice("<Relationships>".length, -"</Relationships>".length)}<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/customXml" Target="../customXml/item1.xml"/></Relationships>`;
  const bytes = pkg(SIMPLE, { rels, extra: [{ name: "customXml/item1.xml", content: Buffer.from("<a/>") }] });
  assert.deepEqual(outcome(bytes), { rows: SIMPLE_ROWS });
});

test("【缺陷】本来就以单引号加公式字符开头的文字（如 '=A 区）导出再读回来少了一个单引号——导出的区域名原样导入时对不上", () => {
  for (const value of ["'=A 区", "'-5", "'@home", "''=1"]) {
    assert.deepEqual(rowsOf(writeXlsx([{ name: "价格", rows: [[value]] }])), [[`t:${value}`]]);
  }
});

test("样本自检：deflate 流和校验值是按规范拼的（上面被拒绝的用例不是因为样本本身拼错了）", () => {
  const content = Buffer.from(SIMPLE);
  assert.equal(crc32(content) >>> 0, crc32(unzipEntry(pkg(SIMPLE), "xl/worksheets/sheet1.xml")) >>> 0);
  assert.ok(deflateRawSync(content).length > 0);
});
