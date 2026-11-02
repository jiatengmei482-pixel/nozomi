/**
 * QA（M4-27，ADR 0058）：页面上开发的端到端没覆盖的：320 宽度（含超长邮箱域名）、连点「重发邮件」、重新生成后的弹窗、只读角色、状态文案。
 * 真实浏览器 → 构建好的前端 → 真实 API → 真实 PostgreSQL + 本机假 SMTP。全部虚构数据。
 */
import { randomBytes, randomInt } from "node:crypto";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { createPool } from "../../api/src/db/pool.ts";
import { E2E_WEB_DRIVER_MAIL_PORT } from "../playwright.config.ts";
import { createProductByApi, createSupplier, createWorld } from "./catalog.ts";
import { expectNoHorizontalOverflow, loginAs } from "./support.ts";

test.use({ baseURL: `http://127.0.0.1:${E2E_WEB_DRIVER_MAIL_PORT}` });

async function withOwner<T>(work: (client: ReturnType<typeof createPool>) => Promise<T>): Promise<T> {
  const url = process.env["E2E_DATABASE_OWNER_URL"];
  if (!url) throw new Error("global-setup 没有准备好数据库连接");
  const client = createPool(url, { max: 1 });
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

interface Seed {
  tenantId: string;
  cityId: string;
  airportId: string;
  productId: string;
  groupId: string;
}

async function seedPaidOrder(input: Seed): Promise<{ id: string; orderNo: string }> {
  return withOwner(async (client) => {
    const now = new Date();
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 5 + randomInt(0, 300), 1, 0));
    const local = new Date(day.getTime() + 9 * 3_600_000).toISOString().slice(0, 16);
    const alphabet = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    const orderNo = `NZ${now.toISOString().slice(0, 10).replaceAll("-", "")}${Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join("")}`;
    const inserted = await client.query<{ id: string }>(
      `insert into orders (tenant_id, order_no, status, category, city_id, place_id, direction, product_id, product_version, vehicle_group_id, service_at, service_local, timezone, service_date,
                           urgent, passengers, luggage, dropoff, addons, flight_no, passenger, settlement_minor, settlement_currency, settlement, free_wait_minutes, inventory_held,
                           payment_due_at, confirmed_at, dispatch_due_at, created_at, updated_at)
       values ($1, $2, 'confirmed', 'airport_transfer', $3, $4, 'pickup', $5, 1, $6, $7, $8, 'Asia/Tokyo', $9, false, 2, 1, $10::jsonb, '[]'::jsonb, 'NH211', $11::jsonb, 20000, 'JPY', $12::jsonb, 90, false,
               now() + interval '30 minutes', now(), $7::timestamptz - interval '24 hours', now(), now()) returning id`,
      [
        input.tenantId, orderNo, input.cityId, input.airportId, input.productId, input.groupId, day, local, local.slice(0, 10),
        JSON.stringify({ lng: 139.76, lat: 35.68, address: "虚构市虚构路二号" }),
        JSON.stringify({ name: "虚构乘客", phone: "+819000000000", email: "fictional.guest@e2e.example.com" }),
        JSON.stringify({ currency: "JPY", roundingUnit: 1, totalMinor: 20000, baseMinor: 20000, adjustMinor: 0, urgentMinor: 0, nightMinor: 0, addonsMinor: 0, driverLanguageMinor: 0 }),
      ],
    );
    return { id: (inserted.rows[0] as { id: string }).id, orderNo };
  });
}

async function setupSupplier(request: APIRequestContext) {
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  const product = await createProductByApi(request, supplier, world, "airport_transfer");
  const seed: Seed = { tenantId: supplier.tenant.tenantId, cityId: world.city.id, airportId: world.airport.id, productId: product.id, groupId: world.group.id };
  const headers = supplier.headers;
  const newDriver = async (name: string, email: string | null): Promise<{ id: string }> => {
    const res = await request.post("/tenant/v1/drivers", { headers: { ...headers, "idempotency-key": crypto.randomUUID() }, data: { name, phone: `+8190${randomInt(10_000_000, 99_999_999)}`, ...(email === null ? {} : { email }), languages: ["ja"], license_expires_on: "2035-01-01" } });
    expect(res.ok(), await res.text()).toBe(true);
    return (await res.json()) as { id: string };
  };
  const newVehicle = async (): Promise<{ id: string; label: string }> => {
    const plate = `品川 300 あ ${randomInt(1000, 9999)}`;
    const res = await request.post("/tenant/v1/vehicles", { headers: { ...headers, "idempotency-key": crypto.randomUUID() }, data: { plate, vehicle_group_id: world.group.id, model: "虚构车型", color: "黑", seats: 7, mileage_km: 12_000, plate_type: "business", insurance_expires_on: "2035-01-01", inspection_expires_on: "2035-01-01" } });
    expect(res.ok(), await res.text()).toBe(true);
    return { id: ((await res.json()) as { id: string }).id, label: `${plate} · 虚构车型` };
  };
  const assign = async (orderId: string, driverId: string, vehicleId: string, version = 1): Promise<any> => {
    const res = await request.post(`/tenant/v1/orders/${orderId}/assign`, { headers: { ...headers, "if-match": `"${version}"` }, data: { driver_id: driverId, vehicle_id: vehicleId } });
    expect(res.ok(), await res.text()).toBe(true);
    return res.json();
  };
  return { supplier, seed, headers, newDriver, newVehicle, assign };
}

const requestCount = (orderId: string): Promise<number> => withOwner(async (client) => (await client.query<{ n: number }>("select count(*)::int as n from driver_link_emails where order_id = $1", [orderId])).rows[0]?.n ?? 0);
/** 不用真等 60 秒：把这张单的发起时间往前挪（测试自己的数据）。 */
const passCooldown = (orderId: string): Promise<unknown> => withOwner((client) => client.query("update driver_link_emails set requested_at = requested_at - interval '2 minutes' where order_id = $1", [orderId]));

const DRIVERS_PATH = "/fleet/drivers";
const narrow = async (page: Page): Promise<void> => page.setViewportSize({ width: 320, height: 640 });

test("320 宽：订单详情的发送状态和重发按钮、司机列表，带超长邮箱域名都不撑破页面；复制按钮在弹窗里够得着", async ({ page, request }) => {
  test.setTimeout(120_000);
  const { supplier, seed, newDriver, newVehicle, assign } = await setupSupplier(request);
  const longDomain = `${"verylongfictionalcompanyname".repeat(3)}.${"subdomain".repeat(4)}.example.com`;
  const email = `fictional.${randomBytes(3).toString("hex")}@${longDomain}`;
  const driver = await newDriver("虚构长邮箱司机", email);
  const vehicle = await newVehicle();
  const order = await seedPaidOrder(seed);
  await assign(order.id, driver.id, vehicle.id);

  await narrow(page);
  await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);
  await page.goto(`/orders/${order.id}`);
  const masked = `fi***@${longDomain}`;
  await expect(page.getByText(new RegExp(`已自动发到 fi\\*\\*\\*@`))).toBeVisible({ timeout: 40_000 });
  await expect(page.getByRole("button", { name: "重发邮件" })).toBeVisible();
  await expectNoHorizontalOverflow(page, "订单详情：超长邮箱域名的发送状态");
  expect(await page.locator("body").innerText()).not.toContain(email);

  await page.goto(DRIVERS_PATH);
  await expect(page.getByText(masked).first()).toBeAttached();
  await expectNoHorizontalOverflow(page, "司机列表：超长邮箱域名");
  expect(await page.locator("body").innerText()).not.toContain(email);

  await page.goto(`/orders/${order.id}`);
  await page.getByRole("button", { name: "重新生成" }).first().click();
  const confirm = page.getByRole("dialog").last();
  const confirmButton = confirm.getByRole("button", { name: /重新生成|确定/ }).last();
  if (await confirmButton.isVisible()) await confirmButton.click();
  const linkDialog = page.getByRole("dialog", { name: "司机链接" });
  await expect(linkDialog.getByRole("button", { name: "复制链接" })).toBeVisible();
  await linkDialog.getByRole("button", { name: "复制链接" }).scrollIntoViewIfNeeded();
  await expect(linkDialog.getByText(/这条链接还没有发邮件/)).toBeVisible();
  await expectNoHorizontalOverflow(page, "重新生成后的弹窗");
  expect(await linkDialog.innerText()).not.toContain("司机已收到");
  expect(await linkDialog.innerText()).not.toContain(email);
});

test("连点「重发邮件」：只发起一次；按钮在排队时不能再点；过了连点保护才能再发；页面不写「司机已收到」", async ({ page, request }) => {
  test.setTimeout(120_000);
  const { supplier, seed, newDriver, newVehicle, assign } = await setupSupplier(request);
  const email = `fictional.dbl.${randomBytes(4).toString("hex")}@e2e.example.com`;
  const driver = await newDriver("虚构连点司机", email);
  const vehicle = await newVehicle();
  const order = await seedPaidOrder(seed);
  await assign(order.id, driver.id, vehicle.id);
  await passCooldown(order.id);
  expect(await requestCount(order.id)).toBe(1);

  const posts: string[] = [];
  page.on("request", (sent) => {
    if (sent.method() === "POST" && sent.url().endsWith(`/tenant/v1/orders/${order.id}/driver-link/email`)) posts.push(sent.url());
  });
  await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);
  await page.goto(`/orders/${order.id}`);
  const button = page.getByRole("button", { name: "重发邮件" });
  await expect(button).toBeVisible({ timeout: 20_000 });
  await button.dblclick();
  await expect(page.getByText("已排队重发，现有的链接不受影响")).toBeVisible();
  await expect.poll(() => requestCount(order.id)).toBe(2);
  await page.waitForTimeout(1_500);
  expect(await requestCount(order.id), "连点只发起一次").toBe(2);
  expect(posts.length, "连点只发出一个请求").toBe(1);

  await expect(button).toBeEnabled();
  await button.click();
  await expect(page.getByText(/发得太频繁了，请过 \d+ 秒再试/)).toBeVisible();
  expect(await requestCount(order.id)).toBe(2);
  expect(await page.locator("body").innerText()).not.toContain("司机已收到");
});

test("只读角色：看得到打码的状态，没有重发、派车、重新生成；司机列表只有打码；发送方式不能改", async ({ page, request }) => {
  test.setTimeout(120_000);
  const { supplier, seed, headers, newDriver, newVehicle, assign } = await setupSupplier(request);
  const email = `fictional.ro.${randomBytes(4).toString("hex")}@e2e.example.com`;
  const driver = await newDriver("虚构只读可见司机", email);
  const vehicle = await newVehicle();
  const order = await seedPaidOrder(seed);
  await assign(order.id, driver.id, vehicle.id);

  const readonlyEmail = `fictional.readonly.${randomBytes(4).toString("hex")}@e2e.example.com`;
  const invited = await request.post("/tenant/v1/users", { headers, data: { email: readonlyEmail, name: "虚构只读员工", role: "readonly" } });
  expect(invited.ok(), await invited.text()).toBe(true);
  const invite = ((await invited.json()) as { invite: { token: string } }).invite;
  const password = `Qa-${randomBytes(12).toString("base64url")}`;
  const accepted = await request.post("/tenant/v1/auth/accept-invite", { data: { token: invite.token, password } });
  expect(accepted.ok(), await accepted.text()).toBe(true);

  await narrow(page);
  await loginAs(page, "tenant", readonlyEmail, password);
  await page.goto(`/orders/${order.id}`);
  await expect(page.getByText(/fi\*\*\*@e2e\.example\.com/)).toBeVisible({ timeout: 40_000 });
  await expect(page.getByRole("button", { name: "重发邮件" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^(派车|改派)$/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "重新生成" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "复制链接" })).toHaveCount(0);
  expect(await page.locator("body").innerText()).not.toContain(email);
  await expectNoHorizontalOverflow(page, "只读角色的订单详情");

  await page.goto(DRIVERS_PATH);
  await expect(page.getByText("fi***@e2e.example.com").first()).toBeAttached();
  expect(await page.content()).not.toContain(email);

  await page.goto("/settings/notifications");
  await expect(page.getByText(/只有管理员能改/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "更新发送方式" })).toHaveCount(0);
  await expect(page.getByLabel("发送方式")).toHaveCount(0);
});

test("没有邮箱的司机：派车弹窗提示手动发、复制按钮够得着；详情里没有重发按钮；320 宽", async ({ page, request }) => {
  test.setTimeout(120_000);
  const { supplier, seed, newDriver, newVehicle } = await setupSupplier(request);
  await newDriver("虚构无邮箱司机", null);
  const vehicle = await newVehicle();
  const order = await seedPaidOrder(seed);

  await narrow(page);
  await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);
  await page.goto(`/orders/${order.id}`);
  await page.getByRole("button", { name: "派车", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "派车" });
  await dialog.getByLabel("司机").selectOption({ label: "虚构无邮箱司机（ja）" });
  await dialog.getByLabel("车辆").selectOption({ label: vehicle.label });
  await dialog.getByRole("button", { name: "确定派车" }).click();
  const linkDialog = page.getByRole("dialog", { name: "司机链接" });
  await expect(linkDialog.getByText(/这位司机没有邮箱，请复制链接手动发/)).toBeVisible();
  const copy = linkDialog.getByRole("button", { name: "复制链接" });
  await copy.scrollIntoViewIfNeeded();
  await expect(copy).toBeVisible();
  await expectNoHorizontalOverflow(page, "没有邮箱的派车弹窗");
  await linkDialog.getByRole("button", { name: "我已发给司机" }).click();
  await expect(page.getByRole("button", { name: "重发邮件" })).toHaveCount(0);
});
