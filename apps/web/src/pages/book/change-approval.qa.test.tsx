/**
 * M4-29 测试角色：官网页面的文案和后端规则一致（ADR 0060）。接口用测试替身；真实后端见 `change-approval-*.qa.itest.ts`，真实浏览器见 `e2e/change-approval.qa.spec.ts`。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { SiteOrder, SiteOrderEnvelope } from "../../api/site.ts";
import { assertAbsent, json, resetBrowser, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const TOKEN = `nzo_${"Q".repeat(43)}`;
const tiers = [{ min_hours_before: 48, fee_bp: 0 }, { min_hours_before: 24, fee_bp: 5000 }, { min_hours_before: 0, fee_bp: 10000 }];
const order = (changes: Partial<SiteOrder>): SiteOrder =>
  ({
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
    dropoff: { lng: 139.7, lat: 35.6, address: "东京站八重洲口" },
    addons: [],
    driver_language: null,
    flight_no: "NH211",
    passenger: { name: "虚构乘客", phone: "+819012345678", email: "guest@example.com" },
    messaging: null,
    notes: null,
    free_wait_minutes: 90,
    created_at: "2026-10-26T01:00:00.000Z",
    confirmed_at: "2026-10-26T01:05:00.000Z",
    cancelled_at: null,
    cancel_reason: null,
    quote_id: "QT1",
    channel_order_no: null,
    price: { total: { amount: "21780", currency: "JPY" }, fx: null },
    payment_status: "succeeded",
    payment_due_at: "2026-10-26T01:30:00.000Z",
    winning_tenant: null,
    driver: null,
    vehicle: null,
    landing: null,
    cancel_policy: { version: 0, category: "airport_transfer", level: "business", tiers },
    cancellation: null,
    free_cancel_available: false,
    changes: [],
    extra_charges: [],
    version: 3,
    ...changes,
  }) as SiteOrder;
const change = (status: SiteOrder["changes"][number]["status"], fields: string[]): SiteOrder["changes"][number] => ({ id: "c1", status, fields, before: {}, after: {}, price_difference: null, confirm_due_at: null, requested_at: "2026-10-27T00:00:00.000Z", decided_at: null }) as SiteOrder["changes"][number];
const envelope = (value: SiteOrder): SiteOrderEnvelope => ({ order: value, timeline: [], names: { city: { code: "CTY-JP-TYO", name: { zh: "东京" } }, place: { code: "NRT", name: { zh: "成田机场" }, type: "airport" }, vehicle_group: { code: "VG-BIZ-7", name: { zh: "商务 7 座" }, seats: 7 } } }) as SiteOrderEnvelope;

function open(value: SiteOrder, patched?: SiteOrder): void {
  stubApiWith((call) => {
    if (call.url.pathname === "/site/v1/config") return json(200, { open: true, currency: "JPY", payments: null, support_phone: null, address_search: false, map_tiles: null });
    if (call.method === "GET" && call.url.pathname === "/site/v1/order") return json(200, envelope(value));
    if (call.method === "PATCH" && call.url.pathname === "/site/v1/order" && patched !== undefined) return json(200, { ...envelope(patched), change: patched.changes[patched.changes.length - 1] });
    return null;
  });
  render(
    <MemoryRouter initialEntries={[{ pathname: "/book/order", hash: `#${TOKEN}` }]}>
      <App />
    </MemoryRouter>,
  );
}

test("缺陷：人数、地址的申请被拒，免费取消按钮还写「改期没有被确认」——客人没有改期", async () => {
  open(order({ free_cancel_available: true, changes: [change("rejected", ["passengers"])] }));
  await screen.findByText(/您的修改没有通过/);
  assert.ok(screen.getByRole("button", { name: /免费取消/ }));
  assertAbsent(screen.queryByRole("button", { name: /改期/ }));
});

test("缺陷：只提交了行李，页面却说「姓名、电话、邮箱、备注已直接生效」——客人没改这些，会以为改了什么", async () => {
  open(order({}), order({ changes: [change("pending_confirmation", ["luggage"])] }));
  const actor = userEvent.setup();
  await actor.click(await screen.findByRole("button", { name: "修改订单" }));
  const luggage = screen.getByLabelText("行李（件）");
  await actor.clear(luggage);
  await actor.type(luggage, "3");
  await actor.click(screen.getByRole("button", { name: "提交修改" }));
  const notice = await screen.findByText(/^修改已提交，等服务方确认/);
  assert.doesNotMatch(notice.textContent ?? "", /已直接生效/);
});

test("调整中、补差价中都按「修改待确认」提示，订单内容不变；只有没结论时才提示", async () => {
  for (const status of ["pending_confirmation", "adjusting", "awaiting_payment"] as const) {
    open(order({ changes: [change(status, ["service_time"])] }));
    assert.ok(await screen.findByText(/^修改待确认：/), status);
    resetBrowser();
  }
  for (const status of ["applied", "failed", "cancelled", "rejected", "expired"] as const) {
    open(order({ changes: [change(status, ["service_time"])] }));
    await screen.findByRole("heading", { level: 1, name: /订单 NZ/ });
    assertAbsent(screen.queryByText(/^修改待确认：/));
    resetBrowser();
  }
});
