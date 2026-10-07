/**
 * M1-08 后端新增部分的边界（测试角色补的用例）：首页统计的权限裁剪和与列表总数的一致性、
 * 「待指定城市」筛选在上百条数据下的翻页、关键字的转义、启用时指定城市的拒绝情形 / 幂等 / 并发 / 原子性、
 * 地点应答里的城市和上级不向租户多给字段。
 *
 * 全部经真实接口、真实 PostgreSQL。机场用真实的导入命令（`masterdata-import-airports.ts --file`）从这里构造的样本导入，
 * 不联网；数据都在本文件里构造，结束时连同 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLATFORM_ROLES, type PlatformRole, platformRoleCan } from "@nozomi/domain";
import { createSuperAdmin } from "./services/platform-staff.ts";
import { type ApiResponse, TEST_PASSWORD, type TenantFixture, type TestApi, createTestApi } from "./testing/api.ts";
import { testEnv } from "./testing/fixtures.ts";
import { exitWithin, startNode } from "./testing/process.ts";

const IMPORT_ENTRY = fileURLToPath(new URL("./cli/masterdata-import-airports.ts", import.meta.url));
const HEADER = "id,ident,type,name,latitude_deg,longitude_deg,iso_country,scheduled_service,iata_code";
/** 导入多少个日本机场：超过一批（200）的上限，流水线页要取第二批 */
const JP_AIRPORTS = 230;
const KR_AIRPORTS = 12;

let api: TestApi;
let root: string;
let tenantA: TenantFixture;
let tenantB: TenantFixture;
let dir: string;
const roleTokens = new Map<PlatformRole, string>();
let tokyo: any;
let osaka: any;
let seoul: any;
let closed: any;

const get = (url: string, token = root): Promise<ApiResponse> => api.call("GET", url, { token });
const enable = (id: string, body?: unknown, token = root): Promise<ApiResponse> =>
  api.call("POST", `/platform/v1/master/places/${id}/enable`, { token, ...(body === undefined ? {} : { body }) });

async function create(path: string, body: unknown): Promise<any> {
  api.clock.advance(1_000);
  const res = await api.call("POST", `/platform/v1/master/${path}`, { token: root, body });
  assert.equal(res.status, 201, res.text);
  return res.body;
}

/** 三个大写字母的编码：第 n 个。前缀字母区分国家，保证不重复。 */
function iata(prefix: string, n: number): string {
  return `${prefix}${String.fromCharCode(65 + Math.floor(n / 26))}${String.fromCharCode(65 + (n % 26))}`;
}

async function importSample(country: string, rows: { id: number; code: string; name: string }[]): Promise<void> {
  const file = join(dir, `${country}-${rows[0]?.id ?? 0}.csv`);
  const lines = rows.map((row) => [row.id, `X${row.code}`, "large_airport", `"${row.name}"`, 35 + (row.id % 100) / 1000, 139 + (row.id % 100) / 1000, country, "yes", row.code].join(","));
  await writeFile(file, `${[HEADER, ...lines].join("\n")}\n`, "utf8");
  const running = startNode(IMPORT_ENTRY, testEnv(api.db.url), ["--country", country, "--file", file]);
  const code = await exitWithin(running, 60_000);
  if (code === "timeout") running.child.kill("SIGKILL");
  assert.equal(code, 0, running.output());
}

async function placeRow(id: string): Promise<{ city_id: string | null; status: string; version: number }> {
  return (await api.db.owner.query("select city_id, status, version from places where id = $1", [id])).rows[0];
}

async function auditCount(resourceId: string): Promise<number> {
  return (await api.db.owner.query("select count(*)::int as n from audit_logs where resource_id = $1", [resourceId])).rows[0].n;
}

/** 取一个还没有城市的导入机场（每条用例用不同的，互不影响）。 */
let nextPending = 0;
async function pendingAirport(country = "JP"): Promise<any> {
  const res = await get(`/platform/v1/master/places?type=airport&city_id=none&country_code=${country}&limit=200`);
  assert.equal(res.status, 200, res.text);
  const item = res.body.items[nextPending % res.body.items.length];
  nextPending += 1;
  assert.ok(item, "还有待指定城市的机场");
  return item;
}

before(async () => {
  api = await createTestApi();
  root = await api.superAdminToken();
  dir = await mkdtemp(join(tmpdir(), "nozomi-m108-"));
  roleTokens.set("super_admin", root);
  for (const { key } of PLATFORM_ROLES) {
    if (key === "super_admin") continue;
    const email = `${key.replaceAll("_", "-")}@platform.test`;
    const invited = await api.call("POST", "/platform/v1/staff", { token: root, body: { email, name: key, role: key } });
    assert.equal(invited.status, 201, invited.text);
    const accepted = await api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.body.invite.token, password: TEST_PASSWORD } });
    assert.equal(accepted.status, 200, accepted.text);
    const login = await api.call("POST", "/platform/v1/auth/login", { body: { email, password: TEST_PASSWORD }, ip: `10.8.0.${roleTokens.size + 1}` });
    assert.equal(login.status, 200, login.text);
    roleTokens.set(key, login.body.access_token as string);
  }
  tenantA = await api.tenantWithAdmin(root, "甲车队", "admin@a.test");
  tenantB = await api.tenantWithAdmin(root, "乙车队", "admin@b.test");

  const jp = { country_code: "JP", timezone: "Asia/Tokyo", center: { lng: 139.767125, lat: 35.681236 } };
  tokyo = await create("cities", { ...jp, code: "CTY-JP-TYO", name: { zh: "东京", ja: "東京", en: "Tokyo" } });
  osaka = await create("cities", { ...jp, code: "CTY-JP-OSA", name: { zh: "大阪" } });
  closed = await create("cities", { ...jp, code: "CTY-JP-OLD", name: { zh: "旧城" } });
  assert.equal((await api.call("POST", `/platform/v1/master/cities/${closed.id}/disable`, { token: root })).status, 200);
  seoul = await create("cities", { code: "CTY-KR-SEL", country_code: "KR", timezone: "Asia/Seoul", center: { lng: 126.978, lat: 37.5665 }, name: { zh: "首尔" } });

  await importSample("JP", Array.from({ length: JP_AIRPORTS }, (_, n) => ({ id: 910000 + n, code: iata("J", n), name: `Sample Airport ${String(n).padStart(3, "0")}` })));
  await importSample("KR", Array.from({ length: KR_AIRPORTS }, (_, n) => ({ id: 920000 + n, code: iata("K", n), name: `Sample 100%_Korea \\ Airport ${n}` })));
});

after(async () => {
  await rm(dir, { recursive: true, force: true });
  await api.close();
});

/* ───────────── 首页统计 ───────────── */

test("首页统计的权限裁剪：十个平台角色各调一次——有 tenant.read 的才有供应商数量，主数据人人都有；应答里只有约定的字段", async () => {
  for (const { key } of PLATFORM_ROLES) {
    const res = await get("/platform/v1/dashboard/summary", roleTokens.get(key) as string);
    assert.equal(res.status, 200, `${key}: ${res.text}`);
    assert.deepEqual(Object.keys(res.body).sort(), ["master_data", "tenants"], key);
    assert.equal(res.body.tenants !== null, platformRoleCan(key, "tenant.read"), `${key} 的供应商数量`);
    if (res.body.tenants !== null) assert.deepEqual(Object.keys(res.body.tenants).sort(), ["active", "suspended", "total"], key);
    assert.deepEqual(Object.keys(res.body.master_data).sort(), ["addons", "cities", "places", "vehicle_groups"], key);
    assert.deepEqual(Object.keys(res.body.master_data.places).sort(), ["active", "airports_without_city", "by_type", "disabled", "total"], key);
    assert.doesNotMatch(res.text, /甲车队|乙车队|admin@|Sample Airport|CTY-|东京/, `${key}：只有数量，没有明细`);
  }
});

test("首页统计：租户令牌（两个租户、各角色都一样）、没有令牌、伪造的令牌都进不来；租户一侧没有这个接口", async () => {
  for (const token of [tenantA.adminToken, tenantB.adminToken, "not-a-token", `${root}x`]) {
    assert.equal((await get("/platform/v1/dashboard/summary", token)).status, 401);
  }
  assert.equal((await api.call("GET", "/platform/v1/dashboard/summary")).status, 401);
  assert.equal((await get("/tenant/v1/dashboard/summary", tenantA.adminToken)).status, 404);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"] as const) {
    const res = await api.call(method, "/platform/v1/dashboard/summary", { token: root, body: {} });
    assert.ok(res.status === 404 || res.status === 405, `${method} 不是写接口，实际 ${res.status}`);
  }
});

test("首页统计与列表总数一致：各类主数据的启用 / 停用、地点按类型、待指定城市的机场，逐项和列表接口的 total 对上", async () => {
  // 让各类都有启用和停用两种
  const airport = await pendingAirport();
  assert.equal((await enable(airport.id, { city_id: tokyo.id })).status, 200);
  const station = await create("places", { type: "station", code: "STN-JP-EDGE", city_id: tokyo.id, category: "rail", name: { zh: "边界站" }, location: { lng: 139.7, lat: 35.6 } });
  const exit = await create("places", { type: "exit", code: "STN-JP-EDGE-E1", parent_id: station.id, name: { zh: "东口" }, location: { lng: 139.7, lat: 35.6 } });
  assert.equal((await api.call("POST", `/platform/v1/master/places/${exit.id}/disable`, { token: root })).status, 200);
  await create("places", { type: "poi", code: "POI-EDGE1", city_id: osaka.id, category: "hotel", name: { zh: "边界酒店" }, location: { lng: 135.5, lat: 34.7 } });
  await create("vehicle-groups", { code: "VG-ECO-4", grade: "economy", seats: 4, power: "fuel", name: { zh: "经济四座" }, combos: [{ passengers: 3, luggage: 2 }] });
  const addon = await create("addons", { code: "ADD-EDGE", categories: ["charter"], charge_unit: "per_order", name: { zh: "边界服务" } });
  assert.equal((await api.call("POST", `/platform/v1/master/addons/${addon.id}/disable`, { token: root })).status, 200);

  const summary = (await get("/platform/v1/dashboard/summary")).body.master_data;
  const total = async (path: string, query: string): Promise<number> => {
    const res = await get(`/platform/v1/master/${path}?limit=1${query === "" ? "" : `&${query}`}`);
    assert.equal(res.status, 200, res.text);
    return res.body.total;
  };
  for (const [name, path] of [["cities", "cities"], ["vehicle_groups", "vehicle-groups"], ["addons", "addons"]] as const) {
    assert.deepEqual(summary[name], { total: await total(path, ""), active: await total(path, "status=active"), disabled: await total(path, "status=disabled") }, name);
  }
  for (const type of ["airport", "station", "poi", "terminal", "exit"]) {
    assert.deepEqual(
      summary.places.by_type[type],
      { total: await total("places", `type=${type}`), active: await total("places", `type=${type}&status=active`), disabled: await total("places", `type=${type}&status=disabled`) },
      type,
    );
  }
  assert.deepEqual([summary.places.total, summary.places.active, summary.places.disabled], [await total("places", ""), await total("places", "status=active"), await total("places", "status=disabled")]);
  assert.equal(summary.places.airports_without_city, await total("places", "type=airport&city_id=none"), "首页的提醒数量 = 流水线页的「还剩」");
  assert.equal(summary.places.airports_without_city, JP_AIRPORTS + KR_AIRPORTS - 1);
  assert.equal(summary.cities.disabled, 1);
  assert.equal(summary.places.by_type.exit.disabled, 1);
});

/* ───────────── 列表：待指定城市、翻页、关键字 ───────────── */

test("待指定城市的机场超过一批（200 条）：同一时刻导入的记录创建时间相同，按游标翻完不重不漏，每一页的 total 都一样", async () => {
  const expected = (await get("/platform/v1/master/places?type=airport&city_id=none&country_code=JP&limit=1")).body.total as number;
  assert.ok(expected > 200, `样本要超过一批，实际 ${expected}`);
  for (const limit of [200, 50, 7]) {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: ApiResponse = await get(`/platform/v1/master/places?type=airport&city_id=none&country_code=JP&status=all&limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      assert.equal(res.status, 200, res.text);
      assert.equal(res.body.total, expected, `每页 ${limit} 条、第 ${pages + 1} 页的 total`);
      assert.ok(res.body.items.length <= limit);
      assert.ok(res.body.items.every((item: any) => item.city_id === null && item.city === null && item.status === "disabled" && item.country_code === "JP"));
      seen.push(...res.body.items.map((item: any) => item.id));
      cursor = res.body.next_cursor;
      pages += 1;
    } while (cursor !== null);
    assert.equal(pages, Math.ceil(expected / limit), `每页 ${limit} 条的页数`);
    assert.equal(seen.length, expected, `每页 ${limit} 条：不多不少`);
    assert.equal(new Set(seen).size, expected, `每页 ${limit} 条：没有重复`);
  }
});

test("翻页途中前面的记录被处理掉（指定了城市）：后面的页不重不漏，total 跟着减少", async () => {
  const query = "/platform/v1/master/places?type=airport&city_id=none&country_code=JP&limit=20";
  const first = (await get(query)).body;
  const victims = first.items.slice(0, 5);
  for (const victim of victims) assert.equal((await enable(victim.id, { city_id: osaka.id })).status, 200);
  const second = (await get(`${query}&cursor=${encodeURIComponent(first.next_cursor)}`)).body;
  assert.equal(second.total, first.total - 5);
  const firstIds = new Set(first.items.map((item: any) => item.id));
  assert.ok(second.items.every((item: any) => !firstIds.has(item.id)), "第二页不和第一页重复");
  const refreshed = (await get(query)).body;
  assert.ok(refreshed.items.every((item: any) => !victims.some((victim: any) => victim.id === item.id)), "处理掉的不再出现在待指定城市里");
  assert.equal(refreshed.items[0].id, first.items[5].id, "第一页从没处理的第一个开始");
});

test("待指定城市和其他条件的组合：国家、状态、关键字、上级、编码；写错的值一律 400，不当成「没有条件」", async () => {
  const total = async (query: string, token = root, base = "/platform/v1/master/places"): Promise<number> => {
    const res = await get(`${base}?limit=1&${query}`, token);
    assert.equal(res.status, 200, `${query}: ${res.text}`);
    return res.body.total;
  };
  assert.equal(await total("city_id=none&country_code=KR"), KR_AIRPORTS);
  assert.equal(await total("city_id=none&country_code=KR&type=airport&status=disabled"), KR_AIRPORTS);
  assert.equal(await total("city_id=none&country_code=KR&status=active"), 0);
  assert.equal(await total("city_id=none&country_code=US"), 0);
  assert.equal(await total(`city_id=none&parent_id=${tokyo.id}`), 0, "有上级的地点不可能没有城市");
  assert.equal(await total(`city_id=none&code=${iata("K", 3)}`), 1);
  assert.equal(await total(`city_id=none&country_code=KR&q=${encodeURIComponent("airport 1")}`), 3, "airport 1、10、11");
  assert.equal(await total(`city_id=${tokyo.id}&type=airport`), 1);
  assert.equal(await total(`city_id=${tokyo.id}&type=airport&country_code=KR`), 0);
  // 租户默认只看启用中的：待指定城市的机场都是停用的，默认看不到
  assert.equal(await total("city_id=none", tenantA.adminToken, "/tenant/v1/master/places"), 0);
  for (const bad of ["city_id=none&city_id=none", `city_id=none&city_id=${tokyo.id}`, "city_id=None", "city_id=%20none", "city_id=none%20", "city_id=undefined", "country_code=jp", "country_code=JPN", "status=enabled", "type=airports", "limit=0", "limit=201", "limit=abc", "cursor=not-a-cursor"]) {
    const res = await get(`/platform/v1/master/places?${bad}`);
    assert.equal(res.status, 400, `${bad} 应该是 400，实际 ${res.status} ${res.text.slice(0, 120)}`);
    assert.equal(res.body.error.code, "VALIDATION_FAILED", bad);
  }
});

test("关键字里的特殊字符按字面匹配：% _ \\ 引号、空格、表情、SQL 片段；不匹配 JSON 的键名；长度按 100 个字符卡", async () => {
  const codes = async (keyword: string, extra = ""): Promise<string[]> => {
    const res = await get(`/platform/v1/master/places?limit=200&country_code=KR&q=${encodeURIComponent(keyword)}${extra}`);
    assert.equal(res.status, 200, `${keyword}: ${res.text}`);
    assert.equal(res.body.total, res.body.items.length, keyword);
    return res.body.items.map((item: any) => item.code);
  };
  assert.equal((await codes("100%_Korea")).length, KR_AIRPORTS);
  assert.equal((await codes("100%")).length, KR_AIRPORTS);
  assert.equal((await codes("%_")).length, KR_AIRPORTS);
  assert.equal((await codes("\\")).length, KR_AIRPORTS, "反斜杠按字面匹配");
  assert.equal((await codes("\\ Airport")).length, KR_AIRPORTS);
  assert.deepEqual(await codes("\\%"), [], "「\\%」不是「任意字符」");
  assert.deepEqual(await codes("100_"), [], "_ 不是通配符");
  assert.deepEqual(await codes("1%0"), [], "% 不是通配符");
  assert.deepEqual(await codes("%%"), []);
  assert.equal((await codes("KOREA \\ AIRPORT 1")).length, 3, "不分大小写，中间的空格保留");
  assert.deepEqual(await codes("Korea  \\"), [], "两个空格和一个空格不一样");
  for (const harmless of ["' or '1'='1", "'; drop table places; --", '"', "$1", "\\\\", "😀", "​", "（", "*", "?", "[a-z]", "^S", "en", "zh", "name", "{"]) {
    const res = await get(`/platform/v1/master/places?limit=1&country_code=KR&q=${encodeURIComponent(harmless)}`);
    assert.equal(res.status, 200, `${JSON.stringify(harmless)}: ${res.text}`);
    assert.equal(res.body.total, 0, `${JSON.stringify(harmless)} 不应该匹配到任何机场`);
  }
  assert.equal((await get("/platform/v1/master/places?limit=1")).status, 200, "表还在");

  // 名称里有表情、中日韩文字、HTML 的记录能按原文搜到
  const emoji = await create("places", { type: "poi", code: "POI-EMOJI1", city_id: seoul.id, category: "mall", name: { zh: "明洞😀商场", ko: "명동 쇼핑몰", en: "<b>Myeongdong</b> & Mall" }, location: { lng: 126.98, lat: 37.56 }, address: "<script>alert(1)</script>" });
  assert.deepEqual(await codes("😀"), ["POI-EMOJI1"]);
  assert.deepEqual(await codes("명동"), ["POI-EMOJI1"]);
  assert.deepEqual(await codes("<b>myeong"), ["POI-EMOJI1"]);
  assert.deepEqual(await codes("& mall"), ["POI-EMOJI1"]);
  assert.deepEqual(await codes("script"), [], "地址不在搜索范围内");
  assert.equal(emoji.address, "<script>alert(1)</script>", "HTML 原样存取，不改写");

  const hundred = "x".repeat(100);
  assert.equal((await get(`/platform/v1/master/places?q=${hundred}`)).status, 200);
  assert.equal((await get(`/platform/v1/master/places?q=${encodeURIComponent(` ${hundred} `)}`)).status, 200, "首尾空格去掉后正好 100 个");
  assert.equal((await get(`/platform/v1/master/places?q=${hundred}x`)).status, 400);
  assert.equal((await get(`/platform/v1/master/places?q=${encodeURIComponent("😀".repeat(50))}`)).status, 200, "50 个表情是 100 个 UTF-16 单位");
  const broken = await get("/platform/v1/master/places?country_code=KR&q=%ED%A0%80");
  assert.ok(broken.status === 400 || (broken.status === 200 && broken.body.total === 0), `不合法的 UTF-8 字节：不能是 500，也不能匹配到东西，实际 ${broken.status}`);
  assert.equal((await get("/platform/v1/master/places?q=a&q=b")).status, 400, "重复的参数");
});

/* ───────────── 启用时指定城市 ───────────── */

test("启用时指定城市——权限：只有主数据运营和超级管理员能做；其余八个角色、租户、没带令牌的都被拒绝，机场原样不动、没有审计", async () => {
  const airport = await pendingAirport();
  const before = await placeRow(airport.id);
  for (const { key } of PLATFORM_ROLES) {
    if (platformRoleCan(key, "master_data.manage")) continue;
    const res = await enable(airport.id, { city_id: tokyo.id }, roleTokens.get(key) as string);
    assert.deepEqual([res.status, res.body.error.code], [403, "FORBIDDEN"], key);
  }
  for (const token of [tenantA.adminToken, tenantB.adminToken]) assert.equal((await enable(airport.id, { city_id: tokyo.id }, token)).status, 401);
  assert.equal((await api.call("POST", `/platform/v1/master/places/${airport.id}/enable`, { body: { city_id: tokyo.id } })).status, 401);
  for (const method of ["POST", "PATCH", "PUT"] as const) {
    const res = await api.call(method, `/tenant/v1/master/places/${airport.id}/enable`, { token: tenantA.adminToken, body: { city_id: tokyo.id } });
    assert.equal(res.status, 404, `租户一侧没有写接口（${method}）`);
  }
  assert.deepEqual(await placeRow(airport.id), before);
  assert.equal(await auditCount(airport.id), 1, "只有导入时的那一条");

  const operator = await enable(airport.id, { city_id: tokyo.id }, roleTokens.get("master_data") as string);
  assert.deepEqual([operator.status, operator.body.status, operator.body.city.code], [200, "active", "CTY-JP-TYO"]);
});

test("启用时指定城市——必须先改密码的账号被挡在外面（列表、首页统计、启用都是），什么都没写", async () => {
  await createSuperAdmin(api.db.pool, { email: "temp@platform.test", name: "临时密码超管", password: "Tmp7k-Qw3zR-9vBn2-XyLp4", temporaryPassword: true }, api.clock.now());
  const login = await api.call("POST", "/platform/v1/auth/login", { body: { email: "temp@platform.test", password: "Tmp7k-Qw3zR-9vBn2-XyLp4" }, ip: "10.9.0.1" });
  assert.equal(login.status, 200, login.text);
  assert.equal(login.body.must_change_password, true);
  const token = login.body.access_token as string;
  const airport = await pendingAirport();
  const before = await placeRow(airport.id);
  const blocked: ApiResponse[] = [
    await get("/platform/v1/dashboard/summary", token),
    await get("/platform/v1/master/places?type=airport&city_id=none&q=sample", token),
    await get(`/platform/v1/master/places/${airport.id}`, token),
    await enable(airport.id, { city_id: tokyo.id }, token),
    await api.call("PATCH", `/platform/v1/master/places/${airport.id}`, { token, body: { city_id: tokyo.id }, headers: { "if-match": `"${airport.version}"` } }),
    await api.call("POST", "/platform/v1/master/cities", { token, body: { code: "CTY-JP-TMP", country_code: "JP", timezone: "Asia/Tokyo", center: { lng: 139, lat: 35 }, name: { zh: "临时" } } }),
  ];
  for (const res of blocked) {
    assert.deepEqual([res.status, res.body.error.code], [403, "PASSWORD_CHANGE_REQUIRED"]);
    assert.doesNotMatch(res.text, /Sample Airport|total|airports_without_city/, "被挡住的应答里没有任何数据");
  }
  assert.deepEqual(await placeRow(airport.id), before);
  assert.equal((await get("/platform/v1/master/cities?code=CTY-JP-TMP")).body.total, 0);
});

test("启用时指定城市——请求体写错的各种样子都是 400，机场原样不动；多余的字段被忽略而不是被写进去", async () => {
  const airport = await pendingAirport();
  const before = await placeRow(airport.id);
  const bodies: unknown[] = [
    { city_id: null },
    { city_id: "" },
    { city_id: "none" },
    { city_id: 123 },
    { city_id: [tokyo.id] },
    { city_id: { id: tokyo.id } },
    { city_id: ` ${tokyo.id}` },
    { city_id: `${tokyo.id}\u0000` },
    { city_id: airport.id },
  ];
  for (const body of bodies) {
    const res = await enable(airport.id, body);
    assert.equal(res.status, 400, `${JSON.stringify(body)} 应该是 400，实际 ${res.status} ${res.text.slice(0, 160)}`);
    assert.equal(res.body.error.code, "VALIDATION_FAILED");
  }
  const text = await api.app.inject({ method: "POST", url: `/platform/v1/master/places/${airport.id}/enable`, headers: { authorization: `Bearer ${root}`, "content-type": "application/json" }, payload: "{city_id:" });
  assert.equal(text.statusCode, 400, "不是 JSON");
  assert.deepEqual(await placeRow(airport.id), before);
  assert.equal(await auditCount(airport.id), 1);

  // 多余的字段：不能借启用接口改名字、改状态、改版本号、换国家
  const res = await enable(airport.id, { city_id: tokyo.id, name: { zh: "被夹带的名字" }, status: "disabled", version: 99, country_code: "KR", source: null, code: "ZZZ" });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual([res.body.status, res.body.name, res.body.version, res.body.country_code, res.body.code, res.body.source.overridden], ["active", airport.name, airport.version + 1, "JP", airport.code, false]);
});

test("启用时指定城市——别人已经处理过这个机场：同一个城市再来一次原样返回（幂等、不多写审计）；换成别的城市被拒绝并说明原因", async () => {
  const airport = await pendingAirport();
  const first = await enable(airport.id, { city_id: tokyo.id });
  assert.equal(first.status, 200, first.text);
  const audits = await auditCount(airport.id);
  for (let round = 0; round < 3; round += 1) {
    const again = await enable(airport.id, { city_id: tokyo.id });
    assert.deepEqual([again.status, again.body], [200, first.body], "重复提交：原样返回");
  }
  assert.equal(await auditCount(airport.id), audits, "重复提交不多写审计、不涨版本号");

  const other = await enable(airport.id, { city_id: osaka.id });
  assert.deepEqual([other.status, other.body.error.code, other.body.error.details.issues[0].path], [400, "VALIDATION_FAILED", "/city_id"]);
  assert.match(other.body.error.details.issues[0].message, /已经有所属城市/);
  assert.equal((await placeRow(airport.id)).city_id, tokyo.id);

  // 别人只保存了城市、没有启用：带同一个城市启用可以；带别的城市被拒绝，状态和城市都不变
  const saved = await pendingAirport();
  const patched = await api.call("PATCH", `/platform/v1/master/places/${saved.id}`, { token: root, body: { city_id: osaka.id }, headers: { "if-match": `"${saved.version}"` } });
  assert.equal(patched.status, 200, patched.text);
  const wrong = await enable(saved.id, { city_id: tokyo.id });
  assert.equal(wrong.status, 400);
  assert.deepEqual(await placeRow(saved.id), { city_id: osaka.id, status: "disabled", version: saved.version + 1 });
  const right = await enable(saved.id, { city_id: osaka.id });
  assert.deepEqual([right.status, right.body.status, right.body.city_id], [200, "active", osaka.id]);
});

test("启用时指定城市——并发：两个人同时给同一个机场指定不同的城市，只有一个成功，另一个被明确拒绝；结果和审计对得上", async () => {
  for (let round = 0; round < 5; round += 1) {
    const airport = await pendingAirport();
    const [a, b] = await Promise.all([enable(airport.id, { city_id: tokyo.id }), enable(airport.id, { city_id: osaka.id })]);
    const statuses = [a.status, b.status].sort();
    assert.deepEqual(statuses, [200, 400], `第 ${round + 1} 轮：${a.text.slice(0, 100)} / ${b.text.slice(0, 100)}`);
    const winner = a.status === 200 ? a : b;
    const row = await placeRow(airport.id);
    assert.deepEqual(row, { city_id: winner.body.city_id, status: "active", version: airport.version + 1 });
    assert.equal(await auditCount(airport.id), 2, "导入一条 + 启用一条");
  }
});

test("启用时指定城市——并发：同一个请求同时发两次（连点两下），两次都成功、内容一样，只写一条审计、版本号只加一", async () => {
  for (let round = 0; round < 5; round += 1) {
    const airport = await pendingAirport();
    const results = await Promise.all([1, 2, 3].map(() => enable(airport.id, { city_id: tokyo.id })));
    assert.deepEqual(results.map((res) => res.status), [200, 200, 200]);
    assert.deepEqual(results[1]?.body, results[0]?.body);
    assert.deepEqual(results[2]?.body, results[0]?.body);
    assert.deepEqual(await placeRow(airport.id), { city_id: tokyo.id, status: "active", version: airport.version + 1 });
    assert.equal(await auditCount(airport.id), 2);
  }
});

test("启用时指定城市——并发：启用的同时城市被停用，无论谁先谁后都不会留下「启用的机场挂在停用的城市下」", async () => {
  for (let round = 0; round < 6; round += 1) {
    const city = await create("cities", { code: `CTY-JP-RACE${round}`, country_code: "JP", timezone: "Asia/Tokyo", center: { lng: 139, lat: 35 }, name: { zh: `并发城${round}` } });
    const airport = await pendingAirport();
    const [enabled, disabled] = await Promise.all([
      enable(airport.id, { city_id: city.id }),
      api.call("POST", `/platform/v1/master/cities/${city.id}/disable`, { token: root }),
    ]);
    assert.ok([200, 409].includes(enabled.status), enabled.text);
    assert.ok([200, 409].includes(disabled.status), disabled.text);
    const row = await placeRow(airport.id);
    const cityStatus = (await api.db.owner.query("select status from cities where id = $1", [city.id])).rows[0].status;
    assert.ok(!(row.status === "active" && cityStatus === "disabled"), `第 ${round + 1} 轮：启用的机场挂在了停用的城市下`);
    if (enabled.status === 200) {
      assert.deepEqual([disabled.status, disabled.body.error?.code], [409, "MASTER_DATA_IN_USE"]);
      assert.deepEqual(row, { city_id: city.id, status: "active", version: airport.version + 1 });
    } else {
      assert.deepEqual(enabled.body.error.details, { reason: "CITY_DISABLED" });
      assert.deepEqual(row, { city_id: null, status: "disabled", version: airport.version }, "被拒绝的启用没有把城市写进去");
    }
  }
});

test("启用时指定城市——并发：一个人启用并指定城市，另一个人带着旧版本号改名字：后到的那个被版本号拦下，不会悄悄盖掉", async () => {
  const airport = await pendingAirport();
  const done = await enable(airport.id, { city_id: tokyo.id });
  assert.equal(done.status, 200);
  const stale = await api.call("PATCH", `/platform/v1/master/places/${airport.id}`, { token: root, body: { city_id: osaka.id, name: { zh: "后到的修改" } }, headers: { "if-match": `"${airport.version}"` } });
  assert.deepEqual([stale.status, stale.body.error.code], [409, "VERSION_CONFLICT"]);
  assert.equal((await placeRow(airport.id)).city_id, tokyo.id);
});

test("启用接口对城市、车型组、附加服务不认 city_id：带了也只是启用，不报错、不写多余的东西", async () => {
  const res = await api.call("POST", `/platform/v1/master/cities/${closed.id}/enable`, { token: root, body: { city_id: tokyo.id, name: { zh: "夹带" } } });
  assert.deepEqual([res.status, res.body.status, res.body.name], [200, "active", { zh: "旧城" }]);
  assert.equal((await api.call("POST", `/platform/v1/master/cities/${closed.id}/disable`, { token: root })).status, 200);
});

/* ───────────── 地点应答里的城市和上级 ───────────── */

test("地点应答里的 city / parent：只有编号、编码、名称（上级另有类型）；租户看到的没有来源信息，也没有城市的状态、时区、坐标", async () => {
  const station = (await get("/platform/v1/master/places?code=STN-JP-EDGE")).body.items[0];
  const exit = (await get("/platform/v1/master/places?code=STN-JP-EDGE-E1&status=all")).body.items[0];
  const imported = (await get(`/platform/v1/master/places?type=airport&city_id=${tokyo.id}&limit=1`)).body.items[0];
  for (const [base, token] of [["/platform/v1", root], ["/tenant/v1", tenantA.adminToken], ["/tenant/v1", tenantB.adminToken]] as const) {
    const child = (await get(`${base}/master/places/${exit.id}`, token)).body;
    assert.deepEqual(child.city, { id: tokyo.id, code: "CTY-JP-TYO", name: tokyo.name }, base);
    assert.deepEqual(child.parent, { id: station.id, code: "STN-JP-EDGE", name: station.name, type: "station" }, base);
    const airport = (await get(`${base}/master/places/${imported.id}`, token)).body;
    assert.deepEqual(Object.keys(airport.city).sort(), ["code", "id", "name"], base);
    assert.equal(airport.parent, null);
    assert.equal("source" in airport, base === "/platform/v1", `${base}：来源信息只给平台`);
  }
  const tenantList = await get(`/tenant/v1/master/places?status=all&limit=200&city_id=${tokyo.id}`, tenantA.adminToken);
  assert.equal(tenantList.status, 200);
  assert.doesNotMatch(tenantList.text, /ourairports|source|overridden|synced_at/, "租户的列表里没有来源信息");
  assert.doesNotMatch(tenantList.text, /markup|加价|对外价|sale_price/, "规则 4");
  // 两个租户看到的主数据完全一样（主数据不分租户）
  const fromB = await get(`/tenant/v1/master/places?status=all&limit=200&city_id=${tokyo.id}`, tenantB.adminToken);
  assert.deepEqual(fromB.body, tenantList.body);
});

test("租户改不了主数据：两个租户的管理员对平台和租户两边的写接口都被拒绝；租户被暂停后仍然只能读（需求：暂停的租户继续履约）", async () => {
  const airport = await pendingAirport();
  const before = await placeRow(airport.id);
  for (const token of [tenantA.adminToken, tenantB.adminToken]) {
    const attempts: ApiResponse[] = [
      await api.call("POST", "/tenant/v1/master/cities", { token, body: { code: "CTY-JP-TEN", country_code: "JP", timezone: "Asia/Tokyo", center: { lng: 139, lat: 35 }, name: { zh: "租户建的" } } }),
      await api.call("PATCH", `/tenant/v1/master/places/${airport.id}`, { token, body: { city_id: tokyo.id }, headers: { "if-match": `"${airport.version}"` } }),
      await api.call("POST", `/tenant/v1/master/places/${airport.id}/disable`, { token }),
      await api.call("PATCH", `/platform/v1/master/places/${airport.id}`, { token, body: { city_id: tokyo.id }, headers: { "if-match": `"${airport.version}"` } }),
      await api.call("POST", `/platform/v1/master/cities/${tokyo.id}/disable`, { token }),
      await api.call("GET", "/platform/v1/master/places?city_id=none", { token }),
    ];
    assert.ok(attempts.every((res) => res.status === 404 || res.status === 401), attempts.map((res) => res.status).join(","));
  }
  assert.deepEqual(await placeRow(airport.id), before);
  assert.equal((await get("/platform/v1/master/cities?code=CTY-JP-TEN")).body.total, 0);

  assert.equal((await api.call("POST", `/platform/v1/tenants/${tenantB.tenantId}/suspend`, { token: root, body: { reason: "测试" } })).status, 200);
  assert.equal((await get("/tenant/v1/master/places", tenantB.adminToken)).status, 200, "暂停的租户照常能读主数据");
  const stillDenied = await api.call("POST", `/platform/v1/master/places/${airport.id}/enable`, { token: tenantB.adminToken, body: { city_id: tokyo.id } });
  assert.equal(stillDenied.status, 401);
  assert.equal((await get("/tenant/v1/master/places", tenantA.adminToken)).status, 200, "另一个租户不受影响");
  assert.deepEqual(await placeRow(airport.id), before);
});

/* ───────────── total 与并发写入 ───────────── */

test("列表在不断有人处理机场的同时反复查询：不出 500，total 只减不增，一页里的条数不超过 total", async () => {
  const query = "/platform/v1/master/places?type=airport&city_id=none&country_code=KR&limit=200";
  const pending = (await get(query)).body.items as any[];
  assert.ok(pending.length >= 8);
  const writes = pending.slice(0, 8).map((airport) => enable(airport.id, { city_id: seoul.id }));
  const reads = Array.from({ length: 16 }, () => get(query));
  const [written, read] = await Promise.all([Promise.all(writes), Promise.all(reads)]);
  assert.ok(written.every((res) => res.status === 200), written.map((res) => res.status).join(","));
  for (const res of read) {
    assert.equal(res.status, 200, res.text);
    assert.ok(res.body.total <= pending.length && res.body.total >= pending.length - 8, `total=${res.body.total}`);
    assert.ok(res.body.items.every((item: any) => item.city_id === null));
  }
  const settled = (await get(query)).body;
  assert.deepEqual([settled.total, settled.items.length], [pending.length - 8, pending.length - 8]);
  assert.equal((await get("/platform/v1/dashboard/summary")).body.master_data.places.airports_without_city, (await get("/platform/v1/master/places?type=airport&city_id=none&limit=1")).body.total);
});
