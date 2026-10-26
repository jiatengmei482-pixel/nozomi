/**
 * M3-10 测试角色补充：官网的点对点和包车（ADR 0034）的边界。经真实接口、真实 PostgreSQL，收款服务用替身。
 * - 字段组合：包车时长不在套餐里 / 最大值 / 小数 / 字符串；点对点起终点相同；坐标的合法边界和越界；一端在服务区外；
 * - 地址长度：下单和改单的上限（300 个字，按字符算不按 UTF-16）、只有空白；包车改下车地址、非接送机改航班号；
 * - 时区与跨午夜：价格规则的有效期按城市当地日期判断（洛杉矶 23:59 / 00:00）；包车跨午夜；夏令时不存在的时刻；
 *   包车套餐时长的「今天」按城市当地日期（比 UTC 晚一天的洛杉矶、早一天的奥克兰）；
 * - 取消与改单：点对点两端地址都能改；包车改期跨午夜（价不变、套餐不变）、改到套餐到期之后 409；取消试算与实际一致；
 * - 隔离：官网应答里没有超时 / 超公里单价、套餐结算价、供应商、加价比例；中标供应商看不到对外价，别的供应商看不到这张单；
 *   只授权大阪的渠道询东京 422、城市和包车时长都不列；暂停的供应商、下架的商品不再提供包车时长；
 * - 常用地点：只列启用的机场、车站、地标，最多 500 个（机场、车站排在前面不会被截掉）；城市停用后为空；
 * - 询价日志记下品类和各自的行程字段；包车下单幂等（同一个键并发提交只成一单）。
 * 测试数据全在本文件里经接口（少量常用地点直接写库）建出来，随测试 schema 一起删除；每个测试用自己的来源地址，时钟只往后拨，不依赖执行顺序。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TenantFixture } from "./testing/api.ts";
import { type TestApi, createTestApi } from "./testing/api.ts";
import { type Market, allKeys, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { platformLogin, tenantLogin } from "./testing/money.ts";
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const TOKYO_POLYGON = [[[139.0, 35.0], [140.0, 35.0], [140.0, 36.0], [139.0, 36.0], [139.0, 35.0]]];
const PICKUP = { lng: 139.7, lat: 35.6 };
const DROPOFF = { lng: 139.75, lat: 35.68 };
const PASSENGER = { name: "王小明", phone: "+81 90-3333-4444", email: "qa.p2p@example.com" };
/** 包车的超时、超公里单价用少见的数，方便在应答里查有没有漏出去 */
const OVERTIME = 4_321;
const OVER_KM = 1_357;

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let site: SiteApi;
let ipSeq = 0;
const nextIp = (): string => {
  ipSeq += 1;
  return `10.88.${Math.floor(ipSeq / 250)}.${ipSeq % 250}`;
};

type Category = "point_to_point" | "charter";

/** 在 `cityId` 建一个点对点或包车商品（区域 = `polygon`，商务 7 座，全天可订），按 `prices` 建价格规则后上架。 */
async function product(who: TenantFixture, cityId: string, polygon: number[][][], category: Category, prices: Record<string, unknown>[], leadTimeHours = 24): Promise<string> {
  const token = await tenantLogin(api, who.adminEmail);
  const call = (method: "POST" | "PUT" | "GET", path: string, body?: unknown, version?: number, status = 200): Promise<any> =>
    ok(
      api.call(method, `/tenant/v1${path}`, {
        token,
        ...(body === undefined ? {} : { body }),
        headers: { ...(version === undefined ? {} : { "if-match": `"${version}"` }), ...(method === "POST" && /^\/(products|brands|areas)$|\/price-rules$/.test(path) ? { "idempotency-key": randomUUID() } : {}) },
      }),
      status,
    );
  const brand = (await call("POST", "/brands", { name: `QA-${randomUUID().slice(0, 8)}`, currency: "JPY" }, undefined, 201)).id;
  api.clock.advance(1_000);
  const area = (await call("POST", "/areas", { city_id: cityId, name: { zh: `QA-${category}-${randomUUID().slice(0, 4)}` }, biz_type: "general", polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: polygon } }] }, undefined, 201)).id;
  const created = await call("POST", "/products", { brand_id: brand, city_id: cityId, category, areas: [{ area_id: area }], vehicle_groups: [{ vehicle_group_id: m.ids.biz7, passengers: 6, luggage: 4 }], dispatchers: [{ name: "调度", phone: "0312345678" }] }, undefined, 201);
  const rules = await call("PUT", `/products/${created.id}/service-rules`, { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: leadTimeHours }, free_wait: { general: { mode: "limited", minutes: 30 } } }, 1);
  let version = (await call("PUT", `/products/${created.id}/content`, { zh: { title: category === "charter" ? "QA 包车" : "QA 市内用车" } }, rules.version)).version as number;
  for (const price of prices) {
    await call("POST", `/products/${created.id}/price-rules`, { area_id: area, vehicle_group_id: m.ids.biz7, valid_from: "2026-01-01", ...price }, version, 201);
    version = (await call("GET", `/products/${created.id}`)).version;
  }
  await call("POST", `/products/${created.id}/publish`);
  return created.id;
}

const charterPrice = (hours: number, price: number, km: number, extra: Record<string, unknown> = {}) => ({ package_hours: hours, pricing_model: "charter_package", package_km: km, package_price: price, overtime_per_hour: OVERTIME, over_km_per_km: OVER_KM, ...extra });

/** 平台建一个启用的城市（编号随机，测试之间互不影响）。 */
async function newCity(timezone: string, country: string, center: { lng: number; lat: number }): Promise<string> {
  const root = await platformLogin(api, "root@platform.test");
  const code = `CTY-${country}-Q${randomUUID().replace(/[^0-9a-f]/g, "").slice(0, 6).toUpperCase()}`;
  return (await ok(api.call("POST", "/platform/v1/master/cities", { token: root, body: { country_code: country, timezone, code, name: { zh: `QA 城市 ${code}` }, center } }), 201)).id;
}

/** 某个时刻在某个时区的当地日期 YYYY-MM-DD。 */
function localDate(at: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
}

/** 把测试时钟往后拨到下一个 UTC `hour`:00:00。 */
function moveToUtcHour(hour: number): Date {
  const now = api.clock.now();
  const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour));
  if (target.getTime() <= now.getTime()) target.setUTCDate(target.getUTCDate() + 1);
  api.clock.advance(target.getTime() - now.getTime());
  return target;
}

/** 东京当地时间：从现在起 `days` 天后的 `time`。 */
function tokyoLocal(days: number, time = "10:00"): string {
  return `${localDate(new Date(api.clock.now().getTime() + days * DAY), "Asia/Tokyo")}T${time}`;
}

const p2pBody = (extra: Record<string, unknown> = {}) => ({ category: "point_to_point", city_id: m.ids.tokyo, pickup: PICKUP, dropoff: DROPOFF, service_local: tokyoLocal(10), passengers: 2, luggage: 1, ...extra });
const charterBody = (extra: Record<string, unknown> = {}) => ({ category: "charter", city_id: m.ids.tokyo, pickup: PICKUP, package_hours: 8, service_local: tokyoLocal(10), passengers: 3, luggage: 2, ...extra });

async function quoteRes(body: Record<string, unknown>, on: SiteApi = site) {
  api.clock.advance(1_000);
  return on.call("POST", "/site/v1/quotes", { body, ip: nextIp() });
}

async function quote(body: Record<string, unknown>, on: SiteApi = site): Promise<any> {
  const res = await quoteRes(body, on);
  assert.equal(res.status, 200, res.text);
  return res.body;
}

async function order(body: Record<string, unknown>, key: string = randomUUID()) {
  api.clock.advance(1_000);
  return site.call("POST", "/site/v1/orders", { headers: { "idempotency-key": key }, body, ip: nextIp() });
}

/** 询价 → 下单（成功），返回下单应答。 */
async function placed(body: Record<string, unknown>, addresses: Record<string, string>): Promise<any> {
  const quoted = await quote(body);
  assert.ok(quoted.quotes.length > 0, JSON.stringify(quoted));
  const res = await order({ quote_id: quoted.quotes[0].quote_id, passenger: PASSENGER, save_payment_method: true, ...addresses });
  assert.equal(res.status, 201, res.text);
  return res.body;
}

async function payFor(orderId: string): Promise<void> {
  const intent = pay.intentOf(orderId);
  assert.ok(intent, "下单时建了付款");
  pay.pay(intent.id);
  const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
  const res = await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()));
  assert.equal(res.status, 200, JSON.stringify(res.body));
}

const issuesOf = (res: { body: any }): [string, string][] => res.body.error.details.issues.map((issue: any) => [issue.path, issue.reason]);

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  // 东京：点对点甲 15,000；包车乙 8 小时 70,000（含 150 公里，不过期）、4 小时 40,000（含 80 公里，年底到期）
  await product(m.a, m.ids.tokyo, TOKYO_POLYGON, "point_to_point", [{ pricing_model: "fixed", base_price: 15_000 }]);
  await product(m.b, m.ids.tokyo, TOKYO_POLYGON, "charter", [charterPrice(8, 70_000, 150), charterPrice(4, 40_000, 80, { valid_to: "2026-12-31" })]);
  const siteChannel = await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网（QA）" });
  site = await siteApi(api, (await salesCredentials(api, m, siteChannel.id)).clientId, pay);
});
after(async () => {
  await site?.close();
  await api.close();
});

test("包车时长：套餐里没有的（5 小时）、最大值 72 小时都是 200 但报不出价；4 小时报出套餐和公里；小数、字符串、null、0 一律 400", async () => {
  const four = await quote(charterBody({ package_hours: 4 }));
  assert.deepEqual(four.quotes.map((entry: any) => [entry.price.total.amount, entry.package]), [["44000", { hours: 4, km: 80 }]]);
  for (const hours of [5, 72]) {
    const none = await quote(charterBody({ package_hours: hours }));
    assert.deepEqual([none.quotes.length, none.unavailable.length], [0, 1], `${hours} 小时`);
    assert.ok(none.unavailable[0].reasons.length > 0, JSON.stringify(none.unavailable));
  }
  for (const hours of [4.5, "8", null, 0, -1]) {
    const res = await quoteRes(charterBody({ package_hours: hours }));
    assert.equal(res.status, 400, `${JSON.stringify(hours)}：${res.text}`);
    assert.equal(res.body.error.code, "VALIDATION_FAILED");
  }
});

test("点对点起终点相同：照样走报价引擎（同一个坐标是合法的行程），不 500；两端都必须在服务区里", async () => {
  const same = await quoteRes(p2pBody({ dropoff: PICKUP }));
  assert.equal(same.status, 200, same.text);
  const outside = { lng: 141.5, lat: 35.5 };
  const oneOut = await quote(p2pBody({ dropoff: outside }));
  assert.deepEqual([oneOut.quotes.length, oneOut.unavailable[0]?.reasons], [0, ["OUT_OF_SERVICE_AREA"]], "下车点在服务区外");
  const pickupOut = await quote(p2pBody({ pickup: outside }));
  assert.deepEqual([pickupOut.quotes.length, pickupOut.unavailable[0]?.reasons], [0, ["OUT_OF_SERVICE_AREA"]], "上车点在服务区外");
  const charterOut = await quote(charterBody({ pickup: outside }));
  assert.deepEqual([charterOut.quotes.length, charterOut.unavailable[0]?.reasons], [0, ["OUT_OF_SERVICE_AREA"]], "包车上车点在服务区外");
});

test("坐标：±90 / ±180 是合法的（服务区外，报不出价），差一点越界 400 并指到具体的项；多余的键、字符串、数组都 400", async () => {
  for (const point of [{ lng: 180, lat: 90 }, { lng: -180, lat: -90 }]) {
    const res = await quote(p2pBody({ dropoff: point }));
    assert.deepEqual([res.quotes.length, res.unavailable[0]?.reasons], [0, ["OUT_OF_SERVICE_AREA"]], JSON.stringify(point));
  }
  const cases: [Record<string, unknown>, string][] = [
    [p2pBody({ pickup: { lng: 139.7, lat: 90.000001 } }), "/pickup/lat"],
    [p2pBody({ dropoff: { lng: -180.000001, lat: 35.6 } }), "/dropoff/lng"],
    [charterBody({ pickup: { lng: 180.5, lat: 35.6 } }), "/pickup/lng"],
    [charterBody({ pickup: { lng: 139.7, lat: -91 } }), "/pickup/lat"],
  ];
  for (const [body, path] of cases) {
    const res = await quoteRes(body);
    assert.equal(res.status, 400, res.text);
    assert.ok(res.body.error.details.issues.some((issue: any) => issue.path === path), `${path}：${res.text}`);
  }
  for (const body of [p2pBody({ pickup: { ...PICKUP, alt: 0 } }), p2pBody({ pickup: { lng: "139.7", lat: "35.6" } }), charterBody({ pickup: [139.7, 35.6] }), p2pBody({ dropoff: null })]) {
    assert.equal((await quoteRes(body)).status, 400, JSON.stringify(body));
  }
});

test("地址长度：300 个字（含 emoji，按字符算）可以下单，301 个字 TOO_LONG，只有空白是 REQUIRED；包车不收下车地址", async () => {
  const quoted = await quote(p2pBody());
  const base = { quote_id: quoted.quotes[0].quote_id, passenger: PASSENGER, save_payment_method: true };
  const tooLong = await order({ ...base, pickup_address: "东".repeat(301), dropoff_address: "新宿站" });
  assert.deepEqual([tooLong.status, issuesOf(tooLong)], [400, [["/pickup_address", "TOO_LONG"]]]);
  const blank = await order({ ...base, pickup_address: "东京站", dropoff_address: "　 \t" });
  assert.deepEqual([blank.status, issuesOf(blank)], [400, [["/dropoff_address", "REQUIRED"]]]);
  const ok300 = await order({ ...base, pickup_address: "東".repeat(300), dropoff_address: "🚕".repeat(300) });
  assert.equal(ok300.status, 201, ok300.text);
  assert.deepEqual([[...ok300.body.order.pickup.address].length, [...ok300.body.order.dropoff.address].length], [300, 300]);

  const charter = await quote(charterBody());
  const charterBase = { quote_id: charter.quotes[0].quote_id, passenger: PASSENGER, save_payment_method: true };
  const both = await order({ ...charterBase, pickup_address: "东京站", dropoff_address: "新宿站", flight_no: "NH211" });
  assert.deepEqual([both.status, issuesOf(both).sort()], [400, [["/dropoff_address", "NOT_APPLICABLE"], ["/flight_no", "NOT_APPLICABLE"]]]);
  const noPickup = await order(charterBase);
  assert.deepEqual([noPickup.status, issuesOf(noPickup)], [400, [["/pickup_address", "REQUIRED"]]]);
});

test("改单：点对点两端地址都能改（301 个字 TOO_LONG、不能填航班号）；包车改下车地址 NOT_APPLICABLE、上车地址照常能改", async () => {
  const p2p = await placed(p2pBody(), { pickup_address: "东京站八重洲口", dropoff_address: "新宿站南口" });
  await payFor(p2p.order.id);
  const token = p2p.link.token as string;
  const patch = async (body: Record<string, unknown>) => {
    const view = await site.call("GET", "/site/v1/order", { token, ip: nextIp() });
    return site.call("PATCH", "/site/v1/order", { token, ip: nextIp(), headers: { "if-match": `"${view.body.order.version}"` }, body });
  };
  const long = await patch({ dropoff_address: "地".repeat(301) });
  assert.deepEqual([long.status, issuesOf(long)], [400, [["/dropoff_address", "TOO_LONG"]]]);
  const flight = await patch({ flight_no: "NH211" });
  assert.deepEqual([flight.status, issuesOf(flight)], [400, [["/flight_no", "NOT_APPLICABLE"]]]);
  const changed = await patch({ pickup_address: "东京站丸之内北口", dropoff_address: "涩谷站八公口" });
  assert.equal(changed.status, 200, changed.text);
  assert.deepEqual([changed.body.order.pickup.address, changed.body.order.dropoff.address, changed.body.order.pickup.lng, changed.body.order.dropoff.lat], ["东京站丸之内北口", "涩谷站八公口", PICKUP.lng, DROPOFF.lat]);

  const charter = await placed(charterBody(), { pickup_address: "东京站大饭店" });
  await payFor(charter.order.id);
  const charterToken = charter.link.token as string;
  const view = await site.call("GET", "/site/v1/order", { token: charterToken, ip: nextIp() });
  const dropoff = await site.call("PATCH", "/site/v1/order", { token: charterToken, ip: nextIp(), headers: { "if-match": `"${view.body.order.version}"` }, body: { dropoff_address: "新宿站" } });
  assert.deepEqual([dropoff.status, issuesOf(dropoff)], [400, [["/dropoff_address", "NOT_APPLICABLE"]]]);
  const pickup = await site.call("PATCH", "/site/v1/order", { token: charterToken, ip: nextIp(), headers: { "if-match": `"${view.body.order.version}"` }, body: { pickup_address: "帝国饭店" } });
  assert.equal(pickup.status, 200, pickup.text);
  assert.deepEqual([pickup.body.order.pickup.address, pickup.body.order.dropoff, pickup.body.order.package_hours], ["帝国饭店", null, 8]);
});

test("包车改期：改到当地 23:30（跨午夜跑完）价不变、套餐不变；改到 4 小时套餐到期（12-31）之后 409 CHANGE_NOT_SERVICEABLE，订单不变", async () => {
  const eight = await placed(charterBody({ service_local: tokyoLocal(12, "09:00") }), { pickup_address: "东京站" });
  await payFor(eight.order.id);
  const token = eight.link.token as string;
  const before = (await site.call("GET", "/site/v1/order", { token, ip: nextIp() })).body.order;
  const date = before.service_local.slice(0, 10);
  const moved = await site.call("PATCH", "/site/v1/order", { token, ip: nextIp(), headers: { "if-match": `"${before.version}"` }, body: { service_time: `${date}T23:30:00+09:00` } });
  assert.equal(moved.status, 200, moved.text);
  assert.deepEqual(
    [moved.body.order.service_local, moved.body.order.service_date, moved.body.order.service_time, moved.body.order.package_hours, moved.body.order.price.total.amount],
    [`${date}T23:30`, date, new Date(`${date}T14:30:00Z`).toISOString(), 8, before.price.total.amount],
  );

  const four = await placed(charterBody({ package_hours: 4, service_local: "2026-12-31T23:00" }), { pickup_address: "东京站" });
  assert.equal(four.order.price.total.amount, "44000");
  await payFor(four.order.id);
  const fourToken = four.link.token as string;
  const fourView = (await site.call("GET", "/site/v1/order", { token: fourToken, ip: nextIp() })).body.order;
  const late = await site.call("PATCH", "/site/v1/order", { token: fourToken, ip: nextIp(), headers: { "if-match": `"${fourView.version}"` }, body: { service_time: "2027-01-01T09:00:00+09:00" } });
  assert.deepEqual([late.status, late.body.error.code], [409, "CHANGE_NOT_SERVICEABLE"], late.text);
  const after = (await site.call("GET", "/site/v1/order", { token: fourToken, ip: nextIp() })).body.order;
  assert.deepEqual([after.service_local, after.version], ["2026-12-31T23:00", fourView.version]);
});

test("取消：点对点、包车各按自己品类的取消阶梯；试算与实际一致（扣的 + 退的 = 付的）；取消后再试算不能取消", async () => {
  for (const [body, addresses, category] of [
    [p2pBody({ service_local: tokyoLocal(9) }), { pickup_address: "东京站", dropoff_address: "新宿站" }, "point_to_point"],
    [charterBody({ service_local: tokyoLocal(9) }), { pickup_address: "东京站" }, "charter"],
  ] as const) {
    const done = await placed(body, addresses);
    await payFor(done.order.id);
    const token = done.link.token as string;
    const fee = await site.call("GET", "/site/v1/order/cancel-fee", { token, ip: nextIp() });
    assert.equal(fee.status, 200, fee.text);
    assert.equal(done.order.cancel_policy.category, category);
    assert.equal(Number(fee.body.fee.amount) + Number(fee.body.refund.amount), Number(done.order.price.total.amount), category);
    const cancelled = await site.call("POST", "/site/v1/order/cancel", { token, ip: nextIp(), body: {} });
    assert.equal(cancelled.status, 200, cancelled.text);
    assert.deepEqual([cancelled.body.order.status, cancelled.body.order.cancellation.fee, cancelled.body.order.cancellation.refund], ["cancelled", fee.body.fee, fee.body.refund], category);
    assert.equal((await site.call("GET", "/site/v1/order/cancel-fee", { token, ip: nextIp() })).body.cancellable, false);
  }
});

test("对外价与结算价隔离：官网的包车报价、下单、订单页、取消试算里没有超时 / 超公里单价、套餐结算价、供应商、加价比例；中标的乙看不到对外价，甲看不到这张单", async () => {
  const quoted = await quote(charterBody());
  const placedRes = await order({ quote_id: quoted.quotes[0].quote_id, passenger: PASSENGER, save_payment_method: true, pickup_address: "东京站" });
  assert.equal(placedRes.status, 201, placedRes.text);
  const token = placedRes.body.link.token as string;
  const view = await site.call("GET", "/site/v1/order", { token, ip: nextIp() });
  const fee = await site.call("GET", "/site/v1/order/cancel-fee", { token, ip: nextIp() });
  const forbiddenKeys = ["overtime_per_hour", "over_km_per_km", "package_price", "settlement", "settlement_minor", "markup", "markup_bp", "tenant_id", "winner_tenant_id", "product_id", "price_rule_id", "fx_buffer_bp"];
  for (const [what, body, text] of [["报价", quoted, JSON.stringify(quoted)], ["下单", placedRes.body, placedRes.text], ["订单页", view.body, view.text], ["取消试算", fee.body, fee.text]] as const) {
    const keys = allKeys(body);
    for (const key of forbiddenKeys) assert.ok(!keys.has(key), `${what}里有 ${key}`);
    assert.doesNotMatch(text, new RegExp(`${OVERTIME}|${OVER_KM}|70000|乙车队|甲车队`), what);
  }
  assert.equal(view.body.order.winning_tenant, null, "付款前不显示供应商");

  await payFor(placedRes.body.order.id);
  const paidView = await site.call("GET", "/site/v1/order", { token, ip: nextIp() });
  assert.doesNotMatch(paidView.text, new RegExp(`${OVERTIME}|${OVER_KM}|70000`), "付款后的订单页也没有结算口径");
  const tenantB = await api.call("GET", `/tenant/v1/orders/${placedRes.body.order.id}`, { token: await tenantLogin(api, m.b.adminEmail) });
  assert.equal(tenantB.status, 200, tenantB.text);
  const tenantKeys = allKeys(tenantB.body);
  for (const key of ["markup", "markup_bp", "sell_minor", "sell", "fx_buffer_bp"]) assert.ok(!tenantKeys.has(key), `供应商看到了 ${key}`);
  assert.doesNotMatch(tenantB.text, /77000|77,000/, "供应商看不到对外价");
  const tenantA = await api.call("GET", `/tenant/v1/orders/${placedRes.body.order.id}`, { token: await tenantLogin(api, m.a.adminEmail) });
  assert.equal(tenantA.status, 404, tenantA.text);
  const listA = await api.call("GET", "/tenant/v1/orders", { token: await tenantLogin(api, m.a.adminEmail) });
  assert.ok(!listA.text.includes(placedRes.body.order.id), "甲的订单列表里没有乙的包车单");
});

test("跨渠道：只授权大阪的官网渠道——城市列表没有东京，东京的包车时长是空的，询东京点对点 / 包车 422 CHANNEL_SCOPE_DENIED", async () => {
  const osakaOnly = await newChannel(api, m.staff.cm1.token, { name: "只卖大阪的官网", scope: { city_ids: [m.ids.osaka] } });
  const other = await siteApi(api, (await salesCredentials(api, m, osakaOnly.id)).clientId, pay);
  try {
    const cities = await other.call("GET", "/site/v1/cities", { ip: nextIp() });
    assert.ok(!cities.body.items.some((city: any) => city.id === m.ids.tokyo), cities.text);
    assert.deepEqual((await other.call("GET", `/site/v1/cities/${m.ids.tokyo}/charter-packages`, { ip: nextIp() })).body.items, []);
    for (const body of [p2pBody(), charterBody()]) {
      const denied = await quoteRes(body, other);
      assert.deepEqual([denied.status, denied.body.error.code], [422, "CHANNEL_SCOPE_DENIED"], JSON.stringify(body));
    }
  } finally {
    await other.close();
  }
});

test("包车时长跟着供应商和商品走：新供应商上架 10 小时后能选到，暂停后城市和时长都不再列；下架的商品同样不列", async () => {
  const cityId = await newCity("Asia/Tokyo", "JP", { lng: 139.6, lat: 35.45 });
  const root = await platformLogin(api, "root@platform.test");
  const e = await api.tenantWithAdmin(root, `戊车队-${randomUUID().slice(0, 4)}`, `admin-${randomUUID().slice(0, 8)}@qa-e.test`);
  const f = await api.tenantWithAdmin(root, `己车队-${randomUUID().slice(0, 4)}`, `admin-${randomUUID().slice(0, 8)}@qa-f.test`);
  await product(e, cityId, TOKYO_POLYGON, "charter", [charterPrice(10, 90_000, 200)]);
  const fProduct = await product(f, cityId, TOKYO_POLYGON, "charter", [charterPrice(6, 60_000, 120)]);
  const hours = async () => (await site.call("GET", `/site/v1/cities/${cityId}/charter-packages`, { ip: nextIp() })).body.items.map((item: any) => item.hours);
  const categories = async () => (await site.call("GET", "/site/v1/cities", { ip: nextIp() })).body.items.find((city: any) => city.id === cityId)?.categories ?? null;
  assert.deepEqual(await hours(), [6, 10]);
  assert.deepEqual(await categories(), ["charter"]);

  await api.db.owner.query("update tenants set status = 'suspended', suspended_from = 'active', suspended_at = $2, suspension_reasons = array['manual'] where id = $1", [e.tenantId, api.clock.now()]);
  assert.deepEqual(await hours(), [6], "暂停的戊不再提供 10 小时");
  await ok(api.call("POST", `/tenant/v1/products/${fProduct}/unpublish`, { token: await tenantLogin(api, f.adminEmail) }));
  assert.deepEqual(await hours(), [], "己的商品下架了");
  assert.equal(await categories(), null, "城市里没有能订的了");
});

test("包车时长的「今天」按城市当地日期：洛杉矶（比 UTC 晚一天时）当地今天到期的照列、昨天到期的不列；奥克兰（比 UTC 早一天时）UTC 今天到期的已经不列；以后才生效的照列", async () => {
  const la = await newCity("America/Los_Angeles", "US", { lng: -118.25, lat: 34.05 });
  const akl = await newCity("Pacific/Auckland", "NZ", { lng: 174.76, lat: -36.85 });
  const laPolygon = [[[-119.0, 33.5], [-117.5, 33.5], [-117.5, 34.5], [-119.0, 34.5], [-119.0, 33.5]]];
  const aklPolygon = [[[174.0, -37.5], [175.5, -37.5], [175.5, -36.0], [174.0, -36.0], [174.0, -37.5]]];

  // UTC 03:00：洛杉矶还是前一天 20:00
  const at = moveToUtcHour(3);
  const utcToday = at.toISOString().slice(0, 10);
  const laToday = localDate(at, "America/Los_Angeles");
  assert.equal(laToday, addDays(utcToday, -1));
  await product(m.a, la, laPolygon, "charter", [charterPrice(2, 20_000, 40, { valid_to: addDays(laToday, -1) }), charterPrice(3, 30_000, 60, { valid_to: laToday }), charterPrice(5, 50_000, 100, { valid_from: addDays(laToday, 30) })]);
  const laHours = (await site.call("GET", `/site/v1/cities/${la}/charter-packages`, { ip: nextIp() })).body.items.map((item: any) => item.hours);
  assert.deepEqual(laHours, [3, 5], "洛杉矶当地今天到期的 3 小时照列；昨天到期的 2 小时不列；30 天后生效的 5 小时照列");

  // UTC 12:00：奥克兰已经是第二天凌晨
  const at2 = moveToUtcHour(12);
  const utcToday2 = at2.toISOString().slice(0, 10);
  const aklToday = localDate(at2, "Pacific/Auckland");
  assert.equal(aklToday, addDays(utcToday2, 1));
  await product(m.a, akl, aklPolygon, "charter", [charterPrice(2, 20_000, 40, { valid_to: utcToday2 }), charterPrice(3, 30_000, 60, { valid_to: aklToday })]);
  const aklHours = (await site.call("GET", `/site/v1/cities/${akl}/charter-packages`, { ip: nextIp() })).body.items.map((item: any) => item.hours);
  assert.deepEqual(aklHours, [3], "奥克兰当地已经过了 UTC 的今天：UTC 今天到期的 2 小时不列");
});

test("时区与跨午夜：洛杉矶的点对点价格 10-20 到期——当地 10-20 23:59 报得出（UTC 已是 10-21），当地 10-21 00:00 报不出；包车 20:00 起 8 小时跨午夜，订单按当地日期记", async () => {
  const la = await newCity("America/Los_Angeles", "US", { lng: -118.25, lat: 34.05 });
  const polygon = [[[-119.0, 33.5], [-117.5, 33.5], [-117.5, 34.5], [-119.0, 34.5], [-119.0, 33.5]]];
  await product(m.a, la, polygon, "point_to_point", [{ pricing_model: "fixed", base_price: 10_000, valid_to: "2026-10-20" }]);
  await product(m.a, la, polygon, "charter", [charterPrice(8, 70_000, 150)]);
  const base = { category: "point_to_point", city_id: la, pickup: { lng: -118.25, lat: 34.05 }, dropoff: { lng: -118.4, lat: 33.95 }, passengers: 2, luggage: 0 };

  const lastMinute = await quote({ ...base, service_local: "2026-10-20T23:59" });
  assert.deepEqual(lastMinute.quotes.map((entry: any) => [entry.price.total.amount, entry.service_date]), [["11000", "2026-10-20"]], "当地 10-20 23:59（UTC 10-21 06:59）仍在有效期");
  const nextDay = await quote({ ...base, service_local: "2026-10-21T00:00" });
  assert.equal(nextDay.quotes.length, 0, "当地 10-21 00:00 已过有效期");

  const charter = await quote({ category: "charter", city_id: la, pickup: base.pickup, package_hours: 8, service_local: "2026-10-30T20:00", passengers: 2, luggage: 0 });
  assert.deepEqual(charter.quotes.map((entry: any) => [entry.service_date, entry.package]), [["2026-10-30", { hours: 8, km: 150 }]]);
  const res = await order({ quote_id: charter.quotes[0].quote_id, passenger: PASSENGER, save_payment_method: true, pickup_address: "Union Station" });
  assert.equal(res.status, 201, res.text);
  assert.deepEqual(
    [res.body.order.service_local, res.body.order.service_date, res.body.order.service_time, res.body.order.timezone, res.body.order.package_hours],
    ["2026-10-30T20:00", "2026-10-30", "2026-10-31T03:00:00.000Z", "America/Los_Angeles", 8],
  );
});

test("缺陷：城市当地不存在的时间（洛杉矶夏令时跳过的 2027-03-14 02:30）应 400 INVALID_FORMAT（ADR 0032「不存在的当地时间 400」），实际 200 并按 03:30 报价", async () => {
  const la = await newCity("America/Los_Angeles", "US", { lng: -118.25, lat: 34.05 });
  const polygon = [[[-119.0, 33.5], [-117.5, 33.5], [-117.5, 34.5], [-119.0, 34.5], [-119.0, 33.5]]];
  await product(m.a, la, polygon, "charter", [charterPrice(8, 70_000, 150)]);
  const body = { category: "charter", city_id: la, pickup: { lng: -118.25, lat: 34.05 }, package_hours: 8, passengers: 2, luggage: 0 };
  const exists = await quote({ ...body, service_local: "2027-03-14T03:30" });
  assert.equal(exists.quotes.length, 1, "拨快之后的 03:30 是存在的时间，报得出价");
  const gap = await quoteRes({ ...body, service_local: "2027-03-14T02:30" });
  assert.equal(gap.status, 400, `夏令时跳过的 02:30 不存在：${gap.text}`);
  assert.deepEqual(issuesOf(gap), [["/service_local", "INVALID_FORMAT"]]);
});

test("提前量边界按城市当地时间：东京包车（提前 24 小时）恰好 24 小时后报得出，差 1 分钟报不出 LEAD_TIME_TOO_SHORT", async () => {
  const now = api.clock.now();
  // 拨到下一个整分钟：当地时间只有分钟精度
  api.clock.advance(60_000 - (now.getTime() % 60_000));
  const at = new Date(api.clock.now().getTime() + DAY);
  const local = (date: Date) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map((part) => [part.type, part.value]));
    return `${parts["year"]}-${parts["month"]}-${parts["day"]}T${parts["hour"]}:${parts["minute"]}`;
  };
  const exact = await site.call("POST", "/site/v1/quotes", { body: charterBody({ service_local: local(at) }), ip: nextIp() });
  assert.equal(exact.status, 200, exact.text);
  assert.equal(exact.body.quotes.length, 1, `恰好 24 小时：${exact.text}`);
  const short = await site.call("POST", "/site/v1/quotes", { body: charterBody({ service_local: local(new Date(at.getTime() - 60_000)) }), ip: nextIp() });
  assert.deepEqual([short.body.quotes.length, short.body.unavailable[0]?.reasons], [0, ["LEAD_TIME_TOO_SHORT"]]);
});

test("常用地点：最多 500 个，机场、车站排在前面不会被截掉；停用的不列；城市停用后为空列表", async () => {
  const cityId = await newCity("Asia/Tokyo", "JP", { lng: 139.6, lat: 35.45 });
  const now = api.clock.now();
  const insert = (type: string, code: string, category: string | null, status = "active") =>
    api.db.owner.query(
      `insert into places (type, code, country_code, city_id, name, lng, lat, category, flight_scope, status, created_at, updated_at)
       values ($1, $2, 'JP', $3, $4::jsonb, 139.6, 35.45, $5, $6, $7, $8, $8)`,
      [type, code, cityId, JSON.stringify({ zh: `地点 ${code}` }), category, type === "airport" ? "domestic" : null, status, now],
    );
  const suffix = randomUUID().replace(/[^0-9a-f]/g, "").slice(0, 4).toUpperCase();
  await insert("airport", `Q${suffix.replace(/[0-9]/g, "Z").slice(0, 2)}`, null);
  await insert("station", `STN-JP-Q${suffix}`, "rail");
  await insert("poi", `POI-${suffix}0000`, "hotel", "disabled");
  for (let index = 1; index <= 505; index += 1) await insert("poi", `POI-${suffix}${String(index).padStart(4, "0")}`, "hotel");

  const res = await site.call("GET", `/site/v1/cities/${cityId}/places`, { ip: nextIp() });
  assert.equal(res.status, 200, res.text);
  const items = res.body.items as any[];
  assert.equal(items.length, 500);
  assert.deepEqual(items.slice(0, 3).map((item) => item.type), ["airport", "station", "poi"]);
  assert.equal(items[2].code, `POI-${suffix}0001`, "停用的 POI-…0000 不列");
  assert.equal(items[499].code, `POI-${suffix}0498`);
  for (const item of items) assert.deepEqual(Object.keys(item).sort(), ["address", "code", "id", "location", "name", "type"]);

  await api.db.owner.query("update cities set status = 'disabled' where id = $1", [cityId]);
  assert.deepEqual((await site.call("GET", `/site/v1/cities/${cityId}/places`, { ip: nextIp() })).body.items, []);
  assert.deepEqual((await site.call("GET", `/site/v1/cities/${cityId}/charter-packages`, { ip: nextIp() })).body.items, []);
});

test("询价日志：点对点记上下车坐标、包车记上车坐标和时长，都带品类；不记接送机的字段", async () => {
  await quote(p2pBody({ passengers: 5 }));
  const p2p = (await api.db.owner.query("select category, request from quote_logs where request->>'source' = 'site' and request->>'category' = 'point_to_point' and (request->>'passengers')::int = 5 order by created_at desc limit 1")).rows[0];
  assert.ok(p2p, "记了点对点的询价");
  assert.equal(p2p.category, "point_to_point");
  assert.deepEqual([p2p.request.pickup, p2p.request.dropoff, "airport_id" in p2p.request, "package_hours" in p2p.request], [PICKUP, DROPOFF, false, false]);

  await quote(charterBody({ passengers: 6, package_hours: 4 }));
  const charter = (await api.db.owner.query("select category, request from quote_logs where request->>'source' = 'site' and request->>'category' = 'charter' and (request->>'passengers')::int = 6 order by created_at desc limit 1")).rows[0];
  assert.ok(charter, "记了包车的询价");
  assert.deepEqual([charter.category, charter.request.pickup, charter.request.package_hours, "dropoff" in charter.request, "direction" in charter.request], ["charter", PICKUP, 4, false, false]);
});

test("包车下单幂等：同一个键并发提交 3 次只成一单；同一个键换了上车地址被拒", async () => {
  const quoted = await quote(charterBody({ service_local: tokyoLocal(11) }));
  const key = randomUUID();
  const body = { quote_id: quoted.quotes[0].quote_id, passenger: PASSENGER, save_payment_method: true, pickup_address: "东京站" };
  const results = await Promise.all([0, 1, 2].map(() => site.call("POST", "/site/v1/orders", { headers: { "idempotency-key": key }, body, ip: nextIp() })));
  for (const res of results) assert.ok(res.status === 200 || res.status === 201, res.text);
  assert.equal(new Set(results.map((res) => res.body.order.id)).size, 1);
  const count = await api.db.owner.query("select count(*)::int as n from order_sales where quote_id = $1", [quoted.quotes[0].quote_id]);
  assert.equal(count.rows[0].n, 1);
  const changed = await order({ ...body, pickup_address: "新宿站" }, key);
  assert.ok(changed.status >= 400 && changed.status < 500, changed.text);
});
