/**
 * M9T-02（ADR 0100 第二、五节）经真实接口、真实 PostgreSQL：
 * - 迁移 0600：行程表的编号格式、方案 / 段 / 费用的形状约束（抵扣类只能为负、其余不得为负；一车到底必须带租户和车型组）、级联删除；
 * - 跨段规则接口：没存时返回默认值；整体替换、版本号、审计；内容不变不加版本；校验原因和路径；
 *   `byArea` 只认本商品的区域（别家的区域、本租户不在本商品的区域都 `AREA_NOT_FOUND`）；只有包车商品能配；
 *   租户 A 读不到、改不了 B 的（404）；平台只读；应答与 openapi.yaml 一致、没有对外价和加价比例。
 * 测试数据全在本文件里经接口建出来，随测试 schema 一起删除（规则 1）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { ApiResponse, HttpMethod, TenantFixture, TestApi } from "./testing/api.ts";
import { createTestApi } from "./testing/api.ts";
import { withTenantTx } from "./db/context.ts";
import { type Market, buildMarket, newChannel, ok } from "./testing/market.ts";
import { tenantLogin } from "./testing/money.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";

let api: TestApi;
let m: Market;

const square = (west: number, south: number, east: number, north: number) => ({ type: "Polygon", coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]] });

async function tenantCall(who: TenantFixture, method: HttpMethod, path: string, options: { body?: unknown; version?: number } = {}): Promise<ApiResponse> {
  const token = await tenantLogin(api, who.adminEmail);
  api.clock.advance(1_000);
  return api.call(method, `/tenant/v1${path}`, {
    token,
    ...(options.body === undefined ? {} : { body: options.body }),
    headers: { ...(options.version === undefined ? {} : { "if-match": `"${options.version}"` }), ...(method === "POST" && /^\/(products|brands|areas)$|\/price-rules(\/batch)?$/.test(path) ? { "idempotency-key": randomUUID() } : {}) },
  });
}
const version = async (who: TenantFixture, productId: string): Promise<number> => (await ok(tenantCall(who, "GET", `/products/${productId}`))).version;
const putRules = async (who: TenantFixture, productId: string, body: unknown): Promise<ApiResponse> => {
  const res = await tenantCall(who, "PUT", `/products/${productId}/trip-rules`, { version: await version(who, productId), body });
  if (res.status === 200) assertMatchesOpenApi("PUT", "/tenant/v1/products/{id}/trip-rules", res);
  return res;
};
const issues = (res: ApiResponse): [string, string][] => res.body.error.details.issues.map((issue: { path: string; reason: string }) => [issue.path, issue.reason]);

interface Charter {
  id: string;
  tokyo: string;
  hakone: string;
  /** 本租户的区域、但不在这个商品里 */
  other: string;
}
let charterA: Charter;
let charterB: Charter;

/** 东京包车：①东京市内；③箱根（上下车加价 12,000）；5h 33,000。不上架（规则配置不要求上架） */
async function newCharter(who: TenantFixture): Promise<Charter> {
  const area = async (name: string, polygon: ReturnType<typeof square>): Promise<string> =>
    (await ok(tenantCall(who, "POST", "/areas", { body: { city_id: m.ids.tokyo, name: { zh: name }, biz_type: "charter", polygons: [{ kind: "operate", geometry: polygon }] } }), 201)).id;
  const tokyo = await area("东京市内", square(139.55, 35.5, 139.95, 35.85));
  const hakone = await area("箱根", square(138.96, 35.15, 139.15, 35.28));
  const other = await area("镰仓", square(139.5, 35.28, 139.6, 35.36));
  const brand = (await ok(tenantCall(who, "POST", "/brands", { body: { name: `包车-${randomUUID().slice(0, 6)}`, currency: "JPY" } }), 201)).id;
  const created = await ok(tenantCall(who, "POST", "/products", { body: { brand_id: brand, city_id: m.ids.tokyo, category: "charter", areas: [{ area_id: tokyo }], vehicle_groups: [{ vehicle_group_id: m.ids.biz7, passengers: 6, luggage: 4 }], dispatchers: [{ name: "调度", phone: "0312345678" }] } }), 201);
  const pkg = { area_id: tokyo, vehicle_group_id: m.ids.biz7, package_hours: 5, pricing_model: "charter_package", package_km: 300, package_price: 33_000, overtime_per_hour: 6_000, over_km_per_km: 500, valid_from: "2026-01-01" };
  const updown = { area_id: hakone, vehicle_group_id: m.ids.biz7, package_hours: 5, pricing_model: "charter_area_surcharge", pickup_surcharge: 12_000, dropoff_surcharge: 12_000, valid_from: "2026-01-01" };
  await ok(tenantCall(who, "POST", `/products/${created.id}/price-rules/batch`, { version: created.version, body: { create: [pkg, updown] } }));
  return { id: created.id, tokyo, hakone, other };
}

before(async () => {
  api = await createTestApi();
  m = await buildMarket(api);
  charterA = await newCharter(m.a);
  charterB = await newCharter(m.b);
});

after(async () => {
  await api?.close();
});

test("没存配置：返回日元默认值（住宿 15,000、停驻 10,000、拘束 13 h），saved 为 null，没有对外价和加价比例", async () => {
  const res = await tenantCall(m.a, "GET", `/products/${charterA.id}/trip-rules`);
  assert.equal(res.status, 200, res.text);
  assertMatchesOpenApi("GET", "/tenant/v1/products/{id}/trip-rules", res);
  assert.equal(res.body.saved, null);
  assert.equal(res.body.rules_version, 0);
  assert.equal(res.body.settlement_currency, "JPY");
  assert.equal(res.body.effective.lodging.perNightMinor, 15_000);
  assert.equal(res.body.effective.idleDay.perDayMinor, 10_000);
  assert.equal(res.body.effective.workHours.maxBindMinutes, 780);
  assert.doesNotMatch(res.text, /sell|markup/);
});

test("保存：整体替换、商品版本号和配置版本号各加一、写审计；内容不变不加版本", async () => {
  const before = await version(m.a, charterA.id);
  const config = { lodging: { byArea: [{ areaId: charterA.hakone, perNightMinor: 20_000 }] }, workHours: { maxBindMinutes: 720 }, secondDriver: { mode: "fixed", fixedMinor: 30_000 } };
  const saved = await putRules(m.a, charterA.id, config);
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.body.version, before + 1);
  assert.equal(saved.body.rules_version, 1);
  assert.deepEqual(saved.body.saved, config);
  assert.equal(saved.body.effective.lodging.perNightMinor, 15_000);
  assert.deepEqual(saved.body.effective.lodging.byArea, config.lodging.byArea);
  assert.equal(saved.body.effective.workHours.maxBindMinutes, 720);
  assert.equal(saved.body.effective.workHours.hardMaxBindMinutes, 900);
  const audit = (await api.db.owner.query("select before, after from audit_logs where resource = 'product' and resource_id = $1 and action = 'update' order by id desc limit 1", [charterA.id])).rows[0];
  assert.deepEqual(audit.before, { trip_rules: null });
  assert.deepEqual(audit.after, { trip_rules: config });
  const again = await putRules(m.a, charterA.id, config);
  assert.equal(again.body.version, before + 1);
  assert.equal(again.body.rules_version, 1);
  const second = await putRules(m.a, charterA.id, { idleDay: { enabled: false } });
  assert.equal(second.body.rules_version, 2);
  assert.deepEqual(second.body.saved, { idleDay: { enabled: false } });
  assert.equal(second.body.effective.workHours.maxBindMinutes, 780);
  const stale = await tenantCall(m.a, "PUT", `/products/${charterA.id}/trip-rules`, { version: before, body: {} });
  assert.equal(stale.status, 409, stale.text);
  const missing = await tenantCall(m.a, "PUT", `/products/${charterA.id}/trip-rules`, { body: {} });
  assert.equal(missing.status, 428, missing.text);
});

test("校验：未知键、范围、先后、byArea 只认本商品的区域（含③）、fixedByCity 只认启用城市", async () => {
  const bad = await putRules(m.a, charterA.id, {
    foo: {},
    lodging: { perNightMinor: -1, byArea: [{ areaId: charterA.other, perNightMinor: 1 }, { areaId: charterB.hakone, perNightMinor: 1 }, { areaId: charterA.tokyo, perNightMinor: 1 }] },
    workHours: { maxBindMinutes: 901 },
    returnTrip: { ratioBp: 10_001, fixedByCity: [{ cityId: m.ids.osaka, minor: 1 }, { cityId: randomUUID(), minor: 1 }] },
  });
  assert.equal(bad.status, 400, bad.text);
  assert.deepEqual(issues(bad), [
    ["/foo", "UNKNOWN_KEY"],
    ["/lodging/perNightMinor", "OUT_OF_RANGE"],
    ["/lodging/byArea/0/areaId", "AREA_NOT_FOUND"],
    ["/lodging/byArea/1/areaId", "AREA_NOT_FOUND"],
    ["/returnTrip/ratioBp", "OUT_OF_RANGE"],
    ["/returnTrip/fixedByCity/1/cityId", "CITY_NOT_FOUND"],
    ["/workHours/maxBindMinutes", "ORDER"],
  ]);
  assert.equal((await putRules(m.a, charterA.id, [])).status, 400);
});

test("只有包车商品能配", async () => {
  const res = await putRules(m.a, m.ids.pa, {});
  assert.equal(res.status, 400, res.text);
  assert.equal(res.body.error.code, "TRIP_RULES_NOT_APPLICABLE");
});

test("租户隔离：A 读不到、改不了 B 的商品规则（和不存在一样 404），B 的不变", async () => {
  const beforeB = await tenantCall(m.b, "GET", `/products/${charterB.id}/trip-rules`);
  const read = await tenantCall(m.a, "GET", `/products/${charterB.id}/trip-rules`);
  assert.equal(read.status, 404, read.text);
  const write = await tenantCall(m.a, "PUT", `/products/${charterB.id}/trip-rules`, { version: beforeB.body.version, body: { lodging: { perNightMinor: 1 } } });
  assert.equal(write.status, 404, write.text);
  assert.equal(write.text, (await tenantCall(m.a, "PUT", `/products/${randomUUID()}/trip-rules`, { version: 1, body: {} })).text);
  assert.deepEqual((await tenantCall(m.b, "GET", `/products/${charterB.id}/trip-rules`)).body, beforeB.body);
  // 行级安全：A 的租户事务里看不到 B 的行
  await ok(putRules(m.b, charterB.id, { bundleAddons: { enabled: false } }));
  const rows = await withTenantTx(api.db.pool, m.a.tenantId, (db) => db.query<{ product_id: string }>("select product_id from trip_rule_configs"));
  assert.ok(rows.rows.every((row) => row.product_id !== charterB.id));
  assert.ok((await api.db.owner.query("select 1 from trip_rule_configs where product_id = $1", [charterB.id])).rows.length === 1);
});

test("平台只读：任何一家的商品；不存在 404", async () => {
  const res = await api.call("GET", `/platform/v1/products/${charterB.id}/trip-rules`, { token: m.root });
  assert.equal(res.status, 200, res.text);
  assertMatchesOpenApi("GET", "/platform/v1/products/{id}/trip-rules", res);
  assert.deepEqual(res.body.saved, { bundleAddons: { enabled: false } });
  assert.equal((await api.call("GET", `/platform/v1/products/${randomUUID()}/trip-rules`, { token: m.root })).status, 404);
});

test("迁移 0600：编号格式、抵扣符号、一车到底的租户车型组、级联删除", async () => {
  const db = api.db.owner;
  const channelId = (await newChannel(api, m.staff.cm1.token, { name: "行程迁移测试" })).id as string;
  const tripId = "A".repeat(43);
  const insertTrip = (id: string) => db.query("insert into trips (id, channel_id, source, status, itinerary, currency, created_at, updated_at, readable_until) values ($1, $2, 'form', 'draft', '{}', 'JPY', now(), now(), now() + interval '30 days')", [id, channelId]);
  await assert.rejects(insertTrip("short"), /trips_id_check/);
  await insertTrip(tripId);
  const plan = (await db.query<{ id: string }>("insert into trip_plans (trip_id, seq, kind, recommended, status, currency, quoted_at) values ($1, 0, 'daily_best', true, 'unquoted', 'JPY', now()) returning id", [tripId])).rows[0]?.id;
  await assert.rejects(db.query("insert into trip_plans (trip_id, seq, kind, recommended, status, currency, quoted_at) values ($1, 1, 'one_car', false, 'unquoted', 'JPY', now())", [tripId]), /trip_plans_one_car_key/);
  await assert.rejects(db.query("insert into trip_plans (trip_id, seq, kind, recommended, status, sell_minor, currency, quoted_at) values ($1, 2, 'daily_best', false, 'quoted', 100, 'JPY', now())", [tripId]), /trip_plans_quoted_amount/);
  const fee = (type: string, settlement: number, sell: number, seq: number) =>
    db.query("insert into trip_fees (trip_id, plan_id, seq, fee_type, rule_version, settlement_minor, settlement_currency, sell_minor, label, calc) values ($1, $2, $3, $4, 0, $5, 'JPY', $6, '{}', '{}')", [tripId, plan, seq, type, settlement, sell]);
  await fee("lodging", 15_000, 17_250, 0);
  await fee("lodging_offset", -24_000, -27_600, 1);
  await assert.rejects(fee("lodging", -1, -1, 2), /trip_fees_sign/);
  await assert.rejects(fee("bundle_discount", 1, 1, 3), /trip_fees_offset_sign/);
  await assert.rejects(fee("tip", 1, 1, 4), /trip_fees_type_check/);
  await assert.rejects(db.query("insert into trip_segments (plan_id, seq, day_index, service_date, segment_type, points, category) values ($1, 0, 0, '2027-03-28', 'idle_day', '[]', 'charter')", [plan]), /trip_segments_idle_shape/);
  await db.query("insert into trip_segments (plan_id, seq, day_index, service_date, segment_type, points) values ($1, 0, 1, '2027-03-29', 'idle_day', '[]')", [plan]);
  await db.query("delete from trips where id = $1", [tripId]);
  const left = await db.query("select (select count(*) from trip_plans where trip_id = $1)::int as plans, (select count(*) from trip_fees where trip_id = $1)::int as fees", [tripId]);
  assert.deepEqual(left.rows[0], { plans: 0, fees: 0 });
});
