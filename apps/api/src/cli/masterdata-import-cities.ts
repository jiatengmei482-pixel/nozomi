/**
 * `pnpm masterdata:import-cities --country <国家码,国家码> [--min-population <人口>] [--activate] [--dry-run]`
 * 从公开数据源 GeoNames 导入主要城市（多语言名称、IANA 时区、中心坐标）。
 *
 * - 数据来源：GeoNames，https://www.geonames.org/ ；许可：知识共享 署名 4.0（CC BY 4.0），使用时须注明来源；对方不保证准确。
 * - 范围：所选国家里人口不少于 `--min-population`（默认 30 万）的城市，外加首都和一级行政区（都道府县等）的首府。
 *   `--all-countries` 导入全部国家。
 * - 文件：不带 `--file` 时自动下载并解压——城市文件 cities15000.zip，以及所选国家的各语言名称文件 alternatenames/<国家码>.zip。
 *   带 `--file <城市文件>` 就完全不联网：城市读这个文件；各语言名称读 `--names-file <文件>`（可以给多次，每个国家一个），
 *   不给就只有英文名。两种文件都可以是下载下来的 .zip，也可以是解压好的 .txt。
 * - 可以反复运行：按数据源里的城市编号认同一个城市，只新增没有的、更新名称 / 时区 / 坐标变了的。
 *   平台在后台改过的城市不会被覆盖；和手工建的城市看起来相同的不合并也不重复创建，列出来交给人处理。
 * - 新导入的城市默认是停用的（等平台复核）；`--activate` 让这次新增的城市直接启用。
 * - `--dry-run` 只显示将要做什么，不写数据库。
 * 每个新增和更新都写审计日志（操作者是「系统」，入口是命令行）。
 */
import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { parseArgs } from "node:util";
import { loadConfig } from "@nozomi/config";
import { type CitySelection, DEFAULT_MIN_POPULATION, EXCLUDED_CITY_REASON_NAMES, GEONAMES, selectCities } from "@nozomi/domain";
import { createPool } from "../db/pool.ts";
import { downloadCities, downloadCityNames, geonamesText } from "../integrations/geonames.ts";
import { type CityImportResult, importCities } from "../services/city-import.ts";
import { LIST_LIMIT, UsageError, failureMessage, listed, readCountries } from "./import-common.ts";

const USAGE = [
  "用法：pnpm masterdata:import-cities --country <国家码[,国家码…]> [--min-population <人口>] [--activate] [--dry-run]",
  "      pnpm masterdata:import-cities --all-countries [同上]",
  "      不联网：再加 --file <cities15000.zip 或 .txt> [--names-file <国家码.zip 或 .txt>]…（--names-file 可以给多次）",
  `国家码是 ISO 3166-1 的两位字母，例如 JP,KR。--min-population 默认 ${DEFAULT_MIN_POPULATION}（首都和一级行政区首府不受它限制）。`,
  "不带 --activate 时新导入的城市是停用的，等平台在后台复核后启用。",
].join("\n");

interface Options {
  countries: string[] | null;
  file: string | null;
  namesFiles: string[];
  minPopulation: number;
  activate: boolean;
  dryRun: boolean;
}

function readOptions(argv: readonly string[]): Options {
  let values: {
    country?: string | undefined;
    "all-countries"?: boolean | undefined;
    file?: string | undefined;
    "names-file"?: string[] | undefined;
    "min-population"?: string | undefined;
    activate?: boolean | undefined;
    "dry-run"?: boolean | undefined;
  };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        country: { type: "string" },
        "all-countries": { type: "boolean" },
        file: { type: "string" },
        "names-file": { type: "string", multiple: true },
        "min-population": { type: "string" },
        activate: { type: "boolean" },
        "dry-run": { type: "boolean" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    throw new UsageError("参数不正确。");
  }
  const countries = readCountries(values.country, values["all-countries"]);
  const namesFiles = values["names-file"] ?? [];
  if (values.file !== undefined && values.file.trim() === "") throw new UsageError("--file 后面要跟文件路径。");
  if (namesFiles.some((path) => path.trim() === "")) throw new UsageError("--names-file 后面要跟文件路径。");
  if (namesFiles.length > 0 && values.file === undefined) throw new UsageError("--names-file 要和 --file 一起用（带了 --file 就完全不联网）。");
  const minText = values["min-population"] ?? String(DEFAULT_MIN_POPULATION);
  if (!/^\d{1,10}$/.test(minText)) throw new UsageError("--min-population 必须是不小于 0 的整数。");
  return {
    countries,
    file: values.file ?? null,
    namesFiles,
    minPopulation: Number(minText),
    activate: values.activate === true,
    dryRun: values["dry-run"] === true,
  };
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
  cities: string;
  names: string[];
  /** 名称是从哪来的，给输出用 */
  namesNote: string;
}

async function readSources(options: Options): Promise<Sources> {
  if (options.file !== null) {
    const names: string[] = [];
    for (const path of options.namesFiles) names.push(await readLocal(path));
    return {
      cities: await readLocal(options.file),
      names,
      namesNote: names.length > 0 ? `各语言名称：${options.namesFiles.join("、")}` : "各语言名称：没有给 --names-file，只导入英文名",
    };
  }
  const cities = await downloadCities();
  if (options.countries === null) return { cities, names: [], namesNote: "各语言名称：--all-countries 时不自动下载，只导入英文名（需要的话按国家再运行一次）" };
  const names: string[] = [];
  for (const country of options.countries) names.push(await downloadCityNames(country));
  return { cities, names, namesNote: `各语言名称：${options.countries.map((country) => `alternatenames/${country}.zip`).join("、")}` };
}

function report(options: Options, sources: Sources, selection: CitySelection, result: CityImportResult): string {
  const languages = (["ja", "zh", "en", "ko"] as const).map((language) => `${language} ${selection.cities.filter((city) => city.name[language] !== undefined).length}`);
  const lines = [
    `数据来源：${GEONAMES.name}（${GEONAMES.homepage}），许可：${GEONAMES.license}（${GEONAMES.licenseUrl}）`,
    `城市文件：${options.file ?? GEONAMES.citiesUrl}，共 ${selection.totalRows} 行；${sources.namesNote}`,
    `范围：${options.countries === null ? "全部国家" : options.countries.join("、")} 人口不少于 ${options.minPopulation} 的城市，外加首都和一级行政区首府，共 ${selection.cities.length} 个`,
    `其中有名称的：${languages.join("、")}`,
    options.dryRun ? "试运行：下面是将要做的改动，数据库没有任何变化。" : "导入完成。",
    options.activate
      ? `新增 ${result.creates.length} 个（已直接启用：--activate）`
      : `新增 ${result.creates.length} 个（停用状态，等平台在后台复核后启用；要直接启用请加 --activate）`,
    `更新 ${result.updates.length} 个；没有变化 ${result.unchanged.length} 个；平台改过、没有覆盖 ${result.keptManual.length} 个`,
  ];
  if (result.creates.length > 0) lines.push(`  新增的：${listed(result.creates.map((city) => `${city.name.en ?? city.code}`))}`);
  if (result.keptManual.length > 0) lines.push(`  平台改过的：${listed(result.keptManual)}`);
  if (result.populationBackfilled > 0) lines.push(`给 ${result.populationBackfilled} 个已有的城市${options.dryRun ? "将补上" : "补上了"}数据源里的人口（只用来给机场建议城市，不算修改）`);
  if (selection.excluded.length > 0) {
    lines.push(`没有选的 ${selection.excluded.length} 条（人口够，但不是城市）：`);
    for (const row of selection.excluded.slice(0, LIST_LIMIT)) lines.push(`  - ${row.label}：${EXCLUDED_CITY_REASON_NAMES[row.reason]}`);
    if (selection.excluded.length > LIST_LIMIT) lines.push(`  - …… 其余 ${selection.excluded.length - LIST_LIMIT} 条略`);
  }
  if (result.excludedExisting.length > 0) {
    lines.push(`以前导入过、其实不是城市的 ${result.excludedExisting.length} 个（没有自动停用，也没有删除；请在后台核对后停用，已经挂了地点的先把地点改到正确的城市）：`);
    for (const row of result.excludedExisting) lines.push(`  - ${row.label}：${EXCLUDED_CITY_REASON_NAMES[row.reason]}`);
  }
  const skipped = [
    ...selection.skipped.map((row) => `第 ${row.row} 行 ${row.label}：${row.reason}`),
    ...result.unknownTimeZones.map((city) => `${city.label}：数据库不认识时区 ${city.timezone}`),
  ];
  if (skipped.length > 0) {
    lines.push(`跳过 ${skipped.length} 条不合格的记录：`);
    for (const row of skipped.slice(0, LIST_LIMIT)) lines.push(`  - ${row}`);
    if (skipped.length > LIST_LIMIT) lines.push(`  - …… 其余 ${skipped.length - LIST_LIMIT} 条略`);
  }
  if (result.conflicts.length > 0) {
    lines.push(`需要人工处理 ${result.conflicts.length} 个（这次没有动它们）：`);
    for (const conflict of result.conflicts.slice(0, LIST_LIMIT)) lines.push(`  - ${conflict.label}：${conflict.reason}`);
    if (result.conflicts.length > LIST_LIMIT) lines.push(`  - …… 其余 ${result.conflicts.length - LIST_LIMIT} 个略`);
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const options = readOptions(process.argv.slice(2));
  const config = loadConfig();
  const sources = await readSources(options);
  const selection = selectCities(sources.cities, sources.names, { countries: options.countries, minPopulation: options.minPopulation });
  const pool = createPool(config.databaseUrl, { max: 1 });
  try {
    const result = await importCities(pool, selection, new Date(), { dryRun: options.dryRun, activate: options.activate });
    console.log(report(options, sources, selection, result));
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
