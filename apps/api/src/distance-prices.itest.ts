/**
 * M8-30：计程价和报价优先级（ADR 0080），经真实接口、真实 PostgreSQL；路线预估、收款服务用替身。
 * - 计程价接口：新增（幂等、If-Match）、冲突、校验、只有接送机 / 点对点能设、启停、修改、删除、审计；只有结算价（规则 4）；
 * - 报价：两端都在报价区域里 → 一口价，和没设计程价时逐分一样；只有一端在 → 一口价 + 区域外里程费；都不在 → 计程价；
 *   有一端不在运营区域里 → 不报；拿不到路线 → 情形 2、3 不报；官网报价、订单带计价方式；
 * - 只读回放（`areas:role-preview` 的 M8-30 部分）：之前报得出的价 0 处变化，新报出的按计价方式列出。
 * 租户隔离见 tenant-isolation.itest.ts。测试数据全在本文件里经接口建出来，随测试 schema 一起删除（规则 1）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { RouteEstimate } from "@nozomi/domain";
import { withPlatformTx } from "./db/context.ts";
import { buildRolePreview } from "./services/area-role-preview.ts";
import type { ApiResponse, HttpMethod, TenantFixture, TestApi } from "./testing/api.ts";
import { createTestApi } from "./testing/api.ts";
import { type Market, allKeys, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi, assertMatchesOperation } from "./testing/openapi.ts";
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";
import { QUOTE_CATALOG_TTL_MS } from "./services/quote-catalog.ts";
import { routeLookup } from "./testing/routes.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let site: SiteApi;
let route: RouteEstimate | null = { meters: 34_200, minutes: 50 };
let productId: string;
let charterId: string;

const square = (west: number, south: number, east: number, north: number) => ({ type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] });
const P = {
  city: { lng: 139.7, lat: 35.7 },
  city2: { lng: 139.6, lat: 35.6 },
  suburb: { lng: 140.0, lat: 35.7 },
  suburb2: { lng: 140.1, lat: 35.8 },
  far: { lng: 141.5, lat: 35.7 },
};
const SERVICE_LOCAL = "2026-10-20T10:00";
const RULE4_KEYS = ["sell", "sell_minor", "markup", "markup_bp", "fx_buffer_bp", "channel"];
let ipSeq = 0;
const nextIp = (): string => `10.93.${(ipSeq += 1)}.9`;

async function tenantCall(who: TenantFixture, method: HttpMethod, path: string, options: { body?: unknown; version?: number; key?: string } = {}): Promise<ApiResponse> {
  const token = await tenantLogin(api, who.adminEmail);
  api.clock.advance(1_000);
  return api.call(method, `/tenant/v1${path}`, {
    token,
    ...(options.body === undefined ? {} : { body: options.body }),
    headers: { ...(options.version === undefined ? {} : { "if-match": `"${options.version}"` }), ...(method === "POST" && /^\/(products|brands|areas)$|\/(price-rules|distance-prices)(\/batch)?$/.test(path) ? { "idempotency-key": options.key ?? randomUUID() } : {}) },
  });
}
const version = async (id: string): Promise<number> => (await ok(tenantCall(m.b, "GET", `/products/${id}`))).version;
const newArea = async (name: string, polygon: ReturnType<typeof square>, role: string): Promise<string> =>
  (await ok(tenantCall(m.b, "POST", "/areas", { body: { city_id: m.ids.tokyo, name: { zh: name }, biz_type: "general", role, polygons: [{ kind: "operate", geometry: polygon }] } }), 201)).id;

async function product(category: "point_to_point" | "charter", areaId: string): Promise<string> {
  const brand = (await ok(tenantCall(m.b, "POST", "/brands", { body: { name: `计程-${randomUUID().slice(0, 6)}`, currency: "JPY" } }), 201)).id;
  const created = await ok(
    tenantCall(m.b, "POST", "/products", {
      body: { brand_id: brand, city_id: m.ids.tokyo, category, areas: [{ area_id: areaId }], vehicle_groups: [{ vehicle_group_id: m.ids.biz7, passengers: 6, luggage: 4 }, { vehicle_group_id: m.ids.eco4, passengers: 3, luggage: 2 }], dispatchers: [{ name: "调度", phone: "0312345678" }] },
    }),
    201,
  );
  if (category === "charter") return created.id;
  const rules = await ok(tenantCall(m.b, "PUT", `/products/${created.id}/service-rules`, { version: 1, body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { general: { mode: "limited", minutes: 15 } } } }));
  const content = await ok(tenantCall(m.b, "PUT", `/products/${created.id}/content`, { version: rules.version, body: { zh: { title: "市内用车" } } }));
  const create = [m.ids.biz7, m.ids.eco4].map((vehicleGroupId) => ({ area_id: areaId, vehicle_group_id: vehicleGroupId, pricing_model: "fixed", base_price: 10_000, valid_from: "2026-01-01" }));
  await ok(tenantCall(m.b, "POST", `/products/${created.id}/price-rules/batch`, { version: content.version, body: { create } }));
  await ok(tenantCall(m.b, "POST", `/products/${created.id}/publish`));
  return created.id;
}

const siteQuote = (pickup: keyof typeof P, dropoff: keyof typeof P): Promise<ApiResponse> =>
  site.call("POST", "/site/v1/quotes", { body: { category: "point_to_point", city_id: m.ids.tokyo, pickup: P[pickup], dropoff: P[dropoff], service_local: SERVICE_LOCAL, passengers: 2, luggage: 1 }, ip: nextIp() });

/** 官网上这一程的商务 7 座报价（只有乙这一个点对点商品）；没有为 undefined */
async function bizQuote(pickup: keyof typeof P, dropoff: keyof typeof P): Promise<any> {
  const res = await siteQuote(pickup, dropoff);
  assertMatchesOpenApi("POST", "/site/v1/quotes", res);
  assert.equal(res.status, 200, res.text);
  return res.body.quotes.find((quote: any) => quote.vehicle_group.id === m.ids.biz7);
}

async function preview(pickup: keyof typeof P, dropoff: keyof typeof P): Promise<any> {
  const res = await tenantCall(m.b, "POST", `/products/${productId}/quote-preview`, { body: { pickup: P[pickup], dropoff: P[dropoff], service_time: SERVICE_LOCAL, passengers: 2, luggage: 1 } });
  assertMatchesOpenApi("POST", "/tenant/v1/products/{id}/quote-preview", res);
  assert.equal(res.status, 200, res.text);
  for (const key of RULE4_KEYS) assert.ok(!allKeys(res.body).has(key), `供应商试算里有 ${key}`);
  return res.body;
}

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay, quote: { routes: { estimate: async () => routeLookup(route) } } });
  m = await buildMarket(api);
  const city = await newArea("市区", square(139.5, 35.5, 139.8, 35.9), "pricing");
  await newArea("关东运营范围", square(139.0, 35.0, 141.0, 36.5), "operating");
  productId = await product("point_to_point", city);
  charterId = await product("charter", city);
  const channel = await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" });
  site = await siteApi(api, (await salesCredentials(api, m, channel.id)).clientId, pay, {}, { quote: { routes: { estimate: async () => routeLookup(route) } } });
});
after(async () => {
  await site?.close();
  await api.close();
});

let oneEndBefore: unknown;
let insideBefore: any;

test("没设计程价：只有一端 / 两端都不在报价区域里照旧报不出（转人工）；两端都在的一口价记下来，后面对比", async () => {
  oneEndBefore = await bizQuote("city", "suburb");
  assert.equal(oneEndBefore, undefined);
  assert.equal(await bizQuote("suburb", "suburb2"), undefined);
  insideBefore = await bizQuote("city", "city2");
  assert.equal(insideBefore.pricing_basis, "one_price");
});

test("计程价接口：新增（幂等、If-Match）、校验、冲突、包车不能设、启停、修改、删除、审计；只有结算价（规则 4）", async () => {
  const list = await tenantCall(m.b, "GET", `/products/${productId}/distance-prices`);
  assertMatchesOpenApi("GET", "/tenant/v1/products/{id}/distance-prices", list);
  assert.deepEqual([list.body.items, list.body.currency], [[], "JPY"]);
  const body = { vehicle_group_id: m.ids.biz7, start_price: 3_000, per_km: 300, valid_from: "2026-01-01" };
  assert.equal((await tenantCall(m.b, "POST", `/products/${productId}/distance-prices`, { body })).status, 428);
  const key = randomUUID();
  const created = await tenantCall(m.b, "POST", `/products/${productId}/distance-prices`, { body, version: await version(productId), key });
  assertMatchesOpenApi("POST", "/tenant/v1/products/{id}/distance-prices", created);
  assert.equal(created.status, 201, created.text);
  for (const name of RULE4_KEYS) assert.ok(!allKeys(created.body).has(name), name);
  const again = await tenantCall(m.b, "POST", `/products/${productId}/distance-prices`, { body, version: created.body.version - 1, key });
  assert.deepEqual([again.status, again.body], [201, created.body], "同一个幂等键：原样返回");
  const id = created.body.distance_price.id as string;

  const conflict = await tenantCall(m.b, "POST", `/products/${productId}/distance-prices`, { body: { ...body, valid_from: "2026-06-01" }, version: await version(productId) });
  assert.deepEqual([conflict.status, conflict.body.error.code, conflict.body.error.details.conflicts.map((entry: any) => entry.id)], [409, "DISTANCE_PRICE_CONFLICT", [id]]);
  const invalid = await tenantCall(m.b, "POST", `/products/${productId}/distance-prices`, { body: { ...body, vehicle_group_id: randomUUID(), start_price: 0, per_km: 0.5, valid_from: "2026-13-01" }, version: await version(productId) });
  assert.equal(invalid.status, 400, invalid.text);
  assert.deepEqual(invalid.body.error.details.issues.map((issue: any) => [issue.path, issue.reason]), [["/per_km", "NOT_INTEGER"], ["/valid_from", "INVALID_DATE"], ["/vehicle_group_id", "VEHICLE_GROUP_NOT_IN_PRODUCT"]]);
  const charter = await tenantCall(m.b, "POST", `/products/${charterId}/distance-prices`, { body, version: await version(charterId) });
  assert.deepEqual([charter.status, charter.body.error.code], [400, "DISTANCE_PRICE_NOT_ALLOWED"]);

  const off = await tenantCall(m.b, "POST", `/products/${productId}/distance-prices/${id}/disable`);
  assertMatchesOpenApi("POST", "/tenant/v1/products/{id}/distance-prices/{ruleId}/disable", off);
  assert.equal(off.body.distance_price.status, "disabled");
  const on = await ok(tenantCall(m.b, "POST", `/products/${productId}/distance-prices/${id}/enable`));
  const changed = await tenantCall(m.b, "PUT", `/products/${productId}/distance-prices/${id}`, { body: { ...body, start_price: 3_500 }, version: on.version });
  assertMatchesOpenApi("PUT", "/tenant/v1/products/{id}/distance-prices/{ruleId}", changed);
  assert.equal(changed.body.distance_price.start_price, 3_500);
  // eco4 另建一条再删掉
  const eco = await ok(tenantCall(m.b, "POST", `/products/${productId}/distance-prices`, { body: { ...body, vehicle_group_id: m.ids.eco4 }, version: changed.body.version }), 201);
  const removed = await tenantCall(m.b, "DELETE", `/products/${productId}/distance-prices/${eco.distance_price.id}`, { version: eco.version });
  assertMatchesOpenApi("DELETE", "/tenant/v1/products/{id}/distance-prices/{ruleId}", removed);
  assert.equal((await tenantCall(m.b, "DELETE", `/products/${productId}/distance-prices/${eco.distance_price.id}`, { version: removed.body.version })).status, 404);
  // 改回 3,000（下面报价用）
  await ok(tenantCall(m.b, "PUT", `/products/${productId}/distance-prices/${id}`, { body, version: removed.body.version }));
  const logs = await api.db.owner.query("select action from audit_logs where resource = 'distance_price' and resource_id = $1 order by id", [id]);
  assert.deepEqual(logs.rows.map((row) => row.action), ["create", "disable", "enable", "update", "update"]);
});

test("报价：两端都在报价区域里逐分不变；只有一端在 → 一口价 + 区域外里程费；都不在 → 计程价；官网标计价方式，没有计程价的车型组不报", async () => {
  // 报价用的商品目录缓存 30 秒（ADR 0020）：过了这段时间新设的计程价才生效
  api.clock.advance(31_000);
  const inside = await bizQuote("city", "city2");
  assert.deepEqual(inside, { ...insideBefore, quote_id: inside.quote_id, expires_at: inside.expires_at }, "一口价：除了新的报价编号和有效期，一个字都不差");

  // 供应商试算（结算价）：10,000 + ⌈34.2⌉ = 35 公里 × 300 = 20,500
  const oneEnd = await preview("city", "suburb");
  const s2 = oneEnd.offers[0].settlement;
  assert.deepEqual([oneEnd.offers.length, s2.pricing_basis, s2.total, s2.mileage.km, s2.mileage.fee, s2.mileage.start_price], [1, "one_price_outside_km", 20_500, 35, 10_500, 0]);
  assert.deepEqual(oneEnd.refused, [{ vehicle_group_id: m.ids.eco4, reason: "NO_PRICE_RULE", message: oneEnd.refused[0].message }]);
  // 3,000 + 35 × 300 = 13,500；没有区域
  const neither = await preview("suburb", "suburb2");
  const s3 = neither.offers[0].settlement;
  assert.deepEqual([neither.offers[0].area_id, s3.pricing_basis, s3.total, s3.mileage.km, s3.mileage.start_price], [null, "distance_only", 13_500, 35, 3_000]);

  const siteOneEnd = await bizQuote("city", "suburb");
  const siteNeither = await bizQuote("suburb", "suburb2");
  assert.deepEqual([siteOneEnd.pricing_basis, siteNeither.pricing_basis], ["one_price_outside_km", "distance_only"]);
  assert.ok(siteOneEnd.price.total.amount > insideBefore.price.total.amount, "含里程费的比纯一口价贵");
  for (const quote of [siteOneEnd, siteNeither]) for (const name of [...RULE4_KEYS, "mileage", "per_km"]) assert.ok(!allKeys(quote).has(name), name);
});

test("运营区域是上限：有一端不在运营范围里不报；拿不到路线时情形 2、3 不报，一口价照常", async () => {
  assert.equal(await bizQuote("city", "far"), undefined);
  assert.equal(await bizQuote("far", "suburb"), undefined);
  route = null;
  try {
    assert.equal(await bizQuote("city", "suburb"), undefined);
    assert.equal(await bizQuote("suburb", "suburb2"), undefined);
    assert.equal((await bizQuote("city", "city2")).pricing_basis, "one_price");
  } finally {
    route = { meters: 34_200, minutes: 50 };
  }
});

test("下单：订单锁定计价方式（官网订单页给 pricing_basis；付款后供应商、运营订单详情给计价方式和计程明细，旧单为一口价 / null）", async () => {
  const quote = await bizQuote("suburb", "suburb2");
  const created = await site.call("POST", "/site/v1/orders", { headers: { "idempotency-key": randomUUID() }, body: { quote_id: quote.quote_id, passenger: { name: "林小青", phone: "+81 90-3333-4444", email: "distance.guest@example.com" }, save_payment_method: true, pickup_address: "郊区酒店", dropoff_address: "郊区车站" }, ip: nextIp() });
  assert.equal(created.status, 201, created.text);
  const guest = await site.call("GET", "/site/v1/order", { token: created.body.link.token, ip: nextIp() });
  assertMatchesOpenApi("GET", "/site/v1/order", guest);
  assert.equal(guest.body.order.pricing_basis, "distance_only");

  // 付款后：供应商、运营订单详情给出订单上锁定的计价方式和计程明细（M8-30c）；供应商只有结算价（规则 4）
  const orderId = created.body.order.id as string;
  const intent = pay.intentOf(orderId);
  assert.ok(intent);
  pay.pay(intent.id);
  const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
  assert.equal((await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()))).status, 200);
  const mileage = { route_meters: 34_200, included_km: 0, km: 35, start_price: { amount: "3000", currency: "JPY" }, per_km: { amount: "300", currency: "JPY" }, fee: { amount: "13500", currency: "JPY" } };
  const tenant = await tenantCall(m.b, "GET", `/orders/${orderId}`);
  assertMatchesOpenApi("GET", "/tenant/v1/orders/{id}", tenant);
  assert.deepEqual([tenant.body.pricing_basis, tenant.body.mileage], ["distance_only", mileage]);
  for (const key of RULE4_KEYS) assert.ok(!allKeys(tenant.body).has(key), `供应商订单详情里有 ${key}`);
  const platform = await api.call("GET", `/platform/v1/orders/${orderId}`, { token: m.root });
  assertMatchesOperation("GET", "/platform/v1/orders/{id}", platform.status, platform.body);
  assert.deepEqual([platform.body.pricing_basis, platform.body.mileage], ["distance_only", mileage]);
  // 甲读不到乙的单（租户隔离）
  const foreign = await tenantCall(m.a, "GET", `/orders/${orderId}`);
  assert.equal(foreign.status, 404);
  assert.ok(!foreign.text.includes("distance_only"));
  // M8-30 之前的单：一口价、计程明细为 null
  await api.db.owner.query("update orders set settlement = settlement - 'pricingBasis' - 'mileage' where id = $1", [orderId]);
  const legacy = await tenantCall(m.b, "GET", `/orders/${orderId}`);
  assertMatchesOpenApi("GET", "/tenant/v1/orders/{id}", legacy);
  const legacyPlatform = await api.call("GET", `/platform/v1/orders/${orderId}`, { token: m.root });
  assert.deepEqual([legacy.body.pricing_basis, legacy.body.mileage, legacyPlatform.body.pricing_basis, legacyPlatform.body.mileage], ["one_price", null, "one_price", null]);
});

test("只读回放（M8-30 部分）：最近 30 天的询价按 M8-30 之前的口径和现在各算一遍——之前报得出的价 0 处变化；新报出的按计价方式列出", async () => {
  const preview30 = await withPlatformTx(api.db.pool, (db) => buildRolePreview(db, { days: 30, now: api.clock.now() }), { snapshot: true });
  const { priority } = preview30.replay;
  assert.equal(priority.changedCount, 0, JSON.stringify(priority.changed));
  assert.ok(priority.keptOffers > 0);
  assert.ok((priority.newOffers["one_price_outside_km"] ?? 0) > 0 && (priority.newOffers["distance_only"] ?? 0) > 0, JSON.stringify(priority.newOffers));
  assert.equal(preview30.replay.externalDiffCount, 0);
});

// 放在最后：这里给乙另建了一个商品，不影响前面的用例
test("一口价 + 区域外里程：只有一端在报价区域里时往返对称——两个方向都报，金额按在区域里那一端所在区域的一口价算（M8-41）", async () => {
  // 乙另建一个点对点商品：两个报价区域（西区 8,000、东区 12,000）、只有经济 4 座，计程价起步 3,000、每公里 200。
  // 原来那个商品的经济 4 座只在「市区」有一口价、没有计程价，下面这几程它报不出，官网上的经济 4 座只会来自这个商品。
  const west = await newArea("西区", square(139.0, 35.0, 139.3, 35.3), "pricing");
  const east = await newArea("东区", square(140.3, 35.0, 140.6, 35.3), "pricing");
  const brand = (await ok(tenantCall(m.b, "POST", "/brands", { body: { name: `对称-${randomUUID().slice(0, 6)}`, currency: "JPY" } }), 201)).id;
  const created = await ok(
    tenantCall(m.b, "POST", "/products", {
      body: { brand_id: brand, city_id: m.ids.tokyo, category: "point_to_point", areas: [{ area_id: west }, { area_id: east }], vehicle_groups: [{ vehicle_group_id: m.ids.eco4, passengers: 3, luggage: 2 }], dispatchers: [{ name: "调度", phone: "0312345678" }] },
    }),
    201,
  );
  const id = created.id as string;
  const rules = await ok(tenantCall(m.b, "PUT", `/products/${id}/service-rules`, { version: 1, body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { general: { mode: "limited", minutes: 15 } } } }));
  const content = await ok(tenantCall(m.b, "PUT", `/products/${id}/content`, { version: rules.version, body: { zh: { title: "两区用车" } } }));
  const create = [
    { area_id: west, vehicle_group_id: m.ids.eco4, pricing_model: "fixed", base_price: 8_000, valid_from: "2026-01-01" },
    { area_id: east, vehicle_group_id: m.ids.eco4, pricing_model: "fixed", base_price: 12_000, valid_from: "2026-01-01" },
  ];
  await ok(tenantCall(m.b, "POST", `/products/${id}/price-rules/batch`, { version: content.version, body: { create } }));
  await ok(tenantCall(m.b, "POST", `/products/${id}/distance-prices`, { body: { vehicle_group_id: m.ids.eco4, start_price: 3_000, per_km: 200, valid_from: "2026-01-01" }, version: await version(id) }), 201);
  await ok(tenantCall(m.b, "POST", `/products/${id}/publish`));
  // 报价用的商品目录有短时缓存：过了有效期再询价
  api.clock.advance(QUOTE_CATALOG_TTL_MS + 1_000);

  type Point = { lng: number; lat: number };
  const W: Point = { lng: 139.15, lat: 35.15 };
  const E: Point = { lng: 140.45, lat: 35.15 };
  /** 在运营范围里、不在任何报价区域里（也不在「市区」） */
  const OUT: Point = { lng: 139.9, lat: 35.15 };
  const settle = async (pickup: Point, dropoff: Point): Promise<unknown[]> => {
    const res = await tenantCall(m.b, "POST", `/products/${id}/quote-preview`, { body: { pickup, dropoff, service_time: SERVICE_LOCAL, passengers: 2, luggage: 1 } });
    assertMatchesOpenApi("POST", "/tenant/v1/products/{id}/quote-preview", res);
    assert.equal(res.status, 200, res.text);
    for (const key of RULE4_KEYS) assert.ok(!allKeys(res.body).has(key), `供应商试算里有 ${key}`);
    assert.equal(res.body.offers.length, 1, res.text);
    const offer = res.body.offers[0];
    return [offer.area_id, offer.settlement.pricing_basis, offer.settlement.total, offer.settlement.mileage.km, offer.settlement.mileage.fee];
  };
  // 路线 34.2 公里 → 35 公里 × 200 = 7,000；西区 8,000 + 7,000 = 15,000，东区 12,000 + 7,000 = 19,000
  const westGo = await settle(W, OUT);
  assert.deepEqual(westGo, [west, "one_price_outside_km", 15_000, 35, 7_000]);
  assert.deepEqual(await settle(OUT, W), westGo, "西区 ⇄ 区域外：往返一样（区域在下车那一端也按西区的一口价）");
  const eastGo = await settle(E, OUT);
  assert.deepEqual(eastGo, [east, "one_price_outside_km", 19_000, 35, 7_000]);
  assert.deepEqual(await settle(OUT, E), eastGo, "东区 ⇄ 区域外：往返一样，按东区的一口价");

  // 官网（对外价）：两个方向都报，计价方式、金额都一样；西区、东区各按各的
  const ecoQuote = async (pickup: Point, dropoff: Point): Promise<[string, string]> => {
    const res = await site.call("POST", "/site/v1/quotes", { body: { category: "point_to_point", city_id: m.ids.tokyo, pickup, dropoff, service_local: SERVICE_LOCAL, passengers: 2, luggage: 1 }, ip: nextIp() });
    assertMatchesOpenApi("POST", "/site/v1/quotes", res);
    assert.equal(res.status, 200, res.text);
    const quote = res.body.quotes.find((entry: any) => entry.vehicle_group.id === m.ids.eco4);
    assert.ok(quote, res.text);
    return [quote.pricing_basis, quote.price.total.amount];
  };
  const siteWest = await ecoQuote(W, OUT);
  const siteEast = await ecoQuote(E, OUT);
  assert.deepEqual([siteWest[0], siteEast[0]], ["one_price_outside_km", "one_price_outside_km"]);
  assert.deepEqual(await ecoQuote(OUT, W), siteWest, "官网西区 ⇄ 区域外往返一样");
  assert.deepEqual(await ecoQuote(OUT, E), siteEast, "官网东区 ⇄ 区域外往返一样");
  assert.ok(Number(siteEast[1]) > Number(siteWest[1]), "东区的一口价高，含里程费的总价也高");
});
