/**
 * M1-08：运营后台主数据页面要用的后端能力——首页统计、列表的总数、关键字搜索。
 * 全部经真实接口、真实 PostgreSQL；测试数据都在这里构造，结束时连同 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { selectAirports } from "@nozomi/domain";
import { importAirports } from "./services/airport-import.ts";
import { type ApiResponse, TEST_PASSWORD, type TenantFixture, type TestApi, createTestApi } from "./testing/api.ts";

let api: TestApi;
let root: string;
let finance: string;
let tenant: TenantFixture;

const get = (url: string, token = root): Promise<ApiResponse> => api.call("GET", url, { token });

async function create(path: string, body: unknown): Promise<any> {
  api.clock.advance(1_000);
  const res = await api.call("POST", `/platform/v1/master/${path}`, { token: root, body });
  assert.equal(res.status, 201, res.text);
  return res.body;
}

async function disable(path: string, id: string): Promise<void> {
  const res = await api.call("POST", `/platform/v1/master/${path}/${id}/disable`, { token: root });
  assert.equal(res.status, 200, res.text);
}

const EMPTY = { total: 0, active: 0, disabled: 0 };

before(async () => {
  api = await createTestApi();
  root = await api.superAdminToken();
  const invited = await api.call("POST", "/platform/v1/staff", { token: root, body: { email: "finance@platform.test", name: "财务", role: "finance" } });
  assert.equal(invited.status, 201, invited.text);
  const accepted = await api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.body.invite.token, password: TEST_PASSWORD } });
  assert.equal(accepted.status, 200, accepted.text);
  const login = await api.call("POST", "/platform/v1/auth/login", { body: { email: "finance@platform.test", password: TEST_PASSWORD } });
  finance = login.body.access_token as string;
});
after(() => api.close());

test("首页统计：空库里全是 0，五种地点类型都列出来；只有数量，没有明细", async () => {
  const res = await get("/platform/v1/dashboard/summary");
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.body, {
    tenants: { total: 0, active: 0, suspended: 0 },
    master_data: {
      cities: EMPTY,
      places: { ...EMPTY, by_type: { airport: EMPTY, station: EMPTY, poi: EMPTY, terminal: EMPTY, exit: EMPTY }, airports_without_city: 0 },
      vehicle_groups: EMPTY,
      addons: EMPTY,
    },
  });
});

test("首页统计：数量跟着数据变——租户按状态，主数据按启用 / 停用，地点另按类型，导入后没指定城市的机场单独数", async () => {
  tenant = await api.tenantWithAdmin(root, "甲车队", "admin@a.test");
  const other = await api.tenantWithAdmin(root, "乙车队", "admin@b.test");
  assert.equal((await api.call("POST", `/platform/v1/tenants/${other.tenantId}/suspend`, { token: root, body: {} })).status, 200);

  const city = { country_code: "JP", timezone: "Asia/Tokyo", center: { lng: 139.767125, lat: 35.681236 } };
  const tokyo = await create("cities", { ...city, code: "CTY-JP-TYO", name: { ja: "東京", zh: "东京", en: "Tokyo" } });
  await create("cities", { ...city, code: "CTY-JP-OSA", name: { ja: "大阪", zh: "大阪", en: "Osaka" } });
  const old = await create("cities", { ...city, code: "CTY-JP-OLD", name: { zh: "旧城（100%_停用）" } });
  await disable("cities", old.id);

  const location = { lng: 139.786958, lat: 35.549678 };
  const haneda = await create("places", { type: "airport", code: "HND", city_id: tokyo.id, name: { ja: "羽田空港", zh: "羽田机场", en: "Tokyo Haneda Airport" }, location });
  await create("places", { type: "terminal", code: "HND-T3", parent_id: haneda.id, name: { zh: "第 3 航站楼", en: "Terminal 3" }, location });
  const t1 = await create("places", { type: "terminal", code: "HND-T1", parent_id: haneda.id, name: { zh: "第 1 航站楼", en: "Terminal 1" }, location });
  await disable("places", t1.id);
  const station = await create("places", { type: "station", code: "STN-JP-TOKYO", city_id: tokyo.id, category: "shinkansen", name: { ja: "東京駅", zh: "东京站", en: "Tokyo Station" }, location });
  await create("places", { type: "exit", code: "STN-JP-TOKYO-E1", parent_id: station.id, name: { zh: "八重洲口" }, location });
  await create("places", { type: "poi", code: "POI-000001", city_id: tokyo.id, category: "hotel", name: { zh: "东京站大饭店", en: "The Tokyo Station Hotel" }, location, address: "东京都千代田区" });
  const header = "id,ident,type,name,latitude_deg,longitude_deg,iso_country,scheduled_service,iata_code";
  const rows = ["970001,T1,large_airport,Test Narita Airport,35.76,140.38,JP,yes,ZNA", "970002,T2,medium_airport,Test Kansai Airport,34.42,135.24,JP,yes,ZKA"];
  api.clock.advance(1_000);
  await importAirports(api.db.pool, selectAirports(`${header}\n${rows.join("\n")}\n`, ["JP"]), api.clock.now(), { dryRun: false });

  const group = { grade: "business", seats: 7, power: "fuel", combos: [{ passengers: 6, luggage: 2 }] };
  await create("vehicle-groups", { ...group, code: "VG-BIZ-7", name: { zh: "商务 7 座", en: "Business 7" } });
  const addon = { categories: ["charter"], charge_unit: "per_item" };
  await create("addons", { ...addon, code: "ADD-CHILD_SEAT", name: { zh: "儿童座椅", en: "Child seat" } });
  const wifi = await create("addons", { ...addon, code: "ADD-WIFI", name: { en: "Wi-Fi" } });
  await disable("addons", wifi.id);

  const res = await get("/platform/v1/dashboard/summary");
  assert.deepEqual(res.body, {
    tenants: { total: 2, active: 1, suspended: 1 },
    master_data: {
      cities: { total: 3, active: 2, disabled: 1 },
      places: {
        total: 8,
        active: 5,
        disabled: 3,
        by_type: {
          airport: { total: 3, active: 1, disabled: 2 },
          station: { total: 1, active: 1, disabled: 0 },
          poi: { total: 1, active: 1, disabled: 0 },
          terminal: { total: 2, active: 1, disabled: 1 },
          exit: { total: 1, active: 1, disabled: 0 },
        },
        airports_without_city: 2,
      },
      vehicle_groups: { total: 1, active: 1, disabled: 0 },
      addons: { total: 2, active: 1, disabled: 1 },
    },
  });
  assert.doesNotMatch(res.text, /甲车队|HND|东京|admin@/, "只有数量，没有任何明细");
});

test("首页统计：没有 tenant.read 的角色（财务）拿不到租户数量；租户令牌进不来；不写审计日志", async () => {
  const audits = async (): Promise<number> => (await api.db.owner.query("select count(*)::int as n from audit_logs")).rows[0].n;
  const before = await audits();
  const res = await get("/platform/v1/dashboard/summary", finance);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.tenants, null);
  assert.equal(res.body.master_data.cities.total, 3);
  assert.equal((await get("/platform/v1/dashboard/summary", tenant.adminToken)).status, 401);
  assert.equal((await api.call("GET", "/platform/v1/dashboard/summary")).status, 401);
  assert.equal(await audits(), before);
});

test("列表总数：total 是符合筛选条件的总数，和每页条数、翻到第几页无关；最后一页 next_cursor 为 null", async () => {
  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const res: ApiResponse = await get(`/platform/v1/master/places?limit=3${cursor ? `&cursor=${cursor}` : ""}`);
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(Object.keys(res.body).sort(), ["items", "next_cursor", "total"]);
    assert.equal(res.body.total, 8, "每一页的 total 都一样");
    seen.push(...res.body.items.map((item: any) => item.code));
    cursor = res.body.next_cursor;
    pages += 1;
  } while (cursor);
  assert.equal(pages, 3);
  assert.equal(new Set(seen).size, 8, "不重不漏");
  assert.deepEqual(seen.slice(0, 6), ["HND", "HND-T3", "HND-T1", "STN-JP-TOKYO", "STN-JP-TOKYO-E1", "POI-000001"], "按创建时间从早到晚");

  const totals = async (query: string): Promise<[number, number]> => {
    const res = await get(`/platform/v1/master/places?limit=1&${query}`);
    assert.equal(res.status, 200, res.text);
    return [res.body.total, res.body.items.length];
  };
  assert.deepEqual(await totals("type=airport"), [3, 1]);
  assert.deepEqual(await totals("type=airport&status=disabled"), [2, 1]);
  assert.deepEqual(await totals("type=terminal&status=active"), [1, 1]);
  assert.deepEqual(await totals("status=disabled"), [3, 1]);
  assert.deepEqual(await totals("country_code=KR"), [0, 0]);
  assert.deepEqual(await totals("type=airport&q=test"), [2, 1]);
  for (const [path, total] of [["cities", 3], ["vehicle-groups", 1], ["addons", 2]] as const) {
    assert.equal((await get(`/platform/v1/master/${path}`)).body.total, total, path);
  }
});

test("关键字搜索：编码或任意语言的名称里包含关键字，不区分大小写；和其他筛选同时生效；% 和 _ 按字面匹配", async () => {
  const codes = async (query: string, base = "/platform/v1/master/places"): Promise<string[]> => {
    const res = await get(`${base}?${query}`);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.total, res.body.items.length, query);
    return res.body.items.map((item: any) => item.code);
  };
  assert.deepEqual(await codes("q=hnd"), ["HND", "HND-T3", "HND-T1"], "编码前缀，小写也行");
  assert.deepEqual(await codes("q=TOKYO"), ["HND", "STN-JP-TOKYO", "STN-JP-TOKYO-E1", "POI-000001"], "编码或英文名里有 tokyo");
  assert.deepEqual(await codes(`q=${encodeURIComponent("羽田")}`), ["HND"], "日文名和中文名");
  assert.deepEqual(await codes(`q=${encodeURIComponent("航站楼")}`), ["HND-T3", "HND-T1"]);
  assert.deepEqual(await codes(`q=${encodeURIComponent("東京駅")}`), ["STN-JP-TOKYO"]);
  assert.deepEqual(await codes(`q=${encodeURIComponent("  terminal 3 ")}`), ["HND-T3"], "首尾空白去掉，中间的空格保留");
  assert.deepEqual(await codes("q=terminal&status=active"), ["HND-T3"]);
  assert.deepEqual((await codes("q=airport&type=airport&status=disabled")).sort(), ["ZKA", "ZNA"]);
  assert.deepEqual(await codes("q=nothing-matches-this"), []);
  // 属性值（如类型 shinkansen、地址）不在搜索范围内
  assert.deepEqual(await codes("q=shinkansen"), []);

  assert.deepEqual(await codes("q=osa", "/platform/v1/master/cities"), ["CTY-JP-OSA"]);
  assert.deepEqual(await codes(`q=${encodeURIComponent("100%")}`, "/platform/v1/master/cities"), ["CTY-JP-OLD"]);
  assert.deepEqual(await codes(`q=${encodeURIComponent("%")}`, "/platform/v1/master/cities"), ["CTY-JP-OLD"], "% 不是通配符");
  assert.deepEqual(await codes(`q=${encodeURIComponent("0%_")}`, "/platform/v1/master/cities"), ["CTY-JP-OLD"]);
  assert.deepEqual(await codes("q=_", "/platform/v1/master/cities"), ["CTY-JP-OLD"], "_ 不是通配符");
  assert.deepEqual(await codes(`q=${encodeURIComponent("\\")}`, "/platform/v1/master/cities"), []);
  assert.deepEqual(await codes("q=biz", "/platform/v1/master/vehicle-groups"), ["VG-BIZ-7"]);
  assert.deepEqual(await codes("q=business", "/platform/v1/master/vehicle-groups"), ["VG-BIZ-7"]);
  assert.deepEqual(await codes("q=wi-fi", "/platform/v1/master/addons"), ["ADD-WIFI"]);
  assert.deepEqual(await codes(`q=${encodeURIComponent("座椅")}`, "/platform/v1/master/addons"), ["ADD-CHILD_SEAT"]);

  for (const bad of ["q=", "q=%20%20", `q=${"x".repeat(101)}`, "q=%00"]) {
    const res = await get(`/platform/v1/master/places?${bad}`);
    assert.equal(res.status, 400, bad);
    assert.equal(res.body.error.code, "VALIDATION_FAILED");
  }
});

test("租户的只读列表同样有 total 和关键字搜索；默认只数启用中的", async () => {
  const list = async (query: string): Promise<[number, string[]]> => {
    const res = await get(`/tenant/v1/master/places?${query}`, tenant.adminToken);
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(Object.keys(res.body).sort(), ["items", "next_cursor", "total"]);
    return [res.body.total, res.body.items.map((item: any) => item.code)];
  };
  assert.deepEqual(await list("limit=2"), [5, ["HND", "HND-T3"]]);
  assert.deepEqual(await list("status=all&limit=1"), [8, ["HND"]]);
  assert.deepEqual(await list("q=terminal"), [1, ["HND-T3"]]);
  assert.deepEqual(await list("q=terminal&status=all"), [2, ["HND-T3", "HND-T1"]]);
  assert.equal((await get("/tenant/v1/master/addons", tenant.adminToken)).body.total, 1);
});

test("地点筛选「还没有所属城市」：city_id=none 只返回没有城市的地点，total 跟着算，可以和其他条件、关键字一起用", async () => {
  const list = async (query: string, token = root, base = "/platform/v1/master/places"): Promise<[number, string[]]> => {
    const res = await get(`${base}?${query}`, token);
    assert.equal(res.status, 200, res.text);
    return [res.body.total, res.body.items.map((item: any) => item.code).sort()];
  };
  assert.deepEqual(await list("city_id=none"), [2, ["ZKA", "ZNA"]]);
  assert.deepEqual(await list("city_id=none&limit=1").then(([total, codes]) => [total, codes.length]), [2, 1]);
  assert.deepEqual(await list("city_id=none&type=airport&status=disabled&country_code=JP"), [2, ["ZKA", "ZNA"]]);
  assert.deepEqual(await list("city_id=none&q=narita"), [1, ["ZNA"]]);
  assert.deepEqual(await list("city_id=none&status=active"), [0, []]);
  assert.deepEqual(await list("city_id=none&type=station"), [0, []]);
  assert.deepEqual(await list("city_id=none&status=all", tenant.adminToken, "/tenant/v1/master/places"), [2, ["ZKA", "ZNA"]]);
  for (const bad of ["city_id=null", "city_id=NONE", "city_id="]) {
    assert.equal((await get(`/platform/v1/master/places?${bad}`)).status, 400, bad);
  }
});

test("地点的应答里带所属城市和上级的编码、名称：列表、单条、新增、修改、启停都带；没有城市 / 上级的是 null；租户看到的一样", async () => {
  const all = (await get("/platform/v1/master/places?limit=200")).body.items as any[];
  const byCode = Object.fromEntries(all.map((item) => [item.code, item]));
  const tokyo = (await get("/platform/v1/master/cities?code=CTY-JP-TYO")).body.items[0];
  const cityRef = { id: tokyo.id, code: "CTY-JP-TYO", name: tokyo.name };
  assert.deepEqual([byCode["HND"].city, byCode["HND"].parent], [cityRef, null]);
  assert.deepEqual(byCode["HND-T3"].city, cityRef);
  assert.deepEqual(byCode["HND-T3"].parent, { id: byCode["HND"].id, code: "HND", name: byCode["HND"].name, type: "airport" });
  assert.deepEqual(byCode["STN-JP-TOKYO-E1"].parent.type, "station");
  assert.deepEqual([byCode["ZNA"].city, byCode["ZNA"].parent], [null, null]);

  assert.deepEqual((await get(`/platform/v1/master/places/${byCode["HND-T3"].id}`)).body, byCode["HND-T3"]);
  const fromTenant = (await get(`/tenant/v1/master/places/${byCode["HND-T3"].id}`, tenant.adminToken)).body;
  assert.deepEqual([fromTenant.city, fromTenant.parent], [byCode["HND-T3"].city, byCode["HND-T3"].parent]);

  const created = await create("places", { type: "terminal", code: "HND-T2", parent_id: byCode["HND"].id, name: { zh: "第 2 航站楼" }, location: { lng: 139.78, lat: 35.55 } });
  assert.deepEqual([created.city, created.parent.code], [cityRef, "HND"]);
  const patched = await api.call("PATCH", `/platform/v1/master/places/${created.id}`, { token: root, body: { name: { zh: "二号航站楼" } }, headers: { "if-match": '"1"' } });
  assert.deepEqual([patched.status, patched.body.city, patched.body.parent.code], [200, cityRef, "HND"]);
  const disabled = await api.call("POST", `/platform/v1/master/places/${created.id}/disable`, { token: root });
  assert.deepEqual([disabled.body.status, disabled.body.city, disabled.body.parent.code], ["disabled", cityRef, "HND"]);
  // 城市改了名，地点应答里的城市名称是最新的
  const renamed = await api.call("PATCH", `/platform/v1/master/cities/${tokyo.id}`, { token: root, body: { name: { ...tokyo.name, ko: "도쿄" } }, headers: { "if-match": `"${tokyo.version}"` } });
  assert.equal(renamed.status, 200, renamed.text);
  assert.equal((await get(`/platform/v1/master/places/${byCode["HND"].id}`)).body.city.name.ko, "도쿄");
});

test("指定城市并启用一次完成：启用时带 city_id，城市和状态在同一个事务里写入，审计一条；任何一步不行就什么都不变", async () => {
  const zna = (await get("/platform/v1/master/places?code=ZNA")).body.items[0];
  const tokyo = (await get("/platform/v1/master/cities?code=CTY-JP-TYO")).body.items[0];
  const old = (await get("/platform/v1/master/cities?code=CTY-JP-OLD")).body.items[0];
  const seoul = await create("cities", { code: "CTY-KR-SEL", country_code: "KR", timezone: "Asia/Seoul", center: { lng: 126.978, lat: 37.5665 }, name: { zh: "首尔" } });
  const enable = (id: string, body?: unknown): Promise<ApiResponse> => api.call("POST", `/platform/v1/master/places/${id}/enable`, { token: root, ...(body === undefined ? {} : { body }) });
  const row = async (): Promise<unknown> => (await api.db.owner.query("select city_id, status, version from places where id = $1", [zna.id])).rows[0];
  const untouched = { city_id: null, status: "disabled", version: zna.version };

  // 各种不行的情况：城市不存在、不在同一个国家、已停用、编号格式不对、不带城市
  const missing = await enable(zna.id, { city_id: "99999999-9999-4999-8999-999999999999" });
  assert.deepEqual([missing.status, missing.body.error.details.issues], [400, [{ path: "/city_id", message: "城市不存在" }]]);
  const foreign = await enable(zna.id, { city_id: seoul.id });
  assert.deepEqual([foreign.status, foreign.body.error.details.issues[0].path], [400, "/city_id"]);
  const stopped = await enable(zna.id, { city_id: old.id });
  assert.deepEqual([stopped.status, stopped.body.error.details], [409, { reason: "CITY_DISABLED" }]);
  assert.equal((await enable(zna.id, { city_id: "tokyo" })).status, 400);
  assert.deepEqual((await enable(zna.id)).body.error.details, { reason: "CITY_MISSING" });
  assert.deepEqual(await row(), untouched, "失败的请求没有留下半截状态（城市没有被写进去）");

  const ok = await enable(zna.id, { city_id: tokyo.id });
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual([ok.body.status, ok.body.city_id, ok.body.city.code, ok.body.version], ["active", tokyo.id, "CTY-JP-TYO", zna.version + 1]);
  assert.equal(ok.body.source.overridden, false, "指定城市不算改了数据源的内容");
  const logs = await api.db.owner.query("select action, before, after from audit_logs where resource = 'place' and resource_id = $1 order by id desc limit 1", [zna.id]);
  assert.deepEqual(logs.rows[0], { action: "enable", before: { status: "disabled", city_id: null }, after: { status: "active", city_id: tokyo.id } });

  // 重复提交同样的请求：原样返回；已经有城市的不能借启用接口换城市；航站楼不能指定城市
  assert.deepEqual((await enable(zna.id, { city_id: tokyo.id })).body, ok.body);
  const swap = await enable(zna.id, { city_id: old.id });
  assert.deepEqual([swap.status, swap.body.error.details.issues], [400, [{ path: "/city_id", message: "这个地点已经有所属城市；要换城市请用修改接口" }]]);
  const t1 = (await get("/platform/v1/master/places?code=HND-T1")).body.items[0];
  const child = await enable(t1.id, { city_id: old.id });
  assert.deepEqual([child.status, child.body.error.details.issues[0].path], [400, "/city_id"]);
  // 已经有城市的停用地点：不带城市照常启用，审计里没有多余的字段
  assert.equal((await enable(t1.id)).body.status, "active");
  const plain = await api.db.owner.query("select before, after from audit_logs where resource = 'place' and resource_id = $1 order by id desc limit 1", [t1.id]);
  assert.deepEqual(plain.rows[0], { before: { status: "disabled" }, after: { status: "active" } });
  // 停用接口不认 city_id
  const zka = (await get("/platform/v1/master/places?code=ZKA")).body.items[0];
  assert.equal((await api.call("POST", `/platform/v1/master/places/${zka.id}/disable`, { token: root, body: { city_id: tokyo.id } })).body.city_id, null);
  // 首页的「还没指定城市的机场」跟着减少
  assert.equal((await get("/platform/v1/dashboard/summary")).body.master_data.places.airports_without_city, 1);
});
