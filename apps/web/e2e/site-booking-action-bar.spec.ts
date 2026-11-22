/**
 * 端到端：手机 390 宽的底部按钮条（M9E-32，业主验收意见 2026-11-16 iPhone Safari，ADR 0100）——主站 /book。
 * 嵌入页（iframe 被宿主撑到全高）的那一半在 site-embed-booking.spec.ts 的「M9E-32 跨站」。
 *
 * - 每一步的主按钮（「下一步：选择车型」「下一步：填写乘客信息」「下一步：核对订单」「去付款 →」）和「上一步」在底部按钮条里，
 *   滚到页面顶部时也在屏幕里、没被盖住；
 * - 第 2 步没选车时「下一步」灰着，条里写「请先选择车型」（aria-describedby）；只有一条条（原来的「车型 · 一口价」条并进来了）；
 * - 滚到最底下时条不挡表单最后一项（给司机的备注、同意保存银行卡）和页脚；
 * - 电脑 1280 宽没有底部条，按钮照旧在正文末尾。
 * - 平板 900 宽（业主 2026-11-17 决定，ADR 0100 补充）：和手机一样用底部按钮条，贴在屏幕底部；1024 宽两栏时没有条。
 * 截图存到 E2E_SCREENSHOT_DIR（m9e32-main-step*.png）。
 */
import { type Locator, type Page, expect, test } from "@playwright/test";
import { E2E_WEB_PLACES_PORT } from "../playwright.config.ts";
import { TOKYO_STATION, airportLink, createAirport, expectNarrowAndAccessible, publishTransfer, tomorrowInTokyo } from "./book-new-support.ts";
import { createSupplier, createWorld } from "./catalog.ts";
import { OWN_SITE_SOURCE, snapshot } from "./support.ts";

test.use(OWN_SITE_SOURCE);
// iPhone 13 的可见区域（390 × 664，去掉浏览器地址栏和工具栏），手指操作
const PHONE = { width: 390, height: 664 };
test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

const SITE = `http://127.0.0.1:${E2E_WEB_PLACES_PORT}`;

/** 滚到页面顶部：按钮在屏幕里、没被别的东西盖住 */
async function expectOnScreenAtTop(page: Page, button: Locator, what: string): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(button, what).toBeVisible();
  const box = await button.boundingBox();
  const height = page.viewportSize()?.height ?? PHONE.height;
  expect(box !== null && box.y >= 0 && box.y + box.height <= height, `${what}：滚到页面顶部时在屏幕里 ${JSON.stringify(box)}`).toBe(true);
  const uncovered = await button.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return hit !== null && element.contains(hit);
  });
  expect(uncovered, `${what}：没被盖住`).toBe(true);
}

/** 滚到最底下：这个元素整个在底部条上方 */
async function expectAboveBarAtBottom(page: Page, target: Locator, what: string): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const box = await target.boundingBox();
  const bar = await page.locator(".step-bar").boundingBox();
  expect(box !== null && bar !== null && box.y + box.height <= bar.y + 0.5, `${what}：滚到底时在底部条上方 ${JSON.stringify({ box, bar })}`).toBe(true);
}

test("M9E-32 主站手机 390：四步的主按钮和「上一步」在底部按钮条里，滚到顶也看得见；第 2 步没选车时灰着写原因；滚到底不挡最后一项和页脚；电脑 1280 没有底部条；亮暗 axe；截图", async ({ page, request }) => {
  test.setTimeout(180_000);
  const world = await createWorld(request);
  const airport = await createAirport(request, world);
  await publishTransfer(request, await createSupplier(request, world), { ...world, airport });
  const bar = page.locator(".step-bar");

  // 第 1 步
  await page.goto(`${SITE}/book`);
  await expect(page.getByRole("heading", { name: "你的行程" })).toBeVisible();
  await expectOnScreenAtTop(page, bar.getByRole("button", { name: "下一步：选择车型" }), "第 1 步「下一步：选择车型」");
  await expect(page.locator(".book-new__actions")).toHaveCount(0);
  await expectAboveBarAtBottom(page, page.locator(".site__footer"), "第 1 步页脚");
  await snapshot(page, "m9e32-main-step1");

  // 第 2 步：链接打开就报价
  await page.goto(`${SITE}/book?${airportLink(airport)}&to=${TOKYO_STATION.lat},${TOKYO_STATION.lng}&to_name=${encodeURIComponent("東京駅八重洲口")}&date=${tomorrowInTokyo()}&time=11:30&pax=2&bags=1`);
  const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: world.group.name }) });
  await expect(card).toBeVisible();
  const next = bar.getByRole("button", { name: "下一步：填写乘客信息" });
  await expect(next).toBeDisabled();
  await expect(next).toHaveAttribute("aria-describedby", "book-step-reason");
  await expect(bar.locator("#book-step-reason")).toHaveText("请先选择车型");
  await expectOnScreenAtTop(page, bar.getByRole("button", { name: "上一步" }), "第 2 步「上一步」");
  await card.getByRole("button", { name: `选择 ${world.group.name}` }).tap();
  await expect(next).toBeEnabled();
  await expect(bar.locator("#book-step-reason")).toHaveCount(0);
  await expect(bar.locator(".step-bar__summary")).toContainText(world.group.name);
  await expect(bar).toHaveCount(1);
  await expectOnScreenAtTop(page, next, "第 2 步「下一步：填写乘客信息」");
  await expectNarrowAndAccessible(page, "M9E-32 第 2 步（底部按钮条）");
  await next.tap();

  // 第 3 步
  await expect(page.getByRole("heading", { level: 2, name: "乘客信息" })).toBeVisible();
  await page.getByLabel("航班号").fill("NH211");
  await page.getByRole("radio", { name: /^国际航班/ }).check();
  await page.getByLabel("乘车人姓名").fill("王小明");
  await page.getByLabel("邮箱").fill(`m9e32-${crypto.randomUUID().slice(0, 8)}@e2e.example.com`);
  await page.getByLabel("手机号（含国家区号）").fill("+81 90-1234-5678");
  await expectOnScreenAtTop(page, bar.getByRole("button", { name: "下一步：核对订单" }), "第 3 步「下一步：核对订单」");
  await expectAboveBarAtBottom(page, page.getByLabel("给司机的备注（选填）"), "第 3 步最后一项");
  await snapshot(page, "m9e32-main-step3");
  await bar.getByRole("button", { name: "下一步：核对订单" }).tap();

  // 第 4 步：「上一步」「去付款」在条里，同意保存银行卡在页面最下面（条上方）
  await expect(page.getByRole("heading", { name: "核对订单" })).toBeVisible();
  await expectOnScreenAtTop(page, bar.getByRole("button", { name: "去付款 →" }), "第 4 步「去付款」");
  await expectOnScreenAtTop(page, bar.getByRole("button", { name: "上一步" }), "第 4 步「上一步」");
  await expect(page.getByRole("button", { name: "上一步" })).toHaveCount(1);
  await expectAboveBarAtBottom(page, page.getByRole("checkbox", { name: /同意保存这次付款用的银行卡/ }), "第 4 步同意保存银行卡");
  await expectAboveBarAtBottom(page, page.locator(".site__footer"), "第 4 步页脚");
  await expectNarrowAndAccessible(page, "M9E-32 第 4 步（底部按钮条）");
  await page.evaluate(() => window.scrollTo(0, 0));
  await snapshot(page, "m9e32-main-step4");

  // 电脑：没有底部条，按钮照旧在正文末尾，页面底部不留空
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(bar).toHaveCount(0);
  await expect(page.locator(".book-new__review .book-pay").getByRole("button", { name: "去付款 →" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.hasAttribute("data-book-actionbar"))).toBe(false);
});

test.describe("平板 900（业主 2026-11-17：769–1023 也用底部按钮条）", () => {
  const TABLET = { width: 900, height: 1000 };
  test.use({ viewport: TABLET, hasTouch: false, isMobile: false });

  test("M9E-32 平板 900：第 1、2 步的按钮在底部按钮条里，条贴在屏幕底部、滚到顶也看得见；没选车时灰着写原因；滚到底不挡页脚；1024 两栏没有条", async ({ page, request }) => {
    test.setTimeout(120_000);
    const world = await createWorld(request);
    const airport = await createAirport(request, world);
    await publishTransfer(request, await createSupplier(request, world), { ...world, airport });
    const bar = page.locator(".step-bar");

    // 第 1 步：条固定在屏幕底部（position: fixed，下沿贴着视口下沿）
    await page.goto(`${SITE}/book`);
    await expect(page.getByRole("heading", { name: "你的行程" })).toBeVisible();
    await expect(page.locator(".step-bar-slot--fixed > .step-bar")).toHaveCount(1);
    await expect(page.locator(".book-new__actions")).toHaveCount(0);
    expect(await bar.evaluate((element) => getComputedStyle(element).position)).toBe("fixed");
    await expectOnScreenAtTop(page, bar.getByRole("button", { name: "下一步：选择车型" }), "平板第 1 步「下一步：选择车型」");
    const stuck = await bar.boundingBox();
    expect(stuck !== null && Math.abs(stuck.y + stuck.height - TABLET.height) <= 1 && stuck.width >= TABLET.width - 1, `条贴在屏幕底部、占满宽度 ${JSON.stringify(stuck)}`).toBe(true);
    await expectAboveBarAtBottom(page, page.locator(".site__footer"), "平板第 1 步页脚");

    // 第 2 步：没选车时灰着、写原因；选了车可点
    await page.goto(`${SITE}/book?${airportLink(airport)}&to=${TOKYO_STATION.lat},${TOKYO_STATION.lng}&to_name=${encodeURIComponent("東京駅八重洲口")}&date=${tomorrowInTokyo()}&time=11:30&pax=2&bags=1`);
    const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: world.group.name }) });
    await expect(card).toBeVisible();
    const next = bar.getByRole("button", { name: "下一步：填写乘客信息" });
    await expect(next).toBeDisabled();
    await expect(bar.locator("#book-step-reason")).toHaveText("请先选择车型");
    await expectOnScreenAtTop(page, bar.getByRole("button", { name: "上一步" }), "平板第 2 步「上一步」");
    await card.getByRole("button", { name: `选择 ${world.group.name}` }).click();
    await expect(next).toBeEnabled();
    await expectOnScreenAtTop(page, next, "平板第 2 步「下一步：填写乘客信息」");
    await expectNarrowAndAccessible(page, "M9E-32 平板 900 第 2 步（底部按钮条）");
    await snapshot(page, "m9e32-main-tablet-900-step2");

    // 1024：两栏，没有底部条，按钮回到正文末尾
    await page.setViewportSize({ width: 1024, height: 900 });
    await expect(bar).toHaveCount(0);
    await expect(page.locator(".book-new__vehicles .book-new__actions").getByRole("button", { name: "下一步：填写乘客信息" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.hasAttribute("data-book-actionbar"))).toBe(false);
  });
});
