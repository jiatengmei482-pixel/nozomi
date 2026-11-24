/**
 * 预订页（M8-03、M8-04 的新流程，M8-05 起在 `/book`）端到端用例共用的准备和检查（M8-10 的路线小地图用例也用）：
 * 本用例专用的机场、上架接送机商品、本用例专用的点对点城市（M8-05）、链接参数、路线折线、窄屏和亮暗 axe、Leaflet 路线图真的画出了线。
 */
import { type APIRequestContext, type Page, expect } from "@playwright/test";
import { CENTER, type Ref, type Supplier, type World, createBrand, createProductByApi, createWorld, expectAccessible, post, tenantHeaders } from "./catalog.ts";
import { createTestCity, createActiveTenant, platformAdminHeaders, randomLetters } from "./support.ts";

const RULES = {
  booking: { sale_from: null, sale_to: null, service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 0, note: null },
  urgent: { enabled: false, daily_quota: null, tiers: [] },
  night: { enabled: false, window: null, amount: null, charge_unit: null },
  free_wait: { pickup: { mode: "limited", minutes: 60 }, dropoff: { mode: "limited", minutes: 15 }, general: null },
  addons: [],
  driver_languages: [],
};
const EMPTY_PRICE = { package_hours: null, start_price: null, start_meters: null, start_minutes: null, per_km: null, per_minute: null, min_price: null, package_km: null, package_price: null, overtime_per_hour: null, over_km_per_km: null };
/**
 * 本用例自己的点对点城市（M8-05：旧询价页按选的城市报价，预订页按两个坐标报价）。按两个坐标报点对点时，页面按出发地找「中心最近」的城市
 * （`serviceCityOf`）；catalog.ts 建的城市中心都在 `CENTER`，出发地在那一带时报价会落到别的用例的城市（中心一样，按编号取第一个）。
 * 所以城市中心在东北地方 2 × 1.5 度里随机（离东京、离别的用例的随机城市——九州、四国、冲绳、北海道——都远），出发地就放在城市中心：
 * 距离是 0，只有中心完全相同的城市抢得走。供应商的通用区域是中心 ±0.1 度，上架点对点商品（`price` 是价格规则里除区域、车型组、生效日以外的项）。
 * 返回的 `world.city` 是这个城市（车型组、附加服务仍是 `createWorld` 建的）。
 */
export async function pointToPointCity(request: APIRequestContext, price: Record<string, unknown>): Promise<{ world: World; supplier: Supplier; center: { lat: number; lng: number } }> {
  const base = await createWorld(request);
  const center = { lat: Number((38.5 + Math.random() * 2.0).toFixed(6)), lng: Number((140.0 + Math.random() * 1.5).toFixed(6)) };
  const { tag, ...city } = await createTestCity(request, await platformAdminHeaders(request), (tag) => ({ name: { zh: `点对点城市${tag}` }, timezone: "Asia/Tokyo", center }));
  const world: World = { ...base, city };
  const tenant = await createActiveTenant(request);
  const headers = await tenantHeaders(request, tenant.adminEmail, tenant.password);
  const brand = await createBrand(request, headers, `品牌 ${randomLetters(4)}`);
  const ring = [
    [center.lng - 0.1, center.lat - 0.1],
    [center.lng + 0.1, center.lat - 0.1],
    [center.lng + 0.1, center.lat + 0.1],
    [center.lng - 0.1, center.lat + 0.1],
    [center.lng - 0.1, center.lat - 0.1],
  ];
  const areaName = `通用区域 ${randomLetters(4)}`;
  const area = await post<{ id: string }>(request, { ...headers, "idempotency-key": crypto.randomUUID() }, "/tenant/v1/areas", { city_id: world.city.id, name: { zh: areaName }, biz_type: "general", polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [ring] } }] }, "新建区域");
  const supplier: Supplier = { tenant, headers, brand, area: { id: area.id, code: "", name: areaName } };
  const product = await createProductByApi(request, supplier, world, "point_to_point");
  const rules = await request.put(`/tenant/v1/products/${product.id}/service-rules`, { headers: { ...headers, "if-match": `"${product.version}"` }, data: { ...RULES, free_wait: { pickup: null, dropoff: null, general: { mode: "limited", minutes: 30 } } } });
  expect(rules.status(), await rules.text()).toBe(200);
  const content = await request.put(`/tenant/v1/products/${product.id}/content`, { headers: { ...headers, "if-match": `"${((await rules.json()) as { version: number }).version}"` }, data: { zh: { title: "官网市内用车" } } });
  expect(content.status(), await content.text()).toBe(200);
  const { today } = (await (await request.get(`/tenant/v1/products/${product.id}/price-rules`, { headers })).json()) as { today: string };
  const batch = await request.post(`/tenant/v1/products/${product.id}/price-rules/batch`, {
    headers: { ...headers, "if-match": `"${((await content.json()) as { version: number }).version}"`, "idempotency-key": crypto.randomUUID() },
    data: { create: [{ ...EMPTY_PRICE, base_price: null, ref: "a", area_id: area.id, vehicle_group_id: world.group.id, direction: null, valid_from: today, valid_to: null, status: "enabled", ...price }], update: [], delete: [] },
  });
  expect(batch.status(), await batch.text()).toBe(200);
  const published = await request.post(`/tenant/v1/products/${product.id}/publish`, { headers });
  expect(published.status(), await published.text()).toBe(200);
  return { world, supplier, center };
}

/** 东京站：假 Place Details 给的坐标（在供应商的区域里，离本用例的机场十几公里） */
export const TOKYO_STATION = { lat: 35.6812, lng: 139.7671 };

/** 本用例自己的机场：城市中心西南 4–6 公里的随机一点（别的用例的机场在中心东南约 14 公里，不会在 3 公里内撞上）。 */
export async function createAirport(request: APIRequestContext, world: World): Promise<Ref & { location: { lat: number; lng: number } }> {
  const headers = await platformAdminHeaders(request);
  const tag = randomLetters(5);
  const location = { lat: Number((CENTER.lat - 0.04 - Math.random() * 0.02).toFixed(6)), lng: Number((CENTER.lng - 0.04 - Math.random() * 0.02).toFixed(6)) };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = `Y${randomLetters(2)}`;
    const response = await request.post("/platform/v1/master/places", { headers, data: { type: "airport", code, city_id: world.city.id, name: { zh: `新预订机场${tag}` }, location, flight_scope: "mixed" } });
    if (response.status() === 201) return { id: ((await response.json()) as { id: string }).id, code, name: `新预订机场${tag}`, location };
    expect(response.status(), `新建机场：${await response.text()}`).toBe(409);
  }
  throw new Error("没有建出机场");
}

/** 上架接送机商品；`seat` 给了时商品提供这项附加服务（每件 1,000 日元）。 */
export async function publishTransfer(request: APIRequestContext, supplier: Supplier, world: World, seat: Ref | null = null): Promise<void> {
  const product = await createProductByApi(request, supplier, world, "airport_transfer");
  const rules = await request.put(`/tenant/v1/products/${product.id}/service-rules`, { headers: { ...supplier.headers, "if-match": `"${product.version}"` }, data: { ...RULES, addons: seat === null ? [] : [{ addon_id: seat.id, enabled: true, unit_price: 1000, first_free: false }] } });
  expect(rules.status(), await rules.text()).toBe(200);
  const content = await request.put(`/tenant/v1/products/${product.id}/content`, { headers: { ...supplier.headers, "if-match": `"${((await rules.json()) as { version: number }).version}"` }, data: { zh: { title: "新预订页接送机", pickup_guide: "到达大厅 1 号出口" } } });
  expect(content.status(), await content.text()).toBe(200);
  const { today } = (await (await request.get(`/tenant/v1/products/${product.id}/price-rules`, { headers: supplier.headers })).json()) as { today: string };
  const version = ((await (await request.get(`/tenant/v1/products/${product.id}`, { headers: supplier.headers })).json()) as { version: number }).version;
  const price = await request.post(`/tenant/v1/products/${product.id}/price-rules/batch`, {
    headers: { ...supplier.headers, "if-match": `"${version}"`, "idempotency-key": crypto.randomUUID() },
    data: { create: [{ ...EMPTY_PRICE, ref: "a", area_id: supplier.area.id, vehicle_group_id: world.group.id, direction: "both", pricing_model: "fixed", base_price: 20000, valid_from: today, valid_to: null, status: "enabled" }], update: [], delete: [] },
  });
  expect(price.status(), await price.text()).toBe(200);
  const published = await request.post(`/tenant/v1/products/${product.id}/publish`, { headers: supplier.headers });
  expect(published.status(), await published.text()).toBe(200);
}

/**
 * 链接里的出发地写成机场的坐标加名称（离机场 0 米，按两个坐标报价认得出是接机）。
 * 另一种写法 `from=机场编码` 走 `GET /site/v1/places/by-code`（M8-04 验收问题 1），在单页用例里覆盖。
 */
export function airportLink(airport: { name: string; location: { lat: number; lng: number } }): string {
  return `from=${airport.location.lat},${airport.location.lng}&from_name=${encodeURIComponent(airport.name)}`;
}

/** 谷歌 encoded polyline 的写法（只用来构造路线图的检查数据）。 */
export function encodePolyline(points: readonly { lat: number; lng: number }[]): string {
  let last = { lat: 0, lng: 0 };
  let out = "";
  const encode = (value: number): void => {
    let rest = value < 0 ? ~(value << 1) : value << 1;
    while (rest >= 0x20) {
      out += String.fromCharCode((0x20 | (rest & 0x1f)) + 63);
      rest >>= 5;
    }
    out += String.fromCharCode(rest + 63);
  };
  for (const point of points) {
    const lat = Math.round(point.lat * 1e5);
    const lng = Math.round(point.lng * 1e5);
    encode(lat - last.lat);
    encode(lng - last.lng);
    last = { lat, lng };
  }
  return out;
}

export function tomorrowInTokyo(): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(Date.now() + 24 * 3_600_000)).map((part) => [part.type, part.value]));
  return `${parts["year"]}-${parts["month"]}-${parts["day"]}`;
}

/** 320 / 360 / 400 不横向滚动（都是手机分步，不跨过 1024），亮暗两色 axe。 */
export async function expectNarrowAndAccessible(page: Page, what: string): Promise<void> {
  const viewport = page.viewportSize() ?? { width: 400, height: 800 };
  for (const size of [{ width: 320, height: 640 }, { width: 360, height: 740 }, { width: 400, height: 800 }]) {
    await page.setViewportSize(size);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${what}：${size.width}px 宽横向溢出`).toBe(0);
  }
  await page.setViewportSize(viewport);
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAccessible(page, `${what}（${scheme === "light" ? "亮色" : "暗色"}）`);
  }
  await page.emulateMedia({ colorScheme: "light" });
}

