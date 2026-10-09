/**
 * 已经在运行的库升级到「两个账号」（ADR 0010）：迁移 0001~0004 时期，服务进程用所有者账号直接读写。
 * 这里先把库停在 0004、用所有者账号写入数据（相当于旧版本运行时留下的数据），再执行 0005，
 * 确认新版本用应用账号能接着用这些数据，而且在 0005 执行之前新版本不会报告健康。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "./app.ts";
import { withPlatformTx, withPreAuthTx, withTenantTx } from "./db/context.ts";
import { loadMigrationFiles, runMigrations } from "./db/migrate.ts";
import type { MigrationFile } from "./db/migration-plan.ts";
import { locateTenantUserByEmailAcrossTenants } from "./repos/tenant-users.ts";
import { type TestDatabase, createTestDatabase, deniedByDatabase } from "./testing/db.ts";
import { testConfig } from "./testing/fixtures.ts";

const FIRST_MIGRATION_WITH_SEPARATE_ACCOUNTS = 5;

let db: TestDatabase;
let files: MigrationFile[];
const tenantId = randomUUID();
const userId = randomUUID();

before(async () => {
  db = await createTestDatabase();
  files = await loadMigrationFiles();
  await runMigrations(db.owner, files.filter((file) => file.version < FIRST_MIGRATION_WITH_SEPARATE_ACCOUNTS));
  await db.owner.query("insert into tenants (id, name, status) values ($1, '升级前的车队', 'active')", [tenantId]);
  await db.owner.query(
    "insert into tenant_users (tenant_id, id, email, name, role, status) values ($1, $2, 'old@fleet.test', '老用户', 'admin', 'invited')",
    [tenantId, userId],
  );
  await db.owner.query(
    `insert into audit_logs (occurred_at, tenant_id, actor_type, source, resource, resource_id, action)
     values (now(), $1, 'platform_user', 'console', 'tenant', $2, 'create'), (now(), null, 'system', 'cli', 'platform_user', null, 'create')`,
    [tenantId, tenantId],
  );
});
after(() => db.drop());

async function health(): Promise<{ statusCode: number; body: any }> {
  const app = buildApp({ config: testConfig(db.url), pool: db.pool, migrationFiles: files, logger: false });
  try {
    const res = await app.inject({ method: "GET", url: "/health" });
    return { statusCode: res.statusCode, body: res.json() };
  } finally {
    await app.close();
  }
}

test("新版本先于迁移 0005 启动：平台事务和登录前事务还没有任何权限，/health 是 503，不会被当成部署成功", async () => {
  await assert.rejects(withPlatformTx(db.pool, (tx) => tx.query("select * from tenants")), deniedByDatabase);
  await assert.rejects(withPreAuthTx(db.pool, (tx) => tx.query("select * from login_throttles")), deniedByDatabase);
  // 定位函数是 0005 才建的：还不存在（42883）
  await assert.rejects(withPreAuthTx(db.pool, (tx) => locateTenantUserByEmailAcrossTenants(tx, "old@fleet.test")), { code: "42883" });
  await assert.rejects(db.pool.query("select * from tenants"), deniedByDatabase);
  // 租户角色 nozomi_app 从迁移 0002 起就有，它的权限不变：仍然只读得到自己租户
  const own = await withTenantTx(db.pool, tenantId, (tx) => tx.query("select email from tenant_users"));
  assert.deepEqual(own.rows, [{ email: "old@fleet.test" }]);
  const report = await health();
  assert.equal(report.statusCode, 503);
  assert.equal(report.body.database.state, "up");
  assert.notEqual(report.body.migrations.state, "up_to_date");
});

test("执行迁移 0005 之后：旧数据原样还在，应用账号经三个角色各自读得到该读的；审计日志一行不少且仍然改不了", async () => {
  const auditBefore = (await db.owner.query("select id, action, tenant_id from audit_logs order by id")).rows;
  const result = await runMigrations(db.owner, files);
  assert.ok(result.applied.some((file) => file.version === FIRST_MIGRATION_WITH_SEPARATE_ACCOUNTS));

  const report = await health();
  assert.equal(report.statusCode, 200, JSON.stringify(report.body));
  assert.equal(report.body.migrations.state, "up_to_date");

  const tenants = await withPlatformTx(db.pool, (tx) => tx.query("select id, name from tenants"));
  assert.deepEqual(tenants.rows, [{ id: tenantId, name: "升级前的车队" }]);
  assert.deepEqual(await withPreAuthTx(db.pool, (tx) => locateTenantUserByEmailAcrossTenants(tx, "old@fleet.test")), { tenantId, userId });
  const own = await withTenantTx(db.pool, tenantId, (tx) => tx.query("select email from tenant_users"));
  assert.deepEqual(own.rows, [{ email: "old@fleet.test" }]);
  const other = await withTenantTx(db.pool, randomUUID(), (tx) => tx.query("select email from tenant_users"));
  assert.deepEqual(other.rows, []);

  const audit = await withPlatformTx(db.pool, (tx) => tx.query("select id, action, tenant_id from audit_logs order by id"));
  assert.deepEqual(audit.rows, auditBefore);
  await assert.rejects(withPlatformTx(db.pool, (tx) => tx.query("delete from audit_logs")), { code: "42501" });
  await assert.rejects(withPlatformTx(db.pool, (tx) => tx.query("update audit_logs set action = 'x'")), { code: "42501" });
});
