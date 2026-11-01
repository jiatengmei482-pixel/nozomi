/**
 * M4-22 QA（ADR 0057）：不丢数据。回填中途崩溃、回填时并发改乘客 / 脱敏 / 救援改派，旧代码只写明文，`--verify` 的结论可不可信，占位字面量，开关来回切，怪字符走完整接口，解不开的行不能拖垮别的单。
 * 真实 PostgreSQL（独立 schema）；收款、邮件、Webhook 接收方用替身；联系方式全部虚构，测试内构造，schema 随 api.close() 删除。已有 passenger-encryption.itest.ts 覆盖的不重复。
 */
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { after, afterEach, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { ANONYMIZED_TEXT, ENCRYPTED_TEXT } from "@nozomi/domain";
import type { AppContext } from "./context.ts";
import { attachPassengerCrypto, withPlatformTx } from "./db/context.ts";
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
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";
import { endAt, retentionCtx, tokyoDaysAgo } from "./testing/retention-fixtures.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

const HOUR = 3_600_000;
const DUAL: PassengerEncryptionSettings = { readSource: "ciphertext", plaintextWrite: true, backfillEnabled: true };
const RETIRED: PassengerEncryptionSettings = { readSource: "ciphertext", plaintextWrite: false, backfillEnabled: true };
const PLAIN_READ: PassengerEncryptionSettings = { readSource: "plaintext", plaintextWrite: true, backfillEnabled: true };
const ENTRY = fileURLToPath(new URL("./cli/passenger-backfill.ts", import.meta.url));
const SILENT = { info: () => undefined, error: () => undefined };

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let smtp: FakeSmtp;
let site: SiteApi;
let receiver: FakeReceiver;
let ctx: AppContext;
let box: SecretBox;
let alerts: object[] = [];
let siteLogs = "";
let counter = 0;

const useCrypto = (settings: PassengerEncryptionSettings, key: SecretBox | null = box): PassengerCrypto => {
  const crypto = new PassengerCrypto(key, settings, { error: (obj) => void alerts.push(obj) });
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
  site = await siteApi(
    api,
    client.clientId,
    pay,
    { SMTP_HOST: smtp.host, SMTP_PORT: String(smtp.port), SMTP_ENCRYPTION: "none", SMTP_USERNAME: "mailer", SMTP_PASSWORD: "fake-smtp-password-Zq7", SMTP_FROM_NAME: "NOZOMI", SMTP_FROM_ADDRESS: "no-reply@nozomi.test" },
    { integrationSecretsTtlMs: 0, logDestination: { write: (line) => void (siteLogs += line) } },
  );
  receiver = await startFakeReceiver();
  ctx = { ...retentionCtx(api), config: { passengerRetention: { enabled: true, days: 180 } } } as unknown as AppContext;
  box = new SecretBox(FAKE_SECRETS.dataEncryptionKey);
  // 让回填卡在某一行上：闸门关着时，回填这一行的 update 一直等（明文没变的 update 才是回填；改乘客、脱敏不等）
  await api.db.owner.query(`
    create table qa_gate (order_id uuid, closed boolean not null);
    insert into qa_gate values (null, false);
    grant select on qa_gate to public;
    create function qa_gate_wait() returns trigger language plpgsql as $$
    begin
      while exists (select 1 from qa_gate where closed and order_id = new.id) loop
        perform pg_sleep(0.02);
      end loop;
      return new;
    end $$;
    create trigger aaa_qa_gate before update of passenger_enc on orders for each row when (new.passenger is not distinct from old.passenger and new.passenger_enc is not null) execute function qa_gate_wait();
  `);
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
afterEach(async () => {
  await api.db.owner.query("update qa_gate set closed = false, order_id = null");
  useCrypto(DUAL);
});

function fictional(): { name: string; phone: string; email: string } {
  counter += 1;
  const tag = String(2000 + counter);
  return { name: `星野数${String.fromCodePoint(0x4e00 + counter)}`, phone: `+8180${tag}${tag}`, email: `data.${tag}@fictional.example.test` };
}

async function quoteFor(ip: string): Promise<string> {
  api.clock.advance(1_000);
  const at = new Date(api.clock.now().getTime() + 10 * 24 * HOUR + counter * HOUR);
  const quotes = await site.call("POST", "/site/v1/quotes", { ip, body: { category: "airport_transfer", city_id: m.ids.tokyo, airport_id: m.ids.narita, direction: "pickup", address: { lng: 139.7, lat: 35.6 }, service_local: new Date(at.getTime() + 9 * HOUR).toISOString().slice(0, 16), passengers: 2, luggage: 1 } });
  assert.equal(quotes.status, 200, quotes.text);
  const quote = quotes.body.quotes.find((row: any) => row.vehicle_group.id === m.ids.biz7);
  assert.ok(quote, quotes.text);
  api.clock.advance(1_000);
  return quote.quote_id;
}

const submitOrder = async (passenger: { name: string; phone: string; email: string }, ip: string) =>
  site.call("POST", "/site/v1/orders", { ip, headers: { "idempotency-key": randomUUID() }, body: { quote_id: await quoteFor(ip), passenger, flight_no: "NH211", dropoff_address: "东京站八重洲口", save_payment_method: true } });

async function placeOrder(passenger: { name: string; phone: string; email: string }): Promise<{ id: string; order_no: string; ip: string; token: string }> {
  counter += 1;
  const ip = `198.51.100.${(counter % 200) + 1}`;
  const res = await submitOrder(passenger, ip);
  assert.equal(res.status, 201, res.text);
  return { id: res.body.order.id, order_no: res.body.order.order_no, ip, token: res.body.link.token };
}

async function payOrder(orderId: string): Promise<void> {
  const intent = pay.intentOf(orderId);
  assert.ok(intent);
  pay.pay(intent.id);
  const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
  const res = await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()));
  assert.equal(res.status, 200, JSON.stringify(res.body));
}

const ops = (): Promise<string> => platformLogin(api, m.staff.operations.email);
const row = async (id: string): Promise<any> => (await api.db.owner.query("select tenant_id, passenger, passenger_enc, passenger_email_bidx, passenger_phone_bidx, passenger_name_bidx, passenger_anonymized_at, status, version, updated_at from orders where id = $1 and status <> 'rescued'", [id])).rows[0];
const revealOf = async (id: string): Promise<any> => ok(api.call("POST", `/platform/v1/orders/${id}/passenger/reveal`, { token: await ops() }));
const lookup = (order: { order_no: string; ip: string }, contact: string) => site.call("POST", "/site/v1/orders/lookup", { ip: order.ip, body: { order_no: order.order_no, contact } });
const tenantSideOf = async (id: string): Promise<"a" | "b"> => ((await row(id)).tenant_id === m.a.tenantId ? "a" : "b");
const eraseCipher = (id: string): Promise<unknown> => api.db.owner.query("update orders set passenger_enc = null, passenger_email_bidx = null, passenger_phone_bidx = null, passenger_name_bidx = null where id = $1", [id]);

async function subscribe(side: "a" | "b"): Promise<void> {
  const token = await tenantLogin(api, m[side].adminEmail);
  const current = await ok(api.call("GET", "/tenant/v1/webhooks", { token }));
  if (current.webhook !== null) await api.call("DELETE", "/tenant/v1/webhooks", { token });
  await ok(api.call("PUT", "/tenant/v1/webhooks", { token, body: { url: receiver.url, events: ["order.changed", "order.confirmed"] } }), 201);
}

async function changePassenger(orderId: string, passenger: { name: string; phone: string; email: string }): Promise<void> {
  const token = await ops();
  const version = (await ok(api.call("GET", `/platform/v1/orders/${orderId}`, { token }))).order.version;
  await ok(api.call("PATCH", `/platform/v1/orders/${orderId}`, { token, headers: { "if-match": String(version) }, body: { passenger } }));
}

const drainMail = async (): Promise<void> => {
  await site.app.notificationJobs.tick();
  await site.app.notificationJobs.tick();
};

/** 一张带全部副本的单：改过一次乘客，有改单记录、推送、给客人的通知。 */
async function orderWithCopies(): Promise<{ id: string; order_no: string; ip: string; first: ReturnType<typeof fictional>; second: ReturnType<typeof fictional> }> {
  const first = fictional();
  const second = fictional();
  const order = await placeOrder(first);
  await subscribe(await tenantSideOf(order.id));
  await payOrder(order.id);
  await drainMail();
  await changePassenger(order.id, second);
  return { ...order, first, second };
}

async function closeGate(orderId: string): Promise<void> {
  await api.db.owner.query("update qa_gate set closed = true, order_id = $1", [orderId]);
}
const openGate = (): Promise<unknown> => api.db.owner.query("update qa_gate set closed = false");

/** 等到回填卡在闸门上，返回它那条连接的进程号。 */
async function backfillStuck(): Promise<number> {
  for (let i = 0; i < 400; i += 1) {
    const found = (await api.db.owner.query<{ pid: number }>("select pid from pg_stat_activity where datname = current_database() and state = 'active' and query like 'update orders set passenger_enc = $3%' and pid <> pg_backend_pid() limit 1")).rows[0];
    if (found !== undefined) return found.pid;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("回填没有卡在闸门上");
}

/** 等到有语句撞上行锁（业务操作已经在等回填提交）。 */
async function someoneWaiting(): Promise<void> {
  for (let i = 0; i < 500; i += 1) {
    const found = (await api.db.owner.query<{ n: number }>("select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid()")).rows[0];
    if ((found?.n ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("没有等到语句撞上行锁");
}

test("回填中途崩溃（连接在一批中间被杀）：这一批整批回滚，不留半行（有密文没盲索引），明文不动；重跑全部补上", async () => {
  await runPassengerBackfill(ctx, { pauseMs: 0 });
  const orders = [];
  for (let i = 0; i < 4; i += 1) orders.push(await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + (700 + i) * HOUR) }));
  const sorted = [...orders].sort((a, b) => (a.id < b.id ? -1 : 1));
  const victim = sorted[2] as (typeof sorted)[number];
  const passengerBefore = (await row(victim.id)).passenger;
  await closeGate(victim.id);
  const running = backfillBatch(ctx, "orders", null, 100);
  const pid = await backfillStuck();
  await api.db.owner.query("select pg_terminate_backend($1)", [pid]);
  await assert.rejects(running);
  await openGate();
  for (const order of orders) {
    const current = await row(order.id);
    assert.deepEqual([current.passenger_enc, current.passenger_email_bidx, current.passenger_phone_bidx, current.passenger_name_bidx], [null, null, null, null], "整批回滚");
    assert.deepEqual(current.passenger, passengerBefore);
  }
  assert.equal((await planPassengerBackfill(ctx)).orders, 4);
  assert.equal((await revealOf(victim.id)).passenger.name, passengerBefore.name, "崩溃之后照样能读");
  assert.equal((await runPassengerBackfill(ctx, { pauseMs: 0 })).encrypted.orders, 4);
  const verified = await verifyPassengerEncryption(ctx);
  assert.equal(verified.undecryptable.orders + verified.mismatched.orders, 0);
});

test("回填时改乘客：改单等回填这一行提交后接着做；最后密文、盲索引、明文都是新值，旧联系方式对不上", async () => {
  await runPassengerBackfill(ctx, { pauseMs: 0 });
  const was = fictional();
  const order = await placeOrder(was);
  await payOrder(order.id);
  await runPassengerBackfill(ctx, { pauseMs: 0 });
  await eraseCipher(order.id);
  await closeGate(order.id);
  const running = runPassengerBackfill(ctx, { pauseMs: 0 });
  await backfillStuck();
  const now = fictional();
  const patch = changePassenger(order.id, now);
  await someoneWaiting();
  await openGate();
  await Promise.all([running, patch]);
  const current = await row(order.id);
  assert.equal(current.passenger.email, now.email);
  const crypto = useCrypto(DUAL);
  assert.deepEqual(JSON.parse(crypto.openForVerify("order", current.tenant_id, order.id, current.passenger_enc) as string), now, "密文是新值");
  assert.equal(current.passenger_email_bidx, crypto.index(current.tenant_id, "email", now.email));
  assert.equal((await revealOf(order.id)).passenger.email, now.email);
  assert.equal((await lookup(order, now.email)).status, 200);
  assert.equal((await lookup(order, was.email)).status, 404);
  assert.deepEqual(alerts, [], "没有出现密文和明文对不上");
  assert.equal((await verifyPassengerEncryption(ctx)).mismatched.orders, 0);
});

test("回填时脱敏：回填卡着时脱敏跳过这单、不等；回填提交后下一轮脱敏，密文和盲索引、副本全部清掉", async () => {
  await runPassengerBackfill(ctx, { pauseMs: 0 });
  const { id, first, second } = await orderWithCopies();
  await endAt(api, id, tokyoDaysAgo(api, 200));
  await runPassengerBackfill(ctx, { pauseMs: 0 });
  await eraseCipher(id);
  await closeGate(id);
  const running = runPassengerBackfill(ctx, { pauseMs: 0 });
  await backfillStuck();
  await runPassengerRetention(retentionCtx(api), SILENT);
  assert.equal((await row(id)).passenger_anonymized_at, null, "行被回填锁着：这一轮不脱敏");
  await openGate();
  await running;
  assert.ok((await row(id)).passenger_enc, "回填完成");
  await runPassengerRetention(retentionCtx(api), SILENT);
  const current = await row(id);
  assert.deepEqual([current.passenger.name, current.passenger_enc, current.passenger_email_bidx, current.passenger_phone_bidx, current.passenger_name_bidx], [ANONYMIZED_TEXT, null, null, null, null]);
  for (const [table, column] of [["order_changes", "values_enc"], ["webhook_deliveries", "event_data_enc"], ["notifications", "recipient_enc"]] as const) {
    assert.equal((await api.db.owner.query(`select count(*)::int as n from ${table} where order_id = $1 and ${column} is not null`, [id])).rows[0].n, 0, table);
  }
  const dump = JSON.stringify((await api.db.owner.query("select before, after from order_changes where order_id = $1", [id])).rows);
  for (const value of [first.email, second.email, first.phone, second.phone]) assert.ok(!dump.includes(value));
});

test("脱敏时密文还没回填的单：脱敏之后回填不再为这单和它的副本写密文", async () => {
  await runPassengerBackfill(ctx, { pauseMs: 0 });
  const { id } = await orderWithCopies();
  await endAt(api, id, tokyoDaysAgo(api, 201));
  await api.db.owner.query("update webhook_deliveries set event_data_enc = null where order_id = $1", [id]);
  await api.db.owner.query("update notifications set recipient_enc = null where order_id = $1", [id]);
  await api.db.owner.query("update order_changes set values_enc = null where order_id = $1", [id]);
  await eraseCipher(id);
  await runPassengerRetention(retentionCtx(api), SILENT);
  assert.equal((await row(id)).passenger.name, ANONYMIZED_TEXT);
  const result = await runPassengerBackfill(ctx, { pauseMs: 0 });
  assert.deepEqual(result.encrypted, { orders: 0, order_changes: 0, webhook_deliveries: 0, notifications: 0 }, "没有内容可以加密");
  for (const [table, column] of [["order_changes", "values_enc"], ["webhook_deliveries", "event_data_enc"], ["notifications", "recipient_enc"]] as const) {
    assert.equal((await api.db.owner.query(`select count(*)::int as n from ${table} where order_id = $1 and ${column} is not null`, [id])).rows[0].n, 0, table);
  }
});

test("回填时救援改派：改派等回填提交；新一行按新租户加密，新租户解得开、旧租户解不开，旧一行相反；verify 全部一致", async () => {
  await runPassengerBackfill(ctx, { pauseMs: 0 });
  const passenger = fictional();
  const order = await placeOrder(passenger);
  await payOrder(order.id);
  const side = await tenantSideOf(order.id);
  const rescuer = side === "a" ? m.b : m.a;
  const originalTenant = m[side].tenantId;
  await api.db.owner.query("update orders set status = 'rescue_pending' where id = $1", [order.id]);
  await eraseCipher(order.id);
  await closeGate(order.id);
  const running = runPassengerBackfill(ctx, { pauseMs: 0 });
  await backfillStuck();
  const rescue = withPlatformTx(api.db.pool, async (db) => {
    const current = await findOrderForPlatform(db, order.id, { lock: true });
    assert.ok(current);
    await markOrderRescued(db, current, api.clock.now());
    await insertRescuedOrder(db, { original: current, tenantId: rescuer.tenantId, productId: side === "a" ? m.ids.pb : m.ids.pa, productVersion: 1, settlementMinor: 1000, settlementCurrency: "JPY", settlement: current.settlement, urgent: false, inventoryHeld: false, dispatchDueAt: new Date(api.clock.now().getTime() + HOUR), now: api.clock.now() });
  });
  await someoneWaiting();
  await openGate();
  await Promise.all([running, rescue]);
  const crypto = useCrypto(DUAL);
  const rows = (await api.db.owner.query("select tenant_id, status, passenger_enc, passenger_email_bidx from orders where id = $1", [order.id])).rows;
  const fresh = rows.find((item: any) => item.tenant_id === rescuer.tenantId);
  const old = rows.find((item: any) => item.tenant_id === originalTenant);
  assert.ok(fresh && old);
  assert.deepEqual(JSON.parse(crypto.openForVerify("order", rescuer.tenantId, order.id, fresh.passenger_enc) as string), passenger);
  assert.equal(crypto.openForVerify("order", originalTenant, order.id, fresh.passenger_enc), null, "旧租户解不开新一行");
  assert.deepEqual(JSON.parse(crypto.openForVerify("order", originalTenant, order.id, old.passenger_enc) as string), passenger);
  assert.equal(crypto.openForVerify("order", rescuer.tenantId, order.id, old.passenger_enc), null, "新租户解不开旧一行");
  assert.notEqual(fresh.passenger_email_bidx, old.passenger_email_bidx);
  assert.deepEqual([(await verifyPassengerEncryption(ctx)).undecryptable.orders, (await verifyPassengerEncryption(ctx)).mismatched.orders], [0, 0]);
  assert.equal((await lookup(order, passenger.email)).status, 200);
});

test("旧代码只写明文：四张表的密文都作废，读到新值不读旧密文；回填后是新内容；只改别的列、写回相同内容不作废", async () => {
  const { id, second } = await orderWithCopies();
  await api.app.webhookJobs.tick();
  await runPassengerBackfill(ctx, { pauseMs: 0 });
  const owner = api.db.owner;
  const sealed = async (): Promise<Record<string, any>> => ({
    order: (await row(id)).passenger_enc,
    change: (await owner.query("select values_enc as e from order_changes where order_id = $1 limit 1", [id])).rows[0].e,
    delivery: (await owner.query("select event_data_enc as e from webhook_deliveries where order_id = $1 and event_data_enc is not null limit 1", [id])).rows[0].e,
    notification: (await owner.query("select recipient_enc as e from notifications where order_id = $1 and audience = 'guest' limit 1", [id])).rows[0].e,
  });
  const was = await sealed();
  for (const value of Object.values(was)) assert.ok(value);

  // 不是乘客的改动、写回相同内容：不作废（否则每次改航班都要重新回填，还会把第 6 步之后的内容弄丢）
  await owner.query("update orders set flight_no = 'NH999', passenger = passenger where id = $1", [id]);
  await owner.query("update order_changes set decision_note = '虚构备注', before = before, after = after where order_id = $1", [id]);
  await owner.query("update webhook_deliveries set attempts = attempts, event_data = event_data where order_id = $1", [id]);
  await owner.query("update notifications set attempts = attempts, recipient = recipient where order_id = $1", [id]);
  assert.deepEqual(await sealed(), was);

  // 旧代码改了明文
  const third = fictional();
  await owner.query("update orders set passenger = $2::jsonb where id = $1", [id, JSON.stringify(third)]);
  await owner.query("update order_changes set after = jsonb_set(after, '{passenger}', $2::jsonb) where order_id = $1", [id, JSON.stringify(third)]);
  await owner.query("update webhook_deliveries set event_data = jsonb_set(event_data, '{qa}', $2::jsonb) where order_id = $1", [id, JSON.stringify({ passenger: third })]);
  await owner.query("update notifications set recipient = $2 where order_id = $1 and audience = 'guest'", [id, third.email]);
  const voided = await sealed().catch(() => null);
  assert.equal((await row(id)).passenger_enc, null);
  assert.equal((await row(id)).passenger_email_bidx, null);
  assert.equal(voided, null, "副本的密文都作废了（查不到还有密文的那条）");
  for (const [table, column] of [["order_changes", "values_enc"], ["webhook_deliveries", "event_data_enc"], ["notifications", "recipient_enc"]] as const) {
    assert.equal((await owner.query(`select count(*)::int as n from ${table} where order_id = $1 and ${column} is not null`, [id])).rows[0].n, 0, table);
  }
  assert.equal((await revealOf(id)).passenger.email, third.email, "读到新值");
  const detail = await ok(api.call("GET", `/platform/v1/orders/${id}`, { token: await ops() }));
  assert.ok(!JSON.stringify(detail).includes(second.email));
  await runPassengerBackfill(ctx, { pauseMs: 0 });
  assert.equal((await revealOf(id)).passenger.email, third.email, "回填之后还是新值");
  const verified = await verifyPassengerEncryption(ctx);
  for (const table of ["orders", "order_changes", "webhook_deliveries", "notifications"] as const) assert.equal(verified.mismatched[table], 0, table);
  assert.deepEqual(alerts, []);
});

test("回填不动副本的其他列：通知、推送、改单的状态、次数、更新时间不变，正在发送的不受影响", async () => {
  const { id } = await orderWithCopies();
  const owner = api.db.owner;
  await owner.query("update webhook_deliveries set event_data_enc = null where order_id = $1", [id]);
  await owner.query("update notifications set recipient_enc = null where order_id = $1", [id]);
  await owner.query("update order_changes set values_enc = null where order_id = $1", [id]);
  const snapshot = async (): Promise<unknown> => ({
    notifications: (await owner.query("select id, status, attempts, version, updated_at, next_attempt_at, lease_token, recipient from notifications where order_id = $1 order by id", [id])).rows,
    deliveries: (await owner.query("select id, status, attempts, next_attempt_at, lease_token, event_data from webhook_deliveries where order_id = $1 order by id", [id])).rows,
    changes: (await owner.query("select id, status, before, after, decided_at from order_changes where order_id = $1 order by id", [id])).rows,
  });
  const was = await snapshot();
  await runPassengerBackfill(ctx, { pauseMs: 0 });
  assert.deepEqual(await snapshot(), was);
  assert.ok((await owner.query("select values_enc from order_changes where order_id = $1 limit 1", [id])).rows[0].values_enc);
});

test("--verify 不能漏掉只有占位、密文也没了的行：这些行的内容已经丢了，必须报出来，不能说「全部一致」（四张表）", async () => {
  useCrypto(RETIRED);
  const { id } = await orderWithCopies();
  await api.app.webhookJobs.tick();
  useCrypto(DUAL);
  const owner = api.db.owner;
  const was = await verifyPassengerEncryption(ctx);
  const saved = {
    order: (await row(id)).passenger_enc,
    change: (await owner.query("select id, values_enc from order_changes where order_id = $1", [id])).rows,
    delivery: (await owner.query("select id, event_data_enc from webhook_deliveries where order_id = $1", [id])).rows,
    notification: (await owner.query("select id, recipient_enc from notifications where order_id = $1", [id])).rows,
  };
  await eraseCipher(id);
  await owner.query("update order_changes set values_enc = null where order_id = $1", [id]);
  await owner.query("update webhook_deliveries set event_data_enc = null where order_id = $1", [id]);
  await owner.query("update notifications set recipient_enc = null where order_id = $1", [id]);
  try {
    assert.equal((await row(id)).passenger.name, ENCRYPTED_TEXT, "前提：明文只是占位");
    const now = await verifyPassengerEncryption(ctx);
    const plan = await planPassengerBackfill(ctx);
    for (const table of ["orders", "order_changes", "webhook_deliveries", "notifications"] as const) {
      assert.ok(now.undecryptable[table] > was.undecryptable[table] || plan[table] > 0, `${table}：明文是占位、密文是空，这条内容已经丢了，核对要报出来（services/passenger-encryption.ts 第 48 行的注释也这样写）`);
    }
  } finally {
    await owner.query("update orders set passenger_enc = $2 where id = $1", [id, saved.order]);
    for (const item of saved.change) await owner.query("update order_changes set values_enc = $2 where id = $1", [item.id, item.values_enc]);
    for (const item of saved.delivery) await owner.query("update webhook_deliveries set event_data_enc = $2 where id = $1", [item.id, item.event_data_enc]);
    for (const item of saved.notification) await owner.query("update notifications set recipient_enc = $2 where id = $1", [item.id, item.recipient_enc]);
  }
});

test("推送内容的别的字段里恰好有占位字样（客人备注写了「[已加密]」）：乘客明文还在，要回填，不能算没内容；否则 --verify 说全部一致，第 6 步清明文时这条内容就丢了", async () => {
  const { id, second } = await orderWithCopies();
  await api.app.webhookJobs.tick();
  const owner = api.db.owner;
  const delivery = (await owner.query("select id from webhook_deliveries where order_id = $1 and jsonb_path_exists(event_data, '$.**.passenger') limit 1", [id])).rows[0];
  assert.ok(delivery, "前提：有含乘客的推送");
  await owner.query("update webhook_deliveries set event_data = jsonb_set(event_data, '{qa_note}', to_jsonb($2::text)), event_data_enc = null where id = $1", [delivery.id, `客人备注：${ENCRYPTED_TEXT}`]);
  const stored = (await owner.query("select event_data from webhook_deliveries where id = $1", [delivery.id])).rows[0].event_data;
  assert.ok(JSON.stringify(stored).includes(second.email), "前提：明文里有真的乘客信息");
  await runPassengerBackfill(ctx, { pauseMs: 0 });
  assert.ok((await owner.query("select event_data_enc from webhook_deliveries where id = $1", [delivery.id])).rows[0].event_data_enc, "含真实乘客的推送要加密（services/passenger-encryption.ts 第 49、51 行按整段文本找占位）");
});

test("改单前后值的乘客姓名里带占位字样（不是占位本身）：同样要回填", async () => {
  const { id } = await orderWithCopies();
  const owner = api.db.owner;
  const change = (await owner.query("select id from order_changes where order_id = $1 limit 1", [id])).rows[0];
  await owner.query("update order_changes set after = jsonb_set(after, '{passenger,name}', to_jsonb($2::text)), values_enc = null where id = $1", [change.id, `星野${ENCRYPTED_TEXT}`]);
  await runPassengerBackfill(ctx, { pauseMs: 0 });
  assert.ok((await owner.query("select values_enc from order_changes where id = $1", [change.id])).rows[0].values_enc);
});

test("--verify 分页不漏行：每页 1 行时数量对得上全表（救援改派同一编号两行也都算）；不一致的行排在最后也能查到", async () => {
  await runPassengerBackfill(ctx, { pauseMs: 0 });
  const owner = api.db.owner;
  const a = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 800 * HOUR) });
  const b = await seedOrder(api, m, "b", { serviceAt: new Date(api.clock.now().getTime() + 801 * HOUR) });
  await runPassengerBackfill(ctx, { pauseMs: 0 });
  const counts: Record<string, number> = {};
  for (const [table, column] of [["orders", "passenger_enc"], ["order_changes", "values_enc"], ["webhook_deliveries", "event_data_enc"], ["notifications", "recipient_enc"]] as const) {
    counts[table] = (await owner.query(`select count(*)::int as n from ${table} where ${column} is not null`)).rows[0].n;
  }
  const paged = await verifyPassengerEncryption(ctx, 1);
  assert.deepEqual(paged.checked, counts);
  const big = await verifyPassengerEncryption(ctx, 1000);
  assert.deepEqual(big, paged);

  // 把一行的密文换成用同一把钥匙算的、别的内容：解得开但和明文不一致
  const crypto = useCrypto(DUAL);
  const target = [a, b].sort((x, y) => (x.id < y.id ? 1 : -1))[0] as typeof a;
  const saved = (await row(target.id)).passenger_enc;
  const forged = crypto.sealOrderPassenger(target.tenantId, target.id, fictional()).enc;
  await owner.query("update orders set passenger_enc = $2 where id = $1", [target.id, forged]);
  try {
    const found = await verifyPassengerEncryption(ctx, 1);
    assert.equal(found.mismatched.orders, big.mismatched.orders + 1);
  } finally {
    await owner.query("update orders set passenger_enc = $2 where id = $1", [target.id, saved]);
  }
});

test("命令行 --verify 有问题时退出码非 0，输出里没有联系方式、没有密文、没有盲索引、没有订单编号；参数不对也不跑", async () => {
  await runPassengerBackfill(ctx, { pauseMs: 0 });
  const passenger = fictional();
  const order = await placeOrder(passenger);
  const current = await row(order.id);
  const crypto = useCrypto(DUAL);
  const forged = crypto.sealOrderPassenger(current.tenant_id, order.id, fictional());
  await api.db.owner.query("update orders set passenger_enc = $2 where id = $1", [order.id, forged.enc]);
  const run = promisify(execFile);
  const env = { ...process.env, ...testEnv(api.db.url) };
  try {
    const failed = await run(process.execPath, [ENTRY, "--verify"], { env }).then(
      () => assert.fail("--verify 应当退出码非 0"),
      (err: { code: number; stdout: string; stderr: string }) => err,
    );
    assert.equal(failed.code, 1);
    assert.match(failed.stdout, /不一致 [1-9]/);
    assert.match(failed.stdout, /还不能进入清明文/);
    const text = failed.stdout + failed.stderr;
    for (const secret of [passenger.name, passenger.email, passenger.phone, forged.enc, current.passenger_email_bidx, order.id, order.order_no, FAKE_SECRETS.dataEncryptionKey]) assert.ok(!text.includes(secret), "输出只有数量");
  } finally {
    await api.db.owner.query("update orders set passenger_enc = $2 where id = $1", [order.id, current.passenger_enc]);
  }
  await assert.rejects(run(process.execPath, [ENTRY, "--execute", "--verify"], { env }), (err: { stderr: string; code: number }) => err.code === 1 && /只能选一个/.test(err.stderr));
  await assert.rejects(run(process.execPath, [ENTRY, "--force"], { env }), (err: { stderr: string; code: number }) => err.code === 1 && /参数不正确/.test(err.stderr));
});

test("处理不了的一行（历史数据缺字段）：只跳过这一行，别的照常；日志只有错误码；这一行照常能读，不能被算成已加密", async () => {
  await runPassengerBackfill(ctx, { pauseMs: 0 });
  const bad = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 810 * HOUR) });
  const good = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 811 * HOUR) });
  const secret = "broken.row@fictional.example.test";
  await api.db.owner.query("update orders set passenger = $2::jsonb where id = $1", [bad.id, JSON.stringify({ name: "星野缺电话", email: secret })]);
  const logs: object[] = [];
  const result = await runPassengerBackfill(ctx, { pauseMs: 0, log: { info: () => undefined, error: (obj) => void logs.push(obj) } });
  try {
    assert.equal(result.encrypted.orders, 1);
    assert.equal(result.failed, 1);
    assert.ok((await row(good.id)).passenger_enc);
    assert.equal((await row(bad.id)).passenger_enc, null);
    assert.equal((await planPassengerBackfill(ctx)).orders, 1, "还算没加密");
    assert.ok(!JSON.stringify(logs).includes(secret));
    assert.ok(!JSON.stringify(logs).includes("星野缺电话"));
    assert.equal(JSON.stringify(logs).includes("Cannot read"), false, "只有错误码，不带异常原文");
  } finally {
    await api.db.owner.query("update orders set passenger = $2::jsonb where id = $1", [bad.id, JSON.stringify({ name: "星野补电话", email: secret, phone: "+818000000000" })]);
    await runPassengerBackfill(ctx, { pauseMs: 0 });
  }
});

test("客人把姓名写成「[已加密]」：要么下单时拒绝，要么之后切回读明文也能读、运营列表不被这一单拖垮（官网接口任何人都能提交这个字样）", async () => {
  const passenger = { ...fictional(), name: ENCRYPTED_TEXT };
  counter += 1;
  const ip = `198.51.100.${(counter % 200) + 1}`;
  const res = await submitOrder(passenger, ip);
  if (res.status !== 201) {
    assert.ok(res.status >= 400 && res.status < 500, res.text);
    return;
  }
  const id = res.body.order.id;
  try {
    assert.equal((await revealOf(id)).passenger.name, ENCRYPTED_TEXT);
    useCrypto(PLAIN_READ);
    const list = await api.call("GET", `/platform/v1/orders?q=${res.body.order.order_no}`, { token: await ops() });
    assert.equal(list.status, 200, `切回读明文后这一单让运营列表 ${list.status}：${list.text.slice(0, 120)}`);
    const detail = await api.call("POST", `/platform/v1/orders/${id}/passenger/reveal`, { token: await ops() });
    assert.equal(detail.status, 200, "切回读明文后这一单读不出来");
  } finally {
    useCrypto(DUAL);
    await api.db.owner.query("update orders set passenger = $2::jsonb where id = $1", [id, JSON.stringify(fictional())]);
  }
});

test("客人把姓名写成「[已脱敏]」：要么下单时拒绝，要么这单不能被当成已脱敏（发不了信、回填跳过、明文不进密文）", async () => {
  const passenger = { ...fictional(), name: ANONYMIZED_TEXT };
  counter += 1;
  const ip = `198.51.100.${(counter % 200) + 1}`;
  const res = await submitOrder(passenger, ip);
  if (res.status !== 201) {
    assert.ok(res.status >= 400 && res.status < 500, res.text);
    return;
  }
  const id = res.body.order.id;
  try {
    await eraseCipher(id);
    await runPassengerBackfill(ctx, { pauseMs: 0 });
    assert.ok((await row(id)).passenger_enc, "这单的电话、邮箱是真的，要回填；回填按姓名把它当成没内容，--verify 说全部一致，清明文时电话和邮箱就丢了");
  } finally {
    await api.db.owner.query("update orders set passenger = $2::jsonb where id = $1", [id, JSON.stringify(fictional())]);
  }
});

test("开关来回切：读密文和读明文，在 reveal、供应商详情、官网页面、查订单上内容完全相同，不报警", async () => {
  const passenger = { name: "星野 太郎👨‍👩‍👧 é", phone: "+818055556666", email: "Toggle.Case+tag@fictional.example.test" };
  const order = await placeOrder(passenger);
  await payOrder(order.id);
  const side = await tenantSideOf(order.id);
  const surfaces = async (): Promise<unknown> => ({
    reveal: (await revealOf(order.id)).passenger,
    tenant: (await ok(api.call("GET", `/tenant/v1/orders/${order.id}`, { token: await tenantLogin(api, m[side].adminEmail) }))).order.passenger,
    guest: (await ok(site.call("GET", "/site/v1/order", { ip: order.ip, token: order.token }))).order?.passenger ?? null,
    lookupEmail: (await lookup(order, passenger.email.toUpperCase())).status,
    lookupPhone: (await lookup(order, "+81 80-5555-6666")).status,
  });
  const cipher = await surfaces();
  useCrypto(PLAIN_READ);
  const plain = await surfaces();
  useCrypto(DUAL);
  const again = await surfaces();
  assert.deepEqual(plain, cipher);
  assert.deepEqual(again, cipher);
  assert.deepEqual((cipher as { reveal: unknown }).reveal, passenger);
  assert.deepEqual(alerts, []);
});

test("明文不再写之后又退回（写明文、读明文）：那段时间写的单列表和 reveal 都不能 503（docs/deploy.md 说第 6 步之前随时能退回）", async () => {
  useCrypto(RETIRED);
  const passenger = fictional();
  const order = await placeOrder(passenger);
  assert.equal((await row(order.id)).passenger.name, ENCRYPTED_TEXT);
  useCrypto(PLAIN_READ);
  const list = await api.call("GET", `/platform/v1/orders?q=${order.order_no}`, { token: await ops() });
  assert.equal(list.status, 200, `运营列表 ${list.status}`);
  const revealed = await api.call("POST", `/platform/v1/orders/${order.id}/passenger/reveal`, { token: await ops() });
  assert.equal(revealed.status, 200, `reveal ${revealed.status}`);
  assert.equal(revealed.body.passenger.email, passenger.email);
});

for (const [label, settings] of [["双写", DUAL], ["明文不再写", RETIRED]] as const) {
  test(`怪字符走完整接口（${label}）：emoji、组合字符、从右到左、百字姓名，下单 → 读 → 查 → 改 → 回填，一字不差`, async () => {
    useCrypto(settings);
    for (const name of ["星野👨‍👩‍👧‍👦🇯🇵", "é́ か゚", "مرحبا שלום", "長".repeat(100), `O'Brien "\\ %_`]) {
      const passenger = { ...fictional(), name };
      const order = await placeOrder(passenger);
      assert.equal((await revealOf(order.id)).passenger.name, name);
      assert.equal((await lookup(order, passenger.email)).status, 200);
      await payOrder(order.id);
      const next = { ...fictional(), name: `${name.slice(0, 50)}改` };
      await changePassenger(order.id, next);
      assert.deepEqual((await revealOf(order.id)).passenger, { name: next.name, phone: next.phone, email: next.email });
    }
    await runPassengerBackfill(ctx, { pauseMs: 0 });
    const verified = await verifyPassengerEncryption(ctx);
    assert.equal(verified.mismatched.orders + verified.mismatched.order_changes, 0);
    assert.deepEqual(alerts, []);
  });
}

for (const [label, char] of [["孤立代理项", "\ud83d"], ["NUL", "\u0000"]] as const) {
  test(`姓名带${label}：下单是 4xx 或成功，不能 500；数据库的报错不能把联系方式带进日志`, async () => {
    const passenger = { ...fictional(), name: `星野${char}测` };
    counter += 1;
    const ip = `198.51.100.${(counter % 200) + 1}`;
    siteLogs = "";
    const res = await submitOrder(passenger, ip);
    assert.ok(res.status < 500, `应当拒绝或接受，实际 ${res.status}：${res.text.slice(0, 200)}`);
    assert.ok(!siteLogs.includes(passenger.email) && !siteLogs.includes(passenger.phone), "日志里有联系方式");
  });
}

test("明文不再写时一张单解不开：运营列表不能整页 503，别的单要照常显示（ADR 只说相关的单）", async () => {
  useCrypto(RETIRED);
  const healthy = await placeOrder(fictional());
  const broken = await placeOrder(fictional());
  const saved = (await row(broken.id)).passenger_enc;
  await api.db.owner.query("update orders set passenger_enc = $2 where id = $1", [broken.id, `${useCrypto(RETIRED).currentPrefix}v1.AAAA.AAAA.AAAA`]);
  try {
    const list = await api.call("GET", "/platform/v1/orders", { token: await ops() });
    assert.equal(list.status, 200, `一单解不开让整个运营订单列表 ${list.status}（repos/orders.ts toOrder 里抛错）`);
    assert.ok(list.body.items.some((item: any) => item.id === healthy.id));
    assert.ok(!JSON.stringify(list.body).includes(ENCRYPTED_TEXT), "不能把占位显示出来");
  } finally {
    await api.db.owner.query("update orders set passenger_enc = $2 where id = $1", [broken.id, saved]);
  }
});

test("明文不再写时一条通知的收件地址解不开：别的客人的通知照常发，不能整批卡住（claimDueNotifications 在事务里抛错会让每一轮都回滚）", async () => {
  const owner = api.db.owner;
  useCrypto(RETIRED);
  const first = fictional();
  const second = fictional();
  const a = await placeOrder(first);
  const b = await placeOrder(second);
  await owner.query("update notifications set status = 'sent', sent_at = now(), lease_token = null where status in ('pending', 'sending')");
  await payOrder(a.id);
  await payOrder(b.id);
  await drainMail();
  // 所有别的通知都已发完，只留这两单给客人的通知重新等待发送
  await owner.query("update notifications set status = 'sent', sent_at = coalesce(sent_at, now()), lease_token = null, lease_until = null where status in ('pending', 'sending')");
  const pending = (await owner.query("update notifications set status = 'pending', sent_at = null, next_attempt_at = $2, attempts = 0 where audience = 'guest' and order_id = any($1::uuid[]) returning id, order_id, recipient_enc", [[a.id, b.id], api.clock.now()])).rows;
  const broken = pending.find((item: any) => item.order_id === a.id);
  assert.ok(broken && pending.some((item: any) => item.order_id === b.id), `前提：两单都要有给客人的通知。实际 ${pending.length} 条`);
  await owner.query("update notifications set recipient_enc = $2 where id = $1", [broken.id, `${useCrypto(RETIRED).currentPrefix}v1.AAAA.AAAA.AAAA`]);
  smtp.reset();
  try {
    await site.app.notificationJobs.tick().catch(() => undefined);
    assert.ok(smtp.messages.some((message) => message.to.includes(second.email)), "别的客人的通知要照常发出去");
  } finally {
    await owner.query("update notifications set recipient_enc = $2 where id = $1", [broken.id, broken.recipient_enc]);
    await owner.query("update notifications set status = 'sent', sent_at = coalesce(sent_at, now()), lease_token = null, lease_until = null where status in ('pending', 'sending')");
  }
});

test("明文不再写时一条推送解不开：别的推送照常发，不能整批卡住（claimDueDeliveries 同样）", async () => {
  const owner = api.db.owner;
  useCrypto(RETIRED);
  await owner.query("update webhook_deliveries set status = 'succeeded', next_attempt_at = null, lease_token = null, succeeded_at = now() where status = 'pending'");
  const a = await placeOrder(fictional());
  const side = await tenantSideOf(a.id);
  await subscribe(side);
  const b = await placeOrder(fictional());
  assert.equal(await tenantSideOf(b.id), side, "前提：两单是同一家");
  await payOrder(a.id);
  await payOrder(b.id);
  await api.app.webhookJobs.tick();
  // 只有改单的推送在库里带乘客；确认的推送发送时才现取
  await changePassenger(a.id, fictional());
  await changePassenger(b.id, fictional());
  await owner.query("update webhook_deliveries set status = 'succeeded', next_attempt_at = null, lease_token = null, succeeded_at = now() where status = 'pending' and event_type <> 'order.changed'");
  const pending = (await owner.query("select id, order_id, event_data_enc from webhook_deliveries where order_id = any($1::uuid[]) and status = 'pending'", [[a.id, b.id]])).rows;
  const broken = pending.find((item: any) => item.order_id === a.id);
  assert.ok(broken && pending.some((item: any) => item.order_id === b.id), `前提：两单都有等待发送的推送。实际 ${pending.length} 条`);
  await owner.query("update webhook_deliveries set event_data_enc = $2 where id = $1", [broken.id, `${useCrypto(RETIRED).currentPrefix}v1.AAAA.AAAA.AAAA`]);
  receiver.received.length = 0;
  try {
    await api.app.webhookJobs.tick().catch(() => undefined);
    assert.ok(receiver.received.some((item) => item.body.includes(b.id)), "别的推送要照常发出去");
    assert.ok(!receiver.received.some((item) => item.body.includes(ENCRYPTED_TEXT)), "推送里不能有占位");
  } finally {
    await owner.query("update webhook_deliveries set event_data_enc = $2 where id = $1", [broken.id, broken.event_data_enc]);
    await owner.query("update webhook_deliveries set status = 'succeeded', next_attempt_at = null, lease_token = null, succeeded_at = now() where status = 'pending'");
  }
});

test("脱敏（明文不再写）：占位全部换成脱敏占位，之后读单、读改单、读推送、通知列表都不 503；副本密文清掉", async () => {
  useCrypto(RETIRED);
  const { id, first, second } = await orderWithCopies();
  await api.app.webhookJobs.tick();
  await endAt(api, id, tokyoDaysAgo(api, 202));
  await api.db.owner.query("update notification_events set expanded_at = coalesce(expanded_at, now()) where order_id = $1", [id]);
  await runPassengerRetention(retentionCtx(api), SILENT);
  const current = await row(id);
  assert.equal(current.passenger.name, ANONYMIZED_TEXT);
  const token = await ops();
  const detail = await ok(api.call("GET", `/platform/v1/orders/${id}`, { token }));
  assert.ok(!JSON.stringify(detail).includes(ENCRYPTED_TEXT));
  await ok(api.call("GET", `/platform/v1/notifications?order_id=${id}`, { token }));
  const deliveries = await ok(api.call("GET", `/platform/v1/webhook-deliveries?order_id=${id}`, { token }));
  assert.ok(!JSON.stringify(deliveries).includes(ENCRYPTED_TEXT));
  const leftovers = (await api.db.owner.query("select 'c' as t, before::text || after::text as v from order_changes where order_id = $1 union all select 'w', event_data::text from webhook_deliveries where order_id = $1 union all select 'n', recipient from notifications where order_id = $1 and audience = 'guest'", [id])).rows;
  assert.ok(leftovers.length >= 3);
  for (const item of leftovers) {
    assert.ok(!item.v.includes(ENCRYPTED_TEXT), `${item.t} 留着加密占位：之后读会 503`);
    for (const value of [first.email, first.phone, second.email, second.phone]) assert.ok(!item.v.includes(value));
  }
});

test("脱敏：一单解不开只跳过这一单，内容不销毁（换回密钥还能读），别的到期的单照常脱敏", async () => {
  const owner = api.db.owner;
  useCrypto(RETIRED);
  const broken = await placeOrder(fictional());
  const fine = await placeOrder(fictional());
  const ended = tokyoDaysAgo(api, 203);
  await endAt(api, broken.id, ended);
  await endAt(api, fine.id, ended);
  await owner.query("update notification_events set expanded_at = coalesce(expanded_at, now()) where order_id = any($1::uuid[])", [[broken.id, fine.id]]);
  const saved = (await row(broken.id)).passenger_enc;
  await owner.query("update orders set passenger_enc = $2 where id = $1", [broken.id, `${useCrypto(RETIRED).currentPrefix}v1.AAAA.AAAA.AAAA`]);
  const logs: object[] = [];
  try {
    await runPassengerRetention(retentionCtx(api), { info: () => undefined, error: (obj) => void logs.push(obj) });
    assert.equal((await row(fine.id)).passenger.name, ANONYMIZED_TEXT, "别的单照常");
    const left = await row(broken.id);
    assert.equal(left.passenger_anonymized_at, null, "解不开的单不能当脱敏过");
    assert.ok(left.passenger_enc, "密文留着");
    assert.ok(!JSON.stringify(logs).includes("v1.AAAA"));
  } finally {
    await owner.query("update orders set passenger_enc = $2, status = 'cancelled' where id = $1", [broken.id, saved]);
    await runPassengerRetention(retentionCtx(api), SILENT);
  }
});

test("主密钥配错（明文不再写）：读 503，回填、改单、脱敏都不会把内容弄丢；改回原来的密钥后原样读出", async () => {
  useCrypto(RETIRED);
  const passenger = fictional();
  const order = await placeOrder(passenger);
  await payOrder(order.id);
  const before = await row(order.id);
  useCrypto(RETIRED, new SecretBox("another-fake-master-key-for-rotation-0123456789"));
  const token = await ops();
  assert.equal((await api.call("POST", `/platform/v1/orders/${order.id}/passenger/reveal`, { token })).status, 503);
  await runPassengerBackfill(ctx, { pauseMs: 0 });
  assert.equal((await row(order.id)).passenger_enc, before.passenger_enc, "回填不能动它");
  const patch = await api.call("PATCH", `/platform/v1/orders/${order.id}`, { token, headers: { "if-match": String(before.version) }, body: { passenger: { name: "虚构改名", phone: "+818011119999", email: "wrong-key@fictional.example.test" } } });
  assert.equal(patch.status, 503, patch.text.slice(0, 200));
  assert.equal((await row(order.id)).passenger_enc, before.passenger_enc, "改单被挡住，内容不变");
  useCrypto(RETIRED);
  assert.deepEqual((await revealOf(order.id)).passenger, passenger);
  assert.equal((await lookup(order, passenger.email)).status, 200);
});

test("换主密钥再换回来：中间改过的单读到的是最新内容，不会读到更早的旧密文", async () => {
  const was = fictional();
  const order = await placeOrder(was);
  await payOrder(order.id);
  const rotated = new SecretBox("another-fake-master-key-for-rotation-0123456789");
  useCrypto(DUAL, rotated);
  const now = fictional();
  await changePassenger(order.id, now);
  await runPassengerBackfill(ctx, { pauseMs: 0 });
  useCrypto(DUAL);
  assert.equal((await revealOf(order.id)).passenger.email, now.email);
  assert.equal((await lookup(order, now.email)).status, 200);
  assert.equal((await lookup(order, was.email)).status, 404);
  await runPassengerBackfill(ctx, { pauseMs: 0 });
  assert.equal((await revealOf(order.id)).passenger.email, now.email);
});

test("没配主密钥期间：已有的单发的通知、推送只有明文，密文列为空，dry-run 配上密钥后数得出；配上之后回填补上、读到的还是原内容", async () => {
  const { id, second } = await orderWithCopies();
  await drainMail();
  await api.app.webhookJobs.tick();
  await runPassengerBackfill(ctx, { pauseMs: 0 });
  useCrypto(DUAL, null);
  await api.db.owner.query("insert into webhook_deliveries (tenant_id, event_id, event_type, order_id, event_data, status, next_attempt_at, created_at, succeeded_at) select tenant_id, 'evt_' || substr(md5(random()::text), 1, 24), event_type, order_id, event_data, 'succeeded', null, created_at, created_at from webhook_deliveries where order_id = $1 and jsonb_path_exists(event_data, '$.**.passenger') limit 1", [id]);
  assert.equal((await revealOf(id)).passenger.email, second.email);
  useCrypto(DUAL);
  assert.ok((await planPassengerBackfill(ctx)).webhook_deliveries >= 1);
  await runPassengerBackfill(ctx, { pauseMs: 0 });
  assert.equal((await planPassengerBackfill(ctx)).webhook_deliveries, 0);
  const verified = await verifyPassengerEncryption(ctx);
  assert.equal(verified.mismatched.webhook_deliveries, 0);
});

test("没配主密钥也能脱敏：明文在，密文和盲索引照样清掉，不留下解不开也清不掉的内容", async () => {
  const passenger = fictional();
  const order = await placeOrder(passenger);
  await endAt(api, order.id, tokyoDaysAgo(api, 204));
  await api.db.owner.query("update notification_events set expanded_at = coalesce(expanded_at, now()) where order_id = $1", [order.id]);
  assert.ok((await row(order.id)).passenger_enc);
  useCrypto(DUAL, null);
  await runPassengerRetention(retentionCtx(api), SILENT);
  const current = await row(order.id);
  assert.deepEqual([current.passenger.name, current.passenger_enc, current.passenger_email_bidx], [ANONYMIZED_TEXT, null, null]);
});

test("没配主密钥时救援改派：写不了新一行的密文，整个事务回滚，原来那一行不变成「已转出」（不能丢了这单）", async () => {
  const passenger = fictional();
  const order = await placeOrder(passenger);
  await payOrder(order.id);
  const side = await tenantSideOf(order.id);
  const rescuer = side === "a" ? m.b : m.a;
  await api.db.owner.query("update orders set status = 'rescue_pending' where id = $1", [order.id]);
  useCrypto(DUAL, null);
  await assert.rejects(
    withPlatformTx(api.db.pool, async (db) => {
      const current = await findOrderForPlatform(db, order.id);
      assert.ok(current);
      await markOrderRescued(db, current, api.clock.now());
      await insertRescuedOrder(db, { original: current, tenantId: rescuer.tenantId, productId: side === "a" ? m.ids.pb : m.ids.pa, productVersion: 1, settlementMinor: 1000, settlementCurrency: "JPY", settlement: current.settlement, urgent: false, inventoryHeld: false, dispatchDueAt: new Date(api.clock.now().getTime() + HOUR), now: api.clock.now() });
    }),
    (err: { code?: string }) => err.code === "PASSENGER_ENCRYPTION_NOT_CONFIGURED",
  );
  const rows = (await api.db.owner.query("select status, tenant_id from orders where id = $1", [order.id])).rows;
  assert.deepEqual(rows, [{ status: "rescue_pending", tenant_id: m[side].tenantId }]);
  await api.db.owner.query("update orders set status = 'confirmed' where id = $1", [order.id]);
});
