/**
 * M3-04 测试角色补充：救援改派里的时间和并发（ADR 0031），经真实接口、真实 PostgreSQL；收款服务用替身。
 * - 付款时离用车已不足 6 小时的单：未派车从派车截止时间（付款后 2 小时）起算，一付款不触发，截止前 1 毫秒不触发、那一刻触发；
 * - 救援单期限：发出时离用车正好 2 小时 15 分钟、少 1 毫秒 5 分钟；期限前 1 毫秒能接；定时任务在期限那一刻记超时并顺延；
 * - 改派后的派车截止至少留 30 分钟：到点之后才改派的单，截止前 1 毫秒定时任务不会再救援一次，那一刻起才会；
 * - 改派给救援供应商的那一行不应马上被当成「司机未到」（缺陷复现，见该测试）；
 * - 多实例：定时任务 3 个实例同时跑，只建一条救援、只记一条违约金；救援单超时只顺延一次；
 * - 并发：运营同时给两家发救援单只成功一张；救援单接单和人工指定的批准同时到只改派一次；
 * - 观察期不算暂停（不能按「供应商被暂停」救援），已清退算。
 * 测试数据在这里构造，测试结束随 schema 一起删除（规则 1）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { type TenantFixture, type TestApi, createTestApi, resumeTenantNow, suspendTenantApproved } from "./testing/api.ts";
import { assign, newDriver, newVehicle } from "./testing/dispatch.ts";
import { type Market, buildMarket, marketProduct, ok } from "./testing/market.ts";
import { platformLogin, tenantLogin } from "./testing/money.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";

const HOUR = 3_600_000;
const MINUTE = 60_000;

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let flow: SalesFlow;
let c: TenantFixture;
let pc: string;

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  // 丙：商务 7 座 21,000，提前 1 小时就能订
  c = await api.tenantWithAdmin(m.root, "丙车队", "admin@time-c.test");
  pc = await marketProduct(api, c, m.ids, [[m.ids.biz7, 21_000]], { leadTimeHours: 1 });
  flow = await salesFlow(api, m, pay);
});
after(() => api.close());

const ops = (): Promise<string> => platformLogin(api, m.staff.operations.email);
const root = (): Promise<string> => platformLogin(api, "root@platform.test");
const tenantToken = (who: TenantFixture): Promise<string> => tenantLogin(api, who.adminEmail);
const fresh = async (who: TenantFixture): Promise<TenantFixture> => ({ ...who, adminToken: await tenantToken(who) });

async function paidOrderIn(hours: number): Promise<{ id: string; serviceAt: number }> {
  const serviceAt = Math.floor((api.clock.now().getTime() + hours * HOUR) / MINUTE) * MINUTE;
  const order = await flow.paidOrder({ serviceTime: new Date(serviceAt).toISOString().replace(/\.\d{3}Z$/, "Z") });
  return { id: order.id, serviceAt };
}

function moveTo(at: number): void {
  const delta = at - api.clock.now().getTime();
  assert.ok(delta >= 0, "时钟只能往后拨");
  api.clock.advance(delta);
}

async function declare(who: TenantFixture, orderId: string): Promise<any> {
  return ok(api.call("POST", `/tenant/v1/orders/${orderId}/declare-unable`, { token: await tenantToken(who), body: { reason: "车坏了" } }));
}

const offer = async (orderId: string, tenantId: string | null): Promise<any> => api.call("POST", `/platform/v1/orders/${orderId}/rescue/offers`, { token: await ops(), body: { tenant_id: tenantId } });

async function rescues(orderId: string): Promise<any[]> {
  return (await ok(api.call("GET", `/platform/v1/orders/${orderId}`, { token: await ops() }))).rescues;
}

async function count(sql: string, params: unknown[]): Promise<number> {
  return (await api.db.owner.query<{ n: number }>(sql, params)).rows[0]?.n ?? 0;
}

/** 当前订单（不是已转出的那一行）在库里的派车截止时间、确认时间。 */
async function currentRow(orderId: string): Promise<{ tenant_id: string; status: string; dispatch_due_at: Date; confirmed_at: Date; arrival_overdue_at: Date | null }> {
  const row = (await api.db.owner.query("select tenant_id, status, dispatch_due_at, confirmed_at, arrival_overdue_at from orders where id = $1 and status <> 'rescued'", [orderId])).rows[0];
  assert.ok(row);
  return row as any;
}

/** 人工指定给丙（运营发起、超级管理员批准）。 */
async function manualAssignToC(orderId: string, settlement = 30_000): Promise<string> {
  const requested = await ok(api.call("POST", `/platform/v1/orders/${orderId}/rescue/manual-assign`, { token: await ops(), body: { tenant_id: c.tenantId, product_id: pc, settlement_amount: settlement, note: "电话谈好" } }), 202);
  return requested.approval.id as string;
}

test("付款时离用车已不足 6 小时：未派车从派车截止（付款后 2 小时）起算——一付款不触发，截止前 1 毫秒不触发，那一刻触发（违约金 100%）", async () => {
  // 只剩 3 小时：只有提前 1 小时可订的丙报得出价
  const order = await paidOrderIn(3);
  const row = await currentRow(order.id);
  assert.equal(row.tenant_id, c.tenantId);
  assert.equal(row.dispatch_due_at.getTime(), row.confirmed_at.getTime() + 2 * HOUR, "派车截止 = 付款后 2 小时");
  await api.app.orderJobs.rescue();
  assert.equal(await count("select count(*)::int as n from order_rescues where order_id = $1", [order.id]), 0, "已经在 6 小时之内，但一付款不触发");
  moveTo(row.dispatch_due_at.getTime() - 1);
  await api.app.orderJobs.rescue();
  assert.equal(await count("select count(*)::int as n from order_rescues where order_id = $1", [order.id]), 0, "截止前 1 毫秒不触发");
  api.clock.advance(1);
  await api.app.orderJobs.rescue();
  const [rescue] = await rescues(order.id);
  assert.equal(rescue.trigger, "dispatch_overdue");
  assert.equal(rescue.penalty_bp, 10000);
  assert.equal(rescue.penalty.amount, "21000");
});

test("救援单期限：离用车正好 2 小时发出 15 分钟、少 1 毫秒 5 分钟；期限前 1 毫秒能接；定时任务在期限那一刻记超时", async () => {
  // 少 1 毫秒：5 分钟，前 1 毫秒接单成功
  const short = await paidOrderIn(30);
  moveTo(short.serviceAt - 2 * HOUR + 1);
  await declare(m.b, short.id);
  const shortOffer = await offer(short.id, c.tenantId);
  assert.equal(shortOffer.status, 201, shortOffer.text);
  assert.equal(new Date(shortOffer.body.offer.expires_at).getTime() - api.clock.now().getTime(), 5 * MINUTE);
  api.clock.advance(5 * MINUTE - 1);
  const accepted = await api.call("POST", `/tenant/v1/rescue-offers/${shortOffer.body.offer.id}/accept`, { token: await tenantToken(c), body: {} });
  assert.equal(accepted.status, 200, accepted.text);

  // 正好 2 小时：15 分钟；定时任务期限前 1 毫秒不动，那一刻记超时（没有别的候选 → 候选都不接）
  const exact = await paidOrderIn(30);
  moveTo(exact.serviceAt - 2 * HOUR);
  await declare(m.b, exact.id);
  const exactOffer = await offer(exact.id, c.tenantId);
  assert.equal(exactOffer.status, 201, exactOffer.text);
  const expiresAt = new Date(exactOffer.body.offer.expires_at).getTime();
  assert.equal(expiresAt - api.clock.now().getTime(), 15 * MINUTE);
  moveTo(expiresAt - 1);
  await api.app.orderJobs.rescue();
  assert.equal((await rescues(exact.id))[0].offers[0].status, "pending");
  api.clock.advance(1);
  await api.app.orderJobs.rescue();
  const [after] = await rescues(exact.id);
  assert.equal(after.offers[0].status, "expired");
  assert.equal(after.status, "exhausted");
});

test("到点之后才改派（司机未到 → 人工指定）：派车截止 = 改派后 30 分钟；截止前 1 毫秒定时任务不再救援，那一刻起才会（救援供应商的违约金按它的结算价）", async () => {
  const order = await paidOrderIn(30);
  const b = await fresh(m.b);
  await ok(assign(api, b, order.id, (await newDriver(api, b)).id, (await newVehicle(api, b, m.ids.biz7)).id));
  moveTo(order.serviceAt + 15 * MINUTE);
  await ok(api.call("POST", `/platform/v1/orders/${order.id}/rescue`, { token: await ops(), body: { trigger: "driver_no_show", note: "联系不上司机" } }), 201);
  const approval = await manualAssignToC(order.id);
  await ok(api.call("POST", `/platform/v1/approvals/${approval}/approve`, { token: await root(), body: {} }));
  const assignedAt = api.clock.now().getTime();
  const row = await currentRow(order.id);
  assert.equal(row.tenant_id, c.tenantId);
  assert.equal(row.status, "confirmed");
  assert.equal(row.dispatch_due_at.getTime(), assignedAt + 30 * MINUTE);
  moveTo(assignedAt + 30 * MINUTE - 1);
  await api.app.orderJobs.rescue();
  assert.equal((await rescues(order.id)).length, 1, "截止前不会马上又判它未派车");
  api.clock.advance(1);
  await api.app.orderJobs.rescue();
  const all = await rescues(order.id);
  assert.equal(all.length, 2);
  assert.equal(all[1].original_tenant.id, c.tenantId);
  assert.equal(all[1].trigger, "dispatch_overdue");
  assert.equal(all[1].penalty.amount, "30000", "违约金基数是丙谈好的结算价");
});

/**
 * 缺陷复现（当前失败）：到点之后才改派的单，救援供应商那一行一建好，定时任务就给它记「到点 15 分钟司机仍未到达」，
 * 进运营后台的救援队列提醒；运营也能马上按「司机未到」对救援供应商再发起一次（违约金 100%、记 driver_no_show 履约失败）。
 * 期望：救援供应商还在它的派车期限（改派后至少 30 分钟）里，不该被当成司机未到。
 */
test("缺陷：改派给救援供应商的那一行不应马上被当成「司机未到」（提醒、可触发）", async () => {
  const order = await paidOrderIn(30);
  const b = await fresh(m.b);
  await ok(assign(api, b, order.id, (await newDriver(api, b)).id, (await newVehicle(api, b, m.ids.biz7)).id));
  moveTo(order.serviceAt + 20 * MINUTE);
  await ok(api.call("POST", `/platform/v1/orders/${order.id}/rescue`, { token: await ops(), body: { trigger: "driver_no_show", note: "联系不上司机" } }), 201);
  const approval = await manualAssignToC(order.id);
  await ok(api.call("POST", `/platform/v1/approvals/${approval}/approve`, { token: await root(), body: {} }));
  api.clock.advance(MINUTE);
  await api.app.orderJobs.rescue();
  const row = await currentRow(order.id);
  assert.equal(row.tenant_id, c.tenantId);
  const queue = await ok(api.call("GET", "/platform/v1/rescues", { token: await ops() }));
  assert.ok(!queue.alerts.some((alert: any) => alert.order_id === order.id), "救援供应商刚接手 1 分钟，不该出现「司机未到」的提醒");
  assert.equal(row.arrival_overdue_at, null);
  const again = await api.call("POST", `/platform/v1/orders/${order.id}/rescue`, { token: await ops(), body: { trigger: "driver_no_show", note: "又联系不上" } });
  assert.equal(again.status, 409, "救援供应商接手 1 分钟就按司机未到再救援、扣它 100%");
});

test("多实例：定时任务 3 个实例同时跑，用车前 6 小时未派车只建一条救援、一条违约金、一条触发审计", async () => {
  const order = await paidOrderIn(30);
  moveTo(order.serviceAt - 6 * HOUR);
  await Promise.all([api.app.orderJobs.rescue(), api.app.orderJobs.rescue(), api.app.orderJobs.rescue()]);
  assert.equal(await count("select count(*)::int as n from order_rescues where order_id = $1", [order.id]), 1);
  assert.equal(await count("select count(*)::int as n from tenant_deductions where order_id = $1", [order.id]), 1);
  assert.equal(await count("select count(*)::int as n from audit_logs a join order_rescues r on r.id::text = a.resource_id::text where a.resource = 'rescue' and a.action = 'trigger' and r.order_id = $1", [order.id]), 1);
  assert.equal(await count("select count(*)::int as n from order_events where order_id = $1 and reason = 'RESCUE_TRIGGERED'", [order.id]), 1);
});

test("多实例：救援单超时，3 个实例同时跑只记一次超时、只顺延一家（同一时刻只有一张待接的）", async () => {
  const order = await paidOrderIn(10 * 24);
  await declare(m.b, order.id);
  const first = await offer(order.id, m.a.tenantId);
  assert.equal(first.status, 201, first.text);
  moveTo(new Date(first.body.offer.expires_at).getTime());
  const results = await Promise.all([api.app.orderJobs.rescue(), api.app.orderJobs.rescue(), api.app.orderJobs.rescue()]);
  assert.equal(results.reduce((sum, entry) => sum + entry.offersExpired, 0), 1, JSON.stringify(results));
  const [rescue] = await rescues(order.id);
  assert.deepEqual(rescue.offers.map((entry: any) => [entry.tenant.id, entry.status]), [
    [m.a.tenantId, "expired"],
    [c.tenantId, "pending"],
  ]);
});

test("并发：运营同时给两家发救援单，只成功一张", async () => {
  const order = await paidOrderIn(10 * 24);
  await declare(m.b, order.id);
  const results = await Promise.all([offer(order.id, m.a.tenantId), offer(order.id, c.tenantId)]);
  assert.deepEqual(results.map((res) => res.status).sort(), [201, 409], results.map((res) => res.text).join("\n"));
  assert.equal(await count("select count(*)::int as n from order_rescue_offers where order_id = $1 and status = 'pending'", [order.id]), 1);
});

test("并发：救援单接单和人工指定的批准同时到，只改派一次（另一边 409），订单只有一行「现在的」、销售端一侧指向它", async () => {
  const order = await paidOrderIn(10 * 24);
  await declare(m.b, order.id);
  const approval = await manualAssignToC(order.id);
  const offered = await offer(order.id, m.a.tenantId);
  assert.equal(offered.status, 201, offered.text);
  const [aToken, rootToken] = [await tenantToken(m.a), await root()];
  const [accept, approve] = await Promise.all([
    api.call("POST", `/tenant/v1/rescue-offers/${offered.body.offer.id}/accept`, { token: aToken, body: {} }),
    api.call("POST", `/platform/v1/approvals/${approval}/approve`, { token: rootToken, body: {} }),
  ]);
  const okCount = [accept.status, approve.status].filter((status) => status === 200).length;
  assert.equal(okCount, 1, `${accept.status} ${accept.text}\n${approve.status} ${approve.text}`);
  const rows = (await api.db.owner.query<{ tenant_id: string; status: string }>("select tenant_id, status from orders where id = $1", [order.id])).rows;
  const current = rows.filter((row) => row.status !== "rescued");
  assert.equal(current.length, 1, JSON.stringify(rows));
  assert.equal(rows.length, 2);
  const sale = (await api.db.owner.query<{ supplier_tenant_id: string }>("select supplier_tenant_id from order_sales where order_id = $1", [order.id])).rows[0];
  assert.equal(sale?.supplier_tenant_id, current[0]?.tenant_id);
  assert.equal(await count("select count(*)::int as n from tenant_deductions where order_id = $1 and kind = 'rescue_difference'", [order.id]), 1, "差价只记一次");
  assert.equal(await count("select count(*)::int as n from tenant_performance_events where order_id = $1 and kind = 'failure'", [order.id]), 1, "履约失败只记一次");
});

test("观察期不算暂停：不能批量发起、也不能单张按「供应商被暂停」发起；清退了就可以（违约金按距用车时间套阶梯）", async () => {
  const e = await api.tenantWithAdmin(await root(), "戊车队", "admin@time-e.test");
  await marketProduct(api, e, m.ids, [[m.ids.biz7, 19_000]]);
  // 报价引擎的供应商目录缓存 30 秒（ADR 0020）：过了才看得到新上架的
  api.clock.advance(MINUTE);
  try {
    const order = await paidOrderIn(5 * 24);
    assert.equal((await currentRow(order.id)).tenant_id, e.tenantId, "戊 19,000 中标");
    await api.db.owner.query("update tenants set observation_reasons = array['score_below_threshold'], observation_since = $2 where id = $1", [e.tenantId, api.clock.now()]);
    const batch = await api.call("POST", `/platform/v1/tenants/${e.tenantId}/rescue`, { token: await ops(), body: { note: "观察期" } });
    assert.equal(batch.status, 409, batch.text);
    assert.equal(batch.body.error.code, "RESCUE_TRIGGER_NOT_MET");
    const single = await api.call("POST", `/platform/v1/orders/${order.id}/rescue`, { token: await ops(), body: { trigger: "tenant_suspended", note: "观察期" } });
    assert.equal(single.status, 409, single.text);
    assert.equal(single.body.error.code, "RESCUE_TRIGGER_NOT_MET");
    assert.equal(await count("select count(*)::int as n from order_rescues where order_id = $1", [order.id]), 0);

    await api.db.owner.query("update tenants set status = 'terminated', terminated_at = $2 where id = $1", [e.tenantId, api.clock.now()]);
    const done = await ok(api.call("POST", `/platform/v1/tenants/${e.tenantId}/rescue`, { token: await ops(), body: { note: "已清退" } }));
    assert.ok(done.triggered.includes(order.id), JSON.stringify(done));
    const [rescue] = await rescues(order.id);
    assert.equal(rescue.trigger, "tenant_suspended");
    assert.equal(rescue.penalty_bp, 0, "离用车 5 天：0");
  } finally {
    await api.db.owner.query("update tenants set status = 'terminated', terminated_at = coalesce(terminated_at, $2), observation_reasons = '{}', observation_since = null where id = $1", [e.tenantId, api.clock.now()]);
    api.clock.advance(MINUTE);
  }
});

test("暂停中的供应商：单张按「供应商被暂停」发起，用车时间那一刻起拒绝（不是未来订单）", async () => {
  const order = await paidOrderIn(30);
  await suspendTenantApproved(api, await root(), m.b.tenantId, "资质过期");
  try {
    moveTo(order.serviceAt);
    const late = await api.call("POST", `/platform/v1/orders/${order.id}/rescue`, { token: await ops(), body: { trigger: "tenant_suspended", note: "暂停" } });
    assert.equal(late.status, 409, late.text);
    assert.equal(late.body.error.details.reason, "SERVICE_TIME_PASSED");
  } finally {
    await resumeTenantNow(api, await root(), m.b.tenantId);
  }
});
