/** .xlsx 的读写（M1-05）：自己写出来的读得回来；Excel 存的那种写法读得懂；不可信的文件被拒绝而不是卡死或撑爆内存。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildZip } from "../testing/zip.ts";
import { XLSX_LIMITS, type XlsxCell, XlsxError, cellReference, guardFormula, readXlsx, readXlsxSheet, unguardFormula, writeXlsx } from "./xlsx.ts";
import { createZip, hasZipEntry, unzipEntry } from "./zip.ts";

const text = (cells: XlsxCell[]): (string | null)[] => cells.map((cell) => (cell.type === "empty" ? null : cell.type === "formula" ? "#FORMULA" : cell.text));

/** 按 Excel 存盘的写法拼一个文件：共享字符串、数字、带样式的单元格。 */
function excelFile(sheet: string, shared: string[] = [], extra: { name: string; content: Buffer }[] = [], sheetPath = "worksheets/sheet1.xml"): Buffer {
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
  return buildZip([
    { name: "[Content_Types].xml", content: Buffer.from(`${head}<Types/>`) },
    { name: "xl/workbook.xml", content: Buffer.from(`${head}<workbook xmlns:r="x"><sheets><sheet name="价格" sheetId="1" r:id="rId3"/><sheet name="说明" sheetId="2" r:id="rId4"/></sheets></workbook>`) },
    { name: "xl/_rels/workbook.xml.rels", content: Buffer.from(`${head}<Relationships><Relationship Id="rId4" Type="t" Target="worksheets/other.xml"/><Relationship Id="rId3" Type="t" Target="${sheetPath}"/></Relationships>`) },
    { name: "xl/sharedStrings.xml", content: Buffer.from(`${head}<sst count="${shared.length}">${shared.map((entry) => `<si>${entry}</si>`).join("")}</sst>`) },
    { name: "xl/worksheets/sheet1.xml", content: Buffer.from(`${head}<worksheet><sheetData>${sheet}</sheetData></worksheet>`) },
    { name: "xl/worksheets/other.xml", content: Buffer.from(`${head}<worksheet><sheetData><row r="1"><c r="A1"><v>999</v></c></row></sheetData></worksheet>`) },
    ...extra,
  ]);
}

test("写出来的文件读得回来：文字、数字、空单元格、多语言、特殊字符；数字原样进出，不经过浮点数", () => {
  const rows = [
    ["区域", "基础价", "备注"],
    ["东京市区", { number: "20000" }, null],
    ["Shinjuku & <Shibuya> \"x\"", { number: "123.45" }, "第一行\n第二行"],
    ["서울", { number: "-0.1" }, "　全角空格　"],
    [null, null, "只有第三列"],
  ];
  const bytes = writeXlsx([{ name: "价格", rows, header: true, columnWidths: [20, 12, 30] }, { name: "说明", rows: [["这一张不读"]] }]);
  assert.deepEqual(readXlsx(bytes).map(text), [
    ["区域", "基础价", "备注"],
    ["东京市区", "20000"],
    ['Shinjuku & <Shibuya> "x"', "123.45", "第一行\n第二行"],
    ["서울", "-0.1", "　全角空格　"],
    [null, null, "只有第三列"],
  ]);
  assert.deepEqual(readXlsx(bytes)[1]?.map((cell) => cell.type), ["text", "number"]);
  // 同样的内容写出来逐字节相同（确认导入时按文件内容的指纹核对）
  assert.deepEqual(writeXlsx([{ name: "价格", rows }]), writeXlsx([{ name: "价格", rows }]));
  // 是一个合规的 zip：每份 XML 都取得出来
  for (const name of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]) {
    assert.ok(hasZipEntry(bytes, name), name);
    assert.match(unzipEntry(bytes, name).toString("utf8"), /^<\?xml version="1\.0"/, name);
  }
  assert.equal(hasZipEntry(bytes, "xl/worksheets/sheet3.xml"), false);
  assert.throws(() => writeXlsx([]), RangeError);
  assert.throws(() => writeXlsx([{ name: "a/b", rows: [] }]), RangeError);
  assert.throws(() => writeXlsx([{ name: "x".repeat(32), rows: [] }]), RangeError);
  assert.throws(() => writeXlsx([{ name: "数", rows: [[{ number: "1e5" }]] }]), RangeError, "数字只接受十进制写法");
  assert.deepEqual([cellReference(0, 0), cellReference(1, 25), cellReference(9, 26), cellReference(0, 701), cellReference(0, 702)], ["A1", "Z2", "AA10", "ZZ1", "AAA1"]);
});

test("公式注入：以 = + - @ 制表符 回车 开头的文字写出去时前面加单引号，读回来去掉；本来就以单引号开头的也加一个，这样任何文字写进去再读回来都是原样", () => {
  for (const dangerous of ["=1+1", "+cmd|' /C calc'!A0", "-2+3", "@SUM(A1)", "\t=1", "\r=1", '=HYPERLINK("http://evil.example","x")']) {
    assert.equal(guardFormula(dangerous), `'${dangerous}`);
    assert.equal(unguardFormula(guardFormula(dangerous)), dangerous);
  }
  for (const harmless of ["东京", "a=b", "100", "it's", "", " =1"]) assert.equal(guardFormula(harmless), harmless);
  for (const quoted of ["'quoted'", "'=A 区", "''=A", "'-5", "'@x", "'", "''"]) {
    assert.equal(guardFormula(quoted), `'${quoted}`);
    assert.equal(unguardFormula(guardFormula(quoted)), quoted);
  }
  const tricky = ["'=A 区", "''=A", "=A", "'-5", "'@x", "'", "''", "'普通", "it's"];
  assert.deepEqual(readXlsx(writeXlsx([{ name: "s", rows: [tricky] }])).map(text), [tricky]);
  const bytes = writeXlsx([{ name: "s", rows: [["=1+1", "@x", "-5", "正常"]] }]);
  const xml = unzipEntry(bytes, "xl/worksheets/sheet1.xml").toString("utf8");
  assert.ok(xml.includes("<t xml:space=\"preserve\">'=1+1</t>") && xml.includes("'@x") && xml.includes("'-5"), "文件里的文字带着单引号");
  assert.ok(!xml.includes("<f>"), "不写公式");
  assert.deepEqual(readXlsx(bytes).map(text), [["=1+1", "@x", "-5", "正常"]]);
});

test("Excel 存盘的写法：共享字符串（含分段的富文本、拼音注释）、数字（含科学计数）、空单元格和跳过的行列、按工作簿里的顺序取第一张表", () => {
  const sheet =
    '<row r="1" spans="1:4"><c r="A1" s="1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="s"><v>2</v></c></row>' +
    '<row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3" s="2"><v>20000</v></c><c r="C3"><v>1.2E+4</v></c><c r="D3"><v>0.30000000000000004</v></c><c r="E3" t="inlineStr"><is><t>行内</t></is></c><c r="F3" s="3"/><c r="G3" t="b"><v>1</v></c><c r="H3" t="str"><v>文本结果</v></c></row>';
  const shared = ["<t>区域</t>", '<r><rPr><b/></rPr><t>基础</t></r><r><t xml:space="preserve">价 &amp; &#x7A0E;</t></r>', "<t>東京</t><rPh sb=\"0\" eb=\"2\"><t>トウキョウ</t></rPh><phoneticPr fontId=\"1\"/>", "<t>'=不是公式</t>"];
  assert.deepEqual(readXlsx(excelFile(sheet, shared)).map(text), [
    ["区域", "基础价 & 税", null, "東京"],
    [],
    ["=不是公式", "20000", "1.2E+4", "0.30000000000000004", "行内", null, "TRUE", "文本结果"],
  ]);
  // 没有行号、列号的写法（按出现的先后）
  assert.deepEqual(readXlsx(excelFile("<row><c><v>1</v></c><c><v>2</v></c></row><row><c t=\"s\"><v>0</v></c></row>", ["<t>a</t>"])).map(text), [["1", "2"], ["a"]]);
  // 带命名空间前缀的标签
  assert.deepEqual(readXlsx(excelFile('<x:row r="1"><x:c r="A1"><x:v>7</x:v></x:c></x:row>')).map(text), [["7"]]);
  // 没有共享字符串那份文件也行；空表读出来是空的
  assert.deepEqual(readXlsx(writeXlsx([{ name: "空", rows: [] }])), []);
});

test("带公式的单元格标成 formula，不取它的缓存值", () => {
  const rows = readXlsx(excelFile('<row r="1"><c r="A1"><f>1+1</f><v>2</v></c><c r="B1" t="str"><f>HYPERLINK("http://evil.example")</f><v>x</v></c><c r="C1"><v>3</v></c><c r="D1"><f t="shared" si="0"/><v>4</v></c></row>'));
  assert.deepEqual(rows.map(text), [["#FORMULA", "#FORMULA", "3", "#FORMULA"]]);
});

test("不可信的文件：不是 xlsx、损坏、XML 实体、工作表指到文件外面、zip 炸弹、行列和单元格超限——都是明确的拒绝，不卡住", () => {
  const code = (bytes: Uint8Array): string => {
    try {
      readXlsx(bytes);
    } catch (err) {
      if (err instanceof XlsxError) return err.code;
      throw err;
    }
    return "OK";
  };
  const row = '<row r="1"><c r="A1"><v>1</v></c></row>';
  assert.equal(code(Buffer.from("区域,基础价\n东京,20000\n")), "NOT_XLSX", "CSV 改了扩展名");
  assert.equal(code(Buffer.alloc(0)), "NOT_XLSX");
  assert.equal(code(createZip([{ name: "word/document.xml", content: Buffer.from("<w/>") }])), "NOT_XLSX", "是 zip 但不是表格");
  const good = excelFile(row);
  assert.equal(code(good), "OK");
  assert.ok(["CORRUPT", "NOT_XLSX"].includes(code(good.subarray(0, good.length - 40))), "截断的文件");
  assert.equal(code(good.subarray(0, good.length - 40)) === "OK", false);
  const flipped = Buffer.from(good);
  const at = flipped.indexOf("sheetData");
  flipped[at + 60] = (flipped[at + 60] as number) ^ 0xff;
  assert.ok(["CORRUPT", "OK"].includes(code(flipped)));
  // XML 外部实体 / 实体炸弹
  assert.equal(code(excelFile(row, ['<t>&xxe;</t>'], [], "worksheets/sheet1.xml").subarray(0)), "OK", "不认识的实体原样留着，不展开");
  const bomb = buildZip([
    { name: "xl/workbook.xml", content: Buffer.from("<workbook/>") },
    { name: "xl/worksheets/sheet1.xml", content: Buffer.from('<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;">]><worksheet><sheetData><row><c t="inlineStr"><is><t>&lol2;</t></is></c></row></sheetData></worksheet>') },
  ]);
  assert.equal(code(bomb), "UNSAFE");
  assert.equal(code(excelFile(row, ['<t>x</t><!ENTITY a SYSTEM "file:///etc/passwd">'])), "UNSAFE");
  // 工作表的位置指到压缩包外面 / 别处
  for (const target of ["../../../etc/passwd", "/etc/passwd", "..\\\\..\\\\x.xml", "file:///etc/passwd", "worksheets/../../secret.xml"]) assert.equal(code(excelFile(row, [], [], target)), "UNSAFE", target);
  assert.equal(code(excelFile(row, [], [], "worksheets/missing.xml")), "CORRUPT");
  // zip 炸弹：20 MB 的工作表压缩后只有几十 KB
  const huge = excelFile(row, [], []);
  const inflated = buildZip([
    { name: "xl/workbook.xml", content: Buffer.from("<workbook/>") },
    { name: "xl/worksheets/sheet1.xml", content: Buffer.concat([Buffer.from("<worksheet><sheetData>"), Buffer.alloc(20 * 1024 * 1024, 0x20), Buffer.from("</sheetData></worksheet>")]) },
  ]);
  assert.ok(inflated.length < XLSX_LIMITS.maxFileBytes && huge.length < inflated.length * 100);
  assert.equal(code(inflated), "TOO_LARGE");
  // 压缩包目录里谎报大小：解压时就限制了输出，照样拒绝
  const lying = Buffer.from(inflated);
  const central = lying.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  lying.writeUInt32LE(100, central + 24);
  assert.ok(["TOO_LARGE", "CORRUPT"].includes(code(lying)));
  assert.equal(code(Buffer.alloc(XLSX_LIMITS.maxFileBytes + 1, 0x50)), "TOO_LARGE", "文件本身超过上限");
  // 行、列、单元格、共享字符串的上限
  assert.equal(code(excelFile(`<row r="${XLSX_LIMITS.maxRows + 1}"><c r="A${XLSX_LIMITS.maxRows + 1}"><v>1</v></c></row>`)), "TOO_LARGE");
  assert.equal(code(excelFile(`<row r="${XLSX_LIMITS.maxRows}"><c r="A${XLSX_LIMITS.maxRows}"><v>1</v></c></row>`)), "OK");
  assert.equal(code(excelFile('<row r="1"><c r="CA1"><v>1</v></c></row>')), "TOO_LARGE", "第 79 列");
  assert.equal(code(excelFile('<row r="1"><c r="A1" t="inlineStr"><is><t>' + "长".repeat(XLSX_LIMITS.maxCellLength + 1) + "</t></is></c></row>")), "TOO_LARGE");
  assert.equal(code(excelFile('<row r="1"><c r="1A"><v>1</v></c></row>')), "CORRUPT");
});

test("构造出来刁难解析的内容：几 MB 的不闭合标签、没有尽头的属性——用时和长度成正比，不卡住", () => {
  const started = performance.now();
  const nasty = [
    `<row r="1"><c r="A1"><v>1</v></c></row><${"a".repeat(3_000_000)}`,
    `<row r="1"><c r="A1"><v>1</v></c></row>${"<a ".repeat(500_000)}`,
    `<row r="1"><c r="A1" ${'x="y" '.repeat(300_000)}`,
    `<row r="1">${"<c".repeat(1_000_000)}</row>`,
    `<row r="1"><c r="A1" t="inlineStr"><is>${"<t>".repeat(400_000)}</is></c></row>`,
  ];
  for (const sheet of nasty) {
    try {
      readXlsx(excelFile(sheet));
    } catch (err) {
      assert.ok(err instanceof XlsxError, String(err));
    }
  }
  assert.ok(performance.now() - started < 8_000, `用了 ${Math.round(performance.now() - started)} 毫秒`);
});

test("XML 的合法写法都读得对：属性用单引号、等号两边有空白、属性里有实体；注释和处理指令跳过；CDATA 里的是原文；带前缀的标签和属性", () => {
  const shared = ["<t>不相干</t>", "<t>区域</t>"];
  for (const sheet of ["<row r='1'><c r='B1' t='s'><v>1</v></c></row>", '<row r = "1"><c r = "B1" t = "s"><v>1</v></c></row>', '<row\n r="1"\t><c\r\n  t="s"   r="B1" ><v>1</v></c ></row >']) {
    assert.deepEqual(readXlsx(excelFile(sheet, shared)).map(text), [[null, "区域"]], sheet);
  }
  // 注释里的不算；注释、处理指令可以出现在任何地方
  assert.deepEqual(readXlsx(excelFile('<!-- 头 --><row r="1"><c r="A1"><v>1</v></c><!-- <c r="B1"><v>999</v></c> --><?pi <c r="C1"><v>7</v></c> ?></row><!-- <row r="2"><c><v>5</v></c></row> -->')).map(text), [["1"]]);
  // CDATA 里的 < & 都是原文；和普通文字、实体可以接着写；数字也可以放在 CDATA 里
  assert.deepEqual(readXlsx(excelFile('<row r="1"><c r="A1" t="inlineStr"><is><t>a&amp;<![CDATA[<b>&amp;c]]>&lt;d</t></is></c><c r="B1"><v><![CDATA[20000]]></v></c></row>')).map(text), [["a&<b>&amp;c<d", "20000"]]);
  // 属性值里的实体：工作表的名字「价 & 格」
  const named = buildZip([
    { name: "xl/workbook.xml", content: Buffer.from(`<x:workbook xmlns:x="m" xmlns:rel='r'><x:sheets><x:sheet name='说明' rel:id='rId1'/><x:sheet name="价 &amp; &#x683C;" rel:id="rId2"/></x:sheets></x:workbook>`) },
    { name: "xl/_rels/workbook.xml.rels", content: Buffer.from(`<Relationships><Relationship Target='worksheets/a.xml' Id='rId1' Type='t'/><Relationship Target="worksheets/b.xml" Id="rId2" Type="t"/></Relationships>`) },
    { name: "xl/worksheets/a.xml", content: Buffer.from("<worksheet><sheetData/></worksheet>") },
    { name: "xl/worksheets/b.xml", content: Buffer.from("<x:worksheet xmlns:x='m'><x:sheetData><x:row><x:c><x:v>8</x:v></x:c></x:row></x:sheetData></x:worksheet>") },
  ]);
  const sheet = readXlsxSheet(named, ["价 & 格"]);
  assert.deepEqual([sheet.name, sheet.rows.map(text)], ["价 & 格", [["8"]]]);
});

test("读不懂的一律是文件已损坏，不当成空：标签对不上、没有结束、属性没有引号、共享字符串下标不存在、逻辑值写法不对、找不到工作表的内容", () => {
  const code = (bytes: Uint8Array): string => {
    try {
      return JSON.stringify(readXlsx(bytes).map(text));
    } catch (err) {
      if (err instanceof XlsxError) return err.code;
      throw err;
    }
  };
  const broken = [
    '<row r="1"><c r="A1"><v>1</v></row>',
    '<row r="1"><c r="A1"><v>1</v></c>',
    '<row r="1"><c r="A1"><v>1</c></v></row>',
    '<row r="1"><c r=A1><v>1</v></c></row>',
    '<row r="1"><c r="A1><v>1</v></c></row>',
    '<row r="1"><c r><v>1</v></c></row>',
    '<row r="1"><c r="A1"><v>1</v></c></row><!-- 没有结束',
    '<row r="1"><c r="A1"><v><![CDATA[1</v></c></row>',
    '<row r="1"><c r="A1"><c r="B1"/></c></row>',
    '<row r="x"><c r="A1"><v>1</v></c></row>',
    '<row r="0"><c r="A1"><v>1</v></c></row>',
    '<row r="1"><c r="A1" t="b"><v>maybe</v></c></row>',
    '<row r="1"><c r="A1" t="s"><v>0</v></c></row>',
  ];
  for (const sheet of broken) assert.equal(code(excelFile(sheet)), "CORRUPT", sheet);
  for (const index of ["3", "-1", "0.0", "1e0", "x", "99999999999"]) assert.equal(code(excelFile(`<row r="1"><c r="A1" t="s"><v>${index}</v></c></row>`, ["<t>a</t>", "<t>b</t>", "<t>c</t>"])), "CORRUPT", index);
  assert.equal(code(excelFile('<row r="1"><c r="A1" t="s"><v> 2 </v></c><c r="B1" t="s"><v/></c><c r="C1" t="s"/></row>', ["<t>a</t>", "<t>b</t>", "<t>c</t>"])), '[["c",null,null]]', "下标对的、真的没有值的照常");
  // 共享字符串那一份坏了、文件断在一半
  const head = "<worksheet><sheetData>";
  assert.equal(code(buildZip([{ name: "xl/workbook.xml", content: Buffer.from("<workbook/>") }, { name: "xl/worksheets/sheet1.xml", content: Buffer.from(`${head}<row r="1"><c r="A1"><v>1</v></c></row>`) }])), "CORRUPT");
  assert.equal(code(buildZip([{ name: "xl/workbook.xml", content: Buffer.from("<workbook/>") }, { name: "xl/sharedStrings.xml", content: Buffer.from("<sst><si><t>a</t></si><si><t>b") }, { name: "xl/worksheets/sheet1.xml", content: Buffer.from(`${head}</sheetData></worksheet>`) }])), "CORRUPT");
  // 工作簿里的表在关系文件里找不到：不去读别的表
  assert.equal(code(excelFile('<row r="1"><c r="A1"><v>1</v></c></row>', [], [], "worksheets/missing.xml")), "CORRUPT");
  const lost = buildZip([
    { name: "xl/workbook.xml", content: Buffer.from('<workbook xmlns:r="x"><sheets><sheet name="库存" r:id="rId9"/><sheet name="别的" r:id="rId1"/></sheets></workbook>') },
    { name: "xl/_rels/workbook.xml.rels", content: Buffer.from('<Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/></Relationships>') },
    { name: "xl/worksheets/sheet1.xml", content: Buffer.from(`${head}<row r="1"><c r="A1"><v>1</v></c></row></sheetData></worksheet>`) },
  ]);
  assert.equal(code(lost), "CORRUPT");
});

test("单元格的类型：逻辑值是 TRUE / FALSE、错误值是它显示的字，各有自己的类型，不混进数字和文字", () => {
  const rows = readXlsx(excelFile('<row r="1"><c r="A1" t="b"><v>1</v></c><c r="B1" t="b"><v>0</v></c><c r="C1" t="e"><v>#DIV/0!</v></c><c r="D1"><v>1</v></c><c r="E1" t="str"><v>1</v></c><c r="F1" t="b"/></row>'));
  assert.deepEqual(rows[0], [{ type: "boolean", text: "TRUE" }, { type: "boolean", text: "FALSE" }, { type: "error", text: "#DIV/0!" }, { type: "number", text: "1" }, { type: "text", text: "1" }, { type: "empty" }]);
});

test("关系里的目标先归一化：在包里的未知部件（../customXml/…）不妨碍读；要读的部件归一化之后跑到包外、或是外部的，才拒绝", () => {
  const head = '<?xml version="1.0" encoding="UTF-8"?>';
  const make = (sheetTarget: string, extraRels = "", mode = ""): Buffer =>
    buildZip([
      { name: "_rels/.rels", content: Buffer.from(`${head}<Relationships><Relationship Id="rId1" Type="http://x/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://x/custom-properties" Target="../../outside.xml"/></Relationships>`) },
      { name: "xl/workbook.xml", content: Buffer.from(`${head}<workbook xmlns:r="x"><sheets><sheet name="价格" r:id="rId1"/></sheets></workbook>`) },
      { name: "xl/_rels/workbook.xml.rels", content: Buffer.from(`${head}<Relationships><Relationship Id="rId1" Type="http://x/worksheet" Target="${sheetTarget}"${mode}/>${extraRels}</Relationships>`) },
      { name: "xl/worksheets/sheet1.xml", content: Buffer.from(`${head}<worksheet><sheetData><row r="1"><c r="A1"><v>7</v></c></row></sheetData></worksheet>`) },
      { name: "customXml/item1.xml", content: Buffer.from("<a/>") },
    ]);
  const code = (bytes: Uint8Array): string => {
    try {
      return JSON.stringify(readXlsx(bytes).map(text));
    } catch (err) {
      if (err instanceof XlsxError) return err.code;
      throw err;
    }
  };
  const custom = '<Relationship Id="rId5" Type="http://x/customXml" Target="../customXml/item1.xml"/><Relationship Id="rId6" Type="http://x/whatever" Target="../../../etc/passwd"/><Relationship Id="rId7" Type="http://x/link" Target="C:\\a.xlsx"/><Relationship Id="rId8" Type="http://x/externalLink" Target="http://127.0.0.1:9/" TargetMode="External"/>';
  assert.equal(code(make("worksheets/sheet1.xml", custom)), '[["7"]]');
  // 工作表自己的目标：绕一圈还在包里的可以；跑到包外、带盘符、外部的拒绝
  for (const inside of ["./worksheets/sheet1.xml", "worksheets/../worksheets/sheet1.xml", "../xl/worksheets/sheet1.xml", "/xl/worksheets/./sheet1.xml"]) assert.equal(code(make(inside)), '[["7"]]', inside);
  for (const escaping of ["../../xl/worksheets/sheet1.xml", "../../../etc/passwd", "C:\\sheet1.xml", "file:///etc/passwd", "..\\worksheets\\sheet1.xml", ""]) assert.equal(code(make(escaping)), "UNSAFE", escaping);
  assert.equal(code(make("worksheets/sheet1.xml", "", ' TargetMode="External"')), "UNSAFE", "工作表是外部的");
  assert.equal(code(make("../customXml/item1.xml")), "UNSAFE", "工作表指到 xl/ 以外的部件");
  // 共享字符串指到包外
  assert.equal(code(make("worksheets/sheet1.xml", '<Relationship Id="rId2" Type="http://x/sharedStrings" Target="../../shared.xml"/>')), "UNSAFE");
});

test("不是 UTF-8 的表格内容：说清楚是编码的问题，不说成「文件是空的」", () => {
  const sheet = '<worksheet><sheetData><row><c t="inlineStr"><is><t>区域</t></is></c></row></sheetData></worksheet>';
  const pack = (content: Buffer): Buffer => buildZip([{ name: "xl/workbook.xml", content: Buffer.from("<workbook/>") }, { name: "xl/worksheets/sheet1.xml", content }]);
  const failure = (bytes: Uint8Array): [string, string] => {
    try {
      readXlsx(bytes);
    } catch (err) {
      if (err instanceof XlsxError) return [err.code, err.message];
    }
    return ["", ""];
  };
  const swapped = Buffer.from(`\ufeff${sheet}`, "utf16le").swap16();
  for (const content of [Buffer.from(`\ufeff${sheet}`, "utf16le"), Buffer.from(sheet, "utf16le"), swapped, swapped.subarray(2)]) {
    const [code, message] = failure(pack(content));
    assert.equal(code, "CORRUPT");
    assert.match(message, /编码是 UTF-16，只支持 UTF-8/);
  }
  const declared = failure(pack(Buffer.from(`<?xml version="1.0" encoding="GB2312"?>${sheet}`)));
  assert.deepEqual([declared[0], /编码是 GB2312，只支持 UTF-8/.test(declared[1])], ["CORRUPT", true]);
  for (const fine of ['<?xml version="1.0" encoding="UTF-8"?>', "<?xml version='1.0' encoding='utf-8' standalone='yes'?>", '<?xml version="1.0"?>', "\ufeff"]) assert.equal(readXlsx(pack(Buffer.from(`${fine}${sheet}`))).length, 1, fine);
});

test("最坏情况的用时：各项上限之内能造出来的最费时的文件，读一个在一秒以内（目标是几百毫秒；上传期间服务器不处理别的请求）", () => {
  const head = '<?xml version="1.0" encoding="UTF-8"?>';
  const ws = (data: string): string => `${head}<worksheet><sheetData>${data}</sheetData></worksheet>`;
  const book = `${head}<workbook xmlns:r="x"><sheets><sheet name="a" r:id="rId1"/></sheets></workbook>`;
  const rels = '<Relationships><Relationship Id="rId1" Type="http://x/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://x/sharedStrings" Target="sharedStrings.xml"/></Relationships>';
  const pack = (sheet: string, shared?: string): Buffer =>
    buildZip([{ name: "xl/workbook.xml", content: Buffer.from(book) }, { name: "xl/_rels/workbook.xml.rels", content: Buffer.from(rels) }, ...(shared === undefined ? [] : [{ name: "xl/sharedStrings.xml", content: Buffer.from(shared) }]), { name: "xl/worksheets/sheet1.xml", content: Buffer.from(sheet) }]);
  const room = XLSX_LIMITS.maxEntryBytes - 400;
  const fill = (unit: string, bytes: number = room): string => unit.repeat(Math.floor(bytes / unit.length));
  const fullStrings = `<sst>${"<si><t>a</t></si>".repeat(XLSX_LIMITS.maxSharedStrings - 1)}</sst>`;
  const cases: [string, Buffer][] = [
    ["标签数到上限", pack(ws(fill("<a/>")))],
    ["单元格数和共享字符串数都到上限", pack(ws(Array.from({ length: 999 }, (_, row) => `<row r="${row + 1}">${'<c t="s"><v>5</v></c>'.repeat(60)}</row>`).join("")), fullStrings)],
    ["行数、单元格数都在上限以内的大表（5000 行 × 12 格）", pack(ws(Array.from({ length: 5000 }, (_, row) => `<row r="${row + 1}">${"<c><v>12345.67</v></c>".repeat(12)}</row>`).join("")))],
    ["一格里几 MB 的实体", pack(ws(`<row r="1"><c r="A1" t="inlineStr"><is><t>${fill("&amp;")}</t></is></c></row>`))],
    ["每个标签 60 个属性", pack(ws(fill(`<a ${Array.from({ length: 60 }, (_, index) => `a${index}="1"`).join(" ")}/>`)))],
    ["注释和文字交替", pack(ws(fill("x<!--y-->")))],
    ["一格里很多段 CDATA", pack(ws(`<row r="1"><c r="A1" t="inlineStr"><is><t>${fill("<![CDATA[a]]>")}</t></is></c></row>`))],
    ["一条共享字符串里很多段富文本", pack(ws('<row r="1"><c r="A1" t="s"><v>0</v></c></row>'), `<sst><si>${fill("<r><t>a</t></r>")}</si></sst>`)],
    ["工作表和共享字符串都是几 MB 的空白", pack(ws(fill(" ")), `<sst>${fill(" ")}</sst>`)],
  ];
  for (const [label, bytes] of cases) {
    assert.ok(bytes.length < 64 * 1024, `${label}：样本只有 ${bytes.length} 字节（上传的大小限制拦不住）`);
    const started = performance.now();
    try {
      readXlsx(bytes);
    } catch (err) {
      assert.ok(err instanceof XlsxError && err.code === "TOO_LARGE", `${label}：${String(err)}`);
    }
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 1_000, `${label} 用了 ${Math.round(elapsed)} ms`);
  }
  // 行数、单元格数在上限以内的读得出来
  assert.equal(readXlsx(cases[2]?.[1] as Buffer).length, 5000);
});
