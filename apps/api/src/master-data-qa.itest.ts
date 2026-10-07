/**
 * M1-01 测试角色补充的接口测试：权限、并发、审计、校验边界、If-Match、分页与筛选、日期边界。
 * 开发角色自己的测试在 master-data.itest.ts；这里不重复那边已经覆盖的主流程。
 *
 * 名字以「【缺陷】」开头的测试是已确认的缺陷的复现：现在会失败，修好之后应当通过。
 * 全部经真实接口、真实 PostgreSQL；测试数据都在这里构造，结束时连同 schema 一起删除。不联网。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { selectAirports } from "@nozomi/domain";
import { SESSION_TTL_MS } from "./auth/session.ts";
import { importAirports } from "./services/airport-import.ts";
import { type ApiResponse, TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";
import { createMigratedTestDatabase } from "./testing/db.ts";

let api: TestApi;
let root: string;
let editor: string;

const MISSING = "99999999-9999-4999-8999-999999999999";
const PATHS = ["cities", "places", "vehicle-groups", "addons"] as const;
type Path = (typeof PATHS)[number];
const TABLES: Record<Path, string> = { cities: "cities", places: "places", "vehicle-groups": "vehicle_groups", addons: "addons" };
const AUDIT_RESOURCE: Record<Path, string> = { cities: "city", places: "place", "vehicle-groups": "vehicle_group", addons: "addon" };

async function staffToken(target: TestApi, admin: string, email: string, role: string): Promise<string> {
  const invited = await target.call("POST", "/platform/v1/staff", { token: admin, body: { email, name: email, role } });
  assert.equal(invited.status, 201, invited.text);
  const accepted = await target.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.body.invite.token, password: TEST_PASSWORD } });
  assert.equal(accepted.status, 200, accepted.text);
  const login = await target.call("POST", "/platform/v1/auth/login", { body: { email, password: TEST_PASSWORD } });
  assert.equal(login.status, 200, login.text);
  return login.body.access_token as string;
}

before(async () => {
  api = await createTestApi();
  root = await api.superAdminToken();
  editor = await staffToken(api, root, "qa-master@platform.test", "master_data");
});
after(() => api.close());

const post = (path: string, body?: unknown, token = editor): Promise<ApiResponse> => api.call("POST", `/platform/v1/master/${path}`, { token, body });
const get = (path: string, token = editor): Promise<ApiResponse> => api.call("GET", `/platform/v1/master/${path}`, { token });
const patch = (path: string, version: number | string | null, body: unknown, token = editor): Promise<ApiResponse> =>
  api.call("PATCH", `/platform/v1/master/${path}`, { token, body, ...(version === null ? {} : { headers: { "if-match": typeof version === "number" ? `"${version}"` : version } }) });

/** 原样发送一段 JSON 文本（用来发 JSON.stringify 生成不出来的内容：-0、孤立的代理字符）。 */
async function raw(method: "POST" | "PATCH", path: string, payload: string, headers: Record<string, string> = {}): Promise<ApiResponse> {
  const res = await api.app.inject({
    method,
    url: `/platform/v1/master/${path}`,
    headers: { authorization: `Bearer ${editor}`, "content-type": "application/json", ...headers },
    payload,
  });
  let body: any = null;
  try {
    body = res.json();
  } catch {
    body = null;
  }
  return { status: res.statusCode, headers: res.headers, text: res.body, body };
}

let serial = 0;
/** 每次调用给出一个没用过的短编号（大写字母和数字）。 */
function next(): string {
  serial += 1;
  return serial.toString(36).toUpperCase().padStart(3, "0");
}

const cityBody = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  code: `CTY-JP-Q${next()}`,
  country_code: "JP",
  name: { zh: "测试城市" },
  timezone: "Asia/Tokyo",
  center: { lng: 139.767125, lat: 35.681236 },
  ...extra,
});
const airportBody = (cityId: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  type: "airport",
  code: airportCode(),
  city_id: cityId,
  name: { en: "QA Airport" },
  location: { lng: 139.7, lat: 35.5 },
  ...extra,
});
const groupBody = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  code: `VG-Q${next()}-7`,
  grade: "business",
  seats: 7,
  name: { zh: "商务 7 座" },
  power: "fuel",
  combos: [{ passengers: 6, luggage: 2 }],
  ...extra,
});
const addonBody = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  code: `ADD-Q${next()}`,
  categories: ["charter"],
  charge_unit: "per_item",
  name: { zh: "儿童座椅" },
  ...extra,
});

let airportSerial = 0;
/** 机场编码只能是三个大写字母：按序号生成 QAA、QAB…… */
function airportCode(): string {
  const n = airportSerial++;
  const letter = (value: number): string => String.fromCharCode(65 + (value % 26));
  return `${letter(16 + Math.floor(n / 676))}${letter(Math.floor(n / 26))}${letter(n)}`;
}

async function created(path: string, body: unknown): Promise<any> {
  const res = await post(path, body);
  assert.equal(res.status, 201, res.text);
  return res.body;
}

/** 一条新建的记录，每类一条：给「对四类主数据都要成立」的测试用。 */
async function oneOfEach(): Promise<Record<Path, any>> {
  const city = await created("cities", cityBody());
  return {
    cities: city,
    places: await created("places", airportBody(city.id)),
    "vehicle-groups": await created("vehicle-groups", groupBody()),
    addons: await created("addons", addonBody()),
  };
}

/** 每类主数据一份合法的新增请求体。 */
async function validBodies(): Promise<Record<Path, Record<string, unknown>>> {
  const city = await created("cities", cityBody());
  return { cities: cityBody(), places: airportBody(city.id), "vehicle-groups": groupBody(), addons: addonBody() };
}

async function auditRows(resource: string, id: string): Promise<any[]> {
  const res = await api.db.owner.query(
    "select action, before, after, actor_type, actor_email, ip, source, tenant_id from audit_logs where resource = $1 and resource_id = $2 order by id",
    [resource, id],
  );
  return res.rows;
}

/** 四张主数据表的全部内容加上审计日志的条数：用来断言「什么都没变」。 */
async function snapshot(): Promise<string> {
  const parts: unknown[] = [];
  for (const table of Object.values(TABLES)) parts.push((await api.db.owner.query(`select * from ${table} order by id`)).rows);
  parts.push((await api.db.owner.query("select count(*)::int as n from audit_logs where resource in ('city', 'place', 'vehicle_group', 'addon')")).rows);
  return JSON.stringify(parts);
}

function issuePaths(res: ApiResponse): string[] {
  assert.equal(res.status, 400, res.text);
  assert.equal(res.body.error.code, "VALIDATION_FAILED", res.text);
  return (res.body.error.details.issues as { path: string }[]).map((issue) => issue.path);
}

// ---------------------------------------------------------------------------------------------------------------------
// 没有演示数据
// ---------------------------------------------------------------------------------------------------------------------

test("没有演示数据：迁移执行完，城市、地点、车型组、附加服务四张表都是空的", async () => {
  const db = await createMigratedTestDatabase();
  try {
    for (const table of Object.values(TABLES)) {
      const res = await db.owner.query(`select count(*)::int as n from ${table}`);
      assert.equal(res.rows[0].n, 0, `${table} 应当是空的`);
    }
  } finally {
    await db.drop();
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// 权限
// ---------------------------------------------------------------------------------------------------------------------

test("权限：没有 master_data.manage 的每个平台角色，四类主数据的新增、修改、停用、启用全部 403，什么都不变；但都能看", async () => {
  const items = await oneOfEach();
  const bodies = await validBodies();
  const before = await snapshot();
  for (const role of ["operations", "tenant_onboarding", "channel_manager", "customer_service", "finance", "risk", "tech", "readonly"]) {
    const token = await staffToken(api, root, `qa-${role}@platform.test`, role);
    for (const path of PATHS) {
      const item = items[path];
      const attempts: [string, ApiResponse][] = [
        ["新增", await post(path, bodies[path], token)],
        ["新增（请求体不合格也先看权限）", await post(path, { nonsense: true }, token)],
        ["修改", await patch(`${path}/${item.id}`, item.version, { name: { zh: "不该改成" } }, token)],
        ["修改（没带版本号也先看权限）", await patch(`${path}/${item.id}`, null, { name: { zh: "不该改成" } }, token)],
        ["修改不存在的记录（不透露是否存在）", await patch(`${path}/${MISSING}`, 1, { name: { zh: "不该改成" } }, token)],
        ["停用", await post(`${path}/${item.id}/disable`, undefined, token)],
        ["启用", await post(`${path}/${item.id}/enable`, undefined, token)],
        ["停用不存在的记录", await post(`${path}/${MISSING}/disable`, undefined, token)],
      ];
      for (const [what, res] of attempts) {
        assert.equal(res.status, 403, `${role} ${path} ${what}：${res.text}`);
        assert.equal(res.body.error.code, "FORBIDDEN");
        assert.equal(res.body.error.details.required, "master_data.manage");
      }
      assert.equal((await get(path, token)).status, 200, `${role} 能看 ${path} 列表`);
      assert.deepEqual((await get(`${path}/${item.id}`, token)).body, item, `${role} 能看 ${path} 的单条`);
    }
  }
  assert.equal(await snapshot(), before, "主数据和审计日志都没有变化");
});

test("权限：主数据运营角色四类都能新增、修改、停用、启用；审计日志记的是他本人", async () => {
  const bodies = await validBodies();
  for (const path of PATHS) {
    const item = await created(path, bodies[path]);
    assert.equal((await patch(`${path}/${item.id}`, 1, { name: { zh: "改名" } })).status, 200, path);
    assert.equal((await post(`${path}/${item.id}/disable`)).status, 200, path);
    assert.equal((await post(`${path}/${item.id}/enable`)).status, 200, path);
    const rows = await auditRows(AUDIT_RESOURCE[path], item.id);
    assert.deepEqual(rows.map((row) => row.action), ["create", "update", "disable", "enable"], path);
    for (const row of rows) {
      assert.deepEqual([row.actor_type, row.actor_email, row.source, row.tenant_id], ["platform_user", "qa-master@platform.test", "console", null], path);
    }
  }
});

test("未登录、乱写的令牌、退出后的令牌、过期的令牌：平台和租户的主数据接口全部 401，什么都不变", async () => {
  // 这个测试要拨时钟让令牌过期，用自己的一套环境，不影响别的测试
  const own = await createTestApi();
  try {
    const admin = await own.superAdminToken();
    const tenant = await own.tenantWithAdmin(admin, "过期测试车队", "admin@expiry.test");
    const city = await own.call("POST", "/platform/v1/master/cities", { token: admin, body: cityBody() });
    assert.equal(city.status, 201, city.text);
    const routes = own.app.registeredRoutes.filter((route) => route.method !== "HEAD" && route.path.includes("/v1/master/"));
    assert.equal(routes.length, 4 * 6 + 4 * 2, "四类主数据：平台各 6 个接口，租户各 2 个");
    const rowsBefore = (await own.db.owner.query("select count(*)::int as n from audit_logs")).rows[0].n;

    const everyRoute401 = async (headers: Record<string, string>, what: string): Promise<void> => {
      for (const route of routes) {
        const res = await own.app.inject({
          method: route.method as "GET",
          url: route.path.replace(":id", city.body.id),
          headers: { "if-match": '"1"', ...headers },
          ...(route.method === "GET" ? {} : { payload: { name: { zh: "不该改成" } } }),
        });
        assert.equal(res.statusCode, 401, `${what}：${route.method} ${route.path} → ${res.body}`);
        assert.equal(res.json().error.code, "UNAUTHENTICATED");
      }
    };
    await everyRoute401({}, "没带令牌");
    await everyRoute401({ authorization: "Bearer not-a-token" }, "乱写的令牌");
    await everyRoute401({ authorization: `Basic ${admin}` }, "不是 Bearer");
    await everyRoute401({ authorization: `Bearer ${admin.slice(0, -2)}xx` }, "签名被改过的令牌");

    // 差一秒到期：还能用
    own.clock.advance(SESSION_TTL_MS - 1_000);
    assert.equal((await own.call("GET", "/platform/v1/master/cities", { token: admin })).status, 200);
    assert.equal((await own.call("GET", "/tenant/v1/master/cities", { token: tenant.adminToken })).status, 200);
    // 过期之后：平台令牌和租户令牌都不行
    own.clock.advance(1_001);
    const platformRoutes = routes.filter((route) => route.path.startsWith("/platform/"));
    const tenantRoutes = routes.filter((route) => route.path.startsWith("/tenant/"));
    for (const [list, token] of [[platformRoutes, admin], [tenantRoutes, tenant.adminToken]] as const) {
      for (const route of list) {
        const res = await own.call(route.method as "GET", route.path.replace(":id", city.body.id), {
          token,
          headers: { "if-match": '"1"' },
          ...(route.method === "GET" ? {} : { body: { name: { zh: "不该改成" } } }),
        });
        assert.equal(res.status, 401, `过期令牌：${route.method} ${route.path} → ${res.text}`);
      }
    }
    // 重新登录后退出：退出的令牌立刻不能用
    const again = await own.call("POST", "/platform/v1/auth/login", { body: { email: "root@platform.test", password: TEST_PASSWORD } });
    const fresh = again.body.access_token as string;
    assert.equal((await own.call("POST", "/platform/v1/master/cities", { token: fresh, body: cityBody() })).status, 201);
    assert.equal((await own.call("POST", "/platform/v1/auth/logout", { token: fresh })).status, 204);
    assert.equal((await own.call("POST", "/platform/v1/master/cities", { token: fresh, body: cityBody() })).status, 401);

    const stored = (await own.db.owner.query("select name, version, status from cities where id = $1", [city.body.id])).rows[0];
    assert.deepEqual(stored, { name: { zh: "测试城市" }, version: 1, status: "active" });
    const masterAudits = (await own.db.owner.query("select count(*)::int as n from audit_logs where resource = 'city'")).rows[0].n;
    assert.equal(masterAudits, 2, "只有两次成功的新增");
    assert.ok(rowsBefore >= 1);
  } finally {
    await own.close();
  }
});

test("租户：看导入的机场时没有任何导入来源的字段；读接口上夹带「改方法」的写法、请求体、If-Match 都不会变成写", async () => {
  const csv = "id,type,name,latitude_deg,longitude_deg,iso_country,scheduled_service,iata_code\n990001,large_airport,QA Imported Airport,35.5,139.5,JP,yes,ZQA\n";
  await importAirports(api.db.pool, selectAirports(csv, ["JP"]), api.clock.now(), { dryRun: false });
  const tenant = await api.tenantWithAdmin(root, "来源测试车队", `admin-${next()}@source.test`);
  const imported = (await get("places?code=ZQA")).body.items[0];
  assert.equal(imported.source.name, "ourairports", "平台看得到来源");

  const expectedKeys = ["address", "category", "city_id", "code", "country_code", "created_at", "flight_scope", "id", "location", "name", "parent_id", "status", "type", "updated_at", "version"];
  const list = await api.call("GET", "/tenant/v1/master/places?status=all&code=ZQA", { token: tenant.adminToken });
  const single = await api.call("GET", `/tenant/v1/master/places/${imported.id}`, { token: tenant.adminToken });
  assert.equal(list.status, 200, list.text);
  assert.equal(single.status, 200, single.text);
  for (const [what, item, text] of [["列表", list.body.items[0], list.text], ["单条", single.body, single.text]] as const) {
    assert.deepEqual(Object.keys(item).sort(), expectedKeys, what);
    assert.doesNotMatch(text, /source|ourairports|overridden|synced|990001/, `${what}里不应出现导入来源`);
  }
  const defaults = await api.call("GET", "/tenant/v1/master/places?code=ZQA", { token: tenant.adminToken });
  assert.deepEqual(defaults.body.items, [], "还没启用的导入机场，租户默认看不到");

  const before = await snapshot();
  for (const url of [
    `/tenant/v1/master/places/${imported.id}?_method=PATCH`,
    `/tenant/v1/master/places/${imported.id}?name[zh]=x&status=active`,
    `/tenant/v1/master/places?_method=POST`,
  ]) {
    const res = await api.call("GET", url, {
      token: tenant.adminToken,
      headers: { "x-http-method-override": "PATCH", "x-http-method": "PATCH", "x-method-override": "PATCH", "if-match": `"${imported.version}"` },
      body: { name: { zh: "被租户改了" }, status: "active", tenant_id: tenant.tenantId },
    });
    assert.ok(res.status === 200 || res.status === 400, `${url} → ${res.status}`);
  }
  assert.equal(await snapshot(), before);
});

// ---------------------------------------------------------------------------------------------------------------------
// 并发
// ---------------------------------------------------------------------------------------------------------------------

test("并发：同一个编码同时新增多次，四类主数据都是恰好一个成功，其余 409 CODE_TAKEN，库里一条、审计一条", async () => {
  const bodies = await validBodies();
  for (const path of PATHS) {
    const body = bodies[path];
    const results = await Promise.all(Array.from({ length: 5 }, (_, index) => post(path, { ...body, name: { zh: `第 ${index + 1} 个人提交的` } })));
    assert.deepEqual(results.map((res) => res.status).sort(), [201, 409, 409, 409, 409], `${path}：${results.map((res) => res.text).join("\n")}`);
    for (const res of results) if (res.status === 409) assert.equal(res.body.error.code, "CODE_TAKEN");
    const winner = results.find((res) => res.status === 201)!.body;
    const rows = await api.db.owner.query(`select id, name from ${TABLES[path]} where code = $1`, [body["code"]]);
    assert.deepEqual(rows.rows, [{ id: winner.id, name: winner.name }], path);
    const audits = await api.db.owner.query("select resource_id from audit_logs where resource = $1 and after ->> 'code' = $2", [AUDIT_RESOURCE[path], body["code"]]);
    assert.deepEqual(audits.rows, [{ resource_id: winner.id }], `${path}：失败的那几次没有留下审计日志`);
  }
});

test("并发：多个人拿同一个版本号同时修改，四类主数据都是恰好一个成功，其余 409 VERSION_CONFLICT，不互相覆盖", async () => {
  const items = await oneOfEach();
  for (const path of PATHS) {
    const item = items[path];
    const results = await Promise.all(Array.from({ length: 5 }, (_, index) => patch(`${path}/${item.id}`, 1, { name: { zh: `第 ${index + 1} 个人改的` } })));
    assert.deepEqual(results.map((res) => res.status).sort(), [200, 409, 409, 409, 409], `${path}：${results.map((res) => res.text).join("\n")}`);
    for (const res of results) {
      if (res.status !== 409) continue;
      assert.equal(res.body.error.code, "VERSION_CONFLICT");
      assert.equal(res.body.error.details.current_version, 2);
    }
    const winner = results.find((res) => res.status === 200)!.body;
    const stored = (await get(`${path}/${item.id}`)).body;
    assert.deepEqual([stored.version, stored.name], [2, winner.name], path);
    const rows = await auditRows(AUDIT_RESOURCE[path], item.id);
    assert.deepEqual(rows.map((row) => row.action), ["create", "update"], path);
    assert.deepEqual(rows[1].after, { name: winner.name }, `${path}：审计日志记的是成功的那一次`);
  }
});

test("并发：同时停用同一条多次，状态只变一次、版本只加一、审计只有一条", async () => {
  const items = await oneOfEach();
  for (const path of ["places", "cities", "vehicle-groups", "addons"] as const) {
    const item = items[path];
    const results = await Promise.all(Array.from({ length: 5 }, () => post(`${path}/${item.id}/disable`)));
    assert.deepEqual(results.map((res) => res.status), [200, 200, 200, 200, 200], path);
    const stored = (await get(`${path}/${item.id}`)).body;
    assert.deepEqual([stored.status, stored.version], ["disabled", 2], path);
    assert.deepEqual((await auditRows(AUDIT_RESOURCE[path], item.id)).map((row) => row.action), ["create", "disable"], path);
  }
});

/** 两个互相排斥的操作同时发出：必须恰好一个成功，另一个 409；返回成功的是哪个。 */
async function exactlyOneWins(first: Promise<ApiResponse>, second: Promise<ApiResponse>, what: string): Promise<[ApiResponse, ApiResponse]> {
  const [a, b] = await Promise.all([first, second]);
  const ok = [a, b].filter((res) => res.status === 200 || res.status === 201).length;
  assert.equal(ok, 1, `${what}：应当恰好一个成功，实际 ${a.status} / ${b.status}\n${a.text}\n${b.text}`);
  const loser = a.status === 409 ? a : b;
  assert.equal(loser.status, 409, `${what}：${loser.text}`);
  return [a, b];
}

test("并发：停用城市的同时在它下面启用地点 / 新增地点 / 把地点迁进来——不会出现「城市停用了、下面却有启用中的地点」", async () => {
  const brokenRule = async (): Promise<any[]> =>
    (
      await api.db.owner.query(
        "select p.code, c.code as city from places p join cities c on c.id = p.city_id where p.status = 'active' and c.status = 'disabled'",
      )
    ).rows;
  for (let round = 0; round < 6; round += 1) {
    // 启用地点
    const city = await created("cities", cityBody());
    const poi = await created("places", { type: "poi", code: `POI-E${next()}`, city_id: city.id, category: "hotel", name: { zh: "酒店" }, location: { lng: 139.7, lat: 35.6 } });
    assert.equal((await post(`places/${poi.id}/disable`)).status, 200);
    const [disable, enable] = await exactlyOneWins(post(`cities/${city.id}/disable`), post(`places/${poi.id}/enable`), "停用城市 vs 启用地点");
    assert.equal((disable.status === 409 ? disable : enable).body.error.code, disable.status === 409 ? "MASTER_DATA_IN_USE" : "MASTER_DATA_NOT_READY");

    // 新增地点
    const second = await created("cities", cityBody());
    await exactlyOneWins(post(`cities/${second.id}/disable`), post("places", airportBody(second.id)), "停用城市 vs 在它下面新增地点");

    // 迁入地点
    const from = await created("cities", cityBody());
    const to = await created("cities", cityBody());
    const moving = await created("places", airportBody(from.id));
    await exactlyOneWins(post(`cities/${to.id}/disable`), patch(`places/${moving.id}`, 1, { city_id: to.id }), "停用城市 vs 把启用中的地点迁进来");
  }
  assert.deepEqual(await brokenRule(), []);
});

test("并发：停用机场的同时启用它的航站楼 / 在它下面新增航站楼——不会出现「机场停用了、航站楼却是启用的」", async () => {
  const city = await created("cities", cityBody());
  for (let round = 0; round < 6; round += 1) {
    const airport = await created("places", airportBody(city.id));
    const terminal = await created("places", { type: "terminal", code: `${airport.code}-T1`, parent_id: airport.id, name: { zh: "T1" }, location: { lng: 139.7, lat: 35.5 } });
    assert.equal((await post(`places/${terminal.id}/disable`)).status, 200);
    await exactlyOneWins(post(`places/${airport.id}/disable`), post(`places/${terminal.id}/enable`), "停用机场 vs 启用航站楼");

    const other = await created("places", airportBody(city.id));
    await exactlyOneWins(
      post(`places/${other.id}/disable`),
      post("places", { type: "terminal", code: `${other.code}-T1`, parent_id: other.id, name: { zh: "T1" }, location: { lng: 139.7, lat: 35.5 } }),
      "停用机场 vs 在它下面新增航站楼",
    );
  }
  const broken = await api.db.owner.query(
    "select c.code from places c join places p on p.id = c.parent_id where c.status = 'active' and p.status = 'disabled'",
  );
  assert.deepEqual(broken.rows, []);
});

test("【缺陷】并发：给机场换城市的同时启用它的航站楼，两个请求互相锁死，其中一个返回 500", async () => {
  // 复现：机场 A 在城市甲、启用；航站楼 A-T1 停用。同时发出「把 A 改到城市乙」和「启用 A-T1」。
  // 期望：两个都正常结束（200，或带明确原因的 409）。
  // 实际：启用航站楼先锁航站楼再锁机场，换城市先锁机场再改航站楼，顺序相反 → 数据库判定死锁（40P01）→ 500 INTERNAL_ERROR。
  const from = await created("cities", cityBody());
  const to = await created("cities", cityBody());
  const outcomes: string[] = [];
  for (let round = 0; round < 8; round += 1) {
    const airport = await created("places", airportBody(from.id));
    const terminal = await created("places", { type: "terminal", code: `${airport.code}-T1`, parent_id: airport.id, name: { zh: "T1" }, location: { lng: 139.7, lat: 35.5 } });
    assert.equal((await post(`places/${terminal.id}/disable`)).status, 200);
    const [enable, move] = await Promise.all([post(`places/${terminal.id}/enable`), patch(`places/${airport.id}`, 1, { city_id: to.id })]);
    outcomes.push(`${enable.status}/${move.status}`);
    // 不管谁先谁后，结束时航站楼必须和机场在同一个城市
    const rows = await api.db.owner.query("select city_id from places where id = any($1::uuid[])", [[airport.id, terminal.id]]);
    assert.equal(new Set(rows.rows.map((row) => row.city_id)).size, 1, "航站楼的城市要跟随机场");
  }
  assert.ok(
    outcomes.every((outcome) => !outcome.includes("500")),
    `8 轮「启用航站楼 / 机场换城市」同时进行的结果（启用/换城市）：${outcomes.join("、")}——不应出现 500`,
  );
});

// ---------------------------------------------------------------------------------------------------------------------
// 审计
// ---------------------------------------------------------------------------------------------------------------------

test("审计：新增的日志里 before 为空、after 是完整内容加状态；记下操作人、来源地址、入口", async () => {
  const res = await api.call("POST", "/platform/v1/master/addons", {
    token: editor,
    ip: "203.0.113.9",
    body: { code: `ADD-A${next()}`, categories: ["charter", "airport_transfer", "charter"], charge_unit: "per_person", name: { zh: " 举牌接机 ", en: "Meet & Greet" }, description: { zh: "司机举牌" } },
  });
  assert.equal(res.status, 201, res.text);
  assert.deepEqual(res.body.categories, ["airport_transfer", "charter"], "品类去重并按固定顺序");
  const rows = await auditRows("addon", res.body.id);
  assert.deepEqual(rows, [
    {
      action: "create",
      before: null,
      after: {
        code: res.body.code,
        categories: ["airport_transfer", "charter"],
        charge_unit: "per_person",
        name: { zh: "举牌接机", en: "Meet & Greet" },
        description: { zh: "司机举牌" },
        status: "active",
      },
      actor_type: "platform_user",
      actor_email: "qa-master@platform.test",
      ip: "203.0.113.9",
      source: "console",
      tenant_id: null,
    },
  ]);
});

test("审计：内容没有变化的修改不加版本、不记日志——值相同、键的顺序不同、品类顺序不同、坐标取整后相同、空请求体，都算没变", async () => {
  const city = await created("cities", cityBody({ name: { ja: "東京", zh: "东京", en: "Tokyo" }, center: { lng: 139.767125, lat: 35.681236 }, boundary: { type: "Polygon", coordinates: [[[139, 35], [140, 35], [140, 36], [139, 35]]] } }));
  const addon = await created("addons", addonBody({ categories: ["charter", "airport_transfer"], description: { zh: "说明", en: "note" } }));
  const group = await created("vehicle-groups", groupBody({ sample_models: ["丰田埃尔法"], combos: [{ passengers: 6, luggage: 2 }, { passengers: 4, luggage: 4 }] }));
  const station = await created("places", { type: "station", code: `STN-JP-N${next()}`, city_id: city.id, category: "shinkansen", name: { ja: "東京駅" }, location: { lng: 139.767125, lat: 35.681236 } });
  const before = await snapshot();
  const same: [string, unknown][] = [
    [`cities/${city.id}`, {}],
    [`cities/${city.id}`, { name: { en: "Tokyo", zh: "东京", ja: "東京" } }],
    [`cities/${city.id}`, { name: { en: " Tokyo ", zh: "东京", ja: "東京" } }],
    [`cities/${city.id}`, { center: { lat: 35.6812360001, lng: 139.7671249999 } }],
    [`cities/${city.id}`, { timezone: "Asia/Tokyo", code: city.code, country_code: "JP" }],
    [`cities/${city.id}`, { boundary: { coordinates: [[[139.0, 35.0], [140, 35], [140, 36], [139, 35]]], type: "Polygon" } }],
    [`addons/${addon.id}`, { categories: ["airport_transfer", "charter", "charter"], description: { en: "note", zh: "说明" }, charge_unit: "per_item" }],
    [`vehicle-groups/${group.id}`, { combos: [{ luggage: 2, passengers: 6 }, { passengers: 4, luggage: 4 }], sample_models: ["丰田埃尔法"], power: "fuel", grade: "business", seats: 7, code: group.code }],
    [`places/${station.id}`, { type: "station", code: station.code, parent_id: null, city_id: city.id, category: "shinkansen", flight_scope: null, address: null, location: { lng: 139.767125, lat: 35.681236 } }],
  ];
  for (const [path, body] of same) {
    const res = await patch(path, 1, body);
    assert.equal(res.status, 200, `${path} ${JSON.stringify(body)}：${res.text}`);
    assert.equal(res.body.version, 1, `${path} ${JSON.stringify(body)}：没有变化，版本不该加`);
  }
  assert.equal(await snapshot(), before);
});

test("【缺陷】审计：把经度 0 的城市「改」成 -0.0000001（取整后还是 0），却被当成一次修改——版本加一，审计日志里前后值一模一样", async () => {
  // 复现：城市中心经度 0（本初子午线上）。PATCH center.lng = -0.0000001（6 位小数取整后是 0，和原值相同）。
  // 期望：没有变化——版本不变、不写审计日志（ADR 0012「内容没有变化的修改不加版本、不写审计日志」）。
  // 实际：取整得到的是 -0，和库里的 0 被判为不同 → 版本 1 → 2，多一条 before {center_lng: 0}、after {center_lng: 0} 的审计日志。
  const city = await created("cities", cityBody({ center: { lng: 0, lat: 51.4779 } }));
  const res = await patch(`cities/${city.id}`, 1, { center: { lng: -0.0000001, lat: 51.4779 } });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.body.center, { lng: 0, lat: 51.4779 });
  const rows = await auditRows("city", city.id);
  assert.deepEqual(
    [res.body.version, rows.map((row) => [row.action, row.before, row.after])],
    [1, [["create", null, rows[0].after]]],
    "没有变化的修改不该加版本、不该写审计日志",
  );
});

test("审计：各种失败的写操作（400、403、404、409、428）都回滚干净——没有留下记录、版本不变、没有审计日志", async () => {
  const items = await oneOfEach();
  const city = items.cities;
  const airport = items.places;
  const terminal = await created("places", { type: "terminal", code: `${airport.code}-T1`, parent_id: airport.id, name: { zh: "T1" }, location: { lng: 139.7, lat: 35.5 } });
  const disabledCity = await created("cities", cityBody());
  assert.equal((await post(`cities/${disabledCity.id}/disable`)).status, 200);
  const foreign = await created("cities", { ...cityBody(), code: `CTY-KR-Q${next()}`, country_code: "KR", timezone: "Asia/Seoul" });
  const before = await snapshot();

  const failures: [string, Promise<ApiResponse>, number, string][] = [
    ["新增：编码重复", post("cities", cityBody({ code: city.code })), 409, "CODE_TAKEN"],
    ["新增：地点编码重复", post("places", airportBody(city.id, { code: airport.code })), 409, "CODE_TAKEN"],
    ["新增：城市不存在", post("places", airportBody(MISSING)), 400, "VALIDATION_FAILED"],
    ["新增：城市已停用", post("places", airportBody(disabledCity.id)), 409, "MASTER_DATA_NOT_READY"],
    ["新增：坐标越界", post("places", airportBody(city.id, { location: { lng: 181, lat: 0 } })), 400, "VALIDATION_FAILED"],
    ["新增：车型组座位数和编码不一致", post("vehicle-groups", groupBody({ seats: 8 })), 400, "VALIDATION_FAILED"],
    ["新增：附加服务没有品类", post("addons", addonBody({ categories: [] })), 400, "VALIDATION_FAILED"],
    ["修改：没带版本号", patch(`cities/${city.id}`, null, { name: { zh: "x" } }), 428, "PRECONDITION_REQUIRED"],
    ["修改：版本号过期", patch(`cities/${city.id}`, 7, { name: { zh: "x" } }), 409, "VERSION_CONFLICT"],
    ["修改：改编码", patch(`cities/${city.id}`, 1, { code: "CTY-JP-OTHER", name: { zh: "x" } }), 409, "FIELD_LOCKED"],
    ["修改：改车型组座位数", patch(`vehicle-groups/${items["vehicle-groups"].id}`, 1, { seats: 9, name: { zh: "x" } }), 409, "FIELD_LOCKED"],
    ["修改：合格的字段和不合格的字段一起提交", patch(`cities/${city.id}`, 1, { name: { zh: "x" }, timezone: "JST" }), 400, "VALIDATION_FAILED"],
    ["修改：不存在的记录", patch(`addons/${MISSING}`, 1, { name: { zh: "x" } }), 404, "NOT_FOUND"],
    ["修改：迁到别的国家的城市", patch(`places/${airport.id}`, 1, { city_id: foreign.id, name: { zh: "x" } }), 400, "VALIDATION_FAILED"],
    ["修改：启用中的地点迁到已停用的城市", patch(`places/${airport.id}`, 1, { city_id: disabledCity.id }), 409, "MASTER_DATA_NOT_READY"],
    ["修改：航站楼单独换城市", patch(`places/${terminal.id}`, 1, { city_id: disabledCity.id }), 400, "VALIDATION_FAILED"],
    ["停用：城市下还有启用中的地点", post(`cities/${city.id}/disable`), 409, "MASTER_DATA_IN_USE"],
    ["停用：机场下还有启用中的航站楼", post(`places/${airport.id}/disable`), 409, "MASTER_DATA_IN_USE"],
    ["停用：不存在的记录", post(`vehicle-groups/${MISSING}/disable`), 404, "NOT_FOUND"],
    ["启用：编号不是 UUID", post("addons/not-a-uuid/enable"), 404, "NOT_FOUND"],
  ];
  for (const [what, pending, status, code] of failures) {
    const res = await pending;
    assert.equal(res.status, status, `${what}：${res.text}`);
    assert.equal(res.body.error.code, code, what);
  }
  assert.equal(await snapshot(), before, "失败的操作没有留下任何痕迹");
});

test("审计：机场换城市——机场一条日志（记下跟着换的下级数量），下级的城市和版本跟着变", async () => {
  const from = await created("cities", cityBody());
  const to = await created("cities", cityBody());
  const airport = await created("places", airportBody(from.id));
  const t1 = await created("places", { type: "terminal", code: `${airport.code}-T1`, parent_id: airport.id, name: { zh: "T1" }, location: { lng: 139.7, lat: 35.5 } });
  const t2 = await created("places", { type: "terminal", code: `${airport.code}-T2`, parent_id: airport.id, name: { zh: "T2" }, location: { lng: 139.7, lat: 35.5 } });
  const moved = await patch(`places/${airport.id}`, 1, { city_id: to.id });
  assert.equal(moved.status, 200, moved.text);
  const rows = await auditRows("place", airport.id);
  assert.deepEqual(rows.map((row) => [row.action, row.before, row.after]).at(-1), ["update", { city_id: from.id }, { city_id: to.id, children_moved: 2 }]);
  for (const terminal of [t1, t2]) {
    const stored = (await get(`places/${terminal.id}`)).body;
    assert.deepEqual([stored.city_id, stored.version], [to.id, 2]);
  }
  // 用旧版本号改航站楼：它的版本已经因为跟着换城市而变了，要 409 而不是覆盖
  assert.equal((await patch(`places/${t1.id}`, 1, { name: { zh: "一号航站楼" } })).status, 409);
});

// ---------------------------------------------------------------------------------------------------------------------
// 校验边界
// ---------------------------------------------------------------------------------------------------------------------

test("校验：坐标——±180 / ±90 正好在界上可以，超出一点点不行；字符串数字、null、缺一半、数组都不行；多于 6 位小数的取整", async () => {
  const accepted: [unknown, unknown][] = [
    [{ lng: 180, lat: 90 }, { lng: 180, lat: 90 }],
    [{ lng: -180, lat: -90 }, { lng: -180, lat: -90 }],
    [{ lng: 0, lat: 0 }, { lng: 0, lat: 0 }],
    [{ lng: 179.9999996, lat: 89.9999996 }, { lng: 180, lat: 90 }],
    [{ lng: 139.7671254, lat: 35.6812365 }, { lng: 139.767125, lat: 35.681237 }],
    [{ lng: -139.7671256, lat: -35.6812364 }, { lng: -139.767126, lat: -35.681236 }],
    [{ lng: 1.5e2, lat: 3e1 }, { lng: 150, lat: 30 }],
  ];
  for (const [center, stored] of accepted) {
    const city = await created("cities", cityBody({ center }));
    assert.deepEqual(city.center, stored, JSON.stringify(center));
    assert.deepEqual((await get(`cities/${city.id}`)).body.center, stored, "读回来和新增时返回的一样");
  }
  const before = await snapshot();
  const rejected: [unknown, string][] = [
    [{ lng: 180.0000001, lat: 0 }, "/center/lng"],
    [{ lng: -180.0000001, lat: 0 }, "/center/lng"],
    [{ lng: 0, lat: 90.0000001 }, "/center/lat"],
    [{ lng: 0, lat: -90.0000001 }, "/center/lat"],
    [{ lng: 1e308, lat: 0 }, "/center/lng"],
    [{ lng: "139.7", lat: 35 }, "/center/lng"],
    [{ lng: 139.7, lat: "35" }, "/center/lat"],
    [{ lng: null, lat: 35 }, "/center/lng"],
    [{ lng: true, lat: 35 }, "/center/lng"],
    [{ lng: 139.7 }, "/center/lat"],
    [{ lat: 35 }, "/center/lng"],
    [[139.7, 35], "/center"],
    ["139.7,35", "/center"],
    [null, "/center"],
  ];
  for (const [center, path] of rejected) {
    assert.deepEqual(issuePaths(await post("cities", cityBody({ center }))), [path], JSON.stringify(center));
  }
  // JSON 里写不出 NaN / Infinity：写了就不是合法的 JSON；1e999 解析出来是无穷大
  for (const literal of ["NaN", "Infinity", "-Infinity"]) {
    const res = await raw("POST", "cities", `{"code":"CTY-JP-NAN","country_code":"JP","name":{"zh":"x"},"timezone":"Asia/Tokyo","center":{"lng":${literal},"lat":1}}`);
    assert.equal(res.status, 400, `${literal}：${res.text}`);
  }
  const infinite = await raw("POST", "cities", '{"code":"CTY-JP-INF","country_code":"JP","name":{"zh":"x"},"timezone":"Asia/Tokyo","center":{"lng":1e999,"lat":1}}');
  assert.deepEqual(issuePaths(infinite), ["/center/lng"]);
  // 地点的坐标同一套规则
  const city = await created("cities", cityBody());
  const snapshotWithCity = await snapshot();
  assert.deepEqual(issuePaths(await post("places", airportBody(city.id, { location: { lng: -180.5, lat: 90.5 } }))), ["/location/lng", "/location/lat"]);
  assert.deepEqual(issuePaths(await post("places", airportBody(city.id, { location: { lng: "1", lat: 1 } }))), ["/location/lng"]);
  assert.equal(await snapshot(), snapshotWithCity);
  assert.notEqual(before, "");
});

test("校验：时区——只认数据库时区名单里、写法完全一致的「大洲/城市」；缩写、偏移、UTC、大小写不对、带空格的都不行", async () => {
  for (const timezone of ["Asia/Tokyo", "Asia/Seoul", "Asia/Kolkata", "Europe/Kyiv", "America/Argentina/Buenos_Aires", "America/Port-au-Prince", "Asia/Ho_Chi_Minh", "Australia/Lord_Howe"]) {
    assert.equal((await created("cities", cityBody({ timezone }))).timezone, timezone);
  }
  const before = await snapshot();
  for (const timezone of [
    "JST", "UTC", "GMT", "Z", "+09:00", "UTC+9", "Etc/UTC", "Etc/GMT-9", "Japan", "Asia", "Asia/", "/Tokyo",
    "asia/tokyo", "ASIA/TOKYO", "Asia/tokyo", "Asia/TOKYO", "Asia/KOLKATA",
    " Asia/Tokyo", "Asia/Tokyo ", "Asia/Tokyo\n", "Asia / Tokyo", "Asia\\Tokyo",
    "Asia/Atlantis", "Mars/Olympus", "posix/Asia/Tokyo", "right/Asia/Tokyo", "Asia/Tokyo/Extra/Deep", "Asia/Tokyo;drop table cities", "x".repeat(64),
  ]) {
    assert.deepEqual(issuePaths(await post("cities", cityBody({ timezone }))), ["/timezone"], JSON.stringify(timezone));
  }
  for (const timezone of ["", "x".repeat(65), 9, null, ["Asia/Tokyo"]]) {
    assert.deepEqual(issuePaths(await post("cities", cityBody({ timezone }))), ["/timezone"], JSON.stringify(timezone));
  }
  assert.equal(await snapshot(), before);
});

test("校验：时区的旧别名和现用名不会同时被接受——同一个时区在库里只有一种写法", async () => {
  // 哪个写法被接受取决于数据库的时区名单；这里要求的是「每一对里最多接受一个」
  for (const [oldName, currentName] of [["Asia/Calcutta", "Asia/Kolkata"], ["Asia/Saigon", "Asia/Ho_Chi_Minh"], ["Europe/Kiev", "Europe/Kyiv"], ["America/Buenos_Aires", "America/Argentina/Buenos_Aires"]] as const) {
    const old = await post("cities", cityBody({ timezone: oldName }));
    const current = await post("cities", cityBody({ timezone: currentName }));
    assert.equal(current.status, 201, `${currentName}：${current.text}`);
    assert.equal(old.status, 400, `${oldName} 是 ${currentName} 的旧别名，两个都接受的话同一个时区就有了两种写法`);
  }
});

test("校验：国家码和城市编码——大小写、长度、非 ISO 代码、编码里的国家和所属国家不一致", async () => {
  assert.equal((await post("cities", cityBody({ code: `CTY-XK-Q${next()}`, country_code: "XK", timezone: "Europe/Belgrade" }))).status, 201, "科索沃 XK 是特例，可以");
  assert.equal((await post("cities", cityBody({ code: `CTY-JP-${next().padStart(8, "A")}` }))).status, 201, "序号 8 位可以");
  assert.equal((await post("cities", cityBody({ code: `CTY-JP-${next().slice(-2)}` }))).status, 201, "序号 2 位可以");
  const before = await snapshot();
  for (const country of ["jp", "Jp", "JPN", "J", "", " JP", "JP ", "XX", "UK", "EU", "ZZ", "日本", 392, null]) {
    const res = await post("cities", cityBody({ code: "CTY-JP-BADCC", country_code: country }));
    assert.deepEqual(issuePaths(res), ["/country_code"], JSON.stringify(country));
  }
  for (const code of [
    "CTY-JP-T", "CTY-JP-123456789", "CTY-JP-ty", "cty-JP-TYO", "CTY-jp-TYO", "CTY-JP-TY O", "CTY-JP-TYO\n", " CTY-JP-TYO", "CTY-JP-TYO ", "CTY-JP-TY-O", "CTY-JP-ＴＹＯ",
    "CTY_JP_TYO", "CTY-JP-", "CTY-JP", "TYO", "CTY-KR-SEL", "CTY-JPN-TYO", "",
    "x".repeat(51), 123, null,
  ]) {
    assert.deepEqual(issuePaths(await post("cities", cityBody({ code }))), ["/code"], JSON.stringify(code));
  }
  assert.equal(await snapshot(), before);
});

test("校验：多语言名称——空串、只有空格（含全角空格）、超长、不支持的语言、类型不对都不行；首尾空白去掉；200 个字符正好可以", async () => {
  const ok = await created("cities", cityBody({ name: { ja: "　東京　", en: `  ${"x".repeat(200)}\t`, ko: "도쿄" } }));
  assert.deepEqual(ok.name, { ja: "東京", en: "x".repeat(200), ko: "도쿄" });
  const before = await snapshot();
  const rejected: [unknown, string][] = [
    [{ zh: "" }, "/name/zh"],
    [{ zh: "   " }, "/name/zh"],
    [{ zh: "　　" }, "/name/zh"],
    [{ zh: "\t\n" }, "/name/zh"],
    [{ zh: "东京", en: "" }, "/name/en"],
    [{ zh: "x".repeat(201) }, "/name/zh"],
    [{ zh: null }, "/name/zh"],
    [{ zh: 1 }, "/name/zh"],
    [{ zh: { text: "东京" } }, "/name/zh"],
    [{ zh: ["东京"] }, "/name/zh"],
    [{}, "/name"],
    [{ fr: "Tokyo" }, "/name"],
    [{ zh: "东京", "zh-TW": "東京" }, "/name"],
    [{ ZH: "东京" }, "/name"],
    ["东京", "/name"],
    [["东京"], "/name"],
    [null, "/name"],
    [42, "/name"],
  ];
  for (const [name, path] of rejected) {
    assert.deepEqual(issuePaths(await post("cities", cityBody({ name }))), [path], JSON.stringify(name));
  }
  const missing = cityBody();
  delete missing["name"];
  assert.deepEqual(issuePaths(await post("cities", missing)), ["/name"]);
  // 修改时同样的规则；说明可以是空对象，但每种语言最多 2000 个字符
  assert.deepEqual(issuePaths(await patch(`cities/${ok.id}`, 1, { name: {} })), ["/name"]);
  assert.deepEqual(issuePaths(await patch(`cities/${ok.id}`, 1, { name: null })), ["/name"]);
  assert.deepEqual(issuePaths(await post("addons", addonBody({ description: { zh: "x".repeat(2001) } }))), ["/description/zh"]);
  assert.deepEqual(issuePaths(await post("addons", addonBody({ description: { zh: " " } }))), ["/description/zh"]);
  assert.equal(await snapshot(), before);
  assert.deepEqual((await created("addons", addonBody({ description: {} }))).description, {});
  assert.deepEqual((await created("addons", addonBody({ description: { zh: "x".repeat(2000) } }))).description, { zh: "x".repeat(2000) });
});

test("【缺陷】校验：名称里带孤立的代理字符（半个表情符号）时返回 500，应当是 400", async () => {
  // 复现：POST 一个城市，名称是 JSON 文本 "abc\ud83d"（只有前半个表情符号——从别处复制文字被截断时会出现）。
  // 期望：400 VALIDATION_FAILED，指出是哪个字段（和 NUL 字符的处理一样：validation.ts 已经为「数据库不接受的字符」统一拦截过 NUL）。
  // 实际：校验放行，写入 jsonb 列时数据库拒绝 → 500 INTERNAL_ERROR。车型组的代表车型、附加服务的说明同样如此。
  const city = `{"code":"CTY-JP-SUR","country_code":"JP","name":{"en":"abc\\ud83d"},"timezone":"Asia/Tokyo","center":{"lng":139.7,"lat":35.6}}`;
  const group = `{"code":"VG-SUR-7","grade":"business","seats":7,"name":{"zh":"商务"},"power":"fuel","combos":[{"passengers":6,"luggage":2}],"sample_models":["埃尔法\\udc00"]}`;
  const addon = `{"code":"ADD-SUR","categories":["charter"],"charge_unit":"per_item","name":{"zh":"座椅"},"description":{"zh":"说明\\ud83d"}}`;
  const results = [await raw("POST", "cities", city), await raw("POST", "vehicle-groups", group), await raw("POST", "addons", addon)];
  assert.deepEqual(
    results.map((res) => [res.status, res.body?.error?.code]),
    [[400, "VALIDATION_FAILED"], [400, "VALIDATION_FAILED"], [400, "VALIDATION_FAILED"]],
    "数据库存不了的字符应当在校验阶段拒绝，而不是变成 500",
  );
});

const ring = (points: number): number[][] => {
  const result: number[][] = [];
  for (let i = 0; i < points - 1; i += 1) {
    const angle = (i / (points - 1)) * 2 * Math.PI;
    result.push([139.7 + Math.cos(angle) * 0.25, 35.6 + Math.sin(angle) * 0.25]);
  }
  result.push(result[0] as number[]);
  return result;
};

test("校验：城市边界——畸形的 GeoJSON 一律 400；顶点 5000 个正好可以、5001 个不行（单个多边形和多个加起来都算）", async () => {
  const square = [[139, 35], [140, 35], [140, 36], [139, 36], [139, 35]];
  const accepted: unknown[] = [
    null,
    { type: "Polygon", coordinates: [square] },
    { type: "Polygon", coordinates: [square, [[139.2, 35.2], [139.4, 35.2], [139.4, 35.4], [139.2, 35.2]]] },
    { type: "MultiPolygon", coordinates: [[square], [[[141, 35], [142, 35], [142, 36], [141, 35]]]] },
    { type: "Polygon", coordinates: [[[-180, -90], [180, -90], [180, 90], [-180, -90]]] },
    { type: "Polygon", coordinates: [ring(5000)] },
    { type: "MultiPolygon", coordinates: [[ring(2500)], [ring(2500)]] },
  ];
  for (const boundary of accepted) {
    const city = await created("cities", cityBody({ boundary }));
    assert.deepEqual((await get(`cities/${city.id}`)).body.boundary, boundary, "边界原样存取");
  }
  const before = await snapshot();
  const rejected: [string, unknown][] = [
    ["顶点 5001 个", { type: "Polygon", coordinates: [ring(5001)] }],
    ["两个多边形加起来 5002 个顶点", { type: "MultiPolygon", coordinates: [[ring(2501)], [ring(2501)]] }],
    ["外环加洞加起来 5001 个顶点", { type: "Polygon", coordinates: [ring(4997), [[139.6, 35.5], [139.8, 35.5], [139.8, 35.7], [139.6, 35.5]]] }],
    ["环没有闭合", { type: "Polygon", coordinates: [[[139, 35], [140, 35], [140, 36], [139, 36]]] }],
    ["环只有 3 个点", { type: "Polygon", coordinates: [[[139, 35], [140, 35], [139, 35]]] }],
    ["没有环", { type: "Polygon", coordinates: [] }],
    ["空的环", { type: "Polygon", coordinates: [[]] }],
    ["空的 MultiPolygon", { type: "MultiPolygon", coordinates: [] }],
    ["MultiPolygon 里有空的多边形", { type: "MultiPolygon", coordinates: [[]] }],
    ["经度越界", { type: "Polygon", coordinates: [[[181, 35], [140, 35], [140, 36], [181, 35]]] }],
    ["纬度越界", { type: "Polygon", coordinates: [[[139, 91], [140, 35], [140, 36], [139, 91]]] }],
    ["Polygon 的类型配了 MultiPolygon 的坐标", { type: "Polygon", coordinates: [[square]] }],
    ["MultiPolygon 的类型配了 Polygon 的坐标", { type: "MultiPolygon", coordinates: [square] }],
    ["坐标带高度（三个数）", { type: "Polygon", coordinates: [[[139, 35, 10], [140, 35, 10], [140, 36, 10], [139, 35, 10]]] }],
    ["坐标只有一个数", { type: "Polygon", coordinates: [[[139], [140], [140], [139]]] }],
    ["坐标是字符串", { type: "Polygon", coordinates: [[["139", "35"], ["140", "35"], ["140", "36"], ["139", "35"]]] }],
    ["坐标是对象", { type: "Polygon", coordinates: [[{ lng: 139, lat: 35 }, { lng: 140, lat: 35 }, { lng: 140, lat: 36 }, { lng: 139, lat: 35 }]] }],
    ["坐标里有 null", { type: "Polygon", coordinates: [[[139, 35], null, [140, 36], [139, 35]]] }],
    ["coordinates 不是数组", { type: "Polygon", coordinates: "139,35 140,35" }],
    ["没有 coordinates", { type: "Polygon" }],
    ["没有 type", { coordinates: [square] }],
    ["类型是 Point", { type: "Point", coordinates: [139, 35] }],
    ["类型是 LineString", { type: "LineString", coordinates: square }],
    ["类型是 Feature", { type: "Feature", geometry: { type: "Polygon", coordinates: [square] } }],
    ["类型大小写不对", { type: "polygon", coordinates: [square] }],
    ["是字符串（WKT）", "POLYGON((139 35, 140 35, 140 36, 139 35))"],
    ["是数组", [square]],
    ["是数字", 5],
    ["洞超过 100 个", { type: "Polygon", coordinates: Array.from({ length: 101 }, () => [[139.2, 35.2], [139.4, 35.2], [139.4, 35.4], [139.2, 35.2]]) }],
  ];
  for (const [what, boundary] of rejected) {
    const res = await post("cities", cityBody({ boundary }));
    assert.equal(res.status, 400, `${what}：${res.text.slice(0, 300)}`);
    assert.equal(res.body.error.code, "VALIDATION_FAILED", what);
    for (const issue of res.body.error.details.issues as { path: string }[]) assert.match(issue.path, /^\/boundary/, what);
  }
  assert.equal(await snapshot(), before);
});

test("校验：地点编码——各类型的格式边界；编码全平台唯一（不同类型之间也不能重复）", async () => {
  const jp = await created("cities", cityBody());
  const kr = await created("cities", { ...cityBody(), code: `CTY-KR-Q${next()}`, country_code: "KR", timezone: "Asia/Seoul" });
  const base = { name: { zh: "地点" }, location: { lng: 139.7, lat: 35.6 } };
  const station = (code: unknown, city = jp.id) => post("places", { ...base, type: "station", code, city_id: city, category: "rail" });
  const poi = (code: unknown) => post("places", { ...base, type: "poi", code, city_id: jp.id, category: "hotel" });
  const airport = (code: unknown) => post("places", { ...base, type: "airport", code, city_id: jp.id });

  const tag = next();
  const longStation = `STN-JP-${tag.padStart(10, "A")}`;
  assert.equal((await station(longStation)).status, 201, "车站序号 10 位可以");
  assert.equal((await station(`STN-KR-${tag}`, kr.id)).status, 201);
  assert.equal((await poi(`POI-${tag.padStart(12, "0")}`)).status, 201, "地标序号 12 位可以");
  assert.equal((await poi("POI-7")).status, 201, "地标序号 1 位可以");
  const parent = (await get(`places?code=${longStation}`)).body.items[0];
  const exitCode = `${longStation}-ABCDEF`;
  assert.equal((await post("places", { ...base, type: "exit", code: exitCode, parent_id: parent.id })).status, 201, "出口后缀 6 位可以（总长 24）");

  const before = await snapshot();
  for (const code of ["HN", "HNDA", "hnd", "Hnd", "H1D", "HND ", " HND", "HN-", "ＨＮＤ", "", "POI-1", 123, null]) {
    assert.deepEqual(issuePaths(await airport(code)), ["/code"], `机场 ${JSON.stringify(code)}`);
  }
  for (const code of ["STN-JP-", "STN-JP-12345678901", "STN-JP-tokyo", "STN-jp-TOKYO", "stn-JP-TOKYO", "STN-JP-TO KYO", "STN-JP-TO-KYO", "STN-KR-SEOUL", "STN-TOKYO", "TOKYO", "HND"]) {
    assert.deepEqual(issuePaths(await station(code)), ["/code"], `车站 ${JSON.stringify(code)}`);
  }
  assert.deepEqual(issuePaths(await station(`STN-JP-${tag}`, kr.id)), ["/code"], "编码里的国家要和城市的国家一致");
  for (const code of ["POI-", "POI-1234567890123", "POI-abc", "poi-123", "POI-12-3", "POI_123", "POI123", "123"]) {
    assert.deepEqual(issuePaths(await poi(code)), ["/code"], `地标 ${JSON.stringify(code)}`);
  }
  for (const code of [`${longStation}-`, `${longStation}-ABCDEFG`, `${longStation}-e1`, `${longStation}E1`, "E1", `STN-JP-OTHER-E1`, `${longStation}-E-1`, longStation]) {
    const res = await post("places", { ...base, type: "exit", code, parent_id: parent.id });
    assert.deepEqual(issuePaths(res), ["/code"], `出口 ${JSON.stringify(code)}`);
  }
  // 唯一：同类型、不同类型都不能重复
  assert.equal((await poi("POI-7")).body.error.code, "CODE_TAKEN");
  assert.equal((await post("places", { ...base, type: "exit", code: exitCode, parent_id: parent.id })).body.error.code, "CODE_TAKEN");
  assert.equal(await snapshot(), before);
});

test("校验：上下级——航站楼只能挂机场、出口只能挂车站，不能跨类型、不能挂在航站楼 / 出口 / 地标下，创建后不能改上级和类型（所以成不了环）", async () => {
  const city = await created("cities", cityBody());
  const base = { name: { zh: "地点" }, location: { lng: 139.7, lat: 35.6 } };
  const airport = await created("places", airportBody(city.id));
  const otherAirport = await created("places", airportBody(city.id));
  const station = await created("places", { ...base, type: "station", code: `STN-JP-H${next()}`, city_id: city.id, category: "rail" });
  const poi = await created("places", { ...base, type: "poi", code: `POI-H${next()}`, city_id: city.id, category: "mall" });
  const terminal = await created("places", { ...base, type: "terminal", code: `${airport.code}-T1`, parent_id: airport.id });
  const exit = await created("places", { ...base, type: "exit", code: `${station.code}-E1`, parent_id: station.id });
  assert.deepEqual([terminal.city_id, terminal.country_code, exit.city_id], [city.id, "JP", city.id]);

  const before = await snapshot();
  const child = (type: string, parent: any, extra: Record<string, unknown> = {}) => post("places", { ...base, type, code: `${parent.code}-X1`, parent_id: parent.id, ...extra });
  const wrongParents: [string, Promise<ApiResponse>][] = [
    ["航站楼挂在车站下", child("terminal", station)],
    ["航站楼挂在地标下", child("terminal", poi)],
    ["航站楼挂在航站楼下", child("terminal", terminal)],
    ["航站楼挂在出口下", child("terminal", exit)],
    ["出口挂在机场下", child("exit", airport)],
    ["出口挂在地标下", child("exit", poi)],
    ["出口挂在出口下", child("exit", exit)],
    ["出口挂在航站楼下", child("exit", terminal)],
    ["上级不存在", post("places", { ...base, type: "terminal", code: "ZZZ-T1", parent_id: MISSING })],
    ["上级是一个城市的编号", post("places", { ...base, type: "terminal", code: "ZZZ-T1", parent_id: city.id })],
    ["航站楼没有上级", post("places", { ...base, type: "terminal", code: `${airport.code}-T9` })],
    ["航站楼的上级是 null", post("places", { ...base, type: "terminal", code: `${airport.code}-T9`, parent_id: null, city_id: city.id })],
    ["机场带了上级", post("places", { ...airportBody(city.id), parent_id: otherAirport.id })],
    ["车站带了上级", post("places", { ...base, type: "station", code: "STN-JP-HASP", city_id: city.id, category: "rail", parent_id: station.id })],
    ["地标带了上级", post("places", { ...base, type: "poi", code: "POI-HASP", city_id: city.id, category: "mall", parent_id: airport.id })],
    ["上级编号不是 UUID", post("places", { ...base, type: "terminal", code: `${airport.code}-T9`, parent_id: "HND" })],
  ];
  for (const [what, pending] of wrongParents) {
    assert.deepEqual(issuePaths(await pending), ["/parent_id"], what);
  }
  const otherCity = await created("cities", cityBody());
  const afterCity = await snapshot();
  assert.deepEqual(issuePaths(await child("terminal", airport, { city_id: otherCity.id })), ["/city_id"], "航站楼不能单独指定别的城市");
  assert.deepEqual(issuePaths(await post("places", { ...base, type: "terminal", code: `${otherAirport.code}-T1`, parent_id: airport.id })), ["/code"], "编码要以上级的编码开头");

  // 创建后改上级、改类型：409 FIELD_LOCKED（带相同的值不算改）
  const locked: [string, any, unknown, string[]][] = [
    ["航站楼换一个机场", terminal, { parent_id: otherAirport.id }, ["parent_id"]],
    ["航站楼改成没有上级", terminal, { parent_id: null }, ["parent_id"]],
    ["航站楼的上级改成它自己", terminal, { parent_id: terminal.id }, ["parent_id"]],
    ["机场挂到自己的航站楼下（成环）", airport, { parent_id: terminal.id }, ["parent_id"]],
    ["机场挂到另一个机场下", airport, { parent_id: otherAirport.id }, ["parent_id"]],
    ["机场改成航站楼", airport, { type: "terminal", parent_id: otherAirport.id }, ["type", "parent_id"]],
    ["航站楼改成机场", terminal, { type: "airport" }, ["type"]],
    ["出口改成航站楼并换上级", exit, { type: "terminal", parent_id: airport.id }, ["type", "parent_id"]],
    ["改编码", terminal, { code: `${airport.code}-T2` }, ["code"]],
  ];
  for (const [what, item, body, fields] of locked) {
    const res = await patch(`places/${item.id}`, 1, body);
    assert.equal(res.status, 409, `${what}：${res.text}`);
    assert.equal(res.body.error.code, "FIELD_LOCKED", what);
    assert.deepEqual(res.body.error.details.fields, fields, what);
  }
  assert.equal(await snapshot(), afterCity);
  assert.notEqual(before, afterCity);
  const same = await patch(`places/${terminal.id}`, 1, { type: "terminal", code: terminal.code, parent_id: airport.id });
  assert.deepEqual([same.status, same.body.version], [200, 1]);
  const selfParent = await api.db.owner.query("select count(*)::int as n from places where parent_id = id");
  assert.equal(selfParent.rows[0].n, 0);
});

test("校验：地点的属性跟着类型走——修改时也不能给机场加车站类型、给车站清空类型、给车站加地址", async () => {
  const city = await created("cities", cityBody());
  const base = { name: { zh: "地点" }, location: { lng: 139.7, lat: 35.6 } };
  const airport = await created("places", airportBody(city.id, { flight_scope: "international" }));
  const station = await created("places", { ...base, type: "station", code: `STN-JP-A${next()}`, city_id: city.id, category: "metro" });
  const poi = await created("places", { ...base, type: "poi", code: `POI-A${next()}`, city_id: city.id, category: "port", address: " 东京都港区 1-1 " });
  assert.equal(poi.address, "东京都港区 1-1");
  const before = await snapshot();
  const rejected: [string, any, unknown, string][] = [
    ["机场加类型", airport, { category: "rail" }, "/category"],
    ["机场加地址", airport, { address: "某处" }, "/address"],
    ["机场的国际国内属性写错", airport, { flight_scope: "regional" }, "/flight_scope"],
    ["车站清空类型", station, { category: null }, "/category"],
    ["车站用地标的类型", station, { category: "hotel" }, "/category"],
    ["车站加国际国内属性", station, { flight_scope: "domestic" }, "/flight_scope"],
    ["车站加地址", station, { address: "某处" }, "/address"],
    ["地标用车站的类型", poi, { category: "metro" }, "/category"],
    ["地标的地址只有空格", poi, { address: "   " }, "/address"],
    ["地标的地址超过 300 个字符", poi, { address: "x".repeat(301) }, "/address"],
    ["城市传 null", poi, { city_id: null }, "/city_id"],
    ["城市不存在", poi, { city_id: MISSING }, "/city_id"],
  ];
  for (const [what, item, body, path] of rejected) {
    assert.deepEqual(issuePaths(await patch(`places/${item.id}`, 1, body)), [path], what);
  }
  assert.equal(await snapshot(), before);
  const cleared = await patch(`places/${poi.id}`, 1, { address: null });
  assert.deepEqual([cleared.status, cleared.body.address, cleared.body.version], [200, null, 2]);
  const scope = await patch(`places/${airport.id}`, 1, { flight_scope: null });
  assert.deepEqual([scope.status, scope.body.flight_scope], [200, null]);
});

test("校验：车型组——座位 1 到 60、编码末尾等于座位数、组合 1 到 20 个且人数不超过座位、行李 0 到 99、代表车型最多 10 个", async () => {
  const one = await created("vehicle-groups", groupBody({ code: `VG-A${next()}-1`, seats: 1, combos: [{ passengers: 1, luggage: 0 }] }));
  assert.equal(one.seats, 1);
  const combos20 = Array.from({ length: 20 }, (_, index) => ({ passengers: 60, luggage: index }));
  const big = await created("vehicle-groups", groupBody({ code: `VG-A${next()}-60`, seats: 60, combos: combos20, sample_models: Array.from({ length: 10 }, (_, index) => `车型 ${index}`) }));
  assert.equal(big.combos.length, 20);
  assert.equal((await created("vehicle-groups", groupBody({ combos: [{ passengers: 7, luggage: 99, note: "多余的字段被丢掉" }] }))).combos[0].note, undefined);
  const before = await snapshot();
  const rejected: [string, Record<string, unknown>, string][] = [
    ["座位 0", { code: "VG-BAD-0", seats: 0 }, "/seats"],
    ["座位 61", { code: "VG-BAD-61", seats: 61 }, "/seats"],
    ["座位是小数", { seats: 7.5 }, "/seats"],
    ["座位是字符串", { seats: "7" }, "/seats"],
    ["编码末尾和座位数不一致", { code: "VG-BAD-8", seats: 7 }, "/code"],
    ["编码末尾带前导 0", { code: "VG-BAD-07", seats: 7 }, "/code"],
    ["编码末尾三位数", { code: "VG-BAD-100", seats: 60 }, "/code"],
    ["编码等级只有 1 位", { code: "VG-B-7" }, "/code"],
    ["编码等级 9 位", { code: "VG-ABCDEFGHI-7" }, "/code"],
    ["编码小写", { code: "vg-biz-7" }, "/code"],
    ["等级不在清单里", { grade: "premium" }, "/grade"],
    ["动力不在清单里", { power: "hybrid" }, "/power"],
    ["没有组合", { combos: [] }, "/combos"],
    ["21 个组合", { code: "VG-BAD-60", seats: 60, combos: Array.from({ length: 21 }, (_, index) => ({ passengers: 60, luggage: index })) }, "/combos"],
    ["人数超过座位数", { combos: [{ passengers: 8, luggage: 0 }] }, "/combos"],
    ["组合重复", { combos: [{ passengers: 6, luggage: 2 }, { passengers: 6, luggage: 2 }] }, "/combos"],
    ["人数 0", { combos: [{ passengers: 0, luggage: 0 }] }, "/combos/0/passengers"],
    ["行李 -1", { combos: [{ passengers: 1, luggage: -1 }] }, "/combos/0/luggage"],
    ["行李 100", { combos: [{ passengers: 1, luggage: 100 }] }, "/combos"],
    ["行李是小数", { combos: [{ passengers: 1, luggage: 1.5 }] }, "/combos/0/luggage"],
    ["组合缺行李数", { combos: [{ passengers: 1 }] }, "/combos/0/luggage"],
    ["11 个代表车型", { sample_models: Array.from({ length: 11 }, (_, index) => `车型 ${index}`) }, "/sample_models"],
    ["代表车型是空串", { sample_models: ["  "] }, "/sample_models/0"],
    ["代表车型超过 100 个字符", { sample_models: ["x".repeat(101)] }, "/sample_models/0"],
  ];
  for (const [what, extra, path] of rejected) {
    assert.deepEqual(issuePaths(await post("vehicle-groups", groupBody(extra))), [path], what);
  }
  // 修改组合时按已有的座位数校验
  assert.deepEqual(issuePaths(await patch(`vehicle-groups/${one.id}`, 1, { combos: [{ passengers: 2, luggage: 0 }] })), ["/combos"]);
  assert.deepEqual(issuePaths(await patch(`vehicle-groups/${one.id}`, 1, { combos: [] })), ["/combos"]);
  assert.equal(await snapshot(), before);
});

test("校验：附加服务——编码格式边界、品类和计费方式只能取清单里的值", async () => {
  assert.equal((await post("addons", addonBody({ code: `ADD-A${next().slice(-1)}` }))).status, 201, "代码 2 位可以");
  assert.equal((await post("addons", addonBody({ code: `ADD-${`Q${next()}`.padEnd(40, "_")}` }))).status, 201, "代码 40 位可以");
  assert.deepEqual((await created("addons", addonBody({ categories: ["point_to_point", "charter", "airport_transfer"] }))).categories, ["airport_transfer", "charter", "point_to_point"]);
  const before = await snapshot();
  const rejected: [string, Record<string, unknown>, string][] = [
    ["代码 1 位", { code: "ADD-A" }, "/code"],
    ["代码 41 位", { code: `ADD-${"A".repeat(41)}` }, "/code"],
    ["代码以数字开头", { code: "ADD-1SEAT" }, "/code"],
    ["代码以下划线开头", { code: "ADD-_SEAT" }, "/code"],
    ["代码小写", { code: "ADD-child_seat" }, "/code"],
    ["代码带连字符", { code: "ADD-CHILD-SEAT" }, "/code"],
    ["代码带空格", { code: "ADD-CHILD SEAT" }, "/code"],
    ["没有前缀", { code: "CHILD_SEAT" }, "/code"],
    ["品类为空", { categories: [] }, "/categories"],
    ["品类不在清单里", { categories: ["charter", "bus"] }, "/categories/1"],
    ["品类不是数组", { categories: "charter" }, "/categories"],
    ["品类重复到超过 3 个", { categories: ["charter", "charter", "charter", "charter"] }, "/categories"],
    ["计费方式不在清单里", { charge_unit: "per_km" }, "/charge_unit"],
    ["计费方式是 null", { charge_unit: null }, "/charge_unit"],
  ];
  for (const [what, extra, path] of rejected) {
    assert.deepEqual(issuePaths(await post("addons", addonBody(extra))), [path], what);
  }
  assert.equal(await snapshot(), before);
});

test("校验：请求体不是对象、不是 JSON、是空的、内容类型不对——都是 4xx 而不是 500，什么都不写", async () => {
  const city = await created("cities", cityBody());
  const before = await snapshot();
  for (const payload of ["", "[]", "[1,2]", '"text"', "42", "null", "true", "{", '{"name":', "{'name': 'x'}", '{"name":{"zh":"x"},}']) {
    for (const [method, path] of [["POST", "cities"], ["PATCH", `cities/${city.id}`]] as const) {
      const res = await raw(method, path, payload, { "if-match": '"1"' });
      // 修改接口把 null 当成「什么都不改」：原样返回，版本不变
      if (method === "PATCH" && payload === "null") assert.deepEqual([res.status, res.body.version], [200, 1]);
      else assert.equal(res.status, 400, `${method} ${JSON.stringify(payload)} → ${res.status} ${res.text}`);
    }
  }
  const text = await raw("POST", "cities", JSON.stringify(cityBody()), { "content-type": "text/plain" });
  assert.ok(text.status === 400 || text.status === 415, `不是 JSON 的内容类型 → ${text.status} ${text.text}`);
  const nul = await post("cities", cityBody({ name: { zh: "东\u0000京" } }));
  assert.deepEqual(issuePaths(nul), ["/name/zh"]);
  assert.equal(await snapshot(), before);
});

// ---------------------------------------------------------------------------------------------------------------------
// If-Match
// ---------------------------------------------------------------------------------------------------------------------

test("If-Match：只接受 \"3\" 和 3 两种写法（两边可以有空白）；弱校验写法、*、列表、0、负数、前导 0、小数、非数字、超长都是 400，什么都不改", async () => {
  const items = await oneOfEach();
  for (const path of PATHS) {
    const item = items[path];
    const url = `${path}/${item.id}`;
    const before = await snapshot();
    for (const header of ['W/"1"', "*", '"01"', "01", "0", '"0"', "-1", "+1", "1.0", "1e0", "0x1", '"1", "2"', "1, 2", '"1', '1"', "'1'", '""', "", " ", "one", "１", "٢", '"1";', "1234567890", '"1234567890"', "99999999999999999999"]) {
      const res = await patch(url, header, { name: { zh: "不该改成" } });
      assert.equal(res.status, 400, `${path} If-Match: ${JSON.stringify(header)} → ${res.status} ${res.text}`);
      assert.equal(res.body.error.code, "VALIDATION_FAILED");
      assert.equal(res.body.error.details.location, "headers");
      assert.deepEqual(res.body.error.details.issues.map((issue: { path: string }) => issue.path), ["/if-match"]);
    }
    assert.equal(await snapshot(), before, path);
    // 合法但不是当前版本：409，带上当前版本
    for (const header of ["2", '"2"', "999999999"]) {
      const res = await patch(url, header, { name: { zh: "不该改成" } });
      assert.equal(res.status, 409, `${path} ${header}`);
      assert.deepEqual(res.body.error.details, { current_version: 1 });
    }
    assert.equal(await snapshot(), before, path);
    // 四种合法写法依次各改一次
    let version = 1;
    for (const write of [(v: number) => `"${v}"`, (v: number) => `${v}`, (v: number) => ` "${v}" `, (v: number) => `${v} `]) {
      const res = await patch(url, write(version), { name: { zh: `第 ${version} 次改` } });
      assert.equal(res.status, 200, `${path} If-Match: ${JSON.stringify(write(version))} → ${res.text}`);
      version += 1;
      assert.equal(res.body.version, version);
    }
  }
});

test("If-Match：没带是 428（哪怕请求体不合格、内容没变）；不存在的记录是 404；版本过期优先于「改了不能改的字段」；停用启用不需要版本号", async () => {
  const city = await created("cities", cityBody());
  const before = await snapshot();
  for (const body of [{ name: { zh: "x" } }, {}, { name: {} }, { code: "CTY-JP-OTHER" }]) {
    const res = await patch(`cities/${city.id}`, null, body);
    assert.equal(res.status, 428, JSON.stringify(body));
    assert.equal(res.body.error.code, "PRECONDITION_REQUIRED");
  }
  assert.equal((await patch(`cities/${MISSING}`, 1, { name: { zh: "x" } })).status, 404);
  assert.equal((await patch("cities/not-a-uuid", 1, { name: { zh: "x" } })).status, 404);
  const stale = await patch(`cities/${city.id}`, 5, { code: "CTY-JP-OTHER" });
  assert.deepEqual([stale.status, stale.body.error.code], [409, "VERSION_CONFLICT"]);
  // 版本对、内容不合格：400，不改
  assert.deepEqual(issuePaths(await patch(`cities/${city.id}`, 1, { timezone: "JST" })), ["/timezone"]);
  assert.equal(await snapshot(), before);

  // 别人停用过之后，拿着旧版本号的修改要 409
  assert.equal((await post(`cities/${city.id}/disable`)).status, 200);
  const afterDisable = await patch(`cities/${city.id}`, 1, { name: { zh: "x" } });
  assert.deepEqual([afterDisable.status, afterDisable.body.error.details.current_version], [409, 2]);
  // 停用状态下也能改内容，状态保持停用
  const edited = await patch(`cities/${city.id}`, 2, { name: { zh: "停用时改的名字" } });
  assert.deepEqual([edited.status, edited.body.status, edited.body.version], [200, "disabled", 3]);
});

// ---------------------------------------------------------------------------------------------------------------------
// 分页、筛选、日期边界
// ---------------------------------------------------------------------------------------------------------------------

test("列表：分页和筛选参数的畸形值，平台和租户的四类列表都是 400 而不是 500 或被悄悄忽略", async () => {
  const tenant = await api.tenantWithAdmin(root, "参数测试车队", `admin-${next()}@query.test`);
  const common: [string, string][] = [
    ["limit=0", "/limit"], ["limit=201", "/limit"], ["limit=-1", "/limit"], ["limit=1.5", "/limit"], ["limit=1e2", "/limit"], ["limit=0x10", "/limit"], ["limit=", "/limit"],
    ["limit=abc", "/limit"], ["limit=%2010", "/limit"], ["limit=10&limit=20", "/limit"], ["limit=99999", "/limit"],
    ["cursor=", "/cursor"], ["cursor=abc", "/cursor"], ["cursor=e30", "/cursor"], ["cursor=bnVsbA", "/cursor"], [`cursor=${"A".repeat(501)}`, "/cursor"],
    [`cursor=${Buffer.from(JSON.stringify({ t: "2026-13-45 00:00:00+00", id: MISSING })).toString("base64url")}`, "/cursor"],
    [`cursor=${Buffer.from(JSON.stringify({ t: "2026-10-07 00:00:00+00", id: "1; drop table cities" })).toString("base64url")}`, "/cursor"],
    [`cursor=${Buffer.from(JSON.stringify({ t: 1, id: MISSING })).toString("base64url")}`, "/cursor"],
    ["status=", "/status"], ["status=ACTIVE", "/status"], ["status=deleted", "/status"], ["status=active&status=disabled", "/status"],
    ["code=", "/code"], [`code=${"A".repeat(51)}`, "/code"], ["code=%00", "/code"], ["code=A&code=B", "/code"],
    ["updated_since=", "/updated_since"], ["updated_since=yesterday", "/updated_since"], ["updated_since=2026-10-07", "/updated_since"],
    ["updated_since=2026-10-07T00:00:00", "/updated_since"], ["updated_since=2026-10-07%2000:00:00Z", "/updated_since"],
    ["updated_since=2026-02-30T00:00:00Z", "/updated_since"], ["updated_since=2026-10-07T24:00:00Z", "/updated_since"], ["updated_since=2026-10-07T00:00:60Z", "/updated_since"],
    ["updated_since=2026-10-07T00:00:00%2B99:00", "/updated_since"], ["updated_since=1759798800", "/updated_since"],
    // 没有转义的加号在查询串里是空格
    ["updated_since=2026-10-07T00:00:00+09:00", "/updated_since"],
  ];
  const specific: Record<Path, [string, string][]> = {
    cities: [["country_code=jp", "/country_code"], ["country_code=JPN", "/country_code"], ["country_code=", "/country_code"]],
    places: [
      ["country_code=jp", "/country_code"], ["type=hotel", "/type"], ["type=", "/type"], ["type=airport&type=station", "/type"],
      ["city_id=abc", "/city_id"], ["city_id=", "/city_id"], ["parent_id=HND", "/parent_id"], [`parent_id=${MISSING}x`, "/parent_id"],
    ],
    "vehicle-groups": [["grade=vip", "/grade"], ["grade=", "/grade"], ["grade=BUSINESS", "/grade"]],
    addons: [],
  };
  for (const [prefix, token] of [["/platform/v1/master", editor], ["/tenant/v1/master", tenant.adminToken]] as const) {
    for (const path of PATHS) {
      for (const [query, issuePath] of [...common, ...specific[path]]) {
        const res = await api.call("GET", `${prefix}/${path}?${query}`, { token });
        assert.equal(res.status, 400, `${prefix}/${path}?${query} → ${res.status} ${res.text.slice(0, 200)}`);
        assert.equal(res.body.error.details.location, "querystring");
        assert.deepEqual(res.body.error.details.issues.map((issue: { path: string }) => issue.path), [issuePath], `${path}?${query}`);
      }
      // 合法的边界值
      for (const query of ["limit=1", "limit=200", "status=all", "updated_since=2026-10-07T00:00:00Z", "updated_since=2026-10-07T00:00:00.123456%2B09:00", "updated_since=0001-01-01T00:00:00Z", "unknown_param=1"]) {
        const res = await api.call("GET", `${prefix}/${path}?${query}`, { token });
        assert.equal(res.status, 200, `${prefix}/${path}?${query} → ${res.text.slice(0, 200)}`);
      }
    }
  }
});

test("列表：创建时间完全相同的记录，一条一条翻也不重不漏；组合筛选只返回符合全部条件的", async () => {
  // 测试时钟不走，这些记录的创建时间完全相同，翻页只能靠编号分先后
  const city = await created("cities", cityBody());
  const codes: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    const place = await created("places", { type: "poi", code: `POI-PG${next()}`, city_id: city.id, category: i % 2 === 0 ? "hotel" : "mall", name: { zh: `地标 ${i}` }, location: { lng: 139.7, lat: 35.6 } });
    codes.push(place.code);
    if (i >= 5) assert.equal((await post(`places/${place.id}/disable`)).status, 200);
  }
  const times = await api.db.owner.query("select count(distinct created_at)::int as n from places where city_id = $1", [city.id]);
  assert.equal(times.rows[0].n, 1, "前提：创建时间完全相同");
  for (const limit of [1, 2, 3, 7, 8]) {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: ApiResponse = await get(`places?city_id=${city.id}&limit=${limit}${cursor === null ? "" : `&cursor=${cursor}`}`);
      assert.equal(res.status, 200, res.text);
      assert.ok(res.body.items.length <= limit);
      seen.push(...res.body.items.map((item: { code: string }) => item.code));
      cursor = res.body.next_cursor;
      pages += 1;
      assert.ok(pages <= 8, "翻页没有结束");
    } while (cursor !== null);
    assert.deepEqual([...seen].sort(), [...codes].sort(), `limit=${limit}`);
    assert.equal(new Set(seen).size, seen.length, `limit=${limit}：没有重复`);
  }
  const filtered = await get(`places?city_id=${city.id}&type=poi&status=active&country_code=JP`);
  assert.deepEqual(filtered.body.items.map((item: { code: string }) => item.code).sort(), codes.slice(0, 5).sort());
  assert.deepEqual((await get(`places?city_id=${city.id}&type=station`)).body.items, []);
  assert.deepEqual((await get(`places?city_id=${city.id}&status=disabled&limit=200`)).body.items.length, 2);
  assert.deepEqual((await get(`places?city_id=${city.id}&code=${codes[3]}`)).body.items.map((item: { code: string }) => item.code), [codes[3]]);
  assert.deepEqual((await get(`places?city_id=${MISSING}`)).body.items, []);
  // 用另一类主数据的游标：不报错，也翻不出不该有的东西
  const first = await get(`places?city_id=${city.id}&limit=1`);
  const crossed = await get(`cities?limit=200&cursor=${first.body.next_cursor}`);
  assert.equal(crossed.status, 200, crossed.text);
  for (const item of crossed.body.items) assert.match(item.code, /^CTY-/);
});

test("日期边界：updated_since 是「大于等于」，按时刻比较而不是按字面——跨午夜、跨月、不同时区写法结果一致", async () => {
  // 把时钟拨到东京时间 11 月 1 日 00:00:00.000（UTC 是 10 月 31 日 15:00）：正好在日本的月末午夜
  // 要把时钟拨出去三个多星期，用自己的一套环境，不让别的测试的登录过期
  const own = await createTestApi();
  try {
    const target = Date.parse("2026-10-31T15:00:00.000Z");
    own.clock.advance(target - 1 - own.clock.now().getTime());
    const token = await own.superAdminToken();
    const created = async (path: string, payload: unknown): Promise<any> => {
      const res = await own.call("POST", `/platform/v1/master/${path}`, { token, body: payload });
      assert.equal(res.status, 201, res.text);
      return res.body;
    };
    const get = (path: string): Promise<ApiResponse> => own.call("GET", `/platform/v1/master/${path}`, { token });
    const post = (path: string): Promise<ApiResponse> => own.call("POST", `/platform/v1/master/${path}`, { token });
    const patch = (path: string, version: number, payload: unknown): Promise<ApiResponse> =>
      own.call("PATCH", `/platform/v1/master/${path}`, { token, body: payload, headers: { "if-match": `"${version}"` } });
    const beforeMidnight = await created("addons", addonBody());
    own.clock.advance(1);
    const atMidnight = await created("addons", addonBody());
    own.clock.advance(1);
    const afterMidnight = await created("addons", addonBody());
    const mine = new Set([beforeMidnight.id, atMidnight.id, afterMidnight.id]);
    const since = async (value: string): Promise<string[]> => {
      const res = await get(`addons?limit=200&updated_since=${encodeURIComponent(value)}`);
      assert.equal(res.status, 200, res.text);
      return (res.body.items as { id: string; code: string }[]).filter((item) => mine.has(item.id)).map((item) => item.code);
    };
    const fromMidnight = [atMidnight.code, afterMidnight.code];
    assert.deepEqual(await since("2026-11-01T00:00:00+09:00"), fromMidnight, "东京时间写法");
    assert.deepEqual(await since("2026-10-31T15:00:00Z"), fromMidnight, "UTC 写法：前一天、上个月");
    assert.deepEqual(await since("2026-10-31T15:00:00.000000Z"), fromMidnight);
    assert.deepEqual(await since("2026-10-31T10:00:00-05:00"), fromMidnight, "纽约时间写法");
    assert.deepEqual(await since("2026-10-31T20:30:00+05:30"), fromMidnight, "半小时时区");
    assert.deepEqual(await since("2026-10-31T23:59:59.999+09:00"), [beforeMidnight.code, ...fromMidnight], "差一毫秒到午夜");
    assert.deepEqual(await since("2026-11-01T00:00:00.001+09:00"), [afterMidnight.code]);
    assert.deepEqual(await since("2026-11-01T00:00:00.002+09:00"), []);
    // 修改会更新时间：之前的那条在改过之后重新出现在增量里
    own.clock.advance(60_000);
    assert.equal((await patch(`addons/${beforeMidnight.id}`, 1, { charge_unit: "per_order" })).status, 200);
    assert.deepEqual(await since("2026-11-01T00:00:30+09:00"), [beforeMidnight.code]);
    // 停用也算改动；没有变化的修改不算
    own.clock.advance(60_000);
    assert.equal((await post(`addons/${atMidnight.id}/disable`)).status, 200);
    assert.equal((await patch(`addons/${afterMidnight.id}`, 1, { charge_unit: "per_item" })).body.version, 1);
    assert.deepEqual(await since("2026-11-01T00:01:30+09:00"), [atMidnight.code]);
    // 返回的时间是带时区的 ISO 8601（UTC）
    assert.equal(atMidnight.created_at, "2026-10-31T15:00:00.000Z");
  } finally {
    await own.close();
  }
});
