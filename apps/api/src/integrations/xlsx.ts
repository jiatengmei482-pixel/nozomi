/**
 * 读写 Excel 的 .xlsx 文件（价格、库存的批量导入导出，M1-05）。只在内存里做，不写磁盘，不引入第三方库（ADR 0019）。
 *
 * .xlsx 是一个 zip 压缩包，里面是几份 XML。这里只支持用得到的那一小部分：
 * - 写：若干张工作表，单元格是文字或数字，第一行可以加粗冻结；不写公式、样式、合并单元格。
 * - 读：一张工作表的全部单元格，文字（共享字符串或行内字符串）和数字都按原文给出，不做任何浮点换算；
 *   逻辑值、错误值各是各的类型，不混进数字和文字里。
 *
 * XML 由一个顺序扫描器（`scanXml`）读：标签、属性（单引号 / 双引号、等号两边的空白）、注释、CDATA、处理指令、
 * 五个预定义实体和数字字符引用；每个字符只看一遍，用时和长度成正比。所有部件（工作簿、关系、共享字符串、工作表）都用它，
 * 没有用正则去匹配标签的地方。读不懂的一律报「文件已损坏」，**不当成空**——空在库存表里等于「清除这一天」。
 *
 * 安全（上传的文件是不可信的输入）：
 * - zip 炸弹：每份 XML 解压后有大小上限（解压时就限制输出，不是解完再看），标签数、嵌套层数、行数、列数、单元格数、单元格长度也有上限，
 *   都收在和业务上限（价格 500 行、库存 366 行、60 列）相称的量级，最坏情况下读一个文件是几百毫秒。
 * - 路径穿越：压缩包里的文件名只用来在包内查找，从不拼成磁盘路径；关系里的目标先归一化（`.`、`..`），
 *   要读的部件（工作簿、工作表、共享字符串）归一化之后不在包里、或是外部的，才拒绝；用不到的部件不管它指到哪里。
 * - XML 实体：不解析 DTD，文件里出现 `<!DOCTYPE` / `<!ENTITY` 这类声明直接拒绝；只认五个预定义实体和数字字符引用。
 * - 公式：读到带公式的单元格标成 `formula`，由调用方当作错误报给用户，不取它的缓存值。
 * - 公式注入（导出的文件被 Excel 打开时）：以 `=`、`+`、`-`、`@`、制表符、回车开头的文字前面加一个单引号，
 *   Excel 会把它当成普通文字显示。本来就以单引号开头的文字也加一个，这样读回来时「去掉开头的一个单引号」对任何文字都能还原。
 */
import { ZipError, createZip, hasZipEntry, isZip, unzipEntry } from "./zip.ts";

export type XlsxErrorCode = "NOT_XLSX" | "CORRUPT" | "TOO_LARGE" | "UNSAFE";

export class XlsxError extends Error {
  readonly code: XlsxErrorCode;
  constructor(code: XlsxErrorCode, message: string) {
    super(message);
    this.name = "XlsxError";
    this.code = code;
  }
}

export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export const XLSX_LIMITS = {
  /** 上传文件本身的大小上限（字节） */
  maxFileBytes: 1024 * 1024,
  /** 工作表、共享字符串这两份 XML 解压后的大小上限（字节）；工作簿和关系文件小得多，另有上限 */
  maxEntryBytes: 4 * 1024 * 1024,
  maxSmallEntryBytes: 256 * 1024,
  /** 一份 XML 里最多多少个标签、最多嵌套多少层 */
  maxTags: 400_000,
  maxDepth: 64,
  maxRows: 5_000,
  maxColumns: 60,
  /** 一张工作表最多多少个单元格（含只有样式的空格） */
  maxCells: 60_000,
  maxCellLength: 2_000,
  maxSharedStrings: 100_000,
} as const;

// ---- 写 ----

/** 要写的单元格：文字；数字（给十进制写法的字符串，原样写进文件，不经过浮点数）；空。 */
export type XlsxWriteCell = string | { number: string } | null;

export interface XlsxWriteSheet {
  name: string;
  rows: XlsxWriteCell[][];
  /** 各列的宽度（字符数）；不给用默认宽度 */
  columnWidths?: number[];
  /** 第一行是表头：加粗并冻结 */
  header?: boolean;
}

function escapeXml(text: string): string {
  // XML 1.0 不允许的控制字符直接去掉
  return text
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const GUARDED_LEAD = /^[=+\-@\t\r']/;

/**
 * 会被 Excel 当成公式的文字前面加单引号（公式注入的防护）。本来就以单引号开头的文字也加一个——
 * 否则 `'=A 区` 写进去、读回来就分不清那个单引号是原有的还是保护用的。
 */
export function guardFormula(text: string): string {
  return GUARDED_LEAD.test(text) ? `'${text}` : text;
}

/** 读回来时去掉开头的一个单引号（`guardFormula` 的逆运算：对任何文字，写进去再读回来都是原样）。 */
export function unguardFormula(text: string): string {
  return text.startsWith("'") ? text.slice(1) : text;
}

function columnLetters(index: number): string {
  let letters = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return letters;
}

/** 单元格的位置写法：第 0 行第 0 列是 `A1`。 */
export function cellReference(row: number, column: number): string {
  return `${columnLetters(column)}${row + 1}`;
}

const DECIMAL = /^-?\d+(\.\d+)?$/;

function sheetXml(sheet: XlsxWriteSheet): string {
  const rows = sheet.rows.map((cells, rowIndex) => {
    const style = sheet.header === true && rowIndex === 0 ? ' s="1"' : "";
    const written = cells.map((cell, columnIndex) => {
      const at = cellReference(rowIndex, columnIndex);
      if (cell === null || cell === "") return "";
      if (typeof cell === "string") return `<c r="${at}" t="inlineStr"${style}><is><t xml:space="preserve">${escapeXml(guardFormula(cell))}</t></is></c>`;
      if (!DECIMAL.test(cell.number)) throw new RangeError(`不是十进制数字：${cell.number}`);
      return `<c r="${at}"${style}><v>${cell.number}</v></c>`;
    });
    return `<row r="${rowIndex + 1}">${written.join("")}</row>`;
  });
  const columns = sheet.columnWidths?.map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`).join("") ?? "";
  const frozen = sheet.header === true ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${frozen}${columns === "" ? "" : `<cols>${columns}</cols>`}<sheetData>${rows.join("")}</sheetData></worksheet>`;
}

const STYLES =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  "</styleSheet>";

/** 拼出一个 .xlsx 文件。工作表的名字最多 31 个字符，不能有 `[]:*?/\`（Excel 的限制）。 */
export function writeXlsx(sheets: readonly XlsxWriteSheet[]): Buffer {
  if (sheets.length === 0) throw new RangeError("至少要有一张工作表");
  for (const sheet of sheets) if (sheet.name === "" || sheet.name.length > 31 || /[[\]:*?/\\]/.test(sheet.name)) throw new RangeError(`工作表的名字不合规：${sheet.name}`);
  const xml = (text: string): Buffer => Buffer.from(text, "utf8");
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const pkg = "http://schemas.openxmlformats.org/package/2006";
  return createZip([
    {
      name: "[Content_Types].xml",
      content: xml(
        `${head}<Types xmlns="${pkg}/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>` +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("") +
          "</Types>",
      ),
    },
    { name: "_rels/.rels", content: xml(`${head}<Relationships xmlns="${pkg}/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`) },
    {
      name: "xl/workbook.xml",
      content: xml(`${head}<workbook xmlns="${main}" xmlns:r="${rel}"><sheets>${sheets.map((sheet, index) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join("")}</sheets></workbook>`),
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      content: xml(
        `${head}<Relationships xmlns="${pkg}/relationships">${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join("")}` +
          `<Relationship Id="rId${sheets.length + 1}" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,
      ),
    },
    { name: "xl/styles.xml", content: xml(STYLES) },
    ...sheets.map((sheet, index) => ({ name: `xl/worksheets/sheet${index + 1}.xml`, content: xml(sheetXml(sheet)) })),
  ]);
}

// ---- 读 ----

/**
 * 读到的单元格：空；文字；数字（文件里的原文，如 `12000`、`0.1`、`1.2E+4`）；逻辑值（`TRUE` / `FALSE`）；错误值（`#N/A` 这类）；
 * 带公式的（不取值）。逻辑值和错误值既不是数字也不是文字：要数字的列里是错，由调用方报到那个单元格。
 */
export type XlsxCell =
  | { type: "empty" }
  | { type: "text"; text: string }
  | { type: "number"; text: string }
  | { type: "boolean"; text: "TRUE" | "FALSE" }
  | { type: "error"; text: string }
  | { type: "formula" };

const EMPTY: XlsxCell = { type: "empty" };

function unescapeXml(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(/&(#x[0-9a-fA-F]{1,6}|#\d{1,7}|amp|lt|gt|quot|apos);/g, (_, entity: string) => {
    if (entity === "amp") return "&";
    if (entity === "lt") return "<";
    if (entity === "gt") return ">";
    if (entity === "quot") return '"';
    if (entity === "apos") return "'";
    const code = entity.startsWith("#x") ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "";
  });
}

/**
 * 扫描器给出的一件东西：开始标签（带属性）、结束标签、一段文字。
 * 文字给的是文件里的原样（`raw`），实体还没有还原——用得到的时候才还原（`TextCollector`），用不到的（标签之间的空白、
 * 不认识的标签里的内容）就不花这个时间；`cdata` 为真时是 CDATA 里的原文，不用还原。
 */
type XmlEvent = { kind: "open"; name: string; attributes: ReadonlyMap<string, string>; selfClosing: boolean } | { kind: "close"; name: string } | { kind: "text"; raw: string; cdata: boolean };

const NO_ATTRIBUTES: ReadonlyMap<string, string> = new Map();
const MAX_NAME_LENGTH = 256;
const MAX_ATTRIBUTE_LENGTH = 8_192;
const MAX_ATTRIBUTES = 64;

const isSpace = (code: number): boolean => code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
/** 名字的第一个字符：字母、下划线、冒号，或非 ASCII 的字符 */
const isNameStart = (code: number): boolean => (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a) || code === 0x5f || code === 0x3a || code >= 0x80;
/** 名字结束的地方：空白、`/`、`>`、`=`、`<`、引号 */
const endsName = (code: number): boolean => isSpace(code) || code === 0x2f || code === 0x3e || code === 0x3d || code === 0x3c || code === 0x22 || code === 0x27;

const corrupt = (what: string): XlsxError => new XlsxError("CORRUPT", `文件已损坏（${what}）`);

/**
 * 顺序扫描一份 XML。每个字符只看一遍（找注释、CDATA、属性值的结尾用 indexOf，找到之后从那里接着走），用时和长度成正比。
 * - 标签名、属性名去掉命名空间前缀之前的原样给出（`r:id`）；调用方用 `localName` 取冒号后面的部分。
 * - 属性值可以用单引号或双引号，等号两边可以有空白；同名的属性取第一个。
 * - 注释、处理指令跳过；CDATA 里的内容原样当作文字；`<!DOCTYPE`、`<!ENTITY` 这类声明直接拒绝（UNSAFE）。
 * - 标签没有结束、开始和结束对不上、文件在标签中间断了：CORRUPT。标签数、嵌套层数、名字和属性的长度超过上限：TOO_LARGE。
 */
function* scanXml(xml: string, limits: { maxTags: number } = { maxTags: XLSX_LIMITS.maxTags }): Generator<XmlEvent> {
  const length = xml.length;
  const stack: string[] = [];
  let tags = 0;
  let at = xml.charCodeAt(0) === 0xfeff ? 1 : 0;
  while (at < length) {
    const open = xml.indexOf("<", at);
    if (open < 0) {
      if (stack.length === 0) return;
      throw corrupt("内容不完整");
    }
    if (open > at) yield { kind: "text", raw: xml.slice(at, open), cdata: false };
    if ((tags += 1) > limits.maxTags) throw new XlsxError("TOO_LARGE", "文件里的内容太多（标签数超过了上限）");
    const next = xml.charCodeAt(open + 1);
    if (next === 0x21) {
      // <!-- 注释 -->、<![CDATA[ 原文 ]]>；别的 <! 声明（DOCTYPE、ENTITY……）一律不允许
      if (xml.startsWith("<!--", open)) {
        const end = xml.indexOf("-->", open + 4);
        if (end < 0) throw corrupt("注释没有结束");
        at = end + 3;
      } else if (xml.startsWith("<![CDATA[", open)) {
        const end = xml.indexOf("]]>", open + 9);
        if (end < 0) throw corrupt("CDATA 没有结束");
        if (end > open + 9) yield { kind: "text", raw: xml.slice(open + 9, end), cdata: true };
        at = end + 3;
      } else throw new XlsxError("UNSAFE", "文件里有不允许的 XML 声明（DOCTYPE / ENTITY）");
      continue;
    }
    if (next === 0x3f) {
      const end = xml.indexOf("?>", open + 2);
      if (end < 0) throw corrupt("处理指令没有结束");
      // 开头的 <?xml … encoding="…"?>：只认 UTF-8（Excel、WPS、LibreOffice 存的都是）
      if (xml.startsWith("<?xml", open) && isSpace(xml.charCodeAt(open + 5))) {
        const declared = /\sencoding\s*=\s*["']([^"']*)["']/.exec(xml.slice(open, end));
        if (declared && !/^utf-?8$/i.test(declared[1] as string)) throw corrupt(`表格内容的编码是 ${declared[1]}，只支持 UTF-8。请用 Excel 另存为 .xlsx`);
      }
      at = end + 2;
      continue;
    }
    const closing = next === 0x2f;
    let cursor = open + (closing ? 2 : 1);
    if (cursor >= length || !isNameStart(xml.charCodeAt(cursor))) throw corrupt("标签写法不对");
    const nameStart = cursor;
    while (cursor < length && !endsName(xml.charCodeAt(cursor))) {
      cursor += 1;
      if (cursor - nameStart > MAX_NAME_LENGTH) throw new XlsxError("TOO_LARGE", "文件里有长得不正常的标签名");
    }
    const name = xml.slice(nameStart, cursor);
    if (closing) {
      while (cursor < length && isSpace(xml.charCodeAt(cursor))) cursor += 1;
      if (xml.charCodeAt(cursor) !== 0x3e) throw corrupt("结束标签写法不对");
      if (stack.pop() !== name) throw corrupt("标签的开始和结束对不上");
      yield { kind: "close", name };
      at = cursor + 1;
      continue;
    }
    let attributes: Map<string, string> | null = null;
    let selfClosing = false;
    for (;;) {
      while (cursor < length && isSpace(xml.charCodeAt(cursor))) cursor += 1;
      if (cursor >= length) throw corrupt("标签没有结束");
      const code = xml.charCodeAt(cursor);
      if (code === 0x3e) break;
      if (code === 0x2f) {
        if (xml.charCodeAt(cursor + 1) !== 0x3e) throw corrupt("标签写法不对");
        selfClosing = true;
        cursor += 1;
        break;
      }
      if (!isNameStart(code)) throw corrupt("属性写法不对");
      const attributeStart = cursor;
      while (cursor < length && !endsName(xml.charCodeAt(cursor))) {
        cursor += 1;
        if (cursor - attributeStart > MAX_NAME_LENGTH) throw new XlsxError("TOO_LARGE", "文件里有长得不正常的属性名");
      }
      const attributeName = xml.slice(attributeStart, cursor);
      while (cursor < length && isSpace(xml.charCodeAt(cursor))) cursor += 1;
      if (xml.charCodeAt(cursor) !== 0x3d) throw corrupt("属性没有值");
      cursor += 1;
      while (cursor < length && isSpace(xml.charCodeAt(cursor))) cursor += 1;
      const quote = xml.charCodeAt(cursor);
      if (quote !== 0x22 && quote !== 0x27) throw corrupt("属性的值没有用引号括起来");
      const valueEnd = xml.indexOf(quote === 0x22 ? '"' : "'", cursor + 1);
      if (valueEnd < 0) throw corrupt("属性的值没有结束");
      if (valueEnd - cursor - 1 > MAX_ATTRIBUTE_LENGTH) throw new XlsxError("TOO_LARGE", "文件里有长得不正常的属性");
      const value = xml.slice(cursor + 1, valueEnd);
      if (value.includes("<")) throw corrupt("属性的值里有不允许的字符");
      attributes ??= new Map();
      if (attributes.size >= MAX_ATTRIBUTES) throw new XlsxError("TOO_LARGE", "文件里有属性多得不正常的标签");
      if (!attributes.has(attributeName)) attributes.set(attributeName, unescapeXml(value));
      cursor = valueEnd + 1;
    }
    if (!selfClosing) {
      if (stack.length >= XLSX_LIMITS.maxDepth) throw new XlsxError("TOO_LARGE", "文件里的内容嵌套得太深");
      stack.push(name);
    }
    yield { kind: "open", name, attributes: attributes ?? NO_ATTRIBUTES, selfClosing };
    at = cursor + 1;
  }
  if (stack.length > 0) throw corrupt("内容不完整");
}

/** 去掉命名空间前缀的名字（`x:row` → `row`）。 */
function localName(name: string): string {
  const colon = name.lastIndexOf(":");
  return colon < 0 ? name : name.slice(colon + 1);
}

/** 取出压缩包里的一份 XML（UTF-8）。 */
function entry(bytes: Uint8Array, name: string, maxBytes: number = XLSX_LIMITS.maxEntryBytes): string {
  let content: Buffer;
  try {
    content = unzipEntry(bytes, name, maxBytes);
  } catch (err) {
    if (err instanceof ZipError) throw new XlsxError(/大得不正常/.test(err.message) ? "TOO_LARGE" : "CORRUPT", err.message);
    throw err;
  }
  // UTF-16（开头是字节序标记，或者每隔一个字节是 0）：按 UTF-8 去读只会读出一张「空表」，要说清楚是编码不对
  const [first, second] = [content[0], content[1]];
  if ((first === 0xff && second === 0xfe) || (first === 0xfe && second === 0xff) || (first === 0x3c && second === 0x00) || (first === 0x00 && second === 0x3c)) {
    throw corrupt("表格内容的编码是 UTF-16，只支持 UTF-8。请用 Excel 另存为 .xlsx");
  }
  return content.toString("utf8");
}

/** 一个字符引用最长 10 个字符（`&#x10FFFF;`）：原文比上限的 10 倍还长，还原之后一定超过上限，不用去还原 */
const MAX_RAW_TEXT = XLSX_LIMITS.maxCellLength * 10;

/** 收集一段文字（`<t>`、`<v>` 里的），超过单元格长度的上限就不再往里加（只记下「太长了」）。 */
class TextCollector {
  text = "";
  tooLong = false;
  add(event: { raw: string; cdata: boolean }): void {
    if (this.tooLong) return;
    const piece = event.raw.length > MAX_RAW_TEXT ? null : event.cdata ? event.raw : unescapeXml(event.raw);
    if (piece === null || this.text.length + piece.length > XLSX_LIMITS.maxCellLength) this.tooLong = true;
    else this.text += piece;
  }
}

const cellTooLong = (): XlsxError => new XlsxError("TOO_LARGE", `单元格里的文字太长（最多 ${XLSX_LIMITS.maxCellLength} 个字符）`);

/** 共享字符串表：第 N 条是什么文字。太长的那一条记成 null（用到它的单元格才报错）。 */
function sharedStrings(bytes: Uint8Array, name: string): (string | null)[] {
  if (!hasZipEntry(bytes, name)) return [];
  const strings: (string | null)[] = [];
  // 一条 <si> 里所有 <t> 的文字拼起来（富文本分成几段）；拼音注释 <rPh> 里的不算
  let current: TextCollector | null = null;
  let phonetic = 0;
  let inText = false;
  const push = (value: string | null): void => {
    strings.push(value);
    if (strings.length > XLSX_LIMITS.maxSharedStrings) throw new XlsxError("TOO_LARGE", "文件里的文字条数太多");
  };
  for (const event of scanXml(entry(bytes, name))) {
    if (event.kind === "text") {
      if (current !== null && inText) current.add(event);
      continue;
    }
    const tag = localName(event.name);
    if (event.kind === "open") {
      if (tag === "si") {
        if (current !== null) throw corrupt("共享字符串的写法不对");
        if (event.selfClosing) push("");
        else current = new TextCollector();
      } else if (tag === "rPh" && !event.selfClosing) phonetic += 1;
      else if (tag === "t" && !event.selfClosing && phonetic === 0) inText = true;
    } else if (tag === "si" && current !== null) {
      push(current.tooLong ? null : current.text);
      current = null;
      phonetic = 0;
      inText = false;
    } else if (tag === "rPh") phonetic = Math.max(0, phonetic - 1);
    else if (tag === "t") inText = false;
  }
  return strings;
}

/**
 * 关系里的目标换成包内的路径（不带开头的 `/`）：相对的接在所在目录后面，`.` 和 `..` 归一化。
 * 归一化之后跑到包外面、带反斜杠或协议的，返回 null——这些名字只用来在包内查找，从不当作磁盘路径。
 */
function resolveTarget(directory: string, target: string): string | null {
  if (target === "" || target.includes("\\") || target.includes(":") || target.includes("\u0000")) return null;
  const resolved: string[] = [];
  for (const segment of (target.startsWith("/") ? target.slice(1) : `${directory}${target}`).split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment !== "..") resolved.push(segment);
    else if (resolved.pop() === undefined) return null;
  }
  return resolved.length === 0 ? null : resolved.join("/");
}

/**
 * 包里一个部件的关系文件：编号 → 目标在包内的路径；目标是外部的、或归一化之后不在包里的记成 null。
 * 这里不拒绝任何东西——用不到的部件（自定义 XML、打印设置、外部链接……）指到哪里都不管；要读的那几个由调用方检查。
 */
function relationships(bytes: Uint8Array, partPath: string): { byId: Map<string, string | null>; byType: Map<string, string | null>; exists: boolean } {
  const slash = partPath.lastIndexOf("/");
  const directory = slash < 0 ? "" : partPath.slice(0, slash + 1);
  const relsPath = `${directory}_rels/${partPath.slice(slash + 1)}.rels`;
  const byId = new Map<string, string | null>();
  const byType = new Map<string, string | null>();
  if (!hasZipEntry(bytes, relsPath)) return { byId, byType, exists: false };
  for (const event of scanXml(entry(bytes, relsPath, XLSX_LIMITS.maxSmallEntryBytes))) {
    if (event.kind !== "open" || localName(event.name) !== "Relationship") continue;
    const path = event.attributes.get("TargetMode") === "External" ? null : resolveTarget(directory, event.attributes.get("Target") ?? "");
    const id = event.attributes.get("Id");
    const type = event.attributes.get("Type") ?? "";
    if (id !== undefined && !byId.has(id)) byId.set(id, path);
    const kind = type.slice(type.lastIndexOf("/") + 1);
    if (!byType.has(kind)) byType.set(kind, path);
  }
  return { byId, byType, exists: true };
}

const outside = (what: string): XlsxError => new XlsxError("UNSAFE", `文件里${what}的位置指向了文件外面`);

interface Workbook {
  /** 工作表：名字和在压缩包里的位置，按工作簿里的顺序 */
  sheets: { name: string; path: string }[];
  /** 日期用 1904 纪元（老版本的 Mac Excel）：日期序号要按 1904-01-01 起算 */
  date1904: boolean;
  /** 共享字符串那份文件的位置 */
  sharedStringsPath: string;
}

function workbook(bytes: Uint8Array): Workbook {
  // 工作簿的位置由包的根关系给出；绝大多数文件是 xl/workbook.xml
  const root = hasZipEntry(bytes, "_rels/.rels") ? relationships(bytes, "").byType.get("officeDocument") : undefined;
  if (root === null) throw outside("工作簿");
  const path = root !== undefined && hasZipEntry(bytes, root) ? root : "xl/workbook.xml";
  if (!hasZipEntry(bytes, path)) throw new XlsxError("NOT_XLSX", "不是 Excel 的 .xlsx 文件（里面没有工作簿）");
  if (!path.startsWith("xl/")) throw new XlsxError("UNSAFE", "工作簿的位置不对");
  const { byId, byType, exists } = relationships(bytes, path);
  const shared = byType.get("sharedStrings");
  if (shared === null) throw outside("共享字符串");
  const sheets: Workbook["sheets"] = [];
  let date1904 = false;
  for (const event of scanXml(entry(bytes, path, XLSX_LIMITS.maxSmallEntryBytes))) {
    if (event.kind !== "open") continue;
    const tag = localName(event.name);
    if (tag === "workbookPr") date1904 = ["1", "true"].includes(event.attributes.get("date1904") ?? "");
    if (tag !== "sheet") continue;
    // 关系编号的属性是 r:id（前缀可以是别的名字）；没有前缀的 id 也认
    let relationId = event.attributes.get("r:id");
    if (relationId === undefined) for (const [name, value] of event.attributes) if (localName(name) === "id") relationId = value;
    const target = relationId === undefined ? undefined : byId.get(relationId);
    if (target === null) throw outside("工作表");
    if (target === undefined) {
      // 有关系文件、却找不到这张表的位置：不能当它不存在（不然会悄悄去读别的表）
      if (exists) throw corrupt("工作簿里有一张表找不到它的内容");
      continue;
    }
    if (!target.startsWith("xl/")) throw new XlsxError("UNSAFE", "工作表的位置不在文件里面");
    sheets.push({ name: event.attributes.get("name") ?? "", path: target });
  }
  // 没有关系文件的极简写法：退回默认的位置
  if (sheets.length === 0) sheets.push({ name: "", path: "xl/worksheets/sheet1.xml" });
  return { sheets, date1904, sharedStringsPath: shared !== undefined && shared.startsWith("xl/") ? shared : "xl/sharedStrings.xml" };
}

/** 单元格位置（`B12`）里的列：A = 0。写法不对返回 null。 */
function columnIndex(reference: string): number | null {
  const length = reference.length;
  let index = 0;
  let cursor = 0;
  while (cursor < length && cursor < 3) {
    const code = reference.charCodeAt(cursor);
    if (code < 0x41 || code > 0x5a) break;
    index = index * 26 + (code - 64);
    cursor += 1;
  }
  if (cursor === 0 || cursor === length || length - cursor > 7) return null;
  for (let digit = cursor; digit < length; digit += 1) {
    const code = reference.charCodeAt(digit);
    if (code < 0x30 || code > 0x39) return null;
  }
  return index - 1;
}

export interface XlsxSheet {
  /** 工作表的名字 */
  name: string;
  /** `rows[r][c]`，行和列都从 0 数；中间空着的行、列补成空单元格 */
  rows: XlsxCell[][];
  /** 这个文件的日期序号是不是 1904 纪元 */
  date1904: boolean;
}

/** 读出 .xlsx 第一张工作表的全部单元格。 */
export function readXlsx(bytes: Uint8Array): XlsxCell[][] {
  return readXlsxSheet(bytes).rows;
}

/** 正在读的一个单元格。 */
interface OpenCell {
  column: number;
  type: string;
  formula: boolean;
  /** `<v>` 里的原文；没有 `<v>` 是 null */
  value: TextCollector | null;
  /** 行内字符串 `<is>` 里各段 `<t>` 的文字 */
  inline: TextCollector;
  collecting: "v" | "t" | null;
  phonetic: number;
}

const WHOLE_NUMBER = /^\d{1,9}$/;

/**
 * 读出 .xlsx 里的一张工作表：有名字在 `preferredNames` 里的就读它（按给的先后），没有就读第一张。
 * 隐藏的行和列照常读出来；合并单元格只有左上角那一格有值（文件里就是这样存的）。
 * 文件不是 xlsx、已损坏、太大、有不安全的内容时抛 `XlsxError`。
 */
export function readXlsxSheet(bytes: Uint8Array, preferredNames: readonly string[] = []): XlsxSheet {
  if (bytes.length > XLSX_LIMITS.maxFileBytes) throw new XlsxError("TOO_LARGE", "文件太大");
  if (!isZip(bytes)) throw new XlsxError("NOT_XLSX", "不是 Excel 的 .xlsx 文件");
  const book = workbook(bytes);
  const chosen = preferredNames.map((name) => book.sheets.find((sheet) => sheet.name.trim() === name)).find((sheet) => sheet !== undefined) ?? (book.sheets[0] as Workbook["sheets"][number]);
  const xml = entry(bytes, chosen.path);
  const strings = sharedStrings(bytes, book.sharedStringsPath);
  const rows: XlsxCell[][] = [];
  let rowIndex = -1;
  let nextColumn = 0;
  let cells = 0;
  let cell: OpenCell | null = null;

  const store = (column: number, value: XlsxCell): void => {
    const target = rows[rowIndex] as XlsxCell[];
    while (target.length < column) target.push(EMPTY);
    target[column] = value;
  };
  const finish = (done: OpenCell): XlsxCell => {
    if (done.formula) return { type: "formula" };
    if (done.inline.tooLong || done.value?.tooLong === true) throw cellTooLong();
    if (done.type === "inlineStr") return done.inline.text === "" ? EMPTY : { type: "text", text: unguardFormula(done.inline.text) };
    if (done.value === null) return EMPTY;
    const raw = done.value.text;
    if (done.type === "s") {
      // 共享字符串的下标必须是表里有的：读不出来不能当成空（空 = 清除）
      if (raw.trim() === "") return EMPTY;
      const index = WHOLE_NUMBER.test(raw.trim()) ? Number(raw.trim()) : -1;
      if (index < 0 || index >= strings.length) throw corrupt("单元格引用的文字不存在");
      const text = strings[index] as string | null;
      if (text === null) throw cellTooLong();
      return text === "" ? EMPTY : { type: "text", text: unguardFormula(text) };
    }
    if (done.type === "b") {
      const flag = raw.trim().toLowerCase();
      if (flag === "1" || flag === "true") return { type: "boolean", text: "TRUE" };
      if (flag === "0" || flag === "false") return { type: "boolean", text: "FALSE" };
      throw corrupt("逻辑值的写法不对");
    }
    if (done.type === "e") return raw.trim() === "" ? EMPTY : { type: "error", text: raw.trim() };
    if (done.type === "str" || done.type === "d") return raw === "" ? EMPTY : { type: "text", text: raw };
    return raw.trim() === "" ? EMPTY : { type: "number", text: raw.trim() };
  };

  for (const event of scanXml(xml)) {
    if (event.kind === "text") {
      if (cell?.collecting === "v") (cell.value as TextCollector).add(event);
      else if (cell?.collecting === "t") cell.inline.add(event);
      continue;
    }
    const tag = localName(event.name);
    if (event.kind === "open") {
      if (cell !== null) {
        if (tag === "c" || tag === "row") throw corrupt("单元格没有结束");
        if (tag === "f") cell.formula = true;
        else if (tag === "v") {
          cell.value ??= new TextCollector();
          cell.collecting = event.selfClosing ? null : "v";
        } else if (tag === "rPh" && !event.selfClosing) cell.phonetic += 1;
        else if (tag === "t" && !event.selfClosing && cell.phonetic === 0 && cell.collecting === null) cell.collecting = "t";
      } else if (tag === "row") {
        const declared = event.attributes.get("r");
        if (declared === undefined) rowIndex += 1;
        else {
          // 行号从 1 起；写成 1e9、天文数字的按「行太多」拒绝，不是数字的是文件坏了
          const number = /^[0-9.eE+]+$/.test(declared) ? Number(declared) : Number.NaN;
          if (!Number.isInteger(number) || number < 1) throw corrupt("行号的写法不对");
          rowIndex = Math.min(number - 1, XLSX_LIMITS.maxRows);
        }
        if (rowIndex >= XLSX_LIMITS.maxRows) throw new XlsxError("TOO_LARGE", `行太多（最多 ${XLSX_LIMITS.maxRows} 行）`);
        while (rows.length <= rowIndex) rows.push([]);
        nextColumn = 0;
      } else if (tag === "c" && rowIndex >= 0) {
        const reference = event.attributes.get("r");
        const column = reference === undefined ? nextColumn : columnIndex(reference);
        if (column === null) throw corrupt("单元格的位置写法不对");
        if (column >= XLSX_LIMITS.maxColumns) throw new XlsxError("TOO_LARGE", `列太多（最多 ${XLSX_LIMITS.maxColumns} 列）`);
        if ((cells += 1) > XLSX_LIMITS.maxCells) throw new XlsxError("TOO_LARGE", `单元格太多（最多 ${XLSX_LIMITS.maxCells} 个）`);
        nextColumn = column + 1;
        if (event.selfClosing) store(column, EMPTY);
        else cell = { column, type: event.attributes.get("t") ?? "n", formula: false, value: null, inline: new TextCollector(), collecting: null, phonetic: 0 };
      }
    } else if (cell !== null) {
      if (tag === "c") {
        store(cell.column, finish(cell));
        cell = null;
      } else if (tag === "v" && cell.collecting === "v") cell.collecting = null;
      else if (tag === "t" && cell.collecting === "t") cell.collecting = null;
      else if (tag === "rPh") cell.phonetic = Math.max(0, cell.phonetic - 1);
    }
  }
  return { name: chosen.name, rows, date1904: book.date1904 };
}
