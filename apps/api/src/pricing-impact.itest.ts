/**
 * M3-07：加价规则 / 定价参数生效前的毛利试算（ADR 0033），经真实接口、真实 PostgreSQL。
 *
 * 数据都经真实的销售端接口造出来（询价 → 下单 → 付款通知），再用 SQL 把其中几张挪到 30 天以外、标成取消（取消的流程不是这里要测的）。
 * 市场（testing/market.ts）：商务 7 座 甲 20,000、乙 19,800；经济 4 座 只有甲 12,000。渠道默认加价 10%：商务 7 座乙 21,780 中标（甲 22,000），经济 4 座甲 13,200。
 * 每个应答都按 openapi.yaml 核对；测试结束随 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { CurrencyCode, FxQuote } from "@nozomi/domain";
import { type ApiResponse, type HttpMethod, type TestApi, createTestApi } from "./testing/api.ts";
import { DROPOFF, type Market, SERVICE_TIME, approvedBy, buildMarket, ok } from "./testing/market.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";

/** 汇率替身：1 JPY = rate USD。测试中途会改它，验证试算用的是快照里的汇率、不是现在的 */
let usdRate = "0.0066";
const fxQuote = async (from: CurrencyCode, to: CurrencyCode, at: Date): Promise<FxQuote | null> => (from === "JPY" && to === "USD" ? { from, to, rate: usdRate, asOf: at.toISOString() } : null);

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let flow: SalesFlow;

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay, quote: { fx: { quote: fxQuote } } });
  m = await buildMarket(api);
  flow = await salesFlow(api, m, pay);
});
after(() => api.close());

async function checked(method: HttpMethod, url: string, template: string, options: { token: string; body?: unknown; headers?: Record<string, string> }): Promise<ApiResponse> {
  const res = await api.call(method, url, options);
  assertMatchesOpenApi(method, template, res);
  return res;
}

const impactUrl = (channelId: string): string => `/platform/v1/channels/${channelId}/pricing-impact`;
const impactOf = async (channelId: string, body: unknown, token = m.staff.cm1.token): Promise<any> => {
  const res = await checked("POST", impactUrl(channelId), "/platform/v1/channels/{id}/pricing-impact", { token, body });
  assert.equal(res.status, 200, res.text);
  return res.body.impact;
};
const ruleB15 = (): Record<string, unknown> => ({ kind: "markup_rule.create", rule: { tenant_id: m.b.tenantId, markup_bp: 1_500 } });

/** 几张会变的表的指纹：试算前后必须一模一样（不写库） */
async function fingerprint(): Promise<string> {
  const tables = ["approvals", "audit_logs", "quotes", "quote_logs", "orders", "order_sales", "markup_rules", "channels"];
  const parts: string[] = [];
  for (const table of tables) {
    const row = (await api.db.owner.query(`select count(*)::text as n, coalesce(md5(string_agg(t::text, '|' order by t::text)), '') as h from ${table} t`)).rows[0];
    parts.push(`${table}:${row.n}:${row.h}`);
  }
  return parts.join(",");
}

/** 直接询价（不下单）：不给车型组时两个车型组各一个报价 */
async function quoteOnly(currency = "JPY", token?: string): Promise<any> {
  api.clock.advance(1_000);
  return ok(
    api.call("POST", "/sales/v1/quotes", {
      token: token ?? (await flow.token()),
      body: { city_id: m.ids.tokyo, category: "airport_transfer", place_id: m.ids.narita, direction: "pickup", dropoff: DROPOFF, service_time: SERVICE_TIME, passengers: 2, luggage: 1, currency, vehicle_group_ids: [] },
    }),
  );
}

/** 用 SQL 把一张付过款的单标成取消（扣款比例 `feeBp`）：取消流程在 M3-03 的测试里，这里只要结果 */
async function markCancelled(orderId: string, feeBp: number): Promise<void> {
  await api.db.owner.query(
    `update orders set status = 'cancelled', cancelled_at = $2, cancel_reason = 'GUEST_REQUEST', cancel_fee_bp = $3::integer, cancel_tenant_share_minor = round(settlement_minor * $3::integer / 10000.0) where id = $1`,
    [orderId, api.clock.now(), feeBp],
  );
}

/** 把一张单（连同它的报价）挪到 31 天前 */
async function moveOutOfWindow(orderId: string): Promise<void> {
  const shift = "31 days";
  await api.db.owner.query(`update order_sales set created_at = created_at - $2::interval where order_id = $1`, [orderId, shift]);
  await api.db.owner.query(`update quotes set created_at = created_at - $2::interval, expires_at = expires_at - $2::interval where id = (select quote_id from order_sales where order_id = $1)`, [orderId, shift]);
}

let orders: { full: any; eco: any; fee: any; free: any; old: any };

test("准备：经销售端询价、下单、付款，造出 30 天内外的报价和订单", async () => {
  orders = {
    full: await flow.paidOrder(),
    eco: await flow.paidOrder({ vehicleGroupId: m.ids.eco4 }),
    fee: await flow.paidOrder(),
    free: await flow.paidOrder(),
    old: await flow.paidOrder(),
  };
  await flow.unpaidOrder();
  const both = await quoteOnly();
  assert.equal(both.quotes.length, 2);
  await markCancelled(orders.fee.id, 5_000);
  await markCancelled(orders.free.id, 0);
  await moveOutOfWindow(orders.old.id);
  // 30 天以外的报价再造一条：复制一个报价、改到 40 天前
  await api.db.owner.query(
    `insert into quotes (id, channel_id, quote_log_id, vehicle_group_id, package_hours, winner_tenant_id, product_id, product_version, currency, sell_minor, settlement_minor, settlement_currency, markup_bp, markup_rule_id, markup_level, snapshot, created_at, expires_at)
     select 'QT20260901OLDQUOTE01', channel_id, quote_log_id, vehicle_group_id, package_hours, winner_tenant_id, product_id, product_version, currency, sell_minor, settlement_minor, settlement_currency, markup_bp, markup_rule_id, markup_level, snapshot, created_at - interval '40 days', expires_at - interval '40 days'
       from quotes where id = $1`,
    [both.quotes[0].quote_id],
  );
  // 快照里每个候选记下了汇率和缓冲（同币种为 null / 0）
  const snapshot = (await api.db.owner.query("select snapshot from quotes where id = $1", [both.quotes[0].quote_id])).rows[0].snapshot;
  assert.ok(snapshot.candidates.every((c: any) => c.fx === null && c.fxBufferBp === 0));
  assert.equal(snapshot.channel.settleFx, null);
});

test("给乙单设 15%：商务 7 座中标从乙换成甲；30 天内的报价和付过款的订单按改前 / 改后汇总，有偿取消按比例、免费取消只计数，30 天以外的不算；不写库", async () => {
  const fingerprintBefore = await fingerprint();
  const impact = await impactOf(flow.channelId, ruleB15());
  assert.equal(await fingerprint(), fingerprintBefore, "试算不能写库");
  assert.equal(impact.settle_currency, "JPY");
  assert.equal(impact.window_days, 30);
  // 报价：30 天内 7 个（5 张单各一个 + 一张待支付 + 一次询价两个车型组），挪出去的 1 个和 40 天前的 1 个不算
  // 商务 7 座 5 个：改前乙 21,780 / 19,800，改后甲 22,000 / 20,000；经济 4 座 2 个：13,200 / 12,000 不变
  assert.deepEqual(impact.quotes, {
    total: 7,
    truncated: false,
    count: 7,
    skipped: 0,
    before: { sell_minor: 5 * 21_780 + 2 * 13_200, settlement_minor: 5 * 19_800 + 2 * 12_000, margin_minor: 5 * 1_980 + 2 * 1_200 },
    after: { sell_minor: 5 * 22_000 + 2 * 13_200, settlement_minor: 5 * 20_000 + 2 * 12_000, margin_minor: 5 * 2_000 + 2 * 1_200 },
    diff: { sell_minor: 5 * 220, settlement_minor: 5 * 200, margin_minor: 5 * 20 },
    winner_changed: 5,
    min_margin_raised_before: 0,
    min_margin_raised_after: 0,
    became_unquotable: 0,
    became_quotable: 0,
  });
  // 订单：付过款的 4 张在 30 天里（待支付的不算）：全额 2 张、50% 取消 1 张、免费取消 1 张（只计数）
  assert.deepEqual(impact.orders, {
    total: 4,
    truncated: false,
    count: 3,
    skipped: 0,
    before: { sell_minor: 21_780 + 13_200 + 10_890, settlement_minor: 19_800 + 12_000 + 9_900, margin_minor: 1_980 + 1_200 + 990 },
    after: { sell_minor: 22_000 + 13_200 + 11_000, settlement_minor: 20_000 + 12_000 + 10_000, margin_minor: 2_000 + 1_200 + 1_000 },
    diff: { sell_minor: 220 + 110, settlement_minor: 200 + 100, margin_minor: 20 + 10 },
    winner_changed: 2,
    min_margin_raised_before: 0,
    min_margin_raised_after: 0,
    became_unquotable: 0,
    became_quotable: 0,
    cancelled_with_fee: 1,
    cancelled_free: 1,
  });
});

test("改定价参数：默认加价 12%、最低毛利 2,000 日元——改后要补到最低毛利的单数", async () => {
  const markup = await impactOf(flow.channelId, { kind: "channel.pricing", change: { default_markup_bp: 1_200 } });
  // 商务 7 座乙 19,800 × 1.12 = 22,176（+396），经济 4 座 12,000 × 1.12 = 13,440（+240）
  assert.deepEqual(markup.quotes.diff, { sell_minor: 5 * 396 + 2 * 240, settlement_minor: 0, margin_minor: 5 * 396 + 2 * 240 });
  assert.deepEqual(markup.orders.diff, { sell_minor: 396 + 240 + 198, settlement_minor: 0, margin_minor: 396 + 240 + 198 });
  assert.equal(markup.quotes.winner_changed, 0);
  const margin = await impactOf(flow.channelId, { kind: "channel.pricing", change: { min_margin: 2_000, request_note: "可以带，不用" } });
  // 乙的加价 1,980 < 2,000 → 21,800；甲 2,000 正好够；经济 4 座 1,200 → 14,000。7 个报价都要补
  assert.equal(margin.quotes.min_margin_raised_after, 7);
  assert.equal(margin.quotes.min_margin_raised_before, 0);
  assert.deepEqual(margin.quotes.diff, { sell_minor: 5 * 20 + 2 * 800, settlement_minor: 0, margin_minor: 5 * 20 + 2 * 800 });
});

test("修改、删除加价规则：试算按「改掉那一条 / 去掉那一条」重算；规则不存在 404", async () => {
  const approval = await approvedBy(api, m, api.call("POST", `/platform/v1/channels/${flow.channelId}/markup-rules`, { token: m.staff.cm1.token, body: { tenant_id: m.b.tenantId, markup_bp: 1_500 } }));
  const rule = (await ok(api.call("GET", `/platform/v1/channels/${flow.channelId}/markup-rules`, { token: m.staff.cm1.token }))).items[0];
  assert.equal(approval.status, "approved");
  // 现在乙是 15%（甲中标）；改回 10%：乙重新中标，毛利少 20 / 单
  const update = await impactOf(flow.channelId, { kind: "markup_rule.update", rule_id: rule.id, rule: { tenant_id: m.b.tenantId, markup_bp: 1_000 } });
  assert.deepEqual([update.quotes.winner_changed, update.quotes.diff.margin_minor], [5, -100]);
  const remove = await impactOf(flow.channelId, { kind: "markup_rule.delete", rule_id: rule.id });
  assert.deepEqual(remove.quotes.diff, update.quotes.diff);
  const missing = await checked("POST", impactUrl(flow.channelId), "/platform/v1/channels/{id}/pricing-impact", { token: m.staff.cm1.token, body: { kind: "markup_rule.delete", rule_id: randomUUID() } });
  assert.equal(missing.status, 404);
  // 把这条删掉，后面的测试从「没有规则」开始
  await approvedBy(api, m, api.call("DELETE", `/platform/v1/channels/${flow.channelId}/markup-rules/${rule.id}`, { token: m.staff.cm1.token, headers: { "if-match": `"${rule.version}"` }, body: {} }));
});

test("入参校验和发起一样：低于下限 400、和已有规则冲突 409、不认识的字段 400；渠道不存在 404", async () => {
  const below = await checked("POST", impactUrl(flow.channelId), "/platform/v1/channels/{id}/pricing-impact", { token: m.staff.cm1.token, body: { kind: "markup_rule.create", rule: { tenant_id: m.a.tenantId, markup_bp: 900 } } });
  assert.deepEqual([below.status, below.body.error.details.issues[0].reason], [400, "BELOW_FLOOR"]);
  const floor = await checked("POST", impactUrl(flow.channelId), "/platform/v1/channels/{id}/pricing-impact", { token: m.staff.cm1.token, body: { kind: "channel.pricing", change: { markup_floor_bp: 900 } } });
  assert.equal(floor.status, 400);
  await approvedBy(api, m, api.call("POST", `/platform/v1/channels/${flow.channelId}/markup-rules`, { token: m.staff.cm1.token, body: { tenant_id: m.a.tenantId, markup_bp: 1_100 } }));
  const conflict = await checked("POST", impactUrl(flow.channelId), "/platform/v1/channels/{id}/pricing-impact", { token: m.staff.cm1.token, body: { kind: "markup_rule.create", rule: { tenant_id: m.a.tenantId, markup_bp: 1_300 } } });
  assert.deepEqual([conflict.status, conflict.body.error.code], [409, "MARKUP_RULE_CONFLICT"]);
  const unknown = await api.call("POST", impactUrl(flow.channelId), { token: m.staff.cm1.token, body: { kind: "channel.pricing", change: {}, tenant_id: m.a.tenantId } });
  assert.equal(unknown.status, 400);
  const badKind = await api.call("POST", impactUrl(flow.channelId), { token: m.staff.cm1.token, body: { kind: "channel.pause" } });
  assert.equal(badKind.status, 400);
  const none = await checked("POST", impactUrl(randomUUID()), "/platform/v1/channels/{id}/pricing-impact", { token: m.staff.cm1.token, body: { kind: "channel.pricing", change: { default_markup_bp: 1_200 } } });
  assert.equal(none.status, 404);
  const rule = (await ok(api.call("GET", `/platform/v1/channels/${flow.channelId}/markup-rules`, { token: m.staff.cm1.token }))).items[0];
  await approvedBy(api, m, api.call("DELETE", `/platform/v1/channels/${flow.channelId}/markup-rules/${rule.id}`, { token: m.staff.cm1.token, headers: { "if-match": `"${rule.version}"` }, body: {} }));
});

test("权限和发起一样（channel.manage）：只读、运营、主数据运营都不能试算", async () => {
  for (const who of [m.staff.readonly, m.staff.operations, m.staff.masterData]) {
    const denied = await checked("POST", impactUrl(flow.channelId), "/platform/v1/channels/{id}/pricing-impact", { token: who.token, body: ruleB15() });
    assert.deepEqual([denied.status, denied.body.error.details.required], [403, "channel.manage"], who.email);
  }
  assert.equal((await api.call("POST", impactUrl(flow.channelId), { body: ruleB15() })).status, 401);
});

test("复核：发起时存下试算结果，审核人在详情里看到同样的数；数据变了以后「再算一次」用现在的数据，存的那一份不变；权限、类别、状态", async () => {
  const preview = await impactOf(flow.channelId, ruleB15());
  const requested = await checked("POST", `/platform/v1/channels/${flow.channelId}/markup-rules`, "/platform/v1/channels/{id}/markup-rules", { token: m.staff.cm1.token, body: { tenant_id: m.b.tenantId, markup_bp: 1_500 } });
  assert.equal(requested.status, 202, requested.text);
  const approvalId = requested.body.approval.id;
  assert.deepEqual(requested.body.approval.impact, preview);
  // 审核人（另一位渠道经理）在批准前看到同样的结果
  const seen = await checked("GET", `/platform/v1/approvals/${approvalId}`, "/platform/v1/approvals/{id}", { token: m.staff.cm2.token });
  assert.deepEqual(seen.body.approval.impact, preview);
  // 多一张付过款的单（商务 7 座）之后再算一次：订单多 1 张、报价多 1 个；存的那一份不变
  await flow.paidOrder();
  const fingerprintBefore = await fingerprint();
  const again = await checked("POST", `/platform/v1/approvals/${approvalId}/pricing-impact`, "/platform/v1/approvals/{id}/pricing-impact", { token: m.staff.cm2.token });
  assert.equal(again.status, 200, again.text);
  assert.equal(await fingerprint(), fingerprintBefore, "再算一次不能写库");
  assert.deepEqual([again.body.impact.quotes.count, again.body.impact.orders.count], [preview.quotes.count + 1, preview.orders.count + 1]);
  assert.equal(again.body.impact.orders.diff.margin_minor, preview.orders.diff.margin_minor + 20);
  const stored = await checked("GET", `/platform/v1/approvals/${approvalId}`, "/platform/v1/approvals/{id}", { token: m.staff.cm2.token });
  assert.deepEqual(stored.body.approval.impact, preview);
  // 发起人自己也能再算；只读能看到这条复核，但不能审核也不能发起：403；主数据运营看不到这一类：404
  assert.equal((await api.call("POST", `/platform/v1/approvals/${approvalId}/pricing-impact`, { token: m.staff.cm1.token })).status, 200);
  const readonly = await checked("POST", `/platform/v1/approvals/${approvalId}/pricing-impact`, "/platform/v1/approvals/{id}/pricing-impact", { token: m.staff.readonly.token });
  assert.deepEqual([readonly.status, readonly.body.error.code], [403, "FORBIDDEN"]);
  assert.equal((await checked("POST", `/platform/v1/approvals/${approvalId}/pricing-impact`, "/platform/v1/approvals/{id}/pricing-impact", { token: m.staff.masterData.token })).status, 404);
  assert.equal((await api.call("POST", `/platform/v1/approvals/${randomUUID()}/pricing-impact`, { token: m.staff.cm2.token })).status, 404);
  // 暂停渠道的复核没有试算
  const pause = await ok(api.call("POST", `/platform/v1/channels/${flow.channelId}/pause`, { token: m.staff.cm1.token, body: {} }), 202);
  assert.equal(pause.approval.impact, null);
  const notApplicable = await checked("POST", `/platform/v1/approvals/${pause.approval.id}/pricing-impact`, "/platform/v1/approvals/{id}/pricing-impact", { token: m.staff.cm2.token });
  assert.deepEqual([notApplicable.status, notApplicable.body.error.code], [409, "PRICING_IMPACT_NOT_APPLICABLE"]);
  await ok(api.call("POST", `/platform/v1/approvals/${pause.approval.id}/withdraw`, { token: m.staff.cm1.token, body: {} }));
  // 批准之后不能再算
  await ok(api.call("POST", `/platform/v1/approvals/${approvalId}/approve`, { token: m.staff.cm2.token, body: {} }));
  const decided = await checked("POST", `/platform/v1/approvals/${approvalId}/pricing-impact`, "/platform/v1/approvals/{id}/pricing-impact", { token: m.staff.cm2.token });
  assert.deepEqual([decided.status, decided.body.error.code], [409, "APPROVAL_NOT_PENDING"]);
  // 改定价参数、删除规则的复核同样存了试算
  const pricing = await ok(api.call("POST", `/platform/v1/channels/${flow.channelId}/pricing-changes`, { token: m.staff.cm1.token, body: { default_markup_bp: 1_200 } }), 202);
  assert.ok(pricing.approval.impact.quotes.count > 0);
  const rule = (await ok(api.call("GET", `/platform/v1/channels/${flow.channelId}/markup-rules`, { token: m.staff.cm1.token }))).items[0];
  const removal = await ok(api.call("DELETE", `/platform/v1/channels/${flow.channelId}/markup-rules/${rule.id}`, { token: m.staff.cm1.token, headers: { "if-match": `"${rule.version}"` }, body: {} }), 202);
  // 删掉乙 15%：乙重新中标，商务 7 座每单毛利少 20
  assert.equal(removal.approval.impact.quotes.winner_changed, removal.approval.impact.quotes.count - 2);
  for (const id of [pricing.approval.id, removal.approval.id]) await ok(api.call("POST", `/platform/v1/approvals/${id}/withdraw`, { token: m.staff.cm1.token, body: {} }));
});

test("复核的规则在审核前被删了：「再算一次」409 APPROVAL_STALE", async () => {
  const rule = (await ok(api.call("GET", `/platform/v1/channels/${flow.channelId}/markup-rules`, { token: m.staff.cm1.token }))).items[0];
  const update = await ok(api.call("PUT", `/platform/v1/channels/${flow.channelId}/markup-rules/${rule.id}`, { token: m.staff.cm1.token, headers: { "if-match": `"${rule.version}"` }, body: { tenant_id: m.b.tenantId, markup_bp: 1_600 } }), 202);
  await approvedBy(api, m, api.call("DELETE", `/platform/v1/channels/${flow.channelId}/markup-rules/${rule.id}`, { token: m.staff.cm1.token, headers: { "if-match": `"${rule.version}"` }, body: {} }));
  const stale = await checked("POST", `/platform/v1/approvals/${update.approval.id}/pricing-impact`, "/platform/v1/approvals/{id}/pricing-impact", { token: m.staff.cm2.token });
  assert.deepEqual([stale.status, stale.body.error.code], [409, "APPROVAL_STALE"]);
  await ok(api.call("POST", `/platform/v1/approvals/${update.approval.id}/withdraw`, { token: m.staff.cm1.token, body: {} }));
});

test("跨币种：客人付美元、渠道结算日元——按快照汇率换算，之后汇率变了不影响；快照缺汇率（M3-07 之前）的能补就补，补不上的不计入", async () => {
  const usd = await quoteOnly("USD");
  const biz = usd.quotes.find((q: any) => q.vehicle_group_id === m.ids.biz7);
  const snapshot = (await api.db.owner.query("select snapshot from quotes where id = $1", [biz.quote_id])).rows[0].snapshot;
  assert.deepEqual(snapshot.channel.settleFx, { from: "JPY", to: "USD", rate: "0.0066", asOf: api.clock.now().toISOString() });
  assert.ok(snapshot.candidates.every((c: any) => c.fx?.rate === "0.0066" && c.fxBufferBp === 150));
  // 汇率变了：试算仍按快照里的 0.0066
  usdRate = "0.01";
  const channel = flow.channelId;
  const all = await impactOf(channel, { kind: "channel.pricing", change: { default_markup_bp: 1_200 } });
  // 只看这两个美元报价：先算出不含它们的差额（把它们挪出窗口）再相减
  const usdIds = usd.quotes.map((q: any) => q.quote_id);
  await api.db.owner.query("update quotes set created_at = created_at - interval '60 days', expires_at = expires_at - interval '60 days' where id = any($1)", [usdIds]);
  const rest = await impactOf(channel, { kind: "channel.pricing", change: { default_markup_bp: 1_200 } });
  await api.db.owner.query("update quotes set created_at = created_at + interval '60 days', expires_at = expires_at + interval '60 days' where id = any($1)", [usdIds]);
  const minus = (a: any, b: any) => ({ sell_minor: a.sell_minor - b.sell_minor, settlement_minor: a.settlement_minor - b.settlement_minor, margin_minor: a.margin_minor - b.margin_minor });
  // 商务 7 座乙：19,800 × 0.0066 = 130.68 USD × 1.015 × 1.1 = 145.90… → 14,590 美分 → ÷ 0.0066 = 22,106 日元；改 12%：148.557… → 14,856 → 22,509
  // 经济 4 座甲：12,000 × 0.0066 = 79.2 × 1.015 × 1.1 = 88.4268 → 8,843 → 13,398；改 12%：90.03456 → 9,003 → 13,641
  assert.deepEqual(minus(all.quotes.before, rest.quotes.before), { sell_minor: 22_106 + 13_398, settlement_minor: 19_800 + 12_000, margin_minor: 2_306 + 1_398 });
  assert.deepEqual(minus(all.quotes.after, rest.quotes.after), { sell_minor: 22_509 + 13_641, settlement_minor: 19_800 + 12_000, margin_minor: 2_709 + 1_641 });

  // M3-07 之前的快照：候选没有汇率和缓冲、渠道没有 settleFx——用中标者的汇率和配置的缓冲补上，结果一样
  await api.db.owner.query(
    `update quotes set snapshot = jsonb_set(snapshot #- '{channel,settleFx}', '{candidates}', (select jsonb_agg(c - 'fx' - 'fxBufferBp') from jsonb_array_elements(snapshot->'candidates') c)) where id = any($1)`,
    [usdIds],
  );
  const legacy = await impactOf(channel, { kind: "channel.pricing", change: { default_markup_bp: 1_200 } });
  assert.deepEqual([legacy.quotes.before, legacy.quotes.after, legacy.quotes.skipped], [all.quotes.before, all.quotes.after, 0]);
  // 连中标者的汇率也没有：没法重算，不计入
  await api.db.owner.query(`update quotes set snapshot = snapshot #- '{winner,sell,fx}' where id = $1`, [biz.quote_id]);
  const skipped = await impactOf(channel, { kind: "channel.pricing", change: { default_markup_bp: 1_200 } });
  assert.deepEqual([skipped.quotes.skipped, skipped.quotes.count], [1, all.quotes.count - 1]);
  usdRate = "0.0066";
});

test("渠道之间互不影响：另一个渠道没有数据，试算全是 0", async () => {
  const other = (await ok(api.call("POST", "/platform/v1/channels", { token: m.staff.cm1.token, body: { name: "空渠道", type: "api", settle_currency: "JPY" } }), 201)).channel;
  const impact = await impactOf(other.id, ruleB15());
  assert.deepEqual([impact.quotes.total, impact.quotes.count, impact.orders.total, impact.orders.count, impact.quotes.before.sell_minor], [0, 0, 0, 0, 0]);
});
