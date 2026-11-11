/**
 * 运营后台「人工报价」和「系统设置 → 官网设置」（M8-21，ADR 0076）的组件测试：
 * 列表没有个人信息、各状态的数量、按状态 / 跟进人 / 联系方式筛（不完整的联系方式不去查）；详情的联系方式、发信和 WhatsApp 链接、审计提示、
 * 改状态和指派带版本号、被别人改过时刷新、写备注；已清除的不能再改；官网设置只有超级管理员能改（格式校验、第一次不带 If-Match），运营只读，没有权限的看不到。
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
