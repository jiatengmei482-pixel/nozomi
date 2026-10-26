/**
 * M3-07 测试角色补充：毛利试算在 320px 宽的手机上、亮色和暗色下都能用（无障碍检查、没有横向溢出），真实后端、真实 PostgreSQL。
 * 两家供应商（A 20,000、B 21,000）、一个渠道（默认加价 10%），渠道经 API 询价一次。
 * 渠道经理甲在 320px 下新增「A 家 20%」的规则、试算、提交；渠道经理乙在 320px 下的待审核里看到发起时的结果并再算一次。
 * 日期一律按城市当地的「今天」往后推。
 */
import { addDays } from "@nozomi/domain";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { CENTER, type Supplier, type World, createProductByApi, createSupplier, createWorld, expectAccessible, toast } from "./catalog.ts";
import { expectNoHorizontalOverflow, loginAs, newPassword, platformAdminHeaders, uniqueEmail } from "./support.ts";

const RULES = {
  booking: { sale_from: null, sale_to: null, service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 0, note: null },
  urgent: { enabled: false, daily_quota: null, tiers: [] },
  night: { enabled: false, window: null, amount: null, charge_unit: null },
  free_wait: { pickup: { mode: "limited", minutes: 60 }, dropoff: { mode: "limited", minutes: 60 }, general: null },
  addons: [],
  driver_languages: [],
};
const PHONE = { width: 320, height: 720 };

async function version(request: APIRequestContext, supplier: Supplier, id: string): Promise<number> {
  return ((await (await request.get(`/tenant/v1/products/${id}`, { headers: supplier.headers })).json()) as { version: number }).version;
}

async function publishedProduct(request: APIRequestContext, supplier: Supplier, world: World, amount: number): Promise<{ today: string }> {
  const product = await createProductByApi(request, supplier, world, "airport_transfer");
  const rules = await request.put(`/tenant/v1/products/${product.id}/service-rules`, { headers: { ...supplier.headers, "if-match": `"${product.version}"` }, data: RULES });
  expect(rules.status(), await rules.text()).toBe(200);
  const content = await request.put(`/tenant/v1/products/${product.id}/content`, { headers: { ...supplier.headers, "if-match": `"${((await rules.json()) as { version: number }).version}"` }, data: { zh: { title: `试算 ${amount}`, pickup_guide: "到达大厅 2 号出口" } } });
  expect(content.status(), await content.text()).toBe(200);
  const { today } = (await (await request.get(`/tenant/v1/products/${product.id}/price-rules`, { headers: supplier.headers })).json()) as { today: string };
  const price = await request.post(`/tenant/v1/products/${product.id}/price-rules/batch`, {
    headers: { ...supplier.headers, "if-match": `"${await version(request, supplier, product.id)}"`, "idempotency-key": crypto.randomUUID() },
    data: { create: [{ ref: "a", area_id: supplier.area.id, vehicle_group_id: world.group.id, direction: "both", package_hours: null, pricing_model: "fixed", base_price: amount, start_price: null, start_meters: null, start_minutes: null, per_km: null, per_minute: null, min_price: null, package_km: null, package_price: null, overtime_per_hour: null, over_km_per_km: null, valid_from: today, valid_to: null, status: "enabled" }], update: [], delete: [] },
  });
  expect(price.status(), await price.text()).toBe(200);
  const published = await request.post(`/tenant/v1/products/${product.id}/publish`, { headers: supplier.headers });
  expect(published.status(), await published.text()).toBe(200);
  return { today };
}

async function createStaff(request: APIRequestContext, name: string): Promise<{ email: string; password: string }> {
  const headers = await platformAdminHeaders(request);
  const email = uniqueEmail("m307qa-cm");
  const created = await request.post("/platform/v1/staff", { headers, data: { email, name, role: "channel_manager" } });
  expect(created.status(), await created.text()).toBe(201);
  const password = newPassword();
  const accepted = await request.post("/platform/v1/auth/accept-invite", { data: { token: ((await created.json()) as { invite: { token: string } }).invite.token, password } });
  expect(accepted.ok(), "接受邀请").toBe(true);
  return { email, password };
}

async function salesAuth(request: APIRequestContext, channelId: string): Promise<Record<string, string>> {
  const headers = await platformAdminHeaders(request);
  const issued = await request.post(`/platform/v1/channels/${channelId}/api-clients`, { headers, data: { name: "官网" } });
  expect(issued.status(), await issued.text()).toBe(201);
  const { api_client, client_secret } = (await issued.json()) as { api_client: { client_id: string }; client_secret: string };
  const token = await request.post("/sales/v1/oauth/token", { data: { grant_type: "client_credentials", client_id: api_client.client_id, client_secret } });
  expect(token.status(), await token.text()).toBe(200);
  return { authorization: `Bearer ${((await token.json()) as { access_token: string }).access_token}` };
}

/** 亮色、暗色各查一遍：无障碍、没有横向溢出 */
async function bothSchemes(page: Page, what: string): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `${what}（${scheme}，320px）`);
    await expectNoHorizontalOverflow(page, `${what}（${scheme}）`);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

test("320px 宽的手机上，亮色和暗色：规则对话框里的试算结果和待审核里发起时的 / 再算的结果都能用，写明是估算", async ({ page, browser, request }) => {
  test.setTimeout(240_000);
  await page.setViewportSize(PHONE);
  const world = await createWorld(request);
  const supplierA = await createSupplier(request, world);
  const supplierB = await createSupplier(request, world);
  const { today } = await publishedProduct(request, supplierA, world, 20000);
  await publishedProduct(request, supplierB, world, 21000);
  const managerA = await createStaff(request, "渠道经理甲");
  const managerB = await createStaff(request, "渠道经理乙");
  const channelName = `试算手机 ${crypto.randomUUID().slice(0, 6)}`;
  const created = await request.post("/platform/v1/channels", { headers: await platformAdminHeaders(request), data: { name: channelName, type: "own", settle_currency: "JPY", scope: { tenant_scope: "allow", tenant_ids: [supplierA.tenant.tenantId, supplierB.tenant.tenantId] } } });
  expect(created.status(), await created.text()).toBe(201);
  const channelId = ((await created.json()) as { channel: { id: string } }).channel.id;
  const auth = await salesAuth(request, channelId);
  const quoted = await request.post("/sales/v1/quotes", { headers: auth, data: { city_id: world.city.id, category: "airport_transfer", place_id: world.airport.id, direction: "pickup", dropoff: CENTER, service_time: `${addDays(today, 2)}T10:00:00+09:00`, passengers: 2, currency: "JPY" } });
  expect(quoted.status(), await quoted.text()).toBe(200);

  await loginAs(page, "platform", managerA.email, managerA.password);
  await page.goto(`/platform/channels/${channelId}`);
  await expect(page.getByRole("heading", { level: 1, name: channelName })).toBeVisible();
  await page.getByRole("button", { name: /新增加价规则/ }).click();
  const dialog = page.getByRole("dialog", { name: "新增加价规则" });
  await dialog.getByRole("radio", { name: /第 2 级/ }).check();
  await dialog.getByRole("combobox", { name: "供应商" }).selectOption({ label: supplierA.tenant.tenantName });
  await dialog.getByRole("textbox", { name: "加价比例（%）" }).fill("20");
  await dialog.getByRole("button", { name: "试算近 30 天毛利影响" }).click();
  const preview = dialog.getByRole("region", { name: "近 30 天毛利试算", exact: true });
  await expect(preview).toBeVisible();
  // A 22,000 → 24,000 > B 23,100：换成 B，毛利 2,000 → 2,100
  await expect(preview.getByRole("region", { name: "询价（每个车型组一个报价）", exact: true }).getByRole("row", { name: /毛利/ })).toContainText("+JPY 100");
  await expect(preview.getByText("中标会换人：1 个")).toBeVisible();
  await expect(preview.getByText(/这是估算/)).toBeVisible();
  // 表格在窄屏下自己横向滚动、能用键盘聚焦，页面本身不溢出
  await bothSchemes(page, "规则对话框里的试算结果");
  await dialog.getByRole("button", { name: "提交审核" }).click();
  await expect(toast(page, "已提交审核")).toBeVisible();

  const context = await browser.newContext({ viewport: PHONE });
  const other = await context.newPage();
  await loginAs(other, "platform", managerB.email, managerB.password);
  await other.goto("/platform/approvals");
  const card = other.locator(".approval-card").filter({ hasText: channelName });
  const stored = card.getByRole("region", { name: "发起时的毛利试算（近 30 天）", exact: true });
  await expect(stored.getByText("中标会换人：1 个")).toBeVisible();
  await card.getByRole("button", { name: /按现在的数据再算一次/ }).click();
  const fresh = card.getByRole("region", { name: "按现在的数据再算的结果", exact: true });
  await expect(fresh.getByText("询价（每个车型组一个报价）：1 个")).toBeVisible();
  await expect(fresh.getByText(/这是估算/)).toBeVisible();
  await bothSchemes(other, "待审核里的试算结果");
  await context.close();
});
