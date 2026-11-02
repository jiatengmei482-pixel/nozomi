/**
 * M4-31 测试角色的端到端用例（ADR 0065）：真实浏览器 → 构建好的前端 → 真实 API → 真实 PostgreSQL + 本机假 SMTP（从不连真实的邮件服务）。
 * - 改单框填了新邮箱后（提示、核实方式、原因都展开）：手机宽度不横向滚动、亮暗两色过 axe；
 * - 等审核状态的改单框：没有新邮箱输入框、说明处理完之前不能再改；
 * - 「去待审核」能到待审核页，那一条只有打码地址；客服本人只能撤回；运营在页面上看到批准效果的说明后批准，新地址收到信，旧地址没收到；
 * - 驳回走页面：订单邮箱不变、新地址不收信。
 * 订单经官网真实接口下（每个用例自己的来源地址，不占默认地址的限速额度），用迁移账号直接标为已确认（同 change-approval.spec.ts）。远期的单，全部是虚构数据。
 */
import { randomBytes, randomInt } from "node:crypto";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { createPool } from "../../api/src/db/pool.ts";
import { decodedMailText } from "../../api/src/testing/fake-integrations.ts";
import { E2E_WEB_DRIVER_MAIL_PORT } from "../playwright.config.ts";
import { CENTER, type Supplier, type World, createProductByApi, createSupplier, createWorld, expectAccessible } from "./catalog.ts";
import { expectNoHorizontalOverflow, loginAs, newPassword, platformAdminHeaders, uniqueEmail } from "./support.ts";

test.use({ baseURL: `http://127.0.0.1:${E2E_WEB_DRIVER_MAIL_PORT}`, extraHTTPHeaders: { "x-forwarded-for": `198.51.100.${randomInt(1, 250)}` } });

const RULES = {
  booking: { sale_from: null, sale_to: null, service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 0, note: null },
  urgent: { enabled: false, daily_quota: null, tiers: [] },
  night: { enabled: false, window: null, amount: null, charge_unit: null },
  free_wait: { pickup: { mode: "limited", minutes: 60 }, dropoff: { mode: "limited", minutes: 60 }, general: null },
  addons: [],
  driver_languages: [],
};

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

async function publishedProduct(request: APIRequestContext, supplier: Supplier, world: World): Promise<void> {
  const version = async (id: string): Promise<number> => ((await (await request.get(`/tenant/v1/products/${id}`, { headers: supplier.headers })).json()) as { version: number }).version;
  const product = await createProductByApi(request, supplier, world, "airport_transfer");
  const rules = await request.put(`/tenant/v1/products/${product.id}/service-rules`, { headers: { ...supplier.headers, "if-match": `"${product.version}"` }, data: RULES });
  expect(rules.status(), await rules.text()).toBe(200);
  const content = await request.put(`/tenant/v1/products/${product.id}/content`, { headers: { ...supplier.headers, "if-match": `"${((await rules.json()) as { version: number }).version}"` }, data: { zh: { title: "官网接送机", pickup_guide: "到达大厅 2 号出口" } } });
  expect(content.status(), await content.text()).toBe(200);
  const { today } = (await (await request.get(`/tenant/v1/products/${product.id}/price-rules`, { headers: supplier.headers })).json()) as { today: string };
  const price = await request.post(`/tenant/v1/products/${product.id}/price-rules/batch`, {
    headers: { ...supplier.headers, "if-match": `"${await version(product.id)}"`, "idempotency-key": crypto.randomUUID() },
    data: { create: [{ ref: "a", area_id: supplier.area.id, vehicle_group_id: world.group.id, direction: "both", package_hours: null, pricing_model: "fixed", base_price: 20000, start_price: null, start_meters: null, start_minutes: null, per_km: null, per_minute: null, min_price: null, package_km: null, package_price: null, overtime_per_hour: null, over_km_per_km: null, valid_from: today, valid_to: null, status: "enabled" }], update: [], delete: [] },
  });
  expect(price.status(), await price.text()).toBe(200);
  const published = await request.post(`/tenant/v1/products/${product.id}/publish`, { headers: supplier.headers });
  expect(published.status(), await published.text()).toBe(200);
}

function tokyoDaysAhead(days: number): string {
  const at = new Date(Date.now() + days * 86_400_000 + 9 * 3_600_000);
  return `${at.toISOString().slice(0, 10)}T10:00`;
}

async function confirmedSiteOrder(request: APIRequestContext, world: World, email: string): Promise<{ id: string; orderNo: string }> {
  const quoted = await request.post("/site/v1/quotes", { data: { city_id: world.city.id, airport_id: world.airport.id, direction: "pickup", address: { lat: CENTER.lat + 0.01, lng: CENTER.lng + 0.01 }, service_local: tokyoDaysAhead(40), passengers: 1, luggage: 0 } });
  expect(quoted.status(), await quoted.text()).toBe(200);
  const quote = ((await quoted.json()) as { quotes: { quote_id: string; vehicle_group: { id: string } }[] }).quotes.find((q) => q.vehicle_group.id === world.group.id);
  expect(quote, "报出了这个车型组的价").toBeTruthy();
  const created = await request.post("/site/v1/orders", { headers: { "idempotency-key": crypto.randomUUID() }, data: { quote_id: quote?.quote_id, passenger: { name: "虚构乘客丁", phone: "+81 90-0000-4444", email }, flight_no: "JL063", dropoff_address: "虚构市虚构路四号", save_payment_method: true } });
  expect(created.status(), await created.text()).toBe(201);
  const body = (await created.json()) as { order: { id: string; order_no: string } };
  await owner(async (client) => {
    await client.query("update orders set status = 'confirmed', confirmed_at = now(), dispatch_due_at = service_at - interval '24 hours', updated_at = now() where id = $1", [body.order.id]);
  });
  return { id: body.order.id, orderNo: body.order.order_no };
}

async function mailsTo(email: string): Promise<string[]> {
  const stats = (await (await fetch(process.env["E2E_FAKE_SMTP_STATS_URL"] as string)).json()) as { messages: { to: string[]; data: string }[] };
  return stats.messages.filter((message) => message.to.some((to) => to.toLowerCase() === email.toLowerCase())).map((message) => decodedMailText(message.data));
}

async function inviteStaff(request: APIRequestContext, role: string, name: string): Promise<{ email: string; password: string }> {
  const headers = await platformAdminHeaders(request);
  const email = uniqueEmail(`m431qa-${role}`);
  const password = newPassword();
  const invited = await request.post("/platform/v1/staff", { headers, data: { email, name, role } });
  expect(invited.status(), await invited.text()).toBe(201);
  const token = ((await invited.json()) as { invite: { token: string } }).invite.token;
  const accepted = await request.post("/platform/v1/auth/accept-invite", { data: { token, password } });
  expect(accepted.status(), await accepted.text()).toBe(200);
  return { email, password };
}

/** 打开改单框，填新邮箱（不提交）。 */
async function openWithEmail(page: Page, orderId: string, fresh: string) {
  await page.goto(`/platform/orders/${orderId}`);
  await page.getByRole("button", { name: "代客人改单" }).click();
  const dialog = page.getByRole("dialog", { name: "代客人改单" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("textbox", { name: /乘客的新邮箱/ }).fill(fresh);
  await expect(dialog.getByText(/改乘客邮箱需要另一位同事批准/)).toBeVisible();
  return dialog;
}

async function dialogFits(page: Page, what: string): Promise<void> {
  const fits = await page.evaluate(() => {
    const dialog = document.querySelector("dialog[open], [role=dialog]") as HTMLElement | null;
    if (!dialog) return { found: false, right: 0, width: 0, inner: 0 };
    const rect = dialog.getBoundingClientRect();
    return { found: true, right: rect.right, width: window.innerWidth, inner: dialog.scrollWidth - dialog.clientWidth };
  });
  expect(fits.found, `${what}：找不到对话框`).toBe(true);
  expect(fits.right, `${what}：对话框超出屏幕`).toBeLessThanOrEqual(fits.width + 1);
  expect(fits.inner, `${what}：对话框里横向滚动`).toBeLessThanOrEqual(1);
}

test("改单框填了新邮箱（提示、核实方式、原因都展开）：手机和桌面宽度不横向溢出，亮暗两色过 axe；页面上始终没有新邮箱以外的原文", async ({ page, request }) => {
  test.setTimeout(180_000);
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  await publishedProduct(request, supplier, world);
  const tag = randomBytes(4).toString("hex");
  const order = await confirmedSiteOrder(request, world, `fictional.qa.old.${tag}@e2e.example.com`);
  const cs = await inviteStaff(request, "customer_service", "端到端客服甲（M4-31 测试）");
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAs(page, "platform", cs.email, cs.password);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 860 });
    const dialog = await openWithEmail(page, order.id, `fictional.qa.new.${tag}@e2e.example.com`);
    await expect(dialog.getByLabel(/怎么核实的客人身份/)).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: /^原因/ })).toBeVisible();
    await dialogFits(page, `改单框（${width}px）`);
    await expectNoHorizontalOverflow(page, `订单详情 + 改单框（${width}px）`);
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expectAccessible(page, `改单框（${width}px，${scheme === "light" ? "亮色" : "暗色"}，填了新邮箱）`);
    }
    await page.emulateMedia({ colorScheme: "light" });
    await dialog.getByRole("button", { name: "不改了" }).click();
    await expect(dialog).toHaveCount(0);
  }
  await expect(page.locator("body")).not.toContainText(`fictional.qa.old.${tag}`);
});

test("客服发起 → 等审核时改单框不能再填邮箱 → 「去待审核」只有打码地址、客服本人只能撤回 → 运营在待审核页看到批准效果后批准 → 新地址收信、旧地址没收到", async ({ page, request, browser }) => {
  test.setTimeout(240_000);
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  await publishedProduct(request, supplier, world);
  const tag = randomBytes(4).toString("hex");
  const email = `fictional.qa.old2.${tag}@e2e.example.com`;
  const fresh = `fictional.qa.new2.${tag}@e2e.example.com`;
  const order = await confirmedSiteOrder(request, world, email);
  const cs = await inviteStaff(request, "customer_service", "端到端客服乙（M4-31 测试）");
  const opsUser = await inviteStaff(request, "operations", "端到端运营（M4-31 测试）");

  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAs(page, "platform", cs.email, cs.password);
  const dialog = await openWithEmail(page, order.id, fresh);
  await dialog.getByLabel(/怎么核实的客人身份/).selectOption("payment_details");
  await dialog.getByRole("textbox", { name: /^原因/ }).fill("核对了付款卡末四位和金额，客人说原邮箱已停用");
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(/改成 fi\*\*\*@e2e\.example\.com 在等另一位同事批准/)).toBeVisible();

  await page.getByRole("button", { name: "代客人改单" }).click();
  const again = page.getByRole("dialog", { name: "代客人改单" });
  await expect(again.getByText(/处理完之前不能再改邮箱/)).toBeVisible();
  await expect(again.getByRole("textbox", { name: /乘客的新邮箱/ })).toHaveCount(0);
  await again.getByRole("button", { name: "不改了" }).click();

  await page.getByRole("link", { name: "去待审核" }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: "待审核" })).toBeVisible();
  const card = page.locator("section.approval-card", { has: page.getByRole("heading", { name: "代客人改乘客邮箱" }) }).filter({ hasText: order.orderNo });
  await expect(card).toBeVisible();
  await expect(card.getByRole("button", { name: /^批准/ })).toHaveCount(0);
  await expect(card.getByRole("button", { name: /^撤回/ })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(fresh);
  await expect(page.locator("body")).not.toContainText(email);

  const opsContext = await browser.newContext({ baseURL: `http://127.0.0.1:${E2E_WEB_DRIVER_MAIL_PORT}` });
  const opsPage = await opsContext.newPage();
  try {
    await loginAs(opsPage, "platform", opsUser.email, opsUser.password);
    await opsPage.goto("/platform/approvals");
    const opsCard = opsPage.locator("section.approval-card", { has: opsPage.getByRole("heading", { name: "代客人改乘客邮箱" }) }).filter({ hasText: order.orderNo });
    await opsCard.getByRole("button", { name: /^批准/ }).click();
    const confirm = opsPage.getByRole("dialog", { name: "批准：代客人改乘客邮箱" });
    await expect(confirm.getByText(/等于把订单交给这个邮箱的主人/)).toBeVisible();
    for (const scheme of ["light", "dark"] as const) {
      await opsPage.emulateMedia({ colorScheme: scheme });
      await expectAccessible(opsPage, `批准确认框（${scheme === "light" ? "亮色" : "暗色"}）`);
    }
    await confirm.getByRole("button", { name: "批准", exact: true }).click();
    await expect(confirm).toHaveCount(0);
  } finally {
    await opsContext.close();
  }
  await expect.poll(async () => (await mailsTo(fresh)).length, { timeout: 40_000, intervals: [1_000] }).toBe(1);
  expect((await mailsTo(fresh))[0]).not.toContain(email);
  expect(await mailsTo(email), "批准时旧地址没有收到信（ADR 0065 不做）").toEqual([]);
  await page.goto(`/platform/orders/${order.id}`);
  await expect(page.getByText(/在等另一位同事批准/)).toHaveCount(0);
});

test("运营在待审核页驳回：订单邮箱不变，新地址收不到信，订单详情不再显示等审核", async ({ page, request, browser }) => {
  test.setTimeout(180_000);
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  await publishedProduct(request, supplier, world);
  const tag = randomBytes(4).toString("hex");
  const email = `fictional.qa.old3.${tag}@e2e.example.com`;
  const fresh = `fictional.qa.new3.${tag}@e2e.example.com`;
  const order = await confirmedSiteOrder(request, world, email);
  const opsA = await inviteStaff(request, "operations", "端到端运营甲（M4-31 测试）");
  const opsB = await inviteStaff(request, "operations", "端到端运营乙（M4-31 测试）");
  await page.setViewportSize({ width: 390, height: 860 });
  await loginAs(page, "platform", opsA.email, opsA.password);
  const dialog = await openWithEmail(page, order.id, fresh);
  await dialog.getByLabel(/怎么核实的客人身份/).selectOption("other");
  await dialog.getByRole("textbox", { name: /^原因/ }).fill("客人在柜台出示了护照");
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText(/在等另一位同事批准/)).toBeVisible();
  await page.goto("/platform/approvals");
  const own = page.locator("section.approval-card").filter({ hasText: order.orderNo });
  await expect(own.getByRole("button", { name: /^批准/ }), "运营发起的，自己不能批").toHaveCount(0);

  const otherContext = await browser.newContext({ baseURL: `http://127.0.0.1:${E2E_WEB_DRIVER_MAIL_PORT}`, viewport: { width: 390, height: 860 } });
  const reviewer = await otherContext.newPage();
  try {
    await loginAs(reviewer, "platform", opsB.email, opsB.password);
    await reviewer.goto("/platform/approvals");
    const card = reviewer.locator("section.approval-card").filter({ hasText: order.orderNo });
    await card.getByRole("button", { name: /^驳回/ }).click();
    const confirm = reviewer.getByRole("dialog", { name: "驳回：代客人改乘客邮箱" });
    await confirm.getByRole("textbox", { name: /说明/ }).fill("核实方式不够");
    await confirm.getByRole("button", { name: "驳回", exact: true }).click();
    await expect(confirm).toHaveCount(0);
  } finally {
    await otherContext.close();
  }
  await page.goto(`/platform/orders/${order.id}`);
  await expect(page.getByText(/在等另一位同事批准/)).toHaveCount(0);
  await page.waitForTimeout(3_000);
  expect(await mailsTo(fresh)).toEqual([]);
  const stored = await owner(async (client) => (await client.query("select status, email, email_enc from passenger_email_changes where order_id = $1", [order.id])).rows);
  expect(stored).toEqual([{ status: "dismissed", email: null, email_enc: null }]);
});
