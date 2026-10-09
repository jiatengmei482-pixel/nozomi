/**
 * 供应商后台「商品」（M1-03），真实后端、真实 PostgreSQL。
 * 城市、机场、车型组、附加服务经平台接口新建（都是启用的）；供应商和账号经真实的邀请流程创建；
 * 子品牌、商品、服务规则、商品详情都经界面填出来。并行的用例共用一个库，所以每条用自己的城市和随机编码。
 */
import { AxeBuilder } from "@axe-core/playwright";
import { type APIRequestContext, type Locator, type Page, expect, test } from "@playwright/test";
import { createActiveTenant, expectNoHorizontalOverflow, loginAs, newPassword, platformAdminHeaders, randomLetters, snapshot, uniqueEmail } from "./support.ts";

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
  seat: Ref;
  sign: Ref;
}

async function post<T>(request: APIRequestContext, headers: Record<string, string>, path: string, data: unknown, what: string): Promise<T> {
  const response = await request.post(path, { headers, data });
  expect(response.status(), `${what}：${await response.text()}`).toBe(201);
  return (await response.json()) as T;
}

/** 平台这边的主数据：一个城市、城市下的一个机场、一个车型组（两个组合）、两个附加服务（按个、按次）。 */
async function createWorld(request: APIRequestContext): Promise<World> {
  const headers = await platformAdminHeaders(request);
  const tag = randomLetters(5);
  const master = async (kind: string, data: { code: string; name: { zh: string } } & Record<string, unknown>): Promise<Ref> => ({ id: (await post<{ id: string }>(request, headers, `/platform/v1/master/${kind}`, data, `新建${kind}`)).id, code: data.code, name: data.name.zh });
  const city = await master("cities", { code: `CTY-JP-${tag}`, country_code: "JP", name: { zh: `商品城市${tag}` }, timezone: "Asia/Tokyo", center: CENTER });
  // 机场编码是三字码，全库唯一：并行的用例撞上了就换一个
  let airport: Ref | null = null;
  for (let attempt = 0; airport === null && attempt < 8; attempt += 1) {
    const code = `Z${randomLetters(2)}`;
    const response = await request.post("/platform/v1/master/places", { headers, data: { type: "airport", code, city_id: city.id, name: { zh: `商品机场${tag}` }, location: { lat: CENTER.lat - 0.1, lng: CENTER.lng + 0.1 }, flight_scope: "mixed" } });
    if (response.status() === 201) airport = { id: ((await response.json()) as { id: string }).id, code, name: `商品机场${tag}` };
    else expect(response.status(), `新建机场：${await response.text()}`).toBe(409);
  }
  if (airport === null) throw new Error("没有建出机场");
  const group = await master("vehicle-groups", { code: `VG-BIZ${tag}-7`, grade: "business", seats: 7, power: "fuel", name: { zh: `商务七座${tag}` }, sample_models: ["丰田埃尔法"], combos: [{ passengers: 6, luggage: 4 }, { passengers: 5, luggage: 5 }] });
  const all = ["airport_transfer", "point_to_point", "charter"];
  const seat = await master("addons", { code: `ADD-SEAT_${tag}`, categories: all, charge_unit: "per_item", name: { zh: `儿童座椅${tag}` }, description: {} });
  const sign = await master("addons", { code: `ADD-SIGN_${tag}`, categories: ["airport_transfer"], charge_unit: "per_order", name: { zh: `举牌接机${tag}` }, description: {} });
  return { city, airport, group, seat, sign };
}

async function tenantHeaders(request: APIRequestContext, email: string, password: string): Promise<Record<string, string>> {
  const response = await request.post("/tenant/v1/auth/login", { data: { email, password } });
  expect(response.ok(), "供应商账号登录").toBe(true);
  return { authorization: `Bearer ${((await response.json()) as { access_token: string }).access_token}` };
}

async function createArea(request: APIRequestContext, headers: Record<string, string>, city: Ref, name: string, bizType = "general"): Promise<Ref> {
  const ring = [
    [CENTER.lng - 0.1, CENTER.lat - 0.1],
    [CENTER.lng + 0.1, CENTER.lat - 0.1],
    [CENTER.lng + 0.1, CENTER.lat + 0.1],
    [CENTER.lng - 0.1, CENTER.lat + 0.1],
    [CENTER.lng - 0.1, CENTER.lat - 0.1],
  ];
  const area = await post<{ id: string }>(request, { ...headers, "idempotency-key": crypto.randomUUID() }, "/tenant/v1/areas", { city_id: city.id, name: { zh: name }, biz_type: bizType, polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [ring] } }] }, "新建区域");
  return { id: area.id, code: "", name };
}

async function createBrand(request: APIRequestContext, headers: Record<string, string>, name: string, currency = "JPY"): Promise<Ref> {
  const brand = await post<{ id: string }>(request, { ...headers, "idempotency-key": crypto.randomUUID() }, "/tenant/v1/brands", { name, currency }, "新建子品牌");
  return { id: brand.id, code: currency, name };
}

async function createTenantUser(request: APIRequestContext, admin: { adminEmail: string; password: string }, role: string): Promise<{ email: string; password: string }> {
  const headers = await tenantHeaders(request, admin.adminEmail, admin.password);
  const email = uniqueEmail(`tenant-${role}`);
  const invited = await post<{ invite: { token: string } }>(request, headers, "/tenant/v1/users", { email, name: "端到端测试子账号", role }, "邀请子账号");
  const password = newPassword();
  expect((await request.post("/tenant/v1/auth/accept-invite", { data: { token: invited.invite.token, password } })).ok(), "接受邀请").toBe(true);
  return { email, password };
}

async function choose(page: Page, label: RegExp, text: string): Promise<void> {
  const box = page.getByRole("combobox", { name: label });
  await box.click();
  await box.fill(text);
  await page.getByRole("option", { name: new RegExp(text) }).first().click();
}

async function pick(page: Page, button: string, option: string): Promise<void> {
  await page.getByRole("button", { name: button, exact: true }).click();
  const panel = page.getByRole("group", { name: button, exact: true });
  await panel.getByRole("checkbox", { name: new RegExp(option) }).check();
  await panel.getByRole("button", { name: "完成" }).click();
}

const toast = (page: Page, text: string): Locator => page.locator(".toast").filter({ hasText: text });
const step = (page: Page, name: string): Locator => page.getByRole("navigation", { name: "配置步骤" }).locator(".step-nav__item").filter({ hasText: name });
const checkItem = (page: Page, key: string): Locator => page.locator(`[data-check="${key}"]`);
const productIdOf = (page: Page): string => /\/products\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? "";

async function expectAccessible(page: Page, what: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = results.violations.map((violation) => `${violation.id}: ${violation.help}（${violation.nodes.map((node) => node.target.join(" ")).join("；")}）`);
  expect(summary, `${what} 的无障碍问题`).toEqual([]);
}

/** 新建页：选好创建后不能改的几项。 */
async function fillLocked(page: Page, world: World, category: "接送机" | "点对点" | "包车"): Promise<void> {
  await choose(page, /城市/, world.city.code);
  await page.getByRole("radio", { name: new RegExp(`^${category}`) }).check();
  if (category === "接送机") await choose(page, /接送点/, world.airport.code);
}

test("没有子品牌时的引导 → 建子品牌 → 新建接送机商品 → 基础信息、服务规则、商品详情分别保存（中途离开再回来）→ 上架检查说明「不是出错」→ 列表 → 删除草稿", async ({ page, request }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const world = await createWorld(request);
  const tenant = await createActiveTenant(request);
  const headers = await tenantHeaders(request, tenant.adminEmail, tenant.password);
  const area = await createArea(request, headers, world.city, `市区 ${randomLetters(4)}`);
  const second = await createArea(request, headers, world.city, `机场周边 ${randomLetters(4)}`, "airport_transfer");
  await createArea(request, headers, world.city, `包车专用 ${randomLetters(4)}`, "charter");
  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);

  // 首页：有区域、没有商品 → 提醒先建一个商品
  const card = page.locator(".entry-card").filter({ hasText: "商品" });
  await expect(card).toContainText("已上架0");
  await page.getByRole("link", { name: "还没有商品，先建一个" }).click();
  await expect(page).toHaveURL(/\/products\/new$/);
  await expect(page.getByRole("heading", { level: 1, name: "新建商品" })).toBeVisible();
  await expect(step(page, "价格规则")).toContainText("即将开放");
  await expect(step(page, "服务规则")).toContainText("先保存第 1 步");
  await expect(page.getByRole("navigation", { name: "配置步骤" }).getByRole("link")).toHaveCount(0);

  // 还没有子品牌：不能保存，管理员可以当场建
  await expect(page.getByText("还没有子品牌。")).toBeVisible();
  await expect(page.getByRole("button", { name: "保存草稿" })).toBeDisabled();
  await page.getByRole("button", { name: "新建子品牌" }).click();
  const dialog = page.getByRole("dialog", { name: "新建子品牌" });
  await expect(dialog).toContainText("币种创建后不能修改。");
  await dialog.getByRole("button", { name: "新建", exact: true }).click();
  await expect(dialog.getByText("请填写名称")).toBeVisible();
  const brandName = `自营车队 ${randomLetters(4)}`;
  await dialog.getByLabel(/名称/).fill(brandName);
  await dialog.getByLabel(/结算币种/).selectOption("JPY");
  await dialog.getByRole("button", { name: "新建", exact: true }).click();
  await expect(toast(page, `已新建子品牌「${brandName}」`)).toBeVisible();
  await expect(page.getByText(`${brandName}（JPY）`)).toBeVisible();

  // 创建后不能改的几项没填齐就保存：按必填报错
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(page.getByText("有 2 处需要修改")).toBeVisible();
  await fillLocked(page, world, "接送机");
  await expect(page.getByText("这四项创建后不能修改。")).toBeVisible();

  // 服务区域：只列这个城市、适用于接送机的启用中的区域；顺序可以调
  await page.getByRole("button", { name: "添加区域", exact: true }).click();
  const areaPanel = page.getByRole("group", { name: "添加区域" });
  await expect(areaPanel.getByRole("checkbox")).toHaveCount(2);
  await areaPanel.getByRole("checkbox", { name: new RegExp(area.name) }).check();
  await areaPanel.getByRole("checkbox", { name: new RegExp(second.name) }).check();
  await areaPanel.getByRole("button", { name: "完成" }).click();
  await expect(page.locator("[data-area-pick]")).toHaveCount(2);
  await page.getByRole("button", { name: `把 ${second.name} 上移` }).click();
  await expect(page.locator("[data-area-pick]").first()).toContainText(second.name);
  await expect(page.getByRole("button", { name: `把 ${second.name} 下移` })).toBeFocused();

  // 车型组：没选「人数 / 行李数」不能保存
  await pick(page, "添加车型组", world.group.code);
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(page.getByText(`车型组：请给「${world.group.name}」选一个「人数 / 行李数」组合`)).toBeVisible();
  await page.getByLabel(`${world.group.name} 的人数 / 行李数`).selectOption({ label: "6 人 4 件" });
  await page.getByLabel("第 1 个调度人的姓名").fill("山田");
  await page.getByLabel("第 1 个调度人的电话").fill("abc");
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(page.getByText(/第 1 个调度人的电话只能是数字/).first()).toBeVisible();
  await page.getByLabel("第 1 个调度人的电话").fill("+81 90 1234 5678");

  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(toast(page, "已创建商品，现在是草稿")).toBeVisible();
  await expect(page).toHaveURL(/\/products\/[0-9a-f-]{36}\/basic$/);
  const productId = productIdOf(page);
  await expect(page.getByRole("heading", { level: 1, name: "未命名的接送机商品" })).toBeVisible();
  await expect(page.getByText("这个商品还没有名字。")).toBeVisible();
  await expect(step(page, "基础信息")).toContainText("已完成");
  await expect(step(page, "服务规则")).toContainText(/还差 \d 项/);
  await expect(page.getByText("这几项创建后不能修改。要换，请新建一个商品。")).toBeVisible();
  await expect(page.locator("[data-area-pick]").first()).toContainText(second.name);
  await snapshot(page, "products-basic-desktop");

  // ② 服务规则：时间按城市当地时间；跨午夜、加急阶梯的话读回来
  await page.getByRole("button", { name: "保存并下一步" }).click();
  await expect(page).toHaveURL(/\/service-rules$/);
  await expect(page.getByRole("heading", { level: 2, name: "② 服务规则" })).toBeFocused();
  await expect(page.getByText(/Asia\/Tokyo（UTC\+9）/)).toBeVisible();
  await expect(page.getByLabel("接机免费等待的分钟数")).toHaveValue("60");
  await page.getByLabel("服务时间从").fill("6");
  await page.getByLabel("服务时间到").fill("0100");
  await page.getByLabel("服务时间到").blur();
  await expect(page.getByLabel("服务时间从")).toHaveValue("06:00");
  await expect(page.getByText("每天 06:00–次日 01:00，共 19 小时（跨午夜）")).toBeVisible();
  await page.getByLabel("提前预订时长（小时）").fill("24");
  await page.getByRole("checkbox", { name: "允许加急预订" }).check();
  await page.getByLabel("第 1 档：提前不足多少小时").fill("6");
  await page.getByLabel("第 1 档：加收的金额").fill("5000");
  await expect(page.getByText("提前不足 6 小时下单：加收 JPY 5,000")).toBeVisible();
  await expect(page.locator(".readback__gap")).toContainText("提前 6 到 24 小时下单：不接");
  await page.getByRole("checkbox", { name: "收夜间加价" }).check();
  await expect(page.getByRole("radio", { name: /^按次/ })).toBeChecked();
  await page.getByLabel("夜间时段从").fill("22:00");
  await page.getByLabel("夜间时段到").fill("5");
  await page.getByLabel("夜间加价的金额").fill("1.5");
  await page.getByRole("checkbox", { name: new RegExp(world.seat.name) }).check();
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(page.getByText("有 2 处需要修改")).toBeVisible();
  await expect(page.getByText("JPY没有小数，请填整数").first()).toBeVisible();
  await expect(page.getByText("请填单价，免费提供请填 0").first()).toBeVisible();
  await page.getByLabel("夜间加价的金额").fill("2000");
  await page.getByLabel(`${world.seat.name}的单价`).fill("1000");
  await page.getByRole("checkbox", { name: /第一个免费/ }).check();
  await page.getByRole("button", { name: "添加语言" }).click();
  await page.getByLabel("第 1 行：语言").selectOption({ label: "中文" });
  await page.getByLabel("第 1 行：单价").fill("0");
  await snapshot(page, "products-rules-desktop");

  // 有未保存的修改时换步骤：先问；选「保存并继续」
  await step(page, "商品详情").click();
  const leave = page.getByRole("dialog", { name: "这一步有未保存的修改" });
  await expect(leave).toBeVisible();
  await leave.getByRole("button", { name: "继续编辑" }).click();
  await expect(page).toHaveURL(/\/service-rules$/);
  await step(page, "商品详情").click();
  await leave.getByRole("button", { name: "保存并继续" }).click();
  await expect(toast(page, "已保存")).toBeVisible();
  await expect(page).toHaveURL(/\/content$/);
  await expect(step(page, "服务规则")).toContainText("已完成");

  // ⑤ 商品详情：先只填标题，离开再回来
  await page.getByLabel("标题").fill("羽田机场接送");
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(toast(page, "已保存").last()).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "羽田机场接送" })).toBeVisible();
  await expect(step(page, "商品详情")).toContainText("还差 1 项");
  await page.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "商品" }).click();
  const row = page.getByRole("row").filter({ has: page.getByRole("link", { name: "羽田机场接送", exact: true }) });
  await expect(row).toContainText("草稿");
  await expect(row).toContainText("接送机");
  await expect(row).toContainText(world.city.name);
  await expect(row).toContainText(world.airport.name);
  await expect(row.getByRole("link", { name: /的上架检查：还差 1 项/ })).toBeVisible();

  // 回来：/products/{id} 换到第一个还没完成的步骤；服务规则存的都在
  await row.getByRole("link", { name: "羽田机场接送", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/products/${productId}/content$`));
  await step(page, "服务规则").click();
  await expect(page.getByLabel("服务时间到")).toHaveValue("01:00");
  await expect(page.getByLabel("第 1 档：加收的金额")).toHaveValue("5000");
  await expect(page.getByLabel("夜间时段到")).toHaveValue("05:00");
  await expect(page.getByLabel(`${world.seat.name}的单价`)).toHaveValue("1000");
  await expect(page.getByRole("checkbox", { name: /第一个免费/ })).toBeChecked();
  await expect(page.getByLabel("第 1 行：语言")).toHaveValue("zh");

  // 上架检查：还差接机指引；「去填」直接落在那个输入框上
  await step(page, "上架检查").click();
  await expect(page.getByRole("heading", { level: 2, name: "上架检查" })).toBeVisible();
  await expect(page.getByText("还不能上架：还有 1 项要补", { exact: true })).toBeVisible();
  await expect(checkItem(page, "basic_info")).toContainText("已满足");
  await expect(checkItem(page, "service_rules")).toContainText("已满足");
  await expect(checkItem(page, "content")).toContainText("中文还没有填接机指引");
  await expect(checkItem(page, "price_rules")).toContainText("功能即将开放");
  await expect(checkItem(page, "price_rules")).toContainText("不是出错");
  await expect(checkItem(page, "inventory")).toContainText("不是必须");
  await expect(page.getByRole("button", { name: "上架", exact: true })).toHaveAttribute("aria-disabled", "true");
  await page.getByRole("link", { name: "去填：中文还没有填接机指引" }).click();
  await expect(page.getByLabel(/接机指引/)).toBeFocused();
  await expect(page.getByText("上架前要填这一项。")).toBeVisible();
  await page.getByLabel(/接机指引/).fill("到达大厅 2 号出口，司机举 NOZOMI 的牌子。");
  await page.getByRole("button", { name: "添加一条" }).first().click();
  await page.getByRole("textbox", { name: "中文包含第 1 条" }).fill("高速费");
  await page.getByRole("button", { name: "保存并看上架检查" }).click();
  await expect(page).toHaveURL(/\/publish$/);

  // 自己能配的都配好了：信息色的说明，不是出错；点上架被后端拒绝也说得清
  await expect(page.getByText("你能配的都配好了，现在还不能上架")).toBeVisible();
  await expect(page.getByText("这不是出错。")).toBeVisible();
  await expect(page.locator(".checklist-card .alert--danger")).toHaveCount(0);
  await expect(page.getByText(/失败|未通过/)).toHaveCount(0);
  await expect(step(page, "上架检查")).toContainText("等待开放 1 步");
  await expect(page.getByText("已完成 3 / 5")).toBeVisible();
  await expect(page.locator("#publish-note")).toHaveText("还不能上架：「价格规则」开放并配好以后才能上架。");
  // 禁用的「上架」键盘到得了、读得到原因，点了不做任何事
  await page.getByRole("button", { name: "上架", exact: true }).click({ force: true });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const published = await request.post(`/tenant/v1/products/${productId}/publish`, { headers });
  expect(published.status(), "后端：价格规则上线前不能上架").toBe(409);
  expect(((await published.json()) as { error: { code: string } }).error.code).toBe("PUBLISH_CHECK_FAILED");
  await expectNoHorizontalOverflow(page, "上架检查");
  await snapshot(page, "products-publish-desktop");

  // 区域被商品选了：区域列表上看得到
  await page.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "区域" }).click();
  await expect(page.getByRole("row").filter({ hasText: area.name })).toContainText("1 个商品在用");

  // 列表：按品类筛、搜编号；删除草稿
  await page.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "商品" }).click();
  await expect(row.getByRole("link", { name: /的上架检查：等待开放 1 步/ })).toBeVisible();
  await row.getByRole("button", { name: "羽田机场接送 的更多操作" }).click();
  await page.getByRole("menuitem", { name: "删除" }).click();
  const remove = page.getByRole("dialog", { name: "删除草稿「羽田机场接送」？" });
  await expect(remove).toContainText("删除后不能恢复");
  await remove.getByRole("button", { name: "删除", exact: true }).click();
  await expect(toast(page, "已删除草稿「羽田机场接送」")).toBeVisible();
  await expect(page.getByRole("link", { name: "羽田机场接送", exact: true })).toHaveCount(0);
  expect((await request.get(`/tenant/v1/products/${productId}`, { headers })).status()).toBe(404);
});
