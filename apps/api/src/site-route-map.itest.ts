/**
 * M8-10：官网路线小地图 `GET /site/v1/route-map`（谷歌静态地图，ADR 0072），经真实接口、真实 PostgreSQL；
 * 谷歌（Routes、Maps Static API）全是本机的假服务器（testing/fake-integrations.ts），**从不调用真实的谷歌**。
 *
 * 覆盖：
 * - 出图：请求的样子（尺寸、倍率、灰色调样式、品牌色路线 enc 折线、起终点标记、密钥只在发给谷歌的网址里）、应答（图片、`Cache-Control: private, max-age=86400`）；
 * - 缓存：同一条路线 × 主题 × 尺寸 × 倍率 1 天内不再调谷歌（库里一行），换主题 / 尺寸 / 倍率另出一张；过期后重新调用并覆盖、顺手删过期的；并发同一张只调一次；
 * - 路线：和按两个坐标报价同一份（取过的不再调 Routes）；没有就调 Routes（计入路线的每日上限）；只出图，不改报价、不写询价日志；
 * - 降级：没配密钥、谷歌说没开通 / 密钥限制 → `NOT_ENABLED`；每日上限（含并发不超、上限 0）、冷却、谷歌出错、取不到路线、同一个点、图太大、不是图片、跳转、官网没开 → `UNAVAILABLE`；
 * - 限频：每个地址每分钟 30 次；输入校验 400；
 * - 系统状态：`static_maps` 的用量和最近一次失败的原因码；
 * - 密钥不外泄：应答、日志、两张新表里都没有密钥原文（谷歌的错误应答回显了密钥也一样）。
 * 测试数据全在本文件里经接口建出来，随测试 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { routeUsageDay, staticMapStyles } from "@nozomi/domain";
import { type TestApi, createTestApi } from "./testing/api.ts";
import { FAKE_STATIC_MAP_PNG, type FakeService, googleRouteBody, startFakeGoogleRoutes, startFakeGoogleStaticMaps } from "./testing/fake-integrations.ts";
import { FAKE_SECRETS } from "./testing/fixtures.ts";
import { type Market, allValues, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

let api: TestApi;
let m: Market;
let routes: FakeService;
let maps: FakeService;
let site: SiteApi;
let siteClientId: string;
let logs = "";
const opened: SiteApi[] = [];

const POLYLINE = "_p~iF~ps|U_ulLnnqC_mqNvxq`@";
const NARITA = { lat: 35.7686, lng: 140.3887 };
const TOKYO_STATION = { lat: 35.6812, lng: 139.7671 };
const SERVICE_LOCAL = "2026-10-20T10:00";
const KEY = FAKE_SECRETS.googleMapsApiKey;

let ipSeq = 0;
const nextIp = (): string => `10.77.${Math.floor(++ipSeq / 200)}.${ipSeq % 200}`;
/** 每个用例用自己的一对坐标（库里的图缓存是共用的） */
let pairSeq = 0;
const nextPair = (): { from: { lat: number; lng: number }; to: { lat: number; lng: number } } => {
  pairSeq++;
  return { from: { lat: 35.6 + pairSeq * 0.01, lng: 139.6 }, to: { lat: 35.6 + pairSeq * 0.01, lng: 139.8 } };
};

const googleEnv = (): Record<string, string> => ({ GOOGLE_MAPS_ROUTES_URL: routes.url, GOOGLE_STATIC_MAPS_URL: maps.url });
const openSite = async (env: Record<string, string> = {}, clientId: string | null = siteClientId): Promise<SiteApi> => {
  const app = await siteApi(api, clientId, new FakePaymentProvider(), { ...googleEnv(), ...env }, { integrationSecretsTtlMs: 0, logDestination: { write: (line) => void (logs += line) } });
  opened.push(app);
  return app;
};
const reset = (): void => {
  routes.requests.length = 0;
  maps.requests.length = 0;
  routes.respond({ body: googleRouteBody(25_400, 3_570, POLYLINE) });
  maps.respond({ body: null, raw: FAKE_STATIC_MAP_PNG, contentType: "image/png" });
};
const routeCalls = (): number => routes.requests.filter((request) => String(request.headers["x-goog-fieldmask"]).includes("polyline")).length;

interface MapResponse {
  status: number;
  headers: Record<string, unknown>;
  raw: Buffer;
  text: string;
  body: any;
}
type MapQuery = { from: { lat: number; lng: number }; to: { lat: number; lng: number }; theme?: string; width?: number | string; height?: number | string; scale?: number | string; extra?: Record<string, string> };

const queryOf = (q: MapQuery): string => {
  const params = new URLSearchParams({ from_lat: String(q.from.lat), from_lng: String(q.from.lng), to_lat: String(q.to.lat), to_lng: String(q.to.lng), theme: q.theme ?? "light", width: String(q.width ?? 320), height: String(q.height ?? 200), scale: String(q.scale ?? 2), ...q.extra });
  return params.toString();
};
async function routeMap(q: MapQuery | string, app: SiteApi = site, ip = nextIp()): Promise<MapResponse> {
  const res = await app.app.inject({ method: "GET", url: `/site/v1/route-map?${typeof q === "string" ? q : queryOf(q)}`, remoteAddress: ip });
  let body: unknown = null;
  if (String(res.headers["content-type"]).startsWith("application/json")) body = res.json();
  return { status: res.statusCode, headers: res.headers, raw: res.rawPayload, text: res.body, body };
}
const asApi = (res: MapResponse) => ({ status: res.status, headers: res.headers as never, text: res.text, body: res.body });
async function unavailable(res: MapResponse, reason: "NOT_ENABLED" | "UNAVAILABLE", message = ""): Promise<void> {
  assert.equal(res.status, 503, `${message} ${res.text}`);
  assertMatchesOpenApi("GET", "/site/v1/route-map", asApi(res));
  assert.deepEqual([res.body.error.code, res.body.error.details], ["ROUTE_MAP_UNAVAILABLE", { reason }], message);
  assert.equal(res.headers["cache-control"], "no-store", "出不了图的应答不缓存");
}
const usage = async (): Promise<{ calls: number; failures: number; refused: number }> =>
  (await api.db.owner.query("select calls, failures, refused from static_map_api_usage where day = $1", [routeUsageDay(api.clock.now())])).rows[0] ?? { calls: 0, failures: 0, refused: 0 };
const mapParams = (index = 0): URLSearchParams => new URL(maps.requests[index]?.path ?? "/", maps.origin).searchParams;

before(async () => {
  routes = await startFakeGoogleRoutes();
  maps = await startFakeGoogleStaticMaps();
  api = await createTestApi({ payments: new FakePaymentProvider(), integrationSecretsTtlMs: 0 });
  m = await buildMarket(api);
  const channel = await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" });
  siteClientId = (await salesCredentials(api, m, channel.id)).clientId;
  site = await openSite();
  reset();
});
after(async () => {
  for (const app of [site, ...opened]) await app?.close();
  await api.close();
  await routes.close();
  await maps.close();
});

test("出图：先取路线折线（Routes，和报价同一个取整的键），再调静态地图——尺寸、倍率、PNG、灰色调样式、品牌色路线和 A / B 标记；应答是图片、浏览器缓存 1 天", async () => {
  reset();
  const pair = nextPair();
  const res = await routeMap({ ...pair });
  assert.equal(res.status, 200, res.text);
  assert.equal(res.headers["content-type"], "image/png");
  assert.equal(res.headers["cache-control"], "private, max-age=86400");
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.deepEqual(res.raw, FAKE_STATIC_MAP_PNG);
  assert.equal(routeCalls(), 1);
  assert.deepEqual(JSON.parse(routes.requests[0]?.body ?? "{}").origin.location.latLng, { latitude: Number(pair.from.lat.toFixed(3)), longitude: 139.6 });
  assert.equal(maps.requests.length, 1);
  const request = maps.requests[0] as FakeService["requests"][number];
  assert.equal(request.method, "GET");
  const params = mapParams();
  assert.equal(params.get("size"), "320x200");
  assert.equal(params.get("scale"), "2");
  assert.equal(params.get("format"), "png");
  assert.deepEqual(params.getAll("style"), staticMapStyles("light"));
  assert.equal(params.get("path"), `color:0x1B2A5Cff|weight:5|enc:${POLYLINE}`);
  assert.deepEqual(params.getAll("markers"), ["size:mid|color:0x1B2A5C|label:A|38.50000,-120.20000", "size:mid|color:0x1B2A5C|label:B|43.25200,-126.45300"]);
  assert.equal(params.get("key"), KEY, "密钥只在发给谷歌的网址里");
  assert.ok(request.path.endsWith(`&key=${KEY}`));
  assert.deepEqual(await usage(), { calls: 1, failures: 0, refused: 0 });
});

test("缓存：同一条路线 × 主题 × 尺寸 × 倍率不再调任何谷歌（库里一行，1 天）；换主题、尺寸、倍率各出一张，但路线折线不再取", async () => {
  reset();
  const pair = nextPair();
  await routeMap({ ...pair });
  assert.deepEqual([routeCalls(), maps.requests.length], [1, 1]);
  const again = await routeMap({ ...pair, from: { lat: pair.from.lat + 0.0002, lng: pair.from.lng } });
  assert.equal(again.status, 200);
  assert.deepEqual(again.raw, FAKE_STATIC_MAP_PNG);
  assert.deepEqual([routeCalls(), maps.requests.length], [1, 1], "同一个 100 米格子：缓存命中");
  const dark = await routeMap({ ...pair, theme: "dark" });
  assert.equal(dark.status, 200);
  assert.match(mapParams(1).get("path") ?? "", /^color:0xA9BBFFff\|weight:5\|enc:/);
  assert.deepEqual(mapParams(1).getAll("style"), staticMapStyles("dark"));
  await routeMap({ ...pair, width: 640, height: 640 });
  await routeMap({ ...pair, scale: 1 });
  assert.deepEqual([routeCalls(), maps.requests.length], [1, 4]);
  const rows = (await api.db.owner.query("select cache_key, content_type, octet_length(image)::int as size, expires_at - fetched_at as ttl from static_map_images where cache_key like $1 order by cache_key", [`%|v1:${pair.from.lat.toFixed(3)},139.600>%`])).rows;
  assert.deepEqual(
    rows.map((row) => row.cache_key.split("|")[0]),
    ["s1:dark:320x200@2", "s1:light:320x200@1", "s1:light:320x200@2", "s1:light:640x640@2"],
  );
  assert.ok(rows.every((row) => row.content_type === "image/png" && row.size === FAKE_STATIC_MAP_PNG.length && row.ttl.days === 1));
});

test("并发：同一张图同时来 5 次只调一次谷歌，5 次都拿到图", async () => {
  reset();
  const pair = nextPair();
  maps.respond({ body: null, raw: FAKE_STATIC_MAP_PNG, contentType: "image/png", delayMs: 200 });
  const all = await Promise.all(Array.from({ length: 5 }, () => routeMap({ ...pair })));
  assert.deepEqual(all.map((res) => res.status), [200, 200, 200, 200, 200]);
  assert.equal(maps.requests.length, 1);
  assert.equal(routeCalls(), 1);
});

test("路线和按两个坐标报价同一份：报价时取过的折线不再调 Routes；出图不改报价、不写询价日志", async () => {
  reset();
  const pickup = { lat: NARITA.lat + 0.0045, lng: NARITA.lng };
  const quote = await site.call("POST", "/site/v1/quotes/by-points", { ip: nextIp(), body: { pickup: { name: "出发地", ...pickup }, dropoff: { name: "目的地", ...TOKYO_STATION }, service_local: SERVICE_LOCAL, passengers: 2 } });
  assert.equal(quote.status, 200, quote.text);
  assert.deepEqual(quote.body.route, { minutes: 60, meters: 25_400, polyline: POLYLINE });
  assert.equal(routeCalls(), 1);
  const logsBefore = (await api.db.owner.query("select count(*)::int as n from quote_logs")).rows[0].n;
  const estimate = (await api.db.owner.query("select distance_meters, duration_seconds, fetched_at from route_estimates where cache_key = 'v1:35.773,140.389>35.681,139.767'")).rows[0];
  const res = await routeMap({ from: pickup, to: TOKYO_STATION });
  assert.equal(res.status, 200, res.text);
  assert.equal(routeCalls(), 1, "报价时取过的路线不再调 Routes");
  assert.equal(maps.requests.length, 1);
  assert.equal((await api.db.owner.query("select count(*)::int as n from quote_logs")).rows[0].n, logsBefore, "出图不询价");
  assert.deepEqual((await api.db.owner.query("select distance_meters, duration_seconds, fetched_at from route_estimates where cache_key = 'v1:35.773,140.389>35.681,139.767'")).rows[0], estimate, "路线缓存不变");
});

test("路线没取过时调 Routes，计入路线的每日上限；Routes 出错、到了路线上限 → UNAVAILABLE，不调静态地图", async () => {
  reset();
  const day = routeUsageDay(api.clock.now());
  const before = (await api.db.owner.query("select coalesce(sum(calls), 0)::int as calls from route_api_usage where day = $1", [day])).rows[0].calls as number;
  const fresh = await openSite();
  assert.equal((await routeMap({ ...nextPair() }, fresh)).status, 200);
  assert.equal((await api.db.owner.query("select calls from route_api_usage where day = $1", [day])).rows[0].calls, before + 1);

  reset();
  routes.respond({ status: 500, body: {} });
  const failing = await openSite();
  await unavailable(await routeMap({ ...nextPair() }, failing), "UNAVAILABLE", "Routes 出错");
  assert.equal(maps.requests.length, 0);

  reset();
  const used = (await api.db.owner.query("select calls from route_api_usage where day = $1", [day])).rows[0].calls as number;
  const capped = await openSite({ GOOGLE_ROUTES_DAILY_LIMIT: String(used) });
  await unavailable(await routeMap({ ...nextPair() }, capped), "UNAVAILABLE", "到了路线的每日上限");
  assert.deepEqual([routeCalls(), maps.requests.length], [0, 0]);
});

test("NOT_ENABLED：谷歌说没开通、项目不允许、referer 限制、密钥无效——页面改用原来的地图；60 秒冷却内不再调；系统状态有原因码", async () => {
  const cases: [string, string][] = [
    ["This API is not activated on your API project. You may need to enable this API in the Google Cloud Console: https://console.cloud.google.com/", "API_NOT_ENABLED"],
    ["The Google Maps Platform server rejected your request. This API project is not authorized to use this API.", "API_NOT_ENABLED"],
    ["API keys with referer restrictions cannot be used with this API.", "KEY_RESTRICTED"],
    [`The provided API key is invalid. (${KEY})`, "KEY_INVALID"],
  ];
  for (const [text, code] of cases) {
    reset();
    maps.respond({ status: 403, body: null, raw: text, contentType: "text/plain; charset=UTF-8" });
    const app = await openSite();
    await unavailable(await routeMap({ ...nextPair() }, app), "NOT_ENABLED", code);
    assert.equal(maps.requests.length, 1, "4xx 不重试");
    await unavailable(await routeMap({ ...nextPair() }, app), "NOT_ENABLED", `${code} 冷却`);
    assert.equal(maps.requests.length, 1, "冷却中不调用");
    const status = await ok(api.call("GET", "/platform/v1/integrations", { token: m.root }));
    assert.equal(status.static_maps.last_failure.code, code);
    assert.ok(!JSON.stringify(status).includes(KEY));
  }
});

test("NOT_ENABLED：没配谷歌密钥——不调 Routes、不调静态地图", async () => {
  reset();
  const app = await openSite({ GOOGLE_MAPS_API_KEY: "" });
  await unavailable(await routeMap({ ...nextPair() }, app), "NOT_ENABLED");
  assert.deepEqual([routes.requests.length, maps.requests.length], [0, 0]);
});

test("UNAVAILABLE：谷歌 5xx（再试 1 次）、图太大、不是图片、跳转（不跟随）——都不存库；同一个点、官网没开不调用", async () => {
  const scenarios: [string, () => void, number][] = [
    ["5xx", () => maps.respond({ status: 500, body: null, raw: "Internal error", contentType: "text/plain" }), 2],
    ["图太大", () => maps.respond({ body: null, raw: Buffer.concat([FAKE_STATIC_MAP_PNG, Buffer.alloc(1024 * 1024)]), contentType: "image/png" }), 1],
    ["不是图片", () => maps.respond({ body: { error: "nope" } }), 1],
    ["跳转", () => maps.respond(() => ({ status: 302, body: null, raw: "", contentType: "text/plain" })), 1],
  ];
  for (const [name, setup, calls] of scenarios) {
    reset();
    setup();
    const app = await openSite();
    const pair = nextPair();
    await unavailable(await routeMap({ ...pair }, app), "UNAVAILABLE", name);
    assert.equal(maps.requests.length, calls, name);
    assert.equal((await api.db.owner.query("select count(*)::int as n from static_map_images where cache_key like $1", [`%|v1:${pair.from.lat.toFixed(3)},139.600>%`])).rows[0].n, 0, name);
  }
  reset();
  await unavailable(await routeMap({ from: TOKYO_STATION, to: { lat: 35.6814, lng: 139.7669 } }), "UNAVAILABLE", "同一个点");
  const closed = await openSite({}, null);
  await unavailable(await routeMap({ ...nextPair() }, closed), "UNAVAILABLE", "官网没开");
  assert.deepEqual([routes.requests.length, maps.requests.length], [0, 0]);
});

test("每日上限（GOOGLE_STATIC_MAPS_DAILY_LIMIT）：到了不发请求、记被挡下、UNAVAILABLE；冷却内也记；上限 0 不调用；并发不超；系统状态", async () => {
  reset();
  const used = (await usage()).calls;
  const capped = await openSite({ GOOGLE_STATIC_MAPS_DAILY_LIMIT: String(used) });
  const refusedBefore = (await usage()).refused;
  await unavailable(await routeMap({ ...nextPair() }, capped), "UNAVAILABLE", "到了上限");
  await unavailable(await routeMap({ ...nextPair() }, capped), "UNAVAILABLE", "冷却中");
  assert.equal(maps.requests.length, 0);
  assert.equal((await usage()).refused, refusedBefore + 2);
  const zero = await openSite({ GOOGLE_STATIC_MAPS_DAILY_LIMIT: "0" });
  await unavailable(await routeMap({ ...nextPair() }, zero), "UNAVAILABLE", "上限 0");
  assert.equal(maps.requests.length, 0);

  reset();
  const now = (await usage()).calls;
  const two = await openSite({ GOOGLE_STATIC_MAPS_DAILY_LIMIT: String(now + 2) });
  const all = await Promise.all(Array.from({ length: 6 }, () => routeMap({ ...nextPair() }, two)));
  assert.equal(all.filter((res) => res.status === 200).length, 2, all.map((res) => res.status).join(","));
  assert.equal(maps.requests.length, 2, "几个请求同时来也不超过上限");
  assert.equal((await usage()).calls, now + 2);

  const status = await ok(api.call("GET", "/platform/v1/integrations", { token: m.root }));
  assertMatchesOpenApi("GET", "/platform/v1/integrations", { status: 200, headers: {}, text: "", body: status });
  assert.equal(status.static_maps.day, routeUsageDay(api.clock.now()));
  assert.equal(status.static_maps.calls, now + 2);
  assert.equal(status.static_maps.daily_limit, 300, "主应用用默认值");
  assert.equal(status.static_maps.daily_limit_reached, false);
  assert.ok(status.static_maps.refused >= 6);
  assert.ok(status.static_maps.last_success_at !== null);
});

test("输入校验：坐标缺少 / 留空 / 不合法、尺寸和倍率超出范围、主题不对、多余的参数 → 400，不调用谷歌", async () => {
  reset();
  const pair = nextPair();
  const good = new URLSearchParams(queryOf({ ...pair }));
  const variants: [string, (params: URLSearchParams) => void][] = [
    ["缺 from_lat", (p) => p.delete("from_lat")],
    ["from_lng 留空", (p) => p.set("from_lng", "")],
    ["to_lat 不是数字", (p) => p.set("to_lat", "north")],
    ["to_lng 超出范围", (p) => p.set("to_lng", "181")],
    ["宽太小", (p) => p.set("width", "199")],
    ["高太大", (p) => p.set("height", "641")],
    ["宽是小数", (p) => p.set("width", "320.5")],
    ["倍率 3", (p) => p.set("scale", "3")],
    ["主题不对", (p) => p.set("theme", "sepia")],
    ["多余的参数", (p) => p.set("zoom", "12")],
  ];
  for (const [name, change] of variants) {
    const params = new URLSearchParams(good);
    change(params);
    const res = await routeMap(params.toString());
    assert.equal(res.status, 400, `${name} ${res.text}`);
    assertMatchesOpenApi("GET", "/site/v1/route-map", asApi(res));
    assert.equal(res.body.error.code, "VALIDATION_FAILED", name);
  }
  assert.deepEqual([routes.requests.length, maps.requests.length], [0, 0]);
  const defaults = new URLSearchParams(good);
  defaults.delete("theme");
  defaults.delete("scale");
  assert.equal((await routeMap(defaults.toString())).status, 200, "主题默认亮色、倍率默认 1");
  assert.equal(mapParams().get("scale"), "1");
});

test("限频：每个地址每分钟 30 次（缓存命中也算），第 31 次 429 + Retry-After；换个地址不受影响", async () => {
  reset();
  const pair = nextPair();
  const ip = nextIp();
  for (let i = 0; i < 30; i++) assert.equal((await routeMap({ ...pair }, site, ip)).status, 200, String(i));
  const limited = await routeMap({ ...pair }, site, ip);
  assert.equal(limited.status, 429);
  assertMatchesOpenApi("GET", "/site/v1/route-map", asApi(limited));
  assert.equal(limited.body.error.code, "RATE_LIMITED");
  assert.ok(Number(limited.headers["retry-after"]) > 0);
  assert.equal((await routeMap({ ...pair }, site, nextIp())).status, 200);
  assert.equal(maps.requests.length, 1, "只有第一次调了谷歌");
});

test("密钥不外泄：应答、日志、两张新表里都没有密钥原文（谷歌的错误应答回显了密钥也一样）", async () => {
  reset();
  logs = "";
  maps.respond({ status: 403, body: null, raw: `The provided API key is invalid. key=${KEY}`, contentType: "text/plain" });
  const app = await openSite();
  const failed = await routeMap({ ...nextPair() }, app);
  reset();
  const fine = await routeMap({ ...nextPair() }, await openSite());
  for (const res of [failed, fine]) {
    assert.ok(!res.text.includes(KEY) && !res.raw.includes(Buffer.from(KEY)), "应答里有密钥");
    assert.ok(!JSON.stringify(res.headers).includes(KEY), "应答头里有密钥");
  }
  assert.ok(!allValues(failed.body).has(KEY));
  assert.match(logs, /"staticMapFailure":"KEY_INVALID"/);
  assert.ok(!logs.includes(KEY), "日志里有密钥");
  assert.ok(!logs.includes("staticmap?"), "日志里有请求网址");
  const tables = await api.db.owner.query("select (select coalesce(string_agg(t::text, ''), '') from static_map_api_usage t) || (select coalesce(string_agg(cache_key || content_type || encode(image, 'escape'), ''), '') from static_map_images) as dump");
  assert.ok(!String(tables.rows[0].dump).includes(KEY), "库里有密钥");
});

// 放在最后：时钟往后拨 1 天会让平台员工的登录过期
test("缓存过期：1 天后再调谷歌并覆盖那一行；写入时顺手删掉别的过期行", async () => {
  reset();
  const pair = nextPair();
  await routeMap({ ...pair });
  const stale = "s1:light:300x300@1|v1:1.000,1.000>2.000,2.000";
  await api.db.owner.query("insert into static_map_images (cache_key, content_type, image, fetched_at, expires_at) values ($1, 'image/png', $2, $3::timestamptz - interval '2 days', $3::timestamptz - interval '1 day')", [stale, FAKE_STATIC_MAP_PNG, api.clock.now()]);
  api.clock.advance(24 * 3_600_000 + 1_000);
  const res = await routeMap({ ...pair });
  assert.equal(res.status, 200);
  assert.equal(maps.requests.length, 2, "过期后重新调用");
  const rows = (await api.db.owner.query("select fetched_at from static_map_images where cache_key like $1 and cache_key like 's1:light:320x200@2|%'", [`%|v1:${pair.from.lat.toFixed(3)},139.600>%`])).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].fetched_at.getTime(), api.clock.now().getTime());
  assert.equal((await api.db.owner.query("select count(*)::int as n from static_map_images where cache_key = $1", [stale])).rows[0].n, 0, "过期的行被删掉");
});
