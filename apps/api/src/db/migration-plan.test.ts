import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type AppliedMigration,
  type MigrationErrorCode,
  MigrationError,
  buildMigrationFiles,
  findTransactionControl,
  migrationChecksum,
  parseMigrationFileName,
  planMigrations,
} from "./migration-plan.ts";

function assertMigrationError(fn: () => unknown, code: MigrationErrorCode): void {
  assert.throws(fn, (err: unknown) => err instanceof MigrationError && err.code === code);
}

function applied(files: readonly { version: number; name: string; checksum: string }[]): AppliedMigration[] {
  return files.map(({ version, name, checksum }) => ({ version, name, checksum }));
}

const files = buildMigrationFiles([
  { fileName: "0002_b.sql", sql: "create table b ()" },
  { fileName: "0001_a.sql", sql: "create table a ()" },
  { fileName: "0003_c.sql", sql: "create table c ()" },
]);

test("解析合规的迁移文件名", () => {
  assert.deepEqual(parseMigrationFileName("0001_tenants.sql"), { version: 1, name: "tenants" });
  assert.deepEqual(parseMigrationFileName("0042_add_rls_policies.sql"), { version: 42, name: "add_rls_policies" });
});

test("不合规的文件名报 MIGRATION_BAD_FILE_NAME", () => {
  for (const bad of ["1_a.sql", "0001-a.sql", "0001_A.sql", "0001_.sql", "0001_a.SQL", "0000_a.sql", "00001_a.sql", "0001_a_.sql"]) {
    assertMigrationError(() => parseMigrationFileName(bad), "MIGRATION_BAD_FILE_NAME");
  }
});

test("校验和：内容相同则相同，改一个字符就不同，CRLF 与 LF 等价", () => {
  assert.equal(migrationChecksum("select 1;\n"), migrationChecksum("select 1;\n"));
  assert.notEqual(migrationChecksum("select 1;\n"), migrationChecksum("select 2;\n"));
  assert.equal(migrationChecksum("a\r\nb\r\n"), migrationChecksum("a\nb\n"));
  assert.match(migrationChecksum(""), /^[0-9a-f]{64}$/);
});

test("迁移列表按编号排序", () => {
  assert.deepEqual(files.map((f) => f.version), [1, 2, 3]);
});

test("编号重复报 MIGRATION_DUPLICATE_VERSION", () => {
  assertMigrationError(
    () => buildMigrationFiles([{ fileName: "0001_a.sql", sql: "" }, { fileName: "0001_b.sql", sql: "" }]),
    "MIGRATION_DUPLICATE_VERSION",
  );
});

test("空库：全部待执行，按编号顺序", () => {
  assert.deepEqual(planMigrations(files, []).map((f) => f.fileName), ["0001_a.sql", "0002_b.sql", "0003_c.sql"]);
});

test("部分已执行：只返回剩下的", () => {
  assert.deepEqual(planMigrations(files, applied(files.slice(0, 2))).map((f) => f.version), [3]);
});

test("全部已执行：没有待执行的", () => {
  assert.deepEqual(planMigrations(files, applied(files)), []);
});

test("没有任何迁移文件、也没有记录：没有待执行的", () => {
  assert.deepEqual(planMigrations([], []), []);
});

test("已执行的迁移文件被改动：报 MIGRATION_CHECKSUM_MISMATCH", () => {
  const tampered = buildMigrationFiles([
    { fileName: "0001_a.sql", sql: "create table a (id int)" },
    { fileName: "0002_b.sql", sql: "create table b ()" },
  ]);
  assertMigrationError(() => planMigrations(tampered, applied(files.slice(0, 2))), "MIGRATION_CHECKSUM_MISMATCH");
});

test("已执行的迁移文件被删除：报 MIGRATION_FILE_MISSING", () => {
  assertMigrationError(() => planMigrations(files.slice(1), applied(files)), "MIGRATION_FILE_MISSING");
});

test("新迁移的编号小于已执行的最新编号：报 MIGRATION_OUT_OF_ORDER", () => {
  const [a, , c] = files;
  assertMigrationError(() => planMigrations(files, applied([a!, c!])), "MIGRATION_OUT_OF_ORDER");
});

test("事务控制语句：顶层的 begin / commit / rollback 等都能找出来", () => {
  const cases: [string, string][] = [
    ["create table a (id int);\ncommit;\ncreate table b (id int);", "commit"],
    ["BEGIN;\ncreate table a (id int);", "begin"],
    ["  Start   Transaction ; select 1", "start transaction"],
    ["select 1; rollback", "rollback"],
    ["select 1; ROLLBACK WORK;", "rollback"],
    ["select 1;\n-- 注释\n  end;", "end"],
    ["abort;", "abort"],
    ["select 1; prepare transaction 'x';", "prepare transaction"],
    ["select 'it''s'; commit;", "commit"],
    ["select e'a\\'b'; commit;", "commit"],
    ["/* 外层 /* 嵌套 */ 还在注释里 */ commit;", "commit"],
    ["select $$ body $$; commit;", "commit"],
  ];
  for (const [sql, keyword] of cases) assert.equal(findTransactionControl(sql), keyword, sql);
});

test("事务控制语句：注释、字符串、标识符、函数体里的不算；savepoint 允许", () => {
  const allowed = [
    "",
    "create table a (id int primary key);",
    "-- commit;\nselect 1;",
    "/* begin; commit; */ select 1;",
    "select 'commit; rollback;';",
    "comment on table a is '先 begin; 再 commit;';",
    'create table "commit" (id int); select 1 from "commit";',
    "create function bump(n int) returns int language plpgsql as $$ begin return n + 1; end; $$;",
    "create function f() returns void language plpgsql as $fn$ begin perform 1; exception when others then null; end; $fn$;",
    "do $$ begin perform 1; end $$;",
    "savepoint s; select 1; rollback to savepoint s; release savepoint s;",
    "savepoint s; rollback to s; rollback work to savepoint s; rollback transaction to s;",
    "create function g() returns int language sql begin atomic select 1; select 2; end;\nselect 1;",
    "create table commit_log (id int); select endpoint, beginning from commit_log;",
    "set local search_path to pg_catalog;\nselect 1;",
  ];
  for (const sql of allowed) assert.equal(findTransactionControl(sql), null, sql);
});

test("begin atomic 函数体结束之后的 commit 仍然会被找出来", () => {
  assert.equal(
    findTransactionControl("create function g() returns int language sql begin atomic select 1; end; commit;"),
    "commit",
  );
});

test("迁移文件里有事务控制语句：构建列表时报 MIGRATION_TRANSACTION_CONTROL，并指出文件和关键字", () => {
  assert.throws(
    () =>
      buildMigrationFiles([
        { fileName: "0001_a.sql", sql: "create table a (id int);" },
        { fileName: "0002_b.sql", sql: "create table b (id int);\ncommit;" },
      ]),
    (err: unknown) =>
      err instanceof MigrationError &&
      err.code === "MIGRATION_TRANSACTION_CONTROL" &&
      err.message.includes("0002_b.sql") &&
      err.message.includes("commit"),
  );
});
