/**
 * 供应商后台「商品」（M1-03）的端到端补充（测试工程师）：真实浏览器、真实后端、真实 PostgreSQL。
 * 已有的 products.spec.ts 是主流程；这里补：只用键盘建完一个商品、服务区域排序（按钮和键盘）并存到后端、
 * 时段输入的「次日」/ 全天和后端存的值、HTML 字符经真实后端存取后只当文字显示（XSS）、768px 宽、
 * 以及两处会把人卡住的情形。名字以「【缺陷】」开头的是现在会失败的：复现、期望、实际写在测试里。
 * 并行的用例共用一个库，所以每条用自己的城市、供应商和随机编码。
 */
import { type APIRequestContext, type Locator, type Page, expect, test } from "@playwright/test";
import { createActiveTenant, expectNoHorizontalOverflow, loginAs, platformAdminHeaders, randomLetters } from "./support.ts";

const CENTER = { lat: 35.6895, lng: 139.6917 };

interface Ref {
  id: string;
  code: string;
  name: string;
}
interface World {
  city: Ref;
  airport: Ref;
  group: Ref;
  seat: Ref & { version: number };
}
interface Supplier {
  tenant: Awaited<ReturnType<typeof createActiveTenant>>;
  headers: Record<string, string>;
  brand: Ref;
  area: Ref;
}

async function post<T>(request: APIRequestContext, headers: Record<string, string>, path: string, data: unknown, what: string): Promise<T> {
  const response = await request.post(path, { headers, data });
  expect(response.status(), `${what}：${await response.text()}`).toBe(201);
  return (await response.json()) as T;
}

/** 平台这边的主数据：一个城市、城市下的一个机场、一个车型组（两个组合）、一个按个计费的附加服务。 */
async function createWorld(request: APIRequestContext): Promise<World> {
  const headers = await platformAdminHeaders(request);
  const tag = randomLetters(5);
  const city = await post<{ id: string }>(request, headers, "/platform/v1/master/cities", { code: `CTY-JP-${tag}`, country_code: "JP", name: { zh: `测试城${tag}` }, timezone: "Asia/Tokyo", center: CENTER }, "新建城市");
  let airport: Ref | null = null;
  for (let attempt = 0; airport === null && attempt < 8; attempt += 1) {
    const code = `Y${randomLetters(2)}`;
    const response = await request.post("/platform/v1/master/places", { headers, data: { type: "airport", code, city_id: city.id, name: { zh: `测试机场${tag}` }, location: { lat: CENTER.lat - 0.1, lng: CENTER.lng + 0.1 }, flight_scope: "mixed" } });
    if (response.status() === 201) airport = { id: ((await response.json()) as { id: string }).id, code, name: `测试机场${tag}` };
    else expect(response.status(), `新建机场：${await response.text()}`).toBe(409);
  }
  if (airport === null) throw new Error("没有建出机场");
  const group = await post<{ id: string }>(request, headers, "/platform/v1/master/vehicle-groups", { code: `VG-QA${tag}-7`, grade: "business", seats: 7, power: "fuel", name: { zh: `测试七座${tag}` }, sample_models: [], combos: [{ passengers: 6, luggage: 4 }, { passengers: 5, luggage: 5 }] }, "新建车型组");
  const seat = await post<{ id: string; version: number }>(request, headers, "/platform/v1/master/addons", { code: `ADD-QASEAT_${tag}`, categories: ["airport_transfer", "point_to_point", "charter"], charge_unit: "per_item", name: { zh: `测试座椅${tag}` }, description: {} }, "新建附加服务");
  return { city: { id: city.id, code: `CTY-JP-${tag}`, name: `测试城${tag}` }, airport, group: { id: group.id, code: `VG-QA${tag}-7`, name: `测试七座${tag}` }, seat: { id: seat.id, code: `ADD-QASEAT_${tag}`, name: `测试座椅${tag}`, version: seat.version } };
}

async function tenantHeaders(request: APIRequestContext, email: string, password: string): Promise<Record<string, string>> {
  const response = await request.post("/tenant/v1/auth/login", { data: { email, password } });
  expect(response.ok(), "供应商账号登录").toBe(true);
  return { authorization: `Bearer ${((await response.json()) as { access_token: string }).access_token}` };
}

async function createArea(request: APIRequestContext, headers: Record<string, string>, city: Ref, name: string, bizType = "general"): Promise<Ref> {
  const ring = [[CENTER.lng - 0.1, CENTER.lat - 0.1], [CENTER.lng + 0.1, CENTER.lat - 0.1], [CENTER.lng + 0.1, CENTER.lat + 0.1], [CENTER.lng - 0.1, CENTER.lat + 0.1], [CENTER.lng - 0.1, CENTER.lat - 0.1]];
  const area = await post<{ id: string }>(request, { ...headers, "idempotency-key": crypto.randomUUID() }, "/tenant/v1/areas", { city_id: city.id, name: { zh: name }, biz_type: bizType, polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [ring] } }] }, "新建区域");
  return { id: area.id, code: "", name };
}

/** 一个配好子品牌和一个通用区域的供应商。 */
async function createSupplier(request: APIRequestContext, world: World, brandName = `品牌 ${randomLetters(4)}`, areaName = `通用区域 ${randomLetters(4)}`): Promise<Supplier> {
  const tenant = await createActiveTenant(request);
  const headers = await tenantHeaders(request, tenant.adminEmail, tenant.password);
  const brand = await post<{ id: string }>(request, { ...headers, "idempotency-key": crypto.randomUUID() }, "/tenant/v1/brands", { name: brandName, currency: "JPY" }, "新建子品牌");
  const area = await createArea(request, headers, world.city, areaName);
  return { tenant, headers, brand: { id: brand.id, code: "JPY", name: brandName }, area };
}

async function createProduct(request: APIRequestContext, supplier: Supplier, world: World, category: "airport_transfer" | "point_to_point" | "charter", extra: Record<string, unknown> = {}): Promise<{ id: string; version: number; code: string }> {
  return post(
    request,
    { ...supplier.headers, "idempotency-key": crypto.randomUUID() },
    "/tenant/v1/products",
    { brand_id: supplier.brand.id, city_id: world.city.id, category, ...(category === "airport_transfer" ? { poi_id: world.airport.id } : {}), areas: [{ area_id: supplier.area.id }], vehicle_groups: [{ vehicle_group_id: world.group.id, passengers: 6, luggage: 4 }], dispatchers: [{ name: "山田", phone: "+81 90 1234 5678" }], ...extra },
    "接口新建商品",
  );
}

async function getJson<T>(request: APIRequestContext, headers: Record<string, string>, path: string): Promise<T> {
  const response = await request.get(path, { headers });
  expect(response.status(), `GET ${path}：${await response.text()}`).toBe(200);
  return (await response.json()) as T;
}

const toast = (page: Page, text: string): Locator => page.locator(".toast").filter({ hasText: text });
const step = (page: Page, name: string): Locator => page.getByRole("navigation", { name: "配置步骤" }).locator(".step-nav__item").filter({ hasText: name });
const productIdOf = (page: Page): string => /\/products\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? "";

/** 一直按 Tab，直到焦点到了这个元素上（只用键盘能不能走到它）。 */
async function tabTo(page: Page, target: Locator, what: string): Promise<void> {
  for (let presses = 0; presses < 80; presses += 1) {
    if (await target.evaluate((node) => node === document.activeElement).catch(() => false)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`按了 80 次 Tab 也没有走到：${what}`);
}

test("只用键盘建完一个商品：新建 → 选城市、品类、接送点 → 加区域、加车型组并选组合 → 调度人 → 保存 → 服务规则 → 商品详情 → 上架检查；全程不碰鼠标", async ({ page, request }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);
  await page.goto("/products/new");
  await expect(page.getByText(`${supplier.brand.name}（JPY）`)).toBeVisible();
  const keys = page.keyboard;

  // 城市：输入查找，方向键选，回车确认
  await tabTo(page, page.getByRole("combobox", { name: /城市/ }), "城市");
  await keys.type(world.city.code);
  await expect(page.getByRole("option", { name: new RegExp(world.city.name) })).toBeVisible();
  await keys.press("ArrowDown");
  await keys.press("Enter");
  await expect(page.getByRole("combobox", { name: /城市/ })).toHaveValue(world.city.name);
  // 品类：单选组，方向键换到「接送机」
  await tabTo(page, page.getByRole("radio").first(), "品类");
  await keys.press("Space");
  await expect(page.getByRole("radio", { name: /^接送机/ })).toBeChecked();
  await expect(page.getByText("这四项创建后不能修改。")).toBeVisible();
  // 接送点
  await tabTo(page, page.getByRole("combobox", { name: /接送点/ }), "接送点");
  await keys.type(world.airport.code);
  await expect(page.getByRole("option", { name: new RegExp(world.airport.name) })).toBeVisible();
  await keys.press("ArrowDown");
  await keys.press("Enter");
  await expect(page.getByRole("combobox", { name: /接送点/ })).toHaveValue(world.airport.name);

  // 服务区域：回车打开面板，空格勾选，Esc 关上，焦点回到「添加区域」
  const addArea = page.getByRole("button", { name: "添加区域", exact: true });
  await tabTo(page, addArea, "添加区域");
  await keys.press("Enter");
  const areaPanel = page.getByRole("group", { name: "添加区域" });
  await expect(areaPanel).toBeVisible();
  await tabTo(page, areaPanel.getByRole("checkbox", { name: new RegExp(supplier.area.name) }), "区域的勾选框");
  await keys.press("Space");
  await keys.press("Escape");
  await expect(areaPanel).toBeHidden();
  await expect(addArea).toBeFocused();
  await expect(page.locator("[data-area-pick]")).toHaveCount(1);

  // 车型组：同样的面板；组合用下拉框的方向键选
  const addGroup = page.getByRole("button", { name: "添加车型组", exact: true });
  await tabTo(page, addGroup, "添加车型组");
  await keys.press("Enter");
  const groupPanel = page.getByRole("group", { name: "添加车型组" });
  await tabTo(page, groupPanel.getByRole("checkbox", { name: new RegExp(world.group.code) }), "车型组的勾选框");
  await keys.press("Space");
  await keys.press("Escape");
  await expect(addGroup).toBeFocused();
  const combo = page.getByLabel(`${world.group.name} 的人数 / 行李数`);
  await tabTo(page, combo, "人数 / 行李数");
  await expect(combo).toHaveValue("");
  await keys.press("ArrowDown");
  await expect(combo).toBeFocused();
  await expect(combo).toHaveValue("6-4");

  // 调度人
  await tabTo(page, page.getByLabel("第 1 个调度人的姓名"), "调度人姓名");
  await keys.type("键盘调度");
  await keys.press("Tab");
  await expect(page.getByLabel("第 1 个调度人的电话")).toBeFocused();
  await keys.type("+81 90 1234 5678");
  // 保存并下一步
  await tabTo(page, page.getByRole("button", { name: "保存并下一步" }), "保存并下一步");
  await keys.press("Enter");
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}\/service-rules$/);
  const productId = productIdOf(page);
  await expect(page.getByRole("heading", { level: 2, name: "② 服务规则" })).toBeFocused();

  // ② 服务规则：全天、提前 24 小时；免费等待是预先填好的
  await tabTo(page, page.getByRole("checkbox", { name: "全天 24 小时" }), "全天 24 小时");
  await keys.press("Space");
  await tabTo(page, page.getByLabel("提前预订时长（小时）"), "提前预订时长");
  await keys.type("24");
  await tabTo(page, page.getByRole("button", { name: "保存并下一步" }), "保存并下一步");
  await keys.press("Enter");
  // 价格规则、库存已经开放：下一步是 ③ 价格规则（它们的键盘操作在 prices.spec.ts、inventory.spec.ts 里）；这里跳过去接着填 ⑤
  await expect(page).toHaveURL(/\/prices$/);
  await expect(page.getByRole("heading", { level: 2, name: "③ 价格规则" })).toBeFocused();
  await page.goto(page.url().replace(/\/prices$/, "/content"));
  await expect(page.getByRole("heading", { level: 2, name: "⑤ 商品详情" })).toBeFocused();

  // ⑤ 商品详情：标题和接机指引
  await tabTo(page, page.getByLabel("标题"), "标题");
  await keys.type("键盘建的商品");
  await tabTo(page, page.getByLabel(/接机指引/), "接机指引");
  await keys.type("到达大厅 2 号出口");
  await tabTo(page, page.getByRole("button", { name: "保存并看上架检查" }), "保存并看上架检查");
  await keys.press("Enter");
  await expect(page).toHaveURL(/\/publish$/);
  await expect(page.getByText("还不能上架：还有 1 项要补", { exact: true })).toBeVisible();
  // 禁用的「上架」键盘到得了、读得到原因
  const publish = page.getByRole("button", { name: "上架", exact: true });
  await tabTo(page, publish, "上架");
  await expect(publish).toHaveAttribute("aria-disabled", "true");
  await expect(publish).toHaveAttribute("aria-describedby", /publish-note/);

  // 后端存的就是键盘填的
  const saved = await getJson<{ status: string; title: Record<string, string>; areas: { area_id: string }[]; vehicle_groups: { passengers: number; luggage: number }[]; dispatchers: unknown[] }>(request, supplier.headers, `/tenant/v1/products/${productId}`);
  expect([saved.status, saved.title, saved.areas.map((area) => area.area_id), saved.vehicle_groups.map((group) => [group.passengers, group.luggage]), saved.dispatchers]).toEqual(["draft", { zh: "键盘建的商品" }, [supplier.area.id], [[6, 4]], [{ name: "键盘调度", phone: "+81 90 1234 5678" }]]);
  const rules = await getJson<{ rules: { booking: { service_time: unknown; lead_time_hours: number }; free_wait: unknown } }>(request, supplier.headers, `/tenant/v1/products/${productId}/service-rules`);
  expect([rules.rules.booking.service_time, rules.rules.booking.lead_time_hours, rules.rules.free_wait]).toEqual([{ start: "00:00", end: "24:00" }, 24, { pickup: { mode: "limited", minutes: 60 }, dropoff: { mode: "limited", minutes: 15 }, general: null }]);
  const check = await getJson<{ items: { key: string; passed: boolean }[] }>(request, supplier.headers, `/tenant/v1/products/${productId}/publish-check`);
  expect(check.items.filter((item) => !item.passed).map((item) => item.key)).toEqual(["price_rules"]);
});

test("服务区域的排序：上移 / 下移按钮和 Alt+方向键都能调，首尾的按钮停用，焦点跟着被移动的那一行；保存后顺序存到后端，重新打开还是这个顺序", async ({ page, request }) => {
  test.slow();
  await page.setViewportSize({ width: 1280, height: 800 });
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world, undefined, "甲区");
  const second = await createArea(request, supplier.headers, world.city, "乙区", "charter");
  const third = await createArea(request, supplier.headers, world.city, "丙区");
  const product = await createProduct(request, supplier, world, "charter", { areas: [{ area_id: supplier.area.id }, { area_id: second.id }, { area_id: third.id }] });
  await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);
  await page.goto(`/products/${product.id}/basic`);
  const rows = page.locator("[data-area-pick]");
  const order = async (): Promise<string[]> => rows.locator(".picked__name").allTextContents();
  await expect(rows).toHaveCount(3);
  expect(await order()).toEqual(["甲区", "乙区", "丙区"]);
  await expect(page.getByRole("button", { name: "把 甲区 上移" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "把 丙区 下移" })).toBeDisabled();
  await expect(rows.locator(".picked__number")).toHaveText(["1", "2", "3"]);

  // 按钮：丙区上移两次到第一位——到顶后「上移」停用，焦点落到它的「下移」上
  await page.getByRole("button", { name: "把 丙区 上移" }).click();
  expect(await order()).toEqual(["甲区", "丙区", "乙区"]);
  await expect(page.getByRole("button", { name: "把 丙区 上移" })).toBeFocused();
  await page.keyboard.press("Enter");
  expect(await order()).toEqual(["丙区", "甲区", "乙区"]);
  await expect(page.getByRole("button", { name: "把 丙区 下移" })).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: "丙区 现在排第 1，共 3 个" })).toHaveCount(1);
  await expect(page.locator(".step__summary")).toContainText("有未保存的修改");

  // 键盘：焦点在这一行里时 Alt+↓ / Alt+↑；到头了再按不动
  await page.getByRole("button", { name: "移除 甲区" }).focus();
  await page.keyboard.press("Alt+ArrowDown");
  expect(await order()).toEqual(["丙区", "乙区", "甲区"]);
  await page.keyboard.press("Alt+ArrowDown");
  expect(await order()).toEqual(["丙区", "乙区", "甲区"]);
  await expect(page.getByRole("button", { name: "把 甲区 上移" })).toBeFocused();
  await page.keyboard.press("Alt+ArrowUp");
  await page.keyboard.press("Alt+ArrowUp");
  expect(await order()).toEqual(["甲区", "丙区", "乙区"]);
  await page.keyboard.press("Alt+ArrowUp");
  expect(await order()).toEqual(["甲区", "丙区", "乙区"]);
  await expect(rows.locator(".picked__number")).toHaveText(["1", "2", "3"]);

  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(toast(page, "已保存")).toBeVisible();
  const saved = await getJson<{ areas: { area_id: string; priority: number }[] }>(request, supplier.headers, `/tenant/v1/products/${product.id}`);
  expect(saved.areas.map((area) => [area.area_id, area.priority])).toEqual([[supplier.area.id, 0], [third.id, 1], [second.id, 2]]);
  await page.reload();
  await expect(rows).toHaveCount(3);
  expect(await order()).toEqual(["甲区", "丙区", "乙区"]);
  await expect(page.locator(".step__summary")).not.toContainText("有未保存的修改");

  // 移掉中间一个再保存：剩下的顺序不变
  await page.getByRole("button", { name: "移除 丙区" }).click();
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(toast(page, "已保存").last()).toBeVisible();
  expect((await getJson<{ areas: { area_id: string }[] }>(request, supplier.headers, `/tenant/v1/products/${product.id}`)).areas.map((area) => area.area_id)).toEqual([supplier.area.id, second.id]);
});

test("时段输入经真实后端：跨午夜显示「次日」并读回来；到 00:00 是「次日 00:00」；全天存成 00:00–24:00、重新打开还是勾着的；取消全天恢复原来填的；各种写法失去焦点时整理", async ({ page, request }) => {
  test.slow();
  await page.setViewportSize({ width: 1280, height: 800 });
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  const product = await createProduct(request, supplier, world, "charter");
  await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);
  await page.goto(`/products/${product.id}/service-rules`);
  const from = page.getByLabel("服务时间从");
  const to = page.getByLabel("服务时间到");
  const window = page.locator("#service-time");
  const stored = async (): Promise<unknown> => (await getJson<{ rules: { booking: { service_time: unknown }; night: { window: unknown } } }>(request, supplier.headers, `/tenant/v1/products/${product.id}/service-rules`)).rules;

  // 各种写法：失去焦点时整理成 HH:mm
  for (const [typed, tidy] of [["9", "09:00"], ["930", "09:30"], ["9：30", "09:30"], ["9.05", "09:05"], ["０８００", "08:00"]] as const) {
    await from.fill(typed);
    await from.blur();
    await expect(from, typed).toHaveValue(tidy);
  }
  await from.fill("18");
  await to.fill("0");
  await to.blur();
  await expect(to).toHaveValue("00:00");
  await expect(window.getByText("次日", { exact: true })).toBeVisible();
  await expect(window.locator(".readback")).toHaveText("每天 18:00–次日 00:00，共 6 小时");
  await to.fill("2");
  await to.blur();
  await expect(window.locator(".readback")).toHaveText("每天 18:00–次日 02:00，共 8 小时（跨午夜）");
  // 不跨午夜时没有「次日」
  await to.fill("23:30");
  await to.blur();
  await expect(window.getByText("次日", { exact: true })).toHaveCount(0);
  await expect(window.locator(".readback")).toHaveText("每天 18:00–23:30，共 5 小时 30 分钟");
  // 手填 24:00、开始结束相同：保存时指出来
  await to.fill("24:00");
  await page.getByLabel("提前预订时长（小时）").fill("2");
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(page.getByText("请填 00:00 到 23:59 之间的时间").first()).toBeVisible();
  await to.fill("18:00");
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(page.getByText(/开始和结束不能相同。全天都接单请勾「全天 24 小时」/).first()).toBeVisible();

  // 跨午夜的存到后端：就是这两个时刻
  await to.fill("02:00");
  await page.getByRole("checkbox", { name: "收夜间加价" }).check();
  await page.getByLabel("夜间时段从").fill("2200");
  await page.getByLabel("夜间时段到").fill("600");
  await page.getByLabel("夜间加价的金额").fill("3,000");
  await expect(page.locator("#night-body .readback")).toHaveText("每天 22:00–次日 06:00，共 8 小时（跨午夜）");
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(toast(page, "已保存")).toBeVisible();
  expect(await stored()).toMatchObject({ booking: { service_time: { start: "18:00", end: "02:00" }, lead_time_hours: 2 }, night: { window: { start: "22:00", end: "06:00" }, amount: 3000, charge_unit: "per_hour" } });

  // 全天：两格只读显示 00:00 / 24:00，存成 00:00–24:00；重新打开是勾着的；取消后回到勾之前填的
  await page.getByRole("checkbox", { name: "全天 24 小时" }).check();
  await expect(from).toHaveValue("00:00");
  await expect(to).toHaveValue("24:00");
  await expect(from).toHaveAttribute("readonly", "");
  await expect(window.locator(".readback")).toHaveText("全天 24 小时");
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(toast(page, "已保存").last()).toBeVisible();
  expect(await stored()).toMatchObject({ booking: { service_time: { start: "00:00", end: "24:00" } } });
  await page.reload();
  await expect(page.getByRole("checkbox", { name: "全天 24 小时" })).toBeChecked();
  await expect(page.getByLabel("服务时间到")).toHaveValue("24:00");
  await expect(page.locator(".step__summary")).not.toContainText("有未保存的修改");
  await expect(page.getByLabel("夜间时段到")).toHaveValue("06:00");
  await expect(page.locator("#night").getByText("次日", { exact: true })).toBeVisible();
});

test("HTML 字符经真实后端存取后只当文字显示：商品标题、简介、包含、接机指引、调度人姓名、子品牌名、区域名——列表、三个步骤、上架检查、删除确认里都不执行、不变成标签", async ({ page, request }) => {
  test.slow();
  await page.setViewportSize({ width: 1280, height: 800 });
  const world = await createWorld(request);
  const tag = randomLetters(4);
  const mark = (name: string): string => `<img src=x onerror="window.__xss='${name}'"><script>window.__xss='${name}'</script><b>${name}${tag}</b>`;
  const supplier = await createSupplier(request, world, mark("brand").slice(0, 50), mark("area"));
  const product = await createProduct(request, supplier, world, "airport_transfer", { dispatchers: [{ name: `<svg onload="window.__xss='d'">${tag}`, phone: "+81 90 1234 5678" }] });
  const title = `<img src=x onerror="window.__xss='title'">标题${tag}`;
  const content = await request.put(`/tenant/v1/products/${product.id}/content`, {
    headers: { ...supplier.headers, "if-match": `"${product.version}"` },
    data: { zh: { title, summary: mark("summary"), includes: [mark("includes")], excludes: ["</textarea><script>window.__xss='ex'</script>"], pickup_guide: `"><script>window.__xss='guide'</script>javascript:alert(1)` } },
  });
  expect(content.status(), await content.text()).toBe(200);
  const dialogs: string[] = [];
  page.on("dialog", (dialog) => {
    dialogs.push(dialog.message());
    void dialog.dismiss();
  });
  const expectInert = async (what: string): Promise<void> => {
    expect(await page.evaluate(() => (window as unknown as { __xss?: string }).__xss ?? null), `${what}：注入的脚本执行了`).toBeNull();
    expect(await page.locator("main img[src='x'], main script, main svg[onload], main b").count(), `${what}：注入的标签进了页面`).toBe(0);
    expect(dialogs, what).toEqual([]);
  };
  await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);

  await page.goto("/products");
  await expect(page.getByRole("link", { name: title, exact: true })).toBeVisible();
  await expectInert("列表");
  await page.getByRole("button", { name: /的更多操作$/ }).click();
  await page.getByRole("menuitem", { name: "删除" }).click();
  await expect(page.getByRole("dialog")).toContainText(`标题${tag}`);
  await expect(page.getByRole("dialog")).toContainText("<img src=x");
  await expectInert("删除确认");
  await page.getByRole("dialog").getByRole("button", { name: "取消" }).click();

  await page.goto(`/products/${product.id}/basic`);
  await expect(page.getByLabel("第 1 个调度人的姓名")).toHaveValue(`<svg onload="window.__xss='d'">${tag}`);
  await expect(page.locator("[data-area-pick]")).toContainText(`<b>area${tag}</b>`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  await expect(page.locator("dl.details")).toContainText("<img src=x");
  await expectInert("基础信息");
  await page.getByRole("button", { name: "添加区域", exact: true }).click();
  await expect(page.getByRole("group", { name: "添加区域" })).toContainText(`<b>area${tag}</b>`);
  await expectInert("添加区域的面板");
  await page.keyboard.press("Escape");

  await page.goto(`/products/${product.id}/content`);
  await expect(page.getByLabel("标题")).toHaveValue(title);
  await expect(page.getByLabel(/接机指引/)).toHaveValue(`"><script>window.__xss='guide'</script>javascript:alert(1)`);
  await expect(page.getByRole("textbox", { name: "中文不含第 1 条" })).toHaveValue("</textarea><script>window.__xss='ex'</script>");
  await expectInert("商品详情");
  // 原样再存一遍：内容不变，也不算修改
  await expect(page.locator(".step__summary")).not.toContainText("有未保存的修改");

  await page.goto(`/products/${product.id}/service-rules`);
  await expect(page.getByLabel("提前预订时长（小时）")).toBeVisible();
  await expectInert("服务规则");
  await page.goto(`/products/${product.id}/publish`);
  await expect(page.getByRole("heading", { level: 2, name: "上架检查" })).toBeVisible();
  await expect(page.locator('[data-check="price_rules"]')).toContainText("还没有设价格");
  await expectInert("上架检查");
  expect(await page.title()).toContain(`标题${tag}`);

  // 区域列表、首页也一样
  await page.goto("/areas");
  await expect(page.getByRole("row").filter({ hasText: `<b>area${tag}</b>` })).toContainText("1 个商品在用");
  await expectInert("区域列表");
  // 后端存的是原文，没有被改写或转义两次
  const saved = await getJson<{ content: { zh: { title: string; excludes: string[] } } }>(request, supplier.headers, `/tenant/v1/products/${product.id}/content`);
  expect([saved.content.zh.title, saved.content.zh.excludes]).toEqual([title, ["</textarea><script>window.__xss='ex'</script>"]]);
});

test("768px 宽：商品列表、三个步骤（服务规则展开加急、夜间、跨午夜的「次日」）、上架检查都不横向滚动；很长的标题、编号、区域名能折行", async ({ page, request }) => {
  test.slow();
  await page.setViewportSize({ width: 768, height: 1024 });
  const world = await createWorld(request);
  const longArea = `名字很长的区域${"很长".repeat(40)}`;
  const supplier = await createSupplier(request, world, undefined, longArea.slice(0, 100));
  const product = await createProduct(request, supplier, world, "airport_transfer");
  const rules = await request.put(`/tenant/v1/products/${product.id}/service-rules`, {
    headers: { ...supplier.headers, "if-match": `"${product.version}"` },
    data: {
      booking: { sale_from: "2026-10-08", sale_to: "2027-03-31", service_time: { start: "22:00", end: "06:00" }, lead_time_hours: 72, note: "备忘".repeat(200) },
      urgent: { enabled: true, daily_quota: 10000, tiers: [{ within_hours: 48, surcharge: 100000000 }, { within_hours: 24, surcharge: 200000000 }, { within_hours: 6, surcharge: 1000000000 }] },
      night: { enabled: true, window: { start: "22:00", end: "06:00" }, amount: 1000000000, charge_unit: "per_hour" },
      free_wait: { pickup: { mode: "limited", minutes: 1440 }, dropoff: { mode: "unlimited" } },
      addons: [{ addon_id: world.seat.id, unit_price: 1000000000, first_free: true }],
      driver_languages: [{ language: "zh", unit_price: 1000000000 }, { language: "ja", unit_price: 0 }, { language: "en", unit_price: 5000 }],
    },
  });
  expect(rules.status(), await rules.text()).toBe(200);
  const saved = (await rules.json()) as { version: number };
  const content = await request.put(`/tenant/v1/products/${product.id}/content`, { headers: { ...supplier.headers, "if-match": `"${saved.version}"` }, data: { zh: { title: "W".repeat(100), pickup_guide: `https://example.com/${"a".repeat(300)}`, includes: ["x".repeat(200)] }, ja: { title: "とても長いタイトル".repeat(11) } } });
  expect(content.status(), await content.text()).toBe(200);
  await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);

  await page.goto("/products");
  await expect(page.getByRole("link", { name: "W".repeat(100), exact: true })).toBeVisible();
  await expectNoHorizontalOverflow(page, "列表（768px）");
  await page.goto(`/products/${product.id}/basic`);
  await expect(page.locator("[data-area-pick]")).toHaveCount(1);
  await expectNoHorizontalOverflow(page, "基础信息（768px）");
  await page.goto(`/products/${product.id}/service-rules`);
  await expect(page.locator("#service-time").getByText("次日", { exact: true })).toBeVisible();
  await expect(page.locator("#urgent-body .readback__list li")).toHaveCount(4);
  await expect(page.locator(".readback__gap")).toContainText("提前 48 到 72 小时下单：不接");
  await expect(page.getByLabel("第 3 档：加收的金额")).toHaveValue("1000000000");
  await expectNoHorizontalOverflow(page, "服务规则（768px）");
  await page.goto(`/products/${product.id}/content`);
  await expect(page.getByLabel("标题").first()).toHaveValue("W".repeat(100));
  await expectNoHorizontalOverflow(page, "商品详情（768px）");
  await page.goto(`/products/${product.id}/publish`);
  await expect(page.locator('[data-check="content"]')).toContainText("日语还没有填接机指引");
  await expectNoHorizontalOverflow(page, "上架检查（768px）");
});

test("【缺陷】新建商品：保存的请求到了后端、应答在路上丢了——改一处再保存，应该接上已经建好的草稿，而不是从此卡在「系统暂时无法保存」并在列表里留下一个没人知道的草稿", async ({ page, request }) => {
  // 复现：新建页填好点「保存草稿」。请求到达后端并建成草稿，应答没有回到浏览器（这里让浏览器在后端应答之后丢弃这次应答，等同于断网）。
  //       页面提示「网络连接失败」。用户补一个调度人电话，再点「保存草稿」。
  // 期望：页面转到已经建好的那个草稿并把这次的修改存上去（后端的 422 里带着它的编号和版本号，ADR 0015 就是为这种情况留的），
  //       供应商名下只有一个商品。
  // 实际：页面显示「系统暂时无法保存，请稍后再试。」，再点多少次都一样（这一页的幂等键固定不变）；
  //       而后端已经有一个草稿躺在列表里。用户只能刷新、重填，于是又多一个。
  test.slow();
  await page.setViewportSize({ width: 1280, height: 800 });
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);
  await page.goto("/products/new");
  await expect(page.getByText(`${supplier.brand.name}（JPY）`)).toBeVisible();
  const city = page.getByRole("combobox", { name: /城市/ });
  await city.click();
  await city.fill(world.city.code);
  await page.getByRole("option", { name: new RegExp(world.city.name) }).first().click();
  await page.getByRole("radio", { name: /^包车/ }).check();
  await page.getByLabel("第 1 个调度人的姓名").fill("山田");
  await page.getByLabel("第 1 个调度人的电话").fill("0312345678");

  let dropped = 0;
  await page.route("**/tenant/v1/products", async (route) => {
    if (route.request().method() !== "POST" || dropped > 0) return route.continue();
    dropped += 1;
    const response = await route.fetch();
    expect(response.status(), "后端其实建成了").toBe(201);
    await route.abort("connectionreset");
  });
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(page.getByText("网络连接失败，请检查网络后重试。你填写的内容还在。")).toBeVisible();
  const listed = await getJson<{ total: number; items: { id: string }[] }>(request, supplier.headers, "/tenant/v1/products");
  expect(listed.total, "前提：后端已经有这个草稿").toBe(1);

  await page.getByLabel("第 1 个调度人的电话").fill("0398765432");
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(page, "应该来到已经建好的那个草稿").toHaveURL(new RegExp(`/products/${listed.items[0]?.id}/`), { timeout: 8_000 });
  expect((await getJson<{ total: number }>(request, supplier.headers, "/tenant/v1/products")).total).toBe(1);
});

test("【缺陷】平台把附加服务从「按个」改成「按次」计费之后，勾过「第一个免费」的商品在页面上应该还能保存服务规则", async ({ page, request }) => {
  // 复现：商品开着一个按个计费的附加服务并勾了「第一个免费」；平台运营把这个附加服务的计费方式改成按次（主数据页面可以改）。
  //       供应商打开这个商品的 ② 服务规则，只改一下备注，点保存。
  // 期望：保存成功（「第一个免费」对按次计费的附加服务已经没有意义，页面也不再显示这个勾选框）。
  // 实际：保存被拒，页面在附加服务一栏显示「只有按个计费的附加服务（如儿童座椅）可以设「首个免费」」——但页面上已经没有这个勾选框可以取消，
  //       这个商品的服务规则从此改不了任何一项；而上架检查同时显示「服务规则 已满足」。
  test.slow();
  await page.setViewportSize({ width: 1280, height: 800 });
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  const product = await createProduct(request, supplier, world, "charter");
  const rules = await request.put(`/tenant/v1/products/${product.id}/service-rules`, {
    headers: { ...supplier.headers, "if-match": `"${product.version}"` },
    data: { booking: { service_time: { start: "08:00", end: "20:00" }, lead_time_hours: 24 }, free_wait: { general: { mode: "limited", minutes: 0 } }, addons: [{ addon_id: world.seat.id, unit_price: 1000, first_free: true }] },
  });
  expect(rules.status(), await rules.text()).toBe(200);
  const changed = await request.patch(`/platform/v1/master/addons/${world.seat.id}`, { headers: { ...(await platformAdminHeaders(request)), "if-match": `"${world.seat.version}"` }, data: { charge_unit: "per_order" } });
  expect(changed.status(), `平台改计费方式：${await changed.text()}`).toBe(200);

  await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);
  await page.goto(`/products/${product.id}/service-rules`);
  await expect(page.getByLabel(`${world.seat.name}的单价`)).toHaveValue("1000");
  await expect(page.getByRole("checkbox", { name: /第一个免费/ }), "前提：按次计费的没有「第一个免费」可勾").toHaveCount(0);
  await expect(step(page, "服务规则"), "前提：上架检查说服务规则已满足").toContainText("已完成");
  await page.getByLabel(/备注/).fill("只加了一句备注");
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(toast(page, "已保存"), `保存被拒：${await page.locator(".step__alerts").first().innerText().catch(() => "")}`).toBeVisible({ timeout: 8_000 });
});
