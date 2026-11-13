/**
 * 端到端：手机上新预订页的地址显示（M8-37b，用户 2026-11-13 真机反馈：上车 / 下车地点左右两栏，地址显示宽度被压缩）。
 * 规范 site-booking-v2.md 第 0 节「手机上的地址（M8-37b）」。核对：
 * - 手机触屏 360 / 390 宽，「区间」「包车」两个标签：第 1 步出发地 / 目的地（包车的上车 / 下车地点）上下排、各占整行，
 *   长地址折行显示全（框跟着变高，字不被裁掉）；地址选择页（M8-37 的全屏选择页）占满屏幕，四个入口输入后输入框占满整行、
 *   候选列表在正下方同样整行宽（用户 iPhone 真机截图：候选排到输入框右边各占半行）；
 * - 第 2–4 步顶部「行程摘要」条：两端各占一行、各自用满整行宽，各自单行省略；完整地名在读屏名里，展开后折行显示全；
 * - 不横向滚动；亮暗两色 axe；
 * - 电脑 1280 宽布局不变：地址框整行上下排、日期时间并排、右侧栏地名折行显示全；平板 800 宽摘要条照旧一行。
 * 地点用链接参数给（坐标 + 很长的名称）；选择页里输入平台的机场 / 车站名看候选；用地址搜索那组 API 和前端（假谷歌），不调用真实的谷歌。
 * 手机用例在 chromium 和 webkit-iphone 两个项目里都跑（playwright.config.ts），电脑用例只在 chromium 里跑。
 */
import { type APIRequestContext, type Browser, type BrowserContext, type Locator, type Page, expect, test } from "@playwright/test";
import { E2E_WEB_PLACES_PORT } from "../playwright.config.ts";
import { TOKYO_STATION, createAirport, publishTransfer, tomorrowInTokyo } from "./book-new-support.ts";
import { createSupplier, createWorld, expectAccessible } from "./catalog.ts";
import { charterWorld, linkPoint } from "./charter-support.ts";
import { OWN_SITE_SOURCE } from "./support.ts";

test.use(OWN_SITE_SOURCE);

const SITE = `http://127.0.0.1:${E2E_WEB_PLACES_PORT}`;
const LONG_FROM = "京王广场酒店本馆南口出租车乘车处（新宿区西新宿二丁目 2-1）";
const LONG_TO = "东京迪士尼海洋观海景大饭店 正门大堂（千叶县浦安市舞滨 1-13）";
const PHONES = [
  { width: 360, height: 740 },
  { width: 390, height: 844 },
];

interface Tab {
  name: "区间" | "包车";
  link: string;
  labels: [string, string];
  /** 选择页里输入它，候选里有平台的地点 */
  query: string;
}

async function phone(browser: Browser, size: { width: number; height: number }): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: size, hasTouch: true, isMobile: true, locale: "zh-CN" });
  return { context, page: await context.newPage() };
}

async function box(locator: Locator, what: string): Promise<{ x: number; y: number; width: number; height: number }> {
  const found = await locator.boundingBox();
  if (found === null) throw new Error(`量不到${what}`);
  return found;
}

async function expectNoOverflow(page: Page, what: string): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${what}：横向溢出`).toBe(0);
}

async function expectBothThemes(page: Page, what: string): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `${what}（${scheme === "light" ? "亮色" : "暗色"}）`);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

/** 第 1 步：两端上下排、各占整行（和「乘客 / 行李」一样宽），长地址折行显示全、没有被裁掉。 */
async function expectStep1Rows(page: Page, tab: Tab, width: number): Promise<void> {
  const what = `${width}px ${tab.name}第 1 步`;
  const [fromLabel, toLabel] = tab.labels;
  const from = page.getByRole("button", { name: new RegExp(`^${fromLabel}`) });
  const to = page.getByRole("button", { name: new RegExp(`^${toLabel}`) });
  await expect(from).toContainText(LONG_FROM);
  await expect(to).toContainText(LONG_TO);
  const full = await box(page.getByRole("button", { name: /^乘客 \/ 行李/ }), "乘客 / 行李");
  const fromBox = await box(from, fromLabel);
  const toBox = await box(to, toLabel);
  expect(toBox.y, `${what}：${toLabel}在${fromLabel}下面`).toBeGreaterThanOrEqual(fromBox.y + fromBox.height);
  for (const [cell, name] of [[fromBox, fromLabel], [toBox, toLabel]] as const) {
    expect(Math.abs(cell.x - full.x), `${what}：${name}左边对齐整行`).toBeLessThanOrEqual(1);
    expect(cell.width, `${what}：${name}占整行宽`).toBeGreaterThanOrEqual(full.width - 1);
    expect(cell.width, `${what}：${name}接近屏幕宽`).toBeGreaterThan(width * 0.8);
  }
  for (const [cell, name] of [[from, fromLabel], [to, toLabel]] as const) {
    const text = await cell.locator(".picker-trigger__text").evaluate((node) => {
      const own = node.getBoundingClientRect();
      const button = (node.closest("button") as HTMLElement).getBoundingClientRect();
      const lineHeight = Number.parseFloat(getComputedStyle(node).lineHeight);
      return { lines: own.height / lineHeight, clipped: node.scrollWidth > node.clientWidth + 1, inside: own.top >= button.top - 0.5 && own.bottom <= button.bottom + 0.5 };
    });
    expect(text.lines, `${what}：${name}的长地址折行显示全`).toBeGreaterThan(1.5);
    expect(text.clipped, `${what}：${name}没有被横向裁掉`).toBe(false);
    expect(text.inside, `${what}：${name}的字都在框里（框跟着变高）`).toBe(true);
  }
  // 日期、时间仍是单行的一格
  const date = page.getByRole("button", { name: /^日期（当地）/ });
  const dateBox = await box(date, "日期");
  expect(dateBox.height, `${what}：日期仍是一行高`).toBeLessThan(fromBox.height);
}

/**
 * 地址选择页：占满屏幕；输入几个字、候选出来以后，输入框占满整行（≈ 选择页内容宽），候选列表在输入框正下方、同样整行宽
 * （M8-37b，用户 iPhone 真机截图：候选排到输入框右边、两个各占半行）；取消回到页面。
 */
async function expectSheetFullWidth(page: Page, label: string, query: string, size: { width: number; height: number }): Promise<void> {
  const what = `${size.width}px ${label}选择页`;
  await page.getByRole("button", { name: new RegExp(`^${label}`) }).tap();
  const sheet = page.getByRole("dialog", { name: label });
  await expect(sheet).toBeVisible();
  const sheetBox = await box(sheet, what);
  expect([Math.round(sheetBox.x), Math.round(sheetBox.y), Math.round(sheetBox.width), Math.round(sheetBox.height)], `${what}：占满屏幕`).toEqual([0, 0, size.width, size.height]);
  const combobox = sheet.getByRole("combobox", { name: label });
  await combobox.fill(query);
  const list = sheet.getByRole("listbox", { name: `${label}的候选` });
  await expect(list.getByRole("option").first()).toBeVisible();
  const body = await box(sheet.locator(".sheet__body"), `${what}的内容区`);
  const padding = await sheet.locator(".sheet__body").evaluate((node) => Number.parseFloat(getComputedStyle(node).paddingLeft) + Number.parseFloat(getComputedStyle(node).paddingRight));
  const input = await box(combobox, `${what}的输入框`);
  const options = await box(list, `${what}的候选列表`);
  expect(input.width, `${what}：输入框占满整行`).toBeGreaterThanOrEqual(body.width - padding - 1);
  expect(options.y, `${what}：候选在输入框下面`).toBeGreaterThanOrEqual(input.y + input.height - 0.5);
  expect(Math.abs(options.x - input.x), `${what}：候选和输入框左边对齐`).toBeLessThanOrEqual(1);
  expect(Math.abs(options.width - input.width), `${what}：候选和输入框一样宽`).toBeLessThanOrEqual(1);
  await expectNoOverflow(page, what);
  await sheet.getByRole("button", { name: "取消" }).tap();
  await expect(sheet).toBeHidden();
}

/** 第 2–4 步顶部的摘要条：两端各占一行、各自用满整行宽、各自单行省略；完整地名在读屏名里。 */
async function expectSummaryRows(page: Page, width: number, step: string): Promise<void> {
  const what = `${width}px ${step}摘要条`;
  const toggle = page.getByRole("button", { name: /^行程摘要/ });
  await expect(toggle).toHaveAccessibleName(new RegExp(`${LONG_FROM.replace(/[()（）]/g, ".")}.*${LONG_TO.replace(/[()（）]/g, ".")}`));
  const metrics = await page.locator(".book-summary-bar__text").evaluate((node) => {
    const text = node.getBoundingClientRect();
    return [...node.querySelectorAll(".book-summary-bar__end")].map((end) => {
      const own = end.getBoundingClientRect();
      const place = end.querySelector(".book-summary-bar__place") as HTMLElement;
      const lineHeight = Number.parseFloat(getComputedStyle(end).lineHeight);
      return { top: own.top, bottom: own.bottom, height: own.height, lineHeight, width: own.width, textWidth: text.width, placeRight: place.getBoundingClientRect().right, textRight: text.right, clipped: place.scrollWidth > place.clientWidth };
    });
  });
  expect(metrics.length, `${what}：两端各一块`).toBe(2);
  const [from, to] = metrics;
  if (from === undefined || to === undefined) throw new Error(`${what}：量不到两端`);
  expect(to.top, `${what}：下车那端在第二行`).toBeGreaterThanOrEqual(from.bottom - 0.5);
  for (const [end, name] of [[from, "出发那端"], [to, "到达那端"]] as const) {
    expect(end.height, `${what}：${name}只占一行`).toBeLessThan(end.lineHeight * 1.5);
    expect(end.width, `${what}：${name}用满整行宽`).toBeGreaterThanOrEqual(end.textWidth - 1);
    expect(end.placeRight, `${what}：${name}地名一直排到行尾`).toBeGreaterThan(end.textRight - 2);
    expect(end.clipped, `${what}：${name}的长地名单行省略`).toBe(true);
  }
}

async function walk(page: Page, tab: Tab, size: { width: number; height: number }): Promise<void> {
  const width = size.width;
  await page.goto(`${SITE}/book/new?${tab.link}`);
  const card = page.locator(".book-vehicle").first();
  await expect(card).toBeVisible();
  await expect(page).toHaveURL(/[?&]step=2/);
  await expectSummaryRows(page, width, `${tab.name}第 2 步`);

  await page.getByRole("button", { name: /^第 1 步/ }).tap();
  await expect(page.getByRole("heading", { name: "你的行程" })).toBeVisible();
  await expect(page.getByRole("radio", { name: tab.name })).toBeChecked();
  await expectStep1Rows(page, tab, width);
  await expectSheetFullWidth(page, tab.labels[0], tab.query, size);
  await expectSheetFullWidth(page, tab.labels[1], tab.query, size);
  await expectNoOverflow(page, `${width}px ${tab.name}第 1 步`);
  await expectBothThemes(page, `${width}px ${tab.name}第 1 步`);

  await page.getByRole("button", { name: "下一步：选择车型" }).tap();
  await card.getByRole("button", { name: /^选择 / }).tap();
  await expectSummaryRows(page, width, `${tab.name}第 2 步（选了车型）`);
  await expectNoOverflow(page, `${width}px ${tab.name}第 2 步`);
  await expectBothThemes(page, `${width}px ${tab.name}第 2 步`);
  await page.locator(".book-bar").getByRole("button", { name: "下一步" }).tap();
  await expect(page.getByRole("heading", { level: 2, name: "乘客信息" })).toBeVisible();
  await expectSummaryRows(page, width, `${tab.name}第 3 步`);
  const flight = page.getByLabel("航班号");
  if ((await flight.count()) > 0) await flight.fill("NH211");
  await page.getByLabel("乘车人姓名").fill("王小明");
  await page.getByLabel("邮箱").fill(`m837b-${crypto.randomUUID().slice(0, 8)}@e2e.example.com`);
  await page.getByLabel("手机号（含国家区号）").fill("+81 90-1234-5678");
  await page.getByRole("button", { name: "下一步：核对订单" }).tap();
  await expect(page.getByRole("heading", { name: "核对订单" })).toBeVisible();
  await expectSummaryRows(page, width, `${tab.name}第 4 步`);
  // 核对里的行程、展开的摘要：地名整行折行显示全
  await expect(page.getByRole("region", { name: "核对订单" })).toContainText(LONG_FROM);
  await page.getByRole("button", { name: /^行程摘要/ }).tap();
  const panel = page.locator("#book-summary-panel");
  await expect(panel).toContainText(LONG_FROM);
  await expect(panel).toContainText(LONG_TO);
  await expectNoOverflow(page, `${width}px ${tab.name}第 4 步（摘要展开）`);
  await expectBothThemes(page, `${width}px ${tab.name}第 4 步（摘要展开）`);
}

async function tabs(request: APIRequestContext): Promise<Tab[]> {
  const world = await createWorld(request);
  const airport = await createAirport(request, world);
  const supplier = await createSupplier(request, world);
  await publishTransfer(request, supplier, { ...world, airport });
  const trip = await charterWorld(request);
  const date = tomorrowInTokyo();
  return [
    { name: "区间", link: `${linkPoint("from", airport.location, LONG_FROM)}&${linkPoint("to", TOKYO_STATION, LONG_TO)}&date=${date}&time=10:00`, labels: ["出发地", "目的地"], query: airport.name },
    { name: "包车", link: `mode=charter&${linkPoint("from", trip.pickup, LONG_FROM)}&${linkPoint("to", trip.station.location, LONG_TO)}&date=${date}&time=10:00`, labels: ["上车地点", "下车地点"], query: trip.station.name },
  ];
}

test("M8-37b 手机 360 / 390「区间」「包车」：第 1 步两端上下排、整行宽、长地址折行显示全；四个入口的地址选择页占满屏幕、输入框整行、候选在正下方整行宽；第 2–4 步摘要条两端各占一行；不横向滚动；亮暗 axe", async ({ browser, request }) => {
  test.setTimeout(300_000);
  for (const tab of await tabs(request)) {
    for (const size of PHONES) {
      const { context, page } = await phone(browser, size);
      expect(await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches)).toBe(true);
      await walk(page, tab, size);
      await context.close();
    }
  }
});

test("M8-37b 电脑 1280 布局不变：地址框整行上下排、日期时间并排、右侧栏地名折行显示全；平板 800 摘要条照旧一行", async ({ page, request }) => {
  test.setTimeout(180_000);
  const [transfer] = await tabs(request);
  if (transfer === undefined) throw new Error("没有准备好区间的链接");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${SITE}/book/new?${transfer.link}`);
  await page.getByRole("button", { name: /^第 1 步/ }).click();
  const from = await box(page.getByRole("combobox", { name: "出发地" }), "出发地");
  const to = await box(page.getByRole("combobox", { name: "目的地" }), "目的地");
  const date = await box(page.getByLabel("日期（当地）"), "日期");
  const time = await box(page.getByLabel("航班落地时间（当地）"), "时间");
  expect(to.y, "目的地在出发地下面").toBeGreaterThan(from.y + from.height);
  expect(Math.abs(to.width - from.width), "两个地址框一样宽").toBeLessThanOrEqual(1);
  expect(Math.abs(date.y - time.y), "日期、时间并排").toBeLessThanOrEqual(1);
  expect(from.width, "地址框占左栏整行（日期、时间两格之和）").toBeGreaterThan(date.width + time.width);
  await expect(page.locator(".book-summary-bar")).toHaveCount(0);
  const aside = page.getByRole("complementary", { name: "行程摘要" });
  await page.getByRole("button", { name: "下一步：选择车型" }).click();
  await expect(aside).toContainText(LONG_FROM);
  await expect(aside).toContainText(LONG_TO);
  const place = aside.locator("dd", { hasText: LONG_FROM });
  const lines = await place.evaluate((node) => node.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(node).lineHeight));
  expect(lines, "右侧栏的长地名折行显示全").toBeGreaterThan(1.5);
  await expectNoOverflow(page, "1280px 第 2 步");
  await expectBothThemes(page, "1280px 第 2 步");

  // 平板（768–1023）：摘要条照旧一行（两端平分剩余宽度，M6-08）
  await page.setViewportSize({ width: 800, height: 900 });
  const ends = await page.locator(".book-summary-bar__text").evaluate((node) => ({ height: node.getBoundingClientRect().height, lineHeight: Number.parseFloat(getComputedStyle(node).lineHeight) }));
  expect(ends.height, "800px 摘要条地点只占一行").toBeLessThan(ends.lineHeight * 1.5);
  await expectNoOverflow(page, "800px 第 2 步");
});
