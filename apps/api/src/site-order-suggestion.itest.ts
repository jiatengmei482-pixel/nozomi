/**
 * M9P-20 P2：包车经停顺序建议 `POST /site/v1/charter/order-suggestion`（ADR 0096 第三节），经真实接口、真实 PostgreSQL；
 * 谷歌的优化调用是本机的假服务器（按直线距离穷举出最短顺序），报价的逐段路线是替身（直线距离，每公里 1 分钟），**从不调用真实的谷歌**。
 *
 * 覆盖：
 * - 请求：每段一次 computeRoutes + optimizeWaypointOrder、TRAFFIC_UNAWARE、字段掩码只要 optimizedIntermediateWaypointIndex；名额计入优化的每日上限；
 * - 成立时：建议顺序按经停标识回传、省的米数和分钟、建议报价（有编号和有效期）、请求键和 domain 同一个函数；
 * - 缓存：同一组点换顺序、改停留都不再调谷歌；改停留后建议报价按新停留重算、请求键跟着变；
 * - 不成立 / 不适用：已经是最优顺序（SAME_ORDER）、只有 1 个经停（400）；
 * - 防刷：没带报价、报价过期、经停点和报价对不上 → 400 SUGGESTION_NEEDS_QUOTE、不调谷歌；按会话每分钟 5 次只数要调谷歌的请求；
 * - 上限：GOOGLE_ROUTES_OPTIMIZE_DAILY_LIMIT=0 不调、UNAVAILABLE，报价照常；
 * - 商品开关 charter_itinerary.suggest_stop_order：默认开、关了不调谷歌（DISABLED）、PUT 不带键保留原值。
 * 测试数据全在本文件里经接口建出来，随测试 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type LatLng, type RouteLookup, haversineMeters, routeUsageDay, suggestionRequestKey } from "@nozomi/domain";
import type { ApiResponse, HttpMethod, TenantFixture, TestApi } from "./testing/api.ts";
import { createTestApi } from "./testing/api.ts";
import { type FakeService, startFakeGoogleRoutes } from "./testing/fake-integrations.ts";
import { type Market, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let routes: FakeService;
let site: SiteApi;
let clientId: string;
let productId: string;
const opened: SiteApi[] = [];

const square = (west: number, south: number, east: number, north: number) => ({ type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] });
const SHINJUKU = { lat: 35.69, lng: 139.7 };
const SERVICE_LOCAL = "2026-10-20T08:00";
let ipSeq = 0;
const nextIp = (): string => `10.94.${Math.floor((ipSeq += 1) / 200)}.${ipSeq % 200}`;
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
const usage = async (): Promise<number> => ((await api.db.owner.query("select calls from route_optimize_api_usage where day = $1", [routeUsageDay(api.clock.now())])).rows[0]?.calls as number | undefined) ?? 0;

async function tenantCall(who: TenantFixture, method: HttpMethod, path: string, options: { body?: unknown; version?: number } = {}): Promise<ApiResponse> {
  const token = await tenantLogin(api, who.adminEmail);
  api.clock.advance(1_000);
  return api.call(method, `/tenant/v1${path}`, {
    token,
    ...(options.body === undefined ? {} : { body: options.body }),
    headers: { ...(options.version === undefined ? {} : { "if-match": `"${options.version}"` }), ...(method === "POST" && /^\/(products|brands|areas)$|\/price-rules(\/batch)?$/.test(path) ? { "idempotency-key": randomUUID() } : {}) },
  });
}

async function newCharter(who: TenantFixture): Promise<string> {
  const area = (await ok(tenantCall(who, "POST", "/areas", { body: { city_id: m.ids.tokyo, name: { zh: "关东" }, biz_type: "charter", polygons: [{ kind: "operate", geometry: square(138.4, 34.9, 140.3, 36.2) }] } }), 201)).id;
  const brand = (await ok(tenantCall(who, "POST", "/brands", { body: { name: `包车-${randomUUID().slice(0, 6)}`, currency: "JPY" } }), 201)).id;
  const created = await ok(tenantCall(who, "POST", "/products", { body: { brand_id: brand, city_id: m.ids.tokyo, category: "charter", areas: [{ area_id: area }], vehicle_groups: [{ vehicle_group_id: m.ids.biz7, passengers: 6, luggage: 4 }], dispatchers: [{ name: "调度", phone: "0312345678" }] } }), 201);
  const rules = await ok(tenantCall(who, "PUT", `/products/${created.id}/service-rules`, { version: 1, body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { general: { mode: "limited", minutes: 0 } } } }));
  const content = await ok(tenantCall(who, "PUT", `/products/${created.id}/content`, { version: rules.version, body: { zh: { title: "关东包车" } } }));
  const pkg = (hours: number, price: number) => ({ area_id: area, vehicle_group_id: m.ids.biz7, package_hours: hours, pricing_model: "charter_package", package_km: 200, package_price: price, overtime_per_hour: 6_000, over_km_per_km: 500, valid_from: "2026-01-01" });
  await ok(tenantCall(who, "POST", `/products/${created.id}/price-rules/batch`, { version: content.version, body: { create: [pkg(8, 50_000), pkg(10, 60_000), pkg(12, 70_000)] } }));
  await ok(tenantCall(who, "POST", `/products/${created.id}/publish`));
  return created.id;
}

const openSite = async (env: Record<string, string> = {}): Promise<SiteApi> => {
  const app = await siteApi(api, clientId, pay, { GOOGLE_MAPS_ROUTES_URL: routes.url, ...env }, { integrationSecretsTtlMs: 0, quote: { routes: { estimate: routeLookup } } });
  opened.push(app);
  return app;
};

before(async () => {
  routes = await startFakeGoogleRoutes();
  routes.respond(optimizeReply);
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay, quote: { routes: { estimate: routeLookup } } });
  m = await buildMarket(api);
  productId = await newCharter(m.b);
  const channel = await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" });
  clientId = (await salesCredentials(api, m, channel.id)).clientId;
  site = await openSite();
  api.clock.advance(31_000);
});
after(async () => {
  for (const app of opened) await app.close();
  await api.close();
  await routes.close();
});

interface Stop {
  ref: string;
  name: string;
  lat: number;
  lng: number;
  stay_minutes: number;
}
/** 每个用例自己的一组点（缓存是共用的）：河口湖、横滨、箱根附近，按「绕路」的顺序排 */
function badOrder(stay = 60): Stop[] {
  tag += 1;
  const d = tag * 0.001;
  return [
    { ref: "kawaguchiko", name: "河口湖", lat: 35.5 + d, lng: 138.77, stay_minutes: stay },
    { ref: "yokohama", name: "横滨", lat: 35.45 + d, lng: 139.63, stay_minutes: stay },
    { ref: "hakone", name: "箱根", lat: 35.23 + d, lng: 139.1, stay_minutes: stay },
  ];
}
const quoteBody = (stops: readonly Stop[]) => ({ category: "charter", city_id: m.ids.tokyo, itinerary_pricing: true, pickup: SHINJUKU, dropoff: SHINJUKU, waypoints: stops.map(({ ref: _ref, ...stop }) => stop), service_local: SERVICE_LOCAL, passengers: 2, luggage: 1 });

async function quote(stops: readonly Stop[], app: SiteApi = site): Promise<ApiResponse> {
  api.clock.advance(1_000);
  const res = await app.call("POST", "/site/v1/quotes", { body: quoteBody(stops), ip: nextIp() });
  assert.equal(res.status, 200, res.text);
  return res;
}
async function suggest(stops: readonly Stop[], basis: { quote_id?: string; inquiry_ref?: string }, options: { app?: SiteApi; session?: string } = {}): Promise<ApiResponse> {
  const res = await (options.app ?? site).call("POST", "/site/v1/charter/order-suggestion", { body: { quote: quoteBody(stops), refs: stops.map((stop) => stop.ref), ...basis, session: options.session ?? `sess-${randomUUID()}` }, ip: nextIp() });
  assertMatchesOpenApi("POST", "/site/v1/charter/order-suggestion", res);
  return res;
}

test("成立：一次 computeRoutes + optimizeWaypointOrder，按经停标识回传建议顺序、省的米数和分钟、建议报价；请求键和 domain 同一个函数；占 1 个优化名额", async () => {
  const stops = badOrder();
  const current = await quote(stops);
  const before = optimizeCalls().length;
  const used = await usage();
  const res = await suggest(stops, { quote_id: current.body.quotes[0].quote_id });
  assert.equal(res.status, 200, res.text);
  const s = res.body.suggestion;
  assert.ok(s !== null, JSON.stringify(res.body));
  assert.deepEqual([...s.order].sort(), ["hakone", "kawaguchiko", "yokohama"], "按经停标识回传、一个不少");
  assert.notDeepEqual(s.order, ["kawaguchiko", "yokohama", "hakone"]);
  assert.ok(s.itinerary_route.total_meters < current.body.itinerary_route.total_meters);
  assert.ok(s.saved_meters >= 5_000 || s.saved_minutes >= 10, JSON.stringify(s));
  assert.equal(s.saved_meters, current.body.itinerary_route.total_meters - s.itinerary_route.total_meters);
  assert.equal(s.current_itinerary_route.total_meters, current.body.itinerary_route.total_meters, "和当前报价同一口径");
  assert.deepEqual(s.thresholds, { min_saved_meters: 5_000, min_saved_minutes: 10 });
  assert.equal(s.current_too_long, false);
  assert.equal(s.request_key, suggestionRequestKey({ pickup: SHINJUKU, dropoff: SHINJUKU, waypoints: stops, service_local: SERVICE_LOCAL, passengers: 2, luggage: 1, addons: [], package_hours: null }));
  const suggested = s.quote_result.quotes[0];
  assert.match(suggested.quote_id, /^QT/);
  assert.notEqual(suggested.quote_id, current.body.quotes[0].quote_id);
  assert.ok(Date.parse(suggested.expires_at) >= Date.parse(current.body.quotes[0].expires_at), "建议报价晚生成、晚过期");
  // 建议报价的快照按建议顺序（下单就按它）；经停标识不进快照
  const snapshot = (await api.db.owner.query("select snapshot from quotes where id = $1", [suggested.quote_id])).rows[0].snapshot;
  assert.deepEqual(snapshot.request.waypoints.map((stop: { name: string }) => stop.name), s.order.map((ref: string) => stops.find((stop) => stop.ref === ref)?.name));
  assert.doesNotMatch(JSON.stringify(snapshot), /kawaguchiko|yokohama|hakone/);
  // 请求
  assert.equal(optimizeCalls().length, before + 1);
  const sent = JSON.parse(optimizeCalls().at(-1)?.body ?? "{}");
  assert.deepEqual([sent.optimizeWaypointOrder, sent.routingPreference, sent.travelMode, sent.intermediates.length], [true, "TRAFFIC_UNAWARE", "DRIVE", 3]);
  assert.ok(sent.intermediates.every((point: Record<string, unknown>) => !("via" in point)), "优化不能有 via 点");
  assert.equal(await usage(), used + 1);
});

test("缓存：同一组点换顺序、改停留都不再调谷歌；改停留后建议报价按新停留重算、请求键变；已经是建议顺序时 SAME_ORDER", async () => {
  const stops = badOrder();
  const first = await suggest(stops, { quote_id: (await quote(stops)).body.quotes[0].quote_id });
  const order: string[] = first.body.suggestion.order;
  const calls = optimizeCalls().length;
  // 客人换成另一种顺序（不是建议顺序）：命中缓存
  const shuffled = [stops[1], stops[0], stops[2]] as Stop[];
  const again = await suggest(shuffled, { quote_id: (await quote(shuffled)).body.quotes[0].quote_id });
  assert.deepEqual(again.body.suggestion?.order ?? null, order);
  // 改停留：命中缓存，建议报价按新停留
  const longer = stops.map((stop) => ({ ...stop, stay_minutes: 120 }));
  const restay = await suggest(longer, { quote_id: (await quote(longer)).body.quotes[0].quote_id });
  assert.notEqual(restay.body.suggestion.request_key, first.body.suggestion.request_key);
  const snapshot = (await api.db.owner.query("select snapshot from quotes where id = $1", [restay.body.suggestion.quote_result.quotes[0].quote_id])).rows[0].snapshot;
  assert.deepEqual(snapshot.request.waypoints.map((stop: { stay_minutes: number }) => stop.stay_minutes), [120, 120, 120]);
  // 已经排成建议顺序
  const best = order.map((ref) => stops.find((stop) => stop.ref === ref) as Stop);
  const same = await suggest(best, { quote_id: (await quote(best)).body.quotes[0].quote_id });
  assert.deepEqual(same.body, { suggestion: null, reason: "SAME_ORDER" });
  assert.equal(optimizeCalls().length, calls, "都没再调谷歌");
});

test("防刷：没带报价、报价过期、经停点和报价对不上 → 400 SUGGESTION_NEEDS_QUOTE，不调谷歌；只有 1 个经停 400", async () => {
  const stops = badOrder();
  const current = await quote(stops);
  const calls = optimizeCalls().length;
  const none = await suggest(stops, {});
  assert.deepEqual([none.status, none.body.error.code], [400, "SUGGESTION_NEEDS_QUOTE"]);
  const other = badOrder();
  const mismatch = await suggest(other, { quote_id: current.body.quotes[0].quote_id });
  assert.deepEqual([mismatch.status, mismatch.body.error.code], [400, "SUGGESTION_NEEDS_QUOTE"]);
  const fake = await suggest(stops, { quote_id: "QT20990101000000000000" });
  assert.deepEqual([fake.status, fake.body.error.code], [400, "SUGGESTION_NEEDS_QUOTE"]);
  const inquiry = await suggest(stops, { inquiry_ref: randomUUID() });
  assert.deepEqual([inquiry.status, inquiry.body.error.code], [400, "SUGGESTION_NEEDS_QUOTE"]);
  const single = stops.slice(0, 1);
  const one = await site.call("POST", "/site/v1/charter/order-suggestion", { body: { quote: quoteBody(single), refs: ["a"], quote_id: current.body.quotes[0].quote_id, session: "sess-12345678" }, ip: nextIp() });
  assert.equal(one.status, 400);
  api.clock.advance(31 * 60_000);
  const expired = await suggest(stops, { quote_id: current.body.quotes[0].quote_id });
  assert.deepEqual([expired.status, expired.body.error.code], [400, "SUGGESTION_NEEDS_QUOTE"]);
  assert.equal(optimizeCalls().length, calls, "都没调谷歌");
});

test("按会话限频只数要调谷歌的请求：同一会话每分钟 5 次，第 6 组新点 RATE_LIMITED（报价照常）；缓存命中不计", async () => {
  const session = `sess-${randomUUID()}`;
  for (let i = 0; i < 5; i++) {
    const stops = badOrder();
    const res = await suggest(stops, { quote_id: (await quote(stops)).body.quotes[0].quote_id }, { session });
    assert.ok(res.body.suggestion !== null, `第 ${i + 1} 次：${res.text}`);
    // 同一组点再来一次（缓存命中）：不计
    const hit = await suggest(stops, { quote_id: (await quote(stops)).body.quotes[0].quote_id }, { session });
    assert.ok(hit.body.suggestion !== null, hit.text);
  }
  const sixth = badOrder();
  const res = await suggest(sixth, { quote_id: (await quote(sixth)).body.quotes[0].quote_id }, { session });
  assert.deepEqual(res.body, { suggestion: null, reason: "RATE_LIMITED" });
  const other = await suggest(sixth, { quote_id: (await quote(sixth)).body.quotes[0].quote_id });
  assert.ok(other.body.suggestion !== null, "换个会话照常");
});

test("优化的每日上限 0：不调谷歌、UNAVAILABLE；和路线的每日上限分开", async () => {
  const capped = await openSite({ GOOGLE_ROUTES_OPTIMIZE_DAILY_LIMIT: "0" });
  const stops = badOrder();
  const current = await quote(stops, capped);
  const calls = optimizeCalls().length;
  const res = await suggest(stops, { quote_id: current.body.quotes[0].quote_id }, { app: capped });
  assert.deepEqual(res.body, { suggestion: null, reason: "UNAVAILABLE" });
  assert.equal(optimizeCalls().length, calls);
});

test("商品开关：匹配到的商品全关了不调谷歌（DISABLED），报价照常", async () => {
  // 改服务规则会让商品回到待审核：这里直接改上架版本的开关（模拟审核通过后的状态），只核对询价路径
  await api.db.owner.query(`update products set service_rules = jsonb_set(service_rules, '{charterItinerary}', coalesce(service_rules->'charterItinerary', '{}'::jsonb) || '{"suggestStopOrder": false}'::jsonb) where id = $1`, [productId]);
  api.clock.advance(31_000);
  try {
    const stops = badOrder();
    const current = await quote(stops);
    assert.ok(current.body.quotes.length > 0, "报价照常");
    const calls = optimizeCalls().length;
    const res = await suggest(stops, { quote_id: current.body.quotes[0].quote_id });
    assert.deepEqual(res.body, { suggestion: null, reason: "DISABLED" });
    assert.equal(optimizeCalls().length, calls);
  } finally {
    await api.db.owner.query("update products set service_rules = service_rules #- '{charterItinerary,suggestStopOrder}' where id = $1", [productId]);
    api.clock.advance(31_000);
  }
});

test("商品开关 suggest_stop_order 的读写：读默认开；能关；PUT 不带键保留原值；甲读不到乙的商品", async () => {
  const read = async () => (await ok(tenantCall(m.b, "GET", `/products/${productId}/service-rules`))).rules.charter_itinerary.suggest_stop_order;
  assert.equal(await read(), true);
  const current = await ok(tenantCall(m.b, "GET", `/products/${productId}/service-rules`));
  const { charter_itinerary: itinerary, ...rules } = current.rules;
  const off = await tenantCall(m.b, "PUT", `/products/${productId}/service-rules`, { version: current.version, body: { ...rules, charter_itinerary: { ...itinerary, suggest_stop_order: false } } });
  assertMatchesOpenApi("PUT", "/tenant/v1/products/{id}/service-rules", off);
  assert.equal(off.status, 200, off.text);
  assert.equal(await read(), false);
  const kept = await ok(tenantCall(m.b, "GET", `/products/${productId}/service-rules`));
  const { charter_itinerary: _drop, ...withoutKey } = kept.rules;
  await ok(tenantCall(m.b, "PUT", `/products/${productId}/service-rules`, { version: kept.version, body: withoutKey }));
  assert.equal(await read(), false, "不带键保留原值");
  const other = await tenantCall(m.a, "GET", `/products/${productId}/service-rules`);
  assert.equal(other.status, 404, "甲读不到乙的商品");
});
