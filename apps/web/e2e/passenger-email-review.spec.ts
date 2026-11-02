/**
 * M4-31：运营代客人改乘客邮箱要另一位同事批准（ADR 0065）。真实浏览器 → 构建好的前端 → 真实 API → 真实 PostgreSQL + 本机假 SMTP（从不连真实的邮件服务）。
 * 客服在订单详情「代客人改单」填新邮箱 → 页面提示「需要另一位同事批准」、核实方式和原因必填 → 订单详情显示等审核（只有打码地址）、新地址收不到信
 * → 另一位运营批准 → 新地址收到订单修改的通知、里面的链接能打开这张单。等审核状态亮暗两色过 axe、窄屏不横向滚动。
 * 订单经官网真实接口下；付款和本任务无关（这一组 API 没接收款），用迁移账号直接把订单标为已确认（同 change-approval.spec.ts）。远期的单，全部是虚构数据。
 */
import { randomBytes } from "node:crypto";
import { type APIRequestContext, expect, test } from "@playwright/test";
import { createPool } from "../../api/src/db/pool.ts";
import { decodedMailText } from "../../api/src/testing/fake-integrations.ts";
import { E2E_WEB_DRIVER_MAIL_PORT } from "../playwright.config.ts";
import { CENTER, type Supplier, type World, createProductByApi, createSupplier, createWorld, expectAccessible } from "./catalog.ts";
import { approveApproval, expectNoHorizontalOverflow, loginAs, newPassword, pendingApproval, platformAdminHeaders, uniqueEmail } from "./support.ts";

test.use({ baseURL: `http://127.0.0.1:${E2E_WEB_DRIVER_MAIL_PORT}` });

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

/** 经 /site/v1 下一张远期的接机单，再标为已付款（确认后的单才能代改）。 */
async function confirmedSiteOrder(request: APIRequestContext, world: World, email: string): Promise<{ id: string; orderNo: string }> {
  const quoted = await request.post("/site/v1/quotes", { data: { city_id: world.city.id, airport_id: world.airport.id, direction: "pickup", address: { lat: CENTER.lat + 0.01, lng: CENTER.lng + 0.01 }, service_local: tokyoDaysAhead(25), passengers: 1, luggage: 0 } });
  expect(quoted.status(), await quoted.text()).toBe(200);
  const quote = ((await quoted.json()) as { quotes: { quote_id: string; vehicle_group: { id: string } }[] }).quotes.find((q) => q.vehicle_group.id === world.group.id);
  expect(quote, "报出了这个车型组的价").toBeTruthy();
  const created = await request.post("/site/v1/orders", { headers: { "idempotency-key": crypto.randomUUID() }, data: { quote_id: quote?.quote_id, passenger: { name: "虚构乘客丙", phone: "+81 90-0000-3333", email }, flight_no: "JL062", dropoff_address: "虚构市虚构路三号", save_payment_method: true } });
  expect(created.status(), await created.text()).toBe(201);
  const body = (await created.json()) as { order: { id: string; order_no: string } };
  await owner(async (client) => {
    await client.query("update orders set status = 'confirmed', confirmed_at = now(), dispatch_due_at = service_at - interval '24 hours', updated_at = now() where id = $1", [body.order.id]);
  });
  return { id: body.order.id, orderNo: body.order.order_no };
}

async function mailsTo(email: string): Promise<string[]> {
  const stats = (await (await fetch(process.env["E2E_FAKE_SMTP_STATS_URL"] as string)).json()) as { messages: { to: string[]; data: string }[] };
  return stats.messages.filter((message) => message.to.includes(email)).map((message) => decodedMailText(message.data));
}

const tokenIn = (text: string): string | undefined => /\/book\/order#(nzo_[A-Za-z0-9_-]{43})/.exec(text)?.[1];

async function inviteStaff(request: APIRequestContext, role: string, name: string): Promise<{ email: string; password: string }> {
  const headers = await platformAdminHeaders(request);
  const email = uniqueEmail(`m431-${role}`);
  const password = newPassword();
  const invited = await request.post("/platform/v1/staff", { headers, data: { email, name, role } });
  expect(invited.status(), await invited.text()).toBe(201);
  const token = ((await invited.json()) as { invite: { token: string } }).invite.token;
  const accepted = await request.post("/platform/v1/auth/accept-invite", { data: { token, password } });
  expect(accepted.status(), await accepted.text()).toBe(200);
  return { email, password };
}

test("客服代改乘客邮箱：提示要另一位同事批准 → 等审核期间邮箱不变、新地址不收信 → 运营批准后新地址收到通知、链接能打开；亮暗两色、窄屏", async ({ page, request }) => {
  test.setTimeout(240_000);
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  await publishedProduct(request, supplier, world);
  const tag = randomBytes(4).toString("hex");
  const email = `fictional.old.${tag}@e2e.example.com`;
  const fresh = `fictional.new.${tag}@e2e.example.com`;
  const order = await confirmedSiteOrder(request, world, email);
  const cs = await inviteStaff(request, "customer_service", "端到端客服（M4-31）");

  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAs(page, "platform", cs.email, cs.password);
  await page.goto(`/platform/orders/${order.id}`);
  await page.getByRole("button", { name: "代客人改单" }).click();
  const dialog = page.getByRole("dialog", { name: "代客人改单" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/改乘客邮箱需要另一位同事批准/)).toHaveCount(0);
  await dialog.getByRole("textbox", { name: /乘客的新邮箱/ }).fill(fresh);
  await expect(dialog.getByText(/改乘客邮箱需要另一位同事批准/)).toBeVisible();
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(dialog.getByText(/请选怎么核实的客人身份，并写明原因/)).toBeVisible();
  await dialog.getByLabel(/怎么核实的客人身份/).selectOption("callback_phone");
  await dialog.getByRole("textbox", { name: /^原因/ }).fill("客人来电说下单邮箱填错了，回拨下单电话确认是本人");
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(/需要另一位同事在「待审核」里批准，批准前订单上的邮箱不变/)).toBeVisible();

  const pending = page.getByText(/改成 fi\*\*\*@e2e\.example\.com 在等另一位同事批准（端到端客服（M4-31） 发起）/);
  await expect(pending).toBeVisible();
  await expect(page.getByRole("link", { name: "去待审核" }).first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText(fresh);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoHorizontalOverflow(page, `订单详情（${width}px，改邮箱等审核）`);
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expectAccessible(page, `订单详情（${width}px，${scheme === "light" ? "亮色" : "暗色"}，改邮箱等审核）`);
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForTimeout(3_000);
  expect(await mailsTo(fresh), "批准之前新地址收不到任何信").toEqual([]);

  await approveApproval(request, await pendingApproval(request, order.id, "order.passenger_email"));
  let mail: string | undefined;
  await expect.poll(async () => ((mail = (await mailsTo(fresh))[0]) !== undefined), { timeout: 40_000, intervals: [1_000] }).toBe(true);
  const token = tokenIn(mail as string);
  expect(token, "订单修改的通知里有订单链接").toBeTruthy();
  await page.reload();
  await expect(page.getByText(/在等另一位同事批准/)).toHaveCount(0);
  await page.goto("/book/order");
  await page.goto(`/book/order#${token as string}`);
  await expect(page.getByRole("heading", { level: 1, name: `订单 ${order.orderNo}` })).toBeVisible();
});
