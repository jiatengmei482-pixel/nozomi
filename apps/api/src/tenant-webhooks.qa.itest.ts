/**
 * QA（M3-02）：推送给供应商的 Webhook——租约、手动重推和推送任务的并发、进程中途退出后的接续、签名密钥的存放、重放、推送内容。
 * 真实接口 + 真实 PostgreSQL（独立 schema，测试结束删除）；接收方是本机的假服务器，发送器包一层可以「卡住」或「中途退出」的替身。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { WEBHOOK_MAX_ATTEMPTS, WEBHOOK_RULES } from "@nozomi/domain";
import { verifyWebhookSignature } from "./integrations/webhook-signature.ts";
import type { WebhookSender } from "./integrations/webhook-sender.ts";
import { TEST_PASSWORD, type TestApi, createTestApi, localWebhookSender } from "./testing/api.ts";
import { type Market, buildMarket, ok } from "./testing/market.ts";
import { type FakeReceiver, assign, newDriver, newVehicle, seedOrder, startFakeReceiver } from "./testing/dispatch.ts";

let api: TestApi;
let m: Market;
let receiver: FakeReceiver;

/** 下一次发送先停在这里，等测试放行。 */
let hold: { entered: () => void; release: Promise<void> } | null = null;
/** 下一次发送时「进程退出」：抛出异常，什么都没发出去、也没记结果。 */
let crashNext = false;

const base = localWebhookSender({ timeoutMs: 1_000 });
const sender: WebhookSender = {
  send: async (request) => {
    if (crashNext) {
      crashNext = false;
      throw new Error("进程在发送中途退出");
    }
    if (hold !== null) {
      const current = hold;
      hold = null;
      current.entered();
      await current.release;
    }
    return base.send(request);
  },
};

before(async () => {
  api = await createTestApi({ webhookSender: sender });
  m = await buildMarket(api);
  receiver = await startFakeReceiver();
});
after(async () => {
  await receiver.close();
  await api.close();
});

const MINUTE = 60_000;

async function adminToken(side: "a" | "b"): Promise<string> {
  return (await ok(api.call("POST", "/tenant/v1/auth/login", { body: { email: m[side].adminEmail, password: TEST_PASSWORD } }))).access_token;
}

async function configure(side: "a" | "b", events: string[]): Promise<string> {
  const token = await adminToken(side);
  const current = await ok(api.call("GET", "/tenant/v1/webhooks", { token }));
  if (current.webhook !== null) await api.call("DELETE", "/tenant/v1/webhooks", { token });
  const created = await api.call("PUT", "/tenant/v1/webhooks", { token, body: { url: receiver.url, events } });
  assert.equal(created.status, 201, created.text);
  return created.body.secret as string;
}

/** 把排着的推送全部投完（到期的），清空上一个测试留下的。 */
async function drain(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    const result = await api.app.webhookJobs.tick();
    if (result.succeeded + result.retrying + result.failed === 0) return;
  }
}

/** 给供应商的一张单派车，排一条 `order.assigned`；返回订单和那条投递。 */
async function assignedDelivery(side: "a" | "b"): Promise<{ orderId: string; deliveryId: string; eventId: string }> {
  const token = await adminToken(side);
  const who = { ...m[side], adminToken: token };
  const order = await seedOrder(api, m, side, { serviceAt: new Date(api.clock.now().getTime() + 5 * 24 * 60 * MINUTE) });
  await ok(assign(api, who, order.id, (await newDriver(api, who)).id, (await newVehicle(api, who, m.ids.biz7)).id));
  const row = (await api.db.owner.query<{ id: string; event_id: string }>("select id, event_id from webhook_deliveries where order_id = $1 and event_type = 'order.assigned'", [order.id])).rows[0];
  assert.ok(row !== undefined, "排上了 order.assigned");
  return { orderId: order.id, deliveryId: row.id, eventId: row.event_id };
}

const receivedFor = (eventId: string) => receiver.received.filter((entry) => entry.headers["x-event-id"] === eventId);

test("缺陷复现 · 推送任务正在发（租约中）时供应商点「手动重推」：同一条推送被同时发了两次，两次都记成第 1 次尝试", async () => {
  await drain();
  await configure("a", ["order.assigned"]);
  receiver.respond([200]);
  const { deliveryId, eventId } = await assignedDelivery("a");
  let entered!: () => void;
  let release!: () => void;
  const enteredPromise = new Promise<void>((resolve) => (entered = resolve));
  hold = { entered, release: new Promise<void>((resolve) => (release = resolve)) };
  const ticking = api.app.webhookJobs.tick();
  await enteredPromise;
  // 推送任务已经租下这一条、正在发送；这时管理员在后台点了重推
  const retried = await api.call("POST", `/tenant/v1/webhooks/deliveries/${deliveryId}/retry`, { token: await adminToken("a") });
  release();
  await ticking;
  const attempts = (await api.db.owner.query<{ attempt_no: number }>("select attempt_no from webhook_attempts where delivery_id = $1 order by attempt_no", [deliveryId])).rows.map((row) => row.attempt_no);
  assert.equal(receivedFor(eventId).length, 1, `租约中的推送不应被重推再发一次（重推应答 ${retried.status}，接收方收到 ${receivedFor(eventId).length} 次，尝试编号 ${attempts.join(",")}）`);
  assert.equal(new Set(attempts).size, attempts.length, "尝试的编号不应重复");
});

test("进程在发送中途退出：租约（60 秒）到期前别的实例不接手，到期后接着发，同一个 event_id，只记一次尝试", async () => {
  await drain();
  await configure("a", ["order.assigned"]);
  receiver.respond([200]);
  const { deliveryId, eventId } = await assignedDelivery("a");
  crashNext = true;
  await assert.rejects(api.app.webhookJobs.tick());
  const leased = (await api.db.owner.query<{ status: string; attempts: number; next_attempt_at: Date }>("select status, attempts, next_attempt_at from webhook_deliveries where id = $1", [deliveryId])).rows[0];
  assert.deepEqual([leased?.status, leased?.attempts, (leased?.next_attempt_at as Date).getTime() - api.clock.now().getTime()], ["pending", 0, 60_000]);
  api.clock.advance(59_000);
  assert.equal((await api.app.webhookJobs.tick()).succeeded, 0, "租约还没到期");
  api.clock.advance(1_000);
  assert.equal((await api.app.webhookJobs.tick()).succeeded, 1);
  assert.equal(receivedFor(eventId).length, 1);
  assert.equal(receivedFor(eventId)[0]?.headers["x-delivery-attempt"], "1");
  const attempts = await api.db.owner.query("select 1 from webhook_attempts where delivery_id = $1", [deliveryId]);
  assert.equal(attempts.rowCount, 1);
});

test("签名密钥：原文不在库里任何一张表、审计日志、服务日志、设置页的应答里；换密钥后的推送用新密钥签，旧密钥验不过", async () => {
  await drain();
  const secret = await configure("a", ["order.assigned"]);
  assert.match(secret, /^nzwh_[A-Za-z0-9_-]{43}$/);
  for (const table of ["tenant_webhooks", "webhook_deliveries", "webhook_attempts", "audit_logs"]) {
    const rows = await api.db.owner.query<{ t: string }>(`select row_to_json(x)::text as t from ${table} x`);
    for (const row of rows.rows) assert.ok(!row.t.includes(secret.slice(5)), `${table} 里出现了签名密钥原文`);
  }
  const settings = await api.call("GET", "/tenant/v1/webhooks", { token: await adminToken("a") });
  assert.ok(!settings.text.includes(secret.slice(5)));
  assert.equal(settings.body.webhook.secret_hint ?? settings.body.webhook.secret_last4, secret.slice(-4));
  const rotated = await ok(api.call("POST", "/tenant/v1/webhooks/rotate-secret", { token: await adminToken("a") }));
  const fresh = rotated.secret as string;
  assert.notEqual(fresh, secret);
  receiver.respond([200]);
  const { eventId } = await assignedDelivery("a");
  await drain();
  const got = receivedFor(eventId)[0];
  assert.ok(got !== undefined);
  const headers = { timestamp: got.headers["x-timestamp"] as string, signature: got.headers["x-signature"] as string };
  assert.equal(verifyWebhookSignature(fresh, headers, got.body, api.clock.now()), null);
  assert.equal(verifyWebhookSignature(secret, headers, got.body, api.clock.now()), "MISMATCH");
  assert.ok(!api.logs().includes(secret.slice(5)) && !api.logs().includes(fresh.slice(5)), "服务日志里出现了签名密钥原文");
});

test("重放：抓到的请求原样再发，过了 5 分钟接收方按参考实现拒绝；改了请求体、换了时间戳也拒绝", async () => {
  await drain();
  const secret = await configure("a", ["order.assigned"]);
  receiver.respond([200]);
  const { eventId } = await assignedDelivery("a");
  await drain();
  const got = receivedFor(eventId)[0];
  assert.ok(got !== undefined);
  const timestamp = got.headers["x-timestamp"] as string;
  const signature = got.headers["x-signature"] as string;
  assert.equal(Number(timestamp), Math.floor(api.clock.now().getTime() / 1000), "时间戳是系统时间（秒）");
  const later = (seconds: number) => new Date(Number(timestamp) * 1000 + seconds * 1000);
  assert.equal(verifyWebhookSignature(secret, { timestamp, signature }, got.body, later(WEBHOOK_RULES.signatureToleranceSeconds)), null);
  assert.equal(verifyWebhookSignature(secret, { timestamp, signature }, got.body, later(WEBHOOK_RULES.signatureToleranceSeconds + 1)), "TIMESTAMP_OUT_OF_TOLERANCE");
  assert.equal(verifyWebhookSignature(secret, { timestamp: String(Number(timestamp) + 60), signature }, got.body, later(0)), "MISMATCH");
  assert.equal(verifyWebhookSignature(secret, { timestamp, signature }, got.body.replace('"order.assigned"', '"order.confirmed"'), later(0)), "MISMATCH");
  const body = JSON.parse(got.body);
  assert.equal(body.event_id, got.headers["x-event-id"]);
});

test("推送内容：没有对外价、加价比例、渠道、司机链接的令牌；tenant_id 是收件的供应商自己", async () => {
  await drain();
  await configure("a", ["order.assigned"]);
  receiver.respond([200]);
  const { eventId } = await assignedDelivery("a");
  await drain();
  const got = receivedFor(eventId)[0];
  assert.ok(got !== undefined);
  assert.doesNotMatch(got.body, /nzd_|sell|markup|channel|band_bp|fx_rate|对外价|加价/i);
  const body = JSON.parse(got.body);
  assert.equal(body.tenant_id, m.a.tenantId);
  assert.equal(body.type, "order.assigned");
  assert.deepEqual(Object.keys(body).sort(), ["created_at", "data", "event_id", "tenant_id", "type"]);
});

test("签名密钥的密文搬到别的供应商的行里解不开：那个供应商的推送记为 WEBHOOK_SECRET_UNAVAILABLE，一个请求都不发", async () => {
  await drain();
  await configure("a", ["order.assigned"]);
  await configure("b", ["order.assigned"]);
  await api.db.owner.query("update tenant_webhooks set secret_ciphertext = (select secret_ciphertext from tenant_webhooks where tenant_id = $1) where tenant_id = $2", [m.a.tenantId, m.b.tenantId]);
  receiver.respond([200]);
  const { deliveryId, eventId } = await assignedDelivery("b");
  await api.app.webhookJobs.tick();
  const row = (await api.db.owner.query<{ status: string; last_error_code: string }>("select status, last_error_code from webhook_deliveries where id = $1", [deliveryId])).rows[0];
  assert.deepEqual([row?.status, row?.last_error_code], ["pending", "WEBHOOK_SECRET_UNAVAILABLE"]);
  assert.equal(receivedFor(eventId).length, 0);
  await api.call("DELETE", "/tenant/v1/webhooks", { token: await adminToken("b") });
  await drain();
});

test("最终失败之后手动重推仍失败：直接回到最终失败，不再自动排重试", async () => {
  await drain();
  await configure("a", ["order.assigned"]);
  receiver.respond([500]);
  const { deliveryId, eventId } = await assignedDelivery("a");
  for (let attempt = 1; attempt <= WEBHOOK_MAX_ATTEMPTS; attempt += 1) {
    await api.app.webhookJobs.tick();
    const next = (await api.db.owner.query<{ next_attempt_at: Date | null }>("select next_attempt_at from webhook_deliveries where id = $1", [deliveryId])).rows[0]?.next_attempt_at;
    if (next !== null && next !== undefined) api.clock.advance(next.getTime() - api.clock.now().getTime());
  }
  const failed = (await api.db.owner.query<{ status: string; attempts: number }>("select status, attempts from webhook_deliveries where id = $1", [deliveryId])).rows[0];
  assert.deepEqual([failed?.status, failed?.attempts], ["failed", WEBHOOK_MAX_ATTEMPTS]);
  const retried = await ok(api.call("POST", `/tenant/v1/webhooks/deliveries/${deliveryId}/retry`, { token: await adminToken("a") }));
  assert.deepEqual([retried.delivery.status, retried.delivery.attempts], ["failed", WEBHOOK_MAX_ATTEMPTS + 1]);
  const before = receivedFor(eventId).length;
  api.clock.advance(3 * 24 * 60 * MINUTE);
  await drain();
  assert.equal(receivedFor(eventId).length, before, "最终失败后不会再自动发");
  receiver.respond([200]);
});
