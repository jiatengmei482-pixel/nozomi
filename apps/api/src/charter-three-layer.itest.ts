/**
 * M9P-05（ADR 0093 第一、五、六节）经真实接口、真实 PostgreSQL：
 * - 迁移 0450：products.charter_layout 只有迁移账号能写（租户角色、平台角色写都被数据库拒绝）；
 * - 价格接口按商品标志：没迁移过的商品不能建②行程加价、整商品套餐价、空套餐的加价（CHARTER_LAYOUT_NOT_MIGRATED）；
 *   迁移过的不能新建 / 改按服务区域的套餐价和③行里的途经加价（CHARTER_LEGACY_READ_ONLY），能建②和整商品套餐价；
 * - 迁移脚本（runCharterThreeLayerMigration，部署时由 charter-three-layer-cli.ts 用迁移账号执行）：dry-run 不写库；apply 只新增、
 *   一个事务、写审计、可重复执行；报告七项；
 * - 迁移前后报价：数据一致时结果不变；迁移后经停只看②、套餐价只看整商品套餐价；
 * - 上架检查「每个车型组至少一档」、缺价统计按车型组 × 套餐；导入导出只认新格式；
 * - 「套餐价不一致」只读接口：租户只看自己的、平台看任何一家。
 * 测试数据全在本文件里经接口建出来（个别「迁移前的旧配置」直接用迁移账号写库模拟），随测试 schema 一起删除（规则 1）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { LatLng, RouteLookup } from "@nozomi/domain";
import { withPlatformTx, withTenantTx } from "./db/context.ts";
import { parseArgs } from "./db/charter-three-layer-cli.ts";
import { XLSX_CONTENT_TYPE, readXlsx, writeXlsx } from "./integrations/xlsx.ts";
import { countReport, runCharterThreeLayerMigration } from "./services/charter-three-layer.ts";
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
const P = {
  shinjuku: { lng: 139.7, lat: 35.69 },
  yokohama: { lng: 139.63, lat: 35.45 },
  kawaguchiko: { lng: 138.75, lat: 35.516 },
  kawaguchikoStation: { lng: 138.7689, lat: 35.4983 },
  hachioji: { lng: 139.32, lat: 35.66 },
  chichibu: { lng: 139.08, lat: 35.99 },
} satisfies Record<string, LatLng>;
type Place = keyof typeof P;
const SERVICE_LOCAL = "2026-10-20T10:00";
let ipSeq = 0;
const nextIp = (): string => `10.95.${(ipSeq += 1)}.9`;
const routeLookup = async (): Promise<RouteLookup> => ({ ok: true, route: { meters: 100_000, minutes: 120 }, source: "google" });

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
async function prices(who: TenantFixture, productId: string): Promise<any> {
  const res = await tenantCall(who, "GET", `/products/${productId}/price-rules`);
  assertMatchesOpenApi("GET", "/tenant/v1/products/{id}/price-rules", res);
  assert.equal(res.status, 200, res.text);
  return res.body;
}
async function batch(who: TenantFixture, productId: string, body: Record<string, unknown>): Promise<ApiResponse> {
  return tenantCall(who, "POST", `/products/${productId}/price-rules/batch`, { version: await version(who, productId), body: { create: [], update: [], delete: [], ...body } });
}

interface Charter {
  id: string;
  tokyo: string;
  yokohama: string;
  fuji: string;
  hachioji: string;
  chichibu: string;
}
let charter: Charter;
/** 甲的包车：只为租户隔离 */
let charterA: Charter;

const pkg = (areaId: string | null, hours: number, price: number, groupId?: string) => ({ area_id: areaId, vehicle_group_id: groupId ?? m.ids.biz7, package_hours: hours, pricing_model: "charter_package", package_km: 300, package_price: price, overtime_per_hour: 6_000, over_km_per_km: 500, valid_from: "2026-01-01" });
const updown = (areaId: string, hours: number | null, pickup: number, dropoff: number, waypoint?: number) => ({ area_id: areaId, vehicle_group_id: m.ids.biz7, package_hours: hours, pricing_model: "charter_area_surcharge", pickup_surcharge: pickup, dropoff_surcharge: dropoff, ...(waypoint === undefined ? {} : { waypoint_surcharge: waypoint }), valid_from: "2026-01-01" });
const itinerary = (areaId: string, hours: number | null, amount: number) => ({ area_id: areaId, vehicle_group_id: m.ids.biz7, package_hours: hours, pricing_model: "charter_itinerary_surcharge", itinerary_surcharge: amount, valid_from: "2026-01-01" });

/**
 * 一个「迁移前」的东京包车：服务区域东京市内（10h 55,000、8h 50,000）和横滨（10h 58,000，和东京市内不一致）；
 * ③富士山 10,000 / 10,000、途经 10,000；八王子 3,000 / 3,000、途经 3,000（和富士山重叠一块）；秩父上下车 0 / 0、只有途经 9,000。
 */
async function newCharter(who: TenantFixture): Promise<Charter> {
  const area = async (name: string, polygon: ReturnType<typeof square>): Promise<string> => (await ok(tenantCall(who, "POST", "/areas", { body: { city_id: m.ids.tokyo, name: { zh: name }, biz_type: "charter", polygons: [{ kind: "operate", geometry: polygon }] } }), 201)).id;
  // 横滨北边和东京市内重叠一条（①①）；八王子东边伸进东京市内（①③），西边和富士山重叠（③③ / 迁移后②②）
  const yokohama = await area("横滨", square(139.5, 35.3, 139.7, 35.55));
  const tokyo = await area("东京市内", square(139.55, 35.52, 139.95, 35.85));
  const fuji = await area("富士山", square(138.6, 35.4, 138.95, 35.6));
  const hachioji = await area("八王子", square(138.9, 35.55, 139.6, 35.75));
  const chichibu = await area("秩父", square(138.95, 35.9, 139.2, 36.1));
  const brand = (await ok(tenantCall(who, "POST", "/brands", { body: { name: `包车-${randomUUID().slice(0, 6)}`, currency: "JPY" } }), 201)).id;
  // 横滨排在前面：来源区域按名字取「东京市内」，不是排第一的
  const created = await ok(tenantCall(who, "POST", "/products", { body: { brand_id: brand, city_id: m.ids.tokyo, category: "charter", areas: [{ area_id: yokohama }, { area_id: tokyo }], vehicle_groups: [{ vehicle_group_id: m.ids.biz7, passengers: 6, luggage: 4 }], dispatchers: [{ name: "调度", phone: "0312345678" }] } }), 201);
  const rules = await ok(tenantCall(who, "PUT", `/products/${created.id}/service-rules`, { version: 1, body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { general: { mode: "limited", minutes: 0 } } } }));
  const content = await ok(tenantCall(who, "PUT", `/products/${created.id}/content`, { version: rules.version, body: { zh: { title: "东京包车" } } }));
  await ok(
    tenantCall(who, "POST", `/products/${created.id}/price-rules/batch`, {
      version: content.version,
      body: { create: [pkg(tokyo, 10, 55_000), pkg(tokyo, 8, 50_000), pkg(yokohama, 10, 58_000), updown(fuji, 10, 10_000, 10_000, 10_000), updown(hachioji, 10, 3_000, 3_000, 3_000), updown(chichibu, 10, 0, 0, 9_000)] },
    }),
  );
  await ok(tenantCall(who, "POST", `/products/${created.id}/publish`));
  return { id: created.id, tokyo, yokohama, fuji, hachioji, chichibu };
}

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay, quote: { routes: { estimate: routeLookup } } });
  m = await buildMarket(api);
  charter = await newCharter(m.b);
  charterA = await newCharter(m.a);
  // 甲的只为租户隔离和「迁全部」：下架，不参与比价（询价结果只看乙的商品）
  await ok(tenantCall(m.a, "POST", `/products/${charterA.id}/unpublish`));
  const channel = await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" });
  site = await siteApi(api, (await salesCredentials(api, m, channel.id)).clientId, pay, {}, { quote: { routes: { estimate: routeLookup } } });
  api.clock.advance(31_000);
});
after(async () => {
  await site?.close();
  await api.close();
});

async function quote(pickup: Place, stops: Place[], dropoff: Place): Promise<ApiResponse> {
  api.clock.advance(31_000);
  const waypoints = stops.map((place, index) => ({ name: `景点 ${index + 1}`, lat: P[place].lat, lng: P[place].lng, stay_minutes: 30 }));
  const res = await site.call("POST", "/site/v1/quotes", { body: { category: "charter", city_id: m.ids.tokyo, pickup: P[pickup], dropoff: P[dropoff], ...(waypoints.length === 0 ? {} : { waypoints }), package_hours: 10, service_local: SERVICE_LOCAL, passengers: 2, luggage: 1 }, ip: nextIp() });
  assertMatchesOpenApi("POST", "/site/v1/quotes", res);
  assert.equal(res.status, 200, res.text);
  return res;
}
/** 乙的商品的结算价（甲的同款商品价格一样；按商品取，不看比价） */
const settlements = async (pickup: Place, stops: Place[], dropoff: Place): Promise<string> => {
  const res = await quote(pickup, stops, dropoff);
  return res.body.quotes.map((entry: any) => entry.price.total.amount).join(",") || res.body.unavailable.flatMap((entry: any) => entry.reasons).join(",");
};
const SCENARIOS: [Place, Place[], Place][] = [
  ["shinjuku", [], "shinjuku"],
  ["shinjuku", ["kawaguchiko"], "shinjuku"],
  ["shinjuku", [], "kawaguchikoStation"],
  ["yokohama", ["kawaguchiko"], "shinjuku"],
  ["shinjuku", ["hachioji"], "shinjuku"],
  ["shinjuku", ["chichibu"], "shinjuku"],
];

const layoutOf = async (productId: string): Promise<{ layout: string | null; version: number }> => {
  const row = (await api.db.owner.query("select charter_layout, version from products where id = $1", [productId])).rows[0];
  return { layout: row.charter_layout, version: row.version };
};
const ruleCount = async (productId: string): Promise<number> => Number((await api.db.owner.query("select count(*) from price_rules where product_id = $1", [productId])).rows[0].count);

test("迁移 0450：charter_layout 只有迁移账号能写；租户角色、平台角色写入都被数据库拒绝；只有包车能设", async () => {
  await assert.rejects(
    withTenantTx(api.db.pool, m.b.tenantId, (db) => db.query("update products set charter_layout = 'three_layer' where id = $1", [charter.id])),
    (err: { code?: string }) => err.code === "42501",
  );
  await assert.rejects(
    withPlatformTx(api.db.pool, (db) => db.query("update products set charter_layout = 'three_layer' where id = $1", [charter.id])),
    (err: { code?: string }) => err.code === "42501",
  );
  await assert.rejects(api.db.owner.query("update products set charter_layout = 'two_layer' where id = $1", [charter.id]), /products_charter_layout_check/);
  // 别的价格方式不能没有区域（包车套餐以外）
  await assert.rejects(api.db.owner.query("update price_rules set area_id = null where product_id = $1 and pricing_model = 'charter_area_surcharge'", [charter.id]), /price_rules_area_required/);
  assert.deepEqual(await layoutOf(charter.id), { layout: null, version: await version(m.b, charter.id) });
});

test("没迁移过的商品：价格接口不能建行程加价、整商品套餐价、空套餐的加价（400 CHARTER_LAYOUT_NOT_MIGRATED）；应答 charter_layout = null，加价方式只有上下车加价", async () => {
  const view = await prices(m.b, charter.id);
  assert.equal(view.charter_layout, null);
  assert.deepEqual(view.surcharge_models, ["charter_area_surcharge"]);
  for (const rule of [itinerary(charter.fuji, 10, 1_000), pkg(null, 10, 60_000), updown(charter.fuji, null, 1, 1)]) {
    const res = await batch(m.b, charter.id, { create: [rule] });
    assert.equal(res.status, 400, res.text);
    assert.equal(res.body.error.code, "CHARTER_LAYOUT_NOT_MIGRATED", res.text);
  }
  assert.equal(await ruleCount(charter.id), 6);
});

let before0: string[];

test("迁移脚本 dry-run：报告七项齐全，不写库（商品标志、版本号、规则条数都不变）", async () => {
  before0 = [];
  for (const [pickup, stops, dropoff] of SCENARIOS) before0.push(await settlements(pickup, stops, dropoff));
  const versionBefore = (await layoutOf(charter.id)).version;
  const report = await runCharterThreeLayerMigration(api.db.owner, { mode: "dry-run", productId: charter.id, now: new Date(api.clock.now()) });
  assert.deepEqual(await layoutOf(charter.id), { layout: null, version: versionBefore });
  assert.equal(await ruleCount(charter.id), 6);
  const product = report.products[0];
  assert.ok(product !== undefined);
  assert.equal(product.outcome, "migrated");
  assert.equal(product.sourceArea, "东京市内", "来源区域按名字取东京市内，不是排第一的横滨");
  assert.deepEqual([product.createdPackages, product.createdItinerary], [2, 3]);
  assert.deepEqual(product.packageMismatches.map((entry) => [entry.area, entry.packageHours, entry.source?.packagePriceMinor ?? null, entry.other?.packagePriceMinor ?? null]).sort(), [["横滨", 10, 55_000, 58_000], ["横滨", 8, 50_000, null]]);
  assert.deepEqual(product.waypointOnlyRows.map((entry) => entry.area), ["秩父"]);
  assert.deepEqual(product.overlaps.map((entry) => [entry.layer, [entry.a, entry.b].sort().join("∩")]).sort(), [["②②", "八王子∩富士山"], ["③③", "八王子∩富士山"], ["①③", "东京市内∩八王子"], ["①①", "东京市内∩横滨"]].sort());
  assert.deepEqual(product.itineraryByArea.sort((x, y) => x.area.localeCompare(y.area)), [{ area: "八王子", amountsMinor: [3_000] }, { area: "富士山", amountsMinor: [10_000] }, { area: "秩父", amountsMinor: [9_000] }].sort((x, y) => x.area.localeCompare(y.area)));
  assert.deepEqual(product.itineraryMismatches, [], "八王子 3,000、秩父 9,000 和业务方已定 B 一致");
  assert.deepEqual(product.baseAreaSurcharges, []);
  assert.deepEqual(product.emptyCells, []);
  assert.equal(report.coverage, "未配置");
  const counts = countReport(report);
  assert.deepEqual([counts.products, counts.migrated, counts.createdPackages, counts.createdItinerary], [1, 1, 2, 3]);
});

test("迁移脚本 apply：只新增整商品套餐价和行程加价、标志和版本号一起改、写审计；可重复执行；迁移前后报价逐条不变", async () => {
  const versionBefore = (await layoutOf(charter.id)).version;
  const report = await runCharterThreeLayerMigration(api.db.owner, { mode: "apply", productId: charter.id, now: new Date(api.clock.now()) });
  assert.equal(report.products[0]?.outcome, "migrated");
  assert.deepEqual(await layoutOf(charter.id), { layout: "three_layer", version: versionBefore + 1 });
  const rows = (await api.db.owner.query("select area_id, package_hours, pricing_model, params from price_rules where product_id = $1 order by created_at, id", [charter.id])).rows;
  assert.equal(rows.length, 6 + 5, "旧的 6 条原样保留");
  assert.deepEqual(
    rows.filter((row) => row.area_id === null).map((row) => [row.package_hours, row.params.packagePriceMinor]).sort((x, y) => x[0] - y[0]),
    [[8, 50_000], [10, 55_000]],
  );
  assert.deepEqual(rows.filter((row) => row.pricing_model === "charter_itinerary_surcharge").map((row) => row.params.surchargeMinor).sort((x, y) => x - y), [3_000, 9_000, 10_000]);
  const audits = (await api.db.owner.query("select resource, action, actor_type, source, tenant_id from audit_logs where action = 'migrate' and tenant_id = $1", [m.b.tenantId])).rows;
  assert.equal(audits.length, 6);
  assert.ok(audits.every((row) => row.actor_type === "system" && row.source === "cli"));
  assert.deepEqual(audits.filter((row) => row.resource === "product").length, 1);
  // 再跑一次：已迁过的跳过，不再新增
  const again = await runCharterThreeLayerMigration(api.db.owner, { mode: "apply", productId: charter.id, now: new Date(api.clock.now()) });
  assert.equal(again.products[0]?.outcome, "already_migrated");
  assert.equal(await ruleCount(charter.id), 11);
  // 迁移前后报价：只有「横滨上车」一条变了——套餐价统一为来源区域（东京市内）的价（ADR 0093 第六节第 5 小节第 8 类），
  // 报告里「套餐价不一致」列着它（横滨 10h 58,000 vs 东京市内 55,000）；别的逐条不变（东京市内的套餐价、③里的途经加价原样搬过去）
  const after0: string[] = [];
  for (const [pickup, stops, dropoff] of SCENARIOS) after0.push(await settlements(pickup, stops, dropoff));
  const yokohamaPickup = SCENARIOS.findIndex(([pickup]) => pickup === "yokohama");
  assert.deepEqual([before0[yokohamaPickup], after0[yokohamaPickup]], [String(Math.round((58_000 + 10_000) * 1.1)), String(Math.round((55_000 + 10_000) * 1.1))]);
  assert.deepEqual(after0.filter((_, index) => index !== yokohamaPickup), before0.filter((_, index) => index !== yokohamaPickup));
});

test("迁移后：套餐价只看整商品套餐价（改旧行无效、旧行只读）；经停只看②（③行里的途经加价只读）；②可以建在服务区域上、可以不分套餐", async () => {
  const view = await prices(m.b, charter.id);
  assert.equal(view.charter_layout, "three_layer");
  assert.deepEqual(view.surcharge_models, ["charter_area_surcharge", "charter_itinerary_surcharge"]);
  const oldTokyo = view.items.find((item: any) => item.area_id === charter.tokyo && item.package_hours === 10);
  const wide10 = view.items.find((item: any) => item.area_id === null && item.package_hours === 10);
  const fujiItinerary = view.items.find((item: any) => item.pricing_model === "charter_itinerary_surcharge" && item.area_id === charter.fuji);
  const fujiUpdown = view.items.find((item: any) => item.pricing_model === "charter_area_surcharge" && item.area_id === charter.fuji);
  assert.equal(fujiItinerary.itinerary_surcharge, 10_000);

  // 旧的按区域套餐价只读：改不了、新建不了；删除可以（下面不删，留着给差异接口）
  const editOld = await batch(m.b, charter.id, { update: [{ id: oldTokyo.id, ...pkg(charter.tokyo, 10, 1) }] });
  assert.equal(editOld.status, 400, editOld.text);
  assert.equal(editOld.body.error.code, "CHARTER_LEGACY_READ_ONLY");
  const newOld = await batch(m.b, charter.id, { create: [pkg(charter.tokyo, 6, 30_000)] });
  assert.equal(newOld.body.error.code, "CHARTER_LEGACY_READ_ONLY", newOld.text);
  // ③行的途经加价只读；不带这个键改上下车加价可以（沿用原值）
  const editWaypoint = await batch(m.b, charter.id, { update: [{ id: fujiUpdown.id, ...updown(charter.fuji, 10, 10_000, 10_000, 1) }] });
  assert.equal(editWaypoint.body.error.code, "CHARTER_LEGACY_READ_ONLY", editWaypoint.text);
  const { waypoint_surcharge: _omit, ...withoutWaypoint } = updown(charter.fuji, 10, 10_000, 12_000);
  assert.equal((await batch(m.b, charter.id, { update: [{ id: fujiUpdown.id, ...withoutWaypoint }] })).status, 200);

  // 改整商品套餐价、②：报价跟着变
  const saved = await batch(m.b, charter.id, { update: [{ id: wide10.id, ...pkg(null, 10, 60_000) }, { id: fujiItinerary.id, ...itinerary(charter.fuji, 10, 15_000) }] });
  assert.equal(saved.status, 200, saved.text);
  assertMatchesOpenApi("POST", "/tenant/v1/products/{id}/price-rules/batch", saved);
  assert.equal(await settlements("shinjuku", [], "shinjuku"), "66000", "60,000 × 1.1");
  assert.equal(await settlements("shinjuku", ["kawaguchiko"], "shinjuku"), String(Math.round((60_000 + 15_000) * 1.1)));
  assert.equal(await settlements("shinjuku", [], "kawaguchikoStation"), String(Math.round((60_000 + 15_000 + 12_000) * 1.1)), "下车点行程加价查②；下车加价是改过的 12,000");

  // ②建在服务区域（横滨）上、不分套餐（= 所有套餐）：横滨经停收它
  const created = await batch(m.b, charter.id, { create: [itinerary(charter.yokohama, null, 2_000)] });
  assert.equal(created.status, 200, created.text);
  assert.equal(await settlements("shinjuku", ["yokohama"], "shinjuku"), String(Math.round((60_000 + 2_000) * 1.1)));
  // 经停只在③（没有②的区域）里：秩父有②（迁过来的），删掉②后经停在秩父报不出
  const chichibuItinerary = (await prices(m.b, charter.id)).items.find((item: any) => item.pricing_model === "charter_itinerary_surcharge" && item.area_id === charter.chichibu);
  assert.equal((await batch(m.b, charter.id, { delete: [chichibuItinerary.id] })).status, 200);
  assert.equal(await settlements("shinjuku", ["chichibu"], "shinjuku"), "WAYPOINT_NOT_PRICED");
});

test("迁移后：缺价统计按车型组 × 套餐（区域为 null）；上架检查要求每个车型组至少一档整商品套餐价", async () => {
  const coverage = await tenantCall(m.b, "GET", `/products/${charter.id}/price-coverage`);
  assertMatchesOpenApi("GET", "/tenant/v1/products/{id}/price-coverage", coverage);
  assert.deepEqual(coverage.body.combos.map((combo: any) => [combo.area_id, combo.package_hours, combo.state]), [[null, 8, "priced"], [null, 10, "priced"]]);
  // 加一个车型组，它没有整商品套餐价：上架检查不通过
  const detail = await ok(tenantCall(m.b, "GET", `/products/${charter.id}`));
  const groups = [...detail.vehicle_groups.map((group: any) => ({ vehicle_group_id: group.vehicle_group_id, passengers: group.passengers, luggage: group.luggage })), { vehicle_group_id: m.ids.eco4, passengers: 3, luggage: 2 }];
  const updated = await tenantCall(m.b, "PATCH", `/products/${charter.id}`, { version: detail.version, body: { vehicle_groups: groups } });
  // 已上架的商品改完不满足上架条件会被拒（修改保护）——这正是「上架拦下」
  assert.equal(updated.status, 409, updated.text);
  assert.equal(updated.body.error.code, "PUBLISH_CHECK_FAILED");
  const check = updated.body.error.details.items;
  const price = (check as any[]).find((item) => item.key === "price_rules");
  assert.deepEqual(price.issues.map((issue: any) => [issue.path, issue.reason]), [["/vehicle_groups/1", "CHARTER_GROUP_NO_PACKAGE"]]);
});

test("迁移后：导出只有新格式（套餐价不带区域、有「行程加价」、没有「途经加价」、不导出按区域的旧套餐价）；旧模版整份不收（LEGACY_TEMPLATE）", async () => {
  const token = await tenantLogin(api, m.b.adminEmail);
  const exported = await api.app.inject({ method: "GET", url: `/tenant/v1/products/${charter.id}/price-rules/export?rows=all`, headers: { authorization: `Bearer ${token}` } });
  assert.equal(exported.statusCode, 200);
  const rows = readXlsx(exported.rawPayload).map((cells) => cells.map((cell) => (cell.type === "text" || cell.type === "number" ? cell.text : null)));
  const header = rows[0] as (string | null)[];
  assert.ok(header.includes("行程加价") && !header.includes("途经加价"), header.join(","));
  const areaCol = header.indexOf("区域");
  const priceCol = header.indexOf("套餐价");
  const packages = rows.slice(1).filter((row) => row[priceCol] !== null);
  assert.deepEqual(packages.map((row) => row[areaCol]), [null, null], "只有整商品套餐价，区域留空");
  // 原样导回：一条都不改
  const preview = await api.app.inject({ method: "POST", url: `/tenant/v1/products/${charter.id}/price-rules/import/preview`, payload: exported.rawPayload, headers: { "content-type": XLSX_CONTENT_TYPE, authorization: `Bearer ${token}` } });
  assert.equal(preview.statusCode, 200, preview.body);
  assert.ok((JSON.parse(preview.body).rows as any[]).every((row) => row.action === "unchanged"), preview.body);
  // 迁移前的旧模版（有「途经加价」列）
  const legacy = writeXlsx([{ name: "价格", rows: [["价格编号", "区域", "车型组", "套餐时长(小时)", "套餐公里", "套餐价", "超时单价(每小时)", "超公里单价(每公里)", "上车加价", "下车加价", "途经加价", "生效开始", "生效结束", "状态"]] }]);
  const rejected = await api.app.inject({ method: "POST", url: `/tenant/v1/products/${charter.id}/price-rules/import/preview`, payload: legacy, headers: { "content-type": XLSX_CONTENT_TYPE, authorization: `Bearer ${token}` } });
  assert.equal(rejected.statusCode, 400);
  assert.equal(JSON.parse(rejected.body).error.details.reason, "LEGACY_TEMPLATE");
});

test("「套餐价不一致」只读接口：供应商看自己的、甲看乙的 404；运营看任何一家；没迁移过的商品是空的", async () => {
  const mine = await tenantCall(m.b, "GET", `/products/${charter.id}/charter-migration-diff`);
  assertMatchesOpenApi("GET", "/tenant/v1/products/{id}/charter-migration-diff", mine);
  assert.equal(mine.status, 200, mine.text);
  assert.equal(mine.body.charter_layout, "three_layer");
  // 东京市内 10h 55,000 vs 整商品（改成了）60,000；横滨 10h 58,000 vs 60,000；横滨没有 8h（只有东京市内有）→ 东京市内 8h 和整商品 8h 一致
  assert.deepEqual(mine.body.items.map((item: any) => [item.area_id, item.package_hours, item.old.package_price, item.product?.package_price ?? null]).sort(), [[charter.tokyo, 10, 55_000, 60_000], [charter.yokohama, 10, 58_000, 60_000]].sort());
  const crossTenant = await tenantCall(m.a, "GET", `/products/${charter.id}/charter-migration-diff`);
  assert.equal(crossTenant.status, 404);
  const legacy = await ok(tenantCall(m.a, "GET", `/products/${charterA.id}/charter-migration-diff`));
  assert.deepEqual(legacy, { charter_layout: null, items: [] });
  const platform = await api.call("GET", `/platform/v1/products/${charter.id}/charter-migration-diff`, { token: m.staff.readonly.token });
  assertMatchesOpenApi("GET", "/platform/v1/products/{id}/charter-migration-diff", platform);
  assert.equal(platform.status, 200, platform.text);
  assert.deepEqual(platform.body, mine.body);
});

test("迁移脚本：不带 --product 时迁全部还没迁过的包车商品（甲的也迁）；命令行参数和部署时的环境变量", async () => {
  const report = await runCharterThreeLayerMigration(api.db.owner, { mode: "apply", now: new Date(api.clock.now()) });
  assert.deepEqual(report.products.map((product) => [product.productId, product.outcome]).sort(), [[charter.id, "already_migrated"], [charterA.id, "migrated"]].sort());
  assert.equal((await layoutOf(charterA.id)).layout, "three_layer");
  assert.deepEqual(parseArgs(["--dry-run"]), { mode: "dry-run", productId: null });
  assert.deepEqual(parseArgs([], { CHARTER_THREE_LAYER_MIGRATION: "apply" }), { mode: "apply", productId: null });
  assert.deepEqual(parseArgs(["--apply", "--product", charter.id]), { mode: "apply", productId: charter.id });
  assert.throws(() => parseArgs([]), /--dry-run 或 --apply/);
  assert.throws(() => parseArgs(["--dry-run", "--apply"]), /--dry-run 或 --apply/);
  assert.throws(() => parseArgs(["--apply", "--product", "x"]), /UUID/);
  assert.throws(() => parseArgs(["--apply", "--force"]), /不认识的参数/);
});
