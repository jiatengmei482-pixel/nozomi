/**
 * M3-02 验收标准「落地时间取证规则」（第五轮决策 ③，ADR 0027），经真实接口、真实 PostgreSQL，从渠道下单付款开始：
 * - 客人「我已落地」（`POST /sales/v1/orders/{id}/landed`）优先于司机填写；两边都有且不一致取较晚者；都没有取计划到达时间；
 * - 司机填写必须附到达屏；各自提交后不能改；结果写入订单，供应商后台、司机页面、渠道看到的是同一个结果；免费等待从它起算；
 * - 只认本渠道的单；不是接机的不记；离计划到达还早的不能点；
 * - 渠道看到的司机信息：派车后有姓名、车牌；电话在用车前 24 小时起才给。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";
import { type Market, buildMarket, ok } from "./testing/market.ts";
import { assign, newDriver, newVehicle } from "./testing/dispatch.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";

let api: TestApi;
let m: Market;
let sales: SalesFlow;
let other: SalesFlow;
/** 每个测试一张付过款、派了车的单：都在拨时钟之前下好（离用车不足 24 小时就报不出价了） */
const orders: { orderId: string; driverToken: string }[] = [];

before(async () => {
  const pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  sales = await salesFlow(api, m, pay);
  other = await salesFlow(api, m, pay);
  for (let i = 0; i < 5; i += 1) orders.push(await paidAndDispatched());
});
after(() => api.close());

const MINUTE = 60_000;
/** 计划落地 = 用车时间：2026-10-20 10:00 东京 = 01:00Z */
const SCHEDULED = new Date("2026-10-20T01:00:00Z");
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 3)]);

async function tenant(): Promise<{ adminToken: string; tenantId: string }> {
  return { ...m.b, adminToken: (await ok(api.call("POST", "/tenant/v1/auth/login", { body: { email: m.b.adminEmail, password: TEST_PASSWORD } }))).access_token };
}

/** 付过款并派了车的接机单（乙中标），返回订单编号和司机令牌。 */
async function paidAndDispatched(): Promise<{ orderId: string; driverToken: string }> {
  const order = await sales.paidOrder();
  const who = await tenant();
  const res = await ok(assign(api, who as never, order.id, (await newDriver(api, who as never)).id, (await newVehicle(api, who as never, m.ids.biz7)).id));
  return { orderId: order.id, driverToken: res.driver_link.token };
}

async function driverLanding(driverToken: string, landedAt: Date): Promise<any> {
  const file = await api.app.inject({ method: "POST", url: "/driver/v1/trip/files?kind=arrival_screen", headers: { authorization: `Bearer ${driverToken}`, "content-type": "image/jpeg" }, payload: JPEG });
  assert.equal(file.statusCode, 201, file.body);
  return ok(api.call("POST", "/driver/v1/trip/landing", { token: driverToken, body: { landed_at: landedAt.toISOString(), file_id: file.json().file.id } }));
}

const guestLanded = async (orderId: string, who: SalesFlow = sales) => api.call("POST", `/sales/v1/orders/${orderId}/landed`, { token: await who.token() });

function moveTo(at: Date): void {
  api.clock.advance(at.getTime() - api.clock.now().getTime());
}

test("规则 4 + 渠道视图：都没有记录时取计划到达时间；派车后渠道看得到司机姓名和车牌，电话在用车前 24 小时起才给", async () => {
  const { orderId } = orders[0]!;
  const view = await api.call("GET", `/sales/v1/orders/${orderId}`, { token: await sales.token() });
  assertMatchesOpenApi("GET", "/sales/v1/orders/{id}", view);
  assert.deepEqual([view.body.order.landing.source, view.body.order.landing.landed_at], ["scheduled", SCHEDULED.toISOString()]);
  assert.ok(view.body.order.driver.name);
  assert.equal(view.body.order.driver.phone, null, "离用车还远，不给电话");
  assert.match(view.body.order.vehicle.plate, /品川/);
  assert.doesNotMatch(view.text, /settlement|"19800"/, "渠道看不到结算价");
  moveTo(new Date(SCHEDULED.getTime() - 24 * 60 * MINUTE));
  const close = await ok(api.call("GET", `/sales/v1/orders/${orderId}`, { token: await sales.token() }));
  assert.match(close.order.driver.phone, /^\+81/);
});

test("只认本渠道的单（别的渠道 404）；离计划到达还早 3 小时以上不能点；送机不需要", async () => {
  const { orderId } = orders[4]!;
  moveTo(new Date(SCHEDULED.getTime() - 4 * 60 * MINUTE));
  const foreign = await guestLanded(orderId, other);
  assert.equal(foreign.status, 404);
  const tooEarly = await guestLanded(orderId);
  assert.deepEqual([tooEarly.status, tooEarly.body.error.code], [409, "LANDING_TOO_EARLY"]);
  await api.db.owner.query("update orders set direction = 'dropoff', flight_no = null where id = $1", [orderId]);
  const dropoff = await guestLanded(orderId);
  assert.deepEqual([dropoff.status, dropoff.body.error.code], [409, "LANDING_NOT_APPLICABLE"]);
});

test("规则 3：只有客人确认 → 取客人的时间（系统收到的时间）；提交后不能改；免费等待从它起算", async () => {
  const { orderId, driverToken } = orders[1]!;
  moveTo(new Date(SCHEDULED.getTime() + 25 * MINUTE));
  const res = await guestLanded(orderId);
  assertMatchesOpenApi("POST", "/sales/v1/orders/{id}/landed", res);
  assert.equal(res.status, 200, res.text);
  assert.deepEqual([res.body.order.landing.source, res.body.order.landing.landed_at, res.body.order.landing.delay_minutes], ["guest", api.clock.now().toISOString(), 25]);
  const again = await guestLanded(orderId);
  assert.deepEqual([again.status, again.body.error.code], [409, "LANDING_ALREADY_REPORTED"]);
  const trip = await ok(api.call("GET", "/driver/v1/trip", { token: driverToken }));
  assert.equal(trip.free_wait.start, res.body.order.landing.landed_at);
  assert.equal(trip.free_wait.end, new Date(new Date(res.body.order.landing.landed_at).getTime() + 90 * MINUTE).toISOString(), "国际线免等 90 分钟");
});

test("规则 1 + 2：客人和司机都有、不一致时取较晚者（司机晚就取司机的；客人晚就取客人的）；司机提交后不能改", async () => {
  const late = orders[2]!;
  moveTo(new Date(SCHEDULED.getTime() + 10 * MINUTE));
  await ok(guestLanded(late.orderId));
  moveTo(new Date(SCHEDULED.getTime() + 40 * MINUTE));
  const driverLater = await driverLanding(late.driverToken, new Date(SCHEDULED.getTime() + 30 * MINUTE));
  assert.deepEqual([driverLater.landing.source, driverLater.landing.landed_at, driverLater.landing.disagreement], ["driver", new Date(SCHEDULED.getTime() + 30 * MINUTE).toISOString(), true]);
  const tenantView = await ok(api.call("GET", `/tenant/v1/orders/${late.orderId}`, { token: (await tenant()).adminToken }));
  assert.deepEqual([tenantView.order.landing.source, tenantView.order.landing.guest_reported_at], ["driver", new Date(SCHEDULED.getTime() + 10 * MINUTE).toISOString()]);
  const stored = await api.db.owner.query<{ landed_source: string; landed_at: Date }>("select landed_source, landed_at from orders where id = $1", [late.orderId]);
  assert.deepEqual([stored.rows[0]?.landed_source, stored.rows[0]?.landed_at.toISOString()], ["driver", new Date(SCHEDULED.getTime() + 30 * MINUTE).toISOString()], "结果写入了订单");

  const early = orders[3]!;
  await driverLanding(early.driverToken, new Date(SCHEDULED.getTime() + 5 * MINUTE));
  moveTo(new Date(SCHEDULED.getTime() + 50 * MINUTE));
  const guestLater = await ok(guestLanded(early.orderId));
  assert.deepEqual([guestLater.order.landing.source, guestLater.order.landing.landed_at], ["guest", api.clock.now().toISOString()], "客人晚于司机，取客人的");
});
