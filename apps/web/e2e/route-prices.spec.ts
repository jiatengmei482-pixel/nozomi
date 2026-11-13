/**
 * 端到端：供应商在价格页上设点对点「线路价」（返程价格、含公里数），平台报价试算和官网按这条线路报价（M8-12；tenant-prices.md 17.3、17.4；ADR 0073 第二部分）。
 * 真实浏览器 → 构建好的前端 → 真实 API → 真实 PostgreSQL，不 mock 接口；谷歌地图从不调用真实的。
 *
 * 本用例自己建一个城市（中心随机落在九州一带，离别的用例的城市都远：官网按上车地点找城市只会找到它），
 * 供应商经接口建一个运营区域（盖住整片）、两个报价区域（西边「甲区」、东边「乙区」），上架一个点对点商品（两个区域的区域价都是 9,000 日元）。
 * 甲区上车点 → 乙区下车点的路线直接写进路线缓存（34.2 公里，和 route-estimates-qa.spec.ts 同样的做法），用例结束删掉。然后：
 * - 从菜单「商品配置 → 价格规则」进到这个商品的价格页，「线路价」块里选「甲区 → 乙区」、确认添加，在对话框里填价格 18,000、返程价格 17,000、
 *   含 30 公里、超出每公里 300，添加，保存——一次批量保存里两条新增（去程、返程）；
 * - 运营后台「报价试算」：甲区上车、乙区下车 = 一口价 18,000 + 超出 5 公里 × 300 = 结算价 19,500（线路价优先，不用 9,000 的区域价）；
 * - 官网新预订页同一条路线：报价应答里有含公里数（超出 5 公里），卡片上的总价就是应答里的总价；
 * - 「复制」对话框默认是反方向；亮暗两色 axe、320 / 360 / 390 宽不横向滚动；截图存到 E2E_SCREENSHOT_DIR（没设时存到测试输出目录）。
 */
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { routeCacheKey } from "@nozomi/domain";
import { withPlatformTx } from "../../api/src/db/context.ts";
import { createPool } from "../../api/src/db/pool.ts";
import { E2E_WEB_STRIPE_PORT } from "../playwright.config.ts";
import { tomorrowInTokyo } from "./book-new-support.ts";
import { type Ref, createBrand, createWorld, expectAccessible, post, tenantHeaders } from "./catalog.ts";
import { createTestCity, OWN_SITE_SOURCE, adminCredentials, createActiveTenant, expectNoHorizontalOverflow, loginAs, platformAdminHeaders, randomLetters, settleAnimations } from "./support.ts";

test.use(OWN_SITE_SOURCE);

const SITE = `http://127.0.0.1:${E2E_WEB_STRIPE_PORT}`;
const RULES = {
  booking: { sale_from: null, sale_to: null, service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 0, note: null },
  urgent: { enabled: false, daily_quota: null, tiers: [] },
  night: { enabled: false, window: null, amount: null, charge_unit: null },
  free_wait: { pickup: null, dropoff: null, general: { mode: "limited", minutes: 30 } },
  addons: [],
  driver_languages: [],
};
const EMPTY_PRICE = { direction: null, package_hours: null, start_price: null, start_meters: null, start_minutes: null, per_km: null, per_minute: null, min_price: null, package_km: null, package_price: null, overtime_per_hour: null, over_km_per_km: null };
const ROUTE_METERS = 34_200;

type Point = { lat: number; lng: number };
const offset = (point: Point, lat: number, lng: number): Point => ({ lat: Number((point.lat + lat).toFixed(4)), lng: Number((point.lng + lng).toFixed(4)) });
const square = (center: Point, half: number): number[][] => [
  [center.lng - half, center.lat - half],
  [center.lng + half, center.lat - half],
  [center.lng + half, center.lat + half],
  [center.lng - half, center.lat + half],
  [center.lng - half, center.lat - half],
];

async function db<T>(fn: (query: (text: string, values: unknown[]) => Promise<unknown>) => Promise<T>): Promise<T> {
  const url = process.env["E2E_DATABASE_URL"];
  if (!url) throw new Error("global-setup 没有交出本次运行的数据库连接串");
  const pool = createPool(url, { max: 1 });
  try {
    return await withPlatformTx(pool, (tx) => fn((text, values) => tx.query(text, values)));
  } finally {
    await pool.end();
  }
}

interface Trip {
  tenant: Awaited<ReturnType<typeof createActiveTenant>>;
  headers: Record<string, string>;
  productId: string;
  title: string;
  city: Ref;
  groupName: string;
  west: Ref;
  east: Ref;
  pickup: Point;
  dropoff: Point;
}

const seeded: string[] = [];
test.afterAll(async () => {
  if (seeded.length > 0) await db((query) => query("delete from route_estimates where cache_key = any($1)", [seeded]));
});

/** 平台建城市；供应商建运营区域、两个报价区域，上架一个两个区域都有区域价的点对点商品；甲区 → 乙区的路线写进缓存。 */
async function routeTrip(request: APIRequestContext): Promise<Trip> {
  const world = await createWorld(request);
  const admin = await platformAdminHeaders(request);
  const center = { lat: Number((32.4 + Math.random() * 0.4).toFixed(4)), lng: Number((130.6 + Math.random() * 0.5).toFixed(4)) };
  const city = await createTestCity(request, admin, (tag) => ({ name: { zh: `线路城市${tag}` }, timezone: "Asia/Tokyo", center }));
  const tag = city.tag;
  const tenant = await createActiveTenant(request);
  const headers = await tenantHeaders(request, tenant.adminEmail, tenant.password);
  const brand = await createBrand(request, headers, `品牌 ${randomLetters(4)}`);
  const area = async (name: string, at: Point, half: number, role: "operating" | "pricing"): Promise<Ref> => {
    const made = await post<{ id: string }>(request, { ...headers, "idempotency-key": crypto.randomUUID() }, "/tenant/v1/areas", { city_id: city.id, name: { zh: name }, biz_type: "point_to_point", role, polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [square(at, half)] } }] }, "新建区域");
    return { id: made.id, code: "", name };
  };
  await area(`运营范围 ${tag}`, center, 0.4, "operating");
  const west = await area(`甲区 ${tag}`, offset(center, 0, -0.16), 0.04, "pricing");
  const east = await area(`乙区 ${tag}`, offset(center, 0, 0.16), 0.04, "pricing");
  const product = await post<{ id: string; version: number }>(
    request,
    { ...headers, "idempotency-key": crypto.randomUUID() },
    "/tenant/v1/products",
    { brand_id: brand.id, city_id: city.id, category: "point_to_point", areas: [{ area_id: west.id }, { area_id: east.id }], vehicle_groups: [{ vehicle_group_id: world.group.id, passengers: 6, luggage: 4 }], dispatchers: [{ name: "山田", phone: "+81 90 1234 5678" }] },
    "接口新建商品",
  );
  const rules = await request.put(`/tenant/v1/products/${product.id}/service-rules`, { headers: { ...headers, "if-match": `"${product.version}"` }, data: RULES });
  expect(rules.status(), await rules.text()).toBe(200);
  const title = `线路价点对点 ${tag}`;
  const content = await request.put(`/tenant/v1/products/${product.id}/content`, { headers: { ...headers, "if-match": `"${((await rules.json()) as { version: number }).version}"` }, data: { zh: { title } } });
  expect(content.status(), await content.text()).toBe(200);
  const { today, version } = (await (await request.get(`/tenant/v1/products/${product.id}/price-rules`, { headers })).json()) as { today: string; version: number };
  const areaPrice = (ref: string, areaId: string) => ({ ...EMPTY_PRICE, ref, area_id: areaId, vehicle_group_id: world.group.id, pricing_model: "fixed", base_price: 9000, valid_from: today, valid_to: null, status: "enabled" });
  const prices = await request.post(`/tenant/v1/products/${product.id}/price-rules/batch`, { headers: { ...headers, "if-match": `"${version}"`, "idempotency-key": crypto.randomUUID() }, data: { create: [areaPrice("w", west.id), areaPrice("e", east.id)], update: [], delete: [] } });
  expect(prices.status(), await prices.text()).toBe(200);
  const published = await request.post(`/tenant/v1/products/${product.id}/publish`, { headers });
  expect(published.status(), await published.text()).toBe(200);
  const pickup = offset(center, 0.01, -0.17);
  const dropoff = offset(center, -0.01, 0.17);
  const key = routeCacheKey(pickup, dropoff);
  expect(key.samePoint).toBe(false);
  seeded.push(key.key);
  await db((query) => query("insert into route_estimates (cache_key, distance_meters, duration_seconds, fetched_at, expires_at) values ($1, $2, 2400, now(), now() + interval '7 days') on conflict (cache_key) do update set failure_code = null, distance_meters = excluded.distance_meters, duration_seconds = 2400, expires_at = excluded.expires_at", [key.key, ROUTE_METERS]));
  return { tenant, headers, productId: product.id, title, city, groupName: world.group.name, west, east, pickup, dropoff };
}

async function shot(page: Page, name: string): Promise<void> {
  const dir = process.env["E2E_SCREENSHOT_DIR"];
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await settleAnimations(page);
    await page.screenshot({ path: dir ? `${dir}/m812-${name}-${scheme}.png` : test.info().outputPath(`m812-${name}-${scheme}.png`), fullPage: true });
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

test("供应商在价格页设线路价 甲区 → 乙区（带返程、含 30 公里、超出每公里 300）→ 运营报价试算是一口价 + 超出公里 → 官网报出总价；亮暗 axe、窄屏不横向滚动", async ({ page, request, browser }) => {
  test.setTimeout(240_000);
  const trip = await routeTrip(request);

  // ── 供应商：商品配置 → 价格规则 → 设价格 → 「线路价」 ──
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAs(page, "tenant", trip.tenant.adminEmail, trip.tenant.password);
  await page.getByRole("navigation", { name: "主菜单" }).first().getByRole("link", { name: "价格规则" }).click();
  await page.getByRole("link", { name: `设价格：${trip.title}` }).click();
  await expect(page.getByRole("heading", { level: 2, name: "③ 价格规则" })).toBeVisible();
  const block = page.locator("section.route-prices");
  await expect(block.getByRole("heading", { level: 3, name: "线路价" })).toBeVisible();
  await expect(block).toContainText("还没有线路价，每条线路都用上面的区域价。");
  await expect(page.locator("#price-table thead")).toContainText("含公里数（公里）");
  await expect(block.getByRole("link", { name: /^新增自定义区域\s*（在新标签页打开）$/ })).toHaveAttribute("href", /biz=point_to_point&role=pricing/);
  await block.getByRole("button", { name: "确认添加" }).click();
  await expect(block.getByText("请选上车区域和下车区域")).toBeVisible();
  await expect(block.getByLabel("上车区域")).toBeFocused();
  await bothThemes(page, "线路价（还没有）");
  await shot(page, "desktop-empty");

  await block.getByLabel("上车区域").selectOption({ label: trip.west.name });
  await block.getByLabel("下车区域").selectOption({ label: trip.east.name });
  await block.getByRole("button", { name: "确认添加" }).click();
  const dialog = page.getByRole("dialog", { name: `新增线路价：${trip.west.name} → ${trip.east.name}` });
  await dialog.getByLabel(/^价格/).fill("18000");
  await dialog.getByLabel(/^返程价格/).fill("17000");
  await dialog.getByLabel(/^含公里数/).fill("30");
  await dialog.getByLabel(/^超出每公里/).fill("300");
  await expect(dialog.getByRole("status")).toHaveText("会建 1 条线路价，返程 1 条，共 2 条。");
  await bothThemes(page, "新增线路价的对话框");
  await shot(page, "desktop-add-dialog");
  await dialog.getByRole("button", { name: "添加到表里" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("有 2 条未保存的修改")).toBeVisible();
  await expect(page.locator("#price-table")).not.toContainText("→");

  const saved = page.waitForResponse((response) => response.url().endsWith(`/products/${trip.productId}/price-rules/batch`) && response.request().method() === "POST");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const batch = await saved;
  expect(batch.status(), await batch.text()).toBe(200);
  const sent = batch.request().postDataJSON() as { create: { area_id: string; to_area_id: string; base_price: number; included_km: number; over_km_per_km: number }[]; update: unknown[]; delete: unknown[] };
  expect([sent.update.length, sent.delete.length]).toEqual([0, 0]);
  expect(sent.create.map((entry) => [entry.area_id, entry.to_area_id, entry.base_price, entry.included_km, entry.over_km_per_km])).toEqual([
    [trip.west.id, trip.east.id, 18000, 30, 300],
    [trip.east.id, trip.west.id, 17000, 30, 300],
  ]);
  await expect(page.locator(".toast").filter({ hasText: "已保存 2 条价格" })).toBeVisible();
  const group = block.locator(`[id="route-${trip.west.id}>${trip.east.id}"]`);
  await expect(group).toContainText(`${trip.west.name} → ${trip.east.name}返程：有`);
  await block.getByLabel(`${trip.west.name} → ${trip.east.name} · ${trip.groupName} 的基础价`).focus();
  await expect(block.locator(".price-meaning")).toContainText("每单 JPY 18,000，含 30 公里，超出每公里 JPY 300（不足 1 公里按 1 公里）。");
  await expect(block.locator(".price-meaning")).toContainText("例：路线 34.2 公里 = JPY 18,000 + 5 公里 × JPY 300 = JPY 19,500。");
  await expect(page.locator("main")).not.toContainText(/对外价|加价比例/);
  await bothThemes(page, "线路价（保存后）");
  await shot(page, "desktop-saved");

  // 复制：默认反方向
  await block.getByRole("button", { name: `复制线路「${trip.west.name} → ${trip.east.name}」` }).click();
  const copy = page.getByRole("dialog", { name: `复制线路：${trip.west.name} → ${trip.east.name}` });
  await expect(copy.getByLabel("上车区域")).toHaveValue(trip.east.id);
  await expect(copy.getByLabel("下车区域")).toHaveValue(trip.west.id);
  await expect(copy.getByRole("status")).toContainText("会填 0 条，跳过 1 条已经有线路价的");
  await bothThemes(page, "复制线路的对话框");
  await shot(page, "desktop-copy-dialog");

  // 手机：320 / 360 / 390 不横向滚动（表在自己的容器里横向滚动）
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoHorizontalOverflow(page, `复制线路对话框 ${width}px`);
  }
  await shot(page, "mobile-copy-dialog");
  await copy.getByRole("button", { name: "取消" }).click();
  for (const width of [320, 360, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await block.scrollIntoViewIfNeeded();
    await expectNoHorizontalOverflow(page, `线路价 ${width}px`);
  }
  await bothThemes(page, "线路价（390px）");
  await shot(page, "mobile-390");
  await block.getByLabel("上车区域").selectOption({ label: trip.east.name });
  await block.getByLabel("下车区域").selectOption({ label: trip.west.name });
  await block.getByRole("button", { name: "确认添加" }).click();
  const narrowDialog = page.getByRole("dialog", { name: `新增线路价：${trip.east.name} → ${trip.west.name}` });
  await expect(narrowDialog).toContainText("已有线路价");
  for (const width of [320, 360]) {
    await page.setViewportSize({ width, height: 800 });
    await expectNoHorizontalOverflow(page, `新增线路价对话框 ${width}px`);
  }
  await bothThemes(page, "新增线路价的对话框（360px）");
  await shot(page, "mobile-add-dialog");
  await narrowDialog.getByRole("button", { name: "取消" }).click();
  await page.setViewportSize({ width: 1280, height: 900 });

  // ── 运营：报价试算，甲区上车、乙区下车 ──
  const platformContext = await browser.newContext({ locale: "zh-CN", viewport: { width: 1280, height: 900 } });
  const ops = await platformContext.newPage();
  const admin = adminCredentials();
  await loginAs(ops, "platform", admin.email, admin.password);
  await ops.getByRole("navigation", { name: "主菜单" }).first().getByRole("link", { name: "报价试算" }).click();
  const cityBox = ops.getByRole("combobox", { name: /城市/ });
  await cityBox.click();
  await cityBox.fill(trip.city.code);
  await ops.getByRole("option", { name: new RegExp(trip.city.code) }).first().click();
  await ops.getByRole("radio", { name: "点对点" }).check();
  const from = ops.getByRole("group", { name: "上车点" });
  await from.getByRole("textbox", { name: /纬度/ }).fill(String(trip.pickup.lat));
  await from.getByRole("textbox", { name: /经度/ }).fill(String(trip.pickup.lng));
  const to = ops.getByRole("group", { name: "下车点" });
  await to.getByRole("textbox", { name: /纬度/ }).fill(String(trip.dropoff.lat));
  await to.getByRole("textbox", { name: /经度/ }).fill(String(trip.dropoff.lng));
  await ops.getByRole("textbox", { name: "日期" }).fill(tomorrowInTokyo());
  await ops.getByRole("textbox", { name: "时刻" }).fill("10:00");
  await ops.getByRole("textbox", { name: "人数" }).fill("2");
  await ops.getByRole("combobox", { name: "客人支付的币种" }).selectOption("JPY");
  await ops.getByRole("button", { name: "试算", exact: true }).click();
  await expect(ops.getByRole("heading", { level: 2, name: "试算结果" })).toBeFocused();
  await expect(ops.locator("main")).toContainText("用的路程：34.2 公里");
  const quoted = ops.locator(".quote-group").filter({ has: ops.getByRole("heading", { level: 3, name: trip.groupName }) });
  await expect(quoted).toContainText("结算价 JPY 19,500");
  await quoted.getByRole("button", { name: `看 ${trip.tenant.tenantName} 的结算价明细` }).click();
  const detail = quoted.locator(".quote-detail");
  await expect(detail).toContainText("基础价JPY 19,500");
  await expect(detail).toContainText("一口价 JPY 18,000 + 超出 5 公里 × JPY 300 = JPY 19,500（已含在基础价里）");
  await expect(detail).toContainText("含 30 公里，这次路线约 34.2 公里；超出的部分不足 1 公里按 1 公里");
  await expect(detail).toContainText("用的是这条线路（上车区域 → 下车区域，单向）的线路价");
  await shot(ops, "platform-quote-preview");
  await platformContext.close();

  // ── 官网新预订页：同一条路线，报价里有含公里数（超出 5 公里），卡片上的总价就是报价的总价 ──
  const site = await browser.newPage({ locale: "zh-CN", viewport: { width: 1280, height: 900 } });
  const answered = site.waitForResponse((response) => response.url().includes("/site/v1/quotes") && response.request().method() === "POST" && response.status() === 200);
  await site.goto(`${SITE}/book/new?from=${trip.pickup.lat},${trip.pickup.lng}&from_name=${encodeURIComponent("甲区上车点")}&to=${trip.dropoff.lat},${trip.dropoff.lng}&to_name=${encodeURIComponent("乙区下车点")}&date=${tomorrowInTokyo()}&time=10:00`);
  const body = (await (await answered).json()) as { quotes?: { vehicle_group: { name: Record<string, string> }; distance: { included_km: number; over_km: number; route_meters: number } | null; price: { total: { amount: string; currency: string } } }[] };
  const offer = (body.quotes ?? []).find((quote) => Object.values(quote.vehicle_group.name).includes(trip.groupName));
  expect(offer, JSON.stringify(body).slice(0, 500)).toBeTruthy();
  expect(offer?.distance).toEqual(expect.objectContaining({ included_km: 30, over_km: 5, route_meters: ROUTE_METERS }));
  const total = Number(offer?.price.total.amount ?? "0");
  const card = site.getByRole("listitem").filter({ has: site.getByRole("heading", { name: trip.groupName }) });
  await expect(card).toContainText(`${total.toLocaleString("en-US")} ${offer?.price.total.currency ?? "JPY"}`);
  await site.close();
});
