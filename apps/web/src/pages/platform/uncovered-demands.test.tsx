/**
 * 运营后台「未覆盖需求」（M8-20）的组件测试：菜单按权限、列表和计数、筛选写进请求、日期范围不对当场说、详情（运营区域的名称、拒绝原因）、
 * 「在区域地图上查看」、翻页、空 / 出错 / 没有权限。接口一律是测试替身。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { UncoveredDemand, UncoveredDemandPage } from "../../api/uncovered-demands.ts";
import { type ApiCall, assertAbsent, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T03:04:00.000Z" };
const CITY = "11111111-1111-4111-8111-111111111111";
const TENANT = "22222222-2222-4222-8222-222222222222";
const AREA = "33333333-3333-4333-8333-333333333333";

const demand = (overrides: Partial<UncoveredDemand> = {}): UncoveredDemand => ({
  id: "44444444-4444-4444-8444-444444444444",
  first_seen_at: "2026-11-09T01:00:00.000Z",
  last_seen_at: "2026-11-09T02:30:00.000Z",
  repeat_count: 3,
  channel_kind: "site",
  channel_id: "55555555-5555-4555-8555-555555555555",
  category: "point_to_point",
  direction: null,
  package_hours: null,
  city_id: CITY,
  airport_id: null,
  pickup: { lat: 35.6812, lng: 139.7671 },
  dropoff: { lat: 35.6586, lng: 139.7454 },
  pickup_name: "东京站",
  dropoff_name: null,
  service_local: "2026-11-20T09:30",
  service_date: "2026-11-20",
  passengers: 2,
  luggage: 1,
  vehicle_group_id: null,
  pickup_operating: [{ tenant_id: TENANT, area_id: AREA }],
  dropoff_operating: [],
  tenant_ids: [TENANT],
  reason: "NO_PRICING_AREA",
  refusal_counts: { NO_PRICING_AREA: 2, LEAD_TIME_TOO_SHORT: 1 },
  ...overrides,
});

const pageOf = (items: UncoveredDemand[], next: string | null = null): UncoveredDemandPage => ({
  from: "2026-10-12",
  to: "2026-11-10",
  items,
  next_cursor: next,
  summary: { rows: 7, repeats: 19, dropped: 4, by_reason: [{ reason: "NO_PRICING_AREA", rows: 5, repeats: 15 }, { reason: "OUTSIDE_OPERATING", rows: 2, repeats: 4 }], by_city: [{ city_id: CITY, rows: 6, repeats: 18 }, { city_id: null, rows: 1, repeats: 1 }], by_tenant: [{ tenant_id: TENANT, rows: 5, repeats: 15 }] },
  tenants: [{ id: TENANT, name: "甲车队" }],
  cities: [{ id: CITY, name: { zh: "东京" } }],
});

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;

function open(path: string, role: string, routes: Route = () => null): ApiCall[] {
  signIn("platform", "platform-token");
  const calls = stubApiWith((call) => {
    const custom = routes(call);
    if (custom !== null) return custom;
    const at = call.url.pathname;
    if (at === "/platform/v1/auth/me") return json(200, { user: { id: "p1", email: "ops@example.com", name: "运营", role, role_name: role, status: "active", ...stamps }, permissions: [], must_change_password: false });
    if (at === "/platform/v1/tenants") return json(200, { items: [{ id: TENANT, name: "甲车队", status: "active" }], next_cursor: null });
    if (at === "/platform/v1/city-options") return json(200, { items: [{ id: CITY, code: "CTY-JP-TYO", country_code: "JP", name: { zh: "东京" }, timezone: "Asia/Tokyo", center: { lat: 35.7, lng: 139.7 }, status: "active" }] });
    if (at === "/platform/v1/area-map") return json(200, { items: [{ id: AREA, name: { zh: "东京全域" } }], truncated: false });
    return null;
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

const query = (calls: ApiCall[]): URLSearchParams => new URL(calls.filter((call) => call.path.startsWith("/platform/v1/uncovered-demands?") || call.path === "/platform/v1/uncovered-demands").at(-1)?.path ?? "/", "http://test").searchParams;

test("菜单：运营、招商、渠道经理有「未覆盖需求」（排在报价试算后面）；客服、财务、风控没有，直接打开地址显示没有权限、不取数据", async () => {
  for (const role of ["operations", "tenant_onboarding", "channel_manager"]) {
    open("/platform", role);
    const menu = await screen.findByRole("navigation", { name: "主菜单" }, { timeout: 5000 });
    const labels = within(menu).getAllByRole("link").map((link) => link.textContent);
    assert.ok(labels.includes("未覆盖需求"), role);
    assert.equal(labels.indexOf("未覆盖需求"), labels.indexOf("报价试算") + 1, role);
    resetBrowser();
  }
  for (const role of ["customer_service", "finance", "risk"]) {
    const calls = open("/platform/uncovered-demands", role);
    await screen.findByText("你没有权限查看这里", {}, { timeout: 5000 });
    assertAbsent(within(screen.getByRole("navigation", { name: "主菜单" })).queryByRole("link", { name: "未覆盖需求" }));
    assert.ok(!calls.some((call) => call.path.startsWith("/platform/v1/uncovered-demands")), role);
    resetBrowser();
  }
});

test("列表：计数（合计、按原因、按城市、按供应商、被限流没记下的）；每条写明用车、两端（没有名称写坐标）、原因、次数、涉及的供应商", async () => {
  open("/platform/uncovered-demands", "operations", (call) => (call.url.pathname === "/platform/v1/uncovered-demands" ? json(200, pageOf([demand()])) : null));
  await screen.findByRole("heading", { name: "2026-10-12 至 2026-11-10：7 条需求，合计 19 次" }, { timeout: 5000 });
  const summary = screen.getByRole("list", { name: "按原因" });
  assert.match(summary.textContent ?? "", /在运营区域里，但没有报价区域5 条 · 15 次/);
  assert.match(summary.textContent ?? "", /联系这些供应商补一个报价区域/);
  assert.match(document.body.textContent ?? "", /按城市：东京 6 条、不在任何能订的城市 1 条/);
  assert.match(document.body.textContent ?? "", /按运营区域涉及的供应商：甲车队 5 条/);
  assert.match(document.body.textContent ?? "", /另有 4 条新需求因为防刷限流没有记下来/);
  const row = (await screen.findByText("东京站")).closest("tr") as HTMLElement;
  assert.match(row.textContent ?? "", /点对点/);
  assert.match(row.textContent ?? "", /2026-11-20 09:30 · 东京2 人 1 件行李/);
  assert.match(row.textContent ?? "", /→ 35\.6586, 139\.7454/);
  assert.match(row.textContent ?? "", /在运营区域里，但没有报价区域/);
  assert.match(row.textContent ?? "", /甲车队/);
  const map = within(row).getByRole("link", { name: "在区域地图上查看" });
  assert.equal(map.getAttribute("href"), "/platform/areas/map?demands=1&lat=35.6812&lng=139.7671");
});

test("筛选：城市、供应商、日期、用车类型、原因都写进请求；开始晚于结束当场说明、不发请求", async () => {
  const user = userEvent.setup();
  const calls = open(`/platform/uncovered-demands?city=${CITY}&tenant=${TENANT}&from=2026-11-01&to=2026-11-10&category=charter&reason=OUTSIDE_OPERATING`, "operations", (call) => (call.url.pathname === "/platform/v1/uncovered-demands" ? json(200, pageOf([])) : null));
  await waitFor(() => assert.ok(calls.some((call) => call.path.startsWith("/platform/v1/uncovered-demands?")), "发了请求"), { timeout: 5000 });
  const sent = query(calls);
  assert.deepEqual(Object.fromEntries(sent), { limit: "50", city_id: CITY, tenant_id: TENANT, from: "2026-11-01", to: "2026-11-10", category: "charter", reason: "OUTSIDE_OPERATING" });
  await screen.findByText("没有符合条件的未覆盖需求");
  await user.click(screen.getAllByRole("button", { name: "清空筛选" })[0] as HTMLElement);
  await waitFor(() => assert.deepEqual(Object.fromEntries(query(calls)), { limit: "50" }));

  resetBrowser();
  const bad = open("/platform/uncovered-demands?from=2026-11-10&to=2026-11-01", "operations", (call) => (call.url.pathname === "/platform/v1/uncovered-demands" ? json(200, pageOf([])) : null));
  await screen.findByText("开始日期不能晚于结束日期。", {}, { timeout: 5000 });
  assert.ok(!bad.some((call) => call.path.startsWith("/platform/v1/uncovered-demands")), "日期不对时不发请求");
});

test("详情：两端的名称和坐标、落在哪个供应商的哪个运营区域（取区域名称）、全部拒绝原因、来源和次数", async () => {
  const user = userEvent.setup();
  open("/platform/uncovered-demands", "operations", (call) => (call.url.pathname === "/platform/v1/uncovered-demands" ? json(200, pageOf([demand()])) : null));
  await user.click(await screen.findByRole("button", { name: /^详情：点对点/ }, { timeout: 5000 }));
  const dialog = await screen.findByRole("dialog", { name: "未覆盖需求的详情" });
  await within(dialog).findByText("甲车队 「东京全域」");
  assert.match(dialog.textContent ?? "", /东京站 · 35\.6812, 139\.7671/);
  assert.match(dialog.textContent ?? "", /下车点在哪些运营区域里不在任何供应商的运营区域里/);
  assert.match(dialog.textContent ?? "", /在运营区域里，但商品没有勾选覆盖它的报价区域 × 2、提前预订时长不够 × 1/);
  assert.match(dialog.textContent ?? "", /官网/);
  assert.match(dialog.textContent ?? "", /3 次/);
  assert.ok(within(dialog).getByRole("link", { name: "在区域地图上查看" }));
  const footerClose = within(dialog).getAllByRole("button", { name: "关闭" }).at(-1) as HTMLElement;
  await user.click(footerClose);
  await waitFor(() => assertAbsent(screen.queryByRole("dialog", { name: "未覆盖需求的详情" })));
});

test("翻页：下一页带游标；没有数据时说最近 30 天没有；取不到给「重试」", async () => {
  const user = userEvent.setup();
  let fail = true;
  const calls = open("/platform/uncovered-demands", "operations", (call) => {
    if (call.url.pathname !== "/platform/v1/uncovered-demands") return null;
    if (call.url.searchParams.get("cursor") === "c2") return json(200, pageOf([demand({ id: "66666666-6666-4666-8666-666666666666", pickup_name: "品川站" })]));
    return json(200, pageOf([demand()], "c2"));
  });
  await screen.findByText("东京站", {}, { timeout: 5000 });
  await user.click(screen.getByRole("button", { name: "下一页" }));
  await screen.findByText("品川站");
  assert.equal(query(calls).get("cursor"), "c2");

  resetBrowser();
  open("/platform/uncovered-demands", "operations", (call) => (call.url.pathname === "/platform/v1/uncovered-demands" ? json(200, { ...pageOf([]), summary: { rows: 0, repeats: 0, dropped: 0, by_reason: [], by_city: [], by_tenant: [] } }) : null));
  await screen.findByText("最近 30 天没有未覆盖需求", {}, { timeout: 5000 });

  resetBrowser();
  open("/platform/uncovered-demands", "operations", (call) => {
    if (call.url.pathname !== "/platform/v1/uncovered-demands") return null;
    if (fail) {
      fail = false;
      return Promise.reject(new TypeError("fetch failed"));
    }
    return json(200, pageOf([demand()]));
  });
  await user.click(await screen.findByRole("button", { name: "重试" }, { timeout: 5000 }));
  await screen.findByText("东京站");
});
