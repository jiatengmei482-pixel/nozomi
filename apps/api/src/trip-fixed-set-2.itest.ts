/**
 * M9T-04（ADR 0101 第八节）：固定测试集第二部分——大阪、跨城、14 天、规则开关、建单校验，经真实接口、真实 PostgreSQL。
 * 仓库里没有真实客人需求（Q1），这里按第八节列的情形构造；每条写明期望：每个方案的段型和拆法（每天的段）、跨段费用（类型、金额）、
 * 方案数、推荐、报不出的天和原因、降级。业主给出去掉个人信息的真实需求后逐条替换。
 * 商品、区域、价格全在本文件里经接口建出来（同 trips.itest.ts）：乙的东京包车（①东京市内，③箱根上下车 / 途经各 10,000；
 * 商务 7 座 6 人，5h 33,000、10h 55,000），甲的成田接送机（商务 7 座 18,000）和羽田—银座点对点，市场里的接送机（buildMarket）。
 * 另给乙建大阪包车（①大阪市内；③京都上下车、途经各 8,000；商务 7 座，5h 30,000、10h 50,000）。
 * 路线替身：每一段 50 公里、60 分钟。
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
let haneda: string;
let osakaCharterId: string;

const square = (west: number, south: number, east: number, north: number) => ({ type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] });
const P = {
  nikko: { lat: 36.75, lng: 139.6 },
  umeda: { lat: 34.7025, lng: 135.4959 },
  namba: { lat: 34.6659, lng: 135.5013 },
  kyoto: { lat: 35.0116, lng: 135.7681 },
  nara: { lat: 34.685, lng: 135.805 },
  shinjuku: { lat: 35.6905, lng: 139.7005 },
  asakusa: { lat: 35.7148, lng: 139.7967 },
  ginza: { lat: 35.6717, lng: 139.765 },
  ashinoko: { lat: 35.2, lng: 139.0 },
  kofu: { lat: 35.6622, lng: 138.5683 },
  nirasaki: { lat: 35.7086, lng: 138.4467 },
  /** 成田机场旁 100 米（不给 placeId，按坐标认机场） */
  nearNarita: { lat: 35.769, lng: 140.388 },
  haneda: { lat: 35.5494, lng: 139.7798 },
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
async function newArea(who: TenantFixture, cityId: string, name: string, polygon: ReturnType<typeof square>, bizType = "charter"): Promise<string> {
  return (await ok(tenantCall(who, "POST", "/areas", { body: { city_id: cityId, name: { zh: name }, biz_type: bizType, polygons: [{ kind: "operate", geometry: polygon }] } }), 201)).id;
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
  // 甲另一个成田接送机商品：商务 7 座 18,000 比乙的 19,800 便宜，成为中标（市场里甲 20,000 / 经济 4 座 12,000，乙 19,800）
  // （不复用 testing/market 的建商品助手：它按租户前缀起品牌名，同一租户第二次会撞名）
  const naritaArea = await newArea(m.a, m.ids.tokyo, "东京全域二", square(139.0, 35.0, 140.0, 36.0), "general");
  const naritaBrand = (await ok(tenantCall(m.a, "POST", "/brands", { body: { name: `接送机-${randomUUID().slice(0, 6)}`, currency: "JPY" } }), 201)).id;
  const narita = await ok(tenantCall(m.a, "POST", "/products", { body: { brand_id: naritaBrand, city_id: m.ids.tokyo, category: "airport_transfer", poi_id: m.ids.narita, areas: [{ area_id: naritaArea }], vehicle_groups: [{ vehicle_group_id: m.ids.biz7, passengers: 6, luggage: 4 }], dispatchers: [{ name: "调度", phone: "0312345678" }] } }), 201);
  const naritaRules = await ok(tenantCall(m.a, "PUT", `/products/${narita.id}/service-rules`, { version: 1, body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { pickup: { mode: "limited", minutes: 90 }, dropoff: { mode: "limited", minutes: 15 } } } }));
  const naritaContent = await ok(tenantCall(m.a, "PUT", `/products/${narita.id}/content`, { version: naritaRules.version, body: { zh: { title: "成田机场接送", pickup_guide: "到达大厅 3 号门" } } }));
  await ok(tenantCall(m.a, "POST", `/products/${narita.id}/price-rules`, { version: naritaContent.version, body: { area_id: naritaArea, vehicle_group_id: m.ids.biz7, direction: "both", valid_from: "2026-01-01", pricing_model: "fixed", base_price: 18_000 } }), 201);
  await ok(tenantCall(m.a, "POST", `/products/${narita.id}/publish`));
  // 羽田：没有供应商卖它的接送机；甲的点对点商品只盖羽田—银座一带（不碍新宿、浅草的包车用例）
  haneda = (await ok(api.call("POST", "/platform/v1/master/places", { token: m.root, body: { type: "airport", code: "HND", city_id: m.ids.tokyo, name: { zh: "羽田机场" }, location: P.haneda, flight_scope: "international" } }), 201)).id;
  const p2pArea = await newArea(m.a, m.ids.tokyo, "羽田—银座", square(139.74, 35.54, 139.8, 35.69), "general");
  const p2pBrand = (await ok(tenantCall(m.a, "POST", "/brands", { body: { name: `点对点-${randomUUID().slice(0, 6)}`, currency: "JPY" } }), 201)).id;
  const p2p = await ok(tenantCall(m.a, "POST", "/products", { body: { brand_id: p2pBrand, city_id: m.ids.tokyo, category: "point_to_point", areas: [{ area_id: p2pArea }], vehicle_groups: [{ vehicle_group_id: m.ids.biz7, passengers: 6, luggage: 4 }], dispatchers: [{ name: "调度", phone: "0312345678" }] } }), 201);
  const p2pRules = await ok(tenantCall(m.a, "PUT", `/products/${p2p.id}/service-rules`, { version: 1, body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { general: { mode: "limited", minutes: 30 } } } }));
  const p2pContent = await ok(tenantCall(m.a, "PUT", `/products/${p2p.id}/content`, { version: p2pRules.version, body: { zh: { title: "羽田—银座用车" } } }));
  await ok(tenantCall(m.a, "POST", `/products/${p2p.id}/price-rules`, { version: p2pContent.version, body: { area_id: p2pArea, vehicle_group_id: m.ids.biz7, valid_from: "2026-01-01", pricing_model: "fixed", base_price: 15_000 } }), 201);
  await ok(tenantCall(m.a, "POST", `/products/${p2p.id}/publish`));
  // 乙的大阪包车
  const osakaArea = await newArea(m.b, m.ids.osaka, "大阪市内", square(135.4, 34.6, 135.6, 34.75));
  const kyotoArea = await newArea(m.b, m.ids.osaka, "京都", square(135.65, 34.95, 135.85, 35.08));
  const osakaPkg = (hours: number, price: number) => ({ area_id: osakaArea, vehicle_group_id: m.ids.biz7, package_hours: hours, pricing_model: "charter_package", package_km: 300, package_price: price, overtime_per_hour: 5_000, over_km_per_km: 500, valid_from: "2026-01-01" });
  const kyotoSurcharge = (hours: number) => ({ area_id: kyotoArea, vehicle_group_id: m.ids.biz7, package_hours: hours, pricing_model: "charter_area_surcharge", pickup_surcharge: 8_000, dropoff_surcharge: 8_000, waypoint_surcharge: 8_000, valid_from: "2026-01-01" });
  const osakaBrand = (await ok(tenantCall(m.b, "POST", "/brands", { body: { name: `大阪包车-${randomUUID().slice(0, 6)}`, currency: "JPY" } }), 201)).id;
  const osakaProduct = await ok(tenantCall(m.b, "POST", "/products", { body: { brand_id: osakaBrand, city_id: m.ids.osaka, category: "charter", areas: [{ area_id: osakaArea }], vehicle_groups: [{ vehicle_group_id: m.ids.biz7, passengers: 6, luggage: 4 }], dispatchers: [{ name: "调度", phone: "0612345678" }] } }), 201);
  const osakaRules = await ok(tenantCall(m.b, "PUT", `/products/${osakaProduct.id}/service-rules`, { version: 1, body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { general: { mode: "limited", minutes: 0 } } } }));
  const osakaContent = await ok(tenantCall(m.b, "PUT", `/products/${osakaProduct.id}/content`, { version: osakaRules.version, body: { zh: { title: "大阪包车" } } }));
  await ok(tenantCall(m.b, "POST", `/products/${osakaProduct.id}/price-rules/batch`, { version: osakaContent.version, body: { create: [osakaPkg(5, 30_000), osakaPkg(10, 50_000), kyotoSurcharge(5), kyotoSurcharge(10)] } }));
  await ok(tenantCall(m.b, "POST", `/products/${osakaProduct.id}/publish`));
  osakaCharterId = osakaProduct.id;
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
const flightIn = (place: keyof typeof P, time = "10:00") => ({ kind: "arrive_flight", place: at(place), time });
const flightOut = (place: keyof typeof P) => ({ kind: "depart_flight", place: at(place) });

/** 方案摘要：段型（包车带档）、跨段费用、合计、推荐、提醒；报不出的天和原因 */
function summary(body: any): unknown {
  const plans = [...body.plans]
    .sort((a: any, b: any) => (a.kind < b.kind ? -1 : 1))
    .map((plan: any) => ({
      kind: plan.kind,
      recommended: plan.recommended,
      days: plan.days.map((day: any) => `${day.day_index}:${day.segments.map((segment: any) => `${segment.type}${segment.package_hours === null ? "" : `${segment.package_hours}h`}${segment.other_vehicle ? "*" : ""}`).join("+")}`),
      fees: [...plan.fees.map((fee: any) => `${fee.type}#${fee.night_index}=${fee.amount.amount}`), ...plan.days.flatMap((day: any) => day.fees.map((fee: any) => `${fee.type}@${day.day_index}=${fee.amount.amount}`))],
      total: plan.total.amount,
      warnings: plan.warnings.map((warning: any) => warning.code),
    }));
  return { status: body.status, degraded: body.degraded, plans, unquoted: body.unquoted.map((entry: any) => `${entry.plan_kind}@${entry.day_index}:${entry.reason}`) };
}

async function setRules(config: unknown, productId = charterId): Promise<void> {
  const product = await ok(tenantCall(m.b, "GET", `/products/${productId}`));
  await ok(tenantCall(m.b, "PUT", `/products/${productId}/trip-rules`, { version: product.version, body: config }));
}

interface FixedCase {
  name: string;
  days: unknown[];
  party?: { adults: number; children: number; luggage: number };
  rules?: unknown;
  /** 规则改在哪个商品上（默认东京包车） */
  rulesOn?: "tokyo" | "osaka";
  /** 建单就该被拒：期望的状态码和原因 */
  rejected?: unknown;
  expected: unknown;
}

const tokyoTour = (date: string) => ({ date, items: [start("shinjuku"), stop("asakusa", 120), end("shinjuku")] });
const osakaTour = (date: string) => ({ date, items: [start("umeda"), stop("namba", 120), end("umeda")] });
const dates = (from: string, count: number): string[] => Array.from({ length: count }, (_, i) => new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));

/*
 * 期望里的金额（对客价 = 结算价 × 1.1；每段路线 60 分钟）：
 * - 大阪包车 5h 30,000（33,000）；京都③上 / 下车、途经各 8,000，终点在③另收下车点行程加价 8,000。
 * - 第 18、19 条：第 1 天 30,000 + 8,000 + 8,000，第 2 天 30,000 + 8,000 → 84,000（92,400）；两笔③加价 16,000（17,600）抵扣；
 *   住宿默认 15,000（16,500）/ 京都按区域 5,000（5,500）→ 91,300 / 80,300。
 * - 第 21 条：箱根过夜夹空闲日，「车留当地」= 停驻 min(10,000, 最短套餐 33,000) + 两晚住宿，「回基地再来」的空驶已由前后两天③加价覆盖、不另收 → 取后者，不收费。
 * - 第 22 条：跨城市一车到底是 P1d（ADR 0101 第一节），一车到底报不出 CROSS_CITY_ONE_CAR，每天各自最优照报。
 * - 第 23 条：一车到底 = 乙包车 33,000 + 乙成田送机 19,800（58,080），比每天各自最优（包车 + 甲经济 4 座 12,000 = 49,500）贵 10% 以上。
 * - 第 25 条：第二司机固定 20,000（22,000）+ 10h 55,000（60,500）。
 */
const CASES: FixedCase[] = [
  { name: "16 大阪当天游览（梅田 → 难波 → 梅田）", days: [osakaTour("2027-05-01")], expected: { status: "quoted", degraded: false, plans: [{ kind: "one_car", recommended: true, days: ["0:charter5h"], fees: [], total: "33000", warnings: [] }], unquoted: [] } },
  { name: "17 大阪两天同城", days: dates("2027-05-02", 2).map(osakaTour), expected: { status: "quoted", degraded: false, plans: [{ kind: "daily_best", recommended: false, days: ["0:charter5h", "1:charter5h"], fees: [], total: "66000", warnings: [] }, { kind: "one_car", recommended: true, days: ["0:charter5h", "1:charter5h"], fees: [], total: "66000", warnings: [] }], unquoted: [] } },
  {
    name: "18 过夜在京都（③），默认住宿 15,000 < 两笔加价 16,000：收住宿、抵掉加价",
    days: [
      { date: "2027-05-04", items: [start("umeda"), stop("namba", 60), end("kyoto")] },
      { date: "2027-05-05", items: [start("kyoto"), stop("namba", 60), end("umeda")] },
    ],
    expected: { status: "quoted", degraded: false, plans: [{ kind: "daily_best", recommended: false, days: ["0:charter5h", "1:charter5h"], fees: [], total: "92400", warnings: [] }, { kind: "one_car", recommended: true, days: ["0:charter5h", "1:charter5h"], fees: ["lodging#0=16500", "lodging_offset#0=-17600"], total: "91300", warnings: [] }], unquoted: [] },
  },
  {
    name: "19 京都住宿按区域定 5,000（byArea）",
    rulesOn: "osaka",
    rules: "KYOTO_5000",
    days: [
      { date: "2027-05-06", items: [start("umeda"), stop("namba", 60), end("kyoto")] },
      { date: "2027-05-07", items: [start("kyoto"), stop("namba", 60), end("umeda")] },
    ],
    expected: { status: "quoted", degraded: false, plans: [{ kind: "daily_best", recommended: false, days: ["0:charter5h", "1:charter5h"], fees: [], total: "92400", warnings: [] }, { kind: "one_car", recommended: true, days: ["0:charter5h", "1:charter5h"], fees: ["lodging#0=5500", "lodging_offset#0=-17600"], total: "80300", warnings: [] }], unquoted: [] },
  },
  {
    name: "20 过夜在奈良（①③以外）：第 2 天从奈良出发报不出",
    days: [
      { date: "2027-05-08", items: [start("umeda"), stop("namba", 60), end("nara")] },
      { date: "2027-05-09", items: [start("nara"), stop("namba", 60), end("umeda")] },
    ],
    expected: { status: "quoted", degraded: false, plans: [], unquoted: ["one_car@0:OUT_OF_SERVICE_AREA", "one_car@1:OUT_OF_SERVICE_AREA", "daily_best@0:OUT_OF_SERVICE_AREA", "daily_best@1:OUT_OF_SERVICE_AREA"] },
  },
  {
    name: "21 箱根（③）过夜夹空闲日：停驻和回基地取低",
    rulesOn: "tokyo",
    rules: {},
    days: [
      { date: "2027-05-10", items: [start("shinjuku"), stop("asakusa", 60), end("ashinoko")] },
      { date: "2027-05-11", items: [], nightAt: P.ashinoko },
      { date: "2027-05-12", items: [start("ashinoko"), stop("asakusa", 60), end("shinjuku")] },
    ],
    expected: { status: "quoted", degraded: false, plans: [{ kind: "daily_best", recommended: false, days: ["0:charter5h", "2:charter5h"], fees: [], total: "105600", warnings: [] }, { kind: "one_car", recommended: true, days: ["0:charter5h", "1:idle_day", "2:charter5h"], fees: [], total: "105600", warnings: [] }], unquoted: [] },
  },
  { name: "22 跨城：第 1 天东京、第 2 天大阪", days: [tokyoTour("2027-05-13"), osakaTour("2027-05-14")], expected: { status: "quoted", degraded: false, plans: [{ kind: "daily_best", recommended: true, days: ["0:charter5h", "1:charter5h"], fees: [], total: "69300", warnings: [] }], unquoted: ["one_car@null:CROSS_CITY_ONE_CAR"] } },
  {
    name: "23 游览后次日送机（同一家能连着做）",
    days: [tokyoTour("2027-05-15"), { date: "2027-05-16", items: [start("shinjuku", "07:00"), flightOut("nearNarita")] }],
    expected: { status: "quoted", degraded: false, plans: [{ kind: "daily_best", recommended: true, days: ["0:charter5h", "1:airport_dropoff"], fees: [], total: "49500", warnings: [] }, { kind: "one_car", recommended: false, days: ["0:charter5h", "1:airport_dropoff"], fees: [], total: "58080", warnings: [] }], unquoted: [] },
  },
  {
    name: "24 第二司机关掉：拘束超 13 小时那天报不出",
    rulesOn: "tokyo",
    rules: { secondDriver: { enabled: false } },
    days: [{ date: "2027-05-17", items: [start("shinjuku", "07:00"), stop("asakusa", 270), stop("ginza", 270), end("shinjuku")] }],
    expected: { status: "quoted", degraded: false, plans: [], unquoted: ["one_car@0:WORK_HOURS_EXCEEDED"] },
  },
  {
    name: "25 第二司机按固定金额 20,000",
    rulesOn: "tokyo",
    rules: { secondDriver: { mode: "fixed", fixedMinor: 20_000 } },
    days: [{ date: "2027-05-18", items: [start("shinjuku", "07:00"), stop("asakusa", 270), stop("ginza", 270), end("shinjuku")] }],
    expected: { status: "quoted", degraded: false, plans: [{ kind: "one_car", recommended: true, days: ["0:charter10h"], fees: ["second_driver@0=22000"], total: "82500", warnings: ["SECOND_DRIVER"] }], unquoted: [] },
  },
  { name: "26 14 天东京（上限）", rulesOn: "tokyo", rules: {}, days: dates("2027-06-01", 14).map(tokyoTour), expected: { status: "quoted", degraded: false, plans: [{ kind: "daily_best", recommended: false, days: ["0:charter5h", "1:charter5h", "2:charter5h", "3:charter5h", "4:charter5h", "5:charter5h", "6:charter5h", "7:charter5h", "8:charter5h", "9:charter5h", "10:charter5h", "11:charter5h", "12:charter5h", "13:charter5h"], fees: [], total: "508200", warnings: [] }, { kind: "one_car", recommended: true, days: ["0:charter5h", "1:charter5h", "2:charter5h", "3:charter5h", "4:charter5h", "5:charter5h", "6:charter5h", "7:charter5h", "8:charter5h", "9:charter5h", "10:charter5h", "11:charter5h", "12:charter5h", "13:charter5h"], fees: [], total: "508200", warnings: [] }], unquoted: [] } },
  { name: "27 15 天：建单被拒", days: dates("2027-06-20", 15).map(tokyoTour), rejected: { status: 400, code: "VALIDATION_FAILED", reasons: ["/days"] }, expected: undefined },
  { name: "28 日期不连续：建单被拒", days: [tokyoTour("2027-07-01"), tokyoTour("2027-07-03")], rejected: { status: 400, code: "VALIDATION_FAILED", reasons: ["NOT_CONSECUTIVE"] }, expected: undefined },
  { name: "29 首日是空闲日：建单被拒", days: [{ date: "2027-07-05", items: [] }, tokyoTour("2027-07-06")], rejected: { status: 400, code: "VALIDATION_FAILED", reasons: ["FIRST_DAY_IDLE"] }, expected: undefined },
  { name: "30 日光（①③以外）当天游览：报不出", days: [{ date: "2027-07-08", items: [start("nikko"), stop("asakusa", 60), end("nikko")] }], expected: { status: "quoted", degraded: false, plans: [], unquoted: ["one_car@0:OUT_OF_SERVICE_AREA"] } },
];

for (const fixed of CASES) {
  test(`固定测试集 ${fixed.name}`, async () => {
    const productId = fixed.rulesOn === "osaka" ? osakaCharterId : charterId;
    if (fixed.rules === "KYOTO_5000") {
      const areas = await ok(tenantCall(m.b, "GET", "/areas"));
      const kyoto = areas.items.find((area: any) => area.name.zh === "京都");
      await setRules({ lodging: { byArea: [{ areaId: kyoto.id, perNightMinor: 5_000 }] } }, productId);
    } else if (fixed.rules !== undefined) await setRules(fixed.rules, productId);
    const created = await createTrip({ ...trip(fixed.days), ...(fixed.party === undefined ? {} : { party: fixed.party }) });
    if (fixed.rejected !== undefined) {
      const got = { status: created.status, code: created.body.error?.code, reasons: (created.body.error?.details?.issues ?? []).map((issue: any) => issue.reason ?? issue.path) };
      if (process.env["PRINT_FIXED"] === "1") console.log(`FIXED ${fixed.name} ${JSON.stringify(got)}`);
      assert.deepEqual(got, fixed.rejected);
      return;
    }
    assert.equal(created.status, 201, created.text);
    const res = await quoteTrip(created.body.trip_id);
    assert.equal(res.status, 200, res.text);
    if (process.env["PRINT_FIXED"] === "1") console.log(`FIXED ${fixed.name} ${JSON.stringify(summary(res.body))}`);
    assert.deepEqual(summary(res.body), fixed.expected);
    // M9T-07：全部方案报不出才建议转人工（第 22 条这种部分报不出为 false）
    assert.equal(res.body.manual_quote_suggested, res.body.plans.length === 0);
  });
}
