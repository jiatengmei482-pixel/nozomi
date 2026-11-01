/**
 * 运营代供应商回传履约的页面（M4-18，ADR 0052）。接口用测试替身；真实后端由 proxy-fulfilment.itest.ts 和端到端测试覆盖。
 * 按钮只给有权限的人、按状态只给下一步；确认框必填原因；完成写明要复核；被别人抢先时关掉框看最新状态；流水里标平台代传；供应商看到标记，看不到原因。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { OrderStatus } from "@nozomi/domain";
import type { OrderEvent, TenantOrderDetail } from "../../api/dispatch.ts";
import type { PlatformOrder, PlatformOrderDetail } from "../../api/order-money.ts";
import { NOT_DISPATCHED, NO_RECORDS, ORDER_ID, openApp } from "../../testing/order-center-fixtures.tsx";
import { json, resetBrowser } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const money = (amount: string) => ({ amount, currency: "JPY" });
const orderOf = (changes: Partial<PlatformOrder> = {}): PlatformOrder =>
  ({
    ...NOT_DISPATCHED,
    id: ORDER_ID,
    order_no: "NZ20261007ABCDEFGH",
    status: "assigned",
    category: "airport_transfer",
    direction: "pickup",
    vehicle_group_id: "g1",
    package_hours: null,
    service_time: "2026-10-20T01:00:00.000Z",
    service_local: "2026-10-20T10:00",
    timezone: "Asia/Tokyo",
    passengers: 2,
    luggage: 1,
    pickup: null,
    dropoff: { lng: 139.76, lat: 35.68, address: "东京站八重洲口" },
    flight_no: "NH211",
    passenger: { name: "王小明", phone: "+819012345678", email: "guest@example.com" },
    messaging: null,
    notes: null,
    created_at: "2026-10-06T00:12:00.000Z",
    confirmed_at: "2026-10-06T00:12:00.000Z",
    cancelled_at: null,
    cancel_reason: null,
    tenant: { id: "t1", name: "乙车队" },
    channel: { id: "ch1", name: "官网" },
    channel_order_no: null,
    sell: money("21780"),
    settlement: { total: money("19800") },
    markup_bp: 1000,
    payment: null,
    cancel_policy: null,
    cancellation: null,
    version: 3,
    ...changes,
  }) as PlatformOrder;

const detailOf = (order: PlatformOrder, extra: Partial<PlatformOrderDetail> = {}): PlatformOrderDetail => ({ order, events: [], payments: [], refunds: [], changes: [], extra_charges: [], rescues: [], exceptions: [], tickets: [], pending_proxy_review: null, records: NO_RECORDS, ...extra });
const PATH = `/platform/orders/${ORDER_ID}`;
const API = `/platform/v1/orders/${ORDER_ID}`;

function open(detail: PlatformOrderDetail, role: string, post?: () => Response, permissions: string[] = []) {
  return openApp(PATH, "platform", role, (call) => {
    if (call.method === "GET" && call.url.pathname === API) return json(200, detail);
    if (call.method === "POST" && call.url.pathname === `${API}/events` && post) return post();
    return null;
  }, permissions);
}

const heading = () => screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });

test("只读、客服、财务看不到入口；运营看得到，按状态只有下一步一个按钮", async () => {
  for (const role of ["readonly", "customer_service", "finance", "risk"]) {
    open(detailOf(orderOf()), role);
    await heading();
    assert.equal(screen.queryByRole("heading", { name: "代供应商回传履约" }), null, role);
    assert.equal(screen.queryByRole("button", { name: /代传/ }), null, role);
    resetBrowser();
  }
  const steps: [OrderStatus, string][] = [["assigned", "代传「司机已出发」"], ["departed", "代传「司机已到达」"], ["arrived", "代传「已接到客人」"], ["in_service", "代传「已完成」"]];
  for (const [status, name] of steps) {
    open(detailOf(orderOf({ status })), "operations");
    await heading();
    assert.deepEqual(screen.getAllByRole("button", { name: /^代传/ }).map((button) => button.textContent), [name]);
    resetBrowser();
  }
});

test("没付款、已取消、已完成、救援中、no-show 待审核的单没有这一块；待派车写明要先派车，没有按钮", async () => {
  for (const status of ["pending_payment", "cancelled", "completed", "rescue_pending", "no_show_claimed"] as const) {
    open(detailOf(orderOf({ status })), "operations");
    await heading();
    assert.equal(screen.queryByRole("heading", { name: "代供应商回传履约" }), null, status);
    resetBrowser();
  }
  open(detailOf(orderOf({ status: "confirmed" })), "operations");
  await heading();
  assert.ok(screen.getByText(/还没派车.*要等供应商派车后才能代传/));
  assert.equal(screen.queryByRole("button", { name: /^代传/ }), null);
});

test("确认框：原因必填；提交带版本号、当地时间换算成的时刻和原因；成功后提示并重新取数据；写明供应商看得到什么", async () => {
  const user = userEvent.setup();
  const calls = open(detailOf(orderOf()), "operations", () => json(200, { order_id: ORDER_ID, status: "departed", version: 4 }));
  await heading();
  await user.click(screen.getByRole("button", { name: "代传「司机已出发」" }));
  const dialog = await screen.findByRole("dialog", { name: "代供应商回传：司机已出发" });
  assert.match(dialog.textContent ?? "", /供应商看得到这一步是平台代传的.*看不到原因和操作人/);
  await user.click(within(dialog).getByRole("button", { name: "确认代传" }));
  assert.ok(await within(dialog).findByText(/请写明为什么要代传/));
  assert.equal(calls.filter((call) => call.method === "POST").length, 0);
  const time = within(dialog).getByLabelText("发生时间（当地，Asia/Tokyo）") as HTMLInputElement;
  await user.clear(time);
  await user.type(time, "2026-10-20T09:30");
  await user.type(within(dialog).getByLabelText("原因"), "供应商系统故障");
  await user.click(within(dialog).getByRole("button", { name: "确认代传" }));
  assert.ok(await screen.findByText("已代传：司机已出发"));
  const post = calls.find((call) => call.method === "POST");
  assert.deepEqual(post?.body, { type: "departed", occurred_at: "2026-10-20T00:30:00.000Z", reason: "供应商系统故障" });
  assert.equal(post?.headers["if-match"], '"3"');
  await waitFor(() => assert.ok(calls.filter((call) => call.method === "GET" && call.path.split("?")[0] === API).length >= 2, "成功后重新取"));
});

test("已到达写明对 no-show 的影响；接到客人、完成写明不可撤销、要另一位审核，提交后提示去待审核", async () => {
  const user = userEvent.setup();
  open(detailOf(orderOf({ status: "departed" })), "operations");
  await heading();
  await user.click(screen.getByRole("button", { name: "代传「司机已到达」" }));
  assert.match((await screen.findByRole("dialog")).textContent ?? "", /没有司机定位：这一单之后不能再提交客人未出现/);
  resetBrowser();

  const pickUp = open(detailOf(orderOf({ status: "arrived" })), "operations", () => json(202, { approval: { id: "a0", kind: "order.proxy_pick_up" } }));
  await heading();
  await user.click(screen.getByRole("button", { name: "代传「已接到客人」" }));
  const pickUpDialog = await screen.findByRole("dialog", { name: "代供应商回传：已接到客人" });
  assert.match(pickUpDialog.textContent ?? "", /不能再取消，也不能再提交客人未出现.*另一位有权限的同事/);
  assert.match(pickUpDialog.textContent ?? "", /不能早于用车前 3 小时/);
  await user.type(within(pickUpDialog).getByLabelText("原因"), "故障");
  await user.click(within(pickUpDialog).getByRole("button", { name: "提交审核" }));
  assert.ok(await screen.findByText(/要另一位同事在「待审核」里批准，「已接到客人」才生效/));
  assert.equal(pickUp.filter((call) => call.method === "POST").length, 1);
  resetBrowser();

  const calls = open(detailOf(orderOf({ status: "in_service" })), "operations", () => json(202, { approval: { id: "a1", kind: "order.proxy_complete" } }));
  await heading();
  await user.click(screen.getByRole("button", { name: "代传「已完成」" }));
  const dialog = await screen.findByRole("dialog", { name: "代供应商回传：已完成" });
  assert.match(dialog.textContent ?? "", /会进供应商账单.*另一位有权限的同事.*从批准时算起/);
  assert.equal(within(dialog).queryByLabelText("实际时长（分钟）"), null, "接机不用填");
  await user.type(within(dialog).getByLabelText("原因"), "故障");
  await user.click(within(dialog).getByRole("button", { name: "提交审核" }));
  assert.ok(await screen.findByText(/要另一位同事在「待审核」里批准，「已完成」才生效/));
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
});

test("包车完成要填实际时长和里程；不填不提交", async () => {
  const user = userEvent.setup();
  const calls = open(detailOf(orderOf({ status: "in_service", category: "charter", direction: null, flight_no: null, package_hours: 8, pickup: { lng: 139.76, lat: 35.68, address: "东京站" }, dropoff: null })), "operations", () => json(202, { approval: { id: "a1" } }));
  await heading();
  await user.click(screen.getByRole("button", { name: "代传「已完成」" }));
  const dialog = await screen.findByRole("dialog");
  await user.type(within(dialog).getByLabelText("原因"), "故障");
  await user.click(within(dialog).getByRole("button", { name: "提交审核" }));
  assert.ok(await within(dialog).findByText(/包车完成要填实际用了多少分钟/));
  assert.equal(calls.filter((call) => call.method === "POST").length, 0);
  await user.type(within(dialog).getByLabelText("实际时长（分钟）"), "320");
  await user.type(within(dialog).getByLabelText("实际里程（公里）"), "140");
  await user.click(within(dialog).getByRole("button", { name: "提交审核" }));
  await screen.findByText(/要另一位同事/);
  assert.deepEqual((calls.find((call) => call.method === "POST")?.body as { actual: unknown }).actual, { minutes: 320, km: 140 });
});

test("复核中：不显示按钮，写明在等批准并能去待审核", async () => {
  open(detailOf(orderOf({ status: "in_service" }), { pending_proxy_review: { approval_id: "a1", event: "completed", requested_at: "2026-10-20T03:00:00.000Z" } }), "operations");
  await heading();
  assert.equal(screen.queryByRole("button", { name: /^代传/ }), null);
  assert.ok(screen.getByText("代传「已完成」在等另一位同事批准，批准后才生效。"));
  assert.equal(screen.getByRole("link", { name: "去待审核" }).getAttribute("href"), "/platform/approvals");
});

test("被别人抢先（409）：关掉确认框、中文提示、重新取数据，不在旧内容上重试；时间不合规则的提示写在框里", async () => {
  const user = userEvent.setup();
  const calls = open(detailOf(orderOf()), "operations", () => json(409, { error: { code: "ORDER_STATE_INVALID", message: "订单当前的状态不允许这个操作", details: { status: "departed", action: "departed" } } }));
  await heading();
  await user.click(screen.getByRole("button", { name: "代传「司机已出发」" }));
  const dialog = await screen.findByRole("dialog");
  await user.type(within(dialog).getByLabelText("原因"), "故障");
  await user.click(within(dialog).getByRole("button", { name: "确认代传" }));
  assert.ok(await screen.findByText(/这一单的状态已经变了（可能供应商或司机刚回传）/));
  await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
  await waitFor(() => assert.ok(calls.filter((call) => call.method === "GET" && call.path.split("?")[0] === API).length >= 2));
  resetBrowser();

  open(detailOf(orderOf()), "operations", () => json(400, { error: { code: "VALIDATION_FAILED", message: "请求参数校验未通过", details: { location: "body", issues: [{ path: "/occurred_at", reason: "BEFORE_PREVIOUS", message: "发生时间不能早于上一个履约节点" }] } } }));
  await heading();
  await user.click(screen.getByRole("button", { name: "代传「司机已出发」" }));
  const again = await screen.findByRole("dialog");
  await user.type(within(again).getByLabelText("原因"), "故障");
  await user.click(within(again).getByRole("button", { name: "确认代传" }));
  assert.ok(await within(again).findByText("发生时间不能早于上一个履约节点"));
});

const proxied: OrderEvent = { from_status: "assigned", to_status: "departed", actor: "platform_user", reason: "DEPARTED", occurred_at: "2026-10-20T00:30:00.000Z", source: "platform_proxy", recorded_at: "2026-10-20T00:40:00.000Z" };

test("运营的状态流水：代传的标「平台代传」，有系统记录时间和原因；自己回传的没有标记", async () => {
  const own: OrderEvent = { ...proxied, from_status: "confirmed", to_status: "assigned", actor: "tenant_user", reason: "ASSIGNED", source: null, recorded_at: null };
  open(detailOf(orderOf({ status: "departed" }), { events: [own, { ...proxied, proxy: { reason: "供应商系统故障", requested_by: "u1", approved_by: null, approval_id: null } }] }), "readonly");
  await heading();
  const flow = screen.getByRole("heading", { name: "状态流水" }).closest("section") as HTMLElement;
  const items = within(flow).getAllByRole("listitem");
  assert.doesNotMatch(items[0]?.textContent ?? "", /平台代传/);
  assert.match(items[1]?.textContent ?? "", /平台代传 系统记录 .*；原因：供应商系统故障/);
  assert.doesNotMatch(flow.textContent ?? "", /DEPARTED|ASSIGNED/, "不把内部代码给人看");
});

test("供应商的状态流水：看得到「平台代传」和系统记录时间", async () => {
  const detail = { order: { ...orderOf({ status: "departed" }), dispatch: { due_at: null, overdue: false, overdue_at: null, escalation_at: null, departure_due_at: null, departure_overdue_at: null, assigned_at: null, driver: null, vehicle: null }, fulfilment: { departed_at: null, arrived_at: null, arrival_distance_m: null, arrival_within_range: null, picked_up_at: null, completed_at: null, actual_minutes: null, actual_km: null, leave_requested_at: null }, landing: { scheduled_at: "2026-10-20T01:00:00.000Z", guest_reported_at: null, driver_reported_at: null, driver_photo_file_id: null, landed_at: "2026-10-20T01:00:00.000Z", source: "scheduled", disagreement: false, delay_minutes: 0, within_delay_allowance: true }, settlement: { total: money("19800"), base: money("19800"), adjust: money("0"), urgent: money("0"), night: money("0"), addons: money("0"), driver_language: money("0") } }, events: [proxied], records: { assignments: [], driver_link: null, files: [], contacts: [], locations: [], no_show_claim: null }, changes: [], extra_charges: [], rescue: null } as unknown as TenantOrderDetail;
  openApp(`/orders/${ORDER_ID}`, "tenant", "admin", (call) => (call.method === "GET" && call.url.pathname === `/tenant/v1/orders/${ORDER_ID}` ? json(200, detail) : null));
  const heading = await screen.findByRole("heading", { name: "状态流水" });
  const text = heading.closest("section")?.textContent ?? "";
  assert.match(text, /平台代传 系统记录/);
  assert.doesNotMatch(text, /原因/);
});
