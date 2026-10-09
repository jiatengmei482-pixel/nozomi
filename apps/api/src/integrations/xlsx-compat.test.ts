/**
 * .xlsx 的兼容性（M1-05）：没有真实的 Office 可用，这里按 Excel / WPS / LibreOffice / openpyxl 存盘时常见的写法现场拼出样本来读，
 * 并核对我们导出的文件具备 Excel 打开时要求的全部部件。样本的写法对照过 openpyxl 生成的文件（开发时一次性核对，见 ADR 0019），
 * 这里不依赖 Python，也不提交任何二进制文件。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { sheetDate } from "@nozomi/domain";
import { type TestZipOptions, buildZip } from "../testing/zip.ts";
import { type XlsxCell, XlsxError, readXlsx, readXlsxSheet, writeXlsx } from "./xlsx.ts";
import { hasZipEntry, unzipEntry } from "./zip.ts";

const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n';
const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const text = (cells: XlsxCell[]): (string | null)[] => cells.map((cell) => (cell.type === "empty" ? null : cell.type === "formula" ? "#FORMULA" : cell.text));

/** 数据表（第二张，叫「价格」）：Excel 存盘时会带上的各种东西都放进去。 */
const DATA_SHEET =
  `${HEAD}<worksheet xmlns="${MAIN}" xmlns:r="${REL}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="x14ac" xmlns:x14ac="http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac">` +
  '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><dimension ref="A1:E9"/>' +
  '<sheetViews><sheetView tabSelected="1" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="B3" sqref="B3"/></sheetView></sheetViews>' +
  '<sheetFormatPr defaultRowHeight="15" x14ac:dyDescent="0.25"/>' +
  '<cols><col min="1" max="1" width="30.7109375" customWidth="1"/><col min="4" max="4" width="9.140625" hidden="1" customWidth="1"/></cols>' +
  "<sheetData>" +
  // 表头：共享字符串，带样式
  '<row r="1" spans="1:5" s="1" customFormat="1" x14ac:dyDescent="0.25"><c r="A1" s="1" t="s"><v>0</v></c><c r="B1" s="1" t="s"><v>1</v></c><c r="C1" s="1" t="s"><v>2</v></c><c r="D1" s="1" t="s"><v>3</v></c><c r="E1" s="1" t="s"><v>4</v></c></row>' +
  // 数字带千分位的显示格式（存的还是数字）、日期存成序号、数字存成文本
  '<row r="2" spans="1:5" x14ac:dyDescent="0.25"><c r="A2" t="s"><v>5</v></c><c r="B2" s="2"><v>20000</v></c><c r="C2" s="3"><v>46296</v></c><c r="D2" t="s"><v>6</v></c><c r="E2" t="s"><v>7</v></c></row>' +
  // 隐藏的行；富文本；日期写成文字；中日韩文字
  '<row r="3" spans="1:5" hidden="1" x14ac:dyDescent="0.25"><c r="A3" t="s"><v>8</v></c><c r="B3"><v>123.45</v></c><c r="C3" t="s"><v>9</v></c><c r="D3" t="s"><v>10</v></c><c r="E3" t="s"><v>11</v></c></row>' +
  // 合并单元格 A4:A5：只有左上角有值，被并进去的那格是只带样式的空格
  '<row r="4" spans="1:5" x14ac:dyDescent="0.25"><c r="A4" s="4" t="s"><v>12</v></c><c r="B4"><v>0.30000000000000004</v></c><c r="C4" s="3"><v>46298</v></c><c r="D4" s="4"/><c r="E4" t="inlineStr"><is><t>行内的字</t></is></c></row>' +
  '<row r="5" spans="1:5" x14ac:dyDescent="0.25"><c r="A5" s="4"/><c r="B5" t="str"><v>文本结果</v></c><c r="C5" t="b"><v>1</v></c></row>' +
  // 行尾只有样式的空行
  '<row r="7" spans="1:5" x14ac:dyDescent="0.25"><c r="A7" s="4"/><c r="B7" s="2"/></row><row r="9" spans="1:5" ht="15.75" customHeight="1" x14ac:dyDescent="0.25"/>' +
  "</sheetData>" +
  '<mergeCells count="1"><mergeCell ref="A4:A5"/></mergeCells><dataValidations count="1"><dataValidation type="list" allowBlank="1" sqref="D2:D100"><formula1>"启用,停用"</formula1></dataValidation></dataValidations>' +
  '<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/><pageSetup paperSize="9" orientation="portrait" r:id="rId1"/></worksheet>';

const SHARED = [
  "<t>区域</t>",
  "<t>基础价</t>",
  "<t>生效开始</t>",
  "<t>备注</t>",
  "<t>数字文本</t>",
  "<t>东京市区</t>",
  '<t xml:space="preserve"> 普通 </t>',
  "<t>12000</t>",
  '<r><t>新</t></r><r><rPr><b/><sz val="11"/><color rgb="FFFF0000"/><rFont val="Calibri"/></rPr><t>宿</t></r><r><rPr><sz val="11"/></rPr><t xml:space="preserve">区</t></r>',
  "<t>2026-10-02</t>",
  "<t>서울 / 東京 / 𠮷野家</t>",
  "<t>0012</t>",
  '<t>合并的</t><rPh sb="0" eb="3"><t>ガッペイ</t></rPh><phoneticPr fontId="1" type="noConversion"/>',
];

/** 按 Excel 存盘的样子拼一个完整的包：docProps、主题、样式、两张工作表（数据在第二张）、打印设置、calcChain。 */
function excelPackage(options: { date1904?: boolean; zip?: TestZipOptions; store?: boolean; absoluteTargets?: boolean; workbookPath?: string } = {}): Buffer {
  const workbookPath = options.workbookPath ?? "xl/workbook.xml";
  const target = (path: string): string => (options.absoluteTargets ? `/xl/${path}` : path);
  const parts: [string, string][] = [
    [
      "[Content_Types].xml",
      `${HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="bin" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.printerSettings"/><Override PartName="/${workbookPath}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>`,
    ],
    [
      "_rels/.rels",
      `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId3" Type="${REL}/extended-properties" Target="docProps/app.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId1" Type="${REL}/officeDocument" Target="${workbookPath}"/></Relationships>`,
    ],
    ["docProps/app.xml", `${HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Excel</Application><AppVersion>16.0300</AppVersion></Properties>`],
    ["docProps/core.xml", `${HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:creator>某人</dc:creator></cp:coreProperties>`],
    [
      workbookPath,
      `${HEAD}<workbook xmlns="${MAIN}" xmlns:r="${REL}"><fileVersion appName="xl" lastEdited="7" lowestEdited="7" rupBuild="27425"/><workbookPr${options.date1904 ? ' date1904="1"' : ""} defaultThemeVersion="166925"/>` +
        `<bookViews><workbookView xWindow="-120" yWindow="-120" windowWidth="29040" windowHeight="15840" activeTab="1"/></bookViews>` +
        `<sheets><sheet name="填写说明" sheetId="2" r:id="rId1"/><sheet name="价格" sheetId="1" r:id="rId2"/><sheet name="隐藏的表" sheetId="3" state="hidden" r:id="rId3"/></sheets><definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="1" hidden="1">价格!$A$1:$E$5</definedName></definedNames><calcPr calcId="191029"/></workbook>`,
    ],
    [
      `${workbookPath.slice(0, workbookPath.lastIndexOf("/") + 1)}_rels/${workbookPath.slice(workbookPath.lastIndexOf("/") + 1)}.rels`,
      `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId3" Type="${REL}/worksheet" Target="${target("worksheets/sheet3.xml")}"/><Relationship Id="rId2" Type="${REL}/worksheet" Target="${target("worksheets/sheet1.xml")}"/><Relationship Id="rId1" Type="${REL}/worksheet" Target="${target("worksheets/sheet2.xml")}"/>` +
        `<Relationship Id="rId6" Type="${REL}/sharedStrings" Target="${target("sharedStrings.xml")}"/><Relationship Id="rId5" Type="${REL}/styles" Target="${target("styles.xml")}"/><Relationship Id="rId4" Type="${REL}/theme" Target="${target("theme/theme1.xml")}"/><Relationship Id="rId7" Type="${REL}/externalLink" Target="https://example.com/other.xlsx" TargetMode="External"/></Relationships>`,
    ],
    ["xl/theme/theme1.xml", `${HEAD}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office"/>`],
    ["xl/styles.xml", `${HEAD}<styleSheet xmlns="${MAIN}"><numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts><cellXfs count="5"><xf numFmtId="0"/><xf numFmtId="0" applyFont="1"/><xf numFmtId="3" applyNumberFormat="1"/><xf numFmtId="164" applyNumberFormat="1"/><xf numFmtId="0" applyAlignment="1"/></cellXfs></styleSheet>`],
    ["xl/sharedStrings.xml", `${HEAD}<sst xmlns="${MAIN}" count="${SHARED.length}" uniqueCount="${SHARED.length}">${SHARED.map((entry) => `<si>${entry}</si>`).join("")}</sst>`],
    ["xl/worksheets/sheet1.xml", DATA_SHEET],
    ["xl/worksheets/sheet2.xml", `${HEAD}<worksheet xmlns="${MAIN}"><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>这一张是说明，不是数据</t></is></c></row></sheetData></worksheet>`],
    ["xl/worksheets/sheet3.xml", `${HEAD}<worksheet xmlns="${MAIN}"><sheetData/></worksheet>`],
    ["xl/worksheets/_rels/sheet1.xml.rels", `${HEAD}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/printerSettings" Target="../printerSettings/printerSettings1.bin"/></Relationships>`],
    ["xl/printerSettings/printerSettings1.bin", "\u0000\u0001binary"],
    ["xl/calcChain.xml", `${HEAD}<calcChain xmlns="${MAIN}"/>`],
  ];
  return buildZip(parts.map(([name, content]) => ({ name, content: Buffer.from(content, "utf8"), ...(options.store ? { method: "store" as const } : {}) })), options.zip ?? {});
}

const EXPECTED = [
  ["区域", "基础价", "生效开始", "备注", "数字文本"],
  ["东京市区", "20000", "46296", " 普通 ", "12000"],
  ["新宿区", "123.45", "2026-10-02", "서울 / 東京 / 𠮷野家", "0012"],
  ["合并的", "0.30000000000000004", "46298", null, "行内的字"],
  [null, "文本结果", "TRUE"],
  [],
  [null, null],
  [],
  [],
];

test("Excel 存盘的那种完整的包：有名字对得上的工作表就读它（哪怕不是第一张、哪怕有隐藏的表）；样式、列宽、冻结、合并、数据验证、打印设置、docProps、主题都不妨碍读", () => {
  const sheet = readXlsxSheet(excelPackage(), ["价格"]);
  assert.deepEqual([sheet.name, sheet.date1904], ["价格", false]);
  assert.deepEqual(sheet.rows.map(text), EXPECTED);
  assert.deepEqual(sheet.rows[1]?.map((cell) => cell.type), ["text", "number", "number", "text", "text"], "数字存成文本的还是文本，由导入去认");
  // 没有指定名字（或名字对不上）：读工作簿里排第一的那张
  assert.deepEqual(readXlsx(excelPackage()).map(text), [["这一张是说明，不是数据"]]);
  assert.equal(readXlsxSheet(excelPackage(), ["库存"]).name, "填写说明");
  assert.equal(readXlsxSheet(excelPackage(), ["库存", "价格"]).name, "价格", "按给的先后找");
});

test("日期的两种纪元：1900（默认）和 1904（老版本的 Mac Excel）——文件里声明了 1904 就按 1904 算，同一个序号差四年多", () => {
  const modern = readXlsxSheet(excelPackage(), ["价格"]);
  const mac = readXlsxSheet(excelPackage({ date1904: true }), ["价格"]);
  assert.deepEqual([modern.date1904, mac.date1904], [false, true]);
  const serial = (sheet: typeof modern): string => (sheet.rows[1]?.[2] as { text: string }).text;
  assert.equal(sheetDate(serial(modern), { date1904: modern.date1904 }), "2026-10-01");
  assert.equal(sheetDate(serial(mac), { date1904: mac.date1904 }), "2030-10-02", "同一个 46296，在 1904 纪元的文件里是另一天");
  assert.equal(sheetDate("44834", { date1904: true }), "2026-10-01");
  // 写成文字的日期不受影响
  assert.equal(sheetDate((mac.rows[2]?.[2] as { text: string }).text, { date1904: true }), "2026-10-02");
  // date1904="true" / "0" / "false" 的写法
  const declared = (value: string): boolean => {
    const bytes = buildZip([
      { name: "xl/workbook.xml", content: Buffer.from(`<workbook><workbookPr date1904="${value}"/></workbook>`) },
      { name: "xl/worksheets/sheet1.xml", content: Buffer.from("<worksheet><sheetData/></worksheet>") },
    ]);
    return readXlsxSheet(bytes).date1904;
  };
  assert.deepEqual(["1", "true", "0", "false"].map(declared), [true, true, false, false]);
});

test("压缩包的各种写法：不压缩、不同的压缩级别、带数据描述符（Excel 存盘、流式写出）、ZIP64（.NET、Go 的工具对小文件也这样写）、带注释——读出来的内容一样", () => {
  const variants: [string, Buffer][] = [
    ["不压缩", excelPackage({ store: true })],
    ["压缩级别 1", excelPackage({ zip: { level: 1 } })],
    ["压缩级别 9", excelPackage({ zip: { level: 9 } })],
    ["数据描述符", excelPackage({ zip: { dataDescriptor: true } })],
    ["ZIP64", excelPackage({ zip: { zip64: true } })],
    ["ZIP64 + 数据描述符", excelPackage({ zip: { zip64: true, dataDescriptor: true } })],
    ["带注释", excelPackage({ zip: { comment: "由某软件生成 ".repeat(50) } })],
  ];
  for (const [name, bytes] of variants) assert.deepEqual(readXlsxSheet(bytes, ["价格"]).rows.map(text), EXPECTED, name);
});

test("部件位置的各种写法：关系里用绝对路径（/xl/…）、工作簿不叫 workbook.xml（由包的根关系指出）、指向外部的关系被忽略", () => {
  assert.deepEqual(readXlsxSheet(excelPackage({ absoluteTargets: true }), ["价格"]).rows.map(text), EXPECTED);
  assert.deepEqual(readXlsxSheet(excelPackage({ workbookPath: "xl/workbook2.xml" }), ["价格"]).rows.map(text), EXPECTED);
  // 根关系把工作簿指到 xl/ 以外：不认
  assert.throws(() => readXlsxSheet(excelPackage({ workbookPath: "other/book.xml" })), (err: unknown) => err instanceof XlsxError && err.code === "UNSAFE");
});

test("WPS、LibreOffice、openpyxl 常见的写法：严格模式的命名空间、行内字符串、没有 spans 和 dimension、单元格带 xml:space、布尔和错误值", () => {
  const strict = "http://purl.oclc.org/ooxml/spreadsheetml/main";
  const sheetXml =
    `${HEAD}<worksheet xmlns="${strict}"><sheetData>` +
    '<row r="1"><c r="A1" t="inlineStr"><is><t>日期</t></is></c><c r="B1" t="inlineStr"><is><t xml:space="preserve">可售单数</t></is></c></row>' +
    '<row r="2"><c r="A2" t="inlineStr"><is><t>2026-10-09</t></is></c><c r="B2" t="n"><v>3</v></c></row>' +
    '<row r="3"><c r="A3" t="d"><v>2026-10-10T00:00:00Z</v></c><c r="B3"><v>5.0</v></c></row>' +
    '<row r="4"><c r="A4" t="e"><v>#N/A</v></c><c r="B4" t="b"><v>0</v></c></row>' +
    "</sheetData></worksheet>";
  const bytes = buildZip([
    { name: "[Content_Types].xml", content: Buffer.from("<Types/>") },
    { name: "_rels/.rels", content: Buffer.from(`<Relationships><Relationship Id="rId1" Type="http://purl.oclc.org/ooxml/officeDocument/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    { name: "xl/workbook.xml", content: Buffer.from(`${HEAD}<workbook xmlns="${strict}" xmlns:r="http://purl.oclc.org/ooxml/officeDocument/relationships"><sheets><sheet name="库存" sheetId="1" r:id="rId1"/></sheets></workbook>`) },
    { name: "xl/_rels/workbook.xml.rels", content: Buffer.from(`<Relationships><Relationship Id="rId1" Type="http://purl.oclc.org/ooxml/officeDocument/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`) },
    { name: "xl/worksheets/sheet1.xml", content: Buffer.from(sheetXml) },
  ]);
  const sheet = readXlsxSheet(bytes, ["库存"]);
  assert.deepEqual(sheet.rows.map(text), [["日期", "可售单数"], ["2026-10-09", "3"], ["2026-10-10T00:00:00Z", "5.0"], ["#N/A", "FALSE"]]);
  assert.equal(sheetDate("2026-10-10T00:00:00Z"), "2026-10-10", "存成日期类型的单元格（ISO 写法）也认");
});

test("我们导出的文件：Excel 打开时要求的部件一个不少，彼此对得上（缺了会报「文件已损坏」的那些）", () => {
  const bytes = writeXlsx([
    { name: "价格", header: true, columnWidths: [20, 12], rows: [["区域", "基础价"], ["东京 & <大阪>", { number: "20000" }], ["=1+1", null]] },
    { name: "填写说明", rows: [["说明"]] },
  ]);
  const part = (name: string): string => unzipEntry(bytes, name).toString("utf8");
  // 1. [Content_Types].xml：rels 和 xml 的默认类型，工作簿、每张工作表、样式都有 Override，而且指到的部件都在包里
  const types = part("[Content_Types].xml");
  assert.match(types, /<Default Extension="rels" ContentType="application\/vnd\.openxmlformats-package\.relationships\+xml"\/>/);
  assert.match(types, /<Default Extension="xml" ContentType="application\/xml"\/>/);
  const overrides = [...types.matchAll(/<Override PartName="\/([^"]+)" ContentType="([^"]+)"\/>/g)].map((match) => [match[1], match[2]]);
  assert.deepEqual(overrides, [
    ["xl/workbook.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"],
    ["xl/styles.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"],
    ["xl/worksheets/sheet1.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"],
    ["xl/worksheets/sheet2.xml", "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"],
  ]);
  for (const [name] of overrides) assert.ok(hasZipEntry(bytes, name as string), `${name} 在包里`);
  // 2. 根关系指到工作簿
  assert.match(part("_rels/.rels"), /<Relationship Id="rId1" Type="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships\/officeDocument" Target="xl\/workbook\.xml"\/>/);
  // 3. 工作簿里每张表的 r:id 在关系文件里都有，指到的工作表都在包里；表名不重复、sheetId 不重复
  const workbook = part("xl/workbook.xml");
  assert.match(workbook, /xmlns="http:\/\/schemas\.openxmlformats\.org\/spreadsheetml\/2006\/main"/);
  assert.match(workbook, /xmlns:r="http:\/\/schemas\.openxmlformats\.org\/officeDocument\/2006\/relationships"/);
  const sheets = [...workbook.matchAll(/<sheet name="([^"]+)" sheetId="(\d+)" r:id="([^"]+)"\/>/g)].map((match) => ({ name: match[1], sheetId: match[2], rid: match[3] as string }));
  assert.deepEqual(sheets.map((sheet) => sheet.name), ["价格", "填写说明"]);
  assert.equal(new Set(sheets.map((sheet) => sheet.sheetId)).size, 2);
  const relations = new Map([...part("xl/_rels/workbook.xml.rels").matchAll(/<Relationship Id="([^"]+)" Type="[^"]+\/(\w+)" Target="([^"]+)"\/>/g)].map((match) => [match[1] as string, { type: match[2], target: match[3] as string }]));
  for (const sheet of sheets) {
    assert.equal(relations.get(sheet.rid)?.type, "worksheet");
    assert.ok(hasZipEntry(bytes, `xl/${relations.get(sheet.rid)?.target}`));
  }
  assert.ok([...relations.values()].some((relation) => relation.type === "styles" && relation.target === "styles.xml"));
  // 4. 样式表：单元格用到的样式编号都有定义；有 cellStyleXfs 和名叫 Normal 的内置样式（没有的话有的软件会警告）
  const styles = part("xl/styles.xml");
  const defined = Number(/<cellXfs count="(\d+)">/.exec(styles)?.[1]);
  const sheetXml = part("xl/worksheets/sheet1.xml");
  for (const match of sheetXml.matchAll(/ s="(\d+)"/g)) assert.ok(Number(match[1]) < defined, `样式 ${match[1]} 有定义`);
  assert.match(styles, /<cellStyleXfs count="1">/);
  assert.match(styles, /<cellStyle name="Normal" xfId="0" builtinId="0"\/>/);
  for (const count of ["fonts", "fills", "borders", "cellXfs"]) {
    const declared = Number(new RegExp(`<${count} count="(\\d+)">`).exec(styles)?.[1]);
    const actual = (new RegExp(`<${count} count="\\d+">(.*?)</${count}>`).exec(styles)?.[1] ?? "").split(count === "cellXfs" ? "<xf " : count === "fonts" ? "<font>" : count === "fills" ? "<fill>" : "<border>").length - 1;
    assert.equal(actual, declared, `${count} 的 count 和实际个数一致`);
  }
  // 5. 工作表：各部分按规范的先后（sheetViews → cols → sheetData）；行号、单元格位置递增；特殊字符转义；没有公式
  assert.ok(sheetXml.indexOf("<sheetViews>") < sheetXml.indexOf("<cols>") && sheetXml.indexOf("<cols>") < sheetXml.indexOf("<sheetData>"));
  assert.deepEqual([...sheetXml.matchAll(/<row r="(\d+)">/g)].map((match) => Number(match[1])), [1, 2, 3]);
  assert.deepEqual([...sheetXml.matchAll(/<c r="([A-Z]+\d+)"/g)].map((match) => match[1]), ["A1", "B1", "A2", "B2", "A3"]);
  assert.ok(sheetXml.includes("东京 &amp; &lt;大阪&gt;") && sheetXml.includes("'=1+1") && !sheetXml.includes("<f>"));
  // 6. 每一份都是带声明的 UTF-8 XML，没有 BOM
  for (const name of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"]) {
    assert.ok(part(name).startsWith('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'), name);
  }
  // 7. 压缩包的第一个文件是 [Content_Types].xml（有的软件靠它认类型）
  assert.equal(bytes.toString("latin1", 30, 30 + 19), "[Content_Types].xml");
  // 读得回来
  assert.deepEqual(readXlsxSheet(bytes, ["价格"]).rows.map(text), [["区域", "基础价"], ["东京 & <大阪>", "20000"], ["=1+1"]]);
});
