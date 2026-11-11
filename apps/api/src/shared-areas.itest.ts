/**
 * M8-31 区域共享库（ADR 0083），经真实接口、真实 PostgreSQL：
 * - 乙建的区域自动进共享库，甲能按城市、名称找到、看到形状；看不到创建者、业务类型、用途，自己建的不出现在自己看到的库里；
 * - 甲引用 = 在甲名下新建一个副本，图形照抄、记住来源和图形版本；副本不进共享库（不重复）；
 * - 乙改图形 → 图形版本加一，甲的副本一分不变，详情里提示「库里有新版本」；甲切换后图形和来源版本更新；乙只改名不算新版本；
 * - 查相似：同名、营运区重叠都能找到；
 * - 测试供应商、停用的区域不在库里；
 * - 已有区域、报价不变：引用不碰来源，乙的区域、版本照旧。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type ApiResponse, type TenantFixture, type TestApi, createTestApi } from "./testing/api.ts";
import { type Market, buildMarket, ok } from "./testing/market.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";

let api: TestApi;
let m: Market;

/** 坐标按后端的写法保留 6 位小数，比较时不受浮点误差影响 */
const r6 = (value: number): number => Math.round(value * 1e6) / 1e6;
const square = (lng: number, lat: number, size: number) => ({
  type: "Polygon",
  coordinates: [[[lng, lat], [r6(lng + size), lat], [r6(lng + size), r6(lat + size)], [lng, r6(lat + size)], [lng, lat]]],
});

const call = (who: TenantFixture, method: "GET" | "POST" | "PUT", path: string, options: { body?: unknown; headers?: Record<string, string> } = {}): Promise<ApiResponse> => {
  api.clock.advance(1_000);
  return api.call(method, `/tenant/v1${path}`, { token: who.adminToken, ...(options.body === undefined ? {} : { body: options.body }), ...(options.headers ? { headers: options.headers } : {}) });
};

async function newArea(who: TenantFixture, name: string, lng: number, lat: number, size = 0.05): Promise<any> {
  const res = await call(who, "POST", "/areas", { body: { city_id: m.ids.tokyo, name: { zh: name }, biz_type: "point_to_point", role: "pricing", polygons: [{ kind: "operate", geometry: square(lng, lat, size) }] }, headers: { "idempotency-key": randomUUID() } });
  assert.equal(res.status, 201, res.text);
  return res.body;
}

before(async () => {
  api = await createTestApi();
  m = await buildMarket(api);
});
after(() => api.close());

test("新建的区域自动进共享库：别家按城市和名称找得到、看得到形状；不显示创建者、业务类型、用途，自己的不出现在自己看到的库里", async () => {
  const source = await newArea(m.b, "共享·银座一带", 139.75, 35.66);
  assert.deepEqual([source.shape_version, source.shared_source], [1, null]);

  const list = await call(m.a, "GET", `/shared-areas?city_id=${m.ids.tokyo}&q=${encodeURIComponent("银座一带")}`);
  assert.equal(list.status, 200, list.text);
  assertMatchesOpenApi("GET", "/tenant/v1/shared-areas", list);
  const item = list.body.items.find((entry: any) => entry.id === source.id);
  assert.ok(item, list.text);
  assert.deepEqual([item.name, item.shape_version, item.operate_polygon_count], [{ zh: "共享·银座一带" }, 1, 1]);
  for (const hidden of ["tenant_id", "tenant", "biz_type", "role", "created_by", "usage"]) assert.equal(Object.hasOwn(item, hidden), false, hidden);

  const mine = await call(m.b, "GET", `/shared-areas?city_id=${m.ids.tokyo}&q=${encodeURIComponent("银座一带")}`);
  assert.equal(mine.body.items.some((entry: any) => entry.id === source.id), false, "自己建的不出现在自己看到的库里");

  const detail = await call(m.a, "GET", `/shared-areas/${source.id}`);
  assert.equal(detail.status, 200, detail.text);
  assertMatchesOpenApi("GET", "/tenant/v1/shared-areas/{id}", detail);
  assert.deepEqual(detail.body.polygons.map((polygon: any) => polygon.kind), ["operate"]);
  assert.deepEqual(detail.body.polygons[0].geometry, square(139.75, 35.66, 0.05));
  assert.equal(Object.hasOwn(detail.body.polygons[0], "label"), false);
});

test("引用 = 在自己名下复制一份并记住来源和版本；来源改图形后副本不变、提示有新版本，切换后才更新；只改名不算新版本；副本不进共享库", async () => {
  const source = await newArea(m.b, "共享·新宿西口", 139.69, 35.69);
  const before = await api.db.owner.query("select version, shape_version, name from areas where id = $1", [source.id]);

  const res = await call(m.a, "POST", "/areas/from-shared", { body: { shared_area_id: source.id, biz_type: "general", role: "both" }, headers: { "idempotency-key": randomUUID() } });
  assert.equal(res.status, 201, res.text);
  assertMatchesOpenApi("POST", "/tenant/v1/areas/from-shared", res);
  const copy = res.body;
  assert.notEqual(copy.id, source.id);
  assert.deepEqual([copy.name, copy.city_id, copy.biz_type, copy.role, copy.shared_source], [{ zh: "共享·新宿西口" }, m.ids.tokyo, "general", "both", { shared_area_id: source.id, shape_version: 1 }]);
  assert.deepEqual(copy.polygons.map((polygon: any) => [polygon.kind, polygon.source, polygon.geometry]), [["operate", "pasted", square(139.69, 35.69, 0.05)]]);
  const owner = await api.db.owner.query("select tenant_id from areas where id = $1", [copy.id]);
  assert.equal(owner.rows[0].tenant_id, m.a.tenantId, "副本在甲名下（租户隔离照旧）");
  assert.deepEqual((await api.db.owner.query("select version, shape_version, name from areas where id = $1", [source.id])).rows, before.rows, "引用不碰来源");
  // 副本不进共享库（不会出现两份）
  const seenByB = await call(m.b, "GET", `/shared-areas?city_id=${m.ids.tokyo}&q=${encodeURIComponent("新宿西口")}`);
  assert.equal(seenByB.body.items.some((entry: any) => entry.id === copy.id), false);

  // 乙只改名：不算新版本
  const renamed = await ok(call(m.b, "PUT", `/areas/${source.id}`, { body: { name: { zh: "共享·新宿西口（改名）" }, biz_type: "point_to_point", polygons: source.polygons.map(({ seq: _seq, ...polygon }: any) => polygon) }, headers: { "if-match": `"${source.version}"` } }));
  assert.equal(renamed.shape_version, 1);
  // 乙改图形：版本加一
  const reshaped = await ok(call(m.b, "PUT", `/areas/${source.id}`, { body: { name: renamed.name, biz_type: "point_to_point", polygons: [{ kind: "operate", geometry: square(139.68, 35.68, 0.08) }] }, headers: { "if-match": `"${renamed.version}"` } }));
  assert.equal(reshaped.shape_version, 2);

  // 甲的副本一分不变，详情提示库里有新版本
  const stale = await call(m.a, "GET", `/areas/${copy.id}`);
  assertMatchesOpenApi("GET", "/tenant/v1/areas/{id}", stale);
  assert.deepEqual([stale.body.version, stale.body.polygons[0].geometry, stale.body.shared_source], [copy.version, square(139.69, 35.69, 0.05), { shared_area_id: source.id, shape_version: 1, latest_shape_version: 2 }]);
  const listed = await ok(call(m.a, "GET", `/areas?q=${encodeURIComponent("新宿西口")}`));
  assert.deepEqual(listed.items.find((item: any) => item.id === copy.id)?.shared_source, { shared_area_id: source.id, shape_version: 1, latest_shape_version: 2 });

  // 切换：版本号不对 → 409；对 → 图形换成来源现在的，来源版本记为 2，名称、业务类型不动
  assert.equal((await call(m.a, "POST", `/areas/${copy.id}/sync-shared`, { headers: { "if-match": `"${copy.version + 5}"` } })).status, 409);
  const synced = await call(m.a, "POST", `/areas/${copy.id}/sync-shared`, { headers: { "if-match": `"${copy.version}"` } });
  assert.equal(synced.status, 200, synced.text);
  assertMatchesOpenApi("POST", "/tenant/v1/areas/{id}/sync-shared", synced);
  assert.deepEqual([synced.body.name, synced.body.biz_type, synced.body.polygons[0].geometry, synced.body.shared_source], [{ zh: "共享·新宿西口" }, "general", square(139.68, 35.68, 0.08), { shared_area_id: source.id, shape_version: 2, latest_shape_version: 2 }]);
  // 已是最新：原样返回，不加版本
  const again = await ok(call(m.a, "POST", `/areas/${copy.id}/sync-shared`, { headers: { "if-match": `"${synced.body.version}"` } }));
  assert.equal(again.version, synced.body.version);
  const audit = await api.db.owner.query("select action, after from audit_logs where resource = 'area' and resource_id = $1 order by id", [copy.id]);
  assert.deepEqual(audit.rows.map((row) => row.action), ["create", "update"]);
  assert.deepEqual(audit.rows[0].after.shared_source, { shared_area_id: source.id, shape_version: 1 });
  assert.equal(audit.rows[1].after.shared_source_shape_version, 2);

  // 来源停用：不在库里，提示 latest 为 null，切换 409；自己画的区域切换 409
  await ok(call(m.b, "POST", `/areas/${source.id}/disable`));
  const gone = await ok(call(m.a, "GET", `/areas/${copy.id}`));
  assert.equal(gone.shared_source.latest_shape_version, null);
  assert.equal((await call(m.a, "GET", `/shared-areas/${source.id}`)).status, 404);
  const unavailable = await call(m.a, "POST", `/areas/${copy.id}/sync-shared`, { headers: { "if-match": `"${again.version}"` } });
  assert.deepEqual([unavailable.status, unavailable.body.error?.code], [409, "SHARED_AREA_UNAVAILABLE"]);
  const own = await newArea(m.a, "甲自己画的", 139.8, 35.7, 0.02);
  const notShared = await call(m.a, "POST", `/areas/${own.id}/sync-shared`, { headers: { "if-match": `"${own.version}"` } });
  assert.deepEqual([notShared.status, notShared.body.error?.code], [409, "NOT_FROM_SHARED_LIBRARY"]);
});

test("引用时同城重名照常 409；可以换一个名字引用", async () => {
  const source = await newArea(m.b, "共享·品川港南", 139.74, 35.62);
  await newArea(m.a, "共享·品川港南", 139.9, 35.9, 0.01);
  const taken = await call(m.a, "POST", "/areas/from-shared", { body: { shared_area_id: source.id, biz_type: "general" }, headers: { "idempotency-key": randomUUID() } });
  assert.deepEqual([taken.status, taken.body.error?.code], [409, "AREA_NAME_TAKEN"]);
  const renamed = await call(m.a, "POST", "/areas/from-shared", { body: { shared_area_id: source.id, name: { zh: "品川港南（引用）" }, biz_type: "general" }, headers: { "idempotency-key": randomUUID() } });
  assert.equal(renamed.status, 201, renamed.text);
  assert.equal((await call(m.a, "POST", "/areas/from-shared", { body: { shared_area_id: "99999999-9999-4999-8999-999999999999", biz_type: "general" }, headers: { "idempotency-key": randomUUID() } })).status, 404);
});

test("查相似：同名、营运区重叠都能找到（同名在前）；不同城市、不重叠的不出现；自己的不算", async () => {
  const sameName = await newArea(m.b, "共享·上野公园", 139.5, 35.9, 0.01);
  const overlapping = await newArea(m.b, "共享·秋叶原", 139.77, 35.69, 0.03);
  const res = await call(m.a, "POST", "/shared-areas/similar", { body: { city_id: m.ids.tokyo, name: { zh: "共享·上野公园" }, polygons: [{ kind: "operate", geometry: square(139.78, 35.7, 0.01) }] } });
  assert.equal(res.status, 200, res.text);
  assertMatchesOpenApi("POST", "/tenant/v1/shared-areas/similar", res);
  const ids = res.body.items.map((item: any) => item.id);
  assert.ok(ids.indexOf(sameName.id) === 0, res.text);
  assert.deepEqual(res.body.items.find((item: any) => item.id === overlapping.id)?.reasons, ["overlap"]);
  assert.deepEqual(res.body.items[0].reasons, ["name"]);
  const far = await ok(call(m.a, "POST", "/shared-areas/similar", { body: { city_id: m.ids.tokyo, name: { zh: "完全不同的名字" }, polygons: [{ kind: "operate", geometry: square(150, 10, 0.01) }] } }));
  assert.equal(far.items.some((item: any) => item.id === sameName.id || item.id === overlapping.id), false);
  const self = await ok(call(m.b, "POST", "/shared-areas/similar", { body: { city_id: m.ids.tokyo, name: { zh: "共享·上野公园" } } }));
  assert.equal(self.items.some((item: any) => item.id === sameName.id), false);
});

test("测试供应商的区域不进共享库（标成测试供应商期间看不到，取消后又出现）", async () => {
  const source = await newArea(m.b, "共享·测试供应商不进库", 139.6, 35.55, 0.01);
  const seen = async (): Promise<boolean> => (await ok(call(m.a, "GET", `/shared-areas?city_id=${m.ids.tokyo}&q=${encodeURIComponent("测试供应商不进库")}`))).items.some((item: any) => item.id === source.id);
  assert.equal(await seen(), true);
  const status = (await api.db.owner.query("select status from tenants where id = $1", [m.b.tenantId])).rows[0].status;
  await api.db.owner.query("update tenants set status = 'signed' where id = $1", [m.b.tenantId]);
  await api.db.owner.query("update tenants set is_test_tenant = true where id = $1", [m.b.tenantId]);
  try {
    assert.equal(await seen(), false);
    assert.equal((await call(m.a, "GET", `/shared-areas/${source.id}`)).status, 404);
  } finally {
    await api.db.owner.query("update tenants set is_test_tenant = false where id = $1", [m.b.tenantId]);
    await api.db.owner.query("update tenants set status = $2 where id = $1", [m.b.tenantId, status]);
  }
  assert.equal(await seen(), true);
});
