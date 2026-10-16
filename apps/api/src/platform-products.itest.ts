/**
 * M1-12：运营后台只读查看供应商的商品（ADR 0021），经真实接口、真实 PostgreSQL。
 * - 列表跨供应商：每行带供应商、子品牌、城市、品类、状态、上架时间、更新时间、有没有可以卖的价格；筛选、分页边界；
 * - 详情和供应商自己在租户后台看到的逐部分相同（基础信息、服务规则、详情、价格、调价、上架校验），带库存和所属供应商；
 * - 权限：租户令牌、没有令牌进不来；十个平台角色里只有有 `product.read` 的能看；
 * - 只读：所有调用前后，商品相关的每张表、审计日志一行不差；
 * - 首页卡片要的「已上架商品数」从列表的 total 取；应答逐字段符合 openapi.yaml。
 * 测试数据只在这里构造，结束时连同 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PLATFORM_ROLES, type PlatformRole, platformRoleCan } from "@nozomi/domain";
import { type ApiResponse, type HttpMethod, TEST_PASSWORD, type TenantFixture, type TestApi, createTestApi } from "./testing/api.ts";
import { assertMatchesOperation } from "./testing/openapi.ts";

let api: TestApi;
let root: string;
let a: TenantFixture;
let b: TenantFixture;
let c: TenantFixture;
const ids: Record<string, string> = {};
const roleTokens = new Map<PlatformRole, string>();
const MISSING = "99999999-9999-4999-8999-999999999999";
const LIST = "/platform/v1/products";
const ONE = "/platform/v1/products/{id}";

const platform = (path: string, token: string = root): Promise<ApiResponse> => api.call("GET", `/platform/v1${path}`, { token });
const tenantCall = (who: TenantFixture, method: HttpMethod, path: string, options: { body?: unknown; version?: number } = {}): Promise<ApiResponse> =>
  api.call(method, `/tenant/v1${path}`, {
    token: who.adminToken,
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
/** 调列表，核对应答符合定义 */
async function list(query = "", token: string = root): Promise<any> {
  const res = await platform(`/products${query === "" ? "" : `?${query}`}`, token);
  assert.equal(res.status, 200, res.text);
  assertMatchesOperation("GET", LIST, 200, res.body);
  return res.body;
}
async function show(id: string, token: string = root): Promise<any> {
  const res = await platform(`/products/${id}`, token);
  assert.equal(res.status, 200, res.text);
  assertMatchesOperation("GET", ONE, 200, res.body);
  return res.body;
}
const version = async (who: TenantFixture, productId: string): Promise<number> => (await ok(tenantCall(who, "GET", `/products/${productId}`))).version;
const square = (west: number, south: number, east: number, north: number): unknown => ({ kind: "operate", geometry: { type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] } });

async function area(who: TenantFixture, cityId: string, name: string, polygon: unknown): Promise<string> {
  api.clock.advance(1_000);
  return (await ok(tenantCall(who, "POST", "/areas", { body: { city_id: cityId, name: { zh: name }, biz_type: "general", polygons: [polygon] } }), 201)).id;
}

/** 一个配好了的商品（区域、车型组、调度人、服务规则、详情），还没有价格，是草稿。 */
async function product(who: TenantFixture, input: { brandId: string; cityId: string; category: "airport_transfer" | "point_to_point"; areaId: string; title: Record<string, string> }): Promise<string> {
  api.clock.advance(1_000);
  const transfer = input.category === "airport_transfer";
  const created = await ok(
    tenantCall(who, "POST", "/products", {
      body: {
        brand_id: input.brandId,
        city_id: input.cityId,
        category: input.category,
        poi_id: transfer ? ids["narita"] : null,
        areas: [{ area_id: input.areaId }],
        vehicle_groups: [{ vehicle_group_id: ids["eco4"], passengers: 3, luggage: 2 }],
        dispatchers: [{ name: "调度", phone: "0312345678" }],
      },
    }),
    201,
  );
  api.clock.advance(1_000);
  const freeWait = transfer ? { pickup: { mode: "limited", minutes: 90 }, dropoff: { mode: "limited", minutes: 15 } } : { general: { mode: "limited", minutes: 15 } };
  const saved = await ok(tenantCall(who, "PUT", `/products/${created.id}/service-rules`, { version: 1, body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: freeWait } }));
  api.clock.advance(1_000);
  const content = Object.fromEntries(Object.entries(input.title).map(([language, title]) => [language, { title, ...(transfer ? { pickup_guide: "到达大厅" } : {}) }]));
  await ok(tenantCall(who, "PUT", `/products/${created.id}/content`, { version: saved.version, body: content }));
  return created.id;
}
async function addPrice(who: TenantFixture, productId: string, areaId: string, basePrice: number): Promise<void> {
  api.clock.advance(1_000);
  const body = { area_id: areaId, vehicle_group_id: ids["eco4"], pricing_model: "fixed", base_price: basePrice, valid_from: "2026-01-01" };
  await ok(tenantCall(who, "POST", `/products/${productId}/price-rules`, { version: await version(who, productId), body: { ...body, ...(productId === ids["pa1"] ? { direction: "both" } : {}) } }), 201);
}
async function publish(who: TenantFixture, productId: string): Promise<void> {
  api.clock.advance(1_000);
  await ok(tenantCall(who, "POST", `/products/${productId}/publish`));
}

/** 商品相关的每张表（迁移账号读）和审计日志的行数：用来证明平台的接口什么都没写。 */
async function everything(): Promise<unknown> {
  const tables = ["brands", "products", "product_areas", "product_vehicle_groups", "product_dispatchers", "price_rules", "adjust_rules", "inventory_days", "areas", "area_polygons", "tenants"];
  const rows: Record<string, unknown> = {};
  for (const table of tables) rows[table] = (await api.db.owner.query(`select to_jsonb(t) as row from ${table} t order by to_jsonb(t)::text`)).rows;
  rows["audit_logs"] = (await api.db.owner.query("select count(*)::int as n from audit_logs")).rows[0].n;
  return rows;
}

before(async () => {
  api = await createTestApi();
  root = await api.superAdminToken();
  roleTokens.set("super_admin", root);
  for (const { key } of PLATFORM_ROLES) {
    if (key === "super_admin") continue;
    const email = `${key.replaceAll("_", "-")}@platform.test`;
    const invited = await ok(api.call("POST", "/platform/v1/staff", { token: root, body: { email, name: key, role: key } }), 201);
    await ok(api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.invite.token, password: TEST_PASSWORD } }));
    const login = await ok(api.call("POST", "/platform/v1/auth/login", { body: { email, password: TEST_PASSWORD }, ip: `10.12.0.${roleTokens.size + 1}` }));
    roleTokens.set(key, login.access_token as string);
  }
  a = await api.tenantWithAdmin(root, "甲车队", "admin@m112-a.test");
  b = await api.tenantWithAdmin(root, "乙车队", "admin@m112-b.test");
  c = await api.tenantWithAdmin(root, "丙车队", "admin@m112-c.test");
  const create = async (path: string, body: unknown): Promise<string> => (await ok(api.call("POST", `/platform/v1/master/${path}`, { token: root, body }), 201)).id;
  ids["tokyo"] = await create("cities", { country_code: "JP", timezone: "Asia/Tokyo", code: "CTY-JP-TYO", name: { zh: "东京" }, center: { lng: 139.6917, lat: 35.6895 } });
  ids["osaka"] = await create("cities", { country_code: "JP", timezone: "Asia/Tokyo", code: "CTY-JP-OSA", name: { zh: "大阪" }, center: { lng: 135.5, lat: 34.7 } });
  ids["narita"] = await create("places", { location: { lng: 140.3887, lat: 35.7686 }, type: "airport", code: "NRT", city_id: ids["tokyo"], name: { zh: "成田机场" }, flight_scope: "international" });
  ids["eco4"] = await create("vehicle-groups", { grade: "economy", seats: 4, power: "fuel", combos: [{ passengers: 3, luggage: 2 }], code: "VG-ECO-4", name: { zh: "经济 4 座" } });
  ids["brandA"] = (await ok(tenantCall(a, "POST", "/brands", { body: { name: "甲 JP", currency: "JPY" } }), 201)).id;
  ids["brandA2"] = (await ok(tenantCall(a, "POST", "/brands", { body: { name: "甲 Premium", currency: "JPY" } }), 201)).id;
  ids["brandB"] = (await ok(tenantCall(b, "POST", "/brands", { body: { name: "乙 JP", currency: "JPY" } }), 201)).id;
  ids["aTokyo"] = await area(a, ids["tokyo"] as string, "东京全域", square(139.0, 35.0, 140.0, 36.0));
  ids["bOsaka"] = await area(b, ids["osaka"] as string, "大阪全域", square(135.0, 34.0, 136.0, 35.0));

  // 甲：成田接送（已上架，有价格和一条调价规则）；东京点对点（草稿、没有价格，另一个子品牌）
  ids["pa1"] = await product(a, { brandId: ids["brandA"] as string, cityId: ids["tokyo"] as string, category: "airport_transfer", areaId: ids["aTokyo"] as string, title: { zh: "成田机场接送", en: "Narita Airport Transfer" } });
  await addPrice(a, ids["pa1"] as string, ids["aTokyo"] as string, 20_000);
  api.clock.advance(1_000);
  await ok(tenantCall(a, "POST", `/products/${ids["pa1"]}/adjust-rules`, { version: await version(a, ids["pa1"] as string), body: { name: "周末 +10%", cycle: { type: "weekly", weekdays: [6, 7] }, steps: [{ type: "percent", value: 1_000 }] } }), 201);
  await publish(a, ids["pa1"] as string);
  ids["pa2"] = await product(a, { brandId: ids["brandA2"] as string, cityId: ids["tokyo"] as string, category: "point_to_point", areaId: ids["aTokyo"] as string, title: { zh: "东京市内点对点" } });
  // 乙：大阪点对点 ×2。一个上架后又下架；一个限量库存（今天起 3 天）、已上架，之后价格过期了（已上架却报不出价）
  ids["pb1"] = await product(b, { brandId: ids["brandB"] as string, cityId: ids["osaka"] as string, category: "point_to_point", areaId: ids["bOsaka"] as string, title: { zh: "大阪市内用车" } });
  await addPrice(b, ids["pb1"] as string, ids["bOsaka"] as string, 9_000);
  await publish(b, ids["pb1"] as string);
  api.clock.advance(1_000);
  await ok(tenantCall(b, "POST", `/products/${ids["pb1"]}/unpublish`));
  ids["pb2"] = await product(b, { brandId: ids["brandB"] as string, cityId: ids["osaka"] as string, category: "point_to_point", areaId: ids["bOsaka"] as string, title: { zh: "大阪 Expo 专车" } });
  await addPrice(b, ids["pb2"] as string, ids["bOsaka"] as string, 12_000);
  api.clock.advance(1_000);
  await ok(tenantCall(b, "PUT", `/products/${ids["pb2"]}/inventory`, { version: await version(b, ids["pb2"] as string), body: { mode: "limited" } }));
  api.clock.advance(1_000);
  await ok(tenantCall(b, "POST", `/products/${ids["pb2"]}/inventory/batch-set`, { version: await version(b, ids["pb2"] as string), body: { from: "2026-10-07", to: "2026-10-09", total: 2 } }));
  await publish(b, ids["pb2"] as string);
  // 价格的生效期自然过去了：直接改库摆出这种情况（接口不允许把已上架商品改成没有价格）
  await api.db.owner.query("update price_rules set valid_from = '2026-01-01', valid_to = '2026-10-01' where product_id = $1", [ids["pb2"]]);
});
after(() => api.close());

test("列表：看得到所有供应商的商品，每行带供应商、子品牌、城市、品类、状态、上架时间、更新时间、有没有可以卖的价格；按更新时间从新到旧", async () => {
  const page = await list();
  assert.equal(page.total, 4);
  assert.equal(page.next_cursor, null);
  const order = (await api.db.owner.query("select id from products order by updated_at desc, id desc")).rows.map((row) => row.id);
  assert.deepEqual(page.items.map((item: any) => item.id), order);
  const row = (id: string): any => page.items.find((item: any) => item.id === id);
  const summary = (item: any): unknown => [item.tenant.name, item.tenant_id, item.brand.name, item.city.name.zh, item.category, item.status, item.published_at !== null, item.has_active_price, item.active_price_rule_count, item.title.zh];
  assert.deepEqual(summary(row(ids["pa1"] as string)), ["甲车队", a.tenantId, "甲 JP", "东京", "airport_transfer", "published", true, true, 1, "成田机场接送"]);
  assert.deepEqual(summary(row(ids["pa2"] as string)), ["甲车队", a.tenantId, "甲 Premium", "东京", "point_to_point", "draft", false, false, 0, "东京市内点对点"]);
  assert.deepEqual(summary(row(ids["pb1"] as string)), ["乙车队", b.tenantId, "乙 JP", "大阪", "point_to_point", "unpublished", true, true, 1, "大阪市内用车"]);
  assert.deepEqual(summary(row(ids["pb2"] as string)), ["乙车队", b.tenantId, "乙 JP", "大阪", "point_to_point", "published", true, false, 0, "大阪 Expo 专车"]);
  // 和供应商自己的列表项是同一套字段（少了 check，多了供应商和价格情况），值相同
  const own = (await ok(tenantCall(a, "GET", `/products/${ids["pa1"]}`)));
  const { areas: _areas, vehicle_groups: _groups, dispatchers: _dispatchers, ...ownSummary } = own;
  const { tenant_id: _tenantId, tenant, has_active_price: _has, active_price_rule_count: _count, ...shared } = row(ids["pa1"] as string);
  assert.deepEqual(shared, ownSummary);
  assert.deepEqual(tenant, { id: a.tenantId, name: "甲车队", status: "active" });
  assert.equal(row(ids["pa1"] as string).poi.code, "NRT");
  // 丙没有商品，不出现；供应商被暂停时列表里看得出来
  assert.ok(!page.items.some((item: any) => item.tenant_id === c.tenantId));
  await ok(api.call("POST", `/platform/v1/tenants/${b.tenantId}/suspend`, { token: root, body: {} }));
  assert.deepEqual((await list(`tenant_id=${b.tenantId}`)).items.map((item: any) => item.tenant.status), ["suspended", "suspended"]);
  await ok(api.call("POST", `/platform/v1/tenants/${b.tenantId}/resume`, { token: root }));
});

test("列表的筛选：供应商、城市、品类、状态、关键字（商品名或编号，不区分大小写）、子品牌、有没有可以卖的价格，可以组合；什么都不符合时是空页", async () => {
  const idsOf = async (query: string): Promise<string[]> => {
    const page = await list(query);
    assert.equal(page.total, page.items.length, query);
    return page.items.map((item: any) => item.id).sort();
  };
  const sorted = (...keys: string[]): string[] => keys.map((key) => ids[key] as string).sort();
  assert.deepEqual(await idsOf(`tenant_id=${a.tenantId}`), sorted("pa1", "pa2"));
  assert.deepEqual(await idsOf(`tenant_id=${b.tenantId}`), sorted("pb1", "pb2"));
  assert.deepEqual(await idsOf(`tenant_id=${c.tenantId}`), []);
  assert.deepEqual(await idsOf(`tenant_id=${MISSING}`), []);
  assert.deepEqual(await idsOf(`city_id=${ids["osaka"]}`), sorted("pb1", "pb2"));
  assert.deepEqual(await idsOf("category=airport_transfer"), sorted("pa1"));
  assert.deepEqual(await idsOf("category=point_to_point"), sorted("pa2", "pb1", "pb2"));
  assert.deepEqual(await idsOf("category=charter"), []);
  assert.deepEqual(await idsOf("status=published"), sorted("pa1", "pb2"));
  assert.deepEqual(await idsOf("status=draft"), sorted("pa2"));
  assert.deepEqual(await idsOf("status=unpublished"), sorted("pb1"));
  assert.deepEqual(await idsOf("status=all"), sorted("pa1", "pa2", "pb1", "pb2"));
  assert.deepEqual(await idsOf(`q=${encodeURIComponent("大阪")}`), sorted("pb1", "pb2"));
  assert.deepEqual(await idsOf(`q=${encodeURIComponent("narita AIRPORT")}`), sorted("pa1"), "英文标题，不区分大小写");
  assert.deepEqual(await idsOf(`q=${encodeURIComponent("expo")}`), sorted("pb2"));
  const code = (await show(ids["pa2"] as string)).product.code as string;
  assert.deepEqual(await idsOf(`q=${code.toLowerCase()}`), sorted("pa2"), "商品编号");
  assert.deepEqual(await idsOf(`q=${encodeURIComponent("%")}`), [], "% 按字面匹配");
  assert.deepEqual(await idsOf(`brand_id=${ids["brandA2"]}`), sorted("pa2"));
  assert.deepEqual(await idsOf("has_active_price=true"), sorted("pa1", "pb1"));
  assert.deepEqual(await idsOf("has_active_price=false"), sorted("pa2", "pb2"));
  assert.deepEqual(await idsOf("status=published&has_active_price=false"), sorted("pb2"), "已上架却报不出价");
  assert.deepEqual(await idsOf(`tenant_id=${a.tenantId}&city_id=${ids["osaka"]}`), [], "甲在大阪没有商品");
  assert.deepEqual(await idsOf(`tenant_id=${b.tenantId}&status=published&category=point_to_point&q=${encodeURIComponent("expo")}`), sorted("pb2"));
  // 参数写错：400，不当作「没筛选」
  for (const query of ["tenant_id=abc", "city_id=1", "category=bus", "status=archived", "has_active_price=yes", "q=", `q=${"x".repeat(101)}`, "brand_id=x"]) {
    const res = await platform(`/products?${query}`);
    assert.deepEqual([res.status, res.body.error?.code], [400, "VALIDATION_FAILED"], query);
    assertMatchesOperation("GET", LIST, 400, res.body);
  }
});

test("列表的分页：每页 1 条翻完全部、不重不漏，总数每页都一样，最后一页没有 next_cursor；limit 的边界；坏游标 400", async () => {
  const seen: string[] = [];
  let cursor: string | null = null;
  for (let pages = 0; pages < 10; pages += 1) {
    const page: any = await list(`limit=1${cursor === null ? "" : `&cursor=${cursor}`}`);
    assert.equal(page.total, 4);
    assert.ok(page.items.length <= 1);
    seen.push(...page.items.map((item: any) => item.id));
    cursor = page.next_cursor;
    if (cursor === null) break;
  }
  assert.equal(cursor, null);
  assert.deepEqual(seen, (await list()).items.map((item: any) => item.id));
  // 恰好一页装满：limit = 总数时没有下一页；少一条时有
  assert.equal((await list("limit=4")).next_cursor, null);
  const three = await list("limit=3");
  assert.equal(three.items.length, 3);
  const rest = await list(`limit=3&cursor=${three.next_cursor}`);
  assert.deepEqual([rest.items.length, rest.next_cursor, rest.total], [1, null, 4]);
  // 筛选和翻页一起用
  const first = await list(`limit=1&tenant_id=${b.tenantId}`);
  const second = await list(`limit=1&tenant_id=${b.tenantId}&cursor=${first.next_cursor}`);
  assert.deepEqual([first.total, second.total, second.next_cursor], [2, 2, null]);
  assert.deepEqual([first.items[0].id, second.items[0].id].sort(), [ids["pb1"], ids["pb2"]].sort());
  assert.equal((await list("limit=200")).items.length, 4);
  for (const query of ["limit=0", "limit=201", "limit=-1", "limit=abc", "cursor=not-a-cursor", `cursor=${Buffer.from("{}").toString("base64url")}`]) {
    const res = await platform(`/products?${query}`);
    assert.deepEqual([res.status, res.body.error?.code], [400, "VALIDATION_FAILED"], query);
  }
});

test("详情：和供应商自己看到的逐部分相同（基础信息、服务规则、商品详情、价格规则、调价规则、上架校验），另带供应商和库存；有结算价，没有对外价和加价比例", async () => {
  for (const [key, who] of [["pa1", a], ["pa2", a], ["pb1", b], ["pb2", b]] as const) {
    const id = ids[key] as string;
    const detail = await show(id);
    assert.deepEqual(detail.tenant, { id: who.tenantId, name: who === a ? "甲车队" : "乙车队", status: "active" }, key);
    assert.deepEqual(detail.product, await ok(tenantCall(who, "GET", `/products/${id}`)), key);
    assert.deepEqual(detail.service_rules, await ok(tenantCall(who, "GET", `/products/${id}/service-rules`)), key);
    assert.deepEqual(detail.content, (await ok(tenantCall(who, "GET", `/products/${id}/content`))).content, key);
    assert.deepEqual(detail.price_rules, await ok(tenantCall(who, "GET", `/products/${id}/price-rules`)), key);
    assert.deepEqual(detail.adjust_rules, await ok(tenantCall(who, "GET", `/products/${id}/adjust-rules`)), key);
    assert.deepEqual(detail.publish_check, await ok(tenantCall(who, "GET", `/products/${id}/publish-check`)), key);
    assert.doesNotMatch(JSON.stringify(detail), /markup|"sell(_[a-z]+)?"/, `${key}：没有对外价和加价比例`);
  }
  const pa1 = await show(ids["pa1"] as string);
  assert.deepEqual([pa1.product.status, pa1.product.dispatchers, pa1.price_rules.items.map((rule: any) => rule.base_price), pa1.adjust_rules.items.map((rule: any) => rule.name)], ["published", [{ name: "调度", phone: "0312345678" }], [20_000], ["周末 +10%"]]);
  assert.deepEqual(pa1.inventory, { mode: "unlimited", sellable_days_ahead: 0 });
  assert.equal(pa1.publish_check.can_publish, true);
  // 乙的第二个商品：限量库存今天起 3 天；价格已经过期，上架校验指出来（它还挂着「已上架」）
  const pb2 = await show(ids["pb2"] as string);
  assert.deepEqual(pb2.inventory, { mode: "limited", sellable_days_ahead: 3 });
  assert.equal(pb2.product.status, "published");
  assert.equal(pb2.publish_check.can_publish, false);
  assert.deepEqual(pb2.publish_check.items.find((item: any) => item.key === "price_rules").issues.map((issue: any) => issue.reason), ["ALL_PRICE_RULES_EXPIRED"]);
  // 草稿：没有价格
  const pa2 = await show(ids["pa2"] as string);
  assert.deepEqual([pa2.product.status, pa2.product.brand.name, pa2.price_rules.items, pa2.publish_check.can_publish], ["draft", "甲 Premium", [], false]);
});

test("详情：不存在的编号、写得不像编号的都是 404", async () => {
  for (const id of [MISSING, "not-a-uuid", "1", ids["aTokyo"] as string, a.tenantId]) {
    const res = await platform(`/products/${id}`);
    assert.deepEqual([res.status, res.body.error?.code], [404, "NOT_FOUND"], id);
    assertMatchesOperation("GET", ONE, 404, res.body);
  }
});

test("权限：租户令牌（各个供应商的管理员）、没有令牌、伪造的令牌都是 401；十个平台角色里只有有 product.read 的能看，其余 403 FORBIDDEN", async () => {
  for (const token of [a.adminToken, b.adminToken, c.adminToken, "not-a-token", `${root}x`]) {
    for (const path of ["/products", `/products/${ids["pa1"]}`]) assert.equal((await platform(path, token)).status, 401, path);
  }
  for (const path of [LIST, `${LIST}/${ids["pa1"]}`]) assert.equal((await api.call("GET", path)).status, 401);
  const allowed: string[] = [];
  for (const { key } of PLATFORM_ROLES) {
    const token = roleTokens.get(key) as string;
    for (const path of ["/products", `/products/${ids["pa1"]}`]) {
      const res = await platform(path, token);
      if (platformRoleCan(key, "product.read")) assert.equal(res.status, 200, `${key} ${path}: ${res.text}`);
      else {
        assert.deepEqual([res.status, res.body.error.code, res.body.error.details.required], [403, "FORBIDDEN", "product.read"], `${key} ${path}`);
        assert.doesNotMatch(res.text, /成田|甲车队|PRD/, `${key}：被拒时不带任何商品内容`);
      }
    }
    if (platformRoleCan(key, "product.read")) allowed.push(key);
  }
  assert.deepEqual(allowed, ["super_admin", "operations", "tenant_onboarding", "channel_manager", "customer_service", "risk", "readonly"]);
  // 平台只有这两个读接口：写方法都不存在
  for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
    assert.equal((await api.call(method, `${LIST}/${ids["pa1"]}`, { token: root, body: {} })).status, 404, method);
    assert.equal((await api.call(method, `${LIST}/${ids["pa1"]}/publish`, { token: root, body: {} })).status, 404, method);
  }
});

test("只读：每个角色把列表、筛选、详情都调一遍，商品相关的每张表、审计日志一行不差，版本号不变；租户之间照旧互相看不到", async () => {
  const before = await everything();
  for (const { key } of PLATFORM_ROLES) {
    const token = roleTokens.get(key) as string;
    await platform("/products?limit=2", token);
    await platform(`/products?tenant_id=${a.tenantId}&status=published&has_active_price=true`, token);
    for (const id of [ids["pa1"], ids["pa2"], ids["pb1"], ids["pb2"], MISSING]) await platform(`/products/${id}`, token);
  }
  assert.deepEqual(await everything(), before);
  // 平台能看到全部，并不意味着租户能看到别人的：甲拿乙的商品编号仍是 404，甲的列表里只有自己的
  assert.equal((await tenantCall(a, "GET", `/products/${ids["pb1"]}`)).status, 404);
  assert.equal((await tenantCall(a, "GET", `/products/${ids["pb1"]}/publish-check`)).status, 404);
  assert.deepEqual((await ok(tenantCall(a, "GET", "/products"))).items.map((item: any) => item.id).sort(), [ids["pa1"], ids["pa2"]].sort());
  assert.deepEqual((await ok(tenantCall(c, "GET", "/products"))).items, []);
});

test("首页卡片的「已上架商品数」用列表的 total 取：status=published&limit=1；没有 product.read 的角色取不到", async () => {
  assert.equal((await list("status=published&limit=1")).total, 2);
  assert.equal((await list("status=published&has_active_price=false&limit=1")).total, 1, "其中已经报不出价的");
  for (const { key } of PLATFORM_ROLES) {
    const res = await platform("/products?status=published&limit=1", roleTokens.get(key) as string);
    assert.equal(res.status, platformRoleCan(key, "product.read") ? 200 : 403, key);
  }
});
