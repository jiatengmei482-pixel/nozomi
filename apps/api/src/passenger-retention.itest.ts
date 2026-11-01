/**
 * M4-21：订单结束超过 180 天后的乘客信息脱敏（ADR 0055）。真实 PostgreSQL；过期的订单只在测试里构造，都是虚构数据，测试结束连 schema 删除。
 * 边界 179 / 180 / 181 天按东京日历日；没结的工单、账单、争议不脱敏；副本一起处理；金额、订单号、时间保留；幂等、并发不重复；审计只有数量和范围；命令默认 dry-run。
 */
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { ANONYMIZED_TEXT } from "@nozomi/domain";
import type { AppContext } from "./context.ts";
import { withPlatformTx } from "./db/context.ts";
import { listRetentionCandidates } from "./repos/passenger-retention.ts";
import { PassengerRetentionJobs, planPassengerRetention, retentionCutoff } from "./services/passenger-retention.ts";
import { LOCAL_WEBHOOK_HOST, type TestApi, createTestApi } from "./testing/api.ts";
import { deniedByDatabase } from "./testing/db.ts";
import { seedOrder } from "./testing/dispatch.ts";
import { testEnv } from "./testing/fixtures.ts";
import { type Market, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { tenantLogin } from "./testing/money.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { exitWithin, startNode } from "./testing/process.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

let api: TestApi;
let m: Market;
let flow: SalesFlow;
let pay: FakePaymentProvider;
let ctx: AppContext;
const DAY = 86_400_000;
const ENTRY = fileURLToPath(new URL("./cli/privacy-anonymize.ts", import.meta.url));

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  flow = await salesFlow(api, m, pay);
  ctx = { pool: api.db.pool, now: api.clock.now, config: { passengerRetention: { enabled: true, days: 180 } } } as unknown as AppContext;
});
after(() => api.close());

/** 东京今天往前 `days` 天那一天的某个时刻（`at` 是东京当地时间）。 */
function tokyoDaysAgo(days: number, at = "12:00:00"): Date {
  const tokyoToday = new Date(api.clock.now().getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
  return new Date(new Date(`${tokyoToday}T${at}+09:00`).getTime() - days * DAY);
}

/** 让一张单变成「在这个时刻取消」：所有时间都推到那时，没有应付（免费取消），没有别的挡着的事。 */
async function endAt(orderId: string, ended: Date): Promise<void> {
  const owner = api.db.owner;
  await owner.query("update orders set status = 'cancelled', cancelled_at = $2, cancel_reason = 'GUEST_REQUEST', service_at = $2, created_at = $3::timestamptz, confirmed_at = case when confirmed_at is null then null else $3::timestamptz end, payment_due_at = $2, updated_at = $2, cancel_tenant_share_minor = null, completed_at = null where id = $1", [orderId, ended, new Date(ended.getTime() - 3_600_000)]);
  await owner.query("update order_events set occurred_at = $2 where order_id = $1", [orderId, ended]);
  await owner.query("update order_payments set disputed = false, paid_after_cancel = false, status = case when status in ('creating', 'requires_payment', 'processing') then 'canceled' else status end where order_id = $1", [orderId]);
  await owner.query("update webhook_deliveries set status = 'succeeded', next_attempt_at = null, succeeded_at = $2 where order_id = $1 and status = 'pending'", [orderId, ended]);
  await owner.query("update notifications set status = 'sent', sent_at = $2 where order_id = $1 and status = 'pending'", [orderId, ended]);
  await owner.query("update order_exceptions set status = 'closed', close_kind = 'cleared', closed_at = $2 where order_id = $1 and status <> 'closed'", [orderId, ended]);
}

async function aged(days: number, at?: string): Promise<{ id: string; orderNo: string; tenantId: string }> {
  const ended = tokyoDaysAgo(days, at);
  const order = await seedOrder(api, m, "a", { serviceAt: ended, confirmedAt: new Date(ended.getTime() - 3_600_000) });
  await endAt(order.id, ended);
  return order;
}

const passengerOf = async (orderId: string): Promise<any> => (await api.db.owner.query("select passenger from orders where id = $1 limit 1", [orderId])).rows[0].passenger;
const isDone = async (orderId: string): Promise<boolean> => (await passengerOf(orderId)).name === ANONYMIZED_TEXT;
const tick = () => api.app.passengerRetention.tick();
const retentionAudits = async (): Promise<any[]> => (await api.db.owner.query("select actor_type, source, tenant_id, resource, resource_id, before, after from audit_logs where action = 'anonymize_passenger' order by id")).rows;

test("边界：结束后第 179、180 天不动，第 181 天才动；按东京日历日，不是按 UTC 或 24 小时", async () => {
  const d179 = await aged(179);
  const d180 = await aged(180);
  const d181 = await aged(181);
  const d180Start = await aged(180, "00:00:00");
  const d181End = await aged(181, "23:59:59");
  const result = await tick();
  assert.ok(result.anonymized >= 2);
  assert.equal(await isDone(d179.id), false);
  assert.equal(await isDone(d180.id), false);
  assert.equal(await isDone(d180Start.id), false, "第 180 天的东京 0 点，UTC 看已经是前一天了，也不动");
  assert.equal(await isDone(d181.id), true);
  assert.equal(await isDone(d181End.id), true, "第 181 天的最后一秒");
});

test("脱敏后不可逆：占位不留原文片段；金额、订单号、时间、状态、版本都保留；航班号不动", async () => {
  const order = await aged(200);
  const columns = "order_no, status, settlement_minor, settlement_currency, settlement, service_at, cancelled_at, created_at, updated_at, version, flight_no, pickup, dropoff";
  const before = (await api.db.owner.query(`select ${columns} from orders where id = $1`, [order.id])).rows[0];
  await tick();
  const row = (await api.db.owner.query(`select ${columns}, passenger, passenger_anonymized_at from orders where id = $1`, [order.id])).rows[0];
  assert.deepEqual(row.passenger, { name: ANONYMIZED_TEXT, phone: ANONYMIZED_TEXT, email: ANONYMIZED_TEXT });
  assert.ok(row.passenger_anonymized_at instanceof Date);
  for (const key of Object.keys(before)) assert.deepEqual(row[key], before[key], key);
});

test("没结束的单、部分行没结束的救援单都不动：同一个订单编号的所有行一起判断、一起处理", async () => {
  const open = await seedOrder(api, m, "a", { serviceAt: tokyoDaysAgo(300), confirmedAt: tokyoDaysAgo(301), status: "assigned" });
  const rescued = await aged(250);
  await api.db.owner.query("update orders set status = 'rescued', cancelled_at = null, cancel_reason = null, rescued_at = $2 where id = $1", [rescued.id, tokyoDaysAgo(250)]);
  const clone = async (status: string, ended: Date | null): Promise<void> => {
    await api.db.owner.query(
      `insert into orders (tenant_id, id, order_no, status, category, city_id, place_id, direction, product_id, product_version, vehicle_group_id, service_at, service_local, timezone, service_date, urgent, passengers, luggage, pickup, dropoff, addons, driver_language, flight_no, passenger, settlement_minor, settlement_currency, settlement, inventory_held, payment_due_at, confirmed_at, dispatch_due_at, cancelled_at, cancel_reason, created_at, updated_at)
       select $2, id, order_no, $3, category, city_id, place_id, direction, $4, product_version, vehicle_group_id, service_at, service_local, timezone, service_date, urgent, passengers, luggage, pickup, dropoff, addons, driver_language, flight_no, passenger, settlement_minor, settlement_currency, settlement, inventory_held, payment_due_at, confirmed_at, dispatch_due_at, $5, case when $5::timestamptz is null then null else 'GUEST_REQUEST' end, created_at, updated_at from orders where id = $1`,
      [rescued.id, m.b.tenantId, status, m.ids.pb, ended],
    );
  };
  await clone("assigned", null);
  await tick();
  assert.equal(await isDone(open.id), false);
  assert.equal(await isDone(rescued.id), false, "救援供应商那一行还在履约");
  await api.db.owner.query("update orders set status = 'cancelled', cancelled_at = $2, cancel_reason = 'GUEST_REQUEST' where id = $1 and tenant_id = $3", [rescued.id, tokyoDaysAgo(250), m.b.tenantId]);
  await tick();
  const rows = (await api.db.owner.query("select passenger ->> 'name' as name from orders where id = $1", [rescued.id])).rows;
  assert.deepEqual(rows.map((row) => row.name), [ANONYMIZED_TEXT, ANONYMIZED_TEXT], "两行都脱敏");
});

test("结束时间取最晚的：回填的完成时间很早，但系统记录、状态流水更晚的，按更晚的算", async () => {
  const order = await aged(400);
  await api.db.owner.query("update order_events set occurred_at = $2 where order_id = $1", [order.id, tokyoDaysAgo(100)]);
  await api.db.owner.query("insert into order_events (tenant_id, order_id, from_status, to_status, actor, occurred_at) values ($1, $2, 'cancelled', 'cancelled', 'system', $3)", [order.tenantId, order.id, tokyoDaysAgo(100)]);
  await tick();
  assert.equal(await isDone(order.id), false);
});

async function statement(tenantId: string, order: { id: string; orderNo: string }, status: string): Promise<string> {
  const now = api.clock.now();
  const id = randomUUID();
  await api.db.owner.query(
    `insert into statements (tenant_id, id, statement_no, period, currency, status, total_minor, line_count, pay_due_on, confirm_due_at, issued_at, created_at, updated_at)
     values ($1, $2, $3, $4, 'JPY', $5, 20000, 1, '2030-01-20', $6, $6, $6, $6)`,
    [tenantId, id, `ST202601${randomUUID().replace(/[^0-9A-HJ-NP-Z]/g, "2").toUpperCase().slice(0, 8).padEnd(8, "2")}`, `20${10 + Math.floor(Math.random() * 80)}-0${1 + Math.floor(Math.random() * 9)}`, status, now],
  );
  await api.db.owner.query(
    `insert into statement_lines (tenant_id, statement_id, kind, source_key, order_id, order_no, service_date, prior_period, amount_minor, currency, detail, created_at)
     values ($1, $2, 'order', $3, $4, $5, '2026-01-01', false, 20000, 'JPY', '{}'::jsonb, $6)`,
    [tenantId, id, `order:${order.id}`, order.id, order.orderNo, now],
  );
  return id;
}

test("没结工单的不脱敏，结案后下一轮才处理；dry-run 说得出原因", async () => {
  const order = await flow.paidOrder({ serviceTime: new Date(api.clock.now().getTime() + 40 * DAY).toISOString().replace(/\.\d{3}Z$/, "Z") });
  const ticket = await ok(api.call("POST", "/platform/v1/tickets", { token: m.staff.operations.token, body: { order_id: order.id, type: "other", subject: "投诉", description: "说明" } }), 201);
  await endAt(order.id, tokyoDaysAgo(200));
  const before = (await planPassengerRetention(ctx)).summary;
  assert.ok(before.blocked.open_ticket >= 1);
  await tick();
  assert.equal(await isDone(order.id), false);
  await ok(api.call("POST", `/platform/v1/tickets/${ticket.ticket.id}/close`, { token: m.staff.operations.token, body: { note: "已处理" } }));
  await endAt(order.id, tokyoDaysAgo(200));
  await tick();
  assert.equal(await isDone(order.id), true);
});

test("账单：还没出账的、账单没结的都不脱敏；账单结了（作废的不算挂着）才处理", async () => {
  const order = await aged(200);
  await api.db.owner.query("update orders set status = 'completed', cancelled_at = null, cancel_reason = null, completed_at = $2 where id = $1", [order.id, tokyoDaysAgo(200)]);
  await tick();
  assert.equal(await isDone(order.id), false, "完成了还没出账");
  assert.ok((await planPassengerRetention(ctx)).summary.blocked.unbilled >= 1);
  const statementId = await statement(order.tenantId, order, "issued");
  await tick();
  assert.equal(await isDone(order.id), false, "账单待确认");
  assert.ok((await planPassengerRetention(ctx)).summary.blocked.open_statement >= 1);
  const staff = (await api.db.owner.query("select id from platform_users limit 1")).rows[0].id;
  await api.db.owner.query("update statements set status = 'void', voided_at = $3, voided_by = $4, void_reason = '测试' where tenant_id = $1 and id = $2", [order.tenantId, statementId, api.clock.now(), staff]);
  await tick();
  assert.equal(await isDone(order.id), true);
});

test("争议中（拒付）、退款没走完不脱敏，解除后才处理", async () => {
  const order = await flow.paidOrder({ serviceTime: new Date(api.clock.now().getTime() + 41 * DAY).toISOString().replace(/\.\d{3}Z$/, "Z") });
  await endAt(order.id, tokyoDaysAgo(200));
  await api.db.owner.query("update order_payments set disputed = true where order_id = $1", [order.id]);
  await tick();
  assert.equal(await isDone(order.id), false);
  assert.ok((await planPassengerRetention(ctx)).summary.blocked.dispute >= 1);
  await api.db.owner.query("update order_payments set disputed = false where order_id = $1", [order.id]);
  await tick();
  assert.equal(await isDone(order.id), true);
});

test("副本一起处理：改单前后值（含旧姓名）、推送内容、客人通知的收件地址、手写内容；审计从写入起就没有原文", async () => {
  const tenantToken = await tenantLogin(api, m.b.adminEmail);
  assert.equal((await api.call("PUT", "/tenant/v1/webhooks", { token: tenantToken, body: { url: `https://${LOCAL_WEBHOOK_HOST}/hook`, events: ["order.changed"] } })).status, 201);
  const order = await flow.paidOrder({ serviceTime: new Date(api.clock.now().getTime() + 42 * DAY).toISOString().replace(/\.\d{3}Z$/, "Z") });
  const token = m.staff.operations.token;
  const version = (await ok(api.call("GET", `/platform/v1/orders/${order.id}`, { token }))).order.version;
  await ok(api.call("PATCH", `/platform/v1/orders/${order.id}`, { token, headers: { "if-match": String(version) }, body: { passenger: { name: "李大伟", phone: "+81 80-9999-0000", email: "new-guest@example.com" }, notes: "李大伟要儿童座椅，电话 08099990000" } }));
  const ticket = await ok(api.call("POST", "/platform/v1/tickets", { token, body: { order_id: order.id, type: "other", subject: "李大伟来电", description: "王小明说邮箱是 guest@example.com，订单 " + order.order_no } }), 201);
  await ok(api.call("POST", `/platform/v1/tickets/${ticket.ticket.id}/messages`, { token, body: { body: "请联系 +819012345678" } }), 201);
  await ok(api.call("POST", `/platform/v1/tickets/${ticket.ticket.id}/messages`, { token, body: { body: "内部：李大伟 08099990000", internal: true } }), 201);
  await ok(api.call("POST", `/platform/v1/tickets/${ticket.ticket.id}/close`, { token, body: { note: "已回电 08099990000" } }));
  const row = (await api.db.owner.query("select tenant_id from orders where id = $1", [order.id])).rows[0];
  const link = randomUUID();
  await api.db.owner.query("insert into driver_links (tenant_id, id, order_id, token_hash, created_at, expires_at) values ($1, $2, $3, $4, $5, $5)", [row.tenant_id, link, order.id, `hash-${link}`, api.clock.now()]).catch(() => undefined);
  const hasLink = (await api.db.owner.query("select 1 from driver_links where id = $1", [link])).rows.length === 1;
  if (hasLink) await api.db.owner.query("insert into order_contacts (tenant_id, order_id, method, note, occurred_at, link_id) values ($1, $2, 'phone', '李大伟没接 08099990000', $3, $4)", [row.tenant_id, order.id, api.clock.now(), link]);
  const event = (await api.db.owner.query("insert into notification_events (tenant_id, event, order_id, dedupe_key, data, occurred_at, expanded_at) values ($1, 'order.changed', $2, $3, '{}'::jsonb, $4, $4) returning id", [row.tenant_id, order.id, `test:${order.id}`, api.clock.now()])).rows[0].id;
  await api.db.owner.query("insert into notifications (event_id, tenant_id, event, audience, locale, channel, recipient, order_id, order_no, status, next_attempt_at, expires_at, sent_at, last_error_message, created_at, updated_at) values ($1, $2, 'order.changed', 'guest', 'zh', 'email', 'new-guest@example.com', $3, $4, 'sent', $5, $5, $5, '550 new-guest@example.com rejected', $5, $5)", [event, row.tenant_id, order.id, order.order_no, api.clock.now()]);
  await endAt(order.id, tokyoDaysAgo(200));
  await tick();
  assert.equal(await isDone(order.id), true);

  const SECRETS = ["王小明", "小明", "李大伟", "大伟", "09012345678", "819012345678", "guest@", "08099990000", "9999", "new-guest"];
  const dump = async (sql: string, args: unknown[]): Promise<string> => JSON.stringify((await api.db.owner.query(sql, args)).rows);
  const tables: Record<string, string> = {
    orders: await dump("select passenger, notes, cancel_note from orders where id = $1", [order.id]),
    order_changes: await dump("select before, after, decision_note from order_changes where order_id = $1", [order.id]),
    webhook_deliveries: await dump("select event_data from webhook_deliveries where order_id = $1", [order.id]),
    notifications: await dump("select recipient, last_error_message from notifications where order_id = $1 and audience = 'guest'", [order.id]),
    order_contacts: await dump("select note from order_contacts where order_id = $1", [order.id]),
    tickets: await dump("select subject, description, decision_note, close_note from tickets where order_id = $1", [order.id]),
    ticket_messages: await dump("select m.body from ticket_messages m join tickets t on t.id = m.ticket_id where t.order_id = $1", [order.id]),
    ticket_notes: await dump("select n.body from ticket_notes n join tickets t on t.id = n.ticket_id where t.order_id = $1", [order.id]),
    audit_logs: await dump("select before, after from audit_logs where resource_id = any($1::text[]) or after ->> 'order_id' = $2 or before ->> 'order_id' = $2", [[order.id, ticket.ticket.id], order.id]),
  };
  assert.ok(tables["order_changes"]?.includes(ANONYMIZED_TEXT));
  assert.ok(tables["tickets"]?.includes(order.order_no), "手写内容里的订单号保留");
  for (const [table, text] of Object.entries(tables)) for (const secret of SECRETS) assert.ok(!text.includes(secret), `${table} 还有 ${secret}：${text.slice(Math.max(0, text.indexOf(secret) - 200), text.indexOf(secret) + 60)}`);

  // 接口：运营详情、查看都是占位；供应商、渠道也是占位，页面照常
  const detail = await ok(api.call("GET", `/platform/v1/orders/${order.id}`, { token }));
  assert.equal(detail.order.passenger.name, ANONYMIZED_TEXT, "打码函数不会把占位打成半截");
  assert.ok(detail.order.passenger_anonymized_at);
  const revealed = await ok(api.call("POST", `/platform/v1/orders/${order.id}/passenger/reveal`, { token }));
  assert.deepEqual(revealed.passenger, { name: ANONYMIZED_TEXT, phone: ANONYMIZED_TEXT, email: ANONYMIZED_TEXT });
  assert.ok(revealed.anonymized_at);
  assert.ok(!JSON.stringify(revealed).includes("李大伟"));
  const list = await ok(api.call("GET", `/platform/v1/orders?passenger=${encodeURIComponent("李大伟")}`, { token }));
  assert.equal(list.items.filter((item: any) => item.id === order.id).length, 0, "按旧姓名筛不到");
  const byNo = await ok(api.call("GET", `/platform/v1/orders?q=${order.order_no}`, { token }));
  assert.equal(byNo.items.length, 1, "按订单号仍然查得到");
  await ok(api.call("DELETE", "/tenant/v1/webhooks", { token: tenantToken }), 204);
});

test("幂等、并发不重复：第二轮不再选中、不再记审计；几个实例同时跑每单只处理一次", async () => {
  await tick();
  const orders = [await aged(190), await aged(191), await aged(192)];
  const audits = (await retentionAudits()).length;
  const results = await Promise.all([tick(), tick(), tick()]);
  const total = results.reduce((sum, item) => sum + item.anonymized, 0);
  assert.equal(total, 3);
  assert.ok(results.filter((item) => item.anonymized > 0 || item.busy).length >= 1);
  for (const order of orders) assert.equal(await isDone(order.id), true);
  const after = (await retentionAudits()).length;
  assert.ok(after > audits);
  assert.deepEqual(await tick(), { anonymized: 0, skipped: 0, batches: 1, busy: false });
  assert.equal((await retentionAudits()).length, after, "没做事不记审计");
});

test("分批：每批按结束时间取前面的，被挡住的不占名额，出过错的这一轮不再选", async () => {
  await tick();
  const paid = await flow.paidOrder({ serviceTime: new Date(api.clock.now().getTime() + 43 * DAY).toISOString().replace(/\.\d{3}Z$/, "Z") });
  await endAt(paid.id, tokyoDaysAgo(490));
  await api.db.owner.query("update order_payments set disputed = true where order_id = $1", [paid.id]);
  const first = await aged(400);
  const second = await aged(399);
  const { cutoff } = retentionCutoff(ctx);
  const page = await withPlatformTx(api.db.pool, (db) => listRetentionCandidates(db, cutoff, 1));
  assert.deepEqual(page.map((item) => item.orderId), [first.id], "被拒付挡住的那张比它早，但不占名额");
  const excepted = await withPlatformTx(api.db.pool, (db) => listRetentionCandidates(db, cutoff, 1, [first.id]));
  assert.deepEqual(excepted.map((item) => item.orderId), [second.id]);
  await tick();
  await api.db.owner.query("update order_payments set disputed = false where order_id = $1", [paid.id]);
  await tick();
});

test("审计只有数量和范围：没有订单编号、订单号和任何内容；记为系统任务，不属于任何租户", async () => {
  const order = await aged(210);
  await tick();
  const [last] = (await retentionAudits()).slice(-1);
  assert.deepEqual([last.actor_type, last.source, last.tenant_id, last.resource, last.resource_id, last.before], ["system", "job", null, "order", null, null]);
  assert.deepEqual(Object.keys(last.after).sort(), ["count", "ended_before", "ended_from", "ended_to", "retention_days", "skipped"]);
  assert.equal(last.after.retention_days, 180);
  assert.ok(!JSON.stringify(last).includes(order.id) && !JSON.stringify(last).includes(order.orderNo));
  const logs = await ok(api.call("GET", "/platform/v1/audit-logs?action=anonymize_passenger", { token: m.root }));
  assert.ok(logs.items.length >= 1, "运营的审计日志查得到");
  const tenantLogs = await ok(api.call("GET", "/tenant/v1/audit-logs?action=anonymize_passenger", { token: await tenantLogin(api, m.a.adminEmail) }));
  assert.equal(tenantLogs.items.length, 0, "供应商看不到");
});

test("开关和期限：关闭时什么都不做；期限调长后按新的算；期限低于 180 算不出截止时间", async () => {
  const order = await aged(200);
  const disabled = new PassengerRetentionJobs({ ...ctx, config: { passengerRetention: { enabled: false, days: 180 } } } as unknown as AppContext, api.app.log);
  assert.deepEqual(await disabled.tick(), { anonymized: 0, skipped: 0, batches: 0, busy: false });
  assert.equal(await isDone(order.id), false);
  const longer = new PassengerRetentionJobs({ ...ctx, config: { passengerRetention: { enabled: true, days: 300 } } } as unknown as AppContext, api.app.log);
  await longer.tick();
  assert.equal(await isDone(order.id), false, "保存 300 天时 200 天的不动");
  assert.throws(() => retentionCutoff({ ...ctx, config: { passengerRetention: { enabled: true, days: 179 } } } as unknown as AppContext), RangeError);
  await tick();
  assert.equal(await isDone(order.id), true);
});

test("命令默认 dry-run：只打印数量，不改任何数据，输出里没有订单信息；--execute 才执行，记为命令行", async () => {
  await tick();
  const order = await aged(220);
  const run = async (args: string[], env: Record<string, string> = {}): Promise<{ code: unknown; output: string }> => {
    const running = startNode(ENTRY, { ...testEnv(api.db.url), ...env }, args);
    const code = await exitWithin(running, 20_000);
    if (code === "timeout") running.child.kill("SIGKILL");
    return { code, output: running.output() };
  };
  const dry = await run([]);
  assert.equal(dry.code, 0, dry.output);
  assert.match(dry.output, /现在可以脱敏：\d+ 单/);
  assert.match(dry.output, /dry-run/);
  assert.equal(await isDone(order.id), false);
  assert.ok(!dry.output.includes(order.id) && !dry.output.includes(order.orderNo) && !dry.output.includes("王小明"));
  assert.equal((await run(["--dry-run", "--execute"])).code, 1);
  assert.equal((await run(["--execute"], { PASSENGER_RETENTION_ENABLED: "false" })).code, 1, "开关关闭时拒绝");
  assert.equal(await isDone(order.id), false);
  assert.notEqual((await run([], { PASSENGER_RETENTION_DAYS: "179" })).code, 0, "配小了报错");
  const done = await run(["--execute"]);
  assert.equal(done.code, 0, done.output);
  assert.equal(await isDone(order.id), true);
  const [last] = (await retentionAudits()).slice(-1);
  assert.equal(last.source, "cli");
});

test("数据库防线：供应商改不了脱敏标记；平台不能改没脱敏的单的联系记录和工单对话", async () => {
  const order = await seedOrder(api, m, "a", { serviceAt: tokyoDaysAgo(10), confirmedAt: tokyoDaysAgo(11) });
  const { withTenantTx } = await import("./db/context.ts");
  await assert.rejects(withTenantTx(api.db.pool, order.tenantId, (db) => db.query("update orders set passenger_anonymized_at = now() where id = $1", [order.id])), deniedByDatabase);
  await assert.rejects(withTenantTx(api.db.pool, order.tenantId, (db) => db.query("update ticket_messages set body = 'x'")), deniedByDatabase);
  const paid = await flow.paidOrder({ serviceTime: new Date(api.clock.now().getTime() + 44 * DAY).toISOString().replace(/\.\d{3}Z$/, "Z") });
  const token = m.staff.operations.token;
  const ticket = await ok(api.call("POST", "/platform/v1/tickets", { token, body: { order_id: paid.id, type: "other", subject: "投诉", description: "说明" } }), 201);
  await ok(api.call("POST", `/platform/v1/tickets/${ticket.ticket.id}/messages`, { token, body: { body: "对话" } }), 201);
  await ok(api.call("POST", `/platform/v1/tickets/${ticket.ticket.id}/messages`, { token, body: { body: "内部", internal: true } }), 201);
  for (const table of ["ticket_messages", "ticket_notes"]) {
    await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query(`update ${table} set body = 'x' where ticket_id = $1`, [ticket.ticket.id])), deniedByDatabase, table);
  }
  await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query("update ticket_messages set author_type = 'system' where ticket_id = $1", [ticket.ticket.id])), deniedByDatabase, "别的列本来就不能改");
  await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query("delete from ticket_notes where ticket_id = $1", [ticket.ticket.id])), deniedByDatabase);
});

test("跨租户：脱敏只动超过期限的单，别的供应商同时期没到期的单不受影响", async () => {
  const mine = await aged(230);
  const other = await seedOrder(api, m, "b", { serviceAt: tokyoDaysAgo(100), confirmedAt: tokyoDaysAgo(101) });
  await endAt(other.id, tokyoDaysAgo(100));
  await tick();
  assert.equal(await isDone(mine.id), true);
  assert.equal(await isDone(other.id), false);
  assert.equal((await passengerOf(other.id)).email, "guest@example.com");
});

test("官网查订单：脱敏后的单按邮箱、手机都查不到，和对不上是同一个 404；连占位文字本身也对不上，同样计失败", async () => {
  const siteChannelId = (await newChannel(api, m.staff.cm1.token, { name: `官网-${randomUUID().slice(0, 4)}` })).id;
  const client = await salesCredentials(api, m, siteChannelId);
  const site: SiteApi = await siteApi(api, client.clientId, pay);
  try {
    const quoted = await site.call("POST", "/site/v1/quotes", { body: { city_id: m.ids.tokyo, airport_id: m.ids.narita, direction: "pickup", address: { lng: 139.7, lat: 35.6 }, service_local: "2026-12-20T10:00", passengers: 2, luggage: 1, category: "airport_transfer" } });
    assert.equal(quoted.status, 200, quoted.text);
    api.clock.advance(1_000);
    const quote = quoted.body.quotes[0];
    const placed = await site.call("POST", "/site/v1/orders", { headers: { "idempotency-key": randomUUID() }, body: { quote_id: quote.quote_id, passenger: { name: "赵六", phone: "+81 90-5555-6666", email: "zhao@example.com" }, flight_no: "nh 211", dropoff_address: "东京站八重洲口", save_payment_method: true } });
    assert.equal(placed.status, 201, placed.text);
    const { order_no: orderNo, id } = placed.body.order;
    const lookup = (contact: string, ip: string) => site.call("POST", "/site/v1/orders/lookup", { ip, body: { order_no: orderNo, contact } });
    assert.equal((await lookup("zhao@example.com", "198.51.100.91")).status, 200, "脱敏前查得到");
    const wrong = await lookup("nobody@example.com", "198.51.100.92");
    await endAt(id, tokyoDaysAgo(200));
    await tick();
    assert.equal(await isDone(id), true);
    const byEmail = await lookup("zhao@example.com", "198.51.100.93");
    const byPhone = await lookup("+819055556666", "198.51.100.94");
    const byPlaceholder = await lookup(ANONYMIZED_TEXT, "198.51.100.95");
    for (const res of [byEmail, byPhone, byPlaceholder]) {
      assert.deepEqual([res.status, res.body.error.code, res.body.error.message], [404, "ORDER_NOT_FOUND", wrong.body.error.message], "和对不上一样，分不出订单号存不存在");
      assert.match(res.body.error.message, /超过 180 天.*隐私规则清除.*联系客服/);
    }
    const nonexistent = await site.call("POST", "/site/v1/orders/lookup", { ip: "198.51.100.96", body: { order_no: "NZ20261001ABCD2345", contact: "zhao@example.com" } });
    assert.deepEqual([nonexistent.status, nonexistent.body.error.message], [404, wrong.body.error.message]);
    // 脱敏后新发生的事不再给客人发邮件：没有地址，不会发到占位上
    const tenantId = (await api.db.owner.query("select tenant_id from orders where id = $1", [id])).rows[0].tenant_id;
    await api.db.owner.query("insert into notification_events (tenant_id, event, order_id, dedupe_key, data, occurred_at) values ($1, 'order.changed', $2, $3, $4::jsonb, $5)", [tenantId, id, `anonymized:${id}`, JSON.stringify({ change_id: randomUUID(), fields: ["notes"] }), api.clock.now()]);
    await api.app.notificationJobs.tick();
    const guests = (await api.db.owner.query("select recipient from notifications where order_id = $1 and audience = 'guest'", [id])).rows;
    assert.ok(guests.every((row) => row.recipient === ANONYMIZED_TEXT), JSON.stringify(guests));
    assert.equal((await api.db.owner.query("select count(*)::int as n from notifications where order_id = $1 and audience = 'guest' and status in ('pending', 'sending', 'sent') and event = 'order.changed' and created_at >= $2", [id, api.clock.now()])).rows[0].n, 0);
  } finally {
    await site.close();
  }
});

test("数据库防线：已脱敏的单也只能改手写内容那一列", async () => {
  const paid = await flow.paidOrder({ serviceTime: new Date(api.clock.now().getTime() + 45 * DAY).toISOString().replace(/\.\d{3}Z$/, "Z") });
  const token = m.staff.operations.token;
  const ticket = await ok(api.call("POST", "/platform/v1/tickets", { token, body: { order_id: paid.id, type: "other", subject: "投诉", description: "说明" } }), 201);
  await ok(api.call("POST", `/platform/v1/tickets/${ticket.ticket.id}/messages`, { token, body: { body: "对话" } }), 201);
  await ok(api.call("POST", `/platform/v1/tickets/${ticket.ticket.id}/close`, { token, body: { note: "结" } }));
  await endAt(paid.id, tokyoDaysAgo(200));
  await tick();
  assert.equal(await isDone(paid.id), true);
  await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query("update ticket_messages set author_type = 'system', author_id = null where ticket_id = $1", [ticket.ticket.id])), deniedByDatabase);
  const changed = await withPlatformTx(api.db.pool, (db) => db.query("update ticket_messages set body = '已清除' where ticket_id = $1", [ticket.ticket.id]));
  assert.equal(changed.rowCount, 1);
});
