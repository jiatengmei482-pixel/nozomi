/**
 * 报价试算的补充集成测试（M2-01，测试角色）：真实接口、真实 PostgreSQL。
 * - 入参异常：缺字段、非法时间、非法坐标、数量越界——400，指到是哪一项，带中文说明；
 * - 租户侧：tenant_id 只来自令牌；租户试算根本不去取加价、汇率、评分（规则 4）；
 * - 时区和日期边界：提前预订时长正好 24 小时、夜间时段跨午夜和 06:00 整、库存按城市当地的日期（跨月）；
 * - 外部服务（路线预估、汇率）慢、出错时不拖垮整次比价；并发试算结果一致。
 * 路线预估、汇率、加价、评分用可以改的替身；测试数据只在这里构造，结束时连同 schema 一起删除。
 * 用 `{ todo: '缺陷 #n' }` 标记的测试是已发现的缺陷：断言写的是期望行为，现在会失败。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { FxQuote, RouteEstimate } from "@nozomi/domain";
import { type ApiResponse, type HttpMethod, type TenantFixture, type TestApi, createTestApi } from "./testing/api.ts";

let api: TestApi;
let root: string;
let a: TenantFixture;
let b: TenantFixture;
const ids: Record<string, string> = {};

// 替身：每样都数被调用了几次；路线和汇率可以切换成「慢」「出错」
type Mode = "normal" | "slow" | "throw";
let routeMode: Mode = "normal";
let route: RouteEstimate | null = null;
let fxMode: Mode = "normal";
const rates = new Map<string, string>();
const calls = { route: 0, fx: 0, markup: 0, standings: 0 };
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const platform = (method: HttpMethod, path: string, body?: unknown, token: string = root): Promise<ApiResponse> => api.call(method, `/platform/v1${path}`, { token, ...(body === undefined ? {} : { body }) });
const call = (who: TenantFixture, method: HttpMethod, path: string, options: { body?: unknown; version?: number; headers?: Record<string, string> } = {}): Promise<ApiResponse> =>
  api.call(method, `/tenant/v1${path}`, {
    token: who.adminToken,
    ...(options.body === undefined ? {} : { body: options.body }),
    headers: {
      ...options.headers,
      ...(options.version === undefined ? {} : { "if-match": `"${options.version}"` }),
      ...(method === "POST" && /^\/(products|brands|areas)$|\/price-rules$|\/adjust-rules$/.test(path) ? { "idempotency-key": randomUUID() } : {}),
    },
  });
async function ok(res: Promise<ApiResponse>, status = 200): Promise<any> {
  const done = await res;
  assert.equal(done.status, status, done.text);
  return done.body;
}
const polygon = (kind: "operate" | "forbid", west: number, south: number, east: number, north: number): unknown => ({ kind, geometry: { type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] } });
const WEST = { lng: 139.2, lat: 35.5 };
const version = async (who: TenantFixture, productId: string): Promise<number> => (await ok(call(who, "GET", `/products/${productId}`))).version;

async function area(who: TenantFixture, name: string, polygons: unknown[]): Promise<string> {
  api.clock.advance(1_000);
  return (await ok(call(who, "POST", "/areas", { body: { city_id: ids["tokyo"], name: { zh: name }, biz_type: "general", polygons } }), 201)).id;
}
/** 一个接送机商品（成田）：一个区域、商务 7 座、提前 24 小时、全天服务；`rules` 覆盖服务规则的某几项；`price` 是价格规则 */
async function transfer(who: TenantFixture, brandId: string, areaId: string, price: Record<string, unknown>, rules: Record<string, unknown> = {}): Promise<string> {
  api.clock.advance(1_000);
  const created = await ok(
    call(who, "POST", "/products", {
      body: { brand_id: brandId, city_id: ids["tokyo"], category: "airport_transfer", poi_id: ids["narita"], areas: [{ area_id: areaId }], vehicle_groups: [{ vehicle_group_id: ids["biz7"], passengers: 6, luggage: 4 }], dispatchers: [{ name: "调度", phone: "0312345678" }] },
    }),
    201,
  );
  const saved = await ok(call(who, "PUT", `/products/${created.id}/service-rules`, { version: 1, body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { pickup: { mode: "limited", minutes: 90 }, dropoff: { mode: "limited", minutes: 15 } }, ...rules } }));
  await ok(call(who, "PUT", `/products/${created.id}/content`, { version: saved.version, body: { zh: { title: "成田机场接送", pickup_guide: "到达大厅 3 号门" } } }));
  await ok(call(who, "POST", `/products/${created.id}/price-rules`, { version: await version(who, created.id), body: { area_id: areaId, vehicle_group_id: ids["biz7"], direction: "both", pricing_model: "fixed", valid_from: "2026-01-01", ...price } }), 201);
  return created.id;
}
const publish = (who: TenantFixture, productId: string): Promise<any> => ok(call(who, "POST", `/products/${productId}/publish`));

/** 平台侧：接机到 WEST，2026-10-20 10:00 东京，2 人 */
const ask = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ city_id: ids["tokyo"], category: "airport_transfer", place_id: ids["narita"], currency: "JPY", direction: "pickup", dropoff: WEST, service_time: "2026-10-20T10:00", passengers: 2, luggage: 1, vehicle_group_ids: [ids["biz7"]], ...extra });
/** 租户侧：同样的用车 */
const own = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ direction: "pickup", dropoff: WEST, service_time: "2026-10-20T10:00", passengers: 2, luggage: 1, ...extra });
const tenantPreview = (who: TenantFixture, productId: string, body: Record<string, unknown>): Promise<any> => ok(call(who, "POST", `/products/${productId}/quote-preview`, { body }));
/** 租户试算的结果：商务 7 座的结算价，或原因 */
const totalOf = (body: any): number | string => body.refusal?.reason ?? body.offers[0]?.settlement.total ?? body.refused[0]?.reason;

before(async () => {
  api = await createTestApi({
    quote: {
      routes: {
        estimate: async () => {
          calls.route += 1;
          if (routeMode === "throw") throw new Error("路线服务连接超时");
          if (routeMode === "slow") await pause(300);
          return route;
        },
      },
      fx: {
        quote: async (from, to): Promise<FxQuote | null> => {
          calls.fx += 1;
          if (fxMode === "throw") throw new Error("汇率服务连接超时");
          return rates.has(`${from}>${to}`) ? { from, to, rate: rates.get(`${from}>${to}`) as string, asOf: api.clock.now().toISOString() } : null;
        },
      },
      markup: {
        floorBp: 1_000,
        bandBp: 300,
        markupBp: () => {
          calls.markup += 1;
          return 1_200;
        },
      },
      standings: {
        load: async (_db, tenantIds) => {
          calls.standings += 1;
          return new Map(tenantIds.map((tenantId) => [tenantId, { scoreCenti: null, completedOrders: 0, observation: false }]));
        },
      },
    },
  });
  root = await api.superAdminToken();
  a = await api.tenantWithAdmin(root, "甲车队", "admin@quote-qa-a.test");
  b = await api.tenantWithAdmin(root, "乙车队", "admin@quote-qa-b.test");
  ids["tokyo"] = (await ok(platform("POST", "/master/cities", { country_code: "JP", timezone: "Asia/Tokyo", code: "CTY-JP-TYO", name: { zh: "东京" }, center: { lng: 139.6917, lat: 35.6895 } }), 201)).id;
  ids["osaka"] = (await ok(platform("POST", "/master/cities", { country_code: "JP", timezone: "Asia/Tokyo", code: "CTY-JP-OSA", name: { zh: "大阪" }, center: { lng: 135.5, lat: 34.7 } }), 201)).id;
  ids["narita"] = (await ok(platform("POST", "/master/places", { location: { lng: 140.3887, lat: 35.7686 }, type: "airport", code: "NRT", city_id: ids["tokyo"], name: { zh: "成田机场" }, flight_scope: "international" }), 201)).id;
  ids["kansai"] = (await ok(platform("POST", "/master/places", { location: { lng: 135.24, lat: 34.43 }, type: "airport", code: "KIX", city_id: ids["osaka"], name: { zh: "关西机场" }, flight_scope: "international" }), 201)).id;
  ids["biz7"] = (await ok(platform("POST", "/master/vehicle-groups", { grade: "business", seats: 7, power: "fuel", combos: [{ passengers: 6, luggage: 4 }], code: "VG-BIZ-7", name: { zh: "商务 7 座" } }), 201)).id;
  ids["brandA"] = (await ok(call(a, "POST", "/brands", { body: { name: "甲 JP", currency: "JPY" } }), 201)).id;
  ids["brandAcny"] = (await ok(call(a, "POST", "/brands", { body: { name: "甲 CNY", currency: "CNY" } }), 201)).id;
  ids["brandB"] = (await ok(call(b, "POST", "/brands", { body: { name: "乙 JP", currency: "JPY" } }), 201)).id;
  ids["areaA"] = await area(a, "东京全域", [polygon("operate", 139.0, 35.0, 140.0, 36.0)]);
  ids["areaB"] = await area(b, "东京全域", [polygon("operate", 139.0, 35.0, 140.0, 36.0)]);
  // 乙：一口价 19,800，已上架
  ids["pb"] = await transfer(b, ids["brandB"] as string, ids["areaB"] as string, { base_price: 19_800 });
  await publish(b, ids["pb"] as string);
  // 甲：夜间按次 3,000（22:00–06:00）的草稿商品，一口价 20,000
  ids["night"] = await transfer(a, ids["brandA"] as string, ids["areaA"] as string, { base_price: 20_000 }, { night: { enabled: true, window: { start: "22:00", end: "06:00" }, amount: 3_000, charge_unit: "per_order" } });
  // 甲：限量库存的草稿商品，一口价 15,000
  ids["inv"] = await transfer(a, ids["brandA"] as string, ids["areaA"] as string, { base_price: 15_000 });
});
after(() => api.close());

// ---- 入参异常 ----

test("QA 平台侧试算的入参异常：缺字段、非法时间、非法坐标、数量越界、品类和接送点对不上——400，指到是哪一项，带中文说明", async () => {
  const issues = async (body: unknown): Promise<[string, string][]> => {
    const res = await platform("POST", "/quotes/preview", body);
    assert.deepEqual([res.status, res.body?.error?.code], [400, "VALIDATION_FAILED"], res.text);
    const list = res.body.error.details.issues as { path: string; message: string }[];
    for (const issue of list) assert.match(issue.message, /[一-鿿]/, JSON.stringify(issue));
    return list.map((issue) => [issue.path, issue.message]);
  };
  const paths = async (body: unknown): Promise<string[]> => (await issues(body)).map(([path]) => path);
  const without = (key: string): Record<string, unknown> => Object.fromEntries(Object.entries(ask()).filter(([name]) => name !== key));
  // 缺字段
  assert.deepEqual(await issues(without("service_time")), [["/service_time", "必填"]]);
  assert.deepEqual(await issues(without("passengers")), [["/passengers", "必填"]]);
  assert.deepEqual(await paths(without("city_id")), ["/city_id"]);
  assert.deepEqual(await paths(without("currency")), ["/currency"]);
  assert.deepEqual((await paths({})).sort(), ["/category", "/city_id", "/currency", "/passengers", "/service_time"]);
  assert.deepEqual(await paths([]), ["/"], "请求体不是对象");
  // 非法时间：不存在的日期、24:00、带秒、带时区、空格分隔、不是字符串
  for (const time of ["2026-13-01T10:00", "2026-02-29T10:00", "2026-10-20T24:00", "2026-10-20 10:00", "2026-10-20T9:00", "", "明天上午"]) assert.deepEqual(await paths(ask({ service_time: time })), ["/service_time"], time);
  for (const time of ["2026-10-20T10:00:00", "2026-10-20T10:00+09:00", 1_760_000_000]) assert.deepEqual(await paths(ask({ service_time: time })), ["/service_time"], String(time));
  // 非法坐标：越界、类型不对、缺一项、多一项
  assert.deepEqual(await paths(ask({ dropoff: { lng: 181, lat: 35.5 } })), ["/dropoff/lng"]);
  assert.deepEqual(await paths(ask({ dropoff: { lng: 139.2, lat: -90.5 } })), ["/dropoff/lat"]);
  assert.deepEqual(await paths(ask({ dropoff: { lng: "139.2", lat: 35.5 } })), ["/dropoff/lng"]);
  assert.deepEqual(await paths(ask({ dropoff: { lng: 139.2 } })), ["/dropoff/lat"]);
  assert.deepEqual(await paths(ask({ dropoff: [139.2, 35.5] })), ["/dropoff"]);
  // 数量
  assert.deepEqual(await paths(ask({ passengers: 2.5 })), ["/passengers"]);
  assert.deepEqual(await paths(ask({ passengers: 61 })), ["/passengers"]);
  assert.deepEqual(await paths(ask({ luggage: -1 })), ["/luggage"]);
  assert.deepEqual(await paths(ask({ addons: [{ addon_id: randomUUID(), quantity: 0 }] })), ["/addons/0/quantity"]);
  assert.deepEqual(await paths(ask({ addons: [{ addon_id: "儿童座椅" }] })), ["/addons/0/addon_id"]);
  assert.deepEqual(await paths(ask({ direction: "both" })), ["/direction"], "请求的方向只有接机、送机");
  assert.deepEqual(await paths(ask({ category: "airport_transfer", package_hours: 0 })), ["/package_hours"]);
  assert.deepEqual(await paths(ask({ assume_route: { meters: 1_000, minutes: 10_081 } })), ["/assume_route"]);
  assert.deepEqual(await paths(ask({ city_id: "tokyo" })), ["/city_id"]);
  // 品类和接送点：包车不收接送点；接送点不在这个城市
  assert.deepEqual(await paths(ask({ category: "charter", direction: null, package_hours: 10, pickup: WEST, dropoff: null })), ["/place_id"]);
  assert.deepEqual(await issues(ask({ place_id: ids["kansai"] })), [["/place_id", "接送点不存在、不是机场或车站，或者不在这个城市"]]);
  // 几处同时不对：都报出来
  assert.deepEqual((await paths(ask({ direction: null, passengers: 0, luggage: 99 }))).sort(), ["/direction", "/luggage", "/passengers"]);
});

test("QA 租户侧试算的入参异常：同样 400 指到哪一项；不收币种、tenant_id、加价比例；商品编号写错是 404", async () => {
  const res = async (body: unknown): Promise<string[]> => {
    const done = await call(a, "POST", `/products/${ids["night"]}/quote-preview`, { body });
    assert.deepEqual([done.status, done.body?.error?.code], [400, "VALIDATION_FAILED"], done.text);
    return done.body.error.details.issues.map((issue: { path: string }) => issue.path);
  };
  assert.deepEqual((await res({})).sort(), ["/passengers", "/service_time"]);
  assert.deepEqual(await res(own({ dropoff: null })), ["/dropoff"], "接机要给下车点");
  assert.deepEqual(await res(own({ direction: null })), ["/direction"]);
  assert.deepEqual(await res(own({ service_time: "2026-11-31T10:00" })), ["/service_time"]);
  assert.deepEqual(await res(own({ dropoff: { lng: 139.2, lat: 95 } })), ["/dropoff/lat"]);
  assert.deepEqual(await res(own({ package_hours: 10 })), ["/package_hours"], "接送机不收套餐时长");
  for (const extra of [{ tenant_id: b.tenantId }, { currency: "JPY" }, { markup_bp: 0 }, { city_id: ids["osaka"] }]) assert.deepEqual(await res(own(extra)), ["/"], JSON.stringify(extra));
  for (const productId of ["not-a-uuid", randomUUID()]) {
    const done = await call(a, "POST", `/products/${productId}/quote-preview`, { body: own() });
    assert.deepEqual([done.status, done.body.error.code], [404, "NOT_FOUND"], productId);
  }
});

test("QA 入参里多了不认识的字段：400 的说明应当是中文（现在是 zod 的英文原文）", async () => {
  for (const body of [ask({ dropoff: { lng: 139.2, lat: 35.5, alt: 3 } }), ask({ tenant_id: b.tenantId })]) {
    const res = await platform("POST", "/quotes/preview", body);
    assert.equal(res.status, 400, res.text);
    for (const issue of res.body.error.details.issues) assert.match(issue.message, /[一-鿿]/, JSON.stringify(issue));
  }
  const tenantRes = await call(a, "POST", `/products/${ids["night"]}/quote-preview`, { body: own({ currency: "JPY" }) });
  assert.equal(tenantRes.status, 400, tenantRes.text);
  for (const issue of tenantRes.body.error.details.issues) assert.match(issue.message, /[一-鿿]/, JSON.stringify(issue));
});

// ---- 租户隔离、规则 4 ----

test("QA 租户侧：tenant_id 只来自令牌——查询参数、请求头里写别的租户都不管用；乙看甲的草稿商品是 404；试算不去取加价、汇率、评分", async () => {
  // 查询参数、请求头带乙的编号：仍按令牌（甲）来，照常看到甲自己的商品
  const viaQuery = await ok(api.call("POST", `/tenant/v1/products/${ids["night"]}/quote-preview?tenant_id=${b.tenantId}`, { token: a.adminToken, body: own() }));
  assert.equal(viaQuery.product_id, ids["night"]);
  const viaHeader = await ok(call(a, "POST", `/products/${ids["night"]}/quote-preview`, { body: own(), headers: { "x-tenant-id": b.tenantId } }));
  assert.equal(viaHeader.product_id, ids["night"]);
  // 乙拿甲的商品编号：404，带乙自己的编号也一样
  for (const path of [`/products/${ids["night"]}/quote-preview`, `/products/${ids["night"]}/quote-preview?tenant_id=${a.tenantId}`]) {
    const res = await api.call("POST", `/tenant/v1${path}`, { token: b.adminToken, body: own(), headers: { "x-tenant-id": a.tenantId } });
    assert.deepEqual([res.status, res.body.error.code], [404, "NOT_FOUND"], path);
    assert.doesNotMatch(res.text, /20000|甲车队/);
  }
  // 规则 4：租户试算的路径上不去取加价比例、汇率、评分（这几样根本不进这条路径），报得出、报不出都一样
  rates.set("JPY>CNY", "0.0468");
  const before = { ...calls };
  const quoted = await tenantPreview(a, ids["night"] as string, own({ service_time: "2026-10-20T23:00" }));
  const refused = await tenantPreview(a, ids["night"] as string, own({ dropoff: { lng: 141.5, lat: 35.5 } }));
  assert.deepEqual([totalOf(quoted), totalOf(refused)], [23_000, "OUT_OF_SERVICE_AREA"]);
  assert.deepEqual([calls.markup - before.markup, calls.fx - before.fx, calls.standings - before.standings], [0, 0, 0]);
  const text = JSON.stringify([quoted, refused]);
  assert.doesNotMatch(text, /sell|markup|1200|fx|rate|score|winner|candidate|band/i);
  // 对照：平台侧试算取了加价（12%）
  const platformBody = await ok(platform("POST", "/quotes/preview", ask()));
  assert.ok(calls.markup > before.markup);
  assert.deepEqual(platformBody.groups[0].candidates.map((entry: any) => [entry.tenant_name, entry.markup_bp, entry.sell]), [["乙车队", 1_200, 22_176]]);
  rates.clear();
});

// ---- 时区、日期边界 ----

test("QA 提前预订时长按城市当地时间算到分钟：正好 24 小时可以，差一分钟不行；报价日期是东京的日期", async () => {
  // 把时钟拨到整分钟（setup 里前进过若干秒）
  const now = api.clock.now().getTime();
  api.clock.advance(60_000 - (now % 60_000));
  const tokyo = (offsetMinutes: number): string => new Date(api.clock.now().getTime() + 9 * 3_600_000 + offsetMinutes * 60_000).toISOString().slice(0, 16);
  const exactly = await tenantPreview(a, ids["night"] as string, own({ service_time: tokyo(24 * 60) }));
  assert.deepEqual([totalOf(exactly), exactly.urgent, exactly.service_date], [20_000, false, tokyo(24 * 60).slice(0, 10)]);
  assert.equal(totalOf(await tenantPreview(a, ids["night"] as string, own({ service_time: tokyo(24 * 60 - 1) }))), "LEAD_TIME_TOO_SHORT");
  // 已经过去的时间
  assert.equal(totalOf(await tenantPreview(a, ids["night"] as string, own({ service_time: tokyo(0) }))), "SERVICE_TIME_PASSED");
  // 平台侧同样：乙在 24 小时整报得出、差一分钟报不出
  assert.equal((await ok(platform("POST", "/quotes/preview", ask({ service_time: tokyo(24 * 60) })))).groups[0].candidates[0].offer.settlement.total, 19_800);
  assert.deepEqual((await ok(platform("POST", "/quotes/preview", ask({ service_time: tokyo(24 * 60 - 1) })))).refused.map((entry: any) => entry.reason), ["LEAD_TIME_TOO_SHORT"]);
});

test("QA 夜间费跨午夜（东京当地时间）：21:59 不收、22:00 收、05:59 收、06:00 整不收；跨月的 00:30 收且报价日期是新的一天", async () => {
  const night = async (time: string): Promise<[number, number, string]> => {
    const body = await tenantPreview(a, ids["night"] as string, own({ service_time: time }));
    const s = body.offers[0].settlement;
    assert.equal(s.base + s.adjust + s.urgent + s.night + s.addons + s.driver_language, s.total, "明细之和等于结算价");
    return [s.total, s.night, body.service_date];
  };
  assert.deepEqual(await night("2026-10-20T21:59"), [20_000, 0, "2026-10-20"]);
  assert.deepEqual(await night("2026-10-20T22:00"), [23_000, 3_000, "2026-10-20"]);
  assert.deepEqual(await night("2026-10-21T05:59"), [23_000, 3_000, "2026-10-21"]);
  assert.deepEqual(await night("2026-10-21T06:00"), [20_000, 0, "2026-10-21"]);
  assert.deepEqual(await night("2026-10-31T23:30"), [23_000, 3_000, "2026-10-31"]);
  assert.deepEqual(await night("2026-11-01T00:30"), [23_000, 3_000, "2026-11-01"]);
});

test("QA 库存按城市当地的日期取（跨月、跨 UTC 日界）：东京 11-01 00:00 是 UTC 10-31，取的必须是 11-01 那一天的库存；库存为 0 不报", async () => {
  const productId = ids["inv"] as string;
  const limited = await ok(call(a, "PUT", `/products/${productId}/inventory`, { version: await version(a, productId), body: { mode: "limited" } }));
  await ok(call(a, "POST", `/products/${productId}/inventory/batch-set`, { version: limited.version, body: { from: "2026-10-31", to: "2026-10-31", total: 1 } }));
  const at = async (time: string): Promise<number | string> => totalOf(await tenantPreview(a, productId, own({ service_time: time })));
  assert.deepEqual([await at("2026-10-31T00:00"), await at("2026-10-31T23:59"), await at("2026-11-01T00:00"), await at("2026-11-01T08:59")], [15_000, 15_000, "SOLD_OUT", "SOLD_OUT"]);
  // 11-01 设成 0（停售）：还是不报；设成 1：报得出
  await ok(call(a, "POST", `/products/${productId}/inventory/batch-set`, { version: await version(a, productId), body: { from: "2026-11-01", to: "2026-11-01", total: 0 } }));
  assert.equal(await at("2026-11-01T00:00"), "SOLD_OUT");
  await ok(call(a, "POST", `/products/${productId}/inventory/batch-set`, { version: await version(a, productId), body: { from: "2026-11-01", to: "2026-11-01", total: 1 } }));
  assert.equal(await at("2026-11-01T00:00"), 15_000);
  // 已占满的那一天（10-31 的 1 单被订走）
  await api.db.owner.query("update inventory_days set held = 1 where product_id = $1 and day = '2026-10-31'", [productId]);
  assert.equal(await at("2026-10-31T23:59"), "SOLD_OUT");
  await ok(call(a, "PUT", `/products/${productId}/inventory`, { version: await version(a, productId), body: { mode: "unlimited" } }));
});

// ---- 外部服务 ----

/** 甲上架一个里程 + 时长的商品（要路线预估），和乙的一口价一起比；返回它的编号 */
async function meteredProduct(): Promise<string> {
  const id = await transfer(a, ids["brandA"] as string, ids["areaA"] as string, { pricing_model: "mileage_time", start_price: 3_000, start_meters: 5_000, start_minutes: 20, per_km: 400, per_minute: 80 });
  await publish(a, id);
  return id;
}

test("QA 路线服务慢（300 毫秒后取不到）：里程 + 时长的报 ROUTE_UNAVAILABLE，一口价照常中标", async () => {
  const metered = await meteredProduct();
  try {
    routeMode = "slow";
    route = null;
    const body = await ok(platform("POST", "/quotes/preview", ask()));
    assert.deepEqual([body.groups[0].winner.product_id, body.refused.map((entry: any) => [entry.product_id, entry.reason])], [ids["pb"], [[metered, "ROUTE_UNAVAILABLE"]]]);
    // 慢但取到了：照常算
    route = { meters: 12_500, minutes: 45 };
    const priced = await ok(platform("POST", "/quotes/preview", ask()));
    assert.deepEqual(priced.groups[0].candidates.map((entry: any) => [entry.product_id, entry.offer.settlement.total]), [[metered, 8_000], [ids["pb"], 19_800]]);
  } finally {
    routeMode = "normal";
    route = null;
    await ok(call(a, "POST", `/products/${metered}/unpublish`));
  }
});

test("QA 路线服务出错（抛异常，如连接超时）：不应让整次比价 500——里程 + 时长的报 ROUTE_UNAVAILABLE，一口价照常中标", async () => {
  const metered = await meteredProduct();
  try {
    routeMode = "throw";
    const res = await platform("POST", "/quotes/preview", ask());
    assert.equal(res.status, 200, res.text);
    assert.deepEqual([res.body.groups[0].winner.product_id, res.body.refused.map((entry: any) => [entry.product_id, entry.reason])], [ids["pb"], [[metered, "ROUTE_UNAVAILABLE"]]]);
    // 租户自己试算这个商品：同样报 ROUTE_UNAVAILABLE，而不是 500
    const mine = await call(a, "POST", `/products/${metered}/quote-preview`, { body: own() });
    assert.deepEqual([mine.status, mine.body?.refused?.[0]?.reason], [200, "ROUTE_UNAVAILABLE"], mine.text);
  } finally {
    routeMode = "normal";
    await ok(call(a, "POST", `/products/${metered}/unpublish`));
  }
});

test("QA 汇率服务出错（抛异常）：不应让整次比价 500——跨币种的报 FX_RATE_UNAVAILABLE，同币种的照常中标", async () => {
  const cny = await transfer(a, ids["brandAcny"] as string, ids["areaA"] as string, { base_price: 90_000 });
  await publish(a, cny);
  try {
    fxMode = "throw";
    const res = await platform("POST", "/quotes/preview", ask());
    assert.equal(res.status, 200, res.text);
    assert.deepEqual([res.body.groups[0].winner.product_id, res.body.refused.map((entry: any) => [entry.product_id, entry.reason])], [ids["pb"], [[cny, "FX_RATE_UNAVAILABLE"]]]);
  } finally {
    fxMode = "normal";
    await ok(call(a, "POST", `/products/${cny}/unpublish`));
  }
});

// ---- 并发 ----

test("QA 并发：同一时刻 10 个平台试算和 10 个租户试算，结果彼此一致（缓存刷新不串数据）", async () => {
  const [platforms, tenants] = await Promise.all([
    Promise.all(Array.from({ length: 10 }, () => ok(platform("POST", "/quotes/preview", ask())))),
    Promise.all(Array.from({ length: 10 }, () => tenantPreview(a, ids["night"] as string, own({ service_time: "2026-10-20T23:00" })))),
  ]);
  for (const body of platforms) assert.deepEqual(body, platforms[0]);
  for (const body of tenants) assert.deepEqual(body, tenants[0]);
  assert.deepEqual([platforms[0].groups[0].winner.sell, totalOf(tenants[0])], [22_176, 23_000]);
});
