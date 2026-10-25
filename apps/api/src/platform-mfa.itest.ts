/**
 * 平台员工的两步验证（M4-05，ADR 0030），真实 PostgreSQL。
 *
 * 这里大多直接调接口（不用 `api.platformLogin` 的自动第二步），一步一步核对：待验证的会话能做什么、绑定、动态码登录、
 * 防重放、限速、恢复码、换手机、密钥加密存储、重置（双人复核和命令行）、和「必须先修改密码」的先后。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createSuperAdmin } from "./services/platform-staff.ts";
import { type ApiResponse, TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";
import { leakedSecrets, testEnv } from "./testing/fixtures.ts";
import { exitWithin, startNode } from "./testing/process.ts";
import { totpAt } from "./testing/totp.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

let api: TestApi;
let rootToken: string;
let ipCounter = 0;
const freshIp = (): string => `10.40.${Math.floor(ipCounter / 250)}.${(ipCounter++ % 250) + 1}`;

before(async () => {
  api = await createTestApi();
  rootToken = await api.superAdminToken("root@platform.test");
});
after(() => api.close());

const passwordLogin = (email: string, ip = freshIp(), password = TEST_PASSWORD): Promise<ApiResponse> =>
  api.call("POST", "/platform/v1/auth/login", { ip, body: { email, password } });

async function newAdmin(email: string): Promise<void> {
  await createSuperAdmin(api.db.pool, { email, name: email, password: TEST_PASSWORD }, api.clock.now());
}

/** 密码登录 + 绑定，返回令牌和密钥。 */
async function enrolled(email: string): Promise<{ token: string; secret: string; recoveryCodes: string[] }> {
  const ip = freshIp();
  const login = await passwordLogin(email, ip);
  assert.equal(login.status, 200, login.text);
  const token = login.body.access_token as string;
  const started = await api.call("POST", "/platform/v1/auth/mfa/enrollment", { token, ip, body: {} });
  assert.equal(started.status, 200, started.text);
  const confirmed = await api.call("POST", "/platform/v1/auth/mfa/enrollment/confirm", { token, ip, body: { code: totpAt(started.body.secret, api.clock.now()) } });
  assert.equal(confirmed.status, 200, confirmed.text);
  return { token, secret: started.body.secret as string, recoveryCodes: confirmed.body.recovery_codes as string[] };
}

/** 换到下一个时间窗（测试时钟是停住的；同一个窗的码只能用一次）。 */
const nextWindow = (): void => api.clock.advance(30_000);

test("密码对了只是第一步：没绑定过的账号拿到的会话只能查看自己、退出、绑定；其余接口 403 MFA_REQUIRED（含修改密码）", async () => {
  await newAdmin("fresh@platform.test");
  const login = await passwordLogin("fresh@platform.test");
  assert.equal(login.status, 200, login.text);
  assert.deepEqual(login.body.second_factor, { status: "enrollment_required" });
  const token = login.body.access_token as string;

  const me = await api.call("GET", "/platform/v1/auth/me", { token });
  assert.equal(me.status, 200);
  assert.equal(me.body.second_factor.status, "enrollment_required");
  assert.deepEqual(me.body.permissions, [], "两步验证完成之前不给权限清单");

  for (const [method, url] of [["GET", "/platform/v1/tenants"], ["GET", "/platform/v1/staff"], ["GET", "/platform/v1/dashboard/summary"], ["POST", "/platform/v1/auth/change-password"], ["POST", "/platform/v1/auth/mfa/recovery-codes"]] as const) {
    const res = await api.call(method, url, { token, body: {} });
    assert.equal(res.status, 403, `${method} ${url}`);
    assert.deepEqual(res.body.error, { code: "MFA_REQUIRED", message: "请先绑定两步验证，再继续使用", details: { status: "enrollment_required" } }, `${method} ${url}`);
  }
  const verify = await api.call("POST", "/platform/v1/auth/mfa/verify", { token, body: { code: "123456" } });
  assert.equal(verify.status, 409);
  assert.equal(verify.body.error.code, "MFA_NOT_ENROLLED");
  assert.equal((await api.call("POST", "/platform/v1/auth/logout", { token })).status, 204);
});

test("绑定：开始时给出密钥和 otpauth 链接；输入一次动态码才生效，返回 10 个恢复码；库里的密钥是密文、恢复码只有哈希；同一个令牌随即可以正常使用", async () => {
  await newAdmin("bind@platform.test");
  const ip = freshIp();
  const login = await passwordLogin("bind@platform.test", ip);
  const token = login.body.access_token as string;
  const other = (await passwordLogin("bind@platform.test")).body.access_token as string;

  const started = await api.call("POST", "/platform/v1/auth/mfa/enrollment", { token, ip, body: {} });
  assert.equal(started.status, 200, started.text);
  const secret = started.body.secret as string;
  assert.match(secret, /^[A-Z2-7]{32}$/, "20 字节随机数的 Base32");
  assert.ok((started.body.otpauth_uri as string).startsWith("otpauth://totp/"));
  assert.ok((started.body.otpauth_uri as string).includes("bind%40platform.test"));
  assert.ok((started.body.otpauth_uri as string).includes(`secret=${secret}`));
  assert.equal(new Date(started.body.expires_at).getTime(), api.clock.now().getTime() + 15 * MINUTE);

  const row = async () => (await api.db.owner.query("select totp_secret, totp_enabled_at, totp_pending_secret, totp_last_step from platform_users where email = 'bind@platform.test'")).rows[0];
  const pending = await row();
  assert.equal(pending.totp_secret, null, "确认之前还没生效");
  assert.match(pending.totp_pending_secret, /^v1\./);
  assert.ok(!pending.totp_pending_secret.includes(secret), "库里是密文");
  assert.equal((await api.call("GET", "/platform/v1/tenants", { token })).status, 403);

  const wrong = await api.call("POST", "/platform/v1/auth/mfa/enrollment/confirm", { token, ip, body: { code: totpAt(secret, api.clock.now(), 5) } });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.body.error.code, "MFA_CODE_INVALID");

  const confirmed = await api.call("POST", "/platform/v1/auth/mfa/enrollment/confirm", { token, ip, body: { code: totpAt(secret, api.clock.now()) } });
  assert.equal(confirmed.status, 200, confirmed.text);
  assert.equal(confirmed.body.second_factor.status, "verified");
  const codes = confirmed.body.recovery_codes as string[];
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const code of codes) assert.match(code, /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);

  const active = await row();
  assert.match(active.totp_secret, /^v1\./);
  assert.ok(!active.totp_secret.includes(secret));
  assert.equal(active.totp_pending_secret, null);
  assert.ok(active.totp_enabled_at instanceof Date);
  const stored = (await api.db.owner.query("select code_hash from platform_recovery_codes r join platform_users u on u.id = r.user_id where u.email = 'bind@platform.test'")).rows.map((r) => r.code_hash as string);
  assert.equal(stored.length, 10);
  for (const code of codes) assert.ok(!stored.some((hash) => hash.includes(code.replace(/-/g, ""))), "库里只有哈希");

  assert.equal((await api.call("GET", "/platform/v1/tenants", { token })).status, 200, "同一个令牌恢复正常");
  const me = await api.call("GET", "/platform/v1/auth/me", { token });
  assert.equal(me.body.second_factor.status, "verified");
  assert.equal(me.body.second_factor.recovery_codes_remaining, 10);
  assert.ok(me.body.permissions.includes("staff.manage"));
  assert.equal((await api.call("GET", "/platform/v1/auth/me", { token: other })).status, 401, "绑定时这个账号的其他会话全部失效");

  // 审计里没有密钥和恢复码
  const audit = await api.db.owner.query("select action, after from audit_logs where resource_id = (select id::text from platform_users where email = 'bind@platform.test') order by id");
  assert.deepEqual(audit.rows.map((r) => r.action).filter((a) => a.startsWith("mfa_")), ["mfa_enroll_start", "mfa_failed", "mfa_enroll"]);
  const text = JSON.stringify(audit.rows);
  assert.ok(!text.includes(secret) && !codes.some((code) => text.includes(code)));
});

test("绑定过的账号：登录后输入动态码；会话从「待验证的 15 分钟」延长到登录起 8 小时；不能借「重新绑定」绕过", async () => {
  await newAdmin("daily@platform.test");
  const { secret } = await enrolled("daily@platform.test");
  nextWindow();
  const ip = freshIp();
  const login = await passwordLogin("daily@platform.test", ip);
  assert.deepEqual(login.body.second_factor, { status: "verify_required" });
  const token = login.body.access_token as string;
  const blocked = await api.call("GET", "/platform/v1/tenants", { token });
  assert.deepEqual(blocked.body.error, { code: "MFA_REQUIRED", message: "请先输入两步验证的动态码，再继续使用", details: { status: "verify_required" } });
  const rebind = await api.call("POST", "/platform/v1/auth/mfa/enrollment", { token, ip, body: {} });
  assert.equal(rebind.status, 409);
  assert.equal(rebind.body.error.code, "MFA_ALREADY_ENROLLED");

  const verified = await api.call("POST", "/platform/v1/auth/mfa/verify", { token, ip, body: { code: totpAt(secret, api.clock.now()) } });
  assert.equal(verified.status, 200, verified.text);
  assert.deepEqual(verified.body.second_factor, { status: "verified", method: "totp", recovery_codes_remaining: 10 });
  const again = await api.call("POST", "/platform/v1/auth/mfa/verify", { token, ip, body: { code: totpAt(secret, api.clock.now(), 1) } });
  assert.equal(again.body.error.code, "MFA_ALREADY_VERIFIED");

  api.clock.advance(8 * HOUR - 31_000);
  assert.equal((await api.call("GET", "/platform/v1/tenants", { token })).status, 200);
  api.clock.advance(31_000);
  assert.equal((await api.call("GET", "/platform/v1/auth/me", { token })).status, 401, "满 8 小时失效");
  rootToken = (await api.platformLogin({ body: { email: "root@platform.test", password: TEST_PASSWORD } })).body.access_token;
});

test("待验证的会话 15 分钟后失效，要重新输密码", async () => {
  await newAdmin("slow@platform.test");
  const token = (await passwordLogin("slow@platform.test")).body.access_token as string;
  api.clock.advance(15 * MINUTE - 1_000);
  assert.equal((await api.call("GET", "/platform/v1/auth/me", { token })).status, 200);
  api.clock.advance(1_000);
  assert.equal((await api.call("GET", "/platform/v1/auth/me", { token })).status, 401);
  assert.equal((await api.call("POST", "/platform/v1/auth/mfa/enrollment", { token, body: {} })).status, 401);
});

test("防重放：同一时间窗的码只能用一次；用了较晚的之后较早的也不行；前后各容忍一个时间窗，再远不收", async () => {
  await newAdmin("replay@platform.test");
  const { secret } = await enrolled("replay@platform.test");
  nextWindow();
  const verify = async (offset: number): Promise<ApiResponse> => {
    const ip = freshIp();
    const token = (await passwordLogin("replay@platform.test", ip)).body.access_token as string;
    return api.call("POST", "/platform/v1/auth/mfa/verify", { token, ip, body: { code: totpAt(secret, api.clock.now(), offset) } });
  };
  assert.equal((await verify(0)).status, 200);
  const reused = await verify(0);
  assert.equal(reused.status, 400);
  assert.deepEqual(reused.body.error, { code: "MFA_CODE_REUSED", message: "这个动态码已经用过了，请等验证器上出现下一个再输入", details: {} });
  assert.equal((await verify(-1)).body.error.code, "MFA_CODE_REUSED", "比用过的还早");
  assert.equal((await verify(1)).status, 200, "下一个时间窗（时钟偏差）可以");
  assert.equal((await verify(1)).body.error.code, "MFA_CODE_REUSED");
  nextWindow();
  nextWindow();
  assert.equal((await verify(2)).body.error.code, "MFA_CODE_INVALID", "差两个时间窗不收");
  assert.equal((await verify(-2)).body.error.code, "MFA_CODE_INVALID");
  assert.equal((await verify(0)).status, 200);
});

test("并发：两个会话同时用同一个动态码，只有一个成功", async () => {
  await newAdmin("race@platform.test");
  const { secret } = await enrolled("race@platform.test");
  nextWindow();
  const sessions = await Promise.all([1, 2, 3].map(async () => {
    const ip = freshIp();
    return { ip, token: (await passwordLogin("race@platform.test", ip)).body.access_token as string };
  }));
  const code = totpAt(secret, api.clock.now());
  const results = await Promise.all(sessions.map((s) => api.call("POST", "/platform/v1/auth/mfa/verify", { token: s.token, ip: s.ip, body: { code } })));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 400, 400]);
  assert.ok(results.filter((r) => r.status === 400).every((r) => r.body.error.code === "MFA_CODE_REUSED"));
});

test("限速：同一邮箱同一地址错 5 次后第 6 次 429（码对了也不行，不验证、不写审计），15 分钟后恢复；成功后清零", async () => {
  await newAdmin("guess@platform.test");
  const { secret } = await enrolled("guess@platform.test");
  nextWindow();
  const ip = freshIp();
  let token = (await passwordLogin("guess@platform.test", ip)).body.access_token as string;
  const wrong = totpAt(secret, api.clock.now(), 7);
  for (let i = 0; i < 5; i++) assert.equal((await api.call("POST", "/platform/v1/auth/mfa/verify", { token, ip, body: { code: wrong } })).status, 400, `第 ${i + 1} 次`);
  const failures = async (): Promise<number> => (await api.db.owner.query("select count(*)::int as n from audit_logs where action = 'mfa_failed' and after->>'step' = 'verify' and resource_id = (select id::text from platform_users where email = 'guess@platform.test')")).rows[0].n;
  assert.equal(await failures(), 5, "每次失败都有审计");
  const blocked = await api.call("POST", "/platform/v1/auth/mfa/verify", { token, ip, body: { code: totpAt(secret, api.clock.now()) } });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error.code, "TOO_MANY_LOGIN_ATTEMPTS");
  assert.ok(Number(blocked.headers["retry-after"]) > 0);
  assert.equal(await failures(), 5, "被拦下的不写审计");
  // 待验证的会话只有 15 分钟：窗口过去时它也过期了，重新登录
  api.clock.advance(15 * MINUTE);
  token = (await passwordLogin("guess@platform.test", ip)).body.access_token as string;
  assert.equal((await api.call("POST", "/platform/v1/auth/mfa/verify", { token, ip, body: { code: totpAt(secret, api.clock.now()) } })).status, 200);
});

test("恢复码：可以代替动态码登录，用一个少一个、用过的不能再用；忽略大小写和连字符；重新生成后旧的整组作废", async () => {
  await newAdmin("lost@platform.test");
  const { token: first, secret, recoveryCodes } = await enrolled("lost@platform.test");
  const useCode = async (code: string): Promise<ApiResponse> => {
    const ip = freshIp();
    const token = (await passwordLogin("lost@platform.test", ip)).body.access_token as string;
    return api.call("POST", "/platform/v1/auth/mfa/verify", { token, ip, body: { recovery_code: code } });
  };
  const [one, two] = recoveryCodes as [string, string];
  const used = await useCode(one.toUpperCase().replace(/-/g, " "));
  assert.equal(used.status, 200, used.text);
  assert.deepEqual(used.body.second_factor, { status: "verified", method: "recovery_code", recovery_codes_remaining: 9 });
  assert.equal((await useCode(one)).body.error.code, "MFA_CODE_INVALID", "用过的不能再用");
  assert.equal((await useCode("abcd-efgh-jkmn-pqrs")).body.error.code, "MFA_CODE_INVALID");
  assert.equal((await useCode("not-a-code")).body.error.code, "MFA_CODE_INVALID");
  const both = await api.call("POST", "/platform/v1/auth/mfa/verify", { token: first, body: { code: "123456", recovery_code: two } });
  assert.equal(both.status, 400, "动态码和恢复码只填一个");

  // 重新生成：要输入现在的动态码；旧的整组作废
  nextWindow();
  assert.equal((await api.call("POST", "/platform/v1/auth/mfa/recovery-codes", { token: first, body: {} })).status, 400);
  const regenerated = await api.call("POST", "/platform/v1/auth/mfa/recovery-codes", { token: first, body: { code: totpAt(secret, api.clock.now()) } });
  assert.equal(regenerated.status, 200, regenerated.text);
  const fresh = regenerated.body.recovery_codes as string[];
  assert.equal(fresh.length, 10);
  assert.ok(!fresh.includes(two));
  assert.equal((await useCode(two)).body.error.code, "MFA_CODE_INVALID", "旧的一组作废");
  assert.equal((await useCode(fresh[0] as string)).status, 200);
  assert.equal((await api.call("GET", "/platform/v1/auth/me", { token: first })).body.second_factor.recovery_codes_remaining, 9);
});

test("换手机：先输入现在的动态码；确认之前旧的照常可用，确认之后旧密钥作废、恢复码换新、其他会话失效；绑定 15 分钟内要确认", async () => {
  await newAdmin("phone@platform.test");
  const { token, secret: oldSecret, recoveryCodes: oldCodes } = await enrolled("phone@platform.test");
  nextWindow();
  const ip = freshIp();
  const required = await api.call("POST", "/platform/v1/auth/mfa/enrollment", { token, ip, body: {} });
  assert.equal(required.status, 400);
  assert.equal(required.body.error.code, "MFA_CODE_REQUIRED");
  assert.equal((await api.call("POST", "/platform/v1/auth/mfa/enrollment", { token, ip, body: { code: totpAt(oldSecret, api.clock.now(), 4) } })).body.error.code, "MFA_CODE_INVALID");
  const started = await api.call("POST", "/platform/v1/auth/mfa/enrollment", { token, ip, body: { code: totpAt(oldSecret, api.clock.now()) } });
  assert.equal(started.status, 200, started.text);
  const newSecret = started.body.secret as string;
  assert.notEqual(newSecret, oldSecret);

  // 确认之前：旧密钥照常登录
  nextWindow();
  const otherIp = freshIp();
  const other = (await passwordLogin("phone@platform.test", otherIp)).body.access_token as string;
  assert.equal((await api.call("POST", "/platform/v1/auth/mfa/verify", { token: other, ip: otherIp, body: { code: totpAt(oldSecret, api.clock.now()) } })).status, 200);

  const confirmed = await api.call("POST", "/platform/v1/auth/mfa/enrollment/confirm", { token, ip, body: { code: totpAt(newSecret, api.clock.now()) } });
  assert.equal(confirmed.status, 200, confirmed.text);
  assert.equal((await api.call("GET", "/platform/v1/auth/me", { token: other })).status, 401, "其他会话失效");
  assert.equal((await api.call("GET", "/platform/v1/tenants", { token })).status, 200, "当前会话保留");

  nextWindow();
  const tryLogin = async (body: Record<string, string>): Promise<ApiResponse> => {
    const loginIp = freshIp();
    const t = (await passwordLogin("phone@platform.test", loginIp)).body.access_token as string;
    return api.call("POST", "/platform/v1/auth/mfa/verify", { token: t, ip: loginIp, body });
  };
  assert.equal((await tryLogin({ code: totpAt(oldSecret, api.clock.now()) })).body.error.code, "MFA_CODE_INVALID", "旧密钥作废");
  assert.equal((await tryLogin({ recovery_code: oldCodes[0] as string })).body.error.code, "MFA_CODE_INVALID", "旧恢复码作废");
  assert.equal((await tryLogin({ code: totpAt(newSecret, api.clock.now()) })).status, 200);

  // 绑定过期
  nextWindow();
  const late = await api.call("POST", "/platform/v1/auth/mfa/enrollment", { token, ip, body: { code: totpAt(newSecret, api.clock.now()) } });
  assert.equal(late.status, 200);
  api.clock.advance(15 * MINUTE);
  const expired = await api.call("POST", "/platform/v1/auth/mfa/enrollment/confirm", { token, ip, body: { code: totpAt(late.body.secret, api.clock.now()) } });
  assert.equal(expired.status, 409);
  assert.equal(expired.body.error.code, "MFA_ENROLLMENT_NOT_STARTED");
  rootToken = (await api.platformLogin({ body: { email: "root@platform.test", password: TEST_PASSWORD } })).body.access_token;
});

test("库里的密文解不开（数据加密密钥被换过）：503 MFA_SECRET_UNAVAILABLE，不报 500；密文搬到别人的行里也解不开", async () => {
  await newAdmin("moved-a@platform.test");
  await newAdmin("moved-b@platform.test");
  const a = await enrolled("moved-a@platform.test");
  await enrolled("moved-b@platform.test");
  await api.db.owner.query("update platform_users set totp_secret = (select totp_secret from platform_users where email = 'moved-a@platform.test') where email = 'moved-b@platform.test'");
  nextWindow();
  const ip = freshIp();
  const token = (await passwordLogin("moved-b@platform.test", ip)).body.access_token as string;
  const res = await api.call("POST", "/platform/v1/auth/mfa/verify", { token, ip, body: { code: totpAt(a.secret, api.clock.now()) } });
  assert.equal(res.status, 503);
  assert.equal(res.body.error.code, "MFA_SECRET_UNAVAILABLE");
});

test("没配置数据加密密钥：密码登录照常，但绑定 / 验证 503，其余接口仍是 MFA_REQUIRED（不会因此放行）", async () => {
  const bare = await createTestApi({ env: { DATA_ENCRYPTION_KEY: "" } });
  try {
    await createSuperAdmin(bare.db.pool, { email: "nokey@platform.test", name: "无密钥", password: TEST_PASSWORD }, bare.clock.now());
    const login = await bare.call("POST", "/platform/v1/auth/login", { body: { email: "nokey@platform.test", password: TEST_PASSWORD } });
    assert.equal(login.status, 200);
    const token = login.body.access_token as string;
    const started = await bare.call("POST", "/platform/v1/auth/mfa/enrollment", { token, body: {} });
    assert.equal(started.status, 503);
    assert.equal(started.body.error.code, "MFA_ENCRYPTION_NOT_CONFIGURED");
    assert.equal((await bare.call("GET", "/platform/v1/tenants", { token })).body.error.code, "MFA_REQUIRED");
  } finally {
    await bare.close();
  }
});

test("必须先修改密码的账号：先两步验证、再改密码——待验证时改密码 403 MFA_REQUIRED；绑定后其余接口 403 PASSWORD_CHANGE_REQUIRED；改完恢复正常", async () => {
  const temporary = "Tmp7k-Qw3zR-9vBn2-XyLp4";
  await createSuperAdmin(api.db.pool, { email: "temp@platform.test", name: "临时", password: temporary, temporaryPassword: true }, api.clock.now());
  const ip = freshIp();
  const login = await passwordLogin("temp@platform.test", ip, temporary);
  assert.equal(login.body.must_change_password, true);
  assert.equal(login.body.second_factor.status, "enrollment_required");
  const token = login.body.access_token as string;
  const change = { current_password: temporary, new_password: "Fresh-Lantern-2027" };
  const early = await api.call("POST", "/platform/v1/auth/change-password", { token, ip, body: change });
  assert.equal(early.status, 403);
  assert.equal(early.body.error.code, "MFA_REQUIRED");

  const started = await api.call("POST", "/platform/v1/auth/mfa/enrollment", { token, ip, body: {} });
  const confirmed = await api.call("POST", "/platform/v1/auth/mfa/enrollment/confirm", { token, ip, body: { code: totpAt(started.body.secret, api.clock.now()) } });
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.must_change_password, true);
  assert.equal((await api.call("GET", "/platform/v1/tenants", { token })).body.error.code, "PASSWORD_CHANGE_REQUIRED");
  assert.equal((await api.call("POST", "/platform/v1/auth/mfa/recovery-codes", { token, body: { code: "123456" } })).body.error.code, "PASSWORD_CHANGE_REQUIRED");
  assert.equal((await api.call("POST", "/platform/v1/auth/change-password", { token, ip, body: change })).status, 204);
  assert.equal((await api.call("GET", "/platform/v1/tenants", { token })).status, 200);
});

test("上线时已有的会话（没有两步验证记录）：下一个请求就被引导绑定，用同一个令牌绑定后照常使用", async () => {
  await newAdmin("legacy@platform.test");
  const { token } = await enrolled("legacy@platform.test");
  // 模拟迁移之前的状态：账号没绑定、会话没有两步验证记录
  await api.db.owner.query("update platform_users set totp_secret = null, totp_enabled_at = null, totp_last_step = null where email = 'legacy@platform.test'");
  await api.db.owner.query("delete from platform_recovery_codes where user_id = (select id from platform_users where email = 'legacy@platform.test')");
  await api.db.owner.query("update platform_sessions set mfa_verified_at = null, mfa_method = null where user_id = (select id from platform_users where email = 'legacy@platform.test')");
  const blocked = await api.call("GET", "/platform/v1/tenants", { token });
  assert.deepEqual(blocked.body.error.details, { status: "enrollment_required" });
  const started = await api.call("POST", "/platform/v1/auth/mfa/enrollment", { token, body: {} });
  assert.equal(started.status, 200);
  assert.equal((await api.call("POST", "/platform/v1/auth/mfa/enrollment/confirm", { token, body: { code: totpAt(started.body.secret, api.clock.now()) } })).status, 200);
  assert.equal((await api.call("GET", "/platform/v1/tenants", { token })).status, 200);
});

test("重置别人的两步验证：双人复核——发起人不能批准；对方本人不能批准；批准后对方全部会话失效，下次登录重新绑定；不能对自己发起", async () => {
  await newAdmin("second@platform.test");
  await newAdmin("third@platform.test");
  const second = (await api.platformLogin({ body: { email: "second@platform.test", password: TEST_PASSWORD } })).body.access_token as string;
  const third = (await api.platformLogin({ body: { email: "third@platform.test", password: TEST_PASSWORD } })).body.access_token as string;
  const idOf = async (email: string): Promise<string> => (await api.db.owner.query("select id from platform_users where email = $1", [email])).rows[0].id;
  const thirdId = await idOf("third@platform.test");
  const rootId = await idOf("root@platform.test");

  const self = await api.call("POST", `/platform/v1/staff/${rootId}/mfa-reset`, { token: rootToken, body: {} });
  assert.equal(self.status, 409);
  assert.equal(self.body.error.code, "MFA_RESET_SELF");
  await newAdmin("never-bound@platform.test");
  const unbound = await api.call("POST", `/platform/v1/staff/${await idOf("never-bound@platform.test")}/mfa-reset`, { token: rootToken, body: {} });
  assert.equal(unbound.body.error.code, "MFA_NOT_ENROLLED");

  const requested = await api.call("POST", `/platform/v1/staff/${thirdId}/mfa-reset`, { token: rootToken, body: { request_note: "换手机，恢复码丢了" } });
  assert.equal(requested.status, 202, requested.text);
  const approvalId = requested.body.approval.id as string;
  assert.equal(requested.body.approval.kind, "staff.mfa_reset");
  assert.equal((await api.call("GET", "/platform/v1/tenants", { token: third })).status, 200, "发起不改变任何东西");
  assert.equal((await api.call("POST", `/platform/v1/approvals/${approvalId}/approve`, { token: rootToken, body: {} })).body.error.code, "APPROVAL_SELF_REVIEW");
  const byTarget = await api.call("POST", `/platform/v1/approvals/${approvalId}/approve`, { token: third, body: {} });
  assert.equal(byTarget.status, 409);
  assert.equal(byTarget.body.error.code, "MFA_RESET_SELF");
  const approved = await api.call("POST", `/platform/v1/approvals/${approvalId}/approve`, { token: second, body: {} });
  assert.equal(approved.status, 200, approved.text);
  assert.equal((await api.call("GET", "/platform/v1/auth/me", { token: third })).status, 401, "对方的会话全部失效");
  const relogin = await passwordLogin("third@platform.test");
  assert.equal(relogin.body.second_factor.status, "enrollment_required", "密码不变，下次登录重新绑定");
  const audit = await api.db.owner.query("select actor_id, after from audit_logs where action = 'mfa_reset' and resource_id = $1", [thirdId]);
  assert.equal(audit.rows.length, 1);
  assert.equal(audit.rows[0].after.approval_id, approvalId);
});

test("命令行 pnpm admin:reset-2fa：唯一的超级管理员丢了手机时的恢复途径；会话全部失效，下次登录重新绑定；审计记为命令行；不存在的邮箱失败", async () => {
  const solo = await createTestApi();
  try {
    const token = await solo.superAdminToken("solo@platform.test");
    const entry = fileURLToPath(new URL("./cli/admin-reset-2fa.ts", import.meta.url));
    const run = async (args: string[]): Promise<{ code: number | null | "timeout"; output: string }> => {
      const running = startNode(entry, testEnv(solo.db.url), args);
      const code = await exitWithin(running, 20_000);
      if (code === "timeout") running.child.kill("SIGKILL");
      return { code, output: running.output() };
    };
    const missing = await run(["--email", "ghost@platform.test"]);
    assert.equal(missing.code, 1);
    assert.match(missing.output, /没有这个邮箱的在用平台员工/);
    assert.equal((await run(["--email"])).code, 1);
    assert.equal((await run(["--email", "solo@platform.test", "extra"])).code, 1);

    const done = await run(["--email", "Solo@Platform.test"]);
    assert.equal(done.code, 0, done.output);
    assert.match(done.output, /已清掉 solo@platform\.test 的两步验证/);
    assert.deepEqual(leakedSecrets(done.output), []);
    assert.equal((await solo.call("GET", "/platform/v1/auth/me", { token })).status, 401);
    const login = await solo.call("POST", "/platform/v1/auth/login", { body: { email: "solo@platform.test", password: TEST_PASSWORD } });
    assert.equal(login.body.second_factor.status, "enrollment_required");
    const audit = await solo.db.owner.query("select actor_type, source, after from audit_logs where action = 'mfa_reset'");
    assert.deepEqual(audit.rows, [{ actor_type: "system", source: "cli", after: { was_enrolled: true } }]);
    assert.equal((await solo.db.owner.query("select count(*)::int as n from platform_recovery_codes")).rows[0].n, 0);
  } finally {
    await solo.close();
  }
});
