/**
 * 端到端（M8-13，ADR 0073 第四部分；规范 site-booking-v2.md 10.3、platform-orders.md 3d、driver.md 3a）：含公里数的点对点单，各处怎么写。
 * 真实浏览器 → 构建好的前端 → 真实 API → 真实 PostgreSQL，不 mock 接口。
 *
 * 本用例自己建一个城市（中心随机落在冲绳本岛一带，离别的用例的城市、和别的用例当作「不在任何城市」的北海道那几个点都在 80 公里以外：新预订页按两个坐标找城市只会找到它，也不会把别的用例的点认成它），供应商经接口建两个区域（「上车区」「下车区」），
 * 上架点对点商品：两个区域的区域价各 10,000；「上车区 → 下车区」的线路价 12,000，含 30 公里、超出每公里 300。
 * 这条路线的谷歌路线预估直接写进路线缓存（34,153 米，45 分钟；用例结束删掉），结果确定：超出 ⌈4.153⌉ = 5 公里，结算价 12,000 + 5 × 300 = 13,500。
 * - 新预订页：车型卡「公里数」一句（D 向上取整 34.2，每公里是对外价），右侧栏车费下面同一句、路线一行同一个 D；只有一个总价；
 * - 下单（官网真实接口），付款这一步和本任务无关，用迁移账号标为已付款；订单页「总价」后面「公里数」同一句；
 * - 运营订单详情：用的价格「线路价 · 上车区 → 下车区」、公里数三行（每公里对外 / 结算、核对米数）；
 * - 供应商订单详情：同样的用的价格，公里数只有结算价（「× JPY 300」），页面上没有对外价；
 * - 司机页（同一张单改成旧的包车单看显示）：写「下车：没有指定（包车，按客人安排）」；补上下车点后有「导航到下车点」；都没有价格。
 * 官网能看到的测试数据里不出现「加价」。320 / 390 宽不横向滚动，亮暗两色 axe；截图存到 E2E_SCREENSHOT_DIR（没设时存到测试输出目录），名字以 m813- 开头。
 */
import { randomInt } from "node:crypto";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { type LatLng, routeCacheKey } from "@nozomi/domain";
import { withPlatformTx } from "../../api/src/db/context.ts";
import { createPool } from "../../api/src/db/pool.ts";
import { E2E_WEB_STRIPE_PORT } from "../playwright.config.ts";
import { tomorrowInTokyo } from "./book-new-support.ts";
import { type Ref, createBrand, createWorld, expectAccessible, post, tenantHeaders } from "./catalog.ts";
import { routeStripe } from "./fake-stripe.ts";
import { createTestCity, OWN_SITE_SOURCE, adminCredentials, createActiveTenant, expectNoHorizontalOverflow, loginAs, platformAdminHeaders, randomLetters, settleAnimations } from "./support.ts";

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
const ROUTE_METERS = 34_153;

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

interface KmTrip {
  tenant: Awaited<ReturnType<typeof createActiveTenant>>;
  headers: Record<string, string>;
  groupId: string;
  groupName: string;
  from: Ref;
  to: Ref;
  /** 上车点就是城市中心：官网按两个坐标报价时按上车点选「中心最近」的城市（serviceCityOf），这个用例并行跑几份时各建的城市都在冲绳同一片随机，
   * 上车点离中心 1.5 公里时别的那份的城市中心偶尔更近、就按它报价（M8-29，本机 --repeat-each=20 --workers=4 复现：报价城市是另一份的「公里城市」）；
   * 放在中心距离是 0，只有中心坐标（4 位小数随机）完全相同的城市才会抢走它 */
  pickup: LatLng;
  dropoff: LatLng;
}

/** 平台建城市；供应商建两个区域，上架点对点商品（区域价 + 一条含公里数的线路价）。 */
async function kmTrip(request: APIRequestContext): Promise<KmTrip> {
  const world = await createWorld(request);
  const admin = await platformAdminHeaders(request);
  // 冲绳本岛一带：离别的用例的城市、和别的用例当作「哪个城市都不在」的点（manual-quote、area-roles 用北海道）都在 80 公里（城市的服务范围）以外
  const center = { lat: Number((26.2 + Math.random() * 0.3).toFixed(4)), lng: Number((127.65 + Math.random() * 0.2).toFixed(4)) };
  const city = await createTestCity(request, admin, (tag) => ({ name: { zh: `公里城市${tag}` }, timezone: "Asia/Tokyo", center }));
  const tag = city.tag;
  const tenant = await createActiveTenant(request);
  const headers = await tenantHeaders(request, tenant.adminEmail, tenant.password);
  const brand = await createBrand(request, headers, `品牌 ${randomLetters(4)}`);
  const area = async (name: string, at: LatLng): Promise<Ref> => {
    const made = await post<{ id: string }>(request, { ...headers, "idempotency-key": crypto.randomUUID() }, "/tenant/v1/areas", { city_id: city.id, name: { zh: name }, biz_type: "general", polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [square(at, 0.05)] } }] }, "新建区域");
    return { id: made.id, code: "", name };
  };
  const fromArea = await area(`上车区 ${tag}`, center);
  const toCenter = offset(center, 0, 0.3);
  const toArea = await area(`下车区 ${tag}`, toCenter);
  const product = await post<{ id: string; version: number }>(
    request,
    { ...headers, "idempotency-key": crypto.randomUUID() },
    "/tenant/v1/products",
    { brand_id: brand.id, city_id: city.id, category: "point_to_point", areas: [{ area_id: fromArea.id }, { area_id: toArea.id }], vehicle_groups: [{ vehicle_group_id: world.group.id, passengers: 6, luggage: 4 }], dispatchers: [{ name: "山田", phone: "+81 90 1234 5678" }] },
    "新建点对点商品",
  );
  const rules = await request.put(`/tenant/v1/products/${product.id}/service-rules`, { headers: { ...headers, "if-match": `"${product.version}"` }, data: RULES });
  expect(rules.status(), await rules.text()).toBe(200);
  const content = await request.put(`/tenant/v1/products/${product.id}/content`, { headers: { ...headers, "if-match": `"${((await rules.json()) as { version: number }).version}"` }, data: { zh: { title: `市内用车 ${tag}` } } });
  expect(content.status(), await content.text()).toBe(200);
  const { today } = (await (await request.get(`/tenant/v1/products/${product.id}/price-rules`, { headers })).json()) as { today: string };
  const fixed = (areaId: string, price: number, extra: Record<string, unknown> = {}) => ({ area_id: areaId, vehicle_group_id: world.group.id, pricing_model: "fixed", base_price: price, valid_from: today, ...extra });
  const batch = await request.post(`/tenant/v1/products/${product.id}/price-rules/batch`, {
    headers: { ...headers, "if-match": `"${((await content.json()) as { version: number }).version}"`, "idempotency-key": crypto.randomUUID() },
    data: { create: [fixed(fromArea.id, 10_000), fixed(toArea.id, 10_000), fixed(fromArea.id, 12_000, { to_area_id: toArea.id, included_km: 30, over_km_per_km: 300 })] },
  });
  expect(batch.status(), await batch.text()).toBe(200);
  const published = await request.post(`/tenant/v1/products/${product.id}/publish`, { headers });
  expect(published.status(), await published.text()).toBe(200);
  return { tenant, headers, groupId: world.group.id, groupName: world.group.name, from: fromArea, to: toArea, pickup: center, dropoff: offset(toCenter, -0.01, 0.01) };
}

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env["E2E_SCREENSHOT_DIR"];
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await settleAnimations(page);
    await page.screenshot({ path: dir ? `${dir}/m813-${name}-${scheme}.png` : test.info().outputPath(`m813-${name}-${scheme}.png`), fullPage: true });
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

/** 「行程」卡片里某一项的值（按 dt 找 dd） */
const tripItem = (page: Page, label: string) => page.locator("section.card").filter({ has: page.getByRole("heading", { name: "行程" }) }).locator(".details__item").filter({ has: page.locator("dt", { hasText: new RegExp(`^${label}$`) }) }).locator("dd");

let seededKey: string | null = null;
test.afterAll(async () => {
  if (seededKey !== null) await asPlatform((query) => query("delete from route_estimates where cache_key = $1", [seededKey]));
});

test("含公里数的点对点单：新预订页车型卡和车费下面「含 30 公里，本次路线约 34.2 公里，超出 5 公里 × Y（已含在一口价里）」→ 下单 → 订单页同一句 → 运营详情结算价和对外价 → 供应商详情只有结算价 → 司机页包车下车点；窄屏、亮暗 axe", async ({ page, request, browser }) => {
  test.setTimeout(240_000);
  const trip = await kmTrip(request);
  const key = routeCacheKey(trip.pickup, trip.dropoff);
  expect(key.samePoint).toBe(false);
  seededKey = key.key;
  await asPlatform((query) => query("insert into route_estimates (cache_key, distance_meters, duration_seconds, fetched_at, expires_at) values ($1, $2, 2700, now(), now() + interval '7 days') on conflict (cache_key) do update set failure_code = null, distance_meters = excluded.distance_meters, duration_seconds = 2700, expires_at = excluded.expires_at", [key.key, ROUTE_METERS]));
  const fakeStripe = process.env["E2E_FAKE_STRIPE_URL"];
  if (!fakeStripe) throw new Error("global-setup 没有启动假 Stripe");
  await routeStripe(page, fakeStripe);

  // ── 官网新预订页（电脑 1280）：链接带两端 → 自动报价 ──
  await page.setViewportSize({ width: 1280, height: 900 });
  const quoted = page.waitForResponse((response) => new URL(response.url()).pathname === "/site/v1/quotes/by-points" && response.request().method() === "POST");
  await page.goto(`${SITE}/book/new?${linkPoint("from", trip.pickup, "北口酒店")}&${linkPoint("to", trip.dropoff, "东边车站")}&date=${tomorrowInTokyo()}&time=10:00&pax=2&bags=1`);
  const answer = await quoted;
  expect(answer.status(), await answer.text()).toBe(200);
  const offer = ((await answer.json()) as { quotes: { vehicle_group: { id: string }; price: { total: { amount: string } }; distance: { included_km: number; route_meters: number; over_km: number; over_km_per_km: { amount: string; currency: string } } | null }[] }).quotes.find((entry) => entry.vehicle_group.id === trip.groupId);
  expect(offer?.distance, "报价带含公里数（对外价）").toMatchObject({ included_km: 30, route_meters: ROUTE_METERS, over_km: 5, over_km_per_km: { currency: "JPY" } });
  const perKm = Number(offer?.distance?.over_km_per_km.amount);
  expect(perKm, "每公里是对外价：比结算价 300 高（含加价比例）").toBeGreaterThan(300);
  const total = Number(offer?.price.total.amount).toLocaleString("en-US");
  const note = `含 30 公里，本次路线约 34.2 公里，超出 5 公里 × ${perKm.toLocaleString("en-US")} JPY（已含在一口价里）`;

  const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: trip.groupName }) });
  await expect(card).toContainText(`${total} JPY`);
  await expect(card.locator(".site-facts__item").filter({ has: page.locator("dt", { hasText: "公里数" }) }).locator("dd")).toHaveText(note);
  await card.getByRole("button", { name: `选择 ${trip.groupName}` }).click();
  const aside = page.getByRole("complementary", { name: "行程摘要" });
  await expect(aside).toContainText(note);
  // 路线一行（有路线预览时才有；缓存里只有距离和时长，没有折线）：公里数和上面那句同一个 D
  const routeLine = aside.locator(".book-summary__route");
  if ((await routeLine.count()) > 0) await expect(routeLine).toContainText("34.2 公里");
  await expect(page.locator("main")).not.toContainText(/13,500|12,000|300 JPY|加价/);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `新预订页含公里数（电脑，${scheme === "light" ? "亮色" : "暗色"}）`);
  }
  await page.emulateMedia({ colorScheme: "light" });
  await shot(page, "book-new-desktop");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(card.locator(".site-facts__item").filter({ has: page.locator("dt", { hasText: "公里数" }) })).toBeVisible();
  await narrowAndAccessible(page, "新预订页含公里数（手机第 2 步）");
  await shot(page, "book-new-mobile");
  await page.setViewportSize({ width: 1280, height: 900 });

  // ── 下单（页面上「去付款」），付款这一步不在本任务：用迁移账号标为已付款 ──
  await page.getByRole("button", { name: "下一步：填写乘客信息" }).click();
  await page.getByLabel("乘车人姓名").fill("陈小红");
  await page.getByLabel("邮箱").fill(`km-${crypto.randomUUID().slice(0, 8)}@e2e.example.com`);
  await page.getByLabel("手机号（含国家区号）").fill(`+81 90-${randomInt(1000, 9999)}-${randomInt(1000, 9999)}`);
  await page.getByRole("button", { name: "下一步：核对订单" }).click();
  await expect(page.getByRole("region", { name: "核对订单" })).toContainText(note);
  await page.getByRole("checkbox", { name: /同意保存/ }).check();
  const placed = page.waitForResponse((response) => new URL(response.url()).pathname === "/site/v1/orders" && response.request().method() === "POST");
  await page.getByRole("button", { name: "去付款 →" }).click();
  const created = await placed;
  expect(created.status(), await created.text()).toBe(201);
  const order = ((await created.json()) as { order: { id: string; order_no: string; distance: unknown; includes_area_surcharge: boolean } }).order;
  expect([order.distance, order.includes_area_surcharge]).toEqual([{ included_km: 30, route_meters: ROUTE_METERS, over_km: 5, over_km_per_km: { amount: String(perKm), currency: "JPY" } }, false]);
  await expect(page.getByRole("heading", { level: 1, name: `订单 ${order.order_no}` })).toBeVisible();
  await asOwner(async (query) => {
    await query("update orders set status = 'confirmed', confirmed_at = now(), dispatch_due_at = service_at - interval '2 hours', updated_at = now() where id = $1", [order.id]);
    await query("update order_payments set status = 'succeeded', succeeded_at = now() where order_id = $1", [order.id]);
  });
  await page.reload();
  const tripSection = page.getByRole("region", { name: "行程" });
  await expect(tripSection.locator("dt", { hasText: /^公里数$/ })).toBeVisible();
  const labels = await tripSection.locator("dt").allTextContents();
  expect(labels[labels.indexOf("总价") + 1]).toBe("公里数");
  await expect(tripSection.locator(".site-facts__item").filter({ has: page.locator("dt", { hasText: /^公里数$/ }) }).locator("dd")).toHaveText(note);
  await expect(tripSection).not.toContainText(/含区域加价|加价|13,500/);
  await narrowAndAccessible(page, "官网订单页（公里数）");
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, "site-order-mobile");
  await page.setViewportSize({ width: 1280, height: 900 });

  // ── 运营订单详情：用的价格、公里数（对外 / 结算） ──
  const opsContext = await browser.newContext({ locale: "zh-CN", viewport: { width: 1280, height: 900 } });
  const ops = await opsContext.newPage();
  const admin = adminCredentials();
  await loginAs(ops, "platform", admin.email, admin.password);
  await ops.goto(`/platform/orders/${order.id}`);
  await expect(ops.getByRole("heading", { level: 1, name: `订单 ${order.order_no}` })).toBeVisible();
  await expect(tripItem(ops, "用的价格")).toHaveText(`线路价 · ${trip.from.name} → ${trip.to.name}`);
  await expect(tripItem(ops, "公里数").locator(".details__lines > span")).toHaveText(["含 30 公里 · 路线约 34.2 公里（报价时）· 超出 5 公里", `每公里 对外 ${perKm.toLocaleString("en-US")} JPY / 结算 300 JPY`, "路线 34,153 米"]);
  await expect(tripItem(ops, "区域加价")).toHaveCount(0);
  await expect(tripItem(ops, "对外价 / 结算价")).toContainText("13,500 JPY");
  await narrowAndAccessible(ops, "运营订单详情（公里数）");
  await shot(ops, "platform-order");
  await ops.setViewportSize({ width: 390, height: 844 });
  await tripItem(ops, "公里数").scrollIntoViewIfNeeded();
  await shot(ops, "platform-order-mobile");
  await opsContext.close();

  // ── 供应商订单详情：只有结算价 ──
  const tenantContext = await browser.newContext({ locale: "zh-CN", viewport: { width: 1280, height: 900 } });
  const tenant = await tenantContext.newPage();
  await loginAs(tenant, "tenant", trip.tenant.adminEmail, trip.tenant.password);
  await tenant.goto(`/orders/${order.id}`);
  await expect(tripItem(tenant, "用的价格")).toHaveText(`线路价 · ${trip.from.name} → ${trip.to.name}`);
  await expect(tripItem(tenant, "公里数").locator(".details__lines > span")).toHaveText(["含 30 公里 · 路线约 34.2 公里（报价时）· 超出 5 公里 × JPY 300", "路线 34,153 米"]);
  await expect(tripItem(tenant, "结算价")).toContainText("13,500");
  await expect(tenant.locator("main")).not.toContainText(new RegExp(`对外|加价比例|${perKm} JPY|${total}`));
  await narrowAndAccessible(tenant, "供应商订单详情（公里数）");
  await shot(tenant, "tenant-order");

  // ── 司机页：同一张单改成旧的包车单（没有下车点）看显示；补上下车点后有「导航到下车点」；页面上没有价格 ──
  const headers = trip.headers;
  const driver = await request.post("/tenant/v1/drivers", { headers: { ...headers, "idempotency-key": crypto.randomUUID() }, data: { name: "虚构司机", phone: `+8190${randomInt(10_000_000, 99_999_999)}`, languages: ["ja"], license_expires_on: "2035-01-01" } });
  expect(driver.ok(), await driver.text()).toBe(true);
  const vehicle = await request.post("/tenant/v1/vehicles", { headers: { ...headers, "idempotency-key": crypto.randomUUID() }, data: { plate: `札幌 300 あ ${randomInt(1000, 9999)}`, vehicle_group_id: trip.groupId, model: "虚构车型", color: "黑", seats: 7, mileage_km: 12_000, plate_type: "business", insurance_expires_on: "2035-01-01", inspection_expires_on: "2035-01-01" } });
  expect(vehicle.ok(), await vehicle.text()).toBe(true);
  const current = (await (await request.get(`/tenant/v1/orders/${order.id}`, { headers })).json()) as { order: { version: number } };
  const assigned = await request.post(`/tenant/v1/orders/${order.id}/assign`, { headers: { ...headers, "if-match": `"${current.order.version}"` }, data: { driver_id: ((await driver.json()) as { id: string }).id, vehicle_id: ((await vehicle.json()) as { id: string }).id } });
  expect(assigned.ok(), await assigned.text()).toBe(true);
  const link = ((await assigned.json()) as { driver_link: { token: string } }).driver_link.token;
  const dropoff = (await asOwner((query) => query("select dropoff from orders where id = $1", [order.id]))) as { rows: { dropoff: unknown }[] };
  await asOwner((query) => query("update orders set category = 'charter', package_hours = 8, dropoff = null where id = $1", [order.id]));
  const driverPage = await tenantContext.newPage();
  await driverPage.setViewportSize({ width: 390, height: 844 });
  await driverPage.goto(`/driver#${link}`);
  await expect(driverPage.getByText("下车：没有指定（包车，按客人安排）")).toBeVisible();
  await expect(driverPage.getByRole("link", { name: "导航到下车点" })).toHaveCount(0);
  await asOwner((query) => query("update orders set dropoff = $2::jsonb where id = $1", [order.id, JSON.stringify(dropoff.rows[0]?.dropoff)]));
  await driverPage.reload();
  await expect(driverPage.getByText("下车：东边车站")).toBeVisible();
  await expect(driverPage.getByRole("link", { name: "导航到下车点" })).toHaveAttribute("href", `geo:${trip.dropoff.lat},${trip.dropoff.lng}?q=${trip.dropoff.lat},${trip.dropoff.lng}`);
  await expect(driverPage.locator("body")).not.toContainText(/JPY|价格|结算|对外价|加价|区域|公里数/);
  await narrowAndAccessible(driverPage, "司机页（包车下车点）");
  await shot(driverPage, "driver");
  await tenantContext.close();
});
