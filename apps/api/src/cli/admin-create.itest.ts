/**
 * 验收标准 1：平台管理员通过命令行创建，不预置任何账号。
 * 真的启动 `pnpm admin:create` 背后的入口文件（密码走标准输入），再用创建出的账号走登录接口。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { type TestApi, createTestApi } from "../testing/api.ts";
import { type TestDatabase, createTestDatabase } from "../testing/db.ts";
import { leakedSecrets, testEnv } from "../testing/fixtures.ts";
import { exitWithin, startNode } from "../testing/process.ts";

const ENTRY = fileURLToPath(new URL("./admin-create.ts", import.meta.url));
const PASSWORD = "Cli-Created-Passw0rd";

let api: TestApi;
before(async () => {
  api = await createTestApi();
});
after(() => api.close());

async function run(args: string[], input: string | undefined, databaseUrl = api.db.url): Promise<{ code: number | null | "timeout"; output: string }> {
  const running = startNode(ENTRY, testEnv(databaseUrl), args, input === undefined ? {} : { input });
  const code = await exitWithin(running, 20_000);
  if (code === "timeout") running.child.kill("SIGKILL");
  return { code, output: running.output() };
}

async function adminCount(): Promise<number> {
  return (await api.db.owner.query("select count(*)::int as n from platform_users")).rows[0].n;
}

test("迁移之后、运行命令之前：没有任何平台账号，谁也登录不了", async () => {
  assert.equal(await adminCount(), 0);
  const res = await api.call("POST", "/platform/v1/auth/login", { body: { email: "owner@platform.test", password: PASSWORD } });
  assert.equal(res.status, 401);
});

test("创建超级管理员：密码从标准输入读，输出里没有密码；之后能用它登录，角色是超级管理员", async () => {
  const { code, output } = await run(["--email", "Owner@Platform.test", "--name", "负责人"], `${PASSWORD}\n`);
  assert.equal(code, 0, output);
  assert.match(output, /已创建超级管理员：owner@platform\.test/);
  assert.ok(!output.includes(PASSWORD), "输出里出现了密码");
  assert.deepEqual(leakedSecrets(output), []);

  const row = (await api.db.owner.query("select role, status, password_hash from platform_users")).rows[0];
  assert.equal(row.role, "super_admin");
  assert.equal(row.status, "active");
  assert.match(row.password_hash, /^scrypt\$1\$/);
  assert.ok(!row.password_hash.includes(PASSWORD));

  const login = await api.call("POST", "/platform/v1/auth/login", { body: { email: "owner@platform.test", password: PASSWORD } });
  assert.equal(login.status, 200, login.text);
  const me = await api.call("GET", "/platform/v1/auth/me", { token: login.body.access_token });
  assert.equal(me.body.user.role, "super_admin");
  assert.equal(me.body.user.name, "负责人");
});

test("同一个邮箱再创建一次：失败并说明原因，原账号的密码不变", async () => {
  const { code, output } = await run(["--email", "owner@platform.test", "--name", "又一个"], "Another-Passw0rd-9\n");
  assert.equal(code, 1);
  assert.match(output, /没有创建账号：这个邮箱已被使用/);
  assert.equal(await adminCount(), 1);
  const login = await api.call("POST", "/platform/v1/auth/login", { body: { email: "owner@platform.test", password: PASSWORD } });
  assert.equal(login.status, 200);
});

test("密码强度不够：不创建，逐条说明哪里不够，输出里不回显密码", async () => {
  const { code, output } = await run(["--email", "weak@platform.test", "--name", "弱密码"], "abc12345\n");
  assert.equal(code, 1);
  assert.match(output, /密码强度不够/);
  assert.match(output, /密码至少 12 个字符/);
  assert.ok(!output.includes("abc12345"));
  assert.equal(await adminCount(), 1);
});

test("标准输入是空的（没给密码）：不创建", async () => {
  const { code, output } = await run(["--email", "empty@platform.test", "--name", "没密码"], "");
  assert.equal(code, 1);
  assert.match(output, /密码强度不够/);
  assert.equal(await adminCount(), 1);
});

test("不接受把密码写在命令行参数里：--password 直接报用法错误，不读密码、不创建", async () => {
  for (const args of [
    ["--email", "arg@platform.test", "--name", "参数", "--password", PASSWORD],
    ["--email", "arg@platform.test", "--name", "参数", PASSWORD],
  ]) {
    const { code, output } = await run(args, `${PASSWORD}\n`);
    assert.equal(code, 1, output);
    assert.match(output, /密码不能写在命令行参数里/);
    assert.ok(!output.includes(PASSWORD));
  }
  assert.equal(await adminCount(), 1);
});

test("缺少邮箱或姓名、邮箱不合法：报用法错误", async () => {
  for (const args of [[], ["--email", "a@platform.test"], ["--name", "只有名字"], ["--email", "不是邮箱", "--name", "x"]]) {
    const { code, output } = await run(args, `${PASSWORD}\n`);
    assert.equal(code, 1, args.join(" "));
    assert.match(output, /用法：pnpm admin:create/);
  }
  assert.equal(await adminCount(), 1);
});

test("可以再创建第二个超级管理员（比如第一个忘了密码时的恢复手段），并留下审计记录", async () => {
  const { code, output } = await run(["--email", "second@platform.test", "--name", "第二个"], PASSWORD);
  assert.equal(code, 0, output);
  const audit = await api.db.owner.query(
    "select actor_type, source, ip, action, after from audit_logs where resource = 'platform_user' and action = 'create' order by id",
  );
  assert.equal(audit.rows.length, 2);
  assert.deepEqual(audit.rows[1], {
    actor_type: "system",
    source: "cli",
    ip: null,
    action: "create",
    after: { email: "second@platform.test", name: "第二个", role: "super_admin", status: "active" },
  });
  assert.ok(!JSON.stringify(audit.rows).includes(PASSWORD));
});

test("还没执行迁移的库：失败并提示先运行 pnpm db:migrate，输出里没有连接串和密码", async () => {
  let empty: TestDatabase | undefined;
  try {
    empty = await createTestDatabase();
    const { code, output } = await run(["--email", "early@platform.test", "--name", "太早了"], `${PASSWORD}\n`, empty.url);
    assert.equal(code, 1);
    assert.match(output, /pnpm db:migrate/);
    assert.ok(!output.includes(PASSWORD) && !output.includes("postgres://"));
    assert.deepEqual(leakedSecrets(output), []);
  } finally {
    await empty?.drop();
  }
});

test("配置不对（缺登录签名密钥）：报配置错误，不读密码", async () => {
  const env = testEnv(api.db.url);
  delete env["AUTH_JWT_SECRET"];
  const running = startNode(ENTRY, env, ["--email", "cfg@platform.test", "--name", "配置"], { input: `${PASSWORD}\n` });
  const code = await exitWithin(running, 20_000);
  assert.equal(code, 1);
  assert.match(running.output(), /AUTH_JWT_SECRET/);
  assert.ok(!running.output().includes(PASSWORD));
});

test("package.json 里有 admin:create 命令，指向这个入口，命令行里没有密码参数", async () => {
  const pkg = JSON.parse(await readFile(new URL("../../../../package.json", import.meta.url), "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.equal(pkg.scripts["admin:create"], "node --env-file-if-exists=.env apps/api/src/cli/admin-create.ts");
});
