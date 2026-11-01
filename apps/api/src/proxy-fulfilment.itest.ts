/**
 * M4-18：运营代供应商回传履约（ADR 0052），经真实接口、真实 PostgreSQL；收款服务用替身。
 * 按路径逐条对应 ADR：状态机不能绕开；权限和数据范围；留痕和谁看得到什么；完成走双人复核；和供应商、司机并发；no-show 证据不能绕开；通知不重复。
 */
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { LOCAL_WEBHOOK_HOST, TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";
import { withTenantTx } from "./db/context.ts";
import { assign, newDriver, newVehicle } from "./testing/dispatch.ts";
import { type Market, type Staff, addStaff, allKeys, buildMarket, newChannel, ok } from "./testing/market.ts";
import { platformLogin, tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";

const HOUR = 3_600_000;
const MINUTE = 60_000;

let api: TestApi;
let m: Market;
let flow: SalesFlow;
let support: Staff;
let finance: Staff;
let ops2: Staff;

before(async () => {
  const pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  flow = await salesFlow(api, m, pay);
  support = await addStaff(api, m.root, "cs@platform.test", "customer_service");
  finance = await addStaff(api, m.root, "finance@platform.test", "finance");
  ops2 = await addStaff(api, m.root, "ops2@platform.test", "operations");
});
after(() => api.close());

const iso = (ms: number): string => new Date(ms).toISOString();
const soon = (hours: number): string => iso(api.clock.now().getTime() + hours * HOUR).replace(/\.\d{3}Z$/, "Z");
const ago = (minutes: number): string => iso(api.clock.now().getTime() - minutes * MINUTE);
const ops = (): Promise<string> => platformLogin(api, m.staff.operations.email);

/** 乙车队中标的已付款订单。`hours` 是离用车还有多久。 */
async function paidOrder(hours = 1): Promise<string> {
  const id = (await flow.paidOrder({ serviceTime: soon(72) })).id;
  // 下单要满足提前量；代传只在用车前后才有意义，直接把用车时间挪到眼前
  await api.db.owner.query("update orders set service_at = $2 where id = $1", [id, new Date(api.clock.now().getTime() + hours * HOUR)]);
  return id;
}

async function dispatched(hours = 1): Promise<{ orderId: string; tenantToken: string; driverToken: string }> {
  const orderId = await paidOrder(hours);
  const tenantToken = await tenantLogin(api, m.b.adminEmail);
  const who = { ...m.b, adminToken: tenantToken };
  const result = await ok(assign(api, who, orderId, (await newDriver(api, who)).id, (await newVehicle(api, who, m.ids.biz7)).id));
  api.clock.advance(MINUTE);
  return { orderId, tenantToken, driverToken: result.driver_link.token };
}

const detailOf = async (orderId: string, token?: string): Promise<any> => ok(api.call("GET", `/platform/v1/orders/${orderId}`, { token: token ?? (await ops()) }));

/** 用现在的版本号代传一步。 */
async function proxy(orderId: string, body: Record<string, unknown>, token?: string, version?: number) {
  const who = token ?? (await ops());
  const current = version ?? (await detailOf(orderId, await ops())).order.version;
  return api.call("POST", `/platform/v1/orders/${orderId}/events`, { token: who, headers: { "if-match": String(current) }, body: { occurred_at: ago(0), reason: "供应商调度系统故障，电话确认", ...body } });
}

/** 批准一条代传复核（接到客人、完成）。 */
const approve = async (approvalId: string): Promise<void> => {
  await ok(api.call("POST", `/platform/v1/approvals/${approvalId}/approve`, { token: await platformLogin(api, finance.email), body: {} }));
};

async function toInService(orderId: string): Promise<void> {
  for (const type of ["departed", "arrived"]) {
    await ok(proxy(orderId, { type }));
    api.clock.advance(MINUTE);
  }
  await approve((await ok(proxy(orderId, { type: "picked_up" }), 202)).approval.id);
  api.clock.advance(MINUTE);
}

test("代传出发、到达：立即生效，履约时间是运营填的时间，流水标明平台代传并留下系统收到的时间；审计记下谁、为什么", async () => {
  const { orderId } = await dispatched();
  api.clock.advance(20 * MINUTE);
  const departedAt = ago(10);
  const res = await proxy(orderId, { type: "departed", occurred_at: departedAt });
  assertMatchesOpenApi("POST", "/platform/v1/orders/{id}/events", res);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.status, "departed");
  const recordedAt = api.clock.now().toISOString();

  const detail = await detailOf(orderId);
  assert.equal(detail.order.fulfilment.departed_at, departedAt);
  const event = detail.events.at(-1);
  assert.deepEqual(
    [event.to_status, event.actor, event.occurred_at, event.source, event.recorded_at, event.proxy.reason, event.proxy.requested_by, event.proxy.approved_by],
    ["departed", "platform_user", departedAt, "platform_proxy", recordedAt, "供应商调度系统故障，电话确认", m.staff.operations.id, null],
  );
  assert.equal(detail.pending_proxy_review, null);

  const audit = await api.db.owner.query("select actor_email, tenant_id, after from audit_logs where resource = 'order' and resource_id = $1 and action = 'update' order by id desc limit 1", [orderId]);
  assert.deepEqual([audit.rows[0].actor_email, audit.rows[0].tenant_id, audit.rows[0].after.event, audit.rows[0].after.source, audit.rows[0].after.reason, audit.rows[0].after.occurred_at], [m.staff.operations.email, null, "departed", "platform_proxy", "供应商调度系统故障，电话确认", departedAt]);
  assert.equal((await proxy(orderId, { type: "arrived" })).status, 200);
  assert.equal((await detailOf(orderId)).order.status, "arrived");
});

test("供应商看得到这一步是平台代传的和两个时间，看不到原因、操作人（规则 4：也没有对外价和加价比例）；供应商和司机自己报的事件没有来源标记", async () => {
  const { orderId, tenantToken } = await dispatched();
  await ok(api.call("POST", `/tenant/v1/orders/${orderId}/events`, { token: tenantToken, body: { type: "departed" } }));
  api.clock.advance(MINUTE);
  await ok(proxy(orderId, { type: "arrived", reason: "客人来电说对外价 99999 太贵，加价 12%" }));
  const res = await api.call("GET", `/tenant/v1/orders/${orderId}`, { token: tenantToken });
  assertMatchesOpenApi("GET", "/tenant/v1/orders/{id}", res);
  const events = res.body.events;
  const own = events.find((event: any) => event.to_status === "departed");
  assert.deepEqual([own.actor, own.source, own.recorded_at], ["tenant_user", null, null]);
  const proxied = events.find((event: any) => event.to_status === "arrived");
  assert.deepEqual([proxied.actor, proxied.source], ["platform_user", "platform_proxy"]);
  assert.ok(proxied.recorded_at);
  assert.equal("proxy" in proxied, false);
  assert.ok(!res.text.includes("客人来电"), "原因不给供应商");
  assert.ok(!res.text.includes(m.staff.operations.id), "操作人不给供应商");
  const keys = allKeys(res.body);
  for (const key of ["sell", "markup_bp", "markup", "pending_proxy_review"]) assert.ok(!keys.has(key), key);
  const logs = await ok(api.call("GET", `/tenant/v1/audit-logs?resource=order&resource_id=${orderId}`, { token: tenantToken }));
  assert.ok(!JSON.stringify(logs).includes("客人来电"), "供应商的操作日志里也没有");
});

test("Webhook：代传照常推给供应商的调度系统，带来源和发生时间；状态流水和推送都只有一条", async () => {
  const { orderId, tenantToken } = await dispatched();
  const hook = await api.call("PUT", "/tenant/v1/webhooks", { token: tenantToken, body: { url: `https://${LOCAL_WEBHOOK_HOST}/hook`, events: ["order.status_changed"] } });
  assert.equal(hook.status, 201, hook.text);
  const occurredAt = ago(0);
  await ok(proxy(orderId, { type: "departed", occurred_at: occurredAt }));
  const rows = (await api.db.owner.query("select event_data from webhook_deliveries where order_id = $1 and event_type = 'order.status_changed'", [orderId])).rows;
  assert.deepEqual(rows.map((row) => [row.event_data.to_status, row.event_data.source, row.event_data.occurred_at]), [["departed", "platform_proxy", occurredAt]]);
  assert.equal((await api.db.owner.query("select 1 from order_events where order_id = $1 and to_status = 'departed'", [orderId])).rowCount, 1);
});

test("状态机不能绕开：跳步、重复一律 409；待派车的单不能代传（不能跳过派车）", async () => {
  const orderId = await paidOrder();
  const notAssigned = await proxy(orderId, { type: "departed" });
  assert.deepEqual([notAssigned.status, notAssigned.body.error.code, notAssigned.body.error.details.status], [409, "ORDER_STATE_INVALID", "confirmed"]);
  const { orderId: dispatchedId } = await dispatched();
  const skip = await proxy(dispatchedId, { type: "arrived" });
  assert.deepEqual([skip.status, skip.body.error.code], [409, "ORDER_STATE_INVALID"]);
  const skipToDone = await proxy(dispatchedId, { type: "completed" });
  assert.deepEqual([skipToDone.status, skipToDone.body.error.code], [409, "ORDER_STATE_INVALID"], "跳到完成也不会发起复核");
  await ok(proxy(dispatchedId, { type: "departed" }));
  const again = await proxy(dispatchedId, { type: "departed" });
  assert.deepEqual([again.status, again.body.error.code], [409, "ORDER_STATE_INVALID"]);
});

test("未付款、已取消、救援中、no-show 审核中的单不能代传", async () => {
  const unpaid = (await flow.unpaidOrder({ serviceTime: soon(72) })).id;
  const res = await proxy(unpaid, { type: "departed" });
  assert.deepEqual([res.status, res.body.error.code, res.body.error.message], [409, "ORDER_STATE_INVALID", "这一单还没付款，不能代传履约"]);

  const cancelled = await dispatched();
  await ok(api.call("POST", `/sales/v1/orders/${cancelled.orderId}/cancel`, { token: await flow.token(), body: {} }));
  const refusedCancelled = await proxy(cancelled.orderId, { type: "departed" });
  assert.deepEqual([refusedCancelled.status, refusedCancelled.body.error.code, refusedCancelled.body.error.message], [409, "ORDER_STATE_INVALID", "这一单已取消，不能代传履约"]);

  for (const [status, message] of [["rescue_pending", "这一单在救援改派中或已转给其他供应商，不能代传履约"], ["no_show_claimed", "订单当前的状态不允许这个操作"]] as const) {
    const { orderId } = await dispatched();
    await api.db.owner.query("update orders set status = $2 where id = $1", [orderId, status]);
    const refused = await proxy(orderId, { type: "departed" });
    assert.deepEqual([refused.status, refused.body.error.code, refused.body.error.message], [409, "ORDER_STATE_INVALID", message], status);
    assert.equal((await api.db.owner.query("select 1 from order_events where order_id = $1 and to_status = 'departed'", [orderId])).rowCount, 0);
  }
});

test("必须写原因、带版本号；发生时间不合规则、版本过期的都不生效；定位、no-show 不被接受", async () => {
  const { orderId } = await dispatched();
  const version = (await detailOf(orderId)).order.version;
  const ops2Token = await platformLogin(api, ops2.email);
  const call = (body: Record<string, unknown>, headers: Record<string, string> = { "if-match": String(version) }) => api.call("POST", `/platform/v1/orders/${orderId}/events`, { token: ops2Token, headers, body });
  const good = { type: "departed", occurred_at: ago(0), reason: "故障" };
  assert.equal((await call({ type: "departed", occurred_at: ago(0) })).status, 400, "没原因");
  assert.equal((await call({ ...good, reason: "   " })).status, 400, "原因全是空白");
  assert.equal((await call({ type: "departed", reason: "故障" })).status, 400, "没时间");
  assert.equal((await call({ ...good, location: { lng: 140.38, lat: 35.76 } })).status, 400, "不接受定位");
  assert.equal((await call({ ...good, type: "no_show" })).status, 400, "no-show 不在这个接口里");
  assert.equal((await call(good, {})).status, 428, "没带版本号");
  const stale = await call(good, { "if-match": String(version + 5) });
  assert.deepEqual([stale.status, stale.body.error.code], [409, "VERSION_CONFLICT"]);

  const reasonOf = async (occurredAt: string): Promise<string> => (await call({ ...good, occurred_at: occurredAt })).body.error.details.issues[0].reason;
  assert.equal(await reasonOf(iso(api.clock.now().getTime() + 1_000)), "IN_FUTURE");
  assert.equal(await reasonOf(ago(60 * 24 * 2)), "TOO_EARLY");
  const assignedAt = (await detailOf(orderId)).order.dispatch.assigned_at;
  assert.equal(await reasonOf(iso(new Date(assignedAt).getTime() - 2 * MINUTE)), "BEFORE_PREVIOUS");
  assert.equal((await detailOf(orderId)).order.status, "assigned");
  assert.equal((await call(good)).status, 200);
});

test("权限：只读、客服、财务、主数据都不能用（403）；供应商的令牌、没登录的不能用；不存在的单 404", async () => {
  const { orderId, tenantToken } = await dispatched();
  const version = (await detailOf(orderId)).order.version;
  for (const email of [m.staff.readonly.email, support.email, finance.email, m.staff.masterData.email]) {
    const res = await proxy(orderId, { type: "departed" }, await platformLogin(api, email), version);
    assert.deepEqual([res.status, res.body.error.details.required], [403, "order.proxy_fulfilment"], email);
  }
  assert.equal((await proxy(orderId, { type: "departed" }, tenantToken, version)).status, 401);
  assert.equal((await api.call("POST", `/platform/v1/orders/${orderId}/events`, { headers: { "if-match": String(version) }, body: { type: "departed", occurred_at: ago(0), reason: "x" } })).status, 401);
  assert.equal((await proxy(randomUUID(), { type: "departed" }, await ops(), version)).status, 404);
  assert.equal((await detailOf(orderId)).order.status, "assigned");
});

/** 自建角色：只勾代传履约，数据范围按参数。 */
async function scopedStaff(name: string, scope: { city_ids: string[] | null; channel_ids: string[] | null }, grants: string[] = ["orders:view", "order_proxy:view", "order_proxy:edit"]): Promise<string> {
  const role = await ok(api.call("POST", "/platform/v1/roles", { token: m.root, body: { name, grants, data_scope: scope } }), 201);
  const email = `scope-${randomUUID().slice(0, 8)}@platform.test`;
  const invited = await ok(api.call("POST", "/platform/v1/staff", { token: m.root, body: { email, name, role: role.key } }), 201);
  await ok(api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.invite.token, password: TEST_PASSWORD } }));
  return platformLogin(api, email);
}

test("数据范围：范围外的订单和不存在一样（404），什么都不变；范围内的自建角色能用；只勾「订单 · 编辑」的自建角色不会带上这个权限", async () => {
  const { orderId } = await dispatched();
  const version = (await detailOf(orderId)).order.version;
  const osaka = await proxy(orderId, { type: "departed" }, await scopedStaff("大阪代传", { city_ids: [m.ids.osaka], channel_ids: null }), version);
  assert.deepEqual([osaka.status, osaka.body.error.code], [404, "NOT_FOUND"]);
  const otherChannel = await proxy(orderId, { type: "departed" }, await scopedStaff("别的渠道代传", { city_ids: null, channel_ids: [(await newChannel(api, m.staff.cm1.token, { name: `别的渠道-${randomUUID().slice(0, 4)}` })).id] }), version);
  assert.equal(otherChannel.status, 404);
  assert.equal((await detailOf(orderId)).order.status, "assigned");
  const oldRole = await proxy(orderId, { type: "departed" }, await scopedStaff("老的订单编辑", { city_ids: null, channel_ids: null }, ["orders:view", "orders:edit"]), version);
  assert.equal(oldRole.status, 403);
  const tokyo = await proxy(orderId, { type: "departed" }, await scopedStaff("东京代传", { city_ids: [m.ids.tokyo], channel_ids: [flow.channelId] }), version);
  assert.equal(tokyo.status, 200, tokyo.text);
});

test("完成走双人复核：提交后不生效；发起人不能批；客服不能批；另一位财务批准才完成，流水记下发起人和批准人，进账单的状态只有一条", async () => {
  const { orderId } = await dispatched();
  await toInService(orderId);
  const completedAt = ago(0);
  const res = await proxy(orderId, { type: "completed", occurred_at: completedAt });
  assertMatchesOpenApi("POST", "/platform/v1/orders/{id}/events", res);
  assert.deepEqual([res.status, res.body.approval.kind, res.body.approval.status, res.body.approval.resource_id], [202, "order.proxy_complete", "pending", orderId]);
  const detail = await detailOf(orderId);
  assert.equal(detail.order.status, "in_service", "还没生效");
  assert.equal(detail.order.fulfilment.completed_at, null);
  assert.deepEqual(detail.pending_proxy_review.approval_id, res.body.approval.id);
  assertMatchesOpenApi("GET", "/platform/v1/orders/{id}", await api.call("GET", `/platform/v1/orders/${orderId}`, { token: await ops() }));

  const approval = res.body.approval.id;
  const again = await proxy(orderId, { type: "completed" });
  assert.deepEqual([again.status, again.body.error.code, again.body.error.details.approval_id], [409, "PROXY_REVIEW_PENDING", approval]);
  const self = await api.call("POST", `/platform/v1/approvals/${approval}/approve`, { token: await ops(), body: {} });
  assert.equal(self.body.error.code, "APPROVAL_SELF_REVIEW");
  assert.equal((await api.call("POST", `/platform/v1/approvals/${approval}/approve`, { token: await platformLogin(api, support.email), body: {} })).status, 403, "客服不能批");
  assert.equal((await api.call("POST", `/platform/v1/approvals/${approval}/approve`, { token: await platformLogin(api, m.staff.readonly.email), body: {} })).status, 403, "只读不能批");

  api.clock.advance(10 * MINUTE);
  const approved = await api.call("POST", `/platform/v1/approvals/${approval}/approve`, { token: await platformLogin(api, finance.email), body: {} });
  assert.equal(approved.status, 200, approved.text);
  const done = await detailOf(orderId);
  assert.deepEqual([done.order.status, done.order.fulfilment.completed_at, done.pending_proxy_review], ["completed", completedAt, null]);
  const event = done.events.at(-1);
  assert.deepEqual([event.to_status, event.source, event.proxy.requested_by, event.proxy.approved_by, event.proxy.approval_id, event.recorded_at], ["completed", "platform_proxy", m.staff.operations.id, finance.id, approval, api.clock.now().toISOString()]);
  const audit = await api.db.owner.query("select actor_email, after from audit_logs where resource = 'order' and resource_id = $1 and action = 'update' order by id desc limit 1", [orderId]);
  assert.deepEqual([audit.rows[0].actor_email, audit.rows[0].after.requested_by, audit.rows[0].after.approval_id], [finance.email, m.staff.operations.id, approval]);
  const requestAudit = await api.db.owner.query("select actor_email from audit_logs where resource = 'approval' and resource_id = $1 and action = 'request'", [approval]);
  assert.deepEqual(requestAudit.rows.map((row) => row.actor_email), [m.staff.operations.email]);
  assert.equal((await api.db.owner.query("select 1 from order_events where order_id = $1 and to_status = 'completed'", [orderId])).rowCount, 1);
});

test("复核中供应商自己回传了完成：批准只能得到「已过时」，不会完成两次；驳回后可以重新发起；两位运营可以互审", async () => {
  const stale = await dispatched();
  await toInService(stale.orderId);
  const first = await ok(proxy(stale.orderId, { type: "completed" }), 202);
  await ok(api.call("POST", `/tenant/v1/orders/${stale.orderId}/events`, { token: stale.tenantToken, body: { type: "completed" } }));
  const refused = await api.call("POST", `/platform/v1/approvals/${first.approval.id}/approve`, { token: await platformLogin(api, ops2.email), body: {} });
  assert.deepEqual([refused.status, refused.body.error.code], [409, "APPROVAL_STALE"]);
  assert.equal((await api.db.owner.query("select 1 from order_events where order_id = $1 and to_status = 'completed'", [stale.orderId])).rowCount, 1);
  const rejected = await api.call("POST", `/platform/v1/approvals/${first.approval.id}/reject`, { token: await platformLogin(api, ops2.email), body: { note: "供应商已自己回传" } });
  assert.equal(rejected.status, 200, rejected.text);

  const { orderId } = await dispatched();
  await toInService(orderId);
  const asked = await ok(proxy(orderId, { type: "completed" }), 202);
  await ok(api.call("POST", `/platform/v1/approvals/${asked.approval.id}/withdraw`, { token: await ops(), body: {} }));
  assert.equal((await detailOf(orderId)).pending_proxy_review, null);
  const retried = await ok(proxy(orderId, { type: "completed" }), 202);
  await ok(api.call("POST", `/platform/v1/approvals/${retried.approval.id}/approve`, { token: await platformLogin(api, ops2.email), body: {} }));
  assert.equal((await detailOf(orderId)).order.status, "completed");
});

test("复核的数据范围：范围外的审核人看不到（404）", async () => {
  const { orderId } = await dispatched();
  await toInService(orderId);
  const asked = await ok(proxy(orderId, { type: "completed" }), 202);
  const osakaFinance = await scopedStaff("大阪财务", { city_ids: [m.ids.osaka], channel_ids: null }, ["orders:view", "orders:review", "approvals:view"]);
  assert.equal((await api.call("POST", `/platform/v1/approvals/${asked.approval.id}/approve`, { token: osakaFinance, body: {} })).status, 404);
  assert.equal((await detailOf(orderId)).order.status, "in_service");
});

test("包车完成必须填实际时长和里程：发起时就拦下；填了的批准后写进订单", async () => {
  const { orderId } = await dispatched();
  await api.db.owner.query("update orders set category = 'charter', place_id = null, direction = null, package_hours = 5, flight_no = null, pickup = dropoff, dropoff = null where id = $1", [orderId]);
  await toInService(orderId);
  const missing = await proxy(orderId, { type: "completed", actual: { minutes: 300 } });
  assert.deepEqual([missing.status, missing.body.error.details.issues.map((issue: any) => issue.path)], [400, ["/actual/km"]]);
  const asked = await ok(proxy(orderId, { type: "completed", actual: { minutes: 320, km: 140 } }), 202);
  await ok(api.call("POST", `/platform/v1/approvals/${asked.approval.id}/approve`, { token: await platformLogin(api, finance.email), body: {} }));
  const { fulfilment } = (await detailOf(orderId)).order;
  assert.deepEqual([fulfilment.actual_minutes, fulfilment.actual_km], [320, 140]);
});

test("和供应商、司机并发：同一步同时到只有一个成功，另一个 409，流水和通知都只有一条；结果和先后无关", async () => {
  for (let round = 0; round < 4; round += 1) {
    const { orderId, tenantToken, driverToken } = await dispatched();
    const version = (await detailOf(orderId)).order.version;
    const token = await ops();
    const other = round % 2 === 0 ? api.call("POST", `/tenant/v1/orders/${orderId}/events`, { token: tenantToken, body: { type: "departed" } }) : api.call("POST", "/driver/v1/trip/events", { token: driverToken, body: { type: "departed" } });
    const [a, b] = await Promise.all([other, proxy(orderId, { type: "departed" }, token, version)]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409], `${a.text} ${b.text}`);
    assert.equal((await detailOf(orderId)).order.status, "departed");
    assert.equal((await api.db.owner.query("select 1 from order_events where order_id = $1 and to_status = 'departed'", [orderId])).rowCount, 1);
    const version2 = (await detailOf(orderId)).order.version;
    const [c, d] = await Promise.all([proxy(orderId, { type: "arrived" }, token, version2), api.call("POST", `/tenant/v1/orders/${orderId}/events`, { token: tenantToken, body: { type: "arrived" } })]);
    assert.deepEqual([c.status, d.status].sort(), [200, 409]);
    assert.equal((await api.db.owner.query("select 1 from notification_events where order_id = $1 and event = 'order.driver_arrived'", [orderId])).rowCount, 1, "通知事件只有一条");
  }
});

test("通知照常触发：代传到达排一条「司机已到达」，和供应商回传的同一个事件", async () => {
  const { orderId } = await dispatched();
  await ok(proxy(orderId, { type: "departed" }));
  api.clock.advance(MINUTE);
  await ok(proxy(orderId, { type: "arrived" }));
  const rows = (await api.db.owner.query("select event, dedupe_key from notification_events where order_id = $1 and event = 'order.driver_arrived'", [orderId])).rows;
  assert.equal(rows.length, 1);
});

test("no-show 不能绕开：代传「已到达」之后司机的 no-show 第 1 项不满足，提交被拒；司机自己点的到达不受影响", async () => {
  const proxied = await dispatched();
  await ok(proxy(proxied.orderId, { type: "departed" }));
  api.clock.advance(MINUTE);
  await ok(proxy(proxied.orderId, { type: "arrived" }));
  const trip = await ok(api.call("GET", "/driver/v1/trip", { token: proxied.driverToken }));
  assert.equal(trip.order?.status ?? trip.status, "arrived");
  const noShow = await api.call("POST", "/driver/v1/trip/no-show", { token: proxied.driverToken, body: {} });
  assert.equal(noShow.status, 422, noShow.text);
  assert.equal(noShow.body.error.code, "NO_SHOW_EVIDENCE_INCOMPLETE");
  assert.ok(noShow.body.error.details.missing.includes("arrived_on_time_nearby"));
  const repeat = await api.call("POST", "/driver/v1/trip/events", { token: proxied.driverToken, body: { type: "arrived", location: { lng: 140.389, lat: 35.769 } } });
  assert.equal(repeat.status, 409, "司机不能再重复点到达来补证据");

  const own = await dispatched();
  await ok(proxy(own.orderId, { type: "departed" }));
  api.clock.advance(MINUTE);
  const arrived = await api.call("POST", "/driver/v1/trip/events", { token: own.driverToken, body: { type: "arrived", location: { lng: 140.389, lat: 35.769 } } });
  assert.equal(arrived.status, 200, arrived.text);
  assert.ok((await detailOf(own.orderId)).order.fulfilment.arrival_distance_m !== null, "只代传了出发的，司机自己到达的距离照常记");
});

// 时钟走了 8 天，放在最后
test("发生时间不能早于 7 天前：用车过了很久才补录的，要走工单", async () => {
  const { orderId } = await dispatched();
  const version = (await detailOf(orderId)).order.version;
  api.clock.advance(8 * 24 * HOUR);
  const res = await proxy(orderId, { type: "departed", occurred_at: iso(api.clock.now().getTime() - 7 * 24 * HOUR - 1_000) }, undefined, version);
  assert.deepEqual([res.status, res.body.error.details.issues[0].reason], [400, "TOO_OLD"]);
});

test("代传「接到客人」也要复核：提交后仍是已到达，客人还能取消；发起人不能批；批准后才进服务中，流水记下发起人和批准人；供应商抢先回传的只能驳回；单人路径不存在", async () => {
  const { orderId } = await dispatched();
  await ok(proxy(orderId, { type: "departed" }));
  api.clock.advance(MINUTE);
  await ok(proxy(orderId, { type: "arrived" }));
  api.clock.advance(MINUTE);
  const pickedAt = ago(0);
  const res = await proxy(orderId, { type: "picked_up", occurred_at: pickedAt });
  assertMatchesOpenApi("POST", "/platform/v1/orders/{id}/events", res);
  assert.deepEqual([res.status, res.body.approval.kind, res.body.approval.status], [202, "order.proxy_pick_up", "pending"]);
  const approvalId = res.body.approval.id;
  const waiting = await detailOf(orderId);
  assert.deepEqual([waiting.order.status, waiting.order.fulfilment.picked_up_at, waiting.pending_proxy_review.event, waiting.pending_proxy_review.approval_id], ["arrived", null, "picked_up", approvalId]);
  assert.deepEqual((await proxy(orderId, { type: "picked_up" })).body.error.code, "PROXY_REVIEW_PENDING");
  assert.equal((await api.call("POST", `/platform/v1/approvals/${approvalId}/approve`, { token: await ops(), body: {} })).body.error.code, "APPROVAL_SELF_REVIEW");
  api.clock.advance(MINUTE);
  await approve(approvalId);
  const done = await detailOf(orderId);
  assert.deepEqual([done.order.status, done.order.fulfilment.picked_up_at, done.pending_proxy_review], ["in_service", pickedAt, null]);
  assert.deepEqual([done.events.at(-1).source, done.events.at(-1).proxy.requested_by, done.events.at(-1).proxy.approved_by, done.events.at(-1).proxy.approval_id], ["platform_proxy", m.staff.operations.id, finance.id, approvalId]);

  const raced = await dispatched();
  await ok(proxy(raced.orderId, { type: "departed" }));
  await ok(proxy(raced.orderId, { type: "arrived" }));
  const asked = await ok(proxy(raced.orderId, { type: "picked_up" }), 202);
  await ok(api.call("POST", `/tenant/v1/orders/${raced.orderId}/events`, { token: raced.tenantToken, body: { type: "picked_up" } }));
  const stale = await api.call("POST", `/platform/v1/approvals/${asked.approval.id}/approve`, { token: await platformLogin(api, finance.email), body: {} });
  assert.deepEqual([stale.status, stale.body.error.code], [409, "APPROVAL_STALE"]);
  assert.equal((await detailOf(raced.orderId)).pending_proxy_review, null, "已经被回传的旧复核不再挡着下一步");
  assert.equal((await api.db.owner.query("select 1 from order_events where order_id = $1 and to_status = 'in_service'", [raced.orderId])).rowCount, 1);
});

test("代传接到客人、完成的最早时间是用车前 3 小时（出发、到达仍是 24 小时）；只限代传，司机和供应商自己回传不受影响", async () => {
  const { orderId, tenantToken } = await dispatched(20);
  assert.equal((await proxy(orderId, { type: "departed" })).status, 200);
  api.clock.advance(MINUTE);
  assert.equal((await proxy(orderId, { type: "arrived" })).status, 200);
  api.clock.advance(MINUTE);
  const res = await proxy(orderId, { type: "picked_up" });
  assert.deepEqual([res.status, res.body.error.details.issues[0].reason, res.body.error.details.issues[0].message], [400, "TOO_EARLY", "发生时间不能早于用车时间前 3 小时"]);
  assert.equal((await detailOf(orderId)).order.status, "arrived");
  assert.equal((await api.call("POST", `/tenant/v1/orders/${orderId}/events`, { token: tenantToken, body: { type: "picked_up" } })).status, 200);
  assert.equal((await proxy(orderId, { type: "completed" })).body.error.details.issues[0].reason, "TOO_EARLY");
});

test("评分（ADR 0052）：供应商、司机自己回传的到达和第一次派车写评分事件，准时和迟到分得清；代传的不写；改派不重写", async () => {
  const eventsOf = async (orderId: string, kind: string): Promise<boolean[]> => (await api.db.owner.query("select on_time from tenant_performance_events where order_id = $1 and kind = $2", [orderId, kind])).rows.map((row) => row.on_time);

  const own = await dispatched();
  assert.deepEqual(await eventsOf(own.orderId, "dispatch"), [true], "截止时间前派车");
  await ok(api.call("POST", "/driver/v1/trip/events", { token: own.driverToken, body: { type: "departed" } }));
  await ok(api.call("POST", "/driver/v1/trip/events", { token: own.driverToken, body: { type: "arrived" } }));
  assert.deepEqual(await eventsOf(own.orderId, "arrival"), [true], "司机用车时间前到达");

  const late = await dispatched();
  await api.db.owner.query("update orders set service_at = $2 where id = $1", [late.orderId, new Date(api.clock.now().getTime() - MINUTE)]);
  await ok(api.call("POST", `/tenant/v1/orders/${late.orderId}/events`, { token: late.tenantToken, body: { type: "departed" } }));
  await ok(api.call("POST", `/tenant/v1/orders/${late.orderId}/events`, { token: late.tenantToken, body: { type: "arrived" } }));
  assert.deepEqual(await eventsOf(late.orderId, "arrival"), [false], "过了用车时间才到");

  const overdue = await paidOrder();
  await api.db.owner.query("update orders set dispatch_due_at = $2 where id = $1", [overdue, new Date(api.clock.now().getTime() - MINUTE)]);
  const who = { ...m.b, adminToken: await tenantLogin(api, m.b.adminEmail) };
  await ok(assign(api, who, overdue, (await newDriver(api, who)).id, (await newVehicle(api, who, m.ids.biz7)).id));
  assert.deepEqual(await eventsOf(overdue, "dispatch"), [false], "过了截止时间才派车");
  await ok(assign(api, who, overdue, (await newDriver(api, who)).id, (await newVehicle(api, who, m.ids.biz7)).id));
  assert.deepEqual(await eventsOf(overdue, "dispatch"), [false], "改派不算");

  const proxied = await dispatched();
  await ok(proxy(proxied.orderId, { type: "departed" }));
  api.clock.advance(MINUTE);
  await ok(proxy(proxied.orderId, { type: "arrived" }));
  assert.deepEqual(await eventsOf(proxied.orderId, "arrival"), [], "代传的到达不计入准时到达率");
});

test("评分事件的写入权限：供应商的事务只能写自己的派车、到达，写不了别家的，也写不了投诉和履约失败", async () => {
  const { orderId } = await dispatched();
  const insert = (tenantId: string, kind: string, onTime: boolean | null, failure: string | null) =>
    withTenantTx(api.db.pool, tenantId, (db) => db.query("insert into tenant_performance_events (tenant_id, order_id, kind, on_time, failure_type, occurred_at, recorded_at) values ($1, $2, $3, $4, $5, now(), now())", [tenantId, orderId, kind, onTime, failure]));
  await assert.rejects(insert(m.a.tenantId, "arrival", true, null), "别家的单");
  await assert.rejects(insert(m.b.tenantId, "complaint", null, null), /row-level security/);
  await assert.rejects(insert(m.b.tenantId, "failure", null, "rescue"), /row-level security/);
});

test("代传完成回填：事后加收窗口和客人投诉 14 天从批准生效的时间起算，不是运营填的发生时间", async () => {
  const rig = await dispatched();
  await toInService(rig.orderId);
  const pickedUp = api.clock.now().getTime();
  api.clock.advance(30 * HOUR);
  const asked = await ok(proxy(rig.orderId, { type: "completed", occurred_at: iso(pickedUp) }), 202);
  api.clock.advance(HOUR);
  await approve(asked.approval.id);
  const recorded = api.clock.now().getTime();
  const detail = await detailOf(rig.orderId);
  assert.equal(detail.order.fulfilment.completed_at, new Date(pickedUp).toISOString(), "显示的仍是发生时间");
  assert.equal(detail.events.at(-1).recorded_at, new Date(recorded).toISOString());
  api.clock.advance(23 * HOUR);
  const open = await api.call("POST", `/tenant/v1/orders/${rig.orderId}/extra-charges`, { token: await tenantLogin(api, m.b.adminEmail), body: { type: "waiting", amount: 2_000, description: "虚构：等了 40 分钟" } });
  assert.equal(open.status, 201, open.text);

  const complaint = async (at: number) => {
    // 换渠道令牌时时钟会走一秒：先拿到令牌，再走到要测的那一刻
    api.clock.advance(at - MINUTE - api.clock.now().getTime());
    const token = await flow.token();
    api.clock.advance(at - api.clock.now().getTime());
    return api.call("POST", `/sales/v1/orders/${rig.orderId}/tickets`, { token, body: { type: "complaint", subject: "虚构投诉", description: "虚构" } });
  };
  const inWindow = await complaint(recorded + 14 * 24 * HOUR);
  assert.equal(inWindow.status, 201, `发生时间已过 14 天多，但从记录时间算还在时限内：${inWindow.text}`);
  const closed = await complaint(recorded + 14 * 24 * HOUR + 2 * MINUTE);
  assert.deepEqual([closed.status, closed.body.error.code], [409, "COMPLAINT_WINDOW_CLOSED"]);
});
