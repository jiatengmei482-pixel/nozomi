/**
 * 派车、车队、Webhook、司机 H5 页面的组件测试（M3-02，ADR 0027）：订单列表把超时未派车的排前面并标红；派车遇到同一时段的单要确认、成功后司机链接只显示一次；
 * 司机和车辆的表单校验、请求体；Webhook 的签名密钥只显示一次、失败的推送能重推；司机页面没有任何价格、按状态出下一步按钮；运营后台的推送记录默认只看失败的。
 * 接口用测试替身；真实后端由集成测试和端到端测试 e2e/dispatch.spec.ts 覆盖。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { Assignable, Driver, DriverTrip, TenantOrder, TenantOrderDetail, Vehicle, WebhookDelivery, WebhookSettings } from "../../api/dispatch.ts";
import type { VehicleGroup } from "../../api/master.ts";
import { type ApiCall, apiError, assertAbsent, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-10-06T00:12:00.000Z", updated_at: "2026-10-08T05:30:00.000Z" };
const ORDER_ID = "0a0a0a0a-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORDER2_ID = "0b0b0b0b-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DRIVER_ID = "d1d1d1d1-dddd-4ddd-8ddd-dddddddddddd";
const VEHICLE_ID = "e1e1e1e1-eeee-4eee-8eee-eeeeeeeeeeee";
const GROUP_ID = "55555555-5555-4555-8555-555555555555";
const DELIVERY_ID = "f1f1f1f1-ffff-4fff-8fff-ffffffffffff";
const LINK_TOKEN = `nzd_${"a".repeat(32)}.${"B".repeat(43)}`;
const SECRET = `nzwh_${"S".repeat(43)}`;

const me = (role: string) => json(200, { user: { id: "u1", email: "user@supplier.example", name: "测试用户", role, status: "active", ...stamps }, tenant: { id: "t1", name: "测试用供应商", status: "active", ...stamps }, permissions: [], must_change_password: false });
const platformMe = (role: string) => json(200, { user: { id: "p1", email: "staff@platform.example", name: "测试员工", role, status: "active", ...stamps }, permissions: [], must_change_password: false });
const page = <T,>(items: T[], total = items.length) => json(200, { items, next_cursor: null, total });
const group: VehicleGroup = { id: GROUP_ID, code: "VG-BIZ-7", grade: "business", seats: 7, name: { zh: "商务七座" }, sample_models: [], power: "fuel", combos: [{ passengers: 6, luggage: 4 }], status: "active", version: 1, ...stamps };

const orderOf = (changes: Partial<TenantOrder> = {}): TenantOrder => ({
  id: ORDER_ID,
  order_no: "NZ20261007ABCDEFGH",
  status: "confirmed",
  category: "airport_transfer",
  city_id: "c1",
  place_id: "p1",
  direction: "pickup",
  vehicle_group_id: GROUP_ID,
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
  settlement: { total: { amount: "19800", currency: "JPY" }, base: { amount: "19800", currency: "JPY" }, adjust: { amount: "0", currency: "JPY" }, urgent: { amount: "0", currency: "JPY" }, night: { amount: "0", currency: "JPY" }, addons: { amount: "0", currency: "JPY" }, driver_language: { amount: "0", currency: "JPY" } },
  dispatch: { due_at: "2026-10-19T01:00:00.000Z", overdue: false, overdue_at: null, escalation_at: "2026-10-19T19:00:00.000Z", departure_due_at: "2026-10-20T00:00:00.000Z", departure_overdue_at: null, assigned_at: null, driver: null, vehicle: null },
  fulfilment: { departed_at: null, arrived_at: null, arrival_distance_m: null, arrival_within_range: null, picked_up_at: null, completed_at: null, actual_minutes: null, actual_km: null, leave_requested_at: null },
  landing: { scheduled_at: "2026-10-20T01:00:00.000Z", guest_reported_at: null, driver_reported_at: null, driver_photo_file_id: null, landed_at: "2026-10-20T01:00:00.000Z", source: "scheduled", disagreement: false, delay_minutes: 0, within_delay_allowance: true },
  cancel_policy: null,
  cancellation: null,
  version: 3,
  ...changes,
});
const detailOf = (order: TenantOrder = orderOf()): TenantOrderDetail => ({ order, events: [{ from_status: "pending_payment", to_status: "confirmed", actor: "payment", reason: "PAYMENT_SUCCEEDED", occurred_at: stamps.created_at }], records: { assignments: [], driver_link: null, files: [], contacts: [], locations: [], no_show_claim: null }, changes: [], extra_charges: [] });
const driverOf = (changes: Partial<Driver> = {}): Driver => ({ id: DRIVER_ID, name: "佐藤一郎", phone: "+819011112222", languages: ["ja"], license_expires_on: "2030-01-01", license_state: "valid", driving_years: 12, gold: true, status: "active", version: 1, ...stamps, ...changes });
const vehicleOf = (changes: Partial<Vehicle> = {}): Vehicle => ({ id: VEHICLE_ID, plate: "品川 300 あ 12-34", vehicle_group_id: GROUP_ID, model: "丰田埃尔法", color: "黑", seats: 7, mileage_km: 30_000, is_new: true, plate_type: "business", insurance_expires_on: "2030-01-01", insurance_state: "valid", inspection_expires_on: "2030-01-01", inspection_state: "valid", status: "available", version: 1, ...stamps, ...changes });
const deliveryOf = (changes: Partial<WebhookDelivery> = {}): WebhookDelivery => ({ id: DELIVERY_ID, event_id: "evt_000000000000000000000001", event_type: "order.confirmed", order_id: ORDER_ID, data: {}, status: "failed", attempts: 7, next_attempt_at: null, last_attempt_at: stamps.updated_at, last_status_code: 503, last_error_code: "WEBHOOK_HTTP_STATUS", last_duration_ms: 40, succeeded_at: null, failed_at: stamps.updated_at, created_at: stamps.created_at, ...changes });

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;

const urlOf = (call: ApiCall): URL => new URL(call.path, "http://localhost");

/** 手机不给定位（测试环境）：立刻回「拒绝」。 */
function denyGeolocation(): void {
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (_ok: unknown, fail: () => void) => fail() } });
}

function open(path: string, role: string, routes: Route, portal: "tenant" | "platform" = "tenant"): ApiCall[] {
  signIn(portal, "the-token");
  const calls = stubApiWith((call) => {
    const custom = routes(call);
    if (custom !== null) return custom;
    if (call.method === "GET" && call.url.pathname === "/tenant/v1/auth/me") return me(role);
    if (call.method === "GET" && call.url.pathname === "/platform/v1/auth/me") return platformMe(role);
    if (call.method === "GET" && call.url.pathname === "/tenant/v1/master/vehicle-groups") return page([group]);
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

test("订单列表：超时未派车的排在最前面、标红，顶部提示有几张并能只看这些；只有结算价，没有对外价", async () => {
  const late = orderOf({ id: ORDER2_ID, order_no: "NZ20261007LATELATE", service_local: "2026-10-25T10:00", dispatch: { ...orderOf().dispatch, overdue: true, overdue_at: stamps.updated_at } });
  const calls = open("/orders", "dispatch", (call) => {
    if (call.url.pathname !== "/tenant/v1/orders") return null;
    if (call.url.searchParams.get("dispatch") === "overdue") return page([late]);
    return page([orderOf(), late]);
  });
  await screen.findByText("NZ20261007LATELATE");
  const rows = screen.getAllByRole("row").slice(1);
  assert.match(rows[0]?.textContent ?? "", /NZ20261007LATELATE.*超时未派车/);
  assert.match(rows[1]?.textContent ?? "", /NZ20261007ABCDEFGH.*未派车/);
  assert.match(rows[1]?.textContent ?? "", /19,800 JPY/);
  assert.ok(screen.getByText(/有 1 张单过了派车截止时间还没派车/));
  await user().click(screen.getByRole("button", { name: "只看这些" }));
  await waitFor(() => assert.ok(calls.some((call) => urlOf(call).pathname === "/tenant/v1/orders" && urlOf(call).searchParams.get("dispatch") === "overdue" && urlOf(call).searchParams.get("limit") === "100")));
  assert.doesNotMatch(document.body.textContent ?? "", /对外价|加价/);
});

test("派车：选司机和车辆 → 同一时段有别的单要确认 → 仍然派车；成功后司机链接只在对话框里出现一次（完整地址带 # 令牌）", async () => {
  const assignable: Assignable = {
    order_id: ORDER_ID,
    drivers: [{ driver: driverOf(), assignable: true, issues: [], conflicts: [{ resource: "driver", resource_id: DRIVER_ID, order_id: ORDER2_ID, order_no: "NZ20261007OTHER000", service_time: "2026-10-20T02:00:00.000Z" }] }, { driver: driverOf({ id: "d2", name: "铃木", languages: ["ja"] }), assignable: false, issues: [{ code: "DRIVER_LICENSE_EXPIRED", message: "司机的驾照在用车日前已过期" }], conflicts: [] }],
    vehicles: [{ vehicle: vehicleOf(), assignable: true, issues: [], conflicts: [] }],
  };
  let assigned = false;
  const calls = open(`/orders/${ORDER_ID}`, "dispatch", (call) => {
    if (call.method === "GET" && call.url.pathname === `/tenant/v1/orders/${ORDER_ID}`) return json(200, detailOf(assigned ? orderOf({ status: "assigned", version: 4, dispatch: { ...orderOf().dispatch, driver: { id: DRIVER_ID, name: "佐藤一郎", phone: "+819011112222", languages: ["ja"], gold: true }, vehicle: { id: VEHICLE_ID, plate: "品川 300 あ 12-34", vehicle_group_id: GROUP_ID, model: "丰田埃尔法", color: "黑", seats: 7, is_new: true } } }) : orderOf()));
    if (call.method === "GET" && call.url.pathname === `/tenant/v1/orders/${ORDER_ID}/assignable`) return json(200, assignable);
    if (call.method === "POST" && call.url.pathname === `/tenant/v1/orders/${ORDER_ID}/assign`) {
      const body = call.body as { confirm_conflicts?: boolean };
      if (!body.confirm_conflicts) return apiError(409, "ASSIGNMENT_CONFLICT", "冲突", { conflicts: assignable.drivers[0]?.conflicts });
      assigned = true;
      return json(200, { order: orderOf({ status: "assigned", version: 4 }), change: false, driver_link: { token: LINK_TOKEN, path: `/driver#${LINK_TOKEN}`, created_at: stamps.updated_at, expires_at: "2026-10-21T01:00:00.000Z" } });
    }
    return null;
  });
  const actor = user();
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  assert.ok(screen.getByText("东京站八重洲口", { exact: false }));
  assert.doesNotMatch(document.body.textContent ?? "", /对外价|加价/);
  await actor.click(screen.getByRole("button", { name: "派车" }));
  const dialog = await screen.findByRole("dialog", { name: "派车" });
  await waitFor(() => assert.ok(within(dialog).getByRole("option", { name: /铃木（ja）（不能派：司机的驾照在用车日前已过期）/ })));
  await actor.selectOptions(within(dialog).getByLabelText("司机"), DRIVER_ID);
  await actor.selectOptions(within(dialog).getByLabelText("车辆"), VEHICLE_ID);
  assert.ok(within(dialog).getByText(/提示：司机在 NZ20261007OTHER000 那一单/));
  await actor.click(within(dialog).getByRole("button", { name: "确定派车" }));
  await within(dialog).findByText(/同一时段已有别的单/);
  await actor.click(within(dialog).getByRole("button", { name: "仍然派车" }));
  const linkDialog = await screen.findByRole("dialog", { name: "司机链接" });
  assert.equal((within(linkDialog).getByLabelText("链接") as HTMLInputElement).value, `${window.location.origin}/driver#${LINK_TOKEN}`);
  const posts = calls.filter((call) => call.method === "POST");
  assert.deepEqual(posts.map((call) => [call.body, call.headers["if-match"]]), [[{ driver_id: DRIVER_ID, vehicle_id: VEHICLE_ID, confirm_conflicts: false }, '"3"'], [{ driver_id: DRIVER_ID, vehicle_id: VEHICLE_ID, confirm_conflicts: true }, '"3"']]);
  await actor.click(within(linkDialog).getByRole("button", { name: "我已发给司机" }));
  await waitFor(() => assertAbsent(screen.queryByRole("dialog", { name: "司机链接" })));
  assert.ok(!(document.body.textContent ?? "").includes(LINK_TOKEN), "关掉后页面上不再有令牌");
});

test("只读角色：看得到订单，没有派车按钮", async () => {
  open(`/orders/${ORDER_ID}`, "readonly", (call) => (call.method === "GET" && call.url.pathname === `/tenant/v1/orders/${ORDER_ID}` ? json(200, detailOf()) : null));
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  assertAbsent(screen.queryByRole("button", { name: "派车" }));
});

test("司机：新增时校验必填，请求体带幂等键、电话原样交给后端统一；后端说电话格式不对时显示在电话下面；只读角色没有新增按钮", async () => {
  let created = false;
  const calls = open("/fleet/drivers", "dispatch", (call) => {
    if (call.method === "GET" && call.url.pathname === "/tenant/v1/drivers") return page(created ? [driverOf()] : []);
    if (call.method === "POST" && call.url.pathname === "/tenant/v1/drivers") {
      const body = call.body as { phone: string };
      if (body.phone.startsWith("090")) return apiError(400, "VALIDATION_FAILED", "请求参数校验未通过", { location: "body", issues: [{ path: "/phone", reason: "INVALID_PHONE", message: "电话要写成带国家码的国际格式" }] });
      created = true;
      return json(201, driverOf());
    }
    return null;
  });
  const actor = user();
  await screen.findByText("还没有司机");
  await actor.click(screen.getByRole("button", { name: "新增司机" }));
  const dialog = await screen.findByRole("dialog", { name: "新增司机" });
  await actor.click(within(dialog).getByRole("button", { name: "保存" }));
  assert.ok(within(dialog).getByText("请填写姓名"));
  await actor.type(within(dialog).getByLabelText("姓名"), "佐藤一郎");
  await actor.type(within(dialog).getByLabelText("手机"), "090-1111-2222");
  await actor.type(within(dialog).getByLabelText("驾照到期日"), "2030-01-01");
  await actor.click(within(dialog).getByRole("button", { name: "保存" }));
  await within(dialog).findByText("电话要写成带国家码的国际格式");
  await actor.clear(within(dialog).getByLabelText("手机"));
  await actor.type(within(dialog).getByLabelText("手机"), "+81 90-1111-2222");
  await actor.click(within(dialog).getByRole("button", { name: "保存" }));
  await screen.findByText("+819011112222");
  const posts = calls.filter((call) => call.method === "POST");
  assert.equal(posts.length, 2);
  assert.deepEqual(posts[1]?.body, { name: "佐藤一郎", phone: "+81 90-1111-2222", languages: ["ja"], license_expires_on: "2030-01-01", driving_years: null, gold: false, status: "active" });
  assert.match(posts[1]?.headers["idempotency-key"] ?? "", /^[0-9a-f-]{36}$/);
  assert.equal(posts[0]?.headers["idempotency-key"], posts[1]?.headers["idempotency-key"], "同一次新增重试用同一个幂等键");

  resetBrowser();
  open("/fleet/drivers", "readonly", (call) => (call.url.pathname === "/tenant/v1/drivers" ? page([driverOf({ license_state: "expiring" })]) : null));
  await screen.findByText("佐藤一郎");
  assert.ok(screen.getByText("30 天内到期"));
  assertAbsent(screen.queryByRole("button", { name: "新增司机" }));
  assertAbsent(screen.queryByRole("button", { name: "停用" }));
});

test("车辆：非营业牌照不能设为可用（提交前就拦下）；停用发 DELETE", async () => {
  const calls = open("/fleet/vehicles", "admin", (call) => {
    if (call.method === "GET" && call.url.pathname === "/tenant/v1/vehicles") return page([vehicleOf()]);
    if (call.method === "DELETE" && call.url.pathname === `/tenant/v1/vehicles/${VEHICLE_ID}`) return json(200, vehicleOf({ status: "disabled" }));
    return null;
  });
  const actor = user();
  await screen.findByText("品川 300 あ 12-34");
  assert.ok(screen.getByText("新车"));
  await actor.click(screen.getByRole("button", { name: "新增车辆" }));
  const dialog = await screen.findByRole("dialog", { name: "新增车辆" });
  await actor.type(within(dialog).getByLabelText("车牌"), "练马 500 さ 1");
  await actor.type(within(dialog).getByLabelText("品牌车型"), "x");
  await actor.type(within(dialog).getByLabelText("座位数（含司机）"), "7");
  await actor.type(within(dialog).getByLabelText("累计里程（公里）"), "100");
  await actor.selectOptions(within(dialog).getByLabelText("牌照"), "private");
  await actor.type(within(dialog).getByLabelText("保险到期日"), "2030-01-01");
  await actor.type(within(dialog).getByLabelText("车检到期日"), "2030-01-01");
  await actor.click(within(dialog).getByRole("button", { name: "保存" }));
  assert.ok(within(dialog).getByText(/非营业牌照的车不能设为「可用」/));
  assert.equal(calls.filter((call) => call.method === "POST").length, 0);
  await actor.click(within(dialog).getByRole("button", { name: "取消" }));
  await actor.click(screen.getByRole("button", { name: "停用" }));
  await waitFor(() => assert.ok(calls.some((call) => call.method === "DELETE")));
});

test("Webhook：新建时签名密钥只在对话框里出现一次；只认 https；失败的推送可以重推；调度只能看", async () => {
  let settings: WebhookSettings = { webhook: null, encryption_configured: true, events: [{ event: "order.confirmed", name: "新订单" }, { event: "order.assigned", name: "派车和改派" }], rules: { timeout_ms: 5000, max_attempts: 7, retry_delays_seconds: [60, 300, 1800, 7200, 21600, 86400], signature_tolerance_seconds: 300 } };
  const calls = open("/settings/webhook", "admin", (call) => {
    if (call.method === "GET" && call.url.pathname === "/tenant/v1/webhooks") return json(200, settings);
    if (call.method === "GET" && call.url.pathname === "/tenant/v1/webhooks/deliveries") return page([deliveryOf()]);
    if (call.method === "PUT" && call.url.pathname === "/tenant/v1/webhooks") {
      const webhook = { url: "https://dispatch.example.com/hook", events: ["order.confirmed" as const], status: "active" as const, secret_hint: "SSSS", secret_created_at: stamps.updated_at, version: 1, ...stamps };
      settings = { ...settings, webhook };
      return json(201, { webhook, secret: SECRET });
    }
    if (call.method === "POST" && call.url.pathname === `/tenant/v1/webhooks/deliveries/${DELIVERY_ID}/retry`) return json(200, { delivery: deliveryOf({ status: "succeeded", attempts: 8, last_status_code: 200, last_error_code: null }) });
    return null;
  });
  const actor = user();
  await screen.findByRole("heading", { level: 1, name: "调度对接（Webhook）" });
  assert.ok(await screen.findByText(/失败后按 1 分钟、5 分钟、30 分钟、2 小时、6 小时、1 天 重试，共 7 次/));
  await actor.type(screen.getByLabelText("接收地址"), "http://dispatch.example.com/hook");
  await actor.click(screen.getByRole("button", { name: "保存并生成签名密钥" }));
  assert.ok(screen.getByText("只接受 https 开头的地址"));
  await actor.clear(screen.getByLabelText("接收地址"));
  await actor.type(screen.getByLabelText("接收地址"), "https://dispatch.example.com/hook");
  await actor.click(screen.getByRole("button", { name: "保存并生成签名密钥" }));
  const dialog = await screen.findByRole("dialog", { name: "签名密钥" });
  assert.equal((within(dialog).getByLabelText("签名密钥") as HTMLInputElement).value, SECRET);
  await actor.click(within(dialog).getByRole("button", { name: "我已保存" }));
  await waitFor(() => assert.ok(!(document.body.textContent ?? "").includes(SECRET)));
  assert.ok(await screen.findByText(/签名密钥末 4 位：SSSS/));
  assert.ok(screen.getByText("对方返回的不是 2xx（HTTP 503）"));
  await actor.click(screen.getByRole("button", { name: "重推" }));
  await waitFor(() => assert.ok(calls.some((call) => call.method === "POST" && call.path.endsWith("/retry"))));
  assert.deepEqual(calls.find((call) => call.method === "PUT")?.body, { url: "https://dispatch.example.com/hook", events: ["order.confirmed", "order.assigned"], status: "active" });

  resetBrowser();
  open("/settings/webhook", "dispatch", (call) => (call.url.pathname === "/tenant/v1/webhooks" ? json(200, settings) : call.url.pathname === "/tenant/v1/webhooks/deliveries" ? page([deliveryOf()]) : null));
  await screen.findByText(/签名密钥末 4 位/);
  assertAbsent(screen.queryByRole("button", { name: "保存" }));
  assertAbsent(screen.queryByRole("button", { name: "重推" }));
});

const tripOf = (changes: Partial<DriverTrip> = {}): DriverTrip => ({
  order: { order_no: "NZ20261007ABCDEFGH", status: "assigned", status_name: "已派车", category: "airport_transfer", direction: "pickup", service_time: "2026-10-20T01:00:00.000Z", service_local: "2026-10-20T10:00", timezone: "Asia/Tokyo", package_hours: null, passengers: 2, luggage: 1, flight_no: "NH211", passenger: { name: "王小明", phone: "+819012345678" }, messaging: null, notes: "举牌写王先生", place: { name: { zh: "成田机场" }, code: "NRT", lng: 140.3887, lat: 35.7686 }, pickup: null, dropoff: { lng: 139.76, lat: 35.68, address: "东京站八重洲口" }, pickup_point: { lng: 140.3887, lat: 35.7686 }, addons: [], driver_language: null, free_wait_minutes: 90 },
  driver: { name: "佐藤一郎" },
  vehicle: { plate: "品川 300 あ 12-34", model: "丰田埃尔法", color: "黑" },
  dispatchers: [{ name: "调度", phone: "0312345678" }],
  fulfilment: { departed_at: null, arrived_at: null, arrival_distance_m: null, picked_up_at: null, completed_at: null, leave_requested_at: null },
  landing: { scheduled_at: "2026-10-20T01:00:00.000Z", guest_reported_at: null, driver_reported_at: null, driver_photo_file_id: null, landed_at: "2026-10-20T01:00:00.000Z", source: "scheduled", disagreement: false, delay_minutes: 0, within_delay_allowance: true },
  free_wait: { start: "2026-10-20T01:00:00.000Z", end: "2026-10-20T02:30:00.000Z", ended: false },
  contacts: [],
  files: [],
  no_show: { checklist: [{ item: "arrived_on_time_nearby", ok: true, name: "按时到达" }, { item: "contact_attempts", ok: false, name: "联系 3 次" }], complete: false, leave_consent_at: null, submitted_at: null },
  link: { expires_at: "2026-10-21T01:00:00.000Z" },
  server_time: "2026-10-20T00:00:00.000Z",
  ...changes,
});

test("司机页面：令牌从 # 后面取、放在请求头里；有客人、电话、航班、导航，没有任何价格；点「我出发了」回传出发", async () => {
  denyGeolocation();
  let current = tripOf();
  const calls = stubApiWith((call) => {
    if (call.url.pathname === "/driver/v1/trip" && call.method === "GET") return json(200, current);
    if (call.url.pathname === "/driver/v1/trip/events" && call.method === "POST") {
      current = tripOf({ order: { ...tripOf().order, status: "departed", status_name: "司机已出发" } });
      return json(200, current);
    }
    return null;
  });
  render(
    <MemoryRouter initialEntries={[{ pathname: "/driver", hash: `#${LINK_TOKEN}` }]}>
      <App />
    </MemoryRouter>,
  );
  await screen.findByText(/王小明/);
  assert.equal(calls[0]?.headers["authorization"], `Bearer ${LINK_TOKEN}`);
  assert.ok(screen.getByText("航班 NH211"));
  assert.equal(screen.getByRole("link", { name: "+819012345678" }).getAttribute("href"), "tel:+819012345678");
  assert.equal(screen.getByRole("link", { name: "导航到上车点" }).getAttribute("href"), "geo:35.7686,140.3887?q=35.7686,140.3887");
  assert.ok(screen.getByText("上车点坐标：35.768600, 140.388700"));
  assert.doesNotMatch(document.body.textContent ?? "", /JPY|价格|结算|对外价|¥/);
  assert.ok(!(document.body.textContent ?? "").includes(LINK_TOKEN), "令牌不显示在页面上");
  await user().click(screen.getByRole("button", { name: "我出发了" }));
  await screen.findByRole("button", { name: "已到达上车点" });
  assert.deepEqual(calls.find((call) => call.method === "POST")?.body, { type: "departed", location: null });
});

test("司机页面：链接不完整或已失效时说明怎么办；到达后客人没出现，证据不齐时不能提交", async () => {
  stubApiWith(() => null);
  render(
    <MemoryRouter initialEntries={["/driver"]}>
      <App />
    </MemoryRouter>,
  );
  await screen.findByText("链接不完整");
  resetBrowser();

  stubApiWith((call) => (call.url.pathname === "/driver/v1/trip" ? apiError(401, "DRIVER_LINK_INVALID", "链接无效") : null));
  render(
    <MemoryRouter initialEntries={[{ pathname: "/driver", hash: `#${LINK_TOKEN}` }]}>
      <App />
    </MemoryRouter>,
  );
  await screen.findByText("链接无效或已过期，请联系调度重新发送。");
  resetBrowser();

  stubApiWith((call) => (call.url.pathname === "/driver/v1/trip" ? json(200, tripOf({ order: { ...tripOf().order, status: "arrived", status_name: "司机已到达" } })) : null));
  render(
    <MemoryRouter initialEntries={[{ pathname: "/driver", hash: `#${LINK_TOKEN}` }]}>
      <App />
    </MemoryRouter>,
  );
  await screen.findByRole("heading", { name: "客人没出现时" });
  assert.ok((screen.getByRole("button", { name: "提交「客人未出现」" }) as HTMLButtonElement).disabled);
  assert.ok((screen.getByRole("button", { name: "申请离开" }) as HTMLButtonElement).disabled, "免费等待没结束");
  assert.ok(screen.getByText("✗ 联系 3 次"));
});

test("运营后台推送记录：默认只看失败的；运营能重推，财务只能看", async () => {
  const calls = open("/platform/webhook-deliveries", "operations", (call) => {
    if (call.method === "GET" && call.url.pathname === "/platform/v1/webhook-deliveries") return page([{ ...deliveryOf(), tenant: { id: "t1", name: "甲车队" } }]);
    if (call.method === "POST" && call.url.pathname === `/platform/v1/webhook-deliveries/${DELIVERY_ID}/retry`) return json(200, { delivery: deliveryOf({ status: "succeeded" }) });
    return null;
  }, "platform");
  await screen.findByText("甲车队");
  const listed = calls.find((call) => urlOf(call).pathname === "/platform/v1/webhook-deliveries");
  assert.equal(listed === undefined ? null : urlOf(listed).searchParams.get("status"), "failed");
  await user().click(screen.getByRole("button", { name: "重推" }));
  await waitFor(() => assert.ok(calls.some((call) => call.method === "POST")));

  resetBrowser();
  open("/platform/webhook-deliveries", "finance", (call) => (call.url.pathname === "/platform/v1/webhook-deliveries" ? page([{ ...deliveryOf(), tenant: { id: "t1", name: "甲车队" } }]) : null), "platform");
  await screen.findByText("甲车队");
  assertAbsent(screen.queryByRole("button", { name: "重推" }));
});
