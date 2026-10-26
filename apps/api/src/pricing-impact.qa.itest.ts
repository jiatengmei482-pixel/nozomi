/**
 * M3-07 测试角色补充：毛利试算接口的口径边界、只读、权限、渠道隔离（ADR 0033），经真实接口、真实 PostgreSQL。
 *
 * - 窗口：询价时间、下单时间正好 30 天前算、早 1 毫秒不算；两者各按各的（订单按下单时间，不看它的报价什么时候问的）。
 * - 没付款的单（待支付、付款前取消）不算；付过款后取消、没有扣款比例的按免费取消计数；已完成、未出现（no-show）的全额计入。
 * - 渠道结算美元、客人付日元：毛利按快照里的渠道汇率换成美分，每单四舍五入。
 * - 只读：整个 schema 里每张表试算前后的内容都不变；试算前拿到的报价照样能下单、价钱不变。
 * - 权限：租户令牌、没有 channel.manage 的平台角色被拒；复核的「再算一次」按这一类的审核 / 发起权限。
 * - 渠道隔离：渠道 A 的试算不受渠道 B 的数据影响，也不能拿渠道 B 的规则来试算。
 * - 分批：同一时刻的几千个报价跨过每批 5,000 的边界，不漏不重。截断（超过 100,000 个只算最近的、标出）造数据太慢，设 PRICING_IMPACT_QA_TRUNCATION=1 时才跑。
 * 测试数据在测试里造，结束随 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { CurrencyCode, FxQuote } from "@nozomi/domain";
import { type ApiResponse, type HttpMethod, type TestApi, createTestApi } from "./testing/api.ts";
import { DROPOFF, type Market, SERVICE_TIME, type Staff, addStaff, approvedBy, buildMarket, ok } from "./testing/market.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";

const RATES: Record<string, string> = { "JPY>USD": "0.0066", "USD>JPY": "151.5" };
const fxQuote = async (from: CurrencyCode, to: CurrencyCode, at: Date): Promise<FxQuote | null> => {
  const rate = RATES[`${from}>${to}`];
  return rate === undefined ? null : { from, to, rate, asOf: at.toISOString() };
};

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let flowA: SalesFlow;
let flowB: SalesFlow;
let extra: Record<"finance" | "service" | "risk" | "tech" | "onboarding", Staff>;

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay, quote: { fx: { quote: fxQuote } } });
  m = await buildMarket(api);
  flowA = await salesFlow(api, m, pay);
  flowB = await salesFlow(api, m, pay);
  extra = {
    finance: await addStaff(api, m.root, "fin@platform.test", "finance"),
    service: await addStaff(api, m.root, "cs@platform.test", "customer_service"),
    risk: await addStaff(api, m.root, "risk@platform.test", "risk"),
    tech: await addStaff(api, m.root, "tech@platform.test", "tech"),
    onboarding: await addStaff(api, m.root, "bd@platform.test", "tenant_onboarding"),
  };
});
after(() => api.close());

async function checked(method: HttpMethod, url: string, template: string, options: { token?: string; body?: unknown; headers?: Record<string, string> }): Promise<ApiResponse> {
  const res = await api.call(method, url, options);
  assertMatchesOpenApi(method, template, res);
  return res;
}

const CHANNEL_TEMPLATE = "/platform/v1/channels/{id}/pricing-impact";
const APPROVAL_TEMPLATE = "/platform/v1/approvals/{id}/pricing-impact";
const DEFAULT_12 = { kind: "channel.pricing", change: { default_markup_bp: 1_200 } };

async function impactOf(channelId: string, body: unknown = DEFAULT_12, token = m.staff.cm1.token): Promise<any> {
  const res = await checked("POST", `/platform/v1/channels/${channelId}/pricing-impact`, CHANNEL_TEMPLATE, { token, body });
  assert.equal(res.status, 200, res.text);
  return res.body.impact;
}

/** 整个测试 schema 里每张表的行数和内容摘要 */
async function schemaFingerprint(): Promise<string> {
  const tables = (await api.db.owner.query<{ name: string }>("select tablename as name from pg_tables where schemaname = current_schema() order by tablename")).rows.map((row) => row.name);
  assert.ok(tables.length > 20, `表太少，schema 不对：${tables.length}`);
  const parts: string[] = [];
  for (const table of tables) {
    const row = (await api.db.owner.query(`select count(*)::text as n, coalesce(md5(string_agg(t::text, '|' order by t::text)), '') as h from "${table}" t`)).rows[0];
    parts.push(`${table}:${row.n}:${row.h}`);
  }
  return parts.join(",");
}

async function quoteIdOf(orderId: string): Promise<string> {
  return (await api.db.owner.query("select quote_id from order_sales where order_id = $1", [orderId])).rows[0].quote_id;
}

/** 把报价的询价时间设到 `at`（有效期跟着挪，保持 30 分钟） */
async function setQuoteTime(quoteId: string, at: Date): Promise<void> {
  await api.db.owner.query("update quotes set created_at = $2, expires_at = $2::timestamptz + interval '30 minutes' where id = $1", [quoteId, at]);
}

async function setOrderTime(orderId: string, at: Date): Promise<void> {
  await api.db.owner.query("update order_sales set created_at = $2 where order_id = $1", [orderId, at]);
}

const DAY = 86_400_000;

test("窗口边界：询价、下单正好 30 天前的算，早 1 毫秒的不算；订单按下单时间、报价按询价时间各算各的", async () => {
  const o1 = await flowA.paidOrder();
  const o2 = await flowA.paidOrder();
  const now = api.clock.now();
  const base = await impactOf(flowA.channelId);
  assert.deepEqual([base.quotes.total, base.orders.total], [2, 2]);
  assert.equal(base.to, now.toISOString());
  assert.equal(base.from, new Date(now.getTime() - 30 * DAY).toISOString());

  // 正好 30 天前：报价和订单都还算
  await setQuoteTime(await quoteIdOf(o1.id), new Date(now.getTime() - 30 * DAY));
  await setOrderTime(o1.id, new Date(now.getTime() - 30 * DAY));
  const edge = await impactOf(flowA.channelId);
  assert.deepEqual([edge.quotes.total, edge.quotes.count, edge.orders.total, edge.orders.count], [2, 2, 2, 2]);
  assert.deepEqual(edge.quotes.diff, base.quotes.diff);

  // 早 1 毫秒：报价不算了；订单还在窗口里时照算（订单按下单时间）
  await setQuoteTime(await quoteIdOf(o1.id), new Date(now.getTime() - 30 * DAY - 1));
  const quoteOut = await impactOf(flowA.channelId);
  assert.deepEqual([quoteOut.quotes.total, quoteOut.orders.total, quoteOut.orders.count], [1, 2, 2]);
  assert.deepEqual(quoteOut.orders.diff, base.orders.diff);

  // 订单也早 1 毫秒：不算了
  await setOrderTime(o1.id, new Date(now.getTime() - 30 * DAY - 1));
  const orderOut = await impactOf(flowA.channelId);
  assert.deepEqual([orderOut.orders.total, orderOut.orders.count], [1, 1]);
  assert.equal(orderOut.orders.diff.margin_minor * 2, base.orders.diff.margin_minor);

  // 下单正好是试算的这一刻（窗口的另一端，含）：算
  await setOrderTime(o2.id, now);
  assert.equal((await impactOf(flowA.channelId)).orders.total, 1);
  // 收尾：两张单挪出窗口，后面的测试从空开始
  await setQuoteTime(await quoteIdOf(o2.id), new Date(now.getTime() - 40 * DAY));
  await setOrderTime(o2.id, new Date(now.getTime() - 40 * DAY));
  const empty = await impactOf(flowA.channelId);
  assert.deepEqual([empty.quotes.total, empty.orders.total], [0, 0]);
});

test("没付款的单不算（待支付、付款前就取消的）；付过款后取消却没有扣款比例的按免费取消；已完成、未出现的全额计入", async () => {
  const unpaid = await flowA.unpaidOrder();
  const timedOut = await flowA.unpaidOrder();
  await api.db.owner.query("update orders set status = 'cancelled', cancelled_at = $2, cancel_reason = 'PAYMENT_TIMEOUT' where id = $1", [timedOut.id, api.clock.now()]);
  const onlyUnpaid = await impactOf(flowA.channelId);
  assert.deepEqual([onlyUnpaid.orders.total, onlyUnpaid.orders.count, onlyUnpaid.orders.cancelled_free], [0, 0, 0], "没付款的单不能出现在订单里");
  assert.equal(onlyUnpaid.quotes.total, 2, "它们的报价照样算在询价里");

  const done = await flowA.paidOrder();
  const noShow = await flowA.paidOrder();
  const legacyCancel = await flowA.paidOrder();
  await api.db.owner.query("update orders set status = 'completed' where id = $1", [done.id]);
  await api.db.owner.query("update orders set status = 'no_show' where id = $1", [noShow.id]);
  await api.db.owner.query("update orders set status = 'cancelled', cancelled_at = $2, cancel_reason = 'GUEST_REQUEST' where id = $1", [legacyCancel.id, api.clock.now()]);
  const impact = await impactOf(flowA.channelId);
  // 商务 7 座乙 19,800：10% → 21,780，12% → 22,176
  assert.deepEqual(
    [impact.orders.total, impact.orders.count, impact.orders.cancelled_free, impact.orders.cancelled_with_fee],
    [3, 2, 1, 0],
  );
  assert.deepEqual(impact.orders.before, { sell_minor: 2 * 21_780, settlement_minor: 2 * 19_800, margin_minor: 2 * 1_980 });
  assert.deepEqual(impact.orders.diff, { sell_minor: 2 * 396, settlement_minor: 0, margin_minor: 2 * 396 });

  for (const order of [unpaid, timedOut, done, noShow, legacyCancel]) {
    await setQuoteTime(await quoteIdOf(order.id), new Date(api.clock.now().getTime() - 40 * DAY));
    await setOrderTime(order.id, new Date(api.clock.now().getTime() - 40 * DAY));
  }
});

test("渠道结算美元、客人付日元：快照记下渠道汇率（没设最低毛利也记）；对外价、结算价换成美分每单四舍五入，合计里对外价 − 结算价 = 毛利", async () => {
  await api.db.owner.query("update channels set settle_currency = 'USD' where id = $1", [flowB.channelId]);
  const order = await flowB.paidOrder();
  const snapshot = (await api.db.owner.query("select snapshot from quotes where id = $1", [await quoteIdOf(order.id)])).rows[0].snapshot;
  assert.equal(snapshot.channel.minMarginMinor, 0);
  assert.deepEqual(snapshot.channel.settleFx, { from: "USD", to: "JPY", rate: "151.5", asOf: snapshot.channel.settleFx.asOf });
  const impact = await impactOf(flowB.channelId);
  assert.equal(impact.settle_currency, "USD");
  // 乙 19,800 日元：10% 21,780 ÷ 151.5 = 143.762… → 14,376 美分；12% 22,176 ÷ 151.5 = 146.376… → 14,638；结算价 130.693… → 13,069
  assert.deepEqual(impact.orders.before, { sell_minor: 14_376, settlement_minor: 13_069, margin_minor: 1_307 });
  assert.deepEqual(impact.orders.after, { sell_minor: 14_638, settlement_minor: 13_069, margin_minor: 1_569 });
  assert.deepEqual(impact.orders.diff, { sell_minor: 262, settlement_minor: 0, margin_minor: 262 });
  // 最低毛利 US$15.00 = 1,500 美分 → 2,272.5 日元：乙 19,800 + 2,272.5 = 22,072.5 → 22,073 → 145.696… → 14,570
  const margin = await impactOf(flowB.channelId, { kind: "channel.pricing", change: { min_margin: 1_500 } });
  assert.deepEqual([margin.orders.min_margin_raised_after, margin.orders.after], [1, { sell_minor: 14_570, settlement_minor: 13_069, margin_minor: 1_501 }]);
});

test("渠道隔离：渠道 A 的试算不受渠道 B 的数据影响；拿渠道 B 的规则编号在渠道 A 上试算修改 / 删除是 404", async () => {
  const a1 = await flowA.paidOrder();
  const aImpact = await impactOf(flowA.channelId, { kind: "markup_rule.create", rule: { tenant_id: m.b.tenantId, markup_bp: 1_500 } });
  await flowB.paidOrder();
  await flowB.paidOrder({ vehicleGroupId: m.ids.eco4 });
  const aAgain = await impactOf(flowA.channelId, { kind: "markup_rule.create", rule: { tenant_id: m.b.tenantId, markup_bp: 1_500 } });
  const strip = (value: any): any => ({ ...value, computed_at: undefined, from: undefined, to: undefined });
  assert.deepEqual(strip(aAgain), strip(aImpact));
  assert.deepEqual([aAgain.quotes.total, aAgain.orders.total], [1, 1]);

  await approvedBy(api, m, api.call("POST", `/platform/v1/channels/${flowB.channelId}/markup-rules`, { token: m.staff.cm1.token, body: { tenant_id: m.b.tenantId, markup_bp: 1_300 } }));
  const ruleB = (await ok(api.call("GET", `/platform/v1/channels/${flowB.channelId}/markup-rules`, { token: m.staff.cm1.token }))).items[0];
  for (const body of [
    { kind: "markup_rule.delete", rule_id: ruleB.id },
    { kind: "markup_rule.update", rule_id: ruleB.id, rule: { tenant_id: m.b.tenantId, markup_bp: 1_400 } },
  ]) {
    const res = await checked("POST", `/platform/v1/channels/${flowA.channelId}/pricing-impact`, CHANNEL_TEMPLATE, { token: m.staff.cm1.token, body });
    assert.equal(res.status, 404, `${body.kind}：${res.text}`);
  }
  // 渠道 B 的规则不影响渠道 A 的「改前」：A 的乙仍按默认 10%
  const aWithBRule = await impactOf(flowA.channelId);
  assert.equal(aWithBRule.orders.before.sell_minor, 21_780);

  // 渠道 B 上删除这条规则的复核：再算一次只用渠道 B 的数据
  const removal = await ok(api.call("DELETE", `/platform/v1/channels/${flowB.channelId}/markup-rules/${ruleB.id}`, { token: m.staff.cm1.token, headers: { "if-match": `"${ruleB.version}"` }, body: {} }), 202);
  const again = await checked("POST", `/platform/v1/approvals/${removal.approval.id}/pricing-impact`, APPROVAL_TEMPLATE, { token: m.staff.cm2.token });
  assert.equal(again.status, 200, again.text);
  assert.equal(again.body.impact.settle_currency, "USD");
  assert.equal(again.body.impact.orders.total, 3);
  await ok(api.call("POST", `/platform/v1/approvals/${removal.approval.id}/withdraw`, { token: m.staff.cm1.token, body: {} }));
  await setQuoteTime(await quoteIdOf(a1.id), new Date(api.clock.now().getTime() - 40 * DAY));
  await setOrderTime(a1.id, new Date(api.clock.now().getTime() - 40 * DAY));
});

test("权限：租户令牌、没有 channel.manage 的平台角色不能试算；复核的「再算一次」只有能审核或发起这一类的能用", async () => {
  const body = DEFAULT_12;
  const url = `/platform/v1/channels/${flowA.channelId}/pricing-impact`;
  const tenant = await api.call("POST", url, { token: m.a.adminToken, body });
  assert.equal(tenant.status, 401, `租户令牌：${tenant.text}`);
  for (const [name, who] of Object.entries(extra)) {
    const denied = await checked("POST", url, CHANNEL_TEMPLATE, { token: who.token, body });
    assert.deepEqual([denied.status, denied.body.error.details.required], [403, "channel.manage"], name);
  }
  const requested = await ok(api.call("POST", `/platform/v1/channels/${flowA.channelId}/pricing-changes`, { token: m.staff.cm1.token, body: { default_markup_bp: 1_300 } }), 202);
  const approvalUrl = `/platform/v1/approvals/${requested.approval.id}/pricing-impact`;
  assert.equal((await api.call("POST", approvalUrl, { token: m.a.adminToken })).status, 401);
  assert.equal((await api.call("POST", approvalUrl, {})).status, 401);
  for (const [name, who] of Object.entries(extra)) {
    const denied = await checked("POST", approvalUrl, APPROVAL_TEMPLATE, { token: who.token });
    assert.equal(denied.status, 403, `${name}：${denied.text}`);
  }
  assert.equal((await checked("POST", approvalUrl, APPROVAL_TEMPLATE, { token: m.root })).status, 200, "超级管理员");
  // 已撤回的不能再算
  await ok(api.call("POST", `/platform/v1/approvals/${requested.approval.id}/withdraw`, { token: m.staff.cm1.token, body: {} }));
  const withdrawn = await checked("POST", approvalUrl, APPROVAL_TEMPLATE, { token: m.staff.cm2.token });
  assert.deepEqual([withdrawn.status, withdrawn.body.error.code], [409, "APPROVAL_NOT_PENDING"]);
});

test("只读：试算和「再算一次」前后整个 schema 每张表都不变；试算前拿到的报价照样能下单、价钱不变；存下的试算不被覆盖", async () => {
  const quoted = await ok(
    api.call("POST", "/sales/v1/quotes", {
      token: await flowA.token(),
      body: { city_id: m.ids.tokyo, category: "airport_transfer", place_id: m.ids.narita, direction: "pickup", dropoff: DROPOFF, service_time: SERVICE_TIME, passengers: 2, luggage: 1, currency: "JPY", vehicle_group_ids: [m.ids.biz7] },
    }),
  );
  const quote = quoted.quotes[0];
  const requested = await ok(api.call("POST", `/platform/v1/channels/${flowA.channelId}/markup-rules`, { token: m.staff.cm1.token, body: { tenant_id: m.b.tenantId, markup_bp: 1_500 } }), 202);
  const stored = requested.approval.impact;
  assert.ok(stored.quotes.total >= 1);

  const fingerprint = await schemaFingerprint();
  for (const body of [DEFAULT_12, { kind: "markup_rule.create", rule: { tenant_id: m.a.tenantId, markup_bp: 2_000 } }]) await impactOf(flowA.channelId, body);
  const again = await checked("POST", `/platform/v1/approvals/${requested.approval.id}/pricing-impact`, APPROVAL_TEMPLATE, { token: m.staff.cm2.token });
  assert.equal(again.status, 200, again.text);
  assert.equal(await schemaFingerprint(), fingerprint, "试算不能写任何表");

  api.clock.advance(1_000);
  const order = await ok(
    api.call("POST", "/sales/v1/orders", {
      token: await flowA.token(),
      headers: { "idempotency-key": randomUUID() },
      body: { quote_id: quote.quote_id, passenger: { name: "王小明", phone: "+81 90-1234-5678", email: "guest@example.com" }, flight_no: "NH 211", dropoff_address: "东京站八重洲口", save_payment_method: true },
    }),
    201,
  );
  const sale = (await api.db.owner.query("select sell_minor, quote_id from order_sales where order_id = $1", [order.order.id])).rows[0];
  assert.deepEqual([Number(sale.sell_minor), sale.quote_id], [21_780, quote.quote_id]);

  // 多了一个待支付的单（不算订单）后再算：存下的那一份仍是发起时的
  const later = await checked("POST", `/platform/v1/approvals/${requested.approval.id}/pricing-impact`, APPROVAL_TEMPLATE, { token: m.staff.cm2.token });
  assert.deepEqual([later.body.impact.quotes.total, later.body.impact.orders.total], [stored.quotes.total, stored.orders.total], "待支付的单不算订单；报价是同一个");
  const detail = await ok(api.call("GET", `/platform/v1/approvals/${requested.approval.id}`, { token: m.staff.cm2.token }));
  assert.deepEqual(detail.approval.impact, stored);
  await ok(api.call("POST", `/platform/v1/approvals/${requested.approval.id}/withdraw`, { token: m.staff.cm1.token, body: {} }));
  await setQuoteTime(quote.quote_id, new Date(api.clock.now().getTime() - 40 * DAY));
  await setOrderTime(order.order.id, new Date(api.clock.now().getTime() - 40 * DAY));
});

/**
 * 复制一个报价 `count` 份（编号 QT20260906 + 序号）：前 `tie` 份的询价时间都是 `at`，其余从 `at` 起每份早 1 毫秒。
 * 每条语句有 10 秒的超时：每 20,000 份一批插。
 */
async function copyQuotes(sourceId: string, count: number, at: Date, tie: number): Promise<void> {
  for (let start = 1; start <= count; start += 20_000) {
    await api.db.owner.query(
      `insert into quotes (id, channel_id, quote_log_id, vehicle_group_id, package_hours, winner_tenant_id, product_id, product_version, currency, sell_minor, settlement_minor, settlement_currency, markup_bp, markup_rule_id, markup_level, snapshot, created_at, expires_at)
       select 'QT20260906' || lpad(g::text, 10, '0'), channel_id, quote_log_id, vehicle_group_id, package_hours, winner_tenant_id, product_id, product_version, currency, sell_minor, settlement_minor, settlement_currency, markup_bp, markup_rule_id, markup_level, snapshot,
              $2::timestamptz - make_interval(secs => greatest(g - $5::integer, 0) / 1000.0), $2::timestamptz - make_interval(secs => greatest(g - $5::integer, 0) / 1000.0) + interval '30 minutes'
         from quotes, generate_series($3::integer, $4::integer) g where id = $1`,
      [sourceId, at, start, Math.min(start + 19_999, count), tie],
    );
  }
}

async function dropCopies(count: number): Promise<void> {
  for (let start = 1; start <= count; start += 20_000) {
    await api.db.owner.query("delete from quotes where id >= $1 and id <= $2", [`QT20260906${String(start).padStart(10, "0")}`, `QT20260906${String(Math.min(start + 19_999, count)).padStart(10, "0")}`]);
  }
}

/** 下一张付过款的单，复制它的报价 `count` 份，再把原来那个写坏、挪到 2 天前（被读到就会算进「没法重算」）；返回复制之前的试算 */
async function copiesOfPaidQuote(count: number, tie: number): Promise<{ sourceId: string; now: Date; baseline: any }> {
  const order = await flowA.paidOrder();
  const sourceId = await quoteIdOf(order.id);
  api.clock.advance(1_000);
  const now = api.clock.now();
  const baseline = await impactOf(flowA.channelId);
  await copyQuotes(sourceId, count, now, tie);
  await setQuoteTime(sourceId, new Date(now.getTime() - 2 * DAY));
  await api.db.owner.query(`update quotes set snapshot = jsonb_set(snapshot, '{candidates}', '"broken"') where id = $1`, [sourceId]);
  return { sourceId, now, baseline };
}

test("分批：同一时刻的 6,000 个报价跨过每批 5,000 的边界，按编号接着取，不漏不重；写坏的快照单独计数", async () => {
  const { sourceId, now, baseline } = await copiesOfPaidQuote(6_000, 6_000);
  try {
    const impact = await impactOf(flowA.channelId);
    assert.deepEqual(
      [impact.quotes.total, impact.quotes.truncated, impact.quotes.count, impact.quotes.skipped],
      [baseline.quotes.total + 6_000, false, baseline.quotes.count - 1 + 6_000, 1],
    );
    assert.equal(impact.quotes.diff.margin_minor, baseline.quotes.diff.margin_minor + 5_999 * 396);
    assert.deepEqual([impact.orders.total, impact.orders.count, impact.orders.skipped], [baseline.orders.total, baseline.orders.count - 1, 1]);
  } finally {
    await dropCopies(6_000);
    await setQuoteTime(sourceId, new Date(now.getTime() - 40 * DAY));
  }
});

// 造 10 万行要 15–30 秒、试算要 30–80 秒（开发机），平时不跑：PRICING_IMPACT_QA_TRUNCATION=1 时跑
test("截断：报价超过 100,000 个时只算最近的 100,000 个并标出；最早的那个不读", { skip: process.env["PRICING_IMPACT_QA_TRUNCATION"] !== "1" && "设 PRICING_IMPACT_QA_TRUNCATION=1 时跑" }, async () => {
  // 最近的 100,000 个是这些复制的（都比之前的报价晚或同一刻）；写坏的那个在 2 天前，是第 100,001 个
  const { sourceId, now, baseline } = await copiesOfPaidQuote(100_000, 6_000);
  try {
    const impact = await impactOf(flowA.channelId);
    assert.deepEqual(
      [impact.quotes.total, impact.quotes.truncated, impact.quotes.count, impact.quotes.skipped],
      [baseline.quotes.total + 100_000, true, 100_000, 0],
    );
    assert.deepEqual(impact.quotes.diff, { sell_minor: 100_000 * 396, settlement_minor: 0, margin_minor: 100_000 * 396 });
    // 订单没超：不标截断
    assert.deepEqual([impact.orders.total, impact.orders.truncated, impact.orders.skipped], [baseline.orders.total, false, 1]);
  } finally {
    await dropCopies(100_000);
    await setQuoteTime(sourceId, new Date(now.getTime() - 40 * DAY));
  }
});
