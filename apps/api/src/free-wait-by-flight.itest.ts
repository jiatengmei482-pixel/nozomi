/**
 * M9E-28：接机免费等待按航班定（ADR 0097，监工替业主 2026-11-15 确认），经真实接口、真实 PostgreSQL；收款服务用替身。
 * - 下单时按客人选的航班类型锁定：国际 90、国内 60、没选（航班类型未确认）60（M9E-31 起不看商品设的；这里商品设 60 / 30，结果和 M9E-28 的 max 规则相同）；订单记下最终分钟数和依据，
 *   供应商订单详情、渠道订单、司机端看得到；
 * - 送机不能带航班类型；
 * - 改用点对点商品报价的接机（带航班号的点对点单，Q5）也按 90 / 60；
 * - 下单后改航班类型：派单前，供应商同意后重新锁定，推送和通知里带改前改后（Q3）；派单后不变；
 * - 供应商不能直接改这两列（数据库触发器）。
 * 商品的接机免费等待在这里直接写库设成 60（成田在测试数据里是只走国际线的机场，后台保存时最少 90），模拟「国际国内都有」机场上设 60 的商品。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TenantFixture } from "./testing/api.ts";
import { type TestApi, createTestApi } from "./testing/api.ts";
import { type Market, DROPOFF, SERVICE_TIME, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi, assertMatchesOperation } from "./testing/openapi.ts";
import { type FakeReceiver, assign, newDriver, newVehicle, startFakeReceiver } from "./testing/dispatch.ts";
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";
import { QUOTE_CATALOG_TTL_MS } from "./services/quote-catalog.ts";
import { withTenantTx } from "./db/context.ts";
import { deniedByDatabase } from "./testing/db.ts";

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let site: SiteApi;
let receiver: FakeReceiver;
let creds: { clientId: string; secret: string; token: string };

let ipSeq = 0;
const nextIp = (): string => {
  ipSeq += 1;
  return `10.97.${Math.floor(ipSeq / 200)}.${ipSeq % 200}`;
};

const P2P_PICKUP = { lng: 139.7, lat: 35.6 };
const P2P_DROPOFF = { lng: 139.75, lat: 35.68 };

async function p2pProduct(who: TenantFixture): Promise<void> {
  const token = await tenantLogin(api, who.adminEmail);
  const call = (method: "POST" | "PUT", path: string, body?: unknown, version?: number, status = 200): Promise<any> =>
    ok(
      api.call(method, `/tenant/v1${path}`, {
        token,
        ...(body === undefined ? {} : { body }),
        headers: { ...(version === undefined ? {} : { "if-match": `"${version}"` }), ...(method === "POST" && /^\/(products|brands|areas)$|\/price-rules$/.test(path) ? { "idempotency-key": randomUUID() } : {}) },
      }),
      status,
    );
  const brand = (await call("POST", "/brands", { name: `p2p-${who.tenantId.slice(0, 4)}`, currency: "JPY" }, undefined, 201)).id;
  api.clock.advance(1_000);
  const area = (await call("POST", "/areas", { city_id: m.ids.tokyo, name: { zh: "东京-点对点" }, biz_type: "general", polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [[[139.0, 35.0], [140.0, 35.0], [140.0, 36.0], [139.0, 36.0], [139.0, 35.0]]] } }] }, undefined, 201)).id;
  const created = await call("POST", "/products", { brand_id: brand, city_id: m.ids.tokyo, category: "point_to_point", areas: [{ area_id: area }], vehicle_groups: [{ vehicle_group_id: m.ids.biz7, passengers: 6, luggage: 4 }], dispatchers: [{ name: "调度", phone: "0312345678" }] }, undefined, 201);
  const rules = await call("PUT", `/products/${created.id}/service-rules`, { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { general: { mode: "limited", minutes: 30 } } }, 1);
  const version = (await call("PUT", `/products/${created.id}/content`, { zh: { title: "东京市内用车" } }, rules.version)).version as number;
  await call("POST", `/products/${created.id}/price-rules`, { area_id: area, vehicle_group_id: m.ids.biz7, valid_from: "2026-01-01", pricing_model: "fixed", base_price: 15_000 }, version, 201);
  await call("POST", `/products/${created.id}/publish`);
}

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  // 两家的成田接送机商品：接机免费等待都设成 60（直接写库，见文件头）
  await api.db.owner.query(`update products set service_rules = jsonb_set(service_rules, '{freeWait,pickup}', '{"mode":"limited","minutes":60}'::jsonb) where id = any($1::uuid[])`, [[m.ids.pa, m.ids.pb]]);
  api.clock.advance(QUOTE_CATALOG_TTL_MS + 1_000);
  await p2pProduct(m.a);
  receiver = await startFakeReceiver();
  await ok(api.call("PUT", "/tenant/v1/webhooks", { token: m.b.adminToken, body: { url: receiver.url, events: ["order.changed"] } }), 201);
  const channelId = (await newChannel(api, m.staff.cm1.token, { name: "官网" })).id;
  creds = await salesCredentials(api, m, channelId);
  site = await siteApi(api, creds.clientId, pay);
});
after(async () => {
  await receiver.close();
  await site.close();
  await api.close();
});

/** 渠道接口每秒最多 10 次：每次先把时钟拨过一秒。 */
async function sales(method: "GET" | "POST" | "PATCH", url: string, template: string, body?: unknown, headers: Record<string, string> = {}): Promise<any> {
  api.clock.advance(1_000);
  const res = await api.call(method, url, { token: creds.token, headers, ...(body === undefined ? {} : { body }) });
  assertMatchesOperation(method, template, res.status, res.body);
  return res;
}

/** 渠道询价（成田、商务 7 座）再下单；`extra` 是下单时多给的字段；`quoteWait` 是报价里应有的商品设的分钟数（不限时为 null）。 */
async function salesOrder(extra: Record<string, unknown>, direction: "pickup" | "dropoff" = "pickup", quoteWait: number | null = direction === "pickup" ? 60 : 15): Promise<any> {
  const quoted = await sales("POST", "/sales/v1/quotes", "/sales/v1/quotes", { city_id: m.ids.tokyo, category: "airport_transfer", place_id: m.ids.narita, direction, ...(direction === "pickup" ? { dropoff: DROPOFF } : { pickup: DROPOFF }), service_time: SERVICE_TIME, passengers: 2, luggage: 1, currency: "JPY", vehicle_group_ids: [m.ids.biz7] });
  assert.equal(quoted.status, 200, quoted.text);
  const quote = quoted.body.quotes[0];
  assert.equal(quote.free_wait_minutes, quoteWait, "报价里是商品自己设的值，不按航班改");
  const address = direction === "pickup" ? { dropoff_address: "东京站八重洲口" } : { pickup_address: "东京站八重洲口" };
  return sales("POST", "/sales/v1/orders", "/sales/v1/orders", { quote_id: quote.quote_id, passenger: { name: "王小明", phone: "+81 90-1234-5678", email: "guest@example.com" }, save_payment_method: true, ...address, ...extra }, { "idempotency-key": randomUUID() });
}

async function payOrder(orderId: string): Promise<void> {
  const intent = pay.intentOf(orderId);
  assert.ok(intent);
  pay.pay(intent.id);
  const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
  const res = await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()));
  assert.equal(res.status, 200, JSON.stringify(res.body));
}

async function tenantDetail(orderId: string): Promise<any> {
  const res = await api.call("GET", `/tenant/v1/orders/${orderId}`, { token: await tenantLogin(api, m.b.adminEmail) });
  assertMatchesOpenApi("GET", "/tenant/v1/orders/{id}", res);
  return res.body;
}

test("下单时按航班类型锁定：国际 90、国内 60、没选 60 且标「航班类型未确认」（M9E-31 平台统一；商品设 60）；报价不变；渠道、供应商都看得到最终分钟数和依据", async () => {
  const cases = [
    ["international", 90, { flight_kind: "international", base: { mode: "limited", minutes: 60 }, floor_minutes: 90 }],
    ["domestic", 60, { flight_kind: "domestic", base: { mode: "limited", minutes: 60 }, floor_minutes: 60 }],
    [null, 60, { flight_kind: null, base: { mode: "limited", minutes: 60 }, floor_minutes: 60 }],
  ] as const;
  for (const [kind, minutes, basis] of cases) {
    const created = await salesOrder({ flight_no: "NH 211", ...(kind === null ? {} : { flight_kind: kind }) });
    assert.equal(created.status, 201, created.text);
    const order = created.body.order;
    assert.deepEqual([order.free_wait_minutes, order.flight_kind, order.free_wait_basis], [minutes, kind, basis], String(kind));
    const saved = (await api.db.owner.query("select free_wait_minutes, flight_kind, free_wait_basis from orders where id = $1", [order.id])).rows[0];
    assert.deepEqual([saved.free_wait_minutes, saved.flight_kind, saved.free_wait_basis], [minutes, kind, basis]);
    await payOrder(order.id);
    const tenant = await tenantDetail(order.id);
    assert.deepEqual([tenant.order.free_wait_minutes, tenant.order.flight_kind, tenant.order.free_wait_basis], [minutes, kind, basis], "供应商看得到");
  }
});

test("M9E-31 回归（业主验收 #278）：商品设 90 或「不限时」，国内航班仍 60、国际 90、没选 60；依据里记下商品设的值", async () => {
  try {
    for (const setting of [{ mode: "limited", minutes: 90 }, { mode: "limited", minutes: 120 }, { mode: "unlimited" }] as const) {
      await api.db.owner.query(`update products set service_rules = jsonb_set(service_rules, '{freeWait,pickup}', $2::jsonb) where id = any($1::uuid[])`, [[m.ids.pa, m.ids.pb], JSON.stringify(setting)]);
      api.clock.advance(QUOTE_CATALOG_TTL_MS + 1_000);
      for (const [kind, minutes] of [["domestic", 60], ["international", 90], [null, 60]] as const) {
        const created = await salesOrder({ flight_no: "NH 211", ...(kind === null ? {} : { flight_kind: kind }) }, "pickup", setting.mode === "limited" ? setting.minutes : null);
        assert.equal(created.status, 201, created.text);
        assert.deepEqual([created.body.order.free_wait_minutes, created.body.order.free_wait_basis], [minutes, { flight_kind: kind, base: setting, floor_minutes: minutes }], `${JSON.stringify(setting)} ${String(kind)}`);
      }
    }
  } finally {
    // 不管成败都恢复商品设的 60，免得影响后面的用例
    await api.db.owner.query(`update products set service_rules = jsonb_set(service_rules, '{freeWait,pickup}', '{"mode":"limited","minutes":60}'::jsonb) where id = any($1::uuid[])`, [[m.ids.pa, m.ids.pb]]);
    api.clock.advance(QUOTE_CATALOG_TTL_MS + 1_000);
  }
});

test("送机不按航班定：带航班类型 400（/flight_kind），不带照商品设的 15", async () => {
  const bad = await salesOrder({ flight_kind: "international" }, "dropoff");
  assert.equal(bad.status, 400);
  assert.deepEqual(bad.body.error.details.issues.map((issue: any) => `${issue.path}:${issue.reason}`), ["/flight_kind:NOT_APPLICABLE"]);
  const created = await salesOrder({}, "dropoff");
  assert.equal(created.status, 201, created.text);
  assert.deepEqual([created.body.order.free_wait_minutes, created.body.order.flight_kind, created.body.order.free_wait_basis], [15, null, null]);
});

test("改用点对点商品报价的接机（Q5）：点对点单带航班号按航班定（国际 90），不带航班号照商品的 30", async () => {
  const place = async (extra: Record<string, unknown>): Promise<any> => {
    const quoted = await site.call("POST", "/site/v1/quotes", { ip: nextIp(), body: { category: "point_to_point", city_id: m.ids.tokyo, pickup: P2P_PICKUP, dropoff: P2P_DROPOFF, service_local: "2026-10-20T10:00", passengers: 2, luggage: 1 } });
    assert.equal(quoted.status, 200, quoted.text);
    api.clock.advance(1_000);
    const res = await site.call("POST", "/site/v1/orders", { headers: { "idempotency-key": randomUUID() }, ip: nextIp(), body: { quote_id: quoted.body.quotes[0].quote_id, passenger: { name: "陈小红", phone: "+81 90-2222-3333", email: "p2p-guest@example.com" }, save_payment_method: true, pickup_address: "成田机场 1 号航站楼", dropoff_address: "下车酒店", ...extra } });
    assertMatchesOpenApi("POST", "/site/v1/orders", res);
    return res;
  };
  const arrival = await place({ flight_no: "jl 5", flight_kind: "international" });
  assert.equal(arrival.status, 201, arrival.text);
  assert.deepEqual([arrival.body.order.flight_no, arrival.body.order.free_wait_minutes, arrival.body.order.flight_kind, arrival.body.order.free_wait_basis], ["JL5", 90, "international", { flight_kind: "international", base: { mode: "limited", minutes: 30 }, floor_minutes: 90 }]);
  const unconfirmed = await place({ flight_no: "JL5" });
  assert.deepEqual([unconfirmed.body.order.free_wait_minutes, unconfirmed.body.order.free_wait_basis?.flight_kind], [60, null], "没选航班类型：按国内线 60");
  const plain = await place({});
  assert.deepEqual([plain.body.order.free_wait_minutes, plain.body.order.flight_kind, plain.body.order.free_wait_basis], [30, null, null], "没有航班号的点对点照商品");
  const kindOnly = await place({ flight_kind: "domestic" });
  assert.equal(kindOnly.status, 400, "没有航班号不能给航班类型");
});

test("下单后改航班类型（Q3）：派单前，供应商同意后按新的类型重新锁定、推送带改前改后；派单后同意也不变", async () => {
  const created = await salesOrder({ flight_no: "NH211" });
  const order = created.body.order;
  await payOrder(order.id);
  const patch = async (body: Record<string, unknown>): Promise<any> => {
    const current = (await sales("GET", `/sales/v1/orders/${order.id}`, "/sales/v1/orders/{id}")).body.order;
    return sales("PATCH", `/sales/v1/orders/${order.id}`, "/sales/v1/orders/{id}", body, { "if-match": `"${current.version}"` });
  };
  const approveLast = async (): Promise<void> => {
    const tenant = await tenantDetail(order.id);
    const pending = tenant.changes.find((change: any) => change.status === "pending_confirmation");
    assert.ok(pending, "有待确认的申请");
    await ok(api.call("POST", `/tenant/v1/orders/${order.id}/changes/${pending.id}/confirm`, { token: await tenantLogin(api, m.b.adminEmail), body: {} }));
  };

  const requested = await patch({ flight_kind: "international" });
  assert.equal(requested.status, 200, requested.text);
  assert.deepEqual([requested.body.change.status, requested.body.change.fields, requested.body.order.free_wait_minutes], ["pending_confirmation", ["flight_kind"], 60], "申请没同意前不变");
  await approveLast();
  const relocked = await tenantDetail(order.id);
  assert.deepEqual([relocked.order.free_wait_minutes, relocked.order.flight_kind, relocked.order.free_wait_basis], [90, "international", { flight_kind: "international", base: { mode: "limited", minutes: 60 }, floor_minutes: 90 }]);
  const pushed = await api.db.owner.query("select event_data from webhook_deliveries where order_id = $1 and event_type = 'order.changed' order by created_at, id", [order.id]);
  const applied = pushed.rows.filter((row) => row.event_data.status === "applied");
  assert.deepEqual(applied.map((row) => row.event_data.free_wait_minutes), [{ before: 60, after: 90 }], "生效的那条推送里带免费等待的改前改后");
  assert.equal(pushed.rows.find((row) => row.event_data.status === "pending_confirmation")?.event_data.free_wait_minutes, undefined, "申请那条不带");
  const noticed = await api.db.owner.query("select data from notification_events where order_id = $1 and event = 'order.changed'", [order.id]);
  assert.deepEqual(noticed.rows.map((row) => row.data.free_wait_minutes).filter(Boolean), [{ before: 60, after: 90 }], "通知里也带");

  // 派单以后改成国内航班：航班类型照改，免费等待和依据不变
  await ok(assign(api, m.b, order.id, (await newDriver(api, m.b)).id, (await newVehicle(api, m.b, m.ids.biz7)).id));
  assert.equal((await patch({ flight_kind: "domestic" })).status, 200);
  await approveLast();
  const kept = await tenantDetail(order.id);
  assert.deepEqual([kept.order.flight_kind, kept.order.free_wait_minutes, kept.order.free_wait_basis.flight_kind], ["domestic", 90, "international"]);
});

test("点对点接机派单前清掉航班号（2026-11-15 按推荐，审查建议 3）：供应商同意后不再按航班定，回到商品的 30 分钟、依据清空，和清空的航班类型对得上", async () => {
  const quoted = await site.call("POST", "/site/v1/quotes", { ip: nextIp(), body: { category: "point_to_point", city_id: m.ids.tokyo, pickup: P2P_PICKUP, dropoff: P2P_DROPOFF, service_local: "2026-10-20T10:00", passengers: 2, luggage: 1 } });
  api.clock.advance(1_000);
  const placed = await site.call("POST", "/site/v1/orders", { headers: { "idempotency-key": randomUUID() }, ip: nextIp(), body: { quote_id: quoted.body.quotes[0].quote_id, passenger: { name: "陈小红", phone: "+81 90-2222-3333", email: "p2p-clear@example.com" }, save_payment_method: true, pickup_address: "成田机场 1 号航站楼", dropoff_address: "下车酒店", flight_no: "JL5", flight_kind: "international" } });
  assert.equal(placed.status, 201, placed.text);
  const orderId = placed.body.order.id as string;
  const token = placed.body.link.token as string;
  await payOrder(orderId);
  const current = await site.call("GET", "/site/v1/order", { token, ip: nextIp() });
  assert.equal(current.body.order.free_wait_minutes, 90);
  const patched = await site.call("PATCH", "/site/v1/order", { token, ip: nextIp(), headers: { "if-match": `"${current.body.order.version}"` }, body: { flight_no: null } });
  assert.equal(patched.status, 200, patched.text);
  const pending = patched.body.change;
  assert.deepEqual(pending.after, { flight_no: null, flight_kind: null }, "清掉航班号连带清掉航班类型");
  await ok(api.call("POST", `/tenant/v1/orders/${orderId}/changes/${pending.id}/confirm`, { token: await tenantLogin(api, m.a.adminEmail), body: {} }));
  const saved = (await api.db.owner.query("select flight_no, flight_kind, free_wait_minutes, free_wait_basis from orders where id = $1", [orderId])).rows[0];
  assert.deepEqual([saved.flight_no, saved.flight_kind, saved.free_wait_minutes, saved.free_wait_basis], [null, null, 30, null]);
});

test("供应商不能直接改航班类型和锁定依据（数据库触发器）", async () => {
  const created = await salesOrder({ flight_no: "NH211", flight_kind: "domestic" });
  const orderId = created.body.order.id;
  for (const sql of ["update orders set flight_kind = 'international' where id = $1", "update orders set free_wait_basis = '{}'::jsonb where id = $1"]) {
    await assert.rejects(withTenantTx(api.db.pool, m.b.tenantId, (db) => db.query(sql, [orderId])), deniedByDatabase, sql);
  }
});
