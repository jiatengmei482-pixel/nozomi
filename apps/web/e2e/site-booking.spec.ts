/**
 * 端到端：官网下单（M3-05，ADR 0032）。真实浏览器 → 前端 → 真实 API（`/site/v1`，官网的渠道和 API 客户端由 global-setup 经运营后台接口建好）→ 真实 PostgreSQL，不 mock 接口。
 * 客人在 /book 询价（日期时间按东京的「现在」往后推）→ 选车 → 填订单 → 订单页：端到端测试里没有 Stripe，页面写「付款暂未开放」、订单待支付；
 * 「付款」由用例用迁移账号直接在库里把这一单记成已付款、已确认（支付替身：等同于收到 Stripe 的付款成功通知，只在测试里构造）→ 刷新后点「我已落地」（验收标准）。
 * 另外用订单号 + 邮箱找回订单；每一步在 320 / 360 / 400 宽不横向滚动，亮色、暗色各过一遍 axe。
 */
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { createPool } from "../../api/src/db/pool.ts";
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

/** 经供应商接口配好、上架的接送机商品：一口价 20,000 日元，从城市当地的今天起生效，全天可订、不要提前量。 */
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

/** 东京的「现在 + 两小时」（取整到 5 分钟）：离计划到达不到 3 小时，付款后马上就能点「我已落地」。 */
function serviceTimeInTokyo(): { date: string; time: string } {
  const at = new Date(Math.ceil((Date.now() + 2 * 3_600_000) / 300_000) * 300_000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at).map((part) => [part.type, part.value]));
  return { date: `${parts["year"]}-${parts["month"]}-${parts["day"]}`, time: `${parts["hour"]}:${parts["minute"]}` };
}

/** 支付替身：把这一单记成「Stripe 通知付款成功、自动确认」之后的样子（端到端测试里没有 Stripe；只在本次运行的临时 schema 里写）。 */
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

test("官网：询价 → 选车 → 下单（付款暂未开放，订单待支付）→ 订单页 → 付款后点「我已落地」；用订单号和邮箱找回订单", async ({ page, request, browser }) => {
  test.setTimeout(120_000);
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  await publishedProduct(request, supplier, world);
  const when = serviceTimeInTokyo();
  const email = `guest-${crypto.randomUUID().slice(0, 8)}@e2e.example.com`;
  await page.setViewportSize({ width: 400, height: 800 });

  // 询价
  await page.goto("/book");
  await expect(page.getByRole("heading", { level: 1, name: "预订接送机" })).toBeVisible();
  await expect(page.getByText(/GeoNames/)).toBeVisible();
  await expect(page.getByText(/OurAirports/)).toBeVisible();
  await page.getByLabel(/^城市/).selectOption({ label: world.city.name });
  await expect(page.getByLabel(/^机场/)).toHaveValue(world.airport.id);
  await page.getByLabel("下车地址或酒店名").fill("新宿站南口");
  await page.getByLabel(/^纬度/).fill(String(CENTER.lat + 0.01));
  await page.getByLabel(/^经度/).fill(String(CENTER.lng + 0.01));
  await page.getByLabel("航班到达日期（当地）").fill(when.date);
  await page.getByLabel("航班计划到达时间（当地）").fill(when.time);
  await expectNoOverflow(page, "询价页");
  await expectAccessibleBothThemes(page, "询价页");
  await page.getByRole("button", { name: "查询价格" }).click();
  const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: world.group.name }) });
  await expect(card).toContainText("22,000 JPY");
  await expect(card).toContainText("60 分钟（从航班落地起算）");
  await expect(page.locator("main")).not.toContainText(/结算|加价|供应商|20,000/);
  await expectNoOverflow(page, "询价结果");
  await expectAccessibleBothThemes(page, "询价结果");
  await card.getByRole("button", { name: `预订${world.group.name}` }).click();

  // 下单
  await expect(page.getByRole("heading", { level: 1, name: "填写订单" })).toBeVisible();
  await expect(page.locator("main")).toContainText(`${world.airport.name}（${world.airport.code}） → 新宿站南口`);
  await page.getByRole("button", { name: /提交订单/ }).click();
  await expect(page.getByText("需要同意保存支付方式才能下单")).toBeVisible();
  await page.getByLabel("乘车人姓名").fill("王小明");
  await page.getByLabel("手机号（带国家码）").fill("+81 90-1234-5678");
  await page.getByLabel("邮箱").fill(email);
  await page.getByLabel("航班号").fill("NH 211");
  await page.getByRole("checkbox", { name: /同意保存/ }).check();
  await expectNoOverflow(page, "下单页");
  await expectAccessibleBothThemes(page, "下单页");
  await page.getByRole("button", { name: /提交订单/ }).click();

  // 订单页：待付款，付款暂未开放
  const heading = page.getByRole("heading", { level: 1, name: /^订单 NZ/ });
  await expect(heading).toBeVisible();
  const orderNo = ((await heading.textContent()) ?? "").replace("订单 ", "").trim();
  expect(page.url()).toMatch(/\/book\/order#nzo_/);
  await expect(page.getByText("待付款", { exact: true })).toBeVisible();
  await expect(page.getByText(/付款暂未开放：订单已为您保留到当地时间/)).toBeVisible();
  await expect(page.getByText("已下单，等待付款")).toBeVisible();
  await expect(page.getByText(/付款后，航班落地时可以在这里点「我已落地」/)).toBeVisible();
  await expect(page.getByRole("button", { name: "我已落地" })).toHaveCount(0);
  await expectNoOverflow(page, "订单页（待付款）");
  await expectAccessibleBothThemes(page, "订单页（待付款）");

  // 支付替身：付款成功、自动确认 → 刷新订单页，点「我已落地」
  await markPaid(orderNo);
  await page.reload();
  await expect(page.getByText("已确认", { exact: true })).toBeVisible();
  await expect(page.getByText("付款成功，订单已确认")).toBeVisible();
  await page.getByRole("button", { name: "我已落地" }).click();
  await expect(page.getByText("确认您的航班已经落地？时间按现在记录，提交后不能修改。")).toBeVisible();
  await page.getByRole("button", { name: "确认已落地" }).click();
  await expect(page.getByText(/您已确认落地：当地时间 \d{4}-\d{2}-\d{2} \d{2}:\d{2}。/)).toBeVisible();
  await expect(page.getByRole("button", { name: "我已落地" })).toHaveCount(0);
  await expectNoOverflow(page, "订单页（已落地）");
  await expectAccessibleBothThemes(page, "订单页（已落地）");

  // 取消先看退多少（不真的取消）
  await page.getByRole("button", { name: "取消订单" }).click();
  await expect(page.getByRole("group", { name: "确认取消订单" })).toContainText(/按取消政策，现在取消/);
  await expectAccessibleBothThemes(page, "订单页（确认取消）");
  await page.getByRole("button", { name: "不取消了" }).click();

  // 换一个浏览器上下文：没有链接，用订单号 + 邮箱找回
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await other.setViewportSize({ width: 360, height: 740 });
  await other.goto("/book/order");
  await expect(other.getByRole("heading", { level: 1, name: "查订单" })).toBeVisible();
  await other.getByLabel("订单号").fill(orderNo.toLowerCase());
  await other.getByLabel("下单时的邮箱或手机号").fill("wrong@e2e.example.com");
  await other.getByRole("button", { name: "查找订单" }).click();
  await expect(other.getByText("没有找到这张订单：请核对订单号，以及下单时填的邮箱或手机号。")).toBeVisible();
  await expectNoOverflow(other, "查订单");
  await expectAccessibleBothThemes(other, "查订单");
  await other.getByLabel("下单时的邮箱或手机号").fill(email.toUpperCase());
  await other.getByRole("button", { name: "查找订单" }).click();
  await expect(other.getByRole("heading", { level: 1, name: `订单 ${orderNo}` })).toBeVisible();
  await expect(other.getByText(/您已确认落地/)).toBeVisible();
  await otherContext.close();
});
