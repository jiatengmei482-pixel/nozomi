/**
 * M1-01 验收标准 2：平台后台可增删改主数据（城市、地点、车型组、附加服务），改动有审计。
 * 「删」是停用：主数据没有删除接口，数据库里平台角色也没有删除权限。
 * 全部经真实接口、真实 PostgreSQL；测试数据都在这里构造，结束时连同 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { selectAirports } from "@nozomi/domain";
import { withPlatformTx } from "./db/context.ts";
import { tryLockAirportImport } from "./repos/master-data.ts";
import { AirportImportError, importAirports } from "./services/airport-import.ts";
import { type ApiResponse, TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";
import { deniedByDatabase } from "./testing/db.ts";

let api: TestApi;
let root: string;
let editor: string;
let viewer: string;

const MISSING = "99999999-9999-4999-8999-999999999999";
const TOKYO = { code: "CTY-JP-TYO", country_code: "JP", name: { ja: "東京", zh: "东京", en: "Tokyo" }, timezone: "Asia/Tokyo", center: { lng: 139.767125, lat: 35.681236 } };
const SQUARE = { type: "Polygon", coordinates: [[[139, 35], [140, 35], [140, 36], [139, 36], [139, 35]]] };

async function staffToken(email: string, role: string): Promise<string> {
  const invited = await api.call("POST", "/platform/v1/staff", { token: root, body: { email, name: email, role } });
  assert.equal(invited.status, 201, invited.text);
  const accepted = await api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.body.invite.token, password: TEST_PASSWORD } });
  assert.equal(accepted.status, 200, accepted.text);
  const login = await api.call("POST", "/platform/v1/auth/login", { body: { email, password: TEST_PASSWORD } });
  return login.body.access_token as string;
}

before(async () => {
  api = await createTestApi();
  root = await api.superAdminToken();
  editor = await staffToken("master@platform.test", "master_data");
  viewer = await staffToken("viewer@platform.test", "readonly");
});
after(() => api.close());

const post = (path: string, body: unknown, token = editor): Promise<ApiResponse> => api.call("POST", `/platform/v1/master/${path}`, { token, body });
const get = (path: string, token = editor): Promise<ApiResponse> => api.call("GET", `/platform/v1/master/${path}`, { token });
const patch = (path: string, version: number | null, body: unknown, token = editor): Promise<ApiResponse> =>
  api.call("PATCH", `/platform/v1/master/${path}`, { token, body, ...(version === null ? {} : { headers: { "if-match": `"${version}"` } }) });

async function created(path: string, body: unknown): Promise<any> {
  // 测试的时钟不会自己走：每次新增前拨一秒，列表的「按创建时间排序」才有确定的顺序
  api.clock.advance(1_000);
  const res = await post(path, body);
  assert.equal(res.status, 201, res.text);
  return res.body;
}

/** 某个对象的审计日志，从旧到新。 */
async function audit(resource: string, id: string): Promise<any[]> {
  const res = await api.call("GET", `/platform/v1/audit-logs?resource=${resource}&resource_id=${id}`, { token: root });
  assert.equal(res.status, 200, res.text);
  return (res.body.items as any[]).reverse();
}

function issuePaths(res: ApiResponse): string[] {
  assert.equal(res.status, 400, res.text);
  assert.equal(res.body.error.code, "VALIDATION_FAILED");
  return (res.body.error.details.issues as { path: string }[]).map((issue) => issue.path);
}

let serial = 0;
/** 每个测试用自己的城市，互不影响。 */
async function newCity(country = "JP", timezone = "Asia/Tokyo"): Promise<any> {
  serial += 1;
  return created("cities", { ...TOKYO, code: `CTY-${country}-T${serial}`, country_code: country, timezone, name: { zh: `测试城市${serial}` } });
}

test("城市：新增后是启用的、版本 1，坐标保留 6 位小数；能按编号、编码、国家查到；写了一条审计日志", async () => {
  const res = await post("cities", { ...TOKYO, center: { lng: 139.76712549, lat: 35.6812361 }, boundary: SQUARE });
  assert.equal(res.status, 201, res.text);
  const city = res.body;
  assert.deepEqual(Object.keys(city).sort(), ["boundary", "center", "code", "country_code", "created_at", "id", "name", "status", "timezone", "updated_at", "version"]);
  assert.deepEqual(
    { ...city, id: null, created_at: null, updated_at: null },
    { ...TOKYO, center: { lng: 139.767125, lat: 35.681236 }, boundary: SQUARE, status: "active", version: 1, id: null, created_at: null, updated_at: null },
  );
  assert.deepEqual((await get(`cities/${city.id}`)).body, city);
  assert.deepEqual((await get("cities?code=CTY-JP-TYO")).body.items, [city]);
  assert.ok((await get("cities?country_code=JP")).body.items.some((item: any) => item.id === city.id));
  assert.deepEqual((await get("cities?country_code=KR&code=CTY-JP-TYO")).body.items, []);

  const logs = await audit("city", city.id);
  assert.equal(logs.length, 1);
  assert.deepEqual(
    { action: logs[0].action, tenant_id: logs[0].tenant_id, actor: logs[0].actor.email, source: logs[0].source, before: logs[0].before },
    { action: "create", tenant_id: null, actor: "master@platform.test", source: "console", before: null },
  );
  assert.deepEqual(logs[0].after, {
    code: "CTY-JP-TYO", country_code: "JP", name: TOKYO.name, timezone: "Asia/Tokyo", center_lng: 139.767125, center_lat: 35.681236, boundary: SQUARE, status: "active",
  });
});

test("城市：编码、国家、时区、坐标、边界、名称逐项严格校验，不合格的什么都不写", async () => {
  const count = async (): Promise<number> => (await api.db.owner.query("select count(*)::int as n from cities")).rows[0].n;
  const before = await count();
  const cases: [string, Record<string, unknown>, string][] = [
    ["编码格式不对", { code: "TOKYO" }, "/code"],
    ["编码里的国家码和国家不一致", { code: "CTY-KR-TYO" }, "/code"],
    ["国家码不存在", { code: "CTY-ZZ-TYO", country_code: "ZZ" }, "/country_code"],
    ["国家码小写", { country_code: "jp" }, "/country_code"],
    ["时区是缩写", { timezone: "JST" }, "/timezone"],
    ["时区是固定偏移", { timezone: "+09:00" }, "/timezone"],
    ["时区是 UTC", { timezone: "UTC" }, "/timezone"],
    ["时区不存在", { timezone: "Asia/Edo" }, "/timezone"],
    ["时区大小写不对", { timezone: "asia/tokyo" }, "/timezone"],
    ["时区别名的大小写不对（规则判断不出，由数据库的名单逐字核对）", { timezone: "Asia/KOLKATA" }, "/timezone"],
    ["经度超出范围", { center: { lng: 180.5, lat: 35 } }, "/center/lng"],
    ["纬度超出范围", { center: { lng: 139, lat: -91 } }, "/center/lat"],
    ["坐标不是数字", { center: { lng: "139", lat: 35 } }, "/center/lng"],
    ["缺纬度", { center: { lng: 139 } }, "/center/lat"],
    ["边界没有闭合", { boundary: { type: "Polygon", coordinates: [[[139, 35], [140, 35], [140, 36], [139, 36]]] } }, "/boundary"],
    ["边界的坐标超出范围", { boundary: { type: "Polygon", coordinates: [[[139, 35], [140, 35], [140, 96], [139, 35]]] } }, "/boundary"],
    ["边界类型不支持", { boundary: { type: "Point", coordinates: [139, 35] } }, "/boundary/type"],
    ["名称是空对象", { name: {} }, "/name"],
    ["名称用了不支持的语言", { name: { fr: "Tokyo" } }, "/name"],
    ["名称只有空白", { name: { zh: "   " } }, "/name/zh"],
    ["名称只有零宽空格", { name: { zh: "\u200b\u200b" } }, "/name/zh"],
    ["名称只有方向控制符", { name: { zh: "东京", en: "\u202e\u200d" } }, "/name/en"],
    ["名称里有半个表情符号", { name: { zh: "东京\ud83d" } }, "/name/zh"],
    ["名称太长", { name: { zh: "京".repeat(201) } }, "/name/zh"],
    ["缺名称", { name: undefined }, "/name"],
  ];
  for (const [label, override, path] of cases) {
    const res = await post("cities", { ...TOKYO, code: "CTY-JP-BAD", ...override });
    assert.ok(issuePaths(res).includes(path), `${label}：${res.text}`);
  }
  assert.equal(await count(), before);
  const nul = await post("cities", { ...TOKYO, code: "CTY-JP-NUL", name: { zh: "东\u0000京" } });
  assert.equal(nul.status, 400);
  // 时区的别名（数据库和运行环境都认识）可以用
  const kolkata = await post("cities", { code: "CTY-IN-CCU", country_code: "IN", name: { en: "Kolkata" }, timezone: "Asia/Kolkata", center: { lng: 88.3639, lat: 22.5726 } });
  assert.equal(kolkata.status, 201, kolkata.text);
});

test("城市：编码重复返回 409 CODE_TAKEN，原来的记录不变", async () => {
  const first = await newCity();
  const dup = await post("cities", { ...TOKYO, code: first.code, name: { zh: "冒名的" } });
  assert.equal(dup.status, 409);
  assert.equal(dup.body.error.code, "CODE_TAKEN");
  assert.deepEqual((await get(`cities/${first.id}`)).body, first);
});

test("修改：必须带版本号；版本过期返回 409 且不改动；成功后版本加一，审计日志只记变了的字段的前后值", async () => {
  const city = await newCity();
  const missing = await patch(`cities/${city.id}`, null, { timezone: "Asia/Seoul" });
  assert.equal(missing.status, 428);
  assert.equal(missing.body.error.code, "PRECONDITION_REQUIRED");
  for (const header of ["abc", "0", '"1', "W/\"1\"", "1.0", "-1"]) {
    const bad = await api.call("PATCH", `/platform/v1/master/cities/${city.id}`, { token: editor, body: {}, headers: { "if-match": header } });
    assert.equal(bad.status, 400, header);
    assert.deepEqual(bad.body.error.details.issues.map((issue: any) => issue.path), ["/if-match"]);
  }

  const ok = await patch(`cities/${city.id}`, 1, { name: { zh: "改过的名字", en: "Renamed" }, center: { lng: 139.7, lat: 35.7 }, timezone: "Asia/Tokyo" });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.body.version, 2);
  assert.deepEqual(ok.body.name, { zh: "改过的名字", en: "Renamed" });
  assert.deepEqual(ok.body.center, { lng: 139.7, lat: 35.7 });
  assert.equal(ok.body.code, city.code);

  const stale = await patch(`cities/${city.id}`, 1, { name: { zh: "晚到的修改" } });
  assert.equal(stale.status, 409);
  assert.deepEqual(stale.body.error, { code: "VERSION_CONFLICT", message: "这条记录已被别人修改，请刷新后重试", details: { current_version: 2 } });
  assert.deepEqual((await get(`cities/${city.id}`)).body, ok.body);

  // 不带引号的写法也接受；内容没变：原样返回，版本不变，不写日志
  const same = await api.call("PATCH", `/platform/v1/master/cities/${city.id}`, { token: editor, body: { name: { en: "Renamed", zh: "改过的名字" } }, headers: { "if-match": "2" } });
  assert.equal(same.status, 200);
  assert.deepEqual(same.body, ok.body);

  const cleared = await patch(`cities/${city.id}`, 2, { boundary: SQUARE });
  assert.equal(cleared.body.version, 3);
  assert.deepEqual((await patch(`cities/${city.id}`, 3, { boundary: null })).body.boundary, null);

  const logs = await audit("city", city.id);
  assert.deepEqual(logs.map((log) => log.action), ["create", "update", "update", "update"]);
  assert.deepEqual(logs[1].before, { name: city.name, center_lng: city.center.lng, center_lat: city.center.lat });
  assert.deepEqual(logs[1].after, { name: { zh: "改过的名字", en: "Renamed" }, center_lng: 139.7, center_lat: 35.7 });
  assert.deepEqual([logs[2].before, logs[2].after], [{ boundary: null }, { boundary: SQUARE }]);
  assert.deepEqual([logs[3].before, logs[3].after], [{ boundary: SQUARE }, { boundary: null }]);
});

test("修改：创建后不能改的字段（编码、国家）带了不同的值返回 409 FIELD_LOCKED；带了相同的值不算改", async () => {
  const city = await newCity();
  const locked = await patch(`cities/${city.id}`, 1, { code: "CTY-KR-SEL", country_code: "KR", name: { zh: "想换国家" } });
  assert.equal(locked.status, 409);
  assert.deepEqual(locked.body.error.details, { fields: ["code", "country_code"] });
  assert.equal(locked.body.error.code, "FIELD_LOCKED");
  const same = await patch(`cities/${city.id}`, 1, { code: city.code, country_code: "JP", timezone: "Asia/Seoul" });
  assert.equal(same.status, 200, same.text);
  assert.equal(same.body.timezone, "Asia/Seoul");
  const invalid = await patch(`cities/${city.id}`, 2, { timezone: "Tokyo" });
  assert.deepEqual(issuePaths(invalid), ["/timezone"]);
  assert.equal((await patch(`cities/${MISSING}`, 1, { timezone: "Asia/Seoul" })).status, 404);
  assert.equal((await patch("cities/not-a-uuid", 1, {})).status, 404);
});

test("停用和启用：改状态、版本加一、各写一条审计日志；重复调用不重复记；没有删除接口", async () => {
  const city = await newCity();
  const disabled = await post(`cities/${city.id}/disable`, undefined);
  assert.equal(disabled.status, 200, disabled.text);
  assert.deepEqual([disabled.body.status, disabled.body.version], ["disabled", 2]);
  assert.deepEqual((await post(`cities/${city.id}/disable`, undefined)).body, disabled.body);
  assert.deepEqual((await get(`cities?status=disabled&code=${city.code}`)).body.items, [disabled.body]);
  assert.deepEqual((await get(`cities?status=active&code=${city.code}`)).body.items, []);
  const enabled = await post(`cities/${city.id}/enable`, undefined);
  assert.deepEqual([enabled.body.status, enabled.body.version], ["active", 3]);

  const logs = await audit("city", city.id);
  assert.deepEqual(logs.map((log) => [log.action, log.before, log.after]), [
    ["create", null, logs[0].after],
    ["disable", { status: "active" }, { status: "disabled" }],
    ["enable", { status: "disabled" }, { status: "active" }],
  ]);

  for (const path of ["cities", "places", "vehicle-groups", "addons"]) {
    const res = await api.call("DELETE", `/platform/v1/master/${path}/${city.id}`, { token: root });
    assert.equal(res.status, 404, path);
  }
  assert.equal((await post(`cities/${MISSING}/disable`, undefined)).status, 404);
});

test("数据库层面：平台角色删不了主数据（没有 delete 权限）", async () => {
  await newCity();
  for (const table of ["cities", "places", "vehicle_groups", "addons"]) {
    await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query(`delete from ${table}`)), deniedByDatabase, table);
    await assert.rejects(withPlatformTx(api.db.pool, (db) => db.query(`truncate ${table} cascade`)), deniedByDatabase, table);
  }
});

test("列表：按创建顺序翻页不重不漏；updated_since 只返回之后改过的", async () => {
  const cities = [await newCity("KR", "Asia/Seoul"), await newCity("KR", "Asia/Seoul"), await newCity("KR", "Asia/Seoul")];
  const seen: string[] = [];
  let cursor: string | null = null;
  do {
    const res = await get(`cities?country_code=KR&limit=2${cursor ? `&cursor=${cursor}` : ""}`);
    assert.equal(res.status, 200, res.text);
    seen.push(...res.body.items.map((item: any) => item.id));
    cursor = res.body.next_cursor;
  } while (cursor);
  assert.deepEqual(seen, cities.map((city) => city.id));

  api.clock.advance(60_000);
  const since = api.clock.now().toISOString();
  await patch(`cities/${cities[1].id}`, 1, { name: { zh: "后来改的" } });
  const changed = await get(`cities?country_code=KR&updated_since=${encodeURIComponent(since)}`);
  assert.deepEqual(changed.body.items.map((item: any) => item.id), [cities[1].id]);
  assert.deepEqual(issuePaths(await get("cities?updated_since=yesterday")), ["/updated_since"]);
  assert.deepEqual(issuePaths(await get("cities?status=deleted")), ["/status"]);
  assert.deepEqual(issuePaths(await get("cities?country_code=jp")), ["/country_code"]);
});

test("权限：只读角色能看不能改；主数据运营能改；没登录是 401", async () => {
  const city = await newCity();
  assert.equal((await get(`cities/${city.id}`, viewer)).status, 200);
  assert.equal((await get("places", viewer)).status, 200);
  assert.equal((await post("cities", { ...TOKYO, code: "CTY-JP-NOPE" }, viewer)).status, 403);
  assert.equal((await patch(`cities/${city.id}`, 1, { name: { zh: "x" } }, viewer)).status, 403);
  assert.equal((await post(`cities/${city.id}/disable`, undefined, viewer)).status, 403);
  assert.equal((await api.call("GET", "/platform/v1/master/cities")).status, 401);
  assert.deepEqual((await get(`cities/${city.id}`)).body, city);
});

const HANEDA = { type: "airport", code: "HND", name: { ja: "羽田空港", en: "Tokyo Haneda" }, location: { lng: 139.786958, lat: 35.549678 }, flight_scope: "mixed" };

test("地点：机场、车站、地标归属城市，国家取自城市；航站楼和出口挂在上级下面，城市和国家跟随上级", async () => {
  const city = await newCity();
  const airport = await created("places", { ...HANEDA, city_id: city.id });
  assert.deepEqual(Object.keys(airport).sort(), [
    "address", "category", "city", "city_id", "code", "country_code", "created_at", "flight_scope", "id", "location", "name", "parent", "parent_id", "source", "status", "type", "updated_at", "version",
  ]);
  assert.deepEqual(
    [airport.country_code, airport.city_id, airport.parent_id, airport.status, airport.version, airport.source, airport.category, airport.flight_scope],
    ["JP", city.id, null, "active", 1, null, null, "mixed"],
  );
  const terminal = await created("places", { type: "terminal", code: "HND-T3", parent_id: airport.id, name: { zh: "第 3 航站楼" }, location: { lng: 139.7853, lat: 35.5447 }, flight_scope: "international" });
  assert.deepEqual([terminal.city_id, terminal.country_code, terminal.parent_id], [city.id, "JP", airport.id]);
  const station = await created("places", { type: "station", code: "STN-JP-TOKYO", city_id: city.id, name: { zh: "东京站" }, location: { lng: 139.767125, lat: 35.681236 }, category: "shinkansen" });
  const exit = await created("places", { type: "exit", code: "STN-JP-TOKYO-E1", parent_id: station.id, name: { zh: "八重洲口" }, location: { lng: 139.7688, lat: 35.6812 } });
  assert.equal(exit.city_id, city.id);
  const poi = await created("places", { type: "poi", code: "POI-000001", city_id: city.id, name: { zh: "东京站大饭店" }, location: { lng: 139.7662, lat: 35.6809 }, category: "hotel", address: " 东京都千代田区丸之内 1-9-1 " });
  assert.equal(poi.address, "东京都千代田区丸之内 1-9-1");

  assert.deepEqual((await get(`places?parent_id=${airport.id}`)).body.items, [terminal]);
  assert.deepEqual((await get(`places?city_id=${city.id}&type=station`)).body.items, [station]);
  assert.deepEqual((await get(`places?city_id=${city.id}`)).body.items.map((item: any) => item.code), ["HND", "HND-T3", "STN-JP-TOKYO", "STN-JP-TOKYO-E1", "POI-000001"]);
  assert.equal((await audit("place", terminal.id))[0].after.city_id, city.id);

  // 编码全平台唯一
  const dup = await post("places", { ...HANEDA, city_id: city.id });
  assert.equal(dup.body.error.code, "CODE_TAKEN");

  // 机场换城市：航站楼跟着换，审计里记下带动了几个
  const other = await newCity();
  const moved = await patch(`places/${airport.id}`, 1, { city_id: other.id });
  assert.equal(moved.status, 200, moved.text);
  assert.equal(moved.body.city_id, other.id);
  const movedTerminal = (await get(`places/${terminal.id}`)).body;
  assert.deepEqual([movedTerminal.city_id, movedTerminal.version], [other.id, 2]);
  const logs = await audit("place", airport.id);
  assert.deepEqual([logs[1].before, logs[1].after], [{ city_id: city.id }, { city_id: other.id, children_moved: 1 }]);

  // 航站楼不能单独换城市；类型、编码、上级不能改
  assert.deepEqual(issuePaths(await patch(`places/${terminal.id}`, 2, { city_id: city.id })), ["/city_id"]);
  const locked = await patch(`places/${terminal.id}`, 2, { type: "exit", code: "HND-T9", parent_id: station.id });
  assert.deepEqual(locked.body.error.details, { fields: ["type", "code", "parent_id"] });

  // 停用有保护：下面还有启用中的航站楼时机场不能停用；城市下还有启用中的地点时城市不能停用
  const blocked = await post(`places/${airport.id}/disable`, undefined);
  assert.equal(blocked.status, 409);
  assert.deepEqual(blocked.body.error, { code: "MASTER_DATA_IN_USE", message: "它下面还有 1 个启用中的航站楼或出口，请先停用它们", details: { active_count: 1 } });
  const cityBlocked = await post(`cities/${other.id}/disable`, undefined);
  assert.equal(cityBlocked.body.error.code, "MASTER_DATA_IN_USE");
  assert.deepEqual(cityBlocked.body.error.details, { active_count: 2 });

  assert.equal((await post(`places/${terminal.id}/disable`, undefined)).body.status, "disabled");
  assert.equal((await post(`places/${airport.id}/disable`, undefined)).body.status, "disabled");
  assert.equal((await post(`cities/${other.id}/disable`, undefined)).body.status, "disabled");

  // 启用有保护：城市停用时地点不能启用；上级停用时航站楼不能启用；停用的城市、停用的上级下面不能新增
  const noCity = await post(`places/${airport.id}/enable`, undefined);
  assert.deepEqual([noCity.status, noCity.body.error.code, noCity.body.error.details], [409, "MASTER_DATA_NOT_READY", { reason: "CITY_DISABLED" }]);
  assert.deepEqual((await post("places", { ...HANEDA, code: "NRT", city_id: other.id })).body.error.details, { reason: "CITY_DISABLED" });
  assert.equal((await post(`cities/${other.id}/enable`, undefined)).body.status, "active");
  assert.deepEqual((await post(`places/${terminal.id}/enable`, undefined)).body.error.details, { reason: "PARENT_DISABLED" });
  assert.deepEqual(
    (await post("places", { type: "terminal", code: "HND-T1", parent_id: airport.id, name: { zh: "第 1 航站楼" }, location: { lng: 139.78, lat: 35.55 } })).body.error.details,
    { reason: "PARENT_DISABLED" },
  );
  assert.equal((await post(`places/${airport.id}/enable`, undefined)).body.status, "active");
  assert.equal((await post(`places/${terminal.id}/enable`, undefined)).body.status, "active");
});

test("地点：类型、编码、归属、属性逐项校验", async () => {
  const jp = await newCity();
  const kr = await newCity("KR", "Asia/Seoul");
  const airport = await created("places", { ...HANEDA, code: "KIX", city_id: jp.id });
  const station = await created("places", { type: "station", code: "STN-JP-OSAKA", city_id: jp.id, name: { zh: "大阪站" }, location: { lng: 135.4959, lat: 34.7025 }, category: "rail" });
  const base = { name: { zh: "测试" }, location: { lng: 135.5, lat: 34.7 } };
  const cases: [string, Record<string, unknown>, string][] = [
    ["机场编码不是三字码", { type: "airport", code: "KIXX", city_id: jp.id }, "/code"],
    ["机场没给城市", { type: "airport", code: "ITM" }, "/city_id"],
    ["城市不存在", { type: "airport", code: "ITM", city_id: MISSING }, "/city_id"],
    ["城市编号格式不对", { type: "airport", code: "ITM", city_id: "tokyo" }, "/city_id"],
    ["机场不能有上级", { type: "airport", code: "ITM", city_id: jp.id, parent_id: airport.id }, "/parent_id"],
    ["车站编码里的国家码和城市的国家不一致", { type: "station", code: "STN-JP-SEOUL", city_id: kr.id, category: "rail" }, "/code"],
    ["车站没给类型", { type: "station", code: "STN-JP-KOBE", city_id: jp.id }, "/category"],
    ["车站用了地标的类型", { type: "station", code: "STN-JP-KOBE", city_id: jp.id, category: "hotel" }, "/category"],
    ["车站不能有地址", { type: "station", code: "STN-JP-KOBE", city_id: jp.id, category: "rail", address: "某处" }, "/address"],
    ["车站没有国际国内属性", { type: "station", code: "STN-JP-KOBE", city_id: jp.id, category: "rail", flight_scope: "mixed" }, "/flight_scope"],
    ["地标编码格式不对", { type: "poi", code: "HOTEL-1", city_id: jp.id, category: "hotel" }, "/code"],
    ["地标没给类型", { type: "poi", code: "POI-9", city_id: jp.id }, "/category"],
    ["机场不能有类型", { type: "airport", code: "ITM", city_id: jp.id, category: "hotel" }, "/category"],
    ["航站楼没给上级", { type: "terminal", code: "KIX-T1" }, "/parent_id"],
    ["航站楼的上级不是机场", { type: "terminal", code: "STN-JP-OSAKA-T1", parent_id: station.id }, "/parent_id"],
    ["航站楼的上级不存在", { type: "terminal", code: "KIX-T1", parent_id: MISSING }, "/parent_id"],
    ["航站楼的编码不是上级编码加后缀", { type: "terminal", code: "HND-T1", parent_id: airport.id }, "/code"],
    ["航站楼不能另指定城市", { type: "terminal", code: "KIX-T1", parent_id: airport.id, city_id: kr.id }, "/city_id"],
    ["出口的上级不是车站", { type: "exit", code: "KIX-E1", parent_id: airport.id }, "/parent_id"],
    ["类型不存在", { type: "harbor", code: "POI-1", city_id: jp.id }, "/type"],
    ["经度超出范围", { type: "airport", code: "ITM", city_id: jp.id, location: { lng: 181, lat: 34 } }, "/location/lng"],
    ["缺坐标", { type: "airport", code: "ITM", city_id: jp.id, location: undefined }, "/location"],
  ];
  const before = (await api.db.owner.query("select count(*)::int as n from places")).rows[0].n;
  for (const [label, override, path] of cases) {
    const res = await post("places", { ...base, ...override });
    assert.ok(issuePaths(res).includes(path), `${label}：${res.text}`);
  }
  assert.equal((await api.db.owner.query("select count(*)::int as n from places")).rows[0].n, before);

  // 修改：换到别的国家的城市、把属性改成这个类型不该有的，都不行
  assert.deepEqual(issuePaths(await patch(`places/${airport.id}`, 1, { city_id: kr.id })), ["/city_id"]);
  assert.deepEqual(issuePaths(await patch(`places/${airport.id}`, 1, { city_id: MISSING })), ["/city_id"]);
  assert.deepEqual(issuePaths(await patch(`places/${station.id}`, 1, { category: null })), ["/category"]);
  assert.deepEqual(issuePaths(await patch(`places/${station.id}`, 1, { category: "mall" })), ["/category"]);
  assert.deepEqual(issuePaths(await patch(`places/${airport.id}`, 1, { address: "机场不该有地址" })), ["/address"]);
  assert.deepEqual(issuePaths(await patch(`places/${airport.id}`, 1, { location: { lng: 135.2, lat: 95 } })), ["/location/lat"]);
  const ok = await patch(`places/${airport.id}`, 1, { flight_scope: null, location: { lng: 135.2440031, lat: 34.4272994 } });
  assert.deepEqual([ok.body.flight_scope, ok.body.location, ok.body.version], [null, { lng: 135.244003, lat: 34.427299 }, 2]);
});

test("导入的机场：没有城市所以是停用的，指定城市后才能启用；平台改了英文名或坐标后标记为「平台改过」", async () => {
  const header = "id,ident,type,name,latitude_deg,longitude_deg,iso_country,scheduled_service,iata_code";
  const selection = selectAirports(`${header}\n900001,TST1,large_airport,Test Import Airport,33.5859,130.4507,JP,yes,FUK\n`, ["JP"]);
  await importAirports(api.db.pool, selection, api.clock.now(), { dryRun: false });
  const imported = (await get("places?code=FUK")).body.items[0];
  assert.deepEqual(
    [imported.status, imported.city_id, imported.name, imported.source.name, imported.source.ref, imported.source.overridden],
    ["disabled", null, { en: "Test Import Airport" }, "ourairports", "900001", false],
  );
  assert.deepEqual((await post(`places/${imported.id}/enable`, undefined)).body.error.details, { reason: "CITY_MISSING" });

  const city = await newCity();
  const assigned = await patch(`places/${imported.id}`, 1, { city_id: city.id, name: { en: "Test Import Airport", zh: "福冈机场", ja: "福岡空港" } });
  assert.equal(assigned.status, 200, assigned.text);
  assert.equal(assigned.body.source.overridden, false, "只补了别的语言、指定了城市，不算改了数据源的内容");
  const enabled = await post(`places/${imported.id}/enable`, undefined);
  assert.deepEqual([enabled.body.status, enabled.body.version], ["active", 3]);

  const corrected = await patch(`places/${imported.id}`, 3, { location: { lng: 130.4444, lat: 33.5859 } });
  assert.equal(corrected.body.source.overridden, true);
  const logs = await audit("place", imported.id);
  assert.deepEqual(logs.map((log) => [log.action, log.actor.type, log.source]), [
    ["create", "system", "cli"],
    ["update", "platform_user", "console"],
    ["enable", "platform_user", "console"],
    ["update", "platform_user", "console"],
  ]);
  assert.deepEqual(logs[3].after, { lng: 130.4444, source_overridden: true });
});

const BIZ7 = { code: "VG-BIZ-7", grade: "business", seats: 7, name: { zh: "商务 7 座", ja: "ビジネス 7 人乗り" }, sample_models: ["丰田埃尔法"], power: "fuel", combos: [{ passengers: 6, luggage: 2 }, { passengers: 4, luggage: 4 }] };

test("车型组：新增、校验、修改（编码、等级、座位数不能改）、停用启用，都有审计", async () => {
  const group = await created("vehicle-groups", BIZ7);
  assert.deepEqual({ ...group, id: null, created_at: null, updated_at: null }, { ...BIZ7, status: "active", version: 1, id: null, created_at: null, updated_at: null });
  assert.deepEqual((await get("vehicle-groups?grade=business")).body.items, [group]);
  assert.deepEqual((await get("vehicle-groups?grade=luxury")).body.items, []);

  const cases: [string, Record<string, unknown>, string][] = [
    ["编码格式不对", { code: "BIZ-7" }, "/code"],
    ["编码末尾和座位数不一致", { code: "VG-BIZ-5" }, "/code"],
    ["编码里的等级缩写和等级不一致", { code: "VG-ECO-7", grade: "luxury" }, "/code"],
    ["编码里的等级缩写和等级不一致（带后缀）", { code: "VG-LUXEV-7" }, "/code"],
    ["代表车型只有零宽空格", { sample_models: ["\u200b"] }, "/sample_models/0"],
    ["等级不存在", { code: "VG-VIP-7", grade: "vip" }, "/grade"],
    ["座位数是 0", { code: "VG-BIZ-7", seats: 0 }, "/seats"],
    ["座位数不是整数", { seats: 6.5 }, "/seats"],
    ["动力不存在", { power: "hydrogen" }, "/power"],
    ["没有组合", { combos: [] }, "/combos"],
    ["人数超过座位数", { combos: [{ passengers: 8, luggage: 0 }] }, "/combos"],
    ["组合重复", { combos: [{ passengers: 4, luggage: 2 }, { passengers: 4, luggage: 2 }] }, "/combos"],
    ["行李数是负数", { combos: [{ passengers: 4, luggage: -1 }] }, "/combos/0/luggage"],
    ["行李数太多", { combos: [{ passengers: 4, luggage: 100 }] }, "/combos"],
    ["代表车型是空字符串", { sample_models: [""] }, "/sample_models/0"],
  ];
  for (const [label, override, path] of cases) {
    const res = await post("vehicle-groups", { ...BIZ7, code: "VG-BIZX-7", ...override });
    assert.ok(issuePaths(res).includes(path), `${label}：${res.text}`);
  }
  assert.equal((await post("vehicle-groups", BIZ7)).body.error.code, "CODE_TAKEN");

  const locked = await patch(`vehicle-groups/${group.id}`, 1, { seats: 9, grade: "luxury", code: "VG-LUX-9" });
  assert.deepEqual(locked.body.error.details, { fields: ["code", "grade", "seats"] });
  assert.deepEqual(issuePaths(await patch(`vehicle-groups/${group.id}`, 1, { combos: [{ passengers: 8, luggage: 1 }] })), ["/combos"]);
  const updated = await patch(`vehicle-groups/${group.id}`, 1, { power: "ev", combos: [{ passengers: 6, luggage: 3 }], sample_models: [] });
  assert.equal(updated.status, 200, updated.text);
  assert.deepEqual([updated.body.power, updated.body.combos, updated.body.sample_models, updated.body.version], ["ev", [{ passengers: 6, luggage: 3 }], [], 2]);
  assert.equal((await post(`vehicle-groups/${group.id}/disable`, undefined)).body.status, "disabled");
  assert.equal((await post(`vehicle-groups/${group.id}/enable`, undefined)).body.status, "active");

  const logs = await audit("vehicle_group", group.id);
  assert.deepEqual(logs.map((log) => log.action), ["create", "update", "disable", "enable"]);
  assert.deepEqual(logs[0].after, { ...BIZ7, status: "active" });
  assert.deepEqual(logs[1].before, { power: "fuel", combos: BIZ7.combos, sample_models: ["丰田埃尔法"] });
  assert.deepEqual(logs[1].after, { power: "ev", combos: [{ passengers: 6, luggage: 3 }], sample_models: [] });
});

const CHILD_SEAT = { code: "ADD-CHILD_SEAT", categories: ["charter", "airport_transfer"], charge_unit: "per_item", name: { zh: "儿童座椅", en: "Child seat" }, description: { zh: "适合 1 到 4 岁" } };

test("附加服务：新增、校验、修改（编码不能改）、停用启用，都有审计", async () => {
  const addon = await created("addons", CHILD_SEAT);
  assert.deepEqual(addon.categories, ["airport_transfer", "charter"], "品类按固定顺序保存");
  assert.deepEqual([addon.charge_unit, addon.name, addon.description, addon.status, addon.version], ["per_item", CHILD_SEAT.name, CHILD_SEAT.description, "active", 1]);
  const bare = await created("addons", { code: "ADD-WIFI", categories: ["charter"], charge_unit: "per_order", name: { en: "Wi-Fi" } });
  assert.deepEqual(bare.description, {});

  const cases: [string, Record<string, unknown>, string][] = [
    ["编码格式不对", { code: "CHILD_SEAT" }, "/code"],
    ["编码小写", { code: "ADD-child_seat" }, "/code"],
    ["品类为空", { categories: [] }, "/categories"],
    ["品类不存在", { categories: ["bus"] }, "/categories/0"],
    ["计费方式不存在", { charge_unit: "per_km" }, "/charge_unit"],
    ["没有名称", { name: {} }, "/name"],
    ["说明用了不支持的语言", { description: { de: "Kindersitz" } }, "/description"],
  ];
  for (const [label, override, path] of cases) {
    const res = await post("addons", { ...CHILD_SEAT, code: "ADD-OTHER", ...override });
    assert.ok(issuePaths(res).includes(path), `${label}：${res.text}`);
  }
  assert.equal((await post("addons", CHILD_SEAT)).body.error.code, "CODE_TAKEN");

  assert.deepEqual((await patch(`addons/${addon.id}`, 1, { code: "ADD-BABY_SEAT" })).body.error.details, { fields: ["code"] });
  // 同一组品类换个顺序提交，不算修改
  assert.equal((await patch(`addons/${addon.id}`, 1, { categories: ["charter", "airport_transfer"] })).body.version, 1);
  const updated = await patch(`addons/${addon.id}`, 1, { categories: ["point_to_point", "charter", "airport_transfer"], charge_unit: "per_person", description: {} });
  assert.deepEqual([updated.body.categories, updated.body.charge_unit, updated.body.description, updated.body.version], [["airport_transfer", "charter", "point_to_point"], "per_person", {}, 2]);
  assert.equal((await post(`addons/${addon.id}/disable`, undefined)).body.status, "disabled");
  assert.deepEqual((await get("addons?status=active")).body.items.map((item: any) => item.code), ["ADD-WIFI"]);

  const logs = await audit("addon", addon.id);
  assert.deepEqual(logs.map((log) => log.action), ["create", "update", "disable"]);
  assert.deepEqual(logs[1].before, { categories: ["airport_transfer", "charter"], charge_unit: "per_item", description: { zh: "适合 1 到 4 岁" } });
});

test("两个人同时改同一条：只有一个成功，另一个得到 409，不会互相覆盖", async () => {
  const city = await newCity();
  const [first, second] = await Promise.all([
    patch(`cities/${city.id}`, 1, { name: { zh: "甲改的" } }),
    patch(`cities/${city.id}`, 1, { name: { zh: "乙改的" } }),
  ]);
  assert.deepEqual([first.status, second.status].sort(), [200, 409]);
  const stored = (await get(`cities/${city.id}`)).body;
  assert.equal(stored.version, 2);
  assert.deepEqual(stored.name, (first.status === 200 ? first : second).body.name);
  assert.equal((await audit("city", city.id)).length, 2);
});

test("主数据的审计日志是平台级的：不属于任何租户，租户的操作日志里看不到", async () => {
  const tenant = await api.tenantWithAdmin(root, "某车队", "admin@fleet.test");
  await newCity();
  const rows = await api.db.owner.query("select count(*)::int as n from audit_logs where resource in ('city', 'place', 'vehicle_group', 'addon') and tenant_id is not null");
  assert.equal(rows.rows[0].n, 0);
  const logs = await api.call("GET", "/tenant/v1/audit-logs?resource=city", { token: tenant.adminToken });
  assert.deepEqual(logs.body.items, []);
});

test("提示是中文：坐标是无穷大（1e999）时说「必须是有限的数字」", async () => {
  const res = await api.app.inject({
    method: "POST",
    url: "/platform/v1/master/cities",
    headers: { authorization: `Bearer ${editor}`, "content-type": "application/json" },
    payload: '{"code":"CTY-JP-INF","country_code":"JP","name":{"zh":"x"},"timezone":"Asia/Tokyo","center":{"lng":1e999,"lat":1}}',
  });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.json().error.details.issues, [{ path: "/center/lng", message: "必须是有限的数字" }]);
});

test("两次导入不能同时进行：另一次正在运行时，后到的立即得到明确的提示，什么都不写；试运行不受影响", async () => {
  const header = "id,ident,type,name,latitude_deg,longitude_deg,iso_country,scheduled_service,iata_code";
  const selection = selectAirports(`${header}\n900101,TST2,large_airport,Test Busy Airport,33.1,130.1,JP,yes,ZBZ\n`, ["JP"]);
  await withPlatformTx(api.db.pool, async (db) => {
    assert.equal(await tryLockAirportImport(db), true);
    await assert.rejects(
      importAirports(api.db.pool, selection, api.clock.now(), { dryRun: false }),
      (err: unknown) => err instanceof AirportImportError && err.code === "IMPORT_ALREADY_RUNNING" && /另一个机场导入正在运行/.test(err.message),
    );
    const plan = await importAirports(api.db.pool, selection, api.clock.now(), { dryRun: true });
    assert.equal(plan.creates.length, 1);
  });
  assert.deepEqual((await get("places?code=ZBZ")).body.items, []);
  // 锁随事务结束释放：之后可以正常导入
  const plan = await importAirports(api.db.pool, selection, api.clock.now(), { dryRun: false });
  assert.equal(plan.creates.length, 1);
});
