/**
 * M4-03 测试角色：运营后台页面背后的接口（ADR 0034、0040），经真实接口、真实 PostgreSQL；收款服务用替身。
 * - 验收标准「全部操作留审计」：页面上每一个会改数据的按钮（异常认领 / 指派 / 转交 / 关闭；工单认领、转交、留言、内部备注、回复客人、
 *   征求意见、判定、关闭、登记另付；改赔付表；账单出账、答复、作废重出、发起付款复核、批准；付款批次锁定）做一遍，
 *   再用审计日志页用的接口（GET /platform/v1/audit-logs，按对象和编号查）核对：操作人、操作、前后值都对；被拒绝的操作不留「成功」记录；
 * - 同事名单（GET /platform/v1/colleagues）：只有编号、姓名、是否在用；没激活的不列；供应商、渠道、官网、没登录的拿不到；
 * - 规则 4：供应商的工单、账单、应扣款项、操作日志里没有对外价、加价比例、客人赔付金额、内部备注、给客人的回复、平台员工编号——
 *   字段名扫描 + 逐个值比对（不是整段找子串）；
 * - 官网：客人只看到自己这一单的工单和回复；令牌只认 Authorization 头；投诉 14 天边界；同一单的上限。
 * 数据全部在测试里构造，测试结束随临时数据库删除（规则 1）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { TenantFixture, TestApi } from "./testing/api.ts";
import { createTestApi } from "./testing/api.ts";
import { seedOrder } from "./testing/dispatch.ts";
import { type Market, type Staff, addStaff, allKeys, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { completeOrder, platformLogin, tenantLogin } from "./testing/money.ts";
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
let support: Staff;
let ops2: Staff;
let finance1: Staff;
let finance2: Staff;
let site: SiteApi;

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  flow = await salesFlow(api, m, pay);
  support = await addStaff(api, m.root, "cs@platform.test", "customer_service");
  ops2 = await addStaff(api, m.root, "ops2@platform.test", "operations");
  finance1 = await addStaff(api, m.root, "fin1@platform.test", "finance");
  finance2 = await addStaff(api, m.root, "fin2@platform.test", "finance");
  const siteChannel = (await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" })).id;
  site = await siteApi(api, (await salesCredentials(api, m, siteChannel)).clientId, pay);
});
after(async () => {
  await site?.close();
  await api.close();
});

const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const login = (who: Staff): Promise<string> => platformLogin(api, who.email);
const root = (): Promise<string> => platformLogin(api, "root@platform.test");
const tenantToken = (who: TenantFixture): Promise<string> => tenantLogin(api, who.adminEmail);

/** 一个 JSON 值里所有的叶子值（逐层），都转成字符串：按值比对用，不在整段文字里找子串。 */
function allValues(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) for (const item of value) allValues(item, into);
  else if (typeof value === "object" && value !== null) for (const item of Object.values(value)) allValues(item, into);
  else if (value !== null && value !== undefined) into.add(String(value));
  return into;
}

/** 一个 JSON 值里所有叶子的「路径 → 值」。 */
function leaves(value: unknown, path = "", into: [string, string][] = []): [string, string][] {
  if (Array.isArray(value)) value.forEach((item, index) => leaves(item, `${path}[${index}]`, into));
  else if (typeof value === "object" && value !== null) for (const [key, item] of Object.entries(value)) leaves(item, `${path}.${key}`, into);
  else if (value !== null && value !== undefined) into.push([path, String(value)]);
  return into;
}

/** 应答里不能有这些值（任何一层、任何字段）。`allowedAt`：某个值碰巧和合法字段相同（如加价 10% 和赔付比例 10% 都是 1000 基点）时，只许出现在这些字段名下。 */
function assertNoValues(body: unknown, forbidden: Record<string, string | number>, where: string, allowedAt: Record<string, readonly string[]> = {}): void {
  const found = leaves(body);
  for (const [name, value] of Object.entries(forbidden)) {
    const allowed = allowedAt[name] ?? [];
    const hits = found.filter(([path, leaf]) => leaf === String(value) && !allowed.some((key) => path.endsWith(`.${key}`)));
    assert.deepEqual(hits, [], `${where} 里出现了${name}（${value}）`);
  }
}

/** 审计日志页用的接口：按对象类型和编号查，从旧到新。 */
async function auditOf(resource: string, resourceId: string): Promise<any[]> {
  const res = await api.call("GET", `/platform/v1/audit-logs?resource=${resource}&resource_id=${encodeURIComponent(resourceId)}&limit=100`, { token: await root() });
  assertMatchesOpenApi("GET", "/platform/v1/audit-logs", res);
  assert.equal(res.status, 200, res.text);
  return [...res.body.items].reverse();
}

const brief = (log: any): [string, string | null] => [log.action, log.actor.email];

// ---- 全部操作留审计 ----

test("全部操作留审计（异常队列）：认领、被抢先认领（409 不留记录）、转交、指派给同事、别人写说明关闭——审计日志页按对象查得到每一步，操作人和前后的状态、处理人都对", async () => {
  const first = (await flow.paidOrder({ serviceTime: iso(api.clock.now().getTime() + 5 * DAY) })).id;
  const second = (await flow.paidOrder({ serviceTime: iso(api.clock.now().getTime() + 5 * DAY) })).id;
  const detail = await ok(api.call("GET", `/platform/v1/orders/${second}`, { token: await root() }));
  api.clock.advance(Math.max(0, new Date(detail.order.dispatch.due_at).getTime() - api.clock.now().getTime()) + 60_000);
  await api.app.orderJobs.remind();
  await api.app.orderJobs.exceptions();
  const find = async (orderId: string): Promise<string> => {
    const listed = await ok(api.call("GET", `/platform/v1/exceptions?order_id=${orderId}&type=dispatch_overdue`, { token: await login(support) }));
    assert.equal(listed.items.length, 1);
    return listed.items[0].id;
  };
  const ex1 = await find(first);
  const ex2 = await find(second);

  // 第一条：客服认领 → 运营再认领 409 → 客服转交给财务 → 财务关闭
  await ok(api.call("POST", `/platform/v1/exceptions/${ex1}/claim`, { token: await login(support), body: {} }));
  const grabbed = await api.call("POST", `/platform/v1/exceptions/${ex1}/claim`, { token: await login(ops2), body: {} });
  assert.deepEqual([grabbed.status, grabbed.body.error.code], [409, "EXCEPTION_ALREADY_CLAIMED"]);
  await ok(api.call("POST", `/platform/v1/exceptions/${ex1}/claim`, { token: await login(support), body: { assignee_id: finance1.id } }));
  await ok(api.call("POST", `/platform/v1/exceptions/${ex1}/close`, { token: await login(finance1), body: { resolution: "已电话催供应商，14:20 派车" } }));
  const log1 = await auditOf("order_exception", ex1);
  assert.deepEqual(log1.map(brief), [["claim", support.email], ["claim", support.email], ["close", finance1.email]], "被抢先认领的 409 不留记录");
  assert.deepEqual([log1[0].before.status, log1[0].before.assignee_id, log1[0].after.status, log1[0].after.assignee_id], ["open", null, "claimed", support.id]);
  assert.deepEqual([log1[1].before.assignee_id, log1[1].after.assignee_id], [support.id, finance1.id], "转交：前后的处理人");
  assert.deepEqual([log1[2].before.status, log1[2].after.status, log1[2].after.resolution], ["claimed", "closed", "已电话催供应商，14:20 派车"]);
  for (const log of log1) {
    assert.deepEqual([log.tenant_id, log.source, log.actor.type, log.after.order_id], [null, "console", "platform_user", first]);
  }

  // 第二条：运营直接指派给客服（待处理的谁都能指派）→ 运营不是处理人，也能写说明关闭
  await ok(api.call("POST", `/platform/v1/exceptions/${ex2}/claim`, { token: await login(ops2), body: { assignee_id: support.id } }));
  await ok(api.call("POST", `/platform/v1/exceptions/${ex2}/close`, { token: await login(ops2), body: { resolution: "供应商已派车" } }));
  const log2 = await auditOf("order_exception", ex2);
  assert.deepEqual(log2.map(brief), [["claim", ops2.email], ["close", ops2.email]]);
  assert.deepEqual([log2[0].before.assignee_id, log2[0].after.assignee_id, log2[0].after.status], [null, support.id, "claimed"], "指派：操作人是运营，处理人是客服");
  assert.equal(log2[1].before.assignee_id, support.id);
});

/** 渠道替客人投诉一张已完成的单（乙中标），返回订单、对外价和工单。 */
async function complaint(): Promise<{ orderId: string; sell: number; ticketId: string; ticketNo: string }> {
  const order = await flow.paidOrder({ serviceTime: iso(api.clock.now().getTime() + 3 * DAY) });
  await completeOrder(api, m, "b", order.id);
  const detail = await ok(api.call("GET", `/platform/v1/orders/${order.id}`, { token: await root() }));
  const created = await ok(api.call("POST", `/sales/v1/orders/${order.id}/tickets`, { token: await flow.token(), body: { type: "complaint", subject: "司机迟到", description: "司机晚到了 20 分钟", language: "zh" } }), 201);
  return { orderId: order.id, sell: Number(detail.order.sell.amount), ticketId: created.ticket.id, ticketNo: created.ticket.ticket_no };
}

test("全部操作留审计（工单）：认领、转交、给供应商留言、内部备注、回复客人、征求供应商意见、供应商回复、判定、关闭各一条；前后的状态、处理人、结论、赔付金额都对；没权限被拒的不留记录", async () => {
  const t = await complaint();
  const cs = await login(support);
  await ok(api.call("POST", `/platform/v1/tickets/${t.ticketId}/assign`, { token: cs, body: {} }));
  await ok(api.call("POST", `/platform/v1/tickets/${t.ticketId}/assign`, { token: cs, body: { assignee_id: ops2.id } }));
  const o2 = await login(ops2);
  await ok(api.call("POST", `/platform/v1/tickets/${t.ticketId}/messages`, { token: o2, body: { body: "请说明司机到达时间" } }), 201);
  await ok(api.call("POST", `/platform/v1/tickets/${t.ticketId}/messages`, { token: o2, body: { body: "内部：客人语气很急", internal: true } }), 201);
  await ok(api.call("POST", `/platform/v1/tickets/${t.ticketId}/messages`, { token: o2, body: { body: "您好，我们正在核实", to_guest: true } }), 201);
  // 只读、财务没有 ticket.manage：被拒，不留记录
  assert.equal((await api.call("POST", `/platform/v1/tickets/${t.ticketId}/messages`, { token: await login(m.staff.readonly), body: { body: "x" } })).status, 403);
  assert.equal((await api.call("POST", `/platform/v1/tickets/${t.ticketId}/close`, { token: await login(finance1), body: { note: "x" } })).status, 403);
  await ok(api.call("POST", `/platform/v1/tickets/${t.ticketId}/request-reply`, { token: o2, body: { body: "请 24 小时内说明司机几点到的" } }));
  await ok(api.call("POST", `/tenant/v1/tickets/${t.ticketId}/messages`, { token: await tenantToken(m.b), body: { body: "司机 10:05 到达" } }), 201);
  const decided = await ok(api.call("POST", `/platform/v1/tickets/${t.ticketId}/decide`, { token: o2, body: { outcome: "upheld", note: "迟到属实", compensation: { scenario: "late_15_29", liable_party: "tenant" } } }));
  await ok(api.call("POST", `/platform/v1/tickets/${t.ticketId}/close`, { token: o2, body: { note: "已赔付" } }));

  const logs = await auditOf("ticket", t.ticketId);
  assert.deepEqual(logs.map(brief), [
    ["assign", support.email],
    ["assign", support.email],
    ["reply", ops2.email],
    ["note", ops2.email],
    ["reply", ops2.email],
    ["request_reply", ops2.email],
    ["reply", m.b.adminEmail],
    ["decide", ops2.email],
    ["close", ops2.email],
  ]);
  const [claim, transfer, toTenant, note, toGuest, ask, tenantReply, decide, close] = logs;
  assert.deepEqual([claim.before.status, claim.before.assignee_id, claim.after.status, claim.after.assignee_id], ["open", null, "in_progress", support.id]);
  assert.deepEqual([transfer.before.assignee_id, transfer.after.assignee_id], [support.id, ops2.id]);
  assert.deepEqual([toTenant.after.internal, toTenant.after.to_guest, toTenant.after.body], [false, false, "请说明司机到达时间"]);
  assert.deepEqual([note.after.internal, note.after.body], [true, "内部：客人语气很急"]);
  assert.deepEqual([toGuest.after.to_guest, toGuest.after.internal, toGuest.after.body], [true, false, "您好，我们正在核实"], "回复客人：审计里能和给供应商的留言分开");
  assert.deepEqual([ask.before.status, ask.after.status, typeof ask.after.tenant_reply_due_at], ["in_progress", "awaiting_tenant", "string"]);
  assert.deepEqual([tenantReply.actor.type, tenantReply.tenant_id, tenantReply.after.answered_request], ["tenant_user", m.b.tenantId, true]);
  assert.deepEqual([decide.before.status, decide.after.status, decide.after.outcome, decide.after.liable_party, decide.after.scenario], ["in_progress", "decided", "upheld", "tenant", "late_15_29"]);
  assert.equal(String(decide.after.customer_compensation_minor), decided.compensation.compensation.amount);
  assert.equal(String(decide.after.tenant_total_minor), decided.compensation.tenant_total.amount);
  assert.deepEqual([close.before.status, close.after.status, close.after.note], ["decided", "closed", "已赔付"]);
  for (const log of logs.filter((entry) => entry.actor.type === "platform_user")) assert.equal(log.tenant_id, null, "平台员工的操作记成平台级，供应商的操作日志里没有");
});

test("全部操作留审计（工单）：司机未到达到复核阈值——发起复核（双人复核）、批准后按判定执行（判定记在工单上）、财务登记另付已付；被拒的重复登记不留记录", async () => {
  const order = await flow.paidOrder({ serviceTime: iso(api.clock.now().getTime() + 3 * DAY) });
  const created = await ok(api.call("POST", "/platform/v1/tickets", { token: await login(support), body: { type: "fulfilment_failure", order_id: order.id, subject: "司机没来", description: "客人自己打车" } }), 201);
  const ticketId = created.ticket.id;
  const requested = await ok(api.call("POST", `/platform/v1/tickets/${ticketId}/decide`, { token: await login(support), body: { outcome: "upheld", note: "司机未到", compensation: { scenario: "driver_no_show", liable_party: "tenant", reimbursement_amount: 20_000 } } }), 202);
  await ok(api.call("POST", `/platform/v1/approvals/${requested.approval.id}/approve`, { token: await login(ops2), body: {} }));
  await ok(api.call("POST", `/platform/v1/tickets/${ticketId}/payout`, { token: await login(finance1), body: { reference: "BANK-20261026-001" } }));
  assert.equal((await api.call("POST", `/platform/v1/tickets/${ticketId}/payout`, { token: await login(finance1), body: { reference: "again" } })).status, 409);

  const logs = await auditOf("ticket", ticketId);
  assert.deepEqual(logs.map(brief), [["create", support.email], ["decide", ops2.email], ["pay", finance1.email]]);
  assert.deepEqual([logs[1].before.status, logs[1].after.status, logs[1].after.outcome], ["pending_review", "decided", "upheld"]);
  assert.deepEqual([logs[2].before.payout_status, logs[2].after.payout_status, logs[2].after.reference, logs[2].after.amount_minor], ["pending", "paid", "BANK-20261026-001", 20_000]);
  const approval = await auditOf("approval", requested.approval.id);
  assert.deepEqual(approval.map(brief), [["request", support.email], ["approve", ops2.email]]);
  assert.deepEqual([approval[0].after.kind, approval[0].after.resource_id], ["ticket.decision", ticketId]);
});

test("全部操作留审计（赔付表）：运营发起修改（双人复核）、财务批准——改前改后整张表都在审计里", async () => {
  const before = (await ok(api.call("GET", "/platform/v1/compensation-table", { token: await login(ops2) }))).compensation_table;
  const base = { customer_bp: Object.fromEntries(before.scenarios.map((s: any) => [s.scenario, s.customer_bp])), minimum_jpy: before.minimum_jpy, reimbursement_cap_bp: before.reimbursement_cap_bp, review_at_or_above_sell_bp: before.review_at_or_above_sell_bp };
  const oldNoSignboard = base.customer_bp["no_signboard"];
  const requested = await ok(api.call("POST", "/platform/v1/compensation-table/changes", { token: await login(ops2), body: { ...base, customer_bp: { ...base.customer_bp, no_signboard: 1_234 }, minimum_jpy: 600, note: "举牌投诉多" } }), 202);
  await ok(api.call("POST", `/platform/v1/approvals/${requested.approval.id}/approve`, { token: await login(finance1), body: {} }));
  const version = String(before.version + 1);
  const logs = await auditOf("compensation_table", version);
  assert.deepEqual(logs.map(brief), [["update", finance1.email]]);
  assert.equal(logs[0].before.rules.customerBp?.no_signboard ?? logs[0].before.rules.customer_bp?.no_signboard, oldNoSignboard);
  assert.equal(logs[0].after.rules.customerBp?.no_signboard ?? logs[0].after.rules.customer_bp?.no_signboard, 1_234);
  assert.deepEqual([logs[0].after.version, logs[0].after.requested_by], [before.version + 1, ops2.email]);
  const approval = await auditOf("approval", requested.approval.id);
  assert.deepEqual(approval.map(brief), [["request", ops2.email], ["approve", finance1.email]]);
  assert.match(approval[0].after.summary, /12\.34%/);
});

test("全部操作留审计（财务结算）：出账、供应商提异议、答复、作废并重出（新账单也记出账）、供应商确认、发起付款复核、批准、锁定付款批次；供应商的操作日志只有它自己的两步，看不到付款复核的说明", async () => {
  const seeded = await seedOrder(api, m, "a", { serviceAt: new Date("2026-09-10T10:00:00+09:00"), confirmedAt: new Date("2026-09-07T10:00:00+09:00") });
  await api.db.owner.query("update orders set status = 'completed', settlement_minor = 20000 where tenant_id = $1 and id = $2", [m.a.tenantId, seeded.id]);
  const fin1 = await login(finance1);
  const generated = await ok(api.call("POST", "/platform/v1/statements/generate", { token: fin1, body: { period: "2026-09" } }));
  const first = generated.created.find((entry: any) => entry.tenant.id === m.a.tenantId);
  assert.ok(first, "出了甲的账单");
  await ok(api.call("POST", `/tenant/v1/statements/${first.id}/dispute`, { token: await tenantToken(m.a), body: { reason: "少了一单" } }));
  await ok(api.call("POST", `/platform/v1/statements/${first.id}/reply`, { token: await login(finance1), body: { note: "核对过，没有少" } }));
  const voided = await ok(api.call("POST", `/platform/v1/statements/${first.id}/void`, { token: await login(finance1), body: { reason: "订单金额更正后重出" } }));
  const second = voided.reissued.find((entry: any) => entry.tenant.id === m.a.tenantId);
  assert.ok(second, "重出了一张");
  await ok(api.call("POST", `/tenant/v1/statements/${second.id}/confirm`, { token: await tenantToken(m.a), body: {} }));
  const INTERNAL_NOTE = "银行账户已核对：内部说明";
  const requested = await ok(api.call("POST", `/platform/v1/statements/${second.id}/payout-approval`, { token: await login(finance1), body: { note: INTERNAL_NOTE } }), 202);
  await ok(api.call("POST", `/platform/v1/approvals/${requested.approval.id}/approve`, { token: await login(finance2), body: {} }));
  const approved = await ok(api.call("GET", `/platform/v1/statements/${second.id}`, { token: await login(finance1) }));
  const batchId = approved.statement.payout_batch_id;
  assert.ok(batchId, "进了付款批次");
  await ok(api.call("POST", `/platform/v1/payout-batches/${batchId}/close`, { token: await login(finance1), body: {} }));

  const firstLogs = await auditOf("statement", first.id);
  assert.deepEqual(firstLogs.map(brief), [["issue", finance1.email], ["dispute", m.a.adminEmail], ["reply", finance1.email], ["void", finance1.email]]);
  assert.deepEqual([firstLogs[0].after.total_minor, firstLogs[0].after.period, firstLogs[0].after.currency], [20_000, "2026-09", "JPY"]);
  assert.deepEqual([firstLogs[1].before.status, firstLogs[1].after.status, firstLogs[1].after.reason, firstLogs[1].tenant_id], ["issued", "disputed", "少了一单", m.a.tenantId]);
  assert.deepEqual([firstLogs[2].before.status, firstLogs[2].after.status, firstLogs[2].after.note], ["disputed", "issued", "核对过，没有少"]);
  assert.deepEqual([firstLogs[3].before.status, firstLogs[3].after.status, firstLogs[3].after.reason], ["issued", "void", "订单金额更正后重出"]);
  const secondLogs = await auditOf("statement", second.id);
  assert.deepEqual(secondLogs.map(brief), [["issue", finance1.email], ["confirm", m.a.adminEmail], ["approve", finance2.email]]);
  assert.deepEqual([secondLogs[2].before.status, secondLogs[2].after.status, secondLogs[2].after.payout_batch_id], ["confirmed", "in_payout", batchId]);
  const approvalLogs = await auditOf("approval", requested.approval.id);
  assert.deepEqual(approvalLogs.map(brief), [["request", finance1.email], ["approve", finance2.email]]);
  assert.deepEqual([approvalLogs[0].after.kind, approvalLogs[0].after.resource_id], ["statement.payout", second.id]);
  const batchLogs = await auditOf("payout_batch", batchId);
  assert.deepEqual(batchLogs.map(brief), [["close", finance1.email]]);
  assert.deepEqual([batchLogs[0].before.status, batchLogs[0].after.status], ["open", "closed"]);

  // 供应商的操作日志：只有它自己的提异议、确认；没有付款复核的内部说明、平台员工的邮箱
  const own = await api.call("GET", "/tenant/v1/audit-logs?limit=100", { token: await tenantToken(m.a) });
  assert.equal(own.status, 200, own.text);
  const statementLogs = own.body.items.filter((log: any) => log.resource === "statement");
  assert.deepEqual(statementLogs.map((log: any) => log.action).sort(), ["confirm", "dispute"]);
  assertNoValues(own.body, { 付款复核的说明: INTERNAL_NOTE, 财务1: finance1.email, 财务2: finance2.email, 财务1编号: finance1.id }, "供应商的操作日志");
  const tenantView = await ok(api.call("GET", `/tenant/v1/statements/${second.id}`, { token: await tenantToken(m.a) }));
  assertNoValues(tenantView, { 付款复核的说明: INTERNAL_NOTE, 财务1编号: finance1.id, 财务2编号: finance2.id, 复核编号: requested.approval.id, 付款批次编号: batchId }, "供应商的账单详情");
});

// ---- 同事名单 ----

test("同事名单：每个平台员工都能看（含只读）；只有编号、姓名、是否在用，没有邮箱、角色；没激活的不列，停用的写不在用；供应商、渠道、官网、没登录的都拿不到", async () => {
  const pending = await ok(api.call("POST", "/platform/v1/staff", { token: await root(), body: { email: "pending@platform.test", name: "还没激活的人", role: "customer_service" } }), 201);
  const leaver = await addStaff(api, await root(), "leaver@platform.test", "customer_service");
  await ok(api.call("POST", `/platform/v1/staff/${leaver.id}/disable`, { token: await root(), body: {} }));

  for (const token of [await login(m.staff.readonly), await login(support), await login(finance1)]) {
    const res = await api.call("GET", "/platform/v1/colleagues", { token });
    assertMatchesOpenApi("GET", "/platform/v1/colleagues", res);
    assert.equal(res.status, 200, res.text);
    assert.deepEqual([...allKeys(res.body)].sort(), ["active", "id", "items", "name"]);
    const byId = new Map(res.body.items.map((item: any) => [item.id, item]));
    assert.deepEqual(byId.get(support.id), { id: support.id, name: "cs", active: true });
    assert.deepEqual(byId.get(leaver.id), { id: leaver.id, name: "leaver", active: false });
    assert.equal(byId.has(pending.user.id), false, "没激活的不列");
    assertNoValues(res.body, { 邮箱: support.email, 角色: "customer_service" }, "同事名单");
  }
  const tenant = await api.call("GET", "/platform/v1/colleagues", { token: await tenantToken(m.b) });
  const channel = await api.call("GET", "/platform/v1/colleagues", { token: await flow.token() });
  const anonymous = await api.call("GET", "/platform/v1/colleagues");
  assert.deepEqual([tenant.status, channel.status, anonymous.status], [401, 401, 401]);
  for (const res of [tenant, channel, anonymous]) assertNoValues(res.body, { 姓名: "cs", 编号: support.id }, "被拒的应答");
  // 官网、销售端、租户端没有同名的接口
  for (const path of ["/site/v1/colleagues", "/sales/v1/colleagues", "/tenant/v1/colleagues"]) assert.equal((await api.call("GET", path, { token: await tenantToken(m.b) })).status, 404, path);
});

// ---- 规则 4：供应商看不到的 ----

test("规则 4（字段 + 值）：工单判定后，供应商的工单列表、详情、应扣款项、操作日志里没有对外价、加价比例、客人赔付和退款金额、内部备注、给客人的回复、平台员工；渠道和官网看得到回复但没有内部备注、供应商承担的金额", async () => {
  const t = await complaint();
  const o2 = await login(ops2);
  const NOTE = "内部：这家供应商本月第三次迟到";
  const REPLY = "您好，平台会按赔付标准补偿您 2,178 日元";
  await ok(api.call("POST", `/platform/v1/tickets/${t.ticketId}/assign`, { token: o2, body: {} }));
  await ok(api.call("POST", `/platform/v1/tickets/${t.ticketId}/messages`, { token: o2, body: { body: NOTE, internal: true } }), 201);
  await ok(api.call("POST", `/platform/v1/tickets/${t.ticketId}/messages`, { token: o2, body: { body: REPLY, to_guest: true } }), 201);
  const decided = await ok(api.call("POST", `/platform/v1/tickets/${t.ticketId}/decide`, { token: o2, body: { outcome: "upheld", note: "迟到属实", compensation: { scenario: "late_15_29", liable_party: "tenant" } } }));
  // 判定之后、关闭之前还能回复客人
  const REPLY2 = "补偿已原路退回您的银行卡";
  await ok(api.call("POST", `/platform/v1/tickets/${t.ticketId}/messages`, { token: o2, body: { body: REPLY2, to_guest: true } }), 201);
  const customer = decided.compensation.compensation.amount;
  const refund = decided.compensation.refund.amount;
  const tenantTotal = decided.compensation.tenant_total.amount;
  assert.notEqual(customer, tenantTotal, "客人赔付和供应商承担不同，才能按值区分");
  const sale = (await api.db.owner.query("select sell_minor, markup_bp from order_sales where order_id = $1", [t.orderId])).rows[0];
  const forbidden = { 对外价: sale.sell_minor, 加价比例: sale.markup_bp, 客人赔付: customer, 退款: refund, 内部备注: NOTE, 给客人的回复: REPLY, 第二条回复: REPLY2, 处理人: ops2.id, 处理人邮箱: ops2.email, 处理人姓名: "ops2" };

  const token = await tenantToken(m.b);
  const responses = {
    工单列表: await api.call("GET", "/tenant/v1/tickets", { token }),
    按订单的工单列表: await api.call("GET", `/tenant/v1/tickets?order_id=${t.orderId}`, { token }),
    工单详情: await api.call("GET", `/tenant/v1/tickets/${t.ticketId}`, { token }),
    应扣款项: await api.call("GET", "/tenant/v1/deductions", { token }),
    操作日志: await api.call("GET", "/tenant/v1/audit-logs?limit=100", { token }),
  };
  for (const [where, res] of Object.entries(responses)) {
    assert.equal(res.status, 200, `${where}：${res.text}`);
    // 加价 10% 和「迟到 15–29 分钟」的赔付比例 10% 都是 1000 基点：1000 只许出现在应扣款项依据的比例（basis.bp）上
    assertNoValues(res.body, forbidden, `供应商的${where}`, { 加价比例: ["bp"] });
    const keys = allKeys(res.body);
    for (const key of ["sell", "markup_bp", "notes", "replies", "to_guest", "compensation", "refund", "manual_payout", "assignee_id", "decided_by"]) assert.ok(!keys.has(key), `供应商的${where}里有字段 ${key}`);
  }
  assert.ok(allValues(responses.工单详情.body).has(tenantTotal), "供应商看得到自己承担的金额");

  // 渠道：看得到两条回复（按时间），没有内部备注、供应商承担的金额、员工
  const channel = await ok(api.call("GET", `/sales/v1/orders/${t.orderId}/tickets`, { token: await flow.token() }));
  const item = channel.items.find((entry: any) => entry.id === t.ticketId);
  assert.deepEqual(item.replies.map((reply: any) => reply.body), [REPLY, REPLY2]);
  assertNoValues(channel, { 内部备注: NOTE, 供应商承担: tenantTotal, 处理人: ops2.id, 处理人姓名: "ops2", 结算价: 19_800 }, "渠道的工单列表");
});

// ---- 官网 ----

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

let ipSeq = 0;
const nextIp = (): string => `198.51.100.${(ipSeq++ % 200) + 20}`;

test("官网：客人只看到自己这一单的工单和平台的回复（不带员工、没有内部备注）；令牌放在地址参数、Cookie 里不认（401），只认 Authorization 头", async () => {
  const mine = await siteOrder("客人甲");
  const other = await siteOrder("客人乙");
  const created = await site.call("POST", "/site/v1/order/tickets", { token: mine.link, ip: nextIp(), body: { type: "complaint", subject: "司机迟到", description: "晚到 20 分钟" } });
  assert.equal(created.status, 201, created.text);
  const otherCreated = await site.call("POST", "/site/v1/order/tickets", { token: other.link, ip: nextIp(), body: { type: "other", subject: "发票", description: "要发票" } });
  assert.equal(otherCreated.status, 201, otherCreated.text);
  const o2 = await login(ops2);
  const OWN_REPLY = "甲：我们正在核实";
  const OTHER_REPLY = "乙：发票已开好";
  const NOTE = "内部：客人甲是常客";
  await ok(api.call("POST", `/platform/v1/tickets/${created.body.ticket.id}/messages`, { token: o2, body: { body: OWN_REPLY, to_guest: true } }), 201);
  await ok(api.call("POST", `/platform/v1/tickets/${created.body.ticket.id}/messages`, { token: o2, body: { body: NOTE, internal: true } }), 201);
  await ok(api.call("POST", `/platform/v1/tickets/${otherCreated.body.ticket.id}/messages`, { token: o2, body: { body: OTHER_REPLY, to_guest: true } }), 201);

  const listed = await site.call("GET", "/site/v1/order/tickets", { token: mine.link, ip: nextIp() });
  assertMatchesOpenApi("GET", "/site/v1/order/tickets", listed);
  assert.equal(listed.status, 200, listed.text);
  assert.deepEqual(listed.body.items.map((item: any) => item.id), [created.body.ticket.id]);
  assert.deepEqual(listed.body.items[0].replies.map((reply: any) => reply.body), [OWN_REPLY]);
  assert.deepEqual(Object.keys(listed.body.items[0].replies[0]).sort(), ["body", "created_at"]);
  assertNoValues(listed.body, { 别人的回复: OTHER_REPLY, 内部备注: NOTE, 员工编号: ops2.id, 员工姓名: "ops2", 员工邮箱: ops2.email, 别人的工单: otherCreated.body.ticket.id, 供应商: m.b.tenantId }, "官网客人的工单列表");

  // 令牌只认 Authorization 头
  const viaQuery = await site.call("GET", `/site/v1/order/tickets?token=${encodeURIComponent(mine.link)}`, { ip: nextIp() });
  const viaCookie = await site.call("GET", "/site/v1/order/tickets", { ip: nextIp(), headers: { cookie: `token=${mine.link}; link=${mine.link}` } });
  const postViaQuery = await site.call("POST", `/site/v1/order/tickets?token=${encodeURIComponent(mine.link)}`, { ip: nextIp(), body: { type: "other", subject: "x", description: "x" } });
  assert.deepEqual([viaQuery.status, viaCookie.status, postViaQuery.status], [401, 401, 401]);
  assertNoValues(viaQuery.body, { 回复: OWN_REPLY }, "没带头的应答");
});

test("官网投诉 14 天边界：服务完成后正好 14 天还能投诉（201），多 1 毫秒 409 COMPLAINT_WINDOW_CLOSED；失物招领不受限制；同一单最多 10 张，第 11 张 409 TICKET_LIMIT_REACHED（客人和渠道提的一起算）", async () => {
  const order = await siteOrder("客人丙");
  await completeOrder(api, m, "b", order.id);
  const completedAt = new Date((await ok(api.call("GET", `/platform/v1/orders/${order.id}`, { token: await root() }))).order.fulfilment.completed_at).getTime();
  api.clock.advance(completedAt + 14 * DAY - api.clock.now().getTime());
  const onTime = await site.call("POST", "/site/v1/order/tickets", { token: order.link, ip: nextIp(), body: { type: "complaint", subject: "迟到", description: "x" } });
  assert.equal(onTime.status, 201, onTime.text);
  api.clock.advance(1);
  const late = await site.call("POST", "/site/v1/order/tickets", { token: order.link, ip: nextIp(), body: { type: "complaint", subject: "迟到", description: "x" } });
  assert.deepEqual([late.status, late.body?.error?.code], [409, "COMPLAINT_WINDOW_CLOSED"]);
  for (let i = 2; i <= 10; i++) {
    api.clock.advance(1_000);
    const res = await site.call("POST", "/site/v1/order/tickets", { token: order.link, ip: nextIp(), body: { type: i % 2 === 0 ? "lost_and_found" : "other", subject: `第 ${i} 张`, description: "x" } });
    assert.equal(res.status, 201, `第 ${i} 张：${res.text}`);
  }
  api.clock.advance(1_000);
  const eleventh = await site.call("POST", "/site/v1/order/tickets", { token: order.link, ip: nextIp(), body: { type: "lost_and_found", subject: "伞", description: "x" } });
  assert.deepEqual([eleventh.status, eleventh.body?.error?.code], [409, "TICKET_LIMIT_REACHED"]);
  const listed = await site.call("GET", "/site/v1/order/tickets", { token: order.link, ip: nextIp() });
  assert.equal(listed.body.items.length, 10);
});
