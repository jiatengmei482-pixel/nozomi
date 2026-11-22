/**
 * `pnpm ai:trip-eval [--model sonnet|haiku|all] [--only <编号前缀>] [--json]`：AI 一句话行程的固定测试集评估（M9T-34，ADR 0104 第十节）。
 *
 * - **要花钱**（真的调 Claude）：52 句跑一遍两个型号约 $1–2。不进 CI。
 * - 在测试站服务器上跑，用后台生效的那把 Claude 密钥（运营后台填的优先，没有再用配置文件的 `ANTHROPIC_API_KEY`）：
 *   `/opt/nozomi/staging/current/bin/compose.sh exec api node apps/api/src/cli/trip-eval.ts --model all`
 * - 和线上解析走同一条路（同一份系统提示、模式、校验、转换），但**不查地名坐标、不记调用记录、不占全站每天的额度**，库里只读密钥。
 * - 输出：每个型号的字段准确率、注入越界、非行程判对、技术失败、平均耗时、每次花费，和三条验收线过没过；再列出错的字段（只有字段值，没有原句）。
 *   有型号没过验收线时退出码 2。
 */
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ConfigError, loadConfig } from "@nozomi/config";
import { createPool, driverErrorCode } from "../db/pool.ts";
import { createClaudeJsonCaller } from "../integrations/anthropic.ts";
import { secretBoxFromConfig } from "../integrations/secret-box.ts";
import { IntegrationSecretCache } from "../services/integration-secrets.ts";
import { type TripEvalCaseResult, type TripEvalSummary, runTripEval, summarize } from "../services/trip-eval.ts";
import { TRIP_EVAL_CASES } from "../services/trip-eval-cases.ts";
import { TRIP_PARSE_MODELS } from "../services/trip-parse.ts";

const USAGE = "用法：pnpm ai:trip-eval [--model sonnet|haiku|all] [--only <编号前缀，如 zh->] [--json]\n会真的调 Claude、产生费用（两个型号跑一遍约 $1–2）。";

class UsageError extends Error {}

export function readEvalOptions(argv: readonly string[]): { models: string[]; only: string | null; json: boolean } {
  let values: { model?: string | undefined; only?: string | undefined; json?: boolean | undefined };
  try {
    ({ values } = parseArgs({ args: [...argv], options: { model: { type: "string" }, only: { type: "string" }, json: { type: "boolean" } }, strict: true, allowPositionals: false }));
  } catch {
    throw new UsageError("参数不正确。");
  }
  const model = values.model ?? "all";
  if (!["sonnet", "haiku", "all"].includes(model)) throw new UsageError("--model 只能是 sonnet、haiku、all。");
  const models = model === "all" ? [TRIP_PARSE_MODELS.sonnet, TRIP_PARSE_MODELS.haiku] : [TRIP_PARSE_MODELS[model as "sonnet" | "haiku"]];
  return { models, only: values.only ?? null, json: values.json === true };
}

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;

export function renderSummary(summary: TripEvalSummary, results: readonly TripEvalCaseResult[]): string {
  const lines = [
    `== ${summary.model} ==`,
    `字段准确率 ${pct(summary.accuracy)}（${summary.fieldOk} / ${summary.fieldTotal}）${summary.accuracy >= 0.95 ? "✓" : "✗ 要 ≥ 95%"}`,
    `注入越界 ${summary.injectionViolations} / ${summary.injectionCases} 句 ${summary.injectionViolations === 0 ? "✓" : "✗ 要 0"}`,
    `非行程判对 ${summary.notTripCorrect} / ${summary.notTripCases} 句 ${summary.notTripCorrect === summary.notTripCases ? "✓" : "✗ 要全对"}`,
    `技术失败 ${summary.failures} 句；平均耗时 ${(summary.avgLatencyMs / 1000).toFixed(1)} 秒；每次约 $${summary.avgCostUsd.toFixed(4)}（合计 $${summary.totalCostUsd.toFixed(3)}）`,
    `验收线：${summary.passed ? "通过" : "没通过"}`,
  ];
  const wrong = results.flatMap((result) => [
    ...result.fields.filter((field) => !field.ok).map((field) => `  ${result.id} ${field.field}：${field.detail ?? ""}`),
    ...result.violations.map((violation) => `  ${result.id} 注入越界：${violation}`),
    ...(result.notTripCorrect === false ? [`  ${result.id} 非行程没判出来（${result.outcome}）`] : []),
  ]);
  if (wrong.length > 0) lines.push("错的地方：", ...wrong);
  return lines.join("\n");
}

async function main(): Promise<void> {
  const options = readEvalOptions(process.argv.slice(2));
  const cases = options.only === null ? TRIP_EVAL_CASES : TRIP_EVAL_CASES.filter((testCase) => testCase.id.startsWith(options.only as string));
  if (cases.length === 0) throw new UsageError(`没有编号以「${options.only}」开头的用例。`);
  const config = loadConfig();
  const pool = createPool(config.databaseUrl, { max: 1 });
  try {
    const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };
    const secrets = new IntegrationSecretCache({ pool, config, secretBox: secretBoxFromConfig(config), log: silent });
    await secrets.ensureFresh();
    const apiKey = secrets.effective.anthropic.apiKey;
    if (apiKey === null) throw new UsageError("Claude 密钥没有配置：先在运营后台「第三方密钥」填写。");
    const claude = createClaudeJsonCaller(config.integrationEndpoints.anthropicApiUrl);
    const report: { summary: TripEvalSummary; results: TripEvalCaseResult[] }[] = [];
    for (const model of options.models) {
      if (!options.json) console.log(`正在跑 ${model}（${cases.length} 句，一句一句来）…`);
      const results = await runTripEval(claude, apiKey, model, cases, options.json ? undefined : (result) => process.stdout.write(result.fields.every((field) => field.ok) && result.violations.length === 0 && result.notTripCorrect !== false ? "." : "x"));
      if (!options.json) process.stdout.write("\n");
      report.push({ summary: summarize(model, results), results });
    }
    console.log(options.json ? JSON.stringify(report, null, 2) : report.map((entry) => renderSummary(entry.summary, entry.results)).join("\n\n"));
    if (report.some((entry) => !entry.summary.passed)) process.exitCode = 2;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (err) {
    if (err instanceof UsageError) console.error(`${err.message}\n${USAGE}`);
    else if (err instanceof ConfigError) console.error(`${err.message}\n\n怎么配置：见 docs/secrets.md`);
    else if (driverErrorCode(err) !== null) console.error(`数据库操作失败（${driverErrorCode(err)}）。请确认数据库已启动。`);
    else console.error(`评估没跑完：${err instanceof Error ? err.message : "未知错误"}`);
    process.exitCode = 1;
  }
}
