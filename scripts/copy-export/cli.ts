/**
 * `pnpm copy:export`：从代码导出固定文案清单（M11-02）到 docs/copy/（CSV + Markdown）。
 *
 *   pnpm copy:export                 重新生成 docs/copy/
 *   pnpm copy:export --check         只检查 docs/copy/ 是不是最新的，不是就以 1 退出（不写文件）
 *   pnpm copy:export --out <目录>    写到别的目录（相对仓库根目录）
 *   pnpm copy:export --check-hardcoded <git 版本>
 *                                    和那个版本的 docs/copy/copy.csv 比，写死的条数多了就以 1 退出（M11-07，CI 在 PR 上用 origin/main）
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectEntries, readSources } from "./collect.ts";
import { compareHardcoded, hardcodedFromCsv, type HardcodedItem } from "./hardcoded-check.ts";
import { countEntries, isGeneratedFileName, renderAll } from "./render.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function parseArgs(argv: readonly string[]): { check: boolean; out: string; hardcodedBase: string | null } {
  let check = false;
  let out = "docs/copy";
  let hardcodedBase: string | null = null;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--check") check = true;
    else if (arg === "--out" && argv[i + 1] !== undefined) {
      out = argv[i + 1] as string;
      i += 1;
    } else if (arg === "--check-hardcoded" && argv[i + 1] !== undefined) {
      hardcodedBase = argv[i + 1] as string;
      i += 1;
    } else {
      process.stderr.write(`不认识的参数：${arg}\n用法：pnpm copy:export [--check] [--out <目录>] [--check-hardcoded <git 版本>]\n`);
      process.exit(2);
    }
  }
  return { check, out, hardcodedBase };
}

/** 输出目录里由本命令生成的文件（README.md、copy.csv、<区域>.md、<区域>-2.md…）；别的文件不动 */
function generatedFilesIn(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(isGeneratedFileName).sort();
}

const { check, out, hardcodedBase } = parseArgs(process.argv.slice(2));
const outDir = path.resolve(repoRoot, out);
const entries = collectEntries(readSources(repoRoot));
const files = renderAll(entries);

const describe = (item: HardcodedItem): string => `  ${item.file}：${item.text.replace(/\n/g, "⏎")}`;

if (hardcodedBase !== null) {
  const baseCsv = execFileSync("git", ["show", `${hardcodedBase}:docs/copy/copy.csv`], { cwd: repoRoot, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const result = compareHardcoded(hardcodedFromCsv(baseCsv), hardcodedFromCsv(files.get("copy.csv") ?? ""));
  if (result.added.length > 0) process.stdout.write(`新增写死文案 ${result.added.length} 条（请放进文案表走 key，见 docs/workflow.md「固定文案走 key」）：\n${result.added.map(describe).join("\n")}\n`);
  if (!result.pass) {
    process.stderr.write(`写死的固定文案比 ${hardcodedBase} 多：${result.baseCount} → ${result.headCount} 条。只能持平或减少。\n`);
    process.exit(1);
  }
  process.stdout.write(`写死的固定文案没有增加：${result.baseCount} → ${result.headCount} 条（新增 ${result.added.length}、减少 ${result.removed.length}）。\n`);
} else if (check) {
  const stale: string[] = [];
  for (const [name, content] of files) {
    const target = path.join(outDir, name);
    if (!existsSync(target) || readFileSync(target, "utf8") !== content) stale.push(name);
  }
  for (const name of generatedFilesIn(outDir)) if (!files.has(name)) stale.push(name);
  if (stale.length > 0) {
    process.stderr.write(`固定文案清单不是最新的（${stale.join("、")}），请运行 pnpm copy:export 后提交。\n`);
    process.exit(1);
  }
  process.stdout.write("固定文案清单是最新的。\n");
} else {
  mkdirSync(outDir, { recursive: true });
  for (const name of generatedFilesIn(outDir)) if (!files.has(name)) rmSync(path.join(outDir, name));
  for (const [name, content] of files) writeFileSync(path.join(outDir, name), content);
  const counts = countEntries(entries);
  process.stdout.write(`已导出到 ${path.relative(repoRoot, outDir) || "."}/：共 ${counts.total} 条，写死 ${counts.hardcoded} 条，已走 key ${counts.keyed} 条。\n`);
}
