/**
 * M1-02：区域管理的接口。验收标准 1（保存多边形和圆）、2（禁行区优先、自测一个坐标）。
 * 跨租户的验证在 tenant-isolation.itest.ts；这里是单个供应商视角下的全部规则。
 * 全部经真实接口、真实 PostgreSQL；测试数据都在这里构造，结束时连同 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AREA_LIMITS, circleToRing, ringToGeoJson } from "@nozomi/domain";
import { type ApiResponse, TEST_PASSWORD, type TenantFixture, type TestApi, addTenantUser, createTestApi } from "./testing/api.ts";

let api: TestApi;
let root: string;
let tenant: TenantFixture;
let tokyo: any;
let osaka: any;
const MISSING = "99999999-9999-4999-8999-999999999999";

/** 以 (lng, lat) 为左下角、边长 size 度的正方形（GeoJSON，闭合）。 */
const square = (lng: number, lat: number, size: number): unknown => ({
  type: "Polygon",
  coordinates: [[[lng, lat], [lng + size, lat], [lng + size, lat + size], [lng, lat + size], [lng, lat]]],
});
const operate = (lng = 139.6, lat = 35.6, size = 0.2): Record<string, unknown> => ({ kind: "operate", geometry: square(lng, lat, size) });
const forbid = (lng = 139.68, lat = 35.68, size = 0.02): Record<string, unknown> => ({ kind: "forbid", geometry: square(lng, lat, size) });

let serial = 0;
const body = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  city_id: tokyo.id,
  name: { zh: `测试区域 ${(serial += 1)}` },
  biz_type: "general",
  polygons: [operate()],
  ...extra,
});

const call = (method: "GET" | "POST" | "PUT" | "DELETE", path: string, options: { token?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<ApiResponse> =>
  api.call(method, `/tenant/v1${path}`, { token: options.token ?? tenant.adminToken, ...(options.body === undefined ? {} : { body: options.body }), ...(options.headers ? { headers: options.headers } : {}) });

const post = (payload: unknown, key: string = randomUUID(), token?: string): Promise<ApiResponse> =>
  call("POST", "/areas", { body: payload, headers: { "idempotency-key": key }, ...(token ? { token } : {}) });
const put = (id: string, version: number | null, payload: unknown, token?: string): Promise<ApiResponse> =>
  call("PUT", `/areas/${id}`, { body: payload, ...(version === null ? {} : { headers: { "if-match": `"${version}"` } }), ...(token ? { token } : {}) });

async function created(extra: Record<string, unknown> = {}): Promise<any> {
  api.clock.advance(1_000);
  const res = await post(body(extra));
  assert.equal(res.status, 201, res.text);
  return res.body;
}

function issues(res: ApiResponse): { path: string; reason?: string; detail?: unknown }[] {
  assert.equal(res.status, 400, res.text);
  assert.equal(res.body.error.code, "VALIDATION_FAILED");
  return res.body.error.details.issues;
}

async function audits(areaId: string): Promise<any[]> {
  return (await api.db.owner.query("select action, tenant_id, actor_type, actor_email, source, before, after from audit_logs where resource = 'area' and resource_id = $1 order by id", [areaId])).rows;
}

async function counts(): Promise<[number, number, number]> {
  const row = (await api.db.owner.query("select (select count(*)::int from areas) as a, (select count(*)::int from area_polygons) as p, (select count(*)::int from audit_logs where resource = 'area') as l")).rows[0];
  return [row.a, row.p, row.l];
}

before(async () => {
  api = await createTestApi();
  root = await api.superAdminToken();
  tenant = await api.tenantWithAdmin(root, "甲车队", "admin@a.test");
  const city = async (code: string, name: string, lng: number, lat: number): Promise<any> => {
    const res = await api.call("POST", "/platform/v1/master/cities", { token: root, body: { code, country_code: "JP", name: { zh: name }, timezone: "Asia/Tokyo", center: { lng, lat } } });
    assert.equal(res.status, 201, res.text);
    return res.body;
  };
  tokyo = await city("CTY-JP-TYO", "东京", 139.6917, 35.6895);
  osaka = await city("CTY-JP-OSA", "大阪", 135.5011, 34.6938);
});
after(() => api.close());

test("迁移之后没有任何区域（没有预置数据）；空列表", async () => {
  assert.deepEqual(await counts(), [0, 0, 0]);
  assert.deepEqual((await call("GET", "/areas")).body, { items: [], next_cursor: null, total: 0 });
});

test("新增：多边形和圆一起保存；返回完整的区域——城市信息、块数、每块的序号、整理过的图形；写审计日志", async () => {
  const res = await post({
    city_id: tokyo.id,
    name: { zh: " 东京 23 区 ", ja: "東京23区" },
    biz_type: "airport_transfer",
    polygons: [
      { kind: "operate", label: " 市区 ", source: "pasted", geometry: { type: "Polygon", coordinates: [[[139.6, 35.6], [139.6, 35.8], [139.8000004, 35.8], [139.8, 35.6], [139.6, 35.6]]] } },
      { kind: "forbid", circle: { center: { lat: 35.685175, lng: 139.752799 }, radius_m: 1500 } },
      { kind: "operate", geometry: square(139.9, 35.6, 0.1) },
    ],
  });
  assert.equal(res.status, 201, res.text);
  const area = res.body;
  assert.deepEqual(Object.keys(area).sort(), [
    "biz_type", "city", "city_id", "created_at", "forbid_polygon_count", "id", "name", "operate_polygon_count", "polygons", "status", "updated_at", "version",
  ]);
  assert.deepEqual(
    [area.name, area.city_id, area.biz_type, area.status, area.version, area.operate_polygon_count, area.forbid_polygon_count],
    [{ zh: "东京 23 区", ja: "東京23区" }, tokyo.id, "airport_transfer", "active", 1, 2, 1],
  );
  assert.deepEqual(area.city, { id: tokyo.id, code: "CTY-JP-TYO", name: { zh: "东京" }, status: "active", center: { lng: 139.6917, lat: 35.6895 }, boundary: null });
  const [first, circle, third] = area.polygons;
  assert.deepEqual([first.kind, first.seq, first.label, first.source, first.circle], ["operate", 1, "市区", "pasted", null]);
  // 顺时针提交的被整理成逆时针（第一个点不变）、6 位小数、闭合
  assert.deepEqual(first.geometry, { type: "Polygon", coordinates: [[[139.6, 35.6], [139.8, 35.6], [139.8, 35.8], [139.6, 35.8], [139.6, 35.6]]] });
  assert.deepEqual([circle.kind, circle.seq, circle.label, circle.source, circle.circle], ["forbid", 1, null, "circle", { center: { lat: 35.685175, lng: 139.752799 }, radius_m: 1500 }]);
  assert.deepEqual(circle.geometry, ringToGeoJson(circleToRing({ lat: 35.685175, lng: 139.752799 }, 1500)), "圆的多边形由后端用 domain 的同一个函数算出");
  assert.equal(circle.geometry.coordinates[0].length, 65);
  assert.deepEqual([third.kind, third.seq, third.source], ["operate", 2, "drawn"]);
  assert.equal(new Set(area.polygons.map((polygon: any) => polygon.id)).size, 3);

  assert.deepEqual((await call("GET", `/areas/${area.id}`)).body, area);
  const logs = await audits(area.id);
  assert.equal(logs.length, 1);
  assert.deepEqual([logs[0].action, logs[0].tenant_id, logs[0].actor_type, logs[0].actor_email, logs[0].source, logs[0].before], ["create", tenant.tenantId, "tenant_user", "admin@a.test", "console", null]);
  assert.deepEqual([logs[0].after.city_id, logs[0].after.name, logs[0].after.biz_type, logs[0].after.status, logs[0].after.polygons.length], [tokyo.id, area.name, "airport_transfer", "active", 3]);
  assert.deepEqual(logs[0].after.polygons[0], { kind: "operate", seq: 1, label: "市区", source: "pasted", circle: null, ring: [[139.6, 35.6], [139.8, 35.6], [139.8, 35.8], [139.6, 35.8]] });
});

test("新增：字段和图形逐项校验，每条问题带路径和原因代码；不合格的什么都不写", async () => {
  const before = await counts();
  const bowtie = { type: "Polygon", coordinates: [[[139, 35], [139.2, 35.2], [139.2, 35], [139, 35.2], [139, 35]]] };
  const many = (points: number): unknown => ({
    type: "Polygon",
    coordinates: [Array.from({ length: points }, (_, i) => [Math.round((139 + Math.cos((2 * Math.PI * i) / points)) * 1e6) / 1e6, Math.round((35 + Math.sin((2 * Math.PI * i) / points)) * 1e6) / 1e6])],
  });
  const cases: [string, Record<string, unknown>, string, string | undefined][] = [
    ["没有名称", { name: {} }, "/name", undefined],
    ["名称只有空白", { name: { zh: "  " } }, "/name/zh", undefined],
    ["名称超过 100 个字", { name: { zh: "区".repeat(101) } }, "/name/zh", undefined],
    ["不支持的语言", { name: { fr: "Tokyo" } }, "/name", undefined],
    ["业务类型不存在", { biz_type: "bus" }, "/biz_type", undefined],
    ["缺城市", { city_id: undefined }, "/city_id", undefined],
    ["城市编号格式不对", { city_id: "tokyo" }, "/city_id", undefined],
    ["城市不存在", { city_id: MISSING }, "/city_id", undefined],
    ["没有图形", { polygons: [] }, "/polygons", "NO_OPERATE_POLYGON"],
    ["只有禁行区", { polygons: [forbid()] }, "/polygons", "NO_OPERATE_POLYGON"],
    ["图形类型不存在", { polygons: [{ kind: "park", geometry: square(139, 35, 1) }] }, "/polygons/0/kind", undefined],
    ["既没有 geometry 也没有 circle", { polygons: [{ kind: "operate" }] }, "/polygons/0/geometry", undefined],
    ["不是 Polygon", { polygons: [{ kind: "operate", geometry: { type: "MultiPolygon", coordinates: [] } }] }, "/polygons/0/geometry/type", undefined],
    ["带洞", { polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [(square(139, 35, 1) as any).coordinates[0], (square(139.4, 35.4, 0.1) as any).coordinates[0]] } }] }, "/polygons/0/geometry", "HAS_HOLES"],
    ["点太少", { polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [[[139, 35], [140, 35], [139, 35]]] } }] }, "/polygons/0/geometry", "TOO_FEW_POINTS"],
    ["相邻的点重合", { polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [[[139, 35], [139, 35], [140, 35], [140, 36]]] } }] }, "/polygons/0/geometry", "DUPLICATE_POINT"],
    ["边交叉", { polygons: [operate(), { kind: "forbid", geometry: bowtie }] }, "/polygons/1/geometry", "SELF_INTERSECTION"],
    ["所有点在一条线上", { polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [[[139, 35], [139.5, 35.5], [140, 36]]] } }] }, "/polygons/0/geometry", "COLLINEAR"],
    ["跨过 180° 经线", { polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [[[179, 0], [-179, 0], [-179, 1], [179, 1]]] } }] }, "/polygons/0/geometry", "CROSSES_ANTIMERIDIAN"],
    ["坐标超出范围", { polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [[[139, 35], [140, 95], [141, 35]]] } }] }, "/polygons/0/geometry", "INVALID_COORDINATE"],
    ["坐标不是数字", { polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [[["139", 35], [140, 35], [140, 36]]] } }] }, "/polygons/0/geometry/coordinates/0/0/0", undefined],
    ["一个多边形 1001 个点", { polygons: [{ kind: "operate", geometry: many(1001) }] }, "/polygons/0/geometry", "TOO_MANY_VERTICES"],
    ["51 块图形", { polygons: Array.from({ length: 51 }, () => operate()) }, "/polygons", "TOO_MANY_POLYGONS"],
    ["顶点总数超过 5000", { polygons: Array.from({ length: 6 }, () => ({ kind: "operate", geometry: many(900) })) }, "/polygons", "TOO_MANY_TOTAL_VERTICES"],
    ["圆的半径太小", { polygons: [{ kind: "operate", circle: { center: { lat: 35.6, lng: 139.7 }, radius_m: 99 } }] }, "/polygons/0/circle/radius_m", "RADIUS_OUT_OF_RANGE"],
    ["圆的半径太大", { polygons: [{ kind: "operate", circle: { center: { lat: 35.6, lng: 139.7 }, radius_m: 100_001 } }] }, "/polygons/0/circle/radius_m", "RADIUS_OUT_OF_RANGE"],
    ["圆的半径不是整数米", { polygons: [{ kind: "operate", circle: { center: { lat: 35.6, lng: 139.7 }, radius_m: 1500.5 } }] }, "/polygons/0/circle/radius_m", "RADIUS_OUT_OF_RANGE"],
    ["圆心超出范围", { polygons: [{ kind: "operate", circle: { center: { lat: 95, lng: 139.7 }, radius_m: 1500 } }] }, "/polygons/0/circle/center", "INVALID_COORDINATE"],
    ["来源写 circle 却没有圆心半径", { polygons: [{ kind: "operate", source: "circle", geometry: square(139, 35, 1) }] }, "/polygons/0/circle", undefined],
    ["新增时带了图形编号", { polygons: [{ ...operate(), id: MISSING }] }, "/polygons/0/id", "UNKNOWN_POLYGON"],
    ["备注名超过 40 个字", { polygons: [{ ...operate(), label: "名".repeat(41) }] }, "/polygons/0/label", undefined],
    ["备注名只有空白", { polygons: [{ ...operate(), label: " " }] }, "/polygons/0/label", undefined],
  ];
  for (const [label, override, path, reason] of cases) {
    const found = issues(await post(body(override)));
    const hit = found.find((issue) => issue.path === path);
    assert.ok(hit, `${label}：${JSON.stringify(found)}`);
    assert.equal(hit.reason, reason, label);
  }
  // 边交叉时带出交叉的两条边的点号
  const crossing = issues(await post(body({ polygons: [{ kind: "operate", geometry: bowtie }] })));
  assert.deepEqual(crossing, [{ path: "/polygons/0/geometry", reason: "SELF_INTERSECTION", message: "有两条边交叉了", detail: { a: 1, b: 3 } }]);
  // 正好在上限上的可以：50 块、每块 100 个点（合计 5000）
  const atLimit = await post(body({ polygons: Array.from({ length: 50 }, (_, i) => ({ kind: i === 0 ? "operate" : "forbid", geometry: many(100) })) }));
  assert.equal(atLimit.status, 201, atLimit.text);
  assert.equal((await call("DELETE", `/areas/${atLimit.body.id}`)).status, 204);
  assert.deepEqual((await counts()).slice(0, 2), before.slice(0, 2));
  assert.equal(AREA_LIMITS.maxPolygons, 50);
});

test("幂等：没带键是 400；同一个键同样的内容再来，原样返回第一次的应答，只建一个区域、只记一条日志；同一个键不同内容是 422", async () => {
  const payload = body();
  const missing = await call("POST", "/areas", { body: payload });
  assert.deepEqual(issues(missing).map((issue) => issue.path), ["/idempotency-key"]);
  assert.equal(missing.body.error.details.location, "headers");
  for (const bad of ["short", "有中文的键-12345678", "x".repeat(129), "has space 12345678"]) {
    assert.equal((await call("POST", "/areas", { body: payload, headers: { "idempotency-key": encodeURIComponent(bad) === bad ? bad : "bad key!" } })).status, 400, bad);
  }
  const before = await counts();
  const key = randomUUID();
  const first = await post(payload, key);
  assert.equal(first.status, 201, first.text);
  api.clock.advance(60_000);
  const again = await post(payload, key);
  assert.equal(again.status, 201);
  assert.deepEqual(again.body, first.body);
  // 键的先后不同、内容相同，算同一个请求
  const reordered = await post({ polygons: payload["polygons"], biz_type: payload["biz_type"], name: payload["name"], city_id: payload["city_id"] }, key);
  assert.deepEqual([reordered.status, reordered.body.id], [201, first.body.id]);
  const after = await counts();
  assert.deepEqual([after[0] - before[0], after[2] - before[2]], [1, 1]);
  // 同一个键配了不同的内容
  const different = await post({ ...payload, biz_type: "charter" }, key);
  assert.deepEqual([different.status, different.body.error.code], [422, "IDEMPOTENCY_KEY_REUSED"]);
  // 应答丢了、改了内容再存的出路：错误里带着上一次建成的那条，凭它可以转成修改
  assert.deepEqual(different.body.error.details, { created: { id: first.body.id, version: first.body.version } });
  const { created: earlier } = different.body.error.details;
  const adopted = await put(earlier.id, earlier.version, { name: payload["name"], biz_type: "charter", polygons: payload["polygons"] });
  assert.deepEqual([adopted.status, adopted.body.id, adopted.body.biz_type, adopted.body.version], [200, first.body.id, "charter", first.body.version + 1]);
  // 第一次的结果后来被改了、删了，带同一个键再来仍然返回当时的应答，不会再建一个
  assert.equal((await call("DELETE", `/areas/${first.body.id}`)).status, 204);
  assert.deepEqual((await post(payload, key)).body, first.body);
  assert.equal((await counts())[0], before[0]);
  // 失败的请求不占用键：修好以后可以带同一个键重试
  const retryKey = randomUUID();
  assert.equal((await post(body({ polygons: [] }), retryKey)).status, 400);
  const fixed = body();
  assert.equal((await post(fixed, retryKey)).status, 201);
  // 同一个键同时来两次：只建一个，两次的应答一样
  const raceKey = randomUUID();
  const racePayload = body();
  const [x, y] = await Promise.all([post(racePayload, raceKey), post(racePayload, raceKey)]);
  assert.deepEqual([x.status, y.status, x.body.id], [201, 201, y.body.id]);
});

test("同一个城市里不能重名：不分大小写、全角半角、不看是哪种语言；别的城市可以用同样的名字；改名时也查", async () => {
  const first = await created({ name: { zh: "成田机场周边", en: "Narita Area" } });
  for (const name of [{ zh: "成田机场周边" }, { en: "NARITA  area" }, { ja: "成田机场周边" }, { zh: "另一个", en: "Ｎａｒｉｔａ Ａｒｅａ" }]) {
    const res = await post(body({ name }));
    assert.deepEqual([res.status, res.body.error.code, res.body.error.message], [409, "AREA_NAME_TAKEN", "这个城市已经有同名的区域，请换一个名字"], JSON.stringify(name));
  }
  const elsewhere = await created({ city_id: osaka.id, name: { zh: "成田机场周边" } });
  assert.equal(elsewhere.city.code, "CTY-JP-OSA");
  const other = await created({ name: { zh: "别的名字" } });
  const renamed = await put(other.id, 1, { name: { zh: "成田机场周边" }, biz_type: "general", polygons: other.polygons });
  assert.equal(renamed.body.error.code, "AREA_NAME_TAKEN");
  // 自己和自己不算重名；删掉以后名字可以再用
  assert.equal((await put(first.id, 1, { name: { zh: "成田机场周边", en: "Narita Area", ja: "成田空港周辺" }, biz_type: "general", polygons: first.polygons })).status, 200);
  assert.equal((await call("DELETE", `/areas/${first.id}`)).status, 204);
  assert.equal((await post(body({ name: { zh: "成田机场周边" } }))).status, 201);
  // 同时用同一个名字新增：只有一个成功
  const racing = await Promise.all([post(body({ name: { zh: "抢名字" } })), post(body({ name: { zh: "抢名字" } }))]);
  assert.deepEqual(racing.map((res) => res.status).sort(), [201, 409]);
});

test("修改：必须带版本号；版本过期 409；名称、业务类型、图形整体替换；保留的图形编号和序号不变，新图形的序号往上数、删掉的序号不再用；审计只记变了的", async () => {
  const area = await created({ polygons: [operate(), forbid(), forbid(139.7, 35.7, 0.01)] });
  const [o1, f1, f2] = area.polygons;
  assert.deepEqual([o1.seq, f1.seq, f2.seq], [1, 1, 2]);
  const base = { name: area.name, biz_type: area.biz_type };
  assert.deepEqual([(await put(area.id, null, { ...base, polygons: area.polygons })).status], [428]);
  assert.equal((await put(area.id, 9, { ...base, polygons: area.polygons })).body.error.code, "VERSION_CONFLICT");

  // 原样提交回去（应答里的字段照搬）：没有变化，版本不变，不写日志
  const same = await put(area.id, 1, { ...base, city_id: tokyo.id, polygons: area.polygons });
  assert.deepEqual([same.status, same.body.version], [200, 1]);
  assert.deepEqual(same.body, area);
  assert.equal((await audits(area.id)).length, 1);

  // 删掉禁行 2，改禁行 1 的备注名，加一块禁行区和一个圆形营运区
  const updated = await put(area.id, 1, {
    name: { zh: "改过的名字" },
    biz_type: "charter",
    polygons: [o1, { ...f1, label: "皇居周边" }, forbid(139.75, 35.75, 0.01), { kind: "operate", circle: { center: { lat: 35.5, lng: 139.5 }, radius_m: 2000 } }],
  });
  assert.equal(updated.status, 200, updated.text);
  assert.deepEqual([updated.body.version, updated.body.name, updated.body.biz_type, updated.body.operate_polygon_count, updated.body.forbid_polygon_count], [2, { zh: "改过的名字" }, "charter", 2, 2]);
  const polygons = updated.body.polygons;
  assert.deepEqual(polygons.map((polygon: any) => [polygon.kind, polygon.seq, polygon.label, polygon.source]), [
    ["operate", 1, null, "drawn"],
    ["forbid", 1, "皇居周边", "drawn"],
    ["forbid", 3, null, "drawn"],
    ["operate", 2, null, "circle"],
  ]);
  assert.deepEqual([polygons[0].id, polygons[1].id], [o1.id, f1.id], "保留的图形编号不变");
  assert.ok(![o1.id, f1.id, f2.id].includes(polygons[2].id));
  const logs = await audits(area.id);
  assert.deepEqual(logs.map((log) => log.action), ["create", "update"]);
  assert.deepEqual(Object.keys(logs[1].before).sort(), ["biz_type", "name", "polygons"]);
  assert.deepEqual([logs[1].before.name, logs[1].after.name, logs[1].before.biz_type, logs[1].after.biz_type], [area.name, { zh: "改过的名字" }, "general", "charter"]);
  assert.deepEqual([logs[1].before.polygons.length, logs[1].after.polygons.length], [3, 4]);

  // 只改图形：圆改半径（多边形跟着重算）、把一块禁行区改成营运区（编号不变，序号按新的一类往上数）
  const circle = polygons[3];
  const reshaped = await put(area.id, 2, {
    name: updated.body.name,
    biz_type: "charter",
    polygons: [polygons[0], polygons[1], { ...polygons[2], kind: "operate" }, { ...circle, circle: { ...circle.circle, radius_m: 5000 } }],
  });
  assert.equal(reshaped.status, 200, reshaped.text);
  assert.deepEqual(reshaped.body.polygons.map((polygon: any) => [polygon.id, polygon.kind, polygon.seq]), [
    [polygons[0].id, "operate", 1], [polygons[1].id, "forbid", 1], [polygons[2].id, "operate", 3], [circle.id, "operate", 2],
  ]);
  assert.deepEqual(reshaped.body.polygons[3].geometry, ringToGeoJson(circleToRing({ lat: 35.5, lng: 139.5 }, 5000)));
  assert.deepEqual(Object.keys((await audits(area.id))[2].before), ["polygons"]);
  // 圆「转成多边形」：不带 circle、带 geometry，来源变成 drawn
  const converted = await put(area.id, 3, { name: updated.body.name, biz_type: "charter", polygons: [{ id: circle.id, kind: "operate", source: "drawn", geometry: reshaped.body.polygons[3].geometry }] });
  assert.deepEqual([converted.body.polygons[0].source, converted.body.polygons[0].circle, converted.body.polygons[0].seq, converted.body.polygons[0].geometry.coordinates[0].length], ["drawn", null, 2, 65]);

  // 不能改城市；别的区域的图形编号、重复的编号、不合格的图形都被拒绝，什么都不变
  const locked = await put(area.id, 4, { city_id: osaka.id, name: updated.body.name, biz_type: "charter", polygons: converted.body.polygons });
  assert.deepEqual([locked.status, locked.body.error.code, locked.body.error.details], [409, "FIELD_LOCKED", { fields: ["city_id"] }]);
  const stranger = await created();
  const foreign = issues(await put(area.id, 4, { name: updated.body.name, biz_type: "charter", polygons: [{ ...converted.body.polygons[0], id: stranger.polygons[0].id }] }));
  assert.deepEqual([foreign[0]?.path, foreign[0]?.reason], ["/polygons/0/id", "UNKNOWN_POLYGON"]);
  const twice = issues(await put(area.id, 4, { name: updated.body.name, biz_type: "charter", polygons: [converted.body.polygons[0], converted.body.polygons[0]] }));
  assert.equal(twice[0]?.path, "/polygons/1/id");
  assert.equal(issues(await put(area.id, 4, { name: updated.body.name, biz_type: "charter", polygons: [] }))[0]?.reason, "NO_OPERATE_POLYGON");
  assert.deepEqual((await call("GET", `/areas/${area.id}`)).body, converted.body);
  assert.equal((await put(MISSING, 1, { ...base, polygons: [operate()] })).status, 404);
  assert.equal((await put("not-a-uuid", 1, { ...base, polygons: [operate()] })).status, 404);
});

test("两个人同时改同一个区域：只有一个成功，另一个 409，不互相覆盖", async () => {
  const area = await created();
  const [x, y] = await Promise.all([
    put(area.id, 1, { name: { zh: "甲改的名字" }, biz_type: "general", polygons: area.polygons }),
    put(area.id, 1, { name: { zh: "乙改的名字" }, biz_type: "general", polygons: area.polygons }),
  ]);
  assert.deepEqual([x.status, y.status].sort(), [200, 409]);
  assert.equal((await call("GET", `/areas/${area.id}`)).body.version, 2);
});

test("停用和启用：改状态、版本加一、各写一条日志；重复调用不重复记；停用的区域照常能看、能改、能自测", async () => {
  const area = await created();
  const disabled = await call("POST", `/areas/${area.id}/disable`);
  assert.deepEqual([disabled.status, disabled.body.status, disabled.body.version], [200, "disabled", 2]);
  assert.deepEqual((await call("POST", `/areas/${area.id}/disable`)).body, disabled.body);
  assert.equal((await put(area.id, 2, { name: { zh: "停用时改的名字" }, biz_type: "general", polygons: area.polygons })).body.status, "disabled");
  assert.equal((await call("POST", `/areas/${area.id}/check-point`, { body: { lat: 35.7, lng: 139.7 } })).body.result, "operate");
  const enabled = await call("POST", `/areas/${area.id}/enable`);
  assert.deepEqual([enabled.body.status, enabled.body.version], ["active", 4]);
  assert.deepEqual((await audits(area.id)).map((log) => [log.action, log.before?.status, log.after?.status]), [
    ["create", undefined, "active"], ["disable", "active", "disabled"], ["update", undefined, undefined], ["enable", "disabled", "active"],
  ]);
  assert.equal((await call("POST", `/areas/${MISSING}/disable`)).status, 404);
  assert.equal((await call("POST", `/areas/${MISSING}/enable`)).status, 404);
});

test("所属城市必须是平台启用中的城市：停用的城市下不能新增；城市后来被停用，区域原样保留、能看能改能停用，但不能再启用", async () => {
  const area = await created({ city_id: osaka.id });
  assert.equal((await api.call("POST", `/platform/v1/master/cities/${osaka.id}/disable`, { token: root })).status, 200);
  const blocked = await post(body({ city_id: osaka.id }));
  assert.deepEqual([blocked.status, blocked.body.error.code, blocked.body.error.details], [409, "MASTER_DATA_NOT_READY", { reason: "CITY_DISABLED" }]);
  const seen = await call("GET", `/areas/${area.id}`);
  assert.deepEqual([seen.body.status, seen.body.city.status], ["active", "disabled"], "区域的状态不跟着城市变；城市的状态在应答里看得到");
  assert.equal((await put(area.id, 1, { name: { zh: "城市停用后改的名字" }, biz_type: "general", polygons: area.polygons })).status, 200);
  assert.equal((await call("POST", `/areas/${area.id}/disable`)).body.status, "disabled");
  const enable = await call("POST", `/areas/${area.id}/enable`);
  assert.deepEqual([enable.status, enable.body.error.code, enable.body.error.details], [409, "MASTER_DATA_NOT_READY", { reason: "CITY_DISABLED" }]);
  assert.equal((await api.call("POST", `/platform/v1/master/cities/${osaka.id}/enable`, { token: root })).status, 200);
  assert.equal((await call("POST", `/areas/${area.id}/enable`)).body.status, "active");
});

test("删除：真的删掉（连同图形），删除前的完整内容记在日志里；之后是 404", async () => {
  const area = await created({ polygons: [operate(), forbid()] });
  const before = await counts();
  const res = await call("DELETE", `/areas/${area.id}`);
  assert.deepEqual([res.status, res.text], [204, ""]);
  const afterDelete = await counts();
  assert.deepEqual([before[0] - afterDelete[0], before[1] - afterDelete[1]], [1, 2]);
  assert.equal((await call("GET", `/areas/${area.id}`)).status, 404);
  assert.equal((await call("DELETE", `/areas/${area.id}`)).status, 404);
  assert.equal((await call("POST", `/areas/${area.id}/check-point`, { body: { lat: 35.7, lng: 139.7 } })).status, 404);
  const logs = await audits(area.id);
  assert.deepEqual([logs[1].action, logs[1].after, logs[1].before.name, logs[1].before.polygons.length], ["delete", null, area.name, 2]);
});

test("自测（验收标准 2）：禁行区优先；在营运区里、在禁行区里（同时在营运区里也列出来）、都不在；边上算在里面；不管在不在都是 200", async () => {
  const area = await created({ polygons: [operate(139.6, 35.6, 0.2), operate(139.7, 35.7, 0.2), forbid(139.68, 35.68, 0.04), forbid(140.5, 36.5, 0.1)] });
  const [o1, o2, f1, f2] = area.polygons.map((polygon: any) => polygon.id);
  const check = async (lat: number, lng: number): Promise<any> => {
    const res = await call("POST", `/areas/${area.id}/check-point`, { body: { lat, lng } });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(Object.keys(res.body).sort(), ["forbid_polygon_ids", "operate_polygon_ids", "result"]);
    return res.body;
  };
  assert.deepEqual(await check(35.62, 139.62), { result: "operate", operate_polygon_ids: [o1], forbid_polygon_ids: [] });
  assert.deepEqual(await check(35.75, 139.75), { result: "operate", operate_polygon_ids: [o1, o2], forbid_polygon_ids: [] });
  assert.deepEqual(await check(35.69, 139.69), { result: "forbid", operate_polygon_ids: [o1], forbid_polygon_ids: [f1] });
  assert.deepEqual(await check(35.71, 139.71), { result: "forbid", operate_polygon_ids: [o1, o2], forbid_polygon_ids: [f1] });
  assert.deepEqual(await check(36.55, 140.55), { result: "forbid", operate_polygon_ids: [], forbid_polygon_ids: [f2] });
  assert.deepEqual(await check(34, 135), { result: "outside", operate_polygon_ids: [], forbid_polygon_ids: [] });
  assert.equal((await check(35.6, 139.65)).result, "operate", "营运区的边上算在里面");
  assert.equal((await check(35.68, 139.7)).result, "forbid", "禁行区的边上算在禁行区里");
  assert.equal((await check(35.599999, 139.65)).result, "outside");
  // 坐标不合格
  for (const [point, path] of [[{ lat: 91, lng: 139 }, "/lat"], [{ lat: 35, lng: 181 }, "/lng"], [{ lat: "35", lng: 139 }, "/lat"], [{ lng: 139 }, "/lat"], [{}, "/lat"]] as const) {
    assert.equal(issues(await call("POST", `/areas/${area.id}/check-point`, { body: point }))[0]?.path, path);
  }
  // 自测不写任何东西
  assert.equal((await audits(area.id)).length, 1);
  // 改了图形以后按新的图形判断
  const updated = await put(area.id, 1, { name: area.name, biz_type: "general", polygons: [area.polygons[0]] });
  assert.equal(updated.status, 200, updated.text);
  assert.deepEqual(await check(35.69, 139.69), { result: "operate", operate_polygon_ids: [o1], forbid_polygon_ids: [] });
});

test("列表：按最近修改从新到旧翻页不重不漏，每页的 total 一样；列表项不带图形坐标只带块数；按关键字、城市、业务类型、状态筛选", async () => {
  await api.db.owner.query("delete from areas");
  const a = await created({ name: { zh: "羽田接送", en: "Haneda Pickup" }, biz_type: "airport_transfer", polygons: [operate(), forbid()] });
  const b = await created({ name: { zh: "市内包车", ja: "東京チャーター" }, biz_type: "charter" });
  const c = await created({ name: { zh: "大阪市区" }, city_id: osaka.id });
  const d = await created({ name: { zh: "100%_特殊" } });
  assert.equal((await call("POST", `/areas/${d.id}/disable`)).status, 200);
  api.clock.advance(1_000);
  assert.equal((await put(a.id, 1, { name: a.name, biz_type: "airport_transfer", polygons: [a.polygons[0]] })).status, 200);

  const seen: string[] = [];
  let cursor: string | null = null;
  do {
    const res: ApiResponse = await call("GET", `/areas?limit=3${cursor ? `&cursor=${cursor}` : ""}`);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.total, 4);
    seen.push(...res.body.items.map((item: any) => item.id));
    cursor = res.body.next_cursor;
  } while (cursor);
  assert.deepEqual(seen, [a.id, d.id, c.id, b.id], "刚改过的排最前");

  const first = (await call("GET", "/areas?limit=1")).body.items[0];
  assert.deepEqual(Object.keys(first).sort(), ["biz_type", "city", "city_id", "created_at", "forbid_polygon_count", "id", "name", "operate_polygon_count", "status", "updated_at", "version"]);
  assert.deepEqual([first.operate_polygon_count, first.forbid_polygon_count, first.version, first.city.code], [1, 0, 2, "CTY-JP-TYO"]);
  assert.ok(!JSON.stringify(first).includes("coordinates") || first.city.boundary === null);

  const ids = async (query: string): Promise<string[]> => {
    const res = await call("GET", `/areas?${query}`);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.total, res.body.items.length, query);
    return res.body.items.map((item: any) => item.id);
  };
  assert.deepEqual(await ids("q=haneda"), [a.id]);
  assert.deepEqual(await ids(`q=${encodeURIComponent("チャーター")}`), [b.id]);
  assert.deepEqual(await ids(`q=${encodeURIComponent("市")}`), [c.id, b.id]);
  assert.deepEqual(await ids(`q=${encodeURIComponent("%")}`), [d.id], "% 按字面匹配");
  assert.deepEqual(await ids("q=_"), [d.id]);
  assert.deepEqual(await ids(`city_id=${osaka.id}`), [c.id]);
  assert.deepEqual(await ids("biz_type=charter"), [b.id]);
  assert.deepEqual(await ids("status=disabled"), [d.id]);
  assert.deepEqual(await ids("status=active"), [a.id, c.id, b.id]);
  assert.deepEqual(await ids(`city_id=${tokyo.id}&biz_type=general&status=all`), [d.id]);
  assert.deepEqual(await ids("q=nothing-like-this"), []);
  for (const bad of ["status=deleted", "biz_type=bus", "city_id=tokyo", "limit=0", "limit=201", "cursor=garbage", "q="]) {
    assert.equal((await call("GET", `/areas?${bad}`)).status, 400, bad);
  }
});

test("权限：管理员和商品价格能改；只读能看、能自测、不能改；调度和财务看都不能看；没登录 401；平台令牌进不来", async () => {
  const area = await created();
  const tokens: Record<string, string> = {};
  for (const role of ["pricing", "dispatch", "finance", "readonly"]) tokens[role] = (await addTenantUser(api, tenant.adminToken, `${role}@a.test`, role)).token;
  const before = await counts();
  for (const role of ["dispatch", "finance"]) {
    for (const [method, path, payload] of [
      ["GET", "/areas", undefined], ["GET", `/areas/${area.id}`, undefined], ["POST", `/areas/${area.id}/check-point`, { lat: 35.7, lng: 139.7 }],
      ["POST", "/areas", body()], ["PUT", `/areas/${area.id}`, body()], ["DELETE", `/areas/${area.id}`, undefined], ["POST", `/areas/${area.id}/disable`, undefined],
    ] as const) {
      const res = await call(method, path, { token: tokens[role] as string, body: payload, headers: { "idempotency-key": randomUUID(), "if-match": '"1"' } });
      assert.equal(res.status, 403, `${role} ${method} ${path}`);
    }
  }
  const reader = tokens["readonly"] as string;
  assert.equal((await call("GET", "/areas", { token: reader })).status, 200);
  assert.equal((await call("GET", `/areas/${area.id}`, { token: reader })).status, 200);
  assert.equal((await call("POST", `/areas/${area.id}/check-point`, { token: reader, body: { lat: 35.7, lng: 139.7 } })).body.result, "operate");
  assert.equal((await post(body(), randomUUID(), reader)).status, 403);
  assert.equal((await put(area.id, 1, { name: { zh: "x" }, biz_type: "general", polygons: area.polygons }, reader)).status, 403);
  assert.equal((await call("DELETE", `/areas/${area.id}`, { token: reader })).status, 403);
  assert.equal((await call("POST", `/areas/${area.id}/disable`, { token: reader })).status, 403);
  assert.equal((await call("POST", `/areas/${area.id}/enable`, { token: reader })).status, 403);
  assert.deepEqual(await counts(), before, "被拒绝的请求什么都没写");
  // 商品价格角色：全套都能做，日志记的是他本人
  const pricing = tokens["pricing"] as string;
  const made = await post(body(), randomUUID(), pricing);
  assert.equal(made.status, 201, made.text);
  assert.equal((await put(made.body.id, 1, { name: { zh: "商品价格改的" }, biz_type: "general", polygons: made.body.polygons }, pricing)).status, 200);
  assert.equal((await call("POST", `/areas/${made.body.id}/disable`, { token: pricing })).status, 200);
  assert.equal((await call("DELETE", `/areas/${made.body.id}`, { token: pricing })).status, 204);
  assert.deepEqual([...new Set((await audits(made.body.id)).map((log) => log.actor_email))], ["pricing@a.test"]);
  // 没登录、平台令牌
  assert.equal((await api.call("GET", "/tenant/v1/areas")).status, 401);
  assert.equal((await api.call("GET", "/tenant/v1/areas", { token: root })).status, 401);
});

test("供应商被平台暂停后仍然可以看和改自己的区域（暂停的租户账号照常能用，只是商品不参与比价）", async () => {
  const paused = await api.tenantWithAdmin(root, "被暂停的车队", "admin@paused.test");
  const made = await post(body(), randomUUID(), paused.adminToken);
  assert.equal(made.status, 201, made.text);
  assert.equal((await api.call("POST", `/platform/v1/tenants/${paused.tenantId}/suspend`, { token: root, body: { reason: "测试" } })).status, 200);
  assert.equal((await call("GET", "/areas", { token: paused.adminToken })).body.total, 1);
  assert.equal((await put(made.body.id, 1, { name: { zh: "暂停期间改的" }, biz_type: "general", polygons: made.body.polygons }, paused.adminToken)).status, 200);
  assert.equal((await post(body(), randomUUID(), paused.adminToken)).status, 201);
  assert.equal((await call("POST", `/areas/${made.body.id}/check-point`, { token: paused.adminToken, body: { lat: 35.7, lng: 139.7 } })).status, 200);
});

test("首页数量：本供应商自己的区域按状态数；没有 area.read 的角色拿到 null；任何已登录的账号都能调", async () => {
  const fresh = await api.tenantWithAdmin(root, "新车队", "admin@fresh.test");
  const summary = async (token: string): Promise<any> => {
    const res = await call("GET", "/dashboard/summary", { token });
    assert.equal(res.status, 200, res.text);
    return res.body;
  };
  assert.deepEqual(await summary(fresh.adminToken), { areas: { active: 0, disabled: 0 } });
  const one = await post(body(), randomUUID(), fresh.adminToken);
  const two = await post(body(), randomUUID(), fresh.adminToken);
  assert.deepEqual([one.status, two.status], [201, 201]);
  assert.equal((await call("POST", `/areas/${two.body.id}/disable`, { token: fresh.adminToken })).status, 200);
  assert.deepEqual(await summary(fresh.adminToken), { areas: { active: 1, disabled: 1 } });
  assert.deepEqual(await summary((await addTenantUser(api, fresh.adminToken, "readonly@fresh.test", "readonly")).token), { areas: { active: 1, disabled: 1 } });
  assert.deepEqual(await summary((await addTenantUser(api, fresh.adminToken, "finance@fresh.test", "finance")).token), { areas: null });
  assert.equal((await api.call("GET", "/tenant/v1/dashboard/summary")).status, 401);
  assert.equal((await api.call("GET", "/tenant/v1/dashboard/summary", { token: root })).status, 401);
});

test("底图配置：这个环境没有配置时 tiles 是 null；任何已登录的供应商账号都能取，没登录 401", async () => {
  assert.deepEqual((await call("GET", "/map/config")).body, { tiles: null });
  const finance = await addTenantUser(api, tenant.adminToken, "finance-map@a.test", "finance");
  assert.equal((await call("GET", "/map/config", { token: finance.token })).status, 200);
  assert.equal((await api.call("GET", "/tenant/v1/map/config")).status, 401);
});

test("底图配置：配置了就原样下发（地址、署名、缩放范围、来源页策略）", async () => {
  const configured = await createTestApi({
    env: {
      MAP_TILE_URL_TEMPLATE: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      MAP_TILE_ATTRIBUTION: "© OpenStreetMap 贡献者|https://www.openstreetmap.org/copyright",
    },
  });
  try {
    const admin = await configured.tenantWithAdmin(await configured.superAdminToken(), "某车队", "admin@map.test");
    const res = await configured.call("GET", "/tenant/v1/map/config", { token: admin.adminToken });
    assert.deepEqual(res.body, {
      tiles: {
        url_template: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        dark_url_template: null,
        min_zoom: 3,
        max_zoom: 19,
        tile_size: 256,
        referrer_policy: "strict-origin",
        attribution: [{ text: "© OpenStreetMap 贡献者", href: "https://www.openstreetmap.org/copyright" }],
      },
    });
  } finally {
    await configured.close();
  }
});

test("规则 4：区域接口的任何返回里都没有对外价和加价比例相关的字段", async () => {
  const area = await created({ polygons: [operate(), forbid()] });
  const responses = [
    await call("GET", "/areas"),
    await call("GET", `/areas/${area.id}`),
    await call("POST", `/areas/${area.id}/check-point`, { body: { lat: 35.7, lng: 139.7 } }),
    await call("GET", "/dashboard/summary"),
    await call("GET", "/map/config"),
  ];
  for (const res of responses) assert.doesNotMatch(res.text, /markup|sell_price|selling_price|public_price|对外价|加价/i);
});

test("幂等键的有效期是 24 小时：23 小时后同一个键仍然返回当时的应答；过了 24 小时可以重新使用（建出一个新的）", async () => {
  // 放在最后：拨动时钟会让前面登录的会话过期（8 小时），所以这里每次都重新登录
  const login = async (): Promise<string> => (await api.call("POST", "/tenant/v1/auth/login", { body: { email: "admin@a.test", password: TEST_PASSWORD } })).body.access_token;
  const key = randomUUID();
  const payload = body();
  const first = await post(payload, key, await login());
  assert.equal(first.status, 201, first.text);
  api.clock.advance(23 * 60 * 60 * 1000);
  const replayed = await post(payload, key, await login());
  assert.deepEqual([replayed.status, replayed.body], [201, first.body]);
  api.clock.advance(60 * 60 * 1000 + 1_000);
  const token = await login();
  assert.equal((await call("DELETE", `/areas/${first.body.id}`, { token })).status, 204);
  const reused = await post(payload, key, token);
  assert.equal(reused.status, 201, reused.text);
  assert.notEqual(reused.body.id, first.body.id);
});
