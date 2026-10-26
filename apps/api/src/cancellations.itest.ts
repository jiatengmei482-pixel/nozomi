/**
 * M3-03：取消与退款（ADR 0029），经真实接口、真实 PostgreSQL；收款服务用替身（testing/payments.ts）。
 * - 平台统一取消阶梯：边界到毫秒（试算接口）；按同一比例拆（客人扣对外价 × M%、供应商得结算价 × M%）；
 * - 各状态下取消：待支付（先在收款服务取消付款；最后一刻付了款的先确认再按阶梯）、已确认、已派车；服务开始后、已完成的不能取消；
 * - 重复取消幂等（含同时来两次）；退款失败自动重试、财务手动重试、收款服务「处理中」等通知；
 * - 运营代取消：免费的原因、免收取消费多退了钱 → 双人复核（发起人不能自己批、客服不能批）；审计；
 * - 规则 4：供应商只看到扣款比例和自己应得的；渠道隔离：别的渠道的单当作不存在。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { portionBasisPoints } from "@nozomi/domain";
import { type TestApi, createTestApi } from "./testing/api.ts";
import { type Market, type Staff, SERVICE_TIME, addStaff, allKeys, allValues, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";
import { completeOrder, platformLogin, tenantLogin } from "./testing/money.ts";
import { type FakeReceiver, startFakeReceiver } from "./testing/dispatch.ts";

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let flow: SalesFlow;
let finance: Staff;
let support: Staff;
let receiver: FakeReceiver;
/** 另一个渠道的令牌（渠道隔离）：在开头就建好，之后时钟拨远了渠道经理的令牌会过期 */
let otherChannel: { clientId: string; secret: string };

const SERVICE_AT = new Date(SERVICE_TIME).getTime();
const HOUR = 3_600_000;

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  flow = await salesFlow(api, m, pay);
  finance = await addStaff(api, m.root, "fin@platform.test", "finance");
  support = await addStaff(api, m.root, "cs@platform.test", "customer_service");
  receiver = await startFakeReceiver();
  otherChannel = await salesCredentials(api, m, (await newChannel(api, m.staff.cm1.token, { name: "别的渠道" })).id);
  await ok(api.call("PUT", "/tenant/v1/webhooks", { token: m.b.adminToken, body: { url: receiver.url, events: ["order.cancelled", "order.changed"] } }), 201);
});
after(async () => {
  await receiver.close();
  await api.close();
});

/** 另一个渠道的令牌（2 小时过期，用的时候现换一个）。 */
async function refreshedOther(): Promise<string> {
  return (await ok(api.call("POST", "/sales/v1/oauth/token", { ip: "198.51.100.11", body: { grant_type: "client_credentials", client_id: otherChannel.clientId, client_secret: otherChannel.secret } }))).access_token;
}

/** 把时钟拨到「离用车还有 `msBefore` 毫秒」（只能往后拨）。 */
function moveTo(msBefore: number, serviceAt = SERVICE_AT): void {
  const delta = serviceAt - msBefore - api.clock.now().getTime();
  assert.ok(delta >= 0, "时钟只能往后拨");
  api.clock.advance(delta);
}

async function salesGet(orderId: string, token?: string): Promise<any> {
  return (await ok(api.call("GET", `/sales/v1/orders/${orderId}`, { token: token ?? (await flow.token()) }))).order;
}

async function platformDetail(orderId: string): Promise<any> {
  return ok(api.call("GET", `/platform/v1/orders/${orderId}`, { token: await platformLogin(api, m.staff.operations.email) }));
}

/** 用一个新的服务时间（比默认的晚几天）下单付款，避免各测试抢同一段时钟。 */
const serviceTimeIn = (days: number): string => new Date(api.clock.now().getTime() + days * 24 * HOUR).toISOString().replace(/\.\d{3}Z$/, "Z");

test("退款试算的阶梯边界按毫秒（商务车接送机：≥ 48 小时免费、24–48 小时 50%、< 24 小时 100%）；待支付的不涉及钱；只认本渠道", async () => {
  const order = await flow.paidOrder();
  let token = await flow.token();
  const fee = async (): Promise<any> => {
    const res = await api.call("GET", `/sales/v1/orders/${order.id}/cancel-fee`, { token });
    assertMatchesOpenApi("GET", "/sales/v1/orders/{id}/cancel-fee", res);
    return res.body;
  };
  const first = await fee();
  assert.deepEqual([first.cancellable, first.stage, first.fee_bp, first.policy.level, first.policy.version], [true, "paid", 0, "business", 0]);
  assert.deepEqual(first.policy.tiers, [{ min_hours_before: 48, fee_bp: 0 }, { min_hours_before: 24, fee_bp: 5000 }, { min_hours_before: 0, fee_bp: 10000 }]);
  // 渠道令牌 2 小时过期：先在边界前几秒换好令牌（换令牌会拨一秒），再拨到边界上
  moveTo(48 * HOUR + 5_000);
  token = await flow.token();
  moveTo(48 * HOUR);
  assert.equal((await fee()).fee_bp, 0, "正好 48 小时：免费");
  api.clock.advance(1);
  const half = await fee();
  assert.equal(half.fee_bp, 5000, "差 1 毫秒：50%");
  const sell = Number(order.price.total.amount);
  assert.deepEqual([half.paid.amount, half.fee.amount, half.refund.amount], [String(sell), String(portionBasisPoints(sell, 5000)), String(sell - portionBasisPoints(sell, 5000))]);
  moveTo(24 * HOUR + 5_000);
  token = await flow.token();
  moveTo(24 * HOUR);
  assert.equal((await fee()).fee_bp, 5000, "正好 24 小时：50%");
  api.clock.advance(1);
  assert.equal((await fee()).fee_bp, 10000, "差 1 毫秒：100%");
  const creds = { token: await refreshedOther() };
  assert.equal((await api.call("GET", `/sales/v1/orders/${order.id}/cancel-fee`, { token: creds.token })).status, 404, "别的渠道的单当作不存在");
  assert.equal((await api.call("POST", `/sales/v1/orders/${order.id}/cancel`, { token: creds.token, body: {} })).status, 404);
  assert.equal((await salesGet(order.id)).status, "confirmed");
});

test("付款后取消（24–48 小时，扣 50%）：客人退「对外价 − 取消费」，供应商得结算价 × 50%；推 order.cancelled；重复取消返回同一个结果、不再退款；供应商看不到客人的金额", async () => {
  const order = await flow.paidOrder({ serviceTime: serviceTimeIn(3) });
  const serviceAt = new Date(order.service_time).getTime();
  moveTo(30 * HOUR, serviceAt);
  const res = await api.call("POST", `/sales/v1/orders/${order.id}/cancel`, { token: await flow.token(), body: {} });
  assertMatchesOpenApi("POST", "/sales/v1/orders/{id}/cancel", res);
  assert.equal(res.status, 200, res.text);
  const sell = Number(order.price.total.amount);
  const fee = portionBasisPoints(sell, 5000);
  assert.equal(res.body.replayed, false);
  assert.equal(res.body.order.status, "cancelled");
  assert.deepEqual(res.body.order.cancellation, { reason: "GUEST_REQUEST", fee_bp: 5000, fee: { amount: String(fee), currency: "JPY" }, refund: { amount: String(sell - fee), currency: "JPY" }, refund_status: "succeeded" });
  const refunds = pay.refundsOf(order.id);
  assert.deepEqual(refunds.map((refund) => refund.amountMinor), [sell - fee]);
  const detail = await platformDetail(order.id);
  assert.deepEqual(detail.refunds.map((refund: any) => [refund.purpose, refund.status, refund.amount.amount]), [["cancellation", "succeeded", String(sell - fee)]]);
  assert.equal(detail.payments[0].refunded.amount, String(sell - fee));
  assert.deepEqual(detail.order.cancellation, { reason: "GUEST_REQUEST", note: null, fee_bp: 5000, customer_fee: { amount: String(fee), currency: "JPY" }, tenant_share: { amount: "9900", currency: "JPY" } });
  assert.deepEqual(detail.events.at(-1), { from_status: "confirmed", to_status: "cancelled", actor: "channel", reason: "GUEST_REQUEST", occurred_at: api.clock.now().toISOString() });
  // 供应商：只有扣款比例和自己应得的（结算价 19,800 × 50%）
  const tenant = await ok(api.call("GET", `/tenant/v1/orders/${order.id}`, { token: await tenantLogin(api, m.b.adminEmail) }));
  assert.deepEqual(tenant.order.cancellation, { fee_bp: 5000, tenant_share: { amount: "9900", currency: "JPY" } });
  const keys = allKeys(tenant);
  for (const forbidden of ["refund", "refunds", "fee", "customer_fee", "sell", "markup_bp", "price", "paid"]) assert.ok(!keys.has(forbidden), `供应商看得到 ${forbidden}`);
  assert.ok(!allValues(tenant).has(String(sell)), "应答里没有对外价");
  const queued = await api.db.owner.query("select event_type, event_data from webhook_deliveries where order_id = $1 and event_type = 'order.cancelled'", [order.id]);
  assert.deepEqual(queued.rows.map((row) => row.event_data), [{ reason: "GUEST_REQUEST", from_status: "confirmed" }]);
  // 重复取消
  const again = await api.call("POST", `/sales/v1/orders/${order.id}/cancel`, { token: await flow.token(), body: {} });
  assert.deepEqual([again.status, again.body.replayed, again.body.order.cancellation.refund.amount], [200, true, String(sell - fee)]);
  assert.equal(pay.refundsOf(order.id).length, 1, "不再退一次");
  const fees = await api.call("GET", `/sales/v1/orders/${order.id}/cancel-fee`, { token: await flow.token() });
  assert.deepEqual(fees.body, { cancellable: false });
});

test("同时取消两次：只取消一次、只退一次款", async () => {
  const order = await flow.paidOrder({ serviceTime: serviceTimeIn(5) });
  const token = await flow.token();
  const results = await Promise.all([0, 1].map(() => api.call("POST", `/sales/v1/orders/${order.id}/cancel`, { token, body: {} })));
  assert.deepEqual(results.map((res) => res.status), [200, 200]);
  assert.deepEqual(results.map((res) => res.body.replayed).sort(), [false, true]);
  assert.equal(pay.refundsOf(order.id).length, 1);
  assert.equal(pay.refundsOf(order.id)[0]?.amountMinor, Number(order.price.total.amount), "48 小时以上免费：全额退");
  const events = await api.db.owner.query("select count(*)::int as n from order_events where order_id = $1 and to_status = 'cancelled'", [order.id]);
  assert.equal(events.rows[0].n, 1);
});

test("待支付的单取消：先在收款服务取消付款再取消订单，没有退款；最后一刻客人其实付了：先确认、再按阶梯取消并退款", async () => {
  const unpaid = await flow.unpaidOrder({ serviceTime: serviceTimeIn(6) });
  const res = await api.call("POST", `/sales/v1/orders/${unpaid.id}/cancel`, { token: await flow.token(), body: {} });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual([res.body.order.status, res.body.order.cancel_reason, res.body.order.payment_status], ["cancelled", "GUEST_REQUEST", "canceled"]);
  assert.deepEqual(res.body.order.cancellation, { reason: "GUEST_REQUEST", fee_bp: null, fee: null, refund: { amount: "0", currency: "JPY" }, refund_status: null });
  assert.equal(pay.intentOf(unpaid.id)?.status, "canceled");
  assert.equal(pay.refundsOf(unpaid.id).length, 0);

  const raced = await flow.unpaidOrder({ serviceTime: serviceTimeIn(6) });
  pay.pay((pay.intentOf(raced.id) as { id: string }).id);
  const late = await api.call("POST", `/sales/v1/orders/${raced.id}/cancel`, { token: await flow.token(), body: {} });
  assert.equal(late.status, 200, late.text);
  assert.equal(late.body.order.status, "cancelled");
  assert.equal(late.body.order.cancellation.refund.amount, raced.price.total.amount, "离用车还很远：免费，全额退");
  const detail = await platformDetail(raced.id);
  assert.deepEqual(detail.events.map((event: any) => event.to_status), ["pending_payment", "confirmed", "cancelled"]);
});

test("各状态：已派车可以取消（按阶梯）；服务开始后、已完成的不能取消（409）", async () => {
  const assigned = await flow.paidOrder({ serviceTime: serviceTimeIn(7) });
  await completeOrder(api, m, "b", assigned.id, "assigned");
  const res = await api.call("POST", `/sales/v1/orders/${assigned.id}/cancel`, { token: await flow.token(), body: {} });
  assert.deepEqual([res.status, res.body.order.status, res.body.order.cancellation.fee_bp], [200, "cancelled", 0]);
  const tenant = await ok(api.call("GET", `/tenant/v1/orders/${assigned.id}`, { token: await tenantLogin(api, m.b.adminEmail) }));
  assert.deepEqual(tenant.events.at(-1).from_status, "assigned");

  const serving = await flow.paidOrder({ serviceTime: serviceTimeIn(8) });
  await completeOrder(api, m, "b", serving.id, "in_service");
  const refused = await api.call("POST", `/sales/v1/orders/${serving.id}/cancel`, { token: await flow.token(), body: {} });
  assert.deepEqual([refused.status, refused.body.error.code, refused.body.error.details.status], [409, "ORDER_STATE_INVALID", "in_service"]);
  assert.deepEqual((await ok(api.call("GET", `/sales/v1/orders/${serving.id}/cancel-fee`, { token: await flow.token() }))), { cancellable: false });
  await ok(api.call("POST", `/tenant/v1/orders/${serving.id}/events`, { token: await tenantLogin(api, m.b.adminEmail), body: { type: "completed" } }));
  assert.equal((await api.call("POST", `/sales/v1/orders/${serving.id}/cancel`, { token: await flow.token(), body: {} })).status, 409);
  assert.equal(pay.refundsOf(serving.id).length, 0);
});

test("运营代取消：免费的原因、免收取消费多退了钱 → 双人复核（发起人、客服不能批，财务批准后取消并全额退）；按阶梯的直接生效；都写审计", async () => {
  const order = await flow.paidOrder({ serviceTime: serviceTimeIn(4) });
  const serviceAt = new Date(order.service_time).getTime();
  moveTo(30 * HOUR, serviceAt);
  const ops = await platformLogin(api, m.staff.operations.email);
  const preview = await api.call("GET", `/platform/v1/orders/${order.id}/cancel-fee?reason=FORCE_MAJEURE`, { token: ops });
  assertMatchesOpenApi("GET", "/platform/v1/orders/{id}/cancel-fee", preview);
  const sell = Number(order.price.total.amount);
  assert.deepEqual([preview.body.fee_bp, preview.body.policy_fee_bp, preview.body.refund.amount, preview.body.policy_refund.amount, preview.body.needs_review], [0, 5000, String(sell), String(sell - portionBasisPoints(sell, 5000)), true]);
  assert.equal((await api.call("POST", `/platform/v1/orders/${order.id}/cancel`, { token: ops, body: { reason: "FORCE_MAJEURE" } })).status, 400, "必须写原因说明");
  assert.equal((await api.call("POST", `/platform/v1/orders/${order.id}/cancel`, { token: await platformLogin(api, m.staff.readonly.email), body: { reason: "FORCE_MAJEURE", note: "x" } })).status, 403);
  const requested = await api.call("POST", `/platform/v1/orders/${order.id}/cancel`, { token: ops, body: { reason: "FORCE_MAJEURE", note: "台风，机场关闭" } });
  assertMatchesOpenApi("POST", "/platform/v1/orders/{id}/cancel", requested);
  assert.deepEqual([requested.status, requested.body.approval.kind, requested.body.approval.status], [202, "order.cancel_refund", "pending"]);
  assert.equal((await salesGet(order.id)).status, "confirmed", "还没生效");
  const approval = requested.body.approval.id;
  assert.equal((await api.call("POST", `/platform/v1/approvals/${approval}/approve`, { token: ops, body: {} })).body.error.code, "APPROVAL_SELF_REVIEW");
  assert.equal((await api.call("POST", `/platform/v1/approvals/${approval}/approve`, { token: await platformLogin(api, support.email), body: {} })).status, 403, "客服不能批退款");
  const approved = await api.call("POST", `/platform/v1/approvals/${approval}/approve`, { token: await platformLogin(api, finance.email), body: {} });
  assert.equal(approved.status, 200, approved.text);
  const after = await salesGet(order.id);
  assert.deepEqual([after.status, after.cancellation.reason, after.cancellation.fee_bp, after.cancellation.refund.amount, after.cancellation.refund_status], ["cancelled", "FORCE_MAJEURE", 0, String(sell), "succeeded"]);
  const audit = await api.db.owner.query("select actor_email, after from audit_logs where resource = 'order' and resource_id = $1 and action = 'cancel'", [order.id]);
  assert.deepEqual(audit.rows.map((row) => [row.actor_email, row.after.reason, row.after.note, row.after.refund_minor]), [[finance.email, "FORCE_MAJEURE", "台风，机场关闭", sell]]);
  const tenant = await ok(api.call("GET", `/tenant/v1/orders/${order.id}`, { token: await tenantLogin(api, m.b.adminEmail) }));
  assert.deepEqual(tenant.order.cancellation, { fee_bp: 0, tenant_share: { amount: "0", currency: "JPY" } });

  // 按阶梯的代取消（客服）：直接生效、扣 50%
  const second = await flow.paidOrder({ serviceTime: new Date(serviceAt + HOUR).toISOString() });
  const direct = await api.call("POST", `/platform/v1/orders/${second.id}/cancel`, { token: await platformLogin(api, support.email), body: { reason: "GUEST_REQUEST", note: "客人来电取消" } });
  assert.deepEqual([direct.status, direct.body.replayed], [200, false]);
  assert.equal((await salesGet(second.id)).cancellation.fee_bp, 5000);
  // 免收取消费：要复核
  const third = await flow.paidOrder({ serviceTime: new Date(serviceAt + 2 * HOUR).toISOString() });
  const waived = await api.call("POST", `/platform/v1/orders/${third.id}/cancel`, { token: ops, body: { reason: "GUEST_REQUEST", waive_fee: true, note: "客人投诉，免收" } });
  assert.equal(waived.status, 202);
  assert.equal((await api.call("POST", `/platform/v1/orders/${third.id}/cancel`, { token: ops, body: { reason: "FORCE_MAJEURE", waive_fee: true, note: "x" } })).status, 400, "免费的原因不用再免收");
  assert.equal((await api.call("POST", `/platform/v1/orders/${third.id}/cancel`, { token: ops, body: { reason: "PAYMENT_TIMEOUT", note: "x" } })).status, 400, "系统用的原因不能选");
  assert.equal((await api.call("POST", `/platform/v1/orders/${third.id}/cancel`, { token: ops, body: { reason: "CHANGE_NOT_CONFIRMED", note: "x" } })).body.error.code, "FREE_CANCEL_NOT_APPLICABLE");
  // 复核期间客人自己取消了：批准时说明已过时
  await ok(api.call("POST", `/sales/v1/orders/${third.id}/cancel`, { token: await flow.token(), body: {} }));
  const stale = await api.call("POST", `/platform/v1/approvals/${waived.body.approval.id}/approve`, { token: await platformLogin(api, finance.email), body: {} });
  assert.deepEqual([stale.status, stale.body.error.code], [409, "APPROVAL_STALE"]);
  assert.equal(pay.refundsOf(third.id).length, 1, "只按客人自己取消的那一次退");
});

test("退款失败：收款服务出错 → 等着重试（定时任务 1 分钟后再发）；明确失败 → 财务手动重试；收款服务说「处理中」→ 等通知", async () => {
  const flaky = await flow.paidOrder({ serviceTime: serviceTimeIn(9) });
  pay.failNext("PAYMENT_PROVIDER_UNAVAILABLE");
  await ok(api.call("POST", `/sales/v1/orders/${flaky.id}/cancel`, { token: await flow.token(), body: {} }));
  let detail = await platformDetail(flaky.id);
  assert.deepEqual([detail.refunds[0].status, detail.refunds[0].attempts, detail.refunds[0].last_error.code], ["pending", 1, "PAYMENT_PROVIDER_UNAVAILABLE"]);
  assert.equal((await salesGet(flaky.id)).cancellation.refund_status, "pending");
  assert.equal((await api.app.orderJobs.money()).refunds.succeeded, 0, "还没到时间");
  api.clock.advance(60_000);
  assert.equal((await api.app.orderJobs.money()).refunds.succeeded, 1);
  assert.equal((await salesGet(flaky.id)).cancellation.refund_status, "succeeded");

  const rejected = await flow.paidOrder({ serviceTime: serviceTimeIn(9) });
  pay.nextRefundIs("failed", "expired_or_canceled_card");
  await ok(api.call("POST", `/sales/v1/orders/${rejected.id}/cancel`, { token: await flow.token(), body: {} }));
  detail = await platformDetail(rejected.id);
  const refund = detail.refunds[0];
  assert.deepEqual([refund.status, refund.last_error.code], ["failed", "expired_or_canceled_card"]);
  assert.match(api.logs(), /refund\.failed/);
  assert.equal((await api.call("POST", `/platform/v1/orders/${rejected.id}/refunds/${refund.id}/retry`, { token: await platformLogin(api, support.email) })).status, 403, "客服不能重试退款");
  api.clock.advance(1_000);
  const retried = await api.call("POST", `/platform/v1/orders/${rejected.id}/refunds/${refund.id}/retry`, { token: await platformLogin(api, finance.email) });
  assertMatchesOpenApi("POST", "/platform/v1/orders/{id}/refunds/{refundId}/retry", retried);
  assert.deepEqual([retried.status, retried.body.outcome, retried.body.refund.status], [200, "succeeded", "succeeded"]);
  assert.notEqual(retried.body.refund.id, refund.id, "新建一笔（新的幂等键）");
  const again = await api.call("POST", `/platform/v1/orders/${rejected.id}/refunds/${refund.id}/retry`, { token: await platformLogin(api, finance.email) });
  assert.deepEqual([again.status, again.body.error.code], [409, "REFUND_STATE_INVALID"], "一笔失败的只能重试一次");
  const history = (await platformDetail(rejected.id)).refunds;
  assert.deepEqual(history.map((entry: any) => [entry.status, entry.retry_of]), [["failed", null], ["succeeded", refund.id]]);
  assert.equal(pay.refundsOf(rejected.id).filter((entry) => entry.status === "succeeded").length, 1, "只退成了一次");
  const audit = await api.db.owner.query("select actor_email from audit_logs where resource = 'refund' and resource_id = $1 and action = 'retry'", [refund.id]);
  assert.deepEqual(audit.rows.map((row) => row.actor_email), [finance.email]);

  const slow = await flow.paidOrder({ serviceTime: serviceTimeIn(9) });
  pay.nextRefundIs("pending");
  await ok(api.call("POST", `/sales/v1/orders/${slow.id}/cancel`, { token: await flow.token(), body: {} }));
  assert.equal((await platformDetail(slow.id)).refunds[0].status, "processing");
  const provider = pay.refundsOf(slow.id)[0] as { id: string };
  pay.settleRefund(provider.id, "succeeded");
  const raw = pay.event("refund.updated", pay.refundObject(provider.id), { created: api.clock.now() });
  const delivered = await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()));
  assert.deepEqual([delivered.status, delivered.body.result], [200, "applied"]);
  const settled = await platformDetail(slow.id);
  assert.deepEqual([settled.refunds[0].status, settled.payments[0].refunded.amount], ["succeeded", slow.price.total.amount]);
  const unknown = pay.event("refund.updated", { id: "re_not_ours", object: "refund", amount: 1, currency: "jpy", payment_intent: null, status: "succeeded" }, { created: api.clock.now() });
  assert.equal((await deliverWebhook(api.app, unknown, pay.sign(unknown, api.clock.now()))).body.result, "unmatched");
});
