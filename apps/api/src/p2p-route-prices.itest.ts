/**
 * M8-11：点对点线路价、返程价格、含公里数（ADR 0073 第二部分），经真实接口、真实 PostgreSQL；路线预估、收款服务用替身。
 * - 价格规则：可空的下车区域 `to_area_id`（本商品的区域、不能等于上车区域、别人的区域 404、冲突键含下车区域）、一口价的含公里数（要么都填要么都不填）；
 * - 返程价格：批量新增一次建去程和返程两条（价格不同），同一事务——任一条冲突整批 409、一条都不写；
 * - 价格日历按线路看（有线路价用线路价，没有退回区域价）；导入导出加「下车区域」「含公里数」「超出每公里」三列，旧模版照样导入；
 * - 报价：线路价优先、不和区域价比低；含公里数按报价时的路线距离（向上取整到 1 公里）算进一口价并锁进快照和订单；拿不到路线时这条不报；
 * - 显示：供应商只看到结算价（规则 4），运营另有对外价参考，官网和渠道只有对外价；已下的订单（没有这些字段）照旧；
 * - 规则 2：甲读不到、改不了乙的线路价（价格规则、批量、修改、删除、价格日历、导出、导入预览），也不能用乙的区域当下车区域。
 * 测试数据全在本文件里经接口建出来，随测试 schema 一起删除（规则 1）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { RouteEstimate } from "@nozomi/domain";
import { XLSX_CONTENT_TYPE, type XlsxWriteCell, readXlsx, writeXlsx } from "./integrations/xlsx.ts";
import type { ApiResponse, HttpMethod, TenantFixture, TestApi } from "./testing/api.ts";
import { createTestApi } from "./testing/api.ts";
import { type Market, allKeys, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi, assertMatchesOperation } from "./testing/openapi.ts";
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";
import { routeLookup } from "./testing/routes.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let site: SiteApi;
let route: RouteEstimate | null = { meters: 34_200, minutes: 50 };
/** 乙的东京点对点商品：商品的区域是市区、机场；港口是乙的区域但商品没选 */
let p2pB: { id: string; city: string; airport: string; port: string };
/** 甲的大阪点对点商品 */
let p2pA: { id: string; area: string };

const square = (west: number, south: number, east: number, north: number) => ({ type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] });
const P = {
  city: { lng: 139.7, lat: 35.7 },
  city2: { lng: 139.6, lat: 35.6 },
  airport: { lng: 140.3, lat: 35.7 },
};
const SERVICE_LOCAL = "2026-10-20T10:00";
const PASSENGER = { name: "林小青", phone: "+81 90-3333-4444", email: "route.guest@example.com" };
const RULE4_KEYS = ["sell", "sell_minor", "markup", "markup_bp", "fx_buffer_bp", "channel", "area_surcharge_sell", "over_km_per_km_sell"];
let ipSeq = 0;
const nextIp = (): string => `10.89.${(ipSeq += 1)}.9`;

/** 供应商接口（自动带幂等键和 If-Match），不检查状态码 */
async function tenantCall(who: TenantFixture | string, method: HttpMethod, path: string, options: { body?: unknown; version?: number } = {}): Promise<ApiResponse> {
  const token = typeof who === "string" ? who : await tenantLogin(api, who.adminEmail);
  api.clock.advance(1_000);
  return api.call(method, `/tenant/v1${path}`, {
    token,
    ...(options.body === undefined ? {} : { body: options.body }),
    headers: { ...(options.version === undefined ? {} : { "if-match": `"${options.version}"` }), ...(method === "POST" && /^\/(products|brands|areas)$|\/(price-rules|adjust-rules)(\/batch)?$/.test(path) ? { "idempotency-key": randomUUID() } : {}) },
  });
}
const version = async (who: TenantFixture, productId: string): Promise<number> => (await ok(tenantCall(who, "GET", `/products/${productId}`))).version;

async function newArea(who: TenantFixture, cityId: string, name: string, polygon: ReturnType<typeof square>): Promise<string> {
  return (await ok(tenantCall(who, "POST", "/areas", { body: { city_id: cityId, name: { zh: name }, biz_type: "general", polygons: [{ kind: "operate", geometry: polygon }] } }), 201)).id;
}

/** 一个上架的点对点商品：区域 `areaIds`，每个区域、每个车型组一条区域价（一口价 `prices[区域下标]`）。 */
async function p2pProduct(who: TenantFixture, cityId: string, areaIds: string[], prices: number[]): Promise<string> {
  const brand = (await ok(tenantCall(who, "POST", "/brands", { body: { name: `点对点-${randomUUID().slice(0, 6)}`, currency: "JPY" } }), 201)).id;
  const created = await ok(
    tenantCall(who, "POST", "/products", {
      body: {
        brand_id: brand,
        city_id: cityId,
        category: "point_to_point",
        areas: areaIds.map((areaId) => ({ area_id: areaId })),
        vehicle_groups: [{ vehicle_group_id: m.ids.biz7, passengers: 6, luggage: 4 }, { vehicle_group_id: m.ids.eco4, passengers: 3, luggage: 2 }],
        dispatchers: [{ name: "调度", phone: "0312345678" }],
      },
    }),
    201,
  );
  const rules = await ok(tenantCall(who, "PUT", `/products/${created.id}/service-rules`, { version: 1, body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { general: { mode: "limited", minutes: 15 } } } }));
  const content = await ok(tenantCall(who, "PUT", `/products/${created.id}/content`, { version: rules.version, body: { zh: { title: "市内和机场用车" } } }));
  const create = areaIds.flatMap((areaId, index) => [m.ids.biz7, m.ids.eco4].map((vehicleGroupId) => ({ area_id: areaId, vehicle_group_id: vehicleGroupId, pricing_model: "fixed", base_price: prices[index], valid_from: "2026-01-01" })));
  await ok(tenantCall(who, "POST", `/products/${created.id}/price-rules/batch`, { version: content.version, body: { create } }));
  await ok(tenantCall(who, "POST", `/products/${created.id}/publish`));
  return created.id;
}

/** 一条线路价（一口价）的请求体 */
const line = (from: string, to: string, price: number, extra: Record<string, unknown> = {}) => ({ area_id: from, to_area_id: to, vehicle_group_id: m.ids.biz7, pricing_model: "fixed", base_price: price, valid_from: "2026-01-01", ...extra });
const KM = { included_km: 30, over_km_per_km: 300 };

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay, quote: { routes: { estimate: async () => routeLookup(route) } } });
  m = await buildMarket(api);
  const city = await newArea(m.b, m.ids.tokyo, "市区", square(139.5, 35.5, 139.8, 35.9));
  const airport = await newArea(m.b, m.ids.tokyo, "机场周边", square(140.2, 35.6, 140.5, 35.9));
  const port = await newArea(m.b, m.ids.tokyo, "港口", square(139.0, 35.5, 139.3, 35.9));
  // 区域价：市区 10,000、机场周边 8,000
  p2pB = { id: await p2pProduct(m.b, m.ids.tokyo, [city, airport], [10_000, 8_000]), city, airport, port };
  const osaka = await newArea(m.a, m.ids.osaka, "大阪市", square(135.3, 34.5, 135.7, 34.9));
  p2pA = { id: await p2pProduct(m.a, m.ids.osaka, [osaka], [9_000]), area: osaka };
  const channel = await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" });
  // 官网是另起的一个应用：路线预估用同一个替身
  site = await siteApi(api, (await salesCredentials(api, m, channel.id)).clientId, pay, {}, { quote: { routes: { estimate: async () => routeLookup(route) } } });
});
after(async () => {
  await site?.close();
  await api.close();
});

test("返程价格：批量新增一次建去程（含公里数）和返程两条，价格不同；价格页多出下车区域和含公里数，缺价统计不变；没有对外价和加价比例（规则 4）", async () => {
  const saved = await tenantCall(m.b, "POST", `/products/${p2pB.id}/price-rules/batch`, {
    version: await version(m.b, p2pB.id),
    body: { create: [{ ref: "go", ...line(p2pB.city, p2pB.airport, 18_000, KM) }, { ref: "back", ...line(p2pB.airport, p2pB.city, 17_000, KM) }] },
  });
  assertMatchesOpenApi("POST", "/tenant/v1/products/{id}/price-rules/batch", saved);
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.body.created_ids.length, 2);
  const listed = await tenantCall(m.b, "GET", `/products/${p2pB.id}/price-rules`);
  assertMatchesOpenApi("GET", "/tenant/v1/products/{id}/price-rules", listed);
  const lines = listed.body.items.filter((item: any) => item.to_area_id !== null).map((item: any) => [item.area_id, item.to_area_id, item.base_price, item.included_km, item.over_km_per_km, item.base]);
  assert.deepEqual(lines.sort((a: any[], b: any[]) => a[2] - b[2]), [
    [p2pB.airport, p2pB.city, 17_000, 30, 300, "17000"],
    [p2pB.city, p2pB.airport, 18_000, 30, 300, "18000"],
  ]);
  // 区域价照旧：没有下车区域、没有含公里数
  assert.deepEqual(listed.body.items.filter((item: any) => item.to_area_id === null).map((item: any) => [item.included_km, item.over_km_per_km]), [[null, null], [null, null], [null, null], [null, null]]);
  assert.deepEqual(listed.body.coverage, { total: 4, priced: 4, missing: 0 }, "线路价不算「该有的价格」");
  for (const res of [saved, listed]) for (const key of RULE4_KEYS) assert.ok(!allKeys(res.body).has(key), key);
  // 库里：下车区域一列，含公里数在参数里；区域价的参数和以前一样只有基础价
  const rows = await api.db.owner.query<{ to_area_id: string | null; params: Record<string, number> }>("select to_area_id, params from price_rules where product_id = $1", [p2pB.id]);
  assert.deepEqual(rows.rows.filter((row) => row.to_area_id === null).map((row) => Object.keys(row.params)), [["basePriceMinor"], ["basePriceMinor"], ["basePriceMinor"], ["basePriceMinor"]]);
  assert.deepEqual(rows.rows.filter((row) => row.to_area_id !== null).map((row) => row.params).sort((a, b) => (a["basePriceMinor"] as number) - (b["basePriceMinor"] as number)), [
    { basePriceMinor: 17_000, includedKm: 30, overKmPerKmMinor: 300 },
    { basePriceMinor: 18_000, includedKm: 30, overKmPerKmMinor: 300 },
  ]);
});

test("返程整批同一事务：返程那条和已有的线路价日期重叠 → 整批 409（列出冲突），去程那条也没写进去；同一线路换车型组、区域价和线路价之间不冲突", async () => {
  const before = (await api.db.owner.query<{ n: number }>("select count(*)::int as n from price_rules where product_id = $1", [p2pB.id])).rows[0]?.n;
  const conflict = await tenantCall(m.b, "POST", `/products/${p2pB.id}/price-rules/batch`, {
    version: await version(m.b, p2pB.id),
    body: { create: [{ ref: "go-eco", ...line(p2pB.city, p2pB.airport, 12_000, { vehicle_group_id: m.ids.eco4 }) }, { ref: "back-again", ...line(p2pB.airport, p2pB.city, 16_000, { valid_from: "2026-12-01" }) }] },
  });
  assertMatchesOpenApi("POST", "/tenant/v1/products/{id}/price-rules/batch", conflict);
  assert.deepEqual([conflict.status, conflict.body.error.code, conflict.body.error.details.conflicts.map((entry: any) => entry.ref)], [409, "PRICE_RULE_CONFLICT", ["back-again"]]);
  assert.equal((await api.db.owner.query<{ n: number }>("select count(*)::int as n from price_rules where product_id = $1", [p2pB.id])).rows[0]?.n, before, "一条都没写");
  // 同一个上车区域的区域价和线路价不冲突（区域价早就有）；eco4 的去程单独建可以
  const alone = await tenantCall(m.b, "POST", `/products/${p2pB.id}/price-rules`, { version: await version(m.b, p2pB.id), body: line(p2pB.city, p2pB.airport, 12_000, { vehicle_group_id: m.ids.eco4, valid_to: "2026-01-31" }) });
  assertMatchesOpenApi("POST", "/tenant/v1/products/{id}/price-rules", alone);
  assert.equal(alone.status, 201, alone.text);
  assert.deepEqual([alone.body.price_rule.to_area_id, alone.body.price_rule.included_km], [p2pB.airport, null]);
});

test("下车区域和含公里数的检查：同一个区域 400 SAME_AREA；商品没选的区域 400；别的供应商的、不存在的区域 404（批量整批 404）；含公里数只填一个 400；接送机不能填", async () => {
  const v = await version(m.b, p2pB.id);
  const issues = (res: ApiResponse) => [res.status, res.body.error.details?.issues?.map((issue: any) => [issue.path, issue.reason])];
  const same = await tenantCall(m.b, "POST", `/products/${p2pB.id}/price-rules`, { version: v, body: line(p2pB.city, p2pB.city, 1_000) });
  assertMatchesOpenApi("POST", "/tenant/v1/products/{id}/price-rules", same);
  assert.deepEqual(issues(same), [400, [["/to_area_id", "SAME_AREA"]]]);
  assert.deepEqual(issues(await tenantCall(m.b, "POST", `/products/${p2pB.id}/price-rules`, { version: v, body: line(p2pB.city, p2pB.port, 1_000) })), [400, [["/to_area_id", "AREA_NOT_IN_PRODUCT"]]]);
  for (const areaId of [p2pA.area, randomUUID()]) {
    const res = await tenantCall(m.b, "POST", `/products/${p2pB.id}/price-rules`, { version: v, body: line(p2pB.city, areaId, 1_000) });
    assertMatchesOpenApi("POST", "/tenant/v1/products/{id}/price-rules", res);
    assert.deepEqual([res.status, res.body.error.code], [404, "NOT_FOUND"], areaId);
    const batch = await tenantCall(m.b, "POST", `/products/${p2pB.id}/price-rules/batch`, { version: v, body: { create: [line(p2pB.airport, p2pB.city, 1_000, { vehicle_group_id: m.ids.eco4 }), line(p2pB.city, areaId, 1_000, { vehicle_group_id: m.ids.eco4 })] } });
    assert.equal(batch.status, 404, "整批不写");
  }
  assert.deepEqual(issues(await tenantCall(m.b, "POST", `/products/${p2pB.id}/price-rules`, { version: v, body: line(p2pB.airport, p2pB.city, 1_000, { vehicle_group_id: m.ids.eco4, included_km: 30 }) })), [400, [["/over_km_per_km", "REQUIRED"]]]);
  assert.deepEqual(issues(await tenantCall(m.b, "POST", `/products/${p2pB.id}/price-rules`, { version: v, body: line(p2pB.airport, p2pB.city, 1_000, { vehicle_group_id: m.ids.eco4, included_km: 0, over_km_per_km: -1 }) })), [400, [["/included_km", "OUT_OF_RANGE"], ["/over_km_per_km", "OUT_OF_RANGE"]]]);
  // 里程 + 时长不填含公里数（over_km_per_km 在里程 + 时长里不适用）
  const mileage = await tenantCall(m.b, "POST", `/products/${p2pB.id}/price-rules`, { version: v, body: { area_id: p2pB.airport, to_area_id: p2pB.city, vehicle_group_id: m.ids.eco4, pricing_model: "mileage_time", start_price: 1, start_meters: 0, start_minutes: 0, per_km: 1, per_minute: 1, included_km: 30, valid_from: "2026-01-01" } });
  assert.deepEqual(issues(mileage), [400, [["/included_km", "NOT_APPLICABLE"]]]);
  // 接送机（乙的成田接送机商品）：下车区域、含公里数都不能填
  const transfer = await tenantCall(m.b, "POST", `/products/${m.ids.pb}/price-rules`, { version: await version(m.b, m.ids.pb), body: { ...line(p2pB.city, p2pB.airport, 1_000, KM), direction: "both" } });
  assert.equal(transfer.status, 400, transfer.text);
  const notApplicable = transfer.body.error.details.issues.filter((issue: any) => issue.reason === "NOT_APPLICABLE").map((issue: any) => issue.path);
  assert.deepEqual(notApplicable.sort(), ["/included_km", "/over_km_per_km", "/to_area_id"]);
});

test("规则 2：甲读不到、改不了乙的线路价（价格规则、批量、修改、删除、按线路的价格日历、导出、导入预览都是 404），也不能用乙的区域当自己的下车区域", async () => {
  const rule = (await ok(tenantCall(m.b, "GET", `/products/${p2pB.id}/price-rules`))).items.find((item: any) => item.to_area_id === p2pB.airport && item.vehicle_group_id === m.ids.biz7);
  const tokenA = await tenantLogin(api, m.a.adminEmail);
  const v = await version(m.b, p2pB.id);
  const attempts: [HttpMethod, string, unknown][] = [
    ["GET", `/products/${p2pB.id}/price-rules`, undefined],
    ["POST", `/products/${p2pB.id}/price-rules`, line(p2pB.city, p2pB.airport, 1, { valid_from: "2030-01-01", vehicle_group_id: m.ids.eco4 })],
    ["POST", `/products/${p2pB.id}/price-rules/batch`, { create: [line(p2pB.city, p2pB.airport, 1, { vehicle_group_id: m.ids.eco4, valid_from: "2030-01-01" }), line(p2pB.airport, p2pB.city, 1, { vehicle_group_id: m.ids.eco4, valid_from: "2030-01-01" })] }],
    ["PUT", `/products/${p2pB.id}/price-rules/${rule.id}`, line(p2pB.city, p2pB.airport, 1)],
    ["DELETE", `/products/${p2pB.id}/price-rules/${rule.id}`, undefined],
    ["GET", `/products/${p2pB.id}/price-calendar?area_id=${p2pB.city}&to_area_id=${p2pB.airport}&vehicle_group_id=${m.ids.biz7}&from=2026-10-20&to=2026-10-21`, undefined],
  ];
  for (const [method, path, body] of attempts) {
    const res = await tenantCall(tokenA, method, path, { version: v, ...(body === undefined ? {} : { body }) });
    assert.equal(res.status, 404, `${method} ${path}：${res.text}`);
  }
  const exported = await api.app.inject({ method: "GET", url: `/tenant/v1/products/${p2pB.id}/price-rules/export`, headers: { authorization: `Bearer ${tokenA}` } });
  assert.equal(exported.statusCode, 404);
  const preview = await api.app.inject({ method: "POST", url: `/tenant/v1/products/${p2pB.id}/price-rules/import/preview`, payload: writeXlsx([{ name: "价格", rows: [["区域"]] }]), headers: { "content-type": XLSX_CONTENT_TYPE, authorization: `Bearer ${tokenA}` } });
  assert.equal(preview.statusCode, 404);
  // 甲用乙的区域当下车区域：404，和不存在的区域一样；甲的价格一条没多
  const borrowed = await tenantCall(tokenA, "POST", `/products/${p2pA.id}/price-rules`, { version: await version(m.a, p2pA.id), body: line(p2pA.area, p2pB.airport, 1) });
  assert.equal(borrowed.status, 404, borrowed.text);
  const borrowedCalendar = await tenantCall(tokenA, "GET", `/products/${p2pA.id}/price-calendar?area_id=${p2pA.area}&to_area_id=${p2pB.airport}&vehicle_group_id=${m.ids.biz7}&from=2026-10-20&to=2026-10-20`);
  assert.deepEqual(borrowedCalendar.body.days.map((day: any) => [day.route_rule, day.segments[0].final]), [[false, 9_000]], "乙的区域在甲这里没有线路价，只看到甲自己的区域价");
  const unchanged = await ok(tenantCall(m.b, "GET", `/products/${p2pB.id}/price-rules`));
  assert.deepEqual(unchanged.items.find((item: any) => item.id === rule.id), rule, "乙的线路价没被动过");
  assert.equal((await api.db.owner.query<{ n: number }>("select count(*)::int as n from price_rules where product_id = $1", [p2pA.id])).rows[0]?.n, 2);
});

test("价格日历按线路：给下车区域时有线路价用线路价（含公里数的按不超出算），这个车型组没有线路价退回区域价；不给是区域价；同一区域、非点对点 400", async () => {
  const path = (from: string, to: string | null, group: string) => `/products/${p2pB.id}/price-calendar?area_id=${from}${to === null ? "" : `&to_area_id=${to}`}&vehicle_group_id=${group}&from=2026-10-20&to=2026-10-21`;
  const go = await tenantCall(m.b, "GET", path(p2pB.city, p2pB.airport, m.ids.biz7));
  assertMatchesOpenApi("GET", "/tenant/v1/products/{id}/price-calendar", go);
  assert.deepEqual(go.body.days.map((day: any) => [day.date, day.route_rule, day.price_rule.to_area_id, day.segments[0].final]), [["2026-10-20", true, p2pB.airport, 18_000], ["2026-10-21", true, p2pB.airport, 18_000]]);
  // eco4 的去程线路价 1 月底就过期了：退回市区的区域价
  const eco = await tenantCall(m.b, "GET", path(p2pB.city, p2pB.airport, m.ids.eco4));
  assert.deepEqual(eco.body.days.map((day: any) => [day.route_rule, day.price_rule.to_area_id, day.segments[0].final]), [[false, null, 10_000], [false, null, 10_000]]);
  const area = await tenantCall(m.b, "GET", path(p2pB.city, null, m.ids.biz7));
  assert.deepEqual(area.body.days.map((day: any) => [day.route_rule, day.price_rule.to_area_id, day.segments[0].final]), [[null, null, 10_000], [null, null, 10_000]]);
  const same = await tenantCall(m.b, "GET", path(p2pB.city, p2pB.city, m.ids.biz7));
  assert.deepEqual([same.status, same.body.error.details.issues.map((issue: any) => issue.reason)], [400, ["SAME_AREA"]]);
  const transfer = await tenantCall(m.b, "GET", `/products/${m.ids.pb}/price-calendar?area_id=${p2pB.city}&to_area_id=${p2pB.airport}&vehicle_group_id=${m.ids.biz7}&direction=pickup&from=2026-10-20&to=2026-10-20`);
  assert.deepEqual([transfer.status, transfer.body.error.details.issues.map((issue: any) => [issue.path, issue.reason])], [400, [["/to_area_id", "NOT_APPLICABLE"]]]);
  for (const key of RULE4_KEYS) assert.ok(!allKeys(go.body).has(key), key);
});

test("导入导出：导出带「下车区域」「含公里数」「超出每公里」三列；导入线路价和含公里数；只填了一个含公里数报到空着的那一格；旧模版照样导入", async () => {
  const token = await tenantLogin(api, m.b.adminEmail);
  const exported = await api.app.inject({ method: "GET", url: `/tenant/v1/products/${p2pB.id}/price-rules/export`, headers: { authorization: `Bearer ${token}` } });
  assert.equal(exported.statusCode, 200);
  const rows = readXlsx(exported.rawPayload).map((cells) => cells.map((cell) => (cell.type === "text" || cell.type === "number" ? cell.text : null)));
  const header = rows[0] as string[];
  assert.deepEqual(header, ["价格编号", "区域", "下车区域", "车型组", "计价方式", "基础价", "含公里数", "超出每公里", "起步价", "起步里程(公里)", "起步时长(分钟)", "每公里单价", "每分钟单价", "最低消费", "生效开始", "生效结束", "状态"]);
  const exportedLines = rows.slice(1).filter((row) => row[2] !== null).map((row) => [row[1], row[2], row[3], row[5], row[6], row[7]]);
  assert.deepEqual(exportedLines.sort((a, b) => Number(a[3]) - Number(b[3])), [
    ["市区", "机场周边", "VG-ECO-4", "12000", null, null],
    ["机场周边", "市区", "VG-BIZ-7", "17000", "30", "300"],
    ["市区", "机场周边", "VG-BIZ-7", "18000", "30", "300"],
  ]);

  const upload = async (file: Buffer, path: string, extra: Record<string, string> = {}): Promise<ApiResponse> => {
    api.clock.advance(1_000);
    const res = await api.app.inject({ method: "POST", url: `/tenant/v1/products/${p2pB.id}${path}`, payload: file, headers: { "content-type": XLSX_CONTENT_TYPE, authorization: `Bearer ${token}`, ...extra } });
    return { status: res.statusCode, headers: res.headers, text: res.body, body: res.json() };
  };
  const num = (value: number): XlsxWriteCell => ({ number: String(value) });
  const row = (cells: Record<string, XlsxWriteCell>): XlsxWriteCell[] => header.map((column) => cells[column] ?? null);
  const file = writeXlsx([
    {
      name: "价格",
      rows: [
        header,
        row({ 区域: "机场周边", 下车区域: "市区", 车型组: "VG-ECO-4", 计价方式: "固定一口价", 基础价: num(11_000), 含公里数: num(40), 超出每公里: num(0), 生效开始: "2026-01-01" }),
        row({ 区域: "机场周边", 下车区域: "市区", 车型组: "VG-ECO-4", 计价方式: "固定一口价", 基础价: num(11_000), 含公里数: num(40), 生效开始: "2027-01-01" }),
        row({ 区域: "市区", 下车区域: "市区", 车型组: "VG-ECO-4", 计价方式: "固定一口价", 基础价: num(1), 生效开始: "2026-01-01" }),
        row({ 区域: "市区", 下车区域: "港口", 车型组: "VG-ECO-4", 计价方式: "固定一口价", 基础价: num(1), 生效开始: "2026-01-01" }),
      ],
    },
  ]);
  const seen = await upload(file, "/price-rules/import/preview");
  assertMatchesOpenApi("POST", "/tenant/v1/products/{id}/price-rules/import/preview", seen);
  assert.equal(seen.status, 200, seen.text);
  assert.deepEqual(
    seen.body.rows.map((entry: any) => [entry.action, entry.content.to_area, entry.content.included_km, entry.content.over_km_per_km, entry.issues.map((issue: any) => [issue.column, issue.reason])]),
    [
      ["create", "市区", 40, 0, []],
      ["error", "市区", 40, null, [["超出每公里", "REQUIRED"]]],
      ["error", "市区", null, null, [["下车区域", "SAME_AREA"]]],
      ["error", "港口", null, null, [["下车区域", "AREA_NOT_IN_PRODUCT"]]],
    ],
  );
  const clean = writeXlsx([{ name: "价格", rows: [header, row({ 区域: "机场周边", 下车区域: "市区", 车型组: "VG-ECO-4", 计价方式: "固定一口价", 基础价: num(11_000), 含公里数: num(40), 超出每公里: num(0), 生效开始: "2026-01-01" })] }]);
  const checked = await upload(clean, "/price-rules/import/preview");
  assert.equal(checked.body.can_import, true, checked.text);
  const imported = await upload(clean, `/price-rules/import?file_sha256=${checked.body.file_sha256}`, { "if-match": `"${checked.body.version}"`, "idempotency-key": randomUUID() });
  assert.equal(imported.status, 200, imported.text);
  const after = await ok(tenantCall(m.b, "GET", `/products/${p2pB.id}/price-rules`));
  assert.deepEqual(
    after.items.filter((item: any) => item.area_id === p2pB.airport && item.to_area_id === p2pB.city && item.vehicle_group_id === m.ids.eco4).map((item: any) => [item.base_price, item.included_km, item.over_km_per_km]),
    [[11_000, 40, 0]],
  );
  // 再导一次导出的文件（全部原样）：没有变化
  const again = await upload(Buffer.from(exported.rawPayload), "/price-rules/import/preview");
  assert.deepEqual(again.body.rows.map((entry: any) => entry.action).filter((action: string) => action !== "unchanged"), [], again.text);

  // 旧模版（没有这三列）：照样能导入，按区域价
  const oldHeader = ["价格编号", "区域", "车型组", "计价方式", "基础价", "起步价", "起步里程(公里)", "起步时长(分钟)", "每公里单价", "每分钟单价", "最低消费", "生效开始", "生效结束", "状态"];
  const old = writeXlsx([{ name: "价格", rows: [oldHeader, [null, "市区", "VG-ECO-4", "固定一口价", num(9_500), null, null, null, null, null, null, "2030-01-01", null, null]] }]);
  const oldSeen = await upload(old, "/price-rules/import/preview");
  assertMatchesOpenApi("POST", "/tenant/v1/products/{id}/price-rules/import/preview", oldSeen);
  // 读成区域价：只和市区 eco4 的区域价撞（不和市区出发的线路价撞）
  assert.deepEqual(
    [oldSeen.status, oldSeen.body.rows[0].action, oldSeen.body.rows[0].content.to_area, oldSeen.body.rows[0].content.included_km, oldSeen.body.rows[0].issues, oldSeen.body.rows[0].conflicts_with.map((other: any) => [other.area, other.to_area, other.vehicle_group])],
    [200, "conflict", null, null, [], [["市区", null, "VG-ECO-4"]]],
    oldSeen.text,
  );
  // 旧模版改一条已有的区域价（带价格编号）：照样能导入
  const cityEco = after.items.find((item: any) => item.area_id === p2pB.city && item.to_area_id === null && item.vehicle_group_id === m.ids.eco4);
  const oldUpdate = writeXlsx([{ name: "价格", rows: [oldHeader, [cityEco.id, "市区", "VG-ECO-4", "固定一口价", num(10_000), null, null, null, null, null, null, "2026-01-01", "2030-12-31", null]] }]);
  const oldUpdateSeen = await upload(oldUpdate, "/price-rules/import/preview");
  assert.deepEqual([oldUpdateSeen.body.can_import, oldUpdateSeen.body.rows[0].action], [true, "update"], oldUpdateSeen.text);
});

test("供应商试算：线路价优先（比区域价贵也用）、单向；返程用返程价；含公里数按路线距离向上取整算进一口价，明细带下车区域和距离；拿不到路线时这条不报", async () => {
  const preview = async (pickup: keyof typeof P, dropoff: keyof typeof P, assume: RouteEstimate | null): Promise<ApiResponse> => {
    const res = await tenantCall(m.b, "POST", `/products/${p2pB.id}/quote-preview`, { body: { pickup: P[pickup], dropoff: P[dropoff], service_time: SERVICE_LOCAL, passengers: 2, luggage: 1, vehicle_group_ids: [m.ids.biz7], ...(assume === null ? {} : { assume_route: assume }) } });
    assertMatchesOpenApi("POST", "/tenant/v1/products/{id}/quote-preview", res);
    assert.equal(res.status, 200, res.text);
    return res;
  };
  const go = await preview("city", "airport", { meters: 34_200, minutes: 50 });
  const offer = go.body.offers[0];
  // 18,000 + ⌈(34.2 − 30)⌉ = 5 公里 × 300
  assert.deepEqual([offer.area_id, offer.settlement.total, offer.settlement.base, offer.settlement.to_area_id, offer.settlement.distance], [p2pB.city, 19_500, 19_500, p2pB.airport, { included_km: 30, route_meters: 34_200, over_km: 5, over_km_per_km: 300 }]);
  const back = await preview("airport", "city", { meters: 30_000, minutes: 45 });
  assert.deepEqual([back.body.offers[0].settlement.total, back.body.offers[0].settlement.distance.over_km], [17_000, 0]);
  // 同一区域里：区域价，没有这两项
  const inside = await preview("city", "city2", { meters: 9_000, minutes: 20 });
  assert.deepEqual([inside.body.offers[0].settlement.total, inside.body.offers[0].settlement.to_area_id, inside.body.offers[0].settlement.distance], [10_000, null, null]);
  for (const key of RULE4_KEYS) assert.ok(!allKeys(go.body).has(key), key);
  // 拿不到路线：设了含公里数的线路价不报（不退回区域价）
  route = null;
  try {
    const none = await preview("city", "airport", null);
    assert.deepEqual([none.body.offers.length, none.body.refused.map((entry: any) => entry.reason)], [0, ["ROUTE_UNAVAILABLE"]]);
  } finally {
    route = { meters: 34_200, minutes: 50 };
  }
});

test("官网：报价含公里数（只有对外价）；下单后订单锁定距离——供应商详情只有结算价，运营另有对外价参考；甲读不到；已下的订单（没有这些字段）照旧", async () => {
  api.clock.advance(1_000);
  const quoted = await site.call("POST", "/site/v1/quotes", { body: { category: "point_to_point", city_id: m.ids.tokyo, pickup: P.city, dropoff: P.airport, service_local: SERVICE_LOCAL, passengers: 2, luggage: 1 }, ip: nextIp() });
  assertMatchesOpenApi("POST", "/site/v1/quotes", quoted);
  assert.equal(quoted.status, 200, quoted.text);
  assert.equal(quoted.body.quotes.length, 2, quoted.text);
  const biz = quoted.body.quotes.find((entry: any) => entry.vehicle_group.id === m.ids.biz7);
  // 对外价 = 结算价 × 1.1（渠道默认加价 10%）：19,500 → 21,450；每公里 300 → 330
  assert.deepEqual([biz.price.total.amount, biz.distance], ["21450", { included_km: 30, route_meters: 34_200, over_km: 5, over_km_per_km: { amount: "330", currency: "JPY" } }]);
  const eco = quoted.body.quotes.find((entry: any) => entry.vehicle_group.id === m.ids.eco4);
  assert.deepEqual([eco.price.total.amount, eco.distance], ["8800", null], "eco4 的线路价过期了：区域价（两端区域取最低 8,000），没有含公里数");
  for (const key of ["settlement", "to_area_id", "markup_bp", "over_km_per_km_sell"]) assert.ok(!allKeys(quoted.body).has(key), key);
  assert.doesNotMatch(quoted.text.replace(/[0-9a-f-]{36}|QT\d{8}[0-9A-Z]+/gi, ""), /19500|"300"|乙车队/);

  const created = await site.call("POST", "/site/v1/orders", { headers: { "idempotency-key": randomUUID() }, body: { quote_id: biz.quote_id, passenger: PASSENGER, save_payment_method: true, pickup_address: "市区酒店", dropoff_address: "机场" }, ip: nextIp() });
  assert.equal(created.status, 201, created.text);
  const orderId = created.body.order.id as string;
  const intent = pay.intentOf(orderId);
  assert.ok(intent);
  pay.pay(intent.id);
  const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
  assert.equal((await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()))).status, 200);

  // 路线后来变了：订单上锁定的距离不变
  route = { meters: 99_000, minutes: 120 };
  try {
    const tenant = await tenantCall(m.b, "GET", `/orders/${orderId}`);
    assertMatchesOpenApi("GET", "/tenant/v1/orders/{id}", tenant);
    assert.equal(tenant.status, 200, tenant.text);
    const settlement = tenant.body.order.settlement;
    assert.deepEqual([settlement.total.amount, settlement.base.amount, settlement.to_area_id, settlement.distance], ["19500", "19500", p2pB.airport, { included_km: 30, route_meters: 34_200, over_km: 5, over_km_per_km: { amount: "300", currency: "JPY" } }]);
    for (const key of RULE4_KEYS) assert.ok(!allKeys(tenant.body).has(key), `供应商订单详情里有 ${key}`);
    assert.doesNotMatch(tenant.text.replace(/[0-9a-f-]{36}|NZ\d{8}[0-9A-Z]+/gi, ""), /21450|"330"/);
    const listed = await tenantCall(m.b, "GET", "/orders");
    for (const key of RULE4_KEYS) assert.ok(!allKeys(listed.body).has(key), `供应商订单列表里有 ${key}`);

    const platform = await api.call("GET", `/platform/v1/orders/${orderId}`, { token: m.root });
    assertMatchesOperation("GET", "/platform/v1/orders/{id}", platform.status, platform.body);
    assert.deepEqual(platform.body.distance, { included_km: 30, route_meters: 34_200, over_km: 5, over_km_per_km: { amount: "300", currency: "JPY" }, over_km_per_km_sell: { amount: "330", currency: "JPY" } });
    assert.equal(platform.body.order.settlement.to_area_id, p2pB.airport);
    // M8-13：用的价格（线路价 · 市区 → 机场周边），供应商、运营一样，没有金额
    const routeUsed = { kind: "route", area: { id: p2pB.city, name: { zh: "市区" } }, to_area: { id: p2pB.airport, name: { zh: "机场周边" } } };
    assert.deepEqual(tenant.body.pricing_route, routeUsed);
    assert.deepEqual(platform.body.pricing_route, routeUsed);
    // M8-13：官网订单页带订单上锁定的含公里数（只有对外价，和报价时同一个数）；没有区域加价
    const guest = await site.call("GET", "/site/v1/order", { token: created.body.link.token, ip: nextIp() });
    assertMatchesOpenApi("GET", "/site/v1/order", guest);
    assert.equal(guest.status, 200, guest.text);
    assert.deepEqual([guest.body.order.distance, guest.body.order.includes_area_surcharge], [{ included_km: 30, route_meters: 34_200, over_km: 5, over_km_per_km: { amount: "330", currency: "JPY" } }, false]);
    for (const key of ["settlement", "to_area_id", "pricing_route", "over_km_per_km_sell", "markup_bp"]) assert.ok(!allKeys(guest.body).has(key), `官网订单里有 ${key}`);
    assert.doesNotMatch(guest.text.replace(/[0-9a-f-]{36}|NZ\d{8}[0-9A-Z]+/gi, ""), /19500|"300"|"市区"|机场周边/);
  } finally {
    route = { meters: 34_200, minutes: 50 };
  }

  assert.equal((await tenantCall(m.a, "GET", `/orders/${orderId}`)).status, 404, "甲读不到乙的单");
  // M8-11 之前下的单（结算价明细里没有这两项）：显示照旧，这两项为 null
  await api.db.owner.query("update orders set settlement = settlement - 'toAreaId' - 'distance' where id = $1", [orderId]);
  const legacy = await tenantCall(m.b, "GET", `/orders/${orderId}`);
  assertMatchesOpenApi("GET", "/tenant/v1/orders/{id}", legacy);
  assert.deepEqual([legacy.body.order.settlement.to_area_id, legacy.body.order.settlement.distance, legacy.body.order.settlement.total.amount], [null, null, "19500"]);
  const legacyPlatform = await api.call("GET", `/platform/v1/orders/${orderId}`, { token: m.root });
  assertMatchesOperation("GET", "/platform/v1/orders/{id}", legacyPlatform.status, legacyPlatform.body);
  assert.equal(legacyPlatform.body.distance, null);
  assert.deepEqual([legacy.body.pricing_route, legacyPlatform.body.pricing_route], [null, null], "旧单没有「用的价格」");
  const legacyGuest = await site.call("GET", "/site/v1/order", { token: created.body.link.token, ip: nextIp() });
  assertMatchesOpenApi("GET", "/site/v1/order", legacyGuest);
  assert.deepEqual([legacyGuest.body.order.distance, legacyGuest.body.order.includes_area_surcharge], [null, false]);
});

test("用的价格（M8-13）：区域价 + 含公里数写「区域价」；订单上的线路和下单时的报价对不上（改期后命中了别的）时不猜上车区域；区域被删了名称为 null", async () => {
  api.clock.advance(1_000);
  const quoted = await site.call("POST", "/site/v1/quotes", { body: { category: "point_to_point", city_id: m.ids.tokyo, pickup: P.city, dropoff: P.airport, service_local: SERVICE_LOCAL, passengers: 2, luggage: 1 }, ip: nextIp() });
  const biz = quoted.body.quotes.find((entry: any) => entry.vehicle_group.id === m.ids.biz7);
  const created = await site.call("POST", "/site/v1/orders", { headers: { "idempotency-key": randomUUID() }, body: { quote_id: biz.quote_id, passenger: PASSENGER, save_payment_method: true, pickup_address: "市区酒店", dropoff_address: "机场" }, ip: nextIp() });
  assert.equal(created.status, 201, created.text);
  const orderId = created.body.order.id as string;
  const intent = pay.intentOf(orderId);
  assert.ok(intent);
  pay.pay(intent.id);
  const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
  assert.equal((await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()))).status, 200);
  // 报价快照和订单都改成「区域价（市区）+ 含公里数」：用的价格是区域价
  await api.db.owner.query("update orders set settlement = settlement - 'toAreaId' where id = $1", [orderId]);
  await api.db.owner.query("update quotes set snapshot = jsonb_set(snapshot, '{winner,offer,settlement}', (snapshot #> '{winner,offer,settlement}') - 'toAreaId') where id = $1", [biz.quote_id]);
  const area = await tenantCall(m.b, "GET", `/orders/${orderId}`);
  assertMatchesOpenApi("GET", "/tenant/v1/orders/{id}", area);
  assert.deepEqual(area.body.pricing_route, { kind: "area", area: { id: p2pB.city, name: { zh: "市区" } }, to_area: null });
  // 订单上是线路价、快照里不是：不知道上车区域
  await api.db.owner.query("update orders set settlement = settlement || jsonb_build_object('toAreaId', $2::text) where id = $1", [orderId, p2pB.airport]);
  const mismatch = await api.call("GET", `/platform/v1/orders/${orderId}`, { token: m.root });
  assertMatchesOperation("GET", "/platform/v1/orders/{id}", mismatch.status, mismatch.body);
  assert.deepEqual(mismatch.body.pricing_route, { kind: "route", area: null, to_area: { id: p2pB.airport, name: { zh: "机场周边" } } });
  // 区域名称取现在的；查不到（被删了）为 null
  await api.db.owner.query("update orders set settlement = settlement || jsonb_build_object('toAreaId', $2::text) where id = $1", [orderId, randomUUID()]);
  const gone = await tenantCall(m.b, "GET", `/orders/${orderId}`);
  assert.equal(gone.body.pricing_route.to_area.name, null);
  assert.equal((await tenantCall(m.a, "GET", `/orders/${orderId}`)).status, 404, "甲读不到乙的单");
});

test("改期：含公里数的单按下单时锁定的路线距离重算（路线后来变了也不变），改期后订单上的距离照旧", async () => {
  api.clock.advance(1_000);
  const quoted = await site.call("POST", "/site/v1/quotes", { body: { category: "point_to_point", city_id: m.ids.tokyo, pickup: P.city, dropoff: P.airport, service_local: SERVICE_LOCAL, passengers: 2, luggage: 1 }, ip: nextIp() });
  const biz = quoted.body.quotes.find((entry: any) => entry.vehicle_group.id === m.ids.biz7);
  const created = await site.call("POST", "/site/v1/orders", { headers: { "idempotency-key": randomUUID() }, body: { quote_id: biz.quote_id, passenger: PASSENGER, save_payment_method: true, pickup_address: "市区酒店", dropoff_address: "机场" }, ip: nextIp() });
  assert.equal(created.status, 201, created.text);
  const orderId = created.body.order.id as string;
  const intent = pay.intentOf(orderId);
  assert.ok(intent);
  pay.pay(intent.id);
  const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
  assert.equal((await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()))).status, 200);
  route = { meters: 99_000, minutes: 120 };
  try {
    const token = created.body.link.token as string;
    const view = await site.call("GET", "/site/v1/order", { token, ip: nextIp() });
    const moved = await site.call("PATCH", "/site/v1/order", { token, ip: nextIp(), headers: { "if-match": `"${view.body.order.version}"` }, body: { service_time: "2026-10-21T10:00:00+09:00" } });
    assert.equal(moved.status, 200, moved.text);
  } finally {
    route = { meters: 34_200, minutes: 50 };
  }
  const change = await api.db.owner.query<{ before: string; after: string }>("select settlement_before_minor::text as before, settlement_after_minor::text as after from order_changes where order_id = $1", [orderId]);
  assert.deepEqual(change.rows.map((row) => [row.before, row.after]), [["19500", "19500"]]);
  const tenant = await ok(tenantCall(m.b, "GET", `/orders/${orderId}`));
  assert.deepEqual([tenant.order.settlement.distance.route_meters, tenant.order.settlement.distance.over_km, tenant.order.settlement.to_area_id], [34_200, 5, p2pB.airport]);
});

test("渠道接口：报价多一项含公里数（只有对外价，只加字段不改已有字段）；没设含公里数的为 null", async () => {
  const all = await newChannel(api, m.staff.cm1.token, { name: "渠道-点对点" });
  const creds = await salesCredentials(api, m, all.id, "198.51.100.21");
  api.clock.advance(1_000);
  const res = await api.call("POST", "/sales/v1/quotes", { token: creds.token, body: { city_id: m.ids.tokyo, category: "point_to_point", pickup: P.airport, dropoff: P.city, service_time: "2026-10-20T10:00:00+09:00", passengers: 2, luggage: 1, currency: "JPY" } });
  assertMatchesOperation("POST", "/sales/v1/quotes", res.status, res.body);
  assert.equal(res.status, 200, res.text);
  const byGroup = new Map(res.body.quotes.map((quote: any) => [quote.vehicle_group_id, quote]));
  const biz: any = byGroup.get(m.ids.biz7);
  // 返程 17,000 + 5 × 300 = 18,500 → ×1.1 = 20,350
  assert.deepEqual([biz.price.total.amount, biz.distance], ["20350", { included_km: 30, route_meters: 34_200, over_km: 5, over_km_per_km: { amount: "330", currency: "JPY" } }]);
  const eco: any = byGroup.get(m.ids.eco4);
  // eco4 的返程线路价（导入的）含 40 公里、超出不另收：11,000 → 12,100
  assert.deepEqual([eco.price.total.amount, eco.distance], ["12100", { included_km: 40, route_meters: 34_200, over_km: 0, over_km_per_km: { amount: "0", currency: "JPY" } }]);
  for (const key of ["settlement", "to_area_id", "markup_bp"]) assert.ok(!allKeys(res.body).has(key), key);
});

test("附加服务和命中的线路价、含公里数一起算：附加服务按商品统一定价（和用区域价时一样），结算价 = 线路一口价 + 超出公里 × 单价 + 附加服务，对外价按现有公式；供应商只看到结算价", async () => {
  // 附加服务（平台目录）：儿童座椅按个（每个 1,000）、举牌按次（500），乙的点对点商品统一提供
  const catalog = (body: Record<string, unknown>): Promise<any> => ok(api.call("POST", "/platform/v1/master/addons", { token: m.root, body }), 201);
  const seat = (await catalog({ code: "ADD-P2P_SEAT", categories: ["point_to_point"], charge_unit: "per_item", name: { zh: "儿童座椅" } })).id as string;
  const board = (await catalog({ code: "ADD-P2P_BOARD", categories: ["point_to_point"], charge_unit: "per_order", name: { zh: "举牌" } })).id as string;
  await ok(
    tenantCall(m.b, "PUT", `/products/${p2pB.id}/service-rules`, {
      version: await version(m.b, p2pB.id),
      body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { general: { mode: "limited", minutes: 15 } }, addons: [{ addon_id: seat, unit_price: 1_000 }, { addon_id: board, unit_price: 500 }] },
    }),
  );
  const addons = [{ addon_id: seat, quantity: 2 }, { addon_id: board, quantity: 1 }];
  // 官网、渠道询价用的商品目录缓存 30 秒（QUOTE_CATALOG_TTL_MS）：等它过期，询价才看到新的附加服务
  api.clock.advance(31_000);
  assert.deepEqual(route, { meters: 34_200, minutes: 50 }, "路线 34.2 公里，比含的 30 公里长");

  // 供应商试算：命中市区 → 机场周边的线路价（18,000，含 30 公里，超出每公里 300）
  const preview = async (pickup: keyof typeof P, dropoff: keyof typeof P): Promise<any> => {
    const res = await tenantCall(m.b, "POST", `/products/${p2pB.id}/quote-preview`, { body: { pickup: P[pickup], dropoff: P[dropoff], service_time: SERVICE_LOCAL, passengers: 2, luggage: 1, vehicle_group_ids: [m.ids.biz7], addons } });
    assertMatchesOpenApi("POST", "/tenant/v1/products/{id}/quote-preview", res);
    assert.equal(res.status, 200, res.text);
    for (const key of RULE4_KEYS) assert.ok(!allKeys(res.body).has(key), `供应商试算里有 ${key}`);
    return res.body.offers[0];
  };
  const line = await preview("city", "airport");
  const s = line.settlement;
  // 18,000 + ⌈(34.2 − 30)⌉ = 5 公里 × 300 = 19,500；附加服务 2 × 1,000 + 500 = 2,500；合计 22,000
  assert.deepEqual([line.price_rule_id !== null, s.to_area_id, s.distance], [true, p2pB.airport, { included_km: 30, route_meters: 34_200, over_km: 5, over_km_per_km: 300 }]);
  assert.deepEqual([s.base, s.adjust, s.urgent, s.night, s.addons, s.driver_language, s.total], [19_500, 0, 0, 0, 2_500, 0, 22_000]);
  assert.equal(s.base + s.adjust + s.urgent + s.night + s.addons + s.driver_language, s.total, "各项之和等于结算价");
  assert.deepEqual(s.addon_items.map((item: any) => [item.addon_id, item.charged_quantity, item.unit_price, item.amount]), [[seat, "2", 1_000, 2_000], [board, "1", 500, 500]]);
  // 同一商品用区域价（同一区域里）：附加服务的钱一模一样（按商品统一定价，ADR 0069 B15）
  const area = await preview("city", "city2");
  assert.deepEqual([area.settlement.to_area_id, area.settlement.distance, area.settlement.base, area.settlement.addons, area.settlement.total], [null, null, 10_000, 2_500, 12_500]);
  assert.deepEqual(area.settlement.addon_items, s.addon_items);

  // 官网：对外价 = 结算价 × 1.1（渠道默认加价 10%，四舍五入到 1 日元）= 24,200；超出每公里对外价 330
  api.clock.advance(1_000);
  const quoted = await site.call("POST", "/site/v1/quotes", { body: { category: "point_to_point", city_id: m.ids.tokyo, pickup: P.city, dropoff: P.airport, service_local: SERVICE_LOCAL, passengers: 2, luggage: 1, addons }, ip: nextIp() });
  assertMatchesOpenApi("POST", "/site/v1/quotes", quoted);
  assert.equal(quoted.status, 200, quoted.text);
  const biz = quoted.body.quotes.find((entry: any) => entry.vehicle_group.id === m.ids.biz7);
  assert.ok(biz, quoted.text);
  assert.deepEqual([biz.price.total.amount, biz.distance, biz.available_addons.map((addon: any) => addon.id).sort()], ["24200", { included_km: 30, route_meters: 34_200, over_km: 5, over_km_per_km: { amount: "330", currency: "JPY" } }, [seat, board].sort()]);
  for (const key of ["settlement", "to_area_id", "unit_price", "markup_bp"]) assert.ok(!allKeys(quoted.body).has(key), key);
  const stored = (await api.db.owner.query("select settlement_minor::int as settlement, sell_minor::int as sell, snapshot->'winner'->'offer'->'settlement'->'addonsMinor' as addons, snapshot->'winner'->'sell'->'overKmPerKmMinor' as per_km from quotes where id = $1", [biz.quote_id])).rows[0];
  assert.deepEqual([stored.settlement, stored.sell, stored.addons, stored.per_km], [22_000, 24_200, 2_500, 330], "快照里锁定的结算价、对外价、附加服务和每公里对外价");

  // 渠道接口同样（带附加服务询价）
  const channel = await newChannel(api, m.staff.cm1.token, { name: "渠道-附加服务" });
  const creds = await salesCredentials(api, m, channel.id, "198.51.100.31");
  api.clock.advance(1_000);
  const sales = await api.call("POST", "/sales/v1/quotes", { token: creds.token, body: { city_id: m.ids.tokyo, category: "point_to_point", pickup: P.city, dropoff: P.airport, service_time: "2026-10-20T10:00:00+09:00", passengers: 2, luggage: 1, currency: "JPY", addons, vehicle_group_ids: [m.ids.biz7] } });
  assertMatchesOperation("POST", "/sales/v1/quotes", sales.status, sales.body);
  assert.equal(sales.status, 200, sales.text);
  assert.equal(sales.body.quotes.length, 1, sales.text);
  assert.deepEqual([sales.body.quotes[0].price.total.amount, sales.body.quotes[0].distance.over_km, sales.body.quotes[0].distance.over_km_per_km.amount], ["24200", 5, "330"]);
  for (const key of ["settlement", "to_area_id", "unit_price", "markup_bp"]) assert.ok(!allKeys(sales.body).has(key), key);
});

test("调价规则的检查连同线路价：调完会让一条线路价不大于 0 时不能保存（区域价都没问题也一样）", async () => {
  const cheap = await ok(tenantCall(m.b, "POST", `/products/${p2pB.id}/price-rules`, { version: await version(m.b, p2pB.id), body: line(p2pB.city, p2pB.airport, 100, { vehicle_group_id: m.ids.eco4, valid_from: "2031-01-01" }) }), 201);
  const res = await tenantCall(m.b, "POST", `/products/${p2pB.id}/adjust-rules`, { version: await version(m.b, p2pB.id), body: { name: "市区减 200", cycle: { type: "daily" }, area_ids: [p2pB.city], steps: [{ type: "amount", value: -200 }] } });
  assertMatchesOpenApi("POST", "/tenant/v1/products/{id}/adjust-rules", res);
  assert.deepEqual([res.status, res.body.error.details.issues.map((issue: any) => [issue.reason, issue.detail?.count])], [400, [["ADJUST_RESULT_NOT_POSITIVE", 1]]], res.text);
  await ok(tenantCall(m.b, "DELETE", `/products/${p2pB.id}/price-rules/${cheap.price_rule.id}`, { version: await version(m.b, p2pB.id) }));
  const saved = await tenantCall(m.b, "POST", `/products/${p2pB.id}/adjust-rules`, { version: await version(m.b, p2pB.id), body: { name: "市区减 200", cycle: { type: "daily" }, area_ids: [p2pB.city], steps: [{ type: "amount", value: -200 }], status: "disabled" } });
  assert.equal(saved.status, 201, saved.text);
});

test("删除区域：线路价跟着删（下车区域是它的也删），各记一条日志", async () => {
  const product = await p2pProduct(m.b, m.ids.tokyo, [p2pB.port, p2pB.city], [5_000, 6_000]);
  const v = await version(m.b, product);
  await ok(tenantCall(m.b, "POST", `/products/${product}/price-rules`, { version: v, body: line(p2pB.city, p2pB.port, 7_000) }), 201);
  // 下架、去掉港口之后港口才能删
  await ok(tenantCall(m.b, "POST", `/products/${product}/unpublish`));
  const count = async (): Promise<number> => (await api.db.owner.query<{ n: number }>("select count(*)::int as n from price_rules where product_id = $1 and (area_id = $2 or to_area_id = $2)", [product, p2pB.port])).rows[0]?.n ?? -1;
  assert.equal(await count(), 3);
  const removed = await tenantCall(m.b, "DELETE", `/areas/${p2pB.port}`);
  assert.equal(removed.status, 204, removed.text);
  assert.equal(await count(), 0);
  const logs = await api.db.owner.query<{ n: number }>("select count(*)::int as n from audit_logs where resource = 'price_rule' and action = 'delete' and before->>'to_area_id' = $1", [p2pB.port]);
  assert.equal(logs.rows[0]?.n, 1);
});
