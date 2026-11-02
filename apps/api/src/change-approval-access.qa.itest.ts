/**
 * M4-29 测试角色：租户隔离、规则 4、权限、审计、隐私、OpenAPI 对照（ADR 0060）。真实 PostgreSQL + 本机假 SMTP。
 * 对外价按键名和完整数字核对（`assertNoSellInfo`），不搜短数字子串。
 */
import { after, before, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DAY, GUEST_EMAIL, GUEST_NAME, GUEST_PHONE, HOUR, SELL, SURGE_SELL, type GuestSite, type World, assertNoSellInfo, buildGuestSite, buildWorld, decodedMailText, fictionalEmail, iso, resetBetweenTests, tokenInMail, tokyoDate } from "./testing/change-approval-qa.ts";
import { TEST_PASSWORD } from "./testing/api.ts";
import { assign, newDriver, newVehicle } from "./testing/dispatch.ts";
import { addStaff, ok } from "./testing/market.ts";
import { platformLogin, tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi, openApiDoc } from "./testing/openapi.ts";

let w: World;
let site: GuestSite;
let root: () => Promise<string>;
before(async () => {
  w = await buildWorld();
  site = await buildGuestSite(w);
  root = () => platformLogin(w.api, "root@platform.test");
});
after(async () => {
  await site.api.close();
  await w.close();
});
beforeEach(async () => {
  await resetBetweenTests(w);
});

const SECRET_NOTE = "结算价太低司机小张生病不想跑";
const sellValues = [SELL, SURGE_SELL, SURGE_SELL - SELL];

async function surcharged(): Promise<Awaited<ReturnType<World["dispatched"]>> & { changeId: string; newAt: number; res: any }> {
  const oldAt = w.freshDay();
  const newAt = oldAt + DAY;
  await w.surge(tokyoDate(newAt));
  const dispatched = await w.dispatched(oldAt);
  const res = await w.patch(dispatched.order.id, { service_time: iso(newAt) });
  assert.equal(res.body.change?.status, "pending_confirmation", res.text);
  return { ...dispatched, changeId: res.body.change.id, newAt, res };
}

// ---- 租户隔离 ----

test("租户 A 读不到也处理不了租户 B 的申请和待办：决定 404、待办不出现、知道了 404；路径和请求参数里带 B 的编号也没用；B 的数据不动", async () => {
  const { order, changeId } = await surcharged();
  const notice = await w.dispatched();
  await w.patch(notice.order.id, { notes: "带婴儿车" });
  const noticeTodo = (await w.todosOf(notice.order.id))[0];
  const requestTodo = (await w.todosOf(order.id))[0];
  const snapshot = async (): Promise<unknown> => [(await w.api.db.owner.query("select status, decided_at, decision_note from order_changes where id = $1", [changeId])).rows, (await w.api.db.owner.query("select resolved_at from order_todos where id = any($1)", [[noticeTodo.id, requestTodo.id]])).rows];
  const before = await snapshot();
  const a = w.a.adminToken;

  assert.deepEqual((await ok(w.api.call("GET", `/tenant/v1/order-todos?tenant_id=${w.b.tenantId}`, { token: a }))).items.filter((item: any) => [order.id, notice.order.id].includes(item.order_id)), [], "A 的待办里没有 B 的");
  const aOrders = await ok(w.api.call("GET", `/tenant/v1/orders?change=pending&tenant_id=${w.b.tenantId}`, { token: a }));
  assert.ok(!aOrders.items.some((item: any) => item.id === order.id), "A 的列表里没有 B 的");
  assert.equal(aOrders.total, 0);
  for (const decision of ["confirm", "reject", "adjusting"] as const) {
    const res = await w.tenantDecide(order.id, changeId, decision, { note: "不该生效" }, a);
    assert.equal(res.status, 404, `${decision}: ${res.text}`);
    assert.ok(!res.text.includes(order.order_no), "应答不泄露");
  }
  for (const id of [noticeTodo.id, requestTodo.id]) assert.equal((await w.api.call("POST", `/tenant/v1/order-todos/${id}/ack?tenant_id=${w.b.tenantId}`, { token: a, body: { tenant_id: w.b.tenantId } })).status, 404);
  assert.deepEqual(await snapshot(), before);

  // B 自己换一张单的编号配这个申请：对不上
  assert.equal((await w.tenantDecide(notice.order.id, changeId, "confirm")).status, 404);
  assert.deepEqual(await snapshot(), before);
});

test("租户令牌不能走代处理接口；渠道令牌、司机令牌、客人令牌都处理不了申请", async () => {
  const { order, changeId, token: driverToken } = await surcharged();
  for (const token of [w.b.adminToken, await w.flow.token(), driverToken]) {
    const res = await w.api.call("POST", `/platform/v1/orders/${order.id}/changes/${changeId}/confirm`, { token, body: { note: "越权" } });
    assert.ok([401, 403].includes(res.status), res.text);
    assert.ok([401, 403].includes((await w.api.call("POST", `/tenant/v1/orders/${order.id}/changes/${changeId}/confirm`, { token: driverToken, body: {} })).status));
  }
  assert.equal((await w.salesGet(order.id)).changes[0].status, "pending_confirmation");
});

test("渠道隔离和客人隔离：别的渠道看不到、改不了；客人的令牌只能看自己的单，别人的申请状态看不到", async () => {
  const mine = await site.place(w.freshDay(), `fictional.mine.${randomUUID().slice(0, 8)}@example.test`);
  const theirs = await site.place(w.freshDay(), `fictional.theirs.${randomUUID().slice(0, 8)}@example.test`);
  const res = await site.patch(theirs.token, theirs.ip, { passengers: 3 });
  assert.equal(res.body.change.status, "pending_confirmation", res.text);
  const seen = await site.get(mine.token, mine.ip);
  assert.equal(seen.order.id, mine.order.id);
  assert.deepEqual(seen.order.changes, [], "客人令牌只对应自己的单");
  assert.ok(!JSON.stringify(seen).includes(theirs.order.id));
  // 官网的单，别的渠道（销售端的令牌）当作不存在
  const asOther = await w.api.call("GET", `/sales/v1/orders/${theirs.order.id}`, { token: await w.flow.token() });
  assert.equal(asOther.status, 404);
  const patchOther = await w.api.call("PATCH", `/sales/v1/orders/${theirs.order.id}`, { token: await w.flow.token(), headers: { "if-match": '"1"' }, body: { passengers: 4 } });
  assert.equal(patchOther.status, 404);
  assert.equal((await site.api.call("GET", "/site/v1/order", { token: "nzo_invalid", ip: mine.ip })).status, 401);
});

// ---- 规则 4 ----

test("规则 4：/tenant/v1 列表、详情、待办、三种决定的应答、超时 409、满库存 409、Webhook、供应商邮件都没有对外价、加价比例和差价", async () => {
  const pending = await surcharged();
  const t = w.b.adminToken;
  const responses: [string, unknown][] = [
    ["列表", (await ok(w.api.call("GET", "/tenant/v1/orders?change=pending", { token: t })))],
    ["详情", (await ok(w.api.call("GET", `/tenant/v1/orders/${pending.order.id}`, { token: t })))],
    ["待办", (await ok(w.api.call("GET", "/tenant/v1/order-todos", { token: t })))],
    ["调整中", (await ok(w.tenantDecide(pending.order.id, pending.changeId, "adjusting")))],
    ["通知记录", (await ok(w.api.call("GET", `/tenant/v1/notifications?order_id=${pending.order.id}`, { token: t })))],
  ];
  responses.push(["同意", await ok(w.tenantDecide(pending.order.id, pending.changeId, "confirm"))]);
  responses.push(["同意后详情", await ok(w.api.call("GET", `/tenant/v1/orders/${pending.order.id}`, { token: t }))]);

  const rejected = await surcharged();
  responses.push(["拒绝", await ok(w.tenantDecide(rejected.order.id, rejected.changeId, "reject", { note: "排不出车" }))]);

  const late = await surcharged();
  const due = Date.parse(late.res.body.change.confirm_due_at);
  w.api.clock.advance(due - w.api.clock.now().getTime());
  await w.relogin();
  const expired = await w.tenantDecide(late.order.id, late.changeId, "confirm");
  assert.equal(expired.body.error.code, "CHANGE_CONFIRMATION_EXPIRED");
  responses.push(["超时的 409", expired.body]);

  for (const [label, body] of responses) assertNoSellInfo(body, sellValues, label);
  const webhooks = await w.api.db.owner.query("select event_data from webhook_deliveries where tenant_id = $1", [w.b.tenantId]);
  for (const row of webhooks.rows) assertNoSellInfo(row.event_data, sellValues, "Webhook");
  await w.tick();
  const mails = w.texts(w.mailsTo(w.m.b.adminEmail));
  for (const word of ["对外价", "加价", "差价", String(SELL), String(SURGE_SELL), "21,780", "26,136"]) assert.ok(!mails.split(/[^0-9,一-鿿]/).includes(word), word);
});

test("规则 4：供应商页面用的改单 settlement_* 是结算价，且和新结算价一致（不是对外价）", async () => {
  const { order, changeId } = await surcharged();
  const detail = await ok(w.api.call("GET", `/tenant/v1/orders/${order.id}`, { token: w.b.adminToken }));
  const change = detail.changes.find((item: any) => item.id === changeId);
  assert.deepEqual([change.settlement_before.amount, change.settlement_after.amount], ["19800", "23760"]);
});

// ---- 权限 ----

test("权限：客服、只读、渠道经理、主数据都不能代处理（三种操作都 403）；运营和超管能；原因必填，空白、超长、多余字段都拒绝", async () => {
  const { order, changeId } = await surcharged();
  const service = await addStaff(w.api, await root(), `qa.service.${randomUUID().slice(0, 8)}@platform.test`, "customer_service");
  const denied = [service.token, await platformLogin(w.api, w.m.staff.readonly.email), await platformLogin(w.api, w.m.staff.cm1.email), await platformLogin(w.api, w.m.staff.masterData.email)];
  for (const token of denied) {
    for (const decision of ["confirm", "reject", "adjusting"] as const) assert.equal((await w.platformDecide(order.id, changeId, decision, "想帮忙", token)).status, 403, decision);
  }
  const ops = await w.ops();
  const call = (decision: string, body: unknown) => w.api.call("POST", `/platform/v1/orders/${order.id}/changes/${changeId}/${decision}`, { token: ops, body });
  for (const decision of ["confirm", "reject", "adjusting"]) {
    for (const body of [{}, { note: "   " }, { note: "" }, { note: "x".repeat(501) }, { note: "好", tenant_id: w.a.tenantId }]) {
      const res = await call(decision, body);
      assert.equal(res.status, 400, `${decision} ${JSON.stringify(body).slice(0, 40)}: ${res.text}`);
    }
  }
  assert.equal((await w.salesGet(order.id)).changes[0].status, "pending_confirmation", "没有任何一次生效");
  const audits = await w.api.db.owner.query("select count(*)::int as n from audit_logs where resource = 'order_change' and resource_id = $1", [changeId]);
  assert.equal(audits.rows[0].n, 0, "被拒的尝试不算处理");
  assert.equal((await ok(w.platformDecide(order.id, changeId, "confirm", "超管：电话确认", await root()))).change.status, "applied");
});

test("权限：数据范围外的运营 404（城市范围）、范围内的可以；自建角色只有「订单 · 编辑」不能代处理；勾了「代处理改单 · 编辑」才可以", async () => {
  const { order, changeId } = await surcharged();
  const role = async (grants: string[], scope: Record<string, unknown>): Promise<string> => {
    const created = await ok(w.api.call("POST", "/platform/v1/roles", { token: await root(), body: { name: `QA 角色 ${randomUUID().slice(0, 6)}`, grants, data_scope: scope } }), 201);
    const key = created.role?.key ?? created.key;
    const staff = await addStaff(w.api, await root(), `qa.${randomUUID().slice(0, 8)}@platform.test`, key);
    return platformLogin(w.api, staff.email);
  };
  const anywhere = { city_ids: null, channel_ids: null };
  const editOnly = await role(["orders:view", "orders:edit"], anywhere);
  assert.equal((await w.platformDecide(order.id, changeId, "confirm", "想帮忙", editOnly)).status, 403, "只有订单编辑不够");
  const osaka = await role(["order_change_decide:view", "order_change_decide:edit"], { city_ids: [w.m.ids.osaka], channel_ids: null });
  const outside = await w.platformDecide(order.id, changeId, "confirm", "范围外", osaka);
  assert.equal(outside.status, 404, outside.text);
  const tokyo = await role(["order_change_decide:view", "order_change_decide:edit"], { city_ids: [w.m.ids.tokyo], channel_ids: null });
  assert.equal((await ok(w.platformDecide(order.id, changeId, "adjusting", "范围内", tokyo))).change.status, "adjusting");
});

test("权限：供应商调度能处理；只读不能", async () => {
  const { order, changeId } = await surcharged();
  const invite = async (role: string): Promise<string> => {
    const email = `fictional.${role}.${randomUUID().slice(0, 8)}@example.test`;
    const invited = await ok(w.api.call("POST", "/tenant/v1/users", { token: w.b.adminToken, body: { email, name: `虚构${role}`, role } }), 201);
    await ok(w.api.call("POST", "/tenant/v1/auth/accept-invite", { body: { token: invited.invite.token, password: TEST_PASSWORD } }));
    return tenantLogin(w.api, email);
  };
  const readonly = await invite("readonly");
  for (const decision of ["confirm", "reject", "adjusting"] as const) assert.equal((await w.tenantDecide(order.id, changeId, decision, { note: "x" }, readonly)).status, 403);
  const dispatcher = await invite("dispatch");
  assert.equal((await ok(w.tenantDecide(order.id, changeId, "confirm", {}, dispatcher))).change.status, "applied");
});

// ---- 审计 ----

test("审计：供应商的同意、拒绝、调整中和运营代处理都有记录（谁、原因、代哪家）；状态流水从提出到结论都在", async () => {
  const proxied = await surcharged();
  const opsEmail = w.m.staff.operations.email;
  w.api.clock.advance(1_000);
  await ok(w.platformDecide(proxied.order.id, proxied.changeId, "adjusting", "运营协调中"));
  w.api.clock.advance(1_000);
  await ok(w.platformDecide(proxied.order.id, proxied.changeId, "reject", "电话联系过，排不出车"));
  const logs = (await w.api.db.owner.query("select actor_email, action, tenant_id, after from audit_logs where resource = 'order_change' and resource_id = $1 order by occurred_at, id", [proxied.changeId])).rows;
  assert.deepEqual(logs.map((row) => [row.actor_email, row.action]), [[opsEmail, "mark_adjusting"], [opsEmail, "reject"]]);
  for (const row of logs) {
    assert.equal(row.after.by_platform, true);
    assert.equal(row.after.tenant_id, w.b.tenantId, "代哪家");
    assert.equal(row.after.order_id, proxied.order.id);
    assert.ok(typeof row.after.note === "string" && row.after.note.length > 0, "原因");
  }
  const reasons = (await w.api.db.owner.query("select reason, actor from order_events where order_id = $1 and reason like 'CHANGE%' order by occurred_at, id", [proxied.order.id])).rows;
  assert.deepEqual(reasons.map((row) => [row.reason, row.actor]), [["CHANGE_REQUESTED", "channel"], ["CHANGE_ADJUSTING", "platform_user"], ["CHANGE_REJECTED", "platform_user"]]);

  const own = await surcharged();
  await ok(w.tenantDecide(own.order.id, own.changeId, "reject", { note: "排不出车" }));
  const ownLog = (await w.api.db.owner.query("select actor_email, action, tenant_id from audit_logs where resource = 'order_change' and resource_id = $1", [own.changeId])).rows;
  assert.deepEqual(ownLog.map((row) => [row.actor_email, row.action, row.tenant_id]), [[w.m.b.adminEmail, "reject", w.b.tenantId]]);
  const row = (await w.api.db.owner.query("select decided_by, decided_by_platform, decision_note from order_changes where id = $1", [proxied.changeId])).rows[0];
  assert.deepEqual([row.decided_by, row.decision_note], [null, "电话联系过，排不出车"]);
  assert.notEqual(row.decided_by_platform, null);
});

// ---- 隐私 ----

test("隐私：四种司机邮件都没有客人姓名、电话、邮箱、地址、价格、拒绝原因；只有「任务有更新」带链接；发件箱里没有令牌", async () => {
  const { order, email } = await w.dispatched();
  const assertClean = (text: string, label: string): void => {
    for (const secret of [GUEST_NAME, GUEST_PHONE, "+81 90-1234-5678", GUEST_EMAIL, "东京站八重洲口", SECRET_NOTE, "新地址虚构一丁目", "19800", "19,800", String(SELL), "21,780", "¥"]) assert.ok(!text.includes(secret), `${label}：不能有 ${secret}`);
  };
  const first = (await w.patch(order.id, { dropoff_address: "新地址虚构一丁目", passengers: 3 })).body.change;
  await w.tick();
  const pendingMail = w.texts(w.mailsTo(email));
  assert.match(pendingMail, /调度正在确认/);
  assertClean(pendingMail, "等确认");
  assert.equal(tokenInMail(pendingMail), null);
  w.smtp.reset();

  await ok(w.tenantDecide(order.id, first.id, "reject", { note: SECRET_NOTE }));
  await w.tick();
  const declinedMail = w.texts(w.mailsTo(email));
  assert.match(declinedMail, /没有通过/);
  assertClean(declinedMail, "没通过");
  assert.equal(tokenInMail(declinedMail), null);
  w.smtp.reset();

  const second = (await w.patch(order.id, { dropoff_address: "新地址虚构一丁目" })).body.change;
  await w.tick();
  w.smtp.reset();
  await ok(w.tenantDecide(order.id, second.id, "confirm"));
  await w.tick();
  const changedMail = w.texts(w.mailsTo(email));
  assert.match(changedMail, /任务有更新/);
  const token = tokenInMail(changedMail);
  assert.ok(token);
  assertClean(changedMail.replace(token, ""), "有更新");
  w.smtp.reset();

  await ok(w.salesCancel(order.id));
  await w.tick();
  const cancelMail = w.texts(w.mailsTo(email));
  assert.match(cancelMail, /任务已取消/);
  assertClean(cancelMail, "取消");
  assert.equal(tokenInMail(cancelMail), null);
  const events = await w.api.db.owner.query("select data::text as text from notification_events where order_id = $1", [order.id]);
  for (const row of events.rows) {
    assert.ok(!row.text.includes(token));
    assert.ok(!row.text.includes(SECRET_NOTE), "发件箱没有拒绝原因");
    assert.ok(!row.text.includes("新地址虚构一丁目"), "发件箱没有新地址");
  }
});

test("隐私：拒绝原因、调整中说明、代处理原因不外泄给客人、渠道、司机（页面接口、结果邮件、时间线、司机页）", async () => {
  const email = `fictional.guest.${randomUUID().slice(0, 8)}@example.test`;
  const placed = await site.place(w.freshDay(), email);
  const driverEmail = fictionalEmail();
  const driver = await newDriver(w.api, w.b, { email: driverEmail });
  const vehicle = await newVehicle(w.api, w.b, w.m.ids.biz7);
  const assigned = await ok(assign(w.api, w.b, placed.order.id, driver.id, vehicle.id));
  await site.api.app.notificationJobs.tick();
  w.smtp.reset();

  const adjustNote = `${SECRET_NOTE}-调整`;
  const proxyNote = `${SECRET_NOTE}-代处理`;
  const scan = async (label: string): Promise<void> => {
    const guest = await site.api.call("GET", "/site/v1/order", { token: placed.token, ip: placed.ip });
    const trip = await w.api.call("GET", "/driver/v1/trip", { token: assigned.driver_link.token });
    for (const [name, text] of [["官网", guest.text], ["司机页", trip.text]] as const) {
      for (const secret of [SECRET_NOTE, "decision_note"]) assert.ok(!text.includes(secret), `${label}/${name}：${secret}`);
    }
  };
  const res = await site.patch(placed.token, placed.ip, { passengers: 3 });
  const changeId = res.body.change.id;
  await ok(w.tenantDecide(placed.order.id, changeId, "adjusting", { note: adjustNote }));
  await scan("调整中");
  await ok(w.platformDecide(placed.order.id, changeId, "reject", proxyNote));
  await scan("代拒绝");
  await site.api.app.notificationJobs.tick();
  for (const mail of [...w.mailsTo(email), ...w.mailsTo(driverEmail)]) assert.ok(!decodedMailText(mail.data).includes(SECRET_NOTE), "邮件里没有原因");
  const webhooks = await w.api.db.owner.query("select count(*)::int as n from webhook_deliveries where order_id = $1 and event_data::text like $2", [placed.order.id, `%${SECRET_NOTE}%`]);
  assert.equal(webhooks.rows[0].n, 0, "推送给接收方的没有原因");
});

test("隐私：司机页的修改提示只有字段名，没有新的时间、地址、差价；被改派的旧司机打不开", async () => {
  const { order, token } = await surcharged();
  const trip = await ok(w.api.call("GET", "/driver/v1/trip", { token }));
  assert.deepEqual(Object.keys(trip.pending_change), ["fields"]);
  assert.deepEqual(trip.pending_change.fields, ["service_time"]);
  const next = await newDriver(w.api, w.b, { email: fictionalEmail() });
  const vehicle = await newVehicle(w.api, w.b, w.m.ids.biz7);
  await ok(assign(w.api, w.b, order.id, next.id, vehicle.id));
  assert.equal((await w.api.call("GET", "/driver/v1/trip", { token })).status, 401);
});

// ---- OpenAPI ----

test("OpenAPI：渠道、官网的改单返回各状态（等确认、调整中、已拒绝、已超时、已取消）都和定义一致；错误码在定义里有", async () => {
  const email = `fictional.guest.${randomUUID().slice(0, 8)}@example.test`;
  const placed = await site.place(w.freshDay(), email);
  const pending = await site.patch(placed.token, placed.ip, { passengers: 3 });
  assertMatchesOpenApi("PATCH", "/site/v1/order", pending);
  assertMatchesOpenApi("GET", "/site/v1/order", await site.api.call("GET", "/site/v1/order", { token: placed.token, ip: placed.ip }));
  const progress = await site.patch(placed.token, placed.ip, { luggage: 3 });
  assert.equal(progress.body.error.code, "CHANGE_IN_PROGRESS");
  assertMatchesOpenApi("PATCH", "/site/v1/order", progress);
  await ok(w.tenantDecide(placed.order.id, pending.body.change.id, "adjusting"));
  assertMatchesOpenApi("GET", "/site/v1/order", await site.api.call("GET", "/site/v1/order", { token: placed.token, ip: placed.ip }));
  await ok(w.tenantDecide(placed.order.id, pending.body.change.id, "reject", { note: "排不出车" }));
  assertMatchesOpenApi("GET", "/site/v1/order", await site.api.call("GET", "/site/v1/order", { token: placed.token, ip: placed.ip }));
  assertMatchesOpenApi("GET", "/site/v1/order/cancel-fee", await site.api.call("GET", "/site/v1/order/cancel-fee", { token: placed.token, ip: placed.ip }));

  const sales = await surcharged();
  assertMatchesOpenApi("PATCH", "/sales/v1/orders/{id}", sales.res);
  assertMatchesOpenApi("GET", "/sales/v1/orders/{id}", await w.api.call("GET", `/sales/v1/orders/${sales.order.id}`, { token: await w.flow.token() }));
  const expired = sales.res.body.change.confirm_due_at;
  w.api.clock.advance(Date.parse(expired) - w.api.clock.now().getTime());
  await w.api.app.orderJobs.money();
  assertMatchesOpenApi("GET", "/sales/v1/orders/{id}", await w.api.call("GET", `/sales/v1/orders/${sales.order.id}`, { token: await w.flow.token() }));
  const cancelled = await w.salesCancel(sales.order.id, { reason: "CHANGE_NOT_CONFIRMED" });
  assertMatchesOpenApi("POST", "/sales/v1/orders/{id}/cancel", cancelled);
});

test("OpenAPI：供应商和运营的决定、待办、异常队列、通知记录、司机页和定义一致（含 409、404、403）", async () => {
  const one = await surcharged();
  assertMatchesOpenApi("GET", "/tenant/v1/orders/{id}", await w.api.call("GET", `/tenant/v1/orders/${one.order.id}`, { token: w.b.adminToken }));
  assertMatchesOpenApi("GET", "/tenant/v1/orders", await w.api.call("GET", "/tenant/v1/orders?change=pending", { token: w.b.adminToken }));
  assertMatchesOpenApi("GET", "/tenant/v1/order-todos", await w.api.call("GET", "/tenant/v1/order-todos", { token: w.b.adminToken }));
  assertMatchesOpenApi("GET", "/driver/v1/trip", await w.api.call("GET", "/driver/v1/trip", { token: one.token }));
  assertMatchesOpenApi("POST", "/tenant/v1/orders/{id}/changes/{changeId}/adjusting", await w.tenantDecide(one.order.id, one.changeId, "adjusting"));
  assertMatchesOpenApi("POST", "/tenant/v1/orders/{id}/changes/{changeId}/adjusting", await w.tenantDecide(one.order.id, one.changeId, "adjusting"));
  assertMatchesOpenApi("POST", "/tenant/v1/orders/{id}/changes/{changeId}/confirm", await w.tenantDecide(randomUUID(), one.changeId, "confirm"));
  assertMatchesOpenApi("POST", "/tenant/v1/orders/{id}/changes/{changeId}/reject", await w.tenantDecide(one.order.id, one.changeId, "reject", {}));
  assertMatchesOpenApi("POST", "/tenant/v1/orders/{id}/changes/{changeId}/confirm", await w.tenantDecide(one.order.id, one.changeId, "confirm"));

  const two = await surcharged();
  const ops = await w.ops();
  const decide = (decision: string, note: unknown) => w.api.call("POST", `/platform/v1/orders/${two.order.id}/changes/${two.changeId}/${decision}`, { token: ops, body: { note } });
  assertMatchesOpenApi("POST", "/platform/v1/orders/{id}/changes/{changeId}/adjusting", await decide("adjusting", "运营协调"));
  assertMatchesOpenApi("POST", "/platform/v1/orders/{id}/changes/{changeId}/reject", await decide("reject", "运营代拒绝"));
  assertMatchesOpenApi("POST", "/platform/v1/orders/{id}/changes/{changeId}/confirm", await decide("confirm", "再点"));
  const denied = await w.api.call("POST", `/platform/v1/orders/${two.order.id}/changes/${two.changeId}/confirm`, { token: await platformLogin(w.api, w.m.staff.readonly.email), body: { note: "x" } });
  assert.equal(denied.status, 403);
  assertMatchesOpenApi("POST", "/platform/v1/orders/{id}/changes/{changeId}/confirm", denied);

  const three = await surcharged();
  w.api.clock.advance(5 * HOUR);
  await w.relogin();
  await w.api.app.orderJobs.exceptions();
  const list = await w.api.call("GET", `/platform/v1/exceptions?order_id=${three.order.id}`, { token: await root() });
  assertMatchesOpenApi("GET", "/platform/v1/exceptions", list);
  assert.equal(list.body.items[0].type, "change_unconfirmed");
  await w.tick();
  assertMatchesOpenApi("GET", "/tenant/v1/notifications", await w.api.call("GET", `/tenant/v1/notifications?order_id=${three.order.id}`, { token: w.b.adminToken }));
  assertMatchesOpenApi("GET", "/platform/v1/notifications", await w.api.call("GET", `/platform/v1/notifications?order_id=${three.order.id}`, { token: await root() }));
  const orderView = await w.api.call("GET", `/platform/v1/orders/${three.order.id}`, { token: await root() });
  assertMatchesOpenApi("GET", "/platform/v1/orders/{id}", orderView);
  assert.equal(three.res.body.change.price_difference.kind, "charge");
});

test("OpenAPI：改单和待办的枚举、错误码、新接口都写进了定义；待办枚举和 domain 一致", async () => {
  const paths = openApiDoc.paths;
  for (const url of ["/tenant/v1/order-todos", "/tenant/v1/order-todos/{id}/ack", "/tenant/v1/orders/{id}/changes/{changeId}/adjusting", "/platform/v1/orders/{id}/changes/{changeId}/confirm", "/platform/v1/orders/{id}/changes/{changeId}/reject", "/platform/v1/orders/{id}/changes/{changeId}/adjusting"]) {
    assert.ok(paths[url], url);
  }
  const yaml = JSON.stringify(openApiDoc);
  for (const code of ["CHANGE_IN_PROGRESS", "CHANGE_NOT_PENDING", "CHANGE_CONFIRMATION_EXPIRED", "CHANGE_NOT_SERVICEABLE", "TODO_NEEDS_DECISION", "FREE_CANCEL_NOT_APPLICABLE"]) assert.ok(yaml.includes(code), code);
  for (const event of ["order.driver_change_pending", "order.driver_changed", "order.driver_change_declined", "order.driver_cancelled", "order.rescue_started"]) assert.ok(yaml.includes(event), event);
  assert.ok(yaml.includes("change_unconfirmed"));
});
