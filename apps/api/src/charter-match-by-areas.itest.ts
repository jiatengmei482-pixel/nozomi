/**
 * M9P-02（ADR 0093 第三节；业主规格 2026-11-14 步骤 1）：包车按上下车点匹配商品，不再按「上车点所在城市」筛，经真实接口、真实 PostgreSQL。
 * - 官网包车询价可以不带 city_id：上车点、下车点都落在商品的①基础价区域或③上下车加价区域里就由这个商品报价，应答带 `city`；
 *   规格第六节用例 4、5、8、18 由东京包车报价（河口湖、镰仓站在城市范围外也能报），用例 11（甲府上车）不报、记未覆盖需求，用例 12（甲府经停）不报；
 * - 带 city_id 的旧请求照旧；接送机、点对点仍要 city_id；
 * - `GET /site/v1/charter-packages?pickup=&dropoff=`：按匹配到的商品列套餐；
 * - 匹配到两个城市时只取一个（请求的城市 → 上车点所在城市 → 编号最小），写一条警告日志。
 * 金额按规格（东京市内 10h 55,000、5h 33,000；富士山、箱根上下车 / 经停 10,000，镰仓 8,000；结算价，对外价 × 1.1）。
 * 只断言和经停加价口径无关的部分（M9P-01 改经停加价）；总价验收放在 M9P-11。测试数据全在本文件里经接口建出来（规则 1）。
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
let logs = "";
/** 乙的东京包车：①东京市内；③富士山、箱根、镰仓 */
let charter: { id: string; tokyo: string; fuji: string; hakone: string; kamakura: string };

const square = (west: number, south: number, east: number, north: number) => ({ type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] });
const P = {
  shinjuku: { lat: 35.6905, lng: 139.7005 },
  asakusa: { lat: 35.7148, lng: 139.7967 },
  /** 河口湖：离东京市中心约 85 公里，在城市范围（80 公里）外——P0 #2 以前新预订页在这一步就停了 */
  kawaguchiko: { lat: 35.5106, lng: 138.7637 },
  oshinoHakkai: { lat: 35.4602, lng: 138.8327 },
  ashinoko: { lat: 35.2, lng: 139.0 },
  kamakuraStation: { lat: 35.3192, lng: 139.5505 },
  kofu: { lat: 35.6622, lng: 138.5683 },
} satisfies Record<string, LatLng>;
type Place = keyof typeof P;
const SERVICE_LOCAL = "2026-12-01T09:00";
/** 路线替身（按行程计价用）：每一段 50 公里、60 分钟 */
const routeLookup = async (): Promise<RouteLookup> => ({ ok: true, route: { meters: 50_000, minutes: 60 }, source: "google" });
let ipSeq = 0;
const nextIp = (): string => `10.93.${(ipSeq += 1)}.9`;

async function tenantCall(who: TenantFixture, method: HttpMethod, path: string, options: { body?: unknown; version?: number } = {}): Promise<ApiResponse> {
  const token = await tenantLogin(api, who.adminEmail);
  api.clock.advance(1_000);
  return api.call(method, `/tenant/v1${path}`, {
    token,
    ...(options.body === undefined ? {} : { body: options.body }),
    headers: { ...(options.version === undefined ? {} : { "if-match": `"${options.version}"` }), ...(method === "POST" && /^\/(products|brands|areas)$|\/price-rules(\/batch)?$/.test(path) ? { "idempotency-key": randomUUID() } : {}) },
  });
}
async function newArea(who: TenantFixture, cityId: string, name: string, polygon: ReturnType<typeof square>, bizType = "general"): Promise<string> {
  return (await ok(tenantCall(who, "POST", "/areas", { body: { city_id: cityId, name: { zh: name }, biz_type: bizType, polygons: [{ kind: "operate", geometry: polygon }] } }), 201)).id;
}
const pkg = (areaId: string, hours: number, price: number) => ({ area_id: areaId, vehicle_group_id: m.ids.biz7, package_hours: hours, pricing_model: "charter_package", package_km: 300, package_price: price, overtime_per_hour: 5_000, over_km_per_km: 500, valid_from: "2026-01-01" });
const surcharge = (areaId: string, hours: number, amount: number) => ({ area_id: areaId, vehicle_group_id: m.ids.biz7, package_hours: hours, pricing_model: "charter_area_surcharge", pickup_surcharge: amount, dropoff_surcharge: amount, waypoint_surcharge: amount, valid_from: "2026-01-01" });

/** 一个上架的包车商品：商品区域 `areaId`，价格规则 `rules` */
async function charterProduct(who: TenantFixture, cityId: string, areaId: string, rules: unknown[]): Promise<string> {
  const brand = (await ok(tenantCall(who, "POST", "/brands", { body: { name: `包车-${randomUUID().slice(0, 6)}`, currency: "JPY" } }), 201)).id;
  const created = await ok(tenantCall(who, "POST", "/products", { body: { brand_id: brand, city_id: cityId, category: "charter", areas: [{ area_id: areaId }], vehicle_groups: [{ vehicle_group_id: m.ids.biz7, passengers: 6, luggage: 4 }], dispatchers: [{ name: "调度", phone: "0312345678" }] } }), 201);
  const serviceRules = await ok(tenantCall(who, "PUT", `/products/${created.id}/service-rules`, { version: 1, body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { general: { mode: "limited", minutes: 0 } } } }));
  const content = await ok(tenantCall(who, "PUT", `/products/${created.id}/content`, { version: serviceRules.version, body: { zh: { title: "按区域匹配的包车" } } }));
  await ok(tenantCall(who, "POST", `/products/${created.id}/price-rules/batch`, { version: content.version, body: { create: rules } }));
  await ok(tenantCall(who, "POST", `/products/${created.id}/publish`));
  return created.id;
}

before(async () => {
  api = await createTestApi({ payments: new FakePaymentProvider(), quote: { routes: { estimate: routeLookup } } });
  m = await buildMarket(api);
  const tokyo = await newArea(m.b, m.ids.tokyo, "东京市内", square(139.55, 35.52, 139.95, 35.82), "charter");
  const fuji = await newArea(m.b, m.ids.tokyo, "富士山", square(138.6, 35.3, 138.95, 35.6), "charter");
  const hakone = await newArea(m.b, m.ids.tokyo, "箱根", square(138.96, 35.15, 139.15, 35.28), "charter");
  const kamakura = await newArea(m.b, m.ids.tokyo, "镰仓", square(139.5, 35.28, 139.6, 35.36), "charter");
  const rules = [pkg(tokyo, 5, 33_000), pkg(tokyo, 10, 55_000), ...[5, 10].flatMap((hours) => [surcharge(fuji, hours, 10_000), surcharge(hakone, hours, 10_000), surcharge(kamakura, hours, 8_000)])];
  charter = { id: await charterProduct(m.b, m.ids.tokyo, tokyo, rules), tokyo, fuji, hakone, kamakura };
  const channel = await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" });
  site = await siteApi(api, (await salesCredentials(api, m, channel.id)).clientId, new FakePaymentProvider(), {}, { logDestination: { write: (line: string) => void (logs += line) }, quote: { routes: { estimate: routeLookup } } });
});
after(async () => {
  await site?.close();
  await api.close();
});

/** 官网包车询价（默认不带 city_id；`stops` 是经停点） */
async function quote(pickup: Place, dropoff: Place, hours: number, stops: Place[] = [], extra: Record<string, unknown> = {}): Promise<ApiResponse> {
  api.clock.advance(1_000);
  const waypoints = stops.map((place, index) => ({ name: `经停 ${index + 1}`, lat: P[place].lat, lng: P[place].lng, stay_minutes: 30 }));
  const res = await site.call("POST", "/site/v1/quotes", { body: { category: "charter", pickup: P[pickup], dropoff: P[dropoff], ...(waypoints.length === 0 ? {} : { waypoints }), package_hours: hours, service_local: SERVICE_LOCAL, passengers: 2, luggage: 1, ...extra }, ip: nextIp() });
  assertMatchesOpenApi("POST", "/site/v1/quotes", res);
  assert.equal(res.status, 200, res.text);
  return res;
}
/** 第一个报价的上 / 下车加价明细（对外价，区域名） */
const ends = (res: ApiResponse): [string, string, string | undefined][] =>
  res.body.quotes[0].price_breakdown.filter((item: any) => item.kind === "pickup" || item.kind === "dropoff").map((item: any) => [item.kind, item.amount.amount, item.area_name?.zh]);
const cityCode = (res: ApiResponse): string | null => res.body.city?.code ?? null;

test("用例 18：河口湖上车 → 新宿下车（不带 city_id、不填经停）：由东京包车报价，套餐按东京市内价，收富士山上车加价（55,000 + 10,000）× 1.1", async () => {
  const res = await quote("kawaguchiko", "shinjuku", 10);
  assert.equal(cityCode(res), "CTY-JP-TYO");
  assert.deepEqual(res.body.city, { id: m.ids.tokyo, code: "CTY-JP-TYO", name: { zh: "东京" }, timezone: "Asia/Tokyo" });
  assert.equal(res.body.quotes[0].price.total.amount, "71500");
  assert.deepEqual(ends(res), [["pickup", "11000", "富士山"]]);
  // 询价日志的城市是找到的那个城市（quote_logs.city_id 不可空）
  const logged = await api.db.owner.query<{ city_id: string; request_city: string }>("select l.city_id, l.request->>'city_id' as request_city from quotes q join quote_logs l on l.id = q.quote_log_id where q.id = $1", [res.body.quotes[0].quote_id]);
  assert.deepEqual(logged.rows, [{ city_id: m.ids.tokyo, request_city: m.ids.tokyo }]);
});

test("用例 4：河口湖上车 → 忍野八海 → 河口湖下车：由东京包车报价，收富士山上车加价、下车加价", async () => {
  const res = await quote("kawaguchiko", "kawaguchiko", 10, ["oshinoHakkai"]);
  assert.equal(cityCode(res), "CTY-JP-TYO");
  assert.equal(res.body.quotes.length, 1, res.text);
  assert.deepEqual(ends(res), [["pickup", "11000", "富士山"], ["dropoff", "11000", "富士山"]]);
});

test("用例 5：河口湖上车 → 芦之湖 → 河口湖下车：由东京包车报价，套餐 55,000 + 箱根行程 10,000 + 富士山上车 10,000 + 下车 10,000，× 1.1 = 93,500", async () => {
  const res = await quote("kawaguchiko", "kawaguchiko", 10, ["ashinoko"]);
  assert.equal(cityCode(res), "CTY-JP-TYO");
  assert.equal(res.body.quotes[0].price.total.amount, "93500");
  assert.deepEqual(ends(res), [["pickup", "11000", "富士山"], ["dropoff", "11000", "富士山"]]);
});

test("用例 8：镰仓站上车 → 浅草 → 新宿下车（5h）：由东京包车报价，套餐 33,000 + 镰仓上车 8,000，× 1.1 = 45,100", async () => {
  const res = await quote("kamakuraStation", "shinjuku", 5, ["asakusa"]);
  assert.equal(cityCode(res), "CTY-JP-TYO");
  assert.equal(res.body.quotes[0].price.total.amount, "45100");
  assert.deepEqual(ends(res), [["pickup", "8800", "镰仓"]]);
});

test("用例 11：甲府上车（不在任何①③里，不带 city_id）：不报价（OUT_OF_SERVICE_AREA，转人工）、city 为 null、不写询价日志；记一条未覆盖需求", async () => {
  const before = Number((await api.db.owner.query<{ count: string }>("select count(*) from quote_logs")).rows[0]?.count);
  api.clock.advance(1_000);
  const res = await site.call("POST", "/site/v1/quotes", { body: { category: "charter", pickup: P.kofu, dropoff: P.shinjuku, package_hours: 10, service_local: SERVICE_LOCAL, passengers: 2, luggage: 1, pickup_name: "甲府站" }, ip: nextIp() });
  assertMatchesOpenApi("POST", "/site/v1/quotes", res);
  assert.equal(res.status, 200, res.text);
  assert.deepEqual([res.body.city, res.body.quotes, res.body.unavailable], [null, [], [{ vehicle_group_id: null, reasons: ["OUT_OF_SERVICE_AREA"] }]]);
  assert.equal(Number((await api.db.owner.query<{ count: string }>("select count(*) from quote_logs")).rows[0]?.count), before);
  await site.app.backgroundIdle();
  const demands = await api.db.owner.query<any>("select category, package_hours, city_id, pickup_name from uncovered_demands where pickup_name = '甲府站'");
  // 甲府离东京中心约 100 公里，不在任何能订包车的城市范围里：城市为空
  assert.deepEqual(demands.rows, [{ category: "charter", package_hours: 10, city_id: null, pickup_name: "甲府站" }]);
  // 下车点在甲府同样不匹配
  const back = await quote("shinjuku", "kofu", 10);
  assert.deepEqual([back.body.city, back.body.unavailable], [null, [{ vehicle_group_id: null, reasons: ["OUT_OF_SERVICE_AREA"] }]]);
});

test("用例 12：经停不影响匹配——新宿上下车、经停甲府：按东京询价，引擎不报（WAYPOINT_NOT_PRICED，指出第 1 个经停点）", async () => {
  const res = await quote("shinjuku", "shinjuku", 10, ["kofu"]);
  assert.equal(cityCode(res), "CTY-JP-TYO");
  assert.deepEqual([res.body.quotes, res.body.unavailable], [[], [{ vehicle_group_id: null, reasons: ["WAYPOINT_NOT_PRICED"], waypoint_stop_seqs: [1] }]]);
});

test("按行程计价（不带 city_id）同样按点找城市；带 city_id 的旧请求照旧：河口湖照样报、一个都没匹配到时按带的城市询价（引擎给原因）、不存在的城市 400", async () => {
  api.clock.advance(1_000);
  const itinerary = await site.call("POST", "/site/v1/quotes", { body: { category: "charter", itinerary_pricing: true, pickup: P.kawaguchiko, dropoff: P.shinjuku, waypoints: [{ name: "芦之湖", ...P.ashinoko, stay_minutes: 60 }], service_local: SERVICE_LOCAL, passengers: 2, luggage: 1 }, ip: nextIp() });
  assertMatchesOpenApi("POST", "/site/v1/quotes", itinerary);
  assert.equal(itinerary.status, 200, itinerary.text);
  assert.deepEqual([cityCode(itinerary), itinerary.body.itinerary_route.total_minutes, itinerary.body.quotes[0].package.hours], ["CTY-JP-TYO", 180, 5]);
  assert.deepEqual(ends(itinerary), [["pickup", "11000", "富士山"]]);
  const withCity = await quote("kawaguchiko", "shinjuku", 10, [], { city_id: m.ids.tokyo });
  assert.deepEqual([cityCode(withCity), withCity.body.quotes[0].price.total.amount], ["CTY-JP-TYO", "71500"]);
  const nowhere = await quote("kofu", "shinjuku", 10, [], { city_id: m.ids.tokyo });
  assert.deepEqual([nowhere.body.quotes, nowhere.body.unavailable], [[], [{ vehicle_group_id: null, reasons: ["OUT_OF_SERVICE_AREA"] }]]);
  assert.equal(nowhere.body.city?.id, m.ids.tokyo);
  api.clock.advance(1_000);
  const unknown = await site.call("POST", "/site/v1/quotes", { body: { category: "charter", city_id: randomUUID(), pickup: P.kawaguchiko, dropoff: P.shinjuku, package_hours: 10, service_local: SERVICE_LOCAL, passengers: 2, luggage: 1 }, ip: nextIp() });
  assert.deepEqual([unknown.status, unknown.body.error.details.issues.map((issue: any) => [issue.path, issue.reason])], [400, [["/city_id", "UNKNOWN_CITY"]]]);
});

test("接送机、点对点仍要 city_id（和以前同一种说法：400 /city_id 必填）", async () => {
  for (const body of [
    { category: "point_to_point", pickup: P.shinjuku, dropoff: P.asakusa },
    { category: "airport_transfer", airport_id: m.ids.narita, direction: "pickup", address: P.shinjuku },
  ]) {
    api.clock.advance(1_000);
    const res = await site.call("POST", "/site/v1/quotes", { body: { ...body, service_local: SERVICE_LOCAL, passengers: 2, luggage: 1 }, ip: nextIp() });
    assert.deepEqual([res.status, res.body.error.details.issues], [400, [{ path: "/city_id", message: "必填" }]], res.text);
  }
});

test("GET /site/v1/charter-packages?pickup=&dropoff=：按匹配到的商品列套餐和城市；不匹配为空；坐标格式不对 400", async () => {
  const list = async (pickup: string, dropoff: string): Promise<ApiResponse> => {
    api.clock.advance(1_000);
    const res = await site.call("GET", `/site/v1/charter-packages?pickup=${encodeURIComponent(pickup)}&dropoff=${encodeURIComponent(dropoff)}`, { ip: nextIp() });
    assertMatchesOpenApi("GET", "/site/v1/charter-packages", res);
    return res;
  };
  const at = (place: Place): string => `${P[place].lat},${P[place].lng}`;
  const kawaguchiko = await list(at("kawaguchiko"), at("shinjuku"));
  assert.deepEqual([kawaguchiko.status, kawaguchiko.body.city?.code, kawaguchiko.body.items], [200, "CTY-JP-TYO", [{ hours: 5 }, { hours: 10 }]]);
  const kofu = await list(at("kofu"), at("shinjuku"));
  assert.deepEqual([kofu.status, kofu.body], [200, { city: null, items: [] }]);
  for (const bad of [["35.5", at("shinjuku")], ["95,139", at("shinjuku")], [at("shinjuku"), "abc"]] as const) {
    const res = await list(bad[0], bad[1]);
    assert.equal(res.status, 400, res.text);
  }
  api.clock.advance(1_000);
  const missing = await site.call("GET", `/site/v1/charter-packages?pickup=${encodeURIComponent(at("shinjuku"))}`, { ip: nextIp() });
  assert.deepEqual([missing.status, missing.body.error.details.issues.map((issue: any) => issue.path)], [400, ["/dropoff"]]);
  // 按城市列的旧接口照旧
  api.clock.advance(1_000);
  const byCity = await site.call("GET", `/site/v1/cities/${m.ids.tokyo}/charter-packages`, { ip: nextIp() });
  assert.deepEqual(byCity.body.items, [{ hours: 5 }, { hours: 10 }]);
});

// 放在最后：这里给甲建一个大阪城市的包车商品，区域盖住河口湖、忍野八海，之后这两处会匹配到两个城市
test("匹配到两个城市时只取一个：请求的 city_id → 上车点所在城市 → 编号最小；写一条警告日志，不逐城合并", async () => {
  const osakaArea = await newArea(m.a, m.ids.osaka, "富士五湖（测试）", square(138.7, 35.42, 138.9, 35.55), "charter");
  await charterProduct(m.a, m.ids.osaka, osakaArea, [pkg(osakaArea, 10, 60_000)]);
  logs = "";
  const requested = await quote("kawaguchiko", "kawaguchiko", 10, [], { city_id: m.ids.osaka });
  assert.equal(requested.body.city.id, m.ids.osaka);
  assert.deepEqual(requested.body.quotes.map((entry: any) => entry.price.total.amount), ["66000"], "只按大阪询价：只有甲的商品");
  // 忍野八海在东京城市范围里（河口湖不在）：取上车点所在城市
  const pickupCity = await quote("oshinoHakkai", "oshinoHakkai", 10);
  assert.equal(pickupCity.body.city.id, m.ids.tokyo);
  const smallest = await quote("kawaguchiko", "kawaguchiko", 10);
  assert.equal(smallest.body.city.id, [m.ids.tokyo, m.ids.osaka].sort()[0]);
  const warnings = logs
    .split("\n")
    .filter((line) => line.includes("site.charter_multi_city"))
    .map((line) => JSON.parse(line) as { level: number; matched_city_ids: string[]; chosen_city_id: string; by: string });
  assert.deepEqual(
    warnings.map((entry) => [entry.level, entry.matched_city_ids, entry.chosen_city_id, entry.by]),
    [
      [40, [m.ids.tokyo, m.ids.osaka].sort(), m.ids.osaka, "requested"],
      [40, [m.ids.tokyo, m.ids.osaka].sort(), m.ids.tokyo, "pickup_city"],
      [40, [m.ids.tokyo, m.ids.osaka].sort(), [m.ids.tokyo, m.ids.osaka].sort()[0], "smallest_id"],
    ],
  );
  // 只匹配到一个城市（新宿 → 浅草）不写
  logs = "";
  await quote("shinjuku", "asakusa", 10);
  assert.ok(!logs.includes("site.charter_multi_city"));
});
