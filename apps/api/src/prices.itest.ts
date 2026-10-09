/**
 * M1-04：价格规则、调价规则、价格日历、缺价组合、价格概况、子品牌取整单位、节假日日历，以及接上之后的上架。
 * 跨租户的验证在 tenant-isolation.itest.ts；这里是单个供应商视角下的全部规则。
 * 全部经真实接口、真实 PostgreSQL；测试数据都在这里构造，结束时连同 schema 一起删除。
 * 测试时钟固定在 2026-10-07 10:00（东京），所以「今天」是 2026-10-07（周三）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { type ApiResponse, type HttpMethod, type TenantFixture, type TestApi, addTenantUser, createTestApi } from "./testing/api.ts";

let api: TestApi;
let root: string;
let tenant: TenantFixture;
const MISSING = "99999999-9999-4999-8999-999999999999";
const ids: Record<string, string> = {};
const TODAY = "2026-10-07";

const platform = (method: HttpMethod, path: string, body?: unknown): Promise<ApiResponse> => api.call(method, `/platform/v1${path}`, { token: root, ...(body === undefined ? {} : { body }) });

const call = (method: HttpMethod, path: string, options: { token?: string; body?: unknown; version?: number; key?: string | null } = {}): Promise<ApiResponse> =>
  api.call(method, `/tenant/v1${path}`, {
    token: options.token ?? tenant.adminToken,
    ...(options.body === undefined ? {} : { body: options.body }),
    headers: {
      ...(options.version === undefined ? {} : { "if-match": `"${options.version}"` }),
      ...(method === "POST" && options.key !== null && /(^\/(products|brands|areas)$)|\/(price-rules|price-rules\/batch|adjust-rules)$/.test(path) ? { "idempotency-key": options.key ?? randomUUID() } : {}),
    },
  });

async function ok(res: Promise<ApiResponse>, status = 200): Promise<any> {
  const done = await res;
  assert.equal(done.status, status, done.text);
  return done.body;
}

function issues(res: ApiResponse): [string, string | undefined][] {
  assert.equal(res.status, 400, res.text);
  assert.equal(res.body.error.code, "VALIDATION_FAILED");
  return res.body.error.details.issues.map((issue: any) => [issue.path, issue.reason]);
}

const SQUARE = { type: "Polygon", coordinates: [[[139.6, 35.6], [139.8, 35.6], [139.8, 35.8], [139.6, 35.8], [139.6, 35.6]]] };
let serial = 0;

async function area(): Promise<string> {
  api.clock.advance(1_000);
  return (await ok(call("POST", "/areas", { body: { city_id: ids["tokyo"], name: { zh: `区域 ${(serial += 1)}` }, biz_type: "general", polygons: [{ kind: "operate", geometry: SQUARE }] } }), 201)).id;
}

/** 一个选了两个区域、两个车型组的商品（默认接送机）。 */
async function product(category: "airport_transfer" | "point_to_point" | "charter" = "airport_transfer"): Promise<string> {
  api.clock.advance(1_000);
  const body = {
    brand_id: ids["brand"],
    city_id: ids["tokyo"],
    category,
    ...(category === "airport_transfer" ? { poi_id: ids["narita"] } : {}),
    areas: [{ area_id: ids["a1"] }, { area_id: ids["a2"] }],
    vehicle_groups: [{ vehicle_group_id: ids["biz7"], passengers: 6, luggage: 2 }, { vehicle_group_id: ids["eco4"], passengers: 3, luggage: 2 }],
    dispatchers: [{ name: "调度小王", phone: "09012345678" }],
  };
  return (await ok(call("POST", "/products", { body }), 201)).id;
}

/** 把服务规则和详情也填好：除了价格规则，上架条件都满足。 */
async function publishable(category: "airport_transfer" | "charter" = "airport_transfer"): Promise<string> {
  const id = await product(category);
  const freeWait = category === "airport_transfer" ? { pickup: { mode: "limited", minutes: 90 }, dropoff: { mode: "limited", minutes: 15 } } : { general: { mode: "unlimited" } };
  const rules = await ok(call("PUT", `/products/${id}/service-rules`, { version: 1, body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: freeWait } }));
  await ok(call("PUT", `/products/${id}/content`, { version: rules.version, body: { zh: { title: "测试商品", pickup_guide: "到达大厅 3 号门" } } }));
  return id;
}

const version = async (productId: string): Promise<number> => (await ok(call("GET", `/products/${productId}/price-rules`))).version;

const fixed = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  area_id: ids["a1"],
  vehicle_group_id: ids["biz7"],
  direction: "pickup",
  pricing_model: "fixed",
  base_price: 20_000,
  valid_from: "2026-10-01",
  ...extra,
});
const charter = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  area_id: ids["a1"],
  vehicle_group_id: ids["biz7"],
  package_hours: 10,
  pricing_model: "charter_package",
  package_km: 300,
  package_price: 98_000,
  overtime_per_hour: 5_000,
  over_km_per_km: 400,
  valid_from: "2026-10-01",
  ...extra,
});

/** 新增一条价格规则，返回它和商品的新版本号。 */
async function addPrice(productId: string, body: Record<string, unknown>): Promise<{ version: number; price_rule: any }> {
  return ok(call("POST", `/products/${productId}/price-rules`, { version: await version(productId), body }), 201);
}

const adjustBody = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ name: "旺季", cycle: { type: "daily" }, steps: [{ type: "percent", value: 2_000 }], ...extra });

async function addAdjust(productId: string, body: Record<string, unknown>): Promise<any> {
  return (await ok(call("POST", `/products/${productId}/adjust-rules`, { version: await version(productId), body }), 201)).adjust_rule;
}

async function audits(resource: string, id: string): Promise<any[]> {
  return (await api.db.owner.query("select action, tenant_id, actor_email, before, after from audit_logs where resource = $1 and resource_id = $2 order by id", [resource, id])).rows;
}

async function calendar(productId: string, query: string): Promise<any> {
  return ok(call("GET", `/products/${productId}/price-calendar?${query}`));
}

before(async () => {
  api = await createTestApi();
  root = await api.superAdminToken();
  tenant = await api.tenantWithAdmin(root, "甲车队", "admin@a.test");
  ids["tokyo"] = (await ok(platform("POST", "/master/cities", { country_code: "JP", timezone: "Asia/Tokyo", code: "CTY-JP-TYO", name: { zh: "东京" }, center: { lng: 139.6917, lat: 35.6895 } }), 201)).id;
  ids["narita"] = (await ok(platform("POST", "/master/places", { location: { lng: 140.3887, lat: 35.7686 }, type: "airport", code: "NRT", city_id: ids["tokyo"], name: { zh: "成田机场" }, flight_scope: "international" }), 201)).id;
  ids["biz7"] = (await ok(platform("POST", "/master/vehicle-groups", { grade: "business", seats: 7, power: "fuel", combos: [{ passengers: 6, luggage: 2 }], code: "VG-BIZ-7", name: { zh: "商务 7 座" } }), 201)).id;
  ids["eco4"] = (await ok(platform("POST", "/master/vehicle-groups", { grade: "economy", seats: 4, power: "fuel", combos: [{ passengers: 3, luggage: 2 }], code: "VG-ECO-4", name: { zh: "经济 4 座" } }), 201)).id;
  ids["lux4"] = (await ok(platform("POST", "/master/vehicle-groups", { grade: "luxury", seats: 4, power: "fuel", combos: [{ passengers: 3, luggage: 2 }], code: "VG-LUX-4", name: { zh: "豪华 4 座" } }), 201)).id;
  ids["brand"] = (await ok(call("POST", "/brands", { body: { name: "甲车队 JP", currency: "JPY" } }), 201)).id;
  ids["a1"] = await area();
  ids["a2"] = await area();
  ids["a3"] = await area();
});
after(() => api.close());

test("新商品还没有价格：返回币种、取整单位、这个品类可用的计价方式、城市当地的今天，和「该有价格的组合」的个数", async () => {
  const id = await product();
  assert.deepEqual(await ok(call("GET", `/products/${id}/price-rules`)), {
    version: 1,
    currency: "JPY",
    rounding_unit: 1,
    available_models: ["fixed", "mileage_time"],
    today: TODAY,
    items: [],
    coverage: { total: 8, priced: 0, missing: 8 },
  });
  const charterId = await product("charter");
  const empty = await ok(call("GET", `/products/${charterId}/price-rules`));
  assert.deepEqual([empty.available_models, empty.coverage], [["charter_package"], { total: 0, priced: 0, missing: 0 }]);
  assert.equal((await call("GET", `/products/${MISSING}/price-rules`)).status, 404);
  // 城市当地的今天，不是服务器的：同一时刻（UTC 10-07 01:00）洛杉矶还是 10-06，所以 10-06 到期的价格在那里还没过期
  const la = (await ok(platform("POST", "/master/cities", { country_code: "US", timezone: "America/Los_Angeles", code: "CTY-US-LAX", name: { en: "Los Angeles" }, center: { lng: -118.2437, lat: 34.0522 } }), 201)).id;
  const zone = (await ok(call("POST", "/areas", { body: { city_id: la, name: { en: "LA" }, biz_type: "general", polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [[[-118.4, 34], [-118.2, 34], [-118.2, 34.2], [-118.4, 34.2], [-118.4, 34]]] } }] } }), 201)).id;
  const abroad = (await ok(call("POST", "/products", { body: { brand_id: ids["brand"], city_id: la, category: "point_to_point", areas: [{ area_id: zone }], vehicle_groups: [{ vehicle_group_id: ids["biz7"], passengers: 6, luggage: 2 }] } }), 201)).id;
  const body = { area_id: zone, vehicle_group_id: ids["biz7"], pricing_model: "fixed", base_price: 100, valid_from: "2026-01-01", valid_to: "2026-10-06" };
  const there = await ok(call("POST", `/products/${abroad}/price-rules/batch`, { version: 1, body: { create: [body] } }));
  assert.deepEqual([there.today, there.coverage], ["2026-10-06", { total: 1, priced: 1, missing: 0 }]);
  const here = await product("point_to_point");
  const local = await ok(call("POST", `/products/${here}/price-rules/batch`, { version: 1, body: { create: [{ ...body, area_id: ids["a1"] }] } }));
  assert.deepEqual([local.today, local.coverage], [TODAY, { total: 4, priced: 0, missing: 4 }], "同一条价格在东京已经过期");
});

test("新增一条价格：要带幂等键和商品的版本号；三种计价方式各存各的数；商品的版本号加一；写审计日志", async () => {
  const id = await product();
  const body = fixed();
  assert.equal((await call("POST", `/products/${id}/price-rules`, { version: 1, body, key: null })).status, 400, "没带幂等键");
  assert.equal((await call("POST", `/products/${id}/price-rules`, { body })).status, 428, "没带版本号");
  assert.equal((await call("POST", `/products/${id}/price-rules`, { version: 9, body })).body.error.code, "VERSION_CONFLICT");
  const key = randomUUID();
  const created = await ok(call("POST", `/products/${id}/price-rules`, { version: 1, body, key }), 201);
  assert.equal(created.version, 2);
  assert.deepEqual(Object.keys(created.price_rule).sort(), [
    "area_id", "base", "base_price", "created_at", "direction", "id", "min_price", "over_km_per_km", "overtime_per_hour", "package_hours", "package_km", "package_price", "per_km", "per_minute",
    "pricing_model", "start_meters", "start_minutes", "start_price", "status", "updated_at", "valid_from", "valid_to", "vehicle_group_id",
  ]);
  const { id: ruleId, created_at: _created, updated_at: _updated, ...rule } = created.price_rule;
  assert.deepEqual(rule, {
    area_id: ids["a1"], vehicle_group_id: ids["biz7"], direction: "pickup", package_hours: null, pricing_model: "fixed", base_price: 20_000,
    start_price: null, start_meters: null, start_minutes: null, per_km: null, per_minute: null, min_price: null, package_km: null, package_price: null, overtime_per_hour: null, over_km_per_km: null,
    base: "20000", valid_from: "2026-10-01", valid_to: null, status: "enabled",
  });
  // 同一个键同样的内容再来：原样返回，只建了一条
  assert.deepEqual(await ok(call("POST", `/products/${id}/price-rules`, { version: 1, body, key }), 201), created);
  assert.equal((await call("POST", `/products/${id}/price-rules`, { version: 2, body: fixed({ base_price: 1 }), key })).body.error.code, "IDEMPOTENCY_KEY_REUSED");
  assert.equal((await ok(call("GET", `/products/${id}/price-rules`))).items.length, 1);
  assert.equal((await ok(call("GET", `/products/${id}`))).version, 2, "价格变了，商品的版本号跟着加");
  assert.deepEqual((await audits("price_rule", ruleId)).map((log) => [log.action, log.tenant_id, log.actor_email, log.before, log.after.product_id, log.after.params, log.after.valid_from]), [
    ["create", tenant.tenantId, "admin@a.test", null, id, { basePriceMinor: 20_000 }, "2026-10-01"],
  ]);
  // 里程 + 时长：最低消费可以不填；base 是这条价格能报出的最低数
  const metered = await addPrice(id, fixed({ direction: "dropoff", pricing_model: "mileage_time", base_price: null, start_price: 3_000, start_meters: 5_000, start_minutes: 20, per_km: 400, per_minute: 80, valid_to: "2027-03-31", status: "disabled" }));
  assert.deepEqual(
    [metered.price_rule.start_price, metered.price_rule.start_meters, metered.price_rule.min_price, metered.price_rule.base_price, metered.price_rule.base, metered.price_rule.valid_to, metered.price_rule.status],
    [3_000, 5_000, null, null, "3000", "2027-03-31", "disabled"],
  );
  // 包车套餐
  const charterId = await product("charter");
  const packaged = await addPrice(charterId, charter());
  assert.deepEqual([packaged.price_rule.package_hours, packaged.price_rule.package_km, packaged.price_rule.package_price, packaged.price_rule.direction, packaged.price_rule.base], [10, 300, 98_000, null, "98000"]);
});

test("价格的校验：这种计价方式要的数必填、不该填的不能填；金额是范围内的整数；方向 / 套餐时长和品类对上；区域、车型组必须是这个商品选了的；不合格的什么都不写", async () => {
  const id = await product();
  const post = (body: Record<string, unknown>): Promise<ApiResponse> => call("POST", `/products/${id}/price-rules`, { version: 1, body });
  const cases: [string, Record<string, unknown>, [string, string | undefined][]][] = [
    ["一口价没给基础价", fixed({ base_price: undefined }), [["/base_price", "REQUIRED"]]],
    ["一口价多给了起步价", fixed({ start_price: 100 }), [["/start_price", "NOT_APPLICABLE"]]],
    ["里程 + 时长缺了三个数", fixed({ pricing_model: "mileage_time", base_price: null, start_price: 3_000, per_km: 400 }), [["/start_meters", "REQUIRED"], ["/start_minutes", "REQUIRED"], ["/per_minute", "REQUIRED"]]],
    ["金额带小数", fixed({ base_price: 199.5 }), [["/base_price", "NOT_INTEGER"]]],
    ["金额是 0", fixed({ base_price: 0 }), [["/base_price", "OUT_OF_RANGE"]]],
    ["金额太大", fixed({ base_price: 1_000_000_001 }), [["/base_price", "OUT_OF_RANGE"]]],
    ["接送机没给方向", fixed({ direction: null }), [["/direction", "REQUIRED"]]],
    ["方向不存在", fixed({ direction: "return" }), [["/direction", undefined]]],
    ["接送机给了套餐时长", fixed({ package_hours: 10 }), [["/package_hours", "NOT_APPLICABLE"]]],
    ["接送机用包车套餐", { ...charter(), direction: "pickup", package_hours: null }, [["/pricing_model", "MODEL_NOT_ALLOWED"]]],
    ["计价方式不存在", fixed({ pricing_model: "per_seat" }), [["/pricing_model", undefined]]],
    ["日期不存在", fixed({ valid_from: "2026-02-30" }), [["/valid_from", "INVALID_DATE"]]],
    ["日期倒置", fixed({ valid_from: "2026-10-02", valid_to: "2026-10-01" }), [["/valid_to", "DATE_RANGE_REVERSED"]]],
    ["区域不是这个商品选的", fixed({ area_id: ids["a3"] }), [["/area_id", "AREA_NOT_IN_PRODUCT"]]],
    ["区域不存在", fixed({ area_id: MISSING }), [["/area_id", "AREA_NOT_IN_PRODUCT"]]],
    ["车型组不是这个商品选的", fixed({ vehicle_group_id: ids["lux4"] }), [["/vehicle_group_id", "VEHICLE_GROUP_NOT_IN_PRODUCT"]]],
    ["状态不存在", fixed({ status: "paused" }), [["/status", undefined]]],
  ];
  for (const [label, body, expected] of cases) assert.deepEqual(issues(await post(body)), expected, label);
  assert.deepEqual(await ok(call("GET", `/products/${id}/price-rules`)).then((view) => [view.version, view.items]), [1, []]);
  assert.equal((await api.db.owner.query("select count(*)::int as n from price_rules where product_id = $1", [id])).rows[0].n, 0);
  assert.equal((await post(fixed())).status, 201);
  assert.equal((await call("POST", `/products/${MISSING}/price-rules`, { version: 1, body: fixed() })).status, 404);
});

test("唯一性：同一个「区域 + 车型组 + 方向或套餐时长」的生效日期不能重叠——409 PRICE_RULE_CONFLICT，指出撞上的是哪一条；两头的日期都算；停用的也算", async () => {
  const id = await product();
  const first = (await addPrice(id, fixed({ valid_from: "2026-10-01", valid_to: "2026-12-31" }))).price_rule;
  const clash = async (body: Record<string, unknown>): Promise<any> => {
    const res = await call("POST", `/products/${id}/price-rules`, { version: await version(id), body });
    assert.deepEqual([res.status, res.body.error.code], [409, "PRICE_RULE_CONFLICT"], res.text);
    return res.body.error.details.conflicts;
  };
  assert.deepEqual(await clash(fixed({ valid_from: "2026-12-31", valid_to: "2027-03-31" })), [
    { ref: null, valid_from: "2026-12-31", valid_to: "2027-03-31", with: [{ id: first.id, valid_from: "2026-10-01", valid_to: "2026-12-31" }] },
  ]);
  await clash(fixed({ valid_from: "2026-09-01", valid_to: "2026-10-01" }));
  await clash(fixed({ valid_from: "2026-11-01", valid_to: "2026-11-01" }));
  await clash(fixed({ valid_from: "2026-01-01" }));
  await clash(fixed({ valid_from: "2026-11-01", pricing_model: "mileage_time", base_price: null, start_price: 1, start_meters: 0, start_minutes: 0, per_km: 1, per_minute: 1 }));
  assert.equal((await ok(call("GET", `/products/${id}/price-rules`))).items.length, 1, "被拒绝的都没有写进去");
  // 接着的一段从 2027-01-01 起：可以；停用的那条照样占着日期
  const second = (await addPrice(id, fixed({ valid_from: "2027-01-01", status: "disabled" }))).price_rule;
  assert.equal((await clash(fixed({ valid_from: "2028-01-01" })))[0].with[0].id, second.id);
  // 不是同一个组合的不冲突：接送通用、送机、别的区域、别的车型组
  for (const other of [{ direction: "both" }, { direction: "dropoff" }, { area_id: ids["a2"] }, { vehicle_group_id: ids["eco4"] }]) await addPrice(id, fixed(other));
  // 包车：套餐时长在组合里，同一车型可以同时卖 5 小时和 10 小时
  const charterId = await product("charter");
  await addPrice(charterId, charter({ package_hours: 10 }));
  await addPrice(charterId, charter({ package_hours: 5, package_price: 55_000 }));
  const again = await call("POST", `/products/${charterId}/price-rules`, { version: await version(charterId), body: charter({ package_hours: 5, valid_from: "2027-01-01" }) });
  assert.equal(again.body.error.code, "PRICE_RULE_CONFLICT");
});

test("两个人同时给同一个组合加价格：只有一个成功，另一个 409，库里不会出现重叠的两条（写入前先锁住商品那一行）", async () => {
  const id = await product();
  for (let round = 0; round < 3; round += 1) {
    const current = await version(id);
    const results = await Promise.all(
      [0, 1, 2, 3].map((n) => call("POST", `/products/${id}/price-rules`, { version: current, body: fixed({ direction: "dropoff", base_price: 10_000 + n, valid_from: `202${7 + round}-01-01`, valid_to: `202${7 + round}-12-31` }) })),
    );
    assert.deepEqual(results.map((res) => res.status).sort(), [201, 409, 409, 409], results.map((res) => res.text).join("\n"));
    for (const res of results.filter((entry) => entry.status === 409)) assert.ok(["VERSION_CONFLICT", "CONCURRENT_UPDATE"].includes(res.body.error.code), res.text);
  }
  const rows = (await ok(call("GET", `/products/${id}/price-rules`))).items;
  assert.equal(rows.length, 3);
  // 同一个版本号、不同的日期同时来：也只进一条——后到的要先重新读过别人的改动
  const current = await version(id);
  const disjoint = await Promise.all([2031, 2032].map((year) => call("POST", `/products/${id}/price-rules`, { version: current, body: fixed({ direction: "dropoff", valid_from: `${year}-01-01`, valid_to: `${year}-12-31` }) })));
  assert.deepEqual(disjoint.map((res) => res.status).sort(), [201, 409]);
  assert.equal((await api.db.owner.query("select count(*)::int as n from price_rules where product_id = $1", [id])).rows[0].n, 4);
});

test("修改和删除一条价格：用商品的版本号；审计日志只记变了的字段的前后值；没变化不加版本；改出重叠被拒；不存在是 404", async () => {
  const id = await product();
  const first = (await addPrice(id, fixed({ valid_to: "2026-12-31" }))).price_rule;
  const second = (await addPrice(id, fixed({ valid_from: "2027-01-01" }))).price_rule;
  const put = (ruleId: string, body: Record<string, unknown>, v?: number): Promise<ApiResponse> => call("PUT", `/products/${id}/price-rules/${ruleId}`, { ...(v === undefined ? {} : { version: v }), body });
  assert.equal((await put(first.id, fixed())).status, 428);
  assert.equal((await put(first.id, fixed(), 1)).body.error.code, "VERSION_CONFLICT");
  assert.equal((await ok(put(first.id, fixed({ valid_to: "2026-12-31" }), 3))).version, 3, "内容一样：没有变化");
  const changed = await ok(put(first.id, fixed({ base_price: 22_000, valid_to: "2026-11-30", status: "disabled" }), 3));
  assert.deepEqual([changed.version, changed.price_rule.id, changed.price_rule.base_price, changed.price_rule.valid_to, changed.price_rule.status], [4, first.id, 22_000, "2026-11-30", "disabled"]);
  assert.deepEqual((await audits("price_rule", first.id)).at(-1), {
    action: "update",
    tenant_id: tenant.tenantId,
    actor_email: "admin@a.test",
    before: { params: { basePriceMinor: 20_000 }, valid_to: "2026-12-31", status: "enabled" },
    after: { params: { basePriceMinor: 22_000 }, valid_to: "2026-11-30", status: "disabled" },
  });
  // 把第一条的结束日期拉长到和第二条重叠
  const overlap = await put(first.id, fixed({ valid_to: "2027-01-01" }), 4);
  assert.deepEqual([overlap.status, overlap.body.error.details.conflicts], [409, [{ id: first.id, valid_from: "2026-10-01", valid_to: "2027-01-01", with: [{ id: second.id, valid_from: "2027-01-01", valid_to: null }] }]]);
  // 换成别的计价方式：原来的数清掉
  const metered = await ok(put(first.id, fixed({ pricing_model: "mileage_time", base_price: null, start_price: 3_000, start_meters: 5_000, start_minutes: 20, per_km: 400, per_minute: 80, min_price: 4_500, valid_to: "2026-12-31" }), 4));
  assert.deepEqual([metered.price_rule.pricing_model, metered.price_rule.base_price, metered.price_rule.min_price, metered.price_rule.base], ["mileage_time", null, 4_500, "4500"]);
  assert.equal((await put(MISSING, fixed(), 5)).status, 404);
  assert.equal((await put("not-a-uuid", fixed(), 5)).status, 404);
  // 删除
  assert.equal((await call("DELETE", `/products/${id}/price-rules/${first.id}`)).status, 428);
  assert.deepEqual(await ok(call("DELETE", `/products/${id}/price-rules/${first.id}`, { version: 5 })), { version: 6 });
  assert.equal((await call("DELETE", `/products/${id}/price-rules/${first.id}`, { version: 6 })).status, 404);
  assert.deepEqual((await ok(call("GET", `/products/${id}/price-rules`))).items.map((item: any) => item.id), [second.id]);
  const removed = (await audits("price_rule", first.id)).at(-1);
  assert.deepEqual([removed.action, removed.after, removed.before.pricing_model, removed.before.product_id], ["delete", null, "mileage_time", id]);
});

test("批量保存：新增、修改、删除一次提交，全部成功或全部失败；冲突时指出是哪几条（新增的用 ref，已有的用编号）；一次最多 500 条", async () => {
  const id = await product();
  const batch = (body: Record<string, unknown>, v: number, key?: string): Promise<ApiResponse> => call("POST", `/products/${id}/price-rules/batch`, { version: v, body, ...(key ? { key } : {}) });
  assert.equal((await call("POST", `/products/${id}/price-rules/batch`, { body: {} })).status, 428);
  assert.equal((await call("POST", `/products/${id}/price-rules/batch`, { version: 1, body: {}, key: null })).status, 400);
  assert.equal((await ok(batch({}, 1))).version, 1, "空的一批：没有变化");
  // 一个区域下两个车型组 × 接送通用，再复制到另一个区域：一次 4 条
  const rows = [ids["a1"], ids["a2"]].flatMap((areaId) => [[ids["biz7"], 20_000], [ids["eco4"], 12_000]].map(([vehicleGroupId, price]) => fixed({ area_id: areaId, vehicle_group_id: vehicleGroupId, direction: "both", base_price: price, ref: `${areaId}-${vehicleGroupId}` })));
  const key = randomUUID();
  const saved = await ok(batch({ create: rows }, 1, key));
  assert.deepEqual([saved.version, saved.items.length, saved.created_ids.length, saved.coverage], [2, 4, 4, { total: 8, priced: 8, missing: 0 }]);
  // created_ids 和请求里 create 的顺序一一对应
  assert.deepEqual(saved.created_ids.map((createdId: string) => saved.items.find((item: any) => item.id === createdId).base_price), [20_000, 12_000, 20_000, 12_000]);
  assert.deepEqual(saved.created_ids.map((createdId: string) => saved.items.find((item: any) => item.id === createdId).area_id), [ids["a1"], ids["a1"], ids["a2"], ids["a2"]]);
  assert.deepEqual(await ok(batch({ create: rows }, 1, key)), saved, "同一个键再来：原样返回，不再建一遍");
  assert.equal((await ok(call("GET", `/products/${id}/price-rules`))).items.length, 4);

  const [one, two, three] = saved.created_ids.map((createdId: string) => saved.items.find((item: any) => item.id === createdId));
  const before = await ok(call("GET", `/products/${id}/price-rules`));
  // 一批里有一条不合格：整批不写
  const invalid = await batch({ create: [fixed({ direction: "pickup" }), fixed({ direction: "pickup", base_price: -1, area_id: ids["a3"] })], update: [{ ...fixed({ direction: "both" }), id: MISSING }], delete: [one.id, one.id, MISSING] }, 2);
  assert.deepEqual(issues(invalid), [
    ["/create/1/base_price", "OUT_OF_RANGE"], ["/create/1/area_id", "AREA_NOT_IN_PRODUCT"], ["/update/0/id", "UNKNOWN_PRICE_RULE"], ["/delete/1", "DUPLICATE"], ["/delete/2", "UNKNOWN_PRICE_RULE"],
  ]);
  // 每条问题的 detail 带着是哪一条：新增的是请求里的 ref，修改、删除的是 id（没给 ref 的新增没有）
  const tagged = await batch({ create: [fixed({ direction: "pickup", base_price: -1, ref: "第一行" }), fixed({ direction: "dropoff", area_id: ids["a3"], ref: "第二行" }), fixed({ direction: "both", base_price: 0 })], update: [{ ...fixed({ direction: "both", base_price: 1.5 }), id: one.id }, { ...fixed(), id: MISSING }], delete: [MISSING] }, 2);
  assert.deepEqual(tagged.body.error.details.issues.map((issue: any) => [issue.path, issue.detail]), [
    ["/create/0/base_price", { min: 1, max: 1_000_000_000, ref: "第一行" }],
    ["/create/1/area_id", { ref: "第二行" }],
    ["/create/2/base_price", { min: 1, max: 1_000_000_000 }],
    ["/update/0/base_price", { id: one.id }],
    ["/update/1/id", { id: MISSING }],
    ["/delete/0", { id: MISSING }],
  ]);
  // 一批里的冲突：新增的两条互相撞（用 ref 指回去）；修改的一条撞上库里没动的一条（用编号）
  const conflict = await batch(
    {
      create: [fixed({ direction: "pickup", ref: "甲" }), fixed({ direction: "pickup", valid_from: "2027-01-01", ref: "乙" })],
      update: [{ ...fixed({ direction: "both", vehicle_group_id: ids["eco4"], base_price: 12_000 }), id: one.id }],
    },
    2,
  );
  assert.deepEqual([conflict.status, conflict.body.error.code], [409, "PRICE_RULE_CONFLICT"]);
  assert.deepEqual(conflict.body.error.details.conflicts, [
    { id: one.id, valid_from: "2026-10-01", valid_to: null, with: [{ id: two.id, valid_from: "2026-10-01", valid_to: null }] },
    { ref: "甲", valid_from: "2026-10-01", valid_to: null, with: [{ ref: "乙", valid_from: "2027-01-01", valid_to: null }] },
    { ref: "乙", valid_from: "2027-01-01", valid_to: null, with: [{ ref: "甲", valid_from: "2026-10-01", valid_to: null }] },
  ]);
  assert.deepEqual(await ok(call("GET", `/products/${id}/price-rules`)), before, "被拒绝的两批什么都没写");
  assert.equal((await api.db.owner.query("select count(*)::int as n from audit_logs where resource = 'price_rule' and tenant_id = $1 and after->>'product_id' = $2", [tenant.tenantId, id])).rows[0].n, 4);
  // 一次里又删又加同一个组合：按保存之后的样子判断，不算冲突（换价）
  const swapped = await ok(batch({ delete: [one.id], update: [{ ...fixed({ area_id: two.area_id, vehicle_group_id: two.vehicle_group_id, direction: "both", base_price: 12_500, valid_to: "2026-12-31" }), id: two.id }], create: [fixed({ direction: "both", base_price: 21_000 }), fixed({ area_id: two.area_id, vehicle_group_id: two.vehicle_group_id, direction: "both", base_price: 13_000, valid_from: "2027-01-01" })] }, 2));
  assert.deepEqual([swapped.version, swapped.items.length, swapped.items.find((item: any) => item.id === two.id).base_price, swapped.items.some((item: any) => item.id === one.id), swapped.items.some((item: any) => item.id === three.id)], [3, 5, 12_500, false, true]);
  // 上限
  const tooMany = await batch({ create: Array.from({ length: 501 }, () => fixed()) }, 3);
  assert.deepEqual(issues(tooMany), [["/", "TOO_MANY"]]);
});

test("缺价的组合：逐个组合说有没有价格、用的是哪一条；商品去掉的区域的价格仍然返回但不计入", async () => {
  const id = await product();
  const both = (await addPrice(id, fixed({ direction: "both" }))).price_rule;
  const pickup = (await addPrice(id, fixed({ direction: "pickup", base_price: 22_000 }))).price_rule;
  const later = (await addPrice(id, fixed({ area_id: ids["a2"], direction: "dropoff", valid_from: "2026-11-01" }))).price_rule;
  await addPrice(id, fixed({ area_id: ids["a2"], vehicle_group_id: ids["eco4"], direction: "both", valid_to: "2026-10-06" }));
  await addPrice(id, fixed({ vehicle_group_id: ids["eco4"], direction: "both", status: "disabled" }));
  const coverage = await ok(call("GET", `/products/${id}/price-coverage`));
  assert.deepEqual([coverage.today, coverage.total, coverage.priced, coverage.missing, coverage.packages], [TODAY, 8, 3, 5, []]);
  const state = (areaId: string, groupId: string, direction: string): any => coverage.combos.find((combo: any) => combo.area_id === areaId && combo.vehicle_group_id === groupId && combo.direction === direction);
  assert.deepEqual(state(ids["a1"] as string, ids["biz7"] as string, "pickup"), { area_id: ids["a1"], vehicle_group_id: ids["biz7"], direction: "pickup", package_hours: null, state: "priced", price_rule_id: pickup.id, via_both: false, from: "2026-10-01" });
  assert.deepEqual([state(ids["a1"] as string, ids["biz7"] as string, "dropoff").price_rule_id, state(ids["a1"] as string, ids["biz7"] as string, "dropoff").via_both], [both.id, true]);
  assert.deepEqual([state(ids["a2"] as string, ids["biz7"] as string, "dropoff").state, state(ids["a2"] as string, ids["biz7"] as string, "dropoff").from, state(ids["a2"] as string, ids["biz7"] as string, "dropoff").price_rule_id], ["upcoming", "2026-11-01", later.id]);
  assert.deepEqual(["pickup", "dropoff"].map((direction) => state(ids["a2"] as string, ids["eco4"] as string, direction).state), ["missing", "missing"], "过期的不算");
  assert.deepEqual(["pickup", "dropoff"].map((direction) => state(ids["a1"] as string, ids["eco4"] as string, direction).state), ["missing", "missing"], "停用的不算");
  assert.deepEqual((await ok(call("GET", `/products/${id}/price-rules`))).coverage, { total: 8, priced: 3, missing: 5 });
  // 商品去掉第二个区域：它的价格还在（还能改、能删），但不再计入「该有价格的组合」
  const item = await ok(call("GET", `/products/${id}`));
  await ok(call("PATCH", `/products/${id}`, { version: item.version, body: { areas: [{ area_id: ids["a1"] }] } }));
  const after = await ok(call("GET", `/products/${id}/price-rules`));
  assert.deepEqual([after.items.length, after.coverage], [5, { total: 4, priced: 2, missing: 2 }]);
  assert.equal((await call("PUT", `/products/${id}/price-rules/${later.id}`, { version: after.version, body: fixed({ area_id: ids["a2"], direction: "dropoff", valid_from: "2026-11-01", base_price: 19_000 }) })).status, 200, "已经不在商品里的区域的价格，不换区域照样能改");
  assert.deepEqual(issues(await call("POST", `/products/${id}/price-rules`, { version: await version(id), body: fixed({ area_id: ids["a2"], vehicle_group_id: ids["eco4"], direction: "pickup", valid_from: "2027-01-01" }) })), [["/area_id", "AREA_NOT_IN_PRODUCT"]]);
  assert.equal((await call("GET", `/products/${MISSING}/price-coverage`)).status, 404);
});

test("上架接上了价格规则：没有启用且未过期的价格不能上架（分没有 / 都停用 / 都过期三种原因）；有了就能真的上架；缺价的组合不拦", async () => {
  const id = await publishable();
  const priceItem = async (): Promise<any> => (await ok(call("GET", `/products/${id}/publish-check`))).items.find((item: any) => item.key === "price_rules");
  assert.deepEqual([(await priceItem()).passed, (await priceItem()).issues.map((issue: any) => issue.reason)], [false, ["NO_ACTIVE_PRICE_RULE"]]);
  const refused = await call("POST", `/products/${id}/publish`);
  assert.deepEqual([refused.status, refused.body.error.code, refused.body.error.details.items.filter((item: any) => !item.passed).map((item: any) => item.key)], [409, "PUBLISH_CHECK_FAILED", ["price_rules"]]);
  // 只有停用的
  const rule = (await addPrice(id, fixed({ status: "disabled" }))).price_rule;
  assert.deepEqual((await priceItem()).issues.map((issue: any) => issue.reason), ["ALL_PRICE_RULES_DISABLED"]);
  // 启用但昨天到期
  await ok(call("PUT", `/products/${id}/price-rules/${rule.id}`, { version: await version(id), body: fixed({ valid_to: "2026-10-06" }) }));
  assert.deepEqual((await priceItem()).issues.map((issue: any) => issue.reason), ["ALL_PRICE_RULES_EXPIRED"]);
  assert.equal((await call("POST", `/products/${id}/publish`)).status, 409);
  // 今天到期：还算；以后才开始生效的也算
  await ok(call("PUT", `/products/${id}/price-rules/${rule.id}`, { version: await version(id), body: fixed({ valid_to: TODAY }) }));
  assert.equal((await priceItem()).passed, true);
  const check = await ok(call("GET", `/products/${id}/publish-check`));
  assert.deepEqual([check.can_publish, check.items.map((item: any) => [item.key, item.passed])], [true, [["basic_info", true], ["service_rules", true], ["price_rules", true], ["content", true], ["adjust_rules", true], ["inventory", true]]]);
  // 8 个组合只有 1 个有价格：照样能上架
  const published = await ok(call("POST", `/products/${id}/publish`));
  assert.deepEqual([published.status, typeof published.published_at], ["published", "string"]);
  assert.equal((await ok(call("GET", `/products?status=published`))).items.find((item: any) => item.id === id).check.can_publish, true);
  const log = (await audits("product", id)).at(-1);
  assert.deepEqual([log.action, log.before, log.after], ["publish", { status: "draft" }, { status: "published" }]);
});

test("已上架的商品：价格可以改、可以加，但改完必须仍然有启用且未过期的价格，否则这次修改被拒绝、什么都不变", async () => {
  const id = await publishable();
  const only = (await addPrice(id, fixed())).price_rule;
  await ok(call("POST", `/products/${id}/publish`));
  const before = await ok(call("GET", `/products/${id}/price-rules`));
  const expectRefused = async (res: ApiResponse): Promise<void> => {
    assert.deepEqual([res.status, res.body.error.code], [409, "PUBLISH_CHECK_FAILED"], res.text);
    assert.deepEqual(res.body.error.details.items.filter((item: any) => !item.passed).map((item: any) => item.key), ["price_rules"]);
    assert.deepEqual(await ok(call("GET", `/products/${id}/price-rules`)), before);
  };
  await expectRefused(await call("DELETE", `/products/${id}/price-rules/${only.id}`, { version: before.version }));
  await expectRefused(await call("PUT", `/products/${id}/price-rules/${only.id}`, { version: before.version, body: fixed({ status: "disabled" }) }));
  await expectRefused(await call("PUT", `/products/${id}/price-rules/${only.id}`, { version: before.version, body: fixed({ valid_to: "2026-10-06" }) }));
  await expectRefused(await call("POST", `/products/${id}/price-rules/batch`, { version: before.version, body: { delete: [only.id] } }));
  // 改价、加别的组合、先加一条再删原来的：都可以
  assert.equal((await call("PUT", `/products/${id}/price-rules/${only.id}`, { version: before.version, body: fixed({ base_price: 23_000 }) })).status, 200);
  const swapped = await ok(call("POST", `/products/${id}/price-rules/batch`, { version: before.version + 1, body: { delete: [only.id], create: [fixed({ direction: "both", base_price: 21_000 })] } }));
  assert.deepEqual([swapped.items.length, swapped.items[0].direction], [1, "both"]);
  assert.equal((await ok(call("GET", `/products/${id}`))).status, "published");
  // 下架之后就可以把价格删光
  await ok(call("POST", `/products/${id}/unpublish`));
  assert.equal((await call("DELETE", `/products/${id}/price-rules/${swapped.items[0].id}`, { version: await version(id) })).status, 200);
  assert.equal((await call("POST", `/products/${id}/publish`)).body.error.code, "PUBLISH_CHECK_FAILED", "再上架同样要过校验");
});

test("调价规则：新增排在最后；整体修改、启用 / 停用、删除；顺序即优先级，可以重排；都用商品的版本号、都写审计日志", async () => {
  const id = await product();
  assert.deepEqual(await ok(call("GET", `/products/${id}/adjust-rules`)), { version: 1, currency: "JPY", rounding_unit: 1, today: TODAY, items: [] });
  assert.equal((await call("POST", `/products/${id}/adjust-rules`, { version: 1, body: adjustBody(), key: null })).status, 400);
  assert.equal((await call("POST", `/products/${id}/adjust-rules`, { body: adjustBody() })).status, 428);
  assert.equal((await call("POST", `/products/${id}/adjust-rules`, { version: 5, body: adjustBody() })).body.error.code, "VERSION_CONFLICT");
  const key = randomUUID();
  const body = adjustBody({ name: " 国庆旺季 ", travel_from: "2027-10-01", travel_to: "2027-10-07", time_slot: { start: "22:00", end: "06:00" }, area_ids: [ids["a1"]], directions: ["pickup"], steps: [{ type: "percent", value: 2_000 }, { type: "amount", value: -500 }] });
  const first = await ok(call("POST", `/products/${id}/adjust-rules`, { version: 1, body, key }), 201);
  assert.equal(first.version, 2);
  const { id: firstId, created_at: _c, updated_at: _u, ...rule } = first.adjust_rule;
  assert.deepEqual(rule, {
    name: "国庆旺季", travel_from: "2027-10-01", travel_to: "2027-10-07", cycle: { type: "daily" }, time_slot: { start: "22:00", end: "06:00" }, area_ids: [ids["a1"]], vehicle_group_ids: [], directions: ["pickup"], package_hours: [],
    steps: [{ type: "percent", value: 2_000 }, { type: "amount", value: -500 }], status: "enabled", ended: false,
  });
  assert.deepEqual(await ok(call("POST", `/products/${id}/adjust-rules`, { version: 1, body, key }), 201), first, "同一个键再来：原样返回");
  const second = await addAdjust(id, adjustBody({ name: "周末", cycle: { type: "weekly", weekdays: [6, 7] }, steps: [{ type: "amount", value: 1_000 }] }));
  const third = await addAdjust(id, adjustBody({ name: "去年的活动", travel_to: "2026-10-06", cycle: { type: "dates", dates: ["2026-10-01", "2026-10-06"] }, status: "disabled" }));
  const listed = await ok(call("GET", `/products/${id}/adjust-rules`));
  assert.deepEqual([listed.version, listed.items.map((item: any) => [item.name, item.status, item.ended])], [4, [["国庆旺季", "enabled", false], ["周末", "enabled", false], ["去年的活动", "disabled", true]]]);

  // 整体修改
  const put = (ruleId: string, payload: Record<string, unknown>, v?: number): Promise<ApiResponse> => call("PUT", `/products/${id}/adjust-rules/${ruleId}`, { ...(v === undefined ? {} : { version: v }), body: payload });
  assert.equal((await put(second.id, adjustBody())).status, 428);
  assert.equal((await put(second.id, adjustBody(), 1)).body.error.code, "VERSION_CONFLICT");
  const changed = await ok(put(second.id, adjustBody({ name: "周末", cycle: { type: "weekly", weekdays: [5, 6, 7] }, steps: [{ type: "amount", value: 1_500 }] }), 4));
  assert.deepEqual([changed.version, changed.adjust_rule.cycle, changed.adjust_rule.steps], [5, { type: "weekly", weekdays: [5, 6, 7] }, [{ type: "amount", value: 1_500 }]]);
  assert.equal((await ok(put(second.id, adjustBody({ name: "周末", cycle: { type: "weekly", weekdays: [5, 6, 7] }, steps: [{ type: "amount", value: 1_500 }] }), 5))).version, 5, "内容一样：没有变化");
  assert.deepEqual((await audits("adjust_rule", second.id)).map((log) => [log.action, log.before === null ? null : Object.keys(log.before).sort()]), [["create", null], ["update", ["cycle", "steps"]]]);
  assert.equal((await put(MISSING, adjustBody(), 5)).status, 404);

  // 启用 / 停用：不要版本号；重复调用不重复记
  const off = await ok(call("POST", `/products/${id}/adjust-rules/${firstId}/disable`));
  assert.deepEqual([off.version, off.adjust_rule.status], [6, "disabled"]);
  assert.equal((await ok(call("POST", `/products/${id}/adjust-rules/${firstId}/disable`))).version, 6);
  assert.deepEqual([(await ok(call("POST", `/products/${id}/adjust-rules/${firstId}/enable`))).version, (await audits("adjust_rule", firstId)).map((log) => log.action)], [7, ["create", "disable", "enable"]]);
  assert.equal((await call("POST", `/products/${id}/adjust-rules/${MISSING}/enable`)).status, 404);

  // 重排：要给全部编号；顺序没变不加版本
  const order = (idsInOrder: string[], v: number): Promise<ApiResponse> => call("PUT", `/products/${id}/adjust-rules/order`, { version: v, body: { ids: idsInOrder } });
  assert.equal((await call("PUT", `/products/${id}/adjust-rules/order`, { body: { ids: [] } })).status, 428);
  assert.deepEqual(issues(await order([firstId, second.id], 7)), [["/ids", "IDS_MISMATCH"]]);
  assert.deepEqual(issues(await order([firstId, second.id, second.id], 7)), [["/ids", "IDS_MISMATCH"]]);
  assert.deepEqual(issues(await order([firstId, second.id, MISSING], 7)), [["/ids", "IDS_MISMATCH"]]);
  assert.equal((await ok(order([firstId, second.id, third.id], 7))).version, 7);
  const reordered = await ok(order([third.id, firstId, second.id], 7));
  assert.deepEqual([reordered.version, reordered.items.map((item: any) => item.name)], [8, ["去年的活动", "国庆旺季", "周末"]]);
  assert.deepEqual((await audits("product", id)).at(-1).after, { adjust_rule_order: [third.id, firstId, second.id] });
  // 新增的排在最后
  await addAdjust(id, adjustBody({ name: "新的" }));
  assert.deepEqual((await ok(call("GET", `/products/${id}/adjust-rules`))).items.map((item: any) => item.name), ["去年的活动", "国庆旺季", "周末", "新的"]);

  // 删除
  assert.equal((await call("DELETE", `/products/${id}/adjust-rules/${third.id}`)).status, 428);
  assert.deepEqual(await ok(call("DELETE", `/products/${id}/adjust-rules/${third.id}`, { version: 9 })), { version: 10 });
  assert.equal((await call("DELETE", `/products/${id}/adjust-rules/${third.id}`, { version: 10 })).status, 404);
  assert.deepEqual((await audits("adjust_rule", third.id)).map((log) => log.action), ["create", "delete"]);
  assert.equal((await ok(call("GET", `/products/${id}`))).version, 10, "调价规则变了，商品的版本号跟着加");
});

test("调价规则的校验：名称、日期、周期、时段、步骤；适用的区域和车型组必须是商品选了的；把价格调到不大于 0 的规则存不了", async () => {
  const id = await product();
  const post = (body: Record<string, unknown>): Promise<ApiResponse> => call("POST", `/products/${id}/adjust-rules`, { version: 1, body });
  const cases: [string, Record<string, unknown>, [string, string | undefined][]][] = [
    ["名称是空的", adjustBody({ name: " " }), [["/name", "REQUIRED"]]],
    ["名称太长", adjustBody({ name: "旺".repeat(51) }), [["/name", "TOO_LONG"]]],
    ["日期倒置", adjustBody({ travel_from: "2027-10-07", travel_to: "2027-10-01" }), [["/travel_to", "DATE_RANGE_REVERSED"]]],
    ["周期不存在", adjustBody({ cycle: { type: "monthly" } }), [["/cycle/type", undefined]]],
    ["每周没选星期", adjustBody({ cycle: { type: "weekly", weekdays: [] } }), [["/cycle/weekdays", "REQUIRED"]]],
    ["星期写了 0 和 8", adjustBody({ cycle: { type: "weekly", weekdays: [0, 8] } }), [["/cycle/weekdays/0", "OUT_OF_RANGE"], ["/cycle/weekdays/1", "OUT_OF_RANGE"]]],
    ["指定日期不存在、重复", adjustBody({ cycle: { type: "dates", dates: ["2027-02-29", "2027-05-01", "2027-05-01"] } }), [["/cycle/dates/0", "INVALID_DATE"], ["/cycle/dates/2", "DUPLICATE"]]],
    ["节假日的国家码不对", adjustBody({ cycle: { type: "holidays", countries: ["Japan"] } }), [["/cycle/countries/0", "INVALID_COUNTRY"]]],
    ["时段写法不对", adjustBody({ time_slot: { start: "9:00", end: "18:00" } }), [["/time_slot", "INVALID_TIME"]]],
    ["时段是空的", adjustBody({ time_slot: { start: "08:00", end: "08:00" } }), [["/time_slot", "EMPTY_WINDOW"]]],
    ["没有步骤", adjustBody({ steps: [] }), [["/steps", "REQUIRED"]]],
    ["步骤是 0、带小数、下调 100%", adjustBody({ steps: [{ type: "amount", value: 0 }, { type: "percent", value: 12.5 }, { type: "percent", value: -10_000 }] }), [["/steps/0/value", "ZERO_STEP"], ["/steps/1/value", "NOT_INTEGER"], ["/steps/2/value", "OUT_OF_RANGE"]]],
    ["步骤类型不存在", adjustBody({ steps: [{ type: "multiply", value: 2 }] }), [["/steps/0/type", undefined]]],
    ["接送机不能选套餐", adjustBody({ package_hours: [10] }), [["/package_hours", "NOT_APPLICABLE"]]],
    ["区域不是商品选的", adjustBody({ area_ids: [ids["a1"], ids["a3"], MISSING] }), [["/area_ids/1", "AREA_NOT_IN_PRODUCT"], ["/area_ids/2", "AREA_NOT_IN_PRODUCT"]]],
    ["车型组不是商品选的", adjustBody({ vehicle_group_ids: [ids["lux4"]] }), [["/vehicle_group_ids/0", "VEHICLE_GROUP_NOT_IN_PRODUCT"]]],
  ];
  for (const [label, body, expected] of cases) assert.deepEqual(issues(await post(body)), expected, label);
  assert.deepEqual((await ok(call("GET", `/products/${id}/adjust-rules`))).items, []);

  // 调完不大于 0：基础价 5000 减 5000
  await addPrice(id, fixed({ base_price: 5_000 }));
  await addPrice(id, fixed({ area_id: ids["a2"], base_price: 9_000 }));
  const tooLow = await call("POST", `/products/${id}/adjust-rules`, { version: await version(id), body: adjustBody({ steps: [{ type: "amount", value: -5_000 }] }) });
  assert.deepEqual(issues(tooLow), [["/steps", "ADJUST_RESULT_NOT_POSITIVE"]]);
  assert.deepEqual(tooLow.body.error.details.issues[0].detail, { count: 1 });
  // 只管另一个区域就没事；停用着存也可以，但启用时再查一遍
  const scoped = await addAdjust(id, adjustBody({ area_ids: [ids["a2"]], steps: [{ type: "amount", value: -5_000 }] }));
  const parked = await addAdjust(id, adjustBody({ name: "先放着", status: "disabled", steps: [{ type: "amount", value: -5_000 }] }));
  assert.deepEqual(issues(await call("POST", `/products/${id}/adjust-rules/${parked.id}/enable`)), [["/steps", "ADJUST_RESULT_NOT_POSITIVE"]]);
  assert.deepEqual(issues(await call("PUT", `/products/${id}/adjust-rules/${scoped.id}`, { version: await version(id), body: adjustBody({ steps: [{ type: "amount", value: -5_000 }] }) })), [["/steps", "ADJUST_RESULT_NOT_POSITIVE"]]);
  // 价格后来降了、把已有的调价规则变成「调到不大于 0」：价格照样能存，上架校验的「调价规则」一项指出来（不拦上架）
  const cheap = (await ok(call("GET", `/products/${id}/price-rules`))).items.find((item: any) => item.area_id === ids["a2"]);
  await ok(call("PUT", `/products/${id}/price-rules/${cheap.id}`, { version: await version(id), body: fixed({ area_id: ids["a2"], base_price: 4_000 }) }));
  const item = (await ok(call("GET", `/products/${id}/publish-check`))).items.find((entry: any) => entry.key === "adjust_rules");
  assert.deepEqual([item.required, item.passed, item.issues.map((issue: any) => [issue.path, issue.reason])], [false, false, [["/0", "ADJUST_RESULT_NOT_POSITIVE"]]]);
  assert.deepEqual(item.issues[0].detail, { rule_id: scoped.id, name: "旺季" }, "带上是哪一条调价规则");
});

test("价格日历：一个组合每天的结算价和命中的规则——基础价 → 按顺序链式调价 → 按取整单位取整；跨午夜的时段算在开始那天头上；和 domain 的算法是同一个", async () => {
  const id = await product();
  await addPrice(id, fixed({ direction: "both", base_price: 20_050 }));
  const pickup = (await addPrice(id, fixed({ direction: "pickup", base_price: 22_000, valid_from: "2026-10-12", valid_to: "2026-10-13" }))).price_rule;
  const weekend = await addAdjust(id, adjustBody({ name: "周末", cycle: { type: "weekly", weekdays: [6, 7] }, steps: [{ type: "percent", value: 1_550 }] }));
  const night = await addAdjust(id, adjustBody({ name: "周五深夜", cycle: { type: "weekly", weekdays: [5] }, time_slot: { start: "22:00", end: "06:00" }, steps: [{ type: "amount", value: 3_000 }] }));
  await addAdjust(id, adjustBody({ name: "停用的", status: "disabled", steps: [{ type: "percent", value: 9_000 }] }));
  await addAdjust(id, adjustBody({ name: "只管送机", directions: ["dropoff"], steps: [{ type: "amount", value: -50 }] }));
  const query = `area_id=${ids["a1"]}&vehicle_group_id=${ids["biz7"]}&direction=pickup`;
  // 2026-10-09 周五 到 10-13 周二
  const view = await calendar(id, `${query}&from=2026-10-09&to=2026-10-13`);
  assert.deepEqual([view.currency, view.rounding_unit, view.today, view.days.map((day: any) => [day.date, day.weekday, day.holiday, day.segments.length])], [
    "JPY", 1, TODAY,
    [["2026-10-09", 5, null, 2], ["2026-10-10", 6, null, 2], ["2026-10-11", 7, null, 1], ["2026-10-12", 1, null, 1], ["2026-10-13", 2, null, 1]],
  ]);
  const summary = (day: any): unknown[] => day.segments.map((segment: any) => [segment.from, segment.to, segment.final, segment.unrounded, segment.adjusts.map((entry: any) => entry.name)]);
  // 周五：白天没有调价；22:00 起深夜 +3000
  assert.deepEqual(summary(view.days[0]), [["00:00", "22:00", 20_050, "20050", []], ["22:00", "24:00", 23_050, "23050", ["周五深夜"]]]);
  // 周六：凌晨还算周五夜里——先周末 +15.5%，再深夜 +3000（顺序即优先级）：20050 × 1.155 = 23157.75，+3000 = 26157.75 → 26158
  assert.deepEqual(summary(view.days[1]), [["00:00", "06:00", 26_158, "26157.75", ["周末", "周五深夜"]], ["06:00", "24:00", 23_158, "23157.75", ["周末"]]]);
  assert.deepEqual(view.days[1].segments[0].adjusts, [
    { rule_id: weekend.id, name: "周末", steps: [{ type: "percent", value: 1_550, delta: "3107.75", after: "23157.75" }] },
    { rule_id: night.id, name: "周五深夜", steps: [{ type: "amount", value: 3_000, delta: "3000", after: "26157.75" }] },
  ]);
  assert.deepEqual(view.days[1].segments[0].base, "20050");
  // 周日整天一段；周一、周二接机有自己的价（更具体的优先）
  assert.deepEqual(summary(view.days[2]), [["00:00", "24:00", 23_158, "23157.75", ["周末"]]]);
  assert.deepEqual([view.days[3].price_rule, summary(view.days[3])], [{ id: pickup.id, pricing_model: "fixed", direction: "pickup", valid_from: "2026-10-12", valid_to: "2026-10-13" }, [["00:00", "24:00", 22_000, "22000", []]]]);
  assert.equal(view.days[0].price_rule.direction, "both");
  // 送机：多一条 −50，排在最后
  const dropoff = await calendar(id, `area_id=${ids["a1"]}&vehicle_group_id=${ids["biz7"]}&direction=dropoff&from=2026-10-10&to=2026-10-10`);
  assert.deepEqual(summary(dropoff.days[0])[0], ["00:00", "06:00", 26_108, "26107.75", ["周末", "周五深夜", "只管送机"]]);
  // 换一种顺序：深夜排到周末前面，周六凌晨变成 (20050 + 3000) × 1.155 = 26622.75
  const order = (await ok(call("GET", `/products/${id}/adjust-rules`))).items.map((item: any) => item.id);
  await ok(call("PUT", `/products/${id}/adjust-rules/order`, { version: await version(id), body: { ids: [order[1], order[0], order[2], order[3]] } }));
  assert.deepEqual(summary((await calendar(id, `${query}&from=2026-10-10&to=2026-10-10`)).days[0])[0], ["00:00", "06:00", 26_623, "26622.75", ["周五深夜", "周末"]]);
  // 没有价格的组合、不在生效期的日子：final 是 null，带原因
  const none = await calendar(id, `area_id=${ids["a2"]}&vehicle_group_id=${ids["biz7"]}&direction=pickup&from=2026-10-10&to=2026-10-10`);
  assert.deepEqual([none.days[0].price_rule, none.days[0].segments], [null, [{ from: "00:00", to: "24:00", final: null, no_price_reason: "NO_RULE", base: null, unrounded: null, adjusts: [] }]]);
  assert.equal((await calendar(id, `${query}&from=2026-09-30&to=2026-09-30`)).days[0].segments[0].no_price_reason, "NOT_IN_EFFECT");
  // 一次看几个车型组（对比表）：每个各一份，顺序和请求里的一样；days 是第一个的
  await addPrice(id, fixed({ vehicle_group_id: ids["eco4"], direction: "both", base_price: 12_000 }));
  const compared = await calendar(id, `area_id=${ids["a1"]}&vehicle_group_id=${ids["eco4"]},${ids["biz7"]},${ids["eco4"]}&direction=pickup&from=2026-10-10&to=2026-10-11`);
  assert.deepEqual(compared.groups.map((group: any) => [group.vehicle_group_id, group.days.map((day: any) => day.segments.at(-1).final)]), [[ids["eco4"], [13_860, 13_860]], [ids["biz7"], [23_158, 23_158]]]);
  assert.deepEqual(compared.days, compared.groups[0].days);
  assert.equal((await calendar(id, `${query}&from=2026-10-10&to=2026-10-10`)).groups.length, 1);
  assert.equal((await call("GET", `/products/${id}/price-calendar?area_id=${ids["a1"]}&vehicle_group_id=${ids["biz7"]},nope&direction=pickup&from=2026-10-10&to=2026-10-10`)).status, 400);
  assert.equal((await call("GET", `/products/${id}/price-calendar?area_id=${ids["a1"]}&vehicle_group_id=${Array.from({ length: 21 }, (_, n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`).join(",")}&direction=pickup&from=2026-10-10&to=2026-10-10`)).status, 400);
  // 参数：方向必填、日期合法、最多 62 天
  const bad = async (params: string): Promise<[string, string | undefined][]> => issues(await call("GET", `/products/${id}/price-calendar?${params}`));
  assert.deepEqual(await bad(`area_id=${ids["a1"]}&vehicle_group_id=${ids["biz7"]}&from=2026-10-01&to=2026-10-02`), [["/direction", "REQUIRED"]]);
  assert.deepEqual(await bad(`${query}&package_hours=10&from=2026-10-01&to=2026-10-02`), [["/package_hours", "NOT_APPLICABLE"]]);
  assert.deepEqual(await bad(`${query}&from=2026-10-02&to=2026-10-01`), [["/to", "DATE_RANGE_REVERSED"]]);
  assert.deepEqual(await bad(`${query}&from=2026-02-30&to=2026-10-01`), [["/from", "INVALID_DATE"]]);
  assert.deepEqual(await bad(`${query}&from=2026-10-01&to=2026-12-02`), [["/to", "TOO_MANY"]]);
  assert.equal((await calendar(id, `${query}&from=2026-10-01&to=2026-12-01`)).days.length, 62);
  assert.equal((await call("GET", `/products/${id}/price-calendar?${query}&from=2026-10-01`)).status, 400);
  assert.equal((await call("GET", `/products/${MISSING}/price-calendar?${query}&from=2026-10-01&to=2026-10-02`)).status, 404);
});

test("取整单位：管理员给子品牌设（可选的值由币种决定）；设了之后价格日历按它取整，没有调价也取整；只有管理员能改；写审计日志", async () => {
  const brand = await ok(call("POST", "/brands", { body: { name: "取整测试", currency: "JPY" } }), 201);
  const usd = await ok(call("POST", "/brands", { body: { name: "美元品牌", currency: "USD" } }), 201);
  const put = (brandId: string, unit: unknown, v?: number, token?: string): Promise<ApiResponse> => call("PUT", `/brands/${brandId}/rounding-unit`, { ...(v === undefined ? {} : { version: v }), body: { rounding_unit: unit }, ...(token ? { token } : {}) });
  assert.equal((await put(brand.id, 100)).status, 428);
  assert.equal((await put(brand.id, 100, 9)).body.error.code, "VERSION_CONFLICT");
  assert.deepEqual(issues(await put(brand.id, 50, 1)), [["/rounding_unit", "OUT_OF_RANGE"]]);
  assert.deepEqual(issues(await put(brand.id, 10_000, 1)), [["/rounding_unit", "OUT_OF_RANGE"]], "日元最大取整到 1000");
  assert.equal((await put(usd.id, 10_000, 1)).status, 200, "美元可以取整到 100 元（10000 分）");
  assert.equal((await put(brand.id, 1.5, 1)).status, 400);
  assert.deepEqual(await ok(put(brand.id, 1, 1)), { id: brand.id, rounding_unit: 1, version: 1 }, "没变化不加版本");
  assert.deepEqual(await ok(put(brand.id, 100, 1)), { id: brand.id, rounding_unit: 100, version: 2 });
  assert.deepEqual((await audits("brand", brand.id)).at(-1), { action: "update", tenant_id: tenant.tenantId, actor_email: "admin@a.test", before: { rounding_unit: 1 }, after: { rounding_unit: 100 } });
  assert.equal((await put(MISSING, 100, 1)).status, 404);
  const pricing = (await addTenantUser(api, tenant.adminToken, "pricing-r@a.test", "pricing")).token;
  assert.equal((await put(brand.id, 10, 2, pricing)).status, 403, "商品价格角色不能改取整单位");
  // 子品牌的应答结构没有变（前端的契约测试钉着）；取整单位从价格规则的应答里读
  assert.deepEqual(Object.keys((await ok(call("GET", "/brands"))).items[0]).sort(), ["created_at", "currency", "id", "name", "status", "updated_at", "version"]);

  // 这个子品牌下的商品：20050 → 20100（没有调价也取整）；+15.5% = 23157.75 → 23200
  api.clock.advance(1_000);
  const id = (await ok(call("POST", "/products", { body: { brand_id: brand.id, city_id: ids["tokyo"], category: "point_to_point", areas: [{ area_id: ids["a1"] }], vehicle_groups: [{ vehicle_group_id: ids["biz7"], passengers: 6, luggage: 2 }] } }), 201)).id;
  await addPrice(id, fixed({ direction: null, base_price: 20_050 }));
  await addAdjust(id, adjustBody({ name: "周末", cycle: { type: "weekly", weekdays: [6, 7] }, steps: [{ type: "percent", value: 1_550 }] }));
  assert.equal((await ok(call("GET", `/products/${id}/price-rules`))).rounding_unit, 100);
  const view = await calendar(id, `area_id=${ids["a1"]}&vehicle_group_id=${ids["biz7"]}&from=2026-10-09&to=2026-10-10`);
  assert.deepEqual([view.rounding_unit, view.days.map((day: any) => [day.segments[0].final, day.segments[0].unrounded])], [100, [[20_100, "20050"], [23_200, "23157.75"]]]);
});

test("节假日日历：平台逐条登记、修改、删除（写审计日志），租户只读；调价规则的周期选节假日时按它生效；没有数据就不生效", async () => {
  const range = "from=2027-01-01&to=2027-12-31";
  assert.deepEqual(await ok(platform("GET", `/holidays?${range}`)), { items: [], countries: [] });
  const put = (country: string, date: string, body: unknown): Promise<ApiResponse> => platform("PUT", `/holidays/${country}/${date}`, body);
  const created = await ok(put("JP", "2027-01-01", { name: { ja: "元日", zh: "元旦" } }), 201);
  assert.deepEqual([created.country_code, created.date, created.name], ["JP", "2027-01-01", { ja: "元日", zh: "元旦" }]);
  assert.equal((await put("JP", "2027-01-01", { name: { ja: "元日", zh: "元旦" } })).status, 200, "内容一样：不重复记");
  assert.deepEqual((await ok(put("JP", "2027-01-01", { name: { ja: "元日" } }))).name, { ja: "元日" });
  await ok(put("JP", "2027-10-11", { name: { ja: "スポーツの日" } }), 201);
  await ok(put("CN", "2027-10-01", { name: { zh: "国庆节" } }), 201);
  assert.equal((await put("JP", "2027-02-30", { name: { ja: "x" } })).status, 404);
  assert.equal((await put("Japan", "2027-01-01", { name: { ja: "x" } })).status, 404);
  assert.equal((await put("JP", "2027-05-03", { name: {} })).status, 400);
  assert.equal((await put("JP", "2027-05-03", { name: { fr: "x" } })).status, 400);
  const logs = await audits("holiday", "JP:2027-01-01");
  assert.deepEqual(logs.map((log) => [log.action, log.tenant_id, log.before, log.after.name]), [["create", null, null, { ja: "元日", zh: "元旦" }], ["update", null, { name: { ja: "元日", zh: "元旦" } }, { ja: "元日" }]]);
  // 查询：按国家、按日期；带「哪些国家有数据」
  const all = await ok(platform("GET", `/holidays?${range}`));
  assert.deepEqual([all.items.map((item: any) => `${item.country_code} ${item.date}`), all.countries], [
    ["JP 2027-01-01", "CN 2027-10-01", "JP 2027-10-11"],
    [{ country_code: "CN", count: 1, last_date: "2027-10-01" }, { country_code: "JP", count: 2, last_date: "2027-10-11" }],
  ]);
  const japan = await ok(call("GET", `/holidays?country_code=JP&from=2027-10-01&to=2027-10-31`));
  assert.deepEqual(japan.items.map((item: any) => [item.country_code, item.date, item.name]), [["JP", "2027-10-11", { ja: "スポーツの日" }]]);
  assert.equal((await ok(call("GET", `/holidays?country_code=JP,CN&${range}`))).items.length, 3);
  for (const bad of ["from=2027-01-01", "from=2027-02-30&to=2027-03-01", "from=2027-03-02&to=2027-03-01", "from=2020-01-01&to=2027-01-01", `country_code=japan&${range}`]) assert.equal((await call("GET", `/holidays?${bad}`)).status, 400, bad);
  // 租户不能写；没登录看不了
  assert.equal((await api.call("PUT", "/platform/v1/holidays/JP/2027-05-03", { token: tenant.adminToken, body: { name: { ja: "x" } } })).status, 401);
  assert.equal((await api.call("GET", `/tenant/v1/holidays?${range}`)).status, 401);

  // 调价规则「节假日 +30%」：日本的节假日生效，中国的国庆不生效（规则只选了日本）
  const id = await product();
  await addPrice(id, fixed({ direction: "both", base_price: 10_000 }));
  await addAdjust(id, adjustBody({ name: "节假日", cycle: { type: "holidays", countries: ["JP"] }, steps: [{ type: "percent", value: 3_000 }] }));
  const view = await calendar(id, `area_id=${ids["a1"]}&vehicle_group_id=${ids["biz7"]}&direction=pickup&from=2027-10-01&to=2027-10-12`);
  const byDate = Object.fromEntries(view.days.map((day: any) => [day.date, [day.holiday, day.segments[0].final]]));
  assert.deepEqual([byDate["2027-10-01"], byDate["2027-10-10"], byDate["2027-10-11"], byDate["2027-10-12"]], [[null, 10_000], [null, 10_000], [{ name: { ja: "スポーツの日" } }, 13_000], [null, 10_000]]);
  // 删掉这一天：不再生效
  assert.equal((await platform("DELETE", "/holidays/JP/2027-10-11")).status, 204);
  assert.equal((await platform("DELETE", "/holidays/JP/2027-10-11")).status, 404);
  assert.equal((await calendar(id, `area_id=${ids["a1"]}&vehicle_group_id=${ids["biz7"]}&direction=pickup&from=2027-10-11&to=2027-10-11`)).days[0].segments[0].final, 10_000);
  assert.deepEqual((await audits("holiday", "JP:2027-10-11")).map((log) => log.action), ["create", "delete"]);
});

test("价格概况：每个商品有没有启用且未过期的价格（按各自城市当地的今天），首页用的两个数只数草稿和已上架的", async () => {
  const fresh = await api.tenantWithAdmin(root, "新车队", "admin@fresh.test");
  const as = { token: fresh.adminToken };
  assert.deepEqual(await ok(call("GET", "/price-overview", as)), { products_with_price: 0, products_without_price: 0, items: [] });
  const brand = await ok(call("POST", "/brands", { ...as, body: { name: "新品牌", currency: "JPY" } }), 201);
  const zone = (await ok(call("POST", "/areas", { ...as, body: { city_id: ids["tokyo"], name: { zh: "市区" }, biz_type: "general", polygons: [{ kind: "operate", geometry: SQUARE }] } }), 201)).id;
  const made: string[] = [];
  for (let i = 0; i < 4; i += 1) {
    api.clock.advance(1_000);
    made.push((await ok(call("POST", "/products", { ...as, body: { brand_id: brand.id, city_id: ids["tokyo"], category: "point_to_point", areas: [{ area_id: zone }], vehicle_groups: [{ vehicle_group_id: ids["biz7"], passengers: 6, luggage: 2 }], dispatchers: [{ name: "小王", phone: "0312345678" }] } }), 201)).id);
  }
  const price = (productId: string, extra: Record<string, unknown>, v: number): Promise<any> =>
    ok(call("POST", `/products/${productId}/price-rules`, { ...as, version: v, body: { area_id: zone, vehicle_group_id: ids["biz7"], pricing_model: "fixed", base_price: 9_000, valid_from: "2026-10-01", ...extra } }), 201);
  await price(made[0] as string, {}, 1);
  await price(made[1] as string, { valid_to: "2026-10-06" }, 1); // 过期
  await price(made[2] as string, { status: "disabled" }, 1); // 停用
  // 第四个：有价格，但已经下架——首页的两个数不算它
  await price(made[3] as string, {}, 1);
  await api.db.owner.query("update products set status = 'unpublished' where id = $1", [made[3]]);
  api.clock.advance(1_000);
  await ok(call("POST", `/products/${made[0]}/adjust-rules`, { ...as, version: 2, body: adjustBody() }), 201);
  await ok(call("PUT", `/products/${made[0]}/content`, { ...as, version: 3, body: { zh: { title: "市区点对点" } } }));
  const overview = await ok(call("GET", "/price-overview", as));
  assert.deepEqual([overview.products_with_price, overview.products_without_price], [1, 2]);
  const byId = Object.fromEntries(overview.items.map((item: any) => [item.product_id, item]));
  assert.deepEqual(Object.keys(byId[made[0] as string]).sort(), ["active_price_rule_count", "category", "city", "code", "coverage", "enabled_adjust_rule_count", "has_active_price", "price_rule_count", "product_id", "status", "title"]);
  // 城市，和缺价的概况（点对点：1 个区域 × 1 个车型组 = 1 个组合）
  assert.deepEqual(byId[made[0] as string].city, { id: ids["tokyo"], name: { zh: "东京" } });
  assert.deepEqual(made.map((productId) => byId[productId].coverage), [{ total: 1, missing: 0 }, { total: 1, missing: 1 }, { total: 1, missing: 1 }, { total: 1, missing: 0 }]);
  // 首页只要两个数：summary=1 不带 items
  assert.deepEqual(await ok(call("GET", "/price-overview?summary=1", as)), { products_with_price: 1, products_without_price: 2 });
  assert.equal((await call("GET", "/price-overview?summary=yes", as)).status, 400);
  assert.deepEqual(
    made.map((productId) => [byId[productId].has_active_price, byId[productId].price_rule_count, byId[productId].enabled_adjust_rule_count, byId[productId].status]),
    [[true, 1, 1, "draft"], [false, 1, 0, "draft"], [false, 1, 0, "draft"], [true, 1, 0, "unpublished"]],
  );
  assert.deepEqual(byId[made[0] as string].title, { zh: "市区点对点" });
  assert.equal(overview.items[0].product_id, made[0], "最近改过的排最前");
});

test("权限：管理员和商品价格能改价格和调价；只读能看不能改；调度和财务看都不能看", async () => {
  const id = await product();
  const rule = (await addPrice(id, fixed())).price_rule;
  const adjust = await addAdjust(id, adjustBody());
  const tokens: Record<string, string> = {};
  for (const role of ["pricing", "dispatch", "finance", "readonly"]) tokens[role] = (await addTenantUser(api, tenant.adminToken, `${role}-m104@a.test`, role)).token;
  const query = `area_id=${ids["a1"]}&vehicle_group_id=${ids["biz7"]}&direction=pickup&from=2026-10-09&to=2026-10-10`;
  const reads: [HttpMethod, string][] = [["GET", `/products/${id}/price-rules`], ["GET", `/products/${id}/price-coverage`], ["GET", `/products/${id}/adjust-rules`], ["GET", `/products/${id}/price-calendar?${query}`], ["GET", "/price-overview"]];
  const writes: [HttpMethod, string, unknown][] = [
    ["POST", `/products/${id}/price-rules`, fixed({ direction: "dropoff" })],
    ["POST", `/products/${id}/price-rules/batch`, { delete: [rule.id] }],
    ["PUT", `/products/${id}/price-rules/${rule.id}`, fixed({ base_price: 1 })],
    ["DELETE", `/products/${id}/price-rules/${rule.id}`, undefined],
    ["POST", `/products/${id}/adjust-rules`, adjustBody()],
    ["PUT", `/products/${id}/adjust-rules/${adjust.id}`, adjustBody()],
    ["PUT", `/products/${id}/adjust-rules/order`, { ids: [adjust.id] }],
    ["POST", `/products/${id}/adjust-rules/${adjust.id}/disable`, undefined],
    ["POST", `/products/${id}/adjust-rules/${adjust.id}/enable`, undefined],
    ["DELETE", `/products/${id}/adjust-rules/${adjust.id}`, undefined],
    ["PUT", `/brands/${ids["brand"]}/rounding-unit`, { rounding_unit: 100 }],
  ];
  for (const role of ["dispatch", "finance"]) {
    for (const [method, path, body] of [...reads.map(([m, p]) => [m, p, undefined] as const), ...writes]) {
      assert.equal((await call(method, path, { token: tokens[role] as string, body, version: 3 })).status, 403, `${role} ${method} ${path}`);
    }
  }
  for (const [method, path] of reads) assert.equal((await call(method, path, { token: tokens["readonly"] as string })).status, 200, `readonly ${method} ${path}`);
  for (const [method, path, body] of writes) assert.equal((await call(method, path, { token: tokens["readonly"] as string, body, version: 3 })).status, 403, `readonly ${method} ${path}`);
  const pricing = tokens["pricing"] as string;
  const made = await ok(call("POST", `/products/${id}/price-rules`, { token: pricing, version: 3, body: fixed({ direction: "dropoff" }) }), 201);
  assert.equal((await call("POST", `/products/${id}/adjust-rules/${adjust.id}/disable`, { token: pricing })).status, 200);
  assert.deepEqual((await audits("price_rule", made.price_rule.id)).map((log) => log.actor_email), ["pricing-m104@a.test"]);
  // 节假日：所有租户角色都能读（和其他主数据一样）
  for (const role of ["pricing", "dispatch", "finance", "readonly"]) assert.equal((await call("GET", "/holidays?from=2027-01-01&to=2027-01-31", { token: tokens[role] as string })).status, 200, role);
  assert.equal((await api.call("GET", `/tenant/v1/products/${id}/price-rules`)).status, 401);
  assert.equal((await api.call("GET", `/tenant/v1/products/${id}/price-rules`, { token: root })).status, 401);
});

test("规则 4：价格相关接口的任何返回里都没有对外价和加价比例相关的字段", async () => {
  const id = await publishable();
  await addPrice(id, fixed({ direction: "both" }));
  await addAdjust(id, adjustBody());
  const query = `area_id=${ids["a1"]}&vehicle_group_id=${ids["biz7"]}&direction=pickup&from=2026-10-09&to=2026-10-10`;
  const paths = [`/products/${id}/price-rules`, `/products/${id}/price-coverage`, `/products/${id}/adjust-rules`, `/products/${id}/price-calendar?${query}`, "/price-overview", `/products/${id}/publish-check`, "/holidays?from=2027-01-01&to=2027-12-31"];
  for (const path of paths) {
    const res = await call("GET", path);
    assert.equal(res.status, 200, path);
    assert.doesNotMatch(res.text, /markup|sell_price|selling_price|public_price|channel|对外价|加价比例/i, path);
  }
  const posted = await call("POST", `/products/${id}/price-rules/batch`, { version: await version(id), body: { create: [fixed({ area_id: ids["a2"] })] } });
  assert.doesNotMatch(posted.text, /markup|sell_price|selling_price|public_price|channel|对外价|加价比例/i);
});

test("接口定义对账：价格相关应答的字段和 openapi.yaml 里各 schema 的必有字段一致", async () => {
  const doc = parse(await readFile(new URL("../openapi.yaml", import.meta.url), "utf8")) as { components: { schemas: Record<string, any> } };
  const schema = (name: string): any => doc.components.schemas[name];
  const same = (actual: object, required: string[], label: string): void => assert.deepEqual(Object.keys(actual).sort(), [...required].sort(), label);
  const id = await product();
  const saved = await addPrice(id, fixed({ direction: "both" }));
  const adjust = await addAdjust(id, adjustBody({ time_slot: { start: "22:00", end: "06:00" } }));
  await ok(platform("PUT", "/holidays/JP/2028-01-01", { name: { ja: "元日" } }), 201);
  same(saved, schema("PriceRuleSaved").required, "PriceRuleSaved");
  same(saved.price_rule, schema("PriceRule").required, "PriceRule");
  const rules = await ok(call("GET", `/products/${id}/price-rules`));
  same(rules, schema("PriceRules").required, "PriceRules");
  same(rules.coverage, schema("PriceCoverageSummary").required, "PriceCoverageSummary");
  assert.deepEqual(rules.available_models.every((model: string) => schema("PricingModel").enum.includes(model)), true);
  const batch = await ok(call("POST", `/products/${id}/price-rules/batch`, { version: rules.version, body: {} }));
  same(batch, [...schema("PriceRules").required, "created_ids"], "PriceRulesSaved");
  const coverage = await ok(call("GET", `/products/${id}/price-coverage`));
  same(coverage, schema("PriceCoverage").required, "PriceCoverage");
  same(coverage.combos[0], schema("PriceCoverage").properties.combos.items.required, "PriceCoverage.combos[]");
  same(adjust, schema("AdjustRule").required, "AdjustRule");
  same(await ok(call("GET", `/products/${id}/adjust-rules`)), schema("AdjustRules").required, "AdjustRules");
  same(await ok(call("POST", `/products/${id}/adjust-rules/${adjust.id}/disable`)), schema("AdjustRuleSaved").required, "AdjustRuleSaved");
  await ok(call("POST", `/products/${id}/adjust-rules/${adjust.id}/enable`));
  const view = await calendar(id, `area_id=${ids["a1"]}&vehicle_group_id=${ids["biz7"]}&direction=pickup&from=2028-01-01&to=2028-01-01`);
  const day = schema("PriceCalendarDay");
  same(view, schema("PriceCalendar").required, "PriceCalendar");
  same(view.groups[0], schema("PriceCalendar").properties.groups.items.required, "PriceCalendar.groups[]");
  same(view.days[0], schema("PriceCalendarDay").required, "PriceCalendar.days[]");
  same(view.days[0].holiday, day.properties.holiday.oneOf[0].required, "holiday");
  same(view.days[0].price_rule, day.properties.price_rule.oneOf[0].required, "price_rule");
  const segment = day.properties.segments.items;
  same(view.days[0].segments[0], segment.required, "segments[]");
  same(view.days[0].segments[0].adjusts[0], segment.properties.adjusts.items.required, "adjusts[]");
  same(view.days[0].segments[0].adjusts[0].steps[0], segment.properties.adjusts.items.properties.steps.items.required, "steps[]");
  const overview = await ok(call("GET", "/price-overview"));
  same(overview, [...schema("PriceOverview").required, "items"], "PriceOverview");
  same(await ok(call("GET", "/price-overview?summary=1")), schema("PriceOverview").required, "PriceOverview（只要两个数）");
  same(overview.items[0], schema("PriceOverview").properties.items.items.required, "PriceOverview.items[]");
  const holidays = await ok(call("GET", "/holidays?from=2028-01-01&to=2028-01-31"));
  same(holidays, schema("Holidays").required, "Holidays");
  same(holidays.items[0], schema("Holiday").required, "Holiday");
  same(holidays.countries[0], schema("Holidays").properties.countries.items.required, "Holidays.countries[]");
  const brand = (await ok(call("GET", "/brands"))).items.find((item: any) => item.id === ids["brand"]);
  same(await ok(call("PUT", `/brands/${ids["brand"]}/rounding-unit`, { version: brand.version, body: { rounding_unit: 1 } })), schema("RoundingUnit").required, "RoundingUnit");
  same(await ok(call("DELETE", `/products/${id}/price-rules/${saved.price_rule.id}`, { version: await version(id) })), schema("VersionOnly").required, "VersionOnly");
  // 请求体里能给的字段，定义里都有
  for (const field of Object.keys(fixed())) assert.ok(field in schema("PriceRuleInput").properties, field);
  for (const field of Object.keys(adjustBody())) assert.ok(field in schema("AdjustRuleInput").properties, field);
});
