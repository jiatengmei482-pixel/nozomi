/**
 * 端到端：供应商后台的包车机场套餐（M9P-22，ADR 0098 第三节第 2、3、8 小节）。真实浏览器 → 构建好的前端 → 真实 API → 真实 PostgreSQL。
 * 准备见 charter-airport-support.ts（迁移过三层区域的包车商品，8 小时整商品套餐价 70,000；机场在①里，绑成机场开始、机场结束）。
 * - 第 ① 步「机场套餐」：两组各一行，显示绑定的机场、机场区域、简称；改简称保存（整组替换，版本号加一），刷新后还在；
 * - 价格页第四张表「机场套餐价」：在三张表之后；空格灰字「继承 70,000」（机场在①里 = 普通价）；填 80,000 → 标黄「高于继承价 70,000」；
 *   和价格表一起保存，库里多一条 charter_airport_package（机场区域、方向 pickup、8 小时、80,000）；刷新后照样标黄。亮色 axe。
 */
import { expect, test } from "@playwright/test";
import { expectAccessible, tenantHeaders } from "./catalog.ts";
import { charterAirportWorld } from "./charter-airport-support.ts";
import { loginAs } from "./support.ts";

test("M9P-22 供应商后台：第 ① 步「机场套餐」改简称保存；价格页第四张表空格灰字显示继承价，填得比继承价高标黄，保存成机场套餐价", async ({ page, request }) => {
  test.setTimeout(180_000);
  const trip = await charterAirportWorld(request);
  const headers = await tenantHeaders(request, trip.tenant.adminEmail, trip.tenant.password);
  await page.setViewportSize({ width: 1280, height: 900 });
  await loginAs(page, "tenant", trip.tenant.adminEmail, trip.tenant.password);

  // 第 ① 步「机场套餐」
  await page.goto(`/products/${trip.productId}/basic`);
  const card = page.locator("section[data-charter-airports]");
  await expect(card.getByRole("heading", { level: 2, name: "机场套餐" })).toBeVisible();
  const start = card.getByRole("group", { name: /^机场开始/ });
  await expect(start.getByLabel("机场开始第 1 个机场的中文简称（选填）")).toHaveValue(trip.shortName);
  await expect(card.getByRole("group", { name: /^机场结束/ }).getByLabel("机场结束第 1 个机场的中文简称（选填）")).toHaveValue(trip.shortName);
  await expectAccessible(page, "商品页「机场套餐」");
  const renamed = `${trip.shortName}T`;
  await start.getByLabel("机场开始第 1 个机场的中文简称（选填）").fill(renamed);
  await card.getByRole("button", { name: "保存机场套餐" }).click();
  await expect(card.getByText("机场套餐已保存")).toBeVisible();
  const saved = (await (await request.get(`/tenant/v1/products/${trip.productId}/charter-airports`, { headers })).json()) as { bindings: { scenario: string; short_name_zh: string | null; area_id: string }[] };
  // 接口按场景排序（airport_end 在 airport_start 前）
  expect(saved.bindings.map((binding) => [binding.scenario, binding.short_name_zh])).toEqual([
    ["airport_end", trip.shortName],
    ["airport_start", renamed],
  ]);
  const airportArea = saved.bindings.find((binding) => binding.scenario === "airport_start")?.area_id ?? "";

  // 价格页第四张表
  await page.goto(`/products/${trip.productId}/prices`);
  const table = page.locator('section[data-layer="charter_airport_package"]');
  await expect(table.getByRole("heading", { level: 3, name: "机场套餐价" })).toBeVisible();
  const updown = page.locator('section[data-layer="charter_area_surcharge"]');
  expect(await updown.evaluate((node, other) => Boolean(node.compareDocumentPosition(other as Node) & Node.DOCUMENT_POSITION_FOLLOWING), await table.elementHandle())).toBe(true);
  const cell = table.getByLabel(`机场开始 · ${renamed} · ${trip.groupName} · 8 小时 的单独价`);
  await expect(cell).toHaveAttribute("placeholder", "继承 70,000");
  await expect(cell.locator("xpath=ancestor::td")).toContainText("继承：普通 70,000");
  await expectAccessible(page, "价格页第四张表");
  await cell.fill("80000");
  await cell.blur();
  await expect(cell.locator("xpath=ancestor::td")).toHaveAttribute("data-warn", "true");
  await expect(cell.locator("xpath=ancestor::td")).toContainText("高于继承价 70,000");
  // 商品已上架：这一步的保存按钮叫「保存」
  await page.locator(".step__bar").getByRole("button", { name: "保存", exact: true }).click();
  await expect.poll(async () => {
    const prices = (await (await request.get(`/tenant/v1/products/${trip.productId}/price-rules`, { headers })).json()) as { items: { pricing_model: string; area_id: string; direction: string | null; package_hours: number | null; package_price: number | null }[] };
    return prices.items.filter((item) => item.pricing_model === "charter_airport_package").map((item) => [item.area_id, item.direction, item.package_hours, item.package_price]);
  }).toEqual([[airportArea, "pickup", 8, 80000]]);

  await page.reload();
  const again = page.locator('section[data-layer="charter_airport_package"]').getByLabel(`机场开始 · ${renamed} · ${trip.groupName} · 8 小时 的单独价`);
  await expect(again).toHaveValue("80,000");
  await expect(again.locator("xpath=ancestor::td")).toHaveAttribute("data-warn", "true");
});
