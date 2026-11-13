/**
 * M9-02：统一订单格式——订单行程和来源（需求 03 第 2.2、2.3 节，ADR 0087 第三节第 3 小节、第四节），经真实接口、真实 PostgreSQL；收款服务用替身。
 * - F1：官网区间单（成田机场 → 东京站）下单后订单行程方式 transfer、地点 2 个、停留为空，来源 book；F2：按时长包车 8 小时 → charter_package、套餐 8 小时、含 150 公里；
 * - F3：M9-02 之前的订单（库里两列为空）、/sales/v1 渠道单：订单行程为 null，应答的其余字段不变；渠道单没有来源字段；
 * - F9：同一个 Idempotency-Key 并发提交两次只有一张单，两次应答相同，订单行程只写一次；订单行程里没有任何金额；
 * - F7：租户 A 的令牌读租户 B 订单的行程 404；F8：/tenant/v1 订单详情、列表和供应商 Webhook 扫全部键：有行程，没有对外金额、加价比例、来源字段；
 * - 运营订单详情给行程和来源；供应商改不了行程和来源（库的触发器兜底），来源建好后谁都不能改。
 * 测试数据全在本文件里经接口建出来，随测试 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TenantFixture } from "./testing/api.ts";
import { TEST_PASSWORD, type TestApi, createTestApi, localWebhookSender } from "./testing/api.ts";
import { type Market, allKeys, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { type FakeReceiver, startFakeReceiver } from "./testing/dispatch.ts";
import { tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let site: SiteApi;
let sales: SalesFlow;
let receiver: FakeReceiver;

const ADDRESS = { lng: 139.7671, lat: 35.6812 };
const PICKUP = { lng: 139.7, lat: 35.6 };
const DROPOFF = { lng: 139.75, lat: 35.68 };
/** 2026-10-20 10:00 东京（测试的时钟从 2026-10-07 开始） */
const SERVICE_LOCAL = "2026-10-20T10:00";
const PASSENGER = { name: "王小明", phone: "+81 90-1234-5678", email: "itinerary.guest@example.com" };
/** 规则 4 和来源：供应商看到的内容里不能有的键 */
const FORBIDDEN_TENANT_KEYS = ["sell", "sell_minor", "markup", "markup_bp", "price", "fx", "fx_buffer_bp", "channel", "channel_order_no", "quote_id", "route_estimate", "post_service_rates", "estimate_amount", "entry_source", "embed_origin", "embed_key_id", "route_template_id", "return_url"];
let ipSeq = 0;
const nextIp = (): string => {
  ipSeq += 1;
  return `10.92.${ipSeq}.7`;
};

/** 给乙建一个东京的包车商品（区域盖住整个东京，商务 7 座）：8 小时套餐 70,000、含 150 公里，再上架。 */
async function charterProduct(who: TenantFixture): Promise<void> {
  const token = await tenantLogin(api, who.adminEmail);
  const call = (method: "POST" | "PUT" | "GET", path: string, body?: unknown, version?: number, status = 200): Promise<any> =>
    ok(
      api.call(method, `/tenant/v1${path}`, {
        token,
        ...(body === undefined ? {} : { body }),
        headers: { ...(version === undefined ? {} : { "if-match": `"${version}"` }), ...(method === "POST" && /^\/(products|brands|areas)$|\/price-rules$/.test(path) ? { "idempotency-key": randomUUID() } : {}) },
      }),
      status,
    );
  const brand = (await call("POST", "/brands", { name: "包车-行程", currency: "JPY" }, undefined, 201)).id;
  api.clock.advance(1_000);
  const area = (await call("POST", "/areas", { city_id: m.ids.tokyo, name: { zh: "东京-包车" }, biz_type: "general", polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [[[139.0, 35.0], [140.0, 35.0], [140.0, 36.0], [139.0, 36.0], [139.0, 35.0]]] } }] }, undefined, 201)).id;
  const created = await call("POST", "/products", { brand_id: brand, city_id: m.ids.tokyo, category: "charter", areas: [{ area_id: area }], vehicle_groups: [{ vehicle_group_id: m.ids.biz7, passengers: 6, luggage: 4 }], dispatchers: [{ name: "调度", phone: "0312345678" }] }, undefined, 201);
  const rules = await call("PUT", `/products/${created.id}/service-rules`, { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { general: { mode: "limited", minutes: 0 } } }, 1);
  const version = (await call("PUT", `/products/${created.id}/content`, { zh: { title: "东京包车" } }, rules.version)).version as number;
  await call("POST", `/products/${created.id}/price-rules`, { area_id: area, vehicle_group_id: m.ids.biz7, valid_from: "2026-01-01", package_hours: 8, pricing_model: "charter_package", package_km: 150, package_price: 70_000, overtime_per_hour: 5_000, over_km_per_km: 400 }, version, 201);
  await call("POST", `/products/${created.id}/publish`);
}

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay, webhookSender: localWebhookSender({ timeoutMs: 500 }) });
  m = await buildMarket(api);
  await charterProduct(m.b);
  const siteChannelId = (await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" })).id;
  site = await siteApi(api, (await salesCredentials(api, m, siteChannelId)).clientId, pay);
  sales = await salesFlow(api, m, pay);
  receiver = await startFakeReceiver();
});
after(async () => {
  await receiver?.close();
  await site?.close();
  await api.close();
});

async function siteQuote(body: Record<string, unknown>): Promise<any> {
  api.clock.advance(1_000);
  const res = await site.call("POST", "/site/v1/quotes", { body, ip: nextIp() });
  assert.equal(res.status, 200, res.text);
  const quote = res.body.quotes.find((q: any) => q.vehicle_group.id === m.ids.biz7);
  assert.ok(quote, res.text);
  return quote;
}

const transferQuote = () => siteQuote({ city_id: m.ids.tokyo, airport_id: m.ids.narita, direction: "pickup", address: ADDRESS, service_local: SERVICE_LOCAL, passengers: 2, luggage: 1 });
const charterQuote = () => siteQuote({ category: "charter", city_id: m.ids.tokyo, pickup: PICKUP, dropoff: DROPOFF, package_hours: 8, service_local: SERVICE_LOCAL, passengers: 3, luggage: 2 });

async function siteOrder(body: Record<string, unknown>, key = randomUUID()): Promise<any> {
  api.clock.advance(1_000);
  const res = await site.call("POST", "/site/v1/orders", { headers: { "idempotency-key": key }, body: { passenger: PASSENGER, save_payment_method: true, ...body }, ip: nextIp() });
  assertMatchesOpenApi("POST", "/site/v1/orders", res);
  assert.equal(res.status, 201, res.text);
  return res.body;
}

async function payFor(orderId: string): Promise<void> {
  const intent = pay.intentOf(orderId);
  assert.ok(intent);
  pay.pay(intent.id);
  const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
  const res = await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()));
  assert.equal(res.status, 200, JSON.stringify(res.body));
}

async function adminToken(side: "a" | "b"): Promise<string> {
  return (await ok(api.call("POST", "/tenant/v1/auth/login", { body: { email: m[side].adminEmail, password: TEST_PASSWORD } }))).access_token;
}

async function platformDetail(orderId: string): Promise<any> {
  const res = await api.call("GET", `/platform/v1/orders/${orderId}`, { token: m.root });
  assertMatchesOpenApi("GET", "/platform/v1/orders/{id}", res);
  assert.equal(res.status, 200, res.text);
  return res.body.order;
}

async function tenantDetail(side: "a" | "b", orderId: string): Promise<{ status: number; body: any; text: string }> {
  const res = await api.call("GET", `/tenant/v1/orders/${orderId}`, { token: await adminToken(side) });
  if (res.status === 200) assertMatchesOpenApi("GET", "/tenant/v1/orders/{id}", res);
  return res;
}

function assertNoForbiddenKeys(value: unknown, where: string): void {
  const keys = allKeys(value);
  for (const key of FORBIDDEN_TENANT_KEYS) assert.ok(!keys.has(key), `${where} 里不能有 ${key}`);
}

async function naritaPlace(): Promise<{ name: string; lat: number; lng: number }> {
  const row = (await api.db.owner.query<{ name: { zh: string }; lng: string; lat: string }>("select name, lng, lat from places where id = $1", [m.ids.narita])).rows[0]!;
  return { name: row.name.zh, lat: Number(row.lat), lng: Number(row.lng) };
}

test("F1：官网区间单（成田机场 → 东京站）下单后订单行程方式 transfer、地点 2 个、停留为空、来源 book；运营订单详情给行程和来源", async () => {
  const quote = await transferQuote();
  const created = await siteOrder({ quote_id: quote.quote_id, flight_no: "NH 211", dropoff_address: "东京站八重洲口" });
  const narita = await naritaPlace();
  const expected = {
    version: 1,
    mode: "transfer",
    stops: [
      { seq: 1, role: "pickup", ...narita, stay_minutes: null, planned_arrival_local: null, planned_departure_local: SERVICE_LOCAL },
      { seq: 2, role: "dropoff", name: "东京站八重洲口", lat: ADDRESS.lat, lng: ADDRESS.lng, stay_minutes: null, planned_arrival_local: null, planned_departure_local: null },
    ],
    legs: [],
    totals: null,
    package: null,
    estimate: null,
  };
  assert.deepEqual(created.order.itinerary, expected);
  assert.equal(created.order.entry_source, "book");
  assert.equal(narita.name, "成田机场", "机场那一端用接送点的中文名");

  const viewed = await site.call("GET", "/site/v1/order", { token: created.link.token });
  assertMatchesOpenApi("GET", "/site/v1/order", viewed);
  assert.deepEqual([viewed.body.order.itinerary, viewed.body.order.entry_source], [expected, "book"]);

  const row = (await api.db.owner.query<{ itinerary: unknown; entry_source: string }>("select itinerary, entry_source from orders where id = $1", [created.order.id])).rows[0]!;
  assert.deepEqual([row.itinerary, row.entry_source], [expected, "book"]);

  const platform = await platformDetail(created.order.id);
  assert.deepEqual([platform.itinerary, platform.entry_source], [expected, "book"]);
});

test("F2：按时长包车 8 小时 → 方式 charter_package、套餐 8 小时含 150 公里、地点 2 个；订单行程里没有任何金额", async () => {
  const quote = await charterQuote();
  const created = await siteOrder({ quote_id: quote.quote_id, pickup_address: "银座四丁目", dropoff_address: "新宿站西口" });
  const itinerary = created.order.itinerary;
  assert.equal(itinerary.mode, "charter_package");
  assert.deepEqual(itinerary.package, { hours: 8, km: 150 });
  assert.deepEqual(
    itinerary.stops.map((stop: any) => [stop.seq, stop.role, stop.name, stop.lat, stop.lng, stop.stay_minutes]),
    [
      [1, "pickup", "银座四丁目", PICKUP.lat, PICKUP.lng, null],
      [2, "dropoff", "新宿站西口", DROPOFF.lat, DROPOFF.lng, null],
    ],
  );
  const keys = [...allKeys(itinerary)];
  for (const key of keys) assert.doesNotMatch(key, /minor|amount|price|sell|markup|fx|currency|settlement|total$/i, `订单行程里有金额的键 ${key}`);
  assert.doesNotMatch(JSON.stringify(itinerary), /77000|70000|JPY/, "订单行程里没有对外价、结算价、币种");
});

test("F9：同一个 Idempotency-Key 并发提交两次只有一张单，两次应答相同，订单行程只写一次", async () => {
  const quote = await transferQuote();
  const key = randomUUID();
  api.clock.advance(1_000);
  const body = { quote_id: quote.quote_id, passenger: PASSENGER, flight_no: "NH 211", dropoff_address: "东京站八重洲口", save_payment_method: true };
  const [first, second] = await Promise.all([
    site.call("POST", "/site/v1/orders", { headers: { "idempotency-key": key }, body, ip: nextIp() }),
    site.call("POST", "/site/v1/orders", { headers: { "idempotency-key": key }, body, ip: nextIp() }),
  ]);
  assert.deepEqual([first.status, second.status], [201, 201], `${first.text}\n${second.text}`);
  assert.equal(first.body.order.id, second.body.order.id);
  assert.deepEqual(first.body.order, second.body.order, "两次应答的订单相同");
  assert.deepEqual([first.headers["idempotent-replayed"], second.headers["idempotent-replayed"]].sort(), ["true", undefined].sort());
  const rows = await api.db.owner.query<{ n: number; itineraries: number; events: number }>(
    `select count(*)::int as n, count(itinerary)::int as itineraries, (select count(*)::int from order_events where order_id = $1) as events
       from orders where order_no = $2`,
    [first.body.order.id, first.body.order.order_no],
  );
  assert.deepEqual(rows.rows[0], { n: 1, itineraries: 1, events: 1 }, "只有一张单、一份行程、一条建单流水");
  assert.equal(first.body.order.itinerary.mode, "transfer");
});

test("F7、F8：租户 A 读租户 B 的订单行程 404；/tenant/v1 订单详情、列表和供应商 Webhook 有行程，没有对外金额、加价比例、来源字段", async () => {
  const token = await adminToken("b");
  const configured = await api.call("PUT", "/tenant/v1/webhooks", { token, body: { url: receiver.url, events: ["order.confirmed"] } });
  assert.equal(configured.status, 201, configured.text);
  receiver.respond([200]);
  receiver.received.length = 0;

  const quote = await charterQuote();
  const created = await siteOrder({ quote_id: quote.quote_id, pickup_address: "银座四丁目", dropoff_address: "新宿站西口" });
  const sell = created.order.price.total.amount as string;
  await payFor(created.order.id);

  const mine = await tenantDetail("b", created.order.id);
  assert.equal(mine.status, 200, mine.text);
  assert.deepEqual(mine.body.order.itinerary, created.order.itinerary, "供应商看得到行程（地点、套餐）");
  assertNoForbiddenKeys(mine.body, "/tenant/v1 订单详情");
  assert.ok(!mine.text.includes(`"${sell}"`), "规则 4：供应商详情里没有对外价");

  const other = await tenantDetail("a", created.order.id);
  assert.deepEqual([other.status, other.body.error.code], [404, "NOT_FOUND"], "租户 A 读不到租户 B 的订单行程");
  const listA = await ok(api.call("GET", "/tenant/v1/orders", { token: await adminToken("a") }));
  assert.ok(!listA.items.some((item: any) => item.id === created.order.id), "租户 A 的列表里也没有");

  const list = await api.call("GET", "/tenant/v1/orders", { token });
  assertMatchesOpenApi("GET", "/tenant/v1/orders", list);
  const listed = list.body.items.find((item: any) => item.id === created.order.id);
  assert.deepEqual(listed.itinerary, created.order.itinerary);
  assertNoForbiddenKeys(list.body, "/tenant/v1 订单列表");

  for (let i = 0; i < 5; i += 1) {
    const result = await api.app.webhookJobs.tick();
    if (result.succeeded + result.retrying + result.failed === 0) break;
  }
  const pushed = receiver.received.map((entry) => JSON.parse(entry.body)).find((entry) => entry.data?.order?.id === created.order.id);
  assert.ok(pushed, "order.confirmed 推给了乙");
  assert.equal(pushed.type, "order.confirmed");
  assert.deepEqual(pushed.data.order.itinerary, created.order.itinerary, "Webhook 里有行程");
  assertNoForbiddenKeys(pushed, "供应商 Webhook");
  assert.ok(!JSON.stringify(pushed).includes(`"${sell}"`), "规则 4：推送里没有对外价");

  // 供应商的数据库角色改不了行程和来源（触发器兜底）；来源建好后平台也改不了
  const tenantUpdate = await api.db.pool.connect();
  try {
    await tenantUpdate.query("begin");
    await tenantUpdate.query("set local role nozomi_app");
    await tenantUpdate.query("select set_config('app.tenant_id', $1, true)", [m.b.tenantId]);
    await assert.rejects(tenantUpdate.query("update orders set itinerary = null where id = $1", [created.order.id]), /供应商不能改/);
  } finally {
    await tenantUpdate.query("rollback");
    tenantUpdate.release();
  }
  await assert.rejects(api.db.owner.query("update orders set entry_source = 'embed' where id = $1", [created.order.id]), /订单的来源建好之后不能改/);
});

test("F3：/sales/v1 渠道单订单行程为 null、没有来源字段；M9-02 之前的官网单（两列为空）应答只是这两项为 null，其余字段不变", async () => {
  const channelOrder = await sales.paidOrder();
  const viewed = await api.call("GET", `/sales/v1/orders/${channelOrder.id}`, { token: await sales.token() });
  assertMatchesOpenApi("GET", "/sales/v1/orders/{id}", viewed);
  assert.equal(viewed.body.order.itinerary, null);
  assert.ok(!("entry_source" in viewed.body.order), "/sales/v1 不加来源字段");
  const row = (await api.db.owner.query<{ itinerary: unknown; entry_source: unknown }>("select itinerary, entry_source from orders where id = $1", [channelOrder.id])).rows[0]!;
  assert.deepEqual(row, { itinerary: null, entry_source: null });
  const platform = await platformDetail(channelOrder.id);
  assert.deepEqual([platform.itinerary, platform.entry_source], [null, null]);
  assert.equal((await tenantDetail("b", channelOrder.id)).body.order.itinerary, null);

  // 一张官网单改成「M9-02 上线前」的样子（两列为空）：官网订单页、运营、供应商详情只有这两项变成 null，别的字段原样
  const quote = await transferQuote();
  const created = await siteOrder({ quote_id: quote.quote_id, flight_no: "NH 211", dropoff_address: "东京站八重洲口" });
  await payFor(created.order.id);
  const before = {
    site: (await site.call("GET", "/site/v1/order", { token: created.link.token })).body,
    platform: await platformDetail(created.order.id),
    tenant: (await tenantDetail("b", created.order.id)).body,
  };
  await api.db.owner.query("alter table orders disable trigger orders_entry_source_immutable");
  try {
    await api.db.owner.query("update orders set itinerary = null, entry_source = null where id = $1", [created.order.id]);
  } finally {
    await api.db.owner.query("alter table orders enable trigger orders_entry_source_immutable");
  }
  const legacySite = await site.call("GET", "/site/v1/order", { token: created.link.token });
  assertMatchesOpenApi("GET", "/site/v1/order", legacySite);
  const after = { site: legacySite.body, platform: await platformDetail(created.order.id), tenant: (await tenantDetail("b", created.order.id)).body };
  assert.deepEqual([after.site.order.itinerary, after.site.order.entry_source, after.platform.itinerary, after.platform.entry_source, after.tenant.order.itinerary], [null, null, null, null, null]);
  const strip = (order: Record<string, unknown>): Record<string, unknown> => {
    const { itinerary: _itinerary, entry_source: _source, ...rest } = order;
    return rest;
  };
  assert.deepEqual({ ...after.site, order: strip(after.site.order) }, { ...before.site, order: strip(before.site.order) }, "官网订单页其余字段不变");
  assert.deepEqual(strip(after.platform), strip(before.platform), "运营订单详情其余字段不变");
  assert.deepEqual({ ...after.tenant, order: strip(after.tenant.order) }, { ...before.tenant, order: strip(before.tenant.order) }, "供应商订单详情其余字段不变");
});
