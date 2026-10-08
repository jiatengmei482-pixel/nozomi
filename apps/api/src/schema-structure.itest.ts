/**
 * 迁移建出来的库的结构检查（ADR 0003、ADR 0009、ADR 0010）。全部遍历系统目录，不写死「现在有哪些租户表」：
 * - 空库执行完迁移后，除了系统定义的角色清单和迁移记录，每张表都是 0 行（没有预置账号、租户、任何数据）。
 * - 每张表要么在「平台表」名单里，要么必须开启行级安全并且策略把读、写都限定在当前租户；
 *   放行跨租户访问的策略只能是下面逐条登记过的那几条。
 *   以后新增一张表而忘了开行级安全，这里会失败（最后一个测试验证了这一点确实会失败）。
 * - 三个权限角色在每张表上的权限是一张精确的清单：以后多给了权限、或把权限给了别的账号，这里会失败。
 * - 应用账号（服务进程连接数据库用的那个）自己没有任何表权限，不拥有任何表；所有表都属于迁移账号。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { identityProblems, inspectDbIdentity } from "./db/identity.ts";
import { loadMigrationFiles, runMigrations } from "./db/migrate.ts";
import type { Pool } from "./db/pool.ts";
import { DB_ROLES, PLATFORM_DB_ROLE, PREAUTH_DB_ROLE, TENANT_DB_ROLE } from "./db/roles.ts";
import { type TestDatabase, createMigratedTestDatabase } from "./testing/db.ts";

/**
 * 不属于任何租户的表：平台账号与会话、登录限速、迁移记录、两张系统定义的角色清单，
 * 以及全平台共用的主数据（城市、地点、车型组、附加服务；ADR 0012）。新增平台表时加到这里。
 */
const PLATFORM_TABLES = [
  "addons",
  "cities",
  "login_throttles",
  "places",
  "platform_roles",
  "platform_sessions",
  "platform_users",
  "schema_migrations",
  "tenant_roles",
  "vehicle_groups",
];
/** 迁移写入的系统常量（不是业务数据）：角色清单。其余的表在空库里必须是 0 行。 */
const SEEDED_CONSTANTS: Readonly<Record<string, number>> = { platform_roles: 10, tenant_roles: 5 };
/**
 * 三个权限角色在每张表上应有的权限，一项不多一项不少（ADR 0010「以后新增表时要做的事」）。
 * 新增一张表时：先想清楚哪个角色需要对它做什么，在迁移里授权，再登记到这里。
 */
const ROLE_GRANTS: Readonly<Record<string, Readonly<Record<string, string[]>>>> = {
  [TENANT_DB_ROLE]: {
    // 主数据：租户只读（ADR 0012）
    addons: ["SELECT"],
    // 区域：供应商自己的业务数据，可以真的删除（ADR 0015）
    area_polygons: ["DELETE", "INSERT", "SELECT", "UPDATE"],
    areas: ["DELETE", "INSERT", "SELECT", "UPDATE"],
    audit_logs: ["INSERT", "SELECT"],
    // 子品牌：不删除（商品引用着它）
    brands: ["INSERT", "SELECT", "UPDATE"],
    cities: ["SELECT"],
    // 创建类接口的幂等键：过期的键在再次使用时删除
    idempotency_keys: ["DELETE", "INSERT", "SELECT", "UPDATE"],
    places: ["SELECT"],
    // 商品：草稿可以真的删除；它选的区域、车型组、调度人每次保存整体替换
    product_areas: ["DELETE", "INSERT", "SELECT", "UPDATE"],
    // 商品编号的流水号
    product_code_seq: ["USAGE"],
    product_dispatchers: ["DELETE", "INSERT", "SELECT", "UPDATE"],
    product_vehicle_groups: ["DELETE", "INSERT", "SELECT", "UPDATE"],
    products: ["DELETE", "INSERT", "SELECT", "UPDATE"],
    tenant_roles: ["SELECT"],
    tenant_sessions: ["DELETE", "INSERT", "SELECT"],
    tenant_users: ["INSERT", "SELECT", "UPDATE"],
    tenants: ["SELECT"],
    vehicle_groups: ["SELECT"],
  },
  [PLATFORM_DB_ROLE]: {
    // 主数据：平台可读、可新增、可修改，不能删（只停用）
    addons: ["INSERT", "SELECT", "UPDATE"],
    audit_logs: ["INSERT", "SELECT"],
    cities: ["INSERT", "SELECT", "UPDATE"],
    places: ["INSERT", "SELECT", "UPDATE"],
    platform_sessions: ["DELETE", "INSERT", "SELECT"],
    platform_users: ["INSERT", "SELECT", "UPDATE"],
    // 商品对平台只读：停用主数据之前数「有多少已上架的商品在用」（ADR 0016）
    product_vehicle_groups: ["SELECT"],
    products: ["SELECT"],
    tenant_users: ["INSERT", "SELECT", "UPDATE"],
    tenants: ["INSERT", "SELECT", "UPDATE"],
    vehicle_groups: ["INSERT", "SELECT", "UPDATE"],
  },
  [PREAUTH_DB_ROLE]: {
    audit_logs: ["INSERT"],
    login_throttles: ["DELETE", "INSERT", "SELECT", "UPDATE"],
    schema_migrations: ["SELECT"],
  },
};

interface PolicyShape {
  roles: string[];
  /** pg_policy.polcmd：* = 全部，r = 读，a = 插入，w = 修改，d = 删除 */
  cmd: string;
  using: string | null;
  check: string | null;
}

/**
 * 不限定在当前租户的策略，逐条登记（ADR 0010）：平台角色的跨租户访问，和登录前角色追加匿名登录失败记录。
 * 除此之外的每一条策略都必须把读和写限定在当前租户。
 */
const CROSS_TENANT_POLICIES: Readonly<Record<string, PolicyShape>> = {
  "tenants.tenants_platform": { roles: [PLATFORM_DB_ROLE], cmd: "*", using: "true", check: "true" },
  "tenant_users.tenant_users_platform": { roles: [PLATFORM_DB_ROLE], cmd: "*", using: "true", check: "true" },
  "audit_logs.audit_logs_platform_read": { roles: [PLATFORM_DB_ROLE], cmd: "r", using: "true", check: null },
  "products.products_platform_read": { roles: [PLATFORM_DB_ROLE], cmd: "r", using: "true", check: null },
  "product_vehicle_groups.product_vehicle_groups_platform_read": { roles: [PLATFORM_DB_ROLE], cmd: "r", using: "true", check: null },
  "audit_logs.audit_logs_platform_append": { roles: [PLATFORM_DB_ROLE], cmd: "a", using: null, check: "true" },
  "audit_logs.audit_logs_preauth_anonymous": {
    roles: [PREAUTH_DB_ROLE],
    cmd: "a",
    using: null,
    check: "((tenant_id IS NULL) AND (actor_type = 'anonymous'::text))",
  },
};

/** 以所有者身份执行的函数，逐个登记：登录前按邮箱 / 邀请令牌定位租户用户，只返回两个编号。 */
const DEFINER_FUNCTIONS = ["locate_tenant_user_by_email", "locate_tenant_user_by_invite_token"];

/** 不以 tenant_id 开头的索引：ADR 0009「有意的例外」里逐条说明过的。 */
const INDEX_EXCEPTIONS = [
  "audit_logs_actor_idx",
  "audit_logs_occurred_idx",
  "audit_logs_pkey",
  "audit_logs_resource_idx",
  // 商品编号全平台唯一（ADR 0016）
  "products_code_key",
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
  const policies = await pool.query<{ table_name: string; name: string; cmd: string; permissive: boolean; roles: string[]; using_expr: string | null; check_expr: string | null }>(
    `select c.relname as table_name, p.polname as name, p.polcmd as cmd, p.polpermissive as permissive,
            array(select case when r = 0 then 'PUBLIC' else pg_get_userbyid(r)::text end from unnest(p.polroles) as r order by 1) as roles,
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
    const all = policies.rows.filter((policy) => policy.table_name === table.name);
    // 登记过的跨租户策略只有在角色、操作、条件都和登记的一模一样时才放过；其余的照「限定在当前租户」来要求
    const own = all.filter((policy) => {
      const registered = CROSS_TENANT_POLICIES[`${table.name}.${policy.name}`];
      const actual: PolicyShape = { roles: policy.roles, cmd: policy.cmd, using: policy.using_expr, check: policy.check_expr };
      return !(registered && policy.permissive && JSON.stringify(registered) === JSON.stringify(actual));
    });
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
  for (const table of await tableNames(db.owner)) {
    counts[table] = (await db.owner.query(`select count(*)::int as n from ${table}`)).rows[0].n;
  }
  const expected = Object.fromEntries(Object.keys(counts).map((table) => [table, SEEDED_CONSTANTS[table] ?? 0]));
  expected["schema_migrations"] = files.length;
  assert.deepEqual(counts, expected);
  for (const table of [
    "platform_users", "platform_sessions", "tenants", "tenant_users", "tenant_sessions", "audit_logs", "login_throttles",
    "cities", "places", "vehicle_groups", "addons", "areas", "area_polygons", "idempotency_keys",
    "brands", "products", "product_areas", "product_vehicle_groups", "product_dispatchers",
  ]) {
    assert.equal(counts[table], 0, `${table} 应当存在且为空`);
  }
});

test("迁移重复执行：第二次什么都不做，结构和数据不变", async () => {
  const describe = async (): Promise<unknown> => ({
    columns: (await db.owner.query("select table_name, column_name, data_type, is_nullable from information_schema.columns where table_schema = current_schema() order by 1, 2")).rows,
    policies: (await db.owner.query("select polname from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = current_schema() order by 1")).rows,
    roles: (await db.owner.query("select key from platform_roles union all select key from tenant_roles order by 1")).rows,
    migrations: (await db.owner.query("select count(*)::int as n from schema_migrations")).rows,
  });
  const before = await describe();
  const again = await runMigrations(db.owner, await loadMigrationFiles());
  assert.deepEqual(again.applied, []);
  assert.deepEqual(await describe(), before);
});

test("每张表要么是登记过的平台表，要么开启了行级安全且每条策略都把读和写限定在当前租户", async () => {
  assert.deepEqual(await isolationProblems(db.owner), []);
  const tables = await tableNames(db.owner);
  for (const table of PLATFORM_TABLES) assert.ok(tables.includes(table), `平台表名单里的 ${table} 不存在，名单该更新了`);
  const existing = await db.owner.query<{ key: string }>(
    `select c.relname || '.' || p.polname as key
       from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = current_schema()`,
  );
  for (const key of Object.keys(CROSS_TENANT_POLICIES)) {
    assert.ok(existing.rows.some((row) => row.key === key), `登记过的跨租户策略 ${key} 不存在，名单该更新了`);
  }
});

test("每张租户表：tenant_id 非空（审计日志除外，空表示平台级操作）、主键和索引以 tenant_id 开头（ADR 0009 的例外逐个列出）、租户表之间的外键带着 tenant_id", async () => {
  const columns = await db.owner.query<{ table_name: string; not_null: boolean }>(
    `select c.relname as table_name, att.attnotnull as not_null
       from pg_attribute att join pg_class c on c.oid = att.attrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = current_schema() and c.relkind in ('r', 'p') and att.attname = 'tenant_id' and not att.attisdropped
      order by 1`,
  );
  assert.ok(columns.rows.length >= 3);
  assert.deepEqual(columns.rows.filter((row) => !row.not_null).map((row) => row.table_name), ["audit_logs"]);
  const tenantTables = columns.rows.map((row) => row.table_name);

  const indexes = await db.owner.query<{ table_name: string; index_name: string; first_column: string; is_primary: boolean }>(
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

  const foreignKeys = await db.owner.query<{ name: string; from_table: string; to_table: string; columns: string[] }>(
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

/** 这个 schema 里每个对象的授权（不含所有者自己的）：被授权方 → 对象 → 权限列表。PUBLIC 记为 "PUBLIC"。 */
async function grantsByGrantee(pool: Pool): Promise<Record<string, Record<string, string[]>>> {
  const rows = await pool.query<{ grantee: string; object_name: string; privilege: string }>(
    `select case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee)::text end as grantee,
            c.relname as object_name, a.privilege_type as privilege
       from pg_class c join pg_namespace n on n.oid = c.relnamespace, aclexplode(c.relacl) as a
      where n.nspname = current_schema() and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f') and a.grantee <> c.relowner
      order by 1, 2, 3`,
  );
  const result: Record<string, Record<string, string[]>> = {};
  for (const row of rows.rows) ((result[row.grantee] ??= {})[row.object_name] ??= []).push(row.privilege);
  return result;
}

test("三个权限角色的表权限清单一项不多一项不少；除它们之外没有任何账号（包括应用账号和 PUBLIC）被授予表权限；没有列级别的授权", async () => {
  assert.deepEqual(await grantsByGrantee(db.owner), ROLE_GRANTS);

  const columnGrants = await db.owner.query(
    `select c.relname, att.attname from pg_attribute att join pg_class c on c.oid = att.attrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = current_schema() and att.attacl is not null`,
  );
  assert.deepEqual(columnGrants.rows, [], "有列级别的授权");
});

test("「必须先修改密码」标记（迁移 0006，ADR 0013）：平台员工表和租户用户表各一列，非空、默认 false；只在这两张表上；加列没有带来新的授权", async () => {
  const columns = await db.owner.query(
    `select table_name, data_type, is_nullable, column_default from information_schema.columns
      where table_schema = current_schema() and column_name = 'must_change_password' order by 1`,
  );
  assert.deepEqual(columns.rows, [
    { table_name: "platform_users", data_type: "boolean", is_nullable: "NO", column_default: "false" },
    { table_name: "tenant_users", data_type: "boolean", is_nullable: "NO", column_default: "false" },
  ]);
  const constraints = await db.owner.query<{ name: string }>(
    `select con.conname::text as name from pg_constraint con join pg_namespace n on n.oid = con.connamespace
      where n.nspname = current_schema() and con.conname like '%must_change_needs_password' order by 1`,
  );
  assert.deepEqual(constraints.rows.map((row) => row.name), [
    "platform_users_must_change_needs_password",
    "tenant_users_must_change_needs_password",
  ]);
  // 读写这一列用的是已有的表级权限：平台角色对两张表、租户角色对 tenant_users；登录前角色两张表都碰不到
  const grants = await grantsByGrantee(db.owner);
  assert.deepEqual(grants[PLATFORM_DB_ROLE]?.["platform_users"], ["INSERT", "SELECT", "UPDATE"]);
  assert.deepEqual(grants[PLATFORM_DB_ROLE]?.["tenant_users"], ["INSERT", "SELECT", "UPDATE"]);
  assert.deepEqual(grants[TENANT_DB_ROLE]?.["tenant_users"], ["INSERT", "SELECT", "UPDATE"]);
  assert.equal(grants[TENANT_DB_ROLE]?.["platform_users"], undefined);
  assert.equal(grants[PREAUTH_DB_ROLE]?.["platform_users"], undefined);
  assert.equal(grants[PREAUTH_DB_ROLE]?.["tenant_users"], undefined);
});

test("审计日志：应用账号经任何一个权限角色能拿到的权限只有追加和读；改、删、清空、建触发器、引用一概没有", async () => {
  const grants = await grantsByGrantee(db.owner);
  const reachable = new Set(DB_ROLES.flatMap((role) => grants[role]?.["audit_logs"] ?? []));
  assert.deepEqual([...reachable].sort(), ["INSERT", "SELECT"]);
  assert.deepEqual(Object.keys(grants).sort(), [...DB_ROLES].sort(), "只有三个权限角色有授权");
  for (const role of DB_ROLES) {
    for (const privilege of ["UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
      const has = await db.owner.query<{ has: boolean }>("select has_table_privilege($1, 'audit_logs', $2) as has", [role, privilege]);
      assert.equal(has.rows[0]?.has, false, `${role} 对 audit_logs 有 ${privilege} 权限`);
    }
  }
});

test("所有表、序列都属于迁移账号；应用账号和三个权限角色不拥有任何对象，也不拥有 schema", async () => {
  const appLogin = new URL(db.url).username;
  const owners = await db.owner.query<{ owner: string }>(
    `select distinct pg_get_userbyid(c.relowner)::text as owner from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = current_schema()
      union
     select pg_get_userbyid(p.proowner)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = current_schema()
      union
     select pg_get_userbyid(n.nspowner)::text from pg_namespace n where n.nspname = current_schema()`,
  );
  const migrationLogin = new URL(db.ownerUrl).username;
  assert.deepEqual(owners.rows.map((row) => row.owner), [migrationLogin]);
  assert.notEqual(appLogin, migrationLogin);
  assert.ok(!(DB_ROLES as readonly string[]).includes(migrationLogin));
});

test("三个权限角色：不能登录、没有密码、不是超级用户、不能绕过行级安全、不能建对象、不属于任何别的角色", async () => {
  for (const name of DB_ROLES) {
    const role = await db.owner.query(
      `select rolsuper, rolbypassrls, rolcanlogin, rolcreaterole, rolcreatedb, rolreplication,
              rolpassword is null as no_password,
              has_schema_privilege($1, current_schema(), 'USAGE') as can_use_schema,
              has_schema_privilege($1, current_schema(), 'CREATE') as can_create,
              has_database_privilege($1, current_database(), 'CREATE') as can_create_schema,
              (select count(*)::int from pg_auth_members m where m.member = a.oid) as member_of
         from pg_authid a where rolname = $1`,
      [name],
    );
    assert.deepEqual(
      role.rows[0],
      {
        rolsuper: false, rolbypassrls: false, rolcanlogin: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false,
        no_password: true, can_use_schema: true, can_create: false, can_create_schema: false, member_of: 0,
      },
      name,
    );
  }
});

test("应用账号：能登录但没有任何特殊属性，恰好是三个权限角色的成员且不自动继承它们的权限；自检函数判定它合格、判定迁移账号不合格", async () => {
  const appLogin = new URL(db.url).username;
  const account = await db.owner.query(
    `select rolsuper, rolbypassrls, rolcanlogin, rolinherit, rolcreaterole, rolcreatedb, rolreplication,
            has_schema_privilege($1, current_schema(), 'CREATE') as can_create,
            has_database_privilege($1, current_database(), 'CREATE') as can_create_schema,
            array(select g.rolname::text || ':' || m.inherit_option || ':' || m.set_option || ':' || m.admin_option
                    from pg_auth_members m join pg_roles g on g.oid = m.roleid where m.member = r.oid order by 1) as memberships
       from pg_roles r where rolname = $1`,
    [appLogin],
  );
  assert.deepEqual(account.rows[0], {
    rolsuper: false, rolbypassrls: false, rolcanlogin: true, rolinherit: false, rolcreaterole: false, rolcreatedb: false, rolreplication: false,
    can_create: false, can_create_schema: false,
    memberships: [...DB_ROLES].sort().map((role) => `${role}:false:true:false`),
  });

  const app = await inspectDbIdentity(db.pool);
  assert.equal(app.login, appLogin);
  assert.deepEqual(identityProblems(app), []);
  const migration = await inspectDbIdentity(db.owner);
  assert.notDeepEqual(identityProblems(migration), [], "迁移账号是表的所有者，不能被判定为合格的应用账号");
});

test("以所有者身份执行的函数只有登记过的两个：查找路径固定在本 schema，只有登录前的角色能执行，只返回租户编号和用户编号", async () => {
  const functions = await db.owner.query<{ name: string; result: string; config: string[] | null; executors: string[]; volatility: string }>(
    `select p.proname as name, pg_get_function_result(p.oid) as result, p.proconfig as config, p.provolatile as volatility,
            array(select case when a.grantee = 0 then 'PUBLIC' else pg_get_userbyid(a.grantee)::text end
                    from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as a
                   where a.privilege_type = 'EXECUTE' and a.grantee <> p.proowner order by 1) as executors
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = current_schema() and p.prosecdef order by 1`,
  );
  assert.deepEqual(functions.rows.map((row) => row.name), DEFINER_FUNCTIONS);
  for (const fn of functions.rows) {
    assert.equal(fn.result, "TABLE(tenant_id uuid, user_id uuid)", fn.name);
    assert.deepEqual(fn.config, [`search_path=${db.schema}, pg_temp`], fn.name);
    assert.deepEqual(fn.executors, [PREAUTH_DB_ROLE], fn.name);
    assert.equal(fn.volatility, "s", `${fn.name} 应当只读（stable）`);
  }
});

test("检查本身是有效的：新增一张表而忘了开行级安全、只开不建策略、策略写成放行全部、只限读不限写、多开一条没登记的跨租户策略、新表给了登记之外的权限，都会被上面的检查发现", async () => {
  const client = await db.owner.connect();
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
    // 给平台角色、登录前角色多开一条没登记过的放行策略，同样会被发现；把登记过的策略放宽到别的角色也一样
    assert.deepEqual(
      await problemsWith([`create policy extra on tenant_sessions for select to ${PLATFORM_DB_ROLE} using (true)`]),
      ["tenant_sessions：策略 extra 的 using 是 true"],
    );
    assert.deepEqual(
      await problemsWith([`create policy extra on tenant_users for select to ${PREAUTH_DB_ROLE} using (true)`]),
      ["tenant_users：策略 extra 的 using 是 true"],
    );
    assert.deepEqual(
      await problemsWith([`alter policy tenant_users_platform on tenant_users to ${PLATFORM_DB_ROLE}, ${PREAUTH_DB_ROLE}`]),
      ["tenant_users：策略 tenant_users_platform 的 using 是 true", "tenant_users：策略 tenant_users_platform 的 with check 是 true"],
    );
    assert.deepEqual(
      await problemsWith(["alter policy audit_logs_preauth_anonymous on audit_logs with check (true)"]),
      ["audit_logs：策略 audit_logs_preauth_anonymous 的 with check 是 true"],
    );
    assert.deepEqual(
      await problemsWith([
        create,
        "alter table itest_orders enable row level security",
        "create policy p on itest_orders using (tenant_id = app_tenant_id()) with check (tenant_id = app_tenant_id())",
      ]),
      [],
    );
    // 新表的授权没有登记到 ROLE_GRANTS：权限清单的比对会不相等
    await client.query("begin");
    try {
      await client.query(create);
      await client.query(`grant select on itest_orders to ${TENANT_DB_ROLE}`);
      const grants = await grantsByGrantee(client as unknown as Pool);
      assert.deepEqual(grants[TENANT_DB_ROLE]?.["itest_orders"], ["SELECT"]);
      assert.notDeepEqual(grants, ROLE_GRANTS);
    } finally {
      await client.query("rollback");
    }
  } finally {
    client.release();
  }
  assert.deepEqual(await isolationProblems(db.owner), []);
});
