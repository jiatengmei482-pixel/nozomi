/**
 * M0-10 的验收（ADR 0010）：服务进程用的应用账号到底能做什么、不能做什么。
 * 全部用应用账号的真实连接直接执行 SQL——模拟「出现 SQL 注入或连接串泄露」时对方手里有的东西：
 * 可以执行任意语句，可以随意 `set role` 到三个权限角色中的任何一个。
 *
 * 1. 应用账号不是表的所有者、不是超级用户，没有任何特殊属性，也拿不到。
 * 2. 不切换角色什么都读不到；切到租户角色读不到别的租户；切到登录前角色只拿得到两个编号。
 *    切到平台角色可以跨租户——这是平台功能所必需的，ADR 0010 记录为剩余风险，这里如实断言。
 * 3. 无论切到哪个角色，都改不了、删不了审计日志，也关不掉保护它的触发器。
 * 另外：把迁移账号（或别的权限过大的账号）配给服务进程时，进程拒绝启动，业务 SQL 一条都不执行。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { buildApp } from "./app.ts";
import { type Db, withPlatformTx, withPreAuthTx, withTenantTx } from "./db/context.ts";
import { DbIdentityError } from "./db/identity.ts";
import { type Pool, type PoolClient, createPool } from "./db/pool.ts";
import { DB_ROLES, type DbRole, PLATFORM_DB_ROLE, PREAUTH_DB_ROLE, TENANT_DB_ROLE } from "./db/roles.ts";
import { type TenantFixture, type TestApi, createTestApi } from "./testing/api.ts";
import { leakedSecrets, testConfig, testEnv } from "./testing/fixtures.ts";
import { exitWithin, freePort, startNode } from "./testing/process.ts";

const SERVER_ENTRY = fileURLToPath(new URL("./server.ts", import.meta.url));
const ADMIN_CREATE_ENTRY = fileURLToPath(new URL("./cli/admin-create.ts", import.meta.url));

let api: TestApi;
let a: TenantFixture;
let b: TenantFixture;
let appLogin: string;
let migrationLogin: string;
let tables: string[];

before(async () => {
  api = await createTestApi();
  appLogin = new URL(api.db.url).username;
  migrationLogin = new URL(api.db.ownerUrl).username;
  // 正式库的表在 public schema 里，所有账号都看得见表名（PUBLIC 有 schema 的使用权）。
  // 测试的 schema 默认没有这一条，补上：这样应用账号面对的和正式库一样，被拒绝靠的是表权限而不是「看不见」。
  await api.db.owner.query(`grant usage on schema ${api.db.schema} to public`);
  const platformToken = await api.superAdminToken();
  a = await api.tenantWithAdmin(platformToken, "车队甲", "admin@a.test");
  b = await api.tenantWithAdmin(platformToken, "车队乙", "admin@b.test");
  const names = await api.db.owner.query<{ name: string }>(
    `select c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = current_schema() and c.relkind in ('r', 'p') order by 1`,
  );
  tables = names.rows.map((row) => row.name);
});
after(() => api.close());

const PERMISSION_DENIED = { code: "42501" };

type Identity = DbRole | "不切换角色";
const IDENTITIES: Identity[] = ["不切换角色", ...DB_ROLES];

/**
 * 用应用账号的一条真实连接，在一个事务里（可选地切换到某个角色、设置租户）执行一段操作，结束时回滚。
 * 不经过 withTenantTx 等入口：这里模拟的是能执行任意 SQL 的对方。
 */
async function asAppAccount<T>(identity: Identity, tenantId: string | null, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await api.db.pool.connect();
  try {
    await client.query("begin");
    if (identity !== "不切换角色") await client.query(`set local role ${identity}`);
    if (tenantId !== null) await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    return await fn(client);
  } finally {
    await client.query("rollback");
    client.release();
  }
}

/** 每条语句各在一个新事务里尝试，全部应当被数据库以「没有权限」拒绝。 */
async function assertAllDenied(identity: Identity, tenantId: string | null, statements: readonly string[]): Promise<void> {
  for (const sql of statements) {
    await assert.rejects(asAppAccount(identity, tenantId, (client) => client.query(sql)), PERMISSION_DENIED, `${identity}：${sql}`);
  }
}

test("验收 1：服务进程实际连上的账号不是迁移账号，没有 SUPERUSER / CREATEROLE / CREATEDB / BYPASSRLS / REPLICATION，不拥有任何表", async () => {
  const me = await api.db.pool.query(
    `select session_user::text as login, current_user::text as acting_as,
            r.rolsuper, r.rolcreaterole, r.rolcreatedb, r.rolbypassrls, r.rolreplication, r.rolinherit,
            current_setting('is_superuser') as is_superuser,
            (select count(*)::int from pg_class c where c.relowner = r.oid) as owned,
            (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
              where n.nspname = current_schema() and pg_has_role(r.oid, c.relowner, 'MEMBER')) as can_take_over
       from pg_roles r where r.rolname = session_user`,
  );
  assert.deepEqual(me.rows[0], {
    login: appLogin,
    acting_as: appLogin,
    rolsuper: false,
    rolcreaterole: false,
    rolcreatedb: false,
    rolbypassrls: false,
    rolreplication: false,
    rolinherit: false,
    is_superuser: "off",
    owned: 0,
    can_take_over: 0,
  });
  assert.notEqual(appLogin, migrationLogin);
});

test("验收 1：应用账号给自己提权、建对象、切到迁移账号的每一种尝试都被拒绝（无论先切到哪个角色）", async () => {
  const attempts = [
    `alter role ${appLogin} superuser`,
    `alter role ${appLogin} bypassrls`,
    `alter role ${appLogin} createrole`,
    `alter role ${appLogin} inherit`,
    `alter role ${TENANT_DB_ROLE} bypassrls`,
    "create role itest_escalation superuser",
    "create role itest_escalation",
    `grant ${migrationLogin} to ${appLogin}`,
    `grant ${PLATFORM_DB_ROLE} to ${TENANT_DB_ROLE}`,
    `set role ${migrationLogin}`,
    `set session authorization ${migrationLogin}`,
    "create table itest_mine (id int)",
    "create schema itest_mine",
    "select pg_read_file('/etc/passwd')",
    "copy (select 1) to program 'true'",
    "select pg_reload_conf()",
    `alter table tenants owner to ${appLogin}`,
  ];
  for (const identity of IDENTITIES) await assertAllDenied(identity, null, attempts);
  // 这两条不能在事务里执行，单独试
  for (const sql of ["create database itest_mine", "alter system set log_statement = 'none'"]) {
    await assert.rejects(api.db.pool.query(sql), PERMISSION_DENIED, sql);
  }
  // 给自己授权：没有任何权限时报错，有部分权限但无权转授时数据库只给警告、什么都不授——两种情况下权限都不能变多
  for (const identity of IDENTITIES) {
    await asAppAccount(identity, null, async (client) => {
      const privileges = (): Promise<unknown> =>
        client
          .query(
            `select has_table_privilege(session_user, 'audit_logs', 'DELETE') as audit_delete,
                    has_table_privilege(session_user, 'tenant_users', 'SELECT') as users_select,
                    has_table_privilege('public', 'tenant_users', 'SELECT') as public_select,
                    has_table_privilege($1, 'tenant_sessions', 'SELECT') as platform_sessions`,
            [PLATFORM_DB_ROLE],
          )
          .then((result) => result.rows[0]);
      for (const sql of [
        `grant all on all tables in schema ${api.db.schema} to ${appLogin}`,
        "grant select on tenant_users to public",
        `grant select on tenant_sessions to ${PLATFORM_DB_ROLE}`,
        `grant update, delete, truncate on audit_logs to ${appLogin}`,
      ]) {
        await client.query("savepoint attempt");
        await client.query(sql).catch(() => client.query("rollback to savepoint attempt"));
      }
      assert.deepEqual(
        await privileges(),
        { audit_delete: false, users_select: false, public_select: false, platform_sessions: false },
        identity,
      );
    });
  }
  const still = await api.db.owner.query(
    "select rolsuper, rolbypassrls, rolcreaterole, rolinherit from pg_roles where rolname = $1",
    [appLogin],
  );
  assert.deepEqual(still.rows[0], { rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolinherit: false });
});

test("验收 2：应用账号不切换角色时，每一张表都读不了、写不了，定位函数也调用不了", async () => {
  assert.ok(tables.length >= 9, "前提：迁移建出的表都在");
  for (const table of tables) {
    await assertAllDenied("不切换角色", null, [
      `select * from ${table}`,
      `select count(*) from ${table}`,
      `delete from ${table}`,
      `truncate ${table} cascade`,
      `lock table ${table} in access share mode`,
      `copy ${table} to stdout`,
    ]);
  }
  await assertAllDenied("不切换角色", null, [
    "insert into tenants (name, status) values ('自建租户', 'active')",
    "update tenant_users set role = 'admin'",
    "update platform_users set role = 'super_admin'",
    "select * from locate_tenant_user_by_email('admin@a.test')",
    "select * from locate_tenant_user_by_invite_token('x')",
  ]);
  // 设了租户编号也没用：没有表权限，行级安全策略根本轮不到
  await assertAllDenied("不切换角色", a.tenantId, ["select * from tenant_users", "select * from tenants"]);
});

test("验收 2：切到租户角色（设成租户甲）后读不到、改不了租户乙；关行级安全、不设租户、换成乙以外的写法都拿不到乙的数据", async () => {
  await asAppAccount(TENANT_DB_ROLE, a.tenantId, async (client) => {
    for (const table of ["tenant_users", "tenant_sessions", "audit_logs"]) {
      const rows = await client.query(`select tenant_id from ${table}`);
      assert.ok(rows.rows.length > 0, `${table} 应该有租户甲的数据`);
      assert.ok(rows.rows.every((row) => row.tenant_id === a.tenantId), `${table} 漏出了别的租户的行`);
    }
    assert.deepEqual((await client.query("select id from tenants")).rows, [{ id: a.tenantId }]);
    assert.equal((await client.query("select 1 from tenant_users where id = $1", [b.adminId])).rows.length, 0);
    assert.equal((await client.query("update tenant_users set name = '被改了' where id = $1", [b.adminId])).rowCount, 0);
    assert.equal((await client.query("delete from tenant_sessions where tenant_id = $1", [b.tenantId])).rowCount, 0);
  });
  await assertAllDenied(TENANT_DB_ROLE, a.tenantId, [
    // 关掉行级安全：非所有者关不掉，查询直接报错而不是返回全部
    "set local row_security = off; select * from tenant_users",
    "alter table tenant_users disable row level security",
    "alter table tenant_users no force row level security",
    "drop policy tenant_users_same_tenant on tenant_users",
    "create policy leak on tenant_users using (true)",
    `insert into tenant_users (tenant_id, email, name, role, status) values ('${b.tenantId}', 'spy@a.test', '卧底', 'admin', 'invited')`,
    `update tenant_users set tenant_id = '${b.tenantId}'`,
    "select * from platform_users",
    "select * from platform_sessions",
    "select * from login_throttles",
    "select * from schema_migrations",
    "select * from locate_tenant_user_by_email('admin@b.test')",
  ]);
  await asAppAccount(TENANT_DB_ROLE, null, async (client) => {
    for (const table of ["tenant_users", "tenant_sessions", "tenants", "audit_logs"]) {
      assert.equal((await client.query(`select 1 from ${table}`)).rows.length, 0, `没设租户时 ${table} 读到了数据`);
    }
  });
  const untouched = await api.db.owner.query("select name from tenant_users where id = $1", [b.adminId]);
  assert.deepEqual(untouched.rows, [{ name: "车队乙管理员" }]);
});

test("验收 2：切到登录前角色，只拿得到（租户编号，用户编号），读不到任何账号、租户、会话、审计数据", async () => {
  await asAppAccount(PREAUTH_DB_ROLE, null, async (client) => {
    const located = await client.query("select * from locate_tenant_user_by_email('admin@b.test')");
    assert.deepEqual(located.rows, [{ tenant_id: b.tenantId, user_id: b.adminId }]);
    assert.deepEqual(located.fields.map((field) => field.name), ["tenant_id", "user_id"]);
    assert.deepEqual((await client.query("select * from locate_tenant_user_by_email('nobody@nowhere.test')")).rows, []);
  });
  for (const tenantId of [null, b.tenantId]) {
    await assertAllDenied(PREAUTH_DB_ROLE, tenantId, [
      "select * from tenant_users",
      "select * from tenants",
      "select * from tenant_sessions",
      "select * from platform_users",
      "select * from platform_sessions",
      "select * from audit_logs",
      "update tenant_users set role = 'admin'",
      "insert into tenants (name, status) values ('自建租户', 'active')",
      // 只能追加「不属于任何租户、操作者是匿名」的审计行：冒充平台员工、往租户名下写都不行
      "insert into audit_logs (occurred_at, tenant_id, actor_type, source, resource, action) values (now(), null, 'platform_user', 'console', 'tenant', 'create')",
      `insert into audit_logs (occurred_at, tenant_id, actor_type, source, resource, action) values (now(), '${b.tenantId}', 'anonymous', 'console', 'tenant_user', 'login_failed')`,
      // 定位函数的查找路径是固定的：建同名临时表骗不了它，这里连函数本身也改不了
      "create or replace function locate_tenant_user_by_email(p_email text) returns table (tenant_id uuid, user_id uuid) language sql as $$ select null::uuid, null::uuid $$",
      "alter function locate_tenant_user_by_email(text) reset search_path",
    ]);
  }
  await asAppAccount(PREAUTH_DB_ROLE, null, async (client) => {
    await client.query("create temp table tenant_users (tenant_id uuid, id uuid, email text)");
    await client.query("insert into tenant_users values (gen_random_uuid(), gen_random_uuid(), 'admin@b.test')");
    const located = await client.query("select * from locate_tenant_user_by_email('admin@b.test')");
    assert.deepEqual(located.rows, [{ tenant_id: b.tenantId, user_id: b.adminId }], "同名临时表不应当影响定位函数");
  });
});

test("验收 2（剩余风险，如实记录）：切到平台角色可以跨租户读写租户和账号——平台功能所必需；但读不到租户会话和登录限速，删不了任何账号和租户", async () => {
  await asAppAccount(PLATFORM_DB_ROLE, null, async (client) => {
    const tenants = await client.query("select distinct tenant_id from tenant_users");
    assert.deepEqual(new Set(tenants.rows.map((row) => row.tenant_id)), new Set([a.tenantId, b.tenantId]));
  });
  await assertAllDenied(PLATFORM_DB_ROLE, null, [
    "select * from tenant_sessions",
    "delete from tenant_sessions",
    "select * from login_throttles",
    "select * from schema_migrations",
    "delete from tenants",
    "delete from tenant_users",
    "delete from platform_users",
    "truncate tenant_users cascade",
    "update platform_sessions set expires_at = now() + interval '10 years'",
    "select * from locate_tenant_user_by_email('admin@a.test')",
    "alter table tenant_users disable row level security",
    "drop policy tenant_users_platform on tenant_users",
    "drop table tenant_sessions",
  ]);
});

test("验收 3：无论不切换角色还是切到三个角色中的任何一个，审计日志都改不了、删不了、清不掉，保护它的触发器和策略也动不了", async () => {
  const fingerprint = async (): Promise<unknown> =>
    (await api.db.owner.query("select count(*)::int as n, md5(string_agg(a::text, '|' order by id)) as digest from audit_logs a")).rows[0];
  const before = await fingerprint();
  assert.ok((before as { n: number }).n > 0, "前提：审计日志里有记录");

  const attempts = [
    "update audit_logs set action = 'tampered'",
    "update audit_logs set actor_email = null where id = (select min(id) from audit_logs)",
    "delete from audit_logs",
    "delete from audit_logs where id = (select max(id) from audit_logs)",
    "truncate audit_logs",
    "truncate audit_logs cascade",
    "drop table audit_logs",
    "drop table audit_logs cascade",
    "alter table audit_logs disable trigger all",
    "alter table audit_logs disable trigger user",
    "alter table audit_logs disable trigger audit_logs_no_update_delete",
    "alter table audit_logs disable trigger audit_logs_no_truncate",
    "drop trigger audit_logs_no_update_delete on audit_logs",
    "drop trigger audit_logs_no_truncate on audit_logs",
    "create or replace function audit_logs_reject_change() returns trigger language plpgsql as $$ begin return old; end $$",
    "drop function audit_logs_reject_change() cascade",
    "alter function audit_logs_reject_change() owner to current_user",
    "set session_replication_role = replica",
    "set local session_replication_role = replica",
    "select set_config('session_replication_role', 'replica', true)",
    "alter table audit_logs disable row level security",
    "drop policy audit_logs_same_tenant on audit_logs",
    "alter table audit_logs drop column before",
    "alter table audit_logs add column note text",
    "alter table audit_logs alter column action drop not null",
    "alter table audit_logs rename to audit_logs_old",
    "alter table audit_logs set schema pg_temp",
    `alter table audit_logs owner to ${appLogin}`,
    "alter table audit_logs owner to current_user",
    "create trigger itest_swallow before insert on audit_logs for each row execute function audit_logs_reject_change()",
    "create rule itest_swallow as on insert to audit_logs do instead nothing",
    "lock table audit_logs in access exclusive mode",
    "alter sequence audit_logs_id_seq restart with 1",
  ];
  for (const identity of IDENTITIES) {
    await assertAllDenied(identity, null, attempts);
    await assertAllDenied(identity, a.tenantId, attempts.slice(0, 6));
  }

  assert.deepEqual(await fingerprint(), before, "审计日志被改动了");
  const protections = await api.db.owner.query(
    `select (select count(*)::int from pg_trigger where tgrelid = 'audit_logs'::regclass and not tgisinternal and tgenabled = 'O') as triggers,
            (select relrowsecurity from pg_class where oid = 'audit_logs'::regclass) as rls,
            (select count(*)::int from pg_policy where polrelid = 'audit_logs'::regclass) as policies,
            pg_get_userbyid((select relowner from pg_class where oid = 'audit_logs'::regclass))::text as owner`,
  );
  assert.deepEqual(protections.rows[0], { triggers: 2, rls: true, policies: 4, owner: migrationLogin });
});

test("验收 3：能追加的角色照常追加（追加不受影响），追加进去的行同样改不了", async () => {
  const insert =
    "insert into audit_logs (occurred_at, tenant_id, actor_type, source, resource, action) values (now(), $1, $2, 'console', 'itest', 'append') returning id";
  const cases: [Identity, string | null, string | null, string][] = [
    [TENANT_DB_ROLE, a.tenantId, a.tenantId, "tenant_user"],
    [PLATFORM_DB_ROLE, null, null, "platform_user"],
    [PLATFORM_DB_ROLE, null, b.tenantId, "platform_user"],
  ];
  for (const [identity, setting, tenantId, actorType] of cases) {
    await asAppAccount(identity, setting, async (client) => {
      const inserted = await client.query(insert, [tenantId, actorType]);
      await client.query("savepoint appended");
      await assert.rejects(client.query("update audit_logs set action = 'x' where id = $1", [inserted.rows[0].id]), PERMISSION_DENIED);
      await client.query("rollback to savepoint appended");
      await assert.rejects(client.query("delete from audit_logs where id = $1", [inserted.rows[0].id]), PERMISSION_DENIED);
    });
  }
  // 登录前角色只能追加匿名的平台级记录，而且读不回来（insert … returning 需要读权限）
  await asAppAccount(PREAUTH_DB_ROLE, null, async (client) => {
    const appended = await client.query(
      "insert into audit_logs (occurred_at, tenant_id, actor_type, source, resource, action) values (now(), null, 'anonymous', 'console', 'tenant_user', 'login_failed')",
    );
    assert.equal(appended.rowCount, 1);
  });
});

test("三个事务入口各自切到对应的角色；登录、邀请、平台操作的完整链路在最小权限下照常工作", async () => {
  const who = async (db: Db): Promise<unknown> =>
    (await db.query("select current_user::text as role, session_user::text as login")).rows[0];
  assert.deepEqual(await withTenantTx(api.db.pool, a.tenantId, who), { role: TENANT_DB_ROLE, login: appLogin });
  assert.deepEqual(await withPlatformTx(api.db.pool, who), { role: PLATFORM_DB_ROLE, login: appLogin });
  assert.deepEqual(await withPreAuthTx(api.db.pool, who), { role: PREAUTH_DB_ROLE, login: appLogin });

  // before() 里的「建超管 → 平台登录 → 建租户 → 接受邀请 → 租户登录」已经全部走的是应用账号；这里再补登录失败和健康检查
  const wrong = await api.call("POST", "/tenant/v1/auth/login", { body: { email: "nobody@nowhere.test", password: "Wrong-Password-1" } });
  assert.equal(wrong.status, 401);
  const anonymous = await api.db.owner.query(
    "select actor_type, tenant_id from audit_logs where action = 'login_failed' and tenant_id is null and resource = 'tenant_user'",
  );
  assert.deepEqual(anonymous.rows, [{ actor_type: "anonymous", tenant_id: null }]);
  const health = await api.call("GET", "/health");
  assert.equal(health.status, 200, health.text);
  assert.equal(health.body.migrations.state, "up_to_date");
});

test("把迁移账号配给服务进程：进程拒绝启动（退出码 1）并说明原因，输出里没有连接串和密码", async () => {
  const port = await freePort();
  const running = startNode(SERVER_ENTRY, { ...testEnv(api.db.ownerUrl), PORT: String(port) });
  const code = await exitWithin(running, 15_000);
  if (code === "timeout") running.child.kill("SIGKILL");
  const output = running.output();
  assert.equal(code, 1, output);
  assert.match(output, /\[DB_ROLE_UNSAFE\] 拒绝启动/);
  assert.match(output, new RegExp(`数据库账号 ${migrationLogin} 不能用来运行服务`));
  assert.match(output, /pnpm db:provision/);
  assert.ok(!output.includes("Server listening"), "不应该开始监听");
  assert.ok(!output.includes("postgres://") && !output.includes(`${new URL(api.db.ownerUrl).password}@`));
  assert.deepEqual(leakedSecrets(output), []);
});

test("把迁移账号配给管理员命令行：拒绝执行，不创建账号", async () => {
  const running = startNode(ADMIN_CREATE_ENTRY, testEnv(api.db.ownerUrl), ["--email", "sneaky@platform.test", "--name", "走错门"], {
    input: "Cli-Created-Passw0rd\n",
  });
  const code = await exitWithin(running, 20_000);
  if (code === "timeout") running.child.kill("SIGKILL");
  assert.equal(code, 1, running.output());
  assert.match(running.output(), /没有创建账号：数据库账号 .* 不能用来运行服务/);
  const created = await api.db.owner.query("select 1 from platform_users where email = 'sneaky@platform.test'");
  assert.equal(created.rows.length, 0);
});

test("连接池用的是迁移账号时：三个事务入口都不执行任何 SQL 就报错，/health 是 503 DB_ROLE_UNSAFE，业务接口是 500", async () => {
  let reached = false;
  const touch = async (): Promise<void> => {
    reached = true;
  };
  for (const run of [
    () => withTenantTx(api.db.owner, a.tenantId, touch),
    () => withPlatformTx(api.db.owner, touch),
    () => withPreAuthTx(api.db.owner, touch),
  ]) {
    await assert.rejects(run(), (err: unknown) => err instanceof DbIdentityError && err.login === migrationLogin);
  }
  assert.equal(reached, false, "账号不合格时回调不应当被执行");

  const pool = createPool(api.db.ownerUrl, { max: 2 });
  const app = buildApp({ config: testConfig(api.db.ownerUrl), pool, migrationFiles: [], logger: false });
  try {
    const health = await app.inject({ method: "GET", url: "/health" });
    assert.equal(health.statusCode, 503);
    assert.deepEqual(health.json().database, { state: "down", latencyMs: null, errorCode: "DB_ROLE_UNSAFE" });
    assert.equal(health.json().migrations.state, "unknown");
    const login = await app.inject({ method: "POST", url: "/platform/v1/auth/login", payload: { email: "root@platform.test", password: "x".repeat(12) } });
    assert.equal(login.statusCode, 500);
    assert.deepEqual(login.json(), { error: { code: "INTERNAL_ERROR", message: "服务器内部错误，请稍后重试", details: {} } });
  } finally {
    await app.close();
    await pool.end();
  }
});

test("权限过大的非超级用户账号同样被拒绝：带 BYPASSRLS、自动继承权限、多属于一个角色、少一个角色", async () => {
  const variants: { label: string; attributes: string; grants: string[]; expected: RegExp }[] = [
    { label: "BYPASSRLS", attributes: "noinherit bypassrls", grants: DB_ROLES.map((role) => `${role} to %s with inherit false, set true`), expected: /BYPASSRLS/ },
    { label: "自动继承", attributes: "inherit", grants: DB_ROLES.map((role) => `${role} to %s with inherit true, set true`), expected: /NOINHERIT/ },
    {
      label: "多属于一个角色",
      attributes: "noinherit",
      grants: [...DB_ROLES.map((role) => `${role} to %s with inherit false, set true`), "pg_read_all_data to %s with inherit false, set true"],
      expected: /属于不该属于的角色：pg_read_all_data/,
    },
    {
      label: "少一个角色",
      attributes: "noinherit",
      grants: [TENANT_DB_ROLE, PLATFORM_DB_ROLE].map((role) => `${role} to %s with inherit false, set true`),
      expected: new RegExp(`不能切换到角色：${PREAUTH_DB_ROLE}`),
    },
  ];
  for (const variant of variants) {
    const role = `nz_itest_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
    const password = randomUUID();
    await api.db.owner.query(`create role ${role} login ${variant.attributes} password '${password}'`);
    let pool: Pool | null = null;
    try {
      for (const grant of variant.grants) await api.db.owner.query(`grant ${grant.replace("%s", role)}`);
      const url = new URL(api.db.url);
      url.username = role;
      url.password = password;
      pool = createPool(url.toString(), { max: 1 });
      await assert.rejects(
        withPlatformTx(pool, (db) => db.query("select 1")),
        (err: unknown) => err instanceof DbIdentityError && variant.expected.test(err.message),
        variant.label,
      );
      assert.equal(pool.totalCount, 0, `${variant.label}：不合格的连接应当被销毁，不留在连接池里`);
    } finally {
      await pool?.end();
      await api.db.owner.query(`drop role ${role}`);
    }
  }
});
