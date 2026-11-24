/**
 * 写死文案不增加（M11-07，监工 2026-11-24 决定）：拿 main 的 copy.csv 和当前代码导出的清单比，
 * 「写死」的条数多了就不通过；只拦新增，不要求清存量。条目身份用 copy.csv 的 key（写死的 key 由文件 + 文字生成）。
 */

export interface HardcodedItem {
  key: string;
  file: string;
  text: string;
}

export interface HardcodedComparison {
  baseCount: number;
  headCount: number;
  added: HardcodedItem[];
  removed: HardcodedItem[];
  pass: boolean;
}

/** 按 RFC 4180 读 CSV（逗号分隔、双引号包住、"" 表示一个引号、引号里可以换行），去掉开头的 BOM */
function parseCsv(csv: string): string[][] {
  const source = csv.startsWith("﻿") ? csv.slice(1) : csv;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (quoted) {
      if (char !== '"') cell += char;
      else if (source[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else quoted = false;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** 从 copy.csv 里取「状态」列是「写死」的行 */
export function hardcodedFromCsv(csv: string): HardcodedItem[] {
  const [header, ...rows] = parseCsv(csv);
  if (header === undefined) return [];
  const column = (name: string): number => {
    const index = header.indexOf(name);
    if (index < 0) throw new Error(`copy.csv 缺少「${name}」列`);
    return index;
  };
  const keyAt = column("key");
  const statusAt = column("状态");
  const textAt = column("中文");
  const fileAt = column("文件");
  return rows
    .filter((row) => row[statusAt] === "写死")
    .map((row) => ({ key: row[keyAt] ?? "", file: row[fileAt] ?? "", text: row[textAt] ?? "" }));
}

/** 条数不比 main 多就通过；新增、删掉的条目不管通过与否都列出来 */
export function compareHardcoded(base: readonly HardcodedItem[], head: readonly HardcodedItem[]): HardcodedComparison {
  const baseKeys = new Set(base.map((item) => item.key));
  const headKeys = new Set(head.map((item) => item.key));
  return {
    baseCount: base.length,
    headCount: head.length,
    added: head.filter((item) => !baseKeys.has(item.key)),
    removed: base.filter((item) => !headKeys.has(item.key)),
    pass: head.length <= base.length,
  };
}
