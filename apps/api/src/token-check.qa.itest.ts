/**
 * 测试角色补充（M1-13）：只核对、不消费令牌的四个公开接口
 * （平台、租户各一对 `auth/check-invite`、`auth/check-reset-token`）的边界情况。
 * `token-check.itest.ts` 已有的基本行为不再重复；这里补：畸形入参、各种失效原因不可区分、
 * 核对前后数据库一行不变、日志和错误响应里没有令牌原文、请求带着各种登录令牌也照常是公开接口、
 * 与设密码并发、暂停租户 / 删除待激活账号时核对与真正设密码的结论一致、粗测响应时间。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { INVITE_TTL_MS } from "./auth/invite-token.ts";
import { type ApiResponse, TEST_PASSWORD, type TenantFixture, type TestApi, addTenantUser, createTestApi } from "./testing/api.ts";

let api: TestApi;
let rootToken: string;
let tenantA: TenantFixture;

before(async () => {
  api = await createTestApi();
  rootToken = await api.superAdminToken("root@qa-check.test");
  tenantA = await api.tenantWithAdmin(rootToken, "核对车队", "admin@qa-check-a.test");
});
after(() => api.close());

type Portal = "platform" | "tenant";
const PORTALS: readonly Portal[] = ["platform", "tenant"];
const ENDPOINTS = ["check-invite", "check-reset-token"] as const;
type Endpoint = (typeof ENDPOINTS)[number];
const CODE: Record<Endpoint, string> = { "check-invite": "INVITE_INVALID", "check-reset-token": "RESET_TOKEN_INVALID" };

const check = (target: TestApi, portal: Portal, endpoint: Endpoint, token: unknown, bearer?: string): Promise<ApiResponse> =>
  target.call("POST", `/${portal}/v1/auth/${endpoint}`, { body: { token }, ...(bearer === undefined ? {} : { token: bearer }) });

let seq = 0;
const nextEmail = (portal: Portal): string => `qa-check-${seq++}@${portal}.test`;

async function invite(target: TestApi, root: string, adminToken: string, portal: Portal, email = nextEmail(portal)): Promise<{ token: string; id: string }> {
  const res =
    portal === "platform"
      ? await target.call("POST", "/platform/v1/staff", { token: root, body: { email, name: email, role: "operations" } })
      : await target.call("POST", "/tenant/v1/users", { token: adminToken, body: { email, name: email, role: "dispatch" } });
  assert.equal(res.status, 201, res.text);
  return { token: res.body.invite.token as string, id: res.body.user.id as string };
}

async function issueReset(target: TestApi, root: string, adminToken: string, portal: Portal): Promise<{ token: string; id: string }> {
  let id: string;
  if (portal === "platform") {
    const invited = await invite(target, root, adminToken, "platform");
    const accepted = await target.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.token, password: TEST_PASSWORD } });
    assert.equal(accepted.status, 200, accepted.text);
    id = invited.id;
  } else {
    id = (await addTenantUser(target, adminToken, nextEmail("tenant"), "dispatch")).id;
  }
  const res =
    portal === "platform"
      ? await target.call("POST", `/platform/v1/staff/${id}/password-reset`, { token: root })
      : await target.call("POST", `/tenant/v1/users/${id}/password-reset`, { token: adminToken });
  assert.ok(res.status === 200 || res.status === 201, res.text);
  return { token: res.body.reset.token as string, id };
}

const tokenFor = (portal: Portal, endpoint: Endpoint) =>
  endpoint === "check-invite" ? invite(api, rootToken, tenantA.adminToken, portal) : issueReset(api, rootToken, tenantA.adminToken, portal);

/** 失败响应里和「为什么失效」可能有关的部分：状态码、正文、内容类型和长度。 */
function shape(res: ApiResponse): unknown {
  return { status: res.status, body: res.body, type: res.headers["content-type"], length: res.headers["content-length"] };
}

/** 账号这一行（含令牌哈希、有效期、状态、修改时间）的完整快照。 */
async function userRow(target: TestApi, portal: Portal, id: string): Promise<unknown> {
  const table = portal === "platform" ? "platform_users" : "tenant_users";
  return (await target.db.owner.query(`select * from ${table} where id = $1`, [id])).rows[0];
}

async function counts(target: TestApi): Promise<unknown> {
  const q = async (sql: string): Promise<number> => Number((await target.db.owner.query(sql)).rows[0].n);
  return {
    audit: await q("select count(*) as n from audit_logs"),
    platformSessions: await q("select count(*) as n from platform_sessions"),
    tenantSessions: await q("select count(*) as n from tenant_sessions"),
    throttles: await q("select count(*) as n from login_throttles"),
  };
}

for (const portal of PORTALS) {
  for (const endpoint of ENDPOINTS) {
    const url = `/${portal}/v1/auth/${endpoint}`;

    test(`${url}：畸形入参一律 400 VALIDATION_FAILED，不是 500`, async () => {
      const bodies: unknown[] = [
        { token: 12345 },
        { token: null },
        { token: true },
        { token: ["nzi_abc"] },
        { token: { $ne: "" } },
        [],
        {},
      ];
      for (const body of bodies) {
        const res = await api.call("POST", url, { body });
        assert.equal(res.status, 400, `${JSON.stringify(body)} → ${res.text}`);
        assert.equal(res.body.error.code, "VALIDATION_FAILED", JSON.stringify(body));
      }
      const noBody = await api.app.inject({ method: "POST", url });
      assert.ok(noBody.statusCode >= 400 && noBody.statusCode < 500, `没有请求体 → ${noBody.statusCode} ${noBody.body}`);
      const notJson = await api.app.inject({ method: "POST", url, headers: { "content-type": "application/json" }, payload: "{token:" });
      assert.ok(notJson.statusCode >= 400 && notJson.statusCode < 500, `坏 JSON → ${notJson.statusCode} ${notJson.body}`);
      const plain = await api.app.inject({ method: "POST", url, headers: { "content-type": "text/plain" }, payload: "token=abc" });
      assert.ok(plain.statusCode >= 400 && plain.statusCode < 500, `text/plain → ${plain.statusCode} ${plain.body}`);
      const rawString = await api.call("POST", url, { body: "nzi_abc" });
      assert.ok(rawString.status >= 400 && rawString.status < 500, `请求体是字符串 → ${rawString.status} ${rawString.text}`);
      const get = await api.app.inject({ method: "GET", url });
      assert.ok(get.statusCode >= 400 && get.statusCode < 500, `GET → ${get.statusCode}`);
    });

    test(`${url}：控制字符（NUL、换行）、孤立代理项被入参校验拒绝；表情、恰好 200 个字符、形似租户重置令牌但租户不存在，都按「失效」处理；都不是 500`, async () => {
      for (const token of ["nzi_\u0000abc", "nzi_abc\r\nX-Injected: 1", "nzr_\ud800"]) {
        const res = await check(api, portal, endpoint, token);
        assert.equal(res.status, 400, `${JSON.stringify(token)} → ${res.text}`);
        assert.ok([CODE[endpoint], "VALIDATION_FAILED"].includes(res.body.error.code), res.text);
      }
      const weird = [
        "🚗".repeat(50),
        "x".repeat(200),
        `nzr_${"0".repeat(32)}.${"A".repeat(43)}`,
        `nzr_${"f".repeat(32)}.${"_".repeat(43)}`,
        "' or 1=1 --",
      ];
      for (const token of weird) {
        const res = await check(api, portal, endpoint, token);
        assert.equal(res.status, 400, `${JSON.stringify(token)} → ${res.text}`);
        assert.equal(res.body.error.code, CODE[endpoint], JSON.stringify(token));
      }
    });

    test(`${url}：有效令牌前后加空白或改大小写不会被放行（不做归一化），原样的仍然有效`, async () => {
      const { token } = await tokenFor(portal, endpoint);
      for (const variant of [` ${token}`, `${token} `, `${token}\n`, token.toUpperCase(), token.slice(0, -1)]) {
        const res = await check(api, portal, endpoint, variant);
        assert.equal(res.status, 400, `${JSON.stringify(variant)} → ${res.text}`);
        assert.equal(res.body.error.code, CODE[endpoint]);
      }
      assert.equal((await check(api, portal, endpoint, token)).status, 204);
    });

    test(`${url}：核对多次前后，账号这一行一个字段都不变，不建会话、不占登录限速计数、不写审计`, async () => {
      const { token, id } = await tokenFor(portal, endpoint);
      const rowBefore = await userRow(api, portal, id);
      const countsBefore = await counts(api);
      for (let i = 0; i < 5; i++) assert.equal((await check(api, portal, endpoint, token)).status, 204);
      for (let i = 0; i < 5; i++) await check(api, portal, endpoint, `${token}x`);
      assert.deepEqual(await userRow(api, portal, id), rowBefore);
      assert.deepEqual(await counts(api), countsBefore);
    });

    test(`${url}：令牌原文不出现在日志、校验失败的响应里`, async () => {
      const { token } = await tokenFor(portal, endpoint);
      await check(api, portal, endpoint, token);
      await check(api, portal, endpoint, `${token}tail`);
      const tooLong = `${token}${"y".repeat(201)}`;
      const rejected = await check(api, portal, endpoint, tooLong);
      assert.equal(rejected.status, 400);
      assert.ok(!rejected.text.includes(token), "超长被拒时不回显令牌");
      assert.ok(!api.logs().includes(token), "日志里没有令牌原文");
      // 随机部分 = 去掉固定前缀后的 base64url（它自己也可能含「_」，不能按「_」切，否则会切出两三个字符、碰巧出现在日志里）
      const secret = token.slice(token.lastIndexOf(".") + 1).replace(/^[a-z]+_/, "");
      assert.ok(secret.length >= 40, `随机部分应有 43 个字符：${secret.length}`);
      assert.ok(!api.logs().includes(secret), "日志里也没有令牌的随机部分");
    });

    test(`${url}：公开接口不看 Authorization——带乱写的、别的门户的、已退出的、必须先改密码的登录令牌都照常核对`, async () => {
      const { token } = await tokenFor(portal, endpoint);
      const email = nextEmail(portal);
      if (portal === "platform") {
        const staff = await invite(api, rootToken, tenantA.adminToken, "platform", email);
        await api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: staff.token, password: TEST_PASSWORD } });
        await api.db.owner.query("update platform_users set must_change_password = true where id = $1", [staff.id]);
      } else {
        const user = await addTenantUser(api, tenantA.adminToken, email, "dispatch");
        await api.db.owner.query("update tenant_users set must_change_password = true where id = $1", [user.id]);
      }
      const login = await api.call("POST", `/${portal}/v1/auth/login`, { body: { email, password: TEST_PASSWORD } });
      assert.equal(login.status, 200, login.text);
      assert.equal(login.body.must_change_password, true);
      const forced = login.body.access_token as string;
      const loggedOut = (await api.call("POST", `/${portal}/v1/auth/login`, { body: { email, password: TEST_PASSWORD } })).body.access_token as string;
      await api.call("POST", `/${portal}/v1/auth/logout`, { token: loggedOut });
      const otherPortal = portal === "platform" ? tenantA.adminToken : rootToken;
      for (const bearer of ["garbage", forced, loggedOut, otherPortal]) {
        const ok = await check(api, portal, endpoint, token, bearer);
        assert.equal(ok.status, 204, `${bearer.slice(0, 12)} → ${ok.text}`);
        const bad = await check(api, portal, endpoint, `${token}x`, bearer);
        assert.equal(bad.status, 400, bad.text);
        assert.equal(bad.body.error.code, CODE[endpoint]);
      }
    });
  }

  test(`${portal}：核对和接受邀请同时发生——接受恰好成功一次，核对只回 204 或「失效」，之后一律失效`, async () => {
    const { token } = await invite(api, rootToken, tenantA.adminToken, portal);
    const accept = () => api.call("POST", `/${portal}/v1/auth/accept-invite`, { body: { token, password: TEST_PASSWORD } });
    const results = await Promise.all([
      ...Array.from({ length: 6 }, () => check(api, portal, "check-invite", token)),
      accept(),
      accept(),
      ...Array.from({ length: 6 }, () => check(api, portal, "check-invite", token)),
    ]);
    const accepts = results.slice(6, 8);
    assert.deepEqual(accepts.map((r) => r.status).sort(), [200, 400], accepts.map((r) => r.text).join(" | "));
    for (const r of [...results.slice(0, 6), ...results.slice(8)]) {
      assert.ok(r.status === 204 || (r.status === 400 && r.body.error.code === "INVITE_INVALID"), r.text);
    }
    assert.equal((await check(api, portal, "check-invite", token)).status, 400);
  });

  test(`${portal}：核对和凭重置令牌改密码同时发生——改密恰好成功一次，之后一律失效`, async () => {
    const { token } = await issueReset(api, rootToken, tenantA.adminToken, portal);
    const reset = () => api.call("POST", `/${portal}/v1/auth/reset-password`, { body: { token, password: "Amber-Ferry-Route-88" } });
    const results = await Promise.all([check(api, portal, "check-reset-token", token), reset(), check(api, portal, "check-reset-token", token), reset()]);
    assert.deepEqual([results[1]!.status, results[3]!.status].sort(), [200, 400]);
    for (const r of [results[0]!, results[2]!]) assert.ok(r.status === 204 || r.status === 400, r.text);
    assert.equal((await check(api, portal, "check-reset-token", token)).status, 400);
  });
}

test("平台：对同一个未激活邮箱再邀请一次，旧邀请令牌核对不过、新的能过", async () => {
  const email = nextEmail("platform");
  const first = await invite(api, rootToken, tenantA.adminToken, "platform", email);
  const again = await invite(api, rootToken, tenantA.adminToken, "platform", email);
  assert.notEqual(first.token, again.token);
  assert.equal((await check(api, "platform", "check-invite", first.token)).body?.error?.code, "INVITE_INVALID");
  assert.equal((await check(api, "platform", "check-invite", again.token)).status, 204);
});

test("租户：管理员删掉一个还没激活的账号后，它的邀请核对不过，和真正接受时的结论一致", async () => {
  const { token, id } = await invite(api, rootToken, tenantA.adminToken, "tenant");
  const removed = await api.call("DELETE", `/tenant/v1/users/${id}`, { token: tenantA.adminToken });
  assert.ok(removed.status === 200 || removed.status === 204, removed.text);
  const checked = await check(api, "tenant", "check-invite", token);
  const accepted = await api.call("POST", "/tenant/v1/auth/accept-invite", { body: { token, password: TEST_PASSWORD } });
  assert.equal(accepted.status, 400, accepted.text);
  assert.equal(checked.status, 400, checked.text);
  assert.deepEqual(checked.body, accepted.body);
});

test("租户被暂停：核对的结论和真正接受邀请 / 重设密码的结论一致（暂停不影响登录，ADR 0008）", async () => {
  const fleet = await api.tenantWithAdmin(rootToken, "暂停车队", "admin@qa-check-paused.test");
  const invited = await invite(api, rootToken, fleet.adminToken, "tenant");
  const reset = await issueReset(api, rootToken, fleet.adminToken, "tenant");
  const suspended = await api.call("POST", `/platform/v1/tenants/${fleet.tenantId}/suspend`, { token: rootToken, body: { reason: "测试" } });
  assert.equal(suspended.status, 200, suspended.text);
  const inviteCheck = await check(api, "tenant", "check-invite", invited.token);
  const resetCheck = await check(api, "tenant", "check-reset-token", reset.token);
  const accepted = await api.call("POST", "/tenant/v1/auth/accept-invite", { body: { token: invited.token, password: TEST_PASSWORD } });
  const resetDone = await api.call("POST", "/tenant/v1/auth/reset-password", { body: { token: reset.token, password: "Amber-Ferry-Route-88" } });
  assert.equal(inviteCheck.status === 204, accepted.status === 200, `核对 ${inviteCheck.status}，接受 ${accepted.status}`);
  assert.equal(resetCheck.status === 204, resetDone.status === 200, `核对 ${resetCheck.status}，重设 ${resetDone.status}`);
});

test("不存在、用过、作废（再发 / 再邀请）、账号停用、过期：两侧四个接口的失败响应完全相同（状态码、正文、类型、长度）", async () => {
  const own = await createTestApi();
  try {
    const root = await own.superAdminToken("root@qa-check-expiry.test");
    const fleet = await own.tenantWithAdmin(root, "过期车队", "admin@qa-check-expiry.test");
    const prepared = [];
    for (const portal of PORTALS) {
      const used = await invite(own, root, fleet.adminToken, portal);
      await own.call("POST", `/${portal}/v1/auth/accept-invite`, { body: { token: used.token, password: TEST_PASSWORD } });
      const sameEmail = nextEmail(portal);
      const voided = await invite(own, root, fleet.adminToken, portal, sameEmail);
      await invite(own, root, fleet.adminToken, portal, sameEmail);
      const expiring = await invite(own, root, fleet.adminToken, portal);

      const resetUsed = await issueReset(own, root, fleet.adminToken, portal);
      await own.call("POST", `/${portal}/v1/auth/reset-password`, { body: { token: resetUsed.token, password: "Amber-Ferry-Route-88" } });
      const resetVoided = await issueReset(own, root, fleet.adminToken, portal);
      const reissued = await own.call("POST", portal === "platform" ? `/platform/v1/staff/${resetVoided.id}/password-reset` : `/tenant/v1/users/${resetVoided.id}/password-reset`, {
        token: portal === "platform" ? root : fleet.adminToken,
      });
      assert.ok(reissued.status === 200 || reissued.status === 201, reissued.text);
      const resetDisabled = await issueReset(own, root, fleet.adminToken, portal);
      const disabled =
        portal === "platform"
          ? await own.call("POST", `/platform/v1/staff/${resetDisabled.id}/disable`, { token: root })
          : await own.call("DELETE", `/tenant/v1/users/${resetDisabled.id}`, { token: fleet.adminToken });
      assert.ok(disabled.status === 200 || disabled.status === 204, disabled.text);
      const resetExpiring = await issueReset(own, root, fleet.adminToken, portal);

      const missingInvite = await check(own, portal, "check-invite", `nzi_${"Q".repeat(43)}`);
      const missingReset = await check(
        own,
        portal,
        "check-reset-token",
        portal === "tenant" ? `nzr_${fleet.tenantId.replaceAll("-", "")}.${"Q".repeat(43)}` : `nzr_${"Q".repeat(43)}`,
      );
      assert.equal(missingInvite.body.error.code, "INVITE_INVALID");
      assert.equal(missingReset.body.error.code, "RESET_TOKEN_INVALID");
      assert.equal((await check(own, portal, "check-invite", expiring.token)).status, 204, "过期前还能用");
      assert.equal((await check(own, portal, "check-reset-token", resetExpiring.token)).status, 204, "过期前还能用");
      prepared.push({
        portal,
        missingInvite,
        missingReset,
        expiring: expiring.token,
        resetExpiring: resetExpiring.token,
        inviteFailures: { used: await check(own, portal, "check-invite", used.token), voided: await check(own, portal, "check-invite", voided.token) },
        resetFailures: {
          used: await check(own, portal, "check-reset-token", resetUsed.token),
          voided: await check(own, portal, "check-reset-token", resetVoided.token),
          disabled: await check(own, portal, "check-reset-token", resetDisabled.token),
        },
      });
    }
    own.clock.advance(INVITE_TTL_MS + 1_000);
    for (const p of prepared) {
      const inviteFailures = { ...p.inviteFailures, expired: await check(own, p.portal, "check-invite", p.expiring) };
      const resetFailures = { ...p.resetFailures, expired: await check(own, p.portal, "check-reset-token", p.resetExpiring) };
      for (const [why, r] of Object.entries(inviteFailures)) assert.deepEqual(shape(r), shape(p.missingInvite), `${p.portal} 邀请（${why}）：${r.text}`);
      for (const [why, r] of Object.entries(resetFailures)) assert.deepEqual(shape(r), shape(p.missingReset), `${p.portal} 重置（${why}）：${r.text}`);
    }
  } finally {
    await own.close();
  }
});

test("粗测响应时间：有效、不存在、用过的令牌，核对耗时的中位数相差不超过 25 毫秒（不需要恒定时间，但不应有明显差异）", async () => {
  const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]!;
  for (const portal of PORTALS) {
    const valid = (await invite(api, rootToken, tenantA.adminToken, portal)).token;
    const used = (await invite(api, rootToken, tenantA.adminToken, portal)).token;
    await api.call("POST", `/${portal}/v1/auth/accept-invite`, { body: { token: used, password: TEST_PASSWORD } });
    const missing = `nzi_${"Z".repeat(43)}`;
    const samples: Record<string, number[]> = { valid: [], used: [], missing: [] };
    for (let round = 0; round < 15; round++) {
      for (const [name, token] of [["valid", valid], ["used", used], ["missing", missing]] as const) {
        const start = performance.now();
        await check(api, portal, "check-invite", token);
        samples[name]!.push(performance.now() - start);
      }
    }
    const medians = Object.values(samples).map(median);
    assert.ok(Math.max(...medians) - Math.min(...medians) < 25, `${portal}：${JSON.stringify(Object.fromEntries(Object.entries(samples).map(([k, v]) => [k, median(v).toFixed(2)])))}`);
  }
});
