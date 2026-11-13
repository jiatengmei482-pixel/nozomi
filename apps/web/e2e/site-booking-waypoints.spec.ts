/**
 * 端到端：新预订页包车加经停点、按行程计价（M9W-02 / M9W-03，ADR 0088；需求 charter-waypoint-surcharge.md 13.5）。
 * 真实浏览器 → 前端 → 真实 API（`/site/v1`）→ 真实 PostgreSQL。城市、区域、包车商品见 charter-support.ts；本用例另在商品区域里建两个车站当经停点，
 * 第三个经停点是加价区域里的车站。
 *
 * **报价替身**（和 site-booking-new.spec.ts 改路线的做法一样，只改应答里约定的新字段）：本分支的后端（M9W-01 在另一个分支）还不收经停点，
 * 浏览器发出的按行程计价询价（`itinerary_pricing` + `waypoints`）由用例去掉这两项、带上 8 小时套餐转给真实后端，真实报价（报价编号、总价）原样用，
 * 只在应答上加约定的 `itinerary_route`（各段行驶分钟、行驶 / 停留合计、全程）和 `price_breakdown`（套餐 = 总价 − 途经 11,000，各项之和等于总价）；
 * 订单页的应答同样只加上 `waypoints` 和 `itinerary`（锁定的全程、时长，没有金额）。M9W-01 合进 main 后去掉替身，改成真实接口。
 *
 * 流程：电脑 1280 打开带上下车地点的包车链接（没有经停点：请求没有 itinerary_pricing）→ 回第 1 步加 3 个经停点（选地点、选停留）、
 * 一个上移排序 → 包车时长换成「按行程自动选套餐」→ 车型卡显示明细、行程时间表 → 选车，右侧栏明细 → 乘客信息 → 核对 → 去付款，
 * 订单页「经停点」按顺序有 3 个点。每一步亮暗两色 axe 0；手机 390 宽不横向滚动。
 */
import { type Page, type Route, expect, test } from "@playwright/test";
import { E2E_WEB_STRIPE_PORT } from "../playwright.config.ts";
import { tomorrowInTokyo } from "./book-new-support.ts";
import { expectAccessible } from "./catalog.ts";
import { type Point, charterWorld, linkPoint } from "./charter-support.ts";
import { routeStripe } from "./fake-stripe.ts";
import { platformAdminHeaders, randomLetters } from "./support.ts";

const SITE = `http://127.0.0.1:${E2E_WEB_STRIPE_PORT}`;
const WAYPOINT_SURCHARGE = 11_000;
const LEGS = [{ minutes: 25, meters: 12_000 }, { minutes: 30, meters: 15_000 }, { minutes: 20, meters: 9_000 }, { minutes: 35, meters: 18_000 }];

async function expectBothThemes(page: Page, what: string): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `${what}（${scheme === "light" ? "亮色" : "暗色"}）`);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

/** 存截图（亮色）到测试输出目录，人工核对用 */
async function screenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: test.info().outputPath(`m9w-${name}.png`), fullPage: true });
}

/** 手机 390 宽不横向滚动（量完回到原来的宽度） */
async function expectNoOverflowAt390(page: Page, what: string): Promise<void> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 900 };
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${what}：390px 宽横向溢出`).toBe(0);
  await screenshot(page, `${what}-390`);
  await page.setViewportSize(viewport);
}

type Money = { amount: string; currency: string };
const split = (total: Money) => [
  { kind: "base", amount: { amount: String(Number(total.amount) - WAYPOINT_SURCHARGE), currency: total.currency }, area_name: null, stop_seqs: null },
  { kind: "waypoint", amount: { amount: String(WAYPOINT_SURCHARGE), currency: total.currency }, area_name: { zh: "富士山地区" }, stop_seqs: [3] },
];

test("包车加 3 个经停点：增删排序、停留必填 → 按行程计价的请求 → 车型卡和右侧栏的明细（各项之和 = 总价）、行程时间表 → 下单 → 订单页有经停点；亮暗 axe、390 宽不横向滚动", async ({ page, request }) => {
  test.setTimeout(180_000);
  const trip = await charterWorld(request);
  const admin = await platformAdminHeaders(request);
  const tag = randomLetters(4);
  const station = async (name: string, at: Point): Promise<{ name: string; location: Point }> => {
    const made = await request.post("/platform/v1/master/places", { headers: admin, data: { type: "station", code: `STN-JP-${randomLetters(6)}`, city_id: trip.cityId, category: "rail", name: { zh: name }, location: at } });
    expect(made.status(), await made.text()).toBe(201);
    return { name, location: at };
  };
  const first = await station(`经停甲${tag}`, { lat: Number((trip.center.lat + 0.02).toFixed(6)), lng: Number((trip.center.lng - 0.01).toFixed(6)) });
  const second = await station(`经停乙${tag}`, { lat: Number((trip.center.lat - 0.015).toFixed(6)), lng: Number((trip.center.lng - 0.02).toFixed(6)) });
  const date = tomorrowInTokyo();
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `192.0.2.${1 + Math.floor(Math.random() * 250)}` });
  const fakeStripe = process.env["E2E_FAKE_STRIPE_URL"];
  if (!fakeStripe) throw new Error("global-setup 没有启动假 Stripe");
  await routeStripe(page, fakeStripe);

  const plainBodies: Record<string, unknown>[] = [];
  const itineraryBodies: Record<string, unknown>[] = [];
  await page.route(`${SITE}/site/v1/quotes`, async (route: Route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    if (body["itinerary_pricing"] !== true) {
      plainBodies.push(body);
      return route.continue();
    }
    itineraryBodies.push(body);
    const { itinerary_pricing: _pricing, waypoints: _stops, ...rest } = body;
    const response = await route.fetch({ postData: JSON.stringify({ ...rest, package_hours: 8 }) });
    const real = (await response.json()) as { quotes: { price: { total: Money } }[] };
    return route.fulfill({ response, json: { ...real, itinerary_route: { legs: LEGS, drive_minutes: 110, stay_minutes: 180, total_minutes: 290, total_meters: 54_000 }, quotes: real.quotes.map((quote) => ({ ...quote, price_breakdown: split(quote.price.total) })) } });
  });
  await page.route(`${SITE}/site/v1/order`, async (route: Route) => {
    if (route.request().method() !== "GET") return route.continue();
    const response = await route.fetch();
    const real = (await response.json()) as { order: Record<string, unknown> };
    const stops = itineraryBodies.at(-1)?.["waypoints"] ?? null;
    return route.fulfill({ response, json: { ...real, order: { ...real.order, waypoints: stops, itinerary: { route_meters: 54_000, route_minutes: 290, package_km: 150, package_minutes: 480, over_meters: 0, overtime_minutes: 0 } } } });
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${SITE}/book/new?mode=charter&${linkPoint("from", trip.pickup, "上车酒店")}&${linkPoint("to", trip.nearby, "市内下车点")}&date=${date}&time=10:00`);
  const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: trip.groupName }) });
  await expect(card).toContainText("77,000 JPY");
  expect(plainBodies.at(-1), "没有经停点：请求和以前一样").toMatchObject({ category: "charter", package_hours: 8 });
  expect(Object.keys(plainBodies.at(-1) ?? {})).not.toContain("itinerary_pricing");
  expect(Object.keys(plainBodies.at(-1) ?? {})).not.toContain("waypoints");
  await expect(page.getByLabel("价格明细")).toHaveCount(0);

  // 回到第 1 步加经停点：先加两个（乙、甲），再加加价区域里的车站；甲上移到第 1
  await page.getByRole("button", { name: "上一步" }).click();
  const add = page.getByRole("button", { name: "添加经停点" });
  const addStop = async (index: number, name: string, stay: string): Promise<void> => {
    await add.click();
    const box = page.getByRole("combobox", { name: `经停点 ${index}`, exact: true });
    await expect(box).toBeFocused();
    await box.fill(name);
    await page.getByRole("listbox", { name: `经停点 ${index}的候选` }).getByRole("option", { name: new RegExp(name) }).click();
    await expect(box).toHaveValue(name);
    if (stay !== "") await page.getByLabel(`经停点 ${index} 停留时长`).selectOption(stay);
  };
  await addStop(1, second.name, "60");
  await addStop(2, first.name, "");
  await expect(page.getByText("包车时长：按行程自动选套餐")).toBeVisible();
  await expect(page.getByLabel(/^包车时长/)).toHaveCount(0);
  await page.getByRole("button", { name: "下一步：选择车型" }).click();
  await expect(page.getByText("请选择停留时长", { exact: true })).toBeVisible();
  await expect(page.getByLabel("经停点 2 停留时长")).toHaveAttribute("aria-invalid", "true");
  expect(itineraryBodies, "停留时长没选不报价").toEqual([]);
  await page.getByLabel("经停点 2 停留时长").selectOption("90");
  await page.getByRole("button", { name: `把 ${first.name} 上移` }).click();
  await expect(page.getByRole("status").filter({ hasText: `${first.name} 现在排第 1，共 2 个` })).toBeAttached();
  await addStop(3, trip.station.name, "30");
  await expect(page.getByRole("combobox", { name: /^经停点 \d+$/ })).toHaveCount(3);
  await expectBothThemes(page, "新预订页包车第 1 步（3 个经停点）");
  await expectNoOverflowAt390(page, "新预订页包车第 1 步（3 个经停点）");

  await page.getByRole("button", { name: "下一步：选择车型" }).click();
  await expect(page.getByRole("heading", { name: "选择车型" })).toBeFocused();
  await expect(card).toContainText("77,000 JPY");
  expect(itineraryBodies.at(-1)).toMatchObject({
    category: "charter",
    itinerary_pricing: true,
    waypoints: [
      { name: first.name, ...first.location, stay_minutes: 90 },
      { name: second.name, ...second.location, stay_minutes: 60 },
      { name: trip.station.name, ...trip.station.location, stay_minutes: 30 },
    ],
  });
  expect(Object.keys(itineraryBodies.at(-1) ?? {})).not.toContain("package_hours");
  const rows = card.getByLabel("价格明细").locator(".price-breakdown__row");
  await expect(rows).toHaveText(["包车套餐 8 小时66,000 JPY", "经停加价（富士山地区，第 3 个经停点）11,000 JPY"]);
  // 行程时间表：行驶 25 + 30 + 20 + 35 = 110 分钟，停留 90 + 60 + 30 = 180 分钟，共 4 小时 50 分
  await expect(page.getByText("按行程预计 4 小时 50 分（行驶 1 小时 50 分 + 停留 3 小时），全程约 54 公里，套餐 8 小时").first()).toBeVisible();
  await expect(page.getByRole("list", { name: "行程" }).getByRole("listitem")).toHaveText([
    "上车上车酒店",
    `行驶约 25 分钟经停 1${first.name}停留 1 小时 30 分`,
    `行驶约 30 分钟经停 2${second.name}停留 1 小时`,
    `行驶约 20 分钟经停 3${trip.station.name}停留 30 分钟`,
    "行驶约 35 分钟下车市内下车点",
  ]);
  await expect(page.getByText("价格按您填的经停点计算；当天临时去其他区域或超出预计可能会加收。").first()).toBeVisible();
  await card.getByRole("button", { name: `选择 ${trip.groupName}` }).click();
  const aside = page.getByRole("complementary", { name: "行程摘要" });
  await expect(aside.getByLabel("价格明细").locator(".price-breakdown__row")).toHaveText(["包车套餐 8 小时66,000 JPY", "经停加价（富士山地区，第 3 个经停点）11,000 JPY", "合计77,000 JPY"]);
  await expect(aside).toContainText("包车 8 小时（按行程）");
  await expectBothThemes(page, "新预订页包车第 2 步（按行程计价的明细）");
  await expectNoOverflowAt390(page, "新预订页包车第 2 步（按行程计价的明细）");
  await screenshot(page, "第 2 步-1280");

  await page.getByRole("button", { name: "下一步：填写乘客信息" }).click();
  await page.getByLabel("乘车人姓名").fill("陈小红");
  await page.getByLabel("邮箱").fill(`waypoints-${crypto.randomUUID().slice(0, 8)}@e2e.example.com`);
  await page.getByLabel("手机号（含国家区号）").fill("+81 90-2222-3333");
  await page.getByRole("button", { name: "下一步：核对订单" }).click();
  const review = page.getByRole("region", { name: "核对订单" });
  await expect(review.getByLabel("价格明细")).toBeVisible();
  await expectBothThemes(page, "新预订页包车核对（按行程计价）");
  await page.getByRole("checkbox", { name: /同意保存/ }).check();
  const placed = page.waitForResponse((response) => new URL(response.url()).pathname === "/site/v1/orders" && response.request().method() === "POST");
  await page.getByRole("button", { name: "去付款 →" }).click();
  const order = await placed;
  expect(order.status(), await order.text()).toBe(201);

  await expect(page.getByRole("heading", { level: 1, name: /^订单 NZ/ })).toBeVisible();
  const tripSection = page.getByRole("region", { name: "行程" });
  await expect(tripSection.getByRole("list", { name: "包车行程" }).getByRole("listitem")).toHaveText([
    "上车上车酒店",
    `经停 1${first.name}停留 1 小时 30 分`,
    `经停 2${second.name}停留 1 小时`,
    `经停 3${trip.station.name}停留 30 分钟`,
    "下车市内下车点",
  ]);
  await expect(tripSection.getByText("全程约 54 公里，预计 4 小时 50 分（含停留）")).toBeVisible();
  await expect(page.getByText("77,000 JPY").first()).toBeVisible();
  await expectBothThemes(page, "订单页（包车有经停点）");
  await expectNoOverflowAt390(page, "订单页（包车有经停点）");
});
