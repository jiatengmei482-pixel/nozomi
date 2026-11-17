/**
 * M9P-07（规格第六节用例 14、15；ADR 0093 第一、七节）：真实浏览器 → 构建好的前端 → 真实 API → 真实 PostgreSQL。
 * 供应商经接口建包车商品：①「市内」（城市中心一带）、③「郊外甲」（东边，不和①重叠）、另画一个「郊外乙」（压住郊外甲，不和①重叠），
 * 8 小时套餐价按服务区域填、郊外甲设上下车加价；然后用迁移脚本（和部署时同一个函数，迁移账号）把这个商品迁到三层区域。页面上：
 * - 迁移过的价格页：套餐价按车型组 × 套餐一次填，旧的按区域套餐价折叠只读，「行程加价」「上下车加价」两张表；
 * - 用例 14：上下车加价里加上郊外乙并保存 → 被拦，写出两个区域名和重叠面积（平方公里），什么都没有保存；
 * - 用例 15：上下车加价的区域下拉里「市内」（基础价区域）灰掉；到第 ① 步把郊外甲加成服务区域并保存 → 被拦。
 * 亮色 axe。和别的用例不共用数据（本用例自己的供应商、区域、商品），--workers=1 也能跑。
 */
import { type APIRequestContext, expect, test } from "@playwright/test";
import { createPool } from "../../api/src/db/pool.ts";
import { runCharterThreeLayerMigration } from "../../api/src/services/charter-three-layer.ts";
import { CENTER, type Ref, createBrand, createProductByApi, createWorld, expectAccessible, post, tenantHeaders } from "./catalog.ts";
import { createActiveTenant, loginAs, randomLetters } from "./support.ts";

type Point = { lat: number; lng: number };
const square = (center: Point, half: number): number[][] => [
  [center.lng - half, center.lat - half],
  [center.lng + half, center.lat - half],
  [center.lng + half, center.lat + half],
  [center.lng - half, center.lat + half],
  [center.lng - half, center.lat - half],
];
const EMPTY_PRICE = { direction: null, start_price: null, start_meters: null, start_minutes: null, per_km: null, per_minute: null, min_price: null, base_price: null };

/** 用迁移脚本（部署时 charter-three-layer-cli.ts 调的同一个函数，表的所有者账号）只迁这一个商品。 */
async function migrate(productId: string): Promise<void> {
  const url = process.env["E2E_DATABASE_OWNER_URL"];
  if (!url) throw new Error("global-setup 没有准备好数据库连接");
  const pool = createPool(url, { max: 1 });
  try {
    await runCharterThreeLayerMigration(pool, { mode: "apply", productId, now: new Date() });
  } finally {
    await pool.end();
  }
}

interface Setup {
  tenant: { adminEmail: string; password: string };
  headers: Record<string, string>;
  productId: string;
  groupName: string;
  base: Ref;
  suburbA: Ref;
  suburbB: Ref;
}

async function setup(request: APIRequestContext): Promise<Setup> {
  const world = await createWorld(request);
  const tenant = await createActiveTenant(request);
  const headers = await tenantHeaders(request, tenant.adminEmail, tenant.password);
  const brand = await createBrand(request, headers, `品牌 ${randomLetters(4)}`);
  const tag = randomLetters(4);
  const area = async (name: string, at: Point, half: number): Promise<Ref> => {
    const made = await post<{ id: string }>(request, { ...headers, "idempotency-key": crypto.randomUUID() }, "/tenant/v1/areas", { city_id: world.city.id, name: { zh: name }, biz_type: "charter", polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [square(at, half)] } }] }, "新建区域");
    return { id: made.id, code: "", name };
  };
  const { lng, lat } = CENTER;
  // ① 市内：lng ± 0.05；③ 郊外甲：lng + 0.12 … + 0.20；郊外乙：lng + 0.16 … + 0.24（和郊外甲重叠约 0.04 × 0.08 度，不碰市内）
  const base = await area(`市内 ${tag}`, { lng, lat }, 0.05);
  const suburbA = await area(`郊外甲 ${tag}`, { lng: lng + 0.16, lat }, 0.04);
  const suburbB = await area(`郊外乙 ${tag}`, { lng: lng + 0.2, lat }, 0.04);
  const product = await createProductByApi(request, { tenant, headers, brand, area: base }, world, "charter");
  const content = await request.put(`/tenant/v1/products/${product.id}/content`, { headers: { ...headers, "if-match": `"${product.version}"` }, data: { zh: { title: `三层价格页 ${tag}` } } });
  expect(content.status(), await content.text()).toBe(200);
  const { today, version } = (await (await request.get(`/tenant/v1/products/${product.id}/price-rules`, { headers })).json()) as { today: string; version: number };
  const batch = await request.post(`/tenant/v1/products/${product.id}/price-rules/batch`, {
    headers: { ...headers, "if-match": `"${version}"`, "idempotency-key": crypto.randomUUID() },
    data: {
      create: [
        { ...EMPTY_PRICE, ref: "package", area_id: base.id, vehicle_group_id: world.group.id, package_hours: 8, pricing_model: "charter_package", package_km: 150, package_price: 55000, overtime_per_hour: 5000, over_km_per_km: 400, valid_from: today },
        { ...EMPTY_PRICE, ref: "updown", area_id: suburbA.id, vehicle_group_id: world.group.id, package_hours: 8, pricing_model: "charter_area_surcharge", package_km: null, package_price: null, overtime_per_hour: null, over_km_per_km: null, pickup_surcharge: 10000, dropoff_surcharge: 10000, valid_from: today },
      ],
      update: [],
      delete: [],
    },
  });
  expect(batch.status(), await batch.text()).toBe(200);
  await migrate(product.id);
  const layout = (await (await request.get(`/tenant/v1/products/${product.id}/price-rules`, { headers })).json()) as { charter_layout: string | null };
  expect(layout.charter_layout, "迁移脚本把商品切到了三层区域").toBe("three_layer");
  return { tenant, headers, productId: product.id, groupName: world.group.name, base, suburbA, suburbB };
}

test("M9P-07 用例 14：迁移过的包车价格页三张表；上下车加价里加一个和已有区域重叠的区域并保存 → 被拦，写出两个区域名和重叠面积", async ({ page, request }) => {
  test.slow();
  await page.setViewportSize({ width: 1280, height: 900 });
  const world = await setup(request);
  await loginAs(page, "tenant", world.tenant.adminEmail, world.tenant.password);
  await page.goto(`/products/${world.productId}/prices`);

  // 三张表：套餐价（整商品一次填，迁移脚本从「市内」复制）、行程加价、上下车加价；旧的按区域套餐价折叠只读
  await expect(page.getByRole("heading", { level: 3, name: /^套餐价（按车型组 × 套餐填一次/ })).toBeVisible();
  await expect(page.getByLabel(`${world.groupName} · 8 小时 的套餐价`)).toHaveValue("55,000");
  const legacy = page.locator("[data-legacy-packages]");
  await expect(legacy.locator("summary")).toHaveText("旧的按区域套餐价（只读，迁移前的数据）（1 条）");
  await expect(legacy.locator("input, button, select")).toHaveCount(0);
  const updown = page.locator('section[data-layer="charter_area_surcharge"]');
  await expect(updown.getByRole("heading", { level: 3, name: /^上下车加价/ })).toBeVisible();
  await expect(page.locator('section[data-layer="charter_itinerary_surcharge"]').getByRole("heading", { level: 3, name: /^行程加价/ })).toBeVisible();
  await expect(updown.getByLabel(`上下车加价 · ${world.suburbA.name} · ${world.groupName} · 8 小时 的上车加价`)).toHaveValue("10,000");
  await expectAccessible(page, "迁移过的包车价格页");

  // 加上郊外乙（压住郊外甲）→ 保存被拦
  const select = updown.getByLabel("选择要设上下车加价的区域");
  await select.selectOption({ label: world.suburbB.name });
  await updown.getByRole("button", { name: "确认添加" }).click();
  await updown.getByLabel(`上下车加价 · ${world.suburbB.name} · ${world.groupName} 的上车加价`).fill("3000");
  await updown.getByLabel(`上下车加价 · ${world.suburbB.name} · ${world.groupName} 的下车加价`).fill("3000");
  await expect(page.getByText("有 1 条未保存的修改")).toBeVisible();
  await page.getByRole("button", { name: "保存草稿" }).click();
  const pair = new RegExp(`「(${world.suburbA.name}|${world.suburbB.name})」和「(${world.suburbA.name}|${world.suburbB.name})」重叠约 [\\d.]+ 平方公里`);
  await expect(page.locator("#price-rejection")).toContainText(pair);
  await expect(updown.locator(".alert--danger")).toContainText(pair);
  await expect(updown.locator(`#layer-area-charter_area_surcharge-${world.suburbB.id}`)).toContainText("和别的区域重叠");

  // 什么都没有保存：库里没有郊外乙的上下车加价
  const after = (await (await request.get(`/tenant/v1/products/${world.productId}/price-rules`, { headers: world.headers })).json()) as { items: { area_id: string | null }[] };
  expect(after.items.some((item) => item.area_id === world.suburbB.id)).toBe(false);
});

test("M9P-07 用例 15：同一区域不能既是①又是③——上下车加价的下拉里基础价区域灰掉；到第 ① 步把有上下车加价的区域加成服务区域并保存 → 被拦", async ({ page, request }) => {
  test.slow();
  await page.setViewportSize({ width: 1280, height: 900 });
  const world = await setup(request);
  await loginAs(page, "tenant", world.tenant.adminEmail, world.tenant.password);
  await page.goto(`/products/${world.productId}/prices`);

  // 价格页：上下车加价的下拉里「市内」灰掉，写明是基础价区域；行程加价的下拉里能选
  const updown = page.locator('section[data-layer="charter_area_surcharge"]');
  const baseOption = updown.getByLabel("选择要设上下车加价的区域").locator("option", { hasText: world.base.name });
  await expect(baseOption).toHaveText(`${world.base.name}（基础价区域，不能设上下车加价）`);
  await expect(baseOption).toBeDisabled();
  const itineraryOption = page.locator('section[data-layer="charter_itinerary_surcharge"]').getByLabel("选择要设行程加价的区域").locator("option", { hasText: world.base.name });
  await expect(itineraryOption).toHaveText(world.base.name);
  await expect(itineraryOption).toBeEnabled();

  // 第 ① 步：把郊外甲（已有上下车加价）加成服务区域 → 保存被拦，商品的服务区域不变
  await page.goto(`/products/${world.productId}/basic`);
  await page.getByRole("button", { name: "添加区域", exact: true }).click();
  const panel = page.getByRole("group", { name: "添加区域" });
  await panel.getByRole("checkbox", { name: new RegExp(world.suburbA.name) }).check();
  await panel.getByRole("button", { name: "完成" }).click();
  await expect(page.locator("[data-area-pick]")).toHaveCount(2);
  await page.getByRole("button", { name: "保存草稿" }).click();
  await expect(page.getByText(/同一个区域不能既是基础价区域（服务区域）又设上下车加价/).first()).toBeVisible();
  const product = (await (await request.get(`/tenant/v1/products/${world.productId}`, { headers: world.headers })).json()) as { areas: { area_id: string }[] };
  expect(product.areas.map((entry) => entry.area_id)).toEqual([world.base.id]);
});
