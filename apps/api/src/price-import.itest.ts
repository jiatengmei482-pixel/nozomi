/**
 * M4-28：价格表导入的写入（ADR 0062），经真实 PostgreSQL、真实服务函数。价格、地名都是虚构的。
 * - 默认 dry-run 什么都不写；`apply` 才写，而且只建一个子品牌、这一批的区域、草稿商品和价格规则；
 * - 重复执行不重复创建；撤回干净（子品牌留下）；不碰已有的商品、区域、价格；
 * - 租户隔离：目标租户由参数指定，只写那一个租户；撤回一个租户的批次不动另一个租户的同名批次；
 * - 前置检查：缺车型组、同城市有同名区域、已有价格被改过时整批不写；
 * - 官网显示价：把导入的草稿补齐上架后，经销售端询价，对外价等于表上价（对不上的那一格按偏差清单低一档）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type PriceSheetCountry, parsePriceImportMapping, planPriceSheetImport } from "@nozomi/domain";
import type { DbContext } from "./context.ts";
import { type HttpMethod, type TenantFixture, type TestApi, createTestApi } from "./testing/api.ts";
import { type Market, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { revertPriceImport, runPriceImport } from "./services/price-import.ts";

let api: TestApi;
let m: Market;
let ctx: DbContext;
let channelId: string;

before(async () => {
  api = await createTestApi();
  m = await buildMarket(api);
  ctx = { pool: api.db.pool, now: api.clock.now };
  channelId = (await newChannel(api, m.staff.cm1.token, { name: "虚构官网", pricing: { default_markup_bp: 1_500, markup_floor_bp: 1_000, band_bp: 300, sell_rounding: { JPY: 100 } } })).id;
});
after(() => api.close());

const notes = { reverseSamePrice: true, startKilometers: null, declaredRoutes: [] };
const ECO = { column: 2, ref: "日本!C1", name: "Economy 4 Seater", capacity: { passengers: 3, luggage: 2 } };
const BIZ = { column: 3, ref: "日本!D1", name: "Business 7 Seater", capacity: { passengers: 6, luggage: 4 } };

function sheet(routes: [string, string, (number | null)[]][]): PriceSheetCountry {
  return { sheet: "日本", countryCode: "JP", columns: [ECO, BIZ], routes: routes.map(([from, to, prices], index) => ({ row: index + 3, from, to, prices, invalidCells: 0 })) };
}

const mapping = (vehicles: Record<string, string | null> = {}) =>
  parsePriceImportMapping({
    airports: { 虚构成田机场: "NRT" },
    regions: { 虚构甲地区: { lat: 35.6, lng: 139.7, radius_m: 20_000 }, 虚构乙地区: { lat: 35.45, lng: 139.6, radius_m: 8_000 } },
    vehicles: { "Economy 4 Seater": "VG-ECO-4", "Business 7 Seater": "VG-BIZ-7", ...vehicles },
  });

const ROUTES: [string, string, (number | null)[]][] = [
  ["虚构成田机场", "虚构甲地区", [9_900, 23_000]],
  ["虚构甲地区", "虚构成田机场", [9_900, 24_000]],
  ["虚构成田机场", "虚构乙地区", [9_950, null]],
];

/**
 * 区域在同一租户同一城市里不能重名（ADR 0015），所以每一批的地区名带上批次号，几个测试的批次互不相撞。
 * 「东京全域」是市场里租户自己建的区域，不改名。
 */
const named = (name: string, batch: string): string => (name.endsWith("地区") ? `${name}${batch}` : name);

const run = (tenantId: string, batch: string, apply: boolean, routes = ROUTES, vehicles: Record<string, string | null> = {}) => {
  const renamed = routes.map(([from, to, prices]): [string, string, (number | null)[]] => [named(from, batch), named(to, batch), prices]);
  const base = mapping(vehicles);
  const regions = new Map([...base.regions].map(([name, shape]) => [named(name, batch), shape]));
  return runPriceImport(ctx, { tenantId, channelId, countryCode: "JP", batch, currency: "JPY", validFrom: "2026-11-01", plan: planPriceSheetImport(sheet(renamed), notes, { ...base, regions }), apply });
};

/** 一个租户的子品牌、区域、商品、价格规则、审计日志各有多少行，和它已上架商品的版本、价格（核对「不碰已有的」）。 */
async function snapshot(tenantId: string): Promise<Record<string, unknown>> {
  const count = async (table: string): Promise<number> => Number((await api.db.owner.query(`select count(*)::int as n from ${table} where tenant_id = $1`, [tenantId])).rows[0].n);
  const products = (await api.db.owner.query("select id, status, version from products where tenant_id = $1 and brand_id not in (select id from brands where tenant_id = $1 and name like '价格表导入 %') order by id", [tenantId])).rows;
  const rules = (await api.db.owner.query("select id, area_id, params, valid_from::text, updated_at from price_rules where tenant_id = $1 and product_id = any($2::uuid[]) order by id", [tenantId, products.map((row) => row.id)])).rows;
  const areas = (await api.db.owner.query("select id, version, name from areas where tenant_id = $1 and id not in (select area_id from area_polygons where tenant_id = $1 and label like '价格表导入 %') order by id", [tenantId])).rows;
  return { brands: await count("brands"), areas: await count("areas"), products: await count("products"), priceRules: await count("price_rules"), audit: await count("audit_logs"), existing: { products, rules, areas } };
}

async function batchRows(tenantId: string, batch: string): Promise<{ brand: any; products: any[]; areas: any[]; rules: any[] }> {
  const brand = (await api.db.owner.query("select id, currency, rounding_unit from brands where tenant_id = $1 and name = $2", [tenantId, `价格表导入 ${batch}`])).rows[0] ?? null;
  const products = brand === null ? [] : (await api.db.owner.query("select id, status, city_id, poi_id from products where tenant_id = $1 and brand_id = $2", [tenantId, brand.id])).rows;
  const areas = (await api.db.owner.query("select a.id, a.city_id, a.name, a.biz_type, a.status from areas a where a.tenant_id = $1 and exists (select 1 from area_polygons p where p.tenant_id = $1 and p.area_id = a.id and p.label = $2) order by a.name->>'zh'", [tenantId, `价格表导入 ${batch}`])).rows;
  const rules = (await api.db.owner.query("select r.area_id, r.vehicle_group_id, r.direction, r.params, r.valid_from::text, r.valid_to from price_rules r where r.tenant_id = $1 and r.product_id = any($2::uuid[]) order by r.direction, (r.params->>'basePriceMinor')::int", [tenantId, products.map((row) => row.id)])).rows;
  return { brand, products, areas, rules };
}

test("dry-run：只读，什么都不写；列出要建的子品牌、区域、商品、价格和每一格的倒算结果", async () => {
  const before = await snapshot(m.a.tenantId);
  const outcome = await run(m.a.tenantId, "DRY-1", false);
  assert.equal(outcome.mode, "dry_run");
  assert.deepEqual(outcome.blockers, []);
  assert.deepEqual(outcome.planned, { brand: "create", areas: { create: 2, exists: 0 }, products: { create: 1, extend: 0, exists: 0 }, prices: { create: 4, exists: 0, skippedImpossible: 0 } });
  assert.deepEqual(outcome.written, { brand: 0, areas: 0, products: 0, prices: 0 });
  // 加价 15%、向上取整到 100 日元：9,900 对得上；9,950 不是 100 的倍数，低一档显示 9,900
  const shown = outcome.priced.map((cell) => [cell.region, cell.vehicleGroupCode, cell.direction, cell.sheetPriceMinor, cell.result.status, cell.result.displayMinor]);
  assert.deepEqual(shown, [
    ["虚构甲地区DRY-1", "VG-ECO-4", "both", 9_900, "exact", 9_900],
    ["虚构甲地区DRY-1", "VG-BIZ-7", "pickup", 23_000, "exact", 23_000],
    ["虚构甲地区DRY-1", "VG-BIZ-7", "dropoff", 24_000, "exact", 24_000],
    ["虚构乙地区DRY-1", "VG-ECO-4", "both", 9_950, "below", 9_900],
  ]);
  assert.deepEqual(await snapshot(m.a.tenantId), before);
});

test("写入：只建这一批的子品牌、区域、草稿商品和价格；重复执行不重复创建；不碰已有的；审计记为系统 / 命令行", async () => {
  const before = await snapshot(m.a.tenantId);
  const first = await run(m.a.tenantId, "JP-TEST-1", true);
  assert.equal(first.mode, "applied", JSON.stringify(first.blockers));
  assert.deepEqual(first.written, { brand: 1, areas: 2, products: 1, prices: 4 });
  const rows = await batchRows(m.a.tenantId, "JP-TEST-1");
  assert.deepEqual([rows.brand.currency, rows.brand.rounding_unit], ["JPY", 1]);
  assert.deepEqual(rows.products.map((row) => [row.status, row.city_id, row.poi_id]), [["draft", m.ids.tokyo, m.ids.narita]]);
  assert.deepEqual(rows.areas.map((row) => [row.name.zh, row.city_id, row.biz_type, row.status]), [["虚构乙地区JP-TEST-1", m.ids.tokyo, "airport_transfer", "active"], ["虚构甲地区JP-TEST-1", m.ids.tokyo, "airport_transfer", "active"]]);
  assert.ok(rows.rules.every((rule) => rule.valid_from === "2026-11-01" && rule.valid_to === null));
  const expected = new Map(first.priced.map((cell) => [`${cell.vehicleGroupCode}|${cell.direction}|${cell.region}`, cell.result.baseMinor]));
  assert.equal(rows.rules.length, 4);
  for (const rule of rows.rules) {
    const region = rows.areas.find((area) => area.id === rule.area_id).name.zh;
    const code = rule.vehicle_group_id === m.ids.eco4 ? "VG-ECO-4" : "VG-BIZ-7";
    assert.equal(rule.params.basePriceMinor, expected.get(`${code}|${rule.direction}|${region}`));
  }
  const audit = (await api.db.owner.query("select distinct actor_type, source from audit_logs where tenant_id = $1 and occurred_at = $2", [m.a.tenantId, api.clock.now()])).rows;
  assert.deepEqual(audit, [{ actor_type: "system", source: "cli" }]);

  const after = await snapshot(m.a.tenantId);
  assert.deepEqual(after.existing, before.existing);
  assert.deepEqual([after.brands, after.areas, after.products, after.priceRules], [(before.brands as number) + 1, (before.areas as number) + 2, (before.products as number) + 1, (before.priceRules as number) + 4]);

  // 再跑一次：认出已有的，什么都不建
  api.clock.advance(60_000);
  const again = await run(m.a.tenantId, "JP-TEST-1", true);
  assert.equal(again.mode, "applied");
  assert.deepEqual(again.written, { brand: 0, areas: 0, products: 0, prices: 0 });
  assert.deepEqual(again.planned, { brand: "exists", areas: { create: 0, exists: 2 }, products: { create: 0, extend: 0, exists: 1 }, prices: { create: 0, exists: 4, skippedImpossible: 0 } });
  const third = await snapshot(m.a.tenantId);
  assert.deepEqual({ ...third, audit: 0 }, { ...after, audit: 0 });
  assert.equal(third.audit, after.audit);

});

test("重复执行：表里后来多了地区和车型，只补新的区域、给商品补上区域，再补新的价格，已有的不动", async () => {
  const first = await run(m.a.tenantId, "JP-GROW", true, ROUTES.slice(0, 2), { "Business 7 Seater": null });
  assert.deepEqual(first.written, { brand: 1, areas: 1, products: 1, prices: 1 });
  const before = (await batchRows(m.a.tenantId, "JP-GROW")).rules;
  const grown = await run(m.a.tenantId, "JP-GROW", true);
  assert.equal(grown.mode, "applied", JSON.stringify(grown.blockers));
  assert.deepEqual(grown.written, { brand: 0, areas: 1, products: 0, prices: 3 });
  assert.equal(grown.planned.products.extend, 1);
  const after = (await batchRows(m.a.tenantId, "JP-GROW")).rules;
  assert.equal(after.length, 4);
  for (const rule of before) assert.ok(after.some((entry) => JSON.stringify(entry) === JSON.stringify(rule)));
  // 表改了形状（原来通用的一格变成只有接机有价）：和已有的通用价方向重叠，不覆盖，整批不写
  const reshaped = await run(m.a.tenantId, "JP-GROW", true, [ROUTES[0] as [string, string, (number | null)[]], ["虚构甲地区", "虚构成田机场", [null, 24_000]], ROUTES[2] as [string, string, (number | null)[]]]);
  assert.equal(reshaped.mode, "blocked");
  assert.deepEqual([...new Set(reshaped.blockers.map((blocker) => blocker.code))], ["PRICE_CONFLICT"]);
});

test("撤回：dry-run 不动；撤回后这一批的商品、价格、区域都没了，子品牌留下；已有的不动；再撤回一次没有可做的", async () => {
  await run(m.a.tenantId, "JP-REVERT", true);
  const withBatch = await snapshot(m.a.tenantId);
  const dry = await revertPriceImport(ctx, { tenantId: m.a.tenantId, batch: "JP-REVERT", apply: false });
  assert.deepEqual([dry.mode, dry.products, dry.areas], ["dry_run", 1, 2]);
  assert.deepEqual(await snapshot(m.a.tenantId), withBatch);

  const done = await revertPriceImport(ctx, { tenantId: m.a.tenantId, batch: "JP-REVERT", apply: true });
  assert.deepEqual([done.mode, done.products, done.areas], ["applied", 1, 2]);
  const rows = await batchRows(m.a.tenantId, "JP-REVERT");
  assert.deepEqual([rows.products.length, rows.areas.length, rows.rules.length], [0, 0, 0]);
  assert.notEqual(rows.brand, null);
  const after = await snapshot(m.a.tenantId);
  assert.deepEqual(after.existing, withBatch.existing);
  assert.deepEqual([after.products, after.areas, after.priceRules], [(withBatch.products as number) - 1, (withBatch.areas as number) - 2, (withBatch.priceRules as number) - 4]);
  // 别的批次不受影响
  assert.equal((await batchRows(m.a.tenantId, "JP-TEST-1")).products.length, 1);
  const twice = await revertPriceImport(ctx, { tenantId: m.a.tenantId, batch: "JP-REVERT", apply: true });
  assert.deepEqual([twice.mode, twice.products, twice.areas], ["applied", 0, 0]);
  // 撤回后再导同一批：接着用留下的子品牌，重新建
  const redo = await run(m.a.tenantId, "JP-REVERT", true);
  assert.deepEqual(redo.written, { brand: 0, areas: 2, products: 1, prices: 4 });
  assert.equal((await revertPriceImport(ctx, { tenantId: m.a.tenantId, batch: "JP-REVERT", apply: true })).mode, "applied");
});

test("撤回：这一批的区域被这一批以外的商品选了（删区域会连带删那个商品的价格），整批不动", async () => {
  await run(m.a.tenantId, "JP-LOCKED", true);
  const rows = await batchRows(m.a.tenantId, "JP-LOCKED");
  const area = rows.areas[0].id as string;
  const other = await tenantCall(m.a, "GET", `/products/${m.ids.pa}`);
  await tenantCall(m.a, "PATCH", `/products/${m.ids.pa}`, { areas: [...other.areas.map((entry: any) => ({ area_id: entry.area_id })), { area_id: area }] }, other.version);
  const before = await snapshot(m.a.tenantId);
  const blocked = await revertPriceImport(ctx, { tenantId: m.a.tenantId, batch: "JP-LOCKED", apply: true });
  assert.equal(blocked.mode, "blocked");
  assert.deepEqual(blocked.blockers, [{ reason: "AREA_USED_OUTSIDE_BATCH", id: area }]);
  assert.deepEqual(await snapshot(m.a.tenantId), before);
  assert.equal((await batchRows(m.a.tenantId, "JP-LOCKED")).products.length, 1);
});

test("租户隔离：目标租户只来自参数，只写那一个租户；同名批次在两个租户各自独立，撤回一个不动另一个", async () => {
  const beforeB = await snapshot(m.b.tenantId);
  await run(m.a.tenantId, "JP-ISO", true);
  assert.deepEqual(await snapshot(m.b.tenantId), beforeB);
  const intoB = await run(m.b.tenantId, "JP-ISO", true);
  assert.equal(intoB.mode, "applied");
  assert.deepEqual(intoB.written, { brand: 1, areas: 2, products: 1, prices: 4 });
  const a = await batchRows(m.a.tenantId, "JP-ISO");
  const b = await batchRows(m.b.tenantId, "JP-ISO");
  assert.notEqual(a.brand.id, b.brand.id);
  assert.equal(a.areas.filter((area) => b.areas.some((other) => other.id === area.id)).length, 0);
  // 租户 B 经接口看不到、也改不了 A 这一批的商品
  const missing = await api.call("GET", `/tenant/v1/products/${a.products[0].id}`, { token: m.b.adminToken });
  assert.equal(missing.status, 404);
  const patch = await api.call("PATCH", `/tenant/v1/products/${a.products[0].id}`, { token: m.b.adminToken, body: { areas: [] }, headers: { "if-match": '"1"' } });
  assert.equal(patch.status, 404);
  assert.equal((await revertPriceImport(ctx, { tenantId: m.b.tenantId, batch: "JP-ISO", apply: true })).mode, "applied");
  assert.equal((await batchRows(m.a.tenantId, "JP-ISO")).products.length, 1);
  assert.equal((await batchRows(m.b.tenantId, "JP-ISO")).products.length, 0);
});

test("前置检查：车型组在平台主数据里没有，整批不写（工具不建平台主数据）", async () => {
  const before = await snapshot(m.a.tenantId);
  const missing = await run(m.a.tenantId, "JP-NOVG", true, ROUTES, { "Business 7 Seater": "VG-LUX-9" });
  assert.equal(missing.mode, "blocked");
  assert.deepEqual(missing.blockers.map((blocker) => blocker.code), ["VEHICLE_GROUP_MISSING"]);
  assert.deepEqual(await snapshot(m.a.tenantId), before);
});

test("前置检查：同城市已有同名区域（租户自己建的「东京全域」）时不动它、不建同名的，整批不写", async () => {
  const before = await snapshot(m.a.tenantId);
  const plan = planPriceSheetImport(sheet([["虚构成田机场", "东京全域", [9_900, 23_000]]]), notes, parsePriceImportMapping({ airports: { 虚构成田机场: "NRT" }, regions: { 东京全域: { lat: 35.6, lng: 139.7, radius_m: 20_000 } }, vehicles: { "Economy 4 Seater": "VG-ECO-4", "Business 7 Seater": "VG-BIZ-7" } }));
  const outcome = await runPriceImport(ctx, { tenantId: m.a.tenantId, channelId, countryCode: "JP", batch: "JP-TAKEN", currency: "JPY", validFrom: "2026-11-01", plan, apply: true });
  assert.equal(outcome.mode, "blocked");
  assert.deepEqual(outcome.blockers.map((blocker) => blocker.code), ["AREA_NAME_TAKEN"]);
  assert.deepEqual(await snapshot(m.a.tenantId), before);
});

test("前置检查：这一批已有的价格被人改过，再跑不覆盖，整批不写", async () => {
  await run(m.a.tenantId, "JP-EDITED", true);
  const rows = await batchRows(m.a.tenantId, "JP-EDITED");
  const product = rows.products[0].id as string;
  const rules = await tenantCall(m.a, "GET", `/products/${product}/price-rules`);
  const first = rules.items[0];
  await tenantCall(m.a, "PUT", `/products/${product}/price-rules/${first.id}`, { area_id: first.area_id, vehicle_group_id: first.vehicle_group_id, direction: first.direction, pricing_model: "fixed", valid_from: first.valid_from, base_price: 1_234 }, rules.version);
  const before = await snapshot(m.a.tenantId);
  const outcome = await run(m.a.tenantId, "JP-EDITED", true);
  assert.equal(outcome.mode, "blocked");
  assert.deepEqual(outcome.blockers.map((blocker) => blocker.code), ["PRICE_CONFLICT"]);
  assert.deepEqual(await snapshot(m.a.tenantId), before);
});

async function tenantCall(who: TenantFixture, method: HttpMethod, path: string, body?: unknown, version?: number): Promise<any> {
  return ok(
    api.call(method, `/tenant/v1${path}`, {
      token: who.adminToken,
      ...(body === undefined ? {} : { body }),
      headers: { ...(version === undefined ? {} : { "if-match": `"${version}"` }), ...(method === "POST" ? { "idempotency-key": randomUUID() } : {}) },
    }),
    method === "POST" && !path.endsWith("/publish") ? 201 : 200,
  );
}

test("官网显示价：导入的草稿补齐服务规则、详情、调度人后上架，经销售端询价，对外价等于表上价；对不上的那一格是偏差清单里的低一档", async () => {
  const c = await api.tenantWithAdmin(m.root, "丙车队", "admin@price-import-c.test");
  const outcome = await run(c.tenantId, "JP-LIVE", true);
  assert.equal(outcome.mode, "applied", JSON.stringify(outcome.blockers));
  const product = (await batchRows(c.tenantId, "JP-LIVE")).products[0].id as string;
  // 以下是业主核对后自己在后台做的事（工具从不上架）
  const current = await tenantCall(c, "GET", `/products/${product}`);
  const saved = await tenantCall(c, "PUT", `/products/${product}/service-rules`, { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { pickup: { mode: "limited", minutes: 90 }, dropoff: { mode: "limited", minutes: 15 } } }, current.version);
  const content = await tenantCall(c, "PUT", `/products/${product}/content`, { zh: { title: "虚构接送", pickup_guide: "到达大厅" } }, saved.version);
  await tenantCall(c, "PATCH", `/products/${product}`, { dispatchers: [{ name: "调度", phone: "0312345678" }] }, content.version);
  await tenantCall(c, "POST", `/products/${product}/publish`);

  const creds = await salesCredentials(api, m, channelId);
  const ask = async (dropoff: { lng: number; lat: number }, direction: "pickup" | "dropoff", vehicleGroupId: string): Promise<{ sell: number; productId: string }> => {
    api.clock.advance(1_000);
    const location = direction === "pickup" ? { dropoff } : { pickup: dropoff };
    const res = await ok(api.call("POST", "/sales/v1/quotes", { token: creds.token, body: { city_id: m.ids.tokyo, category: "airport_transfer", place_id: m.ids.narita, direction, ...location, service_time: "2026-11-10T10:00:00+09:00", passengers: 2, luggage: 1, currency: "JPY", vehicle_group_ids: [vehicleGroupId] } }));
    const row = (await api.db.owner.query("select sell_minor, product_id from quotes where id = $1", [res.quotes[0].quote_id])).rows[0];
    return { sell: Number(row.sell_minor), productId: row.product_id };
  };
  // 甲地区：经济 4 座通用 9,900（市场里另一家是 12,000 结算价，对外价更高，比价时这一家中标）
  assert.deepEqual(await ask({ lng: 139.7, lat: 35.6 }, "pickup", m.ids.eco4), { sell: 9_900, productId: product });
  assert.deepEqual(await ask({ lng: 139.7, lat: 35.6 }, "dropoff", m.ids.eco4), { sell: 9_900, productId: product });
  // 乙地区：表上 9,950，渠道向上取整到 100，对不上，显示 9,900（偏差清单里的那一格）
  assert.deepEqual(await ask({ lng: 139.6, lat: 35.45 }, "pickup", m.ids.eco4), { sell: 9_900, productId: product });
});
