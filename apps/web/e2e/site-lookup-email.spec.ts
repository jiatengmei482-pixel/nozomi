/**
 * 官网查订单把链接发到下单邮箱（M4-30，ADR 0061），真实浏览器 → 构建好的前端 → 真实 API → 真实 PostgreSQL + 本机假 SMTP（从不连真实的邮件服务）。
 * 官网下单（远期的单，待付款，后台救援任务不会碰）→ 查订单填错邮箱：同一句提示、不发信 → 填对：同一句提示 → 假 SMTP 收到 → 打开邮件里的链接看到这张单 →
 * 下单时的链接照样能用。查订单页在亮暗两色、320 宽过 axe、不横向滚动；客服电话没登记时「收不到邮件？」照常显示。
 * 用司机链接邮件那一组 API（配置文件里有假 SMTP 和官网渠道，见 global-setup）。全部是虚构数据。
 */
import { randomBytes } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { decodedMailText } from "../../api/src/testing/fake-integrations.ts";
import { E2E_WEB_DRIVER_MAIL_PORT } from "../playwright.config.ts";
import { CENTER, type Supplier, type World, createProductByApi, createSupplier, createWorld, expectAccessible } from "./catalog.ts";
import { expectNoHorizontalOverflow } from "./support.ts";

test.use({ baseURL: `http://127.0.0.1:${E2E_WEB_DRIVER_MAIL_PORT}` });

const SENT = "如信息匹配，链接已发送到下单邮箱。请查收邮件（也看看垃圾邮件），打开邮件里的链接查看订单。";

async function productVersion(request: APIRequestContext, supplier: Supplier, id: string): Promise<number> {
  return ((await (await request.get(`/tenant/v1/products/${id}`, { headers: supplier.headers })).json()) as { version: number }).version;
}

/** 一个上架的接送机商品：固定价，今天起有效。 */
async function publishedProduct(request: APIRequestContext, supplier: Supplier, world: World): Promise<void> {
  const product = await createProductByApi(request, supplier, world, "airport_transfer");
  const { today } = (await (await request.get(`/tenant/v1/products/${product.id}/price-rules`, { headers: supplier.headers })).json()) as { today: string };
  const price = await request.post(`/tenant/v1/products/${product.id}/price-rules/batch`, {
    headers: { ...supplier.headers, "if-match": `"${await productVersion(request, supplier, product.id)}"`, "idempotency-key": crypto.randomUUID() },
    data: { create: [{ ref: "a", area_id: supplier.area.id, vehicle_group_id: world.group.id, direction: "both", package_hours: null, pricing_model: "fixed", base_price: 20000, start_price: null, start_meters: null, start_minutes: null, per_km: null, per_minute: null, min_price: null, package_km: null, package_price: null, overtime_per_hour: null, over_km_per_km: null, valid_from: today, valid_to: null, status: "enabled" }], update: [], delete: [] },
  });
  expect(price.status(), await price.text()).toBe(200);
  const published = await request.post(`/tenant/v1/products/${product.id}/publish`, { headers: supplier.headers });
  expect(published.status(), await published.text()).toBe(200);
}

/** 东京的「现在 + N 天」10:00，当地 `YYYY-MM-DDTHH:mm`。 */
function tokyoDaysAhead(days: number): string {
  const at = new Date(Date.now() + days * 86_400_000 + 9 * 3_600_000);
  return `${at.toISOString().slice(0, 10)}T10:00`;
}

/** 经 /site/v1 下一张远期的接机单（待付款），返回订单号和下单时的令牌。 */
async function placeSiteOrder(request: APIRequestContext, world: World, email: string): Promise<{ orderNo: string; token: string }> {
  const quoted = await request.post("/site/v1/quotes", { data: { city_id: world.city.id, airport_id: world.airport.id, direction: "pickup", address: { lat: CENTER.lat + 0.01, lng: CENTER.lng + 0.01 }, service_local: tokyoDaysAhead(10), passengers: 1, luggage: 0 } });
  expect(quoted.status(), await quoted.text()).toBe(200);
  const quote = ((await quoted.json()) as { quotes: { quote_id: string; vehicle_group: { id: string } }[] }).quotes.find((q) => q.vehicle_group.id === world.group.id);
  expect(quote, "报出了这个车型组的价").toBeTruthy();
  const created = await request.post("/site/v1/orders", { headers: { "idempotency-key": crypto.randomUUID() }, data: { quote_id: quote?.quote_id, passenger: { name: "虚构乘客", phone: "+81 90-0000-1111", email }, flight_no: "NH211", dropoff_address: "虚构市虚构路一号", save_payment_method: true } });
  expect(created.status(), await created.text()).toBe(201);
  const body = (await created.json()) as { order: { order_no: string }; link: { token: string } };
  return { orderNo: body.order.order_no, token: body.link.token };
}

async function mailsTo(email: string): Promise<string[]> {
  const stats = (await (await fetch(process.env["E2E_FAKE_SMTP_STATS_URL"] as string)).json()) as { messages: { to: string[]; data: string }[] };
  return stats.messages.filter((message) => message.to.includes(email)).map((message) => decodedMailText(message.data));
}

test("查订单 → 假 SMTP 收到 → 打开邮件里的链接看到订单；填错邮箱同一句提示、不发信；旧链接照样能用；亮暗两色、手机宽度、无障碍", async ({ page, request }) => {
  test.setTimeout(150_000);
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  await publishedProduct(request, supplier, world);
  const email = `fictional.lookup.${randomBytes(4).toString("hex")}@e2e.example.com`;
  const wrong = `fictional.wrong.${randomBytes(4).toString("hex")}@e2e.example.com`;
  const placed = await placeSiteOrder(request, world, email);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/book/order");
  await expect(page.getByRole("heading", { level: 1, name: "查订单" })).toBeVisible();
  // 客服电话没登记：「收不到邮件？」照常显示，没有号码
  await expect(page.getByRole("heading", { level: 2, name: "收不到邮件？" })).toBeVisible();
  await expect(page.getByRole("link", { name: /打电话给客服/ })).toHaveCount(0);

  // 填错邮箱：同一句提示
  await page.getByLabel("订单号").fill(placed.orderNo.toLowerCase());
  await page.getByLabel("下单时的邮箱").fill(wrong);
  await page.getByRole("button", { name: "发送订单链接" }).click();
  await expect(page.getByRole("status").filter({ hasText: SENT })).toBeVisible();

  // 填对（大小写不同）：同一句提示
  await page.getByLabel("下单时的邮箱").fill(email.toUpperCase());
  await page.getByRole("button", { name: "发送订单链接" }).click();
  await expect(page.getByRole("status").filter({ hasText: SENT })).toBeVisible();

  let mail: string | undefined;
  await expect.poll(async () => ((mail = (await mailsTo(email))[0]) !== undefined), { timeout: 40_000, intervals: [1_000] }).toBe(true);
  expect(await mailsTo(wrong), "填错的邮箱收不到任何信").toEqual([]);
  const text = mail as string;
  expect(text).toContain(placed.orderNo);
  expect(text).toContain("以前收到的链接仍然可以使用");
  for (const secret of ["虚构乘客", "+81 90-0000-1111", "虚构市虚构路一号", "20,000", "JPY"]) expect(text.includes(secret), `邮件里不该有 ${secret}`).toBe(false);
  const token = /\/book\/order#(nzo_[A-Za-z0-9_-]{43})/.exec(text)?.[1];
  expect(token, "邮件里有订单链接").toBeTruthy();

  // 页面：亮暗两色、320 宽
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await expectNoHorizontalOverflow(page, `查订单（${width}px，已发送）`);
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expectAccessible(page, `查订单（${width}px，${scheme === "light" ? "亮色" : "暗色"}，已发送）`);
    }
  }
  await page.emulateMedia({ colorScheme: "light" });

  // 打开邮件里的链接：看到这张单
  await page.goto(`/book/order#${token}`);
  await expect(page.getByRole("heading", { level: 1, name: `订单 ${placed.orderNo}` })).toBeVisible();
  // 下单时的链接照样能用（新签发不吊销旧的）
  await page.goto("/book/order");
  await page.goto(`/book/order#${placed.token}`);
  await expect(page.getByRole("heading", { level: 1, name: `订单 ${placed.orderNo}` })).toBeVisible();
});

test("查订单：填手机号提示联系客服，不提交", async ({ page }) => {
  await page.goto("/book/order");
  await page.getByLabel("订单号").fill("NZ20261026ABCD2345");
  await page.getByLabel("下单时的邮箱").fill("+81 90-0000-1111");
  let posted = false;
  page.on("request", (req) => {
    if (req.method() === "POST" && req.url().includes("/site/v1/orders/lookup")) posted = true;
  });
  await page.getByRole("button", { name: "发送订单链接" }).click();
  await expect(page.getByText("请填写下单时的邮箱。只留了手机号的，请联系客服")).toBeVisible();
  expect(posted).toBe(false);
});
