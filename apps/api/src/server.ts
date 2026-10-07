/**
 * API 进程入口（`pnpm dev` / 部署时的启动命令）。
 *
 * - 启动时校验配置，有问题立即退出并列出全部问题。
 * - 不在启动时自动执行迁移：迁移是单独的一步（`pnpm db:migrate`），/health 会报告是否执行完。
 * - 收到 SIGTERM / SIGINT 时优雅关闭：先停止接收新请求并等在途请求结束，再关闭连接池，然后退出。
 * - 出现没有任何代码接住的异常时不假装没事：按脱敏规则记一条日志，走同样的优雅关闭，以退出码 1 结束，
 *   由进程管理器（Docker 的重启策略）拉起新进程。已知会发生的故障（如事务中途连接被断开）在各自的位置处理，
 *   不依赖这里。
 */
import { ConfigError, loadConfig } from "@nozomi/config";
import { buildApp } from "./app.ts";
import { createPool } from "./db/pool.ts";
import { loadMigrationFiles } from "./db/migrate.ts";
import { MigrationError } from "./db/migration-plan.ts";
import { TimeoutError, withTimeout } from "./health.ts";
import { redactText } from "./logging.ts";

/** 优雅关闭的最长等待时间；超过后强制退出，避免部署时卡住。 */
const SHUTDOWN_TIMEOUT_MS = 10_000;
/** 关闭连接池的最长等待时间：数据库已经失联时，没必要为了和它道别而拖住退出。 */
const POOL_CLOSE_TIMEOUT_MS = 3_000;

async function main(): Promise<void> {
  const config = loadConfig();
  const migrationFiles = await loadMigrationFiles();
  const pool = createPool(config.databaseUrl, {
    onIdleError: ({ code }) => app.log.warn({ code }, "数据库空闲连接出错，下次查询时会重连"),
  });
  const app = buildApp({ config, pool, migrationFiles });

  const closePool = async (): Promise<void> => {
    try {
      await withTimeout(pool.end(), POOL_CLOSE_TIMEOUT_MS);
    } catch (err) {
      if (!(err instanceof TimeoutError)) throw err;
      app.log.warn("连接池没有在限时内关闭（数据库可能已失联），不再等待");
    }
  };

  let shuttingDown = false;
  const shutdown = async (signal: string, failureExitCode = 0): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "收到退出信号，开始优雅关闭");
    const forceExit = setTimeout(() => {
      app.log.error("优雅关闭超时，强制退出");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();
    let exitCode = failureExitCode;
    try {
      await app.close();
      await closePool();
      app.log.info("已关闭");
    } catch (err) {
      app.log.error({ err }, "关闭过程出错");
      exitCode = 1;
    }
    // 在途请求已结束、连接池已关：直接退出。不等事件循环自己清空，
    // 否则一条对端不再应答的数据库连接就能把进程拖到强制退出。
    process.exit(exitCode);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  // 不直接让 Node 打印异常并崩溃：默认的输出会带上异常对象的全部字段，里面可能有连接信息（规则 5）
  const onFatal = (kind: string, err: unknown): void => {
    app.log.fatal({ err, kind }, "未捕获的异常，进程即将退出");
    void shutdown(kind, 1);
  };
  process.on("uncaughtException", (err) => onFatal("uncaughtException", err));
  process.on("unhandledRejection", (reason) => onFatal("unhandledRejection", reason));

  try {
    await app.listen({ host: "0.0.0.0", port: config.port });
  } catch (err) {
    app.log.error({ err }, "启动失败");
    await closePool();
    process.exit(1);
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
    // 不直接打印异常对象：它的附加字段里可能带连接串（规则 5）
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    console.error(`启动失败：${redactText(message, [])}`);
  }
  process.exit(1);
}
