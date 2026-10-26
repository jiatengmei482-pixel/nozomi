/**
 * 端到端：官网的地址搜索和地图选点（M3-12，ADR 0044）。真实浏览器 → 前端 → 真实 API（`/site/v1`）→ 真实 PostgreSQL，不 mock 接口；
 * 谷歌是 global-setup 起的本机假服务器（假 Places 对任何关键字都给「東京駅」，假 Geocoding 给一个固定地址），**从不调用真实的谷歌**。
 * 用的是地址搜索专用的那组 API 和前端（配置文件里有假密钥，见 playwright.config.ts 的 E2E_API_PLACES_PORT）。
 *
 * 供应商经接口上架一个点对点商品（一口价 15,000 日元，营运区是城市中心 ±0.1 度）。客人：
 * - 上车点搜索「東京駅」→ 选中 → 地址和坐标填好；下车点在地图上用键盘（方向键）移动后选「地图中间这个位置」→ 反查地址填好 → 询价成功；
 * - 再把上车点在地图上点到营运区外 → 询价显示「不在服务范围内」。
 * 浏览器只连本站和底图（不连谷歌）；320 / 360 / 768 宽不横向滚动，亮暗两色 axe。
 */
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { E2E_TILE_PORT, E2E_WEB_PLACES_PORT } from "../playwright.config.ts";
import { CENTER, type Supplier, type World, createProductByApi, createSupplier, createWorld, expectAccessible } from "./catalog.ts";

const SITE = `http://127.0.0.1:${E2E_WEB_PLACES_PORT}`;
const TILE_ORIGIN = `http://127.0.0.1:${E2E_TILE_PORT}`;
const RULES = {
  booking: { sale_from: null, sale_to: null, service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 0, note: null },
  urgent: { enabled: false, daily_quota: null, tiers: [] },
  night: { enabled: false, window: null, amount: null, charge_unit: null },
  free_wait: { pickup: null, dropoff: null, general: { mode: "limited", minutes: 30 } },
  addons: [],
  driver_languages: [],
};
const EMPTY_PRICE = { direction: null, package_hours: null, start_price: null, start_meters: null, start_minutes: null, per_km: null, per_minute: null, min_price: null, package_km: null, package_price: null, overtime_per_hour: null, over_km_per_km: null, base_price: null };

async function publishPointToPoint(request: APIRequestContext, supplier: Supplier, world: World): Promise<void> {
  const product = await createProductByApi(request, supplier, world, "point_to_point");
  const rules = await request.put(`/tenant/v1/products/${product.id}/service-rules`, { headers: { ...supplier.headers, "if-match": `"${product.version}"` }, data: RULES });
  expect(rules.status(), await rules.text()).toBe(200);
  const content = await request.put(`/tenant/v1/products/${product.id}/content`, { headers: { ...supplier.headers, "if-match": `"${((await rules.json()) as { version: number }).version}"` }, data: { zh: { title: "官网市内用车" } } });
  expect(content.status(), await content.text()).toBe(200);
  const { today } = (await (await request.get(`/tenant/v1/products/${product.id}/price-rules`, { headers: supplier.headers })).json()) as { today: string };
  const version = ((await (await request.get(`/tenant/v1/products/${product.id}`, { headers: supplier.headers })).json()) as { version: number }).version;
  const created = await request.post(`/tenant/v1/products/${product.id}/price-rules/batch`, {
    headers: { ...supplier.headers, "if-match": `"${version}"`, "idempotency-key": crypto.randomUUID() },
    data: { create: [{ ...EMPTY_PRICE, ref: "a", area_id: supplier.area.id, vehicle_group_id: world.group.id, valid_from: today, valid_to: null, status: "enabled", pricing_model: "fixed", base_price: 15000 }], update: [], delete: [] },
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
  for (const size of [{ width: 320, height: 640 }, { width: 360, height: 740 }, { width: 768, height: 1024 }]) {
    await page.setViewportSize(size);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${what}：${size.width}px 宽横向溢出`).toBe(0);
  }
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `${what}（${scheme === "light" ? "亮色" : "暗色"}）`);
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize(viewport);
}

const coordinate = (page: Page, word: "上车" | "下车", which: "纬度" | "经度") => page.getByRole("group", { name: new RegExp(`${word}地点的坐标`) }).getByLabel(new RegExp(`^${which}`));

test("官网地址：搜索 → 选中 → 地图上用键盘选下车点 → 报价成功；地图上点到服务区外 → 不在服务范围内；浏览器不连谷歌；窄屏、亮暗 axe", async ({ page, request }) => {
  test.setTimeout(150_000);
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  await publishPointToPoint(request, supplier, world);
  const origins = new Set<string>();
  page.on("request", (sent) => origins.add(new URL(sent.url()).origin));
  await page.setViewportSize({ width: 400, height: 800 });

  await page.goto(`${SITE}/book`);
  await expect(page.getByRole("heading", { level: 1, name: "预订用车" })).toBeVisible();
  await page.getByLabel(/^城市/).selectOption({ label: world.city.name });

  // 上车点：搜索（回车是搜索），选中后地址、坐标填好
  const search = page.getByRole("searchbox", { name: "搜索上车地点（选填）" });
  await search.fill("東京駅 丸の内");
  await search.press("Enter");
  const results = page.getByRole("list", { name: "搜索到的上车地点" });
  await expect(results.getByRole("button", { name: /東京駅/ })).toBeVisible();
  await expect(page.getByText("有几项没有填好，请看标红的地方。")).toHaveCount(0);
  await expectNarrowAndAccessible(page, "询价页（搜索结果）");
  await results.getByRole("button", { name: /東京駅/ }).click();
  await expect(page.getByLabel("上车地址或酒店名")).toHaveValue("東京駅（日本、〒100-0005 東京都千代田区丸の内１丁目）");
  await expect(coordinate(page, "上车", "纬度")).toHaveValue("35.6812");
  await expect(coordinate(page, "上车", "经度")).toHaveValue("139.7671");

  // 下车点：地图（默认收起）→ 不用鼠标：聚焦地图、方向键移动、选中间的位置 → 反查的地址填进地址栏
  const toggle = page.getByRole("button", { name: "在地图上选下车地点" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.focus();
  await page.keyboard.press("Enter");
  const map = page.getByRole("application", { name: /地图：点一下选下车位置/ });
  await expect(map).toBeVisible();
  await expect(page.getByText("© 端到端测试底图")).toBeVisible();
  await map.focus();
  await page.keyboard.press("ArrowDown");
  await page.getByRole("button", { name: "选地图中间这个位置" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("已填入这个位置的地址和坐标，可以在地址后面补充酒店名、楼层。")).toBeVisible();
  await expect(page.getByLabel("下车地址或酒店名")).toHaveValue("日本、〒100-0005 東京都千代田区丸の内１丁目９");
  const lat = Number(await coordinate(page, "下车", "纬度").inputValue());
  const lng = Number(await coordinate(page, "下车", "经度").inputValue());
  expect(lat, "方向键往下移动了地图").toBeLessThan(CENTER.lat);
  expect(Math.abs(lng - CENTER.lng)).toBeLessThan(0.01);
  await expectNarrowAndAccessible(page, "询价页（地图展开）");

  await page.getByLabel("用车日期（当地）").fill(tomorrowInTokyo());
  await page.getByLabel("上车时间（当地）").fill("10:00");
  await page.getByRole("button", { name: "查询价格" }).click();
  const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: world.group.name }) });
  await expect(card).toContainText("16,500 JPY");

  // 上车点在地图上点到营运区外（营运区是中心 ±0.1 度；缩小两级后点地图右边缘，约 20 公里外）→ 不在服务范围内
  await page.getByRole("button", { name: "在地图上选上车地点" }).click();
  const pickupMap = page.getByRole("application", { name: /地图：点一下选上车位置/ });
  await pickupMap.scrollIntoViewIfNeeded();
  const pickupMapGroup = page.getByRole("group", { name: "上车地点的地图" });
  const zoomOut = pickupMapGroup.getByRole("button", { name: "缩小地图" });
  await zoomOut.click();
  await zoomOut.click();
  await zoomOut.click();
  const box = await pickupMap.boundingBox();
  if (box === null) throw new Error("地图没有显示出来");
  await page.mouse.click(box.x + box.width - 12, box.y + box.height / 2);
  await expect(pickupMapGroup.getByText("已填入这个位置的地址和坐标，可以在地址后面补充酒店名、楼层。")).toBeVisible();
  expect(Number(await coordinate(page, "上车", "经度").inputValue())).toBeGreaterThan(CENTER.lng + 0.1);
  await page.getByRole("button", { name: "查询价格" }).click();
  await expect(page.getByRole("heading", { name: "没有可预订的车" })).toBeVisible();
  await expect(page.locator("main")).toContainText("这个地址不在服务范围内，请换一个更靠近市区的地址。");
  await expectNarrowAndAccessible(page, "询价结果（服务区外）");

  // 浏览器只连本站和底图：不连谷歌，也没有别的站外来源
  expect([...origins].filter((origin) => origin !== SITE && origin !== TILE_ORIGIN)).toEqual([]);
});
