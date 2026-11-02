/**
 * `pnpm price-sheet:import` —— 价格表导入第 1 阶段（ADR 0062，M4-28）：日本「机场↔地区」写成一个子品牌下的草稿商品。
 *
 * 四种用法：
 * 1. 离线计划（不连数据库）：`--file --expect-sha256 --mapping --batch --out` 加 `--target <导出.json>`（目标环境的只读导出），
 *    或 `--assume-pricing <加价基点>,<下限基点>,<最低毛利>,<对外价取整单位>`（还没有导出时按假设估算偏差，不核对主数据）。
 * 2. 连库 dry-run（默认）：把 `--target` 换成 `--tenant <编号> --channel <官网渠道编号>`，读目标库、算出要做什么、列出拦住的原因，不写。
 * 3. 连库写入：再加 `--apply`。只建这一批的子品牌、区域、草稿商品和价格规则；重复执行不重复创建。
 * 4. 撤回：`--revert --tenant <编号> --batch <批次号>`，默认 dry-run，加 `--apply` 才删。
 * 另有 `--print-target-sql`：打印目标环境只读导出用的 SQL（$1 租户编号、$2 渠道编号、$3 国家码），交给能连目标环境的人执行。
 *
 * 价格表、映射、导出和输出都含业主的商业数据：`--out` 不能在 git 仓库里，文件权限 600；终端只打印数字。
 */
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { loadConfig } from "@nozomi/config";
import {
  INVERSE_REASON_NAMES,
  PRICE_DIRECTION_NAMES,
  PRICE_IMPORT_SKIP_NAMES,
  type PriceImportAnomalies,
  type PriceImportOverlapCheck,
  type PriceImportPlan,
  type PriceImportPrecheckIssue,
  type PriceImportTarget,
  type PricedImportCell,
  type SitePriceRules,
  type MarkupRule,
  PriceImportError,
  PriceSheetError,
  escapePriceSheetText,
  groupPriceImport,
  parsePriceImportMapping,
  parsePriceImportTarget,
  parsePriceWorkbook,
  priceImportAnomalies,
  priceImportBatchIssue,
  priceImportOverlapCheck,
  planPriceSheetImport,
  pricePriceImportCells,
  resolvePriceImportTarget,
  sitePriceRulesFor,
} from "@nozomi/domain";
import { createPool, driverErrorCode } from "../db/pool.ts";
import { XLSX_LIMITS, XlsxError } from "../integrations/xlsx.ts";
import { ZipError } from "../integrations/zip.ts";
import { PRICE_IMPORT_TARGET_SQL } from "../repos/price-import.ts";
import { type PriceImportBlocker, PriceImportRunError, revertPriceImport, runPriceImport } from "../services/price-import.ts";
import { insideGitRepository, readPriceWorkbook } from "./price-sheet-report.ts";

/** 决定 D、生效日期（ADR 0059 补记）：只做日本这一张表，价格从 2026-11-01 起 */
export const IMPORT_SHEET = "日本";
export const IMPORT_COUNTRY = "JP";
export const IMPORT_VALID_FROM = "2026-11-01";
const CURRENCY = "JPY" as const;
const MAX_JSON_BYTES = 32 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const USAGE = [
  "用法：",
  "  离线计划：pnpm price-sheet:import --file <xlsx> --expect-sha256 <hex> --mapping <json> --batch <批次号> --out <目录> (--target <导出.json> | --assume-pricing <加价bp>,<下限bp>,<最低毛利>,<取整单位>)",
  "  连库：    pnpm price-sheet:import --file <xlsx> --expect-sha256 <hex> --mapping <json> --batch <批次号> --out <目录> --tenant <编号> --channel <官网渠道编号> [--apply]",
  "  撤回：    pnpm price-sheet:import --revert --tenant <编号> --batch <批次号> [--apply]",
  "  导出 SQL：pnpm price-sheet:import --print-target-sql",
  "不加 --apply 只读，不写数据库。--out 不能在 git 仓库里面。",
].join("\n");

class UsageError extends Error {}

export type ImportCommand =
  | { kind: "print-sql" }
  | { kind: "revert"; tenantId: string; batch: string; apply: boolean }
  | {
      kind: "plan";
      file: string;
      expectSha256: string;
      mapping: string;
      batch: string;
      out: string;
      source: { kind: "target"; path: string } | { kind: "assume"; rules: Omit<SitePriceRules, "currency" | "channelCurrency"> } | { kind: "database"; tenantId: string; channelId: string; apply: boolean };
    };

export function readImportCommand(argv: readonly string[]): ImportCommand {
  let values: Record<string, string | boolean | undefined>;
  try {
    ({ values } = parseArgs({
      args: [...argv],
      options: {
        file: { type: "string" },
        "expect-sha256": { type: "string" },
        mapping: { type: "string" },
        batch: { type: "string" },
        out: { type: "string" },
        target: { type: "string" },
        "assume-pricing": { type: "string" },
        tenant: { type: "string" },
        channel: { type: "string" },
        apply: { type: "boolean" },
        revert: { type: "boolean" },
        "print-target-sql": { type: "boolean" },
      },
      strict: true,
      allowPositionals: false,
    }));
  } catch {
    throw new UsageError("参数不正确。");
  }
  const text = (name: string): string | undefined => values[name] as string | undefined;
  const given = Object.keys(values).filter((key) => values[key] !== undefined);
  if (values["print-target-sql"] === true) {
    if (given.length > 1) throw new UsageError("--print-target-sql 不和别的参数一起用。");
    return { kind: "print-sql" };
  }
  const batch = text("batch");
  if (batch === undefined) throw new UsageError("必须给 --batch。");
  const batchIssue = priceImportBatchIssue(batch);
  if (batchIssue !== null) throw new UsageError(`${batchIssue}。`);
  const tenant = text("tenant");
  if (tenant !== undefined && !UUID.test(tenant)) throw new UsageError("--tenant 要是租户编号（UUID）。");
  const channel = text("channel");
  if (channel !== undefined && !UUID.test(channel)) throw new UsageError("--channel 要是渠道编号（UUID）。");
  const apply = values.apply === true;
  if (values.revert === true) {
    const extra = given.filter((key) => !["revert", "tenant", "batch", "apply"].includes(key));
    if (extra.length > 0) throw new UsageError(`撤回不用 ${extra.map((key) => `--${key}`).join("、")}。`);
    if (tenant === undefined) throw new UsageError("撤回必须给 --tenant。");
    return { kind: "revert", tenantId: tenant.toLowerCase(), batch, apply };
  }
  const required = ["file", "expect-sha256", "mapping", "out"].filter((name) => text(name) === undefined);
  if (required.length > 0) throw new UsageError(`必须给 ${required.map((name) => `--${name}`).join("、")}。`);
  const sha = (text("expect-sha256") as string).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(sha)) throw new UsageError("--expect-sha256 要是 64 位十六进制。");
  const sources = [text("target") !== undefined, text("assume-pricing") !== undefined, tenant !== undefined || channel !== undefined].filter(Boolean).length;
  if (sources !== 1) throw new UsageError("--target、--assume-pricing、--tenant 和 --channel（连库）三种必须给且只能给一种。");
  if (apply && tenant === undefined) throw new UsageError("--apply 只能和 --tenant、--channel 一起用（离线计划不写任何东西）。");
  let source: Extract<ImportCommand, { kind: "plan" }>["source"];
  if (text("target") !== undefined) source = { kind: "target", path: text("target") as string };
  else if (text("assume-pricing") !== undefined) {
    const parts = (text("assume-pricing") as string).split(",").map((part) => part.trim());
    if (parts.length !== 4 || parts.some((part) => !/^\d{1,9}$/.test(part))) throw new UsageError("--assume-pricing 写成「加价基点,下限基点,最低毛利,取整单位」四个整数，如 1000,1000,0,100。");
    const [markupBp, markupFloorBp, minMarginMinor, sellRoundingUnit] = parts.map(Number) as [number, number, number, number];
    if (sellRoundingUnit < 1) throw new UsageError("--assume-pricing 的取整单位至少是 1。");
    source = { kind: "assume", rules: { brandRoundingUnit: 1, markupBp, markupFloorBp, minMarginMinor, sellRoundingUnit } };
  } else {
    if (tenant === undefined || channel === undefined) throw new UsageError("连库要同时给 --tenant 和 --channel。");
    source = { kind: "database", tenantId: tenant.toLowerCase(), channelId: channel.toLowerCase(), apply };
  }
  return { kind: "plan", file: text("file") as string, expectSha256: sha, mapping: text("mapping") as string, batch, out: text("out") as string, source };
}

async function readJson(path: string, what: string): Promise<unknown> {
  const info = await stat(path);
  if (!info.isFile() || info.size > MAX_JSON_BYTES) throw new UsageError(`${what} 不是文件或太大。`);
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new UsageError(`${what} 不是合法的 JSON。`);
  }
}

/** 读价格表、核对 sha256、按映射算出日本「机场↔地区」的导入计划。 */
export async function loadImportPlan(options: { file: string; expectSha256: string; mapping: string }): Promise<{ plan: PriceImportPlan; anomalies: PriceImportAnomalies; sha256: string }> {
  const info = await stat(options.file);
  if (!info.isFile()) throw new UsageError("--file 不是文件。");
  if (info.size > XLSX_LIMITS.maxFileBytes) throw new UsageError("价格表文件太大，没有读取。");
  const bytes = await readFile(options.file);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== options.expectSha256) throw new UsageError(`文件的 sha256 不符：期望 ${options.expectSha256}，实际 ${sha256}。没有解析。`);
  const mapping = parsePriceImportMapping(await readJson(options.mapping, "--mapping"));
  const { sheets, issues } = readPriceWorkbook(bytes);
  const book = parsePriceWorkbook(sheets, issues);
  const country = book.countries.find((entry) => entry.sheet === IMPORT_SHEET);
  if (!country) throw new UsageError(`价格表里没有「${IMPORT_SHEET}」这张表。`);
  const plan = planPriceSheetImport(country, book.notes, mapping);
  return { plan, anomalies: priceImportAnomalies(country, plan), sha256 };
}

export interface PlanReport {
  mode: "offline_target" | "offline_assumed" | "dry_run" | "applied" | "blocked";
  batch: string;
  sha256: string;
  validFrom: string;
  pricingNote: string;
  plan: PriceImportPlan;
  priced: PricedImportCell[];
  overlap: PriceImportOverlapCheck;
  issues: (PriceImportPrecheckIssue | PriceImportBlocker)[];
  datedRules: MarkupRule[];
  anomalies: PriceImportAnomalies;
  airportCities: { iata: string; cityCode: string }[];
  counts?: Record<string, unknown>;
}

const yen = (minor: number | null): string => (minor === null ? "—" : minor.toLocaleString("en-US"));
const cellText = (text: string): string => escapePriceSheetText(text);

export function deviationStats(priced: readonly PricedImportCell[]): { total: number; exact: number; below: number; impossible: number; maxShortfall: number } {
  return {
    total: priced.length,
    exact: priced.filter((cell) => cell.result.status === "exact").length,
    below: priced.filter((cell) => cell.result.status === "below").length,
    impossible: priced.filter((cell) => cell.result.status === "impossible").length,
    maxShortfall: Math.max(0, ...priced.map((cell) => -(cell.result.diffMinor ?? 0))),
  };
}

/** 计划和偏差清单（Markdown）。表里的文字转义后才输出。 */
export function renderPlanMarkdown(report: PlanReport): string {
  const stats = deviationStats(report.priced);
  const lines = [
    `# 价格表导入计划（日本 · 机场↔地区 · 批次 ${cellText(report.batch)}）`,
    "",
    "内容含业主的价格，只放在本机的 qa 目录，不进仓库。",
    "",
    `- 模式：${{ offline_target: "离线计划（按目标环境的导出）", offline_assumed: "离线估算（按假设的官网规则，没有核对主数据）", dry_run: "连库 dry-run（没有写）", applied: "已写入", blocked: "被拦下（没有写）" }[report.mode]}`,
    `- 价格表 sha256：${report.sha256}`,
    `- 价格生效日期：${report.validFrom}（不设结束日期）`,
    `- 官网规则：${cellText(report.pricingNote)}`,
    `- 机场↔地区的路线：${report.plan.routesInScope} 行，其中有导入的 ${report.plan.routesImported} 行；导入的价格 ${report.plan.cells.length} 格`,
    `- 重叠处会被报低、先不导的：${report.overlap.skipped.length} 格（明细见 overlap.md）`,
    "",
    "## 倒算结果",
    "",
    `| 共 | 完全一致 | 有偏差（显示价低于表上价） | 报不出（不导入） | 最大偏差 |`,
    `| --- | --- | --- | --- | --- |`,
    `| ${stats.total} | ${stats.exact} | ${stats.below} | ${stats.impossible} | ${yen(stats.maxShortfall)} 日元 |`,
    "",
  ];
  if (report.issues.length > 0) {
    lines.push("## 拦住写入的原因", "", "| 代码 | 对象 | 说明 |", "| --- | --- | --- |");
    for (const issue of report.issues) {
      const target = "iata" in issue ? issue.iata : "vehicleGroupCode" in issue ? issue.vehicleGroupCode : "region" in issue ? issue.region : "";
      lines.push(`| ${issue.code} | ${cellText(target)} | ${cellText(issue.detail)} |`);
    }
    lines.push("");
  }
  if (report.datedRules.length > 0) {
    lines.push("## 促销期的加价规则（这些日期里官网显示价会和表上价不同）", "", "| 规则编号 | 加价 | 开始 | 结束 |", "| --- | --- | --- | --- |");
    for (const rule of report.datedRules) lines.push(`| ${rule.id} | ${rule.markupBp / 100}% | ${rule.validFrom ?? "—"} | ${rule.validTo ?? "—"} |`);
    lines.push("");
  }
  lines.push("## 偏差清单（倒算后官网显示价和表上价对不上的）", "", "对不上的不硬凑：取显示价不超过表上价的那一档导入，客人不会多付；也列出高一档。", "");
  lines.push("| 机场 | 地区 | 车型列 | 方向 | 表上价 | 倒算结算价 | 正向显示价 | 差额 | 高一档显示价 | 原因 |", "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const cell of report.priced.filter((entry) => entry.result.status !== "exact")) {
    const r = cell.result;
    lines.push(`| ${cellText(cell.airport)} | ${cellText(cell.region)} | ${cellText(cell.column)} | ${PRICE_DIRECTION_NAMES[cell.direction]} | ${yen(cell.sheetPriceMinor)} | ${yen(r.baseMinor)} | ${yen(r.displayMinor)} | ${r.diffMinor === null ? "—" : yen(r.diffMinor)} | ${yen(r.next?.displayMinor ?? null)} | ${r.reason === null ? "" : INVERSE_REASON_NAMES[r.reason]} |`);
  }
  lines.push("", "## 不导入的", "", "| 出发地 | 目的地 | 行 | 车型列 | 原因 |", "| --- | --- | --- | --- | --- |");
  for (const skip of report.plan.skips) lines.push(`| ${cellText(skip.from)} | ${cellText(skip.to)} | ${skip.rows.join("、")} | ${skip.column === null ? "整行" : cellText(skip.column)} | ${PRICE_IMPORT_SKIP_NAMES[skip.reason]} |`);
  lines.push("", "## 机场归属（商品的城市 = 机场在平台主数据里的城市）", "");
  if (report.airportCities.length === 0) lines.push("没有核对主数据（离线估算），见 airports-JP.md 的建议。");
  else {
    lines.push("| 机场 | 城市编码 |", "| --- | --- |");
    for (const entry of report.airportCities) lines.push(`| ${entry.iata} | ${entry.cityCode} |`);
  }
  if (report.counts) lines.push("", "## 写入", "", "```json", JSON.stringify(report.counts, null, 2), "```");
  return `${lines.join("\n")}\n`;
}

export function renderAnomaliesMarkdown(report: PlanReport): string {
  const { anomalies } = report;
  const stats = deviationStats(report.priced);
  const lines = [
    "# 日本价格异常清单（机场↔地区，给业主核对）",
    "",
    "按决定 C：下面这些都**原样导入**（取整偏差除外：按低一档导入），只列出来请业主核对。内容含价格，不进仓库。",
    "",
    "| 类别 | 数量 | 怎么处理 |",
    "| --- | --- | --- |",
    `| 座位多的车反而便宜（同一行、同一级别） | ${anomalies.inversions.length} 处 | 原样导入 |`,
    `| 两个方向都列、价格不同 | ${anomalies.differentDirections.length} 格 | 拆成接机、送机两条价导入 |`,
    `| 两个方向都列、只有一个方向有价 | ${anomalies.oneSided.length} 格 | 只导有价的那个方向，另一方向报不出价 |`,
    `| 取整偏差（官网显示价对不上表上价） | ${stats.below} 格（${report.pricingNote}） | 按低一档导入，明细见 plan.md 的偏差清单 |`,
    `| 报不出价（表上价低于最低可报价） | ${stats.impossible} 格 | 不导入 |`,
    "",
    "## 座位多反而便宜",
    "",
    "| 机场 | 地区 | 行 | 方向 | 座位少的车 | 价格 | 座位多的车 | 价格 |",
    "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ...anomalies.inversions.map((entry) => `| ${cellText(entry.airport)} | ${cellText(entry.region)} | ${entry.row} | ${entry.direction === "pickup" ? "接机" : "送机"} | ${cellText(entry.fewer.name)} | ${yen(entry.fewer.price)} | ${cellText(entry.more.name)} | ${yen(entry.more.price)} |`),
    "",
    "## 两个方向价格不同",
    "",
    "| 机场 | 地区 | 车型列 | 接机（机场出发） | 送机（去机场） |",
    "| --- | --- | --- | --- | --- |",
    ...anomalies.differentDirections.map((entry) => `| ${cellText(entry.airport)} | ${cellText(entry.region)} | ${cellText(entry.column)} | ${yen(entry.pickup)} | ${yen(entry.dropoff)} |`),
    "",
    "## 只有一个方向有价",
    "",
    "| 机场 | 地区 | 车型列 | 有价的方向 | 价格 |",
    "| --- | --- | --- | --- | --- |",
    ...anomalies.oneSided.map((entry) => `| ${cellText(entry.airport)} | ${cellText(entry.region)} | ${cellText(entry.column)} | ${PRICE_DIRECTION_NAMES[entry.direction]} | ${yen(entry.price)} |`),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

function pricedWithOverlap(priced: PricedImportCell[]): { priced: PricedImportCell[]; overlap: PriceImportOverlapCheck } {
  return { priced, overlap: priceImportOverlapCheck(priced) };
}

/** 重叠比价清单（Markdown）：同一机场下互相重叠的地区，和重叠处会被报低、所以没有导入的格子。 */
export function renderOverlapMarkdown(report: PlanReport): string {
  const { overlap } = report;
  const airports = new Set(overlap.conflicts.map((conflict) => conflict.iata));
  const lines = [
    "# 重叠比价跳过清单（同一机场商品、同一车型、同一方向）",
    "",
    "报价时一个地址落在几个区域里取结算价最低的（ADR 0020），没有「更具体的优先」。业主预期更小、更具体的区域优先，所以大区域比和它重叠的小区域便宜时，",
    "重叠处会按大区域的低价报出：这一格（大区域的）先不导。通用（接送同价）的一格整格不导。内容含价格，不进仓库。",
    "",
    `- 互相重叠的地区对：${overlap.overlaps.length} 对；有冲突的：${overlap.conflicts.length} 处（${airports.size} 个机场）；跳过的格子：${overlap.skipped.length} 格`,
    "",
    "## 跳过的格子和被压低的地区",
    "",
    "| 机场 | 车型列 | 方向 | 大区域（不导） | 大区域表上价 | 被压低的地区 | 它的表上价 |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...overlap.conflicts.map((c) => `| ${cellText(c.airport)} | ${cellText(c.column)} | ${c.direction === "pickup" ? "接机" : "送机"} | ${cellText(c.larger.region)} | ${yen(c.larger.sheetPriceMinor)} | ${cellText(c.smaller.region)} | ${yen(c.smaller.sheetPriceMinor)} |`),
    "",
    "## 同一机场下互相重叠的地区（大的在前，面积是近似值）",
    "",
    "| 机场 | 大区域 | 面积（平方公里） | 小区域 | 面积（平方公里） |",
    "| --- | --- | --- | --- | --- |",
    ...overlap.overlaps.map((o) => `| ${o.iata} | ${cellText(o.larger)} | ${o.largerAreaKm2} | ${cellText(o.smaller)} | ${o.smallerAreaKm2} |`),
    "",
  ];
  return `${lines.join("\n")}\n`;
}

/** 离线：按导出或假设的规则倒算。 */
export function offlineReport(input: { plan: PriceImportPlan; anomalies: PriceImportAnomalies; sha256: string; batch: string }, source: { kind: "target"; target: PriceImportTarget } | { kind: "assume"; rules: Omit<SitePriceRules, "currency" | "channelCurrency"> }): PlanReport {
  if (source.kind === "assume") {
    const rules: SitePriceRules = { currency: CURRENCY, ...source.rules };
    return {
      mode: "offline_assumed",
      batch: input.batch,
      sha256: input.sha256,
      validFrom: IMPORT_VALID_FROM,
      pricingNote: `假设：加价 ${rules.markupBp / 100}%、下限 ${rules.markupFloorBp / 100}%、最低毛利 ${rules.minMarginMinor} 日元、${rules.sellRoundingUnit > 1 ? `对外价向上取整到 ${rules.sellRoundingUnit} 日元` : "对外价四舍五入到 1 日元"}、子品牌取整 1 日元`,
      plan: input.plan,
      ...pricedWithOverlap(pricePriceImportCells(input.plan.cells, () => rules)),
      issues: [],
      datedRules: [],
      anomalies: input.anomalies,
      airportCities: [],
    };
  }
  const { target } = source;
  const resolved = resolvePriceImportTarget(target, groupPriceImport(input.plan.cells, () => "").products, CURRENCY);
  const cells = input.plan.cells.filter((cell) => resolved.airports.has(cell.iata) && resolved.vehicleGroups.has(cell.vehicleGroupCode));
  const dated = new Map<string, MarkupRule>();
  const priced = pricePriceImportCells(cells, (cell) => {
    const found = sitePriceRulesFor(target, { cityId: (resolved.airports.get(cell.iata) as { cityId: string }).cityId, vehicleGroupId: resolved.vehicleGroups.get(cell.vehicleGroupCode) as string, validFrom: IMPORT_VALID_FROM }, { currency: CURRENCY, roundingUnit: 1 });
    for (const rule of found.datedRules) dated.set(rule.id, rule);
    return found.rules;
  });
  return {
    mode: "offline_target",
    batch: input.batch,
    sha256: input.sha256,
    validFrom: IMPORT_VALID_FROM,
    pricingNote: `目标环境导出：渠道「${target.channel.name}」默认加价 ${target.channel.defaultMarkupBp / 100}%、下限 ${target.channel.markupFloorBp / 100}%、最低毛利 ${target.channel.minMarginMinor}、对外价取整 ${target.channel.sellRounding.get(target.channel.settleCurrency) ?? 1}；加价规则 ${target.markupRules.length} 条（按五级匹配）`,
    plan: input.plan,
    ...pricedWithOverlap(priced),
    issues: resolved.issues,
    datedRules: [...dated.values()],
    anomalies: input.anomalies,
    airportCities: [...resolved.airports].map(([iata, airport]) => ({ iata, cityCode: airport.cityCode })),
  };
}

async function writeOutputs(outDir: string, report: PlanReport): Promise<void> {
  await mkdir(outDir, { recursive: true, mode: 0o700 });
  const files: [string, string][] = [
    ["plan.md", renderPlanMarkdown(report)],
    ["anomalies.md", renderAnomaliesMarkdown(report)],
    ["overlap.md", renderOverlapMarkdown(report)],
    ["plan.json", `${JSON.stringify(report, (_key, value: unknown) => (value instanceof Map ? Object.fromEntries(value) : value), 2)}\n`],
  ];
  for (const [name, content] of files) {
    const path = join(outDir, name);
    await writeFile(path, content, { mode: 0o600 });
    await chmod(path, 0o600);
  }
}

function summary(report: PlanReport, outDir: string): string {
  const stats = deviationStats(report.priced);
  return [
    `模式：${report.mode}`,
    `机场↔地区 ${report.plan.routesInScope} 行，导入 ${report.plan.routesImported} 行、${report.plan.cells.length} 格；不导入 ${report.plan.skips.length} 项`,
    `倒算：完全一致 ${stats.exact}，有偏差 ${stats.below}（最大 ${stats.maxShortfall} 日元），报不出 ${stats.impossible}`,
    `重叠：地区对 ${report.overlap.overlaps.length}，会被报低 ${report.overlap.conflicts.length} 处，跳过 ${report.overlap.skipped.length} 格`,
    `拦住写入的原因 ${report.issues.length} 条`,
    ...(report.counts ? [`写入：${JSON.stringify(report.counts)}`] : []),
    `输出：${join(outDir, "plan.md")}、${join(outDir, "anomalies.md")}、${join(outDir, "overlap.md")}、${join(outDir, "plan.json")}`,
  ].join("\n");
}

export async function runImportCommand(command: ImportCommand): Promise<string> {
  if (command.kind === "print-sql") return PRICE_IMPORT_TARGET_SQL;
  if (command.kind === "revert") {
    const pool = createPool(loadConfig().databaseUrl, { max: 2 });
    try {
      const outcome = await revertPriceImport({ pool, now: () => new Date() }, { tenantId: command.tenantId, batch: command.batch, apply: command.apply });
      const blockers = outcome.blockers.map((blocker) => `  ${blocker.reason} ${blocker.id}`);
      return [`撤回「${outcome.brandName}」：${outcome.mode}`, `商品 ${outcome.products}，区域 ${outcome.areas}`, ...blockers, outcome.mode === "dry_run" ? "没有删除任何东西；加 --apply 才删。" : ""].filter(Boolean).join("\n");
    } finally {
      await pool.end();
    }
  }
  if (insideGitRepository(command.out)) throw new UsageError("--out 在 git 仓库里面：输出含价格，不能放进仓库。");
  const loaded = await loadImportPlan(command);
  const outDir = resolve(command.out);
  let report: PlanReport;
  if (command.source.kind === "target") {
    report = offlineReport({ ...loaded, batch: command.batch }, { kind: "target", target: parsePriceImportTarget(await readJson(command.source.path, "--target")) });
  } else if (command.source.kind === "assume") {
    report = offlineReport({ ...loaded, batch: command.batch }, { kind: "assume", rules: command.source.rules });
  } else {
    const pool = createPool(loadConfig().databaseUrl, { max: 2 });
    try {
      const outcome = await runPriceImport({ pool, now: () => new Date() }, { tenantId: command.source.tenantId, channelId: command.source.channelId, countryCode: IMPORT_COUNTRY, batch: command.batch, currency: CURRENCY, validFrom: IMPORT_VALID_FROM, plan: loaded.plan, apply: command.source.apply });
      report = {
        mode: outcome.mode,
        batch: command.batch,
        sha256: loaded.sha256,
        validFrom: IMPORT_VALID_FROM,
        pricingNote: `目标库：渠道「${outcome.channel.name}」，租户「${outcome.tenant.name}」，子品牌「${outcome.brandName}」`,
        plan: loaded.plan,
        priced: outcome.priced,
        overlap: outcome.overlap,
        issues: outcome.blockers,
        datedRules: outcome.datedRules,
        anomalies: loaded.anomalies,
        airportCities: outcome.airportCities,
        counts: { planned: outcome.planned, written: outcome.written },
      };
    } finally {
      await pool.end();
    }
  }
  await writeOutputs(outDir, report);
  return summary(report, outDir);
}

const printable = (text: string): string => text.replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/g, " ");

function failureMessage(err: unknown): string {
  if (err instanceof UsageError) return `${err.message}\n${USAGE}`;
  if (err instanceof PriceImportError || err instanceof PriceSheetError || err instanceof XlsxError) return `没有导入：${err.message}（${err.code}）。数据库没有任何变化。`;
  if (err instanceof ZipError) return `没有导入：${err.message}。数据库没有任何变化。`;
  if (err instanceof PriceImportRunError) return `没有导入：${err.message}（${err.code}）。数据库没有任何变化。`;
  if (driverErrorCode(err) !== null) return `数据库操作失败（${driverErrorCode(err)}）。已经提交的步骤会留下，重跑同一批会从断点接着做；要整批撤回用 --revert。`;
  const code = (err as { code?: unknown } | null)?.code;
  if (typeof code === "string" && /^[A-Z_]+$/.test(code)) return `没有完成（${code}）：${err instanceof Error ? err.message : ""}。已经提交的步骤会留下，重跑同一批会从断点接着做；要整批撤回用 --revert。`;
  return "没有完成：未知错误。";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    console.log(await runImportCommand(readImportCommand(process.argv.slice(2))));
  } catch (err) {
    console.error(printable(failureMessage(err)));
    process.exit(1);
  }
}
