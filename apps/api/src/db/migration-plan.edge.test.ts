/**
 * 迁移计划（纯计算部分）的边界值：文件名、编号、换行、记录与文件对不上的各种组合。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  type MigrationErrorCode,
  MigrationError,
  buildMigrationFiles,
  migrationChecksum,
  parseMigrationFileName,
  planMigrations,
} from "./migration-plan.ts";

function assertMigrationError(fn: () => unknown, code: MigrationErrorCode): void {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof MigrationError, `不是 MigrationError：${String(err)}`);
    assert.equal(err.code, code);
    return true;
  });
}

test("文件名的边界：0001 和 9999 合规；带路径、首尾空白、换行、中文、连续下划线、缺扩展名都不合规", () => {
  assert.deepEqual(parseMigrationFileName("0001_a.sql"), { version: 1, name: "a" });
  assert.deepEqual(parseMigrationFileName("9999_z9_final.sql"), { version: 9999, name: "z9_final" });
  const bad = [
    "",
    ".sql",
    "0001.sql",
    "_a.sql",
    "001_a.sql",
    "-001_a.sql",
    "0001_a",
    "0001_a.sql ",
    " 0001_a.sql",
    "0001_a.sql\n",
    "0001_a.sql.bak",
    "0001_a.sql.sql",
    "0001__a.sql",
    "0001_a b.sql",
    "0001_订单.sql",
    "../0001_a.sql",
    "dir/0001_a.sql",
    "0001_a.sql/../../x.sql",
    "１２３４_a.sql",
  ];
  for (const fileName of bad) {
    assertMigrationError(() => parseMigrationFileName(fileName), "MIGRATION_BAD_FILE_NAME");
  }
});

test("不合规文件名的报错里带上了文件名，方便定位", () => {
  assert.throws(() => parseMigrationFileName("add_table.sql"), /add_table\.sql/);
});

test("校验和：只把 CRLF 当成 LF；其他任何差异（行尾空格、末尾换行、大小写）都算不同", () => {
  const base = migrationChecksum("create table a (id int);\n");
  assert.equal(migrationChecksum("create table a (id int);\r\n"), base);
  assert.equal(migrationChecksum("a\r\n\r\nb"), migrationChecksum("a\n\nb"));
  assert.notEqual(migrationChecksum("create table a (id int);"), base);
  assert.notEqual(migrationChecksum("create table a (id int); \n"), base);
  assert.notEqual(migrationChecksum("CREATE table a (id int);\n"), base);
  assert.notEqual(migrationChecksum("create table a (id int);\n\n"), base);
});

test("校验和按 UTF-8 计算：中文注释不同则校验和不同", () => {
  assert.notEqual(migrationChecksum("-- 订单表\n"), migrationChecksum("-- 订単表\n"));
});

test("构建迁移列表：不改动传入的数组；一个文件名不合规就整体报错", () => {
  const inputs = [
    { fileName: "0003_c.sql", sql: "c" },
    { fileName: "0001_a.sql", sql: "a" },
  ];
  const files = buildMigrationFiles(inputs);
  assert.deepEqual(files.map((f) => f.fileName), ["0001_a.sql", "0003_c.sql"]);
  assert.deepEqual(inputs.map((f) => f.fileName), ["0003_c.sql", "0001_a.sql"]);
  assert.equal(files[0]?.checksum, migrationChecksum("a"));
  assertMigrationError(
    () => buildMigrationFiles([...inputs, { fileName: "bad.sql", sql: "" }]),
    "MIGRATION_BAD_FILE_NAME",
  );
});

test("三个文件里有两个编号相同（不相邻传入）：报 MIGRATION_DUPLICATE_VERSION，并指出是哪两个文件", () => {
  assert.throws(
    () =>
      buildMigrationFiles([
        { fileName: "0002_x.sql", sql: "" },
        { fileName: "0001_a.sql", sql: "" },
        { fileName: "0002_y.sql", sql: "" },
      ]),
    (err: unknown) =>
      err instanceof MigrationError &&
      err.code === "MIGRATION_DUPLICATE_VERSION" &&
      err.message.includes("0002_x.sql") &&
      err.message.includes("0002_y.sql"),
  );
});

const files = buildMigrationFiles([
  { fileName: "0001_a.sql", sql: "a" },
  { fileName: "0003_c.sql", sql: "c" },
  { fileName: "0007_g.sql", sql: "g" },
]);
const record = (version: number): { version: number; name: string; checksum: string } => {
  const file = files.find((f) => f.version === version);
  assert.ok(file);
  return { version: file.version, name: file.name, checksum: file.checksum };
};

test("编号有空洞：空库时全部待执行；执行到一半时只剩后面的", () => {
  assert.deepEqual(planMigrations(files, []).map((f) => f.version), [1, 3, 7]);
  assert.deepEqual(planMigrations(files, [record(1), record(3)]).map((f) => f.version), [7]);
});

test("已执行记录的顺序不影响结果", () => {
  assert.deepEqual(planMigrations(files, [record(3), record(1)]).map((f) => f.version), [7]);
  assert.deepEqual(planMigrations(files, [record(7), record(3), record(1)]), []);
});

test("新文件的编号等于「已执行最大编号 + 1」可以执行；小于最大编号的一律拒绝", () => {
  const withNext = buildMigrationFiles([...files, { fileName: "0008_h.sql", sql: "h" }]);
  assert.deepEqual(planMigrations(withNext, [record(1), record(3), record(7)]).map((f) => f.version), [8]);
  const withEarlier = buildMigrationFiles([...files, { fileName: "0006_f.sql", sql: "f" }]);
  assertMigrationError(() => planMigrations(withEarlier, [record(1), record(3), record(7)]), "MIGRATION_OUT_OF_ORDER");
});

test("数据库里有记录但一个迁移文件都没有（部署了错误的版本）：报 MIGRATION_FILE_MISSING", () => {
  assertMigrationError(() => planMigrations([], [record(1)]), "MIGRATION_FILE_MISSING");
});

test("同时存在多种问题时，按记录顺序报第一个，并且不返回任何待执行项", () => {
  const tampered = buildMigrationFiles([
    { fileName: "0001_a.sql", sql: "a 被改过" },
    { fileName: "0002_b.sql", sql: "b" },
    { fileName: "0007_g.sql", sql: "g" },
  ]);
  assertMigrationError(() => planMigrations(tampered, [record(1), record(3)]), "MIGRATION_CHECKSUM_MISMATCH");
});
