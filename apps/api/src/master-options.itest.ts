/**
 * 运营后台下拉框的主数据选项（M4-13，ADR 0046），真实 PostgreSQL：
 * - 城市、车型组、地点、附加服务四个选项接口：各自允许的权限中有任一个即可，一个都没有 403（`details.required_any`）；
 *   自建角色不勾「主数据 · 查看」也能拿到自己页面要的选项；
 * - 默认只列启用中的；城市、附加服务带 `include_disabled=true` 时连已停用的也列（每项带 `status`）；
 * - 数据范围限定了城市的人只拿到范围里的城市、范围里城市的地点；
 * - 只有下拉需要的字段（和 openapi 一致，没有坐标、边界、来源、版本）；
 * - 租户、渠道（/sales/v1 的 API 客户端）、官网（客人的订单链接）的令牌一律 401。
 * 数据全部在测试里经接口建出来，测试结束随临时数据库删除（规则 1）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { PlatformAction, PlatformRole } from "@nozomi/domain";
import { type ApiResponse, type TestApi, createTestApi } from "./testing/api.ts";
import { type Market, addStaff, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { assertMatchesOpenApi, assertMatchesOperation } from "./testing/openapi.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";
import { OPTION_ACTIONS } from "./routes/master-options.ts";

const CITY = "/platform/v1/city-options";
const VEHICLE_GROUP = "/platform/v1/vehicle-group-options";
const PLACE = "/platform/v1/place-options";
const ADDON = "/platform/v1/addon-options";

let api: TestApi;
let m: Market;
let pay: FakePaymentProvider;
let site: SiteApi;
/** 已停用的城市（名古屋）、东京的车站和地标、东京已停用的机场（羽田）、大阪的机场（关西）、已停用的车型组、启用 / 停用的附加服务 */
const ids: Record<"nagoya" | "station" | "poi" | "haneda" | "kix" | "vgOff" | "addonOn" | "addonOff", string> = {} as never;

const platform = (method: "GET" | "POST", path: string, body?: unknown): Promise<any> =>
  ok(api.call(method, `/platform/v1${path}`, { token: m.root, ...(body === undefined ? {} : { body }) }), method === "POST" && !path.endsWith("/disable") ? 201 : 200);

before(async () => {
  pay = new FakePaymentProvider();
  api = await createTestApi({ payments: pay });
  m = await buildMarket(api);
  ids.nagoya = (await platform("POST", "/master/cities", { country_code: "JP", timezone: "Asia/Tokyo", code: "CTY-JP-NGO", name: { zh: "名古屋", ja: "名古屋" }, center: { lng: 136.9, lat: 35.18 } })).id;
  await platform("POST", `/master/cities/${ids.nagoya}/disable`);
  ids.station = (await platform("POST", "/master/places", { type: "station", code: "STN-JP-TOKYO", city_id: m.ids.tokyo, name: { zh: "东京站" }, location: { lng: 139.767125, lat: 35.681236 }, category: "shinkansen" })).id;
  ids.poi = (await platform("POST", "/master/places", { type: "poi", code: "POI-TKYTOWER", city_id: m.ids.tokyo, category: "attraction", name: { zh: "东京塔" }, location: { lng: 139.7454, lat: 35.6586 } })).id;
  ids.haneda = (await platform("POST", "/master/places", { type: "airport", code: "HND", city_id: m.ids.tokyo, name: { zh: "羽田机场" }, location: { lng: 139.7798, lat: 35.5494 }, flight_scope: "mixed" })).id;
  await platform("POST", `/master/places/${ids.haneda}/disable`);
  ids.kix = (await platform("POST", "/master/places", { type: "airport", code: "KIX", city_id: m.ids.osaka, name: { zh: "关西机场" }, location: { lng: 135.2441, lat: 34.4347 }, flight_scope: "international" })).id;
  ids.vgOff = (await platform("POST", "/master/vehicle-groups", { grade: "luxury", seats: 4, power: "ev", combos: [{ passengers: 3, luggage: 2 }], code: "VG-LUX-4", name: { zh: "豪华 4 座" } })).id;
  await platform("POST", `/master/vehicle-groups/${ids.vgOff}/disable`);
  ids.addonOn = (await platform("POST", "/master/addons", { code: "ADD-CHILD_SEAT", categories: ["airport_transfer", "charter"], charge_unit: "per_item", name: { zh: "儿童座椅" }, description: { zh: "适合 1–4 岁" } })).id;
  ids.addonOff = (await platform("POST", "/master/addons", { code: "ADD-WIFI", categories: ["charter"], charge_unit: "per_order", name: { zh: "车载 Wi-Fi" } })).id;
  await platform("POST", `/master/addons/${ids.addonOff}/disable`);
});
after(async () => {
  await site?.close();
  await api.close();
});

const createRole = (name: string, grants: string[], cityIds: string[] | null = null): Promise<any> =>
  ok(api.call("POST", "/platform/v1/roles", { token: m.root, body: { name, grants, data_scope: { city_ids: cityIds, channel_ids: null } } }), 201);

/** 建一个自建角色和用它的员工，返回员工的令牌。 */
async function staffWith(name: string, grants: string[], cityIds: string[] | null = null): Promise<string> {
  const role = await createRole(name, grants, cityIds);
  return (await addStaff(api, m.root, `${randomUUID().slice(0, 8)}@platform.test`, role.key as PlatformRole)).token;
}

const get = (url: string, token: string): Promise<ApiResponse> => api.call("GET", url, { token });
const codes = async (url: string, token: string): Promise<string[]> => (await ok(get(url, token))).items.map((item: any) => item.code);
const placeUrl = (cityId: string, type = "airport,station,poi"): string => `${PLACE}?city_id=${cityId}&type=${type}`;

test("权限：自建角色有允许的任一个操作就能调，一个都没有 403 FORBIDDEN（details.required_any）；不勾主数据查看也拿得到自己页面的选项", async () => {
  const roles: [string, string[]][] = [
    ["渠道编辑", ["channels:view", "channels:edit"]],
    ["渠道只看", ["channels:view"]],
    ["订单查看", ["orders:view"]],
    ["商品查看", ["products:view"]],
    ["报价试算", ["quote_preview:view"]],
    ["主数据查看", ["master_data:view"]],
    ["只看审计", ["audit_logs:view"]],
    ["什么都没有", []],
  ];
  const urls = { [CITY]: CITY, [VEHICLE_GROUP]: VEHICLE_GROUP, [PLACE]: placeUrl(m.ids.tokyo), [ADDON]: ADDON } as Record<keyof typeof OPTION_ACTIONS, string>;
  const seen: Record<string, string[]> = {};
  for (const [name, grants] of roles) {
    const token = await staffWith(name, grants);
    const permissions: PlatformAction[] = (await ok(get("/platform/v1/auth/me", token))).permissions;
    assert.equal(permissions.includes("master_data.read"), name === "主数据查看", name);
    seen[name] = [];
    for (const [path, actions] of Object.entries(OPTION_ACTIONS) as [keyof typeof OPTION_ACTIONS, readonly PlatformAction[]][]) {
      const res = await get(urls[path], token);
      if (actions.some((action) => permissions.includes(action))) {
        assert.equal(res.status, 200, `${name} → ${path}: ${res.text}`);
        seen[name].push(path);
      } else {
        assert.equal(res.status, 403, `${name} → ${path}`);
        assert.deepEqual(res.body.error, { code: "FORBIDDEN", message: "当前角色没有这个操作的权限", details: { required_any: [...actions] } }, `${name} → ${path}`);
        assertMatchesOpenApi("GET", path, res);
      }
    }
  }
  // 按用途：渠道编辑选城市和车型组；订单只选城市；商品选城市、看附加服务；报价试算选城市、车型组、机场车站；主数据查看全部；其余都不行
  assert.deepEqual(seen, {
    渠道编辑: [CITY, VEHICLE_GROUP],
    渠道只看: [],
    订单查看: [CITY],
    商品查看: [CITY, ADDON],
    报价试算: [CITY, VEHICLE_GROUP, PLACE],
    主数据查看: [CITY, VEHICLE_GROUP, PLACE, ADDON],
    只看审计: [],
    什么都没有: [],
  });
  // role.manage 只归超级管理员（自建角色勾不了）：超级管理员选得到城市（角色页的数据范围）
  assert.equal((await get(CITY, m.root)).status, 200);
});

test("城市选项：默认只有启用中的；include_disabled=true 连已停用的也有、每项带 status；只有下拉需要的字段，和 openapi 一致", async () => {
  const token = await staffWith("订单专员甲", ["orders:view"]);
  const active = await ok(get(CITY, token));
  assertMatchesOperation("GET", CITY, 200, active);
  assert.deepEqual(active.items.map((city: any) => city.code), ["CTY-JP-OSA", "CTY-JP-TYO"]);
  assert.deepEqual(active.items[1], { id: m.ids.tokyo, code: "CTY-JP-TYO", name: { zh: "东京" }, country_code: "JP", timezone: "Asia/Tokyo" });
  assert.deepEqual(Object.keys(active), ["items"], "不分页：没有 next_cursor、total");

  const all = await ok(get(`${CITY}?include_disabled=true`, token));
  assertMatchesOperation("GET", CITY, 200, all);
  assert.deepEqual(all.items.map((city: any) => [city.code, city.status]), [["CTY-JP-NGO", "disabled"], ["CTY-JP-OSA", "active"], ["CTY-JP-TYO", "active"]]);
  assert.deepEqual(Object.keys(all.items[0]).sort(), ["code", "country_code", "id", "name", "status", "timezone"]);
  assert.deepEqual(all.items[0].name, { zh: "名古屋", ja: "名古屋" });
  assert.deepEqual((await ok(get(`${CITY}?include_disabled=false`, token))).items, active.items);

  for (const bad of ["include_disabled=1", "include_disabled=yes", "status=all", "limit=10"]) {
    const res = await get(`${CITY}?${bad}`, token);
    assert.deepEqual([res.status, res.body.error.code], [400, "VALIDATION_FAILED"], bad);
  }
});

test("数据范围：限定了城市的人只拿到范围里的城市（停用的也只在带 include_disabled 时出现）、范围里城市的地点；范围外的城市得到空的地点列表", async () => {
  const tokyoOnly = await staffWith("东京报价员", ["quote_preview:view", "orders:view"], [m.ids.tokyo]);
  assert.deepEqual(await codes(CITY, tokyoOnly), ["CTY-JP-TYO"]);
  assert.deepEqual(await codes(`${CITY}?include_disabled=true`, tokyoOnly), ["CTY-JP-TYO"]);
  assert.deepEqual(await codes(placeUrl(m.ids.tokyo), tokyoOnly), ["NRT", "POI-TKYTOWER", "STN-JP-TOKYO"]);
  assert.deepEqual(await codes(placeUrl(m.ids.osaka), tokyoOnly), [], "大阪不在范围里");
  assert.deepEqual(await codes(placeUrl(m.ids.osaka.toUpperCase()), tokyoOnly), [], "编号写成大写也一样");

  const nagoyaAndOsaka = await staffWith("名古屋大阪订单", ["orders:view"], [ids.nagoya, m.ids.osaka]);
  assert.deepEqual(await codes(CITY, nagoyaAndOsaka), ["CTY-JP-OSA"]);
  assert.deepEqual(await codes(`${CITY}?include_disabled=true`, nagoyaAndOsaka), ["CTY-JP-NGO", "CTY-JP-OSA"]);

  const nowhere = await staffWith("空范围", ["quote_preview:view"], []);
  assert.deepEqual(await codes(CITY, nowhere), []);
  assert.deepEqual(await codes(placeUrl(m.ids.tokyo), nowhere), []);
  // 车型组没有城市之分：限定了城市照样全部
  assert.deepEqual(await codes(VEHICLE_GROUP, nowhere), ["VG-BIZ-7", "VG-ECO-4"]);
});

test("地点选项：按城市和类型、只有启用中的、按编码排序；字段只有编号、编码、类型、名称；城市和类型必填", async () => {
  const token = await staffWith("报价员", ["quote_preview:view"]);
  const both = await ok(get(placeUrl(m.ids.tokyo, "airport,station"), token));
  assertMatchesOperation("GET", PLACE, 200, both);
  assert.deepEqual(both.items, [
    { id: m.ids.narita, code: "NRT", type: "airport", name: { zh: "成田机场" } },
    { id: ids.station, code: "STN-JP-TOKYO", type: "station", name: { zh: "东京站" } },
  ], "羽田已停用，不在里面；地标没要");
  assert.deepEqual(await codes(placeUrl(m.ids.tokyo, "poi"), token), ["POI-TKYTOWER"]);
  assert.deepEqual(await codes(placeUrl(m.ids.tokyo, "airport,airport"), token), ["NRT"]);
  assert.deepEqual(await codes(placeUrl(m.ids.osaka, "airport"), token), ["KIX"]);
  assert.deepEqual(await codes(placeUrl(randomUUID(), "airport"), token), [], "不存在的城市");

  for (const bad of [`${PLACE}?type=airport`, `${PLACE}?city_id=${m.ids.tokyo}`, `${PLACE}?city_id=nope&type=airport`, placeUrl(m.ids.tokyo, "terminal"), placeUrl(m.ids.tokyo, "airport,"), `${placeUrl(m.ids.tokyo)}&status=all`]) {
    const res = await get(bad, token);
    assert.deepEqual([res.status, res.body.error.code], [400, "VALIDATION_FAILED"], bad);
    assertMatchesOperation("GET", PLACE, 400, res.body);
  }
});

test("车型组、附加服务选项：只有启用中的（附加服务可带 include_disabled）；字段只有下拉和商品查看要的", async () => {
  const quoter = await staffWith("报价员乙", ["quote_preview:view"]);
  const groups = await ok(get(VEHICLE_GROUP, quoter));
  assertMatchesOperation("GET", VEHICLE_GROUP, 200, groups);
  assert.deepEqual(groups.items, [
    { id: m.ids.biz7, code: "VG-BIZ-7", name: { zh: "商务 7 座" } },
    { id: m.ids.eco4, code: "VG-ECO-4", name: { zh: "经济 4 座" } },
  ]);
  assert.equal((await get(`${VEHICLE_GROUP}?include_disabled=true`, quoter)).status, 400, "车型组没有 include_disabled");

  const viewer = await staffWith("商品查看员", ["products:view"]);
  const addons = await ok(get(ADDON, viewer));
  assertMatchesOperation("GET", ADDON, 200, addons);
  assert.deepEqual(addons.items, [{ id: ids.addonOn, code: "ADD-CHILD_SEAT", name: { zh: "儿童座椅" }, description: { zh: "适合 1–4 岁" }, categories: ["airport_transfer", "charter"], charge_unit: "per_item" }]);
  const all = await ok(get(`${ADDON}?include_disabled=true`, viewer));
  assertMatchesOperation("GET", ADDON, 200, all);
  assert.deepEqual(all.items.map((addon: any) => [addon.code, addon.status]), [["ADD-CHILD_SEAT", "active"], ["ADD-WIFI", "disabled"]]);
  assert.deepEqual(all.items[1].description, {});
});

test("租户、渠道（销售端 API 客户端）、官网（客人的订单链接）的令牌拿不到任何选项：401", async () => {
  const channelId = (await newChannel(api, m.staff.cm1.token, { name: "选项测试渠道" })).id;
  const sales = await salesCredentials(api, m, channelId);
  site = await siteApi(api, sales.clientId, pay);
  api.clock.advance(1_000);
  const quoted = await site.call("POST", "/site/v1/quotes", { body: { city_id: m.ids.tokyo, airport_id: m.ids.narita, direction: "pickup", address: { lng: 139.7, lat: 35.6 }, service_local: "2026-10-20T10:00", passengers: 2, luggage: 1 } });
  assert.equal(quoted.status, 200, quoted.text);
  api.clock.advance(1_000);
  const placed = await site.call("POST", "/site/v1/orders", {
    headers: { "idempotency-key": randomUUID() },
    body: { quote_id: quoted.body.quotes[0].quote_id, passenger: { name: "王小明", phone: "+81 90-1234-5678", email: "guest@example.com" }, flight_no: "NH211", dropoff_address: "东京站", save_payment_method: true },
  });
  assert.equal(placed.status, 201, placed.text);
  const tokens = { 租户: m.a.adminToken, 渠道: sales.token, 官网: placed.body.link.token as string };
  for (const url of [CITY, `${CITY}?include_disabled=true`, VEHICLE_GROUP, placeUrl(m.ids.tokyo), ADDON]) {
    for (const [who, token] of Object.entries(tokens)) {
      const res = await get(url, token);
      assert.deepEqual([res.status, res.body.error.code], [401, "UNAUTHENTICATED"], `${who} → ${url}`);
    }
    assert.equal((await api.call("GET", url)).status, 401, `没带令牌 → ${url}`);
  }
});
