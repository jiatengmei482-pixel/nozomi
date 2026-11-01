/**
 * M4-18 / M4-19 测试角色补充：运营订单详情的边角。order-detail-m419.test.tsx、proxy-fulfilment.test.tsx 已有的不重复。
 * - 改派之后「平台代传」标记要跟着当前这一次履约走；
 * - 手写的原因里有 HTML 只能是文字；
 * - 司机链接只显示状态，没有能打开司机页的东西；
 * - 全部取消原因和状态流水都不出英文代码；
 * - 复核发生时间过期时，审核人看得到具体原因。
 * 接口用测试替身，数据全部虚构。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { ORDER_CANCEL_REASONS } from "@nozomi/domain";
import { screen } from "@testing-library/react";
import { ApiError } from "../../api/client.ts";
import type { PlatformOrder, PlatformOrderDetail } from "../../api/order-money.ts";
import { orderEventNote } from "../../lib/order-money-display.ts";
import { NOT_DISPATCHED, NO_RECORDS, ORDER_ID, TENANT_ID, openApp, stamps } from "../../testing/order-center-fixtures.tsx";
import { json, resetBrowser } from "../../testing/harness.tsx";
import { decisionFailure } from "./ApprovalsPage.tsx";

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

async function openDetail(detail: PlatformOrderDetail, role = "readonly"): Promise<void> {
  openApp(`/platform/orders/${ORDER_ID}`, "platform", role, (call) => (call.method === "GET" && call.url.pathname === `/platform/v1/orders/${ORDER_ID}` ? json(200, detail) : null));
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261007ABCDEFGH" });
}
const sectionText = (name: RegExp): string => screen.getByRole("heading", { name }).closest("section")?.textContent ?? "";
const itemText = (section: RegExp, label: string): string => {
  const card = screen.getByRole("heading", { name: section }).closest("section") as HTMLElement;
  const term = [...card.querySelectorAll("dt")].find((dt) => dt.textContent === label) as HTMLElement;
  return term.parentElement?.textContent ?? "";
};

const proxiedDeparture = { from_status: "assigned", to_status: "departed", actor: "platform_user", reason: "DEPARTED", occurred_at: "2026-10-20T00:10:00.000Z", source: "platform_proxy", recorded_at: "2026-10-20T00:12:00.000Z", proxy: { reason: "虚构原因", requested_by: "u1", approved_by: null, approval_id: null } } as const;
const reassigned = { from_status: "departed", to_status: "assigned", actor: "tenant_user", reason: "REASSIGNED", occurred_at: "2026-10-20T00:20:00.000Z", source: null, recorded_at: null } as const;

test("代传出发后被改派、还没有重新出发：履约块的「司机出发」是空的，不能标平台代传", async () => {
  await openDetail(detailOf(orderOf({ status: "assigned", fulfilment: { ...NOT_DISPATCHED.fulfilment, departed_at: null } }), { events: [proxiedDeparture, reassigned] }));
  assert.doesNotMatch(itemText(/^履约/, "司机出发"), /平台代传/);
});

test("代传出发后被改派、新司机自己点了出发：这个时间是司机自己报的，不能标平台代传（运营靠这个标记判断时间可不可信）", async () => {
  const own = { from_status: "assigned", to_status: "departed", actor: "driver", reason: "DEPARTED", occurred_at: "2026-10-20T00:30:00.000Z", source: null, recorded_at: null } as const;
  await openDetail(detailOf(orderOf({ status: "departed", fulfilment: { ...NOT_DISPATCHED.fulfilment, departed_at: "2026-10-20T00:30:00.000Z" } }), { events: [proxiedDeparture, reassigned, own] }));
  assert.doesNotMatch(itemText(/^履约/, "司机出发"), /平台代传/);
});

test("反过来：供应商自己出发、改派后再由平台代传的，要标平台代传", async () => {
  const own = { from_status: "assigned", to_status: "departed", actor: "tenant_user", reason: "DEPARTED", occurred_at: "2026-10-20T00:10:00.000Z", source: null, recorded_at: null } as const;
  await openDetail(detailOf(orderOf({ status: "departed", fulfilment: { ...NOT_DISPATCHED.fulfilment, departed_at: "2026-10-20T00:30:00.000Z" } }), { events: [own, reassigned, { ...proxiedDeparture, occurred_at: "2026-10-20T00:30:00.000Z" }] }));
  assert.match(itemText(/^履约/, "司机出发"), /平台代传/);
});

test("原因里的 HTML 只显示成文字，不变成元素", async () => {
  const html = '<img src=x onerror="alert(1)"><b>虚构</b>';
  await openDetail(detailOf(orderOf({ status: "departed", fulfilment: { ...NOT_DISPATCHED.fulfilment, departed_at: "2026-10-20T00:10:00.000Z" } }), { events: [{ ...proxiedDeparture, proxy: { ...proxiedDeparture.proxy, reason: html } }] }));
  const flow = screen.getByRole("heading", { name: /^状态流水/ }).closest("section") as HTMLElement;
  assert.ok((flow.textContent ?? "").includes(html));
  assert.equal(flow.querySelector("img, b"), null);
});

test("司机链接：接口万一多给了令牌也不显示，页面上没有指向司机页的链接，只有状态", async () => {
  const leaked = "drv_fictional_secret_token_value";
  await openDetail(detailOf(orderOf(), { records: { ...NO_RECORDS, driver_link: { id: "link-id-fictional", status: "active", created_at: stamps.created_at, expires_at: "2026-10-21T01:00:00.000Z", last_used_at: null, token: leaked, url: `https://example.test/driver/${leaked}` } as never } }));
  const body = document.body.innerHTML;
  assert.ok(!body.includes(leaked));
  assert.ok(!body.includes("link-id-fictional"));
  assert.equal(document.querySelector('a[href*="driver"]'), null);
  assert.match(sectionText(/^派车（/), /有效，到 2026-10-21 10:00/);
});

test("状态流水：每一种取消原因都是中文；履约类和未知的代码不原样显示给人", () => {
  for (const reason of ORDER_CANCEL_REASONS) {
    for (const paid of [true, false]) assert.doesNotMatch(orderEventNote({ to_status: "cancelled", reason }, paid), /[A-Z]{2,}/, reason);
  }
  for (const reason of ["CREATED", "ASSIGNED", "ARRIVED", "PICKED_UP", "COMPLETED", "NO_SHOW_CLAIMED", "NO_SHOW_REJECTED", "SOME_FUTURE_REASON"]) assert.doesNotMatch(orderEventNote({ to_status: "completed", reason }, true), /[A-Z]{2,}/, reason);
});

test("落地：超过 6 小时写明；没有航班号写明；司机没附照片不写附照片", async () => {
  const landing = { scheduled_at: "2026-10-20T01:00:00.000Z", guest_reported_at: null, driver_reported_at: "2026-10-20T08:00:00.000Z", driver_photo_file_id: null, landed_at: "2026-10-20T08:00:00.000Z", source: "scheduled", disagreement: false, delay_minutes: 420, within_delay_allowance: false };
  await openDetail(detailOf(orderOf({ flight_no: null, landing } as never)));
  const land = sectionText(/^落地/);
  assert.match(land, /延误420 分钟（超过 6 小时）/);
  assert.match(land, /航班号没有填/);
  assert.doesNotMatch(itemText(/^落地/, "司机填写"), /附到达屏照片/);
});

test("批准时发生时间已过期（400 TOO_OLD）：审核人看到具体原因并被引导驳回，不是笼统的「提交失败」", () => {
  const message = "发生时间不能早于 7 天前，更早的请走工单";
  const text = decisionFailure(new ApiError(400, "VALIDATION_FAILED", "请求参数校验未通过", { location: "body", issues: [{ path: "/occurred_at", reason: "TOO_OLD", message }] }, null));
  assert.ok(text.includes(message), text);
  assert.ok(text.includes("驳回"), text);
});
