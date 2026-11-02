/**
 * M4-27：测试发现的设计风险的修补（ADR 0058「发信失败」「停用的司机」「事件展开失败」「改期之后」）。真实 PostgreSQL + 本机假 SMTP，数据全部虚构。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { withPlatformTx } from "./db/context.ts";
import { type TenantFixture, type TestApi, createTestApi } from "./testing/api.ts";
import { assign, newDriver, newVehicle, seedOrder } from "./testing/dispatch.ts";
import { type FakeSmtp, decodedMailText, startFakeSmtp } from "./testing/fake-integrations.ts";
import { type Market, buildMarket, ok } from "./testing/market.ts";
import { tenantLogin } from "./testing/money.ts";

const HOUR = 3_600_000;
let api: TestApi;
let m: Market;
let smtp: FakeSmtp;
let a: TenantFixture;

before(async () => {
  smtp = await startFakeSmtp();
  api = await createTestApi({ env: { SMTP_HOST: smtp.host, SMTP_PORT: String(smtp.port), SMTP_ENCRYPTION: "none", SMTP_USERNAME: "mailer", SMTP_PASSWORD: "fake-smtp-password-Fx7", SMTP_FROM_NAME: "NOZOMI", SMTP_FROM_ADDRESS: "noreply@example.test" }, integrationSecretsTtlMs: 0 });
  m = await buildMarket(api);
  a = { ...m.a, adminToken: await tenantLogin(api, m.a.adminEmail) };
});
after(async () => {
  await api.close();
  await smtp.close();
});
beforeEach(async () => {
  await api.db.owner.query("update notification_events set expanded_at = coalesce(expanded_at, now())");
  await api.db.owner.query("update notifications set status = 'expired', last_error_code = 'ORDER_STATE_CHANGED', lease_token = null, lease_until = null where status in ('pending', 'sending')");
  api.clock.advance(2 * HOUR);
  a.adminToken = await tenantLogin(api, m.a.adminEmail);
  smtp.reset();
});

const newEmail = (): string => `fictional.fix.${randomUUID().slice(0, 10)}@example.test`;
const tick = () => api.app.notificationJobs.tick();
const emailLinks = async (orderId: string): Promise<any[]> => (await api.db.owner.query("select revoked_at, revoke_reason from driver_links where order_id = $1 and purpose = 'email' order by created_at, id", [orderId])).rows;
const resend = (orderId: string) => api.call("POST", `/tenant/v1/orders/${orderId}/driver-link/email`, { token: a.adminToken });
const status = async (orderId: string): Promise<any> => (await ok(api.call("GET", `/tenant/v1/orders/${orderId}/driver-link/email`, { token: a.adminToken }))).driver_link_email;
const requests = async (orderId: string): Promise<number> => (await api.db.owner.query("select count(*)::int as n from driver_link_emails where order_id = $1", [orderId])).rows[0].n;

async function dispatched(email: string | null = newEmail(), hours = 96): Promise<{ order: { id: string }; driver: any; res: any; email: string | null }> {
  const order = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + hours * HOUR) });
  const driver = await newDriver(api, a, email === null ? {} : { email });
  const res = await ok(assign(api, a, order.id, driver.id, (await newVehicle(api, a, m.ids.biz7)).id));
  return { order, driver, res, email };
}

for (const [name, behavior, finalStatus] of [
  ["正文发完才被拒（4xx）", { rejectAt: { stage: "DOT" as const, reply: "451 4.3.0 try later" } }, "pending"],
  ["正文发完才被拒（5xx）", { rejectAt: { stage: "DOT" as const, reply: "554 5.7.1 rejected" } }, "pending"],
  ["收件人被拒", { rejectRecipient: true }, "failed"],
] as const) {
  test(`发信失败（${name}）：这次生成的邮件链接作废；调度员的不动`, async () => {
    const { order, res } = await dispatched();
    smtp.behave(behavior);
    await tick();
    assert.equal((await api.db.owner.query("select status from notifications where order_id = $1 and audience = 'driver'", [order.id])).rows[0].status, finalStatus);
    assert.deepEqual((await emailLinks(order.id)).map((link) => link.revoke_reason), ["send_failed"]);
    assert.equal((await api.call("GET", "/driver/v1/trip", { token: res.driver_link.token })).status, 200, "调度员复制的链接不受影响");
  });
}

test("发信失败后重试成功：只有新生成的那条有效，信里就是它；状态是已发送", async () => {
  const email = newEmail();
  const { order } = await dispatched(email);
  smtp.behave({ rejectAt: { stage: "DOT", reply: "451 4.3.0 try later" } });
  await tick();
  smtp.reset();
  api.clock.advance(61_000);
  a.adminToken = await tenantLogin(api, m.a.adminEmail);
  await tick();
  assert.deepEqual((await emailLinks(order.id)).map((link) => link.revoke_reason), ["send_failed", null]);
  const message = smtp.messages.find((one) => one.to.includes(email));
  assert.ok(message);
  const token = /\/driver#(nzd_[A-Za-z0-9_.-]+)/.exec(decodedMailText(message.data))?.[1] as string;
  assert.equal((await api.call("GET", "/driver/v1/trip", { token })).status, 200);
  assert.equal((await status(order.id)).state, "sent");
});

test("司机停用：重发 409 DRIVER_DISABLED，不写请求、不占限速；状态不给重发；恢复后马上能重发", async () => {
  const { order, driver } = await dispatched();
  await tick();
  api.clock.advance(61_000);
  const disabled = await ok(api.call("DELETE", `/tenant/v1/drivers/${driver.id}`, { token: a.adminToken }));
  const before = await requests(order.id);
  const denied = await resend(order.id);
  assert.deepEqual([denied.status, denied.body.error.code], [409, "DRIVER_DISABLED"]);
  assert.equal(await requests(order.id), before, "不写请求，也就不占限速");
  assert.equal((await status(order.id)).can_resend, false);
  const { id: _id, version, license_state: _state, created_at: _created, updated_at: _updated, email_masked: _masked, ...fields } = disabled;
  await ok(api.call("PUT", `/tenant/v1/drivers/${driver.id}`, { token: a.adminToken, headers: { "if-match": `"${version}"` }, body: { ...fields, status: "active" } }));
  assert.equal((await resend(order.id)).status, 202);
});

test("事件展开一直出错：到上限后状态马上是失败，不用等 15 分钟", async () => {
  const { order } = await dispatched();
  // 真实的出错来源是这单读不出来；这里让展开时的查询失败：把事件指向一个非法的司机编号
  await api.db.owner.query("update notification_events set data = jsonb_set(data, '{driver_id}', '\"not-a-uuid\"') where order_id = $1 and event = 'order.driver_link'", [order.id]);
  for (let round = 0; round < 3; round += 1) await tick();
  const seen = await status(order.id);
  assert.equal(seen.state, "failed", JSON.stringify(seen));
  assert.equal(seen.can_resend, true);
  assert.match(seen.error_message, /复制链接/);
});

test("平台角色只能改发送请求的结束原因；其他列被触发器拦住；租户仍然只能追加", async () => {
  const { order } = await dispatched();
  await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query("update driver_link_emails set driver_id = order_id where order_id = $1", [order.id])));
  await withPlatformTx(api.db.pool, (db) => db.query("update driver_link_emails set closed_code = 'X', closed_at = now() where order_id = $1", [order.id]));
});

test("链接过期之后才改到更晚：重发说要重新生成，不说用车结束超过 24 小时；重新生成后能发", async () => {
  const { order } = await dispatched();
  await tick();
  await api.db.owner.query("update driver_links set expires_at = created_at + interval '1 second' where order_id = $1", [order.id]);
  api.clock.advance(61_000);
  const denied = await resend(order.id);
  assert.deepEqual([denied.status, denied.body.error.code], [409, "DRIVER_LINK_NOT_ACTIVE"]);
  assert.match(denied.body.error.message, /重新生成/);
  assert.equal((await api.call("POST", `/tenant/v1/orders/${order.id}/driver-link`, { token: a.adminToken })).status, 200);
  assert.equal((await resend(order.id)).status, 202);
});

test("一家的总量：同时重发时互相排队，不死锁，全部有结果", async () => {
  const targets = [];
  for (let index = 0; index < 5; index += 1) targets.push(await dispatched());
  api.clock.advance(61_000);
  a.adminToken = await tenantLogin(api, m.a.adminEmail);
  const results = await Promise.all(targets.map((target) => resend(target.order.id)));
  assert.deepEqual(results.map((res) => res.status), [202, 202, 202, 202, 202]);
});
