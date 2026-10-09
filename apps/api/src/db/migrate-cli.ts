/**
 * `pnpm db:migrate`：执行所有还没执行的数据库迁移。可以反复运行。
 * 本地、CI、部署到 VPS 时都用这一条命令；只打印迁移文件名，不打印连接串。
 *
 * 用迁移账号（DATABASE_MIGRATION_URL，表的所有者）执行，不用服务进程的应用账号（ADR 0010）；
 * 也不需要登录签名密钥等服务进程才用的配置。
 */
import { ConfigError, loadMigrationConfig } from "@nozomi/config";
import { createPool, driverErrorCode } from "./pool.ts";
import { loadMigrationFiles, runMigrations } from "./migrate.ts";
import { MigrationError } from "./migration-plan.ts";

async function main(): Promise<void> {
  const config = loadMigrationConfig();
  const files = await loadMigrationFiles();
  const pool = createPool(config.databaseMigrationUrl, { max: 1, queryTimeoutMs: 0, statementTimeoutMs: 0 });
  try {
    const result = await runMigrations(pool, files, {
      onApplied: (file) => console.log(`已执行 ${file.fileName}`),
    });
    console.log(
      result.applied.length === 0
        ? `数据库结构已是最新（共 ${result.skipped} 个迁移，本次无需执行）`
        : `完成：本次执行 ${result.applied.length} 个迁移，此前已执行 ${result.skipped} 个`,
    );
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch (err) {
  if (err instanceof ConfigError) {
    console.error(err.message);
    console.error("\n怎么配置：见 docs/secrets.md");
  } else if (err instanceof MigrationError) {
    console.error(`[${err.code}] ${err.message}`);
  } else {
    console.error(
      `迁移失败：连不上数据库或发生未知错误（${driverErrorCode(err) ?? "UNKNOWN"}）。本地请先运行 docker compose up -d。`,
    );
  }
  process.exit(1);
}
