/**
 * M4-27：司机链接自动发邮件（ADR 0058），真实 PostgreSQL + 本机假 SMTP，从不连真实的邮件服务。全部数据在测试里构造，都是虚构的。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type FastifyInstance } from "fastify";
import { DRIVER_LINK_EMAIL_LIMITS } from "@nozomi/domain";
import { withTenantTx } from "./db/context.ts";
import { TEST_PASSWORD, type TenantFixture, type TestApi, createTestApi } from "./testing/api.ts";
import { assign, newDriver, newVehicle, seedOrder } from "./testing/dispatch.ts";
import { type FakeSmtp, type FakeSmtpMessage, decodedMailText, startFakeSmtp } from "./testing/fake-integrations.ts";
import { type Market, buildMarket, ok } from "./testing/market.ts";
import { platformLogin, tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";
import { siteApi } from "./testing/site.ts";

const HOUR = 3_600_000;
const NO_SMTP = { SMTP_HOST: "", SMTP_PORT: "", SMTP_ENCRYPTION: "", SMTP_USERNAME: "", SMTP_PASSWORD: "", SMTP_FROM_NAME: "", SMTP_FROM_ADDRESS: "" };
const PASSENGER_PHONE = "+819012345678";
const PASSENGER_EMAIL = "guest@example.com";

let api: TestApi;
let m: Market;
let smtp: FakeSmtp;
let a: TenantFixture;
let b: TenantFixture;
let flow: SalesFlow;

before(async () => {
  smtp = await startFakeSmtp();
  const pay = new FakePaymentProvider();
  api = await createTestApi({
    payments: pay,
    env: { SMTP_HOST: smtp.host, SMTP_PORT: String(smtp.port), SMTP_ENCRYPTION: "none", SMTP_USERNAME: "mailer", SMTP_PASSWORD: "fake-smtp-password-Zq7", SMTP_FROM_NAME: "NOZOMI", SMTP_FROM_ADDRESS: "noreply@example.test" },
    integrationSecretsTtlMs: 0,
  });
  m = await buildMarket(api);
  flow = await salesFlow(api, m, pay);
  a = { ...m.a, adminToken: await tenantLogin(api, m.a.adminEmail) };
  b = { ...m.b, adminToken: await tenantLogin(api, m.b.adminEmail) };
});

after(async () => {
  await api.close();
  await smtp.close();
});

/** 每个用例从干净的状态开始：积压都标成已处理，默认自动发送。 */
beforeEach(async () => {
  await api.db.owner.query("update notification_events set expanded_at = coalesce(expanded_at, now())");
  await api.db.owner.query("update notifications set status = 'expired', last_error_code = 'ORDER_STATE_CHANGED', lease_token = null, lease_until = null where status in ('pending', 'sending')");
  await api.db.owner.query("update tenant_notification_settings set driver_link_delivery = 'auto', quiet_start = null, quiet_end = null");
  // 限速按一家统计：每个用例不受前面用例的影响
  api.clock.advance(2 * HOUR);
  a.adminToken = await tenantLogin(api, m.a.adminEmail);
  b.adminToken = await tenantLogin(api, m.b.adminEmail);
  smtp.reset();
});

let emailSeq = 0;
const newEmail = (): string => `fictional.driver${(emailSeq += 1)}.${randomUUID().slice(0, 8)}@example.test`;

const tenantToken = (who: TenantFixture): string => who.adminToken;

/** 远期单 + 有邮箱的司机，派车。 */
async function dispatched(who: TenantFixture = a, side: "a" | "b" = "a", driverExtra: Record<string, unknown> = { email: newEmail() }): Promise<{ order: { id: string; orderNo: string }; driver: any; vehicle: any; res: any }> {
  const order = await seedOrder(api, m, side, { serviceAt: new Date(api.clock.now().getTime() + 96 * HOUR) });
  const driver = await newDriver(api, who, driverExtra);
  const vehicle = await newVehicle(api, who, m.ids.biz7);
  const res = await ok(assign(api, who, order.id, driver.id, vehicle.id));
  return { order, driver, vehicle, res };
}

/** 甲家的员工：经真实接口邀请。 */
async function staffToken(role: "dispatch" | "readonly"): Promise<string> {
  const email = `fictional.staff.${randomUUID().slice(0, 8)}@example.test`;
  const invited = await ok(api.call("POST", "/tenant/v1/users", { token: a.adminToken, body: { email, name: "虚构员工", role } }), 201);
  await ok(api.call("POST", "/tenant/v1/auth/accept-invite", { body: { token: invited.invite.token, password: TEST_PASSWORD } }));
  return tenantLogin(api, email);
}

const tick = (app: FastifyInstance = api.app) => app.notificationJobs.tick();
const tripOf = (token: string) => api.call("GET", "/driver/v1/trip", { token });
const tokenInMail = (text: string): string | null => /\/driver#(nzd_[A-Za-z0-9_.-]+)/.exec(text)?.[1] ?? null;
const mailsTo = (email: string): FakeSmtpMessage[] => smtp.messages.filter((message) => message.to.includes(email));
const statusOf = async (orderId: string, who: TenantFixture = a): Promise<any> => (await ok(api.call("GET", `/tenant/v1/orders/${orderId}/driver-link/email`, { token: tenantToken(who) }))).driver_link_email;
const resend = (orderId: string, who: TenantFixture = a) => api.call("POST", `/tenant/v1/orders/${orderId}/driver-link/email`, { token: tenantToken(who) });
const setDelivery = async (who: TenantFixture, mode: "auto" | "manual"): Promise<void> => {
  const current = (await api.call("GET", "/tenant/v1/notification-settings", { token: tenantToken(who) })).body;
  await ok(api.call("PUT", "/tenant/v1/notification-settings", { token: tenantToken(who), ...(current.version === 0 ? {} : { headers: { "if-match": `"${current.version}"` } }), body: { quiet_hours: current.quiet_hours, driver_link_delivery: mode } }));
};
const updateDriver = async (who: TenantFixture, driver: any, changes: Record<string, unknown>): Promise<any> => {
  const { id: _id, version, license_state: _state, created_at: _created, updated_at: _updated, email_masked: _masked, ...fields } = driver;
  return ok(api.call("PUT", `/tenant/v1/drivers/${driver.id}`, { token: tenantToken(who), headers: { "if-match": `"${version}"` }, body: { ...fields, ...changes } }));
};
const driverRows = async (orderId: string): Promise<any[]> => (await api.db.owner.query("select * from notifications where order_id = $1 and audience = 'driver' order by created_at, id", [orderId])).rows;
const linkRows = async (orderId: string): Promise<any[]> => (await api.db.owner.query("select * from driver_links where order_id = $1 order by created_at, id", [orderId])).rows;

test("自动模式：派车后假 SMTP 收到；邮件链接和调度员的链接同时有效；状态可见；OpenAPI 对得上", async () => {
  const email = newEmail();
  const { order, res } = await dispatched(a, "a", { email });
  assertMatchesOpenApi("POST", "/tenant/v1/orders/{id}/assign", { status: 200, headers: {}, text: "", body: res });
  assert.equal(res.driver_link_email.state, "pending");
  assert.match(res.driver_link_email.recipient_masked, /^fi\*\*\*@example\.test$/);
  assert.equal(JSON.stringify(res.driver_link_email).includes(email), false, "派车应答里只有打码的地址");

  await tick();
  const [mail] = mailsTo(email);
  assert.ok(mail, "司机没收到邮件");
  const text = decodedMailText(mail.data);
  const emailToken = tokenInMail(text);
  assert.ok(emailToken);
  assert.notEqual(emailToken, res.driver_link.token, "邮件专用链接，不是调度员那条");
  assert.equal((await tripOf(emailToken)).status, 200, "邮件链接打得开");
  assert.equal((await tripOf(res.driver_link.token)).status, 200, "调度员复制的链接还能用");

  const status = await api.call("GET", `/tenant/v1/orders/${order.id}/driver-link/email`, { token: tenantToken(a) });
  assertMatchesOpenApi("GET", "/tenant/v1/orders/{id}/driver-link/email", status);
  assert.equal(status.body.driver_link_email.state, "sent");
  assert.equal(status.body.driver_link_email.recipient_masked, "fi***@example.test");
  assert.equal(typeof status.body.driver_link_email.sent_at, "string");

  const detail = await api.call("GET", `/tenant/v1/orders/${order.id}`, { token: tenantToken(a) });
  assertMatchesOpenApi("GET", "/tenant/v1/orders/{id}", detail);
  assert.equal(detail.body.driver_link_email.state, "sent");
  assert.ok(detail.body.records.driver_link.last_used_at, "司机从邮件打开后，详情里也看得到打开过");

  const links = await linkRows(order.id);
  assert.deepEqual(links.map((link) => link.purpose).sort(), ["dispatcher", "email"]);
  assert.ok(links.every((link) => /^[0-9a-f]{64}$/.test(link.token_hash)));
  assert.equal(new Set(links.map((link) => new Date(link.expires_at).getTime())).size, 1, "有效期规则相同");
});

test("邮件内容：行程概要和链接；写明不要转发；没有客人电话、邮箱、详细地址、任何价格", async () => {
  const email = newEmail();
  const { order, driver } = await dispatched(a, "a", { email });
  await tick();
  const [mail] = mailsTo(email);
  assert.ok(mail);
  const text = decodedMailText(mail.data);
  assert.ok(text.includes(order.orderNo));
  assert.ok(text.includes(driver.name));
  assert.match(text, /不要转发/);
  assert.match(text, /客人信息/);
  assert.match(text, /接机/);
  for (const secret of [PASSENGER_PHONE, "9012345678", PASSENGER_EMAIL, "东京站八重洲口", "王小明", "20000", "20,000"]) assert.equal(text.includes(secret), false, secret);
  assert.doesNotMatch(text, /结算|对外价|加价|JPY|已收到/);
  const head = mail.data.slice(0, mail.data.search(/\r?\n\r?\n/));
  assert.equal(tokenInMail(head), null, "邮件头（主题）里没有令牌");
});

test("令牌原文不进发件箱、发送记录、审计、日志；库里只有哈希", async () => {
  const email = newEmail();
  const { order, res } = await dispatched(a, "a", { email });
  await tick();
  const emailToken = tokenInMail(decodedMailText((mailsTo(email)[0] as FakeSmtpMessage).data)) as string;
  const dump = JSON.stringify([
    (await api.db.owner.query("select * from notification_events where order_id = $1", [order.id])).rows,
    await driverRows(order.id),
    await linkRows(order.id),
    (await api.db.owner.query("select * from driver_link_emails where order_id = $1", [order.id])).rows,
    (await api.db.owner.query("select * from audit_logs where tenant_id = $1", [a.tenantId])).rows,
  ]);
  for (const token of [emailToken, res.driver_link.token]) {
    assert.equal(dump.includes(token), false);
    assert.equal(dump.includes(token.split(".")[1] as string), false, "令牌的随机部分也没有");
    assert.equal(api.logs().includes(token.split(".")[1] as string), false, "日志里没有令牌");
  }
  assert.equal(api.logs().includes(email), false, "日志里没有司机邮箱");
  const events = JSON.stringify((await api.db.owner.query("select data from notification_events where order_id = $1", [order.id])).rows);
  assert.equal(events.includes(email), false, "发件箱里没有邮箱");
});

test("手动模式：不发、不生成邮件链接；状态提示手动；重发被拒；排队中的信切到手动后也不发", async () => {
  await setDelivery(a, "manual");
  const email = newEmail();
  const { order, res } = await dispatched(a, "a", { email });
  assert.equal(res.driver_link_email.state, "manual");
  assert.equal(res.driver_link_email.can_resend, false);
  await tick();
  assert.equal(mailsTo(email).length, 0);
  assert.deepEqual((await linkRows(order.id)).map((link) => link.purpose), ["dispatcher"]);
  assert.equal((await driverRows(order.id)).length, 0);
  const denied = await resend(order.id);
  assert.deepEqual([denied.status, denied.body.error.code], [409, "DRIVER_LINK_EMAIL_MANUAL"]);

  await setDelivery(a, "auto");
  const queuedEmail = newEmail();
  const queued = await dispatched(a, "a", { email: queuedEmail });
  await setDelivery(a, "manual");
  await tick();
  assert.equal(mailsTo(queuedEmail).length, 0, "切到手动之后排着的信不发");
  assert.equal((await driverRows(queued.order.id))[0].last_error_code, "DRIVER_LINK_MANUAL");
  await setDelivery(a, "auto");
});

test("司机没邮箱：不发，提示手动；重发被拒；复制的链接照常可用", async () => {
  const { order, res } = await dispatched(a, "a", {});
  assert.equal(res.driver_link_email.state, "no_email");
  await tick();
  assert.equal(smtp.messages.length, 0);
  const denied = await resend(order.id);
  assert.deepEqual([denied.status, denied.body.error.code], [409, "DRIVER_EMAIL_MISSING"]);
  assert.equal((await tripOf(res.driver_link.token)).status, 200);
});

test("发信失败：不影响派车；退避重试；收件人被拒是最终失败，页面有中文原因；链接照常可用", async () => {
  smtp.behave({ rejectRecipient: true });
  const email = newEmail();
  const { order, res } = await dispatched(a, "a", { email });
  assert.equal(res.order.status, "assigned");
  await tick();
  const status = await statusOf(order.id);
  assert.equal(status.state, "failed");
  assert.equal(status.error_code, "RECIPIENT_REJECTED");
  assert.match(status.error_message, /拒收/);
  assert.equal(status.can_resend, true);
  assert.equal((await tripOf(res.driver_link.token)).status, 200);
  smtp.reset();
  api.clock.advance(61_000);
  assert.equal((await resend(order.id)).status, 202, "可以重发");
  await tick();
  assert.equal(mailsTo(email).length, 1);
  assert.equal((await statusOf(order.id)).state, "sent");
});

test("发信暂时失败：等待中并带原因，到点自动重试成功", async () => {
  smtp.behave({ rejectAt: { stage: "MAIL", reply: "450 4.2.1 later" } });
  const email = newEmail();
  const { order } = await dispatched(a, "a", { email });
  await tick();
  const waiting = await statusOf(order.id);
  assert.equal(waiting.state, "pending");
  assert.equal(waiting.error_code, "TEMPORARILY_REJECTED");
  smtp.reset();
  api.clock.advance(61_000);
  await tick();
  assert.equal(mailsTo(email).length, 1);
  assert.equal((await statusOf(order.id)).state, "sent");
});

test("邮件没配置：派车成功，状态带 NOT_CONFIGURED 提示手动；配好后自动发", async () => {
  const unconfigured = await siteApi(api, null, null, NO_SMTP, { integrationSecretsTtlMs: 0 });
  try {
    const email = newEmail();
    const order = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 96 * HOUR) });
    const driver = await newDriver(api, a, { email });
    const vehicle = await newVehicle(api, a, m.ids.biz7);
    const res = await unconfigured.call("POST", `/tenant/v1/orders/${order.id}/assign`, { token: tenantToken(a), headers: { "if-match": `"1"` }, body: { driver_id: driver.id, vehicle_id: vehicle.id } });
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.order.status, "assigned");
    assert.equal(res.body.driver_link_email.state, "pending");
    assert.equal(res.body.driver_link_email.error_code, "NOT_CONFIGURED");
    assert.match(res.body.driver_link_email.error_message, /手动/);
    const done = await unconfigured.app.notificationJobs.tick();
    assert.equal(done.notConfigured, true);
    assert.equal(mailsTo(email).length, 0);
    const later = await unconfigured.call("GET", `/tenant/v1/orders/${order.id}/driver-link/email`, { token: tenantToken(a) });
    assert.equal(later.body.driver_link_email.error_code, "NOT_CONFIGURED");
    assert.equal((await statusOf(order.id)).error_code, null, "配好之后不再提示没配置（记录上的旧原因要等发出去才清）");
    await tick();
    assert.equal(mailsTo(email).length, 1, "配好后发出");
  } finally {
    await unconfigured.close();
  }
});

test("改派：旧邮件链接和调度员链接都失效；排队的旧信不发给旧司机；新司机收到新链接", async () => {
  const oldEmail = newEmail();
  const { order, res, vehicle } = await dispatched(a, "a", { email: oldEmail });
  await tick();
  const oldToken = tokenInMail(decodedMailText((mailsTo(oldEmail)[0] as FakeSmtpMessage).data)) as string;
  assert.equal((await tripOf(oldToken)).status, 200);

  const newEmailAddress = newEmail();
  const second = await newDriver(api, a, { email: newEmailAddress });
  const reassigned = await ok(assign(api, a, order.id, second.id, vehicle.id, { version: res.order.version }));
  assert.equal(reassigned.change, true);
  assert.equal(reassigned.driver_link_email.recipient_masked, "fi***@example.test");
  assert.equal((await tripOf(oldToken)).status, 401, "旧邮件链接失效");
  assert.equal((await tripOf(res.driver_link.token)).status, 401, "旧调度员链接失效");
  await tick();
  assert.equal(mailsTo(oldEmail).length, 1, "旧司机没有再收到");
  const [mail] = mailsTo(newEmailAddress);
  assert.ok(mail);
  assert.equal((await tripOf(tokenInMail(decodedMailText(mail.data)) as string)).status, 200);
});

test("排队中改派：旧信不发（换成新司机的地址也不发），只有新司机收到一封", async () => {
  const oldEmail = newEmail();
  const { order, res, vehicle } = await dispatched(a, "a", { email: oldEmail });
  const newAddress = newEmail();
  const second = await newDriver(api, a, { email: newAddress });
  await ok(assign(api, a, order.id, second.id, vehicle.id, { version: res.order.version }));
  await tick();
  assert.equal(mailsTo(oldEmail).length, 0, "旧司机收不到");
  assert.equal(mailsTo(newAddress).length, 1);
  const rows = await driverRows(order.id);
  assert.deepEqual(rows.map((row) => row.status).sort(), ["expired", "sent"]);
  assert.equal(rows.find((row) => row.status === "expired").last_error_code, "ORDER_STATE_CHANGED");
});

test("A → B → A 改回去：旧的排队信不发，只有最新那次的一封", async () => {
  const emailA = newEmail();
  const first = await dispatched(a, "a", { email: emailA });
  const second = await newDriver(api, a, { email: newEmail() });
  const toB = await ok(assign(api, a, first.order.id, second.id, first.vehicle.id, { version: first.res.order.version }));
  const back = await ok(assign(api, a, first.order.id, first.driver.id, first.vehicle.id, { version: toB.order.version }));
  await tick();
  assert.equal(mailsTo(emailA).length, 1, "只有一封");
  const token = tokenInMail(decodedMailText((mailsTo(emailA)[0] as FakeSmtpMessage).data)) as string;
  assert.equal((await tripOf(token)).status, 200);
  assert.equal((await tripOf(back.driver_link.token)).status, 200);
});

test("吊销：两条一起失效；排队的信不发；吊销后不能靠重发拿到新链接", async () => {
  const email = newEmail();
  const { order, res } = await dispatched(a, "a", { email });
  await tick();
  const emailToken = tokenInMail(decodedMailText((mailsTo(email)[0] as FakeSmtpMessage).data)) as string;
  api.clock.advance(61_000);
  assert.equal((await resend(order.id)).status, 202);
  assert.equal((await api.call("DELETE", `/tenant/v1/orders/${order.id}/driver-link`, { token: tenantToken(a) })).status, 204);
  assert.equal((await tripOf(emailToken)).status, 401);
  assert.equal((await tripOf(res.driver_link.token)).status, 401);
  await tick();
  assert.equal(mailsTo(email).length, 1, "排队的信没有发");
  assert.equal((await driverRows(order.id)).at(-1).last_error_code, "DRIVER_LINK_REVOKED");
  assert.ok((await linkRows(order.id)).every((link) => link.revoked_at !== null));
  const denied = await resend(order.id);
  assert.deepEqual([denied.status, denied.body.error.code], [409, "DRIVER_LINK_NOT_ACTIVE"]);
  assert.equal((await statusOf(order.id)).state, "no_link");
});

test("重新生成：邮件链接一起作废；不自动发信；状态提示可以重发；重发后新邮件链接可用", async () => {
  const email = newEmail();
  const { order } = await dispatched(a, "a", { email });
  await tick();
  const emailToken = tokenInMail(decodedMailText((mailsTo(email)[0] as FakeSmtpMessage).data)) as string;
  const reissued = await api.call("POST", `/tenant/v1/orders/${order.id}/driver-link`, { token: tenantToken(a) });
  assertMatchesOpenApi("POST", "/tenant/v1/orders/{id}/driver-link", reissued);
  assert.equal(reissued.status, 200, reissued.text);
  assert.equal(reissued.body.driver_link_email.state, "not_sent");
  assert.equal((await tripOf(emailToken)).status, 401);
  await tick();
  assert.equal(mailsTo(email).length, 1, "重新生成不自动发");
  api.clock.advance(61_000);
  assert.equal((await resend(order.id)).status, 202);
  await tick();
  assert.equal(mailsTo(email).length, 2);
  const fresh = tokenInMail(decodedMailText((mailsTo(email)[1] as FakeSmtpMessage).data)) as string;
  assert.equal((await tripOf(fresh)).status, 200);
  assert.equal((await tripOf(reissued.body.driver_link.token)).status, 200, "重发不让现有链接失效");
});

test("司机改邮箱：排队的信发到新地址；发到旧地址的链接作废，调度员那条不动；提示重发；旧地址不再收到", async () => {
  const oldEmail = newEmail();
  const first = await dispatched(a, "a", { email: oldEmail });
  const nextEmail = newEmail();
  const updated = await updateDriver(a, first.driver, { email: nextEmail });
  assert.equal(updated.email, nextEmail);
  await tick();
  assert.equal(mailsTo(oldEmail).length, 0, "排队期间改了地址，旧地址收不到");
  assert.equal(mailsTo(nextEmail).length, 1, "发到新地址");
  assert.equal((await driverRows(first.order.id))[0].recipient, nextEmail, "记录跟着改");

  const sentToken = tokenInMail(decodedMailText((mailsTo(nextEmail)[0] as FakeSmtpMessage).data)) as string;
  assert.equal((await tripOf(sentToken)).status, 200);
  const third = newEmail();
  await updateDriver(a, updated, { email: third });
  assert.equal((await tripOf(sentToken)).status, 401, "发到旧地址的链接立即作废");
  assert.equal((await tripOf(first.res.driver_link.token)).status, 200, "调度员的链接不动");
  const status = await statusOf(first.order.id);
  assert.equal(status.state, "not_sent");
  assert.equal(status.address_changed, true);
  assert.equal(status.can_resend, true);
  api.clock.advance(61_000);
  assert.equal((await resend(first.order.id)).status, 202);
  await tick();
  assert.equal(mailsTo(third).length, 1);
  assert.equal(mailsTo(nextEmail).length, 1, "旧地址不再收到");
  const audit = await api.db.owner.query("select before, after from audit_logs where resource = 'driver' and resource_id = $1 and action = 'update' order by occurred_at desc limit 1", [first.driver.id]);
  const row = JSON.stringify(audit.rows[0]);
  assert.equal(row.includes(third), false, "审计里没有完整邮箱");
  assert.equal(audit.rows[0].after.email_changed, true);
});

test("司机改邮箱：只改打码后相同的地址也算改了；不带 email 的老调用方不会清掉邮箱", async () => {
  const domainPart = `${randomUUID().slice(0, 8)}.example.test`;
  const first = await dispatched(a, "a", { email: `abc@${domainPart}` });
  await tick();
  const token = tokenInMail(decodedMailText((mailsTo(`abc@${domainPart}`)[0] as FakeSmtpMessage).data)) as string;
  const changed = await updateDriver(a, first.driver, { email: `abd@${domainPart}` });
  assert.equal(changed.email, `abd@${domainPart}`);
  assert.equal(changed.version, first.driver.version + 1);
  assert.equal((await tripOf(token)).status, 401);
  const kept = await ok(api.call("PUT", `/tenant/v1/drivers/${changed.id}`, { token: tenantToken(a), headers: { "if-match": `"${changed.version}"` }, body: { name: changed.name, phone: changed.phone, languages: changed.languages, license_expires_on: changed.license_expires_on, driving_years: changed.driving_years, gold: changed.gold, status: changed.status } }));
  assert.equal(kept.email, `abd@${domainPart}`);
  const cleared = await updateDriver(a, kept, { email: null });
  assert.equal(cleared.email, null);
  assert.equal(cleared.email_masked, null);
  assert.equal((await statusOf(first.order.id)).state, "no_email");
});

test("司机删了邮箱：排队的信不发；停用了：也不发", async () => {
  const email = newEmail();
  const first = await dispatched(a, "a", { email });
  await updateDriver(a, first.driver, { email: null });
  await tick();
  assert.equal(mailsTo(email).length, 0);
  assert.equal((await driverRows(first.order.id)).length, 0, "没有地址，不产生发送记录");
  const other = newEmail();
  const second = await dispatched(a, "a", { email: other });
  await tick();
  smtp.reset();
  api.clock.advance(61_000);
  assert.equal((await resend(second.order.id)).status, 202);
  assert.equal((await api.call("DELETE", `/tenant/v1/drivers/${second.driver.id}`, { token: tenantToken(a) })).status, 200);
  await tick();
  assert.equal(mailsTo(other).length, 0);
  assert.equal((await driverRows(second.order.id)).at(-1).last_error_code, "DRIVER_DISABLED");
});

test("邮箱校验：拒绝控制字符（防头注入）、格式不对；数据库也挡；全部选填", async () => {
  for (const email of ["a@b.test\r\nBcc: other@example.test", "x\ny@example.test", "not-an-email", "a@b@example.test", "", "x y@example.test"]) {
    const res = await api.call("POST", "/tenant/v1/drivers", { token: tenantToken(a), headers: { "idempotency-key": randomUUID() }, body: { name: "虚构司机", phone: "+819000000001", languages: ["ja"], license_expires_on: "2030-01-01", email } });
    assert.equal(res.status, 400, JSON.stringify(email));
  }
  const driver = await newDriver(api, a, { email: "  Fictional.Case@Example.Test " });
  assert.equal(driver.email, "fictional.case@example.test", "和账号邮箱同样规整");
  await assert.rejects(api.db.owner.query("update drivers set email = $1 where id = $2", ["x\r\n@example.test", driver.id]));
  assert.equal((await newDriver(api, a)).email, null);
});

test("谁能看全司机邮箱：管理员、调度能；只读只有打码；派单列表、订单详情一律打码", async () => {
  const email = newEmail();
  const { order, driver } = await dispatched(a, "a", { email });
  const readonlyToken = await staffToken("readonly");
  const seen = await ok(api.call("GET", `/tenant/v1/drivers/${driver.id}`, { token: readonlyToken }));
  assert.equal(seen.email, null);
  assert.equal(seen.email_masked, "fi***@example.test");
  assertMatchesOpenApi("GET", "/tenant/v1/drivers/{id}", { status: 200, headers: {}, text: "", body: seen });
  const list = await api.call("GET", "/tenant/v1/drivers", { token: readonlyToken });
  assert.equal(list.text.includes(email), false);
  const admin = await ok(api.call("GET", `/tenant/v1/drivers/${driver.id}`, { token: tenantToken(a) }));
  assert.equal(admin.email, email);
  for (const url of [`/tenant/v1/orders/${order.id}/assignable`, `/tenant/v1/orders/${order.id}`, `/tenant/v1/orders/${order.id}/driver-link/email`]) {
    const res = await api.call("GET", url, { token: tenantToken(a) });
    assert.equal(res.status, 200, url);
    assert.equal(res.text.includes(email), false, url);
  }
  assert.equal((await api.call("GET", "/driver/v1/trip", { token: (await api.call("POST", `/tenant/v1/orders/${order.id}/driver-link`, { token: tenantToken(a) })).body.driver_link.token })).text.includes(email), false, "司机页面也没有");
});

test("重发的权限：调度可以；只读不行；只读能看状态；审计有记录、没有完整地址和令牌", async () => {
  const email = newEmail();
  const { order } = await dispatched(a, "a", { email });
  await tick();
  api.clock.advance(61_000);
  const readonlyToken = await staffToken("readonly");
  assert.equal((await api.call("POST", `/tenant/v1/orders/${order.id}/driver-link/email`, { token: readonlyToken })).status, 403);
  assert.equal((await api.call("GET", `/tenant/v1/orders/${order.id}/driver-link/email`, { token: readonlyToken })).status, 200);
  const res = await api.call("POST", `/tenant/v1/orders/${order.id}/driver-link/email`, { token: await staffToken("dispatch") });
  assert.equal(res.status, 202, res.text);
  assertMatchesOpenApi("POST", "/tenant/v1/orders/{id}/driver-link/email", res);
  assert.equal(res.body.driver_link_email.state, "pending");
  const audit = (await api.db.owner.query("select actor_id, after from audit_logs where resource = 'driver_link' and action = 'retry' and tenant_id = $1 order by occurred_at desc limit 1", [a.tenantId])).rows[0];
  assert.equal(audit.after.order_id, order.id);
  assert.equal(audit.after.recipient, "fi***@example.test");
  assert.equal(JSON.stringify(audit).includes(email), false);
  assert.equal((await api.call("POST", `/tenant/v1/orders/${order.id}/driver-link/email`, { token: "bad" })).status, 401);
});

test("重发只发最新的：还在等重试的旧信作废，不会几封一起到", async () => {
  smtp.behave({ rejectAt: { stage: "MAIL", reply: "450 4.2.1 later" } });
  const email = newEmail();
  const { order } = await dispatched(a, "a", { email });
  await tick();
  smtp.reset();
  api.clock.advance(61_000);
  assert.equal((await resend(order.id)).status, 202);
  await tick();
  assert.equal(mailsTo(email).length, 1);
  const rows = await driverRows(order.id);
  assert.deepEqual(rows.map((row) => [row.status, row.last_error_code]), [["expired", "DRIVER_LINK_SUPERSEDED"], ["sent", null]]);
});

test("连点保护：同一张单 60 秒内一次；并发点十下只有一下成功", async () => {
  const email = newEmail();
  const { order } = await dispatched(a, "a", { email });
  await tick();
  const tooSoon = await resend(order.id);
  assert.deepEqual([tooSoon.status, tooSoon.body.error.code], [429, "RATE_LIMITED"], "自动发的那次也算");
  assert.ok(tooSoon.body.error.details.retry_after_seconds > 0);
  assertMatchesOpenApi("POST", "/tenant/v1/orders/{id}/driver-link/email", tooSoon);
  api.clock.advance(61_000);
  const results = await Promise.all(Array.from({ length: 10 }, () => resend(order.id)));
  assert.equal(results.filter((res) => res.status === 202).length, 1, results.map((res) => res.status).join(","));
  assert.equal(results.filter((res) => res.status === 429).length, 9);
  await tick();
  assert.equal(mailsTo(email).length, 2);
});

test("限速：一小时最多 5 次；一家的总量也有上限", async () => {
  const { order } = await dispatched(a, "a", { email: newEmail() });
  for (let index = 1; index < DRIVER_LINK_EMAIL_LIMITS.orderPerHour; index += 1) {
    api.clock.advance(61_000);
    assert.equal((await resend(order.id)).status, 202, `第 ${index} 次`);
  }
  api.clock.advance(61_000);
  const limited = await resend(order.id);
  assert.equal(limited.status, 429);
  assert.ok(limited.body.error.details.retry_after_seconds > 61);

  const another = await dispatched(a, "a", { email: newEmail() });
  api.clock.advance(61_000);
  const rows = Array.from({ length: DRIVER_LINK_EMAIL_LIMITS.tenantPerHour }, () => randomUUID());
  const now = api.clock.now();
  const source = (await api.db.owner.query("select assignment_id, driver_id, link_id from driver_link_emails where order_id = $1 limit 1", [another.order.id])).rows[0];
  for (const id of rows) {
    await api.db.owner.query("insert into notification_events (id, tenant_id, event, order_id, dedupe_key, data, occurred_at, expanded_at) values ($1, $2, 'order.driver_link', $3, $4, '{}', $5, $5)", [id, a.tenantId, order.id, `test:${id}`, now]);
    await api.db.owner.query("insert into driver_link_emails (tenant_id, id, order_id, assignment_id, driver_id, link_id, trigger, requested_at) values ($1, $2, $3, $4, $5, $6, 'auto', $7)", [a.tenantId, id, order.id, source.assignment_id, source.driver_id, source.link_id, now]);
  }
  const tenantLimited = await resend(another.order.id);
  assert.equal(tenantLimited.status, 429, tenantLimited.text);
});

test("并发：重发和改派同时到，旧司机绝不会收到能用的链接；新司机能收到", async () => {
  for (let round = 0; round < 4; round += 1) {
    const oldEmail = newEmail();
    const { order, res, vehicle } = await dispatched(a, "a", { email: oldEmail });
    await tick();
    smtp.reset();
    api.clock.advance(61_000);
    const nextEmail = newEmail();
    const second = await newDriver(api, a, { email: nextEmail });
    const [resent, reassigned] = await Promise.all([resend(order.id), assign(api, a, order.id, second.id, vehicle.id, { version: res.order.version })]);
    assert.equal(reassigned.status, 200, reassigned.text);
    assert.ok([202, 409, 429].includes(resent.status), resent.text);
    await tick();
    for (const mail of mailsTo(oldEmail)) assert.fail(`第 ${round} 轮：旧司机不该再收到，收到了 ${mail.to.length} 封`);
    const [mail] = mailsTo(nextEmail);
    assert.ok(mail, "新司机收到");
    assert.equal((await tripOf(tokenInMail(decodedMailText(mail.data)) as string)).status, 200);
    const active = (await linkRows(order.id)).filter((link) => link.revoked_at === null);
    assert.ok(active.every((link) => link.driver_id === second.id), "有效的链接都属于新司机");
  }
});

test("并发：发送中的准备和吊销同时到，吊销之后不留下有效的邮件链接", async () => {
  for (let round = 0; round < 4; round += 1) {
    const email = newEmail();
    const { order } = await dispatched(a, "a", { email });
    const [, revoked] = await Promise.all([tick(), api.call("DELETE", `/tenant/v1/orders/${order.id}/driver-link`, { token: tenantToken(a) })]);
    assert.equal(revoked.status, 204, revoked.text);
    assert.ok((await linkRows(order.id)).every((link) => link.revoked_at !== null), `第 ${round} 轮`);
    await tick();
    assert.ok((await linkRows(order.id)).every((link) => link.revoked_at !== null));
  }
});

test("并发：改邮箱和派车同时到不死锁，和发信任务同时到也不死锁", async () => {
  for (let round = 0; round < 3; round += 1) {
    const { order, driver, res, vehicle } = await dispatched(a, "a", { email: newEmail() });
    const other = await newDriver(api, a, { email: newEmail() });
    const [updated, moved] = await Promise.all([updateDriver(a, driver, { email: newEmail() }), assign(api, a, order.id, other.id, vehicle.id, { version: res.order.version }), tick()]);
    assert.equal(typeof updated.email, "string");
    assert.equal(moved.status, 200, moved.text);
  }
});

test("订单取消：排队的信不发，重发被拒", async () => {
  const email = newEmail();
  const { order } = await dispatched(a, "a", { email });
  await api.db.owner.query("update orders set status = 'cancelled', cancelled_at = now(), cancel_reason = 'GUEST_REQUEST' where id = $1", [order.id]);
  await tick();
  assert.equal(mailsTo(email).length, 0);
  assert.equal((await driverRows(order.id))[0].last_error_code, "ORDER_STATE_CHANGED");
  api.clock.advance(61_000);
  const denied = await resend(order.id);
  assert.deepEqual([denied.status, denied.body.error.code], [409, "ORDER_STATE_INVALID"]);
});

test("救援：声明无法履约后两条链接都失效；排队的信不发；原供应商不能重发", async () => {
  const email = newEmail();
  // 走完整的下单付款：救援要读销售端的数据。乙报价低，这单归乙
  const order = await flow.paidOrder({ serviceTime: new Date(api.clock.now().getTime() + 96 * HOUR).toISOString().replace(/\.\d{3}Z$/, "Z") });
  const driver = await newDriver(api, b, { email });
  const res = await ok(assign(api, b, order.id, driver.id, (await newVehicle(api, b, m.ids.biz7)).id));
  await tick();
  const emailToken = tokenInMail(decodedMailText((mailsTo(email)[0] as FakeSmtpMessage).data)) as string;
  assert.equal((await tripOf(emailToken)).status, 200);
  api.clock.advance(61_000);
  assert.equal((await resend(order.id, b)).status, 202);
  const declared = await api.call("POST", `/tenant/v1/orders/${order.id}/declare-unable`, { token: tenantToken(b), body: { reason: "车辆故障，排不出车" } });
  assert.equal(declared.status, 200, declared.text);
  assert.equal((await tripOf(emailToken)).status, 401);
  assert.equal((await tripOf(res.driver_link.token)).status, 401);
  await tick();
  assert.equal(mailsTo(email).filter((mail) => tokenInMail(decodedMailText(mail.data)) !== null).length, 1, "救援后排队的信不发");
  assert.match(decodedMailText((mailsTo(email).at(-1) as FakeSmtpMessage).data), /任务已取消或已转给别的供应商/, "司机另外收到一封不带链接的通知（M4-29）");
  const denied = await resend(order.id, b);
  assert.deepEqual([denied.status, denied.body.error.code], [409, "ORDER_STATE_INVALID"]);
});

test("过了有效期（用车结束后 24 小时）：重发被拒；邮件链接和调度员链接同样过期", async () => {
  const email = newEmail();
  const { order, res } = await dispatched(a, "a", { email });
  await tick();
  const emailToken = tokenInMail(decodedMailText((mailsTo(email)[0] as FakeSmtpMessage).data)) as string;
  const links = await linkRows(order.id);
  api.clock.advance(new Date(links[0].expires_at).getTime() - api.clock.now().getTime() + 1000);
  assert.equal((await tripOf(emailToken)).status, 401);
  assert.equal((await tripOf(res.driver_link.token)).status, 401);
  a.adminToken = await tenantLogin(api, m.a.adminEmail);
  assert.equal((await statusOf(order.id)).state, "no_link");
  const denied = await resend(order.id);
  assert.deepEqual([denied.status, denied.body.error.code], [409, "DRIVER_LINK_EXPIRED"]);
});

test("免打扰不适用：司机不是供应商员工，免打扰时段里也马上发", async () => {
  const tokyoHour = (api.clock.now().getUTCHours() + 9) % 24;
  const pad = (hour: number): string => `${String(hour).padStart(2, "0")}:00`;
  const current = (await api.call("GET", "/tenant/v1/notification-settings", { token: tenantToken(a) })).body;
  await ok(api.call("PUT", "/tenant/v1/notification-settings", { token: tenantToken(a), ...(current.version === 0 ? {} : { headers: { "if-match": `"${current.version}"` } }), body: { quiet_hours: { start: pad(tokyoHour), end: pad((tokyoHour + 2) % 24) } } }));
  const email = newEmail();
  await dispatched(a, "a", { email });
  await tick();
  assert.equal(mailsTo(email).length, 1);
});

test("设置：默认自动；只有管理员能改；有审计；令牌决定租户；OpenAPI 对得上；不带这一项不改", async () => {
  await api.db.owner.query("delete from tenant_notification_settings where tenant_id = $1", [a.tenantId]);
  const initial = await api.call("GET", "/tenant/v1/notification-settings", { token: tenantToken(a) });
  assertMatchesOpenApi("GET", "/tenant/v1/notification-settings", initial);
  assert.equal(initial.body.driver_link_delivery, "auto");
  const dispatchToken = await staffToken("dispatch");
  assert.equal((await api.call("GET", "/tenant/v1/notification-settings", { token: dispatchToken })).status, 200);
  assert.equal((await api.call("PUT", "/tenant/v1/notification-settings", { token: dispatchToken, body: { quiet_hours: null, driver_link_delivery: "manual" } })).status, 403);
  assert.equal((await api.call("PUT", "/tenant/v1/notification-settings", { token: tenantToken(a), body: { quiet_hours: null, driver_link_delivery: "never" } })).status, 400);
  const saved = await api.call("PUT", "/tenant/v1/notification-settings", { token: tenantToken(a), body: { quiet_hours: null, driver_link_delivery: "manual" } });
  assertMatchesOpenApi("PUT", "/tenant/v1/notification-settings", saved);
  assert.equal(saved.body.driver_link_delivery, "manual");
  const audit = (await api.db.owner.query("select before, after from audit_logs where resource = 'notification_settings' and resource_id = $1 order by occurred_at desc limit 1", [a.tenantId])).rows[0];
  assert.deepEqual([audit.before.driver_link_delivery, audit.after.driver_link_delivery], ["auto", "manual"]);
  const kept = await api.call("PUT", "/tenant/v1/notification-settings", { token: tenantToken(a), headers: { "if-match": `"${saved.body.version}"` }, body: { quiet_hours: null } });
  assert.equal(kept.body.driver_link_delivery, "manual", "不带就不改");
  assert.equal((await api.call("GET", "/tenant/v1/notification-settings", { token: tenantToken(b) })).body.driver_link_delivery === "manual", false, "乙不受影响");
  await setDelivery(a, "auto");
});

test("跨租户：A 读不到、改不了 B 的发送状态、重发、司机邮箱、设置；数据库策略也挡", async () => {
  const email = newEmail();
  const { order, driver } = await dispatched(b, "b", { email });
  await tick();
  assert.equal(mailsTo(email).length, 1);
  api.clock.advance(61_000);
  assert.equal((await statusOfRaw(order.id, a)).status, 404);
  assert.equal((await resend(order.id, a)).status, 404);
  assert.equal((await api.call("GET", `/tenant/v1/drivers/${driver.id}`, { token: tenantToken(a) })).status, 404);
  const put = await api.call("PUT", `/tenant/v1/drivers/${driver.id}`, { token: tenantToken(a), headers: { "if-match": `"${driver.version}"` }, body: { name: driver.name, phone: driver.phone, languages: driver.languages, license_expires_on: driver.license_expires_on, driving_years: driver.driving_years, gold: driver.gold, status: driver.status, email: newEmail() } });
  assert.equal(put.status, 404);
  assert.equal(mailsTo(email).length, 1, "A 的重发没有发出去");

  const smuggled = await api.call("PUT", "/tenant/v1/notification-settings", { token: tenantToken(a), body: { quiet_hours: null, driver_link_delivery: "manual", tenant_id: b.tenantId } });
  assert.equal(smuggled.status, 400, "不收 tenant_id");
  await setDelivery(a, "manual");
  assert.equal((await api.call("GET", "/tenant/v1/notification-settings", { token: tenantToken(b) })).body.driver_link_delivery, "auto", "A 改的不影响 B");
  await setDelivery(a, "auto");

  const seen = await withTenantTx(api.db.pool, a.tenantId, async (db) => ({
    requests: (await db.query("select id from driver_link_emails where tenant_id = $1", [b.tenantId])).rowCount,
    requestsAll: (await db.query<{ tenant_id: string }>("select tenant_id from driver_link_emails")).rows.filter((row) => row.tenant_id === b.tenantId).length,
    rows: (await db.query("select id from notifications where order_id = $1", [order.id])).rowCount,
    drivers: (await db.query("select email from drivers where id = $1", [driver.id])).rowCount,
    settingsChanged: (await db.query("update tenant_notification_settings set driver_link_delivery = 'manual' where tenant_id = $1", [b.tenantId])).rowCount,
    driversChanged: (await db.query("update drivers set email = 'x@example.test' where id = $1", [driver.id])).rowCount,
  }));
  assert.deepEqual(seen, { requests: 0, requestsAll: 0, rows: 0, drivers: 0, settingsChanged: 0, driversChanged: 0 });
  await assert.rejects(withTenantTx(api.db.pool, a.tenantId, (db) => db.query("insert into driver_link_emails (tenant_id, id, order_id, assignment_id, driver_id, link_id, trigger, requested_at) select tenant_id, gen_random_uuid(), order_id, assignment_id, driver_id, id, 'auto', now() from (values ($1::uuid, $2::uuid, $2::uuid, $2::uuid, $2::uuid)) as v(tenant_id, order_id, assignment_id, driver_id, id)", [b.tenantId, order.id])));
});

test("数据库策略：供应商读得到发给司机的记录，仍然读不到发给客人和员工的；请求表只能追加", async () => {
  const { order } = await dispatched(a, "a", { email: newEmail() });
  await tick();
  await api.db.owner.query("insert into notification_events (id, tenant_id, event, order_id, dedupe_key, data, occurred_at, expanded_at) values ($1, $2, 'order.confirmed', $3, $4, '{}', now(), now())", [order.id, a.tenantId, order.id, `guest-test:${order.id}`]);
  await api.db.owner.query("insert into notifications (event_id, tenant_id, event, audience, locale, channel, recipient, order_id, status, next_attempt_at, expires_at, created_at, updated_at) values ($1, $2, 'order.confirmed', 'guest', 'zh-CN', 'email', 'guest.visible@example.test', $3, 'expired', now(), now(), now(), now())", [order.id, a.tenantId, order.id]);
  const audiences = await withTenantTx(api.db.pool, a.tenantId, async (db) => (await db.query<{ audience: string }>("select distinct audience from notifications where order_id = $1", [order.id])).rows.map((row) => row.audience));
  assert.deepEqual(audiences, ["driver"]);
  const list = await api.call("GET", `/tenant/v1/notifications?order_id=${order.id}`, { token: tenantToken(a) });
  assert.ok(list.body.items.every((item: any) => item.audience === "tenant"), "记录页仍然只列发给自己这家的");
  await assert.rejects(withTenantTx(api.db.pool, a.tenantId, (db) => db.query("update driver_link_emails set trigger = 'resend' where order_id = $1", [order.id])));
  await assert.rejects(withTenantTx(api.db.pool, a.tenantId, (db) => db.query("delete from driver_link_emails where order_id = $1", [order.id])));
  await assert.rejects(withTenantTx(api.db.pool, a.tenantId, (db) => db.query("select * from notification_events where order_id = $1", [order.id])), "发件箱仍然读不了");
});

test("运营后台：能看到发给司机的记录，地址打码；通知记录没有令牌；平台重试的复查照做", async () => {
  smtp.behave({ rejectRecipient: true });
  const email = newEmail();
  const { order } = await dispatched(a, "a", { email });
  await tick();
  smtp.reset();
  const ops = await platformLogin(api, m.staff.operations.email);
  const list = await api.call("GET", `/platform/v1/notifications?order_id=${order.id}&audience=driver`, { token: ops });
  assert.equal(list.status, 200, list.text);
  assertMatchesOpenApi("GET", "/platform/v1/notifications", list);
  assert.equal(list.body.items.length, 1);
  assert.equal(list.body.items[0].recipient, "fi***@example.test");
  assert.equal(list.text.includes(email), false);
  const retried = await api.call("POST", `/platform/v1/notifications/${list.body.items[0].id}/retry`, { token: ops });
  assert.equal(retried.status, 200, retried.text);
  assert.equal(retried.body.notification.status, "sent");
  assert.equal(mailsTo(email).length, 1);

  const another = newEmail();
  const second = await dispatched(a, "a", { email: another });
  smtp.behave({ rejectRecipient: true });
  await tick();
  smtp.reset();
  await api.call("DELETE", `/tenant/v1/orders/${second.order.id}/driver-link`, { token: tenantToken(a) });
  const row = (await driverRows(second.order.id))[0];
  const staleRetry = await api.call("POST", `/platform/v1/notifications/${row.id}/retry`, { token: ops });
  assert.equal(staleRetry.body.notification.last_error.code, "DRIVER_LINK_REVOKED");
  assert.equal(mailsTo(another).length, 0, "吊销后运营重试也发不出去");
});

test("旧数据：迁移前的链接都是调度员的那种，司机没有邮箱，供应商默认自动", async () => {
  const defaults = await api.db.owner.query<{ table_name: string; column_name: string; column_default: string | null; is_nullable: string }>(
    "select table_name, column_name, column_default, is_nullable from information_schema.columns where table_schema = current_schema() and ((table_name = 'driver_links' and column_name = 'purpose') or (table_name = 'tenant_notification_settings' and column_name = 'driver_link_delivery') or (table_name = 'drivers' and column_name = 'email')) order by table_name",
  );
  assert.deepEqual(defaults.rows.map((row) => [row.table_name, row.column_default, row.is_nullable]), [["driver_links", "'dispatcher'::text", "NO"], ["drivers", null, "YES"], ["tenant_notification_settings", "'auto'::text", "NO"]]);
});

const statusOfRaw = (orderId: string, who: TenantFixture) => api.call("GET", `/tenant/v1/orders/${orderId}/driver-link/email`, { token: tenantToken(who) });
