/**
 * QA（M4-27，ADR 0058）：发错人和旧链接。补 driver-link-email.itest.ts 没覆盖到的：两张单同一司机、已发出后的 A→B→A、发信和改派 / 吊销 / 改邮箱真正并发、
 * 救援转给别家、真实的取消和改期、多位司机同邮箱、两条链接的 `withDriver` 核对、`currentDriverLink` 和「司机最近打开」。
 * 真实 PostgreSQL（独立 schema）+ 本机假 SMTP；数据全部虚构，随 api.close() 删除。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type TenantFixture, type TestApi, createTestApi } from "./testing/api.ts";
import { assign, newDriver, newVehicle, seedOrder } from "./testing/dispatch.ts";
import { type FakeSmtp, decodedMailText, startFakeSmtp } from "./testing/fake-integrations.ts";
import { type Market, buildMarket, ok } from "./testing/market.ts";
import { platformLogin, tenantLogin } from "./testing/money.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

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
    env: { SMTP_HOST: smtp.host, SMTP_PORT: String(smtp.port), SMTP_ENCRYPTION: "none", SMTP_USERNAME: "mailer", SMTP_PASSWORD: "fake-smtp-password-Qa7", SMTP_FROM_NAME: "NOZOMI", SMTP_FROM_ADDRESS: "noreply@example.test" },
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

beforeEach(async () => {
  await api.db.owner.query("update notification_events set expanded_at = coalesce(expanded_at, now())");
  await api.db.owner.query("update notifications set status = 'expired', last_error_code = 'ORDER_STATE_CHANGED', lease_token = null, lease_until = null where status in ('pending', 'sending')");
  await api.db.owner.query("update tenant_notification_settings set driver_link_delivery = 'auto'");
  api.clock.advance(2 * HOUR);
  a.adminToken = await tenantLogin(api, m.a.adminEmail);
  b.adminToken = await tenantLogin(api, m.b.adminEmail);
  smtp.reset();
});

const newEmail = (): string => `qa.driver.${randomUUID().slice(0, 12)}@example.test`;
const tick = () => api.app.notificationJobs.tick();
const trip = (token: string) => api.call("GET", "/driver/v1/trip", { token });
const tokenIn = (text: string): string | null => /\/driver#(nzd_[A-Za-z0-9_.-]+)/.exec(text)?.[1] ?? null;
const textsTo = (email: string): string[] => smtp.messages.filter((message) => message.to.includes(email)).map((message) => decodedMailText(message.data));
const tokensTo = (email: string): string[] => textsTo(email).flatMap((text) => tokenIn(text) ?? []);
const links = async (orderId: string): Promise<any[]> => (await api.db.owner.query("select * from driver_links where order_id = $1 order by created_at, id", [orderId])).rows;
const activeLinks = async (orderId: string): Promise<any[]> => (await links(orderId)).filter((link) => link.revoked_at === null);
const status = async (orderId: string, who: TenantFixture = a): Promise<any> => (await ok(api.call("GET", `/tenant/v1/orders/${orderId}/driver-link/email`, { token: who.adminToken }))).driver_link_email;
const resend = (orderId: string, who: TenantFixture = a) => api.call("POST", `/tenant/v1/orders/${orderId}/driver-link/email`, { token: who.adminToken });
const detail = (orderId: string, who: TenantFixture = a) => ok(api.call("GET", `/tenant/v1/orders/${orderId}`, { token: who.adminToken }));
const putDriver = (who: TenantFixture, driver: any, changes: Record<string, unknown>) => {
  const { id: _id, version, license_state: _state, created_at: _created, updated_at: _updated, email_masked: _masked, ...fields } = driver;
  return api.call("PUT", `/tenant/v1/drivers/${driver.id}`, { token: who.adminToken, headers: { "if-match": `"${version}"` }, body: { ...fields, ...changes } });
};
const seed = (side: "a" | "b" = "a", hours = 96) => seedOrder(api, m, side, { serviceAt: new Date(api.clock.now().getTime() + hours * HOUR) });
/** 等到有语句卡在锁上。等不到也继续（修好之后时序可能不一样，这里不能因此失败）。 */
const untilBlocked = async (like: string): Promise<void> => {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const found = await api.db.owner.query("select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and query ilike $1", [like]);
    if (found.rows[0].n > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
const settled = (work: Promise<unknown>, ms = 3_000): Promise<unknown> => Promise.race([work.catch(() => undefined), new Promise((resolve) => setTimeout(resolve, ms))]);

async function dispatched(who: TenantFixture = a, side: "a" | "b" = "a", email: string | null = newEmail(), hours = 96): Promise<{ order: { id: string; orderNo: string }; driver: any; vehicle: any; res: any; email: string }> {
  const order = await seed(side, hours);
  const driver = await newDriver(api, who, email === null ? {} : { email });
  const vehicle = await newVehicle(api, who, m.ids.biz7);
  const res = await ok(assign(api, who, order.id, driver.id, vehicle.id));
  return { order, driver, vehicle, res, email: email as string };
}

// ---- 两张单、同一位司机 ----

test("两张单同一司机：每封只带自己那张单；改派其中一张不影响另一张；令牌打不开另一张单", async () => {
  const email = newEmail();
  const driver = await newDriver(api, a, { email });
  const vehicleOne = await newVehicle(api, a, m.ids.biz7);
  const vehicleTwo = await newVehicle(api, a, m.ids.biz7);
  const first = await seed("a", 96);
  const second = await seed("a", 240);
  const firstAssigned = await ok(assign(api, a, first.id, driver.id, vehicleOne.id));
  await ok(assign(api, a, second.id, driver.id, vehicleTwo.id));
  await tick();

  const mails = textsTo(email);
  assert.equal(mails.length, 2, "每张单各一封");
  const mailOf = (orderNo: string): string => mails.find((text) => text.includes(orderNo)) as string;
  assert.equal(mailOf(first.orderNo).includes(second.orderNo), false, "第一封里没有第二张单");
  assert.equal(mailOf(second.orderNo).includes(first.orderNo), false, "第二封里没有第一张单");
  const tokenFirst = tokenIn(mailOf(first.orderNo)) as string;
  const tokenSecond = tokenIn(mailOf(second.orderNo)) as string;
  assert.equal((await ok(trip(tokenFirst))).order.order_no, first.orderNo, "第一封只开得到第一张单");
  assert.equal((await ok(trip(tokenSecond))).order.order_no, second.orderNo, "第二封只开得到第二张单");

  const other = await newDriver(api, a, { email: newEmail() });
  await ok(assign(api, a, first.id, other.id, vehicleOne.id, { version: firstAssigned.order.version }));
  assert.equal((await trip(tokenFirst)).status, 401, "改派的那张单旧邮件链接失效");
  assert.equal((await trip(tokenSecond)).status, 200, "同一司机的另一张单不受影响");
});

test("两张单同一司机：改邮箱作废他名下所有邮件链接；排队的两封都发到新地址、旧地址一封不收", async () => {
  const oldEmail = newEmail();
  const driver = await newDriver(api, a, { email: oldEmail });
  const vehicleOne = await newVehicle(api, a, m.ids.biz7);
  const vehicleTwo = await newVehicle(api, a, m.ids.biz7);
  const first = await seed("a", 96);
  const second = await seed("a", 240);
  const firstAssigned = await ok(assign(api, a, first.id, driver.id, vehicleOne.id));
  const secondAssigned = await ok(assign(api, a, second.id, driver.id, vehicleTwo.id));
  await tick();
  const delivered = tokensTo(oldEmail);
  assert.equal(delivered.length, 2);

  const changed = newEmail();
  const updated = await ok(putDriver(a, driver, { email: changed }));
  for (const token of delivered) assert.equal((await trip(token)).status, 401, "发到旧地址的两条都作废");
  assert.equal((await trip(firstAssigned.driver_link.token)).status, 200, "调度员手里的第一条不动");
  assert.equal((await trip(secondAssigned.driver_link.token)).status, 200, "调度员手里的第二条不动");

  api.clock.advance(61_000);
  a.adminToken = await tenantLogin(api, m.a.adminEmail);
  assert.equal((await resend(first.id)).status, 202);
  assert.equal((await resend(second.id)).status, 202);
  const third = newEmail();
  await ok(putDriver(a, updated, { email: third }));
  smtp.reset();
  await tick();
  assert.equal(textsTo(oldEmail).length, 0);
  assert.equal(textsTo(changed).length, 0, "排队期间又改了一次，上一个地址也收不到");
  assert.equal(textsTo(third).length, 2, "两封都按发送时的地址");
});

// ---- A → B → A，信已发出 ----

test("A→B→A：两位司机之前收到的信都打不开；A 只能用最新那封；B 手里没有有效链接", async () => {
  const emailA = newEmail();
  const emailB = newEmail();
  const first = await dispatched(a, "a", emailA);
  await tick();
  const driverB = await newDriver(api, a, { email: emailB });
  const toB = await ok(assign(api, a, first.order.id, driverB.id, first.vehicle.id, { version: first.res.order.version }));
  await tick();
  const back = await ok(assign(api, a, first.order.id, first.driver.id, first.vehicle.id, { version: toB.order.version }));
  await tick();

  const [oldA, newestA] = tokensTo(emailA);
  const [oldB] = tokensTo(emailB);
  assert.ok(oldA && newestA && oldB, "A 两封、B 一封");
  assert.equal(tokensTo(emailA).length, 2);
  assert.equal(tokensTo(emailB).length, 1);
  assert.equal((await trip(oldA)).status, 401, "A 第一封的旧链接不能借「又是 A」复活");
  assert.equal((await trip(first.res.driver_link.token)).status, 401, "A 第一次的调度员链接也不能复活");
  assert.equal((await trip(oldB)).status, 401, "B 的邮件链接失效");
  assert.equal((await trip(toB.driver_link.token)).status, 401, "B 的调度员链接失效");
  assert.equal((await trip(newestA)).status, 200);
  assert.equal((await trip(back.driver_link.token)).status, 200);
  const active = await activeLinks(first.order.id);
  assert.ok(active.every((link) => link.driver_id === first.driver.id), "有效链接全部属于 A");
  assert.deepEqual(active.map((link) => link.purpose).sort(), ["dispatcher", "email"]);
});

test("只换车不换司机：旧链接作废，同一位司机收到新的一封；什么都没变的再派一次不发信", async () => {
  const email = newEmail();
  const first = await dispatched(a, "a", email);
  await tick();
  const [oldToken] = tokensTo(email);
  const same = await ok(assign(api, a, first.order.id, first.driver.id, first.vehicle.id, { version: first.res.order.version }));
  assert.equal(same.driver_link, null);
  assert.equal(same.driver_link_email, null);
  await tick();
  assert.equal(tokensTo(email).length, 1, "什么都没变，不再发");
  assert.equal((await trip(oldToken as string)).status, 200, "什么都没变，链接也不动");

  const vehicle = await newVehicle(api, a, m.ids.biz7);
  await ok(assign(api, a, first.order.id, first.driver.id, vehicle.id, { version: same.order.version }));
  assert.equal((await trip(oldToken as string)).status, 401);
  await tick();
  assert.equal(tokensTo(email).length, 2);
});

test("派车被拒（同一时段冲突、版本号不对）：事务回滚，不留发送请求，也不发信", async () => {
  const email = newEmail();
  const first = await dispatched(a, "a", email);
  const conflicting = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 96 * HOUR) });
  const vehicle = await newVehicle(api, a, m.ids.biz7);
  const refused = await assign(api, a, conflicting.id, first.driver.id, vehicle.id);
  assert.equal(refused.status, 409, refused.text);
  const stale = await assign(api, a, first.order.id, first.driver.id, vehicle.id, { version: first.res.order.version + 9 });
  assert.notEqual(stale.status, 200, stale.text);
  const rows = await api.db.owner.query("select count(*)::int as n from driver_link_emails where order_id = any($1::uuid[])", [[conflicting.id, first.order.id]]);
  assert.equal(rows.rows[0].n, 1, "只有最初成功那次");
  await tick();
  assert.equal(textsTo(email).length, 1);
  assert.equal((await activeLinks(conflicting.id)).length, 0);
});

// ---- 真正的并发 ----

test("并发：后台发信和改派同时跑，旧司机就算收到信也是死链接；有效链接全部属于新司机", async () => {
  for (let round = 0; round < 8; round += 1) {
    const oldEmail = newEmail();
    const newAddress = newEmail();
    const { order, res, vehicle } = await dispatched(a, "a", oldEmail);
    const second = await newDriver(api, a, { email: newAddress });
    const [, moved] = await Promise.all([tick(), assign(api, a, order.id, second.id, vehicle.id, { version: res.order.version })]);
    assert.equal(moved.status, 200, moved.text);
    await tick();
    for (const token of tokensTo(oldEmail)) assert.equal((await trip(token)).status, 401, `第 ${round} 轮：旧司机收到的链接必须打不开`);
    const active = await activeLinks(order.id);
    assert.ok(active.every((link) => link.driver_id === second.id), `第 ${round} 轮：有效链接都属于新司机`);
    assert.equal(tokensTo(newAddress).length, 1, `第 ${round} 轮：新司机收到一封`);
    assert.equal((await trip(tokensTo(newAddress)[0] as string)).status, 200);
  }
});

test("并发：后台发信和重新生成同时跑，发出去的只可能是死链接；调度员新链接可用；不自动再发", async () => {
  for (let round = 0; round < 8; round += 1) {
    const email = newEmail();
    const { order } = await dispatched(a, "a", email);
    const [, issued] = await Promise.all([tick(), api.call("POST", `/tenant/v1/orders/${order.id}/driver-link`, { token: a.adminToken })]);
    assert.equal(issued.status, 200, issued.text);
    await tick();
    for (const token of tokensTo(email)) assert.equal((await trip(token)).status, 401, `第 ${round} 轮：邮件里的是旧链接`);
    assert.equal((await trip(issued.body.driver_link.token)).status, 200);
    const active = await activeLinks(order.id);
    assert.deepEqual(active.map((link) => link.purpose), ["dispatcher"], `第 ${round} 轮：只剩调度员这一条`);
  }
});

test("并发：后台发信和改邮箱同时跑，旧地址收到的只可能是死链接；没有两条指向不同地址的有效邮件链接", async () => {
  for (let round = 0; round < 8; round += 1) {
    const oldEmail = newEmail();
    const nextEmail = newEmail();
    const { order, driver } = await dispatched(a, "a", oldEmail);
    const [, changed] = await Promise.all([tick(), putDriver(a, driver, { email: nextEmail })]);
    assert.equal(changed.status, 200, changed.text);
    await tick();
    for (const token of tokensTo(oldEmail)) assert.equal((await trip(token)).status, 401, `第 ${round} 轮：旧地址收到的链接必须打不开`);
    const activeEmail = (await activeLinks(order.id)).filter((link) => link.purpose === "email");
    assert.ok(activeEmail.length <= tokensTo(nextEmail).length, `第 ${round} 轮：有效的邮件链接只可能在新地址的信里`);
  }
});

/**
 * 改邮箱先按「现在派给他的单」锁单，再锁司机行。这中间才派给他的单没有被锁：后台任务可以在改邮箱提交前读到旧地址，等改邮箱吊销完才插入新链接。
 * 这里用锁把这个时序固定下来：改邮箱停在锁司机行 → 派车成功 → 后台任务读完司机后停住 → 改邮箱做完吊销并提交 → 后台任务继续。
 */
test("改邮箱和新派的单撞车：旧地址不能收到一条还能打开的链接", async () => {
  const oldEmail = newEmail();
  const nextEmail = newEmail();
  const driver = await newDriver(api, a, { email: oldEmail });
  const vehicle = await newVehicle(api, a, m.ids.biz7);
  const order = await seed("a", 96);

  const holdDriver = await api.db.owner.connect();
  const holdNames = await api.db.owner.connect();
  try {
    await holdDriver.query("begin");
    await holdDriver.query("select 1 from drivers where id = $1 for key share", [driver.id]);
    const change = putDriver(a, driver, { email: nextEmail });
    await untilBlocked("%from drivers d%for update%");

    const assigning = assign(api, a, order.id, driver.id, vehicle.id);
    await settled(assigning);

    await holdNames.query("begin");
    await holdNames.query("lock table vehicle_groups in access exclusive mode");
    const sending = tick();
    await untilBlocked("%vehicle_groups%");

    await holdDriver.query("commit");
    await settled(change);
    await holdNames.query("commit");
    const changed = await change;
    assert.equal(changed.status, 200, changed.text);
    assert.equal((await assigning).status, 200);
    await sending;
  } finally {
    await holdDriver.query("rollback").catch(() => undefined);
    await holdNames.query("rollback").catch(() => undefined);
    holdDriver.release();
    holdNames.release();
  }
  await tick();
  for (const token of tokensTo(oldEmail)) assert.equal((await trip(token)).status, 401, "旧地址收到的链接必须打不开（ADR 0058「旧地址最多收到一条打不开的链接」）");
});

// ---- 多位司机同一个邮箱 ----

test("两位司机同邮箱：改派后旧的打不开；改其中一位的邮箱不作废另一位的链接；各自只有自己那张单", async () => {
  const shared = newEmail();
  const one = await dispatched(a, "a", shared);
  const two = await dispatched(a, "a", shared);
  await tick();
  assert.equal(tokensTo(shared).length, 2, "同一个地址，各一封");
  const tokenOf = (orderNo: string): string => tokenIn(textsTo(shared).find((text) => text.includes(orderNo)) as string) as string;
  const tokenOne = tokenOf(one.order.orderNo);
  const tokenTwo = tokenOf(two.order.orderNo);

  await ok(putDriver(a, one.driver, { email: newEmail() }));
  assert.equal((await trip(tokenOne)).status, 401, "改了邮箱的这位，旧信作废");
  assert.equal((await trip(tokenTwo)).status, 200, "另一位没改，不受影响");

  const third = await newDriver(api, a, { email: shared });
  await ok(assign(api, a, two.order.id, third.id, two.vehicle.id, { version: two.res.order.version }));
  assert.equal((await trip(tokenTwo)).status, 401, "同一个地址也不能让旧链接续命");
  smtp.reset();
  await tick();
  const [fresh] = tokensTo(shared);
  assert.ok(fresh, "新司机（同一个地址）收到新链接");
  assert.notEqual(fresh, tokenTwo);
  assert.equal((await trip(fresh)).status, 200);
});

// ---- 救援 ----

test("救援转给别家：旧司机的两条链接都打不开，排队的信不发；新供应商派车后只有新司机收到；原供应商详情可读、不能重发", async () => {
  const serviceAt = new Date(api.clock.now().getTime() + 96 * HOUR).toISOString().replace(/\.\d{3}Z$/, "Z");
  const order = await flow.paidOrder({ serviceTime: serviceAt });
  const oldEmail = newEmail();
  const oldDriver = await newDriver(api, b, { email: oldEmail });
  const assigned = await ok(assign(api, b, order.id, oldDriver.id, (await newVehicle(api, b, m.ids.biz7)).id));
  await tick();
  const [oldMailToken] = tokensTo(oldEmail);
  assert.ok(oldMailToken);
  api.clock.advance(61_000);
  b.adminToken = await tenantLogin(api, m.b.adminEmail);
  assert.equal((await resend(order.id, b)).status, 202, "排一封，看救援后发不发");

  assert.equal((await api.call("POST", `/tenant/v1/orders/${order.id}/declare-unable`, { token: b.adminToken, body: { reason: "车辆故障，排不出车" } })).status, 200);
  const ops = await platformLogin(api, m.staff.operations.email);
  const offered = await api.call("POST", `/platform/v1/orders/${order.id}/rescue/offers`, { token: ops, body: { tenant_id: null } });
  assert.ok([200, 201].includes(offered.status), offered.text);
  a.adminToken = await tenantLogin(api, m.a.adminEmail);
  const pending = (await ok(api.call("GET", "/tenant/v1/rescue-offers?status=pending", { token: a.adminToken }))).items;
  const accept = await api.call("POST", `/tenant/v1/rescue-offers/${pending[0].id}/accept`, { token: a.adminToken, body: {} });
  assert.equal(accept.status, 200, accept.text);

  await tick();
  assert.equal(tokensTo(oldEmail).length, 1, "排队的信不发给旧司机");
  assert.equal((await trip(oldMailToken as string)).status, 401);
  assert.equal((await trip(assigned.driver_link.token)).status, 401);

  const oldSide = await detail(order.id, b);
  assert.equal(oldSide.driver_link_email.state, "no_link", "原供应商详情照常打开，没有有效链接");
  assert.equal((await resend(order.id, b)).status, 409, "原供应商不能重发");
  assert.equal((await api.call("POST", `/tenant/v1/orders/${order.id}/driver-link`, { token: b.adminToken })).status, 409, "原供应商不能重新生成");

  const newEmailAddress = newEmail();
  const newDriverRow = await newDriver(api, a, { email: newEmailAddress });
  const taken = await ok(assign(api, a, order.id, newDriverRow.id, (await newVehicle(api, a, m.ids.biz7)).id));
  assert.equal(taken.driver_link_email.state, "pending");
  await tick();
  assert.equal(tokensTo(oldEmail).length, 1, "旧司机没有再收到");
  const [fresh] = tokensTo(newEmailAddress);
  assert.ok(fresh);
  assert.equal((await trip(fresh)).status, 200);
  assert.equal((await trip(oldMailToken as string)).status, 401, "新供应商派车后旧链接也没有复活");
  assert.equal((await status(order.id, a)).state, "sent");
  const seenByOld = await api.call("GET", `/tenant/v1/orders/${order.id}/driver-link/email`, { token: b.adminToken });
  assert.equal(seenByOld.status, 200);
  assert.equal(seenByOld.body.driver_link_email.state, "no_link", "原供应商看不到新司机的发送状态");
  assert.equal(seenByOld.text.includes(newEmailAddress), false);
  const rowOwners = await api.db.owner.query("select tenant_id, count(*)::int as n from notifications where order_id = $1 and audience = 'driver' and status = 'sent' group by tenant_id", [order.id]);
  assert.deepEqual(rowOwners.rows.map((row) => row.tenant_id).sort(), [a.tenantId, b.tenantId].sort(), "两家的记录各归各家");
});

// ---- 真实的取消 ----

test("真实取消（走渠道接口）：排队的信不发；已发出的邮件链接不能再看到客人的姓名和电话", async () => {
  const serviceAt = new Date(api.clock.now().getTime() + 96 * HOUR).toISOString().replace(/\.\d{3}Z$/, "Z");
  const sentOrder = await flow.paidOrder({ serviceTime: serviceAt });
  const sentEmail = newEmail();
  const sentDriver = await newDriver(api, b, { email: sentEmail });
  await ok(assign(api, b, sentOrder.id, sentDriver.id, (await newVehicle(api, b, m.ids.biz7)).id));
  await tick();
  const [mailToken] = tokensTo(sentEmail);
  assert.ok(mailToken);

  const queuedOrder = await flow.paidOrder({ serviceTime: new Date(api.clock.now().getTime() + 144 * HOUR).toISOString().replace(/\.\d{3}Z$/, "Z") });
  const queuedEmail = newEmail();
  const queuedDriver = await newDriver(api, b, { email: queuedEmail });
  await ok(assign(api, b, queuedOrder.id, queuedDriver.id, (await newVehicle(api, b, m.ids.biz7)).id));

  for (const id of [sentOrder.id, queuedOrder.id]) {
    const cancelled = await api.call("POST", `/sales/v1/orders/${id}/cancel`, { token: await flow.token(), body: {} });
    assert.equal(cancelled.status, 200, cancelled.text);
  }
  await tick();
  assert.equal(tokensTo(queuedEmail).length, 0, "取消后排队的信不发");
  const queuedRows = await api.db.owner.query("select status, last_error_code from notifications where order_id = $1 and audience = 'driver' and event = 'order.driver_link'", [queuedOrder.id]);
  assert.deepEqual(queuedRows.rows.map((row) => [row.status, row.last_error_code]), [["expired", "ORDER_STATE_CHANGED"]]);
  assert.equal(smtp.messages.filter((message) => message.to.includes(queuedEmail)).length, 1, "只收到不带链接的取消通知（M4-29）");

  b.adminToken = await tenantLogin(api, m.b.adminEmail);
  assert.equal((await status(sentOrder.id, b)).can_resend, false);
  const opened = await trip(mailToken as string);
  const passengerSeen = opened.status === 200 && opened.body.order.passenger.phone !== null && opened.body.order.passenger.phone !== "";
  assert.equal(passengerSeen, false, `单已取消，邮箱里那条链接还能看到客人电话（status=${opened.status}）`);
});

// ---- 过期、改期 ----

test("过期边界：到期前一毫秒能打开，到期那一刻两条链接同时失效；到期那一刻排队的信不发，也不新生成链接", async () => {
  const email = newEmail();
  const { order, res } = await dispatched(a, "a", email, 30);
  await tick();
  const [mailToken] = tokensTo(email);
  const rows = await links(order.id);
  assert.equal(rows.length, 2);
  const expiresAt = new Date(rows[0].expires_at).getTime();
  assert.equal(new Date(rows[1].expires_at).getTime(), expiresAt, "两条有效期完全相同");

  api.clock.advance(expiresAt - 1 - api.clock.now().getTime());
  assert.equal((await trip(mailToken as string)).status, 200);
  assert.equal((await trip(res.driver_link.token)).status, 200);
  a.adminToken = await tenantLogin(api, m.a.adminEmail);
  assert.equal((await resend(order.id)).status, 202, "到期前最后一刻还能发起");

  api.clock.advance(1);
  assert.equal((await trip(mailToken as string)).status, 401);
  assert.equal((await trip(res.driver_link.token)).status, 401);
  const before = (await links(order.id)).length;
  await tick();
  assert.equal((await links(order.id)).length, before, "到期后不再生成新链接");
  assert.equal(tokensTo(email).length, 1, "到期那一刻不发");
  const last = (await api.db.owner.query("select status, last_error_code from notifications where order_id = $1 and audience = 'driver' order by created_at desc limit 1", [order.id])).rows[0];
  assert.deepEqual([last.status, last.last_error_code], ["expired", "DRIVER_LINK_REVOKED"]);
});

test("改期到更晚（走渠道接口，供应商同意后生效）：行程还没开始，司机手里的两条链接不能先失效", async () => {
  const serviceAt = api.clock.now().getTime() + 5 * DAY;
  const order = await flow.paidOrder({ serviceTime: new Date(serviceAt).toISOString().replace(/\.\d{3}Z$/, "Z") });
  const email = newEmail();
  const driver = await newDriver(api, b, { email });
  const assigned = await ok(assign(api, b, order.id, driver.id, (await newVehicle(api, b, m.ids.biz7)).id));
  await tick();
  const [mailToken] = tokensTo(email);

  const version = (await ok(api.call("GET", `/sales/v1/orders/${order.id}`, { token: await flow.token() }))).order.version;
  const later = new Date(Math.floor((serviceAt + 10 * DAY) / 60_000) * 60_000).toISOString();
  const changed = await api.call("PATCH", `/sales/v1/orders/${order.id}`, { token: await flow.token(), headers: { "if-match": `"${version}"` }, body: { service_time: later } });
  assert.equal(changed.status, 200, changed.text);
  assert.equal(changed.body.change.status, "pending_confirmation", "M4-29 起改期要供应商同意");
  await ok(api.call("POST", `/tenant/v1/orders/${order.id}/changes/${changed.body.change.id}/confirm`, { token: await tenantLogin(api, m.b.adminEmail), body: {} }));
  assert.equal((await ok(api.call("GET", `/sales/v1/orders/${order.id}`, { token: await flow.token() }))).order.service_time, later);
  const stillAssigned = (await detail(order.id, b)).order;
  assert.equal(stillAssigned.status, "assigned", "派车还在");

  api.clock.advance(serviceAt + 2 * DAY - api.clock.now().getTime());
  b.adminToken = await tenantLogin(api, m.b.adminEmail);
  assert.equal((await trip(assigned.driver_link.token)).status, 200, "调度员的链接：离新的用车时间还有 8 天，不该失效");
  assert.equal((await trip(mailToken as string)).status, 200, "邮件链接：离新的用车时间还有 8 天，不该失效");
});

// ---- withDriver 的核对 ----

test("邮件链接也走同样的核对：吊销后的写操作 401；令牌换租户 401；令牌被改一位 401；令牌解码不出来 401；应答完全一样", async () => {
  const email = newEmail();
  const { order, res } = await dispatched(a, "a", email);
  await tick();
  const [mailToken] = tokensTo(email);
  const token = mailToken as string;
  assert.equal((await trip(token)).status, 200);

  const tenantPart = token.slice("nzd_".length, token.indexOf("."));
  const swapped = token.replace(tenantPart, Buffer.from(b.tenantId.replaceAll("-", ""), "hex").toString("base64url"));
  const swappedPlain = token.replace(tenantPart, b.tenantId);
  const tampered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
  const bodies = new Set<string>();
  for (const bad of [swapped, swappedPlain, tampered, "nzd_x.y", `${token}x`]) {
    const seen = await trip(bad);
    assert.equal(seen.status, 401, bad === tampered ? "改一位" : "换租户");
    assert.equal(seen.body.error.code, "DRIVER_LINK_INVALID");
    bodies.add(seen.body.error.code + seen.body.error.message);
  }

  const departed = await api.call("POST", "/driver/v1/trip/events", { token, body: { type: "departed", location: null } });
  assert.equal(departed.status, 200, `有效的邮件链接能回传：${departed.text}`);

  assert.equal((await api.call("DELETE", `/tenant/v1/orders/${order.id}/driver-link`, { token: a.adminToken })).status, 204);
  const denied = await trip(token);
  assert.equal(denied.status, 401);
  bodies.add(denied.body.error.code + denied.body.error.message);
  assert.equal(bodies.size, 1, "不说是哪一种");
  for (const [method, path, body] of [
    ["POST", "/driver/v1/trip/events", { type: "arrived", location: null }],
    ["POST", "/driver/v1/trip/locations", { location: { lng: 139.7, lat: 35.6, accuracy_m: 5 } }],
    ["POST", "/driver/v1/trip/contacts", { method: "phone" }],
  ] as const) {
    const write = await api.call(method, path, { token, body });
    assert.equal(write.status, 401, `${path}：吊销后不能写`);
  }
  assert.equal((await trip(res.driver_link.token)).status, 401);
});

test("并发：邮件链接的写请求和改派同时到，不会有一个用旧链接写进新司机的单", async () => {
  for (let round = 0; round < 5; round += 1) {
    const email = newEmail();
    const { order, res, vehicle } = await dispatched(a, "a", email);
    await tick();
    const [token] = tokensTo(email);
    const second = await newDriver(api, a, { email: newEmail() });
    const [written, moved] = await Promise.all([
      api.call("POST", "/driver/v1/trip/contacts", { token: token as string, body: { method: "phone" } }),
      assign(api, a, order.id, second.id, vehicle.id, { version: res.order.version }),
    ]);
    assert.equal(moved.status, 200, moved.text);
    assert.ok([200, 201, 401, 409, 400].includes(written.status), written.text);
    assert.equal((await trip(token as string)).status, 401, `第 ${round} 轮：改派之后一定打不开`);
    await tick();
  }
});

// ---- currentDriverLink 和派车页 ----

test("currentDriverLink：邮件链接比调度员的新，详情里仍是调度员那条；多次重发只多邮件链接，调度员的一直只有一条且不变", async () => {
  const email = newEmail();
  const { order, res } = await dispatched(a, "a", email);
  const dispatcherId = (await detail(order.id)).records.driver_link.id;
  await tick();
  for (let index = 0; index < 2; index += 1) {
    api.clock.advance(61_000);
    a.adminToken = await tenantLogin(api, m.a.adminEmail);
    assert.equal((await resend(order.id)).status, 202);
    await tick();
  }
  const rows = await activeLinks(order.id);
  const dispatcherRows = rows.filter((link) => link.purpose === "dispatcher");
  assert.equal(dispatcherRows.length, 1, "调度员的一直只有一条");
  assert.equal(rows.filter((link) => link.purpose === "email").length, 3);
  assert.equal(dispatcherRows[0].id, dispatcherId, "重发不换调度员的链接");
  const shown = (await detail(order.id)).records.driver_link;
  assert.equal(shown.id, dispatcherId, "详情里是调度员那条，不是最新的邮件链接");
  assert.equal((await trip(res.driver_link.token)).status, 200, "调度员手里的链接不受发信影响");

  const reissued = await ok(api.call("POST", `/tenant/v1/orders/${order.id}/driver-link`, { token: a.adminToken }));
  const issueAudit = (await api.db.owner.query("select before from audit_logs where resource = 'driver_link' and action = 'issue' and before is not null and before ->> 'link_id' = $1", [dispatcherId])).rows;
  assert.equal(issueAudit.length, 1, "审计记的旧链接是调度员那条");
  for (const token of tokensTo(email)) assert.equal((await trip(token)).status, 401, "重新生成后所有旧邮件链接失效");
  assert.equal((await trip(res.driver_link.token)).status, 401);
  assert.equal((await trip(reissued.driver_link.token)).status, 200);
  assert.deepEqual((await activeLinks(order.id)).map((link) => link.purpose), ["dispatcher"]);
});

test("司机最近打开：只从调度员链接开 / 只从邮件开都算；改派后旧司机打开过的不算到新司机头上；重新生成后清零", async () => {
  const email = newEmail();
  const { order, res, vehicle } = await dispatched(a, "a", email);
  await tick();
  const [mailToken] = tokensTo(email);
  assert.equal((await detail(order.id)).records.driver_link.last_used_at, null, "发了信但没人打开，不能显示打开过");

  api.clock.advance(5_000);
  await ok(trip(mailToken as string));
  const openedByMail = api.clock.now().toISOString();
  assert.equal((await detail(order.id)).records.driver_link.last_used_at, openedByMail, "从邮件打开算打开");

  api.clock.advance(5_000);
  await ok(trip(res.driver_link.token));
  const openedByCopy = api.clock.now().toISOString();
  assert.equal((await detail(order.id)).records.driver_link.last_used_at, openedByCopy, "取最晚的一次");

  const secondEmail = newEmail();
  const second = await newDriver(api, a, { email: secondEmail });
  const moved = await ok(assign(api, a, order.id, second.id, vehicle.id, { version: res.order.version }));
  assert.equal((await detail(order.id)).records.driver_link.last_used_at, null, "旧司机打开过，不算新司机打开");
  await tick();
  assert.equal((await detail(order.id)).records.driver_link.last_used_at, null, "新司机还没打开");
  await ok(trip(tokensTo(secondEmail)[0] as string));
  assert.ok((await detail(order.id)).records.driver_link.last_used_at);

  await ok(api.call("POST", `/tenant/v1/orders/${order.id}/driver-link`, { token: a.adminToken }));
  assert.equal((await detail(order.id)).records.driver_link.last_used_at, null, "重新生成后是一条新链接");
  assert.equal(moved.change, true);
});

test("吊销：邮件链接比调度员的新也一起吊销；吊销第二次 404；吊销后详情没有当前链接；没有残留的有效行", async () => {
  const email = newEmail();
  const { order } = await dispatched(a, "a", email);
  await tick();
  assert.equal((await api.call("DELETE", `/tenant/v1/orders/${order.id}/driver-link`, { token: a.adminToken })).status, 204);
  assert.equal((await activeLinks(order.id)).length, 0);
  assert.equal((await detail(order.id)).records.driver_link, null);
  assert.equal((await api.call("DELETE", `/tenant/v1/orders/${order.id}/driver-link`, { token: a.adminToken })).status, 404);
  const reasons = new Set((await links(order.id)).map((link) => link.revoke_reason));
  assert.deepEqual([...reasons], ["manual"], "两种链接记同一个原因");
});

// ---- 发送状态：改回原地址 ----

test("改邮箱再改回原地址：之前那封里的链接已作废，状态不能显示「已发送」（否则调度员不会点重发，司机手里是死链接）", async () => {
  const email = newEmail();
  const { order, driver } = await dispatched(a, "a", email);
  await tick();
  const [token] = tokensTo(email);
  assert.equal((await status(order.id)).state, "sent");
  const changed = await ok(putDriver(a, driver, { email: newEmail() }));
  assert.equal((await trip(token as string)).status, 401);
  assert.equal((await status(order.id)).state, "not_sent");
  await ok(putDriver(a, changed, { email }));
  assert.equal((await trip(token as string)).status, 401, "改回去也不复活");
  const after = await status(order.id);
  assert.notEqual(after.state, "sent", "信里的链接已作废，状态却还是「已发送」");
});

test("改邮箱大小写和首尾空格：不算改地址，邮件链接不作废", async () => {
  const email = newEmail();
  const { driver } = await dispatched(a, "a", email);
  await tick();
  const [token] = tokensTo(email);
  const updated = await ok(putDriver(a, driver, { email: `  ${email.toUpperCase()}  ` }));
  assert.equal(updated.email, email);
  assert.equal((await trip(token as string)).status, 200);
});

test("改邮箱时版本号不对：409，地址不变，邮件链接不作废", async () => {
  const email = newEmail();
  const { driver } = await dispatched(a, "a", email);
  await tick();
  const [token] = tokensTo(email);
  const stale = await putDriver(a, { ...driver, version: driver.version + 5 }, { email: newEmail() });
  assert.equal(stale.status, 409, stale.text);
  assert.equal((await trip(token as string)).status, 200);
  assert.equal((await ok(api.call("GET", `/tenant/v1/drivers/${driver.id}`, { token: a.adminToken }))).email, email);
});

test("已结束的单改邮箱：完成的单上的邮件链接也作废（发到了填错的地址，客人信息不能继续可见）", async () => {
  const email = newEmail();
  const { order, driver } = await dispatched(a, "a", email);
  await tick();
  const [token] = tokensTo(email);
  await api.db.owner.query("update orders set status = 'completed' where id = $1", [order.id]);
  assert.equal((await trip(token as string)).status, 200, "用车后 24 小时内还能打开");
  await ok(putDriver(a, driver, { email: newEmail() }));
  assert.equal((await trip(token as string)).status, 401);
});

test("司机停用：重发不发信，记 DRIVER_DISABLED；恢复后不补发", async () => {
  const email = newEmail();
  const { order, driver } = await dispatched(a, "a", email);
  await tick();
  const disabled = await ok(api.call("DELETE", `/tenant/v1/drivers/${driver.id}`, { token: a.adminToken }));
  api.clock.advance(61_000);
  a.adminToken = await tenantLogin(api, m.a.adminEmail);
  const res = await resend(order.id);
  if (res.status === 202) {
    await tick();
    assert.equal(tokensTo(email).length, 1, "停用后不发");
    const latest = (await api.db.owner.query("select last_error_code from notifications where order_id = $1 and audience = 'driver' order by created_at desc limit 1", [order.id])).rows[0];
    assert.equal(latest.last_error_code, "DRIVER_DISABLED");
  } else assert.equal(res.status, 409, res.text);
  await ok(putDriver(a, disabled, { status: "active" }));
  await tick();
  assert.equal(tokensTo(email).length, 1, "恢复在职不补发");
});
