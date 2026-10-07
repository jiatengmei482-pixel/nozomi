/**
 * `pnpm admin:create --temporary-password`、`pnpm admin:reset-password --temporary-password`（M0-12，ADR 0013）。
 * 真的启动两个入口文件，标准输出和标准错误分开收集：
 * 临时密码只在标准输出里出现一次，标准错误、审计、应用日志、数据库里都没有；
 * 再拿它走接口：能登录 → 其他接口 403 → 改密码 → 恢复正常 → 旧的临时密码登录不了。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { TEMPORARY_PASSWORD_PATTERN } from "@nozomi/domain";
import { type ApiResponse, TEST_PASSWORD, type TestApi, createTestApi } from "../testing/api.ts";
import { leakedSecrets, testEnv } from "../testing/fixtures.ts";
import { exitWithin, startNode } from "../testing/process.ts";
import { TEMPORARY_PASSWORD_LABEL } from "./temporary-password.ts";

const CREATE = fileURLToPath(new URL("./admin-create.ts", import.meta.url));
const RESET = fileURLToPath(new URL("./admin-reset-password.ts", import.meta.url));
const NEW_PASSWORD = "Fresh-Lantern-2027";
const PIPED_PASSWORD = "Piped-But-Ignored-2027";

let api: TestApi;
let ipCounter = 0;
const freshIp = (): string => `10.13.0.${(ipCounter++ % 250) + 1}`;
before(async () => {
  api = await createTestApi();
});
after(() => api.close());

interface Result {
  code: number | null | "timeout";
  stdout: string;
  stderr: string;
}

async function run(entry: string, args: string[], input?: string): Promise<Result> {
  const running = startNode(entry, testEnv(api.db.url), args, input === undefined ? {} : { input });
  // 等到输出管道都关闭再读，保证拿到的是全部输出
  const closed = once(running.child, "close");
  const code = await exitWithin(running, 30_000);
  if (code === "timeout") running.child.kill("SIGKILL");
  await closed;
  return { code, stdout: running.stdout(), stderr: running.stderr() };
}

/** 从标准输出里取出临时密码，并断言：恰好一行以固定前缀开头、密码在全部输出里只出现一次、标准错误里没有。 */
function temporaryPasswordFrom(result: Result): string {
  const lines = result.stdout.split("\n").filter((line) => line.startsWith(TEMPORARY_PASSWORD_LABEL));
  assert.equal(lines.length, 1, `标准输出里应当恰好有一行临时密码：\n${result.stdout}`);
  const password = (lines[0] as string).slice(TEMPORARY_PASSWORD_LABEL.length);
  assert.match(password, TEMPORARY_PASSWORD_PATTERN, "这一行除了前缀就只有密码");
  assert.equal(result.stdout.split(password).length - 1, 1, "临时密码在标准输出里只出现一次");
  assert.ok(!result.stderr.includes(password), "标准错误里出现了临时密码");
  assert.equal(result.stderr, "");
  assert.deepEqual(leakedSecrets(result.stdout + result.stderr), []);
  return password;
}

function countOccurrences(text: string, pattern: RegExp): number {
  return [...text.matchAll(pattern)].length;
}

/** 输出里有没有任何长得像临时密码的东西。 */
const LOOKS_LIKE_TEMPORARY_PASSWORD = /[A-Za-z2-9]{5}(?:-[A-Za-z2-9]{5}){3}/g;

const tryLogin = (email: string, password: string): Promise<ApiResponse> =>
  api.call("POST", "/platform/v1/auth/login", { ip: freshIp(), body: { email, password } });

async function stored(): Promise<string> {
  return (
    JSON.stringify((await api.db.owner.query("select * from platform_users")).rows) +
    JSON.stringify((await api.db.owner.query("select * from audit_logs")).rows) +
    JSON.stringify((await api.db.owner.query("select * from platform_sessions")).rows)
  );
}

let temporary: string;

test("admin:create --temporary-password：不读密码；临时密码只在标准输出显示一次、单独一行；库里只有哈希并带上标记；审计只记「用了临时密码」", async () => {
  const result = await run(CREATE, ["--email", "Owner@Platform.test", "--name", "负责人", "--temporary-password"]);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /已创建超级管理员：owner@platform\.test/);
  temporary = temporaryPasswordFrom(result);
  assert.equal(countOccurrences(result.stdout, LOOKS_LIKE_TEMPORARY_PASSWORD), 1);
  assert.match(result.stdout, /只显示这一次/);
  assert.match(result.stdout, /必须先修改密码/);

  const row = (await api.db.owner.query("select role, status, password_hash, must_change_password from platform_users")).rows[0];
  assert.equal(row.role, "super_admin");
  assert.equal(row.status, "active");
  assert.equal(row.must_change_password, true);
  assert.match(row.password_hash, /^scrypt\$1\$/);

  const audit = await api.db.owner.query("select actor_type, source, ip, action, after from audit_logs");
  assert.deepEqual(audit.rows, [
    {
      actor_type: "system",
      source: "cli",
      ip: null,
      action: "create",
      after: { email: "owner@platform.test", name: "负责人", role: "super_admin", status: "active", temporary_password: true },
    },
  ]);
  assert.ok(!(await stored()).includes(temporary), "数据库里出现了临时密码原文");
});

test("拿临时密码走接口：能登录（must_change_password 为 true）→ 其他接口全是 403 → 改密码 → 同一个令牌恢复正常 → 旧临时密码登录失败；全程日志和库里没有它", async () => {
  const loggedIn = await tryLogin("owner@platform.test", temporary);
  assert.equal(loggedIn.status, 200, loggedIn.text);
  assert.equal(loggedIn.body.must_change_password, true);
  const token = loggedIn.body.access_token as string;

  const me = await api.call("GET", "/platform/v1/auth/me", { token });
  assert.equal(me.status, 200);
  assert.equal(me.body.must_change_password, true);
  assert.equal(me.body.user.role, "super_admin");

  const others: [string, string, unknown?][] = [
    ["GET", "/platform/v1/staff"],
    ["POST", "/platform/v1/staff", { email: "ops@platform.test", name: "运营", role: "operations" }],
    ["GET", "/platform/v1/tenants"],
    ["POST", "/platform/v1/tenants", { name: "车队甲", admin: { email: "admin@a.test", name: "管理员" } }],
    ["GET", "/platform/v1/audit-logs"],
    ["GET", "/platform/v1/integrations"],
  ];
  for (const [method, url, body] of others) {
    const res = await api.call(method as "GET", url, { token, ...(body === undefined ? {} : { body }) });
    assert.equal(res.status, 403, `${method} ${url}: ${res.text}`);
    assert.equal(res.body.error.code, "PASSWORD_CHANGE_REQUIRED", `${method} ${url}`);
  }
  assert.equal((await api.db.owner.query("select count(*)::int as n from tenants")).rows[0].n, 0);

  const same = await api.call("POST", "/platform/v1/auth/change-password", { token, body: { current_password: temporary, new_password: temporary } });
  assert.equal(same.body.error.code, "PASSWORD_UNCHANGED");
  const changed = await api.call("POST", "/platform/v1/auth/change-password", { token, body: { current_password: temporary, new_password: NEW_PASSWORD } });
  assert.equal(changed.status, 204, changed.text);

  assert.equal((await api.call("GET", "/platform/v1/auth/me", { token })).body.must_change_password, false);
  for (const [method, url] of others.filter(([method]) => method === "GET")) {
    assert.equal((await api.call(method as "GET", url, { token })).status, 200, `${method} ${url}`);
  }
  const created = await api.call("POST", "/platform/v1/tenants", { token, body: { name: "车队甲", admin: { email: "admin@a.test", name: "管理员" } } });
  assert.equal(created.status, 201, created.text);

  const old = await tryLogin("owner@platform.test", temporary);
  assert.equal(old.status, 401);
  assert.equal(old.body.error.code, "INVALID_CREDENTIALS");
  const relogin = await tryLogin("owner@platform.test", NEW_PASSWORD);
  assert.equal(relogin.status, 200);
  assert.equal(relogin.body.must_change_password, false);

  assert.ok(!api.logs().includes(temporary), "应用日志里出现了临时密码");
  assert.ok(!(await stored()).includes(temporary));
  assert.equal((await api.db.owner.query("select must_change_password from platform_users")).rows[0].must_change_password, false);
});

test("带开关时标准输入被忽略：管道里送进来的内容不会成为密码，也不会被回显", async () => {
  const result = await run(CREATE, ["--email", "piped@platform.test", "--name", "管道", "--temporary-password"], `${PIPED_PASSWORD}\n`);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  const password = temporaryPasswordFrom(result);
  assert.ok(!(result.stdout + result.stderr).includes(PIPED_PASSWORD));
  assert.equal((await tryLogin("piped@platform.test", PIPED_PASSWORD)).status, 401);
  assert.equal((await tryLogin("piped@platform.test", password)).body.must_change_password, true);
  assert.notEqual(password, temporary, "每次生成的都不一样");
});

test("不带开关：行为不变——密码从标准输入读、不打印任何密码、标记为 false、审计详情里没有 temporary_password", async () => {
  const result = await run(CREATE, ["--email", "plain@platform.test", "--name", "普通"], `${TEST_PASSWORD}\n`);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /现在可以用这个邮箱和刚才设置的密码登录平台后台。/);
  assert.ok(!result.stdout.includes(TEMPORARY_PASSWORD_LABEL) && !result.stdout.includes(TEST_PASSWORD));
  assert.equal(countOccurrences(result.stdout + result.stderr, LOOKS_LIKE_TEMPORARY_PASSWORD), 0);
  const loggedIn = await tryLogin("plain@platform.test", TEST_PASSWORD);
  assert.equal(loggedIn.status, 200, loggedIn.text);
  assert.equal(loggedIn.body.must_change_password, false);
  assert.equal((await api.call("GET", "/platform/v1/staff", { token: loggedIn.body.access_token })).status, 200);
  const audit = await api.db.owner.query("select after from audit_logs where action = 'create' and after ->> 'email' = 'plain@platform.test'");
  assert.deepEqual(audit.rows, [{ after: { email: "plain@platform.test", name: "普通", role: "super_admin", status: "active" } }]);
});

test("创建失败（邮箱已被使用、参数不对、开关带了值）：退出码 1，任何输出里都没有临时密码，不建账号", async () => {
  const count = async (): Promise<number> => (await api.db.owner.query("select count(*)::int as n from platform_users")).rows[0].n;
  const before = await count();
  const cases: [string, string[], RegExp][] = [
    ["邮箱已被使用", ["--email", "owner@platform.test", "--name", "又一个", "--temporary-password"], /没有创建账号：这个邮箱已被使用/],
    ["缺姓名", ["--email", "x@platform.test", "--temporary-password"], /用法：pnpm admin:create/],
    ["开关带值", ["--email", "x@platform.test", "--name", "某人", "--temporary-password=Abcde-Fgh23-Jkm45-Npq67"], /用法：pnpm admin:create/],
    ["密码写在参数里", ["--email", "x@platform.test", "--name", "某人", "--temporary-password", "Abcde-Fgh23-Jkm45-Npq67"], /用法：pnpm admin:create/],
  ];
  for (const [label, args, expected] of cases) {
    const result = await run(CREATE, args);
    assert.equal(result.code, 1, `${label}: ${result.stdout}${result.stderr}`);
    assert.match(result.stderr, expected, label);
    assert.equal(result.stdout, "", `${label}：失败时标准输出应为空`);
    assert.equal(countOccurrences(result.stderr, LOOKS_LIKE_TEMPORARY_PASSWORD), 0, `${label}：标准错误里有像临时密码的内容`);
  }
  assert.equal(await count(), before);
  const usage = await run(CREATE, []);
  assert.match(usage.stderr, /--temporary-password/, "用法说明里写了这个开关");
});

test("admin:reset-password --temporary-password：此前的会话全部失效、旧密码作废；新临时密码只显示一次；标记置上；审计只记事实", async () => {
  const session = await tryLogin("owner@platform.test", NEW_PASSWORD);
  assert.equal(session.status, 200);
  const result = await run(RESET, ["--email", "Owner@Platform.test", "--temporary-password"], `${PIPED_PASSWORD}\n`);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /已重设超级管理员 owner@platform\.test 的密码，该账号此前的登录全部失效。/);
  const password = temporaryPasswordFrom(result);
  assert.equal(countOccurrences(result.stdout, LOOKS_LIKE_TEMPORARY_PASSWORD), 1);
  assert.notEqual(password, temporary);
  assert.ok(!(result.stdout + result.stderr).includes(PIPED_PASSWORD) && !(result.stdout + result.stderr).includes(NEW_PASSWORD));

  assert.equal((await api.call("GET", "/platform/v1/auth/me", { token: session.body.access_token })).status, 401, "此前的会话应失效");
  assert.equal((await tryLogin("owner@platform.test", NEW_PASSWORD)).status, 401);
  assert.equal((await tryLogin("owner@platform.test", PIPED_PASSWORD)).status, 401);
  assert.equal((await tryLogin("owner@platform.test", temporary)).status, 401, "第一次的临时密码不会复活");

  const loggedIn = await tryLogin("owner@platform.test", password);
  assert.equal(loggedIn.status, 200, loggedIn.text);
  assert.equal(loggedIn.body.must_change_password, true);
  const token = loggedIn.body.access_token as string;
  assert.equal((await api.call("GET", "/platform/v1/tenants", { token })).body.error.code, "PASSWORD_CHANGE_REQUIRED");
  const changed = await api.call("POST", "/platform/v1/auth/change-password", { token, body: { current_password: password, new_password: TEST_PASSWORD } });
  assert.equal(changed.status, 204, changed.text);
  assert.equal((await api.call("GET", "/platform/v1/tenants", { token })).status, 200);
  assert.equal((await tryLogin("owner@platform.test", password)).status, 401);

  const audit = await api.db.owner.query(
    "select actor_type, source, ip, before, after from audit_logs where action = 'reset_password' order by id",
  );
  assert.deepEqual(audit.rows, [{ actor_type: "system", source: "cli", ip: null, before: null, after: { temporary_password: true } }]);
  assert.ok(!(await stored()).includes(password) && !api.logs().includes(password));
});

test("admin:reset-password 不带开关：行为不变，并且清掉之前留下的标记", async () => {
  const flagged = await run(RESET, ["--email", "piped@platform.test", "--temporary-password"]);
  temporaryPasswordFrom(flagged);
  assert.equal((await api.db.owner.query("select must_change_password from platform_users where email = 'piped@platform.test'")).rows[0].must_change_password, true);

  const result = await run(RESET, ["--email", "piped@platform.test"], `${NEW_PASSWORD}\n`);
  assert.equal(result.code, 0, result.stdout + result.stderr);
  assert.ok(!result.stdout.includes(TEMPORARY_PASSWORD_LABEL) && !result.stdout.includes(NEW_PASSWORD));
  assert.equal(countOccurrences(result.stdout + result.stderr, LOOKS_LIKE_TEMPORARY_PASSWORD), 0);
  const loggedIn = await tryLogin("piped@platform.test", NEW_PASSWORD);
  assert.equal(loggedIn.status, 200, loggedIn.text);
  assert.equal(loggedIn.body.must_change_password, false);
  const last = await api.db.owner.query("select after from audit_logs where action = 'reset_password' order by id desc limit 1");
  assert.deepEqual(last.rows, [{ after: null }]);
});

test("重设失败（不是在用的超级管理员、参数不对）：退出码 1，任何输出里都没有临时密码，密码和会话不动", async () => {
  const hashBefore = (await api.db.owner.query("select email, password_hash, must_change_password from platform_users order by email")).rows;
  const session = await tryLogin("owner@platform.test", TEST_PASSWORD);
  for (const [label, args, expected] of [
    ["不存在的邮箱", ["--email", "nobody@platform.test", "--temporary-password"], /密码没有改动：没有这个邮箱的在用超级管理员/],
    ["缺邮箱", ["--temporary-password"], /用法：pnpm admin:reset-password/],
    ["开关带值", ["--email", "owner@platform.test", "--temporary-password=Abcde-Fgh23-Jkm45-Npq67"], /用法：pnpm admin:reset-password/],
  ] as [string, string[], RegExp][]) {
    const result = await run(RESET, args);
    assert.equal(result.code, 1, `${label}: ${result.stdout}${result.stderr}`);
    assert.match(result.stderr, expected, label);
    assert.equal(result.stdout, "", `${label}：失败时标准输出应为空`);
    assert.equal(countOccurrences(result.stderr, LOOKS_LIKE_TEMPORARY_PASSWORD), 0, label);
  }
  assert.deepEqual((await api.db.owner.query("select email, password_hash, must_change_password from platform_users order by email")).rows, hashBefore);
  assert.equal((await api.call("GET", "/platform/v1/auth/me", { token: session.body.access_token })).status, 200);
});
