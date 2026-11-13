/**
 * 地址候选的谷歌署名（M9E-06，ADR 0090 第四节）的组件测试：
 * - 新预订页 `/book/new` 的地址框（电脑页面上、手机全屏选择页）和包车经停点：候选里有谷歌来源时列表末尾署名「Google Maps」，
 *   不是候选（不进 ↑↓、不算进「找到 N 个地点」）；只有平台的机场、车站时不署名；
 * - 旧询价页 `/book` 的地址搜索：有谷歌来源时搜索结果末尾署名，只有平台地点时不署名；
 * - 嵌入组件和主站共用同一份写法（`lib/google-attribution.ts`）：文字、英文、不让浏览器翻译；源代码里别处不再写死这几个字。
 * 接口用测试替身（浏览器只连 /site/v1）。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { SiteCity, SiteConfig } from "../../api/site.ts";
import { GoogleMapsAttribution } from "../../components/GoogleMapsAttribution.tsx";
import { GOOGLE_MAPS_ATTRIBUTION, GOOGLE_MAPS_ATTRIBUTION_ATTRIBUTES, hasGoogleSource } from "../../lib/google-attribution.ts";
import { assertAbsent, json, resetBrowser, stubApiWith } from "../../testing/harness.tsx";
import { FULL_SCREEN_PICKER_QUERY } from "./new/full-screen.tsx";

const originalMatchMedia = window.matchMedia;
afterEach(() => {
  resetBrowser();
  window.matchMedia = originalMatchMedia;
});

const SLOW = { timeout: 3000 };
const CITY_ID = "11111111-1111-4111-8111-111111111111";
const city: SiteCity = { id: CITY_ID, code: "CTY-JP-TYO", name: { zh: "东京" }, timezone: "Asia/Tokyo", country_code: "JP", center: { lat: 35.6895, lng: 139.6917 }, categories: ["airport_transfer", "point_to_point", "charter"] };
const config: SiteConfig = { open: true, currency: "JPY", payments: null, support_phone: null, support_whatsapp: null, address_search: true, page_width: "standard", map_tiles: null };
const airport = { source: "platform", id: "22222222-2222-4222-8222-222222222222", name: "成田国际机场", address: "", location: { lat: 35.772, lng: 140.3929 }, kind: "airport" } as const;
const station = { source: "platform", id: "66666666-6666-4666-8666-666666666666", name: "新宿站", address: "", location: { lat: 35.6896, lng: 139.7006 }, kind: "other" } as const;
const hotel = { source: "google", id: "ChIJkeio", name: "京王广场酒店", address: "东京都新宿区西新宿 2-2-1", location: null, kind: "other" } as const;
/** 包车链接：上车、下车、日期时间都带上，好直接加经停点 */
const CHARTER_LINK = "/book/new?mode=charter&from=35.6905,139.6948&from_name=%E4%BA%AC%E7%8E%8B&to=35.6896,139.7006&to_name=%E6%96%B0%E5%AE%BF%E7%AB%99&date=2030-11-20&time=09:00";

/** 「成田」：平台的机场 + 谷歌的地点；「新宿」：只有平台的车站 */
function suggestionsFor(q: string) {
  if (q.includes("成田")) return [airport, { ...hotel, id: "ChIJnrt", name: "成田站前酒店" }];
  if (q.includes("新宿")) return [station];
  return [hotel];
}

function open(at = "/book/new"): void {
  stubApiWith((call) => {
    const path = call.url.pathname;
    if (path === "/site/v1/config") return json(200, config);
    // 旧询价页：只有一个城市、一种品类时直接到地址（和 site-address.test.tsx 一样）
    if (path === "/site/v1/cities") return json(200, { items: [at === "/book" ? { ...city, categories: ["point_to_point"] } : city] });
    if (path === "/site/v1/places/autocomplete") return json(200, { available: true, items: suggestionsFor(call.url.searchParams.get("q") ?? "") });
    if (path === `/site/v1/cities/${CITY_ID}/places`) return json(200, { items: [] });
    if (path === "/site/v1/places/search") {
      const q = call.url.searchParams.get("q") ?? "";
      const items = suggestionsFor(q).map((item) => ({ ...item, location: item.location ?? { lat: 35.6905, lng: 139.6948 } }));
      return json(200, { available: true, items });
    }
    if (path === `/site/v1/cities/${CITY_ID}/charter-packages`) return json(200, { items: [{ hours: 8 }] });
    if (path === "/site/v1/fx/reference") return json(200, { available: false, from: "JPY", to: call.url.searchParams.get("to"), rate: null, as_of: null, reason: "NO_RATE" });
    if (call.method === "POST" && path === "/site/v1/quotes") return json(200, { currency: "JPY", quotes: [], unavailable: [] });
    if (call.method === "POST" && path === "/site/v1/quotes/by-points") return json(200, { trip_type: null, airport: null, fallback_category: null, city: null, currency: "JPY", quotes: [], unavailable: [], expires_at: null, route: null });
    return null;
  });
  render(
    <MemoryRouter initialEntries={[at]}>
      <App />
    </MemoryRouter>,
  );
}

const user = () => userEvent.setup();

/** 署名：列表末尾一项，原样「Google Maps」、英文、不翻译；在组合框的候选列表里不是候选 */
function assertAttribution(list: HTMLElement, listbox: boolean): void {
  const last = list.lastElementChild as HTMLElement;
  assert.equal(last.textContent, GOOGLE_MAPS_ATTRIBUTION);
  assert.equal(last.textContent, "Google Maps", "文字原样：不翻译、不改写");
  assert.equal(last.getAttribute("lang"), "en");
  assert.equal(last.getAttribute("translate"), "no");
  assert.ok(last.classList.contains("google-attribution"));
  if (listbox) {
    assert.equal(last.getAttribute("role"), "presentation", "不是候选");
    assert.equal(last.querySelector('[role="option"]'), null);
  }
  assert.equal(within(list).getAllByText("Google Maps").length, 1, "整个列表只署一次，不是每个候选都带");
}

test("共用的写法：有谷歌来源才署名；文字、属性只在 lib/google-attribution.ts 定义一次", () => {
  assert.equal(GOOGLE_MAPS_ATTRIBUTION, "Google Maps");
  assert.deepEqual(GOOGLE_MAPS_ATTRIBUTION_ATTRIBUTES, { lang: "en", translate: "no" });
  assert.equal(hasGoogleSource([airport, hotel]), true);
  assert.equal(hasGoogleSource([airport, station]), false);
  assert.equal(hasGoogleSource([]), false);
  const { container, rerender } = render(<ul>{<GoogleMapsAttribution items={[airport]} />}</ul>);
  assert.equal(container.querySelector("li"), null, "只有平台地点：什么都不画");
  rerender(<ul role="listbox" aria-label="候选">{<GoogleMapsAttribution items={[airport, hotel]} listbox />}</ul>);
  assertAttribution(container.querySelector("ul") as HTMLElement, true);
  rerender(<ul aria-label="结果">{<GoogleMapsAttribution items={[hotel]} />}</ul>);
  assert.equal(container.querySelector("li")?.getAttribute("role"), null, "普通列表里是普通的一项");
});

test("嵌入组件和主站共用同一份写法：widget-ui.ts 引用 lib/google-attribution.ts，源代码里别处不写死「Google Maps」", async () => {
  const src = new URL("../../", import.meta.url);
  const widget = await readFile(new URL("embed/widget-ui.ts", src), "utf8");
  assert.match(widget, /from "\.\.\/lib\/google-attribution\.ts"/);
  assert.match(widget, /GOOGLE_MAPS_ATTRIBUTION_ATTRIBUTES/);
  const files = (await readdir(src, { recursive: true })).filter((name) => /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name));
  const hardCoded: string[] = [];
  for (const name of files) {
    if (name.replaceAll("\\", "/") === "lib/google-attribution.ts") continue;
    const code = await readFile(new URL(name, src), "utf8");
    if (/["'`>]Google Maps["'`<]/.test(code)) hardCoded.push(name);
  }
  assert.deepEqual(hardCoded, []);
});

test("/book/new 电脑：有谷歌候选时列表末尾署名「Google Maps」，不是候选、不算进个数；只有平台的车站时不署名", async () => {
  window.matchMedia = ((query: string) => ({ matches: query.includes("min-width: 1024px"), media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
  open();
  const actor = user();
  const from = await screen.findByRole("combobox", { name: "出发地" });
  await actor.type(from, "成田");
  const list = await screen.findByRole("listbox", { name: "出发地的候选" }, SLOW);
  await waitFor(() => assert.equal(within(list).getAllByRole("option").length, 2));
  assertAttribution(list, true);
  assert.ok(screen.getByText("找到 2 个地点，用 ↑↓ 选择、回车确认。"), "个数只算候选");
  // ↑↓ 只在两个候选之间走，不会停在署名上
  await actor.keyboard("{ArrowDown}{ArrowDown}");
  assert.equal(from.getAttribute("aria-activedescendant"), within(list).getAllByRole("option")[0]?.id);

  const to = screen.getByRole("combobox", { name: "目的地" });
  await actor.type(to, "新宿");
  const toList = await screen.findByRole("listbox", { name: "目的地的候选" }, SLOW);
  await within(toList).findByRole("option", { name: /新宿站/ }, SLOW);
  assertAbsent(within(toList).queryByText("Google Maps"));
  assertAbsent(toList.querySelector(".google-attribution"));
});

test("/book/new 手机全屏选择页：有谷歌候选时署名；只有平台地点时不署名", async () => {
  window.matchMedia = ((query: string) => ({ matches: query === FULL_SCREEN_PICKER_QUERY || query === "(pointer: coarse)", media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
  open();
  const actor = user();
  await actor.click(await screen.findByRole("button", { name: /^出发地/ }));
  const sheet = await screen.findByRole("dialog", { name: "出发地" });
  const input = within(sheet).getByRole("combobox", { name: "出发地" });
  await actor.type(input, "京王");
  const list = await within(sheet).findByRole("listbox", { name: "出发地的候选" }, SLOW);
  await within(list).findByRole("option", { name: /京王广场酒店/ }, SLOW);
  assertAttribution(list, true);

  await actor.clear(input);
  await actor.type(input, "新宿");
  await within(list).findByRole("option", { name: /新宿站/ }, SLOW);
  assertAbsent(within(sheet).queryByText("Google Maps"));
});

test("/book/new 包车经停点：有谷歌候选时署名；只有平台地点时不署名", async () => {
  window.matchMedia = ((query: string) => ({ matches: query.includes("min-width: 1024px"), media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
  open(CHARTER_LINK);
  const actor = user();
  await actor.click(await screen.findByRole("button", { name: "添加经停点" }, SLOW));
  const box = await screen.findByRole("combobox", { name: "经停点 1" });
  await actor.type(box, "京王");
  const list = await screen.findByRole("listbox", { name: "经停点 1的候选" }, SLOW);
  await within(list).findByRole("option", { name: /京王广场酒店/ }, SLOW);
  assertAttribution(list, true);

  await actor.clear(box);
  await actor.type(box, "新宿");
  await within(list).findByRole("option", { name: /新宿站/ }, SLOW);
  assertAbsent(within(list).queryByText("Google Maps"));
});

test("旧询价页 /book 地址搜索：有谷歌来源时搜索结果末尾署名一次；只有平台地点时不署名", async () => {
  open("/book");
  const actor = user();
  await actor.type(await screen.findByRole("searchbox", { name: "搜索上车地点（选填）" }), "成田{Enter}");
  const results = await screen.findByRole("list", { name: "搜索到的上车地点" }, SLOW);
  assert.equal(within(results).getAllByRole("button").length, 2, "署名不是可选的结果");
  assertAttribution(results, false);

  await actor.type(screen.getByRole("searchbox", { name: "搜索下车地点（选填）" }), "新宿{Enter}");
  const dropoff = await screen.findByRole("list", { name: "搜索到的下车地点" }, SLOW);
  within(dropoff).getByRole("button", { name: /新宿站/ });
  assertAbsent(within(dropoff).queryByText("Google Maps"));
});
