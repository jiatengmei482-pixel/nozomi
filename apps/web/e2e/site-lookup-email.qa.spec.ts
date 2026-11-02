/**
 * M4-30 测试角色：官网查订单把链接发到下单邮箱（ADR 0061）的关键流程，真实浏览器 → 构建好的前端 → 真实 API → 真实 PostgreSQL + 本机假 SMTP（从不连真实的邮件服务）。
 * - 客服在运营后台订单详情「官网订单链接」核实后重发到下单邮箱 → 假 SMTP 收到 → 链接能打开这张单；
 *   发到核实后的新邮箱 → 页面显示等审核（只有打码地址）→ 另一位运营批准 → 新邮箱收到、下单邮箱不收这一封；区块亮暗两色过 axe、窄屏不横向滚动；
 * - 查订单被订单号额度挡下：页面说「尝试次数过多…或联系客服」，不说「已发送」，也不说订单存不存在；不存在的订单号被挡时页面上一模一样。
 * 用司机链接邮件那一组 API（配置文件里有假 SMTP 和官网渠道，见 global-setup）。远期的单，全部是虚构数据。
 */
import { randomBytes } from "node:crypto";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { decodedMailText } from "../../api/src/testing/fake-integrations.ts";
import { E2E_WEB_DRIVER_MAIL_PORT } from "../playwright.config.ts";
import { CENTER, type Supplier, type World, createProductByApi, createSupplier, createWorld, expectAccessible } from "./catalog.ts";
import { approveApproval, expectNoHorizontalOverflow, loginAs, newPassword, platformAdminHeaders, uniqueEmail } from "./support.ts";

test.use({ baseURL: `http://127.0.0.1:${E2E_WEB_DRIVER_MAIL_PORT}` });

const RULES = {
  booking: { sale_from: null, sale_to: null, service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 0, note: null },
  urgent: { enabled: false, daily_quota: null, tiers: [] },
  night: { enabled: false, window: null, amount: null, charge_unit: null },
  free_wait: { pickup: { mode: "limited", minutes: 60 }, dropoff: { mode: "limited", minutes: 60 }, general: null },
  addons: [],
  driver_languages: [],
};

async function productVersion(request: APIRequestContext, supplier: Supplier, id: string): Promise<number> {
  return ((await (await request.get(`/tenant/v1/products/${id}`, { headers: supplier.headers })).json()) as { version: number }).version;
}

async function publishedProduct(request: APIRequestContext, supplier: Supplier, world: World): Promise<void> {
  const product = await createProductByApi(request, supplier, world, "airport_transfer");
  const rules = await request.put(`/tenant/v1/products/${product.id}/service-rules`, { headers: { ...supplier.headers, "if-match": `"${product.version}"` }, data: RULES });
  expect(rules.status(), await rules.text()).toBe(200);
  const content = await request.put(`/tenant/v1/products/${product.id}/content`, { headers: { ...supplier.headers, "if-match": `"${((await rules.json()) as { version: number }).version}"` }, data: { zh: { title: "官网接送机", pickup_guide: "到达大厅 2 号出口" } } });
  expect(content.status(), await content.text()).toBe(200);
  const { today } = (await (await request.get(`/tenant/v1/products/${product.id}/price-rules`, { headers: supplier.headers })).json()) as { today: string };
  const price = await request.post(`/tenant/v1/products/${product.id}/price-rules/batch`, {
    headers: { ...supplier.headers, "if-match": `"${await productVersion(request, supplier, product.id)}"`, "idempotency-key": crypto.randomUUID() },
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

/** 经 /site/v1 下一张远期的接机单（待付款）。 */
async function placeSiteOrder(request: APIRequestContext, world: World, email: string): Promise<{ id: string; orderNo: string }> {
  const quoted = await request.post("/site/v1/quotes", { data: { city_id: world.city.id, airport_id: world.airport.id, direction: "pickup", address: { lat: CENTER.lat + 0.01, lng: CENTER.lng + 0.01 }, service_local: tokyoDaysAhead(20), passengers: 1, luggage: 0 } });
  expect(quoted.status(), await quoted.text()).toBe(200);
  const quote = ((await quoted.json()) as { quotes: { quote_id: string; vehicle_group: { id: string } }[] }).quotes.find((q) => q.vehicle_group.id === world.group.id);
  expect(quote, "报出了这个车型组的价").toBeTruthy();
  const created = await request.post("/site/v1/orders", { headers: { "idempotency-key": crypto.randomUUID() }, data: { quote_id: quote?.quote_id, passenger: { name: "虚构乘客乙", phone: "+81 90-0000-2222", email }, flight_no: "JL061", dropoff_address: "虚构市虚构路二号", save_payment_method: true } });
  expect(created.status(), await created.text()).toBe(201);
  const body = (await created.json()) as { order: { id: string; order_no: string } };
  return { id: body.order.id, orderNo: body.order.order_no };
}

async function mailsTo(email: string): Promise<string[]> {
  const stats = (await (await fetch(process.env["E2E_FAKE_SMTP_STATS_URL"] as string)).json()) as { messages: { to: string[]; data: string }[] };
  return stats.messages.filter((message) => message.to.includes(email)).map((message) => decodedMailText(message.data));
}

const tokenIn = (text: string): string | undefined => /\/book\/order#(nzo_[A-Za-z0-9_-]{43})/.exec(text)?.[1];

/** 经真实接口邀请一位平台员工并设好密码。 */
async function inviteStaff(request: APIRequestContext, role: string, name: string): Promise<{ email: string; password: string }> {
  const headers = await platformAdminHeaders(request);
  const email = uniqueEmail(`qa-${role}`);
  const password = newPassword();
  const invited = await request.post("/platform/v1/staff", { headers, data: { email, name, role } });
  expect(invited.status(), await invited.text()).toBe(201);
  const token = ((await invited.json()) as { invite: { token: string } }).invite.token;
  const accepted = await request.post("/platform/v1/auth/accept-invite", { data: { token, password } });
  expect(accepted.status(), await accepted.text()).toBe(200);
  return { email, password };
}

async function fillResendDialog(page: Page, options: { newEmail?: string; verification: string; reason: string }): Promise<void> {
  const dialog = page.getByRole("dialog", { name: "重发官网订单链接" });
  await expect(dialog).toBeVisible();
  if (options.newEmail !== undefined) {
    await dialog.getByRole("radio", { name: /发到核实后的新邮箱/ }).check();
    await dialog.getByRole("textbox", { name: /^核实后的新邮箱/ }).fill(options.newEmail);
  }
  await dialog.getByLabel(/怎么核实的/).selectOption(options.verification);
  await dialog.getByRole("textbox", { name: /原因/ }).fill(options.reason);
  await dialog.getByRole("button", { name: options.newEmail === undefined ? "发送" : "提交审核" }).click();
  await expect(dialog).toHaveCount(0);
}

test("客服在订单详情核实后重发：发到下单邮箱直接收到、链接能开；发到新邮箱要另一位运营批准，批准后新邮箱收到、下单邮箱不收；区块亮暗两色、窄屏", async ({ page, request }) => {
  test.setTimeout(180_000);
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  await publishedProduct(request, supplier, world);
  const email = `fictional.staff.${randomBytes(4).toString("hex")}@e2e.example.com`;
  const fresh = `fictional.fixed.${randomBytes(4).toString("hex")}@e2e.example.com`;
  const order = await placeSiteOrder(request, world, email);
  const cs = await inviteStaff(request, "customer_service", "端到端客服（M4-30）");

  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAs(page, "platform", cs.email, cs.password);
  await page.goto(`/platform/orders/${order.id}`);
  const section = page.locator("section", { has: page.getByRole("heading", { name: "官网订单链接" }) });
  await expect(section).toBeVisible();
  await expect(section).toContainText("fi***@e2e.example.com");
  await expect(section).not.toContainText(email);

  // 发到下单邮箱
  await section.getByRole("button", { name: "重发订单链接" }).click();
  await fillResendDialog(page, { verification: "callback_phone", reason: "客人来电说链接找不到了，回拨下单电话确认是本人" });
  await expect(section.getByRole("cell", { name: "已排进通知中心" })).toBeVisible();
  let mail: string | undefined;
  await expect.poll(async () => ((mail = (await mailsTo(email))[0]) !== undefined), { timeout: 40_000, intervals: [1_000] }).toBe(true);
  const token = tokenIn(mail as string);
  expect(token, "邮件里有订单链接").toBeTruthy();
  for (const secret of ["虚构乘客乙", "+81 90-0000-2222", "虚构市虚构路二号", "JL061"]) expect((mail as string).includes(secret), `邮件里不该有 ${secret}`).toBe(false);

  // 发到核实后的新邮箱：等审核
  await section.getByRole("button", { name: "重发订单链接" }).click();
  await fillResendDialog(page, { newEmail: fresh, verification: "payment_details", reason: "下单邮箱写错一个字母，核对了付款时间和卡号末 4 位" });
  await expect(section).toContainText(/发到新邮箱 fi\*\*\*@e2e\.example\.com 在等另一位同事批准/);
  await expect(section.getByRole("link", { name: "去待审核" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(fresh);
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await expectNoHorizontalOverflow(page, `订单详情（${width}px，官网订单链接）`);
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expectAccessible(page, `订单详情（${width}px，${scheme === "light" ? "亮色" : "暗色"}，官网订单链接等审核）`);
    }
  }
  await page.emulateMedia({ colorScheme: "light" });
  // 批准之前谁都不收这一封
  await page.waitForTimeout(3_000);
  expect(await mailsTo(fresh)).toEqual([]);

  const headers = await platformAdminHeaders(request);
  const approvals = (await (await request.get(`/platform/v1/approvals?status=pending&resource_id=${order.id}&limit=50`, { headers })).json()) as { items: { id: string; kind: string }[] };
  const approval = approvals.items.find((item) => item.kind === "order.view_link_email");
  expect(approval, "待审核里有这一条").toBeTruthy();
  await approveApproval(request, approval?.id as string);
  let fixed: string | undefined;
  await expect.poll(async () => ((fixed = (await mailsTo(fresh))[0]) !== undefined), { timeout: 40_000, intervals: [1_000] }).toBe(true);
  expect(await mailsTo(email), "下单邮箱只收到第一封").toHaveLength(1);

  // 两封信里的链接都能打开这张单
  for (const link of [token as string, tokenIn(fixed as string) as string]) {
    await page.goto("/book/order");
    await page.goto(`/book/order#${link}`);
    await expect(page.getByRole("heading", { level: 1, name: `订单 ${order.orderNo}` })).toBeVisible();
  }
});

test("查订单被订单号额度挡下：存在的单和不存在的单页面上一模一样（尝试次数过多…或联系客服），不说「已发送」", async ({ page, request }) => {
  test.setTimeout(120_000);
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  await publishedProduct(request, supplier, world);
  const email = `fictional.limit.${randomBytes(4).toString("hex")}@e2e.example.com`;
  const order = await placeSiteOrder(request, world, email);
  const missing = `NZ${new Date().toISOString().slice(0, 10).replaceAll("-", "")}${randomBytes(4).toString("hex").toUpperCase()}`;
  // 用别的邮箱把两个订单号这一小时的额度用满（经前端的代理，来源地址和页面一样；每个邮箱只用一次）
  for (const orderNo of [order.orderNo, missing]) {
    for (let i = 0; i < 3; i += 1) {
      const res = await request.post("/site/v1/orders/lookup", { data: { order_no: orderNo, email: `fictional.fill${i}.${randomBytes(3).toString("hex")}@e2e.example.com` } });
      if (res.status() === 429) test.skip(true, "这一组 API 的来源地址额度已被别的用例用完（15 分钟 10 次），跳过");
      expect(res.status(), await res.text()).toBe(202);
    }
  }
  const texts: string[] = [];
  for (const orderNo of [order.orderNo, missing]) {
    await page.goto("/book/order");
    await page.getByLabel("订单号").fill(orderNo);
    await page.getByLabel("下单时的邮箱").fill(email);
    await page.getByRole("button", { name: "发送订单链接" }).click();
    const alert = page.getByRole("alert").filter({ hasText: /尝试次数过多/ });
    await expect(alert).toBeVisible();
    await expect(alert).toContainText("联系客服");
    await expect(page.getByText(/如信息匹配，链接已发送/)).toHaveCount(0);
    texts.push((await alert.textContent()) ?? "");
  }
  // 等待时长取决于这个订单号的额度窗口从哪一秒开始（和订单存不存在无关），两次填满差一两秒时会是「60 分钟」和「1 小时」，比较时去掉时长
  const withoutWait = (text: string): string => text.replace(/请 .+?后再试/, "请 <时长>后再试");
  expect(withoutWait(texts[1] as string), "存在和不存在的订单号被挡时页面上一样").toBe(withoutWait(texts[0] as string));
  await page.waitForTimeout(2_000);
  expect(await mailsTo(email), "被挡下的不发信").toEqual([]);
});

test("真实浏览器里的邮箱输入框（type=email）：全角、前后空白照样按半角提交；提交中按钮不能连点（只发一次请求）", async ({ page }) => {
  const bodies: unknown[] = [];
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/site/v1/orders/lookup", async (route) => {
    bodies.push(route.request().postDataJSON());
    await held;
    await route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ status: "accepted" }) });
  });
  await page.goto("/book/order");
  await page.getByLabel("订单号").fill(" nz20261026abcd2345 ");
  await page.getByLabel("下单时的邮箱").fill("　ＱＡ＠ｅｘａｍｐｌｅ．ｃｏｍ　");
  const button = page.getByRole("button", { name: "发送订单链接" });
  await button.click();
  await page.getByRole("button", { name: /正在发送|发送订单链接/ }).click({ force: true, trial: false }).catch(() => undefined);
  release();
  await expect(page.getByRole("status").filter({ hasText: /如信息匹配，链接已发送到下单邮箱/ })).toBeVisible();
  expect(bodies, "只发了一次").toHaveLength(1);
  expect(bodies[0]).toEqual({ order_no: "NZ20261026ABCD2345", email: "QA@example.com" });
});
