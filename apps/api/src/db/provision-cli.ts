/**
 * `pnpm db:provision`：用迁移账号创建 / 修正服务进程用的应用账号（ADR 0010）。可以反复运行。
 *
 * - 迁移账号来自 DATABASE_MIGRATION_URL；应用账号的名字和密码来自 DATABASE_URL。
 *   两者都只从环境变量读，不接受命令行参数；这里只打印账号名，不打印连接串和密码。
 * - 本地：`docker compose up -d` 之后运行一次。CI 和部署脚本每次都会运行。
 * - 换应用账号的密码：改 DATABASE_URL 里的密码后再运行一次，然后重启服务。
 */
import { ConfigError, loadMigrationConfig } from "@nozomi/config";
import { createPool, driverErrorCode } from "./pool.ts";
import { ProvisionError, appAccountFromUrl, provisionAppAccount } from "./provision.ts";
import { DB_ROLES } from "./roles.ts";

async function main(): Promise<void> {
  const config = loadMigrationConfig();
  if (config.databaseUrl === null) throw new ConfigError(["DATABASE_URL: 缺少 DATABASE_URL（应用账号的连接串）"]);
  const account = appAccountFromUrl(config.databaseUrl);
  const pool = createPool(config.databaseMigrationUrl, { max: 1 });
  try {
    const result = await provisionAppAccount(pool, account);
    console.log(
      `${result.created ? "已创建" : "已更新"}应用账号 ${result.role}：不是超级用户、不拥有任何表，只能切换到 ${DB_ROLES.join("、")}`,
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
  } else if (err instanceof ProvisionError) {
    console.error(`[${err.code}] ${err.message}`);
  } else {
    // 不打印异常本身：驱动的报错里可能带连接信息（规则 5）
    console.error(
      `创建应用账号失败：连不上数据库或发生未知错误（${driverErrorCode(err) ?? "UNKNOWN"}）。本地请先运行 docker compose up -d。`,
    );
  }
  process.exit(1);
}
