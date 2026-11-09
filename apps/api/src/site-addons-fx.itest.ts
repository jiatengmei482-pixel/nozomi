/**
 * M8-02：官网询价带附加服务（ADR 0069 B15）和按客人币种的参考汇率（ADR 0069 B16），经真实接口、真实 PostgreSQL；收款服务、汇率源都是本机替身。
 *
 * 覆盖：
 * - 报价给每个车型「能加哪些附加服务」（参加比价的供应商里有人提供的；只有目录信息，没有任何单价）；
 * - 选了附加服务后：没提供的供应商不参与比价（询价日志里是 ADDON_NOT_OFFERED），合计按中标供应商的单价、走同一套加价，和 `/sales/v1`、按两个坐标报价一致；
 * - 下单后订单的附加服务和报价一致、金额就是报价的对外价；中标的供应商在 `/tenant/v1` 看得到附加服务，看不到对外价和加价比例；
 * - 校验（同一项写两次、数量超范围、不存在的附加服务）；
 * - 参考汇率：可用（汇率、批次时间、同币种为 1）、没有汇率、超过 48 小时、有一批挂起待确认三种不可用；不拉外部服务；币种校验；官网没开 503。
 * 测试数据全在本文件里经接口建出来，随测试 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";
import { type FakeFxSource, fxSourceBody, startFakeFxSource } from "./testing/fx-source.ts";
import { type Market, allValues, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let source: FakeFxSource;
let site: SiteApi;
let siteClientId: string;
let salesToken: string;
const opened: SiteApi[] = [];
const ids: Record<string, string> = {};

const TOKYO_STATION = { lng: 139.7671, lat: 35.6812 };
const SERVICE_LOCAL = "2026-10-20T10:00";
const PASSENGER = { name: "王小明", phone: "+81 90-1111-2222", email: "addon.guest@example.com" };
/** 测试时钟的起点是 2026-10-07T01:00Z；汇率源的第一批是 00:00Z 的 */
const T0 = new Date("2026-10-07T00:00:00.000Z");
const RATES = { JPY: "150.000", CNY: "7.2", KRW: "1400", HKD: "7.8", TWD: "32", THB: "36", SGD: "1.35" };

let ipSeq = 0;
const nextIp = (): string => `10.55.${Math.floor(++ipSeq / 200)}.${ipSeq % 200}`;
const openSite = async (clientId: string | null = siteClientId): Promise<SiteApi> => {
  const app = await siteApi(api, clientId, pay, {});
  opened.push(app);
  return app;
};
const rootToken = async (): Promise<string> => (await ok(api.platformLogin({ body: { email: "root@platform.test", password: TEST_PASSWORD } }))).access_token;

const pickupBody = (extra: Record<string, unknown> = {}) => ({ city_id: m.ids.tokyo, airport_id: m.ids.narita, direction: "pickup", address: TOKYO_STATION, service_local: SERVICE_LOCAL, passengers: 2, luggage: 1, ...extra });
async function quote(body: Record<string, unknown>, app: SiteApi = site): Promise<any> {
  const res = await app.call("POST", "/site/v1/quotes", { ip: nextIp(), body });
  assertMatchesOpenApi("POST", "/site/v1/quotes", res);
  assert.equal(res.status, 200, res.text);
  return res.body;
}
const groupOf = (result: any, vehicleGroupId: string): any => result.quotes.find((entry: any) => entry.vehicle_group.id === vehicleGroupId);

/** 甲的成田接送机商品加上附加服务（重存服务规则，其余和 `marketProduct` 一样）。 */
async function offerAddons(addons: Record<string, unknown>[]): Promise<void> {
  const token = await tenantLogin(api, m.a.adminEmail);
  const product = await ok(api.call("GET", `/tenant/v1/products/${m.ids.pa}`, { token }));
  await ok(
    api.call("PUT", `/tenant/v1/products/${m.ids.pa}/service-rules`, {
      token,
      headers: { "if-match": `"${product.version}"` },
      body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { pickup: { mode: "limited", minutes: 90 }, dropoff: { mode: "limited", minutes: 15 } }, addons },
    }),
  );
}

before(async () => {
  pay = new FakePaymentProvider();
  source = await startFakeFxSource();
  api = await createTestApi({ payments: pay, env: { FX_SOURCE_URL: source.url } });
  m = await buildMarket(api);
  const platform = (body: Record<string, unknown>): Promise<any> => ok(api.call("POST", "/platform/v1/master/addons", { token: m.root, body }), 201);
  ids["seat"] = (await platform({ code: "ADD-CHILD_SEAT", categories: ["airport_transfer", "point_to_point"], charge_unit: "per_item", name: { zh: "儿童座椅", ja: "チャイルドシート" } })).id;
  ids["board"] = (await platform({ code: "ADD-NAME_BOARD", categories: ["airport_transfer"], charge_unit: "per_order", name: { zh: "举牌接机" } })).id;
  ids["nobody"] = (await platform({ code: "ADD-WIFI", categories: ["airport_transfer"], charge_unit: "per_order", name: { zh: "随车 Wi-Fi" } })).id;
  // 甲提供儿童座椅（每个 1,000）和举牌（500）；乙什么都不提供。没加附加服务时商务 7 座乙（19,800）中标
  await offerAddons([{ addon_id: ids["seat"], unit_price: 1_000 }, { addon_id: ids["board"], unit_price: 500 }]);
  const channel = await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" });
  siteClientId = (await salesCredentials(api, m, channel.id)).clientId;
  salesToken = (await salesCredentials(api, m, channel.id, "198.51.100.11")).token;
  site = await siteApi(api, siteClientId, pay, {});
});
after(async () => {
  for (const app of [site, ...opened]) await app?.close();
  await api.close();
  await source.close();
});

test("报价给每个车型能加的附加服务：参加比价的供应商里有人提供的（目录的编号、编码、名称、计费方式），没有任何单价；没人提供的不列", async () => {
  const result = await quote(pickupBody());
  const biz7 = groupOf(result, m.ids.biz7);
  const eco4 = groupOf(result, m.ids.eco4);
  assert.equal(biz7.price.total.amount, "21780", "没加附加服务：乙 19,800 中标");
  const expected = [
    { id: ids["seat"], code: "ADD-CHILD_SEAT", name: { zh: "儿童座椅", ja: "チャイルドシート" }, charge_unit: "per_item" },
    { id: ids["board"], code: "ADD-NAME_BOARD", name: { zh: "举牌接机" }, charge_unit: "per_order" },
  ].sort((a, b) => ((a.id ?? "") < (b.id ?? "") ? -1 : 1));
  assert.deepEqual(biz7.available_addons, expected, "乙不提供，但甲也在商务 7 座的比价里");
  assert.deepEqual(eco4.available_addons, expected);
  assert.ok(!biz7.available_addons.some((addon: any) => addon.id === ids["nobody"]));
  // 应答里没有供应商单价（1000、500）、结算价、加价比例
  const values = allValues(result.quotes.map((entry: any) => entry.available_addons));
  assert.ok(!values.has("1000") && !values.has("500"));
  assert.doesNotMatch(JSON.stringify(result), /unit_price|settlement|markup/);
});

test("选了儿童座椅 ×2：乙不提供，不参与比价（ADDON_NOT_OFFERED），甲中标；合计 = (车费 + 附加服务) 走同一套加价；和 /sales/v1、按两个坐标报价一致", async () => {
  const addons = [{ addon_id: ids["seat"], quantity: 2 }];
  const result = await quote(pickupBody({ addons }));
  const biz7 = groupOf(result, m.ids.biz7);
  assert.equal(biz7.price.total.amount, "24200", "(20,000 + 2 × 1,000) × 1.1");
  assert.equal(groupOf(result, m.ids.eco4).price.total.amount, "15400", "(12,000 + 2,000) × 1.1");
  const stored = (await api.db.owner.query("select winner_tenant_id, settlement_minor::int as settlement_minor, sell_minor::int as sell_minor, snapshot->'request'->'addons' as addons from quotes where id = $1", [biz7.quote_id])).rows[0];
  assert.deepEqual([stored.winner_tenant_id, stored.settlement_minor, stored.sell_minor, stored.addons], [m.a.tenantId, 22_000, 24_200, [{ addonId: ids["seat"], quantity: 2 }]]);
  const log = (await api.db.owner.query("select q.request, q.rejects from quote_logs q join quotes t on t.quote_log_id = q.id where t.id = $1", [biz7.quote_id])).rows[0];
  assert.deepEqual(log.request.addons, [{ addon_id: ids["seat"], quantity: 2 }]);
  assert.ok(log.rejects.some((entry: any) => entry.tenant_id === m.b.tenantId && entry.reason === "ADDON_NOT_OFFERED"), JSON.stringify(log.rejects));

  // 同一个请求经渠道接口：价格一样（同一个引擎）
  const sales = await ok(api.call("POST", "/sales/v1/quotes", { token: salesToken, body: { city_id: m.ids.tokyo, category: "airport_transfer", place_id: m.ids.narita, direction: "pickup", dropoff: TOKYO_STATION, service_time: "2026-10-20T10:00:00+09:00", passengers: 2, luggage: 1, currency: "JPY", addons } }));
  assert.equal(sales.quotes.find((entry: any) => entry.vehicle_group_id === m.ids.biz7).price.total.amount, "24200");
  // 按两个坐标报价也带附加服务
  const points = await site.call("POST", "/site/v1/quotes/by-points", { ip: nextIp(), body: { pickup: { name: "成田机场", lat: 35.7686, lng: 140.3887, kind: "airport" }, dropoff: { name: "东京站", ...TOKYO_STATION }, service_local: SERVICE_LOCAL, passengers: 2, luggage: 1, addons } });
  assertMatchesOpenApi("POST", "/site/v1/quotes/by-points", points);
  assert.equal(points.status, 200, points.text);
  assert.equal(groupOf(points.body, m.ids.biz7).price.total.amount, "24200");
});

test("没有任何供应商提供的附加服务：所有车型都报不出价（ADDON_NOT_OFFERED）；目录里不存在的编号同样报不出价", async () => {
  const none = await quote(pickupBody({ addons: [{ addon_id: ids["nobody"], quantity: 1 }] }));
  assert.deepEqual(none.quotes, []);
  assert.ok(none.unavailable.every((entry: any) => entry.reasons.includes("ADDON_NOT_OFFERED")), JSON.stringify(none));
  const unknown = await quote(pickupBody({ addons: [{ addon_id: randomUUID(), quantity: 1 }] }));
  assert.deepEqual(unknown.quotes, []);
});

test("校验：同一项写两次、数量 0 或超过 20、多余的字段 → 400", async () => {
  for (const [label, addons] of [
    ["重复", [{ addon_id: ids["seat"], quantity: 1 }, { addon_id: ids["seat"], quantity: 2 }]],
    ["数量 0", [{ addon_id: ids["seat"], quantity: 0 }]],
    ["数量 21", [{ addon_id: ids["seat"], quantity: 21 }]],
    ["多余字段", [{ addon_id: ids["seat"], quantity: 1, unit_price: 1 }]],
    ["不是编号", [{ addon_id: "seat", quantity: 1 }]],
  ] as const) {
    const res = await site.call("POST", "/site/v1/quotes", { ip: nextIp(), body: pickupBody({ addons }) });
    assertMatchesOpenApi("POST", "/site/v1/quotes", res);
    assert.equal(res.status, 400, `${label}: ${res.text}`);
  }
});

test("下单：订单的附加服务和报价一致，金额就是报价的对外价；付款后中标的甲在 /tenant/v1 看得到附加服务，看不到对外价和加价比例", async () => {
  const addons = [{ addon_id: ids["seat"], quantity: 2 }, { addon_id: ids["board"], quantity: 1 }];
  const result = await quote(pickupBody({ addons }));
  const biz7 = groupOf(result, m.ids.biz7);
  assert.equal(biz7.price.total.amount, "24750", "(20,000 + 2,000 + 500) × 1.1");
  const created = await site.call("POST", "/site/v1/orders", { ip: nextIp(), headers: { "idempotency-key": randomUUID() }, body: { quote_id: biz7.quote_id, passenger: PASSENGER, flight_no: "NH211", dropoff_address: "东京站八重洲口", save_payment_method: true } });
  assertMatchesOpenApi("POST", "/site/v1/orders", created);
  assert.equal(created.status, 201, created.text);
  const order = created.body.order;
  assert.deepEqual(order.addons, [{ addon_id: ids["seat"], quantity: 2 }, { addon_id: ids["board"], quantity: 1 }]);
  assert.equal(order.price.total.amount, "24750");
  const row = (await api.db.owner.query("select addons, settlement_minor::int as settlement_minor from orders where id = $1", [order.id])).rows[0];
  assert.deepEqual(row.addons, [{ addonId: ids["seat"], quantity: 2 }, { addonId: ids["board"], quantity: 1 }]);
  assert.equal(row.settlement_minor, 22_500);

  const intent = pay.intentOf(order.id);
  assert.ok(intent);
  pay.pay(intent.id);
  const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
  assert.equal((await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()))).status, 200);
  const tenantA = await api.call("GET", `/tenant/v1/orders/${order.id}`, { token: await tenantLogin(api, m.a.adminEmail) });
  assert.equal(tenantA.status, 200, tenantA.text);
  assert.ok(JSON.stringify(tenantA.body).includes(ids["seat"] as string), "供应商看得到要准备的附加服务");
  assert.ok(!allValues(tenantA.body).has("24750"), "看不到对外价");
  assert.doesNotMatch(tenantA.text, /markup/);
  const tenantB = await api.call("GET", `/tenant/v1/orders/${order.id}`, { token: await tenantLogin(api, m.b.adminEmail) });
  assert.equal(tenantB.status, 404);
  // 供应商试算同样只有结算价
  const preview = await api.call("POST", `/tenant/v1/products/${m.ids.pa}/quote-preview`, { token: await tenantLogin(api, m.a.adminEmail), body: { direction: "pickup", dropoff: TOKYO_STATION, service_time: SERVICE_LOCAL, passengers: 2, luggage: 1, addons: [{ addon_id: ids["seat"], quantity: 2 }] } });
  assert.equal(preview.status, 200, preview.text);
  assert.doesNotMatch(preview.text, /sell|markup/);
});

test("参考汇率：没有汇率 NO_RATE → 拉到汇率后可用（同币种为 1）→ 超过 48 小时 STALE → 有一批挂起待确认 PENDING_REVIEW；都是 200，不拉外部服务", async () => {
  const get = async (app: SiteApi, to: string): Promise<any> => {
    const res = await app.call("GET", `/site/v1/fx/reference?to=${to}`, { ip: nextIp() });
    assertMatchesOpenApi("GET", "/site/v1/fx/reference", res);
    assert.equal(res.status, 200, res.text);
    return res.body;
  };
  // 汇率中心每个进程缓存 30 秒：每一步用一个新的官网进程读
  assert.deepEqual(await get(await openSite(), "CNY"), { available: false, from: "JPY", to: "CNY", rate: null, as_of: null, reason: "NO_RATE" });
  assert.equal(source.requests(), 0, "读参考汇率不拉汇率源");

  source.respond({ body: fxSourceBody({ asOf: T0, rates: RATES }) });
  await ok(api.call("POST", "/platform/v1/fx-rates/fetch", { token: await rootToken() }));
  const fresh = await openSite();
  const cny = await get(fresh, "CNY");
  assert.deepEqual([cny.available, cny.from, cny.to, cny.as_of, cny.reason], [true, "JPY", "CNY", T0.toISOString(), null]);
  assert.equal(Number(cny.rate).toFixed(6), "0.048000", "7.2 / 150");
  assert.deepEqual(await get(fresh, "JPY"), { available: true, from: "JPY", to: "JPY", rate: "1", as_of: null, reason: null });
  const fetches = source.requests();
  await get(fresh, "USD");
  assert.equal(source.requests(), fetches);

  api.clock.advance(49 * 3_600_000);
  assert.deepEqual(await get(await openSite(), "CNY"), { available: false, from: "JPY", to: "CNY", rate: null, as_of: null, reason: "STALE" });

  // 新的一批日元涨了 4%：挂起待确认，现在用的还是旧的那批
  source.respond({ body: fxSourceBody({ asOf: new Date(api.clock.now().getTime() - 60_000), rates: { ...RATES, JPY: "156" } }) });
  const held = (await ok(api.call("POST", "/platform/v1/fx-rates/fetch", { token: await rootToken() }))).fetch;
  assert.equal(held.status, "held");
  assert.deepEqual(await get(await openSite(), "CNY"), { available: false, from: "JPY", to: "CNY", rate: null, as_of: null, reason: "PENDING_REVIEW" });
});

test("参考汇率的校验：币种不支持、缺少、多余的参数 → 400；官网没开 → 503", async () => {
  for (const url of ["/site/v1/fx/reference?to=EUR", "/site/v1/fx/reference?to=cny", "/site/v1/fx/reference", "/site/v1/fx/reference?to=CNY&from=USD"]) {
    const res = await site.call("GET", url, { ip: nextIp() });
    assertMatchesOpenApi("GET", "/site/v1/fx/reference", res);
    assert.equal(res.status, 400, `${url} ${res.text}`);
  }
  const closed = await openSite(null);
  const res = await closed.call("GET", "/site/v1/fx/reference?to=CNY", { ip: nextIp() });
  assertMatchesOpenApi("GET", "/site/v1/fx/reference", res);
  assert.deepEqual([res.status, res.body.error.code], [503, "SITE_NOT_OPEN"]);
});
