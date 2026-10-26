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
import type { ExtraCharge, OrderChange, PlatformExtraCharge, PlatformOrder, PlatformOrderDetail } from "../../api/order-money.ts";
import { type ApiCall, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";

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
  events: [{ from_status: "pending_payment", to_status: "confirmed", actor: "payment", reason: "PAYMENT_SUCCEEDED", occurred_at: stamps.created_at }],
  payments: [],
  refunds: [],
  changes: [],
  extra_charges: [],
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

const tenantDetail = (order: TenantOrder, changes: OrderChange[] = [], extra: ExtraCharge[] = []): TenantOrderDetail => ({
  order,
  events: [],
  records: { assignments: [], driver_link: null, files: [], contacts: [], locations: [], no_show_claim: null },
  changes,
  extra_charges: extra,
});

test("供应商订单详情：等确认的改期写出改前改后和截止时间，调度能确认；取消的单只写扣款比例和自己应得的", async () => {
  const change: OrderChange = { id: CHANGE_ID, status: "pending_confirmation", reschedule: true, before: { service_time: "2026-10-20T01:00:00.000Z", service_local: "2026-10-20T10:00" }, after: { service_time: "2026-10-21T01:00:00.000Z", service_local: "2026-10-21T10:00" }, settlement_before: money("19800"), settlement_after: money("23760"), confirm_due_at: "2026-10-19T00:30:00.000Z", requested_by: "channel", requested_at: "2026-10-19T00:00:00.000Z", decided_at: null, decision_note: null, dispatch_conflict: false };
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
  const section = screen.getByRole("heading", { name: "改单" }).closest("section") as HTMLElement;
  assert.match(section.textContent ?? "", /用车时间：.*→.*；结算价 19,800 JPY → 23,760 JPY/);
  assert.match(section.textContent ?? "", /请在 .* 之前确认/);
  await user().click(within(section).getByRole("button", { name: "确认改期" }));
  assert.ok(await screen.findByText("已确认改期"));
  await waitFor(() => assert.match(section.textContent ?? "", /已生效/));

  resetBrowser();
  open(`/orders/${ORDER_ID}`, "readonly", (call) => (call.method === "GET" && call.url.pathname === `/tenant/v1/orders/${ORDER_ID}` ? json(200, tenantDetail(tenantOrder({ status: "cancelled", cancel_reason: "GUEST_REQUEST", cancellation: { fee_bp: 5000, tenant_share: money("9900") } }))) : null), "tenant");
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  const rules = screen.getByRole("heading", { name: "取消规则" }).closest("section") as HTMLElement;
  assert.match(rules.textContent ?? "", /商务：用车前 ≥ 48 小时 免费/);
  assert.match(rules.textContent ?? "", /你应得9,900 JPY（结算价 × 50%）/);
  assert.doesNotMatch(document.body.textContent ?? "", /对外价|退给客人|21,780/);
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
