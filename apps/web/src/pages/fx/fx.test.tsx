/** 汇率页和首页的汇率提醒（M2-03）：接口用测试替身，路由表用真实的 <App>。真实后端由端到端测试覆盖。 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { FxFetch, FxHistory, FxOverview } from "../../api/fx.ts";
import type { DashboardSummary } from "../../api/master.ts";
import { type ApiCall, apiError, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T03:04:00.000Z" };
const AS_OF = "2026-10-14T00:02:31.000Z";
const fetchRecord = (overrides: Partial<FxFetch> = {}): FxFetch => ({
  id: "7",
  started_at: "2026-10-14T00:10:00.000Z",
  finished_at: "2026-10-14T00:10:01.000Z",
  trigger: "schedule",
  triggered_by: null,
  source: "open.er-api.com",
  status: "accepted",
  error_code: null,
  error_detail: null,
  source_as_of: AS_OF,
  source_next_update_at: "2026-10-15T00:02:31.000Z",
  held_rates: null,
  jumps: null,
  decided_by: null,
  decided_at: null,
  ...overrides,
});
const overview = (overrides: Partial<FxOverview> = {}): FxOverview => ({
  base: "USD",
  state: "fresh",
  as_of: AS_OF,
  fetched_at: "2026-10-14T00:10:01.000Z",
  stale_at: "2026-10-16T00:02:31.001Z",
  max_age_hours: 48,
  jump_threshold_bp: 300,
  source: "open.er-api.com",
  rates: [
    { currency: "JPY", rate: "151.21" },
    { currency: "KRW", rate: "1422.53" },
    { currency: "CNY", rate: "7.1234" },
    { currency: "HKD", rate: "7.7731" },
    { currency: "TWD", rate: "32.115" },
    { currency: "THB", rate: "36.21" },
  ],
  cross: [
    { from: "CNY", to: "JPY", rate: "21.227223511244" },
    { from: "JPY", to: "USD", rate: "0.006613319225" },
  ],
  source_status: { host: "open.er-api.com", auto_fetch: true, last_attempt: fetchRecord(), last_success_at: "2026-10-14T00:10:01.000Z", next_fetch_at: "2026-10-14T12:10:01.000Z" },
  held: null,
  ...overrides,
});
const history: FxHistory = {
  base: "USD",
  from: "2026-09-14T00:00:00.000Z",
  to: "2026-10-14T01:00:00.000Z",
  series: [
    { currency: "JPY", points: [{ as_of: "2026-10-12T00:02:31.000Z", rate: "150.5" }, { as_of: "2026-10-13T00:02:31.000Z", rate: "152" }, { as_of: AS_OF, rate: "151.21" }] },
    { currency: "CNY", points: [] },
  ],
};
const me = (role: string) => json(200, { user: { id: "p1", email: "staff@platform.example", name: "测试员工", role, status: "active", ...stamps }, permissions: [], must_change_password: false });
const counts = (active: number, disabled: number) => ({ total: active + disabled, active, disabled });
const summary = (fx: DashboardSummary["fx"]): DashboardSummary => ({
  tenants: null,
  master_data: {
    cities: counts(1, 0),
    places: { ...counts(1, 0), by_type: { airport: counts(1, 0), station: counts(0, 0), poi: counts(0, 0), terminal: counts(0, 0), exit: counts(0, 0) }, airports_without_city: 0 },
    vehicle_groups: counts(1, 0),
    addons: counts(1, 0),
  },
  fx,
});

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;

function open(path: string, role: string, routes: Route = () => null): ApiCall[] {
  signIn("platform", "platform-token");
  const calls = stubApiWith((call) => {
    const custom = routes(call);
    if (custom !== null) return custom;
    if (call.url.pathname === "/platform/v1/auth/me") return me(role);
    if (call.url.pathname === "/platform/v1/fx-rates") return json(200, overview({ base: (call.url.searchParams.get("base") ?? "USD") as FxOverview["base"] }));
    if (call.url.pathname === "/platform/v1/fx-rates/history") return json(200, history);
    if (call.url.pathname === "/platform/v1/fx-rates/fetches") return json(200, { items: [fetchRecord(), fetchRecord({ id: "6", status: "failed", error_code: "FX_SOURCE_UNAVAILABLE", error_detail: "汇率源暂时不可用（HTTP 503）" })] });
    if (call.url.pathname === "/platform/v1/dashboard/summary") return json(200, summary({ state: "fresh", as_of: AS_OF, stale_at: "2026-10-16T00:02:31.001Z", held: false, last_attempt_status: "accepted" }));
    return null;
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}
const main = (): HTMLElement => document.querySelector("main") as HTMLElement;

test("汇率页：数据源状态、当前汇率（相对选的基准）、常用币种互换、走势、拉取记录；汇率按字符串四舍五入显示，完整值在悬停提示里", async () => {
  const calls = open("/platform/master/fx-rates", "readonly");
  await within(main()).findByRole("heading", { level: 2, name: "数据源" });
  assert.equal(screen.getByRole("heading", { level: 1 }).textContent, "汇率");
  assert.equal(document.title, "汇率 · NOZOMI 运营后台");
  assert.ok(within(main()).getByText("正常"));
  const rates = within(main()).getByRole("region", { name: "当前汇率表" });
  const jpyRow = within(rates).getByRole("rowheader", { name: "JPY 日元" }).closest("tr") as HTMLElement;
  assert.equal(within(jpyRow).getByText("151.21").getAttribute("title"), "151.21");
  const matrix = within(main()).getByRole("region", { name: "币种互换表" });
  const cny = within(matrix).getByRole("rowheader", { name: "CNY" }).closest("tr") as HTMLElement;
  assert.equal(within(cny).getByTitle("21.227223511244").textContent, "21.2272");
  const chart = await within(main()).findByRole("img");
  assert.match(chart.getAttribute("aria-label") ?? "", /最低 150\.5，最高 152，最新 151\.21（3 个点）/);
  await within(main()).findByText("汇率源暂时不可用（HTTP 503）");
  // 只读角色：没有「立即拉取」
  assert.equal(within(main()).queryByRole("button", { name: "立即拉取" }), null);
  // 菜单里有「汇率」
  assert.ok(screen.getByRole("link", { name: "汇率" }));
  // 换基准币种：按新的基准重新取
  await userEvent.selectOptions(within(main()).getByLabelText("基准币种"), "JPY");
  await waitFor(() => assert.ok(calls.some((call) => call.path === "/platform/v1/fx-rates?base=JPY")));
  await waitFor(() => assert.ok(calls.some((call) => call.path.startsWith("/platform/v1/fx-rates/history?base=JPY"))));
});

test("立即拉取（主数据运营）：按结果给出提示并刷新；正在拉时提示稍后再看；没拉到时说明原因、继续用旧汇率", async () => {
  const results = [
    json(200, { fetch: fetchRecord({ id: "8", trigger: "manual", status: "accepted" }) }),
    apiError(409, "FX_FETCH_IN_PROGRESS", "正在拉取汇率，请稍后再看结果"),
    json(200, { fetch: fetchRecord({ id: "9", trigger: "manual", status: "failed", error_code: "FX_SOURCE_TIMEOUT", error_detail: "下载汇率超时（8 秒）" }) }),
  ];
  const calls = open("/platform/master/fx-rates", "master_data", (call) => (call.method === "POST" && call.url.pathname === "/platform/v1/fx-rates/fetch" ? (results.shift() as Response) : null));
  const button = await within(main()).findByRole("button", { name: "立即拉取" });
  const before = calls.filter((call) => call.path.startsWith("/platform/v1/fx-rates?")).length;
  await userEvent.click(button);
  await within(main()).findByText("汇率已更新");
  await waitFor(() => assert.ok(calls.filter((call) => call.path.startsWith("/platform/v1/fx-rates?")).length > before, "拉完重新取看板"));
  await userEvent.click(button);
  await within(main()).findByText("正在拉取汇率（定时任务或其他同事），稍后刷新看结果");
  await userEvent.click(button);
  await within(main()).findByText("没有拉到汇率：下载汇率超时（8 秒）。继续用最近一次的汇率");
  assert.equal(calls.filter((call) => call.method === "POST").length, 3);
});

test("过期、没有汇率：页面顶部醒目提醒（过期是危险提示，说明跨币种报价已暂停）", async () => {
  open("/platform/master/fx-rates", "readonly", (call) => (call.url.pathname === "/platform/v1/fx-rates" ? json(200, overview({ state: "stale" })) : null));
  const alert = (await within(main()).findByText("汇率超过 48 小时没有更新，跨币种报价已暂停")).closest(".alert") as HTMLElement;
  assert.ok(alert.classList.contains("alert--danger"));
  assert.match(alert.textContent ?? "", /请联系主数据运营处理/);
  assert.ok(within(main()).getByText("已过期"));
  resetBrowser();
  open("/platform/master/fx-rates", "super_admin", (call) => (call.url.pathname === "/platform/v1/fx-rates" ? json(200, overview({ state: "none", as_of: null, fetched_at: null, stale_at: null, rates: overview().rates.map((item) => ({ ...item, rate: null })), cross: [] })) : null));
  await within(main()).findByText("还没有汇率：跨币种的报价都报不出");
});

test("挂起的一批：列出变动超过 3% 的币种；有权限的人确认前先问一遍，确认后提示并刷新；没权限的看不到按钮", async () => {
  const held = fetchRecord({ id: "12", status: "held", error_code: "FX_RATE_JUMP", source_as_of: "2026-10-15T00:02:31.000Z", jumps: [{ currency: "JPY", previous: "151.21", next: "157.3", change_bp: 403 }] });
  let decided = false;
  const calls = open("/platform/master/fx-rates", "master_data", (call) => {
    if (call.url.pathname === "/platform/v1/fx-rates") return json(200, overview({ held: decided ? null : held }));
    if (call.method === "POST" && call.url.pathname === "/platform/v1/fx-rates/fetches/12/confirm") {
      decided = true;
      return json(200, { fetch: { ...held, status: "confirmed", decided_by: { id: "p1", name: "测试员工" } } });
    }
    return null;
  });
  const card = (await within(main()).findByRole("heading", { name: "有一批汇率变动超过 3%，等待确认" })).closest("section") as HTMLElement;
  assert.match(card.textContent ?? "", /JPY 日元.*1 USD = 151\.21 → 157\.3（\+4\.03%）/);
  await userEvent.click(within(card).getByRole("button", { name: "确认生效" }));
  const dialog = await screen.findByRole("dialog", { name: "确认这批汇率生效？" });
  await userEvent.click(within(dialog).getByRole("button", { name: "确认生效" }));
  await within(main()).findByText("这批汇率已确认生效");
  await waitFor(() => assert.equal(within(main()).queryByRole("heading", { name: "有一批汇率变动超过 3%，等待确认" }), null));
  assert.ok(calls.some((call) => call.method === "POST" && call.path === "/platform/v1/fx-rates/fetches/12/confirm"));
  resetBrowser();
  open("/platform/master/fx-rates", "finance", (call) => (call.url.pathname === "/platform/v1/fx-rates" ? json(200, overview({ held })) : null));
  const readonlyCard = (await within(main()).findByRole("heading", { name: "有一批汇率变动超过 3%，等待确认" })).closest("section") as HTMLElement;
  assert.equal(within(readonlyCard).queryByRole("button"), null);
});

test("首页：主数据里有「汇率」卡片（更新时间）；过期时页面顶部一条危险提示，挂起、还没有汇率写在卡片的提醒行", async () => {
  open("/platform", "readonly");
  const card = (await within(main()).findByRole("link", { name: /^汇率/ })).closest(".entry-card") as HTMLElement;
  assert.equal(within(card).getByRole("link", { name: /^汇率/ }).getAttribute("href"), "/platform/master/fx-rates");
  await waitFor(() => assert.match(card.textContent ?? "", /更新于/));
  assert.equal(within(main()).queryByText("汇率超过 48 小时没有更新，跨币种报价已暂停"), null);
  resetBrowser();
  open("/platform", "readonly", (call) => (call.url.pathname === "/platform/v1/dashboard/summary" ? json(200, summary({ state: "stale", as_of: AS_OF, stale_at: "2026-10-16T00:02:31.001Z", held: true, last_attempt_status: "failed" })) : null));
  const alert = (await within(main()).findByText("汇率超过 48 小时没有更新，跨币种报价已暂停")).closest(".alert") as HTMLElement;
  assert.ok(alert.classList.contains("alert--danger"));
  assert.equal(within(alert).getByRole("link", { name: "去汇率页处理" }).getAttribute("href"), "/platform/master/fx-rates");
  assert.ok(within(main()).getByRole("link", { name: "有一批汇率变动超过 3%，待确认" }));
  resetBrowser();
  open("/platform", "readonly", (call) => (call.url.pathname === "/platform/v1/dashboard/summary" ? json(200, summary({ state: "none", as_of: null, stale_at: null, held: false, last_attempt_status: null })) : null));
  assert.ok(await within(main()).findByRole("link", { name: "还没有汇率，跨币种报价都报不出" }));
});

test("M1-14 汇率页：数字是四舍五入的（不是截短）；点「显示完整数值」两张表都换成完整值（手机上没有悬停也看得到），再点换回来", async () => {
  const actor = userEvent.setup();
  open("/platform/master/fx-rates", "readonly", (call) =>
    call.url.pathname === "/platform/v1/fx-rates"
      ? json(200, overview({ rates: [...overview().rates.filter((item) => item.currency !== "KRW"), { currency: "KRW", rate: "1334.892169" }], cross: [{ from: "CNY", to: "HKD", rate: "1.171597" }, { from: "JPY", to: "USD", rate: "0.006329340458" }] }))
      : null,
  );
  const rates = await within(main()).findByRole("region", { name: "当前汇率表" });
  const krw = within(rates).getByRole("rowheader", { name: "KRW 韩元" }).closest("tr") as HTMLElement;
  assert.equal(within(krw).getByTitle("1334.892169").textContent, "1334.8922", "截短会显示 1334.8921");
  const matrix = within(main()).getByRole("region", { name: "币种互换表" });
  assert.equal(within(matrix).getByTitle("1.171597").textContent, "1.1716");
  assert.equal(within(matrix).getByTitle("0.006329340458").textContent, "0.00632934");
  assert.match(main().textContent ?? "", /表里是四舍五入后的值：1 以上保留 4 位小数，不到 1 保留 6 位有效数字。/);

  const toggles = within(main()).getAllByRole("button", { name: "显示完整数值" });
  assert.equal(toggles.length, 2, "两张表各有一个，作用一样");
  assert.equal(toggles[0]?.getAttribute("aria-pressed"), "false");
  await actor.click(toggles[1] as HTMLElement);
  assert.equal(within(krw).getByTitle("1334.892169").textContent, "1334.892169");
  assert.equal(within(matrix).getByTitle("0.006329340458").textContent, "0.006329340458");
  assert.match(main().textContent ?? "", /现在显示的是完整数值（报价用的就是它）。/);
  const back = within(main()).getAllByRole("button", { name: "显示四舍五入后的" });
  assert.equal(back[0]?.getAttribute("aria-pressed"), "true");
  await actor.click(back[0] as HTMLElement);
  assert.equal(within(krw).getByTitle("1334.892169").textContent, "1334.8922");
});
