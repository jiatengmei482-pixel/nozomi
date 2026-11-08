/**
 * M6-07 整站美化收尾（ADR 0066）：
 * - 运营后台的正文自己滚动；正文里绝对定位的读屏文字（.visually-hidden）不能把整个窗口撑高、滚出一块空白；
 * - 官网宽屏时页脚署名和页眉、正文左右对齐。
 */
import { expect, test } from "@playwright/test";
import { adminCredentials, loginAs } from "./support.ts";

test("运营后台 360 宽：报价试算这种长页面只在正文里滚动，整个窗口不滚、底下没有空白", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  const admin = adminCredentials();
  await loginAs(page, "platform", admin.email, admin.password);
  await page.goto("/platform/quote-preview");
  await expect(page.getByRole("heading", { level: 1, name: "报价试算" })).toBeVisible();
  const sizes = await page.evaluate(() => ({ document: document.documentElement.scrollHeight, viewport: window.innerHeight }));
  expect(sizes.document, "整个窗口的高度不超过视口").toBeLessThanOrEqual(sizes.viewport + 1);
});

test("官网 1280 宽：页脚署名和正文左边对齐", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/book");
  const footer = page.locator(".site__footer");
  await expect(footer).toBeVisible();
  const left = await page.evaluate(() => {
    const edge = (selector: string): number => {
      const element = document.querySelector(selector) as HTMLElement;
      return element.getBoundingClientRect().left + Number.parseFloat(getComputedStyle(element).paddingLeft);
    };
    return { main: edge(".site__main"), footer: edge(".site__footer") };
  });
  expect(Math.abs(left.footer - left.main)).toBeLessThanOrEqual(1);
});
