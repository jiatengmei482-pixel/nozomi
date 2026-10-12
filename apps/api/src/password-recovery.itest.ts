/**
 * 密码找回（ADR 0008）：自己改密码；管理员发一次性重置令牌、本人凭它设置新密码。全程不依赖邮件。
 * 命令行给超级管理员重设密码的测试在 cli/admin-reset-password.itest.ts。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { RESET_TTL_MS } from "./auth/reset-token.ts";
import { type ApiResponse, TEST_PASSWORD, type TenantFixture, type TestApi, addTenantUser, createTestApi } from "./testing/api.ts";

let api: TestApi;
let rootToken: string;
let rootId: string;
let tenant: TenantFixture;
let other: TenantFixture;

before(async () => {
  api = await createTestApi();
  rootToken = await api.superAdminToken("root@platform.test");
  rootId = (await api.call("GET", "/platform/v1/auth/me", { token: rootToken })).body.user.id;
  tenant = await api.tenantWithAdmin(rootToken, "车队甲", "admin@a.test");
  other = await api.tenantWithAdmin(rootToken, "车队乙", "admin@b.test");
});
after(() => api.close());

const NEW_PASSWORD = "Fresh-Lantern-2027";
let ipCounter = 0;
const freshIp = (): string => `10.9.0.${(ipCounter++ % 250) + 1}`;

async function addStaff(email: string, role = "operations"): Promise<{ id: string; token: string }> {
  const invited = await api.call("POST", "/platform/v1/staff", { token: rootToken, body: { email, name: email, role } });
  assert.equal(invited.status, 201, invited.text);
  await api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.body.invite.token, password: TEST_PASSWORD } });
  return { id: invited.body.user.id, token: await login("platform", email, TEST_PASSWORD) };
}

async function tryLogin(entry: "platform" | "tenant", email: string, password: string): Promise<ApiResponse> {
  return api.call("POST", `/${entry}/v1/auth/login`, { ip: freshIp(), body: { email, password } });
}

async function login(entry: "platform" | "tenant", email: string, password: string): Promise<string> {
  const res = await tryLogin(entry, email, password);
  assert.equal(res.status, 200, res.text);
  return res.body.access_token as string;
}

async function auditOf(resourceId: string, action: string): Promise<any[]> {
  const rows = await api.db.owner.query(
    "select tenant_id, actor_type, actor_id, source, ip, before, after from audit_logs where resource_id = $1 and action = $2 order by id",
    [resourceId, action],
  );
  return rows.rows;
}

interface Account {
  entry: "platform" | "tenant";
  email: string;
  id: string;
  token: string;
  /** 给这个账号发重置令牌 */
  issue: () => Promise<ApiResponse>;
}

let seq = 0;
async function newAccount(entry: "platform" | "tenant"): Promise<Account> {
  const email = `user-${seq++}@${entry === "platform" ? "platform" : "a"}.test`;
  if (entry === "platform") {
    const staff = await addStaff(email);
    return { entry, email, ...staff, issue: () => api.call("POST", `/platform/v1/staff/${staff.id}/password-reset`, { token: rootToken }) };
  }
  const user = await addTenantUser(api, tenant.adminToken, email, "dispatch");
  return { entry, email, ...user, issue: () => api.call("POST", `/tenant/v1/users/${user.id}/password-reset`, { token: tenant.adminToken }) };
}

for (const entry of ["platform", "tenant"] as const) {
  const table = entry === "platform" ? "platform_users" : "tenant_users";
  const me = (token: string): Promise<ApiResponse> => api.call("GET", `/${entry}/v1/auth/me`, { token });
  const change = (token: string, current: string, next: string, ip?: string): Promise<ApiResponse> =>
    api.call("POST", `/${entry}/v1/auth/change-password`, { token, body: { current_password: current, new_password: next }, ...(ip ? { ip } : {}) });
  const reset = (token: string, password: string): Promise<ApiResponse> =>
    api.call("POST", `/${entry}/v1/auth/reset-password`, { body: { token, password } });

  test(`${entry} 自己改密码：要当前密码；成功后旧密码不能登录、新密码可以；其他会话失效、当前会话保留；写审计`, async () => {
    const account = await newAccount(entry);
    const elsewhere = await login(entry, account.email, TEST_PASSWORD);
    const res = await change(account.token, TEST_PASSWORD, NEW_PASSWORD);
    assert.equal(res.status, 204, res.text);
    assert.equal(res.text, "");
    assert.equal((await me(account.token)).status, 200, "当前会话保留");
    assert.equal((await me(elsewhere)).status, 401, "其他会话失效");
    assert.equal((await tryLogin(entry, account.email, TEST_PASSWORD)).status, 401);
    await login(entry, account.email, NEW_PASSWORD);
    const audit = await auditOf(account.id, "change_password");
    assert.equal(audit.length, 1);
    assert.deepEqual(
      { actor_id: audit[0].actor_id, source: audit[0].source, before: audit[0].before, after: audit[0].after },
      { actor_id: account.id, source: "console", before: null, after: null },
    );
    assert.equal(audit[0].tenant_id, entry === "tenant" ? tenant.tenantId : null);
  });

  test(`${entry} 自己改密码：当前密码不对、新密码太弱、新旧相同、没登录，都不改；错误里不回显密码`, async () => {
    const account = await newAccount(entry);
    const hashBefore = (await api.db.owner.query(`select password_hash from ${table} where id = $1`, [account.id])).rows[0].password_hash;
    const wrong = await change(account.token, "Wrong-Password-000", NEW_PASSWORD);
    assert.equal(wrong.status, 400);
    assert.equal(wrong.body.error.code, "CURRENT_PASSWORD_INCORRECT");
    const weak = await change(account.token, TEST_PASSWORD, "short");
    assert.equal(weak.status, 400);
    assert.equal(weak.body.error.code, "WEAK_PASSWORD");
    const withEmail = await change(account.token, TEST_PASSWORD, `${account.email.split("@")[0]}-Abc12345`);
    assert.equal(withEmail.body.error.details.issues[0].code, "PASSWORD_CONTAINS_EMAIL");
    const same = await change(account.token, TEST_PASSWORD, TEST_PASSWORD);
    assert.equal(same.status, 400);
    assert.equal(same.body.error.code, "PASSWORD_UNCHANGED");
    const anonymous = await api.call("POST", `/${entry}/v1/auth/change-password`, { body: { current_password: TEST_PASSWORD, new_password: NEW_PASSWORD } });
    assert.equal(anonymous.status, 401);
    const missing = await api.call("POST", `/${entry}/v1/auth/change-password`, { token: account.token, body: { new_password: NEW_PASSWORD } });
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error.code, "VALIDATION_FAILED");
    for (const res of [wrong, weak, withEmail, same, missing]) {
      assert.ok(!res.text.includes("Wrong-Password-000") && !res.text.includes(TEST_PASSWORD) && !res.text.includes(NEW_PASSWORD));
    }
    const hashAfter = (await api.db.owner.query(`select password_hash from ${table} where id = $1`, [account.id])).rows[0].password_hash;
    assert.equal(hashAfter, hashBefore);
    assert.deepEqual(await auditOf(account.id, "change_password"), []);
  });

  test(`${entry} 自己改密码：拿着别人的会话猜当前密码会被限速（第 6 次 429，这时给对了也不行），窗口过后恢复`, async () => {
    const account = await newAccount(entry);
    const ip = freshIp();
    for (let i = 0; i < 5; i++) assert.equal((await change(account.token, `Guess-Password-00${i}`, NEW_PASSWORD, ip)).status, 400);
    const blocked = await change(account.token, TEST_PASSWORD, NEW_PASSWORD, ip);
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error.code, "TOO_MANY_LOGIN_ATTEMPTS");
    await login(entry, account.email, TEST_PASSWORD);
    api.clock.advance(15 * 60_000);
    assert.equal((await change(account.token, TEST_PASSWORD, NEW_PASSWORD, ip)).status, 204);
  });

  test(`${entry} 重置：发出令牌不改现有密码、不影响现有会话；库里只有令牌的哈希；凭令牌设新密码后全部会话失效；各写一条审计`, async () => {
    const account = await newAccount(entry);
    const issued = await account.issue();
    assert.equal(issued.status, 201, issued.text);
    assert.deepEqual(Object.keys(issued.body), ["user", "reset"]);
    assert.equal(issued.body.user.id, account.id);
    const token = issued.body.reset.token as string;
    assert.match(token, entry === "platform" ? /^nzr_[A-Za-z0-9_-]{43}$/ : /^nzr_[0-9a-f]{32}\.[A-Za-z0-9_-]{43}$/);
    assert.equal(new Date(issued.body.reset.expires_at).getTime() - api.clock.now().getTime(), RESET_TTL_MS);
    assert.equal(RESET_TTL_MS, 24 * 60 * 60 * 1000);

    assert.equal((await me(account.token)).status, 200, "发出重置令牌不应让现有会话失效");
    await login(entry, account.email, TEST_PASSWORD);
    const row = (await api.db.owner.query(`select * from ${table} where id = $1`, [account.id])).rows[0];
    assert.match(row.reset_token_hash, /^[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(row).includes(token));

    const second = await login(entry, account.email, TEST_PASSWORD);
    const done = await reset(token, NEW_PASSWORD);
    assert.equal(done.status, 200, done.text);
    assert.equal(done.body.user.id, account.id);
    assert.ok(!done.text.includes(NEW_PASSWORD) && !done.text.includes("scrypt") && !done.text.includes("nzr_"));
    for (const session of [account.token, second]) assert.equal((await me(session)).status, 401, "重置后全部会话失效");
    assert.equal((await tryLogin(entry, account.email, TEST_PASSWORD)).status, 401);
    await login(entry, account.email, NEW_PASSWORD);

    const requested = await auditOf(account.id, "request_password_reset");
    assert.equal(requested.length, 1);
    assert.equal(requested[0].actor_id, entry === "platform" ? rootId : tenant.adminId);
    const completed = await auditOf(account.id, "reset_password");
    assert.equal(completed.length, 1);
    assert.equal(completed[0].actor_id, account.id);
    assert.ok(!JSON.stringify([...requested, ...completed]).includes(token));
  });

  test(`${entry} 重置：令牌只能用一次；用过的、乱写的、另一类入口的令牌返回同一个错误；并发提交只有一个成功`, async () => {
    const account = await newAccount(entry);
    const token = (await account.issue()).body.reset.token as string;
    const results = await Promise.all([reset(token, NEW_PASSWORD), reset(token, "Another-Lantern-2028")]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
    const used = await reset(token, "Third-Lantern-2029");
    const unknown = await reset(token.replace(/.$/, (c) => (c === "A" ? "B" : "A")), "Third-Lantern-2029");
    assert.equal(used.status, 400);
    assert.equal(used.body.error.code, "RESET_TOKEN_INVALID");
    assert.equal(unknown.text, used.text);
    for (const garbage of ["nzr_", "nzi_abc", "x".repeat(200)]) assert.equal((await reset(garbage, NEW_PASSWORD)).text, used.text);

    const fresh = await newAccount(entry);
    const freshToken = (await fresh.issue()).body.reset.token as string;
    const wrongEntry = entry === "platform" ? "tenant" : "platform";
    const crossed = await api.call("POST", `/${wrongEntry}/v1/auth/reset-password`, { body: { token: freshToken, password: NEW_PASSWORD } });
    assert.equal(crossed.status, 400);
    assert.equal(crossed.body.error.code, "RESET_TOKEN_INVALID");
    await login(entry, fresh.email, TEST_PASSWORD);
  });

  test(`${entry} 重置：24 小时过期（最后 1 毫秒还能用）；再发一次令牌，上一个作废；密码太弱时令牌还能再用`, async () => {
    const early = await newAccount(entry);
    const late = await newAccount(entry);
    const earlyToken = (await early.issue()).body.reset.token as string;
    const lateToken = (await late.issue()).body.reset.token as string;
    api.clock.advance(RESET_TTL_MS - 1);
    try {
      assert.equal((await reset(earlyToken, NEW_PASSWORD)).status, 200);
      api.clock.advance(1);
      const expired = await reset(lateToken, NEW_PASSWORD);
      assert.equal(expired.status, 400);
      assert.equal(expired.body.error.code, "RESET_TOKEN_INVALID");
    } finally {
      api.clock.advance(-RESET_TTL_MS);
    }
    await login(entry, late.email, TEST_PASSWORD);

    const first = (await late.issue()).body.reset.token as string;
    const second = (await late.issue()).body.reset.token as string;
    assert.notEqual(first, second);
    assert.equal((await reset(first, NEW_PASSWORD)).status, 400, "重新发出后，上一个令牌作废");
    const weak = await reset(second, "short");
    assert.equal(weak.status, 400);
    assert.equal(weak.body.error.code, "WEAK_PASSWORD");
    assert.equal((await reset(second, NEW_PASSWORD)).status, 200);
  });

  test(`${entry} 重置：只能发给在用的账号（待激活、已停用 → 409）；停用会作废已发出的令牌；自己改了密码后令牌也作废`, async () => {
    const pendingEmail = `pending-${seq++}@${entry === "platform" ? "platform" : "a"}.test`;
    const pending =
      entry === "platform"
        ? await api.call("POST", "/platform/v1/staff", { token: rootToken, body: { email: pendingEmail, name: "待激活", role: "readonly" } })
        : await api.call("POST", "/tenant/v1/users", { token: tenant.adminToken, body: { email: pendingEmail, name: "待激活", role: "readonly" } });
    const issueFor = (id: string): Promise<ApiResponse> =>
      entry === "platform"
        ? api.call("POST", `/platform/v1/staff/${id}/password-reset`, { token: rootToken })
        : api.call("POST", `/tenant/v1/users/${id}/password-reset`, { token: tenant.adminToken });
    const notActivated = await issueFor(pending.body.user.id);
    assert.equal(notActivated.status, 409);
    assert.equal(notActivated.body.error.code, "ACCOUNT_NOT_ACTIVE");

    const account = await newAccount(entry);
    const token = (await account.issue()).body.reset.token as string;
    const disable = (): Promise<ApiResponse> =>
      entry === "platform"
        ? api.call("POST", `/platform/v1/staff/${account.id}/disable`, { token: rootToken })
        : api.call("DELETE", `/tenant/v1/users/${account.id}`, { token: tenant.adminToken });
    assert.ok((await disable()).status < 300);
    assert.equal((await reset(token, NEW_PASSWORD)).status, 400, "停用后令牌作废");
    assert.equal((await issueFor(account.id)).status, 409, "已停用的账号不能发重置令牌");
    assert.equal((await issueFor("99999999-9999-4999-8999-999999999999")).status, 404);

    const selfChanged = await newAccount(entry);
    const stale = (await selfChanged.issue()).body.reset.token as string;
    assert.equal((await change(selfChanged.token, TEST_PASSWORD, NEW_PASSWORD)).status, 204);
    assert.equal((await reset(stale, "Third-Lantern-2029")).status, 400, "本人已经自己改了密码，之前发的重置令牌作废");
  });
}

test("发重置令牌需要权限：平台只有超级管理员能给平台员工发；租户只有管理员能给本租户用户发", async () => {
  const ops = await addStaff("ops-perm@platform.test", "operations");
  const target = await addStaff("target-perm@platform.test", "readonly");
  const denied = await api.call("POST", `/platform/v1/staff/${target.id}/password-reset`, { token: ops.token });
  assert.equal(denied.status, 403);
  assert.deepEqual(denied.body.error.details, { required: "staff.manage" });

  const dispatcher = await addTenantUser(api, tenant.adminToken, "dispatch-perm@a.test", "dispatch");
  const readonly = await addTenantUser(api, tenant.adminToken, "readonly-perm@a.test", "readonly");
  for (const token of [dispatcher.token, readonly.token]) {
    const res = await api.call("POST", `/tenant/v1/users/${dispatcher.id}/password-reset`, { token });
    assert.equal(res.status, 403);
  }
  for (const id of [target.id, dispatcher.id]) {
    const row = await api.db.owner.query(
      "select reset_token_hash from platform_users where id = $1 union all select reset_token_hash from tenant_users where id = $1",
      [id],
    );
    assert.equal(row.rows[0].reset_token_hash, null);
  }
});

test("平台给租户管理员发重置令牌：租户唯一的管理员忘了密码也能恢复；只针对该租户在用的管理员", async () => {
  const url = `/platform/v1/tenants/${tenant.tenantId}/admin-password-resets`;
  const ops = await addStaff("ops-tenant-reset@platform.test", "operations");
  const readonlyStaff = await addStaff("ro-tenant-reset@platform.test", "readonly");
  assert.equal((await api.call("POST", url, { token: readonlyStaff.token, body: { email: "admin@a.test" } })).status, 403);

  const issued = await api.call("POST", url, { token: ops.token, body: { email: " Admin@A.test " } });
  assert.equal(issued.status, 201, issued.text);
  assert.equal(issued.body.user.id, tenant.adminId);
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: tenant.adminToken })).status, 200, "发令牌不影响现有会话");

  const done = await api.call("POST", "/tenant/v1/auth/reset-password", { body: { token: issued.body.reset.token, password: NEW_PASSWORD } });
  assert.equal(done.status, 200, done.text);
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: tenant.adminToken })).status, 401);
  tenant.adminToken = await login("tenant", "admin@a.test", NEW_PASSWORD);

  const requested = await auditOf(tenant.adminId, "request_password_reset");
  assert.deepEqual(
    requested.map((r) => ({ tenant_id: r.tenant_id, actor_type: r.actor_type, actor_id: r.actor_id })),
    [{ tenant_id: tenant.tenantId, actor_type: "platform_user", actor_id: ops.id }],
  );

  const dispatcher = await addTenantUser(api, tenant.adminToken, "dispatch-not-admin@a.test", "dispatch");
  assert.ok(dispatcher.id);
  const cases: [string, string, number][] = [
    ["不是管理员的账号", "dispatch-not-admin@a.test", 404],
    ["别的租户的管理员", "admin@b.test", 404],
    ["不存在的邮箱", "nobody@a.test", 404],
  ];
  for (const [label, email, status] of cases) {
    const res = await api.call("POST", url, { token: ops.token, body: { email } });
    assert.equal(res.status, status, label);
  }
  assert.equal((await api.call("POST", "/platform/v1/tenants/99999999-9999-4999-8999-999999999999/admin-password-resets", { token: ops.token, body: { email: "admin@a.test" } })).status, 404);
  assert.equal((await api.call("POST", url, { token: ops.token, body: {} })).status, 400);
  const untouched = await api.db.owner.query("select reset_token_hash from tenant_users where id = $1", [other.adminId]);
  assert.equal(untouched.rows[0].reset_token_hash, null, "租户乙的管理员不应被动到");
  await login("tenant", "admin@b.test", TEST_PASSWORD);
});

test("重置令牌、新旧密码不出现在审计日志和应用日志里", async () => {
  const account = await newAccount("tenant");
  const token = (await account.issue()).body.reset.token as string;
  await api.call("POST", "/tenant/v1/auth/reset-password", { body: { token, password: "Logged-Nowhere-2030" } });
  const audit = (await api.db.owner.query("select row_to_json(a)::text as line from audit_logs a")).rows.map((r) => r.line).join("\n");
  for (const [name, text] of [["审计表", audit], ["应用日志", api.logs()]] as const) {
    for (const secret of [token, "Logged-Nowhere-2030", NEW_PASSWORD, TEST_PASSWORD]) assert.ok(!text.includes(secret), `${name}里出现了 ${secret.slice(0, 8)}…`);
    assert.doesNotMatch(text, /nzr_[A-Za-z0-9_.-]{20,}/, name);
    assert.ok(!text.includes("scrypt$"), name);
  }
});
