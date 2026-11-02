/**
 * M4-29 测试角色：页面上的状态、按钮、文案和后端一致（亮暗两种主题、手机宽度）。真实浏览器 → 构建好的前端 → 真实 API → 真实 PostgreSQL + 本机假 SMTP。全部虚构。
 * 拒绝和代处理的路径（同意的路径见 change-approval.spec.ts）。用远期的单，不碰「临近用车」的救援任务。
 */
import { randomBytes, randomInt } from "node:crypto";
import { type APIRequestContext, type Locator, type Page, expect, test } from "@playwright/test";
import { createPool } from "../../api/src/db/pool.ts";
import { decodedMailText } from "../../api/src/testing/fake-integrations.ts";
import { E2E_WEB_DRIVER_MAIL_PORT, E2E_WEB_STRIPE_PORT } from "../playwright.config.ts";
import { CENTER, type Supplier, type World, createProductByApi, createSupplier, createWorld, expectAccessible } from "./catalog.ts";
import { adminCredentials, expectNoHorizontalOverflow, loginAs } from "./support.ts";

test.use({ baseURL: `http://127.0.0.1:${E2E_WEB_DRIVER_MAIL_PORT}` });

const SITE = `http://127.0.0.1:${E2E_WEB_STRIPE_PORT}`;
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

async function publish(request: APIRequestContext, supplier: Supplier, world: World): Promise<void> {
  const version = async (id: string): Promise<number> => ((await (await request.get(`/tenant/v1/products/${id}`, { headers: supplier.headers })).json()) as { version: number }).version;
  const product = await createProductByApi(request, supplier, world, "airport_transfer");
  const rules = await request.put(`/tenant/v1/products/${product.id}/service-rules`, { headers: { ...supplier.headers, "if-match": `"${product.version}"` }, data: RULES });
  expect(rules.status(), await rules.text()).toBe(200);
  const content = await request.put(`/tenant/v1/products/${product.id}/content`, { headers: { ...supplier.headers, "if-match": `"${await version(product.id)}"` }, data: { zh: { title: "虚构接送机", pickup_guide: "到达大厅 2 号出口" } } });
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

/** 东京 10:00，`days` 天之后。 */
function tokyoDay(days: number): string {
  return new Date(Date.now() + 9 * 3_600_000 + days * 86_400_000).toISOString().slice(0, 10);
}

async function mailsTo(email: string): Promise<string[]> {
  const stats = (await (await fetch(process.env["E2E_FAKE_SMTP_STATS_URL"] as string)).json()) as { messages: { to: string[]; data: string }[] };
  return stats.messages.filter((message) => message.to.includes(email)).map((message) => decodedMailText(message.data));
}

async function waitForMail(email: string, pattern: RegExp): Promise<string> {
  let found: string | undefined;
  await expect.poll(async () => { found = (await mailsTo(email)).find((text) => pattern.test(text)); return found !== undefined; }, { timeout: 40_000, intervals: [1_000] }).toBe(true);
  return found as string;
}

/** 真实接口下单、标为已付款、派好车（远期的单，救援任务不会抢）。 */
async function dispatchedOrder(request: APIRequestContext, days: number) {
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  await publish(request, supplier, world);
  const tag = randomBytes(4).toString("hex");
  const guestEmail = `fictional.guest.${tag}@e2e.example.com`;
  const driverEmail = `fictional.driver.${tag}@e2e.example.com`;
  const oldDay = tokyoDay(days);
  const newDay = tokyoDay(days + 2);

  // 下单（官网真实接口），标为已付款，派车
  const headers = { "x-forwarded-for": `198.51.100.${randomInt(1, 250)}` };
  const quoted = await request.post(`${SITE}/site/v1/quotes`, { headers, data: { city_id: world.city.id, airport_id: world.airport.id, direction: "pickup", address: { lat: CENTER.lat + 0.01, lng: CENTER.lng + 0.01 }, service_local: `${oldDay}T10:00`, passengers: 1, luggage: 0 } });
  expect(quoted.status(), await quoted.text()).toBe(200);
  const quote = ((await quoted.json()) as { quotes: { quote_id: string; vehicle_group: { id: string } }[] }).quotes.find((item) => item.vehicle_group.id === world.group.id);
  expect(quote, "报出了这个车型组的价").toBeTruthy();
  const created = await request.post(`${SITE}/site/v1/orders`, { headers: { ...headers, "idempotency-key": crypto.randomUUID() }, data: { quote_id: quote?.quote_id, passenger: { name: "虚构乘客", phone: "+81 90-0000-0000", email: guestEmail }, flight_no: "NH211", dropoff_address: "虚构市虚构路一号", save_payment_method: true } });
  expect(created.status(), await created.text()).toBe(201);
  const placed = (await created.json()) as { link: { token: string }; order: { id: string; order_no: string } };
  const orderNo = placed.order.order_no;
  await owner(async (client) => {
    await client.query("update orders set status = 'confirmed', confirmed_at = now(), dispatch_due_at = service_at - interval '24 hours', updated_at = now() where id = $1", [placed.order.id]);
    await client.query("update order_payments set status = 'succeeded', succeeded_at = now() where order_id = $1", [placed.order.id]);
  });
  const driver = await request.post("/tenant/v1/drivers", { headers: { ...supplier.headers, "idempotency-key": crypto.randomUUID() }, data: { name: "虚构司机", phone: `+8190${randomInt(10_000_000, 99_999_999)}`, email: driverEmail, languages: ["ja"], license_expires_on: "2035-01-01" } });
  expect(driver.ok(), await driver.text()).toBe(true);
  const vehicle = await request.post("/tenant/v1/vehicles", { headers: { ...supplier.headers, "idempotency-key": crypto.randomUUID() }, data: { plate: `品川 300 あ ${randomInt(1000, 9999)}`, vehicle_group_id: world.group.id, model: "虚构车型", color: "黑", seats: 7, mileage_km: 12_000, plate_type: "business", insurance_expires_on: "2035-01-01", inspection_expires_on: "2035-01-01" } });
  expect(vehicle.ok(), await vehicle.text()).toBe(true);
  const current = (await (await request.get(`/tenant/v1/orders/${placed.order.id}`, { headers: supplier.headers })).json()) as { order: { version: number } };
  const assigned = await request.post(`/tenant/v1/orders/${placed.order.id}/assign`, { headers: { ...supplier.headers, "if-match": `"${current.order.version}"` }, data: { driver_id: ((await driver.json()) as { id: string }).id, vehicle_id: ((await vehicle.json()) as { id: string }).id } });
  expect(assigned.ok(), await assigned.text()).toBe(true);
  await waitForMail(driverEmail, /调度给您安排了一张用车任务/);

  const orderId = placed.order.id;
  return { supplier, guestEmail, driverEmail, oldDay, newDay, orderId, orderNo, token: placed.link.token };
}

const THEMES = ["light", "dark"] as const;
/** 官网页面的日期写法：11月22日 */
const guestDate = (day: string): string => `${Number(day.slice(5, 7))}月${Number(day.slice(8, 10))}日`;
const SECRET_REASON = "虚构原因：结算价太低司机小张生病";
const changeOf = (page: Page) => page.locator("section").filter({ has: page.getByRole("heading", { name: "修改记录" }) });

async function submitGuestChange(guest: Page, token: string, orderNo: string, newDay: string): Promise<Locator> {
  await guest.goto(`/book/order#${token}`);
  await expect(guest.getByRole("heading", { level: 1, name: `订单 ${orderNo}` })).toBeVisible();
  await guest.getByRole("button", { name: "修改订单" }).click();
  await guest.getByLabel(/日期/).fill(newDay);
  await guest.getByRole("button", { name: "提交修改" }).click();
  await expect(guest.getByText(/^修改已提交，等服务方确认/)).toBeVisible();
  return guest.locator("section").filter({ has: guest.getByRole("heading", { level: 2, name: "修改订单" }) });
}

for (const scheme of THEMES) {
  test(`拒绝流程（${scheme}，手机宽度）：调整中两边状态一致 → 拒绝必填原因 → 客人看到没通过、原时间、不见原因 → 客人取消 → 司机链接失效、供应商有待办`, async ({ page, request, browser }) => {
    test.setTimeout(240_000);
    const days = scheme === "light" ? 20 : 26;
    const { supplier, guestEmail, driverEmail, oldDay, newDay, orderId, orderNo, token } = await dispatchedOrder(request, days);
    const firstDriverMail = await waitForMail(driverEmail, /调度给您安排了一张用车任务/);
    const driverToken = /\/driver#(nzd_[A-Za-z0-9_.-]+)/.exec(firstDriverMail)?.[1] as string;
    const guestContext = await browser.newContext({ viewport: { width: 360, height: 740 }, locale: "zh-CN", baseURL: SITE, colorScheme: scheme });
    const guest = await guestContext.newPage();
    const section = await submitGuestChange(guest, token, orderNo, newDay);
    await expect(section.getByText(/^修改待确认：/)).toBeVisible();
    await expectNoHorizontalOverflow(guest, `官网 ${scheme}：修改待确认`);
    await expectAccessible(guest, `官网 ${scheme}：修改待确认`);

    await page.setViewportSize({ width: 360, height: 740 });
    await page.emulateMedia({ colorScheme: scheme });
    await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);
    await expect(page.locator("section").filter({ has: page.getByRole("heading", { name: /^订单待办/ }) })).toContainText("需调整司机");
    await expectNoHorizontalOverflow(page, `供应商首页 ${scheme}：待办`);
    await expectAccessible(page, `供应商首页 ${scheme}：待办`);
    await page.goto(`/orders/${orderId}`);
    const changes = changeOf(page);
    await expect(changes).toContainText("需调整司机");
    await expect(changes.getByRole("button", { name: "同意" })).toBeVisible();
    await expect(page.locator("body")).toContainText(`${oldDay} 10:00`);
    await expect(page.locator("body")).not.toContainText("对外价");
    await expectNoHorizontalOverflow(page, `供应商详情 ${scheme}：待确认`);
    await expectAccessible(page, `供应商详情 ${scheme}：待确认`);

    await changes.getByRole("button", { name: "调整中" }).click();
    await expect(changes.getByRole("button", { name: "调整中" })).toHaveCount(0);
    await guest.reload();
    await expect(section.getByText("服务方正在协调", { exact: true })).toBeVisible();
    await expect(section.getByText(/^修改待确认：/)).toBeVisible();
    await expectAccessible(guest, `官网 ${scheme}：调整中`);

    await changes.getByRole("button", { name: "拒绝" }).click();
    const dialog = page.getByRole("dialog", { name: "拒绝这次修改" });
    await dialog.getByRole("button", { name: "确认拒绝" }).click();
    await expect(dialog).toContainText("请写拒绝原因");
    await expect(dialog).toContainText("不会给客人看");
    await expectNoHorizontalOverflow(page, `拒绝对话框 ${scheme}`);
    await expectAccessible(page, `拒绝对话框 ${scheme}`);
    await dialog.getByLabel(/拒绝原因/).fill(SECRET_REASON);
    await dialog.getByRole("button", { name: "确认拒绝" }).click();
    await expect(changes).toContainText(SECRET_REASON);
    await expect(changes.getByRole("button", { name: "同意" })).toHaveCount(0);
    await expect(page.locator("body")).toContainText(`${oldDay} 10:00`);

    await guest.reload();
    await expect(section.getByText(/您的修改没有通过，原预约不变/)).toBeVisible();
    await expect(guest.locator("body")).toContainText(guestDate(oldDay));
    await expect(guest.locator("body")).not.toContainText(SECRET_REASON);
    await expectNoHorizontalOverflow(guest, `官网 ${scheme}：被拒`);
    await expectAccessible(guest, `官网 ${scheme}：被拒`);
    const result = await waitForMail(guestEmail, /没有得到确认/);
    expect(result).not.toContain(SECRET_REASON);
    const driverDeclined = await waitForMail(driverEmail, /没有通过/);
    expect(driverDeclined).not.toContain(SECRET_REASON);
    const driverContext = await browser.newContext({ viewport: { width: 360, height: 740 }, locale: "zh-CN", baseURL: `http://127.0.0.1:${E2E_WEB_DRIVER_MAIL_PORT}`, colorScheme: scheme });
    const driverPage = await driverContext.newPage();
    await driverPage.goto(`/driver#${driverToken}`);
    await expect(driverPage.getByRole("heading", { level: 1 })).toContainText(`${oldDay} 10:00`);
    await expect(driverPage.locator("body")).not.toContainText(SECRET_REASON);
    await expectNoHorizontalOverflow(driverPage, `司机页 ${scheme}`);

    // 客人取消：通知即生效
    await guest.getByRole("button", { name: /免费取消/ }).click();
    const confirmGroup = guest.getByRole("group", { name: "确认取消订单" });
    await expect(confirmGroup).toBeVisible();
    await expectNoHorizontalOverflow(guest, `官网 ${scheme}：确认取消`);
    await confirmGroup.getByRole("button", { name: "确认取消订单" }).click();
    await expect(guest.locator("body")).toContainText("已取消");
    const tenantCancel = await waitForMail(supplier.tenant.adminEmail, /这张订单已取消/);
    expect(tenantCancel).toContain("需调整司机");
    await waitForMail(driverEmail, /任务已取消/);
    await driverPage.reload();
    await expect(driverPage.locator("body")).not.toContainText("虚构乘客");
    await page.goto("/");
    const todos = page.locator("section").filter({ has: page.getByRole("heading", { name: /^订单待办/ }) });
    await expect(todos).toContainText("已取消");
    await expectAccessible(page, `供应商首页 ${scheme}：取消待办`);
    await driverContext.close();
    await guestContext.close();
  });
}

test("运营代处理（暗色，手机宽度）：原因必填；代拒绝后供应商看到「平台代为处理」；客人看不到原因", async ({ page, request, browser }) => {
  test.setTimeout(240_000);
  const { supplier, orderId, orderNo, newDay, oldDay, token } = await dispatchedOrder(request, 32);
  const guestContext = await browser.newContext({ viewport: { width: 400, height: 800 }, locale: "zh-CN", baseURL: SITE, colorScheme: "dark" });
  const guest = await guestContext.newPage();
  const section = await submitGuestChange(guest, token, orderNo, newDay);
  await page.setViewportSize({ width: 360, height: 740 });
  await page.emulateMedia({ colorScheme: "dark" });
  const admin = adminCredentials();
  await loginAs(page, "platform", admin.email, admin.password);
  await page.goto(`/platform/orders/${orderId}`);
  await page.getByRole("button", { name: "代拒绝" }).click();
  const dialog = page.getByRole("dialog", { name: "代供应商拒绝" });
  await dialog.getByRole("button", { name: "确认" }).click();
  await expect(dialog).toContainText("请写原因");
  await expectNoHorizontalOverflow(page, "代拒绝对话框");
  await expectAccessible(page, "代拒绝对话框 暗色");
  await dialog.getByLabel(/原因/).fill(SECRET_REASON);
  await dialog.getByRole("button", { name: "确认" }).click();
  await expect(page.locator("body")).toContainText("平台代为处理");
  await expect(page.getByRole("button", { name: "代拒绝" })).toHaveCount(0);
  await expectNoHorizontalOverflow(page, "运营详情：代拒绝后");
  await expectAccessible(page, "运营详情：代拒绝后 暗色");
  await guest.reload();
  await expect(section.getByText(/您的修改没有通过/)).toBeVisible();
  await expect(guest.locator("body")).toContainText(guestDate(oldDay));
  await expect(guest.locator("body")).not.toContainText(SECRET_REASON);
  const supplierContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: "zh-CN", baseURL: `http://127.0.0.1:${E2E_WEB_DRIVER_MAIL_PORT}`, colorScheme: "light" });
  const supplierPage = await supplierContext.newPage();
  await loginAs(supplierPage, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);
  await supplierPage.goto(`/orders/${orderId}`);
  await expect(changeOf(supplierPage)).toContainText("平台代为处理");
  await supplierContext.close();
  await guestContext.close();
});
