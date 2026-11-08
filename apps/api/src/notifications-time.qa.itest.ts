/**
 * QA（M4-08，ADR 0049）：通知中心的时间：免打扰跨午夜（开始、结束边界，到点补发，不丢）、紧急判断、用车前 24 小时提醒（边界、跨午夜跨月、改时间后旧提醒不发、重新排）。
 * 真实 PostgreSQL + 本机假 SMTP，时钟由测试推进；数据都在测试里构造、都是虚构的，随测试 schema 一起删除。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type TestApi, createTestApi } from "./testing/api.ts";
import { seedOrder } from "./testing/dispatch.ts";
import { type FakeSmtp, type FakeSmtpMessage, decodedMailText, startFakeSmtp } from "./testing/fake-integrations.ts";
import { type Market, buildMarket, newChannel, salesCredentials } from "./testing/market.ts";
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const GUEST_EMAIL = "guest.time@example.com";
const TOKYO_OFFSET = 9 * HOUR;

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let smtp: FakeSmtp;
let site: SiteApi;
let clock = 0;

before(async () => {
  pay = new FakePaymentProvider();
  smtp = await startFakeSmtp();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  const channelId = (await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" })).id;
  const client = await salesCredentials(api, m, channelId);
  site = await siteApi(api, client.clientId, pay, { SMTP_HOST: smtp.host, SMTP_PORT: String(smtp.port), SMTP_ENCRYPTION: "none", SMTP_USERNAME: "mailer", SMTP_PASSWORD: "fake-smtp-password-Qa7", SMTP_FROM_NAME: "NOZOMI", SMTP_FROM_ADDRESS: "noreply@example.test" }, { integrationSecretsTtlMs: 0 });
});

after(async () => {
  await site?.close();
  await smtp?.close();
  await api.close();
});

beforeEach(async () => {
  await api.db.owner.query("update notification_events set expanded_at = coalesce(expanded_at, now())");
  await api.db.owner.query("update notifications set status = 'expired', last_error_code = 'ORDER_STATE_CHANGED', lease_token = null, lease_until = null where status in ('pending', 'sending')");
  await api.db.owner.query("delete from tenant_notification_settings");
  smtp.reset();
});

/** 把时钟往后拨到下一个东京时间 `HH:mm:00`。 */
function advanceToTokyo(time: string): Date {
  const [hour, minute] = time.split(":").map(Number) as [number, number];
  const now = api.clock.now().getTime();
  const local = now + TOKYO_OFFSET;
  const midnight = local - (local % DAY);
  let target = midnight + hour * HOUR + minute * MINUTE - TOKYO_OFFSET;
  if (target <= now) target += DAY;
  api.clock.advance(target - now);
  return api.clock.now();
}

const quiet = (tenantId: string, start: string, end: string): Promise<unknown> => api.db.owner.query("insert into tenant_notification_settings (tenant_id, quiet_start, quiet_end, updated_at) values ($1, $2, $3, now())", [tenantId, start, end]);
const insertEvent = (tenantId: string | null, event: string, orderId: string | null, data: Record<string, unknown> = {}): Promise<unknown> =>
  api.db.owner.query("insert into notification_events (tenant_id, event, order_id, dedupe_key, data, occurred_at) values ($1, $2, $3, $4, $5, $6)", [tenantId, event, orderId, `qa-${randomUUID()}`, JSON.stringify(data), api.clock.now()]);
const rowsOf = async (orderId: string): Promise<any[]> => (await api.db.owner.query("select * from notifications where order_id = $1 order by created_at, recipient", [orderId])).rows;
const tick = (): Promise<unknown> => site.app.notificationJobs.tick();

/** 邮件的纯文字正文（M6-06 起邮件同时有 HTML 版，取纯文字那一部分）。 */
const bodyOf = (message: FakeSmtpMessage): string => decodedMailText(message.data);

const mailsFor = (orderNo: string): FakeSmtpMessage[] => smtp.messages.filter((message) => bodyOf(message).includes(orderNo));

// ---- 免打扰：到点补发 ----

test("免打扰 22:00–07:00 跨午夜：21:59 照发；22:00 整开始推迟；06:59:59 还不发；07:00 整补发，不算次数，只发一封", async () => {
  await quiet(m.a.tenantId, "22:00", "07:00");
  advanceToTokyo("21:59");
  const before = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 5 * DAY) });
  await insertEvent(m.a.tenantId, "order.rescue_assigned", before.id);
  await tick();
  assert.equal(mailsFor(before.orderNo).length, 1, "21:59 还不在时段里");

  advanceToTokyo("22:00");
  const held = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 5 * DAY) });
  await insertEvent(m.a.tenantId, "order.rescue_assigned", held.id);
  await tick();
  const row = (await rowsOf(held.id))[0];
  assert.deepEqual([row.status, row.attempts, row.last_error_code], ["pending", 0, "QUIET_HOURS"]);
  const resume = new Date(api.clock.now().getTime() + 9 * HOUR);
  assert.equal(new Date(row.next_attempt_at).getTime(), resume.getTime());

  api.clock.advance(9 * HOUR - 1_000);
  await tick();
  assert.equal(mailsFor(held.orderNo).length, 0, "06:59:59 还不能发");
  api.clock.advance(1_000);
  await tick();
  await tick();
  assert.equal(mailsFor(held.orderNo).length, 1, "07:00 整要补发，且只发一封");
  const sent = (await rowsOf(held.id))[0];
  assert.deepEqual([sent.status, sent.attempts, sent.last_error_code], ["sent", 1, null]);
});

test("到点补发前对方又落进新的免打扰（改了时段）：继续等，不丢", async () => {
  await quiet(m.a.tenantId, "22:00", "07:00");
  advanceToTokyo("23:00");
  const held = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 5 * DAY) });
  await insertEvent(m.a.tenantId, "order.rescue_assigned", held.id);
  await tick();
  await api.db.owner.query("update tenant_notification_settings set quiet_end = '09:00' where tenant_id = $1", [m.a.tenantId]);
  advanceToTokyo("07:00");
  await tick();
  assert.equal(mailsFor(held.orderNo).length, 0);
  assert.equal((await rowsOf(held.id))[0].attempts, 0);
  advanceToTokyo("09:00");
  await tick();
  assert.equal(mailsFor(held.orderNo).length, 1);
});

test("时段里积压的通知：没有订单的（资质）也不丢；时段结束时只发一封；发给平台员工的不受限", async () => {
  await quiet(m.a.tenantId, "22:00", "07:00");
  advanceToTokyo("23:30");
  await insertEvent(m.a.tenantId, "tenant.document_expiring", null, { document_type: "vehicle_insurance", expires_on: "2099-01-01", days_left: 7 });
  await insertEvent(null, "fx.alert", null, { kind: "held", currencies: ["USD"] });
  await tick();
  assert.ok(smtp.messages.some((message) => bodyOf(message).includes("汇率变动")), "平台员工的告警不受供应商的免打扰影响");
  assert.ok(!smtp.messages.some((message) => bodyOf(message).includes("将在 2099-01-01 到期")), "资质提醒要等");
  advanceToTokyo("07:00");
  await tick();
  assert.equal(smtp.messages.filter((message) => message.to.includes(m.a.adminEmail) && bodyOf(message).includes("将在 2099-01-01 到期")).length, 1);
});

test("用车当天按城市当地日期：东京午夜一过就紧急；曼谷的单在东京 00:30 还是前一天，要等", async () => {
  await quiet(m.a.tenantId, "22:00", "07:00");
  advanceToTokyo("00:30");
  const today = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 8 * HOUR) });
  await insertEvent(m.a.tenantId, "order.rescue_assigned", today.id);
  await tick();
  assert.equal(mailsFor(today.orderNo).length, 1, "东京当天的单不受限");

  const bangkok = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 30 * HOUR) });
  const tokyoDate = new Date(api.clock.now().getTime() + TOKYO_OFFSET).toISOString().slice(0, 10);
  await api.db.owner.query("update orders set timezone = 'Asia/Bangkok', service_date = $2 where id = $1", [bangkok.id, tokyoDate]);
  await insertEvent(m.a.tenantId, "order.rescue_assigned", bangkok.id);
  await tick();
  assert.equal(mailsFor(bangkok.orderNo).length, 0, "曼谷现在还是前一天 22:30，用车日是当地的明天");
  assert.equal((await rowsOf(bangkok.id))[0].last_error_code, "QUIET_HOURS");
});

// ---- 免打扰：不该丢、不该晚 ----

for (const [event, label, serviceAtTokyo, nowAtTokyo, status] of [
  ["order.confirmed", "新订单", "06:00", "23:00", "confirmed"],
  ["order.rescue_assigned", "救援新订单", "06:00", "23:00", "confirmed"],
  ["order.departure_overdue", "司机未出发提醒", "00:30", "23:45", "assigned"],
] as const) {
  test(`缺陷：免打扰跨午夜时，次日凌晨用车的「${label}」不应该因为日期还没到而被推迟到过期、最终丢失`, async () => {
    await quiet(m.a.tenantId, "22:00", "07:00");
    advanceToTokyo(nowAtTokyo);
    const [hour, minute] = serviceAtTokyo.split(":").map(Number) as [number, number];
    const nowLocal = api.clock.now().getTime() + TOKYO_OFFSET;
    const nextMidnightLocal = nowLocal - (nowLocal % DAY) + DAY;
    const serviceAt = new Date(nextMidnightLocal + hour * HOUR + minute * MINUTE - TOKYO_OFFSET);
    const order = await seedOrder(api, m, "a", { serviceAt, status });
    await insertEvent(m.a.tenantId, event, order.id);
    await tick();
    api.clock.advance(serviceAt.getTime() - api.clock.now().getTime());
    await tick();
    advanceToTokyo("07:00");
    await tick();
    const rows = await rowsOf(order.id);
    assert.equal(mailsFor(order.orderNo).length, rows.length, `用车前 ${Math.round((serviceAt.getTime() - nowLocal + TOKYO_OFFSET) / MINUTE)} 分钟的通知没有发出：${JSON.stringify(rows.map((row) => [row.status, row.last_error_code]))}`);
  });
}

test("缺陷：免打扰跨午夜时，次日凌晨用车的单被取消：取消邮件不应该等到用车时间之后才发（司机白跑）", async () => {
  await quiet(m.a.tenantId, "22:00", "07:00");
  advanceToTokyo("23:00");
  const serviceAt = new Date(api.clock.now().getTime() + 7 * HOUR);
  const order = await seedOrder(api, m, "a", { serviceAt, status: "assigned" });
  await api.db.owner.query("update orders set status = 'cancelled', cancelled_at = $2, cancel_reason = 'GUEST_REQUEST' where id = $1", [order.id, api.clock.now()]);
  await insertEvent(m.a.tenantId, "order.cancelled", order.id);
  await tick();
  api.clock.advance(serviceAt.getTime() - api.clock.now().getTime() - 1);
  await tick();
  assert.equal(mailsFor(order.orderNo).length, (await rowsOf(order.id)).length, "用车时间到了，供应商还不知道这张单已取消");
});

test("缺陷：改期待确认只有 30 分钟：免打扰不应该把提醒推迟到确认期限之后", async () => {
  await quiet(m.a.tenantId, "22:00", "07:00");
  advanceToTokyo("23:00");
  const order = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 20 * HOUR) });
  const confirmDue = new Date(api.clock.now().getTime() + 30 * MINUTE);
  await insertEvent(m.a.tenantId, "order.change_pending", order.id, { confirm_due_at: confirmDue.toISOString() });
  await tick();
  api.clock.advance(confirmDue.getTime() - api.clock.now().getTime() - 1);
  await tick();
  assert.equal(mailsFor(order.orderNo).length, (await rowsOf(order.id)).length, "30 分钟确认期内供应商没有收到任何通知，改期会因超时自动失败");
});

test("缺陷：过了确认期限的「改期待确认」不应该再发（发了就是让人去确认一件已经结束的事）", async () => {
  const order = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 5 * DAY) });
  await insertEvent(m.a.tenantId, "order.change_pending", order.id, { confirm_due_at: new Date(api.clock.now().getTime() - MINUTE).toISOString() });
  await tick();
  assert.equal(mailsFor(order.orderNo).length, 0, "提醒里写的确认期限已经过了");
});

// ---- 用车前 24 小时提醒 ----

async function paidSiteOrder(): Promise<{ orderId: string; orderNo: string; token: string }> {
  clock += 1;
  api.clock.advance(1_000);
  const at = new Date(api.clock.now().getTime() + 10 * DAY + clock * HOUR);
  const ip = `198.51.100.${(clock % 200) + 1}`;
  const quotes = await site.call("POST", "/site/v1/quotes", { ip, body: { category: "airport_transfer", city_id: m.ids.tokyo, airport_id: m.ids.narita, direction: "pickup", address: { lng: 139.7, lat: 35.6 }, service_local: new Date(at.getTime() + TOKYO_OFFSET).toISOString().slice(0, 16), passengers: 2, luggage: 1 } });
  assert.equal(quotes.status, 200, quotes.text);
  const quote = quotes.body.quotes.find((row: any) => row.vehicle_group.id === m.ids.biz7);
  assert.ok(quote, quotes.text);
  api.clock.advance(1_000);
  const placed = await site.call("POST", "/site/v1/orders", { ip, headers: { "idempotency-key": randomUUID() }, body: { quote_id: quote.quote_id, passenger: { name: "虚构的客人", phone: "+81 90-0000-0000", email: GUEST_EMAIL }, flight_no: "NH211", dropoff_address: "东京站八重洲口", save_payment_method: true } });
  assert.equal(placed.status, 201, placed.text);
  const orderId = placed.body.order.id as string;
  const intent = pay.intentOf(orderId);
  assert.ok(intent);
  pay.pay(intent.id);
  const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
  assert.equal((await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()))).status, 200);
  await tick();
  smtp.reset();
  return { orderId, orderNo: placed.body.order.order_no, token: placed.body.link.token };
}

/** 直接把用车时间改到 `at`（东京当地）；下单时间放到足够早，不触发「下单时已不足 24 小时」。 */
async function setService(orderId: string, at: Date, confirmedAt: Date | null = new Date(at.getTime() - 30 * DAY)): Promise<void> {
  const local = new Date(at.getTime() + TOKYO_OFFSET).toISOString().slice(0, 16);
  await api.db.owner.query("update orders set service_at = $2, service_local = $3, service_date = $4, confirmed_at = coalesce($5, confirmed_at) where id = $1", [orderId, at, local, local.slice(0, 10), confirmedAt]);
}

const reminders = async (orderId: string): Promise<any[]> => (await rowsOf(orderId)).filter((row) => row.event === "order.service_reminder");
const reminderEvents = async (orderId: string): Promise<number> => (await api.db.owner.query("select 1 from notification_events where order_id = $1 and event = 'order.service_reminder'", [orderId])).rowCount ?? 0;

test("24 小时提醒的精确边界：离用车 24 小时 + 1 毫秒不扫，正好 24 小时扫到；用车时间已到不扫", async () => {
  const order = await paidSiteOrder();
  await setService(order.orderId, new Date(api.clock.now().getTime() + DAY + 1));
  await site.app.notificationJobs.sweepReminders();
  assert.equal(await reminderEvents(order.orderId), 0, "24 小时 + 1 毫秒还不到");
  api.clock.advance(1);
  await site.app.notificationJobs.sweepReminders();
  assert.equal(await reminderEvents(order.orderId), 1, "正好 24 小时要扫到");

  const past = await paidSiteOrder();
  await setService(past.orderId, api.clock.now());
  await site.app.notificationJobs.sweepReminders();
  assert.equal(await reminderEvents(past.orderId), 0, "用车时间已到不再提醒");
});

test("「下单时已不足 24 小时不发」的边界：确认时离用车正好 24 小时要发，差 1 毫秒不发", async () => {
  const exact = await paidSiteOrder();
  const at = new Date(api.clock.now().getTime() + 20 * HOUR);
  await setService(exact.orderId, at, new Date(at.getTime() - DAY));
  await site.app.notificationJobs.sweepReminders();
  assert.equal(await reminderEvents(exact.orderId), 1);
  const late = await paidSiteOrder();
  const at2 = new Date(api.clock.now().getTime() + 20 * HOUR);
  await setService(late.orderId, at2, new Date(at2.getTime() - DAY + 1));
  await site.app.notificationJobs.sweepReminders();
  assert.equal(await reminderEvents(late.orderId), 0);
});

test("提醒跨午夜、跨月：邮件里写东京当地的日期和时间，不是 UTC", async () => {
  const order = await paidSiteOrder();
  advanceToTokyo("23:30");
  const at = new Date(api.clock.now().getTime() + 40 * MINUTE);
  await setService(order.orderId, at);
  await site.app.notificationJobs.sweepReminders();
  await tick();
  const mail = smtp.messages.find((message) => message.to.includes(GUEST_EMAIL));
  assert.ok(mail, "提醒没发");
  const local = new Date(at.getTime() + TOKYO_OFFSET).toISOString().slice(0, 16).replace("T", " ");
  assert.ok(local.endsWith("00:10"));
  assert.ok(bodyOf(mail).includes(`用车时间：${local}（当地时间）`), bodyOf(mail));
});

test("改了时间：还没发的旧提醒不发（ORDER_STATE_CHANGED），新的时间重新排；新时间不到 24 小时窗口之前不提醒", async () => {
  const order = await paidSiteOrder();
  const first = new Date(api.clock.now().getTime() + 20 * HOUR);
  await setService(order.orderId, first);
  await site.app.notificationJobs.sweepReminders();
  await site.app.notificationJobs.expandEvents(api.clock.now());
  const old = (await reminders(order.orderId))[0];
  assert.equal(old.status, "pending");

  const moved = new Date(first.getTime() + 3 * DAY);
  await setService(order.orderId, moved);
  await tick();
  const expired = (await reminders(order.orderId))[0];
  assert.deepEqual([expired.status, expired.last_error_code], ["expired", "ORDER_STATE_CHANGED"]);
  assert.equal(smtp.messages.filter((message) => message.to.includes(GUEST_EMAIL)).length, 0);
  await site.app.notificationJobs.sweepReminders();
  assert.equal(await reminderEvents(order.orderId), 1, "新时间还没进 24 小时窗口");

  api.clock.advance(moved.getTime() - DAY - api.clock.now().getTime());
  await site.app.notificationJobs.sweepReminders();
  await tick();
  const mail = smtp.messages.filter((message) => message.to.includes(GUEST_EMAIL));
  assert.equal(mail.length, 1, "新时间的提醒只发一封");
  const local = new Date(moved.getTime() + TOKYO_OFFSET).toISOString().slice(0, 16).replace("T", " ");
  assert.ok(bodyOf(mail[0] as FakeSmtpMessage).includes(local), "邮件写的是新时间");
});

test("缺陷：改时间又改回原来的时间：旧提醒已作废的话，原时间应该重新提醒（去重键相同就永远不再提醒）", async () => {
  const order = await paidSiteOrder();
  const original = new Date(api.clock.now().getTime() + 20 * HOUR);
  await setService(order.orderId, original);
  await site.app.notificationJobs.sweepReminders();
  await site.app.notificationJobs.expandEvents(api.clock.now());
  await setService(order.orderId, new Date(original.getTime() + 2 * DAY));
  await tick();
  assert.equal((await reminders(order.orderId))[0].last_error_code, "ORDER_STATE_CHANGED");
  await setService(order.orderId, original);
  await site.app.notificationJobs.sweepReminders();
  await tick();
  assert.equal(smtp.messages.filter((message) => message.to.includes(GUEST_EMAIL)).length, 1, "客人改回原时间后再也收不到提醒");
});

test("取消后、已出发后不再提醒；重复扫只有一条事件", async () => {
  const order = await paidSiteOrder();
  await setService(order.orderId, new Date(api.clock.now().getTime() + 20 * HOUR));
  await api.db.owner.query("update orders set status = 'departed' where id = $1", [order.orderId]);
  await site.app.notificationJobs.sweepReminders();
  assert.equal(await reminderEvents(order.orderId), 0, "已经出发了不提醒");
  await api.db.owner.query("update orders set status = 'confirmed' where id = $1", [order.orderId]);
  await Promise.all([site.app.notificationJobs.sweepReminders(), site.app.notificationJobs.sweepReminders()]);
  await site.app.notificationJobs.sweepReminders();
  assert.equal(await reminderEvents(order.orderId), 1);
});
