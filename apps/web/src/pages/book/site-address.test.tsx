/**
 * 官网的地址搜索和地图选点（M3-12，ADR 0044；规范 site-booking.md 3.6）的组件测试：
 * 搜索（回车不提交表单、太短不查、选一个填好地址和坐标并按坐标询价）、用不了 / 太频繁时说明并退回常用地点、
 * 没有地址搜索和底图时不出这两块、地图点选和不用鼠标的选点（方向键 +「选地图中间这个位置」）后反查地址、反查用不了时坐标照样填好。
 * 接口用测试替身（浏览器只连 /site/v1，不连谷歌）；真实后端由 site-places.itest.ts 和 e2e/site-address.spec.ts 覆盖。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { MapTiles } from "../../api/areas.ts";
import type { SiteCity, SiteConfig, SitePlace, SiteQuote } from "../../api/site.ts";
import { type ApiCall, apiError, assertAbsent, deferred, json, resetBrowser, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const CITY_ID = "11111111-1111-4111-8111-111111111111";
const GROUP_ID = "33333333-3333-4333-8333-333333333333";
const CENTER = { lat: 35.6895, lng: 139.6917 };
const city: SiteCity = { id: CITY_ID, code: "CTY-JP-TYO", name: { zh: "东京" }, timezone: "Asia/Tokyo", country_code: "JP", center: CENTER, categories: ["point_to_point"] };
const station: SitePlace = { id: "66666666-6666-4666-8666-666666666666", type: "station", code: "STN-JP-TOKYO", name: { zh: "东京站" }, address: null, location: { lng: 139.7671, lat: 35.6812 } };
const tiles: MapTiles = { url_template: "http://127.0.0.1:1/{z}/{x}/{y}.png", dark_url_template: null, min_zoom: 3, max_zoom: 19, tile_size: 256, referrer_policy: "strict-origin", attribution: [{ text: "© OpenStreetMap", href: "https://www.openstreetmap.org/copyright" }] };
const configOf = (changes: Partial<SiteConfig> = {}): SiteConfig => ({ open: true, currency: "JPY", payments: null, support_phone: null, address_search: true, map_tiles: null, ...changes });
const candidate = { id: "ChIJhotel", name: "东京站大饭店", address: "东京都千代田区丸之内 1-9-1", location: { lat: 35.6813, lng: 139.7662 } };
const quote: SiteQuote = {
  quote_id: "QT20261026ABCDEFGHIJ",
  expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  service_date: "2030-11-20",
  urgent: false,
  vehicle_group: { id: GROUP_ID, code: "VG-BIZ-7", name: { zh: "商务 7 座" }, grade: "business", seats: 7, sample_models: [], combos: [{ passengers: 6, luggage: 4 }] },
  package: null,
  price: { total: { amount: "16500", currency: "JPY" }, fx: null },
  free_wait_minutes: 30,
  cancel_policy: { category: "point_to_point", level: "business", tiers: [{ min_hours_before: 0, fee_bp: 10000 }] },
};

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;
interface Options {
  config?: SiteConfig;
  search?: Route;
  reverse?: Route;
}

function open(options: Options = {}): ApiCall[] {
  const calls = stubApiWith((call) => {
    const path = call.url.pathname;
    if (path === "/site/v1/config") return json(200, options.config ?? configOf());
    if (path === "/site/v1/cities") return json(200, { items: [city] });
    if (path === `/site/v1/cities/${CITY_ID}/places`) return json(200, { items: [station] });
    if (path === "/site/v1/places/search") return options.search?.(call) ?? json(200, { available: true, items: [candidate] });
    if (path === "/site/v1/places/reverse") return options.reverse?.(call) ?? json(200, { available: true, address: "日本、〒160-0023 東京都新宿区西新宿２丁目８−１" });
    if (call.method === "POST" && path === "/site/v1/quotes") return json(200, { currency: "JPY", quotes: [quote], unavailable: [] });
    return null;
  });
  render(
    <MemoryRouter initialEntries={["/book"]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

const user = () => userEvent.setup();
const coordinatesOf = (word: "上车" | "下车"): [string, string] => {
  const group = screen.getByRole("group", { name: new RegExp(`${word}地点的坐标`) });
  return [(within(group).getByLabelText(/^纬度/) as HTMLInputElement).value, (within(group).getByLabelText(/^经度/) as HTMLInputElement).value];
};
const addressOf = (word: "上车" | "下车"): string => (screen.getByLabelText(`${word}地址或酒店名`) as HTMLInputElement).value;

test("搜索：回车是搜索不是提交；后端按城市和规范化的关键字查；选一个候选就填好地址和坐标，询价只带坐标", async () => {
  const calls = open();
  const actor = user();
  const box = await screen.findByRole("searchbox", { name: "搜索上车地点（选填）" });
  assert.equal(screen.getAllByText("输入酒店名、地址或地标，按「搜索」在东京附近查找").length, 2, "上车、下车各一个");
  await actor.type(box, "  东京站　大饭店 {Enter}");
  const results = await screen.findByRole("list", { name: "搜索到的上车地点" });
  assert.ok(screen.getByText("找到 1 个地点，选一个就会填好地址和坐标。"));
  const search = calls.find((call) => call.path.includes("/places/search"));
  assert.equal(new URL(search?.path ?? "", "http://x").searchParams.get("q"), "东京站 大饭店");
  assert.equal(new URL(search?.path ?? "", "http://x").searchParams.get("city_id"), CITY_ID);
  assertAbsent(screen.queryByText("有几项没有填好，请看标红的地方。"));
  assert.equal(calls.filter((call) => call.method === "POST").length, 0, "回车没有提交询价");

  await actor.click(within(results).getByRole("button", { name: /东京站大饭店/ }));
  assert.equal(addressOf("上车"), "东京站大饭店（东京都千代田区丸之内 1-9-1）");
  assert.deepEqual(coordinatesOf("上车"), ["35.6813", "139.7662"]);
  assert.ok(screen.getByText("已填入「东京站大饭店」的地址和坐标，可以在地址后面补充楼层、房间号。"));
  assertAbsent(screen.queryByRole("list", { name: "搜索到的上车地点" }));

  // 下车点用「搜索」按钮，再走一遍询价：请求体只有坐标，没有地址文字
  await actor.type(screen.getByRole("searchbox", { name: "搜索下车地点（选填）" }), "新宿");
  await actor.click(screen.getAllByRole("button", { name: "搜索" })[1] as HTMLElement);
  await actor.click(within(await screen.findByRole("list", { name: "搜索到的下车地点" })).getByRole("button", { name: /东京站大饭店/ }));
  const date = screen.getByLabelText("用车日期（当地）") as HTMLInputElement;
  await actor.clear(date);
  await actor.type(date, "2030-11-20");
  await actor.type(screen.getByLabelText("上车时间（当地）"), "10:00");
  await actor.click(screen.getByRole("button", { name: "查询价格" }));
  await screen.findByRole("heading", { name: "商务 7 座" });
  const body = calls.find((call) => call.method === "POST")?.body as Record<string, unknown>;
  assert.deepEqual([body["pickup"], body["dropoff"]], [candidate.location, candidate.location]);
  assert.ok(calls.every((call) => !/google/i.test(call.path)), "浏览器不连谷歌");
});

test("搜索：太短不查，字段下说明；没找到时指到别的方式", async () => {
  const calls = open({ search: () => json(200, { available: true, items: [] }) });
  const actor = user();
  const box = await screen.findByRole("searchbox", { name: "搜索上车地点（选填）" });
  await actor.type(box, " 站 {Enter}");
  assert.ok(screen.getByText("请至少输入 2 个字，如酒店名、地址或地标"));
  assert.equal(box.getAttribute("aria-invalid"), "true");
  assert.equal(calls.filter((call) => call.path.includes("/places/search")).length, 0);
  await actor.type(box, "火星酒店{Enter}");
  assert.ok(await screen.findByText(/东京附近没有找到。请换个说法/));
  assertAbsent(screen.queryByText("请至少输入 2 个字，如酒店名、地址或地标"));
});

test("降级：搜索用不了（available false）或太频繁（429）时说明，并指到常用地点；常用地点、地址、坐标照常能用", async () => {
  open({ search: () => json(200, { available: false, items: [] }) });
  const actor = user();
  await actor.type(await screen.findByRole("searchbox", { name: "搜索上车地点（选填）" }), "东京站{Enter}");
  const warning = await screen.findByText(/地址搜索暂时用不了。可以从常用地点选/);
  assert.equal(warning.closest("[role=status]")?.className.includes("warning"), true);
  await actor.type(screen.getByRole("combobox", { name: "从常用地点选上车地点（选填）" }), "东京站");
  await actor.keyboard("{Enter}");
  assert.equal(addressOf("上车"), "东京站");
  assert.deepEqual(coordinatesOf("上车"), ["35.6812", "139.7671"]);

  resetBrowser();
  open({ search: () => apiError(429, "RATE_LIMITED", "请求过于频繁", { retry_after_seconds: 40 }, { "retry-after": "40" }) });
  await user().type(await screen.findByRole("searchbox", { name: "搜索上车地点（选填）" }), "东京站{Enter}");
  assert.ok(await screen.findByText(/搜索太频繁了，请 40 秒后再搜。现在也可以从常用地点选/));

  resetBrowser();
  open({ search: () => apiError(500, "INTERNAL", "出错了") });
  await user().type(await screen.findByRole("searchbox", { name: "搜索上车地点（选填）" }), "东京站{Enter}");
  assert.ok(await screen.findByText(/地址搜索暂时用不了/));
});

test("没有地址搜索、没有底图：不出搜索框和地图按钮，只有常用地点和手填", async () => {
  open({ config: configOf({ address_search: false, map_tiles: null }) });
  assert.ok(await screen.findByRole("combobox", { name: "从常用地点选上车地点（选填）" }));
  assertAbsent(screen.queryByRole("searchbox"));
  assertAbsent(screen.queryByRole("button", { name: /在地图上选/ }));
});

test("地图：默认收起；展开后点地图 → 坐标填好、查这个位置的地址填进地址栏", async () => {
  const calls = open({ config: configOf({ address_search: false, map_tiles: tiles }) });
  const actor = user();
  const toggle = await screen.findByRole("button", { name: "在地图上选上车地点" });
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  await actor.click(toggle);
  assert.equal(screen.getByRole("button", { name: "收起地图" }).getAttribute("aria-expanded"), "true");
  const map = screen.getByRole("application", { name: /地图：点一下选上车位置/ });
  assert.ok(screen.getByText("© OpenStreetMap"));
  fireEvent.click(map, { clientX: 0, clientY: 0 });
  await waitFor(() => assert.notEqual(coordinatesOf("上车")[0], ""));
  assert.ok(await screen.findByText("已填入这个位置的地址和坐标，可以在地址后面补充酒店名、楼层。"));
  assert.equal(addressOf("上车"), "日本、〒160-0023 東京都新宿区西新宿２丁目８−１");
  const reverse = new URL(calls.find((call) => call.path.includes("/places/reverse"))?.path ?? "", "http://x");
  assert.equal(reverse.searchParams.get("city_id"), CITY_ID);
  assert.deepEqual([reverse.searchParams.get("lat"), reverse.searchParams.get("lng")], coordinatesOf("上车"));
});

test("地图的键盘做法：方向键移动地图，按「选地图中间这个位置」选中准星处（从城市中心开始）；反查用不了时坐标照样填好、地址栏不动", async () => {
  const calls = open({ config: configOf({ address_search: false, map_tiles: tiles }), reverse: () => json(200, { available: false, address: null }) });
  const actor = user();
  await actor.click(await screen.findByRole("button", { name: "在地图上选上车地点" }));
  await actor.type(screen.getByLabelText("上车地址或酒店名"), "新宿某酒店");
  await actor.click(screen.getByRole("button", { name: "选地图中间这个位置" }));
  await waitFor(() => assert.deepEqual(coordinatesOf("上车"), [String(CENTER.lat), String(CENTER.lng)]));
  assert.ok(await screen.findByText("坐标已填好，暂时查不到这个位置的地址，请在上面写上地址或酒店名。"));
  assert.equal(addressOf("上车"), "新宿某酒店", "查不到地址时不动客人写的");

  const map = screen.getByRole("application", { name: /地图/ });
  map.focus();
  assert.equal(document.activeElement, map, "地图可以聚焦");
  fireEvent.keyDown(map, { key: "ArrowRight", code: "ArrowRight", keyCode: 39 });
  fireEvent.keyDown(map, { key: "ArrowUp", code: "ArrowUp", keyCode: 38 });
  await actor.click(screen.getByRole("button", { name: "选地图中间这个位置" }));
  await waitFor(() => {
    const [lat, lng] = coordinatesOf("上车").map(Number) as [number, number];
    assert.ok(lng > CENTER.lng && lat > CENTER.lat, `移动后的中心 ${lat}, ${lng}`);
  });
  assert.equal(calls.filter((call) => call.path.includes("/places/reverse")).length, 2);
});

test("地图选点离城市太远（400 OUT_OF_CITY）：说明在城市附近选点；之后手改坐标，状态行收起", async () => {
  open({
    config: configOf({ address_search: false, map_tiles: tiles }),
    reverse: () => apiError(400, "VALIDATION_FAILED", "请求参数校验未通过", { location: "querystring", issues: [{ path: "/lat", reason: "OUT_OF_CITY", message: "这个位置离城市太远" }] }),
  });
  const actor = user();
  await actor.click(await screen.findByRole("button", { name: "在地图上选上车地点" }));
  await actor.click(screen.getByRole("button", { name: "选地图中间这个位置" }));
  assert.ok(await screen.findByText("这个位置离东京太远了，请在城市附近选点。"));
  const group = screen.getByRole("group", { name: /上车地点的坐标/ });
  await actor.clear(within(group).getByLabelText(/^纬度/));
  assertAbsent(screen.queryByText("这个位置离东京太远了，请在城市附近选点。"));
});

test("选点之后客人又改了地址栏：反查回来只更新坐标，不覆盖客人写的字；状态行说明保留了", async () => {
  const pending = deferred();
  open({ config: configOf({ address_search: false, map_tiles: tiles }), reverse: () => pending.promise });
  const actor = user();
  await actor.click(await screen.findByRole("button", { name: "在地图上选上车地点" }));
  await actor.click(screen.getByRole("button", { name: "选地图中间这个位置" }));
  assert.ok(await screen.findByText("正在查找这个位置的地址…"));
  await actor.type(screen.getByLabelText("上车地址或酒店名"), "希尔顿东京 3 楼");
  pending.resolve(json(200, { available: true, address: "日本、東京都新宿区西新宿６丁目" }));
  assert.ok(await screen.findByText("坐标已更新；地址栏保留您写的内容。"));
  assert.equal(addressOf("上车"), "希尔顿东京 3 楼");
  assert.deepEqual(coordinatesOf("上车"), [String(CENTER.lat), String(CENTER.lng)]);
  // 地图、按钮、状态行在「上车地点的地图」这个分组里
  assert.ok(within(screen.getByRole("group", { name: "上车地点的地图" })).getByText("坐标已更新；地址栏保留您写的内容。"));
});
