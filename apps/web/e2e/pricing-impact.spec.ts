/**
 * 加价规则生效前的毛利试算（M3-07，ADR 0033），真实后端、真实 PostgreSQL。
 * 两家供应商（A 20,000、B 21,000）、一个渠道（默认加价 10%）；渠道经 API 询价两次（A 22,000 中标）。
 * 渠道经理甲发起「A 家 20%」：对话框里试算——A 24,000 > B 23,100，两次询价的中标都换成 B，毛利每个多 100；
 * 提交后渠道经理乙在「待审核」里看到发起时的同样结果，再询价一次后「按现在的数据再算一次」，询价变成 3 个。
 * 日期一律按城市当地的「今天」往后推。
 */
import { addDays } from "@nozomi/domain";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { CENTER, type Supplier, type World, createProductByApi, createSupplier, createWorld, expectAccessible, toast } from "./catalog.ts";
import { loginAs, newPassword, platformAdminHeaders, uniqueEmail } from "./support.ts";

const RULES = {
  booking: { sale_from: null, sale_to: null, service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 0, note: null },
  urgent: { enabled: false, daily_quota: null, tiers: [] },
  night: { enabled: false, window: null, amount: null, charge_unit: null },
  free_wait: { pickup: { mode: "limited", minutes: 60 }, dropoff: { mode: "limited", minutes: 60 }, general: null },
  addons: [],
  driver_languages: [],
};

async function version(request: APIRequestContext, supplier: Supplier, id: string): Promise<number> {
  return ((await (await request.get(`/tenant/v1/products/${id}`, { headers: supplier.headers })).json()) as { version: number }).version;
}

/** 经供应商接口配好、上架的接送机商品（一口价，从城市当地的今天起生效）。 */
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

async function createStaff(request: APIRequestContext, role: string, name: string): Promise<{ email: string; password: string }> {
  const headers = await platformAdminHeaders(request);
  const email = uniqueEmail(`m307-${role}`);
  const created = await request.post("/platform/v1/staff", { headers, data: { email, name, role } });
  expect(created.status(), await created.text()).toBe(201);
  const password = newPassword();
  const accepted = await request.post("/platform/v1/auth/accept-invite", { data: { token: ((await created.json()) as { invite: { token: string } }).invite.token, password } });
  expect(accepted.ok(), "接受邀请").toBe(true);
  return { email, password };
}

/** 发一个 API 客户端、换令牌，返回询价用的请求头。 */
async function salesAuth(request: APIRequestContext, channelId: string): Promise<Record<string, string>> {
  const headers = await platformAdminHeaders(request);
  const issued = await request.post(`/platform/v1/channels/${channelId}/api-clients`, { headers, data: { name: "官网" } });
  expect(issued.status(), await issued.text()).toBe(201);
  const { api_client, client_secret } = (await issued.json()) as { api_client: { client_id: string }; client_secret: string };
  const token = await request.post("/sales/v1/oauth/token", { data: { grant_type: "client_credentials", client_id: api_client.client_id, client_secret } });
  expect(token.status(), await token.text()).toBe(200);
  return { authorization: `Bearer ${((await token.json()) as { access_token: string }).access_token}` };
}

async function quoteOnce(request: APIRequestContext, auth: Record<string, string>, world: World, day: string): Promise<void> {
  const quoted = await request.post("/sales/v1/quotes", { headers: auth, data: { city_id: world.city.id, category: "airport_transfer", place_id: world.airport.id, direction: "pickup", dropoff: CENTER, service_time: `${day}T10:00:00+09:00`, passengers: 2, currency: "JPY" } });
  expect(quoted.status(), await quoted.text()).toBe(200);
  expect(((await quoted.json()) as { quotes: unknown[] }).quotes).toHaveLength(1);
}

const impactRegion = (scope: Page | ReturnType<Page["locator"]>, name: string) => scope.getByRole("region", { name, exact: true });

test("渠道经理甲在新增规则的对话框里试算近 30 天毛利（中标换人、差额），提交后渠道经理乙在待审核里看到同样的结果，并能按现在的数据再算一次", async ({ page, browser, request }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const world = await createWorld(request);
  const supplierA = await createSupplier(request, world);
  const supplierB = await createSupplier(request, world);
  const { today } = await publishedProduct(request, supplierA, world, 20000);
  await publishedProduct(request, supplierB, world, 21000);
  const day = addDays(today, 2);
  const managerA = await createStaff(request, "channel_manager", "渠道经理甲");
  const managerB = await createStaff(request, "channel_manager", "渠道经理乙");
  const channelName = `试算渠道 ${crypto.randomUUID().slice(0, 6)}`;
  const created = await request.post("/platform/v1/channels", { headers: await platformAdminHeaders(request), data: { name: channelName, type: "own", settle_currency: "JPY", scope: { tenant_scope: "allow", tenant_ids: [supplierA.tenant.tenantId, supplierB.tenant.tenantId] } } });
  expect(created.status(), await created.text()).toBe(201);
  const channelId = ((await created.json()) as { channel: { id: string } }).channel.id;
  const auth = await salesAuth(request, channelId);
  await quoteOnce(request, auth, world, day);
  await quoteOnce(request, auth, world, addDays(day, 1));

  // 甲：新增「A 家 20%」，提交前试算
  await loginAs(page, "platform", managerA.email, managerA.password);
  await page.goto(`/platform/channels/${channelId}`);
  await expect(page.getByRole("heading", { level: 1, name: channelName })).toBeVisible();
  await page.getByRole("button", { name: /新增加价规则/ }).click();
  const dialog = page.getByRole("dialog", { name: "新增加价规则" });
  await dialog.getByRole("radio", { name: /第 2 级/ }).check();
  await dialog.getByRole("combobox", { name: "供应商" }).selectOption({ label: supplierA.tenant.tenantName });
  await dialog.getByRole("textbox", { name: "加价比例（%）" }).fill("20");
  await dialog.getByRole("button", { name: "试算近 30 天毛利影响" }).click();
  const preview = impactRegion(dialog, "近 30 天毛利试算");
  await expect(preview).toBeVisible();
  // 两次询价：改前 A 22,000 / 20,000，改后 B 23,100 / 21,000——对外价 +1,100、结算价 +1,000、毛利 +100（每个）
  const quotes = impactRegion(preview, "询价（每个车型组一个报价）");
  await expect(quotes.getByText("询价（每个车型组一个报价）：2 个")).toBeVisible();
  await expect(quotes.getByRole("row", { name: /毛利/ })).toContainText("+JPY 200");
  await expect(quotes.getByRole("row", { name: /对外价合计/ })).toContainText("+JPY 2,200");
  await expect(preview.getByText("中标会换人：2 个")).toBeVisible();
  await expect(preview.getByText(/这是估算/)).toBeVisible();
  await expectAccessible(page, "规则对话框里的试算结果");
  // 改了比例：旧结果作废
  await dialog.getByRole("textbox", { name: "加价比例（%）" }).fill("21");
  await expect(preview).toHaveCount(0);
  await expect(dialog.getByText("内容改过了，上次的结果不再适用，请重新试算。")).toBeVisible();
  await dialog.getByRole("textbox", { name: "加价比例（%）" }).fill("20");
  await dialog.getByRole("button", { name: "重新试算" }).click();
  await expect(impactRegion(dialog, "近 30 天毛利试算")).toBeVisible();
  await dialog.getByRole("button", { name: "提交审核" }).click();
  await expect(toast(page, "已提交审核")).toBeVisible();

  // 乙：待审核里看到发起时的试算；再询价一次后按现在的数据再算
  await quoteOnce(request, auth, world, addDays(day, 2));
  const context = await browser.newContext();
  const other = await context.newPage();
  await other.setViewportSize({ width: 1280, height: 900 });
  await loginAs(other, "platform", managerB.email, managerB.password);
  await other.goto("/platform/approvals");
  const card = other.locator(".approval-card").filter({ hasText: channelName });
  const stored = impactRegion(card, "发起时的毛利试算（近 30 天）");
  await expect(stored.getByText("询价（每个车型组一个报价）：2 个")).toBeVisible();
  await expect(stored.getByText("中标会换人：2 个")).toBeVisible();
  await card.getByRole("button", { name: /按现在的数据再算一次/ }).click();
  const fresh = impactRegion(card, "按现在的数据再算的结果");
  await expect(fresh.getByText("询价（每个车型组一个报价）：3 个")).toBeVisible();
  await expect(fresh.getByText("中标会换人：3 个")).toBeVisible();
  await expect(stored.getByText("询价（每个车型组一个报价）：2 个")).toBeVisible();
  await expectAccessible(other, "待审核里的试算结果");
  await context.close();
});
