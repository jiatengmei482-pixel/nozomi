/**
 * `pnpm masterdata:import-airport-terminals-reviewed --country <国家码,国家码> [--file <核对表>] [--dry-run]`
 * 按仓库里人核对过的航站楼核对表（apps/api/masterdata/airport-terminals-reviewed.json，M12-06）
 * 给机场填地址、集合地点说明，新建库里还没有的航站楼，给已有的航站楼填空着的地址、集合地点、名称语言。
 *
 * - 表里每一项写明来源（机场官网、政府资料、维基数据；不用谷歌数据）；来源记进 places.content_sources / name_sources 和审计日志。
 * - 只填空着的，已经有的不改；以前导入填过、后来平台删掉的不补回去。可以反复运行。
 * - 航站楼坐标和机场相距超过 5 公里的不动，列出来交给人看。
 * - 表里有一处不合格，整张表不用，什么都不写。
 * - `--dry-run` 只显示将要做什么，不写数据库。
 */
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { loadConfig } from "@nozomi/config";
import { type ReviewedAirportTerminals, type ReviewedTerminalIssue, type ReviewedTerminalPlan, readReviewedAirportTerminals } from "@nozomi/domain";
import { createPool } from "../db/pool.ts";
import { importReviewedAirportTerminals } from "../services/reviewed-airport-terminals.ts";
import { LIST_LIMIT, UsageError, failureMessage, listed, readCountries } from "./import-common.ts";

const DEFAULT_FILE = new URL("../../masterdata/airport-terminals-reviewed.json", import.meta.url);

const USAGE = [
  "用法：pnpm masterdata:import-airport-terminals-reviewed --country <国家码[,国家码…]> [--file <核对表.json>] [--dry-run]",
  "按仓库里的航站楼核对表（apps/api/masterdata/airport-terminals-reviewed.json）给机场填地址、集合地点，新建还没有的航站楼；已经有的不改。",
].join("\n");

const FIELD_NAMES: Readonly<Record<string, string>> = {
  address: "地址",
  meeting_point: "集合地点",
  "name.ja": "日文名",
  "name.zh": "中文名",
  "name.en": "英文名",
};
const fieldName = (field: string): string => FIELD_NAMES[field] ?? field;

interface Options {
  countries: string[];
  file: URL | string;
  dryRun: boolean;
}

function readOptions(argv: readonly string[]): Options {
  let values: { country?: string | undefined; file?: string | undefined; "dry-run"?: boolean | undefined };
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: { country: { type: "string" }, file: { type: "string" }, "dry-run": { type: "boolean" } },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    throw new UsageError("参数不正确。");
  }
  if (values.country === undefined) throw new UsageError("要用 --country 指定国家。");
  const countries = readCountries(values.country, undefined) as string[];
  if (values.file !== undefined && values.file.trim() === "") throw new UsageError("--file 后面要跟文件路径。");
  return { countries, file: values.file ?? DEFAULT_FILE, dryRun: values["dry-run"] === true };
}

function issueText(issue: ReviewedTerminalIssue): string {
  const field = issue.field === undefined ? "" : `${issue.field}`;
  const language = issue.language ?? "";
  switch (issue.problem) {
    case "NO_LIST":
      return "核对表要有 airports 列表";
    case "CODE_FORMAT":
      return "三字码要是 3 位大写字母";
    case "DUPLICATE":
      return "三字码重复";
    case "COUNTRY_FORMAT":
      return "国家码要是 2 位大写字母";
    case "ADDRESS_FORMAT":
      return "地址要写成 {text, source}，text 是 1 到 300 个字、首尾没有空白";
    case "NO_POSTCODE":
      return `日本的地址要带邮编（如 〒144-0041）：「${issue.text ?? ""}」`;
    case "NOT_JAPANESE":
      return `${field === "address" ? "日本的地址" : "日文名"}里没有汉字或假名：「${issue.text ?? ""}」`;
    case "NO_SOURCE":
      return `${field} 要写来源（1 到 300 个字；sources 是 1 到 10 条）`;
    case "MEETING_POINT_FORMAT":
      return language === ""
        ? "集合地点要写成 {zh, ja?, en?, source}，中文必填"
        : `集合地点的 ${language} 不合格（只认 zh、ja、en，每种 1 到 1000 个字、首尾没有空白；中文必填）`;
    case "MEETING_POINT_PLACEMENT":
      return "集合地点放错了地方：列了航站楼的机场写在各航站楼上，没列航站楼的（单航站楼）机场写在机场上";
    case "SUFFIX_FORMAT":
      return "航站楼的后缀要是 1 到 6 位大写字母或数字（如 T1）";
    case "SUFFIX_DUPLICATE":
      return "同一个机场里航站楼后缀重复";
    case "NAME_FORMAT":
      return `名称 ${language} 不合格（ja、zh、en 都要有，每种 1 到 200 个字、首尾没有空白，不认识别的语言）`;
    case "NOT_SIMPLIFIED":
      return `${field === "names" ? "中文名" : "集合地点的中文"}「${issue.text ?? ""}」里有繁体 / 日文字形：${issue.chars ?? ""}`;
    case "COORDINATE":
      return `坐标 ${field} 不对（纬度 ±90、经度 ±180 的数字）`;
    case "FLIGHT_SCOPE":
      return "flightScope 只能是 international、domestic、mixed";
  }
}

async function readTable(file: URL | string): Promise<ReviewedAirportTerminals[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new UsageError(`读不出核对表（不存在或不是 JSON）：${String(file)}`);
  }
  const { entries, issues } = readReviewedAirportTerminals(raw);
  if (issues.length > 0) {
    const lines = issues.slice(0, LIST_LIMIT).map((issue) => `  - 第 ${issue.index} 条${issue.code ? ` ${issue.code}` : ""}${issue.terminal ? ` 航站楼 ${issue.terminal}` : ""}：${issueText(issue)}`);
    if (issues.length > LIST_LIMIT) lines.push(`  - …… 其余 ${issues.length - LIST_LIMIT} 处略`);
    throw new UsageError(`核对表有 ${issues.length} 处不合格，整张表没有用，数据库没有任何变化：\n${lines.join("\n")}`);
  }
  return entries;
}

function report(options: Pick<Options, "countries" | "dryRun">, entries: readonly ReviewedAirportTerminals[], plan: ReviewedTerminalPlan): string {
  const inScope = entries.filter((entry) => options.countries.includes(entry.country));
  const terminalCount = inScope.reduce((sum, entry) => sum + entry.terminals.length, 0);
  const will = options.dryRun ? "将" : "";
  const lines = [
    "来源：仓库里人核对过的核对表（机场官网、政府资料、维基数据 CC0），每一项的来源记在数据库和审计日志里。",
    `核对表里 ${options.countries.join("、")} 的机场 ${inScope.length} 个、航站楼 ${terminalCount} 个；库里还没有的机场 ${plan.notInDatabase.length} 个（没导入的机场，不用管）`,
    options.dryRun ? "试运行：下面是将要做的改动，数据库没有任何变化。" : "写入完成。",
    `${will}新建航站楼 ${plan.creates.length} 个${plan.creates.some((create) => create.status === "disabled") ? `（其中 ${plan.creates.filter((create) => create.status === "disabled").length} 个所属机场还没启用，建成停用的）` : ""}`,
  ];
  for (const create of plan.creates.slice(0, LIST_LIMIT * 5)) {
    lines.push(`  - ${create.code}「${create.name.zh ?? ""}」${create.status === "disabled" ? "（停用）" : ""}，距机场 ${(create.distanceMeters / 1000).toFixed(1)} 公里，坐标：${create.refs.coordinates}`);
  }
  if (plan.creates.length > LIST_LIMIT * 5) lines.push(`  - …… 其余 ${plan.creates.length - LIST_LIMIT * 5} 个略`);
  lines.push(`${will}给 ${plan.fills.length} 个机场 / 航站楼填了空着的项；已经都有、没有要填的 ${plan.unchanged.length} 个`);
  for (const fill of plan.fills.slice(0, LIST_LIMIT * 5)) lines.push(`  - ${fill.code}：${fill.fields.map(fieldName).join("、")}`);
  if (plan.fills.length > LIST_LIMIT * 5) lines.push(`  - …… 其余 ${plan.fills.length - LIST_LIMIT * 5} 个略`);
  if (plan.keptFilled.length > 0) {
    lines.push(`已经有值、和核对表不一样，没有覆盖 ${plan.keptFilled.length} 处：`);
    for (const kept of plan.keptFilled.slice(0, LIST_LIMIT)) lines.push(`  - ${kept.code} ${fieldName(kept.field)}：库里是「${kept.current}」，核对表是「${kept.incoming}」`);
    if (plan.keptFilled.length > LIST_LIMIT) lines.push(`  - …… 其余 ${plan.keptFilled.length - LIST_LIMIT} 处略`);
  }
  if (plan.keptCleared.length > 0) lines.push(`以前导入过、平台后来删掉了，没有再填 ${plan.keptCleared.length} 处：${listed(plan.keptCleared.map((kept) => `${kept.code} ${fieldName(kept.field)}`))}`);
  if (plan.conflicts.length > 0) {
    lines.push(`需要人工处理 ${plan.conflicts.length} 个（这次没有动它们）：`);
    for (const conflict of plan.conflicts.slice(0, LIST_LIMIT)) {
      switch (conflict.problem) {
        case "COUNTRY_MISMATCH":
          lines.push(`  - ${conflict.code}：核对表里是 ${conflict.country}，库里的机场在 ${conflict.actual}，没有填`);
          break;
        case "TOO_FAR":
          lines.push(`  - ${conflict.code}：坐标离机场 ${(conflict.distanceMeters / 1000).toFixed(1)} 公里，超过 5 公里，没有用；请核对坐标`);
          break;
        case "NOT_UNDER_AIRPORT":
          lines.push(`  - ${conflict.code}：库里有这个编码的航站楼，但不在这个机场下，没有动`);
          break;
        case "CHANGED_DURING_IMPORT":
          lines.push(`  - ${conflict.code}：写入期间平台在后台改了它，没有填；需要的话请再运行一次`);
          break;
      }
    }
    if (plan.conflicts.length > LIST_LIMIT) lines.push(`  - …… 其余 ${plan.conflicts.length - LIST_LIMIT} 个略`);
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const options = readOptions(process.argv.slice(2));
  const entries = await readTable(options.file);
  const config = loadConfig();
  const pool = createPool(config.databaseUrl, { max: 1 });
  try {
    const plan = await importReviewedAirportTerminals(pool, entries, new Date(), { countries: options.countries, dryRun: options.dryRun });
    console.log(report(options, entries, plan));
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
