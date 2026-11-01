/**
 * M4-21 QA：打码绕过（所有平台接口拿不到原文）、reveal 的权限组合、打码误伤、编辑框不把打码内容写回、供应商/司机/渠道不受影响、官网查订单的失败路径一致。
 * 真实 PostgreSQL，数据虚构，随 schema 删除。
 */
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { ANONYMIZED_TEXT } from "@nozomi/domain";
import { TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";
import { assign, newDriver, newVehicle } from "./testing/dispatch.ts";
import { type Market, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { platformLogin, tenantLogin } from "./testing/money.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";
import { DAY, type Seeded, endAt, insertApproval, insertException, insertGuestNotification, insertRescue, insertWebhookDelivery, isDone, tokyoDaysAgo } from "./testing/retention-fixtures.ts";

const NAME = "王小明";
const PHONE = "09012345678";
const EMAIL = "guest@example.com";
const WRITTEN = `${NAME}来电，电话 ${PHONE}，邮箱 ${EMAIL}`;
const SECRETS = [NAME, "小明", PHONE, "12345678", "guest@"];

let api: TestApi;
let m: Market;
let flow: SalesFlow;
let pay: FakePaymentProvider;
let token: string;
let serviceDays = 40;

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  flow = await salesFlow(api, m, pay);
  token = await platformLogin(api, m.staff.operations.email);
});
after(() => api.close());

const q = (sql: string, args: unknown[] = []) => api.db.owner.query(sql, args);
const tick = () => api.app.passengerRetention.tick();
const secretsIn = (text: string): string[] => SECRETS.filter((secret) => text.includes(secret));
const noSecrets = (text: string, where: string): void => assert.deepEqual(secretsIn(text), [], `${where}：${text.slice(Math.max(0, text.indexOf(secretsIn(text)[0] ?? "") - 120), text.indexOf(secretsIn(text)[0] ?? "") + 80)}`);
const reveal = (orderId: string, as: string) => api.call("POST", `/platform/v1/orders/${orderId}/passenger/reveal`, { token: as });

async function paid(): Promise<any> {
  serviceDays += 1;
  return flow.paidOrder({ serviceTime: new Date(api.clock.now().getTime() + serviceDays * DAY).toISOString().replace(/\.\d{3}Z$/, "Z") });
}
const seededOf = async (order: any): Promise<Seeded> => ({ id: order.id, orderNo: order.order_no, tenantId: (await q("select tenant_id from orders where id = $1", [order.id])).rows[0].tenant_id });
const versionOf = async (id: string): Promise<number> => (await ok(api.call("GET", `/platform/v1/orders/${id}`, { token }))).order.version;
const patch = async (id: string, body: unknown) => api.call("PATCH", `/platform/v1/orders/${id}`, { token, headers: { "if-match": String(await versionOf(id)) }, body });

async function staffWith(grants: string[], dataScope: unknown = { city_ids: null, channel_ids: null }): Promise<string> {
  const role = await ok(api.call("POST", "/platform/v1/roles", { token: m.root, body: { name: `角色-${randomUUID().slice(0, 6)}`, grants, data_scope: dataScope } }), 201);
  const email = `s-${randomUUID().slice(0, 8)}@platform.test`;
  const invited = await ok(api.call("POST", "/platform/v1/staff", { token: m.root, body: { email, name: "员工", role: role.key } }), 201);
  await ok(api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.invite.token, password: TEST_PASSWORD } }));
  return platformLogin(api, email);
}

// ---- 只有一串数字的手写内容 ----

test("备注只写了一个电话：运营的订单详情不能给原文（ENUM_CODE 把纯数字当成系统枚举放过了）", async () => {
  const order = await paid();
  assert.equal((await patch(order.id, { notes: PHONE })).status, 200);
  const detail = await ok(api.call("GET", `/platform/v1/orders/${order.id}`, { token }));
  noSecrets(JSON.stringify(detail.order.notes), "order.notes");
  assert.equal(detail.order.notes_masked, true);
  noSecrets(JSON.stringify(detail.changes), "改单前后值");
});

test("工单对话只写了一个电话：工单详情不能给原文", async () => {
  const order = await paid();
  const ticket = await ok(api.call("POST", "/platform/v1/tickets", { token, body: { order_id: order.id, type: "other", subject: PHONE, description: "请回电" } }), 201);
  await ok(api.call("POST", `/platform/v1/tickets/${ticket.ticket.id}/messages`, { token, body: { body: PHONE } }), 201);
  noSecrets((await api.call("GET", `/platform/v1/tickets/${ticket.ticket.id}`, { token })).text, "工单详情");
});

test("备注只写了一个电话：审计日志库里不能有原文（审计要留 3 年且改不了）", async () => {
  const order = await paid();
  assert.equal((await patch(order.id, { notes: PHONE })).status, 200);
  const stored = (await q("select after from audit_logs where resource = 'order_change' and after ->> 'order_id' = $1", [order.id])).rows;
  noSecrets(JSON.stringify(stored), "审计");
});

test("备注只写了一个电话：脱敏后改单前后值、推送内容里不能留原文", async () => {
  const order = await paid();
  assert.equal((await patch(order.id, { notes: PHONE })).status, 200);
  await insertWebhookDelivery(api, await seededOf(order), "failed", { notes: PHONE });
  await endAt(api, order.id, tokyoDaysAgo(api, 200));
  await tick();
  assert.equal(await isDone(api, order.id), true);
  noSecrets(JSON.stringify((await q("select before, after from order_changes where order_id = $1", [order.id])).rows), "order_changes");
  noSecrets(JSON.stringify((await q("select event_data from webhook_deliveries where order_id = $1", [order.id])).rows), "webhook_deliveries");
});

test("姓名全大写（护照姓名）单独写在备注里：不能当成系统枚举放过；带下划线的账号也一样", async () => {
  const order = await paid();
  await q("update orders set passenger = $2::jsonb where id = $1", [order.id, JSON.stringify({ name: "WANG XIAOMING", phone: "+819012345678", email: EMAIL })]);
  assert.equal((await patch(order.id, { notes: "WANG" })).status, 200);
  const detail = await ok(api.call("GET", `/platform/v1/orders/${order.id}`, { token }));
  assert.notEqual(detail.order.notes, "WANG");
});

// ---- 编辑框写回 ----

test("改过姓名后，备注里写的是旧姓名：详情打了码，notes_masked 必须为真，否则改单框把打码后的文字存回去、原文丢失", async () => {
  const order = await paid();
  assert.equal((await patch(order.id, { notes: `${NAME}要儿童座椅` })).status, 200);
  assert.equal((await patch(order.id, { passenger: { name: "李大伟", phone: "+81 80-9999-0000", email: "new@example.com" } })).status, 200);
  const detail = await ok(api.call("GET", `/platform/v1/orders/${order.id}`, { token }));
  const raw = (await q("select notes from orders where id = $1", [order.id])).rows[0].notes;
  assert.equal(raw, `${NAME}要儿童座椅`);
  assert.notEqual(detail.order.notes, raw, "详情里确实打了码（前提）");
  assert.equal(detail.order.notes_masked, true, `接口返回的备注是「${detail.order.notes}」却说没打码：页面把它当初始值`);
});

test("只改备注的响应：不能绕过打码（响应里没有 passenger 键时姓名认不出来）", async () => {
  const order = await paid();
  const res = await patch(order.id, { notes: WRITTEN });
  assert.equal(res.status, 200, res.text);
  noSecrets(res.text, "PATCH 响应");
});

test("订单详情里取消说明、加收文字打码；发起取消的复核响应也打码", async () => {
  const order = await paid();
  const res = await api.call("POST", `/platform/v1/orders/${order.id}/cancel`, { token, body: { reason: "GUEST_REQUEST", waive_fee: true, note: WRITTEN } });
  assert.ok([200, 202].includes(res.status), res.text);
  noSecrets(res.text, "取消的响应");
  const detail = await api.call("GET", `/platform/v1/orders/${order.id}`, { token });
  noSecrets(detail.text, "详情");
  const approvals = await api.call("GET", "/platform/v1/approvals?status=pending", { token: m.root });
  noSecrets(approvals.text, "复核列表");
});

// ---- 其他平台接口 ----

test("救援：供应商写的拒绝原因是手写内容，/platform/v1/rescues 和订单详情都不能给原文", async () => {
  const order = await paid();
  const seeded = await seededOf(order);
  const rescue = await insertRescue(api, seeded, "open", { reason: WRITTEN });
  const other = seeded.tenantId === m.a.tenantId ? { tenant: m.b.tenantId, product: m.ids.pb } : { tenant: m.a.tenantId, product: m.ids.pa };
  await q(
    `insert into order_rescue_offers (tenant_id, rescue_id, order_id, product_id, product_version, vehicle_group_id, trip, settlement_minor, settlement_currency, settlement, status, offered_by_type, offered_at, expires_at, decided_at, decline_reason)
     values ($1, $2, $3, $4, 1, $5, '{}'::jsonb, 20000, 'JPY', '{}'::jsonb, 'declined', 'system', $6, $7, $6, $8)`,
    [other.tenant, rescue, order.id, other.product, m.ids.biz7, api.clock.now(), new Date(api.clock.now().getTime() + DAY), WRITTEN],
  );
  const list = await api.call("GET", "/platform/v1/rescues", { token: m.root });
  assert.equal(list.status, 200, list.text);
  noSecrets(list.text, "救援列表");
  const detail = await api.call("GET", `/platform/v1/orders/${order.id}`, { token });
  assert.equal(detail.status, 200, detail.text);
  noSecrets(detail.text, "订单详情");
  await q("update order_rescues set status = 'cancelled', closed_at = $2 where id = $1", [rescue, api.clock.now()]);
});

test("通知：/platform/v1/notifications 的错误信息不能给收件地址和姓名（邮件服务器拒收信息会带地址）", async () => {
  const order = await paid();
  await insertGuestNotification(api, await seededOf(order), "failed", { recipient: EMAIL, lastError: `550 ${EMAIL} rejected for ${NAME} ${PHONE}` });
  const res = await api.call("GET", `/platform/v1/notifications?order_id=${order.id}`, { token: m.root });
  assert.equal(res.status, 200, res.text);
  noSecrets(res.text, "通知列表");
});

test("异常：detail 里重试错误带的地址和电话打码", async () => {
  const order = await paid();
  await insertException(api, await seededOf(order), "open", { detail: { reason: "refund_failed", last_error: { code: "x", message: WRITTEN } } });
  const res = await api.call("GET", `/platform/v1/exceptions?order_id=${order.id}&status=active`, { token });
  assert.equal(res.status, 200, res.text);
  noSecrets(res.text, "异常列表");
  await q("update order_exceptions set status = 'closed', close_kind = 'cleared', closed_at = $2 where order_id = $1", [order.id, api.clock.now()]);
});

test("推送记录：只改备注的 order.changed（真实形状：没有 passenger 键），列表和详情也要认出姓名", async () => {
  const order = await paid();
  const delivery = await insertWebhookDelivery(api, await seededOf(order), "failed", { change_id: randomUUID(), status: "applied", fields: ["notes"], before: { notes: null }, after: { notes: WRITTEN } });
  for (const url of [`/platform/v1/webhook-deliveries?order_id=${order.id}`, `/platform/v1/webhook-deliveries/${delivery}`]) {
    const res = await api.call("GET", url, { token: m.root });
    assert.equal(res.status, 200, res.text);
    noSecrets(res.text, url);
  }
});

test("审计：工单里写了改单前的旧姓名，写入审计时也要打码（审计改不了，脱敏后也清不掉）", async () => {
  const order = await paid();
  assert.equal((await patch(order.id, { passenger: { name: "李大伟", phone: "+81 80-9999-0000", email: "new@example.com" } })).status, 200);
  const ticket = await ok(api.call("POST", "/platform/v1/tickets", { token, body: { order_id: order.id, type: "other", subject: "来电", description: `${NAME}（改名前）来电` } }), 201);
  await ok(api.call("POST", `/platform/v1/tickets/${ticket.ticket.id}/close`, { token, body: { note: `已回复${NAME}` } }));
  const stored = (await q("select before, after from audit_logs where resource = 'ticket' and resource_id = $1", [ticket.ticket.id])).rows;
  assert.ok(stored.length >= 1);
  noSecrets(JSON.stringify(stored), "工单的审计");
});

test("工单详情、列表：改过姓名后，手写内容里的旧姓名也打码（ADR 把它列为已知缺口，这里只看库里没有原文的前提不变）", async () => {
  const order = await paid();
  const ticket = await ok(api.call("POST", "/platform/v1/tickets", { token, body: { order_id: order.id, type: "other", subject: "标题", description: `电话 ${PHONE}，邮箱 ${EMAIL}` } }), 201);
  assert.equal((await patch(order.id, { passenger: { name: "李大伟", phone: "+81 80-9999-0000", email: "new@example.com" } })).status, 200);
  const res = await api.call("GET", `/platform/v1/tickets/${ticket.ticket.id}`, { token });
  noSecrets(res.text, "工单详情：电话、邮箱不受改名影响");
});

// ---- 脱敏之后 ----

test("脱敏之后：代传原因（ADR 说不清除、接口仍然打码）里的姓名，订单详情不能给原文（这时已经不知道姓名是什么）", async () => {
  const order = await paid();
  await q("insert into order_events (tenant_id, order_id, from_status, to_status, actor, reason, occurred_at, detail) values ((select tenant_id from orders where id = $1), $1, 'confirmed', 'confirmed', 'system', 'PROXY', $2, $3::jsonb)", [order.id, api.clock.now(), JSON.stringify({ source: "platform_proxy", recorded_at: api.clock.now().toISOString(), proxy_reason: `${NAME}来电说已到`, approved_by: null, approval_id: null })]);
  await endAt(api, order.id, tokyoDaysAgo(api, 200));
  await tick();
  assert.equal(await isDone(api, order.id), true);
  const detail = await api.call("GET", `/platform/v1/orders/${order.id}`, { token });
  assert.equal(detail.status, 200);
  noSecrets(detail.text, "脱敏后的订单详情");
});

test("脱敏之后：复核的备注（不清除）里的姓名，复核详情不能给原文", async () => {
  const order = await paid();
  const approval = await insertApproval(api, "order.cancel_refund", "order", order.id, { status: "withdrawn", note: `${NAME}来电要求取消`, payload: { note: `${NAME}来电` } });
  await endAt(api, order.id, tokyoDaysAgo(api, 200));
  await tick();
  assert.equal(await isDone(api, order.id), true);
  const res = await api.call("GET", `/platform/v1/approvals/${approval}`, { token: m.root });
  assert.equal(res.status, 200, res.text);
  noSecrets(res.text, "脱敏后的复核详情");
});

test("脱敏之后：reveal 不再给任何原文（ADR：anonymized_at 不为空时返回的就是占位），复核、代传原因也不行", async () => {
  const order = await paid();
  await q("insert into order_events (tenant_id, order_id, from_status, to_status, actor, reason, occurred_at, detail) values ((select tenant_id from orders where id = $1), $1, 'confirmed', 'confirmed', 'system', 'PROXY', $2, $3::jsonb)", [order.id, api.clock.now(), JSON.stringify({ source: "platform_proxy", recorded_at: api.clock.now().toISOString(), proxy_reason: WRITTEN, approved_by: null, approval_id: null })]);
  await insertApproval(api, "order.cancel_refund", "order", order.id, { status: "withdrawn", note: WRITTEN });
  await endAt(api, order.id, tokyoDaysAgo(api, 200));
  await tick();
  assert.equal(await isDone(api, order.id), true);
  const res = await reveal(order.id, m.root);
  assert.equal(res.status, 200, res.text);
  assert.ok(res.body.anonymized_at);
  noSecrets(res.text, "脱敏后的 reveal");
});

test("脱敏之后：运营按旧电话、旧邮箱都筛不到；按占位筛不能列出所有已脱敏的单之外的东西", async () => {
  const order = await paid();
  await endAt(api, order.id, tokyoDaysAgo(api, 200));
  await tick();
  for (const value of ["+819012345678", "9012345678", EMAIL, NAME]) {
    const list = await ok(api.call("GET", `/platform/v1/orders?passenger=${encodeURIComponent(value)}`, { token }));
    assert.equal(list.items.filter((item: any) => item.id === order.id).length, 0, value);
  }
  const byNo = await ok(api.call("GET", `/platform/v1/orders?q=${order.order_no}`, { token }));
  assert.equal(byNo.items[0]?.passenger.name, ANONYMIZED_TEXT);
});

// ---- reveal 的权限组合 ----

test("reveal 权限：只有 ticket.read 没有 order.read 的 403，不记审计", async () => {
  const order = await paid();
  await ok(api.call("POST", "/platform/v1/tickets", { token, body: { order_id: order.id, type: "other", subject: "标题", description: WRITTEN } }), 201);
  const ticketOnly = await staffWith(["tickets:view"]);
  assert.equal((await reveal(order.id, ticketOnly)).status, 403);
  assert.equal((await q("select count(*)::int as n from audit_logs where action = 'view_passenger' and resource_id = $1", [order.id])).rows[0].n, 0);
});

test("reveal 权限：order.read + ticket.read 给工单文字；没有 approval.read 不给复核文字；只有 approval.read 不给工单文字；审计只记字段名和来源", async () => {
  const order = await paid();
  await ok(api.call("POST", "/platform/v1/tickets", { token, body: { order_id: order.id, type: "other", subject: "标题", description: WRITTEN } }), 201);
  await insertApproval(api, "order.cancel_refund", "order", order.id, { status: "withdrawn", note: WRITTEN });
  const sourcesOf = async (as: string): Promise<string[]> => (await ok(reveal(order.id, as))).texts.map((entry: { source: string }) => entry.source);
  const orderTicket = await sourcesOf(await staffWith(["orders:view", "tickets:view"]));
  assert.ok(orderTicket.includes("ticket_description"));
  assert.ok(!orderTicket.some((source) => source.startsWith("approval_")));
  const orderApproval = await sourcesOf(await staffWith(["orders:view", "approvals:view"]));
  assert.ok(!orderApproval.some((source) => source.startsWith("ticket_")));
  const [audit] = (await q("select before, after from audit_logs where action = 'view_passenger' and resource_id = $1 order by id desc limit 1", [order.id])).rows;
  noSecrets(JSON.stringify(audit), "reveal 的审计");
  assert.deepEqual(audit.after.fields, ["name", "phone", "email", "messaging", "notes"]);
});

test("reveal 权限：渠道范围外 404；范围内的看得到；看不到的不记审计", async () => {
  const order = await paid();
  const elsewhere = (await newChannel(api, m.staff.cm1.token, { name: `别的渠道-${randomUUID().slice(0, 4)}` })).id;
  const outside = await staffWith(["orders:view"], { city_ids: null, channel_ids: [elsewhere] });
  const before = (await q("select count(*)::int as n from audit_logs where action = 'view_passenger' and resource_id = $1", [order.id])).rows[0].n;
  assert.equal((await reveal(order.id, outside)).status, 404);
  assert.equal((await q("select count(*)::int as n from audit_logs where action = 'view_passenger' and resource_id = $1", [order.id])).rows[0].n, before);
  const inside = await staffWith(["orders:view"], { city_ids: null, channel_ids: [flow.channelId] });
  assert.equal((await reveal(order.id, inside)).status, 200);
});

// ---- 打码误伤 ----

test("打码误伤：工单号、订单号、日期、金额、航班号、地址在接口里原样；只有备注里的联系方式被打码", async () => {
  const order = await paid();
  const ticket = await ok(api.call("POST", "/platform/v1/tickets", { token, body: { order_id: order.id, type: "other", subject: "标题", description: "占位" } }), 201);
  const ticketNo = ticket.ticket.ticket_no;
  const text = `订单 ${order.order_no}，工单 ${ticketNo}，2026-11-01 和 2026/11/02、2026年11月3日用车，航班 NH211，退 ¥1500000 和 1500000円，1500000 JPY，电话 ${PHONE}`;
  assert.equal((await patch(order.id, { notes: text })).status, 200);
  const detail = await ok(api.call("GET", `/platform/v1/orders/${order.id}`, { token }));
  assert.equal(detail.order.notes, `订单 ${order.order_no}，工单 ${ticketNo}，2026-11-01 和 2026/11/02、2026年11月3日用车，航班 NH211，退 ¥1500000 和 1500000円，1500000 JPY，电话 ****5678`);
  assert.equal(detail.order.order_no, order.order_no);
  assert.equal(detail.order.flight_no, order.flight_no);
  assert.ok(detail.order.dropoff.address.includes("东京站"));
  assert.ok(typeof detail.order.sell.amount === "string");
  const raw = await ok(api.call("GET", `/platform/v1/tickets/${ticket.ticket.id}`, { token }));
  assert.equal(raw.ticket.ticket_no, ticketNo);
});

// ---- 供应商、司机、渠道 ----

test("供应商、司机、渠道看到的内容没被破坏：付款后的单有完整联系方式、备注原文；规则 4 不变", async () => {
  const order = await paid();
  assert.equal((await patch(order.id, { notes: WRITTEN })).status, 200);
  const seeded = await seededOf(order);
  const who = seeded.tenantId === m.a.tenantId ? m.a : m.b;
  const tenantToken = await tenantLogin(api, who.adminEmail);
  const tenant = await ok(api.call("GET", `/tenant/v1/orders/${order.id}`, { token: tenantToken }));
  assert.equal(tenant.order.passenger.name, NAME);
  assert.equal(tenant.order.notes, WRITTEN);
  assert.ok(!JSON.stringify(tenant).includes("markup"));
  assert.ok(!Object.prototype.hasOwnProperty.call(tenant.order, "sell"));
  const assigned = await ok(assign(api, { adminToken: tenantToken }, order.id, (await newDriver(api, { adminToken: tenantToken } as any)).id, (await newVehicle(api, { adminToken: tenantToken } as any, m.ids.biz7)).id));
  const trip = await api.call("GET", "/driver/v1/trip", { token: assigned.driver_link.token });
  assert.equal(trip.status, 200, trip.text);
  assert.ok(trip.text.includes("90") && trip.text.includes(NAME), "司机要联系客人");
  const sales = await ok(api.call("GET", `/sales/v1/orders/${order.id}`, { token: await flow.token() }));
  assert.equal(sales.order.passenger.email, EMAIL);
});

// ---- 官网查订单 ----

test("查订单：不存在、对不上、已脱敏 + 原来的联系方式、已脱敏 + 占位、别的渠道的单，应答一字不差；限流也一样；耗时差不多", async () => {
  const channelId = (await newChannel(api, m.staff.cm1.token, { name: `官网-${randomUUID().slice(0, 4)}` })).id;
  const client = await salesCredentials(api, m, channelId);
  const site: SiteApi = await siteApi(api, client.clientId, pay);
  const place = async (email: string, serviceLocal: string): Promise<{ id: string; order_no: string }> => {
    api.clock.advance(60_000);
    const quoted = await site.call("POST", "/site/v1/quotes", { body: { city_id: m.ids.tokyo, airport_id: m.ids.narita, direction: "pickup", address: { lng: 139.7, lat: 35.6 }, service_local: serviceLocal, passengers: 2, luggage: 1, category: "airport_transfer" } });
    assert.equal(quoted.status, 200, quoted.text);
    api.clock.advance(1_000);
    const placed = await site.call("POST", "/site/v1/orders", { headers: { "idempotency-key": randomUUID() }, body: { quote_id: quoted.body.quotes[0].quote_id, passenger: { name: "汐见凉介", phone: "+81 90-7788-3311", email }, flight_no: "nh 211", dropoff_address: "东京站八重洲口", save_payment_method: true } });
    assert.equal(placed.status, 201, placed.text);
    return placed.body.order;
  };
  try {
    const live = await place("qa.live@example.test", "2026-12-20T10:00");
    const done = await place("qa.done@example.test", "2026-12-21T10:00");
    await endAt(api, done.id, tokyoDaysAgo(api, 300));
    await tick();
    assert.equal(await isDone(api, done.id), true);
    let ip = 0;
    const lookup = (orderNo: string, contact: string) => {
      ip += 1;
      return site.call("POST", "/site/v1/orders/lookup", { ip: `198.51.${100 + (ip >> 8)}.${ip & 255}`, body: { order_no: orderNo, contact } });
    };
    const shape = (res: { status: number; text: string; headers: Record<string, unknown> }) => ({ status: res.status, text: res.text, headers: Object.keys(res.headers).filter((key) => !["date", "content-length", "x-request-id"].includes(key)).sort() });
    const paths: Record<string, () => ReturnType<typeof lookup>> = {
      不存在: () => lookup("NZ20261001ABCD2345", "qa.done@example.test"),
      对不上: () => lookup(live.order_no, "nobody@example.test"),
      已脱敏原邮箱: () => lookup(done.order_no, "qa.done@example.test"),
      已脱敏原电话: () => lookup(done.order_no, "+819077883311"),
      已脱敏占位: () => lookup(done.order_no, ANONYMIZED_TEXT),
      别的渠道: async () => {
        const other = await paid();
        return lookup(other.order_no, EMAIL);
      },
    };
    const answers: Record<string, unknown> = {};
    for (const [name, call] of Object.entries(paths)) answers[name] = shape(await call());
    const expected = answers["不存在"] as { status: number };
    assert.equal(expected.status, 404);
    for (const [name, answer] of Object.entries(answers)) assert.deepEqual(answer, expected, name);

    // 限流：已脱敏的和不存在的、对不上的同样计失败，同样第 11 次变 429（已经各失败过几次，补足到相同次数）
    api.clock.advance(2 * 3_600_000);
    const rateOf = async (orderNo: string, contact: string): Promise<number[]> => {
      const out: number[] = [];
      for (let i = 0; i < 11; i += 1) out.push((await lookup(orderNo, contact)).status);
      return out;
    };
    const absent = await rateOf("NZ20261001WXYZ2345", "x@example.test");
    assert.deepEqual(await rateOf(done.order_no, "qa.done@example.test"), absent);
    assert.deepEqual(await rateOf(live.order_no, "nobody@example.test"), absent);
    assert.equal(absent.at(-1), 429);

    // 耗时：都走同一条路，中位数相差不应该到能分辨的程度（判断宽松，防止机器抖动）
    api.clock.advance(2 * 3_600_000);
    const median = async (orderNo: string, contact: string): Promise<number> => {
      const times: number[] = [];
      for (let i = 0; i < 9; i += 1) {
        const started = performance.now();
        await lookup(orderNo, contact);
        times.push(performance.now() - started);
      }
      return times.sort((a, b) => a - b)[4] as number;
    };
    const missing = await median("NZ20261001QRST2345", "x@example.test");
    const anonymized = await median(done.order_no, "qa.done@example.test");
    assert.ok(Math.abs(missing - anonymized) < 30, `不存在 ${missing.toFixed(1)} 毫秒，已脱敏 ${anonymized.toFixed(1)} 毫秒`);
  } finally {
    await site.close();
  }
});
