/**
 * 官网的点对点、包车和地址输入辅助（M3-10）的组件测试：选服务、按服务拼询价请求（只给这个服务的字段）、包车时长（空、出错）、
 * 从常用地点选地址（填好名称和坐标；手改后清掉选择；读不出来照样能自己写）、下单页和订单页按服务显示行程、改单只给这一单有的地址。
 * 接口用测试替身；真实后端由集成测试 site-categories.itest.ts 和端到端测试 e2e/site-booking-categories.spec.ts 覆盖。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { SiteCity, SiteOrder, SiteOrderEnvelope, SitePlace, SiteQuote } from "../../api/site.ts";
import { changeRequestOf } from "./OrderSections.tsx";
import { placeAddress } from "./AddressFields.tsx";
import { type ApiCall, apiError, assertAbsent, json, resetBrowser, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const CITY_ID = "11111111-1111-4111-8111-111111111111";
const GROUP_ID = "33333333-3333-4333-8333-333333333333";
const ORDER_ID = "44444444-4444-4444-8444-444444444444";
const TOKEN = `nzo_${"A".repeat(43)}`;

const city: SiteCity = { id: CITY_ID, code: "CTY-JP-TYO", name: { zh: "东京" }, timezone: "Asia/Tokyo", country_code: "JP", categories: ["airport_transfer", "point_to_point", "charter"] };
const station: SitePlace = { id: "66666666-6666-4666-8666-666666666666", type: "station", code: "STN-JP-TOKYO", name: { zh: "东京站", ja: "東京駅" }, address: null, location: { lng: 139.7671, lat: 35.6812 } };
const hotel: SitePlace = { id: "77777777-7777-4777-8777-777777777777", type: "poi", code: "POI-000001", name: { zh: "新宿某酒店" }, address: "新宿区西新宿 2-7-2", location: { lng: 139.6917, lat: 35.6895 } };
const tiers = [{ min_hours_before: 48, fee_bp: 0 }, { min_hours_before: 24, fee_bp: 5000 }, { min_hours_before: 0, fee_bp: 10000 }];

const quoteOf = (changes: Partial<SiteQuote>): SiteQuote => ({
  quote_id: "QT20261026ABCDEFGHIJ",
  expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  service_date: "2030-11-20",
  urgent: false,
  vehicle_group: { id: GROUP_ID, code: "VG-BIZ-7", name: { zh: "商务 7 座" }, grade: "business", seats: 7, sample_models: [], combos: [{ passengers: 6, luggage: 4 }] },
  package: null,
  price: { total: { amount: "16500", currency: "JPY" }, fx: null },
  free_wait_minutes: 30,
  cancel_policy: { category: "point_to_point", level: "business", tiers },
  ...changes,
});

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

const routes = (options: { places?: () => Response; packages?: () => Response; quotes?: Route } = {}): Route => (call) => {
  const path = call.url.pathname;
  if (call.method === "GET" && path === "/site/v1/config") return json(200, { open: true, currency: "JPY", payments: null });
  if (call.method === "GET" && path === "/site/v1/cities") return json(200, { items: [city] });
  if (call.method === "GET" && path === `/site/v1/cities/${CITY_ID}/airports`) return json(200, { items: [] });
  if (call.method === "GET" && path === `/site/v1/cities/${CITY_ID}/places`) return options.places?.() ?? json(200, { items: [station, hotel] });
  if (call.method === "GET" && path === `/site/v1/cities/${CITY_ID}/charter-packages`) return options.packages?.() ?? json(200, { items: [{ hours: 4 }, { hours: 8 }] });
  if (call.method === "POST" && path === "/site/v1/quotes") return options.quotes?.(call) ?? null;
  return null;
};

async function setTime(actor: ReturnType<typeof user>): Promise<void> {
  const date = screen.getByLabelText("用车日期（当地）") as HTMLInputElement;
  await actor.clear(date);
  await actor.type(date, "2030-11-20");
  await actor.type(screen.getByLabelText("上车时间（当地）"), "10:00");
}

test("点对点：选服务后只有上车、下车两个地点；从常用地点选好名称和坐标；请求体只有点对点的字段；下单页两端地址带过去、没有航班号", async () => {
  const calls = open("/book", routes({ quotes: () => json(200, { currency: "JPY", quotes: [quoteOf({})], unavailable: [] }) }));
  const actor = user();
  await screen.findByRole("heading", { level: 1, name: "预订用车" });
  const services = await screen.findByRole("group", { name: /服务/ });
  assert.deepEqual(within(services).getAllByRole("radio").map((radio) => (radio as HTMLInputElement).value), ["airport_transfer", "point_to_point", "charter"]);
  await actor.click(within(services).getByRole("radio", { name: /点对点/ }));
  assertAbsent(screen.queryByLabelText(/^机场/));
  assertAbsent(screen.queryByLabelText(/^航班/));

  await actor.click(screen.getByRole("button", { name: "查询价格" }));
  assert.ok(await screen.findByText("请填写上车的地址或酒店名"));
  assert.ok(screen.getByText("请填写下车的地址或酒店名"));

  // 上车点从常用地点里选（输入日文名也找得到），下车点选一个地标：地址带上地标的地址
  await actor.type(screen.getByRole("combobox", { name: "从常用地点选上车地点（选填）" }), "東京駅");
  await actor.keyboard("{Enter}");
  assert.equal((screen.getByLabelText("上车地址或酒店名") as HTMLInputElement).value, "东京站");
  const pickupCoordinates = screen.getByRole("group", { name: /上车地点的坐标/ });
  assert.equal((within(pickupCoordinates).getByLabelText(/^纬度/) as HTMLInputElement).value, "35.6812");
  assert.equal((within(pickupCoordinates).getByLabelText(/^经度/) as HTMLInputElement).value, "139.7671");
  await actor.type(screen.getByRole("combobox", { name: "从常用地点选下车地点（选填）" }), "新宿");
  await actor.keyboard("{Enter}");
  assert.equal((screen.getByLabelText("下车地址或酒店名") as HTMLInputElement).value, "新宿某酒店（新宿区西新宿 2-7-2）");
  await setTime(actor);
  await actor.click(screen.getByRole("button", { name: "查询价格" }));
  const card = (await screen.findByRole("heading", { name: "商务 7 座" })).closest("li") as HTMLElement;
  assert.deepEqual(calls.find((call) => call.method === "POST")?.body, {
    category: "point_to_point",
    city_id: CITY_ID,
    service_local: "2030-11-20T10:00",
    passengers: 2,
    luggage: 1,
    pickup: { lat: 35.6812, lng: 139.7671 },
    dropoff: { lat: 35.6895, lng: 139.6917 },
  });
  assert.ok(within(card).getByText("30 分钟（从约定的上车时间起算）"));
  assert.ok(screen.getByText(/已含高速费和停车费/));

  await actor.click(within(card).getByRole("button", { name: "预订商务 7 座" }));
  assert.ok(await screen.findByRole("heading", { level: 1, name: "填写订单" }));
  assert.ok(screen.getByText("东京站 → 新宿某酒店（新宿区西新宿 2-7-2）"));
  assert.equal((screen.getByLabelText("上车地址或酒店名") as HTMLInputElement).value, "东京站");
  assert.equal((screen.getByLabelText("下车地址或酒店名") as HTMLInputElement).value, "新宿某酒店（新宿区西新宿 2-7-2）");
  assertAbsent(screen.queryByLabelText(/^航班号/));
});

test("从常用地点选了以后手改地址：选择清掉，地址和坐标保留客人改的；常用地点读不出来时照样能自己写；城市没有常用地点时不出这一栏", async () => {
  open("/book", routes());
  const actor = user();
  const services = await screen.findByRole("group", { name: /服务/ });
  await actor.click(within(services).getByRole("radio", { name: /包车/ }));
  const picker = screen.getByRole("combobox", { name: "从常用地点选上车地点（选填）" }) as HTMLInputElement;
  await actor.type(picker, "东京站");
  await actor.keyboard("{Enter}");
  assert.equal(picker.value, "东京站");
  await actor.type(screen.getByLabelText("上车地址或酒店名"), "八重洲口");
  assert.equal((screen.getByLabelText("上车地址或酒店名") as HTMLInputElement).value, "东京站八重洲口");
  assert.equal(picker.value, "", "手改以后不再算「选了东京站」");
  assert.equal((within(screen.getByRole("group", { name: /上车地点的坐标/ })).getByLabelText(/^纬度/) as HTMLInputElement).value, "35.6812");

  resetBrowser();
  open("/book", routes({ places: () => apiError(500, "INTERNAL", "出错了") }));
  await screen.findByRole("heading", { level: 1, name: "预订用车" });
  assert.ok(await screen.findByText("常用地点没有读出来，可以直接在下面写地址和坐标。"));
  assert.ok(screen.getByLabelText("下车地址或酒店名"));

  resetBrowser();
  const calls = open("/book", routes({ places: () => json(200, { items: [] }) }));
  await screen.findByRole("heading", { level: 1, name: "预订用车" });
  assert.ok(await screen.findByLabelText("下车地址或酒店名"));
  await waitFor(() => assert.equal(calls.filter((call) => call.path.endsWith("/places")).length, 1));
  await waitFor(() => assertAbsent(screen.queryByRole("combobox", { name: /从常用地点/ })));
});

test("包车：选时长（只有包车的字段进请求体）；报价卡写套餐时长和公里、价格说明写超出部分和高速停车另收；下单页只有上车地址", async () => {
  const charter = quoteOf({ package: { hours: 8, km: 150 }, price: { total: { amount: "77000", currency: "JPY" }, fx: null }, free_wait_minutes: 30, cancel_policy: { category: "charter", level: "business", tiers } });
  const calls = open("/book", routes({ quotes: () => json(200, { currency: "JPY", quotes: [charter], unavailable: [] }) }));
  const actor = user();
  const services = await screen.findByRole("group", { name: /服务/ });
  await actor.click(within(services).getByRole("radio", { name: /包车/ }));
  const hours = (await screen.findByLabelText(/^包车时长/)) as HTMLSelectElement;
  await waitFor(() => assert.deepEqual([...hours.options].map((option) => option.textContent), ["请选择时长", "4 小时", "8 小时"]));
  assertAbsent(screen.queryByLabelText("下车地址或酒店名"));
  await actor.click(screen.getByRole("button", { name: "查询价格" }));
  assert.ok(await screen.findByText("请选择包车时长"));
  await actor.selectOptions(hours, "8");
  await actor.type(screen.getByLabelText("上车地址或酒店名"), "东京站八重洲口");
  const coordinates = screen.getByRole("group", { name: /上车地点的坐标/ });
  await actor.type(within(coordinates).getByLabelText(/^纬度/), "35.6812");
  await actor.type(within(coordinates).getByLabelText(/^经度/), "139.7671");
  await setTime(actor);
  await actor.click(screen.getByRole("button", { name: "查询价格" }));
  const card = (await screen.findByRole("heading", { name: "商务 7 座" })).closest("li") as HTMLElement;
  assert.deepEqual(calls.find((call) => call.method === "POST")?.body, { category: "charter", city_id: CITY_ID, service_local: "2030-11-20T10:00", passengers: 2, luggage: 1, pickup: { lat: 35.6812, lng: 139.7671 }, package_hours: 8 });
  assert.ok(within(card).getByText("8 小时，含 150 公里"));
  assert.ok(within(card).getByText("77,000 JPY"));
  assert.ok(screen.getByText(/超出套餐的时长和公里、高速费、停车费服务后按实际收取/));
  assert.doesNotMatch(document.body.textContent ?? "", /结算|加价|供应商/);

  await actor.click(within(card).getByRole("button", { name: "预订商务 7 座" }));
  assert.ok(await screen.findByRole("heading", { level: 1, name: "填写订单" }));
  assert.ok(screen.getByText("8 小时，含 150 公里"));
  assert.ok(screen.getByText("东京站八重洲口"));
  assertAbsent(screen.queryByLabelText("下车地址或酒店名"));
  assertAbsent(screen.queryByLabelText(/^航班号/));
});

test("包车：城市没有可选的时长时说明并不出下拉；读不出来时说明并能重试；报不出价时提示换时长", async () => {
  open("/book", routes({ packages: () => json(200, { items: [] }) }));
  const actor = user();
  await actor.click(within(await screen.findByRole("group", { name: /服务/ })).getByRole("radio", { name: /包车/ }));
  assert.ok(await screen.findByRole("heading", { name: "暂时没有可选的包车时长" }));
  assertAbsent(screen.queryByLabelText(/^包车时长/));

  resetBrowser();
  let fail = true;
  open(
    "/book",
    routes({
      packages: () => (fail ? apiError(500, "INTERNAL", "出错了") : json(200, { items: [{ hours: 6 }] })),
      quotes: () => json(200, { currency: "JPY", quotes: [], unavailable: [{ vehicle_group_id: null, reasons: ["NO_PRODUCT"] }] }),
    }),
  );
  await actor.click(within(await screen.findByRole("group", { name: /服务/ })).getByRole("radio", { name: /包车/ }));
  assert.ok(await screen.findByRole("heading", { name: "包车时长没有读出来" }));
  fail = false;
  await actor.click(screen.getByRole("button", { name: "重试" }));
  const hours = (await screen.findByLabelText(/^包车时长/)) as HTMLSelectElement;
  await waitFor(() => assert.equal(hours.value, "6", "只有一种时长时替客人选上"));
  await actor.type(screen.getByRole("combobox", { name: "从常用地点选上车地点（选填）" }), "东京站");
  await actor.keyboard("{Enter}");
  await setTime(actor);
  await actor.click(screen.getByRole("button", { name: "查询价格" }));
  assert.ok(await screen.findByText("这里暂时没有这种服务可预订，请换一种服务或换一个城市。"));
  assert.ok(screen.getByText("也可以换一个包车时长试试。"));
});

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
  names: { city: { code: "CTY-JP-TYO", name: { zh: "东京" } }, place: null, vehicle_group: { code: "VG-BIZ-7", name: { zh: "商务 7 座" }, seats: 7 } },
});

test("订单页：包车写套餐时长和上车地点、没有「我已落地」；改单只有上车地址、没有航班号；点对点两端都能改", async () => {
  const calls = open({ pathname: "/book/order", hash: `#${TOKEN}` }, (call) => {
    if (call.url.pathname === "/site/v1/config") return json(200, { open: true, currency: "JPY", payments: null });
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

  const form = { name: "陈小红", phone: "+819022223333", email: "guest@example.com", flightNo: "", pickupAddress: "东京站", dropoffAddress: "新宿站", notes: "", passengers: "2", luggage: "1", date: "2030-11-20", time: "10:00" };
  const p2p = charterOrder({ category: "point_to_point", package_hours: null, pickup: { lng: 139.7, lat: 35.6, address: "东京站" }, dropoff: { lng: 139.75, lat: 35.68, address: "新宿站" }, passengers: 2, luggage: 1 });
  assert.deepEqual(changeRequestOf(p2p, form), {});
  assert.deepEqual(changeRequestOf(p2p, { ...form, pickupAddress: "东京站八重洲口", dropoffAddress: " 涩谷站 " }), { pickup_address: "东京站八重洲口", dropoff_address: "涩谷站" });
  assert.deepEqual(changeRequestOf(p2p, { ...form, dropoffAddress: " " }), { error: "下车地址不能为空" });
  assert.deepEqual(changeRequestOf(p2p, { ...form, flightNo: "NH211" }), {}, "点对点没有航班号，不提交");
});

test("常用地点填进地址栏的写法：名称；地标有地址时带上地址", () => {
  assert.equal(placeAddress(station), "东京站");
  assert.equal(placeAddress(hotel), "新宿某酒店（新宿区西新宿 2-7-2）");
  assert.equal(placeAddress({ ...hotel, address: "  " }), "新宿某酒店");
});
