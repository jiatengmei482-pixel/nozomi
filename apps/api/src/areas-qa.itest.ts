/**
 * M1-02 区域接口的补充测试（测试工程师）。areas.itest.ts 和 tenant-isolation.itest.ts 是开发自己写的；这里补它们没有覆盖的：
 * - 并发与幂等：同一个幂等键同时来很多次、同时来但内容不同；同名同时新建；修改和删除 / 停用同时进行；城市被停用的同时新建 / 启用；
 * - 审计：每种写操作正好一条、失败的一条都不留、图形变更的前后值完整；
 * - 上限的两侧经真实接口走一遍（50 块、1000 点、5000 点、半径 100 米和 100 公里）；
 * - 跨租户的另外几条路：用别的供应商、自己别的区域的图形编号去改；幂等键被别的账号、别的角色复用；数据库层面的绕过；
 * - 请求头和请求体的各种不合规写法；HTML 原样存取；自测的边界；前后端对同一圈点的结论一致。
 * 名字以「【缺陷】」开头的是现在会失败的用例，交回开发处理。
 * 全部经真实接口、真实 PostgreSQL；测试数据都在这里构造，结束时连同 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AREA_LIMITS, type Position, areaShapeIssues, circleToRing, locatePoint, normalizeRing, ringToGeoJson } from "@nozomi/domain";
import { withTenantTx } from "./db/context.ts";
import { type ApiResponse, type TenantFixture, type TestApi, addTenantUser, createTestApi } from "./testing/api.ts";

let api: TestApi;
let root: string;
let a: TenantFixture;
let b: TenantFixture;
let tokyo: any;

type Method = "GET" | "POST" | "PUT" | "DELETE";
const call = (method: Method, path: string, options: { token?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<ApiResponse> =>
  api.call(method, `/tenant/v1${path}`, { token: options.token ?? a.adminToken, ...(options.body === undefined ? {} : { body: options.body }), ...(options.headers ? { headers: options.headers } : {}) });
const post = (payload: unknown, key: string = randomUUID(), token?: string): Promise<ApiResponse> => call("POST", "/areas", { body: payload, headers: { "idempotency-key": key }, ...(token ? { token } : {}) });
const put = (id: string, version: number, payload: unknown, token?: string): Promise<ApiResponse> => call("PUT", `/areas/${id}`, { body: payload, headers: { "if-match": `"${version}"` }, ...(token ? { token } : {}) });

const closed = (ring: readonly Position[]): { type: "Polygon"; coordinates: Position[][] } => ({ type: "Polygon", coordinates: [[...ring, ring[0] as Position]] });
const squareRing = (lng: number, lat: number, size: number): Position[] => [
  [lng, lat],
  [lng + size, lat],
  [lng + size, lat + size],
  [lng, lat + size],
];
const operate = (lng = 139.6, lat = 35.6, size = 0.2): Record<string, unknown> => ({ kind: "operate", geometry: closed(squareRing(lng, lat, size)) });
const forbid = (lng = 139.68, lat = 35.68, size = 0.02): Record<string, unknown> => ({ kind: "forbid", geometry: closed(squareRing(lng, lat, size)) });
/** 圆周上均匀取点的多边形（6 位小数）。 */
const roundRing = (count: number, lng = 139.7, lat = 35.7, radius = 0.05): Position[] =>
  Array.from({ length: count }, (_, i): Position => [Math.round((lng + radius * Math.cos((2 * Math.PI * i) / count)) * 1e6) / 1e6, Math.round((lat + radius * Math.sin((2 * Math.PI * i) / count)) * 1e6) / 1e6]);

let serial = 0;
const uniqueName = (): { zh: string } => ({ zh: `补测区域 ${(serial += 1)}` });
const body = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({ city_id: tokyo.id, name: uniqueName(), biz_type: "general", polygons: [operate()], ...extra });

async function created(extra: Record<string, unknown> = {}, token?: string): Promise<any> {
  api.clock.advance(1_000);
  const res = await post(body(extra), randomUUID(), token);
  assert.equal(res.status, 201, res.text);
  return res.body;
}

function reasonsOf(res: ApiResponse): [string, string | undefined][] {
  assert.equal(res.status, 400, res.text);
  assert.equal(res.body.error.code, "VALIDATION_FAILED");
  return res.body.error.details.issues.map((issue: any) => [issue.path, issue.reason]);
}

async function auditRows(areaId?: string): Promise<any[]> {
  const result = await api.db.owner.query(
    `select action, resource_id, tenant_id, actor_email, before, after from audit_logs where resource = 'area' ${areaId === undefined ? "" : "and resource_id = $1"} order by id`,
    areaId === undefined ? [] : [areaId],
  );
  return result.rows;
}

async function tableCounts(): Promise<{ areas: number; polygons: number; audits: number; keys: number }> {
  const row = (
    await api.db.owner.query(
      "select (select count(*)::int from areas) as areas, (select count(*)::int from area_polygons) as polygons, (select count(*)::int from audit_logs where resource = 'area') as audits, (select count(*)::int from idempotency_keys) as keys",
    )
  ).rows[0];
  return row;
}

before(async () => {
  api = await createTestApi();
  root = await api.superAdminToken();
  a = await api.tenantWithAdmin(root, "补测甲车队", "admin@qa-a.test");
  b = await api.tenantWithAdmin(root, "补测乙车队", "admin@qa-b.test");
  const res = await api.call("POST", "/platform/v1/master/cities", { token: root, body: { code: "CTY-JP-QAT", country_code: "JP", name: { zh: "东京" }, timezone: "Asia/Tokyo", center: { lng: 139.6917, lat: 35.6895 } } });
  assert.equal(res.status, 201, res.text);
  tokyo = res.body;
});
after(() => api.close());

// ───────────── 并发与幂等 ─────────────

test("同一个幂等键同时来 8 次（连接池只有 5 个连接）：只建一个区域、只记一条日志，8 次的应答内容完全相同，没有 5xx、没有卡住", async () => {
  const before = await tableCounts();
  const payload = body({ polygons: [operate(), forbid(), { kind: "forbid", circle: { center: { lat: 35.7, lng: 139.7 }, radius_m: 800 } }] });
  const key = randomUUID();
  const results = await Promise.all(Array.from({ length: 8 }, () => post(payload, key)));
  assert.deepEqual(results.map((res) => res.status), Array(8).fill(201), results.map((res) => res.text.slice(0, 120)).join("\n"));
  // 回放的应答是从库里读出来的，字段的先后可能和第一次不同；内容必须完全相同
  for (const res of results) assert.deepEqual(res.body, results[0]?.body, "8 次的应答内容应当完全相同");
  const after = await tableCounts();
  assert.deepEqual([after.areas - before.areas, after.polygons - before.polygons, after.audits - before.audits, after.keys - before.keys], [1, 3, 1, 1]);
});

test("同一个幂等键同时来两次、内容不同：一个建成（201），另一个是 422 IDEMPOTENCY_KEY_REUSED；只建一个", async () => {
  for (let round = 0; round < 5; round += 1) {
    const before = await tableCounts();
    const key = randomUUID();
    const [x, y] = await Promise.all([post(body(), key), post(body({ biz_type: "charter" }), key)]);
    assert.deepEqual([x.status, y.status].sort(), [201, 422], `${x.text}\n${y.text}`);
    assert.equal((x.status === 422 ? x : y).body.error.code, "IDEMPOTENCY_KEY_REUSED");
    const after = await tableCounts();
    assert.deepEqual([after.areas - before.areas, after.audits - before.audits], [1, 1]);
  }
});

test("同一个名字同时新建 6 次（幂等键各不相同）：只有一个成功，其余是 409 AREA_NAME_TAKEN；全角半角、大小写、写在别的语言里也算同名", async () => {
  const before = await tableCounts();
  const names = [{ zh: "Narita 机场周边" }, { zh: "narita 机场周边" }, { zh: "ＮＡＲＩＴＡ　机场周边" }, { ja: "NARITA 机场周边" }, { en: " Narita  机场周边 " }, { zh: "别的", ko: "narita 机场周边" }];
  const results = await Promise.all(names.map((name) => post(body({ name }))));
  assert.deepEqual(results.map((res) => res.status).sort(), [201, 409, 409, 409, 409, 409], results.map((res) => res.text.slice(0, 100)).join("\n"));
  for (const res of results.filter((entry) => entry.status === 409)) assert.equal(res.body.error.code, "AREA_NAME_TAKEN");
  const after = await tableCounts();
  assert.deepEqual([after.areas - before.areas, after.audits - before.audits], [1, 1]);
});

test("两个区域同时改成同一个名字：只有一个成功；同时把名字互换也不会出现两个同名的", async () => {
  const first = await created();
  const second = await created();
  const target = { zh: `同时改名 ${randomUUID().slice(0, 8)}` };
  const [x, y] = await Promise.all([put(first.id, 1, { name: target, biz_type: "general", polygons: first.polygons }), put(second.id, 1, { name: target, biz_type: "general", polygons: second.polygons })]);
  assert.deepEqual([x.status, y.status].sort(), [200, 409], `${x.text}\n${y.text}`);
  const names = (await api.db.owner.query("select name from areas where id = any($1::uuid[])", [[first.id, second.id]])).rows.map((row) => row.name.zh);
  assert.equal(new Set(names).size, 2);
});

test("修改和删除同时进行：不出 5xx；要么改成了再被删、要么删了以后修改是 404；日志和结果对得上（成功几次记几条）", async () => {
  for (let round = 0; round < 6; round += 1) {
    const area = await created();
    const [changed, removed] = await Promise.all([put(area.id, 1, { name: uniqueName(), biz_type: "charter", polygons: area.polygons }), call("DELETE", `/areas/${area.id}`)]);
    assert.equal(removed.status, 204, removed.text);
    assert.ok([200, 404].includes(changed.status), changed.text);
    const actions = (await auditRows(area.id)).map((row) => row.action);
    assert.deepEqual(actions, changed.status === 200 ? ["create", "update", "delete"] : ["create", "delete"]);
    assert.equal((await api.db.owner.query("select count(*)::int as n from area_polygons where area_id = $1", [area.id])).rows[0].n, 0, "删除以后不留图形");
    assert.equal((await call("GET", `/areas/${area.id}`)).status, 404);
  }
});

test("修改和停用同时进行：两个都可能成功（停用不带版本号），也可能修改因为版本变了被拒（409）；最后的版本号 = 1 + 成功的次数，日志一条不多一条不少", async () => {
  for (let round = 0; round < 6; round += 1) {
    const area = await created();
    const [changed, disabled] = await Promise.all([put(area.id, 1, { name: uniqueName(), biz_type: "charter", polygons: [operate(139.5, 35.5, 0.3)] }), call("POST", `/areas/${area.id}/disable`)]);
    assert.equal(disabled.status, 200, disabled.text);
    assert.ok([200, 409].includes(changed.status), changed.text);
    if (changed.status === 409) assert.equal(changed.body.error.code, "VERSION_CONFLICT");
    const final = (await call("GET", `/areas/${area.id}`)).body;
    assert.equal(final.status, "disabled");
    assert.equal(final.version, changed.status === 200 ? 3 : 2);
    assert.equal(final.biz_type, changed.status === 200 ? "charter" : "general");
    assert.deepEqual((await auditRows(area.id)).map((row) => row.action).sort(), changed.status === 200 ? ["create", "disable", "update"] : ["create", "disable"]);
  }
});

test("同时停用 5 次、再同时启用 5 次：各只生效一次（版本各加一、日志各一条）", async () => {
  const area = await created();
  const disables = await Promise.all(Array.from({ length: 5 }, () => call("POST", `/areas/${area.id}/disable`)));
  assert.deepEqual(disables.map((res) => [res.status, res.body.status, res.body.version]), Array(5).fill([200, "disabled", 2]));
  const enables = await Promise.all(Array.from({ length: 5 }, () => call("POST", `/areas/${area.id}/enable`)));
  assert.deepEqual(enables.map((res) => [res.status, res.body.status, res.body.version]), Array(5).fill([200, "active", 3]));
  assert.deepEqual((await auditRows(area.id)).map((row) => row.action), ["create", "disable", "enable"]);
});

test("同一个版本号同时改 6 次：只有一次成功，其余是 409 VERSION_CONFLICT 并带着当前版本；图形是成功那一次的完整内容，不是几次的混合", async () => {
  const area = await created({ polygons: [operate(), forbid()] });
  const variants = Array.from({ length: 6 }, (_, i) => ({ name: { zh: `并发修改 ${area.id.slice(0, 6)}-${i}` }, biz_type: "general", polygons: Array.from({ length: i + 1 }, (_, k) => operate(139 + k * 0.3, 35 + i * 0.01, 0.1)) }));
  const results = await Promise.all(variants.map((variant) => put(area.id, 1, variant)));
  const winners = results.map((res, index) => [res, index] as const).filter(([res]) => res.status === 200);
  assert.equal(winners.length, 1, results.map((res) => `${res.status} ${res.text.slice(0, 80)}`).join("\n"));
  for (const res of results.filter((entry) => entry.status !== 200)) assert.deepEqual([res.status, res.body.error.code, res.body.error.details.current_version], [409, "VERSION_CONFLICT", 2]);
  const [winner, index] = winners[0] as (typeof winners)[number];
  const final = (await call("GET", `/areas/${area.id}`)).body;
  assert.deepEqual(final, winner.body);
  assert.equal(final.polygons.length, index + 1);
  assert.equal((await api.db.owner.query("select count(*)::int as n from area_polygons where area_id = $1", [area.id])).rows[0].n, index + 1);
  assert.equal((await auditRows(area.id)).length, 2);
});

test("城市被平台停用的同时新建 / 启用区域：不出 5xx；城市已经停用以后，新建和启用一定被拒（409 CITY_DISABLED），已有的区域原样保留", async () => {
  const cityRes = await api.call("POST", "/platform/v1/master/cities", { token: root, body: { code: "CTY-JP-QAR", country_code: "JP", name: { zh: "会被停用的城市" }, timezone: "Asia/Tokyo", center: { lng: 135.5, lat: 34.7 } } });
  assert.equal(cityRes.status, 201, cityRes.text);
  const city = cityRes.body;
  const kept = await created({ city_id: city.id, polygons: [operate(135.4, 34.6, 0.2)] });
  const parked = await created({ city_id: city.id, polygons: [operate(135.4, 34.6, 0.2)] });
  assert.equal((await call("POST", `/areas/${parked.id}/disable`)).status, 200);

  const [disabled, ...racers] = await Promise.all([
    api.call("POST", `/platform/v1/master/cities/${city.id}/disable`, { token: root, headers: { "if-match": `"${city.version}"` } }),
    post(body({ city_id: city.id, polygons: [operate(135.4, 34.6, 0.2)] })),
    post(body({ city_id: city.id, polygons: [operate(135.4, 34.6, 0.2)] })),
    call("POST", `/areas/${parked.id}/enable`),
  ]);
  assert.equal(disabled.status, 200, disabled.text);
  for (const res of racers) {
    assert.ok([200, 201, 409].includes(res.status), `${res.status} ${res.text}`);
    if (res.status === 409) assert.deepEqual([res.body.error.code, res.body.error.details.reason], ["MASTER_DATA_NOT_READY", "CITY_DISABLED"]);
  }
  // 停用已经生效以后
  const late = await post(body({ city_id: city.id, polygons: [operate(135.4, 34.6, 0.2)] }));
  assert.deepEqual([late.status, late.body.error.code, late.body.error.details.reason], [409, "MASTER_DATA_NOT_READY", "CITY_DISABLED"]);
  const still = (await call("GET", `/areas/${kept.id}`)).body;
  assert.deepEqual([still.status, still.city.status, still.version], ["active", "disabled", 1]);
  assert.equal((await call("POST", `/areas/${kept.id}/disable`)).status, 200);
  const reEnable = await call("POST", `/areas/${kept.id}/enable`);
  assert.deepEqual([reEnable.status, reEnable.body.error.details.reason], [409, "CITY_DISABLED"]);
  // 城市停用以后照常能改、能自测
  const edited = await put(kept.id, 2, { name: uniqueName(), biz_type: "general", polygons: [operate(135.3, 34.5, 0.4)] });
  assert.equal(edited.status, 200, edited.text);
  assert.equal((await call("POST", `/areas/${kept.id}/check-point`, { body: { lat: 34.7, lng: 135.5 } })).body.result, "operate");
});

test("幂等键只在「同一个供应商」里有意义：同一个供应商的另一个账号带同一个键、同样的内容，拿到的是第一次的应答；只读角色带这个键仍然是 403，拿不到内容", async () => {
  const pricing = await addTenantUser(api, a.adminToken, "pricing@qa-a.test", "pricing");
  const reader = await addTenantUser(api, a.adminToken, "reader@qa-a.test", "readonly");
  const dispatcher = await addTenantUser(api, a.adminToken, "dispatch@qa-a.test", "dispatch");
  const key = randomUUID();
  const payload = body();
  const first = await post(payload, key);
  assert.equal(first.status, 201, first.text);
  const replay = await post(payload, key, pricing.token);
  assert.deepEqual([replay.status, replay.body.id], [201, first.body.id]);
  for (const token of [reader.token, dispatcher.token]) {
    const denied = await post(payload, key, token);
    assert.equal(denied.status, 403);
    assert.ok(!denied.text.includes(first.body.id), "没有权限的角色不能靠别人的幂等键读到区域");
  }
  // 别的供应商带同一个键、同样的内容：建的是自己的，拿不到甲的
  const other = await post(payload, key, b.adminToken);
  assert.equal(other.status, 201, other.text);
  assert.notEqual(other.body.id, first.body.id);
  assert.ok(!other.text.includes(first.body.id));
  // 没登录、过期的令牌带这个键：401，不回放
  assert.equal((await api.call("POST", "/tenant/v1/areas", { headers: { "idempotency-key": key }, body: payload })).status, 401);
  assert.equal((await call("DELETE", `/areas/${other.body.id}`, { token: b.adminToken })).status, 204);
});

test("幂等键的写法：7 位、129 位、带空格或斜杠的被拒（400，/idempotency-key）；8 位、128 位、带 _ . : - 的可以；前后的空白不算", async () => {
  for (const bad of ["1234567", "x".repeat(129), "has space 1234", "path/with/slash", "逗号,12345678", ""]) {
    const res = await call("POST", "/areas", { body: body(), headers: { "idempotency-key": /^[\x20-\x7e]*$/.test(bad) ? bad : "bad,key!1234" } });
    assert.deepEqual(reasonsOf(res).map(([path]) => path), ["/idempotency-key"], JSON.stringify(bad));
  }
  for (const good of ["12345678", "x".repeat(128), `a_b.c:d-${randomUUID()}`]) {
    assert.equal((await post(body(), good)).status, 201, good);
  }
  const padded = randomUUID();
  const payload = body();
  const one = await call("POST", "/areas", { body: payload, headers: { "idempotency-key": `  ${padded} ` } });
  const two = await post(payload, padded);
  assert.deepEqual([one.status, two.status, two.body.id], [201, 201, one.body.id], "带空白和不带空白的是同一个键");
});

test("被业务规则拒绝的新增（重名、城市不存在、图形不合规）不占用幂等键，也不留下任何行；修好以后带同一个键能建成", async () => {
  const taken = await created();
  const before = await tableCounts();
  const key = randomUUID();
  const sameName = await post(body({ name: taken.name }), key);
  assert.deepEqual([sameName.status, sameName.body.error.code], [409, "AREA_NAME_TAKEN"]);
  assert.equal((await post(body({ polygons: [{ kind: "operate", geometry: closed([[139, 35], [139.2, 35.2], [139.2, 35], [139, 35.2]]) }] }), key)).status, 400);
  assert.deepEqual(await tableCounts(), before);
  const fixed = await post(body(), key);
  assert.equal(fixed.status, 201, fixed.text);
  const after = await tableCounts();
  assert.deepEqual([after.areas - before.areas, after.keys - before.keys, after.audits - before.audits], [1, 1, 1]);
});

// ───────────── 审计 ─────────────

test("审计账本：新增、修改、停用、启用、删除各正好一条；没变化的修改、重复的停用 / 启用、所有被拒绝的请求一条都不留", async () => {
  const reader = await addTenantUser(api, a.adminToken, "ledger-reader@qa-a.test", "readonly");
  const other = await created();
  const area = await created({ polygons: [operate(), forbid()] });
  const expectActions = async (expected: string[], what: string): Promise<void> => assert.deepEqual((await auditRows(area.id)).map((row) => row.action), expected, what);
  await expectActions(["create"], "新增");
  const same = { name: area.name, biz_type: area.biz_type, polygons: area.polygons };

  const rejected: [string, () => Promise<ApiResponse>, number][] = [
    ["没变化的修改", () => put(area.id, 1, same), 200],
    ["没带版本号", () => call("PUT", `/areas/${area.id}`, { body: { ...same, biz_type: "charter" } }), 428],
    ["版本号过期", () => put(area.id, 9, { ...same, biz_type: "charter" }), 409],
    ["改城市", () => put(area.id, 1, { ...same, city_id: randomUUID() }), 409],
    ["重名", () => put(area.id, 1, { ...same, name: other.name }), 409],
    ["图形不合规", () => put(area.id, 1, { ...same, polygons: [] }), 400],
    ["别的区域的图形编号", () => put(area.id, 1, { ...same, polygons: [{ ...area.polygons[0], id: other.polygons[0].id }] }), 400],
    ["只读角色改", () => put(area.id, 1, { ...same, biz_type: "charter" }, reader.token), 403],
    ["只读角色停用", () => call("POST", `/areas/${area.id}/disable`, { token: reader.token }), 403],
    ["只读角色删除", () => call("DELETE", `/areas/${area.id}`, { token: reader.token }), 403],
    ["别的供应商删除", () => call("DELETE", `/areas/${area.id}`, { token: b.adminToken }), 404],
    ["已经启用的再启用", () => call("POST", `/areas/${area.id}/enable`), 200],
    ["自测", () => call("POST", `/areas/${area.id}/check-point`, { body: { lat: 35.7, lng: 139.7 } }), 200],
  ];
  const total = (await tableCounts()).audits;
  for (const [what, run, status] of rejected) {
    const res = await run();
    assert.equal(res.status, status, `${what}：${res.text.slice(0, 200)}`);
  }
  await expectActions(["create"], "被拒绝的和没变化的都不记");
  assert.equal((await tableCounts()).audits, total, "别的区域名下也没有多出日志");
  assert.equal((await call("GET", `/areas/${area.id}`)).body.version, 1);

  assert.equal((await put(area.id, 1, { ...same, biz_type: "charter" })).status, 200);
  assert.equal((await call("POST", `/areas/${area.id}/disable`)).status, 200);
  assert.equal((await call("POST", `/areas/${area.id}/disable`)).status, 200);
  assert.equal((await call("POST", `/areas/${area.id}/enable`)).status, 200);
  assert.equal((await call("DELETE", `/areas/${area.id}`)).status, 204);
  assert.equal((await call("DELETE", `/areas/${area.id}`)).status, 404);
  await expectActions(["create", "update", "disable", "enable", "delete"], "每种写操作一条");
  const rows = await auditRows(area.id);
  assert.ok(rows.every((row) => row.tenant_id === a.tenantId && row.actor_email === "admin@qa-a.test"));
  assert.deepEqual([rows[1].before, rows[1].after], [{ biz_type: "general" }, { biz_type: "charter" }], "只改了业务类型：前后值只有这一项");
  assert.deepEqual([rows[2].before, rows[2].after, rows[3].before, rows[3].after], [{ status: "active" }, { status: "disabled" }, { status: "disabled" }, { status: "active" }]);
});

test("审计：图形变更的前后值是两份完整的图形——每一块的类型、序号、备注名、来源、圆心半径、全部顶点，和当时接口返回的一致；删除时记下删除前的全部内容", async () => {
  const circle = { center: { lat: 35.685175, lng: 139.752799 }, radius_m: 1500 };
  const area = await created({ polygons: [{ ...operate(), label: "市区" }, { kind: "forbid", circle, label: "皇居" }] });
  const audited = (polygons: any[]): unknown[] =>
    polygons.map((polygon) => ({ kind: polygon.kind, seq: polygon.seq, label: polygon.label, source: polygon.source, circle: polygon.circle, ring: polygon.geometry.coordinates[0].slice(0, -1) }));
  const [createLog] = await auditRows(area.id);
  assert.equal(createLog.before, null);
  assert.deepEqual(createLog.after, { city_id: tokyo.id, name: area.name, biz_type: "general", status: "active", polygons: audited(area.polygons) });
  assert.equal(createLog.after.polygons[1].ring.length, 64);

  // 改一个顶点、把圆的半径改大、删掉备注名、再加一块
  const moved = closed([[139.6, 35.6], [139.85, 35.6], [139.8, 35.8], [139.6, 35.8]]);
  const changed = await put(area.id, 1, {
    name: area.name,
    biz_type: "general",
    polygons: [{ ...area.polygons[0], geometry: moved }, { ...area.polygons[1], circle: { ...circle, radius_m: 2000 }, label: null }, { kind: "forbid", geometry: closed(squareRing(139.61, 35.61, 0.01)), source: "pasted" }],
  });
  assert.equal(changed.status, 200, changed.text);
  const updateLog = (await auditRows(area.id))[1];
  assert.deepEqual(Object.keys(updateLog.before), ["polygons"], "名称和业务类型没变，不记");
  assert.deepEqual(updateLog.before.polygons, audited(area.polygons));
  assert.deepEqual(updateLog.after.polygons, audited(changed.body.polygons));
  assert.deepEqual(updateLog.after.polygons.map((polygon: any) => [polygon.kind, polygon.seq, polygon.label, polygon.source, polygon.circle?.radius_m ?? null, polygon.ring.length]), [
    ["operate", 1, "市区", "drawn", null, 4],
    ["forbid", 1, null, "circle", 2000, 64],
    ["forbid", 2, null, "pasted", null, 4],
  ]);
  assert.deepEqual(updateLog.after.polygons[0].ring[1], [139.85, 35.6]);

  // 只改备注名：图形算变了，前后值里看得出改的是哪一块的什么
  const relabeled = await put(area.id, 2, { name: area.name, biz_type: "general", polygons: changed.body.polygons.map((polygon: any, index: number) => (index === 2 ? { ...polygon, label: "工地" } : polygon)) });
  assert.equal(relabeled.status, 200, relabeled.text);
  const labelLog = (await auditRows(area.id))[2];
  assert.deepEqual([labelLog.before.polygons[2].label, labelLog.after.polygons[2].label], [null, "工地"]);

  assert.equal((await call("DELETE", `/areas/${area.id}`)).status, 204);
  const deleteLog = (await auditRows(area.id))[3];
  assert.equal(deleteLog.after, null);
  assert.deepEqual(deleteLog.before, { city_id: tokyo.id, name: area.name, biz_type: "general", status: "active", polygons: audited(relabeled.body.polygons) });
});

// ───────────── 上限的两侧（经真实接口） ─────────────

test("上限：50 块能存、51 块被拒；1000 个点能存、1001 个点被拒；合计 5000 个点能存、5001 个点被拒——被拒的什么都不写，存下的原样读得回来", async () => {
  const tile = (index: number): Record<string, unknown> => ({ kind: index === 0 ? "operate" : "forbid", geometry: closed(squareRing(139 + (index % 10) * 0.02, 35 + Math.floor(index / 10) * 0.02, 0.01)) });
  const fifty = await post(body({ polygons: Array.from({ length: AREA_LIMITS.maxPolygons }, (_, i) => tile(i)) }));
  assert.equal(fifty.status, 201, fifty.text.slice(0, 300));
  assert.deepEqual([fifty.body.polygons.length, fifty.body.operate_polygon_count, fifty.body.forbid_polygon_count], [50, 1, 49]);
  assert.deepEqual(fifty.body.polygons.map((polygon: any) => polygon.seq), [1, ...Array.from({ length: 49 }, (_, i) => i + 1)]);
  const before = await tableCounts();
  assert.deepEqual(reasonsOf(await post(body({ polygons: Array.from({ length: AREA_LIMITS.maxPolygons + 1 }, (_, i) => tile(i)) }))), [["/polygons", "TOO_MANY_POLYGONS"]]);
  // 已经有 50 块的区域再加一块
  assert.deepEqual(reasonsOf(await put(fifty.body.id, 1, { name: fifty.body.name, biz_type: "general", polygons: [...fifty.body.polygons, tile(50)] })), [["/polygons", "TOO_MANY_POLYGONS"]]);

  const thousand = await post(body({ polygons: [{ kind: "operate", geometry: closed(roundRing(AREA_LIMITS.maxRingVertices)) }] }));
  assert.equal(thousand.status, 201, thousand.text.slice(0, 300));
  assert.equal(thousand.body.polygons[0].geometry.coordinates[0].length, 1001);
  assert.deepEqual(thousand.body.polygons[0].geometry, closed(roundRing(AREA_LIMITS.maxRingVertices)));
  assert.deepEqual(reasonsOf(await post(body({ polygons: [{ kind: "operate", geometry: closed(roundRing(AREA_LIMITS.maxRingVertices + 1)) }] }))), [["/polygons/0/geometry", "TOO_MANY_VERTICES"]]);

  const five = Array.from({ length: 5 }, (_, i) => ({ kind: "operate", geometry: closed(roundRing(1000, 139 + i * 0.2)) }));
  const fiveThousand = await post(body({ polygons: five }));
  assert.equal(fiveThousand.status, 201, fiveThousand.text.slice(0, 300));
  assert.deepEqual((await call("GET", `/areas/${fiveThousand.body.id}`)).body, fiveThousand.body);
  const over = await post(body({ polygons: [...five, { kind: "forbid", geometry: closed(squareRing(139.7, 35.7, 0.01)) }] }));
  assert.deepEqual(reasonsOf(over), [["/polygons", "TOO_MANY_TOTAL_VERTICES"]]);
  assert.deepEqual(over.body.error.details.issues[0].detail, { count: 5004 });
  const exact = await post(body({ polygons: [...five.slice(0, 4), { kind: "operate", geometry: closed(roundRing(996, 139.8)) }, { kind: "forbid", geometry: closed(squareRing(139.7, 35.7, 0.01)) }] }));
  assert.equal(exact.status, 201, exact.text.slice(0, 300));
  assert.deepEqual(reasonsOf(await post(body({ polygons: [...five.slice(0, 4), { kind: "operate", geometry: closed(roundRing(997, 139.8)) }, { kind: "forbid", geometry: closed(squareRing(139.7, 35.7, 0.01)) }] }))), [["/polygons", "TOO_MANY_TOTAL_VERTICES"]]);

  const after = await tableCounts();
  assert.deepEqual([after.areas - before.areas, after.polygons - before.polygons, after.audits - before.audits], [3, 1 + 5 + 6, 3], "被拒的 5 次什么都没写");
  // 5000 个点的区域：自测、列表、修改、删除都正常
  assert.equal((await call("POST", `/areas/${fiveThousand.body.id}/check-point`, { body: { lat: 35.7, lng: 139.4 } })).body.result, "operate");
  const renamed = await put(fiveThousand.body.id, 1, { name: uniqueName(), biz_type: "general", polygons: fiveThousand.body.polygons });
  assert.deepEqual([renamed.status, renamed.body.version], [200, 2]);
  for (const id of [fifty.body.id, thousand.body.id, fiveThousand.body.id, exact.body.id]) assert.equal((await call("DELETE", `/areas/${id}`)).status, 204);
});

test("圆的半径：100 米和 100 公里能存，99、100001、100.5、0、负数、字符串被拒（RADIUS_OUT_OF_RANGE 或字段类型错）；圆心越界、跨 180° 经线、盖住极点的圆被拒", async () => {
  const circleAt = (radius: unknown, center: { lat: number; lng: number } = { lat: 35.7, lng: 139.7 }): Record<string, unknown> => body({ polygons: [{ kind: "operate", circle: { center, radius_m: radius } }] });
  for (const radius of [AREA_LIMITS.minRadiusM, AREA_LIMITS.maxRadiusM]) {
    const res = await post(circleAt(radius));
    assert.equal(res.status, 201, res.text.slice(0, 300));
    const polygon = res.body.polygons[0];
    assert.deepEqual([polygon.source, polygon.circle, polygon.geometry.coordinates[0].length], ["circle", { center: { lat: 35.7, lng: 139.7 }, radius_m: radius }, 65]);
    assert.deepEqual(polygon.geometry, ringToGeoJson(circleToRing({ lat: 35.7, lng: 139.7 }, radius)));
    assert.equal((await call("POST", `/areas/${res.body.id}/check-point`, { body: { lat: 35.7, lng: 139.7 } })).body.result, "operate");
  }
  for (const radius of [99, 100_001, 100.5, 0, -100]) assert.deepEqual(reasonsOf(await post(circleAt(radius))), [["/polygons/0/circle/radius_m", "RADIUS_OUT_OF_RANGE"]], String(radius));
  for (const radius of ["1000", null, undefined]) assert.equal((await post(circleAt(radius))).status, 400, String(radius));
  assert.deepEqual(reasonsOf(await post(circleAt(1000, { lat: 90.1, lng: 139.7 }))), [["/polygons/0/circle/center", "INVALID_COORDINATE"]]);
  assert.deepEqual(reasonsOf(await post(circleAt(1000, { lat: 35.7, lng: 180.5 }))), [["/polygons/0/circle/center", "INVALID_COORDINATE"]]);
  assert.deepEqual(reasonsOf(await post(circleAt(5000, { lat: 35.7, lng: 179.99 }))), [["/polygons/0/geometry", "CROSSES_ANTIMERIDIAN"]]);
  assert.equal((await post(circleAt(100_000, { lat: 89.9, lng: 0 }))).status, 400);
  // 圆心多于 6 位小数：取整后存，多边形按取整后的圆心算
  const precise = await post(circleAt(500, { lat: 35.68517549, lng: 139.75279951 }));
  assert.equal(precise.status, 201, precise.text.slice(0, 300));
  assert.deepEqual(precise.body.polygons[0].circle.center, { lat: 35.685175, lng: 139.7528 });
  assert.deepEqual(precise.body.polygons[0].geometry, ringToGeoJson(circleToRing({ lat: 35.685175, lng: 139.7528 }, 500)));
  // 同时给了圆和一圈别处的坐标：只认圆
  const both = await post(body({ polygons: [{ kind: "operate", circle: { center: { lat: 35.7, lng: 139.7 }, radius_m: 300 }, geometry: closed(squareRing(10, 10, 1)) }] }));
  assert.equal(both.status, 201, both.text.slice(0, 300));
  assert.deepEqual(both.body.polygons[0].geometry, ringToGeoJson(circleToRing({ lat: 35.7, lng: 139.7 }, 300)));
});

// ───────────── 保存下来的和判断用的是同一份 ─────────────

test("各种写法的一圈点（顺时针、不闭合、多于 6 位小数、带高度、重复写闭合点）存下来的都是 domain 整理后的样子；后端的结论和 domain 的检查逐个一致", async () => {
  const base: Position[] = [[139.6, 35.6], [139.8, 35.6], [139.8, 35.8], [139.6, 35.8]];
  const variants: [string, unknown[]][] = [
    ["逆时针闭合", [...base, base[0]]],
    ["顺时针闭合", [base[0], base[3], base[2], base[1], base[0]]],
    ["不闭合", base],
    ["多于 6 位小数", [[139.6000004, 35.5999996], [139.8000001, 35.6], [139.8, 35.8000004], [139.6, 35.8], [139.6, 35.6]]],
    ["带高度", base.map((point) => [...point, 42.5])],
  ];
  for (const [name, coordinates] of variants) {
    const res = await post(body({ polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [coordinates] } }] }));
    assert.equal(res.status, 201, `${name}：${res.text.slice(0, 200)}`);
    assert.deepEqual(res.body.polygons[0].geometry, closed(base), name);
    const stored = (await api.db.owner.query("select geometry, vertex_count, min_lng::float8 as a, min_lat::float8 as b, max_lng::float8 as c, max_lat::float8 as d from area_polygons where area_id = $1", [res.body.id])).rows[0];
    assert.deepEqual([stored.geometry, stored.vertex_count, stored.a, stored.b, stored.c, stored.d], [closed(base), 4, 139.6, 35.6, 139.8, 35.8], `${name}：库里的图形、点数、外接矩形`);
  }
  // 不合规的：后端报的原因 = domain 对整理后的那圈点报的原因
  const invalid: [string, Position[]][] = [
    ["蝴蝶结", [[139, 35], [139.2, 35.2], [139.2, 35], [139, 35.2]]],
    ["两个点", [[139, 35], [139.2, 35.2]]],
    ["一条线", [[139, 35], [139.1, 35.1], [139.2, 35.2]]],
    ["相邻重复", [[139, 35], [139.2, 35], [139.2, 35], [139.2, 35.2]]],
    ["取整后重复", [[139, 35], [139.2, 35], [139.2000004, 35.0000004], [139.2, 35.2]]],
    ["纬度超范围", [[139, 35], [139.2, 35], [139.2, 95]]],
    ["跨 180°", [[179, 35], [-179, 35], [-179, 36], [179, 36]]],
    ["折回去的尖刺", [[139, 35], [139.2, 35], [139.2, 35.2], [139.3, 35.3], [139.2, 35.2], [139, 35.2]]],
    ["写了两遍闭合点", [[139, 35], [139.2, 35], [139.2, 35.2], [139, 35], [139, 35]]],
  ];
  for (const [name, ring] of invalid) {
    const res = await post(body({ polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [ring] } }] }));
    const expected = areaShapeIssues([{ kind: "operate", ring: normalizeRing(ring) }]).map((issue) => ["polygon" in issue ? "/polygons/0/geometry" : "/polygons", issue.reason]);
    assert.ok(expected.length > 0, name);
    assert.deepEqual(reasonsOf(res), expected, name);
  }
  // 带洞、空的、不是 Polygon
  assert.deepEqual(reasonsOf(await post(body({ polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [[...base, base[0]], [[139.65, 35.65], [139.7, 35.65], [139.7, 35.7], [139.65, 35.65]]] } }] }))), [["/polygons/0/geometry", "HAS_HOLES"]]);
  assert.deepEqual(reasonsOf(await post(body({ polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [] } }] }))), [["/polygons/0/geometry", "HAS_HOLES"]]);
  for (const geometry of [{ type: "MultiPolygon", coordinates: [[[...base, base[0]]]] }, { type: "Polygon" }, { type: "Polygon", coordinates: [[["139", "35"], [139.2, 35], [139.2, 35.2]]] }, { type: "Polygon", coordinates: [[[139], [139.2, 35], [139.2, 35.2]]] }, "POLYGON((139 35,139.2 35,139.2 35.2))", null]) {
    assert.equal((await post(body({ polygons: [{ kind: "operate", geometry }] }))).status, 400, JSON.stringify(geometry));
  }
});

test("自测接口的结论 = domain 的 locatePoint 对接口返回的图形算出来的结论：圆、凹多边形、重叠的禁行区，在边上、顶点上、里面、外面各取一批位置", async () => {
  const concave: Position[] = [[139.6, 35.6], [139.8, 35.6], [139.8, 35.8], [139.7, 35.7], [139.6, 35.8]];
  const area = await created({
    polygons: [
      { kind: "operate", geometry: closed(concave) },
      { kind: "operate", circle: { center: { lat: 35.9, lng: 139.9 }, radius_m: 3000 } },
      { kind: "forbid", geometry: closed(squareRing(139.75, 35.55, 0.1)) },
      { kind: "forbid", circle: { center: { lat: 35.9, lng: 139.9 }, radius_m: 500 } },
    ],
  });
  const shapes = area.polygons.map((polygon: any) => ({ id: polygon.id, kind: polygon.kind, ring: polygon.geometry.coordinates[0].slice(0, -1) }));
  const circleRing: Position[] = shapes[1].ring;
  const points: Position[] = [
    ...concave,
    [139.7, 35.6], [139.6, 35.7], [139.75, 35.75], [139.65, 35.75], [139.7, 35.75], [139.7, 35.700001], [139.7, 35.699999],
    [139.75, 35.6], [139.75, 35.55], [139.8, 35.65], [139.85, 35.6], [139.800001, 35.6], [139.76, 35.61], [139.74, 35.61],
    [139.9, 35.9], circleRing[0] as Position, circleRing[16] as Position, circleRing[37] as Position, [139.9, 35.93], [139.9, 35.9045], [139.9, 35.904], [139.935, 35.9],
    [0, 0], [-139.7, -35.7], [180, 90], [-180, -90], [139.7, 35.65], [139.69999999, 35.65000001],
  ];
  const seen = new Set<string>();
  for (const [lng, lat] of points) {
    const res = await call("POST", `/areas/${area.id}/check-point`, { body: { lat, lng } });
    assert.equal(res.status, 200, res.text);
    const expected = locatePoint(shapes, { lat, lng });
    assert.deepEqual(res.body, { result: expected.result, operate_polygon_ids: expected.operatePolygonIds, forbid_polygon_ids: expected.forbidPolygonIds }, `${lng},${lat}`);
    seen.add(res.body.result);
  }
  assert.deepEqual([...seen].sort(), ["forbid", "operate", "outside"], "三种结果都出现过");
  // 明确的几条：禁行优先、边上算在里面
  const at = async (lat: number, lng: number): Promise<string> => (await call("POST", `/areas/${area.id}/check-point`, { body: { lat, lng } })).body.result;
  assert.deepEqual([await at(35.61, 139.76), await at(35.61, 139.74), await at(35.6, 139.75), await at(35.9, 139.9), await at(35.92, 139.9), await at(35.75, 139.7)], ["forbid", "operate", "forbid", "forbid", "operate", "outside"]);
});

test("自测的入参：缺字段、字符串、超范围、空请求体都是 400（不是 500），停用的区域照常能测，自测不改任何东西", async () => {
  const area = await created();
  const before = await tableCounts();
  for (const payload of [{}, { lat: 35.7 }, { lng: 139.7 }, { lat: "35.7", lng: "139.7" }, { lat: null, lng: 139.7 }, { lat: 90.000001, lng: 139.7 }, { lat: -90.000001, lng: 139.7 }, { lat: 35.7, lng: 180.000001 }, { lat: 35.7, lng: -180.000001 }, { lat: 1e308, lng: 0 }, [35.7, 139.7]]) {
    const res = await call("POST", `/areas/${area.id}/check-point`, { body: payload });
    assert.equal(res.status, 400, `${JSON.stringify(payload)} → ${res.status} ${res.text.slice(0, 120)}`);
  }
  assert.equal((await call("POST", `/areas/${area.id}/check-point`)).status, 400, "没有请求体");
  for (const [lat, lng, expected] of [[90, 180, "outside"], [-90, -180, "outside"], [35.6, 139.6, "operate"], [-0, 0, "outside"]] as const) {
    assert.equal((await call("POST", `/areas/${area.id}/check-point`, { body: { lat, lng } })).body.result, expected);
  }
  assert.equal((await call("POST", `/areas/${area.id}/disable`)).status, 200);
  assert.equal((await call("POST", `/areas/${area.id}/check-point`, { body: { lat: 35.7, lng: 139.7 } })).body.result, "operate");
  assert.equal((await call("POST", "/areas/not-a-uuid/check-point", { body: { lat: 35.7, lng: 139.7 } })).status, 404);
  const after = await tableCounts();
  assert.deepEqual([after.areas, after.polygons, after.audits - before.audits], [before.areas, before.polygons, 1], "只有停用那一条日志");
});

// ───────────── 图形编号 ─────────────

test("图形编号：自己另一个区域的、别的供应商的、不存在的、重复的、大写的——除了大写写法都被拒（UNKNOWN_POLYGON），什么都不改", async () => {
  const mine = await created({ polygons: [operate(), forbid()] });
  const sibling = await created({ polygons: [operate(139.2, 35.2, 0.1)] });
  const foreign = await created({ polygons: [operate()] }, b.adminToken);
  const before = await api.db.owner.query("select tenant_id, id, area_id, kind, seq, geometry from area_polygons order by id");
  const attempt = (polygons: unknown[]): Promise<ApiResponse> => put(mine.id, 1, { name: mine.name, biz_type: "general", polygons });
  const [first, second] = mine.polygons;
  assert.deepEqual(reasonsOf(await attempt([{ ...first, id: sibling.polygons[0].id }])), [["/polygons/0/id", "UNKNOWN_POLYGON"]], "自己另一个区域的图形");
  assert.deepEqual(reasonsOf(await attempt([{ ...first, id: foreign.polygons[0].id }])), [["/polygons/0/id", "UNKNOWN_POLYGON"]], "别的供应商的图形");
  assert.deepEqual(reasonsOf(await attempt([first, { ...second, id: randomUUID() }])), [["/polygons/1/id", "UNKNOWN_POLYGON"]], "不存在的编号");
  assert.deepEqual(reasonsOf(await attempt([first, { ...second, id: first.id, kind: "forbid" }])), [["/polygons/1/id", "UNKNOWN_POLYGON"]], "同一个编号出现两次");
  assert.equal((await attempt([{ ...first, id: "not-a-uuid" }])).status, 400);
  // 新增时带编号：新图形不该有编号
  assert.deepEqual(reasonsOf(await post(body({ polygons: [{ ...operate(), id: foreign.polygons[0].id }] }))), [["/polygons/0/id", "UNKNOWN_POLYGON"]]);
  assert.deepEqual((await api.db.owner.query("select tenant_id, id, area_id, kind, seq, geometry from area_polygons order by id")).rows, before.rows);
  assert.equal((await call("GET", `/areas/${mine.id}`)).body.version, 1);
  // 大写写法的编号是同一块：保留编号和序号
  const upper = await attempt([{ ...first, id: first.id.toUpperCase(), label: "大写编号" }, second]);
  assert.equal(upper.status, 200, upper.text);
  assert.deepEqual(upper.body.polygons.map((polygon: any) => [polygon.id, polygon.seq, polygon.label]), [[first.id, 1, "大写编号"], [second.id, 1, null]]);
  // 对方的图形原样不动
  assert.deepEqual((await call("GET", `/areas/${foreign.id}`, { token: b.adminToken })).body, foreign);
});

test("图形换类型、换顺序、删掉再加：保留的编号不变；换了类型的在新类型里取下一个序号；同一类里序号不重复；删掉的序号不再用", async () => {
  const area = await created({ polygons: [operate(139.0, 35.0, 0.1), operate(139.2, 35.0, 0.1), forbid(139.01, 35.01, 0.01), forbid(139.21, 35.01, 0.01)] });
  const [o1, o2, f1, f2] = area.polygons;
  assert.deepEqual(area.polygons.map((polygon: any) => `${polygon.kind}${polygon.seq}`), ["operate1", "operate2", "forbid1", "forbid2"]);
  // 换顺序、o2 改成禁行区、删掉 f1、加一块新的营运区
  const changed = await put(area.id, 1, { name: area.name, biz_type: "general", polygons: [f2, { ...o2, kind: "forbid" }, o1, operate(139.4, 35.0, 0.1)] });
  assert.equal(changed.status, 200, changed.text);
  assert.deepEqual(changed.body.polygons.map((polygon: any) => [polygon.id === f2.id || polygon.id === o2.id || polygon.id === o1.id, `${polygon.kind}${polygon.seq}`]), [[true, "forbid2"], [true, "forbid3"], [true, "operate1"], [false, "operate3"]]);
  assert.ok(!changed.body.polygons.some((polygon: any) => polygon.id === f1.id));
  for (const kind of ["operate", "forbid"]) {
    const seqs = changed.body.polygons.filter((polygon: any) => polygon.kind === kind).map((polygon: any) => polygon.seq);
    assert.equal(new Set(seqs).size, seqs.length, `${kind} 的序号重复了`);
  }
  // 再把它改回营运区：不回到原来的 2（那个号已经让出去了），取下一个
  const back = await put(area.id, 2, { name: area.name, biz_type: "general", polygons: changed.body.polygons.map((polygon: any) => (polygon.id === o2.id ? { ...polygon, kind: "operate" } : polygon)) });
  assert.equal(back.status, 200, back.text);
  assert.deepEqual(back.body.polygons.map((polygon: any) => `${polygon.kind}${polygon.seq}`), ["forbid2", "operate4", "operate1", "operate3"]);
  // GET 拿到的原样提交回去：没有变化
  const echo = await put(area.id, 3, { name: back.body.name, biz_type: back.body.biz_type, polygons: back.body.polygons });
  assert.deepEqual([echo.status, echo.body.version], [200, 3]);
  assert.deepEqual(echo.body, back.body);
});

// ───────────── 请求头、请求体的不合规写法 ─────────────

test("If-Match 的写法：\"3\" 和 3 可以；W/\"3\"、*、0、负数、小数、带单位的都是 400；不带是 428；都不改任何东西", async () => {
  const area = await created();
  const payload = { name: uniqueName(), biz_type: "charter", polygons: area.polygons };
  for (const header of ['W/"1"', "*", '"0"', "0", "-1", '"1.0"', "1e0", '"1" , "2"', "v1", '""', " "]) {
    const res = await call("PUT", `/areas/${area.id}`, { body: payload, headers: { "if-match": header } });
    assert.equal(res.status, 400, `${header} → ${res.status}`);
  }
  assert.deepEqual([(await call("PUT", `/areas/${area.id}`, { body: payload })).status, (await call("PUT", `/areas/${area.id}`, { body: payload })).body.error.code], [428, "PRECONDITION_REQUIRED"]);
  assert.equal((await call("GET", `/areas/${area.id}`)).body.version, 1);
  assert.equal((await call("PUT", `/areas/${area.id}`, { body: payload, headers: { "if-match": "1" } })).status, 200);
  assert.equal((await call("PUT", `/areas/${area.id}`, { body: { ...payload, biz_type: "general" }, headers: { "if-match": ' "2" ' } })).status, 200);
});

test("请求体里多出来的字段不生效：tenant_id、status、version、id、seq、created_at 都改不了；图形里的 tenant_id、area_id、seq 也一样", async () => {
  const res = await post({ ...body({ polygons: [{ ...operate(), seq: 99, tenant_id: b.tenantId, area_id: randomUUID(), position: 7, vertex_count: 1 }] }), tenant_id: b.tenantId, status: "disabled", version: 42, id: randomUUID(), created_at: "2000-01-01T00:00:00.000Z", name_keys: ["x"] });
  assert.equal(res.status, 201, res.text);
  assert.deepEqual([res.body.status, res.body.version, res.body.polygons[0].seq], ["active", 1, 1]);
  const row = (await api.db.owner.query("select tenant_id, status, version, name_keys from areas where id = $1", [res.body.id])).rows[0];
  assert.deepEqual([row.tenant_id, row.status, row.version], [a.tenantId, "active", 1]);
  assert.notDeepEqual(row.name_keys, ["x"]);
  const changed = await put(res.body.id, 1, { name: res.body.name, biz_type: "charter", polygons: res.body.polygons, status: "disabled", version: 9, tenant_id: b.tenantId });
  assert.deepEqual([changed.status, changed.body.status, changed.body.version], [200, "active", 2]);
  assert.equal((await api.db.owner.query("select count(*)::int as n from areas where tenant_id = $1 and id = $2", [b.tenantId, res.body.id])).rows[0].n, 0);
});

test("名称和备注名里的 HTML、引号、表情原样存、原样返回（不转义、不截断、不执行是界面的事）；备注名 40 个字可以、41 个字被拒；只有空白的备注名被拒", async () => {
  const name = { zh: `<img src=x onerror="alert(1)"> & '区域' ${randomUUID().slice(0, 6)}`, en: "</script><script>alert(2)</script>" };
  const label = `<b onclick="x()">皇居</b> & "周边" 🚗`;
  const res = await post(body({ name, polygons: [{ ...operate(), label }] }));
  assert.equal(res.status, 201, res.text);
  assert.deepEqual([res.body.name, res.body.polygons[0].label], [name, label]);
  const listed = await call("GET", `/areas?q=${encodeURIComponent("<img src=x")}`);
  assert.deepEqual(listed.body.items.map((item: any) => item.name), [name]);
  assert.match(String(listed.headers["content-type"]), /^application\/json/);
  const exact = "字".repeat(AREA_LIMITS.maxLabelLength);
  assert.equal((await post(body({ polygons: [{ ...operate(), label: exact }] }))).status, 201);
  assert.equal((await post(body({ polygons: [{ ...operate(), label: `${exact}字` }] }))).status, 400);
  assert.equal((await post(body({ polygons: [{ ...operate(), label: "   " }] }))).status, 400);
  assert.equal((await post(body({ polygons: [{ ...operate(), label: 123 }] }))).status, 400);
  // 备注名前后的空白去掉
  assert.equal((await post(body({ polygons: [{ ...operate(), label: "  机场  " }] }))).body.polygons[0].label, "机场");
});

test("关键字里的 %、_、反斜杠按字面匹配；游标乱写是 400；limit 的两侧", async () => {
  const marker = randomUUID().slice(0, 8);
  const names = [`${marker} 100% 覆盖`, `${marker} a_b`, `${marker} axb`, `${marker} 反\\斜杠`];
  for (const zh of names) await created({ name: { zh } });
  const search = async (q: string): Promise<string[]> => (await call("GET", `/areas?q=${encodeURIComponent(q)}`)).body.items.map((item: any) => item.name.zh).sort();
  assert.deepEqual(await search(`${marker} 100%`), [names[0]]);
  assert.deepEqual(await search(`${marker} a_b`), [names[1]]);
  assert.deepEqual(await search(`${marker} 反\\`), [names[3]]);
  assert.deepEqual(await search(`${marker} %`), []);
  assert.deepEqual((await search(marker.toUpperCase())).length, 4, "不分大小写");
  for (const query of ["cursor=abc", "cursor=%7B%7D", "limit=0", "limit=201", "limit=1.5", "limit=abc", "status=deleted", "biz_type=bus", "city_id=tokyo", `q=${"x".repeat(101)}`]) {
    const res = await call("GET", `/areas?${query}`);
    assert.equal(res.status, 400, `${query} → ${res.status}`);
  }
  assert.equal((await call("GET", "/areas?limit=200")).status, 200);
  assert.equal((await call("GET", "/areas?limit=1")).body.items.length, 1);
});

// ───────────── 数据库层面 ─────────────

test("数据库层面的绕过尝试：把图形挂到别的供应商的区域下、把自己的图形挪过去、伪造别人名下的幂等键应答——都被数据库拒绝", async () => {
  const mine = await created();
  const foreign = await created({}, b.adminToken);
  const geometry = JSON.stringify(closed(squareRing(139, 35, 0.1)));
  const insertPolygon = (tenantId: string, areaId: string): Promise<unknown> =>
    withTenantTx(api.db.pool, a.tenantId, (db) =>
      db.query(
        `insert into area_polygons (tenant_id, area_id, kind, seq, position, source, geometry, vertex_count, min_lng, min_lat, max_lng, max_lat)
         values ($1, $2, 'forbid', 77, 77, 'drawn', $3::jsonb, 4, 139, 35, 139.1, 35.1)`,
        [tenantId, areaId, geometry],
      ),
    );
  // 自己的 tenant_id + 别人的区域：外键是（tenant_id, area_id）一起的，对不上
  await assert.rejects(insertPolygon(a.tenantId, foreign.id), { code: "23503" });
  // 别人的 tenant_id：行级安全拒绝
  await assert.rejects(insertPolygon(b.tenantId, foreign.id), { code: "42501" });
  await assert.rejects(withTenantTx(api.db.pool, a.tenantId, (db) => db.query("update area_polygons set tenant_id = $1 where area_id = $2", [b.tenantId, mine.id])), (err: any) => ["42501", "23503"].includes(err.code));
  await assert.rejects(withTenantTx(api.db.pool, a.tenantId, (db) => db.query("update area_polygons set area_id = $1 where area_id = $2", [foreign.id, mine.id])), { code: "23503" });
  const stolen = await withTenantTx(api.db.pool, a.tenantId, (db) => db.query("update idempotency_keys set response_body = '{}'::jsonb where tenant_id = $1", [b.tenantId]));
  assert.equal(stolen.rowCount, 0);
  const peek = await withTenantTx(api.db.pool, a.tenantId, (db) => db.query("select 1 from area_polygons where area_id = $1 union all select 1 from idempotency_keys where tenant_id = $2", [foreign.id, b.tenantId]));
  assert.equal(peek.rows.length, 0);
  // 约束兜底：不合规的图形即使绕过应用代码也写不进去
  const bad = (sql: string): Promise<unknown> => withTenantTx(api.db.pool, a.tenantId, (db) => db.query(sql, [a.tenantId, mine.id, geometry]));
  await assert.rejects(bad("insert into area_polygons (tenant_id, area_id, kind, seq, position, source, geometry, vertex_count, min_lng, min_lat, max_lng, max_lat) values ($1, $2, 'both', 5, 5, 'drawn', $3::jsonb, 4, 139, 35, 139.1, 35.1)"), { code: "23514" });
  await assert.rejects(bad("insert into area_polygons (tenant_id, area_id, kind, seq, position, source, geometry, vertex_count, min_lng, min_lat, max_lng, max_lat) values ($1, $2, 'forbid', 5, 5, 'circle', $3::jsonb, 4, 139, 35, 139.1, 35.1)"), { code: "23514" });
  await assert.rejects(bad("insert into area_polygons (tenant_id, area_id, kind, seq, position, source, geometry, vertex_count, min_lng, min_lat, max_lng, max_lat) values ($1, $2, 'forbid', 5, 5, 'drawn', $3::jsonb, 2, 139, 35, 139.1, 35.1)"), { code: "23514" });
  await assert.rejects(bad("insert into area_polygons (tenant_id, area_id, kind, seq, position, source, geometry, vertex_count, min_lng, min_lat, max_lng, max_lat) values ($1, $2, 'operate', 1, 5, 'drawn', $3::jsonb, 4, 139, 35, 139.1, 35.1)"), { code: "23505" });
  assert.deepEqual((await call("GET", `/areas/${foreign.id}`, { token: b.adminToken })).body, foreign);
  assert.deepEqual((await call("GET", `/areas/${mine.id}`)).body, mine);
});

test("区域被删除以后：图形一起没了、幂等键的记录还在（24 小时内同一个键仍然返回当时的应答）、供应商之间互不影响", async () => {
  const key = randomUUID();
  const payload = body({ polygons: [operate(), forbid()] });
  const mine = await post(payload, key);
  const theirs = await post(payload, key, b.adminToken);
  assert.deepEqual([mine.status, theirs.status], [201, 201]);
  assert.equal((await call("DELETE", `/areas/${mine.body.id}`)).status, 204);
  assert.equal((await api.db.owner.query("select count(*)::int as n from area_polygons where area_id = $1", [mine.body.id])).rows[0].n, 0);
  assert.equal((await call("GET", `/areas/${theirs.body.id}`, { token: b.adminToken })).status, 200, "乙的同名、同键的区域不受影响");
  assert.equal((await api.db.owner.query("select count(*)::int as n from area_polygons where area_id = $1", [theirs.body.id])).rows[0].n, 2);
  assert.deepEqual((await post(payload, key)).body, mine.body);
  // 同名的可以马上再建（换一个键）
  const again = await post(payload);
  assert.equal(again.status, 201, again.text);
  assert.notEqual(again.body.id, mine.body.id);
});
