/**
 * 官网的点对点、包车（M3-10）在订单页的组件测试：按服务显示行程、改单只给这一单有的地址。
 * 询价、下单在预订页的测试里（new/book-new.test.tsx；M8-05 删掉了旧询价页的服务单选、常用地点下拉框和旧下单页）。
 * 接口用测试替身；真实后端由集成测试 site-categories.itest.ts 和端到端测试 e2e/site-booking-categories.spec.ts 覆盖。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { SiteOrder, SiteOrderEnvelope } from "../../api/site.ts";
import { changeRequestOf } from "./OrderSections.tsx";
import { type ApiCall, assertAbsent, json, resetBrowser, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const CITY_ID = "11111111-1111-4111-8111-111111111111";
const GROUP_ID = "33333333-3333-4333-8333-333333333333";
const ORDER_ID = "44444444-4444-4444-8444-444444444444";
const TOKEN = `nzo_${"A".repeat(43)}`;

const tiers = [{ min_hours_before: 48, fee_bp: 0 }, { min_hours_before: 24, fee_bp: 5000 }, { min_hours_before: 0, fee_bp: 10000 }];

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;
const user = () => userEvent.setup();

function open(entry: string | { pathname: string; hash?: string; state?: unknown }, route: Route): ApiCall[] {
  const calls = stubApiWith(route);
  render(
    <MemoryRouter initialEntries={[entry]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

const charterOrder = (changes: Partial<SiteOrder> = {}): SiteOrder => ({
  id: ORDER_ID,
  order_no: "NZ20261026ABCD2345",
  status: "confirmed",
  category: "charter",
  city_id: CITY_ID,
  place_id: null,
  direction: null,
  vehicle_group_id: GROUP_ID,
  package_hours: 8,
  service_time: "2030-11-20T01:00:00.000Z",
  service_local: "2030-11-20T10:00",
  timezone: "Asia/Tokyo",
  service_date: "2030-11-20",
  urgent: false,
  passengers: 3,
  luggage: 2,
  pickup: { lng: 139.7671, lat: 35.6812, address: "东京站八重洲口" },
  dropoff: null,
  addons: [],
  driver_language: null,
  flight_no: null,
  passenger: { name: "陈小红", phone: "+819022223333", email: "guest@example.com" },
  messaging: null,
  notes: null,
  free_wait_minutes: 30,
  created_at: "2026-10-26T01:00:00.000Z",
  confirmed_at: "2026-10-26T01:05:00.000Z",
  cancelled_at: null,
  cancel_reason: null,
  quote_id: "QT20261026ABCDEFGHIJ",
  channel_order_no: null,
  price: { total: { amount: "77000", currency: "JPY" }, fx: null },
  payment_status: "succeeded",
  payment_due_at: "2026-10-26T01:30:00.000Z",
  winning_tenant: null,
  driver: null,
  vehicle: null,
  landing: null,
  cancel_policy: { version: 0, category: "charter", level: "business", tiers },
  cancellation: null,
  free_cancel_available: false,
  changes: [],
  extra_charges: [],
  version: 2,
  ...changes,
});
const envelopeOf = (order: SiteOrder): SiteOrderEnvelope => ({
  order,
  timeline: [{ from_status: null, to_status: "pending_payment", reason: null, occurred_at: order.created_at }],
  names: { city: { code: "CTY-JP-TYO", name: { zh: "东京" } }, place: null, vehicle_group: { code: "VG-BIZ-7", name: { zh: "商务 7 座" }, seats: 7, sample_models: [], combos: [{ passengers: 6, luggage: 4 }] } },
});

test("订单页：包车写套餐时长和上车地点、没有「我已落地」；改单只有上车地址、没有航班号；点对点两端都能改", async () => {
  const calls = open({ pathname: "/book/order", hash: `#${TOKEN}` }, (call) => {
    if (call.url.pathname === "/site/v1/config") return json(200, { open: true, currency: "JPY", payments: null, support_phone: null, address_search: false, map_tiles: null });
    if (call.method === "GET" && call.url.pathname === "/site/v1/order") return json(200, envelopeOf(charterOrder()));
    if (call.method === "PATCH") return json(200, { ...envelopeOf(charterOrder({ pickup: { lng: 139.7671, lat: 35.6812, address: "东京站丸之内口" }, version: 3 })), change: null });
    return null;
  });
  const actor = user();
  const trip = (await screen.findByRole("heading", { name: "行程" })).closest("section") as HTMLElement;
  assert.ok(within(trip).getByText("8 小时"));
  assert.ok(within(trip).getByText("东京站八重洲口"));
  assert.ok(within(trip).getByText("上车时间"));
  assert.ok(within(trip).getByText("30 分钟（从约定的上车时间起算）"));
  assertAbsent(screen.queryByRole("button", { name: "我已落地" }));
  await actor.click(screen.getByRole("button", { name: "修改订单" }));
  assertAbsent(screen.queryByLabelText(/^航班号/));
  assertAbsent(screen.queryByLabelText("下车地址或酒店名"));
  const address = screen.getByLabelText("上车地址或酒店名") as HTMLInputElement;
  await actor.clear(address);
  await actor.type(address, "东京站丸之内口");
  await actor.click(screen.getByRole("button", { name: "提交修改" }));
  await waitFor(() => assert.ok(calls.some((call) => call.method === "PATCH")));
  assert.deepEqual(calls.find((call) => call.method === "PATCH")?.body, { pickup_address: "东京站丸之内口" });

  const form = { name: "陈小红", phone: "+819022223333", email: "guest@example.com", flightNo: "", flightKind: "" as const, pickupAddress: "东京站", dropoffAddress: "新宿站", notes: "", passengers: "2", luggage: "1", date: "2030-11-20", time: "10:00" };
  const p2p = charterOrder({ category: "point_to_point", package_hours: null, pickup: { lng: 139.7, lat: 35.6, address: "东京站" }, dropoff: { lng: 139.75, lat: 35.68, address: "新宿站" }, passengers: 2, luggage: 1 });
  assert.deepEqual(changeRequestOf(p2p, form), {});
  assert.deepEqual(changeRequestOf(p2p, { ...form, pickupAddress: "东京站八重洲口", dropoffAddress: " 涩谷站 " }), { pickup_address: "东京站八重洲口", dropoff_address: "涩谷站" });
  assert.deepEqual(changeRequestOf(p2p, { ...form, dropoffAddress: " " }), { error: "下车地址不能为空" });
  assert.deepEqual(changeRequestOf(p2p, { ...form, flightNo: "NH211" }), {}, "点对点没有航班号，不提交");
});

test("订单页（M8-19）：有下车点的包车单在「上车地点」后面写「下车地点」；改单列上车、下车两个地址，只提交改了的", async () => {
  const withDropoff = charterOrder({ dropoff: { lng: 140.3929, lat: 35.772, address: "成田国际机场 第 1 航站楼" } });
  const calls = open({ pathname: "/book/order", hash: `#${TOKEN}` }, (call) => {
    if (call.url.pathname === "/site/v1/config") return json(200, { open: true, currency: "JPY", payments: null, support_phone: null, address_search: false, map_tiles: null });
    if (call.method === "GET" && call.url.pathname === "/site/v1/order") return json(200, envelopeOf(withDropoff));
    if (call.method === "PATCH") return json(200, { ...envelopeOf({ ...withDropoff, dropoff: { lng: 140.3929, lat: 35.772, address: "成田国际机场 第 2 航站楼" }, version: 3 }), change: null });
    return null;
  });
  const actor = user();
  const trip = (await screen.findByRole("heading", { name: "行程" })).closest("section") as HTMLElement;
  const labels = [...trip.querySelectorAll("dt")].map((item) => item.textContent);
  assert.ok(labels.indexOf("下车地点") === labels.indexOf("上车地点") + 1, labels.join("、"));
  assert.ok(within(trip).getByText("成田国际机场 第 1 航站楼"));
  await actor.click(screen.getByRole("button", { name: "修改订单" }));
  assert.ok(screen.getByLabelText("上车地址或酒店名"));
  const dropoff = screen.getByLabelText("下车地址或酒店名") as HTMLInputElement;
  assert.equal(dropoff.value, "成田国际机场 第 1 航站楼");
  await actor.clear(dropoff);
  await actor.type(dropoff, "成田国际机场 第 2 航站楼");
  await actor.click(screen.getByRole("button", { name: "提交修改" }));
  await waitFor(() => assert.ok(calls.some((call) => call.method === "PATCH")));
  assert.deepEqual(calls.find((call) => call.method === "PATCH")?.body, { dropoff_address: "成田国际机场 第 2 航站楼" });
});
