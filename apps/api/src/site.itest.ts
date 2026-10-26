/**
 * M3-05：官网的公开接口 `/site/v1`（ADR 0032），经真实接口、真实 PostgreSQL；收款服务用替身。
 * - 没配置官网 / 渠道暂停：暂未开放（已经下了的单照样能看）；
 * - 询价 → 下单 → 凭查看链接看订单、付款（替身）→ 「我已落地」（验收标准）；取消试算和取消、改单、对加收提异议；
 * - 不泄露中标供应商（付款前）、结算价、加价比例；只能看自己的单（链接只对应一张；找回要订单号 + 下单联系方式；别的渠道的单找不到）；
 * - 输入校验（不认识的字段、别的城市的机场、不存在的时间）；按来源地址限速（询价、下单、找回，找回另按订单号）；
 * - Stripe 没配置：照样建单、待支付，到期自动取消、释放库存；不伪造付款成功。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { type TestApi, createTestApi } from "./testing/api.ts";
import { type Market, allKeys, approvedBy, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { completeOrder, tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let site: SiteApi;
let siteChannelId: string;
let other: SalesFlow;

const HOUR = 3_600_000;
const ADDRESS = { lng: 139.7, lat: 35.6 };
/** 2026-10-20 10:00 东京 = 01:00Z（测试的时钟从 2026-10-07 开始） */
const SERVICE_LOCAL = "2026-10-20T10:00";
const SCHEDULED = new Date("2026-10-20T01:00:00Z");
const PASSENGER = { name: "王小明", phone: "+81 90-1234-5678", email: "Guest.Site@Example.com" };

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  siteChannelId = (await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" })).id;
  const client = await salesCredentials(api, m, siteChannelId);
  site = await siteApi(api, client.clientId, pay);
  other = await salesFlow(api, m, pay);
});
after(async () => {
  await site?.close();
  await api.close();
});

const quoteBody = (extra: Record<string, unknown> = {}) => ({ city_id: m.ids.tokyo, airport_id: m.ids.narita, direction: "pickup", address: ADDRESS, service_local: SERVICE_LOCAL, passengers: 2, luggage: 1, ...extra });

async function quoteFor(vehicleGroupId: string, ip?: string): Promise<any> {
  api.clock.advance(1_000);
  const res = await site.call("POST", "/site/v1/quotes", { body: quoteBody(), ...(ip === undefined ? {} : { ip }) });
  assert.equal(res.status, 200, res.text);
  const quote = res.body.quotes.find((q: any) => q.vehicle_group.id === vehicleGroupId);
  assert.ok(quote, res.text);
  return quote;
}

async function placeOrder(on: SiteApi = site, ip?: string): Promise<any> {
  const quote = await quoteFor(m.ids.biz7, ip);
  api.clock.advance(1_000);
  const res = await on.call("POST", "/site/v1/orders", {
    headers: { "idempotency-key": randomUUID() },
    body: { quote_id: quote.quote_id, passenger: PASSENGER, flight_no: "nh 211", dropoff_address: "东京站八重洲口", save_payment_method: true },
    ...(ip === undefined ? {} : { ip }),
  });
  assert.equal(res.status, 201, res.text);
  return res;
}

async function payFor(orderId: string): Promise<void> {
  const intent = pay.intentOf(orderId);
  assert.ok(intent);
  pay.pay(intent.id);
  const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
  const res = await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()));
  assert.equal(res.status, 200, JSON.stringify(res.body));
}

const guest = (token: string, method: "GET" | "POST" | "PATCH" = "GET", url = "/site/v1/order", extra: { body?: unknown; headers?: Record<string, string> } = {}) => site.call(method, url, { token, ...extra });

test("没配置官网的 API 客户端：config 说没开，城市、询价、下单、找回都是 503 SITE_NOT_OPEN", async () => {
  const closed = await siteApi(api, null, pay);
  try {
    const config = await closed.call("GET", "/site/v1/config");
    assertMatchesOpenApi("GET", "/site/v1/config", config);
    assert.deepEqual(config.body, { open: false, currency: null, payments: null });
    for (const [method, url, body] of [["GET", "/site/v1/cities", undefined], ["POST", "/site/v1/quotes", quoteBody()], ["POST", "/site/v1/orders/lookup", { order_no: "NZ20261007ABCDEFGH", contact: "a@b.c" }]] as const) {
      const res = await closed.call(method, url, body === undefined ? {} : { body });
      assert.deepEqual([res.status, res.body.error.code], [503, "SITE_NOT_OPEN"], url);
    }
    assert.equal((await closed.call("GET", "/site/v1/order", { token: `nzo_${"a".repeat(43)}` })).body.error.code, "SITE_NOT_OPEN");
  } finally {
    await closed.close();
  }
});

test("开着：config 给币种和 Stripe 的 publishable key（只有它）；城市、机场只列能预订的；名称来自主数据", async () => {
  const config = await site.call("GET", "/site/v1/config");
  assert.deepEqual(config.body, { open: true, currency: "JPY", payments: { provider: "stripe", publishable_key: pay.publishableKey } });
  assert.doesNotMatch(config.text, /sk_|whsec_/);
  const cities = await site.call("GET", "/site/v1/cities");
  assertMatchesOpenApi("GET", "/site/v1/cities", cities);
  assert.deepEqual(cities.body.items.map((city: any) => [city.code, city.name.zh, city.timezone]), [["CTY-JP-TYO", "东京", "Asia/Tokyo"]], "大阪没有上架的商品，不列");
  assert.equal(cities.headers["cache-control"], "no-store");
  const airports = await site.call("GET", `/site/v1/cities/${m.ids.tokyo}/airports`);
  assertMatchesOpenApi("GET", "/site/v1/cities/{id}/airports", airports);
  assert.deepEqual(airports.body.items.map((airport: any) => [airport.code, airport.name.zh]), [["NRT", "成田机场"]]);
  assert.deepEqual((await site.call("GET", `/site/v1/cities/${m.ids.osaka}/airports`)).body.items, []);
});

test("询价：各车型组的对外价（结算价 × 1.1）、车型组名称、取消阶梯；没有中标供应商、结算价、加价比例", async () => {
  const res = await site.call("POST", "/site/v1/quotes", { body: quoteBody() });
  assertMatchesOpenApi("POST", "/site/v1/quotes", res);
  assert.deepEqual(
    res.body.quotes.map((quote: any) => [quote.vehicle_group.name.zh, quote.price.total.amount, quote.cancel_policy.level]),
    [["经济 4 座", "13200", "economy"], ["商务 7 座", "21780", "business"]],
    "价低的在前；商务 7 座乙 19,800 中标",
  );
  const biz = res.body.quotes[1];
  assert.deepEqual(biz.cancel_policy.tiers[0], { min_hours_before: 48, fee_bp: 0 });
  const keys = allKeys(res.body);
  for (const leaked of ["settlement", "markup_bp", "markup_percent", "winner_tenant_id", "tenant_id", "winning_tenant"]) assert.ok(!keys.has(leaked), leaked);
  assert.doesNotMatch(res.text, /19800|20000|12000|甲车队|乙车队/);
});

test("输入校验：不认识的字段、别的城市的机场、不存在的城市、时间格式、人数超范围一律 400", async () => {
  for (const [body, path] of [
    [quoteBody({ channel_id: siteChannelId }), ""],
    [quoteBody({ currency: "USD" }), ""],
    [quoteBody({ city_id: m.ids.osaka }), "/airport_id"],
    [quoteBody({ city_id: randomUUID() }), "/city_id"],
    [quoteBody({ service_local: "2026-10-20 10:00" }), "/service_local"],
    [quoteBody({ service_local: "2026-02-30T10:00" }), "/service_local"],
    [quoteBody({ passengers: 0 }), "/passengers"],
    [quoteBody({ address: { lng: 200, lat: 35 } }), "/address/lng"],
  ] as const) {
    const res = await site.call("POST", "/site/v1/quotes", { body });
    assert.equal(res.status, 400, JSON.stringify(body));
    if (path !== "") assert.ok(res.body.error.details.issues.some((issue: any) => issue.path === path), `${path}: ${res.text}`);
  }
  const quote = await quoteFor(m.ids.biz7);
  const extra = await site.call("POST", "/site/v1/orders", { headers: { "idempotency-key": randomUUID() }, body: { quote_id: quote.quote_id, passenger: PASSENGER, flight_no: "NH211", dropoff_address: "东京站", save_payment_method: true, channel_order_no: "X" } });
  assert.equal(extra.status, 400, "渠道的订单号传不进来");
  const noFlight = await site.call("POST", "/site/v1/orders", { headers: { "idempotency-key": randomUUID() }, body: { quote_id: quote.quote_id, passenger: PASSENGER, dropoff_address: "东京站", save_payment_method: true } });
  assert.deepEqual([noFlight.status, noFlight.body.error.details.issues[0].path], [400, "/flight_no"], "接机必填航班号");
  const noKey = await site.call("POST", "/site/v1/orders", { body: { quote_id: quote.quote_id, passenger: PASSENGER, flight_no: "NH211", dropoff_address: "东京站", save_payment_method: true } });
  assert.equal(noKey.status, 400, "要带 Idempotency-Key");
});

test("下单：待支付、有付款凭据和一次性的查看链接（库里只有哈希）；凭链接看得到这一张；付款前没有中标供应商；重复提交同一张单", async () => {
  const quote = await quoteFor(m.ids.biz7);
  const key = randomUUID();
  const body = { quote_id: quote.quote_id, passenger: PASSENGER, flight_no: "nh 211", dropoff_address: "东京站八重洲口", save_payment_method: true };
  const created = await site.call("POST", "/site/v1/orders", { headers: { "idempotency-key": key }, body });
  assertMatchesOpenApi("POST", "/site/v1/orders", created);
  assert.equal(created.status, 201, created.text);
  const { order, payment, link, names } = created.body;
  assert.deepEqual([order.status, order.price.total.amount, order.flight_no, order.winning_tenant], ["pending_payment", "21780", "NH211", null]);
  assert.match(payment.client_secret, /secret/);
  assert.deepEqual([names.city.name.zh, names.place.code, names.vehicle_group.name.zh], ["东京", "NRT", "商务 7 座"]);
  assert.deepEqual(created.body.timeline.map((event: any) => event.to_status), ["pending_payment"]);
  assert.doesNotMatch(created.text, /19800|乙车队|markup|settlement/);
  const stored = await api.db.owner.query<{ token_hash: string; issued_via: string; expires_at: Date }>("select token_hash, issued_via, expires_at from site_order_links where order_id = $1", [order.id]);
  assert.deepEqual(stored.rows.map((row) => [row.token_hash, row.issued_via]), [[createHash("sha256").update(link.token).digest("hex"), "order"]]);
  assert.equal(stored.rows[0]?.expires_at.toISOString(), new Date(SCHEDULED.getTime() + 30 * 24 * HOUR).toISOString(), "用车后 30 天");
  assert.doesNotMatch(JSON.stringify(await api.db.owner.query("select * from site_order_links")), new RegExp(link.token));

  const seen = await guest(link.token);
  assertMatchesOpenApi("GET", "/site/v1/order", seen);
  assert.equal(seen.body.order.id, order.id);
  assert.equal(seen.headers["cache-control"], "no-store");

  const again = await site.call("POST", "/site/v1/orders", { headers: { "idempotency-key": key }, body });
  assert.deepEqual([again.status, again.headers["idempotent-replayed"], again.body.order.id], [201, "true", order.id]);
  assert.notEqual(again.body.link.token, link.token, "重复提交另发一个链接");

  const payment2 = await guest(link.token, "GET", "/site/v1/order/payment");
  assertMatchesOpenApi("GET", "/site/v1/order/payment", payment2);
  assert.equal(payment2.body.payment.client_secret, payment.client_secret, "回到订单页接着付同一笔");
});

test("只能看自己的单：没带、格式不对、伪造的令牌一律 401；令牌不能当渠道令牌用；别的渠道的单用订单号也找不到", async () => {
  const mine = (await placeOrder()).body;
  for (const token of [undefined, "nzo_short", `nzo_${"x".repeat(43)}`, mine.link.token.slice(0, -1) + (mine.link.token.endsWith("A") ? "B" : "A")]) {
    const res = await site.call("GET", "/site/v1/order", token === undefined ? {} : { token });
    assertMatchesOpenApi("GET", "/site/v1/order", res);
    assert.deepEqual([res.status, res.body.error.code], [401, "ORDER_LINK_INVALID"], String(token));
  }
  assert.equal((await api.call("GET", `/sales/v1/orders/${mine.order.id}`, { token: mine.link.token })).status, 401);
  const foreign = await other.unpaidOrder();
  const lookup = await site.call("POST", "/site/v1/orders/lookup", { body: { order_no: foreign.order_no, contact: "guest@example.com" } });
  assert.deepEqual([lookup.status, lookup.body.error.code], [404, "ORDER_NOT_FOUND"]);
});

test("找回：订单号 + 下单邮箱（不分大小写）或手机号（去掉空格连字符）发新链接；联系方式不对、订单号不存在是同一个 404", async () => {
  const placed = (await placeOrder(site, "198.51.100.77")).body;
  const byEmail = await site.call("POST", "/site/v1/orders/lookup", { ip: "198.51.100.77", body: { order_no: placed.order.order_no.toLowerCase(), contact: " guest.site@example.COM " } });
  assertMatchesOpenApi("POST", "/site/v1/orders/lookup", byEmail);
  assert.equal(byEmail.status, 200, byEmail.text);
  assert.equal((await guest(byEmail.body.link.token)).body.order.id, placed.order.id);
  const byPhone = await site.call("POST", "/site/v1/orders/lookup", { ip: "198.51.100.77", body: { order_no: placed.order.order_no, contact: "+819012345678" } });
  assert.equal(byPhone.status, 200, byPhone.text);
  const wrong = await site.call("POST", "/site/v1/orders/lookup", { ip: "198.51.100.77", body: { order_no: placed.order.order_no, contact: "someone@example.com" } });
  const missing = await site.call("POST", "/site/v1/orders/lookup", { ip: "198.51.100.77", body: { order_no: "NZ20261007ZZZZZZZZ", contact: "guest.site@example.com" } });
  assert.deepEqual([wrong.status, wrong.body.error], [404, missing.body.error]);
  const vias = await api.db.owner.query<{ issued_via: string }>("select issued_via from site_order_links where order_id = $1 order by created_at", [placed.order.id]);
  assert.deepEqual(vias.rows.map((row) => row.issued_via), ["order", "lookup", "lookup"]);
});

test("限速：找回每个地址 15 分钟 10 次、每个订单号每小时 10 次（换地址也挡住，失败也算）；询价每分钟 30 次；下单 10 分钟 10 次", async () => {
  const placed = (await placeOrder(site, "198.51.100.90")).body;
  const tries = (ip: string) => site.call("POST", "/site/v1/orders/lookup", { ip, body: { order_no: placed.order.order_no, contact: "wrong@example.com" } });
  for (let i = 0; i < 10; i += 1) assert.equal((await tries("198.51.100.91")).status, 404);
  const limited = await tries("198.51.100.91");
  assertMatchesOpenApi("POST", "/site/v1/orders/lookup", limited);
  assert.deepEqual([limited.status, limited.body.error.code], [429, "RATE_LIMITED"]);
  assert.ok(Number(limited.headers["retry-after"]) > 0);
  // 换一个地址：这个地址的额度还在，但这个订单号这一小时已经猜了 10 次
  const sameOrder = await tries("198.51.100.92");
  assert.deepEqual([sameOrder.status, sameOrder.body.error.code], [429, "RATE_LIMITED"]);
  const otherOrder = await site.call("POST", "/site/v1/orders/lookup", { ip: "198.51.100.92", body: { order_no: "NZ20261007ZZZZZZZZ", contact: "wrong@example.com" } });
  assert.equal(otherOrder.status, 404, "别的订单号不受影响");

  for (let i = 0; i < 30; i += 1) assert.equal((await site.call("POST", "/site/v1/quotes", { ip: "198.51.100.93", body: { bad: true } })).status, 400);
  assert.equal((await site.call("POST", "/site/v1/quotes", { ip: "198.51.100.93", body: quoteBody() })).status, 429, "询价超限：不生成报价");
  assert.equal((await site.call("POST", "/site/v1/quotes", { ip: "198.51.100.94", body: quoteBody() })).status, 200, "别的地址不受影响");
  for (let i = 0; i < 10; i += 1) assert.equal((await site.call("POST", "/site/v1/orders", { ip: "198.51.100.95", body: {} })).status, 400);
  assert.equal((await site.call("POST", "/site/v1/orders", { ip: "198.51.100.95", body: {} })).status, 429);
});

test("Stripe 没配置：照样建单（待支付、没有付款信息）；接着付款 503；到期由超时检查自动取消；不伪造付款成功", async () => {
  const noStripe = await siteApi(api, (await api.db.owner.query<{ client_id: string }>("select client_id from channel_api_clients where channel_id = $1", [siteChannelId])).rows[0]!.client_id, null);
  try {
    const config = await noStripe.call("GET", "/site/v1/config");
    assert.deepEqual(config.body, { open: true, currency: "JPY", payments: null });
    const created = await placeOrder(noStripe, "198.51.100.120");
    assertMatchesOpenApi("POST", "/site/v1/orders", created);
    assert.deepEqual([created.body.order.status, created.body.payment, created.body.order.payment_status], ["pending_payment", null, "creating"]);
    assert.equal(pay.intentOf(created.body.order.id), undefined, "没有去建付款");
    const payment = await noStripe.call("GET", "/site/v1/order/payment", { token: created.body.link.token });
    assert.deepEqual([payment.status, payment.body.error.code], [503, "PAYMENT_NOT_CONFIGURED"]);
    api.clock.advance(31 * 60_000);
    await api.app.orderJobs.tick();
    const after = await noStripe.call("GET", "/site/v1/order", { token: created.body.link.token });
    assert.deepEqual([after.body.order.status, after.body.order.cancel_reason], ["cancelled", "PAYMENT_TIMEOUT"]);
  } finally {
    await noStripe.close();
  }
});

test("付款后：自动确认，时间线有确认，付款后才显示中标供应商；取消试算 → 改单（If-Match）→ 取消；渠道暂停后不能接新单，已下的单照样能看", async () => {
  const placed = (await placeOrder(site, "198.51.100.130")).body;
  const token = placed.link.token;
  await payFor(placed.order.id);
  const paid = await guest(token);
  assert.deepEqual([paid.body.order.status, paid.body.order.winning_tenant], ["confirmed", { name: "乙车队" }]);
  assert.deepEqual(paid.body.timeline.map((event: any) => event.to_status), ["pending_payment", "confirmed"]);
  assert.doesNotMatch(paid.text, /19800|markup|settlement/);

  const fee = await guest(token, "GET", "/site/v1/order/cancel-fee");
  assertMatchesOpenApi("GET", "/site/v1/order/cancel-fee", fee);
  assert.deepEqual([fee.body.cancellable, fee.body.fee_bp, fee.body.refund.amount], [true, 0, "21780"], "离用车还有 48 小时以上：全退");

  const stale = await guest(token, "PATCH", "/site/v1/order", { body: { flight_no: "JL5" }, headers: { "if-match": `"${paid.body.order.version - 1}"` } });
  assert.equal(stale.status, 409);
  const changed = await guest(token, "PATCH", "/site/v1/order", { body: { flight_no: "JL5", notes: "带一个婴儿车" }, headers: { "if-match": `"${paid.body.order.version}"` } });
  assertMatchesOpenApi("PATCH", "/site/v1/order", changed);
  assert.equal(changed.status, 200, changed.text);
  assert.deepEqual([changed.body.order.flight_no, changed.body.order.notes, changed.body.change.status], ["JL5", "带一个婴儿车", "applied"]);

  const cancelled = await guest(token, "POST", "/site/v1/order/cancel", { body: {} });
  assertMatchesOpenApi("POST", "/site/v1/order/cancel", cancelled);
  assert.deepEqual([cancelled.body.order.status, cancelled.body.order.cancellation.refund.amount, cancelled.body.replayed], ["cancelled", "21780", false]);
  assert.equal((await guest(token, "POST", "/site/v1/order/cancel", { body: {} })).body.replayed, true);

  await approvedBy(api, m, api.call("POST", `/platform/v1/channels/${siteChannelId}/pause`, { token: m.staff.cm1.token, body: { request_note: "官网维护" } }));
  try {
    assert.equal((await site.call("GET", "/site/v1/config")).body.open, false);
    assert.equal((await site.call("POST", "/site/v1/quotes", { body: quoteBody() })).body.error.code, "SITE_NOT_OPEN");
    assert.equal((await guest(token)).status, 200, "已下的单照样能看");
    assert.equal((await site.call("POST", "/site/v1/orders/lookup", { body: { order_no: placed.order.order_no, contact: PASSENGER.email } })).status, 200);
  } finally {
    await ok(api.call("POST", `/platform/v1/channels/${siteChannelId}/activate`, { token: m.staff.cm1.token }));
  }
});

test("事后加收：客人在订单页看到要付多少（客人支付币种）和异议期，异议期内提异议；没有供应商报的结算金额", async () => {
  const placed = (await placeOrder(site, "198.51.100.140")).body;
  await payFor(placed.order.id);
  await completeOrder(api, m, "b", placed.order.id);
  const submitted = await ok(api.call("POST", `/tenant/v1/orders/${placed.order.id}/extra-charges`, { token: await tenantLogin(api, m.b.adminEmail), body: { type: "waiting", amount: 2_000, description: "等了 40 分钟" } }), 201);
  const seen = await guest(placed.link.token);
  const charge = seen.body.order.extra_charges[0];
  assert.deepEqual([charge.amount.amount, charge.dispute_open], ["2200", true], "2,000 × 1.1");
  assert.doesNotMatch(JSON.stringify(seen.body.order.extra_charges), /"2000"/);
  const disputed = await guest(placed.link.token, "POST", `/site/v1/order/extra-charges/${submitted.extra_charge.id}/dispute`, { body: { reason: "司机没有等那么久" } });
  assertMatchesOpenApi("POST", "/site/v1/order/extra-charges/{chargeId}/dispute", disputed);
  assert.equal(disputed.body.extra_charge.status, "disputed");
  const unknown = await guest(placed.link.token, "POST", `/site/v1/order/extra-charges/${randomUUID()}/dispute`, { body: { reason: "x" } });
  assert.equal(unknown.status, 404);
});

test("验收标准：客人可点「我已落地」——付款前不能点；离计划到达 3 小时以上不能点；落地后点了记系统时间、以客人为准，再点不能改", async () => {
  const placed = (await placeOrder(site, "198.51.100.150")).body;
  const token = placed.link.token;
  const unpaid = await guest(token, "POST", "/site/v1/order/landed");
  assert.deepEqual([unpaid.status, unpaid.body.error.code], [409, "ORDER_STATE_INVALID"]);
  await payFor(placed.order.id);
  api.clock.advance(SCHEDULED.getTime() - 4 * HOUR - api.clock.now().getTime());
  const early = await guest(token, "POST", "/site/v1/order/landed");
  assertMatchesOpenApi("POST", "/site/v1/order/landed", early);
  assert.deepEqual([early.status, early.body.error.code], [409, "LANDING_TOO_EARLY"]);
  api.clock.advance(4 * HOUR + 20 * 60_000);
  const landed = await guest(token, "POST", "/site/v1/order/landed");
  assertMatchesOpenApi("POST", "/site/v1/order/landed", landed);
  assert.equal(landed.status, 200, landed.text);
  assert.deepEqual([landed.body.order.landing.source, landed.body.order.landing.guest_reported_at, landed.body.order.landing.delay_minutes], ["guest", api.clock.now().toISOString(), 20]);
  assert.equal("driver_photo_file_id" in landed.body.order.landing, false, "司机到达屏照片的文件编号不给客人");
  const again = await guest(token, "POST", "/site/v1/order/landed");
  assert.deepEqual([again.status, again.body.error.code], [409, "LANDING_ALREADY_REPORTED"]);
});
