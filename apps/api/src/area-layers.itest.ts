/**
 * M9P-13（ADR 0093 第一节、第七节「后续」；规格第四节第 3 小节；#247 审查建议），经真实接口、真实 PostgreSQL：
 * - `GET /tenant/v1/area-layers`：每个商品的三层区域（①服务区域、②行程加价、③上下车加价的区域），和定义一致；
 * - 区域页改图形（`PUT /tenant/v1/areas/{id}`）：用到它的包车商品里新出现的三层重叠（①∩③、同层）只提醒、不拦保存，应答带 `charter_layer_overlaps`；
 *   图形没变、没有重叠时不带（应答和以前一样）；
 * - 上架检查多一项 `charter_layer_overlap`（提醒、不拦上架），写出区域名和面积；
 * - 租户隔离：甲看不到乙的商品和区域层，改不了乙的区域；`tenant_id` 不能从参数带进来。
 * 测试数据全在本文件里经接口建出来，随测试 schema 一起删除（规则 1）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ApiResponse, HttpMethod, TenantFixture, TestApi } from "./testing/api.ts";
import { createTestApi } from "./testing/api.ts";
import { type Market, buildMarket, ok } from "./testing/market.ts";
import { tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";

let api: TestApi;
let m: Market;

const square = (west: number, south: number, east: number, north: number) => ({ type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] });

async function tenantCall(who: TenantFixture, method: HttpMethod, path: string, options: { body?: unknown; version?: number } = {}): Promise<ApiResponse> {
  const token = await tenantLogin(api, who.adminEmail);
  api.clock.advance(1_000);
  return api.call(method, `/tenant/v1${path}`, {
    token,
    ...(options.body === undefined ? {} : { body: options.body }),
    headers: { ...(options.version === undefined ? {} : { "if-match": `"${options.version}"` }), ...(method === "POST" && /^\/(products|brands|areas)$|\/price-rules(\/batch)?$/.test(path) ? { "idempotency-key": randomUUID() } : {}) },
  });
}
const area = async (who: TenantFixture, name: string, polygon: ReturnType<typeof square>): Promise<string> => (await ok(tenantCall(who, "POST", "/areas", { body: { city_id: m.ids.tokyo, name: { zh: name }, biz_type: "charter", polygons: [{ kind: "operate", geometry: polygon }] } }), 201)).id;
const reshape = async (who: TenantFixture, id: string, polygon: ReturnType<typeof square>, name?: string): Promise<ApiResponse> => {
  const current = await ok(tenantCall(who, "GET", `/areas/${id}`));
  return tenantCall(who, "PUT", `/areas/${id}`, { version: current.version, body: { name: name === undefined ? current.name : { zh: name }, biz_type: current.biz_type, polygons: [{ kind: "operate", geometry: polygon }] } });
};

const TOKYO = square(139.55, 35.52, 139.95, 35.85);
const FUJI = square(138.6, 35.4, 138.95, 35.6);
/** 富士山改大到东京市内（重叠 139.55–139.7 × 35.52–35.6） */
const FUJI_INTO_TOKYO = square(138.6, 35.4, 139.7, 35.6);
const LAKE = square(138.74, 35.48, 138.8, 35.52);
const LAKE_2 = square(138.85, 35.45, 138.9, 35.5);

let product: string;
let tokyo: string;
let fuji: string;
let lake: string;
let lake2: string;

before(async () => {
  api = await createTestApi();
  m = await buildMarket(api);
  tokyo = await area(m.b, "东京市内", TOKYO);
  fuji = await area(m.b, "富士山", FUJI);
  lake = await area(m.b, "河口湖", LAKE);
  lake2 = await area(m.b, "西湖", LAKE_2);
  const brand = (await ok(tenantCall(m.b, "POST", "/brands", { body: { name: `包车-${randomUUID().slice(0, 6)}`, currency: "JPY" } }), 201)).id;
  const created = await ok(tenantCall(m.b, "POST", "/products", { body: { brand_id: brand, city_id: m.ids.tokyo, category: "charter", areas: [{ area_id: tokyo }], vehicle_groups: [{ vehicle_group_id: m.ids.biz7, passengers: 6, luggage: 4 }], dispatchers: [{ name: "调度", phone: "0312345678" }] } }), 201);
  const rules = await ok(tenantCall(m.b, "PUT", `/products/${created.id}/service-rules`, { version: 1, body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { general: { mode: "limited", minutes: 0 } } } }));
  const content = await ok(tenantCall(m.b, "PUT", `/products/${created.id}/content`, { version: rules.version, body: { zh: { title: "东京包车" } } }));
  await ok(
    tenantCall(m.b, "POST", `/products/${created.id}/price-rules/batch`, {
      version: content.version,
      body: {
        create: [
          { area_id: tokyo, vehicle_group_id: m.ids.biz7, package_hours: 10, pricing_model: "charter_package", package_km: 300, package_price: 55_000, overtime_per_hour: 6_000, over_km_per_km: 500, valid_from: "2026-01-01" },
          { area_id: fuji, vehicle_group_id: m.ids.biz7, package_hours: 10, pricing_model: "charter_area_surcharge", pickup_surcharge: 10_000, dropoff_surcharge: 10_000, valid_from: "2026-01-01" },
        ],
      },
    }),
  );
  // ②行程区域：只有迁移过三层的商品能经接口建，这里直接写库（和迁移脚本写的一样）
  await api.db.owner.query("update products set charter_layout = 'three_layer' where id = $1", [created.id]);
  for (const id of [lake, lake2]) {
    await api.db.owner.query(
      `insert into price_rules (tenant_id, product_id, area_id, vehicle_group_id, package_hours, pricing_model, params, valid_from, status, created_at, updated_at)
       values ($1, $2, $3, $4, null, 'charter_itinerary_surcharge', '{"surchargeMinor": 2000}', '2026-01-01', 'enabled', now(), now())`,
      [m.b.tenantId, created.id, id, m.ids.biz7],
    );
  }
  product = created.id;
});
after(async () => {
  await api.close();
});

test("GET /tenant/v1/area-layers：每个商品的①②③区域，和定义一致；没有区域的商品不列", async () => {
  const res = await tenantCall(m.b, "GET", "/area-layers");
  assertMatchesOpenApi("GET", "/tenant/v1/area-layers", res);
  assert.equal(res.status, 200, res.text);
  const mine = res.body.items.find((item: any) => item.product_id === product);
  assert.ok(mine, res.text);
  assert.equal(mine.category, "charter");
  assert.equal(mine.charter_layout, "three_layer");
  assert.deepEqual(mine.title, { zh: "东京包车" });
  assert.deepEqual(mine.base, [tokyo]);
  assert.deepEqual([...mine.itinerary].sort(), [lake, lake2].sort());
  assert.deepEqual(mine.pickup_dropoff, [fuji]);
  for (const item of res.body.items) assert.ok(item.base.length + item.itinerary.length + item.pickup_dropoff.length > 0);
});

test("租户隔离：甲看不到乙的商品；甲改不了乙的区域（404）；tenant_id 不能从参数带进来", async () => {
  const theirs = await ok(tenantCall(m.a, "GET", "/area-layers"));
  assert.ok(!theirs.items.some((item: any) => item.product_id === product), "甲看不到乙的商品");
  assert.ok(!theirs.items.some((item: any) => [...item.base, ...item.itinerary, ...item.pickup_dropoff].some((id: string) => [tokyo, fuji, lake, lake2].includes(id))), "甲看不到乙的区域");
  const forged = await tenantCall(m.a, "GET", `/area-layers?tenant_id=${m.b.tenantId}`);
  assert.equal(forged.status, 400, forged.text);
  const target = await ok(tenantCall(m.b, "GET", `/areas/${fuji}`));
  const cross = await tenantCall(m.a, "PUT", `/areas/${fuji}`, { version: target.version, body: { name: target.name, biz_type: target.biz_type, polygons: [{ kind: "operate", geometry: FUJI_INTO_TOKYO }] } });
  assert.equal(cross.status, 404, cross.text);
  assert.equal((await ok(tenantCall(m.b, "GET", `/areas/${fuji}`))).version, target.version, "乙的区域没变");
});

test("区域页改图形造出①∩③重叠：照常保存（只提醒），应答带 charter_layer_overlaps——商品、另一个区域、面积；上架检查多一项提醒、不拦上架", async () => {
  const res = await reshape(m.b, fuji, FUJI_INTO_TOKYO);
  assertMatchesOpenApi("PUT", "/tenant/v1/areas/{id}", res);
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(
    res.body.charter_layer_overlaps.map((entry: any) => [entry.product_id, entry.product_code.length > 0, entry.product_title.zh, entry.code, entry.layer, entry.other_area_id, entry.other_area_name.zh]),
    [[product, true, "东京包车", "AREA_BASE_SURCHARGE_OVERLAP", "base_pickup_dropoff", tokyo, "东京市内"]],
  );
  // 0.15° × 0.08°，北纬约 35.56°：约 121 平方公里
  const km2 = res.body.charter_layer_overlaps[0].overlap_km2;
  assert.ok(km2 > 110 && km2 < 135, String(km2));
  // 真的保存了
  assert.deepEqual((await ok(tenantCall(m.b, "GET", `/areas/${fuji}`))).polygons[0].geometry.coordinates, FUJI_INTO_TOKYO.coordinates);

  const check = await tenantCall(m.b, "GET", `/products/${product}/publish-check`);
  assertMatchesOpenApi("GET", "/tenant/v1/products/{id}/publish-check", check);
  const item = check.body.items.find((entry: any) => entry.key === "charter_layer_overlap");
  assert.ok(item !== undefined && item.required === false && item.passed === false, JSON.stringify(check.body.items));
  assert.deepEqual(item.issues.map((issue: any) => [issue.path, issue.reason, issue.detail.area_a, issue.detail.area_b]), [[`/base_pickup_dropoff/${tokyo}/${fuji}`, "CHARTER_LAYER_OVERLAP", tokyo, fuji]]);
  assert.match(item.issues[0].message, /基础价区域「东京市内」和上下车加价的区域「富士山」重叠约 1\d\d(\.\d+)? 平方公里/);
});

test("同层（②②）重叠同样提醒；只改名字（图形没变）不带 charter_layer_overlaps；改回不重叠时也不带、上架检查这一项消失", async () => {
  const sameLayer = await reshape(m.b, lake2, square(138.78, 35.45, 138.9, 35.5));
  assert.equal(sameLayer.status, 200, sameLayer.text);
  assert.deepEqual(sameLayer.body.charter_layer_overlaps.map((entry: any) => [entry.code, entry.layer, entry.other_area_id]), [["AREA_LAYER_OVERLAP", "itinerary", lake]]);

  const current = await ok(tenantCall(m.b, "GET", `/areas/${fuji}`));
  const renamed = await tenantCall(m.b, "PUT", `/areas/${fuji}`, { version: current.version, body: { name: { zh: "富士山周边" }, biz_type: current.biz_type, polygons: current.polygons } });
  assertMatchesOpenApi("PUT", "/tenant/v1/areas/{id}", renamed);
  assert.equal(renamed.status, 200, renamed.text);
  assert.ok(!("charter_layer_overlaps" in renamed.body), "图形没变不带");

  const back = await reshape(m.b, fuji, FUJI);
  assert.equal(back.status, 200, back.text);
  assertMatchesOpenApi("PUT", "/tenant/v1/areas/{id}", back);
  assert.ok(!("charter_layer_overlaps" in back.body), "没有重叠时应答和以前一样");
  assert.ok(!("charter_layer_overlaps" in (await reshape(m.b, lake2, LAKE_2)).body));
  const check = await ok(tenantCall(m.b, "GET", `/products/${product}/publish-check`));
  assert.ok(!check.items.some((entry: any) => entry.key === "charter_layer_overlap"), JSON.stringify(check.items));
});

test("没有包车商品用到的区域改图形（和东京市内重叠也一样）：不带 charter_layer_overlaps", async () => {
  const lonely = await area(m.b, "没人用的区域", square(139.0, 35.0, 139.1, 35.1));
  const res = await reshape(m.b, lonely, square(139.0, 35.0, 139.7, 35.6));
  assert.equal(res.status, 200, res.text);
  assert.ok(!("charter_layer_overlaps" in res.body));
});
