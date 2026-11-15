/**
 * `pnpm replay:classify <部署前.json> <部署后.json> [--allow surcharge,package,…]`（M9P-14，ADR 0093 第六节第 5 小节）
 * 两份文件是有权限的人部署前后各调一次 `GET /platform/v1/reports/area-role-preview?rows=true&until=…&days=…` 存下来的应答（同一个 until、天数）。
 * 按「询价编号 × 商品编码」对齐，把摘要不同的行归类，输出 JSON（每行的类别、前后各车型组的档、基础价、调价、结算价和报不出的原因）到标准输出。
 *
 * - `--allow`：这个 PR 声明的有意改动类别（逗号分隔，取值见 `REPLAY_CATEGORIES`）；出现声明以外的类别判失败。不给时允许 ADR 0093 表里的五类。
 * - 退出码：0 通过；1 有未归类 / 声明以外的类别 / 只有一边有的行 / 两次的窗口（until、天数）不同；2 用法不对；
 *   3 两次的 `stateDigest` 不一样（中间改了数据，比对无效，要重跑）——这种情况照样输出归类，供参考。
 * - `--expect-state-change`：迁移这类本来就会改数据状态的比对，数据状态不同不再退出 3，按归类本身判 0 / 1。输出里另有 `classificationPassed`（只看归类）。
 * - 不连数据库、不联网、不读配置和密钥，只读这两个文件。输出有价格：不要贴进公开的地方（仓库、Actions 产物）。
 */
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import type { ReplayRow } from "../services/replay-digest.ts";
import { REPLAY_CATEGORIES, REPLAY_CATEGORY_TEXT, type ReplayCategory, classifyReplay, replayVerdict } from "../services/replay-classify.ts";

interface Saved {
  stateDigest?: string;
  until?: string;
  days?: number;
  resultRows?: ReplayRow[];
}

export const EXIT = { passed: 0, failed: 1, usage: 2, stateChanged: 3 } as const;

/** 接受整份应答（`{ replay: … }`）或只有 `replay` 那一段 */
function replayOf(value: unknown, file: string): Saved {
  const replay = (value as { replay?: Saved } | null)?.replay ?? (value as Saved | null);
  if (replay === null || typeof replay !== "object" || !Array.isArray(replay.resultRows)) throw new Error(`${file} 里没有逐行明细 resultRows：调接口时要带 rows=true`);
  return replay;
}

/** `--allow` 的值 → 类别；认不出的报错 */
export function parseAllow(text: string | undefined): ReplayCategory[] | null {
  if (text === undefined) return null;
  const items = text.split(",").map((item) => item.trim()).filter((item) => item !== "");
  const unknown = items.filter((item) => !(REPLAY_CATEGORIES as readonly string[]).includes(item));
  if (unknown.length > 0) throw new Error(`--allow 里有认不出的类别：${unknown.join("、")}（可选：${REPLAY_CATEGORIES.join("、")}）`);
  return items as ReplayCategory[];
}

export async function classifyFiles(beforeFile: string, afterFile: string, declared: readonly ReplayCategory[] | null = null, options: { expectStateChange?: boolean } = {}): Promise<{ output: unknown; exitCode: number }> {
  const before = replayOf(JSON.parse(await readFile(beforeFile, "utf8")), beforeFile);
  const after = replayOf(JSON.parse(await readFile(afterFile, "utf8")), afterFile);
  const result = classifyReplay(before.resultRows ?? [], after.resultRows ?? []);
  const verdict = replayVerdict(result, declared);
  const sameWindow = before.until === after.until && before.days === after.days;
  const sameState = before.stateDigest === after.stateDigest;
  const expectStateChange = options.expectStateChange === true;
  const classificationPassed = verdict.passed && sameWindow;
  const output = {
    passed: classificationPassed && (sameState || expectStateChange),
    classificationPassed,
    expectStateChange,
    sameWindow,
    sameState,
    ...(sameState || expectStateChange ? {} : { warning: "两次的 stateDigest 不一样：中间有人改了数据，比对无效，要重跑（ADR 0086）；迁移这类有意改数据的比对加 --expect-state-change" }),
    declared: declared ?? null,
    undeclared: verdict.undeclared,
    unchanged: result.unchanged,
    onlyBefore: result.onlyBefore,
    onlyAfter: result.onlyAfter,
    changed: result.diffs.length,
    counts: Object.fromEntries(Object.entries(result.counts).map(([category, count]) => [`${category}：${REPLAY_CATEGORY_TEXT[category as ReplayCategory]}`, count])),
    diffs: result.diffs,
  };
  const exitCode = !sameState && !expectStateChange ? EXIT.stateChanged : classificationPassed ? EXIT.passed : EXIT.failed;
  return { output, exitCode };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const usage = "用法：pnpm replay:classify <部署前.json> <部署后.json> [--allow 类别,类别] [--expect-state-change]（两份都是 area-role-preview?rows=true 的应答）\n";
  let parsed: ReturnType<typeof parseArgs>;
  let declared: ReplayCategory[] | null;
  try {
    parsed = parseArgs({ allowPositionals: true, options: { allow: { type: "string" }, "expect-state-change": { type: "boolean" } } });
    declared = parseAllow(parsed.values["allow"] as string | undefined);
  } catch (err) {
    process.stderr.write(`${(err as Error).message}\n${usage}`);
    process.exit(EXIT.usage);
  }
  const [beforeFile, afterFile] = parsed.positionals;
  if (beforeFile === undefined || afterFile === undefined) {
    process.stderr.write(usage);
    process.exit(EXIT.usage);
  }
  const { output, exitCode } = await classifyFiles(beforeFile, afterFile, declared, { expectStateChange: parsed.values["expect-state-change"] === true });
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exit(exitCode);
}
