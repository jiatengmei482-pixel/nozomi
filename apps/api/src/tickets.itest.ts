/**
 * M4-02：工单与赔付表（ADR 0034），经真实接口、真实 PostgreSQL；收款服务用替身。
 * - 渠道、官网客人、客服、供应商、系统建工单；分派、对话和内部备注、征求租户意见（24 小时）、判定、关闭；
 * - 赔付按统一赔付表算（验收标准）：客人按对外价 × 比例（每笔至少 ¥500），供应商按结算价 × 同一比例，司机未到全额退款 + 报销（上限 1.5 倍）；
 *   超过复核阈值的判定走双人复核；赔付表本身可改（双人复核），之后的判定按新表；
 * - no-show 审核：通过 → 客人未出现；驳回 → 取消、全额退款、履约失败；申诉：7 天内一次、另一人复核、成立撤销处罚；
 * - 规则 2：供应商 A 读不到、改不了供应商 B 的工单；渠道读不到别的渠道的；规则 4：供应商看到的工单里没有对外价、加价比例、客人那边的赔付金额。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DEFAULT_COMPENSATION_TABLE, portionBasisPoints } from "@nozomi/domain";
import { withTenantTx } from "./db/context.ts";
import type { TenantFixture, TestApi } from "./testing/api.ts";
import { createTestApi } from "./testing/api.ts";
import { deniedByDatabase } from "./testing/db.ts";
import { assign, newDriver, newVehicle } from "./testing/dispatch.ts";
import { type Market, type Staff, addStaff, allKeys, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { completeOrder, platformLogin, tenantLogin, uploadReceipt } from "./testing/money.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let flow: SalesFlow;
let otherFlow: SalesFlow;
let support: Staff;
let ops2: Staff;
let finance: Staff;
let site: SiteApi;

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  flow = await salesFlow(api, m, pay);
  otherFlow = await salesFlow(api, m, pay);
  support = await addStaff(api, m.root, "cs@platform.test", "customer_service");
  ops2 = await addStaff(api, m.root, "ops2@platform.test", "operations");
  finance = await addStaff(api, m.root, "finance@platform.test", "finance");
  const siteChannel = (await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" })).id;
  site = await siteApi(api, (await salesCredentials(api, m, siteChannel)).clientId, pay);
});
after(async () => {
  await site?.close();
  await api.close();
});

const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const cs = (): Promise<string> => platformLogin(api, support.email);
const ops = (): Promise<string> => platformLogin(api, m.staff.operations.email);
const tenantToken = (who: TenantFixture): Promise<string> => tenantLogin(api, who.adminEmail);

/** 下单付款（乙 19,800 中标），用车在 `hours` 小时后。 */
async function paidOrder(hours = 3 * 24, on: SalesFlow = flow): Promise<{ id: string }> {
  return on.paidOrder({ serviceTime: iso(api.clock.now().getTime() + hours * HOUR) });
}

async function completedOrder(on: SalesFlow = flow): Promise<{ id: string; sell: number }> {
  const order = await paidOrder(3 * 24, on);
  await completeOrder(api, m, "b", order.id);
  return { id: order.id, sell: await sellOf(order.id) };
}

async function sellOf(orderId: string): Promise<number> {
  const detail = await ok(api.call("GET", `/platform/v1/orders/${orderId}`, { token: await ops() }));
  return Number(detail.order.sell.amount);
}

async function platformCall(method: "GET" | "POST", url: string, token: string, body?: unknown, template?: string): Promise<any> {
  const res = await api.call(method, url, { token, ...(body === undefined ? {} : { body }) });
  if (template !== undefined) assertMatchesOpenApi(method, template, res);
  return res;
}

async function channelComplaint(orderId: string, on: SalesFlow = flow, type = "complaint"): Promise<any> {
  const res = await api.call("POST", `/sales/v1/orders/${orderId}/tickets`, { token: await on.token(), body: { type, subject: "司机迟到", description: "司机晚到了 20 分钟", language: "zh" } });
  assertMatchesOpenApi("POST", "/sales/v1/orders/{id}/tickets", res);
  assert.equal(res.status, 201, res.text);
  return res.body.ticket;
}

async function decide(ticketId: string, body: unknown, token?: string): Promise<any> {
  const res = await platformCall("POST", `/platform/v1/tickets/${ticketId}/decide`, token ?? (await cs()), body, "/platform/v1/tickets/{id}/decide");
  return res;
}

async function tenantTicket(who: TenantFixture, ticketId: string): Promise<any> {
  const res = await api.call("GET", `/tenant/v1/tickets/${ticketId}`, { token: await tenantToken(who) });
  assertMatchesOpenApi("GET", "/tenant/v1/tickets/{id}", res);
  return res;
}

/** 供应商能看到的应答里不该出现的东西（规则 4）：对外价、加价比例、汇率、客人那边的赔付、内部备注、处理人。 */
const TENANT_FORBIDDEN = ["sell", "markup_bp", "fx", "fx_buffer_bp", "refund", "manual_payout", "compensation", "notes", "assignee_id", "decided_by", "approval_id", "channel"];

function assertTenantSafe(value: unknown, where: string): void {
  const keys = allKeys(value);
  for (const key of TENANT_FORBIDDEN) assert.ok(!keys.has(key), `${where} 里不该有 ${key}`);
}

async function performanceEvents(tenantId: string, orderId: string): Promise<string[]> {
  const rows = await api.db.owner.query<{ kind: string; failure_type: string | null; major: boolean }>("select kind, failure_type, major from tenant_performance_events where tenant_id = $1 and order_id = $2 order by kind", [tenantId, orderId]);
  return rows.rows.map((row) => (row.kind === "failure" ? `failure:${row.failure_type}` : row.major ? `${row.kind}:major` : row.kind));
}

test("赔付按统一表计算：渠道代客人投诉迟到 20 分钟，客服判定成立、责任在供应商——客人按对外价 10%（从收款里退），供应商按结算价 10% 记应扣款项，计入投诉率；渠道看到赔付，供应商看不到客人那边的金额", async () => {
  const order = await completedOrder();
  const ticket = await channelComplaint(order.id);
  assert.deepEqual([ticket.type, ticket.source, ticket.status, ticket.compensation], ["complaint", "guest", "open", null]);

  // 试算：带出金额，不写任何东西
  const quote = await platformCall("POST", `/platform/v1/tickets/${ticket.id}/compensation-quote`, await cs(), { scenario: "late_15_29", liable_party: "tenant" }, "/platform/v1/tickets/{id}/compensation-quote");
  assert.equal(quote.status, 200, quote.text);
  const expected = Math.max(portionBasisPoints(order.sell, 1000), DEFAULT_COMPENSATION_TABLE.minimumJpy);
  assert.equal(quote.body.quote.customer.compensation.amount, String(expected));
  assert.equal(quote.body.quote.customer.refund.amount, String(expected));
  assert.equal(quote.body.quote.tenant.total.amount, String(portionBasisPoints(19_800, 1000)));
  assert.equal(quote.body.quote.needs_review, false);
  assert.equal(pay.refundsOf(order.id).length, 0, "试算不退款");

  const decided = await decide(ticket.id, { outcome: "upheld", note: "司机迟到 20 分钟，属实", compensation: { scenario: "late_15_29", liable_party: "tenant" } });
  assert.equal(decided.status, 200, decided.text);
  assert.equal(decided.body.ticket.status, "decided");
  assert.equal(decided.body.ticket.liable_party, "tenant");
  assert.ok(decided.body.ticket.appeal_until);
  assert.equal(decided.body.compensation.compensation.amount, String(expected));
  assert.equal(decided.body.compensation.ratio_amount.amount, String(portionBasisPoints(order.sell, 1000)));
  assert.equal(decided.body.compensation.payout_status, "none");
  assert.equal(decided.body.compensation.tenant_total.amount, "1980");
  assert.deepEqual(decided.body.deductions.map((d: any) => [d.kind, d.amount.amount, d.status]), [["compensation", "1980", "pending"]]);
  // 退款：走收款服务，用途是赔付
  const refunds = pay.refundsOf(order.id);
  assert.deepEqual(refunds.map((refund) => refund.amountMinor), [expected]);
  const stored = (await api.db.owner.query("select purpose, ticket_id, status from order_refunds where order_id = $1", [order.id])).rows;
  assert.deepEqual(stored, [{ purpose: "compensation", ticket_id: ticket.id, status: "succeeded" }]);
  assert.deepEqual(await performanceEvents(m.b.tenantId, order.id), ["complaint"]);

  // 渠道：看到结论和客人这边的赔付
  const listed = await api.call("GET", `/sales/v1/orders/${order.id}/tickets`, { token: await flow.token() });
  assertMatchesOpenApi("GET", "/sales/v1/orders/{id}/tickets", listed);
  assert.equal(listed.body.items[0].outcome, "upheld");
  assert.equal(listed.body.items[0].compensation.refund.amount, String(expected));

  // 供应商：看得到工单、判定说明、自己的应扣款项；看不到客人那边的金额和加价比例
  const seen = await tenantTicket(m.b, ticket.id);
  assert.equal(seen.status, 200, seen.text);
  assert.equal(seen.body.ticket.decision_note, "司机迟到 20 分钟，属实");
  assert.deepEqual(seen.body.deductions.map((d: any) => [d.kind, d.amount.amount]), [["compensation", "1980"]]);
  assertTenantSafe(seen.body, "供应商的工单详情");
  assert.ok(!seen.text.includes(String(expected)) || String(expected) === "1980", "供应商的应答里不该出现客人的赔付金额");
  const deductions = await api.call("GET", "/tenant/v1/deductions", { token: await tenantToken(m.b) });
  assertMatchesOpenApi("GET", "/tenant/v1/deductions", deductions);
  assert.ok(deductions.body.items.some((d: any) => d.kind === "compensation" && d.amount.amount === "1980"));

  // 审计：建（渠道建的不写审计，记在工单本身）、判定
  const audit = (await api.db.owner.query("select action, actor_email from audit_logs where resource = 'ticket' and resource_id = $1 order by id", [ticket.id])).rows;
  assert.deepEqual(audit, [{ action: "decide", actor_email: support.email }]);
  // 判定后关闭
  const closed = await platformCall("POST", `/platform/v1/tickets/${ticket.id}/close`, await cs(), { note: "已赔付" }, "/platform/v1/tickets/{id}/close");
  assert.equal(closed.body.ticket.status, "closed");
});

test("每笔至少等值 ¥500：按比例不够的补到 500，供应商仍按结算价同一比例承担；责任在平台时供应商 0、不计投诉率", async () => {
  // 车况、态度投诉 10%：对外价 2 万多日元的 10% 已超过 500；把赔付表的比例改小（双人复核）验证补足
  const before = await api.call("GET", "/platform/v1/compensation-table", { token: await ops() });
  assertMatchesOpenApi("GET", "/platform/v1/compensation-table", before);
  assert.equal(before.body.compensation_table.version, 0);
  assert.deepEqual(before.body.compensation_table.scenarios.map((s: any) => [s.scenario, s.customer_bp]), Object.entries(DEFAULT_COMPENSATION_TABLE.customerBp));
  assert.equal(before.body.cancellation_policy.version, 0);

  const change = { customer_bp: { ...DEFAULT_COMPENSATION_TABLE.customerBp, service_complaint: 100 }, minimum_jpy: 500, reimbursement_cap_bp: 15_000, review_at_or_above_sell_bp: 5000, note: "测试补足" };
  const requested = await platformCall("POST", "/platform/v1/compensation-table/changes", await ops(), change, "/platform/v1/compensation-table/changes");
  assert.equal(requested.status, 202, requested.text);
  assert.equal(requested.body.approval.kind, "compensation_table.update");
  // 客服不能发起；司机未到的比例不能改；和现在一样的不进队列
  assert.equal((await api.call("POST", "/platform/v1/compensation-table/changes", { token: await cs(), body: change })).status, 403);
  const fixed = await api.call("POST", "/platform/v1/compensation-table/changes", { token: await ops(), body: { ...change, customer_bp: { ...change.customer_bp, driver_no_show: 5000 } } });
  assert.deepEqual([fixed.status, fixed.body.error.details.issues[0].reason], [400, "FIXED"]);
  // 发起人不能自己批；财务（compensation_table.review）批
  assert.equal((await api.call("POST", `/platform/v1/approvals/${requested.body.approval.id}/approve`, { token: await ops(), body: {} })).body.error.code, "APPROVAL_SELF_REVIEW");
  await ok(api.call("POST", `/platform/v1/approvals/${requested.body.approval.id}/approve`, { token: await platformLogin(api, finance.email), body: {} }));
  const after = await ok(api.call("GET", "/platform/v1/compensation-table", { token: await cs() }));
  assert.equal(after.compensation_table.version, 1);

  const order = await completedOrder();
  const ticket = await channelComplaint(order.id);
  const decided = await decide(ticket.id, { outcome: "upheld", note: "车内有异味", compensation: { scenario: "service_complaint", liable_party: "tenant" } });
  assert.equal(decided.status, 200, decided.text);
  assert.equal(decided.body.compensation.table_version, 1);
  assert.equal(decided.body.compensation.ratio_amount.amount, String(portionBasisPoints(order.sell, 100)));
  assert.equal(decided.body.compensation.compensation.amount, "500");
  assert.equal(decided.body.compensation.topped_up, true);
  assert.equal(decided.body.compensation.tenant_total.amount, String(portionBasisPoints(19_800, 100)));

  // 责任在平台：客人照样赔，供应商 0、没有应扣款项、不计投诉率
  const order2 = await completedOrder();
  const ticket2 = await channelComplaint(order2.id);
  const platformFault = await decide(ticket2.id, { outcome: "upheld", note: "平台派错了车型说明", compensation: { scenario: "not_delivered", liable_party: "platform" } });
  assert.equal(platformFault.status, 200, platformFault.text);
  assert.equal(platformFault.body.compensation.compensation.amount, String(portionBasisPoints(order2.sell, 2500)));
  assert.equal(platformFault.body.compensation.tenant_total.amount, "0");
  assert.deepEqual(platformFault.body.deductions, []);
  assert.equal(platformFault.body.ticket.appeal_until, null, "责任在平台，供应商不用申诉");
  assert.deepEqual(await performanceEvents(m.b.tenantId, order2.id), []);

  // 恢复默认表的比例，免得影响别的用例
  const back = await ok(api.call("POST", "/platform/v1/compensation-table/changes", { token: await ops(), body: { ...change, customer_bp: DEFAULT_COMPENSATION_TABLE.customerBp } }), 202);
  await ok(api.call("POST", `/platform/v1/approvals/${back.approval.id}/approve`, { token: await platformLogin(api, finance.email), body: {} }));
});

test("达到复核阈值（迟到 30 分钟以上赔 50%）：判定返回 202 待复核、还没执行；客服不能批，判定人自己也不能批；驳回退回处理中；重新判定后运营批准才执行，计重大迟到", async () => {
  const order = await completedOrder();
  const ticket = await channelComplaint(order.id);
  const body = { outcome: "upheld", note: "司机迟到 45 分钟", compensation: { scenario: "late_30_plus", liable_party: "tenant", major: true } };
  const first = await decide(ticket.id, body);
  assert.equal(first.status, 202, first.text);
  assert.equal(first.body.ticket.status, "pending_review");
  assert.equal(first.body.approval.kind, "ticket.decision");
  assert.equal(pay.refundsOf(order.id).length, 0, "复核之前不退款");
  assert.equal((await api.call("POST", `/platform/v1/approvals/${first.body.approval.id}/approve`, { token: await cs(), body: {} })).status, 403);
  // 复核中不能再判、不能关
  assert.equal((await decide(ticket.id, body)).body.error.code, "TICKET_STATE_INVALID");
  assert.equal((await api.call("POST", `/platform/v1/tickets/${ticket.id}/close`, { token: await cs(), body: { note: "x" } })).body.error.code, "TICKET_STATE_INVALID");
  // 驳回：退回处理中，可以重新判定
  await ok(api.call("POST", `/platform/v1/approvals/${first.body.approval.id}/reject`, { token: await ops(), body: { note: "先核实行车记录" } }));
  const returned = await ok(api.call("GET", `/platform/v1/tickets/${ticket.id}`, { token: await cs() }));
  assert.deepEqual([returned.ticket.status, returned.ticket.approval_id], ["in_progress", null]);

  // 运营自己判定，另一位运营批
  const second = await decide(ticket.id, body, await ops());
  assert.equal(second.status, 202, second.text);
  assert.equal((await api.call("POST", `/platform/v1/approvals/${second.body.approval.id}/approve`, { token: await ops(), body: {} })).body.error.code, "APPROVAL_SELF_REVIEW");
  await ok(api.call("POST", `/platform/v1/approvals/${second.body.approval.id}/approve`, { token: await platformLogin(api, ops2.email), body: {} }));
  const done = await ok(api.call("GET", `/platform/v1/tickets/${ticket.id}`, { token: await cs() }));
  assert.equal(done.ticket.status, "decided");
  assert.equal(done.ticket.decided_by, m.staff.operations.id, "判定人是发起的人");
  assert.equal(done.compensation.compensation.amount, String(portionBasisPoints(order.sell, 5000)));
  assert.deepEqual(pay.refundsOf(order.id).map((refund) => refund.amountMinor), [portionBasisPoints(order.sell, 5000)]);
  assert.deepEqual(done.deductions.map((d: any) => d.amount.amount), [String(portionBasisPoints(19_800, 5000))]);
  assert.deepEqual(await performanceEvents(m.b.tenantId, order.id), ["complaint:major", "failure:major_delay"]);
});

test("司机未到：客服建「履约失败」工单，判定时按供应商原因取消订单（全额退款），替代交通报销不超过对外价 1.5 倍、由财务另付后登记；供应商承担结算价 100% + 报销", async () => {
  const order = await paidOrder(3 * 24);
  const sell = await sellOf(order.id);
  const created = await platformCall("POST", "/platform/v1/tickets", await cs(), { type: "fulfilment_failure", order_id: order.id, subject: "司机没来", description: "客人等了 30 分钟司机没到，自己打车" }, "/platform/v1/tickets");
  assert.equal(created.status, 201, created.text);
  const ticketId = created.body.ticket.id;
  // 还没开始服务的单不适用「迟到」
  const late = await api.call("POST", `/platform/v1/tickets/${ticketId}/compensation-quote`, { token: await cs(), body: { scenario: "late_15_29", liable_party: "tenant" } });
  assert.deepEqual([late.status, late.body.error.code, late.body.error.details.reason], [409, "COMPENSATION_NOT_APPLICABLE", "NOT_SERVED"]);
  // 报销只有司机未到能填；降级必须填差价
  const wrong = await api.call("POST", `/platform/v1/tickets/${ticketId}/compensation-quote`, { token: await cs(), body: { scenario: "vehicle_downgrade", liable_party: "tenant" } });
  assert.equal(wrong.body.error.details.issues[0].reason, "DOWNGRADE_DIFFERENCE_REQUIRED");

  const claimed = sell * 2;
  const decided = await decide(ticketId, { outcome: "upheld", note: "司机未到，客人凭出租车票据报销", compensation: { scenario: "driver_no_show", liable_party: "tenant", reimbursement_amount: claimed } }, await ops());
  assert.equal(decided.status, 202, "报销达到对外价 50%，要复核");
  await ok(api.call("POST", `/platform/v1/approvals/${decided.body.approval.id}/approve`, { token: await platformLogin(api, ops2.email), body: {} }));
  const done = await ok(api.call("GET", `/platform/v1/tickets/${ticketId}`, { token: await cs() }));
  const cap = portionBasisPoints(sell, 15_000);
  assert.equal(done.compensation.order_cancelled, true);
  assert.equal(done.compensation.reimbursement.amount, String(cap));
  assert.equal(done.compensation.manual_payout.amount, String(cap));
  assert.equal(done.compensation.refund.amount, "0", "全额退款走取消");
  assert.equal(done.compensation.payout_status, "pending");
  assert.deepEqual(done.deductions.map((d: any) => [d.kind, d.amount.amount]), [["compensation", "19800"], ["reimbursement", String(cap)]]);
  const detail = await ok(api.call("GET", `/platform/v1/orders/${order.id}`, { token: await ops() }));
  assert.equal(detail.order.status, "cancelled");
  assert.equal(detail.order.cancel_reason, "SUPPLIER_FAULT");
  assert.deepEqual(pay.refundsOf(order.id).map((refund) => refund.amountMinor), [sell]);
  assert.deepEqual(await performanceEvents(m.b.tenantId, order.id), ["failure:driver_no_show"]);

  // 另付：客服不能登记，财务登记凭证号；登记过的不能再登记
  assert.equal((await api.call("POST", `/platform/v1/tickets/${ticketId}/payout`, { token: await cs(), body: { reference: "x" } })).status, 403);
  const paid = await platformCall("POST", `/platform/v1/tickets/${ticketId}/payout`, await platformLogin(api, finance.email), { reference: "BANK-20261026-001" }, "/platform/v1/tickets/{id}/payout");
  assert.deepEqual([paid.body.compensation.payout_status, paid.body.compensation.payout_reference], ["paid", "BANK-20261026-001"]);
  assert.equal((await api.call("POST", `/platform/v1/tickets/${ticketId}/payout`, { token: await platformLogin(api, finance.email), body: { reference: "again" } })).body.error.code, "PAYOUT_STATE_INVALID");
  // 订单已经取消：再判一张司机未到的不会再退（已经退完了）
  const again = await ok(api.call("POST", "/platform/v1/tickets", { token: await cs(), body: { type: "complaint", order_id: order.id, subject: "补充", description: "补充投诉" } }), 201);
  const quote = await ok(api.call("POST", `/platform/v1/tickets/${again.ticket.id}/compensation-quote`, { token: await cs(), body: { scenario: "driver_no_show", liable_party: "tenant" } }));
  assert.deepEqual([quote.quote.customer.refund.amount, quote.quote.order_will_be_cancelled], ["0", false]);
});

test("征求租户意见：24 小时内不能判定；供应商回复（只能引用这一单的照片）后变成处理中；内部备注供应商看不到；没回复的到期那一刻起可以判（超时视为认可）", async () => {
  const order = await completedOrder();
  const ticket = await channelComplaint(order.id);
  const token = await cs();
  const assigned = await platformCall("POST", `/platform/v1/tickets/${ticket.id}/assign`, token, {}, "/platform/v1/tickets/{id}/assign");
  assert.deepEqual([assigned.body.ticket.status, assigned.body.ticket.assignee_id], ["in_progress", support.id]);
  assert.ok(assigned.body.ticket.first_responded_at);
  await ok(platformCall("POST", `/platform/v1/tickets/${ticket.id}/messages`, token, { body: "内部：先查一下行车记录", internal: true }, "/platform/v1/tickets/{id}/messages"), 201);
  const asked = await platformCall("POST", `/platform/v1/tickets/${ticket.id}/request-reply`, token, { body: "客人反映司机迟到，请 24 小时内说明并上传证据" }, "/platform/v1/tickets/{id}/request-reply");
  assert.equal(asked.body.ticket.status, "awaiting_tenant");
  const due = new Date(asked.body.ticket.tenant_reply_due_at).getTime();
  assert.equal(due - api.clock.now().getTime(), DAY);
  const early = await decide(ticket.id, { outcome: "rejected", note: "x" });
  assert.equal(early.body.error.code, "TENANT_REPLY_PENDING");

  // 供应商看到问题、看不到内部备注
  const seen = await tenantTicket(m.b, ticket.id);
  assert.deepEqual(seen.body.messages.map((msg: any) => [msg.author_type, msg.author_id, msg.body]), [["platform_user", null, "客人反映司机迟到，请 24 小时内说明并上传证据"]]);
  assert.ok(!seen.text.includes("行车记录"));
  assertTenantSafe(seen.body, "供应商的工单详情");
  // 引用别的单的照片不行；引用这一单的票据可以
  const bToken = await tenantToken(m.b);
  const otherOrder = await completedOrder();
  const foreignFile = await uploadReceipt(api, bToken, otherOrder.id);
  const bad = await api.call("POST", `/tenant/v1/tickets/${ticket.id}/messages`, { token: bToken, body: { body: "看这张", file_ids: [foreignFile] } });
  assert.deepEqual([bad.status, bad.body.error.details.issues[0].reason], [400, "FILE_NOT_FOUND"]);
  const fileId = await uploadReceipt(api, bToken, order.id);
  const replied = await api.call("POST", `/tenant/v1/tickets/${ticket.id}/messages`, { token: bToken, body: { body: "司机遇到事故堵车，附截图", file_ids: [fileId] } });
  assertMatchesOpenApi("POST", "/tenant/v1/tickets/{id}/messages", replied);
  assert.equal(replied.status, 201, replied.text);
  assert.equal(replied.body.ticket.status, "in_progress");
  assert.deepEqual(replied.body.messages.at(-1).file_ids, [fileId]);
  const audit = (await api.db.owner.query("select action, tenant_id, actor_type from audit_logs where resource = 'ticket' and resource_id = $1 order by id", [ticket.id])).rows;
  assert.deepEqual(audit.map((row) => [row.action, row.tenant_id, row.actor_type]), [["assign", null, "platform_user"], ["note", null, "platform_user"], ["request_reply", null, "platform_user"], ["reply", m.b.tenantId, "tenant_user"]]);

  // 另一张：供应商一直不回复，到期那一刻起可以判
  const second = await channelComplaint(order.id);
  const asked2 = await ok(api.call("POST", `/platform/v1/tickets/${second.id}/request-reply`, { token: await cs(), body: { body: "请说明" } }));
  api.clock.advance(new Date(asked2.ticket.tenant_reply_due_at).getTime() - api.clock.now().getTime() - 1);
  assert.equal((await decide(second.id, { outcome: "rejected", note: "x" })).body.error.code, "TENANT_REPLY_PENDING");
  api.clock.advance(1);
  const decided = await decide(second.id, { outcome: "rejected", note: "供应商未回复，视为认可；但核实后投诉不成立" });
  assert.equal(decided.status, 200, decided.text);
  // 判定之后供应商不能再回复（有异议走申诉）
  assert.equal((await api.call("POST", `/tenant/v1/tickets/${second.id}/messages`, { token: await tenantToken(m.b), body: { body: "补充" } })).body.error.code, "TICKET_STATE_INVALID");
});

/** 把一张已到达的单做成「客人未出现（待审核）」：司机 H5 的 5 项证据已在 dispatch 的测试里覆盖，这里直接写库（测试数据）。 */
async function noShowClaimed(): Promise<string> {
  const order = await paidOrder(3 * 24);
  const who = { ...m.b, adminToken: await tenantToken(m.b) };
  await ok(assign(api, who, order.id, (await newDriver(api, who)).id, (await newVehicle(api, who, m.ids.biz7)).id));
  for (const type of ["departed", "arrived"]) await ok(api.call("POST", `/tenant/v1/orders/${order.id}/events`, { token: who.adminToken, body: { type } }));
  const link = (await api.db.owner.query<{ id: string }>("select id from driver_links where tenant_id = $1 and order_id = $2 order by created_at desc limit 1", [m.b.tenantId, order.id])).rows[0] as { id: string };
  const now = api.clock.now();
  await api.db.owner.query("insert into order_no_show_claims (tenant_id, order_id, submitted_at, checklist, free_wait_start, free_wait_end, status, link_id) values ($1, $2, $3, '[]'::jsonb, $4, $3, 'pending_review', $5)", [
    m.b.tenantId, order.id, now, new Date(now.getTime() - HOUR), link.id,
  ]);
  await api.db.owner.query("update orders set status = 'no_show_claimed' where tenant_id = $1 and id = $2", [m.b.tenantId, order.id]);
  return order.id;
}

test("no-show 审核：系统建工单（客服不能直接关）；通过 → 订单「客人未出现」，不退款；驳回 → 订单取消、全额退款、计履约失败（证据显示司机没到场的按司机未到）", async () => {
  const approvedOrder = await noShowClaimed();
  const rejectedOrder = await noShowClaimed();
  const sweep = await api.app.orderJobs.exceptions();
  assert.ok(sweep.noShowTickets >= 2);
  assert.equal((await api.app.orderJobs.exceptions()).noShowTickets, 0, "每个申请只建一张");
  const tickets = await ok(api.call("GET", `/platform/v1/tickets?type=no_show_review&order_id=${approvedOrder}`, { token: await cs() }));
  assert.equal(tickets.items.length, 1);
  const first = tickets.items[0];
  assert.deepEqual([first.source, first.created_by_type, first.priority, first.tenant.id], ["system", "system", "high", m.b.tenantId]);
  assert.equal((await api.call("POST", `/platform/v1/tickets/${first.id}/close`, { token: await cs(), body: { note: "x" } })).body.error.code, "DECISION_REQUIRED");
  assert.equal((await decide(first.id, { outcome: "upheld", note: "x" })).body.error.code, "VALIDATION_FAILED");
  const approved = await decide(first.id, { outcome: "approved", note: "举牌照片、联系记录齐全" });
  assert.equal(approved.status, 200, approved.text);
  const approvedDetail = await ok(api.call("GET", `/platform/v1/orders/${approvedOrder}`, { token: await ops() }));
  assert.equal(approvedDetail.order.status, "no_show");
  assert.equal(approvedDetail.records.no_show_claim.status, "approved");
  assert.equal(pay.refundsOf(approvedOrder).length, 0);
  assert.equal(approved.body.ticket.appeal_until, null);

  const second = (await ok(api.call("GET", `/platform/v1/tickets?type=no_show_review&order_id=${rejectedOrder}`, { token: await cs() }))).items[0];
  const rejected = await decide(second.id, { outcome: "rejected", note: "定位显示司机不在上车点", driver_absent: true });
  assert.equal(rejected.status, 200, rejected.text);
  const rejectedDetail = await ok(api.call("GET", `/platform/v1/orders/${rejectedOrder}`, { token: await ops() }));
  assert.deepEqual([rejectedDetail.order.status, rejectedDetail.order.cancel_reason, rejectedDetail.order.cancellation.tenant_share.amount], ["cancelled", "SUPPLIER_FAULT", "0"]);
  assert.deepEqual(pay.refundsOf(rejectedOrder).map((refund) => refund.amountMinor), [Number(rejectedDetail.order.sell.amount)]);
  assert.deepEqual(await performanceEvents(m.b.tenantId, rejectedOrder), ["failure:driver_no_show"]);
  assert.ok(rejected.body.ticket.appeal_until, "驳回对供应商不利，可以申诉");
});

test("申诉：只有对供应商不利的判定能申诉、判定后 7 天内、一次；判定人不能判申诉；成立后撤销处罚（应扣款项免除、投诉事件撤销），客人的退款不收回", async () => {
  const order = await completedOrder();
  const ticket = await channelComplaint(order.id);
  await ok(decide(ticket.id, { outcome: "upheld", note: "迟到属实", compensation: { scenario: "late_15_29", liable_party: "tenant" } }));
  const bToken = await tenantToken(m.b);
  // 别的单的工单、不存在的工单：404；对平台责任的判定：不能申诉
  const foreign = await api.call("POST", "/tenant/v1/tickets", { token: await tenantToken(m.a), body: { type: "tenant_appeal", parent_ticket_id: ticket.id, subject: "申诉", description: "x" } });
  assert.equal(foreign.status, 404);
  const appeal = await api.call("POST", "/tenant/v1/tickets", { token: bToken, body: { type: "tenant_appeal", parent_ticket_id: ticket.id, subject: "对迟到投诉申诉", description: "那天高速事故封路，有交通部门通告" } });
  assertMatchesOpenApi("POST", "/tenant/v1/tickets", appeal);
  assert.equal(appeal.status, 201, appeal.text);
  assert.deepEqual([appeal.body.ticket.type, appeal.body.ticket.source, appeal.body.ticket.parent_ticket_id], ["tenant_appeal", "tenant", ticket.id]);
  const twice = await api.call("POST", "/tenant/v1/tickets", { token: bToken, body: { type: "tenant_appeal", parent_ticket_id: ticket.id, subject: "再申诉", description: "x" } });
  assert.equal(twice.body.error.code, "ALREADY_APPEALED");
  // 判定原工单的客服不能判申诉；运营判成立
  const same = await decide(appeal.body.ticket.id, { outcome: "upheld", note: "x" });
  assert.equal(same.body.error.code, "APPEAL_SAME_REVIEWER");
  const upheld = await decide(appeal.body.ticket.id, { outcome: "upheld", note: "不可抗力，撤销处罚" }, await ops());
  assert.equal(upheld.status, 200, upheld.text);
  const parent = await ok(api.call("GET", `/platform/v1/tickets/${ticket.id}`, { token: await cs() }));
  assert.deepEqual(parent.deductions.map((d: any) => [d.status, d.waive_reason]), [["waived", `申诉成立（工单 ${appeal.body.ticket.ticket_no}）`]]);
  assert.equal(parent.appeal.outcome, "upheld");
  assert.deepEqual(await performanceEvents(m.b.tenantId, order.id), []);
  assert.equal(pay.refundsOf(order.id).length, 1, "客人的赔付不收回");

  // 7 天：正好 7 天还能申诉，多 1 毫秒不行
  const order2 = await completedOrder();
  const ticket2 = await channelComplaint(order2.id);
  const decided2 = await ok(decide(ticket2.id, { outcome: "upheld", note: "迟到", compensation: { scenario: "late_15_29", liable_party: "tenant" } }));
  api.clock.advance(new Date(decided2.ticket.appeal_until).getTime() - api.clock.now().getTime() + 1);
  const late = await api.call("POST", "/tenant/v1/tickets", { token: await tenantToken(m.b), body: { type: "tenant_appeal", parent_ticket_id: ticket2.id, subject: "申诉", description: "x" } });
  assert.equal(late.body.error.code, "APPEAL_WINDOW_CLOSED");
});

test("投诉时限：服务后 14 天内（正好 14 天还行）；渠道、客人每单最多 10 张；客服建工单的来源和类型要对得上；供应商登记失物要用自己的单", async () => {
  const order = await completedOrder();
  const completedAt = new Date((await ok(api.call("GET", `/platform/v1/orders/${order.id}`, { token: await ops() }))).order.fulfilment.completed_at).getTime();
  // 渠道令牌 2 小时过期：先拨到快到期限的时候换好令牌（换令牌会把时钟拨 1 秒），再拨到正好 14 天
  api.clock.advance(completedAt + 14 * DAY - 10_000 - api.clock.now().getTime());
  const channelToken = await flow.token();
  api.clock.advance(completedAt + 14 * DAY - api.clock.now().getTime());
  const onTime = await api.call("POST", `/sales/v1/orders/${order.id}/tickets`, { token: channelToken, body: { type: "complaint", subject: "迟到", description: "x" } });
  assert.equal(onTime.status, 201, onTime.text);
  api.clock.advance(1);
  const late = await api.call("POST", `/sales/v1/orders/${order.id}/tickets`, { token: channelToken, body: { type: "complaint", subject: "迟到", description: "x" } });
  assert.equal(late.body.error.code, "COMPLAINT_WINDOW_CLOSED");
  // 失物不受投诉时限限制；每单最多 10 张
  for (let i = 1; i < 10; i++) {
    // 渠道接口每秒 10 次的限流：每次隔 200 毫秒
    api.clock.advance(200);
    await channelComplaint(order.id, flow, "lost_and_found");
  }
  api.clock.advance(200);
  const eleventh = await api.call("POST", `/sales/v1/orders/${order.id}/tickets`, { token: await flow.token(), body: { type: "lost_and_found", subject: "伞", description: "x" } });
  assert.equal(eleventh.body.error.code, "TICKET_LIMIT_REACHED");
  // 客服代供应商登记只能是失物、其他；客服不能建申诉、no-show 审核；履约失败只能由客服、系统发起
  assert.equal((await api.call("POST", "/platform/v1/tickets", { token: await cs(), body: { type: "fulfilment_failure", order_id: order.id, source: "guest", subject: "x", description: "x" } })).body.error.code, "TICKET_TYPE_NOT_ALLOWED");
  const typeMismatch = await api.call("POST", "/platform/v1/tickets", { token: await cs(), body: { type: "complaint", order_id: order.id, source: "tenant", subject: "x", description: "x" } });
  assert.equal(typeMismatch.body.error.code, "TICKET_TYPE_NOT_ALLOWED");
  assert.equal((await api.call("POST", "/platform/v1/tickets", { token: await cs(), body: { type: "tenant_appeal", order_id: order.id, subject: "x", description: "x" } })).status, 400);
  // 指定一个没接过这一单的供应商
  const wrongTenant = await api.call("POST", "/platform/v1/tickets", { token: await cs(), body: { type: "other", order_id: order.id, tenant_id: m.a.tenantId, subject: "x", description: "x" } });
  assert.equal(wrongTenant.body.error.code, "TICKET_TENANT_INVALID");
  const lost = await api.call("POST", "/tenant/v1/tickets", { token: await tenantToken(m.b), body: { type: "lost_and_found", order_id: order.id, subject: "车上捡到手机", description: "已交调度保管" } });
  assert.equal(lost.status, 201, lost.text);
  assert.equal((await api.call("POST", "/tenant/v1/tickets", { token: await tenantToken(m.a), body: { type: "lost_and_found", order_id: order.id, subject: "x", description: "x" } })).status, 404);
  const resolved = await decide(lost.body.ticket.id, { outcome: "resolved", note: "已联系客人取回" });
  assert.equal(resolved.body.ticket.outcome, "resolved");
});

test("还没付款的单：客服建工单得到 409 ORDER_STATE_INVALID「付款完成后才能建工单」（不是「订单不存在」）；没付款就取消的单说明不能建；不存在的单仍是 404", async () => {
  const unpaid = await flow.unpaidOrder({ serviceTime: iso(api.clock.now().getTime() + 5 * DAY) });
  const body = (orderId: string) => ({ type: "other", order_id: orderId, subject: "客人来电", description: "问付款方式" });
  const refused = await platformCall("POST", "/platform/v1/tickets", await cs(), body(unpaid.id), "/platform/v1/tickets");
  assert.equal(refused.status, 409, refused.text);
  assert.equal(refused.body.error.code, "ORDER_STATE_INVALID");
  assert.deepEqual([refused.body.error.details.reason, refused.body.error.details.status], ["NOT_CONFIRMED", "pending_payment"]);
  assert.match(refused.body.error.message, /付款完成后才能建工单/);
  assert.equal((await api.db.owner.query("select 1 from tickets where order_id = $1", [unpaid.id])).rowCount, 0);

  await ok(api.call("POST", `/platform/v1/orders/${unpaid.id}/cancel`, { token: await ops(), body: { reason: "GUEST_REQUEST", note: "客人不要了" } }));
  const cancelled = await platformCall("POST", "/platform/v1/tickets", await cs(), body(unpaid.id), "/platform/v1/tickets");
  assert.equal(cancelled.status, 409, cancelled.text);
  assert.equal(cancelled.body.error.details.status, "cancelled");
  assert.match(cancelled.body.error.message, /没有付过款就取消了/);

  const missing = await platformCall("POST", "/platform/v1/tickets", await cs(), body(randomUUID()), "/platform/v1/tickets");
  assert.equal(missing.status, 404, missing.text);
});

test("每单最多 10 张工单的上限在并发下也不会超过：已有 8 张时同时提 5 张，只成功 2 张", async () => {
  const order = await completedOrder();
  for (let i = 0; i < 8; i++) {
    api.clock.advance(200);
    await channelComplaint(order.id, flow, "lost_and_found");
  }
  api.clock.advance(1_000);
  const token = await flow.token();
  const results = await Promise.all(Array.from({ length: 5 }, (_, i) => api.call("POST", `/sales/v1/orders/${order.id}/tickets`, { token, body: { type: "other", subject: `并发 ${i}`, description: "x" } })));
  assert.deepEqual(results.map((res) => res.status).sort(), [201, 201, 409, 409, 409]);
  assert.ok(results.filter((res) => res.status === 409).every((res) => res.body.error.code === "TICKET_LIMIT_REACHED"));
  assert.equal((await api.db.owner.query("select count(*)::int as n from tickets where order_id = $1", [order.id])).rows[0].n, 10);
});

test("规则 2：供应商 A 读不到、改不了供应商 B 的工单（列表、详情、回复、申诉都 404）；数据库层面租户读不到内部备注和赔付记录，写不了工单和对话", async () => {
  const order = await completedOrder();
  const ticket = await channelComplaint(order.id);
  await ok(api.call("POST", `/platform/v1/tickets/${ticket.id}/messages`, { token: await cs(), body: { body: "内部备注", internal: true } }), 201);
  const aToken = await tenantToken(m.a);
  const bToken = await tenantToken(m.b);
  const listA = await api.call("GET", "/tenant/v1/tickets", { token: aToken });
  assertMatchesOpenApi("GET", "/tenant/v1/tickets", listA);
  assert.ok(!listA.body.items.some((item: any) => item.id === ticket.id));
  const listB = await ok(api.call("GET", `/tenant/v1/tickets?order_id=${order.id}`, { token: bToken }));
  assert.ok(listB.items.some((item: any) => item.id === ticket.id));
  assertTenantSafe(listB, "供应商的工单列表");
  assert.equal((await api.call("GET", `/tenant/v1/tickets/${ticket.id}`, { token: aToken })).status, 404);
  assert.equal((await api.call("POST", `/tenant/v1/tickets/${ticket.id}/messages`, { token: aToken, body: { body: "我来回复" } })).status, 404);
  assert.equal((await api.db.owner.query("select count(*)::int as n from ticket_messages where ticket_id = $1", [ticket.id])).rows[0].n, 0, "A 的回复没有写进去");
  // 请求体里塞 tenant_id 没用（租户编号只来自令牌）
  const smuggled = await api.call("POST", "/tenant/v1/tickets", { token: aToken, body: { type: "other", order_id: order.id, tenant_id: m.b.tenantId, subject: "x", description: "x" } });
  assert.equal(smuggled.status, 400);

  // 数据库层面：租户事务里看不到别人的工单、看不到内部备注和赔付记录、不能写
  const visible = await withTenantTx(api.db.pool, m.a.tenantId, (db) => db.query("select id from tickets where id = $1", [ticket.id]));
  assert.equal(visible.rowCount, 0);
  for (const sql of ["select * from ticket_notes", "select * from ticket_compensations", "select * from order_exceptions", "select * from compensation_tables"]) {
    await assert.rejects(withTenantTx(api.db.pool, m.b.tenantId, (db) => db.query(sql)), (err: unknown) => deniedByDatabase(err), sql);
  }
  await assert.rejects(
    withTenantTx(api.db.pool, m.b.tenantId, (db) => db.query("update tickets set status = 'closed' where id = $1", [ticket.id])),
    (err: unknown) => deniedByDatabase(err),
  );
  await assert.rejects(
    withTenantTx(api.db.pool, m.b.tenantId, (db) => db.query("insert into ticket_messages (tenant_id, ticket_id, author_type, author_id, body, created_at) values ($1, $2, 'system', null, 'x', now())", [m.b.tenantId, ticket.id])),
    (err: unknown) => deniedByDatabase(err),
  );
});

test("规则 2（渠道）：别的渠道看不到、建不了这一单的工单；平台、租户令牌进不了销售端的工单接口", async () => {
  const order = await completedOrder();
  await channelComplaint(order.id);
  assert.equal((await api.call("GET", `/sales/v1/orders/${order.id}/tickets`, { token: await otherFlow.token() })).status, 404);
  assert.equal((await api.call("POST", `/sales/v1/orders/${order.id}/tickets`, { token: await otherFlow.token(), body: { type: "complaint", subject: "x", description: "x" } })).status, 404);
  assert.equal((await api.call("GET", `/sales/v1/orders/${order.id}/tickets`, { token: await ops() })).status, 401);
  assert.equal((await api.call("GET", `/sales/v1/orders/${randomUUID()}/tickets`, { token: await flow.token() })).status, 404);
});

test("官网的客人凭查看链接提投诉、看到结论和赔付；没有链接 401", async () => {
  api.clock.advance(1_000);
  const quoted = await site.call("POST", "/site/v1/quotes", { body: { city_id: m.ids.tokyo, airport_id: m.ids.narita, direction: "pickup", address: { lng: 139.7, lat: 35.6 }, service_local: "2026-12-20T10:00", passengers: 2, luggage: 1 } });
  assert.equal(quoted.status, 200, quoted.text);
  const quote = quoted.body.quotes.find((q: any) => q.vehicle_group.id === m.ids.biz7);
  api.clock.advance(1_000);
  const placed = await site.call("POST", "/site/v1/orders", { headers: { "idempotency-key": randomUUID() }, body: { quote_id: quote.quote_id, passenger: { name: "李四", phone: "+81 90-0000-1111", email: "guest@example.com" }, flight_no: "NH 211", dropoff_address: "东京站", save_payment_method: true } });
  assert.equal(placed.status, 201, placed.text);
  const orderId = placed.body.order.id;
  const intent = pay.intentOf(orderId);
  assert.ok(intent);
  pay.pay(intent.id);
  const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
  assert.equal((await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()))).status, 200);
  const token = placed.body.link.token as string;
  assert.equal((await site.call("POST", "/site/v1/order/tickets", { body: { type: "complaint", subject: "x", description: "x" } })).status, 401);
  const created = await site.call("POST", "/site/v1/order/tickets", { token, body: { type: "order_change", subject: "想改航班号", description: "航班改成 NH 213" } });
  assertMatchesOpenApi("POST", "/site/v1/order/tickets", created);
  assert.equal(created.status, 201, created.text);
  assert.equal(created.body.ticket.source, "guest");
  const listed = await site.call("GET", "/site/v1/order/tickets", { token });
  assertMatchesOpenApi("GET", "/site/v1/order/tickets", listed);
  assert.deepEqual(listed.body.items.map((item: any) => item.id), [created.body.ticket.id]);
  const row = (await api.db.owner.query("select created_by_type, source from tickets where id = $1", [created.body.ticket.id])).rows[0];
  assert.deepEqual(row, { created_by_type: "guest", source: "guest" });
});

test("给客人的回复（M4-03）：客服对客人、渠道提的工单回复客人；渠道和官网看得到（不带员工），供应商看不到；内部备注客人看不到；不是客人提的工单不能回复客人；两个开关不能同时开", async () => {
  const order = await completedOrder();
  const ticket = await channelComplaint(order.id);
  const token = await cs();
  const replied = await platformCall("POST", `/platform/v1/tickets/${ticket.id}/messages`, token, { body: "我们正在核实司机的到达时间，24 小时内答复您。", to_guest: true }, "/platform/v1/tickets/{id}/messages");
  assert.equal(replied.status, 201, replied.text);
  await platformCall("POST", `/platform/v1/tickets/${ticket.id}/messages`, token, { body: "内部：客人第二次投诉", internal: true });
  const notes = replied.body.notes as { to_guest: boolean; body: string }[];
  assert.deepEqual(notes.map((note) => note.to_guest), [true]);
  const listed = await api.call("GET", `/sales/v1/orders/${order.id}/tickets`, { token: await flow.token() });
  assertMatchesOpenApi("GET", "/sales/v1/orders/{id}/tickets", listed);
  const item = listed.body.items.find((entry: any) => entry.id === ticket.id);
  assert.deepEqual(item.replies.map((reply: any) => reply.body), ["我们正在核实司机的到达时间，24 小时内答复您。"]);
  assert.deepEqual(Object.keys(item.replies[0]).sort(), ["body", "created_at"]);
  const tenantView = await tenantTicket(m.b, ticket.id);
  assert.equal(tenantView.status, 200, tenantView.text);
  assert.doesNotMatch(JSON.stringify(tenantView.body), /24 小时内答复您|客人第二次投诉/);
  assert.equal((await platformCall("POST", `/platform/v1/tickets/${ticket.id}/messages`, token, { body: "x", internal: true, to_guest: true })).status, 400);
  const own = await platformCall("POST", "/platform/v1/tickets", token, { type: "other", order_id: order.id, subject: "客服自己发现的", description: "x" });
  assert.equal(own.status, 201, own.text);
  const refused = await platformCall("POST", `/platform/v1/tickets/${own.body.ticket.id}/messages`, token, { body: "x", to_guest: true });
  assert.equal(refused.status, 400);
  assert.equal((await api.db.owner.query("select count(*)::int as n from audit_logs where resource = 'ticket' and resource_id = $1 and action = 'reply' and after ->> 'to_guest' = 'true'", [ticket.id])).rows[0].n, 1);
});
