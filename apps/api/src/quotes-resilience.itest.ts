/**
 * 报价试算遇到外部服务出问题（M2-01，ADR 0020「外部调用」）：真实接口、真实 PostgreSQL。
 * - 路线预估、汇率超过等待上限（这里设成 100 毫秒）或抛异常：用得到它的商品报 ROUTE_UNAVAILABLE / FX_RATE_UNAVAILABLE，其余照常，整次试算不失败；
 * - 日志里记一条，带依赖名和异常，但不带密钥原文和连接串；
 * - 外部调用发生在数据库事务之外：调用的那一刻连接池里没有被占着的连接；
 * - 停用的城市、机场：平台试算明说原因（409），而不是返回 0 个候选。
 * 路线预估、汇率用可以改的替身；测试数据只在这里构造，结束时连同 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { FxQuote, RouteEstimate } from "@nozomi/domain";
import { type ApiResponse, type HttpMethod, type TenantFixture, type TestApi, createTestApi } from "./testing/api.ts";
import { FAKE_SECRETS } from "./testing/fixtures.ts";

let api: TestApi;
let root: string;
let a: TenantFixture;
const ids: Record<string, string> = {};

type Mode = "normal" | "hang" | "throw";
let routeMode: Mode = "normal";
let fxMode: Mode = "normal";
/** 外部调用的那一刻连接池里被占着的连接数 */
const busyDuringCall: number[] = [];
const busy = (): number => api.db.pool.totalCount - api.db.pool.idleCount;
/** 一直不返回（直到测试结束时放掉） */
const pending: (() => void)[] = [];
const hang = <T>(): Promise<T> => new Promise<T>((resolve) => pending.push(() => resolve(null as T)));
/** 一个带着连接串和密钥原文的异常：日志里不能原样出现 */
const leakyError = (): Error => Object.assign(new Error(`connect to postgres://svc:${FAKE_SECRETS.databasePassword}@10.0.0.9/fx failed, key=${FAKE_SECRETS.googleMapsApiKey}`), { code: "ECONNRESET" });

const platform = (method: HttpMethod, path: string, body?: unknown): Promise<ApiResponse> => api.call(method, `/platform/v1${path}`, { token: root, ...(body === undefined ? {} : { body }) });
const call = (method: HttpMethod, path: string, options: { body?: unknown; version?: number } = {}): Promise<ApiResponse> =>
  api.call(method, `/tenant/v1${path}`, {
    token: a.adminToken,
    ...(options.body === undefined ? {} : { body: options.body }),
    headers: {
      ...(options.version === undefined ? {} : { "if-match": `"${options.version}"` }),
      ...(method === "POST" && /^\/(products|brands|areas)$|\/price-rules$/.test(path) ? { "idempotency-key": randomUUID() } : {}),
    },
  });
async function ok(res: Promise<ApiResponse>, status = 200): Promise<any> {
  const done = await res;
  assert.equal(done.status, status, done.text);
  return done.body;
}
const WEST = { lng: 139.2, lat: 35.5 };
const version = async (productId: string): Promise<number> => (await ok(call("GET", `/products/${productId}`))).version;

/** 甲的一个接送机商品（成田）：`brand` 决定结算币种，`price` 是价格规则 */
async function product(brandId: string, price: Record<string, unknown>): Promise<string> {
  api.clock.advance(1_000);
  const created = await ok(
    call("POST", "/products", {
      body: { brand_id: brandId, city_id: ids["tokyo"], category: "airport_transfer", poi_id: ids["narita"], areas: [{ area_id: ids["area"] }], vehicle_groups: [{ vehicle_group_id: ids["biz7"], passengers: 6, luggage: 4 }], dispatchers: [{ name: "调度", phone: "0312345678" }] },
    }),
    201,
  );
  const saved = await ok(call("PUT", `/products/${created.id}/service-rules`, { version: 1, body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { pickup: { mode: "limited", minutes: 90 }, dropoff: { mode: "limited", minutes: 15 } } } }));
  await ok(call("PUT", `/products/${created.id}/content`, { version: saved.version, body: { zh: { title: "成田机场接送", pickup_guide: "到达大厅 3 号门" } } }));
  await ok(call("POST", `/products/${created.id}/price-rules`, { version: await version(created.id), body: { area_id: ids["area"], vehicle_group_id: ids["biz7"], direction: "both", valid_from: "2026-01-01", ...price } }), 201);
  await ok(call("POST", `/products/${created.id}/publish`));
  return created.id;
}

const ask = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ city_id: ids["tokyo"], category: "airport_transfer", place_id: ids["narita"], currency: "JPY", direction: "pickup", dropoff: WEST, service_time: "2026-10-20T10:00", passengers: 2, luggage: 1, ...extra });
const reasons = (body: any): [string, string][] => body.refused.map((entry: any) => [entry.product_id, entry.reason]);

before(async () => {
  api = await createTestApi({
    quote: {
      externalTimeoutMs: 100,
      routes: {
        estimate: async (): Promise<RouteEstimate | null> => {
          busyDuringCall.push(busy());
          if (routeMode === "throw") throw leakyError();
          if (routeMode === "hang") return hang();
          return { meters: 12_500, minutes: 45 };
        },
      },
      fx: {
        quote: async (from, to): Promise<FxQuote | null> => {
          busyDuringCall.push(busy());
          if (fxMode === "throw") throw leakyError();
          if (fxMode === "hang") return hang();
          return { from, to, rate: "21.5", asOf: api.clock.now().toISOString() };
        },
      },
    },
  });
  root = await api.superAdminToken();
  a = await api.tenantWithAdmin(root, "甲车队", "admin@quote-resilience.test");
  ids["tokyo"] = (await ok(platform("POST", "/master/cities", { country_code: "JP", timezone: "Asia/Tokyo", code: "CTY-JP-TYO", name: { zh: "东京" }, center: { lng: 139.6917, lat: 35.6895 } }), 201)).id;
  ids["narita"] = (await ok(platform("POST", "/master/places", { location: { lng: 140.3887, lat: 35.7686 }, type: "airport", code: "NRT", city_id: ids["tokyo"], name: { zh: "成田机场" }, flight_scope: "international" }), 201)).id;
  ids["biz7"] = (await ok(platform("POST", "/master/vehicle-groups", { grade: "business", seats: 7, power: "fuel", combos: [{ passengers: 6, luggage: 4 }], code: "VG-BIZ-7", name: { zh: "商务 7 座" } }), 201)).id;
  ids["jpy"] = (await ok(call("POST", "/brands", { body: { name: "甲 JP", currency: "JPY" } }), 201)).id;
  ids["cny"] = (await ok(call("POST", "/brands", { body: { name: "甲 CNY", currency: "CNY" } }), 201)).id;
  api.clock.advance(1_000);
  ids["area"] = (await ok(call("POST", "/areas", { body: { city_id: ids["tokyo"], name: { zh: "东京全域" }, biz_type: "general", polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [[[139.0, 35.0], [140.0, 35.0], [140.0, 36.0], [139.0, 36.0], [139.0, 35.0]]] } }] } }), 201)).id;
  // 一口价（日元 20,000）、里程 + 时长（日元，要路线预估）、一口价（人民币 1,000 元 ≈ 21,500 日元，要汇率）
  ids["fixed"] = await product(ids["jpy"] as string, { pricing_model: "fixed", base_price: 20_000 });
  ids["metered"] = await product(ids["jpy"] as string, { vehicle_group_id: ids["biz7"], pricing_model: "mileage_time", start_price: 3_000, start_meters: 5_000, start_minutes: 20, per_km: 400, per_minute: 80 });
  ids["cnyFixed"] = await product(ids["cny"] as string, { pricing_model: "fixed", base_price: 100_000 });
});
after(async () => {
  for (const release of pending) release();
  await api.close();
});

test("外部服务都正常：路线预估、汇率都在数据库事务之外调用（调用的那一刻连接池里没有被占着的连接）", async () => {
  busyDuringCall.length = 0;
  const body = await ok(platform("POST", "/quotes/preview", ask()));
  // 三个商品都是甲的：同一个车型组只留最便宜的（里程 + 时长 8,000）；另两个不在 refused 里
  assert.deepEqual([body.groups[0].winner.product_id, body.route, reasons(body)], [ids["metered"], { meters: 12_500, minutes: 45 }, []]);
  assert.equal(busyDuringCall.length, 2, "路线一次、汇率一次（只有人民币要换）");
  assert.deepEqual(busyDuringCall, [0, 0]);
  busyDuringCall.length = 0;
  const own = await ok(call("POST", `/products/${ids["metered"]}/quote-preview`, { body: { direction: "pickup", dropoff: WEST, service_time: "2026-10-20T10:00", passengers: 2, luggage: 1 } }));
  assert.deepEqual([own.offers[0].settlement.total, busyDuringCall], [8_000, [0]]);
});

test("路线预估一直不返回：等到上限（100 毫秒）就按取不到算——里程 + 时长的报 ROUTE_UNAVAILABLE，一口价照常中标；日志记了超时", async () => {
  routeMode = "hang";
  try {
    const started = Date.now();
    const body = await ok(platform("POST", "/quotes/preview", ask()));
    assert.ok(Date.now() - started < 2_000, `用了 ${Date.now() - started} 毫秒`);
    assert.deepEqual([body.groups[0].winner.product_id, body.route, reasons(body)], [ids["fixed"], null, [[ids["metered"], "ROUTE_UNAVAILABLE"]]]);
    const own = await ok(call("POST", `/products/${ids["metered"]}/quote-preview`, { body: { direction: "pickup", dropoff: WEST, service_time: "2026-10-20T10:00", passengers: 2, luggage: 1 } }));
    assert.deepEqual(own.refused.map((entry: any) => entry.reason), ["ROUTE_UNAVAILABLE"]);
    const logged = api.logs().split("\n").filter((line) => line.includes("QUOTE_DEPENDENCY_TIMEOUT")).map((line) => JSON.parse(line));
    assert.ok(logged.length >= 2, api.logs());
    assert.deepEqual([logged[0].level, logged[0].dependency, logged[0].err.type], [40, "route", "QuoteDependencyTimeout"]);
  } finally {
    routeMode = "normal";
  }
});

test("汇率服务抛异常（异常里带着连接串和密钥）：跨币种的报 FX_RATE_UNAVAILABLE，同币种的照常；日志里有这条异常，但没有密钥原文和连接串", async () => {
  fxMode = "throw";
  try {
    const res = await platform("POST", "/quotes/preview", ask());
    assert.equal(res.status, 200, res.text);
    assert.deepEqual([res.body.groups[0].winner.product_id, reasons(res.body)], [ids["metered"], [[ids["cnyFixed"], "FX_RATE_UNAVAILABLE"]]]);
    const logs = api.logs();
    const logged = logs.split("\n").filter((line) => line.includes("ECONNRESET")).map((line) => JSON.parse(line));
    assert.ok(logged.length >= 1, logs);
    assert.deepEqual([logged[0].dependency, logged[0].err.code], ["fx", "ECONNRESET"]);
    for (const secret of [FAKE_SECRETS.databasePassword, FAKE_SECRETS.googleMapsApiKey, "svc:"]) assert.ok(!logs.includes(secret), secret);
    assert.doesNotMatch(res.text, /ECONNRESET|postgres/);
  } finally {
    fxMode = "normal";
  }
});

test("路线预估和汇率同时出问题（一个抛异常、一个不返回）：两类各自报不出，一口价日元照常中标", async () => {
  routeMode = "throw";
  fxMode = "hang";
  try {
    const body = await ok(platform("POST", "/quotes/preview", ask()));
    assert.deepEqual([body.groups[0].winner.product_id, reasons(body).sort()], [ids["fixed"], [[ids["metered"], "ROUTE_UNAVAILABLE"], [ids["cnyFixed"], "FX_RATE_UNAVAILABLE"]].sort()]);
  } finally {
    routeMode = "normal";
    fxMode = "normal";
  }
});

test("停用的城市、机场：平台试算 409 MASTER_DATA_NOT_READY 并说明原因（不是 200 + 0 个候选）；重新启用后照常", async () => {
  // 有已上架商品的城市、机场经接口停不了（MASTER_DATA_IN_USE）；这里直接改库，模拟「停用之后」的状态
  const setStatus = (table: "cities" | "places", id: string, status: "active" | "disabled") => api.db.owner.query(`update ${table} set status = $1 where id = $2`, [status, id]);
  await setStatus("places", ids["narita"] as string, "disabled");
  const place = await platform("POST", "/quotes/preview", ask());
  assert.deepEqual([place.status, place.body.error.code, place.body.error.details.reason], [409, "MASTER_DATA_NOT_READY", "PLACE_DISABLED"]);
  assert.match(place.body.error.message, /停用/);
  await setStatus("cities", ids["tokyo"] as string, "disabled");
  const city = await platform("POST", "/quotes/preview", ask());
  assert.deepEqual([city.status, city.body.error.code, city.body.error.details.reason], [409, "MASTER_DATA_NOT_READY", "CITY_DISABLED"]);
  await setStatus("cities", ids["tokyo"] as string, "active");
  await setStatus("places", ids["narita"] as string, "active");
  assert.equal((await ok(platform("POST", "/quotes/preview", ask()))).candidate_count, 3);
});
