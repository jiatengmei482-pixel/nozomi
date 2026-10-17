/**
 * 汇率中心（M2-03），真实后端、真实 PostgreSQL；汇率源是 global-setup 起的本机假服务器（给的是「一小时前」的一批，日期跟着今天走）。
 * 两个 API 进程都在跑定时拉取，同一个库里只会有一个真的去拉。
 */
import { type Page, expect, test } from "@playwright/test";
import { E2E_FX_RATES, VIEWPORTS, adminCredentials, expectNoHorizontalOverflow, loginAs } from "./support.ts";

async function signInAsAdmin(page: Page): Promise<void> {
  const admin = adminCredentials();
  await loginAs(page, "platform", admin.email, admin.password);
}

test("汇率页：立即拉取后看到当前汇率、互换表、走势和拉取记录；首页的汇率卡片显示更新时间", async ({ page }) => {
  await signInAsAdmin(page);
  await page.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "汇率" }).click();
  await expect(page).toHaveURL(/\/platform\/master\/fx-rates$/);
  await expect(page.getByRole("heading", { level: 1, name: "汇率" })).toBeVisible();
  await page.getByRole("button", { name: "立即拉取" }).click();
  // 定时任务可能已经拉到过同一批：两种结果都对
  await expect(page.getByText(/^(汇率已更新|数据源还没有更新，汇率不变)$/)).toBeVisible();
  const source = page.getByRole("region", { name: "数据源" });
  await expect(source.getByText("正常", { exact: true })).toBeVisible();
  const rates = page.getByRole("region", { name: "当前汇率表" });
  await expect(rates.getByRole("row", { name: /JPY 日元/ })).toContainText(E2E_FX_RATES.JPY);
  // 1 CNY = 150.5 / 7.2 = 20.902777… 日元
  const matrix = page.getByRole("region", { name: "币种互换表" });
  await expect(matrix.getByRole("row", { name: /^CNY/ }).getByTitle("20.902777777778")).toHaveText("20.9027");
  await expect(page.getByRole("img", { name: /近 30 天 1 USD 兑 日元/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "拉取记录表" }).getByText("手动（端到端测试管理员）").first()).toBeVisible();

  await page.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "首页" }).click();
  const card = page.locator(".entry-card", { has: page.getByRole("link", { name: /^汇率/ }) });
  await expect(card).toContainText("更新于");
  await expect(page.getByText("汇率超过 48 小时没有更新，跨币种报价已暂停")).toHaveCount(0);
});

test("汇率页在手机宽度下不横向滚动（表格在自己的容器里滚动）", async ({ page }) => {
  await page.setViewportSize(VIEWPORTS.phone360);
  await signInAsAdmin(page);
  await page.goto("/platform/master/fx-rates");
  await expect(page.getByRole("heading", { level: 2, name: "常用币种互换" })).toBeVisible();
  await expectNoHorizontalOverflow(page, "汇率页（360px）");
});
