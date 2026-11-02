/**
 * QA（M4-06，ADR 0050）：邮箱验证码的防枚举、存储和日志、不锁人、数据库权限。开发的 email-login.itest.ts 没有覆盖的部分。
 * 连真实的 PostgreSQL 和本机假 SMTP，账号都是测试里现场构造的虚构值。
 */
import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac, hkdfSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { EMAIL_CODE_RESEND_INTERVAL_MS, EMAIL_CODE_TTL_MS } from "@nozomi/domain";
import { SmtpMailer } from "./integrations/smtp.ts";
import { createSuperAdmin } from "./services/platform-staff.ts";
import { type ApiResponse, TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";
import { type FakeSmtp, decodedMailText, startFakeSmtp } from "./testing/fake-integrations.ts";
import { FAKE_SECRETS } from "./testing/fixtures.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";

type Portal = "platform" | "tenant";

const SMTP_ENV = (fake: FakeSmtp): Record<string, string> => ({ SMTP_HOST: fake.host, SMTP_PORT: String(fake.port), SMTP_ENCRYPTION: "none", SMTP_USERNAME: "qa-mailer@example.test", SMTP_PASSWORD: "qa-fake-smtp-password", SMTP_FROM_NAME: "NOZOMI", SMTP_FROM_ADDRESS: "noreply@example.test" });
const NO_SMTP = { SMTP_HOST: "", SMTP_PORT: "", SMTP_ENCRYPTION: "", SMTP_USERNAME: "", SMTP_PASSWORD: "", SMTP_FROM_NAME: "", SMTP_FROM_ADDRESS: "" };
const fastMailer = (): SmtpMailer => new SmtpMailer({ allowLoopback: true, deadlineMs: 500 });
const savedSmtpBody = (fake: FakeSmtp): object => ({ host: fake.host, port: fake.port, encryption: "none", username: "qa-mailer@example.test", password: "qa-fake-smtp-password", from_name: "NOZOMI", from_address: "noreply@example.test" });

let smtp: FakeSmtp;
let api: TestApi;
let root: string;
let ipCounter = 0;
const nextIp = (): string => `198.18.${(++ipCounter >> 8) & 255}.${ipCounter & 255}`;

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

const wrongCode = (code: string): string => (code === "000000" ? "000001" : "000000");
const staff = (email: string, on: TestApi = api): Promise<unknown> => createSuperAdmin(on.db.pool, { email, name: "员工", password: TEST_PASSWORD }, on.clock.now());

/** 除了每次都不同的（时间、请求编号），应答头必须逐项相同。 */
function comparable(res: ApiResponse): { status: number; text: string; headers: Record<string, unknown> } {
  const { date: _date, "x-request-id": _requestId, ...headers } = res.headers;
  return { status: res.status, text: res.text, headers };
}

interface Accounts {
  active: string;
  disabled: string;
  invited: string;
  nobody: string;
}

/** 每个入口造四种邮箱：在用、停用、待激活、没有。`tag` 让同一入口多个用例不共用邮箱。 */
async function accounts(portal: Portal, tag: string): Promise<Accounts> {
  const at = portal === "platform" ? "platform.test" : "fleet.test";
  const made = { active: `qa-${tag}-active@${at}`, disabled: `qa-${tag}-disabled@${at}`, invited: `qa-${tag}-invited@${at}`, nobody: `qa-${tag}-nobody@${at}` };
  if (portal === "platform") {
    await staff(made.active);
    await staff(made.disabled);
    await api.db.owner.query("update platform_users set status = 'disabled' where email = $1", [made.disabled]);
    const res = await api.call("POST", "/platform/v1/staff", { token: root, body: { email: made.invited, name: "待激活", role: "operations" } });
    assert.equal(res.status, 201, res.text);
  } else {
    const tenant = await api.tenantWithAdmin(root, `QA ${tag} 车队`, made.active);
    for (const email of [made.disabled, made.invited]) {
      const res = await api.call("POST", "/tenant/v1/users", { token: tenant.adminToken, body: { email, name: "员工", role: "readonly" } });
      assert.equal(res.status, 201, res.text);
      if (email === made.disabled) {
        const accepted = await api.call("POST", "/tenant/v1/auth/accept-invite", { body: { token: res.body.invite.token, password: TEST_PASSWORD } });
        assert.equal(accepted.status, 200, accepted.text);
      }
    }
    await api.db.owner.query("update tenant_users set status = 'disabled' where email = $1", [made.disabled]);
  }
  smtp.reset();
  return made;
}

before(async () => {
  smtp = await startFakeSmtp();
  api = await createTestApi({ env: SMTP_ENV(smtp), integrationSecretsTtlMs: 0, mailer: fastMailer() });
  root = await api.superAdminToken("qa-exposure-root@platform.test");
});
after(async () => {
  await api.close();
  await smtp.close();
});
afterEach(() => {
  smtp.reset();
  smtp.behave({});
});

for (const portal of ["platform", "tenant"] as const) {
  test(`防枚举（${portal}）：四种邮箱发码、校验、限速命中的应答连同应答头都一样；只有在用的账号收到信；后台任务没有出错`, async () => {
    const who = await accounts(portal, `enum-${portal}`);
    const emails = [who.active, who.disabled, who.invited, who.nobody];
    const sent: ApiResponse[] = [];
    for (const email of emails) sent.push(await requestCode(portal, email));
    for (const res of sent) assert.deepEqual(comparable(res), comparable(sent[0] as ApiResponse));
    assert.equal(sent[0]?.status, 202);
    assert.deepEqual(smtp.messages.map((message) => message.to[0]), [who.active]);

    const code = latestCode(who.active);
    const wrong: ApiResponse[] = [];
    for (const email of emails) wrong.push(await verify(portal, email, wrongCode(code)));
    for (const res of wrong) assert.deepEqual(comparable(res), comparable(wrong[0] as ApiResponse));
    assert.deepEqual([wrong[0]?.status, wrong[0]?.body.error.code], [401, "EMAIL_CODE_INVALID"]);

    const cooled: ApiResponse[] = [];
    for (const email of emails) cooled.push(await requestCode(portal, email));
    for (const res of cooled) {
      assert.equal(res.status, 429);
      assert.equal(res.body.error.code, "TOO_MANY_LOGIN_ATTEMPTS");
      assert.deepEqual(Object.keys(res.headers).sort(), Object.keys(cooled[0]?.headers ?? {}).sort());
      assert.equal(res.headers["retry-after"], cooled[0]?.headers["retry-after"]);
      assert.equal(res.text, cooled[0]?.text);
    }

    const throttleIp = nextIp();
    const blocked: ApiResponse[] = [];
    for (const email of emails) {
      for (let i = 0; i < 5; i++) assert.equal((await verify(portal, email, "000000", throttleIp)).status, 401, `${email} 第 ${i + 1} 次`);
      blocked.push(await verify(portal, email, "000000", throttleIp));
    }
    for (const res of blocked) {
      assert.equal(res.status, 429);
      assert.equal(res.text, blocked[0]?.text);
    }
    assert.doesNotMatch(api.logs(), /email_code\.task_failed/, "每种邮箱的后台任务都走得通");
  });
}

test("防枚举：发信失败的每一种方式（认证错、拒收、连上就断、不回话），应答都和不存在的邮箱一样，审计才看得出来", async () => {
  const email = "qa-enum-fail@platform.test";
  await staff(email);
  const baseline = await requestCode("platform", "qa-enum-fail-nobody@platform.test");
  for (const [behavior, expected] of [
    [{ rejectAuth: true }, "AUTH_FAILED"],
    [{ rejectRecipient: true }, "RECIPIENT_REJECTED"],
    [{ dropOnConnect: true }, "UNREACHABLE"],
    [{ silent: true }, "TIMEOUT"],
  ] as const) {
    smtp.behave(behavior);
    const mark = (await api.db.owner.query("select coalesce(max(id), 0) as id from audit_logs")).rows[0].id;
    api.clock.advance(EMAIL_CODE_RESEND_INTERVAL_MS);
    const res = await requestCode("platform", email);
    assert.deepEqual(comparable(res), comparable(baseline), JSON.stringify(behavior));
    const rows = (await api.db.owner.query("select after from audit_logs where action = 'email_code_request' and id > $1", [mark])).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].after.outcome, "send_failed");
    assert.equal(rows[0].after.error, expected);
  }
});

test("防枚举：校验错误不说账号状态，文案和错误码里没有停用、不存在、未激活、次数", async () => {
  const who = await accounts("platform", "enum-words");
  const answers: ApiResponse[] = [];
  for (const email of [who.disabled, who.invited, who.nobody]) {
    await requestCode("platform", email);
    answers.push(await verify("platform", email, "123456"));
  }
  for (const res of answers) {
    assert.doesNotMatch(res.text, /停用|不存在|未激活|待激活|disabled|invited|not_found|剩余|次数/i, res.text);
    assert.deepEqual(Object.keys(res.body.error).sort(), Object.keys(answers[0]?.body.error).sort());
  }
});

test("存储：code_hash 和 email_key 是用 AUTH_JWT_SECRET 派生的 HMAC，不是裸 SHA-256；换一个密钥算不出来；邮箱和验证码原文都不在表里", async () => {
  const email = "qa-hmac@platform.test";
  await staff(email);
  await requestCode("platform", email);
  const code = latestCode(email);
  const derive = (secret: string): Buffer => Buffer.from(hkdfSync("sha256", secret, Buffer.alloc(0), "nozomi/email-login-code/v1", 32));
  const hmac = (secret: string, ...parts: string[]): string => createHmac("sha256", derive(secret)).update(parts.join("\n"), "utf8").digest("hex");
  const emailKey = hmac(FAKE_SECRETS.authJwtSecret, "email", "platform", email);
  const row = (await api.db.owner.query("select * from email_login_codes where email_key = $1", [emailKey])).rows[0];
  assert.ok(row, "email_key 是配置里的密钥派生的");
  assert.equal(row.code_hash, hmac(FAKE_SECRETS.authJwtSecret, "code", "platform", email, code));
  assert.notEqual(row.code_hash, hmac("another-secret-for-this-test-only-0123456789", "code", "platform", email, code));
  assert.notEqual(row.code_hash, createHash("sha256").update(code).digest("hex"));
  assert.notEqual(row.code_hash, createHash("sha256").update(`${email}\n${code}`).digest("hex"));
  assert.deepEqual(Object.keys(row).sort(), ["attempt_count", "code_hash", "created_at", "email_key", "expires_at"]);
  const dump = JSON.stringify(row);
  assert.ok(!dump.includes(email));
  assert.ok(!dump.includes(code));
});

test("存储：发码的限速表里也没有邮箱和地址原文", async () => {
  const email = "qa-throttle-dump@platform.test";
  const ip = "203.0.113.201";
  await requestCode("platform", email, ip);
  await verify("platform", email, "123456", ip);
  const dump = JSON.stringify((await api.db.owner.query("select key from login_throttles")).rows);
  assert.ok(!dump.includes(email));
  assert.ok(!dump.includes(ip));
});

test("配置：验证码的两个文件不直接读环境变量，密钥只来自 packages/config", async () => {
  for (const file of ["./services/email-login.ts", "./repos/email-login-codes.ts"]) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /process\.env|AUTH_JWT_SECRET\s*[=:]/, file);
  }
});

test("日志和审计：验证码、完整邮箱不出现；邮件服务器的回话里带着地址也不会被抄进日志和审计", async () => {
  const email = "qa-log-scan@platform.test";
  await staff(email);
  const logsBefore = api.logs().length;
  const mark = (await api.db.owner.query("select coalesce(max(id), 0) as id from audit_logs")).rows[0].id;
  smtp.behave({ rejectRecipient: true, errorDetail: `<${email}> mailbox qa-secret-detail` });
  await requestCode("platform", email);
  smtp.behave({});
  api.clock.advance(EMAIL_CODE_RESEND_INTERVAL_MS);
  await requestCode("platform", email);
  const code = latestCode(email);
  await verify("platform", email, wrongCode(code));
  assert.equal((await verify("platform", email, code)).status, 200);
  api.clock.advance(EMAIL_CODE_RESEND_INTERVAL_MS);
  await requestCode("platform", email);
  await requestCode("platform", email);

  const lines = api.logs().slice(logsBefore).split("\n").filter(Boolean).map((line) => {
    const { responseTime: _responseTime, time: _time, ...rest } = JSON.parse(line) as Record<string, unknown>;
    return JSON.stringify(rest);
  });
  const logs = lines.join("\n");
  assert.ok(logs.length > 0);
  assert.ok(!logs.includes(email), "日志里有完整邮箱");
  assert.ok(!logs.includes("qa-secret-detail"), "邮件服务器回的原话进了日志");
  assert.doesNotMatch(logs, new RegExp(`(?<![\\d.])${code}(?![\\d.])`), "日志里有验证码");

  const audits = (await api.db.owner.query("select action, actor_email, before, after, ip from audit_logs where id > $1 and action in ('email_code_request', 'email_code_failed', 'login_failed')", [mark])).rows;
  assert.ok(audits.length >= 3);
  const auditDump = JSON.stringify(audits);
  assert.ok(!auditDump.includes(email), "审计里有完整邮箱");
  assert.ok(!auditDump.includes("qa-secret-detail"), "审计里有邮件服务器的原话");
  assert.ok(!auditDump.includes(code), "审计里有验证码");
});

test("限速命中不写审计（ADR 第 7 节），日志只有入口和阶段，别人刷不满审计表", async () => {
  const email = "qa-no-audit-flood@platform.test";
  const ip = nextIp();
  await requestCode("platform", email, ip);
  const mark = (await api.db.owner.query("select coalesce(max(id), 0) as id from audit_logs")).rows[0].id;
  const logsBefore = api.logs().length;
  for (let i = 0; i < 5; i++) assert.equal((await requestCode("platform", email, ip)).status, 429);
  await api.app.backgroundIdle();
  assert.equal((await api.db.owner.query("select count(*)::int as n from audit_logs where id > $1", [mark])).rows[0].n, 0);
  const warned = api.logs().slice(logsBefore).split("\n").filter((line) => line.includes("email_code.rate_limited"));
  assert.equal(warned.length, 5);
  for (const line of warned) {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    assert.equal(parsed["stage"], "send");
    assert.equal(parsed["portal"], "platform");
    assert.ok(!line.includes(email));
  }
});

test("错误信息：格式错的邮箱和验证码，应答和日志都不回显提交的内容", async () => {
  const logsBefore = api.logs().length;
  const badEmail = "qa-echo-bad-email-at-nowhere";
  const badCode = "99x99";
  const first = await api.call("POST", "/platform/v1/auth/email-code/request", { body: { email: badEmail }, ip: nextIp() });
  const second = await api.call("POST", "/tenant/v1/auth/email-code/verify", { body: { email: "qa-echo@fleet.test", code: badCode }, ip: nextIp() });
  for (const res of [first, second]) assert.equal(res.status, 400, res.text);
  assert.ok(!first.text.includes(badEmail));
  assert.ok(!second.text.includes(badCode));
  assert.ok(!second.text.includes("qa-echo@fleet.test"));
  const logs = api.logs().slice(logsBefore);
  assert.ok(!logs.includes(badEmail) && !logs.includes(badCode) && !logs.includes("qa-echo@fleet.test"));
});

test("邮件：主题固定且不含数字，发件头里没有验证码；邮件头不受请求影响", async () => {
  const email = "qa-mail-head@platform.test";
  await staff(email);
  await requestCode("platform", email);
  const code = latestCode(email);
  const data = smtp.messages[0]?.data ?? "";
  const head = data.split(/\r?\n\r?\n/)[0] ?? "";
  assert.ok(!head.includes(code));
  const subjectLine = (/^Subject: (.*(?:\r?\n[ \t].*)*)$/im.exec(head)?.[1] ?? "").replace(/\r?\n[ \t]+/g, "");
  // 编码成了几段 RFC 2047 的 Q 编码：连起来按字节解码（一个汉字可能被拆在两段之间）
  const bytes = [...subjectLine.matchAll(/=\?UTF-8\?Q\?([^?]*)\?=/gi)].map((part) => (part[1] as string).replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))).join("");
  const decoded = Buffer.from(bytes, "latin1").toString("utf8");
  assert.equal(decoded, "NOZOMI 登录验证码");
  assert.equal(smtp.messages[0]?.to.length, 1);
  assert.doesNotMatch(head, /^bcc:|^cc:/im);
});

test("过期的行：下一次任何人发码时清掉，表不会无限增长；用过的码那一行当场没了；没过期的不受影响", async () => {
  const count = async (): Promise<number> => (await api.db.owner.query("select count(*)::int as n from email_login_codes")).rows[0].n;
  await api.db.owner.query("delete from email_login_codes");
  for (let i = 0; i < 6; i++) await requestCode("platform", `qa-growth-${i}@platform.test`);
  assert.equal(await count(), 6);
  api.clock.advance(EMAIL_CODE_TTL_MS - 1);
  await requestCode("platform", "qa-growth-still@platform.test");
  assert.equal(await count(), 7, "还没到期的不清");
  api.clock.advance(1);
  await requestCode("platform", "qa-growth-after@platform.test");
  assert.equal(await count(), 2, "6 个到期的清掉了");

  const email = "qa-growth-used@platform.test";
  await staff(email);
  await requestCode("platform", email);
  const rows = await count();
  assert.equal((await verify("platform", email, latestCode(email))).status, 200);
  assert.equal(await count(), rows - 1);
});

test("限速表：24 小时的计数不会被顺手的清理提前删掉（否则一天 20 封就不算数了）；窗口结束后才清", async () => {
  const email = "qa-stale@platform.test";
  await staff(email);
  for (let i = 0; i < 20; i++) {
    assert.equal((await requestCode("platform", email)).status, 202, `第 ${i + 1} 封`);
    api.clock.advance(4 * 60 * 1000);
  }
  // 别的邮箱的请求触发清理，再隔 22 小时回来：窗口没结束，一样发不出
  api.clock.advance(22 * 60 * 60 * 1000);
  await requestCode("platform", "qa-stale-other@platform.test");
  assert.equal((await requestCode("platform", email)).status, 429);
});

test("权限：新表只有 nozomi_preauth 能读写，nozomi_app、nozomi_platform 碰不到；preauth 只有增删改查；没有 tenant_id 所以不是租户表", async () => {
  const table = `${api.db.schema}.email_login_codes`;
  const privileges = async (role: string): Promise<string[]> => {
    const out: string[] = [];
    for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
      const has = (await api.db.owner.query("select has_table_privilege($1, $2, $3) as ok", [role, table, privilege])).rows[0].ok;
      if (has) out.push(privilege);
    }
    return out;
  };
  assert.deepEqual(await privileges("nozomi_preauth"), ["SELECT", "INSERT", "UPDATE", "DELETE"]);
  assert.deepEqual(await privileges("nozomi_app"), []);
  assert.deepEqual(await privileges("nozomi_platform"), []);
  assert.deepEqual(await privileges("public"), []);
  const columns = (await api.db.owner.query("select column_name from information_schema.columns where table_schema = $1 and table_name = 'email_login_codes'", [api.db.schema])).rows.map((row) => row.column_name);
  assert.ok(!columns.includes("tenant_id"));
  assert.ok(!columns.includes("email"));
  const client = await api.db.pool.connect();
  try {
    for (const [role, allowed] of [["nozomi_preauth", true], ["nozomi_app", false], ["nozomi_platform", false]] as const) {
      await client.query("begin");
      await client.query(`set local role ${role}`);
      if (allowed) await client.query("select * from email_login_codes");
      else await assert.rejects(client.query("select * from email_login_codes"), /permission denied/, `${role} 不能读`);
      await client.query("rollback");
    }
  } finally {
    await client.query("rollback");
    client.release();
  }
});

test("参数怪异的请求：类型不对、超长、空字符、数组都是 400；不是 JSON 的 415 或 400；从来不是 500", async () => {
  const huge = `${"a".repeat(300)}@example.test`;
  const bodies: unknown[] = [{}, { email: 1 }, { email: null }, { email: ["a@example.test"] }, { email: { $ne: "" } }, { email: huge }, { email: "a\u0000@example.test" }, { email: "" }, { email: "   " }, [], "text", 42];
  for (const portal of ["platform", "tenant"] as const) {
    for (const body of bodies) {
      const res = await api.call("POST", `/${portal}/v1/auth/email-code/request`, { body, ip: nextIp(), headers: { "content-type": "application/json" } });
      assert.equal(res.status, 400, `${JSON.stringify(body)}：${res.text}`);
    }
    for (const code of [123456, null, ["123456"], { a: 1 }, "12345\u0000", "１２３４５６", "١٢٣٤٥٦", "123456789012345678901234567890", "12 3456", "-12345", "1e5000"]) {
      const res = await api.call("POST", `/${portal}/v1/auth/email-code/verify`, { body: { email: "qa-odd@example.test", code }, ip: nextIp() });
      assert.equal(res.status, 400, `${JSON.stringify(code)}：${res.text}`);
    }
    const form = await api.app.inject({ method: "POST", url: `/${portal}/v1/auth/email-code/request`, headers: { "content-type": "application/x-www-form-urlencoded" }, payload: "email=a%40example.test", remoteAddress: nextIp() });
    assert.ok(form.statusCode === 415 || form.statusCode === 400, `表单：${form.statusCode}`);
    const broken = await api.app.inject({ method: "POST", url: `/${portal}/v1/auth/email-code/verify`, headers: { "content-type": "application/json" }, payload: "{not json", remoteAddress: nextIp() });
    assert.equal(broken.statusCode, 400);
  }
  const count = (await api.db.owner.query("select count(*)::int as n from email_login_codes where created_at > now() + interval '100 years'")).rows[0].n;
  assert.equal(count, 0);
});

test("验证码开头是 0 的也能用：格式校验、哈希都把它当字符串，不当数字", async () => {
  const email = "qa-leading-zero@platform.test";
  await staff(email);
  await requestCode("platform", email);
  const key = Buffer.from(hkdfSync("sha256", FAKE_SECRETS.authJwtSecret, Buffer.alloc(0), "nozomi/email-login-code/v1", 32));
  const hmac = (...parts: string[]): string => createHmac("sha256", key).update(parts.join("\n"), "utf8").digest("hex");
  const updated = await api.db.owner.query("update email_login_codes set code_hash = $1 where email_key = $2", [hmac("code", "platform", email, "000123"), hmac("email", "platform", email)]);
  assert.equal(updated.rowCount, 1);
  assert.equal((await verify("platform", email, "123")).status, 400, "去掉前导 0 的不算");
  assert.equal((await verify("platform", email, "000123")).status, 200);
});

test("不锁人：运营后台清空 SMTP 立刻只剩密码；已发出的码还能用完这 10 分钟（ADR 第 3 节校验接口没有 503）；重新填回来立刻恢复", async () => {
  const on = await createTestApi({ env: NO_SMTP, integrationSecretsTtlMs: 0, mailer: fastMailer() });
  try {
    const admin = await on.superAdminToken("qa-clear-root@platform.test");
    const tenant = await on.tenantWithAdmin(admin, "QA 清空车队", "qa-clear@fleet.test");
    assert.equal((await on.call("PUT", "/platform/v1/integration-secrets/email", { token: admin, body: savedSmtpBody(smtp) })).status, 200);
    assert.deepEqual((await on.call("GET", "/tenant/v1/auth/login-methods")).body, { email_code: true, password: true });
    assert.equal((await requestCode("tenant", tenant.adminEmail, nextIp(), on)).status, 202);
    const code = latestCode(tenant.adminEmail);

    assert.equal((await on.call("DELETE", "/platform/v1/integration-secrets/email", { token: admin })).status, 200);
    assert.deepEqual((await on.call("GET", "/tenant/v1/auth/login-methods")).body, { email_code: false, password: true });
    const unavailable = await requestCode("tenant", tenant.adminEmail, nextIp(), on);
    assert.deepEqual([unavailable.status, unavailable.body.error.code], [503, "EMAIL_CODE_UNAVAILABLE"]);
    assert.equal((await on.call("POST", "/tenant/v1/auth/login", { body: { email: tenant.adminEmail, password: TEST_PASSWORD } })).status, 200);

    const late = await verify("tenant", tenant.adminEmail, code, nextIp(), on);
    assert.equal(late.status, 200, `已发出的码：${late.text}`);

    assert.equal((await on.call("PUT", "/platform/v1/integration-secrets/email", { token: admin, body: savedSmtpBody(smtp) })).status, 200);
    assert.deepEqual((await on.call("GET", "/platform/v1/auth/login-methods")).body, { email_code: true, password: true });
  } finally {
    await on.close();
  }
});

test("不锁人：库里的 SMTP 解不开（密钥换了、内容坏了）：不 500，验证码不可用，密码开着——即使 PASSWORD_LOGIN_DISABLED=true", async () => {
  const on = await createTestApi({ env: { ...NO_SMTP, PASSWORD_LOGIN_DISABLED: "true" }, integrationSecretsTtlMs: 0, mailer: fastMailer() });
  try {
    const admin = await on.superAdminToken("qa-corrupt-root@platform.test");
    const tenant = await on.tenantWithAdmin(admin, "QA 损坏车队", "qa-corrupt@fleet.test");
    assert.equal((await on.call("PUT", "/platform/v1/integration-secrets/email", { token: admin, body: savedSmtpBody(smtp) })).status, 200);
    assert.deepEqual((await on.call("GET", "/tenant/v1/auth/login-methods")).body, { email_code: true, password: false }, "先确认填上之后确实关了");

    // 换成另一项的密文：格式合法，但附加数据对不上，解不开
    const sealed = (await on.db.owner.query("select sealed from integration_secrets where integration = 'email'")).rows[0].sealed as string;
    const parts = sealed.split(".");
    const tampered = [parts[0], parts[1], parts[2], Buffer.from("tampered-bytes-for-qa").toString("base64url")].join(".");
    await on.db.owner.query("update integration_secrets set sealed = $1 where integration = 'email'", [tampered]);

    for (const portal of ["platform", "tenant"] as const) {
      const methods = await on.call("GET", `/${portal}/v1/auth/login-methods`);
      assert.equal(methods.status, 200, methods.text);
      assert.deepEqual(methods.body, { email_code: false, password: true });
      const sent = await requestCode(portal, tenant.adminEmail, nextIp(), on);
      assert.deepEqual([sent.status, sent.body.error.code], [503, "EMAIL_CODE_UNAVAILABLE"]);
      const verified = await verify(portal, tenant.adminEmail, "123456", nextIp(), on);
      assert.equal(verified.status, 401, verified.text);
    }
    const login = await on.call("POST", "/tenant/v1/auth/login", { body: { email: tenant.adminEmail, password: TEST_PASSWORD } });
    assert.equal(login.status, 200, login.text);
  } finally {
    await on.close();
  }
});

test("不锁人：没配数据加密密钥时，后台那一份读不了，环境变量的 SMTP 照常生效；服务能起来，登录方式接口 200", async () => {
  const on = await createTestApi({ env: { ...SMTP_ENV(smtp), DATA_ENCRYPTION_KEY: "" }, integrationSecretsTtlMs: 0, mailer: fastMailer() });
  try {
    const methods = await on.call("GET", "/tenant/v1/auth/login-methods");
    assert.equal(methods.status, 200, methods.text);
    assert.deepEqual(methods.body, { email_code: true, password: true });
  } finally {
    await on.close();
  }
});

test("不锁人：邮件配置了但发不出去、密码没关时，发码 202、密码登录照常，发信失败的账号不被算作登录失败", async () => {
  const email = "qa-send-broken@platform.test";
  await staff(email);
  smtp.behave({ rejectAuth: true });
  assert.equal((await requestCode("platform", email)).status, 202);
  const login = await api.call("POST", "/platform/v1/auth/login", { body: { email, password: TEST_PASSWORD }, ip: nextIp() });
  assert.equal(login.status, 200, login.text);
});

test("服务关闭：等后台的发信任务结束（ADR 第 5 节），不会在连接池关掉之后才写审计", async () => {
  const on = await createTestApi({ env: SMTP_ENV(smtp), integrationSecretsTtlMs: 0, mailer: fastMailer() });
  try {
    const email = "qa-shutdown@platform.test";
    await staff(email, on);
    smtp.behave({ silent: true });
    const res = await on.call("POST", "/platform/v1/auth/email-code/request", { body: { email }, ip: nextIp() });
    assert.equal(res.status, 202);
    await on.app.close();
    const rows = (await on.db.owner.query("select after from audit_logs where action = 'email_code_request'")).rows;
    assert.equal(rows.length, 1, "关闭之前审计已经写完");
    assert.equal(rows[0].after.outcome, "send_failed");
    assert.doesNotMatch(on.logs(), /email_code\.task_failed/);
  } finally {
    await on.close();
  }
});

test("接口文档：开发的用例没走到的应答（格式错的 400、密码已关闭的 403）也和 OpenAPI 对得上", async () => {
  for (const portal of ["platform", "tenant"] as const) {
    const badEmail = await api.call("POST", `/${portal}/v1/auth/email-code/request`, { body: { email: "not-an-email" }, ip: nextIp() });
    assert.equal(badEmail.status, 400);
    assertMatchesOpenApi("POST", `/${portal}/v1/auth/email-code/request`, badEmail);
    const badCode = await api.call("POST", `/${portal}/v1/auth/email-code/verify`, { body: { email: "qa-doc@example.test", code: "12" }, ip: nextIp() });
    assert.equal(badCode.status, 400);
    assertMatchesOpenApi("POST", `/${portal}/v1/auth/email-code/verify`, badCode);
  }
  const closed = await createTestApi({ env: { ...SMTP_ENV(smtp), PASSWORD_LOGIN_DISABLED: "true" }, integrationSecretsTtlMs: 0, mailer: fastMailer() });
  try {
    for (const portal of ["platform", "tenant"] as const) {
      const res = await closed.call("POST", `/${portal}/v1/auth/login`, { body: { email: "qa-doc@example.test", password: TEST_PASSWORD } });
      assert.equal(res.status, 403);
      assertMatchesOpenApi("POST", `/${portal}/v1/auth/login`, res);
    }
  } finally {
    await closed.close();
  }
});
