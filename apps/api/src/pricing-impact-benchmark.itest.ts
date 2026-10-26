/**
 * M3-07：毛利试算在数据量大时的耗时（ADR 0033「性能」），真实 PostgreSQL。
 *
 * 先经销售端接口询价、下单、付款各一次，拿到真实的报价快照和订单；再用 SQL 照着它们复制出大量报价（分布在近 29 天、
 * 乙的结算价有 997 种）和付过款的订单，然后试算一次。
 * 平时（`pnpm check`、CI）用 10,000 个报价、1,000 张订单，只断言与机器负载无关的事（全部计入、数字对得上），量到的耗时记在诊断信息里——
 * 造 50,000 行数据本身就要一分钟左右，不放进每次的检查。按需求的量（50,000 个报价、5,000 张订单）并断言耗时（≤ 10 秒）时单独跑：
 * `PRICING_IMPACT_BENCH_ASSERT=1 node --env-file-if-exists=.env --test apps/api/src/pricing-impact-benchmark.itest.ts`
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { createPool } from "./db/pool.ts";
import { type TestApi, createTestApi } from "./testing/api.ts";
import { type Market, buildMarket, ok } from "./testing/market.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";

const ASSERT_TIMING = process.env["PRICING_IMPACT_BENCH_ASSERT"] === "1";
const QUOTES = ASSERT_TIMING ? 50_000 : 10_000;
const ORDERS = ASSERT_TIMING ? 5_000 : 1_000;

let api: TestApi;
let m: Market;
let flow: SalesFlow;

before(async () => {
  const pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  flow = await salesFlow(api, m, pay);
});
after(() => api.close());

test(`${QUOTES} 个报价、${ORDERS} 张订单的试算：全部计入，结果和逐个算的合计一致`, async (t) => {
  const order = await flow.paidOrder();
  const quoteId = (await api.db.owner.query("select quote_id from order_sales where order_id = $1", [order.id])).rows[0].quote_id as string;
  const seeded = performance.now();
  // 造数据的语句量大：用一个不限时的连接（服务进程的连接照旧有 10 秒的 statement_timeout，试算的每条语句都在它之内）
  const seeder = createPool(api.db.ownerUrl, { max: 1, queryTimeoutMs: 0, statementTimeoutMs: 0 });
  try {
    // 报价：照着真实的那一个复制；第 i 个的乙结算价 = 19,000 + i % 997（甲 20,000 不变），时间往前错开 i × 50 秒（50,000 个约 29 天）
    await seeder.query(
      `insert into quotes (id, channel_id, quote_log_id, vehicle_group_id, package_hours, winner_tenant_id, product_id, product_version, currency, sell_minor, settlement_minor, settlement_currency, markup_bp, markup_rule_id, markup_level, snapshot, created_at, expires_at)
       select 'QT20260901' || lpad(i::text, 10, '0'), q.channel_id, q.quote_log_id, q.vehicle_group_id, q.package_hours, q.winner_tenant_id, q.product_id, q.product_version, q.currency, q.sell_minor, q.settlement_minor, q.settlement_currency, q.markup_bp, q.markup_rule_id, q.markup_level,
              jsonb_set(q.snapshot, '{candidates}', (select jsonb_agg(case when c->>'tenantId' = $2 then jsonb_set(c, '{settlementMinor}', to_jsonb(19000 + i % 997)) else c end) from jsonb_array_elements(q.snapshot->'candidates') c)),
              q.created_at - make_interval(secs => i * 50), q.expires_at - make_interval(secs => i * 50)
         from quotes q, generate_series(1, $3::integer) i where q.id = $1`,
      [quoteId, m.b.tenantId, QUOTES],
    );
    // 订单：前 ORDERS 个复制出来的报价各下了一单（付过款）
    await seeder.query(
      `with source as (select o.*, s.channel_id, s.api_client_id, s.request_hash, s.currency, s.sell_minor, s.markup_bp, s.fx, s.fx_buffer_bp, s.created_at as sold_at
                         from orders o join order_sales s on s.order_id = o.id where o.id = $1),
            copies as (select i, gen_random_uuid() as id from generate_series(1, $2::integer) i),
            inserted as (
              insert into orders
              select (jsonb_populate_record(null::orders, to_jsonb(src) || jsonb_build_object('id', c.id, 'order_no', 'NZ20260901' || lpad(c.i::text, 8, '0')))).*
                from source src, copies c
              returning id, tenant_id, order_no)
       insert into order_sales (order_id, supplier_tenant_id, channel_id, api_client_id, quote_id, idempotency_key, request_hash, currency, sell_minor, markup_bp, fx, fx_buffer_bp, created_at)
       select ins.id, ins.tenant_id, src.channel_id, src.api_client_id, 'QT20260901' || lpad(substr(ins.order_no, 11)::integer::text, 10, '0'), 'bench-' || ins.order_no, src.request_hash, src.currency, src.sell_minor, src.markup_bp, src.fx, src.fx_buffer_bp,
              src.sold_at - make_interval(secs => substr(ins.order_no, 11)::integer * 50)
         from inserted ins, source src`,
      [order.id, ORDERS],
    );
    await seeder.query("analyze quotes, order_sales, orders");
  } finally {
    await seeder.end();
  }
  const seedMs = performance.now() - seeded;

  const started = performance.now();
  const impact = (await ok(api.call("POST", `/platform/v1/channels/${flow.channelId}/pricing-impact`, { token: m.staff.cm1.token, body: { kind: "markup_rule.create", rule: { tenant_id: m.b.tenantId, markup_bp: 1_200 } } }))).impact;
  const elapsedMs = performance.now() - started;

  // 全部计入：复制的 + 原来的 1 个（报价、订单都是）
  assert.deepEqual([impact.quotes.total, impact.quotes.count, impact.quotes.skipped, impact.quotes.truncated], [QUOTES + 1, QUOTES + 1, 0, false]);
  assert.deepEqual([impact.orders.total, impact.orders.count, impact.orders.skipped], [ORDERS + 1, ORDERS + 1, 0]);
  // 逐个核对合计：乙结算价 s（19,000–19,996），甲 20,000。改前乙 10%：s × 1.1 一定低于甲 22,000 → 乙中标；
  // 改后乙 12%：s × 1.12 和甲 22,000 比，评分、单量一样 → 排序价低者中标；正好相同（乙 19,643 → 22,000）时按「租户编号|商品编号」小的中标（ADR 0020 待定事项 7）
  const bWinsTie = `${m.b.tenantId}|${m.ids.pb}` < `${m.a.tenantId}|${m.ids.pa}`;
  const expected = (n: number) => {
    let before = 0;
    let after = 0;
    let changed = 0;
    for (let i = 0; i < n; i += 1) {
      const s = i === 0 ? 19_800 : 19_000 + (i % 997);
      before += Math.round((s * 11) / 10) - s;
      const b12 = Math.round((s * 112) / 100);
      if (b12 < 22_000 || (b12 === 22_000 && bWinsTie)) after += b12 - s;
      else {
        after += 2_000;
        changed += 1;
      }
    }
    return { before, after, changed };
  };
  const quotes = expected(QUOTES + 1);
  assert.deepEqual([impact.quotes.before.margin_minor, impact.quotes.after.margin_minor, impact.quotes.winner_changed], [quotes.before, quotes.after, quotes.changed]);
  const orders = expected(ORDERS + 1);
  assert.deepEqual([impact.orders.before.margin_minor, impact.orders.after.margin_minor, impact.orders.winner_changed], [orders.before, orders.after, orders.changed]);

  t.diagnostic(`造数据 ${Math.round(seedMs)} ms；试算 ${QUOTES + 1} 个报价 + ${ORDERS + 1} 张订单：${Math.round(elapsedMs)} ms`);
  if (ASSERT_TIMING) assert.ok(elapsedMs <= 10_000, `试算耗时 ${Math.round(elapsedMs)} ms，超过 10 秒`);
});
