/**
 * M8-16：测试环境专用的 QA 测试供应商（ADR 0077），经真实接口、真实 PostgreSQL。
 * - 用 `ensureQaTenant`（`pnpm qa:tenant-ensure` 背后的同一个函数；命令行本身见 cli/qa-tenant-ensure.itest.ts）建出来后：
 *   管理员能登录，能建品牌、区域、商品、价格规则、调价规则，能用试算；
 * - 它永远不能上架、不能开始试运营；就算有代码出错把它的商品直接写成「已上架」，官网（城市、机场、询价）、
 *   销售端询价、平台比价里也都没有它；数据库拒绝把它改成试运营、正式、暂停；
 * - 租户隔离不变：它读不到、改不了别的供应商，别的供应商也读不到它的。
 * 测试数据只在这里构造，结束时连同 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type ApiResponse, type HttpMethod, type TenantFixture, type TestApi, createTestApi } from "./testing/api.ts";
import { DROPOFF, type Market, SERVICE_TIME, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";
import { QUOTE_CATALOG_TTL_MS } from "./services/quote-catalog.ts";
import { QA_TENANT_NAME, ensureQaTenant } from "./services/qa-tenant.ts";

const QA_EMAIL = "qa-admin@example.com";
const QA_PASSWORD = "Qa-Staging-Only-Passw0rd-7";

let api: TestApi;
let m: Market;
let site: SiteApi;
let salesToken: string;
let qa: TenantFixture;
const ids: Record<string, string> = {};

type Box = [number, number, number, number];
const square = ([west, south, east, north]: Box): unknown => ({ type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] });

function tenantCall(who: TenantFixture, method: HttpMethod, path: string, options: { body?: unknown; version?: number } = {}): Promise<ApiResponse> {
  api.clock.advance(1_000);
  return api.call(method, `/tenant/v1${path}`, {
    token: who.adminToken,
    ...(options.body === undefined ? {} : { body: options.body }),
    headers: { ...(options.version === undefined ? {} : { "if-match": `"${options.version}"` }), ...(method === "POST" && /^\/(products|brands|areas)$|\/price-rules$|\/adjust-rules$/.test(path) ? { "idempotency-key": randomUUID() } : {}) },
  });
}
const version = async (who: TenantFixture, productId: string): Promise<number> => (await ok(tenantCall(who, "GET", `/products/${productId}`))).version;

/** QA 供应商自己经接口建一个接送机商品：品牌、区域、商品、服务规则、详情、一口价（商务 7 座）、一条调价规则。不上架。 */
async function qaTransfer(cityId: string, placeId: string, box: Box, price: number): Promise<{ productId: string; areaId: string }> {
  const brand = (await ok(tenantCall(qa, "POST", "/brands", { body: { name: `QA-${randomUUID().slice(0, 6)}`, currency: "JPY" } }), 201)).id;
  const areaId = (await ok(tenantCall(qa, "POST", "/areas", { body: { city_id: cityId, name: { zh: "QA 区域" }, biz_type: "general", polygons: [{ kind: "operate", geometry: square(box) }] } }), 201)).id;
  const created = await ok(
    tenantCall(qa, "POST", "/products", {
      body: { brand_id: brand, city_id: cityId, category: "airport_transfer", poi_id: placeId, areas: [{ area_id: areaId }], vehicle_groups: [{ vehicle_group_id: m.ids.biz7, passengers: 6, luggage: 4 }], dispatchers: [{ name: "调度", phone: "0312345678" }] },
    }),
    201,
  );
  const rules = await ok(tenantCall(qa, "PUT", `/products/${created.id}/service-rules`, { version: 1, body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { pickup: { mode: "limited", minutes: 90 }, dropoff: { mode: "limited", minutes: 15 } } } }));
  await ok(tenantCall(qa, "PUT", `/products/${created.id}/content`, { version: rules.version, body: { zh: { title: "QA 接送", pickup_guide: "到达大厅" } } }));
  await ok(tenantCall(qa, "POST", `/products/${created.id}/price-rules`, { version: await version(qa, created.id), body: { area_id: areaId, vehicle_group_id: m.ids.biz7, direction: "both", pricing_model: "fixed", valid_from: "2026-01-01", base_price: price } }), 201);
  await ok(tenantCall(qa, "POST", `/products/${created.id}/adjust-rules`, { version: await version(qa, created.id), body: { name: "QA 旺季", travel_from: "2026-12-20", travel_to: "2026-12-31", cycle: { type: "daily" }, vehicle_group_ids: [m.ids.biz7], steps: [{ type: "percent", value: 1_000 }] } }), 201);
  return { productId: created.id, areaId };
}

const siteQuote = (cityId: string, airportId: string, address: { lng: number; lat: number }): Promise<ApiResponse> =>
  site.call("POST", "/site/v1/quotes", { body: { city_id: cityId, airport_id: airportId, direction: "pickup", address, service_local: "2026-10-20T10:00", passengers: 2, luggage: 1 } });
const salesQuote = (cityId: string, placeId: string, dropoff: { lng: number; lat: number }): Promise<ApiResponse> =>
  api.call("POST", "/sales/v1/quotes", { token: salesToken, body: { city_id: cityId, category: "airport_transfer", place_id: placeId, direction: "pickup", dropoff, service_time: SERVICE_TIME, passengers: 2, luggage: 1, currency: "JPY", vehicle_group_ids: [m.ids.biz7] } });
const biz7Total = (res: ApiResponse): string | undefined => res.body.quotes.find((quote: any) => quote.vehicle_group.id === m.ids.biz7)?.price.total.amount;
const salesTotals = (res: ApiResponse): unknown[] => res.body.quotes.map((quote: any) => quote.price?.total ?? quote.total ?? quote);

/** 官网和销售端看到的全部（城市、两个城市的机场、东京询价、大阪询价）。 */
async function catalogSnapshot(): Promise<Record<string, unknown>> {
  api.clock.advance(QUOTE_CATALOG_TTL_MS + 1);
  const cities = await site.call("GET", "/site/v1/cities");
  assertMatchesOpenApi("GET", "/site/v1/cities", cities);
  const tokyoAirports = await site.call("GET", `/site/v1/cities/${m.ids.tokyo}/airports`);
  const osakaAirports = await site.call("GET", `/site/v1/cities/${m.ids.osaka}/airports`);
  const tokyoSite = await siteQuote(m.ids.tokyo, m.ids.narita, DROPOFF);
  assert.equal(tokyoSite.status, 200, tokyoSite.text);
  const osakaSite = await siteQuote(m.ids.osaka, ids["kansai"] as string, { lng: 135.5, lat: 34.7 });
  const tokyoSales = await salesQuote(m.ids.tokyo, m.ids.narita, DROPOFF);
  assert.equal(tokyoSales.status, 200, tokyoSales.text);
  const osakaSales = await salesQuote(m.ids.osaka, ids["kansai"] as string, { lng: 135.5, lat: 34.7 });
  return {
    cities: cities.body.items.map((city: any) => city.code),
    tokyoAirports: tokyoAirports.body.items.map((airport: any) => airport.code),
    osakaAirports: osakaAirports.body.items.map((airport: any) => airport.code),
    tokyoSite: biz7Total(tokyoSite),
    osakaSite: [osakaSite.status, osakaSite.body.quotes?.length ?? osakaSite.body.error?.code],
    tokyoSales: salesTotals(tokyoSales),
    osakaSales: [osakaSales.status, osakaSales.body.quotes?.length ?? osakaSales.body.error?.code],
  };
}

let baseline: Record<string, unknown>;

before(async () => {
  const pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  const siteChannel = (await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" })).id;
  site = await siteApi(api, (await salesCredentials(api, m, siteChannel)).clientId, pay);
  const salesChannel = (await newChannel(api, m.staff.cm1.token, { name: "OTA" })).id;
  salesToken = (await salesCredentials(api, m, salesChannel, "198.51.100.20")).token;
  ids["kansai"] = (await ok(api.call("POST", "/platform/v1/master/places", { token: m.root, body: { location: { lng: 135.24, lat: 34.43 }, type: "airport", code: "KIX", city_id: m.ids.osaka, name: { zh: "关西机场" }, flight_scope: "international" } }), 201)).id;
  baseline = await catalogSnapshot();

  const outcome = await ensureQaTenant(api.db.pool, { email: QA_EMAIL, name: "QA 验收管理员", password: QA_PASSWORD, resetPassword: false }, api.clock.now());
  assert.equal(outcome.kind, "created");
  const login = await ok(api.call("POST", "/tenant/v1/auth/login", { body: { email: QA_EMAIL, password: QA_PASSWORD } }));
  qa = { tenantId: outcome.tenant.id, adminId: outcome.admin.id, adminEmail: QA_EMAIL, adminToken: login.access_token };
});
after(async () => {
  await site?.close();
  await api.close();
});

test("基线：官网只列东京和成田，商务 7 座 21,780（乙 19,800 × 1.1）；大阪没有可卖的商品", () => {
  assert.deepEqual(baseline["cities"], ["CTY-JP-TYO"]);
  assert.deepEqual(baseline["tokyoAirports"], ["NRT"]);
  assert.deepEqual(baseline["osakaAirports"], []);
  assert.equal(baseline["tokyoSite"], "21780");
});

test("QA 供应商的管理员能登录：申请中、带 is_test_tenant；运营后台的供应商列表也标出它是测试供应商，别的不是", async () => {
  const me = await ok(api.call("GET", "/tenant/v1/auth/me", { token: qa.adminToken }));
  assert.deepEqual([me.tenant.name, me.tenant.status, me.tenant.is_test_tenant, me.user.role], [QA_TENANT_NAME, "applying", true, "admin"]);
  const list = await api.call("GET", "/platform/v1/tenants?limit=100", { token: m.root });
  assertMatchesOpenApi("GET", "/platform/v1/tenants", list);
  assert.deepEqual(
    list.body.items.map((tenant: any) => [tenant.name, tenant.is_test_tenant]).sort(),
    [["QA 测试供应商（验收专用）", true], ["乙车队", false], ["甲车队", false]].sort(),
  );
});

test("QA 供应商能建区域、商品、价格规则、调价规则，能对自己的商品试算；但商品不能上架", async () => {
  const tokyo = await qaTransfer(m.ids.tokyo, m.ids.narita, [139.0, 35.0, 140.0, 36.0], 5_000);
  const osaka = await qaTransfer(m.ids.osaka, ids["kansai"] as string, [135.0, 34.0, 136.0, 35.0], 6_000);
  ids["qaTokyo"] = tokyo.productId;
  ids["qaOsaka"] = osaka.productId;
  const rules = await ok(tenantCall(qa, "GET", `/products/${tokyo.productId}/price-rules`));
  assert.equal(rules.items.length, 1);

  const preview = await ok(tenantCall(qa, "POST", `/products/${tokyo.productId}/quote-preview`, { body: { direction: "pickup", dropoff: DROPOFF, service_time: "2026-10-20T10:00", passengers: 2, luggage: 1 } }));
  assert.equal(preview.offers[0]?.settlement.total, 5_000, JSON.stringify(preview));

  for (const productId of [tokyo.productId, osaka.productId]) {
    const published = await tenantCall(qa, "POST", `/products/${productId}/publish`);
    assert.deepEqual([published.status, published.body.error.code], [409, "TENANT_NOT_ONBOARDED"]);
  }
  const statuses = await api.db.owner.query("select status from products where tenant_id = $1", [qa.tenantId]);
  assert.deepEqual(statuses.rows.map((row) => row.status), ["draft", "draft"]);
});

test("就算有代码出错把它的商品直接写成「已上架」：官网城市、机场、询价，销售端询价都和没有它时一样；平台比价里它被拒（没完成入驻）", async () => {
  await api.db.owner.query("update products set status = 'published', published_at = $2 where tenant_id = $1", [qa.tenantId, api.clock.now()]);
  try {
    assert.deepEqual(await catalogSnapshot(), baseline);
    const preview = await ok(api.call("POST", "/platform/v1/quotes/preview", { token: m.root, body: { city_id: m.ids.tokyo, category: "airport_transfer", place_id: m.ids.narita, currency: "JPY", direction: "pickup", dropoff: DROPOFF, service_time: "2026-10-20T10:00", passengers: 2, luggage: 1, vehicle_group_ids: [m.ids.biz7] } }));
    assert.deepEqual(preview.refused.filter((entry: any) => entry.tenant_id === qa.tenantId).map((entry: any) => entry.reason), ["TENANT_NOT_ONBOARDED"]);
  } finally {
    await api.db.owner.query("update products set status = 'draft', published_at = null where tenant_id = $1", [qa.tenantId]);
  }
});

test("它永远进不了试运营：运营点「开始试运营」409 TEST_TENANT_NOT_FOR_SALE；直接改库成试运营、正式、暂停，数据库拒绝", async () => {
  await api.db.owner.query("update tenants set status = 'signed', signed_at = $2 where id = $1", [qa.tenantId, api.clock.now()]);
  try {
    const started = await api.call("POST", `/platform/v1/tenants/${qa.tenantId}/start-trial`, { token: m.root, body: { test_order_note: "想让 QA 供应商上架" } });
    assert.deepEqual([started.status, started.body.error.code], [409, "TEST_TENANT_NOT_FOR_SALE"], started.text);
    assertMatchesOpenApi("POST", "/platform/v1/tenants/{id}/start-trial", started);
  } finally {
    await api.db.owner.query("update tenants set status = 'applying', signed_at = null where id = $1", [qa.tenantId]);
  }
  const now = api.clock.now();
  for (const sql of [
    ["update tenants set status = 'trial', trial_started_at = $2 where id = $1", [qa.tenantId, now]],
    ["update tenants set status = 'active', activated_at = $2 where id = $1", [qa.tenantId, now]],
    ["update tenants set status = 'suspended', suspended_from = 'active', suspension_reasons = '{manual}', suspended_at = $2 where id = $1", [qa.tenantId, now]],
  ] as const) {
    await assert.rejects(api.db.owner.query(sql[0], [...sql[1]]), (err: any) => err.code === "23514" && err.constraint === "tenants_test_tenant_never_sells");
  }
  // 全平台最多一家：再插一家测试供应商被唯一索引拒绝
  await assert.rejects(api.db.owner.query("insert into tenants (name, status, is_test_tenant, created_at, updated_at) values ('另一家 QA 测试', 'applying', true, $1, $1)", [now]), (err: any) => err.code === "23505");
  const row = (await api.db.owner.query("select status from tenants where id = $1", [qa.tenantId])).rows[0];
  assert.equal(row.status, "applying");
});

test("租户隔离不变：QA 供应商读不到、改不了甲的商品；甲读不到、改不了 QA 的商品；各自的列表里没有对方", async () => {
  const qaProduct = ids["qaTokyo"] as string;
  const a = m.a;
  assert.equal((await tenantCall(qa, "GET", `/products/${m.ids.pa}`)).status, 404);
  assert.equal((await tenantCall(qa, "PUT", `/products/${m.ids.pa}/content`, { version: 1, body: { zh: { title: "改别人的" } } })).status, 404);
  assert.equal((await tenantCall(a, "GET", `/products/${qaProduct}`)).status, 404);
  assert.equal((await tenantCall(a, "PUT", `/products/${qaProduct}/content`, { version: 1, body: { zh: { title: "改 QA 的" } } })).status, 404);
  const qaList = await ok(tenantCall(qa, "GET", "/products"));
  assert.deepEqual(new Set(qaList.items.map((item: any) => item.id)), new Set([ids["qaTokyo"], ids["qaOsaka"]]));
  const aList = await ok(tenantCall(a, "GET", "/products"));
  assert.ok(aList.items.every((item: any) => item.id !== ids["qaTokyo"] && item.id !== ids["qaOsaka"]));
  // 查询参数、请求头里写别的租户编号都不管用：tenant_id 只来自令牌
  const spoofed = await api.call("GET", `/tenant/v1/products?tenant_id=${a.tenantId}`, { token: qa.adminToken, headers: { "x-tenant-id": a.tenantId } });
  assert.ok(spoofed.status === 400 || spoofed.body.items.every((item: any) => item.id !== m.ids.pa), spoofed.text);
  // QA 的密码不在服务日志和审计里
  assert.ok(!api.logs().includes(QA_PASSWORD));
  assert.ok(!JSON.stringify((await api.db.owner.query("select before, after from audit_logs")).rows).includes(QA_PASSWORD));
});
