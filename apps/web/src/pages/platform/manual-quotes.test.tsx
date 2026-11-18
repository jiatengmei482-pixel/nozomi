/**
 * 运营后台「人工报价」和「系统设置 → 官网设置」（M8-21，ADR 0076）的组件测试：
 * 列表没有个人信息、各状态的数量、按状态 / 跟进人 / 联系方式筛（不完整的联系方式不去查）；详情的联系方式、发信和 WhatsApp 链接、审计提示、
 * 改状态和指派带版本号、被别人改过时刷新、写备注；已清除的不能再改；官网设置只有超级管理员能改（格式校验、第一次不带 If-Match），运营只读，没有权限的看不到。
 * 带行程单的申请（M9T-08）：列表标「多日行程」；详情的「整张行程」（每天的点、报价结果、报不出的原因）、行程单已清理、没带行程单三种。
 * 接口用测试替身；真实后端由 e2e/manual-quote.spec.ts 覆盖。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import type { ManualQuoteDetail, ManualQuoteSummary, SiteSettings } from "../../api/manual-quotes.ts";
import { COLLEAGUE, ME, openApp } from "../../testing/order-center-fixtures.tsx";
import { type ApiCall, apiError, assertAbsent, json, resetBrowser } from "../../testing/harness.tsx";

afterEach(resetBrowser);
const user = () => userEvent.setup();
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const CITY_ID = "44444444-4444-4444-8444-444444444444";
const COUNTS = { new: 2, following: 1, quoted: 0, converted: 0, closed: 3 };

const summaryOf = (changes: Partial<ManualQuoteSummary> = {}): ManualQuoteSummary => ({
  id: REQUEST_ID,
  request_no: "MQ20301120AB12CD34",
  status: "new",
  category: "point_to_point",
  city: { id: CITY_ID, code: "CTY-JP-TYO", name: { zh: "东京" } },
  service_local: "2030-11-20T09:30",
  passengers: 2,
  luggage: 1,
  package_hours: null,
  has_email: true,
  has_whatsapp: true,
  is_acceptance: false,
  has_trip: false,
  assignee: null,
  version: 3,
  created_at: "2030-11-10T01:00:00.000Z",
  updated_at: "2030-11-10T01:00:00.000Z",
  finished_at: null,
  purged_at: null,
  ...changes,
});

const detailOf = (changes: Partial<ManualQuoteDetail> = {}): ManualQuoteDetail => ({
  request: summaryOf(),
  contact: { email: "guest@example.com", whatsapp: "+810000000000" },
  pickup: { name: "新宿站", lat: 35.6896, lng: 139.7006 },
  dropoff: { name: "成田机场", lat: 35.772, lng: 140.3929 },
  events: [{ id: "e1", kind: "created", from_status: null, to_status: "new", assignee: null, note: null, actor: null, created_at: "2030-11-10T01:00:00.000Z" }],
  ...changes,
});

const listPaths = (calls: ApiCall[]): URL[] => calls.filter((call) => call.method === "GET" && call.path.startsWith("/platform/v1/manual-quote-requests?")).map((call) => new URL(call.path, "http://x"));
const assignees = () => json(200, { items: [{ id: ME, name: "测试员工" }, { id: COLLEAGUE, name: "佐藤" }] });

test("列表：没有任何联系方式和地点，只写留了哪几项；各状态的数量点一下只看这个状态；跟进人筛「还没人跟进」", async () => {
  const calls = openApp("/platform/manual-quotes", "platform", "customer_service", (call) => {
    if (call.method === "GET" && call.url.pathname === "/platform/v1/manual-quote-requests") return json(200, { items: [summaryOf(), summaryOf({ id: "55555555-5555-4555-8555-555555555555", request_no: "MQ20301120ZZ99YY88", status: "following", has_email: false, assignee: { id: COLLEAGUE, name: "佐藤" } })], next_cursor: null, counts: COUNTS });
    if (call.method === "GET" && call.url.pathname === "/platform/v1/manual-quote-requests/assignees") return assignees();
    return null;
  });
  const actor = user();
  const table = await screen.findByRole("region", { name: "人工报价申请" });
  await within(table).findByText("MQ20301120AB12CD34");
  assert.ok(within(table).getByText("邮箱、WhatsApp"));
  assert.ok(within(table).getAllByText("点对点 · 东京 · 2030-11-20 09:30（当地）· 2 人 1 件行李").length === 2);
  assert.ok(within(table).getByText("佐藤"));
  assert.ok(within(table).getByText("还没人跟进"));
  assert.doesNotMatch(document.body.textContent ?? "", /@|\+81|新宿/, "列表里没有联系方式和地点");
  assert.match(screen.getByText(/每次打开都记入审计日志/).textContent ?? "", /列表里没有联系方式和地点/);
  const counts = screen.getByRole("list", { name: "各状态的数量" });
  assert.deepEqual(within(counts).getAllByRole("button").map((button) => button.getAttribute("aria-label")), ["新 2 条", "跟进中 1 条", "已报价 0 条", "已转订单 0 条", "关闭 3 条"]);
  await actor.click(within(counts).getByRole("button", { name: "新 2 条" }));
  await waitFor(() => assert.equal(listPaths(calls).at(-1)?.searchParams.get("status"), "new"));
  assert.equal(within(counts).getByRole("button", { name: "新 2 条" }).getAttribute("aria-pressed"), "true");
  await actor.selectOptions(screen.getByLabelText("跟进人"), "unassigned");
  await waitFor(() => assert.equal(listPaths(calls).at(-1)?.searchParams.get("assignee"), "unassigned"));
  assert.ok(screen.getByRole("option", { name: "佐藤" }), "能跟进的同事都在跟进人的选项里");
});

test("列表按联系方式查找：不完整时不去查、说明要写完整；写完整的邮箱才带 contact 查", async () => {
  const calls = openApp("/platform/manual-quotes?contact=guest%40", "platform", "customer_service", (call) => {
    if (call.method === "GET" && call.url.pathname === "/platform/v1/manual-quote-requests") return json(200, { items: [], next_cursor: null, counts: COUNTS });
    if (call.method === "GET" && call.url.pathname === "/platform/v1/manual-quote-requests/assignees") return assignees();
    return null;
  });
  assert.ok(await screen.findByText("请输入完整的联系方式"));
  assert.equal(listPaths(calls).length, 0);
  resetBrowser();
  const again = openApp("/platform/manual-quotes?contact=Guest%40Example.com", "platform", "customer_service", (call) => {
    if (call.method === "GET" && call.url.pathname === "/platform/v1/manual-quote-requests") return json(200, { items: [], next_cursor: null, counts: COUNTS });
    if (call.method === "GET" && call.url.pathname === "/platform/v1/manual-quote-requests/assignees") return assignees();
    return null;
  });
  assert.ok(await screen.findByText("没有符合条件的申请"));
  assert.equal(listPaths(again).at(-1)?.searchParams.get("contact"), "Guest@Example.com");
});

test("权限：只读角色没有入口、直接打开说没有权限且不取数据；只勾了「人工报价 · 查看」的自建角色能看列表、不能跟进（不取能指派的同事）", async () => {
  const calls = openApp("/platform/manual-quotes", "platform", "readonly", () => null);
  assert.ok(await screen.findByText("你没有权限查看这里"));
  assertAbsent(screen.queryByRole("link", { name: "人工报价" }));
  assert.equal(calls.filter((call) => call.path.includes("manual-quote")).length, 0);
  resetBrowser();
  const viewer = openApp("/platform/manual-quotes", "platform", "custom_viewer", (call) => (call.method === "GET" && call.url.pathname === "/platform/v1/manual-quote-requests" ? json(200, { items: [], next_cursor: null, counts: COUNTS }) : null), ["manual_quote.read"]);
  assert.ok(await screen.findByText("你可以查看人工报价申请，但不能跟进。"));
  assert.ok(screen.getByRole("link", { name: "人工报价" }));
  assert.equal(viewer.filter((call) => call.path.endsWith("/assignees")).length, 0);
});

function openDetail(detail: ManualQuoteDetail, patch: (call: ApiCall) => Response = () => json(200, { request: summaryOf({ status: "following", version: 4 }) }), role = "customer_service", permissions: string[] = []): ApiCall[] {
  let current = detail;
  return openApp(`/platform/manual-quotes/${REQUEST_ID}`, "platform", role, (call) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/manual-quote-requests/${REQUEST_ID}`) return json(200, current);
    if (call.method === "GET" && call.url.pathname === "/platform/v1/manual-quote-requests/assignees") return assignees();
    if (call.method === "PATCH" && call.url.pathname === `/platform/v1/manual-quote-requests/${REQUEST_ID}`) {
      const response = patch(call);
      if (response.ok) current = { ...current, request: summaryOf({ status: "following", version: 4 }), events: [...current.events, { id: "e2", kind: "status", from_status: "new", to_status: "following", assignee: null, note: null, actor: { id: ME, name: "测试员工" }, created_at: "2030-11-10T02:00:00.000Z" }] };
      return response;
    }
    if (call.method === "POST" && call.url.pathname === `/platform/v1/manual-quote-requests/${REQUEST_ID}/notes`) return json(201, { event: { id: "e3", kind: "note", from_status: null, to_status: null, assignee: null, note: (call.body as { note: string }).note, actor: { id: ME, name: "测试员工" }, created_at: "2030-11-10T03:00:00.000Z" } });
    return null;
  }, permissions);
}

test("详情：联系方式、两端地点；邮箱点开发信、WhatsApp 去 wa.me（新标签页）；写明打开已记入审计", async () => {
  openDetail(detailOf());
  assert.ok(await screen.findByRole("heading", { level: 1, name: "申请 MQ20301120AB12CD34" }));
  assert.equal(screen.getByRole("link", { name: "guest@example.com" }).getAttribute("href"), "mailto:guest@example.com");
  const whatsapp = screen.getByRole("link", { name: /^\+810000000000/ });
  const href = new URL(whatsapp.getAttribute("href") ?? "");
  assert.equal(`${href.origin}${href.pathname}`, "https://wa.me/810000000000");
  assert.equal(href.searchParams.get("text"), "您好，这里是 NOZOMI 用车的客服，关于您的用车报价申请（MQ20301120AB12CD34）：");
  assert.equal(whatsapp.getAttribute("target"), "_blank");
  assert.match(whatsapp.getAttribute("rel") ?? "", /\bnoopener\b/);
  assert.ok(screen.getByText(/你打开这一页已记入审计日志/));
  assert.ok(screen.getByText("新宿站"));
  assert.ok(screen.getByText("成田机场"));
  assert.ok(screen.getByText("客人提交"));
  assertAbsent(screen.queryByText("验收"));
});

test("详情：包车经停点（M9W-04）在上车和下车地点之间按顺序写「经停 N · 停留」和地点；没有经停点的不出这一项", async () => {
  const stops = [
    { name: "五合目", lat: 35.395, lng: 138.733, stay_minutes: 60 },
    { name: "河口湖", lat: 35.498, lng: 138.769, stay_minutes: 90 },
  ];
  openDetail(detailOf({ request: summaryOf({ category: "charter", package_hours: null }), dropoff: { name: "新宿站南口", lat: 35.6887, lng: 139.7005 }, waypoints: stops }));
  const list = await screen.findByRole("list", { name: "经停点" });
  assert.deepEqual([...list.querySelectorAll("li")].map((item) => item.textContent), ["经停 1 · 停留 1 小时五合目35.39500, 138.73300", "经停 2 · 停留 1 小时 30 分河口湖35.49800, 138.76900"]);
  const labels = [...document.querySelectorAll("#mq-contact ~ dl dt, section[aria-labelledby='mq-contact'] dt")].map((node) => node.textContent);
  assert.deepEqual(labels.slice(labels.indexOf("上车地点"), labels.indexOf("下车地点") + 1), ["上车地点", "经停点", "下车地点"]);
  resetBrowser();

  openDetail(detailOf());
  await screen.findByRole("heading", { level: 1, name: "申请 MQ20301120AB12CD34" });
  assertAbsent(screen.queryByRole("list", { name: "经停点" }));
});

test("详情：验收留资（M8-39）在状态徽标旁标「验收」；真实客人的没有", async () => {
  openDetail(detailOf({ request: summaryOf({ is_acceptance: true }) }));
  const card = (await screen.findByRole("heading", { level: 2, name: "行程" })).closest("section") as HTMLElement;
  const badges = within(card).getByText("验收").closest(".badge-row") as HTMLElement;
  assert.deepEqual([...badges.querySelectorAll(".badge")].map((badge) => badge.textContent), ["新", "验收"]);
  assert.ok(within(badges).getByText("验收").closest(".badge--neutral"));
});

test("详情：改状态、指派带版本号（If-Match）；不是「新」以后状态里没有「新」；保存后跟进记录重新读", async () => {
  const calls = openDetail(detailOf());
  const actor = user();
  await screen.findByRole("heading", { level: 1, name: "申请 MQ20301120AB12CD34" });
  const follow = screen.getByRole("region", { name: "跟进" });
  assert.equal((within(follow).getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled, true, "没改不能保存");
  await actor.selectOptions(within(follow).getByLabelText("状态"), "following");
  await actor.click(within(follow).getByRole("button", { name: "指派给我" }));
  await actor.click(within(follow).getByRole("button", { name: "保存" }));
  await screen.findByText("状态：新 → 跟进中");
  const patch = calls.find((call) => call.method === "PATCH");
  assert.deepEqual(patch?.body, { status: "following", assignee_id: ME });
  assert.equal(patch?.headers["if-match"], '"3"');
  const options = [...within(screen.getByRole("region", { name: "跟进" })).getByLabelText("状态").querySelectorAll("option")].map((option) => option.textContent);
  assert.deepEqual(options, ["跟进中", "已报价", "已转订单", "关闭"], "不是「新」以后不能改回「新」");
});

test("详情：被别人改过（VERSION_CONFLICT）时说清楚并刷新；写备注加在跟进记录里", async () => {
  const calls = openDetail(detailOf(), () => apiError(409, "VERSION_CONFLICT", "x"));
  const actor = user();
  await screen.findByRole("heading", { level: 1, name: "申请 MQ20301120AB12CD34" });
  const follow = screen.getByRole("region", { name: "跟进" });
  await actor.selectOptions(within(follow).getByLabelText("状态"), "closed");
  await actor.click(within(follow).getByRole("button", { name: "保存" }));
  assert.ok(await screen.findByText("这条申请刚被别人改过，页面已刷新成最新的样子。请看过再改。"));
  await waitFor(() => assert.equal(calls.filter((call) => call.method === "GET" && call.path === `/platform/v1/manual-quote-requests/${REQUEST_ID}`).length, 2));

  await actor.click(screen.getByRole("button", { name: "添加备注" }));
  assert.ok(screen.getByText("请写备注内容"));
  await actor.type(screen.getByLabelText("写备注"), "已通过 WhatsApp 报价 18000 日元");
  await actor.click(screen.getByRole("button", { name: "添加备注" }));
  assert.ok(await screen.findByText("已通过 WhatsApp 报价 18000 日元"));
  assert.deepEqual(calls.find((call) => call.path.endsWith("/notes"))?.body, { note: "已通过 WhatsApp 报价 18000 日元" });
});

test("详情：过了保留期的只写已清除，不能再改、不能写备注；没有跟进权限的只读", async () => {
  openDetail(detailOf({ request: summaryOf({ status: "closed", purged_at: "2031-05-01T00:00:00.000Z" }), contact: null, pickup: null, dropoff: null }));
  assert.ok(await screen.findByText(/联系方式、地点和备注已清除/));
  assert.ok(screen.getByText("已过保留期，不能再改状态、指派或写备注。"));
  assertAbsent(screen.queryByRole("button", { name: "添加备注" }));
  resetBrowser();
  openDetail(detailOf(), undefined, "custom_viewer", ["manual_quote.read"]);
  assert.ok(await screen.findByText("你可以查看，但没有跟进人工报价的权限。"));
  assertAbsent(screen.queryByRole("button", { name: "保存" }));
});

// ───────────── 官网设置 ─────────────

const settingsOf = (changes: Partial<SiteSettings> = {}): SiteSettings => ({ support_whatsapp: null, page_width: "standard", version: 0, updated_at: null, updated_by: null, ...changes });

function openSettings(role: string, settings: SiteSettings, put: (call: ApiCall) => Response = (call) => json(200, settingsOf({ support_whatsapp: "810000000000", version: settings.version + 1, updated_at: "2030-11-10T05:00:00.000Z", updated_by: { id: ME, name: "测试员工" } }))): ApiCall[] {
  return openApp("/platform/settings/site", "platform", role, (call) => {
    if (call.method === "GET" && call.url.pathname === "/platform/v1/site-settings") return json(200, settings);
    if (call.method === "PUT" && call.url.pathname === "/platform/v1/site-settings") return put(call);
    return null;
  });
}

const whatsapp = () => within(screen.getByRole("region", { name: "客服 WhatsApp" }));

test("官网设置（超级管理员）：「客服 WhatsApp 号码」有格式说明；格式不对不提交；第一次保存不带 If-Match，之后带版本号", async () => {
  const calls = openSettings("super_admin", settingsOf());
  const actor = user();
  const field = await screen.findByLabelText("客服 WhatsApp 号码");
  assert.ok(screen.getByText(/填带国家码的号码/));
  assert.ok(screen.getByText("还没有设置过"));
  await actor.type(field, "090-0000");
  await actor.click(whatsapp().getByRole("button", { name: "保存" }));
  assert.ok(screen.getByText(/号码的格式不对/));
  assert.equal(calls.filter((call) => call.method === "PUT").length, 0);
  await actor.clear(field);
  await actor.type(field, "+81 00 0000 0000");
  await actor.click(whatsapp().getByRole("button", { name: "保存" }));
  await waitFor(() => assert.equal((screen.getByLabelText("客服 WhatsApp 号码") as HTMLInputElement).value, "+810000000000"));
  const put = calls.find((call) => call.method === "PUT");
  assert.deepEqual(put?.body, { support_whatsapp: "+81 00 0000 0000" }, "只改号码时不带页面宽度");
  assert.equal(put?.headers["if-match"], undefined);
  assert.match(screen.getByRole("link", { name: /在 WhatsApp 里打开看看/ }).getAttribute("href") ?? "", /^https:\/\/wa\.me\/810000000000\?text=/);
  resetBrowser();
  const again = openSettings("super_admin", settingsOf({ support_whatsapp: "810000000000", version: 2, updated_at: "2030-11-10T05:00:00.000Z", updated_by: { id: ME, name: "测试员工" } }));
  const filled = (await screen.findByLabelText("客服 WhatsApp 号码")) as HTMLInputElement;
  assert.equal(filled.value, "+810000000000");
  await actor.clear(filled);
  await actor.click(whatsapp().getByRole("button", { name: "保存" }));
  await waitFor(() => assert.ok(again.some((call) => call.method === "PUT")));
  const cleared = again.find((call) => call.method === "PUT");
  assert.deepEqual(cleared?.body, { support_whatsapp: null }, "清空就是不设");
  assert.equal(cleared?.headers["if-match"], '"2"');
});

test("官网设置：运营、客服只读（看得到号码，说明只有超级管理员能改）；没有权限的说没有权限、不取数据", async () => {
  for (const role of ["operations", "customer_service"]) {
    const calls = openSettings(role, settingsOf({ support_whatsapp: "810000000000", version: 1, updated_at: "2030-11-10T05:00:00.000Z", updated_by: { id: COLLEAGUE, name: "佐藤" } }));
    assert.ok(await screen.findByText("+810000000000"));
    assert.ok(screen.getByText(/只有超级管理员能改这个号码/));
    assertAbsent(screen.queryByRole("textbox"));
    assertAbsent(screen.queryByRole("button", { name: "保存" }));
    assert.equal(calls.filter((call) => call.method === "PUT").length, 0);
    resetBrowser();
  }
  const calls = openSettings("finance", settingsOf());
  assert.ok(await screen.findByText("你没有权限查看这里"));
  assert.equal(calls.filter((call) => call.path.includes("site-settings")).length, 0);
});

test("官网设置 · 页面宽度（M8-28）：超级管理员选标准 / 较宽 / 最宽保存（号码原样带回、带版本号）；没设过是标准；运营只读", async () => {
  const calls = openSettings("super_admin", settingsOf({ support_whatsapp: "810000000000", version: 3, updated_at: "2030-11-10T05:00:00.000Z", updated_by: { id: ME, name: "测试员工" } }), () =>
    json(200, settingsOf({ support_whatsapp: "810000000000", page_width: "full", version: 4, updated_at: "2030-11-11T05:00:00.000Z", updated_by: { id: ME, name: "测试员工" } })),
  );
  const actor = user();
  const card = within(await screen.findByRole("region", { name: "页面宽度" }));
  assert.equal((card.getByRole("radio", { name: /^标准/ }) as HTMLInputElement).checked, true, "没设过是标准");
  assert.ok(card.getByText(/手机和平板始终是单栏/));
  await actor.click(card.getByRole("radio", { name: /^最宽/ }));
  await actor.click(card.getByRole("button", { name: "保存" }));
  await waitFor(() => assert.ok(calls.some((call) => call.method === "PUT")));
  const put = calls.find((call) => call.method === "PUT");
  assert.deepEqual(put?.body, { support_whatsapp: "810000000000", page_width: "full" });
  assert.equal(put?.headers["if-match"], '"3"');
  assert.ok(await screen.findByText(/官网页面宽度改为「最宽」/));
  resetBrowser();

  openSettings("operations", settingsOf({ page_width: "wide", version: 1 }));
  const readOnly = within(await screen.findByRole("region", { name: "页面宽度" }));
  assert.ok(readOnly.getByText(/^较宽（/));
  assert.ok(readOnly.getByText("只有超级管理员能改页面宽度。"));
  assertAbsent(readOnly.queryByRole("radio"));
});

const TRIP: NonNullable<ManualQuoteDetail["trip"]> = {
  purged: false,
  trip_id: "T".repeat(43),
  plan_kind: "daily_best",
  currency: "JPY",
  created_at: "2030-11-01T00:00:00.000Z",
  readable_until: "2030-12-01T00:00:00.000Z",
  party: { adults: 2, children: 1, luggage: 1 },
  days: [
    {
      date: "2030-11-20",
      items: [
        { kind: "arrive_flight", time: "14:30", stay_minutes: null, lat: 35.7686, lng: 140.3887, place_id: "66666666-6666-4666-8666-666666666666", place_name: { zh: "成田机场" }, label: null },
        { kind: "stop", time: null, stay_minutes: 0, lat: 35.6938, lng: 139.7034, place_id: null, place_name: null, label: "新宿某酒店" },
      ],
    },
    { date: "2030-11-21", items: [] },
    {
      date: "2030-11-22",
      items: [
        { kind: "start", time: "09:00", stay_minutes: null, lat: 35.6938, lng: 139.7034, place_id: null, place_name: null, label: "新宿某酒店" },
        { kind: "stop", time: null, stay_minutes: 90, lat: 35.7148, lng: 139.7967, place_id: null, place_name: null, label: null },
      ],
    },
  ],
  quoted_at: "2030-11-10T00:00:00.000Z",
  plans: [
    { kind: "one_car", status: "quoted", recommended: true, total: { amount: "120000", currency: "JPY" }, expires_at: "2030-11-10T00:30:00.000Z" },
    { kind: "daily_best", status: "unquoted", recommended: false, total: null, expires_at: null },
  ],
  unquoted: [
    { plan_kind: "daily_best", day_index: 2, reason: "NO_OFFER" },
    { plan_kind: "daily_best", day_index: null, reason: "SOMETHING_NEW" },
  ],
};

test("列表（M9T-08）：带了行程单的申请标「多日行程」，没带的不标", async () => {
  openApp("/platform/manual-quotes", "platform", "customer_service", (call) => {
    if (call.method === "GET" && call.url.pathname === "/platform/v1/manual-quote-requests") return json(200, { items: [summaryOf({ has_trip: true }), summaryOf({ id: "55555555-5555-4555-8555-555555555555", request_no: "MQ20301120ZZ99YY88" })], next_cursor: null, counts: COUNTS });
    if (call.method === "GET" && call.url.pathname === "/platform/v1/manual-quote-requests/assignees") return assignees();
    return null;
  });
  const table = await screen.findByRole("region", { name: "人工报价申请" });
  const tagged = (await within(table).findByText("MQ20301120AB12CD34")).closest(".table__names") as HTMLElement;
  assert.equal(within(table).getAllByText("多日行程").length, 1);
  assert.ok(within(tagged).getByText("多日行程"), "标记在带行程单的那一条");
  assertAbsent(within(within(table).getByText("MQ20301120ZZ99YY88").closest(".table__names") as HTMLElement).queryByText("多日行程"));
});

test("详情（M9T-08）：「整张行程」按天列出编号的点（名称，没有名称用平台地点名或坐标）、时间、停留、空闲日；报价结果和报不出的原因（不认得的原因码写通用的话）", async () => {
  openDetail(detailOf({ request: summaryOf({ has_trip: true }), trip: TRIP }));
  const card = (await screen.findByRole("heading", { level: 2, name: "整张行程" })).closest("section") as HTMLElement;
  assert.ok(within(screen.getByRole("heading", { level: 2, name: "行程" }).closest("section") as HTMLElement).getByText("多日行程"));
  assert.ok(within(card).getByText("成人 2 人、儿童 1 人，1 件行李"));
  assert.equal((within(card).getByText("客人当时看的方案").closest(".details__item") as HTMLElement).textContent, "客人当时看的方案每天各自最优");
  const day1 = within(card).getByRole("list", { name: "第 1 天 · 2030-11-20" });
  assert.deepEqual([...day1.querySelectorAll("li")].map((item) => item.textContent), ["1. 接机 · 14:30成田机场35.76860, 140.38870", "2. 经停 · 停留 0 分钟新宿某酒店35.69380, 139.70340"]);
  assert.ok(within(card).getByRole("heading", { level: 3, name: "第 2 天 · 2030-11-21" }));
  assert.ok(within(card).getByText("空闲日（不用车）"));
  const day3 = within(card).getByRole("list", { name: "第 3 天 · 2030-11-22" });
  assert.deepEqual([...day3.querySelectorAll("li")].map((item) => item.textContent), ["1. 出发 · 09:00新宿某酒店35.69380, 139.70340", "2. 经停 · 停留 1 小时 30 分35.71480, 139.79670"], "没有名称的点只写坐标");
  const plans = within(card).getByRole("list", { name: "报价结果" });
  assert.deepEqual([...plans.querySelectorAll("li")].map((item) => item.textContent), ["报出价一车到底（推荐）· 120,000 JPY", "报不出每天各自最优"]);
  const reasons = within(card).getByRole("list", { name: "报不出的原因" });
  assert.deepEqual([...reasons.querySelectorAll("li")].map((item) => item.textContent), ["每天各自最优 · 第 3 天：这一天没有供应商报得出价", "每天各自最优 · 全程：未能在线报价（原因码 SOMETHING_NEW）"]);
  assert.doesNotMatch(card.textContent ?? "", /TTTTTTTT/, "页面上不显示行程单编号");
});

test("详情（M9T-08）：行程单已被清理时写「行程单已清理（超过 30 天）」；没带行程单（或旧接口没有这一项）的不出「整张行程」", async () => {
  openDetail(detailOf({ request: summaryOf({ has_trip: true }), trip: { purged: true } }));
  const card = (await screen.findByRole("heading", { level: 2, name: "整张行程" })).closest("section") as HTMLElement;
  assert.ok(within(card).getByText("行程单已清理（超过 30 天）"));
  assertAbsent(within(card).queryByRole("list"));
  resetBrowser();

  openDetail(detailOf({ trip: null }));
  await screen.findByRole("heading", { level: 1, name: "申请 MQ20301120AB12CD34" });
  assertAbsent(screen.queryByRole("heading", { level: 2, name: "整张行程" }));
  assertAbsent(screen.queryByText("多日行程"));
  resetBrowser();

  openDetail(detailOf());
  await screen.findByRole("heading", { level: 1, name: "申请 MQ20301120AB12CD34" });
  assertAbsent(screen.queryByRole("heading", { level: 2, name: "整张行程" }));
});
