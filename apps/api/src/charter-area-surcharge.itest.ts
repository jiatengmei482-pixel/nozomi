/**
 * M8-15：包车区域加价（ADR 0073 第三部分），经真实接口、真实 PostgreSQL；收款服务用替身。
 * - 价格规则：新价格方式 `charter_area_surcharge`（批量新增、冲突键含价格方式、加价区域是本租户的任何报价区域、不能是商品本身的区域、别人的区域 404）；
 * - 价格日历按区域分行；导入导出加「上车加价」「下车加价」两列；
 * - 官网包车：下车地点暂时可选（同渠道接口，不给时设了区域加价的商品不报 DROPOFF_REQUIRED，M8-13 改为必填）；给了下车地点时下车地址必填；报价 = 基础定价 + 上车加价 + 下车加价；哪里都不在转人工；订单存下车点和加价；
 *   供应商订单详情只有结算价，运营订单详情另有对外价参考；
 * - 渠道接口：不给下车地点时只报没设区域加价的商品，设了的给出原因 `DROPOFF_REQUIRED`；
 * - 规则 2：甲读不到、改不了乙的区域加价、价格日历、导出、订单；规则 4：/tenant/v1 的应答里没有对外价和加价比例；
 * - 加价区域被已上架的商品用着时不能停用、删除。
 * 测试数据全在本文件里经接口建出来，随测试 schema 一起删除（规则 1）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { XLSX_CONTENT_TYPE, type XlsxWriteCell, readXlsx, writeXlsx } from "./integrations/xlsx.ts";
import type { ApiResponse, HttpMethod, TenantFixture, TestApi } from "./testing/api.ts";
import { createTestApi } from "./testing/api.ts";
import { type Market, allKeys, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi, assertMatchesOperation } from "./testing/openapi.ts";
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let site: SiteApi;
/** 乙的东京包车商品：商品本身的区域是东京，加价区域千叶、富士山 */
let charterB: { id: string; tokyo: string; chiba: string; fuji: string; hachioji: string };
/** 甲的大阪包车商品：没有区域加价 */
let charterA: { id: string; area: string };

const square = (west: number, south: number, east: number, north: number) => ({ type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] });
const P = {
  tokyo: { lng: 139.7, lat: 35.7 },
  tokyo2: { lng: 139.6, lat: 35.6 },
  chiba: { lng: 140.1, lat: 35.7 },
  fuji: { lng: 138.7, lat: 35.3 },
  nowhere: { lng: 141.5, lat: 37.0 },
  osaka: { lng: 135.5, lat: 34.7 },
};
const SERVICE_LOCAL = "2026-10-20T10:00";
const PASSENGER = { name: "陈小红", phone: "+81 90-2222-3333", email: "charter.guest@example.com" };
const RULE4_KEYS = ["sell", "sell_minor", "markup", "markup_bp", "fx_buffer_bp", "channel", "area_surcharge_sell"];
let ipSeq = 0;
const nextIp = (): string => `10.88.${(ipSeq += 1)}.9`;

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
const version = async (who: TenantFixture, productId: string): Promise<number> => (await ok(tenantCall(who, "GET", `/products/${productId}`))).version;

async function newArea(who: TenantFixture, cityId: string, name: string, polygon: ReturnType<typeof square>, bizType = "general"): Promise<string> {
  return (await ok(tenantCall(who, "POST", "/areas", { body: { city_id: cityId, name: { zh: name }, biz_type: bizType, polygons: [{ kind: "operate", geometry: polygon }] } }), 201)).id;
}

/** 一个上架的包车商品：商品区域 `areaId`，8 小时套餐价 `price`（商务 7 座）。 */
async function charterProduct(who: TenantFixture, cityId: string, areaId: string, price: number): Promise<string> {
  const brand = (await ok(tenantCall(who, "POST", "/brands", { body: { name: `包车-${randomUUID().slice(0, 6)}`, currency: "JPY" } }), 201)).id;
  const created = await ok(tenantCall(who, "POST", "/products", { body: { brand_id: brand, city_id: cityId, category: "charter", areas: [{ area_id: areaId }], vehicle_groups: [{ vehicle_group_id: m.ids.biz7, passengers: 6, luggage: 4 }], dispatchers: [{ name: "调度", phone: "0312345678" }] } }), 201);
  const rules = await ok(tenantCall(who, "PUT", `/products/${created.id}/service-rules`, { version: 1, body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { general: { mode: "limited", minutes: 0 } } } }));
  const content = await ok(tenantCall(who, "PUT", `/products/${created.id}/content`, { version: rules.version, body: { zh: { title: "区域加价包车" } } }));
  await ok(tenantCall(who, "POST", `/products/${created.id}/price-rules`, { version: content.version, body: { area_id: areaId, vehicle_group_id: m.ids.biz7, package_hours: 8, pricing_model: "charter_package", package_km: 150, package_price: price, overtime_per_hour: 5_000, over_km_per_km: 400, valid_from: "2026-01-01" } }), 201);
  await ok(tenantCall(who, "POST", `/products/${created.id}/publish`));
  return created.id;
}

const surcharge = (areaId: string, pickup: number, dropoff: number, extra: Record<string, unknown> = {}) => ({ area_id: areaId, vehicle_group_id: m.ids.biz7, package_hours: 8, pricing_model: "charter_area_surcharge", pickup_surcharge: pickup, dropoff_surcharge: dropoff, valid_from: "2026-01-01", ...extra });

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  const tokyo = await newArea(m.b, m.ids.tokyo, "东京 23 区", square(139.5, 35.5, 139.9, 35.9), "charter");
  const chiba = await newArea(m.b, m.ids.tokyo, "千叶", square(140.0, 35.5, 140.3, 35.9));
  const fuji = await newArea(m.b, m.ids.tokyo, "富士山", square(138.6, 35.2, 139.3, 35.45), "charter");
  const hachioji = await newArea(m.b, m.ids.tokyo, "八王子", square(139.2, 35.5, 139.4, 35.9));
  charterB = { id: await charterProduct(m.b, m.ids.tokyo, tokyo, 70_000), tokyo, chiba, fuji, hachioji };
  const osaka = await newArea(m.a, m.ids.osaka, "大阪市", square(135.3, 34.5, 135.7, 34.9), "charter");
  charterA = { id: await charterProduct(m.a, m.ids.osaka, osaka, 60_000), area: osaka };
  const channel = await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" });
  site = await siteApi(api, (await salesCredentials(api, m, channel.id)).clientId, pay);
});
after(async () => {
  await site?.close();
  await api.close();
});

test("供应商批量新增区域加价（一次给几个区域，同一事务）：价格页多出上车 / 下车加价两项，缺价统计不变；没有对外价和加价比例（规则 4）", async () => {
  const saved = await tenantCall(m.b, "POST", `/products/${charterB.id}/price-rules/batch`, { version: await version(m.b, charterB.id), body: { create: [surcharge(charterB.chiba, 500, 500), surcharge(charterB.fuji, 1_000, 1_000)] } });
  assertMatchesOpenApi("POST", "/tenant/v1/products/{id}/price-rules/batch", saved);
  assert.equal(saved.status, 200, saved.text);
  const listed = await tenantCall(m.b, "GET", `/products/${charterB.id}/price-rules`);
  assertMatchesOpenApi("GET", "/tenant/v1/products/{id}/price-rules", listed);
  assert.deepEqual([listed.body.available_models, listed.body.surcharge_models, listed.body.coverage], [["charter_package"], ["charter_area_surcharge"], { total: 1, priced: 1, missing: 0 }]);
  // 同一批新增的创建时间相同，先后不定：按加价排
  const rows = listed.body.items.filter((item: any) => item.pricing_model === "charter_area_surcharge").map((item: any) => [item.area_id, item.package_hours, item.pickup_surcharge, item.dropoff_surcharge, item.package_price, item.base]).sort((a: any[], b: any[]) => a[2] - b[2]);
  assert.deepEqual(rows, [[charterB.chiba, 8, 500, 500, null, "0"], [charterB.fuji, 8, 1_000, 1_000, null, "0"]]);
  for (const res of [saved, listed]) for (const key of RULE4_KEYS) assert.ok(!allKeys(res.body).has(key), key);
  // 加价区域不加进商品的区域列表；上架检查照旧通过
  const product = await ok(tenantCall(m.b, "GET", `/products/${charterB.id}`));
  assert.deepEqual(product.areas.map((entry: any) => entry.area_id), [charterB.tokyo]);
  assert.equal((await ok(tenantCall(m.b, "GET", `/products/${charterB.id}/publish-check`))).can_publish ?? true, true);
});

test("冲突键含价格方式：同一区域同时有套餐价和区域加价不冲突；同一区域 × 车型组 × 套餐时长、日期重叠的区域加价 409；一次给一个区域补 4 小时不冲突", async () => {
  const conflict = await tenantCall(m.b, "POST", `/products/${charterB.id}/price-rules`, { version: await version(m.b, charterB.id), body: surcharge(charterB.chiba, 600, 600, { valid_from: "2026-12-01" }) });
  assertMatchesOpenApi("POST", "/tenant/v1/products/{id}/price-rules", conflict);
  assert.deepEqual([conflict.status, conflict.body.error.code], [409, "PRICE_RULE_CONFLICT"]);
  const fourHours = await tenantCall(m.b, "POST", `/products/${charterB.id}/price-rules`, { version: await version(m.b, charterB.id), body: surcharge(charterB.chiba, 300, 300, { package_hours: 4 }) });
  assert.equal(fourHours.status, 201, fourHours.text);
  // 商品区域（东京）里的套餐价 + 同一区域的区域加价：区域加价那条被拒，但原因是「商品本身的区域」，不是冲突
  const own = await tenantCall(m.b, "POST", `/products/${charterB.id}/price-rules`, { version: await version(m.b, charterB.id), body: surcharge(charterB.tokyo, 100, 100) });
  assertMatchesOpenApi("POST", "/tenant/v1/products/{id}/price-rules", own);
  assert.deepEqual([own.status, own.body.error.details.issues.map((issue: any) => [issue.path, issue.reason])], [400, [["/area_id", "AREA_IS_PRODUCT_AREA"]]]);
  // 删掉 4 小时那条（删除 = 页面上的「删除」，和价格规则一样）
  const deleted = await tenantCall(m.b, "DELETE", `/products/${charterB.id}/price-rules/${fourHours.body.price_rule.id}`, { version: await version(m.b, charterB.id) });
  assert.equal(deleted.status, 200, deleted.text);
});

test("加价区域的检查：别的供应商的区域、不存在的区域 404（不区分）；停用的区域不能新选；接送机商品不能用区域加价；数都要是非负整数", async () => {
  const v = await version(m.b, charterB.id);
  for (const areaId of [charterA.area, randomUUID()]) {
    const res = await tenantCall(m.b, "POST", `/products/${charterB.id}/price-rules`, { version: v, body: surcharge(areaId, 100, 100) });
    assertMatchesOpenApi("POST", "/tenant/v1/products/{id}/price-rules", res);
    assert.deepEqual([res.status, res.body.error.code], [404, "NOT_FOUND"], areaId);
    const batch = await tenantCall(m.b, "POST", `/products/${charterB.id}/price-rules/batch`, { version: v, body: { create: [surcharge(charterB.fuji, 1, 1, { package_hours: 2 }), surcharge(areaId, 1, 1, { package_hours: 3 })] } });
    assert.equal(batch.status, 404, "整批不写");
  }
  const disabled = await newArea(m.b, m.ids.tokyo, "停用的区域", square(140.5, 35.5, 140.6, 35.6));
  await ok(tenantCall(m.b, "POST", `/areas/${disabled}/disable`));
  const off = await tenantCall(m.b, "POST", `/products/${charterB.id}/price-rules`, { version: v, body: surcharge(disabled, 100, 100) });
  assert.deepEqual([off.status, off.body.error.details.issues.map((issue: any) => issue.reason)], [400, ["AREA_DISABLED"]]);
  const bad = await tenantCall(m.b, "POST", `/products/${charterB.id}/price-rules`, { version: v, body: surcharge(charterB.hachioji, -1, 1.5) });
  assert.deepEqual([bad.status, bad.body.error.details.issues.map((issue: any) => [issue.path, issue.reason])], [400, [["/pickup_surcharge", "OUT_OF_RANGE"], ["/dropoff_surcharge", "NOT_INTEGER"]]]);
  const transfer = await tenantCall(m.b, "POST", `/products/${m.ids.pb}/price-rules`, { version: await version(m.b, m.ids.pb), body: { ...surcharge(charterB.chiba, 100, 100), package_hours: null, direction: "both" } });
  assert.deepEqual([transfer.status, transfer.body.error.details.issues.map((issue: any) => issue.reason)], [400, ["MODEL_NOT_ALLOWED"]]);
  const rows = await api.db.owner.query<{ n: number }>("select count(*)::int as n from price_rules where product_id = $1 and pricing_model = 'charter_area_surcharge'", [charterB.id]);
  assert.equal(rows.rows[0]?.n, 2, "只有千叶、富士山两条");
});

test("规则 2：甲读不到、改不了乙的区域加价（价格规则、批量、修改、删除、价格日历、导出、导入预览都是 404），也不能把乙的区域挂到自己的商品上", async () => {
  const rule = (await ok(tenantCall(m.b, "GET", `/products/${charterB.id}/price-rules`))).items.find((item: any) => item.area_id === charterB.fuji);
  const tokenA = await tenantLogin(api, m.a.adminEmail);
  const v = await version(m.b, charterB.id);
  const attempts: [HttpMethod, string, unknown][] = [
    ["GET", `/products/${charterB.id}/price-rules`, undefined],
    ["POST", `/products/${charterB.id}/price-rules`, surcharge(charterB.hachioji, 1, 1)],
    ["POST", `/products/${charterB.id}/price-rules/batch`, { create: [surcharge(charterB.hachioji, 1, 1)] }],
    ["PUT", `/products/${charterB.id}/price-rules/${rule.id}`, surcharge(charterB.fuji, 1, 1)],
    ["DELETE", `/products/${charterB.id}/price-rules/${rule.id}`, undefined],
    ["GET", `/products/${charterB.id}/price-calendar?area_id=${charterB.fuji}&vehicle_group_id=${m.ids.biz7}&package_hours=8&from=2026-10-20&to=2026-10-21`, undefined],
  ];
  for (const [method, path, body] of attempts) {
    const res = await tenantCall(tokenA, method, path, { version: v, ...(body === undefined ? {} : { body }) });
    assert.equal(res.status, 404, `${method} ${path}：${res.text}`);
  }
  const exported = await api.app.inject({ method: "GET", url: `/tenant/v1/products/${charterB.id}/price-rules/export`, headers: { authorization: `Bearer ${tokenA}` } });
  assert.equal(exported.statusCode, 404);
  const preview = await api.app.inject({ method: "POST", url: `/tenant/v1/products/${charterB.id}/price-rules/import/preview`, payload: writeXlsx([{ name: "价格", rows: [["区域"]] }]), headers: { "content-type": XLSX_CONTENT_TYPE, authorization: `Bearer ${tokenA}` } });
  assert.equal(preview.statusCode, 404);
  // 甲把乙的区域挂到自己的商品上：404，和不存在的区域一样
  const borrowed = await tenantCall(tokenA, "POST", `/products/${charterA.id}/price-rules`, { version: await version(m.a, charterA.id), body: surcharge(charterB.chiba, 1, 1) });
  assert.equal(borrowed.status, 404, borrowed.text);
  const unchanged = await ok(tenantCall(m.b, "GET", `/products/${charterB.id}/price-rules`));
  assert.deepEqual(unchanged.items.find((item: any) => item.id === rule.id), rule, "乙的区域加价没被动过");
  assert.equal((await api.db.owner.query<{ n: number }>("select count(*)::int as n from price_rules where product_id = $1", [charterA.id])).rows[0]?.n, 1);
});

test("价格日历按区域分行：给加价区域时每天给这一天用的上车 / 下车加价；商品区域没有加价为 null", async () => {
  const path = (areaId: string) => `/products/${charterB.id}/price-calendar?area_id=${areaId}&vehicle_group_id=${m.ids.biz7}&package_hours=8&from=2026-10-20&to=2026-10-21`;
  const fuji = await tenantCall(m.b, "GET", path(charterB.fuji));
  assertMatchesOpenApi("GET", "/tenant/v1/products/{id}/price-calendar", fuji);
  assert.deepEqual(fuji.body.days.map((day: any) => [day.date, day.surcharge?.pickup_surcharge, day.surcharge?.dropoff_surcharge]), [["2026-10-20", 1_000, 1_000], ["2026-10-21", 1_000, 1_000]]);
  const tokyo = await tenantCall(m.b, "GET", path(charterB.tokyo));
  assert.deepEqual(tokyo.body.days.map((day: any) => [day.surcharge, day.segments[0].final]), [[null, 70_000], [null, 70_000]]);
  for (const key of RULE4_KEYS) assert.ok(!allKeys(fuji.body).has(key), key);
});

test("导入导出：导出带「上车加价」「下车加价」两列和区域加价的行；导入区域加价的行（区域按本租户的名称认）；旧模版照样导入", async () => {
  const token = await tenantLogin(api, m.b.adminEmail);
  const exported = await api.app.inject({ method: "GET", url: `/tenant/v1/products/${charterB.id}/price-rules/export`, headers: { authorization: `Bearer ${token}` } });
  assert.equal(exported.statusCode, 200);
  const rows = readXlsx(exported.rawPayload).map((cells) => cells.map((cell) => (cell.type === "text" || cell.type === "number" ? cell.text : null)));
  assert.deepEqual(rows[0], ["价格编号", "区域", "车型组", "套餐时长(小时)", "套餐公里", "套餐价", "超时单价(每小时)", "超公里单价(每公里)", "上车加价", "下车加价", "生效开始", "生效结束", "状态"]);
  const exportedRows = rows.slice(1).map((row) => [row[1], row[3], row[5], row[8], row[9]]);
  assert.deepEqual(exportedRows[0], ["东京 23 区", "8", "70000", null, null]);
  assert.deepEqual(exportedRows.slice(1).sort((a, b) => Number(a[3]) - Number(b[3])), [["千叶", "8", null, "500", "500"], ["富士山", "8", null, "1000", "1000"]]);

  const upload = async (file: Buffer, path: string, extra: Record<string, string> = {}): Promise<ApiResponse> => {
    api.clock.advance(1_000);
    const res = await api.app.inject({ method: "POST", url: `/tenant/v1/products/${charterB.id}${path}`, payload: file, headers: { "content-type": XLSX_CONTENT_TYPE, authorization: `Bearer ${token}`, ...extra } });
    return { status: res.statusCode, headers: res.headers, text: res.body, body: res.json() };
  };
  const num = (value: number): XlsxWriteCell => ({ number: String(value) });
  const header = rows[0] as string[];
  const file = writeXlsx([
    {
      name: "价格",
      rows: [
        header,
        [null, "八王子", "VG-BIZ-7", num(8), null, null, null, null, num(800), num(0), "2026-01-01", null, "启用"],
        [null, "千叶", "VG-BIZ-7", num(4), num(10), null, null, null, num(300), num(300), "2026-01-01", null, null],
        [null, "不存在的区域", "VG-BIZ-7", num(4), null, null, null, null, num(1), num(1), "2026-01-01", null, null],
      ],
    },
  ]);
  const seen = await upload(file, "/price-rules/import/preview");
  assertMatchesOpenApi("POST", "/tenant/v1/products/{id}/price-rules/import/preview", seen);
  assert.equal(seen.status, 200, seen.text);
  assert.deepEqual(seen.body.rows.map((row: any) => [row.action, row.content.pricing_model, row.content.surcharge, row.issues.map((issue: any) => [issue.column, issue.reason])]), [
    ["create", "charter_area_surcharge", { pickup: 800, dropoff: 0 }, []],
    ["error", "charter_area_surcharge", { pickup: 300, dropoff: 300 }, [["套餐公里", "NOT_APPLICABLE"]]],
    ["error", "charter_area_surcharge", { pickup: 1, dropoff: 1 }, [["区域", "UNKNOWN_AREA"]]],
  ]);
  const clean = writeXlsx([{ name: "价格", rows: [header, [null, "八王子", "VG-BIZ-7", num(8), null, null, null, null, num(800), num(0), "2026-01-01", null, "启用"]] }]);
  const checked = await upload(clean, "/price-rules/import/preview");
  assert.equal(checked.body.can_import, true, checked.text);
  const imported = await upload(clean, `/price-rules/import?file_sha256=${checked.body.file_sha256}`, { "if-match": `"${checked.body.version}"`, "idempotency-key": randomUUID() });
  assert.equal(imported.status, 200, imported.text);
  const after = await ok(tenantCall(m.b, "GET", `/products/${charterB.id}/price-rules`));
  assert.deepEqual(after.items.filter((item: any) => item.area_id === charterB.hachioji).map((item: any) => [item.pricing_model, item.pickup_surcharge, item.dropoff_surcharge]), [["charter_area_surcharge", 800, 0]]);

  // 旧模版（没有那两列）：只导入套餐价，照样能用
  const oldHeader = ["价格编号", "区域", "车型组", "套餐时长(小时)", "套餐公里", "套餐价", "超时单价(每小时)", "超公里单价(每公里)", "生效开始", "生效结束", "状态"];
  const old = writeXlsx([{ name: "价格", rows: [oldHeader, [null, "东京 23 区", "VG-BIZ-7", num(4), num(80), num(40_000), num(5_000), num(400), "2026-01-01", null, null]] }]);
  const oldSeen = await upload(old, "/price-rules/import/preview");
  assert.deepEqual([oldSeen.status, oldSeen.body.can_import, oldSeen.body.rows[0].action, oldSeen.body.rows[0].content.surcharge], [200, true, "create", null], oldSeen.text);

  // M8-25：一行区域加价选了商品本身的区域（AREA_IS_PRODUCT_AREA）时，别的行照样查日期重叠：
  // 八王子 8 小时的加价上面已经导入（2026-01-01 起），再加一条 2026-06-01 起的就是「冲突」，不能显示成「新增」
  const mixed = writeXlsx([{ name: "价格", rows: [header,
    [null, "东京 23 区", "VG-BIZ-7", num(8), null, null, null, null, num(100), num(100), "2026-01-01", null, null],
    [null, "八王子", "VG-BIZ-7", num(8), null, null, null, null, num(900), num(0), "2026-06-01", null, null],
  ] }]);
  const mixedSeen = await upload(mixed, "/price-rules/import/preview");
  assert.equal(mixedSeen.status, 200, mixedSeen.text);
  assert.deepEqual(mixedSeen.body.rows.map((row: any) => [row.action, row.issues.map((issue: any) => [issue.column, issue.reason]), row.conflicts_with.length]), [
    ["error", [["区域", "AREA_IS_PRODUCT_AREA"]], 0],
    ["conflict", [], 1],
  ]);
  assert.deepEqual([mixedSeen.body.summary.conflict, mixedSeen.body.can_import], [1, false]);
});

test("官网包车：下车地点必填（M8-19，不给 400 REQUIRED）；报价 = 基础定价 + 上车加价 + 下车加价（一口价，已含）；哪里都不在转人工；没有结算价和加价区域的金额", async () => {
  const quote = async (pickup: keyof typeof P, dropoff: keyof typeof P | null): Promise<ApiResponse> => {
    api.clock.advance(1_000);
    const res = await site.call("POST", "/site/v1/quotes", { body: { category: "charter", city_id: m.ids.tokyo, pickup: P[pickup], ...(dropoff === null ? {} : { dropoff: P[dropoff] }), package_hours: 8, service_local: SERVICE_LOCAL, passengers: 2, luggage: 1 }, ip: nextIp() });
    assertMatchesOpenApi("POST", "/site/v1/quotes", res);
    return res;
  };
  // 下车地点必填（M8-15 暂为可选，M8-19 改回必填；/sales/v1 仍可选）：不给就 400，不管商品设没设区域加价
  const missing = await quote("tokyo", null);
  assert.deepEqual([missing.status, missing.body.error.details.issues.map((issue: any) => [issue.path, issue.reason])], [400, [["/dropoff", "REQUIRED"]]]);
  const price = async (pickup: keyof typeof P, dropoff: keyof typeof P): Promise<[string, boolean] | string[]> => {
    const res = await quote(pickup, dropoff);
    assert.equal(res.status, 200, res.text);
    return res.body.quotes.length > 0 ? [res.body.quotes[0].price.total.amount, res.body.quotes[0].includes_area_surcharge] : res.body.unavailable[0].reasons;
  };
  // 对外价 = 结算价 × 1.1（渠道默认加价 10%）
  assert.deepEqual(await price("tokyo", "tokyo2"), ["77000", false], "两端都在东京：和以前一样");
  assert.deepEqual(await price("tokyo", "fuji"), ["78100", true], "71,000 × 1.1");
  assert.deepEqual(await price("chiba", "fuji"), ["78650", true], "上车千叶 500 + 下车富士山 1000");
  assert.deepEqual(await price("chiba", "nowhere"), ["OUT_OF_SERVICE_AREA"], "下车点哪里都不在：转人工");
  const quoted = await quote("chiba", "fuji");
  const text = JSON.stringify(quoted.body);
  for (const key of ["settlement", "area_surcharge", "pickup_surcharge", "markup_bp"]) assert.ok(!allKeys(quoted.body).has(key), key);
  // 没设区域加价的商品（甲的大阪包车）：不给下车点同样 400；给了商品区域里的下车点照常报，价格和以前一样
  api.clock.advance(1_000);
  const osakaBody = { category: "charter", city_id: m.ids.osaka, pickup: P.osaka, package_hours: 8, service_local: SERVICE_LOCAL, passengers: 2, luggage: 1 };
  const osakaMissing = await site.call("POST", "/site/v1/quotes", { body: osakaBody, ip: nextIp() });
  assert.deepEqual([osakaMissing.status, osakaMissing.body.error.details.issues.map((issue: any) => [issue.path, issue.reason])], [400, [["/dropoff", "REQUIRED"]]]);
  api.clock.advance(1_000);
  const osaka = await site.call("POST", "/site/v1/quotes", { body: { ...osakaBody, dropoff: { lng: 135.52, lat: 34.69 } }, ip: nextIp() });
  assertMatchesOpenApi("POST", "/site/v1/quotes", osaka);
  assert.deepEqual(osaka.body.quotes.map((entry: any) => [entry.price.total.amount, entry.includes_area_surcharge]), [["66000", false]], osaka.text);
  assert.doesNotMatch(text.replace(/[0-9a-f-]{36}|QT\d{8}[0-9A-Z]+/gi, ""), /71500|70000|乙车队/);
});

test("官网包车下单：下车地址必填；订单存下车点；供应商详情只有加价的结算价（规则 4），运营详情另有对外价参考；甲读不到；旧订单没有这一项", async () => {
  api.clock.advance(1_000);
  const quoted = await site.call("POST", "/site/v1/quotes", { body: { category: "charter", city_id: m.ids.tokyo, pickup: P.chiba, dropoff: P.fuji, package_hours: 8, service_local: SERVICE_LOCAL, passengers: 2, luggage: 1 }, ip: nextIp() });
  const base = { quote_id: quoted.body.quotes[0].quote_id, passenger: PASSENGER, save_payment_method: true, pickup_address: "千叶站" };
  const noDropoff = await site.call("POST", "/site/v1/orders", { headers: { "idempotency-key": randomUUID() }, body: base, ip: nextIp() });
  assert.deepEqual([noDropoff.status, noDropoff.body.error.details.issues.map((issue: any) => [issue.path, issue.reason])], [400, [["/dropoff_address", "REQUIRED"]]]);
  const created = await site.call("POST", "/site/v1/orders", { headers: { "idempotency-key": randomUUID() }, body: { ...base, dropoff_address: "富士山五合目" }, ip: nextIp() });
  assert.equal(created.status, 201, created.text);
  const orderId = created.body.order.id as string;
  assert.deepEqual([created.body.order.dropoff, created.body.order.price.total.amount], [{ ...P.fuji, address: "富士山五合目" }, "78650"]);
  // M8-13：官网订单应答带「含区域加价」（只是布尔，不给金额、不给区域）；包车没有含公里数
  assert.deepEqual([created.body.order.includes_area_surcharge, created.body.order.distance], [true, null]);
  const intent = pay.intentOf(orderId);
  assert.ok(intent);
  pay.pay(intent.id);
  const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
  assert.equal((await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()))).status, 200);

  const tenant = await tenantCall(m.b, "GET", `/orders/${orderId}`);
  assertMatchesOpenApi("GET", "/tenant/v1/orders/{id}", tenant);
  assert.equal(tenant.status, 200, tenant.text);
  assert.deepEqual(tenant.body.area_surcharge, {
    package_settlement: { amount: "70000", currency: "JPY" },
    pickup: { area_id: charterB.chiba, area_name: { zh: "千叶" }, settlement: { amount: "500", currency: "JPY" } },
    dropoff: { area_id: charterB.fuji, area_name: { zh: "富士山" }, settlement: { amount: "1000", currency: "JPY" } },
  });
  assert.deepEqual([tenant.body.order.settlement.total.amount, tenant.body.order.settlement.base.amount, tenant.body.order.settlement.area_surcharge.pickup], ["71500", "71500", { area_id: charterB.chiba, amount: { amount: "500", currency: "JPY" } }]);
  assert.deepEqual(tenant.body.order.dropoff, { ...P.fuji, address: "富士山五合目" });
  for (const key of RULE4_KEYS) assert.ok(!allKeys(tenant.body).has(key), `供应商订单详情里有 ${key}`);
  assert.doesNotMatch(tenant.text.replace(/[0-9a-f-]{36}|NZ\d{8}[0-9A-Z]+/gi, ""), /78650|"550"|"1100"/);
  const listed = await tenantCall(m.b, "GET", "/orders");
  for (const key of RULE4_KEYS) assert.ok(!allKeys(listed.body).has(key), `供应商订单列表里有 ${key}`);

  const platform = await api.call("GET", `/platform/v1/orders/${orderId}`, { token: m.root });
  assertMatchesOperation("GET", "/platform/v1/orders/{id}", platform.status, platform.body);
  assert.deepEqual([platform.body.area_surcharge.pickup.settlement.amount, platform.body.area_surcharge.pickup.sell, platform.body.area_surcharge.dropoff.sell], ["500", { amount: "550", currency: "JPY" }, { amount: "1100", currency: "JPY" }]);

  assert.deepEqual([tenant.body.pricing_route, platform.body.pricing_route], [null, null], "包车没有「用的价格」（那是点对点的）");
  const guest = await site.call("GET", "/site/v1/order", { token: created.body.link.token, ip: nextIp() });
  assertMatchesOpenApi("GET", "/site/v1/order", guest);
  assert.deepEqual([guest.body.order.includes_area_surcharge, guest.body.order.distance, guest.body.order.price.total.amount], [true, null, "78650"]);
  for (const key of ["area_surcharge", "settlement", "pricing_route"]) assert.ok(!allKeys(guest.body).has(key), `官网订单里有 ${key}`);
  assert.doesNotMatch(guest.text.replace(/[0-9a-f-]{36}|NZ\d{8}[0-9A-Z]+/gi, ""), /"550"|"1100"|"500"|"1000"|千叶"|"富士山"/);

  assert.equal((await tenantCall(m.a, "GET", `/orders/${orderId}`)).status, 404, "甲读不到乙的单");
  // M8-15 之前下的单（结算价明细里没有区域加价）：显示照旧，这一项为 null
  await api.db.owner.query("update orders set settlement = settlement - 'areaSurcharge' where id = $1", [orderId]);
  const legacy = await tenantCall(m.b, "GET", `/orders/${orderId}`);
  assertMatchesOpenApi("GET", "/tenant/v1/orders/{id}", legacy);
  assert.deepEqual([legacy.body.area_surcharge, legacy.body.order.settlement.area_surcharge, legacy.body.order.settlement.total.amount], [null, null, "71500"]);
  const legacyGuest = await site.call("GET", "/site/v1/order", { token: created.body.link.token, ip: nextIp() });
  assert.equal(legacyGuest.body.order.includes_area_surcharge, false, "旧单不写「含区域加价」");
});

test("已下的订单不改：M8-15 之前下的包车单（没有下车点）改期照以前的算法——只看上车点、不加区域加价，商品后来设了区域加价也能改", async () => {
  api.clock.advance(1_000);
  const quoted = await site.call("POST", "/site/v1/quotes", { body: { category: "charter", city_id: m.ids.tokyo, pickup: P.tokyo, dropoff: P.tokyo2, package_hours: 8, service_local: SERVICE_LOCAL, passengers: 2, luggage: 1 }, ip: nextIp() });
  const created = await site.call("POST", "/site/v1/orders", { headers: { "idempotency-key": randomUUID() }, body: { quote_id: quoted.body.quotes[0].quote_id, passenger: PASSENGER, save_payment_method: true, pickup_address: "东京站", dropoff_address: "新宿站" }, ip: nextIp() });
  assert.equal(created.status, 201, created.text);
  const orderId = created.body.order.id as string;
  const intent = pay.intentOf(orderId);
  assert.ok(intent);
  pay.pay(intent.id);
  const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
  assert.equal((await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()))).status, 200);
  // 改成 M8-15 之前的样子：订单、报价快照里都没有下车点，结算价明细里没有区域加价
  await api.db.owner.query("update orders set dropoff = null, settlement = settlement - 'areaSurcharge' where id = $1", [orderId]);
  await api.db.owner.query("update quotes set snapshot = jsonb_set(snapshot, '{request,dropoff}', 'null'::jsonb) where id = $1", [quoted.body.quotes[0].quote_id]);
  const token = created.body.link.token as string;
  const view = await site.call("GET", "/site/v1/order", { token, ip: nextIp() });
  const moved = await site.call("PATCH", "/site/v1/order", { token, ip: nextIp(), headers: { "if-match": `"${view.body.order.version}"` }, body: { service_time: "2026-10-21T10:00:00+09:00" } });
  assert.equal(moved.status, 200, moved.text);
  const change = await api.db.owner.query<{ before: string; after: string }>("select settlement_before_minor::text as before, settlement_after_minor::text as after from order_changes where order_id = $1", [orderId]);
  assert.deepEqual(change.rows.map((row) => [row.before, row.after]), [["70000", "70000"]], "没有加上区域加价，也没有因为缺下车点而改不了");
});

test("渠道接口：包车不给下车地点时只报没设区域加价的商品，设了的给出原因 DROPOFF_REQUIRED；给了下车地点照常报（含加价）", async () => {
  const onlyB = await newChannel(api, m.staff.cm1.token, { name: "只卖乙的渠道", scope: { tenant_scope: "allow", tenant_ids: [m.b.tenantId] } });
  const creds = await salesCredentials(api, m, onlyB.id);
  const ask = (extra: Record<string, unknown>): Promise<ApiResponse> => {
    api.clock.advance(1_000);
    return api.call("POST", "/sales/v1/quotes", { token: creds.token, body: { city_id: m.ids.tokyo, category: "charter", pickup: P.tokyo, package_hours: 8, service_time: "2026-10-20T10:00:00+09:00", passengers: 2, luggage: 1, currency: "JPY", ...extra } });
  };
  const without = await ask({});
  assertMatchesOperation("POST", "/sales/v1/quotes", without.status, without.body);
  assert.deepEqual([without.status, without.body.quotes.length, without.body.unavailable], [200, 0, [{ vehicle_group_id: null, reasons: ["DROPOFF_REQUIRED"] }]]);
  const withDropoff = await ask({ dropoff: P.fuji });
  assertMatchesOperation("POST", "/sales/v1/quotes", withDropoff.status, withDropoff.body);
  assert.deepEqual(withDropoff.body.quotes.map((quote: any) => quote.price.total.amount), ["78100"]);
  // 甲的大阪包车没设区域加价：不给下车地点照常报（和以前一样只看上车点）
  const all = await newChannel(api, m.staff.cm1.token, { name: "全部渠道" });
  const allCreds = await salesCredentials(api, m, all.id, "198.51.100.11");
  api.clock.advance(1_000);
  const osaka = await api.call("POST", "/sales/v1/quotes", { token: allCreds.token, body: { city_id: m.ids.osaka, category: "charter", pickup: P.osaka, package_hours: 8, service_time: "2026-10-20T10:00:00+09:00", passengers: 2, luggage: 1, currency: "JPY" } });
  assert.deepEqual([osaka.status, osaka.body.quotes.map((quote: any) => quote.price.total.amount)], [200, ["66000"]], osaka.text);
});

test("加价区域被已上架的包车商品用着：不能停用、不能删除（409 AREA_IN_USE）；停用这条区域加价之后可以停用区域", async () => {
  for (const [method, path] of [["POST", `/areas/${charterB.hachioji}/disable`], ["DELETE", `/areas/${charterB.hachioji}`]] as const) {
    const res = await tenantCall(m.b, method, path);
    assert.deepEqual([res.status, res.body?.error?.code], [409, "AREA_IN_USE"], `${method} ${path}`);
  }
  const rule = (await ok(tenantCall(m.b, "GET", `/products/${charterB.id}/price-rules`))).items.find((item: any) => item.area_id === charterB.hachioji);
  const { id: _id, base: _base, created_at: _c, updated_at: _u, ...body } = rule;
  await ok(tenantCall(m.b, "PUT", `/products/${charterB.id}/price-rules/${rule.id}`, { version: await version(m.b, charterB.id), body: { ...body, status: "disabled" } }));
  const disabled = await tenantCall(m.b, "POST", `/areas/${charterB.hachioji}/disable`);
  assert.equal(disabled.status, 200, disabled.text);
});

test("一端落在几个区域：两个加价区域重叠时取小的（800 和 500 取 500）；一端同时在商品本身的区域和加价区域里时算 0", async () => {
  // 「千叶东」整个在千叶里面，上车加价 800；千叶是 500：千叶站那个点两个都在，取 500
  const chibaEast = await newArea(m.b, m.ids.tokyo, "千叶东", square(140.05, 35.6, 140.25, 35.8));
  // 「东京西」和商品本身的区域（东京 23 区）重叠，加价 300：东京那个点两个都在，商品本身的区域算 0
  const tokyoWest = await newArea(m.b, m.ids.tokyo, "东京西", square(139.45, 35.55, 139.75, 35.85));
  await ok(tenantCall(m.b, "POST", `/products/${charterB.id}/price-rules/batch`, { version: await version(m.b, charterB.id), body: { create: [surcharge(chibaEast, 800, 800), surcharge(tokyoWest, 300, 300)] } }));
  const preview = async (pickup: keyof typeof P, dropoff: keyof typeof P): Promise<any> => {
    const res = await tenantCall(m.b, "POST", `/products/${charterB.id}/quote-preview`, { body: { pickup: P[pickup], dropoff: P[dropoff], package_hours: 8, service_time: SERVICE_LOCAL, passengers: 2, luggage: 1, vehicle_group_ids: [m.ids.biz7] } });
    assertMatchesOpenApi("POST", "/tenant/v1/products/{id}/quote-preview", res);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.offers.length, 1, res.text);
    return res.body.offers[0].settlement;
  };
  const both = await preview("chiba", "tokyo");
  assert.deepEqual(both.area_surcharge, { package: 70_000, pickup: { area_id: charterB.chiba, price_rule_id: both.area_surcharge.pickup.price_rule_id, amount: 500 }, dropoff: { area_id: null, price_rule_id: null, amount: 0 } });
  assert.equal(both.total, 70_500, "70,000 + 上车 500（不是 800）+ 下车 0（不是 300）");
  const reverse = await preview("tokyo", "chiba");
  assert.deepEqual([reverse.area_surcharge.pickup, reverse.area_surcharge.dropoff.area_id, reverse.area_surcharge.dropoff.amount, reverse.total], [{ area_id: null, price_rule_id: null, amount: 0 }, charterB.chiba, 500, 70_500]);
});
