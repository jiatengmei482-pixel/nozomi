/**
 * QA（M4-27，ADR 0058）：限速和幂等的边界（60 秒、一小时 5 次、一家 200 次，按毫秒）、只发最新、重复事件、后台重试、发送方式开关、邮件没配置。补 driver-link-email.itest.ts 没覆盖到的。
 * 真实 PostgreSQL（独立 schema）+ 本机假 SMTP；数据全部虚构，随 api.close() 删除。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DRIVER_LINK_EMAIL_LIMITS } from "@nozomi/domain";
import { type TenantFixture, type TestApi, createTestApi } from "./testing/api.ts";
import { assign, newDriver, newVehicle, seedOrder } from "./testing/dispatch.ts";
import { type FakeSmtp, decodedMailText, startFakeSmtp } from "./testing/fake-integrations.ts";
import { type Market, buildMarket, ok } from "./testing/market.ts";
import { platformLogin, tenantLogin } from "./testing/money.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { siteApi } from "./testing/site.ts";

const HOUR = 3_600_000;
const NO_SMTP = { SMTP_HOST: "", SMTP_PORT: "", SMTP_ENCRYPTION: "", SMTP_USERNAME: "", SMTP_PASSWORD: "", SMTP_FROM_NAME: "", SMTP_FROM_ADDRESS: "" };
const { orderPerHour, tenantPerHour } = DRIVER_LINK_EMAIL_LIMITS;

let api: TestApi;
let m: Market;
let smtp: FakeSmtp;
let a: TenantFixture;
let b: TenantFixture;

before(async () => {
  smtp = await startFakeSmtp();
  api = await createTestApi({
    payments: new FakePaymentProvider(),
    env: { SMTP_HOST: smtp.host, SMTP_PORT: String(smtp.port), SMTP_ENCRYPTION: "none", SMTP_USERNAME: "mailer", SMTP_PASSWORD: "fake-smtp-password-Qc9", SMTP_FROM_NAME: "NOZOMI", SMTP_FROM_ADDRESS: "noreply@example.test" },
    integrationSecretsTtlMs: 0,
  });
  m = await buildMarket(api);
  a = { ...m.a, adminToken: await tenantLogin(api, m.a.adminEmail) };
  b = { ...m.b, adminToken: await tenantLogin(api, m.b.adminEmail) };
});

after(async () => {
  await api.close();
  await smtp.close();
});

beforeEach(async () => {
  await api.db.owner.query("update notification_events set expanded_at = coalesce(expanded_at, now())");
  await api.db.owner.query("update notifications set status = 'expired', last_error_code = 'ORDER_STATE_CHANGED', lease_token = null, lease_until = null where status in ('pending', 'sending')");
  await api.db.owner.query("update tenant_notification_settings set driver_link_delivery = 'auto'");
  api.clock.advance(2 * HOUR);
  a.adminToken = await tenantLogin(api, m.a.adminEmail);
  b.adminToken = await tenantLogin(api, m.b.adminEmail);
  smtp.reset();
});

const newEmail = (): string => `qa.limits.${randomUUID().slice(0, 12)}@example.test`;
const tick = () => api.app.notificationJobs.tick();
const trip = (token: string) => api.call("GET", "/driver/v1/trip", { token });
const tokenIn = (text: string): string | null => /\/driver#(nzd_[A-Za-z0-9_.-]+)/.exec(text)?.[1] ?? null;
const textsTo = (email: string): string[] => smtp.messages.filter((message) => message.to.includes(email)).map((message) => decodedMailText(message.data));
const tokensTo = (email: string): string[] => textsTo(email).map((text) => tokenIn(text) as string);
const resend = (orderId: string, who: TenantFixture = a) => api.call("POST", `/tenant/v1/orders/${orderId}/driver-link/email`, { token: who.adminToken });
const status = async (orderId: string, who: TenantFixture = a): Promise<any> => (await ok(api.call("GET", `/tenant/v1/orders/${orderId}/driver-link/email`, { token: who.adminToken }))).driver_link_email;
const driverRows = async (orderId: string): Promise<any[]> => (await api.db.owner.query("select * from notifications where order_id = $1 and audience = 'driver' order by created_at, id", [orderId])).rows;
const linkRows = async (orderId: string): Promise<any[]> => (await api.db.owner.query("select * from driver_links where order_id = $1 order by created_at, id", [orderId])).rows;
const requestCount = async (orderId: string): Promise<number> => (await api.db.owner.query("select count(*)::int as n from driver_link_emails where order_id = $1", [orderId])).rows[0].n;
const putDriver = (who: TenantFixture, driver: any, changes: Record<string, unknown>) => {
  const { id: _id, version, license_state: _state, created_at: _created, updated_at: _updated, email_masked: _masked, ...fields } = driver;
  return api.call("PUT", `/tenant/v1/drivers/${driver.id}`, { token: who.adminToken, headers: { "if-match": `"${version}"` }, body: { ...fields, ...changes } });
};
const setDelivery = async (who: TenantFixture, mode: "auto" | "manual"): Promise<void> => {
  const current = await ok(api.call("GET", "/tenant/v1/notification-settings", { token: who.adminToken }));
  await ok(api.call("PUT", "/tenant/v1/notification-settings", { token: who.adminToken, ...(current.version === 0 ? {} : { headers: { "if-match": `"${current.version}"` } }), body: { quiet_hours: current.quiet_hours, driver_link_delivery: mode } }));
};

let hourOffset = 96;
async function dispatched(who: TenantFixture = a, side: "a" | "b" = "a", email: string | null = newEmail()): Promise<{ order: { id: string; orderNo: string }; driver: any; vehicle: any; res: any; email: string }> {
  hourOffset += 1;
  const order = await seedOrder(api, m, side, { serviceAt: new Date(api.clock.now().getTime() + hourOffset * HOUR) });
  const driver = await newDriver(api, who, email === null ? {} : { email });
  const vehicle = await newVehicle(api, who, m.ids.biz7);
  const res = await ok(assign(api, who, order.id, driver.id, vehicle.id));
  return { order, driver, vehicle, res, email: email as string };
}

/** 直接写库把这家的计数垫到 `count`（真走接口要几百次）。写在 `orderId` 名下，它们也算这张单的次数：垫的单不要拿来测重发。 */
async function fillTenantQuota(tenantId: string, orderId: string, count: number): Promise<void> {
  const now = api.clock.now();
  const source = (await api.db.owner.query("select assignment_id, driver_id, link_id from driver_link_emails where order_id = $1 limit 1", [orderId])).rows[0];
  for (let index = 0; index < count; index += 1) {
    const id = randomUUID();
    await api.db.owner.query("insert into notification_events (id, tenant_id, event, order_id, dedupe_key, data, occurred_at, expanded_at) values ($1, $2, 'order.driver_link', $3, $4, '{}', $5, $5)", [id, tenantId, orderId, `qa-fill:${id}`, now]);
    await api.db.owner.query("insert into driver_link_emails (tenant_id, id, order_id, assignment_id, driver_id, link_id, trigger, requested_at) values ($1, $2, $3, $4, $5, $6, 'auto', $7)", [tenantId, id, orderId, source.assignment_id, source.driver_id, source.link_id, now]);
  }
}
const tenantUsed = async (tenantId: string): Promise<number> => (await api.db.owner.query("select count(*)::int as n from driver_link_emails where tenant_id = $1 and requested_at > $2", [tenantId, new Date(api.clock.now().getTime() - HOUR)])).rows[0].n;

// ---- 限速的边界 ----

test("60 秒：差 1 毫秒 429（retry_after 至少 1 秒），正好 60 秒放行；含自动发的那次；被拒的不算次数、不写审计", async () => {
  const { order } = await dispatched();
  api.clock.advance(59_999);
  const early = await resend(order.id);
  assert.equal(early.status, 429, early.text);
  assert.equal(early.body.error.details.retry_after_seconds, 1);
  assert.equal(await requestCount(order.id), 1, "被拒的不写请求");
  const audits = await api.db.owner.query("select count(*)::int as n from audit_logs where resource = 'driver_link' and action = 'retry' and after ->> 'order_id' = $1", [order.id]);
  assert.equal(audits.rows[0].n, 0, "被拒的不写审计");
  api.clock.advance(1);
  assert.equal((await resend(order.id)).status, 202, "正好 60 秒放行");
  const retryAfter = await resend(order.id);
  assert.equal(retryAfter.body.error.details.retry_after_seconds, 60, "刚发完，要等满 60 秒");
});

test("一小时 5 次：第 6 次 429，等到最早那次满一小时才放行；差 1 毫秒不放行；retry_after 对得上", async () => {
  const { order } = await dispatched();
  const started = api.clock.now().getTime();
  for (let index = 1; index < orderPerHour; index += 1) {
    api.clock.advance(60_000);
    assert.equal((await resend(order.id)).status, 202, `第 ${index + 1} 次`);
  }
  assert.equal(await requestCount(order.id), orderPerHour);
  api.clock.advance(60_000);
  a.adminToken = await tenantLogin(api, m.a.adminEmail);
  const sixth = await resend(order.id);
  assert.equal(sixth.status, 429);
  const remaining = started + HOUR - api.clock.now().getTime();
  assert.equal(sixth.body.error.details.retry_after_seconds, Math.ceil(remaining / 1000));

  api.clock.advance(remaining - 1);
  a.adminToken = await tenantLogin(api, m.a.adminEmail);
  assert.equal((await resend(order.id)).status, 429, "差 1 毫秒");
  api.clock.advance(1);
  assert.equal((await resend(order.id)).status, 202, "最早那次满一小时");
  assert.equal(await requestCount(order.id), orderPerHour + 1);
});

test("改派也算这张单的次数：改派刚发过，60 秒内点重发被拒（不会一下子发两封给新司机）", async () => {
  const { order, res, vehicle } = await dispatched();
  api.clock.advance(120_000);
  const email = newEmail();
  const second = await newDriver(api, a, { email });
  await ok(assign(api, a, order.id, second.id, vehicle.id, { version: res.order.version }));
  assert.equal((await resend(order.id)).status, 429);
  await tick();
  assert.equal(textsTo(email).length, 1);
});

test("一家 200 次：第 199 次之后还能发第 200 次，第 201 次 429，retry_after 按最早那次算；另一家、派车不受影响", async () => {
  const filler = await dispatched();
  const target = await dispatched();
  const spare = await dispatched();
  api.clock.advance(61_000);
  await fillTenantQuota(a.tenantId, filler.order.id, tenantPerHour - 1 - (await tenantUsed(a.tenantId)));
  const oldest = (await api.db.owner.query("select min(requested_at) as at from driver_link_emails where tenant_id = $1 and requested_at > $2", [a.tenantId, new Date(api.clock.now().getTime() - HOUR)])).rows[0].at as Date;
  assert.equal(await tenantUsed(a.tenantId), tenantPerHour - 1);
  assert.equal((await resend(target.order.id)).status, 202, "第 200 次");
  assert.equal(await tenantUsed(a.tenantId), tenantPerHour);
  const limited = await resend(spare.order.id);
  assert.equal(limited.status, 429, limited.text);
  assert.equal(limited.body.error.details.retry_after_seconds, Math.ceil((oldest.getTime() + HOUR - api.clock.now().getTime()) / 1000));

  const other = await dispatched(b, "b");
  api.clock.advance(61_000);
  assert.equal((await resend(other.order.id, b)).status, 202, "另一家不受影响");

  const email = newEmail();
  const still = await dispatched(a, "a", email);
  assert.equal(still.res.order.status, "assigned", "到上限不挡派车");
  assert.equal(still.res.driver_link_email.state, "pending");
  await tick();
  assert.equal(textsTo(email).length, 1, "派车自动发的那封不受一家上限影响");
});

test("一家 200 次并发：只剩 1 个名额，几张单同时点重发，只能成功 1 个（账号被盗时并发不能绕过上限）", async () => {
  const filler = await dispatched();
  const targets = [];
  for (let index = 0; index < 6; index += 1) targets.push(await dispatched());
  api.clock.advance(61_000);
  await fillTenantQuota(a.tenantId, filler.order.id, tenantPerHour - 1 - (await tenantUsed(a.tenantId)));
  const results = await Promise.all(targets.map((target) => resend(target.order.id)));
  const passed = results.filter((res) => res.status === 202).length;
  assert.equal(await tenantUsed(a.tenantId) <= tenantPerHour, true, `实际放行 ${passed} 个，这家一小时的总数到了 ${await tenantUsed(a.tenantId)}，超过 ${tenantPerHour}`);
});

// ---- 只发最新、重复事件 ----

test("连发几次都排着：只发最新一封，前面的记 SUPERSEDED；邮件链接只生成一条", async () => {
  const email = newEmail();
  const { order } = await dispatched(a, "a", email);
  for (let index = 0; index < 2; index += 1) {
    api.clock.advance(60_000);
    assert.equal((await resend(order.id)).status, 202);
  }
  await tick();
  assert.equal(textsTo(email).length, 1, "只有一封");
  const rows = await driverRows(order.id);
  assert.deepEqual(rows.map((row) => row.last_error_code).sort(), ["DRIVER_LINK_SUPERSEDED", "DRIVER_LINK_SUPERSEDED", null].sort());
  assert.equal((await linkRows(order.id)).filter((link) => link.purpose === "email").length, 1);
});

test("多个实例同时跑后台任务（e2e 和多副本的情形）：一封只发一次，邮件链接只有一条", async () => {
  const email = newEmail();
  const { order } = await dispatched(a, "a", email);
  await Promise.all([tick(), tick(), tick(), tick()]);
  await tick();
  assert.equal(textsTo(email).length, 1);
  assert.equal((await linkRows(order.id)).filter((link) => link.purpose === "email").length, 1);
});

test("重复事件：同一个事件再展开一次不多发；重放的事件没有对应的发送请求，不发", async () => {
  const email = newEmail();
  const { order, driver } = await dispatched(a, "a", email);
  await tick();
  assert.equal(textsTo(email).length, 1);
  await api.db.owner.query("update notification_events set expanded_at = null where order_id = $1 and event = 'order.driver_link'", [order.id]);
  await tick();
  assert.equal(textsTo(email).length, 1, "同一个事件重新展开，记录不重复");
  assert.equal((await driverRows(order.id)).length, 1);

  const source = (await api.db.owner.query("select assignment_id, link_id from driver_link_emails where order_id = $1", [order.id])).rows[0];
  const forged = randomUUID();
  await api.db.owner.query("insert into notification_events (id, tenant_id, event, order_id, dedupe_key, data, occurred_at) values ($1, $2, 'order.driver_link', $3, $4, $5::jsonb, $6)", [forged, a.tenantId, order.id, `order.driver_link:${forged}`, JSON.stringify({ driver_id: driver.id, assignment_id: source.assignment_id, link_id: source.link_id }), api.clock.now()]);
  await tick();
  assert.equal(textsTo(email).length, 1, "没有发送请求的事件不算最新，不发");
  const forgedRow = (await api.db.owner.query("select status, last_error_code from notifications where event_id = $1", [forged])).rows[0];
  assert.deepEqual([forgedRow.status, forgedRow.last_error_code], ["expired", "DRIVER_LINK_SUPERSEDED"]);
});

test("事件里的司机被改成别人（和订单现在的司机对不上）：谁都不发", async () => {
  const email = newEmail();
  const { order } = await dispatched(a, "a", email);
  const intruderEmail = newEmail();
  const intruder = await newDriver(api, a, { email: intruderEmail });
  await api.db.owner.query("update notification_events set data = jsonb_set(data, '{driver_id}', to_jsonb($2::text)) where order_id = $1 and event = 'order.driver_link'", [order.id, intruder.id]);
  await tick();
  assert.equal(textsTo(intruderEmail).length, 0, "事件里的司机和订单现在的司机对不上");
  assert.equal(textsTo(email).length, 0);
  const row = (await driverRows(order.id))[0];
  assert.equal(row.last_error_code, "ORDER_STATE_CHANGED");
});

// ---- 后台重试 ----

test("后台重试：每次新生成令牌，邮件里的是最后一次的；之前尝试的行是发不出去的（SMTP 没收到过），重新生成时一起作废", async () => {
  const email = newEmail();
  const { order } = await dispatched(a, "a", email);
  smtp.behave({ rejectAt: { stage: "RCPT", reply: "450 4.2.1 later" } });
  await tick();
  assert.equal(smtp.messages.length, 0, "这次尝试 SMTP 没收到正文，没有人拿得到令牌");
  const afterFirst = (await linkRows(order.id)).filter((link) => link.purpose === "email");
  assert.equal((await driverRows(order.id))[0].status, "pending");

  smtp.reset();
  api.clock.advance(61_000);
  await tick();
  const [token] = tokensTo(email);
  assert.ok(token);
  const emailRows = (await linkRows(order.id)).filter((link) => link.purpose === "email");
  assert.equal(emailRows.length, afterFirst.length + 1, "每次尝试一条，不复用");
  assert.equal((await trip(token)).status, 200);
  const hashes = new Set(emailRows.map((link) => link.token_hash));
  assert.equal(hashes.size, emailRows.length, "每次的令牌都不一样");

  await ok(api.call("POST", `/tenant/v1/orders/${order.id}/driver-link`, { token: a.adminToken }));
  assert.ok((await linkRows(order.id)).filter((link) => link.purpose === "email").every((link) => link.revoked_at !== null), "失败尝试留下的行也一起作废");
  assert.equal((await trip(token)).status, 401);
});

test("等重试期间发生变化：改派、吊销、重新生成、切手动、改邮箱，下一次重试都按现在的情况复查", async () => {
  const later = () => smtp.behave({ rejectAt: { stage: "MAIL", reply: "450 4.2.1 later" } });
  const waiting = async (email: string) => {
    const made = await dispatched(a, "a", email);
    later();
    await tick();
    assert.equal((await driverRows(made.order.id))[0].status, "pending");
    smtp.reset();
    return made;
  };

  const moved = await waiting(newEmail());
  const nextEmail = newEmail();
  const second = await newDriver(api, a, { email: nextEmail });
  await ok(assign(api, a, moved.order.id, second.id, moved.vehicle.id, { version: moved.res.order.version }));
  api.clock.advance(61_000);
  await tick();
  assert.equal(textsTo(moved.email).length, 0, "改派：旧司机的重试不发");
  assert.equal(textsTo(nextEmail).length, 1, "改派：只有新司机收到");

  const revoked = await waiting(newEmail());
  await api.call("DELETE", `/tenant/v1/orders/${revoked.order.id}/driver-link`, { token: a.adminToken });
  api.clock.advance(61_000);
  await tick();
  assert.equal(textsTo(revoked.email).length, 0, "吊销：不发");
  assert.equal((await driverRows(revoked.order.id))[0].last_error_code, "DRIVER_LINK_REVOKED");

  const reissued = await waiting(newEmail());
  await ok(api.call("POST", `/tenant/v1/orders/${reissued.order.id}/driver-link`, { token: a.adminToken }));
  api.clock.advance(61_000);
  await tick();
  assert.equal(textsTo(reissued.email).length, 0, "重新生成：不发");

  const changedEmail = newEmail();
  const changed = await waiting(newEmail());
  await ok(putDriver(a, changed.driver, { email: changedEmail }));
  api.clock.advance(61_000);
  await tick();
  assert.equal(textsTo(changed.email).length, 0, "改邮箱：旧地址不发");
  assert.equal(textsTo(changedEmail).length, 1, "改邮箱：发到新地址");
  assert.equal((await driverRows(changed.order.id))[0].recipient, changedEmail);

  const manual = await waiting(newEmail());
  await setDelivery(a, "manual");
  api.clock.advance(61_000);
  await tick();
  assert.equal(textsTo(manual.email).length, 0, "切手动：不发");
  assert.equal((await driverRows(manual.order.id))[0].last_error_code, "DRIVER_LINK_MANUAL");
  await setDelivery(a, "auto");
});

test("发送途中进程断了：不知道发没发，不自动重发；状态失败、提示和司机确认；调度员能重发", async () => {
  const email = newEmail();
  const { order } = await dispatched(a, "a", email);
  await api.app.notificationJobs.expandEvents(api.clock.now());
  await api.db.owner.query("update notifications set status = 'sending', lease_token = gen_random_uuid(), lease_until = $2, prepared_only = false where order_id = $1 and audience = 'driver'", [order.id, new Date(api.clock.now().getTime() - 1000)]);
  await tick();
  assert.equal(textsTo(email).length, 0, "不自动重发");
  const seen = await status(order.id);
  assert.equal(seen.state, "failed");
  assert.equal(seen.error_code, "OUTCOME_UNKNOWN");
  assert.match(seen.error_message, /不知道发出去了没有/);
  assert.equal(seen.can_resend, true);
  api.clock.advance(61_000);
  assert.equal((await resend(order.id)).status, 202);
  await tick();
  assert.equal(textsTo(email).length, 1);
});

test("准备阶段进程断了（还没连邮件服务器）：交回等待，下一轮发一次", async () => {
  const email = newEmail();
  const { order } = await dispatched(a, "a", email);
  await api.app.notificationJobs.expandEvents(api.clock.now());
  await api.db.owner.query("update notifications set status = 'sending', lease_token = gen_random_uuid(), lease_until = $2, prepared_only = true where order_id = $1 and audience = 'driver'", [order.id, new Date(api.clock.now().getTime() - 1000)]);
  await tick();
  await tick();
  assert.equal(textsTo(email).length, 1);
});

// ---- 开关 ----

test("切手动再切回自动：排队期间切回来发一封；已作废的不复活；作废后状态能重发", async () => {
  const beforeTick = newEmail();
  await dispatched(a, "a", beforeTick);
  await setDelivery(a, "manual");
  await setDelivery(a, "auto");
  await tick();
  assert.equal(textsTo(beforeTick).length, 1, "发送时已经是自动，照发");

  const dropped = newEmail();
  const second = await dispatched(a, "a", dropped);
  await setDelivery(a, "manual");
  await tick();
  await setDelivery(a, "auto");
  await tick();
  assert.equal(textsTo(dropped).length, 0, "作废的不因为切回来就发");
  const seen = await status(second.order.id);
  assert.equal(seen.state, "failed");
  assert.equal(seen.error_code, "DRIVER_LINK_MANUAL");
  assert.equal(seen.can_resend, true);
  api.clock.advance(61_000);
  assert.equal((await resend(second.order.id)).status, 202);
  await tick();
  assert.equal(textsTo(dropped).length, 1);
});

test("手动模式：已发出的邮件链接不作废；状态是手动；不能重发；改派作废旧链接且不发新信；被拒的重发不占次数、不写审计", async () => {
  const email = newEmail();
  const { order, res, vehicle } = await dispatched(a, "a", email);
  await tick();
  const [token] = tokensTo(email);
  await setDelivery(a, "manual");
  assert.equal((await trip(token as string)).status, 200, "切手动不动已发出的链接（ADR 0058）");
  const seen = await status(order.id);
  assert.equal(seen.state, "manual");
  assert.equal(seen.can_resend, false);
  api.clock.advance(61_000);
  const before = await requestCount(order.id);
  const denied = await resend(order.id);
  assert.deepEqual([denied.status, denied.body.error.code], [409, "DRIVER_LINK_EMAIL_MANUAL"]);
  assert.equal(await requestCount(order.id), before);

  const nextEmail = newEmail();
  const second = await newDriver(api, a, { email: nextEmail });
  const moved = await ok(assign(api, a, order.id, second.id, vehicle.id, { version: res.order.version }));
  assert.equal(moved.driver_link_email.state, "manual");
  assert.equal((await trip(token as string)).status, 401);
  await tick();
  assert.equal(textsTo(nextEmail).length, 0, "手动模式改派不发");
  assert.equal((await trip(moved.driver_link.token)).status, 200, "复制的链接可用");
  await setDelivery(a, "auto");
  const back = await status(order.id);
  assert.equal(back.state, "not_sent", "切回自动不补发，提示可以重发");
  assert.equal(back.can_resend, true);
  await tick();
  assert.equal(textsTo(nextEmail).length, 0);
});

test("旧数据：这家没有设置行（升级前的供应商）就是自动；司机后来才补邮箱：状态变成没发过，能重发；不自动补发", async () => {
  await api.db.owner.query("delete from tenant_notification_settings where tenant_id = $1", [a.tenantId]);
  const email = newEmail();
  const withEmail = await dispatched(a, "a", email);
  assert.equal(withEmail.res.driver_link_email.state, "pending");
  await tick();
  assert.equal(textsTo(email).length, 1);

  const later = newEmail();
  const noEmail = await dispatched(a, "a", null);
  assert.equal(noEmail.res.driver_link_email.state, "no_email");
  assert.equal(noEmail.res.driver_link_email.can_resend, false);
  await ok(putDriver(a, noEmail.driver, { email: later }));
  await tick();
  assert.equal(textsTo(later).length, 0, "补邮箱不自动发");
  const seen = await status(noEmail.order.id);
  assert.equal(seen.state, "not_sent");
  assert.equal(seen.can_resend, true);
  assert.equal((await resend(noEmail.order.id)).status, 202, "这一单没发起过，不受 60 秒限制");
  await tick();
  assert.equal(textsTo(later).length, 1);
  assert.equal((await trip(tokensTo(later)[0] as string)).status, 200);
});

test("排队中删了邮箱又补回来：信已经不会发了，状态不能继续显示「正在发到…」", async () => {
  const email = newEmail();
  const { order, driver } = await dispatched(a, "a", email);
  const cleared = await ok(putDriver(a, driver, { email: null }));
  await tick();
  assert.equal((await driverRows(order.id)).length, 0, "展开时没有地址，这次发起已经不会有发送记录");
  await ok(putDriver(a, cleared, { email }));
  await tick();
  assert.equal(textsTo(email).length, 0, "这封确实不会发了");
  const seen = await status(order.id);
  assert.notEqual(seen.state, "pending", "状态写着正在发，实际永远不会发（要等 15 分钟才变成失败）");
});

// ---- 邮件没配置 ----

test("邮件没配置：重发也是 202 + 提示手动；运营重试 409；连点受限；配好后只发最新一封", async () => {
  const unconfigured = await siteApi(api, null, null, NO_SMTP, { integrationSecretsTtlMs: 0 });
  try {
    const email = newEmail();
    const order = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 96 * HOUR) });
    const driver = await newDriver(api, a, { email });
    const vehicle = await newVehicle(api, a, m.ids.biz7);
    await ok(unconfigured.call("POST", `/tenant/v1/orders/${order.id}/assign`, { token: a.adminToken, headers: { "if-match": `"1"` }, body: { driver_id: driver.id, vehicle_id: vehicle.id } }));
    await unconfigured.app.notificationJobs.tick();
    assert.equal((await linkRows(order.id)).filter((link) => link.purpose === "email").length, 0, "没配置时不生成邮件链接");
    api.clock.advance(61_000);
    const res = await unconfigured.call("POST", `/tenant/v1/orders/${order.id}/driver-link/email`, { token: a.adminToken });
    assert.equal(res.status, 202, res.text);
    assert.equal(res.body.driver_link_email.state, "pending");
    assert.equal(res.body.driver_link_email.error_code, "NOT_CONFIGURED");
    assert.match(res.body.driver_link_email.error_message, /手动/);
    await unconfigured.app.notificationJobs.tick();
    const row = (await driverRows(order.id))[0];
    const retried = await unconfigured.call("POST", `/platform/v1/notifications/${row.id}/retry`, { token: await platformLogin(api, m.staff.operations.email) });
    assert.equal(retried.status, 409, retried.text);
    await tick();
    assert.equal(textsTo(email).length, 1, "配好后只发最新一封");
    const rows = await driverRows(order.id);
    assert.deepEqual(rows.map((one) => one.status).sort(), ["expired", "sent"]);
  } finally {
    await unconfigured.close();
  }
});

test("邮件长期没配置：用车结束超过 24 小时后配好不发；不生成链接", async () => {
  const unconfigured = await siteApi(api, null, null, NO_SMTP, { integrationSecretsTtlMs: 0 });
  try {
    const email = newEmail();
    const order = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 6 * HOUR) });
    const driver = await newDriver(api, a, { email });
    const vehicle = await newVehicle(api, a, m.ids.biz7);
    await ok(unconfigured.call("POST", `/tenant/v1/orders/${order.id}/assign`, { token: a.adminToken, headers: { "if-match": `"1"` }, body: { driver_id: driver.id, vehicle_id: vehicle.id } }));
    await unconfigured.app.notificationJobs.tick();
    api.clock.advance(3 * 24 * HOUR);
    await tick();
    assert.equal(textsTo(email).length, 0, "锚点已过期，配好后不发");
    const row = (await driverRows(order.id))[0];
    assert.deepEqual([row.status, row.last_error_code], ["expired", "DRIVER_LINK_REVOKED"]);
    assert.equal((await linkRows(order.id)).filter((link) => link.purpose === "email").length, 0);
  } finally {
    await unconfigured.close();
  }
});

test("超过 7 天没发出去：记过期，运营重试走复查，改派过的不发给旧司机", async () => {
  const email = newEmail();
  const order = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 30 * 24 * HOUR) });
  const driver = await newDriver(api, a, { email });
  const vehicle = await newVehicle(api, a, m.ids.biz7);
  const res = await ok(assign(api, a, order.id, driver.id, vehicle.id));
  await api.app.notificationJobs.expandEvents(api.clock.now());
  await api.db.owner.query("update notifications set next_attempt_at = $2 where order_id = $1 and audience = 'driver'", [order.id, new Date(api.clock.now().getTime() + 30 * 24 * HOUR)]);
  api.clock.advance(7 * 24 * HOUR + 1000);
  a.adminToken = await tenantLogin(api, m.a.adminEmail);
  await tick();
  const row = (await driverRows(order.id))[0];
  assert.deepEqual([row.status, row.last_error_code], ["expired", "EXPIRED"]);
  const seen = await status(order.id);
  assert.equal(seen.state, "failed");
  assert.match(seen.error_message, /过了有效期/);
  const second = await newDriver(api, a, { email: newEmail() });
  await ok(assign(api, a, order.id, second.id, vehicle.id, { version: res.order.version }));
  const retried = await api.call("POST", `/platform/v1/notifications/${row.id}/retry`, { token: await platformLogin(api, m.staff.operations.email) });
  assert.equal(retried.status, 200, retried.text);
  assert.equal(retried.body.notification.status, "expired");
  assert.equal(textsTo(email).length, 0);
});
