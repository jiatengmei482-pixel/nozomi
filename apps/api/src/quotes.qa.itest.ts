/**
 * M2-01 报价试算：测试角色补的接口边界测试（真实 PostgreSQL）。
 * - 畸形入参一律 4xx，不出 500；
 * - 租户 A 试算不到租户 B 的商品，应答不泄露 B 的任何信息；/tenant/v1 应答任何层级不含对外价、加价比例；
 * - 并发试算结果一致；
 * - 试算不用缓存里的旧目录：改价、暂停、下架之后马上看得到；
 * - 库存按城市当地的用车日期取（跨午夜）。
 * 测试数据只在这里构造，结束时连同 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type ApiResponse, type HttpMethod, type TenantFixture, type TestApi, createTestApi, resumeTenantNow, suspendTenantApproved } from "./testing/api.ts";

let api: TestApi;
let root: string;
let a: TenantFixture;
let b: TenantFixture;
const ids: Record<string, string> = {};

const platform = (method: HttpMethod, path: string, body?: unknown, token: string = root): Promise<ApiResponse> => api.call(method, `/platform/v1${path}`, { token, ...(body === undefined ? {} : { body }) });
const call = (who: TenantFixture, method: HttpMethod, path: string, options: { body?: unknown; version?: number; token?: string } = {}): Promise<ApiResponse> =>
  api.call(method, `/tenant/v1${path}`, {
    token: options.token ?? who.adminToken,
    ...(options.body === undefined ? {} : { body: options.body }),
    headers: {
      ...(options.version === undefined ? {} : { "if-match": `"${options.version}"` }),
      ...(method === "POST" && /^\/(products|brands|areas)$|\/price-rules$|\/adjust-rules$/.test(path) ? { "idempotency-key": randomUUID() } : {}),
    },
  });
async function ok(res: Promise<ApiResponse>, status = 200): Promise<any> {
  const done = await res;
  assert.equal(done.status, status, done.text);
  return done.body;
}

const square = (west: number, south: number, east: number, north: number): unknown => ({ kind: "operate", geometry: { type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] } });
const WEST = { lng: 139.2, lat: 35.5 };

async function area(who: TenantFixture, name: string): Promise<string> {
  api.clock.advance(1_000);
  return (await ok(call(who, "POST", "/areas", { body: { city_id: ids["tokyo"], name: { zh: name }, biz_type: "general", polygons: [square(139.0, 35.0, 140.0, 36.0)] } }), 201)).id;
}
const version = async (who: TenantFixture, productId: string): Promise<number> => (await ok(call(who, "GET", `/products/${productId}`))).version;

async function transfer(who: TenantFixture, brandId: string, areaId: string): Promise<string> {
  api.clock.advance(1_000);
  const created = await ok(
    call(who, "POST", "/products", {
      body: { brand_id: brandId, city_id: ids["tokyo"], category: "airport_transfer", poi_id: ids["narita"], areas: [{ area_id: areaId }], vehicle_groups: [{ vehicle_group_id: ids["biz7"], passengers: 6, luggage: 4 }], dispatchers: [{ name: "调度", phone: "0312345678" }] },
    }),
    201,
  );
  const saved = await ok(call(who, "PUT", `/products/${created.id}/service-rules`, { version: 1, body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { pickup: { mode: "limited", minutes: 90 }, dropoff: { mode: "limited", minutes: 15 } } } }));
  await ok(call(who, "PUT", `/products/${created.id}/content`, { version: saved.version, body: { zh: { title: "成田机场接送", pickup_guide: "到达大厅 3 号门" } } }));
  return created.id;
}
const priceBody = (areaId: string, basePrice: number): Record<string, unknown> => ({ area_id: areaId, vehicle_group_id: ids["biz7"], direction: "both", pricing_model: "fixed", base_price: basePrice, valid_from: "2026-01-01" });
async function addPrice(who: TenantFixture, productId: string, areaId: string, basePrice: number): Promise<string> {
  return (await ok(call(who, "POST", `/products/${productId}/price-rules`, { version: await version(who, productId), body: priceBody(areaId, basePrice) }), 201)).price_rule.id;
}

const ask = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ city_id: ids["tokyo"], category: "airport_transfer", place_id: ids["narita"], currency: "JPY", direction: "pickup", dropoff: WEST, service_time: "2026-10-20T10:00", passengers: 2, luggage: 1, ...extra });
const own = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ direction: "pickup", dropoff: WEST, service_time: "2026-10-20T10:00", passengers: 2, luggage: 1, ...extra });
/** 平台试算里每个供应商的结算价：[租户编号, 结算价] */
const settlements = async (extra: Record<string, unknown> = {}): Promise<[string, number][]> => {
  const body = await ok(platform("POST", "/quotes/preview", ask(extra)));
  return (body.groups[0]?.candidates ?? []).map((entry: any) => [entry.tenant_id, entry.offer.settlement.total]).sort();
};

before(async () => {
  api = await createTestApi();
  root = await api.superAdminToken();
  a = await api.tenantWithAdmin(root, "甲车队", "admin@qa-quote-a.test");
  b = await api.tenantWithAdmin(root, "乙秘密车队", "admin@qa-quote-b.test");
  ids["tokyo"] = (await ok(platform("POST", "/master/cities", { country_code: "JP", timezone: "Asia/Tokyo", code: "CTY-JP-TYO", name: { zh: "东京" }, center: { lng: 139.6917, lat: 35.6895 } }), 201)).id;
  ids["narita"] = (await ok(platform("POST", "/master/places", { location: { lng: 140.3887, lat: 35.7686 }, type: "airport", code: "NRT", city_id: ids["tokyo"], name: { zh: "成田机场" }, flight_scope: "international" }), 201)).id;
  ids["biz7"] = (await ok(platform("POST", "/master/vehicle-groups", { grade: "business", seats: 7, power: "fuel", combos: [{ passengers: 6, luggage: 4 }], code: "VG-BIZ-7", name: { zh: "商务 7 座" } }), 201)).id;
  ids["brandA"] = (await ok(call(a, "POST", "/brands", { body: { name: "甲 JP", currency: "JPY" } }), 201)).id;
  ids["brandB"] = (await ok(call(b, "POST", "/brands", { body: { name: "乙 JP", currency: "JPY" } }), 201)).id;
  ids["aArea"] = await area(a, "甲东京");
  ids["bArea"] = await area(b, "乙东京");
  ids["pa"] = await transfer(a, ids["brandA"] as string, ids["aArea"] as string);
  ids["paPrice"] = await addPrice(a, ids["pa"] as string, ids["aArea"] as string, 20_000);
  await ok(call(a, "POST", `/products/${ids["pa"]}/publish`));
  ids["pb"] = await transfer(b, ids["brandB"] as string, ids["bArea"] as string);
  ids["pbPrice"] = await addPrice(b, ids["pb"] as string, ids["bArea"] as string, 17_777);
  await ok(call(b, "POST", `/products/${ids["pb"]}/publish`));
});
after(() => api.close());

test("QA 畸形入参：平台侧试算各种写错的请求一律 4xx（不出 500），应答是统一的错误结构", async () => {
  const bad: [string, unknown][] = [
    ["空 body", undefined],
    ["body 是 null", null],
    ["body 是数组", [ask()]],
    ["body 是字符串", "hello"],
    ["缺 service_time", { ...ask(), service_time: undefined }],
    ["缺 passengers", { ...ask(), passengers: undefined }],
    ["缺 city_id", { ...ask(), city_id: undefined }],
    ["service_time 24:00", ask({ service_time: "2026-10-20T24:00" })],
    ["service_time 13 月", ask({ service_time: "2026-13-01T10:00" })],
    ["service_time 带秒", ask({ service_time: "2026-10-20T10:00:00" })],
    ["service_time 带时区", ask({ service_time: "2026-10-20T10:00Z" })],
    ["service_time 超长", ask({ service_time: "2".repeat(100_000) })],
    ["service_time 是数字", ask({ service_time: 20261020 })],
    ["passengers 小数", ask({ passengers: 1.5 })],
    ["passengers 字符串", ask({ passengers: "2" })],
    ["passengers 极大", ask({ passengers: 1e20 })],
    ["passengers 负数", ask({ passengers: -1 })],
    ["passengers 61", ask({ passengers: 61 })],
    ["luggage 61", ask({ luggage: 61 })],
    ["luggage 负数", ask({ luggage: -1 })],
    ["纬度 91", ask({ dropoff: { lng: 139.2, lat: 91 } })],
    ["经度 -181", ask({ dropoff: { lng: -181, lat: 35 } })],
    ["坐标是字符串", ask({ dropoff: { lng: "139.2", lat: "35.5" } })],
    ["坐标是数组", ask({ dropoff: [139.2, 35.5] })],
    ["坐标缺 lat", ask({ dropoff: { lng: 139.2 } })],
    ["坐标多字段", ask({ dropoff: { lng: 139.2, lat: 35.5, alt: 1 } })],
    ["direction both", ask({ direction: "both" })],
    ["category 不认识", ask({ category: "bus" })],
    ["currency 小写", ask({ currency: "jpy" })],
    ["currency 超长", ask({ currency: "JPYY" })],
    ["city_id 不是 uuid", ask({ city_id: "tokyo" })],
    ["place_id 不是 uuid", ask({ place_id: "NRT" })],
    ["addon_id 不是 uuid", ask({ addons: [{ addon_id: "seat", quantity: 1 }] })],
    ["addon quantity 0", ask({ addons: [{ addon_id: randomUUID(), quantity: 0 }] })],
    ["addon quantity 21", ask({ addons: [{ addon_id: randomUUID(), quantity: 21 }] })],
    ["addons 21 种", ask({ addons: Array.from({ length: 21 }, () => ({ addon_id: randomUUID(), quantity: 1 })) })],
    ["addons 重复", ask({ addons: [{ addon_id: ids["biz7"], quantity: 1 }, { addon_id: ids["biz7"], quantity: 1 }] })],
    ["vehicle_group_ids 不是 uuid", ask({ vehicle_group_ids: ["biz7"] })],
    ["vehicle_group_ids 31 个", ask({ vehicle_group_ids: Array.from({ length: 31 }, () => randomUUID()) })],
    ["driver_language 超长", ask({ driver_language: "x".repeat(11) })],
    ["assume_route 超大", ask({ assume_route: { meters: 5_000_001, minutes: 10 } })],
    ["assume_route 时长超 7 天", ask({ assume_route: { meters: 10, minutes: 10_081 } })],
    ["assume_route 小数", ask({ assume_route: { meters: 1.5, minutes: 10 } })],
    ["assume_route 缺字段", ask({ assume_route: { meters: 10 } })],
    ["package_hours 0（包车）", ask({ category: "charter", place_id: null, direction: null, pickup: WEST, dropoff: null, package_hours: 0 })],
    ["package_hours 73（包车）", ask({ category: "charter", place_id: null, direction: null, pickup: WEST, dropoff: null, package_hours: 73 })],
    ["包车不给套餐", ask({ category: "charter", place_id: null, direction: null, pickup: WEST, dropoff: null })],
    ["点对点给了 place_id", ask({ category: "point_to_point", direction: null, pickup: WEST })],
    ["__proto__ 字段", JSON.parse(`{"__proto__":{"x":1},"city_id":"${ids["tokyo"]}"}`)],
  ];
  for (const [label, body] of bad) {
    const res = await api.call("POST", "/platform/v1/quotes/preview", { token: root, ...(body === undefined ? {} : { body }) });
    assert.ok(res.status >= 400 && res.status < 500, `${label}：${res.status} ${res.text.slice(0, 300)}`);
    assert.equal(typeof res.body?.error?.code, "string", `${label}：${res.text.slice(0, 300)}`);
  }
});

test("QA 畸形入参：租户侧试算同样 4xx；商品编号写错是 400 / 404 而不是 500", async () => {
  const path = `/products/${ids["pa"]}/quote-preview`;
  const bad: [string, unknown][] = [
    ["空 body", undefined],
    ["body 是 null", null],
    ["缺 service_time", { ...own(), service_time: undefined }],
    ["service_time 2 月 30 日", own({ service_time: "2026-02-30T10:00" })],
    ["service_time 超长", own({ service_time: "9".repeat(50_000) })],
    ["passengers 极大", own({ passengers: Number.MAX_SAFE_INTEGER + 2 })],
    ["纬度 NaN 写成字符串", own({ dropoff: { lng: 139.2, lat: "NaN" } })],
    ["接机不给下车点", own({ dropoff: null })],
    ["送机不给上车点", own({ direction: "dropoff" })],
    ["接送机给了套餐", own({ package_hours: 4 })],
    ["多出 currency", own({ currency: "JPY" })],
    ["多出 markup_bp", own({ markup_bp: 0 })],
    ["多出 tenant_id", own({ tenant_id: b.tenantId })],
  ];
  for (const [label, body] of bad) {
    const res = await call(a, "POST", path, body === undefined ? {} : { body });
    assert.ok(res.status >= 400 && res.status < 500, `${label}：${res.status} ${res.text.slice(0, 300)}`);
  }
  for (const id of ["not-a-uuid", "00000000-0000-0000-0000-000000000000", "%00", "x".repeat(5_000)]) {
    const res = await call(a, "POST", `/products/${id}/quote-preview`, { body: own() });
    assert.ok(res.status >= 400 && res.status < 500, `${id.slice(0, 20)}：${res.status} ${res.text.slice(0, 200)}`);
  }
});

test("QA 跨租户：A 试算 B 的商品与试算不存在的商品应答完全一样（404），不论请求写得对不对；A 自己的试算应答任何层级不含对外价、加价比例、B 的任何信息", async () => {
  const missing = randomUUID();
  for (const body of [own(), own({ dropoff: null }), own({ service_time: "2026-02-30T10:00" })]) {
    const theirs = await call(a, "POST", `/products/${ids["pb"]}/quote-preview`, { body });
    const none = await call(a, "POST", `/products/${missing}/quote-preview`, { body });
    assert.equal(theirs.status, none.status, `${JSON.stringify(body)}：${theirs.text} / ${none.text}`);
    assert.deepEqual(theirs.body, none.body);
    for (const secret of [ids["pb"], ids["pbPrice"], ids["bArea"], ids["brandB"], b.tenantId, "17777", "17,777", "乙秘密车队"]) assert.ok(!theirs.text.includes(secret as string), `泄露了 ${secret}`);
  }
  const mine = await ok(call(a, "POST", `/products/${ids["pa"]}/quote-preview`, { body: own() }));
  assert.equal(mine.offers[0].settlement.total, 20_000);
  const text = JSON.stringify(mine);
  for (const secret of [ids["pb"], ids["pbPrice"], ids["bArea"], ids["brandB"], b.tenantId, "17777", "乙秘密车队"]) assert.ok(!text.includes(secret as string), `租户应答里出现了 ${secret}`);
  const keys: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value !== null && typeof value === "object") for (const [key, inner] of Object.entries(value)) (keys.push(key), walk(inner));
  };
  walk(mine);
  assert.deepEqual(keys.filter((key) => /sell|markup|margin|rank|band|fx|score|winner|candidate|tenant|channel|floor|buffer|completed|observation/i.test(key)), []);
  // B 被暂停 / B 的商品下架，都不影响 A 自己的试算，也不在 A 的应答里留下痕迹
  await suspendTenantApproved(api, root, b.tenantId);
  try {
    const again = await ok(call(a, "POST", `/products/${ids["pa"]}/quote-preview`, { body: own() }));
    assert.deepEqual(again, mine);
  } finally {
    await resumeTenantNow(api, root, b.tenantId);
  }
});

test("QA 并发：30 个平台试算和 30 个租户试算同时发，全部 200，结果彼此相同", async () => {
  const results = await Promise.all([
    ...Array.from({ length: 30 }, () => platform("POST", "/quotes/preview", ask())),
    ...Array.from({ length: 30 }, () => call(a, "POST", `/products/${ids["pa"]}/quote-preview`, { body: own() })),
  ]);
  for (const res of results) assert.equal(res.status, 200, res.text);
  const platformBodies = new Set(results.slice(0, 30).map((res) => JSON.stringify(res.body)));
  const tenantBodies = new Set(results.slice(30).map((res) => JSON.stringify(res.body)));
  assert.equal(platformBodies.size, 1);
  assert.equal(tenantBodies.size, 1);
  const body = results[0]?.body;
  assert.equal(body.groups[0].candidates[0].tenant_id, b.tenantId, "乙 17,777 更低");
});

test("QA 缓存：平台试算现取现算——改价、暂停供应商、下架商品之后不等 30 秒，下一次试算马上就是新的", async () => {
  assert.deepEqual(await settlements(), [[a.tenantId, 20_000], [b.tenantId, 17_777]].sort());
  // 改价（同一秒内，时钟不走）
  const v = await version(a, ids["pa"] as string);
  await ok(call(a, "PUT", `/products/${ids["pa"]}/price-rules/${ids["paPrice"]}`, { version: v, body: priceBody(ids["aArea"] as string, 15_000) }));
  try {
    assert.deepEqual(await settlements(), [[a.tenantId, 15_000], [b.tenantId, 17_777]].sort());
    // 暂停乙：乙马上不参加比价，原因是 TENANT_SUSPENDED
    await suspendTenantApproved(api, root, b.tenantId);
    try {
      const body = await ok(platform("POST", "/quotes/preview", ask()));
      assert.deepEqual(body.groups[0].candidates.map((entry: any) => entry.tenant_id), [a.tenantId]);
      assert.deepEqual(body.refused.map((entry: any) => [entry.tenant_id, entry.reason]), [[b.tenantId, "TENANT_SUSPENDED"]]);
    } finally {
      await resumeTenantNow(api, root, b.tenantId);
    }
    // 下架甲：马上不在候选里
    await ok(call(a, "POST", `/products/${ids["pa"]}/unpublish`));
    try {
      const body = await ok(platform("POST", "/quotes/preview", ask()));
      assert.equal(body.candidate_count, 1);
      assert.deepEqual(body.groups[0].candidates.map((entry: any) => entry.tenant_id), [b.tenantId]);
    } finally {
      await ok(call(a, "POST", `/products/${ids["pa"]}/publish`));
    }
  } finally {
    await ok(call(a, "PUT", `/products/${ids["pa"]}/price-rules/${ids["paPrice"]}`, { version: await version(a, ids["pa"] as string), body: priceBody(ids["aArea"] as string, 20_000) }));
  }
  assert.deepEqual(await settlements(), [[a.tenantId, 20_000], [b.tenantId, 17_777]].sort());
});

test("QA 库存按城市当地的用车日期：东京 10-21 的库存是 0 时，10-21 00:30 的用车是 SOLD_OUT，10-20 23:30 照常（UTC 都在 10-20）", async () => {
  const v = (await ok(call(b, "GET", `/products/${ids["pb"]}/inventory?from=2026-10-20&to=2026-10-21`))).version;
  await ok(call(b, "PUT", `/products/${ids["pb"]}/inventory`, { version: v, body: { mode: "limited" } }));
  try {
    const v2 = (await ok(call(b, "GET", `/products/${ids["pb"]}/inventory?from=2026-10-20&to=2026-10-21`))).version;
    await ok(call(b, "POST", `/products/${ids["pb"]}/inventory/batch-set`, { version: v2, body: { from: "2026-10-20", to: "2026-10-20", total: 3 } }));
    const v3 = (await ok(call(b, "GET", `/products/${ids["pb"]}/inventory?from=2026-10-20&to=2026-10-21`))).version;
    await ok(call(b, "POST", `/products/${ids["pb"]}/inventory/batch-set`, { version: v3, body: { from: "2026-10-21", to: "2026-10-21", total: 0 } }));
    const late = await ok(call(b, "POST", `/products/${ids["pb"]}/quote-preview`, { body: own({ service_time: "2026-10-20T23:30" }) }));
    assert.deepEqual([late.refusal, late.service_date, late.offers.length], [null, "2026-10-20", 1]);
    const early = await ok(call(b, "POST", `/products/${ids["pb"]}/quote-preview`, { body: own({ service_time: "2026-10-21T00:30" }) }));
    assert.equal(early.refusal?.reason, "SOLD_OUT");
    const body = await ok(platform("POST", "/quotes/preview", ask({ service_time: "2026-10-21T00:30" })));
    assert.deepEqual(body.refused.map((entry: any) => [entry.tenant_id, entry.reason]), [[b.tenantId, "SOLD_OUT"]]);
  } finally {
    const v4 = (await ok(call(b, "GET", `/products/${ids["pb"]}/inventory?from=2026-10-20&to=2026-10-21`))).version;
    await ok(call(b, "PUT", `/products/${ids["pb"]}/inventory`, { version: v4, body: { mode: "unlimited" } }));
  }
});

test("QA 同一个车型组在请求里写了两次：应当 400（像重复的附加服务一样），或者只出一个价——不能给出两条一样的报价", async () => {
  const res = await call(a, "POST", `/products/${ids["pa"]}/quote-preview`, { body: own({ vehicle_group_ids: [ids["biz7"], ids["biz7"]] }) });
  if (res.status === 400) return;
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.offers.length + res.body.refused.length, 1, JSON.stringify(res.body.offers.map((offer: any) => offer.vehicle_group_id)));
});
