/**
 * `pnpm price-sheet:report --file <xlsx> [--expect-sha256 <值>] [--master <json>] [--out <目录>]`
 * 价格表导入第 0 阶段（ADR 0059，M4-28）：只读 dry-run。解析价格表、按现有框架分类映射，输出 Markdown 和 JSON 报告。
 *
 * - 不连数据库、不联网、不读配置和密钥，也没有写入模式。除了 `--out` 目录里的两份报告，什么都不写。
 * - 文件是不可信的输入：读取用 `integrations/xlsx.ts`（限制大小、拒绝 DTD、公式不取值），只读值，不执行任何内容。
 * - 报告含价格举例：`--out` 不能在 git 仓库里面；不给时写到系统临时目录。文件权限只给自己。
 * - 终端只打印统计数字，不打印价格。
 */
import { createHash } from "node:crypto";
import { existsSync, realpathSync } from "node:fs";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import {
  PRICE_SHEET_NAMES,
  PRICE_SHEET_ROUTE_CLASSES,
  PRICE_SHEET_ROUTE_CLASS_NAMES,
  type PriceSheetIssue,
  PriceSheetError,
  type PriceSheetMaster,
  type PriceSheetRawSheet,
  type PriceSheetReport,
  buildPriceSheetReport,
  parsePriceSheetMaster,
  parsePriceWorkbook,
  renderPriceSheetMarkdown,
} from "@nozomi/domain";
import { XLSX_LIMITS, XlsxError, readXlsxSheet } from "../integrations/xlsx.ts";
import { ZipError, hasZipEntry, unzipEntry } from "../integrations/zip.ts";

const USAGE = [
  "用法：pnpm price-sheet:report --file <价格表.xlsx> [--expect-sha256 <64 位十六进制>] [--master <主数据.json>] [--out <目录>]",
  "只读 dry-run：不连数据库，不写业务数据，只在 --out 目录写 report.md 和 report.json。",
  "--out 不能在 git 仓库里面；不给时写到系统临时目录。",
  "--master 的内容：{ \"cities\": [{ \"code\", \"country_code\", \"name\": { 语言: 名称 }, \"status\" }], \"vehicle_groups\": [{ \"code\" }] }；不给时只输出待匹配清单。",
].join("\n");

const MAX_MASTER_BYTES = 32 * 1024 * 1024;

class ReportFailure extends Error {}

export interface ReportOptions {
  file: string;
  expectSha256: string | null;
  master: string | null;
  out: string | null;
}

export function readReportOptions(argv: readonly string[]): ReportOptions {
  let values: { file?: string | undefined; "expect-sha256"?: string | undefined; master?: string | undefined; out?: string | undefined };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: { file: { type: "string" }, "expect-sha256": { type: "string" }, master: { type: "string" }, out: { type: "string" } },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    throw new ReportFailure("参数不正确。");
  }
  if (values.file === undefined) throw new ReportFailure("必须给 --file。");
  const expected = values["expect-sha256"]?.toLowerCase() ?? null;
  if (expected !== null && !/^[0-9a-f]{64}$/.test(expected)) throw new ReportFailure("--expect-sha256 要是 64 位十六进制。");
  return { file: values.file, expectSha256: expected, master: values.master ?? null, out: values.out ?? null };
}

/** 读取层只提供「按名字读一张表」。工作簿里实际有哪些表从 workbook.xml 取，只用来报告多余和隐藏的表，不决定读什么。 */
export function declaredSheets(bytes: Uint8Array): { name: string; hidden: boolean }[] | null {
  if (!hasZipEntry(bytes, "xl/workbook.xml")) return null;
  const xml = unzipEntry(bytes, "xl/workbook.xml", XLSX_LIMITS.maxSmallEntryBytes).toString("utf8");
  const attribute = (tag: string, name: string): string | null => {
    const match = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag);
    return match ? (match[1] ?? match[2] ?? "") : null;
  };
  return [...xml.matchAll(/<(?:[A-Za-z0-9_]+:)?sheet\s[^<>]{0,8192}>/g)].map(([tag]) => ({ name: (attribute(tag, "name") ?? "").trim(), hidden: (attribute(tag, "state") ?? "visible") !== "visible" }));
}

/** 读出约定的那些表。读取层找不到指定名字时会退回第一张，所以要核对读到的名字。 */
export function readPriceWorkbook(bytes: Uint8Array): { sheets: PriceSheetRawSheet[]; issues: PriceSheetIssue[] } {
  const issues: PriceSheetIssue[] = [];
  const sheets: PriceSheetRawSheet[] = [];
  for (const name of PRICE_SHEET_NAMES) {
    const sheet = readXlsxSheet(bytes, [name]);
    if (sheet.name.trim() === name) sheets.push({ name, rows: sheet.rows });
  }
  const declared = declaredSheets(bytes);
  if (declared === null) issues.push({ code: "SHEET_LIST_UNAVAILABLE", where: "工作簿", detail: "工作簿不在通常的位置，没有核对是否有多余的表" });
  for (const sheet of declared ?? []) {
    if (!PRICE_SHEET_NAMES.includes(sheet.name)) issues.push({ code: "UNEXPECTED_SHEET", where: sheet.name, detail: "不是约定的表，没有读" });
    if (sheet.hidden) issues.push({ code: "HIDDEN_SHEET", where: sheet.name, detail: "这张表是隐藏的" });
  }
  return { sheets, issues };
}

/** 从 `start` 往上找 `.git`（目录没创建时看最近一个已存在的上级，软链接先解开）。 */
export function insideGitRepository(start: string): boolean {
  let existing = resolve(start);
  while (!existsSync(existing) && dirname(existing) !== existing) existing = dirname(existing);
  let current = realpathSync(existing);
  for (;;) {
    if (existsSync(join(current, ".git"))) return true;
    const parent = dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

async function readMaster(path: string): Promise<PriceSheetMaster> {
  const info = await stat(path);
  if (!info.isFile()) throw new ReportFailure("--master 不是文件。");
  if (info.size > MAX_MASTER_BYTES) throw new ReportFailure("--master 的文件太大。");
  let input: unknown;
  try {
    input = JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new ReportFailure("--master 不是合法的 JSON。");
  }
  return parsePriceSheetMaster(input);
}

function summary(report: PriceSheetReport, sha256: string, outDir: string): string {
  const lines = [
    "只读 dry-run，没有写任何业务数据。",
    `sha256：${sha256}`,
    `路线 ${report.totals.routes}，有价的格 ${report.totals.pricedCells}，空的格 ${report.totals.emptyCells}，不合规的格 ${report.totals.invalidCells}`,
    ...PRICE_SHEET_ROUTE_CLASSES.map((routeClass) => `  ${PRICE_SHEET_ROUTE_CLASS_NAMES[routeClass]}：${report.totals.classes[routeClass].routes}`),
    `解析问题 ${report.issues.length} 条`,
    `报告：${join(outDir, "report.md")}、${join(outDir, "report.json")}`,
  ];
  return lines.join("\n");
}

/** 运行一次。除了最后写两份报告，没有别的写操作；任何一步失败都什么也不写。 */
export async function runPriceSheetReport(options: ReportOptions, now: Date): Promise<{ report: PriceSheetReport; sha256: string; outDir: string }> {
  const outInput = options.out;
  if (outInput !== null && insideGitRepository(outInput)) throw new ReportFailure("--out 在 git 仓库里面：报告含价格，不能放进仓库。");
  const info = await stat(options.file);
  if (!info.isFile()) throw new ReportFailure("--file 不是文件。");
  if (info.size > XLSX_LIMITS.maxFileBytes) throw new ReportFailure(`文件太大（上限 ${XLSX_LIMITS.maxFileBytes} 字节），没有读取。`);
  const bytes = await readFile(options.file);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (options.expectSha256 !== null && options.expectSha256 !== sha256) throw new ReportFailure(`文件的 sha256 不符：期望 ${options.expectSha256}，实际 ${sha256}。没有解析。`);
  const master = options.master === null ? null : await readMaster(options.master);
  const { sheets, issues } = readPriceWorkbook(bytes);
  const report = buildPriceSheetReport(parsePriceWorkbook(sheets, issues), master);

  const outDir = resolve(outInput ?? join(tmpdir(), `nozomi-price-sheet-report-${sha256.slice(0, 12)}`));
  await mkdir(outDir, { recursive: true, mode: 0o700 });
  const file = { name: basename(options.file), sha256, bytes: bytes.length, masterProvided: master !== null };
  const written = [
    { path: join(outDir, "report.md"), content: renderPriceSheetMarkdown(report, file) },
    { path: join(outDir, "report.json"), content: `${JSON.stringify({ generatedAt: now.toISOString(), file, ...report }, null, 2)}\n` },
  ];
  for (const { path, content } of written) {
    await writeFile(path, content, { mode: 0o600 });
    await chmod(path, 0o600);
  }
  return { report, sha256, outDir };
}

/** 错误信息里可能有文件里的文字：去掉控制字符，防止终端转义。 */
const printable = (text: string): string => text.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, " ");

function failureMessage(err: unknown): string {
  if (err instanceof ReportFailure) return `${err.message}\n${USAGE}`;
  if (err instanceof XlsxError) return `没有生成报告：${err.message}（${err.code}）`;
  if (err instanceof ZipError) return `没有生成报告：${err.message}`;
  if (err instanceof PriceSheetError) return `没有生成报告：${err.message}（${err.code}）`;
  const code = (err as NodeJS.ErrnoException | null)?.code;
  if (code === "ENOENT" || code === "EACCES" || code === "EISDIR") return `没有生成报告：文件读不了或目录写不了（${code}）。`;
  return "没有生成报告：未知错误。";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const result = await runPriceSheetReport(readReportOptions(process.argv.slice(2)), new Date());
    console.log(summary(result.report, result.sha256, result.outDir));
  } catch (err) {
    console.error(printable(failureMessage(err)));
    process.exit(1);
  }
}
