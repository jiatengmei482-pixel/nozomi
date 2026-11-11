/**
 * M8-02：按两个坐标报价、不带城市的地址搜索、输入即提示、路线的时间距离（ADR 0069 A1、A2、B1、B11），经真实接口、真实 PostgreSQL；
 * 谷歌（Text Search、Autocomplete、Place Details、Routes）全是本机的假服务器（testing/fake-integrations.ts），**从不调用真实的谷歌**。
 *
 * 覆盖：
 * - 认出机场后的报价和直接调 `POST /site/v1/quotes` 的同一请求**完全一致**（接机、送机、点对点）——证明价格逻辑没变；询价日志多记 mode 和识别结果、不记地址名称；
 * - 两端都是机场按出发地算接机；地址搜索说是机场时放宽到 10 公里；渠道授权外（城市、品类）的机场不认；点对点按出发地选城市、不在任何城市里是 OUT_OF_SERVICE_AREA；
 * - 报不出价的原因（时间太近、人数太多、地址不在服务范围）、输入校验；
 * - 路线：时间、距离、折线随报价返回；同一对坐标 10 分钟内不重复调谷歌；谷歌出错、到了每日上限时为 null，报价不受影响；
 * - 地址搜索不带城市：平台的机场、车站在前，谷歌的结果只要授权城市范围里的、带类型；谷歌用不了时只有平台的地点；
 * - 输入即提示和取坐标：请求的样子（会话令牌、国家、范围、字段掩码）、缓存命中不重复调用、每日上限降级、按来源地址限速、会话令牌和地点 ID 的校验；
 * - 官网没开 503；应答、日志里没有密钥。
 * 测试数据全在本文件里经接口建出来，随测试 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { instantToLocal, regionBounds, routeUsageDay } from "@nozomi/domain";
import type { TenantFixture } from "./testing/api.ts";
import { type TestApi, createTestApi } from "./testing/api.ts";
import {
  type FakeService,
  googleAutocompleteBody,
  googleDetailsBody,
  googleErrorBody,
  googlePlace,
  googlePlacesBody,
  googlePrediction,
  googleRouteBody,
  startFakeGoogleAutocomplete,
  startFakeGooglePlaceDetails,
  startFakeGooglePlaces,
  startFakeGoogleRoutes,
} from "./testing/fake-integrations.ts";
import { FAKE_SECRETS } from "./testing/fixtures.ts";
import { type Market, allValues, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

let api: TestApi;
let m: Market;
let places: FakeService;
let autocomplete: FakeService;
let details: FakeService;
let routes: FakeService;
let site: SiteApi;
let siteClientId: string;
let logs = "";
const opened: SiteApi[] = [];
const ids: Record<string, string> = {};

/** 纬度方向每米多少度 */
const DEG_PER_METER = 180 / (Math.PI * 6_371_008.8);
const NARITA = { lat: 35.7686, lng: 140.3887 };
const HANEDA = { lat: 35.5494, lng: 139.7798 };
const TOKYO_STATION = { lat: 35.6812, lng: 139.7671 };
const SHINJUKU = { lat: 35.6896, lng: 139.7006 };
const TOKYO_TOWER = { lat: 35.6586, lng: 139.7454 };
/** 东京城市范围里、但不在任何供应商营运区（139–140, 35–36）里的点 */
const OUTSIDE_AREA = { lat: 35.62, lng: 138.95 };
const SAPPORO = { lat: 43.0618, lng: 141.3545 };
const northOf = (point: { lat: number; lng: number }, meters: number) => ({ lat: Number((point.lat + meters * DEG_PER_METER).toFixed(6)), lng: point.lng });
/** 测试的时钟从 2026-10-07 开始，离用车足够远 */
const SERVICE_LOCAL = "2026-10-20T10:00";
const POLYLINE = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";

let ipSeq = 0;
const nextIp = (): string => `10.66.${Math.floor(++ipSeq / 200)}.${ipSeq % 200}`;
const googleEnv = (): Record<string, string> => ({
  GOOGLE_PLACES_SEARCH_URL: places.url,
  GOOGLE_PLACES_AUTOCOMPLETE_URL: autocomplete.url,
  GOOGLE_PLACE_DETAILS_URL: details.url,
  GOOGLE_MAPS_ROUTES_URL: routes.url,
});
const openSite = async (env: Record<string, string> = {}, clientId: string | null = siteClientId): Promise<SiteApi> => {
  const app = await siteApi(api, clientId, new FakePaymentProvider(), { ...googleEnv(), ...env }, { integrationSecretsTtlMs: 0 });
  opened.push(app);
  return app;
};
const SESSION = "3f2c1e9a-5b7d-4c1e-9a2b-1234567890ab";
const reset = (): void => {
  for (const fake of [places, autocomplete, details, routes]) fake.requests.length = 0;
  places.respond({ body: googlePlacesBody([googlePlace("ChIJfakeTokyoStation", "東京駅", 35.6812, 139.7671, "日本、〒100-0005 東京都千代田区丸の内１丁目")]) });
  autocomplete.respond({ body: googleAutocompleteBody([googlePrediction("ChIJfakeTokyoStation", "東京駅", "日本、東京都千代田区", ["train_station"])]) });
  details.respond({ body: googleDetailsBody("ChIJfakeTokyoStation", 35.6812, 139.7671, "日本、〒100-0005 東京都千代田区丸の内１丁目", ["train_station"]) });
  routes.respond({ body: googleRouteBody(25_400, 3_570, POLYLINE) });
};
/** 路线的请求（给客人看的路线要折线；报价自己的路线预估不要） */
const previewCalls = (): number => routes.requests.filter((request) => String(request.headers["x-goog-fieldmask"]).includes("polyline")).length;

type End = { lat: number; lng: number; kind?: "airport" | "other"; name?: string };
const end = (point: End, name = "地址"): Record<string, unknown> => ({ name: point.name ?? name, lat: point.lat, lng: point.lng, ...(point.kind === undefined ? {} : { kind: point.kind }) });
const byPoints = (pickup: End, dropoff: End, extra: Record<string, unknown> = {}, app: SiteApi = site) =>
  app.call("POST", "/site/v1/quotes/by-points", { ip: nextIp(), body: { pickup: end(pickup, "出发地"), dropoff: end(dropoff, "目的地"), service_local: SERVICE_LOCAL, passengers: 2, luggage: 1, ...extra } });
const okByPoints = async (pickup: End, dropoff: End, extra: Record<string, unknown> = {}, app: SiteApi = site): Promise<any> => {
  const res = await byPoints(pickup, dropoff, extra, app);
  assertMatchesOpenApi("POST", "/site/v1/quotes/by-points", res);
  assert.equal(res.status, 200, res.text);
  return res.body;
};
const directQuote = async (body: Record<string, unknown>, app: SiteApi = site): Promise<any> => {
  const res = await app.call("POST", "/site/v1/quotes", { ip: nextIp(), body: { service_local: SERVICE_LOCAL, passengers: 2, luggage: 1, ...body } });
  assertMatchesOpenApi("POST", "/site/v1/quotes", res);
  assert.equal(res.status, 200, res.text);
  return res.body;
};
/** 报价里除了 quote_id（每次询价新生成）以外的全部内容 */
const comparable = (result: { currency: string; quotes: any[]; unavailable: any[] }) => ({ currency: result.currency, quotes: result.quotes.map(({ quote_id: _id, ...rest }) => rest), unavailable: result.unavailable });

/** 给供应商建一个东京的点对点商品（区域盖住整个东京，商务 7 座一口价），再上架。 */
async function pointToPointProduct(who: TenantFixture, price: number): Promise<void> {
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
  const brand = (await call("POST", "/brands", { name: `p2p-${who.tenantId.slice(0, 4)}`, currency: "JPY" }, undefined, 201)).id;
  api.clock.advance(1_000);
  const area = (await call("POST", "/areas", { city_id: m.ids.tokyo, name: { zh: "东京-点对点" }, biz_type: "general", polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [[[139.0, 35.0], [140.0, 35.0], [140.0, 36.0], [139.0, 36.0], [139.0, 35.0]]] } }] }, undefined, 201)).id;
  const created = await call("POST", "/products", { brand_id: brand, city_id: m.ids.tokyo, category: "point_to_point", areas: [{ area_id: area }], vehicle_groups: [{ vehicle_group_id: m.ids.biz7, passengers: 6, luggage: 4 }], dispatchers: [{ name: "调度", phone: "0312345678" }] }, undefined, 201);
  const rules = await call("PUT", `/products/${created.id}/service-rules`, { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { general: { mode: "limited", minutes: 30 } } }, 1);
  const version = (await call("PUT", `/products/${created.id}/content`, { zh: { title: "东京市内用车" } }, rules.version)).version as number;
  await call("POST", `/products/${created.id}/price-rules`, { area_id: area, vehicle_group_id: m.ids.biz7, valid_from: "2026-01-01", pricing_model: "fixed", base_price: price }, version, 201);
  await call("POST", `/products/${created.id}/publish`);
}

before(async () => {
  places = await startFakeGooglePlaces();
  autocomplete = await startFakeGoogleAutocomplete();
  details = await startFakeGooglePlaceDetails();
  routes = await startFakeGoogleRoutes();
  api = await createTestApi({ payments: new FakePaymentProvider(), integrationSecretsTtlMs: 0 });
  m = await buildMarket(api);
  await pointToPointProduct(m.a, 15_000);
  await pointToPointProduct(m.b, 16_000);
  const platform = (body: Record<string, unknown>): Promise<any> => ok(api.call("POST", "/platform/v1/master/places", { token: m.root, body }), 201);
  // 羽田：东京的机场，但没有供应商卖它的接送机；关西：大阪的机场
  ids["haneda"] = (await platform({ type: "airport", code: "HND", city_id: m.ids.tokyo, name: { zh: "羽田机场", ja: "東京国際空港" }, location: HANEDA, flight_scope: "international" })).id;
  ids["kix"] = (await platform({ type: "airport", code: "KIX", city_id: m.ids.osaka, name: { zh: "关西机场" }, location: { lat: 34.4347, lng: 135.244 }, flight_scope: "international" })).id;
  ids["terminal"] = (await platform({ type: "terminal", code: "NRT-T1", parent_id: m.ids.narita, name: { zh: "第 1 航站楼" }, location: { lat: 35.764, lng: 140.385 } })).id;
  ids["station"] = (await platform({ type: "station", code: "STN-JP-TOKYO", city_id: m.ids.tokyo, category: "shinkansen", name: { ja: "東京駅", zh: "东京站", en: "Tokyo Station" }, location: TOKYO_STATION })).id;
  ids["closedStation"] = (await platform({ type: "station", code: "STN-JP-CLOSED", city_id: m.ids.tokyo, category: "rail", name: { zh: "东京停用站" }, location: TOKYO_STATION })).id;
  await ok(api.call("POST", `/platform/v1/master/places/${ids["closedStation"]}/disable`, { token: m.root, body: {} }));
  const channel = await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" });
  siteClientId = (await salesCredentials(api, m, channel.id)).clientId;
  site = await siteApi(api, siteClientId, new FakePaymentProvider(), googleEnv(), { integrationSecretsTtlMs: 0, logDestination: { write: (line) => void (logs += line) } });
  reset();
});
after(async () => {
  for (const app of [site, ...opened]) await app?.close();
  await api.close();
  for (const fake of [places, autocomplete, details, routes]) await fake.close();
});

test("接机：出发地离成田 500 米 → 认成成田、接机；报价和直接调 POST /site/v1/quotes（成田、接机、目的地坐标）完全一致；询价日志多记 mode 和识别结果、不记地址名称", async () => {
  reset();
  const pickup = northOf(NARITA, 500);
  const res = await okByPoints({ ...pickup, name: "成田空港 第1ターミナル到着ロビー" }, { ...TOKYO_STATION, name: "東京都千代田区丸の内1-9-1 某某酒店" });
  assert.equal(res.trip_type, "pickup");
  assert.deepEqual(res.airport, { id: m.ids.narita, code: "NRT", name: { zh: "成田机场" }, matched_by: "distance", distance_meters: 500, flight_scope: "international" });
  assert.equal(res.fallback_category, null, "接送机商品报得出：不改用点对点商品（M8-33）");
  assert.deepEqual(res.city, { id: m.ids.tokyo, code: "CTY-JP-TYO", name: { zh: "东京" }, timezone: "Asia/Tokyo" });
  assert.ok(res.quotes.length >= 2, res.text);
  const direct = await directQuote({ city_id: m.ids.tokyo, airport_id: m.ids.narita, direction: "pickup", address: { lng: TOKYO_STATION.lng, lat: TOKYO_STATION.lat } });
  assert.deepEqual(comparable(res), comparable(direct), "价格、车型、免费等待、取消政策、有效期都一样");
  // 按价格从低到高；expires_at 是最早到期的那个
  const prices = res.quotes.map((quote: any) => Number(quote.price.total.amount));
  assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
  assert.equal(res.expires_at, [...res.quotes.map((quote: any) => quote.expires_at)].sort()[0]);

  const logRow = (await api.db.owner.query("select request, category, city_id from quote_logs where request->>'mode' = 'by_points' and request->'recognition'->'pickup'->>'lat' = $1", [String(pickup.lat)])).rows[0];
  assert.equal(logRow.category, "airport_transfer");
  assert.equal(logRow.city_id, m.ids.tokyo);
  assert.equal(logRow.request.source, "site");
  assert.equal(logRow.request.airport_id, m.ids.narita);
  assert.equal(logRow.request.direction, "pickup");
  assert.deepEqual(logRow.request.recognition, {
    trip_type: "pickup",
    airport_id: m.ids.narita,
    pickup: { lat: pickup.lat, lng: pickup.lng, kind: null, airport_id: m.ids.narita, meters: 500, matched_by: "distance" },
    dropoff: { lat: TOKYO_STATION.lat, lng: TOKYO_STATION.lng, kind: null, airport_id: null, meters: null, matched_by: null },
  });
  const logged = JSON.stringify(logRow.request);
  assert.ok(!logged.includes("某某酒店") && !logged.includes("到着ロビー"), "地址的名称不进询价日志");
  // 识别出来的报价能照常下单（同一张报价表）
  const stored = (await api.db.owner.query("select count(*)::int as n from quotes where id = any($1::text[])", [res.quotes.map((quote: any) => quote.quote_id)])).rows[0].n;
  assert.equal(stored, res.quotes.length);
});

test("送机：目的地是地址搜索说的机场、离成田 6 公里 → 放宽认成成田（matched_by kind）；和直接询价完全一致。没有类型时同一个点不认", async () => {
  reset();
  const terminal = { ...northOf(NARITA, -6_000), kind: "airport" as const };
  const res = await okByPoints(TOKYO_STATION, terminal);
  assert.equal(res.trip_type, "dropoff");
  assert.deepEqual([res.airport.id, res.airport.matched_by, res.airport.distance_meters], [m.ids.narita, "kind", 6_000]);
  const direct = await directQuote({ city_id: m.ids.tokyo, airport_id: m.ids.narita, direction: "dropoff", address: { lng: TOKYO_STATION.lng, lat: TOKYO_STATION.lat } });
  assert.deepEqual(comparable(res), comparable(direct));
  assert.ok(res.quotes.length > 0);
  const plain = await okByPoints(TOKYO_STATION, { lat: terminal.lat, lng: terminal.lng });
  assert.equal(plain.trip_type, "point_to_point", "6 公里外、没有类型：不是机场");
  assert.equal(plain.airport, null);
});

test("两端都是机场：按出发地（羽田）算接机，目的地（成田附近）当地址那一端；羽田没有商品 → NO_PRODUCT", async () => {
  reset();
  const res = await okByPoints(northOf(HANEDA, 200), northOf(NARITA, 300));
  assert.equal(res.trip_type, "pickup");
  assert.equal(res.airport.id, ids["haneda"]);
  assert.deepEqual(res.quotes, []);
  assert.deepEqual(res.unavailable, [{ vehicle_group_id: null, reasons: ["NO_PRODUCT"] }]);
  assert.equal(res.expires_at, null);
  const direct = await directQuote({ city_id: m.ids.tokyo, airport_id: ids["haneda"], direction: "pickup", address: northOf(NARITA, 300) });
  assert.deepEqual(comparable(res), comparable(direct));
});

test("接送机报不出改用点对点商品（M8-33，ADR 0081）：羽田没有接送机商品 → 按出发地所在的东京用点对点商品报，和直接询价点对点完全一致；仍是接机、免费等待按所选商品自己设的；询价日志记 fallback_from", async () => {
  reset();
  const pickup = northOf(HANEDA, 200);
  const res = await okByPoints(pickup, TOKYO_STATION);
  assert.equal(res.trip_type, "pickup", "行程仍按接机处理（航班号、免费等待、举牌）");
  assert.equal(res.airport.id, ids["haneda"]);
  assert.equal(res.fallback_category, "point_to_point");
  assert.equal(res.city.id, m.ids.tokyo);
  const direct = await directQuote({ category: "point_to_point", city_id: m.ids.tokyo, pickup: { lng: pickup.lng, lat: pickup.lat }, dropoff: { lng: TOKYO_STATION.lng, lat: TOKYO_STATION.lat } });
  assert.ok(direct.quotes.length > 0, "前提：同一段点对点报得出");
  assert.deepEqual(comparable(res), comparable(direct));
  assert.deepEqual(res.quotes.map((quote: any) => quote.free_wait_minutes), direct.quotes.map(() => 30), "点对点商品自己设的 30 分钟");
  const airportOnly = await directQuote({ city_id: m.ids.tokyo, airport_id: ids["haneda"], direction: "pickup", address: { lng: TOKYO_STATION.lng, lat: TOKYO_STATION.lat } });
  assert.deepEqual([airportOnly.quotes, airportOnly.unavailable], [[], [{ vehicle_group_id: null, reasons: ["NO_PRODUCT"] }]], "接送机本身仍报不出（没有改动接送机的规则）");
  const logs = (await api.db.owner.query("select category, request from quote_logs where request->>'mode' = 'by_points' and request->'recognition'->>'airport_id' = $1 and request->'recognition'->'pickup'->>'lat' = $2 and request->'recognition'->'dropoff'->>'lat' = $3", [ids["haneda"], String(pickup.lat), String(TOKYO_STATION.lat)])).rows;
  assert.deepEqual(logs.map((row: any) => [row.category, row.request.fallback_from ?? null]).sort(), [["airport_transfer", null], ["point_to_point", "airport_transfer"]]);
  // 下单按点对点（报价快照的品类）：两端地址都要，不收航班号（客人页把航班号写进备注）
  const order = (body: Record<string, unknown>) => site.call("POST", "/site/v1/orders", { headers: { "idempotency-key": randomUUID() }, ip: nextIp(), body: { quote_id: res.quotes[0].quote_id, passenger: { name: "陈小红", phone: "+81 90-2222-3333", email: "fallback.guest@example.com" }, save_payment_method: true, pickup_address: "羽田空港 第3ターミナル", dropoff_address: "東京駅", ...body } });
  const withFlight = await order({ flight_no: "NH211" });
  assert.deepEqual([withFlight.status, withFlight.body.error?.details?.issues?.map((issue: any) => [issue.path, issue.reason])], [400, [["/flight_no", "NOT_APPLICABLE"]]]);
  const created = await order({ notes: "航班号：NH211\n举牌姓名：陈小红" });
  assert.equal(created.status, 201, created.text);
  assert.equal(created.body.order.category, "point_to_point");
});

test("接送机、点对点都报不出：保留接送机的原因，fallback_category 为 null（M8-33）", async () => {
  reset();
  const res = await okByPoints(northOf(HANEDA, 200), OUTSIDE_AREA);
  assert.equal(res.trip_type, "pickup");
  assert.equal(res.fallback_category, null);
  assert.deepEqual(res.quotes, []);
  assert.deepEqual(res.unavailable, [{ vehicle_group_id: null, reasons: ["NO_PRODUCT"] }]);
});

test("点对点：两端都不是机场 → 按出发地所在的城市（东京）报点对点；和直接询价完全一致，价低的在前", async () => {
  reset();
  const res = await okByPoints(TOKYO_STATION, SHINJUKU);
  assert.equal(res.trip_type, "point_to_point");
  assert.equal(res.airport, null);
  assert.equal(res.city.id, m.ids.tokyo);
  const direct = await directQuote({ category: "point_to_point", city_id: m.ids.tokyo, pickup: { lng: TOKYO_STATION.lng, lat: TOKYO_STATION.lat }, dropoff: { lng: SHINJUKU.lng, lat: SHINJUKU.lat } });
  assert.deepEqual(comparable(res), comparable(direct));
  assert.deepEqual(res.quotes.map((quote: any) => quote.price.total.amount), direct.quotes.map((quote: any) => quote.price.total.amount));
  assert.ok(res.quotes.length > 0);
  const logRow = (await api.db.owner.query("select request, category from quote_logs where request->>'mode' = 'by_points' and request->'recognition'->>'trip_type' = 'point_to_point' and request->'pickup'->>'lat' = $1 limit 1", [String(TOKYO_STATION.lat)])).rows[0];
  assert.deepEqual([logRow.category, logRow.request.recognition.trip_type, logRow.request.recognition.airport_id], ["point_to_point", "point_to_point", null]);
});

test("渠道授权外的机场不认：只卖大阪的官网、只卖点对点的官网，成田附近的出发地都不算机场", async () => {
  reset();
  const osakaOnly = await newChannel(api, m.staff.cm1.token, { name: "只卖大阪的官网", scope: { city_ids: [m.ids.osaka] } });
  const osakaSite = await openSite({}, (await salesCredentials(api, m, osakaOnly.id)).clientId);
  const fromNarita = await okByPoints(northOf(NARITA, 500), TOKYO_STATION, {}, osakaSite);
  assert.deepEqual([fromNarita.trip_type, fromNarita.airport, fromNarita.city], ["point_to_point", null, null]);
  assert.deepEqual(fromNarita.unavailable, [{ vehicle_group_id: null, reasons: ["OUT_OF_SERVICE_AREA"] }]);

  const p2pOnly = await newChannel(api, m.staff.cm1.token, { name: "只卖点对点的官网", scope: { categories: ["point_to_point"] } });
  const p2pSite = await openSite({}, (await salesCredentials(api, m, p2pOnly.id)).clientId);
  const res = await okByPoints(northOf(NARITA, 500), TOKYO_STATION, {}, p2pSite);
  assert.deepEqual([res.trip_type, res.airport, res.city?.id], ["point_to_point", null, m.ids.tokyo]);
  // 成田附近不在点对点供应商的营运区里
  assert.ok(res.unavailable.some((entry: any) => entry.reasons.includes("OUT_OF_SERVICE_AREA")), JSON.stringify(res));
  // 停用的机场也不认
  await ok(api.call("POST", `/platform/v1/master/places/${ids["haneda"]}/disable`, { token: m.root, body: {} }));
  try {
    const disabled = await okByPoints(northOf(HANEDA, 100), TOKYO_STATION);
    assert.equal(disabled.trip_type, "point_to_point");
  } finally {
    await ok(api.call("POST", `/platform/v1/master/places/${ids["haneda"]}/enable`, { token: m.root, body: {} }));
  }
});

test("报不出价的原因：时间太近 LEAD_TIME_TOO_SHORT、人数太多 CAPACITY_EXCEEDED、地址不在营运区 / 不在任何城市 OUT_OF_SERVICE_AREA", async () => {
  reset();
  const soon = instantToLocal(new Date(api.clock.now().getTime() + 3_600_000), "Asia/Tokyo").dateTime;
  const tooSoon = await okByPoints(northOf(NARITA, 500), TOKYO_STATION, { service_local: soon });
  assert.deepEqual(tooSoon.quotes, []);
  assert.ok(tooSoon.unavailable.some((entry: any) => entry.reasons.includes("LEAD_TIME_TOO_SHORT")), JSON.stringify(tooSoon));
  const crowd = await okByPoints(northOf(NARITA, 500), TOKYO_STATION, { passengers: 7 });
  assert.deepEqual(crowd.quotes, []);
  assert.ok(crowd.unavailable.some((entry: any) => entry.reasons.includes("CAPACITY_EXCEEDED")), JSON.stringify(crowd));
  const outside = await okByPoints(northOf(NARITA, 500), OUTSIDE_AREA);
  assert.equal(outside.trip_type, "pickup");
  assert.ok(outside.unavailable.some((entry: any) => entry.reasons.includes("OUT_OF_SERVICE_AREA")), JSON.stringify(outside));
  const before = routes.requests.length;
  const nowhere = await okByPoints(SAPPORO, { lat: 43.07, lng: 141.35 });
  assert.deepEqual([nowhere.trip_type, nowhere.city, nowhere.quotes, nowhere.unavailable, nowhere.route], ["point_to_point", null, [], [{ vehicle_group_id: null, reasons: ["OUT_OF_SERVICE_AREA"] }], null]);
  assert.equal(routes.requests.length, before, "不在任何城市里时不算路线（不花钱）");
});

test("输入校验：缺名称、名称是空白、类型不对、坐标不合法、多余的字段、不存在的当地时间 → 400，不调用谷歌", async () => {
  reset();
  const bad = async (body: Record<string, unknown>, label: string): Promise<void> => {
    const res = await site.call("POST", "/site/v1/quotes/by-points", { ip: nextIp(), body });
    assertMatchesOpenApi("POST", "/site/v1/quotes/by-points", res);
    assert.equal(res.status, 400, `${label}: ${res.text}`);
    assert.equal(res.body.error.code, "VALIDATION_FAILED", label);
  };
  const base = { pickup: end(TOKYO_STATION), dropoff: end(SHINJUKU), service_local: SERVICE_LOCAL, passengers: 2 };
  await bad({ ...base, pickup: { lat: 35.68, lng: 139.76 } }, "缺名称");
  await bad({ ...base, pickup: { ...end(TOKYO_STATION), name: "   " } }, "名称是空白");
  await bad({ ...base, pickup: { ...end(TOKYO_STATION), kind: "station" } }, "类型不对");
  await bad({ ...base, dropoff: { ...end(SHINJUKU), lat: 95 } }, "坐标不合法");
  await bad({ ...base, city_id: m.ids.tokyo }, "多余的字段");
  await bad({ ...base, pickup: { ...end(TOKYO_STATION), tenant_id: randomUUID() } }, "一端里多余的字段");
  await bad({ ...base, service_local: "2026-10-20 10:00" }, "时间格式");
  await bad({ ...base, passengers: 0 }, "人数");
  assert.equal(previewCalls(), 0);
  const notExisting = await site.call("POST", "/site/v1/quotes/by-points", { ip: nextIp(), body: { ...base, service_local: "2026-02-30T10:00" } });
  assert.equal(notExisting.status, 400, notExisting.text);
});

test("路线：时间、距离、折线随报价返回（谷歌 Routes，要了折线、不考虑路况）；同一对坐标 10 分钟内不再调谷歌；换一对坐标再调", async () => {
  reset();
  const first = await okByPoints(TOKYO_STATION, TOKYO_TOWER);
  assert.deepEqual(first.route, { minutes: 60, meters: 25_400, polyline: POLYLINE });
  assert.equal(previewCalls(), 1);
  const [request] = routes.requests.filter((r) => String(r.headers["x-goog-fieldmask"]).includes("polyline")) as [FakeService["requests"][number]];
  assert.equal(request.headers["x-goog-fieldmask"], "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline");
  assert.equal(request.headers["x-goog-api-key"], FAKE_SECRETS.googleMapsApiKey);
  const body = JSON.parse(request.body);
  assert.deepEqual([body.routingPreference, body.travelMode, body.computeAlternativeRoutes], ["TRAFFIC_UNAWARE", "DRIVE", false]);
  assert.deepEqual(body.origin.location.latLng, { latitude: 35.681, longitude: 139.767 }, "坐标取整到 3 位（和报价的路线缓存同一个键）");
  const again = await okByPoints(TOKYO_STATION, TOKYO_TOWER, { passengers: 3 });
  assert.deepEqual(again.route, first.route);
  assert.equal(previewCalls(), 1, "缓存命中，不重复调用");
  await okByPoints(TOKYO_TOWER, TOKYO_STATION);
  assert.equal(previewCalls(), 2, "反方向是另一对坐标");
  // 里程和时长也进了报价的路线缓存（报价按里程算价的商品可以直接用）
  const cached = (await api.db.owner.query("select distance_meters as meters, duration_seconds as seconds from route_estimates where cache_key = $1", ["v1:35.681,139.767>35.659,139.745"])).rows[0];
  assert.deepEqual(cached, { meters: 25_400, seconds: 3_570 });
});

test("路线降级：谷歌出错、到了每日上限（GOOGLE_ROUTES_DAILY_LIMIT）时 route 为 null，报价照常；上限时不发请求", async () => {
  reset();
  routes.respond({ status: 500, body: {} });
  const failing = await openSite();
  const res = await okByPoints(TOKYO_STATION, { lat: 35.7, lng: 139.71 }, {}, failing);
  assert.equal(res.route, null);
  assert.ok(res.quotes.length > 0, "路线取不到不影响报价");
  assert.ok(previewCalls() >= 1);
  reset();
  const used = (await api.db.owner.query("select coalesce(sum(calls), 0)::int as calls from route_api_usage where day = $1", [routeUsageDay(api.clock.now())])).rows[0].calls as number;
  const limited = await openSite({ GOOGLE_ROUTES_DAILY_LIMIT: String(used) });
  const capped = await okByPoints(TOKYO_STATION, { lat: 35.71, lng: 139.72 }, {}, limited);
  assert.equal(capped.route, null);
  assert.ok(capped.quotes.length > 0);
  assert.equal(previewCalls(), 0, "到了每日上限不发请求");
  const refused = (await api.db.owner.query("select refused from route_api_usage where day = $1", [routeUsageDay(api.clock.now())])).rows[0].refused as number;
  assert.ok(refused >= 1);
});

test("地址搜索不带城市：平台的机场、航站楼在前（带坐标、类型 airport）；谷歌的只要授权城市范围里的、带类型；授权的只有日本 → regionCode JP、范围是几个城市合起来的", async () => {
  reset();
  places.respond({
    body: googlePlacesBody([
      { ...(googlePlace("ChIJnrt", "成田国際空港", 35.772, 140.3929, "日本、千葉県成田市") as object), primaryType: "international_airport" },
      googlePlace("ChIJnagoya", "名古屋駅", 35.1709, 136.8815, "日本、愛知県名古屋市"),
    ]),
  });
  const res = await site.call("GET", `/site/v1/places/search?q=${encodeURIComponent("成田")}`, { ip: nextIp() });
  assertMatchesOpenApi("GET", "/site/v1/places/search", res);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.available, true);
  assert.deepEqual(
    res.body.items.map((item: any) => [item.source, item.id, item.name, item.kind]),
    [
      ["platform", m.ids.narita, "成田机场", "airport"],
      ["platform", ids["terminal"], "成田机场 第 1 航站楼", "airport"],
      ["google", "ChIJnrt", "成田国際空港", "airport"],
    ],
    "名古屋不在任何授权城市的范围里，丢掉",
  );
  assert.deepEqual(res.body.items[0].location, NARITA);
  const request = JSON.parse((places.requests[0] as FakeService["requests"][number]).body);
  const bounds = regionBounds([{ lat: 35.6895, lng: 139.6917 }, { lat: 34.7, lng: 135.5 }]);
  assert.equal(request.regionCode, "JP");
  assert.deepEqual(request.locationRestriction.rectangle, { low: { latitude: bounds?.low.lat, longitude: bounds?.low.lng }, high: { latitude: bounds?.high.lat, longitude: bounds?.high.lng } });
  // 车站也在前；停用的不出
  const station = await ok(site.call("GET", `/site/v1/places/search?q=${encodeURIComponent("东京站")}`, { ip: nextIp() }));
  assert.deepEqual(station.items.filter((item: any) => item.source === "platform").map((item: any) => [item.id, item.kind]), [[ids["station"], "other"]]);
  // 带城市时照旧（城市里的平台地点在前）
  const inCity = await ok(site.call("GET", `/site/v1/places/search?city_id=${m.ids.osaka}&q=${encodeURIComponent("关西")}`, { ip: nextIp() }));
  assert.deepEqual(inCity.items.filter((item: any) => item.source === "platform").map((item: any) => item.id), [ids["kix"]]);
});

test("地址搜索：谷歌用不了时 available false，只给平台的地点（降级）；同一关键字 10 分钟内不重复调谷歌", async () => {
  reset();
  const q = `成田 ${randomUUID().slice(0, 6)}`;
  await ok(site.call("GET", `/site/v1/places/search?q=${encodeURIComponent(q)}`, { ip: nextIp() }));
  await ok(site.call("GET", `/site/v1/places/search?q=${encodeURIComponent(q.toUpperCase())}`, { ip: nextIp() }));
  assert.equal(places.requests.length, 1, "缓存命中");
  places.respond({ status: 503, body: {} });
  const failing = await openSite();
  const res = await failing.call("GET", `/site/v1/places/search?q=${encodeURIComponent("成田机场")}`, { ip: nextIp() });
  assertMatchesOpenApi("GET", "/site/v1/places/search", res);
  assert.equal(res.body.available, false);
  assert.deepEqual(res.body.items.map((item: any) => [item.source, item.id]), [["platform", m.ids.narita], ["platform", ids["terminal"]]]);
});

test("输入即提示：平台的机场、车站在前（带坐标），谷歌的候选在后（没有坐标、带类型）；请求带会话令牌、授权的国家和范围、字段掩码，密钥只在请求头", async () => {
  reset();
  autocomplete.respond({ body: googleAutocompleteBody([googlePrediction("ChIJhnd", "羽田空港", "日本、東京都大田区", ["international_airport", "airport"]), googlePrediction("ChIJhilton", "ヒルトン東京", "日本、東京都新宿区", ["lodging"])]) });
  const res = await site.call("GET", `/site/v1/places/autocomplete?q=${encodeURIComponent("東京")}&session=${SESSION}`, { ip: nextIp() });
  assertMatchesOpenApi("GET", "/site/v1/places/autocomplete", res);
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.body, {
    available: true,
    items: [
      { source: "platform", id: ids["haneda"], name: "羽田机场", address: "", location: HANEDA, kind: "airport" },
      { source: "platform", id: ids["station"], name: "东京站", address: "", location: TOKYO_STATION, kind: "other" },
      { source: "google", id: "ChIJhnd", name: "羽田空港", address: "日本、東京都大田区", location: null, kind: "airport" },
      { source: "google", id: "ChIJhilton", name: "ヒルトン東京", address: "日本、東京都新宿区", location: null, kind: "other" },
    ],
  });
  assert.equal(autocomplete.requests.length, 1);
  const [request] = autocomplete.requests as [FakeService["requests"][number]];
  assert.equal(request.method, "POST");
  assert.equal(request.headers["x-goog-api-key"], FAKE_SECRETS.googleMapsApiKey);
  assert.equal(request.headers["x-goog-fieldmask"], "suggestions.placePrediction.placeId,suggestions.placePrediction.structuredFormat,suggestions.placePrediction.text,suggestions.placePrediction.types");
  assert.ok(!request.path.includes("AIza") && !request.body.includes(FAKE_SECRETS.googleMapsApiKey));
  const body = JSON.parse(request.body);
  const bounds = regionBounds([{ lat: 35.6895, lng: 139.6917 }, { lat: 34.7, lng: 135.5 }]);
  assert.deepEqual(body, {
    input: "東京",
    sessionToken: SESSION,
    languageCode: "zh-CN",
    includedRegionCodes: ["JP"],
    locationRestriction: { rectangle: { low: { latitude: bounds?.low.lat, longitude: bounds?.low.lng }, high: { latitude: bounds?.high.lat, longitude: bounds?.high.lng } } },
  });
});

test("输入即提示的缓存：同一关键字（大小写、全角半角不同、换了会话）10 分钟内不再调谷歌；选中后取坐标也缓存", async () => {
  reset();
  const q = `Hilton ${randomUUID().slice(0, 6)}`;
  await ok(site.call("GET", `/site/v1/places/autocomplete?q=${encodeURIComponent(q)}&session=${SESSION}`, { ip: nextIp() }));
  await ok(site.call("GET", `/site/v1/places/autocomplete?q=${encodeURIComponent(q.toUpperCase().normalize("NFKC"))}&session=${randomUUID()}`, { ip: nextIp() }));
  assert.equal(autocomplete.requests.length, 1);
  const picked = await site.call("GET", `/site/v1/places/details?id=ChIJfakeTokyoStation&session=${SESSION}`, { ip: nextIp() });
  assertMatchesOpenApi("GET", "/site/v1/places/details", picked);
  assert.deepEqual(picked.body, { available: true, place: { id: "ChIJfakeTokyoStation", address: "日本、〒100-0005 東京都千代田区丸の内１丁目", location: TOKYO_STATION, kind: "other" } });
  const [request] = details.requests as [FakeService["requests"][number]];
  assert.equal(request.method, "GET");
  assert.equal(request.path, `/v1/places/ChIJfakeTokyoStation?languageCode=zh-CN&sessionToken=${SESSION}`);
  assert.equal(request.headers["x-goog-fieldmask"], "id,formattedAddress,location,types");
  assert.equal(request.headers["x-goog-api-key"], FAKE_SECRETS.googleMapsApiKey);
  await ok(site.call("GET", `/site/v1/places/details?id=ChIJfakeTokyoStation&session=${randomUUID()}`, { ip: nextIp() }));
  assert.equal(details.requests.length, 1, "同一个地点不再调");
  // 机场的类型
  details.respond({ body: googleDetailsBody("ChIJhnd", 35.5494, 139.7798, "日本、東京都大田区羽田空港", ["international_airport"]) });
  const airport = await ok(site.call("GET", `/site/v1/places/details?id=ChIJhnd`, { ip: nextIp() }));
  assert.equal(airport.place.kind, "airport");
  assert.equal((details.requests[1] as FakeService["requests"][number]).path, "/v1/places/ChIJhnd?languageCode=zh-CN", "不带会话令牌按单次计费");
});

test("输入即提示的降级：到了每日上限（GOOGLE_PLACES_DAILY_LIMIT，和搜索、反查合计）不调谷歌，available false，只有平台的地点；取坐标同样 available false", async () => {
  reset();
  const used = (await api.db.owner.query("select coalesce(sum(calls), 0)::int as calls from place_api_usage where day = $1", [routeUsageDay(api.clock.now())])).rows[0].calls as number;
  const limited = await openSite({ GOOGLE_PLACES_DAILY_LIMIT: String(used) });
  const res = await limited.call("GET", `/site/v1/places/autocomplete?q=${encodeURIComponent("成田 机场")}&session=${SESSION}`, { ip: nextIp() });
  assertMatchesOpenApi("GET", "/site/v1/places/autocomplete", res);
  assert.equal(res.body.available, false);
  assert.deepEqual(res.body.items.map((item: any) => [item.source, item.id]), [["platform", m.ids.narita], ["platform", ids["terminal"]]]);
  const picked = await limited.call("GET", `/site/v1/places/details?id=ChIJsomething&session=${SESSION}`, { ip: nextIp() });
  assertMatchesOpenApi("GET", "/site/v1/places/details", picked);
  assert.deepEqual(picked.body, { available: false, place: null });
  assert.deepEqual([autocomplete.requests.length, details.requests.length], [0, 0]);
  // 谷歌报错也一样
  autocomplete.respond({ status: 429, body: googleErrorBody(429, "RESOURCE_EXHAUSTED", "RATE_LIMIT_EXCEEDED") });
  const failing = await openSite();
  const quota = await ok(failing.call("GET", `/site/v1/places/autocomplete?q=${encodeURIComponent("羽田")}&session=${SESSION}`, { ip: nextIp() }));
  assert.deepEqual([quota.available, quota.items.map((item: any) => item.id)], [false, [ids["haneda"]]]);
});

test("输入即提示的校验：关键字太短、会话令牌缺少 / 格式不对、地点 ID 格式不对、多余的参数 → 400，不调用谷歌", async () => {
  reset();
  const bad = async (url: string, reason: string | null): Promise<void> => {
    const res = await site.call("GET", url, { ip: nextIp() });
    assertMatchesOpenApi("GET", url.split("?")[0] as string, res);
    assert.equal(res.status, 400, `${url} ${res.text}`);
    if (reason !== null) assert.ok(res.body.error.details.issues.some((issue: any) => issue.reason === reason), `${url} ${res.text}`);
  };
  await bad(`/site/v1/places/autocomplete?q=${encodeURIComponent(" 站 ")}&session=${SESSION}`, "TOO_SHORT");
  await bad(`/site/v1/places/autocomplete?q=${encodeURIComponent("东京站")}`, null);
  await bad(`/site/v1/places/autocomplete?q=${encodeURIComponent("东京站")}&session=short`, null);
  await bad(`/site/v1/places/autocomplete?q=${encodeURIComponent("东京站")}&session=${SESSION}&city_id=${m.ids.tokyo}`, null);
  await bad(`/site/v1/places/details?id=${encodeURIComponent("bad id!")}&session=${SESSION}`, null);
  await bad(`/site/v1/places/details?session=${SESSION}`, null);
  await bad(`/site/v1/places/search?q=${encodeURIComponent("东京站")}&city_id=${randomUUID()}`, "UNKNOWN_CITY");
  assert.deepEqual([places.requests.length, autocomplete.requests.length, details.requests.length], [0, 0, 0]);
});

test("输入即提示按来源地址限速：每分钟 60 次（和取坐标合计），第 61 次 429 + Retry-After；换个地址不受影响", async () => {
  reset();
  const ip = "203.0.113.91";
  const url = `/site/v1/places/autocomplete?q=${encodeURIComponent("限速 测试")}&session=${SESSION}`;
  for (let i = 0; i < 59; i++) assert.equal((await site.call("GET", url, { ip })).status, 200, `第 ${i + 1} 次`);
  assert.equal((await site.call("GET", `/site/v1/places/details?id=ChIJfakeTokyoStation&session=${SESSION}`, { ip })).status, 200);
  const limited = await site.call("GET", url, { ip });
  assertMatchesOpenApi("GET", "/site/v1/places/autocomplete", limited);
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, "RATE_LIMITED");
  assert.ok(Number(limited.headers["retry-after"]) > 0);
  assert.equal((await site.call("GET", url, { ip: "203.0.113.92" })).status, 200);
  assert.equal(autocomplete.requests.length, 1, "同一关键字只调了一次谷歌");
});

test("官网没开：按两个坐标报价、输入即提示、取坐标、不带城市的搜索都是 503 SITE_NOT_OPEN，不调用谷歌", async () => {
  reset();
  const closed = await openSite({}, null);
  const calls: [string, string, unknown?][] = [
    ["POST", "/site/v1/quotes/by-points", { pickup: end(TOKYO_STATION), dropoff: end(SHINJUKU), service_local: SERVICE_LOCAL, passengers: 2 }],
    ["GET", `/site/v1/places/autocomplete?q=${encodeURIComponent("东京站")}&session=${SESSION}`],
    ["GET", `/site/v1/places/details?id=ChIJfakeTokyoStation&session=${SESSION}`],
    ["GET", `/site/v1/places/search?q=${encodeURIComponent("东京站")}`],
  ];
  for (const [method, url, body] of calls) {
    const res = await closed.call(method as "GET" | "POST", url, { ip: nextIp(), ...(body === undefined ? {} : { body }) });
    assertMatchesOpenApi(method as "GET" | "POST", url.split("?")[0] as string, res);
    assert.deepEqual([res.status, res.body.error.code], [503, "SITE_NOT_OPEN"], url);
  }
  assert.deepEqual([places.requests.length, autocomplete.requests.length, details.requests.length, routes.requests.length], [0, 0, 0, 0]);
});

test("密钥不外泄：新接口的应答、日志里都没有谷歌密钥的原文（按值比对）", async () => {
  reset();
  const responses = [
    await byPoints(TOKYO_STATION, { lat: 35.72, lng: 139.73 }),
    await site.call("GET", `/site/v1/places/autocomplete?q=${encodeURIComponent("密钥 检查")}&session=${SESSION}`, { ip: nextIp() }),
    await site.call("GET", `/site/v1/places/details?id=ChIJkeycheck&session=${SESSION}`, { ip: nextIp() }),
    await site.call("GET", `/site/v1/places/search?q=${encodeURIComponent("密钥 检查")}`, { ip: nextIp() }),
  ];
  autocomplete.respond({ status: 403, body: googleErrorBody(403, "PERMISSION_DENIED", "API_KEY_SERVICE_BLOCKED") });
  responses.push(await site.call("GET", `/site/v1/places/autocomplete?q=${encodeURIComponent("密钥 检查 二")}&session=${SESSION}`, { ip: nextIp() }));
  for (const res of responses) {
    assert.equal(res.status, 200, res.text);
    assert.ok(!allValues(res.body).has(FAKE_SECRETS.googleMapsApiKey), "应答里有密钥");
    assert.ok(!res.text.includes(FAKE_SECRETS.googleMapsApiKey), "应答原文里有密钥");
  }
  assert.ok(!logs.includes(FAKE_SECRETS.googleMapsApiKey), "日志里有密钥");
  assert.match(logs, /"placeFailure":"KEY_RESTRICTED"/);
});
