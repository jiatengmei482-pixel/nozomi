/**
 * M4-20 测试角色：判定流程和证据区的页面行为（ADR 0054）。no-show-evidence.test.tsx 已测的不重复。接口用测试替身，数据虚构。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { COLLEAGUE, ME, NOT_DISPATCHED, NO_RECORDS, ORDER_ID, TICKET_ID, type Route, openApp, platformTicketDetailOf, platformTicketOf } from "../../testing/order-center-fixtures.tsx";
import { json, resetBrowser } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const ORDER_PATH = `/platform/v1/orders/${ORDER_ID}`;
const TICKET_PATH = `/platform/v1/tickets/${TICKET_ID}`;
const file = (id: string, kind: string) => ({ id, kind, content_type: "image/png", byte_size: 10, uploaded_at: "2026-10-20T01:40:00.000Z" });
const claim = {
  status: "pending_review",
  submitted_at: "2026-10-20T03:20:00.000Z",
  free_wait_start: "2026-10-20T00:30:00.000Z",
  free_wait_end: "2026-10-20T02:00:00.000Z",
  checklist: [
    { item: "arrived_on_time_nearby", ok: true },
    { item: "signboard_photo", ok: false },
    { item: "submitted_in_time", ok: true },
  ],
};
const orderDetail = (records: object = {}, order: object = {}) => ({
  order: {
    ...NOT_DISPATCHED,
    id: ORDER_ID,
    order_no: "NZ20261007ABCDEFGH",
    status: "no_show_claimed",
    category: "airport_transfer",
    direction: "pickup",
    service_time: "2026-10-20T01:00:00.000Z",
    service_local: "2026-10-20T10:00",
    timezone: "Asia/Tokyo",
    passenger: { name: "王**", phone: "+*******5678", email: "gu***@example.com" },
    fulfilment: { ...NOT_DISPATCHED.fulfilment, arrived_at: "2026-10-20T00:20:00.000Z", arrival_distance_m: 120, arrival_within_range: true, leave_requested_at: "2026-10-20T02:10:00.000Z" },
    landing: { scheduled_at: "2026-10-20T01:00:00.000Z", guest_reported_at: null, driver_reported_at: null, driver_photo_file_id: null, landed_at: "2026-10-20T00:30:00.000Z", source: "guest", disagreement: false, delay_minutes: 0, within_delay_allowance: true },
    vehicle_group_id: "g1",
    package_hours: null,
    passengers: 2,
    luggage: 1,
    pickup: null,
    dropoff: { lng: 139.76, lat: 35.68, address: "东京站八重洲口" },
    flight_no: "NH211",
    messaging: null,
    notes: null,
    created_at: "2026-10-07T00:00:00.000Z",
    confirmed_at: "2026-10-07T00:00:00.000Z",
    cancelled_at: null,
    cancel_reason: null,
    tenant: { id: "t1", name: "乙车队" },
    channel: { id: "ch1", name: "官网" },
    channel_order_no: null,
    sell: { amount: "21780", currency: "JPY" },
    settlement: { total: { amount: "19800", currency: "JPY" } },
    markup_bp: 1000,
    payment: null,
    cancel_policy: null,
    cancellation: null,
    version: 3,
    ...order,
  },
  events: [],
  records: {
    ...NO_RECORDS,
    no_show_claim: claim,
    files: [file("sign", "signboard"), file("shot", "contact_screenshot")],
    contacts: [{ id: "c1", method: "messaging", note: "****5678 已读不回", file_id: "shot", occurred_at: "2026-10-20T00:40:00.000Z" }],
    locations: [],
    ...records,
  },
  payments: [],
  refunds: [],
  changes: [],
  extra_charges: [],
  rescues: [],
  exceptions: [],
  tickets: [],
  pending_proxy_review: null,
});
const reviewTicket = platformTicketDetailOf(platformTicketOf({ type: "no_show_review", assignee_id: ME, source: "system" }));

function backend(order: Response | null, ticket: unknown = reviewTicket, files: string[] = []): Route {
  return (call) => {
    if (call.method !== "GET") return null;
    const path = call.url.pathname;
    if (path === TICKET_PATH) return json(200, ticket);
    if (path === ORDER_PATH) return order?.clone() ?? null;
    if (path.startsWith(`${ORDER_PATH}/files/`)) {
      files.push(path.slice(path.lastIndexOf("/") + 1));
      return new Response(new Blob(["x"], { type: "image/png" }), { status: 200, headers: { "content-type": "image/png" } });
    }
    return null;
  };
}

/** 证据加载完的那张卡（加载中是另一张占位卡，标题相同）。 */
const evidenceCard = async (): Promise<HTMLElement> => (await screen.findByRole("heading", { name: /^no-show 证据（/ })).closest("section") as HTMLElement;

test("判定对话框的 5 项简表和页面逐项一致（含不满足和没有核对记录）", async () => {
  openApp(`/platform/tickets/${TICKET_ID}`, "platform", "operations", backend(json(200, orderDetail())), ["ticket.read", "ticket.manage", "order.read"]);
  const card = await evidenceCard();
  await within(card).findAllByText(/^✓ 满足/);
  const pageItems = Array.from(card.querySelectorAll(".evidence-checklist__item > span:first-child")).map((node) => node.textContent);
  assert.equal(pageItems.length, 5);
  assert.equal(pageItems.filter((text) => text?.startsWith("？没有核对记录")).length, 2, "存下的结果里少的两项不算满足");
  assert.equal(pageItems.filter((text) => text?.startsWith("✗ 不满足")).length, 1);
  await userEvent.click(screen.getByRole("button", { name: "判定" }));
  const dialog = await screen.findByRole("dialog");
  const dialogItems = Array.from(dialog.querySelectorAll(".evidence-checklist__item")).map((node) => node.textContent);
  assert.deepEqual(dialogItems, pageItems);
});

test("提交后落地时间变了：只提醒，不改 5 项的结果，也不向后端写任何东西", async () => {
  const landed = { landed_at: "2026-10-20T02:30:00.000Z", guest_reported_at: "2026-10-20T02:30:00.000Z", source: "guest", disagreement: false, delay_minutes: 90, within_delay_allowance: true, scheduled_at: "2026-10-20T01:00:00.000Z", driver_reported_at: null, driver_photo_file_id: null };
  const calls = openApp(`/platform/tickets/${TICKET_ID}`, "platform", "operations", backend(json(200, orderDetail({}, { landing: landed }))), ["ticket.read", "ticket.manage", "order.read"]);
  const card = await evidenceCard();
  await within(card).findByText(/提交之后落地时间变了/);
  assert.equal(within(card).getAllByText(/^✓ 满足/).length, 2, "结果仍是提交时存下的");
  assert.deepEqual(calls.filter((call) => call.method !== "GET" && call.path.includes(ORDER_ID)), []);
});

test("已判定的工单：没有判定按钮，证据还在", async () => {
  const decided = platformTicketDetailOf(platformTicketOf({ type: "no_show_review", assignee_id: ME, source: "system", status: "decided", outcome: "approved", decided_by: COLLEAGUE, decided_at: "2026-10-21T00:00:00.000Z" }));
  openApp(`/platform/tickets/${TICKET_ID}`, "platform", "operations", backend(json(200, orderDetail({ no_show_claim: { ...claim, status: "approved" } })), decided), ["ticket.read", "ticket.manage", "order.read"]);
  const card = await evidenceCard();
  await within(card).findByText(/审核通过/);
  assert.equal(within(screen.getByRole("complementary", { name: "处理和判定" })).queryByRole("button", { name: "判定" }), null);
});

test("有处理权限但没有 order.read：对话框不能叫人去页面看证据（页面上也看不到）", async () => {
  openApp(`/platform/tickets/${TICKET_ID}`, "platform", "custom_x", backend(null), ["ticket.read", "ticket.manage"]);
  await screen.findByText(/你没有查看订单的权限/);
  await userEvent.click(screen.getByRole("button", { name: "判定" }));
  const dialog = await screen.findByRole("dialog");
  assert.ok(!dialog.textContent?.includes("看工单页的「no-show 证据」后再判定"), dialog.textContent ?? "");
  assert.match(dialog.textContent ?? "", /没有查看订单的权限/);
});

test("订单在数据范围外：对话框同样要写明，不能叫人去页面看", async () => {
  openApp(`/platform/tickets/${TICKET_ID}`, "platform", "operations", backend(json(404, { error: { code: "NOT_FOUND", message: "订单不存在", details: {} } })), ["ticket.read", "ticket.manage", "order.read"]);
  await screen.findByText(/不在你的数据范围里/);
  await userEvent.click(screen.getByRole("button", { name: "判定" }));
  const dialog = await screen.findByRole("dialog");
  assert.match(dialog.textContent ?? "", /不在你的数据范围里/);
});

test("证据加载失败时不能盲判：对话框没有确认按钮可点，或者点了不会发判定请求", async () => {
  const calls = openApp(`/platform/tickets/${TICKET_ID}`, "platform", "operations", backend(json(500, { error: { code: "INTERNAL", message: "x", details: {} } })), ["ticket.read", "ticket.manage", "order.read"]);
  await screen.findByText("证据没有加载出来，请检查网络后重试。");
  await userEvent.click(screen.getByRole("button", { name: "判定" }));
  const dialog = await screen.findByRole("dialog");
  within(dialog).getByText(/证据没有加载出来/);
  await userEvent.click(within(dialog).getByRole("radio", { name: /成立|通过/ }));
  await userEvent.type(within(dialog).getByRole("textbox", { name: /判定说明/ }), "没看证据直接判");
  const confirm = within(dialog).queryByRole("button", { name: "确认判定" });
  if (confirm !== null && !(confirm as HTMLButtonElement).disabled) await userEvent.click(confirm);
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(calls.filter((call) => call.method === "POST" && call.path.endsWith("/decide")).map((call) => call.path), []);
});

test("开关判定对话框不会重取照片（每取一次记一条审计）", async () => {
  const files: string[] = [];
  openApp(`/platform/tickets/${TICKET_ID}`, "platform", "operations", backend(json(200, orderDetail()), reviewTicket, files), ["ticket.read", "ticket.manage", "order.read"]);
  await waitFor(() => assert.deepEqual(files, ["sign"]));
  await userEvent.click(await screen.findByRole("button", { name: "判定" }));
  const dialog = await screen.findByRole("dialog");
  await userEvent.click(within(dialog).getByRole("button", { name: "取消" }));
  await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.deepEqual(files, ["sign"]);
});

test("键盘：查看截图可以用键盘打开，打开后焦点不丢", async () => {
  openApp(`/platform/tickets/${TICKET_ID}`, "platform", "operations", backend(json(200, orderDetail())), ["ticket.read", "ticket.manage", "order.read"]);
  const card = await evidenceCard();
  const button = await within(card).findByRole("button", { name: "查看联系截图" });
  button.focus();
  await userEvent.keyboard("{Enter}");
  const link = await within(card).findByRole("link", { name: "下载联系截图原图" });
  assert.ok(link);
  assert.notEqual(document.activeElement, document.body, "按钮消失后焦点掉到页面最前面，键盘用户要重新走一遍");
});

test("取回的地址：离开页面后收回下载地址、释放解码的图片", async (t) => {
  const close = t.mock.fn();
  (globalThis as { createImageBitmap?: unknown }).createImageBitmap = async () => ({ width: 2, height: 3, close });
  const revoke = t.mock.method(URL, "revokeObjectURL", () => undefined);
  const create = t.mock.method(URL, "createObjectURL", () => "blob:test/qa");
  t.after(() => {
    delete (globalThis as { createImageBitmap?: unknown }).createImageBitmap;
  });
  openApp(`/platform/tickets/${TICKET_ID}`, "platform", "operations", backend(json(200, orderDetail())), ["ticket.read", "ticket.manage", "order.read"]);
  await screen.findByRole("img", { name: /^举牌照片/ });
  assert.equal(create.mock.callCount(), 1);
  assert.equal(document.querySelector("img[src^='blob:']"), null, "页面上没有 blob: 图片地址");
  cleanup();
  assert.equal(revoke.mock.callCount(), 1);
  assert.equal(close.mock.callCount(), 1);
});

test("页面不出现英文内部代码：所有定位种类、联系方式、状态都是中文", async () => {
  const kinds = ["departed", "arrived", "picked_up", "completed", "leave_requested", "no_show", "ping"];
  const locations = kinds.map((kind, index) => ({ kind, lng: 140.38, lat: 35.77, accuracy_m: null, recorded_at: `2026-10-20T00:2${index}:00.000Z` }));
  for (const status of ["pending_review", "approved", "rejected"]) {
    openApp(`/platform/tickets/${TICKET_ID}`, "platform", "operations", backend(json(200, orderDetail({ locations, no_show_claim: { ...claim, status } }))), ["ticket.read", "ticket.manage", "order.read"]);
    const card = await evidenceCard();
    await within(card).findAllByText(/^✓ 满足/);
    const text = card.textContent ?? "";
    assert.ok(!/[a-z]+_[a-z_]+|\b(?:departed|arrived|completed|ping|signboard|phone|messaging|guest|driver|scheduled)\b/.test(text), text);
    cleanup();
    resetBrowser();
  }
});
