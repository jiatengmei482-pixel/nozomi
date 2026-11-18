/**
 * 区域重叠清理（ADR 0102 第五节第 3 步）：
 *
 *   node apps/api/src/db/area-cleanup-cli.ts --dry-run | --apply
 *   AREA_OVERLAP_CLEANUP=dry-run|apply node apps/api/src/db/area-cleanup-cli.ts   （部署时这样调用）
 *
 * 和三层迁移同一条路：部署时由 `deploy/bin/deploy.sh` 在数据库迁移之后，用临时 migrate 容器、迁移账号（表的所有者）运行；
 * 只在测试环境设变量（docs/deploy.md「测试环境执行区域重叠清理」）。`--dry-run` 算完回滚；`--apply` 一个事务写完（失败整体回滚，部署中止）。
 * 标准输出只打计数和批次号：仓库公开，部署日志谁都能看。清理前的完整明细在 `area_cleanup_backups`，每次的计数和改动编号在 `area_cleanup_runs`
 * （试跑回滚，表里也不留）。
 */
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError, loadMigrationConfig } from "@nozomi/config";
import { type AreaCleanupMode, cleanupCountsLine, runAreaCleanup } from "../services/area-cleanup.ts";
import { createPool, driverErrorCode } from "./pool.ts";

export function parseCleanupArgs(argv: readonly string[], env: Readonly<Record<string, string | undefined>> = {}): AreaCleanupMode {
  const fromEnv = env["AREA_OVERLAP_CLEANUP"];
  const flags = argv.filter((arg) => arg === "--dry-run" || arg === "--apply");
  const unknown = argv.filter((arg) => arg !== "--dry-run" && arg !== "--apply");
  if (unknown.length > 0) throw new Error(`不认识的参数：${unknown.join(" ")}`);
  const modes = flags.length === 0 && (fromEnv === "dry-run" || fromEnv === "apply") ? [`--${fromEnv}`] : flags;
  if (modes.length !== 1) throw new Error("要给 --dry-run 或 --apply 其中一个（或设 AREA_OVERLAP_CLEANUP=dry-run / apply）");
  return modes[0] === "--apply" ? "apply" : "dry-run";
}

async function main(): Promise<void> {
  const mode = parseCleanupArgs(process.argv.slice(2), process.env);
  const config = loadMigrationConfig();
  const pool = createPool(config.databaseMigrationUrl, { max: 1, queryTimeoutMs: 0, statementTimeoutMs: 0 });
  try {
    console.log(cleanupCountsLine(await runAreaCleanup(pool, { mode, now: new Date() })));
  } finally {
    await pool.end();
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    await main();
  } catch (err) {
    if (err instanceof ConfigError) console.error(err.message);
    else if (err instanceof Error && !("code" in err)) console.error(`区域重叠清理没有执行：${err.message}`);
    // 数据库的错误只打错误码：错误信息里可能带着数据
    else console.error(`区域重叠清理失败，已整体回滚（${driverErrorCode(err) ?? "UNKNOWN"}）`);
    process.exit(1);
  }
}
