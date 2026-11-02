/**
 * 司机链接自动发邮件（M4-27，ADR 0058），真实浏览器 → 构建好的前端 → 真实 API → 真实 PostgreSQL + 本机假 SMTP（从不连真实的邮件服务）。
 * 供应商给司机填邮箱 → 派车 → 假 SMTP 收到 → 司机打开邮件里的链接 → 调度员复制的链接也能用 → 改派后旧链接都失效、新司机收到新链接 → 改成手动发送后不再发。
 * 用这一组自己的 API（配置文件里有假 SMTP）：主 API 的邮件设置别的用例会填、会清空。订单是远期的、派了车才挪不到临近，后台救援任务不会抢先。全部是虚构数据。
 */
import { randomBytes, randomInt } from "node:crypto";
import { type Browser, expect, test } from "@playwright/test";
import { createPool } from "../../api/src/db/pool.ts";
import { decodedMailText } from "../../api/src/testing/fake-integrations.ts";
import { E2E_WEB_DRIVER_MAIL_PORT } from "../playwright.config.ts";
import { createProductByApi, createSupplier, createWorld, expectAccessible } from "./catalog.ts";
import { expectNoHorizontalOverflow, loginAs } from "./support.ts";

test.use({ baseURL: `http://127.0.0.1:${E2E_WEB_DRIVER_MAIL_PORT}` });

async function seedPaidOrder(input: { tenantId: string; cityId: string; airportId: string; productId: string; groupId: string }): Promise<string> {
  const url = process.env["E2E_DATABASE_OWNER_URL"];
  if (!url) throw new Error("global-setup 没有准备好数据库连接");
  const client = createPool(url, { max: 1 });
  try {
    const now = new Date();
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 5, 1, 0));
    const local = new Date(day.getTime() + 9 * 3_600_000).toISOString().slice(0, 16);
    const alphabet = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
    const orderNo = `NZ${now.toISOString().slice(0, 10).replaceAll("-", "")}${Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join("")}`;
    await client.query(
      `insert into orders (tenant_id, order_no, status, category, city_id, place_id, direction, product_id, product_version, vehicle_group_id, service_at, service_local, timezone, service_date,
                           urgent, passengers, luggage, dropoff, addons, flight_no, passenger, settlement_minor, settlement_currency, settlement, free_wait_minutes, inventory_held,
                           payment_due_at, confirmed_at, dispatch_due_at, created_at, updated_at)
       values ($1, $2, 'confirmed', 'airport_transfer', $3, $4, 'pickup', $5, 1, $6, $7, $8, 'Asia/Tokyo', $9, false, 2, 1, $10::jsonb, '[]'::jsonb, 'NH211', $11::jsonb, 20000, 'JPY', $12::jsonb, 90, false,
               now() + interval '30 minutes', now(), $7::timestamptz - interval '24 hours', now(), now())`,
      [
        input.tenantId, orderNo, input.cityId, input.airportId, input.productId, input.groupId, day, local, local.slice(0, 10),
        JSON.stringify({ lng: 139.76, lat: 35.68, address: "虚构市虚构路一号" }),
        JSON.stringify({ name: "虚构乘客", phone: "+819000000000", email: "fictional.guest@e2e.example.com" }),
        JSON.stringify({ currency: "JPY", roundingUnit: 1, totalMinor: 20000, baseMinor: 20000, adjustMinor: 0, urgentMinor: 0, nightMinor: 0, addonsMinor: 0, driverLanguageMinor: 0 }),
      ],
    );
    return orderNo;
  } finally {
    await client.end();
  }
}

async function mailsTo(email: string): Promise<string[]> {
  const stats = (await (await fetch(process.env["E2E_FAKE_SMTP_STATS_URL"] as string)).json()) as { messages: { to: string[]; data: string }[] };
  return stats.messages.filter((message) => message.to.includes(email)).map((message) => decodedMailText(message.data));
}

/** 等这个地址收到第 `count` 封，返回邮件里的令牌（`/driver#` 后面的部分）。 */
async function waitForLink(email: string, count: number): Promise<{ text: string; token: string }> {
  let found: string | undefined;
  await expect.poll(async () => { found = (await mailsTo(email)).at(count - 1); return found !== undefined; }, { timeout: 40_000, intervals: [1_000] }).toBe(true);
  const text = found as string;
  const token = /\/driver#(nzd_[A-Za-z0-9_.-]+)/.exec(text)?.[1];
  expect(token, "邮件里有司机链接").toBeTruthy();
  return { text, token: token as string };
}

async function openDriverPage(browser: Browser, token: string): Promise<{ page: import("@playwright/test").Page; close(): Promise<void> }> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "zh-CN", baseURL: `http://127.0.0.1:${E2E_WEB_DRIVER_MAIL_PORT}` });
  const page = await context.newPage();
  await page.goto(`/driver#${token}`);
  return { page, close: () => context.close() };
}

test("派车 → 假 SMTP 收到 → 打开邮件链接 → 复制的链接也能用 → 改派后旧链接都失效、新司机收到 → 手动模式不发", async ({ page, request, browser }) => {
  test.setTimeout(180_000);
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  const product = await createProductByApi(request, supplier, world, "airport_transfer");
  const seed = { tenantId: supplier.tenant.tenantId, cityId: world.city.id, airportId: world.airport.id, productId: product.id, groupId: world.group.id };
  const orderNo = await seedPaidOrder(seed);
  const tag = randomBytes(4).toString("hex");
  const firstEmail = `fictional.first.${tag}@e2e.example.com`;
  const secondEmail = `fictional.second.${tag}@e2e.example.com`;

  await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);

  // 司机：第一位在页面上填邮箱，打错的被拒绝
  await page.getByRole("link", { name: "司机" }).click();
  await page.getByRole("button", { name: "新增司机" }).click();
  const driverDialog = page.getByRole("dialog", { name: "新增司机" });
  await driverDialog.getByLabel("姓名").fill("虚构司机甲");
  await driverDialog.getByLabel("手机").fill(`+8190${randomInt(10_000_000, 99_999_999)}`);
  await driverDialog.getByLabel("邮箱（选填）").fill("not-an-email");
  await driverDialog.getByLabel("驾照到期日").fill("2035-01-01");
  await driverDialog.getByRole("button", { name: "保存" }).click();
  await expect(driverDialog.locator(".field__error, [id$='-error']").first()).toBeVisible();
  await driverDialog.getByLabel("邮箱（选填）").fill(firstEmail);
  await driverDialog.getByRole("button", { name: "保存" }).click();
  const firstRow = page.getByRole("row").filter({ hasText: "虚构司机甲" });
  await expect(firstRow).toContainText("fi***@e2e.example.com");
  expect(await page.locator("body").innerText()).not.toContain(firstEmail);
  await expectNoHorizontalOverflow(page, "司机列表带邮箱列");

  // 第二位司机、车辆走接口
  const headers = supplier.headers;
  const created = await request.post("/tenant/v1/drivers", { headers: { ...headers, "idempotency-key": crypto.randomUUID() }, data: { name: "虚构司机乙", phone: `+8190${randomInt(10_000_000, 99_999_999)}`, email: secondEmail, languages: ["ja"], license_expires_on: "2035-01-01" } });
  expect(created.ok(), await created.text()).toBe(true);
  const plate = `品川 300 あ ${randomInt(1000, 9999)}`;
  const vehicle = await request.post("/tenant/v1/vehicles", { headers: { ...headers, "idempotency-key": crypto.randomUUID() }, data: { plate, vehicle_group_id: world.group.id, model: "虚构车型", color: "黑", seats: 7, mileage_km: 12_000, plate_type: "business", insurance_expires_on: "2035-01-01", inspection_expires_on: "2035-01-01" } });
  expect(vehicle.ok(), await vehicle.text()).toBe(true);

  // 派车：弹窗有链接、复制按钮和发送状态
  await page.goto("/orders");
  await page.getByRole("link", { name: orderNo }).click();
  await page.getByRole("button", { name: "派车", exact: true }).click();
  let dialog = page.getByRole("dialog", { name: "派车" });
  await dialog.getByLabel("司机").selectOption({ label: "虚构司机甲（ja）" });
  await dialog.getByLabel("车辆").selectOption({ label: `${plate} · 虚构车型` });
  await dialog.getByRole("button", { name: "确定派车" }).click();
  let linkDialog = page.getByRole("dialog", { name: "司机链接" });
  const copied = await linkDialog.getByLabel("链接", { exact: true }).inputValue();
  await expect(linkDialog.getByRole("button", { name: "复制链接" })).toBeVisible();
  await expect(linkDialog.getByText(/fi\*\*\*@e2e\.example\.com/)).toBeVisible();
  await expect(linkDialog.getByText(/已自动发到 fi\*\*\*@e2e\.example\.com（邮件服务器已接收）/)).toBeVisible({ timeout: 40_000 });
  expect(await linkDialog.innerText()).not.toContain(firstEmail);
  expect(await linkDialog.innerText()).not.toContain("司机已收到");
  await expectAccessible(page, "司机链接弹窗（已发送）");

  // 假 SMTP 收到：只有行程概要和链接，写明不要转发
  const first = await waitForLink(firstEmail, 1);
  expect(first.text).toContain(orderNo);
  expect(first.text).toContain("不要转发");
  for (const secret of ["+819000000000", "fictional.guest", "虚构乘客", "虚构市虚构路一号", "20000", "20,000", "JPY"]) expect(first.text, secret).not.toContain(secret);
  await linkDialog.getByRole("button", { name: "知道了" }).click();

  // 司机打开邮件里的链接；调度员复制的那条同时有效
  const fromMail = await openDriverPage(browser, first.token);
  await expect(fromMail.page.getByText("虚构乘客 · 2 人 1 件行李")).toBeVisible();
  expect(await fromMail.page.locator("body").innerText()).not.toMatch(/JPY|20,000|结算|对外价|价格/);
  const fromCopy = await openDriverPage(browser, copied.split("#")[1] as string);
  await expect(fromCopy.page.getByText("虚构乘客 · 2 人 1 件行李")).toBeVisible();

  // 订单详情：最新状态和重发按钮，「司机已打开」也算上邮件那条
  await page.reload();
  await expect(page.getByText(/已自动发到 fi\*\*\*@e2e\.example\.com（邮件服务器已接收）/)).toBeVisible();
  await expect(page.getByRole("button", { name: "重发邮件" })).toBeVisible();
  await expect(page.getByText(/司机最近打开/)).toBeVisible();
  await expectAccessible(page, "订单详情带发送状态");

  // 改派：两条旧链接都失效，新司机收到新链接
  await page.getByRole("button", { name: "改派", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "改派" });
  await dialog.getByLabel("司机").selectOption({ label: "虚构司机乙（ja）" });
  await dialog.getByRole("button", { name: "确定派车" }).click();
  linkDialog = page.getByRole("dialog", { name: "司机链接" });
  await expect(linkDialog.getByLabel("链接", { exact: true })).toBeVisible();
  const second = await waitForLink(secondEmail, 1);
  await linkDialog.getByRole("button", { name: /知道了|我已发给司机/ }).click();
  for (const stale of [first.token, copied.split("#")[1] as string]) {
    const dead = await openDriverPage(browser, stale);
    await expect(dead.page.getByText("链接无效或已过期，请联系调度重新发送。")).toBeVisible();
    await dead.close();
  }
  expect((await mailsTo(firstEmail)).length, "旧司机没有再收到").toBe(1);
  const fresh = await openDriverPage(browser, second.token);
  await expect(fresh.page.getByText("虚构乘客 · 2 人 1 件行李")).toBeVisible();
  await fresh.close();
  await fromMail.close();
  await fromCopy.close();

  // 管理员改成手动发送：下一张单不发，弹窗提示手动发，复制按钮还在
  await page.goto("/settings/notifications");
  await page.getByLabel("发送方式").selectOption("manual");
  await page.getByRole("button", { name: "更新发送方式" }).click();
  await expect(page.getByText("已保存").first()).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("发送方式")).toHaveValue("manual");
  await expectAccessible(page, "通知设置带发送方式");

  const manualOrderNo = await seedPaidOrder(seed);
  const manualEmail = `fictional.third.${tag}@e2e.example.com`;
  const third = await request.post("/tenant/v1/drivers", { headers: { ...headers, "idempotency-key": crypto.randomUUID() }, data: { name: "虚构司机丙", phone: `+8190${randomInt(10_000_000, 99_999_999)}`, email: manualEmail, languages: ["ja"], license_expires_on: "2035-01-01" } });
  expect(third.ok(), await third.text()).toBe(true);
  const manualPlate = `品川 300 あ ${randomInt(1000, 9999)}`;
  await request.post("/tenant/v1/vehicles", { headers: { ...headers, "idempotency-key": crypto.randomUUID() }, data: { plate: manualPlate, vehicle_group_id: world.group.id, model: "虚构车型", color: "黑", seats: 7, mileage_km: 12_000, plate_type: "business", insurance_expires_on: "2035-01-01", inspection_expires_on: "2035-01-01" } });
  await page.goto("/orders");
  await page.getByRole("link", { name: manualOrderNo }).click();
  await page.getByRole("button", { name: "派车", exact: true }).click();
  dialog = page.getByRole("dialog", { name: "派车" });
  await dialog.getByLabel("司机").selectOption({ label: "虚构司机丙（ja）" });
  await dialog.getByLabel("车辆").selectOption({ label: `${manualPlate} · 虚构车型` });
  await dialog.getByRole("button", { name: "确定派车" }).click();
  linkDialog = page.getByRole("dialog", { name: "司机链接" });
  await expect(linkDialog.getByText("当前设置是手动发送，请复制链接发给司机。")).toBeVisible();
  await expect(linkDialog.getByRole("button", { name: "复制链接" })).toBeVisible();
  await linkDialog.getByRole("button", { name: "我已发给司机" }).click();
  await expect(page.getByRole("button", { name: "重发邮件" })).toHaveCount(0);
  await page.waitForTimeout(6_000);
  expect((await mailsTo(manualEmail)).length, "手动模式不发").toBe(0);
});
