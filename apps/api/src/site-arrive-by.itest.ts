/**
 * M9P-20 P3：包车经停的指定到达时间 `arrive_by`（ADR 0096 第三节第 6 小节，按「最晚到达」理解），经真实接口、真实 PostgreSQL；
 * 谷歌的优化调用是本机的假服务器（按直线距离穷举出最短顺序），报价的逐段路线是替身（直线距离，每公里 1 分钟），**从不调用真实的谷歌**。
 *
 * 覆盖：
 * - 校验：HH:MM、day_offset 0 / 1；必须晚于用车开始（同一时刻不行）、不晚于开始 + 24 小时，否则 400 VALIDATION_FAILED（`/waypoints/{i}/arrive_by`）；跨午夜（20:00 出发、次日 01:00）可以；
 * - 不影响价格：带不带 arrive_by 同一价；快照 request.waypoints 只在给了的经停上有这个键，不给时和以前逐字一样；
 * - 下单：抄进 orders.waypoints；官网订单页、供应商、运营、司机页都看得到；渠道接口（/sales/v1）去掉、接口说明不变；
 * - 顺序建议：带 arrive_by 的经停是固定点——切成两段各问一次谷歌、固定点留在原位、段内各自重排；
 *   改 arrive_by 的时刻请求键变、不再调谷歌；固定点两边各只有 1 个经停时不调谷歌（NOT_APPLICABLE）。
 * 测试数据全在本文件里经接口建出来，随测试 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type LatLng, type RouteLookup, haversineMeters, suggestionRequestKey } from "@nozomi/domain";
import type { ApiResponse, HttpMethod, TenantFixture, TestApi } from "./testing/api.ts";
import { createTestApi } from "./testing/api.ts";
import { assign, newDriver, newVehicle } from "./testing/dispatch.ts";
import { type FakeService, startFakeGoogleRoutes } from "./testing/fake-integrations.ts";
import { type Market, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi, assertMatchesOperation } from "./testing/openapi.ts";
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let routes: FakeService;
let site: SiteApi;
let sales: { clientId: string; secret: string };

const square = (west: number, south: number, east: number, north: number) => ({ type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] });
const SHINJUKU = { lat: 35.69, lng: 139.7 };
const SERVICE_LOCAL = "2026-10-20T08:00";
const PASSENGER = { name: "陈小红", phone: "+81 90-2222-3333", email: "arrive-by.guest@example.com" };
let ipSeq = 0;
const nextIp = (): string => `10.96.${Math.floor((ipSeq += 1) / 200)}.${ipSeq % 200}`;
let tag = 0;

/** 报价的逐段路线替身：直线距离，每公里 1 分钟 */
const routeLookup = async ({ from, to }: { from: LatLng; to: LatLng }): Promise<RouteLookup> => {
  const meters = Math.round(haversineMeters(from, to));
  return { ok: true, route: { meters, minutes: Math.round(meters / 1_000) }, source: "google" };
};

/** 假谷歌优化：按直线距离穷举中间点的所有排列，回最短的那个 */
function optimizeReply(): { body: unknown } {
  const last = routes.requests[routes.requests.length - 1];
  const body = JSON.parse(last?.body ?? "{}") as { origin: { location: { latLng: { latitude: number; longitude: number } } }; destination: typeof body.origin; intermediates: (typeof body.origin)[] };
  const pt = (p: typeof body.origin): LatLng => ({ lat: p.location.latLng.latitude, lng: p.location.latLng.longitude });
  const mids = body.intermediates.map(pt);
  let best: number[] = [];
  let bestLength = Number.POSITIVE_INFINITY;
  const permute = (prefix: number[], rest: number[]): void => {
    if (rest.length === 0) {
      const path = [pt(body.origin), ...prefix.map((i) => mids[i] as LatLng), pt(body.destination)];
      const length = path.slice(1).reduce((sum, p, i) => sum + haversineMeters(path[i] as LatLng, p), 0);
      if (length < bestLength) [best, bestLength] = [prefix, length];
      return;
    }
    for (const i of rest) permute([...prefix, i], rest.filter((x) => x !== i));
  };
  permute([], mids.map((_, i) => i));
  return { body: { routes: [{ optimizedIntermediateWaypointIndex: best }] } };
}

const optimizeCalls = (): FakeService["requests"] => routes.requests.filter((request) => request.headers["x-goog-fieldmask"] === "routes.optimizedIntermediateWaypointIndex");

async function tenantCall(who: TenantFixture, method: HttpMethod, path: string, options: { body?: unknown; version?: number } = {}): Promise<ApiResponse> {
  const token = await tenantLogin(api, who.adminEmail);
  api.clock.advance(1_000);
  return api.call(method, `/tenant/v1${path}`, {
    token,
    ...(options.body === undefined ? {} : { body: options.body }),
    headers: { ...(options.version === undefined ? {} : { "if-match": `"${options.version}"` }), ...(method === "POST" && /^\/(products|brands|areas)$|\/price-rules(\/batch)?$/.test(path) ? { "idempotency-key": randomUUID() } : {}) },
  });
}

async function newCharter(who: TenantFixture): Promise<void> {
  const area = (await ok(tenantCall(who, "POST", "/areas", { body: { city_id: m.ids.tokyo, name: { zh: "关东" }, biz_type: "charter", polygons: [{ kind: "operate", geometry: square(138.4, 34.9, 140.3, 36.2) }] } }), 201)).id;
  const brand = (await ok(tenantCall(who, "POST", "/brands", { body: { name: `包车-${randomUUID().slice(0, 6)}`, currency: "JPY" } }), 201)).id;
  const created = await ok(tenantCall(who, "POST", "/products", { body: { brand_id: brand, city_id: m.ids.tokyo, category: "charter", areas: [{ area_id: area }], vehicle_groups: [{ vehicle_group_id: m.ids.biz7, passengers: 6, luggage: 4 }], dispatchers: [{ name: "调度", phone: "0312345678" }] } }), 201);
  const rules = await ok(tenantCall(who, "PUT", `/products/${created.id}/service-rules`, { version: 1, body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { general: { mode: "limited", minutes: 0 } } } }));
  const content = await ok(tenantCall(who, "PUT", `/products/${created.id}/content`, { version: rules.version, body: { zh: { title: "关东包车" } } }));
  const pkg = (hours: number, price: number) => ({ area_id: area, vehicle_group_id: m.ids.biz7, package_hours: hours, pricing_model: "charter_package", package_km: 200, package_price: price, overtime_per_hour: 6_000, over_km_per_km: 500, valid_from: "2026-01-01" });
  await ok(tenantCall(who, "POST", `/products/${created.id}/price-rules/batch`, { version: content.version, body: { create: [pkg(8, 50_000), pkg(10, 60_000), pkg(12, 70_000)] } }));
  await ok(tenantCall(who, "POST", `/products/${created.id}/publish`));
}

before(async () => {
  routes = await startFakeGoogleRoutes();
  routes.respond(optimizeReply);
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay, quote: { routes: { estimate: routeLookup } } });
  m = await buildMarket(api);
  await newCharter(m.b);
  const channel = await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" });
  const issued = await salesCredentials(api, m, channel.id);
  sales = { clientId: issued.clientId, secret: issued.secret };
  site = await siteApi(api, issued.clientId, pay, { GOOGLE_MAPS_ROUTES_URL: routes.url }, { integrationSecretsTtlMs: 0, quote: { routes: { estimate: routeLookup } } });
  api.clock.advance(31_000);
});
after(async () => {
  await site?.close();
  await api.close();
  await routes.close();
});

interface Stop {
  ref: string;
  name: string;
  lat: number;
  lng: number;
  stay_minutes: number;
  arrive_by?: { day_offset: 0 | 1; time: string };
}
const quoteBody = (stops: readonly Stop[], serviceLocal = SERVICE_LOCAL) => ({ category: "charter", city_id: m.ids.tokyo, itinerary_pricing: true, pickup: SHINJUKU, dropoff: SHINJUKU, waypoints: stops.map(({ ref: _ref, ...stop }) => stop), service_local: serviceLocal, passengers: 2, luggage: 1 });
const quote = async (stops: readonly Stop[], serviceLocal = SERVICE_LOCAL): Promise<ApiResponse> => {
  api.clock.advance(1_000);
  return site.call("POST", "/site/v1/quotes", { body: quoteBody(stops, serviceLocal), ip: nextIp() });
};
async function suggest(stops: readonly Stop[], quoteId: string): Promise<ApiResponse> {
  const res = await site.call("POST", "/site/v1/charter/order-suggestion", { body: { quote: quoteBody(stops), refs: stops.map((stop) => stop.ref), quote_id: quoteId, session: `sess-${randomUUID()}` }, ip: nextIp() });
  assertMatchesOpenApi("POST", "/site/v1/charter/order-suggestion", res);
  assert.equal(res.status, 200, res.text);
  return res;
}
/** 每个用例自己的一组点（顺序建议的缓存是共用的） */
const at = (ref: string, name: string, lat: number, lng: number, arriveBy?: Stop["arrive_by"]): Stop => {
  const d = tag * 0.001;
  return { ref, name, lat: lat + d, lng, stay_minutes: 30, ...(arriveBy === undefined ? {} : { arrive_by: arriveBy }) };
};

test("校验：HH:MM、day_offset 0 / 1；必须晚于用车开始、不晚于开始 + 24 小时，否则 400；跨午夜（20:00 出发、次日 01:00）可以", async () => {
  tag += 1;
  const stop = (arriveBy: unknown) => ({ ...at("k", "河口湖", 35.5, 138.77), arrive_by: arriveBy }) as Stop;
  const cases: [unknown, string, string][] = [
    [{ day_offset: 0, time: "08:00" }, SERVICE_LOCAL, "NOT_AFTER_START"],
    [{ day_offset: 0, time: "07:59" }, SERVICE_LOCAL, "NOT_AFTER_START"],
    [{ day_offset: 1, time: "08:01" }, SERVICE_LOCAL, "TOO_LATE"],
    [{ day_offset: 0, time: "01:00" }, "2026-10-20T20:00", "NOT_AFTER_START"],
  ];
  for (const [arriveBy, serviceLocal, reason] of cases) {
    const res = await quote([stop(arriveBy)], serviceLocal);
    assert.equal(res.status, 400, `${JSON.stringify(arriveBy)} ${res.text}`);
    assert.equal(res.body.error.code, "VALIDATION_FAILED");
    assert.deepEqual(res.body.error.details.issues.map((issue: { path: string; reason: string }) => [issue.path, issue.reason]), [["/waypoints/0/arrive_by", reason]]);
  }
  for (const malformed of [{ day_offset: 2, time: "10:00" }, { day_offset: 0, time: "24:00" }, { day_offset: 0, time: "9:00" }, { day_offset: 0 }, { day_offset: 0, time: "10:00", extra: 1 }]) {
    const res = await quote([stop(malformed)]);
    assert.deepEqual([res.status, res.body.error?.code], [400, "VALIDATION_FAILED"], JSON.stringify(malformed));
  }
  for (const [arriveBy, serviceLocal] of [
    [{ day_offset: 0, time: "08:01" }, SERVICE_LOCAL],
    [{ day_offset: 1, time: "08:00" }, SERVICE_LOCAL],
    [{ day_offset: 1, time: "01:00" }, "2026-10-20T20:00"],
  ] as const) {
    const res = await quote([stop(arriveBy)], serviceLocal);
    assert.equal(res.status, 200, `${JSON.stringify(arriveBy)} ${res.text}`);
  }
});

test("不影响价格：带不带 arrive_by 同一价、同一档；快照只在给了的经停上有 arrive_by，不给时没有这个键", async () => {
  tag += 1;
  const plain = [at("k", "河口湖", 35.5, 138.77), at("h", "箱根", 35.23, 139.1)];
  const fixed = [plain[0] as Stop, { ...(plain[1] as Stop), arrive_by: { day_offset: 0 as const, time: "13:00" } }];
  const [a, b] = [await quote(plain), await quote(fixed)];
  assert.equal(a.status, 200, a.text);
  assert.equal(b.status, 200, b.text);
  assertMatchesOpenApi("POST", "/site/v1/quotes", b);
  assert.deepEqual(b.body.quotes.map((q: any) => [q.vehicle_group.id, q.package?.hours, q.price.total.amount]), a.body.quotes.map((q: any) => [q.vehicle_group.id, q.package?.hours, q.price.total.amount]));
  assert.deepEqual(b.body.itinerary_route, a.body.itinerary_route);
  assert.equal(b.body.quotes[0].stop_occupancy_minutes, 0, "没设每站占用");
  const snapshot = async (id: string) => (await api.db.owner.query("select snapshot from quotes where id = $1", [id])).rows[0].snapshot;
  const before = (await snapshot(a.body.quotes[0].quote_id)).request.waypoints;
  assert.ok(before.every((stop: Record<string, unknown>) => !("arrive_by" in stop)), "不给时快照里没有 arrive_by");
  const after = (await snapshot(b.body.quotes[0].quote_id)).request.waypoints;
  assert.equal("arrive_by" in after[0], false);
  assert.deepEqual(after[1].arrive_by, { day_offset: 0, time: "13:00" });
  // 询价日志只记坐标（回放用），不记到达时间
  const logged = await api.db.owner.query("select request from quote_logs order by created_at desc limit 1");
  assert.doesNotMatch(JSON.stringify(logged.rows[0]?.request), /arrive_by/);
});

async function placeAndPay(quoteId: string): Promise<{ orderId: string; token: string; body: any }> {
  const created = await site.call("POST", "/site/v1/orders", { headers: { "idempotency-key": randomUUID() }, body: { quote_id: quoteId, passenger: PASSENGER, save_payment_method: true, pickup_address: "新宿站", dropoff_address: "新宿站" }, ip: nextIp() });
  assert.equal(created.status, 201, created.text);
  assertMatchesOpenApi("POST", "/site/v1/orders", created);
  const orderId = created.body.order.id as string;
  const intent = pay.intentOf(orderId);
  assert.ok(intent);
  pay.pay(intent.id);
  const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
  assert.equal((await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()))).status, 200);
  return { orderId, token: created.body.link.token as string, body: created.body };
}

test("下单：arrive_by 抄进订单；官网订单页、供应商、运营、司机页都有（跨午夜照写次日）；渠道接口去掉、仍符合接口说明", async () => {
  tag += 1;
  const evening = "2026-10-20T20:00";
  const stops = [at("k", "河口湖", 35.5, 138.77, { day_offset: 0, time: "22:30" }), at("h", "箱根", 35.23, 139.1, { day_offset: 1, time: "01:00" }), at("y", "横滨", 35.45, 139.63)];
  const quoted = await quote(stops, evening);
  assert.equal(quoted.status, 200, quoted.text);
  const { orderId, token, body } = await placeAndPay(quoted.body.quotes[0].quote_id);
  const expected = stops.map(({ ref: _ref, ...stop }) => stop);
  assert.deepEqual(body.order.waypoints, expected);
  const row = await api.db.owner.query<{ waypoints: unknown }>("select waypoints from orders where id = $1", [orderId]);
  assert.deepEqual(row.rows[0]?.waypoints, expected);

  const view = await site.call("GET", "/site/v1/order", { token, ip: nextIp() });
  assertMatchesOpenApi("GET", "/site/v1/order", view);
  assert.deepEqual(view.body.order.waypoints, expected);

  const tenant = await tenantCall(m.b, "GET", `/orders/${orderId}`);
  assertMatchesOpenApi("GET", "/tenant/v1/orders/{id}", tenant);
  assert.deepEqual(tenant.body.order.waypoints, expected);
  assert.equal((await tenantCall(m.a, "GET", `/orders/${orderId}`)).status, 404, "甲读不到乙的单");

  const platform = await api.call("GET", `/platform/v1/orders/${orderId}`, { token: m.root });
  assertMatchesOperation("GET", "/platform/v1/orders/{id}", platform.status, platform.body);
  assert.deepEqual(platform.body.order.waypoints, expected);

  const who = { ...m.b, adminToken: await tenantLogin(api, m.b.adminEmail) };
  const link = await ok(assign(api, who, orderId, (await newDriver(api, who)).id, (await newVehicle(api, who, m.ids.biz7)).id));
  const trip = await api.call("GET", "/driver/v1/trip", { token: link.driver_link.token });
  assertMatchesOpenApi("GET", "/driver/v1/trip", trip);
  assert.deepEqual(trip.body.order.waypoints, expected);

  // 渠道接口（/sales/v1）本期不开放 arrive_by：官网渠道用渠道凭证读这一单也没有，其余经停信息照旧
  const salesToken = (await ok(api.call("POST", "/sales/v1/oauth/token", { ip: "198.51.100.10", body: { grant_type: "client_credentials", client_id: sales.clientId, client_secret: sales.secret } }))).access_token;
  const channelView = await api.call("GET", `/sales/v1/orders/${orderId}`, { token: salesToken, ip: "198.51.100.10" });
  assertMatchesOpenApi("GET", "/sales/v1/orders/{id}", channelView);
  assert.equal(channelView.status, 200, channelView.text);
  assert.deepEqual(channelView.body.order.waypoints, expected.map(({ arrive_by: _arriveBy, ...stop }) => stop));
});

test("顺序建议：带 arrive_by 的经停是固定点——切成两段各问一次谷歌，固定点留在原位、段内各自重排；改到达时刻请求键变、不再调谷歌", async () => {
  tag += 1;
  // 新宿 →［箱根、河口湖］→ 横滨（11:00 前）→［东京站、镰仓］→ 新宿：两段都故意绕路
  const stops = [
    at("hakone", "箱根", 35.23, 139.1),
    at("kawaguchiko", "河口湖", 35.5, 138.77),
    at("yokohama", "横滨", 35.45, 139.63, { day_offset: 0, time: "11:00" }),
    at("tokyo", "东京站", 35.68, 139.77),
    at("kamakura", "镰仓", 35.32, 139.55),
  ];
  const current = await quote(stops);
  assert.equal(current.status, 200, current.text);
  const calls = optimizeCalls().length;
  const res = await suggest(stops, current.body.quotes[0].quote_id);
  const s = res.body.suggestion;
  assert.ok(s !== null, res.text);
  assert.deepEqual(s.order, ["kawaguchiko", "hakone", "yokohama", "kamakura", "tokyo"], "横滨留在第 3 个，两边各自重排");
  assert.equal(optimizeCalls().length, calls + 2, "两段各问一次");
  const sent = optimizeCalls().slice(-2).map((request) => JSON.parse(request.body) as { origin: { location: { latLng: { latitude: number } } }; destination: { location: { latLng: { latitude: number } } }; intermediates: unknown[] });
  const yokohama = stops[2] as Stop;
  const lat = (value: number): string => value.toFixed(3);
  const ends = sent.map((body) => `${lat(body.origin.location.latLng.latitude)}→${lat(body.destination.location.latLng.latitude)}×${body.intermediates.length}`).sort();
  assert.deepEqual(ends, [`${lat(SHINJUKU.lat)}→${lat(yokohama.lat)}×2`, `${lat(yokohama.lat)}→${lat(SHINJUKU.lat)}×2`].sort(), "固定点是两段的端点，不在中间点里");
  assert.equal(s.request_key, suggestionRequestKey({ pickup: SHINJUKU, dropoff: SHINJUKU, waypoints: stops, service_local: SERVICE_LOCAL, passengers: 2, luggage: 1, addons: [], package_hours: null }));
  // 建议报价的快照按建议顺序，横滨仍带着到达时间
  const snapshot = (await api.db.owner.query("select snapshot from quotes where id = $1", [s.quote_result.quotes[0].quote_id])).rows[0].snapshot;
  assert.deepEqual(snapshot.request.waypoints.map((stop: { name: string; arrive_by?: unknown }) => [stop.name, stop.arrive_by ?? null]), [["河口湖", null], ["箱根", null], ["横滨", { day_offset: 0, time: "11:00" }], ["镰仓", null], ["东京站", null]]);

  // 改到达时刻：点集合和固定点没变，命中缓存不调谷歌；请求键变、建议顺序一样
  const later = stops.map((stop) => (stop.ref === "yokohama" ? { ...stop, arrive_by: { day_offset: 0 as const, time: "12:00" } } : stop));
  const again = await suggest(later, (await quote(later)).body.quotes[0].quote_id);
  assert.equal(optimizeCalls().length, calls + 2, "没再调谷歌");
  assert.deepEqual(again.body.suggestion?.order, s.order);
  assert.notEqual(again.body.suggestion.request_key, s.request_key);
});

test("顺序建议：固定点两边各只有 1 个经停时不调谷歌（NOT_APPLICABLE）", async () => {
  tag += 1;
  const stops = [at("hakone", "箱根", 35.23, 139.1), at("yokohama", "横滨", 35.45, 139.63, { day_offset: 0, time: "11:00" }), at("kawaguchiko", "河口湖", 35.5, 138.77)];
  const current = await quote(stops);
  assert.equal(current.status, 200, current.text);
  const calls = optimizeCalls().length;
  const res = await suggest(stops, current.body.quotes[0].quote_id);
  assert.deepEqual(res.body, { suggestion: null, reason: "NOT_APPLICABLE" });
  assert.equal(optimizeCalls().length, calls);
});
