/**
 * 端到端：运营代供应商回传履约（M4-18，ADR 0052）。真实浏览器 → 前端 → 真实 API → 真实 PostgreSQL，不 mock 接口。
 * 供应商已派车 → 运营在订单详情代传出发、到达、接到客人（写原因）→ 流水里标平台代传 → 代传完成提交审核，单子仍在服务中 → 另一位同事批准 → 已完成；
 * 供应商的订单详情看得到平台代传，看不到原因；只读员工在订单详情没有入口。
 * 端到端测试里没有 Stripe：「已经付过款」的订单由用例用迁移账号直接写进本次运行的 schema（只在测试里构造，运行结束随 schema 删除）。日期跟着今天走。
 */
import { randomInt, randomUUID } from "node:crypto";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { createPool } from "../../api/src/db/pool.ts";
import { createProductByApi, createSupplier, createWorld, expectAccessible, post, tenantHeaders, toast } from "./catalog.ts";
import { approveApproval, expectNoHorizontalOverflow, loginAs, newPassword, adminCredentials, pendingApproval, platformAdminHeaders, uniqueEmail } from "./support.ts";

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

/** 一位平台员工（经真实接口邀请、设密码），返回邮箱和密码；第一次在页面上登录时绑定两步验证。 */

/** 一位平台员工（经真实接口邀请、设密码），返回邮箱和密码；第一次在页面上登录时绑定两步验证。 */
async function createStaff(request: APIRequestContext, role: string, name: string): Promise<{ email: string; password: string }> {
  const headers = await platformAdminHeaders(request);
  const email = uniqueEmail(role.replace("_", "-"));
  const password = newPassword();
  const invited = await post<{ invite: { token: string } }>(request, headers, "/platform/v1/staff", { email, name, role }, "邀请员工");
  expect((await request.post("/platform/v1/auth/accept-invite", { data: { token: invited.invite.token, password } })).ok(), "员工设密码").toBe(true);
  return { email, password };
}

/** 供应商经真实接口登记司机和车辆、派车。 */
async function dispatchByTenant(request: APIRequestContext, seed: Seed, orderId: string): Promise<void> {
  const headers = await tenantHeaders(request, seed.adminEmail, seed.password);
  const create = async <T>(path: string, data: unknown): Promise<T> => post<T>(request, { ...headers, "idempotency-key": randomUUID() }, path, data, path);
  const driver = await create<{ id: string }>("/tenant/v1/drivers", { name: "佐藤一郎", phone: `+8190${randomInt(10_000_000, 99_999_999)}`, languages: ["ja", "zh"], license_expires_on: "2035-01-01", driving_years: 12, gold: false });
  const vehicle = await create<{ id: string }>("/tenant/v1/vehicles", { plate: `品川 300 あ ${randomInt(1000, 9999)}`, vehicle_group_id: seed.groupId, model: "丰田埃尔法", color: "黑", seats: 7, mileage_km: 30000, plate_type: "business", insurance_expires_on: "2035-01-01", inspection_expires_on: "2035-01-01" });
  const version = (await (await request.get(`/tenant/v1/orders/${orderId}`, { headers })).json()).order.version as number;
  const res = await request.post(`/tenant/v1/orders/${orderId}/assign`, { headers: { ...headers, "if-match": `"${version}"` }, data: { driver_id: driver.id, vehicle_id: vehicle.id } });
  expect(res.ok(), await res.text()).toBe(true);
}

async function proxyStep(page: Page, name: string, reason: string): Promise<void> {
  await page.getByRole("button", { name: `代传「${name}」` }).click();
  const dialog = page.getByRole("dialog", { name: `代供应商回传：${name}` });
  await dialog.getByLabel("原因").fill(reason);
  await dialog.getByRole("button", { name: "确认代传" }).click();
  await expect(toast(page, `已代传：${name}`)).toBeVisible();
  await expect(dialog).toBeHidden();
}

test("代传出发、到达、接到客人立即生效；代传完成要另一位同事批准；供应商看得到平台代传、看不到原因；只读员工没有入口", async ({ page, request, browser }) => {
  test.setTimeout(120_000);
  const seed = await prepare(request);
  const { id, orderNo } = await seedOrder(seed, { serviceAt: new Date(Date.now() + 3_600_000), completed: false });
  await dispatchByTenant(request, seed, id);
  const reason = `供应商调度系统故障-${random(4)}`;

  const admin = adminCredentials();
  await loginAs(page, "platform", admin.email, admin.password);
  await page.goto(`/platform/orders/${id}`);
  await expect(page.getByRole("heading", { level: 1, name: `订单 ${orderNo}` })).toBeVisible();
  await expect(page.getByRole("heading", { name: "代供应商回传履约" })).toBeVisible();

  // 没写原因不提交
  await page.getByRole("button", { name: "代传「司机已出发」" }).click();
  const first = page.getByRole("dialog", { name: "代供应商回传：司机已出发" });
  await expect(first).toContainText("看不到原因和操作人");
  await expectAccessible(page, "代传确认框");
  await first.getByRole("button", { name: "确认代传" }).click();
  await expect(first).toContainText("请写明为什么要代传");
  await first.getByRole("button", { name: "不代传了" }).click();

  await proxyStep(page, "司机已出发", reason);
  await proxyStep(page, "司机已到达", reason);
  await proxyStep(page, "已接到客人", reason);
  const flow = page.locator("section").filter({ has: page.getByRole("heading", { name: "状态流水" }) });
  await expect(flow.getByText("平台代传")).toHaveCount(3);
  await expect(flow).toContainText(reason);

  // 完成：提交审核，还没生效，按钮换成提示
  await page.getByRole("button", { name: "代传「已完成」" }).click();
  const done = page.getByRole("dialog", { name: "代供应商回传：已完成" });
  await expect(done).toContainText("会进供应商账单");
  await done.getByLabel("原因").fill(reason);
  await done.getByRole("button", { name: "提交审核" }).click();
  await expect(toast(page, "要另一位同事在「待审核」里批准才算完成")).toBeVisible();
  await expect(page.getByRole("link", { name: "去待审核" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^代传/ })).toHaveCount(0);
  await page.setViewportSize({ width: 320, height: 800 });
  await expectNoHorizontalOverflow(page, "订单详情（代传，320px）");
  await page.setViewportSize({ width: 1280, height: 800 });

  // 待审核页写得清楚
  await page.getByRole("link", { name: "去待审核" }).click();
  const card = page.locator(".approval-card").filter({ hasText: orderNo });
  await expect(card).toContainText("代供应商回传「已完成」");
  await expect(card.getByRole("link", { name: orderNo })).toBeVisible();

  await approveApproval(request, await pendingApproval(request, id, "order.proxy_complete"));
  await page.goto(`/platform/orders/${id}`);
  await expect(page.getByRole("heading", { level: 1, name: `订单 ${orderNo}` })).toBeVisible();
  await expect(page.locator("section").filter({ has: page.getByRole("heading", { name: "行程" }) }).getByText("已完成")).toBeVisible();
  await expect(page.getByRole("heading", { name: "代供应商回传履约" })).toHaveCount(0);
  await expect(flow.getByText("平台代传")).toHaveCount(4);

  // M4-19：派车、履约时间点、落地都显示，代传的节点标出来
  const section = (name: RegExp) => page.locator("section").filter({ has: page.getByRole("heading", { name }) });
  await expect(section(/^派车（/)).toContainText("佐藤一郎");
  await expect(section(/^履约（/).getByText("平台代传")).toHaveCount(4);
  await expect(section(/^履约（/)).toContainText("（没有定位）");
  await expect(section(/^履约（/)).not.toContainText("还没有记录");
  await expect(section(/^落地（/)).toContainText("计划到达");
  await expect(section(/^落地（/)).toContainText("来源：计划到达时间");
  await expect(section(/^落地（/)).toContainText("客人没有确认");
  await expect(flow).not.toContainText("DEPARTED");
  await expectAccessible(page, "订单详情（派车、履约、落地）");

  // 供应商：看得到平台代传，看不到原因
  const tenantContext = await browser.newContext();
  const tenantPage = await tenantContext.newPage();
  await loginAs(tenantPage, "tenant", seed.adminEmail, seed.password);
  await tenantPage.goto(`/orders/${id}`);
  const tenantFlow = tenantPage.locator("section").filter({ has: tenantPage.getByRole("heading", { name: "状态流水" }) });
  await expect(tenantFlow.getByText("平台代传")).toHaveCount(4);
  await expect(tenantPage.locator("body")).not.toContainText(reason);
  await tenantContext.close();

  // 只读员工：没有入口
  const reader = await createStaff(request, "readonly", "只读同事");
  const { id: otherId, orderNo: otherNo } = await seedOrder(seed, { serviceAt: new Date(Date.now() + 3_600_000), completed: false });
  await dispatchByTenant(request, seed, otherId);
  const readerContext = await browser.newContext();
  const readerPage = await readerContext.newPage();
  await loginAs(readerPage, "platform", reader.email, reader.password);
  await readerPage.goto(`/platform/orders/${otherId}`);
  await expect(readerPage.getByRole("heading", { level: 1, name: `订单 ${otherNo}` })).toBeVisible();
  await expect(readerPage.getByRole("heading", { name: "代供应商回传履约" })).toHaveCount(0);
  await expect(readerPage.getByRole("button", { name: /^代传/ })).toHaveCount(0);
  await readerContext.close();
});
