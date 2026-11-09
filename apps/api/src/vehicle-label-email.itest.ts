/**
 * M7-04：订单相关邮件里的车型标识（ADR 0068 第 3 节），连真实 PostgreSQL 和本机的假 SMTP；收款用替身。
 * - 官网付款后：客人的确认邮件、供应商的新订单邮件在「车型」下面有同级车型说明和最多乘客 / 行李，纯文字版和 HTML 版都有；
 *   供应商邮件里没有对外价、加价比例（规则 4）；
 * - 派车后司机的任务邮件同样有；
 * - 取的是车型组当前的值：清空代表车型后，后面的邮件里同级车型那一行不出现，不留空标签。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type TestApi, createTestApi } from "./testing/api.ts";
import { assign, newDriver, newVehicle } from "./testing/dispatch.ts";
import { type FakeSmtp, type FakeSmtpMessage, decodedMailHtml, decodedMailText, startFakeSmtp } from "./testing/fake-integrations.ts";
import { type Market, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { tenantLogin } from "./testing/money.ts";
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

const HOUR = 3_600_000;
const GUEST_EMAIL = "guest.vehicle@example.com";
const DRIVER_EMAIL = "fictional.driver.vehicle@example.test";
const SIMILAR = "同级车型：Toyota Noah / Voxy, Nissan Serena or similar";
const CAPACITY = "最多乘客：6 人，最多行李：4 件";

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let smtp: FakeSmtp;
let site: SiteApi;
let serviceSeq = 0;

async function patchGroup(body: Record<string, unknown>): Promise<void> {
  const current = await ok(api.call("GET", `/platform/v1/master/vehicle-groups/${m.ids.biz7}`, { token: m.root }));
  api.clock.advance(1_000);
  await ok(api.call("PATCH", `/platform/v1/master/vehicle-groups/${m.ids.biz7}`, { token: m.root, headers: { "if-match": `"${current.version}"` }, body }));
}

before(async () => {
  pay = new FakePaymentProvider();
  smtp = await startFakeSmtp();
  const smtpEnv = { SMTP_HOST: smtp.host, SMTP_PORT: String(smtp.port), SMTP_ENCRYPTION: "none", SMTP_USERNAME: "mailer", SMTP_PASSWORD: "fake-smtp-password-Zq7", SMTP_FROM_NAME: "NOZOMI", SMTP_FROM_ADDRESS: "noreply@example.test" };
  api = await createTestApi({ payments: pay, env: smtpEnv, integrationSecretsTtlMs: 0 });
  m = await buildMarket(api);
  await patchGroup({ sample_models: ["Toyota Noah / Voxy", "Nissan Serena"] });
  const channelId = (await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" })).id;
  site = await siteApi(api, (await salesCredentials(api, m, channelId)).clientId, pay, smtpEnv, { integrationSecretsTtlMs: 0 });
});

after(async () => {
  await site?.close();
  await smtp?.close();
  await api.close();
});

beforeEach(async () => {
  await api.db.owner.query("update notification_events set expanded_at = coalesce(expanded_at, now())");
  await api.db.owner.query("update notifications set status = 'expired', last_error_code = 'ORDER_STATE_CHANGED', lease_token = null, lease_until = null where status in ('pending', 'sending')");
  await api.db.owner.query("update tenant_notification_settings set driver_link_delivery = 'auto', quiet_start = null, quiet_end = null");
  smtp.reset();
});

/** 官网下单并付款，跑一轮发送任务。 */
async function paidSiteOrder(): Promise<{ orderId: string; orderNo: string }> {
  serviceSeq += 1;
  const local = new Date(api.clock.now().getTime() + 10 * 24 * HOUR + serviceSeq * HOUR + 9 * HOUR).toISOString().slice(0, 16);
  api.clock.advance(1_000);
  const quotes = await site.call("POST", "/site/v1/quotes", { ip: `198.51.100.${serviceSeq + 20}`, body: { category: "airport_transfer", city_id: m.ids.tokyo, airport_id: m.ids.narita, direction: "pickup", address: { lng: 139.7, lat: 35.6 }, service_local: local, passengers: 2, luggage: 1 } });
  assert.equal(quotes.status, 200, quotes.text);
  const quote = quotes.body.quotes.find((row: any) => row.vehicle_group.id === m.ids.biz7);
  assert.ok(quote, quotes.text);
  api.clock.advance(1_000);
  const res = await site.call("POST", "/site/v1/orders", { ip: `198.51.100.${serviceSeq + 20}`, headers: { "idempotency-key": randomUUID() }, body: { quote_id: quote.quote_id, passenger: { name: "王小明", phone: "+81 90-1234-5678", email: GUEST_EMAIL }, flight_no: "NH211", dropoff_address: "东京站八重洲口", save_payment_method: true } });
  assert.equal(res.status, 201, res.text);
  const intent = pay.intentOf(res.body.order.id);
  assert.ok(intent);
  pay.pay(intent.id);
  const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
  assert.equal((await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()))).status, 200);
  await site.app.notificationJobs.tick();
  return { orderId: res.body.order.id, orderNo: res.body.order.order_no };
}

const mailTo = (address: string): FakeSmtpMessage => {
  const found = smtp.messages.find((message) => message.to.includes(address));
  assert.ok(found, `${address} 没收到邮件`);
  return found;
};

/** 纯文字版和 HTML 版都有这两行（HTML 版由纯文字生成，ADR 0067）。 */
function assertLabelled(message: FakeSmtpMessage, who: string): string {
  const text = decodedMailText(message.data);
  assert.ok(text.includes(`车型：商务 7 座\n${SIMILAR}\n${CAPACITY}\n`), `${who}：${text}`);
  const html = decodedMailHtml(message.data) ?? "";
  for (const line of [SIMILAR, CAPACITY]) assert.ok(html.includes(line), `${who} 的 HTML 版缺「${line}」`);
  return text;
}

test("官网付款后：客人确认邮件、供应商新订单邮件都有同级车型和最多乘客 / 行李（纯文字和 HTML）；供应商邮件没有金额和加价比例", async () => {
  const order = await paidSiteOrder();
  const guestText = assertLabelled(mailTo(GUEST_EMAIL), "客人");
  assert.match(guestText, /已付金额/);

  const tenant = mailTo(m.b.adminEmail);
  const tenantText = assertLabelled(tenant, "供应商");
  assert.match(tenantText, new RegExp(order.orderNo));
  const sale = (await api.db.owner.query<{ sell_minor: string }>("select sell_minor from order_sales where order_id = $1", [order.orderId])).rows[0]!;
  const raw = `${tenant.data}\n${tenantText}\n${decodedMailHtml(tenant.data) ?? ""}`;
  for (const forbidden of [sale.sell_minor, Number(sale.sell_minor).toLocaleString("en-US"), "对外价", "加价", "已付", "markup"]) assert.ok(!raw.includes(forbidden), `供应商邮件里有 ${forbidden}`);
});

test("派车后司机的任务邮件也有车型标识", async () => {
  const order = await paidSiteOrder();
  const who = { ...m.b, adminToken: await tenantLogin(api, m.b.adminEmail) };
  const driver = await newDriver(api, who, { email: DRIVER_EMAIL });
  const vehicle = await newVehicle(api, who, m.ids.biz7);
  smtp.reset();
  await ok(assign(api, who, order.orderId, driver.id, vehicle.id));
  await site.app.notificationJobs.tick();
  assertLabelled(mailTo(DRIVER_EMAIL), "司机");
});

test("取车型组当前的值：清空代表车型后，邮件里同级车型那一行不出现、不留空标签，最多乘客 / 行李照常", async () => {
  await patchGroup({ sample_models: [] });
  try {
    await paidSiteOrder();
    for (const address of [GUEST_EMAIL, m.b.adminEmail]) {
      const message = mailTo(address);
      const text = decodedMailText(message.data);
      assert.ok(text.includes(`车型：商务 7 座\n${CAPACITY}\n`), text);
      assert.doesNotMatch(text, /同级车型|or similar|undefined/);
      assert.doesNotMatch(decodedMailHtml(message.data) ?? "", /同级车型|undefined/);
    }
  } finally {
    await patchGroup({ sample_models: ["Toyota Noah / Voxy", "Nissan Serena"] });
  }
});
