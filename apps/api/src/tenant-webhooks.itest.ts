/**
 * M3-02：推送给供应商（租户 Webhook，ADR 0027），经真实接口、真实 PostgreSQL；接收方是本机起的假服务器。
 * - 设置：接收地址的校验（只认 https、拒绝内网 / 回环 / 元数据地址）、签名密钥只显示一次且库里是密文、换密钥、删除、权限、没配置数据加密密钥时 503；
 * - 推单：客人付款 → 自动确认 → 同一个事务里排队 `order.confirmed` → 投递任务签名发出；接收方按签名规则能验过；推送内容没有对外价和加价比例（规则 4）；
 *   派车排 `order.assigned`（改派 change=true）、履约回传排 `order.status_changed`；
 * - 验收标准「推送失败自动重试」：按 1–5–30 分钟、2–6–24 小时重试，第 7 次失败后最终失败（供应商和运营后台都看得到、服务日志告警），手动重推成功；
 * - 同一张订单按顺序投；两个实例同时跑同一条只发一次；订阅删除 / 暂停后不再发；发送时解析到内网地址的拒绝（防 SSRF，用真实的发送器）；测试事件。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { WEBHOOK_MAX_ATTEMPTS } from "@nozomi/domain";
import { HttpsWebhookSender } from "./integrations/webhook-sender.ts";
import { verifyWebhookSignature } from "./integrations/webhook-signature.ts";
import { SecretBox } from "./integrations/secret-box.ts";
import { TEST_PASSWORD, type TestApi, addTenantUser, createTestApi, localWebhookSender } from "./testing/api.ts";
import { type Market, buildMarket, ok } from "./testing/market.ts";
import { type FakeReceiver, assign, newDriver, newVehicle, seedOrder, startFakeReceiver } from "./testing/dispatch.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";
import { FAKE_SECRETS } from "./testing/fixtures.ts";
import { createSuperAdmin } from "./services/platform-staff.ts";

let api: TestApi;
let m: Market;
let receiver: FakeReceiver;
let pay: FakePaymentProvider;
let sales: SalesFlow;

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay, webhookSender: localWebhookSender({ timeoutMs: 500 }) });
  m = await buildMarket(api);
  receiver = await startFakeReceiver();
  sales = await salesFlow(api, m, pay);
});
after(async () => {
  await receiver.close();
  await api.close();
});

const MINUTE = 60_000;

/** 拨过时钟之后会话可能过期：每次都重新登录。 */
async function adminToken(side: "a" | "b"): Promise<string> {
  return (await ok(api.call("POST", "/tenant/v1/auth/login", { body: { email: m[side].adminEmail, password: TEST_PASSWORD } }))).access_token;
}

async function configure(side: "a" | "b", events: string[], url = receiver.url): Promise<string> {
  const token = await adminToken(side);
  const current = await ok(api.call("GET", "/tenant/v1/webhooks", { token }));
  if (current.webhook !== null) await api.call("DELETE", "/tenant/v1/webhooks", { token });
  const created = await api.call("PUT", "/tenant/v1/webhooks", { token, body: { url, events } });
  assert.equal(created.status, 201, created.text);
  return created.body.secret;
}

async function platformLogin(email: string): Promise<string> {
  return (await ok(api.platformLogin({ body: { email, password: TEST_PASSWORD } }))).access_token;
}

async function deliveries(side: "a" | "b", query = ""): Promise<any[]> {
  const res = await api.call("GET", `/tenant/v1/webhooks/deliveries${query}`, { token: await adminToken(side) });
  assertMatchesOpenApi("GET", "/tenant/v1/webhooks/deliveries", res);
  return res.body.items;
}

/** 把排着的推送全部投完（到期的）。 */
async function drain(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    const result = await api.app.webhookJobs.tick();
    if (result.succeeded + result.retrying + result.failed === 0) return;
  }
}

test("设置：只认 https；内网、本机、元数据地址、带账号密码的地址都拒绝；新建时签名密钥只出现一次，库里是密文，之后只显示末 4 位", async () => {
  const token = await adminToken("a");
  const empty = await api.call("GET", "/tenant/v1/webhooks", { token });
  assertMatchesOpenApi("GET", "/tenant/v1/webhooks", empty);
  assert.deepEqual([empty.body.webhook, empty.body.encryption_configured, empty.body.rules.max_attempts, empty.body.rules.retry_delays_seconds], [null, true, 7, [60, 300, 1800, 7200, 21600, 86400]]);
  for (const [url, reason] of [
    ["http://dispatch.example.com/hook", "NOT_HTTPS"],
    ["https://127.0.0.1/hook", "FORBIDDEN_HOST"],
    ["https://10.1.2.3/hook", "FORBIDDEN_HOST"],
    ["https://169.254.169.254/latest", "FORBIDDEN_HOST"],
    ["https://localhost:8443/hook", "FORBIDDEN_HOST"],
    ["https://[::1]/hook", "FORBIDDEN_HOST"],
    ["https://user:pw@dispatch.example.com/hook", "HAS_CREDENTIALS"],
  ] as const) {
    const res = await api.call("PUT", "/tenant/v1/webhooks", { token, body: { url, events: ["order.confirmed"] } });
    assert.deepEqual([res.status, res.body.error.details.issues[0].reason], [400, reason], url);
  }
  const created = await api.call("PUT", "/tenant/v1/webhooks", { token, body: { url: "https://dispatch.example.com/nozomi", events: ["order.assigned", "order.confirmed"] } });
  assertMatchesOpenApi("PUT", "/tenant/v1/webhooks", created);
  assert.equal(created.status, 201);
  assert.match(created.body.secret, /^nzwh_[A-Za-z0-9_-]{43}$/);
  assert.deepEqual(created.body.webhook.events, ["order.confirmed", "order.assigned"], "按事件清单的顺序存");
  assert.equal(created.body.webhook.secret_hint, created.body.secret.slice(-4));
  const stored = await api.db.owner.query<{ secret_ciphertext: string }>("select secret_ciphertext from tenant_webhooks where tenant_id = $1", [m.a.tenantId]);
  assert.ok(!stored.rows[0]?.secret_ciphertext.includes(created.body.secret.slice(5)), "库里没有密钥原文");
  assert.equal(new SecretBox(FAKE_SECRETS.dataEncryptionKey).open("tenant-webhook-secret", m.a.tenantId, stored.rows[0]?.secret_ciphertext as string), created.body.secret);
  const read = await api.call("GET", "/tenant/v1/webhooks", { token });
  assert.ok(!read.text.includes(created.body.secret), "之后再也看不到原文");
  const noVersion = await api.call("PUT", "/tenant/v1/webhooks", { token, body: { url: "https://dispatch.example.com/v2", events: ["order.confirmed"] } });
  assert.equal(noVersion.status, 428);
  const updated = await api.call("PUT", "/tenant/v1/webhooks", { token, headers: { "if-match": '"1"' }, body: { url: "https://dispatch.example.com/v2", events: ["order.confirmed"], status: "paused" } });
  assert.deepEqual([updated.status, updated.body.secret, updated.body.webhook.version, updated.body.webhook.status], [200, null, 2, "paused"]);
  const rotated = await api.call("POST", "/tenant/v1/webhooks/rotate-secret", { token });
  assertMatchesOpenApi("POST", "/tenant/v1/webhooks/rotate-secret", rotated);
  assert.notEqual(rotated.body.secret, created.body.secret);
  const audit = await api.db.owner.query<{ action: string; after: Record<string, unknown> | null }>("select action, after from audit_logs where resource = 'tenant_webhook' and tenant_id = $1 order by id", [m.a.tenantId]);
  assert.deepEqual(audit.rows.map((row) => row.action), ["create", "update", "rotate"]);
  assert.ok(!JSON.stringify(audit.rows).includes(created.body.secret) && !JSON.stringify(audit.rows).includes(rotated.body.secret), "审计日志里没有密钥原文");
  assert.equal((await api.call("DELETE", "/tenant/v1/webhooks", { token })).status, 204);
  assert.equal((await api.call("DELETE", "/tenant/v1/webhooks", { token })).status, 404);
});

test("权限：调度、只读能看设置和投递记录，不能改；只有管理员能设置、换密钥、重推、发测试事件", async () => {
  const dispatcher = await addTenantUser(api, await adminToken("a"), "dispatch@hooks.test", "dispatch");
  const readonly = await addTenantUser(api, await adminToken("a"), "ro@hooks.test", "readonly");
  for (const who of [dispatcher, readonly]) {
    assert.equal((await api.call("GET", "/tenant/v1/webhooks", { token: who.token })).status, 200);
    assert.equal((await api.call("GET", "/tenant/v1/webhooks/deliveries", { token: who.token })).status, 200);
    const denied = await api.call("PUT", "/tenant/v1/webhooks", { token: who.token, body: { url: "https://x.example.com", events: ["order.confirmed"] } });
    assert.deepEqual([denied.status, denied.body.error.details.required], [403, "webhook.manage"]);
    assert.equal((await api.call("POST", "/tenant/v1/webhooks/test", { token: who.token })).status, 403);
  }
});

test("没有配置数据加密密钥：不能设置 Webhook（503），设置页面能看出原因", async () => {
  const bare = await createTestApi({ env: { DATA_ENCRYPTION_KEY: "" } });
  try {
    // 没配加密密钥时平台员工过不了两步验证（ADR 0030，platform-mfa.itest.ts 有专门的用例）。这个用例只测供应商一侧，
    // 所以用迁移账号把超级管理员标成已绑定、把这一个会话标成已验证（只在测试代码里），再用它建供应商
    const email = "root@platform.test";
    await createSuperAdmin(bare.db.pool, { email, name: "平台超管", password: TEST_PASSWORD }, bare.clock.now());
    const root = (await ok(bare.call("POST", "/platform/v1/auth/login", { body: { email, password: TEST_PASSWORD } }))).access_token as string;
    assert.equal((await bare.call("GET", "/platform/v1/tenants", { token: root })).body.error.code, "MFA_REQUIRED");
    await bare.db.owner.query("update platform_users set totp_secret = 'v1.unused.in.this.test', totp_enabled_at = $2 where email = $1", [email, bare.clock.now()]);
    await bare.db.owner.query("update platform_sessions set mfa_verified_at = $2, mfa_method = 'totp' where user_id = (select id from platform_users where email = $1)", [email, bare.clock.now()]);
    const tenant = await bare.tenantWithAdmin(root, "无密钥车队", "admin@nokey.test");
    const read = await bare.call("GET", "/tenant/v1/webhooks", { token: tenant.adminToken });
    assert.equal(read.body.encryption_configured, false);
    const res = await bare.call("PUT", "/tenant/v1/webhooks", { token: tenant.adminToken, body: { url: "https://dispatch.example.com/hook", events: ["order.confirmed"] } });
    assertMatchesOpenApi("PUT", "/tenant/v1/webhooks", res);
    assert.deepEqual([res.status, res.body.error.code], [503, "WEBHOOK_ENCRYPTION_NOT_CONFIGURED"]);
  } finally {
    await bare.close();
  }
});

test("推单：客人付款 → 自动确认 → order.confirmed 推给中标供应商；签名按规则能验过；内容是订单（乘客、结算价），没有对外价和加价比例", async () => {
  const secret = await configure("b", ["order.confirmed", "order.assigned", "order.status_changed"]);
  receiver.respond([200]);
  receiver.received.length = 0;
  const order = await sales.paidOrder();
  const queued = await api.db.owner.query<{ event_type: string; status: string }>("select event_type, status from webhook_deliveries where order_id = $1", [order.id]);
  assert.deepEqual(queued.rows, [{ event_type: "order.confirmed", status: "pending" }], "确认的同一个事务里排好了");
  await drain();
  assert.equal(receiver.received.length, 1);
  const got = receiver.received[0]!;
  assert.equal(got.path, "/nozomi/webhook");
  assert.equal(verifyWebhookSignature(secret, { timestamp: got.headers["x-timestamp"] as string, signature: got.headers["x-signature"] as string }, got.body, api.clock.now()), null, "接收方用保存的密钥能验过签名");
  assert.equal(verifyWebhookSignature(secret.replace(/.$/, "x"), { timestamp: got.headers["x-timestamp"] as string, signature: got.headers["x-signature"] as string }, got.body, api.clock.now()), "MISMATCH");
  const body = JSON.parse(got.body);
  assert.deepEqual([body.type, got.headers["x-event-type"], got.headers["x-event-id"], got.headers["x-delivery-attempt"], body.tenant_id], ["order.confirmed", "order.confirmed", body.event_id, "1", m.b.tenantId]);
  assert.match(body.event_id, /^evt_[0-9a-z]{24}$/);
  assert.deepEqual([body.data.order.id, body.data.order.passenger.name, body.data.order.settlement.total], [order.id, "王小明", { amount: "19800", currency: "JPY" }]);
  assert.doesNotMatch(got.body, /markup|sell|对外价|加价|"21780"|channel/i, "规则 4：推给供应商的内容里没有对外价、加价比例、渠道");
  const [delivery] = await deliveries("b", `?order_id=${order.id}`);
  assert.deepEqual([delivery.status, delivery.attempts, delivery.last_status_code], ["succeeded", 1, 200]);
  const detail = await api.call("GET", `/tenant/v1/webhooks/deliveries/${delivery.id}`, { token: await adminToken("b") });
  assertMatchesOpenApi("GET", "/tenant/v1/webhooks/deliveries/{id}", detail);
  assert.deepEqual([detail.body.attempts[0].trigger, detail.body.attempts[0].request_bytes], ["schedule", Buffer.byteLength(got.body)]);
  assert.ok(!detail.text.includes("王小明"), "投递记录里没有请求体原文");
  assert.ok(!(await api.db.owner.query("select * from webhook_deliveries where order_id = $1", [order.id])).rows.some((row) => JSON.stringify(row).includes("王小明")), "库里也不存");

  // 派车 → order.assigned；改派 → change=true；司机出发 → order.status_changed
  const token = await adminToken("b");
  const who = { ...m.b, adminToken: token };
  const [d1, d2] = [await newDriver(api, who), await newDriver(api, who)];
  const v = await newVehicle(api, who, m.ids.biz7);
  const first = await ok(assign(api, who, order.id, d1.id, v.id));
  await ok(assign(api, who, order.id, d2.id, v.id));
  await ok(api.call("POST", "/driver/v1/trip/events", { token: (await ok(api.call("POST", `/tenant/v1/orders/${order.id}/driver-link`, { token }))).driver_link.token, body: { type: "departed" } }));
  assert.ok(first.driver_link.token);
  receiver.received.length = 0;
  await drain();
  const sent = receiver.received.map((entry) => JSON.parse(entry.body));
  assert.deepEqual(sent.map((entry) => [entry.type, entry.data.change ?? null, entry.data.to_status ?? null]), [["order.assigned", false, null], ["order.assigned", true, null], ["order.status_changed", null, "departed"]], "同一张单按顺序投");
  assert.equal(sent[2].data.order.dispatch.driver.id, d2.id, "内容是发送时订单的当前内容");
});

test("验收「推送失败自动重试」：对方一直 500 → 按 1、5、30 分钟、2、6、24 小时重试，第 7 次失败后最终失败；两边后台都看得到；服务日志告警", async () => {
  await configure("a", ["order.assigned"]);
  receiver.respond([500]);
  receiver.received.length = 0;
  const order = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 5 * 24 * 3_600_000) });
  const token = await adminToken("a");
  await ok(assign(api, { ...m.a, adminToken: token }, order.id, (await newDriver(api, { ...m.a, adminToken: token })).id, (await newVehicle(api, { ...m.a, adminToken: token }, m.ids.biz7)).id));
  const delays: number[] = [];
  let previous = api.clock.now().getTime();
  for (let attempt = 1; attempt <= WEBHOOK_MAX_ATTEMPTS; attempt += 1) {
    assert.equal((await api.app.webhookJobs.tick()).retrying + (attempt === WEBHOOK_MAX_ATTEMPTS ? 1 : 0), 1, `第 ${attempt} 次`);
    const [row] = (await api.db.owner.query<{ status: string; attempts: number; next_attempt_at: Date | null; last_status_code: number }>("select status, attempts, next_attempt_at, last_status_code from webhook_deliveries where order_id = $1", [order.id])).rows;
    assert.deepEqual([row?.attempts, row?.last_status_code], [attempt, 500]);
    if (attempt < WEBHOOK_MAX_ATTEMPTS) {
      assert.equal(row?.status, "pending");
      const wait = (row?.next_attempt_at as Date).getTime() - api.clock.now().getTime();
      delays.push(wait / 1000);
      assert.equal((await api.app.webhookJobs.tick()).retrying, 0, "没到时间不重试");
      api.clock.advance(wait);
    } else {
      assert.deepEqual([row?.status, row?.next_attempt_at], ["failed", null]);
    }
    previous = api.clock.now().getTime();
  }
  assert.ok(previous > 0);
  assert.deepEqual(delays, [60, 300, 1_800, 7_200, 21_600, 86_400]);
  assert.equal(receiver.received.length, WEBHOOK_MAX_ATTEMPTS);
  assert.deepEqual(receiver.received.map((entry) => entry.headers["x-delivery-attempt"]), ["1", "2", "3", "4", "5", "6", "7"]);
  assert.equal(new Set(receiver.received.map((entry) => entry.headers["x-event-id"])).size, 1, "同一个事件编号");
  assert.match(api.logs(), /webhook\.delivery_failed/);
  const failed = await deliveries("a", "?status=failed");
  assert.deepEqual([failed.length, failed[0].attempts, failed[0].last_error_code], [1, 7, "WEBHOOK_HTTP_STATUS"]);
  const root = await platformLogin("root@platform.test");
  const platform = await api.call("GET", "/platform/v1/webhook-deliveries?status=failed", { token: root });
  assertMatchesOpenApi("GET", "/platform/v1/webhook-deliveries", platform);
  assert.ok(platform.body.items.some((item: any) => item.id === failed[0].id && item.tenant.name === "甲车队"));
  const platformDetail = await api.call("GET", `/platform/v1/webhook-deliveries/${failed[0].id}`, { token: root });
  assertMatchesOpenApi("GET", "/platform/v1/webhook-deliveries/{id}", platformDetail);
  assert.equal(platformDetail.body.attempts.length, 7);

  // 手动重推：对方恢复了 → 成功
  receiver.respond([200]);
  const retried = await api.call("POST", `/tenant/v1/webhooks/deliveries/${failed[0].id}/retry`, { token: await adminToken("a") });
  assertMatchesOpenApi("POST", "/tenant/v1/webhooks/deliveries/{id}/retry", retried);
  assert.deepEqual([retried.body.delivery.status, retried.body.delivery.attempts], ["succeeded", 8]);
  const again = await api.call("POST", `/tenant/v1/webhooks/deliveries/${failed[0].id}/retry`, { token: await adminToken("a") });
  assert.deepEqual([again.status, again.body.error.code], [409, "WEBHOOK_DELIVERY_SUCCEEDED"]);
  const trigger = (await api.db.owner.query<{ trigger: string }>("select trigger from webhook_attempts where delivery_id = $1 order by attempt_no desc limit 1", [failed[0].id])).rows[0]?.trigger;
  assert.equal(trigger, "manual");
  assert.equal((await api.db.owner.query("select 1 from audit_logs where resource = 'webhook_delivery' and action = 'retry' and resource_id = $1", [failed[0].id])).rowCount, 1);
});

test("超时（对方不应答）也算失败、排重试；运营后台手动重推（运营、客服能，财务不能）", async () => {
  await configure("a", ["order.assigned"]);
  receiver.respond(["hang"]);
  const order = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 5 * 24 * 3_600_000) });
  const token = await adminToken("a");
  await ok(assign(api, { ...m.a, adminToken: token }, order.id, (await newDriver(api, { ...m.a, adminToken: token })).id, (await newVehicle(api, { ...m.a, adminToken: token }, m.ids.biz7)).id));
  await api.app.webhookJobs.tick();
  const [row] = (await api.db.owner.query<{ id: string; status: string; last_error_code: string }>("select id, status, last_error_code from webhook_deliveries where order_id = $1", [order.id])).rows;
  assert.deepEqual([row?.status, row?.last_error_code], ["pending", "WEBHOOK_TIMEOUT"]);
  const finance = await platformStaff("finance");
  const denied = await api.call("POST", `/platform/v1/webhook-deliveries/${row?.id}/retry`, { token: finance });
  assert.deepEqual([denied.status, denied.body.error.details.required], [403, "order.resend"]);
  receiver.respond([204]);
  const retried = await api.call("POST", `/platform/v1/webhook-deliveries/${row?.id}/retry`, { token: await platformLogin(m.staff.operations.email) });
  assertMatchesOpenApi("POST", "/platform/v1/webhook-deliveries/{id}/retry", retried);
  assert.equal(retried.body.delivery.status, "succeeded");
  assert.equal((await api.db.owner.query<{ tenant_id: string }>("select tenant_id from audit_logs where resource = 'webhook_delivery' and resource_id = $1 and actor_type = 'platform_user'", [row?.id])).rows[0]?.tenant_id, m.a.tenantId);
});

async function platformStaff(role: string): Promise<string> {
  const email = `${role}-${Date.now()}@hooks.test`;
  const invited = await ok(api.call("POST", "/platform/v1/staff", { token: await platformLogin("root@platform.test"), body: { email, name: role, role } }), 201);
  await ok(api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.invite.token, password: TEST_PASSWORD } }));
  return (await ok(api.platformLogin({ body: { email, password: TEST_PASSWORD } }))).access_token;
}

test("同一张订单按顺序投：前一条在等重试，后一条不发；两个实例同时跑，同一条只发一次", async () => {
  await configure("a", ["order.assigned", "order.status_changed"]);
  receiver.respond([503, 200]);
  receiver.received.length = 0;
  const order = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 5 * 24 * 3_600_000) });
  const token = await adminToken("a");
  await ok(assign(api, { ...m.a, adminToken: token }, order.id, (await newDriver(api, { ...m.a, adminToken: token })).id, (await newVehicle(api, { ...m.a, adminToken: token }, m.ids.biz7)).id));
  await ok(api.call("POST", `/tenant/v1/orders/${order.id}/events`, { token, body: { type: "departed" } }));
  const mine = (): string[] => receiver.received.map((entry) => JSON.parse(entry.body)).filter((body) => body.data.order?.id === order.id).map((body) => body.type);
  await Promise.all([api.app.webhookJobs.tick(), api.app.webhookJobs.tick()]);
  assert.deepEqual(mine(), ["order.assigned"], "第一条失败了，第二条等着");
  api.clock.advance(MINUTE);
  await Promise.all([api.app.webhookJobs.tick(), api.app.webhookJobs.tick(), api.app.webhookJobs.tick()]);
  await drain();
  assert.deepEqual(mine(), ["order.assigned", "order.assigned", "order.status_changed"], "重试成功后第二条才发，每条只发一次");
});

test("订阅暂停或删除：新事件不排队；已经排着的不再发，记为失败（WEBHOOK_NOT_CONFIGURED）；没订阅的事件不排队", async () => {
  await configure("a", ["order.status_changed"]);
  const order = await seedOrder(api, m, "a", { serviceAt: new Date(api.clock.now().getTime() + 6 * 24 * 3_600_000) });
  const token = await adminToken("a");
  await ok(assign(api, { ...m.a, adminToken: token }, order.id, (await newDriver(api, { ...m.a, adminToken: token })).id, (await newVehicle(api, { ...m.a, adminToken: token }, m.ids.biz7)).id));
  assert.equal((await api.db.owner.query("select 1 from webhook_deliveries where order_id = $1", [order.id])).rowCount, 0, "没订阅 order.assigned");
  await ok(api.call("POST", `/tenant/v1/orders/${order.id}/events`, { token, body: { type: "departed" } }));
  await api.call("DELETE", "/tenant/v1/webhooks", { token });
  receiver.received.length = 0;
  await api.app.webhookJobs.tick();
  assert.equal(receiver.received.length, 0);
  const [row] = (await api.db.owner.query<{ status: string; last_error_code: string; attempts: number }>("select status, last_error_code, attempts from webhook_deliveries where order_id = $1", [order.id])).rows;
  assert.deepEqual(row, { status: "failed", last_error_code: "WEBHOOK_NOT_CONFIGURED", attempts: 0 });
  await ok(api.call("POST", `/tenant/v1/orders/${order.id}/events`, { token, body: { type: "arrived" } }));
  assert.equal((await api.db.owner.query("select 1 from webhook_deliveries where order_id = $1", [order.id])).rowCount, 1, "删除后新事件不排队");
});

test("发送测试事件：马上发、结果直接返回、不重试；对方失败时记为失败；测试事件不能重推", async () => {
  const secret = await configure("a", ["order.confirmed"]);
  receiver.respond([200]);
  receiver.received.length = 0;
  const token = await adminToken("a");
  const res = await api.call("POST", "/tenant/v1/webhooks/test", { token });
  assertMatchesOpenApi("POST", "/tenant/v1/webhooks/test", res);
  assert.deepEqual([res.body.delivery.status, res.body.delivery.event_type, res.body.attempt.status_code, res.body.attempt.trigger], ["succeeded", "webhook.test", 200, "test"]);
  const got = receiver.received[0]!;
  assert.equal(verifyWebhookSignature(secret, { timestamp: got.headers["x-timestamp"] as string, signature: got.headers["x-signature"] as string }, got.body, api.clock.now()), null);
  assert.equal(JSON.parse(got.body).data.order, undefined);
  receiver.respond([404]);
  const failed = await ok(api.call("POST", "/tenant/v1/webhooks/test", { token }));
  assert.deepEqual([failed.delivery.status, failed.attempt.status_code, failed.attempt.error_code], ["failed", 404, "WEBHOOK_HTTP_STATUS"]);
  await api.app.webhookJobs.tick();
  assert.equal(receiver.received.length, 2, "测试事件不重试");
  const retry = await api.call("POST", `/tenant/v1/webhooks/deliveries/${failed.delivery.id}/retry`, { token });
  assert.deepEqual([retry.status, retry.body.error.code], [409, "WEBHOOK_TEST_NOT_RETRIABLE"]);
});

test("防 SSRF（真实的发送器）：保存时是公网域名，发送时解析到内网地址 → 拒绝，一个请求都不发出去", async () => {
  const resolving = await createTestApi({ webhookSender: new HttpsWebhookSender({ resolve: async () => ["10.0.0.7"] }) });
  try {
    const root = await resolving.superAdminToken();
    const tenant = await resolving.tenantWithAdmin(root, "重绑定车队", "admin@rebind.test");
    await ok(resolving.call("PUT", "/tenant/v1/webhooks", { token: tenant.adminToken, body: { url: "https://dispatch.example.com/hook", events: ["order.confirmed"] } }), 201);
    const res = await ok(resolving.call("POST", "/tenant/v1/webhooks/test", { token: tenant.adminToken }));
    assert.deepEqual([res.delivery.status, res.attempt.error_code, res.attempt.status_code], ["failed", "WEBHOOK_TARGET_FORBIDDEN", null]);
  } finally {
    await resolving.close();
  }
});
