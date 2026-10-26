/**
 * 官网按页面规范调整（M3-11，pages/site-booking.md 第 11.2 节）的组件测试：
 * F1 订单页区块按「客人当下要做的事」排序 · F2 客服区块登记了号码才显示 · F3 官网自己的崩溃兜底 · F4 查询后焦点到结果 ·
 * F5 「复制链接」带文字 · F6 报价按总价排序 · F7 取消政策客人说法、扣全额写不退款 · F8 日期「10月26日（周一）」 ·
 * F9 乘车人拆三项 · F10 顶栏 DOM 顺序 · F11 当前页入口 · F12 异议理由和改单的字段级错误。接口用测试替身。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { SiteConfig, SiteOrder, SiteOrderEnvelope, SiteQuote } from "../../api/site.ts";
import { type ApiCall, apiError, assertAbsent, assertFocused, json, resetBrowser, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const CITY_ID = "11111111-1111-4111-8111-111111111111";
const AIRPORT_ID = "22222222-2222-4222-8222-222222222222";
const ORDER_ID = "44444444-4444-4444-8444-444444444444";
const CHARGE_ID = "55555555-5555-4555-8555-555555555555";
const TOKEN = `nzo_${"P".repeat(43)}`;
const HOUR = 3_600_000;
const PHONE = "+81 3-1234-5678";

const configOf = (changes: Partial<SiteConfig> = {}): SiteConfig => ({ open: true, currency: "JPY", payments: null, support_phone: null, ...changes });
const city = { id: CITY_ID, code: "CTY-JP-TYO", name: { zh: "东京" }, timezone: "Asia/Tokyo", country_code: "JP" };
const airport = { id: AIRPORT_ID, code: "NRT", name: { zh: "成田机场" }, location: { lng: 140.3887, lat: 35.7686 } };
const tiers = [{ min_hours_before: 48, fee_bp: 0 }, { min_hours_before: 24, fee_bp: 5000 }, { min_hours_before: 0, fee_bp: 10000 }];
const quoteOf = (id: string, name: string, amount: string): SiteQuote => ({
  quote_id: id,
  expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
  service_date: "2030-11-20",
  urgent: false,
  vehicle_group: { id: `33333333-3333-4333-8333-33333333333${id.slice(-1)}`, code: `VG-${id}`, name: { zh: name }, grade: "business", seats: 7, sample_models: [], combos: [] },
  price: { total: { amount, currency: "JPY" }, fx: null },
  free_wait_minutes: 90,
  cancel_policy: { category: "airport_transfer", level: "business", tiers },
});

const orderOf = (changes: Partial<SiteOrder> = {}): SiteOrder => ({
  id: ORDER_ID,
  order_no: "NZ20261026POLI2345",
  status: "confirmed",
  category: "airport_transfer",
  city_id: CITY_ID,
  place_id: AIRPORT_ID,
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
  passenger: { name: "王小明", phone: "+819012345678", email: "a-very-long-mailbox-name-for-wrapping@example-long-domain.co.jp" },
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
  landing: { scheduled_at: "2030-11-20T01:00:00.000Z", guest_reported_at: null, driver_reported_at: null, landed_at: "2030-11-20T01:00:00.000Z", source: "scheduled", disagreement: false, delay_minutes: 0, within_delay_allowance: true },
  cancel_policy: { version: 0, category: "airport_transfer", level: "business", tiers },
  cancellation: null,
  free_cancel_available: false,
  changes: [],
  extra_charges: [],
  version: 3,
  ...changes,
});
const envelopeOf = (order: SiteOrder): SiteOrderEnvelope => ({
  order,
  timeline: [{ from_status: null, to_status: "pending_payment", reason: null, occurred_at: order.created_at }],
  names: { city: { code: "CTY-JP-TYO", name: { zh: "东京" } }, place: { code: "NRT", name: { zh: "成田机场" }, type: "airport" }, vehicle_group: { code: "VG-BIZ-7", name: { zh: "商务 7 座" }, seats: 7 } },
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

const orderRoutes = (order: SiteOrder, config: SiteConfig = configOf(), extra: Route = () => null): Route => (call) => {
  if (call.url.pathname === "/site/v1/config") return json(200, config);
  if (call.method === "GET" && call.url.pathname === "/site/v1/order") return json(200, envelopeOf(order));
  return extra(call);
};

const openOrder = (order: SiteOrder, config?: SiteConfig, extra?: Route, state?: unknown): ApiCall[] => open({ pathname: "/book/order", hash: `#${TOKEN}`, ...(state === undefined ? {} : { state }) }, orderRoutes(order, config, extra));

/** 订单页上区块标题（h2）的先后。 */
const sectionTitles = (): string[] => screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent ?? "");

const bookingRoutes = (quotes: SiteQuote[], unavailable: unknown[] = []): Route => (call) => {
  if (call.url.pathname === "/site/v1/config") return json(200, configOf());
  if (call.url.pathname === "/site/v1/cities") return json(200, { items: [city] });
  if (call.url.pathname === `/site/v1/cities/${CITY_ID}/airports`) return json(200, { items: [airport] });
  if (call.method === "POST" && call.url.pathname === "/site/v1/quotes") return json(200, { quotes, unavailable });
  return null;
};

async function fillInquiry(actor: ReturnType<typeof user>): Promise<void> {
  await screen.findByRole("heading", { level: 1, name: "预订接送机" });
  await waitFor(() => assert.equal((screen.getByLabelText(/^机场/) as HTMLSelectElement).value, AIRPORT_ID));
  await actor.type(screen.getByLabelText("下车地址或酒店名"), "东京站八重洲口");
  await actor.type(screen.getByLabelText(/^纬度/), "35.6812");
  await actor.type(screen.getByLabelText(/^经度/), "139.7671");
  const date = screen.getByLabelText("航班到达日期（当地）") as HTMLInputElement;
  await actor.clear(date);
  await actor.type(date, "2030-11-20");
  await actor.type(screen.getByLabelText("航班计划到达时间（当地）"), "10:00");
}

// ───────────── F1 区块顺序 ─────────────

test("F1：待付款时付款排第一；「我已落地」能点时航班落地排第一，点完留在原位；有异议期内的费用时它排第一；其他时候行程排第一", async () => {
  openOrder(orderOf({ status: "pending_payment", payment_status: "creating", confirmed_at: null, payment_due_at: new Date(Date.now() + HOUR).toISOString() }));
  await screen.findByRole("heading", { level: 1, name: /订单 NZ/ });
  await waitFor(() => assert.equal(sectionTitles()[0], "付款"));
  assert.deepEqual(sectionTitles().slice(1, 3), ["行程", "订单进度"]);
  resetBrowser();

  const soon = new Date(Date.now() + HOUR).toISOString();
  const open1 = orderOf({ landing: { ...orderOf().landing!, scheduled_at: soon, landed_at: soon } });
  const reported = new Date().toISOString();
  openOrder(open1, configOf(), (call) => (call.method === "POST" && call.url.pathname === "/site/v1/order/landed" ? json(200, envelopeOf({ ...open1, landing: { ...open1.landing!, guest_reported_at: reported, source: "guest" } })) : null));
  await screen.findByRole("heading", { level: 1, name: /订单 NZ/ });
  assert.deepEqual(sectionTitles().slice(0, 3), ["航班落地", "行程", "订单进度"]);
  const actor = user();
  await actor.click(screen.getByRole("button", { name: "我已落地" }));
  await actor.click(within(screen.getByRole("group", { name: "确认已落地" })).getByRole("button", { name: "确认已落地" }));
  assert.ok(await screen.findByText("已确认落地，司机会按这个时间开始免费等待。"));
  assert.equal(sectionTitles()[0], "航班落地", "刚点完：区块不跳走，结果提示还在眼前");
  resetBrowser();

  const charge = { id: CHARGE_ID, type: "waiting" as const, amount: { amount: "2200", currency: "JPY" }, description: null, status: "in_window" as const, submitted_at: new Date().toISOString(), dispute_until: new Date(Date.now() + 40 * HOUR).toISOString(), dispute_open: true, disputed_at: null, charged_at: null };
  openOrder(orderOf({ status: "completed", extra_charges: [charge] }));
  await screen.findByRole("heading", { level: 1, name: /订单 NZ/ });
  assert.deepEqual(sectionTitles().slice(0, 3), ["服务后的费用", "行程", "订单进度"]);
  resetBrowser();

  openOrder(orderOf({ status: "completed", extra_charges: [{ ...charge, status: "charged", dispute_open: false }] }));
  await screen.findByRole("heading", { level: 1, name: /订单 NZ/ });
  assert.deepEqual(sectionTitles().slice(0, 3), ["行程", "订单进度", "航班落地"]);
});

// ───────────── F2 客服 ─────────────

test("F2：客服电话没登记时不显示「需要帮助」，也没有 tel: 链接；登记后是最后一个区块，电话可点、写明订单号", async () => {
  openOrder(orderOf());
  await screen.findByRole("heading", { level: 1, name: /订单 NZ/ });
  await waitFor(() => assert.ok(sectionTitles().includes("取消订单")));
  assertAbsent(screen.queryByRole("heading", { name: "需要帮助" }));
  assert.equal(document.querySelector('a[href^="tel:"]'), null);
  resetBrowser();

  openOrder(orderOf(), configOf({ support_phone: PHONE }));
  assert.ok(await screen.findByRole("heading", { level: 2, name: "需要帮助" }));
  assert.equal(sectionTitles().at(-1), "需要帮助");
  const call = screen.getByRole("link", { name: `打电话给客服 ${PHONE}` });
  assert.equal(call.getAttribute("href"), "tel:+81312345678");
  assert.ok(screen.getByText("联系时请提供订单号 NZ20261026POLI2345。"));
});

// ───────────── F3 崩溃兜底 ─────────────

test("F3：官网页面崩溃时用官网自己的兜底：不提管理员，说订单不受影响、可以在「查订单」找到，有「刷新页面」；顶栏还在", async () => {
  const quiet = console.error;
  console.error = () => undefined;
  try {
    const broken = { ...orderOf(), passenger: undefined } as unknown as SiteOrder;
    openOrder(broken);
    assert.ok(await screen.findByRole("heading", { level: 1, name: "页面出了点问题" }));
    assert.ok(screen.getByText("请刷新重试。您的订单不受影响，可以随时在「查订单」里找到。"));
    assert.ok(screen.getByRole("button", { name: "刷新页面" }));
    assert.ok(screen.getByRole("link", { name: "查订单" }));
    assert.doesNotMatch(document.body.textContent ?? "", /管理员/);
  } finally {
    console.error = quiet;
  }
});

// ───────────── F4、F6、F7 询价结果 ─────────────

test("F4、F6、F7：查询后焦点移到结果标题；报价按总价从低到高；取消政策是客人的说法", async () => {
  open("/book", bookingRoutes([quoteOf("QT3", "豪华 7 座", "45000"), quoteOf("QT1", "商务 7 座", "21780"), quoteOf("QT2", "经济 5 座", "9800")]));
  const actor = user();
  await fillInquiry(actor);
  await actor.click(screen.getByRole("button", { name: "查询价格" }));
  const heading = await screen.findByRole("heading", { level: 2, name: "可预订的车（3 种）" });
  assertFocused(heading);
  assert.equal(heading.getAttribute("tabindex"), "-1");
  assert.deepEqual(screen.getAllByRole("heading", { level: 3 }).map((name) => name.textContent), ["经济 5 座", "商务 7 座", "豪华 7 座"]);
  assert.deepEqual(
    screen.getAllByText("用车前 48 小时以上取消免费；24–48 小时内取消收 50%；24 小时内取消收全额").length,
    3,
  );
  assert.doesNotMatch(document.body.textContent ?? "", /≥|扣 100%/);
});

test("F4：报不出价时焦点同样移到结果标题", async () => {
  open("/book", bookingRoutes([], [{ vehicle_group_id: "x", reasons: ["OUT_OF_SERVICE_AREA"] }]));
  const actor = user();
  await fillInquiry(actor);
  await actor.click(screen.getByRole("button", { name: "查询价格" }));
  assertFocused(await screen.findByRole("heading", { level: 2, name: "没有可预订的车" }));
});

// ───────────── F5、F8、F9 订单页 ─────────────

test("F5：刚下单的提示里是带文字的「复制链接」按钮，点了把订单链接写进剪贴板", async () => {
  // user-event 建立时会装上它自己的剪贴板替身，所以先建它，再换成记录写入内容的替身
  const actor = user();
  const written: string[] = [];
  const original = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: (text: string) => (written.push(text), Promise.resolve()) } });
  try {
    openOrder(orderOf(), configOf(), () => null, { placed: true, payment: null });
    const button = await screen.findByRole("button", { name: "复制链接" });
    assert.match(button.textContent ?? "", /复制链接/, "按钮上有字，不只是图标");
    await actor.click(button);
    assert.deepEqual(written, [`${window.location.origin}/book/order#${TOKEN}`]);
    assert.ok(await screen.findByText("已复制"));
  } finally {
    if (original) Object.defineProperty(navigator, "clipboard", original);
    else delete (navigator as unknown as Record<string, unknown>)["clipboard"];
  }
});

test("F8、F9：订单页的时间写成「…月…日（周…）HH:mm」并标当地时间；乘车人的姓名、手机号、邮箱分三项", async () => {
  openOrder(orderOf());
  await screen.findByRole("heading", { level: 1, name: /订单 NZ/ });
  assert.ok(screen.getByText("2030年11月20日（周三）10:00（东京当地时间）"));
  assert.ok(screen.getByText("计划到达：当地时间 2030年11月20日（周三）10:00"));
  assert.doesNotMatch(document.body.textContent ?? "", /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/, "不再出现 YYYY-MM-DD HH:mm");
  const trip = screen.getByRole("region", { name: "行程" });
  const facts = Object.fromEntries([...trip.querySelectorAll(".site-facts__item")].map((item) => [item.querySelector("dt")?.textContent, item.querySelector("dd")?.textContent]));
  assert.equal(facts["乘车人"], "王小明");
  assert.equal(facts["乘车人手机号"], "+819012345678");
  assert.equal(facts["乘车人邮箱"], "a-very-long-mailbox-name-for-wrapping@example-long-domain.co.jp");
});

test("F7：订单页的取消政策是客人的说法；扣全额时确认框写「现在取消不退款（取消费 …）」，不写「退还 0 JPY」", async () => {
  openOrder(orderOf(), configOf(), (call) =>
    call.url.pathname === "/site/v1/order/cancel-fee"
      ? json(200, { cancellable: true, stage: "paid", reason: "GUEST_REQUEST", tier_index: 2, hours_before_service: 3, fee_bp: 10000, paid: { amount: "21780", currency: "JPY" }, fee: { amount: "21780", currency: "JPY" }, refund: { amount: "0", currency: "JPY" }, policy: orderOf().cancel_policy })
      : null,
  );
  assert.ok(await screen.findByText("取消政策：用车前 48 小时以上取消免费；24–48 小时内取消收 50%；24 小时内取消收全额（按订单总价计算）。"));
  await user().click(screen.getByRole("button", { name: "取消订单" }));
  const confirm = await screen.findByRole("group", { name: "确认取消订单" });
  assert.ok(within(confirm).getByText("按取消政策，现在取消不退款（取消费 21,780 JPY）。"));
  assert.doesNotMatch(confirm.textContent ?? "", /退还 0/);
});

// ───────────── F10、F11 顶栏 ─────────────

test("F10、F11：顶栏 DOM 顺序是品牌、主题切换、入口；当前页的入口标 aria-current", async () => {
  open("/book", bookingRoutes([]));
  await screen.findByRole("heading", { level: 1, name: "预订接送机" });
  const header = document.querySelector(".site__header") as HTMLElement;
  assert.deepEqual([...header.children].map((child) => child.className), ["site__brand", "site__theme", "site__nav"]);
  const focusable = [...header.querySelectorAll<HTMLElement>("a, button")].map((element) => element.getAttribute("aria-label") ?? element.textContent);
  assert.deepEqual(focusable, ["NOZOMI 用车", "切换主题", "预订接送机", "查订单"], "Tab 顺序：品牌 → 主题 → 入口");
  const nav = screen.getByRole("navigation", { name: "官网" });
  assert.equal(within(nav).getByRole("link", { name: "预订接送机" }).getAttribute("aria-current"), "page");
  assert.equal(within(nav).getByRole("link", { name: "查订单" }).getAttribute("aria-current"), null);
  resetBrowser();

  open("/book/order", (call) => (call.url.pathname === "/site/v1/config" ? json(200, configOf()) : null));
  await screen.findByRole("heading", { level: 1, name: "查订单" });
  const nav2 = screen.getByRole("navigation", { name: "官网" });
  assert.equal(within(nav2).getByRole("link", { name: "查订单" }).getAttribute("aria-current"), "page");
  assert.equal(within(nav2).getByRole("link", { name: "预订接送机" }).getAttribute("aria-current"), null);
  resetBrowser();

  open("/book/checkout", () => null);
  await screen.findByRole("heading", { level: 1, name: "填写订单" });
  assert.equal(within(screen.getByRole("navigation", { name: "官网" })).getByRole("link", { name: "预订接送机" }).getAttribute("aria-current"), "true", "下单是预订流程的一步");
});

// ───────────── F12 字段级错误 ─────────────

test("F12：异议理由没写时，错误带图标并经 aria-describedby 关联到文本框；写了以后错误立即消失", async () => {
  const charge = { id: CHARGE_ID, type: "waiting" as const, amount: { amount: "2200", currency: "JPY" }, description: null, status: "in_window" as const, submitted_at: new Date().toISOString(), dispute_until: new Date(Date.now() + 40 * HOUR).toISOString(), dispute_open: true, disputed_at: null, charged_at: null };
  openOrder(orderOf({ status: "completed", extra_charges: [charge] }));
  const actor = user();
  await actor.click(await screen.findByRole("button", { name: "提异议" }));
  await actor.click(screen.getByRole("button", { name: "提交异议" }));
  const box = screen.getByLabelText("异议的理由");
  const error = await screen.findByText("请写一下为什么有异议，如「司机没有等那么久」");
  const holder = error.closest(".field__error") as HTMLElement;
  assert.ok(holder.querySelector("svg"), "错误前有图标");
  assert.equal(box.getAttribute("aria-invalid"), "true");
  assert.ok((box.getAttribute("aria-describedby") ?? "").split(" ").includes(holder.id));
  await actor.type(box, "等");
  assertAbsent(screen.queryByText("请写一下为什么有异议，如「司机没有等那么久」"));
  assert.equal(box.getAttribute("aria-invalid"), null);
});

test("F12：修改订单的字段级校验——顶部一条提示、出错字段标红并写正确写法、不发请求；改对后实时消失；后端校验不通过时标在字段下", async () => {
  const calls = openOrder(orderOf(), configOf(), (call) => {
    if (call.method === "PATCH" && call.url.pathname === "/site/v1/order") {
      return apiError(400, "VALIDATION_FAILED", "校验失败", { issues: [{ path: "/passenger/email", message: "邮箱的域名不存在" }] });
    }
    return null;
  });
  const actor = user();
  await actor.click(await screen.findByRole("button", { name: "修改订单" }));
  const name = screen.getByLabelText("乘车人姓名");
  const phone = screen.getByLabelText("手机号（带国家码）");
  const flight = screen.getByLabelText("航班号");
  await actor.clear(name);
  await actor.clear(phone);
  await actor.type(phone, "090-1234-5678");
  await actor.clear(flight);
  await actor.click(screen.getByRole("button", { name: "提交修改" }));
  assert.ok(await screen.findByText("有几项没有填好，请看标红的地方。"));
  assert.ok(screen.getByText("请填写乘车人姓名"));
  assert.ok(screen.getByText("请填写带国家码的手机号，如 +81 90-1234-5678、+86 138 0000 0000"));
  assert.ok(screen.getByText("接机要填航班号，司机按航班落地时间等候"));
  for (const field of [name, phone, flight]) assert.equal(field.getAttribute("aria-invalid"), "true");
  assert.equal(calls.filter((call) => call.method === "PATCH").length, 0, "前端没过不发请求");

  await actor.type(name, "李四");
  assertAbsent(screen.queryByText("请填写乘车人姓名"));
  assert.equal(name.getAttribute("aria-invalid"), null, "改对了立刻消失");
  await actor.clear(phone);
  await actor.type(phone, "+81 90-1234-5678");
  await actor.type(flight, "NH211");
  await actor.click(screen.getByRole("button", { name: "提交修改" }));
  assert.ok(await screen.findByText("邮箱的域名不存在"));
  assert.equal(screen.getByLabelText("邮箱").getAttribute("aria-invalid"), "true");
  assert.ok(screen.getByText("有几项没有通过检查，请看标红的地方。"));
  assert.equal(calls.filter((call) => call.method === "PATCH").length, 1);
});
