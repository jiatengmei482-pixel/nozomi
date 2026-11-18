/**
 * M9E-14 迁移 0430（ADR 0090 第四节）：已有嵌入码里按旧默认值存下的 card 改成 auto（分不出是否特意选的，按「没选」处理），
 * 特意选的 bar 不变；其余各列（含版本号、修改时间）一个字节不变；默认值改成 auto；外观只能是 auto / card / bar。
 * 空库上从头执行由所有集成测试的建库覆盖。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { loadMigrationFiles, runMigrations } from "./db/migrate.ts";
import type { MigrationFile } from "./db/migration-plan.ts";
import { type TestDatabase, createTestDatabase } from "./testing/db.ts";

const LAYOUT_AUTO_MIGRATION = 430;

let db: TestDatabase;
let files: MigrationFile[];
const key = (letter: string): string => `nze_${letter.repeat(32)}`;

/** 嵌入码除 layout 以外的全部内容，迁移前后逐字比 */
async function keyDump(): Promise<string> {
  const rows = await db.owner.query("select id, key, name, allowed_origins, default_lang, default_services, status, note, version, created_at, updated_at, created_by, updated_by from embed_keys order by key");
  return JSON.stringify(rows.rows);
}

before(async () => {
  db = await createTestDatabase();
  files = await loadMigrationFiles();
  await runMigrations(db.owner, files.filter((file) => file.version < LAYOUT_AUTO_MIGRATION));
  const user = await db.owner.query<{ id: string }>("insert into platform_users (email, name, role, status) values ('ops@platform.test', '运营', 'super_admin', 'disabled') returning id");
  const by = user.rows[0]?.id;
  // A：0420 加列时按默认值填的 card；B：特意选的 bar；C：停用的 card
  for (const [letter, layout, status] of [["A", null, "active"], ["B", "bar", "active"], ["C", "card", "disabled"]] as const) {
    await db.owner.query(
      `insert into embed_keys (key, name, allowed_origins, default_lang, default_services, status, version, created_at, updated_at, created_by, updated_by${layout === null ? "" : ", layout"})
       values ($1, $2, array['https://partner.example'], 'zh', array['transfer', 'charter'], $3, 3, '2026-11-14T10:00:00Z', '2026-11-14T11:00:00Z', $4, $4${layout === null ? "" : ", $5"})`,
      [key(letter), `网站${letter}`, status, by, ...(layout === null ? [] : [layout])],
    );
  }
});
after(() => db.drop());

test("迁移 0430：已有的 card 改成 auto、bar 不变，其余各列不变；默认值改成 auto；外观只能是 auto / card / bar", async () => {
  assert.deepEqual((await db.owner.query("select key, layout from embed_keys order by key")).rows.map((row) => row.layout), ["card", "bar", "card"], "迁移前：没填的按旧默认值 card");
  const before = await keyDump();
  await runMigrations(db.owner, files);
  assert.equal(await keyDump(), before, "除外观外一个字节不变（版本号、修改时间也不动）");
  assert.deepEqual((await db.owner.query("select key, layout from embed_keys order by key")).rows.map((row) => [row.key, row.layout]), [
    [key("A"), "auto"],
    [key("B"), "bar"],
    [key("C"), "auto"],
  ]);
  const column = (await db.owner.query("select is_nullable, column_default from information_schema.columns where table_schema = $1 and table_name = 'embed_keys' and column_name = 'layout'", [db.schema])).rows[0];
  assert.deepEqual(column, { is_nullable: "NO", column_default: "'auto'::text" });
  await db.owner.query("update embed_keys set layout = 'card' where key = $1", [key("A")]);
  await assert.rejects(db.owner.query("update embed_keys set layout = 'banner' where key = $1", [key("A")]), { code: "23514" });
});
