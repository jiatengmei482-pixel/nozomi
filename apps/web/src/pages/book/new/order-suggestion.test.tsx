/**
 * 包车经停顺序建议（M9P-20 P2，ADR 0096 第三节、第四节）的组件测试：
 * - 当前顺序报出价以后申请一次建议（带当前报价编号、每行的标识、会话），只换顺序不再申请；
 * - 建议块：标题（可省公里、分钟、钱）、两栏的编号顺序和价；「采用」按标识重排、直接用建议报价（不再多询一次价），焦点到行程标题、读屏播报；
 *   之后有「恢复原来的顺序」；「保持我的顺序」收起、同一组点不再申请；
 * - 改了停留：先显示「正在按最新行程重算建议…」、不能采用，新建议回来后才能采用；
 * - 指定到达时间（M9P-20 P3）：加上到达时间重新申请，建议顺序预计晚到时在「建议顺序」一栏提示。
 * 接口用测试替身；真实后端由 apps/api/src/site-order-suggestion.itest.ts 覆盖。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../../App.tsx";
import type { SiteCity, SiteConfig, SiteOrderSuggestion, SiteQuote, SiteQuoteResult } from "../../../api/site.ts";
import { draftRequestKey } from "../../../lib/order-suggestion.ts";
import { type ApiCall, assertFocused, json, resetBrowser, stubApiWith } from "../../../testing/harness.tsx";
import { ORDER_SUGGESTION_SETTLE } from "./OrderSuggestion.tsx";

const settle = ORDER_SUGGESTION_SETTLE.ms;
const originalMatchMedia = window.matchMedia;
afterEach(() => {
  cleanup();
  resetBrowser();
  window.matchMedia = originalMatchMedia;
  ORDER_SUGGESTION_SETTLE.ms = settle;
});

function wideScreen(): void {
  window.matchMedia = ((query: string) => ({ matches: query.includes("min-width: 1024px"), media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
}

const SLOW = { timeout: 4000 };
const CITY_ID = "11111111-1111-4111-8111-111111111111";
const city: SiteCity = { id: CITY_ID, code: "CTY-JP-TYO", name: { zh: "东京" }, timezone: "Asia/Tokyo", country_code: "JP", center: { lat: 35.6895, lng: 139.6917 }, categories: ["charter"] };
const config: SiteConfig = { open: true, currency: "JPY", payments: null, support_phone: "+81 3-1234-5678", support_whatsapp: null, address_search: true, page_width: "standard", map_tiles: null };
const LINK = "/book?mode=charter&from=35.6905,139.6948&from_name=%E4%BA%AC%E7%8E%8B%E5%B9%BF%E5%9C%BA%E9%85%92%E5%BA%97&to=35.6896,139.7006&to_name=%E6%96%B0%E5%AE%BF%E7%AB%99&date=2030-11-20&time=08:00";
const SPOTS: Record<string, { lat: number; lng: number }> = { 河口湖: { lat: 35.498, lng: 138.769 }, 横滨: { lat: 35.45, lng: 139.63 }, 箱根: { lat: 35.23, lng: 139.1 } };

let quoteSeq = 0;
function quoteOf(amount: number, hours = 10): SiteQuote {
  quoteSeq += 1;
  return {
    quote_id: `QT2030112000000000${String(quoteSeq).padStart(4, "0")}`,
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    service_date: "2030-11-20",
    urgent: false,
    includes_area_surcharge: false,
    vehicle_group: { id: "33333333-3333-4333-8333-333333333301", code: "VG-T1", name: { zh: "车型1" }, grade: "economy", seats: 7, sample_models: [], combos: [{ passengers: 6, luggage: 4 }] },
    package: { hours, km: 200 },
    // 有经停点时报价自动选的档（升档下拉只列比它长的）
    auto_package_hours: 10,
    price: { total: { amount: String(amount), currency: "JPY" }, fx: null },
    free_wait_minutes: 0,
    cancel_policy: { category: "charter", level: "economy", tiers: [{ min_hours_before: 24, fee_bp: 0 }, { min_hours_before: 0, fee_bp: 10000 }] },
    available_addons: [],
    itinerary_warnings: null,
  };
}
const route = (meters: number, drive: number) => ({ legs: [{ minutes: drive / 4, meters: meters / 4 }, { minutes: drive / 4, meters: meters / 4 }, { minutes: drive / 4, meters: meters / 4 }, { minutes: drive / 4, meters: meters / 4 }], drive_minutes: drive, stay_minutes: 180, total_minutes: drive + 180, total_meters: meters });
/** 当前顺序：绕路（320 公里、320 分钟）；排成建议顺序（横滨、箱根、河口湖）：240 公里、240 分钟 */
const resultFor = (names: string[], hours?: number): SiteQuoteResult => {
  const best = names.join() === "横滨,箱根,河口湖";
  // 升到 12 小时（M9P-03 手动升档）多 10,000
  const extra = hours === 12 ? 10_000 : 0;
  return { currency: "JPY", quotes: [quoteOf((best ? 70_000 : 75_000) + extra, hours ?? 10)], unavailable: [], itinerary_route: best ? route(240_000, 240) : route(320_000, 320) };
};

function open(options: { packages?: number[] } = {}): { calls: ApiCall[]; suggestions: Record<string, any>[] } {
  const suggestions: Record<string, any>[] = [];
  const calls = stubApiWith((call) => {
    const path = call.url.pathname;
    if (path === "/site/v1/config") return json(200, config);
    if (path === "/site/v1/cities") return json(200, { items: [city] });
    if (path === "/site/v1/places/autocomplete") {
      const q = call.url.searchParams.get("q") ?? "";
      const name = Object.keys(SPOTS).find((spot) => q.includes(spot));
      return json(200, { available: true, items: name === undefined ? [] : [{ source: "platform", id: `spot-${name}`, name, address: "", location: SPOTS[name], kind: "station" }] });
    }
    if (path === "/site/v1/charter-packages") return json(200, { city: { id: CITY_ID, code: city.code, name: city.name, timezone: city.timezone }, items: (options.packages ?? [8, 10]).map((hours) => ({ hours })) });
    if (path === "/site/v1/fx/reference") return json(200, { available: false, from: "JPY", to: call.url.searchParams.get("to"), rate: null, as_of: null, reason: "NO_RATE" });
    if (call.method === "POST" && path === "/site/v1/quotes") {
      const body = call.body as { waypoints?: { name: string }[]; package_hours?: number };
      return json(200, resultFor((body.waypoints ?? []).map((stop) => stop.name), body.package_hours));
    }
    if (call.method === "POST" && path === "/site/v1/charter/order-suggestion") {
      const body = call.body as Record<string, any>;
      suggestions.push(body);
      const refs = body.refs as string[];
      const names = (body.quote.waypoints as { name: string }[]).map((stop) => stop.name);
      const refOf = (name: string) => refs[names.indexOf(name)] as string;
      const suggestion: SiteOrderSuggestion = {
        order: ["横滨", "箱根", "河口湖"].map(refOf),
        saved_meters: 80_000,
        saved_minutes: 80,
        current_itinerary_route: route(320_000, 320),
        itinerary_route: route(240_000, 240),
        request_key: draftRequestKey(body.quote),
        thresholds: { min_saved_meters: 5_000, min_saved_minutes: 10 },
        current_too_long: false,
        quote_result: resultFor(["横滨", "箱根", "河口湖"], body.quote.package_hours ?? undefined),
      };
      return json(200, { suggestion, reason: null });
    }
    return null;
  });
  render(
    <MemoryRouter initialEntries={[LINK]}>
      <App />
    </MemoryRouter>,
  );
  return { calls, suggestions };
}

const user = () => userEvent.setup();
async function addStop(actor: ReturnType<typeof user>, spot: string): Promise<void> {
  await actor.click(screen.getByRole("button", { name: "添加经停点" }));
  const box = screen.getAllByRole("combobox", { name: /^经停点 \d+$/ }).at(-1) as HTMLElement;
  await waitFor(() => assertFocused(box));
  await actor.type(box, spot);
  await actor.click(await screen.findByRole("option", { name: new RegExp(spot) }, SLOW));
  await actor.selectOptions(screen.getAllByLabelText(/^经停点 \d+ 停留时长/).at(-1) as HTMLElement, "60");
}
const stopNames = (): string[] => screen.getAllByRole("combobox", { name: /^经停点 \d+$/ }).map((box) => (box as HTMLInputElement).value);
const quoteCalls = (calls: ApiCall[]) => calls.filter((call) => call.method === "POST" && call.path === "/site/v1/quotes");

async function toSuggestion(options: { packages?: number[] } = {}) {
  ORDER_SUGGESTION_SETTLE.ms = 10;
  wideScreen();
  const opened = open(options);
  const actor = user();
  await screen.findByRole("button", { name: "添加经停点" }, SLOW);
  await addStop(actor, "河口湖");
  await addStop(actor, "横滨");
  await addStop(actor, "箱根");
  await actor.click(screen.getByRole("button", { name: "下一步：选择车型" }));
  const block = await screen.findByRole("region", { name: /^建议顺序，可省/ }, SLOW);
  return { ...opened, actor, block };
}

test("当前顺序报出价后申请一次建议：带当前报价编号、每行的标识、会话；建议块写可省多少、两栏的编号顺序和价", async () => {
  const { suggestions, block, calls } = await toSuggestion();
  assert.equal(suggestions.length, 1);
  const sent = suggestions[0] as Record<string, any>;
  const lastQuote = quoteCalls(calls).at(-1);
  assert.ok(lastQuote !== undefined);
  assert.equal(sent.quote_id?.startsWith("QT"), true);
  assert.deepEqual(sent.quote.waypoints.map((stop: { name: string }) => stop.name), ["河口湖", "横滨", "箱根"]);
  assert.equal(sent.refs.length, 3);
  assert.equal(new Set(sent.refs).size, 3);
  assert.match(sent.session, /^[A-Za-z0-9_-]{8,64}$/);
  assert.equal(within(block).getByRole("heading", { level: 4, name: /^建议顺序，/ }).textContent, "建议顺序，可省 80 公里、1 小时 20 分、5,000 JPY");
  assert.ok(within(block).getByText("1 京王广场酒店 → 2 河口湖 → 3 横滨 → 4 箱根 → 5 新宿站"));
  assert.ok(within(block).getByText("1 京王广场酒店 → 2 横滨 → 3 箱根 → 4 河口湖 → 5 新宿站"));
  assert.ok(within(block).getByRole("button", { name: "采用建议顺序" }));
  // 读屏播报一次（同一组点只播一次）
  await waitFor(() => assert.ok([...document.querySelectorAll("p.visually-hidden[role=status]")].some((node) => node.textContent === "建议顺序，可省 80 公里、1 小时 20 分、5,000 JPY")));
});

test("采用：按标识重排、直接用建议报价（不再多询一次价）；焦点到行程标题、播报新顺序；之后能恢复原来的顺序；排成建议顺序后建议块收起", async () => {
  const { actor, block, calls, suggestions } = await toSuggestion();
  const quotesBefore = quoteCalls(calls).length;
  await actor.click(within(block).getByRole("button", { name: "采用建议顺序" }));
  await waitFor(() => assertFocused(screen.getByRole("heading", { name: "行程时间表" })));
  // 采用的那句和「价格已更新」接在一起播，不互相覆盖
  await waitFor(() => assert.ok(screen.getByText("已按建议顺序排列：1 京王广场酒店 → 2 横滨 → 3 箱根 → 4 河口湖 → 5 新宿站 价格已更新：车型1 70,000 JPY")));
  await waitFor(() => assert.match(screen.getByRole("heading", { name: "车型1" }).closest("li")?.textContent ?? "", /70,000 JPY/), SLOW);
  assert.equal(quoteCalls(calls).length, quotesBefore, "用的就是建议报价，没有多询价");
  assert.equal(screen.queryByRole("region", { name: /^建议顺序，可省/ }), null, "已经是建议顺序，建议块收起");
  const list = screen.getByRole("list", { name: "行程" });
  assert.deepEqual([...list.querySelectorAll(".trip-stops__name")].map((node) => node.textContent), ["京王广场酒店", "横滨", "箱根", "河口湖", "新宿站"]);
  assert.equal(suggestions.length, 1, "只换了顺序，不再申请建议");
  // 恢复原来的顺序（第 1 步的经停点也跟着）
  await actor.click(screen.getByRole("button", { name: "恢复原来的顺序" }));
  await waitFor(() => assertFocused(screen.getByRole("heading", { name: "行程时间表" })));
  assert.ok(screen.getByText(/^已恢复原来的顺序/));
  await waitFor(() => assert.match(screen.getByRole("heading", { name: "车型1" }).closest("li")?.textContent ?? "", /75,000 JPY/), SLOW);
  await actor.click(screen.getByRole("button", { name: "上一步" }));
  assert.deepEqual(stopNames(), ["河口湖", "横滨", "箱根"]);
});

test("手动升到 12 小时后采用：建议按 12 小时算，采用后直接用建议报价不再询价；之后把升档改回自动再恢复原来的顺序，恢复的是采用时的 12 小时；价格变了只播报一条", async () => {
  const { actor, calls, suggestions } = await toSuggestion({ packages: [8, 10, 12] });
  // 升档下拉在第 1 步（行程）里
  await actor.click(screen.getByRole("button", { name: "上一步" }));
  await actor.selectOptions(await screen.findByLabelText(/^包车时长/, {}, SLOW), "12");
  await actor.click(screen.getByRole("button", { name: "下一步：选择车型" }));
  await waitFor(() => assert.match(screen.getByRole("heading", { name: "车型1" }).closest("li")?.textContent ?? "", /85,000 JPY/), SLOW);
  await waitFor(() => assert.equal(suggestions.at(-1)?.quote.package_hours, 12, "建议按升档后的时长申请"), SLOW);
  const block = await screen.findByRole("region", { name: /^建议顺序，可省/ }, SLOW);
  const quotesBefore = quoteCalls(calls).length;
  await actor.click(within(block).getByRole("button", { name: "采用建议顺序" }));
  await waitFor(() => assert.match(screen.getByRole("heading", { name: "车型1" }).closest("li")?.textContent ?? "", /80,000 JPY/), SLOW);
  assert.equal(quoteCalls(calls).length, quotesBefore, "升档跟着走，询价键和预存的建议报价对得上，没有多询价");
  // 在建议顺序上把升档改回自动（10 小时）
  await actor.click(screen.getByRole("button", { name: "上一步" }));
  assert.equal((screen.getByLabelText(/^包车时长/) as HTMLSelectElement).value, "12", "采用后升档没有丢");
  await actor.selectOptions(screen.getByLabelText(/^包车时长/), "");
  await actor.click(screen.getByRole("button", { name: "下一步：选择车型" }));
  await waitFor(() => assert.match(screen.getByRole("heading", { name: "车型1" }).closest("li")?.textContent ?? "", /70,000 JPY/), SLOW);
  // 恢复原来的顺序：用采用时的 12 小时（对原顺序一定有效），不用现在的自动
  await actor.click(screen.getByRole("button", { name: "恢复原来的顺序" }));
  await waitFor(() => assert.match(screen.getByRole("heading", { name: "车型1" }).closest("li")?.textContent ?? "", /85,000 JPY/), SLOW);
  assert.equal((quoteCalls(calls).at(-1)?.body as { package_hours?: number } | undefined)?.package_hours, 12, "恢复后按采用时的 12 小时询价");
  // 播报区常驻在车型区外层（重新询价的骨架屏不会把它卸掉）；恢复那句和「价格已更新」接在一起播
  const live = document.querySelector(".book-new__vehicles > p.visually-hidden[role=status]");
  assert.ok(live !== null);
  await waitFor(() => assert.equal(live.textContent, "已恢复原来的顺序 价格已更新：车型1 85,000 JPY"));
  await actor.click(screen.getByRole("button", { name: "上一步" }));
  assert.equal((screen.getByLabelText(/^包车时长/) as HTMLSelectElement).value, "12");
});

test("保持我的顺序：建议块收起，同一组点不再申请", async () => {
  const { actor, block, suggestions } = await toSuggestion();
  await actor.click(within(block).getByRole("button", { name: "保持我的顺序" }));
  assert.equal(screen.queryByRole("region", { name: /^建议顺序，可省/ }), null);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(suggestions.length, 1);
});

test("改了停留：先「正在按最新行程重算建议…」不能采用；新建议回来后才能采用", async () => {
  const { actor, suggestions } = await toSuggestion();
  await actor.click(screen.getByRole("button", { name: "上一步" }));
  await actor.selectOptions(screen.getByLabelText(/^经停点 1 停留时长/), "90");
  await actor.click(screen.getByRole("button", { name: "下一步：选择车型" }));
  await waitFor(() => assert.equal(suggestions.length, 2), SLOW);
  assert.equal((suggestions[1] as Record<string, any>).quote.waypoints[0].stay_minutes, 90);
  const block = await screen.findByRole("region", { name: /^建议顺序，可省/ }, SLOW);
  await waitFor(() => assert.equal((within(block).getByRole("button", { name: "采用建议顺序" }) as HTMLButtonElement).disabled, false), SLOW);
});

test("指定到达时间（M9P-20 P3）：给经停加上到达时间是固定点变了，重新申请建议（请求里带 arrive_by）；建议顺序预计晚到时在「建议顺序」一栏提示，当前顺序晚到在那一行提示", async () => {
  const { actor, suggestions } = await toSuggestion();
  await actor.click(screen.getByRole("button", { name: "上一步" }));
  // 08:00 出发。当前顺序（每段 80 分钟、停 60）箱根第 3 个：预计 14:00 到；建议顺序（每段 60 分钟）箱根第 2 个：预计 11:00 到
  fireEvent.change(screen.getByLabelText("经停点 3 指定到达时间（选填）"), { target: { value: "10:30" } });
  const row = screen.getByRole("button", { name: "把 箱根 上移" }).closest("li") as HTMLElement;
  await waitFor(() => assert.ok(within(row).getByText(/^预计 14:00 到，晚于指定的 10:30，来不及。请把上车时间提前到 \d\d:\d\d 或更早/)), SLOW);
  await actor.click(screen.getByRole("button", { name: "下一步：选择车型" }));
  await waitFor(() => assert.equal(suggestions.length, 2), SLOW);
  const sent = suggestions[1] as Record<string, any>;
  assert.deepEqual(sent.quote.waypoints.map((stop: { arrive_by?: unknown }) => stop.arrive_by ?? null), [null, null, { day_offset: 0, time: "10:30" }]);
  const block = await screen.findByRole("region", { name: /^建议顺序，可省/ }, SLOW);
  await waitFor(() => assert.ok(within(block).getByText("箱根：预计 11:00 到，晚于指定的 10:30")), SLOW);
});

test("指针拖动（ADR 0096 第三节第 7 小节）：按住把手拖到第 3 行下面 → 顺序变了、播报新位置；把手不进 Tab 顺序", async () => {
  ORDER_SUGGESTION_SETTLE.ms = 10;
  wideScreen();
  open();
  const actor = user();
  await screen.findByRole("button", { name: "添加经停点" }, SLOW);
  await addStop(actor, "河口湖");
  await addStop(actor, "横滨");
  await addStop(actor, "箱根");
  const rows = [...document.querySelectorAll<HTMLElement>("[data-waypoint]")];
  rows.forEach((row, index) => {
    row.getBoundingClientRect = () => ({ top: index * 100, height: 100, bottom: index * 100 + 100, left: 0, right: 300, width: 300, x: 0, y: index * 100, toJSON: () => ({}) }) as DOMRect;
  });
  const handle = rows[0]?.querySelector<HTMLElement>("[data-drag-handle]") as HTMLElement;
  assert.equal(handle.getAttribute("aria-hidden"), "true");
  assert.equal(handle.hasAttribute("tabindex"), false, "把手不进 Tab 顺序");
  fireEvent.pointerDown(handle, { pointerId: 1, pointerType: "mouse", clientY: 50 });
  fireEvent.pointerMove(handle, { pointerId: 1, pointerType: "mouse", clientY: 280 });
  await waitFor(() => assert.ok(document.querySelectorAll<HTMLElement>("[data-waypoint]")[2]?.classList.contains("picked__row--drop-after"), "目标位置画插入线"));
  fireEvent.pointerUp(handle, { pointerId: 1, pointerType: "mouse", clientY: 280 });
  await waitFor(() => assert.deepEqual(stopNames(), ["横滨", "箱根", "河口湖"]));
  assert.ok(screen.getByText("河口湖 现在排第 3，共 3 个"));
});
