/**
 * 报不出价时「请客服人工报价」和「通过 WhatsApp 联系我们」（M8-21，ADR 0076；规范 site-booking-v2.md 第 11 节）的组件测试：
 * 只有邮箱、WhatsApp 两个框（至少一项、各自的格式）、提交按钮旁的同意说明（没有勾选框）、陷阱字段、提交后的中性提示、
 * 接口点名的字段落在框下面、限速时的说法；WhatsApp 按钮有号码才显示、链接带预先写好的行程要点、新标签页打开。
 * 新预订页（接送报不出价、包车地址不在任何城市）和旧预订页里的位置和带上的行程在后半部分。
 * 报不出价时新预订页只有人工报价那一块、没有下单用的「怎么联系你」，有报价时照旧（M8-21b）。
 * 接口用测试替身；真实后端由 e2e/manual-quote.spec.ts 覆盖。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { SiteByPointsResult, SiteCity, SiteConfig, SiteQuoteResult } from "../../api/site.ts";
import { type ManualQuoteTripDraft, missingTripParts } from "../../lib/manual-quote-form.ts";
import { type ApiCall, apiError, assertAbsent, assertFocused, json, resetBrowser, stubApiWith } from "../../testing/harness.tsx";
import { ManualQuoteBlock } from "./ManualQuote.tsx";

const originalMatchMedia = window.matchMedia;
afterEach(() => {
  resetBrowser();
  window.matchMedia = originalMatchMedia;
});

function wideScreen(): void {
  window.matchMedia = ((query: string) => ({ matches: query.includes("min-width: 1024px"), media: query, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
}

const SLOW = { timeout: 3000 };
const CITY_ID = "11111111-1111-4111-8111-111111111111";
/** 测试用的客服号码（不是任何真实号码） */
const SUPPORT = "810000000000";
const trip: ManualQuoteTripDraft = {
  category: "point_to_point",
  cityId: CITY_ID,
  pickup: { name: "新宿站", lat: 35.6896, lng: 139.7006 },
  dropoff: { name: "成田机场", lat: 35.772, lng: 140.3929 },
  serviceLocal: "2030-11-20T09:30",
  passengers: 2,
  luggage: 1,
  packageHours: null,
};
const user = () => userEvent.setup();
const manualPosts = (calls: ApiCall[]): ApiCall[] => calls.filter((call) => call.method === "POST" && call.path === "/site/v1/manual-quote-requests");

function openBlock(options: { supportWhatsapp?: string | null; trip?: ManualQuoteTripDraft; respond?: () => Response } = {}): ApiCall[] {
  const calls = stubApiWith((call) => (call.method === "POST" && call.url.pathname === "/site/v1/manual-quote-requests" ? (options.respond?.() ?? json(202, { status: "accepted" })) : null));
  render(<ManualQuoteBlock trip={options.trip ?? trip} supportWhatsapp={options.supportWhatsapp ?? null} />);
  return calls;
}

test("只有邮箱、WhatsApp 两个框（没有姓名、备注、勾选框）；提交按钮旁写「提交即同意…」；陷阱字段人看不到、键盘到不了", () => {
  openBlock();
  const form = screen.getByRole("region", { name: "请客服人工报价" });
  assert.deepEqual(within(form).getAllByRole("textbox").map((box) => box.getAttribute("type")), ["email", "tel"]);
  assert.ok(within(form).getByLabelText("邮箱"));
  assert.ok(within(form).getByLabelText("WhatsApp"));
  assertAbsent(within(form).queryByRole("checkbox"));
  assertAbsent(within(form).queryByLabelText(/姓名|备注/));
  const submit = within(form).getByRole("button", { name: "提交" });
  assert.equal(submit.parentElement?.textContent, "提交提交即同意客服通过您留下的方式联系您");
  const trap = document.querySelector<HTMLInputElement>('input[name="website"]');
  assert.ok(trap);
  assert.equal(trap.tabIndex, -1);
  assert.equal(trap.closest("[aria-hidden]")?.getAttribute("aria-hidden"), "true");
});

test("两项都不填：「请至少填一项」落在邮箱下面、焦点到邮箱，不提交；填了一项提示收起", async () => {
  const calls = openBlock();
  const actor = user();
  await actor.click(screen.getByRole("button", { name: "提交" }));
  assert.ok(screen.getByText("请至少填一项：邮箱或 WhatsApp"));
  assertFocused(screen.getByLabelText("邮箱"));
  assert.equal(screen.getByLabelText("邮箱").getAttribute("aria-invalid"), "true");
  assert.equal(manualPosts(calls).length, 0);
  await actor.type(screen.getByLabelText("WhatsApp"), "+81");
  assertAbsent(screen.queryByText("请至少填一项：邮箱或 WhatsApp"));
});

test("格式：邮箱不完整、WhatsApp 不以 + 开头或位数不对都在各自的框下面说明，不提交", async () => {
  const calls = openBlock();
  const actor = user();
  await actor.type(screen.getByLabelText("邮箱"), "name@example");
  await actor.type(screen.getByLabelText("WhatsApp"), "090 1234 5678");
  await actor.click(screen.getByRole("button", { name: "提交" }));
  assert.ok(screen.getByText("邮箱的格式不对，请写完整，如 name@example.com"));
  assert.ok(screen.getByText(/WhatsApp 号码请以 \+ 和国家码开头/));
  assertFocused(screen.getByLabelText("邮箱"));
  assert.equal(manualPosts(calls).length, 0);
  await actor.clear(screen.getByLabelText("邮箱"));
  await actor.clear(screen.getByLabelText("WhatsApp"));
  await actor.type(screen.getByLabelText("WhatsApp"), "+81 12");
  await actor.click(screen.getByRole("button", { name: "提交" }));
  assert.ok(screen.getByText(/WhatsApp 号码请以 \+ 和国家码开头/));
  assertFocused(screen.getByLabelText("WhatsApp"));
  assert.equal(manualPosts(calls).length, 0);
});

test("只填 WhatsApp 就能提交：请求体只有两项联系方式、同意、页面带上的行程、空的陷阱字段；之后表单换成中性的「已收到」", async () => {
  const calls = openBlock();
  const actor = user();
  await actor.type(screen.getByLabelText("WhatsApp"), "+81 90-0000-0000");
  await actor.click(screen.getByRole("button", { name: "提交" }));
  assert.ok(await screen.findByText("已收到。客服会通过您留下的邮箱或 WhatsApp 联系您报价，请留意消息。"));
  assert.equal(screen.getByRole("status").textContent, "已收到。客服会通过您留下的邮箱或 WhatsApp 联系您报价，请留意消息。");
  assert.deepEqual(manualPosts(calls).map((call) => call.body), [
    {
      email: null,
      whatsapp: "+81 90-0000-0000",
      consent: true,
      trip: { category: "point_to_point", city_id: CITY_ID, pickup: { name: "新宿站", lat: 35.6896, lng: 139.7006 }, dropoff: { name: "成田机场", lat: 35.772, lng: 140.3929 }, service_local: "2030-11-20T09:30", passengers: 2, luggage: 1, package_hours: null },
      website: "",
    },
  ]);
  assertAbsent(screen.queryByLabelText("邮箱"));
});

test("接口点名 WhatsApp 格式不对时落在 WhatsApp 框下面；限速时说要等多久，并提到 WhatsApp 按钮", async () => {
  let reply = (): Response => apiError(400, "VALIDATION_FAILED", "x", { issues: [{ path: "/whatsapp", reason: "FORMAT", message: "x" }] });
  openBlock({ supportWhatsapp: SUPPORT, respond: () => reply() });
  const actor = user();
  await actor.type(screen.getByLabelText("邮箱"), "guest@example.com");
  await actor.type(screen.getByLabelText("WhatsApp"), "+81 90 0000 0000");
  await actor.click(screen.getByRole("button", { name: "提交" }));
  assert.ok(await screen.findByText(/WhatsApp 号码请以 \+ 和国家码开头/));
  await waitFor(() => assertFocused(screen.getByLabelText("WhatsApp")));
  reply = () => apiError(429, "RATE_LIMITED", "x", {}, { "retry-after": "120" });
  await actor.click(screen.getByRole("button", { name: "提交" }));
  assert.equal((await screen.findByRole("alert", {}, SLOW)).textContent, "操作太频繁了，请 2 分钟后再试。也可以点下面的「通过 WhatsApp 联系我们」。");
  assert.ok(screen.getByLabelText("邮箱"), "表单还在，填的内容还在");
  assert.equal((screen.getByLabelText("邮箱") as HTMLInputElement).value, "guest@example.com");
});

test("行程不齐（包车没选时长、没选时间）时不提交，请客人先在上面补上", async () => {
  const calls = openBlock({ trip: { ...trip, category: "charter", dropoff: null, packageHours: null, serviceLocal: null } });
  const actor = user();
  await actor.type(screen.getByLabelText("邮箱"), "guest@example.com");
  await actor.click(screen.getByRole("button", { name: "提交" }));
  assert.equal(screen.getByRole("alert").textContent, "请先在上面选好包车时长、日期和时间，再提交。");
  assert.equal(manualPosts(calls).length, 0);
  assert.deepEqual(missingTripParts({ ...trip, pickup: null, dropoff: null }), ["出发地", "目的地"]);
});

test("包车带经停点（M9W-04）：按行程计价没选时长也能提交，请求带按顺序的经停点和停留、package_hours 为 null；别的类型不带经停点", async () => {
  const stops = [
    { name: "五合目", lat: 35.395, lng: 138.733, stayMinutes: 60 },
    { name: "河口湖", lat: 35.498, lng: 138.769, stayMinutes: 30 },
  ];
  const charterTrip: ManualQuoteTripDraft = { ...trip, category: "charter", packageHours: null, waypoints: stops };
  assert.deepEqual(missingTripParts(charterTrip), []);
  assert.deepEqual(missingTripParts({ ...charterTrip, waypoints: [] }), ["包车时长"]);
  const calls = openBlock({ trip: charterTrip });
  const actor = user();
  await actor.type(screen.getByLabelText("邮箱"), "guest@example.com");
  await actor.click(screen.getByRole("button", { name: "提交" }));
  assert.ok(await screen.findByText(/已收到/));
  const body = manualPosts(calls)[0]?.body as { trip: Record<string, unknown> };
  assert.equal(body.trip["package_hours"], null);
  assert.deepEqual(body.trip["waypoints"], [
    { name: "五合目", lat: 35.395, lng: 138.733, stay_minutes: 60 },
    { name: "河口湖", lat: 35.498, lng: 138.769, stay_minutes: 30 },
  ]);
  resetBrowser();

  // 不是包车：就算草稿里有经停点也不带（请求和以前一样）
  const plainCalls = openBlock({ trip: { ...trip, waypoints: stops } });
  await actor.type(screen.getByLabelText("邮箱"), "guest@example.com");
  await actor.click(screen.getByRole("button", { name: "提交" }));
  assert.ok(await screen.findByText(/已收到/));
  assert.equal("waypoints" in ((manualPosts(plainCalls)[0]?.body as { trip: Record<string, unknown> }).trip), false);
});

test("WhatsApp 按钮：没设置客服号码时不显示；设置了显示，wa.me 链接带预先写好的行程要点（没有客人的个人信息），新标签页打开", () => {
  openBlock();
  assertAbsent(screen.queryByRole("link", { name: /WhatsApp/ }));
  resetBrowser();
  openBlock({ supportWhatsapp: SUPPORT });
  const link = screen.getByRole("link", { name: /^通过 WhatsApp 联系我们\s*（在新标签页打开）$/ });
  const href = new URL(link.getAttribute("href") ?? "");
  assert.equal(`${href.origin}${href.pathname}`, `https://wa.me/${SUPPORT}`);
  assert.equal(href.searchParams.get("text"), "您好，我想咨询用车报价：点对点，新宿站 → 成田机场，2030-11-20 09:30，2 人。");
  assert.equal(link.getAttribute("target"), "_blank");
  assert.match(link.getAttribute("rel") ?? "", /\bnoopener\b/);
});

// ───────────── 页面里的位置 ─────────────

const city: SiteCity = { id: CITY_ID, code: "CTY-JP-TYO", name: { zh: "东京" }, timezone: "Asia/Tokyo", country_code: "JP", center: { lat: 35.6895, lng: 139.6917 }, categories: ["airport_transfer", "point_to_point", "charter"] };
const configOf = (changes: Partial<SiteConfig> = {}): SiteConfig => ({ open: true, currency: "JPY", payments: null, support_phone: "+81 3-0000-0000", support_whatsapp: null, address_search: true, page_width: "standard", map_tiles: null, ...changes });
const noQuotes: SiteByPointsResult = { trip_type: "point_to_point", airport: null, fallback_category: null, city: { id: CITY_ID, code: "CTY-JP-TYO", name: { zh: "东京" }, timezone: "Asia/Tokyo" }, currency: "JPY", quotes: [], unavailable: [{ vehicle_group_id: null, reasons: ["NO_PRODUCT"] }], expires_at: null, route: null };

function openPage(at: string, options: { config?: SiteConfig; byPoints?: () => Response; charter?: () => Response } = {}): ApiCall[] {
  const calls = stubApiWith((call) => {
    const path = call.url.pathname;
    if (path === "/site/v1/config") return json(200, options.config ?? configOf());
    if (path === "/site/v1/cities") return json(200, { items: [city] });
    if (path === `/site/v1/cities/${CITY_ID}/charter-packages`) return json(200, { items: [{ hours: 8 }] });
    // 包车按上下车点匹配（M9P-02）：冲绳（那霸一带）哪个包车商品都匹配不到，其余按东京
    if (path === "/site/v1/charter-packages") return (call.url.searchParams.get("pickup") ?? "").startsWith("26.") ? json(200, { city: null, items: [] }) : json(200, { city: { id: CITY_ID, code: "CTY-JP-TYO", name: { zh: "东京" }, timezone: "Asia/Tokyo" }, items: [{ hours: 8 }] });
    if (call.method === "POST" && path === "/site/v1/quotes/by-points") return options.byPoints?.() ?? json(200, noQuotes);
    if (call.method === "POST" && path === "/site/v1/quotes") return options.charter?.() ?? null;
    if (call.method === "POST" && path === "/site/v1/manual-quote-requests") return json(202, { status: "accepted" });
    return null;
  });
  render(
    <MemoryRouter initialEntries={[at]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

const P2P_LINK = "/book/new?from=35.6896,139.7006&from_name=%E6%96%B0%E5%AE%BF%E7%AB%99&to=35.6586,139.7454&to_name=%E4%B8%9C%E4%BA%AC%E5%A1%94&date=2030-11-20&time=14:30";

/** 报不出价时只有人工报价那一块：下单用的乘客信息（姓名、手机号、同意保存银行卡）、「去付款」和往第 3 步的「下一步」都不出现（M8-21b，规范 11.1） */
function assertNoCheckout(): void {
  assertAbsent(screen.queryByRole("heading", { name: "怎么联系你" }));
  assertAbsent(screen.queryByLabelText("乘车人姓名"));
  assertAbsent(screen.queryByLabelText("手机号（含国家区号）"));
  assertAbsent(screen.queryByRole("checkbox", { name: /同意保存这次付款用的银行卡/ }));
  assertAbsent(screen.queryByRole("button", { name: "去付款 →" }));
  assertAbsent(screen.queryByRole("button", { name: "下一步：填写乘客信息" }));
  assert.equal(screen.getAllByLabelText("邮箱").length, 1, "页面上只有人工报价的一个邮箱框");
}

test("新预订页接送报不出价：保留「这个地址暂时没有在线报价，请联系客服」和客服电话，下面是人工报价表单和 WhatsApp 按钮；提交带上页面的行程（用车类型按识别结果、城市）", async () => {
  wideScreen();
  const calls = openPage(P2P_LINK, { config: configOf({ support_whatsapp: SUPPORT }) });
  const actor = user();
  const region = await screen.findByRole("region", { name: "请客服人工报价" }, SLOW);
  assert.ok(screen.getByText("这个地址暂时没有在线报价，请联系客服"));
  assert.ok(screen.getByRole("link", { name: "+81 3-0000-0000" }));
  assertNoCheckout();
  const link = within(region).getByRole("link", { name: /通过 WhatsApp 联系我们/ });
  assert.equal(new URL(link.getAttribute("href") ?? "").searchParams.get("text"), "您好，我想咨询用车报价：点对点，新宿站 → 东京塔，2030-11-20 14:30，2 人。");
  await actor.type(within(region).getByLabelText("邮箱"), "guest@example.com");
  await actor.click(within(region).getByRole("button", { name: "提交" }));
  assert.ok(await screen.findByText(/已收到。/));
  assert.deepEqual(manualPosts(calls)[0]?.body, {
    email: "guest@example.com",
    whatsapp: null,
    consent: true,
    trip: { category: "point_to_point", city_id: CITY_ID, pickup: { name: "新宿站", lat: 35.6896, lng: 139.7006 }, dropoff: { name: "东京塔", lat: 35.6586, lng: 139.7454 }, service_local: "2030-11-20T14:30", passengers: 2, luggage: 2, package_hours: null },
    website: "",
  });
});

test("新预订页渠道不卖这一段（CHANNEL_SCOPE_DENIED）：同样有人工报价表单；没设置客服 WhatsApp 时不显示按钮", async () => {
  wideScreen();
  openPage(P2P_LINK, { byPoints: () => apiError(403, "CHANNEL_SCOPE_DENIED", "x") });
  assert.ok(await screen.findByRole("region", { name: "请客服人工报价" }, SLOW));
  assert.ok(screen.getByText("这个地址暂时没有在线报价，请联系客服"));
  assertAbsent(screen.queryByRole("link", { name: /WhatsApp/ }));
  assertNoCheckout();
});

test("新预订页包车、上车地点不在任何能订包车的城市：说明 + 客服电话；给通用的包车时长，选了以后提交带 package_hours、没有城市", async () => {
  wideScreen();
  const calls = openPage("/book/new?mode=charter&from=26.2124,127.6809&from_name=%E9%82%A3%E9%9C%B8&to=26.3,127.8&to_name=%E5%8C%97%E8%B0%B7&date=2030-11-20&time=09:00");
  const actor = user();
  const region = await screen.findByRole("region", { name: "请客服人工报价" }, SLOW);
  assert.ok(screen.getByText("这个地址暂时没有在线报价，请联系客服"));
  assertNoCheckout();
  await actor.type(within(region).getByLabelText("WhatsApp"), "+86 130 0000 0000");
  await actor.click(within(region).getByRole("button", { name: "提交" }));
  assert.equal(within(region).getByRole("alert").textContent, "请先在上面选好包车时长，再提交。");
  await actor.selectOptions(screen.getByLabelText("包车时长"), "6");
  const again = await screen.findByRole("region", { name: "请客服人工报价" });
  await actor.type(within(again).getByLabelText("WhatsApp"), "+86 130 0000 0000");
  await actor.click(within(again).getByRole("button", { name: "提交" }));
  assert.ok(await screen.findByText(/已收到。/));
  const body = manualPosts(calls)[0]?.body as { trip: Record<string, unknown> };
  assert.equal(body.trip["category"], "charter");
  assert.equal(body.trip["city_id"], null);
  assert.equal(body.trip["package_hours"], 6);
  assert.deepEqual(body.trip["dropoff"], { name: "北谷", lat: 26.3, lng: 127.8 });
  assert.equal(calls.filter((call) => call.path === "/site/v1/quotes").length, 0, "不在城市里不询价");
});

test("新预订页没有车（报价列表为空、也没有原因）同样给人工报价；还没填行程时不显示", async () => {
  wideScreen();
  openPage(P2P_LINK, { byPoints: () => json(200, { ...noQuotes, quotes: [] satisfies SiteQuoteResult["quotes"], unavailable: [] }) });
  assert.ok(await screen.findByRole("region", { name: "请客服人工报价" }, SLOW), "没有车也算报不出价");
  assertNoCheckout();
  resetBrowser();
  wideScreen();
  openPage("/book/new");
  await screen.findByRole("combobox", { name: "出发地" }, SLOW);
  assertAbsent(screen.queryByRole("region", { name: "请客服人工报价" }));
});

test("有报价时照旧：能往第 3 步「乘客信息」走，没有人工报价；从报不出价改了行程、报出价以后可以继续、人工报价收起（M8-27 四步）", async () => {
  wideScreen();
  const quote = {
    quote_id: "QT20301120000000000001",
    expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
    service_date: "2030-11-20",
    urgent: false,
    includes_area_surcharge: false,
    vehicle_group: { id: "33333333-3333-4333-8333-333333333301", code: "VG-T1", name: { zh: "车型1" }, grade: "economy", seats: 7, sample_models: [], combos: [{ passengers: 6, luggage: 4 }] },
    package: null,
    price: { total: { amount: "18000", currency: "JPY" }, fx: null },
    free_wait_minutes: 0,
    cancel_policy: { category: "point_to_point", level: "economy", tiers: [{ min_hours_before: 0, fee_bp: 10000 }] },
    available_addons: [],
  } satisfies SiteQuoteResult["quotes"][number];
  let asked = 0;
  openPage(P2P_LINK, {
    byPoints: () => {
      asked += 1;
      return json(200, asked === 1 ? noQuotes : { ...noQuotes, quotes: [quote], unavailable: [] });
    },
  });
  const actor = user();
  assert.ok(await screen.findByRole("region", { name: "请客服人工报价" }, SLOW));
  assertNoCheckout();

  await actor.click(screen.getByRole("button", { name: "上一步" }));
  const time = screen.getByLabelText("用车时间（当地）");
  await actor.clear(time);
  await actor.type(time, "15:30");
  await actor.click(screen.getByRole("button", { name: "下一步：选择车型" }));
  assert.ok(await screen.findByRole("heading", { name: "车型1" }, SLOW));
  assertAbsent(screen.queryByRole("region", { name: "请客服人工报价" }));
  assertAbsent(screen.queryByRole("link", { name: /通过 WhatsApp 联系我们/ }));
  await actor.click(screen.getByRole("button", { name: "选择 车型1" }));
  await actor.click(screen.getByRole("button", { name: "下一步：填写乘客信息" }));
  assert.ok(await screen.findByRole("heading", { name: "乘客信息", level: 2 }));
  assert.ok(screen.getByLabelText("乘车人姓名"));
  assert.ok(screen.getByLabelText("手机号（含国家区号）"));
});
