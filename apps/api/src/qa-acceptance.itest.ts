/**
 * M8-26：测试环境的验收通道（ADR 0078），经真实接口、真实 PostgreSQL。
 * - 没配口令：解锁接口和不存在一样 404，官网一切照旧；
 * - 配了口令：口令不对和没配一样 404、限速、记审计（不记口令）；口令对了发会话 Cookie；
 * - 只有 QA 测试供应商能把商品设为「验收可售」（服务层 409、数据库触发器）；
 * - 带验收会话：官网城市、机场、询价（含按两个坐标）只看 QA 测试供应商的验收可售商品，下的是验收单；不带：和没有验收可售商品时逐字节相同；
 * - /sales/v1 和平台试算永远没有它；验收报价和普通报价互相不能下单；
 * - 验收单：不进出账；Stripe 不是测试模式时不建单；客人邮箱只能是测试地址；邮件只发 qa-staging@，别的压下并留存内容；
 * - 租户隔离不变；口令不出现在任何应答、日志、审计里。
 * 测试数据只在这里构造，结束时连同 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { loadConfig } from "@nozomi/config";
import type { MailMessage } from "@nozomi/domain";
import { buildApp } from "./app.ts";
import { loadMigrationFiles } from "./db/migrate.ts";
import { withPlatformTx } from "./db/context.ts";
import type { PaymentProvider } from "./integrations/payments.ts";
import type { Mailer } from "./integrations/smtp.ts";
import { listBillableItems, listTenantsWithBillableItems } from "./repos/billing.ts";
import { type ApiResponse, type CallOptions, type HttpMethod, type TenantFixture, type TestApi, createTestApi } from "./testing/api.ts";
import { seedOrder } from "./testing/dispatch.ts";
import { UNREACHABLE_INTEGRATIONS, testEnv } from "./testing/fixtures.ts";
import { DROPOFF, type Market, SERVICE_TIME, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";
import { ensureQaTenant } from "./services/qa-tenant.ts";
import { QUOTE_CATALOG_TTL_MS } from "./services/quote-catalog.ts";

const TOKEN = "qa-acceptance-token-for-itests-only-Vb93kLm2Qz7Rt";
const QA_EMAIL = "qa-admin@example.com";
const QA_PASSWORD = "Qa-Staging-Only-Passw0rd-7";
const SESSION_PATH = "/site/v1/qa-acceptance/session";

interface Site {
  app: FastifyInstance;
  logs: string[];
  /** 这个应用给出的全部应答（请求头 + 正文），核对口令没有出现在任何应答里 */
  responses: string[];
  sent: MailMessage[];
  call(method: HttpMethod, url: string, options?: CallOptions & { cookie?: string }): Promise<ApiResponse>;
}

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let clientId: string;
let sales: { clientId: string; secret: string };
/** 销售端的访问令牌有效期短（时钟会拨好几个小时）：每次现换 */
const salesToken = async (): Promise<string> => (await ok(api.call("POST", "/sales/v1/oauth/token", { ip: "198.51.100.20", body: { grant_type: "client_credentials", client_id: sales.clientId, client_secret: sales.secret } }))).access_token;
let qa: TenantFixture;
let plain: Site;
let gated: Site;
const sites: Site[] = [];
const ids: Record<string, string> = {};
let ipSeq = 0;
const nextIp = (): string => `203.0.113.${(ipSeq++ % 200) + 20}`;

/** 一个官网应用（同一个库、同一个时钟）：可以配口令、换收款服务、换环境；截下日志和「真的发出去」的邮件。 */
async function siteApp(options: { token?: boolean; payments?: PaymentProvider | null; appEnv?: "production" } = {}): Promise<Site> {
  const logs: string[] = [];
  const responses: string[] = [];
  const sent: MailMessage[] = [];
  const mailer: Mailer = {
    send: async (_settings, message) => {
      sent.push(message);
      return { ok: true, messageId: `<${randomUUID()}@example.test>` };
    },
  };
  const loaded = loadConfig({ ...testEnv(api.db.url), ...UNREACHABLE_INTEGRATIONS, SITE_CLIENT_ID: clientId, ...(options.token === true ? { QA_ACCEPTANCE_TOKEN: TOKEN } : {}) });
  // production 配了口令根本启动不了（config 的单元测试）；这里手工造一个「万一」的配置，证明代码里的第二道关
  const config = options.appEnv === "production" ? { ...loaded, appEnv: "production" as const } : loaded;
  const app = buildApp({
    config,
    pool: api.db.pool,
    migrationFiles: await loadMigrationFiles(),
    now: api.clock.now,
    payments: options.payments === undefined ? pay : options.payments,
    mailer,
    logDestination: { write: (line: string) => void logs.push(line) },
  });
  const site: Site = {
    app,
    logs,
    responses,
    sent,
    call: async (method, url, callOptions = {}) => {
      const res = await app.inject({
        method,
        url,
        headers: { ...callOptions.headers, ...(callOptions.cookie === undefined ? {} : { cookie: callOptions.cookie }), ...(callOptions.token === undefined ? {} : { authorization: `Bearer ${callOptions.token}` }) },
        ...(callOptions.body === undefined ? {} : { payload: callOptions.body as object }),
        remoteAddress: callOptions.ip ?? nextIp(),
      });
      responses.push(`${JSON.stringify(res.headers)}\n${res.body}`);
      let body: unknown = null;
      try {
        body = res.body === "" ? null : res.json();
      } catch {
        body = null;
      }
      return { status: res.statusCode, headers: res.headers, text: res.body, body };
    },
  };
  sites.push(site);
  return site;
}

type Box = [number, number, number, number];
const square = ([west, south, east, north]: Box): unknown => ({ type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] });

function tenantCall(who: TenantFixture, method: HttpMethod, path: string, options: { body?: unknown; version?: number } = {}): Promise<ApiResponse> {
  api.clock.advance(1_000);
  return api.call(method, `/tenant/v1${path}`, {
    token: who.adminToken,
    ...(options.body === undefined ? {} : { body: options.body }),
    headers: { ...(options.version === undefined ? {} : { "if-match": `"${options.version}"` }), ...(method === "POST" && /^\/(products|brands|areas)$|\/price-rules$/.test(path) ? { "idempotency-key": randomUUID() } : {}) },
  });
}
const version = async (who: TenantFixture, productId: string): Promise<number> => (await ok(tenantCall(who, "GET", `/products/${productId}`))).version;

/** QA 供应商自己经接口建一个成田接送机商品（商务 7 座一口价 5,000），能通过上架校验，不上架。 */
async function qaTransfer(price: number): Promise<string> {
  const brand = (await ok(tenantCall(qa, "POST", "/brands", { body: { name: `QA-${randomUUID().slice(0, 6)}`, currency: "JPY" } }), 201)).id;
  const areaId = (await ok(tenantCall(qa, "POST", "/areas", { body: { city_id: m.ids.tokyo, name: { zh: "QA 区域" }, biz_type: "general", polygons: [{ kind: "operate", geometry: square([139.0, 35.0, 140.5, 36.0]) }] } }), 201)).id;
  const created = await ok(
    tenantCall(qa, "POST", "/products", {
      body: { brand_id: brand, city_id: m.ids.tokyo, category: "airport_transfer", poi_id: m.ids.narita, areas: [{ area_id: areaId }], vehicle_groups: [{ vehicle_group_id: m.ids.biz7, passengers: 6, luggage: 4 }], dispatchers: [{ name: "调度", phone: "0312345678" }] },
    }),
    201,
  );
  const rules = await ok(tenantCall(qa, "PUT", `/products/${created.id}/service-rules`, { version: 1, body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { pickup: { mode: "limited", minutes: 90 }, dropoff: { mode: "limited", minutes: 15 } } } }));
  await ok(tenantCall(qa, "PUT", `/products/${created.id}/content`, { version: rules.version, body: { zh: { title: "QA 接送", pickup_guide: "到达大厅" } } }));
  await ok(tenantCall(qa, "POST", `/products/${created.id}/price-rules`, { version: await version(qa, created.id), body: { area_id: areaId, vehicle_group_id: m.ids.biz7, direction: "both", pricing_model: "fixed", valid_from: "2026-01-01", base_price: price } }), 201);
  return created.id;
}

const quoteBody = { city_id: "", airport_id: "", direction: "pickup", address: DROPOFF, service_local: "2026-10-20T10:00", passengers: 2, luggage: 1 };
const byPointsBody = { pickup: { name: "成田机场", lat: 35.7686, lng: 140.3887, kind: "airport" }, dropoff: { name: "东京站", lat: 35.6812, lng: 139.7671 }, service_local: "2026-10-20T10:00", passengers: 2, luggage: 1 };
const PASSENGER = { name: "验收客人", phone: "+81 90-1234-5678", email: "guest@example.com" };

const siteQuote = (site: Site, cookie?: string): Promise<ApiResponse> => site.call("POST", "/site/v1/quotes", { body: { ...quoteBody, city_id: m.ids.tokyo, airport_id: m.ids.narita }, ...(cookie === undefined ? {} : { cookie }) });
const siteOrder = (site: Site, quoteId: string, options: { cookie?: string; email?: string } = {}): Promise<ApiResponse> =>
  site.call("POST", "/site/v1/orders", { headers: { "idempotency-key": randomUUID() }, body: { quote_id: quoteId, passenger: { ...PASSENGER, email: options.email ?? PASSENGER.email }, flight_no: "NH211", dropoff_address: "东京站八重洲口", save_payment_method: true }, ...(options.cookie === undefined ? {} : { cookie: options.cookie }) });

/** 官网普通客人看到的全部（城市、机场、包车套餐、询价、按两个坐标），报价编号换成占位：同一时刻、同一份数据应逐字节相同。 */
async function publicView(site: Site): Promise<string> {
  const texts: string[] = [];
  for (const res of [
    await site.call("GET", "/site/v1/cities"),
    await site.call("GET", `/site/v1/cities/${m.ids.tokyo}/airports`),
    await site.call("GET", `/site/v1/cities/${m.ids.tokyo}/charter-packages`),
    await siteQuote(site),
    await site.call("POST", "/site/v1/quotes/by-points", { body: byPointsBody }),
  ]) {
    assert.equal(res.status, 200, res.text);
    texts.push(`${res.status} ${res.text.replace(/QT\d{8}[0-9A-Z]{10}/g, "QT-ID")}`);
  }
  return texts.join("\n");
}

async function unlock(site: Site): Promise<string> {
  const res = await site.call("POST", SESSION_PATH, { body: { token: TOKEN } });
  assert.equal(res.status, 201, res.text);
  assertMatchesOpenApi("POST", SESSION_PATH, res);
  const cookie = String(res.headers["set-cookie"]);
  return cookie.split(";")[0] as string;
}

/** 商务 7 座那一个报价（普通客人那边乙 19,800 最低、甲 20,000；QA 只有这一个车型组） */
const biz7 = (body: any): any => body.quotes.find((quote: any) => quote.vehicle_group.id === m.ids.biz7);

const winnerTenantOf = async (quoteId: string): Promise<{ tenant: string; acceptance: boolean }> => {
  const row = (await api.db.owner.query("select winner_tenant_id, is_acceptance from quotes where id = $1", [quoteId])).rows[0];
  return { tenant: row.winner_tenant_id, acceptance: row.is_acceptance };
};

/** 收款服务处在正式模式（`sk_live_` 密钥时 Stripe 的收款服务就是这样）。 */
class LiveFakePayments extends FakePaymentProvider {
  override readonly livemode: boolean = true;
}

let baselineView: string;
let baselineTotal: string;

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  const siteChannel = (await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" })).id;
  clientId = (await salesCredentials(api, m, siteChannel)).clientId;
  const salesChannel = (await newChannel(api, m.staff.cm1.token, { name: "OTA" })).id;
  sales = await salesCredentials(api, m, salesChannel, "198.51.100.20");
  plain = await siteApp();
  gated = await siteApp({ token: true });

  const outcome = await ensureQaTenant(api.db.pool, { email: QA_EMAIL, name: "QA 验收管理员", password: QA_PASSWORD, resetPassword: false }, api.clock.now());
  assert.equal(outcome.kind, "created");
  const login = await ok(api.call("POST", "/tenant/v1/auth/login", { body: { email: QA_EMAIL, password: QA_PASSWORD } }));
  qa = { tenantId: outcome.tenant.id, adminId: outcome.admin.id, adminEmail: QA_EMAIL, adminToken: login.access_token };
  ids["qaProduct"] = await qaTransfer(5_000);

  // 基线：还没有验收可售商品时普通客人看到的（新起一个官网应用，目录缓存是空的）
  api.clock.advance(QUOTE_CATALOG_TTL_MS + 1);
  baselineView = await publicView(await siteApp({ token: true }));
  baselineTotal = biz7(await ok(siteQuote(plain))).price.total.amount;
});
after(async () => {
  for (const site of sites) await site.app.close();
  await api.close();
});

test("没配口令：解锁、查看、结束会话都和接口不存在一样 404（请求体写坏了也一样）；官网别的照旧", async () => {
  const missing = await plain.call("POST", "/site/v1/qa-acceptance/nothing", { body: { token: TOKEN } });
  assert.equal(missing.status, 404);
  for (const [method, body] of [["POST", { token: TOKEN }], ["POST", "{坏的 JSON"], ["GET", undefined], ["DELETE", undefined]] as const) {
    const res = await plain.call(method, SESSION_PATH, { ...(body === undefined ? {} : { body }), headers: { "content-type": "application/json" } });
    assert.equal(res.status, 404, `${method} ${res.text}`);
    assert.deepEqual(res.body, { error: { code: "NOT_FOUND", message: "接口不存在", details: { method, path: SESSION_PATH } } });
    assert.deepEqual(Object.keys(res.body.error), Object.keys(missing.body.error));
  }
  assert.equal((await siteQuote(plain)).status, 200);
});

test("只有 QA 测试供应商能设「验收可售」：普通供应商 409、改库被触发器拒绝；QA 供应商能设，仍停在申请中、仍不能上架", async () => {
  const refused = await tenantCall(m.a, "POST", `/products/${m.ids.pa}/qa-list`);
  assert.deepEqual([refused.status, refused.body.error.code], [409, "NOT_TEST_TENANT"]);
  assertMatchesOpenApi("POST", "/tenant/v1/products/{id}/qa-list", refused);
  await assert.rejects(api.db.owner.query("update products set status = 'qa_listed' where id = $1", [m.ids.pa]), (err: any) => err.code === "23514" && err.constraint === "products_qa_listed_test_tenant_only");
  // 别的供应商的商品当作不存在（租户只来自令牌）
  assert.equal((await tenantCall(qa, "POST", `/products/${m.ids.pa}/qa-list`)).status, 404);
  assert.equal((await tenantCall(m.a, "POST", `/products/${ids["qaProduct"]}/qa-list`)).status, 404);

  const listed = await tenantCall(qa, "POST", `/products/${ids["qaProduct"]}/qa-list`);
  assert.equal(listed.status, 200, listed.text);
  assertMatchesOpenApi("POST", "/tenant/v1/products/{id}/qa-list", listed);
  assert.equal(listed.body.status, "qa_listed");
  assert.equal((await tenantCall(qa, "POST", `/products/${ids["qaProduct"]}/qa-list`)).body.status, "qa_listed", "再设一次原样返回");
  const published = await tenantCall(qa, "POST", `/products/${ids["qaProduct"]}/publish`);
  assert.deepEqual([published.status, published.body.error.code], [409, "TENANT_NOT_ONBOARDED"]);
  assert.equal((await api.db.owner.query("select status from tenants where id = $1", [qa.tenantId])).rows[0].status, "applying");
  // 带验收可售商品的测试供应商不能被摘掉测试标记
  await assert.rejects(api.db.owner.query("update tenants set is_test_tenant = false where id = $1", [qa.tenantId]), (err: any) => err.code === "23514");
  const audit = (await api.db.owner.query("select action, after from audit_logs where resource = 'product' and resource_id = $1 and action = 'publish'", [ids["qaProduct"]])).rows;
  assert.deepEqual(audit.map((row) => row.after.status), ["qa_listed"]);
});

test("不带验收会话：有没有验收可售商品，官网城市、机场、包车套餐、询价、按两个坐标报价逐字节相同（报价编号除外）", async () => {
  assert.equal((await api.db.owner.query("select status from products where id = $1", [ids["qaProduct"]])).rows[0].status, "qa_listed");
  api.clock.advance(QUOTE_CATALOG_TTL_MS + 1);
  const now = api.clock.now();
  const fresh = await siteApp({ token: true });
  const view = await publicView(fresh);
  // 时钟拨过：只有时间相关的字段（有效期）会变——把基线的那一刻换成这一刻再比
  assert.equal(api.clock.now().getTime(), now.getTime());
  const normalize = (text: string): string => text.replace(/"expires_at":"[^"]+"/g, '"expires_at":"T"');
  assert.equal(normalize(view), normalize(baselineView));
  assert.ok(!view.includes(qa.tenantId) && !view.includes(ids["qaProduct"] as string));
});

test("/sales/v1 和平台试算永远没有验收可售商品", async () => {
  const quoted = await ok(api.call("POST", "/sales/v1/quotes", { token: await salesToken(), body: { city_id: m.ids.tokyo, category: "airport_transfer", place_id: m.ids.narita, direction: "pickup", dropoff: DROPOFF, service_time: SERVICE_TIME, passengers: 2, luggage: 1, currency: "JPY", vehicle_group_ids: [m.ids.biz7] } }));
  for (const quote of quoted.quotes) assert.notEqual((await winnerTenantOf(quote.quote_id)).tenant, qa.tenantId);
  assert.equal(quoted.quotes[0].price.total.amount, baselineTotal);
  const preview = await ok(api.call("POST", "/platform/v1/quotes/preview", { token: m.root, body: { city_id: m.ids.tokyo, category: "airport_transfer", place_id: m.ids.narita, currency: "JPY", direction: "pickup", dropoff: DROPOFF, service_time: "2026-10-20T10:00", passengers: 2, luggage: 1, vehicle_group_ids: [m.ids.biz7] } }));
  assert.ok(!JSON.stringify(preview).includes(ids["qaProduct"] as string), "平台试算只取已上架的商品");
});

test("口令不对：和没开一样 404、记审计（不记口令）；按地址 15 分钟 10 次、全站每小时 30 次（成功失败都计）", async () => {
  const ip = "198.51.100.77";
  for (let i = 0; i < 10; i += 1) {
    const res = await gated.call("POST", SESSION_PATH, { body: { token: `wrong-${i}-${TOKEN}` }, ip });
    assert.equal(res.status, 404, res.text);
    assert.deepEqual(res.body.error.code, "NOT_FOUND");
    assert.equal(res.headers["set-cookie"], undefined);
  }
  const limited = await gated.call("POST", SESSION_PATH, { body: { token: TOKEN }, ip });
  assert.equal(limited.status, 429, "被限住了：口令对也不放行");
  assertMatchesOpenApi("POST", SESSION_PATH, limited);
  const failed = (await api.db.owner.query("select actor_type, ip::text as ip, after from audit_logs where resource = 'qa_acceptance_session' and action = 'login_failed'")).rows;
  assert.equal(failed.length, 10);
  assert.ok(failed.every((row) => row.actor_type === "anonymous" && row.after.reason === "WRONG_TOKEN" && String(row.ip).startsWith(ip)));
  // 全站：换地址也猜不动（已经用了 11 次；再用 19 个地址各猜一次到 30，第 31 次被挡）
  for (let i = 0; i < 19; i += 1) assert.equal((await gated.call("POST", SESSION_PATH, { body: { token: `guess-${i}` }, ip: `192.0.2.${i + 1}` })).status, 404);
  assert.equal((await gated.call("POST", SESSION_PATH, { body: { token: TOKEN }, ip: "192.0.2.200" })).status, 429);
  // 测试接着要解锁：清掉限速计数（只在测试代码里）
  await api.db.owner.query("delete from sales_rate_limits where bucket like 'site_qa_unlock%'");
});

test("口令对了：201 + HttpOnly、Secure、SameSite=Strict、只在 /site/v1 下的会话 Cookie；库里只有哈希；GET 看得到、DELETE 结束", async () => {
  const res = await gated.call("POST", SESSION_PATH, { body: { token: TOKEN } });
  assert.equal(res.status, 201, res.text);
  const header = String(res.headers["set-cookie"]);
  assert.match(header, /^nozomi_qa=[A-Za-z0-9_-]{43}; Path=\/site\/v1; Max-Age=14400; HttpOnly; Secure; SameSite=Strict$/);
  assert.equal(res.body.active, true);
  assert.equal(new Date(res.body.expires_at).getTime(), api.clock.now().getTime() + 4 * 3_600_000);
  const cookie = header.split(";")[0] as string;
  const value = cookie.slice("nozomi_qa=".length);
  const stored = JSON.stringify((await api.db.owner.query("select * from qa_acceptance_sessions")).rows);
  assert.ok(!stored.includes(value), "库里只有哈希");
  const seen = await gated.call("GET", SESSION_PATH, { cookie });
  assertMatchesOpenApi("GET", SESSION_PATH, seen);
  assert.equal(seen.body.active, true);
  const ended = await gated.call("DELETE", SESSION_PATH, { cookie });
  assert.equal(ended.status, 204);
  assert.match(String(ended.headers["set-cookie"]), /^nozomi_qa=; Path=\/site\/v1; Max-Age=0; HttpOnly; Secure; SameSite=Strict$/);
  const afterEnd = await gated.call("GET", SESSION_PATH, { cookie });
  assert.deepEqual([afterEnd.status, afterEnd.body.error.code], [401, "QA_SESSION_INVALID"]);
  assertMatchesOpenApi("GET", SESSION_PATH, afterEnd);
  // 结束了的会话带着去询价：401，不悄悄退回普通客人
  const stale = await siteQuote(gated, cookie);
  assert.deepEqual([stale.status, stale.body.error.code], [401, "QA_SESSION_INVALID"]);
  assertMatchesOpenApi("POST", "/site/v1/quotes", stale);
  // 过期的也一样
  const expiring = await unlock(gated);
  api.clock.advance(4 * 3_600_000 + 1);
  assert.equal((await siteQuote(gated, expiring)).status, 401);
  const actions = (await api.db.owner.query("select action from audit_logs where resource = 'qa_acceptance_session' and action <> 'login_failed' order by id")).rows.map((row) => row.action);
  assert.deepEqual(actions, ["unlock", "close", "unlock"]);
});

test("带验收会话：城市、机场只看验收可售商品，询价只报 QA 测试供应商（报价标成验收的）；同一个应用里普通客人照旧（目录缓存不串）", async () => {
  const cookie = await unlock(gated);
  const cities = await gated.call("GET", "/site/v1/cities", { cookie });
  assertMatchesOpenApi("GET", "/site/v1/cities", cities);
  assert.deepEqual(cities.body.items.map((city: any) => [city.code, city.categories]), [["CTY-JP-TYO", ["airport_transfer"]]]);
  const airports = await gated.call("GET", `/site/v1/cities/${m.ids.tokyo}/airports`, { cookie });
  assert.deepEqual(airports.body.items.map((airport: any) => airport.code), ["NRT"]);
  assert.deepEqual((await gated.call("GET", `/site/v1/cities/${m.ids.tokyo}/charter-packages`, { cookie })).body.items, []);

  const quoted = await siteQuote(gated, cookie);
  assert.equal(quoted.status, 200, quoted.text);
  assertMatchesOpenApi("POST", "/site/v1/quotes", quoted);
  assert.equal(quoted.body.quotes.length, 1);
  assert.notEqual(quoted.body.quotes[0].price.total.amount, baselineTotal);
  assert.deepEqual(await winnerTenantOf(quoted.body.quotes[0].quote_id), { tenant: qa.tenantId, acceptance: true });
  ids["qaQuote"] = quoted.body.quotes[0].quote_id;

  const byPoints = await gated.call("POST", "/site/v1/quotes/by-points", { body: byPointsBody, cookie });
  assert.equal(byPoints.status, 200, byPoints.text);
  assertMatchesOpenApi("POST", "/site/v1/quotes/by-points", byPoints);
  for (const quote of byPoints.body.quotes) assert.deepEqual(await winnerTenantOf(quote.quote_id), { tenant: qa.tenantId, acceptance: true });

  // 同一个应用、同一时刻（目录缓存还热）：不带 Cookie 的客人看到的还是真实供应商
  const publicQuote = biz7(await ok(siteQuote(gated)));
  assert.equal(publicQuote.price.total.amount, baselineTotal);
  assert.deepEqual(await winnerTenantOf(publicQuote.quote_id), { tenant: m.b.tenantId, acceptance: false });
  ids["publicQuote"] = publicQuote.quote_id;
  // 销售端查不到验收报价
  assert.equal((await api.call("GET", `/sales/v1/quotes/${ids["qaQuote"]}`, { token: await salesToken() })).status, 404);
  // 询价日志标成验收的
  assert.equal((await api.db.owner.query("select l.is_acceptance from quotes q join quote_logs l on l.id = q.quote_log_id where q.id = $1", [ids["qaQuote"]])).rows[0].is_acceptance, true);
  ids["cookie"] = cookie;
});

test("下验收单：只能用验收报价、客人邮箱只能是测试地址；建出来的是 QA 测试供应商的验收单，运营后台标「验收」", async () => {
  const cookie = ids["cookie"] as string;
  const crossed = await siteOrder(gated, ids["publicQuote"] as string, { cookie });
  assert.deepEqual([crossed.status, crossed.body.error.details.issues?.[0]?.reason ?? crossed.body.error.code], [400, "UNKNOWN_QUOTE"], crossed.text);
  const noSession = await siteOrder(gated, ids["qaQuote"] as string);
  assert.deepEqual([noSession.status, noSession.body.error.details.issues?.[0]?.reason], [400, "UNKNOWN_QUOTE"], "验收报价不带会话下不了单");
  const realGuest = await siteOrder(gated, ids["qaQuote"] as string, { cookie, email: "someone@gmail.com" });
  assert.deepEqual([realGuest.status, realGuest.body.error.details.issues?.[0]?.reason], [400, "ACCEPTANCE_EMAIL_NOT_ALLOWED"], realGuest.text);
  assertMatchesOpenApi("POST", "/site/v1/orders", realGuest);

  const placed = await siteOrder(gated, ids["qaQuote"] as string, { cookie });
  assert.equal(placed.status, 201, placed.text);
  assertMatchesOpenApi("POST", "/site/v1/orders", placed);
  assert.ok(placed.body.payment.client_secret, "Stripe 测试模式：拿得到付款凭据");
  const orderId = placed.body.order.id as string;
  ids["qaOrder"] = orderId;
  ids["qaLink"] = placed.body.link.token;
  const row = (await api.db.owner.query("select tenant_id, is_acceptance from orders where id = $1", [orderId])).rows[0];
  assert.deepEqual([row.tenant_id, row.is_acceptance], [qa.tenantId, true]);
  // 标记建好之后谁都不能改
  await assert.rejects(api.db.owner.query("update orders set is_acceptance = false where id = $1", [orderId]));

  const detail = await api.call("GET", `/platform/v1/orders/${orderId}`, { token: m.root });
  assertMatchesOpenApi("GET", "/platform/v1/orders/{id}", detail);
  assert.equal(detail.body.order.is_acceptance, true);
  const list = await api.call("GET", "/platform/v1/orders?limit=50", { token: m.root });
  assertMatchesOpenApi("GET", "/platform/v1/orders", list);
  assert.equal(list.body.items.find((item: any) => item.id === orderId)?.is_acceptance, true);

  // 普通客人的单照旧不是验收单
  const normal = await siteOrder(gated, ids["publicQuote"] as string, { email: "normal@example.com" });
  assert.equal(normal.status, 201, normal.text);
  assert.equal((await api.db.owner.query("select is_acceptance from orders where id = $1", [normal.body.order.id])).rows[0].is_acceptance, false);
  ids["normalOrder"] = normal.body.order.id;
});

test("Stripe 不是测试模式：验收单不建、不给付款凭据（409）；没配置 503", async () => {
  const live = new LiveFakePayments();
  const liveSite = await siteApp({ token: true, payments: live });
  const cookie = await unlock(liveSite);
  const quote = await ok(siteQuote(liveSite, cookie));
  const before = (await api.db.owner.query("select count(*)::int as n from orders")).rows[0].n;
  const refused = await siteOrder(liveSite, quote.quotes[0].quote_id, { cookie });
  assert.deepEqual([refused.status, refused.body.error.code], [409, "ACCEPTANCE_REQUIRES_TEST_PAYMENTS"], refused.text);
  assertMatchesOpenApi("POST", "/site/v1/orders", refused);
  assert.equal((await api.db.owner.query("select count(*)::int as n from orders")).rows[0].n, before, "一张单都没建");
  // 已有的验收单接着付款也不行
  const payment = await liveSite.call("GET", "/site/v1/order/payment", { token: ids["qaLink"] as string });
  assert.deepEqual([payment.status, payment.body.error.code], [409, "ACCEPTANCE_REQUIRES_TEST_PAYMENTS"]);
  assertMatchesOpenApi("GET", "/site/v1/order/payment", payment);

  const noStripe = await siteApp({ token: true, payments: null });
  const cookie2 = await unlock(noStripe);
  const quote2 = await ok(siteQuote(noStripe, cookie2));
  const unconfigured = await siteOrder(noStripe, quote2.quotes[0].quote_id, { cookie: cookie2 });
  assert.deepEqual([unconfigured.status, unconfigured.body.error.code], [503, "PAYMENT_NOT_CONFIGURED"]);
  assert.equal((await api.db.owner.query("select count(*)::int as n from orders")).rows[0].n, before);
});

test("邮件：验收单只给 qa-staging@ 真的发；别的收件人（客人、供应商）压下，记成 ACCEPTANCE_SUPPRESSED，内容留存可查", async () => {
  const cookie = ids["cookie"] as string;
  // 第二张验收单：客人邮箱就是验收专用邮箱
  const quote = await ok(siteQuote(gated, cookie));
  const staging = await siteOrder(gated, quote.quotes[0].quote_id, { cookie, email: "QA-Staging@nozomi.moveglobal.io" });
  assert.equal(staging.status, 201, staging.text);
  for (const orderId of [ids["qaOrder"] as string, staging.body.order.id as string]) {
    const intent = pay.intentOf(orderId);
    assert.ok(intent);
    pay.pay(intent.id);
    const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
    assert.equal((await deliverWebhook(gated.app, raw, pay.sign(raw, api.clock.now()))).status, 200);
  }
  gated.sent.length = 0;
  await gated.app.notificationJobs.tick();
  const rows = (await api.db.owner.query("select n.id, n.audience, n.recipient, n.status, n.last_error_code, o.id as order_id from notifications n join orders o on o.id = n.order_id where o.is_acceptance order by n.audience")).rows;
  assert.ok(rows.length >= 4, JSON.stringify(rows));
  // 真的发出去的只有发给 qa-staging@ 的那一封
  assert.deepEqual(gated.sent.map((message) => message.to.toLowerCase()), ["qa-staging@nozomi.moveglobal.io"]);
  for (const row of rows) {
    if (row.recipient.toLowerCase() === "qa-staging@nozomi.moveglobal.io") assert.equal(row.status, "sent");
    else assert.deepEqual([row.status, row.last_error_code], ["expired", "ACCEPTANCE_SUPPRESSED"], `${row.audience} ${row.recipient}`);
  }
  assert.ok(rows.some((row) => row.audience === "tenant" && row.recipient === QA_EMAIL), "供应商的那一封也压下了");
  const suppressed = rows.find((row) => row.audience === "guest" && row.last_error_code === "ACCEPTANCE_SUPPRESSED");
  assert.ok(suppressed);
  const content = await api.call("GET", `/platform/v1/notifications/${suppressed.id}/suppressed-content`, { token: m.root });
  assert.equal(content.status, 200, content.text);
  assertMatchesOpenApi("GET", "/platform/v1/notifications/{id}/suppressed-content", content);
  assert.ok(content.body.subject.length > 0 && content.body.body.includes("/book/order#nzo_"), "正文里有订单链接");
  // 供应商读不到留存的内容（只有平台角色有这张表的权限）
  assert.equal((await api.call("GET", `/platform/v1/notifications/${suppressed.id}/suppressed-content`, { token: qa.adminToken })).status, 401);
  // 正常发出的那一封没有留存内容
  const sentRow = rows.find((row) => row.status === "sent");
  assert.equal((await api.call("GET", `/platform/v1/notifications/${sentRow.id}/suppressed-content`, { token: m.root })).status, 404);
  // 不能重试
  assert.equal((await api.call("POST", `/platform/v1/notifications/${suppressed.id}/retry`, { token: m.root })).status, 409);
  // 日志里只有编号，不写收件人和内容
  const suppressedLog = gated.logs.filter((line) => line.includes("notification.acceptance_suppressed"));
  assert.ok(suppressedLog.length >= 3);
  assert.ok(suppressedLog.every((line) => !line.includes("guest@example.com") && !line.includes(QA_EMAIL)));
  // 已确认的验收单不能救援改派给别的供应商
  const rescue = await api.call("POST", `/platform/v1/orders/${ids["qaOrder"]}/rescue`, { token: m.root, body: { trigger: "tenant_declared", note: "验收单试救援" } });
  assert.deepEqual([rescue.status, rescue.body.error.code], [409, "ACCEPTANCE_ORDER_NOT_RESCUABLE"], rescue.text);
  assertMatchesOpenApi("POST", "/platform/v1/orders/{id}/rescue", rescue);
});

test("验收单不进出账：完成了也不是应付；同时完成的普通单照样是", async () => {
  const qaOrder = ids["qaOrder"] as string;
  await api.db.owner.query("update orders set status = 'completed' where id = $1", [qaOrder]);
  const normal = await seedOrder(api, m, "a", { serviceAt: new Date("2026-10-20T01:00:00Z"), status: "completed" });
  const { tenants, qaItems, aItems } = await withPlatformTx(api.db.pool, async (db) => ({
    tenants: await listTenantsWithBillableItems(db, "2026-12-31"),
    qaItems: await listBillableItems(db, qa.tenantId, "2026-12-31"),
    aItems: await listBillableItems(db, m.a.tenantId, "2026-12-31"),
  }));
  assert.ok(!tenants.includes(qa.tenantId));
  assert.ok(tenants.includes(m.a.tenantId));
  assert.deepEqual(qaItems, []);
  assert.ok(aItems.some((item) => item.orderId === normal.id));
  // 只能取消，不删除：订单还在库里
  assert.equal((await api.db.owner.query("select count(*)::int as n from orders where id = $1", [qaOrder])).rows[0].n, 1);
});

test("生产环境的第二道关：就算配置里有口令，解锁 404、Cookie 不看（按普通客人）", async () => {
  const prod = await siteApp({ token: true, appEnv: "production" });
  const unlockRes = await prod.call("POST", SESSION_PATH, { body: { token: TOKEN } });
  assert.equal(unlockRes.status, 404);
  const cookie = await unlock(gated);
  const quote = biz7(await ok(siteQuote(prod, cookie)));
  assert.equal(quote.price.total.amount, baselineTotal);
  assert.equal((await winnerTenantOf(quote.quote_id)).acceptance, false);
});

test("租户隔离不变：QA 供应商只看得到自己的验收单；别的供应商看不到它", async () => {
  const qaList = await ok(api.call("GET", "/tenant/v1/orders?limit=50", { token: qa.adminToken }));
  assert.ok(qaList.items.length >= 1);
  assert.ok(qaList.items.every((item: any) => item.id !== ids["normalOrder"]));
  assert.equal((await api.call("GET", `/tenant/v1/orders/${ids["qaOrder"]}`, { token: m.a.adminToken })).status, 404);
  assert.equal((await api.call("GET", `/tenant/v1/orders/${ids["normalOrder"]}`, { token: qa.adminToken })).status, 404);
  assert.equal((await api.call("GET", `/tenant/v1/orders/${ids["qaOrder"]}`, { token: qa.adminToken })).status, 200);
});

test("口令不出现在任何应答、日志、审计、库里", async () => {
  const everything = [
    ...sites.flatMap((site) => site.logs),
    ...sites.flatMap((site) => site.responses),
    api.logs(),
    JSON.stringify((await api.db.owner.query("select * from audit_logs")).rows),
    JSON.stringify((await api.db.owner.query("select * from qa_acceptance_sessions")).rows),
    JSON.stringify((await api.db.owner.query("select request from quote_logs")).rows),
  ].join("\n");
  assert.ok(!everything.includes(TOKEN));
  assert.ok(!everything.includes(TOKEN.slice(0, 20)));
});
