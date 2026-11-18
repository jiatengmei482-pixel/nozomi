/**
 * 端到端：多日行程报价页 `/book/trip`（M9T-09 第一部分，ADR 0101 第十三节）。真实浏览器 → 前端 → 真实 API（`/site/v1/trips…`）→ 真实 PostgreSQL，不 mock 接口。
 *
 * 准备：charter-support.ts 的包车城市（商品区域 + 加价区域、8 小时套餐、加价区域里一个车站），本用例在商品区域中心再建一个车站当起终点。
 * 客人按天填：第 1 天 10:00 从中心车站出发 → 加价区域的车站停 60 分钟 → 回中心车站；点「查看报价」：
 * - 建行程单的请求体是标准行程单（start / stop / end、只有坐标、停留 60 分钟、没有地名），之后报价一次，网址变成 `?trip=<编号>&step=2`；
 * - 结果骨架：**报价结果按这个测试世界实际报出的为准**（单日行程只出「同一辆车跑完全程」；编排器报不出时是「报不出的方案」或「需要客服人工报价」），
 *   这里只断言结构：报出的方案有名称和 `数字 JPY` 合计；报不出的每条有方案名和原因；两者至少有一样。具体金额、拆法由 API 的固定测试集（M9T-04）覆盖。
 * - 刷新：只读行程单（GET），不再报价，结果一样；地名从本标签页取回。
 * 电脑 1280：右侧栏「每天的路线」有第 1 天的地图和按编号的 3 个地名；手机 390：没有右侧栏，「查看报价」「上一步」在底部按钮条，不横向滚动。亮暗两色 axe。
 * 用官网那组 API 和前端（信任一层代理），浏览器带一个随机的文档专用来源地址：行程报价按来源地址限频（每分钟 5 次），不占别的官网用例的额度。
 */
import { type Page, type Request, expect, test } from "@playwright/test";
import { E2E_WEB_STRIPE_PORT } from "../playwright.config.ts";
import { tomorrowInTokyo } from "./book-new-support.ts";
import { expectAccessible } from "./catalog.ts";
import { type CharterWorld, type Point, charterWorld } from "./charter-support.ts";
import { platformAdminHeaders, randomLetters } from "./support.ts";

const SITE = `http://127.0.0.1:${E2E_WEB_STRIPE_PORT}`;

async function expectBothThemes(page: Page, what: string): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `${what}（${scheme === "light" ? "亮色" : "暗色"}）`);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

async function screenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: test.info().outputPath(`m9t09-${name}.png`), fullPage: true });
}

/** 本用例的世界：包车城市 + 商品区域中心的车站（起终点） */
async function tripWorld(request: Parameters<typeof charterWorld>[0]): Promise<{ world: CharterWorld; home: { name: string; location: Point } }> {
  const world = await charterWorld(request);
  const admin = await platformAdminHeaders(request);
  const home = { name: `行程起点${randomLetters(4)}`, location: world.center };
  const made = await request.post("/platform/v1/master/places", { headers: admin, data: { type: "station", code: `STN-JP-${randomLetters(6)}`, city_id: world.cityId, category: "rail", name: { zh: home.name }, location: home.location } });
  expect(made.status(), await made.text()).toBe(201);
  return { world, home };
}

async function pick(page: Page, label: string, name: string): Promise<void> {
  const box = page.getByRole("combobox", { name: label, exact: true });
  await box.fill(name);
  await page.getByRole("listbox", { name: `${label}的候选` }).getByRole("option", { name: new RegExp(name) }).click();
  await expect(box).toHaveValue(name);
}

/** 填第 1 天：明天 10:00，起点车站 → 加价区域的车站（停 60 分钟）→ 起点车站 */
async function fillDay(page: Page, world: CharterWorld, home: { name: string }): Promise<void> {
  await page.getByLabel("日期（当地）").fill(tomorrowInTokyo());
  await page.getByLabel(/第 1 天 上车时间/).fill("10:00");
  await pick(page, "第 1 天 上车地点", home.name);
  await page.getByRole("button", { name: "加一个地点" }).click();
  await pick(page, "第 1 天 第 2 个地点", world.station.name);
  await page.getByLabel(/第 1 天 第 2 个地点 停留时长/).selectOption("60");
  await pick(page, "第 1 天 最后下车地点", home.name);
}

/** 第 2 步的结果骨架：报出的方案和报不出的原因至少有一样，各自有名称和金额 / 原因 */
async function expectResultStructure(page: Page): Promise<void> {
  const result = page.locator('[data-trip-result="skeleton"]');
  const manual = page.getByRole("heading", { name: "这个行程需要客服人工报价" });
  await expect(result.or(manual).first()).toBeVisible({ timeout: 60_000 });
  const plans = page.getByRole("list", { name: "报价结果" }).getByRole("listitem");
  const unquoted = page.getByRole("region", { name: "报不出的方案" }).getByRole("listitem");
  const planCount = await plans.count();
  const unquotedCount = await unquoted.count();
  expect(planCount + unquotedCount + (await manual.count()), "报出的方案、报不出的原因、转人工至少有一样").toBeGreaterThan(0);
  for (let index = 0; index < planCount; index += 1) {
    const plan = plans.nth(index);
    await expect(plan.getByRole("heading")).toHaveText(/^(同一辆车跑完全程|每天选最划算的车)$/);
    await expect(plan.locator(".trip-plan__amount")).toHaveText(/^\d{1,3}(,\d{3})* JPY$/);
  }
  for (let index = 0; index < unquotedCount; index += 1) await expect(unquoted.nth(index)).toHaveText(/^(同一辆车跑完全程|每天选最划算的车)(（第 \d+ 天）)?：这个方案暂时报不出：.+$/);
}

function trackTrips(page: Page): { creates: Request[]; quotes: Request[]; reads: Request[] } {
  const seen = { creates: [] as Request[], quotes: [] as Request[], reads: [] as Request[] };
  page.on("request", (sent) => {
    const path = new URL(sent.url()).pathname;
    if (sent.method() === "POST" && path === "/site/v1/trips") seen.creates.push(sent);
    else if (sent.method() === "POST" && /^\/site\/v1\/trips\/[\w-]{43}\/quote$/.test(path)) seen.quotes.push(sent);
    else if (sent.method() === "GET" && /^\/site\/v1\/trips\/[\w-]{43}$/.test(path)) seen.reads.push(sent);
  });
  return seen;
}

function expectTripBody(body: Record<string, unknown>, world: CharterWorld, home: { location: Point }): void {
  expect(body).toMatchObject({ schemaVersion: 1, party: { adults: 2, children: 0, luggage: 2 } });
  const days = body["days"] as { date: string; items: Record<string, unknown>[] }[];
  expect(days).toHaveLength(1);
  expect(days[0]?.date).toBe(tomorrowInTokyo());
  expect(days[0]?.items).toEqual([
    { kind: "start", place: { lat: home.location.lat, lng: home.location.lng }, time: "10:00" },
    { kind: "stop", place: { lat: world.station.location.lat, lng: world.station.location.lng }, stayMinutes: 60 },
    { kind: "end", place: { lat: home.location.lat, lng: home.location.lng } },
  ]);
  expect(JSON.stringify(body)).not.toContain(world.station.name);
}

test("行程报价页（电脑 1280）：按天填写 → 建行程单（标准行程单）→ 报价 → 第 2 步结果骨架和右侧栏每天的路线 → 刷新只读不报价；亮暗 axe", async ({ page, request }) => {
  test.setTimeout(180_000);
  const { world, home } = await tripWorld(request);
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `192.0.2.${1 + Math.floor(Math.random() * 250)}` });
  const seen = trackTrips(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${SITE}/book/trip`);
  await expect(page.getByRole("heading", { name: "多日行程报价", level: 1 })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "每天的路线" })).toContainText("选好地点后在这里显示每天的路线");
  // 先点一次：问题写在字段下面，不发请求
  await page.getByRole("button", { name: "查看报价" }).click();
  await expect(page.getByText("请选择上车地点", { exact: true })).toBeVisible();
  expect(seen.creates).toHaveLength(0);
  await fillDay(page, world, home);
  const aside = page.getByRole("complementary", { name: "每天的路线" });
  await expect(aside.getByRole("figure", { name: "第 1 天路线图" }).getByRole("listitem")).toHaveText([`1${home.name}`, `2${world.station.name}`, `3${home.name}`]);
  await expectBothThemes(page, "行程报价第 1 步（1280）");
  await screenshot(page, "step1-1280");

  await page.getByRole("button", { name: "查看报价" }).click();
  await expect(page.getByRole("heading", { name: "报价结果", level: 2 })).toBeVisible();
  await expect(page).toHaveURL(/\/book\/trip\?trip=[\w-]{43}&step=2$/);
  expect(seen.creates).toHaveLength(1);
  expectTripBody(seen.creates[0]?.postDataJSON() as Record<string, unknown>, world, home);
  await expectResultStructure(page);
  expect(seen.quotes).toHaveLength(1);
  expect(seen.reads, "刚建好的行程单不再读一次").toHaveLength(0);
  await expect(aside.getByRole("figure", { name: "第 1 天路线图" }).getByRole("listitem")).toHaveText([`1${home.name}`, `2${world.station.name}`, `3${home.name}`]);
  const shown = await page.locator('[data-trip-result="skeleton"]').or(page.getByRole("heading", { name: "这个行程需要客服人工报价" })).first().innerText();
  await expectBothThemes(page, "行程报价第 2 步（1280）");
  await screenshot(page, "step2-1280");

  // 刷新：只读行程单，不重新报价；地名从本标签页取回
  await page.reload();
  await expectResultStructure(page);
  expect(seen.reads).toHaveLength(1);
  expect(seen.quotes, "刷新不重新报价").toHaveLength(1);
  expect(await page.locator('[data-trip-result="skeleton"]').or(page.getByRole("heading", { name: "这个行程需要客服人工报价" })).first().innerText()).toBe(shown);
  await expect(aside.getByRole("figure", { name: "第 1 天路线图" }).getByRole("listitem")).toHaveText([`1${home.name}`, `2${world.station.name}`, `3${home.name}`]);
  // 上一步：表单用读回来的行程单填上
  await page.getByRole("button", { name: "上一步" }).click();
  await expect(page.getByRole("combobox", { name: "第 1 天 第 2 个地点", exact: true })).toHaveValue(world.station.name);
});

test("行程报价页（手机 390）：路线图在当天的块里，「查看报价」「上一步」在底部按钮条；不横向滚动；亮暗 axe", async ({ page, request }) => {
  test.setTimeout(180_000);
  const { world, home } = await tripWorld(request);
  await page.setExtraHTTPHeaders({ "x-forwarded-for": `192.0.2.${1 + Math.floor(Math.random() * 250)}` });
  const seen = trackTrips(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${SITE}/book/trip`);
  await expect(page.getByRole("heading", { name: "多日行程报价", level: 1 })).toBeVisible();
  await expect(page.getByRole("complementary", { name: "每天的路线" })).toHaveCount(0);
  await fillDay(page, world, home);
  const day = page.getByRole("region", { name: "第 1 天", exact: true });
  await expect(day.getByRole("figure", { name: "第 1 天路线图" }).getByRole("listitem")).toHaveCount(3);
  const bar = page.getByRole("group", { name: "本步操作" });
  await expect(bar.getByRole("button", { name: "查看报价" })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "390px 第 1 步横向溢出").toBe(0);
  await expectBothThemes(page, "行程报价第 1 步（390）");
  await screenshot(page, "step1-390");

  await bar.getByRole("button", { name: "查看报价" }).click();
  await expect(page).toHaveURL(/\/book\/trip\?trip=[\w-]{43}&step=2$/);
  expectTripBody(seen.creates[0]?.postDataJSON() as Record<string, unknown>, world, home);
  await expectResultStructure(page);
  await expect(page.getByRole("group", { name: "本步操作" }).getByRole("button", { name: "上一步" })).toBeVisible();
  await expect(page.getByRole("region", { name: "每天的行程" }).getByRole("figure", { name: "第 1 天路线图" })).toBeVisible();
  const overflow2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow2, "390px 第 2 步横向溢出").toBe(0);
  await expectBothThemes(page, "行程报价第 2 步（390）");
  await screenshot(page, "step2-390");
});
