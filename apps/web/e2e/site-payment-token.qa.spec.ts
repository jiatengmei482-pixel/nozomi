/**
 * QA（M3-13，ADR 0046）：组件测试模拟不了的真实浏览器行为：跨文档前进后退时 history.state 还在不在、在地址栏改 `#` 是真的导航；
 * 真实 API、真实 PostgreSQL、假 Stripe（e2e/fake-stripe.ts）。数据都在用例里经接口现造，虚构值。
 */
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { E2E_WEB_STRIPE_PORT } from "../playwright.config.ts";
import { CENTER, type World, createProductByApi, createSupplier, createWorld } from "./catalog.ts";
import { routeStripe } from "./fake-stripe.ts";

const SITE = `http://127.0.0.1:${E2E_WEB_STRIPE_PORT}`;
const ORDER_PATH = `${SITE}/book/order`;
const RULES = {
  booking: { sale_from: null, sale_to: null, service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 0, note: null },
  urgent: { enabled: false, daily_quota: null, tiers: [] },
  night: { enabled: false, window: null, amount: null, charge_unit: null },
  free_wait: { pickup: { mode: "limited", minutes: 60 }, dropoff: { mode: "limited", minutes: 60 }, general: null },
  addons: [],
  driver_languages: [],
};

function fakeStripeUrl(): string {
  const url = process.env["E2E_FAKE_STRIPE_URL"];
  if (!url) throw new Error("global-setup 没有启动假 Stripe");
  return url;
}

const sourceAddress = (): string => `198.51.100.${1 + Math.floor(Math.random() * 250)}`;

function tokyoIn(hours: number): string {
  const at = new Date(Math.ceil((Date.now() + hours * 3_600_000) / 300_000) * 300_000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at).map((part) => [part.type, part.value]));
  return `${parts["year"]}-${parts["month"]}-${parts["day"]}T${parts["hour"]}:${parts["minute"]}`;
}

async function sellableWorld(request: APIRequestContext): Promise<World> {
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  const product = await createProductByApi(request, supplier, world, "airport_transfer");
  const version = async (): Promise<number> => ((await (await request.get(`/tenant/v1/products/${product.id}`, { headers: supplier.headers })).json()) as { version: number }).version;
  const rules = await request.put(`/tenant/v1/products/${product.id}/service-rules`, { headers: { ...supplier.headers, "if-match": `"${product.version}"` }, data: RULES });
  expect(rules.status(), await rules.text()).toBe(200);
  const content = await request.put(`/tenant/v1/products/${product.id}/content`, { headers: { ...supplier.headers, "if-match": `"${await version()}"` }, data: { zh: { title: "官网接送机", pickup_guide: "到达大厅 2 号出口" } } });
  expect(content.status(), await content.text()).toBe(200);
  const { today } = (await (await request.get(`/tenant/v1/products/${product.id}/price-rules`, { headers: supplier.headers })).json()) as { today: string };
  const price = await request.post(`/tenant/v1/products/${product.id}/price-rules/batch`, {
    headers: { ...supplier.headers, "if-match": `"${await version()}"`, "idempotency-key": crypto.randomUUID() },
    data: { create: [{ ref: "a", area_id: supplier.area.id, vehicle_group_id: world.group.id, direction: "both", package_hours: null, pricing_model: "fixed", base_price: 20000, start_price: null, start_meters: null, start_minutes: null, per_km: null, per_minute: null, min_price: null, package_km: null, package_price: null, overtime_per_hour: null, over_km_per_km: null, valid_from: today, valid_to: null, status: "enabled" }], update: [], delete: [] },
  });
  expect(price.status(), await price.text()).toBe(200);
  const published = await request.post(`/tenant/v1/products/${product.id}/publish`, { headers: supplier.headers });
  expect(published.status(), await published.text()).toBe(200);
  return world;
}

async function placeOrder(request: APIRequestContext, world: World, source: string, hours: number): Promise<{ token: string; orderNo: string }> {
  const headers = { "x-forwarded-for": source };
  const quoted = await request.post(`${SITE}/site/v1/quotes`, { headers, data: { city_id: world.city.id, airport_id: world.airport.id, direction: "pickup", address: { lat: CENTER.lat + 0.01, lng: CENTER.lng + 0.01 }, service_local: tokyoIn(hours), passengers: 1, luggage: 0 } });
  expect(quoted.status(), await quoted.text()).toBe(200);
  const quote = ((await quoted.json()) as { quotes: { quote_id: string; vehicle_group: { id: string } }[] }).quotes.find((item) => item.vehicle_group.id === world.group.id);
  expect(quote).toBeTruthy();
  const created = await request.post(`${SITE}/site/v1/orders`, {
    headers: { ...headers, "idempotency-key": crypto.randomUUID() },
    data: { quote_id: quote?.quote_id, passenger: { name: "虚构客人", phone: "+81 90-0000-0000", email: `qa-${crypto.randomUUID().slice(0, 8)}@e2e.example.com` }, flight_no: "NH211", dropoff_address: "虚构地址一丁目", save_payment_method: true },
  });
  expect(created.status(), await created.text()).toBe(201);
  const body = (await created.json()) as { link: { token: string }; order: { order_no: string } };
  return { token: body.link.token, orderNo: body.order.order_no };
}

const cardField = (page: Page) => page.getByLabel("卡号（假 Stripe）");
const heading = (page: Page, orderNo: string) => page.getByRole("heading", { level: 1, name: `订单 ${orderNo}` });
const stripeAddresses = (page: Page): Promise<string[]> => page.evaluate(() => (window as unknown as { __stripeAddresses?: string[] }).__stripeAddresses ?? []);

async function prepare(page: Page, source: string): Promise<void> {
  await page.setExtraHTTPHeaders({ "x-forwarded-for": source });
  await routeStripe(page, fakeStripeUrl());
}

test("跨文档前进后退：离开到首页（新文档）再后退，令牌还在这条历史记录里，表单照常，地址和 Stripe.js 都没有令牌；再前进再后退也一样", async ({ page, request }) => {
  test.setTimeout(60_000);
  const source = sourceAddress();
  const world = await sellableWorld(request);
  const placed = await placeOrder(request, world, source, 26);
  await prepare(page, source);

  await page.goto(`${ORDER_PATH}#${placed.token}`);
  await expect(cardField(page)).toBeVisible();
  expect(page.url()).toBe(ORDER_PATH);

  await page.goto(`${SITE}/book`);
  await page.goBack();
  await expect(heading(page, placed.orderNo)).toBeVisible();
  await expect(cardField(page)).toBeVisible();
  expect(page.url()).toBe(ORDER_PATH);
  for (const seen of await stripeAddresses(page)) expect(seen).not.toContain("nzo_");

  await page.goForward();
  await page.goBack();
  await expect(cardField(page)).toBeVisible();
  expect(page.url()).toBe(ORDER_PATH);
  await expect(page.getByRole("heading", { level: 1, name: "查订单" })).toHaveCount(0);
});

test("真实地改 `#` 换一张单：地址回到干净，内容是 B 的，后退回到 A 的表单，Stripe.js 自始至终没读到令牌", async ({ page, request }) => {
  test.setTimeout(60_000);
  const source = sourceAddress();
  const world = await sellableWorld(request);
  const a = await placeOrder(request, world, source, 26);
  const b = await placeOrder(request, world, source, 28);
  await prepare(page, source);

  await page.goto(`${ORDER_PATH}#${a.token}`);
  await expect(cardField(page)).toBeVisible();

  await page.evaluate((token) => {
    window.location.hash = token;
  }, b.token);
  await expect(heading(page, b.orderNo)).toBeVisible();
  await expect(page).toHaveURL(ORDER_PATH);
  await expect(cardField(page)).toBeVisible();

  await page.goBack();
  await expect(heading(page, a.orderNo)).toBeVisible();
  await expect(cardField(page)).toBeVisible();
  await expect(page).toHaveURL(ORDER_PATH);
  for (const seen of await stripeAddresses(page)) expect(seen).not.toContain("nzo_");
});

test("真实浏览器里贴 B 的链接、B 读得慢：等 B 的时候页面不能还是 A 的订单号和付款表单", async ({ page, request }) => {
  test.setTimeout(60_000);
  const source = sourceAddress();
  const world = await sellableWorld(request);
  const a = await placeOrder(request, world, source, 26);
  const b = await placeOrder(request, world, source, 28);
  await prepare(page, source);

  await page.goto(`${ORDER_PATH}#${a.token}`);
  await expect(cardField(page)).toBeVisible();

  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/site/v1/order", async (route) => {
    if (route.request().headers()["authorization"] === `Bearer ${b.token}`) await gate;
    await route.continue();
  });
  await page.evaluate((token) => {
    window.location.hash = token;
  }, b.token);
  await page.waitForTimeout(300);
  const staleVisible = await heading(page, a.orderNo).isVisible();
  release();
  await expect(heading(page, b.orderNo)).toBeVisible();
  expect(staleVisible, "令牌已经换成 B，页面还是 A 的单").toBe(false);
});
