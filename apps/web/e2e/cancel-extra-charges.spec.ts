/**
 * 端到端：取消政策、事后加收、代客人取消（M3-03，ADR 0029）。真实浏览器 → 前端 → 真实 API → 真实 PostgreSQL，不 mock 接口。
 * 运营在「取消政策」里改一档并提交审核（不立即生效，「待审核」里看得到）；供应商在已完成的单上提交付费等待并上传票据（异议期内、看不到客人付多少）；
 * 运营后台的订单详情里看到这一项和客人要付的金额，并代客人取消另一张单（离用车很远：免费）。
 * 端到端测试里没有 Stripe：「已经付过款」的订单由用例用迁移账号直接写进本次运行的 schema（只在测试里构造，运行结束随 schema 删除）。日期跟着今天走。
 */
import { randomInt } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { createPool } from "../../api/src/db/pool.ts";
import { createProductByApi, createSupplier, createWorld, expectAccessible, post, toast } from "./catalog.ts";
import { adminCredentials, loginAs, platformAdminHeaders } from "./support.ts";

const ALPHABET = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const random = (length: number, alphabet = ALPHABET): string => Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join("");

interface Seed {
  tenantId: string;
  cityId: string;
  airportId: string;
  productId: string;
  groupId: string;
  channelId: string;
  apiClientId: string;
}

/** 写入一张付过款的接机单和它的销售端一侧（渠道、报价、对外价 21,780 = 结算价 19,800 × 1.1）。`daysAhead` 天后东京 10:00 用车。返回订单号。 */
async function seedOrder(seed: Seed, input: { daysAhead: number; status: "confirmed" | "completed" }): Promise<string> {
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
    const completed = input.status === "completed";
    const order = await client.query<{ id: string }>(
      `insert into orders (tenant_id, order_no, status, category, city_id, place_id, direction, product_id, product_version, vehicle_group_id, service_at, service_local, timezone, service_date,
                           urgent, passengers, luggage, dropoff, addons, flight_no, passenger, settlement_minor, settlement_currency, settlement, free_wait_minutes, inventory_held,
                           payment_due_at, confirmed_at, dispatch_due_at, completed_at, cancel_policy, created_at, updated_at)
       values ($1, $2, $3, 'airport_transfer', $4, $5, 'pickup', $6, 1, $7, $8, $9, 'Asia/Tokyo', $10, false, 2, 1, $11::jsonb, '[]'::jsonb, 'NH211', $12::jsonb, 19800, 'JPY', $13::jsonb, 90, false,
               now() + interval '30 minutes', now(), $8::timestamptz - interval '24 hours', $14, $15::jsonb, now(), now()) returning id`,
      [
        seed.tenantId, orderNo, input.status, seed.cityId, seed.airportId, seed.productId, seed.groupId, day, local, local.slice(0, 10),
        JSON.stringify({ lng: 139.76, lat: 35.68, address: "东京站八重洲口" }),
        JSON.stringify({ name: "王小明", phone: "+819012345678", email: "guest@e2e.example.com" }),
        JSON.stringify(settlement),
        completed ? now : null,
        JSON.stringify({ version: 0, category: "airport_transfer", level: "business", tiers: [{ minHoursBefore: 48, feeBp: 0 }, { minHoursBefore: 24, feeBp: 5000 }, { minHoursBefore: 0, feeBp: 10000 }] }),
      ],
    );
    await client.query(
      `insert into order_sales (order_id, supplier_tenant_id, channel_id, api_client_id, quote_id, idempotency_key, request_hash, currency, sell_minor, markup_bp, fx, fx_buffer_bp, created_at)
       values ($1, $2, $3, $4, $5, $6, 'e2e', 'JPY', 21780, 1000, null, 0, now())`,
      [order.rows[0]?.id, seed.tenantId, seed.channelId, seed.apiClientId, quoteId, crypto.randomUUID()],
    );
    return orderNo;
  } finally {
    await client.end();
  }
}

async function createChannel(request: APIRequestContext): Promise<{ channelId: string; apiClientId: string }> {
  const headers = await platformAdminHeaders(request);
  const channel = await post<{ channel: { id: string } }>(request, headers, "/platform/v1/channels", { type: "own", settle_currency: "JPY", name: `官网-${random(4)}` }, "新建渠道");
  const client = await post<{ api_client: { id: string } }>(request, headers, `/platform/v1/channels/${channel.channel.id}/api-clients`, { name: "官网" }, "发 API 客户端");
  return { channelId: channel.channel.id, apiClientId: client.api_client.id };
}

test("取消政策改了要审核；供应商提交事后加收（上传票据、异议期内）；运营后台看到客人要付的金额，并代客人取消另一张单", async ({ page, request, browser }) => {
  test.setTimeout(90_000);
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  const product = await createProductByApi(request, supplier, world, "airport_transfer");
  const channel = await createChannel(request);
  const seed: Seed = { tenantId: supplier.tenant.tenantId, cityId: world.city.id, airportId: world.airport.id, productId: product.id, groupId: world.group.id, ...channel };
  const completedNo = await seedOrder(seed, { daysAhead: 0, status: "completed" });
  const futureNo = await seedOrder(seed, { daysAhead: 10, status: "confirmed" });

  // 运营：改取消政策 → 提交审核 → 「待审核」里有这一条，政策还是原来的
  const admin = adminCredentials();
  await loginAs(page, "platform", admin.email, admin.password);
  await page.getByRole("link", { name: "取消政策" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "平台统一取消政策" })).toBeVisible();
  const charter = page.getByRole("region", { name: "包车" });
  await expect(charter).toContainText("豪华：用车前 ≥ 48 小时 免费；24–48 小时 扣 50%；< 24 小时 扣 100%");
  await expectAccessible(page, "取消政策");
  await page.getByRole("button", { name: "修改政策" }).click();
  // 包车 · 豪华是包车里的第 4 条：它的第 2 档改成 40%
  await charter.getByLabel("第 2 档：扣对外价（%）").nth(3).fill("40");
  await page.getByLabel("修改原因（给审核的同事看）").fill("豪华包车 24–48 小时降到 40%");
  await page.getByRole("button", { name: "提交审核" }).click();
  await expect(toast(page, "已提交，等另一位同事审核后生效")).toBeVisible();
  await expect(charter).toContainText("豪华：用车前 ≥ 48 小时 免费；24–48 小时 扣 50%", { timeout: 10_000 });
  await page.getByRole("link", { name: "待审核" }).click();
  const card = page.locator(".approval-card").filter({ hasText: "修改平台取消政策" }).first();
  await expect(card).toContainText("包车 · 豪华");
  await expect(card).toContainText("24–48 小时 扣 40%");

  // 供应商：已完成的单 → 提交付费等待 2,000 日元并上传票据 → 异议期内；页面上没有客人付的金额
  const tenantContext = await browser.newContext();
  const tenantPage = await tenantContext.newPage();
  await loginAs(tenantPage, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);
  await tenantPage.getByRole("link", { name: "订单", exact: true }).click();
  await tenantPage.getByRole("row").filter({ hasText: completedNo }).getByRole("link", { name: completedNo }).click();
  await expect(tenantPage.getByRole("heading", { name: "取消规则" })).toBeVisible();
  await tenantPage.getByRole("button", { name: "提交加收" }).click();
  const dialog = tenantPage.getByRole("dialog", { name: "提交事后加收" });
  await dialog.getByLabel(/金额/).fill("2,000");
  await dialog.getByLabel("说明").fill("等了 40 分钟");
  await dialog.getByLabel("票据照片").setInputFiles({ name: "停车票.jpg", mimeType: "image/jpeg", buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]) });
  await expect(dialog).toContainText("已上传：停车票.jpg");
  await dialog.getByRole("button", { name: "提交" }).click();
  await expect(toast(tenantPage, "已提交：客人有 48 小时异议期")).toBeVisible();
  const section = tenantPage.locator("section").filter({ has: tenantPage.getByRole("heading", { name: "事后加收" }) });
  await expect(section).toContainText("异议期内 付费等待 2,000 JPY");
  await expect(tenantPage.getByText(/对外价|2,200/)).toHaveCount(0);
  await expectAccessible(tenantPage, "供应商订单详情（加收）");
  await tenantContext.close();

  // 运营后台：订单列表 → 已完成的那张，加收里有客人要付的 2,200（× 1.1）
  await page.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "订单", exact: true }).click();
  await page.getByLabel("订单号或渠道订单号").fill(completedNo);
  await page.getByRole("button", { name: "查找" }).click();
  await page.getByRole("link", { name: completedNo }).click();
  await expect(page.getByRole("table", { name: "事后加收" })).toContainText("付费等待2,000 JPY / 2,200 JPY");
  await expectAccessible(page, "运营后台订单详情");

  // 代客人取消离用车 10 天的那张：免费，不用审核
  await page.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "订单", exact: true }).click();
  await page.getByLabel("订单号或渠道订单号").fill(futureNo);
  await page.getByRole("button", { name: "查找" }).click();
  await page.getByRole("link", { name: futureNo }).click();
  await page.getByRole("button", { name: "代客人取消" }).click();
  const cancel = page.getByRole("dialog", { name: "代客人取消" });
  await expect(cancel).toContainText("扣款比例0%");
  await cancel.getByLabel("原因说明").fill("客人来电取消");
  await cancel.getByRole("button", { name: "确认取消" }).click();
  await expect(toast(page, "已取消")).toBeVisible();
  await expect(page.locator("section").filter({ has: page.getByRole("heading", { name: "取消", exact: true }) })).toContainText("客人取消（按取消政策扣款）");
});
