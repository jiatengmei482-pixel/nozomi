/**
 * QA（M4-14，ADR 0048）：运营后台邮件发送的集成测试，开发的 email-settings.itest.ts 没有覆盖的部分。
 * 连真实的 PostgreSQL 和本机假 SMTP；域名解析是替身，从不连真实的邮件服务。账号密码都是测试里现场拼的虚构值，每个用例前清掉 email 这一行。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { loadConfig } from "@nozomi/config";
import { MIGRATIONS_DIR, loadMigrationFiles, runMigrations } from "./db/migrate.ts";
import { SecretBox } from "./integrations/secret-box.ts";
import { SmtpMailer } from "./integrations/smtp.ts";
import { INTEGRATION_SECRETS_TTL_MS, INTEGRATION_TEST_INTERVAL_MS, IntegrationSecretCache } from "./services/integration-secrets.ts";
import { sendMail } from "./services/mail.ts";
import { createSuperAdmin } from "./services/platform-staff.ts";
import { type ApiResponse, TEST_PASSWORD, type TestApi, createTestApi, testContext } from "./testing/api.ts";
import { type FakeService, type FakeSmtp, startFakeGoogleRoutes, startFakeSmtp, startFakeStripe } from "./testing/fake-integrations.ts";
import { testEnv } from "./testing/fixtures.ts";

const fakePassword = (): string => `qa-pw-${randomBytes(12).toString("hex")}`;
const PASSWORD = fakePassword();
const PASSWORD_2 = fakePassword();
const ENV_PASSWORD = fakePassword();
const USERNAME = "qa-mailer@example.test";
const ROOT_EMAIL = "qa-root@platform.test";
const PATH = "/platform/v1/integration-secrets";
const NO_SMTP_ENV = { SMTP_HOST: "", SMTP_PORT: "", SMTP_ENCRYPTION: "", SMTP_USERNAME: "", SMTP_PASSWORD: "", SMTP_FROM_NAME: "", SMTP_FROM_ADDRESS: "" };
const last4 = (value: string): string => `••••${value.slice(-4)}`;
const MESSAGE = { to: "guest@example.test", subject: "预订确认", text: "正文" };
const silentLog = { warn: () => undefined };

const dns = new Map<string, string[]>();
const resolve = async (name: string): Promise<string[]> => {
  const found = dns.get(name);
  if (found === undefined) throw new Error("ENOTFOUND");
  return found;
};
const testMailer = (): SmtpMailer => new SmtpMailer({ allowLoopback: true, deadlineMs: 800, resolve });

let admin: FakeSmtp;
let adminTwo: FakeSmtp;
let envServer: FakeSmtp;
let google: FakeService;
let stripe: FakeService;
let api: TestApi;
let root: string;

const body = (fake: FakeSmtp, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ host: fake.host, port: fake.port, encryption: "none", username: USERNAME, password: PASSWORD, from_name: "NOZOMI 用车", from_address: "noreply@example.test", ...extra });
const save = (payload: unknown, token = root, on = api): Promise<ApiResponse> => on.call("PUT", `${PATH}/email`, { token, body: payload });
const emailOf = (res: ApiResponse): any => res.body.items.find((item: any) => item.key === "email");
const list = async (token = root, on = api): Promise<ApiResponse> => on.call("GET", PATH, { token });
const runTest = (token = root, url = `${PATH}/email/test`, on = api, payload?: unknown): Promise<ApiResponse> => on.call("POST", url, { token, ...(payload === undefined ? {} : { body: payload }) });
const pastInterval = (on = api): void => on.clock.advance(INTEGRATION_TEST_INTERVAL_MS);
const auditCount = async (): Promise<number> => (await api.db.owner.query("select count(*)::int as n from audit_logs where resource = 'integration_secret'")).rows[0].n;
const row = async (key = "email"): Promise<any> => (await api.db.owner.query("select * from integration_secrets where integration = $1", [key])).rows[0];
const box = (): SecretBox => new SecretBox(testEnv(api.db.url)["DATA_ENCRYPTION_KEY"] as string);

before(async () => {
  admin = await startFakeSmtp();
  adminTwo = await startFakeSmtp();
  envServer = await startFakeSmtp();
  google = await startFakeGoogleRoutes();
  stripe = await startFakeStripe();
  api = await createTestApi({
    env: { GOOGLE_MAPS_ROUTES_URL: google.url, STRIPE_API_URL: stripe.origin, SMTP_HOST: envServer.host, SMTP_PORT: String(envServer.port), SMTP_ENCRYPTION: "none", SMTP_USERNAME: "qa-env-user", SMTP_PASSWORD: ENV_PASSWORD, SMTP_FROM_NAME: "配置文件", SMTP_FROM_ADDRESS: "env@example.test" },
    integrationSecretsTtlMs: 0,
    mailer: testMailer(),
  });
  root = await api.superAdminToken(ROOT_EMAIL);
});
after(async () => {
  await api.close();
  await Promise.all([admin.close(), adminTwo.close(), envServer.close(), google.close(), stripe.close()]);
});
beforeEach(async () => {
  for (const fake of [admin, adminTwo, envServer]) fake.reset();
  dns.clear();
  await api.db.owner.query("delete from integration_secrets");
  await api.call("GET", PATH, { token: root });
});

// ---- 更换必须重填密码 ----

test("已经填过以后更换：密码留空、只有空白、不带这一项都被拒绝，旧配置一个字不变，旧密码不会被发到新主机", async () => {
  assert.equal((await save(body(admin))).status, 200);
  const stored = await row();
  const audits = await auditCount();
  for (const password of ["", "        ", "　　　　　　　　", "\n\t "]) {
    const res = await save(body(adminTwo, { password }));
    assert.equal(res.status, 400, JSON.stringify(password));
    assert.ok(res.body.error.details.issues.some((issue: any) => issue.path === "/password" && issue.reason === "REQUIRED"), res.text);
  }
  const { password: _omitted, ...withoutPassword } = body(adminTwo);
  assert.equal((await save(withoutPassword)).status, 400, "不带 password 这一项");
  assert.equal((await save(body(adminTwo, { password: null }))).status, 400, "password 是 null");

  const after = await row();
  assert.deepEqual([after.sealed, after.version], [stored.sealed, stored.version]);
  assert.equal(await auditCount(), audits, "被拒的不留审计");
  pastInterval();
  assert.equal((await runTest()).body.ok, true);
  assert.equal(adminTwo.connections(), 0, "新主机没有被连");
  assert.deepEqual(admin.auths.map((a) => a.pass), [PASSWORD]);
});

test("更换时任何一项不合格：整组不生效（不会只改了一半）", async () => {
  await save(body(admin));
  const stored = await row();
  for (const extra of [{ host: "10.0.0.8", port: 587 }, { encryption: "ssl" }, { from_address: "not-an-address" }, { from_name: "x\r\ny" }, { username: "a\u0000b" }, { password: "short" }]) {
    assert.equal((await save(body(adminTwo, { password: PASSWORD_2, ...extra }))).status, 400, JSON.stringify(extra));
  }
  assert.equal((await row()).sealed, stored.sealed);
  assert.equal(emailOf(await list()).masked, last4(PASSWORD));
});

// ---- 密码不外泄 ----

test("类型不对、太长的请求体：错误应答不回显填的值（含 password 不是字符串的时候）", async () => {
  const marker = `qa-echo-${randomBytes(8).toString("hex")}`;
  const cases: Record<string, unknown>[] = [
    { password: 12345678901 },
    { password: [marker] },
    { password: { value: marker } },
    { password: `${marker}${"x".repeat(1_000)}` },
    { password: `${marker}${"x".repeat(300)}` },
    { host: `${marker}${"x".repeat(1_000)}` },
    { username: { value: marker } },
    { from_name: [marker] },
    { from_address: `${marker}@` },
    { port: marker },
    { encryption: marker },
  ];
  for (const extra of cases) {
    const res = await save(body(admin, extra));
    assert.equal(res.status, 400, JSON.stringify(extra).slice(0, 40));
    assert.ok(!res.text.includes(marker), `应答回显了填的值：${res.text.slice(0, 200)}`);
    assert.ok(!res.text.includes("12345678901"));
  }
  assert.ok(!api.logs().includes(marker), "日志回显了填的值");
});

test("服务器的错误应答回显账号和密码：测试结果、审计、日志都没有", async () => {
  await save(body(admin));
  const echo = `${USERNAME} ${PASSWORD} qa-server-private-text`;
  for (const behavior of [{ rejectAuth: true }, { rejectSender: true }, { rejectRecipient: true }, { rejectData: true }]) {
    admin.reset();
    admin.behave({ ...behavior, errorDetail: echo });
    pastInterval();
    const res = await runTest();
    assert.equal(res.body.ok, false);
    for (const piece of [PASSWORD, USERNAME, "qa-server-private-text"]) assert.ok(!res.text.includes(piece), `应答里有 ${piece.slice(0, 6)}`);
  }
  admin.reset();
  const audits = (await api.db.owner.query("select after, before from audit_logs where resource = 'integration_secret' and action = 'test'")).rows;
  assert.ok(audits.length >= 4);
  const dump = JSON.stringify(audits);
  for (const piece of [PASSWORD, USERNAME, "qa-server-private-text"]) assert.ok(!dump.includes(piece), "审计里有");
  const logs = api.logs();
  for (const piece of [PASSWORD, "qa-server-private-text"]) assert.ok(!logs.includes(piece), "日志里有");
});

test("/health 不出现主机、账号、发件人、打码片段；超级管理员的状态说明是「主机:端口 · 来源（打码）」", async () => {
  await save(body(admin));
  const health = await api.call("GET", "/health");
  for (const piece of [admin.host, USERNAME, "noreply@example.test", last4(PASSWORD), PASSWORD, ENV_PASSWORD]) assert.ok(!health.text.includes(piece), `/health 里有 ${piece}`);

  const overview = await api.call("GET", "/platform/v1/integrations", { token: root });
  assert.equal(overview.status, 200);
  assert.equal(overview.body.items.find((item: any) => item.key === "email").detail, `${admin.host}:${admin.port} · 后台设置（${last4(PASSWORD)}）`);
  assert.ok(!overview.text.includes(PASSWORD));
});

test("保存之后马上进日志脱敏的名单（不用重启）；主机不合格、没有生效的那一份的密码也要抹", async () => {
  const live = fakePassword();
  await save(body(admin, { password: live }));
  await api.call("GET", `/platform/v1/qa-no-such-route/${live}`, { token: root });
  assert.ok(!api.logs().includes(live), "刚保存的密码进了日志");

  const parked = fakePassword();
  const sealed = box().seal("integration-secret", "email", JSON.stringify({ host: "10.0.0.8", port: "587", encryption: "starttls", username: "u", password: parked, from_name: "n", from_address: "a@example.test" }));
  await api.db.owner.query("update integration_secrets set sealed = $1 where integration = 'email'", [sealed]);
  await list();
  await api.call("GET", `/platform/v1/qa-no-such-route/${parked}`, { token: root });
  assert.ok(!api.logs().includes(parked), "没生效的那一份的密码进了日志");
});

test("密码的末尾是表情（一个字符两个编码单元）：能保存，打码不会切出半个字符", async () => {
  const password = `${fakePassword()}😀😀a`;
  const res = await save(body(admin, { password }));
  assert.ok(!api.logs().includes(password), "出错时日志里也不能有密码");
  assert.ok(!res.text.includes(password));
  assert.equal(res.status, 200, `应当能保存，实际 ${res.status}：${res.text.slice(0, 200)}`);
  const masked = res.body.item.masked as string;
  assert.doesNotThrow(() => encodeURIComponent(masked), "打码后的文字不能有半个字符");
  assert.ok(JSON.stringify((await row()).hints).length > 0);
  pastInterval();
  assert.equal((await runTest()).body.ok, true);
  assert.equal(admin.auths[0]?.pass, password);
});

// ---- 权限 ----

test("必须先改密码的超级管理员：不能保存、清空、测试，不发信；清空也没有动数据", async () => {
  await save(body(admin));
  const email = "qa-temporary@platform.test";
  await createSuperAdmin(api.db.pool, { email, name: "临时密码", password: TEST_PASSWORD, temporaryPassword: true }, api.clock.now());
  const login = await api.platformLogin({ body: { email, password: TEST_PASSWORD } });
  assert.equal(login.status, 200, login.text);
  const token = login.body.access_token as string;
  const stored = await row();
  admin.reset();
  for (const res of [await save(body(adminTwo, { password: PASSWORD_2 }), token), await api.call("DELETE", `${PATH}/email`, { token }), await runTest(token)]) assert.equal(res.status, 403, res.text);
  assert.equal((await row()).sealed, stored.sealed);
  assert.equal(admin.connections() + adminTwo.connections(), 0);
});

test("自建角色勾不了「集成状态 · 编辑」：想给自己开发信权限的路走不通", async () => {
  const res = await api.call("POST", "/platform/v1/roles", { token: root, body: { name: "QA 想发信", grants: ["integrations:edit"] } });
  assert.ok(res.status >= 400 && res.status < 500, res.text);
});

test("没有令牌、乱写的令牌：401，不连接", async () => {
  await save(body(admin));
  admin.reset();
  for (const [method, url] of [["PUT", `${PATH}/email`], ["DELETE", `${PATH}/email`], ["POST", `${PATH}/email/test`]] as const) {
    assert.equal((await api.call(method, url, method === "PUT" ? { body: body(adminTwo) } : {})).status, 401, url);
    assert.equal((await api.call(method, url, { token: "qa.not.a-token", ...(method === "PUT" ? { body: body(adminTwo) } : {}) })).status, 401, url);
  }
  assert.equal(admin.connections() + adminTwo.connections(), 0);
});

test("测试邮件的收件人不能由请求指定：查询参数、请求体里的邮件头注入都不看", async () => {
  await save(body(admin));
  pastInterval();
  const res = await runTest(root, `${PATH}/email/test?to=attacker@example.test&recipient=attacker@example.test&email=attacker@example.test`, api, { to: ["attacker@example.test"], subject: "x\r\nBcc: attacker@example.test", from: "attacker@example.test", email: "attacker@example.test", user_email: "attacker@example.test" });
  assert.equal(res.body.ok, true, res.text);
  assert.deepEqual(admin.messages[0]?.to, [ROOT_EMAIL]);
  assert.ok(!admin.messages[0]?.data.includes("attacker"));
  assert.ok(!res.text.includes("attacker"));
});

// ---- 频率限制 ----

test("同时点两次「测试一下」：只有一个发信，另一个 429", async () => {
  await save(body(admin));
  pastInterval();
  admin.reset();
  const results = await Promise.all([runTest(), runTest(), runTest()]);
  assert.deepEqual(results.map((res) => res.status).sort(), [200, 429, 429]);
  assert.equal(admin.messages.length, 1);
});

test("限速按项算：邮件刚测过，谷歌地图、Stripe 不受影响；反过来也一样", async () => {
  await save(body(admin));
  pastInterval();
  assert.equal((await runTest()).status, 200);
  assert.equal((await runTest(root, `${PATH}/google-maps/test`)).status, 200, "邮件不占谷歌地图的额度");
  assert.equal((await runTest(root, `${PATH}/stripe/test`)).status, 200, "邮件不占 Stripe 的额度");
  pastInterval();
  assert.equal((await runTest(root, `${PATH}/stripe/test`)).status, 200);
  assert.equal((await runTest()).status, 200, "Stripe 不占邮件的额度");
});

test("没配置时点测试不占额度：409 之后马上填写，马上能测；清空后回到 409", async () => {
  const blank = await createTestApi({ env: NO_SMTP_ENV, integrationSecretsTtlMs: 0, mailer: testMailer() });
  try {
    const token = await blank.superAdminToken("qa-blank@platform.test");
    const missing = await runTest(token, undefined, blank);
    assert.deepEqual([missing.status, missing.body.error.code], [409, "INTEGRATION_NOT_CONFIGURED"]);
    assert.equal((await save(body(admin), token, blank)).status, 200);
    const sent = await runTest(token, undefined, blank);
    assert.deepEqual([sent.status, sent.body.ok], [200, true], sent.text);
    assert.equal((await blank.call("DELETE", `${PATH}/email`, { token })).status, 200);
    blank.clock.advance(INTEGRATION_TEST_INTERVAL_MS);
    assert.equal((await runTest(token, undefined, blank)).status, 409);
    const item = emailOf(await list(token, blank));
    assert.deepEqual([item.state, item.source, item.masked, item.settings], ["missing", "none", null, null]);
  } finally {
    await blank.close();
  }
});

// ---- 立即生效、多实例 ----

test("另一个服务进程（自己的缓存）：过了缓存时间，下一封就用新的配置；清空后回落配置文件；旧密码不再被使用", async () => {
  const config = loadConfig({ ...testEnv(api.db.url), SMTP_HOST: envServer.host, SMTP_PORT: String(envServer.port), SMTP_ENCRYPTION: "none", SMTP_USERNAME: "qa-env-user", SMTP_PASSWORD: ENV_PASSWORD, SMTP_FROM_NAME: "配置文件", SMTP_FROM_ADDRESS: "env@example.test" });
  const base = testContext(config, api.db.pool, api.clock.now);
  const ttlMs = 80;
  const other = { ...base, mailer: testMailer(), integrations: new IntegrationSecretCache({ pool: api.db.pool, config, secretBox: base.secretBox, log: silentLog, ttlMs }) };
  const waitTtl = (): Promise<void> => new Promise((done) => setTimeout(done, ttlMs + 20));

  assert.equal((await sendMail(other, MESSAGE)).ok, true);
  assert.equal(envServer.messages.length, 1, "一开始走配置文件");

  await save(body(admin));
  await waitTtl();
  assert.equal((await sendMail(other, MESSAGE)).ok, true);
  assert.deepEqual([admin.messages.length, envServer.messages.length], [1, 1], "另一个进程改用后台的");

  await save(body(adminTwo, { password: PASSWORD_2 }));
  await waitTtl();
  assert.equal((await sendMail(other, MESSAGE)).ok, true);
  assert.deepEqual(adminTwo.auths.map((a) => a.pass), [PASSWORD_2]);
  assert.equal(admin.messages.length, 1, "旧服务器不再收到");
  assert.ok(other.integrations.secretValues().includes(PASSWORD_2), "新密码进了这个进程的脱敏名单");
  assert.ok(!other.integrations.secretValues().includes(PASSWORD));

  assert.equal((await api.call("DELETE", `${PATH}/email`, { token: root })).status, 200);
  await waitTtl();
  assert.equal((await sendMail(other, MESSAGE)).ok, true);
  assert.equal(envServer.messages.length, 2, "清空后回落配置文件");
  assert.equal(adminTwo.messages.length, 1);
  assert.equal(other.integrations.effective.email.source, "env");
});

test("配置文件也没有时，另一个进程：清空后 sendMail 返回 NOT_CONFIGURED，不抛错；默认缓存时间不超过 ADR 约定的 5 秒", async () => {
  assert.ok(INTEGRATION_SECRETS_TTL_MS <= 5_000);
  const config = loadConfig({ ...testEnv(api.db.url), ...NO_SMTP_ENV });
  const base = testContext(config, api.db.pool, api.clock.now);
  const other = { ...base, mailer: testMailer(), integrations: new IntegrationSecretCache({ pool: api.db.pool, config, secretBox: base.secretBox, log: silentLog, ttlMs: 1 }) };
  await save(body(admin));
  await new Promise((done) => setTimeout(done, 5));
  assert.equal((await sendMail(other, MESSAGE)).ok, true);
  await api.call("DELETE", `${PATH}/email`, { token: root });
  await new Promise((done) => setTimeout(done, 5));
  const missing = await sendMail(other, MESSAGE);
  assert.deepEqual([missing.ok, !missing.ok && missing.code], [false, "NOT_CONFIGURED"]);
  assert.ok(!missing.ok && !missing.message.includes(PASSWORD));
});

test("数据库连不上时 sendMail 也不抛异常（用手上的配置）", async () => {
  const config = loadConfig({ ...testEnv(api.db.url), ...NO_SMTP_ENV });
  const base = testContext(config, api.db.pool, api.clock.now);
  const brokenPool = { connect: async () => { throw new Error("qa-db-down"); }, query: async () => { throw new Error("qa-db-down"); } } as unknown as typeof api.db.pool;
  const warnings: string[] = [];
  const other = { ...base, mailer: testMailer(), integrations: new IntegrationSecretCache({ pool: brokenPool, config, secretBox: base.secretBox, log: { warn: (_o, msg) => void warnings.push(msg) }, ttlMs: 1 }) };
  const result = await sendMail(other, MESSAGE);
  assert.deepEqual([result.ok, !result.ok && result.code], [false, "NOT_CONFIGURED"]);
  assert.equal(warnings.length, 1);
});

// ---- 防 SSRF：读出、连接时、真实装配 ----

test("库里已有的后台配置主机是内网（local / ci 也一样）：不生效、标出、回落配置文件，发信不连它", async () => {
  await save(body(admin));
  for (const host of ["10.0.0.8", "169.254.169.254", "::ffff:10.0.0.8", "smtp.internal", "2130706433"]) {
    const sealed = box().seal("integration-secret", "email", JSON.stringify({ host, port: "587", encryption: "starttls", username: "u", password: PASSWORD, from_name: "n", from_address: "a@example.test" }));
    await api.db.owner.query("update integration_secrets set sealed = $1 where integration = 'email'", [sealed]);
    const item = emailOf(await list());
    assert.deepEqual([item.source, item.admin.problem, item.settings.host], ["env", "NOT_ALLOWED_IN_ENV", envServer.host], host);
    pastInterval();
    envServer.reset();
    assert.deepEqual([(await runTest()).body.ok, envServer.messages.length], [true, 1], host);
  }
});

test("库里的配置被改过（端口、加密方式、地址不合规则）：不生效，不会照着连", async () => {
  await save(body(admin));
  for (const carried of [{ port: "22", host: "smtp.example.test" }, { port: "abc", host: "smtp.example.test" }, { port: "587", host: "smtp.example.test", encryption: "ssl" }, { port: "587", host: "smtp.example.test", from_address: "a@b.test\r\nBcc: attacker@example.test" }, { port: "587", host: "smtp.example.test", from_name: "x\r\nBcc: attacker@example.test" }]) {
    const sealed = box().seal("integration-secret", "email", JSON.stringify({ encryption: "starttls", username: "u", password: PASSWORD, from_name: "n", from_address: "a@example.test", ...carried }));
    await api.db.owner.query("update integration_secrets set sealed = $1 where integration = 'email'", [sealed]);
    const item = emailOf(await list());
    assert.deepEqual([item.source, item.admin.problem], ["env", "NOT_ALLOWED_IN_ENV"], JSON.stringify(carried));
  }
});

test("连接时才查：保存时是公网名字，发信时才解析到内网（DNS 重绑定）；再变回公网才发", async () => {
  dns.set("smtp.flip.test", ["8.8.8.8"]);
  assert.equal((await save(body(admin, { host: "smtp.flip.test", port: 587 }))).status, 200, "保存不解析");
  for (const addresses of [["127.0.0.1", "10.0.0.8"], ["10.0.0.8"], ["::ffff:169.254.169.254"], ["fd00:ec2::254"], ["100.64.0.1"], ["0.0.0.0"]]) {
    dns.set("smtp.flip.test", addresses);
    pastInterval();
    const res = await runTest();
    assert.deepEqual([res.status, res.body.ok, res.body.code], [200, false, "TARGET_FORBIDDEN"], addresses.join());
    assert.ok(!res.text.includes(addresses[0]!), "不回显解析到的内部地址");
  }
  assert.equal(admin.connections(), 0);
});

test("IPv6 映射、方括号、尾点、区域标识、大写：保存时都拒绝，不留记录", async () => {
  for (const host of ["::FFFF:A00:8", "0:0:0:0:0:ffff:a00:8", "64:ff9b::a00:8", "2002:a00:8::", "[fe80::1]", "fe80::1%eth0", "10.0.0.8.", "SMTP.INTERNAL", "Mail.Local", "0X7F.1", "127.1", "0177.0.0.1", "0xa9fea9fe"]) {
    const res = await save(body(admin, { host, port: 587 }));
    assert.equal(res.status, 400, host);
    assert.ok(!res.text.includes(host), "不回显");
    assert.equal(await row(), undefined, host);
  }
});

test("测试环境的真实装配：配置文件里写回环、内网、元数据地址，发信一律 TARGET_FORBIDDEN，不连接（回环的例外打不开）", async () => {
  for (const host of ["127.0.0.1", "10.0.0.8", "169.254.169.254"]) {
    const staging = await createTestApi({ env: { APP_ENV: "staging", GOOGLE_MAPS_ROUTES_URL: "", GOOGLE_PLACES_SEARCH_URL: "", GOOGLE_PLACES_AUTOCOMPLETE_URL: "", GOOGLE_PLACE_DETAILS_URL: "", GOOGLE_GEOCODE_URL: "", STRIPE_API_URL: "", SMTP_HOST: host, SMTP_PORT: "587", SMTP_ENCRYPTION: "starttls", SMTP_USERNAME: "qa-env-user", SMTP_PASSWORD: ENV_PASSWORD, SMTP_FROM_NAME: "配置文件", SMTP_FROM_ADDRESS: "env@example.test" }, integrationSecretsTtlMs: 0 });
    try {
      const token = await staging.superAdminToken("qa-staging@platform.test");
      const res = await runTest(token, undefined, staging);
      assert.deepEqual([res.status, res.body.ok, res.body.code], [200, false, "TARGET_FORBIDDEN"], host);
    } finally {
      await staging.close();
    }
  }
});

// ---- 不影响谷歌地图、Stripe ----

test("保存、更换、清空邮件：谷歌地图、Stripe 的行一个字节不动；它们的审计没有 settings；邮件和它们互不串", async () => {
  const mapsKey = `AIza${randomBytes(14).toString("hex")}`;
  const stripeKeys = { secret_key: `sk_test_${randomBytes(14).toString("hex")}`, publishable_key: `pk_test_${randomBytes(14).toString("hex")}`, webhook_secret: `whsec_${randomBytes(14).toString("hex")}` };
  assert.equal((await api.call("PUT", `${PATH}/google-maps`, { token: root, body: { api_key: mapsKey } })).status, 200);
  assert.equal((await api.call("PUT", `${PATH}/stripe`, { token: root, body: stripeKeys })).status, 200);
  const before = { maps: await row("google_maps"), stripe: await row("stripe") };

  await save(body(admin));
  await save(body(adminTwo, { password: PASSWORD_2 }));
  assert.equal((await api.call("DELETE", `${PATH}/email`, { token: root })).status, 200);

  assert.deepEqual(await row("google_maps"), before.maps);
  assert.deepEqual(await row("stripe"), before.stripe);
  const seen = await list();
  const other = (key: string): any => seen.body.items.find((item: any) => item.key === key);
  assert.deepEqual([other("google_maps").source, other("google_maps").masked, other("google_maps").settings], ["admin", last4(mapsKey), null]);
  assert.deepEqual([other("stripe").source, other("stripe").masked, other("stripe").mode, other("stripe").settings], ["admin", last4(stripeKeys.secret_key), "test", null]);
  assert.equal(emailOf(seen).source, "env");

  const audits = (await api.db.owner.query("select resource_id, after, before from audit_logs where resource = 'integration_secret' and resource_id in ('google_maps', 'stripe') and action = 'set'")).rows;
  assert.ok(audits.length >= 2);
  for (const audit of audits) assert.ok(!("settings" in (audit.after ?? {})), audit.resource_id);

  // 清空别的项不动邮件
  await save(body(admin));
  const email = await row();
  assert.equal((await api.call("DELETE", `${PATH}/stripe`, { token: root })).status, 200);
  assert.equal((await api.call("DELETE", `${PATH}/google-maps`, { token: root })).status, 200);
  assert.deepEqual(await row(), email);
  assert.equal(emailOf(await list()).source, "admin");
});

test("一项的请求体不能写到另一项；路径只认 google-maps、stripe、email", async () => {
  assert.equal((await api.call("PUT", `${PATH}/stripe`, { token: root, body: body(admin) })).status, 400);
  assert.equal((await api.call("PUT", `${PATH}/google-maps`, { token: root, body: body(admin) })).status, 400);
  assert.equal((await save({ api_key: `AIza${randomBytes(14).toString("hex")}` })).status, 400);
  for (const key of ["EMAIL", "e-mail", "smtp", "email_", "email%00"]) assert.equal((await api.call("PUT", `${PATH}/${key}`, { token: root, body: body(admin) })).status, 404, key);
  assert.equal(await row(), undefined);
});

test("另一项解不开时邮件不受连累", async () => {
  await save(body(admin));
  await api.call("PUT", `${PATH}/google-maps`, { token: root, body: { api_key: `AIza${randomBytes(14).toString("hex")}` } });
  await api.db.owner.query("update integration_secrets set sealed = (select sealed from integration_secrets where integration = 'email') where integration = 'google_maps'");
  const seen = await list();
  assert.equal(seen.status, 200);
  assert.deepEqual([emailOf(seen).source, emailOf(seen).admin.problem], ["admin", null]);
  assert.equal(seen.body.items.find((item: any) => item.key === "google_maps").admin.problem, "UNREADABLE");
});

// ---- 迁移 ----

test("迁移：再跑一遍迁移命令没有动作；0130 的语句重复执行不报错；放宽后旧数据仍然合法，不认识的取值仍然被拒绝", async () => {
  const again = await runMigrations(api.db.owner, await loadMigrationFiles());
  assert.deepEqual(again.applied, [], "迁移已执行过");

  await api.call("PUT", `${PATH}/google-maps`, { token: root, body: { api_key: `AIza${randomBytes(14).toString("hex")}` } });
  await api.call("PUT", `${PATH}/stripe`, { token: root, body: { secret_key: `sk_test_${randomBytes(14).toString("hex")}`, publishable_key: `pk_test_${randomBytes(14).toString("hex")}`, webhook_secret: `whsec_${randomBytes(14).toString("hex")}` } });
  await save(body(admin));

  const sql = await readFile(new URL("0130_integration_secrets_email.sql", `file://${MIGRATIONS_DIR}`), "utf8");
  const client = await api.db.owner.connect();
  try {
    await client.query("begin");
    await client.query("alter table integration_secrets drop constraint integration_secrets_integration_check");
    await client.query("delete from integration_secrets where integration = 'email'");
    await client.query("alter table integration_secrets add constraint integration_secrets_integration_check check (integration in ('google_maps', 'stripe'))");
    await client.query("savepoint before_0130");
    await assert.rejects(client.query("update integration_secrets set integration = 'email' where integration = 'stripe'"), (err: any) => err.code === "23514", "0130 之前不收 email");
    await client.query("rollback to savepoint before_0130");

    await client.query(sql);
    await client.query(sql);
    const rows = (await client.query("select integration from integration_secrets order by integration")).rows.map((r: any) => r.integration);
    assert.deepEqual(rows, ["google_maps", "stripe"], "旧数据还在");
    await client.query("savepoint after_0130");
    await assert.rejects(client.query("update integration_secrets set integration = 'qa-unknown' where integration = 'stripe'"), (err: any) => err.code === "23514");
    await client.query("rollback to savepoint after_0130");
    await client.query("update integration_secrets set integration = 'email' where integration = 'stripe'");
    const definition = (await client.query("select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'integration_secrets_integration_check' and conrelid = 'integration_secrets'::regclass")).rows;
    assert.equal(definition.length, 1, "没有留下第二条约束");
    assert.match(definition[0].def, /email/);
  } finally {
    await client.query("rollback");
    client.release();
  }
  assert.equal((await list()).status, 200);
  assert.equal(emailOf(await list()).source, "admin", "回滚之后数据如旧");
});
