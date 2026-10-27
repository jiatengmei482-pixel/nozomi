/**
 * M3-12：官网的地址搜索和坐标反查（ADR 0044），经真实接口、真实 PostgreSQL；谷歌是本机的假服务器（testing/fake-integrations.ts），**从不调用真实的谷歌**。
 *
 * 覆盖：成功（请求的样子：密钥只在请求头、字段掩码、城市范围、关键字规范化、反查坐标取整）、短时缓存（命中、过期）、并发同一个键只调一次、
 * 各种失败降级（429、超时、5xx、看不懂、请求无效）都是 200 + `available: false` 不是 500、冷却与换密钥、每日上限（和路线分开计）、没配置、
 * 按来源地址限速（每分钟、每天）、输入校验、城市不在渠道授权里、密钥不外泄（应答、日志、计数表按值比对）、供应商和渠道没有这组接口、
 * 官网的配置和城市列表多出的字段；报价按坐标判断服务区（服务区外的坐标报 OUT_OF_SERVICE_AREA）。
 * 测试数据全在本文件里经接口建出来，随测试 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { cityBounds, routeUsageDay } from "@nozomi/domain";
import { type TestApi, createTestApi } from "./testing/api.ts";
import { type FakeService, googleErrorBody, googleGeocodeBody, googlePlace, googlePlacesBody, startFakeGoogleGeocode, startFakeGooglePlaces } from "./testing/fake-integrations.ts";
import { FAKE_SECRETS } from "./testing/fixtures.ts";
import { type Market, allValues, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

let api: TestApi;
let m: Market;
let places: FakeService;
let geocode: FakeService;
let site: SiteApi;
let siteClientId: string;
let salesToken: string;
let logs = "";
const opened: SiteApi[] = [];
const TOKYO_CENTER = { lng: 139.6917, lat: 35.6895 };
/** 东京城市范围里、但不在任何供应商营运区（139–140, 35–36）里的点 */
const OUTSIDE_AREA = { lng: 138.95, lat: 35.62 };
const adminKeys: string[] = [];

let ipSeq = 0;
const nextIp = (): string => `10.88.${Math.floor(++ipSeq / 200)}.${ipSeq % 200}`;
const googleEnv = (): Record<string, string> => ({ GOOGLE_PLACES_SEARCH_URL: places.url, GOOGLE_GEOCODE_URL: geocode.url });
const openSite = async (env: Record<string, string> = {}, deps: Parameters<typeof siteApi>[4] = {}): Promise<SiteApi> => {
  const app = await siteApi(api, siteClientId, new FakePaymentProvider(), { ...googleEnv(), ...env }, { integrationSecretsTtlMs: 0, ...deps });
  opened.push(app);
  return app;
};
const searchUrl = (q: string, cityId = m.ids.tokyo): string => `/site/v1/places/search?city_id=${cityId}&q=${encodeURIComponent(q)}`;
const reverseUrl = (point: { lat: number; lng: number }, cityId = m.ids.tokyo): string => `/site/v1/places/reverse?city_id=${cityId}&lat=${point.lat}&lng=${point.lng}`;
const search = (q: string, app: SiteApi = site, ip = nextIp()) => app.call("GET", searchUrl(q), { ip });
const reverse = (point: { lat: number; lng: number }, app: SiteApi = site, ip = nextIp()) => app.call("GET", reverseUrl(point), { ip });
/** 每个测试用不同的关键字 / 坐标，互不命中对方的缓存 */
let seq = 0;
const freshQuery = (): string => `酒店 ${++seq}`;
const freshPoint = (): { lat: number; lng: number } => ({ lat: 35.6, lng: Number((139.5 + ++seq * 0.001).toFixed(4)) });
const reset = (): void => {
  places.requests.length = 0;
  geocode.requests.length = 0;
  places.respond({ body: googlePlacesBody([googlePlace("ChIJfakeTokyoStation", "東京駅", 35.6812, 139.7671, "日本、〒100-0005 東京都千代田区丸の内１丁目")]) });
  geocode.respond({ body: googleGeocodeBody("日本、〒100-0005 東京都千代田区丸の内１丁目９") });
};
const newAdminKey = async (): Promise<string> => {
  const key = `AIzaPlaceTest${randomUUID().replaceAll("-", "")}`;
  adminKeys.push(key);
  await ok(api.call("PUT", "/platform/v1/integration-secrets/google-maps", { token: m.root, body: { api_key: key } }));
  return key;
};
const allKeys = (): string[] => [FAKE_SECRETS.googleMapsApiKey, ...adminKeys];
const usage = async (): Promise<{ calls: number; failures: number; refused: number; last_failure_code: string | null }> =>
  (await api.db.owner.query("select calls, failures, refused, last_failure_code from place_api_usage where day = $1", [routeUsageDay(api.clock.now())])).rows[0] ?? { calls: 0, failures: 0, refused: 0, last_failure_code: null };

before(async () => {
  places = await startFakeGooglePlaces();
  geocode = await startFakeGoogleGeocode();
  api = await createTestApi({ payments: new FakePaymentProvider(), integrationSecretsTtlMs: 0 });
  m = await buildMarket(api);
  const channel = await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" });
  siteClientId = (await salesCredentials(api, m, channel.id)).clientId;
  salesToken = (await salesCredentials(api, m, (await newChannel(api, m.staff.cm1.token, { name: "OTA" })).id)).token;
  site = await siteApi(api, siteClientId, new FakePaymentProvider(), googleEnv(), { integrationSecretsTtlMs: 0, logDestination: { write: (line) => void (logs += line) } });
  reset();
});
after(async () => {
  for (const app of [site, ...opened]) await app.close();
  await api.close();
  await places.close();
  await geocode.close();
});

test("官网配置多了「有没有地址搜索」和底图；城市带中心坐标（地图打开时的位置）", async () => {
  const config = await site.call("GET", "/site/v1/config");
  assertMatchesOpenApi("GET", "/site/v1/config", config);
  assert.equal(config.body.address_search, true);
  assert.equal(config.body.map_tiles, null);
  const withTiles = await openSite({ MAP_TILE_URL_TEMPLATE: "https://tiles.example.com/{z}/{x}/{y}.png", MAP_TILE_ATTRIBUTION: "© OSM|https://www.openstreetmap.org/copyright" });
  const tiles = await withTiles.call("GET", "/site/v1/config");
  assertMatchesOpenApi("GET", "/site/v1/config", tiles);
  assert.equal(tiles.body.map_tiles.url_template, "https://tiles.example.com/{z}/{x}/{y}.png");
  assert.deepEqual(tiles.body.map_tiles.attribution, [{ text: "© OSM", href: "https://www.openstreetmap.org/copyright" }]);
  const cities = await site.call("GET", "/site/v1/cities");
  assertMatchesOpenApi("GET", "/site/v1/cities", cities);
  assert.deepEqual(cities.body.items.find((city: any) => city.id === m.ids.tokyo).center, { lat: TOKYO_CENTER.lat, lng: TOKYO_CENTER.lng });
});

test("搜索成功：后端调一次谷歌（密钥只在请求头、只要四个字段、只要城市附近、关键字规范化），给候选的名称、地址、坐标", async () => {
  reset();
  places.respond({ body: googlePlacesBody([googlePlace("ChIJa", "東京駅", 35.6812, 139.7671, "日本東京都千代田区丸の内1丁目"), googlePlace("ChIJosaka", "大阪", 34.69, 135.5, "大阪")]) });
  const res = await search("  東京駅　ホテル ");
  assertMatchesOpenApi("GET", "/site/v1/places/search", res);
  assert.deepEqual(res.body, { available: true, items: [{ id: "ChIJa", name: "東京駅", address: "日本東京都千代田区丸の内1丁目", location: { lat: 35.6812, lng: 139.7671 } }] });
  assert.equal(places.requests.length, 1);
  const [request] = places.requests as [FakeService["requests"][number]];
  assert.equal(request.headers["x-goog-api-key"], FAKE_SECRETS.googleMapsApiKey);
  assert.equal(request.headers["x-goog-fieldmask"], "places.id,places.displayName,places.formattedAddress,places.location");
  assert.ok(!request.path.includes("AIza") && !request.body.includes("AIza"));
  const bounds = cityBounds(TOKYO_CENTER);
  assert.deepEqual(JSON.parse(request.body), {
    textQuery: "東京駅 ホテル",
    languageCode: "zh-CN",
    regionCode: "JP",
    pageSize: 5,
    locationRestriction: { rectangle: { low: { latitude: bounds.low.lat, longitude: bounds.low.lng }, high: { latitude: bounds.high.lat, longitude: bounds.high.lng } } },
  });
  assert.ok(!allValues(res.body).has(FAKE_SECRETS.googleMapsApiKey));
});

test("反查成功：坐标取整到 4 位再问谷歌，给地址文字；这里没有地址时 address 为 null", async () => {
  reset();
  const res = await reverse({ lat: 35.681249, lng: 139.767149 });
  assertMatchesOpenApi("GET", "/site/v1/places/reverse", res);
  assert.deepEqual(res.body, { available: true, address: "日本、〒100-0005 東京都千代田区丸の内１丁目９" });
  const [request] = geocode.requests as [FakeService["requests"][number]];
  assert.equal(request.path, "/v4beta/geocode/location/35.6812,139.7671?languageCode=zh-CN&regionCode=JP");
  assert.equal(request.headers["x-goog-api-key"], FAKE_SECRETS.googleMapsApiKey);
  assert.equal(request.headers["x-goog-fieldmask"], "results.formattedAddress");
  geocode.respond({ body: googleGeocodeBody(null) });
  const nothing = await reverse(freshPoint());
  assertMatchesOpenApi("GET", "/site/v1/places/reverse", nothing);
  assert.deepEqual(nothing.body, { available: true, address: null });
});

test("短时缓存：同一城市同一关键字（大小写、全角半角不同）不再调谷歌；同一个 11 米格子里的点共用一次反查；过期后再问调一次", async () => {
  reset();
  const query = `Hilton ${++seq}`;
  await ok(search(query));
  await ok(search(`ＨＩＬＴＯＮ　${seq}`));
  assert.equal(places.requests.length, 1);
  const point = freshPoint();
  await ok(reverse(point));
  await ok(reverse({ lat: point.lat + 0.00003, lng: point.lng - 0.00003 }));
  assert.equal(geocode.requests.length, 1);
  // 别的城市同一个关键字不共用（大阪也在官网的城市里）
  const short = await openSite({}, { placeCacheTtlMs: 150 });
  reset();
  const q = freshQuery();
  await ok(search(q, short));
  await ok(search(q, short));
  assert.equal(places.requests.length, 1);
  await new Promise((resolve) => setTimeout(resolve, 200));
  await ok(search(q, short));
  assert.equal(places.requests.length, 2);
});

test("并发：同一个关键字同时来十次，只调一次谷歌，十次拿到同样的结果", async () => {
  reset();
  places.respond({ body: googlePlacesBody([googlePlace("ChIJc", "新宿駅", 35.69, 139.7, "新宿")]), delayMs: 300 });
  const q = freshQuery();
  const all = await Promise.all(Array.from({ length: 10 }, () => search(q)));
  assert.equal(places.requests.length, 1);
  for (const res of all) assert.deepEqual([res.status, res.body.items[0].id], [200, "ChIJc"]);
});

test("降级：谷歌 429 → 200 + available false（不是 500），不重试；同一把密钥冷却期内不再问；运营后台换了密钥立即用新的", async () => {
  await newAdminKey();
  reset();
  places.respond({ status: 429, body: googleErrorBody(429, "RESOURCE_EXHAUSTED", "RATE_LIMIT_EXCEEDED") });
  const res = await search(freshQuery());
  assertMatchesOpenApi("GET", "/site/v1/places/search", res);
  assert.deepEqual([res.status, res.body], [200, { available: false, items: [] }]);
  assert.equal(places.requests.length, 1);
  assert.equal((await usage()).last_failure_code, "QUOTA_EXCEEDED");
  // 冷却：搜索和反查同一把密钥，都不再问
  const cooled = await search(freshQuery());
  const cooledReverse = await reverse(freshPoint());
  assert.deepEqual([cooled.body.available, cooledReverse.body, places.requests.length, geocode.requests.length], [false, { available: false, address: null }, 1, 0]);
  const fresh = await newAdminKey();
  reset();
  const again = await search(freshQuery());
  assert.equal(again.body.available, true);
  assert.equal(places.requests[0]?.headers["x-goog-api-key"], fresh);
});

test("降级：超时在时限内返回（不是 500）；5xx 重试一次后放弃；看不懂的应答、请求无效都是 available false", async () => {
  for (const [reply, code, tries] of [
    [{ body: {}, delayMs: 5_000 }, "TIMEOUT", [1, 2]],
    [{ status: 503, body: {} }, "UNAVAILABLE", [2, 2]],
    [{ body: "not json" }, "UNEXPECTED", [1, 1]],
    [{ status: 400, body: googleErrorBody(400, "INVALID_ARGUMENT", null) }, "INVALID_REQUEST", [1, 1]],
  ] as const) {
    await newAdminKey();
    reset();
    places.respond(reply);
    const started = performance.now();
    const res = await search(freshQuery());
    assert.ok(performance.now() - started < 3_600, `${code} 用了 ${performance.now() - started} 毫秒`);
    assert.deepEqual([res.status, res.body.available], [200, false], code);
    assert.ok(places.requests.length >= tries[0] && places.requests.length <= tries[1], `${code} 试了 ${places.requests.length} 次`);
    assert.equal((await usage()).last_failure_code, code);
  }
  await newAdminKey();
  reset();
  geocode.respond({ status: 500, body: {} });
  const res = await reverse(freshPoint());
  assert.deepEqual([res.status, res.body], [200, { available: false, address: null }]);
});

test("每日上限：到了上限不再调谷歌（available false，记「被挡下」），和路线预估的计数分开；上限 0 时页面不显示搜索", async () => {
  await newAdminKey();
  reset();
  const before = await usage();
  const routesBefore = (await api.db.owner.query("select coalesce(sum(calls), 0)::int as calls from route_api_usage")).rows[0].calls;
  const limited = await openSite({ GOOGLE_PLACES_DAILY_LIMIT: String(before.calls + 1) });
  assert.equal((await search(freshQuery(), limited)).body.available, true);
  const refused = await search(freshQuery(), limited);
  assert.deepEqual([refused.status, refused.body.available, places.requests.length], [200, false, 1]);
  const after = await usage();
  assert.deepEqual([after.calls, after.refused], [before.calls + 1, before.refused + 1]);
  assert.equal((await api.db.owner.query("select coalesce(sum(calls), 0)::int as calls from route_api_usage")).rows[0].calls, routesBefore);

  const off = await openSite({ GOOGLE_PLACES_DAILY_LIMIT: "0" });
  assert.equal((await ok(off.call("GET", "/site/v1/config"))).address_search, false);
  const none = await search(freshQuery(), off);
  assert.deepEqual([none.body.available, places.requests.length], [false, 1]);
});

test("没配置谷歌密钥：页面不显示搜索；接口照样 200 + available false，不调用", async () => {
  await ok(api.call("DELETE", "/platform/v1/integration-secrets/google-maps", { token: m.root }));
  const bare = await openSite({ GOOGLE_MAPS_API_KEY: "" });
  reset();
  assert.equal((await ok(bare.call("GET", "/site/v1/config"))).address_search, false);
  assert.deepEqual((await search(freshQuery(), bare)).body, { available: false, items: [] });
  assert.deepEqual((await reverse(freshPoint(), bare)).body, { available: false, address: null });
  assert.deepEqual([places.requests.length, geocode.requests.length], [0, 0]);
  await newAdminKey();
});

test("限速（按来源地址）：每分钟 20 次，第 21 次 429 + Retry-After；换个地址不受影响；每天 300 次", async () => {
  reset();
  const ip = "203.0.113.77";
  const q = freshQuery();
  for (let i = 0; i < 20; i++) assert.equal((await search(q, site, ip)).status, 200);
  const limited = await search(q, site, ip);
  assertMatchesOpenApi("GET", "/site/v1/places/search", limited);
  assert.equal(limited.status, 429);
  assert.equal(limited.body.error.code, "RATE_LIMITED");
  assert.ok(Number(limited.headers["retry-after"]) > 0);
  assert.equal((await reverse(freshPoint(), site, ip)).status, 429, "反查和搜索共用额度");
  assert.equal((await search(q, site, "203.0.113.78")).status, 200);
  // 每天：一分钟一分钟地用满 300 次（缓存命中，不花钱），第 301 次即使过了一分钟也挡
  const daily = "203.0.113.79";
  for (let used = 0; used < 300; used++) {
    if (used % 20 === 0) api.clock.advance(61_000);
    assert.equal((await search(q, site, daily)).status, 200, `第 ${used + 1} 次`);
  }
  api.clock.advance(61_000);
  assert.equal((await search(q, site, daily)).status, 429);
  assert.equal(places.requests.length, 1);
});

test("输入校验：关键字太短、太长，城市不存在、不在官网渠道的授权里，坐标离城市太远、不合法，多余的参数——400，不调用谷歌", async () => {
  reset();
  const bad = async (url: string, reason: string | null): Promise<void> => {
    const res = await site.call("GET", url, { ip: nextIp() });
    assertMatchesOpenApi("GET", url.startsWith("/site/v1/places/search") ? "/site/v1/places/search" : "/site/v1/places/reverse", res);
    assert.equal(res.status, 400, url);
    if (reason !== null) assert.ok(res.body.error.details.issues.some((issue: any) => issue.reason === reason), `${url} ${res.text}`);
  };
  await bad(searchUrl(" 站 "), "TOO_SHORT");
  await bad(searchUrl("x".repeat(101)), "TOO_LONG");
  await bad(searchUrl("东京站", randomUUID()), "UNKNOWN_CITY");
  await bad(`/site/v1/places/search?city_id=${m.ids.tokyo}`, null);
  await bad(`${searchUrl("东京站")}&tenant_id=${randomUUID()}`, null);
  await bad(reverseUrl({ lat: 34.69, lng: 135.5 }), "OUT_OF_CITY");
  await bad(reverseUrl({ lat: 95, lng: 139 }), null);
  await bad(`/site/v1/places/reverse?city_id=${m.ids.tokyo}&lat=abc&lng=139`, null);
  const osakaOnly = await newChannel(api, m.staff.cm1.token, { name: "只卖大阪的官网", scope: { city_ids: [m.ids.osaka] } });
  const osakaSite = await siteApi(api, (await salesCredentials(api, m, osakaOnly.id)).clientId, null, googleEnv());
  opened.push(osakaSite);
  const outside = await osakaSite.call("GET", searchUrl("东京站"), { ip: nextIp() });
  assert.deepEqual([outside.status, outside.body.error.details.issues[0].reason], [400, "UNKNOWN_CITY"]);
  assert.deepEqual([places.requests.length, geocode.requests.length], [0, 0]);
});

test("官网没开：503 SITE_NOT_OPEN，不调用；供应商和渠道没有这组接口（404），也不能借官网的接口拿到别的东西", async () => {
  reset();
  const closed = await siteApi(api, null, null, googleEnv());
  opened.push(closed);
  const res = await closed.call("GET", searchUrl("东京站"), { ip: nextIp() });
  assertMatchesOpenApi("GET", "/site/v1/places/search", res);
  assert.deepEqual([res.status, res.body.error.code], [503, "SITE_NOT_OPEN"]);
  assert.equal((await closed.call("GET", "/site/v1/config")).body.address_search, false);
  for (const path of ["/tenant/v1/places/search", "/tenant/v1/places/reverse", "/sales/v1/places/search", "/sales/v1/places/reverse"]) {
    const token = path.startsWith("/tenant") ? m.a.adminToken : salesToken;
    assert.equal((await api.call("GET", `${path}?city_id=${m.ids.tokyo}&q=东京站`, { token })).status, 404, path);
  }
  // 带着供应商的令牌调官网接口：令牌不起作用，结果和不带一样（官网接口不认登录）
  const withToken = await site.call("GET", searchUrl(freshQuery()), { ip: nextIp(), token: m.a.adminToken });
  assert.deepEqual([withToken.status, withToken.body.available], [200, true]);
  assert.equal(places.requests.length, 1);
});

test("报价按坐标判断服务区：选出的地址带坐标询价；服务区外的坐标报 OUT_OF_SERVICE_AREA（不看地址文字，询价请求里也没有地址文字这一项）", async () => {
  const ask = (address: { lng: number; lat: number }, extra: Record<string, unknown> = {}) =>
    site.call("POST", "/site/v1/quotes", { ip: nextIp(), body: { city_id: m.ids.tokyo, airport_id: m.ids.narita, direction: "pickup", address, service_local: "2026-10-20T10:00", passengers: 2, luggage: 1, ...extra } });
  const inside = await ok(ask({ lng: 139.7671, lat: 35.6812 }));
  assert.ok(inside.quotes.length > 0);
  const outside = await ok(ask(OUTSIDE_AREA));
  assert.equal(outside.quotes.length, 0);
  assert.ok(outside.unavailable.some((entry: any) => entry.reasons.includes("OUT_OF_SERVICE_AREA")), JSON.stringify(outside));
  assert.equal((await ask({ lng: 139.7671, lat: 35.6812 }, { address_text: "東京駅" })).status, 400);
});

test("密钥不外泄：所有应答、日志、计数表里都没有任何一把谷歌密钥的原文（按值比对）", async () => {
  reset();
  const responses = [await search(freshQuery()), await reverse(freshPoint()), await site.call("GET", "/site/v1/config")];
  places.respond({ status: 403, body: googleErrorBody(403, "PERMISSION_DENIED", "API_KEY_SERVICE_BLOCKED") });
  await newAdminKey();
  responses.push(await search(freshQuery()));
  for (const res of responses) {
    const values = allValues(res.body);
    for (const key of allKeys()) {
      assert.ok(!values.has(key), "应答里有密钥");
      assert.ok(!res.text.includes(key), "应答原文里有密钥");
    }
  }
  const rows = (await api.db.owner.query("select * from place_api_usage")).rows;
  const stored = allValues(rows);
  for (const key of allKeys()) {
    assert.ok(!stored.has(key) && !JSON.stringify(rows).includes(key), "计数表里有密钥");
    assert.ok(!logs.includes(key), "日志里有密钥");
  }
  assert.match(logs, /"placeFailure":"KEY_RESTRICTED"/);
});
