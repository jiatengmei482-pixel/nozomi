/**
 * 新预订页包车的端到端准备（M8-19 起 site-booking-charter.spec.ts 用；M8-37b 手机地址栏的用例也用）：
 * 本用例自己建一个城市（中心随机落在九州一带，离别的用例在东京的城市很远，包车按上车地点找城市只会找到它），
 * 供应商经接口建两个区域：商品区域（城市中心一带）和一个加价区域（东边约 15 公里），上架包车商品：
 * 8 小时套餐 70,000 日元（对外 77,000），加价区域上车加 500、下车加 1,000；平台在加价区域里建一个车站。
 */
import { type APIRequestContext, expect } from "@playwright/test";
import { type Ref, createBrand, createProductByApi, createWorld, post, tenantHeaders } from "./catalog.ts";
import { createActiveTenant, platformAdminHeaders, randomLetters } from "./support.ts";

const RULES = {
  booking: { sale_from: null, sale_to: null, service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 0, note: null },
  urgent: { enabled: false, daily_quota: null, tiers: [] },
  night: { enabled: false, window: null, amount: null, charge_unit: null },
  free_wait: { pickup: null, dropoff: null, general: { mode: "limited", minutes: 0 } },
  addons: [],
  driver_languages: [],
};
const EMPTY_PRICE = { direction: null, package_hours: null, start_price: null, start_meters: null, start_minutes: null, per_km: null, per_minute: null, min_price: null, package_km: null, package_price: null, overtime_per_hour: null, over_km_per_km: null, base_price: null };

export type Point = { lat: number; lng: number };
const offset = (point: Point, lat: number, lng: number): Point => ({ lat: Number((point.lat + lat).toFixed(6)), lng: Number((point.lng + lng).toFixed(6)) });
const square = (center: Point, half: number): number[][] => [
  [center.lng - half, center.lat - half],
  [center.lng + half, center.lat - half],
  [center.lng + half, center.lat + half],
  [center.lng - half, center.lat + half],
  [center.lng - half, center.lat - half],
];
export const linkPoint = (key: "from" | "to", point: Point, name: string): string => `${key}=${point.lat},${point.lng}&${key}_name=${encodeURIComponent(name)}`;

export interface CharterWorld {
  /** 本用例建的城市（M9W-02：经停点用例在里面再建几个车站） */
  cityId: string;
  center: Point;
  /** 商品区域里的上车点、下车点 */
  pickup: Point;
  nearby: Point;
  /** 加价区域里的车站 */
  station: { name: string; location: Point };
  /** 哪个区域都不在 */
  nowhere: Point;
  groupName: string;
}

async function version(request: APIRequestContext, headers: Record<string, string>, id: string): Promise<number> {
  return ((await (await request.get(`/tenant/v1/products/${id}`, { headers })).json()) as { version: number }).version;
}

/** 平台建城市和车站；供应商建两个区域、上架包车商品（套餐价 + 加价区域的区域加价）。 */
export async function charterWorld(request: APIRequestContext): Promise<CharterWorld> {
  const world = await createWorld(request);
  const admin = await platformAdminHeaders(request);
  const tag = randomLetters(5);
  const center = { lat: Number((33.2 + Math.random() * 0.6).toFixed(6)), lng: Number((130.3 + Math.random() * 0.5).toFixed(6)) };
  const city = await post<{ id: string }>(request, admin, "/platform/v1/master/cities", { code: `CTY-JP-${tag}`, country_code: "JP", name: { zh: `包车城市${tag}` }, timezone: "Asia/Tokyo", center }, "新建城市");
  const cityRef: Ref = { id: city.id, code: `CTY-JP-${tag}`, name: `包车城市${tag}` };
  const surchargeCenter = offset(center, 0, 0.16);
  const station = { name: `加价站${tag}`, location: offset(surchargeCenter, 0.005, 0.005) };
  const placed = await request.post("/platform/v1/master/places", { headers: admin, data: { type: "station", code: `STN-JP-${randomLetters(6)}`, city_id: city.id, category: "rail", name: { zh: station.name }, location: station.location } });
  expect(placed.status(), await placed.text()).toBe(201);

  const tenant = await createActiveTenant(request);
  const headers = await tenantHeaders(request, tenant.adminEmail, tenant.password);
  const brand = await createBrand(request, headers, `品牌 ${randomLetters(4)}`);
  const area = async (name: string, at: Point, half: number): Promise<Ref> => {
    const created = await post<{ id: string }>(request, { ...headers, "idempotency-key": crypto.randomUUID() }, "/tenant/v1/areas", { city_id: city.id, name: { zh: name }, biz_type: "charter", polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [square(at, half)] } }] }, "新建区域");
    return { id: created.id, code: "", name };
  };
  const productArea = await area(`包车区域 ${tag}`, center, 0.05);
  const surchargeArea = await area(`加价区域 ${tag}`, surchargeCenter, 0.04);
  const supplier = { tenant, headers, brand, area: productArea };
  const product = await createProductByApi(request, supplier, { ...world, city: cityRef }, "charter");
  const rules = await request.put(`/tenant/v1/products/${product.id}/service-rules`, { headers: { ...headers, "if-match": `"${product.version}"` }, data: RULES });
  expect(rules.status(), await rules.text()).toBe(200);
  const content = await request.put(`/tenant/v1/products/${product.id}/content`, { headers: { ...headers, "if-match": `"${((await rules.json()) as { version: number }).version}"` }, data: { zh: { title: "区域加价包车" } } });
  expect(content.status(), await content.text()).toBe(200);
  const { today } = (await (await request.get(`/tenant/v1/products/${product.id}/price-rules`, { headers })).json()) as { today: string };
  const prices = [
    { ...EMPTY_PRICE, area_id: productArea.id, vehicle_group_id: world.group.id, package_hours: 8, pricing_model: "charter_package", package_km: 150, package_price: 70000, overtime_per_hour: 5000, over_km_per_km: 400, valid_from: today },
    { area_id: surchargeArea.id, vehicle_group_id: world.group.id, package_hours: 8, pricing_model: "charter_area_surcharge", pickup_surcharge: 500, dropoff_surcharge: 1000, valid_from: today },
  ];
  for (const price of prices) {
    const created = await request.post(`/tenant/v1/products/${product.id}/price-rules`, { headers: { ...headers, "if-match": `"${await version(request, headers, product.id)}"`, "idempotency-key": crypto.randomUUID() }, data: price });
    expect(created.status(), await created.text()).toBe(201);
  }
  const published = await request.post(`/tenant/v1/products/${product.id}/publish`, { headers });
  expect(published.status(), await published.text()).toBe(200);
  return { cityId: city.id, center, pickup: offset(center, 0.01, 0.01), nearby: offset(center, -0.02, 0.02), station, nowhere: offset(center, 0.4, 0.4), groupName: world.group.name };
}
