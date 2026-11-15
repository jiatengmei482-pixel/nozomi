/**
 * 端到端（M9P-04，规格 docs/requirements/charter-pricing-spec-2026-11-14.md，ADR 0091、0093）：
 * 真实浏览器 → 前端 → 真实 API → 真实 PostgreSQL，不改应答。城市、区域、包车商品见 charter-support.ts（本用例自己建，用完随测试库清掉），
 * 商品另上架 4 小时（40,000，含 80 公里）、5 小时（45,000，含 150 公里）两档，加价区域设途经加价 8,000；
 * 服务规则填经停点默认占用 15 分钟、整单缓冲 60 分钟（业主建议值）。这个 API 没配谷歌路线，各段路线预先写进路线缓存，用例结束删掉。
 *
 * 1. 规格用例 1、10 的页面部分：
 *    - 经停点在基础价区域（用例 1 那样）：各段 6.8 公里、18 分钟，停留 30 分钟 → 预计用时 36 + 30 + 15 + 60 = 2 小时 21 分钟（含缓冲），自动 4 小时；
 *      明细只有套餐一行，下面写预计用时；下拉「自动（4 小时）」、能升 5 / 8 小时；
 *    - 经停点换成加价区域里的车站（用例 10 那样）：各段 50 公里、60 分钟 → 预计用时 120 + 30 + 75 = 3 小时 45 分钟，4 小时够时长但只含 80 公里
 *      （40,000 + 20 公里 × 400 = 48,000），5 小时 45,000 更便宜 → 自动 5 小时；明细「行程加价（加价区域，2 · 经停）」；下拉没有 4、5 小时。
 * 2. 不填经停点也逐项列明细（P0 验收后续 A）+ 规格用例 16 / 19 的页面部分：下车点在加价区域 → 套餐、下车加价、行程加价（下车点）；
 *    供应商在服务规则页关掉「下车点行程加价」（同时核对三个输入框：建议值灰字、不预填）→ 再询价只剩套餐、下车加价。
 * 每一步亮暗两色 axe 0；手机 390 宽不横向滚动、截图。
 */
import { type Locator, type Page, expect, test } from "@playwright/test";
import { type LatLng, routeCacheKey } from "@nozomi/domain";
import { withPlatformTx } from "../../api/src/db/context.ts";
import { createPool } from "../../api/src/db/pool.ts";
import { E2E_WEB_STRIPE_PORT } from "../playwright.config.ts";
import { tomorrowInTokyo } from "./book-new-support.ts";
import { expectAccessible } from "./catalog.ts";
import { type Point, charterWorld, linkPoint } from "./charter-support.ts";
import { loginAs, platformAdminHeaders, randomLetters, settleAnimations } from "./support.ts";

const SITE = `http://127.0.0.1:${E2E_WEB_STRIPE_PORT}`;
const PACKAGES = [
  { hours: 4, price: 40_000, km: 80 },
  { hours: 5, price: 45_000, km: 150 },
];
const ITINERARY = { stop_occupancy_minutes: 15, buffer_minutes: 60 };

async function asPlatform<T>(run: (query: (text: string, values: unknown[]) => Promise<unknown>) => Promise<T>): Promise<T> {
  const url = process.env["E2E_DATABASE_URL"];
  if (!url) throw new Error("global-setup 没有交出本次运行的数据库连接串");
  const pool = createPool(url, { max: 1 });
  try {
    return await withPlatformTx(pool, (tx) => run((text, values) => tx.query(text, values)));
  } finally {
    await pool.end();
  }
}

/** 本文件写进路线缓存的键（结束时删掉） */
const seeded: string[] = [];
test.afterAll(async () => {
  if (seeded.length > 0) await asPlatform((query) => query("delete from route_estimates where cache_key = any($1::text[])", [seeded]));
});
async function seedLeg(from: LatLng, to: LatLng, meters: number, seconds: number): Promise<void> {
  const key = routeCacheKey(from, to);
  seeded.push(key.key);
  await asPlatform((query) =>
    query("insert into route_estimates (cache_key, distance_meters, duration_seconds, fetched_at, expires_at) values ($1, $2, $3, now(), now() + interval '7 days') on conflict (cache_key) do update set failure_code = null, distance_meters = $2, duration_seconds = $3, expires_at = excluded.expires_at", [key.key, meters, seconds]),
  );
}

async function expectBothThemes(page: Page, what: string): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `${what}（${scheme === "light" ? "亮色" : "暗色"}）`);
    await page.screenshot({ path: test.info().outputPath(`m9p-04-${what}-1280-${scheme}.png`), fullPage: true });
  }
  await page.emulateMedia({ colorScheme: "light" });
}

/** 手机 390 宽：不横向滚动，亮暗各截一张（量完回到原来的宽度） */
async function at390(page: Page, what: string): Promise<void> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 900 };
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${what}：390px 宽横向溢出`).toBe(0);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.screenshot({ path: test.info().outputPath(`m9p-04-${what}-390-${scheme}.png`), fullPage: true });
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize(viewport);
}

/** 手机 390 宽下某一块的截图（亮暗各一张），给 PR 和验收看 */
async function blockAt390(page: Page, block: Locator, what: string): Promise<void> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 900 };
  await page.setViewportSize({ width: 390, height: 844 });
  await block.scrollIntoViewIfNeeded();
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await settleAnimations(page);
    await block.screenshot({ path: test.info().outputPath(`m9p-04-${what}-390-${scheme}-块.png`) });
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize(viewport);
}

async function station(request: Parameters<typeof charterWorld>[0], cityId: string, name: string, at: Point): Promise<void> {
  const admin = await platformAdminHeaders(request);
  const made = await request.post("/platform/v1/master/places", { headers: admin, data: { type: "station", code: `STN-JP-${randomLetters(6)}`, city_id: cityId, category: "rail", name: { zh: name }, location: at } });
  expect(made.status(), await made.text()).toBe(201);
}

test("规格用例 1、10 的页面部分：明细套餐下面写预计用时（含缓冲）；行程加价写区域名和第几个经停点；套餐下拉「自动（N 小时）」按车型、只列更长的", async ({ page, request }) => {
  test.setTimeout(180_000);
  const trip = await charterWorld(request, { packages: PACKAGES, waypointSurcharge: 8_000, itinerary: ITINERARY });
  const cityStop = { name: `市内景点${randomLetters(4)}`, at: { lat: Number((trip.center.lat + 0.02).toFixed(6)), lng: Number((trip.center.lng - 0.01).toFixed(6)) } };
  await station(request, trip.cityId, cityStop.name, cityStop.at);
  await seedLeg(trip.pickup, cityStop.at, 6_800, 1_080);
  await seedLeg(cityStop.at, trip.nearby, 6_800, 1_080);
  await seedLeg(trip.pickup, trip.station.location, 50_000, 3_600);
  await seedLeg(trip.station.location, trip.nearby, 50_000, 3_600);
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `192.0.2.${1 + Math.floor(Math.random() * 250)}` });
  const bodies: Record<string, unknown>[] = [];
  await page.route(`${SITE}/site/v1/quotes`, async (route) => {
    bodies.push(route.request().postDataJSON() as Record<string, unknown>);
    return route.continue();
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${SITE}/book/new?mode=charter&${linkPoint("from", trip.pickup, "上车酒店")}&${linkPoint("to", trip.nearby, "市内下车点")}&date=${tomorrowInTokyo()}&time=10:00`);
  const add = page.getByRole("button", { name: "添加经停点" });
  await expect(add).toBeVisible();
  await add.click();
  const box = page.getByRole("combobox", { name: "经停点 1", exact: true });
  const pick = async (name: string): Promise<void> => {
    await box.fill(name);
    await page.getByRole("listbox", { name: "经停点 1的候选" }).getByRole("option", { name: new RegExp(name) }).click();
    await expect(box).toHaveValue(name);
  };
  await pick(cityStop.name);
  await page.getByLabel("经停点 1 停留时长").selectOption("30");

  // 用例 1：经停点在基础价区域，预计 2 小时 21 分钟（含缓冲），自动 4 小时
  const hours = page.getByLabel(/^包车时长/);
  await expect(hours.locator("option")).toHaveText(["自动（4 小时）", "5 小时", "8 小时"]);
  await expectBothThemes(page, "第 1 步（用例 1，自动 4 小时）");
  await page.getByRole("button", { name: "下一步：选择车型" }).click();
  const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: trip.groupName }) });
  const rows = card.getByLabel("价格明细").locator(".price-breakdown__row");
  await expect(rows).toHaveText(["包车套餐 4 小时预计用时 2 小时 21 分钟（含缓冲）44,000 JPY"]);
  expect(Object.keys(bodies.at(-1) ?? {}), "主站只改显示，请求体不变：自动选档不带 package_hours").not.toContain("package_hours");

  // 用例 10：经停点换成加价区域里的车站，全程 100 公里 → 自动 5 小时（不是 4 小时），行程加价逐项写区域名和第几个经停点
  await page.getByRole("button", { name: "上一步" }).click();
  await pick(trip.station.name);
  await expect(hours.locator("option")).toHaveText(["自动（5 小时）", "8 小时"]);
  await expect(hours.locator("option", { hasText: /^4 小时$/ })).toHaveCount(0);
  await page.getByRole("button", { name: "下一步：选择车型" }).click();
  await expect(rows).toHaveText(["包车套餐 5 小时预计用时 3 小时 45 分钟（含缓冲）49,500 JPY", `行程加价（${trip.surchargeAreaName}，2 · 经停）8,800 JPY`]);
  await card.getByRole("button", { name: `选择 ${trip.groupName}` }).click();
  const aside = page.getByRole("complementary", { name: "行程摘要" });
  await expect(aside.getByLabel("价格明细").locator(".price-breakdown__row")).toHaveText(["包车套餐 5 小时预计用时 3 小时 45 分钟（含缓冲）49,500 JPY", `行程加价（${trip.surchargeAreaName}，2 · 经停）8,800 JPY`, "合计58,300 JPY"]);
  // 规则 4：没有结算价（套餐 45,000、行程加价 8,000、合计 53,000）
  await expect(page.locator("main")).not.toContainText(/45,000|53,000|(?<![\d,])8,000 JPY/);
  await expectBothThemes(page, "第 2 步（用例 10，自动 5 小时）");
  await at390(page, "第 2 步（用例 10）");
  await blockAt390(page, card, "车型卡（用例 10）");
});

test("不填经停点也逐项列明细（用例 16）；供应商在服务规则页关掉「下车点行程加价」后只收下车加价（用例 19）；服务规则页三个输入框建议值灰字、不预填", async ({ page, browser, request }) => {
  test.setTimeout(240_000);
  const trip = await charterWorld(request, { waypointSurcharge: 8_000 });
  const siteContext = await browser.newContext();
  const site = await siteContext.newPage();
  await site.setExtraHTTPHeaders({ "x-forwarded-for": `192.0.2.${1 + Math.floor(Math.random() * 250)}` });
  await site.setViewportSize({ width: 1280, height: 900 });
  const link = `${SITE}/book/new?mode=charter&${linkPoint("from", trip.pickup, "上车酒店")}&${linkPoint("to", trip.station.location, trip.station.name)}&date=${tomorrowInTokyo()}&time=10:00`;
  const card = site.getByRole("listitem").filter({ has: site.getByRole("heading", { name: trip.groupName }) });
  const rows = card.getByLabel("价格明细").locator(".price-breakdown__row");

  // 用例 16：不填经停点，下车点在加价区域：套餐 + 下车加价 + 行程加价（下车点）
  await site.goto(link);
  await expect(rows).toHaveText(["包车套餐 8 小时77,000 JPY", `下车加价（${trip.surchargeAreaName}）1,100 JPY`, `行程加价（${trip.surchargeAreaName}，下车点）8,800 JPY`]);
  await expect(card).toContainText("86,900 JPY");
  // 规则 4：明细是对外价，页面上没有结算价（套餐 70,000、下车加价 1,000、行程加价 8,000、合计 79,000）
  await expect(site.locator("main")).not.toContainText(/70,000|79,000|(?<![\d,])1,000 JPY|(?<![\d,])8,000 JPY/);
  await expect(site.getByText(/价格按您填的经停点计算/)).toHaveCount(0);
  await expectBothThemes(site, "不填经停点的明细（用例 16）");
  await at390(site, "不填经停点的明细（用例 16）");
  await blockAt390(site, card, "车型卡（用例 16）");

  // 供应商：商品 → ② 服务规则
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAs(page, "tenant", trip.tenant.adminEmail, trip.tenant.password);
  await page.goto(`/products/${trip.productId}/service-rules`);
  const section = page.locator("section#itinerary");
  await expect(section.getByRole("heading", { name: "包车按行程计价" })).toBeVisible();
  const stop = section.getByLabel("经停点默认占用（分钟）");
  const buffer = section.getByLabel("整单缓冲（分钟）");
  const min = section.getByLabel("最低套餐（小时）");
  await expect(stop).toHaveValue("");
  await expect(buffer).toHaveValue("");
  await expect(min).toHaveValue("");
  await expect(stop).toHaveAttribute("placeholder", "建议 15");
  await expect(buffer).toHaveAttribute("placeholder", "建议 60");
  await expect(min).toHaveAttribute("placeholder", "不限");
  await expect(section).toContainText("建议 15 分钟");
  await expect(section).toContainText("建议 60 分钟，填 0 关闭");
  await expect(section).toContainText("可设为 5 小时");
  await expect(section).not.toContainText("在线下单上限");
  const toggle = section.getByRole("checkbox", { name: "收下车点行程加价" });
  await expect(toggle).toBeChecked();
  await expect(section).toContainText("没有市外经停时，下车点所在行程区域收一次行程加价。默认开。");
  await expectBothThemes(page, "服务规则页（包车按行程计价）");
  await at390(page, "服务规则页（包车按行程计价）");
  await blockAt390(page, section, "服务规则页（包车按行程计价）");

  // 键盘：Tab 到开关、空格关掉；再填建议值 15 / 60，保存
  await toggle.focus();
  await page.keyboard.press("Space");
  await expect(toggle).not.toBeChecked();
  await stop.fill("15");
  await buffer.fill("60");
  const saved = page.waitForResponse((response) => response.url().endsWith(`/products/${trip.productId}/service-rules`) && response.request().method() === "PUT");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const put = await saved;
  expect(put.status(), await put.text()).toBe(200);
  expect((put.request().postDataJSON() as { charter_itinerary: unknown }).charter_itinerary).toEqual({ dropoff_itinerary_surcharge: false, stop_occupancy_minutes: 15, buffer_minutes: 60, min_package_hours: null, warn_minutes: 720, warn_km: 360 });
  expect(((await put.json()) as { rules: { charter_itinerary: unknown } }).rules.charter_itinerary).toEqual({ dropoff_itinerary_surcharge: false, stop_occupancy_minutes: 15, buffer_minutes: 60, min_package_hours: null, max_online_minutes: 780, warn_minutes: 720, warn_km: 360 });

  // 用例 19：关掉以后只收下车加价。报价用的商品目录缓存 30 秒（ADR 0020「改规则后 1 分钟内生效」），所以重新打开链接直到按新规则报价
  await expect(async () => {
    await site.goto(link);
    await expect(rows).toHaveText(["包车套餐 8 小时77,000 JPY", `下车加价（${trip.surchargeAreaName}）1,100 JPY`], { timeout: 5_000 });
  }).toPass({ timeout: 70_000, intervals: [5_000] });
  await expect(card).toContainText("78,100 JPY");
  await siteContext.close();
});
