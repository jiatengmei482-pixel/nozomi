/**
 * 端到端测试里改 .xlsx 用的小工具：把页面下载下来的文件读成一格一格的文字，改几格，再写成一个新的 .xlsx 传回去。
 * 读写用后端自己的实现（apps/api/src/integrations/xlsx.ts），仓库里不存二进制文件。
 */
import { readFile } from "node:fs/promises";
import type { Download } from "@playwright/test";
import { type XlsxWriteCell, readXlsxSheet, writeXlsx } from "../../api/src/integrations/xlsx.ts";

export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface Sheet {
  name: string;
  /** 第一行是表头；数字格子是它的十进制写法 */
  rows: (string | null)[][];
}

export function readSheet(bytes: Uint8Array): Sheet {
  const sheet = readXlsxSheet(bytes);
  return { name: sheet.name, rows: sheet.rows.map((row) => row.map((cell) => (cell.type === "text" || cell.type === "number" ? cell.text : null))) };
}

export async function readDownload(download: Download): Promise<{ name: string; bytes: Buffer }> {
  const path = await download.path();
  return { name: download.suggestedFilename(), bytes: await readFile(path) };
}

/** 列名在第几列。 */
export function column(sheet: Sheet, header: string): number {
  const index = (sheet.rows[0] ?? []).indexOf(header);
  if (index < 0) throw new Error(`表头里没有「${header}」：${(sheet.rows[0] ?? []).join("、")}`);
  return index;
}

/** 写成 .xlsx。纯数字的格子按数字写（和 Excel 里手填一样），其余按文字。 */
export function writeSheet(sheet: Sheet): Buffer {
  const rows: XlsxWriteCell[][] = sheet.rows.map((row, r) => row.map((cell, c) => (cell === null || cell === "" ? null : r > 0 && /^-?\d+(\.\d+)?$/.test(cell) ? { number: cell } : cell)));
  return writeXlsx([{ name: sheet.name, rows, header: true }]);
}

export function upload(name: string, bytes: Buffer): { name: string; mimeType: string; buffer: Buffer } {
  return { name, mimeType: XLSX_MIME, buffer: bytes };
}
