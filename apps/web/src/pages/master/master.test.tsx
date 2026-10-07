/** 运营后台首页与主数据页面的组件测试：接口用测试替身，路由表用真实的 <App>。真实后端由端到端测试覆盖。 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { City, DashboardSummary, Place, VehicleGroup } from "../../api/master.ts";
import { sessionStore } from "../../auth/session-store.ts";
import { type ApiCall, apiError, assertAbsent, assertFocused, deferred, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T03:04:00.000Z" };
const TOKYO_ID = "11111111-1111-4111-8111-111111111111";
const OSAKA_ID = "22222222-2222-4222-8222-222222222222";
const HND_ID = "33333333-3333-4333-8333-333333333333";
const KIX_ID = "44444444-4444-4444-8444-444444444444";
const GROUP_ID = "55555555-5555-4555-8555-555555555555";

const tokyo: City = { id: TOKYO_ID, code: "CTY-JP-TYO", country_code: "JP", name: { zh: "东京", ja: "東京", en: "Tokyo" }, timezone: "Asia/Tokyo", center: { lng: 139.767125, lat: 35.681236 }, boundary: null, status: "active", version: 3, ...stamps };
const osaka: City = { ...tokyo, id: OSAKA_ID, code: "CTY-JP-OSA", name: { zh: "大阪" }, status: "disabled", version: 1 };
const airport = (id: string, code: string, name: string): Place => ({
  id,
  type: "airport",
  code,
  country_code: "JP",
  city_id: null,
  parent_id: null,
  city: null,
  parent: null,
  name: { en: name },
  location: { lng: 139.779694, lat: 35.552258 },
  category: null,
  flight_scope: null,
  address: null,
  source: { name: "ourairports", ref: "2434", synced_at: "2026-01-01T00:00:00.000Z", overridden: false },
  status: "disabled",
  version: 1,
  ...stamps,
});
const hnd = airport(HND_ID, "HND", "Tokyo Haneda International Airport");
const kix = airport(KIX_ID, "KIX", "Kansai International Airport");
const group: VehicleGroup = { id: GROUP_ID, code: "VG-BIZ-7", grade: "business", seats: 7, name: { zh: "商务七座" }, sample_models: ["丰田埃尔法"], power: "fuel", combos: [{ passengers: 6, luggage: 4 }], status: "active", version: 2, ...stamps };
const counts = (active: number, disabled: number) => ({ total: active + disabled, active, disabled });
const summary = (waiting: number): DashboardSummary => ({
  tenants: { total: 4, active: 3, suspended: 1 },
  master_data: {
    cities: counts(0, 3),
    places: { ...counts(9, 99), by_type: { airport: counts(2, 97), station: counts(2, 0), poi: counts(1, 0), terminal: counts(3, 2), exit: counts(1, 0) }, airports_without_city: waiting },
    vehicle_groups: counts(8, 0),
    addons: counts(6, 1),
  },
});

const me = (role: string) => json(200, { user: { id: "p1", email: "staff@platform.example", name: "测试员工", role, status: "active", ...stamps }, permissions: [], must_change_password: false });
const page = <T,>(items: T[], total = items.length, next: string | null = null) => json(200, { items, next_cursor: next, total });

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;

/** 登录成指定角色并渲染；`routes` 没接住的接口里，auth/me、首页统计、城市清单有默认应答。 */
function open(path: string, role: string, routes: Route = () => null): ApiCall[] {
  signIn("platform", "platform-token");
  const calls = stubApiWith((call) => {
    const custom = routes(call);
    if (custom !== null) return custom;
    if (call.url.pathname === "/platform/v1/auth/me") return me(role);
    if (call.url.pathname === "/platform/v1/dashboard/summary") return json(200, summary(97));
    if (call.method === "GET" && call.url.pathname === "/platform/v1/master/cities") return page([tokyo, osaka]);
    return null;
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

const written = (calls: ApiCall[]) => calls.filter((call) => call.method !== "GET");
const main = (): HTMLElement => document.querySelector("main") as HTMLElement;
const cardOf = (title: string): HTMLElement => (screen.getByText(title, { selector: ".entry-card__title" }).closest(".entry-card") as HTMLElement);

/* ───────────── 首页与菜单 ───────────── */

test("首页：入口不等数量——卡片和链接立即出现；数量来自接口，地点只算机场、车站、地标；提醒行带去处理的链接", async () => {
  const pending = deferred();
  open("/platform", "super_admin", (call) => (call.url.pathname === "/platform/v1/dashboard/summary" ? pending.promise : null));
  await within(main()).findByRole("link", { name: "城市" });
  assert.equal(within(main()).getByRole("link", { name: "地点" }).getAttribute("href"), "/platform/master/places");
  assert.equal(within(main()).getByRole("link", { name: "车型组" }).getAttribute("href"), "/platform/master/vehicle-groups");
  assert.equal(within(main()).getByRole("link", { name: "附加服务" }).getAttribute("href"), "/platform/master/addons");
  assert.ok(cardOf("城市").querySelector(".entry-card__skeleton"));
  assertAbsent(screen.queryByText("当前登录"));

  pending.resolve(json(200, summary(97)));
  await waitFor(() => assert.equal(cardOf("地点").querySelector("dl")?.textContent, "启用5已停用97"));
  assert.equal(cardOf("城市").querySelector("dl")?.textContent, "启用0已停用3");
  assert.equal(cardOf("车型组").querySelector("dl")?.textContent, "启用8已停用0", "0 也照常显示");
  assert.equal(cardOf("供应商").querySelector("dl")?.textContent, "正常3已暂停1");
  assertAbsent(within(cardOf("供应商")).queryByRole("link"));
  assert.equal(screen.getByRole("link", { name: "97 个机场待指定城市" }).getAttribute("href"), "/platform/master/places/pending");
  assert.equal(screen.getByRole("link", { name: "先新增城市，才能给机场指定城市" }).getAttribute("href"), "/platform/master/cities/new");
  assert.equal(within(main()).getByRole("link", { name: "城市" }).getAttribute("aria-describedby"), cardOf("城市").querySelector(".entry-card__counts-row")?.id);
});

test("首页：只读角色的提醒行去筛好的列表，没有「先新增城市」；接口说不能看的模块没有卡片", async () => {
  open("/platform", "finance", (call) => (call.url.pathname === "/platform/v1/dashboard/summary" ? json(200, { ...summary(5), tenants: null }) : null));
  const reminder = await screen.findByRole("link", { name: "5 个机场待指定城市" });
  assert.equal(reminder.getAttribute("href"), "/platform/master/places?city=none");
  assertAbsent(screen.queryByText("先新增城市，才能给机场指定城市"));
  assertAbsent(screen.queryByText("供应商"));
  assertAbsent(screen.queryByText("运营", { selector: "h2" }));
});

test("首页：数量加载失败——入口照常可用，数量显示「—」，提示条可以重试", async () => {
  let attempts = 0;
  open("/platform", "operations", (call) => {
    if (call.url.pathname !== "/platform/v1/dashboard/summary") return null;
    attempts += 1;
    return attempts === 1 ? apiError(500, "INTERNAL_ERROR", "服务器内部错误") : json(200, summary(0));
  });
  assert.ok((await screen.findByText("数量没有加载出来", { selector: "strong" })).closest('[role="alert"]'));
  assert.ok(screen.getByText("入口可以照常使用。请检查网络后重试。"));
  assert.ok(cardOf("城市").querySelector(".entry-card__missing"));
  assert.ok(within(main()).getByRole("link", { name: "城市" }));
  await userEvent.setup().click(screen.getByRole("button", { name: "重试" }));
  await waitFor(() => assert.equal(cardOf("城市").querySelector("dl")?.textContent, "启用0已停用3"));
  assertAbsent(screen.queryByText("数量没有加载出来", { selector: "strong" }));
  assertAbsent(screen.queryByText(/个机场待指定城市/));
});

test("菜单：首页 + 主数据分组（城市、地点、车型组、附加服务）；分组可以收起；编辑页所属的列表项是当前页", async () => {
  open(`/platform/master/cities/${TOKYO_ID}`, "master_data", (call) => (call.url.pathname === `/platform/v1/master/cities/${TOKYO_ID}` ? json(200, tokyo) : null));
  await screen.findByDisplayValue("东京");
  const nav = document.querySelector('.sidebar--pinned nav[aria-label="主菜单"]') as HTMLElement;
  assert.deepEqual(within(nav).getAllByRole("link").map((link) => link.textContent), ["首页", "城市", "地点", "车型组", "附加服务"]);
  assert.equal(within(nav).getByRole("link", { name: "城市" }).getAttribute("aria-current"), "page");
  const toggle = within(nav).getByRole("button", { name: "主数据" });
  assert.equal(toggle.getAttribute("aria-expanded"), "true");
  await userEvent.setup().click(toggle);
  assert.equal(toggle.getAttribute("aria-expanded"), "false");
  assert.deepEqual(within(nav).getAllByRole("link").map((link) => link.textContent), ["首页"]);
  await userEvent.setup().click(toggle);
  assert.equal(document.querySelector('nav[aria-label="当前位置"]')?.textContent, "主数据 / 城市 / 东京");
});

/* ───────────── 列表 ───────────── */

test("城市列表：列、显示名与其余语言、国家、时区、状态徽标、总数；默认查全部状态、每页 50 条", async () => {
  const calls = open("/platform/master/cities", "master_data", (call) => (call.url.pathname === "/platform/v1/master/cities" && call.url.searchParams.has("limit") && call.url.searchParams.get("limit") !== "200" ? page([tokyo, osaka], 62) : null));
  const link = await screen.findByRole("link", { name: "CTY-JP-TYO" });
  assert.equal(link.getAttribute("href"), `/platform/master/cities/${TOKYO_ID}`);
  const row = link.closest("tr") as HTMLElement;
  assert.equal(link.closest("th")?.getAttribute("scope"), "row");
  assert.ok(within(row).getByText("东京").getAttribute("lang") === "zh-Hans");
  assert.equal(row.querySelector(".table__other-names")?.textContent, "Tokyo / 東京");
  assert.ok(within(row).getByText("日本（JP）"));
  assert.ok(within(row).getByText("Asia/Tokyo（UTC+9）"));
  assert.ok(within(row).getByText("启用").closest(".badge--success"));
  assert.ok(within(screen.getByRole("link", { name: "CTY-JP-OSA" }).closest("tr") as HTMLElement).getByText("已停用").closest(".badge--neutral"));
  assert.ok(screen.getByText("共 62 条"));
  assert.equal(document.title, "城市 · NOZOMI 运营后台");
  assert.equal(screen.getByRole("link", { name: "新增城市" }).getAttribute("href"), "/platform/master/cities/new");
  const list = calls.find((call) => call.path.includes("limit=50"));
  assert.ok(list, "默认每页 50 条");
  assert.ok(list.path.includes("status=all"));
  assert.equal(list.headers["authorization"], "Bearer platform-token");
  assertAbsent(screen.queryByText(/删除/));
});

test("城市列表：只读角色没有「新增」和操作列", async () => {
  open("/platform/master/cities", "readonly", (call) => (call.url.searchParams.get("limit") === "50" ? page([tokyo]) : null));
  await screen.findByRole("link", { name: "CTY-JP-TYO" });
  assertAbsent(screen.queryByRole("link", { name: "新增城市" }));
  assertAbsent(screen.queryByText("操作"));
  assertAbsent(screen.queryByRole("button", { name: /停用/ }));
});

test("列表的各种状态：加载中、没有数据（有无新增权限）、筛选无结果、加载失败可重试、没有权限", async () => {
  const pending = deferred();
  open("/platform/master/addons", "master_data", (call) => (call.url.pathname === "/platform/v1/master/addons" ? pending.promise : null));
  await screen.findByRole("heading", { level: 1, name: "附加服务" });
  assert.equal(document.querySelector(".table-wrap")?.getAttribute("aria-busy"), "true");
  assert.equal(document.querySelectorAll(".table__skeleton").length > 0, true);
  pending.resolve(page([]));
  assert.ok(await screen.findByRole("heading", { name: "还没有附加服务" }));
  assert.ok(screen.getByText("这里维护附加服务的目录。单价不在这里，由各供应商在自己的商品里设置。"));
  assert.equal(screen.getAllByRole("link", { name: "新增附加服务" }).length, 2);
  resetBrowser();

  open("/platform/master/addons", "readonly", (call) => (call.url.pathname === "/platform/v1/master/addons" ? page([]) : null));
  await screen.findByRole("heading", { name: "还没有附加服务" });
  assertAbsent(screen.queryByRole("link", { name: "新增附加服务" }));
  resetBrowser();

  open("/platform/master/vehicle-groups?q=zzz&grade=luxury", "master_data", (call) => (call.url.pathname === "/platform/v1/master/vehicle-groups" ? page([]) : null));
  assert.ok(await screen.findByRole("heading", { name: "没有符合条件的车型组" }));
  await userEvent.setup().click(within(document.querySelector(".table-wrap") as HTMLElement).getByRole("button", { name: "清空筛选" }));
  assert.ok(await screen.findByRole("heading", { name: "还没有车型组" }));
  resetBrowser();

  let attempts = 0;
  open("/platform/master/vehicle-groups", "master_data", (call) => {
    if (call.url.pathname !== "/platform/v1/master/vehicle-groups") return null;
    attempts += 1;
    return attempts === 1 ? Promise.reject(new TypeError("fetch failed")) : page([group]);
  });
  assert.ok(await screen.findByRole("heading", { name: "加载失败" }));
  await userEvent.setup().click(screen.getByRole("button", { name: "重试" }));
  const row = (await screen.findByRole("link", { name: "VG-BIZ-7" })).closest("tr") as HTMLElement;
  assert.ok(within(row).getByText("商务"));
  assert.ok(within(row).getByText("6 人 4 件"));
  resetBrowser();

  open("/platform/master/cities", "master_data", (call) => (call.url.searchParams.get("limit") === "50" ? apiError(403, "FORBIDDEN", "没有权限") : null));
  assert.ok(await screen.findByRole("heading", { name: "你没有权限查看这里" }));
  assert.ok(sessionStore.get("platform"), "403 不退出登录");
});

test("列表接口返回 401：回登录页；返回 403 PASSWORD_CHANGE_REQUIRED：去修改密码页", async () => {
  open("/platform/master/cities?status=active", "master_data", (call) => (call.url.searchParams.get("limit") === "50" ? apiError(401, "UNAUTHENTICATED", "请先登录") : null));
  assert.ok(await screen.findByText("登录已过期，请重新登录。"));
  assert.equal(sessionStore.get("platform"), null);
  resetBrowser();
  open("/platform/master/cities", "master_data", (call) => (call.url.searchParams.get("limit") === "50" ? apiError(403, "PASSWORD_CHANGE_REQUIRED", "请先修改密码，再继续使用") : null));
  assert.ok(await screen.findByRole("heading", { level: 1, name: "设置新密码" }));
});

test("筛选：关键字停止输入后才查询并写进网址，状态一改就查；翻页用接口给的游标，改条件回第一页", async () => {
  const calls = open("/platform/master/cities", "master_data", (call) => {
    if (call.url.pathname !== "/platform/v1/master/cities" || call.url.searchParams.get("limit") === "200") return null;
    return call.url.searchParams.get("cursor") === "c2" ? page([osaka], 2, null) : page([tokyo], 2, "c2");
  });
  const user = userEvent.setup();
  await screen.findByRole("link", { name: "CTY-JP-TYO" });
  const lists = () => calls.filter((call) => call.path.includes("limit=50")).map((call) => new URL(call.path, "http://x").searchParams);
  assert.equal((screen.getByRole("button", { name: "上一页" }) as HTMLButtonElement).disabled, true);
  await user.click(screen.getByRole("button", { name: "下一页" }));
  await screen.findByRole("link", { name: "CTY-JP-OSA" });
  assert.equal(lists().at(-1)?.get("cursor"), "c2");
  assert.equal((screen.getByRole("button", { name: "下一页" }) as HTMLButtonElement).disabled, true);
  await user.click(screen.getByRole("button", { name: "上一页" }));
  await screen.findByRole("link", { name: "CTY-JP-TYO" });
  assert.equal(lists().at(-1)?.has("cursor"), false);

  await user.type(screen.getByRole("searchbox", { name: "按编码或名称搜索" }), " tyo ");
  await waitFor(() => assert.equal(lists().at(-1)?.get("q"), "tyo"), { timeout: 2000 });
  await user.selectOptions(screen.getByLabelText("状态"), "已停用");
  await waitFor(() => assert.equal(lists().at(-1)?.get("status"), "disabled"));
  assert.equal(lists().at(-1)?.get("q"), "tyo");
  assert.equal(lists().at(-1)?.has("cursor"), false);
});

test("停用：先确认（默认焦点在取消）；成功后这一行留在原地、徽标和操作换掉、焦点到「启用」；启用不用确认", async () => {
  const calls = open("/platform/master/vehicle-groups", "super_admin", (call) => {
    if (call.url.pathname === "/platform/v1/master/vehicle-groups") return page([group]);
    if (call.url.pathname === `/platform/v1/master/vehicle-groups/${GROUP_ID}/disable`) return json(200, { ...group, status: "disabled", version: 3 });
    if (call.url.pathname === `/platform/v1/master/vehicle-groups/${GROUP_ID}/enable`) return json(200, { ...group, version: 4 });
    return null;
  });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "停用 VG-BIZ-7 商务七座" }));
  const dialog = screen.getByRole("dialog", { name: "停用车型组「商务七座」？" });
  assert.ok(within(dialog).getByText("VG-BIZ-7"));
  assert.ok(within(dialog).getByText("停用后，供应商的选项里不再出现这个车型组；已经引用它的内容仍然查得到。之后可以重新启用。"));
  assert.equal(written(calls).length, 0);
  await user.click(within(dialog).getByRole("button", { name: "停用" }));
  const enable = await screen.findByRole("button", { name: "启用 VG-BIZ-7 商务七座" });
  assert.ok(screen.getByText("已停用「商务七座」").closest('[role="status"]'));
  assert.ok(within(enable.closest("tr") as HTMLElement).getByText("已停用"));
  await waitFor(() => assertFocused(enable));
  await user.click(enable);
  await screen.findByRole("button", { name: "停用 VG-BIZ-7 商务七座" });
  assert.ok(screen.getByText("已启用「商务七座」"));
  assert.deepEqual(written(calls).map((call) => call.path), [`/platform/v1/master/vehicle-groups/${GROUP_ID}/disable`, `/platform/v1/master/vehicle-groups/${GROUP_ID}/enable`]);
});

test("停用被保护规则拒绝：对话框不关，说明原因和去处理的链接，去掉「停用」只留「知道了」；网络不通可以直接再试", async () => {
  let attempts = 0;
  open("/platform/master/cities", "master_data", (call) => {
    if (call.url.searchParams.get("limit") === "50") return page([tokyo]);
    if (!call.path.endsWith("/disable")) return null;
    attempts += 1;
    return attempts === 1 ? Promise.reject(new TypeError("fetch failed")) : apiError(409, "MASTER_DATA_IN_USE", "还有启用中的下级", { active_count: 12 });
  });
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "停用 CTY-JP-TYO 东京" }));
  const dialog = screen.getByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "停用" }));
  assert.ok(await within(dialog).findByText("停用没有成功。网络连接失败，请检查网络后重试。"));
  await user.click(within(dialog).getByRole("button", { name: "停用" }));
  assert.ok(await within(dialog).findByText("这个城市下还有 12 个启用中的地点，请先停用它们，再回来停用城市。"));
  assert.equal(within(dialog).getByRole("link", { name: "查看这些地点" }).getAttribute("href"), `/platform/master/places?city=${TOKYO_ID}&status=active`);
  assertAbsent(within(dialog).queryByRole("button", { name: "停用" }));
  assert.ok(within(dialog).getByRole("button", { name: "知道了" }));
  assertAbsent(screen.queryByText(/MASTER_DATA_IN_USE|409/));
});

test("机场页签：待处理提醒、所属城市显示「待指定城市」、没有城市的机场给「指定城市」而不是「启用」；启用被拒说明原因", async () => {
  const withCity: Place = { ...kix, city_id: OSAKA_ID, city: { id: OSAKA_ID, code: "CTY-JP-OSA", name: { zh: "大阪" } } };
  const calls = open("/platform/master/places", "master_data", (call) => {
    if (call.url.pathname === "/platform/v1/master/places") return page([hnd, withCity], 99);
    if (call.path.endsWith(`/${KIX_ID}/enable`)) return apiError(409, "MASTER_DATA_NOT_READY", "还不能启用", { reason: "CITY_DISABLED" });
    return null;
  });
  const user = userEvent.setup();
  const row = (await screen.findByRole("link", { name: "HND" })).closest("tr") as HTMLElement;
  assert.ok(within(row).getByText("待指定城市").closest(".badge--warning"));
  assert.ok(within(row).getByText("OurAirports"));
  assert.equal(within(row).getByRole("link", { name: "指定城市 HND Tokyo Haneda International Airport" }).getAttribute("href"), `/platform/master/places/pending?start=${HND_ID}`);
  assertAbsent(within(row).queryByRole("button", { name: /启用/ }));
  assert.ok(await screen.findByText("有 97 个导入的机场还没有指定城市。"));
  assert.equal(screen.getByRole("link", { name: "去处理" }).getAttribute("href"), "/platform/master/places/pending");
  assert.deepEqual(screen.getAllByRole("tab").map((tab) => `${tab.textContent}:${tab.getAttribute("aria-selected")}`), ["机场:true", "车站:false", "地标:false"]);
  assert.equal(new URL(calls.find((call) => call.path.includes("/master/places?"))?.path ?? "", "http://x").searchParams.get("type"), "airport");
  assert.ok(await within(screen.getByRole("link", { name: "KIX" }).closest("tr") as HTMLElement).findByText("城市已停用"));

  await user.click(screen.getByRole("button", { name: "启用 KIX Kansai International Airport" }));
  assert.ok((await screen.findByText("「KIX Kansai International Airport」所属的城市「大阪」已停用，不能启用。请先启用这个城市。")).closest('[role="alert"]'));
  assert.equal(screen.getByRole("link", { name: "去看这个城市" }).getAttribute("href"), `/platform/master/cities/${OSAKA_ID}`);

  await user.click(screen.getByRole("tab", { name: "车站" }));
  await waitFor(() => assert.equal(new URL(calls.filter((call) => call.path.includes("/master/places?")).at(-1)?.path ?? "", "http://x").searchParams.get("type"), "station"));
  assert.equal(screen.getByRole("link", { name: "新增车站" }).getAttribute("href"), "/platform/master/places/new?type=station");
});

/* ───────────── 新增 / 编辑 ───────────── */

test("新增城市：空着提交逐项报错并汇总；选了国家自动填编码前缀；编码的国家码要和所选国家一致；提交全部字段", async () => {
  const calls = open("/platform/master/cities/new", "master_data", (call) => (call.method === "POST" && call.url.pathname === "/platform/v1/master/cities" ? json(201, tokyo) : null));
  const user = userEvent.setup();
  await screen.findByRole("heading", { level: 1, name: "新增城市" });
  await user.click(screen.getByRole("button", { name: "保存" }));
  assert.ok(screen.getByText("有 5 处需要修改"));
  for (const message of ["请选择国家", "请输入编码", "至少填一种语言", "请选择时区", "请输入纬度", "请输入经度"]) assert.ok(screen.getByText(message), message);
  assert.equal(written(calls).length, 0);

  const country = screen.getByRole("combobox", { name: /国家/ });
  await user.click(country);
  await user.keyboard("jp{Enter}");
  assert.equal((country as HTMLInputElement).value, "日本（JP）");
  const code = screen.getByLabelText(/^编码/) as HTMLInputElement;
  assert.equal(code.value, "CTY-JP-");
  await user.type(code, "tyo");
  assert.equal(code.value, "CTY-JP-TYO", "小写自动转大写");
  await user.clear(code);
  await user.type(code, "CTY-KR-SEL");
  assert.ok(screen.getByText("编码里的国家码 KR 和所选国家 日本（JP） 不一致"));
  await user.clear(code);
  await user.type(code, "CTY-JP-TYO");
  await user.type(screen.getByLabelText("名称 中文"), " 东京 ");
  const zone = screen.getByRole("combobox", { name: /时区/ });
  await user.click(zone);
  await user.keyboard("tokyo{Enter}");
  assert.equal((zone as HTMLInputElement).value, "Asia/Tokyo（UTC+9）");
  await user.click(screen.getByLabelText(/^纬度/));
  await user.paste("139.767125, 35.681236");
  assert.ok(screen.getByText("看起来是经度在前，已自动对调。请核对。"));
  assert.equal((screen.getByLabelText(/^纬度/) as HTMLInputElement).value, "35.681236");
  assertAbsent(screen.queryByText(/处需要修改/));

  await user.click(screen.getByRole("button", { name: "保存" }));
  assert.ok(await screen.findByText("已新增城市「东京」"));
  assert.deepEqual(written(calls)[0]?.body, { code: "CTY-JP-TYO", country_code: "JP", name: { zh: "东京" }, timezone: "Asia/Tokyo", center: { lat: 35.681236, lng: 139.767125 } });
  await screen.findByRole("heading", { level: 1, name: "城市" });
});

test("新增被拒：编码已被使用显示在编码下并全选；后端的校验说明显示在对应字段下；内容都保留", async () => {
  let attempts = 0;
  open("/platform/master/addons/new", "master_data", (call) => {
    if (call.method !== "POST") return null;
    attempts += 1;
    return attempts === 1 ? apiError(409, "CODE_TAKEN", "这个编码已被使用") : apiError(400, "VALIDATION_FAILED", "请求参数校验未通过", { location: "body", issues: [{ path: "/name/zh", message: "名称不能包含控制字符" }] });
  });
  const user = userEvent.setup();
  await screen.findByRole("heading", { level: 1, name: "新增附加服务" });
  const code = screen.getByLabelText(/^编码/) as HTMLInputElement;
  assert.equal(code.value, "ADD-");
  await user.type(code, "child_seat");
  await user.type(screen.getByLabelText("名称 中文"), "儿童座椅");
  await user.click(screen.getByLabelText("接送机"));
  await user.click(screen.getByLabelText(/按个/));
  await user.click(screen.getByRole("button", { name: "保存" }));
  assert.ok(await screen.findByText("这个编码已经被使用，请换一个"));
  assertFocused(code);
  assert.equal(code.value, "ADD-CHILD_SEAT");
  await user.clear(code);
  await user.type(code, "ADD-CHILD_SEAT2");
  await user.click(screen.getByRole("button", { name: "保存" }));
  assert.ok(await screen.findByText("名称不能包含控制字符"));
  assert.equal((screen.getByLabelText("名称 中文") as HTMLInputElement).value, "儿童座椅");
  assertAbsent(screen.queryByText(/VALIDATION_FAILED|请求参数校验未通过/));
});

test("编辑城市：只提交改过的字段，If-Match 带版本号；编码、国家只读；什么都没改不发请求", async () => {
  const calls = open(`/platform/master/cities/${TOKYO_ID}`, "master_data", (call) => {
    if (call.url.pathname !== `/platform/v1/master/cities/${TOKYO_ID}`) return null;
    return call.method === "GET" ? json(200, tokyo) : json(200, { ...tokyo, version: 4 });
  });
  const user = userEvent.setup();
  const japanese = (await screen.findByLabelText("名称 日语")) as HTMLInputElement;
  assert.equal(screen.getByRole("heading", { level: 1 }).textContent, "东京");
  assert.equal(document.title, "东京 · 城市 · NOZOMI 运营后台");
  assert.equal((screen.getByLabelText(/^编码/) as HTMLInputElement).readOnly, true);
  assert.ok(screen.getByText("编码创建后不能修改。"));
  assert.ok(screen.getByText("未设置"));
  assertAbsent(screen.queryByRole("combobox", { name: /国家/ }));
  assert.ok(screen.getByText(/^最近修改 2026-01-0\d \d\d:04$/));

  await user.clear(japanese);
  await user.type(japanese, "東京都");
  await user.click(screen.getByRole("button", { name: "保存" }));
  assert.ok(await screen.findByText("已保存「东京」"));
  const patch = written(calls)[0];
  assert.equal(patch?.method, "PATCH");
  assert.deepEqual(patch?.body, { name: { zh: "东京", ja: "東京都", en: "Tokyo" } }, "名称整体替换，别的字段不带");
  assert.equal(patch?.headers["if-match"], '"3"');
  resetBrowser();

  const untouched = open(`/platform/master/cities/${TOKYO_ID}`, "master_data", (call) => (call.url.pathname === `/platform/v1/master/cities/${TOKYO_ID}` && call.method === "GET" ? json(200, tokyo) : null));
  await screen.findByLabelText("名称 日语");
  await user.click(screen.getByRole("button", { name: "保存" }));
  await screen.findByRole("heading", { level: 1, name: "城市" });
  assert.equal(written(untouched).length, 0);
  assertAbsent(screen.queryByText(/已保存/));
});

test("别人先改了（VERSION_CONFLICT）：提示先载入最新内容，保存禁用，表单保持原样；载入后换成最新的值和版本号", async () => {
  let loads = 0;
  const calls = open(`/platform/master/vehicle-groups/${GROUP_ID}`, "master_data", (call) => {
    if (call.url.pathname !== `/platform/v1/master/vehicle-groups/${GROUP_ID}`) return null;
    if (call.method === "GET") {
      loads += 1;
      return json(200, loads === 1 ? group : { ...group, name: { zh: "商务七座（新）" }, version: 9 });
    }
    return call.headers["if-match"] === '"9"' ? json(200, { ...group, version: 10 }) : apiError(409, "VERSION_CONFLICT", "版本不是最新的", { current_version: 9 });
  });
  const user = userEvent.setup();
  const name = (await screen.findByLabelText("名称 中文")) as HTMLInputElement;
  assert.ok(screen.getByText("创建后不能修改。要换等级，请新增一个车型组，再停用这个。"));
  await user.type(name, "改");
  await user.click(screen.getByRole("button", { name: "保存" }));
  assert.ok((await screen.findByText("这条记录刚被别人修改过，你的修改还没有保存。")).closest('[role="alert"]'));
  assert.equal((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled, true);
  assert.ok(screen.getByText("请先载入最新内容"));
  assert.equal(name.value, "商务七座改", "点载入之前表单保持原样");
  await user.click(screen.getByRole("button", { name: "载入最新内容" }));
  assert.ok(await screen.findByText("已载入最新内容。"));
  assert.equal((screen.getByLabelText("名称 中文") as HTMLInputElement).value, "商务七座（新）");
  await user.type(screen.getByLabelText("名称 中文"), "！");
  await user.click(screen.getByRole("button", { name: "保存" }));
  assert.ok(await screen.findByText(/^已保存/));
  assert.deepEqual(written(calls).map((call) => call.headers["if-match"]), ['"3"'.replace("3", "2"), '"9"']);
  assertAbsent(screen.queryByText(/VERSION_CONFLICT|版本/));
});

test("保存时的其他拒绝：同时修改可以直接再试；没有权限后保存禁用；记录不存在；网络不通——内容都保留", async () => {
  const responses: (() => Response | Promise<Response>)[] = [
    () => apiError(409, "CONCURRENT_UPDATE", "并发冲突"),
    () => Promise.reject(new TypeError("fetch failed")),
    () => apiError(500, "INTERNAL_ERROR", "服务器内部错误"),
    () => apiError(409, "FIELD_LOCKED", "不能修改", { fields: ["code", "seats"] }),
    () => apiError(403, "FORBIDDEN", "没有权限"),
  ];
  const texts = ["同时有其他人在修改相关的数据，这次没有保存成功。请再点一次保存。", "网络连接失败，请检查网络后重试。你填写的内容还在。", "系统暂时无法保存，请稍后再试。你填写的内容还在。", "编码、座位数创建后不能修改。请刷新页面后重试。", "你没有权限修改主数据。需要的话，请联系管理员开通。"];
  let attempt = 0;
  open(`/platform/master/vehicle-groups/${GROUP_ID}`, "master_data", (call) => {
    if (call.url.pathname !== `/platform/v1/master/vehicle-groups/${GROUP_ID}`) return null;
    if (call.method === "GET") return json(200, group);
    attempt += 1;
    return responses[attempt - 1]?.() ?? null;
  });
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("名称 中文"), "改");
  for (const text of texts) {
    await user.click(screen.getByRole("button", { name: "保存" }));
    assert.ok((await screen.findByText(text)).closest('[role="alert"]'), text);
    assert.equal((screen.getByLabelText("名称 中文") as HTMLInputElement).value, "商务七座改");
  }
  assert.equal((screen.getByRole("button", { name: "保存" }) as HTMLButtonElement).disabled, true);
  assert.ok(screen.getByText("没有修改权限"));
  assertAbsent(screen.queryByText(/INTERNAL|FORBIDDEN|CONCURRENT|500|403/));
});

test("只读角色打开编辑页：字段只读、没有保存和停用，只有「回到列表」；打开新增页显示没有权限；不存在的记录显示找不到", async () => {
  open(`/platform/master/vehicle-groups/${GROUP_ID}`, "finance", (call) => (call.url.pathname === `/platform/v1/master/vehicle-groups/${GROUP_ID}` ? json(200, group) : null));
  assert.ok(await screen.findByText("你可以查看主数据，但不能修改。需要修改的话，请联系管理员开通。"));
  assert.equal(document.querySelectorAll("form input:not([readonly])").length, 0);
  assert.ok(screen.getByText("6 人 4 件"));
  assert.ok(screen.getByText("丰田埃尔法"));
  assertAbsent(screen.queryByRole("button", { name: "保存" }));
  assertAbsent(screen.queryByRole("button", { name: "停用" }));
  assertAbsent(screen.queryByRole("button", { name: /添加/ }));
  assert.equal(screen.getByRole("link", { name: "回到列表" }).getAttribute("href"), "/platform/master/vehicle-groups");
  resetBrowser();

  open("/platform/master/cities/new", "finance");
  assert.ok(await screen.findByRole("heading", { name: "你没有权限查看这里" }));
  resetBrowser();

  open(`/platform/master/addons/${GROUP_ID}`, "master_data", (call) => (call.url.pathname.startsWith("/platform/v1/master/addons/") ? apiError(404, "NOT_FOUND", "资源不存在") : null));
  assert.ok(await screen.findByRole("heading", { name: "找不到这个附加服务" }));
  assert.equal(screen.getByRole("link", { name: "回到附加服务列表" }).getAttribute("href"), "/platform/master/addons");
});

test("新增车型组：等级和座位数填了自动给出编码，手工改过后不再覆盖；组合的各种错误写明哪一行、怎么错", async () => {
  const calls = open("/platform/master/vehicle-groups/new", "master_data", (call) => (call.method === "POST" ? json(201, group) : null));
  const user = userEvent.setup();
  await screen.findByRole("heading", { level: 1, name: "新增车型组" });
  await user.click(screen.getByLabelText("商务"));
  await user.type(screen.getByLabelText(/^座位数/), "7");
  const code = screen.getByLabelText(/^编码/) as HTMLInputElement;
  assert.equal(code.value, "VG-BIZ-7");
  await user.click(screen.getByLabelText("豪华"));
  assert.equal(code.value, "VG-LUX-7");
  await user.clear(code);
  await user.type(code, "VG-ECO-7");
  await user.click(screen.getByLabelText("商务"));
  assert.equal(code.value, "VG-ECO-7", "手工改过的不再跟着变");
  await user.type(screen.getByLabelText("名称 中文"), "商务七座");
  await user.click(screen.getByLabelText("燃油"));
  await user.type(screen.getByLabelText("第 1 个组合的人数"), "8");
  await user.type(screen.getByLabelText("第 1 个组合的行李数"), "4");
  await user.click(screen.getByRole("button", { name: "添加组合" }));
  assertFocused(screen.getByLabelText("第 2 个组合的人数"));
  await user.type(screen.getByLabelText("第 2 个组合的人数"), "6");
  await user.type(screen.getByLabelText("第 2 个组合的行李数"), "100");
  await user.click(screen.getByRole("button", { name: "保存" }));
  assert.ok(screen.getByText("编码里的 ECO 是「经济」的缩写，和所选等级「商务」不一致。「商务」的缩写是 BIZ"));
  assert.ok(screen.getByText("人数不能超过座位数（7 座）"));
  assert.ok(screen.getByText("行李数要填 0 到 99 的整数"));
  assert.equal(written(calls).length, 0);

  await user.clear(code);
  await user.type(code, "VG-BIZEV-7");
  await user.clear(screen.getByLabelText("第 1 个组合的人数"));
  await user.type(screen.getByLabelText("第 1 个组合的人数"), "6");
  await user.clear(screen.getByLabelText("第 2 个组合的行李数"));
  await user.type(screen.getByLabelText("第 2 个组合的行李数"), "4");
  assert.ok(screen.getByText("和第 1 个组合重复"));
  await user.click(screen.getByRole("button", { name: "删除第 2 个组合" }));
  assert.equal((screen.getByRole("button", { name: "删除第 1 个组合" }) as HTMLButtonElement).disabled, true, "至少保留一个");
  await user.click(screen.getByRole("button", { name: "保存并继续新增" }));
  assert.ok(await screen.findByText("已新增车型组「商务七座」"));
  assert.deepEqual(written(calls)[0]?.body, { code: "VG-BIZEV-7", grade: "business", seats: 7, name: { zh: "商务七座" }, sample_models: [], power: "fuel", combos: [{ passengers: 6, luggage: 4 }] });
  assert.equal((screen.getByLabelText("名称 中文") as HTMLInputElement).value, "", "继续新增：清空");
  assert.equal((screen.getByLabelText("商务") as HTMLInputElement).checked, true, "继续新增：保留等级");
  assert.ok(screen.getByRole("heading", { level: 1, name: "新增车型组" }));
});

test("导入的机场的编辑页：有数据来源；改了英语名立即提示不再随导入更新；有航站楼小表格", async () => {
  const withCity: Place = { ...hnd, city_id: TOKYO_ID, city: { id: TOKYO_ID, code: "CTY-JP-TYO", name: tokyo.name }, status: "active" };
  const terminal: Place = { ...hnd, id: KIX_ID, type: "terminal", code: "HND-T3", name: { zh: "第 3 航站楼" }, parent_id: HND_ID, source: null, status: "active", flight_scope: "international" };
  open(`/platform/master/places/${HND_ID}`, "master_data", (call) => {
    if (call.url.pathname === `/platform/v1/master/places/${HND_ID}`) return json(200, withCity);
    if (call.url.pathname === "/platform/v1/master/places" && call.url.searchParams.get("parent_id") === HND_ID) return page([terminal]);
    return null;
  });
  const english = (await screen.findByLabelText("名称 英语")) as HTMLInputElement;
  assert.ok(screen.getByText("英语名和坐标来自 OurAirports，再次导入时会随数据源更新。"));
  assert.ok(screen.getByText("2434"));
  assert.equal(screen.getAllByText("来自 OurAirports。").length, 2);
  await userEvent.setup().type(english, " (Haneda)");
  assert.ok(screen.getByText("保存后，这个机场的英语名和坐标不再随 OurAirports 更新。"));
  const row = (await screen.findByRole("link", { name: "HND-T3" })).closest("tr") as HTMLElement;
  assert.ok(within(row).getByText("国际"));
  assert.ok(within(row).getByText("35.552258, 139.779694"));
  assert.equal(screen.getByRole("link", { name: "新增航站楼" }).getAttribute("href"), `/platform/master/places/new?type=terminal&parent=${HND_ID}`);
});

/* ───────────── 处理导入的机场 ───────────── */

function pendingRoutes(extra: Route = () => null): Route {
  return (call) => {
    const custom = extra(call);
    if (custom !== null) return custom;
    if (call.method === "GET" && call.url.pathname === "/platform/v1/master/places" && call.url.searchParams.get("city_id") === "none") return page([hnd, kix], 97);
    return null;
  };
}

test("处理导入的机场：只用键盘选城市、按 Enter 就指定城市并启用（一次请求），自动换下一个、焦点回到所属城市", async () => {
  const calls = open("/platform/master/places/pending", "master_data", pendingRoutes((call) => (call.path.endsWith(`/${HND_ID}/enable`) ? json(200, { ...hnd, city_id: TOKYO_ID, status: "active", version: 2 }) : null)));
  const user = userEvent.setup();
  assert.ok(await screen.findByRole("heading", { level: 2, name: "Tokyo Haneda International Airport" }));
  assert.ok(screen.getByText("还剩 97 个"));
  assert.ok(screen.getByText("35.552258, 139.779694"));
  assert.ok(screen.getByText("只能选日本（JP）的启用中的城市。"));
  const query = new URL(calls.find((call) => call.path.includes("city_id=none"))?.path ?? "", "http://x").searchParams;
  assert.equal(query.get("type"), "airport");
  assert.equal(query.get("limit"), "200");

  const city = screen.getByRole("combobox", { name: /所属城市/ });
  await user.click(city);
  assert.deepEqual(within(screen.getByRole("listbox", { name: "所属城市" })).getAllByRole("option").map((option) => option.textContent), ["东京CTY-JP-TYO"], "已停用的大阪不在选项里");
  await user.keyboard("tyo{ArrowDown}{Enter}");
  assert.equal((city as HTMLInputElement).value, "东京");
  await user.keyboard("{Enter}");
  assert.ok(await screen.findByRole("heading", { level: 2, name: "Kansai International Airport" }));
  assert.ok(screen.getByText("已启用「HND Tokyo Haneda Int…」"));
  assert.deepEqual(written(calls).map((call) => [call.method, call.path, call.body]), [["POST", `/platform/v1/master/places/${HND_ID}/enable`, { city_id: TOKYO_ID }]]);
  assert.ok(screen.getByText("还剩 96 个"));
  assert.equal((screen.getByRole("combobox", { name: /所属城市/ }) as HTMLInputElement).value, "", "不沿用上一个机场选的城市");
  await waitFor(() => assertFocused(screen.getByRole("combobox", { name: /所属城市/ })));
  const done = screen.getByRole("heading", { name: "本次已处理" }).parentElement as HTMLElement;
  assert.ok(within(done).getByText("→ 东京"));
  assert.equal(within(done).getByRole("link", { name: "编辑 HND" }).getAttribute("href"), `/platform/master/places/${HND_ID}`);
  assert.ok(screen.getByText("下一个：KIX Kansai International Airport，还剩 96 个").closest('[role="status"]'));
});

test("处理导入的机场：没选城市不能提交；顺手补了中文名时先保存再启用；启用没成功可以再试或先处理下一个", async () => {
  let enables = 0;
  const calls = open("/platform/master/places/pending", "super_admin", pendingRoutes((call) => {
    if (call.method === "PATCH" && call.url.pathname === `/platform/v1/master/places/${HND_ID}`) return json(200, { ...hnd, city_id: TOKYO_ID, name: { ...hnd.name, zh: "羽田机场" }, version: 2 });
    if (call.path.endsWith(`/${HND_ID}/enable`)) {
      enables += 1;
      return enables === 1 ? apiError(409, "MASTER_DATA_NOT_READY", "还不能启用", { reason: "CITY_DISABLED" }) : json(200, { ...hnd, city_id: TOKYO_ID, status: "active", version: 3 });
    }
    return null;
  }));
  const user = userEvent.setup();
  await screen.findByRole("heading", { level: 2, name: "Tokyo Haneda International Airport" });
  await user.click(screen.getByRole("button", { name: "保存并启用" }));
  assert.ok(screen.getByText("请选择所属城市"));
  assert.equal(written(calls).length, 0);
  await user.click(screen.getByRole("combobox", { name: /所属城市/ }));
  await user.click(screen.getByRole("option", { name: /东京/ }));
  await user.type(screen.getByLabelText("名称 中文"), "羽田机场");
  await user.click(screen.getByRole("button", { name: "保存并启用" }));
  assert.ok(await screen.findByText("城市已经指定好了，但还没有启用：所属城市已停用，请先启用城市"));
  const patch = written(calls)[0];
  assert.deepEqual(patch?.body, { city_id: TOKYO_ID, name: { zh: "羽田机场", en: "Tokyo Haneda International Airport" } });
  assert.equal(patch?.headers["if-match"], '"1"');
  assert.equal((screen.getByRole("button", { name: "保存并启用" }) as HTMLButtonElement).disabled, true);
  await user.click(screen.getByRole("button", { name: "再试一次启用" }));
  assert.ok(await screen.findByRole("heading", { level: 2, name: "Kansai International Airport" }));
  assert.equal(written(calls).at(-1)?.body, undefined, "已经保存过城市，启用时不再带 city_id");
});

test("处理导入的机场：跳过排到队尾并标记；只保存不启用；别人刚处理过的自动换下一个", async () => {
  const calls = open(`/platform/master/places/pending?start=${KIX_ID}`, "master_data", pendingRoutes((call) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/master/places/${KIX_ID}`) return written(callsRef.current).length === 0 ? json(200, kix) : json(200, { ...kix, city_id: TOKYO_ID, version: 5 });
    if (call.method === "PATCH" && call.url.pathname === `/platform/v1/master/places/${HND_ID}`) return json(200, { ...hnd, city_id: TOKYO_ID, version: 2 });
    if (call.method === "PATCH" && call.url.pathname === `/platform/v1/master/places/${KIX_ID}`) return apiError(409, "VERSION_CONFLICT", "版本不是最新的", { current_version: 5 });
    return null;
  }));
  const callsRef = { current: calls };
  const user = userEvent.setup();
  assert.ok(await screen.findByRole("heading", { level: 2, name: "Kansai International Airport" }), "带 start 进来的排在队首");
  await user.click(screen.getByRole("button", { name: "跳过" }));
  assert.ok(await screen.findByRole("heading", { level: 2, name: "Tokyo Haneda International Airport" }));
  assert.ok(screen.getByText("还剩 97 个"), "跳过的不减");
  await user.click(screen.getByRole("combobox", { name: /所属城市/ }));
  await user.click(screen.getByRole("option", { name: /东京/ }));
  await user.click(screen.getByRole("button", { name: "只保存，先不启用" }));
  assert.ok(await screen.findByText("已保存「HND Tokyo Haneda Int…」，还没有启用"));
  assert.ok(await screen.findByRole("heading", { level: 2, name: "Kansai International Airport" }));
  assert.ok(screen.getByText("跳过过"));
  assert.deepEqual(written(calls)[0]?.body, { city_id: TOKYO_ID });
  await user.click(screen.getByRole("combobox", { name: /所属城市/ }));
  assert.ok(within(screen.getByRole("listbox", { name: "所属城市" })).getByText("最近用过"));
  await user.click(screen.getByRole("option", { name: /东京/ }));
  await user.click(screen.getByRole("button", { name: "只保存，先不启用" }));
  assert.ok(await screen.findByRole("heading", { name: "没有待指定城市的机场了" }));
  assert.ok(screen.getByText("这一批都处理完了。"));
});

test("处理导入的机场：没有修改权限的人进不去；一个都没有时是空状态；加载失败可以重试", async () => {
  const blocked = open("/platform/master/places/pending", "finance");
  assert.ok(await screen.findByRole("heading", { name: "你没有权限查看这里" }));
  assert.equal(blocked.filter((call) => call.path.includes("city_id=none")).length, 0);
  resetBrowser();

  open("/platform/master/places/pending", "master_data", (call) => (call.url.searchParams.get("city_id") === "none" ? page([]) : null));
  assert.ok(await screen.findByRole("heading", { name: "没有待指定城市的机场了" }));
  assert.ok(screen.getByText("导入新的机场后，会出现在这里。"));
  resetBrowser();

  let attempts = 0;
  open("/platform/master/places/pending", "master_data", (call) => {
    if (call.url.searchParams.get("city_id") !== "none") return null;
    attempts += 1;
    return attempts === 1 ? apiError(500, "INTERNAL_ERROR", "服务器内部错误") : page([hnd], 1);
  });
  assert.ok(await screen.findByRole("heading", { name: "加载失败" }));
  await userEvent.setup().click(screen.getByRole("button", { name: "重试" }));
  assert.ok(await screen.findByRole("heading", { level: 2, name: "Tokyo Haneda International Airport" }));
});

test("处理导入的机场：这个国家还没有启用中的城市时提示先新增；在对话框里新增城市后已经选好，焦点到「保存并启用」", async () => {
  const seoul: City = { ...tokyo, id: KIX_ID, code: "CTY-KR-SEL", country_code: "KR", name: { zh: "首尔" }, timezone: "Asia/Seoul" };
  const icn: Place = { ...hnd, id: GROUP_ID, code: "ICN", country_code: "KR", name: { en: "Incheon International Airport" }, location: { lng: 126.450996, lat: 37.469101 } };
  const calls = open("/platform/master/places/pending", "master_data", (call) => {
    if (call.url.searchParams.get("city_id") === "none") return page([icn], 1);
    if (call.method === "POST" && call.url.pathname === "/platform/v1/master/cities") return json(201, seoul);
    return null;
  });
  const user = userEvent.setup();
  await screen.findByRole("heading", { level: 2, name: "Incheon International Airport" });
  assert.ok(await screen.findByText("还没有韩国（KR）的启用中的城市。请先新增城市。"));
  assert.equal((screen.getByRole("button", { name: "保存并启用" }) as HTMLButtonElement).disabled, true);
  await user.click(screen.getByRole("button", { name: "新增城市" }));
  const dialog = screen.getByRole("dialog", { name: "新增城市" });
  assert.ok(within(dialog).getByText("韩国（KR）"));
  const code = within(dialog).getByLabelText(/^编码/) as HTMLInputElement;
  assert.equal(code.value, "CTY-KR-");
  await user.type(code, "SEL");
  await user.type(within(dialog).getByLabelText("名称 中文"), "首尔");
  await user.click(within(dialog).getByRole("combobox", { name: /时区/ }));
  await user.keyboard("seoul{Enter}");
  await user.click(within(dialog).getByRole("button", { name: "填入这个机场的坐标" }));
  assert.equal((within(dialog).getByLabelText(/^纬度/) as HTMLInputElement).value, "37.469101");
  await user.click(within(dialog).getByRole("button", { name: "新增城市" }));
  assert.ok(await screen.findByText("已新增城市「首尔」"));
  assertAbsent(screen.queryByRole("dialog", { name: "新增城市" }));
  assert.equal((screen.getByRole("combobox", { name: /所属城市/ }) as HTMLInputElement).value, "首尔");
  assert.deepEqual(written(calls)[0]?.body, { code: "CTY-KR-SEL", country_code: "KR", name: { zh: "首尔" }, timezone: "Asia/Seoul", center: { lat: 37.469101, lng: 126.450996 } });
  await waitFor(() => assertFocused(screen.getByRole("button", { name: "保存并启用" })));
});
