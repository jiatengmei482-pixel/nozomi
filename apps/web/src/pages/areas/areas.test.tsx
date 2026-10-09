/**
 * 供应商后台「区域」的组件测试：首页入口、列表、新增 / 编辑、粘贴、自测、停用 / 启用 / 删除。
 * 接口用测试替身；底图配置一律是「没有配置」（tiles: null），所以这里不建地图——地图上的操作由端到端测试在真实浏览器里做。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { Area, AreaPolygon, AreaSummary } from "../../api/areas.ts";
import type { City } from "../../api/master.ts";
import { type ApiCall, apiError, assertAbsent, assertFocused, deferred, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T03:04:00.000Z" };
const TOKYO_ID = "11111111-1111-4111-8111-111111111111";
const AREA_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OPERATE_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FORBID_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

const tokyo: City = { id: TOKYO_ID, code: "CTY-JP-TYO", country_code: "JP", name: { zh: "东京", ja: "東京" }, timezone: "Asia/Tokyo", center: { lng: 139.7, lat: 35.7 }, boundary: null, status: "active", version: 3, ...stamps };
const areaCity = { id: TOKYO_ID, code: tokyo.code, name: tokyo.name, status: "active" as const, center: tokyo.center, boundary: null };
const closed = (ring: [number, number][]): [number, number][][] => [[...ring, ring[0] as [number, number]]];
const OUTER: [number, number][] = [
  [139.6, 35.6],
  [139.8, 35.6],
  [139.8, 35.8],
  [139.6, 35.8],
];
const INNER: [number, number][] = [
  [139.68, 35.68],
  [139.72, 35.68],
  [139.72, 35.72],
  [139.68, 35.72],
];
const operate: AreaPolygon = { id: OPERATE_ID, kind: "operate", seq: 1, label: null, source: "drawn", circle: null, geometry: { type: "Polygon", coordinates: closed(OUTER) } };
const forbid: AreaPolygon = { id: FORBID_ID, kind: "forbid", seq: 1, label: "皇居", source: "pasted", circle: null, geometry: { type: "Polygon", coordinates: closed(INNER) } };
const summaryOf = (overrides: Partial<AreaSummary> = {}): AreaSummary => ({ id: AREA_ID, name: { zh: "东京 23 区" }, city_id: TOKYO_ID, city: areaCity, biz_type: "general", status: "active", operate_polygon_count: 1, forbid_polygon_count: 1, usage: { product_count: 0, published_product_count: 0 }, version: 4, ...stamps, ...overrides });
const areaOf = (overrides: Partial<Area> = {}): Area => ({ ...summaryOf(), polygons: [operate, forbid], ...overrides });

const me = (role: string) => json(200, { user: { id: "u1", email: "user@supplier.example", name: "测试用户", role, status: "active", ...stamps }, tenant: { id: "t1", name: "测试用供应商", status: "active", ...stamps }, permissions: [], must_change_password: false });
const page = <T,>(items: T[], total = items.length, next: string | null = null) => json(200, { items, next_cursor: next, total });

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;

/** 登录成指定角色并渲染；`routes` 没接住的接口里，auth/me、首页数量、城市清单、底图配置（没有配置）有默认应答。 */
function open(path: string, role: string, routes: Route = () => null): ApiCall[] {
  signIn("tenant", "tenant-token");
  const calls = stubApiWith((call) => {
    const custom = routes(call);
    if (custom !== null) return custom;
    if (call.url.pathname === "/tenant/v1/auth/me") return me(role);
    if (call.url.pathname === "/tenant/v1/dashboard/summary") return json(200, { areas: { active: 2, disabled: 1 } });
    if (call.method === "GET" && call.url.pathname === "/tenant/v1/master/cities") return page([tokyo]);
    if (call.url.pathname === "/tenant/v1/map/config") return json(200, { tiles: null });
    return null;
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  return calls;
}

const writes = (calls: ApiCall[]): ApiCall[] => calls.filter((call) => call.method !== "GET");
const saveButton = (): HTMLElement => screen.getByRole("button", { name: "保存" });

async function chooseTokyo(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const box = await screen.findByRole("combobox", { name: /城市/ });
  await user.click(box);
  await user.click(await screen.findByRole("option", { name: /东京/ }));
}

/** 在「图形」里逐点输入一块营运区（三个点）。 */
async function addTriangle(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole("button", { name: /^添加营运区/ }));
  await user.click(screen.getByRole("menuitem", { name: "逐点输入坐标" }));
  for (const [index, point] of OUTER.slice(0, 3).entries()) {
    await user.type(screen.getByLabelText(`营运 1 第 ${index + 1} 个点的纬度`), String(point[1]));
    await user.type(screen.getByLabelText(`营运 1 第 ${index + 1} 个点的经度`), String(point[0]));
  }
}

// ───────────── 首页 ─────────────

test("首页：区域卡片的数量来自 dashboard/summary；菜单里有「区域」；有区域时没有提醒", async () => {
  const calls = open("/", "admin");
  await waitFor(() => assert.match(document.querySelector(".entry-card")?.textContent ?? "", /启用2.*已停用1/));
  assert.equal(document.querySelector(".entry-card a")?.getAttribute("href"), "/areas");
  assert.equal(calls.find((call) => call.path === "/tenant/v1/dashboard/summary")?.headers["authorization"], "Bearer tenant-token");
  assert.ok(within(screen.getByRole("navigation", { name: "主菜单" })).getByRole("link", { name: "区域" }));
  assertAbsent(screen.queryByText("还没有区域，先建一个"));
});

test("首页：一个区域都没有时，能修改的人看到「还没有区域，先建一个」；只读角色没有这条提醒", async () => {
  const empty: Route = (call) => (call.url.pathname === "/tenant/v1/dashboard/summary" ? json(200, { areas: { active: 0, disabled: 0 } }) : null);
  open("/", "pricing", empty);
  const reminder = await screen.findByRole("link", { name: "还没有区域，先建一个" });
  assert.equal(reminder.getAttribute("href"), "/areas/new");
  resetBrowser();
  open("/", "readonly", empty);
  await waitFor(() => assert.match(document.querySelector(".entry-card")?.textContent ?? "", /启用0/));
  assertAbsent(screen.queryByText("还没有区域，先建一个"));
});

test("首页：数量取不到时入口照常可用，有「重试」；不能看区域的角色不请求数量、菜单里也没有「区域」", async () => {
  let attempts = 0;
  const user = userEvent.setup();
  open("/", "admin", (call) => {
    if (call.url.pathname !== "/tenant/v1/dashboard/summary") return null;
    attempts += 1;
    return attempts === 1 ? Promise.reject(new TypeError("fetch failed")) : json(200, { areas: { active: 5, disabled: 0 } });
  });
  await waitFor(() => assert.ok(screen.getAllByText("数量没有加载出来").length > 0));
  assert.equal(document.querySelector(".entry-card a")?.getAttribute("href"), "/areas");
  await user.click(screen.getByRole("button", { name: "重试" }));
  await waitFor(() => assert.match(document.querySelector(".entry-card")?.textContent ?? "", /启用5/));
  assertAbsent(screen.queryByText("数量没有加载出来"));

  resetBrowser();
  const calls = open("/", "dispatch");
  await screen.findByText("这里暂时没有你可以使用的模块");
  assert.equal(calls.some((call) => call.path.includes("dashboard/summary")), false);
  assertAbsent(within(screen.getByRole("navigation", { name: "主菜单" })).queryByRole("link", { name: "区域" }));
});

// ───────────── 列表 ─────────────

test("列表：加载中是骨架；有数据时显示名称、城市、业务类型、块数、状态；筛选条件写进请求", async () => {
  const pending = deferred();
  const calls = open("/areas?status=disabled&biz=charter&q=%E6%9C%BA%E5%9C%BA", "admin", (call) => (call.method === "GET" && call.url.pathname === "/tenant/v1/areas" ? pending.promise : null));
  await screen.findByRole("heading", { level: 1, name: "区域" });
  await waitFor(() => assert.ok(calls.some((call) => call.path.startsWith("/tenant/v1/areas?"))));
  assert.ok(document.querySelector(".table__skeleton"));
  const query = new URL(calls.find((call) => call.path.startsWith("/tenant/v1/areas?"))?.path ?? "", "http://localhost").searchParams;
  assert.equal(query.get("status"), "disabled");
  assert.equal(query.get("biz_type"), "charter");
  assert.equal(query.get("q"), "机场");
  pending.resolve(page([summaryOf({ status: "disabled", biz_type: "charter", name: { zh: "成田机场周边" }, operate_polygon_count: 3, forbid_polygon_count: 0 })]));
  const row = (await screen.findByRole("link", { name: "成田机场周边" })).closest("tr") as HTMLElement;
  assert.equal(within(row).getByRole("link", { name: "成田机场周边" }).getAttribute("href"), `/areas/${AREA_ID}`);
  for (const text of ["东京", "包车", "3", "已停用"]) assert.ok(row.textContent?.includes(text), `行里应该有「${text}」`);
});

test("列表：一个区域都没有时说明区域是什么并给出「新增区域」；筛选后没有结果时给「清空筛选」；取不到时给「重试」", async () => {
  const user = userEvent.setup();
  open("/areas", "admin", (call) => (call.method === "GET" && call.url.pathname === "/tenant/v1/areas" ? page([]) : null));
  await screen.findByText("还没有区域");
  assert.ok(screen.getAllByRole("link", { name: "新增区域" }).every((link) => link.getAttribute("href") === "/areas/new"));

  resetBrowser();
  open("/areas?status=disabled", "admin", (call) => (call.method === "GET" && call.url.pathname === "/tenant/v1/areas" ? page([]) : null));
  await screen.findByText("没有符合条件的区域");
  assert.ok(screen.getAllByRole("button", { name: "清空筛选" }).length > 0);

  resetBrowser();
  let attempts = 0;
  open("/areas", "admin", (call) => {
    if (call.method !== "GET" || call.url.pathname !== "/tenant/v1/areas") return null;
    attempts += 1;
    return attempts === 1 ? Promise.reject(new TypeError("fetch failed")) : page([summaryOf()]);
  });
  await user.click(await screen.findByRole("button", { name: "重试" }));
  await screen.findByRole("link", { name: "东京 23 区" });
});

test("列表：只读角色没有「新增区域」和「更多」；不能看区域的角色看到没有权限，不请求列表", async () => {
  open("/areas", "readonly", (call) => (call.method === "GET" && call.url.pathname === "/tenant/v1/areas" ? page([summaryOf()]) : null));
  await screen.findByRole("link", { name: "东京 23 区" });
  assertAbsent(screen.queryByRole("link", { name: "新增区域" }));
  assertAbsent(screen.queryByRole("button", { name: /更多操作/ }));

  resetBrowser();
  const calls = open("/areas", "finance");
  await screen.findByText("你没有权限查看这里");
  assert.equal(calls.some((call) => call.path.startsWith("/tenant/v1/areas")), false);
});

test("列表：停用要在页面里确认，确认后才请求；启用不用确认；删除要确认并说明不能恢复", async () => {
  const user = userEvent.setup();
  let current = summaryOf();
  let removed = false;
  const calls = open("/areas", "admin", (call) => {
    if (call.method === "GET" && call.url.pathname === "/tenant/v1/areas") return page(removed ? [] : [current]);
    if (call.method === "POST" && call.path === `/tenant/v1/areas/${AREA_ID}/disable`) return json(200, (current = { ...current, status: "disabled", version: 5 }));
    if (call.method === "POST" && call.path === `/tenant/v1/areas/${AREA_ID}/enable`) return json(200, (current = { ...current, status: "active", version: 6 }));
    if (call.method === "DELETE" && call.path === `/tenant/v1/areas/${AREA_ID}`) {
      removed = true;
      return new Response(null, { status: 204 });
    }
    return null;
  });
  await user.click(await screen.findByRole("button", { name: "东京 23 区 的更多操作" }));
  await user.click(screen.getByRole("menuitem", { name: "停用" }));
  const confirm = await screen.findByRole("dialog", { name: "停用区域「东京 23 区」？" });
  assert.equal(writes(calls).length, 0, "确认之前不能发请求");
  assert.match(confirm.textContent ?? "", /之后可以重新启用/);
  await user.click(within(confirm).getByRole("button", { name: "停用" }));
  await screen.findByText("已停用「东京 23 区」");
  await waitFor(() => assert.ok((screen.getByRole("link", { name: "东京 23 区" }).closest("tr") as HTMLElement).textContent?.includes("已停用")));

  await user.click(screen.getByRole("button", { name: "东京 23 区 的更多操作" }));
  await user.click(screen.getByRole("menuitem", { name: "启用" }));
  await screen.findByText("已启用「东京 23 区」");
  assertAbsent(screen.queryByRole("dialog"));

  await user.click(screen.getByRole("button", { name: "东京 23 区 的更多操作" }));
  await user.click(screen.getByRole("menuitem", { name: "删除" }));
  const remove = await screen.findByRole("dialog", { name: "删除区域「东京 23 区」？" });
  assert.match(remove.textContent ?? "", /删除后不能恢复/);
  assert.match(remove.textContent ?? "", /1 块营运区、1 块禁行区/);
  await user.click(within(remove).getByRole("button", { name: "删除" }));
  await screen.findByText("已删除区域「东京 23 区」");
  assert.deepEqual(writes(calls).map((call) => `${call.method} ${call.path}`), [`POST /tenant/v1/areas/${AREA_ID}/disable`, `POST /tenant/v1/areas/${AREA_ID}/enable`, `DELETE /tenant/v1/areas/${AREA_ID}`]);
});

test("列表：停用 / 删除被拒（有商品在用 AREA_IN_USE）时在对话框里说明怎么办；网络不通时可以再试；启用时城市已停用说明原因", async () => {
  const user = userEvent.setup();
  let attempts = 0;
  open("/areas", "admin", (call) => {
    if (call.method === "GET" && call.url.pathname === "/tenant/v1/areas") return page([summaryOf(), summaryOf({ id: OTHER_ID, name: { zh: "大阪市区" }, status: "disabled" })]);
    if (call.method === "POST" && call.path === `/tenant/v1/areas/${AREA_ID}/disable`) return apiError(409, "AREA_IN_USE", "in use", { published_product_count: 3 });
    if (call.method === "DELETE") {
      attempts += 1;
      return attempts === 1 ? Promise.reject(new TypeError("fetch failed")) : apiError(404, "NOT_FOUND", "gone");
    }
    if (call.method === "POST" && call.path === `/tenant/v1/areas/${OTHER_ID}/enable`) return apiError(409, "MASTER_DATA_NOT_READY", "city disabled");
    return null;
  });
  await user.click(await screen.findByRole("button", { name: "东京 23 区 的更多操作" }));
  await user.click(screen.getByRole("menuitem", { name: "停用" }));
  let dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "停用" }));
  await within(dialog).findByText(/有 3 个已上架的商品在用这个区域/);
  assert.match(dialog.textContent ?? "", /请先把这些商品下架/);
  assert.doesNotMatch(dialog.textContent ?? "", /AREA_IN_USE/);
  await user.click(within(dialog).getByRole("button", { name: "知道了" }));

  await user.click(screen.getByRole("button", { name: "东京 23 区 的更多操作" }));
  await user.click(screen.getByRole("menuitem", { name: "删除" }));
  dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByRole("button", { name: "删除" }));
  await within(dialog).findByText(/删除没有成功/);
  await user.click(within(dialog).getByRole("button", { name: "删除" }));
  await screen.findByText("「东京 23 区」已经被别人删除了。");

  await user.click(screen.getByRole("button", { name: "大阪市区 的更多操作" }));
  await user.click(screen.getByRole("menuitem", { name: "启用" }));
  await screen.findByText("「大阪市区」所属的城市「东京」已被平台停用，不能启用。");
});

// ───────────── 新增 ─────────────

test("新增：没有配置底图时页面照常可用——空着保存逐项说明；填好后带 Idempotency-Key 提交，成功后回列表并提示", async () => {
  const user = userEvent.setup();
  const calls = open("/areas/new", "pricing", (call) => {
    if (call.method === "POST" && call.path === "/tenant/v1/areas") return json(201, areaOf({ name: { zh: "东京市区" }, polygons: [operate] }));
    if (call.method === "GET" && call.url.pathname === "/tenant/v1/areas") return page([summaryOf({ name: { zh: "东京市区" } })]);
    return null;
  });
  await screen.findByRole("heading", { level: 1, name: "新增区域" });
  await screen.findByText(/先选城市/);
  assertAbsent(screen.queryByRole("application"));
  assert.equal((screen.getByRole("button", { name: "画多边形" }) as HTMLButtonElement).disabled, true);

  await user.click(saveButton());
  const summary = await screen.findByText("有 3 处需要修改");
  const items = within(summary.closest(".alert") as HTMLElement).getAllByRole("button").map((button) => button.textContent);
  assert.deepEqual(items, ["城市：请选择城市", "名称：请至少填一种语言的名称", "至少要有一块营运区。在地图上画一块，或点「添加营运区」。"]);
  assert.equal(writes(calls).length, 0);

  await chooseTokyo(user);
  await screen.findByText(/这个环境没有配置地图底图。/);
  await user.type(screen.getByLabelText("中文"), "东京市区");
  await addTriangle(user);
  assertAbsent(screen.queryByText(/处需要修改/));
  assert.match(document.querySelector(".area-editor__summary")?.textContent ?? "", /营运区 1 块 · 禁行区 0 块 · 有未保存的修改/);

  await user.click(saveButton());
  await screen.findByText("已新增区域「东京市区」");
  await screen.findByRole("heading", { level: 1, name: "区域" });
  const created = writes(calls)[0] as ApiCall;
  assert.match(created.headers["idempotency-key"] ?? "", /^[0-9a-f-]{36}$/);
  assert.deepEqual(created.body, {
    city_id: TOKYO_ID,
    name: { zh: "东京市区" },
    biz_type: "general",
    polygons: [{ kind: "operate", label: null, source: "drawn", geometry: { type: "Polygon", coordinates: closed(OUTER.slice(0, 3)) } }],
  });
});

test("新增：图形有问题不能保存——边交叉、点重合在那一块下面说明，改好就消失；圆的半径超出范围也说明", async () => {
  const user = userEvent.setup();
  const calls = open("/areas/new", "admin");
  await chooseTokyo(user);
  await user.type(screen.getByLabelText("中文"), "交叉的");
  await user.click(screen.getByRole("button", { name: /^添加营运区/ }));
  await user.click(screen.getByRole("menuitem", { name: "逐点输入坐标" }));
  // 蝴蝶结：1→2 和 3→4 两条边交叉
  const bow: [number, number][] = [
    [139.6, 35.6],
    [139.8, 35.8],
    [139.8, 35.6],
  ];
  for (const [index, point] of bow.entries()) {
    await user.type(screen.getByLabelText(`营运 1 第 ${index + 1} 个点的纬度`), String(point[1]));
    await user.type(screen.getByLabelText(`营运 1 第 ${index + 1} 个点的经度`), String(point[0]));
  }
  await user.click(screen.getByRole("button", { name: "在 营运 1 第 3 个点后面加一个点" }));
  const lat4 = screen.getByLabelText("营运 1 第 4 个点的纬度");
  const lng4 = screen.getByLabelText("营运 1 第 4 个点的经度");
  await user.clear(lat4);
  await user.type(lat4, "35.8");
  await user.clear(lng4);
  await user.type(lng4, "139.6");
  await user.click(saveButton());
  await waitFor(() => assert.ok(screen.getAllByText(/交叉了。挪动这几个点，让边不再交叉。/).length > 0));
  assert.match(document.querySelector('[data-shape="s1"]')?.textContent ?? "", /交叉了/);
  assert.equal(writes(calls).length, 0);

  // 把第 4 个点挪到第 1 个点上：换成「在同一个位置」
  await user.clear(lat4);
  await user.type(lat4, "35.6");
  await waitFor(() => assert.ok(screen.getAllByText(/第 4 个点和第 1 个点在同一个位置/).length > 0));
  await user.click(screen.getByRole("button", { name: "删除 营运 1 第 4 个点" }));
  await waitFor(() => assertAbsent(screen.queryByText(/在同一个位置/)));

  await user.click(screen.getByRole("button", { name: /^添加禁行区/ }));
  await user.click(screen.getByRole("menuitem", { name: "输入圆心和半径" }));
  await user.type(screen.getByLabelText("禁行 1 圆心纬度"), "35.7");
  await user.type(screen.getByLabelText("禁行 1 圆心经度"), "139.7");
  await user.type(screen.getByLabelText("禁行 1 半径（公里）"), "9999");
  await waitFor(() => assert.ok(screen.getAllByText(/半径要在 .* 公里之间/).length > 0));
});

test("新增被拒：重名说明在名称下面；城市被停用说明在城市下面并重新取城市；同时修改、网络不通、系统出错都保留已填内容；不显示错误码", async () => {
  const user = userEvent.setup();
  const answers: (() => Response | Promise<Response>)[] = [
    () => apiError(409, "AREA_NAME_TAKEN", "taken"),
    () => apiError(409, "MASTER_DATA_NOT_READY", "city disabled"),
    () => apiError(409, "CONCURRENT_UPDATE", "busy"),
    () => Promise.reject(new TypeError("fetch failed")),
    () => apiError(500, "INTERNAL", "boom"),
  ];
  let cityLoads = 0;
  const calls = open("/areas/new", "admin", (call) => {
    if (call.method === "GET" && call.url.pathname === "/tenant/v1/master/cities") {
      cityLoads += 1;
      return page([tokyo]);
    }
    if (call.method === "POST" && call.path === "/tenant/v1/areas") return (answers.shift() as () => Response)();
    return null;
  });
  await chooseTokyo(user);
  await user.type(screen.getByLabelText("中文"), "东京市区");
  await addTriangle(user);

  await user.click(saveButton());
  await screen.findByText("东京已经有同名的区域了，请换一个名称。");
  assertFocused(screen.getByLabelText("中文"));

  await user.click(saveButton());
  await screen.findByText("这个城市已经被平台停用，不能在它下面新增区域。请换一个城市。");
  assert.equal(cityLoads, 2);

  await user.click(saveButton());
  await screen.findByText("同时有其他人在修改相关的数据，这次没有保存成功。请再点一次保存。");
  await user.click(saveButton());
  await screen.findByText(/网络连接失败，请检查网络后重试。你画的图形和填的内容都还在。/);
  await user.click(saveButton());
  await screen.findByText(/系统暂时无法保存，请稍后再试。/);

  assert.equal((screen.getByLabelText("中文") as HTMLInputElement).value, "东京市区");
  assert.equal((screen.getByLabelText("营运 1 第 2 个点的经度") as HTMLInputElement).value, "139.800000");
  assert.doesNotMatch(document.body.textContent ?? "", /AREA_NAME_TAKEN|MASTER_DATA_NOT_READY|CONCURRENT_UPDATE|INTERNAL/);
  // 五次提交用的是同一个幂等键：重试不会建出两个区域
  assert.equal(new Set(writes(calls).map((call) => call.headers["idempotency-key"])).size, 1);
});

test("新增被拒：后端按图形指出的问题（VALIDATION_FAILED 的 /polygons/0）显示在那一块下面，用中文说明", async () => {
  const user = userEvent.setup();
  open("/areas/new", "admin", (call) =>
    call.method === "POST" && call.path === "/tenant/v1/areas"
      ? apiError(400, "VALIDATION_FAILED", "invalid", {
          issues: [
            { path: "/polygons/0/geometry", message: "ring self-intersects", reason: "SELF_INTERSECTION", detail: { a: 1, b: 3 } },
            { path: "/name/zh", message: "名称里有看不见的字符", reason: "INVALID_TEXT", detail: {} },
          ],
        })
      : null,
  );
  await chooseTokyo(user);
  await user.type(screen.getByLabelText("中文"), "东京市区");
  await addTriangle(user);
  await user.click(saveButton());
  await screen.findByText(/第 1–2 个点之间的边，和第 3–4 个点之间的边交叉了/);
  await screen.findByText("名称里有看不见的字符");
  assert.doesNotMatch(document.body.textContent ?? "", /ring self-intersects|VALIDATION_FAILED/);
  assert.match(document.querySelector('[data-shape="s1"]')?.textContent ?? "", /有 1 处需要修改/);
});

test("新增：粘贴带洞的 GeoJSON——外圈加为营运区、洞加为禁行区；读不出来时说明原因；替换一块时只接受一个多边形", async () => {
  const user = userEvent.setup();
  open("/areas/new", "admin");
  await chooseTokyo(user);
  await user.click(within(screen.getByRole("toolbar", { name: "绘制工具" })).getByRole("button", { name: "粘贴坐标" }));
  const dialog = await screen.findByRole("dialog", { name: "粘贴坐标" });
  const box = within(dialog).getByLabelText(/内容/);
  await user.click(within(dialog).getByRole("button", { name: "添加到地图" }));
  await within(dialog).findByText("请粘贴坐标");
  await user.click(box);
  await user.paste("这不是坐标");
  await waitFor(() => assert.ok(dialog.querySelector(".field__error")));
  await user.clear(box);
  await user.click(box);
  await user.paste(JSON.stringify({ type: "Polygon", coordinates: [closed(OUTER)[0], closed(INNER)[0]] }));
  await within(dialog).findByText(/识别为 GeoJSON：1 个多边形，共 8 个点。其中 1 个洞会加为禁行区。/);
  await user.click(within(dialog).getByRole("button", { name: "添加到地图" }));
  await screen.findByText("已添加 2 块图形");
  await screen.findByRole("heading", { level: 3, name: "营运区（1）" });
  await screen.findByRole("heading", { level: 3, name: "禁行区（1）" });

  await user.click(screen.getByRole("button", { name: "营运 1 的更多操作" }));
  await user.click(screen.getByRole("menuitem", { name: "粘贴坐标替换" }));
  const replace = await screen.findByRole("dialog", { name: "粘贴坐标替换「营运 1」" });
  await user.click(within(replace).getByLabelText(/内容/));
  await user.paste("35.5, 139.5\n35.5, 139.9\n35.9, 139.9");
  await within(replace).findByText(/识别为 坐标行：1 个多边形，共 3 个点。/);
  await user.click(within(replace).getByRole("button", { name: "替换" }));
  await screen.findByText("已替换");
  await waitFor(() => assert.match(document.querySelector('[data-shape="s1"]')?.textContent ?? "", /多边形 · 3 个点/));
  // 撤销回到替换之前
  await user.click(screen.getByRole("button", { name: "撤销" }));
  await waitFor(() => assert.match(document.querySelector('[data-shape="s1"]')?.textContent ?? "", /多边形 · 4 个点/));
});

test("新增：没有修改权限的角色打不开新增页；有未保存的内容时点「取消」先问，选「继续编辑」内容都在", async () => {
  const user = userEvent.setup();
  open("/areas/new", "readonly");
  await screen.findByText("你没有权限查看这里");
  assertAbsent(screen.queryByRole("button", { name: "保存" }));

  resetBrowser();
  open("/areas/new", "admin", (call) => (call.method === "GET" && call.url.pathname === "/tenant/v1/areas" ? page([]) : null));
  await user.type(await screen.findByLabelText("中文"), "半成品");
  await addTriangle(user);
  await user.click(screen.getByRole("button", { name: "取消" }));
  const dialog = await screen.findByRole("dialog", { name: "有未保存的修改，确定离开吗？" });
  await user.click(within(dialog).getByRole("button", { name: "继续编辑" }));
  assert.equal((screen.getByLabelText("中文") as HTMLInputElement).value, "半成品");
  await user.click(screen.getByRole("button", { name: "取消" }));
  await user.click(within(await screen.findByRole("dialog", { name: "有未保存的修改，确定离开吗？" })).getByRole("button", { name: "离开" }));
  await screen.findByRole("heading", { level: 1, name: "区域" });
});

// ───────────── 编辑 ─────────────

const getArea = (area: () => Area | Response | Promise<Response>): Route => (call) => {
  if (call.method !== "GET" || call.path !== `/tenant/v1/areas/${AREA_ID}`) return null;
  const answer = area();
  return answer instanceof Response || answer instanceof Promise ? answer : json(200, answer);
};

test("编辑：标题是区域的名字，城市不能改；图形按营运区 / 禁行区列出；没改就保存不发请求；改了带 If-Match 整体提交", async () => {
  const user = userEvent.setup();
  const calls = open(`/areas/${AREA_ID}`, "admin", (call) => {
    if (call.method === "PUT" && call.path === `/tenant/v1/areas/${AREA_ID}`) return json(200, areaOf({ version: 5 }));
    if (call.method === "GET" && call.url.pathname === "/tenant/v1/areas") return page([summaryOf()]);
    return getArea(() => areaOf())(call);
  });
  await screen.findByRole("heading", { level: 1, name: "东京 23 区" });
  assertAbsent(screen.queryByRole("combobox", { name: /城市/ }));
  assert.ok(await screen.findByText("东京（CTY-JP-TYO）"));
  await screen.findByRole("heading", { level: 3, name: "营运区（1）" });
  assert.match(document.querySelector('[data-shape="s2"]')?.textContent ?? "", /禁行 1.*皇居|皇居/);
  assert.doesNotMatch(document.querySelector(".area-editor__summary")?.textContent ?? "", /有未保存的修改/);

  await user.click(saveButton());
  await screen.findByRole("heading", { level: 1, name: "区域" });
  assert.equal(writes(calls).length, 0, "没有修改时不发请求");

  resetBrowser();
  const second = open(`/areas/${AREA_ID}`, "admin", (call) => {
    if (call.method === "PUT" && call.path === `/tenant/v1/areas/${AREA_ID}`) return json(200, areaOf({ version: 5, biz_type: "charter" }));
    if (call.method === "GET" && call.url.pathname === "/tenant/v1/areas") return page([summaryOf()]);
    return getArea(() => areaOf())(call);
  });
  await user.click(await screen.findByRole("radio", { name: /^包车/ }));
  await user.click(screen.getByRole("button", { name: "禁行 1 · 皇居 的更多操作" }));
  await user.click(screen.getByRole("menuitem", { name: "删除这一块" }));
  await user.click(saveButton());
  await screen.findByText("已保存「东京 23 区」");
  const put = writes(second)[0] as ApiCall;
  assert.equal(put.headers["if-match"], '"4"');
  assert.deepEqual(put.body, { name: { zh: "东京 23 区" }, biz_type: "charter", polygons: [{ id: OPERATE_ID, kind: "operate", label: null, source: "drawn", geometry: operate.geometry }] });
});

test("编辑：别人先改了（VERSION_CONFLICT）——说明、停用「保存」、可以复制自己画的；「载入最新内容」后换成新内容并能再保存", async () => {
  const user = userEvent.setup();
  let latest = areaOf();
  const calls = open(`/areas/${AREA_ID}`, "admin", (call) => {
    if (call.method === "PUT") {
      if (call.headers["if-match"] === '"4"') {
        latest = areaOf({ version: 9, name: { zh: "别人改的名字" }, polygons: [operate] });
        return apiError(409, "VERSION_CONFLICT", "stale");
      }
      return json(200, { ...latest, version: 10 });
    }
    if (call.method === "GET" && call.url.pathname === "/tenant/v1/areas") return page([]);
    return getArea(() => latest)(call);
  });
  await user.type(await screen.findByLabelText("日语"), "東京23区");
  await user.click(saveButton());
  await screen.findByText("这个区域刚被别人修改过，你的修改还没有保存。");
  assert.equal((saveButton() as HTMLButtonElement).disabled, true);
  assert.ok(screen.getByRole("button", { name: "复制我画的图形" }));
  assert.equal((screen.getByLabelText("日语") as HTMLInputElement).value, "東京23区");
  assert.doesNotMatch(document.body.textContent ?? "", /VERSION_CONFLICT/);

  await user.click(screen.getByRole("button", { name: "载入最新内容" }));
  await screen.findByText("已载入最新内容。");
  assert.equal((screen.getByLabelText("中文") as HTMLInputElement).value, "别人改的名字");
  assert.equal((screen.getByLabelText("日语") as HTMLInputElement).value, "");
  await screen.findByRole("heading", { level: 3, name: "禁行区（0）" });
  assert.equal((saveButton() as HTMLButtonElement).disabled, false);

  await user.type(screen.getByLabelText("日语"), "東京");
  await user.click(saveButton());
  await waitFor(() => assert.equal(writes(calls).at(-1)?.headers["if-match"], '"9"'));
});

test("编辑：保存时没有权限（403）或区域已被删除（404）——说明原因，停用「保存」，图形还在", async () => {
  const user = userEvent.setup();
  for (const [status, code, text] of [
    [403, "FORBIDDEN", "你没有权限修改区域。需要的话，请联系你们的管理员开通。"],
    [404, "NOT_FOUND", /找不到这个区域，它可能已被别人删除。你画的图形还在/],
  ] as const) {
    open(`/areas/${AREA_ID}`, "admin", (call) => (call.method === "PUT" ? apiError(status, code, "no") : getArea(() => areaOf())(call)));
    await user.type(await screen.findByLabelText("日语"), "東京");
    await user.click(saveButton());
    await screen.findByText(text);
    assert.equal((saveButton() as HTMLButtonElement).disabled, true);
    assert.ok(document.querySelector('[data-shape="s1"]'));
    resetBrowser();
  }
});

test("编辑：只读角色能看图形、能自测，没有工具条、保存和修改入口", async () => {
  const user = userEvent.setup();
  const calls = open(`/areas/${AREA_ID}`, "readonly", (call) => {
    if (call.method === "POST" && call.path === `/tenant/v1/areas/${AREA_ID}/check-point`) return json(200, { result: "forbid", operate_polygon_ids: [OPERATE_ID], forbid_polygon_ids: [FORBID_ID] });
    return getArea(() => areaOf())(call);
  });
  await screen.findByText("你可以查看区域，但不能修改。需要修改的话，请联系你们的管理员开通。");
  assertAbsent(screen.queryByRole("toolbar", { name: "绘制工具" }));
  assertAbsent(screen.queryByRole("button", { name: "保存" }));
  assertAbsent(screen.queryByRole("button", { name: /^添加营运区/ }));
  assertAbsent(screen.queryByRole("button", { name: "东京 23 区 的更多操作" }));
  await user.click(document.querySelector('[data-shape="s1"] .shape__toggle') as HTMLElement);
  assert.equal((screen.getByLabelText("营运 1 第 1 个点的纬度") as HTMLInputElement).readOnly, true);
  assertAbsent(screen.queryByRole("button", { name: "删除 营运 1 第 1 个点" }));

  const probe = document.querySelector(".area-editor__probe") as HTMLElement;
  await user.type(within(probe).getByLabelText(/纬度/), "35.7");
  await user.type(within(probe).getByLabelText(/经度/), "139.7");
  await user.click(within(probe).getByRole("button", { name: "检查" }));
  await within(probe).findByText("在禁行区内");
  assert.match(probe.textContent ?? "", /这个位置不报价。它在「禁行 1 · 皇居」里。它同时也在「营运 1」里，但禁行区优先。/);
  assert.deepEqual(writes(calls).at(-1)?.body, { lat: 35.7, lng: 139.7 });
});

test("自测：已保存且没改过图形时问后端；改过图形后按画面上的判断并说明；坐标不合法时不检查；后端出错说明怎么办", async () => {
  const user = userEvent.setup();
  let failing = true;
  const calls = open(`/areas/${AREA_ID}`, "admin", (call) => {
    if (call.method === "POST" && call.path.endsWith("/check-point")) return failing ? Promise.reject(new TypeError("fetch failed")) : json(200, { result: "operate", operate_polygon_ids: [OPERATE_ID], forbid_polygon_ids: [] });
    return getArea(() => areaOf())(call);
  });
  await screen.findByRole("heading", { level: 3, name: "营运区（1）" });
  const probe = document.querySelector(".area-editor__probe") as HTMLElement;
  await user.click(within(probe).getByRole("button", { name: "检查" }));
  assert.equal(writes(calls).length, 0, "没填坐标不检查");
  await user.type(within(probe).getByLabelText(/纬度/), "35.61");
  await user.type(within(probe).getByLabelText(/经度/), "139.61");
  await user.click(within(probe).getByRole("button", { name: "检查" }));
  await waitFor(() => assert.ok(probe.querySelector(".alert")));
  failing = false;
  await user.click(within(probe).getByRole("button", { name: "检查" }));
  await within(probe).findByText("在营运区内");
  assert.doesNotMatch(probe.textContent ?? "", /按画面上还没保存的图形判断/);
  assert.equal(writes(calls).length, 2);

  // 删掉禁行区之后：按画面上的图形判断，不再问后端
  await user.click(screen.getByRole("button", { name: "禁行 1 · 皇居 的更多操作" }));
  await user.click(screen.getByRole("menuitem", { name: "删除这一块" }));
  const lat = within(probe).getByLabelText(/纬度/);
  const lng = within(probe).getByLabelText(/经度/);
  await user.clear(lat);
  await user.type(lat, "35.7");
  await user.clear(lng);
  await user.type(lng, "139.7");
  await user.click(within(probe).getByRole("button", { name: "检查" }));
  await within(probe).findByText("按画面上还没保存的图形判断。");
  await within(probe).findByText("在营运区内");
  await user.clear(lat);
  await user.type(lat, "10");
  await user.click(within(probe).getByRole("button", { name: "检查" }));
  await within(probe).findByText("不在营运区内");
  assert.equal(writes(calls).length, 2);
});

test("编辑：找不到（404 或地址不是合法的编号）给回列表的入口；取不到给「重试」；底图配置取不到时页面照常可用", async () => {
  const user = userEvent.setup();
  const calls = open("/areas/not-a-uuid", "admin");
  await screen.findByText("找不到这个区域");
  assert.equal(screen.getByRole("link", { name: "回到区域列表" }).getAttribute("href"), "/areas");
  assert.equal(calls.some((call) => call.path.startsWith("/tenant/v1/areas/")), false);

  resetBrowser();
  open(`/areas/${AREA_ID}`, "admin", getArea(() => apiError(404, "NOT_FOUND", "no")));
  await screen.findByText("找不到这个区域");

  resetBrowser();
  let attempts = 0;
  open(`/areas/${AREA_ID}`, "admin", (call) => {
    if (call.url.pathname === "/tenant/v1/map/config") return Promise.reject(new TypeError("fetch failed"));
    return getArea(() => {
      attempts += 1;
      return attempts === 1 ? Promise.reject(new TypeError("fetch failed")) : areaOf();
    })(call);
  });
  await user.click(await screen.findByRole("button", { name: "重试" }));
  await screen.findByRole("heading", { level: 1, name: "东京 23 区" });
  await screen.findByText(/地图没有加载出来。用「图形」里的坐标表、粘贴坐标和自测，可以完成全部操作。/);
  assert.ok(saveButton());
  assert.ok(screen.getByRole("button", { name: /^添加营运区/ }));
});

test("编辑页的「更多」：停用后标题下的状态跟着变，页面上没保存的修改不丢；删除后回列表", async () => {
  const user = userEvent.setup();
  open(`/areas/${AREA_ID}`, "admin", (call) => {
    if (call.method === "POST" && call.path === `/tenant/v1/areas/${AREA_ID}/disable`) return json(200, summaryOf({ status: "disabled", version: 5 }));
    if (call.method === "DELETE") return new Response(null, { status: 204 });
    if (call.method === "GET" && call.url.pathname === "/tenant/v1/areas") return page([]);
    return getArea(() => areaOf())(call);
  });
  await user.type(await screen.findByLabelText("日语"), "東京");
  await user.click(screen.getByRole("button", { name: "东京 23 区 的更多操作" }));
  await user.click(screen.getByRole("menuitem", { name: "停用" }));
  await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "停用" }));
  await screen.findByText("已停用「东京 23 区」");
  await waitFor(() => assert.ok(document.querySelector(".page__header, .page")?.textContent?.includes("已停用")));
  assert.equal((screen.getByLabelText("日语") as HTMLInputElement).value, "東京");

  await user.click(screen.getByRole("button", { name: "东京 23 区 的更多操作" }));
  await user.click(screen.getByRole("menuitem", { name: "删除" }));
  await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "删除" }));
  await screen.findByText("已删除区域「东京 23 区」");
  await screen.findByRole("heading", { level: 1, name: "区域" });
});
