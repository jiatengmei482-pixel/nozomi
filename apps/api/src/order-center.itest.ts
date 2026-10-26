/**
 * M4-02：订单中心——异常队列和订单列表的筛选（ADR 0034），经真实接口、真实 PostgreSQL；收款服务用替身。
 * - 异常由订单定时任务按触发条件生成（超时未派车、支付异常、救援中……），同一个来源只生成一次；条件解除的系统关闭；
 * - 运营认领（含转给别人）、写处理说明关闭，全部留审计；关了的不会再生成；
 * - 订单列表按用车日期、下单时间、城市、品类、是否异常、乘客姓名或电话筛；详情里有这一单的异常和工单。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import type { TenantFixture, TestApi } from "./testing/api.ts";
import { createTestApi } from "./testing/api.ts";
import { assign, newDriver, newVehicle } from "./testing/dispatch.ts";
import { type Market, type Staff, addStaff, buildMarket, ok } from "./testing/market.ts";
import { platformLogin, tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";

const HOUR = 3_600_000;

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let flow: SalesFlow;
let support: Staff;
let finance: Staff;

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  flow = await salesFlow(api, m, pay);
  support = await addStaff(api, m.root, "cs@platform.test", "customer_service");
  finance = await addStaff(api, m.root, "finance@platform.test", "finance");
});
after(() => api.close());

const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const cs = (): Promise<string> => platformLogin(api, support.email);
const ops = (): Promise<string> => platformLogin(api, m.staff.operations.email);
const fresh = async (who: TenantFixture): Promise<TenantFixture> => ({ ...who, adminToken: await tenantLogin(api, who.adminEmail) });

async function paidOrderIn(hours: number): Promise<string> {
  return (await flow.paidOrder({ serviceTime: iso(api.clock.now().getTime() + hours * HOUR) })).id;
}

async function exceptionsOf(orderId: string, status = "active"): Promise<any[]> {
  const res = await api.call("GET", `/platform/v1/exceptions?order_id=${orderId}&status=${status}`, { token: await cs() });
  assertMatchesOpenApi("GET", "/platform/v1/exceptions", res);
  assert.equal(res.status, 200, res.text);
  return res.body.items;
}

test("超时未派车：过了派车截止时间，定时任务生成异常（立即处理）；同一张单只生成一次；客服认领、转给别人；供应商派车后系统关闭（条件已解除）", async () => {
  const orderId = await paidOrderIn(5 * 24);
  const detail = await ok(api.call("GET", `/platform/v1/orders/${orderId}`, { token: await ops() }));
  const due = new Date(detail.order.dispatch.due_at).getTime();
  api.clock.advance(due - api.clock.now().getTime());
  await api.app.orderJobs.remind();
  const sweep = await api.app.orderJobs.exceptions();
  assert.ok(sweep.opened >= 1);
  const [exception] = await exceptionsOf(orderId);
  assert.ok(exception);
  assert.deepEqual([exception.type, exception.type_name, exception.status, exception.tenant.id, exception.order.order_no], ["dispatch_overdue", "超时未派车", "open", m.b.tenantId, detail.order.order_no]);
  assert.equal(exception.due_at, exception.opened_at, "超时未派车：立即");
  assert.match(exception.handling, /催租户/);
  assert.equal((await api.app.orderJobs.exceptions()).opened, 0, "同一个来源只生成一次");

  // 认领：不给人就是自己；转给不存在的人 422；转给财务
  const claimed = await api.call("POST", `/platform/v1/exceptions/${exception.id}/claim`, { token: await cs(), body: {} });
  assertMatchesOpenApi("POST", "/platform/v1/exceptions/{id}/claim", claimed);
  assert.deepEqual([claimed.body.exception.status, claimed.body.exception.assignee.id], ["claimed", support.id]);
  assert.equal((await api.call("POST", `/platform/v1/exceptions/${exception.id}/claim`, { token: await cs(), body: { assignee_id: "99999999-9999-4999-8999-999999999999" } })).body.error.code, "ASSIGNEE_INVALID");
  const handed = await ok(api.call("POST", `/platform/v1/exceptions/${exception.id}/claim`, { token: await cs(), body: { assignee_id: finance.id } }));
  assert.equal(handed.exception.assignee.name, "finance");
  const mine = await ok(api.call("GET", "/platform/v1/exceptions?assignee=me", { token: await platformLogin(api, finance.email) }));
  assert.ok(mine.items.some((item: any) => item.id === exception.id));
  // 订单列表：标出有没关的异常，能按「有异常」筛
  const flagged = await ok(api.call("GET", `/platform/v1/orders?exception=open&q=${detail.order.order_no}`, { token: await ops() }));
  assert.deepEqual(flagged.items.map((item: any) => [item.id, item.open_exceptions]), [[orderId, 1]]);
  assert.equal((await ok(api.call("GET", `/platform/v1/orders?exception=none&q=${detail.order.order_no}`, { token: await ops() }))).items.length, 0);

  // 供应商派车：下一轮系统关闭
  const b = await fresh(m.b);
  await ok(assign(api, b, orderId, (await newDriver(api, b)).id, (await newVehicle(api, b, m.ids.biz7)).id));
  const cleared = await api.app.orderJobs.exceptions();
  assert.ok(cleared.cleared >= 1);
  const [closed] = await exceptionsOf(orderId, "closed");
  assert.deepEqual([closed.status, closed.close_kind, closed.closed_by, closed.resolution], ["closed", "cleared", null, null]);
  const audit = (await api.db.owner.query("select action, actor_email from audit_logs where resource = 'order_exception' and resource_id = $1 order by id", [exception.id])).rows;
  assert.deepEqual(audit, [{ action: "claim", actor_email: support.email }, { action: "claim", actor_email: support.email }]);
  // 已关闭的不能再认领
  assert.equal((await api.call("POST", `/platform/v1/exceptions/${exception.id}/claim`, { token: await cs(), body: {} })).body.error.code, "EXCEPTION_CLOSED");
  // 订单详情里有这一单的异常
  const after = await ok(api.call("GET", `/platform/v1/orders/${orderId}`, { token: await ops() }));
  assert.deepEqual(after.exceptions.map((item: any) => [item.type, item.close_kind]), [["dispatch_overdue", "cleared"]]);
  assert.deepEqual(after.tickets, []);
});

test("支付异常：退款被收款服务拒绝 → 生成「支付异常」（当天，按 24 小时）；人工关闭要写说明；关了之后条件还在也不再生成；财务重试成功的另一笔失败退款，系统关闭", async () => {
  // 运营代取消（免费的原因），退款被拒
  const first = await paidOrderIn(5 * 24);
  pay.nextRefundIs("failed", "expired_or_canceled_card");
  await ok(api.call("POST", `/platform/v1/orders/${first}/cancel`, { token: await ops(), body: { reason: "PLATFORM_FAULT", note: "平台派单出错" } }));
  await api.app.orderJobs.exceptions();
  const [issue] = await exceptionsOf(first);
  assert.ok(issue);
  assert.equal(issue.type, "payment_issue");
  assert.equal(issue.detail.reason, "refund_failed");
  assert.equal(new Date(issue.due_at).getTime() - new Date(issue.opened_at).getTime(), 24 * HOUR);
  const overdue = await ok(api.call("GET", `/platform/v1/exceptions?type=payment_issue&overdue=true&order_id=${first}`, { token: await cs() }));
  assert.equal(overdue.items.length, 0, "还没超时");
  api.clock.advance(24 * HOUR + 1);
  assert.equal((await ok(api.call("GET", `/platform/v1/exceptions?type=payment_issue&overdue=true&order_id=${first}`, { token: await cs() }))).items.length, 1);
  // 只读不能关；不写说明 400；财务写说明关闭
  const readonly = await platformLogin(api, m.staff.readonly.email);
  assert.equal((await api.call("POST", `/platform/v1/exceptions/${issue.id}/close`, { token: readonly, body: { resolution: "x" } })).status, 403);
  assert.equal((await api.call("POST", `/platform/v1/exceptions/${issue.id}/close`, { token: await platformLogin(api, finance.email), body: { resolution: "  " } })).status, 400);
  const closed = await api.call("POST", `/platform/v1/exceptions/${issue.id}/close`, { token: await platformLogin(api, finance.email), body: { resolution: "客人换了卡，已通过银行转账退回" } });
  assertMatchesOpenApi("POST", "/platform/v1/exceptions/{id}/close", closed);
  assert.deepEqual([closed.body.exception.status, closed.body.exception.close_kind, closed.body.exception.closed_by], ["closed", "resolved", finance.id]);
  await api.app.orderJobs.exceptions();
  assert.deepEqual(await exceptionsOf(first), [], "关了的不会再生成");
  const one = await api.call("GET", `/platform/v1/exceptions/${issue.id}`, { token: readonly });
  assertMatchesOpenApi("GET", "/platform/v1/exceptions/{id}", one);
  assert.equal(one.body.exception.resolution, "客人换了卡，已通过银行转账退回");

  // 另一笔：财务重试成功 → 失败的那一笔有了重试，条件解除，系统关闭
  const second = await paidOrderIn(5 * 24);
  pay.nextRefundIs("failed", "expired_or_canceled_card");
  await ok(api.call("POST", `/platform/v1/orders/${second}/cancel`, { token: await ops(), body: { reason: "PLATFORM_FAULT", note: "平台派单出错" } }));
  await api.app.orderJobs.exceptions();
  const [open] = await exceptionsOf(second);
  assert.ok(open);
  await ok(api.call("POST", `/platform/v1/orders/${second}/refunds/${open.detail.refund_id}/retry`, { token: await platformLogin(api, finance.email) }));
  await api.app.orderJobs.exceptions();
  const [done] = await exceptionsOf(second, "closed");
  assert.equal(done.close_kind, "cleared");
});

test("救援中：供应商声明无法履约，救援没有结论之前在异常队列里（立即）", async () => {
  const orderId = await paidOrderIn(5 * 24);
  await ok(api.call("POST", `/tenant/v1/orders/${orderId}/declare-unable`, { token: await tenantLogin(api, m.b.adminEmail), body: { reason: "车辆故障" } }));
  await api.app.orderJobs.exceptions();
  const [rescue] = await exceptionsOf(orderId);
  assert.deepEqual([rescue.type, rescue.detail.trigger, rescue.due_at === rescue.opened_at], ["rescue", "tenant_declared", true]);
  // 取消订单：救援收尾，系统关闭
  await ok(api.call("POST", `/platform/v1/orders/${orderId}/cancel`, { token: await ops(), body: { reason: "SUPPLIER_FAULT", note: "无人可接" } }));
  await api.app.orderJobs.exceptions();
  assert.deepEqual(await exceptionsOf(orderId), []);
});

test("订单列表的筛选：用车日期（当地，两端含）、下单时间、城市、品类、乘客姓名（部分）或电话（按数字）；参数不对 400", async () => {
  api.clock.advance(1_000);
  const createdFrom = api.clock.now().toISOString();
  const near = await paidOrderIn(10 * 24);
  const far = await paidOrderIn(20 * 24);
  const createdTo = new Date(api.clock.now().getTime() + 1).toISOString();
  const token = await ops();
  const list = async (query: string): Promise<string[]> => {
    const res = await api.call("GET", `/platform/v1/orders?limit=200&${query}`, { token });
    assertMatchesOpenApi("GET", "/platform/v1/orders", res);
    assert.equal(res.status, 200, res.text);
    return res.body.items.map((item: any) => item.id);
  };
  const nearDate = (await ok(api.call("GET", `/platform/v1/orders/${near}`, { token }))).order.service_date;
  const farDate = (await ok(api.call("GET", `/platform/v1/orders/${far}`, { token }))).order.service_date;
  const byDate = await list(`service_from=${nearDate}&service_to=${nearDate}`);
  assert.ok(byDate.includes(near) && !byDate.includes(far));
  const range = await list(`service_from=${nearDate}&service_to=${farDate}`);
  assert.ok(range.includes(near) && range.includes(far));
  const created = await list(`created_from=${encodeURIComponent(createdFrom)}&created_to=${encodeURIComponent(createdTo)}`);
  assert.deepEqual(new Set(created), new Set([near, far]));
  assert.ok((await list(`city_id=${m.ids.tokyo}&category=airport_transfer&created_from=${encodeURIComponent(createdFrom)}`)).includes(near));
  assert.deepEqual(await list(`city_id=${m.ids.osaka}&created_from=${encodeURIComponent(createdFrom)}`), []);
  assert.deepEqual(await list(`category=charter&created_from=${encodeURIComponent(createdFrom)}`), []);
  // 乘客：姓名部分匹配；电话按数字（下单时写的是 +81 90-1234-5678）
  assert.ok((await list(`passenger=${encodeURIComponent("小明")}&created_from=${encodeURIComponent(createdFrom)}`)).includes(near));
  assert.ok((await list(`passenger=${encodeURIComponent("9012345678")}&created_from=${encodeURIComponent(createdFrom)}`)).includes(far));
  assert.ok((await list(`passenger=${encodeURIComponent("1234-5678")}&created_from=${encodeURIComponent(createdFrom)}`)).includes(far));
  assert.deepEqual(await list(`passenger=${encodeURIComponent("张三")}&created_from=${encodeURIComponent(createdFrom)}`), []);
  for (const bad of ["service_from=2026-13-01", "created_from=yesterday", "category=bus", "exception=yes", "passenger=x", "city_id=abc"]) {
    assert.equal((await api.call("GET", `/platform/v1/orders?${bad}`, { token })).status, 400, bad);
  }
});
