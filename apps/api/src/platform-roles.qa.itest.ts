/**
 * 测试角色补充（M4-05，ADR 0030）：自建角色与数据范围的边界，真实 PostgreSQL。
 * - 撤销勾选、收窄数据范围：批准后同一个令牌立即失效；
 * - 不能给自己加权限：自建角色的人改不了自己的角色、发起不了角色修改；修改里带只归超级管理员的三格，发起时就拦；
 * - 复核批准时的再校验：期间角色被删 → 404，名字被别的角色占了 → 409，角色都不变、复核仍待审核；
 * - 删除「仍在使用」的判断经得起并发：删除和「把人改成这个角色」同时发生，不能 500、不能留下指着不存在角色的账号；
 * - 数据范围外的一律 404，且应答和「根本不存在」一字不差；列表的筛选参数也绕不过范围；
 * - 渠道编号大小写：范围内的渠道换成大写写法也是同一个渠道。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type ApiResponse, TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";
import { DROPOFF, type Market, SERVICE_TIME, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { FakePaymentProvider } from "./testing/payments.ts";

let api: TestApi;
let m: Market;
let root2: string;
let channelA: string;
let channelB: string;
let orderA: string;
let orderB: string;
let orderNoB: string;

before(async () => {
  api = await createTestApi({ payments: new FakePaymentProvider() });
  m = await buildMarket(api);
  root2 = (await addStaff("root2@platform.test", "super_admin")).token;
  channelA = (await newChannel(api, m.staff.cm1.token, { name: "官网甲" })).id;
  channelB = (await newChannel(api, m.staff.cm1.token, { name: "分销乙" })).id;
  const a = await placeOrder(channelA);
  const b = await placeOrder(channelB);
  orderA = a.id;
  orderB = b.id;
  orderNoB = b.orderNo;
});
after(() => api.close());

async function addStaff(email: string, role: string): Promise<{ id: string; token: string }> {
  const invited = await ok(api.call("POST", "/platform/v1/staff", { token: m.root, body: { email, name: email.split("@")[0], role } }), 201);
  await ok(api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.invite.token, password: TEST_PASSWORD } }));
  return { id: invited.user.id, token: (await ok(api.platformLogin({ body: { email, password: TEST_PASSWORD } }))).access_token };
}

async function placeOrder(channelId: string): Promise<{ id: string; orderNo: string }> {
  const creds = await salesCredentials(api, m, channelId);
  api.clock.advance(1_000);
  const quotes = await ok(api.call("POST", "/sales/v1/quotes", { token: creds.token, body: { city_id: m.ids.tokyo, category: "airport_transfer", place_id: m.ids.narita, direction: "pickup", dropoff: DROPOFF, service_time: SERVICE_TIME, passengers: 2, luggage: 1, currency: "JPY", vehicle_group_ids: [m.ids.biz7] } }));
  api.clock.advance(1_000);
  const placed = await ok(api.call("POST", "/sales/v1/orders", {
    token: creds.token,
    headers: { "idempotency-key": randomUUID() },
    body: { quote_id: quotes.quotes[0].quote_id, passenger: { name: "王小明", phone: "+81 90-1234-5678", email: "guest@example.com" }, flight_no: "NH211", dropoff_address: "东京站", save_payment_method: true },
  }), 201);
  return { id: placed.order.id as string, orderNo: placed.order.order_no as string };
}

const createRole = (body: Record<string, unknown>, token = m.root): Promise<ApiResponse> => api.call("POST", "/platform/v1/roles", { token, body });

async function approveChange(key: string, body: Record<string, unknown>): Promise<ApiResponse> {
  const requested = await ok(api.call("POST", `/platform/v1/roles/${key}/changes`, { token: m.root, body }), 202);
  return api.call("POST", `/platform/v1/approvals/${requested.approval.id}/approve`, { token: root2, body: {} });
}

test("撤销即刻失效：批准去掉「渠道查看」后，同一个令牌立即 403；收窄数据范围后，原来看得到的渠道立即 404", async () => {
  const role = await ok(createRole({ name: "撤销测试", grants: ["channels:view", "orders:view"] }), 201);
  const staff = await addStaff("revoke@platform.test", role.key);
  assert.equal((await api.call("GET", `/platform/v1/channels/${channelB}`, { token: staff.token })).status, 200);
  await ok(approveChange(role.key, { name: "撤销测试", grants: ["channels:view", "orders:view"], data_scope: { city_ids: null, channel_ids: [channelA] } }));
  assert.equal((await api.call("GET", `/platform/v1/channels/${channelB}`, { token: staff.token })).status, 404, "收窄范围立即生效");
  assert.equal((await api.call("GET", `/platform/v1/orders/${orderB}`, { token: staff.token })).status, 404);
  await ok(approveChange(role.key, { name: "撤销测试", grants: ["orders:view"], data_scope: { city_ids: null, channel_ids: [channelA] } }));
  const revoked = await api.call("GET", `/platform/v1/channels/${channelA}`, { token: staff.token });
  assert.equal(revoked.status, 403);
  assert.equal(revoked.body.error.code, "FORBIDDEN");
  assert.deepEqual((await ok(api.call("GET", "/platform/v1/auth/me", { token: staff.token }))).permissions, ["order.read"]);
});

test("不能给自己加权限：自建角色（能看账号和角色）的人改不了自己的角色、发起不了角色修改、建不了角色；修改里带只归超级管理员的格子发起时就拦", async () => {
  const role = await ok(createRole({ name: "想升权的人", grants: ["staff:view", "roles:view", "approvals:view"] }), 201);
  const staff = await addStaff("climber@platform.test", role.key);
  const self = await api.call("PATCH", `/platform/v1/staff/${staff.id}`, { token: staff.token, body: { role: "super_admin" } });
  assert.equal(self.status, 403);
  const change = await api.call("POST", `/platform/v1/roles/${role.key}/changes`, { token: staff.token, body: { name: "想升权的人", grants: ["staff:view", "staff:edit", "roles:view"] } });
  assert.equal(change.status, 403);
  assert.equal((await createRole({ name: "我的新角色", grants: ["tenants:view"] }, staff.token)).status, 403);
  assert.equal((await api.call("DELETE", `/platform/v1/roles/${role.key}`, { token: staff.token })).status, 403);

  for (const grant of ["staff:edit", "roles:edit", "roles:review"]) {
    const res = await api.call("POST", `/platform/v1/roles/${role.key}/changes`, { token: m.root, body: { name: "想升权的人", grants: ["staff:view", "roles:view", grant] } });
    assert.equal(res.status, 400, grant);
    assert.equal(res.body.error.code, "ROLE_GRANTS_INVALID", grant);
  }
  assert.equal((await api.db.owner.query("select count(*)::int as n from approvals where resource_id = $1", [role.key])).rows[0].n, 0, "一条复核都没留下");
  assert.equal((await api.call("GET", "/platform/v1/staff", { token: staff.token })).status, 200, "查看照常");
});

test("复核批准时再校验：期间角色被删了 → 404，期间名字被别的角色占了 → 409；两种情况角色都不变、复核仍待审核", async () => {
  const gone = await ok(createRole({ name: "将被删除", grants: ["orders:view"] }), 201);
  const pending = await ok(api.call("POST", `/platform/v1/roles/${gone.key}/changes`, { token: m.root, body: { name: "将被删除", grants: ["orders:view", "tenants:view"] } }), 202);
  assert.equal((await api.call("DELETE", `/platform/v1/roles/${gone.key}`, { token: m.root })).status, 204);
  const late = await api.call("POST", `/platform/v1/approvals/${pending.approval.id}/approve`, { token: root2, body: {} });
  assert.equal(late.status, 404, late.text);
  assert.equal((await api.db.owner.query("select count(*)::int as n from platform_roles where key = $1", [gone.key])).rows[0].n, 0, "批准没有把角色变回来");

  const renamed = await ok(createRole({ name: "改名前", grants: ["orders:view"] }), 201);
  const rename = await ok(api.call("POST", `/platform/v1/roles/${renamed.key}/changes`, { token: m.root, body: { name: "抢手的名字", grants: ["orders:view"] } }), 202);
  await ok(createRole({ name: "抢手的名字", grants: [] }), 201);
  const taken = await api.call("POST", `/platform/v1/approvals/${rename.approval.id}/approve`, { token: root2, body: {} });
  assert.equal(taken.status, 409, taken.text);
  assert.equal(taken.body.error.code, "ROLE_NAME_TAKEN");
  const still = await ok(api.call("GET", `/platform/v1/roles/${renamed.key}`, { token: m.root }));
  assert.equal(still.name, "改名前");
  assert.equal(still.version, 1);
  assert.equal((await api.db.owner.query("select status from approvals where id = $1", [rename.approval.id])).rows[0].status, "pending");
});

// removeRole 锁住角色行之后另发一条语句数人数（同一条语句的子查询用的是等锁之前的快照，看不到刚提交的账号）；外键冲突 23503 兜底转成 409 ROLE_IN_USE
test("并发：删除角色时恰好有人被改成这个角色（改人的事务先拿到锁）→ 删除应答 409 ROLE_IN_USE，不是 500；账号没有指着不存在的角色", async () => {
  const role = await ok(createRole({ name: "并发删除甲", grants: ["orders:view"] }), 201);
  const staff = await addStaff("race-del@platform.test", "readonly");
  const client = await api.db.owner.connect();
  let removal: Promise<ApiResponse> | null = null;
  try {
    await client.query("begin");
    // 模拟「把人改成这个角色」的事务：已经写了账号这一行（外键检查给角色行加了共享锁），还没提交
    await client.query("update platform_users set role = $1 where id = $2", [role.key, staff.id]);
    removal = api.call("DELETE", `/platform/v1/roles/${role.key}`, { token: m.root });
    await waitForLockWait();
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
  const res = await (removal as Promise<ApiResponse>);
  assert.equal(res.status, 409, `应答：${res.status} ${res.text}`);
  assert.equal(res.body.error.code, "ROLE_IN_USE");
  const orphan = await api.db.owner.query("select count(*)::int as n from platform_users u where not exists (select 1 from platform_roles r where r.key = u.role)");
  assert.equal(orphan.rows[0].n, 0);
});

// updateStaff 查角色时加共享锁（和删除排好先后）；写账号时角色已被删的外键冲突 23503 转成「没有这个角色」（400 UNKNOWN_ROLE）
test("并发：改人到某个角色时恰好这个角色被删（删除的事务先拿到锁）→ 改人的应答是 4xx（角色不存在），不是 500", async () => {
  const role = await ok(createRole({ name: "并发删除乙", grants: ["orders:view"] }), 201);
  const staff = await addStaff("race-patch@platform.test", "readonly");
  const client = await api.db.owner.connect();
  let patch: Promise<ApiResponse> | null = null;
  try {
    await client.query("begin");
    await client.query("select 1 from platform_roles where key = $1 for update", [role.key]);
    patch = api.call("PATCH", `/platform/v1/staff/${staff.id}`, { token: m.root, body: { role: role.key } });
    await waitForLockWait();
    await client.query("delete from platform_roles where key = $1", [role.key]);
    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
  const res = await (patch as Promise<ApiResponse>);
  assert.ok(res.status >= 400 && res.status < 500, `应答：${res.status} ${res.text}`);
  assert.equal((await api.db.owner.query("select role from platform_users where id = $1", [staff.id])).rows[0].role, "readonly");
});

/** 等到有一个连接在等锁（被测的请求已经卡在锁上），最多 5 秒。 */
async function waitForLockWait(): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const waiting = await api.db.owner.query("select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database() and query ilike '%platform_%'");
    if (waiting.rows[0].n > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail("被测的请求没有卡在锁上，编排失效");
}

test("数据范围外一律 404，应答和「根本不存在」一字不差（渠道及其下面、订单、推送记录、复核）", async () => {
  const role = await ok(createRole({ name: "甲渠道全能", grants: ["channels:view", "channels:edit", "channels:review", "orders:view", "orders:edit", "approvals:view"], data_scope: { city_ids: null, channel_ids: [channelA] } }), 201);
  const staff = await addStaff("scope-404@platform.test", role.key);
  const pause = await ok(api.call("POST", `/platform/v1/channels/${channelB}/pause`, { token: m.staff.cm1.token, body: {} }), 202);
  const sale = (await api.db.owner.query("select o.tenant_id from orders o where o.id = $1", [orderB])).rows[0];
  const delivery = (await api.db.owner.query<{ id: string }>(
    "insert into webhook_deliveries (tenant_id, event_id, event_type, order_id, status, failed_at, created_at) values ($1, $2, 'order.assigned', $3, 'failed', $4, $4) returning id",
    [sale.tenant_id, `evt_${randomUUID().replaceAll("-", "").slice(0, 24)}`, orderB, api.clock.now()],
  )).rows[0]!.id;
  const missing = randomUUID();
  const pairs: [string, string, string][] = [
    ["GET", `/platform/v1/channels/${channelB}`, `/platform/v1/channels/${missing}`],
    ["GET", `/platform/v1/channels/${channelB}/markup-rules`, `/platform/v1/channels/${missing}/markup-rules`],
    ["GET", `/platform/v1/channels/${channelB}/api-clients`, `/platform/v1/channels/${missing}/api-clients`],
    ["GET", `/platform/v1/channels/${channelB}/quote-logs`, `/platform/v1/channels/${missing}/quote-logs`],
    ["POST", `/platform/v1/channels/${channelB}/pause`, `/platform/v1/channels/${missing}/pause`],
    ["GET", `/platform/v1/orders/${orderB}`, `/platform/v1/orders/${missing}`],
    ["GET", `/platform/v1/webhook-deliveries/${delivery}`, `/platform/v1/webhook-deliveries/${missing}`],
    ["POST", `/platform/v1/webhook-deliveries/${delivery}/retry`, `/platform/v1/webhook-deliveries/${missing}/retry`],
    ["GET", `/platform/v1/approvals/${pause.approval.id}`, `/platform/v1/approvals/${missing}`],
    ["POST", `/platform/v1/approvals/${pause.approval.id}/approve`, `/platform/v1/approvals/${missing}/approve`],
  ];
  for (const [method, outOfScope, nonexistent] of pairs) {
    const a = await api.call(method as "GET" | "POST", outOfScope, { token: staff.token, body: method === "POST" ? {} : undefined });
    const b = await api.call(method as "GET" | "POST", nonexistent, { token: staff.token, body: method === "POST" ? {} : undefined });
    assert.equal(a.status, 404, `${method} ${outOfScope}：${a.text}`);
    assert.deepEqual(a.body, b.body, `${method} ${outOfScope} 和不存在的应答不同`);
  }
  assert.equal((await api.db.owner.query("select status from approvals where id = $1", [pause.approval.id])).rows[0].status, "pending", "范围外的批准没有效果");
  await ok(api.call("POST", `/platform/v1/approvals/${pause.approval.id}/withdraw`, { token: m.staff.cm1.token, body: {} }));
});

test("列表的筛选参数绕不过数据范围：按范围外的渠道、订单号、订单编号、复核对象筛，结果为空、总数 0", async () => {
  const role = await ok(createRole({ name: "甲渠道筛选", grants: ["orders:view", "approvals:view", "channels:view"], data_scope: { city_ids: null, channel_ids: [channelA] } }), 201);
  const staff = await addStaff("scope-filter@platform.test", role.key);
  for (const query of [`channel_id=${channelB}`, `q=${encodeURIComponent(orderNoB)}`]) {
    const list = await ok(api.call("GET", `/platform/v1/orders?${query}`, { token: staff.token }));
    assert.deepEqual([list.items.length, list.total], [0, 0], query);
  }
  const unscoped = await ok(api.call("GET", `/platform/v1/orders?q=${encodeURIComponent(orderNoB)}`, { token: m.staff.operations.token }));
  assert.equal(unscoped.total, 1, "对照：不限范围的人按订单号找得到");
  const deliveries = await ok(api.call("GET", `/platform/v1/webhook-deliveries?order_id=${orderB}`, { token: staff.token }));
  assert.deepEqual([deliveries.items.length, deliveries.total], [0, 0]);
  const pause = await ok(api.call("POST", `/platform/v1/channels/${channelB}/pause`, { token: m.staff.cm1.token, body: {} }), 202);
  const approvals = await ok(api.call("GET", `/platform/v1/approvals?resource_id=${channelB}`, { token: staff.token }));
  assert.deepEqual([approvals.items.length, approvals.total], [0, 0]);
  const channels = await ok(api.call("GET", "/platform/v1/channels?q=%E5%88%86%E9%94%80", { token: staff.token }));
  assert.deepEqual([channels.items.length, channels.total], [0, 0], "按名字搜范围外的渠道");
  await ok(api.call("POST", `/platform/v1/approvals/${pause.approval.id}/withdraw`, { token: m.staff.cm1.token, body: {} }));
  assert.equal((await api.call("GET", `/platform/v1/orders/${orderA}`, { token: staff.token })).status, 200, "范围内的照常");
});

// 数据范围按 UUID 比较、不分大小写（domain 的 scopeAllowsChannel 统一转小写），渠道接口和按渠道试算一致
test("渠道编号的大小写：范围内的渠道写成大写，渠道详情和按渠道试算都认得（和不限范围的人一致）", async () => {
  const role = await ok(createRole({ name: "甲渠道试算", grants: ["channels:view", "quote_preview:view"], data_scope: { city_ids: null, channel_ids: [channelA] } }), 201);
  const staff = await addStaff("scope-case@platform.test", role.key);
  const upper = channelA.toUpperCase();
  assert.equal((await api.call("GET", `/platform/v1/channels/${upper}`, { token: staff.token })).status, 200, "渠道详情");
  const preview = { city_id: m.ids.tokyo, category: "airport_transfer", place_id: m.ids.narita, direction: "pickup", dropoff: DROPOFF, service_time: "2026-10-20T10:00", passengers: 2, luggage: 1, currency: "JPY", channel_id: upper };
  const unscoped = await api.call("POST", "/platform/v1/quotes/preview", { token: m.root, body: preview });
  assert.equal(unscoped.status, 200, `对照：不限范围的人用大写编号可以试算：${unscoped.text}`);
  const scoped = await api.call("POST", "/platform/v1/quotes/preview", { token: staff.token, body: preview });
  assert.equal(scoped.status, 200, `范围内的渠道用大写编号试算被当成范围外：${scoped.status} ${scoped.text}`);
});
