/**
 * 包车机场套餐（M9P-22，ADR 0098）的端到端准备：在 charterWorld（本用例自己的城市、上架的包车商品）上
 * - 用迁移脚本（部署时同一个函数，表的所有者账号）把商品迁到三层区域（机场绑定只给迁移过的商品）；
 * - 平台在商品区域（①）里建一个机场和它的一个航站楼；
 * - 供应商画一块只包住机场和航站楼的机场区域（接送机类型，落在①里，满足「被①∪③完全覆盖」），把机场绑成「机场开始」「机场结束」，填中文简称。
 * 机场在①里：继承时 = 普通套餐价（没有加价），套餐行写「{简称}接机 + 8 小时包车」「8 小时包车 + {简称}送机」。
 */
import { type APIRequestContext, expect } from "@playwright/test";
import { createPool } from "../../api/src/db/pool.ts";
import { runCharterThreeLayerMigration } from "../../api/src/services/charter-three-layer.ts";
import { post, tenantHeaders } from "./catalog.ts";
import { type CharterWorld, type Point, charterWorld } from "./charter-support.ts";
import { platformAdminHeaders, randomLetters } from "./support.ts";

const offset = (point: Point, lat: number, lng: number): Point => ({ lat: Number((point.lat + lat).toFixed(6)), lng: Number((point.lng + lng).toFixed(6)) });
const square = (center: Point, half: number): number[][] => [
  [center.lng - half, center.lat - half],
  [center.lng + half, center.lat - half],
  [center.lng + half, center.lat + half],
  [center.lng - half, center.lat + half],
  [center.lng - half, center.lat - half],
];

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

export interface CharterAirportWorld extends CharterWorld {
  /** 绑定上填的中文简称（前台名称、快捷入口里的机场名） */
  shortName: string;
  airport: Point;
  terminal: Point;
  /** 主数据里机场的中文名（快捷入口在地址搜索里输入它，平台的机场排在候选前面，业主 2026-11-19） */
  airportName: string;
  /** 认出航站楼时的写法：「{主数据中文名} 第 1 航站楼」（航站楼离机场坐标约 280 米，在 500 米以内） */
  terminalLabel: string;
}

export async function charterAirportWorld(request: APIRequestContext): Promise<CharterAirportWorld> {
  const trip = await charterWorld(request);
  await migrate(trip.productId);
  const headers = await tenantHeaders(request, trip.tenant.adminEmail, trip.tenant.password);
  const layout = (await (await request.get(`/tenant/v1/products/${trip.productId}/price-rules`, { headers })).json()) as { charter_layout: string | null };
  expect(layout.charter_layout, "迁移脚本把商品切到了三层区域").toBe("three_layer");

  const admin = await platformAdminHeaders(request);
  const tag = randomLetters(5);
  // 机场在商品区域（中心 ± 0.05 度）里，离上车点（城市中心）约 1.5 公里
  const airportAt = offset(trip.center, 0.01, -0.01);
  const terminalAt = offset(airportAt, 0.002, 0.002);
  let airportId = "";
  let code = "";
  for (let attempt = 0; attempt < 8 && airportId === ""; attempt += 1) {
    code = `Q${randomLetters(2)}`;
    const made = await request.post("/platform/v1/master/places", { headers: admin, data: { type: "airport", code, city_id: trip.cityId, name: { zh: `快捷入口机场${tag}` }, location: airportAt, flight_scope: "mixed" } });
    if (made.status() === 201) airportId = ((await made.json()) as { id: string }).id;
    else expect(made.status(), `新建机场：${await made.text()}`).toBe(409);
  }
  expect(airportId, "建出了机场").not.toBe("");
  const terminal = await request.post("/platform/v1/master/places", { headers: admin, data: { type: "terminal", code: `${code}-T1`, parent_id: airportId, name: { zh: "第 1 航站楼" }, location: terminalAt } });
  expect(terminal.status(), await terminal.text()).toBe(201);

  // 机场区域：只包住机场和航站楼（± 0.008 度），业务类型接送机（机场区域不限业务类型，ADR 0098 第三节第 2 小节）
  const area = await post<{ id: string }>(request, { ...headers, "idempotency-key": crypto.randomUUID() }, "/tenant/v1/areas", { city_id: trip.cityId, name: { zh: `机场区域 ${tag}` }, biz_type: "airport_transfer", polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [square(airportAt, 0.008)] } }] }, "新建机场区域");
  const shortName = `测试机场${tag}`;
  const version = ((await (await request.get(`/tenant/v1/products/${trip.productId}`, { headers })).json()) as { version: number }).version;
  const bound = await request.put(`/tenant/v1/products/${trip.productId}/charter-airports`, {
    headers: { ...headers, "if-match": `"${version}"` },
    data: { bindings: (["airport_start", "airport_end"] as const).map((scenario) => ({ scenario, place_id: airportId, area_id: area.id, short_name_zh: shortName })) },
  });
  expect(bound.status(), await bound.text()).toBe(200);
  const airportName = `快捷入口机场${tag}`;
  return { ...trip, shortName, airport: airportAt, terminal: terminalAt, airportName, terminalLabel: `${airportName} 第 1 航站楼` };
}
