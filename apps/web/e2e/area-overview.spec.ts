/**
 * 区域地图（M8-18）：真实后端、真实 PostgreSQL、真实浏览器里的地图（底图是 global-setup 起的本机假瓦片服务，从不请求真实的底图服务）。
 * - 桌面 1280，亮色 / 暗色：列表 ↔ 地图互相选中、重叠的提示和「只看有重叠的」、导出 GeoJSON、导入 .geojson（进新增区域页核对后保存）、
 *   从地图进编辑页改了没保存就离开的提醒；axe 检查。
 * - 手机 390 / 320，亮色 / 暗色：不横向滚动，列表和地图上下排；axe 检查（390）。
 * - 运营后台：只读，按供应商筛。
 * 供应商、账号、城市、区域都经真实接口建出来；截图只在设置了 E2E_SCREENSHOT_DIR 时保存。
 */
import { readFile } from "node:fs/promises";
import { AxeBuilder } from "@axe-core/playwright";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { adminCredentials, createActiveTenant, createTestCity, expectNoHorizontalOverflow, loginAs, platformAdminHeaders, randomLetters, settleAnimations, snapshot } from "./support.ts";

const CENTER = { lat: 35.6895, lng: 139.6917 };

interface City {
  id: string;
  code: string;
  name: string;
}

async function createCity(request: APIRequestContext): Promise<City> {
  const headers = await platformAdminHeaders(request);
  const { id, code, name } = await createTestCity(request, headers, (tag) => ({ name: { zh: `地图城市${tag}` }, timezone: "Asia/Tokyo", center: CENTER }));
  return { id, code, name };
}

async function tenantHeaders(request: APIRequestContext, email: string, password: string): Promise<Record<string, string>> {
  const response = await request.post("/tenant/v1/auth/login", { data: { email, password } });
  expect(response.ok(), "供应商账号登录").toBe(true);
  return { authorization: `Bearer ${((await response.json()) as { access_token: string }).access_token}` };
}

function rect(west: number, south: number, east: number, north: number): { type: "Polygon"; coordinates: [number, number][][] } {
  return { type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] };
}

/** 三个区域：甲、乙部分重叠；丙在东边，和谁都不重叠（它的禁行区压在乙上也不算）。 */
async function seedAreas(request: APIRequestContext, headers: Record<string, string>, city: City): Promise<{ a: string; b: string; c: string; names: [string, string, string] }> {
  const suffix = randomLetters(3);
  const names: [string, string, string] = [`甲区 ${suffix}`, `乙区 ${suffix}`, `丙区 ${suffix}`];
  const { lng, lat } = CENTER;
  const shapes = [
    [{ kind: "operate", geometry: rect(lng - 0.1, lat - 0.06, lng + 0.02, lat + 0.06) }],
    [{ kind: "operate", geometry: rect(lng - 0.02, lat - 0.04, lng + 0.08, lat + 0.04) }],
    [
      { kind: "operate", geometry: rect(lng + 0.12, lat - 0.05, lng + 0.2, lat + 0.05) },
      { kind: "forbid", geometry: rect(lng + 0.06, lat - 0.01, lng + 0.13, lat + 0.01) },
    ],
  ];
  const ids: string[] = [];
  for (const [index, polygons] of shapes.entries()) {
    const response = await request.post("/tenant/v1/areas", { headers: { ...headers, "idempotency-key": crypto.randomUUID() }, data: { city_id: city.id, name: { zh: names[index] }, biz_type: "general", polygons } });
    expect(response.status(), "接口新建区域").toBe(201);
    ids.push(((await response.json()) as { id: string }).id);
  }
  return { a: ids[0] as string, b: ids[1] as string, c: ids[2] as string, names };
}

async function expectAccessible(page: Page, what: string): Promise<void> {
  await settleAnimations(page);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = results.violations.map((violation) => `${violation.id}: ${violation.help}（${violation.nodes.map((node) => node.target.join(" ")).join("；")}）`);
  expect(summary, `${what} 的无障碍问题`).toEqual([]);
}

const item = (page: Page, name: string) => page.getByRole("list", { name: "区域列表" }).getByRole("listitem").filter({ has: page.getByRole("button", { name, exact: true }) });

for (const scheme of ["light", "dark"] as const) {
  test(`${scheme === "light" ? "亮色" : "暗色"} 1280：列表和地图互相选中、重叠提示和筛选、导出、导入、离开前提醒；axe`, async ({ page, request }) => {
    test.slow();
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 1280, height: 800 });
    const city = await createCity(request);
    const tenant = await createActiveTenant(request);
    const headers = await tenantHeaders(request, tenant.adminEmail, tenant.password);
    const seeded = await seedAreas(request, headers, city);
    const [nameA, nameB, nameC] = seeded.names;

    await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
    await page.goto("/areas");
    await page.getByRole("link", { name: "在地图上看全部" }).click();
    await expect(page).toHaveURL(/\/areas\/map$/);
    await expect(page.getByRole("heading", { name: "共 3 个区域" })).toBeVisible();
    await expect(page.locator(".area-overview-map [data-area]")).toHaveCount(3);
    await expect(page.locator(".area-overview-map .area-map__overlay path[data-overlap=\"all\"]")).toHaveCount(1);
    await expect(item(page, nameA)).toContainText(`与「${nameB}」重叠`);
    await expect(item(page, nameB)).toContainText(`与「${nameA}」重叠`);
    await expect(item(page, nameC)).not.toContainText("重叠");
    await expect(item(page, nameA)).toContainText("多边形 · 4 个点");
    await expect(item(page, nameC)).toContainText("营运区 1 块 · 禁行区 1 块 · 共 8 个点");
    await expect(item(page, nameA)).toContainText("端到端测试租户管理员 · 最近修改");
    if (scheme === "dark") await expect(page.locator(".area-overview-map .area-map__canvas")).toHaveClass(/area-map__canvas--dimmed/);
    await expectAccessible(page, "区域地图");
    await snapshot(page, `m818-overview-desktop-${scheme}`);

    // 列表 → 地图：选中丙，地图上丙的描边加粗，视野移过去（丙在画面中间附近）
    await page.getByRole("button", { name: nameC, exact: true }).click();
    await expect(page.getByRole("button", { name: nameC, exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator(`[data-area="${seeded.c}"] .area-overview-stroke--selected`)).toHaveCount(1);
    const mapBox = await page.locator(".area-overview-map").boundingBox();
    const cBox = await page.locator(`[data-area="${seeded.c}"] .area-overview-stroke`).boundingBox();
    if (!mapBox || !cBox) throw new Error("找不到地图或丙的图形");
    expect(Math.abs(cBox.x + cBox.width / 2 - (mapBox.x + mapBox.width / 2)), "丙在地图横向中间").toBeLessThan(mapBox.width / 4);

    // 地图 → 列表：看全部，点甲独有的部分（西南角往里一点），列表里甲被选中
    await page.getByRole("button", { name: "看全部区域" }).click();
    const aBox = await page.locator(`[data-area="${seeded.a}"] .area-overview-stroke`).boundingBox();
    if (!aBox) throw new Error("找不到甲的图形");
    await page.mouse.click(aBox.x + 12, aBox.y + aBox.height - 12);
    await expect(page.getByRole("button", { name: nameA, exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(item(page, nameA)).toHaveClass(/area-overview__item--selected/);
    await expect(page.locator('.area-overview-map path[data-overlap="selected"]')).toHaveCount(1);
    await expect(item(page, nameA)).toContainText(/平方(公里|米)/);
    await snapshot(page, `m818-overview-selected-${scheme}`);

    // 只看有重叠的
    await page.getByRole("checkbox", { name: /只看有重叠的/ }).check();
    await expect(page.getByRole("list", { name: "区域列表" }).getByRole("listitem")).toHaveCount(2);
    await expect(page.locator(".area-overview-map [data-area]")).toHaveCount(2);
    await page.getByRole("checkbox", { name: /只看有重叠的/ }).uncheck();

    // 导出：三个区域、四块图形
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "导出 GeoJSON" }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toMatch(/^区域地图-\d{4}-\d{2}-\d{2}\.geojson$/);
    const exported = JSON.parse(await readFile(await download.path(), "utf8")) as { features: { properties: { area_id: string; kind: string } }[] };
    expect(exported.features.length).toBe(4);
    expect(new Set(exported.features.map((feature) => feature.properties.area_id))).toEqual(new Set([seeded.a, seeded.b, seeded.c]));

    // 导入：一次三个区域的文件被拦下；只有丙的文件 → 新增区域页，粘贴坐标里已经识别出两块（类型带回来）→ 选城市、起名、保存 → 回到区域地图
    const fileInput = page.locator('.area-overview__import input[type="file"]');
    await fileInput.setInputFiles({ name: "全部.geojson", mimeType: "application/geo+json", buffer: Buffer.from(JSON.stringify(exported)) });
    await expect(page.getByText("这个文件里有 3 个区域。一次只能导入一个区域", { exact: false })).toBeVisible();
    const onlyC = { type: "FeatureCollection", features: exported.features.filter((feature) => feature.properties.area_id === seeded.c) };
    await fileInput.setInputFiles({ name: "丙.geojson", mimeType: "application/geo+json", buffer: Buffer.from(JSON.stringify(onlyC)) });
    await expect(page).toHaveURL(/\/areas\/new$/);
    const dialog = page.getByRole("dialog", { name: "粘贴坐标" });
    await expect(dialog.getByText(/识别为 GeoJSON：2 个多边形/)).toBeVisible();
    await expect(dialog.getByText(/1 块营运区、1 块禁行区/)).toBeVisible();
    await dialog.getByRole("button", { name: "添加到地图" }).click();
    const box = page.getByRole("combobox", { name: /城市/ });
    await box.click();
    await box.fill(city.code);
    await page.getByRole("option", { name: new RegExp(city.code) }).first().click();
    const importedName = `导入的区域 ${randomLetters(3)}`;
    await page.getByRole("group", { name: /名称/ }).getByRole("textbox").first().fill(importedName);
    await page.getByRole("button", { name: "保存", exact: true }).click();
    await expect(page).toHaveURL(/\/areas\/map$/);
    await expect(page.getByRole("heading", { name: "共 4 个区域" })).toBeVisible();
    await expect(item(page, importedName)).toContainText(`与「${nameC}」重叠`);

    // 从地图进编辑页：改了名字没保存就点「取消」→ 提醒；「继续编辑」留下；再取消 →「离开」回到区域地图，名字没变
    await page.getByRole("button", { name: nameB, exact: true }).click();
    await item(page, nameB).getByRole("link", { name: `编辑 ${nameB}` }).click();
    await expect(page.getByRole("heading", { level: 1, name: nameB })).toBeVisible();
    await page.getByRole("group", { name: /名称/ }).getByRole("textbox").first().fill(`${nameB} 改`);
    await page.getByRole("button", { name: "取消", exact: true }).click();
    const leave = page.getByRole("dialog", { name: "有未保存的修改，确定离开吗？" });
    await expect(leave).toBeVisible();
    await snapshot(page, `m818-leave-prompt-${scheme}`);
    await leave.getByRole("button", { name: "继续编辑" }).click();
    await expect(page).toHaveURL(new RegExp(`/areas/${seeded.b}$`));
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await page.getByRole("dialog", { name: "有未保存的修改，确定离开吗？" }).getByRole("button", { name: "离开" }).click();
    await expect(page).toHaveURL(/\/areas\/map$/);
    await expect(page.getByRole("button", { name: nameB, exact: true })).toBeVisible();
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`${scheme === "light" ? "亮色" : "暗色"} 手机 390 / 320：不横向滚动，列表在上、地图在下；axe`, async ({ page, request }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width: 390, height: 844 });
    const city = await createCity(request);
    const tenant = await createActiveTenant(request);
    const headers = await tenantHeaders(request, tenant.adminEmail, tenant.password);
    await seedAreas(request, headers, city);
    await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
    await page.goto("/areas/map");
    await expect(page.getByRole("heading", { name: "共 3 个区域" })).toBeVisible();
    await expect(page.locator(".area-overview-map [data-area]")).toHaveCount(3);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await expectNoHorizontalOverflow(page, `区域地图 ${width}px`);
      const list = await page.locator(".area-overview__list").boundingBox();
      const map = await page.locator(".area-overview-map").boundingBox();
      if (!list || !map) throw new Error("找不到列表或地图");
      expect(map.y, `${width}px：地图在列表下面`).toBeGreaterThanOrEqual(list.y + list.height);
      expect(map.width, `${width}px：地图不超出屏幕`).toBeLessThanOrEqual(width);
      await snapshot(page, `m818-overview-${width}-${scheme}`);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await expectAccessible(page, "手机上的区域地图");
  });
}

test("运营后台：只读看全部供应商的区域，按供应商筛；没有添加、导入、编辑", async ({ page, request }) => {
  test.slow();
  await page.setViewportSize({ width: 1280, height: 800 });
  const city = await createCity(request);
  const tenant = await createActiveTenant(request);
  const headers = await tenantHeaders(request, tenant.adminEmail, tenant.password);
  const seeded = await seedAreas(request, headers, city);
  const admin = adminCredentials();
  await loginAs(page, "platform", admin.email, admin.password);
  await page.getByRole("link", { name: "区域地图" }).click();
  await expect(page).toHaveURL(/\/platform\/areas\/map$/);
  await expect(page.getByText("这里只能查看。区域由供应商在自己的后台维护。")).toBeVisible();
  const supplier = page.getByRole("combobox", { name: /供应商/ });
  await supplier.click();
  await supplier.fill(tenant.tenantName);
  await page.getByRole("option", { name: tenant.tenantName }).click();
  await expect(page.getByRole("heading", { name: "共 3 个区域" })).toBeVisible();
  await expect(item(page, seeded.names[0])).toContainText(tenant.tenantName);
  await expect(item(page, seeded.names[0])).toContainText(`与「${seeded.names[1]}」重叠`);
  await expect(page.getByRole("link", { name: /添加区域/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /拖放/ })).toHaveCount(0);
  await page.getByRole("button", { name: seeded.names[0], exact: true }).click();
  await expect(item(page, seeded.names[0]).getByRole("link")).toHaveCount(0);
  await expectAccessible(page, "运营后台的区域地图");
  await snapshot(page, "m818-platform-overview");
});

/** 一大一小两个区域：小的在大的北边，往下 62px 就落到大的上面（验收发现的「第一次点地图选错、页面跳」用得上）。 */
async function seedSmallAndBig(request: APIRequestContext, headers: Record<string, string>, city: City): Promise<{ big: string; small: string; smallName: string }> {
  const suffix = randomLetters(3);
  const { lng, lat } = CENTER;
  const make = async (name: string, geometry: ReturnType<typeof rect>): Promise<string> => {
    const response = await request.post("/tenant/v1/areas", { headers: { ...headers, "idempotency-key": crypto.randomUUID() }, data: { city_id: city.id, name: { zh: name }, biz_type: "general", polygons: [{ kind: "operate", geometry }] } });
    expect(response.status(), "接口新建区域").toBe(201);
    return ((await response.json()) as { id: string }).id;
  };
  const big = await make(`大区 ${suffix}`, rect(lng - 0.1, lat - 0.1, lng + 0.1, lat + 0.02));
  const smallName = `小区 ${suffix}`;
  const small = await make(smallName, rect(lng - 0.006, lat + 0.03, lng + 0.006, lat + 0.042));
  return { big, small, smallName };
}

/**
 * 等地图停下：换了一批区域（运营后台选了供应商）后地图把它们放进视野，缩放级别不变时 Leaflet 用约 0.25 秒平移过去
 * （`leaflet-pan-anim`，按帧改位置，不是 CSS 动画，`getAnimations` 看不到）。平移途中量出的位置，等点下去时区域已经挪开了几十像素，
 * 点到旁边的大区域（M8-29，run 43002718531）。隔两帧地图层的位置没变、也不在平移，才算停下。
 */
async function mapAtRest(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const pane = document.querySelector<HTMLElement>(".area-overview-map .leaflet-map-pane");
        const read = (): string => `${pane?.classList.contains("leaflet-pan-anim") ? "panning" : "idle"} ${pane?.style.transform ?? ""}`;
        const before = read();
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return before === read() && before.startsWith("idle") ? "at rest" : "moving";
      }),
    )
    .toBe("at rest");
}

/** 地图没有完全在视野里、先不滚动，按下鼠标点小区域的正中：选中的是它，内容区一点没滚。 */
async function clickSmallWithoutJump(page: Page, small: string, smallName: string): Promise<void> {
  await mapAtRest(page);
  const map = page.locator(".area-overview-map");
  const mapBox = await map.boundingBox();
  if (!mapBox) throw new Error("找不到地图");
  const viewport = page.viewportSize()?.height ?? 0;
  expect(mapBox.y + mapBox.height, "前提：地图没有完全在视野里").toBeGreaterThan(viewport);
  const main = page.locator("main.shell__main");
  const before = await main.evaluate((element) => element.scrollTop);
  const box = await page.locator(`[data-area="${small}"] .area-overview-stroke`).boundingBox();
  if (!box) throw new Error("找不到小区域");
  expect(box.height, "前提：小区域在画面上不到 62px 高").toBeLessThan(62);
  expect(box.y + box.height, "前提：小区域在视野里").toBeLessThan(viewport);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole("button", { name: smallName, exact: true })).toHaveAttribute("aria-pressed", "true");
  expect(await main.evaluate((element) => element.scrollTop), "点地图时内容区没有滚动").toBe(before);
  // 焦点照样落到地图上：键盘可以接着操作地图
  await expect(page.locator(".area-overview-map .area-map__canvas")).toBeFocused();
}

test("第一次点地图：不跳、选中点到的那个区域（运营后台 1280×800；供应商后台 1000×800 单栏——两栏时地图总是整个在视野里）；地图没有完全在视野里、不先滚动", async ({ page, request }) => {
  test.slow();
  await page.setViewportSize({ width: 1000, height: 800 });
  const city = await createCity(request);
  const tenant = await createActiveTenant(request);
  const headers = await tenantHeaders(request, tenant.adminEmail, tenant.password);
  const seeded = await seedSmallAndBig(request, headers, city);

  // 供应商后台：单栏，地图在列表下面，只露出上半截
  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
  await page.goto("/areas/map");
  await expect(page.locator(".area-overview-map [data-area]")).toHaveCount(2);
  await clickSmallWithoutJump(page, seeded.small, seeded.smallName);

  // 运营后台：两栏，筛选条和提示条把地图的下沿推出视野
  await page.setViewportSize({ width: 1280, height: 800 });
  const admin = adminCredentials();
  await loginAs(page, "platform", admin.email, admin.password);
  await page.goto("/platform/areas/map");
  const supplier = page.getByRole("combobox", { name: /供应商/ });
  await supplier.click();
  await supplier.fill(tenant.tenantName);
  await page.getByRole("option", { name: tenant.tenantName }).click();
  await expect(page.getByRole("heading", { name: "共 2 个区域" })).toBeVisible();
  await expect(page.locator(".area-overview-map [data-area]")).toHaveCount(2);
  await clickSmallWithoutJump(page, seeded.small, seeded.smallName);
});
