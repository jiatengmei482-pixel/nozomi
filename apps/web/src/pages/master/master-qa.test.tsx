/**
 * 运营后台主数据页面的边界（测试角色补的用例）：接口用测试替身，专门摆出真实后端不容易凑出来的应答
 * （取下一批、别人同时在改、各种拒绝）。真实后端下的行为在 e2e/master-data-qa.spec.ts 和 e2e/master-data-pipeline-qa.spec.ts。
 */
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { render, screen, waitFor, within } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { App } from "../../App.tsx";
import type { City, DashboardSummary, Place, VehicleGroup } from "../../api/master.ts";
import { type ApiCall, apiError, assertAbsent, json, resetBrowser, signIn, stubApiWith } from "../../testing/harness.tsx";

afterEach(resetBrowser);

const stamps = { created_at: "2026-01-01T00:00:00.000Z", updated_at: "2026-01-02T03:04:00.000Z" };
const TOKYO_ID = "11111111-1111-4111-8111-111111111111";
const GROUP_ID = "55555555-5555-4555-8555-555555555555";
const STATION_ID = "66666666-6666-4666-8666-666666666666";

const tokyo: City = { id: TOKYO_ID, code: "CTY-JP-TYO", country_code: "JP", name: { zh: "东京", ja: "東京", en: "Tokyo" }, timezone: "Asia/Tokyo", center: { lng: 139.767125, lat: 35.681236 }, boundary: null, status: "active", version: 3, ...stamps };
const uuid = (n: number): string => `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, "0")}`;
const airport = (n: number): Place => ({
  id: uuid(n),
  type: "airport",
  code: `A${String.fromCharCode(65 + Math.floor(n / 26))}${String.fromCharCode(65 + (n % 26))}`,
  country_code: "JP",
  city_id: null,
  parent_id: null,
  city: null,
  parent: null,
  name: { en: `Sample Airport ${n}` },
  location: { lng: 139.779694, lat: 35.552258 },
  category: null,
  flight_scope: null,
  address: null,
  source: { name: "ourairports", ref: String(2000 + n), synced_at: "2026-01-01T00:00:00.000Z", overridden: false },
  status: "disabled",
  version: 1,
  ...stamps,
});
const group: VehicleGroup = { id: GROUP_ID, code: "VG-BIZ-7", grade: "business", seats: 7, name: { zh: "商务七座" }, sample_models: ["丰田埃尔法"], power: "fuel", combos: [{ passengers: 6, luggage: 4 }], status: "active", version: 2, ...stamps };
const counts = (active: number, disabled: number) => ({ total: active + disabled, active, disabled });
const emptySummary: DashboardSummary = {
  tenants: { total: 0, active: 0, suspended: 0 },
  master_data: {
    cities: counts(0, 0),
    places: { ...counts(0, 0), by_type: { airport: counts(0, 0), station: counts(0, 0), poi: counts(0, 0), terminal: counts(0, 0), exit: counts(0, 0) }, airports_without_city: 0 },
    vehicle_groups: counts(0, 0),
    addons: counts(0, 0),
  },
};

const me = (role: string) => json(200, { user: { id: "p1", email: "staff@platform.example", name: "测试员工", role, status: "active", ...stamps }, permissions: [], must_change_password: false });
const page = <T,>(items: T[], total = items.length, next: string | null = null) => json(200, { items, next_cursor: next, total });

type Route = (call: ApiCall & { url: URL }) => Response | Promise<Response> | null;

function open(path: string, role: string, routes: Route = () => null): ApiCall[] {
  signIn("platform", "platform-token");
  const calls = stubApiWith((call) => {
    const custom = routes(call);
    if (custom !== null) return custom;
    if (call.url.pathname === "/platform/v1/auth/me") return me(role);
    if (call.url.pathname === "/platform/v1/dashboard/summary") return json(200, emptySummary);
    if (call.method === "GET" && call.url.pathname === "/platform/v1/master/cities") return page([tokyo]);
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
const pendingCode = (): string => document.querySelector(".pending__code")?.textContent ?? "";
const remainingText = (): string => document.querySelector(".pending__toolbar > span")?.textContent ?? "";

/** 把当前这一个指定到东京并启用。 */
async function assignCurrent(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  const before = pendingCode();
  await user.click(screen.getByRole("combobox", { name: /所属城市/ }));
  await user.click(screen.getByRole("option", { name: /东京/ }));
  await user.click(screen.getByRole("button", { name: "保存并启用" }));
  await waitFor(() => assert.notEqual(pendingCode(), before, `处理完 ${before} 应该换下一个`));
}

/* ───────────── 首页 ───────────── */

test("首页：数据量全是 0 时照常显示「0 启用 · 0 已停用」，卡片不隐藏、没有提醒行；供应商卡片不是链接", async () => {
  open("/platform", "super_admin");
  await waitFor(() => assert.equal(main().querySelectorAll(".entry-card dd").length, 10));
  assert.deepEqual([...main().querySelectorAll(".entry-card__title")].map((node) => node.textContent), ["供应商", "城市", "地点", "车型组", "附加服务"]);
  assert.deepEqual([...main().querySelectorAll(".entry-card dd")].map((node) => node.textContent), Array.from({ length: 10 }, () => "0"));
  assert.equal(main().querySelectorAll(".entry-card__reminder").length, 0);
  assert.equal(main().querySelectorAll("a.entry-card__title").length, 4, "供应商还没有页面，不是链接");
  assertAbsent(screen.queryByText("这里暂时没有你可以使用的模块"));
});

test("首页：接口说两个模块都不能看时，显示「这里暂时没有你可以使用的模块」，不留空白页", async () => {
  open("/platform", "finance", (call) => (call.url.pathname === "/platform/v1/dashboard/summary" ? json(200, { tenants: null, master_data: null }) : null));
  assert.ok(await screen.findByText("这里暂时没有你可以使用的模块"));
  assert.equal(main().querySelectorAll(".entry-card").length, 0);
});

test("首页：启用的城市是 0、又有待指定城市的机场时，城市卡片提醒先新增城市（只给能修改的人）", async () => {
  const waiting: DashboardSummary = { ...emptySummary, master_data: { ...emptySummary.master_data!, cities: counts(0, 2), places: { ...emptySummary.master_data!.places, airports_without_city: 1234 } } };
  open("/platform", "master_data", (call) => (call.url.pathname === "/platform/v1/dashboard/summary" ? json(200, waiting) : null));
  const reminder = await within(main()).findByRole("link", { name: /先新增城市，才能给机场指定城市/ });
  assert.equal(reminder.getAttribute("href"), "/platform/master/cities/new");
  assert.equal(within(main()).getByRole("link", { name: /1,234 个机场待指定城市/ }).getAttribute("href"), "/platform/master/places/pending", "带千分位");
});

/* ───────────── 处理导入的机场：取下一批 ───────────── */

test("处理导入的机场：队列快见底时在后台取下一批（带上次的游标），不重复、不打断当前这一个；全部处理完才显示空状态", async () => {
  const firstBatch = Array.from({ length: 22 }, (_, n) => airport(n));
  const secondBatch = Array.from({ length: 3 }, (_, n) => airport(22 + n));
  const calls = open("/platform/master/places/pending", "master_data", (call) => {
    if (call.method === "GET" && call.url.searchParams.get("city_id") === "none") {
      // 第二批里混进一个第一批已经有的：不能在队列里出现两次
      return call.url.searchParams.get("cursor") === "cursor-2" ? page([firstBatch[21] as Place, ...secondBatch], 22) : page(firstBatch, 25, "cursor-2");
    }
    const match = /\/places\/([0-9a-f-]+)\/enable$/.exec(call.url.pathname);
    if (match && call.method === "POST") {
      const place = [...firstBatch, ...secondBatch].find((entry) => entry.id === match[1]) as Place;
      return json(200, { ...place, city_id: TOKYO_ID, status: "active", version: 2 });
    }
    return null;
  });
  const user = userEvent.setup();
  await screen.findByRole("heading", { level: 2, name: "Sample Airport 0" });
  assert.equal(remainingText(), "还剩 25 个");
  const batchCalls = (): ApiCall[] => calls.filter((call) => call.path.includes("city_id=none"));
  assert.equal(batchCalls().length, 1, "队列还有 22 个，不急着取下一批");

  const seen: string[] = [];
  for (let n = 0; n < 25; n += 1) {
    seen.push(pendingCode());
    assert.equal(remainingText(), `还剩 ${25 - n} 个`, `处理第 ${n + 1} 个之前`);
    if (n < 24) await assignCurrent(user);
  }
  assert.equal(new Set(seen).size, 25, "25 个各出现一次，没有重复");
  assert.deepEqual(batchCalls().map((call) => new URL(call.path, "http://x").searchParams.get("cursor")), [null, "cursor-2"], "下一批只取了一次，带着上一批给的游标");
  assert.equal(new URL(batchCalls()[1]?.path ?? "", "http://x").searchParams.get("limit"), "200");

  await user.click(screen.getByRole("combobox", { name: /所属城市/ }));
  await user.click(screen.getByRole("option", { name: /东京/ }));
  await user.click(screen.getByRole("button", { name: "保存并启用" }));
  assert.ok(await screen.findByRole("heading", { name: "没有待指定城市的机场了" }));
  assert.ok(screen.getByText("这一批都处理完了。"));
  assert.equal(written(calls).length, 25);
  assert.equal(document.querySelectorAll(".done-list__item").length, 10, "「本次已处理」最多 10 条");
});

test("【缺陷】处理导入的机场：取下一批时别人已经处理掉了一些——「还剩」应当按接口新给的总数校正（master-data.md 4.3），实际还按旧数字往下减", async () => {
  // 开始时 25 个：我这里有 22 个，后面还有 3 个。我处理 3 个之后去取下一批；这期间别人把后面的 3 个里处理掉了 2 个。
  // 接口此刻说符合条件的一共 20 个（我队列里剩的 19 个 + 新来的 1 个）。
  const firstBatch = Array.from({ length: 22 }, (_, n) => airport(n));
  open("/platform/master/places/pending", "master_data", (call) => {
    if (call.method === "GET" && call.url.searchParams.get("city_id") === "none") {
      return call.url.searchParams.get("cursor") === "cursor-2" ? page([airport(24)], 20) : page(firstBatch, 25, "cursor-2");
    }
    const match = /\/places\/([0-9a-f-]+)\/enable$/.exec(call.url.pathname);
    if (match && call.method === "POST") return json(200, { ...(firstBatch.find((entry) => entry.id === match[1]) as Place), city_id: TOKYO_ID, status: "active", version: 2 });
    return null;
  });
  const user = userEvent.setup();
  await screen.findByRole("heading", { level: 2, name: "Sample Airport 0" });
  for (let n = 0; n < 3; n += 1) await assignCurrent(user);
  // 队列里现在是 19 个 + 新取回来的 1 个 = 20 个，接口也说是 20 个
  await waitFor(() => assert.equal(remainingText(), "还剩 20 个", "取回下一批后按新的总数校正"));
});

test("【缺陷】处理导入的机场：后台取下一批失败时没有任何提示，处理完手头的就显示「没有待指定城市的机场了」，其实后面还有", async () => {
  const firstBatch = Array.from({ length: 2 }, (_, n) => airport(n));
  open("/platform/master/places/pending", "master_data", (call) => {
    if (call.method === "GET" && call.url.searchParams.get("city_id") === "none") {
      return call.url.searchParams.get("cursor") === "cursor-2" ? apiError(500, "INTERNAL_ERROR", "服务器内部错误") : page(firstBatch, 60, "cursor-2");
    }
    const match = /\/places\/([0-9a-f-]+)\/enable$/.exec(call.url.pathname);
    if (match && call.method === "POST") return json(200, { ...(firstBatch.find((entry) => entry.id === match[1]) as Place), city_id: TOKYO_ID, status: "active", version: 2 });
    return null;
  });
  const user = userEvent.setup();
  await screen.findByRole("heading", { level: 2, name: "Sample Airport 0" });
  assert.equal(remainingText(), "还剩 60 个");
  await assignCurrent(user);
  await user.click(screen.getByRole("combobox", { name: /所属城市/ }));
  await user.click(screen.getByRole("option", { name: /东京/ }));
  await user.click(screen.getByRole("button", { name: "保存并启用" }));
  await waitFor(() => assert.equal(document.querySelector(".pending__code") === null, true));
  // 还有 58 个没处理：不能告诉人「没有了」，应当说明没取到并给「重试」
  assertAbsent(screen.queryByRole("heading", { name: "没有待指定城市的机场了" }));
  assert.ok(screen.queryByRole("button", { name: "重试" }), "应当能重试取下一批");
});

/* ───────────── 处理导入的机场：保存被拒 ───────────── */

test("处理导入的机场：保存时的各种拒绝——同时修改可以直接再点；没有权限说明原因；这个机场已经不存在就换下一个；内容都保留", async () => {
  const first = airport(0);
  const second = airport(1);
  let attempt = 0;
  const calls = open("/platform/master/places/pending", "master_data", (call) => {
    if (call.method === "GET" && call.url.searchParams.get("city_id") === "none") return page([first, second], 2);
    if (call.method === "PATCH") {
      attempt += 1;
      if (attempt === 1) return apiError(409, "CONCURRENT_UPDATE", "同时修改");
      if (attempt === 2) return apiError(403, "FORBIDDEN", "没有权限");
      if (attempt === 3) return apiError(428, "PRECONDITION_REQUIRED", "缺少版本号");
      return apiError(404, "NOT_FOUND", "不存在");
    }
    return null;
  });
  const user = userEvent.setup();
  await screen.findByRole("heading", { level: 2, name: "Sample Airport 0" });
  await user.click(screen.getByRole("combobox", { name: /所属城市/ }));
  await user.click(screen.getByRole("option", { name: /东京/ }));
  await user.type(screen.getByLabelText("名称 中文"), "样本机场");
  const keeps = (): void => {
    assert.equal((screen.getByRole("combobox", { name: /所属城市/ }) as HTMLInputElement).value, "东京");
    assert.equal((screen.getByLabelText("名称 中文") as HTMLInputElement).value, "样本机场");
    assert.equal(pendingCode(), first.code);
  };

  await user.click(screen.getByRole("button", { name: "只保存，先不启用" }));
  assert.ok(await screen.findByText("同时有其他人在修改相关数据，这次没有保存成功。请再点一次。"));
  keeps();
  await user.click(screen.getByRole("button", { name: "只保存，先不启用" }));
  assert.ok(await screen.findByText("你没有权限修改主数据。需要的话，请联系管理员开通。"));
  keeps();
  await user.click(screen.getByRole("button", { name: "只保存，先不启用" }));
  assert.ok(await screen.findByText("系统暂时无法保存，请稍后再试。你填写的内容还在。"));
  keeps();
  assert.doesNotMatch(main().textContent ?? "", /PRECONDITION|428|FORBIDDEN|CONCURRENT_UPDATE|If-Match/, "不向用户显示错误码");
  await user.click(screen.getByRole("button", { name: "只保存，先不启用" }));
  assert.ok(await screen.findByText(`找不到「${first.code} Sample Airport 0」，它可能已经不存在，已为你换到下一个。`));
  assert.equal(pendingCode(), second.code);
  assert.equal(written(calls).length, 4);
  assert.ok(written(calls).every((call) => call.headers["if-match"] === '"1"'));
});

test("处理导入的机场：登录过期回登录页；必须先改密码去改密页", async () => {
  for (const [response, expected] of [
    [apiError(401, "UNAUTHENTICATED", "未登录"), "/platform/login"],
    [apiError(403, "PASSWORD_CHANGE_REQUIRED", "请先修改密码"), "/platform/account/password"],
  ] as const) {
    open("/platform/master/places/pending", "master_data", (call) => {
      if (call.method === "GET" && call.url.searchParams.get("city_id") === "none") return page([airport(0)], 1);
      if (call.method === "POST" && call.url.pathname.endsWith("/enable")) return response.clone();
      if (call.url.pathname === "/platform/v1/auth/logout") return new Response(null, { status: 204 });
      return null;
    });
    const user = userEvent.setup();
    await screen.findByRole("heading", { level: 2, name: "Sample Airport 0" });
    await user.click(screen.getByRole("combobox", { name: /所属城市/ }));
    await user.click(screen.getByRole("option", { name: /东京/ }));
    await user.click(screen.getByRole("button", { name: "保存并启用" }));
    await waitFor(() => assert.equal(document.querySelector(".pending__code") === null, true, `应当离开流水线页去 ${expected}`));
    if (expected.endsWith("login")) assert.ok(await screen.findByText("登录已过期，请重新登录。"));
    else assert.ok(await screen.findByRole("heading", { level: 1, name: "设置新密码" }));
    resetBrowser();
  }
});

/* ───────────── 表单：后端拒绝 ───────────── */

function editGroup(patchResponse: () => Response): ApiCall[] {
  return open(`/platform/master/vehicle-groups/${GROUP_ID}`, "master_data", (call) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/master/vehicle-groups/${GROUP_ID}`) return json(200, group);
    if (call.method === "PATCH") return patchResponse();
    return null;
  });
}

test("表单保存被拒：创建后不能改的字段（FIELD_LOCKED）按字段的中文名说明，认不出来的写「有些内容」；缺版本号（428）按系统出错处理；都不显示错误码", async () => {
  let response = apiError(409, "FIELD_LOCKED", "不能修改", { fields: ["grade", "seats"] });
  editGroup(() => response.clone());
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("名称 英语"), "Business");
  await user.click(screen.getByRole("button", { name: "保存" }));
  assert.ok(await screen.findByText("等级、座位数创建后不能修改。请刷新页面后重试。"));
  response = apiError(409, "FIELD_LOCKED", "不能修改", { fields: ["code", "internal_flag"] });
  await user.click(screen.getByRole("button", { name: "保存" }));
  assert.ok(await screen.findByText("有些内容创建后不能修改。请刷新页面后重试。"));
  response = apiError(428, "PRECONDITION_REQUIRED", "缺少版本号");
  await user.click(screen.getByRole("button", { name: "保存" }));
  assert.ok(await screen.findByText("系统暂时无法保存，请稍后再试。你填写的内容还在。"));
  response = apiError(400, "VALIDATION_FAILED", "请求参数校验未通过", { location: "body", issues: [{ path: "/name/en", message: "String must contain at most 200 character(s)" }, { path: "/combos/0/passengers", message: "不能小于 1" }] });
  await user.click(screen.getByRole("button", { name: "保存" }));
  assert.ok(await screen.findByText("这一项不符合要求，请检查后重试"), "后端的英文说明不原样显示");
  assert.ok(screen.getByText("不能小于 1"));
  assert.equal((screen.getByLabelText("名称 英语") as HTMLInputElement).value, "Business");
  assert.doesNotMatch(main().textContent ?? "", /FIELD_LOCKED|PRECONDITION|428|409|internal_flag|String must/);
});

test("【缺陷】编辑车型组：后端拒绝了「代表车型」（例如只有看不见的字符）时，页面上没有任何出错文字，只是焦点动了一下", async () => {
  const calls = editGroup(() => apiError(400, "VALIDATION_FAILED", "请求参数校验未通过", { location: "body", issues: [{ path: "/sample_models/1", message: "不能只有空白或不可见字符" }] }));
  const user = userEvent.setup();
  await screen.findByLabelText("名称 中文");
  await user.click(screen.getByRole("button", { name: /添加代表车型/ }));
  // 零宽空格：前端当成有内容发出去，后端按「只有不可见字符」拒绝
  await user.type(screen.getByRole("textbox", { name: "第 2 个代表车型" }), "​");
  await user.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => assert.equal(written(calls).length, 1));
  assert.deepEqual(written(calls)[0]?.body, { sample_models: ["丰田埃尔法", "​"] });
  // master-data.md 第 8 节：位置能对上字段的，显示在那个字段下；对不上的，表单顶部提示。两者至少有一个
  await waitFor(() => {
    const shown = main().textContent ?? "";
    assert.ok(/不能只有空白或不可见字符|提交的内容不符合要求，请检查后重试/.test(shown), "保存被拒绝了，页面上应该有一句话说明");
  });
});

test("【缺陷】别人先改了（VERSION_CONFLICT）之后点「载入最新内容」，这次载入失败（断网）时没有任何反应，也没有提示", async () => {
  let loads = 0;
  open(`/platform/master/vehicle-groups/${GROUP_ID}`, "master_data", (call) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/master/vehicle-groups/${GROUP_ID}`) {
      loads += 1;
      return loads === 1 ? json(200, group) : apiError(503, "UNAVAILABLE", "暂时不可用");
    }
    if (call.method === "PATCH") return apiError(409, "VERSION_CONFLICT", "版本不是最新的", { current_version: 9 });
    return null;
  });
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("名称 英语"), "Business");
  await user.click(screen.getByRole("button", { name: "保存" }));
  await user.click(await screen.findByRole("button", { name: "载入最新内容" }));
  await waitFor(() => assert.equal(loads, 2));
  assert.equal((screen.getByLabelText("名称 英语") as HTMLInputElement).value, "Business", "载入失败时，我写的内容还在");
  // 载入没有成功：应当告诉人没有成功（「加载失败」「请检查网络后重试」之类），而不是什么都不变
  await waitFor(() => assert.match(main().textContent ?? "", /加载失败|没有载入|载入失败|请检查网络后重试|稍后再试/));
});

test("新增地点时所属城市刚被停用（CITY_DISABLED）：提示在「所属城市」下，内容保留；新增出口时车站刚被停用（PARENT_DISABLED）：表单顶部说明是哪个车站", async () => {
  const calls = open("/platform/master/places/new?type=poi", "master_data", (call) => (call.method === "POST" ? apiError(409, "MASTER_DATA_NOT_READY", "还不能启用", { reason: "CITY_DISABLED" }) : null));
  const user = userEvent.setup();
  await user.click(await screen.findByRole("combobox", { name: /所属城市/ }));
  await user.click(await screen.findByRole("option", { name: /东京/ }));
  await user.type(screen.getByLabelText(/^编码/), "000123");
  await user.type(screen.getByLabelText("名称 中文"), "东京塔");
  await user.click(screen.getByLabelText("景点"));
  await user.type(screen.getByLabelText(/^纬度/), "35.658581");
  await user.type(screen.getByLabelText(/^经度/), "139.745433");
  await user.click(screen.getByRole("button", { name: "保存" }));
  assert.ok(await screen.findByText("这个城市已经停用。请换一个城市，或先去启用它。"));
  assert.deepEqual(written(calls)[0]?.body, { type: "poi", code: "POI-000123", name: { zh: "东京塔" }, location: { lat: 35.658581, lng: 139.745433 }, city_id: TOKYO_ID, category: "attraction" });
  assert.equal((screen.getByLabelText("名称 中文") as HTMLInputElement).value, "东京塔");
  resetBrowser();

  const station: Place = { ...airport(0), id: STATION_ID, type: "station", code: "STN-JP-TOKYO", name: { zh: "东京站" }, city_id: TOKYO_ID, city: { id: TOKYO_ID, code: tokyo.code, name: tokyo.name }, category: "shinkansen", source: null, status: "active" };
  const exitCalls = open(`/platform/master/places/new?type=exit&parent=${STATION_ID}`, "master_data", (call) => {
    if (call.method === "GET" && call.url.pathname === `/platform/v1/master/places/${STATION_ID}`) return json(200, station);
    if (call.method === "POST") return apiError(409, "MASTER_DATA_NOT_READY", "还不能启用", { reason: "PARENT_DISABLED" });
    return null;
  });
  const code = (await screen.findByLabelText(/^编码/)) as HTMLInputElement;
  await waitFor(() => assert.equal(code.value, "STN-JP-TOKYO-", "编码前缀是上级的编码"));
  await user.type(code, "e1");
  await user.type(screen.getByLabelText("名称 中文"), "八重洲口");
  await user.click(screen.getByRole("button", { name: "填入车站的坐标" }));
  await user.click(screen.getByRole("button", { name: "保存" }));
  assert.ok(await screen.findByText("所属车站「STN-JP-TOKYO 东京站」已停用，不能在它下面新增出口。请先启用它。"));
  assert.deepEqual(exitCalls.filter((call) => call.method === "POST")[0]?.body, { type: "exit", code: "STN-JP-TOKYO-E1", name: { zh: "八重洲口" }, location: { lat: 35.552258, lng: 139.779694 }, parent_id: STATION_ID });
});
