/**
 * M4-29：司机链接跟着订单走（ADR 0060「司机链接的有效期和吊销」），真实 PostgreSQL。全部数据在测试里构造，都是虚构的。
 * - 取消：所有取消路径都在同一个事务里吊销这张单的全部司机链接（原因 cancelled），司机打开只得到统一的「链接已失效」；
 * - 改期同意生效：没吊销、没过期的链接按新用车时间重算（延后、提前、包车），已吊销的不复活，已过期的不复活。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { driverLinkExpiry } from "@nozomi/domain";
import { type TenantFixture, type TestApi, createTestApi } from "./testing/api.ts";
import { assign, newDriver, newVehicle, seedOrder } from "./testing/dispatch.ts";
import { type Market, addStaff, buildMarket, ok } from "./testing/market.ts";
import { platformLogin, tenantLogin } from "./testing/money.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let flow: SalesFlow;
let b: TenantFixture;

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  flow = await salesFlow(api, m, pay);
  b = { ...m.b, adminToken: await tenantLogin(api, m.b.adminEmail) };
});
after(() => api.close());

/** 乙中标的一张付过款的单，派好司机，返回调度员的链接令牌。 */
async function dispatchedOrder(serviceMs?: number): Promise<{ order: any; token: string }> {
  b.adminToken = await tenantLogin(api, m.b.adminEmail);
  const order = await flow.paidOrder(serviceMs === undefined ? {} : { serviceTime: iso(serviceMs) });
  const driver = await newDriver(api, b);
  const vehicle = await newVehicle(api, b, m.ids.biz7);
  const res = await ok(assign(api, b, order.id, driver.id, vehicle.id));
  return { order, token: res.driver_link.token };
}

const links = async (orderId: string): Promise<any[]> => (await api.db.owner.query("select purpose, revoked_at, revoke_reason, expires_at from driver_links where order_id = $1 order by purpose, created_at, id", [orderId])).rows;

/** 一条邮件链接（发信时才生成；这里直接写行，只测它跟着订单走）。 */
async function addEmailLink(orderId: string): Promise<void> {
  await api.db.owner.query(
    `insert into driver_links (tenant_id, order_id, assignment_id, driver_id, token_hash, created_at, expires_at, purpose)
     select tenant_id, order_id, assignment_id, driver_id, md5(random()::text) || md5(random()::text), created_at, expires_at, 'email' from driver_links where order_id = $1 and purpose = 'dispatcher' limit 1`,
    [orderId],
  );
}

async function assertLinkDead(token: string): Promise<void> {
  const res = await api.call("GET", "/driver/v1/trip", { token });
  assert.equal(res.status, 401, res.text);
  assert.equal(res.body.error.code, "DRIVER_LINK_INVALID");
  for (const secret of ["王小明", "+8190", "NH211", "东京"]) assert.ok(!res.text.includes(secret), `应答里不能有行程和客人信息：${secret}`);
  assert.equal((await api.call("POST", "/driver/v1/trip/events", { token, body: { type: "departed" } })).status, 401, "取消后不能再上报");
}

test("渠道取消：调度员的和邮件的链接都吊销（cancelled），司机打开只得到统一的失效应答", async () => {
  const { order, token } = await dispatchedOrder();
  await addEmailLink(order.id);
  assert.equal((await api.call("GET", "/driver/v1/trip", { token })).status, 200, "取消前能打开");
  api.clock.advance(1_000);
  await ok(api.call("POST", `/sales/v1/orders/${order.id}/cancel`, { token: await flow.token(), body: {} }));
  const rows = await links(order.id);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row) => [row.purpose, row.revoke_reason]), [["dispatcher", "cancelled"], ["email", "cancelled"]]);
  assert.ok(rows.every((row) => row.revoked_at !== null));
  await assertLinkDead(token);
});

test("运营代取消、航班取消（不可抗力类原因）：同样吊销", async () => {
  const ops = await platformLogin(api, m.staff.operations.email);
  const { order, token } = await dispatchedOrder();
  await ok(api.call("POST", `/platform/v1/orders/${order.id}/cancel`, { token: ops, body: { reason: "GUEST_REQUEST", note: "客人来电要求取消" } }));
  assert.deepEqual((await links(order.id)).map((row) => row.revoke_reason), ["cancelled"]);
  await assertLinkDead(token);

  const second = await dispatchedOrder();
  const res = await api.call("POST", `/platform/v1/orders/${second.order.id}/cancel`, { token: ops, body: { reason: "FLIGHT_CANCELLED", note: "航班取消，有证明" } });
  assert.equal(res.status, 202, res.text);
  const reviewer = await addStaff(api, m.root, "finance2@platform.test", "finance");
  await ok(api.call("POST", `/platform/v1/approvals/${res.body.approval.id}/approve`, { token: reviewer.token, body: {} }));
  assert.deepEqual((await links(second.order.id)).map((row) => row.revoke_reason), ["cancelled"]);
  await assertLinkDead(second.token);
});

test("没付款的单取消（超时）：走另一个入口，同一条规则；本来就没有链接时什么都不报错", async () => {
  const order = await flow.unpaidOrder();
  api.clock.advance(1_000);
  await ok(api.call("POST", `/sales/v1/orders/${order.id}/cancel`, { token: await flow.token(), body: {} }));
  assert.deepEqual(await links(order.id), []);
});

test("这次修复之前就取消了、链接还没吊销的单：司机同样打不开", async () => {
  const seeded = await seedOrder(api, m, "b", { serviceAt: new Date(api.clock.now().getTime() + 96 * HOUR) });
  const driver = await newDriver(api, b);
  const vehicle = await newVehicle(api, b, m.ids.biz7);
  const res = await ok(assign(api, b, seeded.id, driver.id, vehicle.id));
  await api.db.owner.query("update orders set status = 'cancelled', cancelled_at = now(), cancel_reason = 'GUEST_REQUEST' where id = $1", [seeded.id]);
  assert.equal((await links(seeded.id))[0].revoked_at, null);
  await assertLinkDead(res.driver_link.token);
});

test("已完成的单维持现有规则：用车后 24 小时内司机还能打开传票据", async () => {
  const seeded = await seedOrder(api, m, "b", { serviceAt: new Date(api.clock.now().getTime() + 96 * HOUR) });
  const driver = await newDriver(api, b);
  const vehicle = await newVehicle(api, b, m.ids.biz7);
  const res = await ok(assign(api, b, seeded.id, driver.id, vehicle.id));
  await api.db.owner.query("update orders set status = 'completed' where id = $1", [seeded.id]);
  const trip = await api.call("GET", "/driver/v1/trip", { token: res.driver_link.token });
  assert.equal(trip.status, 200, trip.text);
  assert.equal((await links(seeded.id))[0].revoked_at, null);
});

// ---- 改期：规则「司机链接的有效期跟随订单当前用车时间自动调整」。同意生效才算当前用车时间，待确认期间按原时间 ----

/** 东京 10:00 的第 n 天之后（调价、服务时间都不受影响；每个测试按现在往后挑）。 */
const dayAhead = (days: number): number => Math.ceil(api.clock.now().getTime() / DAY) * DAY + HOUR + days * DAY;

async function requestReschedule(orderId: string, serviceMs: number): Promise<string> {
  api.clock.advance(1_000);
  const version = (await ok(api.call("GET", `/sales/v1/orders/${orderId}`, { token: await flow.token() }))).order.version;
  api.clock.advance(1_000);
  const res = await api.call("PATCH", `/sales/v1/orders/${orderId}`, { token: await flow.token(), headers: { "if-match": `"${version}"` }, body: { service_time: iso(serviceMs) } });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.change.status, "pending_confirmation");
  return res.body.change.id;
}

async function decide(orderId: string, changeId: string, decision: "confirm" | "reject"): Promise<void> {
  b.adminToken = await tenantLogin(api, m.b.adminEmail);
  await ok(api.call("POST", `/tenant/v1/orders/${orderId}/changes/${changeId}/${decision}`, { token: b.adminToken, body: decision === "reject" ? { note: "排不出车" } : {} }));
}

const expiryOf = (serviceMs: number, packageHours: number | null = null): number => driverLinkExpiry(new Date(serviceMs), packageHours).getTime();
const expiries = async (orderId: string): Promise<number[]> => (await links(orderId)).map((row) => new Date(row.expires_at).getTime());

test("延后的改期：同意生效时调度员的和邮件的链接都按新时间延长；待确认、被拒都按原时间；过了原来的失效时间司机还能打开", async () => {
  const oldAt = dayAhead(10);
  const newAt = dayAhead(13);
  const { order, token } = await dispatchedOrder(oldAt);
  await addEmailLink(order.id);
  const rejected = await requestReschedule(order.id, newAt);
  assert.deepEqual(await expiries(order.id), [expiryOf(oldAt), expiryOf(oldAt)], "待确认期间按原时间");
  await decide(order.id, rejected, "reject");
  assert.deepEqual(await expiries(order.id), [expiryOf(oldAt), expiryOf(oldAt)], "被拒不动");
  const changeId = await requestReschedule(order.id, newAt);
  await decide(order.id, changeId, "confirm");
  assert.deepEqual(await expiries(order.id), [expiryOf(newAt), expiryOf(newAt)]);
  api.clock.advance(expiryOf(oldAt) + HOUR - api.clock.now().getTime());
  const trip = await api.call("GET", "/driver/v1/trip", { token });
  assert.equal(trip.status, 200, trip.text);
});

test("提前的改期：同样重算，链接不能比规则活得更久", async () => {
  const oldAt = dayAhead(13);
  const newAt = dayAhead(10);
  const { order, token } = await dispatchedOrder(oldAt);
  await addEmailLink(order.id);
  const changeId = await requestReschedule(order.id, newAt);
  await decide(order.id, changeId, "confirm");
  assert.deepEqual(await expiries(order.id), [expiryOf(newAt), expiryOf(newAt)]);
  api.clock.advance(expiryOf(newAt) + 1 - api.clock.now().getTime());
  assert.equal((await api.call("GET", "/driver/v1/trip", { token })).status, 401);
});

test("包车：按新时间 + 套餐时长 + 24 小时", async () => {
  const oldAt = dayAhead(10);
  const newAt = dayAhead(12);
  const { order } = await dispatchedOrder(oldAt);
  const changeId = await requestReschedule(order.id, newAt);
  await api.db.owner.query("update orders set package_hours = 8 where id = $1", [order.id]);
  await decide(order.id, changeId, "confirm");
  assert.deepEqual(await expiries(order.id), [expiryOf(newAt, 8)]);
  assert.equal(expiryOf(newAt, 8) - expiryOf(newAt), 8 * HOUR);
});

test("已吊销的不复活；已过期的不复活（正好到期算过期，差 1 毫秒的照常重算）", async () => {
  const oldAt = dayAhead(10);
  const newAt = dayAhead(12);
  const { order, token } = await dispatchedOrder(oldAt);
  b.adminToken = await tenantLogin(api, m.b.adminEmail);
  const reissued = await ok(api.call("POST", `/tenant/v1/orders/${order.id}/driver-link`, { token: b.adminToken }));
  const revokedExpiry = expiryOf(oldAt);
  await addEmailLink(order.id);
  await addEmailLink(order.id);
  const changeId = await requestReschedule(order.id, newAt);
  b.adminToken = await tenantLogin(api, m.b.adminEmail);
  const decideAt = api.clock.now().getTime();
  const emails = (await api.db.owner.query<{ id: string }>("select id from driver_links where order_id = $1 and purpose = 'email' order by id", [order.id])).rows;
  await api.db.owner.query("update driver_links set expires_at = $2 where id = $1", [emails[0]?.id, new Date(decideAt)]);
  await api.db.owner.query("update driver_links set expires_at = $2 where id = $1", [emails[1]?.id, new Date(decideAt + 1)]);
  await ok(api.call("POST", `/tenant/v1/orders/${order.id}/changes/${changeId}/confirm`, { token: b.adminToken, body: {} }));
  const row = async (id: string | undefined): Promise<any> => (await api.db.owner.query("select expires_at, revoked_at from driver_links where id = $1", [id])).rows[0];
  assert.equal(new Date((await row(emails[0]?.id)).expires_at).getTime(), decideAt, "正好到期的不复活");
  assert.equal(new Date((await row(emails[1]?.id)).expires_at).getTime(), expiryOf(newAt), "差 1 毫秒还没过期，照常重算");
  const revoked = (await links(order.id)).filter((item) => item.revoked_at !== null);
  assert.equal(revoked.length, 1);
  assert.equal(new Date(revoked[0].expires_at).getTime(), revokedExpiry, "已吊销的不动");
  assert.equal((await api.call("GET", "/driver/v1/trip", { token })).status, 401, "已吊销的打不开");
  assert.equal((await api.call("GET", "/driver/v1/trip", { token: reissued.driver_link.token })).status, 200);
});
