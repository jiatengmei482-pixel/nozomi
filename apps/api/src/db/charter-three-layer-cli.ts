/**
 * 包车三层区域的数据迁移（M9P-05，ADR 0093 第六节第 1 小节）：
 *
 *   node apps/api/src/db/charter-three-layer-cli.ts --dry-run [--product <商品编号>]
 *   node apps/api/src/db/charter-three-layer-cli.ts --apply   [--product <商品编号>]
 *   CHARTER_THREE_LAYER_MIGRATION=dry-run|apply node apps/api/src/db/charter-three-layer-cli.ts   （部署时这样调用）
 *
 * 和 `pnpm db:migrate` 同一条路：部署时由 `deploy/bin/deploy.sh` 在执行完数据库迁移之后，用同一个临时 migrate 容器、
 * 迁移账号（DATABASE_MIGRATION_URL，表的所有者）运行；由 GitHub Environment 变量 CHARTER_THREE_LAYER_MIGRATION 决定跑不跑、跑哪种
 * （只在测试环境设，见 docs/deploy.md「测试环境执行三层区域迁移」）。
 *
 * - `--dry-run`：在事务里算完就回滚，不写库，只出报告；`--apply`：一个事务写完（失败整体回滚，退出码 1，部署中止）。
 * - 完整报告（有供应商的结算价和区域名）只写到报告目录（CHARTER_THREE_LAYER_REPORT_DIR，默认当前目录下的 reports/），权限 600；
 *   标准输出只打计数和报告文件名：仓库公开，部署日志谁都能看。
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigError, loadMigrationConfig } from "@nozomi/config";
import { type CharterMigrationMode, countReport, countsLine, runCharterThreeLayerMigration } from "../services/charter-three-layer.ts";
import { createPool, driverErrorCode } from "./pool.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 参数：`--dry-run` 或 `--apply`（二选一），可选 `--product <商品编号>`。没给 `--dry-run` / `--apply` 时按环境变量
 * CHARTER_THREE_LAYER_MIGRATION（部署时 deploy.sh 用 `-e` 传进 migrate 容器的那一个）。
 */
export function parseArgs(argv: readonly string[], env: Readonly<Record<string, string | undefined>> = {}): { mode: CharterMigrationMode; productId: string | null } {
  const fromEnv = env["CHARTER_THREE_LAYER_MIGRATION"];
  const flags = argv.filter((arg) => arg === "--dry-run" || arg === "--apply");
  const modes = flags.length === 0 && (fromEnv === "dry-run" || fromEnv === "apply") ? [`--${fromEnv}`] : flags;
  if (modes.length !== 1) throw new Error("要给 --dry-run 或 --apply 其中一个（或设 CHARTER_THREE_LAYER_MIGRATION=dry-run / apply）");
  const at = argv.indexOf("--product");
  const productId = at < 0 ? null : (argv[at + 1] ?? "");
  if (productId !== null && !UUID.test(productId)) throw new Error("--product 后面要跟商品编号（UUID）");
  const known = new Set(["--dry-run", "--apply", "--product", ...(productId === null ? [] : [productId])]);
  const unknown = argv.filter((arg) => !known.has(arg));
  if (unknown.length > 0) throw new Error(`不认识的参数：${unknown.join(" ")}`);
  return { mode: modes[0] === "--apply" ? "apply" : "dry-run", productId };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2), process.env);
  const config = loadMigrationConfig();
  const pool = createPool(config.databaseMigrationUrl, { max: 1, queryTimeoutMs: 0, statementTimeoutMs: 0 });
  try {
    const now = new Date();
    const report = await runCharterThreeLayerMigration(pool, { mode: args.mode, productId: args.productId, now });
    const dir = process.env["CHARTER_THREE_LAYER_REPORT_DIR"] || "reports";
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const file = join(dir, `charter-three-layer-${args.mode}-${now.toISOString().replace(/[:.]/g, "-")}.json`);
    await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
    console.log(countsLine(args.mode, countReport(report)));
    console.log(`完整报告：${file}（只在这台服务器上，不进日志）`);
  } finally {
    await pool.end();
  }
}

// 只在直接运行时执行（测试里 import 它取 parseArgs 时不执行）
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    await main();
  } catch (err) {
    if (err instanceof ConfigError) console.error(err.message);
    else if (err instanceof Error && !("code" in err)) console.error(`三层区域迁移没有执行：${err.message}`);
    // 数据库的错误只打错误码：错误信息里可能带着数据
    else console.error(`三层区域迁移失败，已整体回滚（${driverErrorCode(err) ?? "UNKNOWN"}）`);
    process.exit(1);
  }
}
