/**
 * 测试角色补充（M3-11，pages/site-booking.md 第 11.2 节）的组件测试：
 * F2 客服区块在官网没开 / 配置读不出来时 · F3 崩溃兜底后能点顶栏「查订单」离开 · F8 订单页时间跨午夜、跨年、按订单城市时区 ·
 * F12 改单只校验改过的字段（含时区、夏令时、过去时间、人数行李的边界）、后端校验错误映射到字段（含没能映射的、业务拒绝的）。接口用测试替身。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { SiteConfig, SiteOrder, SiteOrderEnvelope } from "../../api/site.ts";
import { type ApiCall, apiError, assertAbsent, json, resetBrowser, stubApiWith } from "../../testing/harness.tsx";
import { validateChange } from "./OrderSections.tsx";

afterEach(resetBrowser);

const CITY_ID = "11111111-1111-4111-8111-111111111111";
const AIRPORT_ID = "22222222-2222-4222-8222-222222222222";
const ORDER_ID = "44444444-4444-4444-8444-444444444444";
const TOKEN = `nzo_${"Q".repeat(43)}`;
const PHONE = "+81 3-1234-5678";
const tiers = [{ min_hours_before: 48, fee_bp: 0 }, { min_hours_before: 24, fee_bp: 5000 }, { min_hours_before: 0, fee_bp: 10000 }];

const configOf = (changes: Partial<SiteConfig> = {}): SiteConfig => ({ open: true, currency: "JPY", payments: null, support_phone: null, address_search: false, map_tiles: null, ...changes });

const orderOf = (changes: Partial<SiteOrder> = {}): SiteOrder => ({
  id: ORDER_ID,
  order_no: "NZ20261026QAQA2345",
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
  passenger: { name: "王小明", phone: "+819012345678", email: "guest@example.com" },
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
  landing: null,
  cancel_policy: { version: 0, category: "airport_transfer", level: "business", tiers },
  cancellation: null,
  free_cancel_available: true,
  changes: [],
  extra_charges: [],
  version: 3,
  ...changes,
});
const envelopeOf = (order: SiteOrder, timeline: SiteOrderEnvelope["timeline"] = [{ from_status: null, to_status: "pending_payment", reason: null, occurred_at: order.created_at }]): SiteOrderEnvelope => ({
  order,
  timeline,
  names: { city: { code: "CTY-JP-TYO", name: { zh: "东京" } }, place: { code: "NRT", name: { zh: "成田机场" }, type: "airport" }, vehicle_group: { code: "VG-BIZ-7", name: { zh: "商务 7 座" }, seats: 7 } },
});

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;
const user = () => userEvent.setup();

function openOrder(envelope: SiteOrderEnvelope, config: Response | (() => Response), extra: Route = () => null): ApiCall[] {
  const calls = stubApiWith((call) => {
    if (call.url.pathname === "/site/v1/config") return typeof config === "function" ? config() : config.clone();
    if (call.method === "GET" && call.url.pathname === "/site/v1/order") return json(200, envelope);
    return extra(call);
  });
  render(
    <MemoryRouter initialEntries={[{ pathname: "/book/order", hash: `#${TOKEN}` }]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

const sectionTitles = (): string[] => screen.getAllByRole("heading", { level: 2 }).map((heading) => heading.textContent ?? "");
const patchBodies = (calls: ApiCall[]): unknown[] => calls.filter((call) => call.method === "PATCH").map((call) => call.body);

// ───────────── F2 客服 ─────────────

test("F2：官网没开（暂停接新单）时，已有订单的订单页照常显示「需要帮助」和客服电话", async () => {
  openOrder(envelopeOf(orderOf()), () => json(200, configOf({ open: false, currency: null, support_phone: PHONE })));
  assert.ok(await screen.findByRole("heading", { level: 2, name: "需要帮助" }));
  assert.equal(sectionTitles().at(-1), "需要帮助");
  assert.equal(screen.getByRole("link", { name: `打电话给客服 ${PHONE}` }).getAttribute("href"), "tel:+81312345678");
  assert.doesNotMatch(document.body.textContent ?? "", /暂未开放预订/, "订单页不说官网没开");
});

test("F2：配置读不出来（500）时订单页照常显示，只是没有「需要帮助」，不出现拨不通的链接", async () => {
  openOrder(envelopeOf(orderOf()), () => apiError(500, "INTERNAL", "boom"));
  await screen.findByRole("heading", { level: 1, name: /订单 NZ/ });
  await waitFor(() => assert.ok(sectionTitles().includes("取消订单")));
  assertAbsent(screen.queryByRole("heading", { name: "需要帮助" }));
  assert.equal(document.querySelector('a[href^="tel:"]'), null);
});

test("F2：配置里客服电话是空白字符串时也不显示区块", async () => {
  openOrder(envelopeOf(orderOf()), () => json(200, configOf({ support_phone: "   " })));
  await screen.findByRole("heading", { level: 1, name: /订单 NZ/ });
  await waitFor(() => assert.ok(sectionTitles().includes("取消订单")));
  assertAbsent(screen.queryByRole("heading", { name: "需要帮助" }));
});

// ───────────── F3 崩溃兜底 ─────────────

test("F3：订单页崩溃后，点顶栏「查订单」能离开兜底页，看到查订单表单（兜底文案就是叫客人去「查订单」）", async () => {
  const quiet = console.error;
  console.error = () => undefined;
  try {
    const broken = { ...orderOf(), passenger: undefined } as unknown as SiteOrder;
    openOrder(envelopeOf(broken), () => json(200, configOf()));
    assert.ok(await screen.findByRole("heading", { level: 1, name: "页面出了点问题" }));
    await user().click(within(screen.getByRole("navigation", { name: "官网" })).getByRole("link", { name: "查订单" }));
    assert.ok(await screen.findByRole("heading", { level: 1, name: "查订单" }), "点「查订单」后应该看到查订单表单，而不是停在兜底页");
  } finally {
    console.error = quiet;
  }
});

test("F3：订单页崩溃后，点顶栏「预订用车」能回到询价页", async () => {
  const quiet = console.error;
  console.error = () => undefined;
  try {
    const broken = { ...orderOf(), passenger: undefined } as unknown as SiteOrder;
    openOrder(envelopeOf(broken), () => json(200, configOf()));
    assert.ok(await screen.findByRole("heading", { level: 1, name: "页面出了点问题" }));
    await user().click(within(screen.getByRole("navigation", { name: "官网" })).getByRole("link", { name: "预订用车" }));
    assert.ok(await screen.findByRole("heading", { level: 1, name: "预订用车" }));
  } finally {
    console.error = quiet;
  }
});

// ───────────── F8 时间 ─────────────

test("F8：订单页的时间按订单城市换算——东京午夜后的上车时间、时间线里跨午夜的事件、去年的事件带年份", async () => {
  const thisYear = new Date().getUTCFullYear();
  const order = orderOf({
    direction: "dropoff",
    flight_no: null,
    pickup: { lng: 139.7, lat: 35.6, address: "新宿站南口" },
    dropoff: null,
    service_time: `${thisYear + 1}-01-01T15:30:00.000Z`,
    service_local: `${thisYear + 1}-01-02T00:30`,
    service_date: `${thisYear + 1}-01-02`,
  });
  // 时间线：UTC 前一年 12-31 15:10 是东京 1 月 1 日 00:10（新年后），UTC 前一年 12-31 14:50 是东京 12 月 31 日 23:50（旧年，带年份）
  const timeline: SiteOrderEnvelope["timeline"] = [
    { from_status: null, to_status: "pending_payment", reason: null, occurred_at: `${thisYear - 1}-12-31T14:50:00.000Z` },
    { from_status: "pending_payment", to_status: "confirmed", reason: null, occurred_at: `${thisYear - 1}-12-31T15:10:00.000Z` },
  ];
  openOrder(envelopeOf(order, timeline), () => json(200, configOf()));
  await screen.findByRole("heading", { level: 1, name: /订单 NZ/ });
  const trip = screen.getByRole("region", { name: "行程" });
  const weekday = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][new Date(Date.UTC(thisYear + 1, 0, 2)).getUTCDay()];
  assert.match(trip.textContent ?? "", new RegExp(`${thisYear + 1}年1月2日（${weekday}）00:30（东京当地时间）`), "明年的上车时间带年份，日期按东京（UTC 是 1 月 1 日）");
  const progress = screen.getByRole("region", { name: "订单进度" }).textContent ?? "";
  assert.match(progress, new RegExp(`${thisYear - 1}年12月31日（周.）23:50`));
  assert.match(progress, new RegExp(`(?<!年)1月1日（周.）00:10`), "东京已经是今年元旦：不带年份");
  assert.doesNotMatch(document.body.textContent ?? "", /\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}/);
});

// ───────────── F12 改单校验（纯函数） ─────────────

type Form = Parameters<typeof validateChange>[1];
const formOf = (order: SiteOrder, changes: Partial<Form> = {}): Form => ({
  name: order.passenger.name,
  phone: order.passenger.phone,
  email: order.passenger.email,
  flightNo: order.flight_no ?? "",
  pickupAddress: order.pickup?.address ?? "",
  dropoffAddress: order.dropoff?.address ?? "",
  notes: order.notes ?? "",
  passengers: String(order.passengers),
  luggage: String(order.luggage),
  date: order.service_local.slice(0, 10),
  time: order.service_local.slice(11, 16),
  ...changes,
});

test("F12 只校验改过的字段：旧数据不合规（电话没国家码、邮箱不对、接机没航班号、时间已过）时，只改行李不报任何错", () => {
  const legacy = orderOf({ passenger: { name: "王小明", phone: "090-1234-5678", email: "not-an-email" }, flight_no: null, service_local: "2020-01-01T10:00", service_time: "2020-01-01T01:00:00.000Z" });
  assert.deepEqual(validateChange(legacy, formOf(legacy, { luggage: "3" }), new Date("2026-10-26T03:00:00.000Z")), {});
  assert.deepEqual(validateChange(legacy, formOf(legacy), new Date("2026-10-26T03:00:00.000Z")), {}, "什么都没改");
  // 改了电话才查电话
  assert.deepEqual(Object.keys(validateChange(legacy, formOf(legacy, { phone: "090-1234-0000" }), new Date())), ["phone"]);
});

test("F12 电话：按后端同一口径（8–15 位数字、+ 后不以 0 开头、可带空格连字符括号点）", () => {
  const order = orderOf();
  const now = new Date("2026-10-26T03:00:00.000Z");
  const phoneError = (phone: string): string | undefined => validateChange(order, formOf(order, { phone }), now).phone;
  for (const ok of ["+81 90-1234-5678", "+12345678", "+123456789012345", " +86 (138) 0000.0000 ", "+81-90-1234-5678"]) assert.equal(phoneError(ok), undefined, ok);
  for (const wrong of ["+1234567", "+1234567890123456", "+0 90-1234-5678", "090-1234-5678", "81 90 1234 5678", "", "   ", "+81 90-1234-567a"]) assert.ok(phoneError(wrong), wrong);
});

test("F12 人数、行李、姓名、地址、航班号的边界", () => {
  const order = orderOf();
  const now = new Date("2026-10-26T03:00:00.000Z");
  const errorsOf = (changes: Partial<Form>) => validateChange(order, formOf(order, changes), now);
  for (const bad of ["0", "-1", "1.5", "", " ", "一"]) assert.ok(errorsOf({ passengers: bad }).passengers, `人数 ${JSON.stringify(bad)}`);
  assert.equal(errorsOf({ passengers: "1" }).passengers, undefined);
  for (const bad of ["-1", "0.5", ""]) assert.ok(errorsOf({ luggage: bad }).luggage, `行李 ${JSON.stringify(bad)}`);
  assert.equal(errorsOf({ luggage: "0" }).luggage, undefined, "行李可以是 0");
  assert.ok(errorsOf({ name: "   " }).name, "只有空白的姓名");
  assert.ok(errorsOf({ dropoffAddress: "  " }).dropoffAddress, "只有空白的地址（接机单改的是下车地址）");
  assert.ok(errorsOf({ flightNo: "  " }).flightNo, "接机把航班号改成空白");
  assert.equal(errorsOf({ flightNo: "nh 211" }).flightNo, undefined, "小写、带空格的航班号按规范化后算对");
  assert.ok(errorsOf({ flightNo: "N" }).flightNo);
  const dropoff = orderOf({ direction: "dropoff", flight_no: "NH211", pickup: { lng: 139.7, lat: 35.6, address: "新宿站" }, dropoff: null });
  assert.equal(validateChange(dropoff, formOf(dropoff, { flightNo: "" }), now).flightNo, undefined, "送机可以把航班号清空");
});

test("F12 改时间：「已经过了」按订单城市的当地时间判断，跨午夜也对；当前这一分钟算已过；只改日期也会查", () => {
  // UTC 2030-11-19 15:30 = 东京 11-20 00:30 = 檀香山 11-19 05:30
  const now = new Date("2030-11-19T15:30:00.000Z");
  const tokyo = orderOf({ service_local: "2030-11-21T10:00", service_time: "2030-11-21T01:00:00.000Z" });
  assert.ok(validateChange(tokyo, formOf(tokyo, { date: "2030-11-20", time: "00:15" }), now).time, "东京已过午夜：00:15 已经过了");
  assert.ok(validateChange(tokyo, formOf(tokyo, { date: "2030-11-20", time: "00:30" }), now).time, "正好是当前这一分钟");
  assert.equal(validateChange(tokyo, formOf(tokyo, { date: "2030-11-20", time: "00:31" }), now).time, undefined);
  assert.ok(validateChange(tokyo, formOf(tokyo, { date: "2030-11-19", time: "23:59" }), now).time, "东京的昨天");
  assert.ok(validateChange(tokyo, formOf(tokyo, { date: "2030-11-19" }), now).time, "只改日期（时间沿用 10:00）：东京 11-19 10:00 已经过了");

  const honolulu = orderOf({ timezone: "Pacific/Honolulu", service_local: "2030-11-21T10:00", service_time: "2030-11-21T20:00:00.000Z" });
  assert.equal(validateChange(honolulu, formOf(honolulu, { date: "2030-11-19", time: "06:00" }), now).time, undefined, "檀香山还是 11-19 早上 5:30，06:00 还没到");
  assert.ok(validateChange(honolulu, formOf(honolulu, { date: "2030-11-19", time: "05:00" }), now).time);
});

test("F12 改时间：夏令时切换当天按当地日历判断（不误报「已经过了」）；清空日期或时间，写明是哪一项", () => {
  const now = new Date("2030-01-01T00:00:00.000Z");
  const ny = orderOf({ timezone: "America/New_York", service_local: "2030-03-12T10:00", service_time: "2030-03-12T14:00:00.000Z" });
  // 02:30 在纽约 2030-03-10 不存在：domain 的 localDateTimeToInstant 按约定顺延到拨快之后（与后端同一口径），前端不拦
  assert.equal(validateChange(ny, formOf(ny, { date: "2030-03-10", time: "02:30" }), now).time, undefined);
  assert.equal(validateChange(ny, formOf(ny, { date: "2030-03-10", time: "03:30" }), now).time, undefined);
  // 秋季回拨（01:30 出现两次）也照常
  assert.equal(validateChange(ny, formOf(ny, { date: "2030-11-03", time: "01:30" }), now).time, undefined);
  assert.ok(validateChange(ny, formOf(ny, { date: "" }), now).date);
  assert.ok(validateChange(ny, formOf(ny, { time: "" }), now).time);
});

// ───────────── F12 改单（页面） ─────────────

const openChangeForm = async (order: SiteOrder, patch: Route) => {
  const calls = openOrder(envelopeOf(order), () => json(200, configOf()), (call) => (call.method === "PATCH" && call.url.pathname === "/site/v1/order" ? patch(call) : null));
  const actor = user();
  await actor.click(await screen.findByRole("button", { name: "修改订单" }));
  return { calls, actor };
};

test("F12：旧数据不合规时只改行李——不报错、只提交行李这一项", async () => {
  const legacy = orderOf({ passenger: { name: "王小明", phone: "090-1234-5678", email: "not-an-email" } });
  const { calls, actor } = await openChangeForm(legacy, () => json(200, { ...envelopeOf({ ...legacy, luggage: 3 }), change: null }));
  const luggage = screen.getByLabelText("行李（件）");
  await actor.clear(luggage);
  await actor.type(luggage, "3");
  await actor.click(screen.getByRole("button", { name: "提交修改" }));
  await waitFor(() => assert.equal(patchBodies(calls).length, 1));
  assert.deepEqual(patchBodies(calls)[0], { luggage: 3 });
  assertAbsent(screen.queryByText("有几项没有填好，请看标红的地方。"));
});

test("F12：只改姓名、旧电话不合规——前端放行，后端说电话不对时标在电话下面", async () => {
  const legacy = orderOf({ passenger: { name: "王小明", phone: "090-1234-5678", email: "guest@example.com" } });
  const { calls, actor } = await openChangeForm(legacy, () => apiError(400, "VALIDATION_FAILED", "请求参数校验未通过", { location: "body", issues: [{ path: "/passenger/phone", reason: "INVALID_PHONE", message: "电话要写成带国家码的国际格式，如 +81 90-1234-5678" }] }));
  const name = screen.getByLabelText("乘车人姓名");
  await actor.clear(name);
  await actor.type(name, "李四");
  await actor.click(screen.getByRole("button", { name: "提交修改" }));
  assert.ok(await screen.findByText("电话要写成带国家码的国际格式，如 +81 90-1234-5678"));
  assert.equal(screen.getByLabelText("手机号（带国家码）").getAttribute("aria-invalid"), "true");
  assert.deepEqual(patchBodies(calls)[0], { passenger: { name: "李四", phone: "090-1234-5678", email: "guest@example.com" } });
});

test("F12：后端对地址、用车时间、人数、行李的校验错误各自标在对应字段下", async () => {
  const issues = [
    { path: "/dropoff_address", reason: "TOO_LONG", message: "太长了" },
    { path: "/service_time", reason: "INVALID_FORMAT", message: "用车时间不对" },
    { path: "/passengers", reason: "INVALID_FORMAT", message: "人数不对" },
    { path: "/luggage", reason: "INVALID_FORMAT", message: "行李不对" },
  ];
  const { actor } = await openChangeForm(orderOf(), () => apiError(400, "VALIDATION_FAILED", "请求参数校验未通过", { location: "body", issues }));
  const address = screen.getByLabelText("下车地址或酒店名");
  await actor.type(address, "（南口）");
  await actor.click(screen.getByRole("button", { name: "提交修改" }));
  assert.ok(await screen.findByText("有几项没有通过检查，请看标红的地方。"));
  for (const [label, message] of [["下车地址或酒店名", "太长了"], ["航班计划到达时间（当地）", "用车时间不对"], ["人数", "人数不对"], ["行李（件）", "行李不对"]] as const) {
    const field = screen.getByLabelText(label);
    assert.equal(field.getAttribute("aria-invalid"), "true", label);
    const described = (field.getAttribute("aria-describedby") ?? "").split(" ").map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
    assert.match(described, new RegExp(message), `${label} 的错误经 aria-describedby 关联`);
  }
});

test("F12：后端说备注太长（/notes）时要告诉客人是备注的问题，不能只给一句笼统的「不符合要求」，也不能在「请看标红的地方」时漏标备注", async () => {
  const { actor } = await openChangeForm(orderOf(), () =>
    apiError(400, "VALIDATION_FAILED", "请求参数校验未通过", { location: "body", issues: [{ path: "/notes", reason: "TOO_LONG", message: "太长了" }, { path: "/passenger/email", reason: "INVALID_FORMAT", message: "格式不对" }] }),
  );
  await actor.type(screen.getByLabelText("备注（选填）"), "很".repeat(10));
  const email = screen.getByLabelText("邮箱");
  await actor.clear(email);
  await actor.type(email, "new@example.com");
  await actor.click(screen.getByRole("button", { name: "提交修改" }));
  // 后端的「格式不对」按 reason 换成了写清正确写法的说法（协调要求，2.3），这里等邮箱标红而不是等原话
  await waitFor(() => assert.equal(email.getAttribute("aria-invalid"), "true"));
  assert.ok(screen.getByText("请填写正确的邮箱，如 name@example.com"));
  const notes = screen.getByLabelText("备注（选填）");
  assert.equal(notes.getAttribute("aria-invalid"), "true", "备注也要标红");
  const section = screen.getByRole("region", { name: "修改订单" });
  assert.match(section.textContent ?? "", /备注/u, "提示里要说出是备注");
});

test("F12：改单页的备注输入上限和后端一致（后端最多 500 字）", async () => {
  await openChangeForm(orderOf(), () => null);
  assert.equal(screen.getByLabelText("备注（选填）").getAttribute("maxlength"), "500");
});

test("F12：用车时间在提交途中刚好过去（后端 422 SERVICE_TIME_PASSED）时，标在时间字段下并说「已经过了」", async () => {
  const { actor } = await openChangeForm(orderOf(), () => apiError(422, "VALIDATION_FAILED", "新的用车时间已经过了", { reason: "SERVICE_TIME_PASSED", fields: ["service_time"], status: "confirmed" }));
  const time = screen.getByLabelText("航班计划到达时间（当地）");
  await actor.clear(time);
  await actor.type(time, "11:00");
  await actor.click(screen.getByRole("button", { name: "提交修改" }));
  await waitFor(() => assert.equal(time.getAttribute("aria-invalid"), "true", "时间字段标红"));
  assert.match(screen.getByRole("region", { name: "修改订单" }).textContent ?? "", /已经过了/);
});

test("F12：后端标在邮箱下的错误，在客人改别的字段时不应被清掉（邮箱还没改对）", async () => {
  const { actor } = await openChangeForm(orderOf(), () => apiError(400, "VALIDATION_FAILED", "请求参数校验未通过", { location: "body", issues: [{ path: "/passenger/email", message: "邮箱的域名不存在" }] }));
  const email = screen.getByLabelText("邮箱");
  await actor.clear(email);
  await actor.type(email, "guest@no-such-domain.example");
  await actor.click(screen.getByRole("button", { name: "提交修改" }));
  assert.ok(await screen.findByText("邮箱的域名不存在"));
  await actor.type(screen.getByLabelText("乘车人姓名"), "A");
  assert.ok(screen.queryByText("邮箱的域名不存在"), "改姓名后邮箱的错误还在");
  assert.equal(email.getAttribute("aria-invalid"), "true");
});
