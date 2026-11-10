/**
 * M8-20：运营区域与报价区域分开（ADR 0075），经真实接口、真实 PostgreSQL。
 * - 区域多「用途」：新建、修改、列表筛选、详情的「超出运营区域」提醒、审计；区域地图带用途和超出面积；
 * - 运营区域不能被商品勾选、不能挂区域加价、不能当线路价的两端（400 `AREA_ROLE_NOT_PRICING`）；有商品勾着时不能改成运营区域（409 `AREA_IN_USE`）；
 * - 改小、停用、删除运营范围让已上架商品的报价区域多出「不在运营区域里」的部分：409 `PRICING_AREA_OUTSIDE_OPERATING`；
 * - 上架检查多一项「运营区域」提醒（不拦上架）；
 * - 报价第 4 步两道判断：运营区域里、但商品没勾报价区域 → `NO_PRICING_AREA`（只在平台内部），给渠道是 `OUT_OF_SERVICE_AREA`；
 *   甲不能把乙的运营区域当自己的运营范围；
 * - 规则 2：乙读不到、改不了甲的区域（含用途）；规则 4：/tenant/v1 的应答里没有对外价和加价比例。
 * 测试数据全在本文件里经接口建出来，随测试 schema 一起删除（规则 1）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ApiResponse, HttpMethod, TenantFixture, TestApi } from "./testing/api.ts";
import { createTestApi } from "./testing/api.ts";
import { type Market, allKeys, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi, assertMatchesOperation } from "./testing/openapi.ts";

let api: TestApi;
let m: Market;
let sales: { token: string };

const square = (west: number, south: number, east: number, north: number) => ({ type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] });
/** 甲、乙的成田接送机商品的区域「东京全域」都是 139–140 × 35–36（运营 + 报价） */
const P = {
  west: { lng: 139.5, lat: 35.5 },
  /** 甲的运营大区里、但甲的商品没勾覆盖它的报价区域 */
  far: { lng: 140.5, lat: 35.5 },
  /** 乙的运营区域里、甲的运营范围外 */
  farther: { lng: 141.7, lat: 35.5 },
  /** 谁的运营区域都不在 */
  nowhere: { lng: 145.5, lat: 35.5 },
};
const RULE4_KEYS = ["sell", "sell_minor", "markup", "markup_bp", "fx_buffer_bp", "channel", "area_surcharge_sell", "over_km_per_km_sell"];

/** 甲的：运营大区、超出运营大区一块的报价区域、完全在里面的报价区域 */
const A: { op: string; partly: string; inside: string } = { op: "", partly: "", inside: "" };

/** 供应商接口（自动带幂等键和 If-Match），不检查状态码 */
async function tenantCall(who: TenantFixture | string, method: HttpMethod, path: string, options: { body?: unknown; version?: number } = {}): Promise<ApiResponse> {
  const token = typeof who === "string" ? who : await tenantLogin(api, who.adminEmail);
  api.clock.advance(1_000);
  return api.call(method, `/tenant/v1${path}`, {
    token,
    ...(options.body === undefined ? {} : { body: options.body }),
    headers: { ...(options.version === undefined ? {} : { "if-match": `"${options.version}"` }), ...(method === "POST" && /^\/(products|brands|areas)$|\/price-rules(\/batch)?$/.test(path) ? { "idempotency-key": randomUUID() } : {}) },
  });
}

async function newArea(who: TenantFixture, name: string, polygon: ReturnType<typeof square>, extra: Record<string, unknown> = {}): Promise<any> {
  return ok(tenantCall(who, "POST", "/areas", { body: { city_id: m.ids.tokyo, name: { zh: name }, biz_type: "general", polygons: [{ kind: "operate", geometry: polygon }], ...extra } }), 201);
}

/** 把区域整体存回去（`patch` 改其中几项） */
async function putArea(who: TenantFixture, id: string, patch: Record<string, unknown>): Promise<ApiResponse> {
  const current = await ok(tenantCall(who, "GET", `/areas/${id}`));
  return tenantCall(who, "PUT", `/areas/${id}`, { version: current.version, body: { name: current.name, biz_type: current.biz_type, polygons: current.polygons, ...patch } });
}

/** 一个草稿商品（不上架）：品类、区域 */
async function draftProduct(who: TenantFixture, category: "airport_transfer" | "point_to_point" | "charter", areaIds: string[]): Promise<ApiResponse> {
  const brand = (await ok(tenantCall(who, "POST", "/brands", { body: { name: `M820-${randomUUID().slice(0, 6)}`, currency: "JPY" } }), 201)).id;
  return tenantCall(who, "POST", "/products", {
    body: {
      brand_id: brand,
      city_id: m.ids.tokyo,
      category,
      ...(category === "airport_transfer" ? { poi_id: m.ids.narita } : {}),
      areas: areaIds.map((areaId) => ({ area_id: areaId })),
      vehicle_groups: [{ vehicle_group_id: m.ids.biz7, passengers: 6, luggage: 4 }],
      dispatchers: [{ name: "调度", phone: "0312345678" }],
    },
  });
}

const productArea = async (who: TenantFixture, productId: string): Promise<string> => (await ok(tenantCall(who, "GET", `/products/${productId}`))).areas[0].area_id;
const salesQuote = (body: Record<string, unknown>, token = sales.token): Promise<ApiResponse> =>
  api.call("POST", "/sales/v1/quotes", { token, body: { city_id: m.ids.tokyo, category: "airport_transfer", place_id: m.ids.narita, direction: "pickup", service_time: "2026-10-20T10:00:00+09:00", passengers: 2, luggage: 1, currency: "JPY", ...body } });
const demands = async (): Promise<any[]> => (await api.db.owner.query("select *, service_date::text as service_date from uncovered_demands order by first_seen_at, id")).rows;
/** 报价的目录有 30 秒缓存：改了区域之后让时间走过去，新的询价按新的区域算 */
const pastCatalogCache = (): void => api.clock.advance(31_000);

before(async () => {
  api = await createTestApi();
  m = await buildMarket(api);
  const channel = await newChannel(api, m.staff.cm1.token, { name: "M8-20 渠道" });
  sales = await salesCredentials(api, m, channel.id);
});
after(() => api.close());

test("区域用途：新建运营区域 / 报价区域（不给是运营 + 报价）；报价区域超出运营区域的部分只提醒、不拦保存；列表按用途筛；审计记用途", async () => {
  const op = await newArea(m.a, "甲运营大区", square(139.0, 35.0, 141.0, 36.0), { role: "operating" });
  assert.deepEqual([op.role, op.outside_operating_m2], ["operating", null], "运营区域没有「超出」");
  const partly = await tenantCall(m.a, "POST", "/areas", { body: { city_id: m.ids.tokyo, name: { zh: "甲东边报价区" }, biz_type: "general", role: "pricing", polygons: [{ kind: "operate", geometry: square(140.5, 35.2, 141.5, 35.8) }] } });
  assertMatchesOpenApi("POST", "/tenant/v1/areas", partly);
  assert.equal(partly.status, 201, partly.text);
  // 141–141.5 × 35.2–35.8 在运营大区外：约 0.5° × 0.6°
  assert.equal(partly.body.role, "pricing");
  assert.ok(partly.body.outside_operating_m2 > 2_000_000_000, `超出 ${partly.body.outside_operating_m2} 平方米`);
  const inside = await newArea(m.a, "甲里面的报价区", square(140.2, 35.2, 140.4, 35.4), { role: "pricing" });
  assert.deepEqual([inside.role, inside.outside_operating_m2], ["pricing", 0]);
  Object.assign(A, { op: op.id, partly: partly.body.id, inside: inside.id });

  const detail = await tenantCall(m.a, "GET", `/areas/${A.partly}`);
  assertMatchesOpenApi("GET", "/tenant/v1/areas/{id}", detail);
  assert.equal(detail.body.outside_operating_m2, partly.body.outside_operating_m2);
  const listed = await tenantCall(m.a, "GET", "/areas?role=operating");
  assertMatchesOpenApi("GET", "/tenant/v1/areas", listed);
  assert.deepEqual(listed.body.items.map((item: any) => item.id), [A.op]);
  assert.ok((await ok(tenantCall(m.a, "GET", "/areas?role=both"))).items.every((item: any) => item.role === "both"));
  assert.equal((await tenantCall(m.a, "GET", "/areas?role=everything")).status, 400);
  const log = (await api.db.owner.query("select after from audit_logs where resource = 'area' and resource_id = $1 and action = 'create'", [A.op])).rows[0];
  assert.equal(log.after.role, "operating");
});

test("运营区域不能被商品勾选（400 AREA_ROLE_NOT_PRICING）；被商品（草稿也算）勾着的报价区域不能改成运营区域（409 AREA_IN_USE），改用途记审计", async () => {
  const rejected = await draftProduct(m.a, "airport_transfer", [A.op]);
  assert.equal(rejected.status, 400, rejected.text);
  assert.deepEqual(rejected.body.error.details.issues.map((issue: any) => [issue.path, issue.reason]), [["/areas/0/area_id", "AREA_ROLE_NOT_PRICING"]]);
  const draft = await ok(draftProduct(m.a, "airport_transfer", [A.inside]), 201);
  const locked = await putArea(m.a, A.inside, { role: "operating" });
  assertMatchesOpenApi("PUT", "/tenant/v1/areas/{id}", locked);
  assert.deepEqual([locked.status, locked.body.error.code, locked.body.error.details.product_count], [409, "AREA_IN_USE", 1]);
  assert.equal((await ok(tenantCall(m.a, "GET", `/areas/${A.inside}`))).role, "pricing", "没改");
  // 商品去掉它之后可以改；改回报价区域也行；审计里有前后的用途
  await ok(tenantCall(m.a, "DELETE", `/products/${draft.id}`), 204);
  const changed = await putArea(m.a, A.inside, { role: "operating" });
  assert.deepEqual([changed.status, changed.body.role, changed.body.outside_operating_m2], [200, "operating", null]);
  const back = await ok(putArea(m.a, A.inside, { role: "pricing" }));
  assert.equal(back.role, "pricing");
  const logs = (await api.db.owner.query("select before, after from audit_logs where resource = 'area' and resource_id = $1 and action = 'update' order by id", [A.inside])).rows;
  assert.deepEqual(logs.map((row: any) => [row.before.role, row.after.role]), [["pricing", "operating"], ["operating", "pricing"]]);
  // 不给用途 = 不改
  const kept = await ok(putArea(m.a, A.inside, { name: { zh: "甲里面的报价区（改名）" } }));
  assert.equal(kept.role, "pricing");
});

test("包车区域加价的区域、点对点线路价的两端也不能是运营区域（400 AREA_ROLE_NOT_PRICING）", async () => {
  const charter = await ok(draftProduct(m.a, "charter", [A.inside]), 201);
  const surcharge = await tenantCall(m.a, "POST", `/products/${charter.id}/price-rules`, { version: charter.version, body: { area_id: A.op, vehicle_group_id: m.ids.biz7, package_hours: 8, pricing_model: "charter_area_surcharge", pickup_surcharge: 500, dropoff_surcharge: 500, valid_from: "2026-01-01" } });
  assertMatchesOpenApi("POST", "/tenant/v1/products/{id}/price-rules", surcharge);
  assert.deepEqual([surcharge.status, surcharge.body.error.details.issues.map((issue: any) => [issue.path, issue.reason])], [400, [["/area_id", "AREA_ROLE_NOT_PRICING"]]]);
  // 报价区域可以当加价区域
  const allowed = await tenantCall(m.a, "POST", `/products/${charter.id}/price-rules`, { version: charter.version, body: { area_id: A.partly, vehicle_group_id: m.ids.biz7, package_hours: 8, pricing_model: "charter_area_surcharge", pickup_surcharge: 500, dropoff_surcharge: 500, valid_from: "2026-01-01" } });
  assert.equal(allowed.status, 201, allowed.text);

  const p2p = await ok(draftProduct(m.a, "point_to_point", [A.inside, A.partly]), 201);
  const line = await tenantCall(m.a, "POST", `/products/${p2p.id}/price-rules`, { version: p2p.version, body: { area_id: A.inside, to_area_id: A.op, vehicle_group_id: m.ids.biz7, pricing_model: "fixed", base_price: 9_000, valid_from: "2026-01-01" } });
  assert.equal(line.status, 400, line.text);
  assert.ok(line.body.error.details.issues.some((issue: any) => issue.path === "/to_area_id" && issue.reason === "AREA_ROLE_NOT_PRICING"), line.text);
  const okLine = await tenantCall(m.a, "POST", `/products/${p2p.id}/price-rules`, { version: p2p.version, body: { area_id: A.inside, to_area_id: A.partly, vehicle_group_id: m.ids.biz7, pricing_model: "fixed", base_price: 9_000, valid_from: "2026-01-01" } });
  assert.equal(okLine.status, 201, okLine.text);
  // 有线路价、区域加价挂着的报价区域同样不能改成运营区域（草稿也算）
  const locked = await putArea(m.a, A.partly, { role: "operating" });
  assert.deepEqual([locked.status, locked.body.error.code, locked.body.error.details.product_count], [409, "AREA_IN_USE", 2]);
  for (const id of [charter.id, p2p.id]) await ok(tenantCall(m.a, "DELETE", `/products/${id}`), 204);
});

test("上架检查：勾选的报价区域有一部分不在任何运营区域里时多一项「运营区域」提醒（不拦上架）；全在里面时没有这一项", async () => {
  const outside = await ok(draftProduct(m.a, "airport_transfer", [A.partly]), 201);
  const checked = await tenantCall(m.a, "GET", `/products/${outside.id}/publish-check`);
  assertMatchesOpenApi("GET", "/tenant/v1/products/{id}/publish-check", checked);
  const coverage = checked.body.items.find((item: any) => item.key === "area_coverage");
  assert.deepEqual([coverage.required, coverage.passed, coverage.issues.map((issue: any) => [issue.path, issue.reason])], [false, false, [[`/areas/${A.partly}`, "PRICING_AREA_OUTSIDE_OPERATING"]]]);
  assert.ok(coverage.issues[0].detail.outside_m2 > 0);
  assert.match(coverage.issues[0].message, /不在任何运营区域里/);
  const inside = await ok(draftProduct(m.a, "airport_transfer", [A.inside]), 201);
  assert.ok(!(await ok(tenantCall(m.a, "GET", `/products/${inside.id}/publish-check`))).items.some((item: any) => item.key === "area_coverage"));
  for (const id of [outside.id, inside.id]) await ok(tenantCall(m.a, "DELETE", `/products/${id}`), 204);
});

test("改小、停用、删除运营范围让已上架商品的报价区域多出「不在运营区域里」的部分：409 PRICING_AREA_OUTSIDE_OPERATING（列出商品和区域）；先补运营区域就可以", async () => {
  const tokyoB = await productArea(m.b, m.ids.pb);
  // 乙的「东京全域」是运营 + 报价、乙唯一的运营区域：改成报价区域就没有运营范围了
  const refused = await putArea(m.b, tokyoB, { role: "pricing" });
  assertMatchesOpenApi("PUT", "/tenant/v1/areas/{id}", refused);
  assert.deepEqual([refused.status, refused.body.error.code], [409, "PRICING_AREA_OUTSIDE_OPERATING"]);
  assert.deepEqual(refused.body.error.details.items.map((item: any) => [item.product_id, item.area_id]), [[m.ids.pb, tokyoB]]);
  assert.ok(refused.body.error.details.items[0].outside_m2 > 1_000_000_000);
  assert.equal((await ok(tenantCall(m.b, "GET", `/areas/${tokyoB}`))).role, "both", "没改");

  // 先画一个盖住它的运营区域，再改就可以
  const opB = (await newArea(m.b, "乙运营区", square(138.9, 34.9, 140.1, 36.1), { role: "operating" })).id;
  const changed = await ok(putArea(m.b, tokyoB, { role: "pricing" }));
  assert.deepEqual([changed.role, changed.outside_operating_m2], ["pricing", 0]);
  // 现在这个运营区域是唯一的运营范围：停用、删除、改小、改业务类型（接送机商品用不上包车的运营区域）、改成报价区域都不行
  const attempts: [string, Promise<ApiResponse>, string][] = [
    ["停用", tenantCall(m.b, "POST", `/areas/${opB}/disable`), "/tenant/v1/areas/{id}/disable"],
    ["删除", tenantCall(m.b, "DELETE", `/areas/${opB}`), "/tenant/v1/areas/{id}"],
  ];
  for (const [label, request, path] of attempts) {
    const res = await request;
    assertMatchesOpenApi(label === "删除" ? "DELETE" : "POST", path, res);
    assert.deepEqual([res.status, res.body.error.code], [409, "PRICING_AREA_OUTSIDE_OPERATING"], label);
  }
  for (const patch of [{ polygons: [{ kind: "operate", geometry: square(139.5, 34.9, 140.1, 36.1) }] }, { biz_type: "charter" }, { role: "pricing" }]) {
    const res = await putArea(m.b, opB, patch);
    assert.deepEqual([res.status, res.body.error?.code], [409, "PRICING_AREA_OUTSIDE_OPERATING"], JSON.stringify(patch));
  }
  // 改大、加禁行区以外的地方不受影响：改大可以
  assert.equal((await putArea(m.b, opB, { polygons: [{ kind: "operate", geometry: square(138.8, 34.8, 140.2, 36.2) }] })).status, 200);
  // 还原：东京全域改回运营 + 报价之后，运营区域可以停用
  await ok(putArea(m.b, tokyoB, { role: "both" }));
  assert.equal((await ok(tenantCall(m.b, "POST", `/areas/${opB}/disable`))).status, "disabled");
  await ok(tenantCall(m.b, "DELETE", `/areas/${opB}`), 204);
});

test("租户隔离：乙读不到、改不了甲的区域（含用途）；按用途筛也翻不出甲的；乙的商品勾不了甲的区域", async () => {
  for (const id of [A.op, A.partly]) {
    assert.equal((await tenantCall(m.b, "GET", `/areas/${id}`)).status, 404);
    const res = await tenantCall(m.b, "PUT", `/areas/${id}`, { version: 1, body: { name: { zh: "乙改的" }, biz_type: "general", role: "pricing", polygons: [{ kind: "operate", geometry: square(0, 0, 1, 1) }] } });
    assert.equal(res.status, 404);
  }
  assert.equal((await ok(tenantCall(m.a, "GET", `/areas/${A.op}`))).role, "operating", "甲的没变");
  for (const role of ["operating", "pricing", "both"]) {
    const listed = await tenantCall(m.b, "GET", `/areas?role=${role}`);
    assert.ok(!listed.text.includes(A.op) && !listed.text.includes(A.partly), role);
  }
  const map = await tenantCall(m.b, "GET", "/area-map");
  assert.ok(!map.text.includes(A.op) && !map.text.includes(m.a.tenantId));
  const borrowed = await draftProduct(m.b, "airport_transfer", [A.partly]);
  assert.deepEqual([borrowed.status, borrowed.body.error.details.issues.map((issue: any) => issue.reason)], [400, ["UNKNOWN_AREA"]]);
});

test("区域地图（两个入口）带用途和超出运营区域的面积；规则 4：区域、试算、上架检查的应答里没有对外价和加价比例", async () => {
  const tenantMap = await tenantCall(m.a, "GET", "/area-map");
  assertMatchesOpenApi("GET", "/tenant/v1/area-map", tenantMap);
  const byId = new Map(tenantMap.body.items.map((item: any) => [item.id, item]));
  assert.deepEqual([(byId.get(A.op) as any).role, (byId.get(A.op) as any).outside_operating_m2], ["operating", null]);
  assert.ok((byId.get(A.partly) as any).outside_operating_m2 > 0);
  const platformMap = await api.call("GET", `/platform/v1/area-map?tenant_id=${m.a.tenantId}`, { token: m.root });
  assertMatchesOpenApi("GET", "/platform/v1/area-map", platformMap);
  assert.deepEqual(platformMap.body.items.map((item: any) => [item.id, item.role]).sort(), tenantMap.body.items.map((item: any) => [item.id, item.role]).sort());
  for (const res of [tenantMap, await tenantCall(m.a, "GET", `/areas/${A.partly}`)]) for (const key of RULE4_KEYS) assert.ok(!allKeys(res.body).has(key), key);
});

test("报价第 4 步两道判断（增强版 B）：运营区域里、商品没勾报价区域 → NO_PRICING_AREA（供应商试算、平台试算看得到）；甲用不了乙的运营区域；渠道看到的是 OUT_OF_SERVICE_AREA", async () => {
  const body = { direction: "pickup", service_time: "2026-10-20T10:00", passengers: 2 };
  const own = await tenantCall(m.a, "POST", `/products/${m.ids.pa}/quote-preview`, { body: { ...body, dropoff: P.far } });
  assertMatchesOpenApi("POST", "/tenant/v1/products/{id}/quote-preview", own);
  assert.deepEqual([own.body.refusal.reason, own.body.offers], ["NO_PRICING_AREA", []]);
  assert.match(own.body.refusal.message, /运营区域里，但商品没有勾选覆盖它的报价区域/);
  for (const key of RULE4_KEYS) assert.ok(!allKeys(own.body).has(key), key);
  // 两道都过：和今天一样报价
  assert.ok((await ok(tenantCall(m.a, "POST", `/products/${m.ids.pa}/quote-preview`, { body: { ...body, dropoff: P.west } }))).offers.length > 0);
  // 乙在 P.farther 有运营区域；甲在那里没有运营范围（乙的运营区域不算甲的）
  const opB = (await newArea(m.b, "乙东边运营区", square(141.5, 35.0, 142.0, 36.0), { role: "operating" })).id;
  pastCatalogCache();
  const preview = await api.call("POST", "/platform/v1/quotes/preview", { token: m.root, body: { city_id: m.ids.tokyo, category: "airport_transfer", place_id: m.ids.narita, currency: "JPY", ...body, dropoff: P.farther } });
  assertMatchesOpenApi("POST", "/platform/v1/quotes/preview", preview);
  const reasons = Object.fromEntries(preview.body.refused.map((entry: any) => [entry.tenant_id, entry.reason]));
  assert.deepEqual(reasons, { [m.a.tenantId]: "OUT_OF_SERVICE_AREA", [m.b.tenantId]: "NO_PRICING_AREA" });
  const atFar = await ok(api.call("POST", "/platform/v1/quotes/preview", { token: m.root, body: { city_id: m.ids.tokyo, category: "airport_transfer", place_id: m.ids.narita, currency: "JPY", ...body, dropoff: P.far } }));
  assert.deepEqual(Object.fromEntries(atFar.refused.map((entry: any) => [entry.tenant_id, entry.reason])), { [m.a.tenantId]: "NO_PRICING_AREA", [m.b.tenantId]: "OUT_OF_SERVICE_AREA" });
  // 渠道：对外的原因不加值
  const channel = await salesQuote({ dropoff: P.far });
  assertMatchesOperation("POST", "/sales/v1/quotes", channel.status, channel.body);
  assert.deepEqual([channel.body.quotes, channel.body.unavailable], [[], [{ vehicle_group_id: null, reasons: ["OUT_OF_SERVICE_AREA"] }]]);
  assert.ok(!channel.text.includes("NO_PRICING_AREA"));
  await ok(tenantCall(m.b, "DELETE", `/areas/${opB}`), 204);
});

test("租户角色读不到未覆盖需求：表只授权给平台角色；/tenant/v1 没有任何读它的接口", async () => {
  for (const table of ["uncovered_demands", "uncovered_demand_limits", "uncovered_demand_drops"]) {
    const grants = await api.db.owner.query("select has_table_privilege('nozomi_app', $1, 'select') as app, has_table_privilege('nozomi_preauth', $1, 'select') as preauth, has_table_privilege('nozomi_platform', $1, 'select') as platform", [`${api.db.schema}.${table}`]);
    assert.deepEqual(grants.rows[0], { app: false, preauth: false, platform: true }, table);
  }
  const tenantRoutes = api.app.registeredRoutes.filter((route) => route.path.startsWith("/tenant/") && /demand/i.test(route.path));
  assert.deepEqual(tenantRoutes, []);
  assert.equal((await api.call("GET", "/platform/v1/uncovered-demands", { token: m.a.adminToken })).status, 401, "租户的令牌进不了平台接口");
});
