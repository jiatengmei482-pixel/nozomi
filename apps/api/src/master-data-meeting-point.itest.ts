/**
 * M12-06：机场、航站楼的固定地址和集合地点说明（迁移 0700）。
 * 运营后台主数据地点的新增 / 修改接口收 airport、terminal 的 address 和 meeting_point，读接口（平台、租户）返回；
 * 其他类型不能填；格式不对 400；改动有审计日志；没有 master_data.manage 的 403；修改照样要 If-Match。
 * 全部经真实接口、真实 PostgreSQL；测试数据在这里构造，结束时连同 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { type ApiResponse, TEST_PASSWORD, type TestApi, createTestApi } from "./testing/api.ts";

let api: TestApi;
let root: string;
let editor: string;
let viewer: string;
let tenantToken: string;
let city: any;
let airport: any;
let station: any;
let poi: any;

async function staffToken(email: string, role: string): Promise<string> {
  const invited = await api.call("POST", "/platform/v1/staff", { token: root, body: { email, name: email, role } });
  assert.equal(invited.status, 201, invited.text);
  const accepted = await api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.body.invite.token, password: TEST_PASSWORD } });
  assert.equal(accepted.status, 200, accepted.text);
  const login = await api.platformLogin({ body: { email, password: TEST_PASSWORD } });
  return login.body.access_token as string;
}

const post = (path: string, body: unknown, token = editor): Promise<ApiResponse> => api.call("POST", `/platform/v1/master/${path}`, { token, body });
const get = (path: string, token = editor): Promise<ApiResponse> => api.call("GET", `/platform/v1/master/${path}`, { token });
const patch = (path: string, version: number | null, body: unknown, token = editor): Promise<ApiResponse> =>
  api.call("PATCH", `/platform/v1/master/${path}`, { token, body, ...(version === null ? {} : { headers: { "if-match": `"${version}"` } }) });

async function created(path: string, body: unknown): Promise<any> {
  api.clock.advance(1_000);
  const res = await post(path, body);
  assert.equal(res.status, 201, res.text);
  return res.body;
}

async function audit(id: string): Promise<any[]> {
  const res = await api.call("GET", `/platform/v1/audit-logs?resource=place&resource_id=${id}`, { token: root });
  assert.equal(res.status, 200, res.text);
  return (res.body.items as any[]).reverse();
}

function issuePaths(res: ApiResponse): string[] {
  assert.equal(res.status, 400, res.text);
  assert.equal(res.body.error.code, "VALIDATION_FAILED");
  return (res.body.error.details.issues as { path: string }[]).map((issue) => issue.path);
}

const snapshot = async (): Promise<string> =>
  JSON.stringify((await api.db.owner.query("select id, address, meeting_point, version from places order by id")).rows);

const HND_ADDRESS = "〒144-0041 東京都大田区羽田空港3-3-2";
const HND_MEETING = { zh: "到达大厅出口外的接机柜台前", ja: "到着ロビー出口の送迎カウンター前", en: "In front of the pickup counter outside the arrivals exit" };

before(async () => {
  api = await createTestApi();
  root = await api.superAdminToken();
  editor = await staffToken("master@meeting.test", "master_data");
  viewer = await staffToken("viewer@meeting.test", "readonly");
  tenantToken = (await api.tenantWithAdmin(root, "集合地点测试车队", "admin@meeting.test")).adminToken;
  city = await created("cities", { code: "CTY-JP-MTG", country_code: "JP", name: { zh: "东京" }, timezone: "Asia/Tokyo", center: { lng: 139.767125, lat: 35.681236 } });
  airport = await created("places", { type: "airport", code: "HND", city_id: city.id, name: { ja: "東京国際空港" }, location: { lng: 139.781111, lat: 35.553333 } });
  station = await created("places", { type: "station", code: "STN-JP-MTG", city_id: city.id, name: { zh: "东京站" }, location: { lng: 139.767125, lat: 35.681236 }, category: "rail" });
  poi = await created("places", { type: "poi", code: "POI-MTG1", city_id: city.id, name: { zh: "酒店" }, location: { lng: 139.7, lat: 35.6 }, category: "hotel" });
});
after(() => api.close());

test("机场：能填地址和集合地点（去掉首尾空白、只留填了的语言），平台和租户的读接口都返回；改了有审计日志", async () => {
  assert.equal(airport.address, null);
  assert.equal(airport.meeting_point, null);
  const res = await patch(`places/${airport.id}`, 1, { address: ` ${HND_ADDRESS} `, meeting_point: { zh: ` ${HND_MEETING.zh} `, ja: HND_MEETING.ja } });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual([res.body.address, res.body.meeting_point, res.body.version], [HND_ADDRESS, { zh: HND_MEETING.zh, ja: HND_MEETING.ja }, 2]);

  assert.deepEqual((await get(`places/${airport.id}`)).body.meeting_point, { zh: HND_MEETING.zh, ja: HND_MEETING.ja });
  const tenantOne = await api.call("GET", `/tenant/v1/master/places/${airport.id}`, { token: tenantToken });
  assert.equal(tenantOne.status, 200, tenantOne.text);
  assert.deepEqual([tenantOne.body.address, tenantOne.body.meeting_point], [HND_ADDRESS, { zh: HND_MEETING.zh, ja: HND_MEETING.ja }]);
  assert.equal("content_sources" in tenantOne.body, false, "导入来源不进应答");
  const tenantList = await api.call("GET", "/tenant/v1/master/places?code=HND", { token: tenantToken });
  assert.deepEqual(tenantList.body.items[0].meeting_point, { zh: HND_MEETING.zh, ja: HND_MEETING.ja });

  // 加一种语言；内容不变的修改不加版本、不写审计
  const more = await patch(`places/${airport.id}`, 2, { meeting_point: HND_MEETING });
  assert.deepEqual([more.status, more.body.meeting_point, more.body.version], [200, HND_MEETING, 3]);
  const same = await patch(`places/${airport.id}`, 3, { address: HND_ADDRESS, meeting_point: { en: HND_MEETING.en, ja: HND_MEETING.ja, zh: HND_MEETING.zh } });
  assert.deepEqual([same.status, same.body.version], [200, 3]);

  const logs = (await audit(airport.id)).filter((log) => log.action === "update");
  assert.equal(logs.length, 2);
  assert.deepEqual(logs[0].before, { address: null, meeting_point: null });
  assert.deepEqual(logs[0].after, { address: HND_ADDRESS, meeting_point: { zh: HND_MEETING.zh, ja: HND_MEETING.ja } });
  assert.deepEqual(logs[1].before, { meeting_point: { zh: HND_MEETING.zh, ja: HND_MEETING.ja } });
  assert.deepEqual(logs[1].after, { meeting_point: HND_MEETING });

  // 清空
  const cleared = await patch(`places/${airport.id}`, 3, { address: null, meeting_point: null });
  assert.deepEqual([cleared.status, cleared.body.address, cleared.body.meeting_point, cleared.body.version], [200, null, null, 4]);
  const back = await patch(`places/${airport.id}`, 4, { address: HND_ADDRESS, meeting_point: HND_MEETING });
  assert.equal(back.status, 200, back.text);
});

test("航站楼：新增时就能带地址和集合地点，之后能改；审计日志记新增时的值", async () => {
  const terminal = await created("places", {
    type: "terminal",
    code: "HND-T3",
    parent_id: airport.id,
    name: { zh: "第 3 航站楼" },
    location: { lng: 139.7686, lat: 35.5437 },
    flight_scope: "international",
    address: "〒144-0041 東京都大田区羽田空港2-6-5",
    meeting_point: { zh: "到达大厅" },
  });
  assert.deepEqual([terminal.address, terminal.meeting_point], ["〒144-0041 東京都大田区羽田空港2-6-5", { zh: "到达大厅" }]);
  const [created_] = await audit(terminal.id);
  assert.equal(created_.action, "create");
  assert.deepEqual([created_.after.address, created_.after.meeting_point], ["〒144-0041 東京都大田区羽田空港2-6-5", { zh: "到达大厅" }]);
  const changed = await patch(`places/${terminal.id}`, 1, { meeting_point: { zh: "到达大厅 1 号柱旁", en: "Arrivals lobby, pillar 1" } });
  assert.deepEqual([changed.status, changed.body.meeting_point], [200, { zh: "到达大厅 1 号柱旁", en: "Arrivals lobby, pillar 1" }]);
});

test("类型不对：车站、出口不能有地址，车站、出口、地标不能有集合地点（新增和修改都 400，数据库不变）", async () => {
  const exit = await created("places", { type: "exit", code: "STN-JP-MTG-E1", parent_id: station.id, name: { zh: "北口" }, location: { lng: 139.767, lat: 35.682 } });
  const before = await snapshot();
  assert.deepEqual(issuePaths(await patch(`places/${station.id}`, 1, { address: "某处" })), ["/address"]);
  assert.deepEqual(issuePaths(await patch(`places/${exit.id}`, 1, { address: "某处" })), ["/address"]);
  for (const place of [station, exit, poi]) {
    assert.deepEqual(issuePaths(await patch(`places/${place.id}`, 1, { meeting_point: { zh: "某处" } })), ["/meeting_point"], place.code);
  }
  assert.deepEqual(issuePaths(await post("places", { type: "poi", code: "POI-MTG2", city_id: city.id, name: { zh: "商场" }, location: { lng: 139.7, lat: 35.6 }, category: "mall", meeting_point: { zh: "某处" } })), ["/meeting_point"]);
  assert.equal(await snapshot(), before);
  // 地标的地址照旧能填、能清空
  const ok = await patch(`places/${poi.id}`, 1, { address: "東京都港区 1-1", meeting_point: null });
  assert.deepEqual([ok.status, ok.body.address, ok.body.meeting_point], [200, "東京都港区 1-1", null]);
});

test("格式不对 400：集合地点空对象、不认识的语言、只有空白、超过 1000 字、不是对象；地址只有空白、超过 300 字", async () => {
  const current = (await get(`places/${airport.id}`)).body;
  const before = await snapshot();
  const cases: [string, unknown, string][] = [
    ["空对象", { meeting_point: {} }, "/meeting_point"],
    ["不认识的语言", { meeting_point: { zh: "到达大厅", ko: "도착 로비" } }, "/meeting_point"],
    ["只有空白", { meeting_point: { zh: "   " } }, "/meeting_point/zh"],
    ["零宽空格", { meeting_point: { ja: "​" } }, "/meeting_point/ja"],
    ["超过 1000 字", { meeting_point: { en: "x".repeat(1001) } }, "/meeting_point/en"],
    ["不是对象", { meeting_point: "到达大厅" }, "/meeting_point"],
    ["语言的值不是文字", { meeting_point: { zh: 1 } }, "/meeting_point/zh"],
    ["地址只有空白", { address: "  " }, "/address"],
    ["地址超过 300 字", { address: "x".repeat(301) }, "/address"],
  ];
  for (const [what, body, path] of cases) {
    assert.deepEqual(issuePaths(await patch(`places/${airport.id}`, current.version, body)), [path], what);
  }
  const fine = await patch(`places/${airport.id}`, current.version, { meeting_point: { zh: "x".repeat(1000) } });
  assert.equal(fine.status, 200, "正好 1000 字可以");
  const restored = await patch(`places/${airport.id}`, fine.body.version, { meeting_point: HND_MEETING });
  assert.equal(restored.status, 200);
  assert.notEqual(await snapshot(), before);
});

test("权限和版本号：只读角色、租户改不了；不带 If-Match 428，版本不对 409", async () => {
  const current = (await get(`places/${airport.id}`)).body;
  const before = await snapshot();
  assert.equal((await patch(`places/${airport.id}`, current.version, { meeting_point: { zh: "改" } }, viewer)).status, 403);
  assert.equal((await post("places", { type: "terminal", code: "HND-T9", parent_id: airport.id, name: { zh: "T9" }, location: { lng: 139.78, lat: 35.55 }, meeting_point: { zh: "改" } }, viewer)).status, 403);
  assert.equal((await api.call("PATCH", `/tenant/v1/master/places/${airport.id}`, { token: tenantToken, body: { meeting_point: { zh: "改" } }, headers: { "if-match": `"${current.version}"` } })).status, 404);
  const noVersion = await patch(`places/${airport.id}`, null, { meeting_point: { zh: "改" } });
  assert.equal(noVersion.status, 428, noVersion.text);
  const stale = await patch(`places/${airport.id}`, current.version - 1, { meeting_point: { zh: "改" } });
  assert.deepEqual([stale.status, stale.body.error.code], [409, "VERSION_CONFLICT"]);
  assert.equal(await snapshot(), before);
});

test("数据库兜底：绕过接口也写不进车站的地址、地标的集合地点、空的或语言不认识的集合地点", async () => {
  const attempts: [string, string, unknown[]][] = [
    ["车站的地址", "update places set address = 'x' where id = $1", [station.id]],
    ["地标的集合地点", "update places set meeting_point = '{\"zh\":\"x\"}' where id = $1", [poi.id]],
    ["空的集合地点", "update places set meeting_point = '{}' where id = $1", [airport.id]],
    ["不认识的语言", "update places set meeting_point = '{\"ko\":\"x\"}' where id = $1", [airport.id]],
    ["只有空白", "update places set meeting_point = '{\"zh\":\"  \"}' where id = $1", [airport.id]],
    ["超过 1000 字", `update places set meeting_point = jsonb_build_object('zh', repeat('x', 1001)) where id = $1`, [airport.id]],
    ["值不是文字", "update places set meeting_point = '{\"zh\":1}' where id = $1", [airport.id]],
    ["不是对象", "update places set meeting_point = '[\"x\"]' where id = $1", [airport.id]],
    ["机场的地址只有空白", "update places set address = '  ' where id = $1", [airport.id]],
  ];
  for (const [what, sql, params] of attempts) {
    await assert.rejects(api.db.owner.query(sql, params), /check constraint/, what);
  }
});
