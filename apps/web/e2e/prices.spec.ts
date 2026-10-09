/**
 * 供应商后台「价格规则与调价规则」（M1-04），真实后端、真实 PostgreSQL。
 * 主数据、供应商、商品的前两步和详情经接口准备好；价格、调价规则、上架都经界面做。
 * 金额的断言和 @nozomi/domain 的计算对照，不在测试里另写公式。
 */
import { addDays, applyAdjustRules, basePrice, exactFromMinor } from "@nozomi/domain";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { type Supplier, type World, checkItem, createProductByApi, createSupplier, createWorld, expectAccessible, step, tenantHeaders, toast } from "./catalog.ts";
import { createActiveTenant, expectNoHorizontalOverflow, loginAs, snapshot } from "./support.ts";

const RULES = {
  booking: { sale_from: null, sale_to: null, service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 0, note: null },
  urgent: { enabled: false, daily_quota: null, tiers: [] },
  night: { enabled: false, window: null, amount: null, charge_unit: null },
  addons: [],
  driver_languages: [],
};

/** 一个前两步和商品详情都配好的商品：只差价格。 */
async function readyProduct(request: APIRequestContext, supplier: Supplier, world: World, category: "airport_transfer" | "point_to_point" | "charter", title: string): Promise<{ id: string }> {
  const product = await createProductByApi(request, supplier, world, category);
  const wait = { mode: "limited", minutes: 60 };
  const freeWait = category === "airport_transfer" ? { pickup: wait, dropoff: wait, general: null } : { pickup: null, dropoff: null, general: wait };
  const rules = await request.put(`/tenant/v1/products/${product.id}/service-rules`, { headers: { ...supplier.headers, "if-match": `"${product.version}"` }, data: { ...RULES, free_wait: freeWait } });
  expect(rules.status(), `保存服务规则：${await rules.text()}`).toBe(200);
  const version = ((await rules.json()) as { version: number }).version;
  const content = await request.put(`/tenant/v1/products/${product.id}/content`, { headers: { ...supplier.headers, "if-match": `"${version}"` }, data: { zh: { title, ...(category === "airport_transfer" ? { pickup_guide: "到达大厅 2 号出口" } : {}) } } });
  expect(content.status(), `保存商品详情：${await content.text()}`).toBe(200);
  return { id: product.id };
}

const cell = (page: Page, row: string, column: string) => page.getByLabel(`${row} 的${column}`, { exact: true });

test("设一口价 → 上架检查全部通过 → 真正上架 → 列表显示已上架 → 删到没有可用价格被拒 → 下架", async ({ page, request }) => {
  test.setTimeout(150_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  const product = await readyProduct(request, supplier, world, "airport_transfer", "羽田机场接送");
  await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);
  await page.goto(`/products/${product.id}`);

  // 还没有价格：自动落在第 ③ 步；步骤导航和上架检查说的是真实的原因
  await expect(page).toHaveURL(/\/prices$/);
  await expect(page.getByRole("heading", { level: 2, name: "③ 价格规则" })).toBeVisible();
  await expect(step(page, "价格规则")).toContainText("还差 1 项");
  await expect(page.locator(".price-info")).toContainText("币种 JPY（日元没有小数）");
  await expect(page.locator(".price-info")).toContainText(`${world.city.name}当地时间`);
  await expect(page.getByRole("heading", { level: 3, name: "还没有设价格" })).toBeVisible();
  const row = `${supplier.area.name} · ${world.group.name} · 接送通用`;
  await expect(page.locator(".price-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".price-table tbody tr")).toContainText("没有价格");

  // 写错了的不让存；改对以后保存
  await cell(page, row, "基础价").fill("20000.5");
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(page.getByText("有 1 处需要修改")).toBeVisible();
  await expect(page.getByText(`${row}：日元金额不能有小数`).first()).toBeVisible();
  await cell(page, row, "基础价").fill("20000");
  await cell(page, row, "基础价").blur();
  await expect(cell(page, row, "基础价")).toHaveValue("20,000");
  await expect(page.locator(".price-meaning")).toContainText("每单 JPY 20,000，不看里程和时长。");
  await expect(page.getByRole("heading", { level: 3 }).filter({ hasText: "2 个组合都有价格" })).toBeVisible();
  await expect(page.locator(".step__summary")).toContainText("有 1 条未保存的修改");
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(toast(page, "已保存 1 条价格")).toBeVisible();
  await expect(page.locator(".price-table tbody tr")).toContainText("生效中");
  await expect(step(page, "价格规则")).toContainText("已完成");
  const saved = (await (await request.get(`/tenant/v1/products/${product.id}/price-rules`, { headers: supplier.headers })).json()) as { items: { base_price: number; direction: string; status: string }[]; coverage: { missing: number } };
  expect(saved.items.map((item) => [item.base_price, item.direction, item.status])).toEqual([[20000, "both", "enabled"]]);
  expect(saved.coverage.missing).toBe(0);
  await snapshot(page, "prices-rules-desktop");
  await expectNoHorizontalOverflow(page, "价格规则");

  // 上架检查全部通过 → 真正上架
  await step(page, "上架检查").click();
  await expect(page.getByText("可以上架了")).toBeVisible();
  await expect(checkItem(page, "price_rules")).toContainText("已满足");
  await page.getByRole("button", { name: "上架", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "上架「羽田机场接送」？" });
  await confirm.getByRole("button", { name: "上架", exact: true }).click();
  await expect(toast(page, "已上架「羽田机场接送」")).toBeVisible();
  await expect(page.getByRole("button", { name: "下架" })).toBeVisible();
  await page.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "商品" }).click();
  const listed = page.getByRole("row").filter({ has: page.getByRole("link", { name: "羽田机场接送", exact: true }) });
  await expect(listed).toContainText("已上架");

  // 已上架：把唯一的价格删掉保存不了
  await page.goto(`/products/${product.id}/prices`);
  await page.getByRole("button", { name: `${row} 的更多操作` }).click();
  await page.getByRole("menuitem", { name: "删除" }).click();
  await expect(page.locator(".price-table tbody tr").first()).toContainText("将删除");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("这个商品已上架，至少要留 1 条启用、没过期的价格。要把价格全部停掉，请先下架。").first()).toBeVisible();
  const rejected = await request.post(`/tenant/v1/products/${product.id}/price-rules/batch`, { headers: { ...supplier.headers, "if-match": `"${((await (await request.get(`/tenant/v1/products/${product.id}`, { headers: supplier.headers })).json()) as { version: number }).version}"`, "idempotency-key": crypto.randomUUID() }, data: { create: [], update: [], delete: [((await (await request.get(`/tenant/v1/products/${product.id}/price-rules`, { headers: supplier.headers })).json()) as { items: { id: string }[] }).items[0]?.id] } });
  expect(rejected.status(), "后端：已上架的商品不能把价格删光").toBe(409);
  expect(((await rejected.json()) as { error: { code: string } }).error.code).toBe("PUBLISH_CHECK_FAILED");
  await page.getByRole("button", { name: "撤销" }).click();

  // 下架
  await page.getByRole("button", { name: /的更多操作$/ }).first().click();
  await page.getByRole("menuitem", { name: "下架" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "下架", exact: true }).click();
  await expect(toast(page, "已下架「羽田机场接送」")).toBeVisible();
});

const jpy = (minor: number): string => `JPY ${minor.toLocaleString("en-US")}`;
/** 规则 4：供应商后台的任何应答和页面里都不能有对外价和加价比例。 */
const FORBIDDEN = /markup|sell_price|sale_price|retail|external_price|public_price|对外价|加价比例|加价率/i;

async function productVersion(request: APIRequestContext, supplier: Supplier, productId: string): Promise<number> {
  return ((await (await request.get(`/tenant/v1/products/${productId}`, { headers: supplier.headers })).json()) as { version: number }).version;
}

async function createFixedPrice(request: APIRequestContext, supplier: Supplier, world: World, productId: string, amount: number, validFrom: string, validTo: string | null = null): Promise<void> {
  const response = await request.post(`/tenant/v1/products/${productId}/price-rules/batch`, {
    headers: { ...supplier.headers, "if-match": `"${await productVersion(request, supplier, productId)}"`, "idempotency-key": crypto.randomUUID() },
    data: { create: [{ ref: "a", area_id: supplier.area.id, vehicle_group_id: world.group.id, direction: "both", package_hours: null, pricing_model: "fixed", base_price: amount, start_price: null, start_meters: null, start_minutes: null, per_km: null, per_minute: null, min_price: null, package_km: null, package_price: null, overtime_per_hour: null, over_km_per_km: null, valid_from: validFrom, valid_to: validTo, status: "enabled" }], update: [], delete: [] },
  });
  expect(response.status(), `接口新建价格：${await response.text()}`).toBe(200);
}

test("调价规则：新建并试算（和 domain 一致）→ 后端的价格日历算出同一个数 → 调完不大于 0 存不了 → 顺序、启停、删除；租户 B 看不到", async ({ page, request }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  const product = await readyProduct(request, supplier, world, "airport_transfer", "羽田机场接送");
  const priceInfo = (await (await request.get(`/tenant/v1/products/${product.id}/price-rules`, { headers: supplier.headers })).json()) as { today: string; rounding_unit: number };
  await createFixedPrice(request, supplier, world, product.id, 20000, priceInfo.today);
  await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);
  await page.goto(`/products/${product.id}/prices/adjust`);

  // 一条都没有 → 新建
  await expect(page.getByRole("heading", { name: "还没有调价规则" })).toBeVisible();
  await page.getByRole("link", { name: "新建调价规则" }).click();
  await expect(page).toHaveURL(/\/prices\/adjust\/new$/);
  await expect(page.getByRole("heading", { level: 3, name: "新建调价规则" })).toBeVisible();
  await expect(page.getByLabel("出行日期从")).toHaveValue(priceInfo.today);

  // 没填完整不能保存
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText("有 2 处需要修改")).toBeVisible();
  await expect(page.getByRole("button", { name: "请填写名称" })).toBeVisible();
  await expect(page.getByRole("button", { name: "第 1 步：请填大于 0 的数。不想调，请删掉这一步" })).toBeVisible();

  // 两步：上调 20%，再下调 JPY 1,000。试算的每个数和 domain 的一样
  await page.getByRole("textbox", { name: "名称", exact: true }).fill("旺季上调");
  await page.getByLabel("第 1 步的数值").fill("20");
  await page.getByRole("button", { name: "加一步" }).click();
  await page.getByLabel("第 2 步的方向").selectOption("down");
  await page.getByLabel("第 2 步的方式").selectOption("amount");
  await page.getByLabel("第 2 步的数值").fill("1000");
  const steps = [{ type: "percent" as const, value: 2000 }, { type: "amount" as const, value: -1000 }];
  const expected = applyAdjustRules(basePrice({ model: "fixed", basePriceMinor: 20000 }), [{ steps }], priceInfo.rounding_unit);
  expect(expected.finalMinor).not.toBeNull();
  const trial = page.locator(".adjust-trial");
  await expect(trial.getByRole("row", { name: /第 1 步/ })).toContainText("上调 20%");
  await expect(trial.getByRole("row", { name: /第 1 步/ })).toContainText("+4,000");
  await expect(trial.getByRole("row", { name: /第 2 步/ })).toContainText("−1,000");
  await expect(trial.locator(".adjust-trial__final")).toContainText(jpy(expected.finalMinor ?? 0));
  await expect(page.locator(".adjust-meaning__sentence")).toContainText("全部区域、全部车型组、接机和送机：在基础价上上调 20%，再下调 JPY 1,000。");
  await expect(page.locator(".adjust-trial__summary")).toContainText(`${jpy(20000)} → ${jpy(expected.finalMinor ?? 0)}，比基础价高 ${jpy(expected.adjustMinor ?? 0)}。`);
  await snapshot(page, "prices-adjust-form-desktop");
  await expectNoHorizontalOverflow(page, "调价规则表单");
  await expectAccessible(page, "调价规则表单");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(toast(page, "已新建调价规则「旺季上调」")).toBeVisible();
  await expect(page).toHaveURL(/\/prices\/adjust$/);
  const first = page.getByRole("row").filter({ has: page.getByRole("link", { name: "旺季上调", exact: true }) });
  await expect(first).toContainText("上调 20%");
  await expect(first).toContainText("再下调 JPY 1,000");
  await expect(first).toContainText("已启用");
  await expect(first).toContainText(`${priceInfo.today} 起`);

  // 后端的价格日历对同一天算出同一个数
  const calendar = await request.get(`/tenant/v1/products/${product.id}/price-calendar`, { headers: supplier.headers, params: { area_id: supplier.area.id, vehicle_group_id: world.group.id, direction: "pickup", from: priceInfo.today, to: priceInfo.today } });
  expect(calendar.status(), await calendar.text()).toBe(200);
  const calendarBody = (await calendar.json()) as { days: { segments: { final: number | null }[] }[] };
  expect(calendarBody.days[0]?.segments.map((segment) => segment.final)).toEqual([expected.finalMinor]);

  // 调完不大于 0：页面先拦住；先不启用可以存；之后启用被后端拒绝
  await page.getByRole("link", { name: "新建调价规则" }).click();
  await page.getByRole("textbox", { name: "名称", exact: true }).fill("清仓");
  await page.getByLabel("第 1 步的方向").selectOption("down");
  await page.getByLabel("第 1 步的方式").selectOption("amount");
  await page.getByLabel("第 1 步的数值").fill("20000");
  await expect(page.getByText("按这个价算下来不大于 0，这样的规则保存不了。请把下调改小。")).toBeVisible();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByText(`按「${supplier.area.name} · ${world.group.name} · 接送通用」的价格 JPY 20,000 算，调完不大于 0。请把下调改小、缩小适用范围，或先不勾「启用」。`)).toBeVisible();
  await page.getByLabel(/保存后启用/).uncheck();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  // 调得很多（低于基础价的一半）：再问一次，默认焦点在「回去检查」
  const unusual = page.getByRole("dialog", { name: "这条规则调得很多，确认保存？" });
  await expect(unusual).toContainText("JPY 20,000 会变成 JPY 0");
  await expect(unusual.getByRole("button", { name: "回去检查" })).toBeFocused();
  await unusual.getByRole("button", { name: "确认保存" }).click();
  await expect(toast(page, "已新建调价规则「清仓」")).toBeVisible();
  const second = page.getByRole("row").filter({ has: page.getByRole("link", { name: "清仓", exact: true }) });
  await expect(second).toContainText("已停用");
  await second.getByRole("switch", { name: "启用 清仓" }).click();
  await page.getByRole("dialog", { name: "这条规则调得很多，确认保存？" }).getByRole("button", { name: "确认保存" }).click();
  await expect(page.getByText("按现在的价格算，这条规则有 1 条价格调完不大于 0。请先改这条规则。")).toBeVisible();
  await expect(second.getByRole("switch", { name: "启用 清仓" })).not.toBeChecked();

  // 顺序：上移 → 保存顺序
  await second.getByRole("button", { name: "上移 清仓" }).click();
  await expect(page.getByText("顺序改了，还没有保存。")).toBeVisible();
  await page.getByRole("button", { name: "保存顺序" }).click();
  await expect(toast(page, "已保存顺序")).toBeVisible();
  const listed = (await (await request.get(`/tenant/v1/products/${product.id}/adjust-rules`, { headers: supplier.headers })).json()) as { items: { id: string; name: string; status: string }[] };
  expect(listed.items.map((item) => [item.name, item.status])).toEqual([["清仓", "disabled"], ["旺季上调", "enabled"]]);
  await snapshot(page, "prices-adjust-list-desktop");
  await expectAccessible(page, "调价规则列表");

  // 停用（草稿：立即生效）、删除（要确认）
  await first.getByRole("switch", { name: "启用 旺季上调" }).click();
  await expect(toast(page, "已停用「旺季上调」")).toBeVisible();
  await page.getByRole("button", { name: "清仓 的更多操作" }).click();
  await page.getByRole("menuitem", { name: "删除" }).click();
  const confirm = page.getByRole("dialog", { name: "删除调价规则「清仓」？" });
  await expect(confirm.getByRole("button", { name: "取消" })).toBeFocused();
  await confirm.getByRole("button", { name: "删除", exact: true }).click();
  await expect(toast(page, "已删除调价规则「清仓」")).toBeVisible();
  await expect(page.getByRole("link", { name: "清仓", exact: true })).toHaveCount(0);

  // 手机宽度：卡片，不横向滚动；暗色也过无障碍检查
  await page.setViewportSize({ width: 320, height: 720 });
  await expectNoHorizontalOverflow(page, "调价规则列表（手机）");
  await snapshot(page, "prices-adjust-list-mobile");
  await page.getByRole("link", { name: "旺季上调", exact: true }).click();
  await expect(page.getByRole("heading", { level: 3, name: "旺季上调" })).toBeVisible();
  await expectNoHorizontalOverflow(page, "调价规则表单（手机）");
  await page.emulateMedia({ colorScheme: "dark" });
  await expectAccessible(page, "调价规则表单（暗色）");
  await snapshot(page, "prices-adjust-form-mobile-dark");
  expect(await page.locator("body").innerText()).not.toMatch(FORBIDDEN);

  // 应答里没有对外价和加价比例；租户 B 读不到、改不了
  for (const path of ["price-rules", "adjust-rules", "price-coverage", `price-calendar?area_id=${supplier.area.id}&vehicle_group_id=${world.group.id}&direction=pickup&from=${priceInfo.today}&to=${priceInfo.today}`]) {
    const response = await request.get(`/tenant/v1/products/${product.id}/${path}`, { headers: supplier.headers });
    expect(response.status(), path).toBe(200);
    expect(await response.text(), path).not.toMatch(FORBIDDEN);
  }
  expect(await (await request.get("/tenant/v1/price-overview", { headers: supplier.headers })).text()).not.toMatch(FORBIDDEN);
  const other = await createActiveTenant(request);
  const otherHeaders = await tenantHeaders(request, other.adminEmail, other.password);
  for (const path of ["price-rules", "adjust-rules", "price-coverage"]) expect((await request.get(`/tenant/v1/products/${product.id}/${path}`, { headers: otherHeaders })).status(), `租户 B 读 ${path}`).toBe(404);
  expect((await request.post(`/tenant/v1/products/${product.id}/adjust-rules/${listed.items[1]?.id}/enable`, { headers: otherHeaders })).status(), "租户 B 启用租户 A 的调价规则").toBe(404);
  expect(((await (await request.get("/tenant/v1/price-overview", { headers: otherHeaders })).json()) as { items: unknown[] }).items).toEqual([]);
});

test("包车套餐和里程 + 时长各设一条；日期重叠当场标出、存不了，后端也拒绝", async ({ page, request }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);

  // 包车：先加套餐，再填套餐价
  const charter = await readyProduct(request, supplier, world, "charter", "东京包车");
  await page.goto(`/products/${charter.id}/prices`);
  await page.getByRole("button", { name: "新增套餐" }).first().click();
  const dialog = page.getByRole("dialog", { name: "新增套餐" });
  await dialog.getByLabel(/套餐时长/).fill("8");
  await dialog.getByLabel(/套餐公里/).fill("100");
  await dialog.getByRole("button", { name: "新增", exact: true }).click();
  const charterRow = `${supplier.area.name} · ${world.group.name} · 8 小时`;
  await cell(page, charterRow, "套餐价").fill("60000");
  await cell(page, charterRow, "超时每小时").fill("5000");
  await cell(page, charterRow, "超公里每公里").fill("300");
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(toast(page, "已保存 1 条价格")).toBeVisible();
  const charterSaved = (await (await request.get(`/tenant/v1/products/${charter.id}/price-rules`, { headers: supplier.headers })).json()) as { items: Record<string, unknown>[] };
  expect(charterSaved.items.map((item) => [item["pricing_model"], item["package_hours"], item["package_km"], item["package_price"], item["overtime_per_hour"], item["over_km_per_km"]])).toEqual([["charter_package", 8, 100, 60000, 5000, 300]]);
  await expect(step(page, "价格规则")).toContainText("已完成");

  // 点对点：里程 + 时长
  const p2p = await readyProduct(request, supplier, world, "point_to_point", "东京点对点");
  await page.goto(`/products/${p2p.id}/prices`);
  const p2pRow = `${supplier.area.name} · ${world.group.name}`;
  await page.getByLabel(`${p2pRow} 的计价方式`).selectOption("mileage_time");
  await cell(page, p2pRow, "起步价").fill("3000");
  await cell(page, p2pRow, "起步里程").fill("2.5");
  await cell(page, p2pRow, "起步时长").fill("10");
  await cell(page, p2pRow, "超出每公里").fill("400");
  await cell(page, p2pRow, "超出每分钟").fill("50");
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(toast(page, "已保存 1 条价格")).toBeVisible();
  const p2pSaved = (await (await request.get(`/tenant/v1/products/${p2p.id}/price-rules`, { headers: supplier.headers })).json()) as { today: string; items: Record<string, unknown>[] };
  expect(p2pSaved.items.map((item) => [item["pricing_model"], item["start_price"], item["start_meters"], item["start_minutes"], item["per_km"], item["per_minute"], item["min_price"]])).toEqual([["mileage_time", 3000, 2500, 10, 400, 50, null]]);
  expect(exactFromMinor(3000)).toEqual(basePrice({ model: "mileage_time", startPriceMinor: 3000, startMeters: 2500, startMinutes: 10, perKmMinor: 400, perMinuteMinor: 50, minPriceMinor: null }));

  // 同一个组合再加一段日期，和原来那条重叠：当场标出，保存不了
  await page.getByRole("button", { name: `${p2pRow} 的更多操作` }).click();
  await page.getByRole("menuitem", { name: "再加一段日期" }).click();
  const added = page.getByLabel(`${p2pRow} 的生效日期从`).first();
  await expect(added).toHaveValue("");
  await added.fill(p2pSaved.today);
  await expect(page.getByText("有 2 条价格的生效日期重叠，保存前要改。")).toBeVisible();
  await expect(page.locator(".price-table tbody tr").filter({ hasText: "和 1 条价格的日期重叠" })).toHaveCount(2);
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(page.getByRole("button", { name: /^生效日期重叠——/ })).toBeVisible();
  await page.getByRole("button", { name: /^生效日期重叠——/ }).click();
  await expect(page.locator(":focus")).toHaveAttribute("aria-label", `${p2pRow} 的生效日期从`);
  // 后端对同样的内容也拒绝，并说出是和哪一条重叠
  const existing = p2pSaved.items[0] as Record<string, unknown>;
  const { id: existingId, base: _base, created_at: _created, updated_at: _updated, ...input } = existing;
  const rejected = await request.post(`/tenant/v1/products/${p2p.id}/price-rules/batch`, { headers: { ...supplier.headers, "if-match": `"${await productVersion(request, supplier, p2p.id)}"`, "idempotency-key": crypto.randomUUID() }, data: { create: [{ ...input, ref: "again" }], update: [], delete: [] } });
  expect(rejected.status()).toBe(409);
  const rejection = (await rejected.json()) as { error: { code: string; details: { conflicts: { ref?: string; with: { id?: string }[] }[] } } };
  expect(rejection.error.code).toBe("PRICE_RULE_CONFLICT");
  expect(rejection.error.details.conflicts.some((conflict) => conflict.ref === "again" && conflict.with.some((entry) => entry.id === existingId))).toBe(true);
});

test("价格日历：某一天的结算价和 domain 一致 → 在月历上选一段日期新建调价规则 → 回到日历看到那几天变了；键盘能选；手机是列表；只读角色只能看", async ({ page, request }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  const product = await readyProduct(request, supplier, world, "airport_transfer", "羽田机场接送");
  const info = (await (await request.get(`/tenant/v1/products/${product.id}/price-rules`, { headers: supplier.headers })).json()) as { today: string; rounding_unit: number };
  await createFixedPrice(request, supplier, world, product.id, 20000, `${info.today.slice(0, 8)}01`);
  await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);
  await page.goto(`/products/${product.id}/prices`);
  await page.getByRole("navigation", { name: "价格规则的分区" }).getByRole("link", { name: "价格日历" }).click();
  await expect(page).toHaveURL(/\/prices\/calendar$/);

  // 月历：每一天都是基础价；明细面板默认显示今天
  const month = info.today.slice(0, 7);
  const grid = page.getByRole("grid");
  const dayCell = (date: string) => page.locator(`#calendar-day-${date}`);
  await expect(dayCell(info.today)).toHaveAttribute("aria-label", /结算价 JPY 20,000/);
  await expect(dayCell(info.today)).toHaveAttribute("aria-current", "date");
  const panel = page.locator(".calendar-layout > .calendar-detail");
  await expect(panel).toContainText(info.today);
  await expect(panel).toContainText("结算价 JPY 20,000");
  await expect(panel).toContainText(`10:00 用车 · ${supplier.area.name} · ${world.group.name} · 接机`);
  await expect(page.getByText(`日期是${world.city.name}当地的用车日期。`)).toBeVisible();
  await expectNoHorizontalOverflow(page, "价格日历");
  await expectAccessible(page, "价格日历");

  // 选一段日期（点起点，按住 Shift 点终点）→ 新建调价规则：日期和适用范围已经填好
  const from = `${month}-10`;
  const to = `${month}-12`;
  await dayCell(from).click();
  await dayCell(to).click({ modifiers: ["Shift"] });
  await expect(page.locator(".calendar-bar")).toContainText(`已选 ${from} 至 ${to}，共 3 天`);
  await expect(dayCell(`${month}-11`)).toHaveAttribute("aria-selected", "true");
  await page.locator(".calendar-bar").getByRole("link", { name: "新建调价规则" }).click();
  await expect(page).toHaveURL(/\/prices\/adjust\/new$/);
  await expect(page.getByText(`已按你在日历上选的填好了日期和适用范围（${supplier.area.name} · ${world.group.name} · 接机）。`, { exact: false })).toBeVisible();
  await expect(page.getByLabel("出行日期从")).toHaveValue(from);
  await expect(page.getByLabel("出行日期到")).toHaveValue(to);
  await expect(page.getByRole("radio", { name: "指定区域" })).toBeChecked();
  await expect(page.getByRole("radio", { name: "只接机" })).toBeChecked();
  await page.getByRole("textbox", { name: "名称", exact: true }).fill("连休");
  await page.getByLabel("第 1 步的数值").fill("12.5");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(toast(page, "已新建调价规则「连休」")).toBeVisible();

  // 回到日历：那三天变了，数和 domain 算的一样；前后的日子和送机没变
  await expect(page).toHaveURL(/\/prices\/calendar$/);
  const expected = applyAdjustRules(exactFromMinor(20000), [{ steps: [{ type: "percent", value: 1250 }] }], info.rounding_unit).finalMinor ?? 0;
  expect(expected).not.toBe(20000);
  for (const date of [from, `${month}-11`, to]) await expect(dayCell(date)).toHaveAttribute("aria-label", new RegExp(`结算价 ${jpy(expected)}，上调，命中连休`));
  await expect(dayCell(addDays(to, 1))).toHaveAttribute("aria-label", /结算价 JPY 20,000$/);
  await expect(page.locator(".calendar-bar")).toContainText(`已选 ${from} 至 ${to}`);
  await expect(panel).toContainText(`结算价 ${jpy(expected)}`);
  await expect(panel).toContainText("上调 12.5%");
  await expect(panel.getByRole("link", { name: "改这条规则：连休" })).toBeVisible();
  await snapshot(page, "prices-calendar-desktop");
  await page.getByLabel("方向").selectOption("dropoff");
  await expect(page).toHaveURL(/dir=dropoff/);
  await expect(dayCell(from)).toHaveAttribute("aria-label", /结算价 JPY 20,000，选中的起点$/);
  await page.getByLabel("方向").selectOption("pickup");

  // 键盘：方向键走，Shift + 方向键选；Esc 取消；PageDown 换月份
  await page.getByRole("button", { name: "取消选择" }).click();
  await dayCell(`${month}-15`).focus();
  await page.keyboard.press("ArrowRight");
  await expect(dayCell(`${month}-16`)).toBeFocused();
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.locator(".calendar-bar")).toContainText(`已选 ${month}-16 至 ${month}-18，共 3 天`);
  await page.keyboard.press("Escape");
  await expect(page.locator(".calendar-bar")).toBeEmpty();
  await page.keyboard.press("PageDown");
  await expect(page.getByRole("heading", { level: 3 }).filter({ hasText: /年 \d+ 月/ })).not.toContainText(new RegExp(`^${Number(month.slice(0, 4))} 年 ${Number(month.slice(5))} 月$`));
  await expect(page).toHaveURL(/month=\d{4}-\d{2}/);
  await page.getByRole("button", { name: "回到本月" }).click();
  await expect(grid).toHaveAttribute("aria-label", new RegExp(`${Number(month.slice(5))} 月每一天的结算价`));

  // 手机：一天一行，点一天从底部看明细；不横向滚动；暗色过无障碍检查
  await page.setViewportSize({ width: 320, height: 720 });
  await expect(page.locator(".calendar__head")).toBeHidden();
  await expectNoHorizontalOverflow(page, "价格日历（手机）");
  await dayCell(from).click();
  const sheet = page.getByRole("dialog", { name: `${from} 的价` });
  await expect(sheet).toContainText(`结算价 ${jpy(expected)}`);
  await expectNoHorizontalOverflow(page, "价格日历明细（手机）");
  await sheet.getByRole("button", { name: "关闭" }).last().click();
  await page.getByRole("button", { name: "选一段日期" }).click();
  await dayCell(`${month}-20`).click();
  await expect(page.getByText("再点结束的那一天")).toBeVisible();
  await dayCell(`${month}-21`).click();
  await expect(page.locator(".calendar-bar")).toContainText(`已选 ${month}-20 至 ${month}-21，共 2 天`);
  await page.emulateMedia({ colorScheme: "dark" });
  await expectAccessible(page, "价格日历（手机，暗色）");
  await snapshot(page, "prices-calendar-mobile-dark");
  expect(await page.locator("body").innerText()).not.toMatch(FORBIDDEN);
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1280, height: 800 });

  // 调价规则列表里「在价格日历里看」带着这条规则的组合
  await page.goto(`/products/${product.id}/prices/adjust`);
  await page.getByRole("button", { name: "连休 的更多操作" }).click();
  await page.getByRole("menuitem", { name: "在价格日历里看" }).click();
  await expect(page).toHaveURL(new RegExp(`/prices/calendar\\?area=${supplier.area.id}&vg=${world.group.id}`));
  await expect(dayCell(from)).toHaveAttribute("aria-label", new RegExp(`结算价 ${jpy(expected)}`));
});
