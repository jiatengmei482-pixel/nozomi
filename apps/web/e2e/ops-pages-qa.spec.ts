/**
 * M4-03 测试角色的端到端（真实浏览器 → 前端 → 真实 API → 真实 PostgreSQL）：
 * 1. 超长内容（200 字不带空格的标题、带超长网址的经过、长回复和备注）在 320 / 768 宽不撑破运营后台和供应商后台的工单页、官网订单页的投诉和反馈；
 * 2. 键盘：用键盘打开「关闭工单」对话框，焦点进对话框、Tab 不跑出去，Esc 关掉后焦点回到按钮；
 * 3. 没权限的角色（技术）直接打开工单、异常队列、账单、付款批次的地址：写「你没有权限查看这里」，页面不报错；
 * 4. 全部操作留审计：工单的认领、转交、留言、内部备注、征求意见、关闭做完后，审计日志页按中文名列出来。
 * 数据由用例经真实接口建出（订单用迁移账号写进本次运行的 schema，和 order-center.spec.ts 一样），运行结束随 schema 删除。
 */
import { randomInt } from "node:crypto";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { createPool } from "../../api/src/db/pool.ts";
import { createProductByApi, createSupplier, createWorld, post } from "./catalog.ts";
import { adminCredentials, loginAs, newPassword, platformAdminHeaders, uniqueEmail } from "./support.ts";

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
async function createStaff(request: APIRequestContext, role: string, name: string): Promise<{ email: string; password: string }> {
  const headers = await platformAdminHeaders(request);
  const email = uniqueEmail(role.replace("_", "-"));
  const password = newPassword();
  const invited = await post<{ invite: { token: string } }>(request, headers, "/platform/v1/staff", { email, name, role }, "邀请员工");
  expect((await request.post("/platform/v1/auth/accept-invite", { data: { token: invited.invite.token, password } })).ok(), "员工设密码").toBe(true);
  return { email, password };
}


const LONG_SUBJECT = "超长".repeat(10) + "X".repeat(180);
const LONG_URL = `https://example.com/${"a".repeat(400)}?q=${"b".repeat(200)}`;
const LONG_DESCRIPTION = `客人发来的截图链接：${LONG_URL}\n${"司机说他已经到了但客人没有看到他。".repeat(60)}`;

async function salesHeaders(request: APIRequestContext, seed: Seed): Promise<Record<string, string>> {
  const token = await request.post("/sales/v1/oauth/token", { data: { grant_type: "client_credentials", client_id: seed.clientId, client_secret: seed.clientSecret } });
  expect(token.ok(), "渠道换令牌").toBe(true);
  return { authorization: `Bearer ${((await token.json()) as { access_token: string }).access_token}` };
}

async function call(request: APIRequestContext, headers: Record<string, string>, path: string, data: unknown, what: string): Promise<void> {
  const res = await request.post(path, { headers, data });
  expect(res.ok(), `${what}：${await res.text()}`).toBe(true);
}

/** 320、768 宽不横向溢出。用 soft 断言：一页撑破了，其余几页照样检查、一起报出来（报告里写出是哪个元素撑破的）。 */
async function widths(page: Page, what: string): Promise<void> {
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 800 });
    const found = await page.evaluate(() => {
      const main = document.querySelector("main");
      const culprits = [...document.querySelectorAll("main *")]
        .filter((el) => el.scrollWidth > el.clientWidth + 1 && el.clientWidth > 0 && getComputedStyle(el).overflowX === "visible")
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}（${el.scrollWidth}px > ${el.clientWidth}px）`);
      return { page: document.documentElement.scrollWidth - document.documentElement.clientWidth, main: main ? main.scrollWidth - main.clientWidth : 0, culprits: culprits.slice(-3) };
    });
    expect.soft(found.page, `${what}（${width}px）：页面横向溢出`).toBe(0);
    expect.soft(found.main, `${what}（${width}px）：内容区横向溢出，撑破的是 ${found.culprits.join("、")}`).toBe(0);
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

test("超长内容不撑破页面（320 / 768 宽）：运营后台工单列表、详情，供应商后台工单列表、详情", async ({ page, request, browser }) => {
  test.setTimeout(180_000);
  const seed = await prepare(request);
  const order = await seedOrder(seed, { serviceAt: new Date(Date.now() - 2 * 3_600_000), completed: true });
  const created = await post<{ ticket: { id: string; ticket_no: string } }>(request, await salesHeaders(request, seed), `/sales/v1/orders/${order.id}/tickets`, { type: "complaint", subject: LONG_SUBJECT, description: LONG_DESCRIPTION, language: "zh", raised_by: "guest" }, "渠道提投诉");
  const admin = await platformAdminHeaders(request);
  const ticket = created.ticket;
  await call(request, admin, `/platform/v1/tickets/${ticket.id}/messages`, { body: `请供应商看一下：${LONG_URL}` }, "给供应商留言");
  await call(request, admin, `/platform/v1/tickets/${ticket.id}/messages`, { body: `内部：${LONG_URL}`, internal: true }, "内部备注");
  await call(request, admin, `/platform/v1/tickets/${ticket.id}/messages`, { body: `给客人：${LONG_URL}`, to_guest: true }, "回复客人");

  const credentials = adminCredentials();
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAs(page, "platform", credentials.email, credentials.password);
  await page.goto(`/platform/tickets/${ticket.id}`);
  await expect(page.getByRole("heading", { level: 1, name: `工单 ${ticket.ticket_no}` })).toBeVisible();
  await expect(page.getByText(`内部：${LONG_URL}`)).toBeVisible();
  await widths(page, "运营后台工单详情（超长内容）");
  await page.goto("/platform/tickets");
  await expect(page.getByRole("link", { name: ticket.ticket_no })).toBeVisible();
  await widths(page, "运营后台工单列表（超长标题）");

  const tenantContext = await browser.newContext();
  const tenantPage = await tenantContext.newPage();
  await tenantPage.setViewportSize({ width: 1280, height: 900 });
  await loginAs(tenantPage, "tenant", seed.adminEmail, seed.password);
  await tenantPage.goto(`/tickets/${ticket.id}`);
  await expect(tenantPage.getByText(`请供应商看一下：${LONG_URL}`)).toBeVisible();
  await expect(tenantPage.getByText(`给客人：${LONG_URL}`)).toHaveCount(0);
  await expect(tenantPage.getByText(`内部：${LONG_URL}`)).toHaveCount(0);
  await widths(tenantPage, "供应商后台工单详情（超长内容）");
  await tenantPage.goto("/tickets");
  await widths(tenantPage, "供应商后台工单列表（超长标题）");
  await tenantContext.close();
});

test("超长内容不撑破页面（320 / 360 / 768 宽）：官网订单页的投诉和反馈——客人提 200 字不带空格的一句话说明，平台回复一段超长网址", async ({ page, request }) => {
  test.setTimeout(120_000);
  const seed = await prepare(request);
  const site = await owner(async (client) => (await client.query<{ channel_id: string; id: string }>("select c.id as channel_id, a.id from channels c join channel_api_clients a on a.channel_id = c.id where c.name = 'NOZOMI 官网（端到端测试）' order by a.created_at limit 1")).rows[0]);
  expect(site, "global-setup 建的官网渠道").toBeTruthy();
  const order = await seedOrder({ ...seed, channelId: site?.channel_id as string, apiClientId: site?.id as string }, { serviceAt: new Date(Date.now() - 3 * 3_600_000), completed: true });
  const lookup = await request.post("/site/v1/orders/lookup", { data: { order_no: order.orderNo, contact: "guest@e2e.example.com" } });
  expect(lookup.ok(), `找回订单链接：${await lookup.text()}`).toBe(true);
  const token = ((await lookup.json()) as { link: { token: string } }).link.token;
  const created = await request.post("/site/v1/order/tickets", { headers: { authorization: `Bearer ${token}` }, data: { type: "complaint", subject: LONG_SUBJECT, description: LONG_DESCRIPTION } });
  expect(created.status(), await created.text()).toBe(201);
  const ticketId = ((await created.json()) as { ticket: { id: string } }).ticket.id;
  await call(request, await platformAdminHeaders(request), `/platform/v1/tickets/${ticketId}/messages`, { body: `请看这里：${LONG_URL}`, to_guest: true }, "回复客人");

  await page.setViewportSize({ width: 400, height: 800 });
  await page.goto(`/book/order#${token}`);
  const block = page.locator("section").filter({ has: page.getByRole("heading", { level: 2, name: "投诉和反馈" }) });
  await expect(block.getByText(`请看这里：${LONG_URL}`)).toBeVisible();
  for (const width of [320, 360, 768]) {
    await page.setViewportSize({ width, height: 800 });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect.soft(overflow, `官网订单页的投诉和反馈（${width}px）横向溢出`).toBe(0);
  }
});

test("键盘和对话框焦点：Tab 到「关闭工单」回车打开，焦点在对话框里、连按 Tab 不跑出去；Esc 关掉后焦点回到「关闭工单」；说明没写时错误和输入框关联", async ({ page, request }) => {
  test.setTimeout(120_000);
  const seed = await prepare(request);
  const order = await seedOrder(seed, { serviceAt: new Date(Date.now() - 2 * 3_600_000), completed: true });
  const created = await post<{ ticket: { id: string; ticket_no: string } }>(request, await salesHeaders(request, seed), `/sales/v1/orders/${order.id}/tickets`, { type: "other", subject: "要发票", description: "请开发票", language: "zh", raised_by: "guest" }, "渠道提工单");
  const credentials = adminCredentials();
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAs(page, "platform", credentials.email, credentials.password);
  await page.goto(`/platform/tickets/${created.ticket.id}`);
  const closeButton = page.getByRole("button", { name: "关闭工单" });
  await expect(closeButton).toBeVisible();
  // 从「交给同事」出发按 Tab 走到「关闭工单」（只用键盘）
  await page.getByRole("button", { name: "认领" }).focus();
  for (let i = 0; i < 10 && !(await closeButton.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
  await expect(closeButton).toBeFocused();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // 原生模态对话框：Tab 到最后会短暂落到浏览器自己的界面（activeElement 是 body），这不算跑出去；不能落到对话框后面的页面元素上
  const inside = (): Promise<boolean> => page.evaluate(() => document.activeElement === null || document.activeElement === document.body || document.activeElement.closest("dialog") !== null);
  expect(await inside(), "打开后焦点在对话框里").toBe(true);
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    expect(await inside(), `第 ${i + 1} 次 Tab 后焦点还在对话框里`).toBe(true);
  }
  // 不写说明直接提交：错误提示和输入框关联（读屏能读到）
  await dialog.getByRole("button", { name: /关闭工单|确认/ }).last().click();
  const field = dialog.getByRole("textbox").first();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  const describedBy = (await field.getAttribute("aria-describedby")) ?? "";
  expect(describedBy, "错误提示用 aria-describedby 关联").not.toBe("");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(closeButton).toBeFocused();
});

test("没权限的角色（技术）直接打开工单、新建工单、异常队列、账单、付款批次的地址：写「你没有权限查看这里」，页面不报错；赔付表每个角色都能看", async ({ page, request }) => {
  test.setTimeout(120_000);
  const tech = await createStaff(request, "tech", "端到端技术");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAs(page, "platform", tech.email, tech.password);
  const someId = "0a0a0a0a-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  for (const path of ["/platform/tickets", `/platform/tickets/${someId}`, "/platform/tickets/new", "/platform/exceptions", `/platform/exceptions/${someId}`, "/platform/finance/statements", `/platform/finance/statements/${someId}`, "/platform/finance/payout-batches", `/platform/finance/payout-batches/${someId}`]) {
    await page.goto(path);
    await expect(page.getByText("你没有权限查看这里"), path).toBeVisible();
    await expect(page.getByText(/加载失败|页面出了点问题/), path).toHaveCount(0);
  }
  await page.goto("/platform/compensation-table");
  await expect(page.getByText(/每笔至少/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "修改赔付表" })).toHaveCount(0);
  expect(errors, "页面没有报错").toEqual([]);
});

test("全部操作留审计：工单认领、转交、给供应商留言、内部备注、征求意见、关闭做完后，审计日志页按这张工单查，每一步按中文名列出、操作人是做的人", async ({ page, request }) => {
  test.setTimeout(120_000);
  const seed = await prepare(request);
  const order = await seedOrder(seed, { serviceAt: new Date(Date.now() - 2 * 3_600_000), completed: true });
  const created = await post<{ ticket: { id: string; ticket_no: string } }>(request, await salesHeaders(request, seed), `/sales/v1/orders/${order.id}/tickets`, { type: "complaint", subject: "司机迟到", description: "晚到 20 分钟", language: "zh", raised_by: "guest" }, "渠道提投诉");
  const ticketId = created.ticket.id;
  const admin = await platformAdminHeaders(request);
  const other = await createStaff(request, "customer_service", "端到端客服");
  const otherId = await owner(async (client) => (await client.query<{ id: string }>("select id from platform_users where email = $1", [other.email])).rows[0]?.id as string);
  await call(request, admin, `/platform/v1/tickets/${ticketId}/assign`, {}, "认领");
  await call(request, admin, `/platform/v1/tickets/${ticketId}/assign`, { assignee_id: otherId }, "转交");
  await call(request, admin, `/platform/v1/tickets/${ticketId}/messages`, { body: "请说明司机几点到的" }, "给供应商留言");
  await call(request, admin, `/platform/v1/tickets/${ticketId}/messages`, { body: "内部：客人很急", internal: true }, "内部备注");
  await call(request, admin, `/platform/v1/tickets/${ticketId}/request-reply`, { body: "请 24 小时内答复" }, "征求供应商意见");
  await call(request, admin, `/platform/v1/tickets/${ticketId}/close`, { note: "客人撤回投诉" }, "关闭");

  const credentials = adminCredentials();
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAs(page, "platform", credentials.email, credentials.password);
  await page.goto(`/platform/tickets/${ticketId}`);
  await page.getByRole("link", { name: "看这张工单的操作记录" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "审计日志" })).toBeVisible();
  const logs = page.getByRole("region", { name: /审计日志/ }).first();
  for (const name of ["认领 / 转交", "留言（供应商看得到）", "内部备注", "征求供应商意见", "关闭工单"]) await expect(logs.getByText(name, { exact: true }).first(), name).toBeVisible();
  await expect(logs.getByText("认领 / 转交", { exact: true })).toHaveCount(2);
  await expect(logs).toContainText(credentials.email);
  await expect(logs).toContainText("工单");
  await expect(logs.getByText(/request_reply|ticket\b/)).toHaveCount(0);
});
