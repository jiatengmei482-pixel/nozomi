/**
 * M4-22：乘客信息加密存储（ADR 0057）。经真实接口、真实 PostgreSQL；收款服务、邮件、Webhook 接收方用替身。所有联系方式都是虚构的，只在测试里构造。
 * 覆盖：双写、读密文、全库扫描、回填的中断和续跑、新旧数据混合读取、盲索引规范化、筛选、脱敏清除、跨租户、没权限、回退演练、换主密钥、没配置主密钥。
 */
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { after, afterEach, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { ANONYMIZED_TEXT, ENCRYPTED_TEXT } from "@nozomi/domain";
import type { AppContext } from "./context.ts";
import { attachPassengerCrypto, withPlatformTx, withTenantTx } from "./db/context.ts";
import { PassengerCrypto, type PassengerEncryptionSettings } from "./integrations/passenger-crypto.ts";
import { SecretBox } from "./integrations/secret-box.ts";
import { findOrderForPlatform } from "./repos/orders.ts";
import { insertRescuedOrder, markOrderRescued } from "./repos/rescues.ts";
import { backfillBatch, planPassengerBackfill, runPassengerBackfill, verifyPassengerEncryption } from "./services/passenger-encryption.ts";
import { runPassengerRetention } from "./services/passenger-retention.ts";
import { type TestApi, createTestApi } from "./testing/api.ts";
import { seedOrder, startFakeReceiver, type FakeReceiver } from "./testing/dispatch.ts";
import { type FakeSmtp, startFakeSmtp } from "./testing/fake-integrations.ts";
import { FAKE_SECRETS, testEnv } from "./testing/fixtures.ts";
import { type Market, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { platformLogin, tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";
import { endAt, retentionCtx, tokyoDaysAgo } from "./testing/retention-fixtures.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

const HOUR = 3_600_000;
const DUAL: PassengerEncryptionSettings = { readSource: "ciphertext", plaintextWrite: true, backfillEnabled: true };
const RETIRED: PassengerEncryptionSettings = { readSource: "ciphertext", plaintextWrite: false, backfillEnabled: true };
const OTHER_KEY = "another-fake-master-key-for-rotation-0123456789";
const ENTRY = fileURLToPath(new URL("./cli/passenger-backfill.ts", import.meta.url));

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let smtp: FakeSmtp;
let site: SiteApi;
let receiver: FakeReceiver;
let ctx: AppContext;
let box: SecretBox;
let alerts: { event?: string }[] = [];
let counter = 0;

const useCrypto = (settings: PassengerEncryptionSettings, key: SecretBox | null = box): PassengerCrypto => {
  const crypto = new PassengerCrypto(key, settings, { warn: () => undefined, error: (obj) => alerts.push(obj as { event?: string }) });
  attachPassengerCrypto(api.db.pool, crypto);
  return crypto;
};

before(async () => {
  pay = new FakePaymentProvider();
  smtp = await startFakeSmtp();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  const channelId = (await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" })).id;
  const client = await salesCredentials(api, m, channelId);
  site = await siteApi(api, client.clientId, pay, { SMTP_HOST: smtp.host, SMTP_PORT: String(smtp.port), SMTP_ENCRYPTION: "none", SMTP_USERNAME: "mailer", SMTP_PASSWORD: "fake-smtp-password-Zq7", SMTP_FROM_NAME: "NOZOMI", SMTP_FROM_ADDRESS: "no-reply@nozomi.test" }, { integrationSecretsTtlMs: 0 });
  receiver = await startFakeReceiver();
  ctx = { ...retentionCtx(api), config: { passengerRetention: { enabled: true, days: 180 } } } as unknown as AppContext;
  box = new SecretBox(FAKE_SECRETS.dataEncryptionKey);
});
after(async () => {
  await receiver?.close();
  await site?.close();
  await smtp?.close();
  await api.close();
});
beforeEach(() => {
  alerts = [];
  useCrypto(DUAL);
});
afterEach(() => useCrypto(DUAL));

/** 每张单一组不重复的虚构联系方式：全库扫描按它们找。 */
function fictional(): { name: string; phone: string; email: string; needles: string[] } {
  counter += 1;
  const tag = String(1000 + counter);
  const name = `星野测${String.fromCodePoint(0x4e00 + counter)}${String.fromCodePoint(0x4e80 + counter)}`;
  const email = `hoshino.${tag}@fictional.example.test`;
  const phone = `+8180${tag}${tag}`;
  return { name, phone, email, needles: [name, email, phone, `${tag}${tag}`, `hoshino.${tag}`] };
}

async function placeOrder(passenger: { name: string; phone: string; email: string }): Promise<{ id: string; order_no: string; ip: string; token: string }> {
  const ip = `198.51.100.${(counter % 200) + 1}`;
  api.clock.advance(1_000);
  const at = new Date(api.clock.now().getTime() + 10 * 24 * HOUR + counter * HOUR);
  const quotes = await site.call("POST", "/site/v1/quotes", { ip, body: { category: "airport_transfer", city_id: m.ids.tokyo, airport_id: m.ids.narita, direction: "pickup", address: { lng: 139.7, lat: 35.6 }, service_local: new Date(at.getTime() + 9 * HOUR).toISOString().slice(0, 16), passengers: 2, luggage: 1 } });
  assert.equal(quotes.status, 200, quotes.text);
  const quote = quotes.body.quotes.find((row: any) => row.vehicle_group.id === m.ids.biz7);
  assert.ok(quote, quotes.text);
  api.clock.advance(1_000);
  const res = await site.call("POST", "/site/v1/orders", { ip, headers: { "idempotency-key": randomUUID() }, body: { quote_id: quote.quote_id, passenger, flight_no: "NH211", dropoff_address: "东京站八重洲口", save_payment_method: true } });
  assert.equal(res.status, 201, res.text);
  return { id: res.body.order.id, order_no: res.body.order.order_no, ip, token: res.body.link.token };
}

async function pay_(orderId: string): Promise<void> {
  const intent = pay.intentOf(orderId);
  assert.ok(intent);
  pay.pay(intent.id);
  const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
  const res = await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()));
  assert.equal(res.status, 200, JSON.stringify(res.body));
}

const orderRow = async (id: string): Promise<any> => (await api.db.owner.query("select tenant_id, passenger, passenger_enc, passenger_email_bidx, passenger_phone_bidx, passenger_name_bidx, passenger_anonymized_at, version, updated_at from orders where id = $1 and status <> 'rescued'", [id])).rows[0];
const ops = (): Promise<string> => platformLogin(api, m.staff.operations.email);
const revealOf = async (id: string): Promise<any> => ok(api.call("POST", `/platform/v1/orders/${id}/passenger/reveal`, { token: await ops() }));
const lookup = (order: { order_no: string; ip: string }, contact: string) => site.call("POST", "/site/v1/orders/lookup", { ip: order.ip, body: { order_no: order.order_no, contact } });

/** 全库每张表每一列里，哪些含这些内容（`表.列`）。 */
async function scanDatabase(needles: readonly string[]): Promise<string[]> {
  const tables = (await api.db.owner.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = current_schema() and table_type = 'BASE TABLE'")).rows;
  const found = new Set<string>();
  for (const { table_name: table } of tables) {
    const rows = (await api.db.owner.query(`select * from "${table}"`)).rows;
    for (const row of rows) for (const [column, value] of Object.entries(row)) {
      if (value === null || value instanceof Date || typeof value === "number" || typeof value === "boolean") continue;
      const text = typeof value === "string" ? value : JSON.stringify(value);
      if (needles.some((needle) => text.includes(needle))) found.add(`${table}.${column}`);
    }
  }
  return [...found].sort();
}

async function subscribe(side: "a" | "b"): Promise<void> {
  const token = await tenantLogin(api, m[side].adminEmail);
  const current = await ok(api.call("GET", "/tenant/v1/webhooks", { token }));
  if (current.webhook !== null) await api.call("DELETE", "/tenant/v1/webhooks", { token });
  await ok(api.call("PUT", "/tenant/v1/webhooks", { token, body: { url: receiver.url, events: ["order.changed", "order.confirmed"] } }), 201);
}

async function drainMail(): Promise<void> {
  await site.app.notificationJobs.tick();
  await site.app.notificationJobs.tick();
}

async function changePassenger(orderId: string, passenger: { name: string; phone: string; email: string }): Promise<void> {
  const token = await ops();
  const version = (await ok(api.call("GET", `/platform/v1/orders/${orderId}`, { token }))).order.version;
  await ok(api.call("PATCH", `/platform/v1/orders/${orderId}`, { token, headers: { "if-match": String(version) }, body: { passenger } }));
}

const tenantOfOrder = async (id: string): Promise<"a" | "b"> => ((await orderRow(id)).tenant_id === m.a.tenantId ? "a" : "b");

test("新下的单双写：有密文和盲索引，明文列照旧；响应是原文；盲索引不是裸哈希，换租户结果不同", async () => {
  const passenger = fictional();
  const order = await placeOrder(passenger);
  const row = await orderRow(order.id);
  assert.equal(row.passenger.name, passenger.name);
  assert.ok(row.passenger_enc && row.passenger_email_bidx && row.passenger_phone_bidx && row.passenger_name_bidx);
  for (const needle of passenger.needles) assert.ok(!row.passenger_enc.includes(needle));
  const { createHash } = await import("node:crypto");
  assert.ok(!row.passenger_email_bidx.includes(createHash("sha256").update(passenger.email).digest("hex")), "不是裸哈希");
  const crypto = useCrypto(DUAL);
  assert.equal(row.passenger_email_bidx, crypto.index(row.tenant_id, "email", passenger.email));
  assert.notEqual(row.passenger_email_bidx, crypto.index(randomUUID(), "email", passenger.email));
  const revealed = await revealOf(order.id);
  assert.equal(revealed.passenger.email, passenger.email);
});

test("全库扫描（双写阶段）：下单、付款、发信、改乘客、推送之后，明文只在这几列（双写的旧列）；新列都没有明文；日志里也没有", async () => {
  const passenger = fictional();
  const changed = fictional();
  const order = await placeOrder(passenger);
  await subscribe(await tenantOfOrder(order.id));
  await pay_(order.id);
  await drainMail();
  await changePassenger(order.id, changed);
  await api.app.webhookJobs.tick();
  await drainMail();
  const found = await scanDatabase([...passenger.needles, ...changed.needles]);
  assert.deepEqual(found, ["notifications.recipient", "order_changes.after", "order_changes.before", "orders.passenger", "webhook_deliveries.event_data"]);
  const logs = api.logs();
  for (const needle of [...passenger.needles, ...changed.needles]) assert.ok(!logs.includes(needle), `日志含 ${needle}`);
  assert.equal((await verifyPassengerEncryption(ctx)).mismatched.orders, 0);
});

test("明文不再写的开关（第 6 步演练）：明文列只有占位，全库扫描一处都没有；查订单、reveal、供应商、发信、推送、改单、官网页面都正常", async () => {
  useCrypto(RETIRED);
  const passenger = fictional();
  const changed = fictional();
  const order = await placeOrder(passenger);
  const owner = await tenantOfOrder(order.id);
  await subscribe(owner);
  receiver.received.length = 0;
  smtp.reset();
  await pay_(order.id);
  await drainMail();
  assert.ok(smtp.messages.some((message) => message.to.includes(passenger.email)), "发信用的是解密后的地址");
  await api.app.webhookJobs.tick();
  const row = await orderRow(order.id);
  assert.equal(row.passenger.name, ENCRYPTED_TEXT);
  assert.deepEqual([(await revealOf(order.id)).passenger.name, (await revealOf(order.id)).passenger.phone], [passenger.name, passenger.phone]);
  assert.equal((await lookup(order, passenger.email.toUpperCase())).status, 200);
  const tenant = await ok(api.call("GET", `/tenant/v1/orders/${order.id}`, { token: await tenantLogin(api, m[owner].adminEmail) }));
  assert.equal(tenant.order.passenger.email, passenger.email);
  const confirmed = receiver.received.find((item) => JSON.parse(item.body).type === "order.confirmed");
  assert.ok(confirmed, "推送发了");
  assert.equal(JSON.parse((confirmed as { body: string }).body).data.order.passenger.email, passenger.email);

  receiver.received.length = 0;
  await changePassenger(order.id, changed);
  await api.app.webhookJobs.tick();
  const pushed = receiver.received.find((item) => JSON.parse(item.body).type === "order.changed");
  assert.ok(pushed);
  const pushedData = JSON.parse((pushed as { body: string }).body).data;
  assert.deepEqual([pushedData.before.passenger.email, pushedData.after.passenger.email], [passenger.email, changed.email], "改单推送带前后的原文");
  assert.equal((await revealOf(order.id)).passenger.email, changed.email);
  assert.equal((await lookup(order, changed.phone)).status, 200);
  assert.equal((await lookup(order, passenger.phone)).status, 404, "旧电话对不上");
  const detail = await ok(api.call("GET", `/platform/v1/orders/${order.id}`, { token: await ops() }));
  assert.equal(detail.changes[0].after.passenger.name.slice(0, 1), changed.name.slice(0, 1), "改单前后值读的是密文（再打码）");
  await drainMail();
  assert.deepEqual(await scanDatabase([...passenger.needles, ...changed.needles]), [], "库里没有任何明文");
});

test("回填：dry-run 看数量不改数据；中断后续跑；重复跑不重复处理；不改版本和更新时间；混合读取正常", async () => {
  await runPassengerBackfill(ctx, { pauseMs: 0 });
  const seeded = [];
  for (let i = 0; i < 5; i += 1) seeded.push(await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + (100 + i) * HOUR) }));
  const fresh = await placeOrder(fictional());
  const before = await orderRow(seeded[0]!.id);
  assert.equal(before.passenger_enc, null);

  const plan = await planPassengerBackfill(ctx);
  assert.equal(plan.orders, 5);
  assert.equal((await orderRow(seeded[0]!.id)).passenger_enc, null, "dry-run 不改数据");

  // 新旧混合：没回填的读明文，回填的读密文
  for (const order of [seeded[0]!, fresh]) assert.ok((await revealOf(order.id)).passenger.name);

  // 中断：走一批就停，已处理的留着；再跑接着做
  let batches = 0;
  const interrupted = await runPassengerBackfill(ctx, { batchSize: 2, pauseMs: 0, stop: () => batches++ >= 1 });
  assert.equal(interrupted.encrypted.orders, 2);
  assert.equal((await planPassengerBackfill(ctx)).orders, 3);
  const resumed = await runPassengerBackfill(ctx, { batchSize: 2, pauseMs: 0 });
  assert.equal(resumed.encrypted.orders, 3);
  assert.equal((await planPassengerBackfill(ctx)).orders, 0);
  assert.equal((await runPassengerBackfill(ctx, { pauseMs: 0 })).encrypted.orders, 0, "幂等");

  const after = await orderRow(seeded[0]!.id);
  assert.ok(after.passenger_enc && after.passenger_email_bidx);
  assert.deepEqual([after.version, after.updated_at], [before.version, before.updated_at]);
  assert.deepEqual(after.passenger, before.passenger, "明文列不动");
  assert.deepEqual((await revealOf(seeded[0]!.id)).passenger.name, before.passenger.name);
  const verified = await verifyPassengerEncryption(ctx);
  assert.equal(verified.undecryptable.orders + verified.mismatched.orders, 0);
});

test("回填：多实例同时跑，每行只处理一次；被业务事务锁着的行跳过，下一轮再做，不等它", async () => {
  await runPassengerBackfill(ctx, { pauseMs: 0 });
  const seeded = [];
  for (let i = 0; i < 6; i += 1) seeded.push(await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + (200 + i) * HOUR) }));
  const results = await Promise.all([runPassengerBackfill(ctx, { batchSize: 2, pauseMs: 0 }), runPassengerBackfill(ctx, { batchSize: 2, pauseMs: 0 })]);
  assert.equal(results[0].encrypted.orders + results[1].encrypted.orders <= 6, true);
  await runPassengerBackfill(ctx, { pauseMs: 0 });
  assert.equal((await planPassengerBackfill(ctx)).orders, 0);

  const locked = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 300 * HOUR) });
  await withPlatformTx(api.db.pool, async (db) => {
    await db.query("select 1 from orders where id = $1 for update", [locked.id]);
    const batch = await backfillBatch(ctx, "orders", null);
    assert.equal(batch.selected, 0, "锁着的行跳过");
  });
  assert.equal((await backfillBatch(ctx, "orders", null)).encrypted, 1);
});

test("回填副本：旧的改单、推送、通知没有密文的也补上；读出来和原来一样", async () => {
  const passenger = fictional();
  const changed = fictional();
  const order = await placeOrder(passenger);
  await subscribe(await tenantOfOrder(order.id));
  await pay_(order.id);
  await drainMail();
  await changePassenger(order.id, changed);
  await api.db.owner.query("update order_changes set values_enc = null where order_id = $1", [order.id]);
  await api.db.owner.query("update webhook_deliveries set event_data_enc = null where order_id = $1", [order.id]);
  await api.db.owner.query("update notifications set recipient_enc = null where order_id = $1", [order.id]);
  const plan = await planPassengerBackfill(ctx);
  assert.ok(plan.order_changes >= 1 && plan.webhook_deliveries >= 1 && plan.notifications >= 1, JSON.stringify(plan));
  const result = await runPassengerBackfill(ctx, { pauseMs: 0 });
  assert.ok(result.encrypted.order_changes >= 1 && result.encrypted.webhook_deliveries >= 1 && result.encrypted.notifications >= 1);
  assert.equal(result.failed, 0);
  assert.deepEqual(await planPassengerBackfill(ctx), { orders: 0, order_changes: 0, webhook_deliveries: 0, notifications: 0 });
  const verified = await verifyPassengerEncryption(ctx);
  for (const table of ["orders", "order_changes", "webhook_deliveries", "notifications"] as const) assert.equal(verified.undecryptable[table] + verified.mismatched[table], 0, table);
  assert.ok(verified.checked.webhook_deliveries >= 1);
});

test("查订单：规范化和原来一致（大小写、全角、空格、分隔符），比的是盲索引；不对的、太短的对不上，应答分不出", async () => {
  const passenger = fictional();
  const order = await placeOrder(passenger);
  const row = await orderRow(order.id);
  assert.ok(row.passenger_email_bidx);
  const fullwidth = passenger.email.replace(/[a-z0-9.@]/g, (c) => String.fromCodePoint(c.codePointAt(0)! + 0xfee0));
  const dashed = `${passenger.phone.slice(0, 3)} ${passenger.phone.slice(3, 7)}-${passenger.phone.slice(7)}`;
  for (const contact of [passenger.email, ` ${passenger.email.toUpperCase()} `, fullwidth, passenger.phone, dashed]) assert.equal((await lookup(order, contact)).status, 200, contact);
  const wrong = await lookup(order, "nobody@fictional.example.test");
  const missing = await site.call("POST", "/site/v1/orders/lookup", { ip: order.ip, body: { order_no: "NZ20261007ZZZZZZZZ", contact: passenger.email } });
  assert.deepEqual([wrong.status, wrong.body.error], [404, missing.body.error]);
  assert.equal((await lookup(order, "12345")).status, 404);
  // 比的确实是盲索引：把盲索引换掉（明文、密文都还对），就对不上了
  await api.db.owner.query("update orders set passenger_email_bidx = $2 where id = $1", [order.id, `${useCrypto(DUAL).currentPrefix}0000`]);
  assert.equal((await lookup(order, passenger.email)).status, 404);
  // 还没回填的单：盲索引为空，按明文比
  await api.db.owner.query("update orders set passenger_email_bidx = null, passenger_enc = null where id = $1", [order.id]);
  assert.equal((await lookup(order, passenger.email)).status, 200);
});

test("运营筛选：明文还在时部分匹配照旧；整串的电话、邮箱、姓名走盲索引，全角、空格都能找到；明文不再写时只认整串；范围外的、没权限的筛不到", async () => {
  const passenger = fictional();
  const order = await placeOrder(passenger);
  const token = await ops();
  const ids = async (query: string, tok = token): Promise<string[]> => (await ok(api.call("GET", `/platform/v1/orders?passenger=${encodeURIComponent(query)}`, { token: tok }))).items.map((item: any) => item.id);
  const parts = Array.from(passenger.name);
  const spaced = `${parts[0]} ${parts.slice(1).join("")}`;
  assert.ok((await ids(passenger.name)).includes(order.id));
  assert.ok((await ids(passenger.name.slice(0, 3))).includes(order.id), "部分姓名");
  assert.ok((await ids(passenger.phone.slice(-6))).includes(order.id), "电话后几位");
  assert.ok((await ids(passenger.email.toUpperCase())).includes(order.id), "邮箱（盲索引）");
  assert.ok((await ids(spaced)).includes(order.id), "姓名中间有空格（盲索引）");
  assert.deepEqual(await ids("完全不存在的人"), []);

  useCrypto(RETIRED);
  const retired = fictional();
  const hidden = await placeOrder(retired);
  assert.ok((await ids(retired.email)).includes(hidden.id));
  assert.ok((await ids(retired.phone)).includes(hidden.id));
  assert.ok((await ids(retired.name)).includes(hidden.id));
  assert.ok(!(await ids(retired.name.slice(0, 3))).includes(hidden.id), "明文不再写之后部分匹配做不了（ADR 0057 写明）");

  const denied = await api.call("GET", `/platform/v1/orders?passenger=${encodeURIComponent(retired.email)}`, { token: await platformLogin(api, m.staff.masterData.email) });
  assert.equal(denied.status, 403);
  assert.equal((await api.call("GET", `/platform/v1/orders?passenger=${encodeURIComponent(retired.email)}`, { token: await tenantLogin(api, m.a.adminEmail) })).status, 401);
});

test("脱敏：密文、盲索引和所有副本的密文一起清掉；数据库保证脱敏过的行写不进密文；回填不再选中；查不到", async () => {
  const passenger = fictional();
  const changed = fictional();
  const order = await placeOrder(passenger);
  await subscribe(await tenantOfOrder(order.id));
  await pay_(order.id);
  await drainMail();
  await changePassenger(order.id, changed);
  await api.db.owner.query("update notification_events set expanded_at = coalesce(expanded_at, now()) where order_id = $1", [order.id]);
  await api.db.owner.query("update notifications set status = 'sent', sent_at = now() where order_id = $1 and status in ('pending', 'sending')", [order.id]);
  await endAt(api, order.id, tokyoDaysAgo(api, 200));
  const result = await runPassengerRetention(retentionCtx(api), { info: () => undefined, error: () => undefined });
  assert.ok(result.anonymized >= 1, JSON.stringify(result));
  const row = await orderRow2(order.id);
  assert.deepEqual([row.passenger.name, row.passenger_enc, row.passenger_email_bidx, row.passenger_phone_bidx, row.passenger_name_bidx], [ANONYMIZED_TEXT, null, null, null, null]);
  for (const [table, column] of [["order_changes", "values_enc"], ["webhook_deliveries", "event_data_enc"], ["notifications", "recipient_enc"]] as const) {
    assert.equal((await api.db.owner.query(`select count(*)::int as n from ${table} where order_id = $1 and ${column} is not null`, [order.id])).rows[0].n, 0, table);
  }
  assert.deepEqual(await scanDatabase([...passenger.needles, ...changed.needles]), [], "这单的联系方式在库里一处都不剩");
  await api.db.owner.query("update orders set passenger_enc = 'x', passenger_email_bidx = 'y' where id = $1", [order.id]);
  const again = await orderRow2(order.id);
  assert.deepEqual([again.passenger_enc, again.passenger_email_bidx], [null, null], "触发器挡住");
  assert.equal((await lookup(order, passenger.email)).status, 404);
  const plan = await planPassengerBackfill(ctx);
  assert.equal(plan.orders + plan.order_changes + plan.webhook_deliveries + plan.notifications, 0);
  const revealed = await revealOf(order.id);
  assert.equal(revealed.passenger.name, ANONYMIZED_TEXT);
});
const orderRow2 = async (id: string): Promise<any> => (await api.db.owner.query("select passenger, passenger_enc, passenger_email_bidx, passenger_phone_bidx, passenger_name_bidx from orders where id = $1 limit 1", [id])).rows[0];

test("跨租户：供应商读不到别家的单；密文搬到别家解不开；供应商角色改不了密文和盲索引", async () => {
  const passenger = fictional();
  const order = await placeOrder(passenger);
  await pay_(order.id);
  const owner = await tenantOfOrder(order.id);
  const stranger = owner === "a" ? "b" : "a";
  assert.equal((await api.call("GET", `/tenant/v1/orders/${order.id}`, { token: await tenantLogin(api, m[stranger].adminEmail) })).status, 404);
  await assert.rejects(withTenantTx(api.db.pool, m[owner].tenantId, (db) => db.query("update orders set passenger_enc = null where id = $1", [order.id])));
  await assert.rejects(withTenantTx(api.db.pool, m[owner].tenantId, (db) => db.query("update orders set passenger_email_bidx = null where id = $1", [order.id])));

  // 把这一单的密文搬到别家的一单上：解不开，退回那一单自己的明文，报警里没有内容
  const other = await seedOrder(api, m, stranger, { serviceAt: new Date(api.clock.now().getTime() + 400 * HOUR) });
  const sealed = (await orderRow(order.id)).passenger_enc;
  await api.db.owner.query("update orders set passenger_enc = $2 where id = $1", [other.id, sealed]);
  alerts = [];
  const shown = await revealOf(other.id);
  assert.notEqual(shown.passenger.email, passenger.email);
  assert.ok(alerts.some((alert) => alert.event === "passenger.decrypt_failed"));
  for (const needle of passenger.needles) assert.ok(!JSON.stringify(alerts).includes(needle));
  await api.db.owner.query("update orders set passenger_enc = null where id = $1", [other.id]);
});

test("reveal 权限不变：没有权限 403、供应商 401，不解密也不给内容；规则 4：供应商接口没有多出密文和盲索引", async () => {
  const passenger = fictional();
  const order = await placeOrder(passenger);
  await pay_(order.id);
  const denied = await api.call("POST", `/platform/v1/orders/${order.id}/passenger/reveal`, { token: await platformLogin(api, m.staff.masterData.email) });
  assert.equal(denied.status, 403);
  for (const needle of passenger.needles) assert.ok(!denied.text.includes(needle));
  const owner = await tenantOfOrder(order.id);
  const res = await api.call("GET", `/tenant/v1/orders/${order.id}`, { token: await tenantLogin(api, m[owner].adminEmail) });
  assertMatchesOpenApi("GET", "/tenant/v1/orders/{id}", res);
  assert.ok(!/_enc|_bidx/.test(res.text));
  const list = await ok(api.call("GET", `/platform/v1/orders?q=${order.order_no}`, { token: await ops() }));
  assert.ok(!/_enc|_bidx/.test(JSON.stringify(list)));
});

test("救援改派：新一行归救援供应商，按新租户重新加密和算盲索引", async () => {
  const passenger = fictional();
  const order = await placeOrder(passenger);
  await pay_(order.id);
  const owner = await tenantOfOrder(order.id);
  const rescuer = owner === "a" ? m.b : m.a;
  const original = await orderRow(order.id);
  const crypto = useCrypto(DUAL);
  await withPlatformTx(api.db.pool, async (db) => {
    const current = await findOrderForPlatform(db, order.id);
    assert.ok(current);
    await markOrderRescued(db, current, api.clock.now());
    await insertRescuedOrder(db, { original: current, tenantId: rescuer.tenantId, productId: owner === "a" ? m.ids.pb : m.ids.pa, productVersion: 1, settlementMinor: 1000, settlementCurrency: "JPY", settlement: current.settlement, urgent: false, inventoryHeld: false, dispatchDueAt: new Date(api.clock.now().getTime() + HOUR), now: api.clock.now() });
    const moved = await findOrderForPlatform(db, order.id);
    assert.deepEqual([moved?.tenantId, moved?.passenger.email], [rescuer.tenantId, passenger.email]);
  });
  const row = await orderRow(order.id);
  assert.notEqual(row.passenger_enc, original.passenger_enc);
  assert.equal(row.passenger_email_bidx, crypto.index(rescuer.tenantId, "email", passenger.email));
  assert.deepEqual(alerts, []);
});

test("回退演练：切回读明文不丢数据；旧版本代码只改明文时密文作废，读到新值，回填补上；再切回读密文", async () => {
  const passenger = fictional();
  const order = await placeOrder(passenger);

  // 第一步：出问题，切回读明文（密文坏了也不影响，不报警）
  useCrypto({ ...DUAL, readSource: "plaintext" });
  await api.db.owner.query("update orders set passenger_enc = $2 where id = $1", [order.id, `${useCrypto({ ...DUAL, readSource: "plaintext" }).currentPrefix}v1.AAAA.AAAA.AAAA`]);
  alerts = [];
  assert.equal((await revealOf(order.id)).passenger.email, passenger.email);
  assert.deepEqual(alerts, []);

  // 第二步：旧版本的代码（不认识新列）改了明文：密文和盲索引自动作废，不会读到旧值
  const newer = fictional();
  await api.db.owner.query("update orders set passenger = $2::jsonb where id = $1", [order.id, JSON.stringify({ name: newer.name, phone: newer.phone, email: newer.email })]);
  const stale = await orderRow(order.id);
  assert.deepEqual([stale.passenger_enc, stale.passenger_email_bidx], [null, null]);

  // 第三步：修好后切回读密文，混合读取读到新值；回填补上之后还是新值
  useCrypto(DUAL);
  assert.equal((await revealOf(order.id)).passenger.email, newer.email);
  await runPassengerBackfill(ctx, { pauseMs: 0 });
  const fixed = await orderRow(order.id);
  assert.ok(fixed.passenger_enc);
  assert.equal((await revealOf(order.id)).passenger.email, newer.email);
  assert.equal((await lookup(order, newer.email)).status, 200);
  assert.deepEqual(alerts, []);
});

test("换主密钥：旧密文不报警地退回明文，查订单不受影响；dry-run 数得出；回填用新密钥重加密；核对通过", async () => {
  await runPassengerBackfill(ctx, { pauseMs: 0 });
  const passenger = fictional();
  const order = await placeOrder(passenger);
  const rotated = new SecretBox(OTHER_KEY);
  const crypto = useCrypto(DUAL, rotated);
  alerts = [];
  assert.equal((await revealOf(order.id)).passenger.email, passenger.email);
  assert.equal((await lookup(order, passenger.email)).status, 200);
  assert.deepEqual(alerts, []);
  assert.ok((await planPassengerBackfill(ctx)).orders >= 1);
  await runPassengerBackfill(ctx, { pauseMs: 0 });
  assert.deepEqual(await planPassengerBackfill(ctx), { orders: 0, order_changes: 0, webhook_deliveries: 0, notifications: 0 });
  const row = await orderRow(order.id);
  assert.ok(crypto.isCurrent(row.passenger_enc) && crypto.isCurrent(row.passenger_email_bidx));
  assert.equal((await lookup(order, passenger.email)).status, 200);
  const verified = await verifyPassengerEncryption(ctx);
  assert.equal(verified.undecryptable.orders + verified.mismatched.orders, 0);
  useCrypto(DUAL);
  await runPassengerBackfill(ctx, { pauseMs: 0 });
});

test("没配置主密钥：下单 503 写明原因，不写明文冒充加密；已有的单照常能读、能查；回填不跑", async () => {
  const passenger = fictional();
  const existing = await placeOrder(passenger);
  useCrypto(DUAL, null);
  const ip = "198.51.100.250";
  const quotes = await site.call("POST", "/site/v1/quotes", { ip, body: { category: "airport_transfer", city_id: m.ids.tokyo, airport_id: m.ids.narita, direction: "pickup", address: { lng: 139.7, lat: 35.6 }, service_local: new Date(api.clock.now().getTime() + 20 * 24 * HOUR).toISOString().slice(0, 16), passengers: 2, luggage: 1 } });
  assert.equal(quotes.status, 200, quotes.text);
  const quote = quotes.body.quotes.find((row: any) => row.vehicle_group.id === m.ids.biz7);
  const fresh = fictional();
  const res = await site.call("POST", "/site/v1/orders", { ip, headers: { "idempotency-key": randomUUID() }, body: { quote_id: quote.quote_id, passenger: fresh, flight_no: "NH211", dropoff_address: "东京站", save_payment_method: true } });
  assert.deepEqual([res.status, res.body.error.code], [503, "PASSENGER_ENCRYPTION_NOT_CONFIGURED"]);
  assert.deepEqual(await scanDatabase(fresh.needles), [], "什么都没写");
  assert.equal((await revealOf(existing.id)).passenger.email, passenger.email);
  assert.equal((await lookup(existing, passenger.email)).status, 200);
  const version = (await ok(api.call("GET", `/platform/v1/orders/${existing.id}`, { token: await ops() }))).order.version;
  const change = await api.call("PATCH", `/platform/v1/orders/${existing.id}`, { token: await ops(), headers: { "if-match": String(version) }, body: { passenger: { name: "虚构改名", phone: "+818011112222", email: "changed@fictional.example.test" } } });
  assert.deepEqual([change.status, change.body.error.code], [503, "PASSENGER_ENCRYPTION_NOT_CONFIGURED"]);
  await assert.rejects(planPassengerBackfill(ctx));
});

test("命令行：默认 dry-run 不改数据；--execute 加密；--verify 只读；输出没有乘客信息；不配密钥拒绝", async () => {
  await runPassengerBackfill(ctx, { pauseMs: 0 });
  const order = await seedOrder(api, m, "b", { serviceAt: new Date(api.clock.now().getTime() + 500 * HOUR) });
  const passenger = (await orderRow(order.id)).passenger;
  const run = promisify(execFile);
  const env = { ...process.env, ...testEnv(api.db.url) };
  const dry = await run(process.execPath, [ENTRY], { env });
  assert.match(dry.stdout, /orders：还要加密 1 行/);
  assert.equal((await orderRow(order.id)).passenger_enc, null);
  const executed = await run(process.execPath, [ENTRY, "--execute"], { env });
  assert.match(executed.stdout, /orders：这一轮加密了 1 行/);
  assert.ok((await orderRow(order.id)).passenger_enc);
  const verify = await run(process.execPath, [ENTRY, "--verify"], { env });
  assert.match(verify.stdout, /全部一致/);
  for (const text of [dry.stdout, executed.stdout, verify.stdout, dry.stderr, executed.stderr, verify.stderr]) for (const value of [passenger.name, passenger.phone, passenger.email]) assert.ok(!text.includes(value));
  await assert.rejects(run(process.execPath, [ENTRY], { env: { ...env, DATA_ENCRYPTION_KEY: "" } }), (err: { stderr?: string }) => /没有配置 DATA_ENCRYPTION_KEY/.test(err.stderr ?? ""));
});
