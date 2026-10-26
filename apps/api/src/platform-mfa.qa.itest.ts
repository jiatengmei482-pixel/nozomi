/**
 * 测试角色补充（M4-05，ADR 0030）：两步验证的边界情况，真实 PostgreSQL。
 * 时间窗恰好切换的那一刻、绑定时用掉的时间窗、换手机期间的新密钥、确认接口不能被跳过 / 借用、
 * 恢复码的并发和用完、重新生成的并发、跨地址的限速、日志里没有密钥 / 动态码 / 恢复码、重置复核只读的人批不了。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createSuperAdmin } from "./services/platform-staff.ts";
import { type ApiResponse, TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";
import { totpAt } from "./testing/totp.ts";

const STEP = 30_000;

let api: TestApi;
let rootToken: string;
let ipCounter = 0;
const freshIp = (): string => `10.77.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

before(async () => {
  api = await createTestApi();
  rootToken = await api.superAdminToken("root@platform.test");
});
after(() => api.close());

const passwordLogin = async (email: string, ip = freshIp()): Promise<{ token: string; ip: string; res: ApiResponse }> => {
  const res = await api.call("POST", "/platform/v1/auth/login", { ip, body: { email, password: TEST_PASSWORD } });
  assert.equal(res.status, 200, res.text);
  return { token: res.body.access_token as string, ip, res };
};

async function newAdmin(email: string): Promise<void> {
  await createSuperAdmin(api.db.pool, { email, name: email, password: TEST_PASSWORD }, api.clock.now());
}

async function enrolled(email: string): Promise<{ token: string; ip: string; secret: string; recoveryCodes: string[]; confirmCode: string }> {
  const { token, ip } = await passwordLogin(email);
  const started = await api.call("POST", "/platform/v1/auth/mfa/enrollment", { token, ip, body: {} });
  assert.equal(started.status, 200, started.text);
  const confirmCode = totpAt(started.body.secret, api.clock.now());
  const confirmed = await api.call("POST", "/platform/v1/auth/mfa/enrollment/confirm", { token, ip, body: { code: confirmCode } });
  assert.equal(confirmed.status, 200, confirmed.text);
  return { token, ip, secret: started.body.secret as string, recoveryCodes: confirmed.body.recovery_codes as string[], confirmCode };
}

const verifyWith = async (email: string, body: Record<string, string>): Promise<ApiResponse> => {
  const { token, ip } = await passwordLogin(email);
  return api.call("POST", "/platform/v1/auth/mfa/verify", { token, ip, body });
};

/** 把时钟拨到下一个时间窗的起点（恰好是 30 秒的整数倍）。 */
const toNextBoundary = (): void => api.clock.advance(STEP - (api.clock.now().getTime() % STEP));

test("时间窗恰好切换的那一刻：上一窗、本窗、下一窗都收；差两窗的不收", async () => {
  await newAdmin("edge@platform.test");
  const { secret } = await enrolled("edge@platform.test");
  toNextBoundary();
  toNextBoundary();
  assert.equal(api.clock.now().getTime() % STEP, 0, "恰好在切换的那一毫秒");
  const at = (offset: number): string => totpAt(secret, api.clock.now(), offset);
  assert.equal((await verifyWith("edge@platform.test", { code: at(-2) })).body.error.code, "MFA_CODE_INVALID");
  assert.equal((await verifyWith("edge@platform.test", { code: at(2) })).body.error.code, "MFA_CODE_INVALID");
  assert.equal((await verifyWith("edge@platform.test", { code: at(-1) })).status, 200, "刚刚过去的那一窗");
  assert.equal((await verifyWith("edge@platform.test", { code: at(0) })).status, 200, "刚开始的这一窗");
  assert.equal((await verifyWith("edge@platform.test", { code: at(1) })).status, 200, "下一窗");
  assert.equal((await verifyWith("edge@platform.test", { code: at(1) })).body.error.code, "MFA_CODE_REUSED");
});

test("时间窗切换前 1 毫秒：仍算上一窗，所以「切换后的下一窗」差两窗、不收；「切换后的这一窗」收", async () => {
  await newAdmin("edge-before@platform.test");
  const { secret } = await enrolled("edge-before@platform.test");
  toNextBoundary();
  toNextBoundary();
  const boundary = api.clock.now();
  api.clock.advance(-1);
  try {
    assert.equal((await verifyWith("edge-before@platform.test", { code: totpAt(secret, boundary, 1) })).body.error.code, "MFA_CODE_INVALID");
    assert.equal((await verifyWith("edge-before@platform.test", { code: totpAt(secret, boundary, 0) })).status, 200);
  } finally {
    api.clock.advance(1);
  }
});

test("确认绑定时输入的那个码算用掉了：随即用它登录是重放", async () => {
  await newAdmin("confirm-replay@platform.test");
  const { confirmCode } = await enrolled("confirm-replay@platform.test");
  const res = await verifyWith("confirm-replay@platform.test", { code: confirmCode });
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, "MFA_CODE_REUSED");
});

test("换手机还没确认：新密钥算出的码不能用来登录；再次开始绑定后，前一次的新密钥确认不了", async () => {
  await newAdmin("half-rebind@platform.test");
  const { token, ip, secret } = await enrolled("half-rebind@platform.test");
  toNextBoundary();
  const first = await api.call("POST", "/platform/v1/auth/mfa/enrollment", { token, ip, body: { code: totpAt(secret, api.clock.now()) } });
  assert.equal(first.status, 200, first.text);
  toNextBoundary();
  const pendingLogin = await verifyWith("half-rebind@platform.test", { code: totpAt(first.body.secret, api.clock.now()) });
  assert.equal(pendingLogin.body.error.code, "MFA_CODE_INVALID", "没确认的新密钥不能登录");
  // 上一步失败的登录没有用掉旧密钥的这一窗：旧的仍可开始第二次
  const second = await api.call("POST", "/platform/v1/auth/mfa/enrollment", { token, ip, body: { code: totpAt(secret, api.clock.now()) } });
  assert.equal(second.status, 200, second.text);
  const stale = await api.call("POST", "/platform/v1/auth/mfa/enrollment/confirm", { token, ip, body: { code: totpAt(first.body.secret, api.clock.now()) } });
  assert.equal(stale.status, 400);
  assert.equal(stale.body.error.code, "MFA_CODE_INVALID", "被覆盖的那一次确认不了");
  const ok = await api.call("POST", "/platform/v1/auth/mfa/enrollment/confirm", { token, ip, body: { code: totpAt(second.body.secret, api.clock.now()) } });
  assert.equal(ok.status, 200, ok.text);
});

test("确认接口不能被跳过或借用：没开始就确认 409；拿别人开始绑定的密钥在自己的会话里确认也不行，对方仍没绑定", async () => {
  await newAdmin("skip@platform.test");
  await newAdmin("victim-bind@platform.test");
  const skipper = await passwordLogin("skip@platform.test");
  const direct = await api.call("POST", "/platform/v1/auth/mfa/enrollment/confirm", { token: skipper.token, ip: skipper.ip, body: { code: "123456" } });
  assert.equal(direct.status, 409);
  assert.equal(direct.body.error.code, "MFA_ENROLLMENT_NOT_STARTED");

  const victim = await passwordLogin("victim-bind@platform.test");
  const started = await api.call("POST", "/platform/v1/auth/mfa/enrollment", { token: victim.token, ip: victim.ip, body: {} });
  assert.equal(started.status, 200);
  const borrowed = await api.call("POST", "/platform/v1/auth/mfa/enrollment/confirm", { token: skipper.token, ip: skipper.ip, body: { code: totpAt(started.body.secret, api.clock.now()) } });
  assert.equal(borrowed.status, 409);
  assert.equal(borrowed.body.error.code, "MFA_ENROLLMENT_NOT_STARTED");
  assert.equal((await api.call("GET", "/platform/v1/tenants", { token: skipper.token })).body.error.code, "MFA_REQUIRED");
  const row = (await api.db.owner.query("select totp_secret from platform_users where email = 'victim-bind@platform.test'")).rows[0];
  assert.equal(row.totp_secret, null);
});

test("并发：两个会话同时用同一个恢复码，只有一个成功，剩下 9 个", async () => {
  await newAdmin("rc-race@platform.test");
  const { recoveryCodes } = await enrolled("rc-race@platform.test");
  const sessions = await Promise.all([1, 2, 3].map(() => passwordLogin("rc-race@platform.test")));
  const code = recoveryCodes[0] as string;
  const results = await Promise.all(sessions.map((s) => api.call("POST", "/platform/v1/auth/mfa/verify", { token: s.token, ip: s.ip, body: { recovery_code: code } })));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400, 400], results.map((r) => r.text).join("\n"));
  const n = (await api.db.owner.query("select count(*)::int as n from platform_recovery_codes r join platform_users u on u.id = r.user_id where u.email = 'rc-race@platform.test' and r.used_at is null")).rows[0].n;
  assert.equal(n, 9);
  const winner = sessions[results.findIndex((r) => r.status === 200)]!;
  assert.equal((await api.call("GET", "/platform/v1/auth/me", { token: winner.token })).body.second_factor.recovery_codes_remaining, 9);
  for (const [i, s] of sessions.entries()) {
    if (results[i]!.status === 200) continue;
    assert.equal((await api.call("GET", "/platform/v1/tenants", { token: s.token })).body.error.code, "MFA_REQUIRED", "输错的会话仍是待验证");
  }
});

test("恢复码用完：10 个都用掉后任何一个都不行，剩余 0；动态码照常可用", async () => {
  await newAdmin("rc-all@platform.test");
  const { secret, recoveryCodes } = await enrolled("rc-all@platform.test");
  let last: ApiResponse | null = null;
  for (const code of recoveryCodes) {
    last = await verifyWith("rc-all@platform.test", { recovery_code: code });
    assert.equal(last.status, 200, last.text);
  }
  assert.equal(last?.body.second_factor.recovery_codes_remaining, 0);
  for (const code of recoveryCodes.slice(0, 3)) assert.equal((await verifyWith("rc-all@platform.test", { recovery_code: code })).body.error.code, "MFA_CODE_INVALID");
  toNextBoundary();
  assert.equal((await verifyWith("rc-all@platform.test", { code: totpAt(secret, api.clock.now()) })).status, 200);
});

test("并发：同一个动态码同时提交两次「重新生成恢复码」，只有一次生效；库里只剩生效的那一组", async () => {
  await newAdmin("regen-race@platform.test");
  const { token, ip, secret } = await enrolled("regen-race@platform.test");
  toNextBoundary();
  const code = totpAt(secret, api.clock.now());
  const results = await Promise.all([1, 2].map(() => api.call("POST", "/platform/v1/auth/mfa/recovery-codes", { token, ip, body: { code } })));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400], results.map((r) => r.text).join("\n"));
  const loser = results.find((r) => r.status === 400)!;
  assert.equal(loser.body.error.code, "MFA_CODE_REUSED");
  const fresh = results.find((r) => r.status === 200)!.body.recovery_codes as string[];
  const n = (await api.db.owner.query("select count(*)::int as n from platform_recovery_codes r join platform_users u on u.id = r.user_id where u.email = 'regen-race@platform.test'")).rows[0].n;
  assert.equal(n, 10);
  assert.equal((await verifyWith("regen-race@platform.test", { recovery_code: fresh[0] as string })).status, 200);
});

test("并发：同一个恢复码同时用来「重新生成」两次，只有一次生效", async () => {
  await newAdmin("regen-rc-race@platform.test");
  const { token, ip, recoveryCodes } = await enrolled("regen-rc-race@platform.test");
  const code = recoveryCodes[0] as string;
  const results = await Promise.all([1, 2].map(() => api.call("POST", "/platform/v1/auth/mfa/recovery-codes", { token, ip, body: { recovery_code: code } })));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400], results.map((r) => r.text).join("\n"));
  const fresh = results.find((r) => r.status === 200)!.body.recovery_codes as string[];
  const stored = (await api.db.owner.query("select count(*)::int as n from platform_recovery_codes r join platform_users u on u.id = r.user_id where u.email = 'regen-rc-race@platform.test' and r.used_at is null")).rows[0].n;
  assert.equal(stored, 10);
  assert.equal((await verifyWith("regen-rc-race@platform.test", { recovery_code: fresh[1] as string })).status, 200);
});

test("限速（同一邮箱）：换着地址错 20 次后，第 21 次从新地址输入正确的码也 429", async () => {
  await newAdmin("spray@platform.test");
  const { secret } = await enrolled("spray@platform.test");
  toNextBoundary();
  const wrong = totpAt(secret, api.clock.now(), 9);
  for (let i = 0; i < 20; i++) {
    const res = await verifyWith("spray@platform.test", { code: wrong });
    assert.equal(res.status, 400, `第 ${i + 1} 次：${res.text}`);
  }
  const blocked = await verifyWith("spray@platform.test", { code: totpAt(secret, api.clock.now()) });
  assert.equal(blocked.status, 429, blocked.text);
  assert.equal(blocked.body.error.code, "TOO_MANY_LOGIN_ATTEMPTS");
  const step = (await api.db.owner.query("select totp_last_step from platform_users where email = 'spray@platform.test'")).rows[0].totp_last_step;
  assert.notEqual(Number(step), Math.floor(api.clock.now().getTime() / STEP), "被拦下的那一次没有核对、没有用掉这一窗");
  api.clock.advance(15 * 60_000);
  assert.equal((await verifyWith("spray@platform.test", { code: totpAt(secret, api.clock.now()) })).status, 200, "15 分钟后解锁");
});

test("限速（确认绑定）：同一邮箱同一地址确认时错 5 次后第 6 次 429", async () => {
  await newAdmin("bind-guess@platform.test");
  const { token, ip } = await passwordLogin("bind-guess@platform.test");
  const started = await api.call("POST", "/platform/v1/auth/mfa/enrollment", { token, ip, body: {} });
  const wrong = totpAt(started.body.secret, api.clock.now(), 9);
  for (let i = 0; i < 5; i++) assert.equal((await api.call("POST", "/platform/v1/auth/mfa/enrollment/confirm", { token, ip, body: { code: wrong } })).status, 400);
  const blocked = await api.call("POST", "/platform/v1/auth/mfa/enrollment/confirm", { token, ip, body: { code: totpAt(started.body.secret, api.clock.now()) } });
  assert.equal(blocked.status, 429);
  assert.equal((await api.db.owner.query("select totp_secret from platform_users where email = 'bind-guess@platform.test'")).rows[0].totp_secret, null);
});

test("日志里没有密钥原文、otpauth 链接、恢复码、提交的动态码", async () => {
  await newAdmin("silent@platform.test");
  const before = api.logs().length;
  const { token, ip, secret, recoveryCodes, confirmCode } = await enrolled("silent@platform.test");
  toNextBoundary();
  const code = totpAt(secret, api.clock.now());
  const regenerated = await api.call("POST", "/platform/v1/auth/mfa/recovery-codes", { token, ip, body: { code } });
  assert.equal(regenerated.status, 200);
  const wrong = await verifyWith("silent@platform.test", { code: "000000" === code ? "111111" : "000000" });
  assert.equal(wrong.status, 400);
  const used = await verifyWith("silent@platform.test", { recovery_code: (regenerated.body.recovery_codes as string[])[0] as string });
  assert.equal(used.status, 200);
  const logs = api.logs().slice(before);
  assert.ok(logs.length > 0, "确实截到了日志");
  assert.ok(!logs.includes(secret), "密钥原文");
  assert.ok(!logs.includes("otpauth://"), "otpauth 链接");
  for (const rc of [...recoveryCodes, ...(regenerated.body.recovery_codes as string[])]) {
    assert.ok(!logs.includes(rc) && !logs.includes(rc.replace(/-/g, "")), "恢复码");
  }
  for (const c of [confirmCode, code]) assert.ok(!logs.includes(`"${c}"`), `动态码 ${c}`);
  const audit = JSON.stringify((await api.db.owner.query("select after, before from audit_logs where resource_id = (select id::text from platform_users where email = 'silent@platform.test')")).rows);
  assert.ok(!audit.includes(secret) && !audit.includes(`"${code}"`) && !audit.includes(`"${confirmCode}"`));
});

test("重置别人的两步验证：自建角色能看平台账号和待审核，但发起、批准重置都不行（要 staff.manage）", async () => {
  await newAdmin("target-reset@platform.test");
  await enrolled("target-reset@platform.test");
  const targetId = (await api.db.owner.query("select id from platform_users where email = 'target-reset@platform.test'")).rows[0].id as string;
  const role = await api.call("POST", "/platform/v1/roles", { token: rootToken, body: { name: "账号观察员", grants: ["staff:view", "approvals:view"] } });
  assert.equal(role.status, 201, role.text);
  const invited = await api.call("POST", "/platform/v1/staff", { token: rootToken, body: { email: "watcher-reset@platform.test", name: "观察", role: role.body.key } });
  assert.equal(invited.status, 201, invited.text);
  await api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.body.invite.token, password: TEST_PASSWORD } });
  const watcher = (await api.platformLogin({ body: { email: "watcher-reset@platform.test", password: TEST_PASSWORD } })).body.access_token as string;

  const requested = await api.call("POST", `/platform/v1/staff/${targetId}/mfa-reset`, { token: rootToken, body: {} });
  assert.equal(requested.status, 202, requested.text);
  const id = requested.body.approval.id as string;
  assert.equal((await api.call("POST", `/platform/v1/staff/${targetId}/mfa-reset`, { token: watcher, body: {} })).status, 403, "发起要 staff.manage");
  const approve = await api.call("POST", `/platform/v1/approvals/${id}/approve`, { token: watcher, body: {} });
  assert.ok(approve.status === 403 || approve.status === 404, approve.text);
  const row = (await api.db.owner.query("select totp_secret from platform_users where id = $1", [targetId])).rows[0];
  assert.notEqual(row.totp_secret, null, "没有被重置");
  await api.call("POST", `/platform/v1/approvals/${id}/withdraw`, { token: rootToken, body: {} });
});
