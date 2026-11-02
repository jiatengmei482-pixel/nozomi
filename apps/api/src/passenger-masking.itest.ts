/**
 * M4-21：运营接口的打码补漏（ADR 0055）：工单和备注的手写内容、待审核、异常队列、审计日志的前后值。只有 reveal 给原文（记审计）。
 * 没有权限的、跨租户、超出数据范围的看不到；供应商自己的接口不受影响。真实 PostgreSQL；数据只在测试里构造，都是虚构的。
 */
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";
import { type Market, addStaff, buildMarket, ok } from "./testing/market.ts";
import { platformLogin, tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SalesFlow, salesFlow } from "./testing/sales-flow.ts";

let api: TestApi;
let m: Market;
let flow: SalesFlow;
const PHONE = "09012345678";
const WRITTEN = `王小明来电，电话 ${PHONE}，邮箱 guest@example.com`;
const SECRETS = ["小明", "12345678", "guest@"];

before(async () => {
  const pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  flow = await salesFlow(api, m, pay);
});
after(() => api.close());

const soon = (hours: number): string => new Date(api.clock.now().getTime() + hours * 3_600_000).toISOString().replace(/\.\d{3}Z$/, "Z");
const paid = async (): Promise<any> => flow.paidOrder({ serviceTime: soon(240) });
const ops = () => platformLogin(api, m.staff.operations.email);
const noSecrets = (text: string, where: string): void => {
  for (const secret of SECRETS) assert.ok(!text.includes(secret), `${where} 含 ${secret}：${text.slice(0, 400)}`);
};
const reveal = (orderId: string, token: string) => api.call("POST", `/platform/v1/orders/${orderId}/passenger/reveal`, { token });

/** 一个只有某些权限的员工。 */
async function staffWith(grants: string[], dataScope: unknown = { city_ids: null, channel_ids: null }): Promise<string> {
  const role = await ok(api.call("POST", "/platform/v1/roles", { token: m.root, body: { name: `角色-${randomUUID().slice(0, 6)}`, grants, data_scope: dataScope } }), 201);
  const email = `s-${randomUUID().slice(0, 8)}@platform.test`;
  const invited = await ok(api.call("POST", "/platform/v1/staff", { token: m.root, body: { email, name: "员工", role: role.key } }), 201);
  await ok(api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.invite.token, password: TEST_PASSWORD } }));
  return platformLogin(api, email);
}

test("工单：列表、详情、订单详情里的工单、操作的响应都打码；订单号和日期留着；符合 OpenAPI", async () => {
  const order = await paid();
  const token = await ops();
  const created = await api.call("POST", "/platform/v1/tickets", { token, body: { order_id: order.id, type: "other", subject: `王小明 ${PHONE}`, description: `${WRITTEN}，订单 ${order.order_no}，2026-11-01 用车` } });
  assert.equal(created.status, 201, created.text);
  assertMatchesOpenApi("POST", "/platform/v1/tickets", created);
  noSecrets(created.text, "建工单的响应");
  const id = created.body.ticket.id;
  const message = await api.call("POST", `/platform/v1/tickets/${id}/messages`, { token, body: { body: WRITTEN } });
  noSecrets(message.text, "加对话的响应");
  noSecrets((await api.call("POST", `/platform/v1/tickets/${id}/messages`, { token, body: { body: WRITTEN, internal: true } })).text, "加内部备注的响应");
  const detail = await api.call("GET", `/platform/v1/tickets/${id}`, { token });
  assertMatchesOpenApi("GET", "/platform/v1/tickets/{id}", detail);
  noSecrets(detail.text, "工单详情");
  assert.ok(detail.body.ticket.description.includes(order.order_no), "订单号不能打码");
  assert.ok(detail.body.ticket.description.includes("2026-11-01"), "日期不能打码");
  assert.ok(detail.body.ticket.subject.includes("****5678"));
  assert.ok(detail.body.messages[0].body.startsWith("王**来电"));
  assert.ok(detail.body.notes[0].body.startsWith("王**来电"));
  const list = await api.call("GET", `/platform/v1/tickets?order_id=${order.id}`, { token });
  assert.equal(list.status, 200, list.text);
  assertMatchesOpenApi("GET", "/platform/v1/tickets", list);
  noSecrets(list.text, "工单列表");
  const orderDetail = await ok(api.call("GET", `/platform/v1/orders/${order.id}`, { token }));
  noSecrets(JSON.stringify(orderDetail.tickets), "订单详情里的工单");

  // 供应商自己的接口不受影响：付款后看得到全文
  const tenant = await ok(api.call("GET", `/tenant/v1/tickets/${id}`, { token: await tenantLogin(api, m.b.adminEmail) }));
  assert.equal(tenant.ticket.subject, `王小明 ${PHONE}`);
});

test("查看：给手写内容的原文，只列确实被打码的；每次记审计，审计里没有内容；工单文字要 ticket.read", async () => {
  const order = await paid();
  const token = await ops();
  const created = await ok(api.call("POST", "/platform/v1/tickets", { token, body: { order_id: order.id, type: "other", subject: "没有联系方式的标题", description: WRITTEN } }), 201);
  await ok(api.call("POST", `/platform/v1/tickets/${created.ticket.id}/messages`, { token, body: { body: WRITTEN, internal: true } }), 201);
  const shown = await reveal(order.id, token);
  assertMatchesOpenApi("POST", "/platform/v1/orders/{id}/passenger/reveal", shown);
  const sources = shown.body.texts.map((entry: any) => [entry.source, entry.source_id, entry.text]);
  assert.deepEqual(sources, [["ticket_description", created.ticket.id, WRITTEN], ["ticket_note", created.ticket.id, WRITTEN]], "标题没有联系方式，不列");
  const [audit] = (await api.db.owner.query("select before, after from audit_logs where resource = 'order' and resource_id = $1 and action = 'view_passenger' order by id desc limit 1", [order.id])).rows;
  assert.equal(audit.after.text_count, 2);
  assert.deepEqual(audit.after.text_sources, ["ticket_description", "ticket_note"]);
  noSecrets(JSON.stringify(audit), "查看的审计");

  // 只有 order.read、没有 ticket.read：联系方式给，工单文字不给（不能绕过权限）
  const orderOnly = await staffWith(["orders:view"]);
  const denied = await reveal(order.id, orderOnly);
  assert.equal(denied.status, 200, denied.text);
  assert.deepEqual(denied.body.texts, []);
  // 数据范围外的 404，不记审计；供应商、没登录的进不来
  const osaka = await staffWith(["orders:view", "tickets:view"], { city_ids: [m.ids.osaka], channel_ids: null });
  const before = (await api.db.owner.query("select count(*)::int as n from audit_logs where action = 'view_passenger' and resource_id = $1", [order.id])).rows[0].n;
  assert.equal((await reveal(order.id, osaka)).status, 404);
  assert.equal((await reveal(order.id, await tenantLogin(api, m.a.adminEmail))).status, 401);
  assert.equal((await reveal(order.id, await tenantLogin(api, m.b.adminEmail))).status, 401);
  assert.equal((await api.call("POST", `/platform/v1/orders/${order.id}/passenger/reveal`)).status, 401);
  assert.equal((await api.db.owner.query("select count(*)::int as n from audit_logs where action = 'view_passenger' and resource_id = $1", [order.id])).rows[0].n, before);
});

const revealTicket = (ticketId: string, token: string) => api.call("POST", `/platform/v1/tickets/${ticketId}/texts/reveal`, { token });
const ticketAudits = async (orderId: string): Promise<any[]> => (await api.db.owner.query("select action, tenant_id, after from audit_logs where resource = 'order' and resource_id = $1 and action in ('view_ticket_text', 'view_passenger') order by id", [orderId])).rows;

test("工单没有打码内容：texts_masked 为假，调看原文也不给内容、不记审计", async () => {
  const order = await paid();
  const token = await ops();
  const created = await ok(api.call("POST", "/platform/v1/tickets", { token, body: { order_id: order.id, type: "other", subject: "车没来", description: "司机说堵车" } }), 201);
  assert.equal(created.texts_masked, false);
  const detail = await api.call("GET", `/platform/v1/tickets/${created.ticket.id}`, { token });
  assertMatchesOpenApi("GET", "/platform/v1/tickets/{id}", detail);
  assert.equal(detail.body.texts_masked, false);
  const shown = await revealTicket(created.ticket.id, token);
  assertMatchesOpenApi("POST", "/platform/v1/tickets/{id}/texts/reveal", shown);
  assert.deepEqual(shown.body, { texts: [] });
  assert.deepEqual(await ticketAudits(order.id), []);
});

test("工单有打码内容：只给这张工单的文字（没有联系方式和别的工单），审计写明看的是工单文字，不列联系方式字段", async () => {
  const order = await paid();
  const token = await ops();
  const created = await ok(api.call("POST", "/platform/v1/tickets", { token, body: { order_id: order.id, type: "other", subject: "车没来", description: "司机说堵车" } }), 201);
  const other = await ok(api.call("POST", "/platform/v1/tickets", { token, body: { order_id: order.id, type: "other", subject: "另一张", description: `另一张工单的文字 ${PHONE}` } }), 201);
  const noted = await ok(api.call("POST", `/platform/v1/tickets/${created.ticket.id}/messages`, { token, body: { body: WRITTEN, internal: true } }), 201);
  assert.equal(noted.texts_masked, true, "加了带联系方式的备注之后就有打码内容");
  assert.equal(other.texts_masked, true);
  const shown = await revealTicket(created.ticket.id, token);
  assertMatchesOpenApi("POST", "/platform/v1/tickets/{id}/texts/reveal", shown);
  assert.deepEqual(shown.body, { texts: [{ source: "ticket_note", source_id: created.ticket.id, text: WRITTEN }] });
  assert.ok(!shown.text.includes("另一张"));
  assert.ok(!("passenger" in shown.body) && !("notes" in shown.body) && !("messaging" in shown.body));
  const audits = await ticketAudits(order.id);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, "view_ticket_text");
  assert.equal(audits[0].tenant_id, null);
  assert.deepEqual({ ...audits[0].after, order_no: undefined }, { order_no: undefined, ticket_id: created.ticket.id, ticket_no: created.ticket.ticket_no, viewed: "ticket_text", text_count: 1, text_sources: ["ticket_note"] });
  assert.ok(!("fields" in audits[0].after), "不再固定列 5 个字段");
  noSecrets(JSON.stringify(audits[0]), "看工单文字的审计");
});

test("看工单文字的权限：缺 order.read 403，缺 ticket.read 403，数据范围外 404，供应商和没登录 401；这些都不给内容、不记审计", async () => {
  const order = await paid();
  const token = await ops();
  const created = await ok(api.call("POST", "/platform/v1/tickets", { token, body: { order_id: order.id, type: "other", subject: "工单", description: WRITTEN } }), 201);
  const ticketOnly = await revealTicket(created.ticket.id, await staffWith(["tickets:view"]));
  assert.deepEqual([ticketOnly.status, ticketOnly.body.error.details.required], [403, "order.read"]);
  const orderOnly = await revealTicket(created.ticket.id, await staffWith(["orders:view"]));
  assert.deepEqual([orderOnly.status, orderOnly.body.error.details.required], [403, "ticket.read"]);
  assert.equal((await revealTicket(created.ticket.id, await staffWith(["orders:view", "tickets:view"], { city_ids: [m.ids.osaka], channel_ids: null }))).status, 404);
  assert.equal((await revealTicket(randomUUID(), token)).status, 404);
  assert.equal((await revealTicket(created.ticket.id, await tenantLogin(api, m.a.adminEmail))).status, 401);
  assert.equal((await revealTicket(created.ticket.id, await tenantLogin(api, m.b.adminEmail))).status, 401);
  assert.equal((await api.call("POST", `/platform/v1/tickets/${created.ticket.id}/texts/reveal`)).status, 401);
  assert.deepEqual(await ticketAudits(order.id), []);
});

test("标记和实际打码是同一次比较：详情里的文字和原文不同的条数，就是看原文给的条数", async () => {
  const order = await paid();
  const token = await ops();
  const created = await ok(api.call("POST", "/platform/v1/tickets", { token, body: { order_id: order.id, type: "other", subject: "王小明投诉", description: "司机说堵车" } }), 201);
  const detail = await ok(api.call("GET", `/platform/v1/tickets/${created.ticket.id}`, { token }));
  assert.equal(detail.texts_masked, true, "只有姓名、没有电话也算打码");
  assert.notEqual(detail.ticket.subject, "王小明投诉");
  const shown = await ok(api.call("POST", `/platform/v1/tickets/${created.ticket.id}/texts/reveal`, { token }));
  assert.deepEqual(shown.texts.map((entry: any) => [entry.source, entry.text]), [["ticket_subject", "王小明投诉"]]);
});

test("脱敏过的单：工单里即使还有打码规则认得出的文字，texts_masked 也为假，看原文不给内容、不记审计", async () => {
  const order = await paid();
  const token = await ops();
  const created = await ok(api.call("POST", "/platform/v1/tickets", { token, body: { order_id: order.id, type: "other", subject: "工单", description: `电话 ${PHONE}` } }), 201);
  await api.db.owner.query("update orders set passenger = jsonb_build_object('name', $2::text, 'phone', $2::text, 'email', $2::text), passenger_anonymized_at = now() where id = $1", [order.id, "[已脱敏]"]);
  assert.equal((await ok(api.call("GET", `/platform/v1/tickets/${created.ticket.id}`, { token }))).texts_masked, false);
  assert.deepEqual(await ok(api.call("POST", `/platform/v1/tickets/${created.ticket.id}/texts/reveal`, { token })), { texts: [] });
  assert.deepEqual(await ticketAudits(order.id), []);
});

test("跨租户：别的供应商读不到、回复不了这张工单；它的工单列表里也没有", async () => {
  const order = await paid();
  const token = await ops();
  const created = await ok(api.call("POST", "/platform/v1/tickets", { token, body: { order_id: order.id, type: "other", subject: "工单", description: WRITTEN } }), 201);
  const owner = (await api.db.owner.query("select tenant_id from orders where id = $1", [order.id])).rows[0].tenant_id;
  const stranger = owner === m.a.tenantId ? m.b : m.a;
  const strangerToken = await tenantLogin(api, stranger.adminEmail);
  assert.equal((await api.call("GET", `/tenant/v1/tickets/${created.ticket.id}`, { token: strangerToken })).status, 404);
  assert.equal((await api.call("POST", `/tenant/v1/tickets/${created.ticket.id}/messages`, { token: strangerToken, body: { body: "x" } })).status, 404);
  const list = await ok(api.call("GET", `/tenant/v1/tickets?order_id=${order.id}`, { token: strangerToken }));
  assert.deepEqual(list.items, []);
  assert.equal((await api.call("GET", `/tenant/v1/orders/${order.id}`, { token: strangerToken })).status, 404);
});

test("订单：备注、即时通讯账号、取消说明打码；notes_masked 标出来；改单响应不能绕过；航班号和地址不打码", async () => {
  const order = await paid();
  const token = await ops();
  await api.db.owner.query("update orders set messaging = $2::jsonb where id = $1", [order.id, JSON.stringify({ app: "line", handle: "wang-xiaoming-88" })]);
  const before = await ok(api.call("GET", `/platform/v1/orders/${order.id}`, { token }));
  assert.equal(before.order.notes_masked, false);
  assert.equal(before.order.passenger_anonymized_at, null);
  const patched = await api.call("PATCH", `/platform/v1/orders/${order.id}`, { token, headers: { "if-match": String(before.order.version) }, body: { notes: WRITTEN, passenger: { name: "李大伟", phone: "+81 80-9999-0000", email: "guest@example.com" } } });
  assert.equal(patched.status, 200, patched.text);
  assertMatchesOpenApi("PATCH", "/platform/v1/orders/{id}", patched);
  noSecrets(patched.text, "改单的响应");
  assert.ok(!patched.text.includes("大伟") && !patched.text.includes("guest@example.com"));
  const res = await api.call("GET", `/platform/v1/orders/${order.id}`, { token });
  assertMatchesOpenApi("GET", "/platform/v1/orders/{id}", res);
  noSecrets(res.text, "订单详情");
  assert.ok(!res.text.includes("wang-xiaoming") && !res.text.includes("大伟"));
  assert.equal(res.body.order.notes_masked, true);
  assert.equal(res.body.order.messaging.handle, "wa***");
  assert.equal(res.body.order.flight_no, before.order.flight_no);
  assert.deepEqual(res.body.order.dropoff, before.order.dropoff);
  const shown = (await ok(reveal(order.id, token)));
  assert.equal(shown.notes, WRITTEN);
  assert.deepEqual(shown.messaging, { app: "line", handle: "wang-xiaoming-88" });
  assert.deepEqual(shown.passenger.name, "李大伟");
  assert.ok(shown.texts.some((entry: any) => entry.source === "change_before" && entry.text.includes("王小明")), "改单前的原文也只能在这里看");
});

test("审计日志：改单的前后值写入时就打码（库里也没有原文）；旧记录读取时打码；别的对象不动；只读审计权限也看不到原文", async () => {
  const order = await paid();
  const token = await ops();
  const version = (await ok(api.call("GET", `/platform/v1/orders/${order.id}`, { token }))).order.version;
  await ok(api.call("PATCH", `/platform/v1/orders/${order.id}`, { token, headers: { "if-match": String(version) }, body: { notes: WRITTEN, passenger: { name: "李大伟", phone: "+81 80-9999-0000", email: "guest@example.com" } } }));
  const stored = (await api.db.owner.query("select before, after from audit_logs where resource = 'order_change' and after ->> 'order_id' = $1", [order.id])).rows;
  assert.equal(stored.length, 1);
  const raw = JSON.stringify(stored);
  noSecrets(raw, "库里的审计");
  assert.ok(!raw.includes("大伟") && !raw.includes("guest@example.com") && !raw.includes("9999"));
  assert.equal(stored[0].after.passenger.name, "李**");
  // 这个任务之前写入的旧记录：库里是原文，接口读出来是打码的
  const old = randomUUID();
  await api.db.owner.query(
    `insert into audit_logs (occurred_at, tenant_id, actor_type, actor_id, actor_email, ip, source, resource, resource_id, action, before, after)
     values ($1, null, 'system', null, null, null, 'job', 'order_change', $2, 'change', $3::jsonb, $4::jsonb)`,
    [api.clock.now(), old, JSON.stringify({ order_id: order.id, passenger: { name: "王小明", phone: "+819012345678", email: "guest@example.com" }, notes: WRITTEN }), JSON.stringify({ order_id: order.id, messaging: { app: "line", handle: "wang-xiaoming-88" }, status: "applied" })],
  );
  const logs = await api.call("GET", `/platform/v1/audit-logs?resource=order_change&resource_id=${old}`, { token: m.root });
  assert.equal(logs.status, 200, logs.text);
  assertMatchesOpenApi("GET", "/platform/v1/audit-logs", logs);
  noSecrets(logs.text, "旧审计");
  assert.ok(!logs.text.includes("wang-xiaoming"));
  assert.equal(logs.body.items[0].before.passenger.name, "王**");
  assert.equal(logs.body.items[0].before.order_id, order.id, "编号不打码");
  // 员工账号的审计：姓名、邮箱是业务内容，不打码
  const email = `audit-${randomUUID().slice(0, 8)}@platform.test`;
  await addStaff(api, m.root, email, "readonly");
  const staffLogs = await ok(api.call("GET", "/platform/v1/audit-logs?resource=platform_user", { token: m.root }));
  assert.ok(JSON.stringify(staffLogs).includes(email));
  // 没有审计权限的看不了
  assert.equal((await api.call("GET", "/platform/v1/audit-logs", { token: m.staff.masterData.token })).status, 403);
});

test("待审核：和订单有关的复核打码手写内容（列表、详情、决定的响应）；其他类别不动", async () => {
  const order = await paid();
  const token = await ops();
  // 直接摆待审核的记录：内容和真实记录同样的形状
  const requester = (await api.db.owner.query("select id from platform_users where email = $1", [m.staff.operations.email])).rows[0].id;
  const insert = async (kind: string, resource: string, resourceId: string, note: string): Promise<string> =>
    (await api.db.owner.query(
      `insert into approvals (kind, resource, resource_id, summary, payload, status, requested_by, requested_at, request_note)
       values ($1, $2, $3, '系统写的说明', $4::jsonb, 'pending', $5, $6, $7) returning id`,
      [kind, resource, resourceId, JSON.stringify({ note, reason: "GUEST_REQUEST" }), requester, api.clock.now(), note],
    )).rows[0].id;
  const orderApproval = await insert("order.cancel_refund", "order", order.id, WRITTEN);
  const other = (await api.db.owner.query("select id from channels limit 1")).rows[0].id;
  const channelNote = "渠道对接人电话 09087654321";
  const channelApproval = await insert("channel.pause", "channel", other, channelNote);
  const reviewer = m.root;
  const detail = await api.call("GET", `/platform/v1/approvals/${orderApproval}`, { token: reviewer });
  assert.equal(detail.status, 200, detail.text);
  assertMatchesOpenApi("GET", "/platform/v1/approvals/{id}", detail);
  noSecrets(detail.text, "复核详情");
  assert.equal(detail.body.approval.payload.reason, "GUEST_REQUEST", "枚举不动");
  assert.equal(detail.body.approval.summary, "系统写的说明");
  assert.ok(detail.body.approval.request_note.includes("****5678"));
  const list = await ok(api.call("GET", "/platform/v1/approvals?status=pending", { token: reviewer }));
  noSecrets(JSON.stringify(list.items.filter((item: any) => item.id === orderApproval)), "复核列表");
  const untouched = await ok(api.call("GET", `/platform/v1/approvals/${channelApproval}`, { token: reviewer }));
  assert.equal(untouched.approval.request_note, channelNote, "渠道的备注没有乘客信息，审批人要看全文");
  const withdrawn = await api.call("POST", `/platform/v1/approvals/${orderApproval}/withdraw`, { token, body: {} });
  noSecrets(withdrawn.text, "决定的响应");
  // 查看：要能看复核才给复核的原文
  const shown = await ok(reveal(order.id, reviewer));
  assert.ok(shown.texts.some((entry: any) => entry.source === "approval_request_note" && entry.text === WRITTEN));
  const orderOnly = await staffWith(["orders:view"]);
  assert.ok(!(await ok(reveal(order.id, orderOnly))).texts.some((entry: any) => entry.source.startsWith("approval_")));
  await api.db.owner.query("update approvals set status = 'withdrawn', decided_at = $2 where id = $1 and status = 'pending'", [channelApproval, api.clock.now()]);
});

test("异常队列：处理说明打码（列表、详情、关闭的响应）；只有 order.read 才看得到；原文走查看", async () => {
  const order = await paid();
  await api.db.owner.query("update orders set dispatch_overdue_at = $2 where id = $1", [order.id, api.clock.now()]);
  await api.app.orderJobs.exceptions();
  const token = await ops();
  const opened = await ok(api.call("GET", `/platform/v1/exceptions?order_id=${order.id}&status=active`, { token }));
  const id = opened.items[0].id;
  const closed = await api.call("POST", `/platform/v1/exceptions/${id}/close`, { token, body: { resolution: WRITTEN } });
  assert.equal(closed.status, 200, closed.text);
  assertMatchesOpenApi("POST", "/platform/v1/exceptions/{id}/close", closed);
  noSecrets(closed.text, "关闭的响应");
  const detail = await api.call("GET", `/platform/v1/exceptions/${id}`, { token });
  assertMatchesOpenApi("GET", "/platform/v1/exceptions/{id}", detail);
  noSecrets(detail.text, "异常详情");
  assert.equal(detail.body.exception.order.order_no, order.order_no);
  const list = await api.call("GET", `/platform/v1/exceptions?order_id=${order.id}&status=closed`, { token });
  assert.equal(list.status, 200, list.text);
  noSecrets(list.text, "异常列表");
  assert.equal((await api.call("GET", `/platform/v1/exceptions/${id}`, { token: m.staff.masterData.token })).status, 403);
  assert.equal((await api.call("GET", `/platform/v1/exceptions/${id}`, { token: await tenantLogin(api, m.b.adminEmail) })).status, 401);
  const shown = await ok(reveal(order.id, token));
  assert.ok(shown.texts.some((entry: any) => entry.source === "exception_resolution" && entry.text === WRITTEN));
});
