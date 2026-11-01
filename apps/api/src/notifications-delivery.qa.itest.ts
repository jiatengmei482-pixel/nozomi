/**
 * QA（M4-08，ADR 0049）：通知中心发送的可靠性和内容，开发的 notifications.itest.ts 没有覆盖的部分。
 * 多进程（两个应用实例同一个库）、租约、崩溃、手动重试并发、退避的精确边界、配置问题不空转、发件箱写入失败、发送前复查、规则 4 逐个模板、金额、注入。
 * 连真实 PostgreSQL 和本机假 SMTP，从不连真实的邮件服务；数据都在测试里构造、都是虚构的，随测试 schema 一起删除。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { withPlatformTx } from "./db/context.ts";
import { NOTIFICATION_LEASE_MS } from "./services/notification-jobs.ts";
import { claimDueNotifications } from "./repos/notifications.ts";
import { type TestApi, TEST_PASSWORD, createTestApi } from "./testing/api.ts";
import { assign, newDriver, newVehicle, seedOrder } from "./testing/dispatch.ts";
import { type FakeSmtp, type FakeSmtpMessage, startFakeSmtp } from "./testing/fake-integrations.ts";
import { type Market, allKeys, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { tenantLogin } from "./testing/money.ts";
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

const HOUR = 3_600_000;
const GUEST_EMAIL = "guest.delivery@example.com";
const NO_SMTP = { SMTP_HOST: "", SMTP_PORT: "", SMTP_ENCRYPTION: "", SMTP_USERNAME: "", SMTP_PASSWORD: "", SMTP_FROM_NAME: "", SMTP_FROM_ADDRESS: "" };

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let smtp: FakeSmtp;
let site: SiteApi;
/** 同一个库上的第二个进程 */
let sibling: SiteApi;
let unconfigured: SiteApi;
let clock = 0;
const logLines: string[] = [];

before(async () => {
  pay = new FakePaymentProvider();
  smtp = await startFakeSmtp();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  const channelId = (await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" })).id;
  const client = await salesCredentials(api, m, channelId);
  const env = { SMTP_HOST: smtp.host, SMTP_PORT: String(smtp.port), SMTP_ENCRYPTION: "none", SMTP_USERNAME: "mailer", SMTP_PASSWORD: "fake-smtp-password-Qa9", SMTP_FROM_NAME: "NOZOMI", SMTP_FROM_ADDRESS: "noreply@example.test" };
  const logDestination = new Writable({
    write(chunk, _encoding, done) {
      logLines.push(String(chunk));
      done();
    },
  });
  site = await siteApi(api, client.clientId, pay, env, { logDestination, integrationSecretsTtlMs: 0 });
  sibling = await siteApi(api, client.clientId, pay, env, { integrationSecretsTtlMs: 0 });
  unconfigured = await siteApi(api, client.clientId, pay, NO_SMTP, { integrationSecretsTtlMs: 0 });
});

after(async () => {
  await unconfigured?.close();
  await sibling?.close();
  await site?.close();
  await smtp?.close();
  await api.close();
});

beforeEach(async () => {
  await api.db.owner.query("update notification_events set expanded_at = coalesce(expanded_at, now())");
  await api.db.owner.query("update notifications set status = 'expired', last_error_code = 'ORDER_STATE_CHANGED', lease_token = null, lease_until = null where status in ('pending', 'sending')");
  await api.db.owner.query("delete from tenant_notification_settings");
  smtp.reset();
  logLines.length = 0;
});

interface Placed {
  orderId: string;
  orderNo: string;
  token: string;
  tenantId: string;
}

async function placeOrder(overrides: { passenger?: Record<string, string>; dropoff_address?: string; notes?: string } = {}): Promise<{ status: number; text: string; order: Placed | null }> {
  clock += 1;
  api.clock.advance(1_000);
  const at = new Date(api.clock.now().getTime() + 10 * 24 * HOUR + clock * HOUR);
  const ip = `198.51.100.${(clock % 200) + 1}`;
  const quotes = await site.call("POST", "/site/v1/quotes", { ip, body: { category: "airport_transfer", city_id: m.ids.tokyo, airport_id: m.ids.narita, direction: "pickup", address: { lng: 139.7, lat: 35.6 }, service_local: new Date(at.getTime() + 9 * HOUR).toISOString().slice(0, 16), passengers: 2, luggage: 1 } });
  assert.equal(quotes.status, 200, quotes.text);
  const quote = quotes.body.quotes.find((row: any) => row.vehicle_group.id === m.ids.biz7);
  assert.ok(quote, quotes.text);
  api.clock.advance(1_000);
  const res = await site.call("POST", "/site/v1/orders", { ip, headers: { "idempotency-key": randomUUID() }, body: { quote_id: quote.quote_id, passenger: { name: "虚构的客人", phone: "+81 90-0000-0000", email: GUEST_EMAIL, ...overrides.passenger }, flight_no: "NH211", dropoff_address: overrides.dropoff_address ?? "东京站八重洲口", ...(overrides.notes === undefined ? {} : { notes: overrides.notes }), save_payment_method: true } });
  if (res.status !== 201) return { status: res.status, text: res.text, order: null };
  const orderId = res.body.order.id as string;
  const tenantId = (await api.db.owner.query<{ tenant_id: string }>("select tenant_id from orders where id = $1", [orderId])).rows[0]!.tenant_id;
  return { status: res.status, text: res.text, order: { orderId, orderNo: res.body.order.order_no, token: res.body.link.token, tenantId } };
}

async function payFor(orderId: string): Promise<{ raw: string; status: number }> {
  const intent = pay.intentOf(orderId);
  assert.ok(intent);
  pay.pay(intent.id);
  const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
  const res = await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()));
  return { raw, status: res.status };
}

async function paidOrder(overrides: Parameters<typeof placeOrder>[0] = {}): Promise<Placed> {
  const placed = await placeOrder(overrides);
  assert.ok(placed.order, placed.text);
  assert.equal((await payFor(placed.order.orderId)).status, 200);
  return placed.order;
}

function subjectOf(message: FakeSmtpMessage): string {
  const head = message.data.slice(0, message.data.search(/\r?\n\r?\n/));
  const raw = /^subject:\s*((?:.*)(?:\r?\n[ \t].*)*)/im.exec(head)?.[1] ?? "";
  return raw.replace(/\r?\n[ \t]+/g, " ").replace(/=\?utf-8\?(b|q)\?([^?]*)\?=\s*/gi, (_, kind: string, text: string) =>
    kind.toLowerCase() === "b" ? Buffer.from(text, "base64").toString("utf8") : Buffer.from(text.replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, (__, hex: string) => String.fromCharCode(Number.parseInt(hex, 16))), "latin1").toString("utf8"));
}

function bodyOf(message: FakeSmtpMessage): string {
  const split = message.data.search(/\r?\n\r?\n/);
  const head = message.data.slice(0, split);
  const body = message.data.slice(split).trim();
  if (/content-transfer-encoding:\s*base64/i.test(head)) return Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf8");
  if (/content-transfer-encoding:\s*quoted-printable/i.test(head)) return Buffer.from(body.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))), "latin1").toString("utf8");
  return body;
}

const guestMails = (): FakeSmtpMessage[] => smtp.messages.filter((message) => message.to.includes(GUEST_EMAIL));
const rowsOf = async (orderId: string): Promise<any[]> => (await api.db.owner.query("select * from notifications where order_id = $1 order by audience, recipient", [orderId])).rows;
const guestRow = async (orderId: string, event = "order.confirmed"): Promise<any> => (await rowsOf(orderId)).find((row) => row.audience === "guest" && row.event === event);
const rowById = async (id: string): Promise<any> => (await api.db.owner.query("select * from notifications where id = $1", [id])).rows[0];
const insertEvent = (tenantId: string | null, event: string, orderId: string | null, data: Record<string, unknown> = {}): Promise<unknown> =>
  api.db.owner.query("insert into notification_events (tenant_id, event, order_id, dedupe_key, data, occurred_at) values ($1, $2, $3, $4, $5, $6)", [tenantId, event, orderId, `qa-${randomUUID()}`, JSON.stringify(data), api.clock.now()]);
const failRow = (id: string, code = "TIMEOUT"): Promise<unknown> => api.db.owner.query("update notifications set status = 'failed', last_error_code = $2, last_error_message = null, lease_token = null, lease_until = null where id = $1", [id, code]);
/** 现登录一次：有的用例把时钟往后拨了几小时，之前的令牌已过期。 */
const opsToken = async (): Promise<string> => (await ok(api.platformLogin({ body: { email: m.staff.operations.email, password: TEST_PASSWORD } }))).access_token;
const sideOf = (tenantId: string): Market["a"] => (tenantId === m.a.tenantId ? m.a : m.b);

// ---- 并发和租约 ----

test("两个进程同时 tick（各自的连接池任务）：12 个事件每个接收人只发一封，没有记录卡在发送中", async () => {
  const seeded = await Promise.all(Array.from({ length: 12 }, (_, index) => seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + (100 + index) * HOUR) })));
  for (const order of seeded) await insertEvent(m.a.tenantId, "order.rescue_assigned", order.id);
  await Promise.all([site.app.notificationJobs.tick(), sibling.app.notificationJobs.tick(), site.app.notificationJobs.tick(), sibling.app.notificationJobs.tick()]);
  for (let round = 0; round < 3; round += 1) await Promise.all([site.app.notificationJobs.tick(), sibling.app.notificationJobs.tick()]);
  for (const order of seeded) {
    const rows = await rowsOf(order.id);
    assert.ok(rows.length >= 1, order.id);
    assert.ok(rows.every((row) => row.status === "sent" && row.attempts === 1), JSON.stringify(rows.map((row) => [row.status, row.attempts])));
    const subjects = smtp.messages.filter((message) => message.to.includes(m.a.adminEmail) && bodyOf(message).includes(order.orderNo));
    assert.equal(subjects.length, 1, `${order.orderNo} 发了 ${subjects.length} 封`);
  }
});

test("租约没到期不动：别的进程的 tick 不会把正在发的记录判成中断（精确边界：差 1 毫秒不算，正好到期算）", async () => {
  const order = await paidOrder();
  await site.app.notificationJobs.expandEvents(api.clock.now());
  const row = await guestRow(order.orderId);
  const leaseUntil = new Date(api.clock.now().getTime() + 1);
  await api.db.owner.query("update notifications set status = 'sending', lease_token = gen_random_uuid(), lease_until = $2 where id = $1", [row.id, leaseUntil]);
  const notYet = await sibling.app.notificationJobs.tick();
  assert.equal(notYet.abandoned, 0);
  assert.equal((await rowById(row.id)).status, "sending");
  api.clock.advance(1);
  const atLimit = await sibling.app.notificationJobs.tick();
  assert.equal(atLimit.abandoned, 1);
  const failed = await rowById(row.id);
  assert.deepEqual([failed.status, failed.last_error_code, failed.attempts], ["failed", "OUTCOME_UNKNOWN", 0]);
  assert.equal(guestMails().length, 0, "OUTCOME_UNKNOWN 不自动重发");
  await sibling.app.notificationJobs.tick();
  assert.equal(guestMails().length, 0, "下一轮也不重发");
});

test("缺陷：租约已经被判中断（OUTCOME_UNKNOWN）的记录，还在原进程队列里的不应该再发出去", async () => {
  const seeded = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 120 * HOUR) });
  await insertEvent(m.a.tenantId, "order.rescue_assigned", seeded.id);
  await site.app.notificationJobs.expandEvents(api.clock.now());
  const now = api.clock.now();
  const claimed = await withPlatformTx(api.db.pool, (db) => claimDueNotifications(db, now, new Date(now.getTime() + NOTIFICATION_LEASE_MS), 20));
  const mine = claimed.find((row) => row.orderId === seeded.id);
  assert.ok(mine);
  api.clock.advance(NOTIFICATION_LEASE_MS);
  await sibling.app.notificationJobs.tick();
  assert.equal((await rowById(mine.id)).last_error_code, "OUTCOME_UNKNOWN");
  smtp.reset();
  const late = await site.app.notificationJobs.deliver(mine, false);
  assert.equal(late, null, "结果记不上");
  assert.equal(smtp.messages.length, 0, `发送前没有再核对租约：记录写着「可能已发出」等人决定，邮件却真发了 ${smtp.messages.length} 封；人再重试就是两封`);
});

test("过期的结果记不上：被别人接手后，旧令牌写不回去（已发送不会被改回等待）", async () => {
  const order = await paidOrder();
  await site.app.notificationJobs.expandEvents(api.clock.now());
  const row = await guestRow(order.orderId);
  const now = api.clock.now();
  const claimed = await withPlatformTx(api.db.pool, (db) => claimDueNotifications(db, now, new Date(now.getTime() + NOTIFICATION_LEASE_MS), 20));
  const mine = claimed.find((item) => item.id === row.id);
  assert.ok(mine);
  await api.db.owner.query("update notifications set lease_token = gen_random_uuid() where id = $1", [row.id]);
  const done = await site.app.notificationJobs.deliver(mine, false);
  assert.equal(done, null);
  assert.equal((await rowById(row.id)).status, "sending");
  assert.ok(logLines.join("").includes("notification.lease_lost"));
});

test("手动重试和后台任务并发、连点三次：只发一封，其余 409，只有一条审计", async () => {
  const order = await paidOrder();
  await site.app.notificationJobs.expandEvents(api.clock.now());
  const row = await guestRow(order.orderId);
  await failRow(row.id);
  const token = await opsToken();
  const [first, second, third] = await Promise.all([
    site.call("POST", `/platform/v1/notifications/${row.id}/retry`, { token }),
    sibling.call("POST", `/platform/v1/notifications/${row.id}/retry`, { token }),
    site.call("POST", `/platform/v1/notifications/${row.id}/retry`, { token }),
    site.app.notificationJobs.tick(),
    sibling.app.notificationJobs.tick(),
  ]);
  assert.deepEqual([first.status, second.status, third.status].sort(), [200, 409, 409], [first.text, second.text, third.text].join("\n"));
  await site.app.notificationJobs.tick();
  assert.equal(guestMails().length, 1);
  assert.equal((await rowById(row.id)).status, "sent");
  assert.equal((await api.db.owner.query("select 1 from audit_logs where resource = 'notification' and action = 'retry' and resource_id = $1", [row.id])).rowCount, 1);
});

test("手动重试 OUTCOME_UNKNOWN：符合 ADR，允许人工决定；发出后是已发送；审计记下原来的错误码；不看免打扰", async () => {
  const seeded = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 130 * HOUR) });
  await insertEvent(m.a.tenantId, "order.rescue_assigned", seeded.id);
  await site.app.notificationJobs.expandEvents(api.clock.now());
  const row = (await rowsOf(seeded.id))[0];
  await api.db.owner.query("update notifications set status = 'sending', lease_token = gen_random_uuid(), lease_until = $2 where id = $1", [row.id, new Date(api.clock.now().getTime() - 1)]);
  const localHour = (api.clock.now().getUTCHours() + 9) % 24;
  const pad = (hour: number): string => `${String(hour).padStart(2, "0")}:00`;
  await api.db.owner.query("insert into tenant_notification_settings (tenant_id, quiet_start, quiet_end, updated_at) values ($1, $2, $3, now())", [m.a.tenantId, pad(localHour), pad((localHour + 2) % 24)]);
  await site.app.notificationJobs.tick();
  assert.equal((await rowById(row.id)).last_error_code, "OUTCOME_UNKNOWN");
  smtp.reset();
  const retried = await site.call("POST", `/platform/v1/notifications/${row.id}/retry`, { token: await opsToken() });
  assert.equal(retried.status, 200, retried.text);
  assert.equal(retried.body.notification.status, "sent");
  assert.equal(retried.body.notification.attempts, 1);
  assert.equal(smtp.messages.length, 1);
  const audit = await api.db.owner.query("select before from audit_logs where resource = 'notification' and action = 'retry' and resource_id = $1", [row.id]);
  assert.equal(audit.rows[0].before.last_error_code, "OUTCOME_UNKNOWN");
});

test("手动重试发送中途进程退出：租约到期同样是 OUTCOME_UNKNOWN，不会卡在发送中", async () => {
  const order = await paidOrder();
  await site.app.notificationJobs.expandEvents(api.clock.now());
  const row = await guestRow(order.orderId);
  await failRow(row.id);
  await api.db.owner.query("update notifications set status = 'sending', lease_token = gen_random_uuid(), lease_until = $2 where id = $1", [row.id, new Date(api.clock.now().getTime() + NOTIFICATION_LEASE_MS)]);
  assert.equal((await site.call("POST", `/platform/v1/notifications/${row.id}/retry`, { token: await opsToken() })).status, 409, "正在发的不能再重试");
  api.clock.advance(NOTIFICATION_LEASE_MS);
  await site.app.notificationJobs.tick();
  assert.deepEqual([(await rowById(row.id)).status, (await rowById(row.id)).last_error_code], ["failed", "OUTCOME_UNKNOWN"]);
});

// ---- 退避和次数 ----

test("退避时间精确边界：差 1 毫秒不发，正好到点发；每一档都对；第 6 次失败后再也不发", async () => {
  const seeded = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 24 * 20 * HOUR) });
  await insertEvent(m.a.tenantId, "tenant.status_changed", null, { status: "active" });
  await insertEvent(m.a.tenantId, "order.rescue_assigned", seeded.id);
  smtp.behave({ dropOnConnect: true });
  await site.app.notificationJobs.tick();
  const row = (await rowsOf(seeded.id))[0];
  assert.deepEqual([row.status, row.attempts], ["pending", 1]);
  const delays = [60, 300, 1800, 7200, 21600];
  for (const [index, seconds] of delays.entries()) {
    const current = await rowById(row.id);
    assert.equal(new Date(current.next_attempt_at).getTime(), api.clock.now().getTime() + seconds * 1000, `第 ${index + 1} 档`);
    api.clock.advance(seconds * 1000 - 1);
    await site.app.notificationJobs.tick();
    assert.equal((await rowById(row.id)).attempts, index + 1, `第 ${index + 1} 档差 1 毫秒不发`);
    api.clock.advance(1);
    await site.app.notificationJobs.tick();
    assert.equal((await rowById(row.id)).attempts, index + 2, `第 ${index + 1} 档到点发`);
  }
  const finished = await rowById(row.id);
  assert.deepEqual([finished.status, finished.attempts, finished.last_error_code], ["failed", 6, "UNREACHABLE"]);
  smtp.reset();
  api.clock.advance(24 * HOUR);
  await site.app.notificationJobs.tick();
  assert.equal((await rowById(row.id)).attempts, 6);
  assert.equal(smtp.messages.filter((message) => bodyOf(message).includes(seeded.orderNo)).length, 0);
});

test("超时：服务器一言不发，记 TIMEOUT 算一次；过期前能恢复（外部服务超时）", { timeout: 60_000 }, async () => {
  const seeded = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 140 * HOUR) });
  await insertEvent(m.a.tenantId, "order.rescue_assigned", seeded.id);
  await site.app.notificationJobs.expandEvents(api.clock.now());
  smtp.behave({ stallOn: "DATA" });
  const fast = await siteFastTimeout();
  try {
    await fast.app.notificationJobs.tick();
  } finally {
    await fast.close();
  }
  const row = (await rowsOf(seeded.id))[0];
  assert.deepEqual([row.status, row.attempts, row.last_error_code], ["pending", 1, "TIMEOUT"]);
  smtp.reset();
  api.clock.advance(60_000);
  await site.app.notificationJobs.tick();
  assert.equal((await rowById(row.id)).status, "sent");
});

/** 同一个库上发信时限只有 300 毫秒的进程：不等真实的 15 秒。 */
async function siteFastTimeout(): Promise<{ app: SiteApi["app"]; close(): Promise<void> }> {
  const { SmtpMailer } = await import("./integrations/smtp.ts");
  const { buildApp } = await import("./app.ts");
  const { loadConfig } = await import("@nozomi/config");
  const { loadMigrationFiles } = await import("./db/migrate.ts");
  const { UNREACHABLE_INTEGRATIONS, testEnv } = await import("./testing/fixtures.ts");
  const app = buildApp({
    config: loadConfig({ ...testEnv(api.db.url), ...UNREACHABLE_INTEGRATIONS, SMTP_HOST: smtp.host, SMTP_PORT: String(smtp.port), SMTP_ENCRYPTION: "none", SMTP_USERNAME: "mailer", SMTP_PASSWORD: "fake-smtp-password-Qa9", SMTP_FROM_NAME: "NOZOMI", SMTP_FROM_ADDRESS: "noreply@example.test" }),
    pool: api.db.pool,
    migrationFiles: await loadMigrationFiles(),
    now: api.clock.now,
    payments: pay,
    logger: false,
    mailer: new SmtpMailer({ allowLoopback: true, deadlineMs: 300 }),
    integrationSecretsTtlMs: 0,
  });
  return { app, close: () => app.close() };
}

test("配置问题的边界：密码错不算次数、5 分钟内不再连服务器（不空转）、到有效期变已过期（不会无限重试）", async () => {
  const seeded = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 3 * HOUR) });
  await insertEvent(m.a.tenantId, "order.rescue_assigned", seeded.id);
  smtp.behave({ rejectAuth: true });
  await site.app.notificationJobs.tick();
  const row = (await rowsOf(seeded.id))[0];
  assert.deepEqual([row.status, row.attempts, row.last_error_code], ["pending", 0, "AUTH_FAILED"]);
  const connections = smtp.connections();
  for (let round = 0; round < 5; round += 1) {
    await site.app.notificationJobs.tick();
    await sibling.app.notificationJobs.tick();
  }
  assert.equal(smtp.connections(), connections, "没到 5 分钟又去连服务器了");
  for (let round = 0; round < 10; round += 1) {
    api.clock.advance(300_000);
    await site.app.notificationJobs.tick();
    const current = await rowById(row.id);
    assert.equal(current.attempts, 0, `第 ${round} 轮算了次数`);
    if (current.status !== "pending") break;
  }
  api.clock.advance(3 * HOUR);
  await site.app.notificationJobs.tick();
  const finished = await rowById(row.id);
  assert.deepEqual([finished.status, finished.last_error_code, finished.attempts], ["expired", "EXPIRED", 0]);
});

test("邮件没配置：之前已经用掉的次数不变；配置恢复前不连服务器；进行中碰上配置被清掉不算次数、下一轮还能发", async () => {
  const order = await paidOrder();
  smtp.behave({ dropOnConnect: true });
  await site.app.notificationJobs.tick();
  const row = await guestRow(order.orderId);
  assert.equal(row.attempts, 1);
  smtp.reset();
  await api.db.owner.query("update notifications set next_attempt_at = $2 where id = $1", [row.id, api.clock.now()]);
  for (let round = 0; round < 3; round += 1) await unconfigured.app.notificationJobs.tick();
  const waiting = await rowById(row.id);
  assert.deepEqual([waiting.status, waiting.attempts, waiting.last_error_code], ["pending", 1, "NOT_CONFIGURED"]);
  assert.equal(smtp.connections(), 0);

  const now = api.clock.now();
  const claimed = await withPlatformTx(api.db.pool, (db) => claimDueNotifications(db, now, new Date(now.getTime() + NOTIFICATION_LEASE_MS), 20));
  const mine = claimed.find((item) => item.id === row.id);
  assert.ok(mine);
  const done = await unconfigured.app.notificationJobs.deliver(mine, false);
  assert.deepEqual([done?.status, done?.attempts, done?.lastErrorCode], ["pending", 1, "NOT_CONFIGURED"]);
  await site.app.notificationJobs.tick();
  const sent = await rowById(row.id);
  assert.deepEqual([sent.status, sent.attempts, sent.last_error_code, sent.last_error_message], ["sent", 2, null, null]);
});

test("过期边界：有效期正好到点算过期，差 1 毫秒还能发；过期的可手动重试（有配置时）", async () => {
  const seeded = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 150 * HOUR) });
  await insertEvent(m.a.tenantId, "order.rescue_assigned", seeded.id);
  await site.app.notificationJobs.expandEvents(api.clock.now());
  const row = (await rowsOf(seeded.id))[0];
  await api.db.owner.query("update notifications set expires_at = $2 where id = $1", [row.id, api.clock.now()]);
  await site.app.notificationJobs.tick();
  assert.deepEqual([(await rowById(row.id)).status, (await rowById(row.id)).last_error_code], ["expired", "EXPIRED"]);
  assert.equal(smtp.messages.length, 0);
  const retried = await site.call("POST", `/platform/v1/notifications/${row.id}/retry`, { token: await opsToken() });
  assert.equal(retried.body.notification.status, "sent", retried.text);
  assert.equal(smtp.messages.length, 1);

  const other = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 151 * HOUR) });
  await insertEvent(m.a.tenantId, "order.rescue_assigned", other.id);
  await site.app.notificationJobs.expandEvents(api.clock.now());
  const live = (await rowsOf(other.id))[0];
  await api.db.owner.query("update notifications set expires_at = $2 where id = $1", [live.id, new Date(api.clock.now().getTime() + 1)]);
  await site.app.notificationJobs.tick();
  assert.equal((await rowById(live.id)).status, "sent");
});

test("缺陷：准备内容时一直出错不应该无限消耗次数：第 6 次仍失败应该最终失败（ADR 的上限）", async () => {
  const order = await paidOrder();
  await site.app.notificationJobs.tick();
  await insertEvent(order.tenantId, "extra_charge.submitted", order.orderId, { charge_id: "not-a-uuid" });
  await site.app.notificationJobs.expandEvents(api.clock.now());
  const row = await guestRow(order.orderId, "extra_charge.submitted");
  assert.ok(row);
  for (let round = 0; round < 8; round += 1) {
    await api.db.owner.query("update notifications set next_attempt_at = $2 where id = $1 and status = 'pending'", [row.id, api.clock.now()]);
    await site.app.notificationJobs.tick();
  }
  const current = await rowById(row.id);
  assert.ok(current.attempts <= 6, `已经试了 ${current.attempts} 次，状态还是 ${current.status}：这条路径没有次数上限，每分钟空转到有效期`);
  assert.equal(current.status, "failed");
});

test("缺陷：一条坏事件不应该卡住整个通知中心：其余事件照常展开、发送", async () => {
  const siteOrder = await paidOrder();
  await site.app.notificationJobs.tick();
  smtp.reset();
  const seeded = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 160 * HOUR) });
  await api.db.owner.query("insert into notification_events (tenant_id, event, order_id, dedupe_key, data, occurred_at) values ($1, 'extra_charge.submitted', $2, $3, $4, $5)", [siteOrder.tenantId, siteOrder.orderId, `qa-${randomUUID()}`, JSON.stringify({ dispute_until: "not-a-date" }), new Date(api.clock.now().getTime() - 1000)]);
  await insertEvent(m.a.tenantId, "order.rescue_assigned", seeded.id);
  let blocked: unknown = null;
  try {
    await site.app.notificationJobs.tick();
  } catch (err) {
    blocked = err;
  }
  const rows = await rowsOf(seeded.id);
  await api.db.owner.query("update notification_events set expanded_at = now() where data ->> 'dispute_until' = 'not-a-date' and expanded_at is null");
  assert.equal(blocked, null, `tick 整轮抛错（${(blocked as Error | null)?.message}）：过期、发送都没执行，每一轮都卡在同一条事件上`);
  assert.ok(rows.length >= 1 && rows.every((row) => row.status === "sent"), "排在坏事件后面的事件没有处理");
});

test("没有收件人的事件不算坏事件，只处理一次", async () => {
  const lonely = await api.tenantWithAdmin(await api.superAdminToken(`qa-root-${randomUUID().slice(0, 8)}@platform.test`), `QA孤立-${randomUUID().slice(0, 6)}`, `lonely-${randomUUID().slice(0, 8)}@market-c.test`);
  await api.db.owner.query("update tenant_users set status = 'disabled' where tenant_id = $1", [lonely.tenantId]);
  await insertEvent(lonely.tenantId, "tenant.status_changed", null, { status: "active" });
  const first = await site.app.notificationJobs.tick();
  assert.ok(first.expanded >= 1);
  const second = await site.app.notificationJobs.tick();
  assert.equal(second.expanded, 0);
});

// ---- 业务不受影响 ----

test("发件箱写入失败：符合 ADR「同生共死」——Stripe 通知失败重发，订单不留半截状态；恢复后确认和事件各一条", async () => {
  const placed = await placeOrder();
  assert.ok(placed.order, placed.text);
  const orderId = placed.order.orderId;
  await api.db.owner.query(`create function qa_block_outbox() returns trigger language plpgsql as $$ begin if new.order_id = '${orderId}' then raise exception 'qa: outbox unavailable'; end if; return new; end $$`);
  await api.db.owner.query("create trigger qa_block_outbox before insert on notification_events for each row execute function qa_block_outbox()");
  let raw: string;
  try {
    const failed = await payFor(orderId);
    raw = failed.raw;
    assert.ok(failed.status >= 500, `写不进发件箱时 webhook 应该失败让 Stripe 重发，实际 ${failed.status}`);
    const during = (await api.db.owner.query<{ status: string }>("select status from orders where id = $1", [orderId])).rows[0]!;
    assert.equal(during.status, "pending_payment", "业务应该整体回滚");
    assert.equal((await api.db.owner.query("select 1 from notification_events where order_id = $1", [orderId])).rowCount, 0);
    assert.equal((await api.db.owner.query("select 1 from tenant_events where order_id = $1", [orderId]).catch(() => ({ rowCount: 0 }))).rowCount, 0);
  } finally {
    await api.db.owner.query("drop trigger qa_block_outbox on notification_events");
    await api.db.owner.query("drop function qa_block_outbox()");
  }
  const again = await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()));
  assert.equal(again.status, 200);
  assert.equal((await api.db.owner.query<{ status: string }>("select status from orders where id = $1", [orderId])).rows[0]!.status, "confirmed");
  assert.equal((await api.db.owner.query("select 1 from notification_events where order_id = $1 and event = 'order.confirmed'", [orderId])).rowCount, 1);
});

test("邮件服务器挂着：付款、确认、派车都成功，发信失败只影响通知记录", async () => {
  smtp.behave({ dropOnConnect: true });
  const order = await paidOrder();
  const tick = await site.app.notificationJobs.tick();
  assert.ok(tick.retrying >= 1);
  assert.equal((await api.db.owner.query<{ status: string }>("select status from orders where id = $1", [order.orderId])).rows[0]!.status, "confirmed");
  const side = sideOf(order.tenantId);
  const token = await tenantLogin(api, side.adminEmail);
  const who = { ...side, adminToken: token };
  await ok(assign(api, who, order.orderId, (await newDriver(api, who)).id, (await newVehicle(api, who, m.ids.biz7)).id));
  assert.equal((await api.db.owner.query<{ status: string }>("select status from orders where id = $1", [order.orderId])).rows[0]!.status, "assigned");
});

test("业务接口回滚（改单校验失败）不产生事件：入箱前失败、入箱后失败都没有残留", async () => {
  const order = await paidOrder();
  await site.app.notificationJobs.tick();
  const before = (await api.db.owner.query<{ n: number }>("select count(*)::int as n from notification_events where order_id = $1", [order.orderId])).rows[0]!.n;
  const view = await site.call("GET", "/site/v1/order", { token: order.token });
  const conflict = await site.call("PATCH", "/site/v1/order", { token: order.token, headers: { "if-match": `"${view.body.order.version + 9}"` }, body: { flight_no: "JL5" } });
  assert.ok(conflict.status >= 400, conflict.text);
  assert.equal((await api.db.owner.query<{ n: number }>("select count(*)::int as n from notification_events where order_id = $1", [order.orderId])).rows[0]!.n, before);
});

test("没付款就取消的单（付款超时）：客人和供应商都不收到取消邮件", async () => {
  const placed = await placeOrder();
  assert.ok(placed.order, placed.text);
  const cancelled = await site.call("POST", "/site/v1/order/cancel", { token: placed.order.token, body: {} });
  await site.app.notificationJobs.tick();
  assert.equal(guestMails().length, 0, `取消响应 ${cancelled.status}`);
  assert.deepEqual((await rowsOf(placed.order.orderId)).map((row) => row.event), []);
});

// ---- 发送前复查 ----

test("手动重试时订单已取消：不发，记 ORDER_STATE_CHANGED，以后也不能再重试", async () => {
  const order = await paidOrder();
  await site.app.notificationJobs.expandEvents(api.clock.now());
  const row = await guestRow(order.orderId);
  await failRow(row.id);
  assert.equal((await site.call("POST", "/site/v1/order/cancel", { token: order.token, body: {} })).status, 200);
  const retried = await site.call("POST", `/platform/v1/notifications/${row.id}/retry`, { token: await opsToken() });
  assert.equal(retried.status, 200, retried.text);
  assert.deepEqual([retried.body.notification.status, retried.body.notification.last_error.code, retried.body.notification.retryable], ["expired", "ORDER_STATE_CHANGED", false]);
  assert.ok(!guestMails().some((message) => bodyOf(message).includes("已确认")), "取消后不该再收到确认邮件");
});

test("退避等待中改派：旧司机的通知到点也不发", async () => {
  const order = await paidOrder();
  await site.app.notificationJobs.tick();
  const side = sideOf(order.tenantId);
  const token = await tenantLogin(api, side.adminEmail);
  const who = { ...side, adminToken: token };
  const oldDriver = await newDriver(api, who);
  const newOne = await newDriver(api, who);
  const vehicle = await newVehicle(api, who, m.ids.biz7);
  smtp.behave({ dropOnConnect: true });
  await ok(assign(api, who, order.orderId, oldDriver.id, vehicle.id));
  await site.app.notificationJobs.tick();
  const row = await guestRow(order.orderId, "order.assigned");
  assert.deepEqual([row.status, row.attempts], ["pending", 1]);
  smtp.reset();
  await ok(assign(api, who, order.orderId, newOne.id, vehicle.id));
  await api.db.owner.query("update notifications set next_attempt_at = $2 where id = $1", [row.id, api.clock.now()]);
  await site.app.notificationJobs.tick();
  assert.deepEqual([(await rowById(row.id)).status, (await rowById(row.id)).last_error_code], ["expired", "ORDER_STATE_CHANGED"]);
  const mails = guestMails().map(bodyOf);
  assert.ok(mails.every((text) => !text.includes(oldDriver.name)), "旧司机的信息发给了客人");
  assert.ok(mails.some((text) => text.includes(newOne.name)), "新司机的信息没发");
});

test("缺陷：等待发送期间客人改了邮箱：带查看链接的邮件不应该再发到旧地址（ADR：地址是订单现在的乘客邮箱，内容现取）", async () => {
  const order = await paidOrder();
  await site.app.notificationJobs.expandEvents(api.clock.now());
  const view = await site.call("GET", "/site/v1/order", { token: order.token });
  const newEmail = "guest.new-address@example.com";
  const changed = await site.call("PATCH", "/site/v1/order", { token: order.token, headers: { "if-match": `"${view.body.order.version}"` }, body: { passenger: { name: "虚构的客人", phone: "+81 90-0000-0000", email: newEmail } } });
  assert.equal(changed.status, 200, changed.text);
  await site.app.notificationJobs.tick();
  const old = guestMails();
  assert.equal(old.length, 0, `旧地址收到了 ${old.length} 封带订单查看链接的邮件`);
  assert.ok(smtp.messages.some((message) => message.to.includes(newEmail)));
});

// ---- 规则 4 和金额 ----

test("规则 4：真实流程走一遍（确认、派车提醒、改单、改期待确认、取消、资质、工单），供应商每封邮件都没有对外价和加价比例；客人邮件没有结算价", async () => {
  const SELL = 987654;
  const MARKUP_BP = 4321;
  const order = await paidOrder();
  await api.db.owner.query("update order_sales set sell_minor = $2, markup_bp = $3 where order_id = $1", [order.orderId, SELL, MARKUP_BP]);
  await site.app.notificationJobs.tick();
  const side = sideOf(order.tenantId);
  const now = api.clock.now();
  const events: [string, string | null, Record<string, unknown>][] = [
    ["order.rescue_assigned", order.orderId, {}],
    ["order.changed", order.orderId, { fields: ["service_time", "passengers"] }],
    ["order.change_pending", order.orderId, { confirm_due_at: new Date(now.getTime() + 1_800_000).toISOString() }],
    ["order.dispatch_overdue", order.orderId, {}],
    ["ticket.reply_requested", order.orderId, { ticket_no: "TK-QA-1" }],
    ["tenant.document_expiring", null, { document_type: "vehicle_insurance", expires_on: "2027-01-01", days_left: 30 }],
    ["tenant.document_expired", null, { document_type: "vehicle_insurance", expires_on: "2027-01-01" }],
    ["tenant.observation_started", null, { reasons: ["score_below_threshold", "driver_no_show"] }],
    ["tenant.status_changed", null, { status: "suspended" }],
  ];
  for (const [event, orderId, data] of events) await insertEvent(order.tenantId, event, orderId, data);
  await site.app.notificationJobs.tick();
  assert.equal((await site.call("POST", "/site/v1/order/cancel", { token: order.token, body: {} })).status, 200);
  const departure = await seedOrder(api, m, order.tenantId === m.a.tenantId ? "a" : "b", { serviceAt: new Date(api.clock.now().getTime() + 170 * HOUR), status: "assigned" });
  await insertEvent(order.tenantId, "order.departure_overdue", departure.id);
  await site.app.notificationJobs.tick();

  const tenantMails = smtp.messages.filter((message) => message.to.includes(side.adminEmail));
  const subjects = new Set<string>();
  assert.ok(tenantMails.length >= 11, `只收到 ${tenantMails.length} 封`);
  const leaks = [String(SELL), SELL.toLocaleString("en-US"), String(MARKUP_BP), "43.21", "对外价", "加价", "已付", "实付", "退款", "汇率", "JPY", "USD"];
  for (const mail of tenantMails) {
    // 只查主题和正文：Message-ID 和分隔符是随机的，订单号和编号也可能碰巧含这些字符
    const text = `${subjectOf(mail)}\n${bodyOf(mail)}`.replace(/NZ\d{8}[0-9A-Z]+/g, "").replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "");
    subjects.add(bodyOf(mail).split("\n")[0] as string);
    for (const forbidden of leaks) assert.ok(!text.includes(forbidden), `供应商邮件里有 ${forbidden}：\n${bodyOf(mail)}`);
  }
  assert.ok(subjects.size >= 10, `模板不够多：${[...subjects].join(" | ")}`);
  const rows = (await rowsOf(order.orderId)).filter((row) => row.audience === "tenant");
  assert.ok(rows.some((row) => row.event === "order.cancelled" && row.status === "sent"));
  const settlement = (await api.db.owner.query<{ settlement_minor: string }>("select settlement_minor from orders where id = $1", [order.orderId])).rows[0]!.settlement_minor;
  for (const mail of guestMails()) {
    const text = bodyOf(mail).replaceAll(order.orderNo, "");
    assert.ok(!text.includes(String(settlement)), `客人邮件出现了结算价 ${settlement}：${text}`);
    assert.doesNotMatch(text, /结算|加价|markup/i);
  }
  assert.ok(guestMails().some((mail) => bodyOf(mail).includes(`JPY ${SELL}`)), "客人的确认邮件应该写自己付的钱");

  const tenantApi = await api.call("GET", `/tenant/v1/notifications?order_id=${order.orderId}`, { token: await tenantLogin(api, side.adminEmail) });
  assert.equal(tenantApi.status, 200, tenantApi.text);
  for (const key of allKeys(tenantApi.body)) assert.doesNotMatch(key, /sell|markup|paid|refund|fx_|price|amount/i, key);
  assert.ok(!tenantApi.text.includes(String(SELL)));
});

test("事后加收：供应商不收邮件；客人的金额是自己要付的（含加价），金额不串到供应商的记录", async () => {
  const order = await paidOrder();
  await site.app.notificationJobs.tick();
  await api.db.owner.query("update order_sales set markup_bp = 1000 where order_id = $1", [order.orderId]);
  const side = sideOf(order.tenantId);
  const token = await tenantLogin(api, side.adminEmail);
  const who = { ...side, adminToken: token };
  await ok(assign(api, who, order.orderId, (await newDriver(api, who)).id, (await newVehicle(api, who, m.ids.biz7)).id));
  for (const type of ["departed", "arrived", "picked_up", "completed"]) await ok(api.call("POST", `/tenant/v1/orders/${order.orderId}/events`, { token, body: { type } }));
  await site.app.notificationJobs.tick();
  smtp.reset();
  const charge = await api.call("POST", `/tenant/v1/orders/${order.orderId}/extra-charges`, { token, body: { type: "waiting", amount: 3_000, description: "等待费" } });
  assert.equal(charge.status, 201, charge.text);
  await site.app.notificationJobs.tick();
  assert.ok(!smtp.messages.some((message) => message.to.includes(side.adminEmail)), "加收不给供应商发邮件");
  const mail = guestMails()[0];
  assert.ok(mail);
  assert.match(bodyOf(mail), /JPY 3300(?!\d)/);
  assert.doesNotMatch(bodyOf(mail), /JPY 3000(?!\d)/);
  const row = await guestRow(order.orderId, "extra_charge.submitted");
  assert.equal(row.status, "sent");
  assert.doesNotMatch(JSON.stringify((await api.db.owner.query("select data from notification_events where id = $1", [row.event_id])).rows[0].data), /3000|3300|amount|minor/);
});

test("金额显示：美元两位小数、日元没有小数（确认邮件和加收邮件）", async () => {
  const order = await paidOrder();
  await api.db.owner.query("update order_sales set currency = 'USD', sell_minor = 12345 where order_id = $1", [order.orderId]);
  await site.app.notificationJobs.tick();
  const confirmUsd = guestMails()[0];
  assert.ok(confirmUsd);
  assert.match(bodyOf(confirmUsd), /USD 123\.45(?!\d)/);

  smtp.reset();
  const order2 = await paidOrder();
  await api.db.owner.query("update order_sales set sell_minor = 12345 where order_id = $1", [order2.orderId]);
  await site.app.notificationJobs.tick();
  const confirmJpy = guestMails()[0];
  assert.ok(confirmJpy);
  assert.match(bodyOf(confirmJpy), /JPY 12345(?![\d.])/);

  smtp.reset();
  await api.db.owner.query("update order_sales set currency = 'USD', markup_bp = 1000 where order_id = $1", [order.orderId]);
  const chargeId = randomUUID();
  await api.db.owner.query(
    "insert into order_extra_charges (tenant_id, id, order_id, type, amount_minor, currency, status, submitted_at, submitted_by, dispute_until, created_at, updated_at) values ($1, $2, $3, 'waiting', 1999, 'USD', 'in_window', $4, $5, $6, $4, $4)",
    [order.tenantId, chargeId, order.orderId, api.clock.now(), sideOf(order.tenantId).adminId, new Date(api.clock.now().getTime() + 48 * HOUR)],
  );
  await insertEvent(order.tenantId, "extra_charge.submitted", order.orderId, { charge_id: chargeId });
  await site.app.notificationJobs.tick();
  const chargeMail = guestMails()[0];
  assert.ok(chargeMail);
  assert.match(bodyOf(chargeMail), /USD 21\.99(?!\d)/, bodyOf(chargeMail));
});

// ---- 内容注入（真实接口进来的内容） ----

test("缺陷：客人姓名带换行，经真实接口下单：邮件不应该被伪造出新的段落", async () => {
  const placed = await placeOrder({ passenger: { name: "王小明\r\n\r\n重要通知：请点 http://evil.example 重新付款" } });
  if (placed.order === null) {
    assert.equal(placed.status, 400, placed.text);
    return;
  }
  assert.equal((await payFor(placed.order.orderId)).status, 200);
  await site.app.notificationJobs.tick();
  const mail = guestMails()[0];
  assert.ok(mail);
  assert.doesNotMatch(bodyOf(mail), /[\r\n]重要通知/, bodyOf(mail));
});

test("缺陷：客人下车地址带换行，经真实接口下单：发给供应商的邮件不应该被伪造出「平台通知」", async () => {
  const placed = await placeOrder({ dropoff_address: "东京站\n\nNOZOMI 平台紧急通知：请登录 http://evil.example 重新确认账号" });
  if (placed.order === null) {
    assert.equal(placed.status, 400, placed.text);
    return;
  }
  assert.equal((await payFor(placed.order.orderId)).status, 200);
  await site.app.notificationJobs.tick();
  const side = sideOf(placed.order.tenantId);
  const mail = smtp.messages.find((message) => message.to.includes(side.adminEmail));
  assert.ok(mail);
  assert.doesNotMatch(bodyOf(mail), /[\r\n]NOZOMI 平台紧急通知/, bodyOf(mail));
});

test("姓名、地址里的 HTML、占位符原样是文字；邮件只有纯文本部分；备注不进任何邮件", async () => {
  const order = await paidOrder({ passenger: { name: "<img src=x onerror=alert(1)>{{view_url}}" }, dropoff_address: "<b>东京站</b>{{order_no}}", notes: "QA备注不外传" });
  await site.app.notificationJobs.tick();
  assert.ok(smtp.messages.length >= 2);
  for (const message of smtp.messages) {
    assert.doesNotMatch(message.data, /content-type:\s*text\/html/i);
    assert.doesNotMatch(message.data, /multipart\/alternative/i);
    assert.ok(!bodyOf(message).includes("QA备注不外传"));
    assert.ok(!bodyOf(message).includes("undefined"));
  }
  const guest = bodyOf(guestMails()[0] as FakeSmtpMessage);
  assert.ok(guest.includes("<img src=x onerror=alert(1)>{{view_url}}，您好"), guest);
  const tenantMail = smtp.messages.find((message) => message.to.includes(sideOf(order.tenantId).adminEmail));
  assert.ok(bodyOf(tenantMail as FakeSmtpMessage).includes("<b>东京站</b>{{order_no}}"));
});

test("客人姓名只有空格、只有控制字符：要么下单就拒，要么照样发得出确认邮件，不能静默变成 RENDER_FAILED", async () => {
  for (const name of ["", "   "]) {
    const placed = await placeOrder({ passenger: { name } });
    if (placed.order === null) {
      assert.equal(placed.status, 400, placed.text);
      continue;
    }
    assert.equal((await payFor(placed.order.orderId)).status, 200);
    await site.app.notificationJobs.tick();
    const row = await guestRow(placed.order.orderId);
    assert.equal(row.status, "sent", `姓名 ${JSON.stringify(name)}：${row.status}/${row.last_error_code}`);
  }
});

test("缺陷：汇率告警的事件缺字段时，邮件不应该出现 undefined", async () => {
  await insertEvent(null, "fx.alert", null, { kind: "stale" });
  await site.app.notificationJobs.tick();
  assert.ok(smtp.messages.length >= 1);
  for (const message of smtp.messages) assert.doesNotMatch(bodyOf(message), /undefined|null/, bodyOf(message));
});

test("缺陷：异常事件缺类型时，邮件不应该出现 undefined", async () => {
  const seeded = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 180 * HOUR) });
  await insertEvent(null, "exception.opened", seeded.id, {});
  await site.app.notificationJobs.tick();
  assert.ok(smtp.messages.length >= 1);
  for (const message of smtp.messages) assert.doesNotMatch(`${bodyOf(message)}`, /undefined|null/, bodyOf(message));
});

test("邮件头：主题经编码后没有被注入新的头；收件人只有一个", async () => {
  const order = await paidOrder();
  await api.db.owner.query("update notifications set order_no = order_no where order_id = $1", [order.orderId]);
  await site.app.notificationJobs.tick();
  for (const message of smtp.messages) {
    assert.equal(message.to.length, 1);
    const head = message.data.slice(0, message.data.search(/\r?\n\r?\n/));
    assert.doesNotMatch(head, /^bcc:/im);
    assert.equal(head.match(/^subject:/gim)?.length, 1);
  }
});
