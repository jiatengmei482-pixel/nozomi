/**
 * 报价的基准（M2-01，ADR 0020）：需求是单次报价 P95 ≤ 300 ms，容量按 100 个租户设计。
 * 这里摆 300 个供应商（每个 1 个已上架的接送机商品、3 个区域共 6 块图形、2 个车型组、18 条价格、5 条调价规则），
 * 对同一次用车请求比价，量两种情况：现取现算（不用缓存，试算接口就是这样），和目录已经在缓存里（正式询价的常态）。
 * 第一个供应商经真实接口配置，其余 299 个用迁移账号照着它复制（只在这个测试的库里，结束时连同 schema 一起删除）。
 *
 * 每次运行都验结果对不对、缓存确实只取了一次数，并把量到的耗时记在测试的诊断信息里；**耗时本身默认不断言**——集成测试是几十个文件同时跑的，
 * 量出来的数取决于机器当时有多忙，拿它断言会让 CI 时好时坏。要按需求的 P95 ≤ 300 ms 断言时单独跑这一个文件并打开开关：
 * `QUOTE_BENCH_ASSERT=1 node --env-file-if-exists=.env --test apps/api/src/quotes-benchmark.itest.ts`
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AppContext } from "./context.ts";
import type { QuoteCandidate } from "./repos/quotes.ts";
import { QuoteCatalogCache } from "./services/quote-catalog.ts";
import { defaultQuoteDeps } from "./services/quote-deps.ts";
import { previewPlatformQuote } from "./services/quotes.ts";
import { type ApiResponse, type HttpMethod, type TenantFixture, type TestApi, createTestApi } from "./testing/api.ts";
import { testConfig } from "./testing/fixtures.ts";

let api: TestApi;
let root: string;
let first: TenantFixture;
const ids: Record<string, string> = {};
const SUPPLIERS = 300;
/** 需求：单次报价 P95 ≤ 300 ms（正式询价，目录在缓存里）。只在显式打开开关时断言。 */
const REQUIRED_P95_MS = 300;
const ASSERT_TIMING = process.env["QUOTE_BENCH_ASSERT"] === "1";

/** 数一数真正去库里取了几次目录。 */
class CountingCatalog extends QuoteCatalogCache<QuoteCandidate[]> {
  loads = 0;
  override get(key: string, load: () => Promise<QuoteCandidate[]>, options: { fresh?: boolean } = {}): Promise<QuoteCandidate[]> {
    return super.get(
      key,
      () => {
        this.loads += 1;
        return load();
      },
      options,
    );
  }
}

const platform = (method: HttpMethod, path: string, body?: unknown): Promise<ApiResponse> => api.call(method, `/platform/v1${path}`, { token: root, ...(body === undefined ? {} : { body }) });
const call = (method: HttpMethod, path: string, options: { body?: unknown; version?: number } = {}): Promise<ApiResponse> =>
  api.call(method, `/tenant/v1${path}`, {
    token: first.adminToken,
    ...(options.body === undefined ? {} : { body: options.body }),
    headers: { ...(options.version === undefined ? {} : { "if-match": `"${options.version}"` }), ...(method === "POST" ? { "idempotency-key": randomUUID() } : {}) },
  });
async function ok(res: Promise<ApiResponse>, status = 200): Promise<any> {
  const done = await res;
  assert.equal(done.status, status, done.text);
  return done.body;
}

/** 一块 60 个顶点的营运区（近似圆），和它里面一小块禁行区。 */
function polygons(lng: number, lat: number): unknown[] {
  const ring = Array.from({ length: 60 }, (_, index) => {
    const angle = (index / 60) * 2 * Math.PI;
    return [Number((lng + 0.3 * Math.cos(angle)).toFixed(6)), Number((lat + 0.3 * Math.sin(angle)).toFixed(6))];
  });
  const hole = [[lng + 0.2, lat + 0.2], [lng + 0.22, lat + 0.2], [lng + 0.22, lat + 0.22], [lng + 0.2, lat + 0.22], [lng + 0.2, lat + 0.2]];
  return [{ kind: "operate", geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] } }, { kind: "forbid", geometry: { type: "Polygon", coordinates: [hole] } }];
}

before(async () => {
  api = await createTestApi();
  root = await api.superAdminToken();
  first = await api.tenantWithAdmin(root, "基准车队 0", "admin@bench.test");
  ids["tokyo"] = (await ok(platform("POST", "/master/cities", { country_code: "JP", timezone: "Asia/Tokyo", code: "CTY-JP-TYO", name: { zh: "东京" }, center: { lng: 139.6917, lat: 35.6895 } }), 201)).id;
  ids["narita"] = (await ok(platform("POST", "/master/places", { location: { lng: 140.3887, lat: 35.7686 }, type: "airport", code: "NRT", city_id: ids["tokyo"], name: { zh: "成田机场" }, flight_scope: "international" }), 201)).id;
  ids["biz7"] = (await ok(platform("POST", "/master/vehicle-groups", { grade: "business", seats: 7, power: "fuel", combos: [{ passengers: 6, luggage: 4 }], code: "VG-BIZ-7", name: { zh: "商务 7 座" } }), 201)).id;
  ids["eco4"] = (await ok(platform("POST", "/master/vehicle-groups", { grade: "economy", seats: 4, power: "fuel", combos: [{ passengers: 3, luggage: 2 }], code: "VG-ECO-4", name: { zh: "经济 4 座" } }), 201)).id;
  const brand = (await ok(call("POST", "/brands", { body: { name: "基准 JP", currency: "JPY" } }), 201)).id;
  const areas: string[] = [];
  for (const [index, lng] of [139.4, 139.7, 140.0].entries()) {
    api.clock.advance(1_000);
    areas.push((await ok(call("POST", "/areas", { body: { city_id: ids["tokyo"], name: { zh: `基准区域 ${index}` }, biz_type: "general", polygons: polygons(lng, 35.6) } }), 201)).id);
  }
  const product = await ok(
    call("POST", "/products", {
      body: { brand_id: brand, city_id: ids["tokyo"], category: "airport_transfer", poi_id: ids["narita"], areas: areas.map((area_id) => ({ area_id })), vehicle_groups: [{ vehicle_group_id: ids["biz7"], passengers: 6, luggage: 4 }, { vehicle_group_id: ids["eco4"], passengers: 3, luggage: 2 }], dispatchers: [{ name: "调度", phone: "0312345678" }] },
    }),
    201,
  );
  ids["product"] = product.id;
  const rules = await ok(call("PUT", `/products/${product.id}/service-rules`, { version: 1, body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, urgent: { enabled: true, tiers: [{ within_hours: 12, surcharge: 2_000 }] }, night: { enabled: true, window: { start: "22:00", end: "06:00" }, amount: 3_000, charge_unit: "per_order" }, free_wait: { pickup: { mode: "limited", minutes: 90 }, dropoff: { mode: "limited", minutes: 15 } } } }));
  await ok(call("PUT", `/products/${product.id}/content`, { version: rules.version, body: { zh: { title: "基准商品", pickup_guide: "到达大厅" } } }));
  // 18 条价格：3 个区域 × 2 个车型组 × 3 段生效日期
  const create = areas.flatMap((area_id, areaIndex) =>
    [ids["biz7"], ids["eco4"]].flatMap((vehicle_group_id, groupIndex) =>
      [["2026-01-01", "2026-06-30"], ["2026-07-01", "2026-12-31"], ["2027-01-01", null]].map(([valid_from, valid_to], period) => ({ area_id, vehicle_group_id, direction: "both", pricing_model: "fixed", base_price: 20_000 + areaIndex * 500 - groupIndex * 6_000 + period * 100, valid_from, valid_to })),
    ),
  );
  const saved = await ok(call("POST", `/products/${product.id}/price-rules/batch`, { version: 3, body: { create } }));
  let version: number = saved.version;
  for (const [index, body] of [
    { name: "周末", cycle: { type: "weekly", weekdays: [6, 7] }, steps: [{ type: "percent", value: 1_000 }] },
    { name: "深夜", cycle: { type: "daily" }, time_slot: { start: "23:00", end: "05:00" }, steps: [{ type: "amount", value: 1_500 }] },
    { name: "年末", cycle: { type: "daily" }, travel_from: "2026-12-25", travel_to: "2027-01-05", steps: [{ type: "percent", value: 2_000 }, { type: "amount", value: -500 }] },
    { name: "东部", cycle: { type: "daily" }, area_ids: [areas[2]], steps: [{ type: "percent", value: -500 }] },
    { name: "经济车", cycle: { type: "daily" }, vehicle_group_ids: [ids["eco4"]], steps: [{ type: "amount", value: 300 }] },
  ].entries()) {
    version = (await ok(call("POST", `/products/${product.id}/adjust-rules`, { version, body }), 201)).version;
    assert.ok(version > index);
  }
  await ok(call("POST", `/products/${product.id}/publish`));

  // 其余的供应商：照着第一个复制（区域编号换成新的，价格和调价里引用的跟着换），价格各差一点
  await api.db.owner.query(
    `do $$
     declare
       src_tenant uuid := '${first.tenantId}';
       src_product uuid := '${product.id}';
       new_tenant uuid; new_brand uuid; new_product uuid; i integer; src record; new_area uuid;
     begin
       create temp table area_map (old_id uuid primary key, new_id uuid not null) on commit drop;
       for i in 1..${SUPPLIERS - 1} loop
         insert into tenants (name, status) values ('基准车队 ' || i, 'active') returning id into new_tenant;
         insert into brands (tenant_id, name, currency, status, rounding_unit, created_at, updated_at)
           select new_tenant, name, currency, status, rounding_unit, created_at, updated_at from brands where tenant_id = src_tenant returning id into new_brand;
         truncate area_map;
         for src in select * from areas where tenant_id = src_tenant loop
           insert into areas (tenant_id, city_id, name, name_keys, biz_type, status, created_at, updated_at)
             values (new_tenant, src.city_id, src.name, src.name_keys, src.biz_type, src.status, src.created_at, src.updated_at) returning id into new_area;
           insert into area_map values (src.id, new_area);
         end loop;
         insert into area_polygons (tenant_id, area_id, kind, seq, label, position, source, geometry, vertex_count, min_lng, min_lat, max_lng, max_lat)
           select new_tenant, m.new_id, p.kind, p.seq, p.label, p.position, p.source, p.geometry, p.vertex_count, p.min_lng, p.min_lat, p.max_lng, p.max_lat
             from area_polygons p join area_map m on m.old_id = p.area_id where p.tenant_id = src_tenant;
         insert into products (tenant_id, code, brand_id, city_id, category, poi_id, status, service_rules, content, inventory_mode, published_at, created_at, updated_at)
           select new_tenant, 'PRD20261007010000' || lpad((100000 + i)::text, 6, '0'), new_brand, city_id, category, poi_id, status, service_rules, content, inventory_mode, published_at, created_at, updated_at
             from products where id = src_product returning id into new_product;
         insert into product_areas (tenant_id, product_id, area_id, priority)
           select new_tenant, new_product, m.new_id, pa.priority from product_areas pa join area_map m on m.old_id = pa.area_id where pa.product_id = src_product;
         insert into product_vehicle_groups (tenant_id, product_id, vehicle_group_id, passengers, luggage, position)
           select new_tenant, new_product, vehicle_group_id, passengers, luggage, position from product_vehicle_groups where product_id = src_product;
         insert into price_rules (tenant_id, product_id, area_id, vehicle_group_id, direction, package_hours, pricing_model, params, valid_from, valid_to, status, created_at, updated_at)
           select new_tenant, new_product, m.new_id, r.vehicle_group_id, r.direction, r.package_hours, r.pricing_model,
                  jsonb_build_object('basePriceMinor', (r.params ->> 'basePriceMinor')::int + (i % 97) * 10), r.valid_from, r.valid_to, r.status, r.created_at, r.updated_at
             from price_rules r join area_map m on m.old_id = r.area_id where r.product_id = src_product;
         insert into adjust_rules (tenant_id, product_id, name, travel_from, travel_to, cycle, time_slot, area_ids, vehicle_group_ids, directions, package_hours, steps, position, status, created_at, updated_at)
           select new_tenant, new_product, a.name, a.travel_from, a.travel_to, a.cycle, a.time_slot,
                  coalesce((select array_agg(m.new_id) from unnest(a.area_ids) as old(id) join area_map m on m.old_id = old.id), '{}'),
                  a.vehicle_group_ids, a.directions, a.package_hours, a.steps, a.position, a.status, a.created_at, a.updated_at
             from adjust_rules a where a.product_id = src_product;
       end loop;
     end $$`,
  );
});
after(() => api.close());

test(`基准：${SUPPLIERS} 个供应商 × 每个 18 条价格、5 条调价、6 块区域图形——单次比价的耗时（现取现算 / 目录在缓存里），需求是 P95 ≤ 300 ms`, async (t) => {
  const counts = (await api.db.owner.query("select (select count(*)::int from products where status = 'published') as products, (select count(*)::int from price_rules) as prices, (select count(*)::int from adjust_rules) as adjusts, (select count(*)::int from area_polygons) as polygons")).rows[0];
  assert.deepEqual(counts, { products: SUPPLIERS, prices: SUPPLIERS * 18, adjusts: SUPPLIERS * 5, polygons: SUPPLIERS * 6 });
  const body = { city_id: ids["tokyo"], category: "airport_transfer", place_id: ids["narita"], currency: "JPY", direction: "pickup", dropoff: { lng: 139.72, lat: 35.62 }, service_time: "2026-10-24T23:30", passengers: 2, luggage: 1 };
  const run = async (): Promise<[number, any]> => {
    const started = performance.now();
    const res = await platform("POST", "/quotes/preview", body);
    const elapsed = performance.now() - started;
    assert.equal(res.status, 200, res.text);
    return [elapsed, res.body];
  };
  const p = (values: number[], quantile: number): number => Math.round([...values].sort((x, y) => x - y)[Math.min(values.length - 1, Math.ceil(values.length * quantile) - 1)] as number);

  // 结果是对的：每个供应商都报了价，两个车型组各一个中标；这个点在两个区域的营运区里，取便宜的那个
  const [, sample] = await run();
  assert.deepEqual([sample.candidate_count, sample.groups.length, sample.groups.map((group: any) => group.candidates.length), sample.refused.length], [SUPPLIERS, 2, [SUPPLIERS, SUPPLIERS], 0]);
  const best = sample.groups.find((group: any) => group.vehicle_group_id === ids["biz7"]).candidates.find((entry: any) => entry.tenant_name === "基准车队 0").offer.settlement;
  // 周六 23:30。中间的区域：20,600 → 周末 +10% → 深夜 +1,500 = 24,160，加夜间费 3,000 = 27,160；
  // 东边的区域：21,100 → 23,210 → 24,710 → 东部 −5% = 23,474.5，加夜间费 = 26,474.5 → 26,475，更便宜，用它
  assert.deepEqual([best.base, best.total, best.night, best.adjusts.map((entry: any) => entry.name), best.exact.total], [21_100, 26_475, 3_000, ["周末", "深夜", "东部"], "26474.5"]);

  // 现取现算（试算接口：每次都从库里取 300 个商品的规则）
  const fresh: number[] = [];
  for (let round = 0; round < 15; round += 1) fresh.push((await run())[0]);
  // 目录在缓存里（正式询价的常态）：直接调同一个服务函数，不走缓存旁路
  const config = testConfig(api.db.url);
  const catalog = new CountingCatalog({ now: () => api.clock.now().getTime() });
  const ctx: AppContext = { config, pool: api.db.pool, now: api.clock.now, quote: { ...defaultQuoteDeps(config, api.clock.now), catalog } };
  const input = { cityId: ids["tokyo"] as string, category: "airport_transfer" as const, placeId: ids["narita"] as string, currency: "JPY", pickup: null, dropoff: body.dropoff, direction: "pickup" as const, packageHours: null, serviceLocal: body.service_time, passengers: 2, luggage: 1, addons: [], driverLanguage: null, vehicleGroupIds: [], assumeRoute: null };
  await previewPlatformQuote(ctx, input, { fresh: false });
  const cached: number[] = [];
  for (let round = 0; round < 30; round += 1) {
    const started = performance.now();
    const result = await previewPlatformQuote(ctx, input, { fresh: false });
    cached.push(performance.now() - started);
    assert.deepEqual([result.comparison.groups.length, result.comparison.groups.map((group) => group.ranked.length)], [2, [SUPPLIERS, SUPPLIERS]]);
  }
  // 与机器负载无关的事实：31 次询价只去库里取了一次目录
  assert.equal(catalog.loads, 1);
  const report = `现取现算 P50 ${p(fresh, 0.5)} ms / P95 ${p(fresh, 0.95)} ms；目录在缓存里 P50 ${p(cached, 0.5)} ms / P95 ${p(cached, 0.95)} ms（${SUPPLIERS} 个供应商）`;
  t.diagnostic(report);
  if (ASSERT_TIMING) assert.ok(p(cached, 0.95) <= REQUIRED_P95_MS, report);
});
