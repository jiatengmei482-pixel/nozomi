/**
 * 端到端：运营后台的订单中心和财务结算（M4-03；接口 M4-02 / M5-01）。真实浏览器 → 前端 → 真实 API → 真实 PostgreSQL，不 mock 接口。
 * 1. 运营从订单详情进异常，认领、写说明关闭；审计日志里按中文名看得到这两步。
 * 2. 渠道替客人提投诉工单 → 客服认领、判定成立（达到复核阈值，提交复核）→ 另一位运营在「待审核」里批准 → 供应商在工单里看到判定和应扣款项、申诉。
 * 3. 财务手工出上个月的账 → 供应商确认 → 财务发起付款复核 → 另一位财务批准 → 账单进付款批次。
 * 端到端测试里没有 Stripe：「已经付过款」的订单和它的报价快照、异常由用例用迁移账号直接写进本次运行的 schema（只在测试里构造，运行结束随 schema 删除）。日期跟着今天走。
 */
import { randomInt } from "node:crypto";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { createPool } from "../../api/src/db/pool.ts";
import { createProductByApi, createSupplier, createWorld, expectAccessible, post, toast } from "./catalog.ts";
import { adminCredentials, expectNoHorizontalOverflow, loginAs, newPassword, platformAdminHeaders, uniqueEmail } from "./support.ts";

const ALPHABET = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const random = (length: number, alphabet = ALPHABET): string => Array.from({ length }, () => alphabet[randomInt(alphabet.length)]).join("");
const menu = (page: Page) => page.getByRole("navigation", { name: "主菜单" }).first();

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

/** 一位平台员工（经真实接口邀请、设密码），返回邮箱和密码；第一次在页面上登录时绑定两步验证。 */
async function createStaff(request: APIRequestContext, role: string, name: string): Promise<{ email: string; password: string }> {
  const headers = await platformAdminHeaders(request);
  const email = uniqueEmail(role.replace("_", "-"));
  const password = newPassword();
  const invited = await post<{ invite: { token: string } }>(request, headers, "/platform/v1/staff", { email, name, role }, "邀请员工");
  expect((await request.post("/platform/v1/auth/accept-invite", { data: { token: invited.invite.token, password } })).ok(), "员工设密码").toBe(true);
  return { email, password };
}

/** 亮色、暗色各过一遍 axe；320、768 宽不横向滚动。 */
async function checkLayout(page: Page, what: string): Promise<void> {
  await expectAccessible(page, `${what}（亮色）`);
  await page.emulateMedia({ colorScheme: "dark" });
  await expectAccessible(page, `${what}（暗色）`);
  await page.emulateMedia({ colorScheme: "light" });
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 800 });
    await expectNoHorizontalOverflow(page, `${what}（${width}px）`);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

test("异常：运营从订单详情进超时未派车的异常，认领、写说明关闭；审计日志里按中文名看得到", async ({ page, request }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const seed = await prepare(request);
  const order = await seedOrder(seed, { serviceAt: new Date(Date.now() + 3 * 86_400_000), completed: false });
  // 系统每分钟生成异常；这里直接写一条和定时任务同样来源键的（定时任务看到已有就不再建）
  const exceptionId = await owner(async (client) => {
    const row = await client.query<{ id: string }>(
      `insert into order_exceptions (type, source_key, order_id, supplier_tenant_id, detail, status, opened_at, due_at, created_at, updated_at)
       values ('dispatch_overdue', $1, $2, $3, $4::jsonb, 'open', now(), now(), now(), now())
       on conflict (type, source_key) do update set updated_at = excluded.updated_at returning id`,
      [`order:${seed.tenantId}:${order.id}`, order.id, seed.tenantId, JSON.stringify({ dispatch_due_at: new Date(Date.now() - 3_600_000).toISOString() })],
    );
    return row.rows[0]?.id as string;
  });

  const admin = adminCredentials();
  await loginAs(page, "platform", admin.email, admin.password);
  await expect(page.getByRole("link", { name: "异常队列", description: /待处理和处理中/ })).toBeVisible();
  await menu(page).getByRole("link", { name: "订单", exact: true }).click();
  await page.getByLabel("订单号或渠道订单号").fill(order.orderNo);
  await page.getByRole("button", { name: "查找" }).click();
  const row = page.getByRole("row").filter({ hasText: order.orderNo });
  await expect(row).toContainText("1 条没处理完");
  await row.getByRole("link", { name: order.orderNo }).click();
  const section = page.locator("section").filter({ has: page.getByRole("heading", { name: "异常", exact: true }) });
  await section.getByRole("link", { name: "超时未派车" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "超时未派车" })).toBeVisible();
  await expect(page.getByText("电话催租户；用车前 6 小时仍未派车，自动进入救援改派")).toBeVisible();
  await checkLayout(page, "异常详情");

  await page.getByRole("button", { name: "认领" }).click();
  await expect(toast(page, "已认领，现在由你处理")).toBeVisible();
  await page.getByRole("button", { name: "写说明并关闭" }).click();
  const dialog = page.getByRole("dialog", { name: "关闭这条异常？" });
  await dialog.getByRole("button", { name: "关闭异常" }).click();
  await expect(dialog).toContainText("请写处理说明：做了什么、结果怎样");
  await dialog.getByLabel(/处理说明/).fill("已电话催供应商，14:20 派车");
  await dialog.getByRole("button", { name: "关闭异常" }).click();
  await expect(toast(page, "已关闭这条异常")).toBeVisible();
  await expect(page.getByText("已关闭，不能再认领或修改。")).toBeVisible();
  await expect(page.getByText("已电话催供应商，14:20 派车")).toBeVisible();

  // 全部操作留审计：认领、关闭按中文名列在审计日志里
  await page.getByRole("link", { name: "看这条异常的操作记录" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "审计日志" })).toBeVisible();
  const logs = page.getByRole("region", { name: /审计日志/ }).first();
  await expect(logs).toContainText("认领 / 转交");
  await expect(logs).toContainText("写说明关闭");
  await expect(logs).toContainText("订单异常");
  expect(exceptionId).toBeTruthy();
});

test("工单：渠道替客人投诉 → 客服判定成立（达到复核阈值）→ 另一位运营批准 → 供应商看到判定和应扣款项并申诉", async ({ page, request, browser }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const seed = await prepare(request);
  const order = await seedOrder(seed, { serviceAt: new Date(Date.now() - 2 * 3_600_000), completed: true });
  const token = await request.post("/sales/v1/oauth/token", { data: { grant_type: "client_credentials", client_id: seed.clientId, client_secret: seed.clientSecret } });
  expect(token.ok(), "渠道换令牌").toBe(true);
  const salesHeaders = { authorization: `Bearer ${((await token.json()) as { access_token: string }).access_token}` };
  const created = await post<{ ticket: { ticket_no: string } }>(request, salesHeaders, `/sales/v1/orders/${order.id}/tickets`, { type: "complaint", subject: "司机迟到 40 分钟", description: "客人说司机 10:40 才到，航班 10:00 落地。", language: "zh", raised_by: "guest" }, "渠道提投诉");
  const ticketNo = created.ticket.ticket_no;
  const reviewer = await createStaff(request, "operations", "端到端复核人");

  // 客服（这里用超级管理员）：工单 → 找到这张 → 认领 → 判定成立，先试算，达到阈值提交复核
  const admin = adminCredentials();
  await loginAs(page, "platform", admin.email, admin.password);
  await menu(page).getByRole("link", { name: "工单", exact: true }).click();
  await page.getByRole("searchbox", { name: /按工单号或订单号查找/ }).fill(ticketNo);
  await page.getByRole("link", { name: ticketNo }).click();
  await expect(page.getByRole("heading", { level: 1, name: `工单 ${ticketNo}` })).toBeVisible();
  await expect(page.getByText("客人说司机 10:40 才到，航班 10:00 落地。")).toBeVisible();
  await checkLayout(page, "工单详情");
  await page.getByRole("button", { name: "认领" }).click();
  await expect(toast(page, "已认领，现在由你处理")).toBeVisible();
  await page.getByRole("button", { name: "判定" }).click();
  const decide = page.getByRole("dialog", { name: "判定：客人投诉" });
  await decide.getByRole("radio", { name: "成立", exact: true }).check();
  await decide.getByLabel(/是哪种问题/).selectOption("late_30_plus");
  await decide.getByRole("radio", { name: new RegExp(`供应商（${seed.tenantName}）`) }).check();
  await decide.getByLabel(/判定说明/).fill("司机定位显示 10:40 到达，迟到 40 分钟。");
  await decide.getByRole("button", { name: "试算" }).click();
  await expect(decide.getByText("JPY 10,890").first()).toBeVisible();
  await expect(decide).toContainText("达到了复核阈值");
  await decide.getByRole("button", { name: "提交复核" }).click();
  await expect(toast(page, "判定已提交复核")).toBeVisible();
  await expect(page.getByText("判定待复核").first()).toBeVisible();

  // 另一位运营：待审核 → 批准这张工单的判定
  const reviewerContext = await browser.newContext();
  const reviewerPage = await reviewerContext.newPage();
  await reviewerPage.setViewportSize({ width: 1280, height: 900 });
  await loginAs(reviewerPage, "platform", reviewer.email, reviewer.password);
  await menu(reviewerPage).getByRole("link", { name: "待审核" }).click();
  const card = reviewerPage.locator("section.approval-card").filter({ hasText: ticketNo });
  await expect(card.getByRole("heading", { name: "工单判定（赔付达到复核阈值）" })).toBeVisible();
  await expect(card).toContainText("JPY 10,890");
  await checkLayout(reviewerPage, "待审核（工单判定）");
  await card.getByRole("button", { name: /^批准/ }).click();
  const confirm = reviewerPage.getByRole("dialog", { name: "批准：工单判定（赔付达到复核阈值）" });
  await expect(confirm).toContainText("批准后按发起时的判定执行");
  await confirm.getByRole("button", { name: "批准" }).click();
  await expect(toast(reviewerPage, "已批准")).toBeVisible();
  await reviewerContext.close();

  await page.reload();
  await expect(page.getByText("已判定").first()).toBeVisible();
  const compensation = page.locator("section").filter({ has: page.getByRole("heading", { name: "赔付", exact: true }) });
  await expect(compensation).toContainText("JPY 10,890");
  await expect(compensation).toContainText("待财务另付");

  // 供应商：工单 → 看到判定、应扣款项（结算价 × 50%），看不到客人那边的金额 → 申诉
  const tenantContext = await browser.newContext();
  const tenantPage = await tenantContext.newPage();
  await tenantPage.setViewportSize({ width: 1280, height: 900 });
  await loginAs(tenantPage, "tenant", seed.adminEmail, seed.password);
  await menu(tenantPage).getByRole("link", { name: "工单", exact: true }).click();
  await tenantPage.getByRole("combobox", { name: /状态/ }).selectOption("all");
  await tenantPage.getByRole("link", { name: ticketNo }).click();
  await expect(tenantPage.getByText("这个判定对你们不利，可以申诉一次")).toBeVisible();
  await expect(tenantPage.getByText("客人赔付 JPY 9,900")).toBeVisible();
  await expect(tenantPage.getByText(/21,780|10,890|内部备注/)).toHaveCount(0);
  await checkLayout(tenantPage, "供应商工单详情");
  await tenantPage.getByRole("button", { name: "申诉" }).click();
  const appeal = tenantPage.getByRole("dialog", { name: "对这个判定申诉" });
  await appeal.getByLabel(/为什么不同意/).fill("司机 10:05 已到达，客人 10:40 才出来，见到达屏照片。");
  await appeal.getByRole("button", { name: "提交申诉" }).click();
  await expect(toast(tenantPage, "已提交申诉")).toBeVisible();
  await expect(tenantPage.getByRole("heading", { level: 1, name: /^工单 TK/ })).toBeVisible();
  await expect(tenantPage.getByText("供应商申诉").first()).toBeVisible();
  await tenantContext.close();

  // 运营后台的原工单上看得到这条申诉
  await page.reload();
  await expect(page.locator("section").filter({ has: page.getByRole("heading", { name: "判定", exact: true }) })).toContainText("供应商的申诉");
});

test("财务结算：手工出上个月的账 → 供应商确认 → 财务发起付款复核 → 另一位财务批准 → 账单进付款批次", async ({ page, request, browser }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const seed = await prepare(request);
  // 东京时间上个月 15 日 10:00 用车、已完成
  const tokyoToday = new Date(Date.now() + 9 * 3_600_000);
  const lastMonth = new Date(Date.UTC(tokyoToday.getUTCFullYear(), tokyoToday.getUTCMonth() - 1, 15, 1, 0));
  const period = new Date(lastMonth.getTime() + 9 * 3_600_000).toISOString().slice(0, 7);
  await seedOrder(seed, { serviceAt: lastMonth, completed: true });
  const reviewer = await createStaff(request, "finance", "端到端财务复核人");

  const admin = adminCredentials();
  await loginAs(page, "platform", admin.email, admin.password);
  await menu(page).getByRole("link", { name: "账单" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "账单" })).toBeVisible();
  await page.getByRole("button", { name: "手工出账" }).first().click();
  const generate = page.getByRole("dialog", { name: "手工出账" });
  await generate.getByLabel(/周期/).fill(period);
  await generate.getByRole("button", { name: "出账" }).click();
  await expect(generate).toContainText("新出了");
  await generate.getByRole("button", { name: "知道了" }).click();
  await page.getByRole("combobox", { name: /周期/ }).selectOption(period);
  const row = page.getByRole("row").filter({ hasText: seed.tenantName });
  await expect(row).toContainText("JPY 19,800");
  await expect(row).toContainText("待确认");
  await checkLayout(page, "账单列表");
  const statementNo = (await row.getByRole("link").first().textContent()) ?? "";
  await row.getByRole("link", { name: statementNo }).click();
  await expect(page.getByRole("heading", { level: 1, name: `账单 ${statementNo}` })).toBeVisible();
  const statementUrl = page.url();

  // 供应商：账单 → 确认
  const tenantContext = await browser.newContext();
  const tenantPage = await tenantContext.newPage();
  await tenantPage.setViewportSize({ width: 1280, height: 900 });
  await loginAs(tenantPage, "tenant", seed.adminEmail, seed.password);
  await expect(tenantPage.getByRole("link", { name: "1 张账单待你们确认" })).toBeVisible();
  await menu(tenantPage).getByRole("link", { name: "账单", exact: true }).click();
  await tenantPage.getByRole("link", { name: statementNo }).click();
  await expect(tenantPage.getByText("请核对并确认")).toBeVisible();
  await expect(tenantPage.getByText(/21,780|加价/)).toHaveCount(0);
  await checkLayout(tenantPage, "供应商账单详情");
  await tenantPage.getByRole("button", { name: "确认账单" }).click();
  await tenantPage.getByRole("dialog", { name: "确认这张账单？" }).getByRole("button", { name: "确认账单" }).click();
  await expect(toast(tenantPage, "已确认账单")).toBeVisible();
  await tenantContext.close();

  // 财务（管理员）：发起付款复核
  await page.reload();
  await expect(page.getByText("待复核").first()).toBeVisible();
  await page.getByRole("button", { name: "发起付款复核" }).click();
  await page.getByRole("dialog", { name: "发起付款复核" }).getByRole("button", { name: "提交复核" }).click();
  await expect(toast(page, "已提交付款复核")).toBeVisible();
  await expect(page.getByText("付款复核待审核")).toBeVisible();

  // 另一位财务：待审核 → 批准
  const reviewerContext = await browser.newContext();
  const reviewerPage = await reviewerContext.newPage();
  await reviewerPage.setViewportSize({ width: 1280, height: 900 });
  await loginAs(reviewerPage, "platform", reviewer.email, reviewer.password);
  await menu(reviewerPage).getByRole("link", { name: "待审核" }).click();
  const card = reviewerPage.locator("section.approval-card").filter({ hasText: statementNo });
  await expect(card.getByRole("heading", { name: "付款给供应商" })).toBeVisible();
  await card.getByRole("button", { name: /^批准/ }).click();
  await reviewerPage.getByRole("dialog", { name: "批准：付款给供应商" }).getByRole("button", { name: "批准" }).click();
  await expect(toast(reviewerPage, "已批准")).toBeVisible();
  await reviewerContext.close();

  // 账单进了付款批次
  await page.goto(statementUrl);
  await expect(page.getByText("待付款").first()).toBeVisible();
  await page.locator("dl").getByRole("link").filter({ hasText: /\d{4}-\d{2}-20/ }).click();
  await expect(page.getByRole("heading", { level: 1, name: /^付款批次 \d{4}-\d{2}-20$/ })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: statementNo })).toContainText("JPY 19,800");
  await checkLayout(page, "付款批次详情");
});

test("官网投诉和反馈：客人在订单页提投诉 → 运营在工单列表看到、回复客人 → 客人在订单页看到回复", async ({ page, request, browser }) => {
  test.setTimeout(180_000);
  const seed = await prepare(request);
  // 官网是 global-setup 建好的那个渠道：订单挂在它下面，客人才能凭订单链接看
  const site = await owner(async (client) => (await client.query<{ channel_id: string; id: string }>("select c.id as channel_id, a.id from channels c join channel_api_clients a on a.channel_id = c.id where c.name = 'NOZOMI 官网（端到端测试）' order by a.created_at limit 1")).rows[0]);
  expect(site, "global-setup 建的官网渠道").toBeTruthy();
  const order = await seedOrder({ ...seed, channelId: site?.channel_id as string, apiClientId: site?.id as string }, { serviceAt: new Date(Date.now() - 3 * 3_600_000), completed: true });
  const lookup = await request.post("/site/v1/orders/lookup", { data: { order_no: order.orderNo, contact: "guest@e2e.example.com" } });
  expect(lookup.ok(), `找回订单链接：${await lookup.text()}`).toBe(true);
  const token = ((await lookup.json()) as { link: { token: string } }).link.token;

  // 客人：订单页 → 投诉和反馈 → 提交
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.setViewportSize({ width: 400, height: 800 });
  await guest.goto(`/book/order#${token}`);
  await expect(guest.getByRole("heading", { level: 1, name: `订单 ${order.orderNo}` })).toBeVisible();
  const block = guest.locator("section").filter({ has: guest.getByRole("heading", { level: 2, name: "投诉和反馈" }) });
  await block.getByRole("button", { name: "提交投诉或反馈" }).click();
  await block.getByRole("radio", { name: /投诉服务/ }).check();
  await block.getByLabel(/一句话说明/).fill("司机迟到了 40 分钟");
  await block.getByLabel(/经过/).fill("航班 10:00 落地，司机 10:40 才到，也没有举牌。");
  await block.getByRole("button", { name: "提交", exact: true }).click();
  await expect(block).toContainText("已提交。平台一般 2 小时内答复");
  await expect(block).toContainText("投诉服务：司机迟到了 40 分钟");
  const ticketNo = (/TK\d{8}[0-9A-Z]{6}/.exec((await block.textContent()) ?? "") ?? [""])[0];
  expect(ticketNo).not.toBe("");
  await expect(guest).toHaveURL(new RegExp(`/book/order#${token}$`));
  for (const width of [320, 360, 768]) {
    await guest.setViewportSize({ width, height: 800 });
    await expectNoHorizontalOverflow(guest, `官网订单页的投诉和反馈（${width}px）`);
  }
  await expectAccessible(guest, "官网订单页的投诉和反馈（亮色）");
  await guest.emulateMedia({ colorScheme: "dark" });
  await expectAccessible(guest, "官网订单页的投诉和反馈（暗色）");
  await guest.emulateMedia({ colorScheme: "light" });

  // 运营：工单列表里有这张（来源客人）→ 回复客人
  await page.setViewportSize({ width: 1280, height: 900 });
  const admin = adminCredentials();
  await loginAs(page, "platform", admin.email, admin.password);
  await menu(page).getByRole("link", { name: "工单", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: ticketNo });
  await expect(row).toContainText("司机迟到了 40 分钟");
  await row.getByRole("link", { name: ticketNo }).click();
  await expect(page.getByText("航班 10:00 落地，司机 10:40 才到，也没有举牌。")).toBeVisible();
  const reply = page.locator("section").filter({ has: page.getByRole("heading", { name: "回复客人" }) });
  await reply.getByLabel("给客人的回复").fill("您好，我们已联系司机核实，24 小时内给您结果。");
  await reply.getByRole("button", { name: "回复客人" }).click();
  await expect(toast(page, "已回复客人")).toBeVisible();
  await expect(reply).toContainText("您好，我们已联系司机核实");
  await checkLayout(page, "工单详情（回复客人）");

  // 客人：刷新订单页，看到平台的回复；供应商看不到这段回复
  await guest.reload();
  await expect(block.getByRole("list", { name: "平台对「司机迟到了 40 分钟」的回复" })).toContainText("您好，我们已联系司机核实，24 小时内给您结果。");
  await guestContext.close();
  const tenantContext = await browser.newContext();
  const tenantPage = await tenantContext.newPage();
  await loginAs(tenantPage, "tenant", seed.adminEmail, seed.password);
  await menu(tenantPage).getByRole("link", { name: "工单", exact: true }).click();
  await tenantPage.getByRole("link", { name: ticketNo }).click();
  await expect(tenantPage.getByText("航班 10:00 落地，司机 10:40 才到，也没有举牌。")).toBeVisible();
  await expect(tenantPage.getByText("您好，我们已联系司机核实")).toHaveCount(0);
  await tenantContext.close();
});
