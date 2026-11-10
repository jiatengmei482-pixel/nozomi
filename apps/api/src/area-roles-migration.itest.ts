/**
 * M8-20 迁移 0290（ADR 0075 第三部分）：已经有区域的库升级之后，每个已有区域都是「运营 + 报价」，其余各列、图形一个字节不变；
 * 加完列马上去掉默认值（之后新建区域必须由应用写明用途）；用途只能是三种之一。空库上从头执行由所有集成测试的建库覆盖。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadMigrationFiles, runMigrations } from "./db/migrate.ts";
import type { MigrationFile } from "./db/migration-plan.ts";
import { type TestDatabase, createTestDatabase } from "./testing/db.ts";

const AREA_ROLES_MIGRATION = 290;

let db: TestDatabase;
let files: MigrationFile[];
const tenantId = randomUUID();
const cityId = randomUUID();
const areaIds = [randomUUID(), randomUUID()];

/** 区域、图形表除 role 以外的全部内容（按编号排好的文本），迁移前后逐字比 */
async function areaDump(): Promise<string> {
  const areas = await db.owner.query("select tenant_id, id, city_id, name, name_keys, biz_type, status, version, created_at, updated_at from areas order by id");
  const polygons = await db.owner.query("select * from area_polygons order by id");
  return JSON.stringify([areas.rows, polygons.rows]);
}

before(async () => {
  db = await createTestDatabase();
  files = await loadMigrationFiles();
  await runMigrations(db.owner, files.filter((file) => file.version < AREA_ROLES_MIGRATION));
  await db.owner.query("insert into tenants (id, name, status) values ($1, '迁移前的车队', 'active')", [tenantId]);
  await db.owner.query("insert into cities (id, code, country_code, name, timezone, center_lng, center_lat, status, created_at, updated_at) values ($1, 'CTY-JP-TYO', 'JP', '{\"zh\": \"东京\"}', 'Asia/Tokyo', 139.6917, 35.6895, 'active', now(), now())", [cityId]);
  for (const [index, id] of areaIds.entries()) {
    await db.owner.query(
      "insert into areas (tenant_id, id, city_id, name, name_keys, biz_type, status, created_at, updated_at) values ($1, $2, $3, $4::jsonb, $5, $6, $7, now(), now())",
      [tenantId, id, cityId, JSON.stringify({ zh: `区域${index}` }), [`区域${index}`], index === 0 ? "general" : "charter", index === 0 ? "active" : "disabled"],
    );
    await db.owner.query(
      `insert into area_polygons (tenant_id, area_id, kind, seq, position, source, geometry, vertex_count, min_lng, min_lat, max_lng, max_lat)
       values ($1, $2, 'operate', 1, 0, 'drawn', '{"type": "Polygon", "coordinates": [[[139, 35], [140, 35], [140, 36], [139, 35]]]}'::jsonb, 3, 139, 35, 140, 36)`,
      [tenantId, id],
    );
  }
});
after(() => db.drop());

test("迁移 0290：已有区域全部成为「运营 + 报价」，其余各列和图形不变；默认值随即去掉；用途只能是三种之一", async () => {
  const before = await areaDump();
  await runMigrations(db.owner, files);
  assert.equal(await areaDump(), before, "区域、图形一个字节不变");
  assert.deepEqual((await db.owner.query("select role, count(*)::int as n from areas group by role")).rows, [{ role: "both", n: 2 }]);
  const column = (await db.owner.query("select is_nullable, column_default from information_schema.columns where table_schema = $1 and table_name = 'areas' and column_name = 'role'", [db.schema])).rows[0];
  assert.deepEqual(column, { is_nullable: "NO", column_default: null });
  await assert.rejects(
    db.owner.query("insert into areas (tenant_id, city_id, name, name_keys, biz_type, status, created_at, updated_at) values ($1, $2, '{\"zh\": \"新\"}', '{新}', 'general', 'active', now(), now())", [tenantId, cityId]),
    { code: "23502" },
    "不写用途不能新建",
  );
  await assert.rejects(db.owner.query("update areas set role = 'everything' where id = $1", [areaIds[0]]), { code: "23514" });
  // 迁移不写任何业务数据：未覆盖需求的三张表是空的
  for (const table of ["uncovered_demands", "uncovered_demand_limits", "uncovered_demand_drops"]) assert.equal((await db.owner.query(`select count(*)::int as n from ${table}`)).rows[0].n, 0, table);
});
