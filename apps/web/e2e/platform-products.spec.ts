/**
 * 运营后台只读查看供应商的商品、报价试算（M1-12），真实后端、真实 PostgreSQL。
 * 两个供应商各自经供应商接口建好商品、设好价格、上架；运营人员在运营后台的列表、筛选、详情、供应商详情里看到它们，
 * 再用报价试算看谁中标、谁报不出价以及原因。日期一律按商品所在城市当地的「今天」往后推，不写死某月某日。
 */
import { addDays } from "@nozomi/domain";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { CENTER, type Supplier, type World, choose, createProductByApi, createSupplier, createWorld, expectAccessible } from "./catalog.ts";
import { expectNoHorizontalOverflow, fillLogin, loginAs, newPassword, platformAdminHeaders, adminCredentials, snapshot, uniqueEmail } from "./support.ts";
import { platformApiLogin } from "./mfa.ts";

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

/**
 * 一个经供应商接口配好、上了架的接送机商品：服务规则、标题、一口价（从城市当地的今天起生效）。
 * `leadTimeHours` 给大了，第二天的用车就因为不够提前预订时长报不出价。
 */
async function publishedProduct(request: APIRequestContext, supplier: Supplier, world: World, title: string, amount: number, leadTimeHours = 0): Promise<{ id: string; code: string; today: string }> {
  const product = await createProductByApi(request, supplier, world, "airport_transfer");
  const rules = await request.put(`/tenant/v1/products/${product.id}/service-rules`, { headers: { ...supplier.headers, "if-match": `"${product.version}"` }, data: { ...RULES, booking: { ...RULES.booking, lead_time_hours: leadTimeHours } } });
  expect(rules.status(), `保存服务规则：${await rules.text()}`).toBe(200);
  const content = await request.put(`/tenant/v1/products/${product.id}/content`, { headers: { ...supplier.headers, "if-match": `"${((await rules.json()) as { version: number }).version}"` }, data: { zh: { title, pickup_guide: "到达大厅 2 号出口" } } });
  expect(content.status(), `保存商品详情：${await content.text()}`).toBe(200);
  const { today } = (await (await request.get(`/tenant/v1/products/${product.id}/price-rules`, { headers: supplier.headers })).json()) as { today: string };
  const price = await request.post(`/tenant/v1/products/${product.id}/price-rules/batch`, {
    headers: { ...supplier.headers, "if-match": `"${await version(request, supplier, product.id)}"`, "idempotency-key": crypto.randomUUID() },
    data: { create: [{ ref: "a", area_id: supplier.area.id, vehicle_group_id: world.group.id, direction: "both", package_hours: null, pricing_model: "fixed", base_price: amount, start_price: null, start_meters: null, start_minutes: null, per_km: null, per_minute: null, min_price: null, package_km: null, package_price: null, overtime_per_hour: null, over_km_per_km: null, valid_from: today, valid_to: null, status: "enabled" }], update: [], delete: [] },
  });
  expect(price.status(), `设价格：${await price.text()}`).toBe(200);
  const published = await request.post(`/tenant/v1/products/${product.id}/publish`, { headers: supplier.headers });
  expect(published.status(), `上架：${await published.text()}`).toBe(200);
  return { id: product.id, code: product.code, today };
}

/** 新开一个平台员工账号（经接口邀请并设好密码）。 */
async function createStaff(request: APIRequestContext, role: string): Promise<{ email: string; password: string }> {
  const headers = await platformAdminHeaders(request);
  const email = uniqueEmail(`m112-${role}`);
  const created = await request.post("/platform/v1/staff", { headers, data: { email, name: `端到端测试${role}`, role } });
  expect(created.status(), await created.text()).toBe(201);
  const password = newPassword();
  const accepted = await request.post("/platform/v1/auth/accept-invite", { data: { token: ((await created.json()) as { invite: { token: string } }).invite.token, password } });
  expect(accepted.ok(), "接受邀请").toBe(true);
  return { email, password };
}

const menu = (page: Page) => page.getByRole("navigation", { name: "主菜单" }).first();
const rowOf = (page: Page, name: string) => page.getByRole("row").filter({ has: page.getByRole("link", { name, exact: true }) });

/** 试算表单：在这个城市的机场接机，下车点在区域中心，用车时间是城市当地的明天 10:00。 */
async function fillQuote(page: Page, world: World, tomorrow: string): Promise<void> {
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
}

test("两个供应商各上架一个商品 → 运营在列表看到两家、按城市和供应商筛、进详情只能看；从供应商详情进商品；试算得到中标结果和报不出价的原因", async ({ page, request }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const world = await createWorld(request);
  const supplierA = await createSupplier(request, world);
  const supplierB = await createSupplier(request, world);
  const supplierC = await createSupplier(request, world);
  const productA = await publishedProduct(request, supplierA, world, "羽田接送（A 家）", 20000);
  const productB = await publishedProduct(request, supplierB, world, "羽田接送（B 家）", 25000);
  // C 家要提前 3 天订：明天的用车报不出价
  const productC = await publishedProduct(request, supplierC, world, "羽田接送（C 家）", 18000, 72);
  const tomorrow = addDays(productA.today, 1);
  const staff = await createStaff(request, "operations");

  await loginAs(page, "platform", staff.email, staff.password);
  await expect(menu(page).getByRole("link", { name: "商品" })).toBeVisible();
  await expect(menu(page).getByRole("link", { name: "报价试算" })).toBeVisible();
  const card = page.locator(".entry-card").filter({ has: page.getByRole("link", { name: "商品", exact: true }) });
  await expect(card).toContainText("已上架");

  // 列表：按城市筛出这次建的三家
  await menu(page).getByRole("link", { name: "商品" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "商品" })).toBeVisible();
  await choose(page, /城市/, world.city.code);
  await expect(page).toHaveURL(new RegExp(`city=${world.city.id}`));
  await expect(rowOf(page, "羽田接送（A 家）")).toContainText(supplierA.tenant.tenantName);
  await expect(rowOf(page, "羽田接送（B 家）")).toContainText(supplierB.tenant.tenantName);
  const rowA = rowOf(page, "羽田接送（A 家）");
  for (const part of [productA.code, `${supplierA.brand.name}（JPY）`, world.city.name, `${world.airport.name}（${world.airport.code}）`, "接送机", "已上架", "有 1 条"]) await expect(rowA).toContainText(part);
  await expect(page.getByRole("navigation", { name: "分页" })).toContainText("共 3 条");
  await snapshot(page, "platform-products-list");

  // 再按供应商筛
  await choose(page, /供应商/, supplierB.tenant.tenantName);
  await expect(page).toHaveURL(new RegExp(`tenant=${supplierB.tenant.tenantId}`));
  await expect(rowOf(page, "羽田接送（B 家）")).toBeVisible();
  await expect(rowOf(page, "羽田接送（A 家）")).toHaveCount(0);
  // 「已上架却没有可用价格的」：这一家没有
  await page.getByRole("combobox", { name: "可用价格" }).selectOption("没有");
  await expect(page.getByText("没有符合条件的商品")).toBeVisible();
  await page.getByRole("button", { name: "清空筛选" }).first().click();
  await expect(page).toHaveURL(/\/platform\/products$/);

  // 详情：只读，每一步都看得到，没有修改的入口
  await page.goto(`/platform/products?city=${world.city.id}`);
  await page.getByRole("link", { name: "羽田接送（A 家）", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/platform/products/${productA.id}/basic$`));
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("羽田接送（A 家）");
  await expect(page.locator(".page__meta")).toContainText(`供应商 ${supplierA.tenant.tenantName}`);
  await expect(page.locator(".page__meta")).toContainText(/版本 \d+/);
  await expect(page.getByText("运营后台只能查看，不能修改", { exact: false })).toBeVisible();
  await expect(page.getByText("山田")).toBeVisible();
  await snapshot(page, "platform-product-detail");
  const steps = page.getByRole("navigation", { name: "配置步骤" });
  await steps.getByRole("link", { name: /价格规则/ }).click();
  await expect(page.getByRole("heading", { level: 2, name: "③ 价格规则" })).toBeVisible();
  await expect(page.getByLabel(`${supplierA.area.name} · ${world.group.name} · 接送通用 的基础价`, { exact: true })).toHaveValue("20,000");
  await expect(page.getByRole("link", { name: "价格日历" })).toHaveCount(0);
  await steps.getByRole("link", { name: /库存/ }).click();
  await expect(page.getByRole("heading", { level: 2, name: "④ 库存" })).toBeVisible();
  await expect(page.locator("main")).toContainText("库存模式不限量");
  await steps.getByRole("link", { name: /上架检查/ }).click();
  await expect(page.getByRole("heading", { level: 2, name: "上架检查" })).toBeVisible();
  await expect(page.locator('[data-check="price_rules"]')).toContainText("已满足");
  for (const name of ["保存", "保存草稿", "上架", "下架", "删除", "更多"]) await expect(page.getByRole("main").getByRole("button", { name, exact: true }), name).toHaveCount(0);
  await expect(page.getByRole("main").locator("input:not([readonly]):not([disabled]):not([type=radio]):not([type=checkbox]), textarea:not([readonly])")).toHaveCount(0);

  // 从供应商详情进商品；回到列表回到供应商详情
  await page.goto(`/platform/tenants/${supplierB.tenant.tenantId}`);
  const section = page.locator("section.tenant-products");
  await expect(section.getByRole("heading", { level: 2, name: "商品" })).toBeVisible();
  await snapshot(page, "platform-tenant-products");
  await section.getByRole("link", { name: "羽田接送（B 家）", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("羽田接送（B 家）");
  await page.getByRole("link", { name: "回到列表" }).click();
  await expect(page).toHaveURL(new RegExp(`/platform/tenants/${supplierB.tenant.tenantId}$`));

  // 报价试算：A 家便宜中标；C 家不够提前预订时长，报不出价
  await menu(page).getByRole("link", { name: "报价试算" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "报价试算" })).toBeVisible();
  await page.getByRole("button", { name: "试算", exact: true }).click();
  await expect(page.getByText("请选择城市", { exact: true })).toBeVisible();
  await fillQuote(page, world, tomorrow);
  await page.getByRole("button", { name: "试算", exact: true }).click();
  await expect(page.getByRole("heading", { level: 2, name: "试算结果" })).toBeFocused();
  const group = page.locator(".quote-group").filter({ has: page.getByRole("heading", { level: 3, name: world.group.name }) });
  await expect(group).toContainText(`中标：${supplierA.tenant.tenantName}（${productA.code}） · 对外价 JPY 22,000 · 结算价 JPY 20,000`);
  const rows = group.locator("tbody tr:not(.quote-table__detail)");
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText(supplierA.tenant.tenantName);
  await expect(rows.nth(1)).toContainText(supplierB.tenant.tenantName);
  await expect(rows.nth(1)).toContainText(productB.code);
  await expect(rows.nth(1)).toContainText("JPY 25,000");
  await group.getByRole("button", { name: `看 ${supplierB.tenant.tenantName} 的结算价明细` }).click();
  await expect(group.locator(".quote-detail")).toContainText("结算价JPY 25,000");
  const refused = page.getByRole("region", { name: "没报出价的商品和原因" });
  await expect(refused).toContainText(supplierC.tenant.tenantName);
  await expect(refused).toContainText(productC.code);
  await expect(refused).toContainText("离用车的时间不够提前预订时长");
  await snapshot(page, "platform-quote-preview");
});

test("没有权限的角色：财务看不到「商品」「报价试算」，直接打开地址显示没有权限；只读角色能看商品、不能试算", async ({ page, request }) => {
  test.setTimeout(90_000);
  const finance = await createStaff(request, "finance");
  await loginAs(page, "platform", finance.email, finance.password);
  await expect(menu(page).getByRole("link", { name: "首页" })).toBeVisible();
  await expect(menu(page).getByRole("link", { name: "商品" })).toHaveCount(0);
  await expect(menu(page).getByRole("link", { name: "报价试算" })).toHaveCount(0);
  await expect(page.locator(".entry-card").filter({ hasText: "已上架" })).toHaveCount(0);
  for (const path of ["/platform/products", `/platform/products/${crypto.randomUUID()}`, "/platform/quote-preview"]) {
    await page.goto(path);
    await expect(page.getByText("你没有权限查看这里"), path).toBeVisible();
  }
  const token = await platformApiLogin(request, finance.email, finance.password);
  expect((await request.get("/platform/v1/products", { headers: { authorization: `Bearer ${token}` } })).status(), "后端同样不让财务看").toBe(403);

  const viewer = await createStaff(request, "readonly");
  await page.getByRole("button", { name: /账号菜单/ }).click();
  await page.getByRole("menuitem", { name: "退出登录" }).click();
  await fillLogin(page, viewer.email, viewer.password);
  await expect(page.getByRole("heading", { level: 1, name: "首页" })).toBeVisible();
  await expect(menu(page).getByRole("link", { name: "商品" })).toBeVisible();
  await expect(menu(page).getByRole("link", { name: "报价试算" })).toHaveCount(0);
  await page.goto("/platform/quote-preview");
  await expect(page.getByText("你没有权限查看这里")).toBeVisible();
});

for (const scheme of ["light", "dark"] as const) {
  test(`${scheme === "light" ? "亮色" : "暗色"}：商品列表、详情（基础信息、价格规则、上架检查）、供应商详情的商品、报价试算（表单出错、结果）通过 axe 检查；320px 宽不横向滚动`, async ({ page, request }) => {
    test.setTimeout(180_000);
    await page.emulateMedia({ colorScheme: scheme });
    const world = await createWorld(request);
    const supplier = await createSupplier(request, world);
    const product = await publishedProduct(request, supplier, world, "很长很长的商品名字".repeat(4), 20000);
    const admin = adminCredentials();
    await loginAs(page, "platform", admin.email, admin.password);
    const check = async (what: string): Promise<void> => {
      for (const width of [1280, 320]) {
        await page.setViewportSize({ width, height: 800 });
        await expectNoHorizontalOverflow(page, `${what}（${width}px）`);
        await expectAccessible(page, `${what}（${width}px，${scheme}）`);
      }
      await page.setViewportSize({ width: 1280, height: 800 });
    };

    await page.goto(`/platform/products?city=${world.city.id}`);
    await expect(page.getByRole("link", { name: /很长很长的商品名字/ })).toBeVisible();
    await check("商品列表");
    await page.goto(`/platform/products?city=${world.city.id}&status=unpublished`);
    await expect(page.getByText("没有符合条件的商品")).toBeVisible();
    await check("商品列表（筛选后没有）");
    for (const step of ["basic", "prices", "publish"]) {
      await page.goto(`/platform/products/${product.id}/${step}`);
      await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
      await expect(page.locator(".step-nav__status--loading")).toHaveCount(0);
      await check(`商品详情（${step}）`);
    }
    await page.goto(`/platform/tenants/${supplier.tenant.tenantId}`);
    await expect(page.locator("section.tenant-products").getByRole("link", { name: /很长很长的商品名字/ })).toBeVisible();
    await check("供应商详情的商品");

    await page.goto("/platform/quote-preview");
    await page.getByRole("button", { name: "试算", exact: true }).click();
    await expect(page.getByText(/有 \d+ 处需要修改/)).toBeVisible();
    await check("报价试算（出错）");
    await fillQuote(page, world, addDays(product.today, 1));
    await page.getByRole("button", { name: "试算", exact: true }).click();
    await expect(page.getByRole("heading", { level: 2, name: "试算结果" })).toBeVisible();
    await page.getByRole("button", { name: /的结算价明细$/ }).first().click();
    await check("报价试算（结果，明细展开）");
  });
}
