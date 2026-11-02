/**
 * M4-21 QA：脱敏后「副本」清干净（全库扫描虚构的姓名、电话、邮箱），业务不被破坏（账单、工单历史、详情都还能打开，金额和订单号不变），通知不发到占位上。
 * 第一个 before 里经真实接口做一张什么都经历过的单，再脱敏；同一个库里只有这张单带这些虚构信息，所以可以按整张表扫描。真实 PostgreSQL，随 schema 删除。
 */
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ANONYMIZED_TEXT } from "@nozomi/domain";
import { withPlatformTx } from "./db/context.ts";
import { type TestApi, createTestApi } from "./testing/api.ts";
import { assign, newDriver, newVehicle } from "./testing/dispatch.ts";
import { type FakeSmtp, startFakeSmtp } from "./testing/fake-integrations.ts";
import { type Market, allKeys, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";
import { newSiteLink } from "./services/site.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";
import {
  DAY, type Seeded, endAt, insertException, insertExtraCharge, insertGuestNotification, insertPayment, insertRescue, insertStatement, insertWebhookDelivery, isDone, setStatementStatus, tokyoDaysAgo,
} from "./testing/retention-fixtures.ts";

const OLD = { name: "王小明", phone: "+81 90-1234-5678", email: "guest@example.com" };
const NOW = { name: "柏木悠真", phone: "+81 80-6622-8844", email: "qa.kashiwagi@example.test" };
const WRITTEN = `柏木悠真来电，王小明的电话 09012345678，新电话 08066228844，邮箱 ${NOW.email}、${OLD.email}`;
const SECRETS = ["王小明", "小明", "柏木", "悠真", "09012345678", "819012345678", "90-1234-5678", "guest@example.com", "08066228844", "818066228844", "80-6622-8844", "6622-8844", "66228844", NOW.email, "qa.kashiwagi"];

let api: TestApi;
let m: Market;
let flow: SalesFlow;
let pay: FakePaymentProvider;
let order: any;
let seeded: Seeded;
let ticketId: string;
let statementId: string;
let beforeMoney: string;
let tenantToken: string;

const q = (sql: string, args: unknown[] = []) => api.db.owner.query(sql, args);
const tick = () => api.app.passengerRetention.tick();
/** 随机生成的编号、哈希、单号里可能碰巧有短片段：电话至少比 8 位，这里再去掉一遍。姓名、电话、邮箱不可能在这些形状里。 */
const RANDOM_TOKENS = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-fA-F]{24,}|\b(?:NZ|TK|ST|FB)[0-9A-Z]{12,}\b|[A-Za-z0-9_-]{32,}/g;
const hits = (text: string): string[] => {
  const cleaned = text.replace(RANDOM_TOKENS, "");
  return SECRETS.filter((secret) => cleaned.includes(secret));
};

/** 不能被脱敏改动的业务数据：金额、订单号、时间、状态、流水。 */
async function moneySnapshot(id: string): Promise<string> {
  const parts: unknown[] = [];
  for (const sql of [
    "select tenant_id, id, order_no, status, service_at, cancelled_at, created_at, updated_at, version, settlement_minor, settlement_currency, settlement, cancel_fee_bp, cancel_tenant_share_minor, flight_no, pickup, dropoff from orders where id = $1 order by tenant_id",
    "select * from order_sales where order_id = $1",
    "select id, kind, amount_minor, currency, status, refunded_minor, intent_id from order_payments where order_id = $1 order by id",
    "select id, amount_minor, currency, status from order_refunds where order_id = $1 order by id",
    "select id, amount_minor, approved_minor, currency, status from order_extra_charges where order_id = $1 order by id",
    "select statement_id, kind, source_key, order_no, amount_minor, currency, detail from statement_lines where order_id = $1 order by source_key",
    "select seq, from_status, to_status, actor, reason, occurred_at, detail from order_events where order_id = $1 order by seq",
    "select id, status, settlement_before_minor, settlement_after_minor, requested_at from order_changes where order_id = $1 order by id",
    "select id, ticket_no, status, outcome, created_at, closed_at, version from tickets where order_id = $1 order by id",
  ]) parts.push((await q(sql, [id])).rows);
  return JSON.stringify(parts);
}

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  flow = await salesFlow(api, m, pay);
  tenantToken = await tenantLogin(api, m.b.adminEmail);
  const webhook = await api.call("PUT", "/tenant/v1/webhooks", { token: tenantToken, body: { url: "https://hooks.nozomi.test/hook", events: ["order.changed"] } });
  assert.equal(webhook.status, 201, webhook.text);

  order = await flow.paidOrder({ serviceTime: new Date(api.clock.now().getTime() + 40 * DAY).toISOString().replace(/\.\d{3}Z$/, "Z") });
  const token = m.staff.operations.token;
  const row = (await q("select tenant_id from orders where id = $1", [order.id])).rows[0];
  seeded = { id: order.id, orderNo: order.order_no, tenantId: row.tenant_id };

  // 改单：旧姓名、新姓名都进了前后值和推送
  const version = (await ok(api.call("GET", `/platform/v1/orders/${order.id}`, { token }))).order.version;
  await ok(api.call("PATCH", `/platform/v1/orders/${order.id}`, { token, headers: { "if-match": String(version) }, body: { passenger: NOW, notes: `${WRITTEN}，订单 ${order.order_no}` } }));

  // 工单：标题、经过、对话、内部备注、关闭说明
  const ticket = await ok(api.call("POST", "/platform/v1/tickets", { token, body: { order_id: order.id, type: "other", subject: "柏木悠真来电 08066228844", description: `${WRITTEN}，订单 ${order.order_no}，2026-11-01 付了 ¥15000` } }), 201);
  ticketId = ticket.ticket.id;
  await ok(api.call("POST", `/platform/v1/tickets/${ticketId}/messages`, { token, body: { body: WRITTEN } }), 201);
  await ok(api.call("POST", `/platform/v1/tickets/${ticketId}/messages`, { token, body: { body: WRITTEN, internal: true } }), 201);
  await ok(api.call("POST", `/platform/v1/tickets/${ticketId}/close`, { token, body: { note: WRITTEN } }));

  // 司机的联系记录
  const who = { adminToken: tenantToken };
  const driver = await newDriver(api, who as any);
  const vehicle = await newVehicle(api, who as any, m.ids.biz7);
  await ok(assign(api, who, order.id, driver.id, vehicle.id));
  const link = (await q("select id from driver_links where order_id = $1 limit 1", [order.id])).rows[0].id;
  await q("insert into order_contacts (tenant_id, order_id, method, note, occurred_at, link_id) values ($1, $2, 'phone', $3, $4, $5)", [seeded.tenantId, order.id, "柏木悠真没接 08066228844", api.clock.now(), link]);

  // 加收、救援、异常、退款的错误信息、通知、推送
  await insertExtraCharge(api, seeded, "rejected", { description: "柏木悠真 08066228844", disputeReason: WRITTEN, decisionNote: WRITTEN });
  const rescue = await insertRescue(api, seeded, "cancelled", { reason: WRITTEN, forceMajeureNote: WRITTEN });
  const tenantB = seeded.tenantId === m.b.tenantId ? m.a.tenantId : m.b.tenantId;
  const productB = seeded.tenantId === m.b.tenantId ? m.ids.pa : m.ids.pb;
  await q(
    `insert into order_rescue_offers (tenant_id, rescue_id, order_id, product_id, product_version, vehicle_group_id, trip, settlement_minor, settlement_currency, settlement, status, offered_by_type, offered_at, expires_at, decided_at, decline_reason)
     values ($1, $2, $3, $4, 1, $5, '{}'::jsonb, 20000, 'JPY', '{}'::jsonb, 'declined', 'system', $6, $7, $6, $8)`,
    [tenantB, rescue, order.id, productB, m.ids.biz7, api.clock.now(), new Date(api.clock.now().getTime() + DAY), "客人柏木悠真电话 08066228844 打不通"],
  );
  await insertException(api, seeded, "closed", { resolution: WRITTEN, detail: { reason: "refund_failed", last_error: { code: "bad", message: `退款失败，联系 ${NOW.email}` } } });
  await insertGuestNotification(api, seeded, "sent", { recipient: NOW.email, lastError: `550 ${NOW.email} rejected, 柏木悠真` });
  await insertGuestNotification(api, seeded, "failed", { recipient: OLD.email, lastError: `550 ${OLD.email} rejected` });
  await insertWebhookDelivery(api, seeded, "failed", { order: { passenger: NOW, notes: WRITTEN }, changes: [{ before: { passenger: OLD } }] });
  await q("update order_refunds set last_error = last_error where order_id = $1", [order.id]);
  await q("update order_payments set last_error = $2::jsonb where order_id = $1", [order.id, JSON.stringify({ code: "card_declined", decline_code: null, message: `持卡人 ${NOW.email}` })]);
  await q("update orders set cancel_note = $2 where id = $1", [order.id, WRITTEN]);

  // 账单：这单上过账，账单已付
  await endAt(api, order.id, tokyoDaysAgo(api, 200));
  statementId = await insertStatement(api, seeded.tenantId, { kind: "order", sourceKey: `order:${order.id}`, orderId: order.id, orderNo: order.order_no });
  await setStatementStatus(api, statementId, "paid");
  beforeMoney = await moneySnapshot(order.id);
  await tick();
  assert.equal(await isDone(api, order.id), true, "这张单应该被脱敏，否则下面的用例没有意义");
});
after(() => api.close());

const COPIES: { name: string; sql: string; args: () => unknown[] }[] = [
  { name: "orders（乘客、备注、取消说明）", sql: "select passenger, notes, cancel_note from orders where id = $1", args: () => [order.id] },
  { name: "order_changes 前后值", sql: "select before, after, decision_note from order_changes where order_id = $1", args: () => [order.id] },
  { name: "webhook_deliveries 推送内容", sql: "select event_data from webhook_deliveries where order_id = $1", args: () => [order.id] },
  { name: "notifications 收件地址和错误信息", sql: "select recipient, last_error_message from notifications where order_id = $1 and audience = 'guest'", args: () => [order.id] },
  { name: "notification_events 事件数据", sql: "select data, expand_error from notification_events where order_id = $1", args: () => [order.id] },
  { name: "order_contacts 联系记录", sql: "select note from order_contacts where order_id = $1", args: () => [order.id] },
  { name: "tickets 四个文字列", sql: "select subject, description, decision_note, close_note from tickets where order_id = $1", args: () => [order.id] },
  { name: "ticket_messages 对话", sql: "select m.body from ticket_messages m join tickets t on t.id = m.ticket_id where t.order_id = $1", args: () => [order.id] },
  { name: "ticket_notes 内部备注", sql: "select n.body from ticket_notes n join tickets t on t.id = n.ticket_id where t.order_id = $1", args: () => [order.id] },
  { name: "order_extra_charges 加收文字", sql: "select description, dispute_reason, decision_note, last_charge_error from order_extra_charges where order_id = $1", args: () => [order.id] },
  { name: "order_rescues 救援文字", sql: "select reason, force_majeure_note from order_rescues where order_id = $1", args: () => [order.id] },
  { name: "order_rescue_offers 供应商拒绝救援的原因", sql: "select decline_reason from order_rescue_offers where order_id = $1", args: () => [order.id] },
  { name: "order_exceptions 处理说明", sql: "select resolution from order_exceptions where order_id = $1", args: () => [order.id] },
  { name: "order_exceptions.detail（ADR 0055 自己写了：重试错误里可能带收件地址）", sql: "select detail from order_exceptions where order_id = $1", args: () => [order.id] },
  { name: "order_payments.last_error", sql: "select last_error from order_payments where order_id = $1", args: () => [order.id] },
  { name: "审计日志", sql: "select before, after from audit_logs where resource_id = any($1::text[]) or after ->> 'order_id' = $2 or before ->> 'order_id' = $2", args: () => [[order.id, ticketId], order.id] },
];

for (const copy of COPIES) {
  test(`副本清干净：${copy.name}`, async () => {
    const text = JSON.stringify((await q(copy.sql, copy.args())).rows);
    const found = hits(text);
    assert.deepEqual(found, [], found.length === 0 ? "" : text.slice(Math.max(0, text.indexOf(found[0] as string) - 300), text.indexOf(found[0] as string) + 100));
  });
}

test("全库扫描：所有表都找不到这位乘客的姓名、电话、邮箱", async () => {
  const tables = (await q("select table_name from information_schema.tables where table_schema = current_schema() and table_type = 'BASE TABLE' and table_name <> 'schema_migrations' order by 1")).rows.map((row: { table_name: string }) => row.table_name);
  assert.ok(tables.length > 50);
  const found: Record<string, string[]> = {};
  for (const table of tables) {
    const rows = (await q(`select t::text as line from ${table} t`)).rows as { line: string }[];
    const inTable = [...new Set(rows.flatMap((row) => hits(row.line)))];
    if (inTable.length > 0) found[table] = inTable;
  }
  assert.deepEqual(found, {});
});

test("手写内容：姓名、电话、邮箱换成占位，其余文字、订单号、日期、金额都留着；占位没有任何原文片段", async () => {
  const row = (await q("select subject, description from tickets where id = $1", [ticketId])).rows[0];
  assert.ok(row.description.includes(order.order_no), row.description);
  assert.ok(row.description.includes("2026-11-01"), row.description);
  assert.ok(row.description.includes("¥15000"), row.description);
  assert.ok(row.description.includes(ANONYMIZED_TEXT));
  assert.ok(row.description.includes("来电"));
  const passenger = (await q("select passenger from orders where id = $1", [order.id])).rows[0].passenger;
  assert.deepEqual(passenger, { name: ANONYMIZED_TEXT, phone: ANONYMIZED_TEXT, email: ANONYMIZED_TEXT });
});

test("金额、订单号、时间、状态、版本、流水、账单明细一个字都没变", async () => {
  assert.equal(await moneySnapshot(order.id), beforeMoney);
});

test("脱敏后业务不破坏：运营的详情、列表、工单、账单、审计都能打开且符合 OpenAPI", async () => {
  const token = m.staff.operations.token;
  const pages: [string, string][] = [
    [`/platform/v1/orders/${order.id}`, "/platform/v1/orders/{id}"],
    [`/platform/v1/orders?q=${order.order_no}`, "/platform/v1/orders"],
    [`/platform/v1/tickets/${ticketId}`, "/platform/v1/tickets/{id}"],
    [`/platform/v1/tickets?order_id=${order.id}`, "/platform/v1/tickets"],
    [`/platform/v1/webhook-deliveries?order_id=${order.id}`, "/platform/v1/webhook-deliveries"],
    [`/platform/v1/notifications?order_id=${order.id}`, "/platform/v1/notifications"],
    [`/platform/v1/exceptions?order_id=${order.id}&status=closed`, "/platform/v1/exceptions"],
  ];
  for (const [url, path] of pages) {
    const res = await api.call("GET", url, { token: m.root });
    assert.equal(res.status, 200, `${url} ${res.text}`);
    assertMatchesOpenApi("GET", path, res);
  }
  const detail = (await ok(api.call("GET", `/platform/v1/orders/${order.id}`, { token })));
  assert.equal(detail.order.order_no, order.order_no);
  assert.equal(detail.order.sell.amount, order.sell?.amount ?? detail.order.sell.amount);
  assert.equal(detail.order.passenger.name, ANONYMIZED_TEXT);
  assert.equal(detail.order.passenger.phone, ANONYMIZED_TEXT, "占位不能被打成半截");
  assert.equal(detail.order.passenger.email, ANONYMIZED_TEXT, "占位不能被打成半截");
  assert.ok(detail.changes.length >= 1, "改单历史还在");
  const tickets = await ok(api.call("GET", `/platform/v1/tickets/${ticketId}`, { token }));
  assert.ok(tickets.messages.length >= 1 && tickets.notes.length >= 1, "工单历史还在");
  const finance = await api.call("GET", `/platform/v1/statements/${statementId}`, { token: m.root });
  assert.equal(finance.status, 200, finance.text);
  assert.ok(finance.text.includes(order.order_no), "账单明细里的订单号还在");
  const audits = await api.call("GET", `/platform/v1/audit-logs?resource=order_change`, { token: m.root });
  assert.equal(audits.status, 200, audits.text);
  assert.deepEqual(hits(audits.text), []);
  const notifications = await ok(api.call("GET", `/platform/v1/notifications?order_id=${order.id}`, { token: m.root }));
  assert.ok(notifications.items.filter((item: any) => item.audience === "guest").every((item: any) => !item.recipient.includes("@")), JSON.stringify(notifications.items.map((item: any) => item.recipient)));
});

for (const url of ["orders/{id}", "orders?q={no}", "tickets/{ticket}", "tickets?order_id={id}", "webhook-deliveries?order_id={id}", "notifications?order_id={id}", "exceptions?order_id={id}&status=closed", "rescues"]) {
  test(`脱敏后运营接口里也没有原文：${url}`, async () => {
    const res = await api.call("GET", `/platform/v1/${url.replace("{id}", order.id).replace("{no}", order.order_no).replace("{ticket}", ticketId)}`, { token: m.root });
    assert.equal(res.status, 200, res.text);
    const found = hits(res.text);
    assert.deepEqual(found, [], found.length === 0 ? "" : res.text.slice(Math.max(0, res.text.indexOf(found[0] as string) - 200), res.text.indexOf(found[0] as string) + 80));
  });
}

test("脱敏后业务不破坏：供应商的订单、工单、账单、渠道的订单都能打开，规则 4 不变", async () => {
  const pages: [string, string][] = [
    [`/tenant/v1/orders/${order.id}`, "/tenant/v1/orders/{id}"],
    [`/tenant/v1/orders`, "/tenant/v1/orders"],
    [`/tenant/v1/tickets/${ticketId}`, "/tenant/v1/tickets/{id}"],
    [`/tenant/v1/statements/${statementId}`, "/tenant/v1/statements/{id}"],
  ];
  for (const [url, path] of pages) {
    const res = await api.call("GET", url, { token: tenantToken });
    assert.equal(res.status, 200, `${url} ${res.text}`);
    assertMatchesOpenApi("GET", path, res);
    const found = hits(res.text);
    assert.deepEqual(found, [], found.length === 0 ? url : `${url}：${res.text.slice(Math.max(0, res.text.indexOf(found[0] as string) - 200), res.text.indexOf(found[0] as string) + 80)}`);
    const keys = allKeys(res.body);
    for (const forbidden of ["sell", "sell_minor", "markup_bp", "markup"]) assert.ok(!keys.has(forbidden), `${url} 不能有 ${forbidden}`);
  }
  const seen = await ok(api.call("GET", `/tenant/v1/orders/${order.id}`, { token: tenantToken }));
  assert.equal(seen.order.passenger.name, ANONYMIZED_TEXT);
  const channelToken = await flow.token();
  const sales = await api.call("GET", `/sales/v1/orders/${order.id}`, { token: channelToken });
  assert.equal(sales.status, 200, sales.text);
  assertMatchesOpenApi("GET", "/sales/v1/orders/{id}", sales);
  assert.equal(sales.body.order.passenger.email, ANONYMIZED_TEXT);
  const salesTickets = await api.call("GET", `/sales/v1/orders/${order.id}/tickets`, { token: channelToken });
  assert.equal(salesTickets.status, 200, salesTickets.text);
  assert.deepEqual(hits(salesTickets.text), []);
});

test("脱敏后不能改回原文：运营、渠道的改单接口都不能写乘客和备注", async () => {
  const token = m.staff.operations.token;
  const detail = await ok(api.call("GET", `/platform/v1/orders/${order.id}`, { token }));
  const platform = await api.call("PATCH", `/platform/v1/orders/${order.id}`, { token, headers: { "if-match": String(detail.order.version) }, body: { passenger: NOW, notes: WRITTEN } });
  assert.notEqual(platform.status, 200, platform.text);
  const channel = await api.call("PATCH", `/sales/v1/orders/${order.id}`, { token: await flow.token(), headers: { "if-match": String(detail.order.version) }, body: { passenger: NOW } });
  assert.notEqual(channel.status, 200, channel.text);
  assert.deepEqual((await q("select passenger from orders where id = $1", [order.id])).rows[0].passenger, { name: ANONYMIZED_TEXT, phone: ANONYMIZED_TEXT, email: ANONYMIZED_TEXT });
  assert.equal((await q("select count(*)::int as n from order_changes where order_id = $1 and status in ('awaiting_payment', 'pending_confirmation')", [order.id])).rows[0].n, 0);
});

test("再跑一轮什么都不变：占位不会被再处理，脱敏时间不变", async () => {
  const before = (await q("select passenger_anonymized_at from orders where id = $1", [order.id])).rows[0].passenger_anonymized_at;
  api.clock.advance(1_000);
  await tick();
  const after = (await q("select passenger_anonymized_at from orders where id = $1", [order.id])).rows[0].passenger_anonymized_at;
  assert.deepEqual(after, before);
});

test("脱敏后手写内容没有备份：脱敏后才写进这单工单的联系方式也不能永久留在库里", async () => {
  const token = m.staff.operations.token;
  const late = await ok(api.call("POST", "/platform/v1/tickets", { token, body: { order_id: order.id, type: "other", subject: "事后投诉", description: "客人回电 08011112222，邮箱 late.guest@example.test" } }), 201);
  await ok(api.call("POST", `/platform/v1/tickets/${late.ticket.id}/close`, { token, body: { note: "已处理" } }));
  await tick();
  const row = (await q("select description from tickets where id = $1", [late.ticket.id])).rows[0];
  assert.ok(!row.description.includes("08011112222") && !row.description.includes("late.guest"), `这单已经标了脱敏，不会再被选中，新写的联系方式永远留着：${row.description}`);
});

test("官网下单的单：全库扫描（幂等记录、下单记录、查看链接）也找不到姓名和联系方式", async () => {
  const channelId = (await newChannel(api, m.staff.cm1.token, { name: `官网-${randomUUID().slice(0, 4)}` })).id;
  const client = await salesCredentials(api, m, channelId);
  const site: SiteApi = await siteApi(api, client.clientId, pay);
  try {
    api.clock.advance(60_000);
    const quoted = await site.call("POST", "/site/v1/quotes", { body: { city_id: m.ids.tokyo, airport_id: m.ids.narita, direction: "pickup", address: { lng: 139.7, lat: 35.6 }, service_local: "2026-12-20T10:00", passengers: 2, luggage: 1, category: "airport_transfer" } });
    assert.equal(quoted.status, 200, quoted.text);
    api.clock.advance(1_000);
    const placed = await site.call("POST", "/site/v1/orders", { headers: { "idempotency-key": randomUUID() }, body: { quote_id: quoted.body.quotes[0].quote_id, passenger: { name: "汐见凉介", phone: "+81 90-7788-3311", email: "qa.shiomi@example.test" }, flight_no: "nh 211", dropoff_address: "东京站八重洲口", save_payment_method: true } });
    assert.equal(placed.status, 201, placed.text);
    const id = placed.body.order.id;
    await api.app.notificationJobs.tick();
    await endAt(api, id, tokyoDaysAgo(api, 300));
    await tick();
    assert.equal(await isDone(api, id), true);
    const tables = (await q("select table_name from information_schema.tables where table_schema = current_schema() and table_type = 'BASE TABLE' and table_name <> 'schema_migrations'")).rows.map((row: { table_name: string }) => row.table_name);
    const found: Record<string, string[]> = {};
    for (const table of tables) {
      const lines = (await q(`select t::text as line from ${table} t`)).rows as { line: string }[];
      const inTable = ["汐见", "凉介", "7788-3311", "77883311", "qa.shiomi"].filter((secret) => lines.some((row) => row.line.includes(secret)));
      if (inTable.length > 0) found[table] = inTable;
    }
    assert.deepEqual(found, {});
  } finally {
    await site.close();
  }
});

test("已入队未发的通知：脱敏后才到发送的那一条不发到占位上，不无限重试，占位地址不变", async () => {
  const smtp: FakeSmtp = await startFakeSmtp();
  const channelId = (await newChannel(api, m.staff.cm1.token, { name: `官网-${randomUUID().slice(0, 4)}` })).id;
  const client = await salesCredentials(api, m, channelId);
  const env = { SMTP_HOST: smtp.host, SMTP_PORT: String(smtp.port), SMTP_ENCRYPTION: "none", SMTP_USERNAME: "mailer", SMTP_PASSWORD: "fake-smtp-password-Qa9", SMTP_FROM_NAME: "NOZOMI", SMTP_FROM_ADDRESS: "noreply@example.test" };
  const site: SiteApi = await siteApi(api, client.clientId, pay, env, { integrationSecretsTtlMs: 0 });
  try {
    api.clock.advance(60_000);
    const quoted = await site.call("POST", "/site/v1/quotes", { body: { city_id: m.ids.tokyo, airport_id: m.ids.narita, direction: "pickup", address: { lng: 139.7, lat: 35.6 }, service_local: "2026-12-22T10:00", passengers: 2, luggage: 1, category: "airport_transfer" } });
    assert.equal(quoted.status, 200, quoted.text);
    api.clock.advance(1_000);
    const placed = await site.call("POST", "/site/v1/orders", { headers: { "idempotency-key": randomUUID() }, body: { quote_id: quoted.body.quotes[0].quote_id, passenger: { name: "雾岛千夏", phone: "+81 90-3344-5566", email: "qa.kirishima@example.test" }, flight_no: "nh 211", dropoff_address: "东京站八重洲口", save_payment_method: true } });
    assert.equal(placed.status, 201, placed.text);
    const id = placed.body.order.id;
    await site.app.notificationJobs.tick();
    await endAt(api, id, tokyoDaysAgo(api, 300));
    await tick();
    assert.equal(await isDone(api, id), true);
    const row = (await q("select tenant_id, order_no from orders where id = $1", [id])).rows[0];
    smtp.reset();
    // 脱敏事务提交之后才出现的一条（改单、代发）：直接摆进队列
    const notification = await insertGuestNotification(api, { id, orderNo: row.order_no, tenantId: row.tenant_id }, "pending", { recipient: ANONYMIZED_TEXT });
    await site.app.notificationJobs.tick();
    assert.equal(smtp.messages.length, 0, "不能发到占位地址");
    const after = (await q("select status, recipient, next_attempt_at, attempts from notifications where id = $1", [notification])).rows[0];
    assert.equal(after.recipient, ANONYMIZED_TEXT);
    assert.notEqual(after.status, "pending", "不能一直留在队列里");
    const retried = await api.call("POST", `/platform/v1/notifications/${notification}/retry`, { token: m.root, body: {} });
    assert.notEqual(retried.status, 500, retried.text);
    assert.equal(smtp.messages.length, 0, "手动重试也不能发到占位地址");
    const links = (await q("select count(*)::int as n from site_order_links where order_id = $1 and issued_via = 'email' and created_at >= $2", [id, api.clock.now()])).rows[0].n;
    assert.equal(links, 0, "没有发出去的通知不该留下新的查看链接");
  } finally {
    await site.close();
    await smtp.close();
  }
});

// 这条把时钟往后拨了一天（员工令牌会过期），放在最后
test("查看令牌：找回得到的链接至少有效 1 天——第 180 天找回、第 181 天脱敏后，链接不能再打开这张单", async () => {
  const channelId = (await newChannel(api, m.staff.cm1.token, { name: `官网-${randomUUID().slice(0, 4)}` })).id;
  const client = await salesCredentials(api, m, channelId);
  const site: SiteApi = await siteApi(api, client.clientId, pay);
  try {
    api.clock.advance(60_000);
    const quoted = await site.call("POST", "/site/v1/quotes", { body: { city_id: m.ids.tokyo, airport_id: m.ids.narita, direction: "pickup", address: { lng: 139.7, lat: 35.6 }, service_local: "2026-12-21T10:00", passengers: 2, luggage: 1, category: "airport_transfer" } });
    assert.equal(quoted.status, 200, quoted.text);
    api.clock.advance(1_000);
    const placed = await site.call("POST", "/site/v1/orders", { headers: { "idempotency-key": randomUUID() }, body: { quote_id: quoted.body.quotes[0].quote_id, passenger: { name: "汐见凉介", phone: "+81 90-7788-3322", email: "qa.shiomi2@example.test" }, flight_no: "nh 211", dropoff_address: "东京站八重洲口", save_payment_method: true } });
    assert.equal(placed.status, 201, placed.text);
    const id = placed.body.order.id;
    const orderNo = placed.body.order.order_no;
    await endAt(api, id, tokyoDaysAgo(api, 180));
    await tick();
    assert.equal(await isDone(api, id), false, "第 180 天还不动");
    // 第 180 天客人在「查订单」申请了链接（ADR 0061：通知中心发信时新签发；这里直接按同一个规则签一条，不经邮件）
    const issued = newSiteLink(api.clock.now(), api.clock.now());
    await api.db.owner.query("insert into site_order_links (order_id, token_hash, issued_via, created_at, expires_at) values ($1, $2, 'email', $3, $4)", [id, issued.tokenHash, api.clock.now(), issued.expiresAt]);
    const token = issued.token;
    assert.equal((await site.call("GET", "/site/v1/order", { token })).status, 200, `orderNo ${orderNo}：脱敏前链接能用`);
    await api.db.owner.query("update orders set messaging = $2::jsonb where id = $1", [id, JSON.stringify({ app: "line", handle: "qa-shiomi-line" })]);
    api.clock.advance(DAY - 60_000 - 1_000);
    const nextDayMidnight = tokyoDaysAgo(api, 0, "00:00:30");
    api.clock.advance(Math.max(0, nextDayMidnight.getTime() - api.clock.now().getTime()));
    await tick();
    if (!(await isDone(api, id))) {
      await endAt(api, id, tokyoDaysAgo(api, 181));
      await tick();
    }
    assert.equal(await isDone(api, id), true);
    const view = await site.call("GET", "/site/v1/order", { token });
    assert.ok(view.status === 401 || view.status === 404, `ADR 0055 写「查看链接脱敏时早已失效」；实际状态 ${view.status}：${view.text.slice(0, 300)}`);
  } finally {
    await site.close();
  }
});
