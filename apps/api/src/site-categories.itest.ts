/**
 * M3-10：官网也能订点对点和包车（ADR 0032 补充），经真实接口、真实 PostgreSQL；收款服务用替身。
 * - 城市带「能订的品类」，只算渠道授权的品类和供应商；包车套餐时长只列启用、没过期的价格规则里的；
 * - 地址输入辅助：城市里启用的机场、车站、地标（主数据），不含航站楼、停用的、别的城市的；
 * - 点对点、包车：询价 → 下单 → 凭查看链接看订单；各品类该填 / 不该填的字段；包车报价带套餐时长和公里；
 * - 不泄露中标供应商（付款前）、结算价、加价比例；渠道没授权的品类 422；
 * - 隔离：别的渠道的点对点单用订单号找不到；付款后中标的供应商看得到这张单但看不到对外价，别的供应商看不到。
 * 测试数据全在本文件里经接口建出来，随测试 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TenantFixture } from "./testing/api.ts";
import { type TestApi, createTestApi } from "./testing/api.ts";
import { type Market, allKeys, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let site: SiteApi;
let siteChannelId: string;
const places: Record<string, string> = {};

const PICKUP = { lng: 139.7, lat: 35.6 };
const DROPOFF = { lng: 139.75, lat: 35.68 };
/** 测试的时钟从 2026-10-07 开始，离用车足够远 */
const SERVICE_LOCAL = "2026-10-20T10:00";
const PASSENGER = { name: "陈小红", phone: "+81 90-2222-3333", email: "p2p.guest@example.com" };
let ipSeq = 0;
const nextIp = (): string => {
  ipSeq += 1;
  return `10.77.${ipSeq}.9`;
};

/**
 * 给供应商建一个东京的点对点或包车商品（区域盖住整个东京，商务 7 座），按 `prices` 建价格规则，再上架。
 * 点对点：`prices` 是一口价；包车：每条是一个套餐（时长、套餐价、公里、状态、有效期）。
 */
async function categoryProduct(who: TenantFixture, category: "point_to_point" | "charter", prices: Record<string, unknown>[]): Promise<string> {
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
  const brand = (await call("POST", "/brands", { name: `${category}-${who.tenantId.slice(0, 4)}`, currency: "JPY" }, undefined, 201)).id;
  api.clock.advance(1_000);
  const area = (await call("POST", "/areas", { city_id: m.ids.tokyo, name: { zh: `东京-${category}` }, biz_type: "general", polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [[[139.0, 35.0], [140.0, 35.0], [140.0, 36.0], [139.0, 36.0], [139.0, 35.0]]] } }] }, undefined, 201)).id;
  const created = await call("POST", "/products", { brand_id: brand, city_id: m.ids.tokyo, category, areas: [{ area_id: area }], vehicle_groups: [{ vehicle_group_id: m.ids.biz7, passengers: 6, luggage: 4 }], dispatchers: [{ name: "调度", phone: "0312345678" }] }, undefined, 201);
  const rules = await call("PUT", `/products/${created.id}/service-rules`, { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { general: { mode: "limited", minutes: 30 } } }, 1);
  let version = (await call("PUT", `/products/${created.id}/content`, { zh: { title: category === "charter" ? "东京包车" : "东京市内用车" } }, rules.version)).version as number;
  for (const price of prices) {
    await call("POST", `/products/${created.id}/price-rules`, { area_id: area, vehicle_group_id: m.ids.biz7, valid_from: "2026-01-01", ...price }, version, 201);
    version = (await call("GET", `/products/${created.id}`)).version;
  }
  await call("POST", `/products/${created.id}/publish`);
  return created.id;
}

const charterPrice = (hours: number, price: number, km: number, extra: Record<string, unknown> = {}) => ({ package_hours: hours, pricing_model: "charter_package", package_km: km, package_price: price, overtime_per_hour: 5_000, over_km_per_km: 400, ...extra });

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  // 点对点：甲 15,000（中标）、乙 16,000；包车：乙 4 小时 40,000 / 8 小时 70,000，停用的 6 小时和过期的 12 小时不列
  await categoryProduct(m.a, "point_to_point", [{ pricing_model: "fixed", base_price: 15_000 }]);
  await categoryProduct(m.b, "point_to_point", [{ pricing_model: "fixed", base_price: 16_000 }]);
  await categoryProduct(m.b, "charter", [charterPrice(8, 70_000, 150), charterPrice(4, 40_000, 80), charterPrice(6, 55_000, 100, { status: "disabled" }), charterPrice(12, 99_000, 200, { valid_to: "2026-06-30" })]);
  siteChannelId = (await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" })).id;
  site = await siteApi(api, (await salesCredentials(api, m, siteChannelId)).clientId, pay);

  const platform = (body: Record<string, unknown>): Promise<any> => ok(api.call("POST", "/platform/v1/master/places", { token: m.root, body }), 201);
  const location = { lng: 139.7671, lat: 35.6812 };
  places["station"] = (await platform({ type: "station", code: "STN-JP-TOKYO", city_id: m.ids.tokyo, category: "shinkansen", name: { ja: "東京駅", zh: "东京站", en: "Tokyo Station" }, location })).id;
  places["hotel"] = (await platform({ type: "poi", code: "POI-000001", city_id: m.ids.tokyo, category: "hotel", name: { zh: "东京站大饭店" }, location, address: "东京都千代田区丸之内 1-9-1" })).id;
  places["terminal"] = (await platform({ type: "terminal", code: "NRT-T1", parent_id: m.ids.narita, name: { zh: "第 1 航站楼" }, location: { lng: 140.385, lat: 35.764 } })).id;
  places["closed"] = (await platform({ type: "poi", code: "POI-000002", city_id: m.ids.tokyo, category: "mall", name: { zh: "已停用的商场" }, location })).id;
  await ok(api.call("POST", `/platform/v1/master/places/${places["closed"]}/disable`, { token: m.root, body: {} }));
  places["osakaStation"] = (await platform({ type: "station", code: "STN-JP-OSAKA", city_id: m.ids.osaka, category: "shinkansen", name: { zh: "新大阪站" }, location: { lng: 135.5, lat: 34.73 } })).id;
});
after(async () => {
  await site?.close();
  await api.close();
});

const p2pBody = (extra: Record<string, unknown> = {}) => ({ category: "point_to_point", city_id: m.ids.tokyo, pickup: PICKUP, dropoff: DROPOFF, service_local: SERVICE_LOCAL, passengers: 2, luggage: 1, ...extra });
const charterBody = (extra: Record<string, unknown> = {}) => ({ category: "charter", city_id: m.ids.tokyo, pickup: PICKUP, package_hours: 8, service_local: SERVICE_LOCAL, passengers: 3, luggage: 2, ...extra });

async function quote(body: Record<string, unknown>, on: SiteApi = site): Promise<any> {
  api.clock.advance(1_000);
  const res = await on.call("POST", "/site/v1/quotes", { body, ip: nextIp() });
  assertMatchesOpenApi("POST", "/site/v1/quotes", res);
  assert.equal(res.status, 200, res.text);
  return res.body;
}

async function order(body: Record<string, unknown>): Promise<any> {
  api.clock.advance(1_000);
  const res = await site.call("POST", "/site/v1/orders", { headers: { "idempotency-key": randomUUID() }, body, ip: nextIp() });
  assertMatchesOpenApi("POST", "/site/v1/orders", res);
  return res;
}

test("城市带能订的品类：东京三种都有；只卖接送机的渠道、只卖甲的渠道各自只列自己能卖的", async () => {
  const cities = await site.call("GET", "/site/v1/cities");
  assertMatchesOpenApi("GET", "/site/v1/cities", cities);
  assert.deepEqual(cities.body.items.map((city: any) => [city.code, city.categories]), [["CTY-JP-TYO", ["airport_transfer", "point_to_point", "charter"]]]);

  const transferOnly = await newChannel(api, m.staff.cm1.token, { name: "只卖接送机的官网", scope: { categories: ["airport_transfer"] } });
  const onlyA = await newChannel(api, m.staff.cm1.token, { name: "只卖甲的官网", scope: { tenant_scope: "allow", tenant_ids: [m.a.tenantId] } });
  for (const [channel, expected] of [[transferOnly, ["airport_transfer"]], [onlyA, ["airport_transfer", "point_to_point"]]] as const) {
    const other = await siteApi(api, (await salesCredentials(api, m, channel.id)).clientId, pay);
    try {
      const listed = await other.call("GET", "/site/v1/cities");
      assert.deepEqual(listed.body.items.map((city: any) => city.categories), [expected], channel.name);
      if (channel === onlyA) assert.deepEqual((await other.call("GET", `/site/v1/cities/${m.ids.tokyo}/charter-packages`)).body.items, [], "乙的包车这个渠道不卖");
      if (channel === transferOnly) {
        const denied = await other.call("POST", "/site/v1/quotes", { body: p2pBody(), ip: nextIp() });
        assert.deepEqual([denied.status, denied.body.error.code], [422, "CHANNEL_SCOPE_DENIED"], "渠道没授权点对点");
        assert.deepEqual((await other.call("GET", `/site/v1/cities/${m.ids.tokyo}/charter-packages`)).body.items, []);
      }
    } finally {
      await other.close();
    }
  }
});

test("包车套餐时长：启用、没过期的价格规则里的，从短到长；不存在的城市是空列表，编号不对 404", async () => {
  const res = await site.call("GET", `/site/v1/cities/${m.ids.tokyo}/charter-packages`);
  assertMatchesOpenApi("GET", "/site/v1/cities/{id}/charter-packages", res);
  assert.deepEqual(res.body.items, [{ hours: 4 }, { hours: 8 }], "停用的 6 小时、6 月底到期的 12 小时不列");
  assert.deepEqual((await site.call("GET", `/site/v1/cities/${m.ids.osaka}/charter-packages`)).body.items, []);
  assert.deepEqual((await site.call("GET", `/site/v1/cities/${randomUUID()}/charter-packages`)).body.items, []);
  assert.equal((await site.call("GET", "/site/v1/cities/not-a-uuid/charter-packages")).status, 404);
});

test("地址输入辅助：城市里启用的机场、车站、地标（带坐标、地标的地址）；不含航站楼、停用的、别的城市的", async () => {
  const res = await site.call("GET", `/site/v1/cities/${m.ids.tokyo}/places`);
  assertMatchesOpenApi("GET", "/site/v1/cities/{id}/places", res);
  assert.deepEqual(
    res.body.items.map((place: any) => [place.type, place.code, place.address]),
    [["airport", "NRT", null], ["station", "STN-JP-TOKYO", null], ["poi", "POI-000001", "东京都千代田区丸之内 1-9-1"]],
  );
  assert.deepEqual(res.body.items[1].location, { lng: 139.7671, lat: 35.6812 });
  assert.deepEqual(res.body.items[1].name, { ja: "東京駅", zh: "东京站", en: "Tokyo Station" });
  assert.deepEqual((await site.call("GET", `/site/v1/cities/${m.ids.osaka}/places`)).body.items.map((place: any) => place.code), ["STN-JP-OSAKA"]);
  assert.deepEqual((await site.call("GET", `/site/v1/cities/${randomUUID()}/places`)).body.items, []);
  const osakaOnly = await newChannel(api, m.staff.cm1.token, { name: "只卖大阪的官网", scope: { city_ids: [m.ids.osaka] } });
  const scoped = await siteApi(api, (await salesCredentials(api, m, osakaOnly.id)).clientId, pay);
  try {
    assert.deepEqual((await scoped.call("GET", `/site/v1/cities/${m.ids.tokyo}/places`)).body.items, [], "渠道没授权东京：和城市列表一致，不列东京的地点");
    assert.deepEqual((await scoped.call("GET", `/site/v1/cities/${m.ids.osaka}/places`)).body.items.map((place: any) => place.code), ["STN-JP-OSAKA"]);
  } finally {
    await scoped.close();
  }
  const closed = await siteApi(api, null, pay);
  try {
    assert.equal((await closed.call("GET", `/site/v1/cities/${m.ids.tokyo}/places`)).body.error.code, "SITE_NOT_OPEN");
  } finally {
    await closed.close();
  }
});

test("各品类该填的没填是 REQUIRED、不该填的填了是 NOT_APPLICABLE；不认识的品类 400", async () => {
  const cases: [Record<string, unknown>, [string, string][]][] = [
    [p2pBody({ dropoff: undefined }), [["/dropoff", "REQUIRED"]]],
    [p2pBody({ airport_id: m.ids.narita, direction: "pickup" }), [["/airport_id", "NOT_APPLICABLE"], ["/direction", "NOT_APPLICABLE"]]],
    [p2pBody({ package_hours: 4 }), [["/package_hours", "NOT_APPLICABLE"]]],
    [charterBody({ package_hours: undefined }), [["/package_hours", "REQUIRED"]]],
    [charterBody({ dropoff: DROPOFF }), [["/dropoff", "NOT_APPLICABLE"]]],
    [charterBody({ address: PICKUP }), [["/address", "NOT_APPLICABLE"]]],
    [{ city_id: m.ids.tokyo, pickup: PICKUP, dropoff: DROPOFF, service_local: SERVICE_LOCAL, passengers: 2 }, [["/airport_id", "REQUIRED"], ["/direction", "REQUIRED"], ["/address", "REQUIRED"], ["/pickup", "NOT_APPLICABLE"], ["/dropoff", "NOT_APPLICABLE"]]],
  ];
  for (const [body, expected] of cases) {
    const res = await site.call("POST", "/site/v1/quotes", { body: JSON.parse(JSON.stringify(body)), ip: nextIp() });
    assert.equal(res.status, 400, res.text);
    assert.deepEqual(res.body.error.details.issues.map((issue: any) => [issue.path, issue.reason]), expected, JSON.stringify(body));
    for (const issue of res.body.error.details.issues) assert.ok(issue.message.length > 0);
  }
  for (const body of [p2pBody({ category: "bus" }), charterBody({ package_hours: 0 }), charterBody({ package_hours: 73 }), p2pBody({ pickup: { lng: 139.7 } })]) {
    assert.equal((await site.call("POST", "/site/v1/quotes", { body, ip: nextIp() })).status, 400, JSON.stringify(body));
  }
});

test("点对点：询价（甲 15,000 中标，对外 16,500）→ 下单（两端地址必填、不填航班号）→ 凭链接看订单；没有供应商、结算价、加价比例", async () => {
  const quoted = await quote(p2pBody());
  assert.deepEqual(quoted.quotes.map((entry: any) => [entry.vehicle_group.code, entry.price.total.amount, entry.package, entry.cancel_policy.category]), [["VG-BIZ-7", "16500", null, "point_to_point"]]);
  assert.equal(quoted.quotes[0].free_wait_minutes, 30);
  const keys = allKeys(quoted);
  for (const leaked of ["settlement", "markup_bp", "winner_tenant_id", "tenant_id", "winning_tenant"]) assert.ok(!keys.has(leaked), leaked);
  assert.doesNotMatch(JSON.stringify(quoted), /15000|16000|甲车队|乙车队/);

  const base = { quote_id: quoted.quotes[0].quote_id, passenger: PASSENGER, save_payment_method: true };
  const missing = await order({ ...base, pickup_address: "东京站八重洲口" });
  assert.deepEqual([missing.status, missing.body.error.details.issues.map((issue: any) => issue.path)], [400, ["/dropoff_address"]]);
  const flight = await order({ ...base, pickup_address: "东京站八重洲口", dropoff_address: "新宿站南口", flight_no: "NH211" });
  assert.deepEqual([flight.status, flight.body.error.details.issues.map((issue: any) => [issue.path, issue.reason])], [400, [["/flight_no", "NOT_APPLICABLE"]]]);

  const created = await order({ ...base, pickup_address: "东京站八重洲口", dropoff_address: "新宿站南口" });
  assert.equal(created.status, 201, created.text);
  const placed = created.body;
  assert.deepEqual(
    [placed.order.category, placed.order.direction, placed.order.place_id, placed.order.pickup.address, placed.order.dropoff.address, placed.order.price.total.amount, placed.order.winning_tenant, placed.names.place],
    ["point_to_point", null, null, "东京站八重洲口", "新宿站南口", "16500", null, null],
  );
  assert.deepEqual([placed.order.pickup.lng, placed.order.pickup.lat, placed.order.dropoff.lng, placed.order.dropoff.lat], [PICKUP.lng, PICKUP.lat, DROPOFF.lng, DROPOFF.lat]);
  assert.doesNotMatch(created.text, /15000|甲车队|markup|settlement/);
  const seen = await site.call("GET", "/site/v1/order", { token: placed.link.token, ip: nextIp() });
  assertMatchesOpenApi("GET", "/site/v1/order", seen);
  assert.deepEqual([seen.status, seen.body.order.id, seen.body.order.landing], [200, placed.order.id, null], "点对点没有「我已落地」");

  // 付款后：中标的甲看得到这张单，看不到对外价和加价比例；乙看不到
  const intent = pay.intentOf(placed.order.id);
  assert.ok(intent);
  pay.pay(intent.id);
  const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
  assert.equal((await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()))).status, 200);
  const tenantA = await api.call("GET", `/tenant/v1/orders/${placed.order.id}`, { token: await tenantLogin(api, m.a.adminEmail) });
  assert.equal(tenantA.status, 200, tenantA.text);
  assert.doesNotMatch(tenantA.text, /16500|markup/);
  const tenantB = await api.call("GET", `/tenant/v1/orders/${placed.order.id}`, { token: await tenantLogin(api, m.b.adminEmail) });
  assert.equal(tenantB.status, 404);
});

test("包车：选 8 小时（乙 70,000，对外 77,000，含 150 公里）→ 下单（只要上车地址）→ 订单带套餐时长；没有的时长报不出价", async () => {
  const quoted = await quote(charterBody());
  assert.deepEqual(quoted.quotes.map((entry: any) => [entry.price.total.amount, entry.package, entry.cancel_policy.category]), [["77000", { hours: 8, km: 150 }, "charter"]]);
  assert.doesNotMatch(JSON.stringify(quoted), /70000|乙车队|markup|settlement/);
  const none = await quote(charterBody({ package_hours: 6 }));
  assert.deepEqual([none.quotes.length, none.unavailable.length > 0], [0, true], "停用的 6 小时报不出价");

  const base = { quote_id: quoted.quotes[0].quote_id, passenger: PASSENGER, save_payment_method: true };
  const extra = await order({ ...base, pickup_address: "东京站大饭店", dropoff_address: "新宿" });
  assert.deepEqual([extra.status, extra.body.error.details.issues.map((issue: any) => [issue.path, issue.reason])], [400, [["/dropoff_address", "NOT_APPLICABLE"]]]);
  const created = await order({ ...base, pickup_address: "东京站大饭店" });
  assert.equal(created.status, 201, created.text);
  assert.deepEqual([created.body.order.category, created.body.order.package_hours, created.body.order.dropoff, created.body.order.price.total.amount], ["charter", 8, null, "77000"]);
  const seen = await site.call("GET", "/site/v1/order", { token: created.body.link.token, ip: nextIp() });
  assert.deepEqual([seen.body.order.package_hours, seen.body.order.cancel_policy.category], [8, "charter"]);
  const fee = await site.call("GET", "/site/v1/order/cancel-fee?reason=GUEST_REQUEST", { token: created.body.link.token, ip: nextIp() });
  assert.equal(fee.status, 200, fee.text);
});

test("别的渠道经 /sales/v1 下的点对点单：官网用订单号 + 联系方式也找不到（同一个 404）", async () => {
  const otherChannel = await newChannel(api, m.staff.cm1.token, { name: "别的渠道" });
  const credentials = await salesCredentials(api, m, otherChannel.id, "198.51.100.33");
  const sales = await ok(api.call("POST", "/sales/v1/quotes", { token: credentials.token, body: { category: "point_to_point", city_id: m.ids.tokyo, pickup: PICKUP, dropoff: DROPOFF, service_time: `${SERVICE_LOCAL}:00+09:00`, passengers: 2, currency: "JPY" } }));
  const placed = await api.call("POST", "/sales/v1/orders", {
    token: credentials.token,
    headers: { "idempotency-key": randomUUID() },
    body: { quote_id: sales.quotes[0].quote_id, passenger: PASSENGER, pickup_address: "东京站", dropoff_address: "新宿站", save_payment_method: true },
  });
  assert.equal(placed.status, 201, placed.text);
  const lookup = await site.call("POST", "/site/v1/orders/lookup", { ip: nextIp(), body: { order_no: placed.body.order.order_no, contact: PASSENGER.email } });
  assert.deepEqual([lookup.status, lookup.body.error.code], [404, "ORDER_NOT_FOUND"]);
});
