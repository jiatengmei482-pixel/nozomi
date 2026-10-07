/**
 * 迁移 0001~0003 建出来的库的结构检查（验收标准 1、2；ADR 0003、ADR 0009）。全部遍历系统目录，不写死「现在有哪些租户表」：
 * - 空库执行完迁移后，除了系统定义的角色清单和迁移记录，每张表都是 0 行（没有预置账号、租户、任何数据）。
 * - 每张表要么在「平台表」名单里，要么必须开启行级安全并且策略把读、写都限定在当前租户。
 *   以后新增一张表而忘了开行级安全，这里会失败（最后一个测试验证了这一点确实会失败）。
 * - 应用角色的权限是一张精确的清单：以后多给了权限，这里会失败。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { APP_DB_ROLE } from "./db/context.ts";
import { loadMigrationFiles, runMigrations } from "./db/migrate.ts";
import type { Pool } from "./db/pool.ts";
import { type TestDatabase, createMigratedTestDatabase } from "./testing/db.ts";

/** 不属于任何租户的表：平台账号与会话、登录限速、迁移记录，以及两张系统定义的角色清单。新增平台表时加到这里。 */
const PLATFORM_TABLES = ["login_throttles", "platform_roles", "platform_sessions", "platform_users", "schema_migrations", "tenant_roles"];
/** 迁移写入的系统常量（不是业务数据）：角色清单。其余的表在空库里必须是 0 行。 */
const SEEDED_CONSTANTS: Readonly<Record<string, number>> = { platform_roles: 10, tenant_roles: 5 };
/** 应用角色在每张表上应有的权限，一项不多一项不少（ADR 0009「按最小权限授权」）。 */
const APP_ROLE_GRANTS: Readonly<Record<string, string[]>> = {
  audit_logs: ["INSERT", "SELECT"],
  tenant_roles: ["SELECT"],
  tenant_sessions: ["DELETE", "INSERT", "SELECT"],
  tenant_users: ["INSERT", "SELECT", "UPDATE"],
  tenants: ["SELECT"],
};
/** 不以 tenant_id 开头的索引：ADR 0009「有意的例外」里逐条说明过的。 */
const INDEX_EXCEPTIONS = [
  "audit_logs_actor_idx",
  "audit_logs_occurred_idx",
  "audit_logs_pkey",
  "audit_logs_resource_idx",
  "tenant_users_email_key",
  "tenant_users_invite_token_key",
];

let db: TestDatabase;
before(async () => {
  db = await createMigratedTestDatabase();
});
after(() => db.drop());

async function tableNames(pool: Pool): Promise<string[]> {
  const rows = await pool.query<{ name: string }>(
    `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = current_schema() and c.relkind in ('r', 'p') order by 1`,
  );
  return rows.rows.map((row) => row.name);
}

/**
 * 找出隔离有漏洞的表：不在平台表名单里，却没开行级安全、没有策略，或者策略没有把读 / 写限定在当前租户。
 * 返回「表名：问题」的列表；没有问题时为空。
 */
async function isolationProblems(pool: Pool): Promise<string[]> {
  const tables = await pool.query<{ name: string; rls: boolean; has_tenant_id: boolean }>(
    `select c.relname as name, c.relrowsecurity as rls,
            exists (select 1 from pg_attribute att where att.attrelid = c.oid and att.attname = 'tenant_id' and not att.attisdropped) as has_tenant_id
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = current_schema() and c.relkind in ('r', 'p')
      order by 1`,
  );
  const policies = await pool.query<{ table_name: string; name: string; cmd: string; permissive: boolean; using_expr: string | null; check_expr: string | null }>(
    `select c.relname as table_name, p.polname as name, p.polcmd as cmd, p.polpermissive as permissive,
            pg_get_expr(p.polqual, p.polrelid) as using_expr, pg_get_expr(p.polwithcheck, p.polrelid) as check_expr
       from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = current_schema()`,
  );
  const problems: string[] = [];
  for (const table of tables.rows) {
    if (PLATFORM_TABLES.includes(table.name)) {
      if (table.has_tenant_id) problems.push(`${table.name}：在平台表名单里却带 tenant_id`);
      continue;
    }
    // 租户主体表用自己的 id 当租户编号，其余租户表用 tenant_id 列
    const column = table.name === "tenants" ? "id" : "tenant_id";
    if (column === "tenant_id" && !table.has_tenant_id) problems.push(`${table.name}：不是平台表却没有 tenant_id 列`);
    if (!table.rls) problems.push(`${table.name}：没有开启行级安全`);
    const own = policies.rows.filter((policy) => policy.table_name === table.name);
    if (own.length === 0) problems.push(`${table.name}：没有策略`);
    const scoped = `(${column} = app_tenant_id())`;
    for (const policy of own) {
      // 放行类策略之间是「或」的关系：只要有一条写宽了，整张表就漏了，所以每一条都必须限定在当前租户
      const reads = policy.cmd !== "a";
      const writes = policy.cmd !== "r" && policy.cmd !== "d";
      if (!policy.permissive) continue;
      if (reads && policy.using_expr !== scoped) problems.push(`${table.name}：策略 ${policy.name} 的 using 是 ${policy.using_expr}`);
      if (writes && policy.check_expr !== scoped) problems.push(`${table.name}：策略 ${policy.name} 的 with check 是 ${policy.check_expr}`);
    }
  }
  return problems;
}

test("空库执行完全部迁移：除角色清单和迁移记录外，每张表都是 0 行——没有预置的账号、租户、会话、审计记录", async () => {
  const files = await loadMigrationFiles();
  assert.ok(files.length >= 3);
  const counts: Record<string, number> = {};
  for (const table of await tableNames(db.pool)) {
    counts[table] = (await db.pool.query(`select count(*)::int as n from ${table}`)).rows[0].n;
  }
  const expected = Object.fromEntries(Object.keys(counts).map((table) => [table, SEEDED_CONSTANTS[table] ?? 0]));
  expected["schema_migrations"] = files.length;
  assert.deepEqual(counts, expected);
  for (const table of ["platform_users", "platform_sessions", "tenants", "tenant_users", "tenant_sessions", "audit_logs", "login_throttles"]) {
    assert.equal(counts[table], 0, `${table} 应当存在且为空`);
  }
});

test("迁移重复执行：第二次什么都不做，结构和数据不变", async () => {
  const describe = async (): Promise<unknown> => ({
    columns: (await db.pool.query("select table_name, column_name, data_type, is_nullable from information_schema.columns where table_schema = current_schema() order by 1, 2")).rows,
    policies: (await db.pool.query("select polname from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = current_schema() order by 1")).rows,
    roles: (await db.pool.query("select key from platform_roles union all select key from tenant_roles order by 1")).rows,
    migrations: (await db.pool.query("select count(*)::int as n from schema_migrations")).rows,
  });
  const before = await describe();
  const again = await runMigrations(db.pool, await loadMigrationFiles());
  assert.deepEqual(again.applied, []);
  assert.deepEqual(await describe(), before);
});

test("每张表要么是登记过的平台表，要么开启了行级安全且每条策略都把读和写限定在当前租户", async () => {
  assert.deepEqual(await isolationProblems(db.pool), []);
  const tables = await tableNames(db.pool);
  for (const table of PLATFORM_TABLES) assert.ok(tables.includes(table), `平台表名单里的 ${table} 不存在，名单该更新了`);
});

test("每张租户表：tenant_id 非空（审计日志除外，空表示平台级操作）、主键和索引以 tenant_id 开头（ADR 0009 的例外逐个列出）、租户表之间的外键带着 tenant_id", async () => {
  const columns = await db.pool.query<{ table_name: string; not_null: boolean }>(
    `select c.relname as table_name, att.attnotnull as not_null
       from pg_attribute att join pg_class c on c.oid = att.attrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = current_schema() and c.relkind in ('r', 'p') and att.attname = 'tenant_id' and not att.attisdropped
      order by 1`,
  );
  assert.ok(columns.rows.length >= 3);
  assert.deepEqual(columns.rows.filter((row) => !row.not_null).map((row) => row.table_name), ["audit_logs"]);
  const tenantTables = columns.rows.map((row) => row.table_name);

  const indexes = await db.pool.query<{ table_name: string; index_name: string; first_column: string; is_primary: boolean }>(
    `select t.relname as table_name, i.relname as index_name, ix.indisprimary as is_primary,
            (select att.attname from pg_attribute att where att.attrelid = t.oid and att.attnum = ix.indkey[0]) as first_column
       from pg_index ix join pg_class i on i.oid = ix.indexrelid join pg_class t on t.oid = ix.indrelid
       join pg_namespace n on n.oid = t.relnamespace
      where n.nspname = current_schema() and t.relname = any($1::text[])
      order by 1, 2`,
    [tenantTables],
  );
  const notLeading = indexes.rows.filter((row) => row.first_column !== "tenant_id").map((row) => row.index_name);
  assert.deepEqual(notLeading, INDEX_EXCEPTIONS);
  for (const table of tenantTables) {
    assert.ok(indexes.rows.some((row) => row.table_name === table && row.first_column === "tenant_id"), `${table} 没有以 tenant_id 开头的索引`);
    if (table !== "audit_logs") {
      assert.ok(indexes.rows.some((row) => row.table_name === table && row.is_primary && row.first_column === "tenant_id"), `${table} 的主键不以 tenant_id 开头`);
    }
  }

  const foreignKeys = await db.pool.query<{ name: string; from_table: string; to_table: string; columns: string[] }>(
    `select con.conname as name, src.relname as from_table, dst.relname as to_table,
            (select array_agg(att.attname::text order by k.ord)
               from unnest(con.conkey) with ordinality as k(attnum, ord)
               join pg_attribute att on att.attrelid = con.conrelid and att.attnum = k.attnum) as columns
       from pg_constraint con join pg_class src on src.oid = con.conrelid join pg_class dst on dst.oid = con.confrelid
       join pg_namespace n on n.oid = src.relnamespace
      where n.nspname = current_schema() and con.contype = 'f'`,
  );
  const crossTenantCapable = foreignKeys.rows.filter(
    (fk) => tenantTables.includes(fk.from_table) && tenantTables.includes(fk.to_table) && !fk.columns.includes("tenant_id"),
  );
  assert.deepEqual(crossTenantCapable, [], "租户表之间的外键不带 tenant_id，就可能指向别的租户的行");
});

test("应用角色的权限清单一项不多一项不少：碰不到平台表，不能建对象，不属于任何别的角色；库里没有以定义者身份执行的函数", async () => {
  const grants = await db.pool.query<{ table_name: string; privilege_type: string }>(
    `select table_name, privilege_type from information_schema.role_table_grants
      where grantee = $1 and table_schema = current_schema() order by 1, 2`,
    [APP_DB_ROLE],
  );
  const actual: Record<string, string[]> = {};
  for (const row of grants.rows) (actual[row.table_name] ??= []).push(row.privilege_type);
  assert.deepEqual(actual, APP_ROLE_GRANTS);

  const columnGrants = await db.pool.query(
    `select table_name, column_name, privilege_type from information_schema.column_privileges
      where grantee = $1 and table_schema = current_schema()
        and (table_name, privilege_type) not in (select table_name, privilege_type from information_schema.role_table_grants where grantee = $1 and table_schema = current_schema())`,
    [APP_DB_ROLE],
  );
  assert.deepEqual(columnGrants.rows, [], "有列级别的额外授权");
  const publicGrants = await db.pool.query("select table_name, privilege_type from information_schema.role_table_grants where grantee = 'PUBLIC' and table_schema = current_schema()");
  assert.deepEqual(publicGrants.rows, [], "有授给所有人（PUBLIC）的表权限");

  const role = await db.pool.query(
    `select rolsuper, rolbypassrls, rolcanlogin, rolcreaterole, rolcreatedb, rolreplication, rolinherit is not null as present,
            rolpassword is null as no_password,
            has_schema_privilege($1, current_schema(), 'CREATE') as can_create,
            (select count(*)::int from pg_auth_members m where m.member = a.oid) as member_of
       from pg_authid a where rolname = $1`,
    [APP_DB_ROLE],
  ).catch(() => null);
  if (role !== null) {
    assert.deepEqual(role.rows[0], {
      rolsuper: false, rolbypassrls: false, rolcanlogin: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false,
      present: true, no_password: true, can_create: false, member_of: 0,
    });
  } else {
    // 连接账号不是超级用户时读不了 pg_authid：退而用 pg_roles（看不到密码这一项）
    const visible = await db.pool.query("select rolsuper, rolbypassrls, rolcanlogin, rolcreaterole, rolcreatedb from pg_roles where rolname = $1", [APP_DB_ROLE]);
    assert.deepEqual(visible.rows[0], { rolsuper: false, rolbypassrls: false, rolcanlogin: false, rolcreaterole: false, rolcreatedb: false });
  }

  const definerFunctions = await db.pool.query(
    "select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = current_schema() and p.prosecdef",
  );
  assert.deepEqual(definerFunctions.rows, [], "以定义者身份执行的函数会绕过行级安全");
});

test("检查本身是有效的：新增一张表而忘了开行级安全、只开不建策略、策略写成放行全部、只限读不限写，都会被上面的检查发现", async () => {
  const client = await db.pool.connect();
  try {
    const problemsWith = async (ddl: string[]): Promise<string[]> => {
      await client.query("begin");
      try {
        for (const sql of ddl) await client.query(sql);
        // 在同一个事务里检查，然后回滚：不给别的测试留下任何结构改动
        return await isolationProblems(client as unknown as Pool);
      } finally {
        await client.query("rollback");
      }
    };
    const create = "create table itest_orders (tenant_id uuid not null, id uuid not null, primary key (tenant_id, id))";
    assert.deepEqual(await problemsWith([create]), ["itest_orders：没有开启行级安全", "itest_orders：没有策略"]);
    assert.deepEqual(await problemsWith([create, "alter table itest_orders enable row level security"]), ["itest_orders：没有策略"]);
    assert.deepEqual(
      await problemsWith([create, "alter table itest_orders enable row level security", "create policy p on itest_orders using (true)"]),
      ["itest_orders：策略 p 的 using 是 true", "itest_orders：策略 p 的 with check 是 null"],
    );
    assert.deepEqual(
      await problemsWith([
        create,
        "alter table itest_orders enable row level security",
        "create policy p on itest_orders using (tenant_id = app_tenant_id()) with check (true)",
      ]),
      ["itest_orders：策略 p 的 with check 是 true"],
    );
    assert.deepEqual(
      await problemsWith(["create table itest_no_tenant (id uuid primary key)"]),
      ["itest_no_tenant：不是平台表却没有 tenant_id 列", "itest_no_tenant：没有开启行级安全", "itest_no_tenant：没有策略"],
    );
    assert.deepEqual(
      await problemsWith(["create policy extra on tenant_users for select using (true)"]),
      ["tenant_users：策略 extra 的 using 是 true"],
    );
    assert.deepEqual(
      await problemsWith([
        create,
        "alter table itest_orders enable row level security",
        "create policy p on itest_orders using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id())",
      ]),
      [],
    );
  } finally {
    client.release();
  }
  assert.deepEqual(await isolationProblems(db.pool), []);
});
