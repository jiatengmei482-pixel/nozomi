// 新增的迁移编号必须大于 main 上已有的最大编号：测试环境、正式环境按编号顺序执行，已经执行到 N 之后不接受小于 N 的新迁移
// （执行器报 MIGRATION_OUT_OF_ORDER，部署失败回退）。并行开发的分支各自编号，合并时容易插到别人前面，这里在 PR 上提前拦下。
// 用法：node scripts/check-migration-order.mjs <基准提交，默认 origin/main>。只用 Node 内置模块。
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const MIGRATION = /^(\d{4})_[a-z0-9_]+\.sql$/;

/** 本分支新增、但编号不大于基准上最大编号的迁移文件名。 */
export function outOfOrderMigrations(baseNames, headNames) {
  const numberOf = (name) => Number(MIGRATION.exec(name)?.[1] ?? Number.NaN);
  const base = new Set(baseNames.filter((name) => MIGRATION.test(name)));
  const max = Math.max(0, ...[...base].map(numberOf));
  return headNames.filter((name) => MIGRATION.test(name) && !base.has(name) && numberOf(name) <= max).sort();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const baseRef = process.argv[2] ?? "origin/main";
  const dir = new URL("../apps/api/migrations/", import.meta.url);
  const baseNames = execFileSync("git", ["ls-tree", "--name-only", `${baseRef}:apps/api/migrations/`], { encoding: "utf8" }).split("\n");
  const wrong = outOfOrderMigrations(baseNames, readdirSync(dir));
  if (wrong.length > 0) {
    console.error(`这些新迁移的编号不大于 ${baseRef} 上已有的最大编号，部署时会被拒绝（MIGRATION_OUT_OF_ORDER），请改成更大的编号：\n  ${wrong.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`迁移编号检查通过（基准 ${baseRef}）`);
}
