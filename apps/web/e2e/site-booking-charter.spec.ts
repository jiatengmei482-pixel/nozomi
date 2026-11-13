/**
 * 端到端：新预订页 `/book/new` 的包车下车地点和区域加价（M8-19；规范 site-booking-v2.md 10.1、10.2、10.4；ADR 0073）。
 * 真实浏览器 → 前端 → 真实 API（`/site/v1`）→ 真实 PostgreSQL，不 mock 接口。
 *
 * 包车的城市、区域、商品见 charter-support.ts（8 小时套餐对外 77,000，加价区域上车加 500、下车加 1,000，加价区域里有一个车站，下车地点框里能搜到）。客人：
 * - 旧链接只有上车地点：下车地点空着、框下面提示补选，不报价（没有包车询价请求）；手机上点「下一步：选择车型」下车地点标红、焦点移过去；
 * - 下车地点在商品区域：77,000，不写「含区域加价」；
 * - 下车地点在框里搜车站（加价区域）：78,100（71,000 × 1.1）——只有这一个价，车型卡和车费下面写「含区域加价，已算在这个价格里」，不写加价金额；
 * - 下车地点不在任何区域：「这个地址暂时没有在线报价，请联系客服」+ 客服电话；
 * - 下单：订单带下车地址，订单页「行程」有下车地点。
 * 320 / 360 / 390 宽不横向滚动，亮暗两色 axe；电脑 1280、手机 390 亮暗各存一张截图。
 * 用官网付款那组 API 和前端（信任一层代理），浏览器带一个本用例的文档专用来源地址：官网按来源地址限速，
 * 不能占主 API 那些用例在 127.0.0.1 上的额度（不然并行的官网用例会被「操作太频繁」挡住）。订单页的 Stripe.js 换成假 Stripe。
 */
import { type Page, expect, test } from "@playwright/test";
import { E2E_WEB_STRIPE_PORT } from "../playwright.config.ts";
import { tomorrowInTokyo } from "./book-new-support.ts";
import { expectAccessible } from "./catalog.ts";
import { charterWorld, linkPoint } from "./charter-support.ts";
import { routeStripe } from "./fake-stripe.ts";

const SITE = `http://127.0.0.1:${E2E_WEB_STRIPE_PORT}`;

const SUPPORT_PHONE = "+81 3-0000-0000";
const NOTE = "含区域加价，已算在这个价格里";
const MANUAL = "这个地址暂时没有在线报价，请联系客服";

/** 320 / 360 / 390 宽不横向滚动，亮暗两色 axe（量完回到原来的宽度和亮色）。 */
async function expectNarrowAndAccessible(page: Page, what: string): Promise<void> {
  const viewport = page.viewportSize() ?? { width: 390, height: 844 };
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 800 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${what}：${width}px 宽横向溢出`).toBe(0);
  }
  await page.setViewportSize(viewport);
  await expectBothThemes(page, what);
}

async function expectBothThemes(page: Page, what: string): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `${what}（${scheme === "light" ? "亮色" : "暗色"}）`);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

/** 很长的上车地点名：手机第 2 步顶部的行程条里要单行省略（规范 10.1，M6-08） */
const LONG_PICKUP = "京王广场酒店本馆南口出租车乘车处（新宿区西新宿二丁目 2-1）";

/**
 * 手机第 2 步顶部的行程条（规范 10.1，M6-08）：390、320 宽地点那一行都只占一行；上车地点名被省略（不折行），
 * 「包车 8 小时」完整可见；价格在标题那一行完整可见；完整的地点名在按钮的读屏名里。
 */
async function expectSummaryBarOneLine(page: Page, placeName: string): Promise<void> {
  const viewport = page.viewportSize() ?? { width: 390, height: 844 };
  const toggle = page.getByRole("button", { name: /^行程摘要/ });
  await expect(toggle).toHaveAccessibleName(new RegExp(placeName.replace(/[()（）]/g, ".")));
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const text = page.locator(".book-summary-bar__text");
    await expect(page.locator(".book-summary-bar__price")).toHaveText("78,100 JPY");
    const metrics = await text.evaluate((node) => {
      const inside = (outer: DOMRect, inner: DOMRect): boolean => inner.left >= outer.left - 0.5 && inner.right <= outer.right + 0.5;
      const box = node.getBoundingClientRect();
      const lineHeight = Number.parseFloat(getComputedStyle(node).lineHeight);
      const place = node.querySelector(".book-summary-bar__place") as HTMLElement;
      const fixed = [...node.querySelectorAll(".book-summary-bar__fixed")].map((item) => item.getBoundingClientRect());
      const toggleBox = (node.closest("button") as HTMLElement).getBoundingClientRect();
      const price = (document.querySelector(".book-summary-bar__price") as HTMLElement).getBoundingClientRect();
      return { height: box.height, lineHeight, placeClipped: place.scrollWidth > place.clientWidth, fixedInside: fixed.every((item) => inside(box, item)), priceInside: inside(toggleBox, price) };
    });
    expect(metrics.height, `${width}px 地点那一行只占一行`).toBeLessThan(metrics.lineHeight * 1.5);
    expect(metrics.placeClipped, `${width}px 上车地点名单行省略`).toBe(true);
    expect(metrics.fixedInside, `${width}px 行程类型完整可见`).toBe(true);
    expect(metrics.priceInside, `${width}px 价格完整可见`).toBe(true);
  }
  await page.setViewportSize(viewport);
}

async function screenshots(page: Page, name: string): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.screenshot({ path: test.info().outputPath(`m819-${name}-${scheme}.png`), fullPage: true });
  }
  await page.emulateMedia({ colorScheme: "light" });
}

test("新预订页包车：下车地点必填（旧链接只有上车地点时提示补选、不报价，手机标红并移焦点）→ 商品区域里 77,000 → 搜车站选加价区域的下车地点 78,100 含区域加价（不写金额）→ 不在任何区域转人工 → 下单，订单页有下车地点；窄屏、亮暗 axe", async ({ page, request }) => {
  test.setTimeout(180_000);
  const trip = await charterWorld(request);
  const date = tomorrowInTokyo();
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `192.0.2.${1 + Math.floor(Math.random() * 250)}` });
  const fakeStripe = process.env["E2E_FAKE_STRIPE_URL"];
  if (!fakeStripe) throw new Error("global-setup 没有启动假 Stripe");
  await routeStripe(page, fakeStripe);
  const charterQuotes: Record<string, unknown>[] = [];
  page.on("request", (sent) => {
    if (sent.method() === "POST" && new URL(sent.url()).pathname === "/site/v1/quotes") charterQuotes.push(sent.postDataJSON() as Record<string, unknown>);
  });

  // 手机 390：旧包车链接只有上车地点
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${SITE}/book/new?mode=charter&${linkPoint("from", trip.pickup, LONG_PICKUP)}&date=${date}&time=10:00`);
  const pickup = page.getByRole("combobox", { name: "上车地点" });
  const dropoff = page.getByRole("combobox", { name: "下车地点" });
  await expect(pickup).toHaveValue(LONG_PICKUP);
  await expect(dropoff).toHaveValue("");
  await expect(page.getByText("请选择下车地点，包车现在按上车和下车地点报价。")).toBeVisible();
  await expect(page.getByText("包车结束时在哪里下车，价格按上车和下车地点算。")).toBeVisible();
  await expect(page.getByLabel(/^包车时长/)).toHaveValue("8");
  await page.getByRole("button", { name: "下一步：选择车型" }).click();
  await expect(page.getByText("请选择下车地点", { exact: true })).toBeVisible();
  await expect(dropoff).toHaveAttribute("aria-invalid", "true");
  await expect(dropoff).toBeFocused();
  expect(charterQuotes, "没选下车地点不报价").toEqual([]);
  await expectNarrowAndAccessible(page, "新预订页包车第 1 步（下车地点标红）");
  await screenshots(page, "mobile-step1");

  // 下车地点在框里搜（平台的车站，在加价区域里）：报价带 dropoff，只有一个价，含区域加价
  await dropoff.fill(trip.station.name);
  await page.getByRole("listbox", { name: "下车地点的候选" }).getByRole("option", { name: new RegExp(trip.station.name) }).click();
  await expect(dropoff).toHaveValue(trip.station.name);
  await expect(page.getByText("请选择下车地点，包车现在按上车和下车地点报价。")).toHaveCount(0);
  await page.getByRole("button", { name: "下一步：选择车型" }).click();
  await expect(page.getByRole("heading", { name: "选择车型" })).toBeFocused();
  await expect(page.locator(".book-summary-bar__text")).toContainText(`包车 8 小时 · ${LONG_PICKUP} → ${trip.station.name}`);
  const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: trip.groupName }) });
  await expect(card).toContainText("78,100 JPY");
  await expect(card).toContainText(NOTE);
  expect(charterQuotes.at(-1)).toMatchObject({ category: "charter", pickup: trip.pickup, dropoff: trip.station.location, package_hours: 8, service_local: `${date}T10:00` });
  await card.getByRole("button", { name: `选择 ${trip.groupName}` }).click();
  await expectSummaryBarOneLine(page, LONG_PICKUP);
  await expectNarrowAndAccessible(page, "新预订页包车第 2 步（含区域加价）");
  await screenshots(page, "mobile-step2");
  await page.locator(".book-bar").getByRole("button", { name: "下一步" }).click();
  // 第 3 步：顶部摘要条展开，车型和价格下面含区域加价
  await expect(page.getByRole("heading", { level: 2, name: "乘客信息" })).toBeFocused();
  await page.getByRole("button", { name: /^行程摘要/ }).click();
  const summary = page.locator("#book-summary-panel");
  await expect(summary).toContainText(NOTE);
  await expect(summary).toContainText(`下车地点${trip.station.name}`);
  await expect(page.locator("main")).not.toContainText(/1,000 JPY|1,100 JPY|500 JPY|550 JPY|71,000|77,000/);
  await expectNarrowAndAccessible(page, "新预订页包车第 3 步（摘要条：含区域加价）");

  // 电脑 1280：下车地点在商品区域里 → 77,000，不写含区域加价
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${SITE}/book/new?mode=charter&${linkPoint("from", trip.pickup, "上车酒店")}&${linkPoint("to", trip.nearby, "市内下车点")}&date=${date}&time=10:00`);
  const plain = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: trip.groupName }) });
  await expect(plain).toContainText("77,000 JPY");
  await expect(page.locator("main")).not.toContainText("含区域加价");

  // 下车地点不在任何区域：转人工的说法 + 客服电话
  await page.goto(`${SITE}/book/new?mode=charter&${linkPoint("from", trip.pickup, "上车酒店")}&${linkPoint("to", trip.nowhere, "很远的地方")}&date=${date}&time=10:00`);
  await expect(page.getByRole("heading", { name: "没有可预订的车" })).toBeVisible();
  await expect(page.locator(".book-new__rejected")).toContainText(MANUAL);
  await expect(page.getByRole("link", { name: SUPPORT_PHONE })).toHaveAttribute("href", "tel:+81300000000");
  await expect(page.locator("main")).not.toContainText("OUT_OF_SERVICE_AREA");
  await expectBothThemes(page, "新预订页包车电脑（转人工）");

  // 加价区域的下车地点（链接带 to）→ 选车 → 右侧栏车费下面含区域加价 → 下单
  await page.goto(`${SITE}/book/new?mode=charter&${linkPoint("from", trip.pickup, "上车酒店")}&${linkPoint("to", trip.station.location, trip.station.name)}&date=${date}&time=10:00`);
  const surcharged = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: trip.groupName }) });
  await expect(surcharged).toContainText("78,100 JPY");
  await surcharged.getByRole("button", { name: `选择 ${trip.groupName}` }).click();
  const aside = page.getByRole("complementary", { name: "行程摘要" });
  await expect(aside).toContainText(NOTE);
  await expect(aside).toContainText("包车 8 小时");
  await expect(aside).toContainText(`下车地点${trip.station.name}`);
  await expectBothThemes(page, "新预订页包车电脑（含区域加价）");
  await screenshots(page, "desktop");

  await page.getByRole("button", { name: "下一步：填写乘客信息" }).click();
  await page.getByLabel("乘车人姓名").fill("陈小红");
  await page.getByLabel("邮箱").fill(`charter-${crypto.randomUUID().slice(0, 8)}@e2e.example.com`);
  await page.getByLabel("手机号（含国家区号）").fill("+81 90-2222-3333");
  await page.getByRole("button", { name: "下一步：核对订单" }).click();
  await expect(page.getByRole("region", { name: "核对订单" })).toContainText(NOTE);
  await page.getByRole("checkbox", { name: /同意保存/ }).check();
  const placed = page.waitForResponse((response) => new URL(response.url()).pathname === "/site/v1/orders" && response.request().method() === "POST");
  await page.getByRole("button", { name: "去付款 →" }).click();
  const order = await placed;
  expect(order.status(), await order.text()).toBe(201);
  expect(order.request().postDataJSON()).toMatchObject({ pickup_address: "上车酒店", dropoff_address: trip.station.name });
  await expect(page.getByRole("heading", { level: 1, name: /^订单 NZ/ })).toBeVisible();
  const tripSection = page.getByRole("region", { name: "行程" });
  await expect(tripSection.locator("dt", { hasText: "下车地点" })).toBeVisible();
  await expect(tripSection).toContainText("上车酒店");
  await expect(tripSection).toContainText(trip.station.name);
  await expect(page.getByText("78,100 JPY").first()).toBeVisible();
  await expectBothThemes(page, "订单页（包车有下车地点）");
});
