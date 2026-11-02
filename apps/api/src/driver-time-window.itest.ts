/**
 * M4-32：司机回传履约的时间窗口（ADR 0064），经真实接口、真实 PostgreSQL。
 * - 司机太早点出发、到达、接到客人、完成：422 `FULFILMENT_TOO_EARLY`，订单、状态流水、推送都不变；说明里有最早几点（当地时间）；
 * - 边界：正好在最早时间那一刻可以，早 1 毫秒不行；航班晚点时比用车时间晚很多照样可以；
 * - 状态不对时先报 409（页面过时），不报太早；
 * - 司机页的这一单带上下一步最早什么时候可以点；
 * - 供应商的调度接口不受这次的窗口影响（ADR 0064「范围」）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { type TestApi, createTestApi } from "./testing/api.ts";
import { type Market, buildMarket, ok } from "./testing/market.ts";
import { assign, newDriver, newVehicle, seedOrder } from "./testing/dispatch.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";

let api: TestApi;
let m: Market;

before(async () => {
  api = await createTestApi();
  m = await buildMarket(api);
});
after(() => api.close());

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

async function dispatched(serviceAt: Date): Promise<{ order: Awaited<ReturnType<typeof seedOrder>>; token: string; tenantToken: string }> {
  const tenantToken = (await ok(api.call("POST", "/tenant/v1/auth/login", { body: { email: m.a.adminEmail, password: "Quiet-Harbor-2026" } }))).access_token;
  const who = { ...m.a, adminToken: tenantToken };
  const order = await seedOrder(api, m, "a", { serviceAt });
  const res = await ok(assign(api, who, order.id, (await newDriver(api, who)).id, (await newVehicle(api, who, m.ids.biz7)).id));
  return { order, token: res.driver_link.token, tenantToken };
}

/** 现在之后 `hours` 小时、对齐到整分钟的用车时间（真实订单的用车时间都是整分钟）。 */
const serviceIn = (hours: number): Date => new Date(Math.ceil((api.clock.now().getTime() + hours * HOUR) / MINUTE) * MINUTE);
/** 把时钟拨到 `at` 那一刻。 */
const moveTo = (at: Date): void => api.clock.advance(at.getTime() - api.clock.now().getTime());

const event = (token: string, type: string, extra: Record<string, unknown> = {}) => api.call("POST", "/driver/v1/trip/events", { token, body: { type, ...extra } });

async function trail(orderId: string): Promise<{ status: string; driverEvents: number; pushes: number }> {
  const status = await api.db.owner.query<{ status: string }>("select status from orders where id = $1", [orderId]);
  const events = await api.db.owner.query("select 1 from order_events where order_id = $1 and actor = 'driver'", [orderId]);
  const pushes = await api.db.owner.query("select 1 from webhook_deliveries where order_id = $1 and event_type = 'order.status_changed'", [orderId]);
  return { status: status.rows[0]?.status as string, driverEvents: events.rowCount ?? 0, pushes: pushes.rowCount ?? 0 };
}

test("真实发生的情况：用车前两天在 20 秒内点出发、到达、接到、完成——一步也点不了，订单还是已派车，没有流水和推送", async () => {
  const serviceAt = serviceIn(49);
  const { order, token } = await dispatched(serviceAt);
  const before = await trail(order.id);
  const departed = await event(token, "departed");
  assertMatchesOpenApi("POST", "/driver/v1/trip/events", departed);
  assert.equal(departed.status, 422, departed.text);
  assert.equal(departed.body.error.code, "FULFILMENT_TOO_EARLY");
  const earliest = new Date(serviceAt.getTime() - 24 * HOUR);
  const earliestLocal = new Date(earliest.getTime() + 9 * HOUR).toISOString().slice(0, 16).replace("T", " ");
  assert.deepEqual(departed.body.error.details, { type: "departed", earliest_at: earliest.toISOString(), earliest_local: earliestLocal, timezone: "Asia/Tokyo", hours_before_service: 24 });
  assert.match(departed.body.error.message, new RegExp(`「司机已出发」.*${earliestLocal}.*Asia/Tokyo`));
  api.clock.advance(20_000);
  assert.equal((await event(token, "arrived")).status, 409, "还没出发，先报状态不对");
  assert.deepEqual(await trail(order.id), before);
  assert.equal(before.status, "assigned");
});

test("边界：正好用车前 24 小时可以出发、到达；接到客人要等到用车前 3 小时，早 1 毫秒也不行；之后完成", async () => {
  const serviceAt = serviceIn(24);
  const { order, token } = await dispatched(serviceAt);
  moveTo(new Date(serviceAt.getTime() - 24 * HOUR));
  assert.equal((await ok(event(token, "departed"))).order.status, "departed");
  assert.equal((await ok(event(token, "arrived"))).order.status, "arrived");
  moveTo(new Date(serviceAt.getTime() - 3 * HOUR - 1));
  const early = await event(token, "picked_up");
  assert.equal(early.status, 422, early.text);
  assert.deepEqual([early.body.error.details.type, early.body.error.details.hours_before_service, early.body.error.details.earliest_at], ["picked_up", 3, new Date(serviceAt.getTime() - 3 * HOUR).toISOString()]);
  assert.equal((await trail(order.id)).status, "arrived");
  api.clock.advance(1);
  assert.equal((await ok(event(token, "picked_up"))).order.status, "in_service");
  assert.equal((await ok(event(token, "completed"))).order.status, "completed");
  assert.equal((await trail(order.id)).driverEvents, 4);
});

test("航班晚点：用车时间过了几个小时才到达、接到客人、完成，照样可以", async () => {
  const serviceAt = serviceIn(2);
  const { token } = await dispatched(serviceAt);
  await ok(event(token, "departed"));
  api.clock.advance(7 * HOUR);
  await ok(event(token, "arrived"));
  await ok(event(token, "picked_up"));
  assert.equal((await ok(event(token, "completed"))).order.status, "completed");
});

test("司机页的这一单带下一步最早什么时候可以点；完成以后没有下一步", async () => {
  const serviceAt = serviceIn(30);
  const { token } = await dispatched(serviceAt);
  const trip = await api.call("GET", "/driver/v1/trip", { token });
  assertMatchesOpenApi("GET", "/driver/v1/trip", trip);
  const earliest = new Date(serviceAt.getTime() - 24 * HOUR);
  assert.deepEqual(trip.body.next_event, { type: "departed", earliest_at: earliest.toISOString(), earliest_local: new Date(earliest.getTime() + 9 * HOUR).toISOString().slice(0, 16).replace("T", " ") });
  api.clock.advance(30 * HOUR);
  for (const type of ["departed", "arrived", "picked_up"]) await ok(event(token, type));
  const serving = await ok(event(token, "completed"));
  assert.equal(serving.next_event, null);
});

test("供应商的调度接口不受这次的窗口影响：用车前两天仍可回传（ADR 0064「范围」）", async () => {
  const serviceAt = serviceIn(49);
  const { order, tenantToken } = await dispatched(serviceAt);
  for (const type of ["departed", "arrived", "picked_up", "completed"]) await ok(api.call("POST", `/tenant/v1/orders/${order.id}/events`, { token: tenantToken, body: { type } }));
  assert.equal((await trail(order.id)).status, "completed");
});
