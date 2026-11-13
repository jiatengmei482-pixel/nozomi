/**
 * 取消、改单、事后加收、取消政策页面的组件测试（M3-03，ADR 0029）：
 * 运营后台的取消政策（看、改了提交审核、提交前按同一套规则校验）、订单详情（代取消先看试算、多退给客人的提交审核；审核加收、部分通过；只有财务能重试退款）；
 * 供应商订单详情（确认改期、提交加收并上传票据、看不到客人付多少）。接口用测试替身；真实后端由集成测试和端到端测试覆盖。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { DEFAULT_CANCELLATION_POLICY } from "@nozomi/domain";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { TenantOrder, TenantOrderDetail } from "../../api/dispatch.ts";
import type { ExtraCharge, OrderChange, PlatformExtraCharge, PlatformOrder, PlatformOrderDetail, PlatformPayment } from "../../api/order-money.ts";
import { type ApiCall, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";
import { NOT_DISPATCHED, NO_RECORDS } from "../../testing/order-center-fixtures.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-10-06T00:12:00.000Z", updated_at: "2026-10-08T05:30:00.000Z" };
const ORDER_ID = "0a0a0a0a-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CHARGE_ID = "c1c1c1c1-cccc-4ccc-8ccc-cccccccccccc";
const CHANGE_ID = "c2c2c2c2-cccc-4ccc-8ccc-cccccccccccc";
const REFUND_ID = "f9f9f9f9-ffff-4fff-8fff-ffffffffffff";
const FILE_ID = "fafafafa-ffff-4fff-8fff-ffffffffffff";

const policy = { version: 0, effective_at: null, rules: DEFAULT_CANCELLATION_POLICY.map((rule) => ({ category: rule.category, level: rule.level, tiers: rule.tiers.map((tier) => ({ min_hours_before: tier.minHoursBefore, fee_bp: tier.feeBp })) })) };
const businessTiers = [{ min_hours_before: 48, fee_bp: 0 }, { min_hours_before: 24, fee_bp: 5000 }, { min_hours_before: 0, fee_bp: 10000 }];
const money = (amount: string) => ({ amount, currency: "JPY" });

const tenantMe = (role: string) => json(200, { user: { id: "u1", email: "user@supplier.example", name: "测试用户", role, status: "active", ...stamps }, tenant: { id: "t1", name: "测试用供应商", status: "active", ...stamps }, permissions: [], must_change_password: false });
const platformMe = (role: string) => json(200, { user: { id: "p1", email: "staff@platform.example", name: "测试员工", role, status: "active", ...stamps }, permissions: [], must_change_password: false });

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;

function open(path: string, role: string, routes: Route, portal: "tenant" | "platform"): ApiCall[] {
  signIn(portal, "the-token");
  const calls = stubApiWith((call) => {
    const custom = routes(call);
    if (custom !== null) return custom;
    if (call.method === "GET" && call.url.pathname === "/tenant/v1/auth/me") return tenantMe(role);
    if (call.method === "GET" && call.url.pathname === "/platform/v1/auth/me") return platformMe(role);
    return null;
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

const user = () => userEvent.setup();

const platformOrder = (changes: Partial<PlatformOrder> = {}): PlatformOrder => ({
  ...NOT_DISPATCHED,
  addons: [],
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
  ...changes,
});

const extraOf = (changes: Partial<PlatformExtraCharge> = {}): PlatformExtraCharge => ({
  id: CHARGE_ID,
  type: "waiting",
  amount: money("10000"),
  approved_amount: null,
  description: "等了 2 小时",
  file_ids: [],
  status: "review",
  review_reasons: ["OVER_THRESHOLD"],
  submitted_at: stamps.created_at,
  dispute_until: "2026-10-08T00:12:00.000Z",
  disputed_at: null,
  dispute_reason: null,
  decided_at: null,
  decision_note: null,
  charged_at: null,
  withdrawn_at: null,
  version: 1,
  customer_amount: money("11000"),
  last_charge_error: null,
  charge_attempts: 0,
  ...changes,
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

test("取消政策：任何能看订单的角色都能看（15 条阶梯按品类分组）；运营改了提交审核，不立即生效；提交前按同一套规则校验", async () => {
  let posted: unknown = null;
  const calls = open("/platform/cancellation-policy", "operations", (call) => {
    if (call.method === "GET" && call.url.pathname === "/platform/v1/cancellation-policy") return json(200, { policy });
    if (call.method === "POST" && call.url.pathname === "/platform/v1/cancellation-policy/changes") {
      posted = call.body;
      return json(202, { approval: { id: "ap1" } });
    }
    return null;
  }, "platform");
  await screen.findByRole("heading", { level: 1, name: "平台统一取消政策" });
  const transfer = await screen.findByRole("region", { name: "接送机" });
  assert.match(transfer.textContent ?? "", /经济：用车前 ≥ 24 小时 免费；6–24 小时 扣 50%；< 6 小时 扣 100%/);
  assert.match(transfer.textContent ?? "", /商务：用车前 ≥ 48 小时 免费；24–48 小时 扣 50%；< 24 小时 扣 100%/);
  assert.match(screen.getByRole("region", { name: "包车" }).textContent ?? "", /中巴（10 座及以上）：用车前 ≥ 48 小时 免费/);
  assert.ok(screen.getByText(/现在用的是需求里的默认政策/));
  await user().click(screen.getByRole("button", { name: "修改政策" }));
  const firstFee = screen.getAllByLabelText("第 2 档：扣对外价（%）")[0] as HTMLInputElement;
  fireEvent.change(firstFee, { target: { value: "120" } });
  await user().click(screen.getByRole("button", { name: "提交审核" }));
  assert.ok(await screen.findByText(/有格子写得不对/));
  fireEvent.change(firstFee, { target: { value: "0" } });
  fireEvent.change(screen.getAllByLabelText("第 1 档：扣对外价（%）")[0] as HTMLInputElement, { target: { value: "10" } });
  await user().click(screen.getByRole("button", { name: "提交审核" }));
  assert.ok(await screen.findByText(/接送机 · 经济：越接近用车扣得越多/), "第 2 档比第 1 档扣得少：拦下，不发请求");
  assert.equal(calls.filter((call) => call.method === "POST").length, 0);
  fireEvent.change(firstFee, { target: { value: "30" } });
  await user().click(screen.getByRole("button", { name: "提交审核" }));
  await waitFor(() => assert.ok(posted !== null));
  const sent = posted as { rules: { category: string; level: string; tiers: { min_hours_before: number; fee_bp: number }[] }[] };
  assert.equal(sent.rules.length, 15);
  assert.deepEqual(sent.rules.find((rule) => rule.category === "airport_transfer" && rule.level === "economy")?.tiers, [{ min_hours_before: 24, fee_bp: 1000 }, { min_hours_before: 6, fee_bp: 3000 }, { min_hours_before: 0, fee_bp: 10000 }]);
  assert.ok(await screen.findByText("已提交，等另一位同事审核后生效"));
});

test("订单详情（运营后台）：代取消先看试算；选了免费的原因、退得比政策多 → 按钮是「提交审核」，提交后提示去待审核；必须写原因说明", async () => {
  const calls = open(`/platform/orders/${ORDER_ID}`, "operations", (call) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}`) return json(200, platformDetail(platformOrder()));
    if (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}/cancel-fee`) {
      const free = call.url.searchParams.get("reason") === "FORCE_MAJEURE";
      return json(200, { cancellable: true, stage: "paid", reason: call.url.searchParams.get("reason"), tier_index: 1, hours_before_service: 30, fee_bp: free ? 0 : 5000, paid: money("21780"), fee: money(free ? "0" : "10890"), refund: money(free ? "21780" : "10890"), policy: platformOrder().cancel_policy, policy_fee_bp: 5000, policy_refund: money("10890"), tenant_share: money(free ? "0" : "9900"), needs_review: free });
    }
    if (call.method === "POST" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}/cancel`) return json(202, { approval: { id: "ap1" } });
    return null;
  }, "platform");
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  assert.match(document.body.textContent ?? "", /第 0 版 · 商务：用车前 ≥ 48 小时 免费；24–48 小时 扣 50%；< 24 小时 扣 100%/);
  await user().click(screen.getByRole("button", { name: "代客人取消" }));
  const dialog = await screen.findByRole("dialog", { name: "代客人取消" });
  await waitFor(() => assert.match(dialog.textContent ?? "", /退给客人10,890 JPY/));
  assert.match(dialog.textContent ?? "", /供应商应得9,900 JPY/);
  await user().selectOptions(within(dialog).getByLabelText("取消原因"), "FORCE_MAJEURE");
  await waitFor(() => assert.match(dialog.textContent ?? "", /退给客人21,780 JPY/));
  assert.ok(within(dialog).getByText(/提交后要另一位有权限的同事/));
  await user().click(within(dialog).getByRole("button", { name: "提交审核" }));
  assert.ok(await within(dialog).findByText(/请写明原因/));
  await user().type(within(dialog).getByLabelText("原因说明"), "台风，机场关闭");
  await user().click(within(dialog).getByRole("button", { name: "提交审核" }));
  assert.ok(await screen.findByText(/已提交到「待审核」/));
  const post = calls.find((call) => call.method === "POST");
  assert.deepEqual(post?.body, { reason: "FORCE_MAJEURE", waive_fee: false, note: "台风，机场关闭" });
});

test("订单详情（运营后台）：包车的行程写「包车 N 小时 · 上车：地址」，不写「→ —」；收款记录的状态写中文", async () => {
  const charter = platformOrder({ status: "cancelled", category: "charter", direction: null, flight_no: null, package_hours: 8, pickup: { lng: 139.76, lat: 35.68, address: "东京站" }, dropoff: null });
  const payment = (id: string, status: PlatformPayment["status"]): PlatformPayment => ({ id, kind: "order", change_id: null, extra_charge_id: null, provider: "stripe", status, amount: money("66000"), intent_id: null, customer_id: null, payment_method_saved: false, refunded: money("0"), disputed: false, paid_after_cancel: false, last_error: null, save_consent_at: stamps.created_at, succeeded_at: null });
  const detail = platformDetail(charter, { payments: [payment("p1", "creating"), payment("p2", "canceled")] });
  open(`/platform/orders/${ORDER_ID}`, "operations", (call) => (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}` ? json(200, detail) : null), "platform");
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  assert.ok(screen.getByText("包车 8 小时 · 上车：东京站"));
  assert.doesNotMatch(document.body.textContent ?? "", /→ —/);
  const payments = screen.getByRole("heading", { name: "收款与退款" }).closest("section")?.textContent ?? "";
  assert.match(payments, /66,000 JPY · 正在建付款/);
  assert.match(payments, /66,000 JPY · 已作废（没有付款）/);
  assert.doesNotMatch(payments, /creating|canceled/);
});

test("订单详情（运营后台）：还没付款的单没有「新建工单」，付过款的有", async () => {
  open(`/platform/orders/${ORDER_ID}`, "customer_service", (call) => (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}` ? json(200, platformDetail(platformOrder({ status: "pending_payment", confirmed_at: null }))) : null), "platform");
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  assert.ok(screen.getByRole("heading", { name: "工单" }));
  assert.equal(screen.queryByRole("link", { name: "新建工单" }), null);
  resetBrowser();
  open(`/platform/orders/${ORDER_ID}`, "customer_service", (call) => (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}` ? json(200, platformDetail(platformOrder())) : null), "platform");
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  assert.ok(screen.getByRole("link", { name: "新建工单" }));
});

test("订单详情（运营后台）：没付款就取消的单，取消原因写「客人取消了订单」，不写「按取消政策扣款」；付过款的照旧", async () => {
  const unpaid = platformOrder({ status: "cancelled", confirmed_at: null, cancel_reason: "GUEST_REQUEST", cancellation: { reason: "GUEST_REQUEST", note: null, fee_bp: null, customer_fee: null, tenant_share: null } });
  open(`/platform/orders/${ORDER_ID}`, "operations", (call) => (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}` ? json(200, platformDetail(unpaid, { events: [{ from_status: "pending_payment", to_status: "cancelled", actor: "platform_user", reason: "GUEST_REQUEST", occurred_at: stamps.created_at, source: null, recorded_at: null }] })) : null), "platform");
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  assert.ok(screen.getAllByText(/客人取消了订单/).length >= 1);
  assert.doesNotMatch(document.body.textContent ?? "", /按取消政策扣款/);
  resetBrowser();
  const paid = platformOrder({ status: "cancelled", cancel_reason: "GUEST_REQUEST", cancellation: { reason: "GUEST_REQUEST", note: null, fee_bp: 5000, customer_fee: money("10890"), tenant_share: money("9900") } });
  open(`/platform/orders/${ORDER_ID}`, "operations", (call) => (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}` ? json(200, platformDetail(paid)) : null), "platform");
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  assert.ok(screen.getByText("客人取消（按取消政策扣款）"));
});

test("订单详情（运营后台）：审核加收可以部分通过；客服看不到「重试退款」（只有财务、运营能重试）；只读看不到代取消和审核", async () => {
  let decided: unknown = null;
  const detail = platformDetail(platformOrder({ status: "completed" }), {
    extra_charges: [extraOf()],
    refunds: [{ id: REFUND_ID, payment_id: "pay1", purpose: "cancellation", change_id: null, amount: money("100"), status: "failed", provider_refund_id: null, retry_of: null, attempts: 5, next_attempt_at: null, last_error: { code: "expired_or_canceled_card" }, succeeded_at: null, failed_at: stamps.updated_at, superseded_at: null, created_at: stamps.created_at }],
  });
  open(`/platform/orders/${ORDER_ID}`, "customer_service", (call) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}`) return json(200, detail);
    if (call.method === "POST" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}/extra-charges/${CHARGE_ID}/decide`) {
      decided = call.body;
      return json(200, { extra_charge: { ...extraOf(), status: "charged", approved_amount: money("6000") } });
    }
    return null;
  }, "platform");
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  const table = screen.getByRole("table", { name: "事后加收" });
  assert.match(table.textContent ?? "", /付费等待10,000 JPY \/ 11,000 JPY/);
  assert.match(table.textContent ?? "", /超过对外价 50%/);
  assert.equal(screen.queryByRole("button", { name: "重试退款" }), null, "客服不能重试退款");
  await user().click(within(table).getByRole("button", { name: "审核" }));
  const dialog = await screen.findByRole("dialog", { name: "审核加收：付费等待" });
  assert.match(dialog.textContent ?? "", /客人要付11,000 JPY/);
  await user().type(within(dialog).getByLabelText(/部分通过的金额/), "6,000");
  await user().type(within(dialog).getByLabelText("说明"), "按 1 小时算");
  await user().click(within(dialog).getByRole("button", { name: "通过" }));
  await waitFor(() => assert.deepEqual(decided, { decision: "approve", approved_amount: 6000, note: "按 1 小时算" }));
  assert.ok(await screen.findByText("已通过，已从客人保存的卡上扣款"));

  resetBrowser();
  open(`/platform/orders/${ORDER_ID}`, "finance", (call) => (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}` ? json(200, detail) : null), "platform");
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  assert.ok(screen.getByRole("button", { name: "重试退款" }), "财务能重试失败的退款");
  assert.equal(screen.queryByRole("button", { name: "审核" }), null, "财务不审核加收");

  // 已并入取消退款（作废）的失败退款：不再给「重试退款」，写明原因
  resetBrowser();
  const superseded = { ...detail, refunds: detail.refunds.map((refund) => ({ ...refund, superseded_at: stamps.updated_at })) };
  open(`/platform/orders/${ORDER_ID}`, "finance", (call) => (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}` ? json(200, superseded) : null), "platform");
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  assert.equal(screen.queryByRole("button", { name: "重试退款" }), null, "作废的退款不能重试");
  assert.ok(screen.getByText("已并入取消退款，不再重试"));

  resetBrowser();
  open(`/platform/orders/${ORDER_ID}`, "readonly", (call) => (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}` ? json(200, platformDetail(platformOrder())) : null), "platform");
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  assert.equal(screen.queryByRole("button", { name: "代客人取消" }), null);
  assert.equal(screen.queryByRole("button", { name: "代客人改单" }), null);
});

const tenantOrder = (changes: Partial<TenantOrder> = {}): TenantOrder => ({
  id: ORDER_ID,
  pending_change: false,
  order_no: "NZ20261007ABCDEFGH",
  status: "completed",
  category: "airport_transfer",
  city_id: "c1",
  place_id: "p1",
  direction: "pickup",
  vehicle_group_id: "g1",
  package_hours: null,
  service_time: "2026-10-20T01:00:00.000Z",
  service_local: "2026-10-20T10:00",
  timezone: "Asia/Tokyo",
  service_date: "2026-10-20",
  urgent: false,
  passengers: 2,
  luggage: 1,
  pickup: null,
  dropoff: { lng: 139.76, lat: 35.68, address: "东京站八重洲口" },
  addons: [],
  driver_language: null,
  flight_no: "NH211",
  passenger: { name: "王小明", phone: "+819012345678", email: "guest@example.com" },
  messaging: null,
  notes: null,
  free_wait_minutes: 90,
  created_at: stamps.created_at,
  confirmed_at: stamps.created_at,
  cancelled_at: null,
  cancel_reason: null,
  product_id: "pr1",
  product_version: 1,
  settlement: { total: money("19800"), base: money("19800"), adjust: money("0"), urgent: money("0"), night: money("0"), addons: money("0"), driver_language: money("0") },
  dispatch: { due_at: null, overdue: false, overdue_at: null, escalation_at: null, departure_due_at: null, departure_overdue_at: null, assigned_at: null, driver: null, vehicle: null },
  fulfilment: { departed_at: null, arrived_at: null, arrival_distance_m: null, arrival_within_range: null, picked_up_at: null, completed_at: "2026-10-20T03:00:00.000Z", actual_minutes: null, actual_km: null, leave_requested_at: null },
  landing: null,
  cancel_policy: { version: 0, category: "airport_transfer", level: "business", tiers: businessTiers },
  cancellation: null,
  version: 5,
  ...changes,
});

const tenantDetail = (order: TenantOrder, changes: OrderChange[] = [], extra: ExtraCharge[] = []): TenantOrderDetail => ({ driver_link_email: { state: "no_link", recipient_masked: null, error_code: null, error_message: null, requested_at: null, sent_at: null, address_changed: false, can_resend: false },
  order,
  events: [],
  records: { assignments: [], driver_link: null, files: [], contacts: [], locations: [], no_show_claim: null },
  changes,
  extra_charges: extra,
  rescue: null,
});

test("供应商订单详情：等确认的改期写出改前改后和截止时间，调度能确认；取消的单只写扣款比例和自己应得的", async () => {
  const change: OrderChange = { adjusting_at: null, decided_by_platform: false, id: CHANGE_ID, status: "pending_confirmation", reschedule: true, before: { service_time: "2026-10-20T01:00:00.000Z", service_local: "2026-10-20T10:00" }, after: { service_time: "2026-10-21T01:00:00.000Z", service_local: "2026-10-21T10:00" }, settlement_before: money("19800"), settlement_after: money("23760"), confirm_due_at: "2026-10-19T00:30:00.000Z", requested_by: "channel", requested_at: "2026-10-19T00:00:00.000Z", decided_at: null, decision_note: null, dispatch_conflict: false };
  let confirmed = false;
  open(`/orders/${ORDER_ID}`, "dispatch", (call) => {
    if (call.method === "GET" && call.url.pathname === `/tenant/v1/orders/${ORDER_ID}`) return json(200, tenantDetail(tenantOrder({ status: "confirmed" }), [confirmed ? { ...change, status: "applied" } : change]));
    if (call.method === "POST" && call.url.pathname === `/tenant/v1/orders/${ORDER_ID}/changes/${CHANGE_ID}/confirm`) {
      confirmed = true;
      return json(200, { change: { ...change, status: "applied" } });
    }
    return null;
  }, "tenant");
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  const section = screen.getByRole("heading", { name: "修改记录" }).closest("section") as HTMLElement;
  assert.match(section.textContent ?? "", /用车时间：.*→.*；结算价 19,800 JPY → 23,760 JPY/);
  assert.match(section.textContent ?? "", /请在 .* 之前处理/);
  await user().click(within(section).getByRole("button", { name: "同意" }));
  assert.ok(await screen.findByText("已同意，订单已更新"));
  await waitFor(() => assert.match(section.textContent ?? "", /已生效/));

  resetBrowser();
  open(`/orders/${ORDER_ID}`, "readonly", (call) => (call.method === "GET" && call.url.pathname === `/tenant/v1/orders/${ORDER_ID}` ? json(200, tenantDetail(tenantOrder({ status: "cancelled", cancel_reason: "GUEST_REQUEST", cancellation: { fee_bp: 5000, tenant_share: money("9900") } }))) : null), "tenant");
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  const rules = screen.getByRole("heading", { name: "取消规则" }).closest("section") as HTMLElement;
  assert.match(rules.textContent ?? "", /商务：用车前 ≥ 48 小时 免费/);
  assert.match(rules.textContent ?? "", /你应得9,900 JPY（结算价 × 50%）/);
  assert.doesNotMatch(document.body.textContent ?? "", /对外价|退给客人|21,780/);
});

test("供应商订单详情：调整中只能标一次；拒绝要写原因且说明不给客人看；已派司机突出「需调整司机」，没邮箱提示调度员自己联系；只读角色没有按钮", async () => {
  const change: OrderChange = { adjusting_at: null, decided_by_platform: false, id: CHANGE_ID, status: "pending_confirmation", reschedule: false, before: { passengers: 2 }, after: { passengers: 3 }, settlement_before: money("19800"), settlement_after: money("19800"), confirm_due_at: "2026-10-20T01:00:00.000Z", requested_by: "channel", requested_at: stamps.updated_at, decided_at: null, decision_note: null, dispatch_conflict: false };
  let current = change;
  const order = tenantOrder({ status: "assigned", pending_change: true, dispatch: { ...tenantOrder().dispatch, driver: { id: "d", name: "佐藤一郎" } as never } });
  const decided: unknown[] = [];
  open(`/orders/${ORDER_ID}`, "dispatch", (call) => {
    if (call.method === "GET" && call.url.pathname === `/tenant/v1/orders/${ORDER_ID}`) return json(200, { ...tenantDetail(order, [current]), driver_link_email: { state: "no_email", recipient_masked: null, error_code: null, error_message: null, requested_at: null, sent_at: null, address_changed: false, can_resend: false } });
    if (call.method === "POST" && call.url.pathname.endsWith("/adjusting")) {
      current = { ...change, status: "adjusting" };
      return json(200, { change: current });
    }
    if (call.method === "POST" && call.url.pathname.endsWith("/reject")) {
      decided.push(call.body);
      current = { ...change, status: "rejected" };
      return json(200, { change: current });
    }
    return null;
  }, "tenant");
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  assert.ok(screen.getByText(/^修改待确认：/));
  const section = screen.getByRole("heading", { name: "修改记录" }).closest("section") as HTMLElement;
  assert.match(section.textContent ?? "", /需调整司机：这位司机没有邮箱/);
  await user().click(within(section).getByRole("button", { name: "调整中" }));
  await waitFor(() => assert.match(section.textContent ?? "", /调整中 人数：2 → 3/));
  assert.equal(within(section).queryByRole("button", { name: "调整中" }), null, "只能标一次");
  await user().click(within(section).getByRole("button", { name: "拒绝" }));
  const dialog = await screen.findByRole("dialog");
  assert.match(dialog.textContent ?? "", /不会给客人看/);
  await user().click(within(dialog).getByRole("button", { name: "确认拒绝" }));
  assert.ok(await within(dialog).findByText("请写拒绝原因"));
  assert.deepEqual(decided, [], "没写原因不发请求");
  await user().type(within(dialog).getByRole("textbox", { name: /拒绝原因/ }), "那天车都派出去了");
  await user().click(within(dialog).getByRole("button", { name: "确认拒绝" }));
  await waitFor(() => assert.deepEqual(decided, [{ note: "那天车都派出去了" }]));

  resetBrowser();
  current = change;
  open(`/orders/${ORDER_ID}`, "readonly", (call) => (call.method === "GET" && call.url.pathname === `/tenant/v1/orders/${ORDER_ID}` ? json(200, tenantDetail(order, [change])) : null), "tenant");
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  assert.equal(screen.queryByRole("button", { name: "同意" }), null);
  assert.equal(screen.queryByRole("button", { name: "拒绝" }), null);
});

test("供应商首页和菜单：待办和角标；要决定的没有「知道了」；已经发生的点了就消失；没有待办不显示", async () => {
  const base = { order_status: "assigned", order_no: "NZ20261007ABCDEFGH", order_id: ORDER_ID, service_local: "2026-10-20T10:00", timezone: "Asia/Tokyo", created_at: stamps.updated_at };
  const request = { ...base, id: "11111111-1111-4111-8111-111111111111", kind: "change_request", change_id: CHANGE_ID, change_status: "pending_confirmation", fields: ["service_time"], needs_driver_adjustment: true, driver_name: "佐藤一郎", driver_notice: "manual", confirm_due_at: "2026-10-20T01:00:00.000Z" };
  const cancelled = { ...base, id: "22222222-2222-4222-8222-222222222222", kind: "order_cancelled", change_id: null, change_status: null, fields: [], needs_driver_adjustment: true, driver_name: "佐藤一郎", driver_notice: "email", confirm_due_at: null };
  let items = [request, cancelled];
  const acked: string[] = [];
  open("/", "dispatch", (call) => {
    if (call.method === "GET" && call.url.pathname === "/tenant/v1/order-todos") return json(200, { total: items.length, change_requests: 1, items });
    if (call.method === "POST" && call.url.pathname.endsWith("/ack")) {
      acked.push(call.url.pathname);
      items = [request];
      return json(200, { ok: true });
    }
    return null;
  }, "tenant");
  const title = await screen.findByRole("heading", { name: "订单待办（2）" });
  const section = title.closest("section") as HTMLElement;
  assert.match(section.textContent ?? "", /客人申请修改，等你处理（用车时间）/);
  assert.match(section.textContent ?? "", /设置了手动发送.*请马上联系他/);
  assert.match(section.textContent ?? "", /订单已取消/);
  assert.ok((await screen.findAllByLabelText("2 条待办")).length > 0, "菜单角标");
  const buttons = within(section).getAllByRole("button", { name: "知道了" });
  assert.equal(buttons.length, 1, "要决定的不能只点知道了");
  await user().click(buttons[0] as HTMLElement);
  await waitFor(() => assert.equal(acked.length, 1));
  assert.ok(await screen.findByRole("heading", { name: "订单待办（1）" }));
});

test("运营后台：有 order.change_decide 才能代处理，原因必填；客服看不到按钮", async () => {
  const change = { adjusting_at: null, decided_by_platform: false, id: CHANGE_ID, status: "pending_confirmation", reschedule: false, before: { passengers: 2 }, after: { passengers: 3 }, settlement_before: money("19800"), settlement_after: money("19800"), sell_before: null, sell_after: null, confirm_due_at: "2026-10-20T01:00:00.000Z", requested_by: "channel", requested_at: stamps.updated_at, decided_at: null, decision_note: null, dispatch_conflict: false };
  const posted: unknown[] = [];
  const handler: Route = (call) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}`) return json(200, platformDetail(platformOrder(), { changes: [change] as PlatformOrderDetail["changes"] }));
    if (call.method === "POST" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}/changes/${CHANGE_ID}/confirm`) {
      posted.push(call.body);
      return json(200, { change: { ...change, status: "applied", decided_by_platform: true } });
    }
    return null;
  };
  open(`/platform/orders/${ORDER_ID}`, "operations", handler, "platform");
  await user().click(await screen.findByRole("button", { name: "代同意" }));
  const dialog = await screen.findByRole("dialog");
  await user().click(within(dialog).getByRole("button", { name: "确认" }));
  assert.ok(await within(dialog).findByText(/请写原因/));
  assert.deepEqual(posted, []);
  await user().type(within(dialog).getByRole("textbox", { name: /原因/ }), "电话联系过供应商");
  await user().click(within(dialog).getByRole("button", { name: "确认" }));
  await waitFor(() => assert.deepEqual(posted, [{ note: "电话联系过供应商" }]));

  resetBrowser();
  open(`/platform/orders/${ORDER_ID}`, "customer_service", handler, "platform");
  await screen.findByRole("heading", { name: "改单" });
  assert.equal(screen.queryByRole("button", { name: "代同意" }), null);
});

test("供应商订单详情：已完成的单能提交加收（接送机只有等待、加停靠点、加附加服务），先传票据再提交；异议期内能撤回；只读角色没有按钮", async () => {
  let submitted: unknown = null;
  const charge: ExtraCharge = { ...extraOf({ status: "in_window", amount: money("2000"), review_reasons: [] }) };
  const calls = open(`/orders/${ORDER_ID}`, "dispatch", (call) => {
    if (call.method === "GET" && call.url.pathname === `/tenant/v1/orders/${ORDER_ID}`) return json(200, tenantDetail(tenantOrder(), [], submitted === null ? [] : [charge]));
    if (call.method === "POST" && call.url.pathname === `/tenant/v1/orders/${ORDER_ID}/files`) return json(201, { file: { id: FILE_ID, kind: "receipt", content_type: "image/jpeg", byte_size: 4, uploaded_at: stamps.updated_at } });
    if (call.method === "POST" && call.url.pathname === `/tenant/v1/orders/${ORDER_ID}/extra-charges`) {
      submitted = call.body;
      return json(201, { extra_charge: charge });
    }
    if (call.method === "POST" && call.url.pathname === `/tenant/v1/orders/${ORDER_ID}/extra-charges/${CHARGE_ID}/withdraw`) return json(200, { extra_charge: { ...charge, status: "withdrawn" } });
    return null;
  }, "tenant");
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  await user().click(screen.getByRole("button", { name: "提交加收" }));
  const dialog = await screen.findByRole("dialog", { name: "提交事后加收" });
  const types = [...(within(dialog).getByLabelText("类型") as HTMLSelectElement).options].map((option) => option.textContent);
  assert.deepEqual(types, ["付费等待", "现场加停靠点", "现场加附加服务"], "接送机是一口价：没有超时、超公里、高速、停车");
  await user().click(within(dialog).getByRole("button", { name: "提交" }));
  assert.ok(await within(dialog).findByText(/金额写成大于 0 的数/));
  await user().type(within(dialog).getByLabelText(/金额/), "2,000");
  await user().upload(within(dialog).getByLabelText("票据照片"), new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0])], "停车票.jpg", { type: "image/jpeg" }));
  await waitFor(() => assert.match(dialog.textContent ?? "", /已上传：停车票\.jpg/));
  const upload = calls.find((call) => call.method === "POST" && call.path.includes("/files"));
  assert.ok(upload?.path.endsWith("?kind=receipt"));
  await user().click(within(dialog).getByRole("button", { name: "提交" }));
  await waitFor(() => assert.deepEqual(submitted, { type: "waiting", amount: 2000, description: null, file_ids: [FILE_ID] }));
  assert.ok(await screen.findByText(/已提交：客人有 48 小时异议期/));
  const section = screen.getByRole("heading", { name: "事后加收" }).closest("section") as HTMLElement;
  await waitFor(() => assert.match(section.textContent ?? "", /异议期内 付费等待 2,000 JPY/));
  await user().click(within(section).getByRole("button", { name: "撤回" }));
  assert.ok(await screen.findByText("已撤回"));
  assert.doesNotMatch(document.body.textContent ?? "", /11,000|客人要付/);

  resetBrowser();
  open(`/orders/${ORDER_ID}`, "readonly", (call) => (call.method === "GET" && call.url.pathname === `/tenant/v1/orders/${ORDER_ID}` ? json(200, tenantDetail(tenantOrder(), [], [charge])) : null), "tenant");
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  assert.equal(screen.queryByRole("button", { name: "提交加收" }), null);
  assert.equal(screen.queryByRole("button", { name: "撤回" }), null);
});

test("供应商订单详情：包车一口价全含（M8-09）——分界后下的包车单加收类型没有高速费、停车费，写明不能另收；分界前下的照旧有，并提示必须附票据", async () => {
  const charterOrder = (createdAt: string): TenantOrder => tenantOrder({ category: "charter", place_id: null, direction: null, flight_no: null, package_hours: 8, created_at: createdAt, cancel_policy: { version: 0, category: "charter", level: "business", tiers: businessTiers } });
  const typesOf = async (createdAt: string): Promise<{ types: (string | null)[]; text: string }> => {
    open(`/orders/${ORDER_ID}`, "dispatch", (call) => (call.method === "GET" && call.url.pathname === `/tenant/v1/orders/${ORDER_ID}` ? json(200, tenantDetail(charterOrder(createdAt))) : null), "tenant");
    await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
    await user().click(screen.getByRole("button", { name: "提交加收" }));
    const dialog = await screen.findByRole("dialog", { name: "提交事后加收" });
    const types = [...(within(dialog).getByLabelText("类型") as HTMLSelectElement).options].map((option) => option.textContent);
    const text = dialog.textContent ?? "";
    resetBrowser();
    return { types, text };
  };
  const after = await typesOf("2026-11-09T15:00:00.000Z");
  assert.deepEqual(after.types, ["包车超时", "包车超公里", "付费等待", "现场加停靠点", "现场加附加服务"]);
  assert.match(after.text, /包车一口价已含高速费、停车费，不能另收/);
  assert.doesNotMatch(after.text, /高速费、停车费必须附|凭票实报/);
  const before = await typesOf("2026-11-09T14:59:59.999Z");
  assert.deepEqual(before.types, ["包车超时", "包车超公里", "付费等待", "现场加停靠点", "现场加附加服务", "高速费（凭票实报）", "停车费（凭票实报）"]);
  assert.match(before.text, /高速费、停车费必须附/);
  assert.doesNotMatch(before.text, /不能另收/);
});

test("运营后台：官网订单链接——客服核实后重发到下单邮箱（核实方式、原因必填）；发到新邮箱提交审核；只读看得到记录、没有按钮；不是官网的单不显示", async () => {
  const request = (extra: Record<string, unknown>) => ({ id: "d1d1d1d1-dddd-4ddd-8ddd-dddddddddddd", target: "original", email_masked: "gu***@example.com", verification: "callback_phone", status: "queued", approval_id: null, requested_by: { id: "p1", name: "测试员工" }, created_at: stamps.updated_at, decided_at: null, ...extra });
  let status: Record<string, unknown> = { available: true, unavailable_reason: null, email_masked: "gu***@example.com", pending_review: null, requests: [] };
  const posted: unknown[] = [];
  const handler: Route = (call) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}`) return json(200, platformDetail(platformOrder()));
    if (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}/view-link`) return json(200, status);
    if (call.method === "POST" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}/view-link/resend`) {
      posted.push(call.body);
      const body = call.body as { target: string };
      const created = request(body.target === "new_email" ? { target: "new_email", email_masked: "ne***@example.com", status: "pending_review", approval_id: "a1a1a1a1-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } : {});
      status = { ...status, requests: [created, ...(status["requests"] as unknown[])] };
      return json(202, { request: created, approval: body.target === "new_email" ? { id: "a1a1a1a1-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "pending" } : null });
    }
    return null;
  };
  open(`/platform/orders/${ORDER_ID}`, "customer_service", handler, "platform");
  const section = (await screen.findByRole("heading", { name: "官网订单链接" })).closest("section") as HTMLElement;
  assert.ok(within(section).getByText("gu***@example.com"));
  await user().click(within(section).getByRole("button", { name: "重发订单链接" }));
  let dialog = await screen.findByRole("dialog", { name: "重发官网订单链接" });
  await user().click(within(dialog).getByRole("button", { name: "发送" }));
  assert.ok(await within(dialog).findByText("请选怎么核实的客人身份"));
  assert.ok(within(dialog).getByText(/请写明为什么要重发/));
  assert.deepEqual(posted, []);
  await user().selectOptions(within(dialog).getByLabelText(/怎么核实的/), "callback_phone");
  await user().type(within(dialog).getByRole("textbox", { name: /原因/ }), "客人来电，回拨下单电话确认是本人");
  await user().click(within(dialog).getByRole("button", { name: "发送" }));
  await waitFor(() => assert.deepEqual(posted, [{ target: "original", verification: "callback_phone", reason: "客人来电，回拨下单电话确认是本人" }]));
  assert.ok(await within(section).findByRole("cell", { name: "已排进通知中心" }));

  await user().click(within(section).getByRole("button", { name: "重发订单链接" }));
  dialog = await screen.findByRole("dialog", { name: "重发官网订单链接" });
  await user().click(within(dialog).getByRole("radio", { name: /发到核实后的新邮箱/ }));
  await user().type(within(dialog).getByRole("textbox", { name: /^核实后的新邮箱/ }), "new.guest@example.com");
  await user().selectOptions(within(dialog).getByLabelText(/怎么核实的/), "payment_details");
  await user().type(within(dialog).getByRole("textbox", { name: /原因/ }), "邮箱写错一个字母，核对了卡号末 4 位");
  await user().click(within(dialog).getByRole("button", { name: "提交审核" }));
  await waitFor(() => assert.equal(posted.length, 2));
  assert.deepEqual(posted[1], { target: "new_email", email: "new.guest@example.com", verification: "payment_details", reason: "邮箱写错一个字母，核对了卡号末 4 位" });
  assert.ok(await screen.findByText(/要另一位同事在「待审核」里批准/));
  assert.equal(document.body.textContent?.includes("new.guest@example.com"), false, "提交后页面上只有打码后的地址");

  resetBrowser();
  open(`/platform/orders/${ORDER_ID}`, "readonly", handler, "platform");
  const readonly = (await screen.findByRole("heading", { name: "官网订单链接" })).closest("section") as HTMLElement;
  assert.equal(within(readonly).queryByRole("button", { name: "重发订单链接" }), null);

  resetBrowser();
  status = { available: false, unavailable_reason: "NOT_SITE_ORDER", email_masked: "gu***@example.com", pending_review: null, requests: [] };
  open(`/platform/orders/${ORDER_ID}`, "operations", handler, "platform");
  await screen.findByRole("heading", { name: "行程" });
  await waitFor(() => assert.equal(screen.queryByRole("heading", { name: "官网订单链接" }), null));
});

/** 「行程」卡片里某一项的值：按 <dt> 的文字找同一项的 <dd>（M7-03）。 */
function tripValue(label: string): HTMLElement | null {
  const card = screen.getByRole("heading", { name: "行程" }).closest("section") as HTMLElement;
  return (within(card).queryByText(label, { selector: "dt" })?.nextElementSibling ?? null) as HTMLElement | null;
}
const vehicleGroupOf = (sample_models: string[]) => ({ id: "55555555-5555-4555-8555-555555555555", code: "VG-BIZ-7", name: { zh: "商务七座" }, seats: 7, sample_models, combos: [{ passengers: 6, luggage: 4 }, { passengers: 5, luggage: 5 }] });

test("车型标识（M7-03）：运营后台订单详情的「行程」有车型和 4 项；没给车型组（null 或旧数据没有这一项）时不显示、页面照常", async () => {
  open(`/platform/orders/${ORDER_ID}`, "operations", (call) => (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}` ? json(200, platformDetail(platformOrder(), { vehicle_group: vehicleGroupOf(["Toyota Alphard", "Toyota Vellfire"]) })) : null), "platform");
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  assert.equal(tripValue("车型")?.textContent, "商务七座（VG-BIZ-7）");
  assert.equal(tripValue("代表车型")?.textContent, "Toyota Alphard");
  assert.equal(tripValue("代表车型")?.getAttribute("lang"), "en");
  assert.equal(tripValue("同级车型")?.textContent, "Toyota Alphard, Toyota Vellfire or similar");
  assert.equal(tripValue("最多乘客")?.textContent, "6 人");
  assert.equal(tripValue("最多行李")?.textContent, "5 件");

  for (const vehicle_group of [null, undefined]) {
    resetBrowser();
    const detail = platformDetail(platformOrder(), vehicle_group === null ? { vehicle_group: null } : {});
    open(`/platform/orders/${ORDER_ID}`, "operations", (call) => (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}` ? json(200, detail) : null), "platform");
    await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
    for (const label of ["车型", "代表车型", "同级车型", "最多乘客", "最多行李"]) assert.equal(tripValue(label), null, `${String(vehicle_group)}：不显示「${label}」`);
    assert.ok(tripValue("对外价 / 结算价"), "其余照常");
  }
});

test("车型标识（M7-03）：供应商后台订单详情的「行程」有车型和 4 项，没填代表车型时不出空的项；没给车型组时不显示；仍然没有对外价和加价", async () => {
  const route = (vehicle_group: ReturnType<typeof vehicleGroupOf> | null | undefined) => (call: ApiCall & { url: URL }) =>
    call.method === "GET" && call.url.pathname === `/tenant/v1/orders/${ORDER_ID}` ? json(200, { ...tenantDetail(tenantOrder()), ...(vehicle_group === undefined ? {} : { vehicle_group }) }) : null;
  open(`/orders/${ORDER_ID}`, "dispatch", route(vehicleGroupOf(["Toyota Alphard"])), "tenant");
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  assert.equal(tripValue("车型")?.textContent, "商务七座（VG-BIZ-7）");
  assert.equal(tripValue("代表车型")?.textContent, "Toyota Alphard");
  assert.equal(tripValue("同级车型")?.textContent, "Toyota Alphard or similar");
  assert.equal(tripValue("最多乘客")?.textContent, "6 人");
  assert.equal(tripValue("最多行李")?.textContent, "5 件");
  assert.doesNotMatch(document.body.textContent ?? "", /对外价|加价/);

  resetBrowser();
  open(`/orders/${ORDER_ID}`, "dispatch", route(vehicleGroupOf([])), "tenant");
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  assert.equal(tripValue("车型")?.textContent, "商务七座（VG-BIZ-7）");
  assert.equal(tripValue("代表车型"), null);
  assert.equal(tripValue("同级车型"), null);
  assert.equal(tripValue("最多乘客")?.textContent, "6 人");

  for (const vehicle_group of [null, undefined]) {
    resetBrowser();
    open(`/orders/${ORDER_ID}`, "readonly", route(vehicle_group), "tenant");
    await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
    for (const label of ["车型", "代表车型", "同级车型", "最多乘客", "最多行李"]) assert.equal(tripValue(label), null, `${String(vehicle_group)}：不显示「${label}」`);
    assert.ok(tripValue("结算价"), "其余照常");
  }
});

test("附加服务（M8-04）：供应商和运营的订单详情写「名称 × 数量」，名称从附加服务目录取（连已停用的）；没有附加服务时不出这一项；供应商这边仍然没有对外价", async () => {
  const SEAT = "a1a1a1a1-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
  const SIGN = "a2a2a2a2-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
  const catalog = { items: [SEAT, SIGN].map((id, index) => ({ id, code: `ADD-${index}`, name: { zh: index === 0 ? "儿童座椅" : "举牌接机" }, status: index === 0 ? "active" : "disabled", categories: ["airport_transfer"], charge_unit: "per_item", description: {}, version: 1, ...stamps })), next_cursor: null, total: 2 };
  const addons = [{ addon_id: SEAT, quantity: 2 }, { addon_id: SIGN, quantity: 1 }];
  const asked: string[] = [];
  open(`/orders/${ORDER_ID}`, "dispatch", (call) => {
    if (call.method === "GET" && call.url.pathname === `/tenant/v1/orders/${ORDER_ID}`) return json(200, tenantDetail(tenantOrder({ addons })));
    if (call.method === "GET" && call.url.pathname === "/tenant/v1/master/addons") {
      asked.push(call.url.searchParams.get("status") ?? "");
      return json(200, catalog);
    }
    return null;
  }, "tenant");
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  await waitFor(() => assert.equal(tripValue("附加服务")?.textContent, "儿童座椅 × 2、举牌接机 × 1"));
  assert.deepEqual(asked, ["all"]);
  assert.doesNotMatch(document.body.textContent ?? "", /对外价|加价/);

  resetBrowser();
  open(`/platform/orders/${ORDER_ID}`, "operations", (call) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}`) return json(200, platformDetail(platformOrder({ addons: [{ addon_id: SEAT, quantity: 1 }] })));
    if (call.method === "GET" && call.url.pathname === "/platform/v1/master/addons") return json(200, catalog);
    return null;
  }, "platform");
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  await waitFor(() => assert.equal(tripValue("附加服务")?.textContent, "儿童座椅 × 1"));

  resetBrowser();
  const calls = open(`/platform/orders/${ORDER_ID}`, "operations", (call) => (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}` ? json(200, platformDetail(platformOrder())) : null), "platform");
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  assert.equal(tripValue("附加服务"), null);
  assert.ok(calls.every((call) => !call.path.includes("/master/addons")), "没有附加服务时不读目录");
});

test("区域价（M8-13，platform-orders.md 3d）：点对点线路价写「用的价格」和「公里数」三行（对外 / 结算每公里、核对米数）；包车写两端的区域加价（对外 / 结算）；总价仍是一个数", async () => {
  const p2p = platformDetail(platformOrder({ category: "point_to_point", direction: null, flight_no: null, pickup: { lng: 139.7, lat: 35.7, address: "新宿站" }, dropoff: { lng: 140.3, lat: 35.7, address: "成田机场" } }), {
    pricing_route: { kind: "route", area: { id: "a1", name: { zh: "东京 23 区" } }, to_area: { id: "a2", name: { zh: "成田周边" } } },
    distance: { included_km: 30, route_meters: 34_153, over_km: 5, over_km_per_km: money("250"), over_km_per_km_sell: money("300") },
    area_surcharge: null,
  });
  open(`/platform/orders/${ORDER_ID}`, "operations", (call) => (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}` ? json(200, p2p) : null), "platform");
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  assert.equal(tripValue("用的价格")?.textContent, "线路价 · 东京 23 区 → 成田周边");
  const km = tripValue("公里数");
  assert.ok(km);
  assert.deepEqual([...km.querySelectorAll(".details__lines > span")].map((line) => line.textContent), ["含 30 公里 · 路线约 34.2 公里（报价时）· 超出 5 公里", "每公里 对外 300 JPY / 结算 250 JPY", "路线 34,153 米"]);
  assert.equal(tripValue("区域加价"), null);
  assert.doesNotMatch(km.textContent ?? "", /[=+]|合计/, "不写成算式");

  resetBrowser();
  const charter = platformDetail(platformOrder({ category: "charter", direction: null, flight_no: null, package_hours: 8, pickup: { lng: 138.7, lat: 35.4, address: "河口湖站" }, dropoff: { lng: 139.7, lat: 35.69, address: "京王广场酒店" } }), {
    pricing_route: null,
    distance: null,
    area_surcharge: { package_settlement: money("70000"), pickup: { area_id: "a3", area_name: { zh: "富士山" }, settlement: money("1000"), sell: money("1100") }, dropoff: { area_id: null, area_name: null, settlement: money("0"), sell: money("0") } },
  });
  open(`/platform/orders/${ORDER_ID}`, "operations", (call) => (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}` ? json(200, charter) : null), "platform");
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  assert.equal(tripValue("行程")?.textContent, "包车 8 小时 · 河口湖站 → 京王广场酒店");
  assert.deepEqual([...(tripValue("区域加价")?.querySelectorAll(".details__lines > span") ?? [])].map((line) => line.textContent), ["上车：富士山 · 对外 1,100 JPY / 结算 1,000 JPY", "下车：在服务区域里，不加价"]);
  assert.equal(tripValue("用的价格"), null);
  assert.equal(tripValue("公里数"), null);
});

test("区域价（M8-13）：旧单、接送机（没有这些数、或接口里没有这几项）一项都不出；两端都在服务区域里不写「区域加价」；区域删了写「（已删除的区域）」", async () => {
  for (const extra of [{}, { pricing_route: null, distance: null, area_surcharge: null }, { area_surcharge: { package_settlement: money("70000"), pickup: { area_id: null, area_name: null, settlement: money("0"), sell: null }, dropoff: { area_id: null, area_name: null, settlement: money("0"), sell: null } } }]) {
    resetBrowser();
    open(`/platform/orders/${ORDER_ID}`, "operations", (call) => (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}` ? json(200, platformDetail(platformOrder(), extra)) : null), "platform");
    await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
    for (const label of ["用的价格", "公里数", "区域加价"]) assert.equal(tripValue(label), null, `${JSON.stringify(extra)}：不显示「${label}」`);
    assert.ok(tripValue("对外价 / 结算价"), "其余照常");
  }
  resetBrowser();
  const gone = platformDetail(platformOrder({ category: "point_to_point", direction: null }), { pricing_route: { kind: "area", area: { id: "a1", name: null }, to_area: null }, distance: { included_km: 30, route_meters: 28_400, over_km: 0, over_km_per_km: money("250"), over_km_per_km_sell: null } });
  open(`/platform/orders/${ORDER_ID}`, "operations", (call) => (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}` ? json(200, gone) : null), "platform");
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  assert.equal(tripValue("用的价格")?.textContent, "区域价 · （已删除的区域）");
  assert.match(tripValue("公里数")?.textContent ?? "", /含 30 公里 · 路线约 28\.4 公里（报价时）· 在含的公里数以内每公里 对外 — \/ 结算 250 JPY/);
});

test("包车经停点（M9W-03）：运营订单详情「经停点」按顺序写上车 → 经停（停留）→ 下车；区域加价里途经加价逐区域写对外 / 结算", async () => {
  const charter = platformDetail(
    platformOrder({ category: "charter", direction: null, flight_no: null, package_hours: 10, pickup: { lng: 139.7, lat: 35.69, address: "京王广场酒店" }, dropoff: { lng: 139.7, lat: 35.69, address: "新宿站" }, waypoints: [{ name: "五合目", lat: 35.395, lng: 138.733, stay_minutes: 60 }] }),
    {
      pricing_route: null,
      distance: null,
      area_surcharge: { package_settlement: money("55000"), pickup: { area_id: null, area_name: null, settlement: money("0"), sell: null }, dropoff: { area_id: null, area_name: null, settlement: money("0"), sell: null }, waypoints: [{ area_id: "a3", area_name: { zh: "富士山地区" }, settlement: money("10000"), sell: money("11000"), stop_seqs: [1] }] },
    },
  );
  open(`/platform/orders/${ORDER_ID}`, "operations", (call) => (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}` ? json(200, charter) : null), "platform");
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  const list = (tripValue("经停点") as HTMLElement).querySelector("ol") as HTMLElement;
  assert.equal(list.getAttribute("aria-label"), "包车行程");
  assert.deepEqual([...list.querySelectorAll("li")].map((item) => item.textContent), ["上车京王广场酒店", "经停 1五合目停留 1 小时", "下车新宿站"]);
  assert.deepEqual([...(tripValue("区域加价")?.querySelectorAll(".details__lines > span") ?? [])].map((line) => line.textContent), ["上车：在服务区域里，不加价", "下车：在服务区域里，不加价", "经停（第 1 个经停点）：富士山地区 · 对外 11,000 JPY / 结算 10,000 JPY"]);
});
