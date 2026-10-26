/**
 * 端到端（M2-02 路线预估，测试角色补充）：真实浏览器 → 前端 → 真实 API → 真实 PostgreSQL，不 mock 接口；谷歌地图从不调用真实的
 * （global-setup 把地址指向本机假服务器，服务进程没有配置密钥）。
 *
 * 路线结果怎么来：别的用例会短暂在运营后台填一把谷歌密钥（integration-secrets.spec.ts），所以「有没有密钥」不是确定的。
 * 这里把要用的两组起终点直接写进路线缓存（平台角色，和服务进程一样的权限）：一组「没有路线」（1 天的负缓存），一组 9.25 公里 25 分钟——
 * 缓存在查密钥之前，结果确定。起终点每次运行随机，用例结束删掉这两行。
 *
 * - 官网点对点：没有路线 → 「换一个地址」；暂时算不出（没有密钥）→ 「稍后再试」；不出现原因代码和内部说法；320 / 768 宽不横向滚动，亮暗 axe。
 * - 运营后台报价试算：来自缓存（写明来源，结算价和手算一致）、起终点重合（按 0、起步价）、假定值、没有路线（原因码 + 怎么办的警示条）；
 *   320 / 768 宽不横向滚动，亮暗 axe。「刚调用谷歌」这一种来源要有密钥，由组件测试 products.test.tsx 覆盖。
 */
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { type LatLng, routeCacheKey } from "@nozomi/domain";
import { withPlatformTx } from "../../api/src/db/context.ts";
import { createPool } from "../../api/src/db/pool.ts";
import { CENTER, type Supplier, type World, choose, createProductByApi, createSupplier, createWorld, expectAccessible } from "./catalog.ts";
import { adminCredentials, loginAs } from "./support.ts";

const RULES = {
  booking: { sale_from: null, sale_to: null, service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 0, note: null },
  urgent: { enabled: false, daily_quota: null, tiers: [] },
  night: { enabled: false, window: null, amount: null, charge_unit: null },
  free_wait: { pickup: null, dropoff: null, general: { mode: "limited", minutes: 30 } },
  addons: [],
  driver_languages: [],
};
const EMPTY_PRICE = { direction: null, package_hours: null, start_price: null, start_meters: null, start_minutes: null, per_km: null, per_minute: null, min_price: null, package_km: null, package_price: null, overtime_per_hour: null, over_km_per_km: null, base_price: null };
/** 起步 3,000 日元含 5 公里 20 分钟，超出每公里 400、每分钟 80 */
const METERED = { pricing_model: "mileage_time", start_price: 3_000, start_meters: 5_000, start_minutes: 20, per_km: 400, per_minute: 80 };

const GUEST_NO_ROUTE = "这两个地点之间没有可行驶的路线，请换一个地址。";
const GUEST_TEMPORARY = "暂时算不出这段路程的价格，请稍后再试，或改订包车。";

/** 区域（中心 ±0.1 度）里的一个随机点，4 位小数 */
const randomPoint = (): LatLng => ({ lat: Number((CENTER.lat - 0.08 + Math.random() * 0.16).toFixed(4)), lng: Number((CENTER.lng - 0.08 + Math.random() * 0.16).toFixed(4)) });

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

async function publishMetered(request: APIRequestContext, supplier: Supplier, world: World): Promise<void> {
  const product = await createProductByApi(request, supplier, world, "point_to_point");
  const rules = await request.put(`/tenant/v1/products/${product.id}/service-rules`, { headers: { ...supplier.headers, "if-match": `"${product.version}"` }, data: RULES });
  expect(rules.status(), await rules.text()).toBe(200);
  const content = await request.put(`/tenant/v1/products/${product.id}/content`, { headers: { ...supplier.headers, "if-match": `"${((await rules.json()) as { version: number }).version}"` }, data: { zh: { title: "官网市内里程计价" } } });
  expect(content.status(), await content.text()).toBe(200);
  const { today } = (await (await request.get(`/tenant/v1/products/${product.id}/price-rules`, { headers: supplier.headers })).json()) as { today: string };
  const version = ((await (await request.get(`/tenant/v1/products/${product.id}`, { headers: supplier.headers })).json()) as { version: number }).version;
  const created = await request.post(`/tenant/v1/products/${product.id}/price-rules/batch`, {
    headers: { ...supplier.headers, "if-match": `"${version}"`, "idempotency-key": crypto.randomUUID() },
    data: { create: [{ ...EMPTY_PRICE, ...METERED, ref: "a", area_id: supplier.area.id, vehicle_group_id: world.group.id, valid_from: today, valid_to: null, status: "enabled" }], update: [], delete: [] },
  });
  expect(created.status(), await created.text()).toBe(200);
  const published = await request.post(`/tenant/v1/products/${product.id}/publish`, { headers: supplier.headers });
  expect(published.status(), await published.text()).toBe(200);
}

function tomorrowInTokyo(): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(Date.now() + 24 * 3_600_000)).map((part) => [part.type, part.value]));
  return `${parts["year"]}-${parts["month"]}-${parts["day"]}`;
}

async function expectNarrowAndAccessible(page: Page, what: string): Promise<void> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  for (const size of [{ width: 320, height: 640 }, { width: 768, height: 1024 }]) {
    await page.setViewportSize(size);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${what}：${size.width}px 宽横向溢出`).toBe(0);
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expectAccessible(page, `${what}（${size.width}px，${scheme === "light" ? "亮色" : "暗色"}）`);
    }
    await page.emulateMedia({ colorScheme: "light" });
  }
  await page.setViewportSize(viewport);
}

let world: World;
let pickup: LatLng;
let noRoute: LatLng;
let cached: LatLng;
const seeded: string[] = [];

test.beforeAll(async ({ request }) => {
  test.setTimeout(120_000);
  world = await createWorld(request);
  await publishMetered(request, await createSupplier(request, world), world);
  pickup = randomPoint();
  noRoute = randomPoint();
  cached = randomPoint();
  const bad = routeCacheKey(pickup, noRoute);
  const good = routeCacheKey(pickup, cached);
  expect(bad.samePoint || good.samePoint || bad.key === good.key).toBe(false);
  seeded.push(bad.key, good.key);
  await db(async (query) => {
    await query("insert into route_estimates (cache_key, failure_code, fetched_at, expires_at) values ($1, 'NO_ROUTE', now(), now() + interval '1 day') on conflict (cache_key) do update set failure_code = 'NO_ROUTE', distance_meters = null, duration_seconds = null, expires_at = excluded.expires_at", [bad.key]);
    await query("insert into route_estimates (cache_key, distance_meters, duration_seconds, fetched_at, expires_at) values ($1, 9250, 1500, now(), now() + interval '7 days') on conflict (cache_key) do update set failure_code = null, distance_meters = 9250, duration_seconds = 1500, expires_at = excluded.expires_at", [good.key]);
  });
});
test.afterAll(async () => {
  if (seeded.length > 0) await db((query) => query("delete from route_estimates where cache_key = any($1)", [seeded]));
});

async function siteQuote(page: Page, to: LatLng): Promise<void> {
  await page.getByLabel("上车地址或酒店名").fill("测试上车点");
  const from = page.getByRole("group", { name: /上车地点的坐标/ });
  await from.getByLabel(/^纬度/).fill(String(pickup.lat));
  await from.getByLabel(/^经度/).fill(String(pickup.lng));
  await page.getByLabel("下车地址或酒店名").fill("测试下车点");
  const dropoff = page.getByRole("group", { name: /下车地点的坐标/ });
  await dropoff.getByLabel(/^纬度/).fill(String(to.lat));
  await dropoff.getByLabel(/^经度/).fill(String(to.lng));
  await page.getByRole("button", { name: "查询价格" }).click();
}

test("官网点对点（只有里程计价的商品）：没有路线时说换个地址，暂时算不出时说稍后再试；不出现原因代码和内部说法；320 / 768 宽、亮暗 axe", async ({ page }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/book");
  await page.getByLabel(/^城市/).selectOption({ label: world.city.name });
  // 这个城市只有点对点一种服务：不出服务的单选，直接是点对点的表单
  await expect(page.getByLabel("下车地址或酒店名")).toBeVisible();
  await page.getByLabel("用车日期（当地）").fill(tomorrowInTokyo());
  await page.getByLabel("上车时间（当地）").fill("10:00");

  await siteQuote(page, noRoute);
  const results = page.getByRole("region", { name: "没有可预订的车" });
  await expect(results).toContainText(GUEST_NO_ROUTE);
  await expect(results).not.toContainText(GUEST_TEMPORARY);
  await expect(page.locator("main")).not.toContainText(/NO_ROUTE|TEMPORARILY|谷歌|密钥|配额|上限|ROUTE_UNAVAILABLE/);
  await expectNarrowAndAccessible(page, "官网：没有路线");

  // 有路线（缓存）：报出价
  await siteQuote(page, cached);
  await expect(page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: world.group.name }) })).toBeVisible();

  // 暂时算不出：服务进程没有配置谷歌密钥（别的用例短暂填了一把时，假谷歌会给出路线——换一组点再试）
  await expect(async () => {
    await siteQuote(page, randomPoint());
    await expect(page.getByRole("region", { name: "没有可预订的车" })).toContainText(GUEST_TEMPORARY, { timeout: 3_000 });
  }).toPass({ timeout: 60_000, intervals: [2_000, 5_000] });
  await expect(page.getByRole("region", { name: "没有可预订的车" })).not.toContainText(GUEST_NO_ROUTE);
  await expect(page.locator("main")).not.toContainText(/NOT_CONFIGURED|TEMPORARILY|谷歌|密钥|配额|上限/);
  await expectNarrowAndAccessible(page, "官网：暂时算不出");
});

test("运营后台报价试算：路程来自缓存 / 起终点重合 / 假定值时写明来源、价格和手算一致；没有路线时警示条给原因码和怎么办；320 / 768 宽、亮暗 axe", async ({ page }) => {
  test.setTimeout(150_000);
  const { email, password } = adminCredentials();
  await loginAs(page, "platform", email, password);
  await page.goto("/platform/quote-preview");
  await expect(page.getByRole("heading", { level: 1, name: "报价试算" })).toBeVisible();
  await choose(page, /城市/, world.city.code);
  await page.getByRole("radio", { name: "点对点" }).check();
  const from = page.getByRole("group", { name: "上车点" });
  await from.getByRole("textbox", { name: /纬度/ }).fill(String(pickup.lat));
  await from.getByRole("textbox", { name: /经度/ }).fill(String(pickup.lng));
  const to = page.getByRole("group", { name: "下车点" });
  const goTo = async (point: LatLng): Promise<void> => {
    await to.getByRole("textbox", { name: /纬度/ }).fill(String(point.lat));
    await to.getByRole("textbox", { name: /经度/ }).fill(String(point.lng));
    await page.getByRole("button", { name: "试算", exact: true }).click();
    await expect(page.getByRole("heading", { level: 2, name: "试算结果" })).toBeFocused();
  };
  await page.getByRole("textbox", { name: "日期" }).fill(tomorrowInTokyo());
  await page.getByRole("textbox", { name: "时刻" }).fill("10:00");
  await page.getByRole("textbox", { name: "人数" }).fill("2");
  await page.getByRole("combobox", { name: "客人支付的币种" }).selectOption("JPY");
  const group = page.locator(".quote-group").filter({ has: page.getByRole("heading", { level: 3, name: world.group.name }) });
  const banner = page.locator(".alert").filter({ hasText: "这次没有取到路线" });

  // 缓存：9,250 米 25 分钟 → 3,000 + 4.25 公里 × 400 + 5 分钟 × 80 = 5,100；路程按四舍五入显示 9.3 公里（M4-12，不截断成 9.2）
  await goTo(cached);
  await expect(page.locator("main")).toContainText("用的路程：9.3 公里、25 分钟（来自缓存，这次没有调用谷歌地图）。");
  await expect(group).toContainText("结算价 JPY 5,100");
  await expect(banner).toHaveCount(0);

  // 起终点在同一个格子：按 0，收起步价
  await goTo({ lat: pickup.lat, lng: pickup.lng });
  await expect(page.locator("main")).toContainText("用的路程：0 公里、0 分钟（起点和终点几乎重合，按 0 计算，没有调用谷歌地图）。");
  await expect(group).toContainText("结算价 JPY 3,000");

  // 没有路线：警示条写出原因码和怎么办，没报出价的表里有这个商品
  await goTo(noRoute);
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("原因码 NO_ROUTE：这两个地点之间没有可行驶的路线（例如隔着海）。请换一组地点。一口价和包车套餐不受影响。");
  await expect(page.locator("main")).not.toContainText("用的路程");
  await expect(page.getByRole("region", { name: "没报出价的商品和原因" })).toContainText("价格是「里程 + 时长」，需要路线预估，而现在取不到");
  await expectNarrowAndAccessible(page, "报价试算：没有路线");

  // 假定值：12 公里 40 分钟 → 3,000 + 7 × 400 + 20 × 80 = 7,400
  await page.getByRole("textbox", { name: "里程（公里）" }).fill("12");
  await page.getByRole("textbox", { name: "时长（分钟）" }).fill("40");
  await page.getByRole("button", { name: "试算", exact: true }).click();
  await expect(page.locator("main")).toContainText("用的路程：12 公里、40 分钟（你填写的假定值）。");
  await expect(group).toContainText("结算价 JPY 7,400");
  await expect(banner).toHaveCount(0);
  await expectNarrowAndAccessible(page, "报价试算：假定值");
});
