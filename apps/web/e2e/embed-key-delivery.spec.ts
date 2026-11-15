/**
 * 运营后台按「两段代码」交付嵌入组件（M9E-26，ADR 0095 附录 A）端到端：真实浏览器 → 运营后台 → 真实 API → 真实 PostgreSQL。
 *
 * 新建嵌入码不填预订页地址 → 卡片只有①入口小程序（不带 bookingUrl）和「为什么没有第二段」→ 修改：允许整页嵌入、填白名单外的预订页地址被拒、
 * 改成白名单里的 → 卡片出现①（init 带 bookingUrl）和②预订程序（mountBooking），各有说明和复制按钮，键盘按 Enter 复制、有「已复制」。
 * 两种状态都在 1280 / 390 宽、亮暗两色做 axe 检查，不横向滚动；设置了 E2E_SCREENSHOT_DIR 时各留一张图。
 */
import { type Locator, type Page, expect, test } from "@playwright/test";
import { expectAccessible } from "./catalog.ts";
import { adminCredentials, expectNoHorizontalOverflow, loginAs, randomLetters, snapshot } from "./support.ts";

/** 两种宽度不横向滚动，亮暗两色 axe 都是 0，留图 */
async function checkCard(page: Page, card: Locator, what: string, shot: string): Promise<void> {
  for (const [width, height] of [[1280, 900], [390, 844]] as const) {
    await page.setViewportSize({ width, height });
    await card.scrollIntoViewIfNeeded();
    await expectNoHorizontalOverflow(page, `${what}（${width}px）`);
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expectAccessible(page, `${what}（${width}px，${scheme === "light" ? "亮色" : "暗色"}）`);
      if (width === 1280) await snapshot(page, `${shot}-${scheme}`);
      // 整张卡片一张图（页面图只截到一屏）
      const dir = process.env["E2E_SCREENSHOT_DIR"];
      if (dir && width === 1280) await card.screenshot({ path: `${dir}/${shot}-${scheme}-card.png` });
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1280, height: 900 });
}

test("运营在后台填写预订页地址并允许整页嵌入后，卡片上出现两段代码：①入口小程序带 bookingUrl、②预订程序 mountBooking；没填时只有①并写明原因", async ({ page }) => {
  const name = `端到端合作网站 ${randomLetters(4)}`;
  const site = `https://partner-${randomLetters(6).toLowerCase()}.example`;
  const bookingUrl = `${site}/booking/`;
  const admin = adminCredentials();
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAs(page, "platform", admin.email, admin.password);
  await page.goto("/platform/embed-keys");
  await page.getByRole("button", { name: "新建嵌入码" }).click();
  await page.getByLabel(/^名称/).fill(name);
  await page.getByLabel(/^允许的网站/).fill(site);
  await page.getByRole("button", { name: "生成嵌入码" }).click();

  // 没填：只有①，不带 bookingUrl，旁边写原因
  const card = page.getByRole("region", { name });
  const entry = card.getByRole("region", { name: "① 入口小程序" });
  await expect(entry).toBeVisible();
  await expect(card.getByText("填写预订页地址并开启「允许整页嵌入」后，这里会出现第二段代码（预订程序）。")).toBeVisible();
  await expect(card.getByRole("region", { name: "② 预订程序" })).toHaveCount(0);
  await expect(entry.getByText("放在任何页面（首页、文章页等），客人填好行程后跳到 NOZOMI 主站完成预订。")).toBeVisible();
  const legacy = (await entry.getByLabel(`${name}的① 入口小程序代码`, { exact: true }).textContent()) ?? "";
  expect(legacy).toMatch(/NozomiBooking\.init\(\{ key: "nze_[A-Za-z0-9_-]{32}", root: "#nozomi-booking", lang: "ja", services: \["transfer","charter"\] \}\);/);
  expect(legacy).not.toContain("bookingUrl");
  await checkCard(page, card, "嵌入码卡片（没填预订页地址）", "m9e26-card-unfilled");

  // 修改：允许整页嵌入；先填白名单外的地址被拒，标在这一栏
  await card.getByRole("button", { name: "修改" }).click();
  await card.getByRole("radio", { name: "允许（预订流程嵌在合作网站页面里）" }).check();
  const field = card.getByLabel("预订页地址（选填）");
  await field.fill("https://elsewhere.example/booking/");
  await card.getByRole("button", { name: "保存" }).click();
  await expect(card.getByText(/这个地址的网站不在「允许的网站」里/)).toBeVisible();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  await field.fill(bookingUrl);
  await card.getByRole("button", { name: "保存" }).click();

  // 填了：两段代码，各有说明和复制按钮
  const booking = card.getByRole("region", { name: "② 预订程序" });
  await expect(booking).toBeVisible();
  await expect(card.getByText(/这里会出现第二段代码/)).toHaveCount(0);
  await expect(card.getByText(bookingUrl, { exact: true })).toBeVisible();
  await expect(entry.getByText("放在任何页面（首页、文章页等），客人填好行程后会跳到你的预订页。")).toBeVisible();
  await expect(booking.getByText("只放在预订页，接收入口传来的行程，显示报价和下单流程。")).toBeVisible();
  const entryCode = (await entry.getByLabel(`${name}的① 入口小程序代码`, { exact: true }).textContent()) ?? "";
  const bookingCode = (await booking.getByLabel(`${name}的② 预订程序代码`, { exact: true }).textContent()) ?? "";
  expect(entryCode).toContain(`, bookingUrl: "${bookingUrl}" });`);
  expect(entryCode).toBe(legacy.replace(" });", `, bookingUrl: "${bookingUrl}" });`));
  expect(bookingCode).toMatch(/^<div id="nozomi-booking-flow"><\/div>\n<script src="[^"]+\/embed\/widget-v1\.js" defer><\/script>/);
  expect(bookingCode).toMatch(/NozomiBooking\.mountBooking\(\{ key: "nze_[A-Za-z0-9_-]{32}", root: "#nozomi-booking-flow", lang: "ja" \}\);/);

  // 复制按钮：读屏名称说清复制哪一段；键盘按 Enter 复制，复制后有「已复制」
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const copyBooking = booking.getByRole("button", { name: `复制${name}的② 预订程序代码` });
  await copyBooking.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".toast").filter({ hasText: "已复制" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(bookingCode);
  await entry.getByRole("button", { name: `复制${name}的① 入口小程序代码` }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(entryCode);
  await checkCard(page, card, "嵌入码卡片（两段代码）", "m9e26-card-filled");
});
