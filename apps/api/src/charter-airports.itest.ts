/**
 * M9P-21（ADR 0098）经真实接口、真实 PostgreSQL：
 * - 迁移 0520：价格方式的检查约束包含 domain 的全部价格方式（后合并的迁移漏掉别的车道新加的价格方式时这里会红）；机场套餐价的形状约束；
 *   机场绑定表的租户隔离（行级安全）；绑定着的区域删不掉（数据库外键 restrict，接口翻成 409 AREA_IN_USE）；
 * - 机场绑定接口：只限迁移过三层区域的包车商品；机场和航站楼要在机场区域里；机场区域要被①∪③完全覆盖；机场区域可以是接送机类型；
 *   租户 A 读不到、改不了 B 的；保存后商品版本号加一；
 * - 机场套餐价：没有绑定 → AIRPORT_BINDING_REQUIRED；有绑定就能建（区域不在商品区域里也行）；解绑前要先删价格；
 * - 官网询价：成田航站楼上车 → 机场开始（继承照收上车加价；单独定价不列上车加价），机场区域外的酒店不是机场。
 * 测试数据全在本文件里经接口建出来（迁移三层区域的标志用迁移账号写，同 charter-three-layer.itest.ts），随测试 schema 一起删除（规则 1）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PRICING_MODELS, type LatLng, type RouteLookup } from "@nozomi/domain";
import { withTenantTx } from "./db/context.ts";
import { XLSX_CONTENT_TYPE, readXlsx, writeXlsx } from "./integrations/xlsx.ts";
import type { ApiResponse, HttpMethod, TenantFixture, TestApi } from "./testing/api.ts";
import { createTestApi } from "./testing/api.ts";
import { type Market, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let site: SiteApi;

const square = (west: number, south: number, east: number, north: number) => ({ type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] });
/** 成田机场（主数据 140.3887, 35.7686，见 testing/market.ts） */
const P = {
  shinjuku: { lng: 139.7, lat: 35.69 },
  naritaT1: { lng: 140.385, lat: 35.77 },
  naritaHotel: { lng: 140.3, lat: 35.8 },
} satisfies Record<string, LatLng>;
type Place = keyof typeof P;
let ipSeq = 0;
const nextIp = (): string => `10.98.${(ipSeq += 1)}.9`;
const routeLookup = async (): Promise<RouteLookup> => ({ ok: true, route: { meters: 70_000, minutes: 90 }, source: "google" });

async function tenantCall(who: TenantFixture, method: HttpMethod, path: string, options: { body?: unknown; version?: number } = {}): Promise<ApiResponse> {
  const token = await tenantLogin(api, who.adminEmail);
  api.clock.advance(1_000);
  return api.call(method, `/tenant/v1${path}`, {
    token,
    ...(options.body === undefined ? {} : { body: options.body }),
    headers: { ...(options.version === undefined ? {} : { "if-match": `"${options.version}"` }), ...(method === "POST" && /^\/(products|brands|areas)$|\/price-rules(\/batch)?$/.test(path) ? { "idempotency-key": randomUUID() } : {}) },
  });
}
const version = async (who: TenantFixture, productId: string): Promise<number> => (await ok(tenantCall(who, "GET", `/products/${productId}`))).version;
const batch = async (who: TenantFixture, productId: string, body: Record<string, unknown>): Promise<ApiResponse> =>
  tenantCall(who, "POST", `/products/${productId}/price-rules/batch`, { version: await version(who, productId), body: { create: [], update: [], delete: [], ...body } });
const putAirports = async (who: TenantFixture, productId: string, bindings: unknown[]): Promise<ApiResponse> => {
  const res = await tenantCall(who, "PUT", `/products/${productId}/charter-airports`, { version: await version(who, productId), body: { bindings } });
  if (res.status === 200) assertMatchesOpenApi("PUT", "/tenant/v1/products/{id}/charter-airports", res);
  return res;
};

interface Charter {
  id: string;
  tokyo: string;
  narita: string;
  /** 只画航站楼周边的机场区域（业务类型接送机） */
  airport: string;
  /** 伸出成田③的机场区域（覆盖不全） */
  wideAirport: string;
}
let charter: Charter;
let charterA: Charter;

const pkg = (areaId: string | null, hours: number, price: number) => ({ area_id: areaId, vehicle_group_id: m.ids.biz7, package_hours: hours, pricing_model: "charter_package", package_km: 300, package_price: price, overtime_per_hour: 6_000, over_km_per_km: 500, valid_from: "2026-01-01" });
const updown = (areaId: string, hours: number, pickup: number, dropoff: number) => ({ area_id: areaId, vehicle_group_id: m.ids.biz7, package_hours: hours, pricing_model: "charter_area_surcharge", pickup_surcharge: pickup, dropoff_surcharge: dropoff, valid_from: "2026-01-01" });
const airportPrice = (areaId: string, direction: "pickup" | "dropoff", hours: number, price: number) => ({ area_id: areaId, vehicle_group_id: m.ids.biz7, direction, package_hours: hours, pricing_model: "charter_airport_package", package_price: price, valid_from: "2026-01-01" });

/** 东京包车：①东京市内；③成田 14,000 / 14,000；5h 33,000。`migrate` 时用迁移账号设成三层区域并补整商品套餐价 */
async function newCharter(who: TenantFixture, migrate: boolean): Promise<Charter> {
  const area = async (name: string, polygon: ReturnType<typeof square>, bizType = "charter"): Promise<string> =>
    (await ok(tenantCall(who, "POST", "/areas", { body: { city_id: m.ids.tokyo, name: { zh: name }, biz_type: bizType, polygons: [{ kind: "operate", geometry: polygon }] } }), 201)).id;
  const tokyo = await area("东京市内", square(139.55, 35.5, 139.95, 35.85));
  const narita = await area("成田", square(140.2, 35.65, 140.5, 35.9));
  const airport = await area("成田机场（航站楼）", square(140.37, 35.75, 140.41, 35.79), "airport_transfer");
  const wideAirport = await area("成田机场（大）", square(140.37, 35.75, 140.6, 35.79), "general");
  const brand = (await ok(tenantCall(who, "POST", "/brands", { body: { name: `包车-${randomUUID().slice(0, 6)}`, currency: "JPY" } }), 201)).id;
  const created = await ok(tenantCall(who, "POST", "/products", { body: { brand_id: brand, city_id: m.ids.tokyo, category: "charter", areas: [{ area_id: tokyo }], vehicle_groups: [{ vehicle_group_id: m.ids.biz7, passengers: 6, luggage: 4 }], dispatchers: [{ name: "调度", phone: "0312345678" }] } }), 201);
  const rules = await ok(tenantCall(who, "PUT", `/products/${created.id}/service-rules`, { version: 1, body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { general: { mode: "limited", minutes: 0 } } } }));
  const content = await ok(tenantCall(who, "PUT", `/products/${created.id}/content`, { version: rules.version, body: { zh: { title: "东京包车" } } }));
  await ok(tenantCall(who, "POST", `/products/${created.id}/price-rules/batch`, { version: content.version, body: { create: [pkg(tokyo, 5, 33_000), updown(narita, 5, 14_000, 14_000)] } }));
  await ok(tenantCall(who, "POST", `/products/${created.id}/publish`));
  if (migrate) {
    await api.db.owner.query("update products set charter_layout = 'three_layer', version = version + 1 where id = $1", [created.id]);
    await ok(batch(who, created.id, { create: [pkg(null, 5, 33_000)] }));
  }
  return { id: created.id, tokyo, narita, airport, wideAirport };
}

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay, quote: { routes: { estimate: routeLookup } } });
  m = await buildMarket(api);
  charter = await newCharter(m.b, true);
  charterA = await newCharter(m.a, false);
  await ok(tenantCall(m.a, "POST", `/products/${charterA.id}/unpublish`));
  const root = m.root;
  // 成田的航站楼（主数据）：T1 在机场区域里
  await ok(api.call("POST", "/platform/v1/master/places", { token: root, body: { type: "terminal", code: "NRT-T1", parent_id: m.ids.narita, name: { zh: "第 1 航站楼" }, location: P.naritaT1 } }), 201);
  const channel = await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" });
  site = await siteApi(api, (await salesCredentials(api, m, channel.id)).clientId, pay, {}, { quote: { routes: { estimate: routeLookup } } });
  api.clock.advance(31_000);
});
after(async () => {
  await site?.close();
  await api.close();
});

async function quote(pickup: Place, dropoff: Place): Promise<any> {
  api.clock.advance(31_000);
  const res = await site.call("POST", "/site/v1/quotes", { body: { category: "charter", city_id: m.ids.tokyo, pickup: P[pickup], dropoff: P[dropoff], package_hours: 5, service_local: "2026-10-20T10:00", passengers: 2, luggage: 1 }, ip: nextIp() });
  assertMatchesOpenApi("POST", "/site/v1/quotes", res);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.quotes.length, 1, res.text);
  return res.body.quotes[0];
}
const kinds = (entry: any): string[] => entry.price_breakdown.map((item: any) => item.kind);

test("迁移 0520：价格方式的检查约束包含全部价格方式；机场套餐价要有区域和接机 / 送机方向、要有套餐时长", async () => {
  const def = (await api.db.owner.query("select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'price_rules_model_check' and conrelid = 'price_rules'::regclass")).rows[0].def as string;
  for (const model of PRICING_MODELS) assert.ok(def.includes(`'${model}'`), `${model} 不在 price_rules_model_check 里：${def}`);
  const insert = (direction: string | null, hours: number | null) =>
    api.db.owner.query(
      `insert into price_rules (tenant_id, product_id, area_id, vehicle_group_id, direction, package_hours, pricing_model, params, valid_from, status, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, 'charter_airport_package', '{"packagePriceMinor": 45000}', '2026-01-01', 'enabled', now(), now())`,
      [m.b.tenantId, charter.id, charter.airport, m.ids.biz7, direction, hours],
    );
  await assert.rejects(insert(null, 5), /price_rules_airport_package_shape/);
  await assert.rejects(insert("both", 5), /price_rules_airport_package_shape/);
  await assert.rejects(insert("pickup", null), /price_rules_package_matches_model/);
});

test("机场绑定：没迁移三层区域的商品不能设；机场不在区域里、区域没被①∪③盖住都拦；别的租户的区域按 404；租户 A 读不到 B 的商品", async () => {
  const legacy = await putAirports(m.a, charterA.id, [{ scenario: "airport_start", place_id: m.ids.narita, area_id: charterA.airport }]);
  assert.deepEqual([legacy.status, legacy.body.error.code], [400, "CHARTER_LAYOUT_NOT_MIGRATED"], legacy.text);

  const notInArea = await putAirports(m.b, charter.id, [{ scenario: "airport_start", place_id: m.ids.narita, area_id: charter.tokyo }]);
  assert.equal(notInArea.status, 400, notInArea.text);
  assert.ok(notInArea.body.error.details.issues.some((issue: any) => issue.reason === "AIRPORT_NOT_IN_AREA"), notInArea.text);

  const uncovered = await putAirports(m.b, charter.id, [{ scenario: "airport_start", place_id: m.ids.narita, area_id: charter.wideAirport }]);
  assert.equal(uncovered.status, 400, uncovered.text);
  assert.ok(uncovered.body.error.details.issues.some((issue: any) => issue.reason === "AIRPORT_AREA_NOT_COVERED"), uncovered.text);

  const foreign = await putAirports(m.b, charter.id, [{ scenario: "airport_start", place_id: m.ids.narita, area_id: charterA.airport }]);
  assert.equal(foreign.status, 404, foreign.text);
  const peek = await tenantCall(m.a, "GET", `/products/${charter.id}/charter-airports`);
  assert.equal(peek.status, 404, peek.text);
  const write = await tenantCall(m.a, "PUT", `/products/${charter.id}/charter-airports`, { version: await version(m.b, charter.id), body: { bindings: [] } });
  assert.equal(write.status, 404, write.text);
});

test("机场绑定保存成功（机场区域是接送机类型）：商品版本号加一；绑定只在本租户看得到（行级安全）", async () => {
  const before0 = await version(m.b, charter.id);
  const saved = await putAirports(m.b, charter.id, [
    { scenario: "airport_start", place_id: m.ids.narita, area_id: charter.airport, short_name_zh: "成田机场" },
    { scenario: "airport_end", place_id: m.ids.narita, area_id: charter.airport, short_name_zh: "成田机场" },
  ]);
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.body.version, before0 + 1);
  assert.deepEqual(
    saved.body.bindings.map((entry: any) => [entry.scenario, entry.short_name_zh, entry.effective]),
    [
      ["airport_end", "成田机场", true],
      ["airport_start", "成田机场", true],
    ],
  );
  const read = await tenantCall(m.b, "GET", `/products/${charter.id}/charter-airports`);
  assertMatchesOpenApi("GET", "/tenant/v1/products/{id}/charter-airports", read);
  assert.equal(read.body.bindings.length, 2);
  const platform = await api.call("GET", `/platform/v1/products/${charter.id}/charter-airports`, { token: m.root });
  assertMatchesOpenApi("GET", "/platform/v1/products/{id}/charter-airports", platform);
  assert.deepEqual(platform.body, read.body, "运营只读看到同一份");
  const seenByA = await withTenantTx(api.db.pool, m.a.tenantId, (db) => db.query("select count(*)::int as n from charter_airport_bindings"));
  assert.equal(seenByA.rows[0]?.n, 0, "租户 A 的事务看不到 B 的绑定");
});

test("机场套餐价：没绑定的区域 × 方向不能建（AIRPORT_BINDING_REQUIRED）；绑定了就能建（区域不在商品区域里）", async () => {
  const unbound = await batch(m.b, charter.id, { create: [airportPrice(charter.narita, "pickup", 5, 45_000)] });
  assert.equal(unbound.status, 400, unbound.text);
  assert.ok(unbound.body.error.details.issues.some((issue: any) => issue.reason === "AIRPORT_BINDING_REQUIRED"), unbound.text);
  const legacy = await batch(m.a, charterA.id, { create: [airportPrice(charterA.airport, "pickup", 5, 45_000)] });
  assert.equal(legacy.status, 400, legacy.text);
  assert.equal(legacy.body.error.details.issues[0].reason, "CHARTER_LAYOUT_NOT_MIGRATED", legacy.text);
});

test("官网快捷入口：只列能报机场套餐的机场和机场区域里的航站楼", async () => {
  const res = await site.call("GET", "/site/v1/charter-airports?scenario=airport_start", { ip: nextIp() });
  assertMatchesOpenApi("GET", "/site/v1/charter-airports", res);
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(
    res.body.items.map((airport: any) => [airport.code, airport.name, airport.terminals.map((terminal: any) => terminal.code)]),
    [["NRT", "成田机场", ["NRT-T1"]]],
  );
  const bad = await site.call("GET", "/site/v1/charter-airports?scenario=nearby", { ip: nextIp() });
  assert.equal(bad.status, 400, bad.text);
});

test("官网询价：成田航站楼上车 → 机场开始；继承照收上车加价，单独 45,000 不再列上车加价；机场区域外的酒店不是机场", async () => {
  const inherit = await quote("naritaT1", "shinjuku");
  assert.deepEqual(inherit.price_breakdown[0].scenario, { kind: "airport_start", airport_id: m.ids.narita, airport_name: "成田机场" });
  assert.ok(kinds(inherit).includes("pickup"), JSON.stringify(inherit.price_breakdown));
  const hotel = await quote("naritaHotel", "shinjuku");
  assert.equal(hotel.price_breakdown[0].scenario, undefined);
  assert.equal(hotel.price.total.amount, inherit.price.total.amount, "继承 = 普通价 + 上车加价");

  await ok(batch(m.b, charter.id, { create: [airportPrice(charter.airport, "pickup", 5, 45_000)] }));
  const own = await quote("naritaT1", "shinjuku");
  assert.equal(own.price_breakdown[0].scenario.kind, "airport_start");
  assert.ok(!kinds(own).includes("pickup"), JSON.stringify(own.price_breakdown));
  assert.ok(own.price.total.amount < inherit.price.total.amount, `单独 45,000 < 继承 47,000：${own.price.total.amount} / ${inherit.price.total.amount}`);
});

test("价格导入导出：机场套餐价写在「机场场景」列；原样导回不变；改价是修改；没绑定的区域报 AIRPORT_BINDING_REQUIRED", async () => {
  const token = await tenantLogin(api, m.b.adminEmail);
  const exported = await api.app.inject({ method: "GET", url: `/tenant/v1/products/${charter.id}/price-rules/export?rows=all`, headers: { authorization: `Bearer ${token}` } });
  assert.equal(exported.statusCode, 200);
  const rows = readXlsx(exported.rawPayload).map((cells) => cells.map((cell) => (cell.type === "text" || cell.type === "number" ? cell.text : null)));
  const header = rows[0] as (string | null)[];
  const col = (name: string): number => header.indexOf(name);
  assert.ok(col("机场场景") >= 0, header.join(","));
  const airportRows = rows.slice(1).filter((row) => row[col("机场场景")] !== null);
  assert.deepEqual(airportRows.map((row) => [row[col("机场场景")], row[col("区域")], row[col("套餐时长(小时)")], row[col("套餐价")], row[col("套餐公里")]]), [["机场开始", "成田机场（航站楼）", "5", "45000", null]]);
  const preview = async (payload: Buffer): Promise<any> => {
    const res = await api.app.inject({ method: "POST", url: `/tenant/v1/products/${charter.id}/price-rules/import/preview`, payload, headers: { "content-type": XLSX_CONTENT_TYPE, authorization: `Bearer ${token}` } });
    assert.equal(res.statusCode, 200, res.body);
    return JSON.parse(res.body);
  };
  assert.ok(((await preview(exported.rawPayload)).rows as any[]).every((row) => row.action === "unchanged"), "原样导回一条都不改");
  const edited = rows.map((row, index) => (index > 0 && row[col("机场场景")] !== null ? row.map((cell, at) => (at === col("套餐价") ? "44000" : cell)) : row));
  const changed = (await preview(writeXlsx([{ name: "价格", rows: edited }]))).rows.find((row: any) => row.content.pricing_model === "charter_airport_package" || row.content.pricingModel === "charter_airport_package");
  assert.equal(changed?.action, "update", JSON.stringify(changed));
  const blankRow = header.map(() => null as string | null);
  const unbound = blankRow.map((_, at) => ({ [col("区域")]: "成田", [col("车型组")]: "VG-BIZ-7", [col("套餐时长(小时)")]: "6", [col("套餐价")]: "50000", [col("机场场景")]: "机场结束", [col("生效开始")]: "2026-01-01" })[at] ?? null);
  const result = await preview(writeXlsx([{ name: "价格", rows: [header, unbound] }]));
  const row = (result.rows as any[])[0];
  assert.equal(row.action, "error", JSON.stringify(result));
  assert.ok(JSON.stringify(row.issues).includes("AIRPORT_BINDING_REQUIRED"), JSON.stringify(row));
});

test("解绑前要先删机场套餐价（409 AIRPORT_PRICES_EXIST）；绑定着的机场区域删不掉（409 AREA_IN_USE）", async () => {
  const unbind = await putAirports(m.b, charter.id, [{ scenario: "airport_end", place_id: m.ids.narita, area_id: charter.airport }]);
  assert.deepEqual([unbind.status, unbind.body.error.code], [409, "AIRPORT_PRICES_EXIST"], unbind.text);
  const removed = await tenantCall(m.b, "DELETE", `/areas/${charter.airport}`);
  assert.deepEqual([removed.status, removed.body.error.code], [409, "AREA_IN_USE"], removed.text);
  await assert.rejects(api.db.owner.query("delete from areas where id = $1", [charter.airport]), /charter_airport_bindings/);
});
