/**
 * QA（M4-08，ADR 0049）：通知中心的租户隔离、规则 4 之外的权限和隐私，开发的 notifications.itest.ts 没有覆盖的部分。
 * 核实 tenant_id 可空（ADR 0009 的例外）是否只放宽到必要程度：连真实 PostgreSQL 和本机假 SMTP，从不连真实的邮件服务。
 * 数据都在测试里构造，都是虚构的，随测试 schema 一起删除。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { withPlatformTx, withTenantTx } from "./db/context.ts";
import { enqueueNotification } from "./repos/notifications.ts";
import { type TestApi, TEST_PASSWORD, addTenantUser, createTestApi } from "./testing/api.ts";
import { seedOrder } from "./testing/dispatch.ts";
import { type FakeSmtp, startFakeSmtp } from "./testing/fake-integrations.ts";
import { type Market, addStaff, allKeys, buildMarket, newChannel, salesCredentials } from "./testing/market.ts";
import { tenantLogin } from "./testing/money.ts";
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

const HOUR = 3_600_000;
const GUEST_EMAIL = "guest.isolation@example.com";

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let smtp: FakeSmtp;
let site: SiteApi;
let clock = 0;
const logLines: string[] = [];

before(async () => {
  pay = new FakePaymentProvider();
  smtp = await startFakeSmtp();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  const channelId = (await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" })).id;
  const client = await salesCredentials(api, m, channelId);
  const logDestination = new Writable({
    write(chunk, _encoding, done) {
      logLines.push(String(chunk));
      done();
    },
  });
  site = await siteApi(api, client.clientId, pay, { SMTP_HOST: smtp.host, SMTP_PORT: String(smtp.port), SMTP_ENCRYPTION: "none", SMTP_USERNAME: "mailer", SMTP_PASSWORD: "fake-smtp-password-Qa8", SMTP_FROM_NAME: "NOZOMI", SMTP_FROM_ADDRESS: "noreply@example.test" }, { logDestination, integrationSecretsTtlMs: 0 });
});

after(async () => {
  await site?.close();
  await smtp?.close();
  await api.close();
});

beforeEach(async () => {
  await api.db.owner.query("update notification_events set expanded_at = coalesce(expanded_at, now())");
  await api.db.owner.query("update notifications set status = 'expired', last_error_code = 'ORDER_STATE_CHANGED', lease_token = null, lease_until = null where status in ('pending', 'sending')");
  smtp.reset();
  logLines.length = 0;
});

/** 走真实接口下一张官网单并付款：确认事件进发件箱，还没有展开。 */
async function paidSiteOrder(): Promise<{ orderId: string; orderNo: string; tenantId: string; token: string }> {
  clock += 1;
  api.clock.advance(1_000);
  const at = new Date(api.clock.now().getTime() + 10 * 24 * HOUR + clock * HOUR);
  const ip = `198.51.100.${(clock % 200) + 1}`;
  const quotes = await site.call("POST", "/site/v1/quotes", { ip, body: { category: "airport_transfer", city_id: m.ids.tokyo, airport_id: m.ids.narita, direction: "pickup", address: { lng: 139.7, lat: 35.6 }, service_local: new Date(at.getTime() + 9 * HOUR).toISOString().slice(0, 16), passengers: 2, luggage: 1 } });
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
  const tenantId = (await api.db.owner.query<{ tenant_id: string }>("select tenant_id from orders where id = $1", [orderId])).rows[0]!.tenant_id;
  return { orderId, orderNo: placed.body.order.order_no, tenantId, token: placed.body.link.token };
}

const sideOf = (tenantId: string): { self: Market["a"]; other: Market["a"] } => (tenantId === m.a.tenantId ? { self: m.a, other: m.b } : { self: m.b, other: m.a });
const ownerInsertEvent = async (tenantId: string | null, event: string, orderId: string | null, data: Record<string, unknown> = {}): Promise<string> =>
  (await api.db.owner.query<{ id: string }>("insert into notification_events (tenant_id, event, order_id, dedupe_key, data, occurred_at) values ($1, $2, $3, $4, $5, $6) returning id", [tenantId, event, orderId, `qa-${randomUUID()}`, JSON.stringify(data), api.clock.now()])).rows[0]!.id;
const ROW_COLUMNS = "(event_id, tenant_id, event, audience, locale, channel, recipient, order_id, order_no, status, next_attempt_at, expires_at, created_at, updated_at)";
const rowValues = (eventId: string, tenantId: string | null, audience: string, recipient: string, status = "pending"): unknown[] => {
  const now = api.clock.now();
  return [eventId, tenantId, "order.confirmed", audience, "zh-CN", "email", recipient, null, null, status, now, new Date(now.getTime() + HOUR), now, now];
};
const ROW_PLACEHOLDERS = "($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)";

/** 在 nozomi_app 角色下执行，`tenantSetting` 是 app.tenant_id 的值（null = 不设）：模拟没有经过 withTenantTx 的连接。 */
async function asAppRole<T>(tenantSetting: string | null, fn: (run: (sql: string) => Promise<any>) => Promise<T>): Promise<T> {
  const client = await api.db.owner.connect();
  try {
    await client.query("begin");
    await client.query("set local role nozomi_app");
    if (tenantSetting !== null) await client.query("select set_config('app.tenant_id', $1, true)", [tenantSetting]);
    return await fn((sql) => client.query(sql));
  } finally {
    await client.query("rollback");
    client.release();
  }
}

test("RLS 对 NULL：tenant_id 为空的平台告警，任何租户上下文都读不到；没有设置租户上下文的连接一行都读不到", async () => {
  const eventId = await ownerInsertEvent(null, "fx.alert", null, { kind: "held", currencies: ["USD"] });
  await api.db.owner.query(`insert into notifications ${ROW_COLUMNS} values ${ROW_PLACEHOLDERS}`, rowValues(eventId, null, "staff", "secret-staff@platform.test"));
  await api.db.owner.query(`insert into notifications ${ROW_COLUMNS} values ${ROW_PLACEHOLDERS}`, rowValues(await ownerInsertEvent(m.b.tenantId, "tenant.status_changed", null, { status: "active" }), m.b.tenantId, "tenant", "b-only@market-b.test"));

  for (const tenantId of [m.a.tenantId, m.b.tenantId]) {
    const rows = (await withTenantTx(api.db.pool, tenantId, (db) => db.query<{ tenant_id: string | null; recipient: string; audience: string }>("select tenant_id, recipient, audience from notifications"))).rows;
    assert.ok(!rows.some((row) => row.tenant_id === null), "租户读到了 tenant_id 为空的行");
    assert.ok(!rows.some((row) => row.recipient === "secret-staff@platform.test"));
    assert.ok(rows.every((row) => row.tenant_id === tenantId && row.audience === "tenant"));
  }
  for (const setting of [null, ""]) {
    const rows = await asAppRole(setting, (run) => run("select id from notifications"));
    assert.equal(rows.rowCount, 0, `app.tenant_id=${JSON.stringify(setting)}`);
  }
});

test("租户角色对两张表没有多余的权限：不能读发件箱、不能改删发件箱、不能写删发送记录；不设租户上下文也写不进发件箱", async () => {
  const attempts: [string, RegExp][] = [
    ["select id from notification_events", /permission denied/],
    ["update notification_events set expanded_at = now()", /permission denied/],
    ["delete from notification_events", /permission denied/],
    ["delete from notifications", /permission denied/],
    [`insert into notifications ${ROW_COLUMNS} values (gen_random_uuid(), null, 'x', 'staff', 'zh-CN', 'email', 'x@example.com', null, null, 'pending', now(), now(), now(), now())`, /permission denied/],
  ];
  for (const [sql, message] of attempts) await assert.rejects(withTenantTx(api.db.pool, m.a.tenantId, (db) => db.query(sql)), message, sql);
  await assert.rejects(asAppRole(null, (run) => run(`insert into notification_events (tenant_id, event, dedupe_key, data, occurred_at) values ('${m.a.tenantId}', 'order.confirmed', 'qa-${randomUUID()}', '{}', now())`)), /row-level security/);
  await assert.rejects(asAppRole(null, (run) => run(`insert into notification_events (tenant_id, event, dedupe_key, data, occurred_at) values (null, 'fx.alert', 'qa-${randomUUID()}', '{}', now())`)), /row-level security/);
});

test("租户写 tenant_id 为空或别家的事件都被数据库挡住（直接 SQL，不经任何代码）", async () => {
  for (const tenantId of [null, m.b.tenantId]) {
    await assert.rejects(withTenantTx(api.db.pool, m.a.tenantId, (db) => db.query("insert into notification_events (tenant_id, event, dedupe_key, data, occurred_at) values ($1, 'fx.alert', $2, '{}', now())", [tenantId, `qa-${randomUUID()}`])), /row-level security/, String(tenantId));
  }
});

test("缺陷：tenant_id 为空的发送记录应该只限平台员工接收人，数据库应该拒绝 tenant_id 为空的客人记录", async () => {
  const eventId = await ownerInsertEvent(null, "fx.alert", null);
  await withPlatformTx(api.db.pool, (db) => db.query(`insert into notifications ${ROW_COLUMNS} values ${ROW_PLACEHOLDERS}`, rowValues(eventId, null, "staff", "ok-staff@platform.test")));
  await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query(`insert into notifications ${ROW_COLUMNS} values ${ROW_PLACEHOLDERS}`, rowValues(eventId, null, "tenant", "x@market-a.test"))), /notifications_tenant_audience/);
  await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query(`insert into notifications ${ROW_COLUMNS} values ${ROW_PLACEHOLDERS}`, rowValues(eventId, null, "guest", "no-tenant-guest@example.com"))), /check constraint/, "客人记录 tenant_id 为空：没有 CHECK，只靠后台任务自觉");
});

test("缺陷：发件箱里 tenant_id 为空的事件应该只限平台员工的告警（数据库应该拒绝 tenant_id 为空的订单确认）", async () => {
  await assert.rejects(ownerInsertEvent(null, "order.confirmed", randomUUID()), /check constraint/, "ADR 0049：tenant_id 为空只表示平台员工的告警；现在任何事件都能写空");
});

test("缺陷：外键不带 tenant_id——A 家的发送记录不应该能指向 B 家的事件", async () => {
  const eventOfB = await ownerInsertEvent(m.b.tenantId, "tenant.status_changed", null, { status: "active" });
  await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query(`insert into notifications ${ROW_COLUMNS} values ${ROW_PLACEHOLDERS}`, rowValues(eventOfB, m.a.tenantId, "tenant", "x@market-a.test"))), /constraint|foreign key|violates/, "ADR 0049 说「这个外键指不到别家」，数据库没有任何约束保证");
});

test("缺陷：租户事务写一条指向别家订单的事件（tenant_id 是自己的，order_id 是别家的），不应该让别家的客人收到带查看链接的邮件", async () => {
  const order = await paidSiteOrder();
  await site.app.notificationJobs.tick();
  smtp.reset();
  const { other } = sideOf(order.tenantId);
  await assert.rejects(withTenantTx(api.db.pool, other.tenantId, (db) => enqueueNotification(db, { event: "order.cancelled", tenantId: other.tenantId, orderId: order.orderId, dedupeKey: `qa-${randomUUID()}` }, api.clock.now())), /foreign key/, "数据库直接拒绝：订单不是这一家的");
  await site.app.notificationJobs.tick();
  const stolen = smtp.messages.filter((message) => message.to.includes(GUEST_EMAIL));
  assert.equal(stolen.length, 0, `${other.tenantId} 伪造的事件让别家订单的客人收到了「订单已取消」邮件，共 ${stolen.length} 封`);
});

test("缺陷：租户事务不应该能写平台员工的告警事件（伪造告警发给全体运营）", async () => {
  await withTenantTx(api.db.pool, m.a.tenantId, (db) => enqueueNotification(db, { event: "site.lookup_ceiling", tenantId: m.a.tenantId, orderId: null, dedupeKey: `qa-${randomUUID()}` }, api.clock.now())).catch(() => undefined);
  await site.app.notificationJobs.tick();
  const forged = (await api.db.owner.query("select recipient from notifications where event = 'site.lookup_ceiling' and audience = 'staff' and event_id in (select id from notification_events where tenant_id = $1)", [m.a.tenantId])).rows;
  assert.deepEqual(forged, [], "带租户编号的事件被展开成了发给平台员工的告警");
});

test("缺陷：发件箱的去重键全局唯一且租户可写——A 家抢先写 B 家的键，不应该吞掉 B 家真实的通知", async () => {
  const seededB = await seedOrder(api, m, "b", { serviceAt: new Date(api.clock.now().getTime() + 90 * HOUR) });
  const key = `order.confirmed:${m.b.tenantId}:${seededB.id}`;
  await withTenantTx(api.db.pool, m.a.tenantId, (db) => enqueueNotification(db, { event: "tenant.status_changed", tenantId: m.a.tenantId, orderId: null, dedupeKey: key, data: { status: "active" } }, api.clock.now()));
  await withPlatformTx(api.db.pool, (db) => enqueueNotification(db, { event: "order.confirmed", tenantId: m.b.tenantId, orderId: seededB.id, dedupeKey: key }, api.clock.now()));
  const real = await api.db.owner.query("select 1 from notification_events where tenant_id = $1 and order_id = $2", [m.b.tenantId, seededB.id]);
  assert.equal(real.rowCount, 1, "B 家的新订单通知因为键被 A 家占了而被 on conflict do nothing 静默丢弃");
});

test("租户重复写同一个键：幂等，不报错（租户角色没有查询权限，on conflict do nothing 也要能用）", async () => {
  const key = `qa-${randomUUID()}`;
  const once = (): Promise<void> => withTenantTx(api.db.pool, m.a.tenantId, (db) => enqueueNotification(db, { event: "tenant.status_changed", tenantId: m.a.tenantId, orderId: null, dedupeKey: key, data: { status: "active" } }, api.clock.now()));
  await once();
  await once();
  assert.equal((await api.db.owner.query("select 1 from notification_events where dedupe_key = $1", [key])).rowCount, 1);
});

test("/tenant/v1/notifications：总数只算自己的；伪造 tenant_id、audience、event、order_no 参数都带不出别的；收件人全打码", async () => {
  const seededA = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 91 * HOUR) });
  const seededB = await seedOrder(api, m, "b", { serviceAt: new Date(api.clock.now().getTime() + 91 * HOUR) });
  await ownerInsertEvent(m.a.tenantId, "order.rescue_assigned", seededA.id);
  await ownerInsertEvent(m.b.tenantId, "order.rescue_assigned", seededB.id);
  await site.app.notificationJobs.tick();
  const staffEvent = await ownerInsertEvent(null, "fx.alert", null, { kind: "held", currencies: ["USD"] });
  await api.db.owner.query(`insert into notifications ${ROW_COLUMNS} values ${ROW_PLACEHOLDERS}`, rowValues(staffEvent, null, "staff", "staff-hidden@platform.test", "pending"));
  const guestEvent = await ownerInsertEvent(m.a.tenantId, "order.confirmed", seededA.id);
  await api.db.owner.query(`insert into notifications ${ROW_COLUMNS} values ${ROW_PLACEHOLDERS}`, rowValues(guestEvent, m.a.tenantId, "guest", "guest-hidden@example.com", "pending"));

  const token = await tenantLogin(api, m.a.adminEmail);
  const expected = (await api.db.owner.query<{ n: number }>("select count(*)::int as n from notifications where tenant_id = $1 and audience = 'tenant'", [m.a.tenantId])).rows[0]!.n;
  for (const query of ["", `?tenant_id=${m.b.tenantId}`, "?audience=guest", "?audience=staff", "?event=fx.alert", `?order_no=${seededB.orderNo}`, `?tenant_id=${m.b.tenantId}&audience=guest`]) {
    const res = await api.call("GET", `/tenant/v1/notifications${query}`, { token });
    if (res.status === 400) continue;
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.total, expected, `${query} 的总数`);
    assert.ok(res.body.items.every((item: any) => item.audience === "tenant" && item.order?.id !== seededB.id), query);
    for (const hidden of ["staff-hidden", "guest-hidden", "gu***", "st***", m.a.adminEmail, m.b.adminEmail, seededB.orderNo]) assert.ok(!res.text.includes(hidden), `${query} 带出了 ${hidden}`);
  }
  const byOrder = await api.call("GET", `/tenant/v1/notifications?order_id=${seededB.id}`, { token });
  assert.deepEqual([byOrder.body.items, byOrder.body.total], [[], 0], "按 B 的订单筛，连总数都不能透露");
});

test("/tenant/v1/notification-settings：令牌决定租户；A 改了不影响 B；If-Match 拿 B 的版本号也只作用于 A", async () => {
  const tokenA = await tenantLogin(api, m.a.adminEmail);
  const tokenB = await tenantLogin(api, m.b.adminEmail);
  await api.db.owner.query("delete from tenant_notification_settings where tenant_id = any($1::uuid[])", [[m.a.tenantId, m.b.tenantId]]);
  const savedB = await api.call("PUT", "/tenant/v1/notification-settings", { token: tokenB, body: { quiet_hours: { start: "01:00", end: "02:00" } } });
  assert.equal(savedB.status, 200, savedB.text);
  const withB = await api.call("PUT", "/tenant/v1/notification-settings", { token: tokenA, headers: { "if-match": `"${savedB.body.version}"` }, body: { quiet_hours: { start: "03:00", end: "04:00" } } });
  assert.deepEqual([withB.status, withB.body.error?.code], [409, "VERSION_CONFLICT"], "A 还没有设置过，B 的版本号不能让 A 写入");
  const savedA = await api.call("PUT", "/tenant/v1/notification-settings", { token: tokenA, body: { quiet_hours: { start: "03:00", end: "04:00" } } });
  assert.equal(savedA.status, 200, savedA.text);
  const b = await api.call("GET", "/tenant/v1/notification-settings", { token: tokenB });
  assert.deepEqual(b.body.quiet_hours, { start: "01:00", end: "02:00" });
  for (const smuggle of [{ tenant_id: m.b.tenantId }, { tenantId: m.b.tenantId }]) {
    const res = await api.call("PUT", "/tenant/v1/notification-settings", { token: tokenA, headers: { "if-match": `"${savedA.body.version}"` }, body: { quiet_hours: null, ...smuggle } });
    assert.equal(res.status, 400, res.text);
  }
  const query = await api.call("GET", `/tenant/v1/notification-settings?tenant_id=${m.b.tenantId}`, { token: tokenA });
  assert.deepEqual(query.body.quiet_hours, { start: "03:00", end: "04:00" });
  const audit = (await api.db.owner.query<{ tenant_id: string }>("select tenant_id from audit_logs where resource = 'notification_settings' and resource_id = $1", [m.a.tenantId])).rows;
  assert.ok(audit.length >= 1 && audit.every((row) => row.tenant_id === m.a.tenantId));
  await api.db.owner.query("delete from tenant_notification_settings where tenant_id = any($1::uuid[])", [[m.a.tenantId, m.b.tenantId]]);
});

test("免打扰的第一次保存并发：两个请求只成功一个，另一个 409，不会 500", async () => {
  await api.db.owner.query("delete from tenant_notification_settings where tenant_id = $1", [m.a.tenantId]);
  const token = await tenantLogin(api, m.a.adminEmail);
  const results = await Promise.all([1, 2, 3].map((hour) => api.call("PUT", "/tenant/v1/notification-settings", { token, body: { quiet_hours: { start: `0${hour}:00`, end: "09:00" } } })));
  assert.deepEqual(results.map((res) => res.status).sort(), [200, 409, 409]);
  await api.db.owner.query("delete from tenant_notification_settings where tenant_id = $1", [m.a.tenantId]);
});

test("免打扰的非法时间都是 400，不会撞数据库约束变成 500", async () => {
  await api.db.owner.query("delete from tenant_notification_settings where tenant_id = $1", [m.a.tenantId]);
  const token = await tenantLogin(api, m.a.adminEmail);
  for (const [start, end] of [["7:00", "08:00"], ["24:00", "08:00"], ["07:60", "08:00"], ["aa:bb", "08:00"], ["", ""], ["07:00", "07:00"], [" 7:00", "08:00"]] as const) {
    const res = await api.call("PUT", "/tenant/v1/notification-settings", { token, body: { quiet_hours: { start, end } } });
    assert.equal(res.status, 400, `${start}–${end}: ${res.text}`);
  }
  for (const body of [{ quiet_hours: { start: "07:00" } }, { quiet_hours: { start: "07:00", end: "08:00", extra: 1 } }, {}, { quiet_hours: "07:00-08:00" }]) {
    assert.equal((await api.call("PUT", "/tenant/v1/notification-settings", { token, body })).status, 400, JSON.stringify(body));
  }
});

test("分页游标：伪造、乱写都是 400，不会 500；游标不能带出别家", async () => {
  const token = await tenantLogin(api, m.a.adminEmail);
  const forged = Buffer.from(JSON.stringify({ t: "not-a-time", id: "not-a-uuid" })).toString("base64url");
  for (const cursor of ["garbage", forged, "%00", "e30"]) {
    const tenantRes = await api.call("GET", `/tenant/v1/notifications?cursor=${cursor}`, { token });
    assert.equal(tenantRes.status, 400, `租户 ${cursor}: ${tenantRes.text}`);
    const platformRes = await api.call("GET", `/platform/v1/notifications?cursor=${cursor}`, { token: m.staff.operations.token });
    assert.equal(platformRes.status, 400, `平台 ${cursor}: ${platformRes.text}`);
  }
});

test("分页：同一轮任务写的记录创建时间完全相同，翻页不重不漏", async () => {
  const seeded = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 92 * HOUR) });
  const eventId = await ownerInsertEvent(m.a.tenantId, "order.rescue_assigned", seeded.id);
  const now = api.clock.now();
  for (let index = 0; index < 7; index += 1) {
    await api.db.owner.query(
      `insert into notifications (event_id, tenant_id, event, audience, locale, channel, recipient, order_id, order_no, status, sent_at, next_attempt_at, expires_at, created_at, updated_at)
       values ($1, $2, 'order.rescue_assigned', 'tenant', 'zh-CN', 'email', $3, $4, $5, 'sent', $6, $6, $6, $6, $6)`,
      [eventId, m.a.tenantId, `user${index}@market-a.test`, seeded.id, seeded.orderNo, now],
    );
  }
  const token = await tenantLogin(api, m.a.adminEmail);
  for (const [url, auth] of [[`/tenant/v1/notifications?order_id=${seeded.id}&limit=3`, token], [`/platform/v1/notifications?order_id=${seeded.id}&limit=3`, m.staff.operations.token]] as const) {
    const seen: string[] = [];
    let next: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const res = await api.call("GET", `${url}${next === null ? "" : `&cursor=${encodeURIComponent(next)}`}`, { token: auth });
      assert.equal(res.status, 200, res.text);
      assert.equal(res.body.total, 7);
      seen.push(...res.body.items.map((item: any) => item.id));
      next = res.body.next_cursor;
      if (next === null) break;
    }
    assert.equal(seen.length, 7, url);
    assert.equal(new Set(seen).size, 7, url);
  }
});

test("权限矩阵（供应商）：管理员能读能改；调度、只读能读不能改；其余角色都不能读", async () => {
  const token = await tenantLogin(api, m.a.adminEmail);
  const matrix: [string, number, number][] = [["dispatch", 200, 403], ["readonly", 200, 403], ["pricing", 403, 403], ["finance", 403, 403]];
  for (const [role, read, write] of matrix) {
    const email = `${role}-${randomUUID().slice(0, 8)}@market-a.test`;
    const user = await addTenantUser(api, token, email, role);
    const roleToken = user?.token ?? (await tenantLogin(api, email));
    assert.equal((await api.call("GET", "/tenant/v1/notifications", { token: roleToken })).status, read, `${role} 读记录`);
    assert.equal((await api.call("GET", "/tenant/v1/notification-settings", { token: roleToken })).status, read, `${role} 读设置`);
    assert.equal((await api.call("PUT", "/tenant/v1/notification-settings", { token: roleToken, body: { quiet_hours: null } })).status, write, `${role} 改设置`);
  }
});

test("跨门户、没登录：平台令牌进不了租户接口，租户令牌进不了平台接口，不带令牌都是 401", async () => {
  const tenantToken = await tenantLogin(api, m.a.adminEmail);
  const id = randomUUID();
  for (const [method, url] of [["GET", "/platform/v1/notifications"], ["POST", `/platform/v1/notifications/${id}/retry`], ["GET", "/platform/v1/notification-templates"]] as const) {
    assert.equal((await api.call(method, url)).status, 401, url);
    assert.equal((await api.call(method, url, { token: tenantToken })).status, 401, `租户令牌 ${url}`);
  }
  for (const [method, url] of [["GET", "/tenant/v1/notifications"], ["GET", "/tenant/v1/notification-settings"], ["PUT", "/tenant/v1/notification-settings"]] as const) {
    assert.equal((await api.call(method, url, method === "PUT" ? { body: { quiet_hours: null } } : {})).status, 401, url);
    assert.equal((await api.call(method, url, { token: m.staff.operations.token, ...(method === "PUT" ? { body: { quiet_hours: null } } : {}) })).status, 401, `平台令牌 ${url}`);
  }
});

async function customRole(grants: string[], scope: { city_ids: string[] | null; channel_ids: string[] | null } = { city_ids: null, channel_ids: null }): Promise<{ token: string; email: string; key: string }> {
  const created = await api.call("POST", "/platform/v1/roles", { token: m.root, body: { name: `QA角色-${randomUUID().slice(0, 8)}`, grants, data_scope: scope } });
  assert.equal(created.status, 201, created.text);
  const key = created.body.role?.key ?? created.body.key;
  const staff = await addStaff(api, m.root, `qa-${randomUUID().slice(0, 8)}@platform.test`, key);
  return { token: staff.token, email: staff.email, key };
}

test("权限组合（平台）：只有查看权限能读不能重试；没有通知权限的什么都不能；内置角色各就各位", async () => {
  const order = await paidSiteOrder();
  await site.app.notificationJobs.expandEvents(api.clock.now());
  const row = (await api.db.owner.query<{ id: string }>("select id from notifications where order_id = $1 and audience = 'guest'", [order.orderId])).rows[0]!;
  await api.db.owner.query("update notifications set status = 'failed', last_error_code = 'TIMEOUT', last_error_message = '超时' where id = $1", [row.id]);

  const viewOnly = await customRole(["notifications:view"]);
  assert.equal((await api.call("GET", "/platform/v1/notifications", { token: viewOnly.token })).status, 200);
  assert.equal((await api.call("GET", "/platform/v1/notification-templates", { token: viewOnly.token })).status, 200);
  assert.equal((await site.call("POST", `/platform/v1/notifications/${row.id}/retry`, { token: viewOnly.token })).status, 403);
  assert.equal(smtp.messages.length, 0);

  const noNotify = await customRole(["orders:view"]);
  assert.equal((await api.call("GET", "/platform/v1/notifications", { token: noNotify.token })).status, 403);
  assert.equal((await site.call("POST", `/platform/v1/notifications/${row.id}/retry`, { token: noNotify.token })).status, 403);

  const finance = await addStaff(api, m.root, `finance-${randomUUID().slice(0, 8)}@platform.test`, "finance");
  assert.equal((await api.call("GET", "/platform/v1/notifications", { token: finance.token })).status, 403, "财务不在 ADR 列的角色里");
  const audited = await api.db.owner.query("select 1 from audit_logs where resource = 'notification' and resource_id = $1", [row.id]);
  assert.equal(audited.rowCount, 0, "被权限挡住的重试不写审计");
});

test("数据范围：限定渠道的员工只看得到该渠道订单的记录；按订单号、订单编号都查不到范围外的；重试 404；范围内的能读能重试", async () => {
  const order = await paidSiteOrder();
  await site.app.notificationJobs.expandEvents(api.clock.now());
  const row = (await api.db.owner.query<{ id: string }>("select id from notifications where order_id = $1 and audience = 'guest'", [order.orderId])).rows[0]!;
  await api.db.owner.query("update notifications set status = 'failed', last_error_code = 'TIMEOUT', last_error_message = '超时' where id = $1", [row.id]);
  const saleChannel = (await api.db.owner.query<{ channel_id: string }>("select channel_id from order_sales where order_id = $1", [order.orderId])).rows[0]!.channel_id;
  const otherChannel = (await newChannel(api, m.staff.cm1.token, { name: `其他渠道-${randomUUID().slice(0, 6)}` })).id;

  const outside = await customRole(["notifications:view", "notifications:edit", "orders:view"], { city_ids: null, channel_ids: [otherChannel] });
  for (const query of [`?order_id=${order.orderId}`, `?order_no=${order.orderNo}`, "?audience=guest", ""]) {
    const res = await api.call("GET", `/platform/v1/notifications${query}`, { token: outside.token });
    assert.equal(res.status, 200, res.text);
    assert.ok(!res.body.items.some((item: any) => item.order?.id === order.orderId), `范围外的看到了 ${query}`);
    assert.equal(res.body.summary.waiting, 0, "限定范围的人不该看到全平台的积压数");
  }
  assert.equal((await site.call("POST", `/platform/v1/notifications/${row.id}/retry`, { token: outside.token })).status, 404);
  assert.equal(smtp.messages.length, 0);

  const inside = await customRole(["notifications:view", "notifications:edit", "orders:view"], { city_ids: null, channel_ids: [saleChannel] });
  const visible = await api.call("GET", `/platform/v1/notifications?order_id=${order.orderId}`, { token: inside.token });
  assert.ok(visible.body.items.some((item: any) => item.id === row.id), "范围内的看得到");
  const retried = await site.call("POST", `/platform/v1/notifications/${row.id}/retry`, { token: inside.token });
  assert.equal(retried.status, 200, retried.text);
  assert.equal(retried.body.notification.status, "sent");
});

test("隐私：服务器错误回显收件人和订单内容时，接口、记录、日志、审计里都没有收件人全文和令牌", async () => {
  const order = await paidSiteOrder();
  await site.app.notificationJobs.expandEvents(api.clock.now());
  smtp.behave({ rejectRecipient: true, errorDetail: `<${GUEST_EMAIL}> mailbox unavailable, token nzo_FAKEFAKEFAKE` });
  await site.app.notificationJobs.tick();
  const row = (await api.db.owner.query<any>("select * from notifications where order_id = $1 and audience = 'guest'", [order.orderId])).rows[0];
  assert.deepEqual([row.status, row.last_error_code], ["failed", "RECIPIENT_REJECTED"]);
  assert.ok(!String(row.last_error_message).includes(GUEST_EMAIL), "错误信息存了服务器原文");
  assert.ok(!String(row.last_error_message).includes("nzo_"));

  smtp.behave({ rejectData: true, errorDetail: `refused for ${GUEST_EMAIL}` });
  const retried = await site.call("POST", `/platform/v1/notifications/${row.id}/retry`, { token: m.staff.operations.token });
  assert.equal(retried.status, 200, retried.text);
  assert.equal(retried.body.notification.recipient, "gu***@example.com");
  assert.ok(!retried.text.includes(GUEST_EMAIL));

  const list = await api.call("GET", `/platform/v1/notifications?order_id=${order.orderId}`, { token: m.staff.operations.token });
  assert.ok(!list.text.includes(GUEST_EMAIL));
  assert.ok(!list.text.includes("refused for"));
  const logs = logLines.join("");
  assert.ok(!logs.includes(GUEST_EMAIL), "收件人进了日志");
  assert.ok(!logs.includes("gu***@example.com"), "打码的也不该写日志（ADR 0049）");
  assert.ok(!logs.includes("nzo_"), "令牌进了日志");
  const audit = await api.db.owner.query("select * from audit_logs where resource = 'notification' and resource_id = $1", [row.id]);
  assert.equal(audit.rowCount, 1);
  assert.ok(!JSON.stringify(audit.rows).includes(GUEST_EMAIL));
  assert.ok(!JSON.stringify(audit.rows).includes("example.com"), "审计连打码的收件人都不该有");
});

test("隐私：查看链接的令牌在失败、重试、拒收时都不进库和日志；发件箱的 data 没有邮箱和金额；记录表没有正文列", async () => {
  const order = await paidSiteOrder();
  smtp.behave({ dropOnConnect: true });
  await site.app.notificationJobs.tick();
  smtp.reset();
  const row = (await api.db.owner.query<any>("select * from notifications where order_id = $1 and audience = 'guest'", [order.orderId])).rows[0];
  await api.db.owner.query("update notifications set next_attempt_at = $2 where id = $1", [row.id, api.clock.now()]);
  await site.app.notificationJobs.tick();
  const mail = smtp.messages.find((message) => message.to.includes(GUEST_EMAIL));
  assert.ok(mail);
  const decoded = Buffer.from(mail.data.slice(mail.data.search(/\r?\n\r?\n/)).replace(/\s/g, ""), "base64").toString("utf8");
  const raw = /nzo_[A-Za-z0-9_-]+/.exec(`${decoded}\n${mail.data.replace(/=\r?\n/g, "")}`);
  assert.ok(raw, "邮件里找不到令牌");
  const token = raw[0];
  const dump = JSON.stringify([(await api.db.owner.query("select * from notifications")).rows, (await api.db.owner.query("select * from notification_events")).rows, (await api.db.owner.query("select * from audit_logs")).rows, (await api.db.owner.query("select * from site_order_links")).rows]);
  assert.ok(!dump.includes(token), "令牌进了库");
  assert.ok(!logLines.join("").includes(token), "令牌进了日志");
  const events = (await api.db.owner.query<{ data: unknown }>("select data from notification_events where order_id = $1", [order.orderId])).rows;
  for (const event of events) assert.doesNotMatch(JSON.stringify(event.data), /@|sell|markup|minor|amount|nzo_/i);
  const columns = (await api.db.owner.query<{ column_name: string }>("select column_name from information_schema.columns where table_schema = current_schema() and table_name = 'notifications'")).rows.map((column) => column.column_name);
  for (const forbidden of ["subject", "body", "text", "html", "token"]) assert.ok(!columns.includes(forbidden), forbidden);
});

test("接口返回的字段是白名单：记录里没有内部字段（租约令牌、完整邮箱、事件编号）；供应商接口不含任何价钱字段", async () => {
  const order = await paidSiteOrder();
  await site.app.notificationJobs.tick();
  const { self } = sideOf(order.tenantId);
  const res = await api.call("GET", `/tenant/v1/notifications?order_id=${order.orderId}`, { token: await tenantLogin(api, self.adminEmail) });
  assert.equal(res.status, 200, res.text);
  assert.ok(res.body.items.length > 0);
  const keys = [...allKeys(res.body)];
  for (const key of keys) assert.doesNotMatch(key, /sell|markup|paid|refund|fx|price|amount|lease|tenant_id|event_id|message_id|token/i, key);
  const settings = await api.call("GET", "/tenant/v1/notification-settings", { token: await tenantLogin(api, self.adminEmail) });
  for (const key of allKeys(settings.body)) assert.doesNotMatch(key, /sell|markup|paid|refund|price|amount|tenant_id/i, key);
});

test("被拒绝的重试（状态不对、找不到）不写审计；重试的错误响应不回显收件人", async () => {
  const order = await paidSiteOrder();
  await site.app.notificationJobs.tick();
  const row = (await api.db.owner.query<{ id: string }>("select id from notifications where order_id = $1 and audience = 'guest'", [order.orderId])).rows[0]!;
  const refused = await site.call("POST", `/platform/v1/notifications/${row.id}/retry`, { token: m.staff.operations.token });
  assert.deepEqual([refused.status, refused.body.error.code], [409, "NOTIFICATION_NOT_RETRYABLE"]);
  assert.ok(!refused.text.includes(GUEST_EMAIL));
  assert.equal((await site.call("POST", "/platform/v1/notifications/not-a-uuid/retry", { token: m.staff.operations.token })).status, 404);
  assert.equal((await api.db.owner.query("select 1 from audit_logs where resource = 'notification' and resource_id = $1", [row.id])).rowCount, 0);
});

test("邮件原文不含 SMTP 密码和账号密码", async () => {
  const order = await paidSiteOrder();
  await site.app.notificationJobs.tick();
  assert.ok(smtp.messages.length > 0, order.orderId);
  for (const message of smtp.messages) assert.ok(!message.data.includes("fake-smtp-password") && !message.data.includes(TEST_PASSWORD));
});
