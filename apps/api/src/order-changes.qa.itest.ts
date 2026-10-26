/**
 * M3-03 测试角色补充：改单的时间和并发（ADR 0029），经真实接口、真实 PostgreSQL；收款服务用替身。
 * - 供应商确认期限按毫秒：截止前 1 毫秒确认生效；到点那一刻供应商确认和定时任务同时到——只记一次超时、差价只退一次；
 * - 供应商确认和客人取消同时到：不论谁先，客人最后被扣的都是 0（经济车这一单任何时候都免费），钱不多退不少退；
 * - 跨午夜改期：新的用车时间按城市当地时间落到第二天（服务日期、当地时间都按东京），用 UTC 写法提交也一样。
 * 数据都在测试里构造，测试结束随 schema 一起删除（规则 1）。每个测试按「现在」往后挑自己的日期。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CANCELLATION_POLICY, applyBasisPoints } from "@nozomi/domain";
import { type TestApi, createTestApi } from "./testing/api.ts";
import { type Market, addStaff, buildMarket, ok } from "./testing/market.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";
import { platformLogin, tenantLogin } from "./testing/money.ts";

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let flow: SalesFlow;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const tokyoDate = (ms: number): string => new Date(ms + 9 * HOUR).toISOString().slice(0, 10);
/** 甲的经济 4 座：12,000 → 对外价 13,200；调价日 +20% → 14,400 / 15,840 */
const ECO_SELL = applyBasisPoints(12_000, 1_000);
const ECO_SURGE_SELL = applyBasisPoints(14_400, 1_000);

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  flow = await salesFlow(api, m, pay);
  // 接送机 · 经济：任何时候取消都免费（原来的用车时间进了 24 小时也还在免费取消期里，才能走到「要供应商确认的改期」）
  const ops2 = await addStaff(api, m.root, "ops2@platform.test", "operations");
  const rules = DEFAULT_CANCELLATION_POLICY.map((rule) => ({ category: rule.category, level: rule.level, tiers: rule.category === "airport_transfer" && rule.level === "economy" ? [{ min_hours_before: 0, fee_bp: 0 }] : rule.tiers.map((tier) => ({ min_hours_before: tier.minHoursBefore, fee_bp: tier.feeBp })) }));
  const requested = await ok(api.call("POST", "/platform/v1/cancellation-policy/changes", { token: m.staff.operations.token, body: { rules } }), 202);
  await ok(api.call("POST", `/platform/v1/approvals/${requested.approval.id}/approve`, { token: ops2.token, body: {} }));
});
after(() => api.close());

async function salesGet(orderId: string): Promise<any> {
  api.clock.advance(1_000);
  return (await ok(api.call("GET", `/sales/v1/orders/${orderId}`, { token: await flow.token() }))).order;
}

async function patch(orderId: string, body: Record<string, unknown>): Promise<any> {
  const version = (await salesGet(orderId)).version;
  api.clock.advance(1_000);
  return api.call("PATCH", `/sales/v1/orders/${orderId}`, { token: await flow.token(), headers: { "if-match": `"${version}"` }, body });
}

/** 甲的经济 4 座在这一天（东京）+20%。 */
async function surgeA(day: string): Promise<void> {
  const token = await tenantLogin(api, m.a.adminEmail);
  const version = (await ok(api.call("GET", `/tenant/v1/products/${m.ids.pa}`, { token }))).version;
  await ok(
    api.call("POST", `/tenant/v1/products/${m.ids.pa}/adjust-rules`, {
      token,
      headers: { "if-match": `"${version}"`, "idempotency-key": crypto.randomUUID() },
      body: { name: `QA ${day}`, travel_from: day, travel_to: day, cycle: { type: "daily" }, vehicle_group_ids: [m.ids.eco4], steps: [{ type: "percent", value: 2_000 }] },
    }),
    201,
  );
}

/** 几张经济车的单（相隔 1 小时），时钟拨到第一张用车前 22 小时，各自改期到两天后的调价日：每张都补了差价、在等甲确认。 */
async function pendingChanges(count: number, startDays: number): Promise<{ order: any; changeId: string; dueAt: number }[]> {
  const first = api.clock.now().getTime() + startDays * DAY;
  const orders = [];
  for (let i = 0; i < count; i += 1) orders.push(await flow.paidOrder({ vehicleGroupId: m.ids.eco4, serviceTime: iso(first + i * HOUR) }));
  const serviceAt = Date.parse(orders[0].service_time);
  await surgeA(tokyoDate(serviceAt + 2 * DAY));
  api.clock.advance(serviceAt - 22 * HOUR - api.clock.now().getTime());
  const result = [];
  for (const order of orders) {
    const res = await patch(order.id, { service_time: iso(Date.parse(order.service_time) + 2 * DAY) });
    assert.deepEqual([res.status, res.body.change?.status, res.body.change?.price_difference?.amount.amount], [200, "pending_confirmation", String(ECO_SURGE_SELL - ECO_SELL)], res.text);
    result.push({ order, changeId: res.body.change.id as string, dueAt: Date.parse(res.body.change.confirm_due_at) });
  }
  return result;
}

const confirm = (orderId: string, changeId: string, token: string): Promise<any> => api.call("POST", `/tenant/v1/orders/${orderId}/changes/${changeId}/confirm`, { token, body: {} });

function customerNet(orderId: string): number {
  const collected = [pay.intentOf(orderId), ...pay.chargesOf(orderId)].filter((intent) => intent?.status === "succeeded").reduce((sum, intent) => sum + (intent as { amountMinor: number }).amountMinor, 0);
  return collected - pay.refundsOf(orderId).filter((refund) => refund.status === "succeeded").reduce((sum, refund) => sum + refund.amountMinor, 0);
}

test("确认期限按毫秒：截止前 1 毫秒确认生效（对外价改为新价、差价不退）；到点那一刻供应商确认和定时任务同时到——只记一次超时、差价只退一次、订单不变", async () => {
  const [early, raced] = await pendingChanges(2, 3) as [{ order: any; changeId: string; dueAt: number }, { order: any; changeId: string; dueAt: number }];
  api.clock.advance(early.dueAt - 1 - api.clock.now().getTime());
  const admin = await tenantLogin(api, m.a.adminEmail);
  const ok1 = await confirm(early.order.id, early.changeId, admin);
  assert.deepEqual([ok1.status, ok1.body.change?.status], [200, "applied"], ok1.text);
  assert.equal(customerNet(early.order.id), ECO_SURGE_SELL, "客人付了新价");
  assert.equal(pay.refundsOf(early.order.id).length, 0);

  api.clock.advance(raced.dueAt - api.clock.now().getTime());
  const [late, job] = await Promise.all([confirm(raced.order.id, raced.changeId, admin), api.app.orderJobs.money()]);
  assert.ok([409].includes(late.status), late.text);
  assert.ok(["CHANGE_CONFIRMATION_EXPIRED", "CHANGE_NOT_PENDING"].includes(late.body.error.code), late.text);
  assert.ok(job.changes.expired <= 1);
  const now = await salesGet(raced.order.id);
  assert.deepEqual([now.changes.map((change: any) => change.status), now.service_time, now.price.total.amount, now.free_cancel_available], [["expired"], raced.order.service_time, String(ECO_SELL), true]);
  assert.deepEqual(pay.refundsOf(raced.order.id).map((refund) => refund.amountMinor), [ECO_SURGE_SELL - ECO_SELL], "补收的差价只退一次");
  const events = await api.db.owner.query("select count(*)::int as n from order_events where order_id = $1 and reason = 'CHANGE_EXPIRED'", [raced.order.id]);
  assert.equal(events.rows[0].n, 1, "只记一次超时");
});

test("供应商确认改期和客人取消同时到：不论谁先，客人最后被扣 0（这一单任何时候取消都免费），收款服务那边不多退", async () => {
  const pending = await pendingChanges(3, 6);
  const admin = await tenantLogin(api, m.a.adminEmail);
  for (const { order, changeId } of pending) {
    api.clock.advance(1_000);
    const token = await flow.token();
    const [confirmed, cancelled] = await Promise.all([confirm(order.id, changeId, admin), api.call("POST", `/sales/v1/orders/${order.id}/cancel`, { token, body: {} })]);
    assert.equal(cancelled.status, 200, cancelled.text);
    const detail = await ok(api.call("GET", `/platform/v1/orders/${order.id}`, { token: await platformLogin(api, m.staff.operations.email) }));
    assert.equal(detail.order.status, "cancelled");
    const change = detail.changes.find((entry: any) => entry.id === changeId);
    if (confirmed.status === 200) assert.equal(change.status, "applied");
    else assert.deepEqual([confirmed.status, change.status], [409, "cancelled"], confirmed.text);
    assert.equal(customerNet(order.id), 0, `${change.status}：客人应当全部拿回`);
    for (const payment of detail.payments) assert.ok(Number(payment.refunded.amount) <= Number(payment.amount.amount));
  }
});

test("跨午夜改期：改到东京第二天 00:30（UTC 写法提交），当地时间、服务日期都按东京算；派车截止按新时间", async () => {
  const start = api.clock.now().getTime() + 9 * DAY;
  const day = tokyoDate(start);
  const order = await flow.paidOrder({ serviceTime: `${day}T23:30:00+09:00` });
  const nextDay = tokyoDate(Date.parse(`${day}T23:30:00+09:00`) + 2 * HOUR);
  const target = Date.parse(`${nextDay}T00:30:00+09:00`);
  const res = await patch(order.id, { service_time: new Date(target).toISOString() });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual([res.body.order.service_local, res.body.order.service_time], [`${nextDay}T00:30`, new Date(target).toISOString()]);
  const tenant = await ok(api.call("GET", `/tenant/v1/orders/${order.id}`, { token: await tenantLogin(api, m.b.adminEmail) }));
  assert.deepEqual([tenant.order.service_date, tenant.order.service_local], [nextDay, `${nextDay}T00:30`]);
  assert.ok(Date.parse(tenant.order.dispatch.due_at) < target, "派车截止在新的用车时间之前");
  // 带秒的时间按分钟舍掉，再改一次一样的分钟算「没有变化」
  assert.equal((await patch(order.id, { service_time: new Date(target + 42_000).toISOString() })).body.error?.code, "NO_CHANGE");
});
