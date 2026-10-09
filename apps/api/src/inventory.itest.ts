/**
 * M1-05：库存——模式（不限量 / 限量）、库存日历、按日期范围批量设置、占用保护，以及上架校验里的「库存」一项。
 * 跨租户的验证在 tenant-isolation.itest.ts；导入导出在 import-export.itest.ts。
 * 全部经真实接口、真实 PostgreSQL；测试数据都在这里构造。测试时钟固定在 2026-10-07 10:00（东京，周三）。
 * 现在还没有订单（M3），「已预占 / 已售」用迁移账号直接摆数据来验证占用保护和并发预占的做法。
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
const TODAY = "2026-10-07";

const platform = (method: HttpMethod, path: string, body?: unknown): Promise<ApiResponse> => api.call(method, `/platform/v1${path}`, { token: root, ...(body === undefined ? {} : { body }) });

const call = (method: HttpMethod, path: string, options: { token?: string; body?: unknown; version?: number } = {}): Promise<ApiResponse> =>
  api.call(method, `/tenant/v1${path}`, {
    token: options.token ?? tenant.adminToken,
    ...(options.body === undefined ? {} : { body: options.body }),
    headers: {
      ...(options.version === undefined ? {} : { "if-match": `"${options.version}"` }),
      ...(method === "POST" && /(^\/(products|brands|areas)$)|\/price-rules$/.test(path) ? { "idempotency-key": randomUUID() } : {}),
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

/** 一个点对点商品；`complete` 时把上架要的都填好（含一条价格）。 */
async function product(options: { complete?: boolean; cityId?: string; areaId?: string } = {}): Promise<string> {
  api.clock.advance(1_000);
  const areaId = options.areaId ?? ids["area"];
  const created = await ok(
    call("POST", "/products", {
      body: { brand_id: ids["brand"], city_id: options.cityId ?? ids["tokyo"], category: "point_to_point", areas: [{ area_id: areaId }], vehicle_groups: [{ vehicle_group_id: ids["biz7"], passengers: 6, luggage: 2 }], dispatchers: [{ name: "调度小王", phone: "09012345678" }] },
    }),
    201,
  );
  if (options.complete) {
    const rules = await ok(call("PUT", `/products/${created.id}/service-rules`, { version: 1, body: { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { general: { mode: "unlimited" } } } }));
    const content = await ok(call("PUT", `/products/${created.id}/content`, { version: rules.version, body: { zh: { title: "测试商品" } } }));
    await ok(call("POST", `/products/${created.id}/price-rules`, { version: content.version, body: { area_id: areaId, vehicle_group_id: ids["biz7"], pricing_model: "fixed", base_price: 9_000, valid_from: "2026-01-01" } }), 201);
  }
  return created.id;
}

const inventory = (productId: string, from: string, to: string): Promise<any> => ok(call("GET", `/products/${productId}/inventory?from=${from}&to=${to}`));
const version = async (productId: string): Promise<number> => (await inventory(productId, TODAY, TODAY)).version;
const batchSet = async (productId: string, body: Record<string, unknown>): Promise<any> => ok(call("POST", `/products/${productId}/inventory/batch-set`, { version: await version(productId), body }));
const limited = async (productId: string): Promise<any> => ok(call("PUT", `/products/${productId}/inventory`, { version: await version(productId), body: { mode: "limited" } }));
const days = (view: any): unknown[] => view.days.map((day: any) => [day.date, day.total, day.remaining, day.status]);

async function audits(resource: string, id: string): Promise<any[]> {
  return (await api.db.owner.query("select action, tenant_id, actor_email, before, after from audit_logs where resource = $1 and resource_id = $2 order by id", [resource, id])).rows;
}

before(async () => {
  api = await createTestApi();
  root = await api.superAdminToken();
  tenant = await api.tenantWithAdmin(root, "甲车队", "admin@a.test");
  ids["tokyo"] = (await ok(platform("POST", "/master/cities", { country_code: "JP", timezone: "Asia/Tokyo", code: "CTY-JP-TYO", name: { zh: "东京" }, center: { lng: 139.6917, lat: 35.6895 } }), 201)).id;
  ids["biz7"] = (await ok(platform("POST", "/master/vehicle-groups", { grade: "business", seats: 7, power: "fuel", combos: [{ passengers: 6, luggage: 2 }], code: "VG-BIZ-7", name: { zh: "商务 7 座" } }), 201)).id;
  ids["brand"] = (await ok(call("POST", "/brands", { body: { name: "甲车队 JP", currency: "JPY" } }), 201)).id;
  ids["area"] = (await ok(call("POST", "/areas", { body: { city_id: ids["tokyo"], name: { zh: "市区" }, biz_type: "general", polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [[[139.6, 35.6], [139.8, 35.6], [139.8, 35.8], [139.6, 35.8], [139.6, 35.6]]] } }] } }), 201)).id;
});
after(() => api.close());

test("新商品的库存是不限量（默认）：日历上每一天都是不限量、没有数；日期范围最多 366 天，过去的日子也能看", async () => {
  const id = await product();
  const view = await inventory(id, "2026-10-06", "2026-10-08");
  assert.deepEqual(view, {
    version: 1,
    mode: "unlimited",
    today: TODAY,
    ahead: { sellable_days: 0, last_set_date: null },
    days: [
      { date: "2026-10-06", weekday: 2, total: null, held: 0, sold: 0, remaining: null, status: "unlimited" },
      { date: "2026-10-07", weekday: 3, total: null, held: 0, sold: 0, remaining: null, status: "unlimited" },
      { date: "2026-10-08", weekday: 4, total: null, held: 0, sold: 0, remaining: null, status: "unlimited" },
    ],
  });
  assert.equal((await inventory(id, "2026-01-01", "2026-12-31")).days.length, 365);
  assert.equal((await inventory(id, "2028-01-01", "2028-12-31")).days.length, 366);
  const bad = async (query: string): Promise<[string, string | undefined][]> => issues(await call("GET", `/products/${id}/inventory?${query}`));
  assert.deepEqual(await bad("from=2026-01-01&to=2027-01-02"), [["/to", "TOO_MANY"]]);
  assert.deepEqual(await bad("from=2026-10-08&to=2026-10-07"), [["/to", "DATE_RANGE_REVERSED"]]);
  assert.deepEqual(await bad("from=2026-02-30&to=2026-03-01"), [["/from", "INVALID_DATE"]]);
  assert.equal((await call("GET", `/products/${id}/inventory?from=2026-10-01`)).status, 400);
  assert.equal((await call("GET", `/products/${MISSING}/inventory?from=2026-10-01&to=2026-10-02`)).status, 404);
});

test("切换模式：用商品的版本号；切到限量后没设过的日子不可售；每日的数切来切去都还在；写审计日志", async () => {
  const id = await product();
  const put = (mode: unknown, v?: number): Promise<ApiResponse> => call("PUT", `/products/${id}/inventory`, { ...(v === undefined ? {} : { version: v }), body: { mode } });
  assert.equal((await put("limited")).status, 428);
  assert.equal((await put("limited", 9)).body.error.code, "VERSION_CONFLICT");
  assert.equal((await put("some", 1)).status, 400);
  assert.deepEqual(await ok(put("unlimited", 1)), { version: 1, mode: "unlimited" }, "没变化不加版本");
  assert.deepEqual(await ok(put("limited", 1)), { version: 2, mode: "limited" });
  assert.equal((await ok(call("GET", `/products/${id}`))).version, 2, "库存变了，商品的版本号跟着加");
  assert.deepEqual(days(await inventory(id, TODAY, "2026-10-08")), [[TODAY, null, 0, "unset"], ["2026-10-08", null, 0, "unset"]]);
  await batchSet(id, { from: TODAY, to: TODAY, total: 4 });
  assert.deepEqual(days(await inventory(id, TODAY, "2026-10-08")), [[TODAY, 4, 4, "open"], ["2026-10-08", null, 0, "unset"]]);
  // 切回不限量：数还在，但不起作用；再切回限量，数还在
  await ok(put("unlimited", 3));
  assert.deepEqual(days(await inventory(id, TODAY, TODAY)), [[TODAY, 4, null, "unlimited"]]);
  await ok(put("limited", 4));
  assert.deepEqual(days(await inventory(id, TODAY, TODAY)), [[TODAY, 4, 4, "open"]]);
  const logs = (await audits("product", id)).filter((log) => log.after?.inventory_mode !== undefined);
  assert.deepEqual(logs.map((log) => [log.action, log.actor_email, log.before, log.after]), [
    ["update", "admin@a.test", { inventory_mode: "unlimited" }, { inventory_mode: "limited" }],
    ["update", "admin@a.test", { inventory_mode: "limited" }, { inventory_mode: "unlimited" }],
    ["update", "admin@a.test", { inventory_mode: "unlimited" }, { inventory_mode: "limited" }],
  ]);
  assert.equal((await call("PUT", `/products/${MISSING}/inventory`, { version: 1, body: { mode: "limited" } })).status, 404);
});

test("批量设置：日期范围（两端都含）× 星期 × 数量；不填数量 = 清除，0 = 停售；点某一天直接改就是只有一天的范围；审计日志记变了的日子的前后值", async () => {
  const id = await product();
  await limited(id);
  // 2026-10-09 是周五：10-09 到 10-18 的周末设 3 单
  const weekend = await batchSet(id, { from: "2026-10-09", to: "2026-10-18", weekdays: [6, 7], total: 3 });
  assert.deepEqual([weekend.version, weekend.changed_days, weekend.mode], [3, 4, "limited"]);
  assert.deepEqual(days(weekend).filter((day: any) => day[1] !== null), [["2026-10-10", 3, 3, "open"], ["2026-10-11", 3, 3, "open"], ["2026-10-17", 3, 3, "open"], ["2026-10-18", 3, 3, "open"]]);
  assert.equal(weekend.days.length, 10, "应答是这段日期的日历");
  // 整段每天 5 单（覆盖掉周末的 3）
  const all = await batchSet(id, { from: "2026-10-09", to: "2026-10-12", total: 5 });
  assert.deepEqual([all.changed_days, days(all).map((day: any) => day[1])], [4, [5, 5, 5, 5]]);
  // 一样的再来一次：没有变化，不加版本、不写日志
  const again = await batchSet(id, { from: "2026-10-09", to: "2026-10-12", total: 5 });
  assert.deepEqual([again.version, again.changed_days], [all.version, 0]);
  // 只改一天；停售；清除
  assert.deepEqual(days(await batchSet(id, { from: "2026-10-10", to: "2026-10-10", total: 8 })), [["2026-10-10", 8, 8, "open"]]);
  assert.deepEqual(days(await batchSet(id, { from: "2026-10-11", to: "2026-10-11", total: 0 })), [["2026-10-11", 0, 0, "closed"]]);
  const cleared = await batchSet(id, { from: "2026-10-12", to: "2026-10-18", weekdays: [1, 6] });
  assert.deepEqual([cleared.changed_days, days(cleared).map((day: any) => [day[0].slice(8), day[1]])], [2, [["12", null], ["13", null], ["14", null], ["15", null], ["16", null], ["17", null], ["18", 3]]]);
  assert.deepEqual(days(await inventory(id, "2026-10-09", "2026-10-12")), [["2026-10-09", 5, 5, "open"], ["2026-10-10", 8, 8, "open"], ["2026-10-11", 0, 0, "closed"], ["2026-10-12", null, 0, "unset"]]);
  assert.equal((await api.db.owner.query("select count(*)::int as n from inventory_days where product_id = $1", [id])).rows[0].n, 4, "清除就是没有这一行");
  // 概况看的是从今天起的整段日子（和请求的日期范围无关）：有剩余的 3 天（10-09、10-10、10-18），最晚设到 10-18
  assert.deepEqual((await inventory(id, TODAY, TODAY)).ahead, { sellable_days: 3, last_set_date: "2026-10-18" });
  await batchSet(id, { from: "2028-10-06", to: "2028-10-06", total: 1 });
  assert.deepEqual((await inventory(id, "2026-01-01", "2026-01-02")).ahead, { sellable_days: 4, last_set_date: "2028-10-06" }, "最远的第 730 天也数得到");
  await batchSet(id, { from: "2028-10-06", to: "2028-10-06" });

  const logs = await audits("inventory", id);
  assert.equal(logs.length, 7, "没有变化的那一次不记");
  assert.deepEqual([logs[0].action, logs[0].tenant_id, logs[0].actor_email, logs[0].before, logs[0].after], [
    "update", tenant.tenantId, "admin@a.test",
    { days: { "2026-10-10": null, "2026-10-11": null, "2026-10-17": null, "2026-10-18": null } },
    { from: "2026-10-09", to: "2026-10-18", weekdays: [6, 7], total: 3, changed_days: 4, days: { "2026-10-10": 3, "2026-10-11": 3, "2026-10-17": 3, "2026-10-18": 3 } },
  ]);
  assert.deepEqual([logs[1].before.days, logs[4].before.days, logs[4].after.days, logs[4].after.total], [
    { "2026-10-09": null, "2026-10-10": 3, "2026-10-11": 3, "2026-10-12": null },
    { "2026-10-12": 5, "2026-10-17": 3 },
    { "2026-10-12": null, "2026-10-17": null },
    null,
  ]);
});

test("批量设置的校验：要带版本号；过去的日子不能改（按城市当地的今天）；日期、星期、数量逐项检查；不合格的什么都不写", async () => {
  const id = await product();
  const post = (body: Record<string, unknown>, v = 1): Promise<ApiResponse> => call("POST", `/products/${id}/inventory/batch-set`, { version: v, body });
  assert.equal((await call("POST", `/products/${id}/inventory/batch-set`, { body: { from: TODAY, to: TODAY, total: 1 } })).status, 428);
  assert.equal((await post({ from: TODAY, to: TODAY, total: 1 }, 9)).body.error.code, "VERSION_CONFLICT");
  const cases: [string, Record<string, unknown>, [string, string | undefined][]][] = [
    ["昨天", { from: "2026-10-06", to: "2026-10-10", total: 1 }, [["/from", "DATE_IN_PAST"]]],
    ["日期不存在", { from: "2026-11-31", to: "2026-12-01", total: 1 }, [["/from", "INVALID_DATE"]]],
    ["日期倒置", { from: "2026-10-10", to: "2026-10-09", total: 1 }, [["/to", "DATE_RANGE_REVERSED"]]],
    ["超过 366 天", { from: "2026-10-10", to: "2027-10-11", total: 1 }, [["/to", "TOO_MANY"]]],
    ["太远", { from: "2028-10-01", to: "2028-10-08", total: 1 }, [["/to", "TOO_FAR_AHEAD"]]],
    ["星期不对", { from: TODAY, to: "2026-10-20", weekdays: [0, 8, 2, 2], total: 1 }, [["/weekdays/0", "OUT_OF_RANGE"], ["/weekdays/1", "OUT_OF_RANGE"], ["/weekdays/3", "DUPLICATE"]]],
    ["范围里没有选中的星期", { from: "2026-10-12", to: "2026-10-14", weekdays: [6], total: 1 }, [["/weekdays", "NO_DAY_SELECTED"]]],
    ["数量为负", { from: TODAY, to: TODAY, total: -1 }, [["/total", "OUT_OF_RANGE"]]],
    ["数量太大", { from: TODAY, to: TODAY, total: 10_000 }, [["/total", "OUT_OF_RANGE"]]],
    ["数量带小数", { from: TODAY, to: TODAY, total: 1.5 }, [["/total", "NOT_INTEGER"]]],
    ["缺日期", { total: 1 }, [["/from", undefined], ["/to", undefined]]],
  ];
  for (const [label, body, expected] of cases) assert.deepEqual(issues(await post(body)), expected, label);
  assert.equal((await api.db.owner.query("select count(*)::int as n from inventory_days where product_id = $1", [id])).rows[0].n, 0);
  assert.equal(await version(id), 1);
  // 今天可以设；不限量模式下也可以先设好
  assert.equal((await post({ from: TODAY, to: TODAY, total: 2 })).status, 200);
  assert.deepEqual(days(await inventory(id, TODAY, TODAY)), [[TODAY, 2, null, "unlimited"]]);
  assert.equal((await call("POST", `/products/${MISSING}/inventory/batch-set`, { version: 1, body: { from: TODAY, to: TODAY, total: 1 } })).status, 404);
  // 城市当地的今天：洛杉矶现在还是 10-06，所以那里的商品可以设 10-06
  const la = (await ok(platform("POST", "/master/cities", { country_code: "US", timezone: "America/Los_Angeles", code: "CTY-US-LAX", name: { en: "Los Angeles" }, center: { lng: -118.2437, lat: 34.0522 } }), 201)).id;
  const zone = (await ok(call("POST", "/areas", { body: { city_id: la, name: { en: "LA" }, biz_type: "general", polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [[[-118.4, 34], [-118.2, 34], [-118.2, 34.2], [-118.4, 34.2], [-118.4, 34]]] } }] } }), 201)).id;
  const abroad = await product({ cityId: la, areaId: zone });
  assert.equal((await inventory(abroad, "2026-10-06", "2026-10-06")).today, "2026-10-06");
  assert.equal((await call("POST", `/products/${abroad}/inventory/batch-set`, { version: 1, body: { from: "2026-10-06", to: "2026-10-06", total: 1 } })).status, 200);
  assert.deepEqual(issues(await call("POST", `/products/${abroad}/inventory/batch-set`, { version: 2, body: { from: "2026-10-05", to: "2026-10-06", total: 1 } })), [["/from", "DATE_IN_PAST"]]);
});

test("已经有订单占着的库存：日历上分开显示预占、已售、剩余；可售单数不能改到占用数以下，也不能清除（409，指出是哪几天），整批不写", async () => {
  const id = await product();
  await limited(id);
  await batchSet(id, { from: "2026-10-10", to: "2026-10-13", total: 5 });
  // 订单是 M3 的事：这里直接摆出「10-10 预占 1 已售 2」「10-11 占满」
  await api.db.owner.query("update inventory_days set held = 1, sold = 2 where product_id = $1 and day = '2026-10-10'", [id]);
  await api.db.owner.query("update inventory_days set held = 2, sold = 3 where product_id = $1 and day = '2026-10-11'", [id]);
  const view = await inventory(id, "2026-10-10", "2026-10-12");
  assert.deepEqual(view.days.map((day: any) => [day.total, day.held, day.sold, day.remaining, day.status]), [[5, 1, 2, 2, "open"], [5, 2, 3, 0, "sold_out"], [5, 0, 0, 5, "open"]]);
  const before = await inventory(id, "2026-10-10", "2026-10-13");
  for (const total of [2, 0, null]) {
    const res = await call("POST", `/products/${id}/inventory/batch-set`, { version: before.version, body: { from: "2026-10-10", to: "2026-10-13", total } });
    assert.deepEqual([res.status, res.body.error.code], [409, "INVENTORY_BELOW_OCCUPIED"], String(total));
    assert.deepEqual(res.body.error.details, { days: [{ date: "2026-10-10", occupied: 3 }, { date: "2026-10-11", occupied: 5 }] });
    assert.deepEqual(await inventory(id, "2026-10-10", "2026-10-13"), before, "整批不写：没有占用的 10-12、10-13 也没动");
  }
  // 改到正好等于占用数、往上加：可以
  assert.deepEqual(days(await batchSet(id, { from: "2026-10-10", to: "2026-10-10", total: 3 })), [["2026-10-10", 3, 0, "sold_out"]]);
  assert.deepEqual(days(await batchSet(id, { from: "2026-10-11", to: "2026-10-11", total: 9 })), [["2026-10-11", 9, 4, "open"]]);
  // 数据库的最后一道防线：占用数不能超过可售总数
  await assert.rejects(api.db.owner.query("update inventory_days set held = held + 1 where product_id = $1 and day = '2026-10-10'", [id]), { code: "23514" });
});

test("并发预占的做法（ADR 0019，给 M3 的下单用）：一条「有剩余才加一」的条件更新，20 个同时来抢 5 单，正好 5 个成功，不会超卖", async () => {
  const id = await product();
  await limited(id);
  await batchSet(id, { from: "2026-10-20", to: "2026-10-20", total: 5 });
  const hold = (): Promise<number | null> =>
    api.db.owner.query("update inventory_days set held = held + 1 where product_id = $1 and day = '2026-10-20' and vehicle_group_id is null and total - held - sold >= 1", [id]).then((result) => result.rowCount);
  const results = await Promise.all(Array.from({ length: 20 }, hold));
  assert.equal(results.filter((count) => count === 1).length, 5);
  assert.equal(results.filter((count) => count === 0).length, 15);
  assert.deepEqual((await inventory(id, "2026-10-20", "2026-10-20")).days.map((day: any) => [day.total, day.held, day.sold, day.remaining, day.status]), [[5, 5, 0, 0, "sold_out"]]);
  // 没设过的日子（限量模式下不可售）：没有行，条件更新什么都改不到
  assert.equal((await api.db.owner.query("update inventory_days set held = held + 1 where product_id = $1 and day = '2026-10-21' and total - held - sold >= 1", [id])).rowCount, 0);
});

test("上架校验的「库存」一项：不是必须的；不限量通过；限量而从今天起没有一天还有库存时指出来，但不拦上架", async () => {
  const id = await product({ complete: true });
  const item = async (): Promise<any> => (await ok(call("GET", `/products/${id}/publish-check`))).items.find((entry: any) => entry.key === "inventory");
  assert.deepEqual(await item(), { key: "inventory", required: false, passed: true, issues: [] });
  await limited(id);
  const empty = await item();
  assert.deepEqual([empty.required, empty.passed, empty.issues.map((issue: any) => [issue.path, issue.reason])], [false, false, [["/", "NO_INVENTORY_AHEAD"]]]);
  assert.ok(empty.issues[0].message.length > 0);
  const check = await ok(call("GET", `/products/${id}/publish-check`));
  assert.equal(check.can_publish, true, "库存不是必须项");
  // 只有停售的、占满的日子：还是没有库存
  await batchSet(id, { from: TODAY, to: TODAY, total: 0 });
  await batchSet(id, { from: "2026-10-08", to: "2026-10-08", total: 2 });
  await api.db.owner.query("update inventory_days set sold = 2 where product_id = $1 and day = '2026-10-08'", [id]);
  assert.equal((await item()).passed, false);
  // 照样能上架；上架之后改库存不受限制（库存不是上架条件）
  assert.equal((await ok(call("POST", `/products/${id}/publish`))).status, "published");
  await batchSet(id, { from: "2026-10-09", to: "2026-10-09", total: 1 });
  assert.equal((await item()).passed, true);
  assert.equal((await ok(call("PUT", `/products/${id}/inventory`, { version: await version(id), body: { mode: "unlimited" } }))).mode, "unlimited");
  assert.equal((await ok(call("GET", `/products/${id}`))).status, "published");
  // 列表上的概况不受库存影响
  assert.deepEqual((await ok(call("GET", "/products?status=published"))).items.find((entry: any) => entry.id === id).check, { can_publish: true, failed_required: 0, unavailable_required: 0 });
});

test("权限：管理员和商品价格能改库存；只读能看不能改；调度和财务看都不能看", async () => {
  const id = await product();
  const tokens: Record<string, string> = {};
  for (const role of ["pricing", "dispatch", "finance", "readonly"]) tokens[role] = (await addTenantUser(api, tenant.adminToken, `${role}-inv@a.test`, role)).token;
  const read = `/products/${id}/inventory?from=${TODAY}&to=${TODAY}`;
  const writes: [HttpMethod, string, unknown][] = [["PUT", `/products/${id}/inventory`, { mode: "limited" }], ["POST", `/products/${id}/inventory/batch-set`, { from: TODAY, to: TODAY, total: 1 }]];
  for (const role of ["dispatch", "finance"]) {
    assert.equal((await call("GET", read, { token: tokens[role] as string })).status, 403, role);
    for (const [method, path, body] of writes) assert.equal((await call(method, path, { token: tokens[role] as string, body, version: 1 })).status, 403, `${role} ${method} ${path}`);
  }
  assert.equal((await call("GET", read, { token: tokens["readonly"] as string })).status, 200);
  for (const [method, path, body] of writes) assert.equal((await call(method, path, { token: tokens["readonly"] as string, body, version: 1 })).status, 403, `readonly ${method} ${path}`);
  assert.equal((await call("PUT", `/products/${id}/inventory`, { token: tokens["pricing"] as string, body: { mode: "limited" }, version: 1 })).status, 200);
  assert.equal((await call("POST", `/products/${id}/inventory/batch-set`, { token: tokens["pricing"] as string, body: { from: TODAY, to: TODAY, total: 1 }, version: 2 })).status, 200);
  assert.deepEqual((await audits("inventory", id)).map((log) => log.actor_email), ["pricing-inv@a.test"]);
  assert.equal((await api.call("GET", `/tenant/v1${read}`)).status, 401);
  assert.equal((await api.call("GET", `/tenant/v1${read}`, { token: root })).status, 401);
  assert.doesNotMatch((await call("GET", read)).text, /markup|sell_price|selling_price|public_price|channel|对外价|加价比例/i);
});
