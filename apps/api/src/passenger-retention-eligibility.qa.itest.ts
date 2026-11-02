/**
 * M4-21 QA：什么情况下不该脱敏（脱敏不可逆，误删是最高优先）。对照 ADR 0055「什么算超过期限」「什么时候不脱敏」。
 * 每种结束时间的来源、每一个阻止条件都单独构造；结案后下一轮才脱敏。真实 PostgreSQL，数据虚构，测试后随 schema 删除。
 */
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { AppContext } from "./context.ts";
import { withPlatformTx } from "./db/context.ts";
import { listRetentionCandidates, type RetentionBlocker } from "./repos/passenger-retention.ts";
import { planPassengerRetention, retentionCutoff } from "./services/passenger-retention.ts";
import { type TestApi, createTestApi } from "./testing/api.ts";
import { seedOrder } from "./testing/dispatch.ts";
import { type Market, buildMarket } from "./testing/market.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import {
  DAY, type Seeded, aged, blockedBy, closeTicket, endAt, insertApproval, insertChange, insertDeduction, insertException, insertExtraCharge, insertGuestNotification, insertPayment, insertRefund, insertRescue, insertStatement, insertTicket, insertWebhookDelivery, isDone, retentionCtx, setStatementStatus, staffIds, tokyoDaysAgo,
} from "./testing/retention-fixtures.ts";

let api: TestApi;
let m: Market;
let ctx: AppContext;

before(async () => {
  api = await createTestApi({ payments: new FakePaymentProvider() });
  m = await buildMarket(api);
  ctx = retentionCtx(api);
});
after(() => api.close());

const tick = () => api.app.passengerRetention.tick();
const old = (days = 200): Promise<Seeded> => aged(api, m, days);
const q = (sql: string, args: unknown[] = []) => api.db.owner.query(sql, args);
const candidateIds = async (): Promise<string[]> => (await withPlatformTx(api.db.pool, (db) => listRetentionCandidates(db, retentionCutoff(ctx).cutoff, 10_000))).map((row) => row.orderId);

// ---- 结束时间的各种来源 ----

const LATE_SOURCES: { name: string; set: (order: Seeded, late: Date) => Promise<unknown> }[] = [
  { name: "取消时间（用车时间早，但不久前才取消）", set: (o, late) => q("update orders set cancelled_at = $2 where id = $1", [o.id, late]) },
  { name: "状态流水最后一条（流水旧单才算旧）", set: (o, late) => q("insert into order_events (tenant_id, order_id, from_status, to_status, actor, occurred_at) values ($1, $2, 'cancelled', 'cancelled', 'system', $3)", [o.tenantId, o.id, late]) },
  { name: "完成时间（用车时间早，完成得晚）", set: (o, late) => q("update orders set status = 'completed', cancelled_at = null, cancel_reason = null, completed_at = $2, completed_recorded_at = $2 where id = $1", [o.id, late]) },
  { name: "代传回填：完成时间很早，但系统记录时间是最近", set: (o, late) => q("update orders set status = 'completed', cancelled_at = null, cancel_reason = null, completed_at = service_at, completed_recorded_at = $2 where id = $1", [o.id, late]) },
  { name: "转出时间", set: (o, late) => q("update orders set status = 'rescued', cancelled_at = null, cancel_reason = null, rescued_at = $2 where id = $1", [o.id, late]) },
];

for (const source of LATE_SOURCES) {
  test(`结束时间：${source.name}，只过去 100 天的不脱敏`, async () => {
    const order = await old(400);
    await source.set(order, tokyoDaysAgo(api, 100));
    assert.ok(!(await candidateIds()).includes(order.id));
    await tick();
    assert.equal(await isDone(api, order.id), false);
  });
}

test("结束时间：改单把用车时间改到将来，老的流水和取消时间都不算结束；未来用车的已取消单不动", async () => {
  const order = await old(400);
  await q("update orders set service_at = $2 where id = $1", [order.id, new Date(api.clock.now().getTime() + 30 * DAY)]);
  await tick();
  assert.equal(await isDone(api, order.id), false);
});

test("结束时间：改单把用车时间从很久以前改到 100 天前（已应用的改单），按新的时间算", async () => {
  const order = await old(400);
  await insertChange(api, order, "applied", { before: { service_local: "old" }, after: { service_local: "new" } });
  await q("update orders set service_at = $2, cancelled_at = $2 where id = $1", [order.id, tokyoDaysAgo(api, 100)]);
  await tick();
  assert.equal(await isDone(api, order.id), false);
});

test("结束时间：救援的两行，新的一行晚结束：按所有行里最晚的算", async () => {
  const order = await old(400);
  await q("update orders set status = 'rescued', cancelled_at = null, cancel_reason = null, rescued_at = service_at where id = $1", [order.id]);
  await q(
    `insert into orders (tenant_id, id, order_no, status, category, city_id, place_id, direction, product_id, product_version, vehicle_group_id, service_at, service_local, timezone, service_date, urgent, passengers, luggage, pickup, dropoff, addons, driver_language, flight_no, passenger, settlement_minor, settlement_currency, settlement, inventory_held, payment_due_at, confirmed_at, dispatch_due_at, cancelled_at, cancel_reason, created_at, updated_at)
     select $2, id, order_no, 'cancelled', category, city_id, place_id, direction, $3, product_version, vehicle_group_id, service_at, service_local, timezone, service_date, urgent, passengers, luggage, pickup, dropoff, addons, driver_language, flight_no, passenger, settlement_minor, settlement_currency, settlement, inventory_held, payment_due_at, confirmed_at, dispatch_due_at, $4, 'GUEST_REQUEST', created_at, updated_at from orders where id = $1`,
    [order.id, m.b.tenantId, m.ids.pb, tokyoDaysAgo(api, 100)],
  );
  await tick();
  assert.equal(await isDone(api, order.id), false);
});

test("服务没结束但流水很旧：进行中的单，用车时间 400 天前也不脱敏", async () => {
  const order = await seedOrder(api, m, "a", { serviceAt: tokyoDaysAgo(api, 400), confirmedAt: tokyoDaysAgo(api, 401), status: "in_service" });
  await q("insert into order_events (tenant_id, order_id, from_status, to_status, actor, occurred_at) values ($1, $2, 'departed', 'in_service', 'system', $3)", [order.tenantId, order.id, tokyoDaysAgo(api, 400)]);
  await tick();
  assert.equal(await isDone(api, order.id), false);
});

test("结束时间正好等于截止时刻不算超过；早 1 毫秒才算（比较用小于，不用小于等于）", async () => {
  const cutoff = retentionCutoff(ctx).cutoff;
  const exact = await old(300);
  await endAt(api, exact.id, cutoff);
  const earlier = await old(300);
  await endAt(api, earlier.id, new Date(cutoff.getTime() - 1));
  const ids = await candidateIds();
  assert.ok(!ids.includes(exact.id), "正好第 180 天的 0 点");
  assert.ok(ids.includes(earlier.id), "第 181 天的最后一刻");
  await tick();
  assert.equal(await isDone(api, exact.id), false);
  assert.equal(await isDone(api, earlier.id), true);
});

test("订单在别的时区（夏威夷）：按东京日历日统一算，不因为当地时区提前", async () => {
  const order = await old(180);
  await q("update orders set timezone = 'Pacific/Honolulu' where id = $1", [order.id]);
  await tick();
  assert.equal(await isDone(api, order.id), false);
});

// ---- 状态白名单 ----

for (const status of ["pending_payment", "confirmed", "assigned", "departed", "arrived", "in_service", "no_show_claimed", "rescue_pending"]) {
  test(`状态白名单：${status} 的单，用车时间 400 天前也不脱敏，dry-run 也不算`, async () => {
    const pending = status === "pending_payment";
    const order = await seedOrder(api, m, "a", { serviceAt: tokyoDaysAgo(api, 400), confirmedAt: tokyoDaysAgo(api, 401), status: pending ? "confirmed" : status });
    if (pending) await q("update orders set status = 'pending_payment', confirmed_at = null, dispatch_due_at = null where id = $1", [order.id]);
    assert.ok(!(await candidateIds()).includes(order.id));
    await tick();
    assert.equal(await isDone(api, order.id), false);
  });
}

test("状态白名单：枚举里新增一个不认识的状态，默认不脱敏", async () => {
  const definition = (await q("select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'orders_status_check' and connamespace = current_schema()::regnamespace")).rows[0].def as string;
  await q("alter table orders drop constraint orders_status_check");
  await q("alter table orders add constraint orders_status_check check (status is not null)");
  try {
    const order = await seedOrder(api, m, "a", { serviceAt: tokyoDaysAgo(api, 400), confirmedAt: tokyoDaysAgo(api, 401), status: "refund_review_future" });
    assert.ok(!(await candidateIds()).includes(order.id));
    await tick();
    assert.equal(await isDone(api, order.id), false);
    await q("update orders set status = 'confirmed' where id = $1", [order.id]);
  } finally {
    await q("alter table orders drop constraint orders_status_check");
    await q(`alter table orders add constraint orders_status_check ${definition}`);
  }
});

// ---- 阻止条件：一项一项 ----

interface Case {
  name: string;
  reason: RetentionBlocker;
  block: (order: Seeded) => Promise<unknown>;
  clear: (order: Seeded) => Promise<unknown>;
}

const refs = new Map<string, string>();
const remember = (order: Seeded, id: string): string => {
  refs.set(order.id, id);
  return id;
};
const ref = (order: Seeded): string => refs.get(order.id) as string;
const asCompleted = (o: Seeded): Promise<unknown> => q("update orders set status = 'completed', cancelled_at = null, cancel_reason = null, completed_at = service_at, completed_recorded_at = service_at where id = $1", [o.id]);
const orderLine = (o: Seeded): { kind: string; sourceKey: string; orderId: string; orderNo: string } => ({ kind: "order", sourceKey: `order:${o.id}`, orderId: o.id, orderNo: o.orderNo });

const cases: Case[] = [
  ...["open", "awaiting_tenant", "in_progress", "pending_review", "decided"].map((status): Case => ({
    name: `工单状态 ${status}`,
    reason: "open_ticket",
    block: async (o) => remember(o, await insertTicket(api, o, status)),
    clear: (o) => closeTicket(api, ref(o)),
  })),
  {
    name: "工单关了但人工赔付没付完",
    reason: "open_ticket",
    block: async (o) => {
      const ticket = await insertTicket(api, o, "closed");
      remember(o, ticket);
      await q(
        `insert into ticket_compensations (ticket_id, order_id, supplier_tenant_id, scenario, liable_party, table_version, customer_bp, currency, sell_minor, ratio_minor, downgrade_difference_minor, minimum_minor, topped_up, compensation_minor, reimbursement_claimed_minor, reimbursement_cap_minor, reimbursement_minor, refund_minor, manual_payout_minor, order_cancelled, payout_status, tenant_currency, tenant_total_minor, created_at, updated_at)
         values ($1, $2, $3, 'service_complaint', 'platform', 1, 1000, 'JPY', 20000, 2000, 0, 0, false, 2000, 0, 0, 0, 0, 2000, false, 'pending', 'JPY', 0, $4, $4)`,
        [ticket, o.id, o.tenantId, api.clock.now()],
      );
    },
    clear: async (o) => q("update ticket_compensations set payout_status = 'paid', paid_at = $2, paid_by = $3, payout_reference = 'QA' where ticket_id = $1", [ref(o), api.clock.now(), (await staffIds(api))[0]]),
  },
  ...["issued", "disputed", "confirmed", "in_payout"].map((status): Case => ({
    name: `账单状态 ${status}`,
    reason: "open_statement",
    block: async (o) => {
      const statement = remember(o, await insertStatement(api, o.tenantId, orderLine(o)));
      if (status !== "issued") await setStatementStatus(api, statement, status);
    },
    clear: (o) => setStatementStatus(api, ref(o), "paid"),
  })),
  {
    name: "已完成还没出账",
    reason: "unbilled",
    block: (o) => asCompleted(o),
    clear: async (o) => setStatementStatus(api, await insertStatement(api, o.tenantId, orderLine(o)), "paid"),
  },
  {
    name: "客人未出现（no_show）还没出账",
    reason: "unbilled",
    block: (o) => q("update orders set status = 'no_show', cancelled_at = null, cancel_reason = null where id = $1", [o.id]),
    clear: async (o) => setStatementStatus(api, await insertStatement(api, o.tenantId, { ...orderLine(o), kind: "no_show" }), "paid"),
  },
  {
    name: "有偿取消还没出账",
    reason: "unbilled",
    block: (o) => q("update orders set cancel_fee_bp = 5000, cancel_tenant_share_minor = 1000 where id = $1", [o.id]),
    clear: async (o) => setStatementStatus(api, await insertStatement(api, o.tenantId, { ...orderLine(o), kind: "cancellation" }), "paid"),
  },
  {
    name: "已扣款的加收还没出账",
    reason: "unbilled",
    block: async (o) => remember(o, await insertExtraCharge(api, o, "charged")),
    clear: async (o) => setStatementStatus(api, await insertStatement(api, o.tenantId, { kind: "extra_charge", sourceKey: `extra_charge:${ref(o)}`, orderId: o.id, orderNo: o.orderNo }), "paid"),
  },
  {
    name: "应扣款项还没出账",
    reason: "unbilled",
    block: async (o) => remember(o, await insertDeduction(api, o, await insertTicket(api, o, "closed"), "pending")),
    clear: async (o) => setStatementStatus(api, await insertStatement(api, o.tenantId, { kind: "deduction", sourceKey: `deduction:${ref(o)}`, orderId: o.id, orderNo: o.orderNo, amount: -500 }), "paid"),
  },
  {
    name: "出过账后被免除的应扣款项，冲回还没出账",
    reason: "unbilled",
    block: async (o) => {
      const deduction = remember(o, await insertDeduction(api, o, await insertTicket(api, o, "closed"), "waived"));
      await setStatementStatus(api, await insertStatement(api, o.tenantId, { kind: "deduction", sourceKey: `deduction:${deduction}`, orderId: o.id, orderNo: o.orderNo, amount: -500 }), "paid");
    },
    clear: async (o) => setStatementStatus(api, await insertStatement(api, o.tenantId, { kind: "deduction_waiver", sourceKey: `deduction_waiver:${ref(o)}`, orderId: o.id, orderNo: o.orderNo }), "paid"),
  },
  {
    name: "拒付",
    reason: "dispute",
    block: async (o) => remember(o, await insertPayment(api, o, { disputed: true })),
    clear: (o) => q("update order_payments set disputed = false where id = $1", [ref(o)]),
  },
  {
    name: "取消后才付到钱、还没退完",
    reason: "dispute",
    block: async (o) => remember(o, await insertPayment(api, o, { paidAfterCancel: true })),
    clear: (o) => q("update order_payments set refunded_minor = amount_minor where id = $1", [ref(o)]),
  },
  ...["in_window", "review", "disputed", "approved", "charging", "charge_failed"].map((status): Case => ({
    name: `加收状态 ${status}`,
    reason: "dispute",
    block: async (o) => remember(o, await insertExtraCharge(api, o, status)),
    clear: (o) => q("update order_extra_charges set status = 'rejected', decided_at = $2, decided_by = (select id from platform_users limit 1), review_reasons = '{}' where id = $1", [ref(o), api.clock.now()]),
  })),
  ...(["pending", "processing"] as const).map((status): Case => ({
    name: `退款状态 ${status}`,
    reason: "refund",
    block: async (o) => remember(o, await insertRefund(api, o, await insertPayment(api, o), status)),
    clear: (o) => q("update order_refunds set status = 'succeeded', succeeded_at = $2, next_attempt_at = null where id = $1", [ref(o), api.clock.now()]),
  })),
  {
    name: "退款失败且没作废、没重试",
    reason: "refund",
    block: async (o) => remember(o, await insertRefund(api, o, await insertPayment(api, o), "failed")),
    clear: (o) => q("update order_refunds set superseded_at = $2 where id = $1", [ref(o), api.clock.now()]),
  },
  ...(["open", "claimed"] as const).map((status): Case => ({
    name: `异常状态 ${status}`,
    reason: "open_work",
    block: async (o) => remember(o, await insertException(api, o, status)),
    clear: (o) => q("update order_exceptions set status = 'closed', close_kind = 'cleared', closed_at = $2, assignee_id = null, claimed_at = null where id = $1", [ref(o), api.clock.now()]),
  })),
  ...["awaiting_payment", "pending_confirmation", "adjusting"].map((status): Case => ({
    name: `改单状态 ${status}`,
    reason: "open_work",
    block: async (o) => remember(o, await insertChange(api, o, status)),
    clear: (o) => q("update order_changes set status = 'rejected', decided_at = $2 where id = $1", [ref(o), api.clock.now()]),
  })),
  ...["open", "offering", "exhausted"].map((status): Case => ({
    name: `救援状态 ${status}`,
    reason: "open_work",
    block: async (o) => remember(o, await insertRescue(api, o, status)),
    clear: (o) => q("update order_rescues set status = 'cancelled', closed_at = $2 where id = $1", [ref(o), api.clock.now()]),
  })),
  {
    name: "复核待审：对象是这单",
    reason: "open_work",
    block: async (o) => remember(o, await insertApproval(api, "order.cancel_refund", "order", o.id)),
    clear: (o) => q("update approvals set status = 'withdrawn', decided_at = $2 where id = $1", [ref(o), api.clock.now()]),
  },
  {
    name: "复核待审：对象是这单的工单",
    reason: "open_work",
    block: async (o) => remember(o, await insertApproval(api, "ticket.compensation", "ticket", await insertTicket(api, o, "closed"))),
    clear: (o) => q("update approvals set status = 'withdrawn', decided_at = $2 where id = $1", [ref(o), api.clock.now()]),
  },
  {
    name: "复核待审：对象是这单的救援",
    reason: "open_work",
    block: async (o) => remember(o, await insertApproval(api, "rescue.waive", "rescue", await insertRescue(api, o, "cancelled"))),
    clear: (o) => q("update approvals set status = 'withdrawn', decided_at = $2 where id = $1", [ref(o), api.clock.now()]),
  },
  ...(["pending", "sending"] as const).map((status): Case => ({
    name: `给客人的通知 ${status}`,
    reason: "sending",
    block: async (o) => remember(o, await insertGuestNotification(api, o, status)),
    clear: (o) => q("update notifications set status = 'sent', sent_at = $2, lease_token = null, lease_until = null where id = $1", [ref(o), api.clock.now()]),
  })),
  {
    name: "推送还在发",
    reason: "sending",
    block: async (o) => remember(o, await insertWebhookDelivery(api, o, "pending")),
    clear: (o) => q("update webhook_deliveries set status = 'failed', failed_at = $2, next_attempt_at = null where id = $1", [ref(o), api.clock.now()]),
  },
];

for (const item of cases) {
  test(`阻止条件：${item.name}——不脱敏，dry-run 说得出原因；结案后下一轮才脱敏`, async () => {
    const order = await old(200);
    await item.block(order);
    assert.equal(await blockedBy(api, order.id, item.reason), true, "判断依据应该命中");
    assert.ok(!(await candidateIds()).includes(order.id));
    await tick();
    assert.equal(await isDone(api, order.id), false, "没结案不能脱敏");
    await item.clear(order);
    assert.equal(await blockedBy(api, order.id, item.reason), false, "结案后判断依据应该解除");
    await tick();
    assert.equal(await isDone(api, order.id), true, "结案后这一轮应该脱敏");
  });
}

test("阻止条件：救援单的任何一行有没结的事都算（工单挂在另一个供应商那一行上）", async () => {
  const order = await old(300);
  await q("update orders set status = 'rescued', cancelled_at = null, cancel_reason = null, rescued_at = service_at where id = $1", [order.id]);
  await q(
    `insert into orders (tenant_id, id, order_no, status, category, city_id, place_id, direction, product_id, product_version, vehicle_group_id, service_at, service_local, timezone, service_date, urgent, passengers, luggage, pickup, dropoff, addons, driver_language, flight_no, passenger, settlement_minor, settlement_currency, settlement, inventory_held, payment_due_at, confirmed_at, dispatch_due_at, cancelled_at, cancel_reason, created_at, updated_at)
     select $2, id, order_no, 'cancelled', category, city_id, place_id, direction, $3, product_version, vehicle_group_id, service_at, service_local, timezone, service_date, urgent, passengers, luggage, pickup, dropoff, addons, driver_language, flight_no, passenger, settlement_minor, settlement_currency, settlement, inventory_held, payment_due_at, confirmed_at, dispatch_due_at, service_at, 'GUEST_REQUEST', created_at, updated_at from orders where id = $1`,
    [order.id, m.b.tenantId, m.ids.pb],
  );
  await insertTicket(api, { ...order, tenantId: m.b.tenantId }, "open");
  await tick();
  assert.equal(await isDone(api, order.id), false);
});

test("已结束的状态不算挂着：已关的工单、已作废的账单、关了的异常、否决的改单不挡", async () => {
  const order = await old(200);
  await insertTicket(api, order, "closed");
  await insertException(api, order, "closed");
  await insertChange(api, order, "rejected");
  await insertRescue(api, order, "cancelled");
  await setStatementStatus(api, await insertStatement(api, order.tenantId, orderLine(order)), "void");
  await insertGuestNotification(api, order, "failed");
  await insertWebhookDelivery(api, order, "failed");
  await tick();
  assert.equal(await isDone(api, order.id), true);
});

for (const status of ["creating", "requires_payment", "processing"]) {
  test(`钱没走完：这单还有一笔收款是 ${status}（Stripe 还没给结果），不脱敏`, async () => {
    const order = await old(200);
    await insertPayment(api, order, { status });
    await tick();
    assert.equal(await isDone(api, order.id), false, "付款结果还没回来，回来了可能要退款、联系客人（ADR 0055 的依据：这单还可能要联系客人或要对账）");
  });
}

test("账单未结：明细所在账单是 carried（转入下期），下期账单还没结，不算结了", async () => {
  const order = await old(200);
  const statement = await insertStatement(api, order.tenantId, { kind: "deduction", sourceKey: `deduction:${randomUUID()}`, orderId: order.id, orderNo: order.orderNo, amount: -500 }, -500);
  const approval = await insertApproval(api, "statement.qa", "statement", statement, { status: "withdrawn" });
  await q("update statements set status = 'carried', confirmed_at = $2, confirmed_by_type = 'system', approval_id = $3, approved_at = $2 where id = $1", [statement, api.clock.now(), approval]);
  await insertStatement(api, order.tenantId, { kind: "carry_forward", sourceKey: `carry:${statement}`, orderId: null, orderNo: null, amount: -500 }, 19_500);
  await tick();
  assert.equal(await isDone(api, order.id), false, "负数余额转入的下期账单还是 issued，这笔钱没结");
});

test("被挡住的单 dry-run 里按原因计数，同一单有几个原因算几次，ready 不含它", async () => {
  const before = (await planPassengerRetention(ctx)).summary;
  const order = await old(200);
  await insertTicket(api, order, "open");
  await insertPayment(api, order, { disputed: true });
  const summary = (await planPassengerRetention(ctx)).summary;
  assert.equal(summary.aged, before.aged + 1);
  assert.equal(summary.ready, before.ready);
  assert.equal(summary.blocked.open_ticket, before.blocked.open_ticket + 1);
  assert.equal(summary.blocked.dispute, before.blocked.dispute + 1);
});
