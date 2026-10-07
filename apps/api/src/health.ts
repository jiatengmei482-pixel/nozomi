/**
 * 健康检查：数据库连通（真实执行查询，带超时）、迁移状态、各集成的配置状态。
 *
 * - 集成状态只用 @nozomi/config 的 `integrationStatus`，那里已经脱敏；这里不直接接触任何密钥。
 * - 数据库出错时只返回归类后的错误码，不返回驱动的原始报错。
 * - 第三方集成「未配置」不算故障（local / ci / staging 允许缺省，production 缺了根本启动不了）。
 * - 整个检查共用一个时限 `timeoutMs`：数据库探测和迁移探测加起来不超过它。
 * - 探测用的每个查询都带同样的客户端时限：超时的连接会被连接池丢弃重建，
 *   所以「对端不应答也不断开」的失效连接不会一直占着连接池。
 */
import { type AppConfig, type AppEnv, type IntegrationStatus, integrationStatus } from "@nozomi/config";
import { type Pool, isDriverTimeout, timedQuery } from "./db/pool.ts";
import { readAppliedMigrations } from "./db/migrate.ts";
import { type MigrationFile, MigrationError, planMigrations } from "./db/migration-plan.ts";

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`超过 ${ms} 毫秒未完成`);
    this.name = "TimeoutError";
  }
}

/** 给一个异步操作加上限时；超时后原操作的结果（无论成功失败）都被丢弃。 */
export function withTimeout<T>(operation: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export type DatabaseErrorCode = "DB_TIMEOUT" | "DB_UNREACHABLE";

export interface DatabaseHealth {
  state: "up" | "down";
  latencyMs: number | null;
  errorCode: DatabaseErrorCode | null;
}

export interface MigrationHealth {
  state: "up_to_date" | "pending" | "error" | "unknown";
  applied: number | null;
  pending: number | null;
  errorCode: string | null;
}

export interface HealthReport {
  status: "ok" | "degraded";
  env: AppEnv;
  database: DatabaseHealth;
  migrations: MigrationHealth;
  integrations: IntegrationStatus[];
}

export interface HealthDeps {
  config: AppConfig;
  pool: Pool;
  migrationFiles: readonly MigrationFile[];
  /** 整个健康检查（数据库探测 + 迁移探测）的时限（毫秒） */
  timeoutMs: number;
}

const MIGRATIONS_UNKNOWN: MigrationHealth = { state: "unknown", applied: null, pending: null, errorCode: null };

async function checkDatabase(pool: Pool, timeoutMs: number): Promise<DatabaseHealth> {
  const startedAt = performance.now();
  try {
    await withTimeout(pool.query(timedQuery("select 1", timeoutMs)), timeoutMs);
    return { state: "up", latencyMs: Math.round(performance.now() - startedAt), errorCode: null };
  } catch (err) {
    const timedOut = err instanceof TimeoutError || isDriverTimeout(err);
    return { state: "down", latencyMs: null, errorCode: timedOut ? "DB_TIMEOUT" : "DB_UNREACHABLE" };
  }
}

async function checkMigrations(
  pool: Pool,
  files: readonly MigrationFile[],
  timeoutMs: number,
): Promise<MigrationHealth> {
  try {
    const applied = await withTimeout(readAppliedMigrations(pool, { queryTimeoutMs: timeoutMs }), timeoutMs);
    const pending = planMigrations(files, applied).length;
    return {
      state: pending === 0 ? "up_to_date" : "pending",
      applied: applied.length,
      pending,
      errorCode: null,
    };
  } catch (err) {
    if (err instanceof MigrationError) {
      return { state: "error", applied: null, pending: null, errorCode: err.code };
    }
    return MIGRATIONS_UNKNOWN;
  }
}

export async function checkHealth(deps: HealthDeps): Promise<HealthReport> {
  const deadline = performance.now() + deps.timeoutMs;
  const database = await checkDatabase(deps.pool, deps.timeoutMs);
  const remainingMs = deadline - performance.now();
  const migrations =
    database.state === "up" && remainingMs >= 1
      ? await checkMigrations(deps.pool, deps.migrationFiles, remainingMs)
      : MIGRATIONS_UNKNOWN;
  const healthy = database.state === "up" && migrations.state === "up_to_date";
  return {
    status: healthy ? "ok" : "degraded",
    env: deps.config.appEnv,
    database,
    migrations,
    integrations: integrationStatus(deps.config),
  };
}
