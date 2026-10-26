/**
 * 运营后台填写第三方密钥（M4-09，ADR 0041），连真实的 PostgreSQL：
 * - 只有超级管理员能填写、更换、清空、测试；其他内置角色、自建角色（勾不了这一格）、没完成两步验证的会话都是 403；技术只看得到状态和来源。
 * - 接口返回、错误信息、审计、日志里都没有原文（逐个值比对）；库里存的是密文。
 * - 保存后不重启立即生效（/health、收款的通知验签、测试一下都用新值）；清空后回落到服务器配置文件；另一个进程最迟一个缓存周期后用上。
 * - 「测试一下」走本机的假谷歌、假 Stripe：可用和各种不可用。
 * - 租户拿不到任何相关信息。
 * 这里的「密钥」都是测试里现场拼的假值。服务器配置文件这一侧：谷歌地图有（假值），Stripe 没有。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { PLATFORM_ROLES, type PlatformRole } from "@nozomi/domain";
import { loadConfig } from "@nozomi/config";
import { buildApp } from "./app.ts";
import { withTenantTx } from "./db/context.ts";
import { loadMigrationFiles } from "./db/migrate.ts";
import { stripeSignatureHeader } from "./integrations/stripe-signature.ts";
import { createSuperAdmin } from "./services/platform-staff.ts";
import { INTEGRATION_TEST_INTERVAL_MS, saveIntegrationSecretValue } from "./services/integration-secrets.ts";
import type { PlatformPrincipal } from "./services/platform-auth.ts";
import { type ApiResponse, type HttpMethod, TEST_PASSWORD, type TenantFixture, type TestApi, createTestApi, testContext } from "./testing/api.ts";
import { FAKE_SECRETS, testEnv } from "./testing/fixtures.ts";
import { type FakeService, googleErrorBody, startFakeGoogleRoutes, startFakeStripe, stripeBalanceBody } from "./testing/fake-integrations.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { sleep } from "./testing/process.ts";

const fakeKey = (prefix: string): string => `${prefix}${randomBytes(14).toString("hex")}`;
const MAPS_KEY = fakeKey("AIza");
const MAPS_KEY_2 = fakeKey("AIza");
const STRIPE = { secret_key: fakeKey("sk_test_"), publishable_key: fakeKey("pk_test_"), webhook_secret: fakeKey("whsec_") };
const STRIPE_LIVE = { secret_key: fakeKey("sk_live_"), publishable_key: fakeKey("pk_live_"), webhook_secret: fakeKey("whsec_") };
/** 不能出现在任何返回、审计、日志里的原文：后台填的、配置文件里的 */
const SECRETS = [MAPS_KEY, MAPS_KEY_2, ...Object.values(STRIPE), ...Object.values(STRIPE_LIVE), FAKE_SECRETS.googleMapsApiKey];
const ENV = { STRIPE_SECRET_KEY: "", STRIPE_PUBLISHABLE_KEY: "", STRIPE_WEBHOOK_SECRET: "" };
const last4 = (value: string): string => `••••${value.slice(-4)}`;

let api: TestApi;
let google: FakeService;
let stripe: FakeService;
let root: string;
const tokens = new Map<PlatformRole, string>();
let tenant: TenantFixture;

/** 一个 JSON 值里的每一个字符串（含对象的键）。 */
function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const item of value) strings(item, out);
  else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      out.push(key);
      strings(item, out);
    }
  }
  return out;
}

/** 逐个值比对：没有一个字符串等于、或包含任何一把密钥的原文。 */
function assertNoSecret(value: unknown, label: string): void {
  for (const text of strings(value)) {
    for (const secret of SECRETS) {
      assert.notEqual(text, secret, `${label}：出现了密钥原文`);
      assert.ok(!text.includes(secret), `${label}：「${text.slice(0, 40)}…」里有密钥原文`);
    }
  }
}

async function call(method: HttpMethod, url: string, options: { token?: string; body?: unknown; template?: string } = {}): Promise<ApiResponse> {
  const res = await api.call(method, url, { token: options.token ?? root, ...(options.body === undefined ? {} : { body: options.body }) });
  assertNoSecret(res.body, `${method} ${url} → ${res.status}`);
  for (const secret of SECRETS) assert.ok(!res.text.includes(secret), `${method} ${url} 的应答原文里有密钥`);
  if (options.template !== undefined) assertMatchesOpenApi(method, options.template, res);
  return res;
}
const listSecrets = (token = root): Promise<ApiResponse> => call("GET", "/platform/v1/integration-secrets", { token, template: "/platform/v1/integration-secrets" });
const save = (key: string, body: unknown, token = root): Promise<ApiResponse> => call("PUT", `/platform/v1/integration-secrets/${key}`, { token, body, template: "/platform/v1/integration-secrets/{key}" });
const clear = (key: string, token = root): Promise<ApiResponse> => call("DELETE", `/platform/v1/integration-secrets/${key}`, { token, template: "/platform/v1/integration-secrets/{key}" });
/** 测试一下（同一项每 5 秒最多一次）：先把时钟拨过限速的间隔；测限速本身的用例直接用 `checkNow` */
const checkNow = (key: string, token = root): Promise<ApiResponse> => call("POST", `/platform/v1/integration-secrets/${key}/test`, { token, template: "/platform/v1/integration-secrets/{key}/test" });
const check = (key: string, token = root): Promise<ApiResponse> => {
  api.clock.advance(INTEGRATION_TEST_INTERVAL_MS);
  return checkNow(key, token);
};
const itemOf = (res: ApiResponse, key: string): any => res.body.items.find((item: any) => item.key === key);
const healthState = async (app: FastifyInstance | null, key: "googleMaps" | "stripe"): Promise<string> => {
  const res = app === null ? await api.call("GET", "/health") : await app.inject({ method: "GET", url: "/health" }).then((r) => ({ body: r.json() }));
  return res.body.integrations.find((item: any) => item.key === key).state;
};
const auditRows = async (): Promise<any[]> => (await api.db.owner.query("select actor_id, action, resource_id, before, after from audit_logs where resource = 'integration_secret' order by id")).rows;

async function addStaff(email: string, role: string): Promise<string> {
  const invited = await api.call("POST", "/platform/v1/staff", { token: root, body: { email, name: email.split("@")[0], role } });
  assert.equal(invited.status, 201, invited.text);
  await api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.body.invite.token, password: TEST_PASSWORD } });
  const login = await api.platformLogin({ body: { email, password: TEST_PASSWORD } });
  assert.equal(login.status, 200, login.text);
  return login.body.access_token as string;
}

before(async () => {
  google = await startFakeGoogleRoutes();
  stripe = await startFakeStripe();
  api = await createTestApi({ env: { ...ENV, GOOGLE_MAPS_ROUTES_URL: google.url, STRIPE_API_URL: stripe.origin }, integrationSecretsTtlMs: 0 });
  root = await api.superAdminToken("root@platform.test");
  tokens.set("super_admin", root);
  for (const { key } of PLATFORM_ROLES) if (key !== "super_admin") tokens.set(key, await addStaff(`${key.replace("_", "-")}@platform.test`, key));
  tenant = await api.tenantWithAdmin(root, "某车队", "admin@fleet.test");
});
after(async () => {
  await api.close();
  await google.close();
  await stripe.close();
});

test("只有超级管理员能填写、更换、清空、测试：其他 9 个内置角色一律 403；有 integration.read 的技术只看得到状态和来源", async () => {
  for (const { key: role } of PLATFORM_ROLES) {
    if (role === "super_admin") continue;
    const token = tokens.get(role)!;
    for (const res of [await save("google-maps", { api_key: MAPS_KEY }, token), await clear("google-maps", token), await check("google-maps", token), await save("stripe", STRIPE, token)]) {
      assert.equal(res.status, 403, role);
      assert.equal(res.body.error.code, "FORBIDDEN");
    }
  }
  assert.equal((await auditRows()).length, 0, "被拒的请求不留任何改动");
  const tech = await listSecrets(tokens.get("tech")!);
  assert.equal(tech.status, 200);
  assert.equal(tech.body.can_manage, false);
  for (const item of tech.body.items) {
    assert.equal(item.masked, null, item.key);
    assert.equal(item.admin, null, item.key);
  }
  assert.deepEqual(tech.body.items.map((i: any) => [i.key, i.state, i.source]), [["google_maps", "configured", "env"], ["stripe", "missing", "none"]]);
  assert.equal((await listSecrets(tokens.get("operations")!)).status, 403, "没有 integration.read 的看不到");
  const own = await listSecrets();
  assert.equal(own.body.can_manage, true);
  assert.equal(itemOf(own, "google_maps").masked, last4(FAKE_SECRETS.googleMapsApiKey));
  assert.equal(own.body.precedence_note, "运营后台填写的优先；后台没填（或清空后）才用服务器配置文件里的值。");
});

test("自建角色：可以勾「集成状态」的查看（只看得到状态），勾不了编辑；万一库里存进了编辑这一格，接口照样 403", async () => {
  const refused = await call("POST", "/platform/v1/roles", { body: { name: "密钥管理员", grants: ["integrations:view", "integrations:edit"] } });
  assert.equal(refused.status, 400);
  assert.deepEqual(refused.body.error.details.issues.map((i: any) => i.reason), ["SUPER_ADMIN_ONLY"]);
  const role = await call("POST", "/platform/v1/roles", { body: { name: "系统观察员", grants: ["integrations:view"] } });
  assert.equal(role.status, 201, role.text);
  const token = await addStaff("watcher@platform.test", role.body.key);
  await api.db.owner.query("update platform_roles set grants = $2 where key = $1", [role.body.key, ["integrations:view", "integrations:edit"]]);
  assert.equal((await listSecrets(token)).body.can_manage, false);
  for (const res of [await save("google-maps", { api_key: MAPS_KEY }, token), await clear("google-maps", token), await check("google-maps", token)]) {
    assert.deepEqual([res.status, res.body.error.code], [403, "FORBIDDEN"]);
  }
});

test("两步验证没完成的超级管理员会话：403 MFA_REQUIRED，什么都没改", async () => {
  await createSuperAdmin(api.db.pool, { email: "pending@platform.test", name: "待验证", password: TEST_PASSWORD }, api.clock.now());
  const pending = (await api.call("POST", "/platform/v1/auth/login", { body: { email: "pending@platform.test", password: TEST_PASSWORD } })).body.access_token as string;
  for (const res of [await listSecrets(pending), await save("google-maps", { api_key: MAPS_KEY }, pending), await clear("google-maps", pending), await check("google-maps", pending)]) {
    assert.deepEqual([res.status, res.body.error.code], [403, "MFA_REQUIRED"]);
  }
  assert.equal((await api.db.owner.query("select count(*)::int as n from integration_secrets")).rows[0].n, 0);
});

test("谷歌地图：填写 → 打码显示、库里是密文、立即生效（/health、测试一下用新值）→ 更换 → 清空回落到配置文件；审计只有末 4 位", async () => {
  google.requests.length = 0;
  const saved = await save("google-maps", { api_key: `  ${MAPS_KEY}\n` });
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.body.action, "set");
  assert.deepEqual([saved.body.item.state, saved.body.item.source, saved.body.item.masked], ["configured", "admin", last4(MAPS_KEY)]);
  assert.deepEqual(saved.body.item.admin.hints, { api_key: last4(MAPS_KEY) });
  assert.equal(saved.body.item.env_configured, true);

  // 库里是密文：不等于原文、不含原文，也不是原文的 base64；打码字段只有末 4 位
  const row = (await api.db.owner.query("select sealed, hints, version from integration_secrets where integration = 'google_maps'")).rows[0];
  assert.notEqual(row.sealed, MAPS_KEY);
  assert.ok(!row.sealed.includes(MAPS_KEY));
  assert.ok(!row.sealed.includes(Buffer.from(MAPS_KEY).toString("base64url").slice(0, 16)));
  assert.match(row.sealed, /^v1\./);
  assert.deepEqual(row.hints, { api_key: last4(MAPS_KEY) });

  // 立即生效：/health、集成详情、测试一下都按后台的值
  assert.equal(await healthState(null, "googleMaps"), "configured");
  const detail = await call("GET", "/platform/v1/integrations");
  assert.equal(detail.body.items.find((i: any) => i.key === "googleMaps").detail, `后台设置（${last4(MAPS_KEY)}）`);
  const tested = await check("google-maps");
  assert.deepEqual([tested.status, tested.body.ok, tested.body.code, tested.body.source], [200, true, null, "admin"]);
  assert.equal(google.requests.at(-1)?.headers["x-goog-api-key"], MAPS_KEY, "测试一下用的是后台刚填的密钥");

  const replaced = await save("google-maps", { api_key: MAPS_KEY_2 });
  assert.deepEqual([replaced.body.action, replaced.body.item.masked], ["replace", last4(MAPS_KEY_2)]);
  assert.equal((await api.db.owner.query("select version from integration_secrets where integration = 'google_maps'")).rows[0].version, 2);
  await check("google-maps");
  assert.equal(google.requests.at(-1)?.headers["x-goog-api-key"], MAPS_KEY_2);

  const cleared = await clear("google-maps");
  assert.equal(cleared.status, 200, cleared.text);
  assert.deepEqual([cleared.body.item.source, cleared.body.item.masked, cleared.body.item.admin.configured], ["env", last4(FAKE_SECRETS.googleMapsApiKey), false]);
  const fallback = await check("google-maps");
  assert.equal(fallback.body.source, "env");
  assert.equal(google.requests.at(-1)?.headers["x-goog-api-key"], FAKE_SECRETS.googleMapsApiKey, "清空后回落到配置文件里的值");
  const again = await clear("google-maps");
  assert.deepEqual([again.status, again.body.error.code], [409, "INTEGRATION_SECRET_NOT_SET"]);

  // 审计：谁、哪一项、什么动作；前后值只有打码后的末 4 位
  const rows = (await auditRows()).filter((r) => r.resource_id === "google_maps");
  assert.deepEqual(rows.map((r) => r.action), ["set", "test", "replace", "test", "clear", "test"]);
  const rootId = (await api.db.owner.query("select id from platform_users where email = 'root@platform.test'")).rows[0].id;
  assert.ok(rows.every((r) => r.actor_id === rootId));
  assert.deepEqual([rows[0].before, rows[0].after], [null, { hints: { api_key: last4(MAPS_KEY) } }]);
  assert.deepEqual([rows[2].before, rows[2].after], [{ hints: { api_key: last4(MAPS_KEY) } }, { hints: { api_key: last4(MAPS_KEY_2) } }]);
  assert.deepEqual([rows[4].before, rows[4].after], [{ hints: { api_key: last4(MAPS_KEY_2) } }, null]);
  assert.deepEqual(rows[1].after, { source: "admin", ok: true, code: null });
  for (const r of rows) {
    assertNoSecret([r.before, r.after], `审计 ${r.action}`);
    for (const text of strings(r.before?.hints ?? {}).concat(strings(r.after?.hints ?? {})).filter((t) => t.startsWith("•"))) assert.match(text, /^••••[A-Za-z0-9_-]{4}$/);
  }
});

test("Stripe：三项一组、只收测试密钥；填写后立即用新密钥收款（通知验签、测试一下），清空后回到未配置；错误信息里没有原文", async () => {
  assert.equal(await healthState(null, "stripe"), "missing");
  const partial = await save("stripe", { secret_key: STRIPE.secret_key, publishable_key: "", webhook_secret: STRIPE.webhook_secret });
  assert.equal(partial.status, 400);
  assert.deepEqual(partial.body.error.details.issues.map((i: any) => [i.path, i.reason]), [["/publishable_key", "REQUIRED"]]);
  const live = await save("stripe", STRIPE_LIVE);
  assert.deepEqual(live.body.error.details.issues.map((i: any) => [i.path, i.reason]), [["/secret_key", "LIVE_KEY_NOT_ALLOWED"]]);
  const mixed = await save("stripe", { ...STRIPE, publishable_key: STRIPE_LIVE.publishable_key });
  assert.deepEqual(mixed.body.error.details.issues.map((i: any) => [i.path, i.reason]), [["/publishable_key", "MODE_MISMATCH"]]);
  const prefix = await save("stripe", { ...STRIPE, secret_key: `rk_test_${STRIPE.secret_key.slice(8)}` });
  assert.deepEqual(prefix.body.error.details.issues.map((i: any) => [i.path, i.reason]), [["/secret_key", "PREFIX"]]);
  const short = await save("google-maps", { api_key: "AIza short key" });
  assert.deepEqual(short.body.error.details.issues.map((i: any) => [i.path, i.reason]), [["/api_key", "TOO_SHORT"]]);
  assert.equal((await api.db.owner.query("select count(*)::int as n from integration_secrets")).rows[0].n, 0, "校验不过的一样都没存");

  const body = Buffer.from(JSON.stringify({ id: "evt_fake_1", object: "event", type: "customer.created", livemode: false, created: Math.floor(api.clock.now().getTime() / 1000), data: { object: { id: "cus_fake_1", object: "customer" } } }));
  const deliver = (secret: string): Promise<number> =>
    api.app.inject({ method: "POST", url: "/webhooks/stripe", headers: { "content-type": "application/json", "stripe-signature": stripeSignatureHeader(body, secret, Math.floor(api.clock.now().getTime() / 1000)) }, payload: body }).then((r) => r.statusCode);
  assert.equal(await deliver(STRIPE.webhook_secret), 503, "还没配置 Stripe：收不了通知");

  const saved = await save("stripe", STRIPE);
  assert.equal(saved.status, 200, saved.text);
  assert.deepEqual([saved.body.item.source, saved.body.item.mode, saved.body.item.masked], ["admin", "test", last4(STRIPE.secret_key)]);
  assert.deepEqual(saved.body.item.admin.hints, { secret_key: last4(STRIPE.secret_key), publishable_key: last4(STRIPE.publishable_key), webhook_secret: last4(STRIPE.webhook_secret) });
  const sealed = (await api.db.owner.query("select sealed from integration_secrets where integration = 'stripe'")).rows[0].sealed as string;
  for (const value of Object.values(STRIPE)) assert.ok(!sealed.includes(value));
  assert.equal(await healthState(null, "stripe"), "configured");
  assert.equal(await deliver(STRIPE.webhook_secret), 200, "收款服务立即换成了新的 webhook 密钥");
  assert.equal(await deliver(fakeKey("whsec_")), 400, "别的密钥签的不认");

  stripe.requests.length = 0;
  const tested = await check("stripe");
  assert.deepEqual([tested.body.ok, tested.body.source], [true, "admin"]);
  assert.deepEqual(stripe.requests.map((r) => [r.method, r.path, r.headers.authorization]), [["GET", "/v1/balance", `Bearer ${STRIPE.secret_key}`]]);

  stripe.respond({ status: 401, body: { error: { type: "invalid_request_error", message: `Invalid API Key provided: ${STRIPE.secret_key}` } } });
  const invalid = await check("stripe");
  assert.deepEqual([invalid.body.ok, invalid.body.code], [false, "KEY_INVALID"]);
  stripe.respond({ body: stripeBalanceBody(true) });
  assert.equal((await check("stripe")).body.code, "MODE_MISMATCH");
  stripe.respond({ body: stripeBalanceBody() });

  assert.equal((await clear("stripe")).body.item.state, "missing");
  assert.equal(await healthState(null, "stripe"), "missing");
  assert.equal(await deliver(STRIPE.webhook_secret), 503, "清空后配置文件里也没有：回到未配置");
  const none = await check("stripe");
  assert.deepEqual([none.status, none.body.error.code], [409, "INTEGRATION_NOT_CONFIGURED"]);
});

test("测试一下：假谷歌的各种不可用（密钥无效、没开通 API、密钥有限制、没绑定付款、超限、对方出错、连不上），只给原因和说明", async () => {
  await save("google-maps", { api_key: MAPS_KEY });
  const cases: [number, string, string | null, string][] = [
    [400, "INVALID_ARGUMENT", "API_KEY_INVALID", "KEY_INVALID"],
    [403, "PERMISSION_DENIED", "SERVICE_DISABLED", "API_NOT_ENABLED"],
    [403, "PERMISSION_DENIED", "API_KEY_SERVICE_BLOCKED", "KEY_RESTRICTED"],
    [403, "PERMISSION_DENIED", "BILLING_DISABLED", "BILLING_DISABLED"],
    [429, "RESOURCE_EXHAUSTED", "RATE_LIMIT_EXCEEDED", "QUOTA_EXCEEDED"],
    [503, "UNAVAILABLE", null, "UNAVAILABLE"],
  ];
  for (const [status, googleStatus, reason, code] of cases) {
    google.respond({ status, body: googleErrorBody(status, googleStatus, reason) });
    const res = await check("google-maps");
    assert.deepEqual([res.status, res.body.ok, res.body.code], [200, false, code], `${status} ${reason}`);
    assert.ok(!res.text.includes("fake google"), "不带对方返回的原文");
  }
  google.respond({ body: { routes: [] } });
  await google.close();
  const down = await check("google-maps");
  assert.deepEqual([down.body.ok, down.body.code], [false, "UNREACHABLE"]);
  google = await startFakeGoogleRoutes(Number(new URL(google.url).port));
  const tests = (await auditRows()).filter((r) => r.action === "test" && r.resource_id === "google_maps").slice(-7);
  assert.deepEqual(tests.map((r) => r.after.code), ["KEY_INVALID", "API_NOT_ENABLED", "KEY_RESTRICTED", "BILLING_DISABLED", "QUOTA_EXCEEDED", "UNAVAILABLE", "UNREACHABLE"]);
  await clear("google-maps");
});

test("测试一下限速：同一项每 5 秒最多一次，不分人（429 INTEGRATION_TEST_RATE_LIMITED，带 Retry-After）；另一项不受影响；同时到的两个只有一个去调对方", async () => {
  await save("google-maps", { api_key: MAPS_KEY });
  await save("stripe", STRIPE);
  api.clock.advance(INTEGRATION_TEST_INTERVAL_MS);
  google.requests.length = 0;
  assert.equal((await checkNow("google-maps")).body.ok, true);
  const second = await createSuperAdmin(api.db.pool, { email: "root2@platform.test", name: "第二位", password: TEST_PASSWORD }, api.clock.now()).then(() => api.platformLogin({ body: { email: "root2@platform.test", password: TEST_PASSWORD } }));
  api.clock.advance(2_000);
  const limited = await checkNow("google-maps", second.body.access_token);
  assert.deepEqual([limited.status, limited.body.error.code, limited.body.error.message, limited.body.error.details.retry_after_seconds], [429, "INTEGRATION_TEST_RATE_LIMITED", "刚测过，请过几秒再试", 3]);
  assert.equal(limited.headers["retry-after"], "3");
  assert.equal((await checkNow("stripe")).status, 200, "另一项不受影响");
  assert.equal(google.requests.length, 1, "被限速的那次没有调谷歌");
  api.clock.advance(3_000);
  assert.equal((await checkNow("google-maps")).status, 200, "过了 5 秒又可以");
  api.clock.advance(INTEGRATION_TEST_INTERVAL_MS);
  const both = await Promise.all([checkNow("google-maps"), checkNow("google-maps")]);
  assert.deepEqual(both.map((r) => r.status).sort(), [200, 429]);
  assert.equal(google.requests.length, 3);
  await clear("google-maps");
  await clear("stripe");
});

test("另一个进程：本进程改了，别的进程最迟一个缓存周期后用上（不用重启）；清空同样", async () => {
  const ttlMs = 1_500;
  const other = buildApp({ config: loadConfig({ ...testEnv(api.db.url), ...ENV }), pool: api.db.pool, migrationFiles: await loadMigrationFiles(), logger: false, integrationSecretsTtlMs: ttlMs });
  try {
    assert.equal(await healthState(other, "stripe"), "missing");
    await save("stripe", STRIPE);
    assert.equal(await healthState(other, "stripe"), "missing", "缓存周期内还是旧的");
    await sleep(ttlMs + 100);
    assert.equal(await healthState(other, "stripe"), "configured", "过了缓存周期用上了新值");
    await clear("stripe");
    await sleep(ttlMs + 100);
    assert.equal(await healthState(other, "stripe"), "missing");
  } finally {
    await other.close();
  }
});

test("库里的密文解不开（数据加密密钥换了、被改过）：不生效、回落到配置文件，页面标出要重新填写", async () => {
  await save("google-maps", { api_key: MAPS_KEY });
  await save("stripe", STRIPE);
  // 把 Stripe 的密文搬到谷歌地图这一行：附加数据对不上，解不开
  await api.db.owner.query("update integration_secrets set sealed = (select sealed from integration_secrets where integration = 'stripe') where integration = 'google_maps'");
  const list = await listSecrets();
  const maps = itemOf(list, "google_maps");
  assert.deepEqual([maps.source, maps.admin.configured, maps.admin.problem, maps.masked], ["env", true, "UNREADABLE", last4(FAKE_SECRETS.googleMapsApiKey)]);
  assert.equal(itemOf(list, "stripe").admin.problem, null);
  await clear("google-maps");
  await clear("stripe");
});

test("服务器没有配置数据加密密钥：不能在后台填写（503），也不碰数据库", async () => {
  const config = loadConfig({ ...testEnv(api.db.url), DATA_ENCRYPTION_KEY: "" });
  const ctx = testContext(config, api.db.pool, api.clock.now);
  await assert.rejects(saveIntegrationSecretValue(ctx, {} as PlatformPrincipal, { key: "google_maps", apiKey: MAPS_KEY }, "127.0.0.1"), (err: any) => err.statusCode === 503 && err.code === "INTEGRATION_ENCRYPTION_NOT_CONFIGURED" && !err.message.includes(MAPS_KEY));
  const status = await listSecrets();
  assert.equal(status.body.encryption_configured, true, "对照：这个测试环境配了");
});

test("租户拿不到任何相关信息：平台接口 401，租户一侧没有这样的接口，租户的数据库角色读不了这张表", async () => {
  await save("google-maps", { api_key: MAPS_KEY });
  for (const [method, url] of [["GET", "/platform/v1/integration-secrets"], ["PUT", "/platform/v1/integration-secrets/google-maps"], ["POST", "/platform/v1/integration-secrets/google-maps/test"], ["GET", "/platform/v1/integrations"]] as const) {
    const res = await call(method, url, { token: tenant.adminToken, body: method === "PUT" ? { api_key: MAPS_KEY_2 } : undefined });
    assert.equal(res.status, 401, `${method} ${url}`);
  }
  for (const url of ["/tenant/v1/integration-secrets", "/tenant/v1/integrations"]) assert.equal((await call("GET", url, { token: tenant.adminToken })).status, 404);
  const me = await call("GET", "/tenant/v1/auth/me", { token: tenant.adminToken });
  assert.equal(me.status, 200);
  await assert.rejects(
    withTenantTx(api.db.pool, tenant.tenantId, (db) => db.query("select * from integration_secrets")),
    (err: any) => err.code === "42501",
  );
  await clear("google-maps");
});

test("日志里没有任何一把密钥的原文（含测试一下失败、校验不过的请求）", () => {
  const logs = api.logs();
  for (const secret of SECRETS) assert.ok(!logs.includes(secret), "日志里出现了密钥原文");
});
