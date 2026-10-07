/**
 * 登录、限速、邀请、「至少保留一个管理员」的补充验证（auth.itest.ts、tenant-users.itest.ts 没覆盖到的角落）：
 * 邮箱的各种写法绕不过限速也造不出重复账号、失败原因从响应上分辨不出、限速不会被用来从别的地址锁死账号、
 * 邀请过期的那一毫秒、对已停用账号重发邀请、并发邀请同一个邮箱、两个管理员同时停用 / 降级自己。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { INVITE_TTL_MS } from "./auth/invite-token.ts";
import { type ApiResponse, type TenantFixture, type TestApi, TEST_PASSWORD, addTenantUser, createTestApi } from "./testing/api.ts";

let api: TestApi;
let platformToken: string;
let a: TenantFixture;

before(async () => {
  api = await createTestApi();
  platformToken = await api.superAdminToken();
  a = await api.tenantWithAdmin(platformToken, "车队甲", "admin@a.test");
});
after(() => api.close());

const tenantLogin = (email: string, password: string, ip?: string): Promise<ApiResponse> =>
  api.call("POST", "/tenant/v1/auth/login", { body: { email, password }, ...(ip === undefined ? {} : { ip }) });

async function auditCount(): Promise<number> {
  return (await api.db.owner.query("select count(*)::int as n from audit_logs")).rows[0].n;
}

test("邮箱换大小写、加前后空格都算同一个邮箱：第 6 次照样 429；被拦下的请求不写审计、不建会话，Retry-After 与响应体一致并随时间减少", async () => {
  const ip = "198.51.100.20";
  const reader = await addTenantUser(api, a.adminToken, "throttle@a.test", "readonly");
  const variants = ["Throttle@A.test", "  throttle@a.test", "THROTTLE@A.TEST  ", "tHrOtTlE@a.TeSt", "\tthrottle@a.test\n"];
  for (const email of variants) {
    const res = await tenantLogin(email, "wrong-password", ip);
    assert.equal(res.status, 401, `${JSON.stringify(email)}: ${res.text}`);
  }
  const auditBefore = await auditCount();
  const sessionsBefore = (await api.db.owner.query("select count(*)::int as n from tenant_sessions where user_id = $1", [reader.id])).rows[0].n;
  // 第 6 次：换一种写法，而且密码是对的
  const blocked = await tenantLogin("Throttle@a.TEST", TEST_PASSWORD, ip);
  assert.equal(blocked.status, 429, blocked.text);
  assert.equal(blocked.body.error.code, "TOO_MANY_LOGIN_ATTEMPTS");
  assert.equal(blocked.body.access_token, undefined);
  assert.equal(blocked.headers["retry-after"], String(15 * 60));
  assert.equal(blocked.body.error.details.retry_after_seconds, 15 * 60);
  assert.equal(await auditCount(), auditBefore, "被限速拦下的请求不应写审计（ADR 0008）");
  const sessionsAfter = (await api.db.owner.query("select count(*)::int as n from tenant_sessions where user_id = $1", [reader.id])).rows[0].n;
  assert.equal(sessionsAfter, sessionsBefore, "被限速拦下的请求建了会话");

  api.clock.advance(15 * 60 * 1000 - 1);
  try {
    const almost = await tenantLogin("throttle@a.test", TEST_PASSWORD, ip);
    assert.equal(almost.status, 429, "窗口还差 1 毫秒结束");
    assert.equal(almost.headers["retry-after"], "1");
    api.clock.advance(1);
    const reopened = await tenantLogin("throttle@a.test", TEST_PASSWORD, ip);
    assert.equal(reopened.status, 200, `窗口刚好结束的那一刻应当放行：${reopened.text}`);
  } finally {
    api.clock.advance(-15 * 60 * 1000);
  }
});

test("邮箱换大小写、加空格造不出第二个账号；全角字符等不合法写法直接 400", async () => {
  for (const email of ["Admin@A.test", " admin@a.test ", "ADMIN@A.TEST"]) {
    const res = await api.call("POST", "/tenant/v1/users", { token: a.adminToken, body: { email, name: "重复", role: "readonly" } });
    assert.equal(res.status, 409, `${email}: ${res.text}`);
    assert.equal(res.body.error.code, "EMAIL_TAKEN");
  }
  for (const email of ["Root@Platform.test", " ROOT@PLATFORM.TEST "]) {
    const res = await api.call("POST", "/platform/v1/staff", { token: platformToken, body: { email, name: "重复", role: "readonly" } });
    assert.equal(res.status, 409, `${email}: ${res.text}`);
  }
  const taken = await api.call("POST", "/platform/v1/tenants", { token: platformToken, body: { name: "车队丙", admin: { email: " Admin@A.Test", name: "丙" } } });
  assert.equal(taken.status, 409, taken.text);
  for (const email of ["ａdmin@a.test", "admin@a.test​", "admin@а.test", "admin@a.test\u0000", "admin@a.test,evil@b.test", "admin@a.test\r\nbcc: evil@b.test"]) {
    const res = await api.call("POST", "/tenant/v1/users", { token: a.adminToken, body: { email, name: "形近", role: "readonly" } });
    assert.equal(res.status, 400, `${JSON.stringify(email)}: ${res.status} ${res.text}`);
  }
  const stored = await api.db.owner.query(
    `select email from tenant_users where email <> lower(btrim(email))
     union all select email from platform_users where email <> lower(btrim(email))`,
  );
  assert.deepEqual(stored.rows, []);
  const duplicates = await api.db.owner.query("select lower(email) from tenant_users group by 1 having count(*) > 1");
  assert.deepEqual(duplicates.rows, []);
  assert.equal((await api.db.owner.query("select count(*)::int as n from tenants")).rows[0].n, 1, "邮箱冲突的创建请求留下了租户");
});

test("邮箱不存在、密码错误、已邀请未激活、已停用但密码错误：状态码、响应体、响应头完全一样，分辨不出账号是否存在", async () => {
  const invited = await api.call("POST", "/tenant/v1/users", { token: a.adminToken, body: { email: "pending@a.test", name: "待激活", role: "readonly" } });
  assert.equal(invited.status, 201, invited.text);
  const disabled = await addTenantUser(api, a.adminToken, "gone@a.test", "readonly");
  assert.equal((await api.call("DELETE", `/tenant/v1/users/${disabled.id}`, { token: a.adminToken })).status, 204);

  const comparable = (res: ApiResponse): unknown => {
    const headers: Record<string, unknown> = { ...res.headers };
    delete headers["date"];
    return { status: res.status, text: res.text, headers };
  };
  const unknown = comparable(await tenantLogin("nobody@a.test", "wrong-password", "198.51.100.30"));
  assert.equal((unknown as { status: number }).status, 401);
  for (const email of ["admin@a.test", "pending@a.test", "gone@a.test"]) {
    assert.deepEqual(comparable(await tenantLogin(email, "wrong-password", "198.51.100.30")), unknown, email);
  }
  // 待激活的账号即使「猜中」了以后才会设的密码也一样
  assert.deepEqual(comparable(await tenantLogin("pending@a.test", TEST_PASSWORD, "198.51.100.31")), unknown);
});

test("限速表里只有哈希：没有邮箱和来源地址的原文", async () => {
  await tenantLogin("plaintext-check@a.test", "wrong-password", "198.51.100.40");
  const rows = await api.db.owner.query<{ key: string }>("select key from login_throttles");
  assert.ok(rows.rows.length >= 2);
  for (const row of rows.rows) assert.match(row.key, /^[0-9a-f]{64}$/);
  const dump = JSON.stringify((await api.db.owner.query("select * from login_throttles")).rows);
  assert.ok(!dump.includes("plaintext-check") && !dump.includes("198.51.100.40"));
});

test("设计取舍（ADR 0008）：攻击者在自己的地址上连错 5 次只锁住他自己的地址，账号主人从别的地址照常登录；主人登录成功不会替攻击者清零", async () => {
  const victim = await addTenantUser(api, a.adminToken, "victim@a.test", "readonly");
  assert.ok(victim.id);
  const attacker = "203.0.113.66";
  for (let i = 0; i < 5; i += 1) assert.equal((await tenantLogin("victim@a.test", `guess-${i}`, attacker)).status, 401);
  assert.equal((await tenantLogin("victim@a.test", "guess-5", attacker)).status, 429);
  const owner = await tenantLogin("victim@a.test", TEST_PASSWORD, "198.51.100.50");
  assert.equal(owner.status, 200, `账号主人被别人的错误尝试锁在了门外：${owner.text}`);
  const stillBlocked = await tenantLogin("victim@a.test", TEST_PASSWORD, attacker);
  assert.equal(stillBlocked.status, 429, "主人登录成功后，攻击者地址上的计数被清零了");
});

for (const entry of ["platform", "tenant"] as const) {
  test(`${entry} 邀请的过期边界：第 7 天的最后 1 毫秒还能用，满 7 天的那一刻失效`, async () => {
    const invite = async (email: string): Promise<string> => {
      const res =
        entry === "platform"
          ? await api.call("POST", "/platform/v1/staff", { token: platformToken, body: { email, name: "边界", role: "readonly" } })
          : await api.call("POST", "/tenant/v1/users", { token: a.adminToken, body: { email, name: "边界", role: "readonly" } });
      assert.equal(res.status, 201, res.text);
      assert.equal(new Date(res.body.invite.expires_at).getTime(), api.clock.now().getTime() + INVITE_TTL_MS);
      return res.body.invite.token as string;
    };
    const accept = (token: string): Promise<ApiResponse> =>
      api.call("POST", `/${entry}/v1/auth/accept-invite`, { body: { token, password: TEST_PASSWORD } });
    const early = await invite(`edge-early@${entry}-edge.test`);
    const late = await invite(`edge-late@${entry}-edge.test`);
    api.clock.advance(INVITE_TTL_MS - 1);
    try {
      assert.equal((await accept(early)).status, 200, "还差 1 毫秒过期的邀请应当可用");
      api.clock.advance(1);
      const expired = await accept(late);
      assert.equal(expired.status, 400, expired.text);
      assert.equal(expired.body.error.code, "INVITE_INVALID");
    } finally {
      api.clock.advance(-INVITE_TTL_MS);
    }
  });
}

test("对已激活过又被停用的账号重发邀请：409，账号仍是停用、没有新令牌；对从未激活就被停用的账号重发：发新令牌，旧令牌仍然无效", async () => {
  const used = await addTenantUser(api, a.adminToken, "used@a.test", "readonly");
  assert.equal((await api.call("DELETE", `/tenant/v1/users/${used.id}`, { token: a.adminToken })).status, 204);
  const again = await api.call("POST", "/tenant/v1/users", { token: a.adminToken, body: { email: "used@a.test", name: "换个名字", role: "admin" } });
  assert.equal(again.status, 409, again.text);
  assert.equal(again.body.invite, undefined);
  const viaPlatform = await api.call("POST", `/platform/v1/tenants/${a.tenantId}/admin-invites`, { token: platformToken, body: { email: "used@a.test", name: "换个名字" } });
  assert.equal(viaPlatform.status, 409, viaPlatform.text);
  const row = (await api.db.owner.query("select name, role, status, invite_token_hash from tenant_users where id = $1", [used.id])).rows[0];
  assert.deepEqual(row, { name: "used@a.test", role: "readonly", status: "disabled", invite_token_hash: null });

  const first = await api.call("POST", "/tenant/v1/users", { token: a.adminToken, body: { email: "never@a.test", name: "从未激活", role: "readonly" } });
  assert.equal(first.status, 201, first.text);
  assert.equal((await api.call("DELETE", `/tenant/v1/users/${first.body.user.id}`, { token: a.adminToken })).status, 204);
  const second = await api.call("POST", "/tenant/v1/users", { token: a.adminToken, body: { email: "never@a.test", name: "从未激活", role: "dispatch" } });
  assert.equal(second.status, 201, second.text);
  assert.equal(second.body.user.id, first.body.user.id, "应当复用原来的账号");
  assert.equal(second.body.user.status, "invited");
  assert.notEqual(second.body.invite.token, first.body.invite.token);
  // 旧令牌 + 弱密码：如果旧令牌还有效，会走到密码强度检查而返回 WEAK_PASSWORD
  const old = await api.call("POST", "/tenant/v1/auth/accept-invite", { body: { token: first.body.invite.token, password: "weak" } });
  assert.equal(old.body.error.code, "INVITE_INVALID");
  const fresh = await api.call("POST", "/tenant/v1/auth/accept-invite", { body: { token: second.body.invite.token, password: "weak" } });
  assert.equal(fresh.body.error.code, "WEAK_PASSWORD");
});

test("并发邀请同一个新邮箱（8 个请求同时到）：没有 500，只留下一个账号，返回过的令牌里恰好一个与库里的对得上", async () => {
  const { hashInviteToken } = await import("./auth/invite-token.ts");
  for (const [label, send, table] of [
    ["租户", () => api.call("POST", "/tenant/v1/users", { token: a.adminToken, body: { email: "race@a.test", name: "并发", role: "readonly" } }), "tenant_users"],
    ["平台", () => api.call("POST", "/platform/v1/staff", { token: platformToken, body: { email: "race@platform.test", name: "并发", role: "readonly" } }), "platform_users"],
  ] as const) {
    const results = await Promise.all(Array.from({ length: 8 }, () => send()));
    const statuses = results.map((res) => res.status);
    assert.ok(statuses.every((status) => status === 201 || status === 409), `${label}: ${statuses.join(",")}`);
    assert.ok(statuses.includes(201), label);
    const rows = await api.db.owner.query(`select invite_token_hash from ${table} where email like 'race@%'`);
    assert.equal(rows.rows.length, 1, `${label}: 留下了 ${rows.rows.length} 个账号`);
    const issued = results.filter((res) => res.status === 201).map((res) => hashInviteToken(res.body.invite.token as string));
    assert.equal(issued.filter((hash) => hash === rows.rows[0].invite_token_hash).length, 1, label);
  }
});

test("两个管理员同时对自己 / 对方下手（停用自己、停用对方 + 降级对方、降级自己 + 停用自己）：每一轮都恰好成功一个，租户始终留有在用的管理员", async () => {
  const second = await addTenantUser(api, a.adminToken, "second-admin@a.test", "admin");
  const admins = [
    { id: a.adminId, email: a.adminEmail, token: a.adminToken, name: "车队甲管理员" },
    { id: second.id, email: "second-admin@a.test", token: second.token, name: "second-admin@a.test" },
  ] as const;
  const [x, y] = admins;
  const demote = (actor: (typeof admins)[number], target: (typeof admins)[number]): Promise<ApiResponse> =>
    api.call("PUT", `/tenant/v1/users/${target.id}`, { token: actor.token, body: { name: target.name, role: "readonly", status: "active" } });
  const disable = (actor: (typeof admins)[number], target: (typeof admins)[number]): Promise<ApiResponse> =>
    api.call("DELETE", `/tenant/v1/users/${target.id}`, { token: actor.token });
  const rounds: [string, () => Promise<ApiResponse>, () => Promise<ApiResponse>][] = [
    ["各自停用自己", () => disable(x, x), () => disable(y, y)],
    ["甲停用乙，乙降级甲", () => disable(x, y), () => demote(y, x)],
    ["甲降级自己，乙停用自己", () => demote(x, x), () => disable(y, y)],
    ["各自降级自己", () => demote(x, x), () => demote(y, y)],
  ];
  const tokens = new Map<string, string>(admins.map((admin) => [admin.id, admin.token]));
  for (const [label, first, other] of rounds) {
    const results = await Promise.all([first(), other()]);
    const ok = results.filter((res) => res.status === 200 || res.status === 204).length;
    const refused = results.filter((res) => res.status === 409 || res.status === 403 || res.status === 401).length;
    assert.equal(ok, 1, `${label}: ${results.map((res) => `${res.status} ${res.text}`).join(" | ")}`);
    assert.equal(refused, 1, label);
    const active = await api.db.owner.query<{ id: string }>(
      "select id from tenant_users where tenant_id = $1 and role = 'admin' and status = 'active'",
      [a.tenantId],
    );
    assert.equal(active.rows.length, 1, `${label}: 剩下 ${active.rows.length} 个在用的管理员`);
    // 复原：由剩下的那个管理员把另一个恢复成在用的管理员；被停用过的要重新登录
    const survivor = admins.find((admin) => admin.id === active.rows[0]?.id) as (typeof admins)[number];
    const fallen = admins.find((admin) => admin.id !== survivor.id) as (typeof admins)[number];
    const restored = await api.call("PUT", `/tenant/v1/users/${fallen.id}`, {
      token: tokens.get(survivor.id) as string,
      body: { name: fallen.name, role: "admin", status: "active" },
    });
    assert.equal(restored.status, 200, `${label} 复原：${restored.text}`);
    const stillIn = await api.call("GET", "/tenant/v1/auth/me", { token: tokens.get(fallen.id) as string });
    if (stillIn.status !== 200) {
      const relogin = await tenantLogin(fallen.email, TEST_PASSWORD, "198.51.100.90");
      assert.equal(relogin.status, 200, relogin.text);
      tokens.set(fallen.id, relogin.body.access_token as string);
    }
    // 后面的轮次要用最新的令牌
    for (const admin of admins) (admin as { token: string }).token = tokens.get(admin.id) as string;
  }
});
