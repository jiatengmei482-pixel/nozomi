/**
 * M4-31 测试角色的组件测试（ADR 0065）：改单框的提示、必填项、清空后不再带 email_review、格式和空白原因挡在前端、
 * 接口拒绝时的说法、等审核状态；待审核页认得这一类、批准确认框写清效果、客服只能看不能批。接口用测试替身，数据都是虚构的。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { Approval } from "../../api/channels.ts";
import type { PassengerEmailReview, PlatformOrder, PlatformOrderDetail } from "../../api/order-money.ts";
import { COLLEAGUE, ME, NOT_DISPATCHED, NO_RECORDS, ORDER_ID, TENANT_ID, openApp, stamps } from "../../testing/order-center-fixtures.tsx";
import { json, resetBrowser } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const money = (amount: string) => ({ amount, currency: "JPY" });
const ORDER = {
  ...NOT_DISPATCHED,
  id: ORDER_ID,
  order_no: "NZ20261007QAQAQAQA",
  status: "confirmed",
  category: "airport_transfer",
  direction: "pickup",
  vehicle_group_id: "g1",
  package_hours: null,
  service_time: "2026-11-20T01:00:00.000Z",
  service_local: "2026-11-20T10:00",
  timezone: "Asia/Tokyo",
  passengers: 2,
  luggage: 1,
  pickup: null,
  dropoff: { address: "虚构站" },
  flight_no: "NH211",
  passenger: { name: "虚**", phone: "+********5678", email: "q***@example.com" },
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
  email_masked: "qa***@example.test",
  previous_email_masked: "q***@example.com",
  verification: "order_details",
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
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007QAQAQAQA" });
  return bodies;
}

async function openDialog() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "代客人改单" }));
  const dialog = await screen.findByRole("dialog", { name: "代客人改单" });
  return { user, dialog };
}

test("填了新邮箱又清空：提示和必填项消失，只提交别的字段，不带 passenger / email_review", async () => {
  const bodies = await openOrder(null, () => json(200, { change: { id: "c1", status: "applied" }, email_review: null }));
  const { user, dialog } = await openDialog();
  const email = within(dialog).getByLabelText(/乘客的新邮箱/);
  await user.type(email, "qa.fresh@example.test");
  await user.selectOptions(within(dialog).getByLabelText(/怎么核实的客人身份/), "callback_phone");
  await user.type(within(dialog).getByLabelText(/^原因/), "先填了又不改了");
  await user.clear(email);
  assert.equal(within(dialog).queryByText(/改乘客邮箱需要另一位同事批准/), null);
  assert.equal(within(dialog).queryByLabelText(/怎么核实的客人身份/), null);
  await user.type(within(dialog).getByLabelText("备注"), "只改备注");
  await user.click(within(dialog).getByRole("button", { name: "保存" }));
  await waitFor(() => assert.equal(bodies.length, 1));
  assert.deepEqual(bodies[0], { notes: "只改备注" });
});

test("只有空白的新邮箱当作没填；格式不对、原因只有空白都挡在前端，不提交", async () => {
  const bodies = await openOrder(null, () => json(202, { change: null, email_review: REVIEW }));
  const { user, dialog } = await openDialog();
  const email = within(dialog).getByLabelText(/乘客的新邮箱/);
  await user.type(email, "   ");
  await user.click(within(dialog).getByRole("button", { name: "保存" }));
  assert.ok(await within(dialog).findByText("没有要改的内容"));
  await user.clear(email);
  await user.type(email, "not-an-email");
  await user.selectOptions(within(dialog).getByLabelText(/怎么核实的客人身份/), "callback_phone");
  await user.type(within(dialog).getByLabelText(/^原因/), "回拨核实");
  await user.click(within(dialog).getByRole("button", { name: "保存" }));
  assert.ok(await within(dialog).findByText("新邮箱的格式不对"));
  await user.clear(email);
  await user.type(email, "qa.fresh@example.test");
  await user.clear(within(dialog).getByLabelText(/^原因/));
  await user.type(within(dialog).getByLabelText(/^原因/), "    ");
  await user.click(within(dialog).getByRole("button", { name: "保存" }));
  assert.ok(await within(dialog).findByText(/请选怎么核实的客人身份，并写明原因/));
  assert.equal(bodies.length, 0, "都没提交");
});

test("核实方式、原因在无障碍树里是必填项（屏幕阅读器能读出「必填」），提示文字能被读到", async () => {
  await openOrder(null, () => json(202, { change: null, email_review: REVIEW }));
  const { user, dialog } = await openDialog();
  await user.type(within(dialog).getByLabelText(/乘客的新邮箱/), "qa.fresh@example.test");
  const select = within(dialog).getByLabelText(/怎么核实的客人身份/);
  const reason = within(dialog).getByLabelText(/^原因/);
  for (const field of [select, reason]) assert.ok(field.hasAttribute("required") || field.getAttribute("aria-required") === "true", `${field.tagName} 没标必填`);
  const email = within(dialog).getByLabelText(/乘客的新邮箱/);
  const describedBy = email.getAttribute("aria-describedby");
  assert.ok(describedBy, "新邮箱的提示「留空不改……」关联到输入框");
  assert.match(document.getElementById(describedBy.split(" ")[0] as string)?.textContent ?? "", /留空不改/);
});

test("接口拒绝时说清楚：已有一条在等（409）、核实方式没写（400）——框不关，说法来自接口", async () => {
  let reply: Response = json(409, { error: { code: "PASSENGER_EMAIL_REVIEW_PENDING", message: "这张单已经有一次改乘客邮箱在等审核，请先处理那一条（批准、驳回或撤回）", details: { approval_id: "a1" } } });
  const bodies = await openOrder(null, () => reply);
  const { user, dialog } = await openDialog();
  await user.type(within(dialog).getByLabelText(/乘客的新邮箱/), "qa.fresh@example.test");
  await user.selectOptions(within(dialog).getByLabelText(/怎么核实的客人身份/), "other");
  await user.type(within(dialog).getByLabelText(/^原因/), "客人来电");
  await user.click(within(dialog).getByRole("button", { name: "保存" }));
  assert.ok(await within(dialog).findByText(/已经有一次改乘客邮箱在等审核/));
  reply = json(400, { error: { code: "VALIDATION_FAILED", message: "请求参数校验未通过", details: { location: "body", issues: [{ path: "/email_review", reason: "REQUIRED", message: "改乘客邮箱要另一位同事批准：请写明怎么核实的客人身份（核实方式、原因）" }] } } });
  await user.click(within(dialog).getByRole("button", { name: "保存" }));
  await waitFor(() => assert.equal(bodies.length, 2));
  assert.ok(screen.getByRole("dialog", { name: "代客人改单" }), "出错时框不关");
});

test("等审核状态：订单详情不出现新邮箱的原文，只有打码地址；改单框里没有新邮箱输入框，但别的字段照常能改", async () => {
  const bodies = await openOrder(REVIEW, () => json(200, { change: { id: "c1", status: "applied" }, email_review: null }));
  assert.equal(document.body.textContent?.includes("qa.fresh"), false);
  assert.ok(screen.getByText(/改成 qa\*\*\*@example\.test 在等另一位同事批准/));
  const { user, dialog } = await openDialog();
  assert.equal(within(dialog).queryByLabelText(/乘客的新邮箱/), null);
  await user.type(within(dialog).getByLabelText("备注"), "等审核期间改备注");
  await user.click(within(dialog).getByRole("button", { name: "保存" }));
  await waitFor(() => assert.equal(bodies.length, 1));
  assert.deepEqual(bodies[0], { notes: "等审核期间改备注" });
  assert.ok(await screen.findByText(/已改好，已通知供应商和司机/));
});

const person = (id: string, name: string) => ({ id, name, email: `${name}@platform.example` });
const approvalOf = (changes: Partial<Approval>): Approval =>
  ({
    id: "ap-email",
    kind: "order.passenger_email",
    resource: "order",
    resource_id: ORDER_ID,
    summary: "把订单 NZ20261007QAQAQAQA 的乘客邮箱改成 qa***@example.test",
    payload: { order_id: ORDER_ID, order_no: "NZ20261007QAQAQAQA", email_masked: "qa***@example.test", order_email_masked: "q***@example.com", verification: "order_details" },
    before: null,
    base_version: null,
    status: "pending",
    requested_by: person(COLLEAGUE, "虚构客服"),
    requested_at: stamps.created_at,
    request_note: "核对了行程、用车时间和人数",
    decided_by: null,
    decided_at: null,
    decision_note: null,
    impact: null,
    can: { approve: true, reject: true, withdraw: false },
    ...changes,
  }) as Approval;

test("待审核页：类别名、新旧打码地址、核实方式、发起说明；批准确认框写明「等于把订单交给这个邮箱的主人」「客人自己改过的请驳回」", async () => {
  openApp("/platform/approvals", "platform", "operations", (call) => {
    if (call.method === "GET" && call.url.pathname === "/platform/v1/approvals") return json(200, { items: [approvalOf({})], next_cursor: null, total: 1 });
    if (call.method === "GET" && call.url.pathname === "/platform/v1/channels") return json(200, { items: [], next_cursor: null, total: 0 });
    return null;
  });
  const user = userEvent.setup();
  const card = (await screen.findByRole("heading", { name: "代客人改乘客邮箱" })).closest("section") as HTMLElement;
  assert.ok(within(card).getAllByText("qa***@example.test").length > 0);
  assert.ok(within(card).getAllByText("q***@example.com").length > 0);
  assert.ok(within(card).getByText(/核对了行程、用车时间和人数/));
  await user.click(within(card).getByRole("button", { name: /^批准/ }));
  const dialog = await screen.findByRole("dialog", { name: "批准：代客人改乘客邮箱" });
  await waitFor(() => assert.match(dialog.textContent ?? "", /等于把订单交给这个邮箱的主人/));
  assert.match(dialog.textContent ?? "", /审核期间客人自己改过邮箱的，批准会失败，请驳回/);
});

test("待审核页：审核人能从这一条直接打开订单核对（订单号是链接），和代传履约的复核一样", async () => {
  openApp("/platform/approvals", "platform", "operations", (call) => {
    if (call.method === "GET" && call.url.pathname === "/platform/v1/approvals") return json(200, { items: [approvalOf({})], next_cursor: null, total: 1 });
    if (call.method === "GET" && call.url.pathname === "/platform/v1/channels") return json(200, { items: [], next_cursor: null, total: 0 });
    return null;
  });
  const card = (await screen.findByRole("heading", { name: "代客人改乘客邮箱" })).closest("section") as HTMLElement;
  const link = within(card).queryByRole("link", { name: "NZ20261007QAQAQAQA" });
  assert.ok(link, "这一条没有去订单详情的链接：审核人要自己去订单中心搜订单号");
  assert.equal(link.getAttribute("href"), `/platform/orders/${ORDER_ID}`);
});

test("待审核页：客服发起的那一条，客服本人只看到「撤回」和「要等另一位有审核权限的同事处理」，没有批准按钮", async () => {
  openApp("/platform/approvals", "platform", "customer_service", (call) => {
    if (call.method === "GET" && call.url.pathname === "/platform/v1/approvals") return json(200, { items: [approvalOf({ requested_by: person(ME, "测试员工"), can: { approve: false, reject: false, withdraw: true } })], next_cursor: null, total: 1 });
    if (call.method === "GET" && call.url.pathname === "/platform/v1/channels") return json(200, { items: [], next_cursor: null, total: 0 });
    return null;
  });
  const card = (await screen.findByRole("heading", { name: "代客人改乘客邮箱" })).closest("section") as HTMLElement;
  assert.equal(within(card).queryByRole("button", { name: /^批准/ }), null);
  assert.ok(within(card).getByRole("button", { name: /^撤回/ }));
  assert.ok(within(card).getByText("这是你发起的，要等另一位有审核权限的同事处理。"));
});
