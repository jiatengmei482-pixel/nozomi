/**
 * M8-18：区域地图的接口（ADR 0074）。
 * - `GET /tenant/v1/area-map`：只给令牌所属供应商的区域（供应商 A 拿不到 B 的；带 B 的城市筛选也拿不到）；每一项是区域详情 + 最近修改人；
 *   没有 `area.read` 的角色 403；应答和 openapi.yaml 的 `AreaMapItem` 字段一致；没有对外价、加价比例（规则 4）。
 * - `GET /platform/v1/area-map`：`product.read` 才能看，全部供应商，可按供应商、城市筛；供应商的令牌调不了。
 * - `GET /platform/v1/map/config`：任何平台员工；和供应商后台的同一份。
 * 只读：调这些接口不写库、不写审计日志。测试数据在这里构造，结束时随测试库删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { PLATFORM_ROLES, type PlatformRole, platformRoleCan } from "@nozomi/domain";
import { type TenantFixture, type TestApi, TEST_PASSWORD, addTenantUser, createTestApi } from "./testing/api.ts";

const doc = parse(await readFile(new URL("../openapi.yaml", import.meta.url), "utf8")) as { components: { schemas: Record<string, { required: string[]; properties: Record<string, unknown> }> } };

let api: TestApi;
let root: string;
let a: TenantFixture;
let b: TenantFixture;
let tokyo: string;
let osaka: string;
const roleTokens = new Map<PlatformRole, string>();

function square(lng: number, lat: number, size: number): { type: "Polygon"; coordinates: number[][][] } {
  return { type: "Polygon", coordinates: [[[lng, lat], [lng + size, lat], [lng + size, lat + size], [lng, lat + size], [lng, lat]]] };
}

async function createArea(token: string, cityId: string, name: string, lng: number, lat: number): Promise<any> {
  const res = await api.call("POST", "/tenant/v1/areas", {
    token,
    headers: { "idempotency-key": crypto.randomUUID() },
    body: { city_id: cityId, name: { zh: name }, biz_type: "general", polygons: [{ kind: "operate", geometry: square(lng, lat, 0.1) }, { kind: "forbid", circle: { center: { lat: lat + 0.05, lng: lng + 0.05 }, radius_m: 500 } }] },
  });
  assert.equal(res.status, 201, res.text);
  return res.body;
}

async function writes(): Promise<number[]> {
  const row = (await api.db.owner.query("select (select count(*)::int from audit_logs) as l, (select count(*)::int from areas) as a, (select coalesce(sum(version), 0)::int from areas) as v")).rows[0];
  return [row.l, row.a, row.v];
}

before(async () => {
  api = await createTestApi();
  root = await api.superAdminToken();
  roleTokens.set("super_admin", root);
  for (const { key } of PLATFORM_ROLES) {
    if (key === "super_admin") continue;
    const email = `${key.replaceAll("_", "-")}@m818.test`;
    const invited = await api.call("POST", "/platform/v1/staff", { token: root, body: { email, name: key, role: key } });
    assert.equal(invited.status, 201, invited.text);
    await api.call("POST", "/platform/v1/auth/accept-invite", { body: { token: invited.body.invite.token, password: TEST_PASSWORD } });
    const login = await api.platformLogin({ body: { email, password: TEST_PASSWORD }, ip: `10.18.0.${roleTokens.size + 1}` });
    assert.equal(login.status, 200, login.text);
    roleTokens.set(key, login.body.access_token as string);
  }
  a = await api.tenantWithAdmin(root, "甲车队", "admin@m818-a.test");
  b = await api.tenantWithAdmin(root, "乙车队", "admin@m818-b.test");
  const city = async (code: string, name: string, lng: number, lat: number): Promise<string> => {
    const res = await api.call("POST", "/platform/v1/master/cities", { token: root, body: { code, country_code: "JP", name: { zh: name }, timezone: "Asia/Tokyo", center: { lng, lat } } });
    assert.equal(res.status, 201, res.text);
    return res.body.id as string;
  };
  tokyo = await city("CTY-JP-TYO", "东京", 139.6917, 35.6895);
  osaka = await city("CTY-JP-OSA", "大阪", 135.5011, 34.6938);
});
after(() => api.close());

test("没有区域时：空列表，没有预置数据", async () => {
  const res = await api.call("GET", "/tenant/v1/area-map", { token: a.adminToken });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(res.body, { items: [], truncated: false });
});

test("供应商后台：只给自己的区域，每一项 = 区域详情 + 最近修改人；字段和定义一致", async () => {
  const mine = await createArea(a.adminToken, tokyo, "甲东京", 139.6, 35.6);
  api.clock.advance(1_000);
  const mineOsaka = await createArea(a.adminToken, osaka, "甲大阪", 135.4, 34.6);
  const theirs = await createArea(b.adminToken, tokyo, "乙东京", 139.65, 35.65);
  const pricing = await addTenantUser(api, a.adminToken, "pricing@m818-a.test", "pricing");
  api.clock.advance(1_000);
  const renamed = await api.call("PUT", `/tenant/v1/areas/${mine.id}`, {
    token: pricing.token,
    headers: { "if-match": `"${mine.version}"` },
    body: { name: { zh: "甲东京 23 区" }, biz_type: "general", polygons: mine.polygons.map((polygon: any) => ({ id: polygon.id, kind: polygon.kind, label: polygon.label, source: polygon.source, circle: polygon.circle, geometry: polygon.circle ? null : polygon.geometry })) },
  });
  assert.equal(renamed.status, 200, renamed.text);

  const before = await writes();
  const res = await api.call("GET", "/tenant/v1/area-map", { token: a.adminToken });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual(await writes(), before, "只读：不写库、不写审计日志");
  assert.equal(res.body.truncated, false);
  assert.deepEqual(res.body.items.map((item: any) => item.id), [mine.id, mineOsaka.id], "按最近修改从新到旧；没有乙的区域");
  assert.ok(!res.text.includes(theirs.id), "乙的区域编号不出现在甲的应答里");
  const [first, second] = res.body.items;
  const schema = doc.components.schemas["AreaMapItem"] as { required: string[]; properties: Record<string, unknown> };
  assert.deepEqual(Object.keys(first).sort(), [...schema.required].sort());
  assert.deepEqual(Object.keys(schema.properties).sort(), [...schema.required].sort());
  const detail = (await api.call("GET", `/tenant/v1/areas/${mine.id}`, { token: a.adminToken })).body;
  const { last_editor: editor, ...rest } = first;
  assert.deepEqual(rest, detail, "除了最近修改人，和区域详情完全相同（带全部图形）");
  assert.deepEqual(editor, { type: "tenant_user", name: "pricing@m818-a.test", at: renamed.body.updated_at });
  assert.equal(second.last_editor.name, "甲车队管理员");
  assert.equal(second.polygons.length, 2);
  assert.ok(!/selling_price|markup|sell_price|price/i.test(JSON.stringify(Object.keys(first))), "规则 4：没有价格相关的字段");
  assert.ok(!res.text.includes("@m818-a.test\",\"type") && !res.text.includes("actor_email"), "不返回操作人的邮箱字段");

  // 筛选：城市、状态
  const filtered = await api.call("GET", `/tenant/v1/area-map?city_id=${osaka}`, { token: a.adminToken });
  assert.deepEqual(filtered.body.items.map((item: any) => item.id), [mineOsaka.id]);
  const disabled = await api.call("POST", `/tenant/v1/areas/${mineOsaka.id}/disable`, { token: a.adminToken });
  assert.equal(disabled.status, 200, disabled.text);
  assert.deepEqual((await api.call("GET", "/tenant/v1/area-map?status=active", { token: a.adminToken })).body.items.map((item: any) => item.id), [mine.id]);
  const disabledItem = (await api.call("GET", "/tenant/v1/area-map?status=disabled", { token: a.adminToken })).body.items[0];
  assert.deepEqual([disabledItem.id, disabledItem.status, disabledItem.last_editor.name], [mineOsaka.id, "disabled", "甲车队管理员"], "停用也算一次修改");
});

test("租户隔离：甲拿不到乙的区域——带乙所在的城市、乙的区域编号当城市都没用；查询参数里的 tenant_id 被拒绝", async () => {
  const bOnly = await api.call("GET", `/tenant/v1/area-map?city_id=${tokyo}`, { token: b.adminToken });
  assert.deepEqual(bOnly.body.items.map((item: any) => item.name.zh), ["乙东京"]);
  const aTokyo = await api.call("GET", `/tenant/v1/area-map?city_id=${tokyo}`, { token: a.adminToken });
  assert.deepEqual(aTokyo.body.items.map((item: any) => item.name.zh), ["甲东京 23 区"]);
  const smuggled = await api.call("GET", `/tenant/v1/area-map?tenant_id=${b.tenantId}`, { token: a.adminToken });
  assert.equal(smuggled.status, 400, "租户接口不接受 tenant_id 参数");
  const bArea = bOnly.body.items[0];
  // 甲也改不了乙的区域（区域的写接口本来的隔离，这里再从地图拿到的编号试一次）
  const write = await api.call("POST", `/tenant/v1/areas/${bArea.id}/disable`, { token: a.adminToken });
  assert.equal(write.status, 404);
  assert.equal((await api.call("GET", `/tenant/v1/areas/${bArea.id}`, { token: b.adminToken })).body.status, "active");
});

test("供应商后台的权限：只读能看；调度、财务没有 area.read，403；没登录 401；格式不对的参数 400", async () => {
  const readonly = await addTenantUser(api, a.adminToken, "readonly@m818-a.test", "readonly");
  assert.equal((await api.call("GET", "/tenant/v1/area-map", { token: readonly.token })).status, 200);
  for (const role of ["dispatch", "finance"]) {
    const user = await addTenantUser(api, a.adminToken, `${role}@m818-a.test`, role);
    assert.equal((await api.call("GET", "/tenant/v1/area-map", { token: user.token })).status, 403, role);
  }
  assert.equal((await api.call("GET", "/tenant/v1/area-map")).status, 401);
  assert.equal((await api.call("GET", "/tenant/v1/area-map?city_id=tokyo", { token: a.adminToken })).status, 400);
  assert.equal((await api.call("GET", "/tenant/v1/area-map?status=deleted", { token: a.adminToken })).status, 400);
  assert.equal((await api.call("GET", "/tenant/v1/area-map", { token: root })).status, 401, "平台的令牌不能调供应商的接口");
});

test("运营后台：product.read 才能看；全部供应商，带所属供应商；按供应商、城市筛；字段和定义一致", async () => {
  for (const { key } of PLATFORM_ROLES) {
    const res = await api.call("GET", "/platform/v1/area-map", { token: roleTokens.get(key) as string });
    assert.equal(res.status, platformRoleCan(key, "product.read") ? 200 : 403, key);
  }
  const before = await writes();
  const all = await api.call("GET", "/platform/v1/area-map", { token: root });
  assert.deepEqual(await writes(), before, "只读");
  assert.equal(all.body.items.length, 3);
  const item = all.body.items.find((entry: any) => entry.name.zh === "乙东京");
  assert.deepEqual(item.tenant, { id: b.tenantId, name: "乙车队", status: "active" });
  assert.equal(item.tenant_id, b.tenantId);
  assert.equal(item.last_editor.name, "乙车队管理员");
  const schema = doc.components.schemas["PlatformAreaMapItem"] as { required: string[]; properties: Record<string, unknown> };
  assert.deepEqual(Object.keys(item).sort(), [...schema.required].sort());
  assert.deepEqual(Object.keys(schema.properties).sort(), [...schema.required].sort());

  const byTenant = await api.call("GET", `/platform/v1/area-map?tenant_id=${a.tenantId}`, { token: root });
  assert.deepEqual(new Set(byTenant.body.items.map((entry: any) => entry.tenant_id)), new Set([a.tenantId]));
  const byCity = await api.call("GET", `/platform/v1/area-map?city_id=${tokyo}&status=active`, { token: root });
  assert.deepEqual(byCity.body.items.map((entry: any) => entry.name.zh).sort(), ["乙东京", "甲东京 23 区"]);
  assert.equal((await api.call("GET", "/platform/v1/area-map", { token: a.adminToken })).status, 401, "供应商的令牌不能调平台的接口");
  assert.equal((await api.call("GET", "/platform/v1/area-map?tenant_id=x", { token: root })).status, 400);
});

test("底图配置：任何平台员工都能取，和供应商后台的同一份", async () => {
  const tenantConfig = await api.call("GET", "/tenant/v1/map/config", { token: a.adminToken });
  for (const { key } of PLATFORM_ROLES) {
    const res = await api.call("GET", "/platform/v1/map/config", { token: roleTokens.get(key) as string });
    assert.equal(res.status, 200, key);
    assert.deepEqual(res.body, tenantConfig.body);
  }
  assert.equal((await api.call("GET", "/platform/v1/map/config")).status, 401);
  assert.equal((await api.call("GET", "/platform/v1/map/config", { token: a.adminToken })).status, 401);
});
