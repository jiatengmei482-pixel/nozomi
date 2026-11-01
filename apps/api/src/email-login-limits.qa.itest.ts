/**
 * QA（M4-06，ADR 0050）：邮箱验证码的暴力破解和限速。开发的 email-login.itest.ts 没有覆盖的部分：
 * 一天到底能猜多少次、并发下计数不少算、发码冷却的毫秒边界、邮箱写法的规范化、来源地址只信配置的代理层数。
 * 连真实的 PostgreSQL 和本机假 SMTP，账号都是测试里现场构造的虚构值。
 */
import { after, afterEach, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHmac, hkdfSync } from "node:crypto";
import { EMAIL_CODE_RESEND_INTERVAL_MS, EMAIL_CODE_TTL_MS } from "@nozomi/domain";
import { SmtpMailer } from "./integrations/smtp.ts";
import { createSuperAdmin } from "./services/platform-staff.ts";
import { type ApiResponse, TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";
import { type FakeSmtp, decodedMailText, startFakeSmtp } from "./testing/fake-integrations.ts";
import { FAKE_SECRETS } from "./testing/fixtures.ts";

type Portal = "platform" | "tenant";

const SMTP_ENV = (fake: FakeSmtp): Record<string, string> => ({ SMTP_HOST: fake.host, SMTP_PORT: String(fake.port), SMTP_ENCRYPTION: "none", SMTP_USERNAME: "qa-mailer@example.test", SMTP_PASSWORD: "qa-fake-smtp-password", SMTP_FROM_NAME: "NOZOMI", SMTP_FROM_ADDRESS: "noreply@example.test" });
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

let smtp: FakeSmtp;
let api: TestApi;
let ipCounter = 0;
/** 每次一个新地址：测的是邮箱维度，不让地址维度先拦下 */
const nextIp = (): string => {
  ipCounter += 1;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
};

function requestPlain(portal: Portal, email: string, ip: string, headers?: Record<string, string>, on: TestApi = api): Promise<ApiResponse> {
  return on.call("POST", `/${portal}/v1/auth/email-code/request`, { body: { email }, ip, ...(headers === undefined ? {} : { headers }) });
}

function verifyPlain(portal: Portal, email: string, code: string, ip: string, headers?: Record<string, string>, on: TestApi = api): Promise<ApiResponse> {
  return on.call("POST", `/${portal}/v1/auth/email-code/verify`, { body: { email, code }, ip, ...(headers === undefined ? {} : { headers }) });
}

async function requestCode(portal: Portal, email: string, ip = nextIp()): Promise<ApiResponse> {
  const res = await requestPlain(portal, email, ip);
  await api.app.emailLoginIdle();
  return res;
}

async function verify(portal: Portal, email: string, code: string, ip = nextIp()): Promise<ApiResponse> {
  const res = await verifyPlain(portal, email, code, ip);
  await api.app.emailLoginIdle();
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

/** 这个邮箱的码在库里的键：和服务端同样的派生（密钥是测试配置里的假值）。 */
function emailKeyOf(portal: Portal, email: string): string {
  const key = Buffer.from(hkdfSync("sha256", FAKE_SECRETS.authJwtSecret, Buffer.alloc(0), "nozomi/email-login-code/v1", 32));
  return createHmac("sha256", key).update(["email", portal, email].join("\n"), "utf8").digest("hex");
}

async function attemptsOf(portal: Portal, email: string): Promise<number | null> {
  const rows = (await api.db.owner.query("select attempt_count from email_login_codes where email_key = $1", [emailKeyOf(portal, email)])).rows;
  return rows.length === 0 ? null : (rows[0].attempt_count as number);
}

before(async () => {
  smtp = await startFakeSmtp();
  api = await createTestApi({ env: SMTP_ENV(smtp), integrationSecretsTtlMs: 0, mailer: new SmtpMailer({ allowLoopback: true, deadlineMs: 2_000 }) });
});
after(async () => {
  await api.close();
  await smtp.close();
});
afterEach(async () => {
  smtp.reset();
  smtp.behave({});
  // 这组测试把时钟拨得很远，也故意打满地址和邮箱的计数：用例之间互不依赖
  await api.db.owner.query("delete from login_throttles");
  await api.db.owner.query("delete from email_login_codes");
});

/** 发一封，把这个码的 5 次全用错码猜完。发不出来（被限速）返回 0，否则返回 5；每一次猜测都核对库里的计数确实加一。 */
async function burnOneCode(email: string): Promise<number> {
  const sent = await requestCode("platform", email);
  if (sent.status !== 202) return 0;
  const code = latestCode(email);
  assert.equal(await attemptsOf("platform", email), 0, "新码从 0 次开始");
  for (let i = 0; i < 5; i++) {
    assert.equal((await verify("platform", email, wrongCode(code))).status, 401, `第 ${i + 1} 次`);
    assert.equal(await attemptsOf("platform", email), i + 1, "每一次都真的比较过、计了数");
  }
  return 5;
}

test("发新码重置单码次数，但一个邮箱在一个 24 小时窗口内实际能猜的次数正好 100（ADR 第 4 节：20 个码 × 5 次），第 21 封发不出来", async () => {
  const email = "qa-daily-guess@platform.test";
  await staff(email);
  const started = api.clock.now().getTime();
  let guesses = 0;
  for (let round = 0; round < 20; round++) {
    guesses += await burnOneCode(email);
    api.clock.advance(4 * MINUTE);
  }
  assert.equal(guesses, 100);
  const code = latestCode(email);
  assert.equal((await verify("platform", email, code)).status, 401, "次数用尽后正确的码也不行");
  api.clock.advance(24 * HOUR - MINUTE - (api.clock.now().getTime() - started));
  const blocked = await requestCode("platform", email);
  assert.equal(blocked.status, 429, "窗口结束前一分钟还是发不出第 21 封");
  assert.ok(Number(blocked.headers["retry-after"]) <= 60);
});

test("固定窗口（ADR 第 4 节）：卡着窗口交界，短时峰值可到两个窗口的额度，不超过 40 个码、200 次猜测", async () => {
  const email = "qa-window-edge@platform.test";
  await staff(email);
  const windowStart = api.clock.now().getTime();
  // 第一封确定 24 小时窗口的起点；在窗口结束前 76 分钟回来，每 4 分钟一个码（15 分钟 5 封、校验 15 分钟 20 次都不超），一直到新窗口的额度也用完
  assert.equal(await burnOneCode(email), 5);
  api.clock.advance(24 * HOUR - 76 * MINUTE);
  const attackStart = api.clock.now().getTime();
  let guesses = 5;
  let sends = 1;
  for (let round = 0; round < 40; round++) {
    const made = await burnOneCode(email);
    guesses += made;
    if (made > 0) sends += 1;
    api.clock.advance(4 * MINUTE);
  }
  const spanHours = (api.clock.now().getTime() - attackStart) / HOUR;
  assert.ok(spanHours < 3, `这段时间是 ${spanHours} 小时`);
  assert.ok(windowStart < attackStart);
  const peak = `${spanHours.toFixed(1)} 小时内发出 ${sends} 个码、猜了 ${guesses} 次`;
  assert.ok(sends <= 40, `${peak}，超过两倍`);
  assert.ok(guesses <= 200, `${peak}，超过两倍`);
});

test("并发猜错：4 个错码同时提交，计数正好 +4，一次都不少算；第 5 次用正确的码仍然能进", async () => {
  const email = "qa-concurrent-count@platform.test";
  await staff(email);
  await requestCode("platform", email);
  const code = latestCode(email);
  const results = await Promise.all(Array.from({ length: 4 }, () => verifyPlain("platform", email, wrongCode(code), nextIp())));
  await api.app.emailLoginIdle();
  assert.ok(results.every((res) => res.status === 401));
  assert.equal(await attemptsOf("platform", email), 4);
  assert.equal((await verify("platform", email, code)).status, 200);
  assert.equal(await attemptsOf("platform", email), null, "用过之后这一行没了");
});

test("并发混合：错码和对的码一起提交 6 次，计数不超过 5，登录最多成功一次", async () => {
  const email = "qa-concurrent-mixed@platform.test";
  await staff(email);
  await requestCode("platform", email);
  const code = latestCode(email);
  const submissions = [code, wrongCode(code), wrongCode(code), code, wrongCode(code), wrongCode(code)];
  const results = await Promise.all(submissions.map((value) => verifyPlain("platform", email, value, nextIp())));
  await api.app.emailLoginIdle();
  assert.ok(results.filter((res) => res.status === 200).length <= 1);
  const sessions = (await api.db.owner.query("select count(*)::int as n from platform_sessions s join platform_users u on u.id = s.user_id where u.email = $1", [email])).rows[0].n;
  assert.equal(sessions, results.filter((res) => res.status === 200).length);
});

test("并发正确的码（租户入口）：只成功一次，只有一个会话", async () => {
  const email = "qa-concurrent-tenant@fleet.test";
  const root = await api.superAdminToken("qa-limits-root@platform.test");
  await api.tenantWithAdmin(root, "QA 并发车队", email);
  const baseline = (await api.db.owner.query("select count(*)::int as n from tenant_sessions s join tenant_users u on u.id = s.user_id where u.email = $1", [email])).rows[0].n as number;
  await requestCode("tenant", email);
  const code = latestCode(email);
  const results = await Promise.all(Array.from({ length: 10 }, () => verifyPlain("tenant", email, code, nextIp())));
  await api.app.emailLoginIdle();
  assert.deepEqual(results.map((res) => res.status).sort(), [200, 401, 401, 401, 401, 401, 401, 401, 401, 401]);
  const sessions = (await api.db.owner.query("select count(*)::int as n from tenant_sessions s join tenant_users u on u.id = s.user_id where u.email = $1", [email])).rows[0].n as number;
  assert.equal(sessions, baseline + 1);
});

test("并发发码：同一邮箱的各种写法同时提交 8 次，只有一个 202，只发一封", async () => {
  const email = "qa-concurrent-send@platform.test";
  await staff(email);
  const variants = [email, email.toUpperCase(), ` ${email}`, `${email} `, "QA-Concurrent-Send@Platform.Test", email, email, email];
  const results = await Promise.all(variants.map((value) => requestPlain("platform", value, nextIp())));
  await api.app.emailLoginIdle();
  assert.deepEqual(results.map((res) => res.status).sort(), [202, 429, 429, 429, 429, 429, 429, 429]);
  assert.equal(smtp.messages.length, 1);
  assert.deepEqual(smtp.messages[0]?.to, [email], "发到规范化后的地址");
});

test("发码冷却的毫秒边界：59.999 秒还是 429，60 秒整放行；Retry-After 不会是 0", async () => {
  const email = "qa-cooldown-edge@platform.test";
  await staff(email);
  assert.equal((await requestCode("platform", email)).status, 202);
  api.clock.advance(EMAIL_CODE_RESEND_INTERVAL_MS - 1);
  const blocked = await requestCode("platform", email);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers["retry-after"], "1");
  api.clock.advance(1);
  assert.equal((await requestCode("platform", email)).status, 202);
});

test("校验：同一地址 15 分钟 50 次（ADR 第 4 节），换邮箱绕不过；到了上限正确的码也不放行；被拦下的不占别的邮箱的次数", async () => {
  const email = "qa-ip-limit-victim@platform.test";
  await staff(email);
  await requestCode("platform", email);
  const code = latestCode(email);
  const ip = "203.0.113.150";
  for (let i = 0; i < 50; i++) assert.equal((await verifyPlain("platform", `qa-ip-limit-${i}@platform.test`, "000000", ip)).status, 401, `第 ${i + 1} 次`);
  await api.app.emailLoginIdle();
  const blocked = await verify("platform", email, code, ip);
  assert.deepEqual([blocked.status, blocked.body.error.code], [429, "TOO_MANY_LOGIN_ATTEMPTS"]);
  assert.equal(await attemptsOf("platform", email), 0, "被拦下的不占这个码的次数");
  assert.equal((await verify("platform", email, code)).status, 200, "换一个地址，这个人照常能登录");
});

test("过期之后再猜不占次数也不复活；旧的行不影响发新码，新码从 0 开始", async () => {
  const email = "qa-expired-row@platform.test";
  await staff(email);
  await requestCode("platform", email);
  const old = latestCode(email);
  await verify("platform", email, wrongCode(old));
  api.clock.advance(EMAIL_CODE_TTL_MS);
  assert.equal((await verify("platform", email, old)).status, 401);
  assert.equal(await attemptsOf("platform", email), 1, "过期的码不再计数");
  api.clock.advance(HOUR);
  await requestCode("platform", email);
  assert.equal(await attemptsOf("platform", email), 0);
});

test("规范化：大小写、首尾空格（含全角、不换行空格）、K 的开尔文写法都算同一个邮箱，共用冷却和校验计数，不能靠写法绕过", async () => {
  const email = "qa-kate-norm@platform.test";
  await staff(email);
  const ip = "203.0.113.160";
  const variants = ["QA-KATE-NORM@PLATFORM.TEST", ` ${email}`, `${email}　`, ` ${email}`, `\t${email}\r\n`, "qa-Kate-norm@platform.test"];
  assert.equal((await requestCode("platform", email)).status, 202);
  for (const variant of variants) {
    const res = await requestCode("platform", variant);
    assert.equal(res.status, 429, `${JSON.stringify(variant)} 应该算同一个邮箱：${res.text}`);
  }
  assert.equal(smtp.messages.length, 1);
  assert.deepEqual(smtp.messages[0]?.to, [email]);
  for (let i = 0; i < 5; i++) assert.equal((await verify("platform", variants[i] as string, "000000", ip)).status, 401);
  const blocked = await verify("platform", variants[5] as string, "000000", ip);
  assert.equal(blocked.status, 429, "同一邮箱 + 地址的 5 次不分写法");
  assert.equal(await attemptsOf("platform", email), 5, "各种写法累计到同一个码上");
});

test("规范化：正确的码配大写的邮箱也能用，得到同一个账号", async () => {
  const email = "qa-upper-verify@platform.test";
  await staff(email);
  await requestCode("platform", email);
  const res = await verify("platform", email.toUpperCase(), latestCode(email));
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.user.email, email);
});

test("Unicode 变体：同形字、全角、组合字符、零宽字符不是这个邮箱：400，不发信、不写行，也就到不了别人的账号", async () => {
  const email = "qa-homoglyph@platform.test";
  await staff(email);
  const variants = [
    "qа-homoglyph@platform.test", // 西里尔字母 а
    "ｑａ-homoglyph@platform.test", // 全角
    "qa-homoglÿph@platform.test", // 组合字符
    "qa​-homoglyph@platform.test", // 零宽空格
    "qa-homoglyph@platform.test​",
    "qa-homoglyph@platſorm.test", // 长 s，转大写时才和 s 相同
    "İa-homoglyph@platform.test", // 带点大写 I，转小写后多一个组合字符
  ];
  const before = (await api.db.owner.query("select count(*)::int as n from email_login_codes")).rows[0].n as number;
  for (const variant of variants) {
    const res = await requestCode("platform", variant);
    assert.equal(res.status, 400, `${JSON.stringify(variant)}：${res.text}`);
    assert.equal((await verify("platform", variant, "123456")).status, 400);
  }
  assert.equal(smtp.messages.length, 0);
  assert.equal((await api.db.owner.query("select count(*)::int as n from email_login_codes")).rows[0].n, before);
});

test("加号地址和点号：系统把它们当不同的邮箱（不做 Gmail 式合并），所以收不到信、也碰不到原账号的码和计数", async () => {
  const email = "qa.plus@gmail.example";
  await staff(email);
  await requestCode("platform", email);
  const code = latestCode(email);
  smtp.reset();
  for (const variant of ["qa.plus+tag@gmail.example", "qaplus@gmail.example", "q.a.plus@gmail.example"]) {
    assert.equal((await requestCode("platform", variant)).status, 202, variant);
    assert.equal((await verify("platform", variant, code)).status, 401, `${variant} 用不了原账号的码`);
  }
  assert.equal(smtp.messages.length, 0, "变体地址一封都不发，绕开限速也轰炸不了任何人");
  assert.equal(await attemptsOf("platform", email), 0, "变体上的猜测不算在原账号的码上，也碰不到它");
  assert.equal((await verify("platform", email, code)).status, 200);
});

test("邮件头和 SMTP 命令注入：地址中间带换行的一律 400，不发信；首尾的换行只是被去掉，发到的还是这一个地址", async () => {
  const email = "qa-inject@platform.test";
  await staff(email);
  for (const evil of [`${email}\r\nBcc: attacker@example.test`, `${email}\nRCPT TO:<attacker@example.test>`, `${email}>\r\nRCPT TO:<attacker@example.test`, `"${email}\r\nX: y"@example.test`, `${email},attacker@example.test`, `${email};attacker@example.test`, `${email} attacker@example.test`, `attacker@example.test%0d%0a@${email}`, `a@b@platform.test`, `<${email}>`]) {
    const res = await requestCode("platform", evil);
    assert.equal(res.status, 400, `${JSON.stringify(evil)}：${res.text}`);
  }
  assert.equal(smtp.messages.length, 0);
  assert.equal((await requestCode("platform", `${email}\r\n`)).status, 202);
  assert.deepEqual(smtp.messages.map((message) => message.to), [[email]]);
  assert.equal(smtp.messages.some((message) => /attacker/i.test(message.data)), false);
});

test("X-Forwarded-For：没配代理层数（默认）时整个不信，换着伪造也绕不过发码和校验的限速", async () => {
  const ip = "203.0.113.170";
  for (let i = 0; i < 20; i++) assert.equal((await requestPlain("platform", `qa-xff-${i}@platform.test`, ip, { "x-forwarded-for": `192.0.2.${i + 1}` })).status, 202);
  await api.app.emailLoginIdle();
  assert.equal((await requestPlain("platform", "qa-xff-next@platform.test", ip, { "x-forwarded-for": "192.0.2.99" })).status, 429);

  const verifyIp = "203.0.113.171";
  const email = "qa-xff-verify@platform.test";
  for (let i = 0; i < 5; i++) assert.equal((await verifyPlain("platform", email, "000000", verifyIp, { "x-forwarded-for": `192.0.2.${i + 1}` })).status, 401);
  assert.equal((await verifyPlain("platform", email, "000000", verifyIp, { "x-forwarded-for": "192.0.2.99" })).status, 429);
  await api.app.emailLoginIdle();
});

test("X-Forwarded-For：配了一层代理时只认代理写的最后一段，客户端在左边伪造多少段都没用；两层代理也一样", async () => {
  for (const [hops, chain] of [["1", (fake: string) => `${fake}, 203.0.113.180`], ["2", (fake: string) => `${fake}, 203.0.113.180, 10.9.9.9`]] as const) {
    const proxied = await createTestApi({ env: { ...SMTP_ENV(smtp), TRUST_PROXY_HOPS: hops }, integrationSecretsTtlMs: 0, mailer: new SmtpMailer({ allowLoopback: true, deadlineMs: 2_000 }) });
    try {
      const socket = "10.0.0.2";
      for (let i = 0; i < 20; i++) {
        const res = await requestPlain("platform", `qa-hop-${i}@platform.test`, socket, { "x-forwarded-for": chain(`192.0.2.${i + 1}`) }, proxied);
        assert.equal(res.status, 202, res.text);
      }
      const blocked = await requestPlain("platform", "qa-hop-next@platform.test", socket, { "x-forwarded-for": chain("192.0.2.99") }, proxied);
      assert.equal(blocked.status, 429, `TRUST_PROXY_HOPS=${hops}：伪造左边的段不能换来新的地址额度`);
      const another = await requestPlain("platform", "qa-hop-next@platform.test", socket, { "x-forwarded-for": chain("192.0.2.99").replace("203.0.113.180", "203.0.113.181") }, proxied);
      assert.equal(another.status, 202, "代理写的另一个客户端地址是另一份额度");
      await proxied.app.emailLoginIdle();
    } finally {
      await proxied.close();
    }
  }
});

test("IPv6 同一个 /64 换地址、IPv4 的映射写法，都算同一个来源，绕不过发码的地址限速", async () => {
  for (let i = 0; i < 20; i++) assert.equal((await requestPlain("platform", `qa-six-${i}@platform.test`, `2001:db8:1:2::${(i + 1).toString(16)}`)).status, 202, `第 ${i + 1} 封`);
  assert.equal((await requestPlain("platform", "qa-six-next@platform.test", "2001:db8:1:2:ffff::1")).status, 429);
  assert.equal((await requestPlain("platform", "qa-six-next@platform.test", "2001:db8:1:3::1")).status, 202, "另一个 /64 不受影响");
  for (let i = 0; i < 20; i++) assert.equal((await requestPlain("platform", `qa-four-${i}@platform.test`, "203.0.113.190")).status, 202);
  assert.equal((await requestPlain("platform", "qa-four-next@platform.test", "::ffff:203.0.113.190")).status, 429);
  await api.app.emailLoginIdle();
});

test("高并发：同一地址、同一邮箱的发码和校验混在一起 60 个请求，没有一个 500（没有死锁、没有撞约束），都是 202 / 401 / 429 / 200", async () => {
  const email = "qa-stress@platform.test";
  await staff(email);
  await requestCode("platform", email, "203.0.113.210");
  const code = latestCode(email);
  api.clock.advance(EMAIL_CODE_RESEND_INTERVAL_MS);
  const jobs: Promise<ApiResponse>[] = [];
  for (let i = 0; i < 60; i++) {
    const ip = i % 3 === 0 ? "203.0.113.210" : "203.0.113.211";
    if (i % 4 === 0) jobs.push(requestPlain("platform", i % 8 === 0 ? email : `qa-stress-${i}@platform.test`, ip));
    else jobs.push(verifyPlain("platform", i % 5 === 0 ? `qa-stress-${i}@platform.test` : email, i % 7 === 0 ? code : wrongCode(code), ip));
  }
  const results = await Promise.all(jobs);
  await api.app.emailLoginIdle();
  assert.deepEqual([...new Set(results.map((res) => res.status))].filter((status) => ![200, 202, 401, 429].includes(status)), []);
  assert.doesNotMatch(api.logs(), /email_code\.task_failed/);
});
