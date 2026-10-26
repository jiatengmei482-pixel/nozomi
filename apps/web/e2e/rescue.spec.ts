/**
 * 端到端：救援改派与违约金（M3-04，ADR 0031）。真实浏览器 → 前端 → 真实 API → 真实 PostgreSQL，不 mock 接口。
 * 原供应商在订单详情里声明无法履约（离用车 10 天：违约金 0，先看到档位）→ 运营在「救援」队列里点进订单、看候选（只有另一家，差价 200）、发救援单
 * → 救援供应商在「救援单」里接单、到订单里看得到乘客 → 原供应商那一单变成「已转给救援供应商」，「违约金与扣款」里有违约金 0 和差价 200。
 * 端到端测试里没有 Stripe：「已经付过款」的订单和它的报价快照由用例用迁移账号直接写进本次运行的 schema（只在测试里构造，运行结束随 schema 删除）。日期跟着今天走。
 */
import { randomInt } from "node:crypto";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { createPool } from "../../api/src/db/pool.ts";
import { type Supplier, type World, createProductByApi, createSupplier, createWorld, expectAccessible, post, toast } from "./catalog.ts";
import { adminCredentials, loginAs, platformAdminHeaders } from "./support.ts";

const ALPHABET = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const random = (length: number, alphabet = ALPHABET): string => Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join("");
const DROPOFF = { lng: 139.76, lat: 35.68 };

const RULES = {
  booking: { sale_from: null, sale_to: null, service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 0, note: null },
  urgent: { enabled: false, daily_quota: null, tiers: [] },
  night: { enabled: false, window: null, amount: null, charge_unit: null },
  free_wait: { pickup: { mode: "limited", minutes: 60 }, dropoff: { mode: "limited", minutes: 60 }, general: null },
  addons: [],
  driver_languages: [],
};

/** 经供应商接口配好、上架的接送机商品（一口价，从城市当地的今天起生效）。 */
async function publishedProduct(request: APIRequestContext, supplier: Supplier, world: World, amount: number): Promise<string> {
  const product = await createProductByApi(request, supplier, world, "airport_transfer");
  const version = async (): Promise<number> => ((await (await request.get(`/tenant/v1/products/${product.id}`, { headers: supplier.headers })).json()) as { version: number }).version;
  const rules = await request.put(`/tenant/v1/products/${product.id}/service-rules`, { headers: { ...supplier.headers, "if-match": `"${product.version}"` }, data: RULES });
  expect(rules.status(), await rules.text()).toBe(200);
  const content = await request.put(`/tenant/v1/products/${product.id}/content`, { headers: { ...supplier.headers, "if-match": `"${await version()}"` }, data: { zh: { title: "救援测试", pickup_guide: "到达大厅 2 号出口" } } });
  expect(content.status(), await content.text()).toBe(200);
  const { today } = (await (await request.get(`/tenant/v1/products/${product.id}/price-rules`, { headers: supplier.headers })).json()) as { today: string };
  const price = await request.post(`/tenant/v1/products/${product.id}/price-rules/batch`, {
    headers: { ...supplier.headers, "if-match": `"${await version()}"`, "idempotency-key": crypto.randomUUID() },
    data: { create: [{ ref: "a", area_id: supplier.area.id, vehicle_group_id: world.group.id, direction: "both", package_hours: null, pricing_model: "fixed", base_price: amount, start_price: null, start_meters: null, start_minutes: null, per_km: null, per_minute: null, min_price: null, package_km: null, package_price: null, overtime_per_hour: null, over_km_per_km: null, valid_from: today, valid_to: null, status: "enabled" }], update: [], delete: [] },
  });
  expect(price.status(), await price.text()).toBe(200);
  const published = await request.post(`/tenant/v1/products/${product.id}/publish`, { headers: supplier.headers });
  expect(published.status(), await published.text()).toBe(200);
  return product.id;
}

/** 写入原供应商一张付过款的接机单、它的报价快照（含原来的询价条件：救援按它重新比价）和销售端一侧。`daysAhead` 天后东京 10:00 用车。返回订单号。 */
async function seedOrder(input: { tenantId: string; productId: string; world: World; channelId: string; apiClientId: string; daysAhead: number }): Promise<string> {
  const url = process.env["E2E_DATABASE_OWNER_URL"];
  if (!url) throw new Error("global-setup 没有准备好数据库连接");
  const client = createPool(url, { max: 1 });
  try {
    const now = new Date();
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + input.daysAhead, 1, 0));
    const local = new Date(day.getTime() + 9 * 3_600_000).toISOString().slice(0, 16);
    const today = now.toISOString().slice(0, 10).replaceAll("-", "");
    const orderNo = `NZ${today}${random(8)}`;
    const quoteId = `QT${today}${random(10, "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ")}`;
    const settlement = { currency: "JPY", roundingUnit: 1, totalMinor: 19800, baseMinor: 19800, adjustMinor: 0, urgentMinor: 0, nightMinor: 0, addonsMinor: 0, driverLanguageMinor: 0, usage: null, freeWait: { item: "pickup", value: { mode: "limited", minutes: 60 }, platformMinimumMinutes: 60 } };
    const log = await client.query<{ id: string }>(
      "insert into quote_logs (channel_id, api_client_id, created_at, request, currency, city_id, category, candidate_count, quote_count, bids, rejects, duration_ms, ordered) values ($1, $2, now(), '{}'::jsonb, 'JPY', $3, 'airport_transfer', 1, 1, '[]'::jsonb, '[]'::jsonb, 5, true) returning id",
      [input.channelId, input.apiClientId, input.world.city.id],
    );
    const request = { category: "airport_transfer", pickup: null, dropoff: DROPOFF, direction: "pickup", packageHours: null, serviceLocal: local, passengers: 2, luggage: 1, addons: [], driverLanguage: null, vehicleGroupIds: [input.world.group.id] };
    const snapshot = { quoteId, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 30 * 60_000).toISOString(), request, bandBp: 300, markup: { markupBp: 1000, level: 5, ruleId: null }, candidates: [], currency: "JPY" };
    await client.query(
      `insert into quotes (id, channel_id, quote_log_id, vehicle_group_id, winner_tenant_id, product_id, product_version, currency, sell_minor, settlement_minor, settlement_currency, markup_bp, markup_level, snapshot, created_at, expires_at)
       values ($1, $2, $3, $4, $5, $6, 1, 'JPY', 21780, 19800, 'JPY', 1000, 5, $7::jsonb, now(), now() + interval '30 minutes')`,
      [quoteId, input.channelId, log.rows[0]?.id, input.world.group.id, input.tenantId, input.productId, JSON.stringify(snapshot)],
    );
    const order = await client.query<{ id: string }>(
      `insert into orders (tenant_id, order_no, status, category, city_id, place_id, direction, product_id, product_version, vehicle_group_id, service_at, service_local, timezone, service_date,
                           urgent, passengers, luggage, dropoff, addons, flight_no, passenger, settlement_minor, settlement_currency, settlement, free_wait_minutes, inventory_held,
                           payment_due_at, confirmed_at, dispatch_due_at, created_at, updated_at)
       values ($1, $2, 'confirmed', 'airport_transfer', $3, $4, 'pickup', $5, 1, $6, $7, $8, 'Asia/Tokyo', $9, false, 2, 1, $10::jsonb, '[]'::jsonb, 'NH211', $11::jsonb, 19800, 'JPY', $12::jsonb, 60, false,
               now() + interval '30 minutes', now(), $7::timestamptz - interval '24 hours', now(), now()) returning id`,
      [
        input.tenantId, orderNo, input.world.city.id, input.world.airport.id, input.productId, input.world.group.id, day, local, local.slice(0, 10),
        JSON.stringify({ ...DROPOFF, address: "东京站八重洲口" }),
        JSON.stringify({ name: "王小明", phone: "+819012345678", email: "guest@e2e.example.com" }),
        JSON.stringify(settlement),
      ],
    );
    await client.query(
      `insert into order_sales (order_id, supplier_tenant_id, channel_id, api_client_id, quote_id, idempotency_key, request_hash, currency, sell_minor, markup_bp, fx, fx_buffer_bp, created_at)
       values ($1, $2, $3, $4, $5, $6, 'e2e', 'JPY', 21780, 1000, null, 0, now())`,
      [order.rows[0]?.id, input.tenantId, input.channelId, input.apiClientId, quoteId, crypto.randomUUID()],
    );
    return orderNo;
  } finally {
    await client.end();
  }
}

const menu = (page: Page) => page.getByRole("navigation", { name: "主菜单" }).first();

test("原供应商声明无法履约 → 运营在救援队列看候选、发救援单 → 救援供应商接单 → 订单转过去、客人信息给新供应商，原供应商只看得到违约金和差价", async ({ page, request, browser }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const world = await createWorld(request);
  const original = await createSupplier(request, world);
  const rescuer = await createSupplier(request, world);
  const originalProduct = (await createProductByApi(request, original, world, "airport_transfer")).id;
  await publishedProduct(request, rescuer, world, 20_000);
  const headers = await platformAdminHeaders(request);
  const channel = await post<{ channel: { id: string } }>(request, headers, "/platform/v1/channels", { type: "own", settle_currency: "JPY", name: `官网-${random(4)}` }, "新建渠道");
  const apiClient = await post<{ api_client: { id: string } }>(request, headers, `/platform/v1/channels/${channel.channel.id}/api-clients`, { name: "官网" }, "发 API 客户端");
  const orderNo = await seedOrder({ tenantId: original.tenant.tenantId, productId: originalProduct, world, channelId: channel.channel.id, apiClientId: apiClient.api_client.id, daysAhead: 10 });

  // 原供应商：订单详情 → 声明无法履约（离用车 10 天：违约金 0）
  const originalContext = await browser.newContext();
  const originalPage = await originalContext.newPage();
  await loginAs(originalPage, "tenant", original.tenant.adminEmail, original.tenant.password);
  await menu(originalPage).getByRole("link", { name: "订单", exact: true }).click();
  await originalPage.getByRole("row").filter({ hasText: orderNo }).getByRole("link", { name: orderNo }).click();
  await originalPage.getByRole("button", { name: "声明无法履约" }).click();
  const declare = originalPage.getByRole("dialog", { name: "声明无法履约" });
  await expect(declare).toContainText("按现在声明的违约金0（用车前 24 小时以上） = 0 JPY");
  await declare.getByRole("button", { name: "确认声明" }).click();
  await expect(declare).toContainText("请写明为什么接不了");
  await declare.getByLabel("原因").fill("车辆故障，当天没有备用车");
  await declare.getByRole("button", { name: "确认声明" }).click();
  await expect(toast(originalPage, "已声明无法履约")).toBeVisible();
  await expect(originalPage.getByText("这一单已进入救援改派")).toBeVisible();
  await expect(originalPage.getByRole("button", { name: "派车" })).toHaveCount(0);
  await expectAccessible(originalPage, "供应商订单详情（救援中）");

  // 运营：救援队列 → 订单详情 → 看候选（只有救援供应商，差价 200）→ 发救援单
  const admin = adminCredentials();
  await loginAs(page, "platform", admin.email, admin.password);
  await menu(page).getByRole("link", { name: "救援" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "救援改派" })).toBeVisible();
  const queue = page.getByRole("table", { name: "救援" });
  await expect(queue).toContainText("供应商声明无法履约");
  await expectAccessible(page, "救援队列");
  await queue.getByRole("link", { name: orderNo }).click();
  const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "救援改派" }) });
  await expect(section).toContainText("车辆故障，当天没有备用车");
  await section.getByRole("button", { name: "看候选并发救援单" }).click();
  const candidates = page.getByRole("dialog", { name: "救援候选" });
  const row = candidates.getByRole("row").filter({ hasText: rescuer.tenant.tenantName });
  await expect(row).toContainText("20,000 JPY");
  await expect(row).toContainText("200 JPY");
  await expect(candidates.getByRole("row").filter({ hasText: original.tenant.tenantName })).toHaveCount(0);
  await row.getByRole("button", { name: `发救援单给 ${rescuer.tenant.tenantName}` }).click();
  await expect(toast(page, `已给「${rescuer.tenant.tenantName}」发救援单`)).toBeVisible();
  await expect(section).toContainText(`救援单待「${rescuer.tenant.tenantName}」接`);

  // 救援供应商：救援单（接单前没有乘客信息）→ 接单 → 订单里有乘客
  const rescuerContext = await browser.newContext();
  const rescuerPage = await rescuerContext.newPage();
  await loginAs(rescuerPage, "tenant", rescuer.tenant.adminEmail, rescuer.tenant.password);
  await menu(rescuerPage).getByRole("link", { name: "救援单" }).click();
  await expect(rescuerPage.getByRole("heading", { level: 1, name: "救援单" })).toBeVisible();
  await expect(rescuerPage.getByText("20,000 JPY")).toBeVisible();
  await expect(rescuerPage.getByText("王小明")).toHaveCount(0);
  await expectAccessible(rescuerPage, "救援单");
  await rescuerPage.getByRole("button", { name: "接单" }).click();
  await expect(toast(rescuerPage, "已接单：去订单里派车")).toBeVisible();
  await rescuerPage.getByRole("link", { name: "看订单" }).click();
  await expect(rescuerPage.getByRole("heading", { level: 1, name: `订单 ${orderNo}` })).toBeVisible();
  await expect(rescuerPage.getByText(/王小明/)).toBeVisible();
  await expect(rescuerPage.getByText(/这一单是你们接的救援单/)).toBeVisible();
  await expect(rescuerPage.getByRole("button", { name: "派车" })).toBeVisible();
  await rescuerContext.close();

  // 原供应商：那一单只能查看；违约金与扣款里有违约金 0 和差价 200
  await originalPage.reload();
  await expect(originalPage.getByText("这一单已转给救援供应商，只能查看")).toBeVisible();
  await expect(originalPage.getByText(rescuer.tenant.tenantName)).toHaveCount(0);
  await menu(originalPage).getByRole("link", { name: "违约金与扣款" }).click();
  const deductions = originalPage.getByRole("table", { name: "应扣款项" });
  await expect(deductions.getByRole("row").filter({ hasText: "救援差价" })).toContainText("200 JPY");
  await expect(deductions.getByRole("row").filter({ hasText: "违约金" })).toContainText("0 JPY");
  await expect(originalPage.getByText(/对外价|21,780/)).toHaveCount(0);
  await expectAccessible(originalPage, "违约金与扣款");
  await originalContext.close();

  // 运营：订单现在是救援供应商的，客人付的钱不变
  await page.reload();
  await expect(section).toContainText(`改派给「${rescuer.tenant.tenantName}」`);
  await expect(page.getByText("21,780 JPY / 20,000 JPY（加价 10%）")).toBeVisible();
});
