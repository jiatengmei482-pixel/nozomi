/**
 * 邮箱验证码登录（M4-06，ADR 0050），连真实的 PostgreSQL 和本机的假 SMTP 服务器，从不连真实的邮件服务。
 * 这里的账号、验证码都是测试里现场构造的。
 */
import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
import { EMAIL_CODE_RESEND_INTERVAL_MS, EMAIL_CODE_TTL_MS, MAIL_LIGHT_COLORS, emailCodeMail } from "@nozomi/domain";
import { SmtpMailer } from "./integrations/smtp.ts";
import { createSuperAdmin } from "./services/platform-staff.ts";
import { type ApiResponse, TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";
import { type FakeSmtp, decodedMailHtml, decodedMailText, startFakeSmtp } from "./testing/fake-integrations.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { totpAt } from "./testing/totp.ts";

let smtp: FakeSmtp;
let api: TestApi;
let root: string;
/** 每个用例换一个来源地址：同一地址的发码额度（15 分钟 20 封）不互相影响 */
let ipCounter = 0;
const nextIp = (): string => `198.51.100.${++ipCounter}`;

const SMTP_ENV = (fake: FakeSmtp): Record<string, string> => ({ SMTP_HOST: fake.host, SMTP_PORT: String(fake.port), SMTP_ENCRYPTION: "none", SMTP_USERNAME: "mailer@example.test", SMTP_PASSWORD: "fake-smtp-password-only-for-tests", SMTP_FROM_NAME: "NOZOMI", SMTP_FROM_ADDRESS: "noreply@example.test" });
const NO_SMTP = { SMTP_HOST: "", SMTP_PORT: "", SMTP_ENCRYPTION: "", SMTP_USERNAME: "", SMTP_PASSWORD: "", SMTP_FROM_NAME: "", SMTP_FROM_ADDRESS: "" };
const requestPath = (portal: "platform" | "tenant"): string => `/${portal}/v1/auth/email-code/request`;
const verifyPath = (portal: "platform" | "tenant"): string => `/${portal}/v1/auth/email-code/verify`;

async function requestCode(portal: "platform" | "tenant", email: string, ip: string, on: TestApi = api): Promise<ApiResponse> {
  const res = await on.call("POST", requestPath(portal), { body: { email }, ip });
  assertMatchesOpenApi("POST", requestPath(portal), res);
  await on.app.backgroundIdle();
  return res;
}

async function verify(portal: "platform" | "tenant", email: string, code: string, ip: string, on: TestApi = api): Promise<ApiResponse> {
  const res = await on.call("POST", verifyPath(portal), { body: { email, code }, ip });
  assertMatchesOpenApi("POST", verifyPath(portal), res);
  await on.app.backgroundIdle();
  return res;
}

function latestCode(fake: FakeSmtp, email: string): string {
  const message = [...fake.messages].reverse().find((item) => item.to.includes(email));
  assert.ok(message, `${email} 没有收到邮件`);
  const text = decodedMailText(message.data);
  const code = /^(\d{6})$/m.exec(text)?.[1];
  assert.ok(code, "邮件里没有 6 位验证码");
  return code;
}

const wrongCode = (code: string): string => (code === "000000" ? "000001" : "000000");

const auditAfter = async (action: string, since: string): Promise<any[]> => (await api.db.owner.query("select tenant_id, resource_id, after from audit_logs where action = $1 and id > $2 order by id", [action, since])).rows;
const auditMark = async (): Promise<string> => String((await api.db.owner.query("select coalesce(max(id), 0) as id from audit_logs")).rows[0].id);

/** 建一个在用的平台员工（密码没人会用到）。 */
async function staff(email: string): Promise<void> {
  await createSuperAdmin(api.db.pool, { email, name: "员工", password: TEST_PASSWORD }, api.clock.now());
}

before(async () => {
  smtp = await startFakeSmtp();
  api = await createTestApi({ env: SMTP_ENV(smtp), integrationSecretsTtlMs: 0, mailer: new SmtpMailer({ allowLoopback: true, deadlineMs: 2_000 }) });
  root = await api.superAdminToken("root@platform.test");
});
after(async () => {
  await api.close();
  await smtp.close();
});
afterEach(() => {
  smtp.reset();
  smtp.behave({});
});

test("平台员工：邮件 → 验证码 → 待验证的会话，两步验证完成之前什么都做不了；两步验证完成后正常使用", async () => {
  const email = "code-flow@platform.test";
  await staff(email);
  const ip = nextIp();
  const sent = await requestCode("platform", email, ip);
  assert.deepEqual([sent.status, sent.body], [202, { expires_in_seconds: 600, resend_after_seconds: 60 }]);
  assert.equal(smtp.messages.length, 1);
  assert.deepEqual(smtp.messages[0]?.to, [email]);
  const text = decodedMailText(smtp.messages[0]?.data ?? "");
  assert.match(text, /运营后台/);
  assert.match(text, /10 分钟/);
  assert.match(text, /如果不是你本人操作，请忽略/);
  assert.doesNotMatch(text, /https?:\/\//, "邮件里没有链接");
  const code = latestCode(smtp, email);
  assert.ok(!(smtp.messages[0]?.data ?? "").split(/\r?\n\r?\n/)[0]?.includes(code), "邮件头（含主题）里没有验证码");

  const login = await verify("platform", email, code, ip);
  assert.equal(login.status, 200, login.text);
  assert.equal(login.body.second_factor.status, "enrollment_required");
  const token = login.body.access_token as string;
  const blocked = await api.call("GET", "/platform/v1/staff", { token, ip });
  assert.deepEqual([blocked.status, blocked.body.error.code], [403, "MFA_REQUIRED"]);

  const started = await api.call("POST", "/platform/v1/auth/mfa/enrollment", { token, ip, body: {} });
  assert.equal(started.status, 200, started.text);
  const secret = started.body.secret as string;
  const confirmed = await api.call("POST", "/platform/v1/auth/mfa/enrollment/confirm", { token, ip, body: { code: totpAt(secret, api.clock.now()) } });
  assert.equal(confirmed.status, 200, confirmed.text);
  assert.equal((await api.call("GET", "/platform/v1/staff", { token, ip })).status, 200);

  // 第二次：绑定过了，验证码通过后要输入动态码
  api.clock.advance(EMAIL_CODE_RESEND_INTERVAL_MS);
  await requestCode("platform", email, ip);
  const again = await verify("platform", email, latestCode(smtp, email), ip);
  assert.equal(again.body.second_factor.status, "verify_required");
  const blockedAgain = await api.call("GET", "/platform/v1/staff", { token: again.body.access_token, ip });
  assert.deepEqual([blockedAgain.status, blockedAgain.body.error.code], [403, "MFA_REQUIRED"]);
});

test("验证码邮件同时有纯文字版和 HTML 版（M6-06，ADR 0067）：纯文字一字不改；HTML 有品牌页眉，验证码大号显示，文字与纯文字版一致", async () => {
  const email = "code-html@platform.test";
  await staff(email);
  await requestCode("platform", email, nextIp());
  const data = smtp.messages[0]?.data ?? "";
  assert.match(data.split(/\r?\n\r?\n/)[0] ?? "", /^Content-Type: multipart\/alternative;/m);
  const code = latestCode(smtp, email);
  const text = decodedMailText(data).replace(/\r\n/g, "\n");
  assert.equal(text, emailCodeMail("platform", code).text, "纯文字版就是原来的正文");
  const html = decodedMailHtml(data) ?? "";
  assert.match(html, /<html lang="zh-Hans">/);
  assert.match(html, new RegExp(`class="nz-brand" bgcolor="${MAIL_LIGHT_COLORS["color-brand"]}"`));
  assert.match(html, /class="nz-wordmark"[^>]*>NOZOMI<\/span>/);
  assert.match(html, new RegExp(`<p class="nz-code"[^>]*>${code}</p>`));
  const visible = html.slice(html.indexOf("<body")).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  assert.equal(visible, `NOZOMI ${text.replace(/\s+/g, " ").trim()}`);
});

test("防枚举：存在、不存在、停用、待激活的邮箱，发码的应答完全一样；只有真实在用的账号收到信；校验也是同一个 401", async () => {
  const active = "enum-active@platform.test";
  const disabled = "enum-disabled@platform.test";
  const invited = "enum-invited@platform.test";
  await staff(active);
  await staff(disabled);
  await api.db.owner.query("update platform_users set status = 'disabled' where email = $1", [disabled]);
  assert.equal((await api.call("POST", "/platform/v1/staff", { token: root, body: { email: invited, name: "待激活", role: "operations" } })).status, 201);
  const emails = [active, disabled, invited, "enum-nobody@platform.test"];
  const responses = [];
  for (const email of emails) responses.push(await requestCode("platform", email, nextIp()));
  for (const res of responses) {
    assert.equal(res.status, 202);
    assert.equal(res.text, responses[0]?.text);
  }
  assert.deepEqual(smtp.messages.map((message) => message.to[0]), [active], "只有在用的账号收到信");
  const rows = (await api.db.owner.query("select count(*)::int as n from email_login_codes")).rows[0].n;
  assert.ok(rows >= emails.length, "不存在、停用、待激活的邮箱也写了一行，校验路径一样");

  const failures = [];
  for (const email of emails) failures.push(await verify("platform", email, wrongCode(email === active ? latestCode(smtp, active) : "111111"), nextIp()));
  failures.push(await verify("platform", "enum-never-asked@platform.test", "123456", nextIp()));
  for (const res of failures) {
    assert.deepEqual([res.status, res.body.error.code], [401, "EMAIL_CODE_INVALID"]);
    assert.equal(res.text, failures[0]?.text);
  }
});

test("发码的应答不等发信：邮件服务器不回话时，应答照样马上回来，发信失败不影响应答", async () => {
  const email = "slow-mail@platform.test";
  await staff(email);
  smtp.behave({ silent: true });
  const mark = await auditMark();
  const started = Date.now();
  const res = await api.call("POST", requestPath("platform"), { body: { email }, ip: nextIp() });
  const elapsed = Date.now() - started;
  assert.equal(res.status, 202);
  assert.ok(elapsed < 1_000, `应答用了 ${elapsed} 毫秒，不应该等发信（发信时限 2 秒）`);
  await api.app.backgroundIdle();
  const rows = await auditAfter("email_code_request", mark);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].after.outcome, "send_failed");
  assert.equal(rows[0].after.error, "TIMEOUT");
  assert.match(api.logs(), /email_code\.send_failed/);
});

test("有效期：10 分钟内可用，到点作废", async () => {
  const email = "ttl@platform.test";
  await staff(email);
  const ip = nextIp();
  await requestCode("platform", email, ip);
  const code = latestCode(smtp, email);
  api.clock.advance(EMAIL_CODE_TTL_MS);
  const expired = await verify("platform", email, code, ip);
  assert.deepEqual([expired.status, expired.body.error.code], [401, "EMAIL_CODE_INVALID"]);

  api.clock.advance(EMAIL_CODE_RESEND_INTERVAL_MS);
  await requestCode("platform", email, ip);
  api.clock.advance(EMAIL_CODE_TTL_MS - 1);
  assert.equal((await verify("platform", email, latestCode(smtp, email), ip)).status, 200);
});

test("单码 5 次：第 5 次还可以对，用尽后正确的码也作废，审计记 exhausted", async () => {
  const email = "attempts@platform.test";
  await staff(email);
  const ip = nextIp();
  await requestCode("platform", email, ip);
  const code = latestCode(smtp, email);
  for (let i = 0; i < 4; i++) assert.equal((await verify("platform", email, wrongCode(code), nextIp())).status, 401);
  assert.equal((await verify("platform", email, code, nextIp())).status, 200, "第 5 次");

  api.clock.advance(EMAIL_CODE_RESEND_INTERVAL_MS);
  await requestCode("platform", email, ip);
  const second = latestCode(smtp, email);
  const mark = await auditMark();
  for (let i = 0; i < 5; i++) assert.equal((await verify("platform", email, wrongCode(second), nextIp())).status, 401);
  const rows = await auditAfter("email_code_failed", mark);
  assert.deepEqual(rows.map((row) => row.after.reason), ["invalid", "invalid", "invalid", "invalid", "exhausted"]);
  assert.equal((await verify("platform", email, second, nextIp())).status, 401, "次数用尽后正确的码也不行");
});

test("发新码时旧码作废；用过的码不能再用", async () => {
  const email = "reissue@platform.test";
  await staff(email);
  const ip = nextIp();
  await requestCode("platform", email, ip);
  const first = latestCode(smtp, email);
  api.clock.advance(EMAIL_CODE_RESEND_INTERVAL_MS);
  await requestCode("platform", email, ip);
  const second = latestCode(smtp, email);
  if (first !== second) assert.equal((await verify("platform", email, first, nextIp())).status, 401, "旧码作废");
  assert.equal((await verify("platform", email, second, nextIp())).status, 200);
  assert.equal((await verify("platform", email, second, nextIp())).status, 401, "用过即作废");
});

test("并发：同一个码同时提交 5 次，只有一个成功；数据库里只多一个会话", async () => {
  const email = "race@platform.test";
  await staff(email);
  const ip = nextIp();
  await requestCode("platform", email, ip);
  const code = latestCode(smtp, email);
  const results = await Promise.all(Array.from({ length: 5 }, () => api.call("POST", verifyPath("platform"), { body: { email, code }, ip: nextIp() })));
  assert.deepEqual(results.map((res) => res.status).sort(), [200, 401, 401, 401, 401]);
  const sessions = (await api.db.owner.query("select count(*)::int as n from platform_sessions s join platform_users u on u.id = s.user_id where u.email = $1", [email])).rows[0].n;
  assert.equal(sessions, 1);
  await api.app.backgroundIdle();
});

test("并发：错码同时提交 12 次，码的计数不超过 5（数据库保证），之后正确的码也不行", async () => {
  const email = "race-wrong@platform.test";
  await staff(email);
  await requestCode("platform", email, nextIp());
  const code = latestCode(smtp, email);
  const results = await Promise.all(Array.from({ length: 12 }, () => api.call("POST", verifyPath("platform"), { body: { email, code: wrongCode(code) }, ip: nextIp() })));
  assert.ok(results.every((res) => res.status === 401));
  await api.app.backgroundIdle();
  assert.equal((await verify("platform", email, code, nextIp())).status, 401);
  const counts = (await api.db.owner.query("select attempt_count from email_login_codes where attempt_count = 5")).rows.length;
  assert.ok(counts >= 1, "计数停在 5");
});

test("数据库约束：次数不能超过 5，哈希只能是 64 位十六进制", async () => {
  const insert = (values: unknown[]) => api.db.owner.query("insert into email_login_codes (email_key, code_hash, attempt_count, created_at, expires_at) values ($1, $2, $3, now(), now() + interval '1 minute')", values);
  const hex = "a".repeat(64);
  await assert.rejects(insert([hex, hex, 6]), /email_login_codes_attempts/);
  await assert.rejects(insert([hex, "123456", 0]), /email_login_codes_code_hash_hex/);
  await assert.rejects(insert(["someone@example.test", hex, 0]), /email_login_codes_email_key_hex/);
});

test("库里没有验证码和邮箱原文；审计和日志里没有验证码和完整邮箱", async () => {
  const email = "secret-check@platform.test";
  await staff(email);
  const ip = nextIp();
  const mark = await auditMark();
  await requestCode("platform", email, ip);
  const code = latestCode(smtp, email);
  const rows = (await api.db.owner.query("select * from email_login_codes")).rows;
  assert.ok(!JSON.stringify(rows).includes(email));
  for (const row of rows) assert.notEqual(row.code_hash, code);
  await verify("platform", email, wrongCode(code), ip);
  assert.equal((await verify("platform", email, code, ip)).status, 200);
  const audits = (await api.db.owner.query("select actor_email, after, before from audit_logs where id > $1 and action in ('email_code_request', 'email_code_failed')", [mark])).rows;
  assert.equal(audits.length, 2);
  const auditText = JSON.stringify(audits);
  assert.ok(!auditText.includes(email));
  assert.ok(!auditText.includes(code));
  assert.ok(auditText.includes("s***@platform.test"));
  const login = (await api.db.owner.query("select after from audit_logs where id > $1 and action = 'login' and resource = 'platform_user'", [mark])).rows;
  assert.deepEqual(login.map((row) => row.after), [{ method: "email_code" }]);
  assert.doesNotMatch(api.logs(), new RegExp(`"${code}"`), "日志里没有验证码");
  assert.ok(!api.logs().includes(email), "日志里没有完整邮箱");
});

test("发码限速：60 秒 1 封；15 分钟 5 封；不存在的邮箱表现一样；被拦下的不发信，日志只记阶段", async () => {
  for (const email of ["limit-real@platform.test", "limit-nobody@platform.test"]) {
    if (email.includes("real")) await staff(email);
    const ip = nextIp();
    assert.equal((await requestCode("platform", email, ip)).status, 202);
    const cooldown = await requestCode("platform", email, ip);
    assert.deepEqual([cooldown.status, cooldown.body.error.code], [429, "TOO_MANY_LOGIN_ATTEMPTS"]);
    assert.ok(Number(cooldown.headers["retry-after"]) <= 60);
    for (let i = 0; i < 4; i++) {
      api.clock.advance(EMAIL_CODE_RESEND_INTERVAL_MS);
      assert.equal((await requestCode("platform", email, nextIp())).status, 202, `第 ${i + 2} 封`);
    }
    api.clock.advance(EMAIL_CODE_RESEND_INTERVAL_MS);
    const fifteen = await requestCode("platform", email, nextIp());
    assert.equal(fifteen.status, 429, "15 分钟第 6 封");
    assert.ok(Number(fifteen.headers["retry-after"]) > 60);
    api.clock.advance(15 * 60 * 1000);
  }
  assert.equal(smtp.messages.length, 5, "只有真实账号的 5 封");
  assert.match(api.logs(), /email_code\.rate_limited/);
});

test("发码限速：24 小时 20 封；登录成功后 24 小时计数不清零（否则攻击期间本人每登录一次，攻击者就多一轮额度），15 分钟计数清零", async () => {
  const email = "daily@platform.test";
  await staff(email);
  const send = async (): Promise<number> => (await requestCode("platform", email, nextIp())).status;
  const started = api.clock.now().getTime();

  // 15 分钟的 5 封用完，再请求被拦
  for (let i = 0; i < 5; i++) {
    assert.equal(await send(), 202, `第 ${i + 1} 封`);
    api.clock.advance(EMAIL_CODE_RESEND_INTERVAL_MS);
  }
  assert.equal(await send(), 429, "15 分钟第 6 封");

  // 登录成功：15 分钟的额度回来了，但 24 小时已经用掉的 5 封还算
  assert.equal((await verify("platform", email, latestCode(smtp, email), nextIp())).status, 200);
  let sent = 5;
  while (sent < 20) {
    api.clock.advance(4 * 60 * 1000);
    assert.equal(await send(), 202, `第 ${sent + 1} 封`);
    sent += 1;
    if (sent === 10) assert.equal((await verify("platform", email, latestCode(smtp, email), nextIp())).status, 200, "中途再登录一次");
  }
  api.clock.advance(4 * 60 * 1000);
  const blocked = await requestCode("platform", email, nextIp());
  assert.equal(blocked.status, 429, "一天第 21 封，两次登录成功都没有清零");
  assert.ok(Number(blocked.headers["retry-after"]) > 15 * 60, "等到 24 小时窗口结束");

  assert.equal((await verify("platform", email, latestCode(smtp, email), nextIp())).status, 200, "第 20 封的码还能用");
  api.clock.advance(4 * 60 * 1000);
  assert.equal((await requestCode("platform", email, nextIp())).status, 429, "刚登录成功也不行");

  api.clock.advance(24 * 60 * 60 * 1000 - (api.clock.now().getTime() - started));
  assert.equal(await send(), 202, "窗口结束后恢复");
  // 时钟走过了 24 小时，超级管理员的令牌（8 小时）已过期：后面的用例还要用
  root = (await api.platformLogin({ body: { email: "root@platform.test", password: TEST_PASSWORD } })).body.access_token as string;
});

test("发码限速：同一来源地址 15 分钟 20 封，不分邮箱；被拦下的不占邮箱的额度", async () => {
  const ip = "203.0.113.200";
  for (let i = 0; i < 20; i++) assert.equal((await requestCode("platform", `ip-limit-${i}@platform.test`, ip)).status, 202);
  const blocked = await requestCode("platform", "ip-limit-victim@platform.test", ip);
  assert.equal(blocked.status, 429);
  assert.equal((await requestCode("platform", "ip-limit-victim@platform.test", nextIp())).status, 202, "冷却计数没有被占用");
});

test("校验限速：同一邮箱 + 地址 15 分钟 5 次，同一邮箱 20 次；和密码登录的计数互不影响；不存在的邮箱一样", async () => {
  const email = "verify-limit@platform.test";
  await staff(email);
  const ip = nextIp();
  for (let i = 0; i < 5; i++) assert.equal((await verify("platform", email, "000000", ip)).status, 401);
  const blocked = await verify("platform", email, "000000", ip);
  assert.deepEqual([blocked.status, blocked.body.error.code], [429, "TOO_MANY_LOGIN_ATTEMPTS"]);
  assert.equal((await api.platformLogin({ body: { email, password: TEST_PASSWORD }, ip })).status, 200, "密码登录不受影响");

  const nobody = "verify-limit-nobody@platform.test";
  const nobodyIp = nextIp();
  for (let i = 0; i < 5; i++) assert.equal((await verify("platform", nobody, "000000", nobodyIp)).status, 401);
  assert.equal((await verify("platform", nobody, "000000", nobodyIp)).status, 429);
  for (let i = 0; i < 14; i++) assert.equal((await verify("platform", nobody, "000000", nextIp())).status, 401);
  assert.equal((await verify("platform", nobody, "000000", nextIp())).status, 429, "同一邮箱第 21 次");
});

test("验证码格式不对：400，不占码的次数", async () => {
  const email = "format@platform.test";
  await staff(email);
  const ip = nextIp();
  await requestCode("platform", email, ip);
  for (const code of ["12345", "1234567", "abcdef", ""]) {
    const res = await api.call("POST", verifyPath("platform"), { body: { email, code }, ip });
    assert.equal(res.status, 400, code);
  }
  assert.equal((await verify("platform", email, ` ${latestCode(smtp, email)} `, ip)).status, 200, "首尾空格去掉");
});

test("IP 白名单照常生效：验证码对了但地址不在名单里 403，不建会话，审计记原因；验证码消耗掉；名单里的地址才能登录", async () => {
  const email = "allow@platform.test";
  await staff(email);
  await api.db.owner.query("update platform_users set ip_allowlist = $1 where email = $2", [["203.0.113.50"], email]);
  const outside = nextIp();
  await requestCode("platform", email, outside);
  const code = latestCode(smtp, email);
  const mark = await auditMark();
  const denied = await verify("platform", email, code, outside);
  assert.deepEqual([denied.status, denied.body.error.code], [403, "IP_NOT_ALLOWED"]);
  assert.ok(!denied.text.includes("access_token"));
  const rows = await auditAfter("login_failed", mark);
  assert.deepEqual(rows.map((row) => [row.after.reason, row.after.method, row.after.email]), [["ip_not_allowed", "email_code", "a***@platform.test"]]);
  assert.equal((await verify("platform", email, code, "203.0.113.50")).status, 401, "已消耗");

  api.clock.advance(EMAIL_CODE_RESEND_INTERVAL_MS);
  await requestCode("platform", email, outside);
  const inside = await verify("platform", email, latestCode(smtp, email), "203.0.113.50");
  assert.equal(inside.status, 200);
  const other = await api.call("GET", "/platform/v1/auth/me", { token: inside.body.access_token, ip: outside });
  assert.deepEqual([other.status, other.body.error.code], [403, "IP_NOT_ALLOWED"], "之后每个请求也检查");
});

test("账号在发码之后被停用：验证码对了也不建会话，403 ACCOUNT_DISABLED；重新启用也不复活这个码", async () => {
  const email = "disabled-later@platform.test";
  await staff(email);
  const ip = nextIp();
  await requestCode("platform", email, ip);
  const code = latestCode(smtp, email);
  await api.db.owner.query("update platform_users set status = 'disabled' where email = $1", [email]);
  const res = await verify("platform", email, code, ip);
  assert.deepEqual([res.status, res.body.error.code], [403, "ACCOUNT_DISABLED"]);
  await api.db.owner.query("update platform_users set status = 'active' where email = $1", [email]);
  assert.equal((await verify("platform", email, code, ip)).status, 401);
});

test("必须先修改密码：验证码登录后仍然被拦到改密码", async () => {
  const tenant = await api.tenantWithAdmin(root, "改密车队", "must-change@fleet.test");
  await api.db.owner.query("update tenant_users set must_change_password = true where id = $1", [tenant.adminId]);
  const ip = nextIp();
  await requestCode("tenant", tenant.adminEmail, ip);
  const login = await verify("tenant", tenant.adminEmail, latestCode(smtp, tenant.adminEmail), ip);
  assert.equal(login.status, 200, login.text);
  assert.equal(login.body.must_change_password, true);
  const blocked = await api.call("GET", "/tenant/v1/users", { token: login.body.access_token });
  assert.deepEqual([blocked.status, blocked.body.error.code], [403, "PASSWORD_CHANGE_REQUIRED"]);
});

test("租户员工：验证码登录拿到正常会话；暂停的租户照常能登录；邮件写的是供应商后台", async () => {
  const tenant = await api.tenantWithAdmin(root, "验证码车队", "code-admin@fleet.test");
  const ip = nextIp();
  await requestCode("tenant", tenant.adminEmail, ip);
  assert.match(decodedMailText(smtp.messages[0]?.data ?? ""), /供应商后台/);
  const login = await verify("tenant", tenant.adminEmail, latestCode(smtp, tenant.adminEmail), ip);
  assert.equal(login.status, 200, login.text);
  assert.equal(login.body.tenant.id, tenant.tenantId);
  assert.equal((await api.call("GET", "/tenant/v1/users", { token: login.body.access_token })).status, 200);

  await api.db.owner.query("update tenants set status = 'suspended', suspended_from = 'active', suspended_at = $2, suspension_reasons = array['manual'] where id = $1", [tenant.tenantId, api.clock.now()]);
  api.clock.advance(EMAIL_CODE_RESEND_INTERVAL_MS);
  await requestCode("tenant", tenant.adminEmail, ip);
  const suspended = await verify("tenant", tenant.adminEmail, latestCode(smtp, tenant.adminEmail), ip);
  assert.equal(suspended.status, 200);
  assert.equal(suspended.body.tenant.status, "suspended");
});

test("跨租户：A 的验证码换不来 B 的账号；A 的令牌读不到、改不了 B；请求里塞 tenant_id 没有用；审计归到各自的租户", async () => {
  const a = await api.tenantWithAdmin(root, "甲车队", "cross-a@fleet.test");
  const b = await api.tenantWithAdmin(root, "乙车队", "cross-b@fleet.test");
  const ip = nextIp();
  const mark = await auditMark();
  await api.call("POST", requestPath("tenant"), { body: { email: a.adminEmail, tenant_id: b.tenantId }, ip });
  await api.app.backgroundIdle();
  assert.deepEqual(smtp.messages.map((message) => message.to[0]), [a.adminEmail]);
  const codeA = latestCode(smtp, a.adminEmail);
  const wrongPerson = await verify("tenant", b.adminEmail, codeA, nextIp());
  assert.equal(wrongPerson.status, 401, "A 的验证码不能登录 B");
  const login = await api.call("POST", verifyPath("tenant"), { body: { email: a.adminEmail, code: codeA, tenant_id: b.tenantId }, ip });
  assert.equal(login.status, 200, login.text);
  assert.equal(login.body.tenant.id, a.tenantId, "租户只来自账号");
  const token = login.body.access_token as string;
  const users = await api.call("GET", "/tenant/v1/users", { token });
  assert.ok(users.body.items.every((user: any) => user.tenant_id === undefined || user.tenant_id === a.tenantId));
  assert.ok(!users.text.includes(b.adminEmail), "读不到 B");
  const patched = await api.call("PATCH", `/tenant/v1/users/${b.adminId}`, { token, body: { name: "改掉", role: "admin", status: "active" } });
  assert.equal(patched.status, 404, "改不了 B");
  await api.app.backgroundIdle();
  const rows = await auditAfter("email_code_request", mark);
  assert.deepEqual(rows.map((row) => row.tenant_id), [a.tenantId]);
  const failed = await auditAfter("email_code_failed", mark);
  assert.deepEqual(failed.map((row) => row.tenant_id), [b.tenantId], "失败记在被尝试的账号所在的租户");

  const seenByB = await api.call("GET", "/tenant/v1/audit-logs?action=email_code_failed", { token: b.adminToken });
  assert.equal(seenByB.status, 200, seenByB.text);
  assert.equal(seenByB.body.items.length, 1, "B 的管理员看得到针对本租户账号的失败");
  const seenByA = await api.call("GET", "/tenant/v1/audit-logs?action=email_code_failed", { token });
  assert.equal(seenByA.body.items.length, 0, "A 看不到 B 的");
});

test("平台和租户的验证码互不相通：同一个邮箱两边各有账号", async () => {
  const email = "both-sides@example.test";
  await staff(email);
  const tenant = await api.tenantWithAdmin(root, "两边车队", email);
  const ip = nextIp();
  await requestCode("platform", email, ip);
  const platformCode = latestCode(smtp, email);
  assert.equal((await verify("tenant", email, platformCode, nextIp())).status, 401);
  assert.equal(tenant.adminEmail, email);
  assert.equal((await verify("platform", email, platformCode, nextIp())).status, 200);
});

test("平台令牌和租户令牌不通用：验证码登录拿到的租户令牌访问运营后台 401", async () => {
  const tenant = await api.tenantWithAdmin(root, "令牌车队", "token-cross@fleet.test");
  const ip = nextIp();
  await requestCode("tenant", tenant.adminEmail, ip);
  const login = await verify("tenant", tenant.adminEmail, latestCode(smtp, tenant.adminEmail), ip);
  assert.equal((await api.call("GET", "/platform/v1/auth/me", { token: login.body.access_token })).status, 401);
});

test("没有配置邮件：登录方式只有密码，发码 503（和邮箱无关），密码登录照常，什么都没写；PASSWORD_LOGIN_DISABLED=true 也不会锁人", async () => {
  const noMail = await createTestApi({ env: NO_SMTP, integrationSecretsTtlMs: 0 });
  const closedNoMail = await createTestApi({ env: { ...NO_SMTP, PASSWORD_LOGIN_DISABLED: "true" }, integrationSecretsTtlMs: 0 });
  try {
    for (const on of [noMail, closedNoMail]) {
      for (const portal of ["platform", "tenant"] as const) {
        const methods = await on.call("GET", `/${portal}/v1/auth/login-methods`);
        assert.deepEqual(methods.body, { email_code: false, password: true });
        assertMatchesOpenApi("GET", `/${portal}/v1/auth/login-methods`, methods);
        for (const email of ["root@platform.test", "nobody@platform.test"]) {
          const res = await requestCode(portal, email, nextIp(), on);
          assert.deepEqual([res.status, res.body.error.code], [503, "EMAIL_CODE_UNAVAILABLE"]);
        }
      }
      const token = await on.superAdminToken("root@platform.test");
      assert.equal((await on.call("GET", "/platform/v1/staff", { token })).status, 200, "密码 + 两步验证照常");
      const tenant = await on.tenantWithAdmin(token, "无邮件车队", "no-mail@fleet.test");
      assert.equal((await on.call("GET", "/tenant/v1/users", { token: tenant.adminToken })).status, 200);
      assert.equal((await on.db.owner.query("select count(*)::int as n from email_login_codes")).rows[0].n, 0);
    }
  } finally {
    await noMail.close();
    await closedNoMail.close();
  }
});

test("邮件可用但没要求关闭：两种方式都可用，这是上线后的默认状态", async () => {
  for (const portal of ["platform", "tenant"] as const) {
    assert.deepEqual((await api.call("GET", `/${portal}/v1/auth/login-methods`)).body, { email_code: true, password: true });
  }
  assert.equal((await api.platformLogin({ body: { email: "root@platform.test", password: TEST_PASSWORD } })).status, 200);
});

test("明确关闭 + 邮件可用：密码登录 403（和邮箱无关、不做哈希、不占计数），验证码可用；清掉 SMTP 后密码马上恢复，不用重启", async () => {
  const closed = await createTestApi({ env: { ...NO_SMTP, PASSWORD_LOGIN_DISABLED: "true" }, integrationSecretsTtlMs: 0, mailer: new SmtpMailer({ allowLoopback: true, deadlineMs: 2_000 }) });
  try {
    const root2 = await closed.superAdminToken("closed-root@platform.test");
    const tenant = await closed.tenantWithAdmin(root2, "关闭车队", "closed@fleet.test");
    const saved = await closed.call("PUT", "/platform/v1/integration-secrets/email", { token: root2, body: { host: smtp.host, port: smtp.port, encryption: "none", username: "mailer@example.test", password: "fake-smtp-password-only-for-tests", from_name: "NOZOMI", from_address: "noreply@example.test" } });
    assert.equal(saved.status, 200, saved.text);
    assert.deepEqual((await closed.call("GET", "/platform/v1/auth/login-methods")).body, { email_code: true, password: false });

    await closed.db.owner.query("delete from login_throttles");
    for (const [path, email] of [["/platform/v1/auth/login", "closed-root@platform.test"], ["/platform/v1/auth/login", "nobody@platform.test"], ["/tenant/v1/auth/login", tenant.adminEmail]] as const) {
      const res = await closed.call("POST", path, { body: { email, password: TEST_PASSWORD } });
      assert.deepEqual([res.status, res.body.error.code], [403, "PASSWORD_LOGIN_DISABLED"], `${path} ${email}`);
    }
    assert.equal((await closed.db.owner.query("select count(*)::int as n from login_throttles")).rows[0].n, 0);

    const ip = nextIp();
    assert.equal((await requestCode("tenant", tenant.adminEmail, ip, closed)).status, 202);
    assert.equal((await verify("tenant", tenant.adminEmail, latestCode(smtp, tenant.adminEmail), ip, closed)).status, 200);

    assert.equal((await closed.call("DELETE", "/platform/v1/integration-secrets/email", { token: root2 })).status, 200);
    assert.deepEqual((await closed.call("GET", "/tenant/v1/auth/login-methods")).body, { email_code: false, password: true });
    assert.equal((await closed.call("POST", "/tenant/v1/auth/login", { body: { email: tenant.adminEmail, password: TEST_PASSWORD } })).status, 200);
  } finally {
    await closed.close();
  }
});

test("应急命令依赖的数据不变：验证码登录不改密码、不改两步验证绑定", async () => {
  const email = "untouched@platform.test";
  await staff(email);
  const before = (await api.db.owner.query("select password_hash, totp_secret, must_change_password from platform_users where email = $1", [email])).rows[0];
  const ip = nextIp();
  await requestCode("platform", email, ip);
  assert.equal((await verify("platform", email, latestCode(smtp, email), ip)).status, 200);
  assert.deepEqual((await api.db.owner.query("select password_hash, totp_secret, must_change_password from platform_users where email = $1", [email])).rows[0], before);
});
