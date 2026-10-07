/**
 * `pnpm admin:reset-password`：最后一个超级管理员忘了密码时，在服务器上的恢复途径（ADR 0008）。
 * 真的启动入口文件（密码走标准输入），再用新密码走登录接口。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { TEST_PASSWORD, type TestApi, createTestApi } from "../testing/api.ts";
import { leakedSecrets, testEnv } from "../testing/fixtures.ts";
import { exitWithin, startNode } from "../testing/process.ts";

const ENTRY = fileURLToPath(new URL("./admin-reset-password.ts", import.meta.url));
const NEW_PASSWORD = "Cli-Reset-Passw0rd-2027";

let api: TestApi;
let rootToken: string;
let rootId: string;
before(async () => {
  api = await createTestApi();
  rootToken = await api.superAdminToken("owner@platform.test");
  rootId = (await api.call("GET", "/platform/v1/auth/me", { token: rootToken })).body.user.id;
});
after(() => api.close());

async function run(args: string[], input: string): Promise<{ code: number | null | "timeout"; output: string }> {
  const running = startNode(ENTRY, testEnv(api.db.url), args, { input });
  const code = await exitWithin(running, 20_000);
  if (code === "timeout") running.child.kill("SIGKILL");
  return { code, output: running.output() };
}

const login = (email: string, password: string) => api.call("POST", "/platform/v1/auth/login", { body: { email, password } });
const passwordHash = async (email: string): Promise<string> =>
  (await api.db.pool.query("select password_hash from platform_users where email = $1", [email])).rows[0].password_hash;

test("重设唯一的超级管理员的密码：输出里没有密码；旧密码作废、新密码能登录；此前的会话全部失效；审计记为命令行", async () => {
  const { code, output } = await run(["--email", "Owner@Platform.test"], `${NEW_PASSWORD}\n`);
  assert.equal(code, 0, output);
  assert.match(output, /已重设超级管理员 owner@platform\.test 的密码/);
  assert.ok(!output.includes(NEW_PASSWORD) && !output.includes(TEST_PASSWORD));
  assert.deepEqual(leakedSecrets(output), []);

  assert.equal((await api.call("GET", "/platform/v1/auth/me", { token: rootToken })).status, 401, "此前的会话应失效");
  assert.equal((await login("owner@platform.test", TEST_PASSWORD)).status, 401);
  const relogin = await login("owner@platform.test", NEW_PASSWORD);
  assert.equal(relogin.status, 200, relogin.text);
  rootToken = relogin.body.access_token;

  const audit = await api.db.pool.query(
    "select actor_type, actor_id, source, ip, resource_id, before, after from audit_logs where action = 'reset_password'",
  );
  assert.deepEqual(audit.rows, [
    { actor_type: "system", actor_id: null, source: "cli", ip: null, resource_id: rootId, before: null, after: null },
  ]);
});

test("密码太弱、没给密码、密码写在参数里、缺邮箱：都不改密码，输出里不回显密码", async () => {
  const before = await passwordHash("owner@platform.test");
  const cases: [string, string[], string, RegExp][] = [
    ["太弱", ["--email", "owner@platform.test"], "abc12345\n", /密码强度不够/],
    ["没给密码", ["--email", "owner@platform.test"], "", /密码强度不够/],
    ["写在参数里", ["--email", "owner@platform.test", "--password", "Arg-Passw0rd-2027x"], "Arg-Passw0rd-2027x\n", /密码不能写在命令行参数里/],
    ["位置参数", ["--email", "owner@platform.test", "Arg-Passw0rd-2027x"], "Arg-Passw0rd-2027x\n", /密码不能写在命令行参数里/],
    ["缺邮箱", [], `${NEW_PASSWORD}x\n`, /用法：pnpm admin:reset-password/],
    ["邮箱不合法", ["--email", "不是邮箱"], `${NEW_PASSWORD}x\n`, /用法：pnpm admin:reset-password/],
  ];
  for (const [label, args, input, expected] of cases) {
    const { code, output } = await run(args, input);
    assert.equal(code, 1, `${label}: ${output}`);
    assert.match(output, expected, label);
    assert.ok(!output.includes("abc12345") && !output.includes("Arg-Passw0rd-2027x") && !output.includes(NEW_PASSWORD), label);
  }
  assert.equal(await passwordHash("owner@platform.test"), before);
  assert.equal((await api.call("GET", "/platform/v1/auth/me", { token: rootToken })).status, 200, "失败的尝试不应让会话失效");
});

test("只对在用的超级管理员有效：不存在的邮箱、不是超级管理员的平台员工、已停用的超级管理员，都拒绝且说法相同", async () => {
  const invited = await api.call("POST", "/platform/v1/staff", { token: rootToken, body: { email: "ops@platform.test", name: "运营", role: "operations" } });
  await api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.body.invite.token, password: TEST_PASSWORD } });
  const second = await api.call("POST", "/platform/v1/staff", { token: rootToken, body: { email: "root2@platform.test", name: "第二个超管", role: "super_admin" } });
  await api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: second.body.invite.token, password: TEST_PASSWORD } });
  await api.call("POST", `/platform/v1/staff/${second.body.user.id}/disable`, { token: rootToken });
  const pending = await api.call("POST", "/platform/v1/staff", { token: rootToken, body: { email: "pending@platform.test", name: "待激活超管", role: "super_admin" } });
  assert.equal(pending.status, 201);

  const outputs: string[] = [];
  for (const email of ["nobody@platform.test", "ops@platform.test", "root2@platform.test", "pending@platform.test"]) {
    const before = email === "nobody@platform.test" || email === "pending@platform.test" ? null : await passwordHash(email);
    const { code, output } = await run(["--email", email], `${NEW_PASSWORD}\n`);
    assert.equal(code, 1, `${email}: ${output}`);
    assert.match(output, /密码没有改动：没有这个邮箱的在用超级管理员/);
    outputs.push(output);
    if (before !== null) assert.equal(await passwordHash(email), before, email);
  }
  assert.equal(new Set(outputs).size, 1, "四种情况的输出应当完全一样");
  assert.equal((await login("ops@platform.test", TEST_PASSWORD)).status, 200);
  const disabled = await api.db.pool.query("select status from platform_users where email = 'root2@platform.test'");
  assert.equal(disabled.rows[0].status, "disabled", "命令行不会顺手把停用的账号启用");
});

test("package.json 里有 admin:reset-password 命令，指向这个入口，命令行里没有密码参数", async () => {
  const pkg = JSON.parse(await readFile(new URL("../../../../package.json", import.meta.url), "utf8")) as {
    scripts: Record<string, string>;
  };
  assert.equal(pkg.scripts["admin:reset-password"], "node --env-file-if-exists=.env apps/api/src/cli/admin-reset-password.ts");
});
