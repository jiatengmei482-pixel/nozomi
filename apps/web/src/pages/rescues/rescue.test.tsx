/**
 * 救援改派页面的组件测试（M3-04，ADR 0031）：
 * 运营后台的救援队列（待处理的救援、司机未到的提醒、暂停中的供应商批量发起）、订单详情的救援（记录和应扣款项、看候选发救援单、不可抗力要写说明、发起救援）；
 * 供应商后台的声明无法履约（先写明会落在哪一档违约金、原因必填）、救援单（接单前看不到乘客、接 / 拒）、违约金与扣款。接口用测试替身；真实后端由集成测试和端到端测试覆盖。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { TenantOrder, TenantOrderDetail } from "../../api/dispatch.ts";
import type { PlatformOrder, PlatformOrderDetail } from "../../api/order-money.ts";
import type { PlatformRescue, RescueQueue, TenantDeduction, TenantRescueOffer } from "../../api/rescues.ts";
import { type ApiCall, apiError, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-10-06T00:12:00.000Z", updated_at: "2026-10-08T05:30:00.000Z" };
const ORDER_ID = "0a0a0a0a-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RESCUE_ID = "e1e1e1e1-eeee-4eee-8eee-eeeeeeeeeeee";
const OFFER_ID = "e2e2e2e2-eeee-4eee-8eee-eeeeeeeeeeee";
const TENANT_A = "a1a1a1a1-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TENANT_B = "b1b1b1b1-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const money = (amount: string) => ({ amount, currency: "JPY" });
const HOUR = 3_600_000;
/** 用车时间相对现在：组件按浏览器的「现在」算违约金档位和倒计时 */
const inHours = (hours: number): string => new Date(Date.now() + hours * HOUR).toISOString();

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

const rescueOf = (changes: Partial<PlatformRescue> = {}): PlatformRescue => ({
  id: RESCUE_ID,
  order: { id: ORDER_ID, order_no: "NZ20261007ABCDEFGH", category: "airport_transfer", city_id: "c1", place_id: "p1", vehicle_group_id: "g1", service_time: "2026-10-20T01:00:00.000Z", service_local: "2026-10-20T10:00", timezone: "Asia/Tokyo" },
  trigger: "tenant_declared",
  triggered_by_type: "tenant_user",
  reason: "车辆故障",
  triggered_at: stamps.created_at,
  from_status: "confirmed",
  original_tenant: { id: TENANT_B, name: "乙车队" },
  original_settlement: money("19800"),
  penalty_bp: 3000,
  penalty_tier: "partial",
  penalty: money("5940"),
  status: "open",
  rescue_tenant: null,
  rescue_settlement: null,
  rescued_via: null,
  rescued_at: null,
  force_majeure: null,
  closed_at: null,
  offers: [],
  deductions: [{ id: "d1", tenant_id: TENANT_B, kind: "penalty", amount: money("5940"), status: "pending", basis: { trigger: "tenant_declared", tier: "partial", bp: 3000, settlement_minor: 19800 }, waived_at: null, waive_reason: null, created_at: stamps.created_at }],
  version: 1,
  ...changes,
});

test("救援队列：待处理的救援写出情形、违约金、进展；司机未到的提醒；暂停中的供应商运营能批量发起，只读不能", async () => {
  const queue: RescueQueue = {
    items: [rescueOf(), rescueOf({ id: "r2", order: { ...rescueOf().order, id: "o2", order_no: "NZ20261007ZZZZZZZZ" }, trigger: "dispatch_overdue", triggered_by_type: "system", penalty_bp: 10000, penalty_tier: "full", penalty: money("19800"), status: "offering", offers: [{ id: OFFER_ID, tenant: { id: TENANT_A, name: "甲车队" }, product_id: "pa", product_version: 1, status: "pending", offered_by_type: "platform_user", offered_at: stamps.updated_at, expires_at: "2026-10-08T05:45:00.000Z", decided_at: null, decline_reason: null, settlement: money("20000"), sell: money("22000"), markup_bp: 1000, position: 1 }] })],
    alerts: [{ order_id: "o3", order_no: "NZ20261007YYYYYYYY", tenant: { id: TENANT_B, name: "乙车队" }, status: "assigned", service_time: stamps.updated_at, arrival_overdue_at: stamps.updated_at, driver_missing_reported_at: null }],
    suspended_tenants: [{ tenant: { id: TENANT_B, name: "乙车队" }, future_orders: 3 }],
  };
  let batched: unknown = null;
  open("/platform/rescues", "operations", (call) => {
    if (call.method === "GET" && call.url.pathname === "/platform/v1/rescues") return json(200, queue);
    if (call.method === "POST" && call.url.pathname === `/platform/v1/tenants/${TENANT_B}/rescue`) {
      batched = call.body;
      return json(200, { triggered: ["o4", "o5"], skipped: [{ order_id: "o6", code: "RESCUE_ALREADY_OPEN" }] });
    }
    return null;
  }, "platform");
  await screen.findByRole("heading", { level: 1, name: "救援改派" });
  const table = await screen.findByRole("table", { name: "救援" });
  assert.match(table.textContent ?? "", /供应商声明无法履约乙车队30%（5,940 JPY）待处理还没发救援单/);
  assert.match(table.textContent ?? "", /用车前 6 小时仍未派车乙车队100%（19,800 JPY）救援单待接救援单待「甲车队」接/);
  assert.ok(within(table).getByRole("link", { name: "NZ20261007ABCDEFGH" }).getAttribute("href")?.endsWith(`/platform/orders/${ORDER_ID}`));
  assert.match(document.body.textContent ?? "", /NZ20261007YYYYYYYY · 乙车队 · 已派车.*发现到点 15 分钟未到/);
  await user().click(screen.getByRole("button", { name: "批量发起救援：乙车队" }));
  const dialog = await screen.findByRole("dialog", { name: "批量发起救援：乙车队" });
  await user().click(within(dialog).getByRole("button", { name: "发起 3 张" }));
  assert.ok(await screen.findByText("已发起 2 张，1 张没发起（已在救援中或状态变了）"));
  assert.deepEqual(batched, { note: null });

  resetBrowser();
  open("/platform/rescues", "readonly", (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/rescues" ? json(200, queue) : null), "platform");
  await screen.findByRole("table", { name: "救援" });
  assert.equal(screen.queryByRole("button", { name: /批量发起救援/ }), null, "只读不能批量发起");
});

test("救援队列：限定了数据范围的运营（M4-10）没有「批量发起救援」按钮（接口会 403），写明原因；不限范围的照常有", async () => {
  const queue: RescueQueue = { items: [rescueOf()], alerts: [], suspended_tenants: [{ tenant: { id: TENANT_B, name: "乙车队" }, future_orders: 3 }] };
  const scopedMe = (scope: { city_ids: string[] | null; channel_ids: string[] | null }) => json(200, { user: { id: "p1", email: "staff@platform.example", name: "测试员工", role: "custom_0123456789abcdef", role_name: "夜班运营", status: "active", ...stamps }, permissions: ["order.read", "rescue.manage"], data_scope: scope, must_change_password: false });
  for (const scope of [{ city_ids: ["c0c0c0c0-0000-4000-8000-000000000001"], channel_ids: null }, { city_ids: null, channel_ids: ["c4c4c4c4-0000-4000-8000-000000000002"] }]) {
    resetBrowser();
    open("/platform/rescues", "custom_0123456789abcdef", (call) => {
      if (call.method === "GET" && call.url.pathname === "/platform/v1/auth/me") return scopedMe(scope);
      return call.method === "GET" && call.url.pathname === "/platform/v1/rescues" ? json(200, queue) : null;
    }, "platform");
    await screen.findByRole("table", { name: "救援" });
    assert.ok(await screen.findByText(/你的角色限定了数据范围：暂停中供应商的批量救援不在这里/));
    assert.equal(screen.queryByRole("button", { name: /批量发起救援/ }), null, JSON.stringify(scope));
  }
  resetBrowser();
  open("/platform/rescues", "custom_0123456789abcdef", (call) => {
    if (call.method === "GET" && call.url.pathname === "/platform/v1/auth/me") return scopedMe({ city_ids: null, channel_ids: null });
    return call.method === "GET" && call.url.pathname === "/platform/v1/rescues" ? json(200, queue) : null;
  }, "platform");
  assert.ok(await screen.findByRole("button", { name: "批量发起救援：乙车队" }));
  assert.equal(screen.queryByText(/你的角色限定了数据范围/), null);
});

const platformOrder = (changes: Partial<PlatformOrder> = {}): PlatformOrder => ({
  id: ORDER_ID,
  order_no: "NZ20261007ABCDEFGH",
  status: "rescue_pending",
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
  tenant: { id: TENANT_B, name: "乙车队" },
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
});

const platformDetail = (order: PlatformOrder, rescues: PlatformRescue[]): PlatformOrderDetail => ({ order, events: [], payments: [], refunds: [], changes: [], extra_charges: [], rescues, exceptions: [], tickets: [] });

test("订单详情（运营后台）：救援记录写出违约金和应扣款项；看候选写出差价，发救援单带上选的供应商；不可抗力要写说明", async () => {
  let offered: unknown = null;
  let forced: unknown = null;
  const calls = open(`/platform/orders/${ORDER_ID}`, "operations", (call) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}`) return json(200, platformDetail(platformOrder(), [rescueOf()]));
    if (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}/rescue/candidates`) {
      return json(200, {
        rescue_id: RESCUE_ID,
        candidates: [
          { tenant: { id: TENANT_A, name: "甲车队" }, product_id: "pa", product_version: 1, settlement: money("20000"), sell: money("22000"), markup_bp: 1000, position: 1, in_band: true, difference: money("200"), urgent: false },
          { tenant: { id: "c1c1c1c1-cccc-4ccc-8ccc-cccccccccccc", name: "丙车队" }, product_id: "pc", product_version: 1, settlement: money("21000"), sell: money("23100"), markup_bp: 1000, position: 2, in_band: false, difference: money("1200"), urgent: true },
        ],
        excluded: [{ tenant: { id: "d1", name: "丁车队" }, product_id: "pd", reason: "LEAD_TIME_TOO_SHORT", message: "提前预订时长不够" }],
      });
    }
    if (call.method === "POST" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}/rescue/offers`) {
      offered = call.body;
      return json(201, { offer: rescueOf().offers[0] ?? null });
    }
    if (call.method === "POST" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}/rescue/force-majeure`) {
      forced = call.body;
      return json(200, { rescue: rescueOf(), waived: 1 });
    }
    return null;
  }, "platform");
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  const section = screen.getByRole("heading", { name: "救援改派" }).closest("section") as HTMLElement;
  assert.match(section.textContent ?? "", /供应商声明无法履约（供应商/);
  assert.match(section.textContent ?? "", /原结算价的 30%（用车前 2–24 小时） = 5,940 JPY/);
  assert.match(within(section).getByRole("list", { name: "应扣款项" }).textContent ?? "", /违约金 5,940 JPY 待结算时扣除 供应商声明无法履约：原结算价 19,800 JPY × 30%/);
  await user().click(within(section).getByRole("button", { name: "看候选并发救援单" }));
  const dialog = await screen.findByRole("dialog", { name: "救援候选" });
  const candidates = await within(dialog).findByRole("table", { name: "候选" });
  assert.match(candidates.textContent ?? "", /1甲车队20,000 JPY22,000 JPY200 JPY/);
  assert.match(candidates.textContent ?? "", /2丙车队（加急价）21,000 JPY23,100 JPY1,200 JPY/);
  assert.match(dialog.textContent ?? "", /丁车队：提前预订时长不够/);
  await user().click(within(dialog).getByRole("button", { name: "发救援单给 丙车队" }));
  await waitFor(() => assert.deepEqual(offered, { tenant_id: "c1c1c1c1-cccc-4ccc-8ccc-cccccccccccc" }));
  assert.ok(await screen.findByText(/已给「丙车队」发救援单/));

  await user().click(within(section).getByRole("button", { name: "认定不可抗力" }));
  const force = await screen.findByRole("dialog", { name: "认定不可抗力" });
  await user().click(within(force).getByRole("button", { name: "认定" }));
  assert.ok(await within(force).findByText(/请写明是什么不可抗力/));
  assert.equal(calls.filter((call) => call.method === "POST" && call.path.endsWith("/force-majeure")).length, 0);
  await user().type(within(force).getByLabelText("说明"), "大雪封路");
  await user().click(within(force).getByRole("button", { name: "认定" }));
  await waitFor(() => assert.deepEqual(forced, { note: "大雪封路" }));
  assert.ok(await screen.findByText("已认定不可抗力，免除了 1 条应扣款项"));
});

test("订单详情（运营后台）：没有救援的已派车单，运营能按情形发起（说明必填）；客服也能；只读看不到这一块", async () => {
  let triggered: unknown = null;
  open(`/platform/orders/${ORDER_ID}`, "customer_service", (call) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}`) return json(200, platformDetail(platformOrder({ status: "assigned" }), []));
    if (call.method === "POST" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}/rescue`) {
      triggered = call.body;
      return json(201, { rescue: rescueOf({ trigger: "driver_no_show", penalty_bp: 10000, penalty_tier: "full" }) });
    }
    return null;
  }, "platform");
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  await user().click(screen.getByRole("button", { name: "发起救援改派" }));
  const dialog = await screen.findByRole("dialog", { name: "发起救援改派" });
  assert.match(dialog.textContent ?? "", /到点 15 分钟司机仍未到达、联系不上/);
  await user().click(within(dialog).getByRole("button", { name: "发起" }));
  assert.ok(await within(dialog).findByText(/请写明情况/));
  await user().type(within(dialog).getByLabelText("情况说明"), "司机电话打不通");
  await user().click(within(dialog).getByRole("button", { name: "发起" }));
  await waitFor(() => assert.deepEqual(triggered, { trigger: "driver_no_show", note: "司机电话打不通" }));
  assert.ok(await screen.findByText(/已进入救援改派，违约金 100%/));

  resetBrowser();
  open(`/platform/orders/${ORDER_ID}`, "readonly", (call) => (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}` ? json(200, platformDetail(platformOrder({ status: "assigned" }), [])) : null), "platform");
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  assert.equal(screen.queryByRole("heading", { name: "救援改派" }), null);
});

test("订单详情（运营后台）：待付款的单没有「发起救援改派」；页面上还是旧状态时发起，后端说还没付款 → 提示付款完成后才能发起，不说订单不存在", async () => {
  open(`/platform/orders/${ORDER_ID}`, "operations", (call) => (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}` ? json(200, platformDetail(platformOrder({ status: "pending_payment" }), [])) : null), "platform");
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  assert.equal(screen.queryByRole("button", { name: "发起救援改派" }), null);

  resetBrowser();
  open(`/platform/orders/${ORDER_ID}`, "operations", (call) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}`) return json(200, platformDetail(platformOrder({ status: "confirmed" }), []));
    if (call.method === "POST" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}/rescue`) return apiError(409, "ORDER_STATE_INVALID", "x", { reason: "NOT_CONFIRMED", status: "pending_payment" });
    return null;
  }, "platform");
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  await user().click(screen.getByRole("button", { name: "发起救援改派" }));
  const dialog = await screen.findByRole("dialog", { name: "发起救援改派" });
  await user().type(within(dialog).getByLabelText("情况说明"), "司机电话打不通");
  await user().click(within(dialog).getByRole("button", { name: "发起" }));
  assert.ok(await within(dialog).findByText(/这张订单还没付款：付款完成、订单确认后才能发起救援改派/));
  assert.doesNotMatch(dialog.textContent ?? "", /订单不存在/);
});

const tenantOrder = (changes: Partial<TenantOrder> = {}): TenantOrder => ({
  id: ORDER_ID,
  order_no: "NZ20261007ABCDEFGH",
  status: "confirmed",
  category: "airport_transfer",
  city_id: "c1",
  place_id: "p1",
  direction: "pickup",
  vehicle_group_id: "g1",
  package_hours: null,
  service_time: inHours(10),
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
  fulfilment: { departed_at: null, arrived_at: null, arrival_distance_m: null, arrival_within_range: null, picked_up_at: null, completed_at: null, actual_minutes: null, actual_km: null, leave_requested_at: null },
  landing: null,
  cancel_policy: null,
  cancellation: null,
  version: 5,
  ...changes,
});

const tenantDetail = (order: TenantOrder, rescue: TenantOrderDetail["rescue"] = null): TenantOrderDetail => ({ order, events: [], records: { assignments: [], driver_link: null, files: [], contacts: [], locations: [], no_show_claim: null }, changes: [], extra_charges: [], rescue });

const deductionOf = (changes: Partial<TenantDeduction> = {}): TenantDeduction => ({ id: "d1", order_id: ORDER_ID, order_no: "NZ20261007ABCDEFGH", service_time: "2026-10-20T01:00:00.000Z", kind: "penalty", amount: money("5940"), status: "pending", basis: { trigger: "tenant_declared", tier: "partial", bp: 3000, settlement_minor: 19800 }, waived_at: null, waive_reason: null, created_at: stamps.created_at, ...changes });

test("供应商：用车前 10 小时声明无法履约——先写明按现在声明是 30%（5,940 JPY）和救援差价，原因必填；只读角色没有按钮", async () => {
  let declared: unknown = null;
  const calls = open(`/orders/${ORDER_ID}`, "dispatch", (call) => {
    if (call.method === "GET" && call.url.pathname === `/tenant/v1/orders/${ORDER_ID}`) return json(200, tenantDetail(tenantOrder()));
    if (call.method === "POST" && call.url.pathname === `/tenant/v1/orders/${ORDER_ID}/declare-unable`) {
      declared = call.body;
      return json(200, { rescue: { role: "original", status: "open", trigger: "tenant_declared", triggered_at: stamps.updated_at, reason: "车坏了", penalty_bp: 3000, penalty_tier: "partial", force_majeure: false, rescued_at: null, deductions: [deductionOf()] } });
    }
    return null;
  }, "tenant");
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  await user().click(screen.getByRole("button", { name: "声明无法履约" }));
  const dialog = await screen.findByRole("dialog", { name: "声明无法履约" });
  assert.match(dialog.textContent ?? "", /按现在声明的违约金原结算价的 30%（用车前 2–24 小时） = 5,940 JPY/);
  assert.match(dialog.textContent ?? "", /救援差价/);
  await user().click(within(dialog).getByRole("button", { name: "确认声明" }));
  assert.ok(await within(dialog).findByText(/请写明为什么接不了/));
  assert.equal(calls.filter((call) => call.method === "POST").length, 0);
  await user().type(within(dialog).getByLabelText("原因"), "车坏了");
  await user().click(within(dialog).getByRole("button", { name: "确认声明" }));
  await waitFor(() => assert.deepEqual(declared, { reason: "车坏了" }));
  assert.ok(await screen.findByText("已声明无法履约：平台正在安排救援，违约金 30%"));
  assert.doesNotMatch(document.body.textContent ?? "", /对外价|加价|21,780/);

  resetBrowser();
  open(`/orders/${ORDER_ID}`, "readonly", (call) => (call.method === "GET" && call.url.pathname === `/tenant/v1/orders/${ORDER_ID}` ? json(200, tenantDetail(tenantOrder())) : null), "tenant");
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  assert.equal(screen.queryByRole("button", { name: "声明无法履约" }), null);
});

test("供应商：已转给救援供应商的单写明只能查看、没有声明和派车按钮，看得到违约金和差价（不可抗力免除的写明说明）；救援供应商只知道这是救援单", async () => {
  const rescue = { role: "original" as const, status: "rescued" as const, trigger: "tenant_declared" as const, triggered_at: stamps.created_at, reason: "车坏了", penalty_bp: 3000, penalty_tier: "partial" as const, force_majeure: true, rescued_at: stamps.updated_at, deductions: [deductionOf({ status: "waived", waived_at: stamps.updated_at, waive_reason: "大雪封路" }), deductionOf({ id: "d2", kind: "rescue_difference", amount: money("200"), status: "waived", waived_at: stamps.updated_at, waive_reason: "大雪封路", basis: { original_minor: 19800, rescue_in_original_minor: 20000, raw_minor: 200, same_currency: true } })] };
  open(`/orders/${ORDER_ID}`, "dispatch", (call) => (call.method === "GET" && call.url.pathname === `/tenant/v1/orders/${ORDER_ID}` ? json(200, tenantDetail(tenantOrder({ status: "rescued" }), rescue)) : null), "tenant");
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  assert.ok(screen.getByText(/这一单已转给救援供应商，只能查看/));
  assert.equal(screen.queryByRole("button", { name: "声明无法履约" }), null);
  assert.equal(screen.queryByRole("button", { name: "派车" }), null);
  const list = screen.getByRole("list", { name: "应扣款项" });
  assert.match(list.textContent ?? "", /违约金 5,940 JPY 不可抗力，已免除.*免除说明：大雪封路/);
  assert.match(list.textContent ?? "", /救援差价 200 JPY .*救援结算价 20,000 JPY − 原结算价 19,800 JPY/);

  resetBrowser();
  open(`/orders/${ORDER_ID}`, "dispatch", (call) => (call.method === "GET" && call.url.pathname === `/tenant/v1/orders/${ORDER_ID}` ? json(200, tenantDetail(tenantOrder(), { ...rescue, role: "rescuer", trigger: null, triggered_at: null, reason: null, penalty_bp: null, penalty_tier: null, force_majeure: false, deductions: [] })) : null), "tenant");
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  assert.ok(screen.getByText(/这一单是你们接的救援单/));
  assert.doesNotMatch(screen.getByRole("main").textContent ?? "", /车坏了|违约金/, "救援供应商不知道原供应商的原因和违约金");
});

const offerOf = (changes: Partial<TenantRescueOffer> = {}): TenantRescueOffer => ({
  id: OFFER_ID,
  status: "pending",
  offered_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 14 * 60_000 + 30_000).toISOString(),
  decided_at: null,
  decline_reason: null,
  trip: { category: "airport_transfer", city_id: "c1", place_id: "p1", direction: "pickup", vehicle_group_id: "g1", package_hours: null, service_time: inHours(30), service_local: "2026-10-20T10:00", timezone: "Asia/Tokyo", passengers: 2, luggage: 1, pickup: null, dropoff: { lng: 139.76, lat: 35.68, address: "东京站八重洲口" }, addons: [], driver_language: null },
  product_id: "pa",
  product_version: 1,
  vehicle_group_id: "g1",
  settlement: { total: money("20000"), base: money("20000"), adjust: money("0"), urgent: money("0"), night: money("0"), addons: money("0"), driver_language: money("0") },
  order_id: null,
  ...changes,
});

test("供应商救援单：待接的写出行程、结算价、还剩几分钟（没有乘客信息）；接单后给去订单的链接；拒绝可以写原因", async () => {
  let accepted = false;
  let declined: unknown = null;
  open("/rescue-offers", "dispatch", (call) => {
    if (call.method === "GET" && call.url.pathname === "/tenant/v1/rescue-offers") return json(200, { items: accepted ? [offerOf({ status: "accepted", order_id: ORDER_ID })] : [offerOf()] });
    if (call.method === "POST" && call.url.pathname === `/tenant/v1/rescue-offers/${OFFER_ID}/accept`) {
      accepted = true;
      return json(200, { offer: offerOf({ status: "accepted", order_id: ORDER_ID }), order_id: ORDER_ID });
    }
    if (call.method === "POST" && call.url.pathname === `/tenant/v1/rescue-offers/${OFFER_ID}/decline`) {
      declined = call.body;
      return json(200, { offer: offerOf({ status: "declined" }) });
    }
    return null;
  }, "tenant");
  await screen.findByRole("heading", { level: 1, name: "救援单" });
  const card = await screen.findByRole("region", { name: /2026-10-20 10:00 · 接送机/ });
  assert.match(card.textContent ?? "", /结算价20,000 JPY/);
  assert.match(card.textContent ?? "", /还剩 14 分钟/);
  assert.doesNotMatch(document.body.textContent ?? "", /王小明|\+8190|NH211/, "接单前看不到乘客");
  await user().click(within(card).getByRole("button", { name: "拒绝" }));
  const dialog = await screen.findByRole("dialog", { name: "拒绝救援单" });
  await user().type(within(dialog).getByLabelText("原因（选填）"), "车都排满了");
  await user().click(within(dialog).getByRole("button", { name: "拒绝" }));
  await waitFor(() => assert.deepEqual(declined, { reason: "车都排满了" }));
  await user().click(within(card).getByRole("button", { name: "接单" }));
  assert.ok(await screen.findByText("已接单：去订单里派车"));
  const link = await screen.findByRole("link", { name: "看订单" });
  assert.ok(link.getAttribute("href")?.endsWith(`/orders/${ORDER_ID}`));
});

test("供应商违约金与扣款：列出自己的应扣款项和怎么算的；财务也能看；商品价格角色没有这一页", async () => {
  open("/deductions", "finance", (call) => (call.method === "GET" && call.url.pathname === "/tenant/v1/deductions" ? json(200, { items: [deductionOf(), deductionOf({ id: "d2", kind: "rescue_difference", amount: money("200"), basis: { original_minor: 19800, rescue_in_original_minor: 20000, raw_minor: 200, same_currency: true } })] }) : null), "tenant");
  await screen.findByRole("heading", { level: 1, name: "违约金与扣款" });
  const table = await screen.findByRole("table", { name: "应扣款项" });
  assert.match(table.textContent ?? "", /NZ20261007ABCDEFGH违约金5,940 JPY待结算时扣除供应商声明无法履约：原结算价 19,800 JPY × 30%/);
  assert.match(table.textContent ?? "", /救援差价200 JPY/);
  assert.match(document.body.textContent ?? "", /这些在账单里扣/);

  resetBrowser();
  open("/deductions", "pricing", () => null, "tenant");
  assert.ok(await screen.findByText("你没有权限查看这里"));
});
