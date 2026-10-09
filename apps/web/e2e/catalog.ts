/**
 * 商品、价格这几组端到端测试共用的准备步骤：平台这边的主数据（城市、机场、车型组、附加服务）经平台接口新建，
 * 供应商的子品牌、区域、商品经供应商接口新建。并行的用例共用一个库，所以每条用例用自己的城市和随机编码。
 */
import { AxeBuilder } from "@axe-core/playwright";
import { type APIRequestContext, type Locator, type Page, expect } from "@playwright/test";
import { createActiveTenant, newPassword, platformAdminHeaders, randomLetters, uniqueEmail } from "./support.ts";

export const CENTER = { lat: 35.6895, lng: 139.6917 };

export interface Ref {
  id: string;
  code: string;
  name: string;
}
export interface World {
  city: Ref;
  airport: Ref;
  group: Ref;
  seat: Ref;
  sign: Ref;
}

export async function post<T>(request: APIRequestContext, headers: Record<string, string>, path: string, data: unknown, what: string): Promise<T> {
  const response = await request.post(path, { headers, data });
  expect(response.status(), `${what}：${await response.text()}`).toBe(201);
  return (await response.json()) as T;
}

/** 平台这边的主数据：一个城市、城市下的一个机场、一个车型组（两个组合）、两个附加服务（按个、按次）。 */
export async function createWorld(request: APIRequestContext): Promise<World> {
  const headers = await platformAdminHeaders(request);
  const tag = randomLetters(5);
  const master = async (kind: string, data: { code: string; name: { zh: string } } & Record<string, unknown>): Promise<Ref> => ({ id: (await post<{ id: string }>(request, headers, `/platform/v1/master/${kind}`, data, `新建${kind}`)).id, code: data.code, name: data.name.zh });
  const city = await master("cities", { code: `CTY-JP-${tag}`, country_code: "JP", name: { zh: `商品城市${tag}` }, timezone: "Asia/Tokyo", center: CENTER });
  // 机场编码是三字码，全库唯一：并行的用例撞上了就换一个
  let airport: Ref | null = null;
  for (let attempt = 0; airport === null && attempt < 8; attempt += 1) {
    const code = `Z${randomLetters(2)}`;
    const response = await request.post("/platform/v1/master/places", { headers, data: { type: "airport", code, city_id: city.id, name: { zh: `商品机场${tag}` }, location: { lat: CENTER.lat - 0.1, lng: CENTER.lng + 0.1 }, flight_scope: "mixed" } });
    if (response.status() === 201) airport = { id: ((await response.json()) as { id: string }).id, code, name: `商品机场${tag}` };
    else expect(response.status(), `新建机场：${await response.text()}`).toBe(409);
  }
  if (airport === null) throw new Error("没有建出机场");
  const group = await master("vehicle-groups", { code: `VG-BIZ${tag}-7`, grade: "business", seats: 7, power: "fuel", name: { zh: `商务七座${tag}` }, sample_models: ["丰田埃尔法"], combos: [{ passengers: 6, luggage: 4 }, { passengers: 5, luggage: 5 }] });
  const all = ["airport_transfer", "point_to_point", "charter"];
  const seat = await master("addons", { code: `ADD-SEAT_${tag}`, categories: all, charge_unit: "per_item", name: { zh: `儿童座椅${tag}` }, description: {} });
  const sign = await master("addons", { code: `ADD-SIGN_${tag}`, categories: ["airport_transfer"], charge_unit: "per_order", name: { zh: `举牌接机${tag}` }, description: {} });
  return { city, airport, group, seat, sign };
}

export async function tenantHeaders(request: APIRequestContext, email: string, password: string): Promise<Record<string, string>> {
  const response = await request.post("/tenant/v1/auth/login", { data: { email, password } });
  expect(response.ok(), "供应商账号登录").toBe(true);
  return { authorization: `Bearer ${((await response.json()) as { access_token: string }).access_token}` };
}

export async function createArea(request: APIRequestContext, headers: Record<string, string>, city: Ref, name: string, bizType = "general"): Promise<Ref> {
  const ring = [
    [CENTER.lng - 0.1, CENTER.lat - 0.1],
    [CENTER.lng + 0.1, CENTER.lat - 0.1],
    [CENTER.lng + 0.1, CENTER.lat + 0.1],
    [CENTER.lng - 0.1, CENTER.lat + 0.1],
    [CENTER.lng - 0.1, CENTER.lat - 0.1],
  ];
  const area = await post<{ id: string }>(request, { ...headers, "idempotency-key": crypto.randomUUID() }, "/tenant/v1/areas", { city_id: city.id, name: { zh: name }, biz_type: bizType, polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [ring] } }] }, "新建区域");
  return { id: area.id, code: "", name };
}

export async function createBrand(request: APIRequestContext, headers: Record<string, string>, name: string, currency = "JPY"): Promise<Ref> {
  const brand = await post<{ id: string }>(request, { ...headers, "idempotency-key": crypto.randomUUID() }, "/tenant/v1/brands", { name, currency }, "新建子品牌");
  return { id: brand.id, code: currency, name };
}

export async function createTenantUser(request: APIRequestContext, admin: { adminEmail: string; password: string }, role: string): Promise<{ email: string; password: string }> {
  const headers = await tenantHeaders(request, admin.adminEmail, admin.password);
  const email = uniqueEmail(`tenant-${role}`);
  const invited = await post<{ invite: { token: string } }>(request, headers, "/tenant/v1/users", { email, name: "端到端测试子账号", role }, "邀请子账号");
  const password = newPassword();
  expect((await request.post("/tenant/v1/auth/accept-invite", { data: { token: invited.invite.token, password } })).ok(), "接受邀请").toBe(true);
  return { email, password };
}

export async function choose(page: Page, label: RegExp, text: string): Promise<void> {
  const box = page.getByRole("combobox", { name: label });
  await box.click();
  await box.fill(text);
  await page.getByRole("option", { name: new RegExp(text) }).first().click();
}

export async function pick(page: Page, button: string, option: string): Promise<void> {
  await page.getByRole("button", { name: button, exact: true }).click();
  const panel = page.getByRole("group", { name: button, exact: true });
  await panel.getByRole("checkbox", { name: new RegExp(option) }).check();
  await panel.getByRole("button", { name: "完成" }).click();
}

export const toast = (page: Page, text: string): Locator => page.locator(".toast").filter({ hasText: text });
export const step = (page: Page, name: string): Locator => page.getByRole("navigation", { name: "配置步骤" }).locator(".step-nav__item").filter({ hasText: name });
export const checkItem = (page: Page, key: string): Locator => page.locator(`[data-check="${key}"]`);
export const productIdOf = (page: Page): string => /\/products\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? "";

export async function expectAccessible(page: Page, what: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = results.violations.map((violation) => `${violation.id}: ${violation.help}（${violation.nodes.map((node) => node.target.join(" ")).join("；")}）`);
  expect(summary, `${what} 的无障碍问题`).toEqual([]);
}

/** 新建页：选好创建后不能改的几项。 */
export async function fillLocked(page: Page, world: World, category: "接送机" | "点对点" | "包车"): Promise<void> {
  await choose(page, /城市/, world.city.code);
  await page.getByRole("radio", { name: new RegExp(`^${category}`) }).check();
  if (category === "接送机") await choose(page, /接送点/, world.airport.code);
}


export interface Supplier {
  tenant: Awaited<ReturnType<typeof createActiveTenant>>;
  headers: Record<string, string>;
  brand: Ref;
  area: Ref;
}

/** 一个配好子品牌和一个通用区域的供应商。 */
export async function createSupplier(request: APIRequestContext, world: World): Promise<Supplier> {
  const tenant = await createActiveTenant(request);
  const headers = await tenantHeaders(request, tenant.adminEmail, tenant.password);
  const brand = await createBrand(request, headers, `品牌 ${randomLetters(4)}`);
  const area = await createArea(request, headers, world.city, `通用区域 ${randomLetters(4)}`);
  return { tenant, headers, brand, area };
}

export async function createProductByApi(request: APIRequestContext, supplier: Supplier, world: World, category: "airport_transfer" | "point_to_point" | "charter", complete = true): Promise<{ id: string; version: number; code: string }> {
  return post(
    request,
    { ...supplier.headers, "idempotency-key": crypto.randomUUID() },
    "/tenant/v1/products",
    {
      brand_id: supplier.brand.id,
      city_id: world.city.id,
      category,
      ...(category === "airport_transfer" ? { poi_id: world.airport.id } : {}),
      ...(complete ? { areas: [{ area_id: supplier.area.id }], vehicle_groups: [{ vehicle_group_id: world.group.id, passengers: 6, luggage: 4 }], dispatchers: [{ name: "山田", phone: "+81 90 1234 5678" }] } : {}),
    },
    "接口新建商品",
  );
}
