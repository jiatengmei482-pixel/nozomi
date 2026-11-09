/**
 * M8-09：包车一口价全含（ADR 0070），经真实接口、真实 PostgreSQL；收款服务用替身。
 * - 分界（东京 2026-11-10 00:00，`CHARTER_ALL_INCLUSIVE_FROM`）前下的包车单：仍可凭票提交高速费、停车费，异议期后照常扣款、显示、出账；
 * - 分界后下的包车单：提交高速费、停车费 422 `TYPE_NOT_ALLOWED`（说明写清一口价已含），超时、超公里、付费等待照常；按订单的下单时间判断（正好分界那一刻算全含）；
 * - 规则 2：别的供应商提交不了、读不到。
 * 包车单是把经销售端真实下单、付款、履约完成的单在库里改成包车（和 dispatch.itest 同一做法），数据随测试 schema 一起删除（规则 1）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { CHARTER_ALL_INCLUSIVE_FROM } from "@nozomi/domain";
import { type TestApi, createTestApi } from "./testing/api.ts";
import { type Market, type Staff, addStaff, buildMarket, ok } from "./testing/market.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";
import { completeOrder, platformLogin, tenantLogin, uploadReceipt } from "./testing/money.ts";

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let flow: SalesFlow;
let finance: Staff;
/** 分界前下的包车单（第一条测试里建，后面的测试还要看它的加收） */
let legacy: { id: string; orderNo: string };

const HOUR = 3_600_000;
const BOUNDARY = new Date(CHARTER_ALL_INCLUSIVE_FROM).getTime();
const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  flow = await salesFlow(api, m, pay);
  finance = await addStaff(api, m.root, "fin@platform.test", "finance");
});
after(() => api.close());

function moveTo(ms: number): void {
  assert.ok(ms >= api.clock.now().getTime(), "时钟只能往后拨");
  api.clock.advance(ms - api.clock.now().getTime());
}

/** 一张已完成的包车单（乙中标，结算价 19,800，对外价 21,780）：现在的时钟就是下单时间。 */
async function completedCharter(): Promise<{ id: string; orderNo: string }> {
  const order = await flow.paidOrder({ serviceTime: iso(api.clock.now().getTime() + 3 * 24 * HOUR) });
  await completeOrder(api, m, "b", order.id);
  await api.db.owner.query("update orders set category = 'charter', place_id = null, direction = null, package_hours = 8, flight_no = null, pickup = dropoff, dropoff = null where id = $1", [order.id]);
  return { id: order.id, orderNo: order.order_no };
}

async function submit(orderId: string, body: Record<string, unknown>, email = m.b.adminEmail): Promise<any> {
  return api.call("POST", `/tenant/v1/orders/${orderId}/extra-charges`, { token: await tenantLogin(api, email), body });
}

async function tenantCharges(orderId: string): Promise<[string, string, string][]> {
  const detail = await ok(api.call("GET", `/tenant/v1/orders/${orderId}`, { token: await tenantLogin(api, m.b.adminEmail) }));
  return detail.extra_charges.map((item: any) => [item.type, item.status, item.amount.amount]);
}

test("分界前下的包车单：仍可凭票提交高速费、停车费（没票据照旧要求附），异议期后照常扣款；供应商、渠道照常看到", async () => {
  assert.ok(api.clock.now().getTime() < BOUNDARY);
  legacy = await completedCharter();
  const token = await tenantLogin(api, m.b.adminEmail);
  const file = await uploadReceipt(api, token, legacy.id);
  const toll = await submit(legacy.id, { type: "toll", amount: 1_500, description: "首都高", file_ids: [file] });
  assertMatchesOpenApi("POST", "/tenant/v1/orders/{id}/extra-charges", toll);
  assert.equal(toll.status, 201, toll.text);
  const noReceipt = await submit(legacy.id, { type: "parking", amount: 800 });
  assert.deepEqual([noReceipt.status, noReceipt.body.error.details.reason], [422, "RECEIPT_REQUIRED"]);
  assert.equal((await submit(legacy.id, { type: "parking", amount: 800, file_ids: [file] })).status, 201);
  assert.equal((await submit(legacy.id, { type: "charter_overtime", amount: 5_000, file_ids: [file] })).status, 201);

  moveTo(new Date(toll.body.extra_charge.dispute_until).getTime() + 1);
  await api.app.orderJobs.money();
  assert.deepEqual(pay.chargesOf(legacy.id).map((charge) => charge.amountMinor).sort((a, b) => a - b), [880, 1_650, 5_500], "客人付 × 1.1，用保存的支付方式");
  assert.deepEqual(await tenantCharges(legacy.id), [["toll", "charged", "1500"], ["parking", "charged", "800"], ["charter_overtime", "charged", "5000"]]);
  const sales = (await ok(api.call("GET", `/sales/v1/orders/${legacy.id}`, { token: await flow.token() }))).order;
  assert.deepEqual(sales.extra_charges.map((item: any) => [item.type, item.amount.amount]), [["toll", "1650"], ["parking", "880"], ["charter_overtime", "5500"]]);
});

test("分界前的高速费、停车费照常出账：分界之后出 10 月的账单，三项加收都在", async () => {
  moveTo(new Date("2026-12-01T00:00:00+09:00").getTime());
  const fin = await platformLogin(api, finance.email);
  const generated = await ok(api.call("POST", "/platform/v1/statements/generate", { token: fin, body: { period: "2026-10" } }));
  const statement = generated.created.find((entry: any) => entry.tenant.id === m.b.tenantId && entry.currency === "JPY");
  assert.ok(statement, JSON.stringify(generated));
  const detail = (await ok(api.call("GET", `/platform/v1/statements/${statement.id}`, { token: fin }))).statement;
  const lines = detail.lines.filter((line: any) => line.order_no === legacy.orderNo).map((line: any) => [line.kind, line.amount.amount]);
  assert.deepEqual(lines.filter(([kind]: string[]) => kind === "extra_charge").map(([, amount]: string[]) => amount).sort(), ["1500", "5000", "800"]);
});

test("分界后下的包车单：高速费、停车费 422 TYPE_NOT_ALLOWED（附了票据也不行），超时、超公里、付费等待照常；分界前的单的加收照常显示", async () => {
  assert.ok(api.clock.now().getTime() >= BOUNDARY);
  const order = await completedCharter();
  const token = await tenantLogin(api, m.b.adminEmail);
  const file = await uploadReceipt(api, token, order.id);
  for (const type of ["toll", "parking"]) {
    const refused = await submit(order.id, { type, amount: 1_000, description: "停车场", file_ids: [file] });
    assertMatchesOpenApi("POST", "/tenant/v1/orders/{id}/extra-charges", refused);
    assert.deepEqual([refused.status, refused.body.error.code, refused.body.error.details.reason], [422, "EXTRA_CHARGE_INVALID", "TYPE_NOT_ALLOWED"], type);
    assert.match(refused.body.error.message, /包车一口价已含高速费、停车费/);
  }
  for (const type of ["charter_overtime", "charter_over_km", "waiting"]) assert.equal((await submit(order.id, { type, amount: 1_000, file_ids: [file] })).status, 201, type);
  assert.deepEqual(await tenantCharges(order.id), [["charter_overtime", "in_window", "1000"], ["charter_over_km", "in_window", "1000"], ["waiting", "in_window", "1000"]]);
  const rows = await api.db.owner.query<{ n: number }>("select count(*)::int as n from order_extra_charges where order_id = $1 and type in ('toll', 'parking')", [order.id]);
  assert.equal(rows.rows[0]?.n, 0, "被拒的没有写进库");
  assert.deepEqual((await tenantCharges(legacy.id)).map(([type, status]) => [type, status]), [["toll", "charged"], ["parking", "charged"], ["charter_overtime", "charged"]]);

  const transfer = await flow.paidOrder({ serviceTime: iso(api.clock.now().getTime() + 3 * 24 * HOUR) });
  await completeOrder(api, m, "b", transfer.id);
  assert.equal((await submit(transfer.id, { type: "toll", amount: 1_000, file_ids: [await uploadReceipt(api, await tenantLogin(api, m.b.adminEmail), transfer.id)] })).body.error.details.reason, "TYPE_NOT_ALLOWED", "接送机照旧");
});

test("按订单的下单时间判断，不按提交时间：正好在分界那一刻下的算全含，早 1 毫秒下的按旧规则", async () => {
  const order = await completedCharter();
  const file = await uploadReceipt(api, await tenantLogin(api, m.b.adminEmail), order.id);
  await api.db.owner.query("update orders set created_at = $2 where id = $1", [order.id, new Date(BOUNDARY)]);
  assert.equal((await submit(order.id, { type: "toll", amount: 1_000, file_ids: [file] })).body.error?.details.reason, "TYPE_NOT_ALLOWED");
  await api.db.owner.query("update orders set created_at = $2 where id = $1", [order.id, new Date(BOUNDARY - 1)]);
  const allowed = await submit(order.id, { type: "toll", amount: 1_000, file_ids: [file] });
  assert.equal(allowed.status, 201, allowed.text);
});

test("规则 2：甲读不到、改不了乙的包车单（分界前后都一样，不因新规则泄露订单是否存在）", async () => {
  const order = await completedCharter();
  for (const id of [legacy.id, order.id]) {
    for (const type of ["toll", "charter_overtime"]) assert.equal((await submit(id, { type, amount: 1_000 }, m.a.adminEmail)).status, 404, `${id} ${type}`);
    assert.equal((await api.call("GET", `/tenant/v1/orders/${id}`, { token: await tenantLogin(api, m.a.adminEmail) })).status, 404);
  }
  const charge = (await tenantCharges(legacy.id)).length;
  assert.equal(charge, 3, "乙的加收没有被甲动过");
});
