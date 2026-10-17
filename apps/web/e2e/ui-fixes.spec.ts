/**
 * 验收发现的界面小问题（M1-13），真实后端、真实 PostgreSQL：
 * 用过 / 作废的邀请和重置链接一打开就提示失效；供应商详情的复制按钮跟着编号；手机列表卡片的日期有名字；
 * 审计日志的日期填错、填反有提示；运营后台商品详情不出现只对供应商说的话，只读价格表不用灰掉的下拉框。
 * 每个页面状态在 1280px 和 320px 下不横向滚动，亮暗两色各过一次 axe。日期都相对今天，不写死。
 */
import { type Browser, type Page, expect, test } from "@playwright/test";
import { createProductByApi, createSupplier, createWorld, expectAccessible } from "./catalog.ts";
import { adminCredentials, createActiveTenant, createTenant, expectNoHorizontalOverflow, issueTenantAdminReset, loginAs, newPassword, platformAdminHeaders, uniqueEmail } from "./support.ts";

const SCHEMES = ["light", "dark"] as const;

/** 1280px 和 320px 都不横向滚动；亮暗两色都通过 axe。 */
async function checkPage(page: Page, what: string): Promise<void> {
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await expectNoHorizontalOverflow(page, `${what}（${width}px）`);
    for (const scheme of SCHEMES) {
      await page.emulateMedia({ colorScheme: scheme });
      await expectAccessible(page, `${what}（${width}px，${scheme}）`);
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.emulateMedia({ colorScheme: "light" });
}

/** 本地日期 YYYY-MM-DD，从今天往后 `days` 天。 */
function localDay(days: number): string {
  const at = new Date();
  at.setDate(at.getDate() + days);
  return `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, "0")}-${String(at.getDate()).padStart(2, "0")}`;
}

/** 新开一个浏览器会话打开链接：直接显示「已失效」，没有表单。 */
async function expectDeadOnOpen(browser: Browser, path: string, title: string): Promise<void> {
  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL ?? "" });
  const page = await context.newPage();
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(page.getByLabel("新密码")).toHaveCount(0);
  await context.close();
}

test("用过、被重新邀请作废、过了重置的链接：平台和供应商两边一打开就提示失效，不显示表单；还能用的照常显示表单（核对不会把它用掉）", async ({ page, browser, request }) => {
  test.setTimeout(120_000);
  const headers = await platformAdminHeaders(request);

  // 供应商：用过的邀请
  const used = await createActiveTenant(request);
  await expectDeadOnOpen(browser, `/accept-invite#token=${used.inviteToken}`, "邀请链接已失效");

  // 供应商：重新邀请后，旧的邀请作废
  const pending = await createTenant(request);
  const again = await request.post(`/platform/v1/tenants/${pending.tenantId}/admin-invites`, { headers, data: { email: pending.adminEmail, name: pending.adminName } });
  expect(again.ok(), await again.text()).toBe(true);
  await expectDeadOnOpen(browser, `/accept-invite#token=${pending.inviteToken}`, "邀请链接已失效");

  // 供应商：重置链接用过一次后失效；再发一次，上一条作废
  const first = await issueTenantAdminReset(request, used.tenantId, used.adminEmail);
  const second = await issueTenantAdminReset(request, used.tenantId, used.adminEmail);
  await expectDeadOnOpen(browser, `/reset-password#token=${first}`, "重置链接已失效");
  expect((await request.post("/tenant/v1/auth/reset-password", { data: { token: second, password: newPassword() } })).ok()).toBe(true);
  await expectDeadOnOpen(browser, `/reset-password#token=${second}`, "重置链接已失效");

  // 平台：用过的邀请、用过的重置
  const email = uniqueEmail("m113-staff");
  const staff = await request.post("/platform/v1/staff", { headers, data: { email, name: "M1-13 端到端测试员工", role: "readonly" } });
  expect(staff.status(), await staff.text()).toBe(201);
  const staffBody = (await staff.json()) as { user: { id: string }; invite: { token: string } };
  expect((await request.post("/platform/v1/auth/accept-invite", { data: { token: staffBody.invite.token, password: newPassword() } })).ok()).toBe(true);
  await expectDeadOnOpen(browser, `/platform/accept-invite#token=${staffBody.invite.token}`, "邀请链接已失效");
  const reset = await request.post(`/platform/v1/staff/${staffBody.user.id}/password-reset`, { headers });
  const resetToken = ((await reset.json()) as { reset: { token: string } }).reset.token;
  expect((await request.post("/platform/v1/auth/reset-password", { data: { token: resetToken, password: newPassword() } })).ok()).toBe(true);
  await expectDeadOnOpen(browser, `/platform/reset-password#token=${resetToken}`, "重置链接已失效");

  // 失效的样子：320px 不横向滚动，亮暗两色 axe
  await page.goto(`/platform/accept-invite#token=${staffBody.invite.token}`);
  await expect(page.getByRole("heading", { level: 1, name: "邀请链接已失效" })).toBeVisible();
  await checkPage(page, "打开就失效的邀请链接");

  // 还能用的链接：打开先核对，表单照常出来；打开两次后仍能设密码
  const fresh = await createTenant(request);
  for (let round = 0; round < 2; round += 1) {
    await page.goto(`/accept-invite#token=${fresh.inviteToken}`);
    await expect(page.getByRole("button", { name: "设置密码并继续" })).toBeVisible();
  }
  const password = newPassword();
  await page.getByLabel("新密码").fill(password);
  await page.getByLabel("再输入一次").fill(password);
  await page.getByRole("button", { name: "设置密码并继续" }).click();
  await expect(page.getByRole("status").filter({ hasText: "密码已设置，请登录。" })).toBeVisible();
});

test("供应商详情的复制按钮紧跟在编号右边（桌面和 320px）；手机上列表卡片的两个日期写明「创建时间」「最近修改」", async ({ page, request }) => {
  test.setTimeout(120_000);
  const tenant = await createTenant(request);
  const admin = adminCredentials();
  await loginAs(page, "platform", admin.email, admin.password);

  await page.goto(`/platform/tenants/${tenant.tenantId}`);
  const code = page.locator(".tenant-id .product-code");
  await expect(code).toHaveText(tenant.tenantId);
  const copy = page.getByRole("button", { name: "复制供应商编号" });
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 800 });
    const [idBox, buttonBox, holderBox, createdBox] = await Promise.all([code.boundingBox(), copy.boundingBox(), page.locator(".tenant-id").boundingBox(), page.locator(".details > div").filter({ hasText: "创建时间" }).boundingBox()]);
    if (!idBox || !buttonBox || !holderBox || !createdBox) throw new Error("没量到位置");
    expect(buttonBox.x, `${width}px：按钮在编号右边`).toBeGreaterThanOrEqual(idBox.x + idBox.width - 1);
    expect(buttonBox.x - (idBox.x + idBox.width), `${width}px：按钮紧挨编号`).toBeLessThan(16);
    expect(buttonBox.x + buttonBox.width, `${width}px：按钮没有跑出编号这一格`).toBeLessThanOrEqual(holderBox.x + holderBox.width + 1);
    expect(buttonBox.y + buttonBox.height / 2, `${width}px：按钮和编号在同一高度`).toBeGreaterThanOrEqual(idBox.y - 1);
    expect(buttonBox.y + buttonBox.height / 2).toBeLessThanOrEqual(idBox.y + idBox.height + 1);
    expect(buttonBox.y + buttonBox.height, `${width}px：按钮不落到「创建时间」那一项里`).toBeLessThanOrEqual(createdBox.y + 1);
  }
  await checkPage(page, "供应商详情");

  await page.goto("/platform/tenants");
  const row = page.getByRole("row").filter({ has: page.getByRole("link", { name: tenant.tenantName, exact: true }) });
  await page.setViewportSize({ width: 320, height: 800 });
  await expect(row.getByText("创建时间：")).toBeVisible();
  await expect(row.getByText("最近修改：")).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(row.getByText("创建时间：")).toBeHidden();
  await expect(page.getByRole("columnheader", { name: "创建时间" })).toBeVisible();
  await checkPage(page, "供应商列表");
});

test("审计日志：「从」填了不存在的日期时在输入框下说明，不悄悄忽略；「从」晚于「到」时说日期填反了、不去查，点「对调两个日期」后正常", async ({ page }) => {
  test.setTimeout(120_000);
  const admin = adminCredentials();
  await loginAs(page, "platform", admin.email, admin.password);
  await page.goto("/platform/settings/audit-logs");
  const region = page.getByRole("region", { name: "审计日志" });
  await expect(region.locator("tbody tr").first()).toBeVisible();

  const from = page.locator("#audit-from");
  await from.fill(`${new Date().getFullYear()}-13-40`);
  await from.press("Enter");
  await expect(page.getByText("这不是一个日期，请按 2026-10-08 的格式填写")).toBeVisible();
  await expect(from).toHaveAttribute("aria-invalid", "true");
  expect(new URL(page.url()).searchParams.get("from")).toBeNull();
  await checkPage(page, "审计日志（日期不对）");

  const later = localDay(0);
  const earlier = localDay(-7);
  const audits: string[] = [];
  page.on("request", (sent) => {
    if (new URL(sent.url()).pathname === "/platform/v1/audit-logs") audits.push(sent.url());
  });
  await page.goto(`/platform/settings/audit-logs?from=${later}&to=${earlier}`);
  await expect(page.getByText("日期填反了")).toBeVisible();
  await expect(page.locator("#audit-to")).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText("结束日期不能早于开始日期，请改一下「从」或「到」")).toBeVisible();
  expect(audits, "填反了不去查").toEqual([]);
  await checkPage(page, "审计日志（日期填反）");

  await page.getByRole("button", { name: "对调两个日期" }).click();
  await expect(region.locator("tbody tr").first()).toBeVisible();
  await expect(page.getByText("日期填反了")).toHaveCount(0);
  const url = new URL(page.url());
  expect([url.searchParams.get("from"), url.searchParams.get("to")]).toEqual([earlier, later]);
  expect(audits.length).toBeGreaterThan(0);
});

test("运营后台看商品：基础信息里没有「要换，请新建一个商品」；只读的价格表方向显示成文字、没有灰掉的下拉框（亮暗两色 axe，含对比度）", async ({ page, request }) => {
  test.setTimeout(180_000);
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  const product = await createProductByApi(request, supplier, world, "airport_transfer");
  const { today } = (await (await request.get(`/tenant/v1/products/${product.id}/price-rules`, { headers: supplier.headers })).json()) as { today: string };
  const version = ((await (await request.get(`/tenant/v1/products/${product.id}`, { headers: supplier.headers })).json()) as { version: number }).version;
  const rule = (direction: string, ref: string, amount: number) => ({ ref, area_id: supplier.area.id, vehicle_group_id: world.group.id, direction, package_hours: null, pricing_model: "fixed", base_price: amount, start_price: null, start_meters: null, start_minutes: null, per_km: null, per_minute: null, min_price: null, package_km: null, package_price: null, overtime_per_hour: null, over_km_per_km: null, valid_from: today, valid_to: null, status: "enabled" });
  const prices = await request.post(`/tenant/v1/products/${product.id}/price-rules/batch`, {
    headers: { ...supplier.headers, "if-match": `"${version}"`, "idempotency-key": crypto.randomUUID() },
    data: { create: [rule("pickup", "a", 18000), rule("dropoff", "b", 16000)], update: [], delete: [] },
  });
  expect(prices.status(), await prices.text()).toBe(200);

  const admin = adminCredentials();
  await loginAs(page, "platform", admin.email, admin.password);
  await page.goto(`/platform/products/${product.id}`);
  await expect(page.getByRole("heading", { level: 2, name: "① 基础信息" })).toBeVisible();
  await expect(page.getByText("这几项是供应商创建商品时选定的，创建后不能修改。")).toBeVisible();
  await expect(page.getByText(/新建一个商品/)).toHaveCount(0);

  await page.goto(`/platform/products/${product.id}/prices`);
  const table = page.locator(".price-table");
  await expect(table.getByText("接机", { exact: true })).toBeVisible();
  await expect(table.getByText("送机", { exact: true })).toBeVisible();
  await expect(table.locator("select")).toHaveCount(0);
  await expect(table.locator("[disabled]")).toHaveCount(0);
  await checkPage(page, "运营后台的只读价格表");
});
