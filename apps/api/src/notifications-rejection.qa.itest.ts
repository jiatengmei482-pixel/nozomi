/**
 * QA（M4-16，ADR 0049）：通知中心里拒收的次数和原文。开发的 notifications.itest.ts 测了 MESSAGE_REJECTED 走完 3 次、其他代码的第 1 次；
 * 这里补 SENDER_REJECTED 走完 3 次、TEMPORARILY_REJECTED 走完 6 次、和配置错误交替时的计数、手动重试后的计数、各阶段原文不进库和日志。
 * 连真实的 PostgreSQL 和本机假 SMTP，从不连真实的邮件服务；数据都在测试里现造。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { type TestApi, createTestApi } from "./testing/api.ts";
import { type FakeSmtp, startFakeSmtp } from "./testing/fake-integrations.ts";
import { type Market, buildMarket, newChannel, salesCredentials } from "./testing/market.ts";
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

const HOUR = 3_600_000;
const GUEST_EMAIL = "qa.rejection.guest@example.com";

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let smtp: FakeSmtp;
let site: SiteApi;
let serviceClock = 0;
const logLines: string[] = [];

before(async () => {
  pay = new FakePaymentProvider();
  smtp = await startFakeSmtp();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  const channelId = (await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" })).id;
  const client = await salesCredentials(api, m, channelId);
  const smtpEnv = { SMTP_HOST: smtp.host, SMTP_PORT: String(smtp.port), SMTP_ENCRYPTION: "none", SMTP_USERNAME: "qa-mailer", SMTP_PASSWORD: "fake-smtp-password-Qr9", SMTP_FROM_NAME: "NOZOMI", SMTP_FROM_ADDRESS: "noreply@example.test" };
  const logDestination = new Writable({
    write(chunk, _encoding, done) {
      logLines.push(String(chunk));
      done();
    },
  });
  site = await siteApi(api, client.clientId, pay, smtpEnv, { logDestination, integrationSecretsTtlMs: 0 });
});

after(async () => {
  await site?.close();
  await smtp?.close();
  await api.close();
});

beforeEach(async () => {
  await api.db.owner.query("update notification_events set expanded_at = coalesce(expanded_at, now())");
  await api.db.owner.query("update notifications set status = 'expired', last_error_code = 'ORDER_STATE_CHANGED', lease_token = null, lease_until = null where status in ('pending', 'sending')");
  await api.db.owner.query("update tenant_notification_settings set quiet_start = null, quiet_end = null");
  smtp.reset();
});

async function paidOrder(): Promise<string> {
  serviceClock += 1;
  const at = new Date(api.clock.now().getTime() + 10 * 24 * HOUR + serviceClock * HOUR);
  const local = new Date(at.getTime() + 9 * HOUR).toISOString().slice(0, 16);
  const ip = `198.51.100.${(serviceClock % 200) + 1}`;
  api.clock.advance(1_000);
  const quotes = await site.call("POST", "/site/v1/quotes", { ip, body: { category: "airport_transfer", city_id: m.ids.tokyo, airport_id: m.ids.narita, direction: "pickup", address: { lng: 139.7, lat: 35.6 }, service_local: local, passengers: 2, luggage: 1 } });
  assert.equal(quotes.status, 200, quotes.text);
  const quote = quotes.body.quotes.find((row: any) => row.vehicle_group.id === m.ids.biz7);
  assert.ok(quote, quotes.text);
  api.clock.advance(1_000);
  const res = await site.call("POST", "/site/v1/orders", { ip, headers: { "idempotency-key": randomUUID() }, body: { quote_id: quote.quote_id, passenger: { name: "虚构客人", phone: "+81 90-0000-0000", email: GUEST_EMAIL }, flight_no: "NH211", dropoff_address: "虚构地址一丁目", save_payment_method: true } });
  assert.equal(res.status, 201, res.text);
  const orderId: string = res.body.order.id;
  const intent = pay.intentOf(orderId);
  assert.ok(intent);
  pay.pay(intent.id);
  const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
  const paid = await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()));
  assert.equal(paid.status, 200, JSON.stringify(paid.body));
  return orderId;
}

const guestRow = async (orderId: string): Promise<any> => (await api.db.owner.query("select * from notifications where order_id = $1 and audience = 'guest' and event = 'order.confirmed'", [orderId])).rows[0];
const makeDue = (id: string): Promise<unknown> => api.db.owner.query("update notifications set next_attempt_at = $2 where id = $1", [id, api.clock.now()]);
const waitOf = (row: any): number => (new Date(row.next_attempt_at).getTime() - api.clock.now().getTime()) / 1000;

/** 让任务再发一次并返回这条记录。 */
async function tick(orderId: string): Promise<any> {
  const before = await guestRow(orderId);
  if (before !== undefined) await makeDue(before.id);
  await site.app.notificationJobs.tick();
  return guestRow(orderId);
}

test("SENDER_REJECTED：共 3 次（5 分钟、30 分钟后各一次），第 3 次最终失败并写错误日志", async () => {
  const orderId = await paidOrder();
  smtp.behave({ rejectAt: { stage: "MAIL", reply: "550 5.7.1 not allowed" } });
  let row = await tick(orderId);
  assert.deepEqual([row.status, row.attempts, row.last_error_code, waitOf(row)], ["pending", 1, "SENDER_REJECTED", 300]);
  row = await tick(orderId);
  assert.deepEqual([row.status, row.attempts, waitOf(row)], ["pending", 2, 1800]);
  const mark = logLines.length;
  row = await tick(orderId);
  assert.deepEqual([row.status, row.attempts, row.last_error_code], ["failed", 3, "SENDER_REJECTED"]);
  assert.ok(logLines.slice(mark).join("").includes("notification.failed"));
});

test("TEMPORARILY_REJECTED：共 6 次（1 分钟、5 分钟、30 分钟、2 小时、6 小时后），第 6 次最终失败；中途好了就发出去", async () => {
  const orderId = await paidOrder();
  smtp.behave({ rejectAt: { stage: "RCPT", reply: "451 4.7.1 later" } });
  let row: any;
  const waits = [60, 300, 1800, 7200, 21600];
  for (const [index, wait] of waits.entries()) {
    row = await tick(orderId);
    assert.deepEqual([row.status, row.attempts, row.last_error_code, waitOf(row)], ["pending", index + 1, "TEMPORARILY_REJECTED", wait]);
  }
  row = await tick(orderId);
  assert.deepEqual([row.status, row.attempts, row.last_error_code], ["failed", 6, "TEMPORARILY_REJECTED"]);

  const recovering = await paidOrder();
  smtp.behave({ rejectAt: { stage: "MAIL", reply: "421 4.3.2 busy" } });
  await tick(recovering);
  smtp.reset();
  row = await tick(recovering);
  assert.deepEqual([row.status, row.attempts], ["sent", 2]);
});

test("配置错误不消耗次数：MESSAGE_REJECTED 中间夹认证失败，还是共 3 次；认证失败期间次数不动，隔 5 分钟", async () => {
  const orderId = await paidOrder();
  smtp.behave({ rejectAt: { stage: "DOT", reply: "554 5.7.1 rejected" } });
  let row = await tick(orderId);
  assert.deepEqual([row.status, row.attempts, row.last_error_code], ["pending", 1, "MESSAGE_REJECTED"]);
  smtp.reset();
  smtp.behave({ rejectAuth: true });
  for (let turn = 0; turn < 3; turn += 1) {
    row = await tick(orderId);
    assert.deepEqual([row.status, row.attempts, row.last_error_code, waitOf(row)], ["pending", 1, "AUTH_FAILED", 300]);
  }
  smtp.reset();
  smtp.behave({ rejectAt: { stage: "DOT", reply: "554 5.7.1 rejected" } });
  row = await tick(orderId);
  assert.deepEqual([row.status, row.attempts, waitOf(row)], ["pending", 2, 1800]);
  row = await tick(orderId);
  assert.deepEqual([row.status, row.attempts], ["failed", 3]);
});

test("手动重试：最终失败的 MESSAGE_REJECTED 再被拒，回到失败、次数加一、不排自动重试、还能再重试；服务器好了能发出去", async () => {
  const orderId = await paidOrder();
  smtp.behave({ rejectAt: { stage: "DOT", reply: "554 5.7.1 rejected" } });
  await tick(orderId);
  await tick(orderId);
  const final = await tick(orderId);
  assert.deepEqual([final.status, final.attempts], ["failed", 3]);

  const again = await site.call("POST", `/platform/v1/notifications/${final.id}/retry`, { token: m.staff.operations.token });
  assert.equal(again.status, 200, again.text);
  assert.deepEqual([again.body.notification.status, again.body.notification.attempts, again.body.notification.retryable], ["failed", 4, true]);
  await site.app.notificationJobs.tick();
  assert.equal((await guestRow(orderId)).attempts, 4, "最终失败之后任务不再自动发");

  smtp.reset();
  const sent = await site.call("POST", `/platform/v1/notifications/${final.id}/retry`, { token: m.staff.operations.token });
  assert.deepEqual([sent.body.notification.status, sent.body.notification.attempts], ["sent", 5]);
  assert.equal(smtp.messages.filter((message) => message.to.includes(GUEST_EMAIL)).length, 1);
});

test("手动重试时遇到暂时拒绝：也回到失败，不转成自动重试", async () => {
  const orderId = await paidOrder();
  smtp.behave({ rejectAt: { stage: "RCPT", reply: "550 5.1.1 no such user" } });
  const final = await tick(orderId);
  assert.deepEqual([final.status, final.attempts], ["failed", 1]);
  smtp.reset();
  smtp.behave({ rejectAt: { stage: "RCPT", reply: "450 4.2.1 later" } });
  const again = await site.call("POST", `/platform/v1/notifications/${final.id}/retry`, { token: m.staff.operations.token });
  assert.deepEqual([again.body.notification.status, again.body.notification.attempts, again.body.notification.last_error.code], ["failed", 2, "TEMPORARILY_REJECTED"]);
});

test("RECIPIENT_REJECTED 不重试：只发过一次，之后的任务不再碰", async () => {
  const orderId = await paidOrder();
  smtp.behave({ rejectAt: { stage: "RCPT", reply: "550 no such user" } });
  const row = await tick(orderId);
  assert.deepEqual([row.status, row.attempts, row.last_error_code], ["failed", 1, "RECIPIENT_REJECTED"]);
  await makeDue(row.id);
  await site.app.notificationJobs.tick();
  assert.equal((await guestRow(orderId)).attempts, 1);
});

test("各阶段服务器原文（带收件人和账号）不进库、日志、记录接口；库和接口里只有代码和我们写的中文", async () => {
  const echo = `qa-said-no-to-${GUEST_EMAIL}-account-qa-mailer`;
  const cases: [Parameters<FakeSmtp["behave"]>[0], string][] = [
    [{ rejectAt: { stage: "MAIL", reply: "550 5.7.1 refused" }, errorDetail: echo }, "SENDER_REJECTED"],
    [{ rejectAt: { stage: "MAIL", reply: "451 4.3.2 later" }, errorDetail: echo }, "TEMPORARILY_REJECTED"],
    [{ rejectAt: { stage: "RCPT", reply: "550 5.1.1 refused" }, errorDetail: echo }, "RECIPIENT_REJECTED"],
    [{ rejectAt: { stage: "RCPT", reply: "553 5.7.1 refused" }, errorDetail: echo }, "MESSAGE_REJECTED"],
    [{ rejectAt: { stage: "DATA", reply: "554 refused" }, errorDetail: echo }, "MESSAGE_REJECTED"],
    [{ rejectAt: { stage: "DATA", reply: "450 later" }, errorDetail: echo }, "TEMPORARILY_REJECTED"],
  ];
  for (const [behavior, code] of cases) {
    const orderId = await paidOrder();
    smtp.reset();
    smtp.behave(behavior);
    const row = await tick(orderId);
    assert.equal(row.last_error_code, code, JSON.stringify(behavior));
    assert.match(row.last_error_message, /[一-鿿]/);
    assert.ok(!row.last_error_message.includes(GUEST_EMAIL));
    const listed = await site.call("GET", `/platform/v1/notifications?order_id=${orderId}&audience=guest`, { token: m.staff.operations.token });
    assert.ok(!listed.text.includes(echo));
  }
  const dump = JSON.stringify([(await api.db.owner.query("select * from notifications")).rows, (await api.db.owner.query("select * from audit_logs")).rows]);
  assert.ok(!dump.includes(echo), "服务器原文进了库");
  assert.ok(!logLines.join("").includes(echo), "服务器原文进了日志");
  assert.ok(!logLines.join("").includes(GUEST_EMAIL), "收件人地址进了日志");
});
