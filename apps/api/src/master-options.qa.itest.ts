/**
 * 测试角色补充（M4-13，ADR 0047），真实 PostgreSQL，只测 master-options.itest.ts 没有覆盖的部分：
 * - 字段白名单：往主数据里写上来源、边界这些管理字段，每个接口的每种模式都只返回约定的键，响应里找不到这些值；
 * - 停用项：停用、启用立即反映到选项；附加服务 include_disabled 的严格校验；地点、车型组没有 include_disabled；
 * - 数据范围不能靠参数绕过：多带参数、重复参数、换大小写、自己有主数据查看都不行；换角色立即生效；
 * - 「不分页」：超过一页（200）的城市也全部给；
 * - 没有权限的人带什么参数都是 403；IP 白名单、过期和退出的令牌；选项接口只在 /platform/v1 下有。
 * 数据全部在测试里建出来，测试结束随临时数据库删除（规则 1）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PlatformRole } from "@nozomi/domain";
import { type ApiResponse, type TestApi, createTestApi } from "./testing/api.ts";
import { type Market, addStaff, buildMarket, ok } from "./testing/market.ts";

const CITY = "/platform/v1/city-options";
const VEHICLE_GROUP = "/platform/v1/vehicle-group-options";
const PLACE = "/platform/v1/place-options";
const ADDON = "/platform/v1/addon-options";

/** 写进管理字段的标记：这些值出现在选项接口的响应里就是泄漏。 */
const SECRET_SOURCE_REF = "QA-SOURCE-REF-990177";
const BOUNDARY_LNG = 139.123456;

let api: TestApi;
let m: Market;
const ids: Record<"kix" | "station" | "terminal" | "addonOn" | "addonOff", string> = {} as never;

const platform = (method: "GET" | "POST", path: string, body?: unknown, status?: number): Promise<any> =>
  ok(api.call(method, `/platform/v1${path}`, { token: m.root, ...(body === undefined ? {} : { body }) }), status ?? (method === "POST" ? 201 : 200));

before(async () => {
  api = await createTestApi();
  m = await buildMarket(api);
  ids.kix = (await platform("POST", "/master/places", { type: "airport", code: "KIX", city_id: m.ids.osaka, name: { zh: "关西机场" }, location: { lng: 135.2441, lat: 34.4347 }, flight_scope: "international" })).id;
  ids.station = (await platform("POST", "/master/places", { type: "station", code: "STN-JP-TOKYO", city_id: m.ids.tokyo, name: { zh: "东京站" }, location: { lng: 139.767125, lat: 35.681236 }, category: "shinkansen" })).id;
  ids.terminal = (await platform("POST", "/master/places", { type: "terminal", code: "NRT-T1", parent_id: m.ids.narita, name: { zh: "第一航站楼" }, location: { lng: 140.385, lat: 35.765 } })).id;
  ids.addonOn = (await platform("POST", "/master/addons", { code: "ADD-QA_ON", categories: ["charter"], charge_unit: "per_item", name: { zh: "启用中的附加服务" }, description: { zh: "说明" } })).id;
  ids.addonOff = (await platform("POST", "/master/addons", { code: "ADD-QA_OFF", categories: ["charter"], charge_unit: "per_order", name: { zh: "已停用的附加服务" } })).id;
  await platform("POST", `/master/addons/${ids.addonOff}/disable`, undefined, 200);
  await api.db.owner.query("update cities set source = 'geonames', source_ref = $1, source_synced_at = now(), boundary = $2 where id = $3", [
    SECRET_SOURCE_REF,
    JSON.stringify({ type: "Polygon", coordinates: [[[BOUNDARY_LNG, 35], [139.9, 35], [139.9, 36], [BOUNDARY_LNG, 35]]] }),
    m.ids.tokyo,
  ]);
});
after(async () => {
  await api.close();
});

async function roleWith(grants: string[], cityIds: string[] | null = null, channelIds: string[] | null = null): Promise<PlatformRole> {
  const role = await ok(api.call("POST", "/platform/v1/roles", { token: m.root, body: { name: `QA ${randomUUID().slice(0, 8)}`, grants, data_scope: { city_ids: cityIds, channel_ids: channelIds } } }), 201);
  return role.key as PlatformRole;
}

async function staffWith(grants: string[], cityIds: string[] | null = null, channelIds: string[] | null = null): Promise<{ id: string; token: string }> {
  return addStaff(api, m.root, `${randomUUID().slice(0, 8)}@platform.test`, await roleWith(grants, cityIds, channelIds));
}

const get = (url: string, token: string): Promise<ApiResponse> => api.call("GET", url, { token });
const codes = async (url: string, token: string): Promise<string[]> => (await ok(get(url, token))).items.map((item: any) => item.code);
const placeUrl = (cityId: string, type = "airport,station,poi"): string => `${PLACE}?city_id=${cityId}&type=${type}`;
const keysOf = (item: object): string[] => Object.keys(item).sort();

test("字段：城市写了来源、边界，四个接口每种模式每一项都只有约定的键；响应里找不到管理字段的值", async () => {
  const CITY_KEYS = ["code", "country_code", "id", "name", "timezone"];
  const ADDON_KEYS = ["categories", "charge_unit", "code", "description", "id", "name"];
  const expected: [string, string[]][] = [
    [CITY, CITY_KEYS],
    [`${CITY}?include_disabled=true`, [...CITY_KEYS, "status"].sort()],
    [VEHICLE_GROUP, ["code", "id", "name"]],
    [placeUrl(m.ids.tokyo), ["code", "id", "name", "type"]],
    [ADDON, ADDON_KEYS],
    [`${ADDON}?include_disabled=true`, [...ADDON_KEYS, "status"].sort()],
  ];
  // 普通员工和超级管理员拿到的字段一样：不因为权限大就多给
  for (const token of [(await staffWith(["master_data:view"])).token, m.root]) {
    for (const [url, keys] of expected) {
      const res = await get(url, token);
      assert.equal(res.status, 200, `${url}: ${res.text}`);
      assert.deepEqual(keysOf(res.body), ["items"], `${url}：不分页，没有 next_cursor、total`);
      assert.ok(res.body.items.length > 0, `${url} 不能是空的，否则下面的断言没有意义`);
      for (const item of res.body.items) assert.deepEqual(keysOf(item), keys, `${url} → ${item.code}`);
      for (const leaked of [SECRET_SOURCE_REF, "geonames", String(BOUNDARY_LNG), "boundary", "center", "location", "version", "created_at", "updated_at", "source", "markup"]) {
        assert.ok(!res.text.includes(leaked), `${url} 的响应里不该有 ${leaked}：${res.text}`);
      }
    }
  }
});

test("停用项：城市、车型组、地点、附加服务停用后立即从默认列表消失，重新启用立即回来；停用的城市带 include_disabled 才有，状态对得上", async () => {
  const token = (await staffWith(["master_data:view"])).token;
  const city = await platform("POST", "/master/cities", { country_code: "JP", timezone: "Asia/Tokyo", code: "CTY-JP-QASTOP", name: { zh: "将停用" }, center: { lng: 136.9, lat: 35.18 } });
  const group = await platform("POST", "/master/vehicle-groups", { grade: "luxury", seats: 4, power: "ev", combos: [{ passengers: 3, luggage: 2 }], code: "VG-LUX-4", name: { zh: "豪华 4 座" } });
  const place = await platform("POST", "/master/places", { type: "airport", code: "QST", city_id: city.id, name: { zh: "将停用的机场" }, location: { lng: 136.8, lat: 35.2 }, flight_scope: "mixed" });
  const addon = await platform("POST", "/master/addons", { code: "ADD-QA_TOGGLE", categories: ["charter"], charge_unit: "per_item", name: { zh: "将停用" } });
  const statusOf = async (url: string, id: string): Promise<string | undefined> => (await ok(get(url, token))).items.find((item: any) => item.id === id)?.status;
  const placeList = placeUrl(city.id, "airport");

  assert.ok((await codes(CITY, token)).includes("CTY-JP-QASTOP"));
  assert.ok((await codes(VEHICLE_GROUP, token)).includes("VG-LUX-4"));
  assert.deepEqual(await codes(placeList, token), ["QST"]);
  assert.ok((await codes(ADDON, token)).includes("ADD-QA_TOGGLE"));

  await platform("POST", `/master/places/${place.id}/disable`, undefined, 200);
  assert.deepEqual(await codes(placeList, token), []);
  await platform("POST", `/master/cities/${city.id}/disable`, undefined, 200);
  await platform("POST", `/master/vehicle-groups/${group.id}/disable`, undefined, 200);
  await platform("POST", `/master/addons/${addon.id}/disable`, undefined, 200);
  assert.ok(!(await codes(CITY, token)).includes("CTY-JP-QASTOP"));
  assert.ok(!(await codes(`${CITY}?include_disabled=false`, token)).includes("CTY-JP-QASTOP"));
  assert.equal(await statusOf(`${CITY}?include_disabled=true`, city.id), "disabled");
  assert.ok(!(await codes(VEHICLE_GROUP, token)).includes("VG-LUX-4"));
  assert.ok(!(await codes(ADDON, token)).includes("ADD-QA_TOGGLE"));
  assert.equal(await statusOf(`${ADDON}?include_disabled=true`, addon.id), "disabled");

  await platform("POST", `/master/cities/${city.id}/enable`, undefined, 200);
  await platform("POST", `/master/vehicle-groups/${group.id}/enable`, undefined, 200);
  await platform("POST", `/master/addons/${addon.id}/enable`, undefined, 200);
  await platform("POST", `/master/places/${place.id}/enable`, undefined, 200);
  assert.ok((await codes(CITY, token)).includes("CTY-JP-QASTOP"));
  assert.equal(await statusOf(`${CITY}?include_disabled=true`, city.id), "active");
  assert.ok((await codes(VEHICLE_GROUP, token)).includes("VG-LUX-4"));
  assert.ok((await codes(ADDON, token)).includes("ADD-QA_TOGGLE"));
  assert.deepEqual(await codes(placeList, token), ["QST"]);
});

test("include_disabled 只认 true / false：附加服务和城市一样严格；地点没有这个参数；重复写也是 400", async () => {
  const token = (await staffWith(["master_data:view"])).token;
  const bad = [
    `${ADDON}?include_disabled=1`,
    `${ADDON}?include_disabled=TRUE`,
    `${ADDON}?include_disabled=`,
    `${ADDON}?include_disabled=true&include_disabled=false`,
    `${ADDON}?status=all`,
    `${ADDON}?limit=10`,
    `${CITY}?include_disabled=true&include_disabled=false`,
    `${placeUrl(m.ids.tokyo)}&include_disabled=true`,
  ];
  for (const url of bad) {
    const res = await get(url, token);
    assert.deepEqual([res.status, res.body.error?.code], [400, "VALIDATION_FAILED"], url);
  }
  const active = await codes(`${ADDON}?include_disabled=false`, token);
  assert.ok(active.includes("ADD-QA_ON") && !active.includes("ADD-QA_OFF"));
  const all = await codes(`${ADDON}?include_disabled=true`, token);
  assert.ok(all.includes("ADD-QA_ON") && all.includes("ADD-QA_OFF"));
});

test("数据范围不能靠参数绕过：范围外的 city_id 为空，多带、重复、数组写法的参数 400；同样的地址超级管理员拿得到（确认过滤的是范围）", async () => {
  const tokyoOnly = (await staffWith(["quote_preview:view", "orders:view"], [m.ids.tokyo])).token;
  assert.deepEqual(await codes(placeUrl(m.ids.osaka), m.root), ["KIX"], "对照：超级管理员拿得到大阪的机场");
  assert.deepEqual(await codes(placeUrl(m.ids.osaka), tokyoOnly), []);
  assert.deepEqual(await codes(placeUrl(m.ids.osaka, "airport"), tokyoOnly), []);

  const attempts = [
    `${CITY}?city_id=${m.ids.osaka}`,
    `${CITY}?city_ids=${m.ids.osaka}`,
    `${CITY}?scope=all`,
    `${placeUrl(m.ids.osaka)}&city_ids=${m.ids.osaka}`,
    `${placeUrl(m.ids.osaka)}&scope=all`,
    `${PLACE}?city_id=${m.ids.tokyo}&city_id=${m.ids.osaka}&type=airport`,
    `${PLACE}?city_id[]=${m.ids.osaka}&type=airport`,
    `${PLACE}?city_id=${m.ids.tokyo},${m.ids.osaka}&type=airport`,
    `${PLACE}?city_id=${m.ids.osaka}&type=airport&type=station`,
  ];
  for (const url of attempts) {
    const res = await get(url, tokyoOnly);
    assert.deepEqual([res.status, res.body.error?.code], [400, "VALIDATION_FAILED"], `${url}: ${res.text}`);
    assert.ok(!res.text.includes("KIX"), url);
  }
});

test("数据范围：勾了主数据查看也照样按范围过滤选项；只限定渠道维度时城市不受影响；范围里写大写编号一样认得", async () => {
  const withMaster = (await staffWith(["master_data:view"], [m.ids.tokyo])).token;
  assert.deepEqual(await codes(CITY, withMaster), ["CTY-JP-TYO"]);
  assert.deepEqual(await codes(placeUrl(m.ids.osaka), withMaster), []);

  const channelScoped = (await staffWith(["orders:view", "quote_preview:view"], null, [])).token;
  assert.ok((await codes(CITY, channelScoped)).includes("CTY-JP-OSA"), "只限定了渠道，城市不限");
  assert.deepEqual(await codes(placeUrl(m.ids.osaka), channelScoped), ["KIX"]);

  const upper = (await staffWith(["quote_preview:view"], [m.ids.tokyo.toUpperCase()])).token;
  assert.deepEqual(await codes(CITY, upper), ["CTY-JP-TYO"]);
  assert.deepEqual(await codes(placeUrl(m.ids.tokyo, "airport"), upper), ["NRT"]);
  assert.deepEqual(await codes(placeUrl(m.ids.osaka, "airport"), upper), []);
});

test("航站楼挂在机场下面：机场所在城市在范围里，航站楼也不作为地点选项返回；terminal 类型不能取", async () => {
  const token = (await staffWith(["quote_preview:view"], [m.ids.tokyo])).token;
  const res = await ok(get(placeUrl(m.ids.tokyo), token));
  assert.ok(!res.items.some((item: any) => item.id === ids.terminal), "航站楼不在选项里");
  assert.deepEqual([...new Set(res.items.map((item: any) => item.type))].sort(), ["airport", "station"]);
  assert.equal((await get(placeUrl(m.ids.tokyo, "exit"), token)).status, 400);
});

test("换角色立即生效：员工从东京范围换到大阪范围，同一个令牌的下一个请求就只拿到大阪；换到没有相关权限的角色 403", async () => {
  const staff = await staffWith(["quote_preview:view"], [m.ids.tokyo]);
  assert.deepEqual(await codes(CITY, staff.token), ["CTY-JP-TYO"]);
  await ok(api.call("PATCH", `/platform/v1/staff/${staff.id}`, { token: m.root, body: { role: await roleWith(["quote_preview:view"], [m.ids.osaka]) } }));
  assert.deepEqual(await codes(CITY, staff.token), ["CTY-JP-OSA"]);
  assert.deepEqual(await codes(placeUrl(m.ids.tokyo, "airport"), staff.token), []);
  assert.deepEqual(await codes(placeUrl(m.ids.osaka, "airport"), staff.token), ["KIX"]);

  await ok(api.call("PATCH", `/platform/v1/staff/${staff.id}`, { token: m.root, body: { role: await roleWith(["audit_logs:view"]) } }));
  assert.equal((await get(CITY, staff.token)).status, 403);
  assert.equal((await get(placeUrl(m.ids.osaka, "airport"), staff.token)).status, 403);
});

test("不分页：启用中的城市超过 200 个（主数据列表一页的上限）也全部给，按编码排序", async () => {
  const before = (await codes(CITY, m.root)).length;
  await api.db.owner.query(
    `insert into cities (code, country_code, name, timezone, center_lng, center_lat, status, created_at, updated_at)
     select 'CTY-KR-Q' || lpad(n::text, 4, '0'), 'KR', jsonb_build_object('zh', 'QA 城市 ' || n), 'Asia/Seoul', 127, 37, 'active', now(), now()
       from generate_series(1, 250) as n`,
  );
  try {
    const list = await codes(CITY, m.root);
    assert.equal(list.length, before + 250);
    assert.deepEqual(list, [...list].sort());
  } finally {
    await api.db.owner.query("delete from cities where code like 'CTY-KR-Q%'");
  }
});

test("没有权限的人：带合法、不合法的参数都是 403，不会先告诉他参数不对", async () => {
  const token = (await staffWith(["audit_logs:view"])).token;
  for (const url of [CITY, `${CITY}?include_disabled=true`, `${CITY}?limit=1`, VEHICLE_GROUP, `${VEHICLE_GROUP}?x=1`, placeUrl(m.ids.tokyo), `${PLACE}?city_id=nope`, ADDON, `${ADDON}?include_disabled=1`]) {
    const res = await get(url, token);
    assert.deepEqual([res.status, res.body.error?.code], [403, "FORBIDDEN"], url);
    assert.ok(Array.isArray(res.body.error.details.required_any), url);
    assert.equal(res.body.items, undefined, url);
  }
});

test("IP 白名单：名单外的地址调选项接口被拒，名单内的能调；退出和过期的令牌 401", async () => {
  const OFFICE = "203.0.113.5";
  const OUTSIDE = "198.51.100.7";
  const staff = await staffWith(["quote_preview:view", "master_data:view"]);
  await ok(api.call("PATCH", `/platform/v1/staff/${staff.id}`, { token: m.root, body: { ip_allowlist: [`${OFFICE}/32`] } }));
  for (const url of [CITY, VEHICLE_GROUP, placeUrl(m.ids.tokyo), ADDON]) {
    assert.equal((await api.call("GET", url, { token: staff.token, ip: OFFICE })).status, 200, `${url} 名单内`);
    const outside = await api.call("GET", url, { token: staff.token, ip: OUTSIDE });
    assert.ok(outside.status === 401 || outside.status === 403, `${url} 名单外：${outside.status}`);
    assert.equal(outside.body.items, undefined, url);
  }

  const leaving = (await staffWith(["quote_preview:view"])).token;
  assert.equal((await get(CITY, leaving)).status, 200);
  await api.call("POST", "/platform/v1/auth/logout", { token: leaving });
  assert.equal((await get(CITY, leaving)).status, 401, "退出后的令牌");

  const expiring = (await staffWith(["quote_preview:view"])).token;
  assert.equal((await get(CITY, expiring)).status, 200);
  api.clock.advance(8 * 60 * 60 * 1000 + 1000);
  assert.equal((await get(CITY, expiring)).status, 401, "超过 8 小时的令牌");
});

test("选项接口只在 /platform/v1 下有：/tenant/v1、/sales/v1、/site/v1 下同名路径都拿不到数据", async () => {
  const tokens = [m.a.adminToken, m.root];
  for (const base of ["/tenant/v1", "/sales/v1", "/site/v1"]) {
    for (const path of ["city-options", "vehicle-group-options", `place-options?city_id=${m.ids.tokyo}&type=airport`, "addon-options"]) {
      for (const token of tokens) {
        const res = await get(`${base}/${path}`, token);
        assert.ok(res.status === 401 || res.status === 404, `${base}/${path}: ${res.status}`);
        assert.equal(res.body?.items, undefined, `${base}/${path}`);
      }
    }
  }
});
