/**
 * 端到端（M8-30b，ADR 0080）：计程价 → 官网新预订页的「含里程费」「按里程计价」。
 * 真实浏览器 → 构建好的前端 → 真实 API → 真实 PostgreSQL，不 mock 接口。
 *
 * 本用例自己建一个城市（中心随机落在宫古岛一带，离别的用例的城市都在 80 公里以外，按两个坐标找城市只会找到它），
 * 供应商经接口建一个小的报价区域（role = pricing）和一个大的运营区域（role = operating），上架点对点商品：报价区域的一口价 10,000。
 * 计程价由供应商在价格页「计程价」小块里新增（起步价 3,000、每公里 300），同一车型组再加一条重叠的被拒（409 的中文）；
 * 两条路线的路线预估直接写进路线缓存（用例结束删掉），结果确定：
 * - (a) 一端在报价区域里、一端在外：一口价 + 区域外 ⌈16.4⌉ = 17 公里 × 300 → 新预订页车型卡、右侧栏写「含里程费」；
 * - (b) 两端都在外：起步价 + ⌈21.25⌉ = 22 公里 × 300 → 写「按里程计价」。
 * 都只有一个总价，官网能看到的数据里不出现「加价」、计程的单价。
 * (b) 接着下单（付款这一步不在本任务：用迁移账号标为已付款），运营、供应商订单详情的「计价方式」写计程价和计程明细（M8-30c，结算价；
 * 供应商页面上没有对外价）。最后在价格页停用这条计程价。
 * 320 / 390 宽不横向滚动，亮暗两色 axe；截图存到 E2E_SCREENSHOT_DIR（没设时存到测试输出目录），名字以 m830- 开头。
 */
import { randomInt } from "node:crypto";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { type LatLng, routeCacheKey } from "@nozomi/domain";
import { withPlatformTx } from "../../api/src/db/context.ts";
import { createPool } from "../../api/src/db/pool.ts";
import { E2E_WEB_STRIPE_PORT } from "../playwright.config.ts";
import { tomorrowInTokyo } from "./book-new-support.ts";
import { createBrand, createWorld, expectAccessible, post, tenantHeaders } from "./catalog.ts";
import { OWN_SITE_SOURCE, adminCredentials, createActiveTenant, expectNoHorizontalOverflow, loginAs, platformAdminHeaders, randomLetters, settleAnimations } from "./support.ts";

test.use(OWN_SITE_SOURCE);

const SITE = `http://127.0.0.1:${E2E_WEB_STRIPE_PORT}`;
const RULES = {
  booking: { sale_from: null, sale_to: null, service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 0, note: null },
  urgent: { enabled: false, daily_quota: null, tiers: [] },
  night: { enabled: false, window: null, amount: null, charge_unit: null },
  free_wait: { pickup: null, dropoff: null, general: { mode: "limited", minutes: 15 } },
  addons: [],
  driver_languages: [],
};

const offset = (point: LatLng, lat: number, lng: number): LatLng => ({ lat: Number((point.lat + lat).toFixed(4)), lng: Number((point.lng + lng).toFixed(4)) });
const square = (center: LatLng, half: number): number[][] => [
  [center.lng - half, center.lat - half],
  [center.lng + half, center.lat - half],
  [center.lng + half, center.lat + half],
  [center.lng - half, center.lat + half],
  [center.lng - half, center.lat - half],
];
const linkPoint = (key: "from" | "to", point: LatLng, name: string): string => `${key}=${point.lat},${point.lng}&${key}_name=${encodeURIComponent(name)}`;

async function asOwner<T>(run: (query: (text: string, values: unknown[]) => Promise<unknown>) => Promise<T>): Promise<T> {
  const url = process.env["E2E_DATABASE_OWNER_URL"];
  if (!url) throw new Error("global-setup 没有准备好数据库连接");
  const pool = createPool(url, { max: 1 });
  try {
    return await run((text, values) => pool.query(text, values));
  } finally {
    await pool.end();
  }
}

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

interface Setup {
  tenant: Awaited<ReturnType<typeof createActiveTenant>>;
  productId: string;
  groupId: string;
  groupName: string;
  inside: LatLng;
  outA: LatLng;
  outB: LatLng;
}

/** 平台建城市；供应商建报价区域、运营区域，上架点对点商品（报价区域的一口价）。计程价不在这里设——由页面上设。 */
async function setup(request: APIRequestContext): Promise<Setup> {
  const world = await createWorld(request);
  const admin = await platformAdminHeaders(request);
  const tag = randomLetters(5);
  // 宫古岛一带：离别的用例的城市（冲绳本岛、九州、四国、北海道……）都在 80 公里（城市的服务范围）以外
  const center = { lat: Number((24.7 + Math.random() * 0.15).toFixed(4)), lng: Number((125.25 + Math.random() * 0.15).toFixed(4)) };
  const city = await post<{ id: string }>(request, admin, "/platform/v1/master/cities", { code: `CTY-JP-${tag}`, country_code: "JP", name: { zh: `计程城市${tag}` }, timezone: "Asia/Tokyo", center }, "新建城市");
  const tenant = await createActiveTenant(request);
  const headers = await tenantHeaders(request, tenant.adminEmail, tenant.password);
  const brand = await createBrand(request, headers, `品牌 ${randomLetters(4)}`);
  const area = async (name: string, half: number, role: "pricing" | "operating"): Promise<string> =>
    (await post<{ id: string }>(request, { ...headers, "idempotency-key": crypto.randomUUID() }, "/tenant/v1/areas", { city_id: city.id, name: { zh: name }, biz_type: "general", role, polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [square(center, half)] } }] }, "新建区域")).id;
  const pricing = await area(`市中心 ${tag}`, 0.03, "pricing");
  await area(`全岛运营 ${tag}`, 0.3, "operating");
  const product = await post<{ id: string; version: number }>(
    request,
    { ...headers, "idempotency-key": crypto.randomUUID() },
    "/tenant/v1/products",
    { brand_id: brand.id, city_id: city.id, category: "point_to_point", areas: [{ area_id: pricing }], vehicle_groups: [{ vehicle_group_id: world.group.id, passengers: 6, luggage: 4 }], dispatchers: [{ name: "山田", phone: "+81 90 1234 5678" }] },
    "新建点对点商品",
  );
  const rules = await request.put(`/tenant/v1/products/${product.id}/service-rules`, { headers: { ...headers, "if-match": `"${product.version}"` }, data: RULES });
  expect(rules.status(), await rules.text()).toBe(200);
  const content = await request.put(`/tenant/v1/products/${product.id}/content`, { headers: { ...headers, "if-match": `"${((await rules.json()) as { version: number }).version}"` }, data: { zh: { title: `岛内用车 ${tag}` } } });
  expect(content.status(), await content.text()).toBe(200);
  const { today } = (await (await request.get(`/tenant/v1/products/${product.id}/price-rules`, { headers })).json()) as { today: string };
  const batch = await request.post(`/tenant/v1/products/${product.id}/price-rules/batch`, {
    headers: { ...headers, "if-match": `"${((await content.json()) as { version: number }).version}"`, "idempotency-key": crypto.randomUUID() },
    data: { create: [{ area_id: pricing, vehicle_group_id: world.group.id, pricing_model: "fixed", base_price: 10_000, valid_from: today }] },
  });
  expect(batch.status(), await batch.text()).toBe(200);
  const published = await request.post(`/tenant/v1/products/${product.id}/publish`, { headers });
  expect(published.status(), await published.text()).toBe(200);
  return { tenant, productId: product.id, groupId: world.group.id, groupName: world.group.name, inside: offset(center, 0.01, 0.01), outA: offset(center, 0, 0.15), outB: offset(center, 0.12, -0.1) };
}

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env["E2E_SCREENSHOT_DIR"];
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await settleAnimations(page);
    await page.screenshot({ path: dir ? `${dir}/m830-${name}-${scheme}.png` : test.info().outputPath(`m830-${name}-${scheme}.png`), fullPage: true });
  }
  await page.emulateMedia({ colorScheme: "light" });
}

/** 亮暗两色 axe；320 / 390 宽不横向滚动（量完回到原来的宽度）。 */
async function narrowAndAccessible(page: Page, what: string): Promise<void> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 900 };
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expectNoHorizontalOverflow(page, `${what} ${width}px`);
  }
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `${what}（390px，${scheme === "light" ? "亮色" : "暗色"}）`);
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize(viewport);
}

const seeded: string[] = [];
test.afterAll(async () => {
  if (seeded.length > 0) await asPlatform((query) => query("delete from route_estimates where cache_key = any($1)", [seeded]));
});

async function seedRoute(from: LatLng, to: LatLng, meters: number): Promise<void> {
  const key = routeCacheKey(from, to);
  expect(key.samePoint).toBe(false);
  seeded.push(key.key);
  await asPlatform((query) => query("insert into route_estimates (cache_key, distance_meters, duration_seconds, fetched_at, expires_at) values ($1, $2, 1800, now(), now() + interval '7 days') on conflict (cache_key) do update set failure_code = null, distance_meters = excluded.distance_meters, duration_seconds = 1800, expires_at = excluded.expires_at", [key.key, meters]));
}

/** 打开新预订页（链接带两端 → 自动报价），返回这个车型组的报价应答原文和报价 */
async function quoteOnSite(page: Page, trip: Setup, from: LatLng, to: LatLng): Promise<{ raw: string; quote: { pricing_basis?: string; price: { total: { amount: string } } } | undefined }> {
  const quoted = page.waitForResponse((response) => new URL(response.url()).pathname === "/site/v1/quotes/by-points" && response.request().method() === "POST");
  await page.goto(`${SITE}/book/new?${linkPoint("from", from, "北边酒店")}&${linkPoint("to", to, "南边海滩")}&date=${tomorrowInTokyo()}&time=10:00&pax=2&bags=1`);
  const answer = await quoted;
  const raw = await answer.text();
  expect(answer.status(), raw).toBe(200);
  const quote = (JSON.parse(raw) as { quotes: { vehicle_group: { id: string }; pricing_basis?: string; price: { total: { amount: string } } }[] }).quotes.find((entry) => entry.vehicle_group.id === trip.groupId);
  return { raw, quote };
}

async function expectBasisOnSite(page: Page, trip: Setup, from: LatLng, to: LatLng, basis: string, note: string, name: string): Promise<void> {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { raw, quote } = await quoteOnSite(page, trip, from, to);
  expect(quote?.pricing_basis, `报价按 ${basis}`).toBe(basis);
  expect(raw, "官网能看到的数据里没有加价、计程单价").not.toMatch(/加价|markup|per_km|start_price|mileage/);
  const total = Number(quote?.price.total.amount).toLocaleString("en-US");
  const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: trip.groupName }) });
  await expect(card).toContainText(`${total} JPY`);
  await expect(card.locator(".book-vehicle__note")).toHaveText(note);
  await card.getByRole("button", { name: `选择 ${trip.groupName}` }).click();
  const aside = page.getByRole("complementary", { name: "行程摘要" });
  await expect(aside.getByText(note, { exact: true }).first()).toBeVisible();
  const amounts = new Set(((await page.locator("main").textContent()) ?? "").replaceAll(trip.groupName, " ").match(/[\d,]+ JPY/g) ?? []);
  expect([...amounts], "只有一个总价").toEqual([`${total} JPY`]);
  await expect(page.locator("main")).not.toContainText(/加价|每公里|起步价/);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `新预订页${note}（电脑，${scheme === "light" ? "亮色" : "暗色"}）`);
  }
  await page.emulateMedia({ colorScheme: "light" });
  await shot(page, `${name}-desktop`);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(card.locator(".book-vehicle__note")).toBeVisible();
  await narrowAndAccessible(page, `新预订页${note}（手机第 2 步）`);
  await shot(page, `${name}-mobile`);
}

test("供应商在价格页新增计程价（重叠的被拒）→ 一端在区域外的报价写「含里程费」→ 两端都在外写「按里程计价」→ 下单后运营、供应商订单详情写计价方式 → 停用；窄屏、亮暗 axe", async ({ page, request, browser }) => {
  test.setTimeout(360_000);
  const trip = await setup(request);
  await seedRoute(trip.inside, trip.outA, 16_400);
  await seedRoute(trip.outA, trip.outB, 21_250);

  // ── 供应商价格页：「计程价」小块 ──
  const tenantContext = await browser.newContext({ locale: "zh-CN", viewport: { width: 1280, height: 900 } });
  const tenant = await tenantContext.newPage();
  await loginAs(tenant, "tenant", trip.tenant.adminEmail, trip.tenant.password);
  await tenant.goto(`/products/${trip.productId}/prices`);
  const block = tenant.locator("section.distance-prices");
  await expect(block).toContainText("两端都不在报价区域时按计程价报价；只有一端在区域内时，区域外那段按这里的每公里单价收里程费；不设则这些情况不报价");
  await expect(block).toContainText("还没有设计程价");
  await block.getByRole("button", { name: "新增计程价" }).click();
  let dialog = tenant.getByRole("dialog", { name: "新增计程价" });
  await dialog.getByLabel(/^起步价/).fill("3,000");
  await dialog.getByLabel(/^每公里/).fill("300");
  await dialog.getByRole("button", { name: "新增" }).click();
  await expect(dialog).toBeHidden();
  const row = block.getByRole("row", { name: new RegExp(trip.groupName) });
  await expect(row).toContainText("JPY 3,000");
  await expect(row).toContainText("JPY 300");
  await expect(row.getByRole("switch")).toBeChecked();
  // 同一车型组生效日期重叠：后端 409，页面说清楚
  await block.getByRole("button", { name: "新增计程价" }).click();
  dialog = tenant.getByRole("dialog", { name: "新增计程价" });
  await dialog.getByLabel(/^起步价/).fill("2000");
  await dialog.getByLabel(/^每公里/).fill("250");
  await dialog.getByRole("button", { name: "新增" }).click();
  await expect(dialog.getByRole("alert")).toContainText("生效日期和这段重叠");
  await expect(dialog).not.toContainText("DISTANCE_PRICE_CONFLICT");
  await dialog.getByRole("button", { name: "取消" }).click();
  await expect(tenant.locator("main")).not.toContainText(/对外价|加价比例/);
  await block.scrollIntoViewIfNeeded();
  await narrowAndAccessible(tenant, "价格页计程价");
  await shot(tenant, "tenant-distance-prices");
  await tenant.setViewportSize({ width: 390, height: 844 });
  await block.scrollIntoViewIfNeeded();
  await tenant.screenshot({ path: process.env["E2E_SCREENSHOT_DIR"] ? `${process.env["E2E_SCREENSHOT_DIR"]}/m830-tenant-distance-prices-390.png` : test.info().outputPath("m830-tenant-distance-prices-390.png") });
  await tenant.setViewportSize({ width: 1280, height: 900 });

  // ── (a) 一端在报价区域里：含里程费；(b) 两端都在外：按里程计价 ──
  await expectBasisOnSite(page, trip, trip.inside, trip.outA, "one_price_outside_km", "含里程费", "book-new-outside-km");
  await expectBasisOnSite(page, trip, trip.outA, trip.outB, "distance_only", "按里程计价", "book-new-distance-only");

  // ── (b) 下单 → 运营、供应商订单详情的「计价方式」（M8-30c）：起步价 3,000 + 22 公里 × 300 = 9,600（结算价） ──
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole("button", { name: "下一步：填写乘客信息" }).click();
  await page.getByLabel("乘车人姓名").fill("陈小红");
  await page.getByLabel("邮箱").fill(`mileage-${crypto.randomUUID().slice(0, 8)}@e2e.example.com`);
  await page.getByLabel("手机号（含国家区号）").fill(`+81 90-${randomInt(1000, 9999)}-${randomInt(1000, 9999)}`);
  await page.getByRole("button", { name: "下一步：核对订单" }).click();
  await page.getByRole("checkbox", { name: /同意保存/ }).check();
  const placed = page.waitForResponse((response) => new URL(response.url()).pathname === "/site/v1/orders" && response.request().method() === "POST");
  await page.getByRole("button", { name: "去付款 →" }).click();
  const created = await placed;
  expect(created.status(), await created.text()).toBe(201);
  const order = ((await created.json()) as { order: { id: string; order_no: string; pricing_basis: string } }).order;
  expect(order.pricing_basis).toBe("distance_only");
  // 官网订单页「费用说明」（M6-08）：按里程计价的不写「一口价已含所有费用」
  await expect(page.locator("main")).toContainText("车费已含高速费、停车费等，无需另付");
  await expect(page.locator("main")).not.toContainText("一口价已含所有费用");
  await asOwner(async (query) => {
    await query("update orders set status = 'confirmed', confirmed_at = now(), dispatch_due_at = service_at - interval '2 hours', updated_at = now() where id = $1", [order.id]);
    await query("update order_payments set status = 'succeeded', succeeded_at = now() where order_id = $1", [order.id]);
  });
  const basisItem = (on: Page) => on.locator("section.card").filter({ has: on.getByRole("heading", { name: "行程" }) }).locator(".details__item").filter({ has: on.locator("dt", { hasText: /^计价方式$/ }) }).locator("dd");
  const opsContext = await browser.newContext({ locale: "zh-CN", viewport: { width: 1280, height: 900 } });
  const ops = await opsContext.newPage();
  const admin = adminCredentials();
  await loginAs(ops, "platform", admin.email, admin.password);
  await ops.goto(`/platform/orders/${order.id}`);
  await expect(ops.getByRole("heading", { level: 1, name: `订单 ${order.order_no}` })).toBeVisible();
  await expect(basisItem(ops)).toContainText("计程价（起步价 + 每公里）");
  await expect(basisItem(ops)).toContainText(/起步价 .*3,000.* \+ 22 公里 × .*300.* = .*9,600.*（已含在基础价里）/);
  await expect(basisItem(ops)).toContainText("路线约 21.3 公里（报价时）");
  await narrowAndAccessible(ops, "运营订单详情（计价方式）");
  await shot(ops, "platform-order");
  await opsContext.close();
  await tenant.goto(`/orders/${order.id}`);
  await expect(tenant.getByRole("heading", { level: 1, name: `订单 ${order.order_no}` })).toBeVisible();
  await expect(basisItem(tenant)).toContainText("起步价 JPY 3,000 + 22 公里 × JPY 300 = JPY 9,600（已含在基础价里）");
  await expect(tenant.locator("main")).not.toContainText(/对外|加价比例/);
  await narrowAndAccessible(tenant, "供应商订单详情（计价方式）");
  await shot(tenant, "tenant-order");

  // ── 回到价格页 ──
  await tenant.goto(`/products/${trip.productId}/prices`);

  // ── 停用：开关立即生效 ──
  await row.getByRole("switch").click();
  await expect(row.getByRole("switch")).not.toBeChecked();
  await expect(row).toContainText("已停用");
  await tenantContext.close();
});
