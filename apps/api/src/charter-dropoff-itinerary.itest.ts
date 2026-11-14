/**
 * M9P-01（ADR 0093 第二节；业主规格 docs/requirements/charter-pricing-spec-2026-11-14.md 步骤 4、第六节用例 2–7、16–19），经真实接口、真实 PostgreSQL：
 * - 官网包车询价：经停的行程加价不再被上 / 下车加价抵消；下车点行程加价（默认开）；明细里那一项 `from_dropoff: true`；
 * - 服务规则 `charter_itinerary.dropoff_itinerary_surcharge`：读默认开、关掉后用例 19、PUT 不带键保留原值、别的品类不能设、甲读不到改不了乙的；
 * - 部署前格式的订单（快照、结算价是旧算法算的）改期：加价按新算法重算，超时费照旧；
 * - 救援差价基准（救援 B）：旧单救援时差价不含新算法多出来的加价；用车前 6 小时、供应商被暂停时触发都算出基准；
 *   候选列表上的差价和改派后记的一致、`basis` 四项齐全；原供应商触发前调高套餐价差价不变；重算失败退回原结算价。
 * 测试数据全在本文件里经接口建出来（个别「部署前格式」直接改库模拟），随测试 schema 一起删除（规则 1）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { LatLng, RouteLookup } from "@nozomi/domain";
import type { ApiResponse, HttpMethod, TenantFixture, TestApi } from "./testing/api.ts";
import { createTestApi } from "./testing/api.ts";
import { type Market, allKeys, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { platformLogin, tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

const HOUR = 3_600_000;

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let site: SiteApi;
/** 乙、甲各一个东京包车（价格按规格：10h 55,000（甲 55,500）；富士山、箱根 10,000，三格同值） */
let charterB: Charter;
let charterA: Charter;
interface Charter {
  id: string;
  tokyo: string;
  fuji: string;
  hakone: string;
}

const square = (west: number, south: number, east: number, north: number) => ({ type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] });
const P = {
  shinjuku: { lng: 139.7, lat: 35.69 },
  asakusa: { lng: 139.7967, lat: 35.7148 },
  kawaguchiko: { lng: 138.75, lat: 35.516 },
  kawaguchikoStation: { lng: 138.7689, lat: 35.4983 },
  oshino: { lng: 138.8325, lat: 35.4606 },
  ashinoko: { lng: 139.025, lat: 35.205 },
} satisfies Record<string, LatLng>;
type Place = keyof typeof P;
const SERVICE_LOCAL = "2026-10-20T10:00";
const PASSENGER = { name: "林小明", phone: "+81 90-3333-4444", email: "dropoff.guest@example.com" };
let ipSeq = 0;
const nextIp = (): string => `10.93.${(ipSeq += 1)}.9`;
/** 路线替身：每段 100 公里、`legMinutes` 分钟 */
let legMinutes = 120;
const routeLookup = async (): Promise<RouteLookup> => ({ ok: true, route: { meters: 100_000, minutes: legMinutes }, source: "google" });

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

async function newCharter(who: TenantFixture, package10: number): Promise<Charter> {
  const area = async (name: string, polygon: ReturnType<typeof square>): Promise<string> => (await ok(tenantCall(who, "POST", "/areas", { body: { city_id: m.ids.tokyo, name: { zh: name }, biz_type: "charter", polygons: [{ kind: "operate", geometry: polygon }] } }), 201)).id;
  const tokyo = await area("东京市内", square(139.55, 35.52, 139.95, 35.85));
  const fuji = await area("富士山", square(138.6, 35.4, 138.95, 35.6));
  const hakone = await area("箱根", square(138.95, 35.15, 139.15, 35.3));
  const brand = (await ok(tenantCall(who, "POST", "/brands", { body: { name: `包车-${randomUUID().slice(0, 6)}`, currency: "JPY" } }), 201)).id;
  const created = await ok(tenantCall(who, "POST", "/products", { body: { brand_id: brand, city_id: m.ids.tokyo, category: "charter", areas: [{ area_id: tokyo }], vehicle_groups: [{ vehicle_group_id: m.ids.biz7, passengers: 6, luggage: 4 }], dispatchers: [{ name: "调度", phone: "0312345678" }] } }), 201);
  const rules = await ok(tenantCall(who, "PUT", `/products/${created.id}/service-rules`, { version: 1, body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { general: { mode: "limited", minutes: 0 } } } }));
  const content = await ok(tenantCall(who, "PUT", `/products/${created.id}/content`, { version: rules.version, body: { zh: { title: "东京包车" } } }));
  const surcharge = (areaId: string, hours: number, amount: number) => ({ area_id: areaId, vehicle_group_id: m.ids.biz7, package_hours: hours, pricing_model: "charter_area_surcharge", pickup_surcharge: amount, dropoff_surcharge: amount, waypoint_surcharge: amount, valid_from: "2026-01-01" });
  const pkg = (hours: number, price: number) => ({ area_id: tokyo, vehicle_group_id: m.ids.biz7, package_hours: hours, pricing_model: "charter_package", package_km: 300, package_price: price, overtime_per_hour: 6_000, over_km_per_km: 500, valid_from: "2026-01-01" });
  await ok(tenantCall(who, "POST", `/products/${created.id}/price-rules/batch`, { version: content.version, body: { create: [pkg(10, package10), pkg(8, 50_000), ...[10, 8].flatMap((hours) => [surcharge(fuji, hours, 10_000), surcharge(hakone, hours, 10_000)])] } }));
  await ok(tenantCall(who, "POST", `/products/${created.id}/publish`));
  return { id: created.id, tokyo, fuji, hakone };
}

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay, quote: { routes: { estimate: routeLookup } } });
  m = await buildMarket(api);
  charterB = await newCharter(m.b, 55_000);
  // 甲的 10 小时套餐贵 500：乙中标；救援时甲是候选
  charterA = await newCharter(m.a, 55_500);
  const channel = await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" });
  site = await siteApi(api, (await salesCredentials(api, m, channel.id)).clientId, pay, {}, { quote: { routes: { estimate: routeLookup } } });
  // 报价的目录有 30 秒缓存
  api.clock.advance(31_000);
});
after(async () => {
  await site?.close();
  await api.close();
});

async function quote(pickup: Place, stops: Place[], dropoff: Place, extra: Record<string, unknown> = {}): Promise<ApiResponse> {
  api.clock.advance(1_000);
  const waypoints = stops.map((place, index) => ({ name: `景点 ${index + 1}`, lat: P[place].lat, lng: P[place].lng, stay_minutes: 30 }));
  const res = await site.call("POST", "/site/v1/quotes", { body: { category: "charter", city_id: m.ids.tokyo, pickup: P[pickup], dropoff: P[dropoff], ...(waypoints.length === 0 ? {} : { waypoints }), package_hours: 10, service_local: SERVICE_LOCAL, passengers: 2, luggage: 1, ...extra }, ip: nextIp() });
  assertMatchesOpenApi("POST", "/site/v1/quotes", res);
  assert.equal(res.status, 200, res.text);
  return res;
}
const total = (res: ApiResponse): string => res.body.quotes[0].price.total.amount;
const breakdown = (res: ApiResponse): unknown[] => res.body.quotes[0].price_breakdown.map((item: any) => [item.kind, item.amount.amount, item.area_name?.zh ?? null, item.stop_seqs, item.from_dropoff ?? null]);

async function serviceRules(who: TenantFixture, productId: string): Promise<any> {
  const res = await tenantCall(who, "GET", `/products/${productId}/service-rules`);
  assertMatchesOpenApi("GET", "/tenant/v1/products/{id}/service-rules", res);
  assert.equal(res.status, 200, res.text);
  return res.body;
}
async function putServiceRules(who: TenantFixture, productId: string, patch: Record<string, unknown>): Promise<ApiResponse> {
  const current = await serviceRules(who, productId);
  const { charter_itinerary: _kept, ...rules } = current.rules;
  const res = await tenantCall(who, "PUT", `/products/${productId}/service-rules`, { version: current.version, body: { ...rules, ...patch } });
  assertMatchesOpenApi("PUT", "/tenant/v1/products/{id}/service-rules", res);
  // 价格目录缓存
  api.clock.advance(31_000);
  return res;
}

test("规格用例 2–6、16–18（前台价 = 结算价 × 1.1）：经停的行程加价不被上 / 下车加价抵消；没有市外经停、下车点在富士山时收一次富士山行程加价（明细标 from_dropoff）", async () => {
  const cases: [Place, Place[], Place, string][] = [
    ["shinjuku", ["kawaguchiko"], "shinjuku", "71500"],
    ["shinjuku", ["kawaguchiko"], "kawaguchikoStation", "82500"],
    ["kawaguchiko", ["oshino"], "kawaguchiko", "93500"],
    ["kawaguchiko", ["ashinoko"], "kawaguchiko", "93500"],
    ["shinjuku", ["kawaguchiko", "ashinoko"], "shinjuku", "82500"],
    ["shinjuku", [], "kawaguchikoStation", "82500"],
    ["shinjuku", ["asakusa"], "kawaguchikoStation", "82500"],
    ["kawaguchiko", [], "shinjuku", "71500"],
  ];
  for (const [pickup, stops, dropoff, expected] of cases) assert.equal(total(await quote(pickup, stops, dropoff)), expected, `${pickup} → ${stops.join(" → ")} → ${dropoff}`);
  assert.deepEqual(breakdown(await quote("shinjuku", ["kawaguchiko"], "kawaguchikoStation")), [["base", "60500", null, null, null], ["waypoint", "11000", "富士山", [1], null], ["dropoff", "11000", "富士山", null, null]]);
  assert.deepEqual(breakdown(await quote("shinjuku", [], "kawaguchikoStation")), [["base", "60500", null, null, null], ["waypoint", "11000", "富士山", [], true], ["dropoff", "11000", "富士山", null, null]]);
  assert.deepEqual(breakdown(await quote("kawaguchiko", ["ashinoko"], "kawaguchiko")), [["base", "60500", null, null, null], ["pickup", "11000", "富士山", null, null], ["waypoint", "11000", "箱根", [1], null], ["dropoff", "11000", "富士山", null, null]]);
});

test("服务规则：下车点行程加价默认开；关掉 → 规格用例 19（只收下车加价）；PUT 不带这个键保留原值；别的品类设不了；甲读不到、改不了乙的", async () => {
  const before = await serviceRules(m.b, charterB.id);
  // M9P-03 在同一个键里加了预计用时 T 的三项和在线下单上限（默认 0 / 0 / 不限 / 13 小时）
  assert.deepEqual(before.rules.charter_itinerary, { ...ITINERARY_DEFAULTS, dropoff_itinerary_surcharge: true });
  const stored = await api.db.owner.query<{ rules: Record<string, unknown> }>("select service_rules as rules from products where id = $1", [charterB.id]);
  assert.equal("charterItinerary" in (stored.rows[0]?.rules ?? {}), false, "默认值不存键");

  const off = await putServiceRules(m.b, charterB.id, { charter_itinerary: { dropoff_itinerary_surcharge: false } });
  assert.equal(off.status, 200, off.text);
  assert.deepEqual(off.body.rules.charter_itinerary, { ...ITINERARY_DEFAULTS, dropoff_itinerary_surcharge: false });
  // 乙关了、甲没关：乙 71,500 中标
  const res19 = await quote("shinjuku", [], "kawaguchikoStation");
  assert.equal(total(res19), "71500");
  assert.deepEqual(breakdown(res19), [["base", "60500", null, null, null], ["dropoff", "11000", "富士山", null, null]]);
  // 关掉只影响下车点行程加价：真实经停照收（用例 3）
  const withStop = await quote("shinjuku", ["kawaguchiko"], "kawaguchikoStation");
  assert.equal(total(withStop), "82500");

  // 旧页面保存服务规则（不带 charter_itinerary）：保留原值（关着）
  const kept = await putServiceRules(m.b, charterB.id, { booking: { ...before.rules.booking, note: "旧页面保存" } });
  assert.equal(kept.status, 200, kept.text);
  assert.deepEqual(kept.body.rules.charter_itinerary, { ...ITINERARY_DEFAULTS, dropoff_itinerary_surcharge: false });

  // 规则 2：甲读不到、改不了乙的服务规则
  const v = await version(m.b, charterB.id);
  assert.equal((await tenantCall(m.a, "GET", `/products/${charterB.id}/service-rules`)).status, 404);
  assert.equal((await tenantCall(m.a, "PUT", `/products/${charterB.id}/service-rules`, { version: v, body: { charter_itinerary: { dropoff_itinerary_surcharge: true } } })).status, 404);
  assert.deepEqual((await serviceRules(m.b, charterB.id)).rules.charter_itinerary, { ...ITINERARY_DEFAULTS, dropoff_itinerary_surcharge: false });

  // 别的品类：设不了（400 NOT_APPLICABLE），读的时候也没有这个键
  const transfer = (await ok(tenantCall(m.b, "GET", "/products"))).items.find((item: any) => item.category !== "charter");
  assert.ok(transfer !== undefined);
  const transferRules = await serviceRules(m.b, transfer.id);
  assert.equal("charter_itinerary" in transferRules.rules, false);
  const bad = await tenantCall(m.b, "PUT", `/products/${transfer.id}/service-rules`, { version: transferRules.version, body: { ...transferRules.rules, charter_itinerary: { dropoff_itinerary_surcharge: false } } });
  assert.deepEqual([bad.status, bad.body.error.details.issues.map((issue: any) => [issue.path, issue.reason])], [400, [["/charter_itinerary", "NOT_APPLICABLE"]]]);

  // 打开回默认：不再存键
  const on = await putServiceRules(m.b, charterB.id, { charter_itinerary: { dropoff_itinerary_surcharge: true } });
  assert.equal(on.status, 200, on.text);
  const restored = await api.db.owner.query<{ rules: Record<string, unknown> }>("select service_rules as rules from products where id = $1", [charterB.id]);
  assert.equal("charterItinerary" in (restored.rows[0]?.rules ?? {}), false);
  for (const res of [off, kept, on]) for (const key of ["sell", "markup_bp", "price_breakdown"]) assert.ok(!allKeys(res.body).has(key), key);
});

async function placeAndPay(quoteId: string): Promise<{ orderId: string; token: string; body: any }> {
  const created = await site.call("POST", "/site/v1/orders", { headers: { "idempotency-key": randomUUID() }, body: { quote_id: quoteId, passenger: PASSENGER, save_payment_method: true, pickup_address: "新宿站", dropoff_address: "河口湖站" }, ip: nextIp() });
  assert.equal(created.status, 201, created.text);
  const orderId = created.body.order.id as string;
  const intent = pay.intentOf(orderId);
  assert.ok(intent);
  pay.pay(intent.id);
  const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
  assert.equal((await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()))).status, 200);
  return { orderId, token: created.body.link.token as string, body: created.body };
}

/** 乙中标的一单：东京 → 河口湖（经停）→ 河口湖站（下车）。甲的套餐贵 500，乙中标 */
async function bOrder(extra: Record<string, unknown> = {}): Promise<{ orderId: string; token: string; body: any }> {
  const res = await quote("shinjuku", ["kawaguchiko"], "kawaguchikoStation", extra);
  const placed = await placeAndPay(res.body.quotes[0].quote_id);
  const owner = await api.db.owner.query<{ tenant_id: string }>("select tenant_id from orders where id = $1", [placed.orderId]);
  assert.equal(owner.rows[0]?.tenant_id, m.b.tenantId);
  return placed;
}

/** 服务规则 `charter_itinerary` 里 M9P-03 加的几项的默认值 */
const ITINERARY_DEFAULTS = { stop_occupancy_minutes: 0, buffer_minutes: 0, min_package_hours: null, max_online_minutes: 780 };

/**
 * 把一单改成 M9P-03 之前的「预收了超时费」的格式：快照的请求没有 charterSelection、套餐时长写在请求里，结算价明细里超时费 `overtimeMinor` 预收、没有 `overtimeAtBooking`，结算价多出超时费。
 * 只模拟超时费预收这一点（客人付的钱、路线、套餐都不动）。
 */
async function asPrepaidOvertime(orderId: string, overtimeMinor: number): Promise<void> {
  const old = `jsonb_set(jsonb_set(jsonb_set(settlement #- '{itinerary,overtimeAtBooking}', '{itinerary,overtimeMinor}', to_jsonb($2::bigint)), '{totalMinor}', to_jsonb((settlement->>'totalMinor')::bigint + $2)), '{baseMinor}', to_jsonb((settlement->>'baseMinor')::bigint + $2))`;
  await api.db.owner.query(`update orders set settlement = ${old}, settlement_minor = settlement_minor + $2 where id = $1`, [orderId, overtimeMinor]);
  await api.db.owner.query(
    `update quotes set snapshot = jsonb_set(jsonb_set(snapshot #- '{request,charterSelection}', '{request,packageHours}', to_jsonb((select package_hours from orders where id = $1))), '{winner,offer,settlement}', (select settlement from orders where id = $1))
     where id = (select quote_id from order_sales where order_id = $1)`,
    [orderId],
  );
}

/**
 * 把一单改成「部署前格式」：报价快照和订单的结算价明细按 M9P-01 之前的算法（经停富士山被富士山下车抵消，行程加价 0），结算价少 10,000。
 * 只模拟算法不同这一点（客人付的钱、请求、套餐都不动）。
 */
async function asPreDeployment(orderId: string): Promise<void> {
  const old = `jsonb_set(jsonb_set(jsonb_set(settlement, '{areaSurcharge,waypoints}', '[]'::jsonb), '{totalMinor}', to_jsonb((settlement->>'totalMinor')::bigint - 10000)), '{baseMinor}', to_jsonb((settlement->>'baseMinor')::bigint - 10000))`;
  await api.db.owner.query(`update orders set settlement = ${old}, settlement_minor = settlement_minor - 10000 where id = $1`, [orderId]);
  await api.db.owner.query(
    `update quotes set snapshot = jsonb_set(snapshot, '{winner,offer,settlement}', (select settlement from orders where id = $1)) where id = (select quote_id from order_sales where order_id = $1)`,
    [orderId],
  );
}

test("部署前格式的订单改期：加价按新算法重算（行程加价不再被下车抵消），按行程计价的超时费照旧", async () => {
  // 按行程计价：两段各 100 公里、330 分钟，停留 30 → 690 分钟，10 小时套餐超时 90 分钟（6,000 / 小时 → 9,000）
  legMinutes = 330;
  const { orderId, token } = await bOrder({ itinerary_pricing: true, package_hours: undefined });
  legMinutes = 120;
  const settled = await api.db.owner.query<{ s: any }>("select settlement as s from orders where id = $1", [orderId]);
  const itinerary = settled.rows[0]?.s.itinerary;
  // M9P-03 起下单不收超时费（超出 90 分钟照记）；部署前的单下单时按 6,000 / 小时预收了 9,000——把这一单改成那个样子
  assert.deepEqual([itinerary.overtimeMinutes, itinerary.overtimeMinor, itinerary.overtimeAtBooking, settled.rows[0]?.s.totalMinor], [90, 0, false, 55_000 + 20_000]);
  await asPrepaidOvertime(orderId, 9_000);
  await asPreDeployment(orderId);
  const view = await site.call("GET", "/site/v1/order", { token, ip: nextIp() });
  const moved = await site.call("PATCH", "/site/v1/order", { token, ip: nextIp(), headers: { "if-match": `"${view.body.order.version}"` }, body: { service_time: "2026-10-21T10:00:00+09:00" } });
  assert.equal(moved.status, 200, moved.text);
  const change = await api.db.owner.query<{ before: string; after: string; s: any }>("select settlement_before_minor::text as before, settlement_after_minor::text as after, settlement_after as s from order_changes where order_id = $1", [orderId]);
  assert.deepEqual(change.rows.map((entry) => [entry.before, entry.after]), [["74000", "84000"]]);
  const after = change.rows[0]?.s;
  assert.equal(after.itinerary.overtimeMinor, 9_000, "超时费照旧（旧口径的单照旧收）");
  assert.deepEqual(after.areaSurcharge.waypoints.map((entry: any) => [entry.amountMinor, entry.stopSeqs]), [[10_000, [1]]]);
});

async function ops(): Promise<string> {
  return platformLogin(api, m.staff.operations.email);
}
async function trigger(orderId: string, kind: string): Promise<ApiResponse> {
  const res = await api.call("POST", `/platform/v1/orders/${orderId}/rescue`, { token: await ops(), body: { trigger: kind, note: "M9P-01 救援差价基准" } });
  assertMatchesOpenApi("POST", "/platform/v1/orders/{id}/rescue", res);
  assert.equal(res.status, 201, res.text);
  return res;
}
async function rescueRow(orderId: string): Promise<{ base: number | null; basis: any; original: number }> {
  const row = (await api.db.owner.query<{ base: string | null; basis: any; original: string }>("select deduction_base_minor::text as base, deduction_base as basis, original_settlement_minor::text as original from order_rescues where order_id = $1", [orderId])).rows[0];
  assert.ok(row !== undefined);
  return { base: row.base === null ? null : Number(row.base), basis: row.basis, original: Number(row.original) };
}

test("救援 B：部署前格式的旧单救援——基准 = 原结算价 + 新算法多出的加价；候选差价和改派后记的一致（500，不含多出的 10,000）；basis 四项齐全", async () => {
  const { orderId } = await bOrder();
  await asPreDeployment(orderId);
  await trigger(orderId, "tenant_declared");
  assert.deepEqual(await rescueRow(orderId), { base: 75_000, basis: { surchargeBefore: 10_000, surchargeAfter: 20_000, fallbackReason: null }, original: 65_000 });
  const listed = await api.call("GET", `/platform/v1/orders/${orderId}/rescue/candidates`, { token: await ops() });
  assertMatchesOpenApi("GET", "/platform/v1/orders/{id}/rescue/candidates", listed);
  const candidate = listed.body.candidates.find((entry: any) => entry.tenant.id === m.a.tenantId);
  assert.ok(candidate !== undefined, listed.text);
  // 甲 75,500 − 基准 75,000 = 500（不用基准时是 10,500）
  assert.deepEqual([candidate.settlement.amount, candidate.difference], ["75500", { amount: "500", currency: "JPY" }]);
  const offered = await api.call("POST", `/platform/v1/orders/${orderId}/rescue/offers`, { token: await ops(), body: { tenant_id: m.a.tenantId } });
  assert.equal(offered.status, 201, offered.text);
  const pending = await tenantCall(m.a, "GET", "/rescue-offers?status=pending");
  const offer = pending.body.items.find((entry: any) => entry.product_id === charterA.id);
  const accepted = await tenantCall(m.a, "POST", `/rescue-offers/${offer.id}/accept`, { body: {} });
  assert.equal(accepted.status, 200, accepted.text);
  const deduction = (await api.db.owner.query<{ amount: string; basis: any }>("select amount_minor::text as amount, basis from tenant_deductions where order_id = $1 and kind = 'rescue_difference'", [orderId])).rows[0];
  assert.deepEqual([deduction?.amount, deduction?.basis.base_minor, deduction?.basis.surcharge_before, deduction?.basis.surcharge_after, deduction?.basis.base_fallback_reason, deduction?.basis.original_minor, deduction?.basis.raw_minor], ["500", 75_000, 10_000, 20_000, null, 65_000, 500]);
});

test("救援 B：新算法下下的单基准就是原结算价；原供应商触发前调高套餐价，差价不变（套餐价不进基准）", async () => {
  const { orderId } = await bOrder();
  const pkg = (await ok(tenantCall(m.b, "GET", `/products/${charterB.id}/price-rules`))).items.find((item: any) => item.pricing_model === "charter_package" && item.package_hours === 10);
  const { id, base: _base, created_at: _c, updated_at: _u, ...body } = pkg;
  const raised = await tenantCall(m.b, "PUT", `/products/${charterB.id}/price-rules/${id}`, { version: await version(m.b, charterB.id), body: { ...body, package_price: 70_000 } });
  assert.equal(raised.status, 200, raised.text);
  await trigger(orderId, "tenant_declared");
  assert.deepEqual(await rescueRow(orderId), { base: 75_000, basis: { surchargeBefore: 20_000, surchargeAfter: 20_000, fallbackReason: null }, original: 75_000 });
  const listed = await api.call("GET", `/platform/v1/orders/${orderId}/rescue/candidates`, { token: await ops() });
  assert.deepEqual(listed.body.candidates.find((entry: any) => entry.tenant.id === m.a.tenantId)?.difference, { amount: "500", currency: "JPY" });
  const back = await tenantCall(m.b, "PUT", `/products/${charterB.id}/price-rules/${id}`, { version: await version(m.b, charterB.id), body: { ...body, package_price: 55_000 } });
  assert.equal(back.status, 200, back.text);
});

test("救援 B：只往上补——重算的加价比订单上的少（如 M9P-06 ①优先之后），基准 = 原结算价，不会低于原结算价", async () => {
  const { orderId } = await bOrder();
  // 订单上的上车加价多记 5,000（模拟下单时规则收得比现在多）：订单加价合计 25,000，按现在的规则重算 20,000
  const higher = `jsonb_set(jsonb_set(jsonb_set(settlement, '{areaSurcharge,pickup,amountMinor}', to_jsonb((settlement->'areaSurcharge'->'pickup'->>'amountMinor')::bigint + 5000)), '{totalMinor}', to_jsonb((settlement->>'totalMinor')::bigint + 5000)), '{baseMinor}', to_jsonb((settlement->>'baseMinor')::bigint + 5000))`;
  await api.db.owner.query(`update orders set settlement = ${higher}, settlement_minor = settlement_minor + 5000 where id = $1`, [orderId]);
  await trigger(orderId, "tenant_declared");
  assert.deepEqual(await rescueRow(orderId), { base: 80_000, basis: { surchargeBefore: 25_000, surchargeAfter: 20_000, fallbackReason: null }, original: 80_000 });
});

test("救援 B：重算失败（原商品的加价规则都停了，报不出）→ 退回原结算价，记下原因", async () => {
  const { orderId } = await bOrder();
  await asPreDeployment(orderId);
  await api.db.owner.query("update price_rules set status = 'disabled' where product_id = $1 and pricing_model = 'charter_area_surcharge'", [charterB.id]);
  try {
    await trigger(orderId, "tenant_declared");
  } finally {
    await api.db.owner.query("update price_rules set status = 'enabled' where product_id = $1 and pricing_model = 'charter_area_surcharge'", [charterB.id]);
  }
  const row = await rescueRow(orderId);
  assert.deepEqual([row.base, row.original, row.basis.surchargeBefore, row.basis.surchargeAfter], [65_000, 65_000, 10_000, null]);
  assert.match(row.basis.fallbackReason, /^[A-Z_]+$/);
});

test("救援 B：供应商被暂停时触发、用车前 6 小时内触发，都按下单时刻重算出基准（不报 TENANT_SUSPENDED / 提前预订不足，不退回原结算价）", async () => {
  const suspended = await bOrder();
  await asPreDeployment(suspended.orderId);
  const near = await bOrder();
  await asPreDeployment(near.orderId);
  const status = (await api.db.owner.query<{ status: string }>("select status from tenants where id = $1", [m.b.tenantId])).rows[0]?.status;
  await api.db.owner.query("update tenants set status = 'suspended', suspended_from = $2, suspended_at = $3, suspension_reasons = array['manual'] where id = $1", [m.b.tenantId, status, api.clock.now()]);
  try {
    await trigger(suspended.orderId, "tenant_suspended");
  } finally {
    await api.db.owner.query("update tenants set status = $2, suspended_from = null, suspended_at = null, suspension_reasons = '{}' where id = $1", [m.b.tenantId, status]);
  }
  assert.deepEqual(await rescueRow(suspended.orderId), { base: 75_000, basis: { surchargeBefore: 10_000, surchargeAfter: 20_000, fallbackReason: null }, original: 65_000 });
  // 拨到用车前 5 小时（商品提前预订 24 小时）
  const serviceAt = new Date("2026-10-20T01:00:00Z").getTime();
  api.clock.advance(serviceAt - 5 * HOUR - api.clock.now().getTime());
  await trigger(near.orderId, "tenant_declared");
  assert.deepEqual(await rescueRow(near.orderId), { base: 75_000, basis: { surchargeBefore: 10_000, surchargeAfter: 20_000, fallbackReason: null }, original: 65_000 });
});
