/**
 * M5-01：供应商应付账单与付款批次（ADR 0040），经真实接口、真实 PostgreSQL。订单、加收、应扣款项直接写进库（全流程在 orders / extra-charges / rescues 的测试里），
 * 测试结束随 schema 一起删除（规则 1）。
 * - 出账口径：已完成、客人未出现按结算价，有偿取消按供应商应得，已扣到款的加收按通过的金额，救援有结论的应扣款项扣除；别的不出；按币种各一张；
 * - 按订单的服务日期（城市当地日期）切月；上一期出账时没结案的进下一期（往期调整）；出过账的应扣款项被免除后下一期退回；
 * - 出账可以反复运行、并发只出一次；作废后重出；
 * - 供应商确认 / 提异议、平台答复、7 天不确认视为确认（定时任务）；付款的双人复核（发起人不能批）；次月 20 日的付款批次、锁定后顺延、按币种合计；
 *   合计为负转入下一期（下一张账单里一行「上期结转」）；
 * - 规则 2：别的供应商的账单读不到、改不了；规则 4：供应商看到的账单里没有对外价、加价比例；数据范围：限定了范围的员工不能用财务接口。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withPlatformTx, withTenantTx } from "./db/context.ts";
import { TEST_PASSWORD, addTenantUser, type TenantFixture, type TestApi, createTestApi } from "./testing/api.ts";
import { deniedByDatabase } from "./testing/db.ts";
import { seedOrder } from "./testing/dispatch.ts";
import { type Market, type Staff, addStaff, allKeys, buildMarket, ok } from "./testing/market.ts";
import { platformLogin, tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";

const DAY = 24 * 3_600_000;

let api: TestApi;
let m: Market;
let finance1: Staff;
let finance2: Staff;

before(async () => {
  api = await createTestApi();
  m = await buildMarket(api);
  finance1 = await addStaff(api, m.root, "fin1@platform.test", "finance");
  finance2 = await addStaff(api, m.root, "fin2@platform.test", "finance");
});
after(() => api.close());

// 时钟一拨就是几天：每次现登录
const fin1 = (): Promise<string> => platformLogin(api, finance1.email);
const fin2 = (): Promise<string> => platformLogin(api, finance2.email);
const tenantToken = (who: TenantFixture): Promise<string> => tenantLogin(api, who.adminEmail);
const root = (): Promise<string> => platformLogin(api, "root@platform.test");

/** 把时钟拨到某一刻（只能往后）。 */
function moveTo(iso: string): void {
  const delta = new Date(iso).getTime() - api.clock.now().getTime();
  assert.ok(delta >= 0, `时钟只能往后拨：${iso}`);
  api.clock.advance(delta);
}

interface SeedOptions {
  status?: string;
  settlement?: number;
  currency?: string;
  share?: number;
  feeBp?: number;
}

/** 一张某个用车时间（东京时间）的订单，按需要摆成各种终态。 */
async function order(side: "a" | "b", serviceAt: string, options: SeedOptions = {}): Promise<{ id: string; orderNo: string }> {
  const at = new Date(serviceAt);
  const seeded = await seedOrder(api, m, side, { serviceAt: at, confirmedAt: new Date(at.getTime() - 3 * DAY) });
  const tenantId = m[side].tenantId;
  await api.db.owner.query("update orders set settlement_minor = $3, settlement_currency = $4 where tenant_id = $1 and id = $2", [tenantId, seeded.id, options.settlement ?? 20_000, options.currency ?? "JPY"]);
  const status = options.status ?? "completed";
  if (status === "cancelled") {
    await api.db.owner.query("update orders set status = 'cancelled', cancelled_at = $3, cancel_reason = 'GUEST_REQUEST', cancel_fee_bp = $4, cancel_tenant_share_minor = $5 where tenant_id = $1 and id = $2", [tenantId, seeded.id, at, options.feeBp ?? 0, options.share ?? 0]);
  } else if (status === "rescued") {
    await api.db.owner.query("update orders set status = 'rescued', rescued_at = $3 where tenant_id = $1 and id = $2", [tenantId, seeded.id, at]);
  } else if (status !== "confirmed") {
    await api.db.owner.query("update orders set status = $3 where tenant_id = $1 and id = $2", [tenantId, seeded.id, status]);
  }
  return { id: seeded.id, orderNo: seeded.orderNo };
}

async function setStatus(side: "a" | "b", orderId: string, status: string): Promise<void> {
  await api.db.owner.query("update orders set status = $3 where tenant_id = $1 and id = $2", [m[side].tenantId, orderId, status]);
}

/** 事后加收：已扣到款（`approved` 为部分通过的金额）或别的状态。 */
async function extraCharge(side: "a" | "b", orderId: string, amount: number, status: string, approved: number | null = null): Promise<string> {
  const id = randomUUID();
  const submitted = new Date("2026-09-01T00:00:00Z");
  const until = new Date(submitted.getTime() + 2 * DAY);
  const charged = status === "charged";
  await api.db.owner.query(
    `insert into order_extra_charges (tenant_id, id, order_id, type, amount_minor, currency, status, review_reasons, submitted_at, submitted_by, dispute_until, decided_at, decided_by, approved_minor, charged_at, created_at, updated_at)
     values ($1, $2, $3, 'waiting', $4, 'JPY', $5, $6, $7, $8, $9, $10, $11, $12, $13, $7, $7)`,
    [
      m[side].tenantId, id, orderId, amount, status, approved === null ? [] : ["OVER_THRESHOLD"], submitted, m[side].adminId, until,
      approved === null ? null : new Date(until.getTime() + 1_000), approved === null ? null : finance1.id, approved, charged ? new Date(until.getTime() + 2_000) : null,
    ],
  );
  return id;
}

/** 一条应扣款项（违约金），挂在一次救援上。 */
async function deduction(side: "a" | "b", orderId: string, amount: number): Promise<string> {
  const rescueId = randomUUID();
  const now = new Date("2026-09-01T00:00:00Z");
  await api.db.owner.query(
    `insert into order_rescues (id, order_id, original_tenant_id, trigger, triggered_by_type, triggered_at, from_status, service_at, original_settlement_minor, original_settlement_currency, penalty_bp, penalty_tier, status, closed_at, created_at, updated_at)
     values ($1, $2, $3, 'dispatch_overdue', 'system', $4, 'confirmed', $4, 20000, 'JPY', 10000, 'full', 'cancelled', $4, $4, $4)`,
    [rescueId, orderId, m[side].tenantId, now],
  );
  const id = randomUUID();
  await api.db.owner.query(
    `insert into tenant_deductions (tenant_id, id, order_id, rescue_id, kind, amount_minor, currency, basis, status, created_at, updated_at)
     values ($1, $2, $3, $4, 'penalty', $5, 'JPY', '{"bp": 10000}'::jsonb, 'pending', $6, $6)`,
    [m[side].tenantId, id, orderId, rescueId, amount, now],
  );
  return id;
}

const money = (amount: string, currency = "JPY"): { amount: string; currency: string } => ({ amount, currency });

async function generate(token: string, period: string | null): Promise<any> {
  const res = await api.call("POST", "/platform/v1/statements/generate", { token, body: period === null ? {} : { period } });
  assert.equal(res.status, 200, res.text);
  assertMatchesOpenApi("POST", "/platform/v1/statements/generate", res);
  return res.body;
}

async function tenantStatements(who: TenantFixture, query = ""): Promise<any[]> {
  const res = await api.call("GET", `/tenant/v1/statements${query}`, { token: await tenantToken(who) });
  assert.equal(res.status, 200, res.text);
  assertMatchesOpenApi("GET", "/tenant/v1/statements", res);
  return res.body.items;
}

async function tenantStatement(who: TenantFixture, id: string): Promise<any> {
  const res = await api.call("GET", `/tenant/v1/statements/${id}`, { token: await tenantToken(who) });
  assert.equal(res.status, 200, res.text);
  assertMatchesOpenApi("GET", "/tenant/v1/statements/{id}", res);
  return res.body.statement;
}

async function platformStatement(id: string): Promise<any> {
  const res = await api.call("GET", `/platform/v1/statements/${id}`, { token: await fin1() });
  assert.equal(res.status, 200, res.text);
  assertMatchesOpenApi("GET", "/platform/v1/statements/{id}", res);
  return res.body.statement;
}

/** 财务 1 发起付款复核、财务 2 批准。 */
async function approvePayout(id: string): Promise<any> {
  const requested = await api.call("POST", `/platform/v1/statements/${id}/payout-approval`, { token: await fin1(), body: { note: "核对无误" } });
  assert.equal(requested.status, 202, requested.text);
  assertMatchesOpenApi("POST", "/platform/v1/statements/{id}/payout-approval", requested);
  await ok(api.call("POST", `/platform/v1/approvals/${requested.body.approval.id}/approve`, { token: await fin2(), body: {} }));
  return platformStatement(id);
}

// 9 月（东京时间）的单；测试时钟是 2026-10-07（东京）
type SeptKey = "done" | "noShow" | "paidCancel" | "freeCancel" | "inService" | "claimed" | "rescued" | "rescuePending" | "usd" | "b" | "bLate";
const sept = {} as Record<SeptKey, { id: string; orderNo: string }>;
let septA: any;
let septAUsd: any;
let septB: any;

test("出账口径：已完成、客人未出现、有偿取消、已扣到款的加收、救援有结论的违约金；别的不出；按币种各一张；应付日次月 20 日", async () => {
  sept["done"] = await order("a", "2026-09-10T10:00:00+09:00");
  sept["noShow"] = await order("a", "2026-09-11T10:00:00+09:00", { status: "no_show" });
  sept["paidCancel"] = await order("a", "2026-09-12T10:00:00+09:00", { status: "cancelled", feeBp: 5_000, share: 10_000 });
  sept["freeCancel"] = await order("a", "2026-09-13T10:00:00+09:00", { status: "cancelled", feeBp: 0, share: 0 });
  sept["inService"] = await order("a", "2026-09-30T23:00:00+09:00", { status: "in_service" });
  sept["claimed"] = await order("a", "2026-09-14T10:00:00+09:00", { status: "no_show_claimed" });
  sept["rescued"] = await order("a", "2026-09-15T10:00:00+09:00", { status: "rescued" });
  sept["rescuePending"] = await order("a", "2026-09-16T10:00:00+09:00", { status: "rescue_pending" });
  sept["usd"] = await order("a", "2026-09-17T10:00:00+09:00", { currency: "USD", settlement: 12_345 });
  sept["b"] = await order("b", "2026-09-18T10:00:00+09:00", { settlement: 19_800 });
  await extraCharge("a", sept["done"].id, 3_000, "charged", 2_000);
  await extraCharge("a", sept["done"].id, 1_000, "in_window");
  await extraCharge("a", sept["done"].id, 1_500, "approved");
  await deduction("a", sept["rescued"].id, 6_000);
  await deduction("a", sept["rescuePending"].id, 20_000);

  const body = await generate(await fin1(), "2026-09");
  assert.equal(body.period, "2026-09");
  assert.equal(body.created.length, 3);
  const created = (tenantId: string, currency: string): any => body.created.find((entry: any) => entry.tenant.id === tenantId && entry.currency === currency);
  septA = created(m.a.tenantId, "JPY");
  septAUsd = created(m.a.tenantId, "USD");
  septB = created(m.b.tenantId, "JPY");
  // 20,000 + 20,000（客人未出现）+ 10,000（有偿取消 50%）+ 2,000（加收部分通过）− 6,000（违约金）
  assert.deepEqual([septA.total, septA.line_count, septA.status, septA.pay_due_on, septA.payout_on], [money("46000"), 5, "issued", "2026-10-20", null]);
  assert.equal(septA.confirm_due_at, new Date(api.clock.now().getTime() + 7 * DAY).toISOString());
  assert.match(septA.statement_no, /^ST202609[0-9A-HJ-NP-Z]{8}$/);
  assert.deepEqual([septAUsd.total, septAUsd.line_count], [money("123.45", "USD"), 1]);
  assert.deepEqual([septB.total, septB.line_count, septB.tenant.name], [money("19800"), 1, "乙车队"]);

  const detail = await platformStatement(septA.id);
  assert.deepEqual(
    detail.lines.map((line: any) => [line.kind, line.order_no, line.amount.amount, line.prior_period]),
    [
      ["order", sept["done"].orderNo, "20000", false],
      ["no_show", sept["noShow"].orderNo, "20000", false],
      ["cancellation", sept["paidCancel"].orderNo, "10000", false],
      ["extra_charge", sept["done"].orderNo, "2000", false],
      ["deduction", sept["rescued"].orderNo, "-6000", false],
    ],
  );
  assert.deepEqual(detail.summary.map((entry: any) => [entry.kind, entry.count, entry.amount.amount]), [["order", 1, "20000"], ["no_show", 1, "20000"], ["cancellation", 1, "10000"], ["extra_charge", 1, "2000"], ["deduction", 1, "-6000"]]);
  assert.deepEqual(detail.lines[2].detail, { order_status: "cancelled", settlement_minor: 20_000, cancel_fee_bp: 5_000, cancel_reason: "GUEST_REQUEST" });
  assert.deepEqual(detail.events.map((event: any) => [event.action, event.actor_type, event.actor_id]), [["issue", "platform_user", finance1.id]]);
  assert.equal(detail.pending_approval_id, null);
});

test("出账可以反复运行：已经出过的不再出；同时出两次也只出一张", async () => {
  assert.deepEqual((await generate(await fin1(), "2026-09")).created, []);
  // 乙又多了一张 9 月的单：9 月已经有乙的 JPY 账单，留到 10 月（往期调整）
  sept["bLate"] = await order("b", "2026-09-25T10:00:00+09:00");
  assert.deepEqual((await generate(await fin1(), "2026-09")).created, []);
  // 并发：8 月甲还没出过账，两个请求同时出 8 月——同一家一家排队，只出一张、明细只挂一次
  const august = await order("a", "2026-08-20T10:00:00+09:00");
  const token = await fin1();
  const [first, second] = await Promise.all([generate(token, "2026-08"), generate(token, "2026-08")]);
  assert.equal(first.created.length + second.created.length, 1);
  const lines = await api.db.owner.query("select count(*)::int as n from statement_lines where source_key = $1 and voided_at is null", [`order:${august.id}`]);
  assert.equal(lines.rows[0].n, 1);
  assert.equal((await api.db.owner.query("select count(*)::int as n from statements where tenant_id = $1 and period = '2026-08'", [m.a.tenantId])).rows[0].n, 1);
});

test("只能给结束了的月份出账；不给周期就是上个月（东京日期）", async () => {
  const res = await api.call("POST", "/platform/v1/statements/generate", { token: await fin1(), body: { period: "2026-10" } });
  assert.deepEqual([res.status, res.body.error.code], [409, "PERIOD_NOT_ENDED"]);
  const bad = await api.call("POST", "/platform/v1/statements/generate", { token: await fin1(), body: { period: "2026-13" } });
  assert.equal(bad.status, 400);
  assert.equal((await generate(await fin1(), null)).period, "2026-09");
});

test("规则 2：供应商只看得到自己的账单；别的供应商的读不到、确认不了、提不了异议（404）", async () => {
  const mine = await tenantStatements(m.a);
  assert.ok(mine.length >= 2);
  assert.ok(mine.every((entry) => entry.id !== septB.id));
  assert.deepEqual((await tenantStatements(m.b)).map((entry) => entry.id).includes(septA.id), false);
  const tokenB = await tenantToken(m.b);
  for (const [method, path, body] of [
    ["GET", `/tenant/v1/statements/${septA.id}`, undefined],
    ["POST", `/tenant/v1/statements/${septA.id}/confirm`, undefined],
    ["POST", `/tenant/v1/statements/${septA.id}/dispute`, { reason: "想改别人的账" }],
  ] as const) {
    const res = await api.call(method, path, { token: tokenB, body });
    assert.deepEqual([res.status, res.body.error.code], [404, "NOT_FOUND"], `${method} ${path}`);
  }
  assert.equal((await platformStatement(septA.id)).status, "issued", "乙的请求没有改动甲的账单");
  // 数据库层：租户事务里按编号也读不到别人的账单、明细、经过
  for (const table of ["statements", "statement_lines", "statement_events"]) {
    const column = table === "statements" ? "id" : "statement_id";
    const rows = await withTenantTx(api.db.pool, m.b.tenantId, (db) => db.query(`select 1 from ${table} where ${column} = $1`, [septA.id]));
    assert.equal(rows.rowCount, 0, table);
  }
  // 供应商不能直接改账单（只读）
  await assert.rejects(withTenantTx(api.db.pool, m.a.tenantId, (db) => db.query("update statements set status = 'confirmed' where id = $1", [septA.id])), deniedByDatabase);
});

test("规则 4：供应商看到的账单（列表、详情、确认后的应答）里没有对外价、加价比例、汇率", async () => {
  const detail = await tenantStatement(m.a, septA.id);
  const list = await tenantStatements(m.a);
  const keys = allKeys([detail, list]);
  for (const forbidden of ["sell", "sell_minor", "sell_price", "markup", "markup_bp", "fx", "fx_buffer_bp", "rate", "pending_approval_id", "tenant", "actor_id"]) assert.equal(keys.has(forbidden), false, forbidden);
  assert.equal(JSON.stringify(detail).includes("order_sales"), false);
});

test("供应商权限：只读能看不能确认；调度看不了；财务能确认", async () => {
  const readonly = await addTenantUser(api, await tenantToken(m.a), "ro@market-a.test", "readonly");
  const dispatch = await addTenantUser(api, await tenantToken(m.a), "dispatch@market-a.test", "dispatch");
  assert.equal((await api.call("GET", `/tenant/v1/statements/${septA.id}`, { token: readonly.token })).status, 200);
  assert.deepEqual((await api.call("POST", `/tenant/v1/statements/${septA.id}/confirm`, { token: readonly.token })).body.error.code, "FORBIDDEN");
  assert.equal((await api.call("GET", "/tenant/v1/statements", { token: dispatch.token })).status, 403);
});

test("异议 → 平台答复（回到待确认、重新给 7 天）→ 供应商确认；状态不对的 409", async () => {
  const token = await tenantToken(m.a);
  const disputed = await api.call("POST", `/tenant/v1/statements/${septA.id}/dispute`, { token, body: { reason: "9 月 12 日那单客人是航班取消，应该免费" } });
  assert.equal(disputed.status, 200, disputed.text);
  assertMatchesOpenApi("POST", "/tenant/v1/statements/{id}/dispute", disputed);
  assert.deepEqual([disputed.body.statement.status, disputed.body.statement.dispute_reason], ["disputed", "9 月 12 日那单客人是航班取消，应该免费"]);
  const again = await api.call("POST", `/tenant/v1/statements/${septA.id}/dispute`, { token, body: { reason: "再提一次" } });
  assert.deepEqual([again.status, again.body.error.code], [409, "STATEMENT_STATE_INVALID"]);
  // 平台：有异议的不能发起付款复核；答复后回到待确认
  const early = await api.call("POST", `/platform/v1/statements/${septA.id}/payout-approval`, { token: await fin1(), body: {} });
  assert.deepEqual([early.status, early.body.error.code], [409, "STATEMENT_STATE_INVALID"]);
  api.clock.advance(DAY);
  const replied = await api.call("POST", `/platform/v1/statements/${septA.id}/reply`, { token: await fin1(), body: { note: "取消原因是客人自己选的，按阶梯扣 50%" } });
  assert.equal(replied.status, 200, replied.text);
  assertMatchesOpenApi("POST", "/platform/v1/statements/{id}/reply", replied);
  assert.deepEqual([replied.body.statement.status, replied.body.statement.confirm_due_at], ["issued", new Date(api.clock.now().getTime() + 7 * DAY).toISOString()]);
  const confirmed = await api.call("POST", `/tenant/v1/statements/${septA.id}/confirm`, { token: await tenantToken(m.a) });
  assert.equal(confirmed.status, 200, confirmed.text);
  assertMatchesOpenApi("POST", "/tenant/v1/statements/{id}/confirm", confirmed);
  assert.deepEqual([confirmed.body.statement.status, confirmed.body.statement.confirmed_by_type], ["confirmed", "tenant_user"]);
  // 再确认一次：原样返回
  assert.equal((await ok(api.call("POST", `/tenant/v1/statements/${septA.id}/confirm`, { token: await tenantToken(m.a) }))).statement.status, "confirmed");
  const events = (await tenantStatement(m.a, septA.id)).events;
  assert.deepEqual(events.map((event: any) => [event.action, event.actor_type]), [["issue", "platform_user"], ["dispute", "tenant_user"], ["reply", "platform_user"], ["confirm", "tenant_user"]]);
  assert.equal(events[2].note, "取消原因是客人自己选的，按阶梯扣 50%");
});

test("确认期满（7 天，含那一刻）还是待确认的，定时任务视为确认；有异议的不自动确认", async () => {
  const usdToken = await tenantToken(m.a);
  await ok(api.call("POST", `/tenant/v1/statements/${septAUsd.id}/dispute`, { token: usdToken, body: { reason: "汇率不对" } }));
  moveTo(new Date(new Date(septB.confirm_due_at).getTime() - 1).toISOString());
  assert.equal((await api.app.billingJobs.tick()).autoConfirmed, 0);
  api.clock.advance(1);
  const tick = await api.app.billingJobs.tick();
  assert.equal(tick.period, "2026-09");
  // 乙的 9 月、甲的 8 月（同一时刻出的账）
  assert.equal(tick.autoConfirmed, 2);
  const b = await tenantStatement(m.b, septB.id);
  assert.deepEqual([b.status, b.confirmed_by_type], ["confirmed", "system"]);
  assert.equal((await platformStatement(septAUsd.id)).status, "disputed");
});

test("付款给供应商：双人复核（发起人不能批、同时只有一条），批准后进次月 20 日的付款批次；锁定后再批准的顺延到下个月", async () => {
  const token1 = await fin1();
  const requested = await ok(api.call("POST", `/platform/v1/statements/${septA.id}/payout-approval`, { token: token1, body: {} }), 202);
  assert.equal(requested.approval.kind, "statement.payout");
  assert.equal(requested.approval.payload.total_minor, 46_000);
  const twice = await api.call("POST", `/platform/v1/statements/${septA.id}/payout-approval`, { token: token1, body: {} });
  assert.deepEqual([twice.status, twice.body.error.code], [409, "STATEMENT_REVIEW_PENDING"]);
  const self = await api.call("POST", `/platform/v1/approvals/${requested.approval.id}/approve`, { token: token1, body: {} });
  assert.deepEqual([self.status, self.body.error.code], [409, "APPROVAL_SELF_REVIEW"]);
  // 有待审核的复核时不能作废
  const voidPending = await api.call("POST", `/platform/v1/statements/${septA.id}/void`, { token: token1, body: { reason: "测试" } });
  assert.deepEqual([voidPending.status, voidPending.body.error.code], [409, "STATEMENT_REVIEW_PENDING"]);
  assert.equal((await platformStatement(septA.id)).pending_approval_id, requested.approval.id);
  // 只读看得到账单，批不了
  const readonly = await api.call("POST", `/platform/v1/approvals/${requested.approval.id}/approve`, { token: await platformLogin(api, m.staff.readonly.email), body: {} });
  assert.equal(readonly.status, 403);
  await ok(api.call("POST", `/platform/v1/approvals/${requested.approval.id}/approve`, { token: await fin2(), body: {} }));
  const approved = await platformStatement(septA.id);
  assert.deepEqual([approved.status, approved.payout_on, approved.approval_id], ["in_payout", "2026-10-20", requested.approval.id]);
  assert.equal((await tenantStatement(m.a, septA.id)).payout_on, "2026-10-20");

  // 美元那张：答复异议、供应商确认、复核 → 同一个批次（批次里两种币种，按币种合计）
  await ok(api.call("POST", `/platform/v1/statements/${septAUsd.id}/reply`, { token: await fin1(), body: { note: "按下单时的汇率快照，结算价本来就是美元" } }));
  await ok(api.call("POST", `/tenant/v1/statements/${septAUsd.id}/confirm`, { token: await tenantToken(m.a) }));
  assert.equal((await approvePayout(septAUsd.id)).payout_on, "2026-10-20");
  const batches = await api.call("GET", "/platform/v1/payout-batches", { token: await fin1() });
  assertMatchesOpenApi("GET", "/platform/v1/payout-batches", batches);
  const october = batches.body.items.find((batch: any) => batch.pay_date === "2026-10-20");
  assert.deepEqual([october.status, october.statement_count, october.totals], ["open", 2, [{ currency: "JPY", count: 1, total: money("46000") }, { currency: "USD", count: 1, total: money("123.45", "USD") }]]);

  // 锁定批次：之后批准的乙的账单顺延到 11 月 20 日
  const closed = await api.call("POST", `/platform/v1/payout-batches/${october.id}/close`, { token: await fin1() });
  assert.equal(closed.status, 200, closed.text);
  assertMatchesOpenApi("POST", "/platform/v1/payout-batches/{id}/close", closed);
  assert.deepEqual([closed.body.batch.status, closed.body.batch.closed_by, closed.body.batch.statements.length], ["closed", finance1.id, 2]);
  assert.equal((await ok(api.call("POST", `/platform/v1/payout-batches/${october.id}/close`, { token: await fin1() }))).batch.status, "closed");
  assert.equal((await approvePayout(septB.id)).payout_on, "2026-11-20");
  const detail = await api.call("GET", `/platform/v1/payout-batches/${(await platformStatement(septB.id)).payout_batch_id}`, { token: await fin1() });
  assertMatchesOpenApi("GET", "/platform/v1/payout-batches/{id}", detail);
  assert.deepEqual([detail.body.batch.pay_date, detail.body.batch.status, detail.body.batch.statements.map((s: any) => s.id)], ["2026-11-20", "open", [septB.id]]);
  // 已进批次的不能作废、不能再发起
  const voided = await api.call("POST", `/platform/v1/statements/${septA.id}/void`, { token: await fin1(), body: { reason: "测试" } });
  assert.deepEqual([voided.status, voided.body.error.code], [409, "STATEMENT_STATE_INVALID"]);
  const list = await api.call("GET", `/platform/v1/statements?payout_batch_id=${october.id}`, { token: await fin1() });
  assertMatchesOpenApi("GET", "/platform/v1/statements", list);
  assert.deepEqual([list.body.total, list.body.items.length], [2, 2]);
  // 审计：发起、批准、账单的「批准」（操作者是审核人）
  const audit = await api.db.owner.query("select action, actor_id from audit_logs where resource = 'statement' and resource_id = $1 order by occurred_at, id", [septA.id]);
  assert.deepEqual(audit.rows.map((row) => row.action), ["issue", "dispute", "reply", "confirm", "approve"]);
  assert.equal(audit.rows[4].actor_id, finance2.id);
});

test("跨月：按服务日期（城市当地日期）切月——东京 10 月 31 日 23:30 属于 10 月，11 月 1 日 00:30 不属于；9 月没结案的进 10 月（往期调整）；出过账的违约金免除后退回", async () => {
  const lastOfOct = await order("a", "2026-10-31T23:30:00+09:00");
  const firstOfNov = await order("a", "2026-11-01T00:30:00+09:00");
  const midOct = await order("a", "2026-10-15T10:00:00+09:00", { settlement: 15_000 });
  // 9 月 30 日 23:00 的那单 9 月出账时还在服务中，现在完成了
  await setStatus("a", sept["inService"].id, "completed");
  // 9 月扣过的违约金被认定不可抗力
  await api.db.owner.query("update tenant_deductions set status = 'waived', waived_at = $2, waive_reason = '台风停运' where tenant_id = $1 and amount_minor = 6000", [m.a.tenantId, api.clock.now()]);
  // 东京 11 月 1 日 00:00 之前，10 月还没结束
  moveTo("2026-10-31T14:59:59.999Z");
  const early = await api.call("POST", "/platform/v1/statements/generate", { token: await fin1(), body: { period: "2026-10" } });
  assert.equal(early.body.error.code, "PERIOD_NOT_ENDED");
  moveTo("2026-10-31T15:00:00.000Z");
  const tick = await api.app.billingJobs.tick();
  assert.equal(tick.period, "2026-10");
  const octA = (await tenantStatements(m.a, "?period=2026-10")).find((entry) => entry.currency === "JPY");
  const detail = await tenantStatement(m.a, octA.id);
  const byOrder = new Map(detail.lines.map((line: any) => [`${line.kind}:${line.order_no}`, line]));
  assert.equal(byOrder.has(`order:${lastOfOct.orderNo}`), true);
  assert.equal(byOrder.has(`order:${firstOfNov.orderNo}`), false);
  assert.equal((byOrder.get(`order:${midOct.orderNo}`) as any).prior_period, false);
  assert.deepEqual([(byOrder.get(`order:${sept["inService"].orderNo}`) as any).prior_period, (byOrder.get(`order:${sept["inService"].orderNo}`) as any).service_date], [true, "2026-09-30"]);
  const waiver = byOrder.get(`deduction_waiver:${sept["rescued"].orderNo}`) as any;
  assert.deepEqual([waiver.amount, waiver.prior_period, waiver.detail.waive_reason], [money("6000"), true, "台风停运"]);
  // 20,000（10/31）+ 15,000（10/15）+ 20,000（9 月补）+ 6,000（违约金退回）；系统出的账
  assert.equal(detail.total.amount, "61000");
  assert.deepEqual(detail.events.map((event: any) => event.actor_type), ["system"]);
  // 乙 9 月那张晚出的单进了乙 10 月的账（往期调整）
  const octB = (await tenantStatements(m.b, "?period=2026-10"))[0];
  const bLines = (await tenantStatement(m.b, octB.id)).lines;
  assert.deepEqual(bLines.map((line: any) => [line.order_no, line.prior_period]), [[sept["bLate"].orderNo, true]]);
});

test("作废重出：明细释放，同一个事务里按现在的数据重出；作废后的源头改动带进新账单", async () => {
  const octA = (await tenantStatements(m.a, "?period=2026-10")).find((entry) => entry.currency === "JPY");
  // 作废前改源头：10/15 那单的结算价改成 16,000（例如审核更正）
  await api.db.owner.query("update orders set settlement_minor = 16000 where tenant_id = $1 and settlement_minor = 15000", [m.a.tenantId]);
  const res = await api.call("POST", `/platform/v1/statements/${octA.id}/void`, { token: await fin1(), body: { reason: "10 月 15 日那单结算价更正后重出" } });
  assert.equal(res.status, 200, res.text);
  assertMatchesOpenApi("POST", "/platform/v1/statements/{id}/void", res);
  assert.equal(res.body.statement.status, "void");
  assert.ok(res.body.statement.lines.every((line: any) => line.voided));
  assert.equal(res.body.reissued.length, 1);
  const reissued = res.body.reissued[0];
  assert.deepEqual([reissued.period, reissued.currency, reissued.total.amount, reissued.status], ["2026-10", "JPY", "62000", "issued"]);
  assert.notEqual(reissued.statement_no, octA.statement_no);
  // 供应商看得到作废的和重出的
  const statuses = (await tenantStatements(m.a, "?period=2026-10")).filter((entry) => entry.currency === "JPY").map((entry) => entry.status).sort();
  assert.deepEqual(statuses, ["issued", "void"]);
  const again = await api.call("POST", `/platform/v1/statements/${octA.id}/void`, { token: await fin1(), body: { reason: "再作废" } });
  assert.deepEqual([again.status, again.body.error.code], [409, "STATEMENT_STATE_INVALID"]);
});

test("合计为负：复核后转入下期（无需付款）；下一次出账带一行「上期结转」", async () => {
  // 乙：10 月那张（19,800 的晚单）之外再加一笔很大的违约金 → 作废重出成负数
  const rescued = await order("b", "2026-10-20T10:00:00+09:00", { status: "rescued" });
  await deduction("b", rescued.id, 50_000);
  const octB = (await tenantStatements(m.b, "?period=2026-10"))[0];
  const voided = await ok(api.call("POST", `/platform/v1/statements/${octB.id}/void`, { token: await fin1(), body: { reason: "补上 10 月的违约金" } }));
  const negative = voided.reissued[0];
  assert.equal(negative.total.amount, "-30000");
  await ok(api.call("POST", `/tenant/v1/statements/${negative.id}/confirm`, { token: await tenantToken(m.b) }));
  const carried = await approvePayout(negative.id);
  assert.deepEqual([carried.status, carried.payout_on, carried.payout_batch_id], ["carried", null, null]);
  // 只有结转、没有新应付：11 月不出乙的账
  moveTo("2026-11-30T15:00:00.000Z");
  assert.equal((await api.app.billingJobs.tick()).period, "2026-11");
  assert.deepEqual(await tenantStatements(m.b, "?period=2026-11"), []);
  // 12 月有了新的单：结转一起出
  const dec = await order("b", "2026-12-05T10:00:00+09:00", { settlement: 45_000 });
  moveTo("2026-12-31T15:00:00.000Z");
  await api.app.billingJobs.tick();
  const decB = (await tenantStatements(m.b, "?period=2026-12"))[0];
  const lines = (await tenantStatement(m.b, decB.id)).lines;
  assert.deepEqual(lines.map((line: any) => [line.kind, line.order_no, line.amount.amount, line.prior_period]), [["carry_forward", null, "-30000", true], ["order", dec.orderNo, "45000", false]]);
  assert.equal(lines[0].detail.statement_no, negative.statement_no);
  assert.equal(decB.total.amount, "15000");
  // 应付日：已清退的供应商最后一期延后一个周期付款
  await api.db.owner.query("update tenants set status = 'terminated', terminated_at = $2 where id = $1", [m.b.tenantId, api.clock.now()]);
  await order("b", "2027-01-05T10:00:00+09:00");
  moveTo("2027-01-31T15:00:00.000Z");
  await api.app.billingJobs.tick();
  const janB = (await tenantStatements(m.b, "?period=2027-01"))[0];
  assert.equal(janB.pay_due_on, "2027-03-20");
});

test("数据库把关：明细只追加（平台只能改作废时间），同一笔应付不能同时挂在两张有效的账单上", async () => {
  await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query("update statement_lines set amount_minor = 1 where tenant_id = $1", [m.a.tenantId])), deniedByDatabase);
  await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query("delete from statement_lines where tenant_id = $1", [m.a.tenantId])), deniedByDatabase);
  const line = (await api.db.owner.query("select * from statement_lines where tenant_id = $1 and voided_at is null limit 1", [m.a.tenantId])).rows[0];
  await assert.rejects(
    api.db.owner.query("insert into statement_lines (tenant_id, statement_id, kind, source_key, order_id, order_no, service_date, prior_period, amount_minor, currency, detail, created_at) values ($1, $2, $3, $4, $5, $6, $7, false, $8, $9, '{}', now())", [
      line.tenant_id, line.statement_id, line.kind, line.source_key, line.order_id, line.order_no, line.service_date, line.amount_minor, line.currency,
    ]),
    /statement_lines_source_key/,
  );
});

test("数据范围：限定了城市或渠道的员工不能用财务接口（403 DATA_SCOPE_DENIED），付款复核在待审核队列里也看不到", async () => {
  const role = await ok(api.call("POST", "/platform/v1/roles", { token: await root(), body: { name: "东京财务", grants: ["finance:view", "finance:edit", "finance:review", "approvals:view"], data_scope: { city_ids: [m.ids.tokyo], channel_ids: null } } }), 201);
  const invited = await ok(api.call("POST", "/platform/v1/staff", { token: await root(), body: { email: "fin-tokyo@platform.test", name: "东京财务", role: role.key } }), 201);
  await ok(api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.invite.token, password: TEST_PASSWORD } }));
  const scoped = { token: await platformLogin(api, "fin-tokyo@platform.test") };
  for (const [method, path] of [["GET", "/platform/v1/statements"], ["GET", `/platform/v1/statements/${septA.id}`], ["GET", "/platform/v1/payout-batches"], ["POST", "/platform/v1/statements/generate"]] as const) {
    const res = await api.call(method, path, { token: scoped.token, body: method === "POST" ? {} : undefined });
    assert.deepEqual([res.status, res.body.error.code], [403, "DATA_SCOPE_DENIED"], `${method} ${path}`);
  }
  // 甲 10 月重出的那张：确认期早已过，定时任务视为确认了
  const pendingStatement = (await tenantStatements(m.a, "?period=2026-10")).find((entry) => entry.status === "confirmed");
  assert.equal(pendingStatement.confirmed_by_type, "system");
  const requested = await ok(api.call("POST", `/platform/v1/statements/${pendingStatement.id}/payout-approval`, { token: await fin1(), body: {} }), 202);
  const queue = await ok(api.call("GET", "/platform/v1/approvals", { token: scoped.token }));
  assert.equal(queue.items.some((item: any) => item.id === requested.approval.id), false);
  assert.equal((await api.call("GET", `/platform/v1/approvals/${requested.approval.id}`, { token: scoped.token })).status, 404);
  assert.equal((await api.call("POST", `/platform/v1/approvals/${requested.approval.id}/approve`, { token: scoped.token, body: {} })).status, 404);
  // 不限范围的财务照常看得到
  assert.equal((await ok(api.call("GET", "/platform/v1/approvals", { token: await fin2() }))).items.some((item: any) => item.id === requested.approval.id), true);
});

test("确认期截止后定时任务还没跑：提异议 409 并在同一事务里记为系统确认；确认照常成功", async () => {
  await order("a", "2027-01-10T10:00:00+09:00");
  await order("a", "2027-01-11T10:00:00+09:00", { currency: "USD", settlement: 900 });
  const created = (await generate(await fin1(), "2027-01")).created.filter((entry: any) => entry.tenant.id === m.a.tenantId);
  const jpy = created.find((entry: any) => entry.currency === "JPY");
  const usd = created.find((entry: any) => entry.currency === "USD");
  moveTo(new Date(new Date(jpy.confirm_due_at).getTime() + 30 * 60_000).toISOString());
  const token = await tenantToken(m.a);
  const late = await api.call("POST", `/tenant/v1/statements/${jpy.id}/dispute`, { token, body: { reason: "过期再提" } });
  assert.deepEqual([late.status, late.body.error.code], [409, "STATEMENT_CONFIRM_PERIOD_OVER"]);
  assertMatchesOpenApi("POST", "/tenant/v1/statements/{id}/dispute", late);
  const after = await platformStatement(jpy.id);
  assert.deepEqual([after.status, after.confirmed_by_type], ["confirmed", "system"]);
  assert.deepEqual(after.events.map((event: any) => event.action), ["issue", "auto_confirm"]);
  const confirmed = await ok(api.call("POST", `/tenant/v1/statements/${usd.id}/confirm`, { token }));
  assert.deepEqual([confirmed.statement.status, confirmed.statement.confirmed_by_type], ["confirmed", "tenant_user"]);
});
