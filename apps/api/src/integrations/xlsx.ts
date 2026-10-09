/**
 * 读写 Excel 的 .xlsx 文件（价格、库存的批量导入导出，M1-05）。只在内存里做，不写磁盘，不引入第三方库（ADR 0019）。
 *
 * .xlsx 是一个 zip 压缩包，里面是几份 XML。这里只支持用得到的那一小部分：
 * - 写：若干张工作表，单元格是文字或数字，第一行可以加粗冻结；不写公式、样式、合并单元格。
 * - 读：第一张工作表的全部单元格，文字（共享字符串或行内字符串）和数字都按原文给出，不做任何浮点换算。
 *
 * 安全（上传的文件是不可信的输入）：
 * - zip 炸弹：每份 XML 解压后有大小上限（解压时就限制输出，不是解完再看），行数、列数、单元格长度也有上限。
 * - 路径穿越：压缩包里的文件名只用来在包内查找，从不拼成磁盘路径；工作表的位置如果指向包外（`../`）直接拒绝。
 * - XML 实体：不解析 DTD，文件里出现 `<!DOCTYPE` / `<!ENTITY` 直接拒绝；只认五个预定义实体和数字字符引用。
 * - 公式：读到带公式的单元格标成 `formula`，由调用方当作错误报给用户，不取它的缓存值。
 * - 公式注入（导出的文件被 Excel 打开时）：以 `=`、`+`、`-`、`@`、制表符、回车开头的文字前面加一个单引号，
 *   Excel 会把它当成普通文字显示；读回来时去掉这个单引号。
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
  /** 压缩包里每份 XML 解压后的大小上限（字节） */
  maxEntryBytes: 16 * 1024 * 1024,
  maxRows: 5_000,
  maxColumns: 60,
  maxCellLength: 2_000,
  maxSharedStrings: 200_000,
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

const FORMULA_LEAD = /^[=+\-@\t\r]/;

/** 会被 Excel 当成公式的文字前面加单引号（公式注入的防护）。 */
export function guardFormula(text: string): string {
  return FORMULA_LEAD.test(text) ? `'${text}` : text;
}

/** 读回来时去掉导出时加的那个单引号。 */
export function unguardFormula(text: string): string {
  return text.startsWith("'") && FORMULA_LEAD.test(text.slice(1)) ? text.slice(1) : text;
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

/** 读到的单元格：空；文字；数字（文件里的原文，如 `12000`、`0.1`、`1.2E+4`）；带公式的（不取值）。 */
export type XlsxCell = { type: "empty" } | { type: "text"; text: string } | { type: "number"; text: string } | { type: "formula" };

const EMPTY: XlsxCell = { type: "empty" };

function unescapeXml(text: string): string {
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

function entry(bytes: Uint8Array, name: string): string {
  let content: Buffer;
  try {
    content = unzipEntry(bytes, name, XLSX_LIMITS.maxEntryBytes);
  } catch (err) {
    if (err instanceof ZipError) throw new XlsxError(/大得不正常/.test(err.message) ? "TOO_LARGE" : "CORRUPT", err.message);
    throw err;
  }
  const text = content.toString("utf8");
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new XlsxError("UNSAFE", "文件里有不允许的 XML 声明（DOCTYPE / ENTITY）");
  return text;
}

interface Tag {
  /** 去掉命名空间前缀的标签名 */
  name: string;
  closing: boolean;
  selfClosing: boolean;
  attributes: string;
  /** 这个标签在文本里的起止位置 */
  start: number;
  end: number;
}

/**
 * 依次给出一段 XML 里的每个标签。标签名后面要么直接结束，要么隔着空白或 `/` 才是属性——
 * 名字和属性不会争同一段字符，所以不匹配时没有成倍的回溯，用时和长度成正比（上传的文件可以是任意构造的）。
 */
function* tags(xml: string): Generator<Tag> {
  const pattern = /<(\/?)(?:([A-Za-z_][\w.-]*):)?([A-Za-z_][\w.-]*)((?:[\s/][^<>]*)?)>/g;
  for (let match = pattern.exec(xml); match !== null; match = pattern.exec(xml)) {
    const attributes = match[4] as string;
    yield { name: match[3] as string, closing: match[1] === "/", selfClosing: attributes.endsWith("/"), attributes, start: match.index, end: pattern.lastIndex };
  }
}

function attribute(attributes: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attributes);
  return match ? unescapeXml(match[1] as string) : null;
}

/** 一段 XML 里所有 `<t>` 的文字拼起来（共享字符串、行内字符串里可能分成几段）；拼音注释 `<rPh>` 里的不算。 */
function textOf(xml: string): string {
  let text = "";
  let open = -1;
  let phonetic = 0;
  for (const tag of tags(xml)) {
    if (tag.name === "rPh") phonetic += tag.closing ? -1 : tag.selfClosing ? 0 : 1;
    else if (tag.name === "t" && phonetic === 0) {
      if (!tag.closing && !tag.selfClosing) open = tag.end;
      else if (tag.closing && open >= 0) {
        text += unescapeXml(xml.slice(open, tag.start));
        open = -1;
      }
    }
  }
  return text;
}

function sharedStrings(bytes: Uint8Array, name: string): string[] {
  if (!hasZipEntry(bytes, name)) return [];
  const xml = entry(bytes, name);
  const strings: string[] = [];
  let open = -1;
  for (const tag of tags(xml)) {
    if (tag.name !== "si") continue;
    if (!tag.closing && tag.selfClosing) strings.push("");
    else if (!tag.closing) open = tag.end;
    else if (open >= 0) {
      strings.push(textOf(xml.slice(open, tag.start)));
      open = -1;
    }
    if (strings.length > XLSX_LIMITS.maxSharedStrings) throw new XlsxError("TOO_LARGE", "文件里的文字条数太多");
  }
  return strings;
}

/** 包里一个部件的关系文件：编号 → 目标的路径（包内的绝对路径，不带开头的 `/`）。目标指向包外的直接拒绝。 */
function relationships(bytes: Uint8Array, partPath: string): { byId: Map<string, string>; byType: Map<string, string> } {
  const slash = partPath.lastIndexOf("/");
  const directory = slash < 0 ? "" : partPath.slice(0, slash + 1);
  const relsPath = `${directory}_rels/${partPath.slice(slash + 1)}.rels`;
  const byId = new Map<string, string>();
  const byType = new Map<string, string>();
  if (!hasZipEntry(bytes, relsPath)) return { byId, byType };
  for (const tag of tags(entry(bytes, relsPath))) {
    if (tag.name !== "Relationship" || tag.closing) continue;
    const id = attribute(tag.attributes, "Id");
    const target = attribute(tag.attributes, "Target") ?? "";
    const type = attribute(tag.attributes, "Type") ?? "";
    if (attribute(tag.attributes, "TargetMode") === "External") continue;
    const path = target.startsWith("/") ? target.slice(1) : `${directory}${target}`;
    // 只认压缩包里面的部件：`../`、反斜杠、带协议的地址一律拒绝（这些名字只用来在包内查找，从不当作磁盘路径）
    if (path.includes("..") || path.includes("\\") || path.includes(":")) throw new XlsxError("UNSAFE", "文件里的部件指向了文件外面");
    if (id !== null) byId.set(id, path);
    byType.set(type.slice(type.lastIndexOf("/") + 1), path);
  }
  return { byId, byType };
}

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
  const path = root !== undefined && hasZipEntry(bytes, root) ? root : "xl/workbook.xml";
  if (!hasZipEntry(bytes, path)) throw new XlsxError("NOT_XLSX", "不是 Excel 的 .xlsx 文件（里面没有工作簿）");
  if (!path.startsWith("xl/")) throw new XlsxError("UNSAFE", "工作簿的位置不对");
  const { byId, byType } = relationships(bytes, path);
  const shared = byType.get("sharedStrings");
  const sheets: Workbook["sheets"] = [];
  let date1904 = false;
  for (const tag of tags(entry(bytes, path))) {
    if (tag.closing) continue;
    if (tag.name === "workbookPr") date1904 = ["1", "true"].includes(attribute(tag.attributes, "date1904") ?? "");
    if (tag.name !== "sheet") continue;
    const relationId = attribute(tag.attributes, "r:id") ?? attribute(tag.attributes, "id");
    const target = relationId === null ? undefined : byId.get(relationId);
    if (target === undefined) continue;
    if (!target.startsWith("xl/")) throw new XlsxError("UNSAFE", "工作表的位置不在文件里面");
    sheets.push({ name: attribute(tag.attributes, "name") ?? "", path: target });
  }
  // 没有关系文件的极简写法：退回默认的位置
  if (sheets.length === 0) sheets.push({ name: "", path: "xl/worksheets/sheet1.xml" });
  return { sheets, date1904, sharedStringsPath: shared !== undefined && shared.startsWith("xl/") ? shared : "xl/sharedStrings.xml" };
}

function columnIndex(reference: string): number | null {
  const match = /^([A-Z]{1,3})\d{1,7}$/.exec(reference);
  if (!match) return null;
  let index = 0;
  for (const letter of match[1] as string) index = index * 26 + (letter.charCodeAt(0) - 64);
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
  let cell: { column: number; type: string; contentStart: number } | null = null;
  let nextColumn = 0;
  const finish = (target: XlsxCell[], column: number, type: string, content: string): void => {
    if (column >= XLSX_LIMITS.maxColumns) throw new XlsxError("TOO_LARGE", `列太多（最多 ${XLSX_LIMITS.maxColumns} 列）`);
    let value: XlsxCell = EMPTY;
    let raw: string | null = null;
    let hasFormula = false;
    let open = -1;
    for (const tag of tags(content)) {
      if (tag.name === "f") hasFormula = true;
      else if (tag.name === "v" && !tag.closing && !tag.selfClosing) open = tag.end;
      else if (tag.name === "v" && tag.closing && open >= 0) raw = unescapeXml(content.slice(open, tag.start));
    }
    if (hasFormula) value = { type: "formula" };
    else if (type === "inlineStr") value = { type: "text", text: unguardFormula(textOf(content)) };
    else if (raw !== null && type === "s") value = { type: "text", text: unguardFormula(strings[Number(raw)] ?? "") };
    else if (raw !== null && (type === "str" || type === "b" || type === "e" || type === "d")) value = { type: "text", text: raw };
    else if (raw !== null && raw.trim() !== "") value = { type: "number", text: raw.trim() };
    if (value.type === "text" && value.text.length > XLSX_LIMITS.maxCellLength) throw new XlsxError("TOO_LARGE", `单元格里的文字太长（最多 ${XLSX_LIMITS.maxCellLength} 个字符）`);
    if (value.type === "text" && value.text === "") value = EMPTY;
    while (target.length < column) target.push(EMPTY);
    target[column] = value;
  };
  for (const tag of tags(xml)) {
    if (tag.name === "row" && !tag.closing) {
      const declared = Number(attribute(tag.attributes, "r"));
      rowIndex = Number.isInteger(declared) && declared >= 1 ? declared - 1 : rowIndex + 1;
      if (rowIndex >= XLSX_LIMITS.maxRows) throw new XlsxError("TOO_LARGE", `行太多（最多 ${XLSX_LIMITS.maxRows} 行）`);
      while (rows.length <= rowIndex) rows.push([]);
      nextColumn = 0;
    } else if (tag.name === "c" && !tag.closing && rowIndex >= 0) {
      const reference = attribute(tag.attributes, "r");
      const column = reference === null ? nextColumn : columnIndex(reference);
      if (column === null) throw new XlsxError("CORRUPT", "单元格的位置写法不对");
      nextColumn = column + 1;
      const type = attribute(tag.attributes, "t") ?? "n";
      if (tag.selfClosing) finish(rows[rowIndex] as XlsxCell[], column, type, "");
      else cell = { column, type, contentStart: tag.end };
    } else if (tag.name === "c" && tag.closing && cell !== null && rowIndex >= 0) {
      finish(rows[rowIndex] as XlsxCell[], cell.column, cell.type, xml.slice(cell.contentStart, tag.start));
      cell = null;
    }
  }
  return { name: chosen.name, rows, date1904: book.date1904 };
}
