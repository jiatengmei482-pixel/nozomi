/**
 * CSV 解析（RFC 4180）：逗号分隔，字段可以用双引号包起来，引号里的逗号、换行原样保留，两个连续的双引号表示一个双引号。
 * 只用于导入公开数据文件，不引入第三方库（ADR 0001）。
 */

export class CsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvError";
  }
}

const strictUtf8 = new TextDecoder("utf-8", { fatal: true });

/**
 * 把文件内容按 UTF-8 严格解码：有任何不合法的字节就报错，而不是悄悄换成「�」。
 * 另存成 Latin-1、GBK、UTF-16 的文件会在这里被认出来。
 */
export function decodeUtf8Strict(bytes: Uint8Array): string {
  try {
    return strictUtf8.decode(bytes);
  } catch {
    throw new CsvError("文件不是 UTF-8 编码（可能被另存成了别的编码）。请用原始下载的文件，或另存为 UTF-8 后再试");
  }
}

/**
 * 把整份 CSV 文本解析成「行 → 字段」。开头的 BOM 和末尾的空行会被去掉。
 * 换行认 LF 和 CRLF；引号外单独出现的 CR（老式的「只有 CR」换行）报错，不猜它是换行还是内容。
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  /** 当前字段是否已经开始（用来区分「文件以换行结尾」和「最后一行只有一个空字段」） */
  let started = false;
  const endRow = (): void => {
    row.push(field);
    rows.push(row);
    row = [];
    field = "";
    started = false;
  };
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i += 1) {
    const char = text[i] as string;
    if (quoted) {
      if (char !== '"') field += char;
      else if (text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else quoted = false;
    } else if (char === '"') {
      quoted = true;
      started = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
      started = true;
    } else if (char === "\n") {
      endRow();
    } else if (char === "\r" && text[i + 1] === "\n") {
      endRow();
      i += 1;
    } else if (char === "\r") {
      throw new CsvError("文件用的是只有 CR 的旧式换行，无法可靠地分行。请另存为 LF 或 CRLF 换行后再试");
    } else {
      field += char;
      started = true;
    }
  }
  if (quoted) throw new CsvError("CSV 文件不完整：有一个双引号没有闭合");
  if (started || field !== "" || row.length > 0) endRow();
  return rows;
}
