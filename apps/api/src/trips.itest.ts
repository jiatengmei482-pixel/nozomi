/**
 * M9T-03（ADR 0100 第三节）：官网行程报价接口，经真实接口、真实 PostgreSQL。
 * - 建单校验（跨字段原因、平台地点）、读单 404、OpenAPI；
 * - 两天行程：每一段的对外价 = 同样条件调官网询价的价（B2 加 export 后官网询价照旧，应答逐项一致）；一车到底 = 段之和 + 跨段费用；
 * - 过夜在③：住宿和两笔空驶加价按 D4 取低，跨段费用写进 trip_fees（含负数抵扣、规则版本），对客应答没有结算价、供应商编号；
 * - 报不出：一天的上下车点不在任何商品区域里 → 两个方案都报不出、记一条未覆盖需求；
 * - 重新报价重写方案；限频键独立。
 * 路线替身：每一段 50 公里、60 分钟。测试数据全在本文件里经接口建出来（规则 1）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { LatLng, RouteLookup } from "@nozomi/domain";
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
let charterId: string;

const square = (west: number, south: number, east: number, north: number) => ({ type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] });
const P = {
  shinjuku: { lat: 35.6905, lng: 139.7005 },
  asakusa: { lat: 35.7148, lng: 139.7967 },
  ginza: { lat: 35.6717, lng: 139.765 },
  ashinoko: { lat: 35.2, lng: 139.0 },
  kofu: { lat: 35.6622, lng: 138.5683 },
  nirasaki: { lat: 35.7086, lng: 138.4467 },
} satisfies Record<string, LatLng>;
const routeLookup = async (): Promise<RouteLookup> => ({ ok: true, route: { meters: 50_000, minutes: 60 }, source: "google" });
let ipSeq = 0;
const nextIp = (): string => `10.97.${(ipSeq += 1)}.9`;

async function tenantCall(who: TenantFixture, method: HttpMethod, path: string, options: { body?: unknown; version?: number } = {}): Promise<ApiResponse> {
  const token = await tenantLogin(api, who.adminEmail);
  api.clock.advance(1_000);
  return api.call(method, `/tenant/v1${path}`, {
    token,
    ...(options.body === undefined ? {} : { body: options.body }),
    headers: { ...(options.version === undefined ? {} : { "if-match": `"${options.version}"` }), ...(method === "POST" && /^\/(products|brands|areas)$|\/price-rules(\/batch)?$/.test(path) ? { "idempotency-key": randomUUID() } : {}) },
  });
}
async function newArea(who: TenantFixture, cityId: string, name: string, polygon: ReturnType<typeof square>): Promise<string> {
  return (await ok(tenantCall(who, "POST", "/areas", { body: { city_id: cityId, name: { zh: name }, biz_type: "charter", polygons: [{ kind: "operate", geometry: polygon }] } }), 201)).id;
}

before(async () => {
  api = await createTestApi({ payments: new FakePaymentProvider(), quote: { routes: { estimate: routeLookup } } });
  m = await buildMarket(api);
  const tokyo = await newArea(m.b, m.ids.tokyo, "东京市内", square(139.55, 35.52, 139.95, 35.82));
  const hakone = await newArea(m.b, m.ids.tokyo, "箱根", square(138.96, 35.15, 139.15, 35.28));
  const pkg = (hours: number, price: number) => ({ area_id: tokyo, vehicle_group_id: m.ids.biz7, package_hours: hours, pricing_model: "charter_package", package_km: 300, package_price: price, overtime_per_hour: 5_000, over_km_per_km: 500, valid_from: "2026-01-01" });
  const surcharge = (hours: number) => ({ area_id: hakone, vehicle_group_id: m.ids.biz7, package_hours: hours, pricing_model: "charter_area_surcharge", pickup_surcharge: 10_000, dropoff_surcharge: 10_000, waypoint_surcharge: 10_000, valid_from: "2026-01-01" });
  const brand = (await ok(tenantCall(m.b, "POST", "/brands", { body: { name: `行程包车-${randomUUID().slice(0, 6)}`, currency: "JPY" } }), 201)).id;
  const created = await ok(tenantCall(m.b, "POST", "/products", { body: { brand_id: brand, city_id: m.ids.tokyo, category: "charter", areas: [{ area_id: tokyo }], vehicle_groups: [{ vehicle_group_id: m.ids.biz7, passengers: 6, luggage: 4 }], dispatchers: [{ name: "调度", phone: "0312345678" }] } }), 201);
  const serviceRules = await ok(tenantCall(m.b, "PUT", `/products/${created.id}/service-rules`, { version: 1, body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { general: { mode: "limited", minutes: 0 } } } }));
  const content = await ok(tenantCall(m.b, "PUT", `/products/${created.id}/content`, { version: serviceRules.version, body: { zh: { title: "行程包车" } } }));
  await ok(tenantCall(m.b, "POST", `/products/${created.id}/price-rules/batch`, { version: content.version, body: { create: [pkg(5, 33_000), pkg(10, 55_000), surcharge(5), surcharge(10)] } }));
  await ok(tenantCall(m.b, "POST", `/products/${created.id}/publish`));
  charterId = created.id;
  const channel = await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" });
  site = await siteApi(api, (await salesCredentials(api, m, channel.id)).clientId, new FakePaymentProvider(), {}, { quote: { routes: { estimate: routeLookup } } });
});
after(async () => {
  await site?.close();
  await api.close();
});

const at = (place: keyof typeof P) => ({ lat: P[place].lat, lng: P[place].lng });
const start = (place: keyof typeof P, time = "09:00") => ({ kind: "start", place: at(place), time });
const stop = (place: keyof typeof P, stayMinutes = 60) => ({ kind: "stop", place: at(place), stayMinutes });
const end = (place: keyof typeof P) => ({ kind: "end", place: at(place) });
const trip = (days: unknown[]) => ({ schemaVersion: 1, party: { adults: 2, children: 0, luggage: 1 }, days });

async function createTrip(body: unknown, ip = nextIp()): Promise<ApiResponse> {
  api.clock.advance(1_000);
  const res = await site.call("POST", "/site/v1/trips", { body, ip });
  assertMatchesOpenApi("POST", "/site/v1/trips", res);
  return res;
}
async function quoteTrip(id: string, ip = nextIp()): Promise<ApiResponse> {
  api.clock.advance(1_000);
  const res = await site.call("POST", `/site/v1/trips/${id}/quote`, { ip });
  assertMatchesOpenApi("POST", "/site/v1/trips/{id}/quote", res);
  return res;
}
/** 同样条件的官网包车按行程计价询价（B2 加 export 之后的官网询价） */
async function officialCharter(serviceLocal: string, pickup: keyof typeof P, stops: (keyof typeof P)[], dropoff: keyof typeof P): Promise<ApiResponse> {
  api.clock.advance(1_000);
  const res = await site.call("POST", "/site/v1/quotes", { body: { category: "charter", itinerary_pricing: true, pickup: at(pickup), dropoff: at(dropoff), waypoints: stops.map((place, i) => ({ name: `经停 ${i + 1}`, ...at(place), stay_minutes: 60 })), service_local: serviceLocal, passengers: 2, luggage: 1 }, ip: nextIp() });
  assertMatchesOpenApi("POST", "/site/v1/quotes", res);
  assert.equal(res.status, 200, res.text);
  return res;
}
const sum = (amounts: string[]): number => amounts.reduce((total, amount) => total + Number(amount), 0);

test("建单：跨字段校验（出发点要时间、日期升序）、平台地点要是启用的机场 / 车站；读单：没报价时 plans 为空，编号不对 / 不存在一律 404", async () => {
  const bad = await createTrip(trip([{ date: "2027-03-02", items: [{ kind: "start", place: at("shinjuku") }, end("ginza")] }, { date: "2027-03-01", items: [start("ginza"), end("shinjuku")] }]));
  assert.equal(bad.status, 400, bad.text);
  const reasons = bad.body.error.details.issues.map((issue: any) => `${issue.path}:${issue.reason}`);
  assert.ok(reasons.includes("/days/0/items/0/time:TIME_REQUIRED"), reasons.join(","));
  assert.ok(reasons.includes("/days/1/date:NOT_ASCENDING"), reasons.join(","));
  const unknownPlace = await createTrip(trip([{ date: "2027-03-01", items: [{ kind: "arrive_flight", place: { placeId: randomUUID() }, time: "10:00" }, end("ginza")] }]));
  assert.equal(unknownPlace.status, 400, unknownPlace.text);
  assert.equal(unknownPlace.body.error.details.issues[0].reason, "UNKNOWN_PLACE");
  // 自由文字、司机语言不收
  assert.equal((await createTrip({ ...trip([{ date: "2027-03-01", items: [start("shinjuku"), end("ginza")] }]), note: "hi" })).status, 400);

  const created = await createTrip(trip([{ date: "2027-03-01", items: [start("shinjuku"), stop("asakusa"), end("ginza")] }]));
  assert.equal(created.status, 201, created.text);
  assert.match(created.body.trip_id, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(created.body.status, "draft");
  const read = await site.call("GET", `/site/v1/trips/${created.body.trip_id}`, { ip: nextIp() });
  assertMatchesOpenApi("GET", "/site/v1/trips/{id}", read);
  assert.equal(read.status, 200, read.text);
  assert.deepEqual([read.body.status, read.body.plans, read.body.unquoted, read.body.expires_at], ["draft", [], [], null]);
  assert.equal((await site.call("GET", "/site/v1/trips/short", { ip: nextIp() })).status, 404);
  assert.equal((await site.call("GET", `/site/v1/trips/${"x".repeat(43)}`, { ip: nextIp() })).body.error.code, "TRIP_NOT_FOUND");
  assert.equal((await quoteTrip("x".repeat(43))).status, 404);
});

test("两天同城：每一段的对外价 = 同样条件的官网询价；一车到底 = 段之和（过夜在①里不收住宿），差距不到 10% 推荐一车到底", async () => {
  const created = await createTrip(trip([
    { date: "2027-03-01", items: [start("shinjuku"), stop("asakusa"), end("ginza")] },
    { date: "2027-03-02", items: [start("ginza"), stop("asakusa"), end("shinjuku")] },
  ]));
  const res = await quoteTrip(created.body.trip_id);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.status, "quoted");
  assert.equal(res.body.degraded, false);
  const kinds = res.body.plans.map((plan: any) => plan.kind).sort();
  assert.deepEqual(kinds, ["daily_best", "one_car"]);
  const oneCar = res.body.plans.find((plan: any) => plan.kind === "one_car");
  const daily = res.body.plans.find((plan: any) => plan.kind === "daily_best");
  assert.equal(oneCar.recommended, true);
  assert.equal(daily.recommended, false);
  assert.equal(oneCar.vehicle_group.id, m.ids.biz7);
  assert.deepEqual(oneCar.fees, []);
  // 每天一段包车（经停浅草 60 分钟是自然断点，拆开的两段点对点没有商品，取「不拆」）
  const segments = oneCar.days.map((day: any) => day.segments);
  assert.deepEqual(segments.map((list: any[]) => list.map((segment) => segment.type)), [["charter"], ["charter"]]);
  assert.equal(segments[0][0].start_local, "2027-03-01T09:00");
  assert.equal(segments[0][0].route.meters, 100_000);
  // B2：官网询价照旧；同样条件的中标价就是这一段的价，明细逐项一致
  const day0 = await officialCharter("2027-03-01T09:00", "shinjuku", ["asakusa"], "ginza");
  const day1 = await officialCharter("2027-03-02T09:00", "ginza", ["asakusa"], "shinjuku");
  assert.equal(segments[0][0].amount.amount, day0.body.quotes[0].price.total.amount);
  assert.equal(segments[1][0].amount.amount, day1.body.quotes[0].price.total.amount);
  assert.deepEqual(segments[0][0].price_breakdown, day0.body.quotes[0].price_breakdown);
  assert.equal(segments[0][0].package_hours, day0.body.quotes[0].package.hours);
  assert.equal(oneCar.total.amount, String(sum([day0.body.quotes[0].price.total.amount, day1.body.quotes[0].price.total.amount])));
  assert.equal(daily.total.amount, oneCar.total.amount);
  // 对客应答没有结算价、加价比例、供应商编号
  assert.doesNotMatch(res.text, /settlement|markup|tenant/);
  // GET 和报价应答同一份
  const read = await site.call("GET", `/site/v1/trips/${created.body.trip_id}`, { ip: nextIp() });
  assert.deepEqual(read.body, res.body);
  // 方案写进了平台表：一车到底带供应商和车型组
  const rows = await api.db.owner.query<any>("select kind, status, supplier_tenant_id, vehicle_group_id, sell_minor::text as sell from trip_plans where trip_id = $1 order by seq", [created.body.trip_id]);
  assert.deepEqual(rows.rows.find((row) => row.kind === "one_car"), { kind: "one_car", status: "quoted", supplier_tenant_id: m.b.tenantId, vehicle_group_id: m.ids.biz7, sell: oneCar.total.amount });
  // 重新报价：旧方案删掉重写
  const again = await quoteTrip(created.body.trip_id);
  assert.equal(again.status, 200, again.text);
  assert.notEqual(again.body.plans[0].plan_id, res.body.plans[0].plan_id);
  assert.equal(Number((await api.db.owner.query<{ n: string }>("select count(*) as n from trip_plans where trip_id = $1", [created.body.trip_id])).rows[0]?.n), 2);
});

test("过夜在③（箱根）：住宿 5,000 < 两笔空驶加价 20,000 → 收住宿再抵掉两笔加价（D4），写进 trip_fees（负数、规则版本）；对客总价 = 段 + 费用", async () => {
  const product = await ok(tenantCall(m.b, "GET", `/products/${charterId}`));
  const saved = await ok(tenantCall(m.b, "PUT", `/products/${charterId}/trip-rules`, { version: product.version, body: { lodging: { perNightMinor: 5_000 } } }));
  assert.equal(saved.rules_version >= 1, true);
  const created = await createTrip(trip([
    { date: "2027-03-03", items: [start("shinjuku"), stop("asakusa"), end("ashinoko")] },
    { date: "2027-03-04", items: [start("ashinoko"), stop("asakusa"), end("shinjuku")] },
  ]));
  const res = await quoteTrip(created.body.trip_id);
  assert.equal(res.status, 200, res.text);
  const oneCar = res.body.plans.find((plan: any) => plan.kind === "one_car");
  assert.deepEqual(oneCar.fees.map((fee: any) => [fee.type, fee.night_index, Math.sign(Number(fee.amount.amount))]), [["lodging", 0, 1], ["lodging_offset", 0, -1]]);
  assert.equal(oneCar.fees[0].label.zh, "司机住宿费（第 1 晚）");
  const segmentTotal = sum(oneCar.days.flatMap((day: any) => day.segments.map((segment: any) => segment.amount.amount)));
  assert.equal(Number(oneCar.total.amount), segmentTotal + sum(oneCar.fees.map((fee: any) => fee.amount.amount)));
  // 每天各自最优不加跨段费用，比一车到底贵：推荐一车到底
  const daily = res.body.plans.find((plan: any) => plan.kind === "daily_best");
  assert.equal(Number(daily.total.amount), segmentTotal);
  assert.equal(oneCar.recommended, true);
  const fees = await api.db.owner.query<any>("select fee_type, settlement_minor::int as settlement, supplier_tenant_id, product_id, rule_version, night_index from trip_fees where trip_id = $1 order by seq", [created.body.trip_id]);
  assert.deepEqual(fees.rows, [
    { fee_type: "lodging", settlement: 5_000, supplier_tenant_id: m.b.tenantId, product_id: charterId, rule_version: saved.rules_version, night_index: 0 },
    { fee_type: "lodging_offset", settlement: -20_000, supplier_tenant_id: m.b.tenantId, product_id: charterId, rule_version: saved.rules_version, night_index: 0 },
  ]);
  // 住宿 25,000 ≥ 两笔空驶加价 20,000：车回基地，不收住宿也不抵
  const latest = await ok(tenantCall(m.b, "GET", `/products/${charterId}`));
  await ok(tenantCall(m.b, "PUT", `/products/${charterId}/trip-rules`, { version: latest.version, body: { lodging: { perNightMinor: 25_000 } } }));
  const back = await quoteTrip(created.body.trip_id);
  assert.deepEqual(back.body.plans.find((plan: any) => plan.kind === "one_car").fees, []);
});

test("报不出：一天的上下车点不在任何商品区域里 → 两个方案都报不出（plans 为空、带天和原因），记一条未覆盖需求（城市为空）", async () => {
  const created = await createTrip(trip([
    { date: "2027-03-05", items: [start("shinjuku"), stop("asakusa"), end("ginza")] },
    { date: "2027-03-06", items: [start("kofu"), stop("nirasaki"), end("kofu")] },
  ]));
  const before = Number((await api.db.owner.query<{ n: string }>("select count(*) as n from uncovered_demands where category = 'charter' and service_local = '2027-03-06T09:00'")).rows[0]?.n);
  const res = await quoteTrip(created.body.trip_id);
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.body.plans, []);
  assert.deepEqual(res.body.unquoted, [
    { plan_kind: "one_car", day_index: 1, reason: "OUT_OF_SERVICE_AREA" },
    { plan_kind: "daily_best", day_index: 1, reason: "OUT_OF_SERVICE_AREA" },
  ]);
  assert.equal(res.body.expires_at, null);
  await site.app.backgroundIdle();
  const demands = await api.db.owner.query<any>("select category, city_id, package_hours, pickup_lat::float as lat from uncovered_demands where category = 'charter' and service_local = '2027-03-06T09:00'");
  assert.equal(demands.rows.length, before + 1);
  // 自动选档没有客人选的时长：按行驶 120 + 停留 60 分钟向上取整记 3 小时（同官网）
  assert.deepEqual(demands.rows[demands.rows.length - 1], { category: "charter", city_id: null, package_hours: 3, lat: 35.6622 });
});

test("限频：建单每分钟 10 次、报价每分钟 5 次（同一地址），互不占用", async () => {
  const ip = "10.98.1.9";
  const body = trip([{ date: "2027-03-07", items: [start("shinjuku"), end("ginza")] }]);
  const statuses: number[] = [];
  for (let i = 0; i < 11; i++) statuses.push((await site.call("POST", "/site/v1/trips", { body, ip })).status);
  assert.deepEqual(statuses.slice(0, 10), Array(10).fill(201));
  assert.equal(statuses[10], 429);
  const id = (await createTrip(body)).body.trip_id;
  const quotes: number[] = [];
  for (let i = 0; i < 6; i++) quotes.push((await site.call("POST", `/site/v1/trips/${id}/quote`, { ip })).status);
  assert.deepEqual(quotes.slice(0, 5), Array(5).fill(200));
  assert.equal(quotes[5], 429);
});
