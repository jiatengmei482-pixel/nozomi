/**
 * M4-29 测试角色：改单的并发（ADR 0060）。不只看状态码，核对结束后的不变量：
 * 没有结论的申请最多一条；一次决定只留一条流水、一封结果通知；钱（收款服务那边的净额）和对外价一致；司机手里能打开的链接只属于现在的司机，取消后一条都打不开。
 * 每种竞争跑几轮，并交换发起的先后，让两种顺序都有机会出现。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { DAY, MINUTE, SELL, SURGE_SELL, type World, buildWorld, decodedMailText, fictionalEmail, iso, resetBetweenTests, tokenInMail, tokyoDate } from "./testing/change-approval-qa.ts";
import { assign, newDriver, newVehicle } from "./testing/dispatch.ts";
import { ok } from "./testing/market.ts";

let w: World;
before(async () => {
  w = await buildWorld();
});
after(async () => {
  await w.close();
});
beforeEach(async () => {
  await resetBetweenTests(w);
});

const ROUNDS = 4;
const DIFF = SURGE_SELL - SELL;

/** 两个请求同时发，交换发起的先后，结果按传入的顺序返回。 */
async function race<A, B>(round: number, first: () => Promise<A>, second: () => Promise<B>): Promise<[A, B]> {
  if (round % 2 === 0) return Promise.all([first(), second()]);
  const [b, a] = await Promise.all([second(), first()]);
  return [a, b];
}

async function orderEvents(orderId: string, reason: string): Promise<number> {
  return (await w.api.db.owner.query<{ n: number }>("select count(*)::int as n from order_events where order_id = $1 and reason = $2", [orderId, reason])).rows[0]?.n ?? 0;
}
async function openChanges(orderId: string): Promise<number> {
  return (await w.api.db.owner.query<{ n: number }>("select count(*)::int as n from order_changes where order_id = $1 and status in ('awaiting_payment', 'pending_confirmation', 'adjusting')", [orderId])).rows[0]?.n ?? 0;
}
async function liveLinks(orderId: string): Promise<{ driver_id: string; purpose: string; expires_at: Date }[]> {
  return (await w.api.db.owner.query("select driver_id, purpose, expires_at from driver_links where order_id = $1 and revoked_at is null", [orderId])).rows;
}
/** 邮件里发出去的带令牌的链接。 */
const mailedTokens = (email: string): string[] => w.mailsTo(email).flatMap((mail) => tokenInMail(decodedMailText(mail.data)) ?? []);
const openTrip = (token: string) => w.api.call("GET", "/driver/v1/trip", { token });

/** 补差价的改期申请，派好车的单。 */
async function surcharged(): Promise<Awaited<ReturnType<World["dispatched"]>> & { changeId: string; oldAt: number; newAt: number }> {
  const oldAt = w.freshDay();
  const newAt = oldAt + DAY;
  await w.surge(tokyoDate(newAt));
  const dispatched = await w.dispatched(oldAt);
  const res = await w.patch(dispatched.order.id, { service_time: iso(newAt) });
  assert.equal(res.body.change?.status, "pending_confirmation", res.text);
  return { ...dispatched, changeId: res.body.change.id, oldAt, newAt };
}

test("同意 × 客户再改履约字段：同意总是成功；再改一定 409（版本对不上或还有申请），不会生成第二条申请；人数改到、行李没改", async () => {
  for (let round = 0; round < ROUNDS; round += 1) {
    const { order } = await w.dispatched();
    const change = (await w.patch(order.id, { passengers: 3 })).body.change;
    const version = (await w.salesGet(order.id)).version;
    const token = await w.flow.token();
    const [agreed, repatched] = await race(round, () => w.tenantDecide(order.id, change.id, "confirm"), () => w.api.call("PATCH", `/sales/v1/orders/${order.id}`, { token, headers: { "if-match": `"${version}"` }, body: { luggage: 3 } }));
    assert.equal(agreed.status, 200, agreed.text);
    assert.equal(repatched.status, 409, repatched.text);
    assert.ok(["VERSION_CONFLICT", "CHANGE_IN_PROGRESS"].includes(repatched.body.error.code), repatched.text);
    const seen = await w.salesGet(order.id);
    assert.deepEqual([seen.passengers, seen.luggage, seen.changes.map((item: any) => item.status)], [3, 1, ["applied"]], `第 ${round} 轮`);
    assert.equal(await openChanges(order.id), 0);
  }
});

test("同意 × 客户改联系信息：谁先都不丢——人数生效；联系信息要么生效，要么明确 409 版本冲突（可以重试）", async () => {
  for (let round = 0; round < ROUNDS; round += 1) {
    const { order } = await w.dispatched();
    const change = (await w.patch(order.id, { passengers: 3 })).body.change;
    const version = (await w.salesGet(order.id)).version;
    const token = await w.flow.token();
    const [agreed, contact] = await race(round, () => w.tenantDecide(order.id, change.id, "confirm"), () => w.api.call("PATCH", `/sales/v1/orders/${order.id}`, { token, headers: { "if-match": `"${version}"` }, body: { notes: "带婴儿车" } }));
    assert.equal(agreed.status, 200, agreed.text);
    const seen = await w.salesGet(order.id);
    assert.equal(seen.passengers, 3, `第 ${round} 轮：同意的内容不能被覆盖`);
    if (contact.status === 200) assert.equal(seen.notes, "带婴儿车", `第 ${round} 轮：联系信息不能被覆盖`);
    else assert.deepEqual([contact.status, contact.body.error.code], [409, "VERSION_CONFLICT"], contact.text);
  }
});

test("同意（改期）× 改派：改派成功时旧司机手里的一切链接都打不开，新司机的有效期按新用车时间；改派 409 时原司机的链接有效期也跟到新时间", async () => {
  for (let round = 0; round < ROUNDS; round += 1) {
    const oldAt = w.freshDay();
    const newAt = oldAt + DAY;
    const { order, driver, email, token } = await w.dispatched(oldAt);
    const change = (await w.patch(order.id, { service_time: iso(newAt) })).body.change;
    assert.equal(change.status, "pending_confirmation");
    const nextEmail = fictionalEmail();
    const next = await newDriver(w.api, w.b, { email: nextEmail });
    const vehicle = await newVehicle(w.api, w.b, w.m.ids.biz7);
    const version = (await ok(w.api.call("GET", `/tenant/v1/orders/${order.id}`, { token: w.b.adminToken }))).order.version;
    const [agreed, swapped] = await race(round, () => w.tenantDecide(order.id, change.id, "confirm"), () => assign(w.api, w.b, order.id, next.id, vehicle.id, { version }));
    assert.equal(agreed.status, 200, agreed.text);
    assert.ok([200, 409].includes(swapped.status), swapped.text);
    await w.tick();
    const seen = (await ok(w.api.call("GET", `/tenant/v1/orders/${order.id}`, { token: w.b.adminToken }))).order;
    assert.equal(seen.service_time, new Date(newAt).toISOString(), `第 ${round} 轮`);
    const live = await liveLinks(order.id);
    const currentDriver = swapped.status === 200 ? next.id : driver.id;
    assert.ok(live.length > 0, "现在的司机一定有能用的链接");
    for (const link of live) {
      assert.equal(link.driver_id, currentDriver, `第 ${round} 轮：能用的链接只属于现在的司机`);
      assert.ok(link.expires_at.getTime() > newAt, `第 ${round} 轮：有效期跟到新的用车时间`);
    }
    if (swapped.status === 200) {
      assert.equal((await openTrip(token)).status, 401, `第 ${round} 轮：旧司机的链接作废`);
      for (const mailed of mailedTokens(email)) assert.equal((await openTrip(mailed)).status, 401, `第 ${round} 轮：发给旧司机的新链接也打不开`);
      assert.equal((await openTrip(swapped.body.driver_link.token)).status, 200);
    } else {
      assert.equal((await openTrip(token)).status, 200);
    }
    w.smtp.reset();
  }
});

test("同意（补差价）× 取消：订单一定取消；钱净额 0（取消费 0，免费期内）；所有链接作废；发出的链接都打不开；没有要决定的待办；库存见 money 文件", async () => {
  for (let round = 0; round < ROUNDS; round += 1) {
    const { order, changeId, email, token } = await surcharged();
    const salesToken = await w.flow.token();
    const [agreed, cancelled] = await race(round, () => w.tenantDecide(order.id, changeId, "confirm"), () => w.api.call("POST", `/sales/v1/orders/${order.id}/cancel`, { token: salesToken, body: {} }));
    assert.equal(cancelled.status, 200, cancelled.text);
    const seen = await w.salesGet(order.id);
    assert.equal(seen.status, "cancelled");
    if (agreed.status === 200) assert.equal(seen.changes[0].status, "applied");
    else assert.deepEqual([agreed.status, seen.changes[0].status], [409, "cancelled"], agreed.text);
    assert.equal(w.net(order.id), 0, `第 ${round} 轮：钱全部退回`);
    assert.equal(w.pay.refundsOf(order.id).reduce((sum, refund) => sum + refund.amountMinor, 0), SURGE_SELL, `第 ${round} 轮：没有多退`);
    assert.equal(await openChanges(order.id), 0);
    await w.tick();
    assert.deepEqual(await liveLinks(order.id), [], `第 ${round} 轮：取消后没有活着的链接`);
    assert.equal((await openTrip(token)).status, 401);
    for (const mailed of mailedTokens(email)) assert.equal((await openTrip(mailed)).status, 401);
    assert.ok(!(await w.todosOf(order.id)).some((item) => item.kind === "change_request"), `第 ${round} 轮：不留要决定的待办`);
    assert.deepEqual(await w.events(order.id, "order.cancelled"), { "order.cancelled": 1 });
    assert.deepEqual(await w.events(order.id, "order.driver_cancelled"), { "order.driver_cancelled": 1 });
    w.smtp.reset();
  }
});

test("拒绝（补差价）× 取消：钱净额 0，没有多退", async () => {
  for (let round = 0; round < ROUNDS; round += 1) {
    const { order, changeId } = await surcharged();
    const salesToken = await w.flow.token();
    const [rejected, cancelled] = await race(round, () => w.tenantDecide(order.id, changeId, "reject", { note: "排不出车" }), () => w.api.call("POST", `/sales/v1/orders/${order.id}/cancel`, { token: salesToken, body: {} }));
    assert.equal(cancelled.status, 200, cancelled.text);
    assert.ok([200, 409].includes(rejected.status), rejected.text);
    assert.equal(w.net(order.id), 0, `第 ${round} 轮`);
    assert.equal(w.pay.refundsOf(order.id).reduce((sum, refund) => sum + refund.amountMinor, 0), SURGE_SELL, `第 ${round} 轮`);
  }
});

test("两个人同时处理同一申请：同意 × 同意、同意 × 代同意——只有一个 200，流水、结果通知、审计都只有一条，不重复退款", async () => {
  for (let round = 0; round < ROUNDS; round += 1) {
    const { order, changeId } = await surcharged();
    const ops = await w.ops();
    const [first, second] = await race(round, () => w.tenantDecide(order.id, changeId, "confirm"), () => (round < 2 ? w.tenantDecide(order.id, changeId, "confirm") : w.platformDecide(order.id, changeId, "confirm", "电话联系过", ops)));
    assert.deepEqual([first.status, second.status].sort(), [200, 409], first.text + second.text);
    const loser = first.status === 409 ? first : second;
    assert.equal(loser.body.error.code, "CHANGE_NOT_PENDING");
    assert.equal(await orderEvents(order.id, "CHANGED"), 1);
    assert.deepEqual(await w.events(order.id, "order.changed"), { "order.changed": 1 });
    const audit = await w.api.db.owner.query("select count(*)::int as n from audit_logs where resource = 'order_change' and resource_id = $1 and action = 'change'", [changeId]);
    assert.equal(audit.rows[0].n, 1);
    assert.equal(w.pay.refundsOf(order.id).length, 0);
    assert.equal(w.net(order.id), SURGE_SELL);
  }
});

test("两个人同时处理同一申请：同意 × 拒绝——结论只有一个，钱和对外价跟结论一致", async () => {
  for (let round = 0; round < ROUNDS; round += 1) {
    const { order, changeId, oldAt, newAt } = await surcharged();
    const ops = await w.ops();
    const [agreed, rejected] = await race(round, () => w.tenantDecide(order.id, changeId, "confirm"), () => w.platformDecide(order.id, changeId, "reject", "供应商说排不出车", ops));
    assert.deepEqual([agreed.status, rejected.status].sort(), [200, 409], agreed.text + rejected.text);
    const seen = await w.salesGet(order.id);
    if (agreed.status === 200) {
      assert.deepEqual([seen.changes[0].status, seen.service_time, Number(seen.price.total.amount), w.net(order.id)], ["applied", new Date(newAt).toISOString(), SURGE_SELL, SURGE_SELL], `第 ${round} 轮`);
      assert.deepEqual(await w.events(order.id, "order.change_declined"), {});
    } else {
      assert.deepEqual([seen.changes[0].status, seen.service_time, Number(seen.price.total.amount), w.net(order.id)], ["rejected", new Date(oldAt).toISOString(), SELL, SELL], `第 ${round} 轮`);
      assert.deepEqual(await w.events(order.id, "order.change_declined"), { "order.change_declined": 1 });
    }
  }
});

test("拒绝 × 拒绝（供应商和代处理）：差价只退一次；调整中 × 同意：同意一定生效", async () => {
  for (let round = 0; round < ROUNDS; round += 1) {
    const { order, changeId } = await surcharged();
    const ops = await w.ops();
    const [first, second] = await race(round, () => w.tenantDecide(order.id, changeId, "reject", { note: "排不出车" }), () => w.platformDecide(order.id, changeId, "reject", "排不出车", ops));
    assert.deepEqual([first.status, second.status].sort(), [200, 409]);
    assert.equal(w.pay.refundsOf(order.id).reduce((sum, refund) => sum + refund.amountMinor, 0), DIFF);
    assert.equal(await orderEvents(order.id, "CHANGE_REJECTED"), 1);

    const other = await w.dispatched();
    const change = (await w.patch(other.order.id, { passengers: 3 })).body.change;
    const [adjusted, agreed] = await race(round, () => w.tenantDecide(other.order.id, change.id, "adjusting"), () => w.tenantDecide(other.order.id, change.id, "confirm"));
    assert.equal(agreed.status, 200, agreed.text);
    assert.ok([200, 409].includes(adjusted.status), adjusted.text);
    assert.equal((await w.salesGet(other.order.id)).changes[0].status, "applied");
  }
});

test("同意 × 超时任务：到点前 1 毫秒，同意生效、任务不动它；到点那一刻，两边都只记一次没确认，差价退一次，结果通知一封", async () => {
  for (let round = 0; round < ROUNDS; round += 1) {
    const before = await surcharged();
    const due = Date.parse((await w.salesGet(before.order.id)).changes[0].confirm_due_at);
    const expiring = await surcharged();
    const dueExpiring = Date.parse((await w.salesGet(expiring.order.id)).changes[0].confirm_due_at);
    assert.ok(dueExpiring > due || dueExpiring < due, "两张单的期限不同（日子不同）");

    w.api.clock.advance(due - 1 - w.api.clock.now().getTime());
    await w.relogin();
    const [agreed, swept] = await race(round, () => w.tenantDecide(before.order.id, before.changeId, "confirm"), () => w.api.app.orderJobs.money());
    assert.equal(agreed.status, 200, agreed.text);
    assert.equal(swept.changes.expired, 0, "还没到点");
    assert.equal((await w.salesGet(before.order.id)).changes[0].status, "applied");

    w.api.clock.advance(dueExpiring - w.api.clock.now().getTime());
    await w.relogin();
    const [late] = await race(round, () => w.tenantDecide(expiring.order.id, expiring.changeId, "confirm"), () => w.api.app.orderJobs.money());
    assert.equal(late.status, 409, late.text);
    assert.ok(["CHANGE_CONFIRMATION_EXPIRED", "CHANGE_NOT_PENDING"].includes(late.body.error.code), late.text);
    await w.api.app.orderJobs.money();
    const seen = await w.salesGet(expiring.order.id);
    assert.deepEqual([seen.changes[0].status, seen.service_time, w.net(expiring.order.id)], ["expired", new Date(expiring.oldAt).toISOString(), SELL], `第 ${round} 轮`);
    assert.equal(await orderEvents(expiring.order.id, "CHANGE_EXPIRED"), 1, `第 ${round} 轮：只记一次`);
    assert.deepEqual(await w.events(expiring.order.id, "order.change_declined"), { "order.change_declined": 1 });
    assert.deepEqual((await w.todosOf(expiring.order.id)).map((item) => item.kind), ["change_expired"]);
    await resetBetweenTests(w);
  }
});

test("两个定时任务实例同时跑：同一张过期的申请只处理一次", async () => {
  const { order, changeId } = await surcharged();
  const due = Date.parse((await w.salesGet(order.id)).changes[0].confirm_due_at);
  w.api.clock.advance(due - w.api.clock.now().getTime());
  const results = await Promise.all([w.api.app.orderJobs.money(), w.api.app.orderJobs.money(), w.api.app.orderJobs.money()]);
  assert.equal(results.reduce((sum, item) => sum + item.changes.expired, 0), 1);
  assert.equal(w.pay.refundsOf(order.id).length, 1);
  assert.equal((await w.salesGet(order.id)).changes.find((item: any) => item.id === changeId).status, "expired");
});

test("同意（补差价）× 救援：申请要么生效要么作废，钱和对外价一致；司机链接全部作废", async () => {
  for (let round = 0; round < ROUNDS; round += 1) {
    const { order, changeId, token } = await surcharged();
    const [agreed, unable] = await race(round, () => w.tenantDecide(order.id, changeId, "confirm"), () => w.api.call("POST", `/tenant/v1/orders/${order.id}/declare-unable`, { token: w.b.adminToken, body: { reason: "车坏了" } }));
    assert.equal(unable.status, 200, unable.text);
    const seen = await w.salesGet(order.id);
    assert.equal(await openChanges(order.id), 0);
    if (agreed.status === 200) assert.deepEqual([seen.changes[0].status, w.net(order.id), Number(seen.price.total.amount)], ["applied", SURGE_SELL, SURGE_SELL], `第 ${round} 轮`);
    else assert.deepEqual([seen.changes[0].status, w.net(order.id), Number(seen.price.total.amount)], ["cancelled", SELL, SELL], `第 ${round} 轮`);
    assert.deepEqual(await liveLinks(order.id), [], `第 ${round} 轮`);
    assert.equal((await openTrip(token)).status, 401);
  }
});

test("通知任务 × 取消：同意之后排着的「任务有更新」和取消同时跑：发出去的链接最后都打不开", async () => {
  for (let round = 0; round < ROUNDS; round += 1) {
    const { order, email } = await w.dispatched();
    const change = (await w.patch(order.id, { passengers: 3 })).body.change;
    await ok(w.tenantDecide(order.id, change.id, "confirm"));
    w.smtp.reset();
    const salesToken = await w.flow.token();
    const [, cancelled] = await race(round, () => w.tick(), () => w.api.call("POST", `/sales/v1/orders/${order.id}/cancel`, { token: salesToken, body: {} }));
    assert.equal(cancelled.status, 200, cancelled.text);
    await w.tick();
    assert.deepEqual(await liveLinks(order.id), [], `第 ${round} 轮：不能有在取消之后才生成的链接活着`);
    for (const mailed of mailedTokens(email)) assert.equal((await openTrip(mailed)).status, 401);
    w.api.clock.advance(MINUTE);
  }
});
