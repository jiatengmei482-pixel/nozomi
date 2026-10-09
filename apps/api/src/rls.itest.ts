/**
 * 行级安全（RLS）是租户隔离的第二道防线（ADR 0003、ADR 0009）。
 * 这里绕过数据访问层，直接在租户事务里执行「漏写 tenant_id 条件」的 SQL，证明数据库自己拦得住。
 * 测试里的应用代码用的是和线上一样的应用账号（ADR 0010）：它自己没有任何表权限，租户事务切换到 nozomi_app，
 * 平台事务切换到 nozomi_platform。摆数据、核对结果用迁移账号（api.db.owner）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { PLATFORM_ROLES, TENANT_ROLES } from "@nozomi/domain";
import { APP_DB_ROLE, withPlatformTx, withTenantTx } from "./db/context.ts";
import { insertAuditLog } from "./repos/audit-logs.ts";
import { type TenantFixture, type TestApi, createTestApi } from "./testing/api.ts";
import { deniedByDatabase } from "./testing/db.ts";

let api: TestApi;
let a: TenantFixture;
let b: TenantFixture;

before(async () => {
  api = await createTestApi();
  const platformToken = await api.superAdminToken();
  a = await api.tenantWithAdmin(platformToken, "车队甲", "admin@a.test");
  b = await api.tenantWithAdmin(platformToken, "车队乙", "admin@b.test");
});
after(() => api.close());

const inTenantA = <T>(fn: Parameters<typeof withTenantTx<T>>[2]): Promise<T> => withTenantTx(api.db.pool, a.tenantId, fn);

test("前提：库里确实有两个租户的数据——平台事务看得到全部租户；应用账号不切换角色时一张表都读不了", async () => {
  const rows = await withPlatformTx(api.db.pool, (db) => db.query("select tenant_id from tenant_users"));
  assert.deepEqual(new Set(rows.rows.map((r) => r.tenant_id)), new Set([a.tenantId, b.tenantId]));
  await assert.rejects(api.db.pool.query("select tenant_id from tenant_users"), deniedByDatabase);
});

test("租户事务里不带任何条件地查：只看得到自己租户的用户、会话、审计日志和租户行", async () => {
  await inTenantA(async (db) => {
    for (const table of ["tenant_users", "tenant_sessions", "audit_logs"]) {
      const rows = await db.query(`select tenant_id from ${table}`);
      assert.ok(rows.rows.length > 0, `${table} 应该有租户甲的数据`);
      assert.ok(rows.rows.every((r) => r.tenant_id === a.tenantId), `${table} 漏出了别的租户的行`);
    }
    const tenants = await db.query("select id from tenants");
    assert.deepEqual(tenants.rows.map((r) => r.id), [a.tenantId]);
  });
});

test("租户事务里按编号直接查、改、删别的租户的行：一行都碰不到", async () => {
  await inTenantA(async (db) => {
    const read = await db.query("select id from tenant_users where id = $1", [b.adminId]);
    assert.equal(read.rows.length, 0);
    const updated = await db.query("update tenant_users set name = '被改了', role = 'readonly' where id = $1", [b.adminId]);
    assert.equal(updated.rowCount, 0);
    const updatedAll = await db.query("update tenant_users set name = name");
    assert.equal(updatedAll.rowCount, 1, "不带条件的 update 只应该影响自己租户的行");
    const deleted = await db.query("delete from tenant_sessions");
    assert.equal(deleted.rowCount, 1, "不带条件的 delete 只应该影响自己租户的行");
    throw new RollbackForTest();
  }).catch(ignoreRollback);

  const untouched = await withPlatformTx(api.db.pool, (db) =>
    db.query("select name, role from tenant_users where id = $1", [b.adminId]),
  );
  assert.deepEqual(untouched.rows[0], { name: "车队乙管理员", role: "admin" });
  const me = await api.call("GET", "/tenant/v1/auth/me", { token: b.adminToken });
  assert.equal(me.status, 200, "租户乙的会话应该还在");
});

class RollbackForTest extends Error {}
function ignoreRollback(err: unknown): void {
  if (!(err instanceof RollbackForTest)) throw err;
}

test("租户事务里往别的租户写数据（用户、会话、审计日志）、或把自己的行改到别的租户名下：数据库拒绝", async () => {
  const attempts: [string, unknown[]][] = [
    [
      "insert into tenant_users (tenant_id, email, name, role, status) values ($1, 'spy@a.test', '卧底', 'admin', 'invited')",
      [b.tenantId],
    ],
    [
      "insert into tenant_sessions (tenant_id, id, user_id, created_at, expires_at) values ($1, gen_random_uuid(), $2, now(), now() + interval '1 hour')",
      [b.tenantId, b.adminId],
    ],
    [
      "insert into audit_logs (occurred_at, tenant_id, actor_type, source, resource, action) values (now(), $1, 'tenant_user', 'console', 'tenant_user', 'login')",
      [b.tenantId],
    ],
    ["update tenant_users set tenant_id = $1", [b.tenantId]],
  ];
  for (const [sql, values] of attempts) {
    await assert.rejects(inTenantA((db) => db.query(sql, values)), { code: "42501" }, sql);
  }
});

test("租户事务不能写平台级（tenant_id 为空）的审计日志，也读不到平台级的审计日志", async () => {
  await assert.rejects(
    inTenantA((db) =>
      insertAuditLog(
        db,
        { occurredAt: new Date(), actor: { type: "tenant_user", id: a.adminId, email: null }, ip: null, source: "console" },
        { tenantId: null, resource: "platform_user", resourceId: null, action: "login", before: null, after: null },
      ),
    ),
    { code: "42501" },
  );
  const visible = await inTenantA((db) => db.query("select count(*)::int as n from audit_logs where tenant_id is null"));
  assert.equal(visible.rows[0]?.["n"], 0);
});

test("应用角色碰不到平台表，也改不了租户主体和审计日志", async () => {
  const denied = [
    "select * from platform_users",
    "select * from platform_sessions",
    "select * from login_throttles",
    "select * from schema_migrations",
    "update tenants set status = 'active'",
    "insert into tenants (name, status) values ('自建租户', 'active')",
    "delete from tenant_users",
    "update audit_logs set action = 'login'",
    "delete from audit_logs",
    "truncate tenant_users cascade",
    "alter table tenant_users disable row level security",
  ];
  for (const sql of denied) {
    await assert.rejects(inTenantA((db) => db.query(sql)), { code: "42501" }, sql);
  }
});

test("没有设置租户（或设成空串）的应用角色：一行都看不到，也不报错", async () => {
  const client = await api.db.pool.connect();
  try {
    for (const setTenant of [null, "select set_config('app.tenant_id', '', true)"]) {
      await client.query("begin");
      await client.query(`set local role ${APP_DB_ROLE}`);
      if (setTenant) await client.query(setTenant);
      for (const table of ["tenant_users", "tenant_sessions", "tenants", "audit_logs"]) {
        const rows = await client.query(`select 1 from ${table}`);
        assert.equal(rows.rows.length, 0, table);
      }
      await client.query("rollback");
    }
  } finally {
    client.release();
  }
});

test("角色和租户设置只在事务内有效：连接还回连接池后不残留，回滚的事务也一样", async () => {
  const single = api.db.pool;
  await withTenantTx(single, a.tenantId, (db) => db.query("select 1"));
  await withTenantTx(single, a.tenantId, async () => {
    throw new RollbackForTest();
  }).catch(ignoreRollback);
  const clients = await Promise.all(Array.from({ length: 5 }, () => single.connect()));
  try {
    for (const client of clients) {
      const state = await client.query(
        "select current_user = session_user as same_role, coalesce(current_setting('app.tenant_id', true), '') as tenant",
      );
      assert.deepEqual(state.rows[0], { same_role: true, tenant: "" });
    }
  } finally {
    for (const client of clients) client.release();
  }
});

test("结构检查：每张带 tenant_id 的表都开启了行级安全并且有策略；应用角色不是超级用户、不能绕过行级安全、不能登录", async () => {
  const tables = await api.db.owner.query<{ table_name: string; rls: boolean; policies: number }>(
    `select c.relname as table_name, c.relrowsecurity as rls,
            (select count(*)::int from pg_policy p where p.polrelid = c.oid) as policies
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = current_schema() and c.relkind = 'r'
        and exists (select 1 from pg_attribute att
                     where att.attrelid = c.oid and att.attname = 'tenant_id' and not att.attisdropped)
      order by 1`,
  );
  assert.deepEqual(tables.rows.map((r) => r.table_name), [
    "adjust_rules", "area_polygons", "areas", "audit_logs", "brands", "idempotency_keys", "price_rules", "product_areas", "product_dispatchers", "product_vehicle_groups", "products", "tenant_sessions", "tenant_users",
  ]);
  for (const table of tables.rows) {
    assert.equal(table.rls, true, `${table.table_name} 没有开启行级安全`);
    assert.ok(table.policies >= 1, `${table.table_name} 没有策略`);
  }
  const role = await api.db.owner.query("select rolsuper, rolbypassrls, rolcanlogin from pg_roles where rolname = $1", [
    APP_DB_ROLE,
  ]);
  assert.deepEqual(role.rows[0], { rolsuper: false, rolbypassrls: false, rolcanlogin: false });
  const owned = await api.db.owner.query(
    `select count(*)::int as n from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = current_schema() and pg_get_userbyid(c.relowner) = $1`,
    [APP_DB_ROLE],
  );
  assert.equal(owned.rows[0].n, 0, "应用角色不能是任何表的所有者（所有者不受行级安全限制）");
});

test("结构检查：每张租户表的主键和普通索引都以 tenant_id 开头（两个登录前定位用的唯一索引是 ADR 0009 记录的例外）", async () => {
  const indexes = await api.db.owner.query<{ table_name: string; index_name: string; first_column: string }>(
    `select t.relname as table_name, i.relname as index_name,
            (select att.attname from pg_attribute att where att.attrelid = t.oid and att.attnum = ix.indkey[0]) as first_column
       from pg_index ix
       join pg_class i on i.oid = ix.indexrelid
       join pg_class t on t.oid = ix.indrelid
       join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = current_schema() and t.relname in ('tenant_users', 'tenant_sessions')
      order by 1, 2`,
  );
  const exceptions = new Set(["tenant_users_email_key", "tenant_users_invite_token_key"]);
  const offenders = indexes.rows.filter((r) => r.first_column !== "tenant_id" && !exceptions.has(r.index_name));
  assert.deepEqual(offenders, []);
  assert.equal(indexes.rows.filter((r) => exceptions.has(r.index_name)).length, 2);
});

test("角色表的内容与代码里的角色清单一致（来源都是需求文档）", async () => {
  const platform = await api.db.owner.query("select key, name from platform_roles order by sort_order");
  assert.deepEqual(platform.rows, PLATFORM_ROLES.map(({ key, name }) => ({ key, name })));
  const tenant = await api.db.owner.query("select key, name from tenant_roles order by sort_order");
  assert.deepEqual(tenant.rows, TENANT_ROLES.map(({ key, name }) => ({ key, name })));
});
