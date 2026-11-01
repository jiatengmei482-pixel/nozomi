/**
 * 运营后台填写邮件发送（M4-14，ADR 0048），连真实的 PostgreSQL 和本机的假 SMTP 服务器，**从不连真实的邮件服务**（域名解析也是替身）。
 * - 只有超级管理员能填写、更换、清空、测试；只读角色只看到已配置 / 未配置和来源。
 * - 密码不在应答、审计、日志、数据库里（按值比对）。
 * - 保存后立即生效；清空回落到配置文件；测试邮件只发给操作人；各种失败的分类；限速；防 SSRF；防邮件头注入。
 * 这里的账号密码都是测试里现场拼的假值。服务器配置文件这一侧指到另一台假服务器。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { PLATFORM_ROLES, type PlatformRole } from "@nozomi/domain";
import { loadConfig } from "@nozomi/config";
import { withTenantTx } from "./db/context.ts";
import { SmtpMailer } from "./integrations/smtp.ts";
import { SecretBox } from "./integrations/secret-box.ts";
import { INTEGRATION_TEST_INTERVAL_MS, saveIntegrationSecretValue } from "./services/integration-secrets.ts";
import { sendMail } from "./services/mail.ts";
import type { PlatformPrincipal } from "./services/platform-auth.ts";
import { createSuperAdmin } from "./services/platform-staff.ts";
import { type ApiResponse, type HttpMethod, TEST_PASSWORD, type TenantFixture, type TestApi, createTestApi, testContext } from "./testing/api.ts";
import { type FakeSmtp, type FakeTlsCert, generateFakeTlsCert, startFakeSmtp } from "./testing/fake-integrations.ts";
import { testEnv } from "./testing/fixtures.ts";
import { allValues } from "./testing/market.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";

const fakePassword = (): string => `pw-${randomBytes(12).toString("hex")}`;
const PASSWORD = fakePassword();
const PASSWORD_2 = fakePassword();
const ENV_PASSWORD = fakePassword();
const SECRETS = [PASSWORD, PASSWORD_2, ENV_PASSWORD];
const last4 = (value: string): string => `••••${value.slice(-4)}`;
const ROOT_EMAIL = "root@platform.test";

/** 假的域名解析：这张表以外的名字都解析不了，绝不查真实的 DNS。 */
const dns = new Map<string, string[]>();
const resolve = async (name: string): Promise<string[]> => {
  const found = dns.get(name);
  if (found === undefined) throw new Error("ENOTFOUND");
  return found;
};

let cert: FakeTlsCert;
let admin: FakeSmtp;
let adminTwo: FakeSmtp;
let envServer: FakeSmtp;
let tlsServer: FakeSmtp;
let api: TestApi;
let root: string;
let tenant: TenantFixture;
const tokens = new Map<PlatformRole, string>();
const testMailer = (): SmtpMailer => new SmtpMailer({ allowLoopback: true, tlsCa: cert.cert, deadlineMs: 800, resolve });

const body = (fake: FakeSmtp, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  host: fake.host,
  port: fake.port,
  encryption: "none",
  username: "mailer@example.test",
  password: PASSWORD,
  from_name: "NOZOMI 用车",
  from_address: "noreply@example.test",
  ...extra,
});

async function call(method: HttpMethod, url: string, options: { token?: string; body?: unknown; template?: string; on?: TestApi } = {}): Promise<ApiResponse> {
  const res = await (options.on ?? api).call(method, url, { token: options.token ?? root, ...(options.body === undefined ? {} : { body: options.body }) });
  for (const secret of SECRETS) {
    assert.ok(!res.text.includes(secret), `${method} ${url} 的应答里有密码`);
    assert.ok(!allValues(res.body).has(secret));
  }
  if (options.template !== undefined) assertMatchesOpenApi(method, options.template, res);
  return res;
}
const PATH = "/platform/v1/integration-secrets";
const list = (token = root, on?: TestApi): Promise<ApiResponse> => call("GET", PATH, { token, template: PATH, ...(on === undefined ? {} : { on }) });
const save = (payload: unknown, token = root, on?: TestApi): Promise<ApiResponse> => call("PUT", `${PATH}/email`, { token, body: payload, template: `${PATH}/{key}`, ...(on === undefined ? {} : { on }) });
const clear = (token = root): Promise<ApiResponse> => call("DELETE", `${PATH}/email`, { token, template: `${PATH}/{key}` });
const checkNow = (token = root, payload?: unknown): Promise<ApiResponse> => call("POST", `${PATH}/email/test`, { token, template: `${PATH}/{key}/test`, ...(payload === undefined ? {} : { body: payload }) });
/** 测试一下（同一项每 5 秒最多一次）：先把时钟拨过限速的间隔。 */
const check = (token = root, payload?: unknown): Promise<ApiResponse> => {
  api.clock.advance(INTEGRATION_TEST_INTERVAL_MS);
  return checkNow(token, payload);
};
const emailItem = (res: ApiResponse): any => res.body.items.find((item: any) => item.key === "email");
const health = async (): Promise<string> => (await api.call("GET", "/health")).body.integrations.find((item: any) => item.key === "email").state;
/** 审计只能追加：只看这个用例开始之后的。 */
let auditBaseline = "0";
const auditRows = async (): Promise<any[]> => (await api.db.owner.query("select actor_id, action, resource_id, before, after from audit_logs where resource = 'integration_secret' and resource_id = 'email' and id > $1 order by id", [auditBaseline])).rows;
const issuesOf = (res: ApiResponse): string[] => res.body.error.details.issues.map((issue: any) => `${issue.path}:${issue.reason}`);

async function addStaff(email: string, role: string): Promise<string> {
  const invited = await api.call("POST", "/platform/v1/staff", { token: root, body: { email, name: email.split("@")[0], role } });
  assert.equal(invited.status, 201, invited.text);
  await api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.body.invite.token, password: TEST_PASSWORD } });
  const login = await api.platformLogin({ body: { email, password: TEST_PASSWORD } });
  assert.equal(login.status, 200, login.text);
  return login.body.access_token as string;
}

before(async () => {
  cert = generateFakeTlsCert();
  admin = await startFakeSmtp();
  adminTwo = await startFakeSmtp();
  envServer = await startFakeSmtp();
  tlsServer = await startFakeSmtp({ tls: { mode: "implicit", cert } });
  api = await createTestApi({
    env: { SMTP_HOST: envServer.host, SMTP_PORT: String(envServer.port), SMTP_ENCRYPTION: "none", SMTP_USERNAME: "env-user", SMTP_PASSWORD: ENV_PASSWORD, SMTP_FROM_NAME: "配置文件", SMTP_FROM_ADDRESS: "env@example.test" },
    integrationSecretsTtlMs: 0,
    mailer: testMailer(),
  });
  root = await api.superAdminToken(ROOT_EMAIL);
  tokens.set("super_admin", root);
  for (const { key } of PLATFORM_ROLES) if (key !== "super_admin") tokens.set(key, await addStaff(`${key.replace("_", "-")}@platform.test`, key));
  tenant = await api.tenantWithAdmin(root, "某车队", "admin@fleet.test");
});
after(async () => {
  await api.close();
  await Promise.all([admin.close(), adminTwo.close(), envServer.close(), tlsServer.close()]);
});
beforeEach(async () => {
  for (const fake of [admin, adminTwo, envServer, tlsServer]) fake.reset();
  dns.clear();
  await api.db.owner.query("delete from integration_secrets where integration = 'email'");
  auditBaseline = String((await api.db.owner.query("select coalesce(max(id), 0) as id from audit_logs")).rows[0].id);
});

test("只有超级管理员能填写、更换、清空、测试：其他 9 个内置角色和自建角色 403，假服务器一次都没被连；只读角色只看到已配置 / 未配置和来源", async () => {
  for (const { key: role } of PLATFORM_ROLES) {
    if (role === "super_admin") continue;
    const token = tokens.get(role)!;
    for (const res of [await save(body(admin), token), await clear(token), await check(token)]) assert.deepEqual([res.status, res.body.error.code], [403, "FORBIDDEN"], role);
  }
  const custom = await call("POST", "/platform/v1/roles", { body: { name: "邮件观察员", grants: ["integrations:view"] } });
  assert.equal(custom.status, 201, custom.text);
  const customToken = await addStaff("mail-watcher@platform.test", custom.body.key);
  for (const res of [await save(body(admin), customToken), await clear(customToken), await check(customToken)]) assert.equal(res.status, 403);
  assert.equal(admin.connections() + envServer.connections(), 0);
  assert.equal((await auditRows()).length, 0, "被拒的请求不留任何改动");

  assert.equal((await save(body(admin))).status, 200);
  for (const token of [tokens.get("tech")!, customToken]) {
    const seen = await list(token);
    assert.equal(seen.body.can_manage, false);
    const item = emailItem(seen);
    assert.deepEqual([item.state, item.source, item.masked, item.settings, item.admin], ["configured", "admin", null, null, null]);
    assert.ok(!seen.text.includes("mailer@example.test") && !seen.text.includes("noreply@example.test") && !seen.text.includes(String(admin.port)), "只读角色看不到账号和主机");
    const overview = await call("GET", "/platform/v1/integrations", { token });
    assert.equal(overview.body.items.find((i: any) => i.key === "email").detail, "后台设置");
  }
  assert.equal((await list(tokens.get("operations")!)).status, 403);
});

test("两步验证没完成的超级管理员会话：403，什么都没改，没发信", async () => {
  await createSuperAdmin(api.db.pool, { email: "pending-mail@platform.test", name: "待验证", password: TEST_PASSWORD }, api.clock.now());
  const pending = (await api.call("POST", "/platform/v1/auth/login", { body: { email: "pending-mail@platform.test", password: TEST_PASSWORD } })).body.access_token as string;
  for (const res of [await save(body(admin), pending), await clear(pending), await check(pending)]) assert.deepEqual([res.status, res.body.error.code], [403, "MFA_REQUIRED"]);
  assert.equal(admin.connections() + envServer.connections(), 0);
});

test("填写：其余几项明文显示给超级管理员，密码只显示末 4 位；库里是密文；审计记 set、主机和打码的密码，不记用户名和密码", async () => {
  const saved = await save(body(admin, { host: `  ${admin.host} `, username: " mailer@example.test\n", password: `  ${PASSWORD}\n`, from_name: "  NOZOMI 用车 " }));
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.body.action, "set");
  const item = saved.body.item;
  assert.deepEqual([item.key, item.label, item.state, item.source, item.source_label, item.masked, item.mode, item.env_configured], ["email", "邮件发送", "configured", "admin", "后台设置", last4(PASSWORD), null, true]);
  assert.deepEqual(item.settings, { host: admin.host, port: admin.port, encryption: "none", username: "mailer@example.test", from_name: "NOZOMI 用车", from_address: "noreply@example.test" });
  assert.deepEqual(item.admin.hints, { password: last4(PASSWORD) }, "只有密码打码，其余几项不进 hints");
  assert.deepEqual(item.fields.map((field: any) => field.name), ["host", "port", "encryption", "username", "password", "from_name", "from_address"]);
  assert.equal(typeof item.admin.updated_by.name, "string");

  const rows = (await api.db.owner.query("select * from integration_secrets where integration = 'email'")).rows;
  assert.equal(rows.length, 1);
  const stored = allValues(rows[0]);
  for (const value of stored) assert.ok(!value.includes(PASSWORD), "库里有密码原文");
  assert.ok(!JSON.stringify(rows[0]).includes(PASSWORD), "库里有密码原文");
  assert.ok(!String(rows[0].sealed).includes("mailer@example.test"), "整组加密");
  assert.match(String(rows[0].sealed), /^v1\./);

  const [audit] = await auditRows();
  assert.equal(audit.action, "set");
  assert.equal(audit.before, null);
  assert.deepEqual(audit.after, { hints: { password: last4(PASSWORD) }, settings: { host: admin.host, port: admin.port, encryption: "none", from_name: "NOZOMI 用车", from_address: "noreply@example.test" } });
  assert.ok(!JSON.stringify(audit).includes("mailer@example.test"), "审计不记用户名");

  const replaced = await save(body(adminTwo, { password: PASSWORD_2 }));
  assert.equal(replaced.body.action, "replace");
  const rowsAfter = await auditRows();
  const replace = rowsAfter[rowsAfter.length - 1];
  assert.equal(replace.action, "replace");
  assert.deepEqual([replace.before.hints.password, replace.before.settings.port, replace.after.hints.password, replace.after.settings.port], [last4(PASSWORD), admin.port, last4(PASSWORD_2), adminTwo.port]);
  assert.equal((await api.db.owner.query("select version from integration_secrets where integration = 'email'")).rows[0].version, 2);

  const auditApi = await call("GET", `/platform/v1/audit-logs?resource=integration_secret&resource_id=email`);
  assert.equal(auditApi.status, 200);
  for (const row of await auditRows()) for (const value of allValues(row)) for (const secret of SECRETS) assert.ok(!value.includes(secret), "审计里有密码");
});

test("保存即生效，不用重启：测试邮件马上走新的配置；更换后下一封走新服务器；清空回落到配置文件", async () => {
  assert.equal(emailItem(await list()).source, "env");
  assert.equal(await health(), "configured");
  const fromEnv = await check();
  assert.deepEqual([fromEnv.status, fromEnv.body.ok, fromEnv.body.source, fromEnv.body.source_label], [200, true, "env", "服务器配置文件"]);
  assert.deepEqual(envServer.auths.map((a) => [a.user, a.pass]), [["env-user", ENV_PASSWORD]]);
  assert.match(envServer.messages[0]?.data ?? "", /^From: .*<env@example\.test>/m);

  await save(body(admin));
  const fromAdmin = await check();
  assert.deepEqual([fromAdmin.body.ok, fromAdmin.body.source], [true, "admin"]);
  assert.deepEqual(admin.auths.map((a) => [a.user, a.pass]), [["mailer@example.test", PASSWORD]]);
  assert.equal(envServer.messages.length, 1, "后台的优先，配置文件那边没有再收到");

  await save(body(adminTwo, { password: PASSWORD_2 }));
  assert.equal((await check()).body.ok, true);
  assert.deepEqual(adminTwo.auths.map((a) => a.pass), [PASSWORD_2], "更换后下一封就用新的");
  assert.equal(admin.messages.length, 1);

  const cleared = await clear();
  assert.equal(cleared.status, 200);
  assert.deepEqual([cleared.body.item.source, cleared.body.item.masked, cleared.body.item.admin.configured, cleared.body.item.settings.username], ["env", last4(ENV_PASSWORD), false, "env-user"]);
  assert.equal((await check()).body.source, "env");
  assert.equal(envServer.messages.length, 2);
  const rows = await auditRows();
  assert.deepEqual(rows.map((r) => r.action), ["test", "set", "test", "replace", "test", "clear", "test"]);
  assert.deepEqual(rows[5].before.hints, { password: last4(PASSWORD_2) });
  assert.equal(rows[5].after, null);
  assert.equal((await clear()).body.error.code, "INTEGRATION_SECRET_NOT_SET");
});

test("测试邮件只发给当前操作的超级管理员：请求体里写了别的收件人也不看；结果写明发到了哪里", async () => {
  await save(body(admin));
  const res = await check(root, { to: "attacker@example.test", recipient: "attacker@example.test", bcc: "attacker@example.test" });
  assert.deepEqual([res.status, res.body.ok, res.body.code, res.body.key], [200, true, null, "email"]);
  assert.match(res.body.message, /root@platform\.test/);
  assert.equal(admin.messages.length, 1);
  const message = admin.messages[0]!;
  assert.deepEqual(message.to, [ROOT_EMAIL]);
  assert.match(message.data, /^To: root@platform\.test/m);
  assert.ok(!message.data.includes("attacker"));
  for (const secret of SECRETS) assert.ok(!message.data.includes(secret), "邮件内容里有密码");

  const otherRoot = await api.superAdminToken("root-two@platform.test");
  assert.equal((await check(otherRoot)).body.ok, true);
  assert.deepEqual(admin.messages[1]?.to, ["root-two@platform.test"], "另一位超级管理员测，发给他自己");

  const [row] = (await auditRows()).filter((r) => r.action === "test");
  assert.deepEqual(row.after, { source: "admin", ok: true, code: null });
});

test("测试邮件的结果分类：连接失败、TLS 失败、认证失败、发件人被拒、收件人被拒、超时；说明里没有服务器原文和密码；审计记结果", async () => {
  const detail = "private-server-text";
  await save(body(admin));
  const cases: [Parameters<FakeSmtp["behave"]>[0], string][] = [
    [{ rejectAuth: true, errorDetail: detail }, "AUTH_FAILED"],
    [{ rejectSender: true, errorDetail: detail }, "SENDER_REJECTED"],
    [{ rejectRecipient: true, errorDetail: detail }, "RECIPIENT_REJECTED"],
    [{ rejectAt: { stage: "DOT", reply: "554 5.7.1 rejected" }, errorDetail: detail }, "MESSAGE_REJECTED"],
    [{ rejectAt: { stage: "RCPT", reply: "553 5.7.1 not owned by user" }, errorDetail: detail }, "MESSAGE_REJECTED"],
    [{ rejectAt: { stage: "RCPT", reply: "450 4.2.1 greylisted" }, errorDetail: detail }, "TEMPORARILY_REJECTED"],
    [{ silent: true }, "TIMEOUT"],
    [{ stallOn: "MAIL" }, "TIMEOUT"],
    [{ dropOnConnect: true }, "UNREACHABLE"],
  ];
  for (const [behavior, code] of cases) {
    admin.reset();
    admin.behave(behavior);
    const res = await check();
    assert.deepEqual([res.status, res.body.ok, res.body.code], [200, false, code], JSON.stringify(behavior));
    assert.ok(!res.text.includes(detail), "应答里有服务器的原文");
    assert.equal(admin.messages.length, 0);
  }
  admin.reset();

  await save(body(admin, { encryption: "tls" }));
  assert.equal((await check()).body.code, "TLS_FAILED", "对着明文服务器走 TLS");
  await save(body(admin, { encryption: "starttls" }));
  assert.equal((await check()).body.code, "TLS_FAILED", "服务器不支持 STARTTLS，不退回明文");
  assert.equal(admin.auths.length, 0, "TLS 失败时密码没有发出去");

  await save(body(tlsServer, { encryption: "tls" }));
  const ok = await check();
  assert.equal(ok.body.ok, true, ok.text);
  assert.equal(tlsServer.messages[0]?.secure, true);

  await save(body(admin, { host: "smtp.not-resolvable.test", port: 587 }));
  assert.equal((await check()).body.code, "UNREACHABLE", "域名解析不了");

  const tests = (await auditRows()).filter((r) => r.action === "test");
  assert.deepEqual(tests.map((r) => r.after.code), ["AUTH_FAILED", "SENDER_REJECTED", "RECIPIENT_REJECTED", "MESSAGE_REJECTED", "MESSAGE_REJECTED", "TEMPORARILY_REJECTED", "TIMEOUT", "TIMEOUT", "UNREACHABLE", "TLS_FAILED", "TLS_FAILED", null, "UNREACHABLE"]);
});

test("限速：同一项每 5 秒最多测一次（不分人）；别的项不受影响", async () => {
  await save(body(admin));
  api.clock.advance(INTEGRATION_TEST_INTERVAL_MS);
  assert.equal((await checkNow()).status, 200);
  const limited = await checkNow(await api.superAdminToken("root-limited@platform.test"));
  assert.deepEqual([limited.status, limited.body.error.code], [429, "INTEGRATION_TEST_RATE_LIMITED"]);
  assert.ok(limited.body.error.details.retry_after_seconds >= 1);
  assert.equal(admin.messages.length, 1, "限速时没有发信");
  api.clock.advance(INTEGRATION_TEST_INTERVAL_MS);
  assert.equal((await checkNow()).status, 200);
});

test("防 SSRF（保存时）：内网、回环以外的本地地址、链路本地、元数据地址和内网名字都拒绝（local / ci 也一样），不连接、不留记录；不回显填的值", async () => {
  for (const host of ["10.0.0.8", "172.16.0.1", "192.168.1.1", "169.254.169.254", "fe80::1", "fd00:ec2::254", "::ffff:10.0.0.8", "100.64.0.1", "0.0.0.0", "smtp.internal", "mail.local", "mail", "2130706433", "0x7f.1"]) {
    const res = await save(body(admin, { host, port: 587 }));
    assert.equal(res.status, 400, host);
    assert.deepEqual(issuesOf(res), ["/host:HOST_FORBIDDEN"], host);
    assert.ok(!res.text.includes(host), "不回显");
  }
  assert.equal((await auditRows()).length, 0);
});

test("防 SSRF（发信前）：名字合法但解析到内网地址的，拒绝连接；解析到的地址有一个不是公网就整体拒绝", async () => {
  for (const addresses of [["10.0.0.8"], ["169.254.169.254"], ["127.0.0.1", "10.0.0.8"], ["fe80::1"]]) {
    dns.set("smtp.rebind.test", addresses);
    await save(body(admin, { host: "smtp.rebind.test", port: 587 }));
    const res = await check();
    assert.deepEqual([res.status, res.body.ok, res.body.code], [200, false, "TARGET_FORBIDDEN"], addresses.join());
  }
  assert.equal(admin.connections(), 0);
});

test("端口只收 25、465、587、2525：公网主机填别的端口 400；local / ci 的例外只有回环地址", async () => {
  for (const port of [22, 80, 443, 3306, 5432, 6379, 8080]) assert.deepEqual(issuesOf(await save(body(admin, { host: "smtp.example.test", port }))), ["/port:PORT_NOT_ALLOWED"], String(port));
  for (const port of [25, 465, 587, 2525]) assert.equal((await save(body(admin, { host: "smtp.example.test", port }))).status, 200, String(port));
  for (const port of ["587", null, 587.5]) assert.equal((await save(body(admin, { port }))).status, 400, String(port));
});

test("校验：七项必填；加密方式三选一；发件人名称、用户名、密码、地址里的换行（邮件头注入）拒绝；不回显填的值", async () => {
  const empty = await save({ host: "", port: 587, encryption: "", username: "", password: "", from_name: "", from_address: "" });
  assert.deepEqual(issuesOf(empty), ["/host:REQUIRED", "/encryption:REQUIRED", "/username:REQUIRED", "/password:REQUIRED", "/from_name:REQUIRED", "/from_address:REQUIRED"]);
  assert.equal((await save({ host: "smtp.example.test" })).status, 400, "缺项");
  assert.deepEqual(issuesOf(await save(body(admin, { encryption: "ssl" }))), ["/encryption:FORMAT"]);
  const injected = "x\r\nBcc: attacker@example.test";
  for (const [field, path] of [["from_name", "/from_name:FORMAT"], ["username", "/username:FORMAT"], ["from_address", "/from_address:FORMAT"], ["host", "/host:FORMAT"]] as const) {
    const res = await save(body(admin, { port: 587, [field]: injected }));
    assert.deepEqual(issuesOf(res), [path], field);
    assert.ok(!res.text.includes("attacker"), "不回显");
  }
  const badPassword = await save(body(admin, { password: `${PASSWORD}\r\nx${PASSWORD_2}` }));
  assert.deepEqual(issuesOf(badPassword), ["/password:FORMAT"]);
  assert.deepEqual(issuesOf(await save(body(admin, { password: "short" }))), ["/password:TOO_SHORT"]);
  assert.deepEqual(issuesOf(await save(body(admin, { from_address: "a@b.test, c@d.test" }))), ["/from_address:FORMAT"]);
  assert.equal((await auditRows()).length, 0);
});

test("短密码只显示圆点；末 4 位可以是任何字符（密码不限字符集）", async () => {
  const short = await save(body(admin, { password: "short-pw-12" }));
  assert.equal(short.body.item.masked, "••••");
  assert.deepEqual(short.body.item.admin.hints, { password: "••••" });
  const unicode = `pw 含 空格-${randomBytes(8).toString("hex")}-密码!@#`;
  const saved = await save(body(admin, { password: unicode }));
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.body.item.masked, last4(unicode));
  const sent = await check();
  assert.equal(sent.body.ok, true, sent.text);
  assert.equal(admin.auths[0]?.pass, unicode, "原样用于认证");
  assert.ok(!sent.text.includes(unicode));
});

test("内部发信接口 sendMail：现取生效的配置；邮件头注入一个字节都不发；没配置和失败都是返回值，不抛异常", async () => {
  const noSmtp = loadConfig({ ...testEnv(api.db.url), SMTP_HOST: "", SMTP_PORT: "", SMTP_ENCRYPTION: "", SMTP_USERNAME: "", SMTP_PASSWORD: "", SMTP_FROM_NAME: "", SMTP_FROM_ADDRESS: "" });
  const ctx = { ...testContext(noSmtp, api.db.pool, api.clock.now), mailer: testMailer() };
  const message = { to: "guest@example.test", subject: "预订确认", text: "正文", html: "<p>正文</p>" };
  const missing = await sendMail(ctx, message);
  assert.deepEqual([missing.ok, !missing.ok && missing.code], [false, "NOT_CONFIGURED"]);

  await save(body(admin));
  await ctx.integrations.reloadNow();
  const sent = await sendMail(ctx, message);
  assert.equal(sent.ok, true, JSON.stringify(sent));
  assert.deepEqual(admin.messages[0]?.to, ["guest@example.test"]);
  assert.match(admin.messages[0]?.data ?? "", /multipart\/alternative/);

  admin.reset();
  for (const bad of [
    { ...message, subject: "预订确认\r\nBcc: attacker@example.test" },
    { ...message, subject: "预订确认\nBcc: attacker@example.test" },
    { ...message, to: "guest@example.test\r\nBcc: attacker@example.test" },
    { ...message, to: "guest@example.test, attacker@example.test" },
    { ...message, to: "Guest <guest@example.test>" },
    { ...message, subject: "" },
    { ...message, text: "" },
  ]) {
    const refused = await sendMail(ctx, bad);
    assert.deepEqual([refused.ok, !refused.ok && refused.code], [false, "MESSAGE_INVALID"], JSON.stringify(bad));
    assert.ok(!refused.ok && !refused.message.includes("attacker"), "不回显");
  }
  assert.equal(admin.connections(), 0, "不合格一个字节都不发");

  const nameInjection = await save(body(admin, { from_name: "NOZOMI\r\nBcc: attacker@example.test" }));
  assert.equal(nameInjection.status, 400);

  admin.behave({ rejectAuth: true });
  const failed = await sendMail(ctx, message);
  assert.deepEqual([failed.ok, !failed.ok && failed.code], [false, "AUTH_FAILED"]);
  await ctx.integrations.reloadNow();
});

test("后台那一份解不开：不生效、回落到配置文件，页面标出要重新填写；解不开也能清空", async () => {
  await save(body(admin));
  await call("PUT", `${PATH}/google-maps`, { body: { api_key: `AIza${randomBytes(14).toString("hex")}` } });
  await api.db.owner.query("update integration_secrets set sealed = (select sealed from integration_secrets where integration = 'google_maps') where integration = 'email'");
  const item = emailItem(await list());
  assert.deepEqual([item.source, item.admin.configured, item.admin.problem, item.masked], ["env", true, "UNREADABLE", last4(ENV_PASSWORD)]);
  assert.deepEqual(item.admin.hints, { password: last4(PASSWORD) });
  const cleared = await clear();
  assert.equal(cleared.status, 200, "解不开也能清空");
  const lastAudit = (await auditRows()).at(-1);
  assert.deepEqual(lastAudit.before, { hints: { password: last4(PASSWORD) } }, "解不开时只记打码的密码");
  await call("DELETE", `${PATH}/google-maps`);
});

test("其他两项不受影响：settings 是 null", async () => {
  const seen = await list();
  for (const key of ["google_maps", "stripe"]) assert.equal(seen.body.items.find((i: any) => i.key === key).settings, null, key);
  assert.deepEqual(seen.body.items.map((i: any) => i.key), ["google_maps", "stripe", "email"]);
});

test("服务器没有配置数据加密密钥：不能在后台填写（503），也不碰数据库", async () => {
  const config = loadConfig({ ...testEnv(api.db.url), DATA_ENCRYPTION_KEY: "" });
  const ctx = testContext(config, api.db.pool, api.clock.now);
  const settings = { host: "smtp.example.test", port: 587, encryption: "starttls", username: "u", password: PASSWORD, fromName: "n", fromAddress: "a@example.test" };
  await assert.rejects(saveIntegrationSecretValue(ctx, {} as PlatformPrincipal, { key: "email", settings }, "127.0.0.1"), (err: any) => err.statusCode === 503 && err.code === "INTEGRATION_ENCRYPTION_NOT_CONFIGURED" && !err.message.includes(PASSWORD));
  assert.equal((await api.db.owner.query("select count(*)::int as n from integration_secrets where integration = 'email'")).rows[0].n, 0);
});

test("两个人同时第一次填写：一条「填写」一条「更换」，只留一行", async () => {
  const [first, second] = await Promise.all([save(body(admin)), save(body(adminTwo, { password: PASSWORD_2 }))]);
  assert.deepEqual([first.body.action, second.body.action].sort(), ["replace", "set"]);
  assert.deepEqual((await auditRows()).map((r) => r.action), ["set", "replace"]);
});

test("租户拿不到任何相关信息：平台接口 401，租户一侧没有这样的接口，租户的数据库角色读不了这张表", async () => {
  await save(body(admin));
  for (const [method, url] of [["GET", PATH], ["PUT", `${PATH}/email`], ["DELETE", `${PATH}/email`], ["POST", `${PATH}/email/test`]] as const) {
    const res = await call(method, url, { token: tenant.adminToken, ...(method === "PUT" ? { body: body(admin) } : {}) });
    assert.equal(res.status, 401, `${method} ${url}`);
  }
  for (const url of ["/tenant/v1/integration-secrets", "/tenant/v1/integration-secrets/email"]) assert.equal((await call("GET", url, { token: tenant.adminToken })).status, 404);
  await assert.rejects(
    withTenantTx(api.db.pool, tenant.tenantId, (db) => db.query("select * from integration_secrets")),
    (err: any) => err.code === "42501",
  );
  assert.equal(admin.connections(), 0);
});

test("测试环境（staging）：不收明文、不收回环地址、不放开端口；库里已有的回环 / 明文配置不生效并标出，回落到配置文件", async () => {
  const staging = await createTestApi({
    env: { APP_ENV: "staging", GOOGLE_MAPS_ROUTES_URL: "", GOOGLE_PLACES_SEARCH_URL: "", GOOGLE_GEOCODE_URL: "", STRIPE_API_URL: "", SMTP_HOST: "", SMTP_PORT: "", SMTP_ENCRYPTION: "", SMTP_USERNAME: "", SMTP_PASSWORD: "", SMTP_FROM_NAME: "", SMTP_FROM_ADDRESS: "" },
    integrationSecretsTtlMs: 0,
  });
  try {
    const token = await staging.superAdminToken("root@staging.test");
    const ok = { host: "smtp.example.test", port: 587, encryption: "starttls", username: "u@example.test", password: PASSWORD, from_name: "NOZOMI", from_address: "noreply@example.test" };
    const staged = (extra: Record<string, unknown>): Promise<ApiResponse> => save({ ...ok, ...extra }, token, staging);
    assert.deepEqual(issuesOf(await staged({ encryption: "none" })), ["/encryption:ENCRYPTION_NOT_ALLOWED"]);
    for (const host of ["127.0.0.1", "localhost", "::1"]) assert.deepEqual(issuesOf(await staged({ host })), ["/host:HOST_FORBIDDEN"], host);
    assert.ok(issuesOf(await staged({ host: "127.0.0.1", port: admin.port })).includes("/port:PORT_NOT_ALLOWED"));

    const missing = await call("POST", `${PATH}/email/test`, { token, on: staging });
    assert.deepEqual([missing.status, missing.body.error.code], [409, "INTEGRATION_NOT_CONFIGURED"], "都没有配置");
    assert.equal(emailItem(await list(token, staging)).state, "missing");

    const saved = await staged({});
    assert.equal(saved.status, 200, saved.text);
    assert.equal(saved.body.item.source, "admin");

    // 库从 ci 搬过来的情况：明文 / 回环的配置解得开，但这个环境不生效
    const box = new SecretBox(testEnv(api.db.url)["DATA_ENCRYPTION_KEY"] as string);
    for (const carried of [{ host: "smtp.example.test", port: "587", encryption: "none" }, { host: "127.0.0.1", port: "587", encryption: "starttls" }]) {
      const sealed = box.seal("integration-secret", "email", JSON.stringify({ username: "u", password: PASSWORD, from_name: "n", from_address: "a@example.test", ...carried }));
      await staging.db.owner.query("update integration_secrets set sealed = $1 where integration = 'email'", [sealed]);
      const item = emailItem(await list(token, staging));
      assert.deepEqual([item.state, item.source, item.admin.problem, item.settings], ["missing", "none", "NOT_ALLOWED_IN_ENV", null], JSON.stringify(carried));
    }
    assert.ok(!staging.logs().includes(PASSWORD));
  } finally {
    await staging.close();
  }
  assert.equal(admin.connections(), 0);
});

test("日志里没有任何密码原文（含测试一下失败、校验不过的请求）", () => {
  const logs = api.logs();
  for (const secret of SECRETS) assert.ok(!logs.includes(secret), "日志里出现了密码原文");
  assert.ok(logs.length > 0);
});
