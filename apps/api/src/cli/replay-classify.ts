/**
 * `pnpm replay:classify <部署前.json> <部署后.json>`（M9P-14，ADR 0093 第六节第 5 小节）
 * 两份文件是有权限的人部署前后各调一次 `GET /platform/v1/reports/area-role-preview?rows=true&until=…&days=…` 存下来的应答（同一个 until、天数）。
 * 按「询价编号 × 商品编码」对齐，把摘要不同的行归类，输出 JSON（每行的类别、前后各车型组的档和结算价）到标准输出。
 *
 * - 不连数据库、不联网、不读配置和密钥，只读这两个文件。
 * - 输出有价格：不要贴进公开的地方（仓库、Actions 产物）。
 * - 两次的 `stateDigest` 不一样时比对无效（中间改了数据），照样归类但在结果里标出来。
 * - 有「未归类」的行时退出码 1（判失败，要查）。
 */
import { readFile } from "node:fs/promises";
import type { ReplayRow } from "../services/replay-digest.ts";
import { REPLAY_CATEGORY_TEXT, classifyReplay } from "../services/replay-classify.ts";

interface Saved {
  stateDigest?: string;
  until?: string;
  days?: number;
  resultRows?: ReplayRow[];
}

/** 接受整份应答（`{ replay: … }`）或只有 `replay` 那一段 */
function replayOf(value: unknown, file: string): Saved {
  const replay = (value as { replay?: Saved } | null)?.replay ?? (value as Saved | null);
  if (replay === null || typeof replay !== "object" || !Array.isArray(replay.resultRows)) throw new Error(`${file} 里没有逐行明细 resultRows：调接口时要带 rows=true`);
  return replay;
}

export async function classifyFiles(beforeFile: string, afterFile: string): Promise<{ output: unknown; failed: boolean }> {
  const before = replayOf(JSON.parse(await readFile(beforeFile, "utf8")), beforeFile);
  const after = replayOf(JSON.parse(await readFile(afterFile, "utf8")), afterFile);
  const result = classifyReplay(before.resultRows ?? [], after.resultRows ?? []);
  const sameWindow = before.until === after.until && before.days === after.days;
  const sameState = before.stateDigest === after.stateDigest;
  const output = {
    sameWindow,
    sameState,
    ...(sameState ? {} : { warning: "两次的 stateDigest 不一样：中间有人改了数据，比对无效，要重跑（ADR 0086）" }),
    unchanged: result.unchanged,
    onlyBefore: result.onlyBefore,
    onlyAfter: result.onlyAfter,
    changed: result.diffs.length,
    counts: Object.fromEntries(Object.entries(result.counts).map(([category, count]) => [REPLAY_CATEGORY_TEXT[category as keyof typeof REPLAY_CATEGORY_TEXT], count])),
    diffs: result.diffs,
  };
  return { output, failed: (result.counts.unclassified ?? 0) > 0 || !sameWindow };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [beforeFile, afterFile] = process.argv.slice(2);
  if (beforeFile === undefined || afterFile === undefined) {
    process.stderr.write("用法：pnpm replay:classify <部署前.json> <部署后.json>（两份都是 area-role-preview?rows=true 的应答）\n");
    process.exit(2);
  }
  const { output, failed } = await classifyFiles(beforeFile, afterFile);
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exit(failed ? 1 : 0);
}
