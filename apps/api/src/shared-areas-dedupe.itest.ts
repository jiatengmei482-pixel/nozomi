/**
 * M8-31b 共享库去重（ADR 0083 补充，业主 2026-11-13 选 B），经真实接口、真实 PostgreSQL：
 * - 平台列出一个城市的共享区域（含疑似重复、副本数），把一份标成另一份的重复：供应商的共享库列表、详情、相似提示里不再有它；
 *   引用它时改为复制保留的那份；
 * - 不动任何供应商的区域、已有副本和报价：被隐藏的区域在自己供应商那里一字不变，已有副本的来源不变（照旧看得到新版本、能切换），
 *   同一个询价前后逐字段一致；
 * - 撤销后恢复；每次标记、撤销写审计；规则挡住链和环（含两人同时反向标记）；
 * - 权限：看用 master_data.read，标记、撤销用 master_data.manage；租户令牌调不了平台接口；租户看不到标记的原因和别家的信息。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type ApiResponse, type HttpMethod, type TenantFixture, type TestApi, createTestApi } from "./testing/api.ts";
import { DROPOFF, type Market, buildMarket, ok } from "./testing/market.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";

let api: TestApi;
let m: Market;
let c: TenantFixture;

const r6 = (value: number): number => Math.round(value * 1e6) / 1e6;
const square = (lng: number, lat: number, size: number) => ({
  type: "Polygon",
  coordinates: [[[lng, lat], [r6(lng + size), lat], [r6(lng + size), r6(lat + size)], [lng, r6(lat + size)], [lng, lat]]],
});

const tenant = (who: TenantFixture, method: HttpMethod, path: string, options: { body?: unknown; headers?: Record<string, string> } = {}): Promise<ApiResponse> =>
  api.call(method, `/tenant/v1${path}`, { token: who.adminToken, ...(options.body === undefined ? {} : { body: options.body }), ...(options.headers ? { headers: options.headers } : {}) });
const platform = (token: string, method: HttpMethod, path: string, body?: unknown): Promise<ApiResponse> => api.call(method, `/platform/v1${path}`, { token, ...(body === undefined ? {} : { body }) });

async function newArea(who: TenantFixture, name: string, lng: number, lat: number, size = 0.05, cityId = m.ids.tokyo): Promise<any> {
  api.clock.advance(1_000);
  const res = await tenant(who, "POST", "/areas", { body: { city_id: cityId, name: { zh: name }, biz_type: "point_to_point", role: "pricing", polygons: [{ kind: "operate", geometry: square(lng, lat, size) }] }, headers: { "idempotency-key": randomUUID() } });
  assert.equal(res.status, 201, res.text);
  return res.body;
}

async function reference(who: TenantFixture, sharedAreaId: string, name?: string): Promise<ApiResponse> {
  api.clock.advance(1_000);
  return tenant(who, "POST", "/areas/from-shared", { body: { shared_area_id: sharedAreaId, biz_type: "general", ...(name === undefined ? {} : { name: { zh: name } }) }, headers: { "idempotency-key": randomUUID() } });
}

const mark = (hideId: string, keepId: string, token = m.staff.masterData.token, reason = "同一块区域，留画得更准的那份"): Promise<ApiResponse> =>
  platform(token, "POST", `/shared-areas/${hideId}/mark-duplicate`, { keep_area_id: keepId, reason });
const unmark = (hideId: string, token = m.staff.masterData.token, body: unknown = { reason: "判断错了，恢复" }): Promise<ApiResponse> => platform(token, "POST", `/shared-areas/${hideId}/unmark-duplicate`, body);

const libraryIds = async (who: TenantFixture, q?: string): Promise<string[]> =>
  (await ok(tenant(who, "GET", `/shared-areas?city_id=${m.ids.tokyo}${q === undefined ? "" : `&q=${encodeURIComponent(q)}`}`))).items.map((item: any) => item.id);
const platformList = async (q?: string): Promise<any[]> => (await ok(platform(m.staff.readonly.token, "GET", `/shared-areas?city_id=${m.ids.tokyo}${q === undefined ? "" : `&q=${encodeURIComponent(q)}`}`))).items;

/** 区域表里这些行的全部列（被隐藏、保留的区域和已有副本）：标记、撤销前后必须一字不差 */
async function areaRows(ids: readonly string[]): Promise<unknown[]> {
  const areas = await api.db.owner.query("select * from areas where id = any($1::uuid[]) order by id", [[...ids]]);
  const polygons = await api.db.owner.query("select * from area_polygons where area_id = any($1::uuid[]) order by area_id, position", [[...ids]]);
  return [areas.rows, polygons.rows];
}

/** 市场里两家各自的「东京全域」（都挂在已上架的成田接送机商品上） */
async function marketAreas(): Promise<{ a: string; b: string }> {
  const rows = await api.db.owner.query<{ id: string; tenant_id: string }>("select id, tenant_id from areas where name->>'zh' = '东京全域' and tenant_id = any($1::uuid[])", [[m.a.tenantId, m.b.tenantId]]);
  const of = (tenantId: string): string => (rows.rows.find((row) => row.tenant_id === tenantId) as { id: string }).id;
  return { a: of(m.a.tenantId), b: of(m.b.tenantId) };
}

/** 报价试算（看得到各供应商的结算价、对外价）。测试时钟在两次之间走过，只有报价的生成、过期时间跟着变，去掉它们再逐字段比 */
const withoutClock = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(withoutClock)
    : value !== null && typeof value === "object"
      ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== "created_at" && key !== "expires_at").map(([key, inner]) => [key, withoutClock(inner)]))
      : value;
const preview = async (): Promise<unknown> =>
  withoutClock(await ok(platform(m.root, "POST", "/quotes/preview", { city_id: m.ids.tokyo, category: "airport_transfer", place_id: m.ids.narita, currency: "JPY", direction: "pickup", dropoff: DROPOFF, service_time: "2026-10-20T10:00", passengers: 2, luggage: 1 })));

before(async () => {
  api = await createTestApi();
  m = await buildMarket(api);
  c = await api.tenantWithAdmin(m.root, "丙车队", "admin@dedupe-c.test");
});
after(() => api.close());

test("平台列表：一个城市里库里的全部区域，带疑似重复（同名 / 重叠）和副本数；不显示创建者", async () => {
  const { a, b } = await marketAreas();
  await ok(reference(c, b, "东京全域（丙引用乙）"), 201);
  const res = await platform(m.staff.readonly.token, "GET", `/shared-areas?city_id=${m.ids.tokyo}`);
  assert.equal(res.status, 200, res.text);
  assertMatchesOpenApi("GET", "/platform/v1/shared-areas", res);
  const byId = new Map(res.body.items.map((item: any) => [item.id, item]));
  const itemA: any = byId.get(a);
  const itemB: any = byId.get(b);
  assert.ok(itemA && itemB, res.text);
  assert.deepEqual(itemA.similar, [{ id: b, reasons: ["name", "overlap"] }]);
  assert.deepEqual(itemB.similar, [{ id: a, reasons: ["name", "overlap"] }]);
  assert.deepEqual([itemA.copy_count, itemB.copy_count, itemA.duplicate], [0, 1, null]);
  assert.ok(!res.text.includes(m.a.tenantId) && !res.text.includes(m.b.tenantId) && !res.text.includes(c.tenantId), "不带创建者");
  // 副本不在列表里；按名称筛只影响列出的项
  assert.equal(res.body.items.some((item: any) => item.name.zh === "东京全域（丙引用乙）"), false);
  const filtered = await platformList("东京全");
  assert.deepEqual(filtered.map((item: any) => item.id).sort(), [a, b].sort());
  assert.deepEqual((await platformList("不存在的名字")).length, 0);
  const bad = await platform(m.staff.readonly.token, "GET", "/shared-areas");
  assert.equal(bad.status, 400, "city_id 必填");
});

test("标为重复：租户的库里不再有它、引用它改为复制保留的那份；被隐藏的区域、已有副本、报价一字不变；撤销后恢复；都写审计", async () => {
  const { a: keepId, b: hideId } = await marketAreas();
  const oldCopy = await ok(reference(c, hideId, "东京全域（标记前引用）"), 201);
  assert.equal(oldCopy.shared_source.shared_area_id, hideId);
  const rowsBefore = await areaRows([keepId, hideId, oldCopy.id]);
  const quoteBefore = await preview();
  assert.ok(JSON.stringify(quoteBefore).includes("19800"), JSON.stringify(quoteBefore));
  const hiddenByOwnerBefore = await ok(tenant(m.b, "GET", `/areas/${hideId}`));
  const oldCopyBefore = await ok(tenant(c, "GET", `/areas/${oldCopy.id}`));
  assert.ok((await libraryIds(c)).includes(hideId));

  const marked = await mark(hideId, keepId);
  assert.equal(marked.status, 200, marked.text);
  assertMatchesOpenApi("POST", "/platform/v1/shared-areas/{id}/mark-duplicate", marked);
  assert.deepEqual(
    [marked.body.area_id, marked.body.keep_area_id, marked.body.reason, marked.body.marked_by, marked.body.revoked_at],
    [hideId, keepId, "同一块区域，留画得更准的那份", { id: m.staff.masterData.id, name: "md" }, null],
  );

  // 供应商看到的共享库：列表、详情、相似提示里都没有它；保留的那份照常在
  const seen = await libraryIds(c);
  assert.ok(!seen.includes(hideId) && seen.includes(keepId), JSON.stringify(seen));
  assert.ok(!(await libraryIds(m.a)).includes(hideId), "甲也看不到被隐藏的那份");
  assert.equal((await tenant(c, "GET", `/shared-areas/${hideId}`)).status, 404);
  const similar = await ok(tenant(c, "POST", "/shared-areas/similar", { body: { city_id: m.ids.tokyo, name: { zh: "东京全域" } } }));
  assert.deepEqual(similar.items.map((item: any) => item.id), [keepId]);

  // 以后的引用指向保留的那份
  const redirected = await reference(c, hideId, "东京全域（标记后引用）");
  assert.equal(redirected.status, 201, redirected.text);
  assertMatchesOpenApi("POST", "/tenant/v1/areas/from-shared", redirected);
  const keepShape = await ok(tenant(m.a, "GET", `/areas/${keepId}`));
  assert.deepEqual(redirected.body.shared_source, { shared_area_id: keepId, shape_version: keepShape.shape_version });
  assert.deepEqual(redirected.body.polygons.map((polygon: any) => polygon.geometry), keepShape.polygons.map((polygon: any) => polygon.geometry));
  assert.ok(!redirected.text.includes(m.a.tenantId) && !redirected.text.includes("留画得更准"), "不带保留那份的供应商、不带标记原因");

  // 不动任何供应商的区域、已有副本和报价
  assert.deepEqual(await areaRows([keepId, hideId, oldCopy.id]), rowsBefore, "区域表、图形表一字不差");
  assert.deepEqual(await ok(tenant(m.b, "GET", `/areas/${hideId}`)), hiddenByOwnerBefore, "被隐藏的区域在自己供应商那里不变");
  const oldCopyAfter = await ok(tenant(c, "GET", `/areas/${oldCopy.id}`));
  assert.deepEqual(oldCopyAfter, oldCopyBefore, "已有副本的来源、版本、「库里有新版本」的提示都不变");
  assert.equal(oldCopyAfter.shared_source.latest_shape_version, 1, "已有副本照旧看得到来源（不是 null）");
  assert.deepEqual(await preview(), quoteBefore, "同一个询价前后逐字段一致");

  // 平台列表：被隐藏的那份带标记、不算疑似；保留那份的疑似里也不再有它
  const listed = new Map((await platformList()).map((item: any) => [item.id, item]));
  const hiddenItem: any = listed.get(hideId);
  assert.deepEqual(hiddenItem.duplicate, { id: marked.body.id, keep_area_id: keepId, keep_area_name: { zh: "东京全域" }, keep_area_listed: true, reason: "同一块区域，留画得更准的那份", marked_by: { id: m.staff.masterData.id, name: "md" }, marked_at: marked.body.marked_at });
  assert.deepEqual([hiddenItem.similar, (listed.get(keepId) as any).similar, (listed.get(keepId) as any).copy_count], [[], [], 1]);

  // 审计：谁、何时、为什么
  const created = await api.db.owner.query("select tenant_id, actor_type, actor_id, action, before, after from audit_logs where resource = 'shared_area_duplicate' and resource_id = $1 order by id", [marked.body.id]);
  assert.deepEqual(created.rows, [{ tenant_id: null, actor_type: "platform_user", actor_id: m.staff.masterData.id, action: "create", before: null, after: { area_id: hideId, keep_area_id: keepId, reason: "同一块区域，留画得更准的那份" } }]);

  // 撤销：恢复出现在库里，以后引用它的照常引用它；标记期间转过去的副本不变
  const revoked = await unmark(hideId);
  assert.equal(revoked.status, 200, revoked.text);
  assertMatchesOpenApi("POST", "/platform/v1/shared-areas/{id}/unmark-duplicate", revoked);
  assert.deepEqual([revoked.body.id, revoked.body.revoked_by, revoked.body.revoke_reason, typeof revoked.body.revoked_at], [marked.body.id, { id: m.staff.masterData.id, name: "md" }, "判断错了，恢复", "string"]);
  assert.ok((await libraryIds(c)).includes(hideId));
  assert.equal((await tenant(c, "GET", `/shared-areas/${hideId}`)).status, 200);
  const direct = await ok(reference(c, hideId, "东京全域（撤销后引用）"), 201);
  assert.equal(direct.shared_source.shared_area_id, hideId);
  assert.equal((await ok(tenant(c, "GET", `/areas/${redirected.body.id}`))).shared_source.shared_area_id, keepId, "标记期间转到保留那份的副本来源不变");
  assert.deepEqual(await areaRows([keepId, hideId, oldCopy.id]), rowsBefore);
  assert.deepEqual(await preview(), quoteBefore);
  const revokeAudit = await api.db.owner.query("select actor_id, action, before, after from audit_logs where resource = 'shared_area_duplicate' and resource_id = $1 order by id", [marked.body.id]);
  assert.deepEqual(revokeAudit.rows[1], { actor_id: m.staff.masterData.id, action: "revoke", before: { area_id: hideId, keep_area_id: keepId, revoked: false }, after: { area_id: hideId, keep_area_id: keepId, revoked: true, reason: "判断错了，恢复" } });
  // 历史行留下；再撤销 409
  assert.equal((await api.db.owner.query("select count(*)::int as n from shared_area_duplicates where area_id = $1", [hideId])).rows[0].n, 1);
  const again = await unmark(hideId);
  assert.deepEqual([again.status, again.body.error?.code], [409, "SHARED_AREA_NOT_HIDDEN"]);
  // 不带请求体也能撤销（原因可空）
  await ok(mark(hideId, keepId));
  const bare = await api.call("POST", `/platform/v1/shared-areas/${hideId}/unmark-duplicate`, { token: m.staff.masterData.token });
  assert.deepEqual([bare.status, bare.body.revoke_reason], [200, null]);
});

test("已有副本的来源被隐藏后：来源改图形照旧提示「库里有新版本」，照旧能切换（来源不改）", async () => {
  const hide = await newArea(m.b, "去重·新宿西口", 139.69, 35.69);
  const keep = await newArea(m.a, "去重·新宿西口", 139.691, 35.691);
  const copy = await ok(reference(c, hide.id, "新宿西口（丙）"), 201);
  await ok(mark(hide.id, keep.id));
  api.clock.advance(1_000);
  const reshaped = await ok(tenant(m.b, "PUT", `/areas/${hide.id}`, { body: { name: hide.name, biz_type: "point_to_point", polygons: [{ kind: "operate", geometry: square(139.68, 35.68, 0.08) }] }, headers: { "if-match": `"${hide.version}"` } }));
  assert.equal(reshaped.shape_version, 2);
  const stale = await ok(tenant(c, "GET", `/areas/${copy.id}`));
  assert.deepEqual(stale.shared_source, { shared_area_id: hide.id, shape_version: 1, latest_shape_version: 2 });
  const synced = await tenant(c, "POST", `/areas/${copy.id}/sync-shared`, { headers: { "if-match": `"${copy.version}"` } });
  assert.equal(synced.status, 200, synced.text);
  assert.deepEqual([synced.body.shared_source, synced.body.polygons[0].geometry], [{ shared_area_id: hide.id, shape_version: 2, latest_shape_version: 2 }, square(139.68, 35.68, 0.08)]);
  // 被隐藏的那份在自己供应商那里照常能停用；停用后才「不在库里」
  await ok(tenant(m.b, "POST", `/areas/${hide.id}/disable`));
  assert.equal((await ok(tenant(c, "GET", `/areas/${copy.id}`))).shared_source.latest_shape_version, null);
});

test("规则：已隐藏、保留的那份、不同城、自己、副本、不存在、空原因都被挡住；保留的那份停用后列表提示、引用 404", async () => {
  const hide = await newArea(m.b, "去重·池袋东口", 139.71, 35.73, 0.01);
  const keep = await newArea(m.a, "去重·池袋东口", 139.711, 35.731, 0.01);
  const other = await newArea(c, "去重·池袋东口", 139.712, 35.732, 0.01);
  const osaka = await newArea(c, "去重·梅田", 135.49, 34.70, 0.01, m.ids.osaka);
  const copy = await ok(reference(m.a, other.id, "池袋东口（甲引用丙）"), 201);
  await ok(mark(hide.id, keep.id));
  const code = async (res: Promise<ApiResponse>): Promise<[number, string]> => {
    const done = await res;
    return [done.status, done.body.error?.code];
  };
  assert.deepEqual(await code(mark(hide.id, other.id)), [409, "SHARED_AREA_ALREADY_HIDDEN"]);
  assert.deepEqual(await code(mark(keep.id, other.id)), [409, "SHARED_AREA_IS_KEEP_TARGET"]);
  assert.deepEqual(await code(mark(other.id, hide.id)), [409, "DUPLICATE_KEEP_UNAVAILABLE"], "被隐藏的不能当保留的（不形成链）");
  assert.deepEqual(await code(mark(other.id, osaka.id)), [409, "DUPLICATE_CITY_MISMATCH"]);
  assert.deepEqual(await code(mark(other.id, other.id)), [409, "DUPLICATE_SAME_AREA"]);
  assert.deepEqual(await code(mark(other.id, copy.id)), [409, "DUPLICATE_KEEP_UNAVAILABLE"], "副本不在库里");
  assert.deepEqual(await code(mark(copy.id, other.id)), [404, "NOT_FOUND"]);
  assert.deepEqual(await code(mark("99999999-9999-4999-8999-999999999999", other.id)), [404, "NOT_FOUND"]);
  assert.deepEqual(await code(mark(other.id, keep.id, m.staff.masterData.token, "   ")), [400, "VALIDATION_FAILED"]);
  assert.deepEqual(await code(platform(m.staff.masterData.token, "POST", `/shared-areas/${other.id}/mark-duplicate`, { keep_area_id: keep.id })), [400, "VALIDATION_FAILED"]);
  assert.deepEqual(await code(platform(m.staff.masterData.token, "POST", `/shared-areas/${other.id}/mark-duplicate`, { keep_area_id: keep.id, reason: "x".repeat(501) })), [400, "VALIDATION_FAILED"]);
  // 保留的那份可以同时是几份的保留
  await ok(mark(other.id, keep.id));
  // 保留的那份被它的供应商停用：列表提示，引用被隐藏的那份 404（不会悄悄复制别的）
  await ok(tenant(m.a, "POST", `/areas/${keep.id}/disable`));
  const item = (await platformList("池袋东口")).find((entry: any) => entry.id === hide.id);
  assert.deepEqual([item.duplicate.keep_area_listed, item.duplicate.keep_area_name], [false, null]);
  assert.equal((await reference(c, hide.id, "池袋东口（转不过去）")).status, 404);
  await ok(unmark(hide.id));
  await ok(unmark(other.id));
});

test("两人同时反向标记（A→B、B→A）：只有一个成功，不会形成环", async () => {
  const x = await newArea(m.a, "去重·品川", 139.74, 35.62, 0.01);
  const y = await newArea(m.b, "去重·品川", 139.741, 35.621, 0.01);
  const results = await Promise.all([mark(x.id, y.id), mark(y.id, x.id)]);
  assert.deepEqual(results.map((res) => res.status).sort(), [200, 409], results.map((res) => res.text).join("\n"));
  const active = await api.db.owner.query("select count(*)::int as n from shared_area_duplicates where area_id = any($1::uuid[]) and revoked_at is null", [[x.id, y.id]]);
  assert.equal(active.rows[0].n, 1);
});

test("权限：看要 master_data.read，标记、撤销要 master_data.manage（没有的 403，库里不留痕）；租户令牌调不了平台接口", async () => {
  const hide = await newArea(m.b, "去重·权限", 139.6, 35.5, 0.01);
  const keep = await newArea(m.a, "去重·权限", 139.601, 35.501, 0.01);
  for (const token of [m.staff.readonly.token, m.staff.operations.token, m.staff.cm1.token]) {
    const res = await mark(hide.id, keep.id, token);
    assert.deepEqual([res.status, res.body.error], [403, { code: "FORBIDDEN", message: "当前角色没有这个操作的权限", details: { required: "master_data.manage" } }]);
  }
  assert.equal((await api.db.owner.query("select count(*)::int as n from shared_area_duplicates where area_id = $1", [hide.id])).rows[0].n, 0);
  assert.equal((await platform(m.staff.operations.token, "GET", `/shared-areas?city_id=${m.ids.tokyo}`)).status, 200, "运营能看");
  await ok(mark(hide.id, keep.id, m.root));
  assert.equal((await unmark(hide.id, m.staff.readonly.token)).status, 403);
  assert.equal((await api.db.owner.query("select count(*)::int as n from shared_area_duplicates where area_id = $1 and revoked_at is null", [hide.id])).rows[0].n, 1, "没权限的撤销不生效");
  for (const [method, path, body] of [
    ["GET", `/shared-areas?city_id=${m.ids.tokyo}`, undefined],
    ["POST", `/shared-areas/${hide.id}/mark-duplicate`, { keep_area_id: keep.id, reason: "租户不能标" }],
    ["POST", `/shared-areas/${hide.id}/unmark-duplicate`, {}],
  ] as const) {
    const res = await platform(m.b.adminToken, method, path, body);
    assert.deepEqual([res.status, res.body.error?.code], [401, "UNAUTHENTICATED"], `${method} ${path}`);
  }
  assert.equal((await api.db.owner.query("select count(*)::int as n from shared_area_duplicates where area_id = $1 and revoked_at is null", [hide.id])).rows[0].n, 1);
  await ok(unmark(hide.id, m.root));
});

test("租户隔离：被隐藏区域的供应商、别的供应商都看不到标记和原因；租户 A 看不到租户 B 的私有信息", async () => {
  const hide = await newArea(m.b, "去重·隔离", 139.62, 35.52, 0.01);
  const keep = await newArea(m.a, "去重·隔离", 139.621, 35.521, 0.01);
  await ok(mark(hide.id, keep.id, m.staff.masterData.token, "原因·只给平台看"));
  for (const who of [m.a, m.b, c]) {
    const list = await tenant(who, "GET", `/shared-areas?city_id=${m.ids.tokyo}&q=${encodeURIComponent("去重·隔离")}`);
    const similar = await tenant(who, "POST", "/shared-areas/similar", { body: { city_id: m.ids.tokyo, name: { zh: "去重·隔离" } } });
    const own = await tenant(who, "GET", "/areas?q=" + encodeURIComponent("去重·隔离"));
    for (const res of [list, similar, own]) {
      assert.equal(res.status, 200, res.text);
      assert.ok(!res.text.includes("原因·只给平台看") && !res.text.includes("duplicate") && !res.text.includes(m.staff.masterData.id), res.text);
    }
    assert.ok(!list.text.includes(hide.id), "列表里没有被隐藏的那份");
    for (const other of [m.a, m.b, c].filter((x) => x !== who)) assert.ok(!list.text.includes(other.tenantId) && !similar.text.includes(other.tenantId));
  }
  // 乙自己的区域照常（不受标记影响），甲读不到乙的区域本身
  assert.equal((await tenant(m.b, "GET", `/areas/${hide.id}`)).status, 200);
  assert.equal((await tenant(m.a, "GET", `/areas/${hide.id}`)).status, 404);
  // 丙引用被隐藏的那份 → 副本在丙名下、来源是甲的那份；里面没有甲的租户编号和业务类型、用途
  const copy = await ok(reference(c, hide.id, "隔离（丙）"), 201);
  assert.equal((await api.db.owner.query("select tenant_id from areas where id = $1", [copy.id])).rows[0].tenant_id, c.tenantId);
  assert.equal((await tenant(m.a, "GET", `/areas/${copy.id}`)).status, 404, "甲读不到丙的副本");
  await ok(unmark(hide.id));
});

test("引用被隐藏的那份、而保留的那份正是自己的区域：不复制，409 SHARED_AREA_IS_YOURS（不落到同城重名上）；别家照常转到保留的那份", async () => {
  const hide = await newArea(m.b, "去重·自己的", 139.63, 35.53, 0.01);
  const keep = await newArea(m.a, "去重·自己的", 139.631, 35.531, 0.01);
  await ok(mark(hide.id, keep.id));
  const before = (await api.db.owner.query("select count(*)::int as n from areas where tenant_id = $1", [m.a.tenantId])).rows[0].n;
  const mine = await reference(m.a, hide.id);
  assert.deepEqual([mine.status, mine.body.error?.code], [409, "SHARED_AREA_IS_YOURS"], mine.text);
  assertMatchesOpenApi("POST", "/tenant/v1/areas/from-shared", mine);
  assert.ok(!mine.text.includes(m.b.tenantId) && !mine.text.includes(hide.id));
  assert.equal((await api.db.owner.query("select count(*)::int as n from areas where tenant_id = $1", [m.a.tenantId])).rows[0].n, before, "甲名下没有多出区域");
  // 直接拿自己的区域编号来引用也一样
  assert.equal((await reference(m.a, keep.id)).body.error?.code, "SHARED_AREA_IS_YOURS");
  // 丙照常转到保留的那份
  const copy = await ok(reference(c, hide.id, "自己的（丙）"), 201);
  assert.equal(copy.shared_source.shared_area_id, keep.id);
  await ok(unmark(hide.id));
});
