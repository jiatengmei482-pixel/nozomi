/**
 * M4-30 测试角色：运营订单详情「官网订单链接」（ADR 0061）。接口用测试替身。
 * - 只有「订单链接重发 · 编辑」的角色有按钮（运营、客服）；只能看订单的（财务、风控、只读）看得到记录、没有按钮；
 * - 不是官网的单整块不显示；已脱敏没有按钮；没有下单邮箱时只能选「发到新邮箱」；
 * - 在等审核时显示打码地址和「去待审核」；后端 409、429 的说法；页面上只有打码地址，填的新邮箱提交后不留在页面上。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { PlatformOrder, PlatformOrderDetail } from "../../api/order-money.ts";
import { type ApiCall, apiError, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";
import { NOT_DISPATCHED, NO_RECORDS } from "../../testing/order-center-fixtures.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-10-06T00:12:00.000Z", updated_at: "2026-10-08T05:30:00.000Z" };
const ORDER_ID = "0a0a0a0a-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const platformMe = (role: string) => json(200, { user: { id: "p1", email: "staff@platform.example", name: "测试员工", role, status: "active", ...stamps }, permissions: [], must_change_password: false });
type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;
const user = () => userEvent.setup();
const money = (amount: string) => ({ amount, currency: "JPY" });
const businessTiers = [{ min_hours_before: 48, fee_bp: 0 }, { min_hours_before: 24, fee_bp: 5000 }, { min_hours_before: 0, fee_bp: 10000 }];

function open(role: string, routes: Route): ApiCall[] {
  signIn("platform", "the-token");
  const calls = stubApiWith((call) => {
    const custom = routes(call);
    if (custom !== null) return custom;
    if (call.method === "GET" && call.url.pathname === "/platform/v1/auth/me") return platformMe(role);
    return null;
  });
  render(
    <MemoryRouter initialEntries={[`/platform/orders/${ORDER_ID}`]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

const platformOrder = (): PlatformOrder => ({
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
  dropoff: { lng: 139.76, lat: 35.68, address: "东京站八重洲口" },
  flight_no: "NH211",
  passenger: { name: "王小明", phone: "+819012345678", email: "guest@example.com" },
  messaging: null,
  notes: null,
  created_at: stamps.created_at,
  confirmed_at: stamps.created_at,
  cancelled_at: null,
  cancel_reason: null,
  tenant: { id: "t1", name: "乙车队" },
  channel: { id: "ch1", name: "官网" },
  channel_order_no: null,
  sell: money("21780"),
  settlement: { total: money("19800") },
  markup_bp: 1000,
  payment: null,
  cancel_policy: { version: 0, category: "airport_transfer", level: "business", tiers: businessTiers },
  cancellation: null,
  version: 3,
});

const platformDetail = (order: PlatformOrder, extra: Partial<PlatformOrderDetail> = {}): PlatformOrderDetail => ({
  order,
  events: [{ from_status: "pending_payment", to_status: "confirmed", actor: "payment", reason: "PAYMENT_SUCCEEDED", occurred_at: stamps.created_at, source: null, recorded_at: null }],
  payments: [],
  refunds: [],
  changes: [],
  extra_charges: [],
  rescues: [],
  exceptions: [],
  tickets: [],
  pending_proxy_review: null,
  records: NO_RECORDS,
  ...extra,
});


type Status = Record<string, unknown>;
const available: Status = { available: true, unavailable_reason: null, email_masked: "gu***@example.com", pending_review: null, requests: [] };
const pendingRequest = { id: "d1d1d1d1-dddd-4ddd-8ddd-dddddddddddd", target: "new_email", email_masked: "ne***@example.com", verification: "payment_details", status: "pending_review", approval_id: "a1a1a1a1-aaaa-4aaa-8aaa-aaaaaaaaaaaa", requested_by: { id: "p2", name: "另一位客服" }, created_at: stamps.updated_at, decided_at: null };

function routesOf(status: Status, resend: (body: unknown) => Response = () => json(202, { request: pendingRequest, approval: null })): { route: Route; posted: unknown[] } {
  const posted: unknown[] = [];
  const route: Route = (call) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}`) return json(200, platformDetail(platformOrder()));
    if (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}/view-link`) return json(200, status);
    if (call.method === "POST" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}/view-link/resend`) {
      posted.push(call.body);
      return resend(call.body);
    }
    return null;
  };
  return { route, posted };
}

const section = async (): Promise<HTMLElement> => (await screen.findByRole("heading", { name: "官网订单链接" })).closest("section") as HTMLElement;

test("只能看订单的角色（财务、风控、只读）：看得到打码地址和记录，没有「重发订单链接」按钮", async () => {
  for (const role of ["finance", "risk", "readonly"]) {
    const { route } = routesOf({ ...available, requests: [{ ...pendingRequest, status: "dismissed", approval_id: "a2a2a2a2-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }] });
    open(role, route);
    const card = await section();
    assert.ok(within(card).getByText("gu***@example.com"), role);
    assert.ok(within(card).getByRole("cell", { name: "已驳回或撤回" }), role);
    assert.equal(within(card).queryByRole("button", { name: "重发订单链接" }), null, `${role} 不该有按钮`);
    resetBrowser();
  }
});

test("运营、客服有按钮；不是官网的单整块不显示；已脱敏没有按钮", async () => {
  for (const role of ["operations", "customer_service", "super_admin"]) {
    open(role, routesOf(available).route);
    assert.ok(within(await section()).getByRole("button", { name: "重发订单链接" }), role);
    resetBrowser();
  }
  const calls = open("operations", routesOf({ available: false, unavailable_reason: "NOT_SITE_ORDER", email_masked: "gu***@example.com", pending_review: null, requests: [] }).route);
  await screen.findByRole("heading", { name: "行程" });
  await waitFor(() => assert.ok(calls.some((call) => call.path.endsWith("/view-link"))));
  await waitFor(() => assert.equal(screen.queryByRole("heading", { name: "官网订单链接" }), null));
  resetBrowser();
  open("operations", routesOf({ available: false, unavailable_reason: "PASSENGER_ANONYMIZED", email_masked: null, pending_review: null, requests: [] }).route);
  const card = await section();
  assert.ok(within(card).getByText(/已按隐私规则清除/));
  assert.equal(within(card).queryByRole("button", { name: "重发订单链接" }), null);
});

test("没有下单邮箱：对话框里只能选「发到核实后的新邮箱」，按钮是「提交审核」", async () => {
  const { route, posted } = routesOf({ available: false, unavailable_reason: "NO_EMAIL_ON_FILE", email_masked: null, pending_review: null, requests: [] }, () => json(202, { request: pendingRequest, approval: { id: pendingRequest.approval_id, status: "pending" } }));
  open("customer_service", route);
  await user().click(within(await section()).getByRole("button", { name: "重发订单链接" }));
  const dialog = await screen.findByRole("dialog", { name: "重发官网订单链接" });
  assert.equal(within(dialog).queryByRole("radio", { name: /发到下单邮箱/ }), null);
  assert.ok(within(dialog).getByRole("button", { name: "提交审核" }));
  await user().type(within(dialog).getByRole("textbox", { name: /^核实后的新邮箱/ }), "fixed.guest@example.com");
  await user().selectOptions(within(dialog).getByLabelText(/怎么核实的/), "callback_phone");
  await user().type(within(dialog).getByRole("textbox", { name: /原因/ }), "回拨下单电话确认");
  await user().click(within(dialog).getByRole("button", { name: "提交审核" }));
  await waitFor(() => assert.deepEqual(posted, [{ target: "new_email", email: "fixed.guest@example.com", verification: "callback_phone", reason: "回拨下单电话确认" }]));
  await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
  assert.equal(document.body.textContent?.includes("fixed.guest@example.com"), false, "提交后页面上只有打码地址");
});

test("在等审核：显示打码地址和「去待审核」；再发起发到新邮箱时后端 409 的原话显示在对话框里；429 提示一小时 5 次", async () => {
  let answer: Response = apiError(409, "VIEW_LINK_REVIEW_PENDING", "这张单已经有一条「发到新邮箱」在等审核，请先处理那一条");
  const { route } = routesOf({ ...available, pending_review: pendingRequest, requests: [pendingRequest] }, () => answer);
  open("customer_service", route);
  const card = await section();
  assert.ok(within(card).getByText(/发到新邮箱 ne\*\*\*@example\.com 在等另一位同事批准/));
  assert.ok(within(card).getByRole("link", { name: "去待审核" }));
  await user().click(within(card).getByRole("button", { name: "重发订单链接" }));
  let dialog = await screen.findByRole("dialog", { name: "重发官网订单链接" });
  await user().click(within(dialog).getByRole("radio", { name: /发到核实后的新邮箱/ }));
  await user().type(within(dialog).getByRole("textbox", { name: /^核实后的新邮箱/ }), "second@example.com");
  await user().selectOptions(within(dialog).getByLabelText(/怎么核实的/), "other");
  await user().type(within(dialog).getByRole("textbox", { name: /原因/ }), "再试一次");
  await user().click(within(dialog).getByRole("button", { name: "提交审核" }));
  assert.ok(await within(dialog).findByText("这张单已经有一条「发到新邮箱」在等审核，请先处理那一条"));
  answer = apiError(429, "RATE_LIMITED", "请求过于频繁，请稍后再试", { retry_after_seconds: 1200 }, { "retry-after": "1200" });
  await user().click(within(dialog).getByRole("radio", { name: /发到下单邮箱/ }));
  await user().click(within(dialog).getByRole("button", { name: "发送" }));
  dialog = await screen.findByRole("dialog", { name: "重发官网订单链接" });
  assert.ok(await within(dialog).findByText("这张单这一小时已经重发了 5 次，请稍后再试。"));
});
