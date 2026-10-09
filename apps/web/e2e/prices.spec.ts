/**
 * 供应商后台「价格规则与调价规则」（M1-04），真实后端、真实 PostgreSQL。
 * 主数据、供应商、商品的前两步和详情经接口准备好；价格、调价规则、上架都经界面做。
 * 金额的断言和 @nozomi/domain 的计算对照，不在测试里另写公式。
 */
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { type Supplier, type World, checkItem, createProductByApi, createSupplier, createWorld, step, toast } from "./catalog.ts";
import { expectNoHorizontalOverflow, loginAs, snapshot } from "./support.ts";

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
