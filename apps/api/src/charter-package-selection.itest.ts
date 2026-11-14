/**
 * M9P-03（ADR 0091 第四稿、ADR 0093 第四节；业主规格 docs/requirements/charter-pricing-spec-2026-11-14.md 步骤 2、3、5，差异表第 5、6、9 条），经真实接口、真实 PostgreSQL：
 * - 服务规则 `charter_itinerary` 的三项（经停点默认占用、整单缓冲、最低套餐）和在线下单上限：读写、PUT 不带的项保留原值、范围、只有包车能设、甲读不到改不了乙的；
 *   最低套餐比所有套餐都长时的提醒（服务规则应答、上架检查）；
 * - 官网按行程计价一次询价（`charter_selection: auto`）：缓冲算进预计用时、含超公里取最低（用例 10）、T 超过最长档、13 小时拦截（转人工、记未覆盖需求）、
 *   手动升档 / 选短了（PACKAGE_TOO_SHORT + min_package_hours，不记未覆盖需求）、各商品各自选档再比价（差异表第 5 条）、包车同价区间 0；
 * - `/sales/v1` 包车低于最低套餐 → PACKAGE_TOO_SHORT；询价日志记 charter_selection；
 * - 新订单：结算价明细不收超时费、订单详情 `overtime_at_booking: false`、`estimated_minutes`；司机、客人看到的用量里没有；改期按订单的档锁定、预计用时照抄；
 *   救援经 `previewPlatformQuote` 传 locked + 订单的档；
 * - 部署前格式（预收了超时费）的旧单：订单页明细照旧有超时费一行；救援候选的档位和超时费照旧（不传 charterSelection）。
 * 测试数据全在本文件里经接口建出来（「部署前格式」直接改库模拟），随测试 schema 一起删除（规则 1）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { LatLng, RouteLookup } from "@nozomi/domain";
import type { ApiResponse, HttpMethod, TenantFixture, TestApi } from "./testing/api.ts";
import { createTestApi } from "./testing/api.ts";
import { withPlatformTx } from "./db/context.ts";
import { replayRequest } from "./services/area-role-preview.ts";
import { type Market, allKeys, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { platformLogin, tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi, assertMatchesOperation } from "./testing/openapi.ts";
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let site: SiteApi;
let salesToken: string;
/** 乙：规格的东京包车（4h 28,000 含 120 公里、5h 33,000 含 150 公里、10h 55,000 含 300 公里）；甲：「特殊商品」5h 34,000、8h 40,000、10h 56,000、12h 66,000 */
let charterB: string;
let charterA: string;

const square = (west: number, south: number, east: number, north: number) => ({ type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] });
const P = {
  shinjuku: { lng: 139.7, lat: 35.69 },
  asakusa: { lng: 139.7967, lat: 35.7148 },
  tsurugaoka: { lng: 139.5565, lat: 35.3259 },
} satisfies Record<string, LatLng>;
const SERVICE_LOCAL = "2026-10-20T10:00";
const PASSENGER = { name: "王小华", phone: "+81 90-5555-6666", email: "package.guest@example.com" };
const RULE4_KEYS = ["sell", "sell_minor", "markup", "markup_bp", "fx_buffer_bp", "channel", "area_surcharge_sell", "price_breakdown"];
let ipSeq = 0;
const nextIp = (): string => `10.94.${(ipSeq += 1)}.9`;

/** 路线替身：每段 `leg.meters` 米、`leg.minutes` 分钟 */
const leg = { meters: 30_000, minutes: 70 };
const routeLookup = async (): Promise<RouteLookup> => ({ ok: true, route: { meters: leg.meters, minutes: leg.minutes }, source: "google" });

async function tenantCall(who: TenantFixture, method: HttpMethod, path: string, options: { body?: unknown; version?: number } = {}): Promise<ApiResponse> {
  const token = await tenantLogin(api, who.adminEmail);
  api.clock.advance(1_000);
  return api.call(method, `/tenant/v1${path}`, {
    token,
    ...(options.body === undefined ? {} : { body: options.body }),
    headers: { ...(options.version === undefined ? {} : { "if-match": `"${options.version}"` }), ...(method === "POST" && /^\/(products|brands|areas)$|\/price-rules(\/batch)?$/.test(path) ? { "idempotency-key": randomUUID() } : {}) },
  });
}

async function newCharter(who: TenantFixture, packages: [number, number, number][]): Promise<string> {
  const area = async (name: string, polygon: ReturnType<typeof square>): Promise<string> => (await ok(tenantCall(who, "POST", "/areas", { body: { city_id: m.ids.tokyo, name: { zh: name }, biz_type: "charter", polygons: [{ kind: "operate", geometry: polygon }] } }), 201)).id;
  const tokyo = await area("东京市内", square(139.55, 35.52, 139.95, 35.85));
  const kamakura = await area("镰仓", square(139.5, 35.28, 139.6, 35.35));
  const brand = (await ok(tenantCall(who, "POST", "/brands", { body: { name: `包车-${randomUUID().slice(0, 6)}`, currency: "JPY" } }), 201)).id;
  const created = await ok(tenantCall(who, "POST", "/products", { body: { brand_id: brand, city_id: m.ids.tokyo, category: "charter", areas: [{ area_id: tokyo }], vehicle_groups: [{ vehicle_group_id: m.ids.biz7, passengers: 6, luggage: 4 }], dispatchers: [{ name: "调度", phone: "0312345678" }] } }), 201);
  const rules = await ok(tenantCall(who, "PUT", `/products/${created.id}/service-rules`, { version: 1, body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { general: { mode: "limited", minutes: 0 } } } }));
  const content = await ok(tenantCall(who, "PUT", `/products/${created.id}/content`, { version: rules.version, body: { zh: { title: "东京包车" } } }));
  const rows = packages.flatMap(([hours, price, km]) => [
    { area_id: tokyo, vehicle_group_id: m.ids.biz7, package_hours: hours, pricing_model: "charter_package", package_km: km, package_price: price, overtime_per_hour: 6_000, over_km_per_km: 500, valid_from: "2026-01-01" },
    { area_id: kamakura, vehicle_group_id: m.ids.biz7, package_hours: hours, pricing_model: "charter_area_surcharge", pickup_surcharge: 8_000, dropoff_surcharge: 8_000, waypoint_surcharge: 8_000, valid_from: "2026-01-01" },
  ]);
  await ok(tenantCall(who, "POST", `/products/${created.id}/price-rules/batch`, { version: content.version, body: { create: rows } }));
  await ok(tenantCall(who, "POST", `/products/${created.id}/publish`));
  return created.id;
}

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay, quote: { routes: { estimate: routeLookup } } });
  m = await buildMarket(api);
  charterB = await newCharter(m.b, [[4, 28_000, 120], [5, 33_000, 150], [10, 55_000, 300]]);
  charterA = await newCharter(m.a, [[5, 34_000, 150], [8, 40_000, 250], [10, 56_000, 300], [12, 66_000, 360]]);
  const channel = await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" });
  site = await siteApi(api, (await salesCredentials(api, m, channel.id)).clientId, pay, {}, { quote: { routes: { estimate: routeLookup } } });
  const salesChannel = await newChannel(api, m.staff.cm1.token, { name: "OTA 渠道" });
  salesToken = (await salesCredentials(api, m, salesChannel.id, "198.51.100.77")).token;
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
/** 只改 `charter_itinerary` 里给了的项（别的服务规则原样提交） */
async function setItinerary(who: TenantFixture, productId: string, itinerary: Record<string, unknown> | undefined): Promise<ApiResponse> {
  const current = await serviceRules(who, productId);
  const { charter_itinerary: _kept, ...rules } = current.rules;
  const res = await tenantCall(who, "PUT", `/products/${productId}/service-rules`, { version: current.version, body: { ...rules, ...(itinerary === undefined ? {} : { charter_itinerary: itinerary }) } });
  assertMatchesOpenApi("PUT", "/tenant/v1/products/{id}/service-rules", res);
  assert.equal(res.status, 200, res.text);
  // 价格目录缓存 30 秒
  api.clock.advance(31_000);
  return res;
}
const RESET = { stop_occupancy_minutes: 0, buffer_minutes: 0, min_package_hours: null, max_online_minutes: 780 };

/** 官网按行程计价：新宿 → 经停 → 新宿，两段路线按替身、经停停留 `stay` 分钟 */
async function itinerary(stop: keyof typeof P, stay: number, extra: Record<string, unknown> = {}): Promise<ApiResponse> {
  api.clock.advance(1_000);
  const res = await site.call("POST", "/site/v1/quotes", { body: { category: "charter", city_id: m.ids.tokyo, pickup: P.shinjuku, dropoff: P.shinjuku, waypoints: [{ name: "景点", ...P[stop], stay_minutes: stay }], itinerary_pricing: true, service_local: SERVICE_LOCAL, passengers: 2, luggage: 1, ...extra }, ip: nextIp() });
  assertMatchesOpenApi("POST", "/site/v1/quotes", res);
  assert.equal(res.status, 200, res.text);
  return res;
}
const first = (res: ApiResponse): any => res.body.quotes[0];
const snapshotOf = async (quoteId: string): Promise<any> => (await api.db.owner.query<{ snapshot: any }>("select snapshot from quotes where id = $1", [quoteId])).rows[0]?.snapshot;
const demandCount = async (): Promise<number> => {
  await site.app.backgroundIdle();
  return Number((await api.db.owner.query<{ count: string }>("select count(*) from uncovered_demands where category = 'charter'")).rows[0]?.count);
};

async function placeAndPay(quoteId: string): Promise<{ orderId: string; token: string }> {
  const created = await site.call("POST", "/site/v1/orders", { headers: { "idempotency-key": randomUUID() }, body: { quote_id: quoteId, passenger: PASSENGER, save_payment_method: true, pickup_address: "新宿站", dropoff_address: "新宿站" }, ip: nextIp() });
  assert.equal(created.status, 201, created.text);
  const orderId = created.body.order.id as string;
  const intent = pay.intentOf(orderId);
  assert.ok(intent);
  pay.pay(intent.id);
  const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
  assert.equal((await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()))).status, 200);
  return { orderId, token: created.body.link.token as string };
}
const ops = async (): Promise<string> => platformLogin(api, m.staff.operations.email);

test("服务规则三项 + 在线下单上限：默认 0 / 0 / 不限 / 13 小时、不存键；只改给了的项、PUT 不带的保留原值；范围 400；最低套餐比所有套餐都长时提醒（应答、上架检查）；甲读不到、改不了乙的；别的品类设不了", async () => {
  const fresh = await serviceRules(m.b, charterB);
  assert.deepEqual([fresh.rules.charter_itinerary, fresh.min_package_above_all], [{ dropoff_itinerary_surcharge: true, ...RESET }, null]);
  const set = await setItinerary(m.b, charterB, { stop_occupancy_minutes: 15, buffer_minutes: 60 });
  assert.deepEqual(set.body.rules.charter_itinerary, { dropoff_itinerary_surcharge: true, ...RESET, stop_occupancy_minutes: 15, buffer_minutes: 60 });
  const stored = async (): Promise<unknown> => (await api.db.owner.query<{ rules: any }>("select service_rules as rules from products where id = $1", [charterB])).rows[0]?.rules.charterItinerary;
  assert.deepEqual(await stored(), { stopOccupancyMinutes: 15, bufferMinutes: 60 }, "只存和默认值不同的项");
  // 旧页面保存（不带 charter_itinerary）、只带其中一项：别的项保留原值
  await setItinerary(m.b, charterB, undefined);
  const partial = await setItinerary(m.b, charterB, { min_package_hours: 12 });
  assert.deepEqual(partial.body.rules.charter_itinerary, { dropoff_itinerary_surcharge: true, ...RESET, stop_occupancy_minutes: 15, buffer_minutes: 60, min_package_hours: 12 });
  // 最低套餐 12 小时比所有套餐（最长 10 小时）都长：保存不拒，提醒；上架检查多一项（不拦上架）
  assert.deepEqual(partial.body.min_package_above_all, { min_package_hours: 12, longest_package_hours: 10 });
  const check = await tenantCall(m.b, "GET", `/products/${charterB}/publish-check`);
  assertMatchesOpenApi("GET", "/tenant/v1/products/{id}/publish-check", check);
  const item = check.body.items.find((entry: any) => entry.key === "charter_min_package");
  assert.deepEqual([item?.required, item?.passed, item?.issues.map((issue: any) => [issue.reason, issue.detail])], [false, false, [["MIN_PACKAGE_ABOVE_ALL", { min_package_hours: 12, longest_package_hours: 10 }]]]);
  assert.equal(check.body.can_publish, true, "只是提醒，不拦上架");
  // 范围
  const current = await serviceRules(m.b, charterB);
  const { charter_itinerary: _c, ...rules } = current.rules;
  const bad = await tenantCall(m.b, "PUT", `/products/${charterB}/service-rules`, { version: current.version, body: { ...rules, charter_itinerary: { stop_occupancy_minutes: 121, max_online_minutes: 30 } } });
  assert.deepEqual([bad.status, bad.body.error.details.issues.map((issue: any) => [issue.path, issue.reason])], [400, [["/charter_itinerary/stop_occupancy_minutes", "OUT_OF_RANGE"], ["/charter_itinerary/max_online_minutes", "OUT_OF_RANGE"]]]);
  // 规则 2：甲读不到、改不了乙的
  assert.equal((await tenantCall(m.a, "GET", `/products/${charterB}/service-rules`)).status, 404);
  assert.equal((await tenantCall(m.a, "PUT", `/products/${charterB}/service-rules`, { version: current.version, body: { ...rules, charter_itinerary: { buffer_minutes: 0 } } })).status, 404);
  assert.deepEqual(await stored(), { stopOccupancyMinutes: 15, bufferMinutes: 60, minPackageHours: 12 });
  // 别的品类设不了
  const transfer = (await ok(tenantCall(m.b, "GET", "/products"))).items.find((entry: any) => entry.category !== "charter");
  const transferRules = await serviceRules(m.b, transfer.id);
  assert.equal(transferRules.min_package_above_all, null);
  const notCharter = await tenantCall(m.b, "PUT", `/products/${transfer.id}/service-rules`, { version: transferRules.version, body: { ...transferRules.rules, charter_itinerary: { buffer_minutes: 60 } } });
  assert.deepEqual([notCharter.status, notCharter.body.error.details.issues.map((issue: any) => [issue.path, issue.reason])], [400, [["/charter_itinerary", "NOT_APPLICABLE"]]]);
  // 改回默认：不再存键；运营后台查看商品带上这几项
  await setItinerary(m.b, charterB, RESET);
  assert.equal(await stored(), undefined);
  const platform = await api.call("GET", `/platform/v1/products/${charterB}`, { token: m.root });
  assert.deepEqual(platform.body.service_rules.rules.charter_itinerary, { dropoff_itinerary_surcharge: true, ...RESET });
  for (const res of [set, partial]) for (const key of RULE4_KEYS) assert.ok(!allKeys(res.body).has(key), key);
});

test("需求二 + 用例 10：一次询价、各商品按自己的 T 选档——默认配置 3h20m 选 4h；乙设占用 15 分、缓冲 60 分后 T = 4h35m 选 5h（含缓冲）；新宿 → 镰仓 → 新宿 3h25m、132km 选 5h（不是 4h）；询价日志一条、记 charter_selection；包车同价区间 0", async () => {
  leg.minutes = 70;
  leg.meters = 30_000;
  const logsBefore = Number((await api.db.owner.query<{ count: string }>("select count(*) from quote_logs where category = 'charter'")).rows[0]?.count);
  const plain = await itinerary("asakusa", 60);
  assert.deepEqual([first(plain).package.hours, first(plain).price.total.amount, first(plain).estimated_minutes, first(plain).includes_buffer, first(plain).auto_package_hours], [4, "30800", 200, false, 4]);
  assert.equal(Number((await api.db.owner.query<{ count: string }>("select count(*) from quote_logs where category = 'charter'")).rows[0]?.count), logsBefore + 1, "按行程计价只询一次价、一条询价日志");
  const log = (await api.db.owner.query<{ request: any; bids: any }>("select request, bids from quote_logs where category = 'charter' order by created_at desc limit 1")).rows[0];
  assert.deepEqual([log?.request.charter_selection, "package_hours" in (log?.request ?? {}), log?.bids[0].package_hours], ["auto", false, 4]);
  // 回放（ADR 0086；ADR 0093 第六节第 5 小节）：新日志带 charter_selection，回放按新口径重现选档；旧日志（没有它、带套餐时长）照旧口径
  const replayed = await withPlatformTx(api.db.pool, (db) => replayRequest(db, log?.request, "Asia/Tokyo", new Set()), { snapshot: true });
  assert.deepEqual([replayed?.request.charterSelection, replayed?.request.packageHours, replayed?.request.routeUsage?.minutes], ["auto", null, 200]);
  const { charter_selection: _selection, ...legacyLog } = log?.request ?? {};
  const legacy = await withPlatformTx(api.db.pool, (db) => replayRequest(db, { ...legacyLog, package_hours: 4 }, "Asia/Tokyo", new Set()), { snapshot: true });
  assert.deepEqual([legacy !== null && "charterSelection" in legacy.request, legacy?.request.packageHours], [false, 4]);
  const snapshot = await snapshotOf(first(plain).quote_id);
  assert.deepEqual([snapshot.request.charterSelection, snapshot.request.packageHours, snapshot.bandBp, snapshot.channel.bandBp], ["auto", null, 0, 0]);
  assert.deepEqual(snapshot.candidates.map((entry: any) => [entry.productId, entry.packageHours]), [[charterB, 4], [charterA, 5]], "每个候选记自己的档");

  await setItinerary(m.b, charterB, { stop_occupancy_minutes: 15, buffer_minutes: 60 });
  const buffered = await itinerary("asakusa", 60);
  assert.deepEqual([first(buffered).package.hours, first(buffered).price.total.amount, first(buffered).estimated_minutes, first(buffered).includes_buffer, first(buffered).auto_package_hours], [5, "36300", 275, true, 5]);
  const itineraryLocked = (await snapshotOf(first(buffered).quote_id)).winner.offer.settlement.itinerary;
  assert.deepEqual([itineraryLocked.stops, itineraryLocked.stopOccupancyMinutes, itineraryLocked.bufferMinutes, itineraryLocked.estimatedMinutes, itineraryLocked.overtimeMinor, itineraryLocked.overtimeAtBooking], [1, 15, 60, 275, 0, false]);
  await setItinerary(m.b, charterB, RESET);

  // 用例 10：两段各 66 公里、90 分钟，停留 25 分钟 → 3h25m、132 公里；4h 28,000 + 12 × 500 = 34,000 > 5h 33,000；镰仓行程 8,000
  leg.minutes = 90;
  leg.meters = 66_000;
  const case10 = await itinerary("tsurugaoka", 25);
  assert.deepEqual([first(case10).package.hours, first(case10).price.total.amount], [5, "45100"]);
  assert.equal(first(case10).price_breakdown.some((item: any) => item.kind === "overtime"), false);
});

test("T 超过最大套餐：乙只有最长的 10h（不收超时费）比甲的 12h 便宜而中标；13 小时拦截：T 超过在线下单上限的不报 ITINERARY_TOO_LONG（记未覆盖需求），阈值按商品", async () => {
  leg.meters = 100_000;
  leg.minutes = 300;
  const long = await itinerary("asakusa", 90);
  assert.deepEqual([first(long).package.hours, first(long).price.total.amount, first(long).estimated_minutes, first(long).auto_package_hours], [10, "60500", 690, 10]);
  assert.deepEqual(first(long).price_breakdown.map((item: any) => item.kind), ["base", "over_km"]);
  const settlement = (await snapshotOf(first(long).quote_id)).winner.offer.settlement;
  assert.deepEqual([settlement.itinerary.overtimeMinutes, settlement.itinerary.overtimeMinor, settlement.totalMinor], [90, 0, 55_000]);

  const demands = await demandCount();
  leg.minutes = 370;
  const tooLong = await itinerary("asakusa", 60, { pickup_name: "新宿站" });
  assert.deepEqual([tooLong.body.quotes, tooLong.body.unavailable], [[], [{ vehicle_group_id: null, reasons: ["ITINERARY_TOO_LONG"] }]]);
  assert.equal(await demandCount(), demands + 1, "转人工：记未覆盖需求");
  // 自动选档没有客人选的档：未覆盖需求按行驶 + 停留（13h20m）向上取整记 14 小时
  const demand = (await api.db.owner.query<{ package_hours: number; pickup_name: string }>("select package_hours, pickup_name from uncovered_demands where category = 'charter' order by first_seen_at desc limit 1")).rows[0];
  assert.deepEqual(demand, { package_hours: 14, pickup_name: "新宿站" });
  const rejects = (await api.db.owner.query<{ rejects: any }>("select rejects from quote_logs where category = 'charter' order by created_at desc limit 1")).rows[0]?.rejects;
  assert.deepEqual(rejects.map((entry: any) => entry.reason).sort(), ["ITINERARY_TOO_LONG", "ITINERARY_TOO_LONG"]);
  // 乙把上限调到 15 小时：乙照常报 10h
  await setItinerary(m.b, charterB, { max_online_minutes: 900 });
  const allowed = await itinerary("asakusa", 60);
  assert.deepEqual([first(allowed).package.hours, first(allowed).estimated_minutes], [10, 800]);
  await setItinerary(m.b, charterB, RESET);
});

test("手动升档：带 package_hours 可以升到更长的档（另给自动选的档）；比 T 短的不报 PACKAGE_TOO_SHORT + min_package_hours（各商品能选的最短档里最小的），不记未覆盖需求", async () => {
  leg.minutes = 70;
  leg.meters = 30_000;
  await setItinerary(m.b, charterB, { buffer_minutes: 60 });
  const upgraded = await itinerary("asakusa", 60, { package_hours: 10 });
  assert.deepEqual([first(upgraded).package.hours, first(upgraded).price.total.amount, first(upgraded).auto_package_hours], [10, "60500", 5]);
  assert.equal((await snapshotOf(first(upgraded).quote_id)).request.charterSelection, "manual");
  const demands = await demandCount();
  const short = await itinerary("asakusa", 60, { package_hours: 4, pickup_name: "新宿站" });
  // 乙比 T 短（甲没有 4 小时的套餐，报 NOT_AVAILABLE）；能选的最短档是乙的 5h
  assert.deepEqual([short.body.quotes, short.body.unavailable], [[], [{ vehicle_group_id: null, reasons: ["NOT_AVAILABLE", "PACKAGE_TOO_SHORT"], min_package_hours: 5 }]]);
  assert.equal(await demandCount(), demands, "客人选短了，不是缺供应商：不记未覆盖需求");
  await setItinerary(m.b, charterB, RESET);
});

test("差异表第 5 条：各商品各自选档再比价——5h48m 的行程，乙（4/5/10h）只能选 10h 55,000，甲（特殊商品 5/8/10/12h）选 8h 40,000 中标；以前统一定 6h，甲不参与", async () => {
  leg.minutes = 144;
  leg.meters = 100_000;
  const res = await itinerary("asakusa", 60);
  assert.deepEqual([first(res).package.hours, first(res).price.total.amount], [8, "44000"]);
  const snapshot = await snapshotOf(first(res).quote_id);
  assert.equal(snapshot.winner.productId, charterA);
  assert.deepEqual(snapshot.candidates.map((entry: any) => [entry.productId, entry.packageHours, entry.settlementMinor]), [[charterA, 8, 40_000], [charterB, 10, 55_000]]);
});

test("/sales/v1 包车：渠道选的时长低于商品的最低套餐 → PACKAGE_TOO_SHORT + min_package_hours；询价日志记 charter_selection: manual；够长时照常报、比价同价区间 0", async () => {
  await setItinerary(m.b, charterB, { min_package_hours: 5 });
  const ask = (hours: number) => ({ city_id: m.ids.tokyo, category: "charter", pickup: P.shinjuku, dropoff: P.asakusa, package_hours: hours, service_time: "2026-10-20T10:00:00+09:00", passengers: 2, luggage: 1, currency: "JPY" });
  api.clock.advance(1_000);
  const short = await api.call("POST", "/sales/v1/quotes", { token: salesToken, body: ask(4) });
  assertMatchesOperation("POST", "/sales/v1/quotes", short.status, short.body);
  assert.equal(short.status, 200, short.text);
  // 乙低于最低套餐、甲没有 4 小时的套餐
  assert.deepEqual([short.body.quotes, short.body.unavailable], [[], [{ vehicle_group_id: null, reasons: ["NOT_AVAILABLE", "PACKAGE_TOO_SHORT"], min_package_hours: 5 }]]);
  const log = (await api.db.owner.query<{ request: any; rejects: any }>("select request, rejects from quote_logs where category = 'charter' order by created_at desc limit 1")).rows[0];
  assert.equal(log?.request.charter_selection, "manual");
  assert.ok(log?.rejects.some((entry: any) => entry.reason === "BELOW_MIN_PACKAGE"), "询价日志里是原始原因码");
  api.clock.advance(1_000);
  const five = await api.call("POST", "/sales/v1/quotes", { token: salesToken, body: ask(5) });
  assert.equal(five.status, 200, five.text);
  assert.deepEqual([five.body.quotes[0].package_hours, five.body.quotes[0].price.total.amount], [5, "36300"]);
  assert.equal("min_package_hours" in five.body, false);
  await setItinerary(m.b, charterB, RESET);
});

test("新订单：不收超时费；供应商 / 运营详情 overtime_at_booking: false、estimated_minutes；客人、司机看到的用量里没有；改期按订单的档锁定（不重新选档）、预计用时照抄；救援候选按订单的档找、没有超时费", async () => {
  leg.minutes = 70;
  leg.meters = 30_000;
  await setItinerary(m.b, charterB, { stop_occupancy_minutes: 15, buffer_minutes: 60 });
  const quoted = await itinerary("asakusa", 60);
  assert.equal(first(quoted).package.hours, 5);
  const { orderId, token } = await placeAndPay(first(quoted).quote_id);
  const tenant = await tenantCall(m.b, "GET", `/orders/${orderId}`);
  assertMatchesOpenApi("GET", "/tenant/v1/orders/{id}", tenant);
  const settled = tenant.body.order.settlement.itinerary;
  assert.deepEqual([tenant.body.order.package_hours, settled.overtime_at_booking, settled.estimated_minutes, settled.overtime_fee.amount], [5, false, 275, "0"]);
  for (const key of RULE4_KEYS) assert.ok(!allKeys(tenant.body).has(key), key);
  const guest = await site.call("GET", "/site/v1/order", { token, ip: nextIp() });
  assertMatchesOpenApi("GET", "/site/v1/order", guest);
  assert.ok(!allKeys(guest.body.order.itinerary).has("overtime_at_booking") && !allKeys(guest.body.order.itinerary).has("estimated_minutes"));
  assert.equal(guest.body.price_breakdown.some((item: any) => item.kind === "overtime"), false);

  // 改期：乙把配置改回默认、行程不变——新口径的单按订单的 5h 锁定报价（不重新选档成 4h），预计用时四项照抄原订单
  await setItinerary(m.b, charterB, RESET);
  const moved = await site.call("PATCH", "/site/v1/order", { token, ip: nextIp(), headers: { "if-match": `"${guest.body.order.version}"` }, body: { service_time: "2026-10-21T10:00:00+09:00" } });
  assert.equal(moved.status, 200, moved.text);
  const change = (await api.db.owner.query<{ s: any }>("select settlement_after as s from order_changes where order_id = $1", [orderId])).rows[0]?.s;
  assert.deepEqual([change.totalMinor, change.itinerary.packageMinutes, change.itinerary.overtimeMinor, change.itinerary.overtimeAtBooking, change.itinerary.estimatedMinutes, change.itinerary.stops], [33_000, 300, 0, false, 275, 1]);

  // 救援：经 previewPlatformQuote 传 locked + 订单的档（5h）：甲按 5h 报（34,000），没有超时费
  const triggered = await api.call("POST", `/platform/v1/orders/${orderId}/rescue`, { token: await ops(), body: { trigger: "tenant_declared", note: "M9P-03 新口径救援" } });
  assert.equal(triggered.status, 201, triggered.text);
  const listed = await api.call("GET", `/platform/v1/orders/${orderId}/rescue/candidates`, { token: await ops() });
  assertMatchesOpenApi("GET", "/platform/v1/orders/{id}/rescue/candidates", listed);
  const candidate = listed.body.candidates.find((entry: any) => entry.tenant.id === m.a.tenantId);
  assert.ok(candidate !== undefined, listed.text);
  assert.equal(candidate.settlement.amount, "34000");
});

test("部署前格式的旧单（预收了超时费、快照没有 charterSelection）：订单页明细照旧有超时费一行、之和等于订单价；救援候选不传 charterSelection——档位照旧、超时费照旧收", async () => {
  // 690 分钟的行程：新口径下乙 10h、不收超时费；改成部署前格式——快照请求带套餐时长 10、明细预收 90 分钟 × 6,000 / 小时 = 9,000，客人付 (55,000 + 9,000) × 1.1
  leg.meters = 100_000;
  leg.minutes = 300;
  const quoted = await itinerary("asakusa", 90);
  const { orderId, token } = await placeAndPay(first(quoted).quote_id);
  const prepaid = `jsonb_set(jsonb_set(jsonb_set(settlement #- '{itinerary,overtimeAtBooking}', '{itinerary,overtimeMinor}', '9000'::jsonb), '{totalMinor}', '64000'::jsonb), '{baseMinor}', '64000'::jsonb)`;
  await api.db.owner.query(`update orders set settlement = ${prepaid}, settlement_minor = 64000 where id = $1`, [orderId]);
  await api.db.owner.query("update order_sales set sell_minor = 70400 where order_id = $1", [orderId]);
  await api.db.owner.query(
    `update quotes set snapshot = jsonb_set(jsonb_set(jsonb_set(jsonb_set(snapshot #- '{request,charterSelection}', '{request,packageHours}', '10'::jsonb), '{winner,offer,settlement}', (select settlement from orders where id = $1)), '{winner,sell,sellMinor}', '70400'::jsonb), '{winner,sell,exact}', '"70400"'::jsonb)
     where id = (select quote_id from order_sales where order_id = $1)`,
    [orderId],
  );
  const guest = await site.call("GET", "/site/v1/order", { token, ip: nextIp() });
  assertMatchesOpenApi("GET", "/site/v1/order", guest);
  assert.deepEqual(guest.body.price_breakdown.map((item: any) => [item.kind, item.amount.amount]), [["base", "60500"], ["over_km", "0"], ["overtime", "9900"]]);
  const tenant = await tenantCall(m.b, "GET", `/orders/${orderId}`);
  assert.deepEqual([tenant.body.order.settlement.itinerary.overtime_at_booking, tenant.body.order.settlement.itinerary.overtime_fee.amount], [true, "9000"]);

  const triggered = await api.call("POST", `/platform/v1/orders/${orderId}/rescue`, { token: await ops(), body: { trigger: "tenant_declared", note: "M9P-03 旧单救援" } });
  assert.equal(triggered.status, 201, triggered.text);
  const listed = await api.call("GET", `/platform/v1/orders/${orderId}/rescue/candidates`, { token: await ops() });
  const candidate = listed.body.candidates.find((entry: any) => entry.tenant.id === m.a.tenantId);
  assert.ok(candidate !== undefined, listed.text);
  // 甲按订单的 10h（旧口径）报：56,000 + 超时 90 分钟 × 6,000 / 小时 = 65,000（不是自动选档的 12h、也不是不收超时费的 56,000）
  assert.equal(candidate.settlement.amount, "65000");
});
