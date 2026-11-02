/**
 * M4-31 的组件测试（ADR 0065）：运营代客人改单时改乘客邮箱要另一位同事批准——改单框的提示和必填项、提交的内容、结果的说法、
 * 订单详情的等审核状态、待审核页认得这一类。接口用测试替身，数据都是虚构的。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { PassengerEmailReview, PlatformOrder, PlatformOrderDetail } from "../../api/order-money.ts";
import { APPROVAL_KIND_NAMES, approvalChanges } from "../../lib/channel-display.ts";
import { NOT_DISPATCHED, NO_RECORDS, ORDER_ID, TENANT_ID, openApp } from "../../testing/order-center-fixtures.tsx";
import { json, resetBrowser } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const money = (amount: string) => ({ amount, currency: "JPY" });
const ORDER = {
  ...NOT_DISPATCHED,
  id: ORDER_ID,
  order_no: "NZ20261007ABCDEFGH",
  status: "confirmed",
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
  dropoff: { address: "东京站" },
  flight_no: "NH211",
  passenger: { name: "王**", phone: "+********5678", email: "g***@example.com" },
  notes: null,
  notes_masked: false,
  passenger_anonymized_at: null,
  tenant: { id: TENANT_ID, name: "供应商" },
  channel: { id: "c1", name: "官网" },
  channel_order_no: null,
  sell: money("100.00"),
  settlement: { total: money("80.00") },
  markup_bp: 1000,
  fx: null,
  payment: null,
  cancel_policy: null,
  cancellation: null,
  version: 3,
  created_at: "2026-10-07T01:00:00.000Z",
} as unknown as PlatformOrder;

const REVIEW: PassengerEmailReview = {
  id: "r1",
  approval_id: "a1",
  status: "pending_review",
  email_masked: "fr***@example.test",
  previous_email_masked: "g***@example.com",
  verification: "callback_phone",
  requested_by: { id: "u1", name: "虚构客服" },
  created_at: "2026-10-07T02:00:00.000Z",
};

const detailOf = (pending: PassengerEmailReview | null): PlatformOrderDetail =>
  ({ order: ORDER, events: [], records: NO_RECORDS, payments: [], refunds: [], changes: [], extra_charges: [], rescues: [], exceptions: [], tickets: [], webhook_deliveries: [], payment_events: [], quote: null, pending_proxy_review: null, pending_email_review: pending }) as unknown as PlatformOrderDetail;

async function openOrder(pending: PassengerEmailReview | null, patch: (body: unknown) => Response) {
  const bodies: unknown[] = [];
  openApp(`/platform/orders/${ORDER_ID}`, "platform", "customer_service", (call) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}`) return json(200, detailOf(pending));
    if (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}/view-link`) return json(200, { available: false, unavailable_reason: "NOT_SITE_ORDER", email_masked: null, pending_review: null, requests: [] });
    if (call.method === "PATCH" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}`) {
      bodies.push(call.body);
      return patch(call.body);
    }
    return null;
  });
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  return bodies;
}

test("改单框：填了新邮箱才提示「需要另一位同事批准」，核实方式和原因必填；提交的是只改邮箱 + email_review；结果说清楚批准前邮箱不变", async () => {
  const user = userEvent.setup();
  const bodies = await openOrder(null, () => json(202, { change: null, email_review: REVIEW }));
  await user.click(screen.getByRole("button", { name: "代客人改单" }));
  const email = await screen.findByLabelText(/乘客的新邮箱/);
  assert.equal(screen.queryByText(/改乘客邮箱需要另一位同事批准/), null, "没填新邮箱时不打扰");
  await user.type(email, "fresh@example.test");
  assert.ok(screen.getByText(/改乘客邮箱需要另一位同事批准/));
  await user.click(screen.getByRole("button", { name: "保存" }));
  assert.ok(await screen.findByText(/请选怎么核实的客人身份，并写明原因/));
  assert.equal(bodies.length, 0, "没写核实方式不提交");
  await user.selectOptions(screen.getByLabelText(/怎么核实的客人身份/), "callback_phone");
  await user.type(screen.getByLabelText(/^原因/), "回拨下单电话确认是本人");
  await user.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => assert.equal(bodies.length, 1));
  assert.deepEqual(bodies[0], { passenger: { email: "fresh@example.test" }, email_review: { verification: "callback_phone", reason: "回拨下单电话确认是本人" } });
  assert.ok(await screen.findByText(/需要另一位同事在「待审核」里批准，批准前订单上的邮箱不变/));
});

test("改单框：同时改了航班号和邮箱——航班号照常，结果里两件事都说", async () => {
  const user = userEvent.setup();
  const bodies = await openOrder(null, () => json(200, { change: { id: "c1", status: "applied" }, email_review: REVIEW }));
  await user.click(screen.getByRole("button", { name: "代客人改单" }));
  await user.clear(await screen.findByLabelText("航班号"));
  await user.type(screen.getByLabelText("航班号"), "JL001");
  await user.type(screen.getByLabelText(/乘客的新邮箱/), "fresh@example.test");
  await user.selectOptions(screen.getByLabelText(/怎么核实的客人身份/), "order_details");
  await user.type(screen.getByLabelText(/^原因/), "核对了行程");
  await user.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => assert.equal(bodies.length, 1));
  assert.deepEqual(bodies[0], { flight_no: "JL001", passenger: { email: "fresh@example.test" }, email_review: { verification: "order_details", reason: "核对了行程" } });
  assert.ok(await screen.findByText(/已改好，已通知供应商和司机；乘客邮箱改成 fr\*\*\*@example\.test 需要另一位同事/));
});

test("订单详情：有等审核的改邮箱时显示打码地址、发起人和「去待审核」；改单框里不能再改邮箱", async () => {
  const user = userEvent.setup();
  await openOrder(REVIEW, () => json(200, { change: null, email_review: null }));
  assert.ok(screen.getByText(/改成 fr\*\*\*@example\.test 在等另一位同事批准（虚构客服 发起）/));
  assert.equal(screen.getByRole("link", { name: "去待审核" }).getAttribute("href"), "/platform/approvals");
  await user.click(screen.getByRole("button", { name: "代客人改单" }));
  assert.ok(await screen.findByText(/处理完之前不能再改邮箱/));
  assert.equal(screen.queryByLabelText(/乘客的新邮箱/), null);
});

test("待审核页认得「代客人改乘客邮箱」：只有打码地址和核实方式", () => {
  assert.equal(APPROVAL_KIND_NAMES["order.passenger_email"], "代客人改乘客邮箱");
  const rows = approvalChanges("order.passenger_email", {}, { order_no: "NZ20261007ABCDEFGH", email_masked: "fr***@example.test", order_email_masked: "g***@example.com", verification: "callback_phone" }, null);
  assert.deepEqual(rows.map((row) => [row.label, row.before, row.after]), [
    ["订单", "—", "NZ20261007ABCDEFGH"],
    ["乘客邮箱", "g***@example.com", "fr***@example.test"],
    ["核实方式", "—", "回拨下单时留的电话，本人确认"],
  ]);
});
