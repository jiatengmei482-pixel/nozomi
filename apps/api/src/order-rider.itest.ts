/**
 * M8-32（ADR 0082）：乘车人和举牌姓名是订单的正式字段，经真实接口、真实 PostgreSQL。
 * - 供应商订单详情、司机页单独显示举牌姓名、乘车人姓名和电话；联系人（预订人）照旧；
 * - 跨租户读不到（别家的供应商看不到这一单）。下单的校验、加密、运营打码、查看原文和运营代改联系人在 site-by-points.itest.ts。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { type TestApi, createTestApi } from "./testing/api.ts";
import { type Market, buildMarket, ok } from "./testing/market.ts";
import { assign, newDriver, newVehicle, seedOrder } from "./testing/dispatch.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";

let api: TestApi;
let m: Market;
const SERVICE = new Date("2026-10-20T01:00:00Z");
const RIDER = { signName: "LI HUA", name: "李华", phone: "+819055556666" };
const RIDER_JSON = { sign_name: "LI HUA", name: "李华", phone: "+819055556666" };

before(async () => {
  api = await createTestApi();
  m = await buildMarket(api);
});
after(() => api.close());

test("供应商订单详情、司机页：联系人照旧，乘车人和举牌姓名单独一项；没有的单 rider 为 null；别家供应商读不到", async () => {
  const order = await seedOrder(api, m, "a", { serviceAt: SERVICE, rider: RIDER });
  const detail = await api.call("GET", `/tenant/v1/orders/${order.id}`, { token: m.a.adminToken });
  assertMatchesOpenApi("GET", "/tenant/v1/orders/{id}", detail);
  assert.deepEqual([detail.body.order.passenger, detail.body.order.rider], [{ name: "王小明", phone: "+819012345678", email: "guest@example.com" }, RIDER_JSON]);
  assert.equal((await api.call("GET", `/tenant/v1/orders/${order.id}`, { token: m.b.adminToken })).status, 404, "别家供应商读不到");

  const driver = await newDriver(api, m.a);
  const vehicle = await newVehicle(api, m.a, m.ids.biz7);
  const assigned = await ok(assign(api, m.a, order.id, driver.id, vehicle.id));
  const trip = await api.call("GET", "/driver/v1/trip", { token: assigned.driver_link.token });
  assert.equal(trip.status, 200, trip.text);
  assertMatchesOpenApi("GET", "/driver/v1/trip", trip);
  assert.deepEqual([trip.body.order.passenger, trip.body.order.rider], [{ name: "王小明", phone: "+819012345678" }, RIDER_JSON]);

  const without = await seedOrder(api, m, "a", { serviceAt: SERVICE });
  const plain = await ok(api.call("GET", `/tenant/v1/orders/${without.id}`, { token: m.a.adminToken }));
  assert.equal(plain.order.rider, null);
});
