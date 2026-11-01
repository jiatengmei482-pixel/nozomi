/**
 * M4-19：运营后台的乘客信息默认打码，点「查看」才给全文并记审计（需求《平台运营端》「个人信息保护」，ADR 0052）。经真实接口、真实 PostgreSQL；收款服务用替身。
 * 只读员工同样受约束；范围外的看不了；打码不影响供应商（付款后看得到）。数据只在测试里构造。
 */
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { LOCAL_WEBHOOK_HOST, TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";
import { type Market, buildMarket, ok } from "./testing/market.ts";
import { platformLogin, tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";

let api: TestApi;
let m: Market;
let flow: SalesFlow;
const FULL = { name: "王小明", phone: "+819012345678", email: "guest@example.com" };
const SECRETS = ["小明", "901234", "guest@"];

before(async () => {
  const pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  flow = await salesFlow(api, m, pay);
});
after(() => api.close());

const soon = (hours: number): string => new Date(api.clock.now().getTime() + hours * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
const paid = async (): Promise<string> => (await flow.paidOrder({ serviceTime: soon(240) })).id;
const reveal = (orderId: string, token: string) => api.call("POST", `/platform/v1/orders/${orderId}/passenger/reveal`, { token });
const auditRows = async (orderId: string): Promise<any[]> => (await api.db.owner.query("select actor_email, tenant_id, before, after from audit_logs where resource = 'order' and resource_id = $1 and action = 'view_passenger' order by id", [orderId])).rows;

test("列表和详情默认打码（运营、只读都是），响应里没有原文；符合 OpenAPI", async () => {
  const orderId = await paid();
  for (const email of [m.staff.operations.email, m.staff.readonly.email]) {
    const token = await platformLogin(api, email);
    const detail = await api.call("GET", `/platform/v1/orders/${orderId}`, { token });
    assertMatchesOpenApi("GET", "/platform/v1/orders/{id}", detail);
    assert.deepEqual(detail.body.order.passenger, { name: "王**", phone: "+********5678", email: "gu***@example.com" });
    const list = await api.call("GET", `/platform/v1/orders?q=${detail.body.order.order_no}`, { token });
    assert.equal(list.status, 200, list.text);
    assert.equal(list.body.items[0].passenger.name, "王**");
    for (const secret of SECRETS) {
      assert.ok(!detail.text.includes(secret), `详情含 ${secret}`);
      assert.ok(!list.text.includes(secret), `列表含 ${secret}`);
    }
  }
});

test("查看：运营、只读都拿到全文，每次记一条审计（谁看的），审计里没有联系方式本身", async () => {
  const orderId = await paid();
  const ops = await reveal(orderId, await platformLogin(api, m.staff.operations.email));
  assertMatchesOpenApi("POST", "/platform/v1/orders/{id}/passenger/reveal", ops);
  assert.deepEqual([ops.status, ops.body.passenger], [200, FULL]);
  assert.deepEqual((await reveal(orderId, await platformLogin(api, m.staff.readonly.email))).body.passenger, FULL);
  const rows = await auditRows(orderId);
  assert.deepEqual(rows.map((row) => [row.actor_email, row.tenant_id, row.after.fields]), [[m.staff.operations.email, null, ["name", "phone", "email"]], [m.staff.readonly.email, null, ["name", "phone", "email"]]]);
  for (const secret of SECRETS) assert.ok(!JSON.stringify(rows).includes(secret), secret);
});

test("没有看订单权限的 403，供应商和没登录的 401，不存在的 404，数据范围外的 404；这些都不记审计", async () => {
  const orderId = await paid();
  const denied = await reveal(orderId, await platformLogin(api, m.staff.masterData.email));
  assert.deepEqual([denied.status, denied.body.error.details.required], [403, "order.read"]);
  assert.equal((await reveal(orderId, await tenantLogin(api, m.b.adminEmail))).status, 401);
  assert.equal((await api.call("POST", `/platform/v1/orders/${orderId}/passenger/reveal`)).status, 401);
  assert.equal((await reveal(randomUUID(), await platformLogin(api, m.staff.operations.email))).status, 404);
  const role = await ok(api.call("POST", "/platform/v1/roles", { token: m.root, body: { name: "大阪查看", grants: ["orders:view"], data_scope: { city_ids: [m.ids.osaka], channel_ids: null } } }), 201);
  const email = `osaka-${randomUUID().slice(0, 8)}@platform.test`;
  const invited = await ok(api.call("POST", "/platform/v1/staff", { token: m.root, body: { email, name: "大阪", role: role.key } }), 201);
  await ok(api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.invite.token, password: TEST_PASSWORD } }));
  assert.equal((await reveal(orderId, await platformLogin(api, email))).status, 404);
  assert.deepEqual(await auditRows(orderId), []);
});

test("详情不能绕过「查看」：改单的改前改后、推送内容里的乘客也打码；供应商的接口不受影响（付款后看得到）", async () => {
  const tenantToken = await tenantLogin(api, m.b.adminEmail);
  const hook = await api.call("PUT", "/tenant/v1/webhooks", { token: tenantToken, body: { url: `https://${LOCAL_WEBHOOK_HOST}/hook`, events: ["order.changed"] } });
  assert.equal(hook.status, 201, hook.text);
  const orderId = await paid();
  const token = await platformLogin(api, m.staff.operations.email);
  const version = (await ok(api.call("GET", `/platform/v1/orders/${orderId}`, { token }))).order.version;
  await ok(api.call("PATCH", `/platform/v1/orders/${orderId}`, { token, headers: { "if-match": String(version) }, body: { passenger: { name: "李大伟", phone: "+81 80-9999-0000", email: "new@example.com" } } }));
  const detail = await api.call("GET", `/platform/v1/orders/${orderId}`, { token });
  assert.equal(detail.status, 200, detail.text);
  assert.equal(detail.body.changes[0].after.passenger.name, "李**");
  assert.equal(detail.body.changes[0].before.passenger.name, "王**");
  assert.ok(detail.body.webhook_deliveries.some((delivery: any) => delivery.data.after?.passenger?.name === "李**"), "这一单的推送记录里有这次改单");
  const pushes = await api.call("GET", `/platform/v1/webhook-deliveries?order_id=${orderId}`, { token });
  assert.equal(pushes.status, 200, pushes.text);
  const push = await api.call("GET", `/platform/v1/webhook-deliveries/${pushes.body.items[0].id}`, { token });
  assert.equal(push.status, 200, push.text);
  for (const secret of [...SECRETS, "大伟", "80999", "new@"]) for (const res of [detail, pushes, push]) assert.ok(!res.text.includes(secret), secret);
  const tenant = await ok(api.call("GET", `/tenant/v1/orders/${orderId}`, { token: tenantToken }));
  assert.equal(tenant.order.passenger.name, "李大伟");
  await ok(api.call("DELETE", "/tenant/v1/webhooks", { token: tenantToken }), 204);
});
