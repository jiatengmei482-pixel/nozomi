/**
 * 测试专用：在一个独立的进程里对指定目录执行迁移，用来验证「多个进程真的同时迁移」和「迁移进程中途被杀」。
 * 仓库里的 `pnpm db:migrate` 固定读 apps/api/migrations，测试需要指向临时目录，所以单独有这个入口。
 *
 * 用法：node run-migrations-child.ts <迁移目录>，连接串来自环境变量 DATABASE_URL。
 * 成功时在标准输出打印一行 JSON：{"applied":[文件名…],"skipped":数量}，退出码 0；
 * 失败时打印 {"error":错误码}，退出码 1。
 */
import { createPool, driverErrorCode } from "../db/pool.ts";
import { loadMigrationFiles, runMigrations } from "../db/migrate.ts";
import { MigrationError } from "../db/migration-plan.ts";

const dir = process.argv[2];
const databaseUrl = process.env["DATABASE_URL"];
if (!dir || !databaseUrl) {
  console.log(JSON.stringify({ error: "USAGE" }));
  process.exit(1);
}

const pool = createPool(databaseUrl, { max: 1 });
let exitCode = 0;
try {
  const result = await runMigrations(pool, await loadMigrationFiles(dir));
  console.log(JSON.stringify({ applied: result.applied.map((f) => f.fileName), skipped: result.skipped }));
} catch (err) {
  console.log(JSON.stringify({ error: err instanceof MigrationError ? err.code : (driverErrorCode(err) ?? "UNKNOWN") }));
  exitCode = 1;
} finally {
  await pool.end();
}
process.exit(exitCode);
