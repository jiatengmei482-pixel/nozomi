/**
 * M4-03 测试角色：官网订单页的「投诉和反馈」（pages/site-booking.md 5.10）——补边界：
 * - 一单提得太多（TICKET_LIMIT_REACHED）、网络断了：写在表单上方，填的内容都在，再点一次能提交；
 * - 连点两次「提交」只发一次（不重复建工单）；
 * - 补偿的金额：美元两位小数、另行支付的处理中 / 已支付；平台的回复不显示是哪位员工。
 * 接口用测试替身。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { SiteConfig, SiteOrder, SiteOrderEnvelope, SiteTicket } from "../../api/site.ts";
import { type ApiCall, apiError, deferred, json, resetBrowser, stubApiWith } from "../../testing/harness.tsx";

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

async function fill(block: HTMLElement, u: ReturnType<typeof user>): Promise<void> {
  await u.click(within(block).getByRole("button", { name: "提交投诉或反馈" }));
  await u.click(within(block).getByRole("radio", { name: /失物招领/ }));
  await u.type(within(block).getByLabelText(/一句话说明/), "伞落在车上");
  await u.type(within(block).getByLabelText(/经过/), "黑色长柄伞，放在后排");
}

function assertKept(block: HTMLElement): void {
  assert.equal((within(block).getByLabelText(/一句话说明/) as HTMLInputElement).value, "伞落在车上");
  assert.equal((within(block).getByLabelText(/经过/) as HTMLTextAreaElement).value, "黑色长柄伞，放在后排");
  assert.equal((within(block).getByRole("radio", { name: /失物招领/ }) as HTMLInputElement).checked, true);
}

test("一单提得太多（TICKET_LIMIT_REACHED）：说「这一单已经提了很多次，请直接联系客服」，填的内容都在", async () => {
  open(orderOf({ status: "completed" }), (call) => {
    if (call.method === "GET" && call.url.pathname === "/site/v1/order/tickets") return json(200, { items: [] });
    if (call.method === "POST" && call.url.pathname === "/site/v1/order/tickets") return apiError(409, "TICKET_LIMIT_REACHED", "这一单的工单太多了");
    return null;
  });
  const u = user();
  const block = await section();
  await fill(block, u);
  await u.click(within(block).getByRole("button", { name: "提交" }));
  await within(block).findByText("这一单已经提了很多次，请直接联系客服。");
  assertKept(block);
});

test("网络断了：说明是网络问题、填的内容都在；再点一次「提交」成功，列表里多一条", async () => {
  let posts = 0;
  open(orderOf({ status: "completed" }), (call) => {
    if (call.method === "GET" && call.url.pathname === "/site/v1/order/tickets") return json(200, { items: [] });
    if (call.method === "POST" && call.url.pathname === "/site/v1/order/tickets") {
      posts += 1;
      return posts === 1 ? Promise.reject(new TypeError("Failed to fetch")) : json(201, { ticket: ticketOf({ type: "lost_and_found", subject: "伞落在车上", status: "open" }) });
    }
    return null;
  });
  const u = user();
  const block = await section();
  await fill(block, u);
  await u.click(within(block).getByRole("button", { name: "提交" }));
  await waitFor(() => assert.equal(posts, 1));
  await waitFor(() => assert.ok(/网络|连接/.test(block.textContent ?? ""), "写明是网络问题"));
  assertKept(block);
  await u.click(within(block).getByRole("button", { name: "提交" }));
  await within(block).findByText("失物招领：伞落在车上");
  assert.equal(posts, 2);
});

test("连点两次「提交」只发一次请求（不会建两张工单）", async () => {
  const pending = deferred();
  let posts = 0;
  open(orderOf({ status: "completed" }), (call) => {
    if (call.method === "GET" && call.url.pathname === "/site/v1/order/tickets") return json(200, { items: [] });
    if (call.method === "POST" && call.url.pathname === "/site/v1/order/tickets") {
      posts += 1;
      return pending.promise;
    }
    return null;
  });
  const u = user();
  const block = await section();
  await fill(block, u);
  const submit = within(block).getByRole("button", { name: "提交" });
  await u.click(submit);
  await u.click(submit);
  await u.keyboard("{Enter}");
  pending.resolve(json(201, { ticket: ticketOf({ type: "lost_and_found", subject: "伞落在车上", status: "open" }) }));
  await within(block).findByText("失物招领：伞落在车上");
  assert.equal(posts, 1);
});

test("补偿：美元两位小数；退回银行卡和另行支付分开写，另付写「处理中」/「已支付」；平台的回复不写是哪位员工", async () => {
  const usd = (amount: string) => ({ amount, currency: "USD" });
  open(orderOf({ status: "completed" }), (call) =>
    call.method === "GET" && call.url.pathname === "/site/v1/order/tickets"
      ? json(200, {
          items: [
            ticketOf({ id: "a", subject: "司机没来", status: "decided", outcome: "upheld", decided_at: "2026-10-27T03:00:00.000Z", replies: [{ body: "已核实，补偿见下方。", created_at: "2026-10-27T03:00:00.000Z" }], compensation: { scenario: "driver_no_show", compensation: usd("145.20"), reimbursement: usd("30.05"), refund: usd("145.20"), other_payout: usd("30.05"), payout_status: "pending" } }),
            ticketOf({ id: "b", subject: "迟到", status: "closed", outcome: "upheld", decided_at: "2026-10-27T03:00:00.000Z", compensation: { scenario: "late_15_29", compensation: usd("3.30"), reimbursement: usd("0.00"), refund: usd("0.00"), other_payout: usd("3.30"), payout_status: "paid" } }),
          ],
        })
      : null,
  );
  const block = await section();
  await within(block).findByText("投诉服务：司机没来");
  const text = block.textContent ?? "";
  assert.match(text, /补偿 145\.20 USD，其中 145\.20 USD 原路退回您的银行卡，30\.05 USD 由平台另行支付（处理中）/);
  assert.match(text, /补偿 3\.30 USD，3\.30 USD 由平台另行支付（已支付）/);
  assert.ok(!text.includes("0.00 USD 原路退回"), "0 元的退回不写");
  const replies = within(block).getByRole("list", { name: "平台对「司机没来」的回复" });
  assert.match(replies.textContent ?? "", /^平台的回复 · /);
  assert.ok(!/佐藤|测试员工|@/.test(replies.textContent ?? ""));
});
