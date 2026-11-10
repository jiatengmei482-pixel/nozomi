/**
 * M8-16：`pnpm qa:tenant-ensure`（ADR 0077）。真的启动命令背后的入口文件（密码走标准输入），再用建出的账号走登录接口。
 * - 只允许 staging / local / ci：production 拒绝，不读密码、不建任何东西；
 * - 可以重复运行：已经有了只核对、什么都不改；邮箱不对不建第二家；`--reset-password` 才改密码；
 * - 密码不进命令行参数、输出、审计。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { type TestApi, createTestApi } from "../testing/api.ts";
import { leakedSecrets, testEnv } from "../testing/fixtures.ts";
import { exitWithin, startNode } from "../testing/process.ts";

const ENTRY = fileURLToPath(new URL("./qa-tenant-ensure.ts", import.meta.url));
const EMAIL = "qa-admin@example.com";
const PASSWORD = "Qa-Cli-Created-Passw0rd-1";
const NEW_PASSWORD = "Qa-Cli-Rotated-Passw0rd-2";

let api: TestApi;
before(async () => {
  api = await createTestApi();
});
after(() => api.close());

/** 测试环境（staging）的配置：和 testEnv 一样，只是 APP_ENV 换成 staging */
const stagingEnv = (): Record<string, string> => ({ ...testEnv(api.db.url), APP_ENV: "staging", FX_SOURCE_URL: "https://fx.example.com/v6/latest/USD" });
/** 正式环境（production）的配置：能通过配置校验，命令必须自己拒绝 */
const productionEnv = (): Record<string, string> => ({
  ...testEnv(api.db.url),
  APP_ENV: "production",
  AUTH_JWT_SECRET: "p".repeat(64),
  STRIPE_SECRET_KEY: "",
  STRIPE_PUBLISHABLE_KEY: "",
  STRIPE_WEBHOOK_SECRET: "",
  FX_SOURCE_URL: "https://fx.example.com/v6/latest/USD",
});

async function run(args: string[], input: string | undefined, env: Record<string, string> = stagingEnv()): Promise<{ code: number | null | "timeout"; output: string }> {
  const running = startNode(ENTRY, env, args, input === undefined ? {} : { input });
  const code = await exitWithin(running, 30_000);
  if (code === "timeout") running.child.kill("SIGKILL");
  return { code, output: running.output() };
}

const q = async (sql: string, params: unknown[] = []): Promise<any[]> => (await api.db.owner.query(sql, params)).rows;
const testTenants = (): Promise<any[]> => q("select id, name, status, is_test_tenant, version, updated_at from tenants where is_test_tenant");
const tenantLogin = (password: string) => api.call("POST", "/tenant/v1/auth/login", { body: { email: EMAIL, password } });
async function assertNoPasswordAnywhere(output: string): Promise<void> {
  for (const secret of [PASSWORD, NEW_PASSWORD]) {
    assert.ok(!output.includes(secret), "输出里出现了密码");
    assert.ok(!JSON.stringify(await q("select * from audit_logs")).includes(secret), "审计里出现了密码");
  }
  assert.ok(!api.logs().includes(PASSWORD) && !api.logs().includes(NEW_PASSWORD));
  assert.deepEqual(leakedSecrets(output), []);
}

test("迁移之后、运行命令之前：没有任何供应商（迁移和部署不建 QA 供应商）", async () => {
  assert.deepEqual(await q("select id from tenants"), []);
  assert.deepEqual(await q("select id from tenant_users"), []);
});

test("正式环境（production）：拒绝运行并说清楚，不读密码、不建任何东西", async () => {
  const { code, output } = await run(["--email", EMAIL], `${PASSWORD}\n`, productionEnv());
  assert.equal(code, 1, output);
  assert.match(output, /拒绝运行：当前环境是 production/);
  assert.match(output, /staging/);
  assert.doesNotMatch(output, /设置 QA 测试供应商管理员的密码/);
  assert.deepEqual(await q("select id from tenants"), []);
  await assertNoPasswordAnywhere(output);
});

test("不接受把密码写在命令行参数里：--password 或多余的位置参数都报用法错误，不建", async () => {
  for (const args of [["--email", EMAIL, "--password", PASSWORD], ["--email", EMAIL, PASSWORD], [], ["--email", "不是邮箱"]]) {
    const { code, output } = await run(args, `${PASSWORD}\n`);
    assert.equal(code, 1, output);
    assert.match(output, /用法：pnpm qa:tenant-ensure/);
    assert.ok(!output.includes(PASSWORD));
  }
  assert.deepEqual(await testTenants(), []);
});

test("密码强度不够：不建，说明哪里不够，不回显密码", async () => {
  const { code, output } = await run(["--email", EMAIL], "abc12345\n");
  assert.equal(code, 1);
  assert.match(output, /密码强度不够/);
  assert.ok(!output.includes("abc12345"));
  assert.deepEqual(await testTenants(), []);
});

test("测试环境（staging）第一次运行：建好「QA 测试」供应商（申请中、测试供应商）和在用的管理员；能登录；审计记为系统 / 命令行，没有密码", async () => {
  const { code, output } = await run(["--email", "QA-Admin@Example.com"], `${PASSWORD}\n`);
  assert.equal(code, 0, output);
  assert.match(output, /已建好 QA 测试供应商「QA 测试供应商（验收专用）」/);
  assert.match(output, /管理员：qa-admin@example\.com/);
  await assertNoPasswordAnywhere(output);

  const [tenant] = await testTenants();
  assert.deepEqual([tenant.name, tenant.status, tenant.is_test_tenant], ["QA 测试供应商（验收专用）", "applying", true]);
  const users = await q("select email, role, status, must_change_password, password_hash from tenant_users where tenant_id = $1", [tenant.id]);
  assert.equal(users.length, 1);
  assert.deepEqual([users[0].email, users[0].role, users[0].status, users[0].must_change_password], [EMAIL, "admin", "active", false]);
  assert.match(users[0].password_hash, /^scrypt\$1\$/);

  const login = await tenantLogin(PASSWORD);
  assert.equal(login.status, 200, login.text);
  assert.deepEqual([login.body.tenant.is_test_tenant, login.body.tenant.status], [true, "applying"]);

  const audit = await q("select actor_type, source, ip, resource, action, after from audit_logs where tenant_id = $1 order by id", [tenant.id]);
  assert.deepEqual(
    audit.filter((row) => row.action === "create").map((row) => [row.actor_type, row.source, row.ip, row.resource, row.after]),
    [
      ["system", "cli", null, "tenant", { name: "QA 测试供应商（验收专用）", status: "applying", is_test_tenant: true }],
      ["system", "cli", null, "tenant_user", { email: EMAIL, name: "QA 验收管理员", role: "admin", status: "active" }],
    ],
  );
});

test("再运行一次（同一个邮箱）：只核对、报告，什么都不改；不读密码（管道里给了别的密码也不用）", async () => {
  const [before] = await testTenants();
  const hashBefore = (await q("select password_hash from tenant_users where email = $1", [EMAIL]))[0].password_hash;
  const auditBefore = (await q("select count(*)::int as n from audit_logs"))[0].n;
  for (const input of [undefined, `${NEW_PASSWORD}\n`]) {
    const { code, output } = await run(["--email", EMAIL], input);
    assert.equal(code, 0, output);
    assert.match(output, /已经存在，没有做任何改动/);
    assert.match(output, /核对通过/);
    assert.doesNotMatch(output, /设置 QA 测试供应商管理员的密码/);
    await assertNoPasswordAnywhere(output);
  }
  assert.deepEqual(await testTenants(), [before]);
  assert.equal((await q("select password_hash from tenant_users where email = $1", [EMAIL]))[0].password_hash, hashBefore);
  assert.equal((await q("select count(*)::int as n from audit_logs"))[0].n, auditBefore);
  assert.equal((await tenantLogin(PASSWORD)).status, 200);
  assert.equal((await tenantLogin(NEW_PASSWORD)).status, 401);
});

test("换一个邮箱运行：不建第二家、不加账号，说明已有的那家和它的管理员", async () => {
  const { code, output } = await run(["--email", "someone-else@example.com"], `${PASSWORD}\n`);
  assert.equal(code, 1, output);
  assert.match(output, /已经有一家 QA 测试供应商「QA 测试供应商（验收专用）」，这个邮箱不是它的账号（它的管理员：qa-admin@example\.com）/);
  assert.equal((await testTenants()).length, 1);
  assert.equal((await q("select count(*)::int as n from tenant_users"))[0].n, 1);
  await assertNoPasswordAnywhere(output);
});

test("核对发现问题（管理员被停用）：报告出来、退出码 2，不自动修改", async () => {
  await q("update tenant_users set status = 'disabled' where email = $1", [EMAIL]);
  try {
    const { code, output } = await run(["--email", EMAIL], undefined);
    assert.equal(code, 2, output);
    assert.match(output, /核对发现问题/);
    assert.match(output, /disabled/);
    assert.equal((await q("select status from tenant_users where email = $1", [EMAIL]))[0].status, "disabled");
  } finally {
    await q("update tenant_users set status = 'active' where email = $1", [EMAIL]);
  }
});

test("--reset-password：从标准输入读新密码；旧密码和旧的登录都失效，新密码能登录；审计只记「重设密码」，没有密码", async () => {
  const oldToken = (await tenantLogin(PASSWORD)).body.access_token as string;
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: oldToken })).status, 200);
  const { code, output } = await run(["--email", EMAIL, "--reset-password"], `${NEW_PASSWORD}\n`);
  assert.equal(code, 0, output);
  assert.match(output, /已重设 qa-admin@example\.com 的密码/);
  await assertNoPasswordAnywhere(output);
  assert.equal((await tenantLogin(PASSWORD)).status, 401);
  assert.equal((await tenantLogin(NEW_PASSWORD)).status, 200);
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: oldToken })).status, 401);
  const audit = await q("select actor_type, source, after from audit_logs where resource = 'tenant_user' and action = 'reset_password'");
  assert.deepEqual(audit, [{ actor_type: "system", source: "cli", after: null }]);
  assert.equal((await testTenants()).length, 1);

  const weak = await run(["--email", EMAIL, "--reset-password"], "short\n");
  assert.equal(weak.code, 1);
  assert.match(weak.output, /密码强度不够/);
  assert.equal((await tenantLogin(NEW_PASSWORD)).status, 200);
});

test("package.json 里有 qa:tenant-ensure 命令，指向这个入口，命令行里没有密码参数", async () => {
  const pkg = JSON.parse(await readFile(new URL("../../../../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
  assert.equal(pkg.scripts["qa:tenant-ensure"], "node --env-file-if-exists=.env apps/api/src/cli/qa-tenant-ensure.ts");
});
