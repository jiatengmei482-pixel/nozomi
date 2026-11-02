/**
 * QA（M4-06，ADR 0050）：邮箱验证码登录的「绕过」。开发的 email-login.itest.ts 没有覆盖的部分：
 * 两步验证的每条岔路、发码之后才变化的状态、租户侧的停用和清退、密码关闭后的其他密码接口、两个入口互不串。
 * 连真实的 PostgreSQL 和本机假 SMTP，账号都是测试里现场构造的虚构值。
 */
import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
import { EMAIL_CODE_RESEND_INTERVAL_MS } from "@nozomi/domain";
import { SmtpMailer } from "./integrations/smtp.ts";
import { createSuperAdmin } from "./services/platform-staff.ts";
import { type ApiResponse, TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";
import { type FakeSmtp, decodedMailText, startFakeSmtp } from "./testing/fake-integrations.ts";
import { totpAt } from "./testing/totp.ts";

type Portal = "platform" | "tenant";

const SMTP_ENV = (fake: FakeSmtp): Record<string, string> => ({ SMTP_HOST: fake.host, SMTP_PORT: String(fake.port), SMTP_ENCRYPTION: "none", SMTP_USERNAME: "qa-mailer@example.test", SMTP_PASSWORD: "qa-fake-smtp-password", SMTP_FROM_NAME: "NOZOMI", SMTP_FROM_ADDRESS: "noreply@example.test" });
const NEW_PASSWORD = "Silent-Meadow-2031";
const THIRTY_SECONDS = 30_000;

let smtp: FakeSmtp;
let api: TestApi;
let root: string;
let ipCounter = 0;
const nextIp = (): string => `198.51.100.${(++ipCounter % 250) + 1}`;

async function requestCode(portal: Portal, email: string, ip = nextIp(), on: TestApi = api): Promise<ApiResponse> {
  const res = await on.call("POST", `/${portal}/v1/auth/email-code/request`, { body: { email }, ip });
  await on.app.backgroundIdle();
  return res;
}

async function verify(portal: Portal, email: string, code: string, ip = nextIp(), on: TestApi = api): Promise<ApiResponse> {
  const res = await on.call("POST", `/${portal}/v1/auth/email-code/verify`, { body: { email, code }, ip });
  await on.app.backgroundIdle();
  return res;
}

function latestCode(email: string): string {
  const message = [...smtp.messages].reverse().find((item) => item.to.includes(email));
  assert.ok(message, `${email} 没有收到邮件`);
  const code = /^(\d{6})$/m.exec(decodedMailText(message.data))?.[1];
  assert.ok(code, "邮件里没有 6 位验证码");
  return code;
}

async function codeFor(portal: Portal, email: string, ip = nextIp()): Promise<string> {
  const before = smtp.messages.filter((item) => item.to.includes(email)).length;
  const res = await requestCode(portal, email, ip);
  assert.equal(res.status, 202, res.text);
  assert.equal(smtp.messages.filter((item) => item.to.includes(email)).length, before + 1, "应该多收到一封");
  return latestCode(email);
}

const staff = (email: string): Promise<unknown> => createSuperAdmin(api.db.pool, { email, name: "员工", password: TEST_PASSWORD }, api.clock.now());

/** 用密码登录走完绑定（测试时钟下），返回 TOTP 密钥和恢复码。 */
async function enrolledStaff(email: string): Promise<{ secret: string; recoveryCodes: string[] }> {
  await staff(email);
  const ip = nextIp();
  const login = await api.call("POST", "/platform/v1/auth/login", { body: { email, password: TEST_PASSWORD }, ip });
  assert.equal(login.status, 200, login.text);
  const token = login.body.access_token as string;
  const started = await api.call("POST", "/platform/v1/auth/mfa/enrollment", { token, ip, body: {} });
  assert.equal(started.status, 200, started.text);
  const secret = started.body.secret as string;
  const confirmed = await api.call("POST", "/platform/v1/auth/mfa/enrollment/confirm", { token, ip, body: { code: totpAt(secret, api.clock.now()) } });
  assert.equal(confirmed.status, 200, confirmed.text);
  await api.db.owner.query("update platform_users set totp_last_step = null where email = $1", [email]);
  return { secret, recoveryCodes: confirmed.body.recovery_codes as string[] };
}

const sessionsOfPlatform = async (email: string): Promise<number> => (await api.db.owner.query("select count(*)::int as n from platform_sessions s join platform_users u on u.id = s.user_id where u.email = $1", [email])).rows[0].n;
const sessionsOfTenant = async (email: string): Promise<number> => (await api.db.owner.query("select count(*)::int as n from tenant_sessions s join tenant_users u on u.id = s.user_id where u.email = $1", [email])).rows[0].n;

before(async () => {
  smtp = await startFakeSmtp();
  api = await createTestApi({ env: SMTP_ENV(smtp), integrationSecretsTtlMs: 0, mailer: new SmtpMailer({ allowLoopback: true, deadlineMs: 2_000 }) });
  root = await api.superAdminToken("qa-root@platform.test");
});
after(async () => {
  await api.close();
  await smtp.close();
});
afterEach(() => {
  smtp.reset();
  smtp.behave({});
});

test("两步验证：已绑定的账号验证码通过后只有待验证的会话；业务接口、改密码、重新生成恢复码、不带因子换绑都被拦", async () => {
  const email = "qa-mfa-gates@platform.test";
  const { secret } = await enrolledStaff(email);
  const code = await codeFor("platform", email);
  const ip = nextIp();
  const login = await verify("platform", email, code, ip);
  assert.equal(login.status, 200, login.text);
  assert.equal(login.body.second_factor.status, "verify_required");
  const token = login.body.access_token as string;

  for (const [method, url, body] of [
    ["GET", "/platform/v1/tenants", undefined],
    ["GET", "/platform/v1/integration-secrets", undefined],
    ["POST", "/platform/v1/auth/change-password", { current_password: TEST_PASSWORD, new_password: NEW_PASSWORD }],
    ["POST", "/platform/v1/auth/mfa/recovery-codes", { code: totpAt(secret, api.clock.now()) }],
  ] as const) {
    const res = await api.call(method, url, { token, ip, ...(body === undefined ? {} : { body }) });
    assert.deepEqual([res.status, res.body.error.code], [403, "MFA_REQUIRED"], `${method} ${url}: ${res.text}`);
  }

  const rebind = await api.call("POST", "/platform/v1/auth/mfa/enrollment", { token, ip, body: {} });
  assert.notEqual(rebind.status, 200, `不能只凭验证码换绑：${rebind.text}`);
  assert.equal((await api.db.owner.query("select totp_pending_secret is null as none from platform_users where email = $1", [email])).rows[0].none, true, "不留下待确认的新密钥");
});

test("两步验证：邮件里的验证码当动态码提交不算数；错的动态码和恢复码不解锁", async () => {
  const email = "qa-mfa-not-factor@platform.test";
  const { secret } = await enrolledStaff(email);
  const code = await codeFor("platform", email);
  const ip = nextIp();
  const token = (await verify("platform", email, code, ip)).body.access_token as string;
  const real = totpAt(secret, api.clock.now());
  if (real !== code) {
    const reused = await api.call("POST", "/platform/v1/auth/mfa/verify", { token, ip, body: { code } });
    assert.equal(reused.body.error.code, "MFA_CODE_INVALID", reused.text);
  }
  const bogusRecovery = await api.call("POST", "/platform/v1/auth/mfa/verify", { token, ip, body: { recovery_code: "abcd-efgh-jkmn-pqrs" } });
  assert.equal(bogusRecovery.body.error.code, "MFA_CODE_INVALID", bogusRecovery.text);
  const blocked = await api.call("GET", "/platform/v1/staff", { token, ip });
  assert.deepEqual([blocked.status, blocked.body.error.code], [403, "MFA_REQUIRED"]);
});

test("恢复码路径：验证码 + 恢复码可以完成登录，恢复码只能用一次，而且不会把另一个待验证会话一并解锁", async () => {
  const email = "qa-mfa-recovery@platform.test";
  const { recoveryCodes } = await enrolledStaff(email);
  const recovery = recoveryCodes[0] as string;
  const ip = nextIp();
  const first = (await verify("platform", email, await codeFor("platform", email), ip)).body.access_token as string;
  api.clock.advance(EMAIL_CODE_RESEND_INTERVAL_MS);
  const second = (await verify("platform", email, await codeFor("platform", email), ip)).body.access_token as string;

  const used = await api.call("POST", "/platform/v1/auth/mfa/verify", { token: first, ip, body: { recovery_code: recovery } });
  assert.equal(used.status, 200, used.text);
  assert.equal((await api.call("GET", "/platform/v1/staff", { token: first, ip })).status, 200);

  const blocked = await api.call("GET", "/platform/v1/staff", { token: second, ip });
  assert.deepEqual([blocked.status, blocked.body.error.code], [403, "MFA_REQUIRED"], "另一个会话还是待验证");
  const again = await api.call("POST", "/platform/v1/auth/mfa/verify", { token: second, ip, body: { recovery_code: recovery } });
  assert.equal(again.body.error.code, "MFA_CODE_INVALID", "恢复码用过即作废");
});

test("待验证会话：验证码登录得到的会话 15 分钟不完成两步验证就失效，不会因为令牌写着 8 小时而延长", async () => {
  const email = "qa-mfa-ttl@platform.test";
  await enrolledStaff(email);
  const ip = nextIp();
  const login = await verify("platform", email, await codeFor("platform", email), ip);
  const token = login.body.access_token as string;
  api.clock.advance(15 * 60 * 1000 - 1);
  assert.equal((await api.call("GET", "/platform/v1/auth/me", { token, ip })).status, 200);
  api.clock.advance(1);
  assert.equal((await api.call("GET", "/platform/v1/auth/me", { token, ip })).status, 401);
});

test("必须先改密码（平台）：验证码 + 动态码都过了仍被拦到改密码；改密码还要当前密码，错的不行，验证码替代不了", async () => {
  const email = "qa-must-change@platform.test";
  const { secret } = await enrolledStaff(email);
  await api.db.owner.query("update platform_users set must_change_password = true where email = $1", [email]);
  const ip = nextIp();
  const code = await codeFor("platform", email);
  const login = await verify("platform", email, code, ip);
  assert.equal(login.body.must_change_password, true);
  const token = login.body.access_token as string;
  const verified = await api.call("POST", "/platform/v1/auth/mfa/verify", { token, ip, body: { code: totpAt(secret, api.clock.now()) } });
  assert.equal(verified.status, 200, verified.text);
  const blocked = await api.call("GET", "/platform/v1/staff", { token, ip });
  assert.deepEqual([blocked.status, blocked.body.error.code], [403, "PASSWORD_CHANGE_REQUIRED"]);
  const wrong = await api.call("POST", "/platform/v1/auth/change-password", { token, ip, body: { current_password: code, new_password: NEW_PASSWORD } });
  assert.equal(wrong.status, 400, wrong.text);
  assert.equal(wrong.body.error.code, "CURRENT_PASSWORD_INCORRECT");
  assert.deepEqual([(await api.call("GET", "/platform/v1/staff", { token, ip })).body.error.code], ["PASSWORD_CHANGE_REQUIRED"]);
});

test("IP 白名单：发码之后才加上的角色白名单同样生效，验证码对了也不建会话", async () => {
  const email = "qa-role-allow@platform.test";
  await staff(email);
  const created = await api.call("POST", "/platform/v1/roles", { token: root, body: { name: "QA 白名单角色", grants: ["finance:view"], ip_allowlist: [] } });
  assert.equal(created.status, 201, created.text);
  const roleKey = created.body.key as string;
  await api.db.owner.query("update platform_users set role = $1 where email = $2", [roleKey, email]);
  const outside = "203.0.113.77";
  const code = await codeFor("platform", email, outside);
  await api.db.owner.query("update platform_roles set ip_allowlist = $1 where key = $2", [["203.0.113.10"], roleKey]);
  const denied = await verify("platform", email, code, outside);
  assert.deepEqual([denied.status, denied.body.error.code], [403, "IP_NOT_ALLOWED"], denied.text);
  assert.equal(await sessionsOfPlatform(email), 0);
});

test("IP 白名单：没配代理层数时伪造 X-Forwarded-For 冒充名单里的地址无效", async () => {
  const email = "qa-allow-xff@platform.test";
  await staff(email);
  const allowed = "203.0.113.11";
  await api.db.owner.query("update platform_users set ip_allowlist = $1 where email = $2", [[allowed], email]);
  const outside = nextIp();
  const code = await codeFor("platform", email, outside);
  const res = await api.call("POST", "/platform/v1/auth/email-code/verify", { body: { email, code }, ip: outside, headers: { "x-forwarded-for": allowed } });
  await api.app.backgroundIdle();
  assert.deepEqual([res.status, res.body.error.code], [403, "IP_NOT_ALLOWED"], res.text);
  assert.equal(await sessionsOfPlatform(email), 0);
});

test("租户员工：发码之后才停用，验证码对了也 403，不建会话；发码时已停用的收不到信", async () => {
  const tenant = await api.tenantWithAdmin(root, "QA 停用车队", "qa-tenant-disable@fleet.test");
  const invited = await api.call("POST", "/tenant/v1/users", { token: tenant.adminToken, body: { email: "qa-tenant-staff@fleet.test", name: "员工", role: "readonly" } });
  assert.equal(invited.status, 201, invited.text);
  const accepted = await api.call("POST", "/tenant/v1/auth/accept-invite", { body: { token: invited.body.invite.token, password: TEST_PASSWORD } });
  assert.equal(accepted.status, 200, accepted.text);
  const email = "qa-tenant-staff@fleet.test";

  const code = await codeFor("tenant", email);
  await api.db.owner.query("update tenant_users set status = 'disabled' where email = $1", [email]);
  const before = await sessionsOfTenant(email);
  const res = await verify("tenant", email, code);
  assert.deepEqual([res.status, res.body.error.code], [403, "ACCOUNT_DISABLED"], res.text);
  assert.equal(await sessionsOfTenant(email), before, "不建会话");

  smtp.reset();
  api.clock.advance(EMAIL_CODE_RESEND_INTERVAL_MS);
  assert.equal((await requestCode("tenant", email)).status, 202);
  assert.equal(smtp.messages.length, 0, "停用的账号收不到信");
  assert.equal((await verify("tenant", email, "123456")).status, 401);
});

test("租户员工：还没接受邀请的账号收不到信，任何码都登录不了", async () => {
  const tenant = await api.tenantWithAdmin(root, "QA 待激活车队", "qa-tenant-invite-admin@fleet.test");
  const email = "qa-tenant-pending@fleet.test";
  const invited = await api.call("POST", "/tenant/v1/users", { token: tenant.adminToken, body: { email, name: "待激活", role: "readonly" } });
  assert.equal(invited.status, 201, invited.text);
  smtp.reset();
  assert.equal((await requestCode("tenant", email)).status, 202);
  assert.equal(smtp.messages.length, 0);
  const res = await verify("tenant", email, "123456");
  assert.deepEqual([res.status, res.body.error.code], [401, "EMAIL_CODE_INVALID"]);
  assert.equal(await sessionsOfTenant(email), 0);
});

test("租户已清退：验证码和密码一样能登录，但只读，改东西 409", async () => {
  const tenant = await api.tenantWithAdmin(root, "QA 清退车队", "qa-terminated@fleet.test");
  await api.db.owner.query("update tenants set status = 'terminated', terminated_at = $2 where id = $1", [tenant.tenantId, api.clock.now()]);
  const login = await verify("tenant", tenant.adminEmail, await codeFor("tenant", tenant.adminEmail));
  assert.equal(login.status, 200, login.text);
  assert.equal(login.body.tenant.status, "terminated");
  const token = login.body.access_token as string;
  const write = await api.call("POST", "/tenant/v1/users", { token, body: { email: "qa-after-terminated@fleet.test", name: "新人", role: "readonly" } });
  assert.deepEqual([write.status, write.body.error.code], [409, "TENANT_TERMINATED"], write.text);
  assert.equal((await api.call("GET", "/tenant/v1/users", { token })).status, 200, "还能看历史");
});

test("成功的应答和密码登录字段完全一样（两个入口）：前端不用分两套，也没有多带任何东西", async () => {
  const shape = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(shape);
    if (typeof value === "object" && value !== null) return Object.fromEntries(Object.entries(value).sort().map(([key, item]) => [key, shape(item)]));
    return typeof value;
  };
  const email = "qa-shape@platform.test";
  await staff(email);
  const byPassword = await api.call("POST", "/platform/v1/auth/login", { body: { email, password: TEST_PASSWORD }, ip: nextIp() });
  const byCode = await verify("platform", email, await codeFor("platform", email));
  assert.equal(byCode.status, 200, byCode.text);
  assert.deepEqual(shape(byCode.body), shape(byPassword.body));

  const tenant = await api.tenantWithAdmin(root, "QA 字段车队", "qa-shape@fleet.test");
  const tenantByPassword = await api.call("POST", "/tenant/v1/auth/login", { body: { email: tenant.adminEmail, password: TEST_PASSWORD }, ip: nextIp() });
  const tenantByCode = await verify("tenant", tenant.adminEmail, await codeFor("tenant", tenant.adminEmail));
  assert.equal(tenantByCode.status, 200, tenantByCode.text);
  assert.deepEqual(shape(tenantByCode.body), shape(tenantByPassword.body));
  assert.ok(!tenantByCode.text.includes("password_hash"));
});

test("两个入口：租户的码登录不了平台（反方向开发已测）；计数互不影响；邮件写明是哪个后台", async () => {
  const email = "qa-both-sides@example.test";
  await staff(email);
  await api.tenantWithAdmin(root, "QA 两边车队", email);
  smtp.reset();
  const tenantCode = await codeFor("tenant", email);
  assert.match(decodedMailText(smtp.messages[0]?.data ?? ""), /供应商后台/);
  const onPlatform = await verify("platform", email, tenantCode);
  assert.deepEqual([onPlatform.status, onPlatform.body.error.code], [401, "EMAIL_CODE_INVALID"]);
  assert.equal(await sessionsOfPlatform(email), 0, "平台入口没有多出会话");

  const platformSend = await requestCode("platform", email);
  assert.equal(platformSend.status, 202, "租户入口的 60 秒冷却不影响平台入口");
  assert.match(decodedMailText(smtp.messages.at(-1)?.data ?? ""), /运营后台/);
  assert.equal((await verify("tenant", email, tenantCode)).status, 200, "平台发新码不顶掉租户的码");
});

test("两个入口：只有平台账号的邮箱在租户入口收不到信，反过来也一样", async () => {
  const platformOnly = "qa-platform-only@platform.test";
  await staff(platformOnly);
  const tenant = await api.tenantWithAdmin(root, "QA 单边车队", "qa-tenant-only@fleet.test");
  smtp.reset();
  assert.equal((await requestCode("tenant", platformOnly)).status, 202);
  assert.equal((await requestCode("platform", tenant.adminEmail)).status, 202);
  assert.equal(smtp.messages.length, 0);
});

test("平台的令牌不能进租户后台（反方向开发已测）", async () => {
  const email = "qa-token-cross@platform.test";
  await staff(email);
  const login = await verify("platform", email, await codeFor("platform", email));
  assert.equal((await api.call("GET", "/tenant/v1/auth/me", { token: login.body.access_token })).status, 401);
});

test("密码已关闭：对的密码、错的密码、不存在的邮箱，应答逐字节一样，不能当成核对密码的口子", async () => {
  const closed = await createTestApi({ env: { ...SMTP_ENV(smtp), PASSWORD_LOGIN_DISABLED: "true" }, integrationSecretsTtlMs: 0, mailer: new SmtpMailer({ allowLoopback: true, deadlineMs: 2_000 }) });
  try {
    const email = "qa-closed-oracle@platform.test";
    await createSuperAdmin(closed.db.pool, { email, name: "员工", password: TEST_PASSWORD }, closed.clock.now());
    const tenantEmail = "qa-closed-oracle@fleet.test";
    const answers: ApiResponse[] = [];
    for (const [password, who] of [[TEST_PASSWORD, email], ["Wrong-Password-1999", email], [TEST_PASSWORD, "qa-closed-nobody@platform.test"]] as const) {
      answers.push(await closed.call("POST", "/platform/v1/auth/login", { body: { email: who, password }, ip: nextIp() }));
    }
    for (const answer of answers) {
      assert.deepEqual([answer.status, answer.body.error.code], [403, "PASSWORD_LOGIN_DISABLED"]);
      assert.equal(answer.text, answers[0]?.text);
      assert.ok(!answer.text.includes("access_token"));
    }
    assert.equal(await (await closed.db.owner.query("select count(*)::int as n from platform_sessions")).rows[0].n, 0);
    const audits = (await closed.db.owner.query("select count(*)::int as n from audit_logs where action = 'login_failed'")).rows[0].n;
    assert.equal(audits, 0, "被关闭的入口不写失败审计，别人刷不满审计表");
    const tenantAnswer = await closed.call("POST", "/tenant/v1/auth/login", { body: { email: tenantEmail, password: TEST_PASSWORD }, ip: nextIp() });
    assert.deepEqual([tenantAnswer.status, tenantAnswer.body.error.code], [403, "PASSWORD_LOGIN_DISABLED"]);
  } finally {
    await closed.close();
  }
});

test("密码已关闭：接受邀请、重设密码、改密码都不发令牌；新密码仍然登录不了；验证码才进得去", async () => {
  // 先在邮件未生效时（密码开着）把租户和管理员建好，再由运营后台填上 SMTP：关闭才生效
  const empty = { SMTP_HOST: "", SMTP_PORT: "", SMTP_ENCRYPTION: "", SMTP_USERNAME: "", SMTP_PASSWORD: "", SMTP_FROM_NAME: "", SMTP_FROM_ADDRESS: "" };
  const closed = await createTestApi({ env: { ...empty, PASSWORD_LOGIN_DISABLED: "true" }, integrationSecretsTtlMs: 0, mailer: new SmtpMailer({ allowLoopback: true, deadlineMs: 2_000 }) });
  try {
    const admin = await closed.superAdminToken("qa-closed-root@platform.test");
    const tenant = await closed.tenantWithAdmin(admin, "QA 关闭车队", "qa-closed-admin@fleet.test");
    const invited = await closed.call("POST", "/tenant/v1/users", { token: tenant.adminToken, body: { email: "qa-closed-new@fleet.test", name: "新人", role: "readonly" } });
    assert.equal(invited.status, 201, invited.text);
    const resetIssued = await closed.call("POST", `/tenant/v1/users/${tenant.adminId}/password-reset`, { token: tenant.adminToken });
    const saved = await closed.call("PUT", "/platform/v1/integration-secrets/email", { token: admin, body: { host: smtp.host, port: smtp.port, encryption: "none", username: "qa-mailer@example.test", password: "qa-fake-smtp-password", from_name: "NOZOMI", from_address: "noreply@example.test" } });
    assert.equal(saved.status, 200, saved.text);
    assert.deepEqual((await closed.call("GET", "/tenant/v1/auth/login-methods")).body, { email_code: true, password: false });

    const accepted = await closed.call("POST", "/tenant/v1/auth/accept-invite", { body: { token: invited.body.invite.token, password: NEW_PASSWORD } });
    assert.equal(accepted.status, 200, accepted.text);
    assert.ok(!accepted.text.includes("access_token"), "接受邀请不发令牌");
    const afterAccept = await closed.call("POST", "/tenant/v1/auth/login", { body: { email: "qa-closed-new@fleet.test", password: NEW_PASSWORD } });
    assert.deepEqual([afterAccept.status, afterAccept.body.error.code], [403, "PASSWORD_LOGIN_DISABLED"]);

    assert.equal(resetIssued.status, 201, resetIssued.text);
    const reset = await closed.call("POST", "/tenant/v1/auth/reset-password", { body: { token: resetIssued.body.reset.token, password: NEW_PASSWORD } });
    assert.equal(reset.status, 200, reset.text);
    assert.ok(!reset.text.includes("access_token"), "重设密码不发令牌");
    const afterReset = await closed.call("POST", "/tenant/v1/auth/login", { body: { email: tenant.adminEmail, password: NEW_PASSWORD } });
    assert.deepEqual([afterReset.status, afterReset.body.error.code], [403, "PASSWORD_LOGIN_DISABLED"]);

    const ip = nextIp();
    assert.equal((await requestCode("tenant", tenant.adminEmail, ip, closed)).status, 202);
    const login = await verify("tenant", tenant.adminEmail, latestCode(tenant.adminEmail), ip, closed);
    assert.equal(login.status, 200, login.text);
    const changed = await closed.call("POST", "/tenant/v1/auth/change-password", { token: login.body.access_token, body: { current_password: NEW_PASSWORD, new_password: "Bright-Lantern-2042" } });
    assert.ok(changed.status < 300, changed.text);
    assert.ok(!changed.text.includes("access_token"), "改密码不发新令牌");
  } finally {
    await closed.close();
  }
});

test("发码之后才被重新邀请（账号状态回到 invited）：旧码不能把未激活账号登录进去", async () => {
  const email = "qa-back-to-invited@platform.test";
  await staff(email);
  const code = await codeFor("platform", email);
  await api.db.owner.query("update platform_users set status = 'invited' where email = $1", [email]);
  const res = await verify("platform", email, code);
  assert.deepEqual([res.status, res.body.error.code], [401, "EMAIL_CODE_INVALID"], res.text);
  assert.equal(await sessionsOfPlatform(email), 0);
});

test("时间边界：快到期（差 30 秒）提交的码，通过后建的会话用当时的时钟，不会沿用码的有效期", async () => {
  const email = "qa-near-expiry@platform.test";
  await staff(email);
  const code = await codeFor("platform", email);
  api.clock.advance(10 * 60 * 1000 - THIRTY_SECONDS);
  const login = await verify("platform", email, code);
  assert.equal(login.status, 200, login.text);
  api.clock.advance(14 * 60 * 1000);
  assert.equal((await api.call("GET", "/platform/v1/auth/me", { token: login.body.access_token, ip: nextIp() })).status, 200, "待验证会话从登录起算 15 分钟");
});
