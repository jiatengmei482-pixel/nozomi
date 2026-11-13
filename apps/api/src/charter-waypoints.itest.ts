/**
 * M9W-01：包车途经加价和按行程计价（ADR 0088 及补充「最终报价公式」），经真实接口、真实 PostgreSQL；收款服务、路线估算用替身。
 * - 价格规则的「途经加价」waypoint_surcharge：批量新增、列表、日历、校验；导入导出往返（旧模版照旧导入、不清掉已有的途经加价）；
 * - 官网包车询价带经停点：业主原文 13.4 的 5 个算例、13.9 的验收用例（第 8 条按取消重下）；price_breakdown 各项之和 = 总价；
 * - 按行程计价：逐段估路线、按总时长选套餐、超公里 / 超时；某段路线取不到 422；
 * - 下单：订单存经停点（之后谁都不能改），供应商 / 运营详情、司机页能读到（司机没有价格）；改期按快照里的经停点重算；
 * - 规则 2：甲读不到、改不了乙的途经加价和订单经停点；司机链接只能读自己那一单；规则 4：/tenant/v1 扫键没有对外价和加价比例。
 * 测试数据全在本文件里经接口建出来，随测试 schema 一起删除（规则 1）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { LatLng, RouteLookup } from "@nozomi/domain";
import { XLSX_CONTENT_TYPE, type XlsxWriteCell, readXlsx, writeXlsx } from "./integrations/xlsx.ts";
import type { ApiResponse, HttpMethod, TenantFixture, TestApi } from "./testing/api.ts";
import { createTestApi } from "./testing/api.ts";
import { assign, newDriver, newVehicle } from "./testing/dispatch.ts";
import { type Market, allKeys, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi, assertMatchesOperation } from "./testing/openapi.ts";
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let site: SiteApi;
let charter: { id: string; tokyo: string; fuji: string; kamakura: string };

const square = (west: number, south: number, east: number, north: number) => ({ type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] });
const P = {
  shinjuku: { lng: 139.7, lat: 35.69 },
  asakusa: { lng: 139.8, lat: 35.71 },
  gogome: { lng: 138.73, lat: 35.39 },
  kawaguchiko: { lng: 138.76, lat: 35.5 },
  chureito: { lng: 138.8, lat: 35.5 },
  kawaguchikoStation: { lng: 138.77, lat: 35.49 },
  tsurugaoka: { lng: 139.556, lat: 35.326 },
  daibutsu: { lng: 139.536, lat: 35.317 },
  sendai: { lng: 140.87, lat: 38.27 },
  /** 路线替身对这个点算不出路线 */
  island: { lng: 139.6, lat: 34.0 },
} satisfies Record<string, LatLng>;
type Place = keyof typeof P;
const SERVICE_LOCAL = "2026-10-20T10:00";
const PASSENGER = { name: "陈小红", phone: "+81 90-2222-3333", email: "waypoint.guest@example.com" };
const RULE4_KEYS = ["sell", "sell_minor", "markup", "markup_bp", "fx_buffer_bp", "channel", "area_surcharge_sell", "price_breakdown"];
let ipSeq = 0;
const nextIp = (): string => `10.89.${(ipSeq += 1)}.9`;

/** 路线替身：每一段 130 公里、`legMinutes` 分钟；到海上那个点算不出 */
let legMinutes = 225;
const routeLookup = async (input: { from: LatLng; to: LatLng }): Promise<RouteLookup> =>
  input.to.lat === P.island.lat || input.from.lat === P.island.lat ? { ok: false, code: "NO_ROUTE" } : { ok: true, route: { meters: 130_000, minutes: legMinutes }, source: "google" };

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
async function newArea(who: TenantFixture, name: string, polygon: ReturnType<typeof square>, bizType = "general"): Promise<string> {
  return (await ok(tenantCall(who, "POST", "/areas", { body: { city_id: m.ids.tokyo, name: { zh: name }, biz_type: bizType, polygons: [{ kind: "operate", geometry: polygon }] } }), 201)).id;
}
const pkg = (areaId: string, hours: number, price: number, km: number) => ({ area_id: areaId, vehicle_group_id: m.ids.biz7, package_hours: hours, pricing_model: "charter_package", package_km: km, package_price: price, overtime_per_hour: 5_000, over_km_per_km: 300, valid_from: "2026-01-01" });
const surcharge = (areaId: string, hours: number, pickup: number, dropoff: number, waypoint: number | null) => ({ area_id: areaId, vehicle_group_id: m.ids.biz7, package_hours: hours, pricing_model: "charter_area_surcharge", pickup_surcharge: pickup, dropoff_surcharge: dropoff, ...(waypoint === null ? {} : { waypoint_surcharge: waypoint }), valid_from: "2026-01-01" });

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay, quote: { routes: { estimate: routeLookup } } });
  m = await buildMarket(api);
  const tokyo = await newArea(m.b, "东京 23 区", square(139.55, 35.55, 139.95, 35.85), "charter");
  const fuji = await newArea(m.b, "富士山地区", square(138.55, 35.25, 139.0, 35.55), "charter");
  const kamakura = await newArea(m.b, "镰仓", square(139.5, 35.28, 139.6, 35.36));
  const brand = (await ok(tenantCall(m.b, "POST", "/brands", { body: { name: `包车-${randomUUID().slice(0, 6)}`, currency: "JPY" } }), 201)).id;
  const created = await ok(tenantCall(m.b, "POST", "/products", { body: { brand_id: brand, city_id: m.ids.tokyo, category: "charter", areas: [{ area_id: tokyo }], vehicle_groups: [{ vehicle_group_id: m.ids.biz7, passengers: 6, luggage: 4 }], dispatchers: [{ name: "调度", phone: "0312345678" }] } }), 201);
  const rules = await ok(tenantCall(m.b, "PUT", `/products/${created.id}/service-rules`, { version: 1, body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { general: { mode: "limited", minutes: 0 } } } }));
  const content = await ok(tenantCall(m.b, "PUT", `/products/${created.id}/content`, { version: rules.version, body: { zh: { title: "途经加价包车" } } }));
  await ok(tenantCall(m.b, "POST", `/products/${created.id}/price-rules/batch`, { version: content.version, body: { create: [pkg(tokyo, 10, 55_000, 200), pkg(tokyo, 8, 50_000, 150)] } }));
  await ok(tenantCall(m.b, "POST", `/products/${created.id}/publish`));
  charter = { id: created.id, tokyo, fuji, kamakura };
  const channel = await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" });
  site = await siteApi(api, (await salesCredentials(api, m, channel.id)).clientId, pay, {}, { quote: { routes: { estimate: routeLookup } } });
});
after(async () => {
  await site?.close();
  await api.close();
});

test("价格规则的途经加价：批量新增（可以不填 = 没有规则）、列表、日历都带上；负数 400；没有对外价和加价比例（规则 4）", async () => {
  const saved = await tenantCall(m.b, "POST", `/products/${charter.id}/price-rules/batch`, {
    version: await version(m.b, charter.id),
    body: { create: [surcharge(charter.fuji, 10, 10_000, 10_000, 10_000), surcharge(charter.kamakura, 10, 6_000, 6_000, 6_000), surcharge(charter.fuji, 8, 10_000, 10_000, 10_000), surcharge(charter.kamakura, 8, 6_000, 6_000, null)] },
  });
  assertMatchesOpenApi("POST", "/tenant/v1/products/{id}/price-rules/batch", saved);
  assert.equal(saved.status, 200, saved.text);
  const listed = await tenantCall(m.b, "GET", `/products/${charter.id}/price-rules`);
  assertMatchesOpenApi("GET", "/tenant/v1/products/{id}/price-rules", listed);
  const rows = listed.body.items.filter((item: any) => item.pricing_model === "charter_area_surcharge").map((item: any) => [item.area_id === charter.fuji ? "fuji" : "kamakura", item.package_hours, item.waypoint_surcharge]).sort();
  assert.deepEqual(rows, [["fuji", 10, 10_000], ["fuji", 8, 10_000], ["kamakura", 10, 6_000], ["kamakura", 8, null]]);
  const stored = await api.db.owner.query<{ params: Record<string, unknown> }>("select params from price_rules where product_id = $1 and area_id = $2 and package_hours = 8", [charter.id, charter.kamakura]);
  assert.equal("waypointSurchargeMinor" in (stored.rows[0]?.params ?? {}), false, "没填就不存这个键（和以前的规则一样）");
  const bad = await tenantCall(m.b, "POST", `/products/${charter.id}/price-rules`, { version: await version(m.b, charter.id), body: { ...surcharge(charter.kamakura, 4, 1, 1, -1) } });
  assert.deepEqual([bad.status, bad.body.error.details.issues.map((issue: any) => [issue.path, issue.reason])], [400, [["/waypoint_surcharge", "OUT_OF_RANGE"]]]);
  const calendar = await tenantCall(m.b, "GET", `/products/${charter.id}/price-calendar?area_id=${charter.fuji}&vehicle_group_id=${m.ids.biz7}&package_hours=10&from=2026-10-20&to=2026-10-20`);
  assertMatchesOpenApi("GET", "/tenant/v1/products/{id}/price-calendar", calendar);
  assert.equal(calendar.body.days[0].surcharge.waypoint_surcharge, 10_000);
  for (const res of [saved, listed, calendar]) for (const key of RULE4_KEYS) assert.ok(!allKeys(res.body).has(key), key);
});

test("规则 2：甲读不到、改不了乙的途经加价（列表、修改、删除 404），乙的规则没被动过", async () => {
  const rule = (await ok(tenantCall(m.b, "GET", `/products/${charter.id}/price-rules`))).items.find((item: any) => item.area_id === charter.fuji && item.package_hours === 10);
  const tokenA = await tenantLogin(api, m.a.adminEmail);
  const v = await version(m.b, charter.id);
  const { id: _id, base: _base, created_at: _c, updated_at: _u, ...body } = rule;
  for (const [method, path, payload] of [
    ["GET", `/products/${charter.id}/price-rules`, undefined],
    ["PUT", `/products/${charter.id}/price-rules/${rule.id}`, { ...body, waypoint_surcharge: 1 }],
    ["POST", `/products/${charter.id}/price-rules/batch`, { update: [{ ...body, id: rule.id, waypoint_surcharge: 1 }] }],
    ["DELETE", `/products/${charter.id}/price-rules/${rule.id}`, undefined],
  ] as [HttpMethod, string, unknown][]) {
    const res = await tenantCall(tokenA, method, path, { version: v, ...(payload === undefined ? {} : { body: payload }) });
    assert.equal(res.status, 404, `${method} ${path}：${res.text}`);
  }
  const unchanged = await ok(tenantCall(m.b, "GET", `/products/${charter.id}/price-rules`));
  assert.deepEqual(unchanged.items.find((item: any) => item.id === rule.id), rule);
});

test("导入导出往返：导出带「途经加价」列；原样导回全部「不变」；改一格是修改；旧模版（没有这一列）照旧导入，不清掉已有的途经加价", async () => {
  const token = await tenantLogin(api, m.b.adminEmail);
  const exported = await api.app.inject({ method: "GET", url: `/tenant/v1/products/${charter.id}/price-rules/export`, headers: { authorization: `Bearer ${token}` } });
  assert.equal(exported.statusCode, 200);
  const sheet = readXlsx(exported.rawPayload).map((cells) => cells.map((cell) => (cell.type === "text" || cell.type === "number" ? cell.text : null)));
  const header = sheet[0] as string[];
  const col = (name: string): number => header.indexOf(name);
  assert.ok(col("途经加价") === col("下车加价") + 1, "途经加价跟在下车加价后面");
  const fujiRow = sheet.find((row) => row[col("区域")] === "富士山地区" && row[col("套餐时长(小时)")] === "10");
  assert.equal(fujiRow?.[col("途经加价")], "10000");
  const upload = async (rows: (string | null)[][], path: string, extra: Record<string, string> = {}): Promise<ApiResponse> => {
    api.clock.advance(1_000);
    const cells = rows.map((row, index) => (index === 0 ? row : row.map((cell): XlsxWriteCell => (cell !== null && /^-?\d+$/.test(cell) && !cell.startsWith("0") ? { number: cell } : cell))));
    const res = await api.app.inject({ method: "POST", url: `/tenant/v1/products/${charter.id}${path}`, payload: writeXlsx([{ name: "价格", rows: cells as XlsxWriteCell[][] }]), headers: { "content-type": XLSX_CONTENT_TYPE, authorization: `Bearer ${token}`, ...extra } });
    return { status: res.statusCode, headers: res.headers, text: res.body, body: res.json() };
  };
  const same = await upload(sheet, "/price-rules/import/preview");
  assertMatchesOpenApi("POST", "/tenant/v1/products/{id}/price-rules/import/preview", same);
  assert.equal(same.status, 200, same.text);
  assert.deepEqual([...new Set(same.body.rows.map((row: any) => row.action))], ["unchanged"], same.text);
  const kamakura8 = sheet.findIndex((row) => row[col("区域")] === "镰仓" && row[col("套餐时长(小时)")] === "8");
  const edited = sheet.map((row, index) => (index === kamakura8 ? row.map((cell, at) => (at === col("途经加价") ? "500" : cell)) : row));
  const preview = await upload(edited, "/price-rules/import/preview");
  assert.deepEqual(preview.body.rows.filter((row: any) => row.action !== "unchanged").map((row: any) => [row.action, row.content.surcharge]), [["update", { pickup: 6_000, dropoff: 6_000, waypoint: 500 }]]);
  const imported = await upload(edited, `/price-rules/import?file_sha256=${preview.body.file_sha256}`, { "if-match": `"${preview.body.version}"`, "idempotency-key": randomUUID() });
  assert.equal(imported.status, 200, imported.text);
  const after1 = await ok(tenantCall(m.b, "GET", `/products/${charter.id}/price-rules`));
  assert.equal(after1.items.find((item: any) => item.area_id === charter.kamakura && item.package_hours === 8).waypoint_surcharge, 500);
  // 旧模版：去掉「途经加价」这一列，修改上车加价——途经加价照旧（500），不被清掉
  const oldHeader = header.filter((name) => name !== "途经加价");
  const drop = col("途经加价");
  const fresh = readXlsx((await api.app.inject({ method: "GET", url: `/tenant/v1/products/${charter.id}/price-rules/export`, headers: { authorization: `Bearer ${token}` } })).rawPayload).map((cells) => cells.map((cell) => (cell.type === "text" || cell.type === "number" ? cell.text : null)));
  const oldRows = [oldHeader, ...fresh.slice(1).filter((row) => row[col("区域")] === "镰仓" && row[col("套餐时长(小时)")] === "8").map((row) => row.filter((_, at) => at !== drop).map((cell, at) => (at === oldHeader.indexOf("上车加价") ? "6100" : cell)))];
  const oldPreview = await upload(oldRows, "/price-rules/import/preview");
  assert.deepEqual(oldPreview.body.rows.map((row: any) => [row.action, row.content.surcharge]), [["update", { pickup: 6_100, dropoff: 6_000, waypoint: null }]], oldPreview.text);
  const oldImported = await upload(oldRows, `/price-rules/import?file_sha256=${oldPreview.body.file_sha256}`, { "if-match": `"${oldPreview.body.version}"`, "idempotency-key": randomUUID() });
  assert.equal(oldImported.status, 200, oldImported.text);
  const after2 = (await ok(tenantCall(m.b, "GET", `/products/${charter.id}/price-rules`))).items.find((item: any) => item.area_id === charter.kamakura && item.package_hours === 8);
  assert.deepEqual([after2.pickup_surcharge, after2.waypoint_surcharge], [6_100, 500]);
});

/** 官网包车询价（10 小时套餐，或按行程计价） */
async function quote(pickup: Place, stops: Place[] | undefined, dropoff: Place, extra: Record<string, unknown> = {}): Promise<ApiResponse> {
  api.clock.advance(1_000);
  const waypoints = stops?.map((place, index) => ({ name: `景点 ${index + 1}`, lat: P[place].lat, lng: P[place].lng, stay_minutes: 30 }));
  const res = await site.call("POST", "/site/v1/quotes", { body: { category: "charter", city_id: m.ids.tokyo, pickup: P[pickup], dropoff: P[dropoff], ...(waypoints === undefined ? {} : { waypoints }), package_hours: 10, service_local: SERVICE_LOCAL, passengers: 2, luggage: 1, ...extra }, ip: nextIp() });
  assertMatchesOpenApi("POST", "/site/v1/quotes", res);
  return res;
}
const total = (res: ApiResponse): string | string[] => (res.body.quotes.length > 0 ? res.body.quotes[0].price.total.amount : res.body.unavailable[0].reasons);
const breakdownSum = (entry: any): number => entry.price_breakdown.reduce((sum: number, item: any) => sum + Number(item.amount.amount), 0);

test("13.4 的 5 个算例（客人价 = 结算价 × 1.1）；price_breakdown 逐项、各项之和等于总价；没有结算价", async () => {
  const cases: [Place, Place[], Place, string][] = [
    ["shinjuku", ["gogome", "kawaguchiko", "chureito"], "shinjuku", "71500"],
    ["shinjuku", ["tsurugaoka", "daibutsu"], "shinjuku", "67100"],
    ["shinjuku", ["daibutsu", "kawaguchiko"], "shinjuku", "78100"],
    ["shinjuku", ["gogome"], "kawaguchikoStation", "71500"],
    ["shinjuku", ["asakusa"], "shinjuku", "60500"],
  ];
  for (const [pickup, stops, dropoff, expected] of cases) {
    const res = await quote(pickup, stops, dropoff);
    assert.equal(res.status, 200, res.text);
    assert.equal(total(res), expected, `${pickup} → ${stops.join(" → ")} → ${dropoff}`);
    assert.equal(breakdownSum(res.body.quotes[0]), Number(expected));
  }
  const three = await quote("shinjuku", ["daibutsu", "kawaguchiko"], "shinjuku");
  assert.deepEqual(three.body.quotes[0].price_breakdown.map((item: any) => [item.kind, item.amount.amount, item.area_name, item.stop_seqs]), [
    ["base", "60500", null, null],
    ["waypoint", "6600", { zh: "镰仓" }, [1]],
    ["waypoint", "11000", { zh: "富士山地区" }, [2]],
  ]);
  assert.equal(three.body.quotes[0].includes_area_surcharge, true);
  for (const key of ["settlement", "area_surcharge", "markup_bp", "waypoint_surcharge"]) assert.ok(!allKeys(three.body).has(key), key);
  // 下车已在富士山：只有下车加价
  const station = await quote("shinjuku", ["gogome"], "kawaguchikoStation");
  assert.deepEqual(station.body.quotes[0].price_breakdown.map((item: any) => [item.kind, item.amount.amount]), [["base", "60500"], ["dropoff", "11000"]]);
  // 报价快照锁定经停点（名称、坐标、停留分钟）
  const snapshot = await api.db.owner.query<{ snapshot: any }>("select snapshot from quotes where id = $1", [three.body.quotes[0].quote_id]);
  assert.deepEqual(snapshot.rows[0]?.snapshot.request.waypoints, [{ name: "景点 1", ...P.daibutsu, stay_minutes: 30 }, { name: "景点 2", ...P.kawaguchiko, stay_minutes: 30 }]);
});

test("13.9 用例 1–7：同区一次、两区各一次、下车同区只收下车、东京市内不加、不在任何区域转人工并指出第几个、不填途经点和现在完全一致", async () => {
  assert.equal(total(await quote("shinjuku", ["gogome", "kawaguchiko", "chureito"], "shinjuku")), "71500");
  assert.equal(total(await quote("shinjuku", ["tsurugaoka", "gogome", "daibutsu", "chureito"], "shinjuku")), "78100");
  assert.equal(total(await quote("shinjuku", ["gogome", "chureito"], "kawaguchikoStation")), "71500");
  assert.equal(total(await quote("shinjuku", ["asakusa", "shinjuku"], "shinjuku")), "60500");
  const nowhere = await quote("shinjuku", ["gogome", "sendai"], "shinjuku");
  assert.deepEqual([nowhere.body.quotes, nowhere.body.unavailable], [[], [{ vehicle_group_id: null, reasons: ["WAYPOINT_NOT_PRICED"], waypoint_stop_seqs: [2] }]]);
  // 用例 7：不填途经点 / 填空数组，应答和快照的请求都和以前一样（快照里没有 waypoints）
  const plain = await quote("shinjuku", undefined, "shinjuku");
  const empty = await quote("shinjuku", [], "shinjuku");
  assert.deepEqual([total(plain), total(empty)], ["60500", "60500"]);
  assert.deepEqual(plain.body.quotes[0].price_breakdown.map((item: any) => item.kind), ["base"]);
  const snapshots = await api.db.owner.query<{ snapshot: any }>("select snapshot from quotes where id = any($1::text[])", [[plain.body.quotes[0].quote_id, empty.body.quotes[0].quote_id]]);
  for (const row of snapshots.rows) assert.equal("waypoints" in row.snapshot.request, false);
  // 别的品类给经停点：400 NOT_APPLICABLE
  api.clock.advance(1_000);
  const p2p = await site.call("POST", "/site/v1/quotes", { body: { category: "point_to_point", city_id: m.ids.tokyo, pickup: P.shinjuku, dropoff: P.asakusa, waypoints: [{ name: "x", ...P.asakusa, stay_minutes: 0 }], service_local: SERVICE_LOCAL, passengers: 2, luggage: 1 }, ip: nextIp() });
  assert.deepEqual([p2p.status, p2p.body.error.details.issues.map((issue: any) => [issue.path, issue.reason])], [400, [["/waypoints", "NOT_APPLICABLE"]]]);
  const tooMany = await quote("shinjuku", Array.from({ length: 11 }, () => "gogome" as Place), "shinjuku");
  assert.equal(tooMany.status, 400);
});

async function placeAndPay(quoteId: string): Promise<{ orderId: string; token: string; body: any }> {
  const created = await site.call("POST", "/site/v1/orders", { headers: { "idempotency-key": randomUUID() }, body: { quote_id: quoteId, passenger: PASSENGER, save_payment_method: true, pickup_address: "新宿站", dropoff_address: "新宿站" }, ip: nextIp() });
  assert.equal(created.status, 201, created.text);
  const orderId = created.body.order.id as string;
  const intent = pay.intentOf(orderId);
  assert.ok(intent);
  pay.pay(intent.id);
  const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
  assert.equal((await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()))).status, 200);
  return { orderId, token: created.body.link.token as string, body: created.body };
}

test("下单：订单存经停点（之后谁都不能改）；供应商详情只有结算价、运营详情另有对外价参考；甲读不到；司机页有经停点、没有价格；改期按快照的经停点重算", async () => {
  const quoted = await quote("shinjuku", ["daibutsu", "kawaguchiko"], "shinjuku");
  const { orderId, token, body } = await placeAndPay(quoted.body.quotes[0].quote_id);
  const expectedStops = [{ name: "景点 1", ...P.daibutsu, stay_minutes: 30 }, { name: "景点 2", ...P.kawaguchiko, stay_minutes: 30 }];
  assert.deepEqual([body.order.waypoints, body.order.price.total.amount], [expectedStops, "78100"]);
  const row = await api.db.owner.query<{ waypoints: unknown }>("select waypoints from orders where id = $1", [orderId]);
  assert.deepEqual(row.rows[0]?.waypoints, expectedStops);

  const tenant = await tenantCall(m.b, "GET", `/orders/${orderId}`);
  assertMatchesOpenApi("GET", "/tenant/v1/orders/{id}", tenant);
  assert.deepEqual(tenant.body.order.waypoints, expectedStops);
  assert.deepEqual(tenant.body.area_surcharge.waypoints, [
    { area_id: charter.kamakura, area_name: { zh: "镰仓" }, settlement: { amount: "6000", currency: "JPY" }, stop_seqs: [1] },
    { area_id: charter.fuji, area_name: { zh: "富士山地区" }, settlement: { amount: "10000", currency: "JPY" }, stop_seqs: [2] },
  ]);
  assert.equal(tenant.body.order.settlement.total.amount, "71000");
  for (const key of RULE4_KEYS) assert.ok(!allKeys(tenant.body).has(key), `供应商订单详情里有 ${key}`);
  assert.doesNotMatch(tenant.text.replace(/[0-9a-f-]{36}|NZ\d{8}[0-9A-Z]+/gi, ""), /78100|"6600"|"11000"/);
  const platform = await api.call("GET", `/platform/v1/orders/${orderId}`, { token: m.root });
  assertMatchesOperation("GET", "/platform/v1/orders/{id}", platform.status, platform.body);
  assert.deepEqual([platform.body.order.waypoints, platform.body.area_surcharge.waypoints.length], [expectedStops, 2]);

  // 规则 2：甲读不到乙的单（也就读不到经停点）
  assert.equal((await tenantCall(m.a, "GET", `/orders/${orderId}`)).status, 404);
  const listedA = await tenantCall(m.a, "GET", "/orders");
  assert.ok(!JSON.stringify(listedA.body).includes("景点 1"));

  // 司机：自己那一单有经停点、没有任何价格
  const tenantToken = await tenantLogin(api, m.b.adminEmail);
  const who = { ...m.b, adminToken: tenantToken };
  const link = await ok(assign(api, who, orderId, (await newDriver(api, who)).id, (await newVehicle(api, who, m.ids.biz7)).id));
  const trip = await api.call("GET", "/driver/v1/trip", { token: link.driver_link.token });
  assertMatchesOpenApi("GET", "/driver/v1/trip", trip);
  assert.deepEqual([trip.body.order.waypoints, trip.body.order.itinerary], [expectedStops, null]);
  for (const key of ["price", "settlement", "area_surcharge", "price_breakdown", "sell"]) assert.ok(!allKeys(trip.body).has(key), `司机页里有 ${key}`);
  assert.doesNotMatch(trip.text, /78100|71000|"6000"|"10000"/);

  // 经停点下单后谁都不能改（平台账号、表的所有者都一样）
  await assert.rejects(api.db.owner.query("update orders set waypoints = '[]'::jsonb where id = $1", [orderId]), /经停点下单后不能改/);
  await api.db.owner.query("update orders set waypoints = waypoints where id = $1", [orderId]);

  // 改期：按报价快照里的经停点重算，途经加价照收
  const view = await site.call("GET", "/site/v1/order", { token, ip: nextIp() });
  assertMatchesOpenApi("GET", "/site/v1/order", view);
  assert.deepEqual(view.body.order.waypoints, expectedStops);
  // M9W-04：没按行程计价（选了套餐时长）的单不给对外价明细，订单页和以前一样
  assert.equal(view.body.price_breakdown, null);
  const moved = await site.call("PATCH", "/site/v1/order", { token, ip: nextIp(), headers: { "if-match": `"${view.body.order.version}"` }, body: { service_time: "2026-10-21T10:00:00+09:00" } });
  assert.equal(moved.status, 200, moved.text);
  const change = await api.db.owner.query<{ before: string; after: string }>("select settlement_before_minor::text as before, settlement_after_minor::text as after from order_changes where order_id = $1", [orderId]);
  assert.deepEqual(change.rows.map((entry) => [entry.before, entry.after]), [["71000", "71000"]]);
});

test("13.9 用例 8（按取消重下）：下单后要去掉一个途经区域——取消原单，重新询价下单，新价少了镰仓的途经加价", async () => {
  const both = await quote("shinjuku", ["daibutsu", "kawaguchiko"], "shinjuku");
  const first = await placeAndPay(both.body.quotes[0].quote_id);
  const cancelled = await site.call("POST", "/site/v1/order/cancel", { token: first.token, ip: nextIp(), body: {} });
  assert.equal(cancelled.status, 200, cancelled.text);
  assert.equal(cancelled.body.order.status, "cancelled");
  const fujiOnly = await quote("shinjuku", ["kawaguchiko"], "shinjuku");
  const second = await placeAndPay(fujiOnly.body.quotes[0].quote_id);
  assert.deepEqual([first.body.order.price.total.amount, second.body.order.price.total.amount], ["78100", "71500"]);
  assert.deepEqual(second.body.order.waypoints, [{ name: "景点 1", ...P.kawaguchiko, stay_minutes: 30 }]);
});

test("按行程计价：逐段估路线、按总时长选套餐（能覆盖的最小套餐）、超公里 / 超时；明细 6 项、之和等于总价；锁进快照和订单", async () => {
  legMinutes = 225;
  // 两段各 130 公里、225 分钟，停留 90 → 总时长 540 分钟（9 小时）→ 10 小时套餐（含 200 公里）；超公里 60 × 300 = 18,000；途经富士山 10,000
  api.clock.advance(1_000);
  const body = { category: "charter", city_id: m.ids.tokyo, pickup: P.shinjuku, dropoff: P.shinjuku, waypoints: [{ name: "河口湖", ...P.kawaguchiko, stay_minutes: 90 }], itinerary_pricing: true, service_local: SERVICE_LOCAL, passengers: 2, luggage: 1 };
  const res = await site.call("POST", "/site/v1/quotes", { body, ip: nextIp() });
  assertMatchesOpenApi("POST", "/site/v1/quotes", res);
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.body.itinerary_route, { legs: [{ minutes: 225, meters: 130_000 }, { minutes: 225, meters: 130_000 }], drive_minutes: 450, stay_minutes: 90, total_minutes: 540, total_meters: 260_000 });
  const offer = res.body.quotes[0];
  assert.deepEqual([offer.package.hours, offer.price.total.amount], [10, String(((55_000 + 10_000 + 18_000) * 11) / 10)]);
  assert.deepEqual(offer.price_breakdown.map((item: any) => [item.kind, item.amount.amount]), [["base", "60500"], ["waypoint", "11000"], ["over_km", "19800"], ["overtime", "0"]]);
  assert.equal(breakdownSum(offer), Number(offer.price.total.amount));
  const snapshot = (await api.db.owner.query<{ snapshot: any }>("select snapshot from quotes where id = $1", [offer.quote_id])).rows[0]?.snapshot;
  assert.deepEqual([snapshot.request.routeUsage.meters, snapshot.request.routeUsage.minutes, snapshot.request.packageHours, snapshot.winner.offer.settlement.itinerary.overKmMinor], [260_000, 540, 10, 18_000]);

  // 停留更久：总时长 650 分钟超过最大套餐 → 10 小时套餐 + 超时 50 分钟（5,000 / 小时）
  api.clock.advance(1_000);
  const longer = await site.call("POST", "/site/v1/quotes", { body: { ...body, waypoints: [{ name: "河口湖", ...P.kawaguchiko, stay_minutes: 200 }] }, ip: nextIp() });
  const longOffer = longer.body.quotes[0];
  assert.equal(longOffer.package.hours, 10);
  assert.ok(Number(longOffer.price_breakdown.find((item: any) => item.kind === "overtime").amount.amount) > 0);
  assert.equal(breakdownSum(longOffer), Number(longOffer.price.total.amount));
  // 短行程：总时长 4 小时 → 8 小时套餐（含 150 公里；全程 260 公里超 110 公里）
  legMinutes = 90;
  api.clock.advance(1_000);
  const short = await site.call("POST", "/site/v1/quotes", { body: { ...body, waypoints: [{ name: "河口湖", ...P.kawaguchiko, stay_minutes: 60 }] }, ip: nextIp() });
  assert.deepEqual([short.body.quotes[0].package.hours, short.body.quotes[0].price.total.amount], [8, String(((50_000 + 10_000 + 110 * 300) * 11) / 10)]);
  legMinutes = 225;

  // 下单：订单的套餐时长是选中的，行程锁定量随结算价明细；司机页能看到全程（没有金额）
  const placed = await placeAndPay(offer.quote_id);
  assert.deepEqual([placed.body.order.package_hours, placed.body.order.itinerary], [10, { route_meters: 260_000, route_minutes: 540, package_km: 200, package_minutes: 600, over_meters: 60_000, overtime_minutes: 0 }]);
  const tenant = await tenantCall(m.b, "GET", `/orders/${placed.orderId}`);
  assertMatchesOpenApi("GET", "/tenant/v1/orders/{id}", tenant);
  assert.deepEqual([tenant.body.order.settlement.itinerary.over_km_fee.amount, tenant.body.order.settlement.total.amount], ["18000", "83000"]);
  for (const key of RULE4_KEYS) assert.ok(!allKeys(tenant.body).has(key), key);

  // M9W-04：官网订单页给下单时那份对外价明细（和报价时一模一样，之和等于订单总价）；运营详情的结算价明细有超公里 / 超时的量、单价和钱
  const guestView = await site.call("GET", "/site/v1/order", { token: placed.token, ip: nextIp() });
  assertMatchesOpenApi("GET", "/site/v1/order", guestView);
  assert.deepEqual(guestView.body.price_breakdown, offer.price_breakdown);
  assert.deepEqual(placed.body.price_breakdown, offer.price_breakdown);
  assert.equal(guestView.body.price_breakdown.reduce((sum: number, item: any) => sum + Number(item.amount.amount), 0), Number(guestView.body.order.price.total.amount));
  assert.deepEqual(guestView.body.price_breakdown.find((item: any) => item.kind === "waypoint").area_name, { zh: "富士山地区" });
  const platformView = await api.call("GET", `/platform/v1/orders/${placed.orderId}`, { token: m.root });
  assertMatchesOperation("GET", "/platform/v1/orders/{id}", platformView.status, platformView.body);
  const lockedItinerary = platformView.body.order.settlement.itinerary;
  assert.deepEqual([lockedItinerary.over_meters, lockedItinerary.over_km_per_km.amount, lockedItinerary.over_km_fee.amount, lockedItinerary.overtime_minutes, lockedItinerary.overtime_per_hour.amount, lockedItinerary.overtime_fee.amount], [60_000, "300", "18000", 0, "5000", "0"]);
  // 改期重算过价、总价变了：明细和现在的总价对不上就不给（页面只显示总价）
  await api.db.owner.query("update order_sales set sell_minor = sell_minor + 100 where order_id = $1", [placed.orderId]);
  const repriced = await site.call("GET", "/site/v1/order", { token: placed.token, ip: nextIp() });
  assert.equal(repriced.body.price_breakdown, null);
  await api.db.owner.query("update order_sales set sell_minor = sell_minor - 100 where order_id = $1", [placed.orderId]);

  // 参数检查：按行程计价不填套餐时长；别的品类不能按行程计价；某一段路线取不到 422
  api.clock.advance(1_000);
  const withHours = await site.call("POST", "/site/v1/quotes", { body: { ...body, package_hours: 10 }, ip: nextIp() });
  assert.deepEqual([withHours.status, withHours.body.error.details.issues.map((issue: any) => [issue.path, issue.reason])], [400, [["/package_hours", "NOT_APPLICABLE"]]]);
  api.clock.advance(1_000);
  const noRoute = await site.call("POST", "/site/v1/quotes", { body: { ...body, waypoints: [{ name: "河口湖", ...P.kawaguchiko, stay_minutes: 30 }, { name: "海上", ...P.island, stay_minutes: 30 }] }, ip: nextIp() });
  assertMatchesOpenApi("POST", "/site/v1/quotes", noRoute);
  assert.deepEqual([noRoute.status, noRoute.body.error.code, noRoute.body.error.details.leg], [422, "ITINERARY_ROUTE_UNAVAILABLE", 2]);
  api.clock.advance(1_000);
  const p2p = await site.call("POST", "/site/v1/quotes", { body: { category: "point_to_point", city_id: m.ids.tokyo, pickup: P.shinjuku, dropoff: P.asakusa, itinerary_pricing: true, service_local: SERVICE_LOCAL, passengers: 2, luggage: 1 }, ip: nextIp() });
  assert.deepEqual([p2p.status, p2p.body.error?.details?.issues?.[0]?.path], [400, "/itinerary_pricing"]);
});
