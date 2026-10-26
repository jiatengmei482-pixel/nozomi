/**
 * M3-12 官网地址搜索与地图选点（ADR 0044；规范 site-booking.md 3.6）测试角色补充的组件测试：
 * - 先后两次搜索：后发的先回来，先发的晚回来不能盖掉结果；
 * - 地图选点后、反查还没回来时客人改从搜索选了别的地点：晚回来的反查地址不能盖掉；
 * - 输入法组字中的回车不搜索（也不提交询价）；
 * - 换城市：搜索结果、状态行清掉，填过的地址和坐标保留；新的搜索带新城市；
 * - 搜索的状态行一开始就在页面里（role=status），读屏能播报之后的结果；
 * - 两个地图都展开时，读屏用户能分清「选地图中间这个位置」「放大 / 缩小地图」「收起地图」是上车还是下车的；
 * - 浏览器存储里没有谷歌的东西（密钥、搜索关键字、地点 ID 都不落地）。
 * 接口用测试替身（浏览器只连 /site/v1）。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { MapTiles } from "../../api/areas.ts";
import type { SiteCity, SiteConfig } from "../../api/site.ts";
import { type ApiCall, assertAbsent, json, resetBrowser, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const TOKYO = "11111111-1111-4111-8111-111111111111";
const OSAKA = "22222222-2222-4222-8222-222222222222";
const cities: SiteCity[] = [
  { id: TOKYO, code: "CTY-JP-TYO", name: { zh: "东京" }, timezone: "Asia/Tokyo", country_code: "JP", center: { lat: 35.6895, lng: 139.6917 }, categories: ["point_to_point"] },
  { id: OSAKA, code: "CTY-JP-OSA", name: { zh: "大阪" }, timezone: "Asia/Tokyo", country_code: "JP", center: { lat: 34.7, lng: 135.5 }, categories: ["point_to_point"] },
];
const tiles: MapTiles = { url_template: "http://127.0.0.1:1/{z}/{x}/{y}.png", dark_url_template: null, min_zoom: 3, max_zoom: 19, tile_size: 256, referrer_policy: "strict-origin", attribution: [{ text: "© OpenStreetMap", href: "https://www.openstreetmap.org/copyright" }] };
const configOf = (changes: Partial<SiteConfig> = {}): SiteConfig => ({ open: true, currency: "JPY", payments: null, support_phone: null, address_search: true, map_tiles: tiles, ...changes });
const place = (id: string, name: string, lat: number, lng: number) => ({ id, name, address: `${name}的地址`, location: { lat, lng } });

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;

function open(options: { search?: Route; reverse?: Route; cityList?: SiteCity[] } = {}): ApiCall[] {
  const calls = stubApiWith((call) => {
    const path = call.url.pathname;
    if (path === "/site/v1/config") return json(200, configOf());
    if (path === "/site/v1/cities") return json(200, { items: options.cityList ?? [cities[0]] });
    if (/^\/site\/v1\/cities\/[^/]+\/places$/.test(path)) return json(200, { items: [] });
    if (path === "/site/v1/places/search") return options.search?.(call) ?? json(200, { available: true, items: [place("ChIJa", "东京站大饭店", 35.6813, 139.7662)] });
    if (path === "/site/v1/places/reverse") return options.reverse?.(call) ?? json(200, { available: true, address: "日本、東京都新宿区西新宿２丁目" });
    if (call.method === "POST") return json(200, { currency: "JPY", quotes: [], unavailable: [] });
    return null;
  });
  render(
    <MemoryRouter initialEntries={["/book"]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

/** 由测试决定什么时候回来的应答 */
function later(): { promise: Promise<Response>; resolve(response: Response): void } {
  let resolve: (response: Response) => void = () => undefined;
  const promise = new Promise<Response>((done) => (resolve = done));
  return { promise, resolve };
}

const user = () => userEvent.setup();
const coordinatesOf = (word: "上车" | "下车"): [string, string] => {
  const group = screen.getByRole("group", { name: new RegExp(`${word}地点的坐标`) });
  return [(within(group).getByLabelText(/^纬度/) as HTMLInputElement).value, (within(group).getByLabelText(/^经度/) as HTMLInputElement).value];
};
const addressOf = (word: "上车" | "下车"): string => (screen.getByLabelText(`${word}地址或酒店名`) as HTMLInputElement).value;

test("先后两次搜索：后发的先回来就显示后发的；先发的晚回来不盖掉", async () => {
  const slow = later();
  open({
    search: (call) => (call.url.searchParams.get("q") === "第一次" ? slow.promise : json(200, { available: true, items: [place("ChIJsecond", "第二次的结果", 35.69, 139.7)] })),
  });
  const actor = user();
  const box = await screen.findByRole("searchbox", { name: "搜索上车地点（选填）" });
  await actor.type(box, "第一次{Enter}");
  await actor.clear(box);
  await actor.type(box, "第二次{Enter}");
  const list = await screen.findByRole("list", { name: "搜索到的上车地点" });
  assert.ok(within(list).getByRole("button", { name: /第二次的结果/ }));
  slow.resolve(json(200, { available: true, items: [place("ChIJfirst", "第一次的结果", 35.68, 139.76)] }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assertAbsent(screen.queryByRole("button", { name: /第一次的结果/ }));
  assert.ok(screen.getByRole("button", { name: /第二次的结果/ }));
});

test("地图选点后反查还没回来，客人改从搜索选了别的地点：晚回来的反查地址不盖掉搜索选中的地址和坐标", async () => {
  const slow = later();
  open({ reverse: () => slow.promise });
  const actor = user();
  await actor.click(await screen.findByRole("button", { name: "在地图上选上车地点" }));
  await actor.click(screen.getAllByRole("button", { name: "选地图中间这个位置" })[0] as HTMLElement);
  await waitFor(() => assert.deepEqual(coordinatesOf("上车"), ["35.6895", "139.6917"]));
  await actor.type(screen.getByRole("searchbox", { name: "搜索上车地点（选填）" }), "东京站{Enter}");
  await actor.click(within(await screen.findByRole("list", { name: "搜索到的上车地点" })).getByRole("button", { name: /东京站大饭店/ }));
  assert.equal(addressOf("上车"), "东京站大饭店（东京站大饭店的地址）");
  slow.resolve(json(200, { available: true, address: "晚到的反查地址" }));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(addressOf("上车"), "东京站大饭店（东京站大饭店的地址）");
  assert.deepEqual(coordinatesOf("上车"), ["35.6813", "139.7662"]);
  assertAbsent(screen.queryByText("已填入这个位置的地址和坐标，可以在地址后面补充酒店名、楼层。"));
});

test("输入法组字时按回车（选字）不搜索、不提交询价；组字结束后的回车才搜索", async () => {
  const calls = open();
  const box = await screen.findByRole("searchbox", { name: "搜索上车地点（选填）" });
  fireEvent.change(box, { target: { value: "とうきょう" } });
  fireEvent.keyDown(box, { key: "Enter", code: "Enter", keyCode: 229, isComposing: true });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(calls.filter((call) => call.path.includes("/places/search")).length, 0);
  assert.equal(calls.filter((call) => call.method === "POST").length, 0);
  fireEvent.keyDown(box, { key: "Enter", code: "Enter", keyCode: 13 });
  await waitFor(() => assert.equal(calls.filter((call) => call.path.includes("/places/search")).length, 1));
  assert.equal(calls.filter((call) => call.method === "POST").length, 0);
});

test("换城市：搜索结果和状态行清掉，填过的地址和坐标保留；再搜带的是新城市", async () => {
  const calls = open({ cityList: cities });
  const actor = user();
  await actor.selectOptions(await screen.findByLabelText(/^城市/), TOKYO);
  await actor.type(await screen.findByRole("searchbox", { name: "搜索上车地点（选填）" }), "东京站{Enter}");
  await actor.click(within(await screen.findByRole("list", { name: "搜索到的上车地点" })).getByRole("button", { name: /东京站大饭店/ }));
  await actor.type(screen.getByRole("searchbox", { name: "搜索下车地点（选填）" }), "新宿{Enter}");
  assert.ok(await screen.findByRole("list", { name: "搜索到的下车地点" }));
  await actor.selectOptions(screen.getByLabelText(/^城市/), OSAKA);
  assertAbsent(screen.queryByRole("list", { name: "搜索到的下车地点" }));
  assertAbsent(screen.queryByText(/已填入「东京站大饭店」/));
  assert.equal(screen.getAllByText("输入酒店名、地址或地标，按「搜索」在大阪附近查找").length, 2);
  assert.equal(addressOf("上车"), "东京站大饭店（东京站大饭店的地址）");
  assert.deepEqual(coordinatesOf("上车"), ["35.6813", "139.7662"]);
  await actor.type(screen.getByRole("searchbox", { name: "搜索上车地点（选填）" }), "梅田{Enter}");
  await waitFor(() => assert.equal(calls.filter((call) => call.path.includes("/places/search")).length, 3));
  const last = new URL(calls.filter((call) => call.path.includes("/places/search"))[2]?.path ?? "", "http://x");
  assert.equal(last.searchParams.get("city_id"), OSAKA);
});

test("读屏：搜索的状态行一开始就在页面里（role=status），之后的结果、用不了的说明都在里面播报", async () => {
  open({ search: () => json(200, { available: false, items: [] }) });
  const actor = user();
  const box = await screen.findByRole("searchbox", { name: "搜索上车地点（选填）" });
  const region = box.closest(".site-address-search");
  assert.ok(region !== null);
  const status = within(region as HTMLElement).getByRole("status");
  assert.equal(status.textContent, "");
  await actor.type(box, "东京站{Enter}");
  await waitFor(() => assert.match(status.textContent ?? "", /地址搜索暂时用不了。可以从常用地点选/));
});

test("【缺陷】读屏：上车、下车两个地图都展开时，地图下方和角上的按钮分不清是哪一个地点的（同名且不在带名称的分组里）", async () => {
  open();
  const actor = user();
  await actor.click(await screen.findByRole("button", { name: "在地图上选上车地点" }));
  await actor.click(screen.getByRole("button", { name: "在地图上选下车地点" }));
  assert.equal(screen.getAllByRole("application").length, 2);
  /** 读屏用户能听到的「这个按钮属于谁」：按钮自己的名称 + 所在的带名称的分组 / 区域 */
  const heard = (button: HTMLElement): string => {
    const owner = button.closest("[role=group][aria-label],[role=region][aria-label],fieldset,section[aria-label],section[aria-labelledby]");
    const ownerName = owner === null ? "" : (owner.getAttribute("aria-label") ?? owner.querySelector("legend")?.textContent ?? "");
    return `${ownerName}|${button.getAttribute("aria-label") ?? button.textContent ?? ""}`;
  };
  const ambiguous: string[] = [];
  for (const name of ["选地图中间这个位置", "放大地图", "缩小地图", "收起地图"]) {
    const buttons = screen.queryAllByRole("button", { name });
    const heardAs = new Set(buttons.map(heard));
    if (buttons.length > 1 && heardAs.size < buttons.length) ambiguous.push(`「${name}」×${buttons.length}`);
  }
  assert.deepEqual(ambiguous, [], `这些按钮在读屏里听起来一样：${ambiguous.join("、")}`);
});

test("浏览器存储里没有谷歌的任何东西：搜索、选中、地图选点、反查之后，localStorage / sessionStorage / cookie 都没有搜索关键字、谷歌的地点 ID 或 AIza 开头的值（客人自己填进表单的地址属于询价草稿，不在此列）", async () => {
  open();
  const actor = user();
  await actor.type(await screen.findByRole("searchbox", { name: "搜索上车地点（选填）" }), "唯一关键字QA{Enter}");
  await actor.click(within(await screen.findByRole("list", { name: "搜索到的上车地点" })).getByRole("button", { name: /东京站大饭店/ }));
  await actor.click(screen.getByRole("button", { name: "在地图上选下车地点" }));
  await actor.click(screen.getAllByRole("button", { name: "选地图中间这个位置" })[0] as HTMLElement);
  await waitFor(() => assert.equal(addressOf("下车"), "日本、東京都新宿区西新宿２丁目"));
  const stored = [document.cookie, ...Object.keys(localStorage).map((key) => `${key}=${localStorage.getItem(key)}`), ...Object.keys(sessionStorage).map((key) => `${key}=${sessionStorage.getItem(key)}`)].join("\n");
  for (const needle of ["AIza", "唯一关键字QA", "ChIJa"]) assert.ok(!stored.includes(needle), `浏览器存储里有 ${needle}`);
});
