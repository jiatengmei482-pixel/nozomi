/**
 * 端到端（测试角色补充，M3-11，pages/site-booking.md 第 8、10 节和 11.2 节）：真实浏览器 → 前端 → 真实 API → 真实 PostgreSQL。
 * - 320 / 360 / 768 宽都不横向滚动：询价页、订单页（待付款带「需要帮助」、「我已落地」排第一、取消确认展开、改单表单多项出错）；
 * - 顶栏（F10）：320 两行（品牌、主题在第一行，入口在第二行），480、768 一行，从左到右是品牌 → 主题 → 入口（和 Tab 顺序一致）；
 * - 上面每个状态在 320 和 768 宽、亮暗两色都过 axe；
 * - 官网崩溃兜底页（F3）在 320 不横向滚动、两色过 axe（只把订单接口的应答换成缺字段的，触发前端异常）。
 * 订单经 /site/v1 下，付款用迁移账号在本次运行的临时 schema 里直接记成已付款（同 site-booking.spec.ts 的支付替身）。
 */
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { createPool } from "../../api/src/db/pool.ts";
import { CENTER, type Supplier, type World, createProductByApi, createSupplier, createWorld, expectAccessible } from "./catalog.ts";
import { E2E_SUPPORT_PHONE } from "./support.ts";

const RULES = {
  booking: { sale_from: null, sale_to: null, service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 0, note: null },
  urgent: { enabled: false, daily_quota: null, tiers: [] },
  night: { enabled: false, window: null, amount: null, charge_unit: null },
  free_wait: { pickup: { mode: "limited", minutes: 60 }, dropoff: { mode: "limited", minutes: 60 }, general: null },
  addons: [],
  driver_languages: [],
};

const WIDTHS = [
  { width: 320, height: 640 },
  { width: 360, height: 740 },
  { width: 768, height: 1024 },
] as const;

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

/** 东京的「现在 + N 小时」（取整到 5 分钟），当地 `YYYY-MM-DDTHH:mm`。 */
function tokyoLocalIn(hours: number): string {
  const at = new Date(Math.ceil((Date.now() + hours * 3_600_000) / 300_000) * 300_000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at).map((part) => [part.type, part.value]));
  return `${parts["year"]}-${parts["month"]}-${parts["day"]}T${parts["hour"]}:${parts["minute"]}`;
}

/** 经 /site/v1 下一张接机单（用车在东京的「现在 + 2 小时」：付款后马上能点「我已落地」），返回订单号和查看令牌。 */
async function placeSiteOrder(request: APIRequestContext, world: World): Promise<{ orderNo: string; token: string }> {
  const quoted = await request.post("/site/v1/quotes", { data: { city_id: world.city.id, airport_id: world.airport.id, direction: "pickup", address: { lat: CENTER.lat + 0.01, lng: CENTER.lng + 0.01 }, service_local: tokyoLocalIn(2), passengers: 1, luggage: 0 } });
  expect(quoted.status(), await quoted.text()).toBe(200);
  const quote = ((await quoted.json()) as { quotes: { quote_id: string; vehicle_group: { id: string } }[] }).quotes.find((q) => q.vehicle_group.id === world.group.id);
  expect(quote, "报出了这个车型组的价").toBeTruthy();
  const passenger = { name: "Alexandria Konstantinopoulou-Montgomery", phone: "+81 90-1234-5678", email: `${"polish.qa.long.mailbox".padEnd(48, "x")}-${crypto.randomUUID().slice(0, 8)}@subdomain.e2e-overflow.example.com` };
  const created = await request.post("/site/v1/orders", { headers: { "idempotency-key": crypto.randomUUID() }, data: { quote_id: quote?.quote_id, passenger, flight_no: "NH211", dropoff_address: "东京都新宿区西新宿二丁目八番一号 东京都厅第一本厅舍 南侧出租车停靠站", save_payment_method: true } });
  expect(created.status(), await created.text()).toBe(201);
  const body = (await created.json()) as { order: { order_no: string }; link: { token: string } };
  return { orderNo: body.order.order_no, token: body.link.token };
}

/** 支付替身：把这一单记成「Stripe 通知付款成功、自动确认」之后的样子（只在本次运行的临时 schema 里写）。 */
async function markPaid(orderNo: string): Promise<void> {
  const url = process.env["E2E_DATABASE_OWNER_URL"];
  if (!url) throw new Error("global-setup 没有准备好数据库连接");
  const client = createPool(url, { max: 1 });
  try {
    const order = await client.query<{ tenant_id: string; id: string }>(
      "update orders set status = 'confirmed', confirmed_at = now(), dispatch_due_at = least(service_at, now() + interval '2 hours'), version = version + 1, updated_at = now() where order_no = $1 and status = 'pending_payment' returning tenant_id, id",
      [orderNo],
    );
    const row = order.rows[0];
    if (row === undefined) throw new Error(`没有找到待支付的订单 ${orderNo}`);
    await client.query("insert into order_events (tenant_id, order_id, from_status, to_status, actor, reason, occurred_at) values ($1, $2, 'pending_payment', 'confirmed', 'payment', 'PAYMENT_SUCCEEDED', now())", [row.tenant_id, row.id]);
    await client.query("update order_payments set status = 'succeeded', intent_id = 'pi_e2e_' || replace($1::text, '-', ''), succeeded_at = now(), updated_at = now() where order_id = $1 and kind = 'order'", [row.id]);
  } finally {
    await client.end();
  }
}

async function expectNoOverflow(page: Page, what: string): Promise<void> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  for (const size of WIDTHS) {
    await page.setViewportSize(size);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${what}：${size.width}px 宽横向溢出 ${overflow}px`).toBe(0);
  }
  await page.setViewportSize(viewport);
}

/** 320 和 768 宽、亮暗两色各过一遍 axe。 */
async function expectAccessibleNarrowAndWide(page: Page, what: string): Promise<void> {
  const viewport = page.viewportSize() ?? { width: 1280, height: 800 };
  for (const size of [WIDTHS[0], WIDTHS[2]]) {
    await page.setViewportSize(size);
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expectAccessible(page, `${what}（${size.width}px，${scheme === "light" ? "亮色" : "暗色"}）`);
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize(viewport);
}

type Box = { x: number; y: number; width: number; height: number };
const sameRow = (a: Box, b: Box): boolean => a.y < b.y + b.height && b.y < a.y + a.height;

/** 顶栏三块的位置（F10）。 */
async function headerBoxes(page: Page): Promise<{ brand: Box; theme: Box; nav: Box }> {
  const brand = await page.locator(".site__brand").boundingBox();
  const theme = await page.getByRole("button", { name: "切换主题" }).boundingBox();
  const nav = await page.getByRole("navigation", { name: "官网" }).boundingBox();
  if (brand === null || theme === null || nav === null) throw new Error("顶栏没有显示出来");
  return { brand, theme, nav };
}

test("F10：顶栏在 320 两行、480 和 768 一行；各宽度从左到右、从上到下的顺序都和 Tab 顺序（品牌 → 主题 → 入口）一致", async ({ page }) => {
  await page.goto("/book");
  await expect(page.getByRole("heading", { level: 1, name: "预订用车" })).toBeVisible();

  await page.setViewportSize({ width: 320, height: 640 });
  const narrow = await headerBoxes(page);
  expect(sameRow(narrow.brand, narrow.theme), "320：品牌和主题同一行").toBe(true);
  expect(narrow.nav.y, "320：入口在第二行").toBeGreaterThanOrEqual(Math.max(narrow.brand.y + narrow.brand.height, narrow.theme.y + narrow.theme.height) - 1);

  for (const width of [480, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    const { brand, theme, nav } = await headerBoxes(page);
    expect(sameRow(brand, theme) && sameRow(theme, nav), `${width}：一行`).toBe(true);
    expect(brand.x + brand.width, `${width}：品牌在最左`).toBeLessThanOrEqual(theme.x);
    expect(theme.x + theme.width, `${width}：主题在入口左边（DOM 顺序在前）`).toBeLessThanOrEqual(nav.x);
    expect(nav.x + nav.width, `${width}：入口不超出视口`).toBeLessThanOrEqual(width);
  }

  // Tab 顺序：从页面开头按 Tab，依次是品牌、主题、两个入口
  await page.setViewportSize({ width: 320, height: 640 });
  await page.locator("body").focus();
  const order: string[] = [];
  for (let index = 0; index < 4; index += 1) {
    await page.keyboard.press("Tab");
    order.push(await page.evaluate(() => (document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent ?? "").trim()));
  }
  expect(order).toEqual(["NOZOMI 用车", "切换主题", "预订用车", "查订单"]);
  await expectNoOverflow(page, "询价页");
  await expectAccessibleNarrowAndWide(page, "询价页");
});

test("订单页在 320 / 360 / 768 宽不横向滚动、两色过 axe：待付款（带「需要帮助」）→ 已付款「我已落地」排第一 → 取消确认展开 → 改单表单多项出错", async ({ page, request }) => {
  test.setTimeout(180_000);
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  await publishedProduct(request, supplier, world);
  const { orderNo, token } = await placeSiteOrder(request, world);

  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(`/book/order#${token}`);
  await expect(page.getByRole("heading", { level: 1, name: `订单 ${orderNo}` })).toBeVisible();
  const help = page.getByRole("link", { name: `打电话给客服 ${E2E_SUPPORT_PHONE}` });
  await expect(help).toBeVisible();
  // 电话按钮在 320 宽整个在视口里（没有被挤出右边）
  const helpBox = await help.boundingBox();
  expect(helpBox === null ? Number.POSITIVE_INFINITY : helpBox.x + helpBox.width, "电话按钮在 320 宽内").toBeLessThanOrEqual(320);
  await expectNoOverflow(page, "订单页（待付款、需要帮助）");
  await expectAccessibleNarrowAndWide(page, "订单页（待付款、需要帮助）");

  await markPaid(orderNo);
  await page.reload();
  await expect(page.getByText("已确认", { exact: true })).toBeVisible();
  expect(((await page.locator("main h2").first().textContent()) ?? "").trim()).toBe("航班落地");
  await expectNoOverflow(page, "订单页（已付款、「我已落地」排第一）");
  await expectAccessibleNarrowAndWide(page, "订单页（已付款、「我已落地」排第一）");

  await page.getByRole("button", { name: "取消订单" }).click();
  await expect(page.getByRole("group", { name: "确认取消订单" })).toContainText("按取消政策");
  await expectNoOverflow(page, "订单页（取消确认展开）");
  await expectAccessibleNarrowAndWide(page, "订单页（取消确认展开）");
  await page.getByRole("button", { name: "不取消了" }).click();

  await page.getByRole("button", { name: "修改订单" }).click();
  await page.getByLabel("乘车人姓名").fill("");
  await page.getByLabel("手机号（带国家码）").fill("090-1234-5678");
  await page.getByLabel("邮箱").fill("not-an-email");
  await page.getByLabel("航班号").fill("N");
  await page.getByLabel("下车地址或酒店名").fill(" ");
  await page.getByLabel("人数").fill("0");
  await page.getByRole("button", { name: "提交修改" }).click();
  await expect(page.getByText("有几项没有填好，请看标红的地方。")).toBeVisible();
  for (const label of ["乘车人姓名", "手机号（带国家码）", "邮箱", "航班号", "下车地址或酒店名", "人数"]) {
    await expect(page.getByLabel(label), label).toHaveAttribute("aria-invalid", "true");
  }
  await expect(page.getByLabel("行李（件）"), "没改的行李不标红").not.toHaveAttribute("aria-invalid", "true");
  await expectNoOverflow(page, "订单页（改单表单多项出错）");
  await expectAccessibleNarrowAndWide(page, "订单页（改单表单多项出错）");
});

test("F3：官网崩溃兜底页在 320 / 360 / 768 宽不横向滚动、两色过 axe，不提管理员", async ({ page }) => {
  const token = `nzo_${"C".repeat(43)}`;
  // 只把订单接口的应答换成缺乘车人的订单，让前端渲染时抛异常
  await page.route("**/site/v1/order", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        order: { order_no: "NZ20261026CRASH234", status: "confirmed", direction: "pickup", timezone: "Asia/Tokyo", service_local: "2030-11-20T10:00", changes: [], extra_charges: [], landing: null },
        timeline: [],
        names: { city: null, place: null, vehicle_group: null },
      }),
    }),
  );
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto(`/book/order#${token}`);
  await expect(page.getByRole("heading", { level: 1, name: "页面出了点问题" })).toBeVisible();
  await expect(page.getByText("请刷新重试。您的订单不受影响，可以随时在「查订单」里找到。")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("管理员");
  await expectNoOverflow(page, "崩溃兜底页");
  await expectAccessibleNarrowAndWide(page, "崩溃兜底页");
});
