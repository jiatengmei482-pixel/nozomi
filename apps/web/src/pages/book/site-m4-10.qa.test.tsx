/**
 * M4-10 测试角色：官网订单页上和本任务有关的几处。
 * - 没付款就取消的单：和运营后台一致（订单详情不给「新建工单」、后端 409 NOT_CONFIRMED），客人订单页也不该出现「投诉和反馈」的提交入口；
 * - 包车（免费等待固定为 0）：订单页写「不另计免费等待（从约定的开始时间起计入包车时长）」，不写「0 分钟」；
 * - 客人取消了还没付款的单：原因只写「您取消了订单」。
 * 接口用测试替身。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { SiteConfig, SiteOrder, SiteOrderEnvelope } from "../../api/site.ts";
import { type ApiCall, apiError, assertAbsent, json, resetBrowser, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const TOKEN = `nzo_${"M".repeat(20)}_${"q".repeat(22)}`;
const openConfig: SiteConfig = { open: true, currency: "JPY", payments: null, support_phone: null, address_search: false, map_tiles: null };
const tiers = [{ min_hours_before: 48, fee_bp: 0 }, { min_hours_before: 24, fee_bp: 5000 }, { min_hours_before: 0, fee_bp: 10000 }];

const orderOf = (changes: Partial<SiteOrder> = {}): SiteOrder => ({
  id: "44444444-4444-4444-8444-444444444444",
  order_no: "NZ20261026M410QA01",
  status: "confirmed",
  category: "point_to_point",
  city_id: "11111111-1111-4111-8111-111111111111",
  place_id: null,
  direction: null,
  vehicle_group_id: "33333333-3333-4333-8333-333333333333",
  package_hours: null,
  service_time: "2030-11-20T01:00:00.000Z",
  service_local: "2030-11-20T10:00",
  timezone: "Asia/Tokyo",
  service_date: "2030-11-20",
  urgent: false,
  passengers: 2,
  luggage: 1,
  pickup: { lng: 139.76, lat: 35.68, address: "东京站" },
  dropoff: { lng: 139.7, lat: 35.69, address: "新宿站南口" },
  addons: [],
  driver_language: null,
  flight_no: null,
  passenger: { name: "李四", phone: "+819087654321", email: "qa@example.com" },
  messaging: null,
  notes: null,
  free_wait_minutes: 15,
  created_at: "2026-10-26T01:00:00.000Z",
  confirmed_at: "2026-10-26T01:05:00.000Z",
  cancelled_at: null,
  cancel_reason: null,
  quote_id: "QT20261026ABCDEFGHIJ",
  channel_order_no: null,
  price: { total: { amount: "13200", currency: "JPY" }, fx: null },
  payment_status: "succeeded",
  payment_due_at: "2026-10-26T01:30:00.000Z",
  winning_tenant: null,
  driver: null,
  vehicle: null,
  landing: null,
  cancel_policy: { version: 0, category: "point_to_point", level: "business", tiers },
  cancellation: null,
  free_cancel_available: true,
  changes: [],
  extra_charges: [],
  version: 3,
  ...changes,
});

const envelopeOf = (order: SiteOrder): SiteOrderEnvelope => ({
  order,
  timeline: [
    { from_status: null, to_status: "pending_payment", reason: null, occurred_at: order.created_at },
    ...(order.status === "cancelled" ? [{ from_status: "pending_payment" as const, to_status: "cancelled" as const, reason: order.cancel_reason, occurred_at: order.cancelled_at ?? order.created_at }] : []),
  ],
  names: { city: { code: "CTY-JP-TYO", name: { zh: "东京" } }, place: null, vehicle_group: { code: "VG-BIZ-7", name: { zh: "商务 7 座" }, seats: 7 } },
});

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;
function open(order: SiteOrder, route: Route = () => null): ApiCall[] {
  const calls = stubApiWith((call) => {
    if (call.url.pathname === "/site/v1/config") return json(200, openConfig);
    if (call.method === "GET" && call.url.pathname === "/site/v1/order") return json(200, envelopeOf(order));
    return route(call);
  });
  render(
    <MemoryRouter initialEntries={[{ pathname: "/book/order", hash: `#${TOKEN}` }]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

/** 没付款就被客人取消的单（和后端 409 NOT_CONFIRMED 的那一种一样：confirmed_at 为空） */
const cancelledUnpaid = (): SiteOrder =>
  orderOf({
    status: "cancelled",
    confirmed_at: null,
    payment_status: "canceled",
    cancel_reason: "GUEST_REQUEST",
    cancelled_at: "2026-10-26T01:10:00.000Z",
    free_cancel_available: false,
    cancellation: { reason: "GUEST_REQUEST", fee_bp: 0, fee: null, refund: { amount: "0", currency: "JPY" }, refund_status: null },
  });

test("没付款就取消的单：订单页没有「投诉和反馈」的提交入口（后端对这种单拒绝建工单，和运营后台不给「新建工单」一致）", async () => {
  const calls = open(cancelledUnpaid(), (call) => {
    if (call.method === "GET" && call.url.pathname === "/site/v1/order/tickets") return json(200, { items: [] });
    if (call.method === "POST" && call.url.pathname === "/site/v1/order/tickets") return apiError(409, "ORDER_STATE_INVALID", "这张订单没有付过款就取消了，不能建工单", { reason: "NOT_CONFIRMED", status: "cancelled" });
    return null;
  });
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261026M410QA01" });
  await waitFor(() => assert.ok(screen.getAllByRole("heading", { level: 2 }).length > 0));
  assert.ok(screen.getAllByText("您取消了订单").length >= 1);
  assert.doesNotMatch(document.body.textContent ?? "", /按取消政策退款/);
  assertAbsent(screen.queryByRole("button", { name: "提交投诉或反馈" }));
  assertAbsent(screen.queryByRole("heading", { level: 2, name: "投诉和反馈" }));
  assert.equal(calls.filter((call) => call.method === "POST").length, 0);
});

test("付过款再取消的单：仍然有「投诉和反馈」（只拦没付过款的）", async () => {
  open(
    orderOf({ status: "cancelled", cancel_reason: "GUEST_REQUEST", cancelled_at: "2026-10-27T01:10:00.000Z", payment_status: "succeeded", cancellation: { reason: "GUEST_REQUEST", fee_bp: 0, fee: null, refund: { amount: "13200", currency: "JPY" }, refund_status: "succeeded" } }),
    (call) => (call.method === "GET" && call.url.pathname === "/site/v1/order/tickets" ? json(200, { items: [] }) : null),
  );
  assert.ok(await screen.findByRole("heading", { level: 2, name: "投诉和反馈" }));
});

test("包车订单（免费等待 0）：订单页的免费等待写「不另计免费等待（从约定的开始时间起计入包车时长）」，不写「0 分钟」", async () => {
  open(orderOf({ category: "charter", package_hours: 8, dropoff: null, free_wait_minutes: 0, cancel_policy: { version: 0, category: "charter", level: "business", tiers } }), (call) => (call.method === "GET" && call.url.pathname === "/site/v1/order/tickets" ? json(200, { items: [] }) : null));
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261026M410QA01" });
  assert.ok(await screen.findByText("不另计免费等待（从约定的开始时间起计入包车时长）"));
  assert.doesNotMatch(document.body.textContent ?? "", /免费等待0 分钟|0 分钟（从约定的上车时间起算）/);
});
