/**
 * 端到端：官网订点对点和包车（M3-10）。真实浏览器 → 前端 → 真实 API（`/site/v1`）→ 真实 PostgreSQL，不 mock 接口。
 * 供应商经接口上架一个点对点商品（一口价 15,000 日元）和一个包车商品（8 小时 70,000 日元、含 150 公里）；平台在城市里建一个车站（常用地点）。
 * 客人在 /book 选服务 → 上车点从常用地点里选、下车点自己写 → 询价 → 选车 → 填订单 → 订单页看到这一单的行程（端到端没有 Stripe，订单待付款）。
 * 每一步在 320 / 360 / 400 宽不横向滚动，亮色、暗色各过一遍 axe。
 */
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { CENTER, type Supplier, type World, createProductByApi, createSupplier, createWorld, expectAccessible } from "./catalog.ts";
import { platformAdminHeaders, randomLetters } from "./support.ts";

const RULES = {
  booking: { sale_from: null, sale_to: null, service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 0, note: null },
  urgent: { enabled: false, daily_quota: null, tiers: [] },
  night: { enabled: false, window: null, amount: null, charge_unit: null },
  free_wait: { pickup: null, dropoff: null, general: { mode: "limited", minutes: 30 } },
  addons: [],
  driver_languages: [],
};

/** 常用地点（车站）的坐标：在区域里，离城市中心不远 */
const STATION = { lat: 35.6945, lng: 139.6967 };

const EMPTY_PRICE = { direction: null, package_hours: null, start_price: null, start_meters: null, start_minutes: null, per_km: null, per_minute: null, min_price: null, package_km: null, package_price: null, overtime_per_hour: null, over_km_per_km: null, base_price: null };

async function version(request: APIRequestContext, supplier: Supplier, id: string): Promise<number> {
  return ((await (await request.get(`/tenant/v1/products/${id}`, { headers: supplier.headers })).json()) as { version: number }).version;
}

/** 经供应商接口配好、上架的点对点或包车商品：全天可订、不要提前量，价格从城市当地的今天起生效。 */
async function publishedProduct(request: APIRequestContext, supplier: Supplier, world: World, category: "point_to_point" | "charter", price: Record<string, unknown>): Promise<void> {
  const product = await createProductByApi(request, supplier, world, category);
  const rules = await request.put(`/tenant/v1/products/${product.id}/service-rules`, { headers: { ...supplier.headers, "if-match": `"${product.version}"` }, data: RULES });
  expect(rules.status(), await rules.text()).toBe(200);
  const content = await request.put(`/tenant/v1/products/${product.id}/content`, { headers: { ...supplier.headers, "if-match": `"${((await rules.json()) as { version: number }).version}"` }, data: { zh: { title: category === "charter" ? "官网包车" : "官网市内用车" } } });
  expect(content.status(), await content.text()).toBe(200);
  const { today } = (await (await request.get(`/tenant/v1/products/${product.id}/price-rules`, { headers: supplier.headers })).json()) as { today: string };
  const created = await request.post(`/tenant/v1/products/${product.id}/price-rules/batch`, {
    headers: { ...supplier.headers, "if-match": `"${await version(request, supplier, product.id)}"`, "idempotency-key": crypto.randomUUID() },
    data: { create: [{ ...EMPTY_PRICE, ref: "a", area_id: supplier.area.id, vehicle_group_id: world.group.id, valid_from: today, valid_to: null, status: "enabled", ...price }], update: [], delete: [] },
  });
  expect(created.status(), await created.text()).toBe(200);
  const published = await request.post(`/tenant/v1/products/${product.id}/publish`, { headers: supplier.headers });
  expect(published.status(), await published.text()).toBe(200);
}

/** 平台在城市里建一个车站：官网的「常用地点」里能选到它。 */
async function createStation(request: APIRequestContext, world: World): Promise<string> {
  const name = `望站${randomLetters(4)}`;
  const response = await request.post("/platform/v1/master/places", {
    headers: await platformAdminHeaders(request),
    data: { type: "station", code: `STN-JP-${randomLetters(6)}`, city_id: world.city.id, category: "rail", name: { zh: name }, location: STATION },
  });
  expect(response.status(), await response.text()).toBe(201);
  return name;
}

/** 东京的明天 10:00。 */
function tomorrowInTokyo(): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(Date.now() + 24 * 3_600_000)).map((part) => [part.type, part.value]));
  return `${parts["year"]}-${parts["month"]}-${parts["day"]}`;
}

async function expectNoOverflow(page: Page, what: string): Promise<void> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  for (const size of [{ width: 320, height: 640 }, { width: 360, height: 740 }, { width: 400, height: 800 }]) {
    await page.setViewportSize(size);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${what}：${size.width}px 宽横向溢出`).toBe(0);
  }
  await page.setViewportSize(viewport);
}

async function expectAccessibleBothThemes(page: Page, what: string): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `${what}（${scheme === "light" ? "亮色" : "暗色"}）`);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

async function fillCheckout(page: Page, email: string): Promise<string> {
  await expect(page.getByRole("heading", { level: 1, name: "填写订单" })).toBeVisible();
  await expect(page.getByLabel(/^航班号/)).toHaveCount(0);
  await page.getByLabel("乘车人姓名").fill("陈小红");
  await page.getByLabel("手机号（带国家码）").fill("+81 90-2222-3333");
  await page.getByLabel("邮箱").fill(email);
  await page.getByRole("checkbox", { name: /同意保存/ }).check();
  await expectNoOverflow(page, "下单页");
  await page.getByRole("button", { name: /提交订单/ }).click();
  const heading = page.getByRole("heading", { level: 1, name: /^订单 NZ/ });
  await expect(heading).toBeVisible();
  await expect(page.getByText("待付款", { exact: true })).toBeVisible();
  return ((await heading.textContent()) ?? "").replace("订单 ", "").trim();
}

test("官网点对点、包车：选服务 → 上车点从常用地点里选 → 询价 → 下单 → 订单页按服务显示行程；没有供应商和结算价", async ({ page, request }) => {
  test.setTimeout(150_000);
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  await publishedProduct(request, supplier, world, "point_to_point", { pricing_model: "fixed", base_price: 15000 });
  await publishedProduct(request, supplier, world, "charter", { pricing_model: "charter_package", package_hours: 8, package_km: 150, package_price: 70000, overtime_per_hour: 5000, over_km_per_km: 400 });
  const station = await createStation(request, world);
  const date = tomorrowInTokyo();
  await page.setViewportSize({ width: 400, height: 800 });

  // 点对点
  await page.goto("/book");
  await expect(page.getByRole("heading", { level: 1, name: "预订用车" })).toBeVisible();
  await page.getByLabel(/^城市/).selectOption({ label: world.city.name });
  const services = page.getByRole("group", { name: /服务/ });
  await expect(services.getByRole("radio")).toHaveCount(2);
  await services.getByRole("radio", { name: /点对点/ }).check();
  await expect(page.getByLabel(/^机场/)).toHaveCount(0);
  const pickupPicker = page.getByRole("combobox", { name: "从常用地点选上车地点（选填）" });
  await pickupPicker.fill(station);
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("上车地址或酒店名")).toHaveValue(station);
  await expect(page.getByRole("group", { name: /上车地点的坐标/ }).getByLabel(/^纬度/)).toHaveValue(String(STATION.lat));
  await page.getByLabel("下车地址或酒店名").fill("新宿站南口");
  const dropoff = page.getByRole("group", { name: /下车地点的坐标/ });
  await dropoff.getByLabel(/^纬度/).fill(String(CENTER.lat + 0.01));
  await dropoff.getByLabel(/^经度/).fill(String(CENTER.lng + 0.01));
  await page.getByLabel("用车日期（当地）").fill(date);
  await page.getByLabel("上车时间（当地）").fill("10:00");
  await expectNoOverflow(page, "询价页（点对点）");
  await expectAccessibleBothThemes(page, "询价页（点对点）");
  await page.getByRole("button", { name: "查询价格" }).click();
  const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: world.group.name }) });
  await expect(card).toContainText("16,500 JPY");
  await expect(card).toContainText("30 分钟（从约定的上车时间起算）");
  await expect(page.locator("main")).not.toContainText(/结算|加价|供应商|15,000/);
  await expectNoOverflow(page, "询价结果（点对点）");
  await card.getByRole("button", { name: `预订${world.group.name}` }).click();
  await expect(page.locator("main")).toContainText(`${station} → 新宿站南口`);
  await expect(page.getByLabel("上车地址或酒店名")).toHaveValue(station);
  await expect(page.getByLabel("下车地址或酒店名")).toHaveValue("新宿站南口");
  await expectAccessibleBothThemes(page, "下单页（点对点）");
  await fillCheckout(page, `p2p-${crypto.randomUUID().slice(0, 8)}@e2e.example.com`);
  const trip = page.getByRole("region", { name: "行程" });
  await expect(trip).toContainText("点对点");
  await expect(trip).toContainText(`${station} → 新宿站南口`);
  await expect(page.getByRole("button", { name: "我已落地" })).toHaveCount(0);
  await expectNoOverflow(page, "订单页（点对点）");
  await expectAccessibleBothThemes(page, "订单页（点对点）");

  // 包车
  await page.goto("/book");
  await page.getByLabel(/^城市/).selectOption({ label: world.city.name });
  await page.getByRole("group", { name: /服务/ }).getByRole("radio", { name: /包车/ }).check();
  await expect(page.getByLabel(/^包车时长/)).toHaveValue("8");
  await expect(page.getByLabel("下车地址或酒店名")).toHaveCount(0);
  await page.getByRole("combobox", { name: "从常用地点选上车地点（选填）" }).fill(station);
  await page.keyboard.press("Enter");
  await page.getByLabel("用车日期（当地）").fill(date);
  await page.getByLabel("上车时间（当地）").fill("09:00");
  await expectAccessibleBothThemes(page, "询价页（包车）");
  await page.getByRole("button", { name: "查询价格" }).click();
  const charter = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: world.group.name }) });
  await expect(charter).toContainText("77,000 JPY");
  await expect(charter).toContainText("8 小时，含 150 公里");
  await expect(page.locator("main")).toContainText("超出套餐的时长和公里、高速费、停车费服务后按实际收取");
  await expect(page.locator("main")).not.toContainText(/结算|加价|供应商|70,000/);
  await expectNoOverflow(page, "询价结果（包车）");
  await expectAccessibleBothThemes(page, "询价结果（包车）");
  await charter.getByRole("button", { name: `预订${world.group.name}` }).click();
  await expect(page.locator("main")).toContainText("8 小时，含 150 公里");
  await expect(page.getByLabel("下车地址或酒店名")).toHaveCount(0);
  await fillCheckout(page, `charter-${crypto.randomUUID().slice(0, 8)}@e2e.example.com`);
  const charterTrip = page.getByRole("region", { name: "行程" });
  await expect(charterTrip).toContainText("8 小时");
  await expect(charterTrip).toContainText(station);
  await expectNoOverflow(page, "订单页（包车）");
  await expectAccessibleBothThemes(page, "订单页（包车）");
});
