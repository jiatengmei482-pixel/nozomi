/**
 * 已经在运行的库升级到迁移 0006（M0-12，ADR 0013）：先把库停在 0005、写入已有账号，再执行 0006。
 * 已有账号的「必须先修改密码」标记都是 false，登录不受影响；
 * 权限不用调整——应用账号经平台角色、租户角色读写这个新列，登录前角色仍然读不到这两张表。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { hashPassword } from "./auth/password.ts";
import { withPlatformTx, withPreAuthTx, withTenantTx } from "./db/context.ts";
import { loadMigrationFiles, runMigrations } from "./db/migrate.ts";
import type { MigrationFile } from "./db/migration-plan.ts";
import { findPlatformUserByEmail, setPlatformUserPassword } from "./repos/platform-users.ts";
import { findTenantUserSecrets, setTenantUserPassword } from "./repos/tenant-users.ts";
import { type TestDatabase, createTestDatabase, deniedByDatabase } from "./testing/db.ts";

const MIGRATION = 6;

let db: TestDatabase;
let files: MigrationFile[];
const tenantId = randomUUID();
const otherTenantId = randomUUID();
const userId = randomUUID();
const otherUserId = randomUUID();
let passwordHash: string;

before(async () => {
  db = await createTestDatabase();
  files = await loadMigrationFiles();
  passwordHash = await hashPassword("Before-Upgrade-2026");
  await runMigrations(db.owner, files.filter((file) => file.version < MIGRATION));
  await db.owner.query(
    "insert into platform_users (email, name, role, status, password_hash) values ('old@platform.test', '老员工', 'super_admin', 'active', $1), ('pending@platform.test', '待激活', 'finance', 'invited', null)",
    [passwordHash],
  );
  await db.owner.query("insert into tenants (id, name, status) values ($1, '升级前的车队', 'active'), ($2, '另一个车队', 'active')", [tenantId, otherTenantId]);
  await db.owner.query(
    `insert into tenant_users (tenant_id, id, email, name, role, status, password_hash)
     values ($1, $2, 'old@fleet.test', '老用户', 'admin', 'active', $5), ($3, $4, 'old@other.test', '别家的老用户', 'admin', 'active', $5)`,
    [tenantId, userId, otherTenantId, otherUserId, passwordHash],
  );
});
after(() => db.drop());

test("迁移 0006 之前没有这一列；执行之后两张表各多一个非空、默认 false 的布尔列，已有账号全部是 false，其他字段原样", async () => {
  await assert.rejects(db.owner.query("select must_change_password from platform_users"), { code: "42703" });
  const before = (await db.owner.query("select email, status, password_hash from platform_users union all select email, status, password_hash from tenant_users order by 1")).rows;

  const result = await runMigrations(db.owner, files);
  assert.deepEqual(result.applied.map((file) => file.version).filter((version) => version === MIGRATION), [MIGRATION]);

  const columns = await db.owner.query(
    `select table_name, data_type, is_nullable, column_default from information_schema.columns
      where table_schema = current_schema() and column_name = 'must_change_password' order by 1`,
  );
  assert.deepEqual(columns.rows, [
    { table_name: "platform_users", data_type: "boolean", is_nullable: "NO", column_default: "false" },
    { table_name: "tenant_users", data_type: "boolean", is_nullable: "NO", column_default: "false" },
  ]);
  const flags = await db.owner.query(
    "select email, must_change_password from platform_users union all select email, must_change_password from tenant_users order by 1",
  );
  assert.deepEqual(flags.rows.map((row) => row.must_change_password), [false, false, false, false]);
  const after = (await db.owner.query("select email, status, password_hash from platform_users union all select email, status, password_hash from tenant_users order by 1")).rows;
  assert.deepEqual(after, before);
});

test("权限不用调整：平台角色读写平台账号的标记，租户角色只读写得到自己租户用户的标记，登录前角色仍然读不到；没有列级授权", async () => {
  const platform = await withPlatformTx(db.pool, (tx) => findPlatformUserByEmail(tx, "old@platform.test"));
  assert.equal(platform?.user.mustChangePassword, false);
  await withPlatformTx(db.pool, (tx) => setPlatformUserPassword(tx, platform?.user.id as string, passwordHash, true, new Date()));
  assert.equal((await withPlatformTx(db.pool, (tx) => findPlatformUserByEmail(tx, "old@platform.test")))?.user.mustChangePassword, true);

  await db.owner.query("update tenant_users set must_change_password = true");
  const own = await withTenantTx(db.pool, tenantId, (tx) => findTenantUserSecrets(tx, tenantId, userId));
  assert.equal(own?.user.mustChangePassword, true);
  // 租户事务里清自己的标记可以；隔着租户去清别人的，一行都碰不到
  await withTenantTx(db.pool, tenantId, (tx) => setTenantUserPassword(tx, tenantId, userId, passwordHash, new Date()));
  await withTenantTx(db.pool, tenantId, (tx) => setTenantUserPassword(tx, otherTenantId, otherUserId, passwordHash, new Date()));
  const touched = await withTenantTx(db.pool, tenantId, (tx) => tx.query("update tenant_users set must_change_password = false where id = $1", [otherUserId]));
  assert.equal(touched.rowCount, 0);
  assert.equal((await withTenantTx(db.pool, tenantId, (tx) => findTenantUserSecrets(tx, otherTenantId, otherUserId))), null);
  const flags = await db.owner.query("select email, must_change_password from tenant_users order by email");
  assert.deepEqual(flags.rows, [
    { email: "old@fleet.test", must_change_password: false },
    { email: "old@other.test", must_change_password: true },
  ]);

  await assert.rejects(withPreAuthTx(db.pool, (tx) => tx.query("select must_change_password from tenant_users")), deniedByDatabase);
  await assert.rejects(withPreAuthTx(db.pool, (tx) => tx.query("select must_change_password from platform_users")), deniedByDatabase);
  await assert.rejects(db.pool.query("select must_change_password from platform_users"), deniedByDatabase);
  const columnGrants = await db.owner.query(
    `select att.attname from pg_attribute att join pg_class c on c.oid = att.attrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = current_schema() and att.attacl is not null`,
  );
  assert.deepEqual(columnGrants.rows, []);
});

test("约束：没设过密码的账号不能带标记（平台和租户两张表）", async () => {
  await assert.rejects(db.owner.query("update platform_users set must_change_password = true where email = 'pending@platform.test'"), {
    code: "23514",
    constraint: "platform_users_must_change_needs_password",
  });
  await assert.rejects(
    db.owner.query(
      "insert into tenant_users (tenant_id, email, name, role, status, must_change_password) values ($1, 'new@fleet.test', '新人', 'admin', 'invited', true)",
      [tenantId],
    ),
    { code: "23514", constraint: "tenant_users_must_change_needs_password" },
  );
});
