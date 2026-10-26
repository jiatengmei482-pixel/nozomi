/**
 * 渠道和销售端的集成测试共用的「市场」：东京、大阪两个城市，成田机场，两个车型组，两个供应商各有一个已上架的成田接送机商品，
 * 以及几位平台员工（两位渠道经理、只读、主数据运营、运营）。全部经真实接口建出来，测试结束随 schema 一起删除（规则 1）。
 *
 * 价格（结算价，日元）：甲 商务 7 座 20,000、经济 4 座 12,000；乙 商务 7 座 19,800。区域都盖住整个东京。
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PlatformRole } from "@nozomi/domain";
import { type ApiResponse, type HttpMethod, TEST_PASSWORD, type TenantFixture, type TestApi } from "./api.ts";

export interface Staff {
  id: string;
  token: string;
  email: string;
}

export interface Market {
  root: string;
  a: TenantFixture;
  b: TenantFixture;
  staff: Record<"cm1" | "cm2" | "readonly" | "masterData" | "operations", Staff>;
  ids: Record<"tokyo" | "osaka" | "narita" | "biz7" | "eco4" | "pa" | "pb", string>;
}

export async function ok(res: Promise<ApiResponse>, status = 200): Promise<any> {
  const done = await res;
  assert.equal(done.status, status, done.text);
  return done.body;
}

export async function addStaff(api: TestApi, root: string, email: string, role: PlatformRole): Promise<Staff> {
  const invited = await ok(api.call("POST", "/platform/v1/staff", { token: root, body: { email, name: email.split("@")[0], role } }), 201);
  await ok(api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.invite.token, password: TEST_PASSWORD } }));
  const login = await ok(api.call("POST", "/platform/v1/auth/login", { body: { email, password: TEST_PASSWORD } }));
  return { id: invited.user.id, token: login.access_token, email };
}

export async function buildMarket(api: TestApi): Promise<Market> {
  const root = await api.superAdminToken();
  const platform = (method: HttpMethod, path: string, body?: unknown): Promise<any> => ok(api.call(method, `/platform/v1${path}`, { token: root, ...(body === undefined ? {} : { body }) }), method === "POST" ? 201 : 200);
  const a = await api.tenantWithAdmin(root, "甲车队", "admin@market-a.test");
  const b = await api.tenantWithAdmin(root, "乙车队", "admin@market-b.test");
  const tokyo = (await platform("POST", "/master/cities", { country_code: "JP", timezone: "Asia/Tokyo", code: "CTY-JP-TYO", name: { zh: "东京" }, center: { lng: 139.6917, lat: 35.6895 } })).id;
  const osaka = (await platform("POST", "/master/cities", { country_code: "JP", timezone: "Asia/Tokyo", code: "CTY-JP-OSA", name: { zh: "大阪" }, center: { lng: 135.5, lat: 34.7 } })).id;
  const narita = (await platform("POST", "/master/places", { location: { lng: 140.3887, lat: 35.7686 }, type: "airport", code: "NRT", city_id: tokyo, name: { zh: "成田机场" }, flight_scope: "international" })).id;
  const biz7 = (await platform("POST", "/master/vehicle-groups", { grade: "business", seats: 7, power: "fuel", combos: [{ passengers: 6, luggage: 4 }], code: "VG-BIZ-7", name: { zh: "商务 7 座" } })).id;
  const eco4 = (await platform("POST", "/master/vehicle-groups", { grade: "economy", seats: 4, power: "fuel", combos: [{ passengers: 3, luggage: 2 }], code: "VG-ECO-4", name: { zh: "经济 4 座" } })).id;

  const product = (who: TenantFixture, prices: [string, number][]): Promise<string> => marketProduct(api, who, { tokyo, narita, biz7 }, prices);
  const pa = await product(a, [[biz7, 20_000], [eco4, 12_000]]);
  const pb = await product(b, [[biz7, 19_800]]);
  const staff = {
    cm1: await addStaff(api, root, "cm1@platform.test", "channel_manager"),
    cm2: await addStaff(api, root, "cm2@platform.test", "channel_manager"),
    readonly: await addStaff(api, root, "ro@platform.test", "readonly"),
    masterData: await addStaff(api, root, "md@platform.test", "master_data"),
    operations: await addStaff(api, root, "ops@platform.test", "operations"),
  };
  return { root, a, b, staff, ids: { tokyo, osaka, narita, biz7, eco4, pa, pb } };
}

/**
 * 给一个供应商建一个成田接送机商品（区域盖住整个东京，价格按 `prices`），默认上架。`publish: false` 只建到「能通过上架校验」为止（入驻测试用：已签约的供应商不能上架）。
 */
export async function marketProduct(api: TestApi, who: TenantFixture, ids: { tokyo: string; narita: string; biz7: string }, prices: [string, number][], options: { publish?: boolean; leadTimeHours?: number } = {}): Promise<string> {
  const { tokyo, narita, biz7 } = ids;
  const tenant = (target: TenantFixture, method: HttpMethod, path: string, body: unknown, version?: number, status = 200): Promise<any> =>
    ok(
      api.call(method, `/tenant/v1${path}`, {
        token: target.adminToken,
        body,
        headers: { ...(version === undefined ? {} : { "if-match": `"${version}"` }), ...(method === "POST" && /^\/(products|brands|areas)$|\/price-rules$/.test(path) ? { "idempotency-key": randomUUID() } : {}) },
      }),
      status,
    );
  const brand = (await tenant(who, "POST", "/brands", { name: `品牌-${who.tenantId.slice(0, 4)}`, currency: "JPY" }, undefined, 201)).id;
  api.clock.advance(1_000);
  const area = (await tenant(who, "POST", "/areas", { city_id: tokyo, name: { zh: "东京全域" }, biz_type: "general", polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [[[139.0, 35.0], [140.0, 35.0], [140.0, 36.0], [139.0, 36.0], [139.0, 35.0]]] } }] }, undefined, 201)).id;
  const created = await tenant(
    who,
    "POST",
    "/products",
    {
      brand_id: brand,
      city_id: tokyo,
      category: "airport_transfer",
      poi_id: narita,
      areas: [{ area_id: area }],
      vehicle_groups: prices.map(([vg]) => (vg === biz7 ? { vehicle_group_id: vg, passengers: 6, luggage: 4 } : { vehicle_group_id: vg, passengers: 3, luggage: 2 })),
      dispatchers: [{ name: "调度", phone: "0312345678" }],
    },
    undefined,
    201,
  );
  const saved = await tenant(who, "PUT", `/products/${created.id}/service-rules`, { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: options.leadTimeHours ?? 24 }, free_wait: { pickup: { mode: "limited", minutes: 90 }, dropoff: { mode: "limited", minutes: 15 } } }, 1);
  let version = (await tenant(who, "PUT", `/products/${created.id}/content`, { zh: { title: "成田机场接送", pickup_guide: "到达大厅 3 号门" } }, saved.version)).version as number;
  for (const [vg, price] of prices) {
    await tenant(who, "POST", `/products/${created.id}/price-rules`, { area_id: area, vehicle_group_id: vg, direction: "both", pricing_model: "fixed", valid_from: "2026-01-01", base_price: price }, version, 201);
    version = (await tenant(who, "GET", `/products/${created.id}`, undefined)).version;
  }
  if (options.publish !== false) await tenant(who, "POST", `/products/${created.id}/publish`, undefined);
  return created.id;
}

/** 接机（成田 → 东京市区），2026-10-20 10:00（东京时间），2 人 1 件行李。测试时钟是 2026-10-07，离用车足够远。 */
export const SERVICE_TIME = "2026-10-20T10:00:00+09:00";
export const DROPOFF = { lng: 139.7, lat: 35.6 };

export async function newChannel(api: TestApi, token: string, body: Record<string, unknown>): Promise<any> {
  return (await ok(api.call("POST", "/platform/v1/channels", { token, body: { type: "own", settle_currency: "JPY", ...body } }), 201)).channel;
}

/** 渠道经理 1 发起、渠道经理 2 批准：返回批准后的复核记录。 */
export async function approvedBy(api: TestApi, market: Market, request: Promise<ApiResponse>): Promise<any> {
  const requested = await ok(request, 202);
  return (await ok(api.call("POST", `/platform/v1/approvals/${requested.approval.id}/approve`, { token: market.staff.cm2.token, body: {} }))).approval;
}

export function ruleRequest(api: TestApi, market: Market, channelId: string, body: Record<string, unknown>): Promise<ApiResponse> {
  return api.call("POST", `/platform/v1/channels/${channelId}/markup-rules`, { token: market.staff.cm1.token, body });
}

/** 给渠道发一个 API 客户端，换一个访问令牌。 */
export async function salesCredentials(api: TestApi, market: Market, channelId: string, ip = "198.51.100.10"): Promise<{ clientId: string; id: string; secret: string; token: string }> {
  const issued = await ok(api.call("POST", `/platform/v1/channels/${channelId}/api-clients`, { token: market.staff.cm1.token, body: { name: "官网" } }), 201);
  const token = await ok(api.call("POST", "/sales/v1/oauth/token", { ip, body: { grant_type: "client_credentials", client_id: issued.api_client.client_id, client_secret: issued.client_secret } }));
  return { clientId: issued.api_client.client_id, id: issued.api_client.id, secret: issued.client_secret, token: token.access_token };
}

/** 收集一个 JSON 值里所有的键（逐层）。 */
export function allKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) for (const item of value) allKeys(item, into);
  else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      into.add(key);
      allKeys(item, into);
    }
  }
  return into;
}
