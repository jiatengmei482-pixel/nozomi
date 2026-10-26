/**
 * M3-03：服务后加收（ADR 0029），经真实接口、真实 PostgreSQL；收款服务用替身。
 * - 提交：只有已完成的单、服务结束 24 小时内、类型按品类、金额上限、凭证是这一单的票据；角色；
 * - 48 小时异议期按毫秒：截止前 1 毫秒能提异议、到点那一刻不能；异议期内不扣款；到点后不用审核的自动用保存的支付方式扣（客人付 金额 ×（1 + 加价比例））；
 * - 要审核的（超过对外价 50%、没有凭证、客人异议）：平台通过（可部分）后扣、驳回不收；异议期内平台不能先批；
 * - 扣款失败：卡被拒 → 扣款失败，财务重试；收款服务出错 → 10 分钟后自动重试；
 * - 供应商撤回；规则 4（供应商看不到客人付的金额）；跨租户、渠道隔离；数据库层面供应商只能提交和撤回。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { applyBasisPoints } from "@nozomi/domain";
import { withTenantTx } from "./db/context.ts";
import { type TestApi, addTenantUser, createTestApi } from "./testing/api.ts";
import { deniedByDatabase } from "./testing/db.ts";
import { type Market, type Staff, addStaff, allKeys, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";
import { completeOrder, platformLogin, tenantLogin, uploadReceipt } from "./testing/money.ts";

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let flow: SalesFlow;
let finance: Staff;
let support: Staff;
let otherChannel: { clientId: string; secret: string };

const HOUR = 3_600_000;
const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  flow = await salesFlow(api, m, pay);
  finance = await addStaff(api, m.root, "fin@platform.test", "finance");
  support = await addStaff(api, m.root, "cs@platform.test", "customer_service");
  otherChannel = await salesCredentials(api, m, (await newChannel(api, m.staff.cm1.token, { name: "别的渠道" })).id);
});
after(() => api.close());

/** 一张已完成的单（乙中标，结算价 19,800，对外价 21,780）。 */
async function completed(days = 3): Promise<any> {
  const order = await flow.paidOrder({ serviceTime: iso(api.clock.now().getTime() + days * 24 * HOUR) });
  await completeOrder(api, m, "b", order.id);
  return order;
}

async function submit(orderId: string, body: Record<string, unknown>, token?: string): Promise<any> {
  return api.call("POST", `/tenant/v1/orders/${orderId}/extra-charges`, { token: token ?? (await tenantLogin(api, m.b.adminEmail)), body });
}

async function salesGet(orderId: string): Promise<any> {
  api.clock.advance(1_000);
  return (await ok(api.call("GET", `/sales/v1/orders/${orderId}`, { token: await flow.token() }))).order;
}

async function dispute(orderId: string, chargeId: string, token?: string): Promise<any> {
  return api.call("POST", `/sales/v1/orders/${orderId}/extra-charges/${chargeId}/dispute`, { token: token ?? (await flow.token()), body: { reason: "司机没有等那么久" } });
}

async function decide(orderId: string, chargeId: string, body: Record<string, unknown>, email = m.staff.operations.email): Promise<any> {
  return api.call("POST", `/platform/v1/orders/${orderId}/extra-charges/${chargeId}/decide`, { token: await platformLogin(api, email), body });
}

async function platformCharges(orderId: string): Promise<any[]> {
  return (await ok(api.call("GET", `/platform/v1/orders/${orderId}`, { token: await platformLogin(api, m.staff.operations.email) }))).extra_charges;
}

test("提交：只有已完成的单、服务结束 24 小时内（正好 24 小时还行）；类型按品类、金额上限、凭证是这一单的票据；只读角色不能交；供应商看不到客人付多少", async () => {
  const order = await flow.paidOrder({ serviceTime: iso(api.clock.now().getTime() + 3 * 24 * HOUR) });
  const early = await submit(order.id, { type: "waiting", amount: 2_000 });
  assert.deepEqual([early.status, early.body.error.code, early.body.error.details.reason], [409, "EXTRA_CHARGE_NOT_ALLOWED", "ORDER_NOT_COMPLETED"]);
  await completeOrder(api, m, "b", order.id);
  const completedAt = api.clock.now().getTime();
  const token = await tenantLogin(api, m.b.adminEmail);
  const file = await uploadReceipt(api, token, order.id);
  const created = await submit(order.id, { type: "waiting", amount: 2_000, description: "等了 40 分钟", file_ids: [file] }, token);
  assertMatchesOpenApi("POST", "/tenant/v1/orders/{id}/extra-charges", created);
  assert.equal(created.status, 201, created.text);
  const charge = created.body.extra_charge;
  assert.deepEqual([charge.status, charge.review_reasons, charge.amount, charge.dispute_until], ["in_window", [], { amount: "2000", currency: "JPY" }, new Date(api.clock.now().getTime() + 48 * HOUR).toISOString()]);
  const reason = async (body: Record<string, unknown>) => (await submit(order.id, body, token)).body.error.details.reason;
  assert.equal(await reason({ type: "toll", amount: 800, file_ids: [file] }), "TYPE_NOT_ALLOWED", "接送机是一口价，含高速费");
  assert.equal(await reason({ type: "charter_overtime", amount: 800, file_ids: [file] }), "TYPE_NOT_ALLOWED");
  assert.equal(await reason({ type: "waiting", amount: 0 }), "AMOUNT_INVALID");
  assert.equal(await reason({ type: "waiting", amount: 19_801 }), "AMOUNT_OVER_LIMIT", "不能超过这一单的结算价");
  const foreign = await completed();
  const foreignFile = await uploadReceipt(api, await tenantLogin(api, m.b.adminEmail), foreign.id);
  assert.equal((await submit(order.id, { type: "waiting", amount: 100, file_ids: [foreignFile] }, token)).status, 400, "别的单的照片不算这一单的凭证");
  const readonly = await addTenantUser(api, await tenantLogin(api, m.b.adminEmail), "ro@market-b.test", "readonly");
  assert.equal((await submit(order.id, { type: "waiting", amount: 100 }, readonly.token)).status, 403);
  const financeUser = await addTenantUser(api, await tenantLogin(api, m.b.adminEmail), "fin@market-b.test", "finance");
  assert.equal((await submit(order.id, { type: "extra_stop", amount: 1_000, file_ids: [file] }, financeUser.token)).status, 201, "财务也能交");

  // 渠道看到客人要付的（× 1.1），供应商看到自己报的；供应商的应答里没有客人的金额
  const sales = await salesGet(order.id);
  assert.deepEqual(sales.extra_charges.map((item: any) => [item.type, item.amount.amount, item.dispute_open]), [["waiting", "2200", true], ["extra_stop", "1100", true]]);
  const tenant = await ok(api.call("GET", `/tenant/v1/orders/${order.id}`, { token: await tenantLogin(api, m.b.adminEmail) }));
  assert.deepEqual(tenant.extra_charges.map((item: any) => item.amount.amount), ["2000", "1000"]);
  for (const forbidden of ["customer_amount", "sell", "markup_bp"]) assert.ok(!allKeys(tenant).has(forbidden), forbidden);
  // 按值比对：整段文本找子串会撞上编号、时间里碰巧出现的 2200
  assert.ok(!/[":\[,]2200(?:["},\]]|$)/.test(JSON.stringify(tenant)), "原文里没有客人的金额");
  assert.deepEqual((await platformCharges(order.id)).map((item) => item.customer_amount.amount), ["2200", "1100"]);
  const audit = await api.db.owner.query("select count(*)::int as n from audit_logs where resource = 'extra_charge' and action = 'submit' and tenant_id = $1", [m.b.tenantId]);
  assert.ok(audit.rows[0].n >= 2);

  api.clock.advance(completedAt + 24 * HOUR - api.clock.now().getTime());
  assert.equal((await submit(order.id, { type: "extra_addon", amount: 500, file_ids: [file] })).status, 201, "正好 24 小时还能交");
  api.clock.advance(1);
  const late = await submit(order.id, { type: "extra_addon", amount: 500, file_ids: [file] });
  assert.deepEqual([late.status, late.body.error.details.reason], [409, "SUBMIT_WINDOW_CLOSED"]);
});

test("48 小时异议期按毫秒：截止前 1 毫秒能提异议，到点那一刻不能；异议期内不扣款；到点后没异议、不用审核的自动扣款（保存的支付方式，客人付 × 1.1）；有异议的转审核、驳回不收", async () => {
  const order = await completed();
  const token = await tenantLogin(api, m.b.adminEmail);
  const file = await uploadReceipt(api, token, order.id);
  const first = (await ok(submit(order.id, { type: "waiting", amount: 2_000, file_ids: [file] }, token), 201)).extra_charge;
  const second = (await ok(submit(order.id, { type: "extra_stop", amount: 1_500, file_ids: [file] }, token), 201)).extra_charge;
  const third = (await ok(submit(order.id, { type: "extra_addon", amount: 500, file_ids: [file] }, token), 201)).extra_charge;
  const until = new Date(first.dispute_until).getTime();
  api.clock.advance(until - 5_000 - api.clock.now().getTime());
  const salesToken = await flow.token();
  api.clock.advance(until - 1 - api.clock.now().getTime());
  const disputed = await dispute(order.id, second.id, salesToken);
  assertMatchesOpenApi("POST", "/sales/v1/orders/{id}/extra-charges/{chargeId}/dispute", disputed);
  assert.deepEqual([disputed.status, disputed.body.extra_charge.status], [200, "disputed"]);
  assert.deepEqual((await dispute(order.id, second.id, salesToken)).body.extra_charge.status, "disputed", "再提一次返回现在的样子");
  await api.app.orderJobs.money();
  assert.equal(pay.chargesOf(order.id).length, 0, "异议期内不扣款");
  api.clock.advance(1);
  const closed = await dispute(order.id, third.id, salesToken);
  assert.deepEqual([closed.status, closed.body.error.code], [409, "DISPUTE_WINDOW_CLOSED"]);
  await api.app.orderJobs.money();
  assert.deepEqual(pay.chargesOf(order.id).map((charge) => [charge.amountMinor, charge.charge?.purpose, charge.paymentMethodId !== null]).sort(), [[2_200, "extra_charge", true], [550, "extra_charge", true]].sort());
  const items = await platformCharges(order.id);
  assert.deepEqual(items.map((item) => [item.type, item.status]), [["waiting", "charged"], ["extra_stop", "disputed"], ["extra_addon", "charged"]]);
  const early = await decide(order.id, third.id, { decision: "approve" });
  assert.equal(early.status, 409, "已经扣了的不能再审");
  assert.equal((await decide(order.id, second.id, { decision: "reject" }, m.staff.readonly.email)).status, 403);
  const rejected = await decide(order.id, second.id, { decision: "reject", note: "客人有停车场的监控截图" }, support.email);
  assertMatchesOpenApi("POST", "/platform/v1/orders/{id}/extra-charges/{chargeId}/decide", rejected);
  assert.deepEqual([rejected.status, rejected.body.extra_charge.status], [200, "rejected"]);
  assert.equal(pay.chargesOf(order.id).length, 2, "驳回的不扣");
  const detail = await ok(api.call("GET", `/platform/v1/orders/${order.id}`, { token: await platformLogin(api, m.staff.operations.email) }));
  assert.deepEqual(detail.payments.filter((payment: any) => payment.kind === "extra_charge").map((payment: any) => payment.status), ["succeeded", "succeeded"]);
  assert.equal(detail.order.status, "completed", "加收不改订单的状态");
});

test("要审核的：超过对外价 50%、没有凭证 → 异议期结束后待审核（异议期内平台不能先批）；部分通过按通过的金额扣", async () => {
  const order = await completed();
  const token = await tenantLogin(api, m.b.adminEmail);
  const big = (await ok(submit(order.id, { type: "waiting", amount: 10_000, file_ids: [await uploadReceipt(api, token, order.id)] }, token), 201)).extra_charge;
  const bare = (await ok(submit(order.id, { type: "extra_stop", amount: 1_000 }, token), 201)).extra_charge;
  assert.deepEqual([big.review_reasons, bare.review_reasons], [["OVER_THRESHOLD"], ["NO_EVIDENCE"]], "11,000 > 21,780 的 50%");
  const inWindow = await decide(order.id, big.id, { decision: "approve" });
  assert.deepEqual([inWindow.status, inWindow.body.error.code], [409, "EXTRA_CHARGE_STATE_INVALID"]);
  api.clock.advance(48 * HOUR);
  await api.app.orderJobs.money();
  assert.deepEqual((await platformCharges(order.id)).map((item) => item.status), ["review", "review"]);
  assert.equal(pay.chargesOf(order.id).length, 0);
  assert.equal((await decide(order.id, big.id, { decision: "approve", approved_amount: 10_001 })).status, 400, "部分通过不能比提交的多");
  const partial = await decide(order.id, big.id, { decision: "approve", approved_amount: 6_000, note: "按 60 分钟算" });
  assert.deepEqual([partial.status, partial.body.extra_charge.status, partial.body.extra_charge.approved_amount.amount], [200, "charged", "6000"]);
  assert.deepEqual(pay.chargesOf(order.id).map((charge) => charge.amountMinor), [applyBasisPoints(6_000, 1_000)]);
  const sales = await salesGet(order.id);
  assert.deepEqual(sales.extra_charges.find((item: any) => item.id === big.id).amount.amount, "6600", "客人看到的是通过的金额");
  const audit = await api.db.owner.query("select actor_email, after from audit_logs where resource = 'extra_charge' and action = 'decide' and resource_id = $1", [big.id]);
  assert.deepEqual(audit.rows.map((row) => [row.actor_email, row.after.approved_minor]), [[m.staff.operations.email, 6_000]]);
});

test("扣款失败：卡被拒 → 扣款失败（客服不能重试，财务能）；收款服务出错 → 10 分钟后自动重试；没有保存的支付方式的单直接记失败", async () => {
  const order = await completed();
  const token = await tenantLogin(api, m.b.adminEmail);
  const item = (await ok(submit(order.id, { type: "extra_stop", amount: 1_000 }, token), 201)).extra_charge;
  api.clock.advance(48 * HOUR);
  await api.app.orderJobs.money();
  pay.declineNextCharge("authentication_required", null);
  const declined = await decide(order.id, item.id, { decision: "approve" });
  assert.equal(declined.body.extra_charge.status, "charge_failed");
  assert.deepEqual((await platformCharges(order.id))[0].last_charge_error, { code: "authentication_required", decline_code: null, message: null });
  assert.match(api.logs(), /extra_charge\.charge_failed/);
  assert.equal((await api.call("POST", `/platform/v1/orders/${order.id}/extra-charges/${item.id}/retry`, { token: await platformLogin(api, support.email) })).status, 403);
  const retried = await api.call("POST", `/platform/v1/orders/${order.id}/extra-charges/${item.id}/retry`, { token: await platformLogin(api, finance.email) });
  assertMatchesOpenApi("POST", "/platform/v1/orders/{id}/extra-charges/{chargeId}/retry", retried);
  assert.deepEqual([retried.status, retried.body.extra_charge.status], [200, "charged"]);
  assert.equal(pay.chargesOf(order.id).length, 2, "重试用了一条新的收款记录（新的幂等键）");
  assert.equal((await api.call("POST", `/platform/v1/orders/${order.id}/extra-charges/${item.id}/retry`, { token: await platformLogin(api, finance.email) })).status, 409);

  const flaky = await completed();
  const flakyItem = (await ok(submit(flaky.id, { type: "waiting", amount: 1_000, file_ids: [await uploadReceipt(api, await tenantLogin(api, m.b.adminEmail), flaky.id)] }), 201)).extra_charge;
  api.clock.advance(48 * HOUR);
  pay.failNext("PAYMENT_PROVIDER_UNAVAILABLE");
  await api.app.orderJobs.money();
  assert.deepEqual([(await platformCharges(flaky.id))[0].status, (await platformCharges(flaky.id))[0].last_charge_error.code], ["approved", "PAYMENT_PROVIDER_UNAVAILABLE"]);
  api.clock.advance(5 * 60_000);
  await api.app.orderJobs.money();
  assert.equal((await platformCharges(flaky.id))[0].status, "approved", "还没到 10 分钟");
  api.clock.advance(5 * 60_000);
  await api.app.orderJobs.money();
  assert.deepEqual([(await platformCharges(flaky.id)).map((item) => item.id), (await platformCharges(flaky.id))[0].status, pay.chargesOf(flaky.id).length], [[flakyItem.id], "charged", 1]);
});

test("离线扣款的 Stripe 通知只更新那一笔收款，不碰订单；供应商在异议期内可以撤回，之后不能", async () => {
  const order = await completed();
  const token = await tenantLogin(api, m.b.adminEmail);
  const file = await uploadReceipt(api, token, order.id);
  const kept = (await ok(submit(order.id, { type: "waiting", amount: 1_000, file_ids: [file] }, token), 201)).extra_charge;
  const dropped = (await ok(submit(order.id, { type: "extra_stop", amount: 800, file_ids: [file] }, token), 201)).extra_charge;
  const withdrawn = await api.call("POST", `/tenant/v1/orders/${order.id}/extra-charges/${dropped.id}/withdraw`, { token });
  assertMatchesOpenApi("POST", "/tenant/v1/orders/{id}/extra-charges/{chargeId}/withdraw", withdrawn);
  assert.deepEqual([withdrawn.status, withdrawn.body.extra_charge.status], [200, "withdrawn"]);
  assert.deepEqual((await salesGet(order.id)).extra_charges.map((item: any) => item.id), [kept.id], "撤回的客人看不到");
  api.clock.advance(48 * HOUR);
  await api.app.orderJobs.money();
  assert.equal((await api.call("POST", `/tenant/v1/orders/${order.id}/extra-charges/${kept.id}/withdraw`, { token: await tenantLogin(api, m.b.adminEmail) })).body.error.code, "EXTRA_CHARGE_STATE_INVALID");
  const intent = pay.chargesOf(order.id)[0] as { id: string };
  const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
  const res = await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()));
  assert.deepEqual([res.status, res.body.result], [200, "applied"]);
  const detail = await ok(api.call("GET", `/platform/v1/orders/${order.id}`, { token: await platformLogin(api, m.staff.operations.email) }));
  assert.deepEqual([detail.order.status, detail.payments.map((payment: any) => payment.kind)], ["completed", ["order", "extra_charge"]]);
});

test("跨租户、渠道隔离：甲提交、上传、撤回不了乙的单；别的渠道提不了异议；数据库层面供应商只能提交「异议期内」的、只能把它撤回", async () => {
  const order = await completed();
  const b = await tenantLogin(api, m.b.adminEmail);
  const a = await tenantLogin(api, m.a.adminEmail);
  const item = (await ok(submit(order.id, { type: "waiting", amount: 1_000, file_ids: [await uploadReceipt(api, b, order.id)] }, b), 201)).extra_charge;
  assert.equal((await submit(order.id, { type: "waiting", amount: 1_000 }, a)).status, 404);
  const upload = await api.app.inject({ method: "POST", url: `/tenant/v1/orders/${order.id}/files?kind=receipt`, headers: { authorization: `Bearer ${a}`, "content-type": "image/jpeg" }, payload: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(10)]) });
  assert.equal(upload.statusCode, 404);
  assert.equal((await api.call("POST", `/tenant/v1/orders/${order.id}/extra-charges/${item.id}/withdraw`, { token: a })).status, 404);
  const other = (await ok(api.call("POST", "/sales/v1/oauth/token", { ip: "198.51.100.11", body: { grant_type: "client_credentials", client_id: otherChannel.clientId, client_secret: otherChannel.secret } }))).access_token;
  assert.equal((await dispute(order.id, item.id, other)).status, 404);
  const seen = await withTenantTx(api.db.pool, m.a.tenantId, (db) => db.query("select id from order_extra_charges where id = $1", [item.id]));
  assert.equal(seen.rowCount, 0, "甲在库里读不到乙的加收");
  await assert.rejects(withTenantTx(api.db.pool, m.b.tenantId, (db) => db.query("update order_extra_charges set status = 'charged', charged_at = now() where id = $1", [item.id])), deniedByDatabase, "乙不能自己把加收改成已扣");
  await assert.rejects(withTenantTx(api.db.pool, m.b.tenantId, (db) => db.query("update order_extra_charges set status = 'approved' where id = $1", [item.id])), deniedByDatabase);
  await assert.rejects(withTenantTx(api.db.pool, m.b.tenantId, (db) => db.query("update order_extra_charges set amount_minor = 5000 where id = $1", [item.id])), deniedByDatabase, "不能改金额");
  await assert.rejects(
    withTenantTx(api.db.pool, m.b.tenantId, (db) =>
      db.query(
        "insert into order_extra_charges (tenant_id, order_id, type, amount_minor, currency, status, submitted_at, submitted_by, dispute_until, created_at, updated_at) values ($1, $2, 'waiting', 100, 'JPY', 'approved', now(), $3, now() + interval '48 hours', now(), now())",
        [m.b.tenantId, order.id, m.b.adminId],
      ),
    ),
    deniedByDatabase,
    "不能直接插一条「审核通过」的",
  );
  for (const table of ["order_refunds", "order_change_sales", "order_payments"]) await assert.rejects(withTenantTx(api.db.pool, m.b.tenantId, (db) => db.query(`select * from ${table}`)), deniedByDatabase, table);
  await assert.rejects(withTenantTx(api.db.pool, m.b.tenantId, (db) => db.query("update orders set cancel_fee_bp = 0 where id = $1", [order.id])), deniedByDatabase, "供应商不能改取消的扣款");
});
