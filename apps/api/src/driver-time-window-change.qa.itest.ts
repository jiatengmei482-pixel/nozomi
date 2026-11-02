/**
 * M4-32 测试角色：司机时间窗口和 M4-29 改单联动（ADR 0064「订单现在的用车时间」、ADR 0060「确认前按原时间」）。
 * 真实 PostgreSQL + 本机假 SMTP，收款服务用替身；订单经销售接口下单付款（都是虚构数据，随测试 schema 删除）。
 * - 同意改到更晚 / 更早：窗口跟着新时间走（422 的 earliest_at、next_event 都按新时间）；
 * - 待确认（改晚、改早）和被拒绝：一律按原时间；
 * - 司机点出发和供应商同意改时间同时到：要么先出发（改单 409），要么先改（出发按新时间判），不会出现「按原时间出发了、用车时间却变成新的」。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { DAY, HOUR, MINUTE, type World, buildWorld, iso, resetBetweenTests } from "./testing/change-approval-qa.ts";
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

const moveTo = (at: number): void => w.api.clock.advance(at - w.api.clock.now().getTime());
const event = (token: string, type: string) => w.api.call("POST", "/driver/v1/trip/events", { token, body: { type } });
const trip = async (token: string): Promise<any> => ok(w.api.call("GET", "/driver/v1/trip", { token }));
const serviceAtOf = async (orderId: string): Promise<number> => (await w.api.db.owner.query<{ service_at: Date }>("select service_at from orders where id = $1", [orderId])).rows[0]!.service_at.getTime();

async function requestTime(orderId: string, at: number): Promise<any> {
  const res = await w.patch(orderId, { service_time: iso(at) });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.change.status, "pending_confirmation", res.text);
  return res.body.change;
}

function assertEarliest(res: { status: number; text: string; body: any }, type: string, earliestMs: number): void {
  assert.equal(res.status, 422, res.text);
  assert.equal(res.body.error.code, "FULFILMENT_TOO_EARLY");
  assert.equal(res.body.error.details.type, type);
  assert.equal(res.body.error.details.earliest_at, new Date(earliestMs).toISOString());
}

test("同意改到更晚（+2 天）：原时间的窗口里点出发被拒，最早时间按新时间；到新时间前 24 小时才行", async () => {
  const oldAt = w.freshDay();
  const newAt = oldAt + 2 * DAY;
  const { order, token } = await w.dispatched(oldAt);
  const change = await requestTime(order.id, newAt);
  await ok(w.tenantDecide(order.id, change.id, "confirm"));
  assert.equal(await serviceAtOf(order.id), newAt);
  moveTo(oldAt - 24 * HOUR);
  assertEarliest(await event(token, "departed"), "departed", newAt - 24 * HOUR);
  assert.equal((await trip(token)).next_event.earliest_at, new Date(newAt - 24 * HOUR).toISOString());
  moveTo(newAt - 24 * HOUR - 1);
  assertEarliest(await event(token, "departed"), "departed", newAt - 24 * HOUR);
  w.api.clock.advance(1);
  assert.equal((await ok(event(token, "departed"))).order.status, "departed");
});

test("同意改到更早（−1 天）：按新时间，原时间的窗口还没开也能出发；接到客人按新时间前 3 小时", async () => {
  const oldAt = w.freshDay();
  const newAt = oldAt - DAY;
  const { order, token } = await w.dispatched(oldAt);
  const change = await requestTime(order.id, newAt);
  await ok(w.tenantDecide(order.id, change.id, "confirm"));
  moveTo(newAt - 24 * HOUR);
  assert.equal((await trip(token)).next_event.earliest_at, new Date(newAt - 24 * HOUR).toISOString());
  await ok(event(token, "departed"));
  await ok(event(token, "arrived"));
  moveTo(newAt - 3 * HOUR - 1);
  assertEarliest(await event(token, "picked_up"), "picked_up", newAt - 3 * HOUR);
  w.api.clock.advance(1);
  await ok(event(token, "picked_up"));
  assert.equal((await ok(event(token, "completed"))).order.status, "completed");
});

test("待确认改到更晚：按原时间——原时间前 24 小时就能出发；出发之后改时间不能再同意", async () => {
  const oldAt = w.freshDay();
  const { order, token } = await w.dispatched(oldAt);
  const change = await requestTime(order.id, oldAt + 2 * DAY);
  moveTo(oldAt - 24 * HOUR - 1);
  assertEarliest(await event(token, "departed"), "departed", oldAt - 24 * HOUR);
  const page = await trip(token);
  assert.deepEqual(page.pending_change, { fields: ["service_time"] });
  assert.equal(page.next_event.earliest_at, new Date(oldAt - 24 * HOUR).toISOString(), "next_event 不泄露、不使用待确认的新时间");
  w.api.clock.advance(1);
  await ok(event(token, "departed"));
  const decided = await w.tenantDecide(order.id, change.id, "confirm");
  assert.notEqual(decided.status, 200, decided.text);
  assert.equal(await serviceAtOf(order.id), oldAt, "用车时间没变");
});

test("待确认改到更早：按原时间——新时间前 24 小时点出发仍被拒，最早时间是原时间的", async () => {
  const oldAt = w.freshDay();
  const newAt = oldAt - DAY;
  const { order, token } = await w.dispatched(oldAt);
  await requestTime(order.id, newAt);
  moveTo(newAt - 24 * HOUR);
  const res = await event(token, "departed");
  assertEarliest(res, "departed", oldAt - 24 * HOUR);
  assert.ok(!res.text.includes(iso(newAt)), "说明里不出现待确认的新时间");
  assert.equal(await serviceAtOf(order.id), oldAt);
});

test("被拒绝的改单：窗口照旧按原时间", async () => {
  const oldAt = w.freshDay();
  const { order, token } = await w.dispatched(oldAt);
  const change = await requestTime(order.id, oldAt - DAY);
  await ok(w.tenantDecide(order.id, change.id, "reject", { note: "排不出车" }));
  moveTo(oldAt - DAY - 24 * HOUR);
  assertEarliest(await event(token, "departed"), "departed", oldAt - 24 * HOUR);
});

test("并发：按原时间可以出发的那一刻，司机点出发和供应商同意改晚同时到——结果总是一致的（5 轮）", async () => {
  for (let round = 0; round < 5; round += 1) {
    const oldAt = w.freshDay();
    const newAt = oldAt + 2 * DAY;
    const { order, token } = await w.dispatched(oldAt);
    const change = await requestTime(order.id, newAt);
    moveTo(oldAt - 24 * HOUR + MINUTE);
    await w.relogin();
    const [departed, decided] = await Promise.all([event(token, "departed"), w.tenantDecide(order.id, change.id, "confirm")]);
    const row = (await w.api.db.owner.query<{ status: string; service_at: Date; departed_at: Date | null }>("select status, service_at, departed_at from orders where id = $1", [order.id])).rows[0]!;
    if (departed.status === 200) {
      assert.notEqual(decided.status, 200, `第 ${round} 轮：已经出发了，改时间不该再被同意`);
      assert.deepEqual([row.status, row.service_at.getTime()], ["departed", oldAt]);
    } else {
      assert.equal(decided.status, 200, decided.text);
      assertEarliest(departed, "departed", newAt - 24 * HOUR);
      assert.deepEqual([row.status, row.service_at.getTime(), row.departed_at], ["assigned", newAt, null]);
    }
  }
});
