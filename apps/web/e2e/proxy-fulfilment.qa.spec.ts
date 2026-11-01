/**
 * 端到端（M4-19 测试角色补充）：运营订单详情在 320 宽、内容都很长时不溢出；页面上没有司机链接令牌；状态流水和详情不出英文内部代码。
 * proxy-fulfilment.spec.ts 已测过普通长度的 320 宽，这里只测极端内容。真实浏览器 → 前端 → 真实 API → 真实 PostgreSQL。
 * 「已经付过款」的订单和 proxy-fulfilment.spec.ts 一样用迁移账号写进本次运行的 schema，运行结束随 schema 删除；数据全部虚构。
 */
import { randomInt, randomUUID } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { createPool } from "../../api/src/db/pool.ts";
import { createProductByApi, createSupplier, createWorld, post, tenantHeaders } from "./catalog.ts";
import { adminCredentials, expectNoHorizontalOverflow, loginAs, platformAdminHeaders } from "./support.ts";

const ALPHABET = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const random = (length: number, alphabet = ALPHABET): string => Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join("");

interface Seed {
  tenantId: string;
  tenantName: string;
  adminEmail: string;
  password: string;
  cityId: string;
  airportId: string;
  productId: string;
  groupId: string;
  channelId: string;
  apiClientId: string;
  clientId: string;
  clientSecret: string;
}

async function owner<T>(run: (client: ReturnType<typeof createPool>) => Promise<T>): Promise<T> {
  const url = process.env["E2E_DATABASE_OWNER_URL"];
  if (!url) throw new Error("global-setup 没有准备好数据库连接");
  const client = createPool(url, { max: 1 });
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

/** 一家配好商品的供应商、一个渠道（带 API 客户端和密钥）。 */
async function prepare(request: APIRequestContext): Promise<Seed> {
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  const product = await createProductByApi(request, supplier, world, "airport_transfer");
  const headers = await platformAdminHeaders(request);
  const channel = await post<{ channel: { id: string } }>(request, headers, "/platform/v1/channels", { type: "own", settle_currency: "JPY", name: `官网-${random(4)}` }, "新建渠道");
  const client = await post<{ api_client: { id: string; client_id: string }; client_secret: string }>(request, headers, `/platform/v1/channels/${channel.channel.id}/api-clients`, { name: "官网" }, "发 API 客户端");
  return {
    tenantId: supplier.tenant.tenantId,
    tenantName: supplier.tenant.tenantName,
    adminEmail: supplier.tenant.adminEmail,
    password: supplier.tenant.password,
    cityId: world.city.id,
    airportId: world.airport.id,
    productId: product.id,
    groupId: world.group.id,
    channelId: channel.channel.id,
    apiClientId: client.api_client.id,
    clientId: client.api_client.client_id,
    clientSecret: client.client_secret,
  };
}

/**
 * 写入一张付过款的接机单和它的销售端一侧（对外价 21,780 = 结算价 19,800 × 1.1），`serviceAt` 用车（东京当地时间算用车日期）。
 * `completed`：已完成（完成时间 = 用车后 1 小时）；否则已确认、派车截止已过（超时未派车）。返回订单编号和订单号。
 */
async function seedOrder(seed: Seed, input: { serviceAt: Date; completed: boolean }): Promise<{ id: string; orderNo: string }> {
  return owner(async (client) => {
    const now = new Date();
    const local = new Date(input.serviceAt.getTime() + 9 * 3_600_000).toISOString().slice(0, 16);
    const today = now.toISOString().slice(0, 10).replaceAll("-", "");
    const orderNo = `NZ${today}${random(8)}`;
    const quoteId = `QT${today}${random(10, "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ")}`;
    const settlement = { currency: "JPY", roundingUnit: 1, totalMinor: 19800, baseMinor: 19800, adjustMinor: 0, urgentMinor: 0, nightMinor: 0, addonsMinor: 0, driverLanguageMinor: 0, usage: null };
    const log = await client.query<{ id: string }>(
      "insert into quote_logs (channel_id, api_client_id, created_at, request, currency, city_id, category, candidate_count, quote_count, bids, rejects, duration_ms, ordered) values ($1, $2, now(), '{}'::jsonb, 'JPY', $3, 'airport_transfer', 1, 1, '[]'::jsonb, '[]'::jsonb, 5, true) returning id",
      [seed.channelId, seed.apiClientId, seed.cityId],
    );
    const snapshot = { quoteId, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 30 * 60_000).toISOString(), bandBp: 300, markup: { markupBp: 1000, level: 5, ruleId: null }, candidates: [], currency: "JPY" };
    await client.query(
      `insert into quotes (id, channel_id, quote_log_id, vehicle_group_id, winner_tenant_id, product_id, product_version, currency, sell_minor, settlement_minor, settlement_currency, markup_bp, markup_level, snapshot, created_at, expires_at)
       values ($1, $2, $3, $4, $5, $6, 1, 'JPY', 21780, 19800, 'JPY', 1000, 5, $7::jsonb, now(), now() + interval '30 minutes')`,
      [quoteId, seed.channelId, log.rows[0]?.id, seed.groupId, seed.tenantId, seed.productId, JSON.stringify(snapshot)],
    );
    const order = await client.query<{ id: string }>(
      `insert into orders (tenant_id, order_no, status, category, city_id, place_id, direction, product_id, product_version, vehicle_group_id, service_at, service_local, timezone, service_date,
                           urgent, passengers, luggage, dropoff, addons, flight_no, passenger, settlement_minor, settlement_currency, settlement, free_wait_minutes, inventory_held,
                           payment_due_at, confirmed_at, dispatch_due_at, completed_at, cancel_policy, created_at, updated_at)
       values ($1, $2, $3, 'airport_transfer', $4, $5, 'pickup', $6, 1, $7, $8, $9, 'Asia/Tokyo', $10, false, 2, 1, $11::jsonb, '[]'::jsonb, 'NH211', $12::jsonb, 19800, 'JPY', $13::jsonb, 90, false,
               now() + interval '30 minutes', now(), $14, $15, $16::jsonb, now(), now()) returning id`,
      [
        seed.tenantId, orderNo, input.completed ? "completed" : "confirmed", seed.cityId, seed.airportId, seed.productId, seed.groupId, input.serviceAt, local, local.slice(0, 10),
        JSON.stringify({ lng: 139.76, lat: 35.68, address: "东京站八重洲口" }),
        JSON.stringify({ name: "王小明", phone: "+819012345678", email: "guest@e2e.example.com" }),
        JSON.stringify(settlement),
        input.completed ? new Date(input.serviceAt.getTime() - 24 * 3_600_000) : new Date(now.getTime() - 3_600_000),
        input.completed ? new Date(input.serviceAt.getTime() + 3_600_000) : null,
        JSON.stringify({ version: 0, category: "airport_transfer", level: "business", tiers: [{ minHoursBefore: 48, feeBp: 0 }, { minHoursBefore: 24, feeBp: 5000 }, { minHoursBefore: 0, feeBp: 10000 }] }),
      ],
    );
    const id = order.rows[0]?.id as string;
    await client.query(
      `insert into order_sales (order_id, supplier_tenant_id, channel_id, api_client_id, quote_id, idempotency_key, request_hash, currency, sell_minor, markup_bp, fx, fx_buffer_bp, created_at)
       values ($1, $2, $3, $4, $5, $6, 'e2e', 'JPY', 21780, 1000, null, 0, now())`,
      [id, seed.tenantId, seed.channelId, seed.apiClientId, quoteId, crypto.randomUUID()],
    );
    return { id, orderNo };
  });
}

const LONG_WORD = "Fictional".repeat(5);

/** 供应商派车：司机姓名、车型都很长。返回司机链接令牌。 */
async function dispatchLong(request: APIRequestContext, seed: Seed, orderId: string): Promise<string> {
  const headers = await tenantHeaders(request, seed.adminEmail, seed.password);
  const create = async <T>(path: string, data: unknown): Promise<T> => post<T>(request, { ...headers, "idempotency-key": randomUUID() }, path, data, path);
  const driver = await create<{ id: string }>("/tenant/v1/drivers", { name: LONG_WORD, phone: `+8190${randomInt(10_000_000, 99_999_999)}`, languages: ["ja", "zh"], license_expires_on: "2035-01-01", driving_years: 12, gold: false });
  const vehicle = await create<{ id: string }>("/tenant/v1/vehicles", { plate: `品川 300 あ ${randomInt(1000, 9999)}`, vehicle_group_id: seed.groupId, model: LONG_WORD, color: "黑", seats: 7, mileage_km: 30000, plate_type: "business", insurance_expires_on: "2035-01-01", inspection_expires_on: "2035-01-01" });
  const version = (await (await request.get(`/tenant/v1/orders/${orderId}`, { headers })).json()).order.version as number;
  const res = await request.post(`/tenant/v1/orders/${orderId}/assign`, { headers: { ...headers, "if-match": `"${version}"` }, data: { driver_id: driver.id, vehicle_id: vehicle.id } });
  expect(res.ok(), await res.text()).toBe(true);
  return (await res.json()).driver_link.token as string;
}

test("320 宽、司机姓名和车型很长、500 字不换行的原因：订单详情不溢出；页面没有司机链接令牌；不出英文内部代码", async ({ page, request }) => {
  test.setTimeout(120_000);
  const seed = await prepare(request);
  const { id, orderNo } = await seedOrder(seed, { serviceAt: new Date(Date.now() + 3_600_000), completed: false });
  const driverToken = await dispatchLong(request, seed, id);
  const headers = await platformAdminHeaders(request);
  const reason = "x".repeat(500);
  for (const type of ["departed", "arrived", "picked_up"]) {
    const version = (await (await request.get(`/platform/v1/orders/${id}`, { headers })).json()).order.version as number;
    const res = await request.post(`/platform/v1/orders/${id}/events`, { headers: { ...headers, "if-match": `"${version}"` }, data: { type, occurred_at: new Date().toISOString(), reason } });
    expect(res.ok(), await res.text()).toBe(true);
  }

  const admin = adminCredentials();
  await loginAs(page, "platform", admin.email, admin.password);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`/platform/orders/${id}`);
  await expect(page.getByRole("heading", { level: 1, name: `订单 ${orderNo}` })).toBeVisible();
  await expect(page.locator("section").filter({ has: page.getByRole("heading", { name: /^派车（/ }) })).toContainText(LONG_WORD);
  await expect(page.locator("section").filter({ has: page.getByRole("heading", { name: "状态流水" }) })).toContainText(reason);
  await expectNoHorizontalOverflow(page, "订单详情（极端内容，320px）");

  const html = await page.content();
  expect(html.includes(driverToken), "页面里不能有司机链接令牌").toBe(false);
  await expect(page.locator(`a[href*="/driver"]`)).toHaveCount(0);
  const text = (await page.locator("main").innerText()).replaceAll(reason, "").replaceAll(LONG_WORD, "");
  expect(text).not.toMatch(/\b(DEPARTED|ARRIVED|PICKED_UP|COMPLETED|ASSIGNED|REASSIGNED|PAYMENT_SUCCEEDED|platform_proxy|platform_user|tenant_user)\b/);
});
