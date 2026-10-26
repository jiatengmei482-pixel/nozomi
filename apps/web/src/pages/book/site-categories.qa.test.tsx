/**
 * M3-10 测试角色补充：官网询价页的点对点、包车和常用地点（组件测试，接口用替身）。
 * - 换城市：新城市没有现在这种服务时换成它有的；包车时长、选中的常用地点清掉，只有一种时长时替客人选上；
 * - 坐标越界在页面上就拦住，不发请求；±90 / ±180 照样能查；
 * - 「时间已经过了」按城市的时区判断（UTC+14 的城市刚过去的时间不能选，UTC-11 的城市几分钟后的时间能选）；
 * - 从下单页「返回修改」：服务、包车时长、上车地点都还在；
 * - 渠道没授权这种服务（422）时说清是哪种服务；
 * - 常用地点 500 个时照样能按编号找到；选中后填进地址栏的写法不能超过下单允许的地址长度（300 个字）。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { SiteCity, SitePlace, SiteQuote } from "../../api/site.ts";
import { placeAddress } from "./AddressFields.tsx";
import { type ApiCall, apiError, assertAbsent, json, resetBrowser, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const TOKYO_ID = "11111111-1111-4111-8111-111111111111";
const OSAKA_ID = "22222222-2222-4222-8222-222222222222";
const GROUP_ID = "33333333-3333-4333-8333-333333333333";
/** 下单时地址最多 300 个字（domain 的 ORDER_FIELD_LIMITS.addressMax） */
const ADDRESS_MAX = 300;

const tokyo: SiteCity = { id: TOKYO_ID, code: "CTY-JP-TYO", name: { zh: "东京" }, timezone: "Asia/Tokyo", country_code: "JP", categories: ["airport_transfer", "point_to_point", "charter"] };
const osaka: SiteCity = { id: OSAKA_ID, code: "CTY-JP-OSA", name: { zh: "大阪" }, timezone: "Asia/Tokyo", country_code: "JP", categories: ["charter"] };
const station: SitePlace = { id: "66666666-6666-4666-8666-666666666666", type: "station", code: "STN-JP-TOKYO", name: { zh: "东京站" }, address: null, location: { lng: 139.7671, lat: 35.6812 } };
const tiers = [{ min_hours_before: 48, fee_bp: 0 }, { min_hours_before: 24, fee_bp: 5000 }, { min_hours_before: 0, fee_bp: 10000 }];
const quote: SiteQuote = {
  quote_id: "QT20261026ABCDEFGHIJ",
  expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  service_date: "2030-11-20",
  urgent: false,
  vehicle_group: { id: GROUP_ID, code: "VG-BIZ-7", name: { zh: "商务 7 座" }, grade: "business", seats: 7, sample_models: [], combos: [{ passengers: 6, luggage: 4 }] },
  package: null,
  price: { total: { amount: "16500", currency: "JPY" }, fx: null },
  free_wait_minutes: 30,
  cancel_policy: { category: "point_to_point", level: "business", tiers },
};

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;
const user = () => userEvent.setup();

function open(entry: string | { pathname: string; state?: unknown }, route: Route): ApiCall[] {
  const calls = stubApiWith(route);
  render(
    <MemoryRouter initialEntries={[entry]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

interface Options {
  cities?: SiteCity[];
  places?: Record<string, SitePlace[]>;
  packages?: Record<string, number[]>;
  quotes?: Route;
}

const routes = (options: Options = {}): Route => (call) => {
  const path = call.url.pathname;
  if (call.method === "GET" && path === "/site/v1/config") return json(200, { open: true, currency: "JPY", payments: null });
  if (call.method === "GET" && path === "/site/v1/cities") return json(200, { items: options.cities ?? [tokyo] });
  const city = /^\/site\/v1\/cities\/([^/]+)\/(airports|places|charter-packages)$/.exec(path);
  if (call.method === "GET" && city !== null) {
    const [, id, kind] = city as unknown as [string, string, string];
    if (kind === "airports") return json(200, { items: [] });
    if (kind === "places") return json(200, { items: options.places?.[id] ?? [station] });
    return json(200, { items: (options.packages?.[id] ?? [4, 8]).map((hours) => ({ hours })) });
  }
  if (call.method === "POST" && path === "/site/v1/quotes") return options.quotes?.(call) ?? json(200, { currency: "JPY", quotes: [quote], unavailable: [] });
  return null;
};

/** 某个时区里某个时刻的当地日期和时间（HH:mm）。 */
function localParts(timeZone: string, at: Date): { date: string; time: string } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at).map((part) => [part.type, part.value]));
  return { date: `${parts["year"]}-${parts["month"]}-${parts["day"]}`, time: `${parts["hour"]}:${parts["minute"]}` };
}

async function setWhen(actor: ReturnType<typeof user>, date = "2030-11-20", time = "10:00"): Promise<void> {
  const dateInput = screen.getByLabelText("用车日期（当地）") as HTMLInputElement;
  await actor.clear(dateInput);
  await actor.type(dateInput, date);
  const timeInput = screen.getByLabelText("上车时间（当地）") as HTMLInputElement;
  await actor.clear(timeInput);
  await actor.type(timeInput, time);
}

async function pickStation(actor: ReturnType<typeof user>, end: "上车" | "下车", text = "东京站"): Promise<void> {
  await actor.type(screen.getByRole("combobox", { name: `从常用地点选${end}地点（选填）` }), text);
  await actor.keyboard("{Enter}");
}

async function fillPoint(actor: ReturnType<typeof user>, end: "上车" | "下车", address: string, lat: string, lng: string): Promise<void> {
  await actor.type(screen.getByLabelText(`${end}地址或酒店名`), address);
  const group = screen.getByRole("group", { name: new RegExp(`${end}地点的坐标`) });
  const latInput = within(group).getByLabelText(/^纬度/) as HTMLInputElement;
  const lngInput = within(group).getByLabelText(/^经度/) as HTMLInputElement;
  await actor.clear(latInput);
  await actor.type(latInput, lat);
  await actor.clear(lngInput);
  await actor.type(lngInput, lng);
}

const posts = (calls: ApiCall[]) => calls.filter((call) => call.method === "POST" && call.path.includes("/site/v1/quotes"));

test("换城市：东京选了点对点，换到只有包车的大阪——服务换成包车、不再显示服务单选；包车时长只有一种时替客人选上；选中的常用地点清掉；请求体是大阪的包车", async () => {
  const calls = open("/book", routes({ cities: [tokyo, osaka], packages: { [OSAKA_ID]: [6] } }));
  const actor = user();
  await actor.selectOptions(await screen.findByLabelText(/^城市/), TOKYO_ID);
  await actor.click(within(await screen.findByRole("group", { name: /服务/ })).getByRole("radio", { name: /点对点/ }));
  await pickStation(actor, "上车");
  assert.equal((screen.getByRole("combobox", { name: "从常用地点选上车地点（选填）" }) as HTMLInputElement).value, "东京站");

  await actor.selectOptions(screen.getByLabelText(/^城市/), OSAKA_ID);
  await waitFor(() => assertAbsent(screen.queryByRole("group", { name: /服务/ })));
  assertAbsent(screen.queryByLabelText("下车地址或酒店名"));
  const hours = (await screen.findByLabelText(/^包车时长/)) as HTMLSelectElement;
  await waitFor(() => assert.equal(hours.value, "6"));
  const picker = (await screen.findByRole("combobox", { name: "从常用地点选上车地点（选填）" })) as HTMLInputElement;
  assert.equal(picker.value, "", "东京的常用地点不能还算选中");

  await setWhen(actor);
  await actor.click(screen.getByRole("button", { name: "查询价格" }));
  await waitFor(() => assert.equal(posts(calls).length, 1));
  const body = posts(calls)[0]?.body as Record<string, unknown>;
  assert.deepEqual([body["category"], body["city_id"], body["package_hours"], "dropoff" in body, "airport_id" in body], ["charter", OSAKA_ID, 6, false, false]);
});

test("换城市：东京选了 8 小时，换到时长是 4 / 6 的城市——不保留 8 小时（新城市没有），要客人重选", async () => {
  const kyoto: SiteCity = { ...osaka, categories: ["point_to_point", "charter"] };
  open("/book", routes({ cities: [tokyo, kyoto], packages: { [OSAKA_ID]: [4, 6] } }));
  const actor = user();
  await actor.selectOptions(await screen.findByLabelText(/^城市/), TOKYO_ID);
  await actor.click(within(await screen.findByRole("group", { name: /服务/ })).getByRole("radio", { name: /包车/ }));
  const hours = (await screen.findByLabelText(/^包车时长/)) as HTMLSelectElement;
  await waitFor(() => assert.equal(hours.options.length, 3));
  await actor.selectOptions(hours, "8");
  await actor.selectOptions(screen.getByLabelText(/^城市/), OSAKA_ID);
  assert.ok((within(screen.getByRole("group", { name: /服务/ })).getByRole("radio", { name: /包车/ }) as HTMLInputElement).checked, "大阪也有包车，服务不变");
  const after = (await screen.findByLabelText(/^包车时长/)) as HTMLSelectElement;
  await waitFor(() => assert.deepEqual([...after.options].map((option) => option.value), ["", "4", "6"]));
  assert.equal(after.value, "");
  await actor.click(screen.getByRole("button", { name: "查询价格" }));
  assert.ok(await screen.findByText("请选择包车时长"));
});

test("坐标：纬度 90.5、经度 -180.1 在页面上就拦住，不发询价；正好 90 / -180 照样发出去", async () => {
  const calls = open("/book", routes());
  const actor = user();
  await actor.click(within(await screen.findByRole("group", { name: /服务/ })).getByRole("radio", { name: /点对点/ }));
  await fillPoint(actor, "上车", "北极点", "90.5", "139.7");
  await fillPoint(actor, "下车", "日界线", "35.6", "-180.1");
  await setWhen(actor);
  await actor.click(screen.getByRole("button", { name: "查询价格" }));
  assert.ok(await screen.findByText("纬度必须在 -90 到 90 之间"));
  assert.ok(screen.getByText("经度必须在 -180 到 180 之间"));
  assert.equal(posts(calls).length, 0);

  const pickupLat = within(screen.getByRole("group", { name: /上车地点的坐标/ })).getByLabelText(/^纬度/) as HTMLInputElement;
  await actor.clear(pickupLat);
  await actor.type(pickupLat, "90");
  const dropoffLng = within(screen.getByRole("group", { name: /下车地点的坐标/ })).getByLabelText(/^经度/) as HTMLInputElement;
  await actor.clear(dropoffLng);
  await actor.type(dropoffLng, "-180");
  await actor.click(screen.getByRole("button", { name: "查询价格" }));
  await waitFor(() => assert.equal(posts(calls).length, 1));
  const body = posts(calls)[0]?.body as { pickup: unknown; dropoff: unknown };
  assert.deepEqual([body.pickup, body.dropoff], [{ lat: 90, lng: 139.7 }, { lat: 35.6, lng: -180 }]);
});

test("「时间已经过了」按城市的时区：UTC+14 的城市当地 2 分钟前不能选（换成浏览器时区还在将来）；UTC-11 的城市当地 5 分钟后可以选", async () => {
  const kiritimati: SiteCity = { ...tokyo, id: TOKYO_ID, code: "CTY-KI-CXI", name: { zh: "圣诞岛" }, timezone: "Pacific/Kiritimati", categories: ["charter"] };
  const pagoPago: SiteCity = { ...osaka, id: OSAKA_ID, code: "CTY-AS-PPG", name: { zh: "帕果帕果" }, timezone: "Pacific/Pago_Pago", categories: ["charter"] };
  const calls = open("/book", routes({ cities: [kiritimati, pagoPago], packages: { [TOKYO_ID]: [8], [OSAKA_ID]: [8] } }));
  const actor = user();
  await actor.selectOptions(await screen.findByLabelText(/^城市/), TOKYO_ID);
  await waitFor(() => assert.equal((screen.getByLabelText(/^包车时长/) as HTMLSelectElement).value, "8"));
  await pickStation(actor, "上车");
  const past = localParts("Pacific/Kiritimati", new Date(Date.now() - 2 * 60_000));
  await setWhen(actor, past.date, past.time);
  await actor.click(screen.getByRole("button", { name: "查询价格" }));
  assert.ok(await screen.findByText("这个时间已经过了，请选一个以后的时间"));
  assert.equal(posts(calls).length, 0);

  await actor.selectOptions(screen.getByLabelText(/^城市/), OSAKA_ID);
  await waitFor(() => assert.equal((screen.getByLabelText(/^包车时长/) as HTMLSelectElement).value, "8"));
  const soon = localParts("Pacific/Pago_Pago", new Date(Date.now() + 5 * 60_000));
  await setWhen(actor, soon.date, soon.time);
  await actor.click(screen.getByRole("button", { name: "查询价格" }));
  await waitFor(() => assert.equal(posts(calls).length, 1));
  assert.equal((posts(calls)[0]?.body as { service_local: string }).service_local, `${soon.date}T${soon.time}`);
});

test("从下单页「返回修改」回来：包车、8 小时、上车地址和坐标都还在，直接能再查", async () => {
  const draft = {
    cityId: TOKYO_ID,
    category: "charter",
    airportId: "",
    direction: "pickup",
    address: { address: "", coordinates: { lat: "", lng: "" }, placeId: null },
    from: { address: "东京站八重洲口", coordinates: { lat: "35.6812", lng: "139.7671" }, placeId: null },
    to: { address: "", coordinates: { lat: "", lng: "" }, placeId: null },
    packageHours: "8",
    date: "2030-11-20",
    time: "09:00",
    passengers: "3",
    luggage: "2",
  };
  const calls = open({ pathname: "/book", state: { draft } }, routes());
  const actor = user();
  const services = await screen.findByRole("group", { name: /服务/ });
  assert.ok((within(services).getByRole("radio", { name: /包车/ }) as HTMLInputElement).checked);
  const hours = screen.getByLabelText(/^包车时长/) as HTMLSelectElement;
  await waitFor(() => assert.equal(hours.value, "8"));
  assert.equal((screen.getByLabelText("上车地址或酒店名") as HTMLInputElement).value, "东京站八重洲口");
  await actor.click(screen.getByRole("button", { name: "查询价格" }));
  await waitFor(() => assert.equal(posts(calls).length, 1));
  assert.deepEqual(posts(calls)[0]?.body, { category: "charter", city_id: TOKYO_ID, service_local: "2030-11-20T09:00", passengers: 3, luggage: 2, pickup: { lat: 35.6812, lng: 139.7671 }, package_hours: 8 });
});

test("渠道没授权这种服务（422 CHANNEL_SCOPE_DENIED）：说清是包车 / 点对点暂不开放，不显示报价", async () => {
  for (const [radio, word] of [[/包车/, "包车"], [/点对点/, "点对点"]] as const) {
    open("/book", routes({ quotes: () => apiError(422, "CHANNEL_SCOPE_DENIED", "渠道没有授权") }));
    const actor = user();
    await actor.click(within(await screen.findByRole("group", { name: /服务/ })).getByRole("radio", { name: radio }));
    if (word === "包车") await actor.selectOptions(await screen.findByLabelText(/^包车时长/), "4");
    await pickStation(actor, "上车");
    if (word === "点对点") await pickStation(actor, "下车");
    await setWhen(actor);
    await actor.click(screen.getByRole("button", { name: "查询价格" }));
    assert.ok(await screen.findByText(`这个城市的${word}暂不开放预订，请换一种服务或换一个城市。`));
    assertAbsent(screen.queryByRole("heading", { name: /可预订的车/ }));
    resetBrowser();
  }
});

test("常用地点 500 个：按编号能找到最后一个，选中后填好名称和坐标", async () => {
  const many: SitePlace[] = Array.from({ length: 500 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    type: "poi",
    code: `POI-${String(index).padStart(6, "0")}`,
    name: { zh: `酒店${index}` },
    address: `某区某町 ${index}`,
    location: { lng: 139 + index / 1000, lat: 35.5 },
  }));
  open("/book", routes({ places: { [TOKYO_ID]: many } }));
  const actor = user();
  await actor.click(within(await screen.findByRole("group", { name: /服务/ })).getByRole("radio", { name: /包车/ }));
  await pickStation(actor, "上车", "POI-000499");
  assert.equal((screen.getByLabelText("上车地址或酒店名") as HTMLInputElement).value, "酒店499（某区某町 499）");
  assert.equal((within(screen.getByRole("group", { name: /上车地点的坐标/ })).getByLabelText(/^经度/) as HTMLInputElement).value, "139.499");
});

test("缺陷：选一个地址很长的地标，填进地址栏的「名称（地址）」不能超过下单允许的 300 个字（否则到下单页才被拒）", () => {
  // 主数据里地标的地址最多 300 个字（master-data.ts 的 addressSchema），名称另算
  const long: SitePlace = { id: "88888888-8888-4888-8888-888888888888", type: "poi", code: "POI-LONG", name: { zh: "东京某某大饭店" }, address: "丸".repeat(ADDRESS_MAX), location: { lng: 139.76, lat: 35.68 } };
  const filled = placeAddress(long);
  assert.ok([...filled].length <= ADDRESS_MAX, `填进去 ${[...filled].length} 个字，下单时会 400 TOO_LONG`);
  assert.ok(filled.startsWith("东京某某大饭店"), "至少保留名称");
});
