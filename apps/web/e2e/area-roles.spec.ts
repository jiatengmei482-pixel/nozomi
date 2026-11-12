/**
 * 运营区域与报价区域（M8-20，ADR 0075）：真实浏览器 → 前端 → 真实 API → 真实 PostgreSQL（底图是 global-setup 起的本机假瓦片服务）。
 * - 供应商：在页面上建一个大的运营区域、在它里面建一个报价区域（另经接口建一个一半在运营区域外的报价区域）；
 *   列表的用途列、编辑页的「超出运营区域」提醒；商品的服务区域只列报价区域并说明运营区域为什么不在；
 *   区域地图上运营区域虚线、报价区域实线、超出的部分斜线、重叠只在报价区域之间算；亮色 / 暗色 axe；390 / 320 不横向滚动。
 * - 运营后台：官网按两个坐标询价一家都报不出 → 「未覆盖需求」列表出现这一条（详情、计数）→「在区域地图上查看」图层上有它的点，点了有说明。
 * 截图只在设置了 E2E_SCREENSHOT_DIR 时保存。
 */
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { CENTER, type Ref, choose, createBrand, createWorld, expectAccessible, fillLocked, post, tenantHeaders } from "./catalog.ts";
import { OWN_SITE_SOURCE, adminCredentials, createActiveTenant, expectMapFollowsTheme, expectNoHorizontalOverflow, loginAs, platformAdminHeaders, randomLetters, snapshot } from "./support.ts";

// 官网按来源地址限速、未覆盖需求按来源限新行：每条用例用自己的来源地址（M8-17）
test.use(OWN_SITE_SOURCE);

type Ring = [number, number][];
const square = (west: number, south: number, size: number): Ring => [[west, south], [west + size, south], [west + size, south + size], [west, south + size]];
const wkt = (ring: Ring): string => `POLYGON((${[...ring, ring[0] as [number, number]].map(([lng, lat]) => `${lng} ${lat}`).join(", ")}))`;

async function drawArea(page: Page, world: { city: Ref }, name: string, role: RegExp, ring: Ring): Promise<void> {
  await page.goto("/areas/new");
  await choose(page, /城市/, world.city.code);
  await page.getByLabel("中文").fill(name);
  await page.getByRole("group", { name: /用途/ }).getByRole("radio", { name: role }).check();
  await page.getByRole("toolbar", { name: "绘制工具" }).getByRole("button", { name: "粘贴坐标" }).click();
  const dialog = page.getByRole("dialog", { name: "粘贴坐标" });
  await dialog.getByLabel(/内容/).fill(wkt(ring));
  await dialog.getByRole("button", { name: "添加到地图" }).click();
  await expect(dialog).toBeHidden();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page).toHaveURL(/\/areas$/);
}

async function areaId(request: APIRequestContext, headers: Record<string, string>, name: string): Promise<string> {
  const response = await request.get(`/tenant/v1/areas?q=${encodeURIComponent(name)}`, { headers });
  const found = ((await response.json()) as { items: { id: string; role: string }[] }).items;
  expect(found.length, `找到区域 ${name}`).toBe(1);
  return (found[0] as { id: string }).id;
}

test("供应商：建运营区域和里面的报价区域；商品只列报价区域；超出运营区域有提醒；区域地图两种样式、重叠只在报价区域之间；亮暗 axe；390 / 320 不横向滚动", async ({ page, request }) => {
  test.slow();
  await page.setViewportSize({ width: 1280, height: 860 });
  const world = await createWorld(request);
  const tenant = await createActiveTenant(request);
  const headers = await tenantHeaders(request, tenant.adminEmail, tenant.password);
  await createBrand(request, headers, `品牌 ${randomLetters(4)}`);
  const tag = randomLetters(4);
  const names = { operating: `运营全域 ${tag}`, pricing: `市中心报价 ${tag}`, partly: `越界报价 ${tag}` };
  const { lng, lat } = CENTER;

  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
  // 页面上建：运营区域（0.2° 见方）和完全在它里面的报价区域
  await drawArea(page, world, names.operating, /^运营区域/, square(lng - 0.1, lat - 0.1, 0.2));
  await drawArea(page, world, names.pricing, /^报价区域/, square(lng - 0.03, lat - 0.03, 0.06));
  const operatingId = await areaId(request, headers, names.operating);
  const pricingId = await areaId(request, headers, names.pricing);
  // 接口建一个一半伸出运营区域的报价区域
  const partly = await post<{ id: string; outside_operating_m2: number }>(request, { ...headers, "idempotency-key": crypto.randomUUID() }, "/tenant/v1/areas", { city_id: world.city.id, name: { zh: names.partly }, biz_type: "general", role: "pricing", polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [[...square(lng + 0.05, lat - 0.02, 0.1), [lng + 0.05, lat - 0.02]]] } }] }, "接口新建报价区域");
  expect(partly.outside_operating_m2, "一半在运营区域外").toBeGreaterThan(1_000_000);

  // 列表：用途列
  await page.goto("/areas");
  await expect(page.getByRole("row").filter({ hasText: names.operating })).toContainText("运营区域");
  await expect(page.getByRole("row").filter({ hasText: names.pricing })).toContainText("报价区域");

  // 编辑页：完全在运营区域里的没有提醒；伸出去的有，地图上画出超出的部分
  await page.goto(`/areas/${pricingId}`);
  await expect(page.getByRole("group", { name: /用途/ }).getByRole("radio", { name: /^报价区域/ })).toBeChecked();
  await expect(page.locator(".area-map__overlay")).toBeVisible();
  await expect(page.locator("[data-outside-warning]")).toHaveCount(0);
  await expect(page.getByRole("list", { name: "图例" })).toContainText("营运区 可以报价");
  // 纯运营区域：图例不说「可以报价」（M6-08）
  await page.goto(`/areas/${operatingId}`);
  await expect(page.getByRole("group", { name: /用途/ }).getByRole("radio", { name: /^运营区域/ })).toBeChecked();
  await expect(page.getByRole("list", { name: "图例" })).toContainText("营运区 能接单的范围，不带价格");
  await expect(page.getByRole("list", { name: "图例" })).not.toContainText("可以报价");
  // 切换亮暗主题：编辑页的地图当场跟着变，暗色只压暗瓦片（M6-08）
  await expectMapFollowsTheme(page, page.locator(".area-map__canvas"), "区域编辑页地图");
  await page.goto(`/areas/${partly.id}`);
  await expect(page.locator("[data-outside-warning]")).toContainText("不在任何运营区域里，那部分不会报价");
  await expect(page.locator('.area-map__overlay [data-outside="editing"]')).toHaveCount(1);
  await expectAccessible(page, "区域编辑页（超出运营区域）");
  await snapshot(page, "m820-editor-outside-light");

  // 商品：服务区域只列报价区域，说明运营区域为什么不在
  await page.goto("/products/new");
  await fillLocked(page, world, "点对点");
  await page.getByRole("button", { name: "添加区域", exact: true }).click();
  const panel = page.getByRole("group", { name: "添加区域", exact: true });
  await expect(panel.getByRole("checkbox", { name: new RegExp(names.pricing) })).toBeVisible();
  await expect(panel.getByRole("checkbox", { name: new RegExp(names.partly) })).toBeVisible();
  await expect(panel.getByRole("checkbox", { name: new RegExp(names.operating) })).toHaveCount(0);
  await panel.getByRole("checkbox", { name: new RegExp(names.pricing) }).check();
  await panel.getByRole("button", { name: "完成" }).click();
  await expect(page.locator("[data-hidden-operating]")).toContainText("另有 1 个运营区域没有列出");
  await snapshot(page, "m820-product-picker");

  // 区域地图：运营区域虚线、报价区域实线；运营区域和报价区域叠在一起不算重叠；超出的部分画斜线
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/areas/map");
    await expect(page.getByRole("heading", { name: "共 3 个区域" })).toBeVisible();
    await expect(page.locator(`[data-area="${operatingId}"]`)).toHaveClass(/area-overview--operating/);
    await expect(page.locator(`[data-area="${pricingId}"]`)).not.toHaveClass(/area-overview--operating/);
    expect(await page.locator(`[data-area="${operatingId}"] .area-overview-stroke`).first().evaluate((node) => getComputedStyle(node).strokeDasharray)).not.toBe("none");
    expect(await page.locator(`[data-area="${pricingId}"] .area-overview-stroke`).first().evaluate((node) => getComputedStyle(node).strokeDasharray)).toBe("none");
    await expect(page.locator('.area-overview-map [data-outside="all"]')).toHaveCount(1);
    await expect(page.locator(".area-overview-map path[data-overlap]")).toHaveCount(0);
    const list = page.getByRole("list", { name: "区域列表" });
    await expect(list).not.toContainText("重叠");
    await expect(list.getByRole("listitem").filter({ hasText: names.partly })).toContainText("报价区域超出运营区域");
    const legend = page.getByRole("list", { name: "图例" });
    await expect(legend).toContainText("运营区域");
    await expect(legend).toContainText("超出运营区域");
    await expectAccessible(page, `区域地图（${scheme}）`);
    await snapshot(page, `m820-overview-${scheme}`);
    if (scheme === "dark") {
      // 不刷新切换主题：区域地图当场跟着变，暗色只压暗瓦片、图形颜色不变（M6-08）
      await expectMapFollowsTheme(page, page.locator(".area-overview-map .area-map__canvas"), "区域地图");
      await page.emulateMedia({ colorScheme: "dark" });
    }
    await page.getByRole("combobox", { name: "用途" }).selectOption("operating");
    await expect(page.getByRole("heading", { name: "共 3 个区域，显示 1 个" })).toBeVisible();
    await page.getByRole("combobox", { name: "用途" }).selectOption("pricing");
    await expect(page.getByRole("heading", { name: "共 3 个区域，显示 2 个" })).toBeVisible();
  }

  // 手机宽：不横向滚动
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const path of ["/areas/map", `/areas/${partly.id}`, "/areas"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectNoHorizontalOverflow(page, `${path} ${width}px`);
    }
    if (width === 390) {
      await page.goto("/areas/map");
      await expect(page.getByRole("heading", { name: "共 3 个区域" })).toBeVisible();
      await expectAccessible(page, "区域地图 390");
      await snapshot(page, "m820-overview-390-dark");
    }
  }
});

test("运营后台：官网询价一家都报不出 → 未覆盖需求列表里有这一条（详情、计数）→ 在区域地图上查看，图层上有它的点；亮暗 axe；320 / 390 不横向滚动", async ({ page, request }) => {
  test.slow();
  await page.setViewportSize({ width: 1280, height: 860 });
  const tag = randomLetters(5);
  // 远离所有用例城市的一点（北海道附近，随机偏一点）：点对点的出发地不在任何能订的城市里
  const pickup = { lat: Number((43.0 + Math.random() * 0.2).toFixed(4)), lng: Number((141.2 + Math.random() * 0.2).toFixed(4)) };
  const dropoff = { lat: pickup.lat + 0.02, lng: pickup.lng + 0.02 };
  const pickupName = `未覆盖起点 ${tag}`;
  const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  const quoted = await request.post("/site/v1/quotes/by-points", { data: { pickup: { name: pickupName, ...pickup }, dropoff: { name: "终点", ...dropoff }, service_local: `${tomorrow}T10:00`, passengers: 2, luggage: 1, pickup_name: pickupName, dropoff_name: `未覆盖终点 ${tag}` } });
  expect(quoted.status(), await quoted.text()).toBe(200);
  expect(((await quoted.json()) as { quotes: unknown[] }).quotes).toEqual([]);
  const admin = await platformAdminHeaders(request);
  let demandId = "";
  await expect
    .poll(async () => {
      const found = ((await (await request.get("/platform/v1/uncovered-demands?limit=100", { headers: admin })).json()) as { items: { id: string; pickup_name: string | null }[] }).items.find((item) => item.pickup_name === pickupName);
      demandId = found?.id ?? "";
      return demandId;
    }, { message: "未覆盖需求记下来了（应答之后的后台任务）" })
    .not.toBe("");

  const { email, password } = adminCredentials();
  await loginAs(page, "platform", email, password);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto("/platform");
    await page.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "未覆盖需求" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "未覆盖需求" })).toBeVisible();
    const row = page.getByRole("row").filter({ hasText: pickupName });
    await expect(row).toContainText("点对点");
    await expect(row).toContainText("不在任何运营区域里");
    await expect(row).toContainText(`未覆盖终点 ${tag}`);
    await expect(page.getByRole("list", { name: "按原因" })).toContainText("不在任何运营区域里");
    // 1280 宽：「操作」列不用横向滚动就看得到（M6-08）
    const scroller = page.getByRole("region", { name: "未覆盖需求", exact: true });
    expect(await scroller.evaluate((node) => node.scrollWidth - node.clientWidth), "表格不横向滚动").toBeLessThanOrEqual(0);
    await expect(row.getByRole("link", { name: "在区域地图上查看" })).toBeInViewport();
    await expectAccessible(page, `未覆盖需求（${scheme}）`);
    await snapshot(page, `m820-demands-${scheme}`);
  }
  const row = page.getByRole("row").filter({ hasText: pickupName });
  await row.getByRole("button", { name: /^详情/ }).click();
  const dialog = page.getByRole("dialog", { name: "未覆盖需求的详情" });
  await expect(dialog).toContainText("不在任何供应商的运营区域里");
  await expect(dialog).toContainText(`${pickup.lat.toFixed(4)}, ${pickup.lng.toFixed(4)}`);
  await expect(dialog).toContainText("官网");
  await expectAccessible(page, "未覆盖需求的详情");
  await snapshot(page, "m820-demand-detail-dark");
  await dialog.getByRole("button", { name: "关闭" }).last().click();

  // 在区域地图上查看：图层开着，地图移到这一点；点它有说明
  await page.emulateMedia({ colorScheme: "light" });
  await row.getByRole("link", { name: "在区域地图上查看" }).click();
  await expect(page).toHaveURL(/\/platform\/areas\/map\?demands=1/);
  await expect(page.getByRole("checkbox", { name: "显示未覆盖需求" })).toBeChecked();
  const dot = page.locator(`circle[data-demand="${demandId}:p"]`);
  await expect(dot).toHaveCount(1);
  await expect(page.locator(`rect[data-demand="${demandId}:d"]`)).toHaveCount(1);
  await expect(page.getByRole("list", { name: "图例" })).toContainText("未覆盖需求");
  const box = await dot.boundingBox();
  if (!box) throw new Error("找不到未覆盖需求的点");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const popup = page.getByRole("region", { name: "未覆盖需求" });
  await expect(popup).toContainText("点对点");
  await expect(popup).toContainText("上车点");
  await expect(popup).toContainText("不在任何运营区域里");
  await expectAccessible(page, "区域地图的未覆盖需求图层");
  await snapshot(page, "m820-platform-map-demands");

  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/platform/uncovered-demands");
    await expect(page.getByRole("heading", { level: 1, name: "未覆盖需求" })).toBeVisible();
    await expect(page.getByText(pickupName).first()).toBeVisible();
    // 手机卡片：「次数」「涉及的供应商」有标签（M6-08）
    const card = page.getByRole("row").filter({ hasText: pickupName });
    await expect(card).toContainText("次数：1");
    await expect(card).toContainText("涉及的供应商：没有");
    await expectNoHorizontalOverflow(page, `未覆盖需求 ${width}px`);
    await page.goto(`/platform/areas/map?demands=1&lat=${pickup.lat}&lng=${pickup.lng}`);
    await expect(page.locator(`circle[data-demand="${demandId}:p"]`)).toHaveCount(1);
    await expectNoHorizontalOverflow(page, `区域地图（未覆盖需求图层）${width}px`);
    if (width === 390) await snapshot(page, "m820-platform-map-390");
  }
});
