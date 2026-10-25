/**
 * M3-02：派车（ADR 0027），经真实接口、真实 PostgreSQL。
 * - 派车、改派（版本号、状态、记录、状态流水、审计、旧链接作废）；不符合要求的拒绝（逐项原因）；同一时段的冲突要确认；
 * - 并发：两个人同时派同一张单只有一个成功；两张同一时段的单同时派给同一位司机，后到的看得到冲突；
 * - 可派的司机和车辆；司机链接的重新生成和吊销；调度系统回传履约状态（不能跳步、包车要填实际时长里程）；
 * - 超时未派车、用车前 1 小时未出发的提醒（每张单只提醒一次）；
 * - 规则 4：派车相关的应答里没有对外价和加价比例。跨租户的验证在 tenant-isolation.itest.ts。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { TEST_PASSWORD, type TestApi, addTenantUser, createTestApi } from "./testing/api.ts";
import { type Market, buildMarket, ok } from "./testing/market.ts";
import { assign, newDriver, newVehicle, orderVersion, seedOrder } from "./testing/dispatch.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";

let api: TestApi;
let m: Market;
/** 用车时间：测试时钟（2026-10-07 01:00Z）之后 13 天 */
const SERVICE = new Date("2026-10-20T01:00:00Z");

before(async () => {
  api = await createTestApi();
  m = await buildMarket(api);
});
after(() => api.close());

/** 拨过时钟之后会话（8 小时）可能过期：重新登录。 */
async function relogin(email: string): Promise<string> {
  return (await ok(api.call("POST", "/tenant/v1/auth/login", { body: { email, password: TEST_PASSWORD } }))).access_token;
}

test("派车：派给符合要求的司机和车辆，订单变成已派车；记派车记录、状态流水、审计；应答里有只出现一次的司机链接；没有对外价和加价比例", async () => {
  const order = await seedOrder(api, m, "a", { serviceAt: SERVICE });
  const driver = await newDriver(api, m.a);
  const vehicle = await newVehicle(api, m.a, m.ids.biz7);
  const res = await assign(api, m.a, order.id, driver.id, vehicle.id);
  assert.equal(res.status, 200, res.text);
  assertMatchesOpenApi("POST", "/tenant/v1/orders/{id}/assign", res as never);
  assert.equal(res.body.order.status, "assigned");
  assert.equal(res.body.change, false);
  assert.deepEqual([res.body.order.dispatch.driver.id, res.body.order.dispatch.vehicle.plate], [driver.id, vehicle.plate]);
  assert.match(res.body.driver_link.token, /^nzd_[0-9a-f]{32}\.[A-Za-z0-9_-]{43}$/);
  assert.equal(res.body.driver_link.path, `/driver#${res.body.driver_link.token}`);
  assert.equal(res.body.driver_link.expires_at, "2026-10-21T01:00:00.000Z", "用车后 24 小时失效");
  assert.doesNotMatch(res.text, /markup|sell|对外价|加价/i);
  const stored = await api.db.owner.query<{ token_hash: string }>("select token_hash from driver_links where order_id = $1", [order.id]);
  assert.equal(stored.rows.length, 1);
  assert.ok(!JSON.stringify(stored.rows).includes(res.body.driver_link.token), "库里只有哈希");

  const detail = await api.call("GET", `/tenant/v1/orders/${order.id}`, { token: m.a.adminToken });
  assertMatchesOpenApi("GET", "/tenant/v1/orders/{id}", detail);
  assert.deepEqual(detail.body.records.assignments.map((entry: any) => [entry.driver_id, entry.is_change]), [[driver.id, false]]);
  assert.equal(detail.body.records.driver_link.status, "active");
  assert.ok(!detail.text.includes(res.body.driver_link.token), "详情里不再出现令牌");
  assert.deepEqual(detail.body.events.map((event: any) => [event.from_status, event.to_status, event.actor, event.reason]), [["confirmed", "assigned", "tenant_user", "ASSIGNED"]]);
  const audit = await api.db.owner.query<{ action: string; after: Record<string, unknown> }>("select action, after from audit_logs where resource = 'order' and resource_id = $1", [order.id]);
  assert.deepEqual(audit.rows.map((row) => [row.action, row.after["driver_id"]]), [["assign", driver.id]]);
});

test("改派：已派车、司机已出发时可以换人换车（出发后回到已派车）；旧链接立即作废；同一组再派一次什么都不变；到达后不能改派", async () => {
  const order = await seedOrder(api, m, "a", { serviceAt: new Date("2026-10-21T05:00:00Z") });
  const [d1, d2] = [await newDriver(api, m.a), await newDriver(api, m.a)];
  const [v1, v2] = [await newVehicle(api, m.a, m.ids.biz7), await newVehicle(api, m.a, m.ids.biz7)];
  const first = await ok(assign(api, m.a, order.id, d1.id, v1.id));
  const again = await ok(assign(api, m.a, order.id, d1.id, v1.id));
  assert.deepEqual([again.change, again.driver_link], [null, null]);
  await ok(api.call("POST", `/tenant/v1/orders/${order.id}/events`, { token: m.a.adminToken, body: { type: "departed" } }));
  const changed = await ok(assign(api, m.a, order.id, d2.id, v2.id));
  assert.deepEqual([changed.change, changed.order.status, changed.order.fulfilment.departed_at], [true, "assigned", null], "新司机重新出发");
  assert.equal((await api.call("GET", "/driver/v1/trip", { token: first.driver_link.token })).status, 401, "旧司机的链接作废");
  assert.equal((await api.call("GET", "/driver/v1/trip", { token: changed.driver_link.token })).status, 200);
  const events = (await ok(api.call("GET", `/tenant/v1/orders/${order.id}`, { token: m.a.adminToken }))).events.map((event: any) => `${event.from_status}>${event.to_status}:${event.reason}`);
  assert.deepEqual(events, ["confirmed>assigned:ASSIGNED", "assigned>departed:DEPARTED", "departed>assigned:REASSIGNED"]);
  await ok(api.call("POST", `/tenant/v1/orders/${order.id}/events`, { token: m.a.adminToken, body: { type: "departed" } }));
  await ok(api.call("POST", `/tenant/v1/orders/${order.id}/events`, { token: m.a.adminToken, body: { type: "arrived" } }));
  const late = await assign(api, m.a, order.id, d1.id, v1.id);
  assert.deepEqual([late.status, late.body.error.code, late.body.error.details.status], [409, "ORDER_STATE_INVALID", "arrived"]);
  const audit = await api.db.owner.query<{ action: string }>("select action from audit_logs where resource = 'order' and resource_id = $1 order by id", [order.id]);
  assert.deepEqual(audit.rows.map((row) => row.action), ["assign", "update", "reassign", "update", "update"]);
});

test("派车要带订单的版本号：没带 428，旧的 409；两个人同时派同一张单，只有一个成功", async () => {
  const order = await seedOrder(api, m, "a", { serviceAt: new Date("2026-10-22T01:00:00Z") });
  const [d1, d2] = [await newDriver(api, m.a), await newDriver(api, m.a)];
  const [v1, v2] = [await newVehicle(api, m.a, m.ids.biz7), await newVehicle(api, m.a, m.ids.biz7)];
  const noVersion = await api.call("POST", `/tenant/v1/orders/${order.id}/assign`, { token: m.a.adminToken, body: { driver_id: d1.id, vehicle_id: v1.id } });
  assert.equal(noVersion.status, 428);
  const version = await orderVersion(api, m.a, order.id);
  const results = await Promise.all([assign(api, m.a, order.id, d1.id, v1.id, { version }), assign(api, m.a, order.id, d2.id, v2.id, { version })]);
  assert.deepEqual(results.map((res) => res.status).sort(), [200, 409]);
  assert.equal(results.find((res) => res.status === 409)?.body.error.code, "VERSION_CONFLICT");
  const rows = await api.db.owner.query("select 1 from order_assignments where order_id = $1", [order.id]);
  assert.equal(rows.rowCount, 1, "只有一条派车记录");
  assert.equal((await api.db.owner.query("select 1 from driver_links where order_id = $1 and revoked_at is null", [order.id])).rowCount, 1);
});

test("不符合订单要求的拒绝并逐项说明：驾照过期、不会客人要求的语言、非营业牌照 / 维修中、车型组降级、座位少；司机或车辆不存在是 400", async () => {
  const order = await seedOrder(api, m, "a", { serviceAt: new Date("2026-10-23T01:00:00Z"), driverLanguage: "zh" });
  const badDriver = await newDriver(api, m.a, { languages: ["ja"], license_expires_on: "2026-10-22" });
  const eco = await newVehicle(api, m.a, m.ids.eco4, { seats: 4 });
  const res = await assign(api, m.a, order.id, badDriver.id, eco.id);
  assert.equal(res.status, 422, res.text);
  assertMatchesOpenApi("POST", "/tenant/v1/orders/{id}/assign", res as never);
  assert.deepEqual(res.body.error.details.issues.map((issue: any) => issue.code), ["DRIVER_LICENSE_EXPIRED", "DRIVER_LANGUAGE_MISSING", "VEHICLE_GROUP_DOWNGRADE", "VEHICLE_SEATS_TOO_FEW"]);
  const repair = await newVehicle(api, m.a, m.ids.biz7, { status: "maintenance", plate_type: "private" });
  const good = await newDriver(api, m.a, { languages: ["zh"] });
  assert.deepEqual((await assign(api, m.a, order.id, good.id, repair.id)).body.error.details.issues.map((issue: any) => issue.code), ["VEHICLE_NOT_AVAILABLE", "VEHICLE_NOT_BUSINESS_PLATE"]);
  const missing = await assign(api, m.a, order.id, "99999999-9999-4999-8999-999999999999", eco.id);
  assert.deepEqual([missing.status, missing.body.error.details.issues[0].path], [400, "/driver_id"]);
  assert.equal((await api.call("GET", `/tenant/v1/orders/${order.id}`, { token: m.a.adminToken })).body.order.status, "confirmed", "什么都没改");
});

test("同一时段已有别的单：409 列出冲突，确认后才能派；前后错开足够远的不算冲突", async () => {
  const driver = await newDriver(api, m.a);
  const [v1, v2] = [await newVehicle(api, m.a, m.ids.biz7), await newVehicle(api, m.a, m.ids.biz7)];
  const first = await seedOrder(api, m, "a", { serviceAt: new Date("2026-10-24T01:00:00Z") });
  const overlapping = await seedOrder(api, m, "a", { serviceAt: new Date("2026-10-24T03:30:00Z") });
  const later = await seedOrder(api, m, "a", { serviceAt: new Date("2026-10-24T07:30:00Z") });
  await ok(assign(api, m.a, first.id, driver.id, v1.id));
  const conflict = await assign(api, m.a, overlapping.id, driver.id, v2.id);
  assert.equal(conflict.status, 409, conflict.text);
  assert.equal(conflict.body.error.code, "ASSIGNMENT_CONFLICT");
  assert.deepEqual(conflict.body.error.details.conflicts.map((entry: any) => [entry.resource, entry.order_no]), [["driver", first.orderNo]]);
  const assignable = await api.call("GET", `/tenant/v1/orders/${overlapping.id}/assignable`, { token: m.a.adminToken });
  assertMatchesOpenApi("GET", "/tenant/v1/orders/{id}/assignable", assignable);
  const entry = assignable.body.drivers.find((item: any) => item.driver.id === driver.id);
  assert.deepEqual([entry.assignable, entry.conflicts.map((c: any) => c.order_id)], [true, [first.id]]);
  assert.deepEqual(assignable.body.vehicles.find((item: any) => item.vehicle.id === v1.id).conflicts.map((c: any) => c.order_id), [first.id]);
  const confirmed = await assign(api, m.a, overlapping.id, driver.id, v2.id, { confirmConflicts: true });
  assert.equal(confirmed.status, 200, confirmed.text);
  assert.equal((await api.db.owner.query<{ conflict_confirmed: boolean }>("select conflict_confirmed from order_assignments where order_id = $1", [overlapping.id])).rows[0]?.conflict_confirmed, true);
  assert.equal((await assign(api, m.a, later.id, driver.id, v1.id)).status, 200, "03:30 那一单按 2 小时服务 + 前后 1 小时占到 06:30，07:30 的单（从 06:30 起占）不冲突");
});

test("并发：两张同一时段的单同时派给同一位司机，后到的一定看得到先到的那一张（不会两边都悄悄派成）", async () => {
  const driver = await newDriver(api, m.a);
  const [v1, v2] = [await newVehicle(api, m.a, m.ids.biz7), await newVehicle(api, m.a, m.ids.biz7)];
  const x = await seedOrder(api, m, "a", { serviceAt: new Date("2026-10-25T01:00:00Z") });
  const y = await seedOrder(api, m, "a", { serviceAt: new Date("2026-10-25T01:30:00Z") });
  const [vx, vy] = [await orderVersion(api, m.a, x.id), await orderVersion(api, m.a, y.id)];
  const results = await Promise.all([assign(api, m.a, x.id, driver.id, v1.id, { version: vx }), assign(api, m.a, y.id, driver.id, v2.id, { version: vy })]);
  assert.deepEqual(results.map((res) => res.status).sort(), [200, 409]);
  assert.equal(results.find((res) => res.status === 409)?.body.error.code, "ASSIGNMENT_CONFLICT");
});

test("可派的司机和车辆：停用的不列；不符合的带原因；权限只给管理员和调度", async () => {
  const order = await seedOrder(api, m, "a", { serviceAt: new Date("2026-10-26T01:00:00Z"), driverLanguage: "en" });
  const english = await newDriver(api, m.a, { languages: ["en"] });
  const japanese = await newDriver(api, m.a, { languages: ["ja"] });
  const gone = await newDriver(api, m.a, { status: "disabled" });
  const res = await ok(api.call("GET", `/tenant/v1/orders/${order.id}/assignable`, { token: m.a.adminToken }));
  const byId = new Map(res.drivers.map((entry: any) => [entry.driver.id, entry]));
  assert.equal((byId.get(english.id) as any).assignable, true);
  assert.deepEqual((byId.get(japanese.id) as any).issues.map((issue: any) => issue.code), ["DRIVER_LANGUAGE_MISSING"]);
  assert.equal(byId.has(gone.id), false);
  const readonly = await addTenantUser(api, m.a.adminToken, "ro@dispatch.test", "readonly");
  const dispatcher = await addTenantUser(api, m.a.adminToken, "dispatch@dispatch.test", "dispatch");
  assert.equal((await api.call("GET", `/tenant/v1/orders/${order.id}/assignable`, { token: readonly.token })).status, 403);
  assert.equal((await api.call("GET", `/tenant/v1/orders/${order.id}/assignable`, { token: dispatcher.token })).status, 200);
  const vehicle = await newVehicle(api, m.a, m.ids.biz7);
  assert.equal((await assign(api, { token: dispatcher.token }, order.id, english.id, vehicle.id)).status, 200, "调度能派车");
});

test("司机链接：重新生成后旧的作废、新的能用；吊销后不能用；没派车的单不能生成；审计", async () => {
  const order = await seedOrder(api, m, "a", { serviceAt: new Date("2026-10-27T01:00:00Z") });
  const notYet = await api.call("POST", `/tenant/v1/orders/${order.id}/driver-link`, { token: m.a.adminToken });
  assert.deepEqual([notYet.status, notYet.body.error.code], [409, "ORDER_STATE_INVALID"]);
  const assigned = await ok(assign(api, m.a, order.id, (await newDriver(api, m.a)).id, (await newVehicle(api, m.a, m.ids.biz7)).id));
  const reissued = await api.call("POST", `/tenant/v1/orders/${order.id}/driver-link`, { token: m.a.adminToken });
  assertMatchesOpenApi("POST", "/tenant/v1/orders/{id}/driver-link", reissued);
  assert.notEqual(reissued.body.driver_link.token, assigned.driver_link.token);
  assert.equal((await api.call("GET", "/driver/v1/trip", { token: assigned.driver_link.token })).status, 401);
  assert.equal((await api.call("GET", "/driver/v1/trip", { token: reissued.body.driver_link.token })).status, 200);
  assert.equal((await api.call("DELETE", `/tenant/v1/orders/${order.id}/driver-link`, { token: m.a.adminToken })).status, 204);
  assert.equal((await api.call("GET", "/driver/v1/trip", { token: reissued.body.driver_link.token })).status, 401);
  assert.equal((await api.call("DELETE", `/tenant/v1/orders/${order.id}/driver-link`, { token: m.a.adminToken })).status, 404, "已经没有有效的链接");
  const actions = await api.db.owner.query<{ action: string }>("select action from audit_logs where resource = 'driver_link' order by id");
  assert.ok(actions.rows.map((row) => row.action).join(",").includes("issue,revoke"));
});

test("调度系统回传：出发 → 到达 → 接到客人 → 完成，不能跳步不能重复；带定位算出距上车点的距离；包车完成要填实际时长和里程", async () => {
  const order = await seedOrder(api, m, "a", { serviceAt: new Date("2026-10-28T01:00:00Z") });
  await ok(assign(api, m.a, order.id, (await newDriver(api, m.a)).id, (await newVehicle(api, m.a, m.ids.biz7)).id));
  const report = (body: Record<string, unknown>) => api.call("POST", `/tenant/v1/orders/${order.id}/events`, { token: m.a.adminToken, body });
  const skip = await report({ type: "arrived" });
  assert.deepEqual([skip.status, skip.body.error.code, skip.body.error.details], [409, "ORDER_STATE_INVALID", { status: "assigned", action: "arrived" }]);
  const departed = await report({ type: "departed", location: { lng: 139.76, lat: 35.68, accuracy_m: 20 } });
  assertMatchesOpenApi("POST", "/tenant/v1/orders/{id}/events", departed);
  assert.equal((await report({ type: "departed" })).status, 409, "不能重复");
  const arrived = await ok(report({ type: "arrived", location: { lng: 140.3887, lat: 35.7700 } }));
  assert.equal(arrived.order.status, "arrived");
  assert.ok(arrived.order.fulfilment.arrival_distance_m > 100 && arrived.order.fulfilment.arrival_distance_m < 200, String(arrived.order.fulfilment.arrival_distance_m));
  assert.equal(arrived.order.fulfilment.arrival_within_range, true);
  assert.equal((await ok(report({ type: "picked_up" }))).order.status, "in_service");
  const done = await ok(report({ type: "completed", actual: { minutes: 80, km: 70 } }));
  assert.deepEqual([done.order.status, done.order.fulfilment.actual_minutes, done.order.fulfilment.actual_km], ["completed", 80, 70]);
  assert.equal((await report({ type: "completed" })).status, 409);
  const locations = await api.db.owner.query<{ kind: string }>("select kind from order_locations where order_id = $1 order by seq", [order.id]);
  assert.deepEqual(locations.rows.map((row) => row.kind), ["departed", "arrived"]);
});

test("包车完成时必须填实际时长和里程", async () => {
  const order = await seedOrder(api, m, "a", { serviceAt: new Date("2026-10-28T05:00:00Z") });
  await api.db.owner.query("update orders set category = 'charter', place_id = null, direction = null, package_hours = 5, flight_no = null, pickup = dropoff, dropoff = null where id = $1", [order.id]);
  await ok(assign(api, m.a, order.id, (await newDriver(api, m.a)).id, (await newVehicle(api, m.a, m.ids.biz7)).id));
  for (const type of ["departed", "arrived", "picked_up"]) await ok(api.call("POST", `/tenant/v1/orders/${order.id}/events`, { token: m.a.adminToken, body: { type } }));
  const missing = await api.call("POST", `/tenant/v1/orders/${order.id}/events`, { token: m.a.adminToken, body: { type: "completed", actual: { minutes: 300 } } });
  assert.deepEqual([missing.status, missing.body.error.details.issues.map((issue: any) => issue.path)], [400, ["/actual/km"]]);
  assert.equal((await api.call("POST", `/tenant/v1/orders/${order.id}/events`, { token: m.a.adminToken, body: { type: "completed", actual: { minutes: 320, km: 140 } } })).status, 200);
});

test("超时未派车：过了截止时间才提醒，每张单只提醒一次；列表能按「超时未派车」筛选并标红；用车前 1 小时仍未出发也提醒", async () => {
  const soon = await seedOrder(api, m, "b", { serviceAt: new Date(api.clock.now().getTime() + 30 * 3_600_000) });
  const far = await seedOrder(api, m, "b", { serviceAt: new Date(api.clock.now().getTime() + 10 * 24 * 3_600_000) });
  const before = await api.app.orderJobs.remind();
  assert.equal(before.dispatchOverdue, 0);
  api.clock.advance(7 * 3_600_000);
  const b = { adminToken: await relogin(m.b.adminEmail) };
  const due = await api.app.orderJobs.remind();
  assert.equal(due.dispatchOverdue, 1, "用车前 24 小时到了");
  assert.equal((await api.app.orderJobs.remind()).dispatchOverdue, 0, "只提醒一次");
  assert.match(api.logs(), /order\.dispatch_overdue/);
  const list = await api.call("GET", "/tenant/v1/orders?dispatch=overdue", { token: b.adminToken });
  assertMatchesOpenApi("GET", "/tenant/v1/orders", list);
  assert.deepEqual(list.body.items.map((item: any) => item.id), [soon.id]);
  assert.equal(list.body.items[0].dispatch.overdue, true);
  assert.ok(list.body.items[0].dispatch.overdue_at);
  const unassigned = await api.call("GET", "/tenant/v1/orders?dispatch=unassigned", { token: b.adminToken });
  assert.ok(unassigned.body.items.some((item: any) => item.id === far.id && item.dispatch.overdue === false));

  const fixture = { ...m.b, adminToken: b.adminToken };
  await ok(assign(api, fixture, soon.id, (await newDriver(api, fixture)).id, (await newVehicle(api, fixture, m.ids.biz7)).id));
  api.clock.advance(22 * 3_600_000);
  const departure = await api.app.orderJobs.remind();
  assert.equal(departure.departureOverdue, 1, "用车前 1 小时还没出发");
  assert.match(api.logs(), /order\.departure_overdue/);
  assert.ok((await ok(api.call("GET", `/tenant/v1/orders/${soon.id}`, { token: await relogin(m.b.adminEmail) }))).order.dispatch.departure_overdue_at);
});

test("付款时距用车不足 24 小时：截止时间是付款后 2 小时", async () => {
  const now = api.clock.now();
  const order = await seedOrder(api, m, "a", { serviceAt: new Date(now.getTime() + 10 * 3_600_000), confirmedAt: now });
  const body = await ok(api.call("GET", `/tenant/v1/orders/${order.id}`, { token: await relogin(m.a.adminEmail) }));
  assert.equal(body.order.dispatch.due_at, new Date(now.getTime() + 2 * 3_600_000).toISOString());
  assert.equal(body.order.dispatch.escalation_at, new Date(now.getTime() + 4 * 3_600_000).toISOString(), "用车前 6 小时");
});
