/**
 * M1-12 测试角色补充（端到端，真实后端、真实 PostgreSQL）：
 * - 只读详情：把每一步都走一遍、在每个只读框里按回车、Tab 遍主区域——浏览器发不出任何写请求，也不调供应商接口；
 * - 数据状态：已暂停的供应商、草稿没有价格、已上架但限量库存从今天起为 0——列表和详情的状态、可用价格、提醒；
 * - 首页「已上架」的数和列表接口的 total 一致；
 * - 长供应商名、长子品牌名、长商品名在 768px 和 320px 都不横向滚动；
 * - 关键字里的 %、_、引号在真实后端按字面查。
 * 日期一律按商品所在城市当地的今天往后推。
 */
import { addDays } from "@nozomi/domain";
import { type APIRequestContext, type Page, type Request, expect, test } from "@playwright/test";
import { type Supplier, type World, createArea, createBrand, createProductByApi, createWorld, tenantHeaders } from "./catalog.ts";
import { activateTenant, adminCredentials, expectNoHorizontalOverflow, loginAs, newPassword, platformAdminHeaders, randomLetters, suspendTenant, uniqueEmail } from "./support.ts";

const RULES = {
  booking: { sale_from: null, sale_to: null, service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 0, note: null },
  urgent: { enabled: false, daily_quota: null, tiers: [] },
  night: { enabled: false, window: null, amount: null, charge_unit: null },
  free_wait: { pickup: { mode: "limited", minutes: 60 }, dropoff: { mode: "limited", minutes: 60 }, general: null },
  addons: [],
  driver_languages: [],
};

/** 名字可以指定的供应商（列表里的长名字要用）。 */
async function supplierNamed(request: APIRequestContext, world: World, tenantName: string, brandName: string): Promise<Supplier> {
  const headers = await platformAdminHeaders(request);
  const adminEmail = uniqueEmail("m112-qa");
  const created = await request.post("/platform/v1/tenants", { headers, data: { name: tenantName, admin: { email: adminEmail, name: "测试管理员" } } });
  expect(created.status(), await created.text()).toBe(201);
  const body = (await created.json()) as { tenant: { id: string }; invite: { token: string } };
  // 新建的供应商在「申请中」不能上架（ADR 0028）：直接摆成「正常」
  await activateTenant(body.tenant.id);
  const password = newPassword();
  expect((await request.post("/tenant/v1/auth/accept-invite", { data: { token: body.invite.token, password } })).ok()).toBe(true);
  const tenantHeader = await tenantHeaders(request, adminEmail, password);
  const brand = await createBrand(request, tenantHeader, brandName);
  const area = await createArea(request, tenantHeader, world.city, `区域 ${randomLetters(4)}`);
  return { tenant: { tenantId: body.tenant.id, tenantName, adminEmail, adminName: "测试管理员", inviteToken: body.invite.token, password }, headers: tenantHeader, brand, area };
}

async function version(request: APIRequestContext, supplier: Supplier, id: string): Promise<number> {
  return ((await (await request.get(`/tenant/v1/products/${id}`, { headers: supplier.headers })).json()) as { version: number }).version;
}

/** 配好服务规则和标题；`price` 给了就设一口价，`publish` 为真就上架。 */
async function product(request: APIRequestContext, supplier: Supplier, world: World, title: string, options: { price?: number; publish?: boolean } = {}): Promise<{ id: string; code: string; today: string }> {
  const created = await createProductByApi(request, supplier, world, "airport_transfer");
  const rules = await request.put(`/tenant/v1/products/${created.id}/service-rules`, { headers: { ...supplier.headers, "if-match": `"${created.version}"` }, data: RULES });
  expect(rules.status(), await rules.text()).toBe(200);
  const content = await request.put(`/tenant/v1/products/${created.id}/content`, { headers: { ...supplier.headers, "if-match": `"${((await rules.json()) as { version: number }).version}"` }, data: { zh: { title, pickup_guide: "到达大厅 2 号出口" } } });
  expect(content.status(), await content.text()).toBe(200);
  const { today } = (await (await request.get(`/tenant/v1/products/${created.id}/price-rules`, { headers: supplier.headers })).json()) as { today: string };
  if (options.price !== undefined) {
    const price = await request.post(`/tenant/v1/products/${created.id}/price-rules/batch`, {
      headers: { ...supplier.headers, "if-match": `"${await version(request, supplier, created.id)}"`, "idempotency-key": crypto.randomUUID() },
      data: { create: [{ ref: "a", area_id: supplier.area.id, vehicle_group_id: world.group.id, direction: "both", package_hours: null, pricing_model: "fixed", base_price: options.price, start_price: null, start_meters: null, start_minutes: null, per_km: null, per_minute: null, min_price: null, package_km: null, package_price: null, overtime_per_hour: null, over_km_per_km: null, valid_from: today, valid_to: null, status: "enabled" }], update: [], delete: [] },
    });
    expect(price.status(), await price.text()).toBe(200);
  }
  if (options.publish) {
    const published = await request.post(`/tenant/v1/products/${created.id}/publish`, { headers: supplier.headers });
    expect(published.status(), await published.text()).toBe(200);
  }
  return { id: created.id, code: created.code, today };
}

/** 记下浏览器发出的每个接口请求。 */
function recordApi(page: Page): Request[] {
  const seen: Request[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path.startsWith("/tenant/v1") || path.startsWith("/platform/v1")) seen.push(request);
  });
  return seen;
}
const forbidden = (seen: Request[]): string[] =>
  seen
    .filter((request) => {
      const path = new URL(request.url()).pathname;
      return path.startsWith("/tenant/v1") || (request.method() !== "GET" && !path.startsWith("/platform/v1/auth/"));
    })
    .map((request) => `${request.method()} ${new URL(request.url()).pathname}`);

test("只读详情：每一步都走一遍，在每个只读框里按回车、Tab 遍主区域，浏览器发不出任何写请求，也不调供应商接口；商品版本号前后不变", async ({ page, request }) => {
  test.setTimeout(150_000);
  const world = await createWorld(request);
  const supplier = await supplierNamed(request, world, `只读检查 ${randomLetters(4)}`, `品牌 ${randomLetters(3)}`);
  const item = await product(request, supplier, world, "只读检查的商品", { price: 18000, publish: true });
  const adjust = await request.post(`/tenant/v1/products/${item.id}/adjust-rules`, {
    headers: { ...supplier.headers, "if-match": `"${await version(request, supplier, item.id)}"`, "idempotency-key": crypto.randomUUID() },
    data: { name: "周末加价", cycle: { type: "weekly", weekdays: [6, 7] }, steps: [{ type: "percent", value: 1000 }] },
  });
  expect(adjust.status(), await adjust.text()).toBe(201);
  const before = await version(request, supplier, item.id);
  const admin = adminCredentials();
  await loginAs(page, "platform", admin.email, admin.password);
  const seen = recordApi(page);

  const paths = ["basic", "service-rules", "prices", "prices/adjust", "inventory", "content", "publish", "prices/import", "inventory/import", "prices/adjust/new", "prices/calendar"];
  for (const path of paths) {
    await page.goto(`/platform/products/${item.id}/${path}`);
    await expect(page.getByRole("navigation", { name: "配置步骤" })).toBeVisible();
    await expect(page.locator(".step-nav__status--loading")).toHaveCount(0);
    const fields = page.getByRole("main").locator("input:not([type=hidden]), textarea");
    const count = await fields.count();
    for (let index = 0; index < count; index += 1) {
      const field = fields.nth(index);
      if (!(await field.isVisible())) continue;
      await field.focus();
      await field.press("Enter");
      await field.press("ControlOrMeta+s");
    }
    for (let index = 0; index < 40; index += 1) await page.keyboard.press("Tab");
  }
  // 调价规则：Alt+↑ 不会调顺序
  await page.goto(`/platform/products/${item.id}/prices/adjust`);
  await expect(page.getByText("周末加价")).toBeVisible();
  await page.getByText("周末加价").first().click();
  await page.keyboard.press("Alt+ArrowUp");
  await expect(page.getByText("顺序有未保存的修改")).toHaveCount(0);

  expect(forbidden(seen), "只读详情里不该有写请求、不该调供应商接口").toEqual([]);
  expect(await version(request, supplier, item.id), "版本号不变").toBe(before);
});

test("数据状态：已暂停的供应商、草稿没有价格、已上架但限量库存从今天起没有——列表的状态和可用价格、详情的提醒和库存都对", async ({ page, request }) => {
  test.setTimeout(150_000);
  const world = await createWorld(request);
  const supplier = await supplierNamed(request, world, `状态检查 ${randomLetters(4)}`, `品牌 ${randomLetters(3)}`);
  const draft = await product(request, supplier, world, "状态·草稿没价");
  const limited = await product(request, supplier, world, "状态·限量没库存", { price: 15000, publish: true });
  const inventory = await request.put(`/tenant/v1/products/${limited.id}/inventory`, { headers: { ...supplier.headers, "if-match": `"${await version(request, supplier, limited.id)}"` }, data: { mode: "limited" } });
  expect(inventory.status(), await inventory.text()).toBe(200);
  await suspendTenant(request, supplier.tenant.tenantId);

  const admin = adminCredentials();
  await loginAs(page, "platform", admin.email, admin.password);
  await page.goto(`/platform/products?tenant=${supplier.tenant.tenantId}`);
  const row = (name: string) => page.getByRole("row").filter({ has: page.getByRole("link", { name, exact: true }) });
  await expect(row("状态·草稿没价")).toContainText("草稿");
  await expect(row("状态·草稿没价")).toContainText("没有价格");
  await expect(row("状态·草稿没价")).not.toContainText("报不出价");
  await expect(row("状态·限量没库存")).toContainText("已上架");
  await expect(row("状态·限量没库存")).toContainText("有 1 条");
  for (const name of ["状态·草稿没价", "状态·限量没库存"]) await expect(row(name)).toContainText("已暂停");
  await page.getByRole("combobox", { name: "状态" }).selectOption("草稿");
  await expect(page).toHaveURL(/status=draft/);
  await expect(row("状态·限量没库存")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "分页" })).toContainText("共 1 条");

  await page.goto(`/platform/products/${limited.id}/inventory`);
  await expect(page.getByText("这家供应商已暂停。")).toBeVisible();
  await expect(page.locator("main")).toContainText("库存模式限量");
  await expect(page.locator("main")).toContainText("从今天起没有库存，卖不出去");
  await page.goto(`/platform/products/${draft.id}/publish`);
  await expect(page.getByRole("heading", { level: 2, name: "上架检查" })).toBeVisible();
  await expect(page.locator('[data-check="price_rules"]')).not.toContainText("已满足");
  await expect(page.getByRole("main").getByRole("button", { name: "上架", exact: true })).toHaveCount(0);

  // 试算：暂停的供应商不参加比价，原因写出来
  await page.goto("/platform/quote-preview");
  const box = page.getByRole("combobox", { name: /城市/ });
  await box.fill(world.city.code);
  await page.getByRole("option", { name: new RegExp(world.city.name) }).click();
  await page.getByRole("radio", { name: "接送机" }).check();
  const place = page.getByRole("combobox", { name: /机场或车站/ });
  await place.fill(world.airport.code);
  await page.getByRole("option", { name: new RegExp(world.airport.name) }).click();
  await page.getByRole("radio", { name: /^接机/ }).check();
  const dropoff = page.getByRole("group", { name: "下车点" });
  await dropoff.getByRole("textbox", { name: /纬度/ }).fill("35.6895");
  await dropoff.getByRole("textbox", { name: /经度/ }).fill("139.6917");
  await page.getByRole("textbox", { name: "日期" }).fill(addDays(limited.today, 2));
  await page.getByRole("textbox", { name: "时刻" }).fill("00:00");
  await page.getByRole("textbox", { name: "人数" }).fill("1");
  await page.getByRole("combobox", { name: "客人支付的币种" }).selectOption("JPY");
  await page.getByRole("button", { name: "试算", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "试算结果" })).toBeVisible();
  const refused = page.getByRole("region", { name: "没报出价的商品和原因" });
  await expect(refused).toContainText(supplier.tenant.tenantName);
  await expect(refused).toContainText(limited.code);
  await expect(refused).toContainText(/暂停/);
});

test("首页「已上架」的数和列表接口 status=published 的 total 一致；点进去是已上架的列表，共 N 条也一样", async ({ page, request }) => {
  test.setTimeout(90_000);
  const admin = adminCredentials();
  const headers = await platformAdminHeaders(request);
  const total = async (query: string): Promise<number> => ((await (await request.get(`/platform/v1/products?${query}&limit=1`, { headers })).json()) as { total: number }).total;
  await loginAs(page, "platform", admin.email, admin.password);
  const card = page.locator(".entry-card").filter({ has: page.getByRole("link", { name: "商品", exact: true }) });
  // 别的用例在并行上架商品：取页面上的数之后立刻核对接口，对不上就刷新再来
  await expect(async () => {
    await page.reload();
    await expect(card).toContainText("已上架");
    const shown = Number(((await card.locator(".entry-card__counts dd").first().textContent()) ?? "").replace(/,/g, ""));
    expect(shown).toBe(await total("status=published"));
  }).toPass({ timeout: 30_000 });
  await card.getByRole("link", { name: "商品", exact: true }).click();
  await expect(page).toHaveURL(/\/platform\/products\?status=published$/);
  await expect(page.getByRole("combobox", { name: "状态" })).toHaveValue("published");
  await expect(async () => {
    const text = (await page.getByRole("navigation", { name: "分页" }).textContent()) ?? "";
    expect(Number(/共\s*([\d,]+)\s*条/.exec(text)?.[1]?.replace(/,/g, ""))).toBe(await total("status=published"));
  }).toPass({ timeout: 30_000 });
});

test("长供应商名、长子品牌名（带空格）、长商品名：列表、详情、供应商详情在 768px 和 320px 都不横向滚动", async ({ page, request }) => {
  test.setTimeout(150_000);
  const world = await createWorld(request);
  const longTenant = `Ｌｏｎｇｎａｍｅ交通株式会社${"国际旅游包车服务有限公司".repeat(6)}`.slice(0, 100);
  const longBrand = `Premium ${"Transfer ".repeat(5)}`.trim().slice(0, 50);
  const supplier = await supplierNamed(request, world, longTenant, longBrand);
  const item = await product(request, supplier, world, "AirportTransferFromHanedaInternationalTerminalToAnyHotelInCentralTokyo".concat("超长标题").slice(0, 100), { price: 20000, publish: true });
  const admin = adminCredentials();
  await loginAs(page, "platform", admin.email, admin.password);
  const check = async (what: string): Promise<void> => {
    for (const width of [768, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await expectNoHorizontalOverflow(page, `${what}（${width}px）`);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
  };
  await page.goto(`/platform/products?tenant=${supplier.tenant.tenantId}`);
  await expect(page.getByRole("link", { name: /AirportTransfer/ })).toBeVisible();
  await check("商品列表");
  for (const step of ["basic", "prices", "inventory", "publish"]) {
    await page.goto(`/platform/products/${item.id}/${step}`);
    await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
    await check(`商品详情（${step}）`);
  }
  await page.goto(`/platform/tenants/${supplier.tenant.tenantId}`);
  await expect(page.locator("section.tenant-products").getByRole("link", { name: /AirportTransfer/ })).toBeVisible();
  await check("供应商详情的商品");
});

test("关键字里的 %、_、引号在真实后端按字面查：输进搜索框只找到名字里真有这些字的商品", async ({ page, request }) => {
  test.setTimeout(120_000);
  const world = await createWorld(request);
  const supplier = await supplierNamed(request, world, `搜索检查 ${randomLetters(4)}`, `品牌 ${randomLetters(3)}`);
  const tag = randomLetters(4);
  await product(request, supplier, world, `${tag} 100%_O'Hare "VIP"`);
  await product(request, supplier, world, `${tag} 1000X OXHare VIP`);
  const admin = adminCredentials();
  await loginAs(page, "platform", admin.email, admin.password);
  await page.goto(`/platform/products?tenant=${supplier.tenant.tenantId}`);
  const search = page.getByRole("searchbox", { name: "按商品名或商品编号搜索" });
  for (const [q, expected] of [["%_", 1], ["0_", 0], ["O'Hare", 1], ['"VIP"', 1], ["hare", 2]] as const) {
    await search.fill(q);
    await search.press("Enter");
    if (expected === 0) await expect(page.getByText("没有符合条件的商品")).toBeVisible();
    else await expect(page.getByRole("navigation", { name: "分页" })).toContainText(`共 ${expected} 条`);
  }
});

test("子品牌名是一长串不带空格的英文（50 字以内，接口允许）时，商品详情标题下的「子品牌 …」在 320px 宽会折行，不把内容区撑出横向滚动", async ({ page, request }) => {
  test.setTimeout(120_000);
  const world = await createWorld(request);
  const supplier = await supplierNamed(request, world, `长品牌 ${randomLetters(4)}`, `Premium${"Transfer".repeat(5)}`.slice(0, 50));
  const item = await product(request, supplier, world, "长品牌的商品", { price: 20000, publish: true });
  const admin = adminCredentials();
  await loginAs(page, "platform", admin.email, admin.password);
  await page.goto(`/platform/products/${item.id}/basic`);
  await expect(page.getByRole("heading", { level: 2, name: "① 基础信息" })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 900 });
  const wide = await page.evaluate(() => {
    const main = document.querySelector("main") as HTMLElement;
    const limit = main.getBoundingClientRect().right;
    return [...main.querySelectorAll<HTMLElement>(".page__meta > *")].filter((node) => node.getBoundingClientRect().right > limit + 0.5).map((node) => node.textContent);
  });
  expect(wide, "标题下的信息行里超出内容区的项").toEqual([]);
  await expectNoHorizontalOverflow(page, "商品详情（320px，长子品牌名）");
});
