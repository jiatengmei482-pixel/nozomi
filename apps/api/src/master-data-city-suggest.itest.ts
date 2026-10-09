/**
 * M1-09 验收标准 2：处理导入的机场时自动建议最近的城市（后端提供数据，前端确认即可）。
 * 另外核对导入城市在接口里的样子：平台看得到来源，改了名称 / 时区 / 坐标会标记「平台改过」。
 * 全部经真实接口、真实 PostgreSQL；机场和城市都是测试里编的（坐标取自真实的大致位置，便于核对距离）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { selectAirports, selectCities } from "@nozomi/domain";
import { importAirports } from "./services/airport-import.ts";
import { importCities } from "./services/city-import.ts";
import { type ApiResponse, type TenantFixture, type TestApi, createTestApi } from "./testing/api.ts";

let api: TestApi;
let root: string;
let tenant: TenantFixture;
const cityIds: Record<string, string> = {};

const get = (url: string, token = root): Promise<ApiResponse> => api.call("GET", url, { token });

async function city(code: string, country: string, name: string, lng: number, lat: number): Promise<any> {
  api.clock.advance(1_000);
  const res = await api.call("POST", "/platform/v1/master/cities", {
    token: root,
    body: { code, country_code: country, name: { zh: name }, timezone: country === "KR" ? "Asia/Seoul" : "Asia/Tokyo", center: { lng, lat } },
  });
  assert.equal(res.status, 201, res.text);
  cityIds[code] = res.body.id;
  return res.body;
}

before(async () => {
  api = await createTestApi();
  root = await api.superAdminToken();
  tenant = await api.tenantWithAdmin(root, "某车队", "admin@fleet.test");
  await city("CTY-JP-TYO", "JP", "东京", 139.69171, 35.6895);
  await city("CTY-JP-KWS", "JP", "川崎", 139.71722, 35.52056);
  await city("CTY-JP-YOK", "JP", "横滨", 139.65, 35.43333);
  await city("CTY-JP-CHB", "JP", "千叶", 140.11667, 35.6);
  await city("CTY-JP-OSA", "JP", "大阪", 135.50107, 34.69379);
  await city("CTY-KR-SEL", "KR", "首尔", 126.9784, 37.566);
  const stopped = await city("CTY-JP-NRT", "JP", "成田（已停用）", 140.31667, 35.78333);
  assert.equal((await api.call("POST", `/platform/v1/master/cities/${stopped.id}/disable`, { token: root })).status, 200);
  const header = "id,ident,type,name,latitude_deg,longitude_deg,iso_country,scheduled_service,iata_code";
  const rows = [
    "960001,T1,large_airport,Test Haneda,35.549678,139.786958,JP,yes,ZHN",
    "960002,T2,large_airport,Test Narita,35.76858,140.388714,JP,yes,ZNR",
    "960003,T3,large_airport,Test Kansai,34.427299,135.244003,JP,yes,ZKX",
    "960004,T4,medium_airport,Test Naha,26.195801,127.646004,JP,yes,ZOK",
    "960005,T5,large_airport,Test Incheon,37.469101,126.450996,KR,yes,ZIC",
    "960006,T6,medium_airport,Test Fukuoka KR border,33.5859,130.4507,KR,yes,ZFK",
  ];
  await importAirports(api.db.pool, selectAirports(`${header}\n${rows.join("\n")}\n`, null), api.clock.now(), { dryRun: false });
});
after(() => api.close());

async function sourceOf(cityId: string): Promise<{ source: string | null; source_ref: string | null; source_overridden: boolean }> {
  return (await api.db.owner.query("select source, source_ref, source_overridden from cities where id = $1", [cityId])).rows[0];
}

/** 核对一组候选：编号、编码、名称要完全对；距离是按坐标估的大致公里数，允许差 1 公里，并且保留 1 位小数。 */
function assertNearby(actual: any[], expected: [code: string, name: string, roughKm: number][]): void {
  assert.deepEqual(actual.map((item) => [item.id, item.code, item.name]), expected.map(([code, name]) => [cityIds[code], code, { zh: name }]));
  for (const [index, [code, , roughKm]] of expected.entries()) {
    const km = actual[index].distance_km as number;
    assert.ok(Math.abs(km - roughKm) <= 1, `${code}：${km} 公里，应当在 ${roughKm} 公里上下`);
    assert.equal(Math.round(km * 10) / 10, km, "距离保留 1 位小数");
  }
  assert.deepEqual([...actual].sort((x, y) => x.distance_km - y.distance_km), actual, "由近到远");
}

test("待指定城市的机场列表：每个机场带建议的城市——同一个国家、启用中、80 公里以内最近的；另给最多 3 个候选，由近到远", async () => {
  const res = await get("/platform/v1/master/places?city_id=none&sort=code");
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(Object.keys(res.body).sort(), ["city_suggestions", "items", "next_cursor", "total"]);
  assert.deepEqual(res.body.items.map((item: any) => item.code), ["ZFK", "ZHN", "ZIC", "ZKX", "ZNR", "ZOK"]);
  assert.deepEqual(res.body.city_suggestions.map((entry: any) => entry.place_id), res.body.items.map((item: any) => item.id), "每个地点一项，顺序和 items 相同");
  const byCode = Object.fromEntries((res.body.items as any[]).map((item, index) => [item.code, res.body.city_suggestions[index]]));
  for (const entry of res.body.city_suggestions) {
    assert.deepEqual(Object.keys(entry).sort(), ["nearby_cities", "place_id", "suggested_city"]);
    assert.deepEqual(entry.suggested_city, entry.nearby_cities[0] ?? null);
  }
  assert.doesNotMatch(JSON.stringify(res.body.items), /suggested_city|nearby_cities/, "地点对象本身的字段没有变");

  // 羽田：最近的是川崎而不是东京——所以要给候选让人确认
  assertNearby(byCode["ZHN"].nearby_cities, [["CTY-JP-KWS", "川崎", 7], ["CTY-JP-TYO", "东京", 18], ["CTY-JP-YOK", "横滨", 18]]);
  // 成田：最近的启用中的城市是千叶；成田市已停用，不在候选里；东京约 63 公里，在范围内
  assert.deepEqual(byCode["ZNR"].nearby_cities.map((item: any) => item.code), ["CTY-JP-CHB", "CTY-JP-TYO", "CTY-JP-KWS"]);
  assert.ok(!JSON.stringify(byCode["ZNR"]).includes("CTY-JP-NRT"));
  assert.ok(byCode["ZNR"].nearby_cities[1].distance_km > 55 && byCode["ZNR"].nearby_cities[1].distance_km < 70);
  // 关西：只有大阪在 80 公里以内
  assertNearby(byCode["ZKX"].nearby_cities, [["CTY-JP-OSA", "大阪", 38]]);
  // 那霸：80 公里以内没有城市
  assert.deepEqual([byCode["ZOK"].suggested_city, byCode["ZOK"].nearby_cities], [null, []]);
  // 仁川：只在韩国的城市里找
  assertNearby(byCode["ZIC"].nearby_cities, [["CTY-KR-SEL", "首尔", 48]]);
  // 国家是韩国、位置在日本福冈的机场：不会建议日本的城市
  assert.deepEqual(byCode["ZFK"].suggested_city, null);
  // 建议里只有编号、编码、名称、距离
  assert.deepEqual(Object.keys(byCode["ZHN"].suggested_city).sort(), ["code", "distance_km", "id", "name"]);
});

test("建议只出现在平台的「待指定城市」列表里：普通列表、单条、租户的列表都不带", async () => {
  const plain = await get("/platform/v1/master/places?type=airport");
  assert.equal(plain.body.total, 6);
  assert.doesNotMatch(plain.text, /city_suggestions|suggested_city|nearby_cities/);
  const pending = await get("/platform/v1/master/places?city_id=none&limit=1");
  assert.equal(pending.body.city_suggestions.length, 1);
  assert.doesNotMatch((await get(`/platform/v1/master/places/${pending.body.items[0].id}`)).text, /suggested_city|nearby_cities/);
  const fromTenant = await get("/tenant/v1/master/places?city_id=none&status=all", tenant.adminToken);
  assert.equal(fromTenant.body.total, 6);
  assert.deepEqual(Object.keys(fromTenant.body).sort(), ["items", "next_cursor", "total"]);
  assert.doesNotMatch(fromTenant.text, /city_suggestions|suggested_city|nearby_cities|distance_km/);
  // 和其他筛选、翻页一起用
  const page = await get("/platform/v1/master/places?city_id=none&country_code=KR&sort=code&limit=1");
  assert.deepEqual([page.body.total, page.body.items[0].code, page.body.city_suggestions], [2, "ZFK", [{ place_id: page.body.items[0].id, suggested_city: null, nearby_cities: [] }]]);
  const empty = await get("/platform/v1/master/places?city_id=none&country_code=US");
  assert.deepEqual([empty.body.total, empty.body.city_suggestions], [0, []]);
});

test("按建议确认：把建议的城市带给启用接口，一次完成指定城市并启用；机场从待处理列表里消失", async () => {
  const list = (await get("/platform/v1/master/places?city_id=none&q=kansai")).body;
  const before = list.items[0];
  const confirmed = await api.call("POST", `/platform/v1/master/places/${before.id}/enable`, { token: root, body: { city_id: list.city_suggestions[0].suggested_city.id } });
  assert.equal(confirmed.status, 200, confirmed.text);
  assert.deepEqual([confirmed.body.status, confirmed.body.city.code], ["active", "CTY-JP-OSA"]);
  assert.doesNotMatch(confirmed.text, /suggested_city/);
  const pending = await get("/platform/v1/master/places?city_id=none");
  assert.equal(pending.body.total, 5);
  assert.ok(!pending.body.items.some((item: any) => item.code === "ZKX"));
});

test("城市一启用 / 停用，建议跟着变：导入并启用了离那霸近的城市之后，那霸有了建议；停用后又没有了", async () => {
  const naha = [990101, "Test Naha City", "x", "", 26.213, 127.67851, "P", "PPLA", "JP", "", "47", "", "", "", 317000, "", "10", "Asia/Tokyo", "2026-01-01"].join("\t");
  const selection = selectCities(`${naha}\n`, [], { countries: ["JP"], minPopulation: 300_000 });
  await importCities(api.db.pool, selection, api.clock.now(), { dryRun: false, activate: false });
  const suggestion = async (): Promise<any> => (await get("/platform/v1/master/places?city_id=none&code=ZOK")).body.city_suggestions[0].suggested_city;
  assert.equal(await suggestion(), null, "导入的城市默认是停用的，还不会被建议");
  const imported = (await get("/platform/v1/master/cities?q=naha")).body.items[0];
  assert.equal(imported.status, "disabled");
  assert.deepEqual(await sourceOf(imported.id), { source: "geonames", source_ref: "990101", source_overridden: false });
  assert.equal((await api.call("POST", `/platform/v1/master/cities/${imported.id}/enable`, { token: root })).status, 200);
  const suggested = await suggestion();
  assert.deepEqual([suggested.id, suggested.code, suggested.name], [imported.id, imported.code, { en: "Test Naha City" }]);
  assert.ok(suggested.distance_km > 2 && suggested.distance_km < 5, String(suggested.distance_km));
  assert.equal((await api.call("POST", `/platform/v1/master/cities/${imported.id}/disable`, { token: root })).status, 200);
  assert.equal(await suggestion(), null);
});

test("导入的城市：平台改了名称、时区或中心坐标就标记「平台改过」并写进审计；只画边界不算；接口的应答里目前没有来源字段", async () => {
  const imported = (await get("/platform/v1/master/cities?q=naha")).body.items[0];
  const patch = (version: number, body: unknown): Promise<ApiResponse> =>
    api.call("PATCH", `/platform/v1/master/cities/${imported.id}`, { token: root, body, headers: { "if-match": `"${version}"` } });
  const bounded = await patch(imported.version, { boundary: { type: "Polygon", coordinates: [[[127, 26], [128, 26], [128, 27], [127, 27], [127, 26]]] } });
  assert.deepEqual([bounded.status, (await sourceOf(imported.id)).source_overridden], [200, false]);
  const same = await patch(bounded.body.version, { name: { en: "Test Naha City" }, timezone: "Asia/Tokyo", center: { lng: 127.67851, lat: 26.213 } });
  assert.deepEqual([same.body.version, (await sourceOf(imported.id)).source_overridden], [bounded.body.version, false], "值没变不算改");
  const renamed = await patch(bounded.body.version, { name: { en: "Test Naha City", zh: "那霸" } });
  assert.equal(renamed.status, 200, renamed.text);
  assert.deepEqual(await sourceOf(imported.id), { source: "geonames", source_ref: "990101", source_overridden: true });
  assert.equal("source" in renamed.body, false);
  const log = await api.db.owner.query("select before, after from audit_logs where resource = 'city' and resource_id = $1 order by id desc limit 1", [imported.id]);
  assert.deepEqual(log.rows[0], {
    before: { name: { en: "Test Naha City" }, source_overridden: false },
    after: { name: { en: "Test Naha City", zh: "那霸" }, source_overridden: true },
  });
  const fromTenant = await get(`/tenant/v1/master/cities/${imported.id}`, tenant.adminToken);
  assert.equal(fromTenant.status, 200);
  assert.doesNotMatch(fromTenant.text, /source|geonames|overridden|synced/);
  // 手工建的城市没有来源，怎么改都不会出现「平台改过」
  const manual = (await get("/platform/v1/master/cities?code=CTY-JP-TYO")).body.items[0];
  const edited = await api.call("PATCH", `/platform/v1/master/cities/${manual.id}`, { token: root, body: { name: { zh: "东京都" } }, headers: { "if-match": `"${manual.version}"` } });
  assert.equal(edited.status, 200, edited.text);
  assert.deepEqual(await sourceOf(manual.id), { source: null, source_ref: null, source_overridden: false });
});
