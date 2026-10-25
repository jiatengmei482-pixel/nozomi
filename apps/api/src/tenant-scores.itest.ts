/**
 * M4-01：履约评分、自动观察 / 暂停 / 转正式、评分和单量接进报价引擎、试运营每日订单上限（ADR 0028）。真实 PostgreSQL、真实接口。
 *
 * 评分的输入（已完成订单、履约事件、客人评价）在这里直接写进库：派车、履约回传、救援、工单、评价的入口在后续任务；
 * 写法和那些任务要调的 `recordPerformanceEvent` / `recordOrderReview` 一样（同一张表、同样的约束）。每日检查由 `api.app.tenantJobs.tick()` 触发。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { tenantDate } from "@nozomi/domain";
import { withPlatformTx } from "./db/context.ts";
import { recordOrderReview, recordPerformanceEvent } from "./repos/tenant-onboarding.ts";
import { QUOTE_CATALOG_TTL_MS } from "./services/quote-catalog.ts";
import { TEST_PASSWORD, type TenantFixture, type TestApi, createTestApi, resumeTenantNow } from "./testing/api.ts";
import { type Market, DROPOFF, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
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
/** 订单号：NZ + 8 位数字 + 8 位（数字和去掉 I、O 的大写字母）。 */
const orderNo = (): string => `NZ20261007${String((orderSeq += 1)).padStart(8, "0")}`;

/**
 * 在库里摆 `count` 张这个供应商的单（东京成田接机，结算价 1 万日元）：`status` 为 completed 时另记一条变成「已完成」的状态流水（时刻 `at`）。
 * 下单时刻也是 `at`（试运营的每日上限按下单时刻数）。返回订单编号。
 */
async function seedOrders(who: TenantFixture, productId: string, count: number, options: { status?: "completed" | "confirmed"; at?: Date } = {}): Promise<string[]> {
  const at = options.at ?? api.clock.now();
  const status = options.status ?? "completed";
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = randomUUID();
    await api.db.owner.query(
      `insert into orders (tenant_id, id, order_no, status, category, city_id, place_id, direction, product_id, product_version, vehicle_group_id, service_at, service_local, timezone, service_date,
                           urgent, passengers, luggage, addons, passenger, settlement_minor, settlement_currency, settlement, inventory_held, payment_due_at, confirmed_at, created_at, updated_at)
       values ($1, $2, $3, $4, 'airport_transfer', $5, $6, 'pickup', $7, 1, $8, $9, '2026-10-01T10:00', 'Asia/Tokyo', '2026-10-01',
               false, 2, 1, '[]', '{}', 10000, 'JPY', '{}', false, $9::timestamptz + interval '30 minutes', $9, $9, $9)`,
      [who.tenantId, id, orderNo(), status, m.ids.tokyo, m.ids.narita, productId, m.ids.biz7, at],
    );
    if (status === "completed") await api.db.owner.query("insert into order_events (tenant_id, order_id, from_status, to_status, actor, occurred_at) values ($1, $2, 'in_service', 'completed', 'system', $3)", [who.tenantId, id, at]);
    ids.push(id);
  }
  return ids;
}

/** 给这些单记履约事件、评价（用后续任务要调的同一组函数）。 */
async function perform(who: TenantFixture, orderIds: readonly string[], facts: { dispatchOnTime?: boolean; arrivalOnTime?: boolean; rating?: number; complaint?: "minor" | "major"; failure?: "rescue" | "driver_no_show" | "major_delay"; at?: Date }): Promise<void> {
  const at = facts.at ?? api.clock.now();
  await withPlatformTx(api.db.pool, async (db) => {
    for (const orderId of orderIds) {
      const base = { tenantId: who.tenantId, orderId, occurredAt: at, now: at };
      if (facts.dispatchOnTime !== undefined) await recordPerformanceEvent(db, { ...base, kind: "dispatch", onTime: facts.dispatchOnTime });
      if (facts.arrivalOnTime !== undefined) await recordPerformanceEvent(db, { ...base, kind: "arrival", onTime: facts.arrivalOnTime });
      if (facts.complaint !== undefined) await recordPerformanceEvent(db, { ...base, kind: "complaint", major: facts.complaint === "major" });
      if (facts.failure !== undefined) await recordPerformanceEvent(db, { ...base, kind: "failure", failureType: facts.failure });
      if (facts.rating !== undefined) await recordOrderReview(db, { tenantId: who.tenantId, orderId, rating: facts.rating, comment: null, now: at });
    }
  });
}

/** 过一天（东京时间的下一天）再跑一次每日检查。 */
async function nextDay(days = 1): Promise<void> {
  api.clock.advance(days * DAY);
  await api.app.tenantJobs.tick();
}

/** 会话 8 小时过期，这里的时钟一次拨好几天：每次现登录一个。 */
async function login(portal: "platform" | "tenant", email: string): Promise<string> {
  return (await ok(api.call("POST", `/${portal}/v1/auth/login`, { body: { email, password: TEST_PASSWORD } }))).access_token;
}
const root = (): Promise<string> => login("platform", "root@platform.test");
const own = (who: TenantFixture): Promise<string> => login("tenant", who.adminEmail);

const tenantOf = async (who: TenantFixture): Promise<any> => {
  const res = await api.call("GET", `/platform/v1/tenants/${who.tenantId}`, { token: await root() });
  assertMatchesOpenApi("GET", "/platform/v1/tenants/{id}", res);
  return res.body;
};

/** 平台侧试算：5 天后上午 10 点成田接机（离用车足够远，又不会因为时钟往后拨而过期）。 */
async function preview(): Promise<any> {
  const serviceDate = tenantDate(new Date(api.clock.now().getTime() + 5 * DAY));
  api.clock.advance(QUOTE_CATALOG_TTL_MS + 1);
  const res = await api.call("POST", "/platform/v1/quotes/preview", { token: await root(), body: { city_id: m.ids.tokyo, category: "airport_transfer", place_id: m.ids.narita, currency: "JPY", direction: "pickup", dropoff: DROPOFF, service_time: `${serviceDate}T10:00`, passengers: 2, luggage: 1, vehicle_group_ids: [m.ids.biz7] } });
  assert.equal(res.status, 200, res.text);
  return res.body;
}
const biz = (body: any): any => body.groups.find((group: any) => group.vehicle_group_id === m.ids.biz7);

async function clearScoreInputs(): Promise<void> {
  for (const table of ["tenant_performance_events", "order_reviews", "order_events", "orders"]) await api.db.owner.query(`delete from ${table} where tenant_id = any($1::uuid[])`, [[m.a.tenantId, m.b.tenantId]]);
  await api.db.owner.query("update tenants set status = 'active', suspended_from = null, suspension_reasons = '{}', suspended_at = null, observation_reasons = '{}', observation_since = null, score_centi = null, score_raw_centi = null, score_completed_orders = 0, score_no_shows = 0, score_on = null where id = any($1::uuid[])", [[m.a.tenantId, m.b.tenantId]]);
}

test("90 天滚动评分：完成不足 20 单用默认 4.50（按数据的分照样记下）；第 20 单起用真实的分；超过 90 天的单不算；每天一行，供应商和运营看到的一样", async () => {
  await clearScoreInputs();
  const perfect = { dispatchOnTime: true, arrivalOnTime: true, rating: 5 };
  // 91 天前完成的 5 单：不在窗口里
  const old = await seedOrders(m.a, m.ids.pa, 5, { at: new Date(api.clock.now().getTime() - 91 * DAY) });
  await perform(m.a, old, { ...perfect, at: new Date(api.clock.now().getTime() - 91 * DAY) });
  const recent = await seedOrders(m.a, m.ids.pa, 19);
  await perform(m.a, recent, perfect);
  await nextDay();
  let tenant = await tenantOf(m.a);
  assert.deepEqual([tenant.score.score_centi, tenant.score.raw_score_centi, tenant.score.completed_orders], [450, 500, 19], "19 单：默认 4.50");
  // 第 20 单是一单晚派车、评价 3 分的
  const twentieth = await seedOrders(m.a, m.ids.pa, 1);
  await perform(m.a, twentieth, { dispatchOnTime: false, arrivalOnTime: true, rating: 3 });
  await nextDay();
  tenant = await tenantOf(m.a);
  // 派车 19/20 = 95%（4.75）、到达 100%（5）、评价 (19×5+3)/20 = 4.9、投诉 0（5）、失败 0（5）：0.25×4.75 + 0.25×5 + 0.2×4.9 + 0.2×5 + 0.1×5 = 4.9175 → 4.92
  assert.deepEqual([tenant.score.score_centi, tenant.score.raw_score_centi, tenant.score.completed_orders], [492, 492, 20]);

  for (const [path, token] of [["/tenant/v1/performance", await own(m.a)], [`/platform/v1/tenants/${m.a.tenantId}/performance`, await root()]] as const) {
    const res = await api.call("GET", path, { token });
    assertMatchesOpenApi("GET", path.startsWith("/tenant") ? "/tenant/v1/performance" : "/platform/v1/tenants/{id}/performance", res);
    assert.deepEqual(res.body.trend.map((day: any) => [day.score_centi, day.is_default, day.completed_orders]), [[450, true, 19], [492, false, 20]]);
    assert.deepEqual(res.body.latest.components.dispatch, { value: 9_500, points_centi: 475, weight_bp: 2_500 });
    assert.deepEqual(res.body.latest.components.rating, { value: 490, points_centi: 490, weight_bp: 2_000 });
    assert.equal(res.body.latest.inputs.dispatch_total, 20);
    assert.doesNotMatch(res.text, /markup|sell|对外价|加价/i);
  }
  // 供应商的其他角色也能看评分（调度要看按时派车率）
  const rows = await api.db.owner.query<{ score_date: string }>("select score_date::text from tenant_score_daily where tenant_id = $1 order by score_date", [m.a.tenantId]);
  assert.equal(rows.rows.length, 2, "每天一行");
});

test("每日检查：同一天跑几轮只做一次；已经做过今天的不再做", async () => {
  const first = await api.app.tenantJobs.tick();
  assert.equal(first.evaluated, 0, "今天已经做过了");
  api.clock.advance(DAY);
  const again = await api.app.tenantJobs.tick();
  assert.ok(again.evaluated >= 2);
  assert.deepEqual(await api.app.tenantJobs.tick(), { evaluated: 0, skipped: 0 });
});

test("报价引擎接上评分和单量：评分高的中标（价差 3% 内）；观察期排序价 ×1.05 把它挤出同价区间，中标换人", async () => {
  await clearScoreInputs();
  // 都还没有评分：乙便宜（对外价 21,780 < 22,000），乙中标
  await nextDay();
  assert.equal(biz(await preview()).winner.tenant_id, m.b.tenantId);
  // 甲 20 单，有 2 单投诉成立：投诉 10%（4.5 分）→ 0.25×5 + 0.25×5 + 0.2×5 + 0.2×4.5 + 0.1×5 = 4.90
  const aOrders = await seedOrders(m.a, m.ids.pa, 20);
  await perform(m.a, aOrders, { dispatchOnTime: true, arrivalOnTime: true, rating: 5 });
  await perform(m.a, aOrders.slice(0, 2), { complaint: "minor" });
  // 乙 22 单，全部满分：5.00
  const bOrders = await seedOrders(m.b, m.ids.pb, 22);
  await perform(m.b, bOrders, { dispatchOnTime: true, arrivalOnTime: true, rating: 5 });
  await nextDay();
  let group = biz(await preview());
  assert.deepEqual(group.candidates.map((entry: any) => [entry.tenant_id, entry.score_centi, entry.completed_orders, entry.observation, entry.in_band]), [[m.b.tenantId, 500, 22, false, true], [m.a.tenantId, 490, 20, false, true]]);
  // 乙评分降到 5.00 以下但仍高于甲，同时近 30 天司机未到 2 次 → 观察期：排序价 21,780 × 1.05 = 22,869 > 22,000 × 1.03 = 22,660，出了同价区间，甲中标
  const extra = await seedOrders(m.b, m.ids.pb, 2, { status: "confirmed" });
  await perform(m.b, extra, { failure: "driver_no_show" });
  await nextDay();
  const observed = await tenantOf(m.b);
  assert.deepEqual([observed.status, observed.observation_reasons, observed.score.no_shows], ["active", ["driver_no_show"], 2]);
  group = biz(await preview());
  assert.equal(group.winner.tenant_id, m.a.tenantId);
  assert.deepEqual(group.candidates.map((entry: any) => [entry.tenant_id, entry.observation, entry.rank_price, entry.in_band]), [[m.a.tenantId, false, "22000", true], [m.b.tenantId, true, "22869", false]]);
  // 客人付的仍是中标者自己的对外价
  assert.equal(group.winner.sell, 22_000);
  // 供应商收到「进入观察期」的提醒
  const notices = await api.call("GET", "/tenant/v1/company/notices", { token: await own(m.b) });
  assertMatchesOpenApi("GET", "/tenant/v1/company/notices", notices);
  assert.ok(notices.body.items.some((notice: any) => notice.kind === "observation_started"));
});

test("评分低于 4.00 进入观察期，低于 3.50 自动暂停（不参与比价）；运营人工恢复后分数没回升也不会第二天又被暂停；回升到 3.50 以上再跌破才再暂停", async () => {
  await clearScoreInputs();
  await nextDay();
  // 甲 20 单：派车全部晚了、到达全部晚了、评价 3 分 → 0 + 0 + 0.2×3 + 0.2×5 + 0.1×5 = 2.10
  const orders = await seedOrders(m.a, m.ids.pa, 20);
  await perform(m.a, orders, { dispatchOnTime: false, arrivalOnTime: false, rating: 3 });
  await nextDay();
  let tenant = await tenantOf(m.a);
  assert.deepEqual([tenant.status, tenant.suspended_from, tenant.suspension_reasons, tenant.observation_reasons, tenant.score.score_centi], ["suspended", "active", ["score_below_red_line"], ["score_below_threshold"], 210]);
  const refused = await preview();
  assert.deepEqual(refused.refused.filter((entry: any) => entry.tenant_id === m.a.tenantId).map((entry: any) => entry.reason), ["TENANT_SUSPENDED"]);
  // 状态记录：系统暂停，原因写在说明里；供应商看得到原因代码，看不到平台的说明
  const events = await api.call("GET", `/platform/v1/tenants/${m.a.tenantId}/status-events`, { token: await root() });
  assertMatchesOpenApi("GET", "/platform/v1/tenants/{id}/status-events", events);
  const suspendEvent = events.body.items.find((event: any) => event.trigger === "suspend");
  assert.deepEqual([suspendEvent.actor.type, suspendEvent.suspension_after, suspendEvent.note], ["system", ["score_below_red_line"], "履约评分低于 3.5"]);
  const mine = await api.call("GET", "/tenant/v1/company/status-events", { token: await own(m.a) });
  assertMatchesOpenApi("GET", "/tenant/v1/company/status-events", mine);
  assert.deepEqual(Object.keys(mine.body.items.find((event: any) => event.trigger === "suspend")).includes("note"), false);

  // 运营人工恢复：回到正式，仍在观察期；第二天分数还是 2.10，不会马上又被暂停
  tenant = await resumeTenantNow(api, await root(), m.a.tenantId);
  assert.deepEqual([tenant.status, tenant.suspension_reasons], ["active", []]);
  await nextDay();
  tenant = await tenantOf(m.a);
  assert.deepEqual([tenant.status, tenant.observation_reasons], ["active", ["score_below_threshold"]]);
  // 回升：再完成 30 单满分 → (20 晚 + 30 准) 派车 60%（3 分）、到达 60%（3 分）、评价 (20×3+30×5)/50 = 4.2 → 0.75 + 0.75 + 0.84 + 1 + 0.5 = 3.84：高于 3.5、低于 4.0
  const better = await seedOrders(m.a, m.ids.pa, 30);
  await perform(m.a, better, { dispatchOnTime: true, arrivalOnTime: true, rating: 5 });
  await nextDay();
  tenant = await tenantOf(m.a);
  assert.deepEqual([tenant.status, tenant.score.score_centi, tenant.observation_reasons], ["active", 384, ["score_below_threshold"]]);
  // 再跌破：这 30 单里 20 单投诉成立 → 投诉 40%（3 分）→ 0.75 + 0.75 + 0.84 + 0.6 + 0.5 = 3.44
  await perform(m.a, better.slice(0, 20), { complaint: "minor" });
  await nextDay();
  tenant = await tenantOf(m.a);
  assert.deepEqual([tenant.status, tenant.suspension_reasons, tenant.score.score_centi], ["suspended", ["score_below_red_line"], 344]);
  await resumeTenantNow(api, await root(), m.a.tenantId);
});

test("司机未到：近 30 天 2 次进入观察期，3 次自动暂停待复核；人工恢复后不重复触发；过了 30 天自动退出观察期", async () => {
  await clearScoreInputs();
  await nextDay();
  const orders = await seedOrders(m.b, m.ids.pb, 3, { status: "confirmed" });
  await perform(m.b, orders.slice(0, 1), { failure: "driver_no_show" });
  await nextDay();
  assert.deepEqual((await tenantOf(m.b)).observation_reasons, []);
  await perform(m.b, orders.slice(1, 2), { failure: "driver_no_show" });
  await nextDay();
  assert.deepEqual((await tenantOf(m.b)).observation_reasons, ["driver_no_show"]);
  await perform(m.b, orders.slice(2, 3), { failure: "driver_no_show" });
  await nextDay();
  let tenant = await tenantOf(m.b);
  assert.deepEqual([tenant.status, tenant.suspension_reasons, tenant.score.no_shows], ["suspended", ["driver_no_show"], 3]);
  await resumeTenantNow(api, await root(), m.b.tenantId);
  await nextDay();
  tenant = await tenantOf(m.b);
  assert.deepEqual([tenant.status, tenant.observation_reasons], ["active", ["driver_no_show"]], "恢复后仍在观察期，不会马上再被暂停");
  // 三次分别在第 0、1、2 天；现在是第 4 天。第 30 天：窗口从第 1 天起，剩 2 次，还在观察期；第 32 天：窗口从第 3 天起，0 次，退出观察期
  await nextDay(26);
  assert.deepEqual((await tenantOf(m.b)).observation_reasons, ["driver_no_show"]);
  await nextDay(2);
  tenant = await tenantOf(m.b);
  assert.deepEqual([tenant.observation_reasons, tenant.observation_since], [[], null]);
  const notices = await api.call("GET", "/tenant/v1/company/notices?limit=200", { token: await own(m.b) });
  assert.ok(notices.body.items.some((notice: any) => notice.kind === "observation_ended"));
});

test("试运营转正式：满 30 天、试运营以来完成 ≥ 20 单、没有重大投诉；差一条都不转；试运营以前完成的单不算", async () => {
  await clearScoreInputs();
  const now = api.clock.now().getTime();
  // 试运营之前完成的 10 单不算
  await seedOrders(m.b, m.ids.pb, 10, { at: new Date(now - 40 * DAY) });
  await api.db.owner.query("update tenants set status = 'trial', trial_started_at = $2, activated_at = null where id = $1", [m.b.tenantId, new Date(now - 28 * DAY)]);
  await seedOrders(m.b, m.ids.pb, 19);
  await nextDay();
  assert.equal((await tenantOf(m.b)).status, "trial", "29 天、19 单");
  await seedOrders(m.b, m.ids.pb, 1);
  await nextDay();
  let tenant = await tenantOf(m.b);
  assert.deepEqual([tenant.status, tenant.activated_at], ["active", api.clock.now().toISOString()], "满 30 天、20 单：转正式");
  const events = (await api.call("GET", `/platform/v1/tenants/${m.b.tenantId}/status-events`, { token: await root() })).body.items;
  assert.deepEqual([events[0].trigger, events[0].from_status, events[0].to_status, events[0].actor.type], ["promote", "trial", "active", "system"]);
  // 有一单重大投诉成立：满足天数和单量也不转
  await clearScoreInputs();
  await api.db.owner.query("update tenants set status = 'trial', trial_started_at = $2, activated_at = null where id = $1", [m.b.tenantId, new Date(api.clock.now().getTime() - 60 * DAY)]);
  const orders = await seedOrders(m.b, m.ids.pb, 25);
  await perform(m.b, orders.slice(0, 1), { complaint: "major" });
  await nextDay();
  tenant = await tenantOf(m.b);
  assert.equal(tenant.status, "trial");
  await api.db.owner.query("update tenants set status = 'active' where id = $1", [m.b.tenantId]);
});

test("试运营的每日订单上限 10 单（准入过滤 + 下单）：当天第 11 单报不出价、拿着之前的报价也下不了单；第二天恢复；正式的不受限", async () => {
  await clearScoreInputs();
  await nextDay();
  const market = { ...m, staff: { ...m.staff, cm1: { ...m.staff.cm1, token: await login("platform", m.staff.cm1.email) } } };
  const channelId = (await newChannel(api, market.staff.cm1.token, { name: "官网（试运营上限）" })).id;
  const creds = await salesCredentials(api, market, channelId);
  const serviceTime = `${tenantDate(new Date(api.clock.now().getTime() + 5 * DAY))}T10:00:00+09:00`;
  const quote = async (): Promise<any> => {
    api.clock.advance(QUOTE_CATALOG_TTL_MS + 1);
    const res = await api.call("POST", "/sales/v1/quotes", { token: creds.token, body: { city_id: m.ids.tokyo, category: "airport_transfer", place_id: m.ids.narita, direction: "pickup", dropoff: DROPOFF, service_time: serviceTime, passengers: 2, luggage: 1, currency: "JPY", vehicle_group_ids: [m.ids.biz7] } });
    assert.equal(res.status, 200, res.text);
    return res.body.quotes[0];
  };
  const order = (quoteId: string): Promise<any> => {
    api.clock.advance(1_000);
    return api.call("POST", "/sales/v1/orders", {
      token: creds.token,
      headers: { "idempotency-key": randomUUID() },
      body: { quote_id: quoteId, passenger: { name: "王小明", phone: "+81 90-1234-5678", email: "guest@example.com" }, flight_no: "NH211", dropoff_address: "东京站", save_payment_method: true },
    });
  };
  await api.db.owner.query("update tenants set status = 'trial', trial_started_at = $2 where id = $1", [m.b.tenantId, api.clock.now()]);
  // 今天已经接了 9 单（取消的不算）
  await seedOrders(m.b, m.ids.pb, 9, { status: "confirmed" });
  const cancelled = await seedOrders(m.b, m.ids.pb, 2, { status: "confirmed" });
  await api.db.owner.query("update orders set status = 'cancelled', cancelled_at = created_at, cancel_reason = 'PAYMENT_TIMEOUT' where id = any($1::uuid[])", [cancelled]);
  const first = await quote();
  const second = await quote();
  const placed = await order(first.quote_id);
  assert.equal(placed.status, 201, placed.text);
  // 第 10 单下了：拿着之前的报价下第 11 单不行
  const over = await order(second.quote_id);
  assert.deepEqual([over.status, over.body.error.code, over.body.error.details.reason], [409, "QUOTE_NO_LONGER_AVAILABLE", "TRIAL_DAILY_LIMIT"]);
  // 再询价：乙不参加比价（原因 TRIAL_DAILY_LIMIT），甲中标
  const body = await preview();
  assert.deepEqual(body.refused.filter((entry: any) => entry.tenant_id === m.b.tenantId).map((entry: any) => entry.reason), ["TRIAL_DAILY_LIMIT"]);
  assert.equal(biz(body).winner.tenant_id, m.a.tenantId);
  // 东京时间的第二天：重新计数
  api.clock.advance(DAY);
  assert.equal(biz(await preview()).winner.tenant_id, m.b.tenantId);
  // 正式的供应商不受这个上限
  await api.db.owner.query("update tenants set status = 'active' where id = $1", [m.b.tenantId]);
  await seedOrders(m.b, m.ids.pb, 15, { status: "confirmed" });
  assert.equal(biz(await preview()).winner.tenant_id, m.b.tenantId);
});
