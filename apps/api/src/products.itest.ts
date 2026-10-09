/**
 * M1-03：子品牌、商品（基础信息、服务规则、商品详情）、上架校验、上架 / 下架，以及商品带来的引用保护
 * （区域、平台主数据被已上架的商品用着时不能删 / 停用）。
 * 跨租户的验证在 tenant-isolation.itest.ts；这里是单个供应商视角下的全部规则。
 * 全部经真实接口、真实 PostgreSQL；测试数据都在这里构造，结束时连同 schema 一起删除。
 *
 * 需要「已上架的商品」的地方都走真实的上架流程（M1-04 起价格规则接上了）：缺什么经接口补什么，再调上架接口。
 * 价格规则、调价规则本身的规则在 prices.itest.ts。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type ApiResponse, type HttpMethod, type TenantFixture, type TestApi, addTenantUser, createTestApi } from "./testing/api.ts";

let api: TestApi;
let root: string;
let tenant: TenantFixture;
const MISSING = "99999999-9999-4999-8999-999999999999";
const ids: Record<string, string> = {};

const platform = (method: HttpMethod, path: string, body?: unknown, headers?: Record<string, string>): Promise<ApiResponse> =>
  api.call(method, `/platform/v1${path}`, { token: root, ...(body === undefined ? {} : { body }), ...(headers ? { headers } : {}) });

const call = (method: HttpMethod, path: string, options: { token?: string; body?: unknown; version?: number; key?: string } = {}): Promise<ApiResponse> =>
  api.call(method, `/tenant/v1${path}`, {
    token: options.token ?? tenant.adminToken,
    ...(options.body === undefined ? {} : { body: options.body }),
    headers: {
      ...(options.version === undefined ? {} : { "if-match": `"${options.version}"` }),
      ...(method === "POST" && /^\/(products|brands|areas)$/.test(path) ? { "idempotency-key": options.key ?? randomUUID() } : {}),
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

async function area(extra: Record<string, unknown> = {}): Promise<any> {
  api.clock.advance(1_000);
  return ok(call("POST", "/areas", { body: { city_id: ids["tokyo"], name: { zh: `区域 ${(serial += 1)}` }, biz_type: "general", polygons: [{ kind: "operate", geometry: SQUARE }], ...extra } }), 201);
}

/** 一个接送机草稿（成田机场，东京）。 */
async function draft(extra: Record<string, unknown> = {}): Promise<any> {
  api.clock.advance(1_000);
  return ok(call("POST", "/products", { body: { brand_id: ids["brand"], city_id: ids["tokyo"], category: "airport_transfer", poi_id: ids["narita"], ...extra } }), 201);
}

const RULES = {
  booking: { sale_from: "2026-10-01", sale_to: "2027-03-31", service_time: { start: "06:00", end: "23:00" }, lead_time_hours: 24, note: "节假日请提前联系" },
  urgent: { enabled: true, daily_quota: 5, tiers: [{ within_hours: 12, surcharge: 2000 }, { within_hours: 6, surcharge: 5000 }] },
  night: { enabled: true, window: { start: "22:00", end: "06:00" }, amount: 3000, charge_unit: "per_order" },
  free_wait: { pickup: { mode: "limited", minutes: 90 }, dropoff: { mode: "limited", minutes: 15 } },
  driver_languages: [{ language: "zh", unit_price: 5000 }],
};

/** 除价格规则外全部填好的接送机商品。 */
async function completeDraft(): Promise<any> {
  const product = await draft({
    areas: [{ area_id: ids["area"] }],
    vehicle_groups: [{ vehicle_group_id: ids["biz7"], passengers: 6, luggage: 2 }],
    dispatchers: [{ name: "调度小王", phone: "+81 90-1234-5678" }],
  });
  const rules = await ok(call("PUT", `/products/${product.id}/service-rules`, { version: product.version, body: { ...RULES, addons: [{ addon_id: ids["seat"], unit_price: 1000, first_free: true }] } }));
  const content = await ok(call("PUT", `/products/${product.id}/content`, { version: rules.version, body: { zh: { title: "成田机场接送", pickup_guide: "到达大厅 3 号门，司机举牌等候" } } }));
  return { ...(await ok(call("GET", `/products/${product.id}`))), version: content.version };
}

/**
 * 走真实的上架流程：缺什么经接口补什么（区域、车型组、调度人、服务规则、详情、一条价格），再调上架接口。
 * 返回上架后的商品（带最新的版本号）。
 */
async function publish(productId: string, token: string = tenant.adminToken): Promise<any> {
  const as = { token };
  let product = await ok(call("GET", `/products/${productId}`, as));
  const patch: Record<string, unknown> = {};
  if (product.areas.length === 0) {
    api.clock.advance(1_000);
    const created = await ok(call("POST", "/areas", { ...as, body: { city_id: product.city_id, name: { zh: `上架用的区域 ${(serial += 1)}` }, biz_type: "general", polygons: [{ kind: "operate", geometry: SQUARE }] } }), 201);
    patch["areas"] = [{ area_id: created.id }];
  }
  if (product.vehicle_groups.length === 0) patch["vehicle_groups"] = [{ vehicle_group_id: ids["biz7"], passengers: 6, luggage: 2 }];
  if (product.dispatchers.length === 0) patch["dispatchers"] = [{ name: "调度小王", phone: "09012345678" }];
  if (Object.keys(patch).length > 0) product = await ok(call("PATCH", `/products/${productId}`, { ...as, version: product.version, body: patch }));
  let version: number = product.version;
  const failing = new Set<string>((await ok(call("GET", `/products/${productId}/publish-check`, as))).items.filter((item: any) => !item.passed).map((item: any) => item.key));
  if (failing.has("service_rules")) {
    const freeWait = product.category === "airport_transfer" ? { pickup: { mode: "limited", minutes: 90 }, dropoff: { mode: "limited", minutes: 15 } } : { general: { mode: "unlimited" } };
    version = (await ok(call("PUT", `/products/${productId}/service-rules`, { ...as, version, body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: freeWait } }))).version;
  }
  if (failing.has("content")) version = (await ok(call("PUT", `/products/${productId}/content`, { ...as, version, body: { zh: { title: "上架用的标题", pickup_guide: "到达大厅" } } }))).version;
  if (failing.has("price_rules")) {
    const price =
      product.category === "charter"
        ? { package_hours: 10, pricing_model: "charter_package", package_km: 300, package_price: 98_000, overtime_per_hour: 5_000, over_km_per_km: 400 }
        : { ...(product.category === "airport_transfer" ? { direction: "both" } : {}), pricing_model: "fixed", base_price: 20_000 };
    const body = { area_id: product.areas[0].area_id, vehicle_group_id: product.vehicle_groups[0].vehicle_group_id, valid_from: "2026-01-01", ...price };
    await ok(api.call("POST", `/tenant/v1/products/${productId}/price-rules`, { token, body, headers: { "if-match": `"${version}"`, "idempotency-key": randomUUID() } }), 201);
  }
  return ok(call("POST", `/products/${productId}/publish`, as));
}

async function audits(resource: string, id: string): Promise<any[]> {
  return (await api.db.owner.query("select action, tenant_id, actor_email, before, after from audit_logs where resource = $1 and resource_id = $2 order by id", [resource, id])).rows;
}

before(async () => {
  api = await createTestApi();
  root = await api.superAdminToken();
  tenant = await api.tenantWithAdmin(root, "甲车队", "admin@a.test");
  const city = { country_code: "JP", timezone: "Asia/Tokyo" };
  ids["tokyo"] = (await ok(platform("POST", "/master/cities", { ...city, code: "CTY-JP-TYO", name: { zh: "东京" }, center: { lng: 139.6917, lat: 35.6895 } }), 201)).id;
  ids["osaka"] = (await ok(platform("POST", "/master/cities", { ...city, code: "CTY-JP-OSA", name: { zh: "大阪" }, center: { lng: 135.5011, lat: 34.6938 } }), 201)).id;
  const place = { location: { lng: 140.3887, lat: 35.7686 } };
  ids["narita"] = (await ok(platform("POST", "/master/places", { ...place, type: "airport", code: "NRT", city_id: ids["tokyo"], name: { zh: "成田机场" }, flight_scope: "international" }), 201)).id;
  ids["haneda"] = (await ok(platform("POST", "/master/places", { ...place, type: "airport", code: "HND", city_id: ids["tokyo"], name: { zh: "羽田机场" }, flight_scope: "mixed" }), 201)).id;
  ids["station"] = (await ok(platform("POST", "/master/places", { ...place, type: "station", code: "STN-JP-TOKYO", city_id: ids["tokyo"], name: { zh: "东京站" }, category: "shinkansen" }), 201)).id;
  ids["hotel"] = (await ok(platform("POST", "/master/places", { ...place, type: "poi", code: "POI-000001", city_id: ids["tokyo"], name: { zh: "某酒店" }, category: "hotel" }), 201)).id;
  ids["kix"] = (await ok(platform("POST", "/master/places", { ...place, type: "airport", code: "KIX", city_id: ids["osaka"], name: { zh: "关西机场" } }), 201)).id;
  const group = { grade: "business", seats: 7, power: "fuel", combos: [{ passengers: 6, luggage: 2 }, { passengers: 4, luggage: 4 }] };
  ids["biz7"] = (await ok(platform("POST", "/master/vehicle-groups", { ...group, code: "VG-BIZ-7", name: { zh: "商务 7 座" } }), 201)).id;
  ids["eco4"] = (await ok(platform("POST", "/master/vehicle-groups", { grade: "economy", seats: 4, power: "fuel", combos: [{ passengers: 3, luggage: 2 }], code: "VG-ECO-4", name: { zh: "经济 4 座" } }), 201)).id;
  ids["seat"] = (await ok(platform("POST", "/master/addons", { code: "ADD-CHILD_SEAT", categories: ["airport_transfer", "charter"], charge_unit: "per_item", name: { zh: "儿童座椅" } }), 201)).id;
  ids["sign"] = (await ok(platform("POST", "/master/addons", { code: "ADD-MEET_SIGN", categories: ["airport_transfer"], charge_unit: "per_order", name: { zh: "举牌接机" } }), 201)).id;
  ids["guide"] = (await ok(platform("POST", "/master/addons", { code: "ADD-GUIDE", categories: ["charter"], charge_unit: "per_duration", name: { zh: "导游" } }), 201)).id;
  ids["brand"] = (await ok(call("POST", "/brands", { body: { name: "甲车队 JP", currency: "JPY" } }), 201)).id;
  ids["area"] = (await area({ name: { zh: "东京市区" } })).id;
});
after(() => api.close());

test("子品牌：新增（币种只认支持的）、列表、改名；币种创建后不能改；同一个供应商下不能重名；幂等键；都有审计", async () => {
  const listed = await ok(call("GET", "/brands"));
  assert.deepEqual(listed.items.map((brand: any) => [brand.name, brand.currency, brand.status, brand.version]), [["甲车队 JP", "JPY", "active", 1]]);
  assert.deepEqual(Object.keys(listed.items[0]).sort(), ["created_at", "currency", "id", "name", "status", "updated_at", "version"]);
  assert.deepEqual(issues(await call("POST", "/brands", { body: { name: "欧元品牌", currency: "EUR" } })), [["/currency", "UNSUPPORTED_CURRENCY"]]);
  assert.deepEqual(issues(await call("POST", "/brands", { body: { name: " ", currency: "JPY" } })).map(([path]) => path), ["/name"]);
  const duplicate = await call("POST", "/brands", { body: { name: "甲车队 jp", currency: "KRW" } });
  assert.deepEqual([duplicate.status, duplicate.body.error.code], [409, "BRAND_NAME_TAKEN"]);
  assert.equal((await api.call("POST", "/tenant/v1/brands", { token: tenant.adminToken, body: { name: "没带键", currency: "JPY" } })).status, 400);
  const key = randomUUID();
  const first = await ok(call("POST", "/brands", { key, body: { name: "甲车队 KR", currency: "KRW" } }), 201);
  assert.deepEqual(await ok(call("POST", "/brands", { key, body: { name: "甲车队 KR", currency: "KRW" } }), 201), first);
  assert.equal((await ok(call("GET", "/brands"))).items.length, 2);

  assert.equal((await call("PUT", `/brands/${first.id}`, { body: { name: "改名" } })).status, 428);
  assert.equal((await call("PUT", `/brands/${first.id}`, { version: 9, body: { name: "改名" } })).body.error.code, "VERSION_CONFLICT");
  const locked = await call("PUT", `/brands/${first.id}`, { version: 1, body: { name: "改名", currency: "JPY" } });
  assert.deepEqual([locked.status, locked.body.error.details], [409, { fields: ["currency"] }]);
  assert.equal((await call("PUT", `/brands/${first.id}`, { version: 1, body: { name: "甲车队 JP" } })).body.error.code, "BRAND_NAME_TAKEN");
  assert.equal((await ok(call("PUT", `/brands/${first.id}`, { version: 1, body: { name: "甲车队 KR", currency: "KRW" } }))).version, 1, "没变化不加版本");
  const renamed = await ok(call("PUT", `/brands/${first.id}`, { version: 1, body: { name: "甲车队 韩国" } }));
  assert.deepEqual([renamed.name, renamed.currency, renamed.version], ["甲车队 韩国", "KRW", 2]);
  assert.equal((await call("PUT", `/brands/${MISSING}`, { version: 1, body: { name: "x" } })).status, 404);
  assert.deepEqual((await audits("brand", first.id)).map((log) => [log.action, log.tenant_id, log.before, log.after]), [
    ["create", tenant.tenantId, null, { name: "甲车队 KR", currency: "KRW", status: "active" }],
    ["update", tenant.tenantId, { name: "甲车队 KR" }, { name: "甲车队 韩国" }],
  ]);
});

test("新增商品：创建即草稿，编号由后端生成；创建后不能改的四项当场校验；可以只给这四项，也可以一起给区域、车型组、调度人", async () => {
  const minimal = await draft();
  assert.deepEqual(Object.keys(minimal).sort(), [
    "area_count", "areas", "brand", "brand_id", "category", "city", "city_id", "code", "created_at", "dispatchers", "id", "poi", "poi_id", "published_at", "status", "title", "updated_at",
    "vehicle_group_count", "vehicle_groups", "version",
  ]);
  assert.match(minimal.code, /^PRD\d{14}\d{4,}$/);
  assert.deepEqual(
    [minimal.status, minimal.category, minimal.version, minimal.published_at, minimal.title, minimal.areas, minimal.vehicle_groups, minimal.dispatchers, minimal.area_count],
    ["draft", "airport_transfer", 1, null, {}, [], [], [], 0],
  );
  assert.deepEqual(minimal.brand, { id: ids["brand"], name: "甲车队 JP", currency: "JPY", status: "active" });
  assert.deepEqual(minimal.city, { id: ids["tokyo"], code: "CTY-JP-TYO", name: { zh: "东京" }, country_code: "JP", timezone: "Asia/Tokyo", status: "active" });
  assert.deepEqual(minimal.poi, { id: ids["narita"], code: "NRT", name: { zh: "成田机场" }, type: "airport", flight_scope: "international", status: "active" });
  const another = await draft({ poi_id: ids["station"] });
  assert.notEqual(another.code, minimal.code);
  const charter = await draft({ category: "charter", poi_id: null });
  assert.deepEqual([charter.category, charter.poi_id, charter.poi], ["charter", null, null]);

  const full = await completeDraft();
  assert.deepEqual(full.areas, [{ area_id: ids["area"], priority: 0, name: { zh: "东京市区" }, biz_type: "general", status: "active" }]);
  assert.deepEqual(full.vehicle_groups, [
    { vehicle_group_id: ids["biz7"], passengers: 6, luggage: 2, code: "VG-BIZ-7", name: { zh: "商务 7 座" }, grade: "business", seats: 7, sample_models: [], combos: [{ passengers: 6, luggage: 2 }, { passengers: 4, luggage: 4 }], status: "active" },
  ]);
  assert.deepEqual(full.dispatchers, [{ name: "调度小王", phone: "+81 90-1234-5678" }]);
  assert.deepEqual(full.title, { zh: "成田机场接送" });
  const created = (await audits("product", full.id))[0];
  assert.deepEqual([created.action, created.tenant_id, created.actor_email, created.before], ["create", tenant.tenantId, "admin@a.test", null]);
  assert.deepEqual([created.after.status, created.after.category, created.after.poi_id, created.after.areas], ["draft", "airport_transfer", ids["narita"], [ids["area"]]]);

  const count = async (): Promise<number> => (await api.db.owner.query("select count(*)::int as n from products")).rows[0].n;
  const before = await count();
  const cases: [string, Record<string, unknown>, [string, string | undefined]][] = [
    ["子品牌不存在", { brand_id: MISSING }, ["/brand_id", "UNKNOWN_BRAND"]],
    ["城市不存在", { city_id: MISSING }, ["/city_id", "UNKNOWN_CITY"]],
    ["品类不存在", { category: "bus" }, ["/category", undefined]],
    ["接送机没有接送点", { poi_id: null }, ["/poi_id", "REQUIRED"]],
    ["接送点不存在", { poi_id: MISSING }, ["/poi_id", "UNKNOWN_PLACE"]],
    ["接送点是酒店", { poi_id: ids["hotel"] }, ["/poi_id", "UNKNOWN_PLACE"]],
    ["接送点在别的城市", { poi_id: ids["kix"] }, ["/poi_id", "PLACE_OTHER_CITY"]],
    ["包车带了接送点", { category: "charter" }, ["/poi_id", "NOT_APPLICABLE"]],
    ["缺子品牌", { brand_id: undefined }, ["/brand_id", undefined]],
  ];
  for (const [label, override, expected] of cases) {
    const found = issues(await call("POST", "/products", { body: { brand_id: ids["brand"], city_id: ids["tokyo"], category: "airport_transfer", poi_id: ids["narita"], ...override } }));
    assert.ok(found.some(([path, reason]) => path === expected[0] && reason === expected[1]), `${label}：${JSON.stringify(found)}`);
  }
  assert.equal(await count(), before);
  // 幂等键
  assert.equal((await api.call("POST", "/tenant/v1/products", { token: tenant.adminToken, body: { brand_id: ids["brand"], city_id: ids["tokyo"], category: "charter" } })).status, 400);
  const key = randomUUID();
  const body = { brand_id: ids["brand"], city_id: ids["tokyo"], category: "point_to_point" };
  const first = await ok(call("POST", "/products", { key, body }), 201);
  assert.deepEqual(await ok(call("POST", "/products", { key, body }), 201), first);
  assert.equal((await call("POST", "/products", { key, body: { ...body, category: "charter" } })).body.error.code, "IDEMPOTENCY_KEY_REUSED");
  assert.equal(await count(), before + 1);
});

test("修改基础信息：分步保存区域（顺序即优先级）、车型组、调度人；带了的整体替换、没带的不动；四个不能改的字段锁住；审计只记变了的", async () => {
  const product = await draft();
  const second = await area({ biz_type: "airport_transfer" });
  assert.equal((await call("PATCH", `/products/${product.id}`, { body: { dispatchers: [] } })).status, 428);
  assert.equal((await call("PATCH", `/products/${product.id}`, { version: 7, body: { dispatchers: [] } })).body.error.code, "VERSION_CONFLICT");
  assert.equal((await ok(call("PATCH", `/products/${product.id}`, { version: 1, body: {} }))).version, 1, "什么都没带：没有变化");

  const step1 = await ok(call("PATCH", `/products/${product.id}`, { version: 1, body: { areas: [{ area_id: second.id }, { area_id: ids["area"] }] } }));
  assert.deepEqual([step1.version, step1.areas.map((item: any) => [item.area_id, item.priority]), step1.vehicle_groups], [2, [[second.id, 0], [ids["area"], 1]], []]);
  const step2 = await ok(call("PATCH", `/products/${product.id}`, { version: 2, body: { vehicle_groups: [{ vehicle_group_id: ids["biz7"], passengers: 4, luggage: 4 }, { vehicle_group_id: ids["eco4"], passengers: 3, luggage: 2 }] } }));
  assert.deepEqual([step2.version, step2.area_count, step2.vehicle_groups.map((item: any) => item.code)], [3, 2, ["VG-BIZ-7", "VG-ECO-4"]]);
  const step3 = await ok(call("PATCH", `/products/${product.id}`, { version: 3, body: { dispatchers: [{ name: " 小李 ", phone: "09012345678" }], areas: [{ area_id: ids["area"] }, { area_id: second.id }] } }));
  assert.deepEqual([step3.version, step3.dispatchers, step3.areas.map((item: any) => item.area_id), step3.vehicle_group_count], [4, [{ name: "小李", phone: "09012345678" }], [ids["area"], second.id], 2]);
  assert.equal((await ok(call("PATCH", `/products/${product.id}`, { version: 4, body: { dispatchers: [{ name: "小李", phone: "09012345678" }], brand_id: ids["brand"], poi_id: ids["narita"] } }))).version, 4, "内容一样、不能改的字段带了相同的值：没有变化");

  const locked = await call("PATCH", `/products/${product.id}`, { version: 4, body: { brand_id: MISSING, city_id: ids["osaka"], category: "charter", poi_id: ids["haneda"], dispatchers: [] } });
  assert.deepEqual([locked.status, locked.body.error.code, locked.body.error.details], [409, "FIELD_LOCKED", { fields: ["brand_id", "city_id", "category", "poi_id"] }]);

  const logs = await audits("product", product.id);
  assert.deepEqual(logs.map((log) => [log.action, Object.keys(log.after).sort()]), [["create", logs[0].after ? Object.keys(logs[0].after).sort() : []], ["update", ["areas"]], ["update", ["vehicle_groups"]], ["update", ["areas", "dispatchers"]]]);
  assert.deepEqual([logs[3].before.areas, logs[3].after.areas, logs[3].before.dispatchers], [[second.id, ids["area"]], [ids["area"], second.id], []]);
});

test("选区域、车型组、调度人的规则：区域要是本城市、品类匹配或通用、新选的要启用；车型组的组合要是可选的；电话要像电话", async () => {
  const product = await draft();
  const charterArea = await area({ biz_type: "charter" });
  const osakaArea = await area({ city_id: ids["osaka"] });
  const disabledArea = await area();
  await ok(call("POST", `/areas/${disabledArea.id}/disable`));
  const patch = (body: unknown): Promise<ApiResponse> => call("PATCH", `/products/${product.id}`, { version: 1, body });
  assert.deepEqual(issues(await patch({ areas: [{ area_id: ids["area"] }, { area_id: MISSING }, { area_id: charterArea.id }, { area_id: osakaArea.id }, { area_id: disabledArea.id }, { area_id: ids["area"] }] })), [
    ["/areas/1/area_id", "UNKNOWN_AREA"],
    ["/areas/2/area_id", "AREA_NOT_USABLE"],
    ["/areas/3/area_id", "AREA_OTHER_CITY"],
    ["/areas/4/area_id", "AREA_DISABLED"],
    ["/areas/5/area_id", "DUPLICATE"],
  ]);
  assert.deepEqual(issues(await patch({ areas: Array.from({ length: 51 }, () => ({ area_id: ids["area"] })) }))[0], ["/areas", "TOO_MANY"]);
  assert.deepEqual(
    issues(await patch({ vehicle_groups: [{ vehicle_group_id: ids["biz7"], passengers: 6, luggage: 2 }, { vehicle_group_id: MISSING, passengers: 1, luggage: 0 }, { vehicle_group_id: ids["eco4"], passengers: 4, luggage: 4 }, { vehicle_group_id: ids["biz7"], passengers: 4, luggage: 4 }] })),
    [["/vehicle_groups/1/vehicle_group_id", "UNKNOWN_VEHICLE_GROUP"], ["/vehicle_groups/2", "VEHICLE_COMBO_NOT_OFFERED"], ["/vehicle_groups/3/vehicle_group_id", "DUPLICATE"]],
  );
  assert.deepEqual(issues(await patch({ dispatchers: [{ name: "", phone: "090-1234-5678" }, { name: "小王", phone: "没有电话" }, { name: "王".repeat(51), phone: "12345" }] })), [
    ["/dispatchers/0/name", "REQUIRED"], ["/dispatchers/1/phone", "INVALID_PHONE"], ["/dispatchers/2/name", "REQUIRED"], ["/dispatchers/2/phone", "INVALID_PHONE"],
  ]);
  assert.deepEqual(issues(await patch({ dispatchers: Array.from({ length: 11 }, () => ({ name: "小王", phone: "09012345678" })) }))[0], ["/dispatchers", "TOO_MANY"]);
  assert.equal((await ok(call("GET", `/products/${product.id}`))).version, 1, "被拒绝的修改什么都没写");
  // 包车商品可以选包车的区域，不能选接送机的
  const charter = await draft({ category: "charter", poi_id: null });
  const transferArea = await area({ biz_type: "airport_transfer" });
  assert.equal((await ok(call("PATCH", `/products/${charter.id}`, { version: 1, body: { areas: [{ area_id: charterArea.id }, { area_id: ids["area"] }] } }))).area_count, 2);
  assert.deepEqual(issues(await call("PATCH", `/products/${charter.id}`, { version: 2, body: { areas: [{ area_id: transferArea.id }] } })), [["/areas/0/area_id", "AREA_NOT_USABLE"]]);
  // 已经选着的区域后来被停用：可以留着（上架校验会指出来），也可以去掉
  await ok(call("POST", `/areas/${charterArea.id}/disable`));
  assert.equal((await call("PATCH", `/products/${charter.id}`, { version: 2, body: { areas: [{ area_id: ids["area"] }, { area_id: charterArea.id }] } })).status, 200);
});

test("服务规则：新商品是空的；整体保存、可以只填一部分；金额是子品牌币种的最小单位整数；返回平台规定的免等最低值", async () => {
  const product = await draft();
  const empty = await ok(call("GET", `/products/${product.id}/service-rules`));
  assert.deepEqual(empty, {
    version: 1,
    currency: "JPY",
    free_wait_minimums: { pickup: 90, dropoff: 15, general: null },
    rules: {
      booking: { sale_from: null, sale_to: null, service_time: null, lead_time_hours: null, note: null },
      urgent: { enabled: false, daily_quota: null, tiers: [] },
      night: { enabled: false, window: null, amount: null, charge_unit: null },
      free_wait: { pickup: null, dropoff: null, general: null },
      addons: [],
      driver_languages: [],
    },
  });
  assert.equal((await call("PUT", `/products/${product.id}/service-rules`, { body: {} })).status, 428);
  assert.equal((await ok(call("PUT", `/products/${product.id}/service-rules`, { version: 1, body: {} }))).version, 1, "空的对空的：没有变化");
  const partial = await ok(call("PUT", `/products/${product.id}/service-rules`, { version: 1, body: { booking: { lead_time_hours: 12 } } }));
  assert.deepEqual([partial.version, partial.rules.booking.lead_time_hours, partial.rules.booking.service_time], [2, 12, null]);
  const saved = await ok(call("PUT", `/products/${product.id}/service-rules`, { version: 2, body: { ...RULES, addons: [{ addon_id: ids["seat"], unit_price: 0, first_free: true }, { addon_id: ids["guide"], enabled: false, unit_price: 8000 }] } }));
  assert.equal(saved.version, 3);
  assert.deepEqual(saved.rules, {
    booking: RULES.booking,
    urgent: RULES.urgent,
    night: RULES.night,
    free_wait: { ...RULES.free_wait, general: null },
    addons: [{ addon_id: ids["seat"], enabled: true, unit_price: 0, first_free: true }, { addon_id: ids["guide"], enabled: false, unit_price: 8000, first_free: false }],
    driver_languages: RULES.driver_languages,
  });
  assert.deepEqual(await ok(call("GET", `/products/${product.id}/service-rules`)), saved);
  assert.equal((await ok(call("GET", `/products/${product.id}`))).version, 3, "服务规则变了，商品的版本号跟着加");
  const log = (await audits("product", product.id)).at(-1);
  assert.deepEqual([log.action, Object.keys(log.before), log.after.service_rules.booking.leadTimeHours], ["update", ["service_rules"], 24]);
  // 各品类的免等最低值
  const stationProduct = await draft({ poi_id: ids["station"] });
  assert.deepEqual((await ok(call("GET", `/products/${stationProduct.id}/service-rules`))).free_wait_minimums, { pickup: 30, dropoff: 15, general: null });
  const mixed = await draft({ poi_id: ids["haneda"] });
  assert.deepEqual((await ok(call("GET", `/products/${mixed.id}/service-rules`))).free_wait_minimums, { pickup: 60, dropoff: 15, general: null });
  const charter = await draft({ category: "charter", poi_id: null });
  assert.deepEqual((await ok(call("GET", `/products/${charter.id}/service-rules`))).free_wait_minimums, { pickup: null, dropoff: null, general: 0 });
  assert.equal((await call("GET", `/products/${MISSING}/service-rules`)).status, 404);
});

test("服务规则的校验：日期、时段（可跨午夜）、提前时长、加急阶梯、免等不低于平台最低值、附加服务、司机语言；不合格的不保存", async () => {
  const product = await draft();
  const put = (body: unknown): Promise<ApiResponse> => call("PUT", `/products/${product.id}/service-rules`, { version: 1, body });
  const cases: [string, unknown, [string, string | undefined][]][] = [
    ["日期不存在、顺序颠倒", { booking: { sale_from: "2026-02-30" } }, [["/booking/sale_from", "INVALID_DATE"]]],
    ["结束早于开始", { booking: { sale_from: "2027-01-02", sale_to: "2027-01-01" } }, [["/booking/sale_to", "DATE_RANGE_REVERSED"]]],
    ["服务时间写法不对", { booking: { service_time: { start: "8:00", end: "22:00" } } }, [["/booking/service_time", "INVALID_TIME"]]],
    ["服务时间是空的", { booking: { service_time: { start: "08:00", end: "08:00" } } }, [["/booking/service_time", "EMPTY_WINDOW"]]],
    ["提前时长超过 30 天", { booking: { lead_time_hours: 721 } }, [["/booking/lead_time_hours", "OUT_OF_RANGE"]]],
    ["提前时长不是整数", { booking: { lead_time_hours: 1.5 } }, [["/booking/lead_time_hours", "NOT_INTEGER"]]],
    ["加急的小时数超过提前时长", { booking: { lead_time_hours: 6 }, urgent: { enabled: true, tiers: [{ within_hours: 12, surcharge: 100 }] } }, [["/urgent/tiers/0/within_hours", "TIER_NOT_WITHIN_LEAD_TIME"]]],
    ["加急档重复、金额为负", { urgent: { enabled: true, tiers: [{ within_hours: 6, surcharge: 100 }, { within_hours: 6, surcharge: -1 }] } }, [["/urgent/tiers/1/within_hours", "DUPLICATE"], ["/urgent/tiers/1/surcharge", "OUT_OF_RANGE"]]],
    ["金额带小数", { night: { enabled: true, window: { start: "22:00", end: "06:00" }, amount: 99.5, charge_unit: "per_hour" } }, [["/night/amount", "NOT_INTEGER"]]],
    ["夜间计费方式不存在", { night: { charge_unit: "per_km" } }, [["/night/charge_unit", undefined]]],
    ["接机免等低于国际线的 90 分钟", { free_wait: { pickup: { mode: "limited", minutes: 60 } } }, [["/free_wait/pickup/minutes", "BELOW_PLATFORM_MINIMUM"]]],
    ["接送机不填 general", { free_wait: { general: { mode: "unlimited" } } }, [["/free_wait/general", "NOT_APPLICABLE"]]],
    ["免等的方式不存在", { free_wait: { pickup: { mode: "forever" } } }, [["/free_wait/pickup/mode", undefined]]],
    ["附加服务不存在", { addons: [{ addon_id: MISSING, unit_price: 0 }] }, [["/addons/0/addon_id", "UNKNOWN_ADDON"]]],
    ["附加服务不适用这个品类", { addons: [{ addon_id: ids["guide"], unit_price: 0 }] }, [["/addons/0/addon_id", "ADDON_NOT_APPLICABLE"]]],
    ["每日加急库存不能是 0（不限是留空，不接是关掉加急）", { urgent: { enabled: true, daily_quota: 0 } }, [["/urgent/daily_quota", "OUT_OF_RANGE"]]],
    ["司机语言不在支持的清单里", { driver_languages: [{ language: "fr", unit_price: 0 }] }, [["/driver_languages/0/language", "INVALID_LANGUAGE"]]],
    ["附加服务重复", { addons: [{ addon_id: ids["seat"], unit_price: 0 }, { addon_id: ids["seat"], unit_price: 1 }] }, [["/addons/1/addon_id", "DUPLICATE"]]],
    ["司机语言写法不对、重复", { driver_languages: [{ language: "Chinese", unit_price: 0 }, { language: "en", unit_price: 0 }, { language: "en", unit_price: 0 }] }, [["/driver_languages/0/language", "INVALID_LANGUAGE"], ["/driver_languages/2/language", "DUPLICATE"]]],
  ];
  for (const [label, body, expected] of cases) assert.deepEqual(issues(await put(body)), expected, label);
  const below = await put({ free_wait: { pickup: { mode: "limited", minutes: 60 } } });
  assert.deepEqual(below.body.error.details.issues[0].detail, { min: 90 });
  assert.equal((await ok(call("GET", `/products/${product.id}/service-rules`))).version, 1);
  // 合法的边界：跨午夜的服务时间、全天、提前 0 小时、加急等于提前时长、免等正好等于最低值、无限
  const edge = await put({
    booking: { service_time: { start: "20:00", end: "04:00" }, lead_time_hours: 12 },
    urgent: { enabled: true, tiers: [{ within_hours: 12, surcharge: 0 }] },
    night: { enabled: true, window: { start: "00:00", end: "24:00" }, amount: 0, charge_unit: "per_hour" },
    free_wait: { pickup: { mode: "limited", minutes: 90 }, dropoff: { mode: "unlimited" } },
  });
  assert.equal(edge.status, 200, edge.text);
  // 报错的话说得通：提前预订时长是 0 又开着加急；数字超范围时写明范围
  const zeroLead = await call("PUT", `/products/${product.id}/service-rules`, { version: 2, body: { booking: { lead_time_hours: 0 }, urgent: { enabled: true, tiers: [{ within_hours: 1, surcharge: 0 }] } } });
  assert.deepEqual(issues(zeroLead), [["/urgent/tiers/0/within_hours", "TIER_NOT_WITHIN_LEAD_TIME"]]);
  assert.match(zeroLead.body.error.details.issues[0].message, /提前预订时长是 0.*请关掉加急，或把提前预订时长改成至少 1 小时/);
  const quota = await call("PUT", `/products/${product.id}/service-rules`, { version: 2, body: { urgent: { daily_quota: 0 } } });
  assert.equal(quota.body.error.details.issues[0].message, "请填 1 到 10000 之间的整数");
});

test("服务规则只留一种写法：结束在午夜的时段 24:00 和 00:00 等价，保存后统一成 00:00（全天仍是 00:00–24:00）；内容一样的再存不算修改", async () => {
  const product = await draft();
  const saved = await ok(call("PUT", `/products/${product.id}/service-rules`, {
    version: 1,
    body: { booking: { service_time: { start: "08:00", end: "24:00" } }, night: { window: { start: "22:00", end: "24:00" } } },
  }));
  assert.deepEqual([saved.version, saved.rules.booking.service_time, saved.rules.night.window], [2, { start: "08:00", end: "00:00" }, { start: "22:00", end: "00:00" }]);
  for (const end of ["24:00", "00:00"]) {
    const again = await ok(call("PUT", `/products/${product.id}/service-rules`, { version: 2, body: { booking: { service_time: { start: "08:00", end } }, night: { window: { start: "22:00", end } } } }));
    assert.equal(again.version, 2, `结束写成 ${end}：和存着的是同一个时段，不算修改`);
  }
  const allDay = await ok(call("PUT", `/products/${product.id}/service-rules`, { version: 2, body: { booking: { service_time: { start: "00:00", end: "24:00" } } } }));
  assert.deepEqual(allDay.rules.booking.service_time, { start: "00:00", end: "24:00" });
  assert.deepEqual(issues(await call("PUT", `/products/${product.id}/service-rules`, { version: 3, body: { booking: { service_time: { start: "00:00", end: "00:00" } } } })), [["/booking/service_time", "EMPTY_WINDOW"]]);
});

test("「首个免费」只对按个计费的附加服务有意义：别的计费方式下带了当作没设；平台后来改了计费方式，读取、上架校验、保存三处结论一致", async () => {
  // 按次计费的带了 first_free：不拒绝，存成 false
  const product = await completeDraft();
  const perOrder = await ok(call("PUT", `/products/${product.id}/service-rules`, { version: product.version, body: { ...RULES, addons: [{ addon_id: ids["sign"], unit_price: 0, first_free: true }, { addon_id: ids["seat"], unit_price: 1000, first_free: true }] } }));
  assert.deepEqual(perOrder.rules.addons.map((addon: any) => addon.first_free), [false, true]);
  // 平台把儿童座椅改成按次计费：商品里原来勾着的不再生效
  const seat = await ok(platform("GET", `/master/addons/${ids["seat"]}`));
  await ok(platform("PATCH", `/master/addons/${ids["seat"]}`, { charge_unit: "per_order" }, { "if-match": `"${seat.version}"` }));
  try {
    const read = await ok(call("GET", `/products/${product.id}/service-rules`));
    assert.deepEqual([read.version, read.rules.addons.map((addon: any) => addon.first_free)], [perOrder.version, [false, false]], "读到的是生效的那一份，版本号不变");
    assert.deepEqual((await ok(call("GET", `/products/${product.id}/publish-check`))).items.find((item: any) => item.key === "service_rules"), { key: "service_rules", required: true, passed: true, issues: [] });
    // 手上还是旧页面（仍然带着 first_free: true）的人改一句备注：能存，存下来的是整理后的
    const resaved = await ok(call("PUT", `/products/${product.id}/service-rules`, { version: read.version, body: { ...perOrder.rules, booking: { ...perOrder.rules.booking, note: "只加了一句备注" } } }));
    assert.deepEqual([resaved.version, resaved.rules.addons.map((addon: any) => addon.first_free)], [read.version + 1, [false, false]]);
    const stored = (await api.db.owner.query("select service_rules from products where id = $1", [product.id])).rows[0].service_rules;
    assert.deepEqual(stored.addons.map((addon: any) => addon.firstFree), [false, false], "落库的也是整理后的");
    // 平台改回按个计费：不会自动变回「首个免费」（已经存成没设了）
    const back = await ok(platform("GET", `/master/addons/${ids["seat"]}`));
    await ok(platform("PATCH", `/master/addons/${ids["seat"]}`, { charge_unit: "per_item" }, { "if-match": `"${back.version}"` }));
    assert.deepEqual((await ok(call("GET", `/products/${product.id}/service-rules`))).rules.addons.map((addon: any) => addon.first_free), [false, false]);
  } finally {
    const now = await ok(platform("GET", `/master/addons/${ids["seat"]}`));
    if (now.charge_unit !== "per_item") await ok(platform("PATCH", `/master/addons/${ids["seat"]}`, { charge_unit: "per_item" }, { "if-match": `"${now.version}"` }));
  }
});

test("接送点被平台改到别的城市：上架校验的「基础信息」指出来（PICKUP_PLACE_OTHER_CITY）；平台改回来之后恢复", async () => {
  const osaka = await ok(platform("POST", "/master/cities", { country_code: "JP", timezone: "Asia/Tokyo", code: "CTY-JP-MOV", name: { zh: "搬去的城市" }, center: { lng: 135.5, lat: 34.7 } }), 201);
  const airport = await ok(platform("POST", "/master/places", { type: "airport", code: "MVD", city_id: ids["tokyo"], name: { zh: "会被挪走的机场" }, location: { lng: 140.1, lat: 35.5 }, flight_scope: "domestic" }), 201);
  const product = await ok(call("POST", "/products", { body: { brand_id: ids["brand"], city_id: ids["tokyo"], category: "airport_transfer", poi_id: airport.id, dispatchers: [{ name: "x", phone: "0312345678" }] } }), 201);
  const basic = async (): Promise<string[]> => (await ok(call("GET", `/products/${product.id}/publish-check`))).items[0].issues.map((issue: any) => `${issue.path} ${issue.reason}`);
  assert.ok(!(await basic()).some((issue) => issue.startsWith("/poi_id")));
  await ok(platform("PATCH", `/master/places/${airport.id}`, { city_id: osaka.id }, { "if-match": `"${airport.version}"` }));
  assert.ok((await basic()).includes("/poi_id PICKUP_PLACE_OTHER_CITY"));
  const moved = await ok(platform("GET", `/master/places/${airport.id}`));
  await ok(platform("PATCH", `/master/places/${airport.id}`, { city_id: ids["tokyo"] }, { "if-match": `"${moved.version}"` }));
  assert.ok(!(await basic()).some((issue) => issue.startsWith("/poi_id")), "改回来就好了");
});

test("商品详情：各语言的标题、简介、包含 / 不含、行程、接机指引；整体保存，空串当没填；标题出现在商品和列表上", async () => {
  const product = await draft();
  assert.deepEqual(await ok(call("GET", `/products/${product.id}/content`)), { version: 1, content: {} });
  assert.equal((await call("PUT", `/products/${product.id}/content`, { body: {} })).status, 428);
  const saved = await ok(call("PUT", `/products/${product.id}/content`, {
    version: 1,
    body: { zh: { title: " 成田机场专车 ", summary: "", includes: [" 司机 ", "油费"], pickup_guide: "到达大厅 3 号门" }, ja: { title: "成田空港送迎" }, en: { title: "", includes: [] } },
  }));
  assert.deepEqual(saved, {
    version: 2,
    content: {
      ja: { title: "成田空港送迎", summary: null, includes: [], excludes: [], itinerary: null, pickup_guide: null },
      zh: { title: "成田机场专车", summary: null, includes: ["司机", "油费"], excludes: [], itinerary: null, pickup_guide: "到达大厅 3 号门" },
    },
  });
  assert.deepEqual((await ok(call("GET", `/products/${product.id}`))).title, { ja: "成田空港送迎", zh: "成田机场专车" });
  assert.equal((await ok(call("PUT", `/products/${product.id}/content`, { version: 2, body: saved.content }))).version, 2, "原样提交回去：没有变化");
  assert.deepEqual(issues(await call("PUT", `/products/${product.id}/content`, { version: 2, body: { zh: { title: "题".repeat(101), includes: ["好", "x".repeat(201)] } } })), [["/zh/title", "TOO_LONG"], ["/zh/includes/1", "TOO_LONG"]]);
  assert.deepEqual(issues(await call("PUT", `/products/${product.id}/content`, { version: 2, body: { zh: { title: "​" } } })), [["/zh/title", "REQUIRED"]]);
  assert.deepEqual(issues(await call("PUT", `/products/${product.id}/content`, { version: 2, body: { fr: { title: "Narita" } } })).map(([path]) => path), ["/"]);
  // 按标题搜得到
  assert.deepEqual((await ok(call("GET", `/products?q=${encodeURIComponent("空港送迎")}`))).items.map((item: any) => item.id), [product.id]);
});

test("上架校验：逐项给出通过 / 不通过和原因；空的草稿四项必须的都不通过；填全之后只剩「价格规则」，加上一条价格就能上架", async () => {
  const empty = await draft();
  const first = await ok(call("GET", `/products/${empty.id}/publish-check`));
  assert.equal(first.can_publish, false);
  assert.deepEqual(first.items.map((item: any) => [item.key, item.required, item.passed]), [
    ["basic_info", true, false], ["service_rules", true, false], ["price_rules", true, false], ["content", true, false], ["adjust_rules", false, true], ["inventory", false, true],
  ]);
  const reasons = (check: any, key: string): string[] => check.items.find((item: any) => item.key === key).issues.map((issue: any) => `${issue.path} ${issue.reason}`);
  assert.deepEqual(reasons(first, "basic_info"), ["/areas NO_AREA", "/vehicle_groups NO_VEHICLE_GROUP", "/dispatchers NO_DISPATCHER"]);
  assert.deepEqual(reasons(first, "service_rules"), ["/booking/service_time REQUIRED", "/booking/lead_time_hours REQUIRED", "/free_wait/pickup REQUIRED", "/free_wait/dropoff REQUIRED"]);
  assert.deepEqual(reasons(first, "price_rules"), ["/ NO_ACTIVE_PRICE_RULE"]);
  assert.deepEqual(reasons(first, "content"), ["/title REQUIRED"]);
  assert.ok(first.items.flatMap((item: any) => item.issues).every((issue: any) => typeof issue.message === "string" && issue.message.length > 0), "每条原因都有中文说明");

  const product = await completeDraft();
  const check = await ok(call("GET", `/products/${product.id}/publish-check`));
  assert.deepEqual(check.items.filter((item: any) => !item.passed).map((item: any) => item.key), ["price_rules"], "除了价格规则，其余都满足");
  assert.equal(check.can_publish, false);
  // 上架接口：被价格规则这一项拦住，逐项结果在 details 里；商品还是草稿，没有日志
  const refused = await call("POST", `/products/${product.id}/publish`);
  assert.deepEqual([refused.status, refused.body.error.code], [409, "PUBLISH_CHECK_FAILED"]);
  assert.deepEqual(refused.body.error.details.items, check.items);
  assert.equal((await ok(call("GET", `/products/${product.id}`))).status, "draft");
  assert.ok(!(await audits("product", product.id)).some((log) => log.action === "publish"));
  // 接送机：有标题的语言缺接机指引
  await ok(call("PUT", `/products/${product.id}/content`, { version: product.version, body: { zh: { title: "成田接送", pickup_guide: "3 号门" }, ja: { title: "成田送迎" } } }));
  assert.deepEqual(reasons(await ok(call("GET", `/products/${product.id}/publish-check`)), "content"), ["/ja/pickup_guide REQUIRED"]);
  assert.equal((await call("GET", `/products/${MISSING}/publish-check`)).status, 404);
  assert.equal((await call("POST", `/products/${MISSING}/publish`)).status, 404);
  // 补上接机指引、加一条价格：全部通过，上架成功，记一条日志
  const fixedUp = await ok(call("PUT", `/products/${product.id}/content`, { version: product.version + 1, body: { zh: { title: "成田接送", pickup_guide: "3 号门" } } }));
  const live = await publish(product.id);
  assert.deepEqual([live.status, live.version, typeof live.published_at], ["published", fixedUp.version + 2, "string"], "加价格、上架各让版本号加一");
  assert.equal((await ok(call("GET", `/products/${product.id}/publish-check`))).can_publish, true);
  assert.deepEqual((await audits("product", product.id)).at(-1), { action: "publish", tenant_id: tenant.tenantId, actor_email: "admin@a.test", before: { status: "draft" }, after: { status: "published" } });
  // 下架：后面的测试要停用它用着的主数据
  await ok(call("POST", `/products/${product.id}/unpublish`));
});

test("上架校验看的是现在的情况：选的区域被停用、车型组的组合被平台改掉、附加服务和接送点被平台停用，都会被指出来", async () => {
  const product = await completeDraft();
  const extra = await area();
  await ok(call("PATCH", `/products/${product.id}`, { version: product.version, body: { areas: [{ area_id: ids["area"] }, { area_id: extra.id }] } }));
  await ok(call("POST", `/areas/${extra.id}/disable`));
  const group = await ok(platform("GET", `/master/vehicle-groups/${ids["biz7"]}`));
  await ok(platform("PATCH", `/master/vehicle-groups/${ids["biz7"]}`, { combos: [{ passengers: 5, luggage: 3 }] }, { "if-match": `"${group.version}"` }));
  await ok(platform("POST", `/master/addons/${ids["seat"]}/disable`));
  const check = await ok(call("GET", `/products/${product.id}/publish-check`));
  const reasons = (key: string): string[] => check.items.find((item: any) => item.key === key).issues.map((issue: any) => `${issue.path} ${issue.reason}`);
  assert.deepEqual(reasons("basic_info"), ["/areas/1 AREA_DISABLED", "/vehicle_groups/0 VEHICLE_COMBO_NOT_OFFERED"]);
  assert.deepEqual(reasons("service_rules"), ["/addons/0/addon_id ADDON_DISABLED"]);
  // 恢复，免得影响后面的测试
  await ok(platform("PATCH", `/master/vehicle-groups/${ids["biz7"]}`, { combos: group.combos }, { "if-match": `"${group.version + 1}"` }));
  await ok(platform("POST", `/master/addons/${ids["seat"]}/enable`));
  assert.deepEqual((await ok(call("GET", `/products/${product.id}/publish-check`))).items.filter((item: any) => !item.passed).map((item: any) => item.key), ["basic_info", "price_rules"]);
});

test("下架和删除：草稿不能下架、可以删除；已上架的可以下架、不能删除；已下架的再下架原样返回、也不能删除；删除前的内容记在日志里", async () => {
  const product = await completeDraft();
  const notYet = await call("POST", `/products/${product.id}/unpublish`);
  assert.deepEqual([notYet.status, notYet.body.error.code], [409, "PRODUCT_STATE_INVALID"]);
  const live = await publish(product.id);
  assert.deepEqual([(await ok(call("POST", `/products/${product.id}/publish`))).status, (await ok(call("POST", `/products/${product.id}/publish`))).version], ["published", live.version], "已经上架的再上架：原样返回");
  const blocked = await call("DELETE", `/products/${product.id}`);
  assert.deepEqual([blocked.status, blocked.body.error.code, blocked.body.error.details], [409, "PRODUCT_NOT_DRAFT", { status: "published" }]);
  const down = await ok(call("POST", `/products/${product.id}/unpublish`));
  assert.deepEqual([down.status, down.version], ["unpublished", live.version + 1]);
  assert.deepEqual((await ok(call("POST", `/products/${product.id}/unpublish`))).version, down.version);
  assert.equal((await call("DELETE", `/products/${product.id}`)).body.error.code, "PRODUCT_NOT_DRAFT");
  assert.deepEqual((await audits("product", product.id)).at(-1), { action: "unpublish", tenant_id: tenant.tenantId, actor_email: "admin@a.test", before: { status: "published" }, after: { status: "unpublished" } });
  // 已下架的再上架同样要过校验：条件还满足就能再上架；把服务规则清空就上不去了
  assert.equal((await ok(call("POST", `/products/${product.id}/publish`))).status, "published");
  const again = await ok(call("POST", `/products/${product.id}/unpublish`));
  await ok(call("PUT", `/products/${product.id}/service-rules`, { version: again.version, body: {} }));
  assert.equal((await call("POST", `/products/${product.id}/publish`)).body.error.code, "PUBLISH_CHECK_FAILED");

  const throwaway = await completeDraft();
  const removed = await call("DELETE", `/products/${throwaway.id}`);
  assert.deepEqual([removed.status, removed.text], [204, ""]);
  assert.equal((await call("GET", `/products/${throwaway.id}`)).status, 404);
  assert.equal((await call("DELETE", `/products/${throwaway.id}`)).status, 404);
  for (const table of ["product_areas", "product_vehicle_groups", "product_dispatchers"]) {
    assert.equal((await api.db.owner.query(`select count(*)::int as n from ${table} where product_id = $1`, [throwaway.id])).rows[0].n, 0, table);
  }
  const log = (await audits("product", throwaway.id)).at(-1);
  assert.deepEqual([log.action, log.after, log.before.code, log.before.areas, log.before.content.zh.title], ["delete", null, throwaway.code, [ids["area"]], "成田机场接送"]);
});

test("已上架的商品可以直接改，但改完必须仍然满足上架条件，否则这次修改被拒绝、什么都不变", async () => {
  const product = await completeDraft();
  const live = await publish(product.id);
  const refused = await call("PATCH", `/products/${product.id}`, { version: live.version, body: { areas: [] } });
  assert.deepEqual([refused.status, refused.body.error.code], [409, "PUBLISH_CHECK_FAILED"]);
  const failing = Object.fromEntries(refused.body.error.details.items.filter((item: any) => !item.passed).map((item: any) => [item.key, item.issues.map((issue: any) => issue.reason)]));
  assert.deepEqual(failing, { basic_info: ["NO_AREA"] });
  const rules = await call("PUT", `/products/${product.id}/service-rules`, { version: live.version, body: {} });
  assert.equal(rules.body.error.code, "PUBLISH_CHECK_FAILED");
  const content = await call("PUT", `/products/${product.id}/content`, { version: live.version, body: {} });
  assert.equal(content.body.error.code, "PUBLISH_CHECK_FAILED");
  const now = await ok(call("GET", `/products/${product.id}`));
  assert.deepEqual([now.version, now.area_count, now.title], [live.version, 1, { zh: "成田机场接送" }]);
  assert.equal((await ok(call("GET", `/products/${product.id}/service-rules`))).rules.booking.lead_time_hours, 24);
  // 改完仍然满足条件的修改照常保存，商品还是已上架
  const kept = await ok(call("PATCH", `/products/${product.id}`, { version: live.version, body: { dispatchers: [{ name: "换了调度", phone: "0312345678" }] } }));
  assert.deepEqual([kept.status, kept.version, kept.dispatchers], ["published", live.version + 1, [{ name: "换了调度", phone: "0312345678" }]]);
});

test("区域被商品使用：应答里带使用数；有商品在用时不能改业务类型；有已上架的商品在用时不能删除、不能停用；草稿在用的区域删了，草稿少掉这个区域", async () => {
  const used = await area();
  const draftOnly = await completeDraft();
  const published = await completeDraft();
  for (const product of [draftOnly, published]) {
    await ok(call("PATCH", `/products/${product.id}`, { version: product.version, body: { areas: [{ area_id: ids["area"] }, { area_id: used.id }] } }));
  }
  assert.deepEqual((await ok(call("GET", `/areas/${used.id}`))).usage, { product_count: 2, published_product_count: 0 });
  const listed = (await ok(call("GET", "/areas?limit=200"))).items.find((item: any) => item.id === used.id);
  assert.deepEqual(listed.usage, { product_count: 2, published_product_count: 0 });
  assert.deepEqual((await ok(call("GET", `/products?area_id=${used.id}`))).items.map((item: any) => item.id).sort(), [draftOnly.id, published.id].sort());

  const locked = await call("PUT", `/areas/${used.id}`, { version: used.version, body: { name: used.name, biz_type: "charter", polygons: used.polygons } });
  assert.deepEqual([locked.status, locked.body.error.code, locked.body.error.details], [409, "FIELD_LOCKED", { fields: ["biz_type"] }]);
  assert.equal((await call("PUT", `/areas/${used.id}`, { version: used.version, body: { name: { zh: "改了名字" }, biz_type: "general", polygons: used.polygons } })).status, 200, "名称和图形照常能改");

  await publish(published.id);
  assert.deepEqual((await ok(call("GET", `/areas/${used.id}`))).usage, { product_count: 2, published_product_count: 1 });
  for (const [method, path] of [["DELETE", `/areas/${used.id}`], ["POST", `/areas/${used.id}/disable`]] as const) {
    const res = await call(method, path);
    assert.deepEqual([res.status, res.body.error.code, res.body.error.details], [409, "AREA_IN_USE", { published_product_count: 1 }], `${method} ${path}`);
  }
  assert.equal((await ok(call("GET", `/areas/${used.id}`))).status, "active");
  // 下架之后就可以删了：两个商品都少掉这个区域，版本号不变（商品本身没有被改）
  await ok(call("POST", `/products/${published.id}/unpublish`));
  assert.equal((await call("DELETE", `/areas/${used.id}`)).status, 204);
  for (const product of [draftOnly, published]) {
    assert.deepEqual((await ok(call("GET", `/products/${product.id}`))).areas.map((item: any) => item.area_id), [ids["area"]]);
  }
});

test("平台主数据被已上架的商品用着时不能停用（城市、接送点、车型组、开着的附加服务）；只有草稿在用时可以停用，草稿的上架校验会指出来", async () => {
  // 前面的测试留下了已上架的商品，先清掉，这里的个数才只算本测试的
  await api.db.owner.query("delete from products");
  const product = await completeDraft();
  // 只有草稿在用：四样都能停用
  for (const [path, key] of [["vehicle-groups", "eco4"], ["addons", "sign"], ["places", "haneda"]] as const) {
    assert.equal((await platform("POST", `/master/${path}/${ids[key]}/disable`)).status, 200, path);
    assert.equal((await platform("POST", `/master/${path}/${ids[key]}/enable`)).status, 200, path);
  }
  await publish(product.id);
  const expectBlocked = async (path: string, id: string): Promise<void> => {
    const res = await platform("POST", `/master/${path}/${id}/disable`);
    assert.deepEqual([res.status, res.body.error.code, res.body.error.details], [409, "MASTER_DATA_IN_USE", { active_count: 1 }], `${path}：${res.text}`);
    assert.match(res.body.error.message, /有 1 个已上架的商品在用/);
  };
  await expectBlocked("vehicle-groups", ids["biz7"] as string);
  await expectBlocked("addons", ids["seat"] as string);
  await expectBlocked("places", ids["narita"] as string);
  // 没被这个商品用到的照常能停用
  assert.equal((await platform("POST", `/master/vehicle-groups/${ids["eco4"]}/disable`)).status, 200);
  assert.equal((await platform("POST", `/master/vehicle-groups/${ids["eco4"]}/enable`)).status, 200);
  assert.equal((await platform("POST", `/master/addons/${ids["guide"]}/disable`)).status, 200);
  assert.equal((await platform("POST", `/master/addons/${ids["guide"]}/enable`)).status, 200);
  // 下架之后就可以停用了；停用后这个商品的上架校验指出来
  await ok(call("POST", `/products/${product.id}/unpublish`));
  assert.equal((await platform("POST", `/master/vehicle-groups/${ids["biz7"]}/disable`)).status, 200);
  const check = await ok(call("GET", `/products/${product.id}/publish-check`));
  assert.deepEqual(check.items[0].issues.map((issue: any) => `${issue.path} ${issue.reason}`), ["/vehicle_groups/0 VEHICLE_GROUP_DISABLED"]);
  assert.equal((await platform("POST", `/master/vehicle-groups/${ids["biz7"]}/enable`)).status, 200);
});

test("城市被已上架的商品用着时不能停用", async () => {
  const kyoto = await ok(platform("POST", "/master/cities", { code: "CTY-JP-KYO", country_code: "JP", timezone: "Asia/Tokyo", name: { zh: "京都" }, center: { lng: 135.7681, lat: 35.0116 } }), 201);
  const kyotoArea = await area({ city_id: kyoto.id });
  const product = await ok(call("POST", "/products", { body: { brand_id: ids["brand"], city_id: kyoto.id, category: "charter", areas: [{ area_id: kyotoArea.id }] } }), 201);
  assert.equal((await platform("POST", `/master/cities/${kyoto.id}/disable`)).status, 200, "只有草稿在用：可以停用");
  assert.deepEqual((await ok(call("GET", `/products/${product.id}/publish-check`))).items[0].issues.map((issue: any) => issue.reason).slice(0, 2), ["CITY_DISABLED", "AREA_CITY_DISABLED"]);
  assert.equal((await platform("POST", `/master/cities/${kyoto.id}/enable`)).status, 200);
  await publish(product.id);
  const blocked = await platform("POST", `/master/cities/${kyoto.id}/disable`);
  assert.deepEqual([blocked.status, blocked.body.error.code, blocked.body.error.details], [409, "MASTER_DATA_IN_USE", { active_count: 1 }]);
});

test("新增商品时引用的平台主数据已停用：409 MASTER_DATA_NOT_READY（和区域一致），什么都不写", async () => {
  const nagoya = await ok(platform("POST", "/master/cities", { code: "CTY-JP-NGO", country_code: "JP", timezone: "Asia/Tokyo", name: { zh: "名古屋" }, center: { lng: 136.9066, lat: 35.1815 } }), 201);
  const ngo = await ok(platform("POST", "/master/places", { type: "airport", code: "NGO", city_id: nagoya.id, name: { zh: "中部机场" }, location: { lng: 136.8049, lat: 34.8584 } }), 201);
  const body = { brand_id: ids["brand"], city_id: nagoya.id, category: "airport_transfer", poi_id: ngo.id };
  await ok(platform("POST", `/master/places/${ngo.id}/disable`));
  const place = await call("POST", "/products", { body });
  assert.deepEqual([place.status, place.body.error.code, place.body.error.details], [409, "MASTER_DATA_NOT_READY", { reason: "PICKUP_PLACE_DISABLED" }]);
  await ok(platform("POST", `/master/cities/${nagoya.id}/disable`));
  const city = await call("POST", "/products", { body: { ...body, category: "charter", poi_id: null } });
  assert.deepEqual([city.status, city.body.error.code, city.body.error.details], [409, "MASTER_DATA_NOT_READY", { reason: "CITY_DISABLED" }]);
  // 写错的（400）优先于状态不允许的（409）
  assert.deepEqual(issues(await call("POST", "/products", { body: { ...body, brand_id: MISSING } })), [["/brand_id", "UNKNOWN_BRAND"]]);
  assert.equal((await api.db.owner.query("select count(*)::int as n from products where city_id = $1", [nagoya.id])).rows[0].n, 0);
});

test("地点列表可以一次按多个类型筛（接送点的选项：机场 + 车站）；平台和租户两侧写法一样", async () => {
  for (const list of [(query: string) => call("GET", `/master/places?${query}`), (query: string) => platform("GET", `/master/places?${query}`)]) {
    const types = async (query: string): Promise<string[]> => {
      const res = await ok(list(`city_id=${ids["tokyo"]}&status=all&limit=200&${query}`));
      assert.equal(res.total, res.items.length);
      return [...new Set<string>(res.items.map((item: any) => item.type))].sort();
    };
    assert.deepEqual(await types("type=airport,station"), ["airport", "station"]);
    assert.deepEqual(await types("type=station,station"), ["station"]);
    assert.deepEqual(await types("type=poi"), ["poi"]);
    for (const bad of ["type=airport,bus", "type=", "type=airport,", "type=airport%20station"]) assert.equal((await list(bad)).status, 400, bad);
  }
});

test("列表：按最近修改从新到旧翻页不重不漏，每页的 total 一样；列表项不带明细只带个数；按关键字、状态、品类、城市、子品牌筛选", async () => {
  await api.db.owner.query("delete from products");
  const a = await completeDraft();
  await publish(a.id);
  const b = await draft({ category: "charter", poi_id: null });
  const c = await draft({ poi_id: ids["station"] });
  api.clock.advance(1_000);
  await ok(call("PUT", `/products/${b.id}/content`, { version: 1, body: { en: { title: "Tokyo Charter 100%" } } }));
  const seen: string[] = [];
  let cursor: string | null = null;
  do {
    const res: any = await ok(call("GET", `/products?limit=2${cursor ? `&cursor=${cursor}` : ""}`));
    assert.equal(res.total, 3);
    seen.push(...res.items.map((item: any) => item.id));
    cursor = res.next_cursor;
  } while (cursor);
  assert.deepEqual(seen, [b.id, c.id, a.id], "刚改过的排最前");
  const item = (await ok(call("GET", `/products?q=${a.code}`))).items[0];
  assert.deepEqual(Object.keys(item).sort(), [
    "area_count", "brand", "brand_id", "category", "check", "city", "city_id", "code", "created_at", "id", "poi", "poi_id", "published_at", "status", "title", "updated_at", "vehicle_group_count", "version",
  ]);
  assert.deepEqual([item.id, item.status, item.area_count, item.vehicle_group_count, item.title], [a.id, "published", 1, 1, { zh: "成田机场接送" }]);
  // 上架准备的概况：已上架的全部满足；空草稿四项必须的都没满足（都是自己能补的，没有「功能未开放」的了）
  const checks = Object.fromEntries((await ok(call("GET", "/products"))).items.map((entry: any) => [entry.id, entry.check]));
  assert.deepEqual(checks[a.id], { can_publish: true, failed_required: 0, unavailable_required: 0 });
  assert.deepEqual(checks[c.id], { can_publish: false, failed_required: 4, unavailable_required: 0 });
  const found = async (query: string): Promise<string[]> => {
    const res = await ok(call("GET", `/products?${query}`));
    assert.equal(res.total, res.items.length, query);
    return res.items.map((entry: any) => entry.id);
  };
  assert.deepEqual(await found("q=charter"), [b.id]);
  assert.deepEqual(await found(`q=${encodeURIComponent("100%")}`), [b.id]);
  assert.deepEqual(await found(`q=${encodeURIComponent("%")}`), [b.id]);
  assert.deepEqual(await found(`q=${a.code.toLowerCase()}`), [a.id], "编号不分大小写");
  assert.deepEqual(await found("status=published"), [a.id]);
  assert.deepEqual(await found("status=draft"), [b.id, c.id]);
  assert.deepEqual(await found("category=airport_transfer"), [c.id, a.id]);
  assert.deepEqual(await found(`city_id=${ids["osaka"]}`), []);
  assert.deepEqual(await found(`brand_id=${ids["brand"]}&category=charter&status=all`), [b.id]);
  assert.deepEqual(await found(`area_id=${ids["area"]}`), [a.id]);
  for (const bad of ["status=deleted", "category=bus", "city_id=tokyo", "limit=0", "cursor=garbage", "q="]) assert.equal((await call("GET", `/products?${bad}`)).status, 400, bad);
});

test("权限：管理员和商品价格能改商品；只读能看不能改；调度和财务看都不能看；子品牌只有管理员能建", async () => {
  const product = await draft();
  const tokens: Record<string, string> = {};
  for (const role of ["pricing", "dispatch", "finance", "readonly"]) tokens[role] = (await addTenantUser(api, tenant.adminToken, `${role}-p@a.test`, role)).token;
  const reads: [HttpMethod, string][] = [["GET", "/brands"], ["GET", "/products"], ["GET", `/products/${product.id}`], ["GET", `/products/${product.id}/service-rules`], ["GET", `/products/${product.id}/content`], ["GET", `/products/${product.id}/publish-check`]];
  const writes: [HttpMethod, string, unknown][] = [
    ["POST", "/products", { brand_id: ids["brand"], city_id: ids["tokyo"], category: "charter" }],
    ["PATCH", `/products/${product.id}`, { dispatchers: [] }],
    ["PUT", `/products/${product.id}/service-rules`, {}],
    ["PUT", `/products/${product.id}/content`, {}],
    ["POST", `/products/${product.id}/publish`, undefined],
    ["POST", `/products/${product.id}/unpublish`, undefined],
    ["DELETE", `/products/${product.id}`, undefined],
  ];
  const brandWrites: [HttpMethod, string, unknown][] = [["POST", "/brands", { name: "不该出现", currency: "JPY" }], ["PUT", `/brands/${ids["brand"]}`, { name: "被改了" }]];
  for (const role of ["dispatch", "finance"]) {
    for (const [method, path, body] of [...reads.map(([m, p]) => [m, p, undefined] as const), ...writes, ...brandWrites]) {
      assert.equal((await call(method, path, { token: tokens[role] as string, body, version: 1 })).status, 403, `${role} ${method} ${path}`);
    }
  }
  for (const [method, path] of reads) assert.equal((await call(method, path, { token: tokens["readonly"] as string })).status, 200, `readonly ${method} ${path}`);
  for (const [method, path, body] of [...writes, ...brandWrites]) assert.equal((await call(method, path, { token: tokens["readonly"] as string, body, version: 1 })).status, 403, `readonly ${method} ${path}`);
  for (const [method, path, body] of brandWrites) assert.equal((await call(method, path, { token: tokens["pricing"] as string, body, version: 1 })).status, 403, `pricing ${method} ${path}`);
  const pricing = tokens["pricing"] as string;
  const made = await ok(call("POST", "/products", { token: pricing, body: { brand_id: ids["brand"], city_id: ids["tokyo"], category: "charter" } }), 201);
  assert.equal((await call("PATCH", `/products/${made.id}`, { token: pricing, version: 1, body: { dispatchers: [{ name: "小张", phone: "0312345678" }] } })).status, 200);
  assert.equal((await call("DELETE", `/products/${made.id}`, { token: pricing })).status, 204);
  assert.deepEqual([...new Set((await audits("product", made.id)).map((log) => log.actor_email))], ["pricing-p@a.test"]);
  assert.equal((await api.call("GET", "/tenant/v1/products")).status, 401);
  assert.equal((await api.call("GET", "/tenant/v1/products", { token: root })).status, 401);
});

test("首页数量：商品按状态数；没有 product.read 的角色拿到 null", async () => {
  const fresh = await api.tenantWithAdmin(root, "新车队", "admin@fresh.test");
  const summary = async (token: string): Promise<any> => ok(api.call("GET", "/tenant/v1/dashboard/summary", { token }));
  assert.deepEqual(await summary(fresh.adminToken), { areas: { active: 0, disabled: 0 }, products: { draft: 0, published: 0, unpublished: 0 } });
  const brand = await ok(call("POST", "/brands", { token: fresh.adminToken, body: { name: "新品牌", currency: "JPY" } }), 201);
  const made: any[] = [];
  for (let i = 0; i < 3; i += 1) made.push(await ok(call("POST", "/products", { token: fresh.adminToken, body: { brand_id: brand.id, city_id: ids["tokyo"], category: "charter" } }), 201));
  await publish(made[0].id, fresh.adminToken);
  await publish(made[1].id, fresh.adminToken);
  await ok(call("POST", `/products/${made[1].id}/unpublish`, { token: fresh.adminToken }));
  assert.deepEqual((await summary(fresh.adminToken)).products, { draft: 1, published: 1, unpublished: 1 });
  assert.deepEqual((await summary((await addTenantUser(api, fresh.adminToken, "finance@fresh.test", "finance")).token)), { areas: null, products: null });
});

test("规则 4：商品相关接口的任何返回里都没有对外价和加价比例相关的字段", async () => {
  const product = await completeDraft();
  for (const path of ["/brands", "/products", `/products/${product.id}`, `/products/${product.id}/service-rules`, `/products/${product.id}/content`, `/products/${product.id}/publish-check`, "/dashboard/summary"]) {
    assert.doesNotMatch((await call("GET", path)).text, /markup|sell_price|selling_price|public_price|对外价|加价比例/i, path);
  }
});
