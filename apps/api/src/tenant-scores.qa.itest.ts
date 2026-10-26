/**
 * M4-01 测试角色补充（ADR 0028）：评分 90 天窗口和司机未到 30 天窗口的边界（按东京日期的 0 点，第 90 天算、第 91 天不算）、
 * 多个实例同时跑每日检查只做一次、试运营每日 10 单上限（并发下单、东京午夜、待支付计入、取消释放、询价和下单一致）、
 * 不足 20 单的默认 4.5 和按评分的观察期真的改变中标。真实 PostgreSQL、真实接口；数据都在本文件里建。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tenantDate, tenantDayStart } from "@nozomi/domain";
import { withPlatformTx } from "./db/context.ts";
import { recordOrderReview, recordPerformanceEvent } from "./repos/tenant-onboarding.ts";
import { QUOTE_CATALOG_TTL_MS } from "./services/quote-catalog.ts";
import { TEST_PASSWORD, type TenantFixture, type TestApi, createTestApi } from "./testing/api.ts";
import { type Market, DROPOFF, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { FakePaymentProvider } from "./testing/payments.ts";

let api: TestApi;
let m: Market;
const DAY = 86_400_000;

before(async () => {
  api = await createTestApi({ payments: new FakePaymentProvider() });
  m = await buildMarket(api);
});
after(() => api.close());

let orderSeq = 0;
const orderNo = (): string => `NZ20261025${String((orderSeq += 1)).padStart(8, "0")}`;

/** 在库里摆 `count` 张单（下单时刻 `at`）；completed 的另记一条「变成已完成」的流水（同一时刻）。 */
async function seedOrders(who: TenantFixture, productId: string, count: number, options: { status?: "completed" | "confirmed"; at?: Date } = {}): Promise<string[]> {
  const at = options.at ?? api.clock.now();
  const status = options.status ?? "completed";
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = randomUUID();
    await api.db.owner.query(
      `insert into orders (tenant_id, id, order_no, status, category, city_id, place_id, direction, product_id, product_version, vehicle_group_id, service_at, service_local, timezone, service_date,
                           urgent, passengers, luggage, addons, passenger, settlement_minor, settlement_currency, settlement, inventory_held, payment_due_at, confirmed_at, dispatch_due_at, created_at, updated_at)
       values ($1, $2, $3, $4, 'airport_transfer', $5, $6, 'pickup', $7, 1, $8, $9, '2026-10-01T10:00', 'Asia/Tokyo', '2026-10-01',
               false, 2, 1, '[]', '{}', 10000, 'JPY', '{}', false, $9::timestamptz + interval '30 minutes', $9, $9, $9, $9)`,
      [who.tenantId, id, orderNo(), status, m.ids.tokyo, m.ids.narita, productId, m.ids.biz7, at],
    );
    if (status === "completed") await api.db.owner.query("insert into order_events (tenant_id, order_id, from_status, to_status, actor, occurred_at) values ($1, $2, 'in_service', 'completed', 'system', $3)", [who.tenantId, id, at]);
    ids.push(id);
  }
  return ids;
}

async function perform(who: TenantFixture, orderIds: readonly string[], facts: { dispatchOnTime?: boolean; arrivalOnTime?: boolean; rating?: number; complaint?: boolean; noShow?: boolean; at?: Date }): Promise<void> {
  const at = facts.at ?? api.clock.now();
  await withPlatformTx(api.db.pool, async (db) => {
    for (const orderId of orderIds) {
      const base = { tenantId: who.tenantId, orderId, occurredAt: at, now: at };
      if (facts.dispatchOnTime !== undefined) await recordPerformanceEvent(db, { ...base, kind: "dispatch", onTime: facts.dispatchOnTime });
      if (facts.arrivalOnTime !== undefined) await recordPerformanceEvent(db, { ...base, kind: "arrival", onTime: facts.arrivalOnTime });
      if (facts.complaint) await recordPerformanceEvent(db, { ...base, kind: "complaint", major: false });
      if (facts.noShow) await recordPerformanceEvent(db, { ...base, kind: "failure", failureType: "driver_no_show" });
      if (facts.rating !== undefined) await recordOrderReview(db, { tenantId: who.tenantId, orderId, rating: facts.rating, comment: null, now: at });
    }
  });
}

async function login(portal: "platform" | "tenant", email: string): Promise<string> {
  return (await ok(api.call("POST", `/${portal}/v1/auth/login`, { body: { email, password: TEST_PASSWORD } }))).access_token;
}
const root = (): Promise<string> => login("platform", "root@platform.test");
const tenantOf = async (who: TenantFixture): Promise<any> => ok(api.call("GET", `/platform/v1/tenants/${who.tenantId}`, { token: await root() }));

async function reset(): Promise<void> {
  const ids = [m.a.tenantId, m.b.tenantId];
  await api.db.owner.query("delete from payment_events where order_id in (select id from orders where tenant_id = any($1::uuid[]))", [ids]);
  for (const table of ["order_payments", "order_sales"]) await api.db.owner.query(`delete from ${table} where supplier_tenant_id = any($1::uuid[])`, [ids]);
  for (const table of ["tenant_performance_events", "order_reviews", "order_events", "orders"]) await api.db.owner.query(`delete from ${table} where tenant_id = any($1::uuid[])`, [ids]);
  await api.db.owner.query(
    "update tenants set status = 'active', suspended_from = null, suspension_reasons = '{}', suspended_at = null, observation_reasons = '{}', observation_since = null, score_centi = null, score_raw_centi = null, score_completed_orders = 0, score_no_shows = 0, score_on = null where id = any($1::uuid[])",
    [[m.a.tenantId, m.b.tenantId]],
  );
}

/** 拨到下一个东京日期的 `hh:mm`（东京时间）。 */
function moveToNextTokyoDay(hour = 10, minute = 0): void {
  const next = tenantDate(new Date(api.clock.now().getTime() + DAY));
  const target = Date.parse(`${next}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+09:00`);
  api.clock.advance(target - api.clock.now().getTime());
}

async function preview(): Promise<any> {
  const serviceDate = tenantDate(new Date(api.clock.now().getTime() + 5 * DAY));
  api.clock.advance(QUOTE_CATALOG_TTL_MS + 1);
  const res = await api.call("POST", "/platform/v1/quotes/preview", { token: await root(), body: { city_id: m.ids.tokyo, category: "airport_transfer", place_id: m.ids.narita, currency: "JPY", direction: "pickup", dropoff: DROPOFF, service_time: `${serviceDate}T10:00`, passengers: 2, luggage: 1, vehicle_group_ids: [m.ids.biz7] } });
  assert.equal(res.status, 200, res.text);
  return res.body;
}
const biz = (body: any): any => body.groups.find((group: any) => group.vehicle_group_id === m.ids.biz7);

// ---- 评分窗口 ----

test("评分窗口按东京日期：今天往前第 89 天东京 0 点完成的单算（第 90 天），早 1 毫秒的不算；第二天这些单就出窗口（第 91 天）", async () => {
  await reset();
  // 先把今天做掉，之后拨到下一天的 10:00（东京）再做
  await api.app.tenantJobs.tick();
  const nextNow = (() => {
    const next = tenantDate(new Date(api.clock.now().getTime() + DAY));
    return { date: next, at: Date.parse(`${next}T10:00:00+09:00`) };
  })();
  const windowStartDate = new Date(Date.parse(`${nextNow.date}T00:00:00Z`) - 89 * DAY).toISOString().slice(0, 10);
  const boundary = tenantDayStart(new Date(0), windowStartDate);
  assert.equal(boundary.toISOString(), `${new Date(Date.parse(`${windowStartDate}T00:00:00Z`) - DAY).toISOString().slice(0, 10)}T15:00:00.000Z`, "窗口起点是东京 0 点 = UTC 前一天 15:00");
  const inside = await seedOrders(m.a, m.ids.pa, 20, { at: boundary });
  await perform(m.a, inside, { dispatchOnTime: true, arrivalOnTime: true, rating: 5, at: boundary });
  const outside = await seedOrders(m.a, m.ids.pa, 3, { at: new Date(boundary.getTime() - 1) });
  await perform(m.a, outside, { dispatchOnTime: false, arrivalOnTime: false, rating: 1, complaint: true, at: new Date(boundary.getTime() - 1) });
  api.clock.advance(nextNow.at - api.clock.now().getTime());
  await api.app.tenantJobs.tick();
  let tenant = await tenantOf(m.a);
  assert.deepEqual([tenant.score.completed_orders, tenant.score.score_centi, tenant.score.raw_score_centi], [20, 500, 500], "第 90 天的 20 单算，第 91 天的 3 单不算");
  const day = (await api.db.owner.query("select window_from::text as window_from from tenant_score_daily where tenant_id = $1 and score_date = $2", [m.a.tenantId, nextNow.date])).rows[0];
  assert.equal(day?.window_from, windowStartDate);
  // 第二天：那 20 单到了第 91 天
  moveToNextTokyoDay(0, 0);
  api.clock.advance(1);
  await api.app.tenantJobs.tick();
  tenant = await tenantOf(m.a);
  assert.deepEqual([tenant.score.completed_orders, tenant.score.score_centi], [0, 450]);
});

test("司机未到 30 天窗口按东京日期：今天往前第 29 天 0 点的算，早 1 毫秒的不算；2 次进观察期，第二天滑出窗口自动退出", async () => {
  await reset();
  await api.app.tenantJobs.tick();
  const next = tenantDate(new Date(api.clock.now().getTime() + DAY));
  const startDate = new Date(Date.parse(`${next}T00:00:00Z`) - 29 * DAY).toISOString().slice(0, 10);
  const boundary = tenantDayStart(new Date(0), startDate);
  const orders = await seedOrders(m.b, m.ids.pb, 3, { status: "confirmed", at: new Date(boundary.getTime() - DAY) });
  await perform(m.b, orders.slice(0, 2), { noShow: true, at: boundary });
  await perform(m.b, orders.slice(2), { noShow: true, at: new Date(boundary.getTime() - 1) });
  api.clock.advance(Date.parse(`${next}T10:00:00+09:00`) - api.clock.now().getTime());
  await api.app.tenantJobs.tick();
  let tenant = await tenantOf(m.b);
  assert.deepEqual([tenant.score.no_shows, tenant.observation_reasons, tenant.status], [2, ["driver_no_show"], "active"], "窗口里 2 次：观察，不暂停");
  moveToNextTokyoDay();
  await api.app.tenantJobs.tick();
  tenant = await tenantOf(m.b);
  assert.deepEqual([tenant.score.no_shows, tenant.observation_reasons], [0, []]);
});

// ---- 每日检查：多实例 ----

test("多个实例同时跑每日检查：同一天每家只做一次（评分一行、状态记录一条、提醒一条），几轮加起来做的家数等于供应商数", async () => {
  await reset();
  await api.app.tenantJobs.tick();
  const orders = await seedOrders(m.b, m.ids.pb, 2, { status: "confirmed" });
  await perform(m.b, orders, { noShow: true });
  moveToNextTokyoDay();
  const today = tenantDate(api.clock.now());
  const live = (await api.db.owner.query<{ n: number }>("select count(*)::int as n from tenants where status <> 'terminated'")).rows[0]?.n ?? 0;
  const results = await Promise.all([api.app.tenantJobs.tick(), api.app.tenantJobs.tick(), api.app.tenantJobs.tick(), api.app.tenantJobs.tick()]);
  const evaluated = results.reduce((sum, result) => sum + result.evaluated, 0);
  // 被别的实例锁住而跳过的，再跑一轮补上
  const more = await api.app.tenantJobs.tick();
  assert.equal(evaluated + more.evaluated, live, JSON.stringify(results));
  assert.deepEqual(await api.app.tenantJobs.tick(), { evaluated: 0, skipped: 0 });
  const rows = await api.db.owner.query<{ tenant_id: string; n: number }>("select tenant_id, count(*)::int as n from tenant_score_daily where score_date = $1 group by tenant_id", [today]);
  assert.equal(rows.rows.length, live);
  assert.ok(rows.rows.every((row) => row.n === 1));
  const events = await api.db.owner.query<{ n: number }>("select count(*)::int as n from tenant_status_events where tenant_id = $1 and occurred_at >= $2", [m.b.tenantId, tenantDayStart(api.clock.now())]);
  assert.equal(events.rows[0]?.n, 1, "进入观察期只记一次");
  const notices = await api.db.owner.query<{ n: number }>("select count(*)::int as n from tenant_notices where tenant_id = $1 and kind = 'observation_started' and created_at >= $2", [m.b.tenantId, tenantDayStart(api.clock.now())]);
  assert.equal(notices.rows[0]?.n, 1);
  const audits = await api.db.owner.query<{ n: number }>("select count(*)::int as n from audit_logs where tenant_id = $1 and resource = 'tenant' and action = 'observe' and occurred_at >= $2", [m.b.tenantId, tenantDayStart(api.clock.now())]);
  assert.equal(audits.rows[0]?.n, 1);
});

// ---- 评分进入报价引擎 ----

test("报价引擎：不足 20 单的满分供应商按默认 4.50，比不过 25 单 4.80 的（同价区间内评分高者中标）；后者评分跌到 4.00 以下进观察期（×1.05）后中标换回便宜的", async () => {
  await reset();
  // 乙（便宜）19 单全满分 → 默认 4.50；甲 25 单：派车 4 单晚（84%）→ 0.25×4.2 + 0.25×5 + 0.2×5 + 0.2×5 + 0.1×5 = 4.80
  const bOrders = await seedOrders(m.b, m.ids.pb, 19);
  await perform(m.b, bOrders, { dispatchOnTime: true, arrivalOnTime: true, rating: 5 });
  const aOrders = await seedOrders(m.a, m.ids.pa, 25);
  await perform(m.a, aOrders.slice(0, 21), { dispatchOnTime: true, arrivalOnTime: true, rating: 5 });
  await perform(m.a, aOrders.slice(21), { dispatchOnTime: false, arrivalOnTime: true, rating: 5 });
  moveToNextTokyoDay();
  await api.app.tenantJobs.tick();
  let group = biz(await preview());
  const candidates = Object.fromEntries(group.candidates.map((entry: any) => [entry.tenant_id, [entry.score_centi, entry.completed_orders, entry.observation, entry.in_band]]));
  assert.deepEqual(candidates[m.b.tenantId], [450, 19, false, true]);
  assert.deepEqual(candidates[m.a.tenantId], [480, 25, false, true]);
  assert.equal(group.winner.tenant_id, m.a.tenantId, "评分高的中标");
  // 甲：15 单投诉成立（60%，2 分）、评价全改成 3 分 → 1.05 + 1.25 + 0.6 + 0.4 + 0.5 = 3.80：观察期、不暂停
  await perform(m.a, aOrders.slice(0, 15), { complaint: true });
  await api.db.owner.query("update order_reviews set rating = 3 where tenant_id = $1", [m.a.tenantId]);
  moveToNextTokyoDay();
  await api.app.tenantJobs.tick();
  const a = await tenantOf(m.a);
  assert.equal(a.score.score_centi, 380);
  assert.deepEqual([a.status, a.observation_reasons], ["active", ["score_below_threshold"]]);
  group = biz(await preview());
  assert.equal(group.winner.tenant_id, m.b.tenantId, "观察期排序价 ×1.05：甲出了同价区间");
  const observed = group.candidates.find((entry: any) => entry.tenant_id === m.a.tenantId);
  assert.equal(observed.observation, true);
});

// ---- 试运营每日上限 ----

async function salesSetup(): Promise<{ token: string }> {
  const cm1 = await login("platform", "cm1@platform.test");
  const cm2 = await login("platform", "cm2@platform.test");
  const market = { ...m, staff: { ...m.staff, cm1: { ...m.staff.cm1, token: cm1 }, cm2: { ...m.staff.cm2, token: cm2 } } };
  const channelId = (await newChannel(api, cm1, { name: `官网（试运营 QA ${randomUUID().slice(0, 6)}）` })).id;
  return salesCredentials(api, market, channelId);
}

async function salesQuote(token: string): Promise<any> {
  api.clock.advance(QUOTE_CATALOG_TTL_MS + 1);
  const serviceTime = `${tenantDate(new Date(api.clock.now().getTime() + 5 * DAY))}T10:00:00+09:00`;
  const res = await api.call("POST", "/sales/v1/quotes", { token, body: { city_id: m.ids.tokyo, category: "airport_transfer", place_id: m.ids.narita, direction: "pickup", dropoff: DROPOFF, service_time: serviceTime, passengers: 2, luggage: 1, currency: "JPY", vehicle_group_ids: [m.ids.biz7] } });
  assert.equal(res.status, 200, res.text);
  return res.body.quotes[0];
}

function salesOrder(token: string, quoteId: string): Promise<any> {
  return api.call("POST", "/sales/v1/orders", {
    token,
    headers: { "idempotency-key": randomUUID() },
    body: { quote_id: quoteId, passenger: { name: "王小明", phone: "+81 90-1234-5678", email: "guest@example.com" }, flight_no: "NH211", dropoff_address: "东京站", save_payment_method: true },
  });
}

/** 乙（便宜）的报价：只要乙还能接单，就是乙中标。 */
async function quotesFromB(token: string, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const quote = await salesQuote(token);
    assert.equal(quote.tenant_id ?? (await tenantOfQuote(quote.quote_id)), m.b.tenantId);
    ids.push(quote.quote_id);
  }
  return ids;
}
async function tenantOfQuote(quoteId: string): Promise<string> {
  return (await api.db.owner.query<{ tenant_id: string }>("select snapshot->'winner'->>'tenantId' as tenant_id from quotes where id = $1", [quoteId])).rows[0]?.tenant_id ?? "";
}
async function bOrdersToday(): Promise<number> {
  return (await api.db.owner.query<{ n: number }>("select count(*)::int as n from orders where tenant_id = $1 and status <> 'cancelled' and created_at >= $2", [m.b.tenantId, tenantDayStart(api.clock.now())])).rows[0]?.n ?? 0;
}

test("试运营上限并发：今天 0 单，12 个报价同时下单——正好 10 单成功（都是待支付，也计入），2 单 409 TRIAL_DAILY_LIMIT；取消 1 单释放 1 个名额", async () => {
  await reset();
  moveToNextTokyoDay(9, 0);
  // 渠道的下单接口每分钟有限流：分三个渠道各下 4 单，同时发出
  const channels = [await salesSetup(), await salesSetup(), await salesSetup()];
  const token = (channels[0] as { token: string }).token;
  await api.db.owner.query("update tenants set status = 'trial', trial_started_at = $2, activated_at = null where id = $1", [m.b.tenantId, api.clock.now()]);
  const batches: [string, string][] = [];
  for (const channel of channels) for (const id of await quotesFromB(channel.token, 4)) batches.push([channel.token, id]);
  const results = await Promise.all(batches.map(([channelToken, id]) => salesOrder(channelToken, id)));
  const statuses = results.map((res) => res.status);
  assert.equal(statuses.filter((status) => status === 201).length, 10, results.map((res) => `${res.status}:${res.body?.error?.details?.reason ?? ""}`).join(","));
  for (const res of results.filter((entry) => entry.status !== 201)) assert.deepEqual([res.status, res.body.error.code, res.body.error.details.reason], [409, "QUOTE_NO_LONGER_AVAILABLE", "TRIAL_DAILY_LIMIT"]);
  assert.equal(await bOrdersToday(), 10);
  const pending = await api.db.owner.query<{ n: number }>("select count(*)::int as n from orders where tenant_id = $1 and status = 'pending_payment'", [m.b.tenantId]);
  assert.equal(pending.rows[0]?.n, 10, "10 单都还在待支付，照样占名额");
  // 询价也一致：乙不参加，甲中标
  const capped = await salesQuote(token);
  assert.equal(await tenantOfQuote(capped.quote_id), m.a.tenantId);
  // 取消（超时）一单：名额回来一个
  await api.db.owner.query("update orders set status = 'cancelled', cancelled_at = $2, cancel_reason = 'PAYMENT_TIMEOUT' where id = (select id from orders where tenant_id = $1 and status = 'pending_payment' order by created_at limit 1)", [m.b.tenantId, api.clock.now()]);
  const [again] = await quotesFromB(token, 1);
  const placed = await salesOrder(token, again as string);
  assert.equal(placed.status, 201, placed.text);
  assert.equal(await tenantOfQuote((await salesQuote(token)).quote_id), m.a.tenantId, "又满了");
});

test("试运营上限按东京日期：东京 23:59 已满 10 单，询价和下单都拒；过了东京 0 点立刻恢复，前一天 23:59 的单不计入新的一天", async () => {
  await reset();
  moveToNextTokyoDay(23, 50);
  const { token } = await salesSetup();
  await api.db.owner.query("update tenants set status = 'trial', trial_started_at = $2, activated_at = null where id = $1", [m.b.tenantId, api.clock.now()]);
  // 23:50 拿一个乙的报价（报价 30 分钟内有效），之后摆 10 单
  const [early] = await quotesFromB(token, 1);
  const lateEvening = new Date(Date.parse(`${tenantDate(api.clock.now())}T23:59:00+09:00`));
  await seedOrders(m.b, m.ids.pb, 10, { status: "confirmed", at: lateEvening });
  api.clock.advance(lateEvening.getTime() + 30_000 - api.clock.now().getTime() - QUOTE_CATALOG_TTL_MS - 1);
  const refused = await salesQuote(token);
  assert.equal(await tenantOfQuote(refused.quote_id), m.a.tenantId, "23:59 已满，乙不参加比价");
  const late = await salesOrder(token, early as string);
  assert.deepEqual([late.status, late.body.error?.details?.reason], [409, "TRIAL_DAILY_LIMIT"]);
  // 拨到东京 0 点 00:00:01
  const midnight = tenantDayStart(new Date(api.clock.now().getTime() + DAY));
  api.clock.advance(midnight.getTime() + 1_000 - api.clock.now().getTime() - QUOTE_CATALOG_TTL_MS - 1);
  const [fresh] = await quotesFromB(token, 1);
  const placed = await salesOrder(token, fresh as string);
  assert.equal(placed.status, 201, placed.text);
  // 报价时刻在 0 点之前的那一张（还在 30 分钟有效期内）在新的一天也能下
  const yesterday = await salesOrder(token, early as string);
  assert.equal(yesterday.status, 201, yesterday.text);
  assert.equal(await bOrdersToday(), 2);
  await api.db.owner.query("update tenants set status = 'active' where id = $1", [m.b.tenantId]);
});

test("「跌破」口径：评分自动暂停、人工恢复后分数从没回升到 3.50 以上，只是完成单数短暂掉到 20 单以下（比价用默认 4.50），回到 20 单时不会再被自动暂停", async () => {
  await reset();
  await api.app.tenantJobs.tick();
  const next = tenantDate(new Date(api.clock.now().getTime() + DAY));
  const boundary = tenantDayStart(new Date(0), new Date(Date.parse(`${next}T00:00:00Z`) - 89 * DAY).toISOString().slice(0, 10));
  const bad = { dispatchOnTime: false, arrivalOnTime: false, rating: 1 };
  // 1 单在明天窗口的第一天（后天就出窗口），19 单是现在的
  const leaving = await seedOrders(m.a, m.ids.pa, 1, { at: boundary });
  await perform(m.a, leaving, { ...bad, at: boundary });
  const recent = await seedOrders(m.a, m.ids.pa, 19);
  await perform(m.a, recent, bad);
  moveToNextTokyoDay();
  await api.app.tenantJobs.tick();
  let tenant = await tenantOf(m.a);
  assert.deepEqual([tenant.status, tenant.suspension_reasons, tenant.score.raw_score_centi], ["suspended", ["score_below_red_line"], 170]);
  // 运营人工恢复（分数没回升）
  await ok(api.call("POST", `/platform/v1/tenants/${m.a.tenantId}/resume`, { token: await root(), body: {} }));
  // 后天：那 1 单出窗口，剩 19 单 → 比价用默认 4.50（按数据仍是 1.70）
  moveToNextTokyoDay();
  await api.app.tenantJobs.tick();
  tenant = await tenantOf(m.a);
  assert.deepEqual([tenant.status, tenant.score.completed_orders, tenant.score.score_centi, tenant.score.raw_score_centi], ["active", 19, 450, 170]);
  // 又完成 1 单（同样差）→ 20 单、1.70：按数据的分从没回到 3.50 以上
  const another = await seedOrders(m.a, m.ids.pa, 1);
  await perform(m.a, another, bad);
  moveToNextTokyoDay();
  await api.app.tenantJobs.tick();
  tenant = await tenantOf(m.a);
  // 期望：ADR 0028「运营人工恢复以后分数还没回升，第二天不会马上又被暂停；回升到 3.5 以上再跌破会再暂停」——默认分 4.50 不是回升
  assert.deepEqual([tenant.status, tenant.suspension_reasons], ["active", []], "默认分被当成了「上一次不低于 3.5」，没有回升也被再次自动暂停");
});
