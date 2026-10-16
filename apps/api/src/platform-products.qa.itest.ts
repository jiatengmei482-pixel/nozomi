/**
 * M1-12 测试角色补充：运营后台只读查看供应商的商品（ADR 0021）的边界情况，经真实接口、真实 PostgreSQL。
 * - 平台令牌拿去调租户接口（读、写）一律 401，数据库一行不差：平台没有任何途径改供应商的商品；
 * - 应答里供应商只带编号、名称、状态，列表不带调度人；没有对外价、加价比例；
 * - 已暂停供应商、停用子品牌、停用城市、已删除的草稿、限量库存为 0、停用 / 过期 / 已不在商品里的价格在列表和详情里的状态；
 * - 「可用价格」按商品所在城市当地的今天：同一刻东京已过期、洛杉矶还没过期，和上架校验的「价格规则」一项一致；
 * - 关键字里的 _、引号、反斜杠、SQL 片段、刚好 100 字；大写的编号；
 * - 游标分页时另有人新增、修改商品：不重复；
 * - 租户侧列表带 tenant_id 参数仍只看自己的（规则 2）；quote.preview 的角色表。
 * 测试数据只在这里构造，结束时连同 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PLATFORM_ROLES, type PlatformRole } from "@nozomi/domain";
import { type ApiResponse, type HttpMethod, TEST_PASSWORD, type TenantFixture, type TestApi, createTestApi } from "./testing/api.ts";

let api: TestApi;
let root: string;
let a: TenantFixture;
let b: TenantFixture;
const ids: Record<string, string> = {};
const roleTokens = new Map<PlatformRole, string>();

const platform = (path: string, token: string = root): Promise<ApiResponse> => api.call("GET", `/platform/v1${path}`, { token });
const tenantCall = (who: TenantFixture | string, method: HttpMethod, path: string, options: { body?: unknown; version?: number } = {}): Promise<ApiResponse> =>
  api.call(method, `/tenant/v1${path}`, {
    token: typeof who === "string" ? who : who.adminToken,
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
async function list(query = ""): Promise<any> {
  return ok(platform(`/products${query === "" ? "" : `?${query}`}`));
}
const show = (id: string): Promise<any> => ok(platform(`/products/${id}`));
const version = async (who: TenantFixture, productId: string): Promise<number> => (await ok(tenantCall(who, "GET", `/products/${productId}`))).version;
const square = (west: number, south: number, east: number, north: number): unknown => ({ kind: "operate", geometry: { type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] } });

async function area(who: TenantFixture, cityId: string, name: string, polygon: unknown): Promise<string> {
  api.clock.advance(1_000);
  return (await ok(tenantCall(who, "POST", "/areas", { body: { city_id: cityId, name: { zh: name }, biz_type: "general", polygons: [polygon] } }), 201)).id;
}

/** 点对点商品，配好服务规则和详情，草稿、没有价格。 */
async function product(who: TenantFixture, input: { brandId: string; cityId: string; areaId: string; title: string }): Promise<string> {
  api.clock.advance(1_000);
  const created = await ok(
    tenantCall(who, "POST", "/products", {
      body: {
        brand_id: input.brandId,
        city_id: input.cityId,
        category: "point_to_point",
        poi_id: null,
        areas: [{ area_id: input.areaId }],
        vehicle_groups: [{ vehicle_group_id: ids["eco4"], passengers: 3, luggage: 2 }],
        dispatchers: [{ name: "调度", phone: "0312345678" }],
      },
    }),
    201,
  );
  api.clock.advance(1_000);
  const saved = await ok(
    tenantCall(who, "PUT", `/products/${created.id}/service-rules`, {
      version: 1,
      body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { general: { mode: "limited", minutes: 15 } } },
    }),
  );
  api.clock.advance(1_000);
  await ok(tenantCall(who, "PUT", `/products/${created.id}/content`, { version: saved.version, body: { zh: { title: input.title } } }));
  return created.id;
}
async function addPrice(who: TenantFixture, productId: string, areaId: string, basePrice: number, validTo: string | null = null): Promise<string> {
  api.clock.advance(1_000);
  const body = { area_id: areaId, vehicle_group_id: ids["eco4"], pricing_model: "fixed", base_price: basePrice, valid_from: "2026-01-01", ...(validTo === null ? {} : { valid_to: validTo }) };
  return (await ok(tenantCall(who, "POST", `/products/${productId}/price-rules`, { version: await version(who, productId), body }), 201)).price_rule.id;
}
async function publish(who: TenantFixture, productId: string): Promise<void> {
  api.clock.advance(1_000);
  await ok(tenantCall(who, "POST", `/products/${productId}/publish`));
}
async function everything(): Promise<unknown> {
  const tables = ["brands", "products", "product_areas", "product_vehicle_groups", "product_dispatchers", "price_rules", "adjust_rules", "inventory_days", "areas", "area_polygons", "tenants"];
  const rows: Record<string, unknown> = {};
  for (const table of tables) rows[table] = (await api.db.owner.query(`select to_jsonb(t) as row from ${table} t order by to_jsonb(t)::text`)).rows;
  rows["audit_logs"] = (await api.db.owner.query("select count(*)::int as n from audit_logs")).rows[0].n;
  return rows;
}
/** 上架校验「价格规则」一项过没过（domain 的 sellablePriceRules，和列表的 SQL 是两份独立的实现） */
const checkSaysPriced = (detail: any): boolean => detail.publish_check.items.find((item: any) => item.key === "price_rules").passed;

before(async () => {
  api = await createTestApi();
  root = await api.superAdminToken();
  roleTokens.set("super_admin", root);
  for (const { key } of PLATFORM_ROLES) {
    if (key === "super_admin") continue;
    const email = `${key.replaceAll("_", "-")}@m112-qa.test`;
    const invited = await ok(api.call("POST", "/platform/v1/staff", { token: root, body: { email, name: key, role: key } }), 201);
    await ok(api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.invite.token, password: TEST_PASSWORD } }));
    const login = await ok(api.call("POST", "/platform/v1/auth/login", { body: { email, password: TEST_PASSWORD }, ip: `10.13.0.${roleTokens.size + 1}` }));
    roleTokens.set(key, login.access_token as string);
  }
  a = await api.tenantWithAdmin(root, "甲车队", "admin@m112-qa-a.test");
  b = await api.tenantWithAdmin(root, "乙车队", "admin@m112-qa-b.test");
  const create = async (path: string, body: unknown): Promise<string> => (await ok(api.call("POST", `/platform/v1/master/${path}`, { token: root, body }), 201)).id;
  ids["tokyo"] = await create("cities", { country_code: "JP", timezone: "Asia/Tokyo", code: "CTY-JP-TYO", name: { zh: "东京" }, center: { lng: 139.6917, lat: 35.6895 } });
  ids["la"] = await create("cities", { country_code: "US", timezone: "America/Los_Angeles", code: "CTY-US-LAX", name: { zh: "洛杉矶" }, center: { lng: -118.2437, lat: 34.0522 } });
  ids["eco4"] = await create("vehicle-groups", { grade: "economy", seats: 4, power: "fuel", combos: [{ passengers: 3, luggage: 2 }], code: "VG-ECO-4", name: { zh: "经济 4 座" } });
  ids["brandA"] = (await ok(tenantCall(a, "POST", "/brands", { body: { name: "甲 JP", currency: "JPY" } }), 201)).id;
  ids["brandAUsd"] = (await ok(tenantCall(a, "POST", "/brands", { body: { name: "甲 US", currency: "USD" } }), 201)).id;
  ids["brandB"] = (await ok(tenantCall(b, "POST", "/brands", { body: { name: "乙 JP", currency: "JPY" } }), 201)).id;
  ids["aTokyo"] = await area(a, ids["tokyo"] as string, "东京全域", square(139.0, 35.0, 140.0, 36.0));
  ids["aLa"] = await area(a, ids["la"] as string, "洛杉矶全域", square(-119.0, 33.5, -117.5, 34.5));
  ids["bTokyo"] = await area(b, ids["tokyo"] as string, "乙东京", square(139.0, 35.0, 140.0, 36.0));
});
after(() => api.close());

test("平台令牌拿去调租户的写接口（改基础信息、服务规则、详情、价格、调价、库存、上架下架、删除、子品牌）一律 401，商品相关的表和审计日志一行不差", async () => {
  const id = await product(a, { brandId: ids["brandA"] as string, cityId: ids["tokyo"] as string, areaId: ids["aTokyo"] as string, title: "平台不能改的商品" });
  const ruleId = await addPrice(a, id, ids["aTokyo"] as string, 10_000);
  const v = await version(a, id);
  const before = await everything();
  const writes: Array<[HttpMethod, string, unknown]> = [
    ["POST", "/products", { brand_id: ids["brandA"], city_id: ids["tokyo"], category: "point_to_point" }],
    ["PATCH", `/products/${id}`, { dispatchers: [] }],
    ["DELETE", `/products/${id}`, undefined],
    ["PUT", `/products/${id}/service-rules`, { booking: { service_time: { start: "08:00", end: "20:00" }, lead_time_hours: 1 } }],
    ["PUT", `/products/${id}/content`, { zh: { title: "被平台改了" } }],
    ["POST", `/products/${id}/publish`, {}],
    ["POST", `/products/${id}/unpublish`, {}],
    ["POST", `/products/${id}/price-rules`, { area_id: ids["aTokyo"], vehicle_group_id: ids["eco4"], pricing_model: "fixed", base_price: 1, valid_from: "2026-01-01" }],
    ["PUT", `/products/${id}/price-rules/${ruleId}`, { base_price: 1 }],
    ["DELETE", `/products/${id}/price-rules/${ruleId}`, undefined],
    ["POST", `/products/${id}/adjust-rules`, { name: "x", cycle: { type: "weekly", weekdays: [1] }, steps: [{ type: "percent", value: 100 }] }],
    ["PUT", `/products/${id}/inventory`, { mode: "limited" }],
    ["POST", `/products/${id}/inventory/batch-set`, { from: "2026-10-07", to: "2026-10-08", total: 1 }],
    ["PUT", `/brands/${ids["brandA"]}`, { name: "被平台改了" }],
    ["PUT", `/brands/${ids["brandA"]}/rounding-unit`, { rounding_unit: 1 }],
  ];
  for (const { key } of PLATFORM_ROLES) {
    const token = roleTokens.get(key) as string;
    for (const [method, path, body] of writes) {
      const res = await tenantCall(token, method, path, { version: v, ...(body === undefined ? {} : { body }) });
      assert.equal(res.status, 401, `${key} ${method} ${path}: ${res.text}`);
    }
    // 读也不行：平台的令牌不是租户令牌，不能借租户接口看任何东西
    for (const path of ["/products", `/products/${id}`, `/products/${id}/price-rules`, `/products/${id}/price-calendar?from=2026-10-07&to=2026-10-08`, "/price-overview"]) {
      assert.equal((await tenantCall(token, "GET", path)).status, 401, `${key} GET ${path}`);
    }
  }
  assert.deepEqual(await everything(), before);
  await ok(tenantCall(a, "DELETE", `/products/${id}/price-rules/${ruleId}`, { version: await version(a, id) }));
  await ok(tenantCall(a, "DELETE", `/products/${id}`), 204);
});

test("应答里供应商只带编号、名称、状态；列表项不带调度人、区域、车型组；列表和详情都没有对外价、加价比例、评分", async () => {
  const id = await product(b, { brandId: ids["brandB"] as string, cityId: ids["tokyo"] as string, areaId: ids["bTokyo"] as string, title: "字段检查" });
  const page = await list(`tenant_id=${b.tenantId}`);
  for (const item of page.items) {
    assert.deepEqual(Object.keys(item.tenant).sort(), ["id", "name", "status"]);
    for (const key of ["dispatchers", "areas", "vehicle_groups", "check"]) assert.ok(!(key in item), `列表项不该有 ${key}`);
  }
  const detail = await show(id);
  assert.deepEqual(Object.keys(detail.tenant).sort(), ["id", "name", "status"]);
  assert.deepEqual(Object.keys(detail).sort(), ["adjust_rules", "content", "inventory", "price_rules", "product", "publish_check", "service_rules", "tenant"]);
  for (const text of [JSON.stringify(page), JSON.stringify(detail)]) {
    assert.doesNotMatch(text, /markup|sell_price|"sell"|rating|completed_orders|probation|admin@m112|password/i);
  }
  await ok(tenantCall(b, "DELETE", `/products/${id}`), 204);
});

test("状态：已暂停的供应商、停用的子品牌、停用的城市在列表和详情里看得出来；删掉的草稿从列表消失、详情 404；状态筛选和总数跟着变", async () => {
  const pid = await product(b, { brandId: ids["brandB"] as string, cityId: ids["tokyo"] as string, areaId: ids["bTokyo"] as string, title: "状态检查" });
  await addPrice(b, pid, ids["bTokyo"] as string, 8_000);
  await publish(b, pid);
  const draft = await product(b, { brandId: ids["brandB"] as string, cityId: ids["tokyo"] as string, areaId: ids["bTokyo"] as string, title: "要删掉的草稿" });
  const listed = async (): Promise<any> => (await list(`tenant_id=${b.tenantId}`)).items.find((item: any) => item.id === pid);

  await ok(api.call("POST", `/platform/v1/tenants/${b.tenantId}/suspend`, { token: root, body: {} }));
  assert.equal((await listed()).tenant.status, "suspended");
  assert.equal((await show(pid)).tenant.status, "suspended");
  assert.equal((await show(pid)).product.status, "published", "暂停不改商品自己的状态");
  await ok(api.call("POST", `/platform/v1/tenants/${b.tenantId}/resume`, { token: root }));

  await api.db.owner.query("update brands set status = 'disabled' where id = $1", [ids["brandB"]]);
  assert.equal((await listed()).brand.status, "disabled");
  assert.equal((await show(pid)).product.brand.status, "disabled");
  await api.db.owner.query("update brands set status = 'active' where id = $1", [ids["brandB"]]);

  await api.db.owner.query("update cities set status = 'disabled' where id = $1", [ids["tokyo"]]);
  assert.equal((await listed()).city.status, "disabled");
  assert.equal((await show(pid)).product.city.status, "disabled");
  assert.ok((await list(`city_id=${ids["tokyo"]}&tenant_id=${b.tenantId}`)).items.some((item: any) => item.id === pid), "按停用的城市照样筛得出来");
  await api.db.owner.query("update cities set status = 'active' where id = $1", [ids["tokyo"]]);

  const before = (await list(`tenant_id=${b.tenantId}&status=draft`)).total;
  api.clock.advance(1_000);
  await ok(tenantCall(b, "DELETE", `/products/${draft}`), 204);
  assert.equal((await list(`tenant_id=${b.tenantId}&status=draft`)).total, before - 1);
  assert.equal((await platform(`/products/${draft}`)).status, 404);
  assert.ok(!(await list(`tenant_id=${b.tenantId}`)).items.some((item: any) => item.id === draft));
});

test("可用价格：停用的、已过期的、区域已不在商品里的不算；和上架校验「价格规则」一项逐个一致", async () => {
  const pid = await product(a, { brandId: ids["brandA"] as string, cityId: ids["tokyo"] as string, areaId: ids["aTokyo"] as string, title: "价格边界" });
  const item = async (): Promise<any> => (await list(`tenant_id=${a.tenantId}&q=${encodeURIComponent("价格边界")}`)).items[0];
  const agree = async (expectedCount: number, label: string): Promise<void> => {
    const row = await item();
    const detail = await show(pid);
    assert.deepEqual([row.active_price_rule_count, row.has_active_price], [expectedCount, expectedCount > 0], label);
    assert.equal(checkSaysPriced(detail), row.has_active_price, `${label}：列表和上架校验说法一致`);
    const filtered = (await list(`tenant_id=${a.tenantId}&has_active_price=${expectedCount > 0}`)).items.map((one: any) => one.id);
    assert.ok(filtered.includes(pid), `${label}：has_active_price 筛选`);
  };
  await agree(0, "没有价格");
  const first = await addPrice(a, pid, ids["aTokyo"] as string, 10_000);
  await agree(1, "一条启用、不限期");
  await api.db.owner.query("update price_rules set status = 'disabled' where id = $1", [first]);
  await agree(0, "停用了");
  await api.db.owner.query("update price_rules set status = 'enabled', valid_to = '2026-10-06' where id = $1", [first]);
  await agree(0, "昨天（东京）到期");
  await api.db.owner.query("update price_rules set valid_to = '2026-10-07' where id = $1", [first]);
  await agree(1, "今天（东京）到期：今天还算");
  // 价格的区域后来不在商品里了（直接改库摆出这种情况）
  await api.db.owner.query("update price_rules set area_id = $2 where id = $1", [first, ids["aLa"]]);
  await agree(0, "区域不是商品选着的");
  await api.db.owner.query("delete from price_rules where id = $1", [first]);
  await ok(tenantCall(a, "DELETE", `/products/${pid}`), 204);
});

test("库存：限量但一天都没设、只设了过去的日子，从今天起可卖天数都是 0；不限量是 0 但模式是 unlimited", async () => {
  const pid = await product(b, { brandId: ids["brandB"] as string, cityId: ids["tokyo"] as string, areaId: ids["bTokyo"] as string, title: "库存边界" });
  assert.deepEqual((await show(pid)).inventory, { mode: "unlimited", sellable_days_ahead: 0 });
  api.clock.advance(1_000);
  await ok(tenantCall(b, "PUT", `/products/${pid}/inventory`, { version: await version(b, pid), body: { mode: "limited" } }));
  assert.deepEqual((await show(pid)).inventory, { mode: "limited", sellable_days_ahead: 0 });
  const today = (await show(pid)).price_rules.today as string;
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  await api.db.owner.query("insert into inventory_days (tenant_id, product_id, day, total, held, sold, created_at, updated_at) values ($1, $2, $3, 5, 0, 0, now(), now())", [b.tenantId, pid, yesterday]);
  assert.deepEqual((await show(pid)).inventory, { mode: "limited", sellable_days_ahead: 0 }, "过去的日子不算");
  await api.db.owner.query("insert into inventory_days (tenant_id, product_id, day, total, held, sold, created_at, updated_at) values ($1, $2, $3, 2, 1, 1, now(), now())", [b.tenantId, pid, today]);
  assert.deepEqual((await show(pid)).inventory, { mode: "limited", sellable_days_ahead: 0 }, "今天卖完了不算");
  await api.db.owner.query("delete from inventory_days where product_id = $1", [pid]);
  await ok(tenantCall(b, "DELETE", `/products/${pid}`), 204);
});

test("关键字：_ 和 % 按字面、单双引号、反斜杠、SQL 片段、表情都不出错；刚好 100 字可以；前后空格去掉；只有空格是 400", async () => {
  const special = await product(b, { brandId: ids["brandB"] as string, cityId: ids["tokyo"] as string, areaId: ids["bTokyo"] as string, title: "O'Hare \"VIP\" 100%_接送 \\ 🚗" });
  const plain = await product(b, { brandId: ids["brandB"] as string, cityId: ids["tokyo"] as string, areaId: ids["bTokyo"] as string, title: "OXHare 普通 1000X接送" });
  const found = async (q: string): Promise<string[]> => {
    const page = await list(`tenant_id=${b.tenantId}&q=${encodeURIComponent(q)}`);
    assert.equal(page.total, page.items.length, q);
    return page.items.map((item: any) => item.id).sort();
  };
  assert.deepEqual(await found("O'Hare"), [special]);
  assert.deepEqual(await found("\"VIP\""), [special]);
  assert.deepEqual(await found("%_"), [special], "_ 不当通配符");
  assert.deepEqual(await found("0_"), [], "_ 不当通配符：1000X 不匹配 0_");
  assert.deepEqual(await found("\\"), [special]);
  assert.deepEqual(await found("🚗"), [special]);
  assert.deepEqual(await found("  O'Hare  "), [special], "前后空格去掉");
  assert.deepEqual(await found("hare"), [special, plain].sort(), "不区分大小写");
  assert.deepEqual(await found("' or 1=1 --"), []);
  assert.deepEqual(await found("x".repeat(100)), []);
  const blank = await platform(`/products?q=${encodeURIComponent("   ")}`);
  assert.equal(blank.status, 400);
  for (const id of [special, plain]) await ok(tenantCall(b, "DELETE", `/products/${id}`), 204);
});

test("编号写成大写：详情、各个筛选照样认", async () => {
  const pid = await product(a, { brandId: ids["brandA"] as string, cityId: ids["tokyo"] as string, areaId: ids["aTokyo"] as string, title: "大写编号" });
  assert.equal((await show(pid.toUpperCase())).product.id, pid);
  const page = await list(`tenant_id=${a.tenantId.toUpperCase()}&city_id=${(ids["tokyo"] as string).toUpperCase()}&brand_id=${(ids["brandA"] as string).toUpperCase()}`);
  assert.ok(page.items.some((item: any) => item.id === pid));
  await ok(tenantCall(a, "DELETE", `/products/${pid}`), 204);
});

test("游标分页时另有人新增、修改商品：已看过的不会再出现（不重复），没被动过的一个不漏；新加的和改过的排到最前，回第一页看得到", async () => {
  const made: string[] = [];
  for (let i = 0; i < 5; i += 1) made.push(await product(b, { brandId: ids["brandB"] as string, cityId: ids["tokyo"] as string, areaId: ids["bTokyo"] as string, title: `翻页 ${i}` }));
  const q = `tenant_id=${b.tenantId}&q=${encodeURIComponent("翻页")}`;
  const seen: string[] = [];
  let page = await list(`${q}&limit=2`);
  seen.push(...page.items.map((item: any) => item.id));
  // 第一页看完之后：新加一个、改一个还没看到的（第 5 个，最旧的）、改一个已经看过的
  const added = await product(b, { brandId: ids["brandB"] as string, cityId: ids["tokyo"] as string, areaId: ids["bTokyo"] as string, title: "翻页 新" });
  const notYetSeen = made[0] as string;
  const alreadySeen = seen[0] as string;
  for (const id of [notYetSeen, alreadySeen]) {
    api.clock.advance(1_000);
    await ok(tenantCall(b, "PATCH", `/products/${id}`, { version: await version(b, id), body: { dispatchers: [{ name: "新调度", phone: "0399999999" }] } }));
  }
  while (page.next_cursor !== null) {
    page = await list(`${q}&limit=2&cursor=${page.next_cursor}`);
    seen.push(...page.items.map((item: any) => item.id));
  }
  assert.equal(new Set(seen).size, seen.length, "不重复");
  for (const id of made.filter((one) => one !== notYetSeen)) assert.ok(seen.includes(id), "没动过的都看到了");
  assert.ok(!seen.includes(added), "游标之后新加的不会插进后面的页");
  const fresh = (await list(`${q}&limit=3`)).items.map((item: any) => item.id);
  assert.deepEqual(fresh, [alreadySeen, notYetSeen, added], "回第一页：最近修改的在最前");
  for (const id of [...made, added]) await ok(tenantCall(b, "DELETE", `/products/${id}`), 204);
});

test("租户隔离不受影响：租户列表、详情带上别家的 tenant_id 参数，仍只看到自己的；平台列表里看得到两家", async () => {
  const pa = await product(a, { brandId: ids["brandA"] as string, cityId: ids["tokyo"] as string, areaId: ids["aTokyo"] as string, title: "隔离甲" });
  const pb = await product(b, { brandId: ids["brandB"] as string, cityId: ids["tokyo"] as string, areaId: ids["bTokyo"] as string, title: "隔离乙" });
  const own = await tenantCall(a, "GET", `/products?tenant_id=${b.tenantId}`);
  if (own.status === 200) assert.ok(own.body.items.every((item: any) => item.id !== pb), "带 tenant_id 参数也看不到乙的");
  else assert.equal(own.status, 400);
  assert.equal((await tenantCall(a, "GET", `/products/${pb}?tenant_id=${b.tenantId}`)).status, 404);
  assert.equal((await tenantCall(a, "PATCH", `/products/${pb}`, { version: await version(b, pb), body: { dispatchers: [] } })).status, 404, "改不了乙的");
  const both = (await list(`q=${encodeURIComponent("隔离")}`)).items.map((item: any) => item.id).sort();
  assert.deepEqual(both, [pa, pb].sort());
  await ok(tenantCall(a, "DELETE", `/products/${pa}`), 204);
  await ok(tenantCall(b, "DELETE", `/products/${pb}`), 204);
});

test("报价试算的角色：只有超级管理员、运营、招商、渠道经理、客服能试算，其余 403；租户令牌 401", async () => {
  const body = { category: "point_to_point", city_id: ids["tokyo"], from: { lat: 35.68, lng: 139.76 }, to: { lat: 35.63, lng: 139.88 }, pickup_at: "2026-10-20T10:00", passengers: 1, currency: "JPY" };
  const allowed: string[] = [];
  for (const { key } of PLATFORM_ROLES) {
    const res = await api.call("POST", "/platform/v1/quotes/preview", { token: roleTokens.get(key) as string, body });
    if (res.status === 403) continue;
    assert.notEqual(res.status, 401, key);
    allowed.push(key);
  }
  assert.deepEqual(allowed, ["super_admin", "operations", "tenant_onboarding", "channel_manager", "customer_service"]);
  assert.equal((await api.call("POST", "/platform/v1/quotes/preview", { token: a.adminToken, body })).status, 401);
});

test("可用价格按商品所在城市当地的今天：同一刻东京已是 10-08、洛杉矶还是 10-07，有效期到 10-07 的价格东京算过期、洛杉矶算可用；跨午夜前后各看一次", async () => {
  const tokyo = await product(a, { brandId: ids["brandA"] as string, cityId: ids["tokyo"] as string, areaId: ids["aTokyo"] as string, title: "时区东京" });
  const la = await product(a, { brandId: ids["brandAUsd"] as string, cityId: ids["la"] as string, areaId: ids["aLa"] as string, title: "时区洛杉矶" });
  const tRule = await addPrice(a, tokyo, ids["aTokyo"] as string, 10_000);
  const lRule = await addPrice(a, la, ids["aLa"] as string, 5_000);
  await api.db.owner.query("update price_rules set valid_to = '2026-10-07' where id = any($1)", [[tRule, lRule]]);
  const state = async (): Promise<Record<string, boolean>> => {
    const page = await list(`tenant_id=${a.tenantId}&q=${encodeURIComponent("时区")}`);
    const out: Record<string, boolean> = {};
    for (const one of page.items) out[one.title.zh] = one.has_active_price;
    for (const [name, id] of [["时区东京", tokyo], ["时区洛杉矶", la]] as const) assert.equal(checkSaysPriced(await show(id)), out[name], `${name}：和上架校验一致`);
    return out;
  };
  // 东京 2026-10-07 23:59，洛杉矶 2026-10-07 07:59
  // 时钟往后拨了十几个小时，令牌会过期：每拨一次重新登录
  const target = async (iso: string): Promise<void> => {
    api.clock.advance(new Date(iso).getTime() - api.clock.now().getTime());
    root = (await ok(api.call("POST", "/platform/v1/auth/login", { body: { email: "root@platform.test", password: TEST_PASSWORD } }))).access_token;
    a = { ...a, adminToken: (await ok(api.call("POST", "/tenant/v1/auth/login", { body: { email: a.adminEmail, password: TEST_PASSWORD } }))).access_token };
  };
  await target("2026-10-07T14:59:00.000Z");
  assert.deepEqual(await state(), { 时区东京: true, 时区洛杉矶: true }, "东京午夜前");
  // 东京 2026-10-08 00:00，洛杉矶 2026-10-07 08:00
  await target("2026-10-07T15:00:00.000Z");
  assert.deepEqual(await state(), { 时区东京: false, 时区洛杉矶: true }, "东京过了午夜");
  // 洛杉矶 2026-10-08 00:00（夏令时 UTC-7）
  await target("2026-10-08T07:00:00.000Z");
  assert.deepEqual(await state(), { 时区东京: false, 时区洛杉矶: false }, "洛杉矶也过了午夜");
  await api.db.owner.query("delete from price_rules where id = any($1)", [[tRule, lRule]]);
  for (const id of [tokyo, la]) await ok(tenantCall(a, "DELETE", `/products/${id}`), 204);
});
