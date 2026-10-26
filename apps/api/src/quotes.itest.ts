/**
 * 报价试算（M2-01）：两个真实配置的供应商对同一次用车报价，经真实接口、真实 PostgreSQL。
 * - 平台侧试算：所有供应商一起比，中标按第五轮规则（3% 价格带内评分高者）；每个没报出价的都有原因。
 * - 租户侧试算：只看得到自己的商品和结算价；应答里没有对外价、加价比例的任何字段；别的供应商的商品是 404。
 * 路线预估、汇率、评分是别的任务的东西：这里用可以改的替身（测试数据只在这里构造，结束时连同 schema 一起删除）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type FxQuote, PLATFORM_ROLES, type RouteEstimate, type TenantStanding, platformRoleCan } from "@nozomi/domain";
import { type ApiResponse, type HttpMethod, type TenantFixture, type TestApi, addTenantUser, createTestApi, resumeTenantNow, suspendTenantApproved } from "./testing/api.ts";

let api: TestApi;
let root: string;
let a: TenantFixture;
let b: TenantFixture;
const ids: Record<string, string> = {};
const MISSING = "99999999-9999-4999-8999-999999999999";

// 别的任务的东西的替身：路线预估、汇率、评分都可以在测试里改
let route: RouteEstimate | null = null;
let routeCalls = 0;
const rates = new Map<string, string>();
/** 汇率替身给出的取数时间（测试里的现在是 2026-10-07 01:00Z） */
let fxAsOf = "2026-10-07T00:00:00Z";
const standings = new Map<string, TenantStanding>();

const platform = (method: HttpMethod, path: string, body?: unknown, token: string = root): Promise<ApiResponse> => api.call(method, `/platform/v1${path}`, { token, ...(body === undefined ? {} : { body }) });
const call = (who: TenantFixture, method: HttpMethod, path: string, options: { body?: unknown; version?: number; token?: string } = {}): Promise<ApiResponse> =>
  api.call(method, `/tenant/v1${path}`, {
    token: options.token ?? who.adminToken,
    ...(options.body === undefined ? {} : { body: options.body }),
    headers: {
      ...(options.version === undefined ? {} : { "if-match": `"${options.version}"` }),
      ...(method === "POST" && /^\/(products|brands|areas)$|\/price-rules$|\/adjust-rules$/.test(path) ? { "idempotency-key": randomUUID() } : {}),
    },
  });
async function ok(res: Promise<ApiResponse>, status = 200): Promise<any> {
  const done = await res;
  assert.equal(done.status, status, done.text);
  return done.body;
}

const square = (west: number, south: number, east: number, north: number): unknown => ({ kind: "operate", geometry: { type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] } });
const WEST = { lng: 139.2, lat: 35.5 };
const EAST = { lng: 139.7, lat: 35.5 };
const FAR = { lng: 141.5, lat: 35.5 };

async function area(who: TenantFixture, name: string, polygons: unknown[]): Promise<string> {
  api.clock.advance(1_000);
  return (await ok(call(who, "POST", "/areas", { body: { city_id: ids["tokyo"], name: { zh: name }, biz_type: "general", polygons } }), 201)).id;
}
const version = async (who: TenantFixture, productId: string): Promise<number> => (await ok(call(who, "GET", `/products/${productId}`))).version;

/** 一个接送机商品（成田机场）：区域、车型组、调度人、服务规则、详情都填好；价格另加。 */
async function transfer(who: TenantFixture, brandId: string, areaIds: string[], rules: Record<string, unknown> = {}): Promise<string> {
  api.clock.advance(1_000);
  const created = await ok(
    call(who, "POST", "/products", {
      body: {
        brand_id: brandId,
        city_id: ids["tokyo"],
        category: "airport_transfer",
        poi_id: ids["narita"],
        areas: areaIds.map((area_id) => ({ area_id })),
        vehicle_groups: [{ vehicle_group_id: ids["biz7"], passengers: 6, luggage: 4 }, { vehicle_group_id: ids["eco4"], passengers: 3, luggage: 2 }],
        dispatchers: [{ name: "调度", phone: "0312345678" }],
      },
    }),
    201,
  );
  const saved = await ok(call(who, "PUT", `/products/${created.id}/service-rules`, { version: 1, body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { pickup: { mode: "limited", minutes: 90 }, dropoff: { mode: "limited", minutes: 15 } }, ...rules } }));
  await ok(call(who, "PUT", `/products/${created.id}/content`, { version: saved.version, body: { zh: { title: "成田机场接送", pickup_guide: "到达大厅 3 号门" } } }));
  return created.id;
}
async function addPrice(who: TenantFixture, productId: string, body: Record<string, unknown>): Promise<string> {
  const full = { vehicle_group_id: ids["biz7"], direction: "both", pricing_model: "fixed", valid_from: "2026-01-01", ...body };
  return (await ok(call(who, "POST", `/products/${productId}/price-rules`, { version: await version(who, productId), body: full }), 201)).price_rule.id;
}
const publish = (who: TenantFixture, productId: string): Promise<any> => ok(call(who, "POST", `/products/${productId}/publish`));

/** 接机到 WEST，2026-10-20 10:00，2 人 1 件行李，日元。 */
const ask = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ city_id: ids["tokyo"], category: "airport_transfer", place_id: ids["narita"], currency: "JPY", direction: "pickup", dropoff: WEST, service_time: "2026-10-20T10:00", passengers: 2, luggage: 1, ...extra });
const preview = (extra: Record<string, unknown> = {}, token: string = root): Promise<any> => ok(platform("POST", "/quotes/preview", ask(extra), token));
const group = (body: any, vehicleGroupId: string = ids["biz7"] as string): any => body.groups.find((entry: any) => entry.vehicle_group_id === vehicleGroupId);

before(async () => {
  api = await createTestApi({
    quote: {
      routes: {
        estimate: async () => {
          routeCalls += 1;
          return route;
        },
      },
      fx: { quote: async (from, to): Promise<FxQuote | null> => (rates.has(`${from}>${to}`) ? { from, to, rate: rates.get(`${from}>${to}`) as string, asOf: fxAsOf } : null) },
      standings: { load: async (_db, tenantIds) => new Map(tenantIds.map((tenantId) => [tenantId, standings.get(tenantId) ?? { scoreCenti: null, completedOrders: 0, observation: false }])) },
    },
  });
  root = await api.superAdminToken();
  a = await api.tenantWithAdmin(root, "甲车队", "admin@quote-a.test");
  b = await api.tenantWithAdmin(root, "乙车队", "admin@quote-b.test");
  ids["tokyo"] = (await ok(platform("POST", "/master/cities", { country_code: "JP", timezone: "Asia/Tokyo", code: "CTY-JP-TYO", name: { zh: "东京" }, center: { lng: 139.6917, lat: 35.6895 } }), 201)).id;
  ids["osaka"] = (await ok(platform("POST", "/master/cities", { country_code: "JP", timezone: "Asia/Tokyo", code: "CTY-JP-OSA", name: { zh: "大阪" }, center: { lng: 135.5, lat: 34.7 } }), 201)).id;
  ids["narita"] = (await ok(platform("POST", "/master/places", { location: { lng: 140.3887, lat: 35.7686 }, type: "airport", code: "NRT", city_id: ids["tokyo"], name: { zh: "成田机场" }, flight_scope: "international" }), 201)).id;
  ids["haneda"] = (await ok(platform("POST", "/master/places", { location: { lng: 139.78, lat: 35.55 }, type: "airport", code: "HND", city_id: ids["tokyo"], name: { zh: "羽田机场" }, flight_scope: "mixed" }), 201)).id;
  ids["biz7"] = (await ok(platform("POST", "/master/vehicle-groups", { grade: "business", seats: 7, power: "fuel", combos: [{ passengers: 6, luggage: 4 }], code: "VG-BIZ-7", name: { zh: "商务 7 座" } }), 201)).id;
  ids["eco4"] = (await ok(platform("POST", "/master/vehicle-groups", { grade: "economy", seats: 4, power: "fuel", combos: [{ passengers: 3, luggage: 2 }], code: "VG-ECO-4", name: { zh: "经济 4 座" } }), 201)).id;
  ids["seat"] = (await ok(platform("POST", "/master/addons", { code: "ADD-CHILD_SEAT", categories: ["airport_transfer"], charge_unit: "per_item", name: { zh: "儿童座椅" } }), 201)).id;
  ids["brandA"] = (await ok(call(a, "POST", "/brands", { body: { name: "甲 JP", currency: "JPY" } }), 201)).id;
  ids["brandB"] = (await ok(call(b, "POST", "/brands", { body: { name: "乙 JP", currency: "JPY" } }), 201)).id;
  ids["brandBcny"] = (await ok(call(b, "POST", "/brands", { body: { name: "乙 CNY", currency: "CNY" } }), 201)).id;
  // 甲：东京西部、东部两个区域（各一块营运区）；乙：一个区域盖住整个东京
  ids["aWest"] = await area(a, "东京西部", [square(139.0, 35.0, 139.5, 36.0)]);
  ids["aEast"] = await area(a, "东京东部", [square(139.5, 35.0, 140.0, 36.0)]);
  ids["bAll"] = await area(b, "东京全域", [square(139.0, 35.0, 140.0, 36.0), { kind: "forbid", geometry: { type: "Polygon", coordinates: [[[139.8, 35.4], [139.9, 35.4], [139.9, 35.6], [139.8, 35.6], [139.8, 35.4]]] } }]);
  // 甲的商品：商务 20,000（西）/ 21,000（东），经济 12,000（西）；儿童座椅 1,000 首个免费；+10% 的周末调价
  ids["pa"] = await transfer(a, ids["brandA"] as string, [ids["aWest"] as string, ids["aEast"] as string], { addons: [{ addon_id: ids["seat"], unit_price: 1_000, first_free: true }] });
  ids["paWestPrice"] = await addPrice(a, ids["pa"] as string, { area_id: ids["aWest"], base_price: 20_000 });
  await addPrice(a, ids["pa"] as string, { area_id: ids["aEast"], base_price: 21_000 });
  await addPrice(a, ids["pa"] as string, { area_id: ids["aWest"], vehicle_group_id: ids["eco4"], base_price: 12_000 });
  await ok(call(a, "POST", `/products/${ids["pa"]}/adjust-rules`, { version: await version(a, ids["pa"] as string), body: { name: "周末 +10%", cycle: { type: "weekly", weekdays: [6, 7] }, steps: [{ type: "percent", value: 1_000 }] } }), 201);
  await publish(a, ids["pa"] as string);
  // 乙的商品：商务 19,800，全域
  ids["pb"] = await transfer(b, ids["brandB"] as string, [ids["bAll"] as string]);
  ids["pbPrice"] = await addPrice(b, ids["pb"] as string, { area_id: ids["bAll"], base_price: 19_800 });
  await publish(b, ids["pb"] as string);
});
after(() => api.close());

test("两个供应商对同一次用车报价：各算各的结算价，对外价 = 结算价 × (1 + 加价比例)（默认 10%，来自配置）；与最低价相差 3% 以内时评分高者中标，评分一样比已完成订单数；每组一份 30 分钟的快照", async () => {
  // 默认身份（都没有评分、0 单）：甲 20,000 → 22,000；乙 19,800 → 21,780。都在 3% 区间里，评分和单量都一样 → 排序价低的乙中标
  const first = await preview();
  assert.deepEqual([first.currency, first.band_bp, first.markup_floor_bp, first.candidate_count, first.route], ["JPY", 300, 1_000, 2, null]);
  const biz = group(first);
  assert.deepEqual(biz.candidates.map((entry: any) => [entry.position, entry.tenant_name, entry.product_id, entry.offer.settlement.total, entry.markup_bp, entry.sell, entry.in_band, entry.rank_price, entry.score_centi]), [
    [1, "乙车队", ids["pb"], 19_800, 1_000, 21_780, true, "21780", 450],
    [2, "甲车队", ids["pa"], 20_000, 1_000, 22_000, true, "22000", 450],
  ]);
  assert.deepEqual(biz.winner, { tenant_id: b.tenantId, tenant_name: "乙车队", product_id: ids["pb"], product_code: biz.candidates[0].product_code, sell: 21_780, settlement: 19_800, settlement_currency: "JPY" });
  assert.equal(Date.parse(biz.expires_at) - Date.parse(biz.created_at), 30 * 60_000);
  assert.equal(biz.created_at, api.clock.now().toISOString());
  // 明细：用的是哪个区域、哪条价格；各项之和等于结算价
  const mine = biz.candidates[1].offer;
  assert.deepEqual([mine.area_id, mine.price_rule_id, mine.settlement.base, mine.settlement.adjust, mine.settlement.urgent, mine.settlement.night, mine.settlement.addons, mine.settlement.free_wait], [ids["aWest"], ids["paWestPrice"], 20_000, 0, 0, 0, 0, { item: "pickup", mode: "limited", minutes: 90, platform_minimum_minutes: 90 }]);
  // 经济：只有甲有价；乙没有这个组合的价格
  assert.deepEqual(group(first, ids["eco4"]).candidates.map((entry: any) => [entry.tenant_name, entry.sell]), [["甲车队", 13_200]]);
  assert.deepEqual(first.refused.map((entry: any) => [entry.tenant_name, entry.vehicle_group_id === ids["eco4"], entry.reason]), [["乙车队", true, "NO_PRICE_RULE"]]);
  assert.match(first.refused[0].message, /没有价格/);

  // 甲的评分高（4.9，200 单）：价差 1% < 3%，甲中标，客人付甲自己的对外价 22,000
  standings.set(a.tenantId, { scoreCenti: 490, completedOrders: 200, observation: false });
  standings.set(b.tenantId, { scoreCenti: 430, completedOrders: 150, observation: false });
  const scored = group(await preview());
  assert.deepEqual([scored.winner.tenant_name, scored.winner.sell, scored.candidates.map((entry: any) => [entry.tenant_name, entry.score_centi, entry.completed_orders])], ["甲车队", 22_000, [["甲车队", 490, 200], ["乙车队", 430, 150]]]);
  // 乙把价格降到 19,000（对外价 20,900）：甲的 22,000 超出 20,900 × 1.03 = 21,527，区间外 → 最低价的乙中标
  const rule = (await ok(call(b, "GET", `/products/${ids["pb"]}/price-rules`))).items[0];
  await ok(call(b, "PUT", `/products/${ids["pb"]}/price-rules/${rule.id}`, { version: await version(b, ids["pb"] as string), body: { area_id: ids["bAll"], vehicle_group_id: ids["biz7"], direction: "both", pricing_model: "fixed", base_price: 19_000, valid_from: "2026-01-01" } }));
  const cheaper = group(await preview());
  assert.deepEqual(cheaper.candidates.map((entry: any) => [entry.tenant_name, entry.sell, entry.in_band]), [["乙车队", 20_900, true], ["甲车队", 22_000, false]], "供应商改了价，下一次试算就是新的");
  // 乙进了观察期：排序价 20,900 × 1.05 = 21,945；甲 22,000 ≤ 21,945 × 1.03 → 同一区间，评分高的甲中标
  standings.set(b.tenantId, { scoreCenti: 430, completedOrders: 150, observation: true });
  const observed = group(await preview());
  assert.deepEqual(observed.candidates.map((entry: any) => [entry.tenant_name, entry.sell, entry.rank_price, entry.observation]), [["甲车队", 22_000, "22000", false], ["乙车队", 20_900, "21945", true]]);
  standings.clear();
  await ok(call(b, "PUT", `/products/${ids["pb"]}/price-rules/${rule.id}`, { version: await version(b, ids["pb"] as string), body: { area_id: ids["bAll"], vehicle_group_id: ids["biz7"], direction: "both", pricing_model: "fixed", base_price: 19_800, valid_from: "2026-01-01" } }));
});

test("每个没报出价的都有原因：区域（营运区外、禁行区）、人数行李、提前时长、库存、暂停的供应商、调价和附加服务照常算进结算价", async () => {
  const reasons = (body: any): unknown[] => body.refused.map((entry: any) => [entry.tenant_name, entry.vehicle_group_id === null ? null : entry.vehicle_group_id === ids["biz7"] ? "biz7" : "eco4", entry.reason]).sort();
  const far = await preview({ dropoff: FAR, vehicle_group_ids: [ids["biz7"]] });
  assert.deepEqual([far.groups, reasons(far)], [[], [["乙车队", null, "OUT_OF_SERVICE_AREA"], ["甲车队", null, "OUT_OF_SERVICE_AREA"]]]);
  // 乙的禁行区里：乙不报；甲的东部区域接，用东部的价 21,000
  const forbidden = await preview({ dropoff: { lng: 139.85, lat: 35.5 }, vehicle_group_ids: [ids["biz7"]] });
  assert.deepEqual([group(forbidden).candidates.map((entry: any) => [entry.tenant_name, entry.offer.settlement.total, entry.offer.area_id]), reasons(forbidden)], [[["甲车队", 21_000, ids["aEast"]]], [["乙车队", null, "IN_FORBIDDEN_AREA"]]]);
  // 送机：只看上车点
  const dropoff = await preview({ direction: "dropoff", pickup: EAST, dropoff: FAR, vehicle_group_ids: [ids["biz7"]] });
  assert.deepEqual(group(dropoff).candidates.map((entry: any) => entry.offer.settlement.total).sort(), [19_800, 21_000]);
  // 7 个人：两家的商务都装不下
  assert.deepEqual(reasons(await preview({ passengers: 7, vehicle_group_ids: [ids["biz7"]] })), [["乙车队", "biz7", "CAPACITY_EXCEEDED"], ["甲车队", "biz7", "CAPACITY_EXCEEDED"]]);
  // 明天一早（今天是 10-07 10:00）：离用车不到 24 小时，都没开加急
  assert.deepEqual(reasons(await preview({ service_time: "2026-10-08T09:00", vehicle_group_ids: [ids["biz7"]] })), [["乙车队", null, "LEAD_TIME_TOO_SHORT"], ["甲车队", null, "LEAD_TIME_TOO_SHORT"]]);
  // 周六 + 两个儿童座椅：甲 20,000 × 1.1 + 1,000（首个免费）= 23,000；乙不提供儿童座椅
  const weekend = await preview({ service_time: "2026-10-24T10:00", addons: [{ addon_id: ids["seat"], quantity: 2 }], vehicle_group_ids: [ids["biz7"]] });
  const offer = group(weekend).candidates[0].offer.settlement;
  assert.deepEqual([offer.total, offer.base, offer.adjust, offer.addons, offer.adjusts.map((entry: any) => entry.name), offer.addon_items.map((item: any) => [item.quantity, item.charged_quantity, item.amount])], [23_000, 20_000, 2_000, 1_000, ["周末 +10%"], [[2, "1", 1_000]]]);
  assert.deepEqual(reasons(weekend), [["乙车队", null, "ADDON_NOT_OFFERED"]]);
  // 乙改成限量、10-20 没设库存：这一天报不出；设了就报得出
  const mode = await ok(call(b, "PUT", `/products/${ids["pb"]}/inventory`, { version: await version(b, ids["pb"] as string), body: { mode: "limited" } }));
  assert.deepEqual(reasons(await preview({ vehicle_group_ids: [ids["biz7"]] })), [["乙车队", null, "SOLD_OUT"]]);
  await ok(call(b, "POST", `/products/${ids["pb"]}/inventory/batch-set`, { version: mode.version, body: { from: "2026-10-20", to: "2026-10-20", total: 1 } }));
  assert.equal(group(await preview({ vehicle_group_ids: [ids["biz7"]] })).candidates.length, 2);
  await api.db.owner.query("update inventory_days set sold = 1 where product_id = $1", [ids["pb"]]);
  assert.deepEqual(reasons(await preview({ vehicle_group_ids: [ids["biz7"]] })), [["乙车队", null, "SOLD_OUT"]], "卖完了");
  await ok(call(b, "PUT", `/products/${ids["pb"]}/inventory`, { version: await version(b, ids["pb"] as string), body: { mode: "unlimited" } }));
  // 乙被平台暂停：不参与比价（已有订单继续履约是订单那边的事）
  await suspendTenantApproved(api, root, b.tenantId);
  const suspended = await preview({ vehicle_group_ids: [ids["biz7"]] });
  assert.deepEqual([group(suspended).winner.tenant_name, reasons(suspended)], ["甲车队", [["乙车队", null, "TENANT_SUSPENDED"]]]);
  await resumeTenantNow(api, root, b.tenantId);
  // 没上架的商品不在候选里；别的机场、别的城市、别的品类没有候选
  await ok(call(a, "POST", `/products/${ids["pa"]}/unpublish`));
  assert.deepEqual([(await preview()).candidate_count, (await preview({ place_id: ids["haneda"] })).candidate_count, (await preview({ city_id: ids["osaka"], place_id: null, category: "charter", direction: null, package_hours: 10, pickup: WEST, dropoff: null })).candidate_count], [1, 0, 0]);
  await publish(a, ids["pa"] as string);
});

test("里程 + 时长的价格要路线预估（M2-02 的接口）：取不到就报不出、一口价不受影响；试算时可以给一个假定的里程和时长；用不到路线的时候不去调路线服务", async () => {
  routeCalls = 0;
  await preview();
  assert.equal(routeCalls, 0, "候选里没有用得到路线预估的规则");
  // 乙把一口价的商品先下架，另建一个里程 + 时长的商品：起步 3,000（5 公里、20 分钟），每公里 400、每分钟 80
  // （同一个租户在同一个车型组只出一个价，两个商品都在架上时贵的那个不会出现在候选里）
  await ok(call(b, "POST", `/products/${ids["pb"]}/unpublish`));
  const metered = await transfer(b, ids["brandB"] as string, [ids["bAll"] as string]);
  await addPrice(b, metered, { area_id: ids["bAll"], pricing_model: "mileage_time", start_price: 3_000, start_meters: 5_000, start_minutes: 20, per_km: 400, per_minute: 80 });
  await publish(b, metered);
  const metersOnly = (body: any): unknown[] => body.refused.filter((entry: any) => entry.product_id === metered).map((entry: any) => entry.reason);
  route = null;
  const none = await preview({ vehicle_group_ids: [ids["biz7"]] });
  assert.deepEqual([metersOnly(none), group(none).candidates.map((entry: any) => entry.tenant_name), none.route, routeCalls], [["ROUTE_UNAVAILABLE"], ["甲车队"], null, 1], "路线服务取不到：里程 + 时长的不报，甲的一口价照常");
  // 路线服务给出 62.5 公里、75 分钟：3000 + 57.5 × 400 + 55 × 80 = 30,400
  route = { meters: 62_500, minutes: 75 };
  const estimated = await preview({ vehicle_group_ids: [ids["biz7"]] });
  const offer = group(estimated).candidates.find((entry: any) => entry.product_id === metered).offer.settlement;
  assert.deepEqual([estimated.route, offer.total, offer.usage, offer.exact.base], [{ meters: 62_500, minutes: 75 }, 30_400, { meters: 62_500, minutes: 75 }, "30400"]);
  // 假定的里程和时长：不去调路线服务
  const calls = routeCalls;
  const assumed = await preview({ vehicle_group_ids: [ids["biz7"]], assume_route: { meters: 12_500, minutes: 45 } });
  assert.deepEqual([group(assumed).candidates.find((entry: any) => entry.product_id === metered).offer.settlement.total, routeCalls], [8_000, calls]);
  // 供应商自己试算同一个商品：同样的规则
  const own = await ok(call(b, "POST", `/products/${metered}/quote-preview`, { body: { direction: "pickup", dropoff: WEST, service_time: "2026-10-20T10:00", passengers: 2, assume_route: { meters: 12_500, minutes: 45 }, vehicle_group_ids: [ids["biz7"]] } }));
  assert.deepEqual(own.offers.map((entry: any) => entry.settlement.total), [8_000]);
  route = null;
  await ok(call(b, "POST", `/products/${metered}/unpublish`));
  await publish(b, ids["pb"] as string);
});

test("跨币种（M2-03 的接口）：结算币种和客人支付的币种不同时按汇率换算并加 1.5% 缓冲；没有汇率、或汇率超过 48 小时没更新就报不出，同币种的不受影响", async () => {
  // 乙的人民币商品：商务 900.00 元
  const cny = await transfer(b, ids["brandBcny"] as string, [ids["bAll"] as string]);
  await addPrice(b, cny, { area_id: ids["bAll"], base_price: 90_000 });
  await publish(b, cny);
  const mine = (body: any): any => group(body)?.candidates.find((entry: any) => entry.product_id === cny);
  const noRate = await preview({ vehicle_group_ids: [ids["biz7"]] });
  assert.deepEqual([mine(noRate), noRate.refused.filter((entry: any) => entry.product_id === cny).map((entry: any) => entry.reason), group(noRate).candidates.length], [undefined, ["FX_RATE_UNAVAILABLE"], 2]);
  // 1 元 = 21.5 日元：900 × 21.5 × 1.015 × 1.10 = 21,604.275 → 21,604 日元。同一个租户（乙）的两个商品只留便宜的那个
  rates.set("CNY>JPY", "21.5");
  const converted = await preview({ vehicle_group_ids: [ids["biz7"]] });
  const entry = mine(converted);
  assert.deepEqual([entry.sell, entry.sell_exact, entry.fx_buffer_bp, entry.fx, entry.offer.settlement.currency, entry.offer.settlement.total], [21_604, "21604.275", 150, { from: "CNY", to: "JPY", rate: "21.5", as_of: "2026-10-07T00:00:00Z", lock: null }, "CNY", 90_000]);
  assert.deepEqual(group(converted).candidates.map((candidate: any) => [candidate.tenant_name, candidate.sell]), [["乙车队", 21_604], ["甲车队", 22_000]]);
  // 客人付人民币：日元的商品换成人民币（要有日元 → 人民币的汇率），人民币的商品同币种、没有缓冲
  rates.set("JPY>CNY", "0.0468");
  const inCny = await preview({ vehicle_group_ids: [ids["biz7"]], currency: "CNY" });
  assert.deepEqual(group(inCny).candidates.map((candidate: any) => [candidate.tenant_name, candidate.sell, candidate.fx_buffer_bp]), [["乙车队", 99_000, 0], ["甲车队", 104_504, 150]]);
  // 汇率超过 48 小时没更新（现在是 10-07 01:00Z）：跨币种的报不出，同币种的照常
  fxAsOf = "2026-10-05T00:59:59Z";
  const stale = await preview({ vehicle_group_ids: [ids["biz7"]] });
  assert.deepEqual([mine(stale), stale.refused.filter((entry: any) => entry.product_id === cny).map((entry: any) => entry.reason), group(stale).candidates.length], [undefined, ["FX_RATE_UNAVAILABLE"], 2]);
  fxAsOf = "2026-10-07T00:00:00Z";
  rates.clear();
  await ok(call(b, "POST", `/products/${cny}/unpublish`));
});

test("租户侧试算：供应商对自己的商品（没上架的也可以）试算，只有结算价和明细；应答里没有对外价、加价比例的任何字段，也看不到别的供应商", async () => {
  const body = { direction: "pickup", dropoff: WEST, service_time: "2026-10-24T10:00", passengers: 2, luggage: 1, addons: [{ addon_id: ids["seat"], quantity: 2 }] };
  const own = await ok(call(a, "POST", `/products/${ids["pa"]}/quote-preview`, { body }));
  assert.deepEqual([own.product_id, own.status, own.currency, own.refusal, own.service_date, own.urgent], [ids["pa"], "published", "JPY", null, "2026-10-24", false]);
  // 商务：20,000 × 1.1 + 1,000 = 23,000；经济：12,000 × 1.1 + 1,000 = 14,200
  assert.deepEqual(own.offers.map((entry: any) => [entry.vehicle_group_id === ids["biz7"] ? "biz7" : "eco4", entry.settlement.total, entry.settlement.base, entry.settlement.adjust, entry.settlement.addons]), [["biz7", 23_000, 20_000, 2_000, 1_000], ["eco4", 14_200, 12_000, 1_200, 1_000]]);
  // 规则 4：逐层扫描全部字段名和文字
  const keys: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value !== null && typeof value === "object") for (const [key, inner] of Object.entries(value)) (keys.push(key), walk(inner));
  };
  walk(own);
  assert.deepEqual(keys.filter((key) => /sell|markup|margin|rank|band|fx|score|winner|candidate|tenant|channel/i.test(key)), []);
  assert.doesNotMatch(JSON.stringify(own), /对外价|加价|中标|乙车队/);
  assert.deepEqual(Object.keys(own).sort(), ["code", "currency", "offers", "product_id", "refusal", "refused", "rounding_unit", "route", "service_date", "status", "urgent", "version"]);
  // 没上架的商品也能试算（需求文档 quote-preview：用未上架商品试算）；被暂停的供应商照常能试算
  const draft = await transfer(a, ids["brandA"] as string, [ids["aWest"] as string]);
  await addPrice(a, draft, { area_id: ids["aWest"], base_price: 15_000 });
  await suspendTenantApproved(api, root, a.tenantId);
  const drafted = await ok(call(a, "POST", `/products/${draft}/quote-preview`, { body: { ...body, addons: [], vehicle_group_ids: [ids["biz7"]] } }));
  assert.deepEqual([drafted.status, drafted.offers.map((entry: any) => entry.settlement.total)], ["draft", [15_000]]);
  await resumeTenantNow(api, root, a.tenantId);
  // 报不出时给原因：商品层面的、车型组层面的
  const refused = await ok(call(a, "POST", `/products/${ids["pa"]}/quote-preview`, { body: { ...body, dropoff: FAR } }));
  assert.deepEqual([refused.refusal.reason, refused.offers, /营运区/.test(refused.refusal.message)], ["OUT_OF_SERVICE_AREA", [], true]);
  const partly = await ok(call(a, "POST", `/products/${ids["pa"]}/quote-preview`, { body: { ...body, addons: [], dropoff: EAST } }));
  assert.deepEqual([partly.offers.map((entry: any) => entry.settlement.total), partly.refused.map((entry: any) => entry.reason)], [[23_100], ["NO_PRICE_RULE"]], "东部只有商务的价");
  // 租户隔离：乙的商品对甲是 404（和不存在的一样）；甲的商品对乙也是
  for (const [who, productId] of [[a, ids["pb"]], [b, ids["pa"]], [a, MISSING]] as const) {
    const res = await call(who, "POST", `/products/${productId}/quote-preview`, { body });
    assert.deepEqual([res.status, res.body.error.code], [404, "NOT_FOUND"]);
    assert.doesNotMatch(res.text, /19800|乙车队|甲车队/);
  }
  // 权限：能看商品的角色能试算（只读可以）；调度、财务不行；没登录 401；平台的令牌进不来
  const readonly = await addTenantUser(api, a.adminToken, "readonly@quote-a.test", "readonly");
  const dispatch = await addTenantUser(api, a.adminToken, "dispatch@quote-a.test", "dispatch");
  assert.equal((await call(a, "POST", `/products/${ids["pa"]}/quote-preview`, { body, token: readonly.token })).status, 200);
  assert.equal((await call(a, "POST", `/products/${ids["pa"]}/quote-preview`, { body, token: dispatch.token })).status, 403);
  assert.equal((await api.call("POST", `/tenant/v1/products/${ids["pa"]}/quote-preview`, { body })).status, 401);
  assert.equal((await call(a, "POST", `/products/${ids["pa"]}/quote-preview`, { body, token: root })).status, 401);
  // 租户的令牌进不了平台侧的试算
  assert.equal((await platform("POST", "/quotes/preview", ask(), a.adminToken)).status, 401);
});

test("请求写得不对：400，指到是哪一项；不认识的字段不收；平台侧试算只有运营、招商、渠道经理、客服和超级管理员能用", async () => {
  const issues = async (extra: Record<string, unknown>): Promise<unknown> => {
    const res = await platform("POST", "/quotes/preview", ask(extra));
    assert.deepEqual([res.status, res.body.error.code], [400, "VALIDATION_FAILED"], res.text);
    return res.body.error.details.issues.map((issue: any) => [issue.path, issue.reason ?? null]);
  };
  assert.deepEqual(await issues({ direction: null }), [["/direction", "REQUIRED"]]);
  assert.deepEqual(await issues({ dropoff: null }), [["/dropoff", "REQUIRED"]]);
  assert.deepEqual(await issues({ package_hours: 10 }), [["/package_hours", "NOT_APPLICABLE"]]);
  assert.deepEqual(await issues({ place_id: null }), [["/place_id", "REQUIRED"]]);
  assert.deepEqual(await issues({ service_time: "2026-02-30T10:00" }), [["/service_time", "INVALID_SERVICE_TIME"]]);
  assert.deepEqual(await issues({ passengers: 0 }), [["/passengers", "OUT_OF_RANGE"]]);
  assert.deepEqual(await issues({ currency: "EUR" }), [["/currency", "UNSUPPORTED_CURRENCY"]]);
  assert.deepEqual(await issues({ city_id: MISSING }), [["/city_id", "UNKNOWN_CITY"]]);
  assert.deepEqual(await issues({ place_id: MISSING }), [["/place_id", "UNKNOWN_PLACE"]]);
  assert.deepEqual(await issues({ assume_route: { meters: -1, minutes: 1 } }), [["/assume_route", "OUT_OF_RANGE"]]);
  assert.equal((await platform("POST", "/quotes/preview", { ...ask(), tenant_id: a.tenantId })).status, 400, "不认识的字段");
  assert.equal((await platform("POST", "/quotes/preview", { ...ask(), markup_bp: 0 })).status, 400, "加价比例不能由请求指定");
  const own = await call(a, "POST", `/products/${ids["pa"]}/quote-preview`, { body: { direction: "pickup", dropoff: WEST, service_time: "2026-10-20T10:00", passengers: 2, currency: "JPY" } });
  assert.equal(own.status, 400, "租户侧试算不收币种（它只算结算价）");
  // 平台角色（逐个角色的 403 在 platform-admin.itest.ts 的权限矩阵里）
  assert.deepEqual(PLATFORM_ROLES.map((role) => role.key).filter((role) => platformRoleCan(role, "quote.preview")), ["super_admin", "operations", "tenant_onboarding", "channel_manager", "customer_service"]);
  assert.equal((await api.call("POST", "/platform/v1/quotes/preview", { body: ask() })).status, 401);
});

test("试算不写任何东西：不留审计日志、不改商品的版本号、不占库存", async () => {
  const snapshot = async (): Promise<unknown> => ({
    logs: (await api.db.owner.query("select count(*)::int as n from audit_logs")).rows[0].n,
    products: (await api.db.owner.query("select id, version, updated_at from products order by id")).rows,
    inventory: (await api.db.owner.query("select product_id, day, total, held, sold from inventory_days order by product_id, day")).rows,
  });
  const beforeAll = await snapshot();
  await preview();
  await ok(call(a, "POST", `/products/${ids["pa"]}/quote-preview`, { body: { direction: "pickup", dropoff: WEST, service_time: "2026-10-20T10:00", passengers: 2 } }));
  assert.deepEqual(await snapshot(), beforeAll);
});

test("接口定义对账：两个试算接口的应答字段和 openapi.yaml 里各 schema 的必有字段一致；报不出价的原因和定义里的枚举、domain 的清单一致，每个都有中文说明", async () => {
  const { readFile } = await import("node:fs/promises");
  const { parse } = await import("yaml");
  const { QUOTE_REFUSALS } = await import("@nozomi/domain");
  const { REFUSAL_MESSAGES } = await import("./routes/quotes.ts");
  const doc = parse(await readFile(new URL("../openapi.yaml", import.meta.url), "utf8"));
  const schemas = doc.components.schemas;
  const same = (value: object, name: string, schema: any = schemas[name]): void => {
    assert.equal(schema.additionalProperties, false, name);
    assert.deepEqual(Object.keys(value).sort(), [...schema.required].sort(), name);
    assert.deepEqual(Object.keys(schema.properties).sort(), [...schema.required].sort(), `${name}：定义里的字段都是必有的`);
  };
  const platformBody = await preview({ service_time: "2026-10-24T10:00", addons: [{ addon_id: ids["seat"], quantity: 2 }] });
  same(platformBody, "PlatformQuotePreview");
  const groupSchema = schemas["PlatformQuotePreview"].properties.groups.items;
  same(platformBody.groups[0], "group", groupSchema);
  same(platformBody.groups[0].winner, "winner", groupSchema.properties.winner);
  same(platformBody.groups[0].candidates[0], "candidate", groupSchema.properties.candidates.items);
  same(platformBody.refused[0], "refused", schemas["PlatformQuotePreview"].properties.refused.items);
  const offer = platformBody.groups.flatMap((entry: any) => entry.candidates).find((entry: any) => entry.offer.settlement.addon_items.length > 0).offer;
  same(offer, "QuoteOffer");
  same(offer.settlement, "QuoteSettlement");
  same(offer.settlement.exact, "exact", schemas["QuoteSettlement"].properties.exact);
  same(offer.settlement.adjusts[0], "adjusts", schemas["QuoteSettlement"].properties.adjusts.items);
  same(offer.settlement.adjusts[0].steps[0], "steps", schemas["QuoteSettlement"].properties.adjusts.items.properties.steps.items);
  same(offer.settlement.addon_items[0], "addon_items", schemas["QuoteSettlement"].properties.addon_items.items);
  same(offer.settlement.free_wait, "free_wait", schemas["QuoteSettlement"].properties.free_wait);
  const tenantBody = await ok(call(a, "POST", `/products/${ids["pa"]}/quote-preview`, { body: { direction: "pickup", dropoff: EAST, service_time: "2026-10-20T10:00", passengers: 2 } }));
  same(tenantBody, "TenantQuotePreview");
  same(tenantBody.offers[0], "QuoteOffer");
  same(tenantBody.refused[0], "refused", schemas["TenantQuotePreview"].properties.refused.items);
  const refusedBody = await ok(call(a, "POST", `/products/${ids["pa"]}/quote-preview`, { body: { direction: "pickup", dropoff: FAR, service_time: "2026-10-20T10:00", passengers: 2 } }));
  same(refusedBody.refusal, "refusal", schemas["TenantQuotePreview"].properties.refusal);
  // 租户侧的定义里（连同它引用的结构）没有对外价、加价比例
  const tenantSchemas = JSON.stringify([schemas["TenantQuotePreview"], schemas["QuoteOffer"], schemas["QuoteSettlement"], schemas["QuotePreviewRequest"]]).replace(/"description":"[^"]*"/g, "");
  assert.doesNotMatch(tenantSchemas, /sell|markup|rank_price|band|score|winner|fx/i);
  // 原因代码
  const reasons = [...QUOTE_REFUSALS, "FX_RATE_UNAVAILABLE", "SELL_PRICE_OVER_LIMIT"];
  assert.deepEqual(schemas["QuoteRefusalReason"].enum, reasons);
  assert.deepEqual(Object.keys(REFUSAL_MESSAGES).sort(), [...reasons].sort());
  for (const message of Object.values(REFUSAL_MESSAGES)) assert.match(message, /[一-鿿]/);
  for (const reason of reasons) assert.ok(schemas["QuoteRefusalReason"].description.includes(`\`${reason}\``), reason);
  // 请求的定义和实现一致：必填项
  assert.deepEqual([schemas["QuotePreviewRequest"].required, schemas["PlatformQuotePreviewRequest"].required], [["service_time", "passengers"], ["city_id", "category", "currency", "service_time", "passengers"]]);
});
