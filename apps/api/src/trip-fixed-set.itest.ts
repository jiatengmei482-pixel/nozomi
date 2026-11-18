/**
 * M9T-04（ADR 0101 第八节）：固定测试集第一部分——东京 15 条，经真实接口、真实 PostgreSQL。
 * 仓库里没有真实客人需求（Q1），这里按第八节列的情形构造；每条写明期望：每个方案的段型和拆法（每天的段）、跨段费用（类型、金额）、
 * 方案数、推荐、报不出的天和原因、降级。业主给出去掉个人信息的真实需求后逐条替换。
 * 商品、区域、价格全在本文件里经接口建出来（同 trips.itest.ts）：乙的东京包车（①东京市内，③箱根上下车 / 途经各 10,000；
 * 商务 7 座 6 人，5h 33,000、10h 55,000），甲的成田接送机（商务 7 座 18,000）和羽田—银座点对点，市场里的接送机（buildMarket）。
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

const square = (west: number, south: number, east: number, north: number) => ({ type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] });
const P = {
  nikko: { lat: 36.75, lng: 139.6 },
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

async function setRules(config: unknown): Promise<void> {
  const product = await ok(tenantCall(m.b, "GET", `/products/${charterId}`));
  await ok(tenantCall(m.b, "PUT", `/products/${charterId}/trip-rules`, { version: product.version, body: config }));
}

interface FixedCase {
  name: string;
  days: unknown[];
  party?: { adults: number; children: number; luggage: number };
  rules?: unknown;
  expected: unknown;
}

/*
 * 期望里的金额（对客价 = 结算价 × 1.1；每段路线 60 分钟）：
 * - 接送机：市场里甲的经济 4 座 12,000 最便宜（2 人坐得下）→ 13,200；乙的成田商务 7 座 19,800。
 * - 包车：预计用时 T ≤ 5h 用 5h 33,000（36,300），否则 10h 55,000（60,500）；箱根③上 / 下车、途经各 10,000；
 *   终点在③、没有①外经停时另收下车点行程加价 10,000（ADR 0093 C；本商品没迁移三层，查③的途经加价）。
 * - 第 7、8 条两天：第 1 天 33,000 + 下车 10,000 + 下车点行程 10,000，第 2 天 33,000 + 上车 10,000 → 96,000（105,600）；
 *   住宿取低（D4）：25,000 > 20,000 不收；15,000 < 20,000 收住宿 16,500、抵扣两笔③加价 −22,000 → 100,100；
 *   客人提供住宿（第 9 条）住宿记 0、车仍留在箱根，抵扣照记 → 83,600。
 * - 第二司机：最短套餐价 33,000（36,300）。
 * - 一车到底和每天各自最优相差不到 10% 推荐一车到底；单日只出一车到底。
 */
const CASES: FixedCase[] = [
  { name: "1 接机 → 酒店（成田 → 新宿）", days: [{ date: "2027-04-01", items: [flightIn("nearNarita"), end("shinjuku")] }], expected: { status: "quoted", degraded: false, plans: [{ kind: "one_car", recommended: true, days: ["0:airport_pickup"], fees: [], total: "13200", warnings: [] }], unquoted: [] } },
  { name: "2 酒店 → 送机（新宿 → 成田）", days: [{ date: "2027-04-02", items: [start("shinjuku", "07:00"), flightOut("nearNarita")] }], expected: { status: "quoted", degraded: false, plans: [{ kind: "one_car", recommended: true, days: ["0:airport_dropoff"], fees: [], total: "13200", warnings: [] }], unquoted: [] } },
  { name: "3 当天游览（新宿 → 浅草 → 银座 → 新宿）", days: [{ date: "2027-04-03", items: [start("shinjuku"), stop("asakusa", 120), stop("ginza", 60), end("shinjuku")] }], expected: { status: "quoted", degraded: false, plans: [{ kind: "one_car", recommended: true, days: ["0:charter10h"], fees: [], total: "60500", warnings: [] }], unquoted: [] } },
  // 单日只出一车到底（ADR 0101 第三节第 6 小节）：羽田在①里，整天一段包车
  { name: "4 接机 + 下午游览（羽田 → 浅草 → 新宿）", days: [{ date: "2027-04-04", items: [flightIn("haneda"), stop("asakusa", 120), end("shinjuku")] }], expected: { status: "quoted", degraded: false, plans: [{ kind: "one_car", recommended: true, days: ["0:charter5h"], fees: [], total: "36300", warnings: [] }], unquoted: [] } },
  // 成田不在乙的包车区域里，浅草断开后接机和包车又没有同一家供应商能连着做（单日只出一车到底）→ 报不出
  { name: "4b 接机 + 下午游览（成田 → 浅草 → 新宿）", days: [{ date: "2027-04-04", items: [flightIn("nearNarita"), stop("asakusa", 120), end("shinjuku")] }], expected: { status: "quoted", degraded: false, plans: [], unquoted: ["one_car@0:OUT_OF_SERVICE_AREA"] } },
  {
    name: "5 三天同城",
    days: ["2027-04-05", "2027-04-06", "2027-04-07"].map((date) => ({ date, items: [start("shinjuku"), stop("asakusa", 120), end("shinjuku")] })),
    expected: { status: "quoted", degraded: false, plans: [{ kind: "daily_best", recommended: false, days: ["0:charter5h", "1:charter5h", "2:charter5h"], fees: [], total: "108900", warnings: [] }, { kind: "one_car", recommended: true, days: ["0:charter5h", "1:charter5h", "2:charter5h"], fees: [], total: "108900", warnings: [] }], unquoted: [] },
  },
  {
    name: "6 夹空闲日（第 2 天不用车）",
    days: [
      { date: "2027-04-08", items: [start("shinjuku"), stop("asakusa", 120), end("shinjuku")] },
      { date: "2027-04-09", items: [] },
      { date: "2027-04-10", items: [start("shinjuku"), stop("ginza", 120), end("shinjuku")] },
    ],
    expected: { status: "quoted", degraded: false, plans: [{ kind: "daily_best", recommended: false, days: ["0:charter5h", "2:charter5h"], fees: [], total: "72600", warnings: [] }, { kind: "one_car", recommended: true, days: ["0:charter5h", "1:idle_day", "2:charter5h"], fees: [], total: "72600", warnings: [] }], unquoted: [] },
  },
  {
    name: "7 过夜在箱根（③），住宿 25,000 > 两笔空驶加价 20,000：不收住宿，照收加价",
    rules: { lodging: { perNightMinor: 25_000 } },
    days: [
      { date: "2027-04-11", items: [start("shinjuku"), stop("asakusa", 60), end("ashinoko")] },
      { date: "2027-04-12", items: [start("ashinoko"), stop("asakusa", 60), end("shinjuku")] },
    ],
    expected: { status: "quoted", degraded: false, plans: [{ kind: "daily_best", recommended: false, days: ["0:charter5h", "1:charter5h"], fees: [], total: "105600", warnings: [] }, { kind: "one_car", recommended: true, days: ["0:charter5h", "1:charter5h"], fees: [], total: "105600", warnings: [] }], unquoted: [] },
  },
  {
    name: "8 过夜在箱根（③），默认住宿 15,000 < 两笔空驶加价 20,000：收住宿、抵掉加价",
    rules: {},
    days: [
      { date: "2027-04-13", items: [start("shinjuku"), stop("asakusa", 60), end("ashinoko")] },
      { date: "2027-04-14", items: [start("ashinoko"), stop("asakusa", 60), end("shinjuku")] },
    ],
    expected: { status: "quoted", degraded: false, plans: [{ kind: "daily_best", recommended: false, days: ["0:charter5h", "1:charter5h"], fees: [], total: "105600", warnings: [] }, { kind: "one_car", recommended: true, days: ["0:charter5h", "1:charter5h"], fees: ["lodging#0=16500", "lodging_offset#0=-22000"], total: "100100", warnings: [] }], unquoted: [] },
  },
  {
    name: "9 同 8，客人当晚给司机提供住宿：不收住宿",
    days: [
      { date: "2027-04-15", items: [start("shinjuku"), stop("asakusa", 60), end("ashinoko")], driverLodgingProvided: true },
      { date: "2027-04-16", items: [start("ashinoko"), stop("asakusa", 60), end("shinjuku")] },
    ],
    expected: { status: "quoted", degraded: false, plans: [{ kind: "daily_best", recommended: false, days: ["0:charter5h", "1:charter5h"], fees: [], total: "105600", warnings: [] }, { kind: "one_car", recommended: true, days: ["0:charter5h", "1:charter5h"], fees: ["lodging#0=0", "lodging_offset#0=-22000"], total: "83600", warnings: [] }], unquoted: [] },
  },
  {
    // 预计用时 T = 行驶 180 + 停留 540 = 720 分钟（引擎能报）；拘束 = T + 出入库 60×2 = 840 > 780 → 加第二司机（最短套餐价）
    name: "10 拘束超 13 小时（07:00 出发，预计 12 小时 + 出入库）：加第二司机",
    days: [{ date: "2027-04-17", items: [start("shinjuku", "07:00"), stop("asakusa", 270), stop("ginza", 270), end("shinjuku")] }],
    expected: { status: "quoted", degraded: false, plans: [{ kind: "one_car", recommended: true, days: ["0:charter10h"], fees: ["second_driver@0=36300"], total: "96800", warnings: ["SECOND_DRIVER"] }], unquoted: [] },
  },
  {
    // 单段预计用时超过 780 分钟，报价引擎直接拒报（ADR 0101 第四节第 3 条），编排器翻成同一原因
    name: "11 单段预计超 13 小时（05:00 出发，约 17 小时）：报不出",
    days: [{ date: "2027-04-18", items: [start("shinjuku", "05:00"), stop("asakusa", 420), stop("ginza", 420), end("shinjuku")] }],
    expected: { status: "quoted", degraded: false, plans: [], unquoted: ["one_car@0:ITINERARY_TOO_LONG"] },
  },
  {
    // 第 1 天 24:00 收车（+ 入库 60），第 2 天 06:00 出发（− 出库 60）：休息 4 小时 < 绝对下限 9 小时 → 一车到底报不出；
    // 每天各自最优只按单日检查：第 1 天拘束 840 > 780 → 第 1 天加第二司机
    name: "12 休息不足：一车到底报不出，每天各自最优照报",
    days: [
      { date: "2027-04-19", items: [start("shinjuku", "12:00"), stop("asakusa", 270), stop("ginza", 270), end("shinjuku")] },
      { date: "2027-04-20", items: [start("shinjuku", "06:00"), stop("asakusa", 60), end("shinjuku")] },
    ],
    expected: { status: "quoted", degraded: false, plans: [{ kind: "daily_best", recommended: true, days: ["0:charter10h", "1:charter5h"], fees: ["second_driver@0=36300"], total: "133100", warnings: ["SECOND_DRIVER"] }], unquoted: ["one_car@1:WORK_HOURS_HARD_LIMIT"] },
  },
  { name: "13 人数超车型（9 人，商务 7 座只坐 6 人）", party: { adults: 9, children: 0, luggage: 1 }, days: [{ date: "2027-04-21", items: [start("shinjuku"), stop("asakusa", 120), end("shinjuku")] }], expected: { status: "quoted", degraded: false, plans: [], unquoted: ["one_car@0:CAPACITY_EXCEEDED"] } },
  {
    name: "14 某天没有商品（第 2 天在甲府）",
    days: [
      { date: "2027-04-22", items: [start("shinjuku"), stop("asakusa", 120), end("shinjuku")] },
      { date: "2027-04-23", items: [start("kofu"), stop("nirasaki", 60), end("kofu")] },
    ],
    expected: { status: "quoted", degraded: false, plans: [], unquoted: ["one_car@1:OUT_OF_SERVICE_AREA", "daily_best@1:OUT_OF_SERVICE_AREA"] },
  },
  {
    name: "15 机场日由别的供应商接（第 1 天成田接机，第 2 天包车）",
    days: [
      { date: "2027-04-24", items: [flightIn("nearNarita"), end("shinjuku")] },
      { date: "2027-04-25", items: [start("shinjuku"), stop("asakusa", 120), end("shinjuku")] },
    ],
    expected: { status: "quoted", degraded: false, plans: [{ kind: "daily_best", recommended: true, days: ["0:airport_pickup", "1:charter5h"], fees: [], total: "49500", warnings: [] }, { kind: "one_car", recommended: false, days: ["0:airport_pickup", "1:charter5h"], fees: [], total: "58080", warnings: [] }], unquoted: [] },
  },
];

for (const fixed of CASES) {
  test(`固定测试集 ${fixed.name}`, async () => {
    if (fixed.rules !== undefined) await setRules(fixed.rules);
    const created = await createTrip({ ...trip(fixed.days), ...(fixed.party === undefined ? {} : { party: fixed.party }) });
    assert.equal(created.status, 201, created.text);
    const res = await quoteTrip(created.body.trip_id);
    assert.equal(res.status, 200, res.text);
    if (process.env["PRINT_FIXED"] === "1") console.log(`FIXED ${fixed.name} ${JSON.stringify(summary(res.body))}`);
    assert.deepEqual(summary(res.body), fixed.expected);
    // M9T-07：全部方案报不出才建议转人工（第 22 条这种部分报不出为 false）
    assert.equal(res.body.manual_quote_suggested, res.body.plans.length === 0);
  });
}
