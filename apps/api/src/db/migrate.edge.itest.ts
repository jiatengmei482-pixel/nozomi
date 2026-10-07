/**
 * 迁移执行器的边界情况：特殊内容的文件、编号空洞与乱序、换行差异、schema 隔离，
 * 以及多个独立进程真正并发执行、迁移进程中途被杀。
 * 每个测试一个独立 schema；迁移文件写在测试自己的临时目录里。
 */
import { after, afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadMigrationFiles, readAppliedMigrations, runMigrations } from "./migrate.ts";
import { type MigrationErrorCode, MigrationError } from "./migration-plan.ts";
import { createPool } from "./pool.ts";
import { type TestDatabase, createTestDatabase } from "../testing/db.ts";
import { exitWithin, startNode, waitUntil } from "../testing/process.ts";

const CHILD_ENTRY = fileURLToPath(new URL("../testing/run-migrations-child.ts", import.meta.url));

let db: TestDatabase;
let dir: string;
const tempDirs: string[] = [];

beforeEach(async () => {
  db = await createTestDatabase();
  dir = await mkdtemp(join(tmpdir(), "nozomi-migrations-edge-"));
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

async function appliedVersions(): Promise<number[]> {
  return (await readAppliedMigrations(db.pool)).map((m) => m.version);
}

/** 记录表的完整内容（含执行时间），用来断言「数据库一点没动」。 */
async function migrationRows(): Promise<unknown[]> {
  return (await db.pool.query("select version, name, checksum, applied_at from schema_migrations order by version")).rows;
}

function rejectsWith(promise: Promise<unknown>, code: MigrationErrorCode): Promise<void> {
  return assert.rejects(promise, (err: unknown) => {
    assert.ok(err instanceof MigrationError, `不是 MigrationError：${String(err)}`);
    assert.equal(err.code, code);
    return true;
  });
}

async function migrate(): Promise<{ applied: string[]; skipped: number }> {
  const result = await runMigrations(db.pool, await loadMigrationFiles(dir));
  return { applied: result.applied.map((f) => f.fileName), skipped: result.skipped };
}

test("空文件、只有空白或注释的文件：算作已执行并记录，重复执行不再处理", async () => {
  await writeMigration("0001_empty.sql", "");
  await writeMigration("0002_blank.sql", "  \n\n\t\n");
  await writeMigration("0003_comment_only.sql", "-- 以后再补\n/* 块注释 */\n");
  await writeMigration("0004_real.sql", "create table real_one (id int primary key);");
  assert.deepEqual(await migrate(), {
    applied: ["0001_empty.sql", "0002_blank.sql", "0003_comment_only.sql", "0004_real.sql"],
    skipped: 0,
  });
  assert.deepEqual(await appliedVersions(), [1, 2, 3, 4]);
  assert.deepEqual(await migrate(), { applied: [], skipped: 4 });
  assert.deepEqual(await tableNames(), ["real_one", "schema_migrations"]);
});

test("一个文件里有多条语句（含带分号的字符串和函数体）：全部执行", async () => {
  await writeMigration(
    "0001_multi.sql",
    [
      "create table t1 (id int primary key, note text default 'a;b');",
      "create table t2 (id int primary key, t1_id int references t1 (id));",
      "create index t2_t1_id on t2 (t1_id);",
      "create function bump(n int) returns int language plpgsql as $$ begin return n + 1; end; $$;",
      "comment on table t1 is '说明；含全角分号';",
    ].join("\n"),
  );
  assert.deepEqual((await migrate()).applied, ["0001_multi.sql"]);
  assert.deepEqual(await tableNames(), ["schema_migrations", "t1", "t2"]);
  assert.equal((await db.pool.query("select bump(41) as n")).rows[0].n, 42);
});

test("第一个迁移就有语法错误：它前面已经执行的语句也整体回滚，没有任何记录；改好后可以重新执行", async () => {
  await writeMigration("0001_bad.sql", "create table before_error (id int primary key);\ncreat table typo (id int);\n");
  await writeMigration("0002_never.sql", "create table never_reached (id int primary key);");
  await rejectsWith(migrate(), "MIGRATION_FAILED");
  assert.deepEqual(await tableNames(), ["schema_migrations"]);
  assert.deepEqual(await appliedVersions(), []);

  await writeMigration("0001_bad.sql", "create table before_error (id int primary key);\ncreate table typo (id int);\n");
  assert.deepEqual((await migrate()).applied, ["0001_bad.sql", "0002_never.sql"]);
  assert.deepEqual(await tableNames(), ["before_error", "never_reached", "schema_migrations", "typo"]);
});

test("迁移的 SQL 执行成功但写执行记录失败：该迁移建的结构一并回滚（结构和记录在同一个事务里）", async () => {
  await writeMigration("0001_guard.sql", "alter table schema_migrations add constraint reject_v2 check (version <> 2);");
  await writeMigration("0002_blocked.sql", "create table blocked (id int primary key);");
  await rejectsWith(migrate(), "MIGRATION_FAILED");
  assert.deepEqual(await appliedVersions(), [1]);
  assert.deepEqual(await tableNames(), ["schema_migrations"]);
});

test("迁移失败的报错说明是哪个文件，并带上数据库给出的原因", async () => {
  await writeMigration("0001_bad.sql", "select * from table_that_does_not_exist;");
  await assert.rejects(migrate(), (err: unknown) => {
    assert.ok(err instanceof MigrationError);
    assert.equal(err.code, "MIGRATION_FAILED");
    assert.match(err.message, /0001_bad\.sql/);
    assert.match(err.message, /table_that_does_not_exist/);
    assert.ok(!err.message.includes(new URL(db.url).password + "@"), "报错里出现了连接串");
    return true;
  });
});

test("编号有空洞（0001、0003）可以执行；之后补一个 0002 会被拒绝，数据库保持原样", async () => {
  await writeMigration("0001_a.sql", "create table a (id int primary key);");
  await writeMigration("0003_c.sql", "create table c (id int primary key);");
  assert.deepEqual((await migrate()).applied, ["0001_a.sql", "0003_c.sql"]);
  const before = await migrationRows();

  await writeMigration("0002_b.sql", "create table b (id int primary key);");
  await writeMigration("0004_d.sql", "create table d (id int primary key);");
  await rejectsWith(migrate(), "MIGRATION_OUT_OF_ORDER");
  assert.deepEqual(await migrationRows(), before);
  assert.deepEqual(await tableNames(), ["a", "c", "schema_migrations"]);
});

test("已执行的迁移文件被删除，同时又新增了迁移：报错，新增的迁移不执行，数据库保持原样", async () => {
  await writeMigration("0001_a.sql", "create table a (id int primary key);");
  await writeMigration("0002_b.sql", "create table b (id int primary key);");
  await migrate();
  const before = await migrationRows();

  await rm(join(dir, "0001_a.sql"));
  await writeMigration("0003_c.sql", "create table c (id int primary key);");
  await rejectsWith(migrate(), "MIGRATION_FILE_MISSING");
  assert.deepEqual(await migrationRows(), before);
  assert.deepEqual(await tableNames(), ["a", "b", "schema_migrations"]);
});

test("已执行的迁移文件被改了编号（内容不变）：报错，不会当成新迁移再执行一遍", async () => {
  await writeMigration("0001_a.sql", "create table a (id int primary key);");
  await migrate();
  await rm(join(dir, "0001_a.sql"));
  await writeMigration("0002_a.sql", "create table a (id int primary key);");
  await rejectsWith(migrate(), "MIGRATION_FILE_MISSING");
  assert.deepEqual(await appliedVersions(), [1]);
});

test("目录里有两个文件编号相同：读取时就报错，什么都不执行", async () => {
  await writeMigration("0001_a.sql", "create table a (id int primary key);");
  await writeMigration("0001_b.sql", "create table b (id int primary key);");
  await rejectsWith(loadMigrationFiles(dir), "MIGRATION_DUPLICATE_VERSION");
  assert.deepEqual(await tableNames(), []);
});

test("同一个迁移文件用 LF 执行后，换成 CRLF 换行（Windows 检出）再跑：不算改动，也不重复执行；反过来也一样", async () => {
  const lf = "create table a (\n  id int primary key\n);\n";
  const crlf = lf.replaceAll("\n", "\r\n");
  await writeMigration("0001_a.sql", lf);
  await writeMigration("0002_b.sql", "create table b (\r\n  id int primary key\r\n);\r\n");
  assert.deepEqual((await migrate()).applied, ["0001_a.sql", "0002_b.sql"]);
  const before = await migrationRows();

  await writeMigration("0001_a.sql", crlf);
  await writeMigration("0002_b.sql", "create table b (\n  id int primary key\n);\n");
  assert.deepEqual(await migrate(), { applied: [], skipped: 2 });
  assert.deepEqual(await migrationRows(), before);
});

test("只改了注释或空格也算改动（有意为之，见 ADR 0006）", async () => {
  await writeMigration("0001_a.sql", "create table a (id int primary key);\n");
  await migrate();
  await writeMigration("0001_a.sql", "create table a (id int primary key);\n-- 补一行注释\n");
  await rejectsWith(migrate(), "MIGRATION_CHECKSUM_MISMATCH");
});

test("schema 隔离：迁移建的表和记录表只出现在本测试的 schema 里，不会漏到 public 或别的 schema", async () => {
  const table = `iso_${randomBytes(6).toString("hex")}`;
  await writeMigration("0001_isolated.sql", `create table ${table} (id int primary key);`);
  // 记下执行前其他 schema 里的 schema_migrations 内容（本地库或 CI 里 public 可能已经有这张表）
  const others = createPool(new URL(db.url).href.split("?")[0] as string, { max: 1 });
  try {
    const snapshot = async (): Promise<string> => {
      const tables = await others.query<{ table_schema: string }>(
        "select table_schema from information_schema.tables where table_name = 'schema_migrations' and table_schema = 'public'",
      );
      if (tables.rows.length === 0) return "public 里没有 schema_migrations";
      const rows = await others.query("select version, name, checksum, applied_at from public.schema_migrations order by version");
      return JSON.stringify(rows.rows);
    };
    const publicBefore = await snapshot();
    await migrate();
    const where = await others.query<{ table_schema: string }>(
      "select table_schema from information_schema.tables where table_name = $1",
      [table],
    );
    assert.deepEqual(where.rows.map((r) => r.table_schema), [db.schema]);
    assert.equal(await snapshot(), publicBefore, "public.schema_migrations 被这次迁移改动了");
    assert.deepEqual(await appliedVersions(), [1]);
  } finally {
    await others.end();
  }
});

test("迁移文件里改了 search_path：记录仍写进原来的记录表，下次不会重复执行", async () => {
  await writeMigration("0001_local_path.sql", "set local search_path to pg_catalog;\nselect 1;\n");
  await writeMigration("0002_after.sql", "create table after_path (id int primary key);");
  assert.deepEqual((await migrate()).applied, ["0001_local_path.sql", "0002_after.sql"]);
  assert.deepEqual(await tableNames(), ["after_path", "schema_migrations"]);
  assert.deepEqual(await migrate(), { applied: [], skipped: 2 });
});

test("迁移失败后锁已释放：别的连接可以接着执行，不会等到锁超时", async () => {
  await writeMigration("0001_bad.sql", "select 1/0;");
  await rejectsWith(migrate(), "MIGRATION_FAILED");
  await writeMigration("0001_bad.sql", "select 1;");
  const other = createPool(db.url, { max: 1 });
  try {
    // 锁没释放的话，这里会等满时限后报 MIGRATION_LOCK_TIMEOUT
    const result = await runMigrations(other, await loadMigrationFiles(dir), { lockTimeoutMs: 10_000 });
    assert.equal(result.applied.length, 1);
  } finally {
    await other.end();
  }
});

interface ChildResult {
  exit: number | null | "timeout";
  result: { applied?: string[]; skipped?: number; error?: string };
  output: string;
}

async function runChild(childDir: string, timeoutMs = 60_000): Promise<ChildResult> {
  const running = startNode(CHILD_ENTRY, { DATABASE_URL: db.url }, [childDir]);
  const exit = await exitWithin(running, timeoutMs);
  if (exit === "timeout") {
    running.child.kill("SIGKILL");
    await running.exited;
  }
  const lastLine = running.output().trim().split("\n").at(-1) ?? "";
  let result: ChildResult["result"] = {};
  try {
    result = JSON.parse(lastLine) as ChildResult["result"];
  } catch {
    result = { error: `输出不是 JSON：${running.output().slice(0, 300)}` };
  }
  return { exit, result, output: running.output() };
}

test("四个独立进程同时执行迁移：全部退出码 0，每个迁移只被其中一个进程执行一次", async () => {
  await writeMigration("0001_slow.sql", "create table slow (id int primary key); select pg_sleep(0.5);");
  await writeMigration("0002_b.sql", "create table b (id int primary key);");
  await writeMigration("0003_c.sql", "create table c (id int primary key);");
  const results = await Promise.all([runChild(dir), runChild(dir), runChild(dir), runChild(dir)]);
  assert.deepEqual(results.map((r) => r.exit), [0, 0, 0, 0], results.map((r) => r.output).join("\n"));
  const appliedCounts = results.map((r) => r.result.applied?.length ?? -1).sort();
  assert.deepEqual(appliedCounts, [0, 0, 0, 3]);
  const skippedCounts = results.map((r) => r.result.skipped ?? -1).sort();
  assert.deepEqual(skippedCounts, [0, 3, 3, 3]);
  assert.deepEqual(await appliedVersions(), [1, 2, 3]);
  assert.deepEqual(await tableNames(), ["b", "c", "schema_migrations", "slow"]);
});

test("迁移进程执行到一半被强制杀掉：不留下半成品，也不留下死锁；之后重新执行能完整成功", async () => {
  await writeMigration("0001_ok.sql", "create table ok (id int primary key);");
  await writeMigration("0002_long.sql", "create table half (id int primary key); select pg_sleep(3);");
  const running = startNode(CHILD_ENTRY, { DATABASE_URL: db.url }, [dir]);
  try {
    // 等第一个迁移提交、第二个迁移正在执行中
    const midway = await waitUntil(async () => (await tableNames()).includes("ok"), 15_000, 100);
    assert.ok(midway, `迁移进程没有开始执行：${running.output()}`);
    running.child.kill("SIGKILL");
    await running.exited;
  } finally {
    if (running.child.exitCode === null && running.child.signalCode === null) running.child.kill("SIGKILL");
  }
  // 被杀的进程留下的事务结束后（数据库发现连接断开），半成品必须消失
  const cleaned = await waitUntil(async () => !(await tableNames()).includes("half"), 15_000, 200);
  assert.ok(cleaned);
  assert.deepEqual(await appliedVersions(), [1]);

  await writeMigration("0002_long.sql", "create table half (id int primary key);");
  const retry = await runChild(dir, 30_000);
  assert.equal(retry.exit, 0, retry.output);
  assert.deepEqual(retry.result, { applied: ["0002_long.sql"], skipped: 1 });
  assert.deepEqual(await tableNames(), ["half", "ok", "schema_migrations"]);
});

test("目录里有子目录和其他扩展名的文件：只处理 .sql 文件", async () => {
  await mkdir(join(dir, "archive"));
  await writeFile(join(dir, "archive", "0009_old.sql"), "create table old_archived (id int primary key);", "utf8");
  await writeMigration("0001_a.sql.bak", "create table bak (id int primary key);");
  await writeMigration("notes.txt", "说明");
  await writeMigration("0001_a.sql", "create table a (id int primary key);");
  assert.deepEqual((await migrate()).applied, ["0001_a.sql"]);
  assert.deepEqual(await tableNames(), ["a", "schema_migrations"]);
});

test("扩展名大小写写错的迁移文件（0002_b.SQL）：应当报文件名不合规，而不是悄悄跳过", async () => {
  await writeMigration("0001_a.sql", "create table a (id int primary key);");
  await writeMigration("0002_b.SQL", "create table b (id int primary key);");
  await assert.rejects(
    loadMigrationFiles(dir),
    (err: unknown) => err instanceof MigrationError && err.code === "MIGRATION_BAD_FILE_NAME",
    "0002_b.SQL 被悄悄忽略了：迁移显示成功，但这个文件里的结构没有建出来",
  );
});

test("迁移文件里自己写了 commit（README 明令禁止）：执行器应当拒绝或整体回滚，不能留下没有记录的半成品", async () => {
  await writeMigration(
    "0001_self_commit.sql",
    "create table half_done (id int primary key);\ncommit;\ncreate table second_half (id int primary key);\nselect * from no_such_table;\n",
  );
  await assert.rejects(migrate(), MigrationError);
  const tables = await tableNames();
  const recorded = tables.includes("schema_migrations") ? await appliedVersions() : [];
  assert.deepEqual(recorded, []);
  assert.ok(
    !tables.includes("half_done"),
    `迁移报了失败、记录表里也没有它，但它建的表留在了库里（${tables.join("、")}）；修好文件重跑会因为「表已存在」再次失败`,
  );
});
