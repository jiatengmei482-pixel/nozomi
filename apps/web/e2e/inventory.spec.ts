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
