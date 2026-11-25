/**
 * `pnpm masterdata:import-airport-names-reviewed --country <国家码,国家码> [--file <核对表>] [--dry-run]`
 * 按仓库里人核对过的机场名称表（apps/api/masterdata/airport-names-reviewed.json，M12-06）给库里空着的日文、简体中文名补上。
 *
 * - 表里每一条写明来源（GeoNames 繁体转简体并经业主确认、维基数据 CC0、机场官方民航名称）；来源记进 places.name_sources。
 * - 只填空着的语言，已经有的不改；以前导入填过、后来平台删掉的不补回去；不动搜索别名。可以反复运行。
 * - 表里有一条不合格，整张表不用，什么都不写。
 * - `--dry-run` 只显示将要做什么，不写数据库。每个填了名称的机场都写审计日志（操作者「系统」，入口「命令行」）。
 */
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { loadConfig } from "@nozomi/config";
import { type ReviewedAirportName, type ReviewedAirportNameIssue, type ReviewedAirportNamePlan, readReviewedAirportNames } from "@nozomi/domain";
import { createPool } from "../db/pool.ts";
import { importReviewedAirportNames } from "../services/reviewed-airport-names.ts";
import { LIST_LIMIT, UsageError, failureMessage, listed, readCountries } from "./import-common.ts";

const DEFAULT_FILE = new URL("../../masterdata/airport-names-reviewed.json", import.meta.url);
const LANGUAGE_NAMES = { ja: "日文", zh: "中文" } as const;

const USAGE = [
  "用法：pnpm masterdata:import-airport-names-reviewed --country <国家码[,国家码…]> [--file <核对表.json>] [--dry-run]",
  "按仓库里的机场名称核对表（apps/api/masterdata/airport-names-reviewed.json）给空着的日文、中文名补上，已经有的不改。",
].join("\n");

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

function issueText(issue: ReviewedAirportNameIssue): string {
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
    case "UNKNOWN_LANGUAGE":
      return `不认识的语言 ${language}（只填 ja、zh）`;
    case "NAME_FORMAT":
      return `${language} 名称要是 1 到 200 个字、首尾没有空白`;
    case "NOT_SIMPLIFIED":
      return `中文名「${issue.text ?? ""}」里有繁体 / 日文字形：${issue.chars ?? ""}`;
    case "NOT_JAPANESE":
      return `日文名「${issue.text ?? ""}」里没有汉字或假名`;
    case "NO_SOURCE":
      return `${language} 名称要写来源（sources.${language}，1 到 300 个字）`;
    case "NOTHING_TO_FILL":
      return "没有要填的名称";
  }
}

async function readTable(file: URL | string): Promise<ReviewedAirportName[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(file, "utf8"));
  } catch {
    throw new UsageError(`读不出核对表（不存在或不是 JSON）：${String(file)}`);
  }
  const { entries, issues } = readReviewedAirportNames(raw);
  if (issues.length > 0) {
    const lines = issues.slice(0, LIST_LIMIT).map((issue) => `  - 第 ${issue.index} 条${issue.code ? ` ${issue.code}` : ""}：${issueText(issue)}`);
    if (issues.length > LIST_LIMIT) lines.push(`  - …… 其余 ${issues.length - LIST_LIMIT} 处略`);
    throw new UsageError(`核对表有 ${issues.length} 处不合格，整张表没有用，数据库没有任何变化：\n${lines.join("\n")}`);
  }
  return entries;
}

function report(options: Pick<Options, "countries" | "dryRun">, entries: readonly ReviewedAirportName[], plan: ReviewedAirportNamePlan): string {
  const inScope = entries.filter((entry) => options.countries.includes(entry.country)).length;
  const filled = (language: "ja" | "zh"): number => plan.fills.filter((fill) => fill.languages.includes(language)).length;
  const lines = [
    `核对表里 ${options.countries.join("、")} 的机场 ${inScope} 个；库里还没有的 ${plan.notInDatabase.length} 个（没导入的机场，不用管）`,
    options.dryRun ? "试运行：下面是将要做的改动，数据库没有任何变化。" : "写入完成。",
    `${options.dryRun ? "将给" : "给"} ${plan.fills.length} 个机场${options.dryRun ? "填" : "填了"}名称（日文 ${filled("ja")} 个、中文 ${filled("zh")} 个）；已经都有、没有要填的 ${plan.unchanged.length} 个`,
  ];
  for (const fill of plan.fills.slice(0, LIST_LIMIT * 5)) {
    lines.push(`  - ${fill.code}：${fill.languages.map((language) => `${LANGUAGE_NAMES[language]}「${fill.after[language] ?? ""}」（${fill.refs[language] ?? ""}）`).join("；")}`);
  }
  if (plan.fills.length > LIST_LIMIT * 5) lines.push(`  - …… 其余 ${plan.fills.length - LIST_LIMIT * 5} 个略`);
  if (plan.keptFilled.length > 0) {
    lines.push(`已经有名称、和核对表不一样，没有覆盖 ${plan.keptFilled.length} 处：`);
    for (const kept of plan.keptFilled.slice(0, LIST_LIMIT)) lines.push(`  - ${kept.code} ${LANGUAGE_NAMES[kept.language]}：库里是「${kept.current}」，核对表是「${kept.incoming}」`);
    if (plan.keptFilled.length > LIST_LIMIT) lines.push(`  - …… 其余 ${plan.keptFilled.length - LIST_LIMIT} 处略`);
  }
  if (plan.keptCleared.length > 0) lines.push(`以前导入过、平台后来删掉了，没有再填 ${plan.keptCleared.length} 处：${listed(plan.keptCleared.map((kept) => `${kept.code} ${LANGUAGE_NAMES[kept.language]}`))}`);
  if (plan.conflicts.length > 0) {
    lines.push(`需要人工处理 ${plan.conflicts.length} 个（这次没有动它们）：`);
    for (const conflict of plan.conflicts.slice(0, LIST_LIMIT)) {
      lines.push(
        conflict.problem === "COUNTRY_MISMATCH"
          ? `  - ${conflict.code}：核对表里是 ${conflict.country ?? ""}，库里的机场在 ${conflict.actual ?? ""}，没有填`
          : `  - ${conflict.code}：写入期间平台在后台改了这个机场，没有填；需要的话请再运行一次`,
      );
    }
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const options = readOptions(process.argv.slice(2));
  const entries = await readTable(options.file);
  const config = loadConfig();
  const pool = createPool(config.databaseUrl, { max: 1 });
  try {
    const plan = await importReviewedAirportNames(pool, entries, new Date(), { countries: options.countries, dryRun: options.dryRun });
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
