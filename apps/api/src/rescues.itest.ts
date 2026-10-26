/**
 * M3-04：救援改派与违约金（ADR 0031），经真实接口、真实 PostgreSQL；收款服务用替身，推送用本机的假接收方。
 * - 4 种触发情形：供应商声明（违约金阶梯 0 / 30% / 100%，边界按毫秒）、用车前 6 小时仍未派车（定时任务自动触发）、司机未到（到点 15 分钟、客人报告、运营判定）、供应商被暂停（运营批量发起）；
 * - 并发触发只建一条救援；进入救援后原供应商不能再操作（派车、司机链接）；
 * - 候选按原报价条件重新比价、排除原供应商；救援单推送给候选（复用 M3-02 的推送）；接单后订单转给救援供应商、客人付的钱不变、原供应商那一行变成「已转给救援供应商」；
 * - 拒绝 / 超时自动顺延、候选都不接 → 人工指定（双人复核）；违约金和救援差价记成应扣款项；不可抗力免除；救援中取消全额退款；
 * - 规则 2：别的供应商的单、救援单、应扣款项读不到改不了；规则 4：供应商看到的救援单、应扣款项里没有对外价和加价比例。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withTenantTx } from "./db/context.ts";
import { type TenantFixture, type TestApi, createTestApi } from "./testing/api.ts";
import { deniedByDatabase } from "./testing/db.ts";
import { type FakeReceiver, assign, newDriver, newVehicle, startFakeReceiver } from "./testing/dispatch.ts";
import { type Market, type Staff, addStaff, allKeys, buildMarket, ok, publishAirportProduct } from "./testing/market.ts";
import { platformLogin, tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";

const HOUR = 3_600_000;
const MINUTE = 60_000;

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let flow: SalesFlow;
let c: TenantFixture;
let support: Staff;
let receiverA: FakeReceiver;
let receiverB: FakeReceiver;

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  // 丙：商务 7 座 21,000，提前 1 小时就能订（离用车很近的救援也报得出价）
  c = await api.tenantWithAdmin(m.root, "丙车队", "admin@market-c.test");
  await publishAirportProduct(api, c, m.ids, [[m.ids.biz7, 21_000]], { leadTimeHours: 1 });
  flow = await salesFlow(api, m, pay);
  support = await addStaff(api, m.root, "cs@platform.test", "customer_service");
  receiverA = await startFakeReceiver();
  receiverB = await startFakeReceiver();
  await ok(api.call("PUT", "/tenant/v1/webhooks", { token: m.a.adminToken, body: { url: receiverA.url, events: ["rescue.offered", "order.confirmed", "order.rescued_away"] } }), 201);
  await ok(api.call("PUT", "/tenant/v1/webhooks", { token: m.b.adminToken, body: { url: receiverB.url, events: ["order.rescued_away", "order.status_changed"] } }), 201);
});
after(async () => {
  await receiverA.close();
  await receiverB.close();
  await api.close();
});

// 令牌 2 小时过期：时钟拨远之后每次现登录
const ops = (): Promise<string> => platformLogin(api, m.staff.operations.email);
const tenantToken = (who: TenantFixture): Promise<string> => tenantLogin(api, who.adminEmail);
/** 带着现登录的令牌的供应商（建司机、车辆的辅助函数用 `adminToken`）。 */
const fresh = async (who: TenantFixture): Promise<TenantFixture> => ({ ...who, adminToken: await tenantToken(who) });

/** 用一个新的用车时间（离现在 `hours` 小时）下单付款：乙 19,800 中标。 */
async function paidOrderIn(hours: number): Promise<{ id: string; serviceAt: number }> {
  const serviceAt = api.clock.now().getTime() + hours * HOUR;
  const order = await flow.paidOrder({ serviceTime: new Date(serviceAt).toISOString().replace(/\.\d{3}Z$/, "Z") });
  return { id: order.id, serviceAt: Math.floor(serviceAt / MINUTE) * MINUTE };
}

/** 把时钟拨到「离用车还有 `msBefore` 毫秒」（只能往后拨）。 */
function moveTo(serviceAt: number, msBefore: number): void {
  const delta = serviceAt - msBefore - api.clock.now().getTime();
  assert.ok(delta >= 0, "时钟只能往后拨");
  api.clock.advance(delta);
}

async function declare(who: TenantFixture, orderId: string, reason = "车辆故障，排不出车"): Promise<any> {
  const res = await api.call("POST", `/tenant/v1/orders/${orderId}/declare-unable`, { token: await tenantToken(who), body: { reason } });
  assertMatchesOpenApi("POST", "/tenant/v1/orders/{id}/declare-unable", res);
  return res;
}

async function platformDetail(orderId: string): Promise<any> {
  const res = await api.call("GET", `/platform/v1/orders/${orderId}`, { token: await ops() });
  assertMatchesOpenApi("GET", "/platform/v1/orders/{id}", res);
  assert.equal(res.status, 200, res.text);
  return res.body;
}

async function tenantDetail(who: TenantFixture, orderId: string): Promise<any> {
  const res = await api.call("GET", `/tenant/v1/orders/${orderId}`, { token: await tenantToken(who) });
  assertMatchesOpenApi("GET", "/tenant/v1/orders/{id}", res);
  assert.equal(res.status, 200, res.text);
  return res.body;
}

async function candidates(orderId: string): Promise<any> {
  const res = await api.call("GET", `/platform/v1/orders/${orderId}/rescue/candidates`, { token: await ops() });
  assertMatchesOpenApi("GET", "/platform/v1/orders/{id}/rescue/candidates", res);
  assert.equal(res.status, 200, res.text);
  return res.body;
}

async function offer(orderId: string, tenantId: string | null = null): Promise<any> {
  const res = await api.call("POST", `/platform/v1/orders/${orderId}/rescue/offers`, { token: await ops(), body: { tenant_id: tenantId } });
  assertMatchesOpenApi("POST", "/platform/v1/orders/{id}/rescue/offers", res);
  return res;
}

async function pendingOffers(who: TenantFixture): Promise<any[]> {
  const res = await api.call("GET", "/tenant/v1/rescue-offers?status=pending", { token: await tenantToken(who) });
  assertMatchesOpenApi("GET", "/tenant/v1/rescue-offers", res);
  return res.body.items;
}

async function decide(who: TenantFixture, offerId: string, decision: "accept" | "decline", body: unknown = {}): Promise<any> {
  const res = await api.call("POST", `/tenant/v1/rescue-offers/${offerId}/${decision}`, { token: await tenantToken(who), body });
  assertMatchesOpenApi("POST", `/tenant/v1/rescue-offers/{id}/${decision}`, res);
  return res;
}

async function rescueCount(orderId: string): Promise<number> {
  return (await api.db.owner.query<{ n: number }>("select count(*)::int as n from order_rescues where order_id = $1", [orderId])).rows[0]?.n ?? 0;
}

const FORBIDDEN_KEYS = ["sell", "markup_bp", "fx", "fx_buffer_bp", "channel", "rescue_tenant", "original_tenant", "candidates"];

function assertNoPlatformFields(value: unknown, where: string): void {
  const keys = allKeys(value);
  for (const key of FORBIDDEN_KEYS) assert.ok(!keys.has(key), `${where} 里不该有 ${key}`);
}

test("供应商用车前 ≥ 24 小时声明无法履约：违约金 0；原供应商不能再操作；候选按原报价条件比出来、排除原供应商；救援单推给候选，接单后订单转给它、客人付的钱不变，原供应商那一行变成「已转给救援供应商」，差价记成应扣款项", async () => {
  const order = await paidOrderIn(10 * 24);
  const before = await platformDetail(order.id);
  assert.equal(before.order.tenant.id, m.b.tenantId);
  const sellBefore = before.order.sell;
  // 乙先派了车：进入救援后司机链接作废、不能再派
  const driver = await newDriver(api, await fresh(m.b));
  const vehicle = await newVehicle(api, await fresh(m.b), m.ids.biz7);
  const assigned = await ok(assign(api, { token: await tenantToken(m.b) }, order.id, driver.id, vehicle.id));
  const linkToken = assigned.driver_link.token as string;
  assert.equal((await api.call("GET", "/driver/v1/trip", { token: linkToken })).status, 200);

  assert.equal((await api.call("POST", `/tenant/v1/orders/${order.id}/declare-unable`, { token: await tenantToken(m.b), body: { reason: "  " } })).status, 400, "原因必填");
  const declared = await declare(m.b, order.id);
  assert.equal(declared.status, 200, declared.text);
  assert.equal(declared.body.rescue.role, "original");
  assert.equal(declared.body.rescue.trigger, "tenant_declared");
  assert.equal(declared.body.rescue.penalty_bp, 0);
  assert.equal(declared.body.rescue.penalty_tier, "none");
  assert.deepEqual(declared.body.rescue.deductions.map((d: any) => [d.kind, d.amount.amount, d.status]), [["penalty", "0", "pending"]]);
  assert.equal((await declare(m.b, order.id)).body.error.code, "RESCUE_ALREADY_OPEN");

  const mine = await tenantDetail(m.b, order.id);
  assert.equal(mine.order.status, "rescue_pending");
  assert.equal((await api.call("GET", "/driver/v1/trip", { token: linkToken })).status, 401, "司机链接已作废");
  const reassign = await assign(api, { token: await tenantToken(m.b) }, order.id, driver.id, vehicle.id);
  assert.equal(reassign.status, 409);
  assert.equal(reassign.body.error.code, "ORDER_STATE_INVALID");

  // 救援队列
  const queue = await api.call("GET", "/platform/v1/rescues", { token: await ops() });
  assertMatchesOpenApi("GET", "/platform/v1/rescues", queue);
  const queued = queue.body.items.find((item: any) => item.order.id === order.id);
  assert.equal(queued.status, "open");
  assert.equal(queued.original_tenant.id, m.b.tenantId);

  // 候选：甲 20,000（差价 200）、丙 21,000（差价 1,200），乙不在里面
  const found = await candidates(order.id);
  assert.deepEqual(found.candidates.map((entry: any) => [entry.tenant.id, entry.settlement.amount, entry.difference.amount, entry.position]), [
    [m.a.tenantId, "20000", "200", 1],
    [c.tenantId, "21000", "1200", 2],
  ]);
  assert.ok(!found.candidates.some((entry: any) => entry.tenant.id === m.b.tenantId));

  const offered = await offer(order.id);
  assert.equal(offered.status, 201, offered.text);
  assert.equal(offered.body.offer.tenant.id, m.a.tenantId, "不指定就发第一名");
  assert.equal(offered.body.offer.status, "pending");
  assert.equal(new Date(offered.body.offer.expires_at).getTime() - api.clock.now().getTime(), 15 * MINUTE);
  assert.equal((await offer(order.id, c.tenantId)).body.error.code, "RESCUE_OFFER_PENDING", "同一时刻只有一张待接的");

  // 甲收到推送 rescue.offered（没有乘客信息）
  await api.app.webhookJobs.tick();
  const pushed = receiverA.received.map((entry) => JSON.parse(entry.body)).find((body) => body.type === "rescue.offered" && body.data.offer_id === offered.body.offer.id);
  assert.ok(pushed, "甲没收到救援单的推送");
  assert.ok(!JSON.stringify(pushed).includes("王小明"));
  assert.ok(!JSON.stringify(pushed).includes("+8190"));

  const offers = await pendingOffers(m.a);
  assert.equal(offers.length, 1);
  assert.equal(offers[0].order_id, null, "接单前不给订单编号");
  assert.equal(offers[0].settlement.total.amount, "20000");
  assertNoPlatformFields(offers, "供应商的救援单");
  assert.ok(!JSON.stringify(offers).includes("王小明"), "接单前看不到乘客");

  const accepted = await decide(m.a, offers[0].id, "accept");
  assert.equal(accepted.status, 200, accepted.text);
  assert.equal(accepted.body.order_id, order.id);
  assert.equal(accepted.body.offer.status, "accepted");

  const after = await platformDetail(order.id);
  assert.equal(after.order.tenant.id, m.a.tenantId, "订单转给了甲");
  assert.equal(after.order.status, "confirmed");
  assert.deepEqual(after.order.sell, sellBefore, "客人付的钱不变");
  assert.equal(after.order.settlement.total.amount, "20000");
  assert.equal(after.order.order_no, before.order.order_no, "订单号不变");
  const record = after.rescues[0];
  assert.equal(record.status, "rescued");
  assert.equal(record.rescue_tenant.id, m.a.tenantId);
  assert.equal(record.rescued_via, "offer");
  assert.deepEqual(record.deductions.map((d: any) => [d.tenant_id, d.kind, d.amount.amount]), [
    [m.b.tenantId, "penalty", "0"],
    [m.b.tenantId, "rescue_difference", "200"],
  ]);

  // 原供应商：那一行变成「已转给救援供应商」，看得到违约金和差价，看不到救援供应商是谁
  const original = await tenantDetail(m.b, order.id);
  assert.equal(original.order.status, "rescued");
  assert.equal(original.rescue.role, "original");
  assert.deepEqual(original.rescue.deductions.map((d: any) => [d.kind, d.amount.amount]), [["penalty", "0"], ["rescue_difference", "200"]]);
  assertNoPlatformFields(original.rescue, "原供应商的救援记录");
  assert.ok(!JSON.stringify(original).includes(m.a.tenantId), "原供应商看不到救援供应商是谁");
  const reassignAfter = await assign(api, { token: await tenantToken(m.b) }, order.id, driver.id, vehicle.id);
  assert.equal(reassignAfter.status, 409, "原供应商不能再操作这一单");

  // 救援供应商：从「已确认」开始，看得到乘客，能派车
  const rescuer = await tenantDetail(m.a, order.id);
  assert.equal(rescuer.order.status, "confirmed");
  assert.equal(rescuer.order.passenger.name, "王小明");
  assert.equal(rescuer.rescue.role, "rescuer");
  assert.equal(rescuer.rescue.trigger, null, "救援供应商不知道原因");
  const driverA = await newDriver(api, await fresh(m.a));
  const vehicleA = await newVehicle(api, await fresh(m.a), m.ids.biz7);
  await ok(assign(api, { token: await tenantToken(m.a) }, order.id, driverA.id, vehicleA.id));

  // 推送：乙收到 order.rescued_away，甲收到 order.confirmed（rescue: true）
  await api.app.webhookJobs.tick();
  const toB = receiverB.received.map((entry) => JSON.parse(entry.body)).find((body) => body.type === "order.rescued_away" && body.data.order?.id === order.id);
  assert.ok(toB, "乙没收到「已转给救援供应商」");
  assert.equal(toB.data.order.status, "rescued");
  const toA = receiverA.received.map((entry) => JSON.parse(entry.body)).find((body) => body.type === "order.confirmed" && body.data.order?.id === order.id);
  assert.ok(toA, "甲没收到新订单");
  assert.equal(toA.data.rescue, true);

  // 应扣款项：乙两条，甲没有
  const deductionsB = await api.call("GET", `/tenant/v1/deductions?order_id=${order.id}`, { token: await tenantToken(m.b) });
  assertMatchesOpenApi("GET", "/tenant/v1/deductions", deductionsB);
  assert.equal(deductionsB.body.items.length, 2);
  assertNoPlatformFields(deductionsB.body, "供应商的应扣款项");
  assert.deepEqual((await ok(api.call("GET", "/tenant/v1/deductions", { token: await tenantToken(m.a) }))).items, []);

  // 渠道：价格不变，看到的是现在的订单
  const sales = await ok(api.call("GET", `/sales/v1/orders/${order.id}`, { token: await flow.token() }));
  assert.equal(sales.order.status, "assigned");
  assert.deepEqual(sales.order.price.total, sellBefore);

  // 审计：触发（供应商）、发救援单（运营）、接单（供应商）
  const audits = (await api.db.owner.query<{ action: string; actor_type: string }>("select action, actor_type from audit_logs where resource = 'rescue' and resource_id = $1 order by occurred_at, id", [record.id])).rows;
  assert.deepEqual(audits.map((row) => `${row.actor_type}:${row.action}`), ["tenant_user:trigger", "platform_user:offer", "tenant_user:accept"]);
});

test("违约金阶梯（声明）边界按毫秒：正好 24 小时 0；24 小时少 1 毫秒 30%（19,800 × 30% = 5,940）；2 小时少 1 毫秒 100%", async () => {
  const exact = await paidOrderIn(30);
  const partial = await paidOrderIn(31);
  const full = await paidOrderIn(40);
  moveTo(exact.serviceAt, 24 * HOUR);
  assert.equal((await declare(m.b, exact.id)).body.rescue.penalty_bp, 0);
  moveTo(partial.serviceAt, 24 * HOUR - 1);
  const thirty = (await declare(m.b, partial.id)).body.rescue;
  assert.equal(thirty.penalty_bp, 3000);
  assert.equal(thirty.deductions[0].amount.amount, "5940");
  moveTo(full.serviceAt, 2 * HOUR - 1);
  const hundred = (await declare(m.b, full.id)).body.rescue;
  assert.equal(hundred.penalty_tier, "full");
  assert.equal(hundred.deductions[0].amount.amount, "19800");
});

test("用车前 6 小时仍未派车：定时任务自动触发（违约金 100%、系统触发、写审计）；早 1 毫秒不触发；再跑一次不会建第二条", async () => {
  const order = await paidOrderIn(30);
  moveTo(order.serviceAt, 6 * HOUR + 1);
  await api.app.orderJobs.rescue();
  assert.equal(await rescueCount(order.id), 0, "早 1 毫秒不触发");
  api.clock.advance(1);
  const swept = await api.app.orderJobs.rescue();
  assert.ok(swept.dispatchOverdue >= 1);
  const detail = await platformDetail(order.id);
  assert.equal(detail.order.status, "rescue_pending");
  assert.equal(detail.rescues[0].trigger, "dispatch_overdue");
  assert.equal(detail.rescues[0].triggered_by_type, "system");
  assert.equal(detail.rescues[0].penalty.amount, "19800");
  await api.app.orderJobs.rescue();
  assert.equal(await rescueCount(order.id), 1);
  const audit = (await api.db.owner.query<{ actor_type: string; source: string }>("select actor_type, source from audit_logs where resource = 'rescue' and resource_id = $1", [detail.rescues[0].id])).rows;
  assert.deepEqual(audit, [{ actor_type: "system", source: "job" }]);
  assert.match(api.logs(), /order\.rescue_triggered/);
});

test("司机未到：到点 15 分钟（含那一刻）起才成立；定时任务记提醒、客人可以报告，进救援队列；运营判定后触发，违约金 100%", async () => {
  const order = await paidOrderIn(30);
  const driver = await newDriver(api, await fresh(m.b));
  const vehicle = await newVehicle(api, await fresh(m.b), m.ids.biz7);
  await ok(assign(api, { token: await tenantToken(m.b) }, order.id, driver.id, vehicle.id));
  moveTo(order.serviceAt, 0);
  const salesToken = await flow.token();
  const report = await api.call("POST", `/sales/v1/orders/${order.id}/driver-missing`, { token: salesToken });
  assertMatchesOpenApi("POST", "/sales/v1/orders/{id}/driver-missing", report);
  assert.equal(report.body.first_report, true);
  assert.equal((await ok(api.call("POST", `/sales/v1/orders/${order.id}/driver-missing`, { token: salesToken }))).first_report, false, "重复报告只记第一次");

  moveTo(order.serviceAt, -15 * MINUTE + 1);
  const early = await api.call("POST", `/platform/v1/orders/${order.id}/rescue`, { token: await ops(), body: { trigger: "driver_no_show", note: "联系不上司机" } });
  assertMatchesOpenApi("POST", "/platform/v1/orders/{id}/rescue", early);
  assert.equal(early.status, 409);
  assert.equal(early.body.error.code, "RESCUE_TRIGGER_NOT_MET");
  await api.app.orderJobs.rescue();
  assert.equal((await api.db.owner.query("select arrival_overdue_at from orders where id = $1 and status = 'assigned'", [order.id])).rows[0].arrival_overdue_at, null);
  api.clock.advance(1);
  assert.ok((await api.app.orderJobs.rescue()).driverLate >= 1);
  const alerts = (await ok(api.call("GET", "/platform/v1/rescues", { token: await ops() }))).alerts;
  const alert = alerts.find((entry: any) => entry.order_id === order.id);
  assert.ok(alert.arrival_overdue_at !== null && alert.driver_missing_reported_at !== null);

  assert.equal((await api.call("POST", `/platform/v1/orders/${order.id}/rescue`, { token: await platformLogin(api, m.staff.readonly.email), body: { trigger: "driver_no_show", note: "x" } })).status, 403, "只读不能发起");
  const triggered = await api.call("POST", `/platform/v1/orders/${order.id}/rescue`, { token: await ops(), body: { trigger: "driver_no_show", note: "到点 15 分钟没到，电话联系不上" } });
  assertMatchesOpenApi("POST", "/platform/v1/orders/{id}/rescue", triggered);
  assert.equal(triggered.status, 201, triggered.text);
  assert.equal(triggered.body.rescue.penalty_bp, 10000);
  assert.equal(triggered.body.rescue.triggered_by_type, "platform_user");
  assert.ok(!(await ok(api.call("GET", "/platform/v1/rescues", { token: await ops() }))).alerts.some((entry: any) => entry.order_id === order.id), "进入救援后不再是提醒");
});

test("并发触发只建一条救援：供应商声明、运营代登记、定时任务同时到", async () => {
  const order = await paidOrderIn(30);
  moveTo(order.serviceAt, 6 * HOUR);
  const results = await Promise.all([
    api.call("POST", `/tenant/v1/orders/${order.id}/declare-unable`, { token: await tenantToken(m.b), body: { reason: "司机病了" } }),
    api.call("POST", `/platform/v1/orders/${order.id}/rescue`, { token: await ops(), body: { trigger: "tenant_declared", note: "供应商来电" } }),
    api.app.orderJobs.rescue(),
  ]);
  const statuses = results.slice(0, 2).map((res: any) => res.status);
  assert.ok(statuses.filter((status) => status === 409).length >= 1, JSON.stringify(statuses));
  assert.equal(await rescueCount(order.id), 1);
  assert.equal((await api.db.owner.query<{ n: number }>("select count(*)::int as n from tenant_deductions where order_id = $1 and kind = 'penalty'", [order.id])).rows[0]?.n, 1);
});

test("拒绝自动顺延下一家、超时自动顺延、候选都不接进入「候选都不接」；人工指定走双人复核（发起人不能自己批、客服不能批），批准后改派，差价按谈好的结算价", async () => {
  const order = await paidOrderIn(5 * 24);
  await declare(m.b, order.id);
  assert.equal((await offer(order.id, randomUUID())).body.error.code, "RESCUE_CANDIDATE_UNAVAILABLE", "不是候选的不能发");
  const toA = await offer(order.id, m.a.tenantId);
  assert.equal(toA.status, 201);
  const declined = await decide(m.a, toA.body.offer.id, "decline", { reason: "那天车都排满了" });
  assert.equal(declined.status, 200, declined.text);
  assert.equal(declined.body.offer.status, "declined");
  // 自动发给丙（系统）
  const toC = await pendingOffers(c);
  assert.equal(toC.length, 1);
  let detail = await platformDetail(order.id);
  assert.deepEqual(detail.rescues[0].offers.map((entry: any) => [entry.tenant.id, entry.status, entry.offered_by_type]), [
    [m.a.tenantId, "declined", "platform_user"],
    [c.tenantId, "pending", "system"],
  ]);
  assert.equal(detail.rescues[0].offers[1].sell.currency, "JPY", "运营看得到对外价");
  // 丙 15 分钟不接：超时，候选没了 → 候选都不接
  api.clock.advance(15 * MINUTE);
  const late = await decide(c, toC[0].id, "accept");
  assert.equal(late.status, 409);
  assert.equal(late.body.error.code, "RESCUE_OFFER_EXPIRED");
  detail = await platformDetail(order.id);
  assert.equal(detail.rescues[0].status, "exhausted");
  assert.deepEqual(detail.rescues[0].offers.map((entry: any) => entry.status), ["declined", "expired"]);
  assert.match(api.logs(), /order\.rescue_exhausted/);
  assert.deepEqual((await candidates(order.id)).candidates, []);

  // 人工指定：甲电话里答应 25,000
  const manual = { tenant_id: m.a.tenantId, product_id: m.ids.pa, settlement_amount: 25_000, note: "电话联系甲，同意 25,000 接" };
  const previous = await api.call("POST", `/platform/v1/orders/${order.id}/rescue/manual-assign`, { token: await ops(), body: { ...manual, tenant_id: m.b.tenantId, product_id: m.ids.pb } });
  assert.equal(previous.body.error.details.issues[0].reason, "PREVIOUS_SUPPLIER");
  const mismatch = await api.call("POST", `/platform/v1/orders/${order.id}/rescue/manual-assign`, { token: await ops(), body: { ...manual, product_id: m.ids.pb } });
  assert.equal(mismatch.status, 400);
  const requested = await api.call("POST", `/platform/v1/orders/${order.id}/rescue/manual-assign`, { token: await ops(), body: manual });
  assertMatchesOpenApi("POST", "/platform/v1/orders/{id}/rescue/manual-assign", requested);
  assert.equal(requested.status, 202, requested.text);
  assert.equal(requested.body.approval.kind, "rescue.manual_assign");
  assert.equal((await platformDetail(order.id)).order.status, "rescue_pending", "批准之前不生效");
  const self = await api.call("POST", `/platform/v1/approvals/${requested.body.approval.id}/approve`, { token: await ops(), body: {} });
  assert.equal(self.body.error.code, "APPROVAL_SELF_REVIEW");
  assert.equal((await api.call("POST", `/platform/v1/approvals/${requested.body.approval.id}/approve`, { token: await platformLogin(api, support.email), body: {} })).status, 403, "客服不能审核");
  await ok(api.call("POST", `/platform/v1/approvals/${requested.body.approval.id}/approve`, { token: await platformLogin(api, "root@platform.test"), body: {} }));
  detail = await platformDetail(order.id);
  assert.equal(detail.order.tenant.id, m.a.tenantId);
  assert.equal(detail.order.settlement.total.amount, "25000");
  assert.equal(detail.rescues[0].rescued_via, "manual");
  assert.equal(detail.rescues[0].deductions.find((d: any) => d.kind === "rescue_difference").amount.amount, "5200");
});

test("不可抗力：运营认定后违约金免除，之后记的差价也直接免除；同一次只能认定一次；供应商看到「已免除」和说明", async () => {
  const order = await paidOrderIn(30);
  moveTo(order.serviceAt, 10 * HOUR);
  const declared = (await declare(m.b, order.id)).body.rescue;
  assert.equal(declared.penalty_bp, 3000);
  const res = await api.call("POST", `/platform/v1/orders/${order.id}/rescue/force-majeure`, { token: await ops(), body: { note: "大雪封路，高速关闭" } });
  assertMatchesOpenApi("POST", "/platform/v1/orders/{id}/rescue/force-majeure", res);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.waived, 1);
  assert.equal(res.body.rescue.force_majeure.note, "大雪封路，高速关闭");
  assert.equal((await api.call("POST", `/platform/v1/orders/${order.id}/rescue/force-majeure`, { token: await ops(), body: { note: "再来一次" } })).body.error.code, "FORCE_MAJEURE_ALREADY");
  const toC = await offer(order.id, c.tenantId);
  assert.equal(toC.status, 201, toC.text);
  assert.equal((await decide(c, toC.body.offer.id, "accept")).status, 200);
  const original = await tenantDetail(m.b, order.id);
  assert.equal(original.rescue.force_majeure, true);
  assert.deepEqual(original.rescue.deductions.map((d: any) => [d.kind, d.amount.amount, d.status, d.waive_reason]), [
    ["penalty", "5940", "waived", "大雪封路，高速关闭"],
    ["rescue_difference", "1200", "waived", "大雪封路，高速关闭"],
  ]);
  const noRescue = await paidOrderIn(30);
  assert.equal((await api.call("POST", `/platform/v1/orders/${noRescue.id}/rescue/force-majeure`, { token: await ops(), body: { note: "x" } })).body.error.code, "RESCUE_NOT_FOUND");
});

test("救援中无人可接、按「供应商原因」取消：全额退款不用复核，救援记为已取消、待接的救援单收回，原供应商分不到钱、违约金照记", async () => {
  const order = await paidOrderIn(30);
  moveTo(order.serviceAt, 3 * HOUR);
  await declare(m.b, order.id);
  const toC = await offer(order.id, c.tenantId);
  assert.equal(toC.status, 201, toC.text);
  const cancelled = await api.call("POST", `/platform/v1/orders/${order.id}/cancel`, { token: await ops(), body: { reason: "SUPPLIER_FAULT", note: "救援无人可接" } });
  assert.equal(cancelled.status, 200, cancelled.text);
  const detail = await platformDetail(order.id);
  assert.equal(detail.order.status, "cancelled");
  assert.equal(detail.order.cancellation.tenant_share.amount, "0");
  assert.equal(detail.refunds.reduce((sum: number, refund: any) => sum + Number(refund.amount.amount), 0), Number(detail.order.sell.amount), "全额退款");
  assert.equal(detail.rescues[0].status, "cancelled");
  assert.equal(detail.rescues[0].offers[0].status, "withdrawn");
  assert.equal(detail.rescues[0].deductions[0].amount.amount, "5940", "用车前 3 小时声明（30%）：取消了违约金照记");
  assert.equal((await decide(c, toC.body.offer.id, "accept")).body.error.code, "RESCUE_OFFER_CLOSED");
});

test("规则 2：别的供应商的单不能声明、别的供应商的救援单看不到接不了、应扣款项只看得到自己的；租户角色在数据库里读不到救援表", async () => {
  const order = await paidOrderIn(4 * 24);
  const foreign = await api.call("POST", `/tenant/v1/orders/${order.id}/declare-unable`, { token: await tenantToken(m.a), body: { reason: "冒充" } });
  assert.equal(foreign.status, 404);
  assert.equal(await rescueCount(order.id), 0);
  await declare(m.b, order.id);
  const toC = await offer(order.id, c.tenantId);
  const offerId = toC.body.offer.id as string;
  assert.equal((await api.call("GET", `/tenant/v1/rescue-offers/${offerId}`, { token: await tenantToken(m.a) })).status, 404);
  assert.equal((await api.call("POST", `/tenant/v1/rescue-offers/${offerId}/accept`, { token: await tenantToken(m.a) })).status, 404);
  assert.equal((await api.call("POST", `/tenant/v1/rescue-offers/${offerId}/decline`, { token: await tenantToken(m.b), body: {} })).status, 404, "原供应商也碰不到发给别人的救援单");
  const seen = await api.call("GET", `/tenant/v1/rescue-offers/${offerId}`, { token: await tenantToken(c) });
  assertMatchesOpenApi("GET", "/tenant/v1/rescue-offers/{id}", seen);
  assert.equal(seen.status, 200);
  assert.ok(!(await pendingOffers(m.a)).some((entry) => entry.id === offerId));
  assert.ok(!(await ok(api.call("GET", "/tenant/v1/deductions", { token: await tenantToken(m.a) }))).items.some((d: any) => d.order_id === order.id));
  assert.equal((await api.call("GET", `/tenant/v1/deductions?order_id=${order.id}`, { token: await tenantToken(c) })).body.items.length, 0);
  // 数据库层：救援、救援单的平台一侧租户角色没有任何权限；救援单、应扣款项只读得到自己的
  await withTenantTx(api.db.pool, m.a.tenantId, async (db) => {
    await assert.rejects(db.query("select id from order_rescues"), deniedByDatabase);
  });
  await withTenantTx(api.db.pool, m.a.tenantId, async (db) => {
    await assert.rejects(db.query("select offer_id from order_rescue_quotes"), deniedByDatabase);
  });
  await withTenantTx(api.db.pool, m.a.tenantId, async (db) => {
    assert.equal((await db.query("select id from order_rescue_offers where id = $1", [offerId])).rowCount, 0);
    assert.equal((await db.query("select id from tenant_deductions where order_id = $1", [order.id])).rowCount, 0);
    await assert.rejects(db.query("update tenant_deductions set status = 'waived'"), deniedByDatabase);
  });
  // 救援表的写只有平台：供应商在库里不能把自己的单改成救援中
  await withTenantTx(api.db.pool, m.b.tenantId, async (db) => {
    await assert.rejects(db.query("update orders set status = 'rescued' where id = $1", [order.id]), deniedByDatabase);
  });
});

test("供应商被暂停：没暂停时不能批量发起；暂停后名下未来订单逐张进入救援，违约金按距用车时间套阶梯", async () => {
  const order = await paidOrderIn(3 * 24);
  const root = await platformLogin(api, "root@platform.test");
  const refused = await api.call("POST", `/platform/v1/tenants/${m.b.tenantId}/rescue`, { token: root, body: { note: "供应商暂停" } });
  assertMatchesOpenApi("POST", "/platform/v1/tenants/{id}/rescue", refused);
  assert.equal(refused.body.error.code, "RESCUE_TRIGGER_NOT_MET");
  await ok(api.call("POST", `/platform/v1/tenants/${m.b.tenantId}/suspend`, { token: root, body: { reason: "资质过期" } }));
  const queue = await ok(api.call("GET", "/platform/v1/rescues", { token: await ops() }));
  assert.ok(queue.suspended_tenants.some((entry: any) => entry.tenant.id === m.b.tenantId && entry.future_orders >= 1));
  const done = await api.call("POST", `/platform/v1/tenants/${m.b.tenantId}/rescue`, { token: root, body: { note: "资质过期，名下订单改派" } });
  assertMatchesOpenApi("POST", "/platform/v1/tenants/{id}/rescue", done);
  assert.equal(done.status, 200, done.text);
  assert.ok(done.body.triggered.includes(order.id));
  const detail = await platformDetail(order.id);
  assert.equal(detail.rescues[0].trigger, "tenant_suspended");
  assert.equal(detail.rescues[0].penalty_bp, 0, "离用车 3 天：0");
  await ok(api.call("POST", `/platform/v1/tenants/${m.b.tenantId}/resume`, { token: root, body: {} }));
});
