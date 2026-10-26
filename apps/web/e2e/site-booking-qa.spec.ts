/**
 * 端到端（测试角色补充，M3-05，ADR 0032）：真实浏览器 → 前端 → 真实 API → 真实 PostgreSQL。
 * - 查看令牌在 # 后面：浏览器发出的每一个请求（地址、Referer 和其余请求头）都不含令牌，只有订单接口的 Authorization 带它；
 *   页面不请求站外地址；令牌不进 local / sessionStorage、页面标题；
 * - 很长的邮箱、地址在 320px 宽的订单页上不横向滚动；链接失效后的「查订单」在 320px、亮暗两色都过 axe。
 * 订单经 /site/v1 接口下（和页面同一个接口），测试数据都在本次运行的临时 schema 里。
 */
import { type APIRequestContext, type Page, type Request, expect, test } from "@playwright/test";
import { CENTER, type Supplier, type World, createProductByApi, createSupplier, createWorld, expectAccessible } from "./catalog.ts";

const RULES = {
  booking: { sale_from: null, sale_to: null, service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 0, note: null },
  urgent: { enabled: false, daily_quota: null, tiers: [] },
  night: { enabled: false, window: null, amount: null, charge_unit: null },
  free_wait: { pickup: { mode: "limited", minutes: 60 }, dropoff: { mode: "limited", minutes: 60 }, general: null },
  addons: [],
  driver_languages: [],
};

async function version(request: APIRequestContext, supplier: Supplier, id: string): Promise<number> {
  return ((await (await request.get(`/tenant/v1/products/${id}`, { headers: supplier.headers })).json()) as { version: number }).version;
}

async function publishedProduct(request: APIRequestContext, supplier: Supplier, world: World): Promise<void> {
  const product = await createProductByApi(request, supplier, world, "airport_transfer");
  const rules = await request.put(`/tenant/v1/products/${product.id}/service-rules`, { headers: { ...supplier.headers, "if-match": `"${product.version}"` }, data: RULES });
  expect(rules.status(), await rules.text()).toBe(200);
  const content = await request.put(`/tenant/v1/products/${product.id}/content`, { headers: { ...supplier.headers, "if-match": `"${((await rules.json()) as { version: number }).version}"` }, data: { zh: { title: "官网接送机", pickup_guide: "到达大厅 2 号出口" } } });
  expect(content.status(), await content.text()).toBe(200);
  const { today } = (await (await request.get(`/tenant/v1/products/${product.id}/price-rules`, { headers: supplier.headers })).json()) as { today: string };
  const price = await request.post(`/tenant/v1/products/${product.id}/price-rules/batch`, {
    headers: { ...supplier.headers, "if-match": `"${await version(request, supplier, product.id)}"`, "idempotency-key": crypto.randomUUID() },
    data: { create: [{ ref: "a", area_id: supplier.area.id, vehicle_group_id: world.group.id, direction: "both", package_hours: null, pricing_model: "fixed", base_price: 20000, start_price: null, start_meters: null, start_minutes: null, per_km: null, per_minute: null, min_price: null, package_km: null, package_price: null, overtime_per_hour: null, over_km_per_km: null, valid_from: today, valid_to: null, status: "enabled" }], update: [], delete: [] },
  });
  expect(price.status(), await price.text()).toBe(200);
  const published = await request.post(`/tenant/v1/products/${product.id}/publish`, { headers: supplier.headers });
  expect(published.status(), await published.text()).toBe(200);
}

/** 东京的「现在 + 5 小时」，当地 `YYYY-MM-DDTHH:mm`。 */
function tokyoLocalIn(hours: number): string {
  const at = new Date(Math.ceil((Date.now() + hours * 3_600_000) / 300_000) * 300_000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at).map((part) => [part.type, part.value]));
  return `${parts["year"]}-${parts["month"]}-${parts["day"]}T${parts["hour"]}:${parts["minute"]}`;
}

/** 经 /site/v1 下一张接机单，返回订单号和查看令牌。 */
async function placeSiteOrder(request: APIRequestContext, world: World, passenger: { name: string; phone: string; email: string }, address: string): Promise<{ orderNo: string; token: string }> {
  const quoted = await request.post("/site/v1/quotes", { data: { city_id: world.city.id, airport_id: world.airport.id, direction: "pickup", address: { lat: CENTER.lat + 0.01, lng: CENTER.lng + 0.01 }, service_local: tokyoLocalIn(5), passengers: 1, luggage: 0 } });
  expect(quoted.status(), await quoted.text()).toBe(200);
  const quote = ((await quoted.json()) as { quotes: { quote_id: string; vehicle_group: { id: string } }[] }).quotes.find((q) => q.vehicle_group.id === world.group.id);
  expect(quote, "报出了这个车型组的价").toBeTruthy();
  const created = await request.post("/site/v1/orders", { headers: { "idempotency-key": crypto.randomUUID() }, data: { quote_id: quote?.quote_id, passenger, flight_no: "NH211", dropoff_address: address, save_payment_method: true } });
  expect(created.status(), await created.text()).toBe(201);
  const body = (await created.json()) as { order: { order_no: string }; link: { token: string } };
  return { orderNo: body.order.order_no, token: body.link.token };
}

async function expectNoOverflowAt320(page: Page, what: string): Promise<void> {
  await page.setViewportSize({ width: 320, height: 640 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${what}：320px 宽横向溢出 ${overflow}px`).toBe(0);
}

async function expectAccessibleBothThemes(page: Page, what: string): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `${what}（${scheme === "light" ? "亮色" : "暗色"}）`);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

test("查看令牌只在 # 后面和订单接口的 Authorization 里：每个请求的地址、Referer 都没有它；不请求站外地址；不进存储和标题；很长的邮箱在 320px 不横向滚动", async ({ page, request, baseURL }) => {
  test.setTimeout(90_000);
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  await publishedProduct(request, supplier, world);
  const email = `${"guest.with.a.really.long.mailbox.name".padEnd(60, "x")}@subdomain.e2e-overflow-check.example.com`;
  const { orderNo, token } = await placeSiteOrder(request, world, { name: "Alexandria Konstantinopoulou-Montgomery", phone: "+81 90-1234-5678", email }, "东京都新宿区西新宿二丁目八番一号 东京都厅第一本厅舍 南侧出租车停靠站");
  const secret = token.slice(4);

  const seen: Request[] = [];
  page.on("request", (req) => void seen.push(req));
  await page.setViewportSize({ width: 400, height: 800 });
  await page.goto(`/book/order#${token}`);
  await expect(page.getByRole("heading", { level: 1, name: `订单 ${orderNo}` })).toBeVisible();
  // 站内跳转再回来：来源页（Referer）是带 # 的订单页
  await page.getByRole("link", { name: "预订接送机" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "预订接送机" })).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { level: 1, name: `订单 ${orderNo}` })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: `订单 ${orderNo}` })).toBeVisible();
  await page.getByRole("button", { name: "取消订单" }).click();
  await expect(page.getByRole("group", { name: "确认取消订单" })).toContainText(/取消/);
  await page.getByRole("button", { name: "不取消了" }).click();

  const origin = new URL(baseURL ?? "http://127.0.0.1").origin;
  const leaks: string[] = [];
  let authorized = 0;
  for (const req of seen) {
    const url = req.url();
    if (url.includes(secret)) leaks.push(`地址：${req.method()} ${url}`);
    if (!url.startsWith("data:") && new URL(url).origin !== origin) leaks.push(`站外请求：${url}`);
    const headers = await req.allHeaders();
    for (const [name, value] of Object.entries(headers)) {
      if (!value.includes(secret)) continue;
      const path = new URL(url).pathname;
      if (name === "authorization" && path.startsWith("/site/v1/order") && !path.startsWith("/site/v1/orders")) authorized += 1;
      else leaks.push(`请求头 ${name}：${req.method()} ${url}`);
    }
    const body = req.postData();
    if (body !== null && body.includes(secret)) leaks.push(`请求体：${req.method()} ${url}`);
  }
  expect(leaks).toEqual([]);
  expect(authorized, "订单接口确实用 Authorization 带了令牌").toBeGreaterThanOrEqual(3);
  // 页面声明了 no-referrer：订单页发出的请求（含站内跳转后的）一律不带来源页
  const referers: string[] = [];
  for (const req of seen) referers.push((await req.allHeaders())["referer"] ?? "");
  expect([...new Set(referers)], "不发 Referer").toEqual([""]);

  const storage = await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, title: document.title, cookie: document.cookie }));
  expect(storage.includes(secret), storage).toBe(false);
  expect(await page.title()).toBe(`订单 ${orderNo} · NOZOMI 用车`);

  await expectNoOverflowAt320(page, "订单页（很长的邮箱和姓名）");
});

test("链接失效时的「查订单」：320px 不横向滚动，亮暗两色 axe；地址里的失效令牌不随后续请求发出", async ({ page }) => {
  const stale = `nzo_${"S".repeat(43)}`;
  const seen: Request[] = [];
  page.on("request", (req) => void seen.push(req));
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(`/book/order#${stale}`);
  await expect(page.getByText("订单链接无效或已过期，请用订单号和下单时的邮箱或手机号重新查找。")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "查订单" })).toBeVisible();
  await expectNoOverflowAt320(page, "查订单（链接失效）");
  await expectAccessibleBothThemes(page, "查订单（链接失效）");
  await page.getByLabel("订单号").fill("NZ20261026ZZZZZZZZ");
  await page.getByLabel("下单时的邮箱或手机号").fill("nobody@e2e.example.com");
  await page.getByRole("button", { name: "查找订单" }).click();
  await expect(page.getByText("没有找到这张订单：请核对订单号，以及下单时填的邮箱或手机号。")).toBeVisible();
  await expectNoOverflowAt320(page, "查订单（没找到）");
  const lookup = seen.find((req) => new URL(req.url()).pathname === "/site/v1/orders/lookup");
  expect(lookup, "发了找回请求").toBeTruthy();
  const headers = await lookup!.allHeaders();
  expect(JSON.stringify(headers).includes(stale.slice(4)), JSON.stringify(headers)).toBe(false);
  expect((lookup!.postData() ?? "").includes(stale.slice(4))).toBe(false);
});
