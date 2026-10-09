/**
 * 「先验证密码、后写入」的并发（M0-12，ADR 0013「并发」）。
 *
 * 密码哈希是慢计算，只能在事务和行锁之外做；所以每条这样的路径在写入前都要锁住账号、
 * 确认库里的密码还是刚才验证过的那个（改密还要确认本会话仍然有效）。这里验证：
 * - 改密请求在途时，账号被重置链接或命令行重设：改密必须失败，不会盖掉重设的结果；
 * - 登录请求在途时密码被改：不会冒出一个用旧密码建的会话；
 * - 同一会话重复提交：只有一个成功、只有一条审计；
 * - 邀请令牌、重置令牌、命令行重设被同时用两次：只有一个成功。
 *
 * 两类测试：真实路径并发（断言无论谁先谁后都成立的结论），和「测试自己拿着行锁」的确定性测试
 * （请求确实停在加锁那一步之后，再由测试改掉密码、放锁）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { hashPassword } from "./auth/password.ts";
import { createSuperAdmin, resetSuperAdminPassword } from "./services/platform-staff.ts";
import { type ApiResponse, TEST_PASSWORD, type TenantFixture, type TestApi, addTenantUser, createTestApi } from "./testing/api.ts";
import { waitUntil } from "./testing/process.ts";

const TEMPORARY = "Tmp7k-Qw3zR-9vBn2-XyLp4";
const NEW_PASSWORD = "Fresh-Lantern-2027";
const OTHER_PASSWORD = "Amber-Compass-2028";

type Entry = "platform" | "tenant";

let api: TestApi;
let rootToken: string;
let tenant: TenantFixture;
let ipCounter = 0;
const freshIp = (): string => `10.15.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

before(async () => {
  api = await createTestApi();
  rootToken = await api.superAdminToken("root@platform.test");
  tenant = await api.tenantWithAdmin(rootToken, "车队甲", "admin@a.test");
});
after(() => api.close());

const tryLogin = (entry: Entry, email: string, password: string): Promise<ApiResponse> =>
  api.call("POST", `/${entry}/v1/auth/login`, { ip: freshIp(), body: { email, password } });

async function token(entry: Entry, email: string, password: string): Promise<string> {
  const res = await tryLogin(entry, email, password);
  assert.equal(res.status, 200, res.text);
  return res.body.access_token as string;
}

const change = (entry: Entry, accessToken: string, current: string, next: string): Promise<ApiResponse> =>
  api.call("POST", `/${entry}/v1/auth/change-password`, {
    token: accessToken,
    ip: freshIp(),
    body: { current_password: current, new_password: next },
  });

const table = (entry: Entry): string => (entry === "platform" ? "platform_users" : "tenant_users");
const sessions = (entry: Entry): string => (entry === "platform" ? "platform_sessions" : "tenant_sessions");

async function row(entry: Entry, email: string): Promise<{ id: string; password_hash: string; must_change_password: boolean }> {
  return (await api.db.owner.query(`select id, password_hash, must_change_password from ${table(entry)} where email = $1`, [email])).rows[0];
}

async function auditCount(action: string, userId: string): Promise<number> {
  return (await api.db.owner.query("select count(*)::int as n from audit_logs where action = $1 and resource_id = $2", [action, userId])).rows[0].n;
}

/** 哪些密码现在能登录。 */
async function working(entry: Entry, email: string, candidates: readonly string[]): Promise<string[]> {
  const result: string[] = [];
  for (const password of candidates) if ((await tryLogin(entry, email, password)).status === 200) result.push(password);
  return result;
}

async function platformUser(email: string, password = TEST_PASSWORD, temporaryPassword = false): Promise<string> {
  await createSuperAdmin(api.db.pool, { email, name: email, password, temporaryPassword }, api.clock.now());
  return token("platform", email, password);
}

async function tenantUser(email: string): Promise<string> {
  return (await addTenantUser(api, tenant.adminToken, email, "admin")).token;
}

/**
 * 测试自己拿着这个账号的行锁，发出 `request`，等它确实停在加锁那一步，再执行 `whileBlocked`（同一个持锁事务里），提交放锁。
 * 返回请求的应答。
 */
async function withRowLockHeld(
  entry: Entry,
  email: string,
  request: () => Promise<ApiResponse>,
  whileBlocked: (query: (sql: string, params?: unknown[]) => Promise<unknown>) => Promise<void>,
): Promise<ApiResponse> {
  const holder = await api.db.owner.connect();
  try {
    await holder.query("begin");
    await holder.query(`select id from ${table(entry)} where email = $1 for update`, [email]);
    const pending = request();
    const blocked = await waitUntil(async () => {
      const waiting = await holder.query("select count(*)::int as n from pg_stat_activity where pg_backend_pid() = any(pg_blocking_pids(pid))");
      return waiting.rows[0].n === 1;
    }, 15_000);
    assert.ok(blocked, "请求没有停在给账号加锁这一步");
    await whileBlocked((sql, params) => holder.query(sql, params));
    await holder.query("commit");
    return await pending;
  } catch (err) {
    await holder.query("rollback");
    throw err;
  } finally {
    holder.release();
  }
}

for (const entry of ["platform", "tenant"] as const) {
  const make = (email: string): Promise<string> => (entry === "platform" ? platformUser(email) : tenantUser(email));
  const domain = entry === "platform" ? "platform.test" : "a.test";

  test(`${entry}：改密请求已经验证完当前密码、停在加锁这一步时，密码被重设且会话全部作废——改密返回 401，重设的结果原样不动，没有 change_password 审计`, async () => {
    const email = `held-reset@${domain}`;
    const accessToken = await make(email);
    const resetHash = await hashPassword(OTHER_PASSWORD);
    const user = await row(entry, email);

    const res = await withRowLockHeld(entry, email, () => change(entry, accessToken, TEST_PASSWORD, NEW_PASSWORD), async (query) => {
      await query(`update ${table(entry)} set password_hash = $2, must_change_password = true where id = $1`, [user.id, resetHash]);
      await query(`delete from ${sessions(entry)} where user_id = $1`, [user.id]);
    });

    assert.equal(res.status, 401, res.text);
    assert.equal(res.body.error.code, "UNAUTHENTICATED");
    const afterwards = await row(entry, email);
    assert.equal(afterwards.password_hash, resetHash, "改密盖掉了重设的密码");
    assert.equal(afterwards.must_change_password, true, "改密清掉了重设时置上的标记");
    assert.deepEqual(await working(entry, email, [TEST_PASSWORD, NEW_PASSWORD, OTHER_PASSWORD]), [OTHER_PASSWORD]);
    assert.equal(await auditCount("change_password", user.id), 0);
  });

  test(`${entry}：同样停在加锁这一步时密码被换掉、但本会话还在——改密返回 400 当前密码不正确，密码不被盖掉`, async () => {
    const email = `held-swap@${domain}`;
    const accessToken = await make(email);
    const swappedHash = await hashPassword(OTHER_PASSWORD);
    const user = await row(entry, email);

    const res = await withRowLockHeld(entry, email, () => change(entry, accessToken, TEST_PASSWORD, NEW_PASSWORD), async (query) => {
      await query(`update ${table(entry)} set password_hash = $2 where id = $1`, [user.id, swappedHash]);
    });

    assert.equal(res.status, 400, res.text);
    assert.equal(res.body.error.code, "CURRENT_PASSWORD_INCORRECT");
    assert.equal((await row(entry, email)).password_hash, swappedHash);
    assert.equal((await api.call("GET", `/${entry}/v1/auth/me`, { token: accessToken })).status, 200, "失败的改密不应让本会话失效");
    assert.equal(await auditCount("change_password", user.id), 0);
  });

  test(`${entry}：登录请求已经验证完密码、停在加锁这一步时密码被改——登录返回 401，没有建出会话，记一条登录失败`, async () => {
    const email = `held-login@${domain}`;
    await make(email);
    const user = await row(entry, email);
    const changedHash = await hashPassword(NEW_PASSWORD);
    await api.db.owner.query(`delete from ${sessions(entry)} where user_id = $1`, [user.id]);
    const failuresBefore = await auditCount("login_failed", user.id);

    const res = await withRowLockHeld(entry, email, () => tryLogin(entry, email, TEST_PASSWORD), async (query) => {
      await query(`update ${table(entry)} set password_hash = $2 where id = $1`, [user.id, changedHash]);
      await query(`delete from ${sessions(entry)} where user_id = $1`, [user.id]);
    });

    assert.equal(res.status, 401, res.text);
    assert.equal(res.body.error.code, "INVALID_CREDENTIALS");
    assert.ok(!res.text.includes("access_token"));
    const left = await api.db.owner.query(`select count(*)::int as n from ${sessions(entry)} where user_id = $1`, [user.id]);
    assert.equal(left.rows[0].n, 0, "用已经作废的密码建出了会话");
    assert.equal(await auditCount("login_failed", user.id), failuresBefore + 1);
    assert.deepEqual(await working(entry, email, [TEST_PASSWORD, NEW_PASSWORD]), [NEW_PASSWORD]);
  });

  test(`${entry}：登录停在加锁这一步时账号被停用——登录不成功，没有建出会话`, async () => {
    const email = `held-disable@${domain}`;
    await make(email);
    const user = await row(entry, email);
    await api.db.owner.query(`delete from ${sessions(entry)} where user_id = $1`, [user.id]);
    const res = await withRowLockHeld(entry, email, () => tryLogin(entry, email, TEST_PASSWORD), async (query) => {
      await query(`update ${table(entry)} set status = 'disabled' where id = $1`, [user.id]);
    });
    assert.equal(res.status, 401, res.text);
    const left = await api.db.owner.query(`select count(*)::int as n from ${sessions(entry)} where user_id = $1`, [user.id]);
    assert.equal(left.rows[0].n, 0);
  });

  test(`${entry}：改密和「凭重置链接设密码」同时进行（真实路径）——恰好一个成功，最后有效的就是成功那一方的密码`, async () => {
    const email = `race-link@${domain}`;
    const accessToken = await make(email);
    const user = await row(entry, email);
    const issued =
      entry === "platform"
        ? await api.call("POST", `/platform/v1/staff/${user.id}/password-reset`, { token: rootToken })
        : await api.call("POST", `/tenant/v1/users/${user.id}/password-reset`, { token: tenant.adminToken });
    assert.equal(issued.status, 201, issued.text);

    const [changed, reset] = await Promise.all([
      change(entry, accessToken, TEST_PASSWORD, NEW_PASSWORD),
      api.call("POST", `/${entry}/v1/auth/reset-password`, { body: { token: issued.body.reset.token, password: OTHER_PASSWORD } }),
    ]);
    const succeeded = [changed.status === 204, reset.status === 200];
    assert.equal(succeeded.filter(Boolean).length, 1, `改密 ${changed.status} ${changed.text}；重置 ${reset.status} ${reset.text}`);
    assert.deepEqual(
      await working(entry, email, [TEST_PASSWORD, NEW_PASSWORD, OTHER_PASSWORD]),
      [succeeded[0] ? NEW_PASSWORD : OTHER_PASSWORD],
      "被告知成功的那一方的密码必须有效，另外两个都无效",
    );
    if (!succeeded[0]) assert.ok([400, 401].includes(changed.status), changed.text);
    assert.equal((await auditCount("change_password", user.id)) + (await auditCount("reset_password", user.id)), 1);
  });

  test(`${entry}：同一个会话把同一个改密请求同时发两次（双击）——恰好一个 204、另一个 400 当前密码不正确，只有一条审计，会话还在`, async () => {
    const email = `double@${domain}`;
    const accessToken = await make(email);
    const user = await row(entry, email);
    const [a, b] = await Promise.all([
      change(entry, accessToken, TEST_PASSWORD, NEW_PASSWORD),
      change(entry, accessToken, TEST_PASSWORD, NEW_PASSWORD),
    ]);
    assert.deepEqual([a.status, b.status].sort(), [204, 400], `${a.text} ${b.text}`);
    assert.equal((a.status === 400 ? a : b).body.error.code, "CURRENT_PASSWORD_INCORRECT");
    assert.equal(await auditCount("change_password", user.id), 1);
    assert.equal((await api.call("GET", `/${entry}/v1/auth/me`, { token: accessToken })).status, 200);
    assert.deepEqual(await working(entry, email, [TEST_PASSWORD, NEW_PASSWORD]), [NEW_PASSWORD]);
  });

  test(`${entry}：两个会话同时用同一个当前密码改成不同的新密码——恰好一个 204，另一个 401；成功那一方的密码和会话都有效`, async () => {
    const email = `two-sessions@${domain}`;
    const first = await make(email);
    const second = await token(entry, email, TEST_PASSWORD);
    const [a, b] = await Promise.all([change(entry, first, TEST_PASSWORD, NEW_PASSWORD), change(entry, second, TEST_PASSWORD, OTHER_PASSWORD)]);
    assert.deepEqual([a.status, b.status].sort(), [204, 401], `${a.text} ${b.text}`);
    const winner = a.status === 204 ? { accessToken: first, password: NEW_PASSWORD } : { accessToken: second, password: OTHER_PASSWORD };
    assert.equal((await api.call("GET", `/${entry}/v1/auth/me`, { token: winner.accessToken })).status, 200);
    assert.deepEqual(await working(entry, email, [TEST_PASSWORD, NEW_PASSWORD, OTHER_PASSWORD]), [winner.password]);
    assert.equal(await auditCount("change_password", (await row(entry, email)).id), 1);
  });

  test(`${entry}：同一个重置令牌同时提交两个不同的新密码——恰好一个成功，有效的是成功那一方的密码`, async () => {
    const email = `reset-twice@${domain}`;
    await make(email);
    const user = await row(entry, email);
    const issued =
      entry === "platform"
        ? await api.call("POST", `/platform/v1/staff/${user.id}/password-reset`, { token: rootToken })
        : await api.call("POST", `/tenant/v1/users/${user.id}/password-reset`, { token: tenant.adminToken });
    const submit = (password: string): Promise<ApiResponse> =>
      api.call("POST", `/${entry}/v1/auth/reset-password`, { body: { token: issued.body.reset.token, password } });
    const [a, b] = await Promise.all([submit(NEW_PASSWORD), submit(OTHER_PASSWORD)]);
    assert.deepEqual([a.status, b.status].sort(), [200, 400], `${a.text} ${b.text}`);
    assert.equal((a.status === 400 ? a : b).body.error.code, "RESET_TOKEN_INVALID");
    assert.deepEqual(await working(entry, email, [TEST_PASSWORD, NEW_PASSWORD, OTHER_PASSWORD]), [a.status === 200 ? NEW_PASSWORD : OTHER_PASSWORD]);
    assert.equal(await auditCount("reset_password", user.id), 1);
  });

  test(`${entry}：同一个邀请令牌同时提交两个不同的密码——恰好一个成功，有效的是成功那一方的密码`, async () => {
    const email = `invite-twice@${domain}`;
    const invited =
      entry === "platform"
        ? await api.call("POST", "/platform/v1/staff", { token: rootToken, body: { email, name: "受邀", role: "finance" } })
        : await api.call("POST", "/tenant/v1/users", { token: tenant.adminToken, body: { email, name: "受邀", role: "finance" } });
    assert.equal(invited.status, 201, invited.text);
    const submit = (password: string): Promise<ApiResponse> =>
      api.call("POST", `/${entry}/v1/auth/accept-invite`, { body: { token: invited.body.invite.token, password } });
    const [a, b] = await Promise.all([submit(NEW_PASSWORD), submit(OTHER_PASSWORD)]);
    assert.deepEqual([a.status, b.status].sort(), [200, 400], `${a.text} ${b.text}`);
    assert.equal((a.status === 400 ? a : b).body.error.code, "INVITE_INVALID");
    assert.deepEqual(await working(entry, email, [NEW_PASSWORD, OTHER_PASSWORD]), [a.status === 200 ? NEW_PASSWORD : OTHER_PASSWORD]);
    assert.equal(await auditCount("accept_invite", invited.body.user.id), 1);
  });
}

test("平台：改密和命令行重设（admin:reset-password 的同一个流程）同时进行——恰好一个成功，最后有效的就是成功那一方的密码；带临时密码开关时也一样", async () => {
  for (const temporaryPassword of [false, true]) {
    const email = `race-cli-${temporaryPassword ? "temp" : "plain"}@platform.test`;
    const accessToken = await platformUser(email);
    const user = await row("platform", email);
    const [changed, reset] = await Promise.allSettled([
      change("platform", accessToken, TEST_PASSWORD, NEW_PASSWORD),
      resetSuperAdminPassword(api.db.pool, { email, password: TEMPORARY, temporaryPassword }, api.clock.now()),
    ]);
    assert.equal(changed.status, "fulfilled");
    const changeResponse = (changed as PromiseFulfilledResult<ApiResponse>).value;
    const succeeded = [changeResponse.status === 204, reset.status === "fulfilled"];
    assert.equal(succeeded.filter(Boolean).length, 1, `改密 ${changeResponse.status} ${changeResponse.text}；重设 ${reset.status}`);
    if (reset.status === "rejected") assert.equal(reset.reason.code, "PASSWORD_CHANGED_MEANWHILE");
    else assert.ok([400, 401].includes(changeResponse.status), changeResponse.text);
    assert.deepEqual(await working("platform", email, [TEST_PASSWORD, NEW_PASSWORD, TEMPORARY]), [succeeded[0] ? NEW_PASSWORD : TEMPORARY]);
    assert.equal((await row("platform", email)).must_change_password, succeeded[0] ? false : temporaryPassword);
    assert.equal((await auditCount("change_password", user.id)) + (await auditCount("reset_password", user.id)), 1);
  }
});

test("平台：两次命令行重设同时进行——恰好一个成功；失败的那次报「密码刚被改过」，不会出现「显示了临时密码却登录不了」", async () => {
  const email = "cli-twice@platform.test";
  await platformUser(email);
  const user = await row("platform", email);
  const attempts = await Promise.allSettled([
    resetSuperAdminPassword(api.db.pool, { email, password: NEW_PASSWORD, temporaryPassword: true }, api.clock.now()),
    resetSuperAdminPassword(api.db.pool, { email, password: OTHER_PASSWORD, temporaryPassword: true }, api.clock.now()),
  ]);
  assert.deepEqual(attempts.map((attempt) => attempt.status).sort(), ["fulfilled", "rejected"]);
  const failed = attempts.find((attempt) => attempt.status === "rejected") as PromiseRejectedResult;
  assert.equal(failed.reason.code, "PASSWORD_CHANGED_MEANWHILE");
  assert.equal(failed.reason.statusCode, 409);
  assert.deepEqual(
    await working("platform", email, [TEST_PASSWORD, NEW_PASSWORD, OTHER_PASSWORD]),
    [attempts[0]?.status === "fulfilled" ? NEW_PASSWORD : OTHER_PASSWORD],
  );
  assert.equal(await auditCount("reset_password", user.id), 1);
});
