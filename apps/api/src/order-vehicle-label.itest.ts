/**
 * M7-02：订单上的车型标识来源（ADR 0068），经真实接口、真实 PostgreSQL；收款服务用替身。
 * - 官网订单（`GET /site/v1/order` 的 `names.vehicle_group`）、供应商后台订单详情、运营后台订单详情（`vehicle_group`）都带车型组的
 *   `sample_models`、`combos`，值等于车型组当前的值；后台改了车型组，订单接口跟着变（不做快照，ADR 0068 改进方案 3）；
 * - 供应商 A 读不到供应商 B 的订单（含车型组）；供应商后台的应答里仍然没有对外价、加价比例（规则 4）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { vehicleLabel } from "@nozomi/domain";
import { type TestApi, createTestApi } from "./testing/api.ts";
import { type Market, allKeys, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let site: SiteApi;
let order: { id: string; token: string };

const MODELS = ["Toyota Noah / Voxy", "Nissan Serena"];
const COMBOS = [{ passengers: 6, luggage: 4 }];

async function patchGroup(body: Record<string, unknown>): Promise<any> {
  const current = await ok(api.call("GET", `/platform/v1/master/vehicle-groups/${m.ids.biz7}`, { token: m.root }));
  api.clock.advance(1_000);
  return ok(api.call("PATCH", `/platform/v1/master/vehicle-groups/${m.ids.biz7}`, { token: m.root, headers: { "if-match": `"${current.version}"` }, body }));
}

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  await patchGroup({ sample_models: MODELS });
  const channelId = (await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" })).id;
  site = await siteApi(api, (await salesCredentials(api, m, channelId)).clientId, pay);

  api.clock.advance(1_000);
  const quotes = await site.call("POST", "/site/v1/quotes", { body: { city_id: m.ids.tokyo, airport_id: m.ids.narita, direction: "pickup", address: { lng: 139.7, lat: 35.6 }, service_local: "2026-10-20T10:00", passengers: 2, luggage: 1 } });
  assert.equal(quotes.status, 200, quotes.text);
  const quote = quotes.body.quotes.find((q: any) => q.vehicle_group.id === m.ids.biz7);
  assert.ok(quote, quotes.text);
  api.clock.advance(1_000);
  const created = await site.call("POST", "/site/v1/orders", {
    headers: { "idempotency-key": randomUUID() },
    body: { quote_id: quote.quote_id, passenger: { name: "王小明", phone: "+81 90-1234-5678", email: "guest@example.com" }, flight_no: "NH211", dropoff_address: "东京站八重洲口", save_payment_method: true },
  });
  assert.equal(created.status, 201, created.text);
  order = { id: created.body.order.id, token: created.body.link.token };

  const intent = pay.intentOf(order.id);
  assert.ok(intent);
  pay.pay(intent.id);
  const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
  const paid = await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()));
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
});
after(async () => {
  await site?.close();
  await api.close();
});

/** 三个接口里的车型组：官网订单页、供应商（中标的乙）、运营后台。每次都按 openapi.yaml 核对应答。 */
async function groupsSeen(): Promise<{ site: any; tenant: any; platform: any }> {
  const guest = await site.call("GET", "/site/v1/order", { token: order.token });
  assertMatchesOpenApi("GET", "/site/v1/order", guest);
  assert.equal(guest.status, 200, guest.text);
  const tenant = await api.call("GET", `/tenant/v1/orders/${order.id}`, { token: await tenantLogin(api, m.b.adminEmail) });
  assertMatchesOpenApi("GET", "/tenant/v1/orders/{id}", tenant);
  assert.equal(tenant.status, 200, tenant.text);
  const platform = await api.call("GET", `/platform/v1/orders/${order.id}`, { token: m.root });
  assertMatchesOpenApi("GET", "/platform/v1/orders/{id}", platform);
  assert.equal(platform.status, 200, platform.text);
  return { site: guest.body.names.vehicle_group, tenant: tenant.body.vehicle_group, platform: platform.body.vehicle_group };
}

test("三个订单接口都带车型组的代表车型和组合，值等于车型组当前的值；按 domain 的定义能算出 4 项标识", async () => {
  const seen = await groupsSeen();
  const name = { zh: "商务 7 座" };
  assert.deepEqual(seen.site, { code: "VG-BIZ-7", name, seats: 7, sample_models: MODELS, combos: COMBOS }, "官网：只加字段，原有的 code、name、seats 不变");
  for (const side of [seen.tenant, seen.platform]) assert.deepEqual(side, { id: m.ids.biz7, code: "VG-BIZ-7", name, seats: 7, sample_models: MODELS, combos: COMBOS });
  for (const side of [seen.site, seen.tenant, seen.platform]) {
    assert.deepEqual(vehicleLabel(side), { representative: "Toyota Noah / Voxy", similar: "Toyota Noah / Voxy, Nissan Serena or similar", maxPassengers: 6, maxLuggage: 4 });
  }
});

test("后台改了车型组的代表车型和组合，三个订单接口跟着变（不做快照）；清空代表车型时是空列表", async () => {
  const models = ["Toyota Alphard", "Toyota Vellfire"];
  const combos = [{ passengers: 6, luggage: 4 }, { passengers: 5, luggage: 5 }];
  await patchGroup({ sample_models: models, combos });
  const changed = await groupsSeen();
  for (const side of [changed.site, changed.tenant, changed.platform]) assert.deepEqual([side.sample_models, side.combos], [models, combos]);

  await patchGroup({ sample_models: [] });
  const cleared = await groupsSeen();
  for (const side of [cleared.site, cleared.tenant, cleared.platform]) assert.deepEqual([side.sample_models, side.combos], [[], combos]);
  await patchGroup({ sample_models: MODELS, combos: COMBOS });
});

test("供应商 A 读不到供应商 B 的订单（也就看不到它的车型组）；供应商后台的详情里仍然没有对外价和加价比例", async () => {
  const other = await api.call("GET", `/tenant/v1/orders/${order.id}`, { token: await tenantLogin(api, m.a.adminEmail) });
  assertMatchesOpenApi("GET", "/tenant/v1/orders/{id}", other);
  assert.deepEqual([other.status, other.body.error.code], [404, "NOT_FOUND"]);
  assert.equal(other.body.vehicle_group, undefined);

  const own = await api.call("GET", `/tenant/v1/orders/${order.id}`, { token: await tenantLogin(api, m.b.adminEmail) });
  assert.equal(own.status, 200, own.text);
  const keys = allKeys(own.body);
  for (const leaked of ["sell", "markup_bp", "markup", "channel", "fx", "price"]) assert.ok(!keys.has(leaked), leaked);
  assert.doesNotMatch(own.text, /21780/);
});
