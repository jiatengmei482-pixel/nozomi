/**
 * 健康检查：数据库连通（真实执行查询，带超时）、迁移状态、各集成的配置状态。
 *
 * - /health 不需要登录，所以各集成只给出「已配置 / 未配置」（key、label、state）；
 *   脱敏后的说明文字（detail）只在需要平台登录的 GET /platform/v1/integrations 返回。
 * - 数据库出错时只返回归类后的错误码，不返回驱动的原始报错。
 * - 数据库探测同时核对连接用的账号是不是最小权限的应用账号（ADR 0010）：连得上但账号不合格也算不可用（DB_ROLE_UNSAFE）。
 * - 迁移记录在登录前事务里读（应用账号自己没有任何表权限）。
 * - 第三方集成「未配置」不算故障（local / ci / staging 允许缺省，production 缺了根本启动不了）。
 * - 整个检查共用一个时限 `timeoutMs`：数据库探测和迁移探测加起来不超过它。
 * - 探测用的每个查询都带同样的客户端时限：超时的连接会被连接池丢弃重建，
 *   所以「对端不应答也不断开」的失效连接不会一直占着连接池。
 */
import { type AppConfig, type AppEnv, type IntegrationStatus, integrationStatus } from "@nozomi/config";
import { withPreAuthTx } from "./db/context.ts";
import { DB_ROLE_UNSAFE, DbIdentityError, assertLeastPrivilege } from "./db/identity.ts";
import { type Pool, isDriverTimeout } from "./db/pool.ts";
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

export type DatabaseErrorCode = "DB_TIMEOUT" | "DB_UNREACHABLE" | typeof DB_ROLE_UNSAFE;

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
  integrations: PublicIntegrationStatus[];
}

/** 公开的集成状态：没有 detail。 */
export type PublicIntegrationStatus = Pick<IntegrationStatus, "key" | "label" | "state">;

export function publicIntegrationStatus(config: AppConfig): PublicIntegrationStatus[] {
  return integrationStatus(config).map(({ key, label, state }) => ({ key, label, state }));
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
    await withTimeout(assertLeastPrivilege(pool, timeoutMs), timeoutMs);
    return { state: "up", latencyMs: Math.round(performance.now() - startedAt), errorCode: null };
  } catch (err) {
    if (err instanceof DbIdentityError) return { state: "down", latencyMs: null, errorCode: DB_ROLE_UNSAFE };
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
    const applied = await withTimeout(
      withPreAuthTx(pool, (db) => readAppliedMigrations(db, { queryTimeoutMs: timeoutMs }), { queryTimeoutMs: timeoutMs }),
      timeoutMs,
    );
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
    integrations: publicIntegrationStatus(deps.config),
  };
}
