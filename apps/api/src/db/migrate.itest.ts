/**
 * 迁移执行器的集成测试：连真实 PostgreSQL，每个测试一个独立 schema，结束后删除。
 * 迁移文件写在临时目录里（测试自己构造），不依赖仓库里的业务迁移。
 */
import { after, afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPool } from "./pool.ts";
import {
  MIGRATIONS_DIR,
  MIGRATION_LOCK_KEY,
  loadMigrationFiles,
  readAppliedMigrations,
  runMigrations,
} from "./migrate.ts";
import { type MigrationErrorCode, MigrationError } from "./migration-plan.ts";
import { type TestDatabase, createTestDatabase } from "../testing/db.ts";

let db: TestDatabase;
let dir: string;
const tempDirs: string[] = [];

beforeEach(async () => {
  db = await createTestDatabase();
  dir = await mkdtemp(join(tmpdir(), "nozomi-migrations-"));
  tempDirs.push(dir);
});
afterEach(() => db.drop());
after(() => Promise.all(tempDirs.map((d) => rm(d, { recursive: true, force: true }))));

async function writeMigration(fileName: string, sql: string): Promise<void> {
  await writeFile(join(dir, fileName), sql, "utf8");
}

async function tableNames(): Promise<string[]> {
  const result = await db.pool.query<{ table_name: string }>(
    "select table_name from information_schema.tables where table_schema = $1 order by table_name",
    [db.schema],
  );
  return result.rows.map((r) => r.table_name);
}

async function migrationRows(): Promise<{ version: number; checksum: string; applied_at: Date }[]> {
  const result = await db.pool.query("select version, checksum, applied_at from schema_migrations order by version");
  return result.rows;
}

function rejectsWith(promise: Promise<unknown>, code: MigrationErrorCode): Promise<void> {
  return assert.rejects(promise, (err: unknown) => err instanceof MigrationError && err.code === code);
}

test("空库上从头执行：按编号顺序建出全部结构并记录", async () => {
  await writeMigration("0002_child.sql", "create table child (id int primary key, parent_id int references parent (id));");
  await writeMigration("0001_parent.sql", "create table parent (id int primary key);");
  const result = await runMigrations(db.pool, await loadMigrationFiles(dir));
  assert.deepEqual(result.applied.map((f) => f.fileName), ["0001_parent.sql", "0002_child.sql"]);
  assert.equal(result.skipped, 0);
  assert.deepEqual(await tableNames(), ["child", "parent", "schema_migrations"]);
  assert.deepEqual((await readAppliedMigrations(db.pool)).map((m) => m.name), ["parent", "child"]);
});

test("连跑两次无副作用：第二次什么都不执行，记录一行不变", async () => {
  await writeMigration("0001_a.sql", "create table a (id int primary key);");
  await writeMigration("0002_b.sql", "create table b (id int primary key);");
  const files = await loadMigrationFiles(dir);
  await runMigrations(db.pool, files);
  const before = await migrationRows();
  const second = await runMigrations(db.pool, files);
  assert.deepEqual(second.applied, []);
  assert.equal(second.skipped, 2);
  assert.deepEqual(await migrationRows(), before);
  assert.deepEqual(await tableNames(), ["a", "b", "schema_migrations"]);
});

test("新增迁移后再跑：只执行新增的", async () => {
  await writeMigration("0001_a.sql", "create table a (id int primary key);");
  await runMigrations(db.pool, await loadMigrationFiles(dir));
  await writeMigration("0002_b.sql", "create table b (id int primary key);");
  const result = await runMigrations(db.pool, await loadMigrationFiles(dir));
  assert.deepEqual(result.applied.map((f) => f.version), [2]);
  assert.equal(result.skipped, 1);
});

test("已执行的迁移文件被篡改：报校验和错误，数据库保持原样，后面的新迁移也不执行", async () => {
  await writeMigration("0001_a.sql", "create table a (id int primary key);");
  await runMigrations(db.pool, await loadMigrationFiles(dir));
  const before = await migrationRows();
  await writeMigration("0001_a.sql", "create table a (id int primary key, extra text);");
  await writeMigration("0002_b.sql", "create table b (id int primary key);");
  await rejectsWith(runMigrations(db.pool, await loadMigrationFiles(dir)), "MIGRATION_CHECKSUM_MISMATCH");
  assert.deepEqual(await migrationRows(), before);
  assert.deepEqual(await tableNames(), ["a", "schema_migrations"]);
});

test("已执行的迁移文件被删除：报错", async () => {
  await writeMigration("0001_a.sql", "create table a (id int primary key);");
  await runMigrations(db.pool, await loadMigrationFiles(dir));
  await rm(join(dir, "0001_a.sql"));
  await rejectsWith(runMigrations(db.pool, await loadMigrationFiles(dir)), "MIGRATION_FILE_MISSING");
});

test("迁移执行到一半出错：该迁移整体回滚，之前成功的保留，修好后可以继续", async () => {
  await writeMigration("0001_ok.sql", "create table ok (id int primary key);");
  await writeMigration("0002_bad.sql", "create table half (id int primary key); select * from no_such_table;");
  await rejectsWith(runMigrations(db.pool, await loadMigrationFiles(dir)), "MIGRATION_FAILED");
  assert.deepEqual(await tableNames(), ["ok", "schema_migrations"]);
  assert.deepEqual((await migrationRows()).map((r) => r.version), [1]);

  await writeMigration("0002_bad.sql", "create table half (id int primary key);");
  const retry = await runMigrations(db.pool, await loadMigrationFiles(dir));
  assert.deepEqual(retry.applied.map((f) => f.version), [2]);
  assert.deepEqual(await tableNames(), ["half", "ok", "schema_migrations"]);
});

test("多个进程同时迁移：每个迁移只执行一次，都不报错", async () => {
  await writeMigration("0001_a.sql", "create table a (id int primary key); select pg_sleep(0.2);");
  await writeMigration("0002_b.sql", "create table b (id int primary key);");
  const files = await loadMigrationFiles(dir);
  const others = [createPool(db.url, { max: 1 }), createPool(db.url, { max: 1 })];
  try {
    const results = await Promise.all([db.pool, ...others].map((pool) => runMigrations(pool, files)));
    assert.deepEqual(results.map((r) => r.applied.length).sort(), [0, 0, 2]);
    assert.deepEqual((await migrationRows()).map((r) => r.version), [1, 2]);
  } finally {
    await Promise.all(others.map((pool) => pool.end()));
  }
});

test("迁移锁被别的进程占着：等到超时后报 MIGRATION_LOCK_TIMEOUT，不改数据库", async () => {
  await writeMigration("0001_a.sql", "create table a (id int primary key);");
  const files = await loadMigrationFiles(dir);
  const holder = await db.pool.connect();
  try {
    await holder.query("select pg_advisory_lock($1, $2)", [...MIGRATION_LOCK_KEY]);
    await rejectsWith(runMigrations(db.pool, files, { lockTimeoutMs: 200 }), "MIGRATION_LOCK_TIMEOUT");
    assert.deepEqual(await tableNames(), []);
  } finally {
    await holder.query("select pg_advisory_unlock($1, $2)", [...MIGRATION_LOCK_KEY]);
    holder.release();
  }
  const result = await runMigrations(db.pool, files);
  assert.equal(result.applied.length, 1);
});

test("迁移目录里有不合规的 .sql 文件名：读取时就报错；非 .sql 文件忽略", async () => {
  await writeMigration("README.md", "说明");
  assert.deepEqual(await loadMigrationFiles(dir), []);
  await writeMigration("add_table.sql", "select 1;");
  await rejectsWith(loadMigrationFiles(dir), "MIGRATION_BAD_FILE_NAME");
});

test("仓库里的真实迁移（apps/api/migrations）可在空库上从头执行，再跑一次无变化", async () => {
  const files = await loadMigrationFiles(MIGRATIONS_DIR);
  const first = await runMigrations(db.pool, files);
  assert.equal(first.applied.length, files.length);
  const before = await migrationRows();
  const second = await runMigrations(db.pool, files);
  assert.deepEqual(second.applied, []);
  assert.deepEqual(await migrationRows(), before);
});
