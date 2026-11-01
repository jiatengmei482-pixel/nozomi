/**
 * M4-20：运营审核 no-show 看得到证据（ADR 0054）、准时到达率对航班延误公平（ADR 0052「评分」）。真实接口、真实 PostgreSQL；收款服务用替身。
 * 证据走司机 H5 的真实接口攒齐 5 项，再从运营的接口读出来；含没有权限、跨数据范围、跨租户，以及照片审计。
 */
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";
import { assign, newDriver, newVehicle } from "./testing/dispatch.ts";
import { type Market, buildMarket, newChannel, ok } from "./testing/market.ts";
import { platformLogin, tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";

const MINUTE = 60_000;
const HOUR = 3_600_000;
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)]);
const NARITA_NEARBY = { lng: 140.389, lat: 35.769 };

let api: TestApi;
let m: Market;
let flow: SalesFlow;

before(async () => {
  const pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  flow = await salesFlow(api, m, pay);
});
after(() => api.close());

const ops = (): Promise<string> => platformLogin(api, m.staff.operations.email);
const soon = (hours: number): string => new Date(api.clock.now().getTime() + hours * HOUR).toISOString().replace(/\.\d{3}Z$/, "Z");

/** 乙车队中标的接机单，已派车。`minutesFromNow` 是计划到达离现在多久（负数是已经过了）。 */
async function dispatched(minutesFromNow: number): Promise<{ orderId: string; tenantToken: string; driverToken: string }> {
  const orderId = (await flow.paidOrder({ serviceTime: soon(72) })).id as string;
  await api.db.owner.query("update orders set service_at = $2 where id = $1", [orderId, new Date(api.clock.now().getTime() + minutesFromNow * MINUTE)]);
  const tenantToken = await tenantLogin(api, m.b.adminEmail);
  const who = { ...m.b, adminToken: tenantToken };
  const result = await ok(assign(api, who, orderId, (await newDriver(api, who)).id, (await newVehicle(api, who, m.ids.biz7)).id));
  return { orderId, tenantToken, driverToken: result.driver_link.token };
}

const driver = (token: string, path: string, body: unknown = {}) => api.call("POST", `/driver/v1/trip${path}`, { token, body });

async function upload(token: string, kind: string): Promise<string> {
  const res = await api.app.inject({ method: "POST", url: `/driver/v1/trip/files?kind=${kind}`, headers: { authorization: `Bearer ${token}`, "content-type": "image/jpeg" }, payload: JPEG });
  assert.equal(res.statusCode, 201, res.body);
  return res.json().file.id as string;
}

const reportLanding = async (token: string, landedAt: Date) => ok(driver(token, "/landing", { landed_at: landedAt.toISOString(), file_id: await upload(token, "arrival_screen") }));
const arrivalEvents = async (orderId: string): Promise<boolean[]> => (await api.db.owner.query("select on_time from tenant_performance_events where order_id = $1 and kind = 'arrival'", [orderId])).rows.map((row) => row.on_time);
const arrive = async (token: string): Promise<void> => {
  await ok(driver(token, "/events", { type: "departed" }));
  await ok(driver(token, "/events", { type: "arrived", location: NARITA_NEARBY }));
};

// ---- 准时到达率 ----

test("航班延误：司机报了落地时间，落地前到达算准时；落地后才到算迟到", async () => {
  const onTime = await dispatched(-60);
  await reportLanding(onTime.driverToken, new Date(api.clock.now().getTime() + 2 * MINUTE));
  await arrive(onTime.driverToken);
  assert.deepEqual(await arrivalEvents(onTime.orderId), [true], "过了计划时间，但没过落地时间");

  const late = await dispatched(-60);
  await reportLanding(late.driverToken, new Date(api.clock.now().getTime() - 10 * MINUTE));
  await arrive(late.driverToken);
  assert.deepEqual(await arrivalEvents(late.orderId), [false], "落地 10 分钟后才到，计划时间也过了");
});

test("客人点了「我已落地」也算落地记录；司机和客人都有时取较晚的", async () => {
  const guest = await dispatched(-30);
  await ok(api.call("POST", `/sales/v1/orders/${guest.orderId}/landed`, { token: await flow.token(), body: {} }));
  await arrive(guest.driverToken);
  assert.deepEqual(await arrivalEvents(guest.orderId), [true], "和客人点落地同一刻到达，不晚于基准");

  const both = await dispatched(-30);
  await ok(api.call("POST", `/sales/v1/orders/${both.orderId}/landed`, { token: await flow.token(), body: {} }));
  api.clock.advance(MINUTE);
  // 客人比现在早 1 分钟落地；司机报的比现在晚 3 分钟（5 分钟误差内），取较晚的是司机的
  await reportLanding(both.driverToken, new Date(api.clock.now().getTime() + 3 * MINUTE));
  await arrive(both.driverToken);
  assert.deepEqual(await arrivalEvents(both.orderId), [true]);
});

test("没有落地记录按计划时间：过了就是迟到；航班提前落地也不改变基准", async () => {
  const none = await dispatched(-1);
  await arrive(none.driverToken);
  assert.deepEqual(await arrivalEvents(none.orderId), [false]);

  const early = await dispatched(30);
  await reportLanding(early.driverToken, new Date(api.clock.now().getTime() - 10 * MINUTE));
  await arrive(early.driverToken);
  assert.deepEqual(await arrivalEvents(early.orderId), [true], "落地比到达早，但没过计划时间");

  const earlyLate = await dispatched(-1);
  await reportLanding(earlyLate.driverToken, new Date(api.clock.now().getTime() - 30 * MINUTE));
  await arrive(earlyLate.driverToken);
  assert.deepEqual(await arrivalEvents(earlyLate.orderId), [false], "提前落地、过了计划时间才到，算迟到");
});

test("到达之后才记的落地时间：以到达那一刻已知的数据为准，已写的结果不改", async () => {
  const { orderId, driverToken } = await dispatched(-30);
  await arrive(driverToken);
  assert.deepEqual(await arrivalEvents(orderId), [false]);
  api.clock.advance(5 * MINUTE);
  await reportLanding(driverToken, new Date(api.clock.now().getTime()));
  await ok(api.call("POST", `/sales/v1/orders/${orderId}/landed`, { token: await flow.token(), body: {} }));
  const detail = await ok(api.call("GET", `/platform/v1/orders/${orderId}`, { token: await ops() }));
  assert.equal(detail.order.landing.landed_at, api.clock.now().toISOString(), "落地时间照常记下，免费等待照常从它起算");
  assert.deepEqual(await arrivalEvents(orderId), [false], "评分事件不重写");
});

test("代传仍不计入：有落地记录也不写评分事件", async () => {
  const { orderId, driverToken } = await dispatched(-30);
  await reportLanding(driverToken, new Date(api.clock.now().getTime()));
  const proxy = async (type: string): Promise<void> => {
    const version = (await ok(api.call("GET", `/platform/v1/orders/${orderId}`, { token: await ops() }))).order.version;
    await ok(api.call("POST", `/platform/v1/orders/${orderId}/events`, { token: await ops(), headers: { "if-match": String(version) }, body: { type, occurred_at: api.clock.now().toISOString(), reason: "供应商调度系统故障" } }));
  };
  await proxy("departed");
  await proxy("arrived");
  assert.deepEqual(await arrivalEvents(orderId), []);
});

test("不是接机的单：就算库里有落地时间也不放宽，按用车时间", async () => {
  const { orderId, driverToken } = await dispatched(-30);
  await api.db.owner.query("update orders set direction = 'dropoff', guest_landed_at = $2 where id = $1", [orderId, new Date(api.clock.now().getTime() + HOUR)]);
  await arrive(driverToken);
  assert.deepEqual(await arrivalEvents(orderId), [false]);
});

// ---- 证据 ----

/** 走司机 H5 攒齐 5 项并提交 no-show。 */
async function claimed(): Promise<{ orderId: string; tenantToken: string; signboard: string; screenshot: string }> {
  const { orderId, tenantToken, driverToken } = await dispatched(30);
  await arrive(driverToken);
  const signboard = await upload(driverToken, "signboard");
  api.clock.advance(31 * MINUTE);
  const screenshot = await upload(driverToken, "contact_screenshot");
  await ok(driver(driverToken, "/contacts", { method: "phone", note: "打 +81 90-1234-5678 没人接，王小明没回" }));
  await ok(driver(driverToken, "/contacts", { method: "messaging", note: "发到 guest@example.com", file_id: screenshot }));
  await ok(driver(driverToken, "/contacts", { method: "phone" }));
  api.clock.advance(91 * MINUTE);
  await ok(driver(driverToken, "/request-leave", { location: NARITA_NEARBY }));
  api.clock.advance(11 * MINUTE);
  await ok(driver(driverToken, "/no-show"));
  return { orderId, tenantToken, signboard, screenshot };
}

const audits = async (orderId: string) => (await api.db.owner.query("select actor_email, tenant_id, after from audit_logs where resource = 'order' and resource_id = $1 and action = 'view_evidence_file' order by id", [orderId])).rows;
const getFile = (orderId: string, fileId: string, token?: string) => api.app.inject({ method: "GET", url: `/platform/v1/orders/${orderId}/files/${fileId}`, headers: token === undefined ? {} : { authorization: `Bearer ${token}` } });

async function staffWithRole(name: string, grants: string[], scope: { city_ids: string[] | null; channel_ids: string[] | null }): Promise<{ email: string; token: string }> {
  const root = await platformLogin(api, "root@platform.test");
  const role = await ok(api.call("POST", "/platform/v1/roles", { token: root, body: { name, grants, data_scope: scope } }), 201);
  const email = `evidence-${randomUUID().slice(0, 8)}@platform.test`;
  const invited = await ok(api.call("POST", "/platform/v1/staff", { token: root, body: { email, name, role: role.key } }), 201);
  await ok(api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.invite.token, password: TEST_PASSWORD } }));
  return { email, token: await platformLogin(api, email) };
}

test("运营的订单详情：5 项、到达距离和时间、联系记录、照片、落地、免费等待都有；乘客和手写备注里的联系方式打码；供应商看到的备注是原文", async () => {
  const { orderId, tenantToken, signboard, screenshot } = await claimed();
  const res = await api.call("GET", `/platform/v1/orders/${orderId}`, { token: await ops() });
  assertMatchesOpenApi("GET", "/platform/v1/orders/{id}", res);
  const detail = res.body;
  assert.equal(detail.records.no_show_claim.status, "pending_review");
  assert.deepEqual(detail.records.no_show_claim.checklist.map((entry: { item: string; ok: boolean }) => [entry.item, entry.ok]), [["arrived_on_time_nearby", true], ["contact_attempts", true], ["signboard_photo", true], ["leave_consented", true], ["submitted_in_time", true]]);
  assert.equal(detail.order.fulfilment.arrival_within_range, true);
  assert.ok(detail.order.fulfilment.arrival_distance_m !== null);
  assert.ok(detail.order.fulfilment.arrived_at !== null);
  assert.equal(detail.order.landing.source, "scheduled");
  assert.ok(detail.order.free_wait_minutes !== undefined);
  assert.deepEqual(detail.records.files.map((file: { id: string }) => file.id).sort(), [signboard, screenshot].sort());
  assert.equal(detail.records.contacts.find((contact: { file_id: string | null }) => contact.file_id === screenshot).note, "发到 gu***@example.com");
  assert.ok(detail.records.contacts.some((contact: { note: string | null }) => contact.note === "打 ****5678 没人接，王**没回"));
  const body = JSON.stringify(detail);
  for (const secret of ["王小明", "90-1234-5678", "guest@example.com"]) assert.ok(!body.includes(secret), secret);

  const tenant = await ok(api.call("GET", `/tenant/v1/orders/${orderId}`, { token: tenantToken }));
  assert.ok(tenant.records.contacts.some((contact: { note: string | null }) => contact.note === "打 +81 90-1234-5678 没人接，王小明没回"), "供应商付款后本来就看得到全文");
});

test("审核之后的详情符合接口定义（已通过 / 已驳回不只是待审核）", async () => {
  const { orderId } = await claimed();
  await api.db.owner.query("update order_no_show_claims set status = 'approved', decided_at = now(), decided_by = (select id from platform_users where email = $2) where order_id = $1", [orderId, m.staff.operations.email]);
  const res = await api.call("GET", `/platform/v1/orders/${orderId}`, { token: await ops() });
  assertMatchesOpenApi("GET", "/platform/v1/orders/{id}", res);
  assert.equal(res.body.records.no_show_claim.status, "approved");
});

test("照片：每次取到记一条审计（谁、哪张、不含内容，供应商看不到），不缓存；取不到不记", async () => {
  const { orderId, signboard, tenantToken } = await claimed();
  const res = await getFile(orderId, signboard, await ops());
  assert.deepEqual([res.statusCode, res.headers["content-type"], res.headers["cache-control"], Buffer.compare(res.rawPayload, JPEG)], [200, "image/jpeg", "no-store", 0]);
  const logged = await audits(orderId);
  assert.equal(logged.length, 1);
  assert.equal(logged[0].actor_email, m.staff.operations.email);
  assert.equal(logged[0].tenant_id, null);
  assert.deepEqual(logged[0].after.file_id, signboard);
  assert.equal(logged[0].after.kind, "signboard");
  assert.ok(typeof logged[0].after.order_no === "string");
  assert.equal(Object.keys(logged[0].after).length, 3, "只有订单号、照片编号、种类");
  assert.equal((await getFile(orderId, signboard, await ops())).statusCode, 200);
  assert.equal((await audits(orderId)).length, 2, "再看一次再记一条");
  assert.equal((await getFile(orderId, randomUUID(), await ops())).statusCode, 404);
  assert.equal((await audits(orderId)).length, 2, "不存在的不记");

  const view = await api.app.inject({ method: "GET", url: `/tenant/v1/orders/${orderId}/files/${signboard}`, headers: { authorization: `Bearer ${tenantToken}` } });
  assert.equal(view.statusCode, 200);
  assert.equal((await audits(orderId)).length, 2, "供应商看自己的照片不算平台访问");
});

test("没有权限、跨数据范围、跨租户：详情和照片都拿不到，也不留审计", async () => {
  const { orderId, signboard } = await claimed();
  const paths = [`/platform/v1/orders/${orderId}`, `/platform/v1/orders/${orderId}/files/${signboard}`];
  const status = async (path: string, token?: string): Promise<number> => (await api.app.inject({ method: "GET", url: path, headers: token === undefined ? {} : { authorization: `Bearer ${token}` } })).statusCode;

  const noOrders = await staffWithRole("只看工单", ["tickets:view"], { city_ids: null, channel_ids: null });
  const osaka = await staffWithRole("大阪订单", ["orders:view"], { city_ids: [m.ids.osaka], channel_ids: null });
  const otherChannel = await staffWithRole("别的渠道", ["orders:view"], { city_ids: null, channel_ids: [(await newChannel(api, await platformLogin(api, m.staff.cm1.email), { name: `别的渠道-${randomUUID().slice(0, 4)}` })).id] });
  const tokyo = await staffWithRole("东京订单", ["orders:view"], { city_ids: [m.ids.tokyo], channel_ids: null });
  const otherTenant = await tenantLogin(api, m.a.adminEmail);
  for (const path of paths) {
    assert.equal(await status(path), 401, `${path} 没登录`);
    assert.equal(await status(path, noOrders.token), 403, `${path} 没有 order.read`);
    assert.equal(await status(path, osaka.token), 404, `${path} 城市范围外`);
    assert.equal(await status(path, otherChannel.token), 404, `${path} 渠道范围外`);
    assert.equal(await status(path, otherTenant), 401, `${path} 供应商的令牌不能调运营接口`);
  }
  assert.equal(await status(`/tenant/v1/orders/${orderId}/files/${signboard}`, otherTenant), 404, "别的供应商");
  assert.deepEqual(await audits(orderId), []);

  assert.equal(await status(paths[1] as string, tokyo.token), 200, "范围内的自建角色能看");
  assert.equal((await audits(orderId))[0].actor_email, tokyo.email);
});

// ---- 看不到证据不能判定（ADR 0054） ----

/** 从提交 no-show 建出审核工单。 */
async function reviewTicket(): Promise<{ orderId: string; ticketId: string }> {
  const { orderId } = await claimed();
  await api.app.orderJobs.exceptions();
  const list = await ok(api.call("GET", `/platform/v1/tickets?type=no_show_review&order_id=${orderId}`, { token: await ops() }));
  return { orderId, ticketId: list.items[0].id as string };
}

const decide = (ticketId: string, token: string) => api.call("POST", `/platform/v1/tickets/${ticketId}/decide`, { token, body: { outcome: "approved", note: "证据齐全" } });
const orderStatus = async (orderId: string): Promise<string> => (await api.db.owner.query<{ status: string }>("select status from orders where id = $1", [orderId])).rows[0]?.status as string;

test("判定 no-show：有工单权限但没有 order.read 的 403，订单不动；范围外 404；有 order.read 的自建角色能判", async () => {
  const { orderId, ticketId } = await reviewTicket();
  const blind = await staffWithRole("只管工单", ["tickets:view", "tickets:edit"], { city_ids: null, channel_ids: null });
  const refused = await decide(ticketId, blind.token);
  assert.deepEqual([refused.status, refused.body.error.code, refused.body.error.details.required], [403, "FORBIDDEN", "order.read"]);
  assert.equal(await orderStatus(orderId), "no_show_claimed");

  const osaka = await staffWithRole("大阪工单", ["tickets:view", "tickets:edit", "orders:view"], { city_ids: [m.ids.osaka], channel_ids: null });
  assert.equal((await decide(ticketId, osaka.token)).status, 404);
  assert.equal(await orderStatus(orderId), "no_show_claimed");

  const allowed = await staffWithRole("工单和订单", ["tickets:view", "tickets:edit", "orders:view"], { city_ids: [m.ids.tokyo], channel_ids: null });
  const decided = await decide(ticketId, allowed.token);
  assert.equal(decided.status, 200, decided.text);
  assert.equal(await orderStatus(orderId), "no_show");
});

test("其他类型的工单不受影响：没有 order.read 也能判投诉（不判 no-show）", async () => {
  const { orderId } = await dispatched(30);
  const created = await ok(api.call("POST", "/platform/v1/tickets", { token: await ops(), body: { order_id: orderId, type: "other", subject: "杂项", description: "杂项" } }), 201);
  const blind = await staffWithRole("只管工单 2", ["tickets:view", "tickets:edit"], { city_ids: null, channel_ids: null });
  const res = await api.call("POST", `/platform/v1/tickets/${created.ticket.id}/decide`, { token: blind.token, body: { outcome: "resolved", note: "处理完了" } });
  assert.equal(res.status, 200, res.text);
});

test("对 no-show 审核的申诉：判定和关闭都要 order.read（关掉等于驳回）", async () => {
  const { ticketId } = await reviewTicket();
  await ok(api.call("POST", `/platform/v1/tickets/${ticketId}/decide`, { token: await ops(), body: { outcome: "rejected", note: "照片不清楚" } }));
  const tenantToken = await tenantLogin(api, m.b.adminEmail);
  const appeal = await ok(api.call("POST", "/tenant/v1/tickets", { token: tenantToken, body: { type: "tenant_appeal", parent_ticket_id: ticketId, subject: "申诉", description: "司机确实到了" } }), 201);
  const appealId = appeal.ticket.id as string;
  const blind = await staffWithRole("只管工单 3", ["tickets:view", "tickets:edit"], { city_ids: null, channel_ids: null });
  const decided = await api.call("POST", `/platform/v1/tickets/${appealId}/decide`, { token: blind.token, body: { outcome: "rejected", note: "不成立" } });
  assert.deepEqual([decided.status, decided.body.error.details.required], [403, "order.read"]);
  const closed = await api.call("POST", `/platform/v1/tickets/${appealId}/close`, { token: blind.token, body: { note: "不看了" } });
  assert.deepEqual([closed.status, closed.body.error.details.required], [403, "order.read"]);
});
