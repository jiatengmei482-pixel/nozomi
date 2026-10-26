/**
 * M3-05 测试角色补充：官网订单页的令牌去向与操作条件（ADR 0032）。接口用测试替身。
 * - 令牌只出现在 /site/v1/order… 的 Authorization 请求头里：不进地址的路径和查询串、不进请求体、不发给配置和找回接口、
 *   不进 local / sessionStorage、不进页面标题、不进页面上的任何链接（刚下单时的「可分享链接」除外）；
 * - 地址里 # 后面不是合法令牌时不发请求、直接显示找回；
 * - 「我已落地」只对接机单、付款后、计划到达前 3 小时起（边界）；取消后、已确认过不再显示按钮；
 * - 改单只给改了的字段（只在首尾加了空格不算改动）；异议期过了不显示「提异议」；署名在有城市机场名称的页面上。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { SiteConfig, SiteOrder, SiteOrderEnvelope } from "../../api/site.ts";
import { landingAvailability } from "../../lib/site-display.ts";
import { changeRequestOf } from "./OrderSections.tsx";
import { type ApiCall, apiError, assertAbsent, json, resetBrowser, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const TOKEN = `nzo_${"Q".repeat(20)}_${"a".repeat(22)}`;
const NEW_TOKEN = `nzo_${"N".repeat(43)}`;
const HOUR = 3_600_000;
const openConfig: SiteConfig = { open: true, currency: "JPY", payments: null, support_phone: null, address_search: false, map_tiles: null };
const tiers = [{ min_hours_before: 48, fee_bp: 0 }, { min_hours_before: 24, fee_bp: 5000 }, { min_hours_before: 0, fee_bp: 10000 }];
const landingOf = (scheduledAt: string, reported: string | null = null): NonNullable<SiteOrder["landing"]> => ({
  scheduled_at: scheduledAt,
  guest_reported_at: reported,
  driver_reported_at: null,
  landed_at: reported ?? scheduledAt,
  source: reported === null ? "scheduled" : "guest",
  disagreement: false,
  delay_minutes: 0,
  within_delay_allowance: true,
});

const orderOf = (changes: Partial<SiteOrder> = {}): SiteOrder => ({
  id: "44444444-4444-4444-8444-444444444444",
  order_no: "NZ20261026QAQA2345",
  status: "confirmed",
  category: "airport_transfer",
  city_id: "11111111-1111-4111-8111-111111111111",
  place_id: "22222222-2222-4222-8222-222222222222",
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
  dropoff: { lng: 139.7, lat: 35.6, address: "新宿站南口" },
  addons: [],
  driver_language: null,
  flight_no: "NH211",
  passenger: { name: "李四", phone: "+819087654321", email: "qa@example.com" },
  messaging: null,
  notes: null,
  free_wait_minutes: 90,
  created_at: "2026-10-26T01:00:00.000Z",
  confirmed_at: "2026-10-26T01:05:00.000Z",
  cancelled_at: null,
  cancel_reason: null,
  quote_id: "QT20261026ABCDEFGHIJ",
  channel_order_no: null,
  price: { total: { amount: "21780", currency: "JPY" }, fx: null },
  payment_status: "succeeded",
  payment_due_at: "2026-10-26T01:30:00.000Z",
  winning_tenant: null,
  driver: null,
  vehicle: null,
  landing: landingOf("2030-11-20T01:00:00.000Z"),
  cancel_policy: { version: 0, category: "airport_transfer", level: "business", tiers },
  cancellation: null,
  free_cancel_available: true,
  changes: [],
  extra_charges: [],
  version: 3,
  ...changes,
});
const envelopeOf = (order: SiteOrder = orderOf()): SiteOrderEnvelope => ({
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

const orderRoutes = (order: SiteOrder, extra: Route = () => null): Route => (call) => {
  if (call.url.pathname === "/site/v1/config") return json(200, openConfig);
  if (call.method === "GET" && call.url.pathname === "/site/v1/order") return json(200, envelopeOf(order));
  return extra(call);
};

/** 令牌出现在哪些不该出现的地方（请求的地址、请求体、非订单接口的请求头、存储、标题、页面链接）。 */
function tokenLeaks(calls: ApiCall[], token: string): string[] {
  const found: string[] = [];
  for (const call of calls) {
    if (call.path.includes(token) || call.path.includes(token.slice(4))) found.push(`地址 ${call.method} ${call.path}`);
    if (call.body !== undefined && JSON.stringify(call.body).includes(token.slice(4))) found.push(`请求体 ${call.method} ${call.path}`);
    const auth = Object.entries(call.headers).filter(([, value]) => String(value).includes(token.slice(4)));
    const orderCall = new URL(call.path, "http://localhost").pathname.startsWith("/site/v1/order") && !call.path.includes("/site/v1/orders");
    for (const [name] of auth) if (!orderCall || name.toLowerCase() !== "authorization") found.push(`请求头 ${name} ${call.method} ${call.path}`);
  }
  for (const store of [localStorage, sessionStorage]) {
    for (let i = 0; i < store.length; i += 1) {
      const key = store.key(i) ?? "";
      if (`${key}=${store.getItem(key) ?? ""}`.includes(token.slice(4))) found.push(`存储 ${key}`);
    }
  }
  if (document.title.includes(token.slice(4))) found.push("页面标题");
  for (const link of document.querySelectorAll("a[href], [src], form[action]")) {
    const target = link.getAttribute("href") ?? link.getAttribute("src") ?? link.getAttribute("action") ?? "";
    if (target.includes(token.slice(4))) found.push(`页面元素 ${link.tagName} ${target}`);
  }
  return found;
}

test("令牌去向：看订单、试算、取消的整个过程里，令牌只在订单接口的 Authorization 头里；配置接口不带它；不进存储、标题和页面链接；不是刚下单就不在页面上显示", async () => {
  let cancelled = false;
  const calls = open(
    { pathname: "/book/order", hash: `#${TOKEN}` },
    orderRoutes(orderOf(), (call) => {
      if (call.url.pathname === "/site/v1/order/cancel-fee") return json(200, { cancellable: true, stage: "paid", reason: "GUEST_REQUEST", tier_index: 0, hours_before_service: 100, fee_bp: 0, paid: { amount: "21780", currency: "JPY" }, fee: { amount: "0", currency: "JPY" }, refund: { amount: "21780", currency: "JPY" }, policy: orderOf().cancel_policy });
      if (call.method === "POST" && call.url.pathname === "/site/v1/order/cancel") {
        cancelled = true;
        return json(200, { ...envelopeOf(orderOf({ status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: "GUEST_REQUEST", cancellation: { reason: "GUEST_REQUEST", fee_bp: 0, fee: { amount: "0", currency: "JPY" }, refund: { amount: "21780", currency: "JPY" }, refund_status: "pending" } })), replayed: false });
      }
      return null;
    }),
  );
  const actor = user();
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261026QAQA2345" });
  // 标题在标题行渲染之后的 effect 里设置，负载高时要等一下
  await waitFor(() => assert.equal(document.title, "订单 NZ20261026QAQA2345 · NOZOMI 用车"));
  assert.ok(!document.body.textContent?.includes(TOKEN.slice(4)), "不是刚下单：页面上不显示链接");
  await actor.click(screen.getByRole("button", { name: "取消订单" }));
  await actor.click(await screen.findByRole("button", { name: "确认取消订单" }));
  assert.ok(await screen.findByText("订单已取消。"));
  assert.equal(cancelled, true);
  const orderCalls = calls.filter((call) => call.path.startsWith("/site/v1/order"));
  assert.ok(orderCalls.length >= 3, "看了、试算了、取消了");
  for (const call of orderCalls) assert.equal(call.headers["authorization"], `Bearer ${TOKEN}`, call.path);
  const config = calls.find((call) => call.path === "/site/v1/config");
  assert.ok(config);
  assert.equal(config.headers["authorization"], undefined, "配置接口不带令牌");
  assert.deepEqual(tokenLeaks(calls, TOKEN), []);
});

test("令牌去向：刚下单跳过来时只在「复制订单链接」那一处显示；找回换了新令牌后，旧令牌不再出现在任何请求里", async () => {
  const calls = open({ pathname: "/book/order", hash: `#${TOKEN}`, state: { placed: true, payment: null } }, orderRoutes(orderOf({ status: "pending_payment", payment_status: "creating", payment_due_at: new Date(Date.now() + 30 * 60_000).toISOString() })));
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261026QAQA2345" });
  const shown = [...document.querySelectorAll(".site-share__url")].map((node) => node.textContent ?? "");
  assert.equal(shown.length, 1);
  assert.ok(shown[0]?.endsWith(`/book/order#${TOKEN}`), shown[0]);
  assert.deepEqual(tokenLeaks(calls, TOKEN), []);

  resetBrowser();
  const lookupCalls = open({ pathname: "/book/order", hash: `#${TOKEN}` }, (call) => {
    if (call.url.pathname === "/site/v1/config") return json(200, openConfig);
    if (call.method === "POST" && call.url.pathname === "/site/v1/orders/lookup") return json(200, { link: { token: NEW_TOKEN, expires_at: "2030-12-20T01:00:00.000Z" } });
    if (call.url.pathname === "/site/v1/order") return call.headers["authorization"] === `Bearer ${NEW_TOKEN}` ? json(200, envelopeOf()) : apiError(401, "ORDER_LINK_INVALID", "链接无效");
    return null;
  });
  const actor = user();
  assert.ok(await screen.findByText("订单链接无效或已过期，请用订单号和下单时的邮箱或手机号重新查找。"));
  await actor.type(screen.getByLabelText("订单号"), " nz20261026qaqa2345 ");
  await actor.type(screen.getByLabelText("下单时的邮箱或手机号"), "  QA@example.com ");
  await actor.click(screen.getByRole("button", { name: "查找订单" }));
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261026QAQA2345" });
  const lookup = lookupCalls.find((call) => call.method === "POST");
  assert.equal(lookup?.headers["authorization"], undefined, "找回不带旧令牌");
  assert.deepEqual(lookup?.body, { order_no: "NZ20261026QAQA2345", contact: "QA@example.com" }, "和后端同口径：订单号转大写去空白，联系方式去首尾空白");
  const after = lookupCalls.slice(lookupCalls.indexOf(lookup as ApiCall) + 1);
  assert.ok(after.length > 0);
  for (const call of after) assert.ok(!JSON.stringify(call).includes(TOKEN.slice(4)), `${call.method} ${call.path} 还带着旧令牌`);
  assert.deepEqual(tokenLeaks(lookupCalls, NEW_TOKEN), []);
});

test("地址里 # 后面不是合法令牌（太短、多了字符、写成 token=…、只有前缀）：不发订单请求，直接显示找回", async () => {
  for (const hash of [`#nzo_${"A".repeat(42)}`, `#${TOKEN}x`, `#token=${TOKEN}`, "#nzo_", `#${TOKEN.replace("nzo_", "NZO_")}`]) {
    const calls = open({ pathname: "/book/order", hash }, (call) => (call.url.pathname === "/site/v1/config" ? json(200, openConfig) : null));
    await screen.findByRole("heading", { level: 1, name: "查订单" });
    assert.equal(calls.filter((call) => call.path.startsWith("/site/v1/order")).length, 0, hash);
    await waitFor(() => assert.equal(document.title, "查订单 · NOZOMI 用车"));
    resetBrowser();
  }
});

test("「我已落地」的条件：送机单没有、待付款说付款后、离计划到达 3 小时差 1 秒还早、整 3 小时可点、已取消和已完成不可点、点过显示确认时间", () => {
  const now = new Date("2030-11-19T22:00:00.000Z");
  const scheduled = "2030-11-20T01:00:00.000Z";
  assert.equal(landingAvailability({ status: "confirmed", landing: null }, now).kind, "not_applicable");
  assert.equal(landingAvailability({ status: "pending_payment", landing: landingOf(scheduled) }, now).kind, "unpaid");
  assert.equal(landingAvailability({ status: "confirmed", landing: landingOf(scheduled) }, new Date(now.getTime() - 1_000)).kind, "too_early");
  assert.equal(landingAvailability({ status: "confirmed", landing: landingOf(scheduled) }, now).kind, "open", "整 3 小时");
  assert.equal(landingAvailability({ status: "assigned", landing: landingOf(scheduled) }, now).kind, "open");
  assert.equal(landingAvailability({ status: "cancelled", landing: landingOf(scheduled) }, now).kind, "closed");
  assert.equal(landingAvailability({ status: "completed", landing: landingOf(scheduled) }, now).kind, "closed");
  assert.deepEqual(landingAvailability({ status: "confirmed", landing: landingOf(scheduled, "2030-11-20T00:50:00.000Z") }, now), { kind: "reported", at: "2030-11-20T00:50:00.000Z" });
});

test("「我已落地」在页面上：送机单不出这一块；接机单取消后不出按钮；已确认过只显示确认的当地时间", async () => {
  const soon = new Date(Date.now() + HOUR).toISOString();
  open({ pathname: "/book/order", hash: `#${TOKEN}` }, orderRoutes(orderOf({ direction: "dropoff", pickup: { lng: 139.7, lat: 35.6, address: "新宿站南口" }, dropoff: null, landing: null })));
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261026QAQA2345" });
  assertAbsent(screen.queryByRole("heading", { name: "航班落地" }));
  assertAbsent(screen.queryByRole("button", { name: "我已落地" }));
  resetBrowser();

  open({ pathname: "/book/order", hash: `#${TOKEN}` }, orderRoutes(orderOf({ status: "cancelled", cancelled_at: new Date().toISOString(), cancel_reason: "GUEST_REQUEST", landing: landingOf(soon) })));
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261026QAQA2345" });
  assertAbsent(screen.queryByRole("button", { name: "我已落地" }));
  resetBrowser();

  open({ pathname: "/book/order", hash: `#${TOKEN}` }, orderRoutes(orderOf({ status: "assigned", landing: landingOf(soon, "2030-11-20T00:50:00.000Z") })));
  assert.ok(await screen.findByText("您已确认落地：当地时间 2030年11月20日（周三）09:50。"));
  assertAbsent(screen.queryByRole("button", { name: "我已落地" }));
});

test("改单：姓名、电话、邮箱、航班号只在写法上不同（首尾空白、电话的空格连字符、航班号大小写和空格）不算改动，和后端同口径", () => {
  const base = { name: "李四", phone: "+819087654321", email: "qa@example.com", flightNo: "NH211", pickupAddress: "", dropoffAddress: "新宿站南口", notes: "", passengers: "2", luggage: "1", date: "2030-11-20", time: "10:00" };
  assert.deepEqual(changeRequestOf(orderOf(), { ...base, dropoffAddress: " 新宿站南口 ", notes: "  " }), {}, "地址、备注只多了空白");
  assert.deepEqual(changeRequestOf(orderOf(), { ...base, name: "李四 " }), {}, "姓名只多了一个空格：不应当提交一次乘车人修改");
  assert.deepEqual(changeRequestOf(orderOf(), { ...base, phone: " +81 90-8765-4321 ", email: " qa@example.com " }), {}, "电话只多了空格连字符、邮箱只多了空白");
  assert.deepEqual(changeRequestOf(orderOf(), { ...base, flightNo: "nh 211" }), {}, "航班号只是大小写和空格不同");
  assert.deepEqual(changeRequestOf(orderOf(), { ...base, name: " 王五 " }), { passenger: { name: "王五", phone: "+819087654321", email: "qa@example.com" } }, "真改了姓名照样提交");
});

test("改单：后端回 422 NO_CHANGE 时页面提示「没有改动」，不说「修改失败」", async () => {
  open(
    { pathname: "/book/order", hash: `#${TOKEN}` },
    orderRoutes(orderOf(), (call) => (call.method === "PATCH" && call.url.pathname === "/site/v1/order" ? apiError(422, "NO_CHANGE", "没有要改的内容") : null)),
  );
  const actor = user();
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261026QAQA2345" });
  await actor.click(screen.getByRole("button", { name: "修改订单" }));
  await actor.type(screen.getByLabelText("备注（选填）"), "带婴儿座椅");
  await actor.click(screen.getByRole("button", { name: "提交修改" }));
  assert.ok(await screen.findByText("没有改动。"));
  assert.equal(screen.queryByText(/修改订单失败|修改失败/), null);
});

test("找回：全角的手机号（输入法常见）先转成半角再提交，和后端同口径", async () => {
  const calls = open({ pathname: "/book/order" }, (call) => {
    if (call.url.pathname === "/site/v1/config") return json(200, openConfig);
    if (call.method === "POST" && call.url.pathname === "/site/v1/orders/lookup") return json(200, { link: { token: NEW_TOKEN, expires_at: "2030-12-20T01:00:00.000Z" } });
    if (call.url.pathname === "/site/v1/order") return json(200, envelopeOf());
    return null;
  });
  const actor = user();
  await screen.findByRole("heading", { level: 1, name: "查订单" });
  await actor.type(screen.getByLabelText("订单号"), "NZ20261026QAQA2345");
  await actor.type(screen.getByLabelText("下单时的邮箱或手机号"), "　＋８１　９０－８７６５－４３２１　");
  await actor.click(screen.getByRole("button", { name: "查找订单" }));
  await screen.findByRole("heading", { level: 1, name: "订单 NZ20261026QAQA2345" });
  assert.deepEqual(calls.find((call) => call.method === "POST")?.body, { order_no: "NZ20261026QAQA2345", contact: "+81 90-8765-4321" });
});

test("改单：只改备注时请求体只有 notes；清空备注给 null；改送机单的地址给 pickup_address", () => {
  const base = { name: "李四", phone: "+819087654321", email: "qa@example.com", flightNo: "NH211", pickupAddress: "", dropoffAddress: "新宿站南口", notes: "", passengers: "2", luggage: "1", date: "2030-11-20", time: "10:00" };
  assert.deepEqual(changeRequestOf(orderOf(), { ...base, notes: " 带婴儿座椅 " }), { notes: "带婴儿座椅" });
  assert.deepEqual(changeRequestOf(orderOf({ notes: "旧备注" }), { ...base, notes: "" }), { notes: null });
  const dropoff = orderOf({ direction: "dropoff", pickup: { lng: 139.7, lat: 35.6, address: "新宿站南口" }, dropoff: null, landing: null });
  assert.deepEqual(changeRequestOf(dropoff, { ...base, pickupAddress: "涩谷站" }), { pickup_address: "涩谷站" });
  assert.deepEqual(changeRequestOf(orderOf(), { ...base, passengers: "0" }), { error: "人数填 1 以上的整数" });
});

test("异议期过了：加收项不出「提异议」；订单页底部有 GeoNames、OurAirports 署名", async () => {
  const charge = { id: "55555555-5555-4555-8555-555555555555", type: "waiting" as const, amount: { amount: "1100", currency: "JPY" }, description: "等了 30 分钟", status: "in_window" as const, submitted_at: "2030-11-20T03:00:00.000Z", dispute_until: "2030-11-22T03:00:00.000Z", dispute_open: false, disputed_at: null, charged_at: null };
  open({ pathname: "/book/order", hash: `#${TOKEN}` }, orderRoutes(orderOf({ status: "completed", extra_charges: [charge] })));
  assert.ok(await screen.findByText("1,100 JPY"));
  assertAbsent(screen.queryByRole("button", { name: "提异议" }));
  const footer = document.querySelector(".site__footer")?.textContent ?? "";
  assert.match(footer, /GeoNames/);
  assert.match(footer, /OurAirports/);
});

test("找回被限速：提示尝试次数过多、要等多久，或联系客服（订单号被别人试满时要等几个小时）", async () => {
  open({ pathname: "/book/order" }, (call) => {
    if (call.url.pathname === "/site/v1/config") return json(200, openConfig);
    if (call.method === "POST" && call.url.pathname === "/site/v1/orders/lookup") return apiError(429, "RATE_LIMITED", "请求过于频繁，请稍后再试", { retry_after_seconds: 7_300 }, { "retry-after": "7300" });
    return null;
  });
  const actor = user();
  await screen.findByRole("heading", { level: 1, name: "查订单" });
  await actor.type(screen.getByLabelText("订单号"), "NZ20261026QAQA2345");
  await actor.type(screen.getByLabelText("下单时的邮箱或手机号"), "qa@example.com");
  await actor.click(screen.getByRole("button", { name: "查找订单" }));
  assert.ok(await screen.findByText("尝试次数过多，请 3 小时后再试，或联系客服。"));
});
