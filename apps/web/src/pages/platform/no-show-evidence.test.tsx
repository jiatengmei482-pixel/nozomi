/**
 * M4-20 的组件测试：工单详情（no-show 审核）判定按钮旁看得到证据；看不到时写明原因；对话框里有简表；截图点了才取；订单详情同样显示。接口用测试替身。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { COLLEAGUE, NOT_DISPATCHED, NO_RECORDS, ORDER_ID, TICKET_ID, type Route, openApp, platformTicketDetailOf, platformTicketOf } from "../../testing/order-center-fixtures.tsx";
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
    { item: "contact_attempts", ok: true },
    { item: "signboard_photo", ok: true },
    { item: "leave_consented", ok: false },
    { item: "submitted_in_time", ok: true },
  ],
};
const orderDetail = (records: object = {}) => ({
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
  },
  events: [],
  records: {
    ...NO_RECORDS,
    no_show_claim: claim,
    files: [file("sign", "signboard"), file("shot", "contact_screenshot")],
    contacts: [{ id: "c1", method: "messaging", note: "****5678 已读不回", file_id: "shot", occurred_at: "2026-10-20T00:40:00.000Z" }],
    locations: [{ kind: "arrived", lng: 140.38, lat: 35.77, accuracy_m: 12, recorded_at: "2026-10-20T00:20:00.000Z" }],
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
const reviewTicket = platformTicketDetailOf(platformTicketOf({ type: "no_show_review", assignee_id: COLLEAGUE, source: "system" }));

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

const evidenceCard = async (): Promise<HTMLElement> => (await screen.findByRole("heading", { name: /^no-show 证据/ })).closest("section") as HTMLElement;

test("no-show 审核工单：判定按钮的同一栏看得到 5 项、到达距离和时间、联系记录、举牌照片、落地时间和来源、免费等待时段；举牌照片自动取，截图点了才取", async () => {
  const files: string[] = [];
  openApp(`/platform/tickets/${TICKET_ID}`, "platform", "operations", backend(json(200, orderDetail()), reviewTicket, files));
  await screen.findByText(/✓ 满足：免费等待开始前/);
  const live = await evidenceCard();
  const text = live.textContent ?? "";
  assert.match(text, /✗ 不满足：点了「申请离开」/);
  assert.match(text, /到达时间和距离2026-10-20 09:20，距上车点 120 米/);
  assert.match(text, /免费等待时段2026-10-20 09:30 到 2026-10-20 11:00（提交时）/);
  assert.match(text, /落地时间和来源2026-10-20 09:30（来源：客人确认/);
  assert.match(text, /即时通讯：\*\*\*\*5678 已读不回/);
  assert.match(text, /司机定位记录（1 条）/);
  assert.doesNotMatch(text, /王小明|\+819012345678/);
  const aside = screen.getByRole("complementary", { name: "处理和判定" });
  assert.ok(aside.contains(live), "和判定按钮在同一栏");
  assert.ok(within(aside).getByRole("button", { name: "判定" }));

  await waitFor(() => assert.deepEqual(files, ["sign"]));
  await userEvent.click(within(live).getByRole("button", { name: "查看联系截图" }));
  await waitFor(() => assert.deepEqual(files, ["sign", "shot"]));
});

test("判定对话框里也看得到 5 项", async () => {
  openApp(`/platform/tickets/${TICKET_ID}`, "platform", "operations", backend(json(200, orderDetail())));
  await evidenceCard();
  await screen.findByText(/✓ 满足：免费等待开始前/);
  await userEvent.click(screen.getByRole("button", { name: "判定" }));
  const dialog = await screen.findByRole("dialog");
  assert.match(dialog.textContent ?? "", /✗ 不满足：点了「申请离开」/);
});

test("申诉 no-show 审核的工单也显示证据", async () => {
  const appeal = platformTicketDetailOf(platformTicketOf({ type: "tenant_appeal" }), { parent: { id: "p1", ticket_no: "TK1", type: "no_show_review", outcome: "rejected" } });
  openApp(`/platform/tickets/${TICKET_ID}`, "platform", "operations", backend(json(200, orderDetail()), appeal));
  await screen.findByText(/✓ 满足：免费等待开始前/);
});

test("普通投诉不显示证据，也不取订单", async () => {
  const seen: string[] = [];
  const inner = backend(json(200, orderDetail()), platformTicketDetailOf());
  openApp(`/platform/tickets/${TICKET_ID}`, "platform", "operations", (call) => {
    seen.push(call.url.pathname);
    return inner(call);
  });
  await screen.findByRole("button", { name: "判定" });
  assert.equal(screen.queryByRole("heading", { name: /no-show 证据/ }), null);
  assert.ok(!seen.includes(ORDER_PATH));
});

test("看不到时写明原因：范围外 404", async () => {
  openApp(`/platform/tickets/${TICKET_ID}`, "platform", "operations", backend(json(404, { error: { code: "NOT_FOUND", message: "订单不存在", details: {} } })));
  await screen.findByText("这一单不在你的数据范围里，看不到证据。");
});

test("看不到时写明原因：加载失败可重试，判定对话框也提醒", async () => {
  openApp(`/platform/tickets/${TICKET_ID}`, "platform", "operations", backend(json(500, { error: { code: "INTERNAL_ERROR", message: "出错", details: {} } })));
  await screen.findByText("证据没有加载出来，请检查网络后重试。");
  assert.ok(screen.getByRole("button", { name: "重试" }));
  await userEvent.click(screen.getByRole("button", { name: "判定" }));
  assert.match((await screen.findByRole("dialog")).textContent ?? "", /证据没有加载出来/);
});

test("看不到时写明原因：角色没有 order.read，不去取订单", async () => {
  const seen: string[] = [];
  const inner = backend(json(200, orderDetail()));
  openApp(`/platform/tickets/${TICKET_ID}`, "platform", "custom_no_orders", (call) => {
    seen.push(call.url.pathname);
    return inner(call);
  }, ["ticket.read", "ticket.manage"]);
  await screen.findByText("你没有查看订单的权限，看不到证据。需要的话请联系管理员开通。");
  assert.ok(!seen.includes(ORDER_PATH));
});

test("运营订单详情：同样显示；没有提交 no-show 的单写明没有核对结果，照片点了才取", async () => {
  const files: string[] = [];
  const noClaim = orderDetail({ no_show_claim: null });
  openApp(`/platform/orders/${ORDER_ID}`, "platform", "readonly", backend(json(200, noClaim), reviewTicket, files));
  const card = await evidenceCard();
  assert.match(card.textContent ?? "", /还没有提交 no-show，没有 5 项核对结果/);
  assert.doesNotMatch(card.textContent ?? "", /✓ 满足/);
  assert.ok(within(card).getByRole("button", { name: "查看举牌照片" }));
  assert.deepEqual(files, []);
});

test("运营订单详情：什么记录都没有的写明", async () => {
  const empty = orderDetail({ no_show_claim: null, files: [], contacts: [], locations: [] });
  openApp(`/platform/orders/${ORDER_ID}`, "platform", "readonly", backend(json(200, { ...empty, order: { ...empty.order, fulfilment: NOT_DISPATCHED.fulfilment } })));
  assert.match((await evidenceCard()).textContent ?? "", /没有提交 no-show，也没有到达记录、照片和联系记录/);
});
