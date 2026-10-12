/**
 * 数据库迁移执行器（见 ADR 0006）。纯 SQL 文件 + 一张记录表 `schema_migrations`。
 *
 * - 可在空库上从头执行；重复执行时已执行的迁移一律跳过，没有副作用。
 * - 每个迁移在自己的事务里执行，失败整体回滚，不会留下执行了一半的结构。
 * - 用 advisory lock 保证同一时间只有一个进程在迁移（多实例同时部署时其余的排队等待）。
 * - 记录表建在连接的当前 schema（search_path 的第一个），集成测试靠这一点做隔离。
 * - 迁移文件里的事务控制语句在读取文件时就被拒绝（见 migration-plan.ts），不会执行到一半才发现。
 */
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { QueryResultRow } from "pg";
import type { Pool, PoolClient } from "./pool.ts";
import { type QueryInput, driverErrorCode, timedQuery } from "./pool.ts";
import {
  type AppliedMigration,
  type MigrationFile,
  MigrationError,
  buildMigrationFiles,
  planMigrations,
} from "./migration-plan.ts";

/** 仓库里迁移文件的位置：apps/api/migrations */
export const MIGRATIONS_DIR = fileURLToPath(new URL("../../migrations/", import.meta.url));

/** advisory lock 的两段式键，全库唯一即可（"NZ" + "MG" 的 ASCII 码）。 */
export const MIGRATION_LOCK_KEY = [0x4e5a, 0x4d47] as const;
const LOCK_TIMEOUT_SQLSTATE = "55P03";

/**
 * 迁移可能很慢（大表建索引），也可能要排队等锁，所以迁移用的查询不受连接池默认时限的约束：
 * 客户端时限设成定时器允许的最大值，数据库端的 statement_timeout 在本次会话里关掉。
 */
const NO_CLIENT_TIMEOUT_MS = 2_147_483_647;

/**
 * 读取目录下全部迁移文件。扩展名是 `.sql`（不分大小写）的文件都必须符合命名规则，
 * 否则报错——写错大小写的文件不会被悄悄跳过。其他文件（README.md 等）和子目录忽略。
 */
export async function loadMigrationFiles(dir: string = MIGRATIONS_DIR): Promise<MigrationFile[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const names = entries.filter((e) => e.isFile() && /\.sql$/i.test(e.name)).map((e) => e.name);
  const inputs = await Promise.all(
    names.map(async (fileName) => ({ fileName, sql: await readFile(join(dir, fileName), "utf8") })),
  );
  return buildMigrationFiles(inputs);
}

/** 能执行带时限查询的东西：连接池、连接，或事务里的查询入口。 */
interface Queryable {
  query<R extends QueryResultRow = QueryResultRow>(input: QueryInput): Promise<{ rows: R[] }>;
}

export interface ReadAppliedOptions {
  /** 记录表的名字（可带 schema）；默认按当前 search_path 找 `schema_migrations` */
  table?: string;
  /** 每个查询的客户端时限（毫秒）；不传则用连接池的默认值 */
  queryTimeoutMs?: number;
}

/** 读取已执行的迁移记录；记录表还不存在时视为一个都没执行。 */
export async function readAppliedMigrations(
  db: Queryable,
  options: ReadAppliedOptions = {},
): Promise<AppliedMigration[]> {
  const table = options.table ?? "schema_migrations";
  const exists = await db.query<{ exists: boolean }>(
    timedQuery("select to_regclass($1) is not null as exists", options.queryTimeoutMs, [table]),
  );
  if (!exists.rows[0]?.exists) return [];
  const result = await db.query<AppliedMigration>(
    timedQuery(`select version, name, checksum from ${table} order by version`, options.queryTimeoutMs),
  );
  return result.rows;
}

export interface MigrateOptions {
  /** 等待其他进程释放迁移锁的最长时间（毫秒） */
  lockTimeoutMs?: number;
  /** 每执行完一个迁移回调一次，用于输出进度 */
  onApplied?: (file: MigrationFile) => void;
}

export interface MigrateResult {
  /** 本次新执行的迁移 */
  applied: MigrationFile[];
  /** 本次之前已经执行过的迁移数量 */
  skipped: number;
}

function untimed(text: string, values?: unknown[]): QueryInput {
  return timedQuery(text, NO_CLIENT_TIMEOUT_MS, values);
}

async function acquireLock(client: PoolClient, timeoutMs: number): Promise<void> {
  await client.query(untimed("select set_config('lock_timeout', $1, false)", [`${timeoutMs}ms`]));
  try {
    await client.query(untimed("select pg_advisory_lock($1, $2)", [...MIGRATION_LOCK_KEY]));
  } catch (err) {
    if (driverErrorCode(err) === LOCK_TIMEOUT_SQLSTATE) {
      throw new MigrationError(
        "MIGRATION_LOCK_TIMEOUT",
        `等待迁移锁超过 ${timeoutMs} 毫秒：有另一个进程正在执行迁移，请等它结束后重试。`,
        { cause: err },
      );
    }
    throw err;
  } finally {
    await client.query(untimed("reset lock_timeout"));
  }
}

/**
 * 记录表的完整名字（带 schema）。执行器全程用它，不依赖 search_path：
 * 迁移文件里用 `set local search_path` 改了查找路径，记录照样写得进去。
 */
async function resolveMigrationsTable(client: PoolClient): Promise<string> {
  const result = await client.query<{ schema: string | null }>(
    untimed("select quote_ident(current_schema()) as schema"),
  );
  const schema = result.rows[0]?.schema;
  if (!schema) {
    throw new MigrationError("MIGRATION_FAILED", "当前连接的 search_path 里没有可用的 schema，无法确定迁移记录表建在哪里。");
  }
  return `${schema}.schema_migrations`;
}

async function applyOne(client: PoolClient, table: string, file: MigrationFile): Promise<void> {
  await client.query(untimed("begin"));
  try {
    await client.query(untimed(file.sql));
    await client.query(
      untimed(`insert into ${table} (version, name, checksum) values ($1, $2, $3)`, [
        file.version,
        file.name,
        file.checksum,
      ]),
    );
    await client.query(untimed("commit"));
  } catch (err) {
    await client.query(untimed("rollback"));
    const reason = err instanceof Error ? err.message : String(err);
    throw new MigrationError("MIGRATION_FAILED", `迁移 ${file.fileName} 执行失败，已回滚：${reason}`, {
      cause: err,
    });
  }
}

/** 执行所有还没执行的迁移。记录与文件对不上时抛 MigrationError，数据库保持原样。 */
export async function runMigrations(
  pool: Pool,
  files: readonly MigrationFile[],
  options: MigrateOptions = {},
): Promise<MigrateResult> {
  const client = await pool.connect();
  let locked = false;
  let broken = false;
  try {
    await client.query(untimed("select set_config('statement_timeout', '0', false)"));
    await acquireLock(client, options.lockTimeoutMs ?? 60_000);
    locked = true;
    const table = await resolveMigrationsTable(client);
    await client.query(
      untimed(`
        create table if not exists ${table} (
          version integer primary key,
          name text not null,
          checksum text not null,
          applied_at timestamptz not null default now()
        )
      `),
    );
    const already = await readAppliedMigrations(client, { table, queryTimeoutMs: NO_CLIENT_TIMEOUT_MS });
    const pending = planMigrations(files, already);
    const applied: MigrationFile[] = [];
    for (const file of pending) {
      await applyOne(client, table, file);
      applied.push(file);
      options.onApplied?.(file);
    }
    return { applied, skipped: already.length };
  } finally {
    try {
      if (locked) await client.query(untimed("select pg_advisory_unlock($1, $2)", [...MIGRATION_LOCK_KEY]));
      await client.query(untimed("reset statement_timeout"));
    } catch {
      // 收尾失败说明连接已坏：销毁连接，会话结束时数据库会自动释放锁
      broken = true;
    }
    client.release(broken);
  }
}
