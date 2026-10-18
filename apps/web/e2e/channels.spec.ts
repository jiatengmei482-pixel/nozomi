/**
 * 渠道与加价规则、双人复核、API 密钥、正式询价（M2-04，ADR 0023），真实后端、真实 PostgreSQL。
 * 渠道经理甲在运营后台建渠道、加一条加价规则（提交复核，自己批不了）；渠道经理乙在「待审核」里批准，规则生效；
 * 甲发 API 密钥（只显示一次），渠道用它换令牌、询价：按新规则加价、应答里没有中标供应商和结算价；报价试算选这个渠道看到命中的规则。
 * 日期一律按城市当地的「今天」往后推。
 */
import { addDays } from "@nozomi/domain";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { CENTER, type Supplier, type World, choose, createProductByApi, createSupplier, createWorld, toast } from "./catalog.ts";
import { loginAs, newPassword, platformAdminHeaders, snapshot, uniqueEmail } from "./support.ts";

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
async function publishedProduct(request: APIRequestContext, supplier: Supplier, world: World, title: string, amount: number): Promise<{ id: string; today: string }> {
  const product = await createProductByApi(request, supplier, world, "airport_transfer");
  const rules = await request.put(`/tenant/v1/products/${product.id}/service-rules`, { headers: { ...supplier.headers, "if-match": `"${product.version}"` }, data: RULES });
  expect(rules.status(), await rules.text()).toBe(200);
  const content = await request.put(`/tenant/v1/products/${product.id}/content`, { headers: { ...supplier.headers, "if-match": `"${((await rules.json()) as { version: number }).version}"` }, data: { zh: { title, pickup_guide: "到达大厅 2 号出口" } } });
  expect(content.status(), await content.text()).toBe(200);
  const { today } = (await (await request.get(`/tenant/v1/products/${product.id}/price-rules`, { headers: supplier.headers })).json()) as { today: string };
  const price = await request.post(`/tenant/v1/products/${product.id}/price-rules/batch`, {
    headers: { ...supplier.headers, "if-match": `"${await version(request, supplier, product.id)}"`, "idempotency-key": crypto.randomUUID() },
    data: { create: [{ ref: "a", area_id: supplier.area.id, vehicle_group_id: world.group.id, direction: "both", package_hours: null, pricing_model: "fixed", base_price: amount, start_price: null, start_meters: null, start_minutes: null, per_km: null, per_minute: null, min_price: null, package_km: null, package_price: null, overtime_per_hour: null, over_km_per_km: null, valid_from: today, valid_to: null, status: "enabled" }], update: [], delete: [] },
  });
  expect(price.status(), await price.text()).toBe(200);
  const published = await request.post(`/tenant/v1/products/${product.id}/publish`, { headers: supplier.headers });
  expect(published.status(), await published.text()).toBe(200);
  return { id: product.id, today };
}

async function createStaff(request: APIRequestContext, role: string, name: string): Promise<{ email: string; password: string }> {
  const headers = await platformAdminHeaders(request);
  const email = uniqueEmail(`m204-${role}`);
  const created = await request.post("/platform/v1/staff", { headers, data: { email, name, role } });
  expect(created.status(), await created.text()).toBe(201);
  const password = newPassword();
  const accepted = await request.post("/platform/v1/auth/accept-invite", { data: { token: ((await created.json()) as { invite: { token: string } }).invite.token, password } });
  expect(accepted.ok(), "接受邀请").toBe(true);
  return { email, password };
}

const menu = (page: Page) => page.getByRole("navigation", { name: "主菜单" }).first();

test("渠道经理甲建渠道、加加价规则（自己批不了）→ 渠道经理乙批准生效 → 发 API 密钥 → 渠道询价按新规则加价、看不到中标供应商 → 试算选渠道看到命中的规则", async ({ page, browser, request }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  const world = await createWorld(request);
  const supplierA = await createSupplier(request, world);
  const supplierB = await createSupplier(request, world);
  const productA = await publishedProduct(request, supplierA, world, "渠道测试 A 家", 20000);
  await publishedProduct(request, supplierB, world, "渠道测试 B 家", 21000);
  const tomorrow = addDays(productA.today, 1);
  const managerA = await createStaff(request, "channel_manager", "渠道经理甲");
  const managerB = await createStaff(request, "channel_manager", "渠道经理乙");
  const channelName = `官网 ${crypto.randomUUID().slice(0, 6)}`;

  // 甲：新建渠道
  await loginAs(page, "platform", managerA.email, managerA.password);
  await expect(menu(page).getByRole("link", { name: "待审核" })).toBeVisible();
  await menu(page).getByRole("link", { name: "渠道" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "渠道" })).toBeVisible();
  await page.getByRole("link", { name: /新建渠道/ }).first().click();
  await page.getByRole("textbox", { name: "名称" }).fill(channelName);
  await page.getByRole("radio", { name: /^自营/ }).check();
  await page.getByRole("button", { name: "新建", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: channelName })).toBeVisible();
  await expect(page.locator(".page__meta")).toContainText("测试");
  const channelId = /\/platform\/channels\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? "";
  expect(channelId).not.toBe("");

  // 甲：给 A 家加一条 15% 的规则（第 2 级），提交复核
  await page.getByRole("button", { name: /新增加价规则/ }).click();
  const ruleDialog = page.getByRole("dialog", { name: "新增加价规则" });
  await ruleDialog.getByRole("radio", { name: /第 2 级/ }).check();
  await ruleDialog.getByRole("combobox", { name: "供应商" }).selectOption({ label: supplierA.tenant.tenantName });
  await ruleDialog.getByRole("textbox", { name: "加价比例（%）" }).fill("8");
  await ruleDialog.getByRole("button", { name: "提交审核" }).click();
  await expect(ruleDialog.getByText("不能低于这个渠道的加价下限 10%", { exact: true })).toBeVisible();
  await ruleDialog.getByRole("textbox", { name: "加价比例（%）" }).fill("15");
  await ruleDialog.getByRole("button", { name: "提交审核" }).click();
  await expect(toast(page, "已提交审核")).toBeVisible();
  await expect(page.getByText("还没有加价规则：全部按默认加价比例。")).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /复核记录（1 条待审核）/ })).toBeVisible();

  // 甲在待审核里：只能撤回，批不了
  await menu(page).getByRole("link", { name: "待审核" }).click();
  const mine = page.locator(".approval-card").filter({ hasText: channelName });
  await expect(mine).toContainText("新增加价规则");
  await expect(mine.getByRole("button", { name: "批准" })).toHaveCount(0);
  await expect(mine.getByRole("button", { name: "撤回" })).toBeVisible();
  await expect(mine).toContainText("要等另一位有审核权限的同事处理");

  // 乙：批准
  const other = await browser.newPage();
  await other.setViewportSize({ width: 1280, height: 900 });
  await loginAs(other, "platform", managerB.email, managerB.password);
  await other.goto("/platform/approvals");
  const card = other.locator(".approval-card").filter({ hasText: channelName });
  await expect(card).toContainText("15%");
  await snapshot(other, "platform-approvals");
  await card.getByRole("button", { name: "批准" }).click();
  const decide = other.getByRole("dialog", { name: /^批准/ });
  await decide.getByRole("textbox", { name: "说明（选填）" }).fill("同意");
  await decide.getByRole("button", { name: "批准" }).click();
  await expect(toast(other, "已批准，改动已生效")).toBeVisible();
  await other.close();

  // 甲：规则生效；发 API 密钥（只显示一次）
  await page.goto(`/platform/channels/${channelId}`);
  const rules = page.locator('[aria-label="加价规则"]');
  await expect(rules).toContainText(supplierA.tenant.tenantName);
  await expect(rules).toContainText("15%");
  await page.getByRole("button", { name: /新建 API 客户端/ }).click();
  const clientDialog = page.getByRole("dialog", { name: "新建 API 客户端" });
  await clientDialog.getByRole("textbox", { name: "名称" }).fill("官网正式环境");
  await clientDialog.getByRole("button", { name: "新建并显示密钥" }).click();
  const secretDialog = page.getByRole("dialog", { name: "API 密钥（只显示这一次）" });
  const secret = await secretDialog.getByRole("textbox", { name: "client_secret" }).inputValue();
  const clientId = (await secretDialog.locator(".product-code").first().textContent()) ?? "";
  expect(secret).toMatch(/^nzs_/);
  await secretDialog.getByRole("button", { name: "我已保存好，关闭" }).click();
  await secretDialog.getByRole("button", { name: "不复制，关闭" }).click();
  await expect(secretDialog).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(secret);
  await expect(page.getByRole("region", { name: "API 客户端", exact: true })).toContainText(`••••${secret.slice(-4)}`);
  await snapshot(page, "platform-channel-detail");

  // 渠道：换令牌、询价。A 家 20,000 × 1.15 = 23,000，B 家 21,000 × 1.10 = 23,100 → A 家中标、客人付 23,000
  const token = await request.post("/sales/v1/oauth/token", { data: { grant_type: "client_credentials", client_id: clientId, client_secret: secret } });
  expect(token.status(), await token.text()).toBe(200);
  const auth = { authorization: `Bearer ${((await token.json()) as { access_token: string }).access_token}` };
  const quoted = await request.post("/sales/v1/quotes", { headers: auth, data: { city_id: world.city.id, category: "airport_transfer", place_id: world.airport.id, direction: "pickup", dropoff: CENTER, service_time: `${tomorrow}T10:00:00+09:00`, passengers: 2, currency: "JPY" } });
  expect(quoted.status(), await quoted.text()).toBe(200);
  const body = (await quoted.json()) as { quotes: { quote_id: string; price: { total: { amount: string } } }[] };
  expect(body.quotes.map((quote) => quote.price.total.amount)).toEqual(["23000"]);
  const text = JSON.stringify(body);
  for (const hidden of [supplierA.tenant.tenantName, supplierB.tenant.tenantName, supplierA.tenant.tenantId, "20000", "markup", "settlement"]) expect(text, `应答里不能有 ${hidden}`).not.toContain(hidden);
  expect((await request.get(`/sales/v1/quotes/${body.quotes[0]?.quote_id}`, { headers: auth })).status()).toBe(200);
  await page.reload();
  await expect(page.getByRole("region", { name: "最近的询价", exact: true })).toBeVisible();

  // 报价试算：选这个渠道，A 家命中第 2 级、B 家用渠道默认
  await menu(page).getByRole("link", { name: "报价试算" }).click();
  await choose(page, /城市/, world.city.code);
  await page.getByRole("radio", { name: "接送机" }).check();
  await choose(page, /机场或车站/, world.airport.code);
  await page.getByRole("radio", { name: /^接机/ }).check();
  const dropoff = page.getByRole("group", { name: "下车点" });
  await dropoff.getByRole("textbox", { name: /纬度/ }).fill(String(CENTER.lat));
  await dropoff.getByRole("textbox", { name: /经度/ }).fill(String(CENTER.lng));
  await page.getByRole("textbox", { name: "日期" }).fill(tomorrow);
  await page.getByRole("textbox", { name: "时刻" }).fill("10:00");
  await page.getByRole("textbox", { name: "人数" }).fill("2");
  await page.getByRole("combobox", { name: "客人支付的币种" }).selectOption("JPY");
  await page.getByRole("combobox", { name: /按哪个渠道的规则/ }).selectOption({ label: channelName });
  await page.getByRole("button", { name: "试算", exact: true }).click();
  await expect(page.getByText(`按渠道「${channelName}」的规则试算`, { exact: false })).toBeVisible();
  const group = page.locator(".quote-group").filter({ has: page.getByRole("heading", { level: 3, name: world.group.name }) });
  await expect(group).toContainText(`中标：${supplierA.tenant.tenantName}`);
  const rows = group.locator("tbody tr:not(.quote-table__detail)");
  await expect(rows.nth(0)).toContainText("第 2 级");
  await expect(rows.nth(1)).toContainText("第 5 级（默认）");
});

test("只读角色：看得到渠道和待审核，没有任何修改和审核的按钮；主数据运营看不到渠道", async ({ page, request }) => {
  test.setTimeout(90_000);
  const headers = await platformAdminHeaders(request);
  const created = await request.post("/platform/v1/channels", { headers, data: { name: `只读看 ${crypto.randomUUID().slice(0, 6)}`, type: "api", settle_currency: "JPY" } });
  expect(created.status(), await created.text()).toBe(201);
  const channel = ((await created.json()) as { channel: { id: string; name: string } }).channel;
  const viewer = await createStaff(request, "readonly", "只读同事");
  await loginAs(page, "platform", viewer.email, viewer.password);
  await page.goto(`/platform/channels/${channel.id}`);
  await expect(page.getByRole("heading", { level: 1, name: channel.name })).toBeVisible();
  await expect(page.getByText("你可以查看这个渠道，但不能修改。")).toBeVisible();
  for (const name of [/新增加价规则/, "申请修改定价参数", /新建 API 客户端/, "申请暂停", "启用"]) await expect(page.getByRole("button", { name })).toHaveCount(0);
  await menu(page).getByRole("link", { name: "待审核" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "待审核" })).toBeVisible();
  await expect(page.getByRole("button", { name: "批准" })).toHaveCount(0);

  const masterData = await createStaff(request, "master_data", "主数据同事");
  await page.getByRole("button", { name: /账号菜单/ }).click();
  await page.getByRole("menuitem", { name: "退出登录" }).click();
  await loginAs(page, "platform", masterData.email, masterData.password);
  await expect(menu(page).getByRole("link", { name: "渠道" })).toHaveCount(0);
  await page.goto("/platform/channels");
  await expect(page.getByText("你没有权限查看这里")).toBeVisible();
});
