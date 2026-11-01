/**
 * M4-18 测试角色补充：运营代供应商回传履约（ADR 0052），经真实接口、真实 PostgreSQL；收款服务用替身。
 * 只补 proxy-fulfilment.itest.ts 没覆盖的：复核不能绕（并发、撤回、内容不能换）、发生时间（毫秒边界、时区、账单归属、试运营计数）、
 * 状态机（改派、司机和供应商接着做、取消约束）、权限（全部内置角色、半勾的自建角色、审核的数据范围）、隐私（完成事件、Webhook、通知、司机端）、原因的内容。
 * 数据都在测试里构造，随测试 schema 删除（规则 1）。会大幅拨时钟的测试用自己的库。
 */
import { type TestContext, after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadTrialProgress } from "./repos/tenant-onboarding.ts";
import type { Db } from "./db/context.ts";
import { LOCAL_WEBHOOK_HOST, TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";
import { assign, newDriver, newVehicle } from "./testing/dispatch.ts";
import { type Market, type Staff, addStaff, allKeys, buildMarket, ok } from "./testing/market.ts";
import { platformLogin, tenantLogin, uploadReceipt } from "./testing/money.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";

const HOUR = 3_600_000;
const MINUTE = 60_000;
const REASON = "虚构原因：调度系统故障，电话确认";

interface Rig {
  api: TestApi;
  m: Market;
  flow: SalesFlow;
  finance: Staff;
  ops2: Staff;
}

async function newRig(): Promise<Rig> {
  const pay = new FakePaymentProvider();
  const api = await createTestApi({ payments: pay });
  const m = await buildMarket(api);
  const flow = await salesFlow(api, m, pay);
  return { api, m, flow, finance: await addStaff(api, m.root, "finance@platform.test", "finance"), ops2: await addStaff(api, m.root, "ops2@platform.test", "operations") };
}

async function ownRig(t: TestContext): Promise<Rig> {
  const rig = await newRig();
  t.after(() => rig.api.close());
  return rig;
}

let shared: Rig;
before(async () => {
  shared = await newRig();
  const hook = await shared.api.call("PUT", "/tenant/v1/webhooks", { token: await tenantLogin(shared.api, shared.m.b.adminEmail), body: { url: `https://${LOCAL_WEBHOOK_HOST}/hook`, events: ["order.status_changed"] } });
  assert.equal(hook.status, 201, hook.text);
});
after(() => shared.api.close());

const iso = (ms: number): string => new Date(ms).toISOString();
const nowMs = (r: Rig): number => r.api.clock.now().getTime();
const ops = (r: Rig): Promise<string> => platformLogin(r.api, r.m.staff.operations.email);

async function paidOrder(r: Rig, hours = 1): Promise<string> {
  const id = (await r.flow.paidOrder({ serviceTime: iso(nowMs(r) + 72 * HOUR).replace(/\.\d{3}Z$/, "Z") })).id;
  await r.api.db.owner.query("update orders set service_at = $2 where id = $1", [id, new Date(nowMs(r) + hours * HOUR)]);
  return id;
}

async function dispatched(r: Rig, hours = 1): Promise<{ orderId: string; tenantToken: string; driverToken: string }> {
  const orderId = await paidOrder(r, hours);
  const tenantToken = await tenantLogin(r.api, r.m.b.adminEmail);
  const who = { ...r.m.b, adminToken: tenantToken };
  const result = await ok(assign(r.api, who, orderId, (await newDriver(r.api, who)).id, (await newVehicle(r.api, who, r.m.ids.biz7)).id));
  r.api.clock.advance(MINUTE);
  return { orderId, tenantToken, driverToken: result.driver_link.token };
}

const detailOf = async (r: Rig, orderId: string, token?: string): Promise<any> => ok(r.api.call("GET", `/platform/v1/orders/${orderId}`, { token: token ?? (await ops(r)) }));

async function proxy(r: Rig, orderId: string, body: Record<string, unknown>, token?: string, version?: number) {
  const who = token ?? (await ops(r));
  const current = version ?? (await detailOf(r, orderId)).order.version;
  return r.api.call("POST", `/platform/v1/orders/${orderId}/events`, { token: who, headers: { "if-match": String(current) }, body: { occurred_at: iso(nowMs(r)), reason: REASON, ...body } });
}

async function inService(r: Rig, orderId: string): Promise<void> {
  for (const type of ["departed", "arrived", "picked_up"]) {
    await ok(proxy(r, orderId, { type }));
    r.api.clock.advance(MINUTE);
  }
}

const decide = (r: Rig, approvalId: string, decision: "approve" | "reject" | "withdraw", token: string, body: Record<string, unknown> = {}) => r.api.call("POST", `/platform/v1/approvals/${approvalId}/${decision}`, { token, body });
const financeToken = (r: Rig): Promise<string> => platformLogin(r.api, r.finance.email);
const ops2Token = (r: Rig): Promise<string> => platformLogin(r.api, r.ops2.email);
const completedEvents = async (r: Rig, orderId: string): Promise<number> => (await r.api.db.owner.query("select 1 from order_events where order_id = $1 and to_status = 'completed'", [orderId])).rowCount ?? 0;

/** 一张在服务中、代传完成等复核的单。 */
async function pendingCompletion(r: Rig, body: Record<string, unknown> = {}): Promise<{ orderId: string; approvalId: string; tenantToken: string; driverToken: string; occurredAt: string }> {
  const trip = await dispatched(r);
  await inService(r, trip.orderId);
  const occurredAt = iso(nowMs(r));
  const asked = await ok(proxy(r, trip.orderId, { type: "completed", occurred_at: occurredAt, ...body }), 202);
  return { ...trip, approvalId: asked.approval.id, occurredAt };
}

async function scopedStaff(r: Rig, name: string, scope: { city_ids: string[] | null; channel_ids: string[] | null }, grants: string[]): Promise<string> {
  const role = await ok(r.api.call("POST", "/platform/v1/roles", { token: r.m.root, body: { name, grants, data_scope: scope } }), 201);
  const email = `scope-${randomUUID().slice(0, 8)}@platform.test`;
  const invited = await ok(r.api.call("POST", "/platform/v1/staff", { token: r.m.root, body: { email, name, role: role.key } }), 201);
  await ok(r.api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.invite.token, password: TEST_PASSWORD } }));
  return platformLogin(r.api, email);
}

const ALL_FREE = { city_ids: null, channel_ids: null };

// ---- 复核不能绕 ----

test("请求内容在批准时不能被替换：批准请求里夹带发生时间、原因、实际里程，结果还是发起时的内容", async () => {
  const r = shared;
  const { orderId, approvalId, occurredAt } = await pendingCompletion(r);
  r.api.clock.advance(MINUTE);
  const swapped = iso(nowMs(r) - 30 * MINUTE);
  const smuggled = await decide(r, approvalId, "approve", await financeToken(r), { occurred_at: swapped, reason: "换掉的原因", actual: { minutes: 1, km: 1 }, payload: { occurred_at: swapped } });
  assert.equal(smuggled.status, 400, smuggled.text);
  assert.equal(await completedEvents(r, orderId), 0, "夹带被拒时不能生效一半");
  await ok(decide(r, approvalId, "approve", await financeToken(r)));
  const detail = await detailOf(r, orderId);
  assert.deepEqual([detail.order.status, detail.order.fulfilment.completed_at, detail.order.fulfilment.actual_km, detail.events.at(-1).proxy.reason], ["completed", occurredAt, null, REASON]);
});

test("两人同时批准：只有一个成功，另一个 409 APPROVAL_NOT_PENDING；流水、Webhook、审计都只有一条", async () => {
  const r = shared;
  const { orderId, approvalId } = await pendingCompletion(r);
  const [a, b] = await Promise.all([decide(r, approvalId, "approve", await financeToken(r)), decide(r, approvalId, "approve", await ops2Token(r))]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409], `${a.text} ${b.text}`);
  assert.equal((a.status === 409 ? a : b).body.error.code, "APPROVAL_NOT_PENDING");
  assert.equal(await completedEvents(r, orderId), 1);
  assert.equal((await r.api.db.owner.query("select 1 from webhook_deliveries where order_id = $1 and event_type = 'order.status_changed' and event_data->>'to_status' = 'completed'", [orderId])).rowCount, 1);
  assert.equal((await r.api.db.owner.query("select 1 from audit_logs where resource = 'approval' and resource_id = $1 and action = 'approve'", [approvalId])).rowCount, 1);
});

test("同时发起两次完成：只有一条待复核，另一个 409 PROXY_COMPLETION_PENDING", async () => {
  const r = shared;
  const { orderId } = await dispatched(r);
  await inService(r, orderId);
  const version = (await detailOf(r, orderId)).order.version;
  const [a, b] = await Promise.all([proxy(r, orderId, { type: "completed" }, await ops(r), version), proxy(r, orderId, { type: "completed" }, await ops2Token(r), version)]);
  assert.deepEqual([a.status, b.status].sort(), [202, 409], `${a.text} ${b.text}`);
  assert.equal((a.status === 409 ? a : b).body.error.code, "PROXY_COMPLETION_PENDING");
  assert.equal((await r.api.db.owner.query("select 1 from approvals where kind = 'order.proxy_complete' and resource_id = $1 and status = 'pending'", [orderId])).rowCount, 1);
});

test("批准和供应商、司机同时完成：只完成一次；后到的批准是 APPROVAL_STALE，后到的回传是 409", async () => {
  const r = shared;
  for (let round = 0; round < 4; round += 1) {
    const { orderId, approvalId, tenantToken, driverToken } = await pendingCompletion(r);
    const reviewer = await financeToken(r);
    const other = round % 2 === 0 ? r.api.call("POST", `/tenant/v1/orders/${orderId}/events`, { token: tenantToken, body: { type: "completed" } }) : r.api.call("POST", "/driver/v1/trip/events", { token: driverToken, body: { type: "completed" } });
    const [report, approve] = await Promise.all([other, decide(r, approvalId, "approve", reviewer)]);
    assert.deepEqual([report.status, approve.status].sort(), [200, 409], `${report.text} ${approve.text}`);
    if (approve.status === 409) assert.equal(approve.body.error.code, "APPROVAL_STALE");
    else assert.equal(report.body.error.code, "ORDER_STATE_INVALID");
    assert.equal(await completedEvents(r, orderId), 1);
    assert.equal((await detailOf(r, orderId)).order.status, "completed");
  }
});

test("撤回：别人撤不了；撤回后不能批准也不生效；批准后不能再撤回、驳回", async () => {
  const r = shared;
  const first = await pendingCompletion(r);
  const notMine = await decide(r, first.approvalId, "withdraw", await ops2Token(r));
  assert.deepEqual([notMine.status, notMine.body.error.code], [409, "APPROVAL_NOT_REQUESTER"]);
  await ok(decide(r, first.approvalId, "withdraw", await ops(r)));
  const late = await decide(r, first.approvalId, "approve", await financeToken(r));
  assert.deepEqual([late.status, late.body.error.code], [409, "APPROVAL_NOT_PENDING"]);
  const detail = await detailOf(r, first.orderId);
  assert.deepEqual([detail.order.status, detail.order.fulfilment.completed_at], ["in_service", null]);

  const second = await pendingCompletion(r);
  await ok(decide(r, second.approvalId, "approve", await financeToken(r)));
  for (const [decision, token] of [["withdraw", await ops(r)], ["reject", await ops2Token(r)]] as const) {
    const res = await decide(r, second.approvalId, decision, token);
    assert.deepEqual([res.status, res.body.error.code], [409, "APPROVAL_NOT_PENDING"], decision);
  }
  assert.equal((await detailOf(r, second.orderId)).order.status, "completed");
});

test("超级管理员也不能批、不能驳回自己发起的；驳回后订单仍在服务中，没有完成事件", async () => {
  const r = shared;
  const { orderId } = await dispatched(r);
  await inService(r, orderId);
  const root = await platformLogin(r.api, "root@platform.test");
  const asked = await ok(proxy(r, orderId, { type: "completed" }, root), 202);
  for (const decision of ["approve", "reject"] as const) {
    const res = await decide(r, asked.approval.id, decision, root);
    assert.deepEqual([res.status, res.body.error.code], [409, "APPROVAL_SELF_REVIEW"], decision);
  }
  await ok(decide(r, asked.approval.id, "reject", await financeToken(r), { note: "虚构：司机说还没跑完" }));
  assert.equal((await detailOf(r, orderId)).order.status, "in_service");
  assert.equal(await completedEvents(r, orderId), 0);
});

test("批准时订单已经不在服务中（已取消、救援中、no-show 待审核、客人未出现）：APPROVAL_STALE，状态不变、记录仍待审核", async () => {
  const r = shared;
  for (const status of ["cancelled", "rescue_pending", "no_show_claimed", "no_show"]) {
    const { orderId, approvalId } = await pendingCompletion(r);
    await r.api.db.owner.query("update orders set status = $2, cancelled_at = case when $2 = 'cancelled' then now() end, cancel_reason = case when $2 = 'cancelled' then 'FORCE_MAJEURE' end where id = $1", [orderId, status]);
    const res = await decide(r, approvalId, "approve", await financeToken(r));
    assert.deepEqual([res.status, res.body.error.code], [409, "APPROVAL_STALE"], status);
    assert.equal((await r.api.db.owner.query("select status from orders where id = $1", [orderId])).rows[0].status, status);
    assert.equal((await r.api.db.owner.query("select status from approvals where id = $1", [approvalId])).rows[0].status, "pending");
    assert.equal(await completedEvents(r, orderId), 0, status);
  }
});

test("复核待定时：取消、改派都被现有约束挡住，所以批准的前提不会被悄悄改掉", async () => {
  const r = shared;
  const { orderId, approvalId, tenantToken } = await pendingCompletion(r);
  const sales = await r.api.call("POST", `/sales/v1/orders/${orderId}/cancel`, { token: await r.flow.token(), body: {} });
  assert.equal(sales.status, 409, sales.text);
  const platform = await r.api.call("POST", `/platform/v1/orders/${orderId}/cancel`, { token: await ops(r), body: { reason: "GUEST_REQUEST", note: "虚构" } });
  assert.equal(platform.status, 409, platform.text);
  const who = { ...r.m.b, adminToken: tenantToken };
  const reassign = await assign(r.api, who, orderId, (await newDriver(r.api, who)).id, (await newVehicle(r.api, who, r.m.ids.biz7)).id);
  assert.equal(reassign.status, 409, reassign.text);
  await ok(decide(r, approvalId, "approve", await financeToken(r)));
  assert.equal((await detailOf(r, orderId)).order.status, "completed");
});

// ---- 发生时间 ----

test("发生时间的格式和时区：带时区的换算成同一时刻，不带时区、只有日期、不存在的日期都拒绝", async () => {
  const r = shared;
  const { orderId } = await dispatched(r);
  const version = (await detailOf(r, orderId)).order.version;
  for (const bad of ["2026-10-07T10:00:00", "2026-10-07", "2026-13-01T00:00:00Z", "2026-02-30T00:00:00Z", "昨天", 1_790_000_000_000]) {
    const res = await proxy(r, orderId, { type: "departed", occurred_at: bad }, undefined, version);
    assert.equal(res.status, 400, `${String(bad)}: ${res.text}`);
  }
  // 现在这一刻按东京时间写（+09:00）
  const at = r.api.clock.now();
  const tokyo = `${new Date(at.getTime() + 9 * HOUR).toISOString().slice(0, 19)}+09:00`;
  await ok(proxy(r, orderId, { type: "departed", occurred_at: tokyo }, undefined, version));
  assert.equal((await detailOf(r, orderId)).order.fulfilment.departed_at, `${at.toISOString().slice(0, 19)}.000Z`);
});

test("毫秒边界：等于现在通过，晚 1 毫秒拒绝；比上一个节点所在分钟早 1 毫秒拒绝，同一分钟内按上一个节点的时间写入", async () => {
  const r = shared;
  const { orderId } = await dispatched(r);
  const detail = await detailOf(r, orderId);
  const version = detail.order.version;
  const assignedAt = new Date(detail.order.dispatch.assigned_at).getTime();
  const minuteStart = Math.floor(assignedAt / MINUTE) * MINUTE;
  const reasonOf = async (at: number): Promise<string> => (await proxy(r, orderId, { type: "departed", occurred_at: iso(at) }, undefined, version)).body.error.details.issues[0].reason;
  assert.equal(await reasonOf(nowMs(r) + 1), "IN_FUTURE");
  assert.equal(await reasonOf(minuteStart - 1), "BEFORE_PREVIOUS");
  await ok(proxy(r, orderId, { type: "departed", occurred_at: iso(minuteStart) }, undefined, version));
  assert.equal((await detailOf(r, orderId)).order.fulfilment.departed_at, iso(Math.max(minuteStart, assignedAt)));
  r.api.clock.advance(MINUTE);
  await ok(proxy(r, orderId, { type: "arrived", occurred_at: iso(nowMs(r)) }));
  const events = (await detailOf(r, orderId)).events.map((event: any) => new Date(event.occurred_at).getTime());
  assert.deepEqual(events, [...events].sort((x, y) => x - y), "流水的时间不倒退");
});

test("跨午夜：复核摘要按城市当地日期写，不是 UTC 日期", async () => {
  const r = await newRigAtTokyoJustAfterMidnight();
  try {
    const { approvalId } = await pendingCompletion(r);
    const approval = await ok(r.api.call("GET", `/platform/v1/approvals/${approvalId}`, { token: await financeToken(r) }));
    const local = new Date(nowMs(r) + 9 * HOUR).toISOString().slice(0, 10);
    const utc = r.api.clock.now().toISOString().slice(0, 10);
    assert.notEqual(local, utc, "这个用例要求东京和 UTC 不在同一天");
    assert.ok((approval.approval ?? approval).summary.includes(local), (approval.approval ?? approval).summary);
  } finally {
    await r.api.close();
  }
});

async function newRigAtTokyoJustAfterMidnight(): Promise<Rig> {
  const r = await newRig();
  // 起始时钟是 01:00Z；拨到当天 15:30Z（东京次日 00:30）
  r.api.clock.advance(14.5 * HOUR);
  return r;
}

test("回填到已出账的月份：账单按服务日期归属，已出的 10 月账单不变；这一单进下一期且只进一次；待复核时不进账", async (t) => {
  const r = await ownRig(t);
  const other = await dispatched(r);
  for (const type of ["departed", "arrived", "picked_up", "completed"]) await ok(r.api.call("POST", `/tenant/v1/orders/${other.orderId}/events`, { token: other.tenantToken, body: { type } }));
  const { orderId } = await dispatched(r);
  await inService(r, orderId);

  // 11 月 2 日：10 月账单已出。代传把完成时间回填到 10 月 30 日（在 7 天限制内）
  r.api.clock.advance(new Date("2026-11-02T00:00:00Z").getTime() - nowMs(r));
  const asked = await ok(proxy(r, orderId, { type: "completed", occurred_at: "2026-10-30T01:00:00.000Z" }), 202);
  const generate = async (period: string): Promise<any> => ok(r.api.call("POST", "/platform/v1/statements/generate", { token: await financeToken(r), body: { period } }));
  const october = await generate("2026-10");
  assert.equal(october.created.length, 1, "复核中的单不进账，只有另一单");
  const linesOf = async (): Promise<any[]> => (await r.api.db.owner.query("select s.period, s.id as statement_id, l.amount_minor from statement_lines l join statements s on s.tenant_id = l.tenant_id and s.id = l.statement_id where l.source_key = $1 and l.voided_at is null", [`order:${orderId}`])).rows;
  assert.deepEqual(await linesOf(), []);
  const octoberBefore = (await r.api.db.owner.query("select total_minor, line_count from statements where id = $1", [october.created[0].id])).rows[0];

  await ok(decide(r, asked.approval.id, "approve", await financeToken(r)));
  assert.equal((await detailOf(r, orderId)).order.fulfilment.completed_at, "2026-10-30T01:00:00.000Z");
  assert.deepEqual((await generate("2026-10")).created, [], "同一期同一币种不再出第二张");
  assert.deepEqual((await r.api.db.owner.query("select total_minor, line_count from statements where id = $1", [october.created[0].id])).rows[0], octoberBefore, "已出的账单不被改");
  assert.deepEqual(await linesOf(), []);

  r.api.clock.advance(new Date("2026-12-01T16:00:00Z").getTime() - nowMs(r));
  assert.equal((await generate("2026-11")).created.length, 1);
  await generate("2026-11");
  const lines = await linesOf();
  const settlement = (await r.api.db.owner.query("select settlement_minor from orders where id = $1", [orderId])).rows[0].settlement_minor;
  assert.deepEqual(lines.map((line) => [line.period, Number(line.amount_minor)]), [["2026-11", Number(settlement)]]);
});

test("试运营计数：待复核、驳回的不算；批准的算一单；回填到试运营开始之前的不算", async () => {
  const r = shared;
  const count = async (since: Date): Promise<number> => (await loadTrialProgress(r.api.db.owner as unknown as Db, r.m.b.tenantId, since, new Date(nowMs(r) + MINUTE))).completed;
  const before = await count(new Date(nowMs(r) - HOUR * 24 * 365));
  const pending = await pendingCompletion(r);
  assert.equal(await count(new Date(nowMs(r) - HOUR * 24 * 365)), before, "待复核不算");
  await ok(decide(r, pending.approvalId, "reject", await financeToken(r), { note: "虚构" }));
  assert.equal(await count(new Date(nowMs(r) - HOUR * 24 * 365)), before, "驳回不算");

  const trip = await dispatched(r);
  await inService(r, trip.orderId);
  const occurredAt = nowMs(r) - MINUTE;
  const asked = await ok(proxy(r, trip.orderId, { type: "completed", occurred_at: iso(occurredAt) }), 202);
  await ok(decide(r, asked.approval.id, "approve", await financeToken(r)));
  assert.equal(await count(new Date(nowMs(r) - HOUR * 24 * 365)), before + 1);
  const atOccurred = (await detailOf(r, trip.orderId)).order.fulfilment.completed_at;
  assert.equal(await count(new Date(new Date(atOccurred).getTime() + 1)), 0, "完成时间早于试运营开始的不算（计数按发生时间）");
});

test("到达准点率的输入：供应商自己回传「已到达」后应该有一条 arrival 履约事件（ADR 0052 说代传时间影响到达准点率，评分权重 25%）", async () => {
  const r = shared;
  const { orderId, tenantToken } = await dispatched(r);
  for (const type of ["departed", "arrived"]) await ok(r.api.call("POST", `/tenant/v1/orders/${orderId}/events`, { token: tenantToken, body: { type } }));
  const rows = (await r.api.db.owner.query("select on_time from tenant_performance_events where order_id = $1 and kind = 'arrival'", [orderId])).rows;
  assert.equal(rows.length, 1, "到达事件没有写入评分输入：到达准点率永远是「没有数据」");
});

test("完成时间回填超过 24 小时：供应商的事后加收窗口一打开就已关闭（现状，ADR 0052 接受，靠留痕；见报告）", async (t) => {
  const r = await ownRig(t);
  const { orderId } = await dispatched(r);
  await inService(r, orderId);
  const pickedUp = nowMs(r);
  r.api.clock.advance(30 * HOUR);
  const asked = await ok(proxy(r, orderId, { type: "completed", occurred_at: iso(pickedUp) }), 202);
  await ok(decide(r, asked.approval.id, "approve", await financeToken(r)));
  const tenantToken = await tenantLogin(r.api, r.m.b.adminEmail);
  const file = await uploadReceipt(r.api, tenantToken, orderId);
  const res = await r.api.call("POST", `/tenant/v1/orders/${orderId}/extra-charges`, { token: tenantToken, body: { type: "waiting", amount: 2_000, description: "虚构：等了 40 分钟", file_ids: [file] } });
  assert.equal(res.status === 409 ? res.body.error.details.reason : res.text, "SUBMIT_WINDOW_CLOSED");
});

// ---- 状态机 ----

test("If-Match：每一步都涨版本；拿上一步的版本号提交下一步是 VERSION_CONFLICT；两位运营同时代传同一步只有一个成功", async () => {
  const r = shared;
  const { orderId } = await dispatched(r);
  const v1 = (await detailOf(r, orderId)).order.version;
  const [a, b] = await Promise.all([proxy(r, orderId, { type: "departed" }, await ops(r), v1), proxy(r, orderId, { type: "departed" }, await ops2Token(r), v1)]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409], `${a.text} ${b.text}`);
  const winner = a.status === 200 ? a : b;
  assert.ok(winner.body.version > v1);
  assert.equal((await r.api.db.owner.query("select 1 from order_events where order_id = $1 and to_status = 'departed'", [orderId])).rowCount, 1);
  const stale = await proxy(r, orderId, { type: "arrived" }, undefined, v1);
  assert.deepEqual([stale.status, stale.body.error.code], [409, "VERSION_CONFLICT"]);
  for (const header of ["*", "abc", "-1", ""]) {
    const res = await r.api.call("POST", `/platform/v1/orders/${orderId}/events`, { token: await ops(r), headers: { "if-match": header }, body: { type: "arrived", occurred_at: iso(nowMs(r)), reason: REASON } });
    assert.ok([400, 409, 428].includes(res.status), `If-Match ${header}: ${res.status}`);
  }
  assert.equal((await detailOf(r, orderId)).order.status, "departed");
});

test("代传出发后改派：出发时间清掉、旧版本号被拒、发生时间不能早于新的派车；已完成和客人未出现不能再代传", async () => {
  const r = shared;
  const { orderId, tenantToken, driverToken } = await dispatched(r);
  await ok(proxy(r, orderId, { type: "departed" }));
  const stale = (await detailOf(r, orderId)).order.version;
  r.api.clock.advance(5 * MINUTE);
  const who = { ...r.m.b, adminToken: tenantToken };
  const reassigned = await ok(assign(r.api, who, orderId, (await newDriver(r.api, who)).id, (await newVehicle(r.api, who, r.m.ids.biz7)).id));
  r.api.clock.advance(MINUTE);
  const detail = await detailOf(r, orderId);
  assert.deepEqual([detail.order.status, detail.order.fulfilment.departed_at], ["assigned", null]);
  const conflict = await proxy(r, orderId, { type: "departed" }, undefined, stale);
  assert.deepEqual([conflict.status, conflict.body.error.code], [409, "VERSION_CONFLICT"]);
  const early = await proxy(r, orderId, { type: "departed", occurred_at: iso(nowMs(r) - 4 * MINUTE) });
  assert.equal(early.body.error.details.issues[0].reason, "BEFORE_PREVIOUS");
  assert.equal((await r.api.call("GET", "/driver/v1/trip", { token: driverToken })).status, 401, "旧司机的链接失效");
  assert.equal((await r.api.call("GET", "/driver/v1/trip", { token: reassigned.driver_link.token })).status, 200);

  for (const status of ["completed", "no_show"]) {
    const trip = await dispatched(r);
    await r.api.db.owner.query("update orders set status = $2 where id = $1", [trip.orderId, status]);
    for (const type of ["departed", "completed"]) {
      const res = await proxy(r, trip.orderId, { type });
      assert.deepEqual([res.status, res.body.error.code], [409, "ORDER_STATE_INVALID"], `${status} ${type}`);
    }
  }
});

test("代传之后：司机和供应商看到新状态、能接着做下一步，不能重复已代传的那一步；司机端没有原因和操作人；代传完成后都不能再回传", async () => {
  const r = shared;
  const { orderId, tenantToken, driverToken } = await dispatched(r);
  await ok(proxy(r, orderId, { type: "departed" }));
  const trip = await r.api.call("GET", "/driver/v1/trip", { token: driverToken });
  assert.equal(trip.body.order?.status ?? trip.body.status, "departed");
  assert.ok(!trip.text.includes("虚构原因"));
  assert.ok(!trip.text.includes(r.m.staff.operations.id));
  assert.equal((await r.api.call("POST", "/driver/v1/trip/events", { token: driverToken, body: { type: "departed" } })).status, 409);
  assert.equal((await r.api.call("POST", `/tenant/v1/orders/${orderId}/events`, { token: tenantToken, body: { type: "departed" } })).status, 409);
  await ok(r.api.call("POST", "/driver/v1/trip/events", { token: driverToken, body: { type: "arrived", location: { lng: 140.389, lat: 35.769 } } }));
  r.api.clock.advance(MINUTE);
  await ok(r.api.call("POST", `/tenant/v1/orders/${orderId}/events`, { token: tenantToken, body: { type: "picked_up" } }));
  r.api.clock.advance(MINUTE);
  const asked = await ok(proxy(r, orderId, { type: "completed" }), 202);
  await ok(decide(r, asked.approval.id, "approve", await financeToken(r)));
  assert.equal((await r.api.call("POST", "/driver/v1/trip/events", { token: driverToken, body: { type: "completed" } })).status, 409);
  assert.equal((await r.api.call("POST", `/tenant/v1/orders/${orderId}/events`, { token: tenantToken, body: { type: "completed" } })).status, 409);
  assert.equal(await completedEvents(r, orderId), 1);
});

test("代传「已接到客人」后客人和运营都不能再取消（服务开始后的现有约束）；代传「已到达」之前还能取消", async () => {
  const r = shared;
  const { orderId } = await dispatched(r);
  await ok(proxy(r, orderId, { type: "departed" }));
  r.api.clock.advance(MINUTE);
  await ok(proxy(r, orderId, { type: "arrived" }));
  r.api.clock.advance(MINUTE);
  await ok(proxy(r, orderId, { type: "picked_up" }));
  assert.equal((await r.api.call("POST", `/sales/v1/orders/${orderId}/cancel`, { token: await r.flow.token(), body: {} })).status, 409);
  assert.equal((await r.api.call("POST", `/platform/v1/orders/${orderId}/cancel`, { token: await ops(r), body: { reason: "GUEST_REQUEST", note: "虚构" } })).status, 409);
  const other = await dispatched(r);
  await ok(proxy(r, other.orderId, { type: "departed" }));
  assert.equal((await r.api.call("POST", `/sales/v1/orders/${other.orderId}/cancel`, { token: await r.flow.token(), body: {} })).status, 200);
});

test("离用车还有 20 小时，一位运营不应该能单独把订单推到「服务中」：这一步之后客人取消不了也退不了款（代传的是实际发生的事，接到客人不可能比用车时间早这么多）", async () => {
  const r = shared;
  const { orderId } = await dispatched(r, 20);
  await ok(proxy(r, orderId, { type: "departed" }));
  r.api.clock.advance(MINUTE);
  await ok(proxy(r, orderId, { type: "arrived" }));
  r.api.clock.advance(MINUTE);
  const res = await proxy(r, orderId, { type: "picked_up" });
  assert.equal(res.status, 400, `实际 ${res.status}：订单已进入 ${res.body.status}，状态机没有回头路（in_service 只能到 completed）`);
});

// ---- 权限 ----

test("所有内置角色：只有超级管理员和运营能发起；审核只有超级管理员、运营、财务", async () => {
  const r = shared;
  const { orderId } = await dispatched(r);
  const version = (await detailOf(r, orderId)).order.version;
  await inService(r, orderId);
  const asked = await ok(proxy(r, orderId, { type: "completed" }), 202);
  for (const role of ["tenant_onboarding", "channel_manager", "customer_service", "risk", "master_data", "tech", "readonly"] as const) {
    const staff = await addStaff(r.api, r.m.root, `${role.replace("_", "-")}-${randomUUID().slice(0, 6)}@platform.test`, role);
    const token = await platformLogin(r.api, staff.email);
    const res = await proxy(r, orderId, { type: "completed" }, token, version);
    assert.equal(res.status, 403, `${role} 发起：${res.text}`);
    const approve = await decide(r, asked.approval.id, "approve", token);
    assert.ok([403, 404].includes(approve.status), `${role} 批准：${approve.text}`);
  }
  assert.equal((await detailOf(r, orderId)).order.status, "in_service");
});

test("自建角色：只勾「代传履约 · 查看」不能发起；能发起的没有审核权限不能批准；司机、销售令牌都不能调", async () => {
  const r = shared;
  const { orderId, driverToken } = await dispatched(r);
  const version = (await detailOf(r, orderId)).order.version;
  const viewer = await scopedStaff(r, "代传只看", ALL_FREE, ["orders:view", "order_proxy:view"]);
  assert.equal((await proxy(r, orderId, { type: "departed" }, viewer, version)).status, 403);
  assert.equal((await proxy(r, orderId, { type: "departed" }, driverToken, version)).status, 401);
  assert.equal((await proxy(r, orderId, { type: "departed" }, await r.flow.token(), version)).status, 401);
  await inService(r, orderId);
  const proxyOnly = await scopedStaff(r, "只能代传", ALL_FREE, ["orders:view", "order_proxy:view", "order_proxy:edit", "approvals:view"]);
  const asked = await ok(proxy(r, orderId, { type: "completed" }, undefined), 202);
  const res = await decide(r, asked.approval.id, "approve", proxyOnly);
  assert.deepEqual([res.status, res.body.error.details?.required], [403, "payment.manage"], res.text);
});

test("旧的自建角色：只勾「订单 · 审核」的不能发起代传，但能批准代传完成（现状：审核走 payment.manage，没有单独一格；见报告）", async () => {
  const r = shared;
  const { orderId, approvalId } = await pendingCompletion(r);
  const old = await scopedStaff(r, "老的订单审核", ALL_FREE, ["orders:view", "orders:review", "approvals:view"]);
  assert.equal((await proxy(r, orderId, { type: "completed" }, old)).status, 403);
  await ok(decide(r, approvalId, "approve", old));
  assert.equal((await detailOf(r, orderId)).order.status, "completed");
});

test("复核的数据范围：范围外的人在待审核列表里看不到、读不到详情（看不到原因）、撤回和驳回都是 404", async () => {
  const r = shared;
  const { approvalId } = await pendingCompletion(r);
  const osaka = await scopedStaff(r, "大阪审核", { city_ids: [r.m.ids.osaka], channel_ids: null }, ["orders:view", "orders:review", "approvals:view"]);
  const list = await r.api.call("GET", "/platform/v1/approvals?status=pending", { token: osaka });
  assert.equal(list.status, 200, list.text);
  assert.ok(!list.text.includes(approvalId));
  assert.ok(!list.text.includes("虚构原因"));
  assert.equal((await r.api.call("GET", `/platform/v1/approvals/${approvalId}`, { token: osaka })).status, 404);
  assert.equal((await decide(r, approvalId, "reject", osaka)).status, 404);
  assert.equal((await decide(r, approvalId, "withdraw", osaka)).status, 404);
});

test("租户隔离：甲车队读不到、改不了乙车队被代传的单，也收不到它的推送", async () => {
  const r = shared;
  const { orderId } = await dispatched(r);
  await ok(proxy(r, orderId, { type: "departed" }));
  const tenantA = await tenantLogin(r.api, r.m.a.adminEmail);
  assert.equal((await r.api.call("GET", `/tenant/v1/orders/${orderId}`, { token: tenantA })).status, 404);
  assert.equal((await r.api.call("POST", `/tenant/v1/orders/${orderId}/events`, { token: tenantA, body: { type: "arrived" } })).status, 404);
  const rows = (await r.api.db.owner.query("select tenant_id from webhook_deliveries where order_id = $1", [orderId])).rows;
  assert.ok(rows.every((row) => row.tenant_id === r.m.b.tenantId));
  assert.equal((await detailOf(r, orderId)).order.status, "departed");
});

// ---- 隐私 ----

test("规则 4 和隐私：批准后的完成事件，供应商的详情、Webhook、通知里有来源和两个时间，没有原因、发起人、批准人、复核编号、对外价、加价", async () => {
  const r = shared;
  const tenantToken = await tenantLogin(r.api, r.m.b.adminEmail);
  const secretReason = "虚构-内部原因-对外价99999-加价12%";
  const trip = await dispatched(r);
  await ok(proxy(r, trip.orderId, { type: "departed", reason: secretReason }));
  r.api.clock.advance(MINUTE);
  await ok(proxy(r, trip.orderId, { type: "arrived", reason: secretReason }));
  r.api.clock.advance(MINUTE);
  await ok(proxy(r, trip.orderId, { type: "picked_up", reason: secretReason }));
  r.api.clock.advance(MINUTE);
  const occurredAt = iso(nowMs(r));
  const asked = await ok(proxy(r, trip.orderId, { type: "completed", reason: secretReason, occurred_at: occurredAt }), 202);
  r.api.clock.advance(MINUTE);
  await ok(decide(r, asked.approval.id, "approve", await financeToken(r)));
  const forbiddenValues = [secretReason, r.m.staff.operations.id, r.m.staff.operations.email, r.finance.id, r.finance.email, asked.approval.id];

  const tenantDetail = await r.api.call("GET", `/tenant/v1/orders/${trip.orderId}`, { token: tenantToken });
  for (const value of forbiddenValues) assert.ok(!tenantDetail.text.includes(value), `供应商详情含 ${value}`);
  for (const key of ["sell", "sell_minor", "markup", "markup_bp", "proxy", "approved_by", "requested_by", "approval_id", "pending_proxy_completion"]) assert.ok(!allKeys(tenantDetail.body).has(key), key);
  const done = tenantDetail.body.events.at(-1);
  assert.deepEqual([done.to_status, done.source, done.occurred_at, done.recorded_at], ["completed", "platform_proxy", occurredAt, iso(nowMs(r))]);

  const hooks = (await r.api.db.owner.query("select event_data from webhook_deliveries where order_id = $1 and event_type = 'order.status_changed' and event_data->>'to_status' = 'completed'", [trip.orderId])).rows;
  assert.equal(hooks.length, 1);
  assert.deepEqual(Object.keys(hooks[0].event_data).sort(), ["from_status", "occurred_at", "source", "to_status"]);
  const allHooks = JSON.stringify((await r.api.db.owner.query("select * from webhook_deliveries where order_id = $1", [trip.orderId])).rows);
  const notifications = JSON.stringify((await r.api.db.owner.query("select * from notification_events where order_id = $1", [trip.orderId])).rows);
  const tenantLogs = await ok(r.api.call("GET", `/tenant/v1/audit-logs?resource=order&resource_id=${trip.orderId}`, { token: tenantToken }));
  for (const value of forbiddenValues) {
    assert.ok(!allHooks.includes(value), `Webhook 含 ${value}`);
    assert.ok(!notifications.includes(value), `通知含 ${value}`);
    assert.ok(!JSON.stringify(tenantLogs).includes(value), `供应商操作日志含 ${value}`);
  }
});

test("审计内容：复核的发起、批准、驳回、撤回都有记录，tenant_id 为空；生效的审计写明发起人、批准的人是操作人", async () => {
  const r = shared;
  const { orderId, approvalId, occurredAt } = await pendingCompletion(r);
  await ok(decide(r, approvalId, "approve", await financeToken(r)));
  const logs = (await r.api.db.owner.query("select action, actor_email, tenant_id, before, after from audit_logs where resource = 'approval' and resource_id = $1 order by id", [approvalId])).rows;
  assert.deepEqual(logs.map((row) => [row.action, row.actor_email, row.tenant_id]), [["request", r.m.staff.operations.email, null], ["approve", r.finance.email, null]]);
  assert.equal(logs[0].after.payload.occurred_at, occurredAt);
  assert.equal(logs[0].after.payload.reason, REASON);
  const effect = (await r.api.db.owner.query("select actor_email, tenant_id, before, after from audit_logs where resource = 'order' and resource_id = $1 and after->>'event' = 'completed'", [orderId])).rows;
  assert.equal(effect.length, 1);
  assert.deepEqual([effect[0].actor_email, effect[0].tenant_id, effect[0].before.status, effect[0].after.status, effect[0].after.requested_by, effect[0].after.approval_id, effect[0].after.occurred_at], [r.finance.email, null, "in_service", "completed", r.m.staff.operations.id, approvalId, occurredAt]);

  const refused = await dispatched(r);
  const before = (await r.api.db.owner.query("select count(*)::int as n from audit_logs where resource = 'order' and resource_id = $1", [refused.orderId])).rows[0].n;
  await proxy(r, refused.orderId, { type: "arrived" });
  assert.equal((await r.api.db.owner.query("select count(*)::int as n from audit_logs where resource = 'order' and resource_id = $1", [refused.orderId])).rows[0].n, before, "被拒绝的不写生效审计");
});

test("原因的内容：NUL 和半个表情 400；500 字通过（出发和发起复核都是）、501 字 400；HTML 原样存成文字", async () => {
  const r = shared;
  const { orderId } = await dispatched(r);
  const version = (await detailOf(r, orderId)).order.version;
  for (const bad of ["虚构\u0000原因", "虚构\ud83d原因", "字".repeat(501)]) assert.equal((await proxy(r, orderId, { type: "departed", reason: bad }, undefined, version)).status, 400, JSON.stringify(bad.slice(0, 8)));
  const html = '<img src=x onerror="alert(1)">虚构';
  await ok(proxy(r, orderId, { type: "departed", reason: html }, undefined, version));
  assert.equal((await detailOf(r, orderId)).events.at(-1).proxy.reason, html);
  r.api.clock.advance(MINUTE);
  await ok(proxy(r, orderId, { type: "arrived" }));
  r.api.clock.advance(MINUTE);
  await ok(proxy(r, orderId, { type: "picked_up", reason: "字".repeat(500) }));
  r.api.clock.advance(MINUTE);
  await ok(proxy(r, orderId, { type: "completed", reason: "字".repeat(500) }), 202);
});

test("原因必填不能用看不见的字符糊弄：零宽字符、控制字符组成的原因和全是空格一样要拒绝（审计里等于没写原因）", async () => {
  const r = shared;
  const { orderId } = await dispatched(r);
  const version = (await detailOf(r, orderId)).order.version;
  for (const blank of ["​​", "\u0007\u0008", "‮⁠", "﻿­"]) {
    const res = await proxy(r, orderId, { type: "departed", reason: blank }, undefined, version);
    assert.equal(res.status, 400, `${JSON.stringify(blank)} 被接受，状态 ${res.status}`);
  }
});

test("M4-19：运营详情（含只读员工）没有司机链接令牌和令牌哈希，能打开司机页的东西都不出接口", async () => {
  const r = shared;
  const { orderId, driverToken } = await dispatched(r);
  const hash = (await r.api.db.owner.query("select token_hash from driver_links where order_id = $1 limit 1", [orderId])).rows[0].token_hash;
  for (const token of [await ops(r), await platformLogin(r.api, r.m.staff.readonly.email)]) {
    const res = await r.api.call("GET", `/platform/v1/orders/${orderId}`, { token });
    assert.equal(res.status, 200, res.text);
    assert.ok(!res.text.includes(driverToken), "令牌");
    assert.ok(!res.text.includes(String(hash)), "令牌哈希");
    const keys = allKeys(res.body);
    for (const key of ["token", "token_hash", "url", "link_url"]) assert.ok(!keys.has(key), key);
    assert.deepEqual(Object.keys(res.body.records.driver_link).sort(), ["created_at", "expires_at", "id", "last_used_at", "status"]);
  }
});

// 时钟走了 8 天，放在最后
test("复核拖了 7 天以上：批准得到 TOO_OLD，不生效、记录仍待审核，可以驳回，驳回后不能再复活", async (t) => {
  const r = await ownRig(t);
  const { orderId, approvalId } = await pendingCompletion(r);
  r.api.clock.advance(8 * 24 * HOUR);
  const late = await decide(r, approvalId, "approve", await financeToken(r));
  assert.deepEqual([late.status, late.body.error.code, late.body.error.details.issues[0].reason], [400, "VALIDATION_FAILED", "TOO_OLD"]);
  assert.equal((await detailOf(r, orderId)).order.status, "in_service");
  await ok(decide(r, approvalId, "reject", await financeToken(r), { note: "虚构：太久了" }));
  assert.equal((await decide(r, approvalId, "approve", await ops2Token(r))).status, 409);
  assert.equal((await detailOf(r, orderId)).order.status, "in_service");
});
