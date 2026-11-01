/**
 * M4-19 的组件测试：运营订单详情显示派车、履约时间点、落地（验收报告 M3-06 缺陷 2），缺字段时写明；
 * 以及验收报告 M5-02 里的文案：付款批次页、待审核页；渠道页 auth/me 失败不再停在加载态。接口用测试替身。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { screen, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { PlatformOrder, PlatformOrderDetail } from "../../api/order-money.ts";
import { orderEventNote } from "../../lib/order-money-display.ts";
import { NOT_DISPATCHED, NO_RECORDS, ORDER_ID, TENANT_ID, type Route, openApp, stamps } from "../../testing/order-center-fixtures.tsx";
import { json, resetBrowser } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const money = (amount: string) => ({ amount, currency: "JPY" });
const orderOf = (changes: Partial<PlatformOrder> = {}): PlatformOrder =>
  ({
    ...NOT_DISPATCHED,
    id: ORDER_ID,
    order_no: "NZ20261007ABCDEFGH",
    status: "assigned",
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
    tenant: { id: TENANT_ID, name: "乙车队" },
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
  }) as PlatformOrder;

const detailOf = (order: PlatformOrder, extra: Partial<PlatformOrderDetail> = {}): PlatformOrderDetail => ({ order, events: [], records: NO_RECORDS, payments: [], refunds: [], changes: [], extra_charges: [], rescues: [], exceptions: [], tickets: [], pending_proxy_review: null, ...extra });
const landing = { scheduled_at: "2026-10-20T01:00:00.000Z", guest_reported_at: null, driver_reported_at: null, driver_photo_file_id: null, landed_at: "2026-10-20T01:00:00.000Z", source: "scheduled" as const, disagreement: false, delay_minutes: 0, within_delay_allowance: true };

async function openDetail(detail: PlatformOrderDetail, role = "readonly"): Promise<void> {
  openApp(`/platform/orders/${ORDER_ID}`, "platform", role, (call) => (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}` ? json(200, detail) : null));
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
}
const sectionText = (name: RegExp): string => screen.getByRole("heading", { name }).closest("section")?.textContent ?? "";

test("没派车、还没履约的接机单：每一项都写明，不空白；落地写明现在按计划到达算", async () => {
  await openDetail(detailOf(orderOf({ status: "confirmed", landing })));
  const dispatch = sectionText(/^派车（/);
  assert.match(dispatch, /派车时间还没派车/);
  assert.match(dispatch, /司机还没派车/);
  assert.match(dispatch, /车辆还没派车/);
  assert.match(dispatch, /司机链接没有有效的链接/);
  const fulfilment = sectionText(/^履约/);
  for (const label of ["司机出发", "到达上车点", "接到客人", "完成"]) assert.match(fulfilment, new RegExp(`${label}还没有记录`), label);
  const land = sectionText(/^落地/);
  assert.match(land, /计划到达2026-10-20 10:00/);
  assert.match(land, /实际落地（按规则取定）2026-10-20 10:00（来源：计划到达时间）/);
  assert.match(land, /客人确认客人没有确认/);
  assert.match(land, /司机填写司机没有填写/);
  assert.match(land, /延误没有延误/);
  assert.match(land, /都还没有报落地时间/);
  for (const name of [/^派车（/, /^履约/, /^落地/]) for (const value of within(screen.getByRole("heading", { name }).closest("section") as HTMLElement).queryAllByRole("definition")) assert.notEqual(value.textContent?.trim(), "", `${name} 有空白`);
});

test("没付款的单写明不派车；不是接机的单写明不记落地时间", async () => {
  await openDetail(detailOf(orderOf({ status: "pending_payment", confirmed_at: null, category: "point_to_point", direction: null, flight_no: null, dispatch: { ...NOT_DISPATCHED.dispatch, due_at: null } })));
  const dispatch = sectionText(/^派车（/);
  assert.match(dispatch, /派车截止没有（还没付款）/);
  assert.match(dispatch, /司机还没付款，不派车/);
  assert.match(sectionText(/^落地/), /这一单不是接机，不记落地时间/);
});

test("履约中的单：派车、司机链接、改派记录、时间点（当地时间）、距上车点、落地来源、时间不一致的提示都显示出来", async () => {
  const order = orderOf({
    status: "completed",
    dispatch: { ...NOT_DISPATCHED.dispatch, assigned_at: "2026-10-19T00:00:00.000Z", driver: { id: "d1", name: "佐藤一郎", phone: "+819011112222", languages: ["ja"], gold: false }, vehicle: { id: "v1", plate: "品川 300 あ 12-34", vehicle_group_id: "g1", model: "丰田埃尔法", color: "黑", seats: 7, is_new: false } },
    fulfilment: { departed_at: "2026-10-20T00:10:00.000Z", arrived_at: "2026-10-20T00:50:00.000Z", arrival_distance_m: 120, arrival_within_range: true, picked_up_at: "2026-10-20T02:00:00.000Z", completed_at: "2026-10-20T03:00:00.000Z", actual_minutes: null, actual_km: null, leave_requested_at: null },
    landing: { ...landing, guest_reported_at: "2026-10-20T01:20:00.000Z", driver_reported_at: "2026-10-20T01:30:00.000Z", driver_photo_file_id: "f1", landed_at: "2026-10-20T01:30:00.000Z", source: "driver", disagreement: true, delay_minutes: 30 },
  });
  await openDetail(detailOf(order, { records: { ...NO_RECORDS, driver_link: { id: "l1", status: "active", created_at: stamps.created_at, expires_at: "2026-10-21T01:00:00.000Z", last_used_at: null }, assignments: [{ id: "a1", driver_id: "d1", vehicle_id: "v1", is_change: false, conflict_confirmed: false, assigned_at: "2026-10-18T00:00:00.000Z" }, { id: "a2", driver_id: "d1", vehicle_id: "v1", is_change: true, conflict_confirmed: true, assigned_at: "2026-10-19T00:00:00.000Z" }] } }));
  const dispatch = sectionText(/^派车（/);
  assert.match(dispatch, /佐藤一郎 · \+819011112222/);
  assert.match(dispatch, /品川 300 あ 12-34 · 丰田埃尔法/);
  assert.match(dispatch, /有效，到 2026-10-21 10:00；司机还没打开过/);
  assert.match(dispatch, /2026-10-19 09:00 改派（调度确认过时段冲突）/);
  const fulfilment = sectionText(/^履约/);
  assert.match(fulfilment, /司机出发2026-10-20 09:10/);
  assert.match(fulfilment, /到达上车点2026-10-20 09:50（距上车点 120 米）/);
  assert.match(fulfilment, /完成2026-10-20 12:00/);
  const land = sectionText(/^落地/);
  assert.match(land, /实际落地（按规则取定）2026-10-20 10:30（来源：司机填写（附到达屏照片））/);
  assert.match(land, /客人确认2026-10-20 10:20/);
  assert.match(land, /延误30 分钟（6 小时内/);
  assert.match(land, /不一致，取较晚的那个/);
});

test("平台代传的节点标出来，没有定位的到达写明；no-show 申请的证据项显示", async () => {
  const proxied = { actor: "platform_user", occurred_at: "2026-10-20T00:50:00.000Z", source: "platform_proxy" as const, recorded_at: "2026-10-20T01:00:00.000Z" };
  await openDetail(detailOf(orderOf({ status: "no_show_claimed", fulfilment: { ...NOT_DISPATCHED.fulfilment, departed_at: "2026-10-20T00:10:00.000Z", arrived_at: "2026-10-20T00:50:00.000Z" } }), {
    events: [{ ...proxied, from_status: "departed", to_status: "arrived", reason: "ARRIVED" }],
    records: { ...NO_RECORDS, no_show_claim: { status: "pending_review", submitted_at: "2026-10-20T03:00:00.000Z", free_wait_start: "2026-10-20T01:00:00.000Z", free_wait_end: "2026-10-20T02:30:00.000Z", checklist: [{ item: "contact_attempts", ok: true }, { item: "signboard_photo", ok: false }] } },
  }));
  const fulfilment = sectionText(/^履约/);
  assert.match(fulfilment, /到达上车点2026-10-20 09:50（没有定位） 平台代传/);
  assert.doesNotMatch(fulfilment, /司机出发[^到]*平台代传/);
  const evidence = sectionText(/^no-show 证据/);
  assert.match(evidence, /2026-10-20 12:00 提交，等平台审核/);
  assert.match(evidence, /✓ 满足：免费等待内至少 3 次联系/);
  assert.match(evidence, /✗ 不满足：在上车点举牌的照片/);
  assert.match(evidence, /？没有核对记录：用车后 24 小时内提交/);
});

test("状态流水不把内部代码给人看：履约步骤不写括号，取消写中文原因，其余有中文说明的写中文", async () => {
  assert.equal(orderEventNote({ to_status: "departed", reason: "DEPARTED" }, true), "");
  assert.equal(orderEventNote({ to_status: "confirmed", reason: "PAYMENT_SUCCEEDED" }, true), "");
  assert.equal(orderEventNote({ to_status: "assigned", reason: "REASSIGNED" }, true), "（改派）");
  assert.equal(orderEventNote({ to_status: "confirmed", reason: null }, true), "");
  assert.match(orderEventNote({ to_status: "cancelled", reason: "FORCE_MAJEURE" }, true), /^（不可抗力/);
  await openDetail(detailOf(orderOf({ status: "departed" }), { events: [{ from_status: "assigned", to_status: "departed", actor: "driver", reason: "DEPARTED", occurred_at: "2026-10-20T00:10:00.000Z", source: null, recorded_at: null }] }));
  assert.doesNotMatch(sectionText(/^状态流水/), /DEPARTED/);
});

test("付款批次页不再说转账文件在下一期", async () => {
  openApp("/platform/finance/payout-batches", "platform", "finance", (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/payout-batches" ? json(200, { items: [] }) : null));
  const lead = await screen.findByText(/一个付款日一个批次/);
  assert.doesNotMatch(lead.textContent ?? "", /M5-02|下一期/);
  assert.match(lead.textContent ?? "", /生成银行转账文件，转账后回填银行流水号/);
});

test("待审核页的说明和空状态列出了启用收款账户、生成转账文件和代传完成", async () => {
  openApp("/platform/approvals", "platform", "finance", (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/approvals" ? json(200, { items: [], next_cursor: null, total: 0 }) : null));
  const empty = await screen.findByRole("heading", { name: "没有待审核的改动" });
  const page = document.body.textContent ?? "";
  for (const text of ["启用收款账户", "生成转账文件", "代供应商回传「已接到客人」「已完成」"]) assert.ok(page.includes(text), text);
  assert.match(empty.parentElement?.textContent ?? "", /启用收款账户、生成转账文件/);
});

const meFailsOnce = (rest: Route = () => null): Route => {
  let attempts = 0;
  return (call) => {
    if (call.url.pathname !== "/platform/v1/auth/me") return rest(call);
    attempts += 1;
    return attempts === 1 ? json(500, { error: { code: "INTERNAL_ERROR", message: "出错了", details: {} } }) : null;
  };
};

test("渠道列表：账号信息取不到时不停在加载态，显示加载失败，重试后恢复", async () => {
  const user = userEvent.setup();
  openApp("/platform/channels", "platform", "channel_manager", meFailsOnce((call) => (call.method === "GET" && call.url.pathname === "/platform/v1/channels" ? json(200, { items: [], next_cursor: null, total: 0 }) : null)));
  await screen.findByRole("heading", { name: "加载失败" });
  assert.equal(document.querySelector(".skeleton"), null);
  await user.click(screen.getByRole("button", { name: "重试" }));
  await screen.findByRole("heading", { name: /还没有渠道/ });
});

test("渠道详情：账号信息取不到时不停在加载态，显示加载失败，有重试", async () => {
  openApp("/platform/channels/99999999-9999-4999-8999-999999999999", "platform", "channel_manager", meFailsOnce());
  await screen.findByRole("heading", { name: "加载失败" });
  assert.equal(document.querySelector(".skeleton"), null);
  assert.ok(screen.getByRole("button", { name: "重试" }));
});

test("乘客默认打码：只读员工也要点「查看联系方式」才看到全文和邮箱，写明会记审计；失败时提示，不显示全文", async () => {
  const user = userEvent.setup();
  const masked = { name: "王**", phone: "+********5678", email: "g***@example.com" };
  const calls = openApp(`/platform/orders/${ORDER_ID}`, "platform", "readonly", (call) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}`) return json(200, detailOf(orderOf({ passenger: masked })));
    if (call.method === "POST" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}/passenger/reveal`) return json(200, { passenger: { name: "王小明", phone: "+819012345678", email: "guest@example.com" }, messaging: null, notes: null, anonymized_at: null, texts: [] });
    return null;
  });
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
  const trip = sectionText(/^行程/);
  assert.match(trip, /王\*\* · \+\*+5678/);
  assert.match(trip, /查看会记进审计日志/);
  assert.doesNotMatch(trip, /王小明|guest@/);
  assert.equal(calls.filter((call) => call.method === "POST").length, 0, "打开页面不算查看");
  await user.click(screen.getByRole("button", { name: "查看联系方式" }));
  await screen.findByText(/王小明 · \+819012345678 · guest@example.com/);
  assert.equal(screen.queryByRole("button", { name: "查看联系方式" }), null);
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
  resetBrowser();

  openApp(`/platform/orders/${ORDER_ID}`, "platform", "readonly", (call) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}`) return json(200, detailOf(orderOf({ passenger: masked })));
    if (call.method === "POST") return json(500, { error: { code: "INTERNAL_ERROR", message: "出错了", details: {} } });
    return null;
  });
  await user.click(await screen.findByRole("button", { name: "查看联系方式" }));
  assert.ok(await screen.findByText(/系统暂时无法查看/));
  assert.match(sectionText(/^行程/), /王\*\*/);
});
