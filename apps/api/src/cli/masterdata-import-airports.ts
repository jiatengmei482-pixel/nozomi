/**
 * `pnpm masterdata:import-airports --country <国家码,国家码> [--file <airports.csv>] [--dry-run]`
 * 从公开数据源 OurAirports 导入机场（三字码、英文名、坐标）。
 *
 * - 数据来源：OurAirports，https://ourairports.com/data/ ；许可：公有领域（Public Domain），对方不保证准确。
 * - 范围：所选国家里有定期航班的大型、中型机场。`--all-countries` 导入全部国家。
 * - 不带 `--file` 时从 https://davidmegginson.github.io/ourairports-data/airports.csv 下载；带了就读本地文件，不联网。
 * - 可以反复运行：按数据源里的机场编号认同一个机场，只新增没有的、更新名称或坐标变了的。
 *   平台在后台改过的机场、手工录入的机场不会被覆盖。
 * - 新导入的机场是停用的、没有所属城市：由平台在后台指定城市后启用。
 * - `--dry-run` 只显示将要做什么，不写数据库。
 * 每个新增和更新都写审计日志（操作者是「系统」，入口是命令行）。
 */
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { loadConfig } from "@nozomi/config";
import {
  type AirportImportPlan,
  type AirportSelection,
  OURAIRPORTS,
  decodeUtf8Strict,
  selectAirports,
} from "@nozomi/domain";
import { createPool } from "../db/pool.ts";
import { downloadAirportsCsv } from "../integrations/ourairports.ts";
import { importAirports } from "../services/airport-import.ts";
import { LIST_LIMIT, UsageError, failureMessage, listed, readCountries } from "./import-common.ts";

const USAGE = [
  "用法：pnpm masterdata:import-airports --country <国家码[,国家码…]> [--file <airports.csv 的路径>] [--dry-run]",
  "      pnpm masterdata:import-airports --all-countries [--file <airports.csv 的路径>] [--dry-run]",
  "国家码是 ISO 3166-1 的两位字母，例如 JP,KR。不带 --file 时从 OurAirports 下载最新文件。",
].join("\n");

interface Options {
  countries: string[] | null;
  file: string | null;
  dryRun: boolean;
}

function readOptions(argv: readonly string[]): Options {
  let values: { country?: string | undefined; "all-countries"?: boolean | undefined; file?: string | undefined; "dry-run"?: boolean | undefined };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        country: { type: "string" },
        "all-countries": { type: "boolean" },
        file: { type: "string" },
        "dry-run": { type: "boolean" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    throw new UsageError("参数不正确。");
  }
  const countries = readCountries(values.country, values["all-countries"]);
  if (values.file !== undefined && values.file.trim() === "") throw new UsageError("--file 后面要跟文件路径。");
  return { countries, file: values.file ?? null, dryRun: values["dry-run"] === true };
}

function report(options: Options, selection: AirportSelection, plan: AirportImportPlan): string {
  const lines = [
    `数据来源：${OURAIRPORTS.name}（${OURAIRPORTS.homepage}），许可：${OURAIRPORTS.license}`,
    `文件：${options.file ?? OURAIRPORTS.downloadUrl}，共 ${selection.totalRows} 条记录`,
    `范围：${options.countries === null ? "全部国家" : options.countries.join("、")} 有定期航班的大型、中型机场，共 ${selection.airports.length} 个`,
    options.dryRun ? "试运行：下面是将要做的改动，数据库没有任何变化。" : "导入完成。",
    `新增 ${plan.creates.length} 个（停用状态，等平台在后台指定所属城市后启用）`,
    `更新 ${plan.updates.length} 个；没有变化 ${plan.unchanged.length} 个；平台改过、没有覆盖 ${plan.keptManual.length} 个`,
  ];
  if (plan.keptManual.length > 0) lines.push(`  平台改过的：${listed(plan.keptManual)}`);
  if (selection.skipped.length > 0) {
    lines.push(`跳过 ${selection.skipped.length} 条不合格的记录：`);
    for (const row of selection.skipped.slice(0, LIST_LIMIT)) lines.push(`  - 第 ${row.row} 条 ${row.label}：${row.reason}`);
    if (selection.skipped.length > LIST_LIMIT) lines.push(`  - …… 其余 ${selection.skipped.length - LIST_LIMIT} 条略`);
  }
  if (plan.conflicts.length > 0) {
    lines.push(`需要人工处理 ${plan.conflicts.length} 个（这次没有动它们）：`);
    for (const conflict of plan.conflicts.slice(0, LIST_LIMIT)) lines.push(`  - ${conflict.iata}：${conflict.reason}`);
    if (plan.conflicts.length > LIST_LIMIT) lines.push(`  - …… 其余 ${plan.conflicts.length - LIST_LIMIT} 个略`);
  }
  if (plan.outOfScope.length > 0) {
    lines.push(`以前导入过、现在数据源里已关闭或不再有定期航班的 ${plan.outOfScope.length} 个（没有自动停用，请人工确认）：${listed(plan.outOfScope)}`);
  }
  return lines.join("\n");
}

async function readSource(options: Options): Promise<string> {
  if (options.file === null) return downloadAirportsCsv();
  let bytes: Buffer;
  try {
    bytes = await readFile(options.file);
  } catch {
    throw new UsageError(`读不到文件：${options.file}`);
  }
  return decodeUtf8Strict(bytes);
}

async function main(): Promise<void> {
  const options = readOptions(process.argv.slice(2));
  const config = loadConfig();
  const selection = selectAirports(await readSource(options), options.countries);
  const pool = createPool(config.databaseUrl, { max: 1 });
  try {
    const plan = await importAirports(pool, selection, new Date(), { dryRun: options.dryRun });
    console.log(report(options, selection, plan));
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch (err) {
  console.error(failureMessage(err, USAGE));
  process.exit(1);
}
