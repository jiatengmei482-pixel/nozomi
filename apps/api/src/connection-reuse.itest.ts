/**
 * 连接复用会不会造成租户串号（ADR 0009 的核心假设：角色和 app.tenant_id 都是事务级的，连接还回连接池不残留）。
 * rls.itest.ts 验证了「一次正常事务 + 一次回滚」之后不残留；这里专门构造更恶劣的场景：
 * 只有 1 条连接的连接池、并发、各种出错回滚、连接中途被断开、租户编号不合法，
 * 以及不设 / 设空 / 设错租户时对每一张租户表的读和写。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.ts";
import { APP_DB_ROLE, withSystemTx, withTenantTx } from "./db/context.ts";
import { loadMigrationFiles } from "./db/migrate.ts";
import { type Pool, createPool } from "./db/pool.ts";
import { type TenantFixture, type TestApi, createTestApi } from "./testing/api.ts";
import { testConfig } from "./testing/fixtures.ts";
import { exitWithin, startNode } from "./testing/process.ts";

const CHILD = fileURLToPath(new URL("./testing/tx-connection-loss-child.ts", import.meta.url));

let api: TestApi;
let platformToken: string;
let a: TenantFixture;
let b: TenantFixture;
const extraPools: Pool[] = [];
const extraApps: FastifyInstance[] = [];

before(async () => {
  api = await createTestApi();
  platformToken = await api.superAdminToken();
  a = await api.tenantWithAdmin(platformToken, "车队甲", "admin@a.test");
  b = await api.tenantWithAdmin(platformToken, "车队乙", "admin@b.test");
  // 只发邀请、不激活：让两边的账号列表长度不同，又不增加密码哈希的耗时
  for (const email of ["one@a.test", "two@a.test"]) {
    const res = await api.call("POST", "/tenant/v1/users", { token: a.adminToken, body: { email, name: email, role: "readonly" } });
    assert.equal(res.status, 201, res.text);
  }
  const res = await api.call("POST", "/tenant/v1/users", { token: b.adminToken, body: { email: "one@b.test", name: "乙一", role: "dispatch" } });
  assert.equal(res.status, 201, res.text);
});

after(async () => {
  for (const app of extraApps) await app.close();
  for (const pool of extraPools) await pool.end();
  await api.close();
});

function poolOf(max: number): Pool {
  const pool = createPool(api.db.url, { max });
  extraPools.push(pool);
  return pool;
}

/** 用同一个库、同一把签名密钥、同一个时钟，但连接池大小由测试指定的应用。 */
async function appOn(pool: Pool): Promise<FastifyInstance> {
  const app = buildApp({ config: testConfig(api.db.url), pool, migrationFiles: await loadMigrationFiles(), now: api.clock.now, logger: false });
  extraApps.push(app);
  return app;
}

interface Reply {
  status: number;
  body: any;
  text: string;
}

async function send(
  app: FastifyInstance,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  options: { token?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Reply> {
  const res = await app.inject({
    method,
    url,
    headers: { ...(options.token === undefined ? {} : { authorization: `Bearer ${options.token}` }), ...options.headers },
    ...(options.body === undefined ? {} : { payload: options.body as object }),
  });
  let body: unknown = null;
  try {
    body = res.body === "" ? null : res.json();
  } catch {
    body = null;
  }
  return { status: res.statusCode, body, text: res.body };
}

/** 把连接池里的连接全部取出来，逐条核对：角色是连接本身的账号，没有残留的租户设置，也没有没结束的事务。 */
async function assertPoolClean(pool: Pool, max: number): Promise<void> {
  const clients = await Promise.all(Array.from({ length: max }, () => pool.connect()));
  try {
    for (const client of clients) {
      const state = await client.query(
        `select current_user = session_user as same_role,
                coalesce(current_setting('app.tenant_id', true), '') as tenant,
                pg_current_xact_id_if_assigned() is null as no_write_tx,
                (select count(*)::int from tenants) as visible_tenants`,
      );
      assert.deepEqual(state.rows[0], { same_role: true, tenant: "", no_write_tx: true, visible_tenants: 2 });
    }
  } finally {
    for (const client of clients) client.release();
  }
}

async function snapshotOfB(): Promise<unknown> {
  const users = await api.db.pool.query(
    "select id, email, name, role, status, updated_at from tenant_users where tenant_id = $1 order by email",
    [b.tenantId],
  );
  const tenant = await api.db.pool.query("select name, status, updated_at from tenants where id = $1", [b.tenantId]);
  return { users: users.rows, tenant: tenant.rows };
}

type Check = (app: FastifyInstance) => Promise<void>;

/** 一批互相穿插的请求：两个租户的读、平台的跨租户读、各种在事务里失败并回滚的写。每个都核对「只看到自己」。 */
function mixedRequests(): Check[] {
  const emailsOf = (reply: Reply): string[] => (reply.body.items as { email: string }[]).map((item) => item.email);
  const listA: Check = async (app) => {
    const res = await send(app, "GET", "/tenant/v1/users", { token: a.adminToken });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(emailsOf(res).sort(), ["admin@a.test", "one@a.test", "two@a.test"]);
  };
  const listB: Check = async (app) => {
    const res = await send(app, "GET", "/tenant/v1/users", { token: b.adminToken });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(emailsOf(res).sort(), ["admin@b.test", "one@b.test"]);
  };
  const meA: Check = async (app) => {
    const res = await send(app, "GET", "/tenant/v1/auth/me", { token: a.adminToken });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.tenant.id, a.tenantId);
    assert.equal(res.body.user.email, "admin@a.test");
  };
  const meB: Check = async (app) => {
    const res = await send(app, "GET", "/tenant/v1/auth/me", { token: b.adminToken });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.tenant.id, b.tenantId);
    assert.equal(res.body.user.email, "admin@b.test");
  };
  const platformTenants: Check = async (app) => {
    const res = await send(app, "GET", "/platform/v1/tenants", { token: platformToken });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual((res.body.items as { id: string }[]).map((item) => item.id).sort(), [a.tenantId, b.tenantId].sort());
  };
  const platformAudit: Check = async (app) => {
    const res = await send(app, "GET", `/platform/v1/audit-logs?tenant_id=${b.tenantId}&limit=5`, { token: platformToken });
    assert.equal(res.status, 200, res.text);
    assert.ok(res.body.items.length > 0);
    assert.ok((res.body.items as { tenant_id: string }[]).every((item) => item.tenant_id === b.tenantId));
  };
  const aChangesB: Check = async (app) => {
    const res = await send(app, "PUT", `/tenant/v1/users/${b.adminId}`, {
      token: a.adminToken,
      body: { name: "被甲改了", role: "readonly", status: "disabled" },
    });
    assert.equal(res.status, 404, res.text);
  };
  const aDisablesB: Check = async (app) => {
    const res = await send(app, "DELETE", `/tenant/v1/users/${b.adminId}`, { token: a.adminToken });
    assert.equal(res.status, 404, res.text);
  };
  const aDemotesItself: Check = async (app) => {
    const res = await send(app, "PUT", `/tenant/v1/users/${a.adminId}`, {
      token: a.adminToken,
      body: { name: "车队甲管理员", role: "readonly", status: "active" },
    });
    assert.equal(res.status, 409, res.text);
    assert.equal(res.body.error.code, "LAST_ADMIN_REQUIRED");
  };
  const aInvitesEmailOfB: Check = async (app) => {
    // 在租户甲的事务里撞上全平台唯一的邮箱索引：事务进入失败状态后回滚
    const res = await send(app, "POST", "/tenant/v1/users", {
      token: a.adminToken,
      body: { email: "admin@b.test", name: "抢注", role: "admin" },
    });
    assert.equal(res.status, 409, res.text);
  };
  const bInvitesEmailOfA: Check = async (app) => {
    const res = await send(app, "POST", "/tenant/v1/users", {
      token: b.adminToken,
      body: { email: "one@a.test", name: "抢注", role: "admin" },
    });
    assert.equal(res.status, 409, res.text);
  };
  const anonymous: Check = async (app) => {
    const res = await send(app, "GET", "/tenant/v1/users");
    assert.equal(res.status, 401, res.text);
  };
  const aClaimsToBeB: Check = async (app) => {
    // 查询串、请求头里自称是租户乙：不生效
    const res = await send(app, "GET", `/tenant/v1/users?tenant_id=${b.tenantId}&tenantId=${b.tenantId}`, {
      token: a.adminToken,
      headers: { "x-tenant-id": b.tenantId, "x-tenant": b.tenantId, tenant_id: b.tenantId },
    });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(emailsOf(res).sort(), ["admin@a.test", "one@a.test", "two@a.test"]);
  };
  return [
    listA, listB, meA, meB, platformTenants, platformAudit,
    aChangesB, aDisablesB, aDemotesItself, aInvitesEmailOfB, bInvitesEmailOfA, anonymous, aClaimsToBeB,
  ];
}

for (const max of [1, 3]) {
  test(`连接池只有 ${max} 条连接：两个租户、平台、出错回滚的请求并发穿插 ${max === 1 ? "（全部挤在同一条连接上）" : ""}，谁也看不到别人的数据，连接上不残留角色和租户`, async () => {
    const pool = poolOf(max);
    const app = await appOn(pool);
    const before = await snapshotOfB();
    const checks = mixedRequests();
    for (let round = 0; round < 3; round += 1) {
      // 每一轮换一个起点，让同一条连接上前后相邻的请求组合都不一样
      const batch = Array.from({ length: checks.length * 3 }, (_, i) => checks[(i * 5 + round) % checks.length] as Check);
      await Promise.all(batch.map((check) => check(app)));
    }
    // 顺序执行一遍「失败的租户写 → 紧接着别的租户读 / 平台读」
    for (const check of checks) {
      await check(app);
      await mixedRequests()[1]?.(app);
      await mixedRequests()[4]?.(app);
    }
    assert.deepEqual(await snapshotOfB(), before, "租户乙的数据被动过");
    assert.equal(pool.totalCount <= max, true);
    await assertPoolClean(pool, max);
  });
}

class Deliberate extends Error {}

test("同一条连接上：出错的租户事务（SQL 报错、违反行级安全、回调抛错）之后，下一个事务既不带着上一个租户，也不带着应用角色", async () => {
  const pool = poolOf(1);
  const visibleTenants = async (run: <T>(fn: Parameters<typeof withSystemTx<T>>[1]) => Promise<T>): Promise<string[]> => {
    const rows = await run((db) => db.query<{ tenant_id: string }>("select distinct tenant_id from tenant_users order by 1"));
    return rows.rows.map((row) => row.tenant_id);
  };
  const asSystem = <T>(fn: Parameters<typeof withSystemTx<T>>[1]): Promise<T> => withSystemTx(pool, fn);
  const asTenant = (tenantId: string) => <T>(fn: Parameters<typeof withSystemTx<T>>[1]): Promise<T> => withTenantTx(pool, tenantId, fn);
  const both = [a.tenantId, b.tenantId].sort();

  const failures: [string, Parameters<typeof withSystemTx<unknown>>[1], object][] = [
    ["SQL 报错（表不存在）", (db) => db.query("select * from no_such_table"), { code: "42P01" }],
    [
      "往别的租户写（违反行级安全）",
      (db) => db.query("insert into tenant_users (tenant_id, email, name, role, status) values ($1, 'spy@a.test', '卧底', 'admin', 'invited')", [b.tenantId]),
      { code: "42501" },
    ],
    ["读平台表（没有权限）", (db) => db.query("select * from platform_users"), { code: "42501" }],
    [
      "写了一半之后回调抛错",
      async (db) => {
        await db.query("update tenant_users set name = '半途而废' where tenant_id = $1", [a.tenantId]);
        throw new Deliberate();
      },
      { name: "Error" },
    ],
    [
      "SQL 报错之后回调把错误吞掉、正常返回（提交一个已失败的事务）",
      async (db) => {
        await db.query("update tenant_users set name = '不该留下' where tenant_id = $1", [a.tenantId]);
        await db.query("select 1/0").catch(() => undefined);
      },
      {},
    ],
  ];
  for (const [label, fn] of failures) {
    await withTenantTx(pool, a.tenantId, fn).catch(() => undefined);
    assert.deepEqual(await visibleTenants(asSystem), both, `${label} 之后：系统事务应该看得到全部租户`);
    assert.deepEqual(await visibleTenants(asTenant(b.tenantId)), [b.tenantId], `${label} 之后：租户乙的事务只该看到乙`);
    assert.deepEqual(await visibleTenants(asTenant(a.tenantId)), [a.tenantId], `${label} 之后：租户甲的事务只该看到甲`);
  }
  // 出错的系统事务之后，租户事务照样降权
  await withSystemTx(pool, (db) => db.query("select 1/0")).catch(() => undefined);
  const inTenant = await withTenantTx(pool, b.tenantId, (db) =>
    db.query("select current_user::text as role, current_setting('app.tenant_id') as tenant"),
  );
  assert.deepEqual(inTenant.rows[0], { role: APP_DB_ROLE, tenant: b.tenantId });
  await assert.rejects(withTenantTx(pool, b.tenantId, (db) => db.query("select 1 from platform_users")), { code: "42501" });

  const names = await api.db.pool.query("select name from tenant_users where name in ('半途而废', '不该留下', '卧底')");
  assert.equal(names.rows.length, 0, "失败的事务里的写入没有回滚");
  await assertPoolClean(pool, 1);
});

test("并发的租户事务和系统事务共用 2 条连接：每个事务里看到的角色、租户、数据都是自己的", async () => {
  const pool = poolOf(2);
  const jobs = Array.from({ length: 60 }, (_, i) => async () => {
    const pause = (i * 7) % 5;
    if (i % 3 === 2) {
      const rows = await withSystemTx(pool, async (db) => {
        await db.query("select pg_sleep($1::float / 1000)", [pause]);
        return db.query("select current_user = session_user as same_role, (select count(distinct tenant_id)::int from tenant_users) as tenants");
      });
      assert.deepEqual(rows.rows[0], { same_role: true, tenants: 2 });
      return;
    }
    const tenantId = i % 3 === 0 ? a.tenantId : b.tenantId;
    const fails = i % 4 === 0;
    const work = withTenantTx(pool, tenantId, async (db) => {
      await db.query("select pg_sleep($1::float / 1000)", [pause]);
      const rows = await db.query(
        `select current_user::text as role, current_setting('app.tenant_id') as tenant,
                (select array_agg(distinct tenant_id::text) from tenant_users) as user_tenants,
                (select array_agg(distinct tenant_id::text) from audit_logs) as audit_tenants,
                (select array_agg(id::text) from tenants) as tenant_rows`,
      );
      assert.deepEqual(rows.rows[0], {
        role: APP_DB_ROLE,
        tenant: tenantId,
        user_tenants: [tenantId],
        audit_tenants: [tenantId],
        tenant_rows: [tenantId],
      });
      if (fails) await db.query("select 1/0");
    });
    if (fails) await assert.rejects(work, { code: "22012" });
    else await work;
  });
  await Promise.all(jobs.map((job) => job()));
  await assertPoolClean(pool, 2);
});

test("租户编号不合法（空串、不是 UUID、SQL 片段）：读不到任何数据或直接报错，不会退化成「不限租户」，连接上也不残留", async () => {
  const pool = poolOf(1);
  const empty = await withTenantTx(pool, "", (db) => db.query("select 1 from tenant_users"));
  assert.equal(empty.rows.length, 0);
  for (const bad of ["not-a-uuid", `${b.tenantId}' or '1'='1`, `${a.tenantId},${b.tenantId}`, "null", "%"]) {
    await assert.rejects(withTenantTx(pool, bad, (db) => db.query("select 1 from tenant_users")), { code: "22P02" }, bad);
  }
  const unknown = await withTenantTx(pool, randomUUID(), (db) => db.query("select 1 from tenant_users"));
  assert.equal(unknown.rows.length, 0);
  await assertPoolClean(pool, 1);
});

test("应用角色在不设 / 设空 / 设成不存在的租户时：每一张租户表都读不到一行，写入一律被拒绝或影响 0 行", async () => {
  const tenantTables = ["tenant_users", "tenant_sessions", "audit_logs", "tenants"];
  const writes: [string, string, unknown[]][] = [
    ["tenant_users", "insert into tenant_users (tenant_id, email, name, role, status) values ($1, 'ghost@a.test', '幽灵', 'admin', 'invited')", [a.tenantId]],
    ["tenant_sessions", "insert into tenant_sessions (tenant_id, id, user_id, created_at, expires_at) values ($1, gen_random_uuid(), $2, now(), now() + interval '1 hour')", [a.tenantId, a.adminId]],
    ["audit_logs", "insert into audit_logs (occurred_at, tenant_id, actor_type, source, resource, action) values (now(), $1, 'tenant_user', 'console', 'tenant_user', 'login')", [a.tenantId]],
    ["audit_logs（平台级）", "insert into audit_logs (occurred_at, tenant_id, actor_type, source, resource, action) values (now(), null, 'tenant_user', 'console', 'tenant_user', 'login')", []],
    ["tenants", "insert into tenants (name, status) values ('幽灵租户', 'active')", []],
  ];
  const settings: [string, string | null][] = [
    ["不设租户", null],
    ["租户设成空串", ""],
    ["租户设成不存在的编号", randomUUID()],
  ];
  const client = await api.db.pool.connect();
  try {
    for (const [label, tenant] of settings) {
      await client.query("begin");
      await client.query(`set local role ${APP_DB_ROLE}`);
      if (tenant !== null) await client.query("select set_config('app.tenant_id', $1, true)", [tenant]);
      for (const table of tenantTables) {
        const rows = await client.query(`select 1 from ${table}`);
        assert.equal(rows.rows.length, 0, `${label}：${table} 读到了数据`);
      }
      const updated = await client.query("update tenant_users set name = '被改了'");
      assert.equal(updated.rowCount, 0, `${label}：update 影响到了行`);
      const deleted = await client.query("delete from tenant_sessions");
      assert.equal(deleted.rowCount, 0, `${label}：delete 影响到了行`);
      for (const [table, sql, values] of writes) {
        await client.query("savepoint attempt");
        await assert.rejects(client.query(sql, values), { code: "42501" }, `${label}：往 ${table} 写入没有被拒绝`);
        await client.query("rollback to savepoint attempt");
      }
      await client.query("rollback");
    }
  } finally {
    client.release();
  }
  const ghosts = await api.db.pool.query("select 1 from tenant_users where email = 'ghost@a.test' union all select 1 from tenants where name = '幽灵租户'");
  assert.equal(ghosts.rows.length, 0);
});

/**
 * 缺陷：inTransaction 里 `begin; set local role nozomi_app` 这一步失败时（begin 已经成功、切换角色失败），
 * 没有回滚就把连接还回了连接池。这条连接从此停在「事务已失败」的状态，之后分到它的每个请求都会 25P02 报错。
 * 这里用一个没有被授予 nozomi_app 的数据库账号来稳定地复现「切换角色失败」。
 */
test("租户事务在切换角色这一步失败后，连接不能带着没结束的事务回到连接池（之后的系统事务应当照常可用）", async () => {
  const role = `nz_itest_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const password = randomUUID();
  await api.db.pool.query(`create role ${role} login password '${password}'`);
  let pool: Pool | null = null;
  try {
    await api.db.pool.query(`grant usage on schema ${api.db.schema} to ${role}`);
    await api.db.pool.query(`grant select on tenants, tenant_roles to ${role}`);
    const url = new URL(api.db.url);
    url.username = role;
    url.password = password;
    pool = createPool(url.toString(), { max: 1 });
    const only = pool;
    await assert.rejects(withTenantTx(only, a.tenantId, (db) => db.query("select 1")), { code: "42501" });
    // 这个临时账号不是表的所有者，行级安全对它同样生效：没设租户时 tenants 一行都看不到（0 行，不是 2 行）。
    // 所以「连接照常可用」用一张没有行级安全的表（角色清单，固定 5 行）来确认。
    const after = await withSystemTx(only, async (db) => ({
      roles: (await db.query<{ n: number }>("select count(*)::int as n from tenant_roles")).rows[0]?.n,
      tenants: (await db.query<{ n: number }>("select count(*)::int as n from tenants")).rows[0]?.n,
    }));
    assert.deepEqual(after, { roles: 5, tenants: 0 });
  } finally {
    await pool?.end();
    await api.db.pool.query(`drop owned by ${role}`);
    await api.db.pool.query(`drop role ${role}`);
  }
});

/**
 * 缺陷：withTenantTx / withSystemTx 用 pool.connect() 取出的连接上没有挂 error 监听。
 * 事务进行中数据库断开这条连接（数据库重启、故障切换、网络中断）时，驱动在连接上发出 error 事件，
 * 没有监听就成了未捕获的异常，整个 API 进程退出，其他正在处理的请求一起中断。
 */
for (const kind of ["system", "tenant"] as const) {
  for (const moment of ["idle", "querying"] as const) {
    test(`${kind === "tenant" ? "租户" : "系统"}事务进行中连接被数据库断开（${moment === "idle" ? "两条语句之间" : "语句执行中"}）：这个请求失败，但进程不能崩，连接池之后照常可用`, async () => {
      const running = startNode(CHILD, { DATABASE_URL: api.db.url }, [kind, moment, a.tenantId]);
      const code = await exitWithin(running, 20_000);
      if (code === "timeout") running.child.kill("SIGKILL");
      assert.equal(code, 0, `进程异常退出：\n${running.output().slice(0, 600)}`);
      const lastLine = running.output().trim().split("\n").at(-1) ?? "";
      assert.deepEqual(JSON.parse(lastLine), { survived: true, failed: true, recovered: true });
    });
  }
}
