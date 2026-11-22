/**
 * 共享库引用前看形状（M8-46，ADR 0083）：真实后端、真实 PostgreSQL、真实浏览器里的地图（底图是 global-setup 起的本机假瓦片服务）。
 * 供应商甲经接口在一个新城市里建一个区域（营运区 + 禁行区），它就在共享库里；供应商乙在「区域 → 从共享库引用」里：
 * 用组合框选城市、查询，列表里名称和块数分两行；「看形状」在这一项下面画出地图；「引用」后确认步骤同样画出形状，引用成功进自己的区域。
 * 亮色 / 暗色 × 1280 / 360：axe、不横向滚动；用键盘展开、收起形状。截图只在设置了 E2E_SCREENSHOT_DIR 时保存。
 */
import { AxeBuilder } from "@axe-core/playwright";
import { type APIRequestContext, type Locator, type Page, expect, test } from "@playwright/test";
import { createActiveTenant, expectNoHorizontalOverflow, loginAs, platformAdminHeaders, randomLetters, settleAnimations, snapshot } from "./support.ts";

const CENTER = { lat: 35.3192, lng: 139.5467 };

function rect(west: number, south: number, east: number, north: number): { type: "Polygon"; coordinates: [number, number][][] } {
  return { type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] };
}

/** 一个新城市（别的用例的区域不会出现在它的共享库里）+ 供应商甲在里面建的一个区域。 */
async function seed(request: APIRequestContext): Promise<{ cityName: string; areaName: string; areaId: string }> {
  const headers = await platformAdminHeaders(request);
  const code = `CTY-JP-${randomLetters(5)}`;
  const cityName = `共享预览城市${code.slice(-5)}`;
  const city = await request.post("/platform/v1/master/cities", { headers, data: { code, country_code: "JP", name: { zh: cityName, en: `Preview ${code.slice(-5)}` }, timezone: "Asia/Tokyo", center: CENTER } });
  expect(city.status(), "接口新建城市").toBe(201);
  const cityId = ((await city.json()) as { id: string }).id;

  const owner = await createActiveTenant(request);
  const login = await request.post("/tenant/v1/auth/login", { data: { email: owner.adminEmail, password: owner.password } });
  expect(login.ok(), "供应商甲登录").toBe(true);
  const ownerHeaders = { authorization: `Bearer ${((await login.json()) as { access_token: string }).access_token}` };
  const areaName = `镰仓一带 ${randomLetters(3)}`;
  const { lng, lat } = CENTER;
  const area = await request.post("/tenant/v1/areas", {
    headers: { ...ownerHeaders, "idempotency-key": crypto.randomUUID() },
    data: {
      city_id: cityId,
      name: { zh: areaName },
      biz_type: "general",
      polygons: [
        { kind: "operate", geometry: rect(lng - 0.05, lat - 0.03, lng + 0.05, lat + 0.03) },
        { kind: "forbid", geometry: rect(lng - 0.01, lat - 0.005, lng + 0.01, lat + 0.005) },
      ],
    },
  });
  expect(area.status(), "供应商甲建区域").toBe(201);
  return { cityName, areaName, areaId: ((await area.json()) as { id: string }).id };
}

async function expectAccessible(page: Page, what: string): Promise<void> {
  await settleAnimations(page);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = results.violations.map((violation) => `${violation.id}: ${violation.help}（${violation.nodes.map((node) => node.target.join(" ")).join("；")}）`);
  expect(summary, `${what} 的无障碍问题`).toEqual([]);
}

/** 打开对话框、选城市、查询，返回共享库列表里的那一项。 */
async function searchShared(page: Page, cityName: string, areaName: string): Promise<{ dialog: Locator; row: Locator }> {
  await page.goto("/areas");
  await page.getByRole("button", { name: "从共享库引用" }).click();
  const dialog = page.getByRole("dialog", { name: "从共享库引用区域" });
  await dialog.getByRole("combobox", { name: /城市/ }).fill(cityName);
  await page.getByRole("option", { name: new RegExp(cityName) }).click();
  await dialog.getByRole("button", { name: "查询共享库" }).click();
  const row = dialog.getByRole("list", { name: "共享区域" }).getByRole("listitem").filter({ hasText: areaName });
  await expect(row).toHaveCount(1);
  return { dialog, row };
}

for (const scheme of ["light", "dark"] as const) {
  for (const width of [1280, 360] as const) {
    test(`${scheme === "light" ? "亮色" : "暗色"} ${width}：引用前在地图上看形状，名称和块数分开；引用后进自己的区域；axe、不横向滚动`, async ({ page, request }) => {
      test.slow();
      await page.emulateMedia({ colorScheme: scheme });
      await page.setViewportSize({ width, height: width === 360 ? 780 : 800 });
      const { cityName, areaName, areaId } = await seed(request);
      const user = await createActiveTenant(request);
      await loginAs(page, "tenant", user.adminEmail, user.password);

      const { dialog, row } = await searchShared(page, cityName, areaName);
      await expect(row.locator(".shared-area__name")).toHaveText(areaName);
      await expect(row.locator(".shared-area__pieces")).toHaveText("营运区 1 块 · 禁行区 1 块");
      const nameBox = await row.locator(".shared-area__name").boundingBox();
      const piecesBox = await row.locator(".shared-area__pieces").boundingBox();
      if (!nameBox || !piecesBox) throw new Error("找不到名称或块数");
      expect(piecesBox.y, "块数在名称下面一行").toBeGreaterThanOrEqual(nameBox.y + nameBox.height - 1);

      // 看形状：地图画在这一项下面，营运区 + 禁行区，地图名字里有区域名
      await row.getByRole("button", { name: `看「${areaName}」的形状` }).click();
      const preview = row.locator(".shared-area__preview");
      await expect(preview.getByRole("application", { name: new RegExp(`「${areaName}」的形状`) })).toBeVisible();
      await expect(preview.locator(`[data-area="${areaId}"] .area-overview-stroke--selected`)).toHaveCount(1);
      await expect(preview.locator(`[data-area="${areaId}"] .area-stroke--forbid`)).toHaveCount(1);
      await expect(preview.locator(".leaflet-tile-loaded").first()).toBeVisible();
      if (scheme === "dark") await expect(preview.locator(".area-map__canvas")).toHaveClass(/area-map__canvas--dimmed/);
      const mapBox = await preview.locator(".area-overview-map").boundingBox();
      const shapeBox = await preview.locator(`[data-area="${areaId}"] .area-overview-stroke`).first().boundingBox();
      if (!mapBox || !shapeBox) throw new Error("找不到地图或区域的图形");
      expect(Math.abs(shapeBox.x + shapeBox.width / 2 - (mapBox.x + mapBox.width / 2)), "区域在地图横向中间").toBeLessThan(mapBox.width / 4);
      await expectNoHorizontalOverflow(page, "共享库对话框（展开形状）");
      const dialogBox = await dialog.boundingBox();
      if (!dialogBox) throw new Error("找不到对话框");
      expect(dialogBox.x + dialogBox.width, "对话框不超出屏幕").toBeLessThanOrEqual(width);
      await expectAccessible(page, "共享库对话框（展开形状）");
      await snapshot(page, `m8-46-preview-${width}-${scheme}`);

      // 键盘：焦点在「收起」上，按空格收起，再按回车展开
      const collapse = row.getByRole("button", { name: `收起「${areaName}」的形状` });
      await collapse.focus();
      await page.keyboard.press("Space");
      await expect(preview).toHaveCount(0);
      const expand = row.getByRole("button", { name: `看「${areaName}」的形状` });
      await expect(expand).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(row.locator(`.shared-area__preview [data-area="${areaId}"]`)).toHaveCount(1);

      // 引用：确认步骤同样画出形状
      await row.getByRole("button", { name: `引用「${areaName}」` }).click();
      await expect(dialog).toContainText(`引用「${areaName}」（营运区 1 块 · 禁行区 1 块）`);
      await expect(dialog.locator(`.shared-area__preview [data-area="${areaId}"]`)).toHaveCount(1);
      await expectNoHorizontalOverflow(page, "共享库对话框（确认引用）");
      await expectAccessible(page, "共享库对话框（确认引用）");
      await snapshot(page, `m8-46-confirm-${width}-${scheme}`);
      await dialog.getByRole("button", { name: "引用到我的区域" }).click();
      await expect(page.getByRole("heading", { level: 1, name: areaName })).toBeVisible();
      await expect(page).toHaveURL(/\/areas\/[0-9a-f-]{36}$/);
    });
  }
}
