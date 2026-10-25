/**
 * 验收发现的界面小问题（M1-18），真实后端、真实 PostgreSQL：
 * 新增区域选城市的页面注明 GeoNames（许可条件），区域列表、商品页、运营后台的商品列表同样注明；
 * 子品牌名自己带了币种时不重复显示「（JPY）（JPY）」；主数据运营的角色说明里有「看待审核的改动」。
 * 汇率锁定「锁定多久」不预选、新建渠道「可卖的品类」默认不选、复核摘要的时区写法分别在 fx-locks*.spec.ts、channels.spec.ts 里测。
 * 每个页面在 1280px 和 320px 下不横向滚动，亮暗两色各过一次 axe。
 */
import { type Page, expect, test } from "@playwright/test";
import { createArea, createBrand, createProductByApi, createWorld, expectAccessible, tenantHeaders } from "./catalog.ts";
import { adminCredentials, createActiveTenant, expectNoHorizontalOverflow, loginAs, randomLetters } from "./support.ts";

const SCHEMES = ["light", "dark"] as const;
const GEONAMES_LINE = /^城市数据和机场的中文、日文名称来自 GeoNames.*（geonames\.org），CC BY 4\.0/;

async function checkPage(page: Page, what: string): Promise<void> {
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await expectNoHorizontalOverflow(page, `${what}（${width}px）`);
    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      await expectAccessible(page, `${what}（${width}px，${scheme}）`);
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
}

const attributions = (page: Page) => page.locator(".page__attribution");

test("数据来源署名和子品牌：新增区域、区域列表、商品基础信息和服务规则、运营后台商品列表都注明来源；名称带了币种的子品牌只显示一次币种", async ({ page, browser, request }) => {
  test.setTimeout(150_000);
  const world = await createWorld(request);
  const tenant = await createActiveTenant(request);
  const headers = await tenantHeaders(request, tenant.adminEmail, tenant.password);
  const brandName = `验收品牌${randomLetters(4)}（JPY）`;
  const brand = await createBrand(request, headers, brandName);
  const area = await createArea(request, headers, world.city, `通用区域 ${randomLetters(4)}`);
  const product = await createProductByApi(request, { tenant, headers, brand, area }, world, "airport_transfer");

  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);
  // 新增区域：城市选择旁边有 GeoNames 的署名，链过去
  await page.goto("/areas/new");
  await expect(page.getByRole("combobox", { name: /城市/ })).toBeVisible();
  await expect(attributions(page)).toHaveCount(1);
  await expect(attributions(page)).toHaveText(GEONAMES_LINE);
  await expect(attributions(page).getByRole("link", { name: /^GeoNames/ })).toHaveAttribute("href", "https://www.geonames.org/");
  await checkPage(page, "新增区域");
  // 区域列表
  await page.goto("/areas");
  await expect(page.getByRole("link", { name: area.name, exact: true }).first()).toBeVisible();
  await expect(attributions(page)).toHaveText(GEONAMES_LINE);
  await checkPage(page, "区域列表");
  // 商品：基础信息一份（机场 + 城市），服务规则同样一份，不重复
  await page.goto(`/products/${product.id}/basic`);
  await expect(page.getByRole("heading", { level: 2, name: "① 基础信息" })).toBeVisible();
  await expect(attributions(page)).toHaveCount(2);
  await expect(page.getByText(brandName, { exact: true })).toBeVisible();
  await expect(page.getByText(`${brandName}（JPY）`)).toHaveCount(0);
  await page.goto(`/products/${product.id}/service-rules`);
  await expect(page.getByRole("heading", { level: 2, name: "② 服务规则" })).toBeVisible();
  await expect(attributions(page)).toHaveCount(2);
  await expect(attributions(page).first()).toHaveText(/^机场数据来自 OurAirports/);
  await checkPage(page, "商品服务规则");

  // 运营后台的商品列表：子品牌只有一个「（JPY）」，有两行署名
  const admin = adminCredentials();
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL ?? "", locale: "zh-CN" });
  const platform = await context.newPage();
  await loginAs(platform, "platform", admin.email, admin.password);
  await platform.goto(`/platform/products?q=${product.code}`);
  const row = platform.getByRole("row").filter({ hasText: product.code });
  await expect(row).toBeVisible();
  await expect(row.getByRole("link", { name: `只看子品牌「${brandName}」的商品` })).toHaveText(brandName);
  await expect(platform.locator("body")).not.toContainText("（JPY）（JPY）");
  await expect(attributions(platform)).toHaveCount(2);
  await checkPage(platform, "运营后台商品列表");
  await context.close();
});

test("新增平台员工：主数据运营的说明写着「看待审核的改动」", async ({ page }) => {
  const admin = adminCredentials();
  await loginAs(page, "platform", admin.email, admin.password);
  await page.goto("/platform/settings/staff/new");
  await expect(page.getByText("维护城市、机场、车站、车型组、附加服务。 现在能做的：维护主数据、管理汇率（立即拉取、确认或放弃变动过大的汇率，发起人工锁定和解锁）、审核汇率的人工锁定和解锁、看待审核的改动。").first()).toBeVisible();
  await checkPage(page, "新增平台员工");
});
