/**
 * 官网订单页的「投诉和反馈」（M4-03，pages/site-booking.md 5.10）的组件测试：已提交的工单和平台的回复；提交（类型、说明必填）后提示处理时限；
 * 服务结束超过 14 天的投诉说「已超过投诉时限」；待付款的单没有这一块；令牌只在 /site/v1/order/tickets 的 Authorization 头里。接口用测试替身。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { SiteConfig, SiteOrder, SiteOrderEnvelope, SiteTicket } from "../../api/site.ts";
import { type ApiCall, apiError, assertAbsent, json, resetBrowser, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const TOKEN = `nzo_${"Q".repeat(20)}_${"a".repeat(22)}`;
const openConfig: SiteConfig = { open: true, currency: "JPY", payments: null, support_phone: null, address_search: false, map_tiles: null };
const tiers = [{ min_hours_before: 48, fee_bp: 0 }, { min_hours_before: 24, fee_bp: 5000 }, { min_hours_before: 0, fee_bp: 10000 }];
const landingOf = (scheduledAt: string, reported: string | null = null): NonNullable<SiteOrder["landing"]> => ({
  scheduled_at: scheduledAt,
  guest_reported_at: reported,
  driver_reported_at: null,
  landed_at: reported ?? scheduledAt,
  source: reported === null ? "scheduled" : "guest",
  disagreement: false,
  delay_minutes: 0,
  within_delay_allowance: true,
});

const orderOf = (changes: Partial<SiteOrder> = {}): SiteOrder => ({
  id: "44444444-4444-4444-8444-444444444444",
  order_no: "NZ20261026QAQA2345",
  status: "confirmed",
  category: "airport_transfer",
  city_id: "11111111-1111-4111-8111-111111111111",
  place_id: "22222222-2222-4222-8222-222222222222",
  direction: "pickup",
  vehicle_group_id: "33333333-3333-4333-8333-333333333333",
  package_hours: null,
  service_time: "2030-11-20T01:00:00.000Z",
  service_local: "2030-11-20T10:00",
  timezone: "Asia/Tokyo",
  service_date: "2030-11-20",
  urgent: false,
  passengers: 2,
  luggage: 1,
  pickup: null,
  dropoff: { lng: 139.7, lat: 35.6, address: "新宿站南口" },
  addons: [],
  driver_language: null,
  flight_no: "NH211",
  passenger: { name: "李四", phone: "+819087654321", email: "qa@example.com" },
  messaging: null,
  notes: null,
  free_wait_minutes: 90,
  created_at: "2026-10-26T01:00:00.000Z",
  confirmed_at: "2026-10-26T01:05:00.000Z",
  cancelled_at: null,
  cancel_reason: null,
  quote_id: "QT20261026ABCDEFGHIJ",
  channel_order_no: null,
  price: { total: { amount: "21780", currency: "JPY" }, fx: null },
  payment_status: "succeeded",
  payment_due_at: "2026-10-26T01:30:00.000Z",
  winning_tenant: null,
  driver: null,
  vehicle: null,
  landing: landingOf("2030-11-20T01:00:00.000Z"),
  cancel_policy: { version: 0, category: "airport_transfer", level: "business", tiers },
  cancellation: null,
  free_cancel_available: true,
  changes: [],
  extra_charges: [],
  version: 3,
  ...changes,
});
const envelopeOf = (order: SiteOrder = orderOf()): SiteOrderEnvelope => ({
  order,
  timeline: [{ from_status: null, to_status: "pending_payment", reason: null, occurred_at: order.created_at }],
  names: { city: { code: "CTY-JP-TYO", name: { zh: "东京" } }, place: { code: "NRT", name: { zh: "成田机场" }, type: "airport" }, vehicle_group: { code: "VG-BIZ-7", name: { zh: "商务 7 座" }, seats: 7 } },
});

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;
const user = () => userEvent.setup();

const ticketOf = (changes: Partial<SiteTicket> = {}): SiteTicket => ({
  id: "t1",
  ticket_no: "TK20261026K3M9Q2",
  type: "complaint",
  source: "guest",
  subject: "司机迟到了 40 分钟",
  status: "in_progress",
  outcome: null,
  decided_at: null,
  created_at: "2026-10-26T03:00:00.000Z",
  replies: [],
  compensation: null,
  ...changes,
});

function open(order: SiteOrder, route: Route): ApiCall[] {
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

const section = async (): Promise<HTMLElement> => (await screen.findByRole("heading", { level: 2, name: "投诉和反馈" })).closest("section") as HTMLElement;

test("已提交的：处理状态用客人的说法；有结论和补偿的写出来；平台的回复按时间列出", async () => {
  open(orderOf({ status: "completed" }), (call) =>
    call.method === "GET" && call.url.pathname === "/site/v1/order/tickets"
      ? json(200, { items: [ticketOf({ status: "decided", outcome: "upheld", decided_at: "2026-10-27T03:00:00.000Z", replies: [{ body: "已核实司机迟到，补偿退回您的银行卡。", created_at: "2026-10-27T03:00:00.000Z" }], compensation: { scenario: "late_30_plus", compensation: { amount: "10890", currency: "JPY" }, reimbursement: { amount: "0", currency: "JPY" }, refund: { amount: "10890", currency: "JPY" }, other_payout: { amount: "0", currency: "JPY" }, payout_status: "none" } })] })
      : null,
  );
  const block = await section();
  await within(block).findByText("投诉服务：司机迟到了 40 分钟");
  assert.ok(within(block).getByText("已有结果"));
  assert.ok(within(block).getByText("投诉成立，平台按赔付标准给您补偿"));
  assert.match(block.textContent ?? "", /补偿 10,890 JPY，其中 10,890 JPY 原路退回您的银行卡/);
  const replies = within(block).getByRole("list", { name: "平台对「司机迟到了 40 分钟」的回复" });
  assert.ok(within(replies).getByText("已核实司机迟到，补偿退回您的银行卡。"));
});

test("提交：类型、一句话、经过都要填；提交后列出来并提示处理时限；令牌只在订单接口的 Authorization 头里", async () => {
  const bodies: unknown[] = [];
  const calls = open(orderOf({ status: "completed" }), (call) => {
    if (call.method === "GET" && call.url.pathname === "/site/v1/order/tickets") return json(200, { items: [] });
    if (call.method === "POST" && call.url.pathname === "/site/v1/order/tickets") {
      bodies.push(call.body);
      return json(201, { ticket: ticketOf({ status: "open" }) });
    }
    return null;
  });
  const u = user();
  const block = await section();
  await u.click(within(block).getByRole("button", { name: "提交投诉或反馈" }));
  await u.click(within(block).getByRole("button", { name: "提交" }));
  await within(block).findByText("请选择是哪类问题");
  assert.ok(within(block).getByText("请用一句话写是什么问题"));
  assert.ok(within(block).getByText("请写清楚经过，方便平台核实"));
  assert.equal(bodies.length, 0);
  await u.click(within(block).getByRole("radio", { name: /投诉服务/ }));
  await u.type(within(block).getByLabelText(/一句话说明/), "司机迟到了 40 分钟");
  await u.type(within(block).getByLabelText(/经过/), "航班 10:00 落地，司机 10:40 才到。");
  await u.click(within(block).getByRole("button", { name: "提交" }));
  await within(block).findByText(/已提交。平台一般 2 小时内答复（用车当天的 15 分钟内），3 个工作日内处理完/);
  assert.ok(within(block).getByText("投诉服务：司机迟到了 40 分钟"));
  assert.deepEqual(bodies, [{ type: "complaint", subject: "司机迟到了 40 分钟", description: "航班 10:00 落地，司机 10:40 才到。", language: "zh" }]);
  for (const call of calls.filter((entry) => entry.path.startsWith("/site/v1/order/tickets"))) {
    assert.equal(call.headers["authorization"], `Bearer ${TOKEN}`, call.path);
    assert.ok(!call.path.includes(TOKEN.slice(4)), "令牌不进地址");
    assert.ok(!JSON.stringify(call.body ?? {}).includes(TOKEN.slice(4)), "令牌不进请求体");
  }
  for (const store of [localStorage, sessionStorage]) for (let i = 0; i < store.length; i += 1) assert.ok(!(store.getItem(store.key(i) ?? "") ?? "").includes(TOKEN.slice(4)), "令牌不进存储");
  assert.ok(!document.title.includes(TOKEN.slice(4)));
});

test("服务结束超过 14 天的投诉：说「已超过投诉时限」，填的内容还在", async () => {
  open(orderOf({ status: "completed" }), (call) => {
    if (call.method === "GET" && call.url.pathname === "/site/v1/order/tickets") return json(200, { items: [] });
    if (call.method === "POST" && call.url.pathname === "/site/v1/order/tickets") return apiError(409, "COMPLAINT_WINDOW_CLOSED", "已经超过投诉时限（服务后 14 天内）");
    return null;
  });
  const u = user();
  const block = await section();
  await u.click(within(block).getByRole("button", { name: "提交投诉或反馈" }));
  await u.click(within(block).getByRole("radio", { name: /投诉服务/ }));
  await u.type(within(block).getByLabelText(/一句话说明/), "车况不好");
  await u.type(within(block).getByLabelText(/经过/), "空调坏了");
  await u.click(within(block).getByRole("button", { name: "提交" }));
  await within(block).findByText(/已超过投诉时限：服务结束后 14 天内可以投诉/);
  assert.equal((within(block).getByLabelText(/一句话说明/) as HTMLInputElement).value, "车况不好");
});

test("读不出已提交的反馈：说明并能重试；待付款的单没有这一块", async () => {
  let fail = true;
  open(orderOf({ status: "completed" }), (call) => {
    if (call.method !== "GET" || call.url.pathname !== "/site/v1/order/tickets") return null;
    if (fail) {
      fail = false;
      return apiError(500, "INTERNAL_ERROR", "x");
    }
    return json(200, { items: [ticketOf()] });
  });
  const block = await section();
  await within(block).findByText(/已提交的反馈没有读出来/);
  await user().click(within(block).getByRole("button", { name: "重试" }));
  await within(block).findByText("投诉服务：司机迟到了 40 分钟");
  resetBrowser();
  open(orderOf({ status: "pending_payment", payment_status: "creating", confirmed_at: null }), () => null);
  await screen.findByRole("heading", { level: 1, name: /订单 NZ/ });
  await waitFor(() => assert.ok(screen.getAllByRole("heading", { level: 2 }).length > 0));
  assertAbsent(screen.queryByRole("heading", { level: 2, name: "投诉和反馈" }));
});
