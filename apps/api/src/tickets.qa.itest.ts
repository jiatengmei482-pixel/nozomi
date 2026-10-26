/**
 * M4-02 测试角色：工单与赔付（ADR 0034），经真实接口、真实 PostgreSQL；收款服务用替身。补开发测试没覆盖的边界：
 * - 赔付按统一表计算（验收标准）：试算、判定、复核批准三处结果和独立重算的一致，数据库里的赔付记录、应扣款项、退款也一样；
 * - 主管复核阈值（对外价 50%）正好等于 / 差 1；复核时数据变了 → APPROVAL_STALE；同时批准、同时判定只执行一次；
 * - 状态流转的非法跳转；申诉 7 天边界、只能一次（并发）、判定人和复核人都不能审（判、关）申诉；no-show 审核两种结论的影响；
 * - 规则 2 / 规则 4：供应商、渠道、官网客人各自只看到自己的；应答按字段名和值逐个扫描（不是整段找子串）；
 * - 权限：没有对应操作的角色 403。
 * 数据全部在测试里构造，测试结束随临时数据库删除（规则 1）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withTenantTx } from "./db/context.ts";
import type { TenantFixture, TestApi } from "./testing/api.ts";
import { addTenantUser, createTestApi } from "./testing/api.ts";
import { deniedByDatabase } from "./testing/db.ts";
import { assign, newDriver, newVehicle } from "./testing/dispatch.ts";
import { type Market, type Staff, addStaff, allKeys, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { completeOrder, platformLogin, tenantLogin } from "./testing/money.ts";
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
let support2: Staff;
let ops2: Staff;
let finance: Staff;
let site: SiteApi;

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  flow = await salesFlow(api, m, pay);
  otherFlow = await salesFlow(api, m, pay);
  support = await addStaff(api, m.root, "qa-cs@platform.test", "customer_service");
  support2 = await addStaff(api, m.root, "qa-cs2@platform.test", "customer_service");
  ops2 = await addStaff(api, m.root, "qa-ops2@platform.test", "operations");
  finance = await addStaff(api, m.root, "qa-finance@platform.test", "finance");
  const siteChannel = (await newChannel(api, m.staff.cm1.token, { name: "QA 官网" })).id;
  site = await siteApi(api, (await salesCredentials(api, m, siteChannel)).clientId, pay);
});
after(async () => {
  await site?.close();
  await api.close();
});

const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const login = (who: Staff): Promise<string> => platformLogin(api, who.email);
const cs = (): Promise<string> => login(support);
const ops = (): Promise<string> => platformLogin(api, m.staff.operations.email);
const tenantToken = (who: TenantFixture): Promise<string> => tenantLogin(api, who.adminEmail);

// ---- 独立的金额重算（同币种日元；不调用 @nozomi/domain） ----

const SPEC_BP: Record<string, bigint> = { late_15_29: 1000n, late_30_plus: 5000n, driver_no_show: 10_000n, vehicle_downgrade: 2000n, no_signboard: 1000n, not_delivered: 2500n, service_complaint: 1000n };
const half = (n: bigint, d: bigint): number => Number((2n * n + d) / (2n * d));

interface OrderMoney {
  id: string;
  sell: number;
  settlement: number;
  markupBp: number;
}

async function moneyOf(orderId: string): Promise<OrderMoney> {
  const row = (await api.db.owner.query("select s.sell_minor, s.markup_bp, s.currency, o.settlement_minor from order_sales s join orders o on o.id = s.order_id and o.tenant_id = s.supplier_tenant_id where s.order_id = $1", [orderId])).rows[0];
  assert.equal(row.currency, "JPY");
  return { id: orderId, sell: Number(row.sell_minor), settlement: Number(row.settlement_minor), markupBp: Number(row.markup_bp) };
}

function expected(order: OrderMoney, scenario: string, liable: "tenant" | "platform", diff = 0, refundable = order.sell) {
  const bp = SPEC_BP[scenario] as bigint;
  const ratio = half(BigInt(order.sell) * bp, 10_000n);
  const downgrade = diff === 0 ? 0 : half(BigInt(diff) * BigInt(10_000 + order.markupBp), 10_000n);
  const compensation = Math.max(ratio + downgrade, 500);
  const refund = Math.min(compensation, refundable);
  const tenantRatio = liable === "tenant" ? half(BigInt(order.settlement) * bp, 10_000n) : 0;
  return { ratio, downgrade, compensation, refund, manual: compensation - refund, tenantTotal: liable === "tenant" ? tenantRatio + diff : 0, needsReview: compensation * 2 >= order.sell };
}

// ---- 搭建 ----

async function paidOrder(hours = 3 * 24, on: SalesFlow = flow): Promise<string> {
  return (await on.paidOrder({ serviceTime: iso(api.clock.now().getTime() + hours * HOUR) })).id;
}

async function completedOrder(on: SalesFlow = flow): Promise<OrderMoney> {
  const id = await paidOrder(3 * 24, on);
  await completeOrder(api, m, "b", id);
  return moneyOf(id);
}

async function channelComplaint(orderId: string, on: SalesFlow = flow): Promise<any> {
  return (await ok(api.call("POST", `/sales/v1/orders/${orderId}/tickets`, { token: await on.token(), body: { type: "complaint", subject: "投诉", description: "司机服务有问题" } }), 201)).ticket;
}

async function platformTicket(orderId: string, type = "fulfilment_failure"): Promise<string> {
  return (await ok(api.call("POST", "/platform/v1/tickets", { token: await cs(), body: { type, order_id: orderId, subject: "客服登记", description: "客服登记的工单" } }), 201)).ticket.id;
}

function decide(ticketId: string, body: unknown, token: string): Promise<any> {
  return api.call("POST", `/platform/v1/tickets/${ticketId}/decide`, { token, body });
}

async function approve(approvalId: string, token: string): Promise<any> {
  return api.call("POST", `/platform/v1/approvals/${approvalId}/approve`, { token, body: {} });
}

async function compensationRow(ticketId: string): Promise<any> {
  return (await api.db.owner.query("select * from ticket_compensations where ticket_id = $1", [ticketId])).rows[0];
}

async function deductionsOf(ticketId: string): Promise<[string, number, string][]> {
  const rows = (await api.db.owner.query("select kind, amount_minor, status from tenant_deductions where ticket_id = $1 order by kind", [ticketId])).rows;
  return rows.map((row) => [row.kind, Number(row.amount_minor), row.status]);
}

async function performanceEvents(orderId: string): Promise<string[]> {
  const rows = (await api.db.owner.query<{ kind: string; failure_type: string | null }>("select kind, failure_type from tenant_performance_events where tenant_id = $1 and order_id = $2 order by kind, failure_type", [m.b.tenantId, orderId])).rows;
  return rows.map((row) => (row.kind === "failure" ? `failure:${row.failure_type}` : row.kind));
}

/** 应答里的全部「叶子值」（字符串、数字、布尔），逐个比对用。 */
function leafValues(value: unknown, into: unknown[] = []): unknown[] {
  if (Array.isArray(value)) for (const item of value) leafValues(item, into);
  else if (typeof value === "object" && value !== null) for (const item of Object.values(value)) leafValues(item, into);
  else into.push(value);
  return into;
}

function assertNoValue(body: unknown, forbidden: Record<string, string | number>, where: string): void {
  const leaves = leafValues(body).map((leaf) => String(leaf));
  for (const [label, value] of Object.entries(forbidden)) assert.ok(!leaves.includes(String(value)), `${where} 里出现了 ${label}（${value}）`);
}

/** 把一张已到达的单做成「客人未出现（待审核）」（司机 H5 的证据核对在 dispatch 的测试里，这里直接写库，测试数据）。 */
async function noShowClaimed(): Promise<string> {
  const orderId = await paidOrder(3 * 24);
  const who = { ...m.b, adminToken: await tenantToken(m.b) };
  await ok(assign(api, who, orderId, (await newDriver(api, who)).id, (await newVehicle(api, who, m.ids.biz7)).id));
  for (const type of ["departed", "arrived"]) await ok(api.call("POST", `/tenant/v1/orders/${orderId}/events`, { token: who.adminToken, body: { type } }));
  const link = (await api.db.owner.query<{ id: string }>("select id from driver_links where tenant_id = $1 and order_id = $2 order by created_at desc limit 1", [m.b.tenantId, orderId])).rows[0] as { id: string };
  const now = api.clock.now();
  await api.db.owner.query("insert into order_no_show_claims (tenant_id, order_id, submitted_at, checklist, free_wait_start, free_wait_end, status, link_id) values ($1, $2, $3, '[]'::jsonb, $4, $3, 'pending_review', $5)", [
    m.b.tenantId, orderId, now, new Date(now.getTime() - HOUR), link.id,
  ]);
  await api.db.owner.query("update orders set status = 'no_show_claimed' where tenant_id = $1 and id = $2", [m.b.tenantId, orderId]);
  return orderId;
}

async function noShowTicketOf(orderId: string): Promise<string> {
  await api.app.orderJobs.exceptions();
  const listed = await ok(api.call("GET", `/platform/v1/tickets?type=no_show_review&order_id=${orderId}`, { token: await cs() }));
  assert.equal(listed.items.length, 1);
  return listed.items[0].id;
}

// ---- 赔付按统一表计算 ----

test("赔付按统一表计算：6 种（情形 × 责任方）逐一试算、判定，金额和独立重算的一致；试算 = 判定应答 = 数据库里的赔付记录 = 应扣款项 = 实际退款", async () => {
  const cases: { scenario: string; liable: "tenant" | "platform"; diff?: number }[] = [
    { scenario: "late_15_29", liable: "tenant" },
    { scenario: "no_signboard", liable: "tenant" },
    { scenario: "not_delivered", liable: "tenant" },
    { scenario: "service_complaint", liable: "tenant" },
    { scenario: "vehicle_downgrade", liable: "tenant", diff: 3001 },
    { scenario: "not_delivered", liable: "platform" },
  ];
  for (const c of cases) {
    const label = `${c.scenario}/${c.liable}`;
    const order = await completedOrder();
    const ticket = await channelComplaint(order.id);
    const want = expected(order, c.scenario, c.liable, c.diff ?? 0);
    assert.equal(want.needsReview, false, `${label}：这几种不到复核阈值`);
    const body = { scenario: c.scenario, liable_party: c.liable, ...(c.diff === undefined ? {} : { downgrade_settlement_difference: c.diff }) };

    const quote = (await ok(api.call("POST", `/platform/v1/tickets/${ticket.id}/compensation-quote`, { token: await cs(), body }))).quote;
    assert.deepEqual(
      [quote.customer.ratio_amount.amount, quote.customer.downgrade_difference.amount, quote.customer.compensation.amount, quote.customer.refund.amount, quote.customer.manual_payout.amount, quote.tenant.total.amount, quote.needs_review],
      [String(want.ratio), String(want.downgrade), String(want.compensation), String(want.refund), String(want.manual), String(want.tenantTotal), false],
      `${label}：试算`,
    );

    const decided = await decide(ticket.id, { outcome: "upheld", note: "核实属实", compensation: body }, await cs());
    assert.equal(decided.status, 200, `${label}：${decided.text}`);
    const comp = decided.body.compensation;
    assert.deepEqual(
      [comp.ratio_amount.amount, comp.downgrade_difference.amount, comp.compensation.amount, comp.refund.amount, comp.manual_payout.amount, comp.tenant_total.amount, comp.sell.amount, comp.table_version, comp.customer_bp],
      [quote.customer.ratio_amount.amount, quote.customer.downgrade_difference.amount, quote.customer.compensation.amount, quote.customer.refund.amount, quote.customer.manual_payout.amount, quote.tenant.total.amount, String(order.sell), 0, Number(SPEC_BP[c.scenario])],
      `${label}：判定和试算一致`,
    );
    const row = await compensationRow(ticket.id);
    assert.deepEqual(
      [Number(row.compensation_minor), Number(row.refund_minor), Number(row.manual_payout_minor), Number(row.tenant_total_minor), Number(row.sell_minor), row.payout_status, row.liable_party],
      [want.compensation, want.refund, want.manual, want.tenantTotal, order.sell, want.manual === 0 ? "none" : "pending", c.liable],
      `${label}：数据库`,
    );
    const deductions = await deductionsOf(ticket.id);
    assert.deepEqual(deductions, c.liable === "tenant" ? [["compensation", want.tenantTotal, "pending"]] : [], `${label}：应扣款项`);
    assert.deepEqual(pay.refundsOf(order.id).map((refund) => refund.amountMinor), [want.refund], `${label}：实际退款`);
    assert.deepEqual(await performanceEvents(order.id), c.liable === "tenant" ? ["complaint"] : [], `${label}：评分事件`);
  }
});

test("赔付按统一表计算（复核路径）：迟到 30 分钟以上，试算、发起复核时记下的金额、批准后执行的金额三处一致；判定人记为发起人", async () => {
  const order = await completedOrder();
  const ticket = await channelComplaint(order.id);
  const want = expected(order, "late_30_plus", "tenant");
  assert.equal(want.needsReview, true);
  const body = { scenario: "late_30_plus", liable_party: "tenant", major: true };
  const quote = (await ok(api.call("POST", `/platform/v1/tickets/${ticket.id}/compensation-quote`, { token: await cs(), body }))).quote;
  assert.deepEqual([quote.customer.compensation.amount, quote.tenant.total.amount, quote.needs_review], [String(want.compensation), String(want.tenantTotal), true]);
  const pending = await decide(ticket.id, { outcome: "upheld", note: "迟到 40 分钟", compensation: body }, await cs());
  assert.equal(pending.status, 202, pending.text);
  assert.equal(pending.body.approval.payload.customer_compensation_minor, want.compensation);
  assert.equal(pending.body.approval.payload.customer_refund_minor, want.refund);
  assert.equal(await compensationRow(ticket.id), undefined, "复核前不写赔付记录");
  assert.deepEqual(await deductionsOf(ticket.id), []);
  assert.equal((await approve(pending.body.approval.id, await ops())).status, 200);
  const done = await ok(api.call("GET", `/platform/v1/tickets/${ticket.id}`, { token: await cs() }));
  assert.deepEqual([done.ticket.status, done.ticket.decided_by, done.compensation.compensation.amount, done.compensation.tenant_total.amount], ["decided", support.id, String(want.compensation), String(want.tenantTotal)]);
  assert.deepEqual(pay.refundsOf(order.id).map((refund) => refund.amountMinor), [want.refund]);
  assert.deepEqual(await deductionsOf(ticket.id), [["compensation", want.tenantTotal, "pending"]]);
});

test("主管复核阈值：司机未到的报销正好等于对外价 50%（向上取整到 1 日元）要复核（202），少 1 日元直接执行（200）；试算的 needs_review 一致", async () => {
  for (const [delta, status] of [[0, 202], [-1, 200]] as const) {
    const orderId = await paidOrder(3 * 24);
    const order = await moneyOf(orderId);
    const ticketId = await platformTicket(orderId);
    const claimed = Math.ceil(order.sell / 2) + delta;
    const body = { scenario: "driver_no_show", liable_party: "tenant", reimbursement_amount: claimed };
    const quote = (await ok(api.call("POST", `/platform/v1/tickets/${ticketId}/compensation-quote`, { token: await cs(), body }))).quote;
    assert.deepEqual([quote.needs_review, quote.customer.reimbursement.amount, quote.order_will_be_cancelled], [status === 202, String(claimed), true], `报销 ${claimed} / 对外价 ${order.sell}`);
    const decided = await decide(ticketId, { outcome: "upheld", note: "司机未到", compensation: body }, await cs());
    assert.equal(decided.status, status, `报销 ${claimed} / 对外价 ${order.sell}：${decided.text}`);
    if (status === 200) {
      // 直接执行：订单按供应商原因取消，全额退款；报销另付；租户承担结算价 100% + 报销
      assert.equal(decided.body.compensation.manual_payout.amount, String(claimed));
      assert.deepEqual(await deductionsOf(ticketId), [["compensation", order.settlement, "pending"], ["reimbursement", claimed, "pending"]]);
      assert.deepEqual(pay.refundsOf(orderId).map((refund) => refund.amountMinor), [order.sell]);
    } else {
      assert.equal(pay.refundsOf(orderId).length, 0, "复核前不取消、不退款");
      const detail = await ok(api.call("GET", `/platform/v1/orders/${orderId}`, { token: await ops() }));
      assert.notEqual(detail.order.status, "cancelled");
    }
  }
});

test("复核期间这一单的收款变了：批准时按现在的数据算出的退款和发起时不同 → APPROVAL_STALE，工单仍在复核中、没有多退钱", async () => {
  const order = await completedOrder();
  const body = { scenario: "late_30_plus", liable_party: "tenant" };
  // 三张投诉各要赔 50%：前两张批准后这一单已经退完，第三张发起时算的退款对不上了
  const approvals: string[] = [];
  const tickets: string[] = [];
  for (let i = 0; i < 3; i++) {
    const ticket = await channelComplaint(order.id);
    const pending = await decide(ticket.id, { outcome: "upheld", note: `第 ${i + 1} 张`, compensation: body }, await cs());
    assert.equal(pending.status, 202, pending.text);
    approvals.push(pending.body.approval.id);
    tickets.push(ticket.id);
  }
  const reviewer = await ops();
  assert.equal((await approve(approvals[0] as string, reviewer)).status, 200);
  assert.equal((await approve(approvals[1] as string, reviewer)).status, 200);
  const refundedBefore = pay.refundsOf(order.id).reduce((sum, refund) => sum + refund.amountMinor, 0);
  assert.ok(refundedBefore <= order.sell);
  const stale = await approve(approvals[2] as string, reviewer);
  assert.deepEqual([stale.status, stale.body.error.code], [409, "APPROVAL_STALE"], stale.text);
  const third = await ok(api.call("GET", `/platform/v1/tickets/${tickets[2]}`, { token: await cs() }));
  assert.equal(third.ticket.status, "pending_review");
  assert.equal(third.compensation, null);
  assert.equal(pay.refundsOf(order.id).reduce((sum, refund) => sum + refund.amountMinor, 0), refundedBefore, "没有多退");
  // 驳回后退回处理中，可以按现在的情况重新判定：这一次能退的已经不够，按表应赔的退不回去的部分转为另付
  await ok(api.call("POST", `/platform/v1/approvals/${approvals[2]}/reject`, { token: reviewer, body: { note: "已过时" } }));
  const again = await decide(tickets[2] as string, { outcome: "upheld", note: "重新判定", compensation: body }, await cs());
  assert.equal(again.status, 202, again.text);
  const refundable = order.sell - refundedBefore;
  assert.equal(again.body.approval.payload.customer_refund_minor, Math.min(refundable, expected(order, "late_30_plus", "tenant").compensation));
});

test("重复提交：同一张工单两位客服同时判定，只执行一次（一笔退款、一条应扣款项、一次评分事件），另一位 409", async () => {
  const order = await completedOrder();
  const ticket = await channelComplaint(order.id);
  const body = { outcome: "upheld", note: "同时判定", compensation: { scenario: "no_signboard", liable_party: "tenant" } };
  const [first, second] = await Promise.all([decide(ticket.id, body, await cs()), decide(ticket.id, body, await login(support2))]);
  assert.deepEqual([first.status, second.status].sort(), [200, 409], `${first.text} / ${second.text}`);
  const loser = first.status === 409 ? first : second;
  assert.ok(["TICKET_STATE_INVALID", "TICKET_CHANGED"].includes(loser.body.error.code), loser.text);
  assert.equal(pay.refundsOf(order.id).length, 1);
  assert.equal((await deductionsOf(ticket.id)).length, 1);
  assert.deepEqual(await performanceEvents(order.id), ["complaint"]);
});

test("重复提交：两位复核人同时批准同一条判定复核，只执行一次", async () => {
  const order = await completedOrder();
  const ticket = await channelComplaint(order.id);
  const pending = await decide(ticket.id, { outcome: "upheld", note: "迟到 35 分钟", compensation: { scenario: "late_30_plus", liable_party: "tenant" } }, await cs());
  assert.equal(pending.status, 202, pending.text);
  const results = await Promise.all([approve(pending.body.approval.id, await ops()), approve(pending.body.approval.id, await login(ops2))]);
  assert.equal(results.filter((res) => res.status === 200).length, 1, results.map((res) => res.text).join(" / "));
  assert.equal(pay.refundsOf(order.id).length, 1);
  assert.equal((await deductionsOf(ticket.id)).length, 1);
});

// ---- 状态流转 ----

test("非法跳转：等租户回复时不能再征求意见；复核中不能认领、留言、征求意见、关闭；已判定不能认领、征求意见、给供应商留言、再判（内部备注可以）；已关闭什么都不能做", async () => {
  const order = await completedOrder();
  const token = await cs();
  const post = (ticketId: string, suffix: string, body: unknown = {}) => api.call("POST", `/platform/v1/tickets/${ticketId}${suffix}`, { token, body });
  const code = (res: { body: any }) => res.body?.error?.code;

  const waiting = await channelComplaint(order.id);
  await ok(post(waiting.id, "/request-reply", { body: "请说明" }));
  assert.equal(code(await post(waiting.id, "/request-reply", { body: "再说明" })), "TICKET_STATE_INVALID");

  const reviewing = await channelComplaint(order.id);
  assert.equal((await decide(reviewing.id, { outcome: "upheld", note: "x", compensation: { scenario: "late_30_plus", liable_party: "tenant" } }, token)).status, 202);
  for (const [suffix, body] of [["/assign", {}], ["/messages", { body: "x" }], ["/request-reply", { body: "x" }], ["/close", { note: "x" }]] as const) {
    assert.equal(code(await post(reviewing.id, suffix, body)), "TICKET_STATE_INVALID", `复核中 ${suffix}`);
  }
  // 复核中供应商也不能回复
  assert.equal(code(await api.call("POST", `/tenant/v1/tickets/${reviewing.id}/messages`, { token: await tenantToken(m.b), body: { body: "补充" } })), "TICKET_STATE_INVALID");

  const decided = await channelComplaint(order.id);
  await ok(decide(decided.id, { outcome: "rejected", note: "不成立" }, token));
  for (const [suffix, body] of [["/assign", {}], ["/messages", { body: "给供应商" }], ["/request-reply", { body: "x" }]] as const) {
    assert.equal(code(await post(decided.id, suffix, body)), "TICKET_STATE_INVALID", `已判定 ${suffix}`);
  }
  assert.equal(code(await decide(decided.id, { outcome: "upheld", note: "改判", compensation: { scenario: "late_15_29", liable_party: "tenant" } }, token)), "TICKET_STATE_INVALID");
  assert.equal((await post(decided.id, "/messages", { body: "内部跟进", internal: true })).status, 201, "判定后还能写内部备注");

  await ok(post(decided.id, "/close", { note: "结案" }));
  for (const [suffix, body] of [["/assign", {}], ["/messages", { body: "x", internal: true }], ["/request-reply", { body: "x" }], ["/close", { note: "x" }]] as const) {
    assert.equal(code(await post(decided.id, suffix, body)), "TICKET_STATE_INVALID", `已关闭 ${suffix}`);
  }
  assert.equal(code(await decide(decided.id, { outcome: "rejected", note: "x" }, token)), "TICKET_STATE_INVALID");
  const final = await ok(api.call("GET", `/platform/v1/tickets/${decided.id}`, { token }));
  assert.equal(final.ticket.status, "closed");
});

test("征求租户意见：供应商回复后再征求一次，24 小时从新的一次起算；供应商在处理中留言不改状态、不记回复时间；不成立的判定不能带赔付，成立的必须带", async () => {
  const order = await completedOrder();
  const ticket = await channelComplaint(order.id);
  const token = await cs();
  await ok(api.call("POST", `/platform/v1/tickets/${ticket.id}/request-reply`, { token, body: { body: "第一次" } }));
  const bToken = await tenantToken(m.b);
  const replied = await ok(api.call("POST", `/tenant/v1/tickets/${ticket.id}/messages`, { token: bToken, body: { body: "回复一" } }), 201);
  assert.equal(replied.ticket.status, "in_progress");
  const repliedAt = replied.ticket.tenant_replied_at;
  api.clock.advance(HOUR);
  const extra = await ok(api.call("POST", `/tenant/v1/tickets/${ticket.id}/messages`, { token: bToken, body: { body: "补充" } }), 201);
  assert.deepEqual([extra.ticket.status, extra.ticket.tenant_replied_at], ["in_progress", repliedAt]);
  api.clock.advance(HOUR);
  const second = await ok(api.call("POST", `/platform/v1/tickets/${ticket.id}/request-reply`, { token, body: { body: "第二次" } }));
  assert.equal(new Date(second.ticket.tenant_reply_due_at).getTime(), api.clock.now().getTime() + DAY);
  assert.equal(second.ticket.tenant_replied_at, null);
  api.clock.advance(DAY - 60_000);
  const fresh = await cs();
  api.clock.advance(60_000 - 1);
  assert.equal((await decide(ticket.id, { outcome: "rejected", note: "x" }, fresh)).body.error.code, "TENANT_REPLY_PENDING");
  api.clock.advance(1);
  const withComp = await decide(ticket.id, { outcome: "rejected", note: "x", compensation: { scenario: "late_15_29", liable_party: "tenant" } }, await cs());
  assert.deepEqual([withComp.status, withComp.body.error.details.issues[0].path], [400, "/compensation"]);
  const without = await decide(ticket.id, { outcome: "upheld", note: "x" }, await cs());
  assert.deepEqual([without.status, without.body.error.details.issues[0].path], [400, "/compensation"]);
  assert.equal((await decide(ticket.id, { outcome: "rejected", note: "超时视为认可后核实不成立" }, await cs())).status, 200);
});

// ---- 申诉 ----

async function decidedAgainstB(): Promise<{ order: OrderMoney; ticketId: string; decided: any }> {
  const order = await completedOrder();
  const ticket = await channelComplaint(order.id);
  const decided = await ok(decide(ticket.id, { outcome: "upheld", note: "成立", compensation: { scenario: "late_15_29", liable_party: "tenant" } }, await cs()));
  return { order, ticketId: ticket.id, decided };
}

function appeal(token: string, parentId: string): Promise<any> {
  return api.call("POST", "/tenant/v1/tickets", { token, body: { type: "tenant_appeal", parent_ticket_id: parentId, subject: "申诉", description: "有不可抗力证明" } });
}

test("申诉 7 天：判定后正好 7 天还能申诉（201）", async () => {
  const { ticketId, decided } = await decidedAgainstB();
  const deadline = new Date(decided.ticket.appeal_until).getTime();
  assert.equal(deadline - new Date(decided.ticket.decided_at).getTime(), 7 * DAY);
  api.clock.advance(deadline - api.clock.now().getTime() - 5_000);
  const token = await tenantToken(m.b);
  api.clock.advance(deadline - api.clock.now().getTime());
  const res = await appeal(token, ticketId);
  assert.equal(res.status, 201, res.text);
});

test("申诉只能一次：供应商同时提交两次申诉，只建一张，另一次 409 ALREADY_APPEALED", async () => {
  const { ticketId } = await decidedAgainstB();
  const token = await tenantToken(m.b);
  const results = await Promise.all([appeal(token, ticketId), appeal(token, ticketId)]);
  assert.deepEqual(results.map((res) => res.status).sort(), [201, 409], results.map((res) => res.text).join(" / "));
  assert.equal(results.find((res) => res.status === 409)?.body.error.code, "ALREADY_APPEALED");
  assert.equal((await api.db.owner.query("select count(*)::int as n from tickets where parent_ticket_id = $1", [ticketId])).rows[0].n, 1);
});

test("申诉由另一人复核：复核批准过原判定的人不能判它的申诉（成立、不成立都不行）；第三个人判不成立，处罚保留，不能再申诉", async () => {
  const order = await completedOrder();
  const ticket = await channelComplaint(order.id);
  const pending = await decide(ticket.id, { outcome: "upheld", note: "迟到 45 分钟", compensation: { scenario: "late_30_plus", liable_party: "tenant" } }, await cs());
  assert.equal(pending.status, 202);
  await ok(approve(pending.body.approval.id, await login(ops2)));
  const created = await ok(appeal(await tenantToken(m.b), ticket.id), 201);
  const appealId = created.ticket.id;
  for (const outcome of ["upheld", "rejected"]) {
    const res = await decide(appealId, { outcome, note: "我来判" }, await login(ops2));
    assert.equal(res.body?.error?.code, "APPEAL_SAME_REVIEWER", `复核人判 ${outcome}：${res.text}`);
  }
  const res = await decide(appealId, { outcome: "rejected", note: "证明与当天路况不符" }, await ops());
  assert.equal(res.status, 200, res.text);
  assert.deepEqual((await deductionsOf(ticket.id)).map(([, , status]) => status), ["pending"], "不成立：应扣款项保留");
  assert.deepEqual(await performanceEvents(order.id), ["complaint", "failure:major_delay"]);
  assert.equal((await appeal(await tenantToken(m.b), ticket.id)).body.error.code, "ALREADY_APPEALED");
  // 申诉本身的结论不能再申诉
  assert.equal((await appeal(await tenantToken(m.b), appealId)).body.error.code, "NOT_APPEALABLE");
});

test("申诉由另一人复核：判定原工单的客服也不能不经判定直接关掉对它的申诉（关掉等于驳回，而且供应商不能再申诉）", async () => {
  const { ticketId } = await decidedAgainstB();
  const created = await ok(appeal(await tenantToken(m.b), ticketId), 201);
  const closed = await api.call("POST", `/platform/v1/tickets/${created.ticket.id}/close`, { token: await cs(), body: { note: "重复申诉，关闭" } });
  assert.equal(closed.status, 409, `原判定人关掉了对自己判定的申诉：${closed.text}`);
  const after = await ok(api.call("GET", `/platform/v1/tickets/${created.ticket.id}`, { token: await ops() }));
  assert.notEqual(after.ticket.status, "closed");
});

test("申诉成立撤销 no-show 驳回的处罚：履约失败事件撤销；客人的退款不收回；订单不恢复", async () => {
  const orderId = await noShowClaimed();
  const ticketId = await noShowTicketOf(orderId);
  await ok(decide(ticketId, { outcome: "rejected", note: "举牌照片没有时间水印" }, await cs()));
  assert.deepEqual(await performanceEvents(orderId), ["failure:no_show_rejected"]);
  const refunds = pay.refundsOf(orderId).length;
  const created = await ok(appeal(await tenantToken(m.b), ticketId), 201);
  assert.equal((await decide(created.ticket.id, { outcome: "upheld", note: "x" }, await cs())).body.error.code, "APPEAL_SAME_REVIEWER");
  await ok(decide(created.ticket.id, { outcome: "upheld", note: "补交了带水印的原图" }, await ops()));
  assert.deepEqual(await performanceEvents(orderId), []);
  assert.equal(pay.refundsOf(orderId).length, refunds);
  const detail = await ok(api.call("GET", `/platform/v1/orders/${orderId}`, { token: await ops() }));
  assert.equal(detail.order.status, "cancelled");
});

// ---- no-show 审核 ----

test("no-show 审核通过：订单「客人未出现」、状态时间线有记录、不退款、没有应扣款项和评分事件；申请记为通过（时间、审核人）；异常队列那一条系统关闭；不能申诉", async () => {
  const orderId = await noShowClaimed();
  const ticketId = await noShowTicketOf(orderId);
  const [exception] = (await ok(api.call("GET", `/platform/v1/exceptions?order_id=${orderId}&type=no_show_review`, { token: await cs() }))).items;
  assert.equal(exception.status, "open");
  // 不能带赔付、不能选「成立」
  assert.equal((await decide(ticketId, { outcome: "approved", note: "x", compensation: { scenario: "late_15_29", liable_party: "tenant" } }, await cs())).status, 400);
  const res = await decide(ticketId, { outcome: "approved", note: "证据齐全" }, await cs());
  assert.equal(res.status, 200, res.text);
  const detail = await ok(api.call("GET", `/platform/v1/orders/${orderId}`, { token: await ops() }));
  assert.equal(detail.order.status, "no_show");
  assert.ok(detail.events.some((event: any) => event.from_status === "no_show_claimed" && event.to_status === "no_show"));
  assert.equal(pay.refundsOf(orderId).length, 0);
  assert.deepEqual(await performanceEvents(orderId), []);
  assert.equal((await api.db.owner.query("select count(*)::int as n from tenant_deductions where order_id = $1", [orderId])).rows[0].n, 0);
  const claim = (await api.db.owner.query("select status, decided_at, decided_by from order_no_show_claims where order_id = $1", [orderId])).rows[0];
  assert.deepEqual([claim.status, claim.decided_at?.getTime(), claim.decided_by], ["approved", api.clock.now().getTime(), support.id]);
  await api.app.orderJobs.exceptions();
  const closed = await ok(api.call("GET", `/platform/v1/exceptions/${exception.id}`, { token: await cs() }));
  assert.deepEqual([closed.exception.status, closed.exception.close_kind], ["closed", "cleared"]);
  assert.equal((await appeal(await tenantToken(m.b), ticketId)).body.error.code, "NOT_APPEALABLE");
});

test("no-show 审核驳回（证据不全、司机到过场）：订单按供应商原因取消，客人全额退款，供应商拿 0，计 no_show_rejected（不是司机未到）；申请记为驳回", async () => {
  const orderId = await noShowClaimed();
  const sell = (await moneyOf(orderId)).sell;
  const ticketId = await noShowTicketOf(orderId);
  const res = await decide(ticketId, { outcome: "rejected", note: "联系记录只有 1 次" }, await cs());
  assert.equal(res.status, 200, res.text);
  const detail = await ok(api.call("GET", `/platform/v1/orders/${orderId}`, { token: await ops() }));
  assert.deepEqual([detail.order.status, detail.order.cancel_reason, detail.order.cancellation.tenant_share.amount], ["cancelled", "SUPPLIER_FAULT", "0"]);
  assert.deepEqual(pay.refundsOf(orderId).map((refund) => refund.amountMinor), [sell]);
  assert.deepEqual(await performanceEvents(orderId), ["failure:no_show_rejected"]);
  const claim = (await api.db.owner.query("select status, decided_by from order_no_show_claims where order_id = $1", [orderId])).rows[0];
  assert.deepEqual([claim.status, claim.decided_by], ["rejected", support.id]);
  assert.ok(res.body.ticket.appeal_until);
  // 驳回只能对 no-show 审核选「司机没到场」
  const other = await channelComplaint((await completedOrder()).id);
  assert.equal((await decide(other.id, { outcome: "rejected", note: "x", driver_absent: true }, await cs())).status, 400);
});

// ---- 规则 2、规则 4 ----

test("规则 4：供应商看到的工单详情、列表、应扣款项里，字段名和值逐个扫描——没有对外价、加价比例、客人赔付和退款金额、内部备注、平台员工编号", async () => {
  const order = await completedOrder();
  const ticket = await channelComplaint(order.id);
  const token = await cs();
  await ok(api.call("POST", `/platform/v1/tickets/${ticket.id}/assign`, { token, body: {} }));
  const note = `内部备注-${randomUUID().slice(0, 8)}`;
  await ok(api.call("POST", `/platform/v1/tickets/${ticket.id}/messages`, { token, body: { body: note, internal: true } }), 201);
  await ok(api.call("POST", `/platform/v1/tickets/${ticket.id}/request-reply`, { token, body: { body: "请说明" } }));
  await ok(api.call("POST", `/tenant/v1/tickets/${ticket.id}/messages`, { token: await tenantToken(m.b), body: { body: "我们核实了" } }), 201);
  const decided = await ok(decide(ticket.id, { outcome: "upheld", note: "没送到", compensation: { scenario: "not_delivered", liable_party: "tenant" } }, await cs()));
  const want = expected(order, "not_delivered", "tenant");
  const forbidden: Record<string, string | number> = { 对外价: order.sell, 客人赔付: want.compensation, 客人按比例: want.ratio, 处理人: support.id, 内部备注: note };
  // 加价比例和赔付表的比例（基点）同值时无法按值区分，只在不撞值时比对
  if (!Object.values(SPEC_BP).includes(BigInt(order.markupBp))) forbidden["加价比例"] = order.markupBp;
  assert.notEqual(want.compensation, want.tenantTotal, "测试数据要让客人和供应商的金额不同，按值比对才有意义");
  assert.equal(decided.compensation.compensation.amount, String(want.compensation));

  const bToken = await tenantToken(m.b);
  const detail = await ok(api.call("GET", `/tenant/v1/tickets/${ticket.id}`, { token: bToken }));
  const list = await ok(api.call("GET", `/tenant/v1/tickets?order_id=${order.id}`, { token: bToken }));
  const deductions = (await ok(api.call("GET", "/tenant/v1/deductions", { token: bToken }))).items.filter((d: any) => allKeys(d).has("ticket_no") ? d.basis?.ticket_no === decided.ticket.ticket_no : false);
  assert.equal(deductions.length, 1, "供应商的应扣款项列表里有这张工单的一条");
  const forbiddenKeys = ["sell", "markup_bp", "fx", "fx_buffer_bp", "refund", "refund_ids", "manual_payout", "compensation", "notes", "assignee_id", "decided_by", "approval_id", "approval", "channel", "customer"];
  for (const [where, body] of [["详情", detail], ["列表", list], ["应扣款项", deductions]] as const) {
    const keys = allKeys(body);
    for (const key of forbiddenKeys) assert.ok(!keys.has(key), `供应商的${where}里有字段 ${key}`);
    assertNoValue(body, forbidden, `供应商的${where}`);
  }
  // 供应商看得到自己的应扣款项（结算币种）
  assert.deepEqual(detail.deductions.map((d: any) => [d.kind, d.amount.amount]), [["compensation", String(want.tenantTotal)]]);
  assert.deepEqual(detail.messages.map((msg: any) => msg.author_type === "platform_user" ? msg.author_id : "tenant"), [null, "tenant"]);
});

test("规则 2：供应商甲按任何状态筛选、按乙的订单筛选都看不到乙的工单；详情、回复、申诉 404；只读子账号能看不能回复、不能申诉", async () => {
  const { order, ticketId } = await decidedAgainstB();
  const aToken = await tenantToken(m.a);
  for (const status of ["", "active", "open", "in_progress", "awaiting_tenant", "decided", "closed"]) {
    const res = await ok(api.call("GET", `/tenant/v1/tickets${status === "" ? "" : `?status=${status}`}`, { token: aToken }));
    assert.ok(!res.items.some((item: any) => item.id === ticketId), `甲 status=${status}`);
  }
  const byOrder = await ok(api.call("GET", `/tenant/v1/tickets?order_id=${order.id}`, { token: aToken }));
  assert.deepEqual([byOrder.items, byOrder.total], [[], 0]);
  assert.equal((await api.call("GET", `/tenant/v1/tickets/${ticketId}`, { token: aToken })).status, 404);
  assert.equal((await appeal(aToken, ticketId)).status, 404);
  assert.equal((await api.db.owner.query("select count(*)::int as n from tickets where parent_ticket_id = $1", [ticketId])).rows[0].n, 0);
  // 乙的只读子账号：看得到，回复、申诉 403
  const reader = await addTenantUser(api, await tenantToken(m.b), `ro-${randomUUID().slice(0, 6)}@market-b.test`, "readonly");
  assert.equal((await api.call("GET", `/tenant/v1/tickets/${ticketId}`, { token: reader.token })).status, 200);
  assert.equal((await appeal(reader.token, ticketId)).status, 403);
  assert.equal((await api.call("POST", `/tenant/v1/tickets/${ticketId}/messages`, { token: reader.token, body: { body: "x" } })).status, 403);
  // 数据库层：甲的租户事务里读不到乙这张工单的对话、应扣款项；租户角色不能写工单、不能删评分事件、不能改应扣款项
  assert.equal((await withTenantTx(api.db.pool, m.a.tenantId, (db) => db.query("select 1 from tenant_deductions where ticket_id = $1", [ticketId]))).rowCount, 0);
  assert.equal((await withTenantTx(api.db.pool, m.b.tenantId, (db) => db.query("select 1 from tenant_deductions where ticket_id = $1", [ticketId]))).rowCount, 1, "乙自己读得到（证明上面的 0 不是因为没数据）");
  await assert.rejects(
    withTenantTx(api.db.pool, m.a.tenantId, (db) => db.query("insert into tickets (tenant_id, ticket_no, type, source, created_by_type, order_id, subject, description, status, priority, first_response_due_at, resolution_due_at, created_at, updated_at) select tenant_id, 'TK20990101AAAAAA', type, source, created_by_type, order_id, subject, description, status, priority, first_response_due_at, resolution_due_at, created_at, updated_at from tickets where id = $1", [ticketId])),
    deniedByDatabase,
  );
  await assert.rejects(withTenantTx(api.db.pool, m.b.tenantId, (db) => db.query("delete from tenant_performance_events where order_id = $1", [order.id])), deniedByDatabase);
  await assert.rejects(withTenantTx(api.db.pool, m.b.tenantId, (db) => db.query("update tenant_deductions set status = 'waived' where ticket_id = $1", [ticketId])), deniedByDatabase);
  assert.deepEqual((await deductionsOf(ticketId)).map(([, , status]) => status), ["pending"]);
});

test("渠道只看到自己订单上由客人、渠道提的工单：客服登记的、供应商登记的看不到；看到的里面没有供应商承担的金额、结算价、内部备注、对话", async () => {
  const order = await completedOrder();
  const mine = await channelComplaint(order.id);
  const note = `内部-${randomUUID().slice(0, 8)}`;
  await ok(api.call("POST", `/platform/v1/tickets/${mine.id}/messages`, { token: await cs(), body: { body: note, internal: true } }), 201);
  const platformOnly = await platformTicket(order.id, "other");
  const tenantLost = (await ok(api.call("POST", "/tenant/v1/tickets", { token: await tenantToken(m.b), body: { type: "lost_and_found", order_id: order.id, subject: "伞", description: "车上有一把伞" } }), 201)).ticket.id;
  const decided = await ok(decide(mine.id, { outcome: "upheld", note: "没送到", compensation: { scenario: "not_delivered", liable_party: "tenant" } }, await cs()));
  const want = expected(order, "not_delivered", "tenant");
  const listed = await ok(api.call("GET", `/sales/v1/orders/${order.id}/tickets`, { token: await flow.token() }));
  assert.deepEqual(listed.items.map((item: any) => item.id), [mine.id]);
  assert.ok(![platformOnly, tenantLost].some((id) => listed.items.some((item: any) => item.id === id)));
  assert.equal(listed.items[0].compensation.compensation.amount, String(want.compensation));
  const keys = allKeys(listed);
  for (const key of ["tenant", "tenant_total", "settlement", "deductions", "notes", "messages", "assignee_id", "decided_by", "decision_note", "liable_party"]) assert.ok(!keys.has(key), `渠道看到了 ${key}`);
  assertNoValue(listed, { 结算价: order.settlement, 供应商承担: want.tenantTotal, 内部备注: note, 判定说明: decided.ticket.decision_note, 客服: support.id, 供应商: m.b.tenantId }, "渠道的工单列表");
  // 别的渠道：404，和不存在一样
  const foreign = await api.call("GET", `/sales/v1/orders/${order.id}/tickets`, { token: await otherFlow.token() });
  const missing = await api.call("GET", `/sales/v1/orders/${randomUUID()}/tickets`, { token: await otherFlow.token() });
  assert.deepEqual([foreign.status, foreign.text], [404, missing.text]);
});

async function siteOrder(passenger: string): Promise<{ id: string; link: string }> {
  api.clock.advance(1_000);
  const quoted = await site.call("POST", "/site/v1/quotes", { body: { city_id: m.ids.tokyo, airport_id: m.ids.narita, direction: "pickup", address: { lng: 139.7, lat: 35.6 }, service_local: "2026-12-20T10:00", passengers: 2, luggage: 1 } });
  assert.equal(quoted.status, 200, quoted.text);
  const quote = quoted.body.quotes.find((q: any) => q.vehicle_group.id === m.ids.biz7);
  api.clock.advance(1_000);
  const placed = await site.call("POST", "/site/v1/orders", { headers: { "idempotency-key": randomUUID() }, body: { quote_id: quote.quote_id, passenger: { name: passenger, phone: "+81 90-0000-2222", email: "guest@example.com" }, flight_no: "NH 211", dropoff_address: "东京站", save_payment_method: true } });
  assert.equal(placed.status, 201, placed.text);
  const intent = pay.intentOf(placed.body.order.id);
  assert.ok(intent);
  pay.pay(intent.id);
  const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
  assert.equal((await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()))).status, 200);
  return { id: placed.body.order.id, link: placed.body.link.token };
}

test("官网客人只看得到自己这一单的工单：两位客人各提一张，互相看不到；伪造的链接 401", async () => {
  const first = await siteOrder("客人甲");
  const second = await siteOrder("客人乙");
  const created1 = await site.call("POST", "/site/v1/order/tickets", { token: first.link, body: { type: "lost_and_found", subject: "手机", description: "落在车上" } });
  const created2 = await site.call("POST", "/site/v1/order/tickets", { token: second.link, body: { type: "other", subject: "发票", description: "要发票" } });
  assert.deepEqual([created1.status, created2.status], [201, 201]);
  const list1 = await site.call("GET", "/site/v1/order/tickets", { token: first.link });
  const list2 = await site.call("GET", "/site/v1/order/tickets", { token: second.link });
  assert.deepEqual(list1.body.items.map((item: any) => item.id), [created1.body.ticket.id]);
  assert.deepEqual(list2.body.items.map((item: any) => item.id), [created2.body.ticket.id]);
  const rows = new Map((await api.db.owner.query("select id, order_id from tickets where id = any($1::uuid[])", [[created1.body.ticket.id, created2.body.ticket.id]])).rows.map((row) => [row.id, row.order_id]));
  assert.deepEqual([rows.get(created1.body.ticket.id), rows.get(created2.body.ticket.id)], [first.id, second.id]);
  assert.equal((await site.call("GET", "/site/v1/order/tickets", { token: `${first.link}x` })).status, 401);
  // 客人不能提申诉、no-show 审核、履约失败（只能投诉、改单、失物、其他）
  for (const type of ["tenant_appeal", "no_show_review", "fulfilment_failure"]) {
    assert.equal((await site.call("POST", "/site/v1/order/tickets", { token: first.link, body: { type, subject: "x", description: "x" } })).status, 400, type);
  }
});

// ---- 权限 ----

test("权限：财务不能判定、不能复核判定（403）但能登记另付；只读能看不能试算、不能判；客服不能复核判定、不能审核赔付表；财务不能发起改赔付表；供应商令牌进不了平台工单接口", async () => {
  const order = await completedOrder();
  const ticket = await channelComplaint(order.id);
  const financeToken = await login(finance);
  const readonly = await platformLogin(api, m.staff.readonly.email);
  const body = { outcome: "upheld", note: "x", compensation: { scenario: "late_30_plus", liable_party: "tenant" } };
  assert.equal((await decide(ticket.id, body, financeToken)).status, 403);
  assert.equal((await decide(ticket.id, body, readonly)).status, 403);
  assert.equal((await api.call("POST", `/platform/v1/tickets/${ticket.id}/compensation-quote`, { token: readonly, body: body.compensation })).status, 403);
  assert.equal((await api.call("GET", `/platform/v1/tickets/${ticket.id}`, { token: readonly })).status, 200);
  assert.equal((await api.call("GET", `/platform/v1/tickets/${ticket.id}`, { token: await tenantToken(m.b) })).status, 401);
  const pending = await decide(ticket.id, body, await cs());
  assert.equal(pending.status, 202);
  assert.equal((await approve(pending.body.approval.id, financeToken)).status, 403);
  assert.equal((await approve(pending.body.approval.id, await login(support2))).status, 403);
  assert.equal((await ok(api.call("GET", `/platform/v1/tickets/${ticket.id}`, { token: await cs() }))).ticket.status, "pending_review");
  // 赔付表
  const change = { customer_bp: { late_15_29: 1100, late_30_plus: 5000, driver_no_show: 10_000, vehicle_downgrade: 2000, no_signboard: 1000, not_delivered: 2500, service_complaint: 1000 }, minimum_jpy: 500, reimbursement_cap_bp: 15_000, review_at_or_above_sell_bp: 5000 };
  assert.equal((await api.call("POST", "/platform/v1/compensation-table/changes", { token: financeToken, body: change })).status, 403);
  const requested = await ok(api.call("POST", "/platform/v1/compensation-table/changes", { token: await ops(), body: change }), 202);
  assert.equal((await approve(requested.approval.id, await cs())).status, 403);
  await ok(api.call("POST", `/platform/v1/approvals/${requested.approval.id}/withdraw`, { token: await ops(), body: {} }));
  assert.equal((await ok(api.call("GET", "/platform/v1/compensation-table", { token: readonly }))).compensation_table.version, 0, "撤回后赔付表不变");
});

test("改赔付表：两条修改同时待审，先批的生效，后批的 APPROVAL_STALE；超范围 400；改表之后已判定的赔付不变、新的判定按新表", async () => {
  const before = await ok(api.call("GET", "/platform/v1/compensation-table", { token: await ops() }));
  const base = { customer_bp: Object.fromEntries(before.compensation_table.scenarios.map((s: any) => [s.scenario, s.customer_bp])), minimum_jpy: before.compensation_table.minimum_jpy, reimbursement_cap_bp: before.compensation_table.reimbursement_cap_bp, review_at_or_above_sell_bp: before.compensation_table.review_at_or_above_sell_bp };
  for (const bad of [{ ...base, minimum_jpy: -1 }, { ...base, minimum_jpy: 100_001 }, { ...base, reimbursement_cap_bp: 50_001 }, { ...base, review_at_or_above_sell_bp: 10_001 }, { ...base, customer_bp: { ...base.customer_bp, no_signboard: 10_001 } }, { ...base, customer_bp: { ...base.customer_bp, no_signboard: 1.5 } }]) {
    assert.equal((await api.call("POST", "/platform/v1/compensation-table/changes", { token: await ops(), body: bad })).status, 400, JSON.stringify(bad));
  }
  // 先判一张（按当前表）
  const oldOrder = await completedOrder();
  const oldTicket = await channelComplaint(oldOrder.id);
  await ok(decide(oldTicket.id, { outcome: "upheld", note: "旧表", compensation: { scenario: "no_signboard", liable_party: "tenant" } }, await cs()));
  const oldRow = await compensationRow(oldTicket.id);

  const first = await ok(api.call("POST", "/platform/v1/compensation-table/changes", { token: await ops(), body: { ...base, customer_bp: { ...base.customer_bp, no_signboard: 1500 } } }), 202);
  const second = await ok(api.call("POST", "/platform/v1/compensation-table/changes", { token: await ops(), body: { ...base, customer_bp: { ...base.customer_bp, no_signboard: 2000 } } }), 202);
  await ok(approve(first.approval.id, await login(finance)));
  const stale = await approve(second.approval.id, await login(finance));
  assert.deepEqual([stale.status, stale.body.error.code], [409, "APPROVAL_STALE"]);
  const now = await ok(api.call("GET", "/platform/v1/compensation-table", { token: await ops() }));
  assert.equal(now.compensation_table.version, before.compensation_table.version + 1);
  assert.equal(now.compensation_table.scenarios.find((s: any) => s.scenario === "no_signboard").customer_bp, 1500);

  assert.deepEqual(await compensationRow(oldTicket.id), oldRow, "已判定的不变");
  const newOrder = await completedOrder();
  const newTicket = await channelComplaint(newOrder.id);
  const decided = await ok(decide(newTicket.id, { outcome: "upheld", note: "新表", compensation: { scenario: "no_signboard", liable_party: "tenant" } }, await cs()));
  assert.equal(decided.compensation.table_version, now.compensation_table.version);
  assert.equal(decided.compensation.compensation.amount, String(Math.max(half(BigInt(newOrder.sell) * 1500n, 10_000n), 500)));
  assert.equal(decided.compensation.tenant_total.amount, String(half(BigInt(newOrder.settlement) * 1500n, 10_000n)));
  // 恢复（免得影响本文件后面的用例）
  const back = await ok(api.call("POST", "/platform/v1/compensation-table/changes", { token: await ops(), body: base }), 202);
  await ok(approve(back.approval.id, await login(finance)));
});
