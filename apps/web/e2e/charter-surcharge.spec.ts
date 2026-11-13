/**
 * 端到端：供应商在价格页上设包车「区域加价」（M8-12a；tenant-prices.md 17.2；ADR 0073 第三部分）。
 * 真实浏览器 → 构建好的前端 → 真实 API → 真实 PostgreSQL，不 mock 接口。
 *
 * 本用例自己建一个城市（中心随机落在四国一带，离别的用例的城市都远：官网包车按上车地点找城市只会找到它），
 * 供应商经接口建一个运营区域（盖住整片）、商品区域和两个报价区域（东边「东区」、西边「西区」），上架包车商品（8 小时套餐 70,000 日元）。然后在页面上：
 * - 从菜单「商品配置 → 价格规则」进到这个商品的价格页，「区域加价」块里选区域、确认添加、在对话框里填上车加价和下车加价，两个区域都加上，保存（一次批量保存）；
 * - 运营后台「报价试算」：甲上车、乙下车 = 套餐价 70,000 + 上车加价 500 + 下车加价 1,000 = 结算价 71,500；
 * - 官网新预订页同一条路线：只有一个价，写「含区域加价」，不写加价金额；
 * - 删除「东区」（页面内确认）→ 保存：那几条区域加价停用（记录还在），出现在「已删除的加价区域」里。
 * 亮暗两色 axe、320 / 390 宽不横向滚动（手机上区域是卡片）；截图存到 E2E_SCREENSHOT_DIR（没设时存到测试输出目录）。
 */
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { E2E_WEB_STRIPE_PORT } from "../playwright.config.ts";
import { tomorrowInTokyo } from "./book-new-support.ts";
import { type Ref, createBrand, createProductByApi, createWorld, expectAccessible, post, tenantHeaders } from "./catalog.ts";
import { OWN_SITE_SOURCE, adminCredentials, createActiveTenant, expectNoHorizontalOverflow, loginAs, platformAdminHeaders, randomLetters, settleAnimations } from "./support.ts";

test.use(OWN_SITE_SOURCE);

const SITE = `http://127.0.0.1:${E2E_WEB_STRIPE_PORT}`;
const RULES = {
  booking: { sale_from: null, sale_to: null, service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 0, note: null },
  urgent: { enabled: false, daily_quota: null, tiers: [] },
  night: { enabled: false, window: null, amount: null, charge_unit: null },
  free_wait: { pickup: null, dropoff: null, general: { mode: "limited", minutes: 0 } },
  addons: [],
  driver_languages: [],
};
const EMPTY_PRICE = { direction: null, start_price: null, start_meters: null, start_minutes: null, per_km: null, per_minute: null, min_price: null, base_price: null };

type Point = { lat: number; lng: number };
const offset = (point: Point, lat: number, lng: number): Point => ({ lat: Number((point.lat + lat).toFixed(6)), lng: Number((point.lng + lng).toFixed(6)) });
const square = (center: Point, half: number): number[][] => [
  [center.lng - half, center.lat - half],
  [center.lng + half, center.lat - half],
  [center.lng + half, center.lat + half],
  [center.lng - half, center.lat + half],
  [center.lng - half, center.lat - half],
];

interface Trip {
  tenant: Awaited<ReturnType<typeof createActiveTenant>>;
  headers: Record<string, string>;
  productId: string;
  title: string;
  city: Ref;
  groupName: string;
  east: Ref;
  west: Ref;
  /** 东区里的上车点、西区里的下车点 */
  pickup: Point;
  dropoff: Point;
}

async function version(request: APIRequestContext, headers: Record<string, string>, id: string): Promise<number> {
  return ((await (await request.get(`/tenant/v1/products/${id}`, { headers })).json()) as { version: number }).version;
}

/** 平台建城市；供应商建运营区域、商品区域、两个报价区域，上架一个只有套餐价的包车商品。 */
async function charterTrip(request: APIRequestContext): Promise<Trip> {
  const world = await createWorld(request);
  const admin = await platformAdminHeaders(request);
  const tag = randomLetters(5);
  const center = { lat: Number((33.7 + Math.random() * 0.4).toFixed(6)), lng: Number((133.0 + Math.random() * 0.6).toFixed(6)) };
  const created = await post<{ id: string }>(request, admin, "/platform/v1/master/cities", { code: `CTY-JP-${tag}`, country_code: "JP", name: { zh: `区域甲城市${tag}` }, timezone: "Asia/Tokyo", center }, "新建城市");
  const city: Ref = { id: created.id, code: `CTY-JP-${tag}`, name: `区域甲城市${tag}` };
  const tenant = await createActiveTenant(request);
  const headers = await tenantHeaders(request, tenant.adminEmail, tenant.password);
  const brand = await createBrand(request, headers, `品牌 ${randomLetters(4)}`);
  const area = async (name: string, at: Point, half: number, role: "operating" | "pricing"): Promise<Ref> => {
    const made = await post<{ id: string }>(request, { ...headers, "idempotency-key": crypto.randomUUID() }, "/tenant/v1/areas", { city_id: city.id, name: { zh: name }, biz_type: "charter", role, polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [square(at, half)] } }] }, "新建区域");
    return { id: made.id, code: "", name };
  };
  await area(`运营范围 ${tag}`, center, 0.4, "operating");
  const own = await area(`市区 ${tag}`, center, 0.05, "pricing");
  const east = await area(`东区 ${tag}`, offset(center, 0, 0.16), 0.04, "pricing");
  const west = await area(`西区 ${tag}`, offset(center, 0, -0.16), 0.04, "pricing");
  const product = await createProductByApi(request, { tenant, headers, brand, area: own }, { ...world, city }, "charter");
  const rules = await request.put(`/tenant/v1/products/${product.id}/service-rules`, { headers: { ...headers, "if-match": `"${product.version}"` }, data: RULES });
  expect(rules.status(), await rules.text()).toBe(200);
  const title = `区域加价包车 ${tag}`;
  const content = await request.put(`/tenant/v1/products/${product.id}/content`, { headers: { ...headers, "if-match": `"${((await rules.json()) as { version: number }).version}"` }, data: { zh: { title } } });
  expect(content.status(), await content.text()).toBe(200);
  const { today } = (await (await request.get(`/tenant/v1/products/${product.id}/price-rules`, { headers })).json()) as { today: string };
  const price = await request.post(`/tenant/v1/products/${product.id}/price-rules`, {
    headers: { ...headers, "if-match": `"${await version(request, headers, product.id)}"`, "idempotency-key": crypto.randomUUID() },
    data: { ...EMPTY_PRICE, area_id: own.id, vehicle_group_id: world.group.id, package_hours: 8, pricing_model: "charter_package", package_km: 150, package_price: 70000, overtime_per_hour: 5000, over_km_per_km: 400, valid_from: today },
  });
  expect(price.status(), await price.text()).toBe(201);
  const published = await request.post(`/tenant/v1/products/${product.id}/publish`, { headers });
  expect(published.status(), await published.text()).toBe(200);
  return { tenant, headers, productId: product.id, title, city, groupName: world.group.name, east, west, pickup: offset(center, 0.01, 0.17), dropoff: offset(center, -0.01, -0.17) };
}

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env["E2E_SCREENSHOT_DIR"];
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await settleAnimations(page);
    await page.screenshot({ path: dir ? `${dir}/m812a-${name}-${scheme}.png` : test.info().outputPath(`m812a-${name}-${scheme}.png`), fullPage: true });
  }
  await page.emulateMedia({ colorScheme: "light" });
}

async function bothThemes(page: Page, what: string): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `${what}（${scheme === "light" ? "亮色" : "暗色"}）`);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

/** 在「区域加价」块里选一个区域、确认添加、填两个加价、添加。 */
async function addSurcharge(page: Page, area: Ref, pickup: string, dropoff: string): Promise<void> {
  const block = page.locator("section.surcharge");
  await block.getByLabel("选择要加价的区域").selectOption({ label: area.name });
  await block.getByRole("button", { name: "确认添加" }).click();
  const dialog = page.getByRole("dialog", { name: `给「${area.name}」设区域加价` });
  await expect(dialog).toContainText("会填 1 个组合。");
  await dialog.getByLabel(/^上车加价/).fill(pickup);
  await dialog.getByLabel(/^下车加价/).fill(dropoff);
  await dialog.getByRole("button", { name: "添加" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(block.locator(`tr.surcharge-table__area`).filter({ hasText: area.name })).toContainText("未保存");
}

test("供应商在价格页设包车区域加价（两个区域）→ 运营报价试算是套餐价 + 上车加价 + 下车加价 → 官网写「含区域加价」→ 删除即停用；亮暗 axe、窄屏不横向滚动", async ({ page, request, browser }) => {
  test.setTimeout(240_000);
  const trip = await charterTrip(request);

  // ── 供应商：商品配置 → 价格规则 → 设价格 → 「区域加价」 ──
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAs(page, "tenant", trip.tenant.adminEmail, trip.tenant.password);
  const menu = page.getByRole("navigation", { name: "主菜单" }).first();
  await menu.getByRole("link", { name: "价格规则" }).click();
  await page.getByRole("link", { name: `设价格：${trip.title}` }).click();
  await expect(page.getByRole("heading", { level: 2, name: "③ 价格规则" })).toBeVisible();
  const block = page.locator("section.surcharge");
  await expect(block.getByRole("heading", { level: 3, name: "区域加价" })).toBeVisible();
  await expect(block).toContainText("包车现在要看下车地点。");
  await expect(block).toContainText("另有 1 个运营区域没有列出");
  const options = await block.getByLabel("选择要加价的区域").locator("option").allTextContents();
  expect(options.some((text) => text.startsWith("市区") && text.includes("商品的服务区域，不加价"))).toBe(true);
  expect(options.some((text) => text.startsWith("运营范围"))).toBe(false);
  await expect(block.getByRole("link", { name: /^新增自定义区域\s*（在新标签页打开）$/ })).toHaveAttribute("href", /role=pricing/);
  await block.getByRole("button", { name: "确认添加" }).click();
  await expect(block.getByText("请先选一个区域")).toBeVisible();
  await expect(block.getByLabel("选择要加价的区域")).toBeFocused();

  await addSurcharge(page, trip.east, "500", "500");
  await addSurcharge(page, trip.west, "800", "1000");
  await expect(page.getByText("有 2 条未保存的修改")).toBeVisible();
  await expect(page.locator("#price-table")).not.toContainText(trip.east.name);
  await bothThemes(page, "区域加价（添加后、保存前）");
  await shot(page, "desktop-unsaved");

  const saved = page.waitForResponse((response) => response.url().endsWith(`/products/${trip.productId}/price-rules/batch`) && response.request().method() === "POST");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const batch = await saved;
  expect(batch.status(), await batch.text()).toBe(200);
  const sent = batch.request().postDataJSON() as { create: { area_id: string; pricing_model: string; pickup_surcharge: number; dropoff_surcharge: number }[]; update: unknown[]; delete: unknown[] };
  expect(sent.create.map((entry) => [entry.area_id, entry.pricing_model, entry.pickup_surcharge, entry.dropoff_surcharge]).sort()).toEqual([[trip.east.id, "charter_area_surcharge", 500, 500], [trip.west.id, "charter_area_surcharge", 800, 1000]].sort());
  await expect(page.locator(".toast").filter({ hasText: "已保存 2 条价格" })).toBeVisible();
  await expect(block.locator("tr.surcharge-table__area")).toHaveCount(2);
  await expect(block.locator("tr.surcharge-table__area").filter({ hasText: trip.west.name })).toContainText("1,000");
  await expect(page.getByRole("navigation", { name: "本页的分块" })).toContainText("区域加价（2 个区域）");
  // 添加时已经展开着（保存后保持）
  await expect(block.getByRole("button", { name: `收起「${trip.west.name}」的各车型组和套餐` })).toHaveAttribute("aria-expanded", "true");
  await block.getByLabel(`区域加价 · ${trip.west.name} · ${trip.groupName} · 8 小时 的上车加价`).focus();
  await expect(block.locator(".price-meaning")).toContainText(`上车点在${trip.west.name}时加 JPY 800，下车点在${trip.west.name}时加 JPY 1,000，途经景点在${trip.west.name}的单（没设途经加价）不报价。`);
  await expect(page.locator("main")).not.toContainText(/对外价|加价比例/);
  await bothThemes(page, "区域加价（保存后，展开一个区域）");
  await shot(page, "desktop-saved");

  // 手机：区域是卡片，320 / 390 不横向滚动
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await block.scrollIntoViewIfNeeded();
    await expectNoHorizontalOverflow(page, `区域加价 ${width}px`);
  }
  await bothThemes(page, "区域加价（390px）");
  await shot(page, "mobile-390");
  await block.getByRole("button", { name: `编辑「${trip.east.name}」的区域加价` }).click();
  const editing = page.getByRole("dialog", { name: `改「${trip.east.name}」的区域加价` });
  await expect(editing.getByLabel(/^上车加价/)).toHaveValue("500");
  await expectNoHorizontalOverflow(page, "编辑对话框 390px");
  await bothThemes(page, "编辑区域加价的对话框（390px）");
  await shot(page, "mobile-dialog");
  await editing.getByRole("button", { name: "取消" }).click();
  await page.setViewportSize({ width: 1280, height: 900 });

  // ── 运营：报价试算，甲上车、乙下车 ──
  const platformContext = await browser.newContext({ locale: "zh-CN", viewport: { width: 1280, height: 900 } });
  const ops = await platformContext.newPage();
  const admin = adminCredentials();
  await loginAs(ops, "platform", admin.email, admin.password);
  await ops.getByRole("navigation", { name: "主菜单" }).first().getByRole("link", { name: "报价试算" }).click();
  const cityBox = ops.getByRole("combobox", { name: /城市/ });
  await cityBox.click();
  await cityBox.fill(trip.city.code);
  await ops.getByRole("option", { name: new RegExp(trip.city.code) }).first().click();
  await ops.getByRole("radio", { name: /^包车/ }).check();
  const pickupGroup = ops.getByRole("group", { name: "上车点" });
  await pickupGroup.getByRole("textbox", { name: /纬度/ }).fill(String(trip.pickup.lat));
  await pickupGroup.getByRole("textbox", { name: /经度/ }).fill(String(trip.pickup.lng));
  const dropoffGroup = ops.getByRole("group", { name: "下车点（选填）" });
  await dropoffGroup.getByRole("textbox", { name: /纬度/ }).fill(String(trip.dropoff.lat));
  await dropoffGroup.getByRole("textbox", { name: /经度/ }).fill(String(trip.dropoff.lng));
  await ops.getByLabel("套餐时长（小时）").fill("8");
  await ops.getByRole("textbox", { name: "日期" }).fill(tomorrowInTokyo());
  await ops.getByRole("textbox", { name: "时刻" }).fill("10:00");
  await ops.getByRole("textbox", { name: "人数" }).fill("2");
  await ops.getByRole("combobox", { name: "客人支付的币种" }).selectOption("JPY");
  await ops.getByRole("button", { name: "试算", exact: true }).click();
  await expect(ops.getByRole("heading", { level: 2, name: "试算结果" })).toBeFocused();
  const group = ops.locator(".quote-group").filter({ has: ops.getByRole("heading", { level: 3, name: trip.groupName }) });
  await expect(group).toContainText(`结算价 JPY 71,500`);
  await group.getByRole("button", { name: `看 ${trip.tenant.tenantName} 的结算价明细` }).click();
  const detail = group.locator(".quote-detail");
  await expect(detail).toContainText("基础价JPY 71,500");
  await expect(detail).toContainText("套餐价 JPY 70,000 + 上车加价 JPY 500 + 下车加价 JPY 1,000（已含在基础价里）");
  await shot(ops, "platform-quote-preview");
  await platformContext.close();

  // ── 官网新预订页：同一条路线只有一个价，写「含区域加价」，不写加价金额 ──
  const site = await browser.newPage({ locale: "zh-CN", viewport: { width: 1280, height: 900 } });
  const link = `${SITE}/book/new?mode=charter&from=${trip.pickup.lat},${trip.pickup.lng}&from_name=${encodeURIComponent("甲上车点")}&to=${trip.dropoff.lat},${trip.dropoff.lng}&to_name=${encodeURIComponent("乙下车点")}&date=${tomorrowInTokyo()}&time=10:00`;
  await site.goto(link);
  const card = site.getByRole("listitem").filter({ has: site.getByRole("heading", { name: trip.groupName }) });
  await expect(card).toContainText("含区域加价，已算在这个价格里");
  await expect(site.locator("main")).not.toContainText(/500 JPY|1,000 JPY|1,500 JPY/);
  await site.close();

  // ── 删除「东区」= 停用：页面内确认 → 保存 → 记录还在、不启用，出现在「已删除的加价区域」 ──
  await block.getByRole("button", { name: `删除加价区域「${trip.east.name}」` }).click();
  const confirm = page.getByRole("dialog", { name: `删除加价区域「${trip.east.name}」？` });
  await expect(confirm).toContainText("会停用，记录保留");
  await bothThemes(page, "删除加价区域的确认");
  await shot(page, "delete-confirm");
  await confirm.getByRole("button", { name: "删除", exact: true }).click();
  await expect(block.locator("tr.surcharge-table__area").filter({ hasText: trip.east.name })).toContainText("将删除");
  const disabled = page.waitForResponse((response) => response.url().endsWith(`/products/${trip.productId}/price-rules/batch`) && response.request().method() === "POST");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const answer = await disabled;
  expect(answer.status(), await answer.text()).toBe(200);
  const removal = answer.request().postDataJSON() as { create: unknown[]; update: { area_id: string; status: string }[]; delete: unknown[] };
  expect([removal.create, removal.delete, removal.update.map((entry) => [entry.area_id, entry.status])]).toEqual([[], [], [[trip.east.id, "disabled"]]]);
  await expect(block.getByText("已删除的加价区域（1）")).toBeVisible();
  const stored = (await (await request.get(`/tenant/v1/products/${trip.productId}/price-rules`, { headers: trip.headers })).json()) as { items: { area_id: string; pricing_model: string; status: string }[] };
  expect(stored.items.filter((item) => item.pricing_model === "charter_area_surcharge").map((item) => [item.area_id === trip.east.id ? "东" : "西", item.status]).sort()).toEqual([["东", "disabled"], ["西", "enabled"]]);
  await block.locator("details.surcharge-deleted > summary").click();
  await bothThemes(page, "已删除的加价区域");
  await shot(page, "desktop-deleted");
});
