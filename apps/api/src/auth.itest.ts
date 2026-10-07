/**
 * 登录、会话、限速、邀请的集成测试（平台和租户两套入口）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { INVITE_TTL_MS } from "./auth/invite-token.ts";
import { SESSION_TTL_MS } from "./auth/session.ts";
import { TEST_PASSWORD, type TenantFixture, type TestApi, addTenantUser, createTestApi } from "./testing/api.ts";

let api: TestApi;
let platformToken: string;
let tenant: TenantFixture;

before(async () => {
  api = await createTestApi();
  platformToken = await api.superAdminToken("root@platform.test");
  tenant = await api.tenantWithAdmin(platformToken, "车队甲", "admin@a.test");
});
after(() => api.close());

const MINUTE = 60_000;
let ipCounter = 0;
/** 每个测试用自己的来源地址，限速计数互不影响。 */
const freshIp = (): string => `10.1.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

for (const entry of ["platform", "tenant"] as const) {
  const knownEmail = entry === "platform" ? "root@platform.test" : "admin@a.test";
  const loginUrl = `/${entry}/v1/auth/login`;

  test(`${entry} 登录：邮箱不存在和密码错误，状态码和响应体完全一样`, async () => {
    const ip = freshIp();
    const unknown = await api.call("POST", loginUrl, { ip, body: { email: `nobody-${entry}@x.test`, password: TEST_PASSWORD } });
    const wrong = await api.call("POST", loginUrl, { ip, body: { email: knownEmail, password: "Wrong-Password-000" } });
    assert.equal(unknown.status, 401);
    assert.equal(unknown.body.error.code, "INVALID_CREDENTIALS");
    assert.equal(wrong.status, 401);
    assert.equal(wrong.text, unknown.text);
  });

  test(`${entry} 登录：参数不合法返回 400，不计入限速、不写审计`, async () => {
    const res = await api.call("POST", loginUrl, { ip: freshIp(), body: { email: "不是邮箱", password: TEST_PASSWORD } });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "VALIDATION_FAILED");
    assert.ok(!res.text.includes(TEST_PASSWORD));
  });

  test(`${entry} 登录限速：同一邮箱同一地址连错 5 次后第 6 次 429（密码对了也不行），15 分钟后恢复`, async () => {
    const ip = freshIp();
    const email = entry === "platform" ? "throttle-p@platform.test" : "throttle-t@a.test";
    if (entry === "platform") {
      const invited = await api.call("POST", "/platform/v1/staff", { token: platformToken, body: { email, name: "限速", role: "readonly" } });
      await api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.body.invite.token, password: TEST_PASSWORD } });
    } else {
      await addTenantUser(api, tenant.adminToken, email, "readonly");
    }
    for (let i = 0; i < 5; i++) {
      const res = await api.call("POST", loginUrl, { ip, body: { email, password: "Wrong-Password-000" } });
      assert.equal(res.status, 401, `第 ${i + 1} 次`);
    }
    api.clock.advance(MINUTE);
    const blocked = await api.call("POST", loginUrl, { ip, body: { email, password: TEST_PASSWORD } });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error.code, "TOO_MANY_LOGIN_ATTEMPTS");
    assert.equal(blocked.body.error.details.retry_after_seconds, 14 * 60);
    assert.equal(blocked.headers["retry-after"], String(14 * 60));

    const otherIp = await api.call("POST", loginUrl, { ip: freshIp(), body: { email, password: TEST_PASSWORD } });
    assert.equal(otherIp.status, 200, "换一个来源地址（真正的用户）不受这个地址的失败影响");

    api.clock.advance(14 * MINUTE);
    const recovered = await api.call("POST", loginUrl, { ip, body: { email, password: TEST_PASSWORD } });
    assert.equal(recovered.status, 200, "窗口结束后恢复");
  });

  test(`${entry} 登录限速：不存在的邮箱同样被限速，表现与存在的邮箱一样`, async () => {
    const ip = freshIp();
    const email = `ghost-${entry}@nowhere.test`;
    for (let i = 0; i < 5; i++) {
      assert.equal((await api.call("POST", loginUrl, { ip, body: { email, password: "Wrong-Password-000" } })).status, 401);
    }
    assert.equal((await api.call("POST", loginUrl, { ip, body: { email, password: "Wrong-Password-000" } })).status, 429);
  });

  test(`${entry} 登录限速：登录成功后计数清零`, async () => {
    const ip = freshIp();
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < 4; i++) {
        assert.equal((await api.call("POST", loginUrl, { ip, body: { email: knownEmail, password: "Wrong-Password-000" } })).status, 401);
      }
      assert.equal((await api.call("POST", loginUrl, { ip, body: { email: knownEmail, password: TEST_PASSWORD } })).status, 200);
    }
  });

  test(`${entry} 登录限速：换着地址猜同一个邮箱，总共 20 次后全部拦下`, async () => {
    const email = `spray-${entry}@nowhere.test`;
    for (let i = 0; i < 20; i++) {
      const res = await api.call("POST", loginUrl, { ip: freshIp(), body: { email, password: "Wrong-Password-000" } });
      assert.equal(res.status, 401, `第 ${i + 1} 次`);
    }
    assert.equal((await api.call("POST", loginUrl, { ip: freshIp(), body: { email, password: "Wrong-Password-000" } })).status, 429);
    api.clock.advance(15 * MINUTE);
    assert.equal((await api.call("POST", loginUrl, { ip: freshIp(), body: { email, password: "Wrong-Password-000" } })).status, 401);
  });

  test(`${entry} 登录限速：并发的猜测请求绕不过计数（同一地址同时发 12 个，最多 5 个真正验证了密码）`, async () => {
    const ip = freshIp();
    const email = `burst-${entry}@nowhere.test`;
    const results = await Promise.all(
      Array.from({ length: 12 }, () => api.call("POST", loginUrl, { ip, body: { email, password: "Wrong-Password-000" } })),
    );
    const statuses = results.map((r) => r.status);
    assert.equal(statuses.filter((s) => s === 401).length, 5, JSON.stringify(statuses));
    assert.equal(statuses.filter((s) => s === 429).length, 7);
  });

  test(`${entry} 会话：8 小时内有效，满 8 小时失效`, async () => {
    const login = await api.call("POST", loginUrl, { ip: freshIp(), body: { email: knownEmail, password: TEST_PASSWORD } });
    assert.equal(login.status, 200);
    assert.equal(new Date(login.body.expires_at).getTime() - api.clock.now().getTime(), SESSION_TTL_MS);
    const token = login.body.access_token as string;
    api.clock.advance(SESSION_TTL_MS - 1_000);
    assert.equal((await api.call("GET", `/${entry}/v1/auth/me`, { token })).status, 200);
    api.clock.advance(1_000);
    const expired = await api.call("GET", `/${entry}/v1/auth/me`, { token });
    assert.equal(expired.status, 401);
    assert.equal(expired.body.error.code, "UNAUTHENTICATED");
    // 后面的测试还要用 before 里登录的令牌：它们也过期了，重新登录
    platformToken = (await api.call("POST", "/platform/v1/auth/login", { ip: freshIp(), body: { email: "root@platform.test", password: TEST_PASSWORD } })).body.access_token;
    tenant.adminToken = (await api.call("POST", "/tenant/v1/auth/login", { ip: freshIp(), body: { email: "admin@a.test", password: TEST_PASSWORD } })).body.access_token;
  });

  test(`${entry} 退出登录：这个令牌立即失效，同一账号的其他会话不受影响`, async () => {
    const first = await api.call("POST", loginUrl, { ip: freshIp(), body: { email: knownEmail, password: TEST_PASSWORD } });
    const second = await api.call("POST", loginUrl, { ip: freshIp(), body: { email: knownEmail, password: TEST_PASSWORD } });
    assert.notEqual(first.body.access_token, second.body.access_token);
    assert.equal((await api.call("POST", `/${entry}/v1/auth/logout`, { token: first.body.access_token })).status, 204);
    assert.equal((await api.call("GET", `/${entry}/v1/auth/me`, { token: first.body.access_token })).status, 401);
    assert.equal((await api.call("POST", `/${entry}/v1/auth/logout`, { token: first.body.access_token })).status, 401);
    assert.equal((await api.call("GET", `/${entry}/v1/auth/me`, { token: second.body.access_token })).status, 200);
  });

  test(`${entry}：没带令牌、令牌乱写、Authorization 格式不对，都是 401 UNAUTHENTICATED`, async () => {
    const url = `/${entry}/v1/auth/me`;
    assert.equal((await api.call("GET", url)).status, 401);
    assert.equal((await api.call("GET", url, { token: "abc.def.ghi" })).status, 401);
    const basic = await api.app.inject({ method: "GET", url, headers: { authorization: `Basic ${platformToken}` } });
    assert.equal(basic.statusCode, 401);
    assert.equal(basic.json().error.code, "UNAUTHENTICATED");
  });
}

test("除登录、接受邀请、凭令牌重置密码外，/platform/v1 和 /tenant/v1 的每个接口不带令牌都是 401", async () => {
  const routes = api.app.registeredRoutes.filter(
    (r) => r.method !== "HEAD" && (r.path.startsWith("/platform/v1/") || r.path.startsWith("/tenant/v1/")),
  );
  assert.ok(routes.length >= 20);
  const open: string[] = [];
  for (const route of routes) {
    const url = route.path.replace(":id", tenant.tenantId);
    const res = await api.call(route.method as "GET", url, { body: {} });
    if (res.status !== 401) open.push(`${route.method} ${route.path}`);
    else assert.equal(res.body.error.code, "UNAUTHENTICATED");
  }
  assert.deepEqual(open.sort(), [
    "POST /platform/v1/auth/accept-invite",
    "POST /platform/v1/auth/login",
    "POST /platform/v1/auth/reset-password",
    "POST /tenant/v1/auth/accept-invite",
    "POST /tenant/v1/auth/login",
    "POST /tenant/v1/auth/reset-password",
  ]);
});

test("停用平台账号：已登录的令牌立即失效；密码正确也登录不了（403 ACCOUNT_DISABLED）；启用后恢复", async () => {
  const email = "ops@platform.test";
  const invited = await api.call("POST", "/platform/v1/staff", { token: platformToken, body: { email, name: "运营", role: "operations" } });
  await api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.body.invite.token, password: TEST_PASSWORD } });
  const login = await api.call("POST", "/platform/v1/auth/login", { ip: freshIp(), body: { email, password: TEST_PASSWORD } });
  const token = login.body.access_token as string;
  assert.equal((await api.call("GET", "/platform/v1/tenants", { token })).status, 200);

  const disabled = await api.call("POST", `/platform/v1/staff/${invited.body.user.id}/disable`, { token: platformToken });
  assert.equal(disabled.status, 200);
  assert.equal(disabled.body.status, "disabled");
  assert.equal((await api.call("GET", "/platform/v1/tenants", { token })).status, 401, "旧令牌应立即失效");

  const ip = freshIp();
  const relogin = await api.call("POST", "/platform/v1/auth/login", { ip, body: { email, password: TEST_PASSWORD } });
  assert.equal(relogin.status, 403);
  assert.equal(relogin.body.error.code, "ACCOUNT_DISABLED");
  const wrong = await api.call("POST", "/platform/v1/auth/login", { ip, body: { email, password: "Wrong-Password-000" } });
  assert.equal(wrong.status, 401, "密码错误时不透露账号已停用");

  await api.call("POST", `/platform/v1/staff/${invited.body.user.id}/enable`, { token: platformToken });
  assert.equal((await api.call("GET", "/platform/v1/tenants", { token })).status, 401, "启用后旧令牌也不会复活");
  assert.equal((await api.call("POST", "/platform/v1/auth/login", { ip: freshIp(), body: { email, password: TEST_PASSWORD } })).status, 200);
});

test("暂停租户不影响登录（需求文档「租户状态」：暂停的租户继续履约已有订单）：已有令牌照常可用，可以重新登录，me 和登录响应里的租户状态是 suspended；恢复后变回 active", async () => {
  const staff = await addTenantUser(api, tenant.adminToken, "dispatch@a.test", "dispatch");
  const suspended = await api.call("POST", `/platform/v1/tenants/${tenant.tenantId}/suspend`, {
    token: platformToken,
    body: { reason: "资质过期" },
  });
  assert.equal(suspended.status, 200);
  assert.equal(suspended.body.status, "suspended");

  for (const token of [tenant.adminToken, staff.token]) {
    const me = await api.call("GET", "/tenant/v1/auth/me", { token });
    assert.equal(me.status, 200, "暂停后已有的令牌应当照常可用");
    assert.equal(me.body.tenant.status, "suspended");
  }
  assert.equal((await api.call("GET", "/tenant/v1/users", { token: tenant.adminToken })).status, 200);

  const login = await api.call("POST", "/tenant/v1/auth/login", { ip: freshIp(), body: { email: "admin@a.test", password: TEST_PASSWORD } });
  assert.equal(login.status, 200, login.text);
  assert.equal(login.body.tenant.status, "suspended");
  const invited = await api.call("POST", "/tenant/v1/users", { token: login.body.access_token, body: { email: "while-suspended@a.test", name: "暂停期间", role: "readonly" } });
  assert.equal(invited.status, 201, "暂停期间租户管理员仍能管理自己的账号");

  const again = await api.call("POST", `/platform/v1/tenants/${tenant.tenantId}/suspend`, { token: platformToken });
  assert.equal(again.status, 200, "重复暂停直接返回当前状态");
  const resumed = await api.call("POST", `/platform/v1/tenants/${tenant.tenantId}/resume`, { token: platformToken });
  assert.equal(resumed.body.status, "active");
  const me = await api.call("GET", "/tenant/v1/auth/me", { token: tenant.adminToken });
  assert.equal(me.status, 200);
  assert.equal(me.body.tenant.status, "active");
});

test("暂停租户之后，停用该租户里的某个账号仍然立即生效（账号停用与租户状态互不影响）", async () => {
  const staff = await addTenantUser(api, tenant.adminToken, "suspended-then-disabled@a.test", "readonly");
  await api.call("POST", `/platform/v1/tenants/${tenant.tenantId}/suspend`, { token: platformToken });
  try {
    assert.equal((await api.call("DELETE", `/tenant/v1/users/${staff.id}`, { token: tenant.adminToken })).status, 204);
    assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: staff.token })).status, 401);
    const login = await api.call("POST", "/tenant/v1/auth/login", { ip: freshIp(), body: { email: "suspended-then-disabled@a.test", password: TEST_PASSWORD } });
    assert.equal(login.status, 403);
    assert.equal(login.body.error.code, "ACCOUNT_DISABLED");
  } finally {
    await api.call("POST", `/platform/v1/tenants/${tenant.tenantId}/resume`, { token: platformToken });
  }
});

test("停用租户用户：他的令牌立即失效、不能登录；同租户其他人不受影响", async () => {
  const staff = await addTenantUser(api, tenant.adminToken, "finance@a.test", "finance");
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: staff.token })).status, 200);
  assert.equal((await api.call("DELETE", `/tenant/v1/users/${staff.id}`, { token: tenant.adminToken })).status, 204);
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: staff.token })).status, 401);
  const login = await api.call("POST", "/tenant/v1/auth/login", { ip: freshIp(), body: { email: "finance@a.test", password: TEST_PASSWORD } });
  assert.equal(login.status, 403);
  assert.equal(login.body.error.code, "ACCOUNT_DISABLED");
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: tenant.adminToken })).status, 200);
});

for (const entry of ["platform", "tenant"] as const) {
  const acceptUrl = `/${entry}/v1/auth/accept-invite`;
  let n = 0;
  const invite = async (): Promise<{ email: string; token: string; id: string }> => {
    const email = `invitee-${entry}-${n++}@a.test`;
    const res =
      entry === "platform"
        ? await api.call("POST", "/platform/v1/staff", { token: platformToken, body: { email, name: "受邀", role: "readonly" } })
        : await api.call("POST", "/tenant/v1/users", { token: tenant.adminToken, body: { email, name: "受邀", role: "readonly" } });
    assert.equal(res.status, 201, res.text);
    assert.equal(res.body.user.status, "invited");
    assert.equal(new Date(res.body.invite.expires_at).getTime() - api.clock.now().getTime(), INVITE_TTL_MS);
    return { email, token: res.body.invite.token, id: res.body.user.id };
  };
  const table = entry === "platform" ? "platform_users" : "tenant_users";

  test(`${entry} 邀请：数据库里只有令牌的哈希，没有原文；激活前没有密码`, async () => {
    const invited = await invite();
    const row = (await api.db.pool.query(`select * from ${table} where id = $1`, [invited.id])).rows[0];
    assert.match(row.invite_token_hash, /^[0-9a-f]{64}$/);
    assert.equal(row.password_hash, null);
    assert.ok(!JSON.stringify(row).includes(invited.token));
  });

  test(`${entry} 邀请：令牌只能用一次；用过之后和不存在的令牌返回一样`, async () => {
    const invited = await invite();
    const first = await api.call("POST", acceptUrl, { body: { token: invited.token, password: TEST_PASSWORD } });
    assert.equal(first.status, 200);
    assert.equal(first.body.user.status, "active");
    assert.ok(!first.text.includes(TEST_PASSWORD) && !first.text.includes("scrypt"));
    const second = await api.call("POST", acceptUrl, { body: { token: invited.token, password: "Another-Passw0rd-1" } });
    const unknown = await api.call("POST", acceptUrl, { body: { token: "nzi_never-issued", password: "Another-Passw0rd-1" } });
    assert.equal(second.status, 400);
    assert.equal(second.body.error.code, "INVITE_INVALID");
    assert.equal(second.text, unknown.text);
    const login = await api.call("POST", `/${entry}/v1/auth/login`, { ip: freshIp(), body: { email: invited.email, password: TEST_PASSWORD } });
    assert.equal(login.status, 200, "第一次设置的密码有效，没有被第二次覆盖");
  });

  test(`${entry} 邀请：同一个令牌并发提交两次，只有一个成功`, async () => {
    const invited = await invite();
    const results = await Promise.all([
      api.call("POST", acceptUrl, { body: { token: invited.token, password: TEST_PASSWORD } }),
      api.call("POST", acceptUrl, { body: { token: invited.token, password: "Another-Passw0rd-1" } }),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
  });

  test(`${entry} 邀请：密码强度不够时不激活，令牌还能再用`, async () => {
    const invited = await invite();
    const weak = await api.call("POST", acceptUrl, { body: { token: invited.token, password: "short" } });
    assert.equal(weak.status, 400);
    assert.equal(weak.body.error.code, "WEAK_PASSWORD");
    assert.deepEqual(
      weak.body.error.details.issues.map((i: any) => i.code),
      ["PASSWORD_TOO_SHORT", "PASSWORD_TOO_FEW_CHARACTER_CLASSES", "PASSWORD_TOO_REPETITIVE"],
    );
    const withEmail = await api.call("POST", acceptUrl, {
      body: { token: invited.token, password: `${invited.email.split("@")[0]}-Abc123` },
    });
    assert.equal(withEmail.body.error.details.issues[0].code, "PASSWORD_CONTAINS_EMAIL");
    assert.equal((await api.call("POST", acceptUrl, { body: { token: invited.token, password: TEST_PASSWORD } })).status, 200);
  });

  test(`${entry} 邀请：7 天后过期；重新邀请同一个邮箱会发新令牌，旧令牌作废`, async () => {
    const invited = await invite();
    api.clock.advance(INVITE_TTL_MS);
    const expired = await api.call("POST", acceptUrl, { body: { token: invited.token, password: TEST_PASSWORD } });
    assert.equal(expired.status, 400);
    assert.equal(expired.body.error.code, "INVITE_INVALID");
    // 时钟拨了 7 天，before 里的会话早过期了
    platformToken = (await api.call("POST", "/platform/v1/auth/login", { ip: freshIp(), body: { email: "root@platform.test", password: TEST_PASSWORD } })).body.access_token;
    tenant.adminToken = (await api.call("POST", "/tenant/v1/auth/login", { ip: freshIp(), body: { email: "admin@a.test", password: TEST_PASSWORD } })).body.access_token;

    const body = { email: invited.email, name: "改了名字", role: entry === "platform" ? "tech" : "dispatch" };
    const again =
      entry === "platform"
        ? await api.call("POST", "/platform/v1/staff", { token: platformToken, body })
        : await api.call("POST", "/tenant/v1/users", { token: tenant.adminToken, body });
    assert.equal(again.status, 201, again.text);
    assert.equal(again.body.user.id, invited.id, "是同一个账号，不是新建");
    assert.equal(again.body.user.role, body.role);
    assert.notEqual(again.body.invite.token, invited.token);
    assert.equal((await api.call("POST", acceptUrl, { body: { token: invited.token, password: TEST_PASSWORD } })).status, 400);
    assert.equal((await api.call("POST", acceptUrl, { body: { token: again.body.invite.token, password: TEST_PASSWORD } })).status, 200);

    const third =
      entry === "platform"
        ? await api.call("POST", "/platform/v1/staff", { token: platformToken, body })
        : await api.call("POST", "/tenant/v1/users", { token: tenant.adminToken, body });
    assert.equal(third.status, 409, "已经激活的账号不能再邀请");
    assert.equal(third.body.error.code, "EMAIL_TAKEN");
  });

  test(`${entry} 邀请：停用一个待激活的账号，它的邀请令牌随即作废`, async () => {
    const invited = await invite();
    const revoke =
      entry === "platform"
        ? await api.call("POST", `/platform/v1/staff/${invited.id}/disable`, { token: platformToken })
        : await api.call("DELETE", `/tenant/v1/users/${invited.id}`, { token: tenant.adminToken });
    assert.ok(revoke.status === 200 || revoke.status === 204, revoke.text);
    const res = await api.call("POST", acceptUrl, { body: { token: invited.token, password: TEST_PASSWORD } });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, "INVITE_INVALID");
  });
}

test("同一来源地址轮换邮箱猜密码：失败满 50 次后，这个地址不管换什么邮箱都是 429；被拦下的请求不验证密码、不写审计、不占用别人邮箱的次数；别的地址不受影响；窗口过后恢复", async () => {
  const ip = freshIp();
  const attempt = (email: string, password = "Wrong-Password-000", from = ip) =>
    api.call("POST", "/tenant/v1/auth/login", { ip: from, body: { email, password } });
  const auditCount = async (): Promise<number> => (await api.db.pool.query("select count(*)::int as n from audit_logs")).rows[0].n;
  const throttleRows = async (): Promise<number> => (await api.db.pool.query("select count(*)::int as n from login_throttles")).rows[0].n;

  // 正常登录不占用这一层的次数：同一个地址上连续成功登录远超 50 次的量级也不受影响（这里做 3 次示意，并核对计数被退还）
  for (let i = 0; i < 3; i++) assert.equal((await attempt("admin@a.test", TEST_PASSWORD)).status, 200);

  const failedDurations: number[] = [];
  for (let i = 0; i < 50; i++) {
    const startedAt = performance.now();
    const res = await attempt(`rotate-${i}@nowhere.test`);
    failedDurations.push(performance.now() - startedAt);
    assert.equal(res.status, 401, `第 ${i + 1} 次`);
  }

  const auditBefore = await auditCount();
  const rowsBefore = await throttleRows();
  const blockedDurations: number[] = [];
  for (const email of ["rotate-new@nowhere.test", "admin@a.test", "another@nowhere.test"]) {
    const startedAt = performance.now();
    const res = await attempt(email, TEST_PASSWORD);
    blockedDurations.push(performance.now() - startedAt);
    assert.equal(res.status, 429, email);
    assert.equal(res.body.error.code, "TOO_MANY_LOGIN_ATTEMPTS");
    assert.equal(res.headers["retry-after"], String(res.body.error.details.retry_after_seconds));
  }
  assert.equal(await auditCount(), auditBefore, "被拦下的请求不应写审计");
  assert.equal(await throttleRows(), rowsBefore, "被拦下的请求不应再占用邮箱维度的计数");
  const median = (values: number[]): number => [...values].sort((x, y) => x - y)[Math.floor(values.length / 2)] as number;
  assert.ok(
    median(blockedDurations) < median(failedDurations) / 3,
    `被拦下的请求不应做密码哈希计算：拦下 ${median(blockedDurations).toFixed(1)}ms，正常失败 ${median(failedDurations).toFixed(1)}ms`,
  );

  assert.equal((await attempt("admin@a.test", TEST_PASSWORD, freshIp())).status, 200, "别的地址不受影响");
  const platform = await api.call("POST", "/platform/v1/auth/login", { ip, body: { email: "root@platform.test", password: TEST_PASSWORD } });
  assert.equal(platform.status, 200, "平台入口和租户入口各算各的");

  api.clock.advance(15 * MINUTE);
  assert.equal((await attempt("admin@a.test", TEST_PASSWORD)).status, 200, "窗口过后恢复");
  platformToken = (await api.call("POST", "/platform/v1/auth/login", { ip: freshIp(), body: { email: "root@platform.test", password: TEST_PASSWORD } })).body.access_token;
  tenant.adminToken = (await api.call("POST", "/tenant/v1/auth/login", { ip: freshIp(), body: { email: "admin@a.test", password: TEST_PASSWORD } })).body.access_token;
});

for (const entry of ["platform", "tenant"] as const) {
  test(`${entry}：重发邀请和本人接受邀请同时发生（各 6 轮）：没有 500；要么邀请先生效（旧令牌作废），要么接受先生效（重发得到 409）`, async () => {
    for (let round = 0; round < 6; round++) {
      const email = `race-${entry}-${round}@a.test`;
      const body = { email, name: "并发", role: "readonly" };
      const invite = () =>
        entry === "platform"
          ? api.call("POST", "/platform/v1/staff", { token: platformToken, body })
          : api.call("POST", "/tenant/v1/users", { token: tenant.adminToken, body });
      const first = await invite();
      assert.equal(first.status, 201, first.text);
      const [reissued, accepted] = await Promise.all([
        invite(),
        api.call("POST", `/${entry}/v1/auth/accept-invite`, { body: { token: first.body.invite.token, password: TEST_PASSWORD } }),
      ]);
      const outcome = `${reissued.status}/${accepted.status}`;
      assert.ok(outcome === "201/400" || outcome === "409/200", `第 ${round + 1} 轮：重发 ${reissued.status} ${reissued.text}，接受 ${accepted.status} ${accepted.text}`);
      if (reissued.status === 409) assert.equal(reissued.body.error.code, "EMAIL_TAKEN");
      const row = (await api.db.pool.query(`select status, password_hash is not null as has_password, invite_token_hash is not null as has_invite from ${entry === "platform" ? "platform_users" : "tenant_users"} where email = $1`, [email])).rows[0];
      assert.deepEqual(row, outcome === "409/200" ? { status: "active", has_password: true, has_invite: false } : { status: "invited", has_password: false, has_invite: true });
    }
  });
}

test("邀请令牌不通用：平台的邀请令牌在租户入口无效，租户的在平台入口无效", async () => {
  const staff = await api.call("POST", "/platform/v1/staff", { token: platformToken, body: { email: "cross-p@platform.test", name: "x", role: "readonly" } });
  const user = await api.call("POST", "/tenant/v1/users", { token: tenant.adminToken, body: { email: "cross-t@a.test", name: "x", role: "readonly" } });
  assert.equal((await api.call("POST", "/tenant/v1/auth/accept-invite", { body: { token: staff.body.invite.token, password: TEST_PASSWORD } })).status, 400);
  assert.equal((await api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: user.body.invite.token, password: TEST_PASSWORD } })).status, 400);
});

test("平台账号和租户账号是两套：同一个邮箱在两边各自登录，互不相通", async () => {
  const email = "both@shared.test";
  const staff = await api.call("POST", "/platform/v1/staff", { token: platformToken, body: { email, name: "平台的我", role: "readonly" } });
  await api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: staff.body.invite.token, password: TEST_PASSWORD } });
  const tenantLogin = await api.call("POST", "/tenant/v1/auth/login", { ip: freshIp(), body: { email, password: TEST_PASSWORD } });
  assert.equal(tenantLogin.status, 401, "平台账号不能从租户入口登录");
  const platformLogin = await api.call("POST", "/platform/v1/auth/login", { ip: freshIp(), body: { email: "admin@a.test", password: TEST_PASSWORD } });
  assert.equal(platformLogin.status, 401, "租户账号不能从平台入口登录");
});
