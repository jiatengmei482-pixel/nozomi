/**
 * M9P-13（规格第四节第 3 小节「区域编辑器建议」、ADR 0093 第七节「后续」；#247 审查建议）：真实浏览器 → 前端 → 真实 API → 真实 PostgreSQL
 * （底图是 global-setup 起的本机假瓦片服务）。供应商经接口建包车商品：①「市内」、③「郊外」（不重叠）。页面上：
 * 1. 区域详情「在哪些商品里用」：郊外在这个商品里当 ③；
 * 2. 在区域页把郊外画大到压住市内：当场提醒三层重叠（只是提醒），保存成功后留在页面列出（后端算的）；上架检查多一项提醒；
 * 3. 「在地图上看全部」：按这个商品筛选，三层重叠标红、写清楚；去掉 ③ 后不再标；
 * 4. 「从本区域减去另一个区域」：减去市内，提醒消失，保存后上架检查不再有重叠。亮色 / 暗色 axe。
 * 截图只在设置了 E2E_SCREENSHOT_DIR 时保存。
 */
import { type Page, expect, test } from "@playwright/test";
import { CENTER, createBrand, createProductByApi, createWorld, expectAccessible, post, tenantHeaders } from "./catalog.ts";
import { createActiveTenant, loginAs, randomLetters, snapshot } from "./support.ts";

type Ring = [number, number][];
const square = (west: number, south: number, size: number): Ring => [[west, south], [west + size, south], [west + size, south + size], [west, south + size]];
const closed = (ring: Ring): Ring => [...ring, ring[0] as [number, number]];
const wkt = (ring: Ring): string => `POLYGON((${closed(ring).map(([lng, lat]) => `${lng} ${lat}`).join(", ")}))`;

async function bothSchemes(page: Page, what: string, name: string): Promise<void> {
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `${what}（${scheme}）`);
    await snapshot(page, `${name}-${scheme}`);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

test("区域编辑器：区域详情显示在商品里当哪一层；改图形造出三层重叠只提醒；在地图上按商品和层看全部、重叠标红；从本区域减去另一个区域后重叠消失；亮暗 axe", async ({ page, request }) => {
  test.slow();
  await page.setViewportSize({ width: 1280, height: 900 });
  const world = await createWorld(request);
  const tenant = await createActiveTenant(request);
  const headers = await tenantHeaders(request, tenant.adminEmail, tenant.password);
  const brand = await createBrand(request, headers, `品牌 ${randomLetters(4)}`);
  const tag = randomLetters(4);
  const { lng, lat } = CENTER;
  const newArea = async (name: string, ring: Ring): Promise<{ id: string; name: string }> => {
    const created = await post<{ id: string }>(request, { ...headers, "idempotency-key": crypto.randomUUID() }, "/tenant/v1/areas", { city_id: world.city.id, name: { zh: name }, biz_type: "charter", polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [closed(ring)] } }] }, "新建区域");
    return { id: created.id, name };
  };
  // ① 市内：lng−0.1 … lng+0.1；③ 郊外：lng+0.15 … lng+0.25（不重叠，经接口能设上下车加价）
  const base = await newArea(`市内 ${tag}`, square(lng - 0.1, lat - 0.1, 0.2));
  const suburb = await newArea(`郊外 ${tag}`, square(lng + 0.15, lat - 0.1, 0.1));
  const product = await createProductByApi(request, { tenant, headers, brand, area: { id: base.id, code: "", name: base.name } }, world, "charter");
  const content = await request.put(`/tenant/v1/products/${product.id}/content`, { headers: { ...headers, "if-match": `"${product.version}"` }, data: { zh: { title: `三层包车 ${tag}` } } });
  expect(content.status(), await content.text()).toBe(200);
  const { today } = (await (await request.get(`/tenant/v1/products/${product.id}/price-rules`, { headers })).json()) as { today: string };
  const surcharge = await request.post(`/tenant/v1/products/${product.id}/price-rules`, {
    headers: { ...headers, "if-match": `"${((await content.json()) as { version: number }).version}"`, "idempotency-key": crypto.randomUUID() },
    data: { area_id: suburb.id, vehicle_group_id: world.group.id, package_hours: 8, pricing_model: "charter_area_surcharge", pickup_surcharge: 500, dropoff_surcharge: 1000, valid_from: today },
  });
  expect(surcharge.status(), await surcharge.text()).toBe(201);
  const label = `三层包车 ${tag}（${product.code}）`;
  const publishItems = async (): Promise<string[]> => ((await (await request.get(`/tenant/v1/products/${product.id}/publish-check`, { headers })).json()) as { items: { key: string }[] }).items.map((item) => item.key);
  expect(await publishItems()).not.toContain("charter_layer_overlap");

  await loginAs(page, "tenant", tenant.adminEmail, tenant.password);

  // 1. 区域详情：在哪些商品里用、当哪一层
  await page.goto(`/areas/${suburb.id}`);
  const usage = page.locator("section").filter({ has: page.getByRole("heading", { name: "在哪些商品里用" }) });
  const row = usage.getByRole("listitem").filter({ hasText: label });
  await expect(row).toContainText("③上下车加价");
  await expect(row.getByRole("link", { name: label })).toHaveAttribute("href", `/products/${product.id}`);
  await expect(page.locator(".area-map__overlay")).toBeVisible();
  await bothSchemes(page, "区域详情（在哪些商品里用）", "m9p13-usage");

  // 2. 郊外再加一块压住市内东边：当场提醒，只是提醒；保存成功，留在页面列出
  await page.getByRole("toolbar", { name: "绘制工具" }).getByRole("button", { name: "粘贴坐标" }).click();
  const paste = page.getByRole("dialog", { name: "粘贴坐标" });
  await paste.getByLabel(/内容/).fill(wkt(square(lng + 0.05, lat - 0.05, 0.12)));
  await paste.getByRole("button", { name: "添加到地图" }).click();
  await expect(paste).toBeHidden();
  const live = page.locator("[data-charter-overlaps]");
  await expect(live).toContainText("有 1 处三层区域重叠");
  await expect(live).toContainText(`「${label}」里和「${base.name}」① 基础价区域和 ③ 上下车加价区域，重叠约`);
  await expect(live).toContainText("只是提醒，可以保存");
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const saved = page.locator("[data-saved-overlaps]");
  await expect(saved).toContainText(`「${label}」里和「${base.name}」① 基础价区域和 ③ 上下车加价区域，重叠约`);
  await expect(page.getByText("已保存。用到这个区域的包车商品里有 1 处三层区域重叠")).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/areas/${suburb.id}$`));
  expect(await publishItems(), "上架检查多一项提醒").toContain("charter_layer_overlap");
  await snapshot(page, "m9p13-saved-overlap");

  // 3. 在地图上看全部：按商品筛选，重叠标红；去掉 ③ 后不标
  await usage.getByRole("link", { name: `在地图上看「${label}」的全部区域` }).click();
  await expect(page).toHaveURL(new RegExp(`/areas/map\\?product=${product.id}$`));
  await expect(page.getByRole("combobox", { name: "商品" })).toHaveValue(product.id);
  const list = page.getByRole("list", { name: "区域列表" });
  await expect(list.getByRole("listitem").filter({ hasText: suburb.name })).toContainText("③上下车加价");
  await expect(list.getByRole("listitem").filter({ hasText: base.name })).toContainText("①基础价");
  await expect(list.locator(`[data-conflict-note="${suburb.id}"]`)).toContainText(`和「${base.name}」① 基础价区域和 ③ 上下车加价区域，重叠约`);
  await expect(page.locator('.area-overview-map path[data-conflict="all"]')).toHaveCount(1);
  await expect(page.locator(".area-overview-map path[data-overlap]")).toHaveCount(0);
  await expect(page.getByRole("list", { name: "图例" })).toContainText("三层区域重叠");
  expect(await page.locator('.area-overview-map path[data-conflict="all"]').evaluate((node) => getComputedStyle(node).fill)).not.toBe("none");
  await bothSchemes(page, "区域地图（按商品和层）", "m9p13-map-conflict");
  await page.getByRole("checkbox", { name: "③ 上下车加价区域" }).uncheck();
  await expect(list.getByRole("listitem").filter({ hasText: suburb.name })).toHaveCount(0);
  await expect(page.locator(".area-overview-map path[data-conflict]")).toHaveCount(0);
  await page.getByRole("checkbox", { name: "③ 上下车加价区域" }).check();

  // 4. 从本区域减去另一个区域：减去市内，提醒消失；保存后回到列表，上架检查不再有重叠
  await page.goto(`/areas/${suburb.id}`);
  await expect(live).toContainText("有 1 处三层区域重叠");
  await page.getByRole("button", { name: "从本区域减去另一个区域" }).click();
  const dialog = page.getByRole("dialog", { name: "从本区域减去另一个区域" });
  await dialog.getByRole("combobox", { name: /要减去的区域/ }).click();
  await dialog.getByRole("combobox", { name: /要减去的区域/ }).fill(base.name);
  await dialog.getByRole("option", { name: new RegExp(base.name) }).click();
  await expect(dialog.locator("[data-subtract-preview]")).toContainText("会切掉约");
  await expect(dialog.locator("[data-subtract-preview]")).toContainText("碰到的 1 块营运区换成减完的 1 块");
  await bothSchemes(page, "从本区域减去另一个区域（对话框）", "m9p13-subtract-dialog");
  await dialog.getByRole("button", { name: "减去" }).click();
  await expect(dialog).toBeHidden();
  await expect(live).toHaveCount(0);
  await expect(page.locator(".toast").filter({ hasText: `已从本区域减去「${base.name}」` })).toBeVisible();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page).toHaveURL(/\/areas$/);
  expect(await publishItems(), "减完不再重叠").not.toContain("charter_layer_overlap");
  const after = (await (await request.get(`/tenant/v1/areas/${suburb.id}`, { headers })).json()) as { polygons: { kind: string; geometry: { coordinates: number[][][] } }[] };
  const westmost = Math.min(...after.polygons.flatMap((polygon) => (polygon.geometry.coordinates[0] ?? []).map((point) => point[0] as number)));
  expect(westmost, "减完的西边界是市内的东边界").toBeCloseTo(lng + 0.1, 6);
});
