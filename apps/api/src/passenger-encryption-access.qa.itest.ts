/**
 * M4-22 QA（ADR 0057）：盲索引、防枚举、跨租户、表权限、泄露、明文不再写时各个出口、性能、开关接线。
 * 真实 PostgreSQL（独立 schema）；收款、邮件、Webhook 接收方用替身；联系方式全部虚构，schema 随 api.close() 删除。已有 passenger-encryption.itest.ts 覆盖的不重复。
 */
import { platformChangeWithEmailReview } from "./testing/passenger-email.ts";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { ENCRYPTED_TEXT } from "@nozomi/domain";
import type { AppContext } from "./context.ts";
import { attachPassengerCrypto, passengerCryptoOfPool, withPlatformTx, withTenantTx } from "./db/context.ts";
import { PassengerCrypto, type PassengerEncryptionSettings } from "./integrations/passenger-crypto.ts";
import { SecretBox } from "./integrations/secret-box.ts";
import { findOrderForPlatform } from "./repos/orders.ts";
import { insertRescuedOrder, markOrderRescued } from "./repos/rescues.ts";
import { planPassengerBackfill, runPassengerBackfill } from "./services/passenger-encryption.ts";
import { type ApiResponse, type TestApi, createTestApi } from "./testing/api.ts";
import { assign, newDriver, newVehicle, seedOrder, startFakeReceiver, type FakeReceiver } from "./testing/dispatch.ts";
import { type FakeSmtp, startFakeSmtp } from "./testing/fake-integrations.ts";
import { FAKE_SECRETS } from "./testing/fixtures.ts";
import { type Market, allKeys, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { platformLogin, tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";
import { retentionCtx } from "./testing/retention-fixtures.ts";
import { type SiteApi, lookupQueued, resetLinkLimits, siteApi } from "./testing/site.ts";

const HOUR = 3_600_000;
const DUAL: PassengerEncryptionSettings = { readSource: "ciphertext", plaintextWrite: true, backfillEnabled: true };
const RETIRED: PassengerEncryptionSettings = { readSource: "ciphertext", plaintextWrite: false, backfillEnabled: true };
const PLAIN_READ: PassengerEncryptionSettings = { readSource: "plaintext", plaintextWrite: true, backfillEnabled: true };
const CORRUPT = "v1.AAAA.AAAA.AAAA";

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let smtp: FakeSmtp;
let site: SiteApi;
let receiver: FakeReceiver;
let ctx: AppContext;
let box: SecretBox;
let sales: { clientId: string; secret: string; token: string };
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
  const other = (await newChannel(api, m.staff.cm1.token, { name: "别的渠道" })).id;
  sales = await salesCredentials(api, m, other);
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

function fictional(): { name: string; phone: string; email: string; needles: string[] } {
  counter += 1;
  const tag = String(3000 + counter);
  const name = `星野访${String.fromCodePoint(0x4e00 + counter)}${String.fromCodePoint(0x4e80 + counter)}`;
  const email = `access.${tag}@fictional.example.test`;
  const phone = `+8180${tag}${tag}`;
  return { name, phone, email, needles: [name, email, phone, `${tag}${tag}`, `access.${tag}`] };
}
const contact = (p: { name: string; phone: string; email: string }): { name: string; phone: string; email: string } => ({ name: p.name, phone: p.phone, email: p.email });

const quoteBody = (at: Date) => ({ category: "airport_transfer", city_id: m.ids.tokyo, airport_id: m.ids.narita, direction: "pickup", address: { lng: 139.7, lat: 35.6 }, service_local: new Date(at.getTime() + 9 * HOUR).toISOString().slice(0, 16), passengers: 2, luggage: 1 });

async function placeOrder(passenger: { name: string; phone: string; email: string }, key: string = randomUUID()): Promise<{ id: string; order_no: string; ip: string; token: string; body: any }> {
  counter += 1;
  const ip = `198.51.100.${(counter % 200) + 1}`;
  api.clock.advance(1_000);
  const at = new Date(api.clock.now().getTime() + 10 * 24 * HOUR + counter * HOUR);
  const quotes = await site.call("POST", "/site/v1/quotes", { ip, body: quoteBody(at) });
  assert.equal(quotes.status, 200, quotes.text);
  const quote = quotes.body.quotes.find((row: any) => row.vehicle_group.id === m.ids.biz7);
  assert.ok(quote, quotes.text);
  api.clock.advance(1_000);
  const res = await site.call("POST", "/site/v1/orders", { ip, headers: { "idempotency-key": key }, body: { quote_id: quote.quote_id, passenger: contact(passenger), flight_no: "NH211", dropoff_address: "东京站八重洲口", save_payment_method: true } });
  assert.equal(res.status, 201, res.text);
  return { id: res.body.order.id, order_no: res.body.order.order_no, ip, token: res.body.link.token, body: res.body };
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
const row = async (id: string): Promise<any> => (await api.db.owner.query("select tenant_id, passenger, passenger_enc, passenger_email_bidx, passenger_phone_bidx, passenger_name_bidx from orders where id = $1 and status <> 'rescued'", [id])).rows[0];
const revealOf = async (id: string): Promise<any> => ok(api.call("POST", `/platform/v1/orders/${id}/passenger/reveal`, { token: await ops() }));
/** 每次换一个来源地址：按地址的限速和这里要验的规范化无关（按订单号的限速不受影响）。 */
let lookupIp = 0;
const nextIp = (): string => {
  lookupIp += 1;
  return `203.0.${113 + (lookupIp >> 8)}.${lookupIp & 255}`;
};
/** 查订单（ADR 0061）：应答一律 202，对没对上看有没有排信。`lookup` 先清掉订单号、邮箱的限速（这里测的是核对，不是限速） */
const lookupRaw = (order: { order_no: string }, email: string): Promise<{ res: ApiResponse; queued: boolean }> => lookupQueued(api, site, { orderNo: order.order_no, email, ip: nextIp() });
const lookup = async (order: { order_no: string }, email: string): Promise<{ res: ApiResponse; queued: boolean }> => {
  await resetLinkLimits(api);
  return lookupRaw(order, email);
};
/** 手机号不能用来查（链接只发邮箱）：一律 400，和订单无关 */
const phoneRefused = async (order: { order_no: string }, phone: string): Promise<boolean> => (await site.call("POST", "/site/v1/orders/lookup", { ip: nextIp(), body: { order_no: order.order_no, email: phone } })).status === 400;
const sideOf = async (id: string): Promise<"a" | "b"> => ((await row(id)).tenant_id === m.a.tenantId ? "a" : "b");
const tenantToken = (side: "a" | "b"): Promise<string> => tenantLogin(api, m[side].adminEmail);

async function changePassenger(orderId: string, passenger: { name: string; phone: string; email: string }): Promise<void> {
  const token = await ops();
  // 改邮箱要另一位同事批准（M4-31，ADR 0065）：走完复核，订单上的乘客信息才全部换成新的
  const changed = await platformChangeWithEmailReview(api, orderId, token, { passenger: contact(passenger) });
  assert.ok([200, 202].includes(changed.status), changed.text);
}

async function rescueTo(orderId: string): Promise<{ from: "a" | "b"; to: "a" | "b" }> {
  const from = await sideOf(orderId);
  const to = from === "a" ? "b" : "a";
  await api.db.owner.query("update orders set status = 'rescue_pending' where id = $1 and tenant_id = $2", [orderId, m[from].tenantId]);
  await withPlatformTx(api.db.pool, async (db) => {
    const current = await findOrderForPlatform(db, orderId);
    assert.ok(current);
    await markOrderRescued(db, current, api.clock.now());
    await insertRescuedOrder(db, { original: current, tenantId: m[to].tenantId, productId: to === "a" ? m.ids.pa : m.ids.pb, productVersion: 1, settlementMinor: 1000, settlementCurrency: "JPY", settlement: current.settlement, urgent: false, inventoryHeld: false, dispatchDueAt: new Date(api.clock.now().getTime() + HOUR), now: api.clock.now() });
  });
  return { from, to };
}

/** 这张单放到另一家：官网只卖最便宜的那家，所以下单后走救援改派；销售端那一行也跟着换（和 services/rescues.ts 一样）。 */
async function placeOrderAtOtherTenant(firstSide: "a" | "b", passenger: { name: string; phone: string; email: string }): Promise<{ id: string; order_no: string; ip: string; token: string }> {
  const order = await placeOrder(passenger);
  await payOrder(order.id);
  const side = await sideOf(order.id);
  if (side === firstSide) {
    const { to } = await rescueTo(order.id);
    await api.db.owner.query("update order_sales set supplier_tenant_id = $2 where order_id = $1", [order.id, m[to].tenantId]);
  }
  return order;
}

async function subscribe(side: "a" | "b"): Promise<void> {
  const token = await tenantToken(side);
  const current = await ok(api.call("GET", "/tenant/v1/webhooks", { token }));
  if (current.webhook !== null) await api.call("DELETE", "/tenant/v1/webhooks", { token });
  await ok(api.call("PUT", "/tenant/v1/webhooks", { token, body: { url: receiver.url, events: ["order.changed", "order.confirmed", "order.cancelled"] } }), 201);
}

async function drainMail(): Promise<void> {
  await site.app.notificationJobs.tick();
  await site.app.notificationJobs.tick();
}

async function scanDatabase(needles: readonly string[]): Promise<string[]> {
  const tables = (await api.db.owner.query<{ table_name: string }>("select table_name from information_schema.tables where table_schema = current_schema() and table_type = 'BASE TABLE'")).rows;
  const found = new Set<string>();
  for (const { table_name: table } of tables) {
    for (const item of (await api.db.owner.query(`select * from "${table}"`)).rows) {
      for (const [column, value] of Object.entries(item)) {
        if (value === null || value instanceof Date || typeof value === "number" || typeof value === "boolean") continue;
        const text = typeof value === "string" ? value : Buffer.isBuffer(value) ? value.toString("latin1") : JSON.stringify(value);
        if (needles.some((needle) => text.includes(needle))) found.add(`${table}.${column}`);
      }
    }
  }
  return [...found].sort();
}

/** 查订单认的邮箱写法（ADR 0061 之后只认邮箱） */
const LOOKUP_EMAILS = (p: { email: string }): string[] => {
  const wide = (text: string): string => text.replace(/[A-Za-z0-9.@+\-]/g, (c) => String.fromCodePoint(c.codePointAt(0)! + 0xfee0));
  return [p.email, p.email.toUpperCase(), ` ${p.email}　`, wide(p.email)];
};

/** 原来能查的手机号写法：现在一律 400 */
const LOOKUP_PHONES = (p: { phone: string; email: string }): string[] => {
  const digits = p.phone.slice(1);
  const wide = (text: string): string => text.replace(/[A-Za-z0-9.@+\-]/g, (c) => String.fromCodePoint(c.codePointAt(0)! + 0xfee0));
  return [
    p.phone,
    wide(p.phone),
    `+${digits.slice(0, 2)} ${digits.slice(2, 4)} ${digits.slice(4, 8)} ${digits.slice(8)}`,
    `+${digits.slice(0, 2)}-${digits.slice(2, 4)}-${digits.slice(4, 8)}-${digits.slice(8)}`,
    `(+${digits.slice(0, 2)}) ${digits.slice(2, 4)}.${digits.slice(4, 8)}.${digits.slice(8)}`,
    `+${digits.slice(0, 2)}　${digits.slice(2)}`,
  ];
};

for (const [label, settings] of [["双写读密文", DUAL], ["读明文", PLAIN_READ]] as const) {
  test(`查订单（${label}）：邮箱的大小写、全半角、空格都能对上；改了一位的对不上；手机号不能查`, async () => {
    const passenger = fictional();
    const order = await placeOrder(passenger);
    useCrypto(settings);
    for (const value of LOOKUP_EMAILS(passenger)) assert.equal((await lookup(order, value)).queued, true, JSON.stringify(value));
    for (const value of LOOKUP_PHONES(passenger)) assert.equal(await phoneRefused(order, value), true, JSON.stringify(value));
    for (const value of [`x${passenger.email}`, passenger.email.replace("@", "1@")]) assert.equal((await lookup(order, value)).queued, false, value);
  });
}

test("查订单（明文不再写）：同样的写法都能对上（比盲索引，不靠明文）", async () => {
  useCrypto(RETIRED);
  const passenger = fictional();
  const order = await placeOrder(passenger);
  assert.equal((await row(order.id)).passenger.email, ENCRYPTED_TEXT);
  for (const value of LOOKUP_EMAILS(passenger)) assert.equal((await lookup(order, value)).queued, true, JSON.stringify(value));
  assert.equal(await phoneRefused(order, ENCRYPTED_TEXT), true, "占位不是邮箱");
  assert.equal(await phoneRefused(order, `${ENCRYPTED_TEXT}@`), true);
});

test("官网查订单不需要跨租户检索：同一个邮箱在两家盲索引不同，但各自凭订单号都能找回；A 单的号配 B 单的联系方式对不上", async () => {
  const shared = fictional();
  const first = await placeOrder(shared);
  const firstSide = await sideOf(first.id);
  const elsewhere = { ...fictional(), email: shared.email };
  const second = await placeOrderAtOtherTenant(firstSide, elsewhere);
  const [rowA, rowB] = [await row(first.id), await row(second.id)];
  assert.notEqual(rowA.tenant_id, rowB.tenant_id, "前提：两张单在两家");
  assert.notEqual(rowA.passenger_email_bidx, rowB.passenger_email_bidx, "从库里关联不出同一位客人");
  assert.equal((await lookup(first, shared.email)).queued, true);
  assert.equal((await lookup(second, shared.email)).queued, true);
  assert.equal((await lookup(first, fictional().email)).queued, false, "别人的邮箱");
});

test("运营跨供应商筛选：同一个邮箱两家都筛得到（每家算一次盲索引）；按供应商筛只有这一家；明文不再写时一样", async () => {
  useCrypto(RETIRED);
  const shared = fictional();
  const first = await placeOrder(shared);
  const firstSide = await sideOf(first.id);
  const second = await placeOrderAtOtherTenant(firstSide, { ...fictional(), email: shared.email });
  const token = await ops();
  const ids = async (query: string): Promise<string[]> => (await ok(api.call("GET", `/platform/v1/orders?${query}`, { token }))).items.map((item: any) => item.id);
  const both = await ids(`passenger=${encodeURIComponent(shared.email)}`);
  assert.ok(both.includes(first.id) && both.includes(second.id));
  const scoped = await ids(`passenger=${encodeURIComponent(shared.email)}&tenant_id=${m[firstSide].tenantId}`);
  assert.ok(scoped.includes(first.id) && !scoped.includes(second.id));
  assert.deepEqual(await ids(`passenger=${encodeURIComponent(ENCRYPTED_TEXT)}`), [], "按占位筛不出东西");
});

test("运营筛选的规范化和查订单一致：全角邮箱（日文输入法常见）也算邮箱，能筛到（repos/orders.ts passengerFilterIndexes 在规范化之前找 @）", async () => {
  const passenger = fictional();
  const order = await placeOrder(passenger);
  const wide = passenger.email.replace(/[a-z0-9.@]/g, (c) => String.fromCodePoint(c.codePointAt(0)! + 0xfee0));
  assert.equal((await lookup(order, wide)).queued, true, "前提：查订单认全角邮箱");
  const list = await ok(api.call("GET", `/platform/v1/orders?passenger=${encodeURIComponent(wide)}`, { token: await ops() }));
  assert.ok(list.items.some((item: any) => item.id === order.id), "筛选也要认");
});

test("救援改派之后查订单：盲索引按新租户算也能对上；改过联系方式后新的能查到、旧的查不到（一个订单号有两行，要看现在那一行）", async () => {
  const was = fictional();
  const order = await placeOrder(was);
  await payOrder(order.id);
  await rescueTo(order.id);
  assert.equal((await lookup(order, was.email)).queued, true);
  const now = fictional();
  await changePassenger(order.id, now);
  assert.equal((await revealOf(order.id)).passenger.email, now.email);
  assert.equal((await lookup(order, now.email)).queued, true, "现在的邮箱要查得到（repos/site.ts findChannelOrderByNo 取 rows[0]，可能取到已转出的那一行）");
  assert.equal((await lookup(order, was.email)).queued, false, "旧邮箱不能再收到新的查看链接");
});

test("救援改派（明文不再写）：新一行新租户解得开，读取、官网、供应商、Webhook 都是真内容；旧供应商看不到", async () => {
  useCrypto(RETIRED);
  const passenger = fictional();
  const order = await placeOrder(passenger);
  await payOrder(order.id);
  const { from, to } = await rescueTo(order.id);
  assert.equal((await row(order.id)).passenger.name, ENCRYPTED_TEXT);
  assert.deepEqual((await revealOf(order.id)).passenger, contact(passenger));
  assert.equal((await lookup(order, passenger.email)).queued, true);
  const rescuerView = await ok(api.call("GET", `/tenant/v1/orders/${order.id}`, { token: await tenantToken(to) }));
  assert.equal(rescuerView.order.passenger.email, passenger.email);
  const oldView = await api.call("GET", `/tenant/v1/orders/${order.id}`, { token: await tenantToken(from) });
  assert.ok(!oldView.text.includes(ENCRYPTED_TEXT), "旧供应商不能看到占位");
  assert.deepEqual(alerts, []);
});

test("防枚举（明文不再写、这单解不开）：错的、对的邮箱和不存在的订单号应答完全一样，不能 503 暴露订单存在", async () => {
  useCrypto(RETIRED);
  const passenger = fictional();
  const order = await placeOrder(passenger);
  const saved = (await row(order.id)).passenger_enc;
  await api.db.owner.query("update orders set passenger_enc = $2 where id = $1", [order.id, `${useCrypto(RETIRED).currentPrefix}${CORRUPT}`]);
  try {
    const wrong = await lookup(order, "nobody@fictional.example.test");
    const missing = await lookup({ order_no: "NZ20261007ZZZZZZZZ" }, "nobody@fictional.example.test");
    assert.deepEqual([wrong.res.status, wrong.res.body], [missing.res.status, missing.res.body], "订单号存在、解不开时不能和不存在的订单号有区别");
    assert.deepEqual([wrong.res.status, wrong.queued], [202, false]);
    assert.equal((await lookup(order, passenger.email)).queued, false, "对得上却解不开：不排信（后台记日志），应答照样一样");
  } finally {
    await api.db.owner.query("update orders set passenger_enc = $2 where id = $1", [order.id, saved]);
  }
});

test("防枚举：盲索引和明文两条路上，错的邮箱和不存在的订单号应答一样；限速同样生效（按订单号，不管对没对上）", async () => {
  const passenger = fictional();
  const legacy = await placeOrder(passenger);
  await api.db.owner.query("update orders set passenger_enc = null, passenger_email_bidx = null, passenger_phone_bidx = null, passenger_name_bidx = null where id = $1", [legacy.id]);
  const indexed = await placeOrder(fictional());
  const answers = [];
  for (const order of [legacy, indexed]) answers.push(await lookup(order, "nobody@fictional.example.test"));
  answers.push(await lookup({ order_no: "NZ20261007ZZZZZZZY" }, "nobody@fictional.example.test"));
  for (const answer of answers) assert.deepEqual([answer.res.status, answer.res.body, answer.queued], [202, answers[0]!.res.body, false]);
  await resetLinkLimits(api);
  const statuses = [];
  for (let i = 0; i < 12; i += 1) statuses.push((await lookupRaw(indexed, `wrong${i}@fictional.example.test`)).res.status);
  assert.ok(statuses.includes(429), `错 12 次要被限速：${statuses.join(",")}`);
  assert.equal((await lookupRaw(indexed, "still-wrong@fictional.example.test")).res.status, 429);
  await runPassengerBackfill(ctx, { pauseMs: 0 });
});

test("表权限和行级安全：供应商角色读不到别家的密文和盲索引列（四张表），一行都没有", async () => {
  const passenger = fictional();
  const order = await placeOrder(passenger);
  const owner = await sideOf(order.id);
  await subscribe(owner);
  await payOrder(order.id);
  await drainMail();
  await changePassenger(order.id, fictional());
  const stranger = owner === "a" ? m.b : m.a;
  const checks = [
    "select passenger_enc as v, passenger_email_bidx, passenger from orders where id = $1",
    "select values_enc as v from order_changes where order_id = $1",
    "select event_data_enc as v from webhook_deliveries where order_id = $1",
    "select recipient_enc as v from notifications where order_id = $1",
  ];
  for (const sql of checks) {
    const seen = await withTenantTx(api.db.pool, stranger.tenantId, (db) => db.query(sql, [order.id])).then(
      (res) => res.rows.length,
      (err: { code?: string }) => {
        assert.equal(err.code, "42501", "只能是没有权限");
        return 0;
      },
    );
    assert.equal(seen, 0, sql);
  }
});

test("表权限：供应商角色（包括自己家的行）改不了任何密文列，否则能把自己的单改成解不开", async () => {
  const order = await placeOrder(fictional());
  const owner = await sideOf(order.id);
  await subscribe(owner);
  await payOrder(order.id);
  await drainMail();
  await changePassenger(order.id, fictional());
  await api.app.webhookJobs.tick();
  const tenantId = m[owner].tenantId;
  const counts = (await api.db.owner.query("select (select count(*) from order_changes where order_id = $1 and values_enc is not null)::int as c, (select count(*) from webhook_deliveries where order_id = $1 and event_data_enc is not null)::int as w, (select count(*) from notifications where order_id = $1 and recipient_enc is not null)::int as n", [order.id])).rows[0];
  assert.ok(counts.c >= 1 && counts.w >= 1 && counts.n >= 1, JSON.stringify(counts));
  const writes = [
    ["orders.passenger_enc", "update orders set passenger_enc = 'x' where id = $1"],
    ["orders.passenger_name_bidx", "update orders set passenger_name_bidx = 'x' where id = $1"],
    ["order_changes.values_enc", "update order_changes set values_enc = 'x' where order_id = $1"],
    ["webhook_deliveries.event_data_enc", "update webhook_deliveries set event_data_enc = 'x' where order_id = $1"],
    ["notifications.recipient_enc", "update notifications set recipient_enc = 'x' where order_id = $1"],
  ] as const;
  const writable: string[] = [];
  for (const [label, sql] of writes) {
    const changed = await withTenantTx(api.db.pool, tenantId, async (db) => {
      const res = await db.query(sql, [order.id]);
      // 只看能不能改，不留下：回滚
      throw Object.assign(new Error("rollback"), { changed: res.rowCount ?? 0 });
    }).catch((err: { changed?: number }) => err.changed ?? 0);
    if (changed > 0) writable.push(label);
  }
  assert.deepEqual(writable, [], "供应商角色能改这些密文列");
});

test("接口响应里没有密文和盲索引（供应商、运营、渠道、官网、司机），密文原文也不出现；供应商接口没有对外价和加价比例（规则 4）", async () => {
  const passenger = fictional();
  const order = await placeOrder(passenger);
  const side = await sideOf(order.id);
  await subscribe(side);
  await payOrder(order.id);
  await drainMail();
  await changePassenger(order.id, fictional());
  await api.app.webhookJobs.tick();
  await runPassengerBackfill(ctx, { pauseMs: 0 });
  const stored = await row(order.id);
  const cipherTexts = [stored.passenger_enc, stored.passenger_email_bidx, stored.passenger_phone_bidx, stored.passenger_name_bidx];
  for (const [table, column] of [["order_changes", "values_enc"], ["webhook_deliveries", "event_data_enc"], ["notifications", "recipient_enc"]] as const) {
    for (const item of (await api.db.owner.query(`select ${column} as v from ${table} where order_id = $1 and ${column} is not null`, [order.id])).rows) cipherTexts.push(item.v);
  }
  const platform = await ops();
  const tenant = await tenantToken(side);
  const deliveries = await ok(api.call("GET", `/tenant/v1/webhooks/deliveries`, { token: tenant }));
  const tenantResponses = [
    await api.call("GET", "/tenant/v1/orders", { token: tenant }),
    await api.call("GET", `/tenant/v1/orders/${order.id}`, { token: tenant }),
    await api.call("GET", "/tenant/v1/webhooks/deliveries", { token: tenant }),
    await api.call("GET", `/tenant/v1/webhooks/deliveries/${deliveries.items[0].id}`, { token: tenant }),
  ];
  const others = [
    await api.call("GET", "/platform/v1/orders", { token: platform }),
    await api.call("GET", `/platform/v1/orders/${order.id}`, { token: platform }),
    await api.call("POST", `/platform/v1/orders/${order.id}/passenger/reveal`, { token: platform }),
    await api.call("GET", `/platform/v1/notifications?order_id=${order.id}`, { token: platform }),
    await api.call("GET", `/platform/v1/webhook-deliveries?order_id=${order.id}`, { token: platform }),
    await site.call("GET", "/site/v1/order", { ip: order.ip, token: order.token }),
  ];
  for (const res of [...tenantResponses, ...others]) {
    assert.equal(res.status, 200, res.text.slice(0, 200));
    const keys = [...allKeys(res.body)];
    assert.deepEqual(keys.filter((key) => /_enc$|_bidx$|^enc$|bidx/i.test(key)), [], "响应里不能有这些键");
    for (const secret of cipherTexts) assert.ok(!res.text.includes(secret), "响应里不能有密文或盲索引的值");
    assert.ok(!res.text.includes(FAKE_SECRETS.dataEncryptionKey));
  }
  for (const res of tenantResponses) {
    const keys = [...allKeys(res.body)];
    assert.deepEqual(keys.filter((key) => /sell|markup/i.test(key)), [], "规则 4");
  }
});

test("明文不再写时各个出口都是真内容：供应商列表和详情、司机端、渠道、官网、改单前后值都没有占位", async () => {
  useCrypto(RETIRED);
  const passenger = fictional();
  const order = await placeOrder(passenger);
  await payOrder(order.id);
  const side = await sideOf(order.id);
  const token = await tenantToken(side);
  const list = await ok(api.call("GET", "/tenant/v1/orders", { token }));
  const mine = list.items.find((item: any) => item.id === order.id);
  assert.ok(mine);
  assert.ok(!JSON.stringify(list).includes(ENCRYPTED_TEXT), "供应商列表");
  const detail = await ok(api.call("GET", `/tenant/v1/orders/${order.id}`, { token }));
  assert.deepEqual(contact(detail.order.passenger), contact(passenger));
  const guest = await ok(site.call("GET", "/site/v1/order", { ip: order.ip, token: order.token }));
  assert.ok(!JSON.stringify(guest).includes(ENCRYPTED_TEXT), "官网页面");
  const platform = await ops();
  const adminList = await ok(api.call("GET", `/platform/v1/orders?q=${order.order_no}`, { token: platform }));
  assert.ok(!JSON.stringify(adminList).includes(ENCRYPTED_TEXT), "运营列表：打码的是真内容");
  const who = { ...m[side], adminToken: token };
  const assigned = await ok(assign(api, who, order.id, (await newDriver(api, who)).id, (await newVehicle(api, who, m.ids.biz7)).id));
  const trip = await api.call("GET", "/driver/v1/trip", { token: assigned.driver_link.token });
  assert.equal(trip.status, 200, trip.text.slice(0, 200));
  assert.ok(!trip.text.includes(ENCRYPTED_TEXT), "司机端");
  assert.ok(trip.text.includes(passenger.name) || trip.text.includes(passenger.phone), "司机端要有乘客的联系方式");
  assert.deepEqual(alerts, []);
});

test("发信（明文不再写）：等待发送时改了邮箱，发到新地址，库里的密文也跟着换；任何一封信的地址和内容都没有占位", async () => {
  useCrypto(RETIRED);
  const was = fictional();
  const now = fictional();
  const order = await placeOrder(was);
  smtp.reset();
  await payOrder(order.id);
  await changePassenger(order.id, now);
  await drainMail();
  const toGuest = smtp.messages.filter((message) => message.to.includes(now.email) || message.to.includes(was.email));
  assert.ok(toGuest.length >= 1, `发给客人的信：${smtp.messages.length} 封里 0 封`);
  assert.ok(toGuest.every((message) => !message.to.includes(was.email)) || smtp.messages.some((message) => message.to.includes(now.email)));
  for (const message of smtp.messages) {
    assert.ok(!message.to.includes(ENCRYPTED_TEXT), "收件地址不能是占位");
    assert.ok(!message.data.includes(ENCRYPTED_TEXT), "内容不能有占位");
  }
  const crypto = useCrypto(RETIRED);
  const stored = (await api.db.owner.query("select tenant_id, event_id, recipient, recipient_enc from notifications where order_id = $1 and audience = 'guest'", [order.id])).rows;
  assert.ok(stored.length >= 1);
  for (const item of stored) {
    assert.equal(item.recipient, ENCRYPTED_TEXT);
    assert.ok([was.email, now.email].includes(crypto.openForVerify("notification", item.tenant_id, item.event_id, item.recipient_enc) as string));
  }
});

test("推送重试（明文不再写）：失败的推送重发出去的还是原文，不是占位", async () => {
  useCrypto(RETIRED);
  const was = fictional();
  const now = fictional();
  const order = await placeOrder(was);
  await subscribe(await sideOf(order.id));
  await payOrder(order.id);
  await api.app.webhookJobs.tick();
  await changePassenger(order.id, now);
  // 改邮箱经复核另成一次改单（M4-31，ADR 0065）：先是姓名电话那一条（同一单的推送按顺序一条一条发，先让它送达），要重试的是邮箱那一条
  await api.app.webhookJobs.tick();
  receiver.received.length = 0;
  receiver.respond([500]);
  await api.app.webhookJobs.tick();
  receiver.respond([200]);
  const stored = (await api.db.owner.query("select id, event_data from webhook_deliveries where order_id = $1 and event_type = 'order.changed' order by seq desc limit 1", [order.id])).rows[0];
  assert.ok(stored);
  assert.ok(!JSON.stringify(stored.event_data).includes(now.email), "库里只有占位");
  api.clock.advance(HOUR);
  await api.app.webhookJobs.tick();
  const bodies = receiver.received.filter((item) => item.body.includes(order.id)).map((item) => JSON.parse(item.body)).filter((body) => body.type === "order.changed");
  assert.ok(bodies.length >= 1);
  for (const body of bodies) {
    assert.equal(body.data.after.passenger.email, now.email);
    assert.equal(body.data.before.passenger.email, was.email);
    assert.ok(!JSON.stringify(body).includes(ENCRYPTED_TEXT));
  }
});

test("重复提交（明文不再写）：同一个 Idempotency-Key 返回同一张单，不多写一行；换内容 422，请求里的联系方式不进响应也不进日志", async () => {
  useCrypto(RETIRED);
  counter += 1;
  const ip = `198.51.100.${(counter % 200) + 1}`;
  api.clock.advance(1_000);
  const passenger = fictional();
  const quotes = await site.call("POST", "/site/v1/quotes", { ip, body: quoteBody(new Date(api.clock.now().getTime() + 40 * 24 * HOUR)) });
  const quote = quotes.body.quotes.find((item: any) => item.vehicle_group.id === m.ids.biz7);
  const key = randomUUID();
  const body = { quote_id: quote.quote_id, passenger: contact(passenger), flight_no: "NH211", dropoff_address: "东京站八重洲口", save_payment_method: true };
  const first = await site.call("POST", "/site/v1/orders", { ip, headers: { "idempotency-key": key }, body });
  assert.equal(first.status, 201, first.text);
  const again = await site.call("POST", "/site/v1/orders", { ip, headers: { "idempotency-key": key }, body });
  assert.ok(again.status === 200 || again.status === 201, again.text);
  assert.equal(again.body.order.id, first.body.order.id);
  const other = fictional();
  const conflict = await site.call("POST", "/site/v1/orders", { ip, headers: { "idempotency-key": key }, body: { ...body, passenger: contact(other) } });
  assert.equal(conflict.status, 422, conflict.text);
  assert.ok(!conflict.text.includes(other.email));
  assert.equal((await api.db.owner.query("select count(*)::int as n from orders where id = $1", [first.body.order.id])).rows[0].n, 1);
  assert.deepEqual((await revealOf(first.body.order.id)).passenger, contact(passenger));
});

test("全库扫描（明文不再写）：渠道下单改单取消、官网工单和取消、派车、救援改派之后，库里一处明文都没有；日志里没有明文、密文、盲索引", async () => {
  useCrypto(RETIRED);
  siteLogs = "";
  const needles: string[] = [];
  const remember = <T extends { needles: string[] }>(person: T): T => {
    needles.push(...person.needles);
    return person;
  };

  // 渠道：下单、改乘客、取消
  api.clock.advance(1_000);
  const salesPassenger = remember(fictional());
  const salesChanged = remember(fictional());
  const quoted = await ok(api.call("POST", "/sales/v1/quotes", { token: sales.token, body: { city_id: m.ids.tokyo, category: "airport_transfer", place_id: m.ids.narita, direction: "pickup", currency: "JPY", dropoff: { lng: 139.7, lat: 35.6 }, service_time: new Date(api.clock.now().getTime() + 30 * 24 * HOUR).toISOString().replace(/\.\d{3}Z$/, "Z"), passengers: 2, luggage: 1 } }));
  const salesQuote = quoted.quotes.find((item: any) => item.vehicle_group_id === m.ids.biz7);
  assert.ok(salesQuote, JSON.stringify(quoted));
  api.clock.advance(1_000);
  const created = await ok(api.call("POST", "/sales/v1/orders", { token: sales.token, headers: { "idempotency-key": randomUUID() }, body: { quote_id: salesQuote.quote_id, passenger: contact(salesPassenger), flight_no: "NH 211", dropoff_address: "东京站八重洲口", save_payment_method: true } }), 201);
  const salesOrder = created.order;
  await payOrder(salesOrder.id);
  await subscribe(await sideOf(salesOrder.id));
  const salesVersion = (await ok(api.call("GET", `/sales/v1/orders/${salesOrder.id}`, { token: sales.token }))).order.version;
  await ok(api.call("PATCH", `/sales/v1/orders/${salesOrder.id}`, { token: sales.token, headers: { "if-match": String(salesVersion) }, body: { passenger: contact(salesChanged) } }));
  await api.app.webhookJobs.tick();
  const salesView = await ok(api.call("GET", `/sales/v1/orders/${salesOrder.id}`, { token: sales.token }));
  assert.equal(salesView.order.passenger.email, salesChanged.email, "渠道读到的是真内容");
  await ok(api.call("POST", `/sales/v1/orders/${salesOrder.id}/cancel`, { token: sales.token, body: {} }));

  // 官网：下单、付款、客人自己改、工单、派车、救援改派
  const guest = remember(fictional());
  const guestChanged = remember(fictional());
  const order = await placeOrder(guest);
  await payOrder(order.id);
  const version = (await ok(site.call("GET", "/site/v1/order", { ip: order.ip, token: order.token }))).order.version;
  await ok(site.call("PATCH", "/site/v1/order", { ip: order.ip, token: order.token, headers: { "if-match": String(version) }, body: { passenger: contact(guestChanged) } }));
  const ticket = await site.call("POST", "/site/v1/order/tickets", { ip: order.ip, token: order.token, body: { type: "other", subject: "虚构的问题", description: "虚构的说明，不写联系方式" } });
  assert.equal(ticket.status, 201, ticket.text);
  const side = await sideOf(order.id);
  const token = await tenantToken(side);
  const who = { ...m[side], adminToken: token };
  await ok(assign(api, who, order.id, (await newDriver(api, who)).id, (await newVehicle(api, who, m.ids.biz7)).id));
  await drainMail();
  await rescueTo(order.id);
  await drainMail();

  // 运营看过、解开过（审计里不能留内容）
  await revealOf(order.id);
  await ok(api.call("GET", `/platform/v1/orders?passenger=${encodeURIComponent(guestChanged.email)}`, { token: await ops() }));

  assert.deepEqual(await scanDatabase(needles), [], "库里还有明文");
  const logs = api.logs() + siteLogs;
  for (const needle of needles) assert.ok(!logs.includes(needle), `日志里有 ${needle}`);
  const stored = await row(order.id);
  for (const secret of [stored.passenger_enc, stored.passenger_email_bidx, stored.passenger_phone_bidx, FAKE_SECRETS.dataEncryptionKey]) assert.ok(!logs.includes(secret), "日志里有密文、盲索引或密钥");
});

for (const [label, method, path, schema, caller] of [
  ["运营详情", "GET", (id: string) => `/platform/v1/orders/${id}`, "/platform/v1/orders/{id}", "platform"],
  ["运营 reveal", "POST", (id: string) => `/platform/v1/orders/${id}/passenger/reveal`, "/platform/v1/orders/{id}/passenger/reveal", "platform"],
  ["供应商详情", "GET", (id: string) => `/tenant/v1/orders/${id}`, "/tenant/v1/orders/{id}", "tenant"],
] as const) {
  test(`解不开时 ${label} 返回 503 PASSENGER_DECRYPT_FAILED，OpenAPI 写了这个应答；响应和报警里没有内容`, async () => {
    useCrypto(RETIRED);
    const passenger = fictional();
    const order = await placeOrder(passenger);
    await payOrder(order.id);
    const side = await sideOf(order.id);
    const saved = (await row(order.id)).passenger_enc;
    await api.db.owner.query("update orders set passenger_enc = $2 where id = $1", [order.id, `${useCrypto(RETIRED).currentPrefix}${CORRUPT}`]);
    try {
      const token = caller === "platform" ? await ops() : await tenantToken(side);
      const res = await api.call(method, path(order.id), { token });
      assert.equal(res.status, 503, res.text.slice(0, 200));
      assert.equal(res.body.error.code, "PASSENGER_DECRYPT_FAILED");
      for (const needle of passenger.needles) assert.ok(!res.text.includes(needle));
      assert.ok(!JSON.stringify(alerts).includes(CORRUPT), "报警里没有密文");
      assertMatchesOpenApi(method, schema, res);
    } finally {
      await api.db.owner.query("update orders set passenger_enc = $2 where id = $1", [order.id, saved]);
    }
  });
}

test("列表性能：运营 100 行、供应商 100 行，查询条数和 10 行一样（没有 N+1），解密不让接口明显变慢", async () => {
  const placed = [];
  for (let i = 0; i < 105; i += 1) placed.push(await placeOrder(fictional()));
  for (let i = 0; i < 105; i += 1) await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + (900 + i) * HOUR) });
  await runPassengerBackfill(ctx, { pauseMs: 0 });
  assert.equal((await planPassengerBackfill(ctx)).orders, 0);
  let queries = 0;
  const original = pg.Client.prototype.query;
  const counting = function (this: unknown, ...args: unknown[]): unknown {
    queries += 1;
    return (original as (...a: unknown[]) => unknown).apply(this, args);
  };
  const platform = await ops();
  const tenant = await tenantToken("a");
  const measure = async (url: string, token: string): Promise<{ queries: number; ms: number; rows: number }> => {
    queries = 0;
    pg.Client.prototype.query = counting as typeof pg.Client.prototype.query;
    const started = performance.now();
    const res = await api.call("GET", url, { token });
    const ms = performance.now() - started;
    pg.Client.prototype.query = original;
    assert.equal(res.status, 200, res.text.slice(0, 200));
    return { queries, ms, rows: res.body.items.length };
  };
  for (const [url, token] of [["/platform/v1/orders", platform], ["/tenant/v1/orders", tenant]] as const) {
    await measure(`${url}?limit=5`, token);
    // 计数的是整个进程里的查询：后台任务刚好在这时跑会多出几条（CI 上见过 +4）。各量两次取少的那次：
    // 真正的 N+1 在 100 行时会多出几十条，取少的照样拦得住
    const fewest = async (target: string): Promise<{ queries: number; ms: number; rows: number }> => {
      const first = await measure(target, token);
      const second = await measure(target, token);
      return first.queries <= second.queries ? first : second;
    };
    const small = await fewest(`${url}?limit=10`);
    const large = await fewest(`${url}?limit=100`);
    assert.equal(small.rows, 10);
    assert.equal(large.rows, 100);
    assert.equal(large.queries, small.queries, `${url}：查询条数随行数变多是 N+1（10 行 ${small.queries} 条，100 行 ${large.queries} 条）`);
    assert.ok(large.ms < 1500, `${url} 100 行用了 ${Math.round(large.ms)} 毫秒`);
  }
  const filtered = await measure(`/platform/v1/orders?limit=100&passenger=${encodeURIComponent("星野")}`, platform);
  assert.ok(filtered.rows >= 100);
  assert.ok(filtered.ms < 1500, `筛选 100 行用了 ${Math.round(filtered.ms)} 毫秒`);
});

test("开关真的接到应用上：配置里的值决定读哪里、写不写明文、回填跑不跑；没配主密钥启动时有错误日志，日志里没有密钥", async () => {
  const off = await createTestApi({ env: { PASSENGER_READ_SOURCE: "plaintext", PASSENGER_BACKFILL_ENABLED: "false" } });
  try {
    const crypto = passengerCryptoOfPool(off.db.pool);
    assert.equal(crypto.readsCiphertext, false);
    assert.equal(crypto.backfillEnabled, false);
    assert.equal(crypto.plaintextWrite, true);
    assert.equal(await off.app.passengerEncryption.tick(), null);
  } finally {
    await off.close();
  }
  const retired = await createTestApi({ env: { PASSENGER_PLAINTEXT_WRITE: "false" } });
  try {
    const crypto = passengerCryptoOfPool(retired.db.pool);
    assert.equal(crypto.plaintextWrite, false);
    assert.equal(crypto.readsCiphertext, true);
    assert.ok(!retired.logs().includes(FAKE_SECRETS.dataEncryptionKey));
  } finally {
    await retired.close();
  }
  const keyless = await createTestApi({ env: { DATA_ENCRYPTION_KEY: "" } });
  try {
    assert.equal(passengerCryptoOfPool(keyless.db.pool).configured, false);
    assert.match(keyless.logs(), /passenger\.encryption_not_configured/);
  } finally {
    await keyless.close();
  }
});
