/**
 * M9P-06（ADR 0093 第二、七节；业主规格 docs/requirements/charter-pricing-spec-2026-11-14.md 第四节、第六节用例 9、14、15），经真实接口、真实 PostgreSQL：
 * - 基础价区域优先（用例 9）：上车点在①∩③（羽田∩横滨这种）时上车加价是 0，经停在①∩③时不加；①外照收；
 * - 保存校验（用例 14、15）：同一商品同层不重叠（③③、②②、①①）→ AREA_LAYER_OVERLAP；①和③不重叠 → AREA_BASE_SURCHARGE_OVERLAP；
 *   同一区域不能既是①又设③ → AREA_IS_PRODUCT_AREA（两个方向都拦）；①②可以重叠；只有边界接触不算；已有的重叠不回头拦（改别的价格照常保存）；
 * - 上架检查：热门地标覆盖（places.charter_coverage，运营在平台地点接口勾）、加价表空格，都只提醒不拦。
 * 测试数据全在本文件里经接口建出来，随测试 schema 一起删除（规则 1）。
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
let pay: FakePaymentProvider;
let site: SiteApi;

const square = (west: number, south: number, east: number, north: number) => ({ type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] });
const P = {
  shinjuku: { lng: 139.7, lat: 35.69 },
  /** 东京市内∩横滨（羽田那种重叠处） */
  haneda: { lng: 139.78, lat: 35.55 },
  asakusa: { lng: 139.7967, lat: 35.7148 },
  yokohama: { lng: 139.63, lat: 35.45 },
  kawaguchiko: { lng: 138.75, lat: 35.516 },
} satisfies Record<string, LatLng>;
type Place = keyof typeof P;
let ipSeq = 0;
const nextIp = (): string => `10.96.${(ipSeq += 1)}.9`;
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
const version = async (productId: string): Promise<number> => (await ok(tenantCall(m.b, "GET", `/products/${productId}`))).version;
const batch = async (productId: string, body: Record<string, unknown>): Promise<ApiResponse> => tenantCall(m.b, "POST", `/products/${productId}/price-rules/batch`, { version: await version(productId), body: { create: [], update: [], delete: [], ...body } });
const area = async (name: string, polygon: ReturnType<typeof square>): Promise<string> => (await ok(tenantCall(m.b, "POST", "/areas", { body: { city_id: m.ids.tokyo, name: { zh: name }, biz_type: "charter", polygons: [{ kind: "operate", geometry: polygon }] } }), 201)).id;
const pkg = (areaId: string, price: number) => ({ area_id: areaId, vehicle_group_id: m.ids.biz7, package_hours: 10, pricing_model: "charter_package", package_km: 300, package_price: price, overtime_per_hour: 6_000, over_km_per_km: 500, valid_from: "2026-01-01" });
const updown = (areaId: string, amount: number, waypoint?: number) => ({ area_id: areaId, vehicle_group_id: m.ids.biz7, package_hours: 10, pricing_model: "charter_area_surcharge", pickup_surcharge: amount, dropoff_surcharge: amount, ...(waypoint === undefined ? {} : { waypoint_surcharge: waypoint }), valid_from: "2026-01-01" });

interface Charter {
  id: string;
  tokyo: string;
  yokohama: string;
  fuji: string;
}
let charter: Charter;
/** 和富士山重叠的「富士北」；只碰到东京市内边界的「边界区」；和东京市内重叠的「东京北」 */
let fujiNorth: string;
let touching: string;
let bigYokohama: string;

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay, quote: { routes: { estimate: routeLookup } } });
  m = await buildMarket(api);
  // 东京市内和横滨在羽田一带重叠（这是旧配置：横滨的③在迁移前已经存在，校验不回头拦）
  const tokyo = await area("东京市内", square(139.55, 35.52, 139.95, 35.85));
  const yokohama = await area("横滨", square(139.5, 35.3, 139.85, 35.58));
  const fuji = await area("富士山", square(138.6, 35.4, 138.95, 35.6));
  fujiNorth = await area("富士北", square(138.7, 35.55, 138.95, 35.7));
  touching = await area("边界区", square(139.95, 35.6, 140.1, 35.8));
  bigYokohama = await area("东京北", square(139.6, 35.8, 139.9, 35.95));
  const brand = (await ok(tenantCall(m.b, "POST", "/brands", { body: { name: `包车-${randomUUID().slice(0, 6)}`, currency: "JPY" } }), 201)).id;
  const created = await ok(tenantCall(m.b, "POST", "/products", { body: { brand_id: brand, city_id: m.ids.tokyo, category: "charter", areas: [{ area_id: tokyo }], vehicle_groups: [{ vehicle_group_id: m.ids.biz7, passengers: 6, luggage: 4 }], dispatchers: [{ name: "调度", phone: "0312345678" }] } }), 201);
  const rules = await ok(tenantCall(m.b, "PUT", `/products/${created.id}/service-rules`, { version: 1, body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { general: { mode: "limited", minutes: 0 } } } }));
  const content = await ok(tenantCall(m.b, "PUT", `/products/${created.id}/content`, { version: rules.version, body: { zh: { title: "东京包车" } } }));
  await ok(tenantCall(m.b, "POST", `/products/${created.id}/price-rules/batch`, { version: content.version, body: { create: [pkg(tokyo, 55_000), updown(fuji, 10_000, 10_000)] } }));
  // 旧配置：横滨的③和东京市内重叠——直接写库（M9P-06 之前的数据，现在经接口建不出来）
  await api.db.owner.query(
    `insert into price_rules (tenant_id, product_id, area_id, vehicle_group_id, package_hours, pricing_model, params, valid_from, status, created_at, updated_at)
     values ($1, $2, $3, $4, 10, 'charter_area_surcharge', '{"pickupSurchargeMinor": 3000, "dropoffSurchargeMinor": 3000, "waypointSurchargeMinor": 3000}', '2026-01-01', 'enabled', now(), now())`,
    [m.b.tenantId, created.id, yokohama, m.ids.biz7],
  );
  await ok(tenantCall(m.b, "POST", `/products/${created.id}/publish`));
  charter = { id: created.id, tokyo, yokohama, fuji };
  const channel = await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" });
  site = await siteApi(api, (await salesCredentials(api, m, channel.id)).clientId, pay, {}, { quote: { routes: { estimate: routeLookup } } });
  api.clock.advance(31_000);
});
after(async () => {
  await site?.close();
  await api.close();
});

async function settle(pickup: Place, stops: Place[], dropoff: Place): Promise<string> {
  api.clock.advance(31_000);
  const waypoints = stops.map((place, index) => ({ name: `景点 ${index + 1}`, lat: P[place].lat, lng: P[place].lng, stay_minutes: 30 }));
  const res = await site.call("POST", "/site/v1/quotes", { body: { category: "charter", city_id: m.ids.tokyo, pickup: P[pickup], dropoff: P[dropoff], ...(waypoints.length === 0 ? {} : { waypoints }), package_hours: 10, service_local: "2026-10-20T10:00", passengers: 2, luggage: 1 }, ip: nextIp() });
  assertMatchesOpenApi("POST", "/site/v1/quotes", res);
  assert.equal(res.status, 200, res.text);
  return res.body.quotes.map((entry: any) => entry.price.total.amount).join(",") || res.body.unavailable.flatMap((entry: any) => entry.reasons).join(",");
}

test("用例 9：上车点在基础价区域∩上下车加价区域（羽田∩横滨）→ 上车加价 0；经停在那里也不加；①外（横滨南部）照收", async () => {
  assert.equal(await settle("haneda", [], "shinjuku"), "60500", "55,000 × 1.1，M9P-06 之前收横滨 3,000（63,800）");
  assert.equal(await settle("shinjuku", ["haneda"], "shinjuku"), "60500", "市内经停不加价");
  assert.equal(await settle("haneda", ["asakusa"], "shinjuku"), "60500", "规格用例 9 原样：羽田上车 → 浅草经停 → 新宿下车，加价 0");
  assert.equal(await settle("yokohama", [], "shinjuku"), String(Math.round(58_000 * 1.1)), "横滨南部不在①里：上车 3,000");
  assert.equal(await settle("shinjuku", ["kawaguchiko"], "shinjuku"), String(Math.round(65_000 * 1.1)), "①外经停照收");
});

test("用例 14：同一商品同层的区域不能重叠——新加的③和已有的③重叠 → 400 AREA_LAYER_OVERLAP（带两个区域名和面积），什么都不写；只碰到边界的不算", async () => {
  const res = await batch(charter.id, { create: [updown(fujiNorth, 2_000, 2_000)] });
  assert.equal(res.status, 400, res.text);
  assert.equal(res.body.error.code, "AREA_LAYER_OVERLAP");
  assert.equal(res.body.error.details.layer, "pickup_dropoff");
  assert.deepEqual([...res.body.error.details.areas].sort(), ["富士北", "富士山"].sort());
  assert.ok(res.body.error.details.overlap_km2 > 0);
  assert.match(res.body.error.message, /富士北/);
  assert.equal((await ok(tenantCall(m.b, "GET", `/products/${charter.id}/price-rules`))).items.length, 3, "没写");
  // 「边界区」只和东京市内碰边（面积 0）：不算重叠，能设上下车加价
  assert.equal((await batch(charter.id, { create: [updown(touching, 1_000)] })).status, 200);
});

test("用例 15：基础价区域和上下车加价区域不能重叠（AREA_BASE_SURCHARGE_OVERLAP）；同一区域不能既是基础价区域又设上下车加价（两个方向都拦）", async () => {
  // 新的③（东京北）和①（东京市内）重叠
  const overlap = await batch(charter.id, { create: [updown(bigYokohama, 3_000)] });
  assert.equal(overlap.status, 400, overlap.text);
  assert.equal(overlap.body.error.code, "AREA_BASE_SURCHARGE_OVERLAP");
  assert.deepEqual(overlap.body.error.details.areas, ["东京市内", "东京北"]);
  // ③就选①本身
  const same = await batch(charter.id, { create: [updown(charter.tokyo, 3_000)] });
  assert.equal(same.status, 400, same.text);
  assert.match(same.text, /AREA_IS_PRODUCT_AREA/);
  assert.match(same.text, /基础价区域（服务区域），在这里上下车不加价，不能再设上下车加价/);
  // 反方向：把有③的富士山加成服务区域
  const detail = await ok(tenantCall(m.b, "GET", `/products/${charter.id}`));
  const asBase = await tenantCall(m.b, "PATCH", `/products/${charter.id}`, { version: detail.version, body: { areas: [{ area_id: charter.tokyo }, { area_id: charter.fuji }] } });
  assert.equal(asBase.status, 400, asBase.text);
  assert.match(asBase.text, /AREA_IS_PRODUCT_AREA/);
  // 新的①（东京北）和①（东京市内）重叠 → 同层
  const twoBase = await tenantCall(m.b, "PATCH", `/products/${charter.id}`, { version: detail.version, body: { areas: [{ area_id: charter.tokyo }, { area_id: bigYokohama }] } });
  assert.equal(twoBase.status, 400, twoBase.text);
  assert.equal(twoBase.body.error.code, "AREA_LAYER_OVERLAP");
  assert.equal(twoBase.body.error.details.layer, "base");
  assert.equal((await ok(tenantCall(m.b, "GET", `/products/${charter.id}`))).version, detail.version, "没改");
});

test("已有的重叠不回头拦：横滨的③（旧配置，和东京市内重叠）照常能改金额；改别的价格照常保存", async () => {
  const items = (await ok(tenantCall(m.b, "GET", `/products/${charter.id}/price-rules`))).items;
  const yokohama = items.find((item: any) => item.area_id === charter.yokohama);
  const { waypoint_surcharge: _w, ...rest } = updown(charter.yokohama, 3_500);
  assert.equal((await batch(charter.id, { update: [{ id: yokohama.id, ...rest }] })).status, 200);
  const fuji = items.find((item: any) => item.area_id === charter.fuji);
  const { waypoint_surcharge: _f, ...fujiRest } = updown(charter.fuji, 11_000);
  assert.equal((await batch(charter.id, { update: [{ id: fuji.id, ...fujiRest }] })).status, 200);
});

test("已有的重叠不回头拦（商品基础信息）：旧配置里①①（东京市内∩东京北）、①③（东京市内∩横滨）都重叠——服务区域原样保存、只调先后、改车型组和调度人都照常 200", async () => {
  // 旧配置：东京北当第二个服务区域，直接写库（现在经接口加不进来，用例 15）
  await api.db.owner.query("insert into product_areas (tenant_id, product_id, area_id, priority) values ($1, $2, $3, 1)", [m.b.tenantId, charter.id, bigYokohama]);
  try {
    const patch = async (body: Record<string, unknown>): Promise<ApiResponse> => tenantCall(m.b, "PATCH", `/products/${charter.id}`, { version: (await ok(tenantCall(m.b, "GET", `/products/${charter.id}`))).version, body });
    for (const body of [
      { areas: [{ area_id: charter.tokyo }, { area_id: bigYokohama }] },
      { areas: [{ area_id: bigYokohama }, { area_id: charter.tokyo }] },
      { vehicle_groups: [{ vehicle_group_id: m.ids.biz7, passengers: 6, luggage: 4 }, { vehicle_group_id: m.ids.eco4, passengers: 3, luggage: 2 }] },
      { dispatchers: [{ name: "调度二号", phone: "0312345679" }] },
    ]) {
      const res = await patch(body);
      assert.equal(res.status, 200, `${JSON.stringify(body)}：${res.text}`);
    }
    // 去掉一个服务区域也可以（不新增）
    assert.equal((await patch({ areas: [{ area_id: charter.tokyo }] })).status, 200);
  } finally {
    await api.db.owner.query("delete from product_areas where product_id = $1 and area_id = $2", [charter.id, bigYokohama]);
    // 车型组恢复成只有商务 7 座（后面的上架检查用例从这个状态开始）
    const detail = await ok(tenantCall(m.b, "GET", `/products/${charter.id}`));
    await ok(tenantCall(m.b, "PATCH", `/products/${charter.id}`, { version: detail.version, body: { vehicle_groups: [{ vehicle_group_id: m.ids.biz7, passengers: 6, luggage: 4 }] } }));
  }
});

test("上架检查：热门地标覆盖（运营在平台地点接口勾选）和加价表空格，都只提醒、不拦上架", async () => {
  const root = m.root;
  const poi = (await ok(api.call("POST", "/platform/v1/master/places", { token: root, body: { type: "poi", code: `POI-${String(Date.now()).slice(-6)}`, city_id: m.ids.tokyo, name: { zh: "日光东照宫" }, location: { lng: 139.6, lat: 36.75 }, category: "attraction" } }), 201));
  const covered = (await ok(api.call("POST", "/platform/v1/master/places", { token: root, body: { type: "poi", code: `POI-${String(Date.now() + 1).slice(-6)}`, city_id: m.ids.tokyo, name: { zh: "浅草寺" }, location: { lng: 139.7967, lat: 35.7148 }, category: "attraction" } }), 201));
  for (const place of [poi, covered]) {
    const patched = await api.call("PATCH", `/platform/v1/master/places/${place.id}`, { token: root, headers: { "if-match": `"${place.version}"` }, body: { charter_coverage: true } });
    assertMatchesOpenApi("PATCH", "/platform/v1/master/places/{id}", patched);
    assert.equal(patched.status, 200, patched.text);
    assert.equal(patched.body.charter_coverage, true);
  }
  // 机场不能勾
  const airport = await ok(api.call("GET", `/platform/v1/master/places/${m.ids.narita}`, { token: root }));
  const wrong = await api.call("PATCH", `/platform/v1/master/places/${m.ids.narita}`, { token: root, headers: { "if-match": `"${airport.version}"` }, body: { charter_coverage: true } });
  assert.equal(wrong.status, 400, wrong.text);
  // 加一个车型组：③表里富士山等区域对它是空格
  const detail = await ok(tenantCall(m.b, "GET", `/products/${charter.id}/publish-check`));
  const keys = detail.items.map((item: any) => item.key);
  const coverage = detail.items.find((item: any) => item.key === "charter_coverage");
  assert.ok(coverage !== undefined && coverage.required === false, JSON.stringify(detail.items));
  assert.deepEqual(coverage.issues.map((issue: any) => [issue.path, issue.reason]), [[`/places/${poi.id}`, "CHARTER_POI_NOT_COVERED"]], "日光不在任何区域；浅草寺在东京市内");
  // 带上地标名（M9P-07F）：两个后台都直接写出名字，页面不另取整张地标表
  assert.equal(coverage.issues[0].detail.name, poi.name.zh);
  const platformDetail = await ok(api.call("GET", `/platform/v1/products/${charter.id}`, { token: root }));
  assert.equal(platformDetail.publish_check.items.find((item: any) => item.key === "charter_coverage").issues[0].detail.name, poi.name.zh, "运营后台的商品详情同样带名字");
  assert.ok(!keys.includes("charter_empty_cells"), "现在每个区域都填了 biz7");
  const product = await ok(tenantCall(m.b, "GET", `/products/${charter.id}`));
  const groups = [...product.vehicle_groups.map((group: any) => ({ vehicle_group_id: group.vehicle_group_id, passengers: group.passengers, luggage: group.luggage })), { vehicle_group_id: m.ids.eco4, passengers: 3, luggage: 2 }];
  // 已上架：先下架再加车型组（eco4 没有套餐价，旧表的商品不拦，见 M9P-05）
  await ok(tenantCall(m.b, "POST", `/products/${charter.id}/unpublish`));
  await ok(tenantCall(m.b, "PATCH", `/products/${charter.id}`, { version: (await ok(tenantCall(m.b, "GET", `/products/${charter.id}`))).version, body: { vehicle_groups: groups } }));
  const after = await tenantCall(m.b, "GET", `/products/${charter.id}/publish-check`);
  assertMatchesOpenApi("GET", "/tenant/v1/products/{id}/publish-check", after);
  const empty = after.body.items.find((item: any) => item.key === "charter_empty_cells");
  assert.ok(empty !== undefined && empty.required === false);
  assert.ok(empty.issues.length >= 3 && empty.issues.every((issue: any) => issue.reason === "CHARTER_EMPTY_CELL" && /^\/pickup_dropoff\/[0-9a-f-]+\/vehicle_groups\/1$/.test(issue.path)), JSON.stringify(empty.issues));
  // 提醒不拦上架
  assert.equal((await tenantCall(m.b, "POST", `/products/${charter.id}/publish`)).status, 200);
});
