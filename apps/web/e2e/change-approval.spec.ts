/**
 * 客户改单要供应商确认（M4-29，ADR 0060）。真实浏览器 → 构建好的前端 → 真实 API → 真实 PostgreSQL + 本机假 SMTP（从不连真实的邮件服务）。全部虚构。
 * 客人在官网改时间 → 订单待确认、原时间不变 → 供应商收到邮件、首页待办、菜单角标、列表标记 → 同意 → 订单更新、司机收到带新链接的通知、客人收到结果。
 * 订单经官网真实接口下（报价快照是真的，改期才能重新报价）；付款这一步和本任务无关，用迁移账号直接标为已付款。用远期的单，不碰「临近用车又没派车」的救援。
 */
import { randomBytes, randomInt } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { createPool } from "../../api/src/db/pool.ts";
import { decodedMailText } from "../../api/src/testing/fake-integrations.ts";
import { E2E_WEB_DRIVER_MAIL_PORT, E2E_WEB_STRIPE_PORT } from "../playwright.config.ts";
import { CENTER, type Supplier, type World, createProductByApi, createSupplier, createWorld, expectAccessible } from "./catalog.ts";
import { expectNoHorizontalOverflow, loginAs } from "./support.ts";

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

test("客人改时间 → 原时间不变、修改待确认 → 供应商收到通知和待办 → 同意 → 订单更新、司机收到新链接、客人收到结果", async ({ page, request, browser }) => {
  test.setTimeout(240_000);
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  await publish(request, supplier, world);
  const tag = randomBytes(4).toString("hex");
  const guestEmail = `fictional.guest.${tag}@e2e.example.com`;
  const driverEmail = `fictional.driver.${tag}@e2e.example.com`;
  const oldDay = tokyoDay(10);
  const newDay = tokyoDay(12);

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

  // 客人在官网改时间：原时间不变，页面写修改待确认
  const guestContext = await browser.newContext({ viewport: { width: 400, height: 800 }, locale: "zh-CN", baseURL: SITE });
  const guest = await guestContext.newPage();
  await guest.goto(`/book/order#${placed.link.token}`);
  await expect(guest.getByRole("heading", { level: 1, name: `订单 ${orderNo}` })).toBeVisible();
  await guest.getByRole("button", { name: "修改订单" }).click();
  await guest.getByLabel(/日期/).fill(newDay);
  await guest.getByRole("button", { name: "提交修改" }).click();
  await expect(guest.getByText(/^修改已提交，等服务方确认/)).toBeVisible();
  const changeSection = guest.locator("section").filter({ has: guest.getByRole("heading", { level: 2, name: "修改订单" }) });
  await expect(changeSection.getByText(/^修改待确认：/)).toBeVisible();
  await expect(changeSection.getByText("修改待确认", { exact: true })).toBeVisible();
  expect(((await (await guest.request.get("/site/v1/order", { headers: { authorization: `Bearer ${placed.link.token}` } })).json()) as { order: { service_local: string } }).order.service_local, "原时间不变").toBe(`${oldDay}T10:00`);
  await expectNoHorizontalOverflow(guest, "官网：修改待确认");

  // 供应商收到邮件，突出需调整司机；没有对外价
  const tenantMail = await waitForMail(supplier.tenant.adminEmail, /客人申请修改订单/);
  expect(tenantMail).toContain("需调整司机");
  expect(tenantMail).toContain(orderNo);
  for (const secret of ["22000", "22,000", "对外价", "加价"]) expect(tenantMail, `供应商邮件不能有 ${secret}`).not.toContain(secret);
  // 司机收到提醒：不带链接，没有客人信息
  const pendingMail = await waitForMail(driverEmail, /客人申请修改下面这张任务/);
  expect(pendingMail).toContain("按原任务执行");
  expect(pendingMail).not.toMatch(/\/driver#/);
  for (const secret of ["虚构乘客", "+819000000000", guestEmail, "虚构市虚构路一号", "20000", "20,000"]) expect(pendingMail, `司机邮件不能有 ${secret}`).not.toContain(secret);

  // 供应商后台：首页待办、菜单角标、列表标记
  await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);
  const todos = page.locator("section").filter({ has: page.getByRole("heading", { name: /^订单待办/ }) });
  await expect(todos).toContainText("客人申请修改，等你处理（用车时间）");
  await expect(todos).toContainText("需调整司机");
  await expect(page.getByRole("navigation", { name: "主菜单" }).first().getByRole("img", { name: "1 条待办" })).toBeVisible();
  await expectAccessible(page, "供应商首页：订单待办");
  await page.goto("/orders");
  const row = page.getByRole("row").filter({ hasText: orderNo });
  await expect(row).toContainText("修改待确认");
  await row.getByRole("link", { name: orderNo }).click();
  const changes = page.locator("section").filter({ has: page.getByRole("heading", { name: "修改记录" }) });
  await expect(changes).toContainText("需调整司机");
  await expectAccessible(page, "订单详情：修改待确认");
  await expectNoHorizontalOverflow(page, "订单详情：修改待确认");

  // 同意：订单更新
  await changes.getByRole("button", { name: "同意" }).click();
  await expect(changes).toContainText("已生效");
  await expect(page.locator("body")).toContainText(`${newDay} 10:00`);

  // 司机收到新链接，打开看到新时间
  const updated = await waitForMail(driverEmail, /这张任务有更新/);
  const token = /\/driver#(nzd_[A-Za-z0-9_.-]+)/.exec(updated)?.[1];
  expect(token, "邮件里有新链接").toBeTruthy();
  for (const secret of ["虚构乘客", "+819000000000", guestEmail, "虚构市虚构路一号"]) expect(updated.replace(token as string, ""), `司机邮件不能有 ${secret}`).not.toContain(secret);
  const driverContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "zh-CN", baseURL: `http://127.0.0.1:${E2E_WEB_DRIVER_MAIL_PORT}` });
  const driverPage = await driverContext.newPage();
  await driverPage.goto(`/driver#${token}`);
  await expect(driverPage.getByRole("heading", { level: 1 })).toContainText(`${newDay} 10:00`);
  await expect(driverPage.getByText(/客人申请修改/)).toHaveCount(0);

  // 客人收到结果，订单页显示新时间
  const result = await waitForMail(guestEmail, /您的订单修改已生效/);
  expect(result).toContain(`${newDay} 10:00`);
  expect(result).not.toContain("20000");
  await guest.reload();
  await expect(guest.locator("section").filter({ has: guest.getByRole("heading", { level: 2, name: "修改订单" }) }).getByText("已修改", { exact: true })).toBeVisible();
  await guestContext.close();
  await driverContext.close();
});
