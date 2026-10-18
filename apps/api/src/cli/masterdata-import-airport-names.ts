/**
 * `pnpm masterdata:import-airport-names --country <国家码,国家码> [--dry-run]`
 * 从公开数据源 GeoNames 给库里的机场补上中文名、日文名（M1-15，ADR 0024）。
 *
 * - 数据来源：GeoNames，https://www.geonames.org/ ；许可：知识共享 署名 4.0（CC BY 4.0），使用时须注明来源；对方不保证准确。
 * - 文件：不带 `--file` 时自动下载所选国家的两个文件——<国家码>.zip（认出哪些记录是机场）和 alternatenames/<国家码>.zip（三字码和各语言名称）。
 *   带 `--file <国家文件> --names-file <名称文件>` 就完全不联网（两个都可以给多次，每个国家一个；.zip 或解压好的 .txt 都行）。
 * - 按三字码对应到库里的机场。只填空着的语言：已经有名称的不改；以前由导入填过、后来平台删掉的不再补回去。
 * - 可以反复运行：第二次运行时已经填过的都会跳过。
 * - `--dry-run` 只显示将要做什么，不写数据库。
 * 每个填了名称的机场都写审计日志（操作者是「系统」，入口是命令行）。
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "@nozomi/config";
import { type AirportNamePlan, type AirportNameSelection, GEONAMES, geonamesCountryFile, geonamesNamesFile, selectAirportNames } from "@nozomi/domain";
import { createPool } from "../db/pool.ts";
import { downloadCountryPlaces, downloadPlaceNames, geonamesText } from "../integrations/geonames.ts";
import { importAirportNames } from "../services/airport-name-import.ts";
import { LIST_LIMIT, UsageError, failureMessage, listed, readCountries } from "./import-common.ts";

const USAGE = [
  "用法：pnpm masterdata:import-airport-names --country <国家码[,国家码…]> [--dry-run]",
  "      不联网：再加 --file <国家码.zip 或 .txt> --names-file <alternatenames 的 国家码.zip 或 .txt>（两个都可以给多次，每个国家一个）",
  "国家码是 ISO 3166-1 的两位字母，例如 JP,KR。只给库里已有的机场填空着的中文名、日文名，已经有的不改。",
].join("\n");

const LANGUAGE_NAMES = { ja: "日文", zh: "中文" } as const;

interface Options {
  countries: string[];
  files: string[];
  namesFiles: string[];
  dryRun: boolean;
}

function readOptions(argv: readonly string[]): Options {
  let values: { country?: string | undefined; file?: string[] | undefined; "names-file"?: string[] | undefined; "dry-run"?: boolean | undefined };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        country: { type: "string" },
        file: { type: "string", multiple: true },
        "names-file": { type: "string", multiple: true },
        "dry-run": { type: "boolean" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    throw new UsageError("参数不正确。");
  }
  if (values.country === undefined) throw new UsageError("要用 --country 指定国家。");
  const countries = readCountries(values.country, undefined) as string[];
  const files = values.file ?? [];
  const namesFiles = values["names-file"] ?? [];
  if ([...files, ...namesFiles].some((path) => path.trim() === "")) throw new UsageError("--file、--names-file 后面要跟文件路径。");
  if ((files.length > 0) !== (namesFiles.length > 0)) {
    throw new UsageError("--file 和 --names-file 要一起给：前者认出哪些记录是机场，后者提供三字码和各语言名称。");
  }
  return { countries, files, namesFiles, dryRun: values["dry-run"] === true };
}

/** 读一个本地的 GeoNames 文件：.zip 就取出里面同名的 .txt，否则当作解压好的文本。 */
async function readLocal(path: string): Promise<string> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch {
    throw new UsageError(`读不到文件：${path}`);
  }
  return geonamesText(bytes, basename(path).replace(/\.zip$/i, ".txt"));
}

interface Sources {
  places: string[];
  names: string[];
  note: string;
}

async function readSources(options: Options): Promise<Sources> {
  if (options.files.length > 0) {
    const places: string[] = [];
    const names: string[] = [];
    for (const path of options.files) places.push(await readLocal(path));
    for (const path of options.namesFiles) names.push(await readLocal(path));
    return { places, names, note: `国家文件：${options.files.join("、")}；名称文件：${options.namesFiles.join("、")}` };
  }
  const places: string[] = [];
  const names: string[] = [];
  for (const country of options.countries) {
    places.push(await downloadCountryPlaces(country));
    names.push(await downloadPlaceNames(country));
  }
  const urls = options.countries.flatMap((country) => [geonamesCountryFile(country).url, geonamesNamesFile(country).url]);
  return { places, names, note: `文件：${urls.join("、")}` };
}

function report(options: Options, sources: Sources, selection: AirportNameSelection, plan: AirportNamePlan): string {
  const filled = (language: "ja" | "zh"): number => plan.fills.filter((fill) => fill.languages.includes(language)).length;
  const matched = plan.fills.length + plan.unchanged.length;
  const lines = [
    `数据来源：${GEONAMES.name}（${GEONAMES.homepage}），许可：${GEONAMES.license}（${GEONAMES.licenseUrl}）`,
    sources.note,
    `数据源里 ${options.countries.join("、")} 的机场记录 ${selection.totalAirports} 个，其中有三字码的 ${selection.airports.length + selection.ambiguous.length} 个`,
    `库里 ${options.countries.join("、")} 的机场：对上了 ${matched} 个；数据源里找不到三字码的 ${plan.notFound.length} 个；需要人工处理 ${plan.conflicts.length} 个`,
    options.dryRun ? "试运行：下面是将要做的改动，数据库没有任何变化。" : "导入完成。",
    `${options.dryRun ? "将给" : "给"} ${plan.fills.length} 个机场${options.dryRun ? "填" : "填了"}名称（日文 ${filled("ja")} 个、中文 ${filled("zh")} 个）；没有要填的 ${plan.unchanged.length} 个`,
  ];
  if (plan.fills.length > 0) {
    const shown = plan.fills.slice(0, LIST_LIMIT).map((fill) => `  - ${fill.code}：${fill.languages.map((language) => `${LANGUAGE_NAMES[language]}「${fill.after[language] ?? ""}」`).join("，")}`);
    lines.push(...shown);
    if (plan.fills.length > LIST_LIMIT) lines.push(`  - …… 其余 ${plan.fills.length - LIST_LIMIT} 个略`);
  }
  if (plan.keptFilled.length > 0) {
    lines.push(`已经有名称、和数据源的不一样，没有覆盖 ${plan.keptFilled.length} 处：`);
    for (const kept of plan.keptFilled.slice(0, LIST_LIMIT)) {
      const why = kept.importedBefore ? "以前导入的，数据源后来改了；只填空着的，不更新" : "平台填的";
      lines.push(`  - ${kept.code} ${LANGUAGE_NAMES[kept.language]}：库里是「${kept.current}」（${why}），数据源是「${kept.incoming}」`);
    }
    if (plan.keptFilled.length > LIST_LIMIT) lines.push(`  - …… 其余 ${plan.keptFilled.length - LIST_LIMIT} 处略`);
  }
  if (plan.keptCleared.length > 0) {
    lines.push(`以前导入过、平台后来删掉了，没有再填 ${plan.keptCleared.length} 处：${listed(plan.keptCleared.map((kept) => `${kept.code} ${LANGUAGE_NAMES[kept.language]}`))}`);
  }
  if (plan.traditionalOnly.length > 0) {
    lines.push(`数据源里只有繁体中文名、中文名没有填的 ${plan.traditionalOnly.length} 个（请在后台填简体）：${listed(plan.traditionalOnly)}`);
  }
  if (plan.notFound.length > 0) lines.push(`数据源里找不到的：${listed(plan.notFound)}`);
  if (plan.conflicts.length > 0) {
    lines.push(`需要人工处理 ${plan.conflicts.length} 个（这次没有动它们）：`);
    for (const conflict of plan.conflicts.slice(0, LIST_LIMIT)) lines.push(`  - ${conflict.code}：${conflict.reason}`);
    if (plan.conflicts.length > LIST_LIMIT) lines.push(`  - …… 其余 ${plan.conflicts.length - LIST_LIMIT} 个略`);
  }
  if (selection.skipped.length > 0) {
    lines.push(`国家文件里跳过 ${selection.skipped.length} 条不合格的机场记录：`);
    for (const row of selection.skipped.slice(0, LIST_LIMIT)) lines.push(`  - 第 ${row.row} 行 ${row.label}：${row.reason}`);
    if (selection.skipped.length > LIST_LIMIT) lines.push(`  - …… 其余 ${selection.skipped.length - LIST_LIMIT} 条略`);
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const options = readOptions(process.argv.slice(2));
  const config = loadConfig();
  const sources = await readSources(options);
  const selection = selectAirportNames(sources.places, sources.names, options.countries);
  const pool = createPool(config.databaseUrl, { max: 1 });
  try {
    const plan = await importAirportNames(pool, selection, new Date(), { countries: options.countries, dryRun: options.dryRun });
    console.log(report(options, sources, selection, plan));
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
