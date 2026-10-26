/**
 * 运营后台填写第三方密钥（M4-09，ADR 0041）的补充测试（测试角色），连真实的 PostgreSQL，重点是安全：
 * - 原文泄露：各种 400（含结构不对、畸形 JSON、不支持的内容类型）、404、409、503 的返回，审计、库、应用日志里，
 *   不只没有整把密钥，连「去掉末 4 位的前段」和任意 8 个字符的片段也没有；打码后的样子不随长度变化。
 * - 打码与校验的边界：19 / 20 / 255 / 256 个字符、首尾空白（空格、制表、换行、全角空格、不换行空格）、中间的空白、全角字符、零宽字符。
 * - 权限：IP 白名单外、改密码前的会话、被停用的超级管理员都改不了；只读的只看到状态和来源；渠道和官网的接口拿不到。
 * - 加密：另一个进程用错的数据加密密钥 → 标 UNREADABLE、回落、不报 500；谷歌那行的密文搬到 Stripe 那行解不开；被改坏的密文同样。
 * - 优先顺序：后台 > 配置文件，Stripe 三项整组来自同一处；正式环境里后台的测试密钥不生效。
 * - 并发：同时两次填写、填写和清空同时到，最终状态、缓存和审计一致。
 * - 测试一下：超时、超大应答、应答里回显密钥、重定向到别处，结果里都没有原文，也不把密钥带到别的地址。
 * 「密钥」都是测试里现场拼的随机假值；每个用例结束时把自己填的清掉。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@nozomi/config";
import { buildApp } from "./app.ts";
import { loadMigrationFiles } from "./db/migrate.ts";
import { SecretBox } from "./integrations/secret-box.ts";
import { stripeSignatureHeader } from "./integrations/stripe-signature.ts";
import { IntegrationSecretCache } from "./services/integration-secrets.ts";
import { createSuperAdmin } from "./services/platform-staff.ts";
import { type ApiResponse, type CallOptions, type HttpMethod, TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";
import { FAKE_SECRETS, testEnv } from "./testing/fixtures.ts";
import { type FakeService, googleErrorBody, startFakeGoogleRoutes, startFakeStripe } from "./testing/fake-integrations.ts";
import { exitWithin, freePort, startNode } from "./testing/process.ts";

const hex = (bytes: number): string => randomBytes(bytes).toString("hex");
const PREFIXES = ["AIza", "sk_test_", "sk_live_", "pk_test_", "pk_live_", "whsec_"];
const fakeKey = (prefix: string, length = 32): string => `${prefix}${hex(length)}`.slice(0, length);
const stripeKeys = (): { secret_key: string; publishable_key: string; webhook_secret: string } => ({
  secret_key: fakeKey("sk_test_"),
  publishable_key: fakeKey("pk_test_"),
  webhook_secret: fakeKey("whsec_"),
});
const last4 = (value: string): string => `••••${value.slice(-4)}`;
const ENV = { STRIPE_SECRET_KEY: "", STRIPE_PUBLISHABLE_KEY: "", STRIPE_WEBHOOK_SECRET: "" };

/** 测试里用过的每一把密钥（含故意填错的）：任何地方都不能出现它们或它们的片段 */
const used: string[] = [FAKE_SECRETS.googleMapsApiKey];
function remember<T extends string | Record<string, string>>(value: T): T {
  if (typeof value === "string") used.push(value.trim());
  else used.push(...Object.values(value).map((v) => v.trim()));
  return value;
}

/**
 * 一把密钥不能出现的片段：整把、去掉末 4 位的前段、去掉前缀后的任意 8 个字符。
 * 前缀（sk_test_ 等）本身是公开的说明文字，不算；末 4 位是允许显示的。
 */
function pieces(secret: string): string[] {
  const prefix = PREFIXES.find((p) => secret.startsWith(p)) ?? "";
  const body = secret.slice(prefix.length);
  const out = new Set<string>([secret]);
  if (secret.length > 8) out.add(secret.slice(0, -4));
  for (let i = 0; i + 8 <= body.length; i++) out.add(body.slice(i, i + 8));
  return [...out].filter((p) => p.length >= 8 && !PREFIXES.includes(p));
}

function leaks(text: string): string[] {
  const found: string[] = [];
  for (const secret of used) for (const piece of pieces(secret)) if (text.includes(piece)) found.push(`${secret.slice(0, 6)}…（片段 ${piece.slice(0, 3)}…）`);
  return found;
}

function assertNoLeak(text: string, label: string): void {
  assert.deepEqual(leaks(text), [], `${label}：出现了密钥原文或片段`);
}

let api: TestApi;
let google: FakeService;
let stripe: FakeService;
let root: string;
let tech: string;

async function call(method: HttpMethod, url: string, options: CallOptions = {}): Promise<ApiResponse> {
  const res = await api.call(method, url, { token: root, ...options });
  assertNoLeak(res.text, `${method} ${url} → ${res.status}`);
  return res;
}
const save = (key: string, body: unknown, options: CallOptions = {}): Promise<ApiResponse> => call("PUT", `/platform/v1/integration-secrets/${key}`, { body, ...options });
const clear = (key: string, options: CallOptions = {}): Promise<ApiResponse> => call("DELETE", `/platform/v1/integration-secrets/${key}`, options);
const check = (key: string, options: CallOptions = {}): Promise<ApiResponse> => call("POST", `/platform/v1/integration-secrets/${key}/test`, options);
const list = (options: CallOptions = {}): Promise<ApiResponse> => call("GET", "/platform/v1/integration-secrets", options);
const itemOf = (res: ApiResponse, key: string): any => res.body.items.find((item: any) => item.key === key);
const maxAuditId = async (): Promise<number> => Number((await api.db.owner.query("select coalesce(max(id), 0) as id from audit_logs")).rows[0].id);
const auditsSince = async (id: number): Promise<any[]> =>
  (await api.db.owner.query("select id, action, resource_id, before, after from audit_logs where resource = 'integration_secret' and id > $1 order by id", [id])).rows;
/** 每个用例结束时：后台那一份清掉（直接删库，不留审计以外的痕迹），本进程的缓存也重读 */
async function wipe(): Promise<void> {
  await api.db.owner.query("delete from integration_secrets");
  await api.call("GET", "/health");
}

/** 和主进程共用数据库、各自截日志的另一个服务进程 */
async function otherApp(env: Record<string, string>): Promise<{ app: FastifyInstance; logs: () => string }> {
  let logs = "";
  const app = buildApp({
    config: loadConfig({ ...testEnv(api.db.url), ...ENV, GOOGLE_MAPS_ROUTES_URL: google.url, STRIPE_API_URL: stripe.origin, ...env }),
    pool: api.db.pool,
    migrationFiles: await loadMigrationFiles(),
    now: api.clock.now,
    integrationSecretsTtlMs: 0,
    logDestination: { write: (line) => void (logs += line) },
  });
  return { app, logs: () => logs };
}
async function inject(app: FastifyInstance, method: HttpMethod, url: string, token: string | null, body?: unknown): Promise<ApiResponse> {
  const res = await app.inject({ method, url, headers: token === null ? {} : { authorization: `Bearer ${token}` }, ...(body === undefined ? {} : { payload: body as object }) });
  let parsed: unknown = null;
  try {
    parsed = res.json();
  } catch {
    parsed = null;
  }
  assertNoLeak(res.body, `另一个进程 ${method} ${url} → ${res.statusCode}`);
  return { status: res.statusCode, headers: res.headers, text: res.body, body: parsed };
}
function webhook(app: FastifyInstance, secret: string): Promise<number> {
  const body = Buffer.from(
    JSON.stringify({ id: `evt_${hex(6)}`, object: "event", type: "customer.created", livemode: false, created: Math.floor(api.clock.now().getTime() / 1000), data: { object: { id: "cus_qa", object: "customer" } } }),
  );
  const signature = stripeSignatureHeader(body, secret, Math.floor(api.clock.now().getTime() / 1000));
  return app.inject({ method: "POST", url: "/webhooks/stripe", headers: { "content-type": "application/json", "stripe-signature": signature }, payload: body }).then((r) => r.statusCode);
}

async function addStaff(email: string, role: string): Promise<{ id: string; token: string }> {
  const invited = await api.call("POST", "/platform/v1/staff", { token: root, body: { email, name: email.split("@")[0], role } });
  assert.equal(invited.status, 201, invited.text);
  await api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.body.invite.token, password: TEST_PASSWORD } });
  const login = await api.platformLogin({ body: { email, password: TEST_PASSWORD } });
  assert.equal(login.status, 200, login.text);
  return { id: invited.body.user.id as string, token: login.body.access_token as string };
}

/** 再建一个超级管理员（命令行同样的流程），返回编号和一个完成两步验证的令牌 */
async function secondSuperAdmin(email: string, ip?: string): Promise<{ id: string; token: string }> {
  await createSuperAdmin(api.db.pool, { email, name: email.split("@")[0] ?? email, password: TEST_PASSWORD }, api.clock.now());
  const login = await api.platformLogin({ ...(ip === undefined ? {} : { ip }), body: { email, password: TEST_PASSWORD } });
  assert.equal(login.status, 200, login.text);
  const id = (await api.db.owner.query("select id from platform_users where email = $1", [email])).rows[0].id as string;
  return { id, token: login.body.access_token as string };
}

/**
 * 让几个请求真的同时进到「锁住这一项」那一步：先用表锁挡住，等它们都在排队了再放开。
 * 不这样做的话，同一个进程里两个请求往往一前一后跑完，碰不到并发的情形。
 */
async function together<T>(waiters: number, start: () => Promise<T>[]): Promise<T[]> {
  const holder = await api.db.owner.connect();
  let running: Promise<T[]>;
  try {
    await holder.query("begin");
    await holder.query("lock table integration_secrets in exclusive mode");
    running = Promise.all(start());
    const deadline = Date.now() + 5_000;
    for (;;) {
      const waiting = (await api.db.owner.query("select count(*)::int as n from pg_locks where relation = 'integration_secrets'::regclass and not granted")).rows[0].n as number;
      if (waiting >= waiters) break;
      assert.ok(Date.now() < deadline, `只有 ${waiting} 个请求在排队`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await holder.query("commit");
  } finally {
    holder.release();
  }
  return running;
}

before(async () => {
  google = await startFakeGoogleRoutes();
  stripe = await startFakeStripe();
  api = await createTestApi({ env: { ...ENV, GOOGLE_MAPS_ROUTES_URL: google.url, STRIPE_API_URL: stripe.origin }, integrationSecretsTtlMs: 0 });
  root = await api.superAdminToken("root@platform.test");
  tech = (await addStaff("tech@platform.test", "tech")).token;
});
after(async () => {
  await api.close();
  await google.close();
  await stripe.close();
});

// ───────────── 原文泄露 ─────────────

test("原文泄露：各种 400（业务校验、结构不对、超长、畸形 JSON、内容类型不对）、404、409、503 的返回里没有密钥及其片段，库和审计里一样都没存", async () => {
  const before = await maxAuditId();
  const key = remember(fakeKey("AIza", 39));
  const cases: [string, unknown][] = [
    ["中间有空格", { api_key: `${key.slice(0, 20)} ${key.slice(20)}` }],
    ["中间有换行", { api_key: `${key.slice(0, 20)}\n${key.slice(20)}` }],
    ["超过 255", { api_key: `${key}${"Z".repeat(240)}` }],
    ["超过 1000（结构校验那一层）", { api_key: `${key}${"Q".repeat(1_000)}` }],
    ["类型不对：数组", { api_key: [key] }],
    ["类型不对：对象", { api_key: { value: key } }],
    ["字段名写错，值放在别的字段里", { apiKey: key }],
    ["值放在字段名里", { [key]: "x" }],
  ];
  for (const [label, body] of cases) {
    const res = await save("google-maps", body);
    assert.equal(res.status, 400, `${label}：${res.status}`);
    assert.equal(res.body.error.code, "VALIDATION_FAILED", label);
  }

  const stripeCases: [string, Record<string, string>][] = [
    ["正式密钥", remember({ secret_key: fakeKey("sk_live_"), publishable_key: fakeKey("pk_live_"), webhook_secret: fakeKey("whsec_") })],
    ["测试 / 正式混用", remember({ secret_key: fakeKey("sk_test_"), publishable_key: fakeKey("pk_live_"), webhook_secret: fakeKey("whsec_") })],
    ["前缀不对（受限密钥 rk_）", remember({ secret_key: fakeKey("rk_test_"), publishable_key: fakeKey("pk_test_"), webhook_secret: fakeKey("whsec_") })],
    ["三项填反了", remember({ secret_key: fakeKey("whsec_"), publishable_key: fakeKey("sk_test_"), webhook_secret: fakeKey("pk_test_") })],
    ["缺一项", remember({ secret_key: fakeKey("sk_test_"), publishable_key: "", webhook_secret: fakeKey("whsec_") })],
  ];
  for (const [label, body] of stripeCases) {
    const res = await save("stripe", body);
    assert.equal(res.status, 400, `${label}：${res.text}`);
    for (const issue of res.body.error.details.issues) assert.deepEqual(Object.keys(issue).sort(), ["message", "path", "reason"], `${label}：每条只有字段、原因和说明`);
  }

  // 畸形 JSON：Node 的 JSON 解析错误本身会引用一段原文
  const raw = await api.app.inject({ method: "PUT", url: "/platform/v1/integration-secrets/google-maps", headers: { authorization: `Bearer ${root}`, "content-type": "application/json" }, payload: `{"api_key": ${key}"}` });
  assert.equal(raw.statusCode, 400);
  assertNoLeak(raw.body, "畸形 JSON");
  const text = await api.app.inject({ method: "PUT", url: "/platform/v1/integration-secrets/google-maps", headers: { authorization: `Bearer ${root}`, "content-type": "text/plain" }, payload: key });
  assert.ok([400, 415].includes(text.statusCode), `内容类型不对：${text.statusCode}`);
  assertNoLeak(text.body, "内容类型不对");

  assert.equal((await call("DELETE", "/platform/v1/integration-secrets/google-maps")).status, 409);
  assert.equal((await call("POST", "/platform/v1/integration-secrets/stripe/test")).status, 409);

  // 503：另一个没配置数据加密密钥的进程
  const other = await otherApp({ DATA_ENCRYPTION_KEY: "" });
  try {
    const refused = await inject(other.app, "PUT", "/platform/v1/integration-secrets/google-maps", root, { api_key: key });
    assert.deepEqual([refused.status, refused.body.error.code], [503, "INTEGRATION_ENCRYPTION_NOT_CONFIGURED"]);
    const refusedStripe = await inject(other.app, "PUT", "/platform/v1/integration-secrets/stripe", root, stripeCases[0]![1]);
    assert.equal(refusedStripe.status, 503);
    assertNoLeak(other.logs(), "没配置数据加密密钥的进程的日志");
  } finally {
    await other.app.close();
  }

  assert.equal((await api.db.owner.query("select count(*)::int as n from integration_secrets")).rows[0].n, 0, "一样都没存");
  assert.deepEqual(await auditsSince(before), [], "被拒的请求不留审计");
  assertNoLeak(api.logs(), "应用日志");
});

test("打码不泄露长度：20 个字符和 255 个字符的密钥，返回里除了末 4 位一模一样；/health 不带打码值和来源；只读角色和 /platform/v1/integrations 里看不到末 4 位", async () => {
  const short = remember(fakeKey("AIza", 20));
  const long = remember(`AIza${"x".repeat(247)}${hex(2)}`);
  assert.equal(long.length, 255);
  const normalize = (item: any): unknown => ({ ...item, masked: "M", admin: { ...item.admin, hints: { api_key: "M" }, updated_at: "T" } });
  const a = await save("google-maps", { api_key: short });
  assert.equal(a.status, 200, a.text);
  const b = await save("google-maps", { api_key: long });
  assert.equal(b.status, 200, b.text);
  assert.deepEqual([a.body.item.masked, b.body.item.masked], [last4(short), last4(long)]);
  assert.deepEqual(normalize(a.body.item), normalize(b.body.item), "除了末 4 位（和更新时间）以外没有任何随长度变化的东西");
  for (const text of [a.text, b.text]) assert.ok(!/\b(20|255)\b/.test(text), "返回里没有长度");

  const hints = (await api.db.owner.query("select hints from integration_secrets where integration = 'google_maps'")).rows[0].hints;
  assert.deepEqual(hints, { api_key: last4(long) });

  const health = await call("GET", "/health", { token: undefined as unknown as string });
  assert.equal(health.status, 200);
  assert.ok(!health.text.includes("•"), "/health 没有打码值");
  assert.ok(!/admin|后台设置|服务器配置文件/.test(health.text), "/health 不带来源");

  const asTech = await list({ token: tech });
  assert.ok(!asTech.text.includes("•"), "只读角色的返回里一个打码值都没有");
  for (const item of asTech.body.items) assert.deepEqual([item.masked, item.admin], [null, null]);
  assert.deepEqual(itemOf(asTech, "google_maps").source, "admin", "只读角色看得到来源");
  const integrationsTech = await call("GET", "/platform/v1/integrations", { token: tech });
  assert.equal(integrationsTech.status, 200);
  for (const item of integrationsTech.body.items.filter((i: any) => ["googleMaps", "stripe"].includes(i.key))) {
    assert.ok(!String(item.detail).includes("•"), `只读角色在集成状态里也看不到末 4 位：${item.detail}`);
  }
  const integrationsRoot = await call("GET", "/platform/v1/integrations");
  assert.equal(integrationsRoot.body.items.find((i: any) => i.key === "googleMaps").detail, `后台设置（${last4(long)}）`);
  await wipe();
});

// ───────────── 打码与校验的边界 ─────────────

test("长度边界：19 个字符 TOO_SHORT，20 个收；255 个收，256 个 TOO_LONG；4、5 个字符都是 TOO_SHORT 且不回显；首尾空白不算长度", async () => {
  const sizes: [number, number, string | null][] = [
    [4, 400, "TOO_SHORT"],
    [5, 400, "TOO_SHORT"],
    [19, 400, "TOO_SHORT"],
    [20, 200, null],
    [255, 200, null],
    [256, 400, "TOO_LONG"],
  ];
  for (const [size, status, reason] of sizes) {
    const value = remember(size <= 8 ? hex(4).slice(0, size) : `AIza${"k".repeat(size - 8)}${hex(2)}`);
    assert.equal(value.length, size);
    const res = await save("google-maps", { api_key: value });
    assert.equal(res.status, status, `${size} 个字符：${res.text}`);
    if (reason !== null) assert.deepEqual(res.body.error.details.issues.map((i: any) => [i.path, i.reason]), [["/api_key", reason]]);
    else assert.equal(res.body.item.masked, last4(value));
    if (size <= 8) assert.ok(!res.text.includes(value), `${size} 个字符的值没有回显`);
  }
  const padded = remember(`AIza${hex(8)}`.slice(0, 19));
  const res = await save("google-maps", { api_key: `      ${padded}      ` });
  assert.deepEqual(res.body.error.details.issues.map((i: any) => i.reason), ["TOO_SHORT"], "去掉首尾空白后才数长度");
  const longPadded = remember(`AIza${"p".repeat(249)}${hex(1)}`);
  assert.equal(longPadded.length, 255);
  assert.equal((await save("google-maps", { api_key: `\n\n${longPadded}\n\n` })).status, 200, "255 个字符加首尾换行照样收");
  await wipe();
});

test("首尾空白（空格、制表、回车换行、全角空格、不换行空格）去掉后保存，测试一下发出去的也是去掉后的值；中间的空白、全角字母、零宽字符一律 FORMAT", async () => {
  const accepted: [string, (k: string) => string][] = [
    ["空格和制表", (k) => ` \t${k}\t `],
    ["回车换行", (k) => `\r\n${k}\r\n`],
    ["全角空格", (k) => `　${k}　`],
    ["不换行空格", (k) => ` ${k} `],
  ];
  for (const [label, wrap] of accepted) {
    const key = remember(fakeKey("AIza", 39));
    const res = await save("google-maps", { api_key: wrap(key) });
    assert.equal(res.status, 200, `${label}：${res.text}`);
    assert.equal(res.body.item.masked, last4(key), label);
    google.requests.length = 0;
    assert.equal((await check("google-maps")).body.ok, true);
    assert.equal(google.requests.at(-1)?.headers["x-goog-api-key"], key, `${label}：发给谷歌的是去掉首尾空白后的值`);
  }
  const keys = remember(stripeKeys());
  const stripeRes = await save("stripe", { secret_key: `${keys.secret_key}\n`, publishable_key: ` ${keys.publishable_key}`, webhook_secret: `\t${keys.webhook_secret}\r\n` });
  assert.equal(stripeRes.status, 200, stripeRes.text);
  assert.deepEqual(stripeRes.body.item.admin.hints, { secret_key: last4(keys.secret_key), publishable_key: last4(keys.publishable_key), webhook_secret: last4(keys.webhook_secret) });
  assert.equal(await webhook(api.app, keys.webhook_secret), 200, "验签用的是去掉空白后的 webhook 密钥");

  const rejected: [string, (k: string) => string][] = [
    ["中间有空格", (k) => `${k.slice(0, 10)} ${k.slice(10)}`],
    ["中间有制表", (k) => `${k.slice(0, 10)}\t${k.slice(10)}`],
    ["中间有换行（两行粘在一起）", (k) => `${k.slice(0, 10)}\n${k.slice(10)}`],
    ["全角字母", (k) => k.replace(/[a-z]/, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0))],
    ["末尾的零宽空格", (k) => `${k}​`],
    ["开头的 BOM", (k) => `﻿${k}`.replace("﻿", "⁠")],
    ["中文标点", (k) => `${k}，`],
  ];
  for (const [label, wrap] of rejected) {
    const key = remember(fakeKey("AIza", 39));
    const res = await save("google-maps", { api_key: wrap(key) });
    assert.equal(res.status, 400, `${label}：${res.text}`);
    assert.deepEqual(res.body.error.details.issues.map((i: any) => [i.path, i.reason]), [["/api_key", "FORMAT"]], label);
  }
  await wipe();
});

// ───────────── 权限 ─────────────

test("IP 白名单外的超级管理员：看、填写、清空、测试都是 403 IP_NOT_ALLOWED；名单内照常", async () => {
  const office = "203.0.113.10";
  const home = "198.51.100.7";
  const admin = await secondSuperAdmin("allowlisted@platform.test", office);
  const set = await call("PATCH", `/platform/v1/staff/${admin.id}`, { body: { ip_allowlist: ["203.0.113.0/24"] } });
  assert.equal(set.status, 200, set.text);
  const key = remember(fakeKey("AIza", 39));
  const before = await maxAuditId();
  for (const res of [
    await list({ token: admin.token, ip: home }),
    await save("google-maps", { api_key: key }, { token: admin.token, ip: home }),
    await clear("google-maps", { token: admin.token, ip: home }),
    await check("google-maps", { token: admin.token, ip: home }),
  ]) {
    assert.deepEqual([res.status, res.body.error.code], [403, "IP_NOT_ALLOWED"]);
  }
  assert.deepEqual(await auditsSince(before), []);
  assert.equal((await save("google-maps", { api_key: key }, { token: admin.token, ip: office })).status, 200, "名单内照常");
  await wipe();
});

test("改密码之前的会话、被停用的超级管理员：都改不了（401），什么都没留下", async () => {
  const admin = await secondSuperAdmin("rotating@platform.test");
  const old = admin.token;
  const fresh = (await api.platformLogin({ body: { email: "rotating@platform.test", password: TEST_PASSWORD } })).body.access_token as string;
  const changed = await api.call("POST", "/platform/v1/auth/change-password", { token: fresh, body: { current_password: TEST_PASSWORD, new_password: "Brand-New-Harbor-2027" } });
  assert.equal(changed.status, 204, changed.text);
  const key = remember(fakeKey("AIza", 39));
  const before = await maxAuditId();
  for (const res of [await save("google-maps", { api_key: key }, { token: old }), await clear("stripe", { token: old }), await check("google-maps", { token: old }), await list({ token: old })]) {
    assert.equal(res.status, 401, `改密码前的会话：${res.text}`);
  }
  assert.equal((await save("google-maps", { api_key: key }, { token: fresh })).status, 200, "改密码的那个会话照常");
  await wipe();

  const disabled = await secondSuperAdmin("leaving@platform.test");
  const off = await call("POST", `/platform/v1/staff/${disabled.id}/disable`, { body: {} });
  assert.equal(off.status, 200, off.text);
  for (const res of [await save("google-maps", { api_key: key }, { token: disabled.token }), await check("google-maps", { token: disabled.token }), await list({ token: disabled.token })]) {
    assert.equal(res.status, 401, `被停用：${res.text}`);
  }
  assert.deepEqual((await auditsSince(before)).map((r) => r.action), ["set"], "只有改密码那个会话的一次填写");
  await wipe();
});

test("渠道、官网、司机、租户的入口拿不到任何信息：同名接口不存在，平台接口不认它们的凭据", async () => {
  await save("google-maps", { api_key: remember(fakeKey("AIza", 39)) });
  for (const prefix of ["tenant", "sales", "site", "driver"]) {
    for (const path of ["integration-secrets", "integration-secrets/google-maps", "integrations"]) {
      const res = await call("GET", `/${prefix}/v1/${path}`, { token: undefined as unknown as string });
      assert.ok([401, 404].includes(res.status), `/${prefix}/v1/${path}：${res.status}`);
      assert.ok(!res.text.includes("•"), `/${prefix}/v1/${path} 没有打码值`);
    }
  }
  for (const headers of [{ "x-api-key": `ck_${hex(16)}` }, { "x-site-client": `site_${hex(8)}` }]) {
    const res = await call("GET", "/platform/v1/integration-secrets", { token: undefined as unknown as string, headers });
    assert.equal(res.status, 401);
  }
  await wipe();
});

// ───────────── 加密 ─────────────

test("另一个进程用错的数据加密密钥：两项都标 UNREADABLE、回落到配置文件、/health 照常 200、不报 500；测试一下用的是配置文件的值；日志里没有原文", async () => {
  const maps = remember(fakeKey("AIza", 39));
  const keys = remember(stripeKeys());
  assert.equal((await save("google-maps", { api_key: maps })).status, 200);
  assert.equal((await save("stripe", keys)).status, 200);
  const other = await otherApp({ DATA_ENCRYPTION_KEY: `another-data-encryption-key-${hex(12)}` });
  try {
    const res = await inject(other.app, "GET", "/platform/v1/integration-secrets", root);
    assert.equal(res.status, 200, res.text);
    const mapsItem = itemOf(res, "google_maps");
    const stripeItem = itemOf(res, "stripe");
    assert.deepEqual([mapsItem.source, mapsItem.masked, mapsItem.admin.configured, mapsItem.admin.problem], ["env", last4(FAKE_SECRETS.googleMapsApiKey), true, "UNREADABLE"]);
    assert.deepEqual([stripeItem.source, stripeItem.state, stripeItem.admin.problem], ["none", "missing", "UNREADABLE"]);
    assert.deepEqual(mapsItem.admin.hints, { api_key: last4(maps) }, "打码的样子不用解密，照样显示");
    const health = await inject(other.app, "GET", "/health", null);
    assert.equal(health.status, 200);
    assert.deepEqual(
      health.body.integrations.filter((i: any) => ["googleMaps", "stripe"].includes(i.key)).map((i: any) => [i.key, i.state]),
      [["stripe", "missing"], ["googleMaps", "configured"]],
    );
    assert.equal(await webhook(other.app, keys.webhook_secret), 503, "解不开的 Stripe 不生效");
    google.requests.length = 0;
    const tested = await inject(other.app, "POST", "/platform/v1/integration-secrets/google-maps/test", root);
    assert.deepEqual([tested.status, tested.body.source], [200, "env"]);
    assert.equal(google.requests.at(-1)?.headers["x-goog-api-key"], FAKE_SECRETS.googleMapsApiKey);
    // 收 Stripe 通知时「支付未配置」那一条是预期的（上面故意投递的）；除此之外没有别的错误
    const errors = other.logs().split("\n").filter((line) => /"level":(50|60)/.test(line) && !line.includes('"code":"PAYMENT_NOT_CONFIGURED"'));
    assert.deepEqual(errors.map((line) => line.slice(0, 400)), [], "解不开不算出错：没有错误级别的日志");
    assertNoLeak(other.logs(), "错密钥进程的日志");
  } finally {
    await other.app.close();
  }
  await wipe();
});

test("附加数据：谷歌那行的密文拷到 Stripe 那行解不开（标 UNREADABLE，Stripe 回落）；改坏的密文同样；谷歌那行不受影响", async () => {
  const maps = remember(fakeKey("AIza", 39));
  const keys = remember(stripeKeys());
  await save("google-maps", { api_key: maps });
  await save("stripe", keys);
  await api.db.owner.query("update integration_secrets set sealed = (select sealed from integration_secrets where integration = 'google_maps') where integration = 'stripe'");
  let res = await list();
  assert.equal(res.status, 200);
  assert.deepEqual([itemOf(res, "stripe").source, itemOf(res, "stripe").admin.problem], ["none", "UNREADABLE"]);
  assert.deepEqual([itemOf(res, "google_maps").source, itemOf(res, "google_maps").admin.problem], ["admin", null]);
  assert.equal(await webhook(api.app, keys.webhook_secret), 503);

  const iv = randomBytes(12).toString("base64url");
  const tag = randomBytes(16).toString("base64url");
  for (const broken of ["v1.AAAA.BBBB.CCCC", `v1.${iv}.${tag}.${randomBytes(40).toString("base64url")}`, `v1.${iv}.${tag}.e30`]) {
    await api.db.owner.query("update integration_secrets set sealed = $1 where integration = 'google_maps'", [broken]);
    res = await list();
    assert.equal(res.status, 200, `密文「${broken}」：${res.text}`);
    assert.deepEqual([itemOf(res, "google_maps").source, itemOf(res, "google_maps").admin.problem], ["env", "UNREADABLE"], broken);
  }
  // 重新填写就好了
  assert.equal((await save("stripe", keys)).body.action, "replace");
  assert.equal(await webhook(api.app, keys.webhook_secret), 200);
  await wipe();
});

// ───────────── 优先顺序 ─────────────

test("配置文件里也有 Stripe：后台的整组优先（不会一项来自后台一项来自配置文件）；清空回到配置文件那一组；后台那份解不开时也是整组用配置文件", async () => {
  const keys = remember(stripeKeys());
  const other = await otherApp({ STRIPE_SECRET_KEY: FAKE_SECRETS.stripeSecretKey, STRIPE_PUBLISHABLE_KEY: FAKE_SECRETS.stripePublishableKey, STRIPE_WEBHOOK_SECRET: FAKE_SECRETS.stripeWebhookSecret });
  try {
    assert.equal(await webhook(other.app, FAKE_SECRETS.stripeWebhookSecret), 200, "后台没填：用配置文件");
    await save("stripe", keys);
    let item = itemOf(await inject(other.app, "GET", "/platform/v1/integration-secrets", root), "stripe");
    assert.deepEqual([item.source, item.masked, item.env_configured], ["admin", last4(keys.secret_key), true]);
    assert.equal(await webhook(other.app, keys.webhook_secret), 200, "后台的 webhook 密钥生效");
    assert.equal(await webhook(other.app, FAKE_SECRETS.stripeWebhookSecret), 400, "配置文件那一组整组不生效");
    stripe.requests.length = 0;
    await inject(other.app, "POST", "/platform/v1/integration-secrets/stripe/test", root);
    assert.equal(stripe.requests.at(-1)?.headers.authorization, `Bearer ${keys.secret_key}`);

    await api.db.owner.query("update integration_secrets set sealed = 'v1.x.y.z' where integration = 'stripe'");
    item = itemOf(await inject(other.app, "GET", "/platform/v1/integration-secrets", root), "stripe");
    assert.deepEqual([item.source, item.admin.problem], ["env", "UNREADABLE"]);
    assert.equal(await webhook(other.app, FAKE_SECRETS.stripeWebhookSecret), 200);
    assert.equal(await webhook(other.app, keys.webhook_secret), 400);

    await clear("stripe");
    item = itemOf(await inject(other.app, "GET", "/platform/v1/integration-secrets", root), "stripe");
    assert.deepEqual([item.source, item.masked, item.admin.configured], ["env", last4(FAKE_SECRETS.stripeSecretKey), false]);
    assertNoLeak(other.logs(), "另一个进程的日志");
  } finally {
    await other.app.close();
  }
  await wipe();
});

test("正式环境：库里后台填的是测试密钥（测试环境的库被拿来用）→ 不生效，标 NOT_ALLOWED_IN_ENV，回落到配置文件", async () => {
  const keys = remember(stripeKeys());
  await save("stripe", keys);
  await save("google-maps", { api_key: remember(fakeKey("AIza", 39)) });
  const config = loadConfig({ ...testEnv(api.db.url), ...ENV, APP_ENV: "production", AUTH_JWT_SECRET: "p".repeat(64), FX_SOURCE_URL: "https://fx.example.com/v6/latest/USD" });
  const cache = new IntegrationSecretCache({ pool: api.db.pool, config, secretBox: new SecretBox(FAKE_SECRETS.dataEncryptionKey), log: { warn: () => undefined }, ttlMs: 0 });
  await cache.reloadNow();
  assert.equal(cache.adminState("stripe")?.problem, "NOT_ALLOWED_IN_ENV");
  assert.deepEqual([cache.effective.stripe.source, cache.effective.stripe.config], ["none", null]);
  assert.equal(cache.effective.googleMaps.source, "admin", "谷歌地图没有测试 / 正式之分，照常生效");
  await wipe();
});

// ───────────── 并发 ─────────────

test("并发：两个人同时第一次填写同一项 → 最终只有一份，审计一条「填写」一条「更换」，更换的前值是另一份的末 4 位，缓存和库一致", async () => {
  await wipe();
  const before = await maxAuditId();
  const a = remember(fakeKey("AIza", 39));
  const b = remember(fakeKey("AIza", 39));
  const results = await together(2, () => [save("google-maps", { api_key: a }), save("google-maps", { api_key: b })]);
  assert.deepEqual(results.map((r) => r.status), [200, 200]);
  const audits = (await auditsSince(before)).filter((r) => r.action !== "test");
  assert.equal(audits.length, 2, "两次保存各一条审计");
  const row = (await api.db.owner.query("select hints, version from integration_secrets where integration = 'google_maps'")).rows[0];
  assert.equal(row.version, 2);
  assert.deepEqual(row.hints, audits.at(-1)!.after.hints, "库里是后提交的那一份");
  assert.equal(itemOf(await list(), "google_maps").masked, row.hints.api_key, "缓存和库一致");
  assert.deepEqual(
    results.map((r) => r.body.action).sort(),
    ["replace", "set"],
    "两次都返回「填写」：后提交的那次其实覆盖了前一份",
  );
  assert.deepEqual(audits.map((r) => r.action), ["set", "replace"], "审计把后一次记成了「填写」");
  assert.deepEqual(audits[1].before, audits[0].after, "后一次的前值应是前一份的末 4 位");
  await wipe();
});

test("并发：填写（更换）和清空同时到，重复 10 轮：每轮两条审计，最终状态和最后一条审计一致，缓存和库一致", async () => {
  for (let round = 0; round < 10; round++) {
    const first = remember(fakeKey("AIza", 39));
    const second = remember(fakeKey("AIza", 39));
    assert.equal((await save("google-maps", { api_key: first })).status, 200);
    const before = await maxAuditId();
    const [saved, cleared] = (await together(2, () => [save("google-maps", { api_key: second }), clear("google-maps")])) as [ApiResponse, ApiResponse];
    assert.equal(saved.status, 200, saved.text);
    assert.equal(cleared.status, 200, `清空：${cleared.text}`);
    const audits = await auditsSince(before);
    assert.equal(audits.length, 2, `第 ${round} 轮`);
    const rows = (await api.db.owner.query("select hints from integration_secrets where integration = 'google_maps'")).rows;
    const lastAudit = audits.at(-1)!;
    if (lastAudit.action === "clear") {
      assert.equal(rows.length, 0, `第 ${round} 轮：最后是清空，库里应没有`);
      assert.deepEqual(audits[0].action, "replace");
    } else {
      assert.equal(rows.length, 1);
      assert.deepEqual(rows[0].hints, lastAudit.after.hints);
      assert.deepEqual([audits[0].action, lastAudit.action, lastAudit.before], ["clear", "set", null], `第 ${round} 轮：先清空再填写，是「填写」`);
    }
    const item = itemOf(await list(), "google_maps");
    assert.equal(item.admin.configured, rows.length === 1, "缓存和库一致");
    await wipe();
  }
});

// ───────────── 测试一下 ─────────────

test("测试一下：对方的应答里回显了密钥（错误说明、超大应答体、200 也回显）→ 结果、审计、日志里都没有原文", async () => {
  const key = remember(fakeKey("AIza", 39));
  await save("google-maps", { api_key: key });
  const before = await maxAuditId();
  const huge = `${key} `.repeat(200_000);
  const replies = [
    { status: 400, body: { error: { code: 400, message: `API key not valid: ${key}`, status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] } } },
    { status: 400, body: { error: { code: 400, message: huge, status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] } } },
    { status: 200, body: { routes: [{ distanceMeters: 1 }], echo: huge } },
    { status: 500, body: huge },
    { status: 403, body: googleErrorBody(403, "PERMISSION_DENIED", "API_KEY_SERVICE_BLOCKED") },
  ];
  for (const reply of replies) {
    google.respond(reply);
    const res = await check("google-maps");
    assert.equal(res.status, 200, res.text);
    assert.ok(res.text.length < 2_000, "结果是我们自己的短说明");
  }
  google.respond({ body: { routes: [{ distanceMeters: 6_800 }] } });
  for (const audit of await auditsSince(before)) assertNoLeak(JSON.stringify(audit), "测试一下的审计");

  const keys = remember(stripeKeys());
  await save("stripe", keys);
  for (const reply of [
    { status: 401, body: { error: { type: "invalid_request_error", message: `Invalid API Key provided: ${keys.secret_key}` } } },
    { status: 400, body: { error: { type: "invalid_request_error", message: `bad ${keys.secret_key}`, param: keys.secret_key } } },
    { status: 500, body: { error: { type: "api_error", message: huge } } },
    { status: 200, body: { object: "balance", livemode: false, available: [], pending: [], echo: keys.secret_key } },
  ]) {
    stripe.respond(reply);
    const res = await check("stripe");
    assert.equal(res.status, 200, res.text);
  }
  stripe.respond({ body: { object: "balance", livemode: false, available: [], pending: [] } });
  assertNoLeak(api.logs(), "应用日志");
  await wipe();
});

test("测试一下：对方返回重定向时不跟过去（密钥不会发到别的地址），结果不可用", async () => {
  const elsewhere = await startFakeGoogleRoutes();
  let status = 302;
  const redirector = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      response.writeHead(status, { location: elsewhere.url, "content-type": "application/json" });
      response.end("{}");
    });
  });
  await new Promise<void>((resolve) => redirector.listen(0, "127.0.0.1", () => resolve()));
  const address = redirector.address();
  const port = typeof address === "object" && address !== null ? address.port : 0;
  const other = await otherApp({ GOOGLE_MAPS_ROUTES_URL: `http://127.0.0.1:${port}/directions/v2:computeRoutes` });
  try {
    await save("google-maps", { api_key: remember(fakeKey("AIza", 39)) });
    for (const code of [301, 302, 303, 307, 308]) {
      status = code;
      const res = await inject(other.app, "POST", "/platform/v1/integration-secrets/google-maps/test", root);
      assert.deepEqual([res.status, res.body.ok], [200, false], `${code}`);
    }
    assert.equal(elsewhere.requests.length, 0, "没有任何请求跟着重定向到了别的地址");
  } finally {
    await other.app.close();
    redirector.closeAllConnections();
    await new Promise<void>((resolve) => redirector.close(() => resolve()));
    await elsewhere.close();
    await wipe();
  }
});

test("测试一下：对方一直不应答 → 每次最多等 5 秒、再试 1 次，结果 TIMEOUT，不卡住、不带原文", async () => {
  const key = remember(fakeKey("AIza", 39));
  await save("google-maps", { api_key: key });
  google.requests.length = 0;
  google.respond({ body: { routes: [] }, delayMs: 7_000 });
  const started = performance.now();
  try {
    const res = await check("google-maps");
    const elapsed = performance.now() - started;
    assert.deepEqual([res.status, res.body.ok, res.body.code], [200, false, "TIMEOUT"]);
    assert.ok(elapsed >= 9_500 && elapsed < 13_000, `等了 ${Math.round(elapsed)} 毫秒`);
    assert.equal(google.requests.length >= 1, true);
  } finally {
    google.respond({ body: { routes: [{ distanceMeters: 6_800 }] } });
    await wipe();
  }
});

test("服务进程：staging / production 配了 GOOGLE_MAPS_ROUTES_URL 或 STRIPE_API_URL 就启动失败（退出码 1，指出是哪一项），输出里没有密钥", async () => {
  const entry = fileURLToPath(new URL("./server.ts", import.meta.url));
  const cases: [string, Record<string, string>, RegExp][] = [
    ["staging", { GOOGLE_MAPS_ROUTES_URL: google.url }, /GOOGLE_MAPS_ROUTES_URL/],
    ["staging", { STRIPE_API_URL: stripe.origin }, /STRIPE_API_URL/],
    ["production", { GOOGLE_MAPS_ROUTES_URL: "https://evil.example/directions/v2:computeRoutes" }, /GOOGLE_MAPS_ROUTES_URL/],
    ["production", { STRIPE_API_URL: "https://api.stripe.com" }, /STRIPE_API_URL/],
  ];
  for (const [env, extra, mentions] of cases) {
    const running = startNode(entry, { ...testEnv(api.db.url), ...ENV, APP_ENV: env, AUTH_JWT_SECRET: "s".repeat(64), PORT: String(await freePort()), ...extra });
    try {
      assert.equal(await exitWithin(running, 15_000), 1, `${env} ${Object.keys(extra)[0]}：${running.output()}`);
      assert.match(running.output(), mentions);
      assert.match(running.output(), /只给本机和 CI 的测试用/);
      assertNoLeak(running.output(), "启动失败的输出");
    } finally {
      if (running.child.exitCode === null) {
        running.child.kill("SIGKILL");
        await running.exited;
      }
    }
  }
});

// ───────────── 库与日志的最后一道检查 ─────────────

test("最后检查：整张审计表、密钥表、应用日志里都没有本文件用过的任何一把密钥或片段", async () => {
  const audits = await api.db.owner.query("select before::text as b, after::text as a, resource, action from audit_logs");
  for (const row of audits.rows) assertNoLeak(`${row.b} ${row.a}`, `审计 ${row.resource} ${row.action}`);
  const secrets = await api.db.owner.query("select sealed, hints::text as hints from integration_secrets");
  for (const row of secrets.rows) assertNoLeak(`${row.sealed} ${row.hints}`, "密钥表");
  assertNoLeak(api.logs(), "应用日志");
});
