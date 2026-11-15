/**
 * M9P-10（规格 docs/requirements/charter-pricing-spec-2026-11-14.md 步骤 2、步骤 5，差异表第 10、11 条；ADR 0098），经真实接口、真实 PostgreSQL：
 * - 服务规则 `charter_itinerary.warn_minutes` / `warn_km`（超限提醒线，默认 12 小时 / 360 公里）：读写、只存和默认不同的项、范围、只有包车能设、甲读不到改不了乙的；
 * - 官网按行程计价的报价带 `itinerary_warnings`：T（含缓冲）大于提醒线 → LONG_DURATION，全程大于提醒公里数 → LONG_DISTANCE，正好等于不提醒，
 *   阈值按商品；超了仍报价、可以下单（用例「新宿 → 镰仓 → 日光 → 新宿 454 公里」）；没按行程计价的为 null；
 * - 用例 13：预计用时 13h30m 不在线报价（ITINERARY_TOO_LONG）；
 * - 经停点上限 25 个（路径接口一次最多 25 个中间点）：25 个照常逐段估路线、报价，26 个 400 并提示联系客服定制；人工报价同一上限。
 * 测试数据全在本文件里经接口建出来，随测试 schema 一起删除（规则 1）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { CHARTER_ITINERARY_LIMITS, type LatLng, type RouteLookup } from "@nozomi/domain";
import type { ApiResponse, HttpMethod, TenantFixture, TestApi } from "./testing/api.ts";
import { createTestApi } from "./testing/api.ts";
import { type Market, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

let api: TestApi;
let m: Market;
let site: SiteApi;
let charter: string;

const square = (west: number, south: number, east: number, north: number) => ({ type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] });
const P = {
  shinjuku: { lng: 139.7, lat: 35.69 },
  asakusa: { lng: 139.7967, lat: 35.7148 },
  tsurugaoka: { lng: 139.5565, lat: 35.3259 },
} satisfies Record<string, LatLng>;
const SERVICE_LOCAL = "2026-10-20T10:00";
let ipSeq = 0;
const nextIp = (): string => `10.95.${(ipSeq += 1)}.9`;

/** 路线替身：每段 `leg.meters` 米、`leg.minutes` 分钟；`legMeters` 给了时按段号（从 0 起）取米数 */
const leg: { meters: number; minutes: number; legMeters: number[] | null } = { meters: 30_000, minutes: 70, legMeters: null };
let routeCalls = 0;
const routeLookup = async (): Promise<RouteLookup> => {
  const index = routeCalls;
  routeCalls += 1;
  return { ok: true, route: { meters: leg.legMeters?.[index] ?? leg.meters, minutes: leg.minutes }, source: "google" };
};

async function tenantCall(who: TenantFixture, method: HttpMethod, path: string, options: { body?: unknown; version?: number } = {}): Promise<ApiResponse> {
  const token = await tenantLogin(api, who.adminEmail);
  api.clock.advance(1_000);
  return api.call(method, `/tenant/v1${path}`, {
    token,
    ...(options.body === undefined ? {} : { body: options.body }),
    headers: { ...(options.version === undefined ? {} : { "if-match": `"${options.version}"` }), ...(method === "POST" && /^\/(products|brands|areas)$|\/price-rules(\/batch)?$/.test(path) ? { "idempotency-key": randomUUID() } : {}) },
  });
}

/** 乙的东京包车：4h / 5h / 10h / 12h，市内（东京）和镰仓（行程加价 8,000）两个区域 */
async function newCharter(who: TenantFixture): Promise<string> {
  const area = async (name: string, polygon: ReturnType<typeof square>): Promise<string> => (await ok(tenantCall(who, "POST", "/areas", { body: { city_id: m.ids.tokyo, name: { zh: name }, biz_type: "charter", polygons: [{ kind: "operate", geometry: polygon }] } }), 201)).id;
  const tokyo = await area("东京市内", square(139.55, 35.52, 139.95, 35.85));
  const kamakura = await area("镰仓", square(139.5, 35.28, 139.6, 35.35));
  const brand = (await ok(tenantCall(who, "POST", "/brands", { body: { name: `包车-${randomUUID().slice(0, 6)}`, currency: "JPY" } }), 201)).id;
  const created = await ok(tenantCall(who, "POST", "/products", { body: { brand_id: brand, city_id: m.ids.tokyo, category: "charter", areas: [{ area_id: tokyo }], vehicle_groups: [{ vehicle_group_id: m.ids.biz7, passengers: 6, luggage: 4 }], dispatchers: [{ name: "调度", phone: "0312345678" }] } }), 201);
  const rules = await ok(tenantCall(who, "PUT", `/products/${created.id}/service-rules`, { version: 1, body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { general: { mode: "limited", minutes: 0 } } } }));
  const content = await ok(tenantCall(who, "PUT", `/products/${created.id}/content`, { version: rules.version, body: { zh: { title: "东京包车" } } }));
  const rows = ([[4, 28_000, 120], [5, 33_000, 150], [10, 55_000, 300], [12, 66_000, 360]] as const).flatMap(([hours, price, km]) => [
    { area_id: tokyo, vehicle_group_id: m.ids.biz7, package_hours: hours, pricing_model: "charter_package", package_km: km, package_price: price, overtime_per_hour: 6_000, over_km_per_km: 500, valid_from: "2026-01-01" },
    { area_id: kamakura, vehicle_group_id: m.ids.biz7, package_hours: hours, pricing_model: "charter_area_surcharge", pickup_surcharge: 8_000, dropoff_surcharge: 8_000, waypoint_surcharge: 8_000, valid_from: "2026-01-01" },
  ]);
  await ok(tenantCall(who, "POST", `/products/${created.id}/price-rules/batch`, { version: content.version, body: { create: rows } }));
  await ok(tenantCall(who, "POST", `/products/${created.id}/publish`));
  return created.id;
}

before(async () => {
  const pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay, quote: { routes: { estimate: routeLookup } } });
  m = await buildMarket(api);
  charter = await newCharter(m.b);
  const channel = await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" });
  site = await siteApi(api, (await salesCredentials(api, m, channel.id)).clientId, pay, {}, { quote: { routes: { estimate: routeLookup } } });
  api.clock.advance(31_000);
});
after(async () => {
  await site?.close();
  await api.close();
});

async function serviceRules(who: TenantFixture, productId: string): Promise<any> {
  const res = await tenantCall(who, "GET", `/products/${productId}/service-rules`);
  assertMatchesOpenApi("GET", "/tenant/v1/products/{id}/service-rules", res);
  assert.equal(res.status, 200, res.text);
  return res.body;
}
/** 只改 `charter_itinerary` 里给了的项；`expect` 不是 200 时原样返回应答 */
async function setItinerary(who: TenantFixture, productId: string, itinerary: Record<string, unknown>, expect = 200): Promise<ApiResponse> {
  const current = await serviceRules(m.b, productId);
  const { charter_itinerary: _kept, ...rules } = current.rules;
  const res = await tenantCall(who, "PUT", `/products/${productId}/service-rules`, { version: current.version, body: { ...rules, charter_itinerary: itinerary } });
  assert.equal(res.status, expect, res.text);
  if (expect === 200) assertMatchesOpenApi("PUT", "/tenant/v1/products/{id}/service-rules", res);
  api.clock.advance(31_000);
  return res;
}
const DEFAULTS = { dropoff_itinerary_surcharge: true, stop_occupancy_minutes: 0, buffer_minutes: 0, min_package_hours: null, max_online_minutes: 780, warn_minutes: 720, warn_km: 360 };
const RESET = { stop_occupancy_minutes: 0, buffer_minutes: 0, warn_minutes: 720, warn_km: 360 };

/** 官网按行程计价：新宿 → 经停（各停 `stay` 分钟）→ 新宿 */
async function quote(stops: (keyof typeof P)[], stay: number, extra: Record<string, unknown> = {}): Promise<ApiResponse> {
  api.clock.advance(1_000);
  routeCalls = 0;
  const waypoints = stops.map((stop, index) => ({ name: `景点 ${index + 1}`, ...P[stop], stay_minutes: stay }));
  return site.call("POST", "/site/v1/quotes", { body: { category: "charter", city_id: m.ids.tokyo, pickup: P.shinjuku, dropoff: P.shinjuku, waypoints, itinerary_pricing: true, service_local: SERVICE_LOCAL, passengers: 2, luggage: 1, ...extra }, ip: nextIp() });
}
async function quoted(stops: (keyof typeof P)[], stay: number): Promise<any> {
  const res = await quote(stops, stay);
  assertMatchesOpenApi("POST", "/site/v1/quotes", res);
  assert.equal(res.status, 200, res.text);
  return res.body;
}
const warningsOf = (body: any): unknown => body.quotes[0]?.itinerary_warnings;

test("服务规则：超限提醒线默认 12 小时 / 360 公里、不存键；只存改了的项；范围 400；甲读不到、改不了乙的；别的品类设不了", async () => {
  const fresh = await serviceRules(m.b, charter);
  assert.deepEqual(fresh.rules.charter_itinerary, DEFAULTS);
  const stored = async (): Promise<unknown> => (await api.db.owner.query<{ rules: any }>("select service_rules as rules from products where id = $1", [charter])).rows[0]?.rules.charterItinerary;
  assert.equal(await stored(), undefined);
  const set = await setItinerary(m.b, charter, { warn_minutes: 600, warn_km: 200 });
  assert.deepEqual(set.body.rules.charter_itinerary, { ...DEFAULTS, warn_minutes: 600, warn_km: 200 });
  assert.deepEqual(await stored(), { warnMinutes: 600, warnKm: 200 }, "只存和默认值不同的项");
  const bad = await setItinerary(m.b, charter, { warn_minutes: 59, warn_km: 5_001 }, 400);
  assert.deepEqual(bad.body.error.details.issues.map((issue: any) => [issue.path, issue.reason]), [["/charter_itinerary/warn_minutes", "OUT_OF_RANGE"], ["/charter_itinerary/warn_km", "OUT_OF_RANGE"]]);
  const fraction = await setItinerary(m.b, charter, { warn_minutes: 1_441, warn_km: 0.5 }, 400);
  assert.deepEqual(fraction.body.error.details.issues.map((issue: any) => [issue.path, issue.reason]), [["/charter_itinerary/warn_minutes", "OUT_OF_RANGE"], ["/charter_itinerary/warn_km", "NOT_INTEGER"]]);
  // 规则 2：甲读不到、改不了乙的
  assert.equal((await tenantCall(m.a, "GET", `/products/${charter}/service-rules`)).status, 404);
  assert.equal((await setItinerary(m.a, charter, { warn_km: 999 }, 404)).status, 404);
  assert.deepEqual(await stored(), { warnMinutes: 600, warnKm: 200 });
  // 别的品类设不了
  const transfer = (await ok(tenantCall(m.b, "GET", "/products"))).items.find((entry: any) => entry.category !== "charter");
  const transferRules = await serviceRules(m.b, transfer.id);
  const notCharter = await tenantCall(m.b, "PUT", `/products/${transfer.id}/service-rules`, { version: transferRules.version, body: { ...transferRules.rules, charter_itinerary: { warn_km: 100 } } });
  assert.deepEqual([notCharter.status, notCharter.body.error.details.issues.map((issue: any) => [issue.path, issue.reason])], [400, [["/charter_itinerary", "NOT_APPLICABLE"]]]);
  await setItinerary(m.b, charter, RESET);
  assert.equal(await stored(), undefined, "改回默认：不再存键");
});

test("超限提醒：T 大于 12 小时 LONG_DURATION、全程大于 360 公里 LONG_DISTANCE，正好等于不提醒；T 含缓冲；阈值按商品；没按行程计价为 null", async () => {
  // 两段各 300 分、100 公里，停 60 分 → T = 11 小时、200 公里
  Object.assign(leg, { minutes: 300, meters: 100_000, legMeters: null });
  assert.deepEqual(warningsOf(await quoted(["asakusa"], 60)), []);
  // 正好 12 小时、360 公里：不提醒（规格写「超过」）
  Object.assign(leg, { minutes: 330, meters: 180_000 });
  const edge = await quoted(["asakusa"], 60);
  assert.deepEqual([edge.quotes[0].estimated_minutes, edge.itinerary_route.total_meters, warningsOf(edge)], [720, 360_000, []]);
  // 多 1 分钟、多 1 米
  Object.assign(leg, { minutes: 330, meters: 180_000, legMeters: [180_001, 180_000] });
  const meter = await quoted(["asakusa"], 61);
  assert.deepEqual([meter.quotes[0].estimated_minutes, meter.itinerary_route.total_meters, warningsOf(meter)], [721, 360_001, ["LONG_DURATION", "LONG_DISTANCE"]]);
  assert.ok(meter.quotes[0].price.total.amount > 0, "只提醒，照常报价");
  // T 含缓冲：行驶 + 停留 11h、缓冲 61 分 → 12h01m
  Object.assign(leg, { minutes: 300, meters: 100_000, legMeters: null });
  await setItinerary(m.b, charter, { buffer_minutes: 61 });
  const buffered = await quoted(["asakusa"], 60);
  assert.deepEqual([buffered.quotes[0].estimated_minutes, buffered.quotes[0].includes_buffer, warningsOf(buffered)], [721, true, ["LONG_DURATION"]]);
  // 阈值按商品：提醒线调到 13 小时就不提醒；公里调到 150 就提醒距离
  await setItinerary(m.b, charter, { buffer_minutes: 61, warn_minutes: 780, warn_km: 150 });
  assert.deepEqual(warningsOf(await quoted(["asakusa"], 60)), ["LONG_DISTANCE"]);
  await setItinerary(m.b, charter, RESET);
  // 没按行程计价（不填经停、选套餐）：null
  api.clock.advance(1_000);
  const plain = await site.call("POST", "/site/v1/quotes", { body: { category: "charter", city_id: m.ids.tokyo, pickup: P.shinjuku, dropoff: P.shinjuku, package_hours: 4, service_local: SERVICE_LOCAL, passengers: 2, luggage: 1 }, ip: nextIp() });
  assert.equal(plain.status, 200, plain.text);
  assertMatchesOpenApi("POST", "/site/v1/quotes", plain);
  assert.equal(plain.body.quotes[0].itinerary_warnings, null);
});

test("规格用例「新宿 → 镰仓 → 日光 → 新宿 454 公里」：显示距离超限提醒，可以继续下单", async () => {
  // 三段 151 + 152 + 151 = 454 公里、各 150 分钟，经停各停 60 分 → T = 9h30m（不超用时）
  Object.assign(leg, { minutes: 150, meters: 151_000, legMeters: [151_000, 152_000, 151_000] });
  const body = await quoted(["tsurugaoka", "asakusa"], 60);
  assert.deepEqual([body.itinerary_route.total_meters, body.quotes[0].estimated_minutes, warningsOf(body)], [454_000, 570, ["LONG_DISTANCE"]]);
  const created = await site.call("POST", "/site/v1/orders", { headers: { "idempotency-key": randomUUID() }, body: { quote_id: body.quotes[0].quote_id, passenger: { name: "王小华", phone: "+81 90-5555-6666", email: "warning.guest@example.com" }, save_payment_method: true, pickup_address: "新宿站", dropoff_address: "新宿站" }, ip: nextIp() });
  assert.equal(created.status, 201, created.text);
});

test("用例 13：预计用时 13h30m 不允许在线下单（ITINERARY_TOO_LONG，转人工）", async () => {
  Object.assign(leg, { minutes: 375, meters: 100_000, legMeters: null });
  const body = await quoted(["asakusa"], 60);
  assert.deepEqual([body.quotes, body.unavailable], [[], [{ vehicle_group_id: null, reasons: ["ITINERARY_TOO_LONG"] }]]);
  assert.equal(body.itinerary_route.total_minutes, 810);
});

test("经停点上限 25 个（路径接口一次 25 个中间点）：25 个逐段估 26 段、照常报价；26 个 400 提示联系客服定制、不调路线；人工报价同一上限", async () => {
  assert.equal(CHARTER_ITINERARY_LIMITS.maxWaypoints, 25);
  // 每段 1 分钟、每处停 30 分钟 → 26 + 750 = 776 分钟（不到 13 小时，能报价；超过 12 小时，带提醒）
  Object.assign(leg, { minutes: 1, meters: 5_000, legMeters: null });
  const full = await quoted(Array.from({ length: 25 }, () => "asakusa" as const), 30);
  assert.deepEqual([full.itinerary_route.legs.length, routeCalls, full.quotes.length > 0, full.itinerary_route.total_minutes, warningsOf(full)], [26, 26, true, 776, ["LONG_DURATION"]]);
  // 25 个经停点的报价能下单，订单上的经停点 25 个（迁移 0510 放宽了 orders_waypoints_shape）
  const created = await site.call("POST", "/site/v1/orders", { headers: { "idempotency-key": randomUUID() }, body: { quote_id: full.quotes[0].quote_id, passenger: { name: "王小华", phone: "+81 90-5555-6666", email: "stops.guest@example.com" }, save_payment_method: true, pickup_address: "新宿站", dropoff_address: "新宿站" }, ip: nextIp() });
  assert.equal(created.status, 201, created.text);
  const stored = await api.db.owner.query<{ count: number }>("select jsonb_array_length(waypoints) as count from orders where id = $1", [created.body.order.id]);
  assert.equal(stored.rows[0]?.count, 25);
  const over = await quote(Array.from({ length: 26 }, () => "asakusa" as const), 30);
  assert.equal(over.status, 400, over.text);
  assertMatchesOpenApi("POST", "/site/v1/quotes", over);
  const issue = over.body.error.details.issues.find((entry: any) => entry.path === "/waypoints");
  assert.match(issue?.message ?? "", /最多 25 个.*联系客服定制/);
  assert.equal(routeCalls, 0, "超出上限不调路线");
});
