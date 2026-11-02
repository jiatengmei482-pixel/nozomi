/**
 * M4-29 测试角色：确认前按原时间、通知完整性、残留的申请和待办、时间边界、被拒后的取消（ADR 0060 + 业主要求）。
 * 真实 PostgreSQL + 本机假 SMTP。默认取消政策（商务 7 座：≥48 小时免费，24–48 小时扣 50%，<24 小时扣 100%）。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { DAY, HOUR, MINUTE, SELL, type GuestSite, type World, buildGuestSite, buildWorld, decodedMailText, fictionalEmail, iso, resetBetweenTests, tokenInMail, tokyoDate } from "./testing/change-approval-qa.ts";
import { assign, newDriver, newVehicle } from "./testing/dispatch.ts";
import { addStaff, ok } from "./testing/market.ts";
import { platformLogin } from "./testing/money.ts";

let w: World;
let site: GuestSite;
before(async () => {
  w = await buildWorld();
  site = await buildGuestSite(w);
});
after(async () => {
  await site.api.close();
  await w.close();
});
beforeEach(async () => {
  await resetBetweenTests(w);
});

const moveTo = (at: number): void => w.api.clock.advance(at - w.api.clock.now().getTime());
const tenantOrder = async (id: string): Promise<any> => (await ok(w.api.call("GET", `/tenant/v1/orders/${id}`, { token: w.b.adminToken }))).order;
const linkExpiries = async (orderId: string): Promise<number[]> => (await w.api.db.owner.query("select expires_at from driver_links where order_id = $1 and revoked_at is null", [orderId])).rows.map((row) => row.expires_at.getTime());
const exceptions = async (orderId: string): Promise<any[]> => (await w.api.db.owner.query("select status, close_kind from order_exceptions where order_id = $1 and type = 'change_unconfirmed'", [orderId])).rows;

// ---- 确认前按原时间 ----

test("确认前：订单、派车截止、司机页、链接有效期都按原时间；拒绝不动；同意才跟到新时间（延后和提前都重算）", async () => {
  const oldAt = w.freshDay();
  const later = oldAt + 2 * DAY;
  const { order, token } = await w.dispatched(oldAt);
  const beforeLinks = await linkExpiries(order.id);
  const beforeDue = (await tenantOrder(order.id)).dispatch.due_at;

  const change = (await w.patch(order.id, { service_time: iso(later) })).body.change;
  const page = await ok(w.api.call("GET", "/driver/v1/trip", { token }));
  assert.equal(page.order.service_time, new Date(oldAt).toISOString(), "司机页按原时间");
  assert.deepEqual(page.pending_change, { fields: ["service_time"] }, "只有字段名，没有新的值");
  assert.deepEqual(await linkExpiries(order.id), beforeLinks, "待确认不动有效期");
  assert.equal((await tenantOrder(order.id)).dispatch.due_at, beforeDue, "待确认不动派车截止");

  await ok(w.tenantDecide(order.id, change.id, "reject", { note: "排不出车" }));
  assert.deepEqual(await linkExpiries(order.id), beforeLinks, "拒绝不动");

  const again = (await w.patch(order.id, { service_time: iso(later) })).body.change;
  await ok(w.tenantDecide(order.id, again.id, "confirm"));
  for (const expiry of await linkExpiries(order.id)) assert.equal(expiry - beforeLinks[0]!, later - oldAt, "延后：所有链接跟着延长");

  const earlier = later - 3 * DAY;
  const back = (await w.patch(order.id, { service_time: iso(earlier) })).body.change;
  await ok(w.tenantDecide(order.id, back.id, "confirm"));
  for (const expiry of await linkExpiries(order.id)) assert.equal(expiry - beforeLinks[0]!, earlier - oldAt, "提前：同样重算");
});

test("确认前救援按原时间：没派车的单申请改到后面，到原时间前 6 小时照样进救援；申请作废、差价退回。同意改到后面的单，原时间不再触发", async () => {
  const oldAt = w.freshDay();
  const newAt = oldAt + 2 * DAY;
  await w.surge(tokyoDate(newAt));
  const pending = await w.flow.paidOrder({ serviceTime: iso(oldAt) });
  const res = await w.patch(pending.id, { service_time: iso(newAt) });
  assert.equal(res.body.change.status, "pending_confirmation");
  const movedOrder = await w.flow.paidOrder({ serviceTime: iso(oldAt + HOUR) });
  const moved = (await w.patch(movedOrder.id, { service_time: iso(newAt + HOUR) })).body.change;
  await ok(w.tenantDecide(movedOrder.id, moved.id, "confirm"));

  // 进 24 小时后 30 分钟申请先失效：把时间拨到那之前的一刻，让申请还在（期限前运营标了调整中也一样）
  await w.api.db.owner.query("update order_changes set confirm_due_at = $2 where id = $1", [res.body.change.id, new Date(oldAt + DAY)]);
  moveTo(oldAt - 5 * HOUR);
  await w.relogin();
  const swept = await w.api.app.orderJobs.rescue();
  assert.ok(swept.dispatchOverdue >= 1, JSON.stringify(swept));
  const seen = await w.salesGet(pending.id);
  assert.deepEqual([seen.status, seen.changes[0].status], ["rescue_pending", "cancelled"]);
  assert.equal(w.net(pending.id), SELL, "差价退回");
  assert.deepEqual((await w.todosOf(pending.id)).map((item) => item.kind), ["rescue_started"]);
  assert.equal((await w.salesGet(movedOrder.id)).status, "confirmed", "同意改到后面的单不按原时间救援");
});

test("确认前提醒按原时间：官网单 24 小时提醒在原时间前发（内容是原时间）；同意后按新时间再提醒一次，原时间那条不再发", async () => {
  const oldAt = w.freshDay();
  const newAt = oldAt + 2 * DAY;
  const email = `fictional.reminder.${crypto.randomUUID().slice(0, 8)}@example.test`;
  const placed = await site.place(oldAt, email);
  const res = await site.patch(placed.token, placed.ip, { service_time: iso(newAt) });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.change.status, "pending_confirmation");
  moveTo(oldAt - 24 * HOUR + MINUTE);
  await w.relogin();
  await site.api.app.notificationJobs.tick();
  await site.api.app.notificationJobs.tick();
  const reminded = w.mailsTo(email).map((mail) => decodedMailText(mail.data)).filter((text) => text.includes("用车时间快到了"));
  assert.equal(reminded.length, 1, "原时间前 24 小时提醒");
  assert.ok(reminded[0]?.includes(new Date(oldAt + 9 * HOUR).toISOString().slice(0, 10)), "写的是原来的日期");

  await ok(w.tenantDecide(placed.order.id, res.body.change.id, "confirm"));
  w.smtp.reset();
  moveTo(newAt - 24 * HOUR + MINUTE);
  await site.api.app.notificationJobs.tick();
  await site.api.app.notificationJobs.tick();
  const afterMove = w.mailsTo(email).map((mail) => decodedMailText(mail.data)).filter((text) => text.includes("用车时间快到了"));
  assert.equal(afterMove.length, 1, "按新时间提醒");
  assert.ok(afterMove[0]?.includes(new Date(newAt + 9 * HOUR).toISOString().slice(0, 10)));
});

// ---- 通知完整性 ----

test("通知矩阵：申请 / 同意 / 拒绝 / 超时 / 取消，每种事件在发件箱正好一条，定时任务重复跑不重发，司机只收到该收的", async () => {
  const smtpCount = (email: string, pattern: RegExp): number => w.mailsTo(email).filter((mail) => pattern.test(decodedMailText(mail.data))).length;
  const run3 = async (): Promise<void> => {
    for (let i = 0; i < 3; i += 1) await w.tick();
  };
  const email1 = await w.dispatched();
  const applied = (await w.patch(email1.order.id, { passengers: 3 })).body.change;
  await run3();
  assert.equal(smtpCount(email1.email, /调度正在确认/), 1, "司机：申请一封");
  await ok(w.tenantDecide(email1.order.id, applied.id, "confirm"));
  await run3();
  assert.equal(smtpCount(email1.email, /任务有更新/), 1, "司机：同意一封");
  assert.deepEqual(await w.events(email1.order.id, "order.change%"), { "order.change_pending": 1, "order.changed": 1 });
  const adminMails = w.mailsTo(w.m.b.adminEmail).map((mail) => decodedMailText(mail.data));
  assert.equal(adminMails.filter((text) => text.includes("客人申请修改订单")).length, 1, "供应商：申请一封");
  assert.equal(adminMails.filter((text) => text.includes("这张订单有修改")).length, 1, "供应商：同意一封");

  w.smtp.reset();
  const rejected = await w.dispatched();
  const change = (await w.patch(rejected.order.id, { passengers: 3 })).body.change;
  await ok(w.tenantDecide(rejected.order.id, change.id, "reject", { note: "排不出车" }));
  await run3();
  assert.equal(smtpCount(rejected.email, /调度正在确认/), 0, "还没发就有结论了，不再发等确认那封");
  assert.equal(smtpCount(rejected.email, /没有通过/), 1);

  w.smtp.reset();
  const cancelled = await w.dispatched();
  await ok(w.salesCancel(cancelled.order.id));
  await run3();
  assert.equal(smtpCount(cancelled.email, /任务已取消/), 1);
  assert.equal(w.mailsTo(w.m.b.adminEmail).filter((mail) => /这张订单已取消/.test(decodedMailText(mail.data))).length, 1);
  assert.deepEqual((await w.notificationRows(cancelled.order.id, "driver", "order.driver_cancelled")).map((row) => row.status), ["sent"]);
});

test("免费窗口内的修改和取消也立即通知；免打扰时段不拦供应商，也不拦司机", async () => {
  const oldAt = w.freshDay();
  const { order, email } = await w.dispatched(oldAt);
  const local = new Date(w.api.clock.now().getTime() + 9 * HOUR);
  const pad = (n: number): string => String(n).padStart(2, "0");
  await w.api.db.owner.query("insert into tenant_notification_settings (tenant_id, quiet_start, quiet_end, updated_at) values ($1, $2, $3, now()) on conflict (tenant_id) do update set quiet_start = $2, quiet_end = $3", [w.b.tenantId, `${pad(local.getUTCHours())}:00`, `${pad((local.getUTCHours() + 4) % 24)}:00`]);
  await w.patch(order.id, { notes: "带婴儿车" });
  await w.tick();
  assert.match(w.texts(w.mailsTo(w.m.b.adminEmail)), /这张订单有修改/);
  assert.match(w.texts(w.mailsTo(email)), /任务有更新/);
  w.smtp.reset();
  const change = (await w.patch(order.id, { passengers: 3 })).body.change;
  await w.tick();
  assert.match(w.texts(w.mailsTo(w.m.b.adminEmail)), /客人申请修改订单/);
  assert.match(w.texts(w.mailsTo(email)), /调度正在确认/);
  assert.equal(change.status, "pending_confirmation");
  w.smtp.reset();
  await ok(w.salesCancel(order.id));
  await w.tick();
  assert.match(w.texts(w.mailsTo(w.m.b.adminEmail)), /这张订单已取消/);
  assert.match(w.texts(w.mailsTo(email)), /任务已取消/);
});

test("取消入口逐个核对：运营代取消免收费（双人复核批准后）、司机已出发和已到达时取消，都通知供应商和司机，待办在，链接作废", async () => {
  const reviewer = await addStaff(w.api, await platformLogin(w.api, "root@platform.test"), `qa.review.${crypto.randomUUID().slice(0, 8)}@platform.test`, "operations");
  const waived = await w.dispatched();
  // 进收费档才算「多退」
  moveTo(Date.parse(waived.order.service_time) - 36 * HOUR);
  await w.relogin();
  const waiver = await ok(w.api.call("POST", `/platform/v1/orders/${waived.order.id}/cancel`, { token: await w.ops(), body: { reason: "GUEST_REQUEST", waive_fee: true, note: "客人家里有事" } }), 202);
  assert.equal(waiver.approval.status, "pending");
  assert.deepEqual(await w.events(waived.order.id, "order.%cancelled"), {}, "批准前不算取消");
  await ok(w.api.call("POST", `/platform/v1/approvals/${waiver.approval.id}/approve`, { token: await platformLogin(w.api, reviewer.email), body: {} }));
  await w.relogin();
  await w.tick();
  assert.deepEqual(await w.events(waived.order.id, "order.%cancelled"), { "order.cancelled": 1, "order.driver_cancelled": 1 });
  assert.match(w.texts(w.mailsTo(waived.email)), /任务已取消/);
  assert.equal((await w.api.call("GET", "/driver/v1/trip", { token: waived.token })).status, 401);

  w.smtp.reset();
  for (const stage of ["departed", "arrived"] as const) {
    const onRoad = await w.dispatched();
    await ok(w.api.call("POST", `/tenant/v1/orders/${onRoad.order.id}/events`, { token: w.b.adminToken, body: { type: "departed" } }));
    if (stage === "arrived") await ok(w.api.call("POST", `/tenant/v1/orders/${onRoad.order.id}/events`, { token: w.b.adminToken, body: { type: "arrived" } }));
    await ok(w.salesCancel(onRoad.order.id));
    await w.tick();
    assert.match(w.texts(w.mailsTo(onRoad.email)), /任务已取消/, stage);
    assert.deepEqual((await w.todosOf(onRoad.order.id)).map((item) => [item.kind, item.needs_driver_adjustment]), [["order_cancelled", true]], stage);
  }
});

test("司机发信失败会重试：取消的那封邮件服务器临时不可用，下一轮补发，不重复", async () => {
  const { order, email } = await w.dispatched();
  await ok(w.salesCancel(order.id));
  w.smtp.behave({ rejectAt: { stage: "DOT", reply: "451 4.3.0 try later" } });
  await w.tick();
  w.smtp.reset();
  w.api.clock.advance(5 * MINUTE);
  await w.tick();
  await w.tick();
  assert.equal(w.mailsTo(email).filter((mail) => /任务已取消/.test(decodedMailText(mail.data))).length, 1);
});

test("手动模式和没邮箱：取消和拒绝都不发司机，供应商邮件写明要自己联系；司机停用不发", async () => {
  const noEmail = await w.dispatched(w.freshDay(), {});
  await ok(w.salesCancel(noEmail.order.id));
  await w.tick();
  assert.match(w.texts(w.mailsTo(w.m.b.adminEmail)), /没有邮箱/);
  assert.deepEqual((await w.notificationRows(noEmail.order.id, "driver", "order.driver_cancelled")), []);

  w.smtp.reset();
  const manual = await w.dispatched();
  await w.api.db.owner.query("update tenant_notification_settings set driver_link_delivery = 'manual' where tenant_id = $1", [w.b.tenantId]);
  await ok(w.salesCancel(manual.order.id));
  await w.tick();
  assert.equal(w.mailsTo(manual.email).length, 0);
  assert.match(w.texts(w.mailsTo(w.m.b.adminEmail)), /手动发送/);
  await w.api.db.owner.query("update tenant_notification_settings set driver_link_delivery = 'auto' where tenant_id = $1", [w.b.tenantId]);

  w.smtp.reset();
  const disabled = await w.dispatched();
  await w.api.db.owner.query("update drivers set status = 'disabled' where id = $1", [disabled.driver.id]);
  await ok(w.salesCancel(disabled.order.id));
  await w.tick();
  assert.equal(w.mailsTo(disabled.email).length, 0);
});

test("客人（官网单）：提交申请时订单不变、状态可见；同意收到结果邮件；被拒收到结果邮件，文案符合实际（普通修改 / 只改航班号各一句）", async () => {
  const email = `fictional.guest.${crypto.randomUUID().slice(0, 8)}@example.test`;
  const placed = await site.place(w.freshDay(), email);
  await site.api.app.notificationJobs.tick();
  w.smtp.reset();
  const res = await site.patch(placed.token, placed.ip, { passengers: 3 });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual([res.body.change.status, res.body.order.passengers], ["pending_confirmation", 2]);
  await site.api.app.notificationJobs.tick();
  assert.equal(w.mailsTo(email).length, 0, "提交申请不发结果邮件");

  await ok(w.tenantDecide(placed.order.id, res.body.change.id, "reject", { note: "排不出车" }));
  await site.api.app.notificationJobs.tick();
  const declined = w.texts(w.mailsTo(email));
  assert.match(declined, /没有得到确认/);
  assert.match(declined, /人数/);
  assert.ok(!declined.includes("排不出车"), "拒绝原因不给客人");

  w.smtp.reset();
  const flight = await site.patch(placed.token, placed.ip, { flight_no: "JL5" });
  await ok(w.tenantDecide(placed.order.id, flight.body.change.id, "reject", { note: "接不了" }));
  await site.api.app.notificationJobs.tick();
  const flightDeclined = w.texts(w.mailsTo(email));
  assert.match(flightDeclined, /按取消政策/);
  assert.doesNotMatch(flightDeclined, /免费取消/, "只改航班号的不说可以免费取消");

  w.smtp.reset();
  const again = await site.patch(placed.token, placed.ip, { luggage: 3 });
  await ok(w.tenantDecide(placed.order.id, again.body.change.id, "confirm"));
  await site.api.app.notificationJobs.tick();
  assert.match(w.texts(w.mailsTo(email)), /行李/);
  assert.equal((await site.get(placed.token, placed.ip)).order.luggage, 3);
});

// ---- 残留 ----

test("待确认时取消：申请、要决定的待办、异常提醒、列表标记都不留", async () => {
  const { order } = await w.dispatched();
  const change = (await w.patch(order.id, { passengers: 3 })).body.change;
  w.api.clock.advance(5 * HOUR);
  await w.api.app.orderJobs.exceptions();
  assert.deepEqual((await exceptions(order.id)).map((row) => row.status), ["open"]);
  await w.relogin();
  await ok(w.salesCancel(order.id));
  await w.api.app.orderJobs.exceptions();
  assert.deepEqual((await exceptions(order.id)).map((row) => [row.status, row.close_kind]), [["closed", "cleared"]]);
  const list = await ok(w.api.call("GET", "/tenant/v1/orders?change=pending", { token: w.b.adminToken }));
  assert.ok(!list.items.some((item: any) => item.id === order.id));
  assert.equal((await tenantOrder(order.id)).pending_change, false);
  assert.equal((await w.tenantDecide(order.id, change.id, "confirm")).status, 409);
  assert.ok(!(await w.todosOf(order.id)).some((item) => item.kind === "change_request"));
});

test("缺陷：单已取消后，之前留下的「联系信息有修改」「修改已生效（需调整司机）」待办还在，首页让供应商去调整一张已取消的单", async () => {
  const { order } = await w.dispatched();
  await w.patch(order.id, { notes: "带婴儿车" });
  const change = (await w.patch(order.id, { passengers: 3 })).body.change;
  await ok(w.tenantDecide(order.id, change.id, "confirm"));
  assert.deepEqual((await w.todosOf(order.id)).map((item) => item.kind).sort(), ["change_applied", "contact_changed"]);
  await ok(w.salesCancel(order.id));
  assert.deepEqual((await w.todosOf(order.id)).map((item) => item.kind), ["order_cancelled"], "取消之后只该留「订单已取消」");
});

test("缺陷：单进了救援改派后，之前留下的修改待办还写着需调整司机", async () => {
  const { order } = await w.dispatched();
  const change = (await w.patch(order.id, { passengers: 3 })).body.change;
  await ok(w.tenantDecide(order.id, change.id, "confirm"));
  await ok(w.api.call("POST", `/tenant/v1/orders/${order.id}/declare-unable`, { token: w.b.adminToken, body: { reason: "车坏了" } }));
  assert.deepEqual((await w.todosOf(order.id)).map((item) => item.kind), ["rescue_started"]);
});

test("服务开始、完成：没结论的航班号申请被定时任务记为没确认，要决定的待办关掉，运营提醒关闭；完成后同意 409", async () => {
  const { order } = await w.dispatched();
  const change = (await w.patch(order.id, { flight_no: "JL5" })).body.change;
  for (const type of ["departed", "arrived", "picked_up"]) await ok(w.api.call("POST", `/tenant/v1/orders/${order.id}/events`, { token: w.b.adminToken, body: { type } }));
  assert.equal((await w.tenantDecide(order.id, change.id, "confirm")).body.error.code, "ORDER_STATE_INVALID");
  await w.api.app.orderJobs.money();
  const seen = await w.salesGet(order.id);
  assert.deepEqual([seen.changes[0].status, seen.flight_no], ["expired", "NH211"]);
  assert.ok(!(await w.todosOf(order.id)).some((item) => item.kind === "change_request"));
  const list = await ok(w.api.call("GET", "/tenant/v1/orders?change=pending", { token: w.b.adminToken }));
  assert.ok(!list.items.some((item: any) => item.id === order.id));
});

test("缺陷：服务已开始时，航班号申请被记为没确认，客人结果邮件还建议「在订单页取消」——这时已经取消不了", async () => {
  const email = `fictional.guest.${crypto.randomUUID().slice(0, 8)}@example.test`;
  const placed = await site.place(w.freshDay(), email);
  const driver = await newDriver(w.api, w.b, { email: fictionalEmail() });
  const vehicle = await newVehicle(w.api, w.b, w.m.ids.biz7);
  await ok(assign(w.api, w.b, placed.order.id, driver.id, vehicle.id));
  await ok(w.api.call("POST", `/tenant/v1/orders/${placed.order.id}/events`, { token: w.b.adminToken, body: { type: "departed" } }));
  const res = await site.patch(placed.token, placed.ip, { flight_no: "JL5" });
  assert.equal(res.body.change?.status, "pending_confirmation", res.text);
  for (const type of ["arrived", "picked_up"]) await ok(w.api.call("POST", `/tenant/v1/orders/${placed.order.id}/events`, { token: w.b.adminToken, body: { type } }));
  await site.api.app.notificationJobs.tick();
  w.smtp.reset();
  await w.api.app.orderJobs.money();
  await site.api.app.notificationJobs.tick();
  assert.equal((await site.api.call("POST", "/site/v1/order/cancel", { token: placed.token, ip: placed.ip, body: {} })).status, 409, "服务开始后确实取消不了");
  assert.doesNotMatch(w.texts(w.mailsTo(email)), /取消/, "不能建议客人去做做不到的事");
});

// ---- 被拒后的取消（业主第 4 条：被拒保留原单，告知可按现有取消政策处理） ----

test("只改航班号被拒：不给免费取消，按阶梯扣；试算、订单字段、实际扣款三者一致", async () => {
  const oldAt = w.freshDay();
  const { order } = await w.dispatched(oldAt);
  moveTo(oldAt - 12 * HOUR);
  await w.relogin();
  const res = await w.patch(order.id, { flight_no: "JL5", passenger: { name: "李虚构", phone: "+81 80-1111-2222", email: "changed@example.test" } });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.change.status, "pending_confirmation", "出了免费取消期航班号还能提");
  assert.equal(res.body.order.passenger.name, "李虚构", "联系信息直接生效");
  await ok(w.tenantDecide(order.id, res.body.change.id, "reject", { note: "接不了" }));
  const seen = await w.salesGet(order.id);
  assert.equal(seen.free_cancel_available, false);
  assert.equal((await w.salesCancel(order.id, { reason: "CHANGE_NOT_CONFIRMED" })).body.error.code, "FREE_CANCEL_NOT_APPLICABLE");
  const fee = await ok(w.api.call("GET", `/sales/v1/orders/${order.id}/cancel-fee`, { token: await w.flow.token() }));
  assert.equal(fee.fee.amount, String(SELL), "<24 小时扣 100%");
  await ok(w.salesCancel(order.id));
  assert.equal(w.net(order.id), SELL, "客人被扣全额");
  const row = (await w.api.db.owner.query("select cancel_tenant_share_minor from orders where id = $1", [order.id])).rows[0];
  assert.ok(Number(row.cancel_tenant_share_minor) > 0, "供应商拿到它的份额");
});

test("只改航班号超时：同样不给免费取消", async () => {
  const oldAt = w.freshDay();
  const { order } = await w.dispatched(oldAt);
  moveTo(oldAt - 12 * HOUR);
  await w.relogin();
  const res = await w.patch(order.id, { flight_no: "JL5" });
  moveTo(Date.parse(res.body.change.confirm_due_at));
  await w.api.app.orderJobs.money();
  const seen = await w.salesGet(order.id);
  assert.deepEqual([seen.changes[0].status, seen.free_cancel_available], ["expired", false]);
});

test("航班号 + 人数一起提（免费期内）被拒：有非航班号的履约字段，可以免费取消；同一张单之后同意过别的修改，免费取消就没了", async () => {
  const { order } = await w.dispatched();
  const mixed = (await w.patch(order.id, { flight_no: "JL5", passengers: 3 })).body.change;
  await ok(w.tenantDecide(order.id, mixed.id, "reject", { note: "接不了" }));
  assert.equal((await w.salesGet(order.id)).free_cancel_available, true);
  const applied = (await w.patch(order.id, { luggage: 3 })).body.change;
  assert.equal((await w.salesGet(order.id)).free_cancel_available, false, "新的申请没结论时不算");
  await ok(w.tenantDecide(order.id, applied.id, "confirm"));
  assert.equal((await w.salesGet(order.id)).free_cancel_available, false, "最近一次修改生效了");
});

test("缺陷（业主第 4 条）：提前几天的普通修改被拒，客人一直到用车前都能「免费取消」——业主要求是按现有取消政策，供应商一分钱拿不到", async () => {
  const oldAt = w.freshDay();
  const { order } = await w.dispatched(oldAt);
  const change = (await w.patch(order.id, { passengers: 3 })).body.change;
  await ok(w.tenantDecide(order.id, change.id, "reject", { note: "排不出车" }));
  moveTo(oldAt - 2 * HOUR);
  await w.relogin();
  const seen = await w.salesGet(order.id);
  assert.equal(seen.free_cancel_available, false, "离用车 2 小时（阶梯 100%）不该因为几天前被拒的申请免费");
  const res = await w.salesCancel(order.id, { reason: "CHANGE_NOT_CONFIRMED" });
  assert.equal(res.status, 409, res.text);
});

test("缺陷（业主第 4 条）：客人提一个人数申请、供应商到期没回（远期不失效，到 T-23.5 小时才失效），之后可以全额免费取消，绕开 24–48 小时 50% 和 <24 小时 100%", async () => {
  const oldAt = w.freshDay();
  const { order } = await w.dispatched(oldAt);
  moveTo(oldAt - 49 * HOUR);
  await w.relogin();
  const change = (await w.patch(order.id, { passengers: 3 })).body.change;
  assert.equal(change.status, "pending_confirmation");
  moveTo(Date.parse(change.confirm_due_at));
  await w.api.app.orderJobs.money();
  assert.equal((await w.salesGet(order.id)).changes[0].status, "expired");
  const res = await w.salesCancel(order.id, { reason: "CHANGE_NOT_CONFIRMED" });
  assert.equal(res.status, 409, `T-23.5 小时阶梯是 100%，不该免费。实际：${res.text}`);
});

test("缺陷：司机已经到达现场时，用几天前被拒的申请仍能免费取消，供应商份额 0", async () => {
  const oldAt = w.freshDay();
  const { order } = await w.dispatched(oldAt);
  const change = (await w.patch(order.id, { passengers: 3 })).body.change;
  await ok(w.tenantDecide(order.id, change.id, "reject", { note: "排不出车" }));
  moveTo(oldAt - 10 * MINUTE);
  await w.relogin();
  for (const type of ["departed", "arrived"]) await ok(w.api.call("POST", `/tenant/v1/orders/${order.id}/events`, { token: w.b.adminToken, body: { type } }));
  const res = await w.salesCancel(order.id, { reason: "CHANGE_NOT_CONFIRMED" });
  assert.equal(res.status, 409, `司机已到达不能免费取消。实际：${res.text}`);
});

test("缺陷：司机出发后系统把没结论的改时间申请记为「没确认」，客人马上能免费取消——不是供应商不处理，而是司机已经在路上", async () => {
  const oldAt = w.freshDay();
  const newAt = oldAt + DAY;
  const { order } = await w.dispatched(oldAt);
  const change = (await w.patch(order.id, { service_time: iso(newAt) })).body.change;
  await ok(w.api.call("POST", `/tenant/v1/orders/${order.id}/events`, { token: w.b.adminToken, body: { type: "departed" } }));
  await w.api.app.orderJobs.money();
  const seen = await w.salesGet(order.id);
  assert.equal(seen.changes.find((item: any) => item.id === change.id).status, "expired");
  assert.equal(seen.free_cancel_available, false, "司机已经出发");
});

// ---- 时间边界 ----

test("期限边界：提出时离用车正好 24 小时算 30 分钟；多 1 毫秒算「进 24 小时后 30 分钟」；改到 10 分钟后的不晚于新时间", async () => {
  const oldAt = w.freshDay();
  const exact = await w.dispatched(oldAt);
  const justOver = await w.dispatched(oldAt + 2 * HOUR);
  // 这两张都在收费档里：只有航班号能提
  moveTo(oldAt - 24 * HOUR);
  await w.relogin();
  const firstRes = await w.api.call("PATCH", `/sales/v1/orders/${exact.order.id}`, { token: await w.flow.token(), headers: { "if-match": `"${(await w.api.db.owner.query("select version from orders where id = $1", [exact.order.id])).rows[0].version}"` }, body: { flight_no: "JL5" } });
  const now = w.api.clock.now().getTime();
  assert.equal(Date.parse(firstRes.body.change.confirm_due_at), now + 30 * MINUTE, firstRes.text);
  const second = await w.api.call("PATCH", `/sales/v1/orders/${justOver.order.id}`, { token: await w.flow.token(), headers: { "if-match": `"${(await w.api.db.owner.query("select version from orders where id = $1", [justOver.order.id])).rows[0].version}"` }, body: { flight_no: "JL5" } });
  assert.equal(Date.parse(second.body.change.confirm_due_at), oldAt + 2 * HOUR - 24 * HOUR + 30 * MINUTE, second.text);
});

test("跨午夜：东京 00:10 的单，申请的确认期限、提醒都按真实时刻算（不是按日期）；东京 23:50 改到第二天 00:10，用车日期跟着变", async () => {
  const base = w.freshDay();
  const midnight = base - HOUR + 15 * HOUR + 10 * MINUTE; // base 是东京 10:00；这里是东京第二天 00:10 的 UTC
  assert.equal(new Date(midnight + 9 * HOUR).toISOString().slice(11, 16), "00:10");
  const { order } = await w.dispatched(midnight);
  const change = (await w.patch(order.id, { passengers: 3 })).body.change;
  assert.equal(Date.parse(change.confirm_due_at), midnight - 24 * HOUR + 30 * MINUTE);
  const lateAt = midnight + 2 * DAY - 20 * MINUTE;
  const other = await w.dispatched(lateAt);
  const moved = (await w.patch(other.order.id, { service_time: iso(lateAt + 20 * MINUTE) })).body.change;
  await ok(w.tenantDecide(other.order.id, moved.id, "confirm"));
  const seen = await w.salesGet(other.order.id);
  assert.equal(seen.service_date, tokyoDate(lateAt + 20 * MINUTE));
  assert.notEqual(seen.service_date, tokyoDate(lateAt));
});

test("提前改期：最早用车时间取新时间，期限按新时间算；进 24 小时了申请 30 分钟内没结论失效", async () => {
  const oldAt = w.freshDay() + 10 * DAY;
  const newAt = oldAt - 5 * DAY;
  const { order } = await w.dispatched(oldAt);
  const change = (await w.patch(order.id, { service_time: iso(newAt) })).body.change;
  assert.equal(Date.parse(change.confirm_due_at), newAt - 24 * HOUR + 30 * MINUTE);
  moveTo(Date.parse(change.confirm_due_at));
  await w.api.app.orderJobs.money();
  const seen = await w.salesGet(order.id);
  assert.deepEqual([seen.changes[0].status, seen.service_time], ["expired", new Date(oldAt).toISOString()]);
});

test("超时提醒：提出时离用车 48 小时外（门槛 4 小时），进 48 小时后门槛变 1 小时；标了调整中也提醒；运营和超级管理员收到，只读不收；重复跑只有一条", async () => {
  const oldAt = w.freshDay();
  const { order } = await w.dispatched(oldAt);
  moveTo(oldAt - 48 * HOUR - 30 * MINUTE);
  await w.relogin();
  const change = (await w.patch(order.id, { passengers: 3 })).body.change;
  await ok(w.tenantDecide(order.id, change.id, "adjusting", { note: "在换司机" }));
  w.api.clock.advance(20 * MINUTE);
  await w.api.app.orderJobs.exceptions();
  assert.deepEqual(await exceptions(order.id), [], "还在 48 小时外、不到 4 小时");
  w.api.clock.advance(41 * MINUTE);
  await w.api.app.orderJobs.exceptions();
  await w.api.app.orderJobs.exceptions();
  assert.equal((await exceptions(order.id)).length, 1);
  await w.tick();
  const rows = await w.api.db.owner.query("select recipient from notifications where order_id = $1 and event = 'exception.opened'", [order.id]);
  const recipients = rows.rows.map((row) => row.recipient as string);
  assert.ok(recipients.includes(w.m.staff.operations.email), recipients.join(","));
  assert.ok(recipients.some((item) => item.startsWith("root@")), recipients.join(","));
  assert.ok(!recipients.some((item) => item.startsWith("readonly")), "只读不收");
});

test("待办的「需调整司机」：提出时没派司机，后来派了，首页的待办要跟着提示（否则新司机被漏掉）", async () => {
  const order = await w.flow.paidOrder({ serviceTime: iso(w.freshDay()) });
  const res = await w.patch(order.id, { passengers: 3 });
  assert.equal((await w.todosOf(order.id))[0].needs_driver_adjustment, false);
  const driver = await newDriver(w.api, w.b, { email: fictionalEmail() });
  const vehicle = await newVehicle(w.api, w.b, w.m.ids.biz7);
  await ok(assign(w.api, w.b, order.id, driver.id, vehicle.id));
  const after = await w.todosOf(order.id);
  assert.equal(res.body.change.status, "pending_confirmation");
  assert.deepEqual([after[0].kind, after[0].needs_driver_adjustment], ["change_request", true], "现在已派司机：同意就要调整他");
});

test("改派后的新司机：申请被拒时的通知不带链接、没有客人信息；原任务不受影响", async () => {
  const { order } = await w.dispatched();
  const res = await w.patch(order.id, { passengers: 3 });
  const nextEmail = fictionalEmail();
  const next = await newDriver(w.api, w.b, { email: nextEmail });
  const vehicle = await newVehicle(w.api, w.b, w.m.ids.biz7);
  await ok(assign(w.api, w.b, order.id, next.id, vehicle.id));
  await w.tick();
  w.smtp.reset();
  await ok(w.tenantDecide(order.id, res.body.change.id, "reject", { note: "排不出车" }));
  await w.tick();
  const text = w.texts(w.mailsTo(nextEmail));
  assert.equal(tokenInMail(text), null);
  assert.ok(!text.includes("排不出车"));
});

test("改期后和司机的另一张单撞车：同意照样生效，但标出冲突并提示改派", async () => {
  const oldAt = w.freshDay();
  const newAt = oldAt + DAY;
  const { order, driver, vehicle } = await w.dispatched(oldAt);
  const other = await w.flow.paidOrder({ serviceTime: iso(newAt) });
  await ok(assign(w.api, w.b, other.id, driver.id, vehicle.id));
  const change = (await w.patch(order.id, { service_time: iso(newAt) })).body.change;
  const confirmed = await ok(w.tenantDecide(order.id, change.id, "confirm"));
  assert.equal(confirmed.change.dispatch_conflict, true);
  assert.deepEqual((await w.todosOf(order.id)).map((item) => [item.kind, item.needs_driver_adjustment]), [["change_applied", true]]);
});

// ---- 救援转给新供应商之后 ----

test("救援转给甲之后：客人再改，申请和待办都到甲；乙看不到、处理不了；客人取消，通知甲和甲的司机，不通知乙的旧司机", async () => {
  const { order, email: oldDriverEmail } = await w.dispatched();
  const before = (await w.patch(order.id, { passengers: 3 })).body.change;
  await ok(w.api.call("POST", `/tenant/v1/orders/${order.id}/declare-unable`, { token: w.b.adminToken, body: { reason: "车坏了" } }));
  const offered = await ok(w.api.call("POST", `/platform/v1/orders/${order.id}/rescue/offers`, { token: await w.ops(), body: { tenant_id: w.a.tenantId } }), 201);
  await ok(w.api.call("POST", `/tenant/v1/rescue-offers/${offered.offer.id}/accept`, { token: w.a.adminToken, body: {} }));
  await w.tick();
  w.smtp.reset();

  assert.equal((await w.tenantDecide(order.id, before.id, "confirm", {}, w.a.adminToken)).status, 404, "甲处理不了乙时代的申请");
  const change = (await w.patch(order.id, { luggage: 3 })).body.change;
  assert.equal(change.status, "pending_confirmation");
  assert.deepEqual((await w.todosOf(order.id, w.a.adminToken)).map((item) => item.kind), ["change_request"], "到了甲");
  assert.ok(!(await w.todosOf(order.id)).some((item) => item.kind === "change_request"), "乙没有要决定的");
  assert.equal((await w.tenantDecide(order.id, change.id, "confirm")).status, 404, "乙处理不了");
  await w.tick();
  assert.match(w.texts(w.mailsTo(w.m.a.adminEmail)), /客人申请修改订单/);
  assert.doesNotMatch(w.texts(w.mailsTo(w.m.b.adminEmail)), /客人申请修改订单/);

  const driverEmail = fictionalEmail();
  const driver = await newDriver(w.api, w.a, { email: driverEmail });
  const vehicle = await newVehicle(w.api, w.a, w.m.ids.biz7);
  await ok(assign(w.api, w.a, order.id, driver.id, vehicle.id));
  await ok(w.tenantDecide(order.id, change.id, "confirm", {}, w.a.adminToken));
  assert.equal((await w.salesGet(order.id)).luggage, 3);
  await w.tick();
  w.smtp.reset();
  await ok(w.salesCancel(order.id));
  await w.tick();
  assert.match(w.texts(w.mailsTo(driverEmail)), /任务已取消/);
  assert.equal(w.mailsTo(oldDriverEmail).length, 0);
  assert.match(w.texts(w.mailsTo(w.m.a.adminEmail)), /这张订单已取消/);
  assert.equal(w.net(order.id), 0);
});

test("缺陷：单已经完成，订单还写「可以免费取消」（free_cancel_available: true），实际取消 409——渠道和页面按这个字段判断会误导", async () => {
  const { order } = await w.dispatched();
  const change = (await w.patch(order.id, { passengers: 3 })).body.change;
  await ok(w.tenantDecide(order.id, change.id, "reject", { note: "排不出车" }));
  for (const type of ["departed", "arrived", "picked_up", "completed"]) await ok(w.api.call("POST", `/tenant/v1/orders/${order.id}/events`, { token: w.b.adminToken, body: { type } }));
  const seen = await w.salesGet(order.id);
  assert.equal(seen.status, "completed");
  const res = await w.salesCancel(order.id, { reason: "CHANGE_NOT_CONFIRMED" });
  assert.equal(res.status, 409);
  assert.equal(seen.free_cancel_available, false);
});
