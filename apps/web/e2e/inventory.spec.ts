/**
 * 供应商后台「库存与批量导入导出」（M1-05），真实后端、真实 PostgreSQL。
 * 主数据、供应商、商品的前两步和详情经接口准备好；价格、库存、导入导出、上架都经界面做。
 */
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { addDays, inventoryBatchDates } from "@nozomi/domain";
import { type Supplier, type World, checkItem, createProductByApi, createSupplier, createTenantUser, createWorld, expectAccessible, step, tenantHeaders, toast } from "./catalog.ts";
import { createActiveTenant, expectNoHorizontalOverflow, loginAs, snapshot } from "./support.ts";
import { column, readDownload, readSheet, upload, writeSheet } from "./xlsx.ts";

const RULES = {
  booking: { sale_from: null, sale_to: null, service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 0, note: null },
  urgent: { enabled: false, daily_quota: null, tiers: [] },
  night: { enabled: false, window: null, amount: null, charge_unit: null },
  addons: [],
  driver_languages: [],
};
/** 规则 4：供应商后台的任何应答和页面里都不能有对外价和加价比例。 */
const FORBIDDEN = /markup|sell_price|sale_price|retail|external_price|public_price|对外价|加价比例|加价率/i;

interface Day {
  date: string;
  total: number | null;
  status: string;
  remaining: number | null;
}
interface InventoryBody {
  version: number;
  mode: string;
  today: string;
  ahead: { sellable_days: number; last_set_date: string | null };
  days: Day[];
}

/** 一个前两步和商品详情都配好的商品：只差价格（库存默认不限量）。 */
async function readyProduct(request: APIRequestContext, supplier: Supplier, world: World, title: string): Promise<{ id: string }> {
  const product = await createProductByApi(request, supplier, world, "airport_transfer");
  const wait = { mode: "limited", minutes: 60 };
  const rules = await request.put(`/tenant/v1/products/${product.id}/service-rules`, { headers: { ...supplier.headers, "if-match": `"${product.version}"` }, data: { ...RULES, free_wait: { pickup: wait, dropoff: wait, general: null } } });
  expect(rules.status(), `保存服务规则：${await rules.text()}`).toBe(200);
  const version = ((await rules.json()) as { version: number }).version;
  const content = await request.put(`/tenant/v1/products/${product.id}/content`, { headers: { ...supplier.headers, "if-match": `"${version}"` }, data: { zh: { title, pickup_guide: "到达大厅 2 号出口" } } });
  expect(content.status(), `保存商品详情：${await content.text()}`).toBe(200);
  return { id: product.id };
}

async function inventory(request: APIRequestContext, supplier: Supplier, productId: string, from: string, to: string): Promise<InventoryBody> {
  const response = await request.get(`/tenant/v1/products/${productId}/inventory`, { headers: supplier.headers, params: { from, to } });
  expect(response.status(), await response.text()).toBe(200);
  return (await response.json()) as InventoryBody;
}
async function today(request: APIRequestContext, supplier: Supplier, productId: string): Promise<string> {
  const day = new Date().toISOString().slice(0, 10);
  return (await inventory(request, supplier, productId, day, day)).today;
}
async function productVersion(request: APIRequestContext, supplier: Supplier, productId: string): Promise<number> {
  return ((await (await request.get(`/tenant/v1/products/${productId}`, { headers: supplier.headers })).json()) as { version: number }).version;
}
async function fixedPrice(request: APIRequestContext, supplier: Supplier, world: World, productId: string, amount: number, from: string): Promise<void> {
  const response = await request.post(`/tenant/v1/products/${productId}/price-rules/batch`, {
    headers: { ...supplier.headers, "if-match": `"${await productVersion(request, supplier, productId)}"`, "idempotency-key": crypto.randomUUID() },
    data: { create: [{ ref: "a", area_id: supplier.area.id, vehicle_group_id: world.group.id, direction: "both", package_hours: null, pricing_model: "fixed", base_price: amount, start_price: null, start_meters: null, start_minutes: null, per_km: null, per_minute: null, min_price: null, package_km: null, package_price: null, overtime_per_hour: null, over_km_per_km: null, valid_from: from, valid_to: null, status: "enabled" }], update: [], delete: [] },
  });
  expect(response.status(), `接口新建价格：${await response.text()}`).toBe(200);
}
const dayCell = (page: Page, date: string) => page.locator(`#inventory-day-${date}`);
const panel = (page: Page) => page.locator(".calendar-layout > .stock-day");

test("把一个商品从价格一路配到上架：价格 → 库存（不限量 → 先设库存 → 改成限量 → 改一天）→ 详情 → 上架；批量设置后日历和接口一致", async ({ page, request }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  const product = await readyProduct(request, supplier, world, "羽田机场接送");
  const now = await today(request, supplier, product.id);
  await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);
  await page.goto(`/products/${product.id}`);

  // ③ 价格：填一条，保存并下一步就是 ④ 库存
  await expect(page).toHaveURL(/\/prices$/);
  await expect(step(page, "库存")).toContainText("已完成 · 不限量");
  await page.getByLabel(`${supplier.area.name} · ${world.group.name} · 接送通用 的基础价`, { exact: true }).fill("20000");
  await page.getByRole("button", { name: "保存并下一步" }).click();
  await expect(page).toHaveURL(/\/inventory$/);
  await expect(page.getByRole("heading", { level: 2, name: "④ 库存" })).toBeVisible();
  await expect(page.getByText(`库存按${world.city.name}当地的用车日期算。一天一个数，不分时段，也不分车型组。`)).toBeVisible();
  await expect(page.locator(".stock-mode")).toContainText("现在是：不限量");
  await expect(dayCell(page, now)).toHaveAttribute("aria-label", /今天，不限量$/);
  await expect(dayCell(page, now)).toHaveAttribute("aria-current", "date");
  await expectNoHorizontalOverflow(page, "库存（不限量）");

  // 改成限量：一天都没设时先提醒，带去批量设置
  await page.getByRole("button", { name: "改成限量" }).click();
  const toLimited = page.getByRole("dialog", { name: "改成限量？" });
  await expect(toLimited).toContainText("你还没有给任何一天设库存。");
  await expect(toLimited.getByRole("button", { name: "取消" })).toBeFocused();
  await toLimited.getByRole("button", { name: "先去设库存" }).click();
  const batch = page.getByRole("dialog", { name: "批量设置库存" });
  await expect(batch.getByLabel("日期从")).toHaveValue(now);
  const until = addDays(now, 13);
  await batch.getByLabel("日期到").fill(until);
  await batch.getByRole("button", { name: "保存", exact: true }).click();
  await expect(batch.getByText("请选择要设成什么")).toBeVisible();
  await batch.getByRole("radio", { name: "只设每周的某几天" }).check();
  await batch.getByRole("button", { name: "工作日" }).click();
  await batch.getByLabel("可售单数").fill("5");
  const dates = inventoryBatchDates({ from: now, to: until, weekdays: [1, 2, 3, 4, 5] });
  await expect(batch.locator(".stock-batch__readback")).toContainText(`${now} 至 ${until} 的每个周一、周二、周三、周四、周五，共 ${dates.length} 天：每天可售 5 单。`);
  await expect(batch.locator(".stock-batch__readback")).toContainText("现在是不限量，这些数要改成限量后才起作用。");
  await batch.getByRole("button", { name: "保存", exact: true }).click();
  await expect(toast(page, `已设置 ${dates.length} 天的库存`)).toBeVisible();
  const first = dates[0] as string;
  await page.goto(`/products/${product.id}/inventory?month=${first.slice(0, 7)}`);
  await expect(dayCell(page, first)).toHaveAttribute("aria-label", /不限量，已设 5，限量时生效/);

  // 现在改成限量：读得到设了几天
  await page.getByRole("button", { name: "改成限量" }).click();
  await expect(toLimited).toContainText(`今后一年里，你已经给 ${dates.length} 天设了库存（其中 ${dates.length} 天有库存可卖），最晚设到 ${dates.at(-1)}。其余的日子卖不出去。`);
  await toLimited.getByRole("button", { name: "改成限量" }).click();
  await expect(toast(page, "已改成限量")).toBeVisible();
  await expect(page.locator(".stock-mode")).toContainText("现在是：限量");
  await expect(page.locator(".stock-mode")).toContainText("没有设库存的日子卖不出去。");
  await expect(step(page, "库存")).toContainText("已完成 · 限量");

  // 日历的每一格和接口一致
  const month = first.slice(0, 7);
  const monthEnd = addDays(`${addDays(`${month}-28`, 4).slice(0, 7)}-01`, -1);
  const api = await inventory(request, supplier, product.id, `${month}-01`, monthEnd);
  expect(api.mode).toBe("limited");
  expect(api.days.filter((day) => day.total === 5).map((day) => day.date)).toEqual(dates.filter((date) => date.startsWith(month)));
  for (const day of api.days.filter((entry) => entry.date >= now).slice(0, 10)) {
    await expect(dayCell(page, day.date), day.date).toHaveAttribute("aria-label", day.status === "open" ? /还剩 5 单，共 5 单/ : /没设，卖不出去/);
  }
  await snapshot(page, "inventory-limited-desktop");
  await expectAccessible(page, "库存（限量）");

  // 改一天：停售、清除、改数；没变不发请求
  await dayCell(page, first).click();
  await expect(panel(page)).toContainText(first);
  await expect(panel(page)).toContainText("还剩 5 单");
  await expect(panel(page).getByLabel("可售单数")).toHaveValue("5");
  await panel(page).getByRole("radio", { name: /^停售/ }).check();
  await panel(page).getByRole("button", { name: "保存", exact: true }).click();
  await expect(toast(page, `已保存 ${first.slice(5)} 的库存`)).toBeVisible();
  await expect(dayCell(page, first)).toHaveAttribute("aria-label", /停售/);
  await panel(page).getByRole("radio", { name: /^清除/ }).check();
  await panel(page).getByRole("button", { name: "保存", exact: true }).click();
  await expect(dayCell(page, first)).toHaveAttribute("aria-label", /没设，卖不出去/);
  await panel(page).getByLabel("可售单数").fill("0");
  await expect(panel(page).getByRole("radio", { name: /^停售/ })).toBeChecked();
  await panel(page).getByLabel("可售单数").fill("10000");
  await panel(page).getByRole("button", { name: "保存", exact: true }).click();
  await expect(panel(page).getByText("请填 1 到 9,999 之间的整数。要停售请选「停售」")).toBeVisible();
  await panel(page).getByLabel("可售单数").fill("7");
  await panel(page).getByLabel("可售单数").press("Enter");
  await expect(dayCell(page, first)).toHaveAttribute("aria-label", /还剩 7 单，共 7 单/);
  expect((await inventory(request, supplier, product.id, first, first)).days[0]?.total).toBe(7);

  // 下一步 → 详情 → 上架检查：库存一项写着现在是限量；上架
  await page.getByRole("link", { name: "下一步" }).click();
  await expect(page).toHaveURL(/\/content$/);
  await step(page, "上架检查").click();
  await expect(page.getByText("可以上架了")).toBeVisible();
  await expect(checkItem(page, "inventory")).toContainText("现在是限量，按每天设的库存接单。");
  await expect(page.getByText("已完成 5 / 5")).toBeVisible();
  await page.getByRole("button", { name: "上架", exact: true }).click();
  await page.getByRole("dialog", { name: "上架「羽田机场接送」？" }).getByRole("button", { name: "上架", exact: true }).click();
  await expect(toast(page, "已上架「羽田机场接送」")).toBeVisible();
  expect(await page.locator("body").innerText()).not.toMatch(FORBIDDEN);
});

async function setLimitedWithStock(request: APIRequestContext, supplier: Supplier, productId: string, from: string, to: string, total: number): Promise<void> {
  const set = await request.post(`/tenant/v1/products/${productId}/inventory/batch-set`, { headers: { ...supplier.headers, "if-match": `"${await productVersion(request, supplier, productId)}"` }, data: { from, to, weekdays: [], total } });
  expect(set.status(), await set.text()).toBe(200);
  const mode = await request.put(`/tenant/v1/products/${productId}/inventory`, { headers: { ...supplier.headers, "if-match": `"${await productVersion(request, supplier, productId)}"` }, data: { mode: "limited" } });
  expect(mode.status(), await mode.text()).toBe(200);
}
async function chooseFile(page: Page, name: string, bytes: Buffer): Promise<void> {
  await page.locator("#import-file").setInputFiles(upload(name, bytes));
}

test("库存：导出 → 原样导入全部没变 → 改几行（有一格写错指到那一格）→ 改好 → 确认导入 → 日历变了；检查后商品被别人改了要重新检查；只读角色只有导出；租户 B 导不出也导不进", async ({ page, request }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  const product = await readyProduct(request, supplier, world, "羽田机场接送");
  const now = await today(request, supplier, product.id);
  await fixedPrice(request, supplier, world, product.id, 20000, now);
  await setLimitedWithStock(request, supplier, product.id, now, addDays(now, 9), 5);
  await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);
  await page.goto(`/products/${product.id}/inventory`);

  // 导出：默认今天起 90 天；文件每天一行
  await page.getByRole("button", { name: "导入 / 导出" }).click();
  await page.getByRole("menuitem", { name: "导出库存…" }).click();
  const exportDialog = page.getByRole("dialog", { name: "导出库存" });
  await expect(exportDialog.getByLabel("导出日期从")).toHaveValue(now);
  await expect(exportDialog.getByLabel("导出日期到")).toHaveValue(addDays(now, 89));
  const [download] = await Promise.all([page.waitForEvent("download"), exportDialog.getByRole("button", { name: "导出", exact: true }).click()]);
  const exported = await readDownload(download);
  expect(exported.name).toMatch(/inventory-.*\.xlsx$/);
  await expect(toast(page, `已开始下载「${exported.name}」`)).toBeVisible();
  const sheet = readSheet(exported.bytes);
  const dateColumn = column(sheet, "日期");
  const totalColumn = column(sheet, "可售单数");
  expect(sheet.rows.length).toBe(91);
  expect([sheet.rows[1]?.[dateColumn], sheet.rows[1]?.[totalColumn], sheet.rows[11]?.[totalColumn] ?? null]).toEqual([now, "5", null]);
  expect(JSON.stringify(sheet.rows)).not.toMatch(FORBIDDEN);

  // 原样导回来：都没变，不能导入
  await page.getByRole("button", { name: "导入 / 导出" }).click();
  await page.getByRole("menuitem", { name: "导入库存…" }).click();
  await expect(page).toHaveURL(/\/inventory\/import$/);
  await expect(page.getByRole("heading", { level: 3, name: "导入库存" })).toBeVisible();
  await expect(page.locator(".import-steps [aria-current=step]")).toHaveText("1 选文件");
  await expect(page.getByText("填 0 = 停售；留空 = 清除")).toBeVisible();
  await chooseFile(page, exported.name, exported.bytes);
  await expect(page.locator(".alert__title", { hasText: "没有要导入的内容" })).toBeVisible();
  await expect(page.getByText("文件里的 90 行都和现在的一样。")).toBeVisible();
  await expect(page.getByRole("button", { name: "确认导入" })).toHaveAttribute("aria-disabled", "true");
  await expect(page.locator("#import-blocked")).toHaveText("没有要导入的内容");
  await expect(page.locator(".import-steps [aria-current=step]")).toHaveText("2 看检查结果");

  // 改四行：改数、停售、清除，还有一格写错
  const edited = { ...sheet, rows: sheet.rows.map((row) => [...row]) };
  (edited.rows[1] as (string | null)[])[totalColumn] = "9";
  (edited.rows[2] as (string | null)[])[totalColumn] = "0";
  (edited.rows[3] as (string | null)[])[totalColumn] = null;
  (edited.rows[4] as (string | null)[])[totalColumn] = "很多";
  await page.getByRole("button", { name: "换一个文件" }).first().click();
  await chooseFile(page, exported.name, writeSheet(edited));
  await expect(page.getByText("现在不能导入：有 1 行出错")).toBeVisible();
  await expect(page.getByText("只要有一行有问题，整份都不会写入。")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "只看有问题的" })).toBeChecked();
  const bad = page.locator(".import-table tbody tr");
  await expect(bad).toHaveCount(1);
  await expect(bad).toContainText("出错");
  await expect(bad.locator(".import-table__cell")).toHaveText(/^[A-Z]5$/);
  await expect(bad).toContainText("可售单数");
  await expect(page.getByText("另有 89 行没有问题，没有列出。")).toBeVisible();
  await expectNoHorizontalOverflow(page, "导入库存的检查结果");
  await expectAccessible(page, "导入库存的检查结果");
  await snapshot(page, "inventory-import-errors-desktop");

  // 改好再传：可以导入；各类行数；确认
  (edited.rows[4] as (string | null)[])[totalColumn] = "5";
  await page.getByRole("button", { name: "换一个文件" }).first().click();
  await expect(page.getByText(`上一次检查：${exported.name}，1 行出错。`)).toBeVisible();
  await chooseFile(page, exported.name, writeSheet(edited));
  await expect(page.getByText("检查通过，可以导入")).toBeVisible();
  await expect(page.getByText("会给 2 天设库存、清除 1 天，另有 87 天和现在一样，不动。", { exact: false })).toBeVisible();
  const counts = page.getByRole("group", { name: "各类行数" });
  await expect(counts.getByRole("button", { name: /设库存/ })).toContainText("2");
  await expect(counts.getByRole("button", { name: /清除/ })).toContainText("1");
  await counts.getByRole("button", { name: /清除/ }).click();
  await expect(page.locator(".import-table tbody tr")).toHaveCount(1);
  await expect(page.locator(".import-table tbody tr")).toContainText(`${addDays(now, 2)}`);
  await expect(page.locator(".import-table tbody tr")).toContainText("清除");

  // 检查之后商品被别人改了：不写入，重新检查
  const bump = await request.post(`/tenant/v1/products/${product.id}/inventory/batch-set`, { headers: { ...supplier.headers, "if-match": `"${await productVersion(request, supplier, product.id)}"` }, data: { from: addDays(now, 120), to: addDays(now, 120), weekdays: [], total: 3 } });
  expect(bump.status()).toBe(200);
  await page.getByRole("button", { name: "确认导入" }).click();
  const confirm = page.getByRole("dialog", { name: "确认导入？" });
  await expect(confirm).toContainText("会给 2 天设库存、清除 1 天。");
  await expect(confirm).toContainText("写入后不能一键撤销");
  await expect(confirm.getByRole("button", { name: "取消" })).toBeFocused();
  await confirm.getByRole("button", { name: "确认导入" }).click();
  await expect(page.getByText("检查之后，这个商品被别人修改过。请重新检查这份文件。")).toBeVisible();
  expect((await inventory(request, supplier, product.id, now, now)).days[0]?.total, "被拒时什么都没有写入").toBe(5);
  await page.getByRole("button", { name: "重新检查" }).click();
  await expect(page.getByText("检查通过，可以导入")).toBeVisible();
  await page.getByRole("button", { name: "确认导入" }).click();
  await confirm.getByRole("button", { name: "确认导入" }).click();
  await expect(page.getByText("已给 2 天设了库存、清除了 1 天，共变了 3 天。")).toBeVisible();
  await expect(page.locator(".import-steps [aria-current=step]")).toHaveText("3 完成");
  await page.getByRole("button", { name: "回到库存" }).click();

  // 日历和接口都变了
  await expect(page).toHaveURL(new RegExp(`/inventory\\?month=${now.slice(0, 7)}$`));
  await expect(dayCell(page, now)).toHaveAttribute("aria-label", /还剩 9 单，共 9 单/);
  const after = await inventory(request, supplier, product.id, now, addDays(now, 3));
  expect(after.days.map((day) => [day.total, day.status])).toEqual([[9, "open"], [0, "closed"], [null, "unset"], [5, "open"]]);
  if (addDays(now, 2).startsWith(now.slice(0, 7))) await expect(dayCell(page, addDays(now, 2))).toHaveAttribute("aria-label", /没设，卖不出去/);

  // 换了文件（和检查的不是同一份）：后端拒绝
  const preview = await request.post(`/tenant/v1/products/${product.id}/inventory/import/preview`, { headers: { ...supplier.headers, "content-type": "application/octet-stream" }, data: exported.bytes });
  expect(preview.status(), await preview.text()).toBe(200);
  const previewed = (await preview.json()) as { file_sha256: string; version: number };
  const swapped = await request.post(`/tenant/v1/products/${product.id}/inventory/import?file_sha256=${previewed.file_sha256}`, { headers: { ...supplier.headers, "content-type": "application/octet-stream", "if-match": `"${previewed.version}"`, "idempotency-key": crypto.randomUUID() }, data: writeSheet(edited) });
  expect(swapped.status()).toBe(409);
  expect(((await swapped.json()) as { error: { code: string } }).error.code).toBe("IMPORT_FILE_CHANGED");

  // 租户 B：导不出、检查不了、导不进
  const other = await createActiveTenant(request);
  const otherHeaders = { ...(await tenantHeaders(request, other.adminEmail, other.password)), "content-type": "application/octet-stream" };
  expect((await request.get(`/tenant/v1/products/${product.id}/inventory/export?from=${now}&to=${now}`, { headers: otherHeaders })).status(), "租户 B 导出库存").toBe(404);
  expect((await request.get(`/tenant/v1/products/${product.id}/price-rules/export`, { headers: otherHeaders })).status(), "租户 B 导出价格").toBe(404);
  expect((await request.post(`/tenant/v1/products/${product.id}/inventory/import/preview`, { headers: otherHeaders, data: exported.bytes })).status(), "租户 B 检查").toBe(404);
  expect((await request.post(`/tenant/v1/products/${product.id}/inventory/import?file_sha256=${previewed.file_sha256}`, { headers: { ...otherHeaders, "if-match": '"1"', "idempotency-key": crypto.randomUUID() }, data: exported.bytes })).status(), "租户 B 导入").toBe(404);
  expect((await request.get(`/tenant/v1/products/${product.id}/inventory?from=${now}&to=${now}`, { headers: otherHeaders })).status(), "租户 B 看库存").toBe(404);

  // 只读角色：只有导出，打不开导入页，日历上不能改
  const viewer = await createTenantUser(request, supplier.tenant, "readonly");
  await page.context().clearCookies();
  await page.evaluate(() => sessionStorage.clear());
  await loginAs(page, "tenant", viewer.email, viewer.password);
  await page.goto(`/products/${product.id}/inventory`);
  await expect(dayCell(page, now)).toHaveAttribute("aria-label", /还剩 9 单/);
  await expect(page.getByRole("button", { name: /改成/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "批量设置" })).toHaveCount(0);
  await dayCell(page, now).click();
  await expect(panel(page)).toContainText("还剩 9 单");
  await expect(panel(page).getByRole("button", { name: "保存" })).toHaveCount(0);
  await page.getByRole("button", { name: "导入 / 导出" }).click();
  await expect(page.getByRole("menuitem")).toHaveText(["导出库存…"]);
  await page.keyboard.press("Escape");
  await page.goto(`/products/${product.id}/inventory/import`);
  await expect(page.getByText("你没有权限查看这里")).toBeVisible();
  await page.goto(`/products/${product.id}/prices`);
  await page.getByRole("button", { name: "导入 / 导出" }).click();
  await expect(page.getByRole("menuitem")).toHaveText(["下载空白模版", "导出现有的价格（1 条）"]);
});

test("价格：导出 → 原样导入没变 → 改一行、加一行出错的、加一行冲突的：指到单元格和冲突的行 → 改好确认导入 → 价格表变了", async ({ page, request }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  const product = await readyProduct(request, supplier, world, "羽田机场接送");
  const now = await today(request, supplier, product.id);
  await fixedPrice(request, supplier, world, product.id, 20000, now);
  await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);
  await page.goto(`/products/${product.id}/prices`);

  await page.getByRole("button", { name: "导入 / 导出" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("menuitem", { name: "导出现有的价格（1 条）" }).click()]);
  const exported = await readDownload(download);
  const sheet = readSheet(exported.bytes);
  const at = (name: string): number => column(sheet, name);
  expect(sheet.rows.length).toBe(2);
  expect([sheet.rows[1]?.[at("区域")], sheet.rows[1]?.[at("基础价")], sheet.rows[1]?.[at("生效开始")]]).toEqual([supplier.area.name, "20000", now]);
  expect(JSON.stringify(sheet.rows)).not.toMatch(FORBIDDEN);
  const all = await request.get(`/tenant/v1/products/${product.id}/price-rules/export?rows=none`, { headers: supplier.headers });
  expect(readSheet(await all.body()).rows.length, "空白模版只有表头").toBe(1);

  await page.getByRole("button", { name: "导入 / 导出" }).click();
  await page.getByRole("menuitem", { name: "导入价格…" }).click();
  await expect(page).toHaveURL(/\/prices\/import$/);
  await expect(page.getByRole("heading", { level: 3, name: "导入价格" })).toBeVisible();
  await expect(page.getByText("金额是结算价，币种 JPY，只能填整数。")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "价格规则的分区" })).toHaveCount(0);

  // 本地先拦：不是 .xlsx 的不上传
  await page.locator("#import-file").setInputFiles({ name: "prices.csv", mimeType: "text/csv", buffer: Buffer.from("a,b") });
  await expect(page.getByText("只能导入 .xlsx 文件。「prices.csv」不是。", { exact: false })).toBeVisible();
  // 只是改了扩展名的：后端说它不是 .xlsx
  await chooseFile(page, "fake.xlsx", Buffer.from("这不是 Excel"));
  await expect(page.getByText("这不是一个 .xlsx 文件（可能只是改了扩展名）。", { exact: false })).toBeVisible();

  await chooseFile(page, exported.name, exported.bytes);
  await expect(page.locator(".alert__title", { hasText: "没有要导入的内容" })).toBeVisible();
  await expect(page.locator(".import-table tbody tr")).toContainText(`${supplier.area.name} · ${world.group.code} · 接送通用，JPY 20,000，${now} 起一直有效`);

  // 第 2 行改价；第 3 行同一个组合、日期重叠（冲突）；第 4 行金额带小数（出错）
  const origin = sheet.rows[1] as (string | null)[];
  const copy = (changes: Record<string, string | null>): (string | null)[] => {
    const row = [...origin];
    row[at("价格编号")] = null;
    for (const [name, value] of Object.entries(changes)) row[at(name)] = value;
    return row;
  };
  const changed = [...origin];
  changed[at("基础价")] = "21000";
  const broken = { ...sheet, rows: [sheet.rows[0] as (string | null)[], changed, copy({}), copy({ 方向: "接机", 基础价: "1000.5" })] };
  await page.getByRole("button", { name: "换一个文件" }).first().click();
  await chooseFile(page, exported.name, writeSheet(broken));
  await expect(page.getByText(/现在不能导入：有 1 行出错、\d 行冲突/)).toBeVisible();
  const rows = page.locator(".import-table tbody tr");
  const wrong = rows.filter({ hasText: "出错" });
  await expect(wrong).toHaveCount(1);
  await expect(wrong.getByRole("rowheader")).toContainText("4");
  await expect(wrong.locator(".import-table__cell")).toHaveText(/^[A-Z]+4$/);
  await expect(wrong).toContainText("基础价");
  await expect(rows.filter({ hasText: "冲突" }).first()).toContainText(/生效日期和第 [23] 行重叠|生效日期和已有的价格重叠/);
  await expect(page.getByRole("button", { name: "确认导入" })).toHaveAttribute("aria-disabled", "true");
  await expect(page.locator("#import-blocked")).toHaveText("先把有问题的行改好");
  await expectAccessible(page, "导入价格的检查结果");
  await snapshot(page, "prices-import-errors-desktop");
  await page.setViewportSize({ width: 320, height: 720 });
  await expectNoHorizontalOverflow(page, "导入价格的检查结果（手机）");
  await page.setViewportSize({ width: 1280, height: 800 });

  // 改好：一行修改、一行新增（单独的接机价）
  const fixed = { ...sheet, rows: [sheet.rows[0] as (string | null)[], changed, copy({ 方向: "接机", 基础价: "18000" })] };
  await page.getByRole("button", { name: "换一个文件" }).first().click();
  await chooseFile(page, exported.name, writeSheet(fixed));
  await expect(page.getByText("检查通过，可以导入")).toBeVisible();
  await expect(page.getByText("会新增 1 条、修改 1 条价格。", { exact: false })).toBeVisible();
  await expect(rows.filter({ hasText: "新增" })).toContainText(`${supplier.area.name} · ${world.group.code} · 接机，JPY 18,000`);
  await page.getByRole("button", { name: "确认导入" }).click();
  await page.getByRole("dialog", { name: "确认导入？" }).getByRole("button", { name: "确认导入" }).click();
  await expect(page.getByText("新增了 1 条、修改了 1 条价格。")).toBeVisible();
  await page.getByRole("button", { name: "回到价格规则" }).click();
  await expect(page).toHaveURL(/\/prices$/);
  await expect(page.getByLabel(`${supplier.area.name} · ${world.group.name} · 接送通用 的基础价`, { exact: true })).toHaveValue("21,000");
  await expect(page.getByLabel(`${supplier.area.name} · ${world.group.name} · 接机 的基础价`, { exact: true })).toHaveValue("18,000");
  const saved = (await (await request.get(`/tenant/v1/products/${product.id}/price-rules`, { headers: supplier.headers })).json()) as { items: { base_price: number; direction: string }[] };
  expect(saved.items.map((item) => [item.direction, item.base_price]).sort()).toEqual([["both", 21000], ["pickup", 18000]]);
  expect(await page.locator("body").innerText()).not.toMatch(FORBIDDEN);
});

test("限量但没设库存：切换后各处都提醒——提示条、步骤导航、上架检查、上架确认、首页和总览；键盘选一段日期批量设置；320px 和暗色", async ({ page, request }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  const world = await createWorld(request);
  const supplier = await createSupplier(request, world);
  const product = await readyProduct(request, supplier, world, "羽田机场接送");
  const now = await today(request, supplier, product.id);
  await fixedPrice(request, supplier, world, product.id, 20000, now);
  await loginAs(page, "tenant", supplier.tenant.adminEmail, supplier.tenant.password);
  await page.goto(`/products/${product.id}/inventory`);
  await page.getByRole("button", { name: "改成限量" }).click();
  await page.getByRole("dialog", { name: "改成限量？" }).getByRole("button", { name: "改成限量" }).click();
  await expect(toast(page, "已改成限量")).toBeVisible();
  await expect(page.getByText("从今天起没有一天有库存，这个商品现在卖不出去。")).toBeVisible();
  await expect(step(page, "库存")).toContainText("从今天起没有库存");
  await expect(page.getByText("已完成 4 / 5")).toBeVisible();
  await expect(dayCell(page, now)).toHaveAttribute("aria-label", /今天，没设，卖不出去/);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const width of [1280, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await expectNoHorizontalOverflow(page, `库存（没设，${width}px）`);
      await expectAccessible(page, `库存（没设，${width}px，${scheme}）`);
    }
  }
  await snapshot(page, "inventory-unset-mobile-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 1280, height: 800 });

  // 上架检查：不拦，但到处写着
  await step(page, "上架检查").click();
  await expect(page.getByText("可以上架了")).toBeVisible();
  await expect(page.getByText("另外，库存是限量的，但从今天起没有一天有库存，这个商品现在卖不出去（见下面「库存」一项）。", { exact: false })).toBeVisible();
  await expect(checkItem(page, "inventory")).toContainText("有 1 处要留意");
  await expect(checkItem(page, "inventory")).toContainText("库存是限量的，但从今天起没有一天有库存——上了架也卖不出去。");
  await page.getByRole("button", { name: "上架", exact: true }).click();
  const publish = page.getByRole("dialog", { name: "上架「羽田机场接送」？" });
  await expect(publish).toContainText("现在上架也卖不出去：库存是限量的，从今天起没有一天有库存。");
  await publish.getByRole("button", { name: "上架", exact: true }).click();
  await expect(toast(page, "已上架「羽田机场接送」")).toBeVisible();

  // 首页和总览
  await page.getByRole("navigation", { name: "主菜单" }).getByRole("link", { name: "首页" }).click();
  await page.getByRole("link", { name: "1 个已上架的商品从今天起没有库存" }).click();
  await expect(page).toHaveURL(/\/price-rules\?stock=none$/);
  const row = page.getByRole("row").filter({ has: page.getByRole("link", { name: "羽田机场接送", exact: true }) });
  await expect(row).toContainText("从今天起没有库存");
  await row.getByRole("link", { name: /的库存：限量，从今天起没有库存/ }).click();
  await expect(page).toHaveURL(/\/inventory$/);

  // 只用键盘：到月历，Shift + 方向键选三天，Tab 到「批量设置」，设 4 单
  const start = addDays(now, 1).startsWith(now.slice(0, 7)) && addDays(now, 3).startsWith(now.slice(0, 7)) ? now : `${addDays(`${now.slice(0, 7)}-28`, 4).slice(0, 7)}-01`;
  if (start !== now) await page.getByRole("button", { name: "下个月" }).click();
  await dayCell(page, start).focus();
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.locator(".calendar-bar")).toContainText(`已选 ${start} 至 ${addDays(start, 2)}，共 3 天`);
  await page.locator(".calendar-bar").getByRole("button", { name: "批量设置" }).focus();
  await page.keyboard.press("Enter");
  const batch = page.getByRole("dialog", { name: "批量设置库存" });
  await expect(batch.getByLabel("日期从")).toHaveValue(start);
  await expect(batch.getByLabel("日期到")).toHaveValue(addDays(start, 2));
  await batch.getByLabel("可售单数").focus();
  await page.keyboard.type("4");
  await page.keyboard.press("Enter");
  await expect(toast(page, "已设置 3 天的库存")).toBeVisible();
  await expect(dayCell(page, start)).toHaveAttribute("aria-label", /还剩 4 单，共 4 单/);
  await expect(page.getByText("从今天起没有一天有库存，这个商品现在卖不出去。")).toHaveCount(0);
  await expect(step(page, "库存")).toContainText("已完成 · 限量");

  // 停售 / 清除一批要再确认一次；改回不限量要确认
  await page.getByRole("button", { name: "批量设置" }).first().click();
  await batch.getByLabel("日期到").fill(addDays(now, 1));
  await batch.getByRole("radio", { name: /^停售/ }).check();
  await batch.getByRole("button", { name: "保存", exact: true }).click();
  await expect(batch.getByText("要改 2 天，确定吗？")).toBeVisible();
  await batch.getByRole("button", { name: "再看看" }).click();
  await batch.getByRole("button", { name: "取消" }).click();
  await page.getByRole("button", { name: "改成不限量" }).click();
  const unlimited = page.getByRole("dialog", { name: "改成不限量？" });
  await expect(unlimited).toContainText("你设好的每日库存会留着，但不起作用；以后改回限量时还在。");
  await expect(unlimited).toContainText("这个商品已上架，改完大约 1 分钟生效。");
  await expect(unlimited.getByRole("button", { name: "取消" })).toBeFocused();
  await unlimited.getByRole("button", { name: "改成不限量" }).click();
  await expect(toast(page, "已改成不限量")).toBeVisible();
  await expect(page.locator(".stock-mode")).toContainText("下面日历里设的数现在不起作用，改成限量后才生效。");
  expect((await inventory(request, supplier, product.id, start, start)).mode).toBe("unlimited");
  expect(await page.locator("body").innerText()).not.toMatch(FORBIDDEN);
});
