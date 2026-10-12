/**
 * PostgreSQL 连接池的唯一创建入口。
 *
 * - 连接串只从 @nozomi/config 的 `databaseUrl` 传入，这里不读环境变量。
 * - 空闲连接出错（数据库重启、网络断开）只记日志，不让进程崩溃；下一次查询会自动重连。
 * - 日志里只写驱动的错误码，不写连接串。
 * - 每个查询都有时限，连接不会被一个永远不返回的查询占住（见下面的三层超时）。
 */
import pg from "pg";

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;

/**
 * 三层超时，对付三种不同的故障：
 * - statementTimeoutMs：数据库端取消执行过久的语句。连接本身是好的，取消后继续用。
 * - queryTimeoutMs：客户端等应答的时限，比上一层长一点，专门兜「对端不应答也不断开」的情况。
 *   超时后这条连接会被连接池丢弃重建，不会带病留在池里。
 * - connectionTimeoutMs：建立新连接的时限。
 * 另外开启 TCP keepalive，让操作系统也能发现已经失效的空闲连接。
 */
export interface PoolOptions {
  /** 池内最大连接数 */
  max?: number;
  /** 建立连接的超时（毫秒） */
  connectionTimeoutMs?: number;
  /** 客户端等一个查询应答的最长时间（毫秒）；0 表示不限（只给迁移用） */
  queryTimeoutMs?: number;
  /** 数据库端单条语句的最长执行时间（毫秒）；0 表示不限（只给迁移用） */
  statementTimeoutMs?: number;
  /** 空闲连接出错时的回调，用于记日志 */
  onIdleError?: (info: { code: string | null }) => void;
}

export const DEFAULT_STATEMENT_TIMEOUT_MS = 10_000;
export const DEFAULT_QUERY_TIMEOUT_MS = 15_000;

export function createPool(databaseUrl: string, options: PoolOptions = {}): Pool {
  const queryTimeoutMs = options.queryTimeoutMs ?? DEFAULT_QUERY_TIMEOUT_MS;
  const statementTimeoutMs = options.statementTimeoutMs ?? DEFAULT_STATEMENT_TIMEOUT_MS;
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: options.max ?? 10,
    connectionTimeoutMillis: options.connectionTimeoutMs ?? 5_000,
    idleTimeoutMillis: 30_000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10_000,
    application_name: "nozomi-api",
    ...(queryTimeoutMs > 0 ? { query_timeout: queryTimeoutMs } : {}),
    ...(statementTimeoutMs > 0 ? { statement_timeout: statementTimeoutMs } : {}),
  });
  pool.on("error", (err) => {
    options.onIdleError?.({ code: driverErrorCode(err) });
  });
  return pool;
}

/** 取驱动或系统的错误码（如 ECONNREFUSED、57P01）；不返回可能带连接信息的 message。 */
export function driverErrorCode(err: unknown): string | null {
  if (typeof err === "object" && err !== null && "code" in err && typeof err.code === "string") {
    return err.code;
  }
  return null;
}

/** 是否是驱动报的超时（等查询应答超时、建立连接超时）。驱动没有给这类错误定错误码，只能看说明。 */
export function isDriverTimeout(err: unknown): boolean {
  return err instanceof Error && /timeout/i.test(err.message);
}

export interface QueryInput {
  text: string;
  values?: unknown[];
  query_timeout?: number;
}

/** 组装一个带客户端时限的查询（时限只对这一个查询生效，覆盖连接池的默认值）。 */
export function timedQuery(text: string, timeoutMs: number | undefined, values?: unknown[]): QueryInput {
  return {
    text,
    ...(values === undefined ? {} : { values }),
    ...(timeoutMs === undefined ? {} : { query_timeout: Math.max(1, Math.ceil(timeoutMs)) }),
  };
}
