/**
 * 供应商后台「区域」（M1-02），真实后端、真实 PostgreSQL、真实浏览器里的地图。
 * 底图来自 global-setup 起的本机假瓦片服务（从不请求任何真实的底图服务）；
 * 城市经平台接口新建，供应商和账号经真实的邀请流程创建，区域全部经界面画出来或填出来。
 */
import { AxeBuilder } from "@axe-core/playwright";
import { type APIRequestContext, type Locator, type Page, expect, test } from "@playwright/test";
import { E2E_API_NO_MAP_PORT, E2E_TILE_PORT } from "../playwright.config.ts";
import { createActiveTenant, expectNoHorizontalOverflow, loginAs, newPassword, platformAdminHeaders, randomLetters, snapshot, uniqueEmail } from "./support.ts";

const CENTER = { lat: 35.6895, lng: 139.6917 };

interface City {
  id: string;
  code: string;
  name: string;
}

async function createCity(request: APIRequestContext): Promise<City> {
  const headers = await platformAdminHeaders(request);
  const code = `CTY-JP-${randomLetters(5)}`;
  const name = `区域城市${code.slice(-5)}`;
  const response = await request.post("/platform/v1/master/cities", { headers, data: { code, country_code: "JP", name: { zh: name }, timezone: "Asia/Tokyo", center: CENTER } });
  expect(response.status(), "接口新建城市").toBe(201);
  return { id: ((await response.json()) as { id: string }).id, code, name };
}

async function tenantHeaders(request: APIRequestContext, email: string, password: string): Promise<Record<string, string>> {
  const response = await request.post("/tenant/v1/auth/login", { data: { email, password } });
  expect(response.ok(), "供应商账号登录").toBe(true);
  return { authorization: `Bearer ${((await response.json()) as { access_token: string }).access_token}` };
}

/** 在这个供应商下邀请一个子账号并接受邀请，得到可以直接登录的账号。 */
async function createTenantUser(request: APIRequestContext, admin: { adminEmail: string; password: string }, role: string): Promise<{ email: string; password: string }> {
  const headers = await tenantHeaders(request, admin.adminEmail, admin.password);
  const email = uniqueEmail(`tenant-${role}`);
  const invited = await request.post("/tenant/v1/users", { headers, data: { email, name: "端到端测试子账号", role } });
  expect(invited.status(), "邀请子账号").toBe(201);
  const password = newPassword();
  const accepted = await request.post("/tenant/v1/auth/accept-invite", { data: { token: ((await invited.json()) as { invite: { token: string } }).invite.token, password } });
  expect(accepted.ok(), "接受邀请").toBe(true);
  return { email, password };
}

/** 一个边长约 0.2 度、把城市中心包在里面的矩形（逆时针，[经度, 纬度]）。 */
function square(half = 0.1, center = CENTER): [number, number][] {
  return [
    [center.lng - half, center.lat - half],
    [center.lng + half, center.lat - half],
    [center.lng + half, center.lat + half],
    [center.lng - half, center.lat + half],
  ];
}

function polygonGeometry(ring: [number, number][]): { type: "Polygon"; coordinates: [number, number][][] } {
  return { type: "Polygon", coordinates: [[...ring, ring[0] as [number, number]]] };
}

async function createAreaByApi(request: APIRequestContext, headers: Record<string, string>, city: City, name: string): Promise<{ id: string; version: number }> {
  const response = await request.post("/tenant/v1/areas", {
    headers: { ...headers, "idempotency-key": crypto.randomUUID() },
    data: { city_id: city.id, name: { zh: name }, biz_type: "general", polygons: [{ kind: "operate", geometry: polygonGeometry(square()) }] },
  });
  expect(response.status(), "接口新建区域").toBe(201);
  return (await response.json()) as { id: string; version: number };
}

async function tileStats(request: APIRequestContext): Promise<{ tiles: number; referers: string[] }> {
  const response = await request.get(`http://127.0.0.1:${E2E_TILE_PORT}/stats`);
  return (await response.json()) as { tiles: number; referers: string[] };
}

async function chooseCity(page: Page, city: City): Promise<void> {
  const box = page.getByRole("combobox", { name: /城市/ });
  await box.click();
  await box.fill(city.code);
  await page.getByRole("option", { name: new RegExp(city.code) }).first().click();
}

const group = (page: Page, kind: "营运区" | "禁行区"): Locator => page.locator(".shape-group").filter({ has: page.getByRole("heading", { level: 3, name: new RegExp(`^${kind}（`) }) });
const shapeItem = (page: Page, name: string): Locator => page.locator(".shape").filter({ has: page.locator(".shape__name", { hasText: new RegExp(`^${name}`) }) });

async function fillPoint(page: Page, shape: string, index: number, lat: number, lng: number): Promise<void> {
  await page.getByLabel(`${shape} 第 ${index} 个点的纬度`).fill(String(lat));
  await page.getByLabel(`${shape} 第 ${index} 个点的经度`).fill(String(lng));
}

/** 地图画布上相对中心的一个位置（像素）。 */
async function mapPoint(page: Page, dx: number, dy: number): Promise<{ x: number; y: number }> {
  const box = await page.locator(".area-map__canvas").boundingBox();
  if (!box) throw new Error("地图画布不在页面上");
  return { x: box.x + box.width / 2 + dx, y: box.y + box.height / 2 + dy };
}

async function clickMap(page: Page, dx: number, dy: number): Promise<void> {
  const at = await mapPoint(page, dx, dy);
  await page.mouse.click(at.x, at.y);
}

async function selfTest(page: Page, lat: number, lng: number): Promise<Locator> {
  const card = page.locator(".area-editor__probe");
  await card.getByLabel("纬度").fill(String(lat));
  await card.getByLabel("经度").fill(String(lng));
  await card.getByRole("button", { name: "检查" }).click();
  return card.locator(".probe");
}

async function expectAccessible(page: Page, what: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = results.violations.map((violation) => `${violation.id}: ${violation.help}（${violation.nodes.map((node) => node.target.join(" ")).join("；")}）`);
  expect(summary, `${what} 的无障碍问题`).toEqual([]);
}

test("首页引导 → 新增区域：坐标表填营运区、在地图上用鼠标画禁行区和圆、拖动顶点 → 保存 → 列表 → 再打开 → 自测三种结果", async ({ page, request }) => {
  test.slow();
  await page.setViewportSize({ width: 1280, height: 800 });
  const city = await createCity(request);
  const tenant = await createActiveTenant(request);
  const areaName = `东京市区 ${randomLetters(4)}`;
  const before = await tileStats(request);
  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);

  // 首页：区域卡片的数量来自接口；一个区域都没有时提醒先建一个
  const card = page.locator(".entry-card").filter({ hasText: "区域" });
  await expect(card).toContainText("启用0");
  await expect(card).toContainText("已停用0");
  await expect(page.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "区域" })).toBeVisible();
  await page.getByRole("link", { name: "还没有区域，先建一个" }).click();
  await expect(page).toHaveURL(/\/areas\/new$/);
  await expect(page.getByRole("heading", { level: 1, name: "新增区域" })).toBeVisible();

  // 没选城市：画图工具不可用
  await expect(page.getByRole("button", { name: "画多边形" })).toBeDisabled();
  await chooseCity(page, city);
  await page.getByLabel("中文").fill(areaName);

  // 地图出来了：底图来自配置里的瓦片地址，署名来自配置
  await expect(page.getByRole("application")).toBeVisible();
  await expect(page.locator(".area-map__attribution")).toContainText("© 端到端测试底图");
  await expect.poll(async () => (await tileStats(request)).tiles).toBeGreaterThan(before.tiles);
  // 取底图时带出去的来源信息按配置（默认 strict-origin）：只有本站的来源，没有页面地址
  expect((await tileStats(request)).referers).toEqual([`${new URL(page.url()).origin}/`]);

  // 营运区：不碰地图，逐点输入坐标（先三个点，再加一个点）
  await group(page, "营运区").getByRole("button", { name: /添加营运区/ }).click();
  await page.getByRole("menuitem", { name: "逐点输入坐标" }).click();
  const ring = square();
  for (const [index, point] of ring.slice(0, 3).entries()) await fillPoint(page, "营运 1", index + 1, point[1], point[0]);
  await page.getByRole("button", { name: "在 营运 1 第 3 个点后面加一个点" }).click();
  await fillPoint(page, "营运 1", 4, (ring[3] as [number, number])[1], (ring[3] as [number, number])[0]);
  await expect(shapeItem(page, "营运 1")).toContainText("多边形 · 4 个点");
  await page.getByRole("button", { name: "看全部图形" }).click();
  await expect(page.locator(".area-map__overlay .area-stroke--operate")).toHaveCount(1);

  // 禁行区：在地图上用鼠标画一个把城市中心围住的三角形，双击完成
  await page.getByRole("group", { name: "新图形是" }).getByRole("radio", { name: "禁行区", exact: true }).check();
  await page.getByRole("button", { name: "画多边形" }).click();
  await expect(page.locator(".area-map__hint")).toContainText("点地图加点");
  await clickMap(page, -60, 40);
  await clickMap(page, 60, 40);
  const top = await mapPoint(page, 0, -60);
  await page.mouse.dblclick(top.x, top.y);
  await expect(group(page, "禁行区").getByRole("heading", { level: 3 })).toHaveText("禁行区（1）");
  await expect(shapeItem(page, "禁行 1")).toContainText("多边形 · 3 个点");
  await expect(page.getByRole("button", { name: "选择" })).toHaveAttribute("aria-pressed", "true");

  // 圆：营运区，点一下定圆心，再点一下定半径
  await page.getByRole("group", { name: "新图形是" }).getByRole("radio", { name: "营运区", exact: true }).check();
  await page.getByRole("button", { name: "画圆" }).click();
  await clickMap(page, 200, -100);
  await clickMap(page, 240, -100);
  await expect(group(page, "营运区").getByRole("heading", { level: 3 })).toHaveText("营运区（2）");
  await expect(shapeItem(page, "营运 2")).toContainText(/圆 · 半径 [\d.]+ 公里/);
  // 刚画的圆是选中的：拖半径上的控制点往外，半径跟着变大
  const radiusBox = page.getByLabel("营运 2 半径（公里）");
  const radiusBefore = Number(await radiusBox.inputValue());
  const radiusHandle = await page.locator(".area-map__overlay .area-handle--radius").boundingBox();
  const circleCenter = await mapPoint(page, 200, -100);
  if (!radiusHandle) throw new Error("没有找到半径的控制点");
  const from = { x: radiusHandle.x + radiusHandle.width / 2, y: radiusHandle.y + radiusHandle.height / 2 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + (from.x - circleCenter.x) * 0.5, from.y + (from.y - circleCenter.y) * 0.5, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Number(await radiusBox.inputValue())).toBeGreaterThan(radiusBefore);

  // 拖动顶点：选中禁行 1，把它的第 3 个点（最上面那个）再往上拖，坐标表跟着变
  await shapeItem(page, "禁行 1").locator(".shape__toggle").click();
  const latBox = page.getByLabel("禁行 1 第 3 个点的纬度");
  const latBefore = Number(await latBox.inputValue());
  const handle = page.locator(".area-map__overlay circle.area-handle:not(.area-handle--mid)").nth(2);
  const handleBox = await handle.boundingBox();
  if (!handleBox) throw new Error("没有找到顶点的控制点");
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y - 30, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Number(await latBox.inputValue())).toBeGreaterThan(latBefore);
  // 撤销一步回到拖之前，重做再回来
  const latAfter = Number(await latBox.inputValue());
  await page.getByRole("button", { name: "撤销" }).click();
  await expect.poll(async () => Number(await latBox.inputValue())).toBe(latBefore);
  await page.getByRole("button", { name: "重做" }).click();
  await expect.poll(async () => Number(await latBox.inputValue())).toBe(latAfter);
  await snapshot(page, "areas-editor-desktop");

  // 没保存时自测：按画面上的图形判断
  const local = await selfTest(page, CENTER.lat, CENTER.lng);
  await expect(local).toContainText("在禁行区内");
  await expect(local).toContainText("按画面上还没保存的图形判断");

  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page).toHaveURL(/\/areas$/);
  await expect(page.locator(".toast").filter({ hasText: `已新增区域「${areaName}」` })).toBeVisible();
  const row = page.getByRole("row").filter({ has: page.getByRole("link", { name: areaName, exact: true }) });
  await expect(row).toContainText(city.name);
  await expect(row).toContainText("通用");
  await expect(row).toContainText("启用");

  // 再打开：图形都在；自测走后端的判断
  await row.getByRole("link", { name: areaName, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: areaName })).toBeVisible();
  await expect(group(page, "营运区").getByRole("heading", { level: 3 })).toHaveText("营运区（2）");
  await expect(group(page, "禁行区").getByRole("heading", { level: 3 })).toHaveText("禁行区（1）");
  await expect(page.locator(".area-map__overlay .area-stroke--forbid")).toHaveCount(1);

  const inForbid = await selfTest(page, CENTER.lat, CENTER.lng);
  await expect(inForbid).toContainText("在禁行区内");
  await expect(inForbid).toContainText("禁行区优先");
  await expect(inForbid).not.toContainText("按画面上还没保存的图形判断");
  await expect(await selfTest(page, CENTER.lat - 0.09, CENTER.lng - 0.09)).toContainText("在营运区内");
  await expect(await selfTest(page, CENTER.lat + 1, CENTER.lng + 1)).toContainText("不在营运区内");
  await expect(page.locator(".area-probe__pin").first()).toBeVisible();
  await expectNoHorizontalOverflow(page, "区域编辑页");

  // 回到首页：数量变了，提醒没了
  await page.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "首页" }).click();
  await expect(page.locator(".entry-card").filter({ hasText: "区域" })).toContainText("启用1");
  await expect(page.getByRole("link", { name: "还没有区域，先建一个" })).toHaveCount(0);
});

test("粘贴 WKT 新增 → 同一个城市重名被拒、改名后保存 → 别人先改了：复制、载入最新内容 → 停用、启用、删除", async ({ page, request }) => {
  test.slow();
  await page.setViewportSize({ width: 1280, height: 800 });
  const city = await createCity(request);
  const tenant = await createActiveTenant(request);
  const headers = await tenantHeaders(request, tenant.adminEmail, tenant.password);
  const takenName = `机场周边 ${randomLetters(4)}`;
  const existing = await createAreaByApi(request, headers, city, takenName);
  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);

  // 新增：粘贴 WKT（经度在前），名称故意和已有的一样
  await page.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "区域" }).click();
  await page.getByRole("link", { name: "新增区域" }).click();
  await chooseCity(page, city);
  await page.getByLabel("中文").fill(takenName);
  await page.getByRole("toolbar", { name: "绘制工具" }).getByRole("button", { name: "粘贴坐标" }).click();
  const dialog = page.getByRole("dialog", { name: "粘贴坐标" });
  const ring = square(0.05);
  const wkt = `POLYGON((${[...ring, ring[0] as [number, number]].map((point) => `${point[0]} ${point[1]}`).join(", ")}))`;
  await dialog.getByLabel(/内容/).fill("POLYGON((1 2, 3");
  await dialog.getByRole("button", { name: "添加到地图" }).click();
  await expect(dialog.locator(".field__error")).toBeVisible();
  await expect(dialog.getByLabel(/内容/)).toBeFocused();
  await dialog.getByLabel(/内容/).fill(wkt);
  await expect(dialog.getByRole("status")).toContainText("识别为 WKT：1 个多边形，共 4 个点。");
  await dialog.getByRole("button", { name: "添加到地图" }).click();
  await expect(dialog).toBeHidden();
  await expect(shapeItem(page, "营运 1")).toContainText("多边形 · 4 个点");
  await expect(page.locator(".area-map__overlay .area-stroke--operate")).toHaveCount(1);

  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("已经有同名的区域了，请换一个名称。")).toBeVisible();
  await expect(page).toHaveURL(/\/areas\/new$/);
  await expect(shapeItem(page, "营运 1")).toBeVisible();
  const ownName = `机场周边二 ${randomLetters(4)}`;
  await page.getByLabel("中文").fill(ownName);
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page).toHaveURL(/\/areas$/);
  await expect(page.getByRole("link", { name: ownName, exact: true })).toBeVisible();

  // 别人先改了：打开已有的那个，接口另改一次，再在页面上保存
  await page.getByRole("link", { name: takenName, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: takenName })).toBeVisible();
  const renamed = `别人改过 ${randomLetters(4)}`;
  const changed = await request.put(`/tenant/v1/areas/${existing.id}`, {
    headers: { ...headers, "if-match": `"${existing.version}"` },
    data: { name: { zh: renamed }, biz_type: "charter", polygons: [{ kind: "operate", geometry: polygonGeometry(square(0.2)) }] },
  });
  expect(changed.status(), "接口修改区域").toBe(200);
  await page.getByLabel("日语").fill("空港周辺");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("这个区域刚被别人修改过，你的修改还没有保存。")).toBeVisible();
  await expect(page.getByRole("button", { name: "保存", exact: true })).toBeDisabled();
  await expect(page.getByLabel("日语")).toHaveValue("空港周辺");
  await page.getByRole("button", { name: "载入最新内容" }).click();
  await expect(page.getByText("已载入最新内容。")).toBeVisible();
  await expect(page.getByLabel("中文")).toHaveValue(renamed);
  await expect(page.getByLabel("日语")).toHaveValue("");
  await expect(page.getByRole("radio", { name: /^包车/ })).toBeChecked();
  await expect(page.getByRole("button", { name: "保存", exact: true })).toBeEnabled();

  // 编辑页的「更多」：停用要确认，启用不用
  await page.getByRole("button", { name: `${renamed} 的更多操作` }).click();
  await page.getByRole("menuitem", { name: "停用" }).click();
  const confirm = page.getByRole("dialog", { name: `停用区域「${renamed}」？` });
  await expect(confirm).toContainText("之后可以重新启用");
  await confirm.getByRole("button", { name: "停用", exact: true }).click();
  await expect(page.locator(".toast").filter({ hasText: `已停用「${renamed}」` })).toBeVisible();
  await expect(page.locator(".page__header, .page__meta").getByText("已停用").first()).toBeVisible();

  // 列表：按状态筛出它，启用，再删除
  await page.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "区域" }).click();
  const row = page.getByRole("row").filter({ has: page.getByRole("link", { name: renamed, exact: true }) });
  await expect(row).toContainText("已停用");
  await row.getByRole("button", { name: `${renamed} 的更多操作` }).click();
  await page.getByRole("menuitem", { name: "启用" }).click();
  await expect(page.locator(".toast").filter({ hasText: `已启用「${renamed}」` })).toBeVisible();
  await expect(row).not.toContainText("已停用");
  await row.getByRole("button", { name: `${renamed} 的更多操作` }).click();
  await page.getByRole("menuitem", { name: "删除" }).click();
  const remove = page.getByRole("dialog", { name: `删除区域「${renamed}」？` });
  await expect(remove).toContainText("删除后不能恢复");
  await remove.getByRole("button", { name: "删除", exact: true }).click();
  await expect(page.locator(".toast").filter({ hasText: `已删除区域「${renamed}」` })).toBeVisible();
  await expect(page.getByRole("link", { name: renamed, exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: ownName, exact: true })).toBeVisible();
  expect((await request.get(`/tenant/v1/areas/${existing.id}`, { headers })).status()).toBe(404);
});

test("只读角色能看不能改；另一个供应商看不到也打不开这个区域", async ({ page, request, browser }) => {
  test.slow();
  const city = await createCity(request);
  const tenant = await createActiveTenant(request);
  const headers = await tenantHeaders(request, tenant.adminEmail, tenant.password);
  const name = `只读可见 ${randomLetters(4)}`;
  const area = await createAreaByApi(request, headers, city, name);
  const viewer = await createTenantUser(request, tenant, "readonly");

  await loginAs(page, "tenant", viewer.email, viewer.password);
  await page.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "区域" }).click();
  await expect(page.getByRole("link", { name: "新增区域" })).toHaveCount(0);
  const row = page.getByRole("row").filter({ has: page.getByRole("link", { name, exact: true }) });
  await expect(row.getByRole("button", { name: /更多操作/ })).toHaveCount(0);
  await row.getByRole("link", { name, exact: true }).click();
  await expect(page.getByText("你可以查看区域，但不能修改。")).toBeVisible();
  await expect(page.getByRole("toolbar", { name: "绘制工具" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "保存", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /添加营运区/ })).toHaveCount(0);
  await expect(page.locator(".area-map__overlay .area-stroke--operate")).toHaveCount(1);
  await expect(page.locator(".area-map__overlay .area-handle")).toHaveCount(0);
  // 只读也能自测
  await expect(await selfTest(page, CENTER.lat, CENTER.lng)).toContainText("在营运区内");
  await page.goto("/areas/new");
  await expect(page.getByText("你没有权限查看这里")).toBeVisible();

  // 另一个供应商
  const other = await createActiveTenant(request);
  const context = await browser.newContext();
  const otherPage = await context.newPage();
  try {
    await loginAs(otherPage, "tenant", other.adminEmail, other.password);
    await otherPage.goto("/areas");
    await expect(otherPage.getByRole("heading", { level: 2, name: "还没有区域" }).or(otherPage.getByText("还没有区域").first())).toBeVisible();
    await expect(otherPage.getByRole("link", { name, exact: true })).toHaveCount(0);
    await otherPage.goto(`/areas/${area.id}`);
    await expect(otherPage.getByText("找不到这个区域")).toBeVisible();
  } finally {
    await context.close();
  }
});

test("没有配置底图（320px 宽）：不靠地图，用坐标表和圆的字段建区域、自测、保存、再打开；页面不横向滚动，也不请求任何底图", async ({ page, request }) => {
  test.slow();
  await page.setViewportSize({ width: 320, height: 640 });
  const city = await createCity(request);
  const tenant = await createActiveTenant(request);
  const name = `无底图 ${randomLetters(4)}`;
  // 这一页的底图配置取自另一个没有配置底图的 API 进程（同一个库、同一把签名密钥）——是真实后端在「没配底图」时的应答
  await page.route("**/tenant/v1/map/config", async (route) => {
    const response = await request.get(`http://127.0.0.1:${E2E_API_NO_MAP_PORT}/tenant/v1/map/config`, { headers: { authorization: route.request().headers()["authorization"] ?? "" } });
    expect(response.status(), "没有配置底图的 API 的 map/config").toBe(200);
    expect(((await response.json()) as { tiles: unknown }).tiles).toBeNull();
    await route.fulfill({ response });
  });
  const tileRequests: string[] = [];
  page.on("request", (sent) => {
    if (sent.url().startsWith(`http://127.0.0.1:${E2E_TILE_PORT}/`)) tileRequests.push(sent.url());
  });

  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
  await page.goto("/areas");
  await expect(page.getByText("还没有区域").first()).toBeVisible();
  await expectNoHorizontalOverflow(page, "区域列表（空）");
  await page.getByRole("link", { name: "新增区域" }).first().click();
  await chooseCity(page, city);
  await page.getByLabel("中文").fill(name);
  await expect(page.getByText("这个环境没有配置地图底图。")).toBeVisible();
  await expect(page.getByRole("application")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "画多边形" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "画圆" })).toBeDisabled();

  // 什么都没画就保存：说明要改哪里
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "处需要修改" })).toBeVisible();

  await group(page, "营运区").getByRole("button", { name: /添加营运区/ }).click();
  await page.getByRole("menuitem", { name: "逐点输入坐标" }).click();
  for (const [index, point] of [square()[0], square()[1], square()[2]].entries()) await fillPoint(page, "营运 1", index + 1, (point as [number, number])[1], (point as [number, number])[0]);
  await expect(page.getByRole("alert").filter({ hasText: "处需要修改" })).toHaveCount(0);

  await group(page, "禁行区").getByRole("button", { name: /添加禁行区/ }).click();
  await page.getByRole("menuitem", { name: "输入圆心和半径" }).click();
  await page.getByLabel("禁行 1 圆心纬度").fill(String(CENTER.lat - 0.05));
  await page.getByLabel("禁行 1 圆心经度").fill(String(CENTER.lng + 0.05));
  await page.getByLabel("禁行 1 半径（公里）").fill("1.5");
  await expect(shapeItem(page, "禁行 1")).toContainText("圆 · 半径 1.5 公里");
  await expectNoHorizontalOverflow(page, "区域编辑页（没有底图）");
  await snapshot(page, "areas-editor-320-no-map");

  // 自测：没有「在地图上点」，输入坐标照常
  await expect(page.getByRole("button", { name: "在地图上点" })).toHaveCount(0);
  await expect(await selfTest(page, CENTER.lat - 0.05, CENTER.lng + 0.05)).toContainText("在禁行区内");
  await expect(await selfTest(page, CENTER.lat - 0.09, CENTER.lng + 0.09)).toContainText("在营运区内");
  await expect(await selfTest(page, CENTER.lat + 0.09, CENTER.lng - 0.09)).toContainText("不在营运区内");
  await expectNoHorizontalOverflow(page, "区域编辑页（自测之后）");

  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page).toHaveURL(/\/areas$/);
  await expect(page.getByText(name).first()).toBeVisible();
  await expectNoHorizontalOverflow(page, "区域列表");
  await snapshot(page, "areas-list-320");

  await page.getByRole("link", { name, exact: true }).first().click();
  await expect(shapeItem(page, "营运 1")).toContainText("多边形 · 3 个点");
  await expect(shapeItem(page, "禁行 1")).toContainText("圆 · 半径 1.5 公里");
  const saved = await selfTest(page, CENTER.lat - 0.05, CENTER.lng + 0.05);
  await expect(saved).toContainText("在禁行区内");
  await expect(saved).not.toContainText("按画面上还没保存的图形判断");
  expect(tileRequests, "没有配置底图时不应请求任何底图").toEqual([]);
});

test("底图取不到（瓦片服务不通）：有提示，图形照常显示、照常能改", async ({ page, request }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const city = await createCity(request);
  const tenant = await createActiveTenant(request);
  const headers = await tenantHeaders(request, tenant.adminEmail, tenant.password);
  const name = `底图不通 ${randomLetters(4)}`;
  const area = await createAreaByApi(request, headers, city, name);
  await page.route(`http://127.0.0.1:${E2E_TILE_PORT}/**`, (route) => route.abort("connectionrefused"));
  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
  await page.goto(`/areas/${area.id}`);
  await expect(page.getByText("底图没有加载出来。")).toBeVisible();
  await expect(page.locator(".area-map__overlay .area-stroke--operate")).toHaveCount(1);
  await shapeItem(page, "营运 1").locator(".shape__toggle").click();
  await expect(page.locator(".area-map__overlay circle.area-handle:not(.area-handle--mid)")).toHaveCount(4);
  // 拖一条边中间的点：在这条边上加出一个顶点
  const middle = await page.locator(".area-map__overlay .area-handle--mid").first().boundingBox();
  if (!middle) throw new Error("没有找到边中间的控制点");
  await page.mouse.move(middle.x + middle.width / 2, middle.y + middle.height / 2);
  await page.mouse.down();
  await page.mouse.move(middle.x + middle.width / 2 + 20, middle.y + middle.height / 2 + 20, { steps: 4 });
  await page.mouse.up();
  await expect(shapeItem(page, "营运 1")).toContainText("多边形 · 5 个点");
  await page.getByLabel("营运 1 第 1 个点的纬度").fill(String(CENTER.lat - 0.2));
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page).toHaveURL(/\/areas$/);
});

for (const scheme of ["light", "dark"] as const) {
  test(`${scheme === "light" ? "亮色" : "暗色"}：区域列表和编辑页（有地图、选中图形、有自测结果）通过 axe 检查；只用键盘画多边形`, async ({ page, request }) => {
    test.slow();
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1280, height: 800 });
    const city = await createCity(request);
    const tenant = await createActiveTenant(request);
    const headers = await tenantHeaders(request, tenant.adminEmail, tenant.password);
    const name = `无障碍 ${randomLetters(4)}`;
    const area = await createAreaByApi(request, headers, city, name);
    await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
    await page.goto("/areas");
    await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
    await expectAccessible(page, "区域列表");

    await page.goto(`/areas/${area.id}`);
    await expect(page.locator(".area-map__overlay .area-stroke--operate")).toHaveCount(1);
    // 暗色而底图没有暗色样式：只把底图那一层压暗
    await expect(page.locator(".area-map__canvas")).toHaveClass(scheme === "dark" ? /area-map__canvas--dimmed/ : /^(?!.*dimmed)/);

    // 画多边形：鼠标点四下，Backspace 去掉一个，Esc 取消；再来一次，Enter 完成
    await page.getByRole("group", { name: "新图形是" }).getByRole("radio", { name: "禁行区", exact: true }).check();
    await page.getByRole("button", { name: "画多边形" }).click();
    await clickMap(page, -40, 30);
    await clickMap(page, 40, 30);
    await clickMap(page, 0, -40);
    await clickMap(page, 60, -40);
    await expect(page.locator(".area-map__overlay .area-handle--static, .area-map__overlay .area-handle--first")).toHaveCount(4);
    await page.keyboard.press("Backspace");
    await expect(page.locator(".area-map__overlay .area-handle--static, .area-map__overlay .area-handle--first")).toHaveCount(3);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("button", { name: "选择" })).toHaveAttribute("aria-pressed", "true");
    await expect(group(page, "禁行区").getByRole("heading", { level: 3 })).toHaveText("禁行区（0）");
    await page.getByRole("button", { name: "画多边形" }).click();
    await clickMap(page, -40, 30);
    await clickMap(page, 40, 30);
    await clickMap(page, 0, -40);
    await page.keyboard.press("Enter");
    await expect(group(page, "禁行区").getByRole("heading", { level: 3 })).toHaveText("禁行区（1）");

    // 在地图上点一个位置来自测
    await page.getByRole("button", { name: "在地图上点" }).click();
    await clickMap(page, 0, 10);
    await expect(page.locator(".area-editor__probe .probe")).toContainText("在禁行区内");
    await expect(page.locator(".area-probe__pin").first()).toBeVisible();
    await expectAccessible(page, "区域编辑页");
    await snapshot(page, `areas-editor-${scheme}`);

    // 有未保存的修改时离开：先问
    await page.getByRole("button", { name: "取消" }).click();
    const leave = page.getByRole("dialog", { name: "有未保存的修改，确定离开吗？" });
    await expect(leave).toBeVisible();
    await expectAccessible(page, "离开确认");
    await leave.getByRole("button", { name: "继续编辑" }).click();
    await expect(group(page, "禁行区").getByRole("heading", { level: 3 })).toHaveText("禁行区（1）");
  });
}
