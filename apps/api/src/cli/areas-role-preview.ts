/**
 * `pnpm areas:role-preview [--days <1–90>] [--json]`：区域用途切换前的只读清单（M8-20，ADR 0075 第三部分第 3 节）。
 * 测试环境、正式环境在部署迁移 0290 之前各跑一次：每个供应商的区域数、已上架商品勾选的报价区域、回放最近 N 天（默认 30）的询价。
 * 回放里「对外结果不同」必须是 0 处才能上线；清单写进验收记录。
 * M8-30（ADR 0080）：同一次回放另比一遍报价优先级——之前报得出的价有变化的必须是 0 处；之前报不出、现在新报出的单独列出。
 *
 * 只读：用服务进程的应用账号、在平台角色的只读事务里（`begin … read only`）读，数据库拒绝任何写入；没有任何写入的开关。
 * 输出没有客人信息（询价日志里只取用车请求，不打印坐标）；不打印异常原文（驱动的报错里可能带连接信息，规则 5）。
 */
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { ConfigError, loadConfig } from "@nozomi/config";
import { withPlatformTx } from "../db/context.ts";
import { createPool, driverErrorCode } from "../db/pool.ts";
import { ROLE_PREVIEW_DEFAULT_DAYS, ROLE_PREVIEW_MAX_DAYS, buildRolePreview, renderRolePreview } from "../services/area-role-preview.ts";

const USAGE = `用法：pnpm areas:role-preview [--days <1–${ROLE_PREVIEW_MAX_DAYS}>] [--json]\n只读：不写任何数据。默认回放最近 ${ROLE_PREVIEW_DEFAULT_DAYS} 天的询价。`;

class UsageError extends Error {}

export function readPreviewOptions(argv: readonly string[]): { days: number; json: boolean } {
  let values: { days?: string | undefined; json?: boolean | undefined };
  try {
    ({ values } = parseArgs({ args: [...argv], options: { days: { type: "string" }, json: { type: "boolean" } }, strict: true, allowPositionals: false }));
  } catch {
    throw new UsageError("参数不正确（这个命令只读，没有写入的开关）。");
  }
  const days = values.days === undefined ? ROLE_PREVIEW_DEFAULT_DAYS : Number(values.days);
  if (!Number.isInteger(days) || days < 1 || days > ROLE_PREVIEW_MAX_DAYS) throw new UsageError(`--days 要是 1 到 ${ROLE_PREVIEW_MAX_DAYS} 之间的整数。`);
  return { days, json: values.json === true };
}

async function main(): Promise<void> {
  const options = readPreviewOptions(process.argv.slice(2));
  const config = loadConfig();
  const pool = createPool(config.databaseUrl, { max: 1 });
  try {
    // snapshot：平台角色的「可重复读、只读」事务——任何写入都会被数据库拒绝
    const preview = await withPlatformTx(pool, (db) => buildRolePreview(db, { days: options.days, now: new Date() }), { snapshot: true });
    console.log(options.json ? JSON.stringify(preview, null, 2) : renderRolePreview(preview));
    if (preview.replay.externalDiffCount > 0 || preview.replay.priority.changedCount > 0) process.exitCode = 2;
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
    else if (driverErrorCode(err) !== null) console.error(`没有改动：数据库操作失败（${driverErrorCode(err)}）。请确认数据库已启动。`);
    else console.error(`没有改动：${err instanceof Error ? err.message : "未知错误"}`);
    process.exitCode = 1;
  }
}
