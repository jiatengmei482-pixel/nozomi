/**
 * `pnpm db:provision` 建出来的应用账号（ADR 0010）：连真实 PostgreSQL，用建好的账号和密码真的登录。
 * 角色是整个数据库实例共用的，所以这里每个测试用一个随机名字的临时账号，结束时删除，不碰别的测试在用的账号。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { withPlatformTx, withTenantTx } from "./context.ts";
import { identityProblems, inspectDbIdentity } from "./identity.ts";
import { type Pool, createPool } from "./pool.ts";
import { ProvisionError, provisionAppAccount } from "./provision.ts";
import { DB_ROLES } from "./roles.ts";
import { type TestDatabase, createMigratedTestDatabase } from "../testing/db.ts";
import { exitWithin, startNode } from "../testing/process.ts";

const ENTRY = fileURLToPath(new URL("./provision-cli.ts", import.meta.url));

let db: TestDatabase;
const temporaryRoles: string[] = [];

before(async () => {
  db = await createMigratedTestDatabase();
});
after(async () => {
  for (const role of temporaryRoles) await db.owner.query(`drop role if exists ${role}`);
  await db.drop();
});

function temporaryRole(): string {
  const role = `nz_itest_${randomBytes(8).toString("hex")}`;
  temporaryRoles.push(role);
  return role;
}

/** 明显是占位的随机密码：只在本次测试的临时账号上用。 */
function placeholderPassword(): string {
  return `placeholder-${randomBytes(9).toString("hex")}`;
}

function urlFor(role: string, password: string): string {
  const url = new URL(db.url);
  url.username = role;
  url.password = password;
  return url.toString();
}

async function withPoolAs<T>(role: string, password: string, fn: (pool: Pool) => Promise<T>): Promise<T> {
  const pool = createPool(urlFor(role, password), { max: 1, connectionTimeoutMs: 3_000 });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

test("新建应用账号：能用这个密码登录，自检合格，能跑平台事务和租户事务；数据库里存的是校验值不是密码", async () => {
  const role = temporaryRole();
  const password = placeholderPassword();
  assert.deepEqual(await provisionAppAccount(db.owner, { role, password }), { role, created: true });

  await withPoolAs(role, password, async (pool) => {
    assert.deepEqual(identityProblems(await inspectDbIdentity(pool)), []);
    const tenants = await withPlatformTx(pool, (tx) => tx.query<{ n: number }>("select count(*)::int as n from tenants"));
    assert.equal(tenants.rows[0]?.n, 0);
    const inTenant = await withTenantTx(pool, "00000000-0000-4000-8000-000000000001", (tx) =>
      tx.query<{ role: string }>("select current_user::text as role"),
    );
    assert.equal(inTenant.rows[0]?.role, "nozomi_app");
  });

  const stored = await db.owner.query<{ rolpassword: string }>("select rolpassword from pg_authid where rolname = $1", [role]);
  assert.match(stored.rows[0]?.rolpassword ?? "", /^SCRAM-SHA-256\$4096:/);
  assert.ok(!(stored.rows[0]?.rolpassword ?? "").includes(password));
});

test("重复运行：不报错，账号还是那个；换了密码后旧密码登录不了、新密码可以", async () => {
  const role = temporaryRole();
  const first = placeholderPassword();
  const second = placeholderPassword();
  await provisionAppAccount(db.owner, { role, password: first });
  assert.deepEqual(await provisionAppAccount(db.owner, { role, password: first }), { role, created: false });
  await withPoolAs(role, first, (pool) => pool.query("select 1"));

  assert.deepEqual(await provisionAppAccount(db.owner, { role, password: second }), { role, created: false });
  await assert.rejects(withPoolAs(role, first, (pool) => pool.query("select 1")), { code: "28P01" });
  await withPoolAs(role, second, async (pool) => {
    assert.deepEqual(identityProblems(await inspectDbIdentity(pool)), []);
  });
});

test("已有的账号被改歪了（自动继承、多属于一个角色、少一个角色）：再运行一次就改回最小权限", async () => {
  const role = temporaryRole();
  const password = placeholderPassword();
  await provisionAppAccount(db.owner, { role, password });
  await db.owner.query(`alter role ${role} inherit`);
  await db.owner.query(`grant nozomi_platform to ${role} with inherit true`);
  await db.owner.query(`grant pg_read_all_data to ${role}`);
  await db.owner.query(`revoke nozomi_preauth from ${role}`);
  await withPoolAs(role, password, async (pool) => {
    assert.equal(identityProblems(await inspectDbIdentity(pool)).length, 3, "前提：这个账号现在不合格");
  });

  await provisionAppAccount(db.owner, { role, password });
  await withPoolAs(role, password, async (pool) => {
    assert.deepEqual(identityProblems(await inspectDbIdentity(pool)), []);
  });
  const memberships = await db.owner.query<{ role: string; inherit_option: boolean; set_option: boolean }>(
    `select g.rolname::text as role, m.inherit_option, m.set_option
       from pg_auth_members m join pg_roles g on g.oid = m.roleid join pg_roles u on u.oid = m.member
      where u.rolname = $1 order by 1`,
    [role],
  );
  assert.deepEqual(
    memberships.rows,
    [...DB_ROLES].sort().map((name) => ({ role: name, inherit_option: false, set_option: true })),
  );
});

test("两个进程同时建同一个账号：都成功，账号合格", async () => {
  const role = temporaryRole();
  const password = placeholderPassword();
  const second = createPool(db.ownerUrl, { max: 1 });
  try {
    const results = await Promise.all([provisionAppAccount(db.owner, { role, password }), provisionAppAccount(second, { role, password })]);
    assert.deepEqual(results.map((result) => result.created).sort(), [false, true]);
  } finally {
    await second.end();
  }
  await withPoolAs(role, password, async (pool) => {
    assert.deepEqual(identityProblems(await inspectDbIdentity(pool)), []);
  });
});

test("不去降级已有的特权账号：账号名和迁移账号相同、或已有账号带特殊权限 / 拥有表时报错，账号保持原样", async () => {
  const migrationLogin = new URL(db.ownerUrl).username;
  await assert.rejects(
    provisionAppAccount(db.owner, { role: migrationLogin, password: placeholderPassword() }),
    (err: unknown) => err instanceof ProvisionError && err.code === "PROVISION_ROLE_IS_PRIVILEGED",
  );

  const privileged = temporaryRole();
  await db.owner.query(`create role ${privileged} nologin createdb`);
  const owner = temporaryRole();
  await db.owner.query(`create role ${owner} nologin`);
  await db.owner.query(`create table itest_owned (id int)`);
  await db.owner.query(`alter table itest_owned owner to ${owner}`);
  try {
    for (const role of [privileged, owner]) {
      await assert.rejects(
        provisionAppAccount(db.owner, { role, password: placeholderPassword() }),
        (err: unknown) => err instanceof ProvisionError && err.code === "PROVISION_ROLE_IS_PRIVILEGED",
        role,
      );
    }
    const unchanged = await db.owner.query(
      "select rolname::text as name, rolcanlogin, rolcreatedb, rolpassword is null as no_password from pg_authid where rolname = any($1::text[]) order by 1",
      [[privileged, owner]],
    );
    assert.deepEqual(
      unchanged.rows,
      [
        { name: privileged, rolcanlogin: false, rolcreatedb: true, no_password: true },
        { name: owner, rolcanlogin: false, rolcreatedb: false, no_password: true },
      ].sort((x, y) => x.name.localeCompare(y.name)),
    );
  } finally {
    await db.owner.query("drop table itest_owned");
  }
});

test("迁移账号没有建角色的权限：报 PROVISION_INSUFFICIENT_PRIVILEGE，不建账号", async () => {
  const weak = temporaryRole();
  const weakPassword = placeholderPassword();
  await db.owner.query(`create role ${weak} login password '${weakPassword}'`);
  const target = temporaryRole();
  await withPoolAs(weak, weakPassword, async (pool) => {
    await assert.rejects(
      provisionAppAccount(pool, { role: target, password: placeholderPassword() }),
      (err: unknown) => err instanceof ProvisionError && err.code === "PROVISION_INSUFFICIENT_PRIVILEGE",
    );
  });
  const created = await db.owner.query("select 1 from pg_roles where rolname = $1", [target]);
  assert.equal(created.rows.length, 0);
});

test("命令行：从环境变量读两个连接串，输出里只有账号名，没有密码和连接串；缺连接串、两个连接串同账号时报配置错误", async () => {
  const role = temporaryRole();
  const password = placeholderPassword();
  const run = async (env: Record<string, string>): Promise<{ code: number | null | "timeout"; output: string }> => {
    const running = startNode(ENTRY, env);
    const code = await exitWithin(running, 20_000);
    if (code === "timeout") running.child.kill("SIGKILL");
    return { code, output: running.output() };
  };
  const ok = await run({ DATABASE_MIGRATION_URL: db.ownerUrl, DATABASE_URL: urlFor(role, password) });
  assert.equal(ok.code, 0, ok.output);
  assert.match(ok.output, new RegExp(`已创建应用账号 ${role}`));
  assert.ok(!ok.output.includes(password) && !ok.output.includes("postgres://") && !ok.output.includes("SCRAM-SHA-256"));
  const again = await run({ DATABASE_MIGRATION_URL: db.ownerUrl, DATABASE_URL: urlFor(role, password) });
  assert.equal(again.code, 0, again.output);
  assert.match(again.output, new RegExp(`已更新应用账号 ${role}`));
  await withPoolAs(role, password, (pool) => pool.query("select 1"));

  const missingApp = await run({ DATABASE_MIGRATION_URL: db.ownerUrl });
  assert.equal(missingApp.code, 1);
  assert.match(missingApp.output, /DATABASE_URL/);
  const missingMigration = await run({ DATABASE_URL: urlFor(role, password) });
  assert.equal(missingMigration.code, 1);
  assert.match(missingMigration.output, /DATABASE_MIGRATION_URL/);
  const same = await run({ DATABASE_MIGRATION_URL: db.ownerUrl, DATABASE_URL: db.ownerUrl });
  assert.equal(same.code, 1);
  assert.match(same.output, /不能是同一个数据库账号/);
  for (const result of [missingApp, missingMigration, same]) {
    assert.ok(!result.output.includes(password) && !result.output.includes("postgres://"));
  }
});

test("package.json 里有 db:provision 命令，指向这个入口，命令行里没有密码参数", async () => {
  const pkg = JSON.parse(await readFile(new URL("../../../../package.json", import.meta.url), "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.equal(pkg.scripts["db:provision"], "node --env-file-if-exists=.env apps/api/src/db/provision-cli.ts");
});
