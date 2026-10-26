/**
 * M3-04 测试角色补充：救援改派的隔离和权限（ADR 0031，规则 2、规则 4），经真实接口、真实 PostgreSQL；收款服务、推送接收方用替身。
 * - 原供应商在「救援改派中」和「已转给救援供应商」两个阶段，订单上每一个写接口都被拒（派车、司机链接、回传履约、加收、上传票据、再次声明）；
 * - 救援供应商看不到原供应商是谁、为什么救援、违约金，也看不到原供应商那一段的流水；原供应商看不到救援供应商是谁；
 * - 救援单（接口和推送）里没有乘客的联系方式和航班号，没有对外价、加价比例、汇率、名次，也没有原供应商是谁；
 * - 候选列表、救援队列只在运营后台：供应商令牌一律 401；
 * - 权限矩阵：平台只读 / 渠道经理不能发起，客服能发起不能审核；供应商财务 / 只读能看应扣款项，不能声明、不能接单。
 * 测试数据在这里构造，测试结束随 schema 一起删除（规则 1）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { withTenantTx } from "./db/context.ts";
import { type TenantFixture, type TestApi, addTenantUser, createTestApi } from "./testing/api.ts";
import { type FakeReceiver, assign, newDriver, newVehicle, startFakeReceiver } from "./testing/dispatch.ts";
import { type Market, type Staff, addStaff, allKeys, buildMarket, marketProduct, ok } from "./testing/market.ts";
import { RECEIPT_JPEG, platformLogin, tenantLogin } from "./testing/money.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";

const HOUR = 3_600_000;

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let flow: SalesFlow;
let c: TenantFixture;
let support: Staff;
let receiverC: FakeReceiver;

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  c = await api.tenantWithAdmin(m.root, "丙车队", "admin@access-c.test");
  await marketProduct(api, c, m.ids, [[m.ids.biz7, 21_000]], { leadTimeHours: 1 });
  flow = await salesFlow(api, m, pay);
  support = await addStaff(api, m.root, "cs@access.test", "customer_service");
  receiverC = await startFakeReceiver();
  await ok(api.call("PUT", "/tenant/v1/webhooks", { token: c.adminToken, body: { url: receiverC.url, events: ["rescue.offered", "order.confirmed"] } }), 201);
});
after(async () => {
  await receiverC.close();
  await api.close();
});

const ops = (): Promise<string> => platformLogin(api, m.staff.operations.email);
const tenantToken = (who: TenantFixture): Promise<string> => tenantLogin(api, who.adminEmail);
const fresh = async (who: TenantFixture): Promise<TenantFixture> => ({ ...who, adminToken: await tenantToken(who) });

async function paidOrderIn(hours: number): Promise<string> {
  const serviceAt = Math.floor((api.clock.now().getTime() + hours * HOUR) / 60_000) * 60_000;
  return (await flow.paidOrder({ serviceTime: new Date(serviceAt).toISOString().replace(/\.\d{3}Z$/, "Z") })).id;
}

const upload = async (token: string, orderId: string): Promise<number> =>
  (await api.app.inject({ method: "POST", url: `/tenant/v1/orders/${orderId}/files?kind=receipt`, headers: { authorization: `Bearer ${token}`, "content-type": "image/jpeg" }, payload: RECEIPT_JPEG })).statusCode;

/** 原供应商对这一单的写接口（上传票据见单独的测试）：都不能成功。 */
async function assertOriginalCannotWrite(who: TenantFixture, orderId: string, driverId: string, vehicleId: string, stage: string): Promise<void> {
  const token = await tenantToken(who);
  const version = (await ok(api.call("GET", `/tenant/v1/orders/${orderId}`, { token }))).order.version;
  const attempts: [string, Promise<{ status: number; text: string }>][] = [
    ["派车", api.call("POST", `/tenant/v1/orders/${orderId}/assign`, { token, headers: { "if-match": `"${version}"` }, body: { driver_id: driverId, vehicle_id: vehicleId } })],
    ["重新生成司机链接", api.call("POST", `/tenant/v1/orders/${orderId}/driver-link`, { token })],
    ["吊销司机链接", api.call("DELETE", `/tenant/v1/orders/${orderId}/driver-link`, { token })],
    ["回传已出发", api.call("POST", `/tenant/v1/orders/${orderId}/events`, { token, body: { type: "departed" } })],
    ["回传已完成", api.call("POST", `/tenant/v1/orders/${orderId}/events`, { token, body: { type: "completed" } })],
    ["提交加收", api.call("POST", `/tenant/v1/orders/${orderId}/extra-charges`, { token, body: { type: "parking", amount: 1_000, description: "停车", file_ids: [] } })],
    ["再次声明无法履约", api.call("POST", `/tenant/v1/orders/${orderId}/declare-unable`, { token, body: { reason: "再来一次" } })],
  ];
  for (const [name, call] of attempts) {
    const res = await call;
    assert.ok(res.status >= 400 && res.status < 500, `${stage}：原供应商「${name}」应被拒，实际 ${res.status} ${res.text}`);
  }
  const statuses = (await api.db.owner.query<{ status: string }>("select status from orders where id = $1 and tenant_id = $2", [orderId, who.tenantId])).rows.map((row) => row.status);
  assert.deepEqual(statuses, [stage === "救援改派中" ? "rescue_pending" : "rescued"], "原供应商那一行的状态没被改动");
}

test("原供应商在「救援改派中」「已转给救援供应商」两个阶段：订单上的写接口全部被拒，状态不变", async () => {
  const orderId = await paidOrderIn(10 * 24);
  const b = await fresh(m.b);
  const driver = await newDriver(api, b);
  const vehicle = await newVehicle(api, b, m.ids.biz7);
  await ok(assign(api, b, orderId, driver.id, vehicle.id));
  await ok(api.call("POST", `/tenant/v1/orders/${orderId}/declare-unable`, { token: await tenantToken(m.b), body: { reason: "司机病了" } }));
  await assertOriginalCannotWrite(m.b, orderId, driver.id, vehicle.id, "救援改派中");
  const offered = await ok(api.call("POST", `/platform/v1/orders/${orderId}/rescue/offers`, { token: await ops(), body: { tenant_id: c.tenantId } }), 201);
  await ok(api.call("POST", `/tenant/v1/rescue-offers/${offered.offer.id}/accept`, { token: await tenantToken(c), body: {} }));
  await assertOriginalCannotWrite(m.b, orderId, driver.id, vehicle.id, "已转出");
});

/**
 * 原供应商在订单「救援改派中」和「已转给救援供应商」之后不能再往这一单上传票据照片（409 `ORDER_STATE_INVALID`）。
 * ADR 0031：原供应商「可以查看」、不能再操作这一单（供应商写接口共用 `assertTenantCanOperate`）。
 */
test("原供应商在救援改派中 / 已转出之后不能再给这一单上传票据（409）", async () => {
  const orderId = await paidOrderIn(10 * 24);
  await ok(api.call("POST", `/tenant/v1/orders/${orderId}/declare-unable`, { token: await tenantToken(m.b), body: { reason: "司机病了" } }));
  const during = await upload(await tenantToken(m.b), orderId);
  const offered = await ok(api.call("POST", `/platform/v1/orders/${orderId}/rescue/offers`, { token: await ops(), body: { tenant_id: c.tenantId } }), 201);
  await ok(api.call("POST", `/tenant/v1/rescue-offers/${offered.offer.id}/accept`, { token: await tenantToken(c), body: {} }));
  const afterwards = await upload(await tenantToken(m.b), orderId);
  assert.deepEqual([during, afterwards], [409, 409], "救援改派中、已转出时上传票据都应 409 ORDER_STATE_INVALID");
});

test("救援单（接口、推送）只有行程和它的结算价：没有乘客联系方式和航班号、没有对外价 / 加价比例 / 汇率 / 名次、没有原供应商是谁；接单后救援供应商也看不到原因、违约金和原供应商那一段的流水", async () => {
  const orderId = await paidOrderIn(10 * 24);
  await ok(api.call("POST", `/tenant/v1/orders/${orderId}/declare-unable`, { token: await tenantToken(m.b), body: { reason: "乙的秘密原因-XYZ" } }));
  const offered = await ok(api.call("POST", `/platform/v1/orders/${orderId}/rescue/offers`, { token: await ops(), body: { tenant_id: c.tenantId } }), 201);
  await api.app.webhookJobs.tick();
  const pushed = receiverC.received.map((entry) => JSON.parse(entry.body)).find((body) => body.type === "rescue.offered" && body.data.offer_id === offered.offer.id);
  assert.ok(pushed, "丙没收到救援单的推送");
  const offerView = await ok(api.call("GET", `/tenant/v1/rescue-offers/${offered.offer.id}`, { token: await tenantToken(c) }));
  for (const [where, value] of [["推送", pushed], ["救援单", offerView]] as const) {
    const text = JSON.stringify(value);
    for (const secret of ["王小明", "+81 90", "guest@example.com", "NH 211", "NH211", m.b.tenantId, "乙车队", "乙的秘密原因-XYZ"]) assert.ok(!text.includes(secret), `${where}里不该有 ${secret}`);
    const keys = allKeys(value);
    for (const key of ["sell", "sell_minor", "markup_bp", "fx", "fx_buffer_bp", "position", "candidates", "original_tenant", "passenger", "flight_no", "messaging"]) assert.ok(!keys.has(key), `${where}里不该有字段 ${key}`);
  }
  await ok(api.call("POST", `/tenant/v1/rescue-offers/${offered.offer.id}/accept`, { token: await tenantToken(c), body: {} }));
  const rescuer = await ok(api.call("GET", `/tenant/v1/orders/${orderId}`, { token: await tenantToken(c) }));
  const text = JSON.stringify(rescuer);
  for (const secret of [m.b.tenantId, "乙车队", "乙的秘密原因-XYZ"]) assert.ok(!text.includes(secret), `救援供应商的订单里不该有 ${secret}`);
  assert.equal(rescuer.rescue.role, "rescuer");
  assert.equal(rescuer.rescue.penalty_bp, null);
  assert.deepEqual(rescuer.rescue.deductions, []);
  const rows = await api.db.owner.query<{ tenant_id: string; reason: string }>("select tenant_id, reason from order_events where order_id = $1 order by occurred_at, id", [orderId]);
  assert.ok(rows.rows.some((row) => row.tenant_id === m.b.tenantId && row.reason === "RESCUE_TRIGGERED"));
  // 救援供应商在库里（租户角色）读不到原供应商那一段的流水
  await withTenantTx(api.db.pool, c.tenantId, async (db) => {
    const seen = await db.query<{ tenant_id: string }>("select tenant_id from order_events where order_id = $1", [orderId]);
    assert.ok(seen.rows.every((row) => row.tenant_id === c.tenantId));
    assert.equal((await db.query("select 1 from orders where id = $1 and tenant_id <> $2", [orderId, c.tenantId])).rowCount, 0, "看不到原供应商那一行");
  });
  // 原供应商看不到救援供应商是谁
  const original = await ok(api.call("GET", `/tenant/v1/orders/${orderId}`, { token: await tenantToken(m.b) }));
  assert.ok(!JSON.stringify(original).includes(c.tenantId));
  assert.ok(!JSON.stringify(original).includes("丙车队"));
  const deductions = await ok(api.call("GET", `/tenant/v1/deductions?order_id=${orderId}`, { token: await tenantToken(m.b) }));
  assert.ok(!JSON.stringify(deductions).includes(c.tenantId));
  const keys = allKeys(deductions);
  for (const key of ["sell", "markup_bp", "fx", "rescue_tenant", "rescue_tenant_id"]) assert.ok(!keys.has(key), `应扣款项里不该有字段 ${key}`);
});

test("候选列表、救援队列、发起 / 发单 / 人工指定 / 不可抗力只在运营后台：供应商令牌一律 401", async () => {
  const orderId = await paidOrderIn(10 * 24);
  await ok(api.call("POST", `/tenant/v1/orders/${orderId}/declare-unable`, { token: await tenantToken(m.b), body: { reason: "司机病了" } }));
  for (const who of [m.a, m.b, c]) {
    const token = await tenantToken(who);
    const calls: [string, string, unknown][] = [
      ["GET", "/platform/v1/rescues", undefined],
      ["GET", `/platform/v1/orders/${orderId}/rescue/candidates`, undefined],
      ["POST", `/platform/v1/orders/${orderId}/rescue`, { trigger: "tenant_declared", note: "x" }],
      ["POST", `/platform/v1/orders/${orderId}/rescue/offers`, { tenant_id: who.tenantId }],
      ["POST", `/platform/v1/orders/${orderId}/rescue/manual-assign`, { tenant_id: who.tenantId, product_id: m.ids.pa, settlement_amount: 1, note: "x" }],
      ["POST", `/platform/v1/orders/${orderId}/rescue/force-majeure`, { note: "x" }],
      ["POST", `/platform/v1/tenants/${who.tenantId}/rescue`, { note: "x" }],
    ];
    for (const [method, url, body] of calls) {
      const res = await api.call(method as "GET", url, { token, ...(body === undefined ? {} : { body }) });
      assert.equal(res.status, 401, `${method} ${url}（供应商令牌）`);
    }
  }
  assert.equal((await api.db.owner.query<{ n: number }>("select count(*)::int as n from order_rescue_offers where order_id = $1", [orderId])).rows[0]?.n, 0);
  assert.equal((await api.db.owner.query<{ n: number }>("select count(*)::int as n from order_rescues where order_id = $1 and force_majeure_at is not null", [orderId])).rows[0]?.n, 0);
});

test("权限矩阵：平台只读、渠道经理不能发起 / 发单 / 不可抗力（能看队列的看得到）；客服能发起、能认定不可抗力、不能审核人工指定；供应商财务 / 只读看得到应扣款项、不能声明不能接单", async () => {
  const orderId = await paidOrderIn(10 * 24);
  const readonly = await platformLogin(api, m.staff.readonly.email);
  const channelManager = await platformLogin(api, m.staff.cm1.email);
  assert.equal((await api.call("GET", "/platform/v1/rescues", { token: readonly })).status, 200);
  for (const token of [readonly, channelManager]) {
    assert.equal((await api.call("POST", `/platform/v1/orders/${orderId}/rescue`, { token, body: { trigger: "tenant_declared", note: "x" } })).status, 403);
  }
  const cs = await platformLogin(api, support.email);
  const started = await api.call("POST", `/platform/v1/orders/${orderId}/rescue`, { token: cs, body: { trigger: "tenant_declared", note: "供应商来电说派不出车" } });
  assert.equal(started.status, 201, started.text);
  for (const token of [readonly, channelManager]) {
    assert.equal((await api.call("GET", `/platform/v1/orders/${orderId}/rescue/candidates`, { token })).status, 403);
    assert.equal((await api.call("POST", `/platform/v1/orders/${orderId}/rescue/offers`, { token, body: { tenant_id: null } })).status, 403);
    assert.equal((await api.call("POST", `/platform/v1/orders/${orderId}/rescue/force-majeure`, { token, body: { note: "x" } })).status, 403);
  }
  const requested = await ok(api.call("POST", `/platform/v1/orders/${orderId}/rescue/manual-assign`, { token: cs, body: { tenant_id: c.tenantId, product_id: (await api.db.owner.query<{ id: string }>("select id from products where tenant_id = $1 limit 1", [c.tenantId])).rows[0]?.id, settlement_amount: 22_000, note: "电话谈好" } }), 202);
  const otherCs = await addStaff(api, await platformLogin(api, "root@platform.test"), "cs2@access.test", "customer_service");
  assert.equal((await api.call("POST", `/platform/v1/approvals/${requested.approval.id}/approve`, { token: otherCs.token, body: {} })).status, 403, "客服不能审核");
  assert.equal((await api.call("POST", `/platform/v1/approvals/${requested.approval.id}/approve`, { token: cs, body: {} })).status, 403, "客服（发起人）本来就没有审核权限");
  const waived = await api.call("POST", `/platform/v1/orders/${orderId}/rescue/force-majeure`, { token: cs, body: { note: "大雪封路" } });
  assert.equal(waived.status, 200, waived.text);

  const finance = await addTenantUser(api, await tenantToken(m.b), "finance@access-b.test", "finance");
  const tro = await addTenantUser(api, await tenantToken(m.b), "readonly@access-b.test", "readonly");
  for (const user of [finance, tro]) {
    const list = await api.call("GET", `/tenant/v1/deductions?order_id=${orderId}`, { token: user.token });
    assert.equal(list.status, 200, list.text);
    assert.equal(list.body.items.length, 1);
    assert.equal((await api.call("POST", `/tenant/v1/orders/${orderId}/declare-unable`, { token: user.token, body: { reason: "x" } })).status, 403);
    assert.equal((await api.call("GET", "/tenant/v1/rescue-offers", { token: user.token })).status, 403);
  }
});
