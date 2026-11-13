/**
 * M6-10 供应商后台分步配置：换步后焦点移到步骤标题，聚焦框只在键盘（或拿不准）时显示（docs/design/01-tokens.md 第 5 节「程序聚焦的例外」，
 * pages/tenant-products.md 3.1、13 节「键盘」）。真实浏览器、真实后端、真实 PostgreSQL；亮暗两套各走一遍。
 */
import { type Locator, type Page, expect, test } from "@playwright/test";
import { createProductByApi, createSupplier, createWorld, expectAccessible } from "./catalog.ts";
import { expectNoHorizontalOverflow, loginAs, snapshot } from "./support.ts";

const title = (page: Page, name: string): Locator => page.getByRole("heading", { level: 2, name });
const stepLink = (page: Page, name: RegExp): Locator => page.getByRole("navigation", { name: "配置步骤" }).getByRole("link", { name });

/** 标题现在画出来的聚焦框（看计算后的样式，不看标记）：「2px solid」或「none」 */
async function ringOf(heading: Locator): Promise<string> {
  return heading.evaluate((node) => {
    const style = getComputedStyle(node);
    return style.outlineStyle === "none" || style.outlineWidth === "0px" ? "none" : `${style.outlineWidth} ${style.outlineStyle}`;
  });
}

async function expectRing(heading: Locator, ring: "2px solid" | "none", why: string): Promise<void> {
  await expect(heading, why).toBeFocused();
  await expect.poll(() => ringOf(heading), { message: why }).toBe(ring);
}

test("M6-10 换步后标题的聚焦框：键盘换步有 2px 环；鼠标点步骤导航、「保存并下一步」没有环但焦点在标题；之后按方向键环出现；浏览器后退有环；亮暗两色、axe 无问题", async ({ page, request }) => {
  test.setTimeout(150_000);
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  const product = await createProductByApi(request, supplier, world, "airport_transfer");
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);

  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    // 直接打开带步骤的网址：拿不准，画框
    await page.goto(`/products/${product.id}/basic`);
    await expectRing(title(page, "① 基础信息"), "2px solid", "直接打开网址");

    // 键盘：在步骤导航上按 Enter
    await stepLink(page, /服务规则/).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/service-rules$/);
    await expectRing(title(page, "② 服务规则"), "2px solid", "键盘 Enter 换步");
    await snapshot(page, `step-title-keyboard-${scheme}`);
    await expectAccessible(page, `键盘换步后的服务规则（${scheme}）`);

    // 鼠标：点步骤导航
    await stepLink(page, /基础信息/).click();
    await expect(page).toHaveURL(/\/basic$/);
    await expectRing(title(page, "① 基础信息"), "none", "鼠标点步骤导航");
    await snapshot(page, `step-title-pointer-${scheme}`);
    // 再按 Tab：焦点去到标题后面的第一个可操作元素，那里照常有框
    await page.keyboard.press("Tab");
    await expect(title(page, "① 基础信息")).not.toBeFocused();
    expect(await page.evaluate(() => document.activeElement?.matches(":focus-visible") ?? false), "Tab 到的下一个控件有框").toBe(true);

    // 鼠标点「保存并下一步」（没有修改：直接去下一步）；之后在标题上按方向键，框出现
    await page.getByRole("button", { name: "保存并下一步" }).click();
    await expect(page).toHaveURL(/\/service-rules$/);
    const rules = title(page, "② 服务规则");
    await expectRing(rules, "none", "鼠标点「保存并下一步」");
    await page.keyboard.press("Shift");
    await expectRing(rules, "none", "只按 Shift 不算");
    await page.keyboard.press("ArrowDown");
    await expectRing(rules, "2px solid", "鼠标换步后按方向键");
    await snapshot(page, `step-title-pointer-then-key-${scheme}`);

    // 鼠标直接点标题文字：不画
    await rules.click();
    await expectRing(rules, "none", "鼠标直接点标题文字");

    // 进入上架检查：鼠标点没有框；浏览器后退回到 ②：有框
    await stepLink(page, /上架检查/).click();
    await expect(page).toHaveURL(/\/publish$/);
    await expectRing(title(page, "上架检查"), "none", "鼠标进入上架检查");
    await page.goBack();
    await expect(page).toHaveURL(/\/service-rules$/);
    await expectRing(title(page, "② 服务规则"), "2px solid", "浏览器后退");
    await snapshot(page, `step-title-back-${scheme}`);
    await expectAccessible(page, `后退回到服务规则（${scheme}）`);
  }
});

test("M6-10 手机宽度（400px）：点开收起的步骤导航再点一步，标题没有框、焦点在标题；不横向滚动", async ({ page, request }) => {
  test.setTimeout(120_000);
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  const product = await createProductByApi(request, supplier, world, "airport_transfer");
  await page.setViewportSize({ width: 400, height: 800 });
  await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);
  await page.goto(`/products/${product.id}/basic`);
  await expect(title(page, "① 基础信息")).toBeFocused();
  await page.locator(".step-nav__toggle").click();
  await stepLink(page, /商品详情/).click();
  await expect(page).toHaveURL(/\/content$/);
  await expectRing(title(page, "⑤ 商品详情"), "none", "手机上点开导航再点一步");
  await expectNoHorizontalOverflow(page, "手机宽度的商品详情");
  await snapshot(page, "step-title-pointer-mobile");
});

test("M6-10 首页入口卡片（聚焦环的第三处例外）：键盘聚焦时整张卡片一圈 2px 环，标题链接自身没有环；亮暗两色", async ({ page, request }) => {
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);
  const link = page.locator(".entry-card").getByRole("link", { name: /^商品/ }).first();
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.locator("main").focus();
    for (let presses = 0; presses < 40 && !(await link.evaluate((node) => node === document.activeElement)); presses += 1) await page.keyboard.press("Tab");
    await expect(link).toBeFocused();
    const rings = await link.evaluate((node) => {
      const own = getComputedStyle(node);
      const card = getComputedStyle(node, "::after");
      const box = node.closest(".entry-card")?.getBoundingClientRect();
      const after = { width: Number.parseFloat(card.width), height: Number.parseFloat(card.height) };
      return { visible: node.matches(":focus-visible"), ownColor: own.outlineColor, ownStyle: own.outlineStyle, card: `${card.outlineWidth} ${card.outlineStyle}`, coversCard: box !== undefined && Math.abs(after.width - box.width) < 3 && Math.abs(after.height - box.height) < 3 };
    });
    expect(rings.visible).toBe(true);
    expect(rings.ownColor, "标题链接自身的环是透明的").toBe("rgba(0, 0, 0, 0)");
    expect(rings.card, "卡片一圈 2px 环").toBe("2px solid");
    expect(rings.coversCard, "环画在整张卡片上").toBe(true);
    await snapshot(page, `entry-card-focus-${scheme}`);
  }
});
