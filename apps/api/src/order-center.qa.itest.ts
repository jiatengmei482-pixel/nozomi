/**
 * M4-02 测试角色：订单中心——异常队列、订单列表筛选、跨币种赔付、数据范围（ADR 0034、ADR 0030），经真实接口、真实 PostgreSQL；收款服务、报价汇率用替身。
 * - 异常队列：多个定时任务同时跑不生成重复；新的失败来源会重新生成；认领 / 转交 / 关闭的审计前后值；同时认领、同时关闭只一个成功；
 * - 订单列表：筛选组合下分页不重不漏（含下单时间相同的）；用车日期按东京当地日期跨午夜；下单时间的结束端不含；乘客搜 "%"、"_" 按字面；
 * - 跨币种赔付：最低额按判定时汇率中心的汇率向上取整并记下；复核批准沿用发起时的汇率；汇率超过 48 小时 409；
 * - 数据范围：限定城市 / 渠道的员工看不到范围外订单的异常和工单（列表不列、按编号 404、不能建工单）。
 * 数据全部在测试里构造，测试结束随临时数据库删除（规则 1）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { CurrencyCode, FxQuote } from "@nozomi/domain";
import { TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";
import { assign, newDriver, newVehicle } from "./testing/dispatch.ts";
import { DROPOFF, type Market, type Staff, addStaff, buildMarket, ok } from "./testing/market.ts";
import { completeOrder, platformLogin, tenantLogin } from "./testing/money.ts";
import { FakePaymentProvider, deliverWebhook } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** 报价用的汇率替身：1 日元 = 0.0067 美元（订单快照里的汇率）。判定时的最低额用的是汇率中心（数据库里的汇率），两者分开。 */
const fxQuote = async (from: CurrencyCode, to: CurrencyCode, at: Date): Promise<FxQuote | null> => (from === "JPY" && to === "USD" ? { from, to, rate: "0.0067", asOf: at.toISOString() } : null);

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let flow: SalesFlow;
let otherFlow: SalesFlow;
let support: Staff;
let support2: Staff;
let finance: Staff;
let ops2: Staff;

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay, quote: { fx: { quote: fxQuote } } });
  m = await buildMarket(api);
  flow = await salesFlow(api, m, pay);
  otherFlow = await salesFlow(api, m, pay);
  support = await addStaff(api, m.root, "oc-cs@platform.test", "customer_service");
  support2 = await addStaff(api, m.root, "oc-cs2@platform.test", "customer_service");
  finance = await addStaff(api, m.root, "oc-finance@platform.test", "finance");
  ops2 = await addStaff(api, m.root, "oc-ops2@platform.test", "operations");
});
after(() => api.close());

const iso = (ms: number): string => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const login = (who: Staff): Promise<string> => platformLogin(api, who.email);
const ops = (): Promise<string> => platformLogin(api, m.staff.operations.email);

async function paidOrder(serviceTime: string = iso(api.clock.now().getTime() + 5 * DAY), on: SalesFlow = flow): Promise<string> {
  return (await on.paidOrder({ serviceTime })).id;
}

/** 运营按平台原因代取消，退款被收款服务拒绝 → 支付异常的来源（refund:<编号>）。 */
async function failedRefundOrder(): Promise<string> {
  const orderId = await paidOrder();
  pay.nextRefundIs("failed", "expired_or_canceled_card");
  await ok(api.call("POST", `/platform/v1/orders/${orderId}/cancel`, { token: await ops(), body: { reason: "PLATFORM_FAULT", note: "平台派单出错" } }));
  return orderId;
}

async function exceptionsOf(orderId: string, token: string, status = "all"): Promise<any[]> {
  const query = status === "all" ? "" : `&status=${status}`;
  const active = await ok(api.call("GET", `/platform/v1/exceptions?order_id=${orderId}&limit=100${query === "" ? "" : query}`, { token }));
  if (status !== "all") return active.items;
  const closed = await ok(api.call("GET", `/platform/v1/exceptions?order_id=${orderId}&status=closed&limit=100`, { token }));
  return [...active.items, ...closed.items];
}

async function auditOf(exceptionId: string): Promise<{ action: string; actor_email: string; before: any; after: any }[]> {
  return (await api.db.owner.query("select action, actor_email, before, after from audit_logs where resource = 'order_exception' and resource_id = $1 order by id", [exceptionId])).rows;
}

/** 把一张已到达的单做成「客人未出现（待审核）」（司机 H5 的证据核对在 dispatch 的测试里，这里直接写库，测试数据）。 */
async function noShowClaimed(): Promise<string> {
  const orderId = await paidOrder(iso(api.clock.now().getTime() + 3 * DAY));
  const who = { ...m.b, adminToken: await tenantLogin(api, m.b.adminEmail) };
  await ok(assign(api, who, orderId, (await newDriver(api, who)).id, (await newVehicle(api, who, m.ids.biz7)).id));
  for (const type of ["departed", "arrived"]) await ok(api.call("POST", `/tenant/v1/orders/${orderId}/events`, { token: who.adminToken, body: { type } }));
  const link = (await api.db.owner.query<{ id: string }>("select id from driver_links where tenant_id = $1 and order_id = $2 order by created_at desc limit 1", [m.b.tenantId, orderId])).rows[0] as { id: string };
  const now = api.clock.now();
  await api.db.owner.query("insert into order_no_show_claims (tenant_id, order_id, submitted_at, checklist, free_wait_start, free_wait_end, status, link_id) values ($1, $2, $3, '[]'::jsonb, $4, $3, 'pending_review', $5)", [
    m.b.tenantId, orderId, now, new Date(now.getTime() - HOUR), link.id,
  ]);
  await api.db.owner.query("update orders set status = 'no_show_claimed' where tenant_id = $1 and id = $2", [m.b.tenantId, orderId]);
  return orderId;
}

// ---- 异常队列 ----

test("并发生成：5 个定时任务同时跑，每个来源只生成一条异常，各轮报告的新建数加起来等于实际新建数；no-show 审核工单也只建一张，没有哪一轮因为唯一约束失败", async () => {
  const refundOrders = [await failedRefundOrder(), await failedRefundOrder()];
  const noShowOrder = await noShowClaimed();
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => api.app.orderJobs.exceptions()));
  const failures = results.filter((r): r is PromiseRejectedResult => r.status === "rejected");
  assert.deepEqual(failures.map((f) => String(f.reason)), [], "同时跑的几轮都应当成功");
  const opened = results.reduce((sum, r) => sum + (r.status === "fulfilled" ? r.value.opened : 0), 0);
  const rows = (await api.db.owner.query("select type, source_key, count(*)::int as n from order_exceptions where order_id = any($1::uuid[]) group by type, source_key", [[...refundOrders, noShowOrder]])).rows;
  assert.ok(rows.every((row) => row.n === 1), JSON.stringify(rows));
  assert.deepEqual(rows.map((row) => row.type).sort(), ["no_show_review", "payment_issue", "payment_issue"]);
  assert.equal(opened, rows.length, "各轮报告的新建数之和 = 实际新建的条数");
  const tickets = (await api.db.owner.query("select count(*)::int as n from tickets where order_id = $1 and type = 'no_show_review'", [noShowOrder])).rows[0].n;
  assert.equal(tickets, 1);
  // 再跑一轮：什么都不新建
  assert.equal((await api.app.orderJobs.exceptions()).opened, 0);
});

test("同一个来源只生成一次，新的失败是新的来源：人工关闭后条件还在不再生成；财务重试又失败（新的一笔退款）→ 生成新的一条，旧的仍是已关闭", async () => {
  const orderId = await failedRefundOrder();
  await api.app.orderJobs.exceptions();
  const financeToken = await login(finance);
  const [first] = await exceptionsOf(orderId, financeToken, "active");
  assert.ok(first);
  await ok(api.call("POST", `/platform/v1/exceptions/${first.id}/close`, { token: financeToken, body: { resolution: "联系客人换卡后重试" } }));
  await api.app.orderJobs.exceptions();
  assert.deepEqual(await exceptionsOf(orderId, financeToken, "active"), []);
  // 重试，又被拒
  pay.nextRefundIs("failed", "card_declined");
  await ok(api.call("POST", `/platform/v1/orders/${orderId}/refunds/${first.detail.refund_id}/retry`, { token: financeToken }));
  const sweep = await api.app.orderJobs.exceptions();
  assert.ok(sweep.opened >= 1);
  const [second] = await exceptionsOf(orderId, financeToken, "active");
  assert.ok(second, "新的一笔失败应当再生成");
  assert.notEqual(second.id, first.id);
  assert.notEqual(second.detail.refund_id, first.detail.refund_id);
  assert.equal(second.detail.reason, "refund_failed");
  const old = await ok(api.call("GET", `/platform/v1/exceptions/${first.id}`, { token: financeToken }));
  assert.deepEqual([old.exception.status, old.exception.close_kind], ["closed", "resolved"]);
  // 再重试成功：新的一条系统关闭（条件解除）
  await ok(api.call("POST", `/platform/v1/orders/${orderId}/refunds/${second.detail.refund_id}/retry`, { token: financeToken }));
  await api.app.orderJobs.exceptions();
  const done = await ok(api.call("GET", `/platform/v1/exceptions/${second.id}`, { token: financeToken }));
  assert.deepEqual([done.exception.status, done.exception.close_kind, done.exception.closed_by], ["closed", "cleared", null]);
});

test("认领、转交、关闭的审计：每一步记下操作人、前后的状态和处理人；关闭记下处理说明；重复认领给自己不多记一条", async () => {
  const orderId = await failedRefundOrder();
  await api.app.orderJobs.exceptions();
  const csToken = await login(support);
  const [exception] = await exceptionsOf(orderId, csToken, "active");
  await ok(api.call("POST", `/platform/v1/exceptions/${exception.id}/claim`, { token: csToken, body: {} }));
  await ok(api.call("POST", `/platform/v1/exceptions/${exception.id}/claim`, { token: csToken, body: {} }));
  await ok(api.call("POST", `/platform/v1/exceptions/${exception.id}/claim`, { token: csToken, body: { assignee_id: finance.id } }));
  const financeToken = await login(finance);
  await ok(api.call("POST", `/platform/v1/exceptions/${exception.id}/close`, { token: financeToken, body: { resolution: "已银行转账退回" } }));
  const audit = await auditOf(exception.id);
  assert.deepEqual(
    audit.map((row) => [row.action, row.actor_email, row.before.status, row.before.assignee_id, row.after.status, row.after.assignee_id]),
    [
      ["claim", support.email, "open", null, "claimed", support.id],
      ["claim", support.email, "claimed", support.id, "claimed", finance.id],
      ["close", finance.email, "claimed", finance.id, "closed", finance.id],
    ],
  );
  assert.equal(audit[2]?.after.resolution, "已银行转账退回");
  assert.ok(audit.every((row) => row.before.order_id === orderId && row.after.type === "payment_issue"));
});

test("并发：两人同时认领同一条，只一个成功、另一个 409 EXCEPTION_ALREADY_CLAIMED，只记一条审计；不是处理人的不能转交；两人同时关闭只一个成功", async () => {
  const orderId = await failedRefundOrder();
  await api.app.orderJobs.exceptions();
  const [a, b] = [await login(support), await login(support2)];
  const [exception] = await exceptionsOf(orderId, a, "active");
  const results = await Promise.all([api.call("POST", `/platform/v1/exceptions/${exception.id}/claim`, { token: a, body: {} }), api.call("POST", `/platform/v1/exceptions/${exception.id}/claim`, { token: b, body: {} })]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409], results.map((r) => r.text).join(" / "));
  const loser = results.find((r) => r.status === 409);
  assert.equal(loser?.body.error.code, "EXCEPTION_ALREADY_CLAIMED");
  const winner = results.find((r) => r.status === 200)?.body.exception.assignee.id;
  assert.ok(winner === support.id || winner === support2.id);
  assert.equal((await auditOf(exception.id)).length, 1);
  // 不是处理人：转给自己、转给第三人都不行
  const other = winner === support.id ? b : a;
  for (const body of [{}, { assignee_id: finance.id }]) {
    const res = await api.call("POST", `/platform/v1/exceptions/${exception.id}/claim`, { token: other, body });
    assert.deepEqual([res.status, res.body.error.code], [409, "EXCEPTION_ALREADY_CLAIMED"], JSON.stringify(body));
  }
  const now = await ok(api.call("GET", `/platform/v1/exceptions/${exception.id}`, { token: a }));
  assert.equal(now.exception.assignee.id, winner);
  // 同时关闭
  const closes = await Promise.all([a, b].map((token, i) => api.call("POST", `/platform/v1/exceptions/${exception.id}/close`, { token, body: { resolution: `处理说明 ${i}` } })));
  assert.deepEqual(closes.map((r) => r.status).sort(), [200, 409], closes.map((r) => r.text).join(" / "));
  assert.equal(closes.find((r) => r.status === 409)?.body.error.code, "EXCEPTION_CLOSED");
  assert.equal((await auditOf(exception.id)).filter((row) => row.action === "close").length, 1);
});

// ---- 订单列表 ----

async function listIds(token: string, query: string): Promise<{ ids: string[]; total: number }> {
  const res = await api.call("GET", `/platform/v1/orders?${query}`, { token });
  assert.equal(res.status, 200, `${query}：${res.text}`);
  return { ids: res.body.items.map((item: any) => item.id), total: res.body.total };
}

/** 按游标一页一页翻完。 */
async function allPages(token: string, query: string, limit: number): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 100; page++) {
    const res: any = await ok(api.call("GET", `/platform/v1/orders?${query}&limit=${limit}${cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`}`, { token }));
    ids.push(...res.items.map((item: any) => item.id));
    cursor = res.next_cursor;
    if (cursor === null) return ids;
  }
  assert.fail("翻页没有结束");
}

test("订单列表分页不重不漏：筛选组合（城市 + 品类 + 乘客 + 下单时间 + 是否异常）下，按 1、2、3 条一页翻完和一次取全的一样，没有重复；下单时间完全相同的几单按编号排，也不重不漏", async () => {
  api.clock.advance(1_000);
  const from = api.clock.now();
  const ids: string[] = [];
  for (let i = 0; i < 6; i++) ids.push(await paidOrder(iso(api.clock.now().getTime() + (5 + i) * DAY)));
  const to = new Date(api.clock.now().getTime() + 1);
  // 其中 4 单的下单时间改成同一刻（测试数据）：只靠编号区分先后
  const tie = new Date(from.getTime() + 500);
  await api.db.owner.query("update orders set created_at = $2 where id = any($1::uuid[])", [ids.slice(1, 5), tie]);
  // 其中 2 单有没关的异常（测试数据）
  for (const id of [ids[0], ids[3]]) {
    await api.db.owner.query("insert into order_exceptions (type, source_key, order_id, supplier_tenant_id, detail, status, opened_at, due_at, created_at, updated_at) values ('payment_issue', $1, $2, $3, '{}'::jsonb, 'open', $4, $4, $4, $4)", [`qa:${randomUUID()}`, id, m.b.tenantId, api.clock.now()]);
  }
  const token = await ops();
  const base = `city_id=${m.ids.tokyo}&category=airport_transfer&passenger=${encodeURIComponent("小明")}&created_from=${encodeURIComponent(from.toISOString())}&created_to=${encodeURIComponent(to.toISOString())}`;
  for (const query of [base, `${base}&exception=open`, `${base}&exception=none`, `${base}&status=confirmed`]) {
    const full = await listIds(token, `${query}&limit=200`);
    assert.equal(full.total, full.ids.length, query);
    assert.equal(new Set(full.ids).size, full.ids.length);
    for (const limit of [1, 2, 3]) {
      const paged = await allPages(token, query, limit);
      assert.deepEqual(paged, full.ids, `${query} / 每页 ${limit}`);
    }
  }
  assert.deepEqual(new Set((await listIds(token, `${base}&limit=200`)).ids), new Set(ids));
  assert.deepEqual(new Set((await listIds(token, `${base}&exception=open&limit=200`)).ids), new Set([ids[0], ids[3]]));
  assert.deepEqual(new Set((await listIds(token, `${base}&exception=none&limit=200`)).ids), new Set(ids.filter((id) => id !== ids[0] && id !== ids[3])));
  const flagged = await ok(api.call("GET", `/platform/v1/orders?${base}&exception=open&limit=200`, { token }));
  assert.ok(flagged.items.every((item: any) => item.open_exceptions === 1));
});

test("用车日期按东京当地日期（跨午夜）：UTC 15:00 以后的单算东京第二天；两端都含", async () => {
  api.clock.advance(1_000);
  const from = api.clock.now().toISOString();
  const day = new Date(api.clock.now().getTime() + 6 * DAY).toISOString().slice(0, 10);
  const next = new Date(new Date(`${day}T00:00:00Z`).getTime() + DAY).toISOString().slice(0, 10);
  const late = await paidOrder(`${day}T14:59:00Z`); // 东京 day 23:59
  const midnight = await paidOrder(`${day}T15:00:00Z`); // 东京 next 00:00
  const token = await ops();
  const window = `created_from=${encodeURIComponent(from)}&limit=200`;
  assert.deepEqual(new Set((await listIds(token, `service_from=${day}&service_to=${day}&${window}`)).ids), new Set([late]));
  assert.deepEqual(new Set((await listIds(token, `service_from=${next}&service_to=${next}&${window}`)).ids), new Set([midnight]));
  assert.deepEqual(new Set((await listIds(token, `service_from=${day}&service_to=${next}&${window}`)).ids), new Set([late, midnight]));
  assert.deepEqual((await listIds(token, `service_from=${next}&service_to=${day}&${window}`)).ids, [], "起点晚于终点：没有结果");
});

test("下单时间 [from, to)：起点等于下单时刻的含、终点等于下单时刻的不含、终点晚 1 毫秒的含", async () => {
  api.clock.advance(1_000);
  const orderId = await paidOrder();
  const createdAt: Date = (await api.db.owner.query("select created_at from orders where id = $1", [orderId])).rows[0].created_at;
  const token = await ops();
  const at = (ms: number) => encodeURIComponent(new Date(ms).toISOString());
  const t = createdAt.getTime();
  assert.ok((await listIds(token, `created_from=${at(t)}&created_to=${at(t + 1)}&limit=200`)).ids.includes(orderId), "[t, t+1ms)");
  assert.ok(!(await listIds(token, `created_from=${at(t - 1000)}&created_to=${at(t)}&limit=200`)).ids.includes(orderId), "终点 = 下单时刻不含");
  assert.ok(!(await listIds(token, `created_from=${at(t + 1)}&limit=200`)).ids.includes(orderId), "起点晚 1 毫秒不含");
});

test("乘客搜索按字面：\"%\"、\"_\"、\"%%\"、\".*\" 不会匹配全部订单；空白不算两个字", async () => {
  api.clock.advance(1_000);
  const from = encodeURIComponent(api.clock.now().toISOString());
  await paidOrder();
  await paidOrder();
  const token = await ops();
  for (const needle of ["%%", "__", "%_", ".*", "%小明%"]) {
    const res = await listIds(token, `passenger=${encodeURIComponent(needle)}&created_from=${from}&limit=200`);
    assert.deepEqual(res.ids, [], `passenger=${needle} 不应匹配`);
  }
  assert.equal((await api.call("GET", `/platform/v1/orders?passenger=${encodeURIComponent(" % ")}`, { token })).status, 400, "去掉空白后只剩 1 个字");
  assert.equal((await listIds(token, `passenger=${encodeURIComponent("小明")}&created_from=${from}&limit=200`)).ids.length, 2);
});

// ---- 数据范围 ----

async function scopedStaff(name: string, scope: { city_ids: string[] | null; channel_ids: string[] | null }): Promise<string> {
  const role = await ok(api.call("POST", "/platform/v1/roles", { token: m.root, body: { name, grants: ["orders:view", "orders:edit", "exceptions:view", "exceptions:edit", "tickets:view", "tickets:edit"], data_scope: scope } }), 201);
  const email = `scope-${randomUUID().slice(0, 8)}@platform.test`;
  const invited = await ok(api.call("POST", "/platform/v1/staff", { token: m.root, body: { email, name, role: role.key } }), 201);
  await ok(api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.invite.token, password: TEST_PASSWORD } }));
  return platformLogin(api, email);
}

test("数据范围（城市、渠道，真实订单）：范围外订单的异常、工单不在列表里（带订单号、工单号筛选也查不到），按编号 404 和不存在一样，不能认领、不能给它建工单；订单列表、订单详情同样；范围内的照常", async () => {
  // 东京的一单：有支付异常、有渠道投诉
  const orderId = await failedRefundOrder();
  await api.app.orderJobs.exceptions();
  const [exception] = await exceptionsOf(orderId, await ops(), "active");
  const ticket = (await ok(api.call("POST", `/sales/v1/orders/${orderId}/tickets`, { token: await flow.token(), body: { type: "other", subject: "发票", description: "要发票" } }), 201)).ticket;
  const orderNo = (await ok(api.call("GET", `/platform/v1/orders/${orderId}`, { token: await ops() }))).order.order_no;

  const osaka = await scopedStaff("大阪", { city_ids: [m.ids.osaka], channel_ids: null });
  const otherChannel = await scopedStaff("别的渠道", { city_ids: null, channel_ids: [otherFlow.channelId] });
  const tokyo = await scopedStaff("东京", { city_ids: [m.ids.tokyo], channel_ids: [flow.channelId] });
  const missing = randomUUID();

  for (const [label, token] of [["大阪", osaka], ["别的渠道", otherChannel]] as const) {
    const lists = [
      `/platform/v1/exceptions?limit=200`,
      `/platform/v1/exceptions?order_id=${orderId}&status=active`,
      `/platform/v1/exceptions?type=payment_issue&limit=200`,
      `/platform/v1/tickets?limit=200`,
      `/platform/v1/tickets?order_id=${orderId}`,
      `/platform/v1/tickets?q=${ticket.ticket_no}`,
      `/platform/v1/orders?q=${orderNo}`,
      `/platform/v1/orders?exception=open&limit=200`,
    ];
    for (const url of lists) {
      const res = await ok(api.call("GET", url, { token }));
      assert.ok(!res.items.some((item: any) => [exception.id, ticket.id, orderId].includes(item.id)), `${label} ${url}`);
      assert.equal(res.total, res.items.length < 200 ? res.items.length : res.total, `${label} ${url}：合计也不算范围外的`);
    }
    for (const [method, url, alt, body] of [
      ["GET", `/platform/v1/exceptions/${exception.id}`, `/platform/v1/exceptions/${missing}`, undefined],
      ["POST", `/platform/v1/exceptions/${exception.id}/claim`, `/platform/v1/exceptions/${missing}/claim`, {}],
      ["GET", `/platform/v1/tickets/${ticket.id}`, `/platform/v1/tickets/${missing}`, undefined],
      ["POST", `/platform/v1/tickets/${ticket.id}/assign`, `/platform/v1/tickets/${missing}/assign`, {}],
      ["GET", `/platform/v1/orders/${orderId}`, `/platform/v1/orders/${missing}`, undefined],
    ] as const) {
      const out = await api.call(method, url, { token, ...(body === undefined ? {} : { body }) });
      const none = await api.call(method, alt, { token, ...(body === undefined ? {} : { body }) });
      assert.equal(out.status, 404, `${label} ${method} ${url}：${out.text}`);
      assert.deepEqual(out.body, none.body, `${label} ${method} ${url} 和不存在的不一样`);
    }
    const created = await api.call("POST", "/platform/v1/tickets", { token, body: { type: "other", order_id: orderId, subject: "x", description: "x" } });
    assert.equal(created.status, 404, `${label} 给范围外的订单建工单：${created.text}`);
  }
  assert.equal((await api.db.owner.query("select count(*)::int as n from tickets where order_id = $1", [orderId])).rows[0].n, 1, "范围外的人没建出工单");
  const untouched = await ok(api.call("GET", `/platform/v1/exceptions/${exception.id}`, { token: await ops() }));
  assert.deepEqual([untouched.exception.status, untouched.exception.assignee], ["open", null]);

  // 范围内（东京 + 这个渠道）照常
  assert.ok((await ok(api.call("GET", `/platform/v1/exceptions?order_id=${orderId}&status=active`, { token: tokyo }))).items.some((item: any) => item.id === exception.id));
  assert.ok((await ok(api.call("GET", `/platform/v1/tickets?order_id=${orderId}`, { token: tokyo }))).items.some((item: any) => item.id === ticket.id));
  assert.equal((await api.call("GET", `/platform/v1/orders/${orderId}`, { token: tokyo })).status, 200);
  assert.equal((await api.call("POST", `/platform/v1/exceptions/${exception.id}/claim`, { token: tokyo, body: {} })).status, 200);
  assert.equal((await api.call("POST", "/platform/v1/tickets", { token: tokyo, body: { type: "other", order_id: orderId, subject: "范围内", description: "x" } })).status, 201);
});

// ---- 跨币种赔付（放在最后：会改赔付表和汇率中心） ----

/** 汇率中心的一批汇率（以美元为基准，测试数据）。返回取数时间。 */
async function seedCentralRates(asOf: Date, jpyPerUsd: string): Promise<void> {
  const fetchId = (await api.db.owner.query<{ id: string }>("insert into fx_fetches (started_at, finished_at, trigger, source, status, source_as_of) values ($1, $1, 'schedule', 'fx.qa', 'accepted', $1) returning id", [asOf])).rows[0]?.id;
  await api.db.owner.query("insert into fx_rates (base, quote, rate, as_of, fetched_at, source, fetch_id) values ('USD', 'JPY', $3::numeric, $1, $1, 'fx.qa', $2)", [asOf, fetchId, jpyPerUsd]);
  api.app.fxCenter.invalidate();
}

/** 美元付款的一单（结算仍是日元），派车并履约完成。 */
async function usdCompletedOrder(): Promise<{ id: string; sell: number }> {
  api.clock.advance(1_000);
  const token = await flow.token();
  const quoted = await ok(api.call("POST", "/sales/v1/quotes", { token, body: { city_id: m.ids.tokyo, category: "airport_transfer", place_id: m.ids.narita, direction: "pickup", dropoff: DROPOFF, service_time: iso(api.clock.now().getTime() + 3 * DAY), passengers: 2, luggage: 1, currency: "USD", vehicle_group_ids: [m.ids.biz7] } }));
  const quote = quoted.quotes.find((q: any) => q.vehicle_group_id === m.ids.biz7);
  assert.ok(quote, JSON.stringify(quoted));
  api.clock.advance(1_000);
  const created = await ok(api.call("POST", "/sales/v1/orders", { token, headers: { "idempotency-key": randomUUID() }, body: { quote_id: quote.quote_id, passenger: { name: "Smith", phone: "+1 415 555 0100", email: "guest@example.com" }, flight_no: "UA 837", dropoff_address: "Tokyo Station", save_payment_method: true } }), 201);
  const intent = pay.intentOf(created.order.id);
  assert.ok(intent);
  pay.pay(intent.id);
  const raw = pay.event("payment_intent.succeeded", pay.intentObject(intent.id), { created: api.clock.now() });
  assert.equal((await deliverWebhook(api.app, raw, pay.sign(raw, api.clock.now()))).status, 200);
  await completeOrder(api, m, "b", created.order.id);
  const sale = (await api.db.owner.query("select sell_minor, currency from order_sales where order_id = $1", [created.order.id])).rows[0];
  assert.equal(sale.currency, "USD");
  return { id: created.order.id, sell: Number(sale.sell_minor) };
}

async function complaint(orderId: string): Promise<string> {
  return (await ok(api.call("POST", `/sales/v1/orders/${orderId}/tickets`, { token: await flow.token(), body: { type: "complaint", subject: "投诉", description: "x" } }), 201)).ticket.id;
}

/** 500 日元 × 汇率（十进制字符串）向上取整到美分：独立重算。 */
function ceilCents(minimumJpy: number, rate: string): number {
  const [whole = "0", frac = ""] = rate.split(".");
  const n = BigInt(whole + frac) * BigInt(minimumJpy) * 100n;
  const d = 10n ** BigInt(frac.length);
  return Number((n + d - 1n) / d);
}

test("跨币种赔付：客人付美元时，「至少等值 ¥500」用判定那一刻汇率中心的 JPY→USD 汇率向上取整，汇率和取数时间记进赔付记录；试算和判定一致", async () => {
  const asOf = new Date(api.clock.now().getTime() - HOUR);
  await seedCentralRates(asOf, "150");
  const order = await usdCompletedOrder();
  const ticketId = await complaint(order.id);
  const body = { scenario: "late_15_29", liable_party: "platform" };
  const csToken = await login(support);
  const quote = (await ok(api.call("POST", `/platform/v1/tickets/${ticketId}/compensation-quote`, { token: csToken, body }))).quote;
  const decided = await ok(api.call("POST", `/platform/v1/tickets/${ticketId}/decide`, { token: csToken, body: { outcome: "upheld", note: "迟到 20 分钟", compensation: body } }));
  const comp = decided.compensation;
  assert.equal(comp.minimum_fx.from, "JPY");
  assert.equal(comp.minimum_fx.to, "USD");
  assert.equal(new Date(comp.minimum_fx.as_of).getTime(), asOf.getTime());
  assert.ok(Math.abs(Number(comp.minimum_fx.rate) - 1 / 150) < 1e-9, comp.minimum_fx.rate);
  const minimum = ceilCents(500, comp.minimum_fx.rate);
  assert.equal(minimum, 334, "500 / 150 = 3.333… 美元 → 向上 334 美分");
  assert.equal(comp.minimum.amount, (minimum / 100).toFixed(2));
  assert.equal(quote.customer.minimum.amount, comp.minimum.amount);
  const ratio = Number((2n * BigInt(order.sell) * 1000n + 10_000n) / 20_000n);
  assert.equal(comp.ratio_amount.amount, (ratio / 100).toFixed(2));
  assert.equal(comp.compensation.amount, (Math.max(ratio, minimum) / 100).toFixed(2));
  assert.equal(quote.customer.compensation.amount, comp.compensation.amount);
  assert.equal(comp.compensation.currency, "USD");
});

test("跨币种 + 复核：发起时按当时的汇率算最低额，复核期间汇率中心换了一批，批准时仍用发起时记下的汇率（金额、记录的汇率都不变，不报过时）", async () => {
  // 每笔最低额改成 10 万日元（双人复核），让最低额补足、达到复核阈值
  const table = await ok(api.call("GET", "/platform/v1/compensation-table", { token: await ops() }));
  const rules = { customer_bp: Object.fromEntries(table.compensation_table.scenarios.map((s: any) => [s.scenario, s.customer_bp])), minimum_jpy: 100_000, reimbursement_cap_bp: 15_000, review_at_or_above_sell_bp: 5000 };
  const change = await ok(api.call("POST", "/platform/v1/compensation-table/changes", { token: await ops(), body: rules }), 202);
  await ok(api.call("POST", `/platform/v1/approvals/${change.approval.id}/approve`, { token: await login(finance), body: {} }));

  const firstAsOf = new Date(api.clock.now().getTime() - 10 * 60_000);
  await seedCentralRates(firstAsOf, "150");
  const order = await usdCompletedOrder();
  const ticketId = await complaint(order.id);
  const pending = await api.call("POST", `/platform/v1/tickets/${ticketId}/decide`, { token: await login(support), body: { outcome: "upheld", note: "服务态度", compensation: { scenario: "service_complaint", liable_party: "tenant" } } });
  assert.equal(pending.status, 202, pending.text);
  const recordedRate = pending.body.approval.payload.minimum_fx.rate as string;
  const expectedMinimum = ceilCents(100_000, recordedRate);
  assert.equal(pending.body.approval.payload.customer_compensation_minor, expectedMinimum, "补足到最低额");

  api.clock.advance(60_000);
  await seedCentralRates(api.clock.now(), "100");
  const approved = await api.call("POST", `/platform/v1/approvals/${pending.body.approval.id}/approve`, { token: await ops(), body: {} });
  assert.equal(approved.status, 200, approved.text);
  const done = await ok(api.call("GET", `/platform/v1/tickets/${ticketId}`, { token: await login(support) }));
  assert.equal(done.compensation.minimum_fx.rate, recordedRate);
  assert.equal(new Date(done.compensation.minimum_fx.as_of).getTime(), firstAsOf.getTime());
  assert.equal(done.compensation.compensation.amount, (expectedMinimum / 100).toFixed(2));
  assert.equal(done.compensation.topped_up, true);
  // 退款不超过这一单付的钱，其余由财务另付
  assert.equal(done.compensation.refund.amount, (order.sell / 100).toFixed(2));
  assert.equal(done.compensation.manual_payout.amount, ((expectedMinimum - order.sell) / 100).toFixed(2));
  assert.equal(done.compensation.payout_status, "pending");

  const back = await ok(api.call("POST", "/platform/v1/compensation-table/changes", { token: await ops(), body: { ...rules, minimum_jpy: 500 } }), 202);
  await ok(api.call("POST", `/platform/v1/approvals/${back.approval.id}/approve`, { token: await login(ops2), body: {} }));
});

test("汇率中心的汇率超过 48 小时：美元的单试算、判定都 409 FX_RATE_UNAVAILABLE，什么都不写；正好 48 小时还能用；日元的单不受影响", async () => {
  const order = await usdCompletedOrder();
  const ticketId = await complaint(order.id);
  // 只留一批：前面用例写的较新的几批删掉（测试数据），让「最新的一批」就是 48 小时前的
  await api.db.owner.query("delete from fx_rates where source = 'fx.qa'");
  await api.db.owner.query("delete from fx_fetches where source = 'fx.qa'");
  const now = api.clock.now().getTime();
  await seedCentralRates(new Date(now - 48 * HOUR), "150");
  const body = { scenario: "late_15_29", liable_party: "tenant" };
  const fresh = await api.call("POST", `/platform/v1/tickets/${ticketId}/compensation-quote`, { token: await login(support), body });
  assert.equal(fresh.status, 200, `正好 48 小时：${fresh.text}`);

  api.clock.advance(1);
  const csToken = await login(support);
  const quote = await api.call("POST", `/platform/v1/tickets/${ticketId}/compensation-quote`, { token: csToken, body });
  assert.deepEqual([quote.status, quote.body.error?.code], [409, "FX_RATE_UNAVAILABLE"], quote.text);
  const decided = await api.call("POST", `/platform/v1/tickets/${ticketId}/decide`, { token: csToken, body: { outcome: "upheld", note: "x", compensation: body } });
  assert.deepEqual([decided.status, decided.body.error?.code], [409, "FX_RATE_UNAVAILABLE"], decided.text);
  const after = await ok(api.call("GET", `/platform/v1/tickets/${ticketId}`, { token: csToken }));
  assert.deepEqual([after.ticket.status, after.compensation], ["open", null]);
  assert.equal(pay.refundsOf(order.id).length, 0);

  // 日元的单：最低额就是 500 日元，不用汇率
  const jpyOrder = await paidOrder(iso(api.clock.now().getTime() + 3 * DAY));
  await completeOrder(api, m, "b", jpyOrder);
  const jpyTicket = await complaint(jpyOrder);
  assert.equal((await api.call("POST", `/platform/v1/tickets/${jpyTicket}/decide`, { token: csToken, body: { outcome: "upheld", note: "x", compensation: body } })).status, 200);
});
