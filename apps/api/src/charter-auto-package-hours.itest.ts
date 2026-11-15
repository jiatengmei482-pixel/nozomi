/**
 * M9P-15（M9P-03 验收后续），经真实接口、真实 PostgreSQL：手动报档时应答的 `auto_package_hours` 和自动询价选的档对得上。
 * 复现测试站那一例的结构：两个商品各自按自己的价格选档——
 * - 甲：6h 40,000 含 100 公里、7h 50,000 含 200 公里（超公里 500 / 公里）→ 全程 200 公里时自己会选 7h（50,000 < 6h 的 90,000）；
 * - 乙：6h 60,000 含 200 公里、7h 80,000 含 200 公里 → 自己会选 6h。
 * 自动询价：甲 7h 50,000 比乙 6h 60,000 便宜，甲中标、7h。手动报 6h：甲 6h 90,000、乙 6h 60,000，乙中标——
 * 以前 auto_package_hours 取乙自己会选的 6h，和自动询价的 7h 不同（就是测试站看到的 6 和 7）；现在取同一行程自动询价中标的档 7h。
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
import type { AppContext } from "./context.ts";
import type { previewPlatformQuote } from "./services/quotes.ts";
import { type SalesQuote, comparisonAutoHours, withComparisonAuto } from "./services/sales-quotes.ts";

let api: TestApi;
let m: Market;
let site: SiteApi;
let charterA: string;
let charterB: string;

const square = (west: number, south: number, east: number, north: number) => ({ type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] });
const P = { shinjuku: { lng: 139.7, lat: 35.69 }, asakusa: { lng: 139.7967, lat: 35.7148 } } satisfies Record<string, LatLng>;
const SERVICE_LOCAL = "2026-10-20T10:00";
let ipSeq = 0;
const nextIp = (): string => `10.96.${(ipSeq += 1)}.9`;
/** 两段各 150 分钟、100 公里，停 60 分钟 → T = 6 小时、全程 200 公里 */
let routeCalls = 0;
const routeLookup = async (): Promise<RouteLookup> => {
  routeCalls += 1;
  return { ok: true, route: { meters: 100_000, minutes: 150 }, source: "google" };
};

async function tenantCall(who: TenantFixture, method: HttpMethod, path: string, options: { body?: unknown; version?: number } = {}): Promise<ApiResponse> {
  const token = await tenantLogin(api, who.adminEmail);
  api.clock.advance(1_000);
  return api.call(method, `/tenant/v1${path}`, {
    token,
    ...(options.body === undefined ? {} : { body: options.body }),
    headers: { ...(options.version === undefined ? {} : { "if-match": `"${options.version}"` }), ...(method === "POST" && /^\/(products|brands|areas)$|\/price-rules(\/batch)?$/.test(path) ? { "idempotency-key": randomUUID() } : {}) },
  });
}

async function newCharter(who: TenantFixture, packages: [number, number, number][]): Promise<string> {
  const area = (await ok(tenantCall(who, "POST", "/areas", { body: { city_id: m.ids.tokyo, name: { zh: "东京市内" }, biz_type: "charter", polygons: [{ kind: "operate", geometry: square(139.55, 35.52, 139.95, 35.85) }] } }), 201)).id;
  const brand = (await ok(tenantCall(who, "POST", "/brands", { body: { name: `包车-${randomUUID().slice(0, 6)}`, currency: "JPY" } }), 201)).id;
  const created = await ok(tenantCall(who, "POST", "/products", { body: { brand_id: brand, city_id: m.ids.tokyo, category: "charter", areas: [{ area_id: area }], vehicle_groups: [{ vehicle_group_id: m.ids.biz7, passengers: 6, luggage: 4 }], dispatchers: [{ name: "调度", phone: "0312345678" }] } }), 201);
  const rules = await ok(tenantCall(who, "PUT", `/products/${created.id}/service-rules`, { version: 1, body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { general: { mode: "limited", minutes: 0 } } } }));
  const content = await ok(tenantCall(who, "PUT", `/products/${created.id}/content`, { version: rules.version, body: { zh: { title: "东京包车" } } }));
  const rows = packages.map(([hours, price, km]) => ({ area_id: area, vehicle_group_id: m.ids.biz7, package_hours: hours, pricing_model: "charter_package", package_km: km, package_price: price, overtime_per_hour: 6_000, over_km_per_km: 500, valid_from: "2026-01-01" }));
  await ok(tenantCall(who, "POST", `/products/${created.id}/price-rules/batch`, { version: content.version, body: { create: rows } }));
  await ok(tenantCall(who, "POST", `/products/${created.id}/publish`));
  return created.id;
}

before(async () => {
  const pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay, quote: { routes: { estimate: routeLookup } } });
  m = await buildMarket(api);
  charterA = await newCharter(m.a, [[6, 40_000, 100], [7, 50_000, 200]]);
  charterB = await newCharter(m.b, [[6, 60_000, 200], [7, 80_000, 200]]);
  const channel = await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" });
  site = await siteApi(api, (await salesCredentials(api, m, channel.id)).clientId, pay, {}, { quote: { routes: { estimate: routeLookup } } });
  api.clock.advance(31_000);
});
after(async () => {
  await site?.close();
  await api.close();
});

async function quote(extra: Record<string, unknown> = {}): Promise<any> {
  api.clock.advance(1_000);
  const res = await site.call("POST", "/site/v1/quotes", { body: { category: "charter", city_id: m.ids.tokyo, pickup: P.shinjuku, dropoff: P.shinjuku, waypoints: [{ name: "景点", ...P.asakusa, stay_minutes: 60 }], itinerary_pricing: true, service_local: SERVICE_LOCAL, passengers: 2, luggage: 1, ...extra }, ip: nextIp() });
  assertMatchesOpenApi("POST", "/site/v1/quotes", res);
  assert.equal(res.status, 200, res.text);
  return res.body;
}
const winnerOf = async (quoteId: string): Promise<string | undefined> => (await api.db.owner.query<{ product_id: string }>("select product_id from quotes where id = $1", [quoteId])).rows[0]?.product_id;

test("手动报 6h 时另一个商品中标：auto_package_hours 仍是自动询价中标的 7h（以前是中标商品自己会选的 6h）；手动 7h、自动询价不受影响；不多记询价日志", async () => {
  const auto = await quote();
  assert.deepEqual([auto.quotes[0].package.hours, auto.quotes[0].auto_package_hours, auto.quotes[0].estimated_minutes, await winnerOf(auto.quotes[0].quote_id)], [7, 7, 360, charterA]);

  const logs = async (): Promise<number> => Number((await api.db.owner.query<{ count: string }>("select count(*) from quote_logs where category = 'charter'")).rows[0]?.count);
  const before = await logs();
  routeCalls = 0;
  const manual6 = await quote({ package_hours: 6 });
  assert.equal(routeCalls, 2, "两段路线各估一次：多比的那一次用已经估好的路线用量，不多调谷歌");
  assert.deepEqual([manual6.quotes[0].package.hours, await winnerOf(manual6.quotes[0].quote_id)], [6, charterB], "手动 6h：乙中标");
  assert.equal(manual6.quotes[0].auto_package_hours, 7, "和自动询价同一个档（官网下拉「自动（7 小时）」）");
  assert.equal(await logs(), before + 1, "多比的那一次只在内存里，不记询价日志");
  // 快照里中标商品自己会选的档照旧记着（乙 6h），应答按比价口径
  const snapshot = (await api.db.owner.query<{ snapshot: any }>("select snapshot from quotes where id = $1", [manual6.quotes[0].quote_id])).rows[0]?.snapshot;
  assert.equal(snapshot.winner.offer.autoPackageHours, 6);

  const manual7 = await quote({ package_hours: 7 });
  assert.deepEqual([manual7.quotes[0].package.hours, manual7.quotes[0].auto_package_hours, await winnerOf(manual7.quotes[0].quote_id)], [7, 7, charterA]);
  // 不按行程计价（不填经停、选套餐）：没有这一项
  api.clock.advance(1_000);
  const plain = await site.call("POST", "/site/v1/quotes", { body: { category: "charter", city_id: m.ids.tokyo, pickup: P.shinjuku, dropoff: P.shinjuku, package_hours: 6, service_local: SERVICE_LOCAL, passengers: 2, luggage: 1 }, ip: nextIp() });
  assert.equal(plain.status, 200, plain.text);
  assert.equal(plain.body.quotes[0].auto_package_hours, null);
});

test("多比的那一次出错：返回空表，手动报价照常报出、自动档为 null（不退回中标商品自己的档）；不是手动按行程计价时不多比", async () => {
  const failing = (async () => {
    throw new Error("模拟比价失败");
  }) as unknown as typeof previewPlatformQuote;
  const usage = { meters: 200_000, minutes: 360, legs: [], stayMinutes: 60 };
  const hours = await comparisonAutoHours({} as AppContext, { charterSelection: "manual", routeUsage: usage }, {} as Parameters<typeof previewPlatformQuote>[1], {}, failing);
  assert.deepEqual(hours, new Map());
  const quoteLike = { vehicleGroupId: "g", itinerary: { estimatedMinutes: 360, includesBuffer: false, autoPackageHours: 6 } } as unknown as SalesQuote;
  assert.equal(withComparisonAuto(quoteLike, hours ?? null).itinerary?.autoPackageHours, null);
  let called = false;
  const spy = (async () => {
    called = true;
    throw new Error("不该调");
  }) as unknown as typeof previewPlatformQuote;
  assert.equal(await comparisonAutoHours({} as AppContext, { charterSelection: "auto", routeUsage: usage }, {} as Parameters<typeof previewPlatformQuote>[1], {}, spy), null);
  assert.equal(await comparisonAutoHours({} as AppContext, { charterSelection: "manual" }, {} as Parameters<typeof previewPlatformQuote>[1], {}, spy), null);
  assert.equal(called, false);
});
