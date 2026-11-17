/**
 * 包车快捷入口在新预订页里（M9P-22，ADR 0098 第三节第 6、7 小节）的组件测试：
 * - 手机宽度（M9E-32 底部按钮条）：「机场送机结束」→ 下车点按航站楼选，第 1 步「下一步：选择车型」在底部条（本步操作）里、没有旧的 .book-actions / .book-bar；
 *   询价带航站楼坐标；明细套餐行写场景名「8 小时包车 + 羽田机场送机」；匹配到机场时第 3 步备注框提示航班号，没有航班号字段。
 * - 电脑宽度：「机场接机开始」有计时提示；「改填其他地点」回到普通地址输入。
 * 接口用测试替身（浏览器只连 /site/v1）；真实后端由 e2e/site-charter-airport.spec.ts 覆盖。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../../App.tsx";
import type { SiteCharterAirport, SiteCity, SiteConfig, SiteQuote, SiteQuoteResult } from "../../../api/site.ts";
import { type ApiCall, assertAbsent, json, resetBrowser, stubApiWith } from "../../../testing/harness.tsx";

const originalMatchMedia = window.matchMedia;
afterEach(() => {
  cleanup();
  resetBrowser();
  window.matchMedia = originalMatchMedia;
});

function screenWidth(kind: "compact" | "wide"): void {
  window.matchMedia = ((query: string) => ({ matches: kind === "compact" ? query.includes("max-width: 1023px") : query.includes("min-width: 1024px"), media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
}

const SLOW = { timeout: 3000 };
const CITY_ID = "11111111-1111-4111-8111-111111111111";
const city: SiteCity = { id: CITY_ID, code: "CTY-JP-TYO", name: { zh: "东京" }, timezone: "Asia/Tokyo", country_code: "JP", center: { lat: 35.6895, lng: 139.6917 }, categories: ["charter"] };
const config: SiteConfig = { open: true, currency: "JPY", payments: null, support_phone: "+81 3-1234-5678", support_whatsapp: null, address_search: true, page_width: "standard", map_tiles: null };
/** 上车：京王广场酒店，下车：新宿站，日期时间也带上（带齐了直接到第 2 步） */
const LINK = "/book/new?mode=charter&from=35.6905,139.6948&from_name=%E4%BA%AC%E7%8E%8B%E5%B9%BF%E5%9C%BA%E9%85%92%E5%BA%97&to=35.6896,139.7006&to_name=%E6%96%B0%E5%AE%BF%E7%AB%99&date=2030-11-20&time=09:00";
const HANEDA: SiteCharterAirport = {
  id: "44444444-4444-4444-8444-444444444444",
  code: "HND",
  name: "羽田机场",
  city_id: CITY_ID,
  terminals: [
    { id: "55555555-5555-4555-8555-555555555551", code: "HND-T1", name: { zh: "第 1 航站楼" }, location: { lng: 139.785, lat: 35.549 } },
    { id: "55555555-5555-4555-8555-555555555553", code: "HND-T3", name: { zh: "第 3 航站楼" }, location: { lng: 139.768, lat: 35.545 } },
  ],
};

const yen = (amount: number) => ({ amount: String(amount), currency: "JPY" });
function quoteOf(scenario: "airport_end" | null): SiteQuote {
  return {
    quote_id: "QT203011200000000001",
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    service_date: "2030-11-20",
    urgent: false,
    includes_area_surcharge: false,
    vehicle_group: { id: "33333333-3333-4333-8333-333333333301", code: "VG-T1", name: { zh: "车型1" }, grade: "economy", seats: 7, sample_models: ["Toyota Noah"], combos: [{ passengers: 6, luggage: 4 }] },
    package: { hours: 8, km: 200 },
    price: { total: yen(60_500), fx: null },
    price_breakdown: [{ kind: "base", amount: yen(60_500), area_name: null, stop_seqs: null, ...(scenario === null ? {} : { scenario: { kind: scenario, airport_id: HANEDA.id, airport_name: "羽田机场" } }) }],
    free_wait_minutes: 0,
    cancel_policy: { category: "charter", level: "economy", tiers: [{ min_hours_before: 24, fee_bp: 0 }, { min_hours_before: 0, fee_bp: 10000 }] },
    available_addons: [],
    itinerary_warnings: null,
  };
}
const resultOf = (scenario: "airport_end" | null): SiteQuoteResult => ({ currency: "JPY", quotes: [quoteOf(scenario)], unavailable: [] });

function open(scenarioFor: (call: ApiCall) => "airport_end" | null): ApiCall[] {
  const calls = stubApiWith((call) => {
    const path = call.url.pathname;
    if (path === "/site/v1/config") return json(200, config);
    if (path === "/site/v1/cities") return json(200, { items: [city] });
    if (path === "/site/v1/charter-airports") return json(200, { items: [HANEDA] });
    if (path === "/site/v1/places/autocomplete") return json(200, { available: true, items: [] });
    if (path === "/site/v1/charter-packages") return json(200, { city: { id: CITY_ID, code: city.code, name: city.name, timezone: city.timezone }, items: [{ hours: 8 }] });
    if (path === "/site/v1/fx/reference") return json(200, { available: false, from: "JPY", to: call.url.searchParams.get("to"), rate: null, as_of: null, reason: "NO_RATE" });
    if (call.method === "POST" && path === "/site/v1/quotes") return json(200, resultOf(scenarioFor(call)));
    return null;
  });
  render(
    <MemoryRouter initialEntries={[LINK]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

const user = () => userEvent.setup();
const quotes = (calls: ApiCall[]): Record<string, unknown>[] => calls.filter((call) => call.method === "POST" && call.path === "/site/v1/quotes").map((call) => call.body as Record<string, unknown>);
/** 包车时长：只有一档时可能已经选上；没选就选 8 小时 */
async function pickHours(actor: ReturnType<typeof user>): Promise<void> {
  const select = (await screen.findByLabelText(/^包车时长/, {}, SLOW)) as HTMLSelectElement;
  await waitFor(() => assert.ok([...select.options].some((option) => option.value === "8")), SLOW);
  if (select.value !== "8") await actor.selectOptions(select, "8");
}

test("手机宽度：「机场送机结束」按航站楼选，「下一步：选择车型」在底部按钮条里；询价带航站楼坐标；明细写场景名；第 3 步备注框提示航班号、没有航班号字段", async () => {
  screenWidth("compact");
  const calls = open((call) => ((call.body as { dropoff?: { lat: number } }).dropoff?.lat === 35.545 ? "airport_end" : null));
  const actor = user();
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  await actor.click(screen.getByRole("button", { name: "上一步" }));
  await actor.click(await screen.findByRole("button", { name: "机场送机结束" }));
  assert.equal(screen.getByRole("button", { name: "机场送机结束" }).getAttribute("aria-pressed"), "true");
  const terminal = (await screen.findByLabelText("下车地点（选择航站楼）")) as HTMLSelectElement;
  await waitFor(() => assert.equal(terminal.disabled, false));
  assert.deepEqual([...terminal.options].map((option) => option.textContent), ["选择航站楼", "羽田机场 第 1 航站楼", "羽田机场 第 3 航站楼"]);
  assert.ok(calls.some((call) => call.path.includes("/site/v1/charter-airports?scenario=airport_end")));
  await actor.selectOptions(terminal, HANEDA.terminals[1]!.id);
  // 机场结束不出「从预约时间开始计时」的提示（只有机场接机开始有）
  assertAbsent(screen.queryByText(/包车从预约的上车时间开始计时/));
  await pickHours(actor);

  // M9E-32：手机上第 1 步的主按钮在底部按钮条里；不再有旧的 .book-actions / .book-bar
  const bar = screen.getByRole("group", { name: "本步操作" });
  const next = within(bar).getByRole("button", { name: "下一步：选择车型" });
  assert.equal(document.querySelector(".book-actions, .book-bar"), null);
  // 快捷入口在行程区里，不在按钮条里
  assertAbsent(within(bar).queryByRole("button", { name: "机场送机结束" }));
  await actor.click(next);
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  const body = quotes(calls).at(-1) as { dropoff: { lat: number; lng: number }; package_hours: number };
  assert.deepEqual([body.dropoff, body.package_hours], [{ lat: 35.545, lng: 139.768 }, 8]);
  await waitFor(() => assert.ok(screen.getAllByText(/8 小时包车 \+ 羽田机场送机/).length > 0), SLOW);

  await actor.click(screen.getByRole("button", { name: "选择 车型1" }));
  await actor.click(within(screen.getByRole("group", { name: "本步操作" })).getByRole("button", { name: "下一步：填写乘客信息" }));
  await screen.findByRole("heading", { name: "乘客信息", level: 2 });
  const notes = screen.getByLabelText("给司机的备注（选填）");
  assert.match(notes.getAttribute("aria-describedby") ?? "", /book-notes-hint/);
  assert.equal(document.getElementById("book-notes-hint")?.textContent, "如需司机知道航班号，请填在这里");
  // 包车不加航班号字段、不给免费等待（ADR 0098 第三节第 6 小节）
  assertAbsent(screen.queryByLabelText(/航班号/));
  assertAbsent(screen.queryByText(/免费等待/));
});

test("电脑宽度：「机场接机开始」有计时提示，「改填其他地点」回到普通地址输入", async () => {
  screenWidth("wide");
  open(() => null);
  const actor = user();
  await screen.findByRole("heading", { name: "车型1" }, SLOW);
  await actor.click(screen.getByRole("button", { name: "上一步" }));
  await actor.click(await screen.findByRole("button", { name: "机场接机开始" }));
  assert.ok(await screen.findByLabelText("上车地点（选择航站楼）"));
  assert.ok(screen.getByText("包车从预约的上车时间开始计时，没有免费等待，航班晚到也照常计时。建议把上车时间定在航班落地后 60–90 分钟（留出入境、取行李的时间）；担心航班延误请下单前联系客服"));
  await actor.click(screen.getByRole("button", { name: "改填其他地点" }));
  assertAbsent(screen.queryByLabelText("上车地点（选择航站楼）"));
  assert.equal(screen.getByRole("button", { name: "机场接机开始" }).getAttribute("aria-pressed"), "false");
});
