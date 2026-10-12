/**
 * `--temporary-password` 的边界（M0-12，ADR 0013）：测试角色补的用例。
 * 真的启动两个入口文件。关注：输出的确切形状、开关的各种写法、写库失败时什么都不显示、
 * 对不该重设的账号不生效、连续生成的密码各不相同且都过强度规则。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { TEMPORARY_PASSWORD_PATTERN, checkPasswordStrength } from "@nozomi/domain";
import { type ApiResponse, TEST_PASSWORD, type TestApi, createTestApi } from "../testing/api.ts";
import { type TestDatabase, createTestDatabase } from "../testing/db.ts";
import { FAKE_SECRETS, UNREACHABLE_DATABASE_URL, leakedSecrets, testEnv } from "../testing/fixtures.ts";
import { exitWithin, startNode } from "../testing/process.ts";

const CREATE = fileURLToPath(new URL("./admin-create.ts", import.meta.url));
const RESET = fileURLToPath(new URL("./admin-reset-password.ts", import.meta.url));
/** 输出里任何长得像临时密码的东西（比固定形状宽：容易看错的字符也算）。 */
const LOOKS_LIKE_TEMPORARY_PASSWORD = /[A-Za-z0-9]{5}(?:-[A-Za-z0-9]{5}){3}/g;
const FROM_ARGUMENT = "Abcde-Fgh23-Jkm45-Npq67";

let api: TestApi;
let empty: TestDatabase;
let ipCounter = 0;
const freshIp = (): string => `10.15.0.${(ipCounter++ % 250) + 1}`;

before(async () => {
  api = await createTestApi();
  empty = await createTestDatabase();
});
after(async () => {
  await api.close();
  await empty.drop();
});

interface Result {
  code: number | null | "timeout";
  stdout: string;
  stderr: string;
}

async function run(entry: string, args: string[], options: { input?: string; databaseUrl?: string; env?: Record<string, string> } = {}): Promise<Result> {
  const env = { ...testEnv(options.databaseUrl ?? api.db.url), ...(options.env ?? {}) };
  const running = startNode(entry, env, args, options.input === undefined ? {} : { input: options.input });
  const closed = once(running.child, "close");
  const code = await exitWithin(running, 30_000);
  if (code === "timeout") running.child.kill("SIGKILL");
  await closed;
  return { code, stdout: running.stdout(), stderr: running.stderr() };
}

const tryLogin = (email: string, password: string): Promise<ApiResponse> =>
  api.call("POST", "/platform/v1/auth/login", { ip: freshIp(), body: { email, password } });

async function users(): Promise<unknown[]> {
  return (await api.db.owner.query("select email, status, password_hash, must_change_password from platform_users order by email")).rows;
}

function assertNothingShown(result: Result, label: string): void {
  assert.equal(result.code, 1, `${label}: ${result.stdout}${result.stderr}`);
  assert.equal(result.stdout, "", `${label}：失败时标准输出应为空`);
  assert.deepEqual(result.stderr.match(LOOKS_LIKE_TEMPORARY_PASSWORD), null, `${label}：标准错误里有像临时密码的内容`);
  assert.ok(!result.stderr.includes("临时密码："), `${label}：标准错误里有临时密码那一行`);
  assert.deepEqual(leakedSecrets(result.stdout + result.stderr), [], label);
}

test("admin:create 的标准输出就是约定的那四行，一个字不多：临时密码行没有多余空格、颜色码、引号；标准错误为空", async () => {
  const result = await run(CREATE, ["--email", "shape@platform.test", "--name", "形状", "--temporary-password"]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.stderr, "");
  const lines = result.stdout.split("\n");
  assert.equal(lines.length, 5, result.stdout);
  assert.match(lines[0] as string, /^已创建超级管理员：shape@platform\.test（编号 [0-9a-f-]{36}）$/);
  assert.equal(lines[1], "下面这一行是临时密码，只显示这一次，请现在就交给本人：");
  assert.match(lines[2] as string, /^临时密码：[A-Za-z2-9-]{23}$/);
  assert.equal(lines[3], "用它登录后必须先修改密码，改完之前不能使用其他功能；改完后这个临时密码作废。");
  assert.equal(lines[4], "", "以换行结尾");
  const password = (lines[2] as string).slice("临时密码：".length);
  assert.match(password, TEMPORARY_PASSWORD_PATTERN);
  assert.doesNotMatch(result.stdout, /[\u0000-\u0009\u000b-\u001f\u007f]/, "输出里没有控制字符（颜色码、回车）");
  assert.deepEqual(result.stdout.match(LOOKS_LIKE_TEMPORARY_PASSWORD), [password]);
  assert.deepEqual(checkPasswordStrength(password, "shape@platform.test"), []);
  assert.equal((await tryLogin("shape@platform.test", password)).body.must_change_password, true);
});

test("admin:reset-password 的标准输出也是约定的四行；连续两次带开关重设：第一次的临时密码立即作废", async () => {
  const first = await run(RESET, ["--email", "shape@platform.test", "--temporary-password"]);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(first.stderr, "");
  const lines = first.stdout.split("\n");
  assert.equal(lines.length, 5, first.stdout);
  assert.equal(lines[0], "已重设超级管理员 shape@platform.test 的密码，该账号此前的登录全部失效。");
  assert.equal(lines[1], "下面这一行是临时密码，只显示这一次，请现在就交给本人：");
  assert.match(lines[2] as string, /^临时密码：[A-Za-z2-9-]{23}$/);
  assert.equal(lines[4], "");
  const firstPassword = (lines[2] as string).slice("临时密码：".length);
  const session = await tryLogin("shape@platform.test", firstPassword);
  assert.equal(session.status, 200);

  const second = await run(RESET, ["--email", "shape@platform.test", "--temporary-password"]);
  assert.equal(second.code, 0, second.stderr);
  const secondPassword = /^临时密码：(\S+)$/m.exec(second.stdout)?.[1] as string;
  assert.notEqual(secondPassword, firstPassword);
  assert.equal((await tryLogin("shape@platform.test", firstPassword)).status, 401, "上一个临时密码作废");
  assert.equal((await api.call("GET", "/platform/v1/auth/me", { token: session.body.access_token })).status, 401, "用上一个临时密码登录的会话失效");
  assert.equal((await tryLogin("shape@platform.test", secondPassword)).body.must_change_password, true);
});

test("开关的各种写法：带值、空值、否定、大小写、缩写、下划线、后面跟位置参数、和 --password 一起——全部是用法错误，不建账号、不显示任何密码、参数里的内容不回显", async () => {
  const before = await users();
  const base = ["--email", "variants@platform.test", "--name", "写法"];
  const cases: [string, string[]][] = [
    ["带值", [...base, `--temporary-password=${FROM_ARGUMENT}`]],
    ["空值", [...base, "--temporary-password="]],
    ["=true", [...base, "--temporary-password=true"]],
    ["=false", [...base, "--temporary-password=false"]],
    ["否定", [...base, "--no-temporary-password"]],
    ["大小写", [...base, "--Temporary-Password"]],
    ["缩写", [...base, "--temporary"]],
    ["短开关", [...base, "-t"]],
    ["下划线", [...base, "--temporary_password"]],
    ["后面跟位置参数", [...base, "--temporary-password", FROM_ARGUMENT]],
    ["后面跟空串", [...base, "--temporary-password", ""]],
    ["-- 之后的位置参数", [...base, "--temporary-password", "--", FROM_ARGUMENT]],
    ["和 --password 一起", [...base, "--temporary-password", "--password", FROM_ARGUMENT]],
    ["和 --password= 一起", [...base, `--password=${FROM_ARGUMENT}`, "--temporary-password"]],
  ];
  for (const [label, args] of cases) {
    for (const entry of [CREATE, RESET]) {
      const actual = entry === RESET ? args.filter((arg, index) => arg !== "--name" && args[index - 1] !== "--name") : args;
      const result = await run(entry, actual, { input: `${TEST_PASSWORD}\n` });
      assert.equal(result.code, 1, `${label}: ${result.stdout}${result.stderr}`);
      assert.equal(result.stdout, "", label);
      assert.match(result.stderr, /^参数不正确。\n用法：pnpm admin:(create|reset-password)/, label);
      assert.ok(!result.stderr.includes(FROM_ARGUMENT), `${label}：命令行参数里的内容被回显了`);
      assert.ok(!result.stderr.includes(TEST_PASSWORD), `${label}：标准输入里的内容被回显了`);
    }
  }
  assert.deepEqual(await users(), before);
});

test("开关重复写两遍：和写一遍一样——只建一个账号、只显示一个临时密码", async () => {
  const result = await run(CREATE, ["--temporary-password", "--email", "twice@platform.test", "--temporary-password", "--name", "两遍"]);
  assert.equal(result.code, 0, result.stderr);
  const shown = result.stdout.match(LOOKS_LIKE_TEMPORARY_PASSWORD) ?? [];
  assert.equal(shown.length, 1, result.stdout);
  assert.equal((await api.db.owner.query("select count(*)::int as n from platform_users where email = 'twice@platform.test'")).rows[0].n, 1);
  assert.equal((await tryLogin("twice@platform.test", shown[0] as string)).body.must_change_password, true);
});

test("写库失败时什么都不显示：数据库连不上、表不存在（迁移没跑）——退出码 1，标准输出为空，标准错误里没有临时密码也没有连接串", async () => {
  for (const [label, databaseUrl, expected] of [
    ["连不上", UNREACHABLE_DATABASE_URL, /数据库操作失败（ECONNREFUSED）/],
    ["表不存在", empty.url, /数据库操作失败（42P01）/],
  ] as const) {
    const created = await run(CREATE, ["--email", "nodb@platform.test", "--name", "没库", "--temporary-password"], { databaseUrl });
    assertNothingShown(created, `create ${label}`);
    assert.match(created.stderr, /^没有创建账号：/);
    assert.match(created.stderr, expected, label);
    assert.ok(!created.stderr.includes(FAKE_SECRETS.databasePassword) && !created.stderr.includes("postgres://"));

    const reset = await run(RESET, ["--email", "nodb@platform.test", "--temporary-password"], { databaseUrl });
    assertNothingShown(reset, `reset ${label}`);
    assert.match(reset.stderr, /^密码没有改动：/);
    assert.ok(!reset.stderr.includes("postgres://"));
  }
});

test("配置不对（没有登录签名密钥）：在生成和显示任何密码之前就失败", async () => {
  const result = await run(CREATE, ["--email", "noconfig@platform.test", "--name", "没配置", "--temporary-password"], { env: { AUTH_JWT_SECRET: "" } });
  assertNothingShown(result, "缺 AUTH_JWT_SECRET");
  assert.equal((await api.db.owner.query("select count(*)::int as n from platform_users where email = 'noconfig@platform.test'")).rows[0].n, 0);
});

test("带开关重设只对在用的超级管理员有效：已停用的超管、待激活的员工、在用但不是超管的员工、租户用户的邮箱——都不改、不显示密码", async () => {
  const root = await api.superAdminToken("root-edge@platform.test");
  // 已停用的超管
  const disabled = await run(CREATE, ["--email", "disabled@platform.test", "--name", "停用"], { input: `${TEST_PASSWORD}\n` });
  assert.equal(disabled.code, 0, disabled.stderr);
  const disabledId = (await api.db.owner.query("select id from platform_users where email = 'disabled@platform.test'")).rows[0].id;
  assert.equal((await api.call("POST", `/platform/v1/staff/${disabledId}/disable`, { token: root })).status, 200);
  // 待激活、以及在用的非超管
  assert.equal((await api.call("POST", "/platform/v1/staff", { token: root, body: { email: "pending@platform.test", name: "待激活", role: "finance" } })).status, 201);
  const invited = await api.call("POST", "/platform/v1/staff", { token: root, body: { email: "ops@platform.test", name: "运营", role: "operations" } });
  assert.equal((await api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.body.invite.token, password: TEST_PASSWORD } })).status, 200);
  // 租户用户
  const tenant = await api.tenantWithAdmin(root, "车队甲", "admin@a.test");

  const before = await users();
  const tenantBefore = (await api.db.owner.query("select password_hash, must_change_password from tenant_users where id = $1", [tenant.adminId])).rows;
  for (const email of ["disabled@platform.test", "pending@platform.test", "ops@platform.test", "admin@a.test", "nobody@platform.test"]) {
    const result = await run(RESET, ["--email", email, "--temporary-password"]);
    assertNothingShown(result, email);
    assert.match(result.stderr, /^密码没有改动：没有这个邮箱的在用超级管理员\n$/, email);
  }
  assert.deepEqual(await users(), before);
  assert.deepEqual((await api.db.owner.query("select password_hash, must_change_password from tenant_users where id = $1", [tenant.adminId])).rows, tenantBefore);
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: tenant.adminToken })).body.must_change_password, false);
});

test("带标记的账号不带开关重设、但管道里送来的密码太弱：重设失败，标记、临时密码、会话都原样", async () => {
  const created = await run(CREATE, ["--email", "weak@platform.test", "--name", "弱密码", "--temporary-password"]);
  const temporary = /^临时密码：(\S+)$/m.exec(created.stdout)?.[1] as string;
  const session = await tryLogin("weak@platform.test", temporary);
  const before = await users();
  const result = await run(RESET, ["--email", "weak@platform.test"], { input: "short\n" });
  assert.equal(result.code, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /^密码没有改动：/);
  assert.ok(!result.stderr.includes(temporary));
  assert.deepEqual(await users(), before);
  assert.equal((await api.call("GET", "/platform/v1/auth/me", { token: session.body.access_token })).body.must_change_password, true);
  assert.equal((await tryLogin("weak@platform.test", temporary)).status, 200);
});

test("连续生成 6 个：各不相同、都是固定形状、都过这个邮箱的强度规则（邮箱名本身就是字母表里的字符时也一样）；库里和审计里都没有原文", async () => {
  // 邮箱名取自临时密码的字母表、长度 4：最容易撞上「不能包含邮箱名」的那一类邮箱
  const emails = ["abcd@platform.test", "wxyz@platform.test", "hjkm@platform.test", "npqr@platform.test", "stuv@platform.test", "efgh@platform.test"];
  const results = await Promise.all(emails.map((email) => run(CREATE, ["--email", email, "--name", "批量", "--temporary-password"])));
  const passwords = results.map((result, index) => {
    assert.equal(result.code, 0, result.stderr);
    const password = /^临时密码：(\S+)$/m.exec(result.stdout)?.[1] as string;
    assert.match(password, TEMPORARY_PASSWORD_PATTERN);
    assert.deepEqual(checkPasswordStrength(password, emails[index] as string), []);
    assert.ok(!password.toLowerCase().includes((emails[index] as string).slice(0, 4)));
    return password;
  });
  assert.equal(new Set(passwords).size, passwords.length);
  const stored =
    JSON.stringify((await api.db.owner.query("select * from platform_users")).rows) + JSON.stringify((await api.db.owner.query("select * from audit_logs")).rows);
  for (const password of passwords) assert.ok(!stored.includes(password));
  const flags = (await api.db.owner.query("select must_change_password from platform_users where email = any($1)", [emails])).rows;
  assert.deepEqual(flags.map((row) => row.must_change_password), new Array(emails.length).fill(true));
});

test("同一个邮箱同时执行两次带开关的创建：只有一个成功并显示密码，另一个不显示任何密码；显示出来的那个密码能登录", async () => {
  const args = ["--email", "same@platform.test", "--name", "同时", "--temporary-password"];
  const results = await Promise.all([run(CREATE, args), run(CREATE, args)]);
  const succeeded = results.filter((result) => result.code === 0);
  const failed = results.filter((result) => result.code !== 0);
  assert.equal(succeeded.length, 1, results.map((result) => result.stdout + result.stderr).join("\n---\n"));
  assertNothingShown(failed[0] as Result, "后到的那个");
  assert.match((failed[0] as Result).stderr, /这个邮箱已被使用/);
  const password = /^临时密码：(\S+)$/m.exec((succeeded[0] as Result).stdout)?.[1] as string;
  assert.equal((await tryLogin("same@platform.test", password)).status, 200);
});
