/**
 * M9P-20 P1：包车行程地图 `GET /site/v1/itinerary-map`（谷歌静态地图 + 一次带中间点的 computeRoutes，ADR 0096 第二节），经真实接口、真实 PostgreSQL；
 * 谷歌（Routes、Maps Static API）全是本机的假服务器（testing/fake-integrations.ts），**从不调用真实的谷歌**。
 *
 * 覆盖：
 * - 折线：一次 computeRoutes，经停作 `intermediates`（`via: false`）、字段掩码只要整条和逐段折线、点按 3 位小数取整；逐段折线拼成一条路线；
 * - 出图：编号标记（1 = 上车、经停依次、最后 = 下车；1–9 内置 label，10–12 是官网 `/map-markers/` 的自定义图标，最多 3 种）、应答是图片、浏览器缓存 1 天；
 * - 缓存：同一组有序点 × 主题 × 尺寸 × 倍率不再调任何谷歌；换尺寸只再出图、折线不再取（库里 7 天）；换顺序是另一张图、另一条折线；
 * - 上限：静态地图计入 `GOOGLE_STATIC_MAPS_DAILY_LIMIT`、折线计入 `GOOGLE_ROUTES_DAILY_LIMIT`，到了都不调、503 UNAVAILABLE；
 * - 失败：没配密钥 NOT_ENABLED；取不到路线、所有点同一个、官网没开 UNAVAILABLE；
 * - 输入校验：少于 2 个、多于 12 个、格式不对、缺参数 → 400，不调谷歌；
 * - 密钥不外泄：应答、日志、缓存表里都没有密钥原文。
 * 测试数据全在本文件里经接口建出来，随测试 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { type LatLng, routeUsageDay } from "@nozomi/domain";
import { ITINERARY_POLYLINE_FIELD_MASK } from "./integrations/google-itinerary-routes.ts";
import { type TestApi, createTestApi } from "./testing/api.ts";
import { FAKE_STATIC_MAP_PNG, type FakeService, startFakeGoogleRoutes, startFakeGoogleStaticMaps } from "./testing/fake-integrations.ts";
import { FAKE_SECRETS } from "./testing/fixtures.ts";
import { type Market, allValues, buildMarket, newChannel, salesCredentials } from "./testing/market.ts";
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

const KEY = FAKE_SECRETS.googleMapsApiKey;
const SITE_URL = "https://book.example.test";

let ipSeq = 0;
const nextIp = (): string => `10.78.${Math.floor(++ipSeq / 200)}.${ipSeq % 200}`;
/** 每个用例用自己的一组点（库里的缓存是共用的）：n 个点，往东排开 */
let tripSeq = 0;
const nextTrip = (n: number): LatLng[] => {
  tripSeq++;
  return Array.from({ length: n }, (_, i) => ({ lat: Number((35.1 + tripSeq * 0.01).toFixed(4)), lng: Number((139.1 + i * 0.02).toFixed(4)) }));
};

/** 谷歌编码的两点折线（逐段的折线用它造） */
function encode(points: readonly LatLng[]): string {
  let out = "";
  let lastLat = 0;
  let lastLng = 0;
  const value = (v: number): string => {
    let x = v < 0 ? ~(v << 1) : v << 1;
    let s = "";
    while (x >= 0x20) {
      s += String.fromCharCode((0x20 | (x & 0x1f)) + 63);
      x >>>= 5;
    }
    return s + String.fromCharCode(x + 63);
  };
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5);
    const lng = Math.round(p.lng * 1e5);
    out += value(lat - lastLat) + value(lng - lastLng);
    lastLat = lat;
    lastLng = lng;
  }
  return out;
}

/** 假 Routes 按请求里的点回逐段折线（每段就是两个端点） */
function legsReply(): void {
  routes.respond(() => {
    const last = routes.requests[routes.requests.length - 1];
    const body = JSON.parse(last?.body ?? "{}") as { origin: { location: { latLng: { latitude: number; longitude: number } } }; destination: typeof body.origin; intermediates?: (typeof body.origin)[] };
    const pts = [body.origin, ...(body.intermediates ?? []), body.destination].map((p) => ({ lat: p.location.latLng.latitude, lng: p.location.latLng.longitude }));
    return { body: { routes: [{ polyline: { encodedPolyline: encode(pts) }, legs: pts.slice(1).map((to, i) => ({ polyline: { encodedPolyline: encode([pts[i] as LatLng, to]) } })) }] } };
  });
}

const googleEnv = (): Record<string, string> => ({ GOOGLE_MAPS_ROUTES_URL: routes.url, GOOGLE_STATIC_MAPS_URL: maps.url, PUBLIC_BASE_URL: SITE_URL });
const openSite = async (env: Record<string, string> = {}, clientId: string | null = siteClientId): Promise<SiteApi> => {
  const app = await siteApi(api, clientId, new FakePaymentProvider(), { ...googleEnv(), ...env }, { integrationSecretsTtlMs: 0, logDestination: { write: (line) => void (logs += line) } });
  opened.push(app);
  return app;
};
const reset = (): void => {
  routes.requests.length = 0;
  maps.requests.length = 0;
  legsReply();
  maps.respond({ body: null, raw: FAKE_STATIC_MAP_PNG, contentType: "image/png" });
};

interface MapResponse {
  status: number;
  headers: Record<string, unknown>;
  raw: Buffer;
  text: string;
  body: any;
}
const queryOf = (points: readonly LatLng[], extra: Record<string, string> = {}): string => {
  const params = new URLSearchParams();
  for (const p of points) params.append("p", `${p.lat},${p.lng}`);
  for (const [k, v] of Object.entries({ theme: "light", width: "320", height: "200", scale: "2", ...extra })) params.append(k, v);
  return params.toString();
};
async function itineraryMap(q: readonly LatLng[] | string, app: SiteApi = site, ip = nextIp()): Promise<MapResponse> {
  const res = await app.app.inject({ method: "GET", url: `/site/v1/itinerary-map?${typeof q === "string" ? q : queryOf(q)}`, remoteAddress: ip });
  let body: unknown = null;
  if (String(res.headers["content-type"]).startsWith("application/json")) body = res.json();
  return { status: res.statusCode, headers: res.headers, raw: res.rawPayload, text: res.body, body };
}
const asApi = (res: MapResponse) => ({ status: res.status, headers: res.headers as never, text: res.text, body: res.body });
function unavailable(res: MapResponse, reason: "NOT_ENABLED" | "UNAVAILABLE", message = ""): void {
  assert.equal(res.status, 503, `${message} ${res.text}`);
  assertMatchesOpenApi("GET", "/site/v1/itinerary-map", asApi(res));
  assert.deepEqual([res.body.error.code, res.body.error.details], ["ROUTE_MAP_UNAVAILABLE", { reason }], message);
  assert.equal(res.headers["cache-control"], "no-store", "出不了图的应答不缓存");
}
const mapParams = (index = 0): URLSearchParams => new URL(maps.requests[index]?.path ?? "/", maps.origin).searchParams;
const routeCalls = (): FakeService["requests"] => routes.requests.filter((request) => request.headers["x-goog-fieldmask"] === ITINERARY_POLYLINE_FIELD_MASK);
const usage = async (table: "static_map_api_usage" | "route_api_usage"): Promise<number> => ((await api.db.owner.query(`select calls from ${table} where day = $1`, [routeUsageDay(api.clock.now())])).rows[0]?.calls as number | undefined) ?? 0;

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

test("出图：一次 computeRoutes 带中间点取折线，再调静态地图——逐段折线拼成品牌色路线，标记 1 = 上车、经停依次、最后 = 下车；应答是图片、浏览器缓存 1 天", async () => {
  reset();
  const staticBefore = await usage("static_map_api_usage");
  const routesBefore = await usage("route_api_usage");
  const points = nextTrip(5).map((p, i) => (i === 1 ? { lat: p.lat + 0.00049, lng: p.lng } : p));
  const res = await itineraryMap(points);
  assert.equal(res.status, 200, res.text);
  assert.equal(res.headers["content-type"], "image/png");
  assert.equal(res.headers["cache-control"], "private, max-age=86400");
  assert.equal(res.headers["x-content-type-options"], "nosniff");
  assert.deepEqual(res.raw, FAKE_STATIC_MAP_PNG);

  // 折线：一次调用，起终点 + 3 个停靠点，坐标按 3 位小数取整
  assert.equal(routeCalls().length, 1);
  assert.equal(routes.requests.length, 1, "不另调逐段两两的路线");
  const sent = JSON.parse(routeCalls()[0]?.body ?? "{}");
  assert.equal(routeCalls()[0]?.headers["x-goog-api-key"], KEY);
  assert.deepEqual(sent.origin.location.latLng, { latitude: points[0]?.lat, longitude: points[0]?.lng });
  assert.deepEqual(sent.destination.location.latLng, { latitude: points[4]?.lat, longitude: points[4]?.lng });
  assert.equal(sent.intermediates.length, 3);
  assert.deepEqual(sent.intermediates[0], { location: { latLng: { latitude: Number((points[1]?.lat as number).toFixed(3)), longitude: points[1]?.lng } }, via: false });
  assert.deepEqual([sent.travelMode, sent.routingPreference, sent.computeAlternativeRoutes], ["DRIVE", "TRAFFIC_UNAWARE", false]);

  // 图：编号、颜色、路线
  assert.equal(maps.requests.length, 1);
  const params = mapParams();
  assert.equal(params.get("size"), "320x200");
  assert.equal(params.get("scale"), "2");
  const rounded = points.map((p) => ({ lat: Number(p.lat.toFixed(3)), lng: Number(p.lng.toFixed(3)) }));
  assert.equal(params.get("path"), `color:0x1B2A5Cff|weight:5|enc:${encode(rounded)}`);
  const fmt = (p: LatLng): string => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
  assert.deepEqual(params.getAll("markers"), [
    `color:0x1B2A5C|label:1|${fmt(rounded[0] as LatLng)}`,
    `size:mid|color:0x4A5FA8|label:2|${fmt(rounded[1] as LatLng)}`,
    `size:mid|color:0x4A5FA8|label:3|${fmt(rounded[2] as LatLng)}`,
    `size:mid|color:0x4A5FA8|label:4|${fmt(rounded[3] as LatLng)}`,
    `color:0x1B2A5C|label:5|${fmt(rounded[4] as LatLng)}`,
  ]);
  assert.equal(params.get("key"), KEY, "密钥只在发给谷歌的网址里");
  assert.equal(await usage("static_map_api_usage"), staticBefore + 1, "计入静态地图的每日上限");
  assert.equal(await usage("route_api_usage"), routesBefore + 1, "折线计入路线的每日上限");
});

test("10 个经停（12 个点）：1–9 用 label，10–12 用官网 /map-markers/ 下的自定义图标（3 种）；暗色主题的颜色", async () => {
  reset();
  const res = await itineraryMap(queryOf(nextTrip(12), { theme: "dark" }));
  assert.equal(res.status, 200, res.text);
  assert.equal(JSON.parse(routeCalls()[0]?.body ?? "{}").intermediates.length, 10);
  const markers = mapParams().getAll("markers");
  assert.equal(markers.length, 12);
  for (let n = 1; n <= 9; n++) assert.match(markers[n - 1] as string, new RegExp(`\\|label:${n}\\|`));
  assert.match(markers[0] as string, /^color:0xA9BBFF\|label:1\|/);
  assert.match(markers[1] as string, /^size:mid\|color:0x7C8FD6\|label:2\|/);
  for (const n of [10, 11, 12]) assert.match(markers[n - 1] as string, new RegExp(`^anchor:center\\|icon:${SITE_URL}/map-markers/${n}\\.png\\|`));
  assert.equal(new Set(markers.flatMap((marker) => /icon:([^|]+)/.exec(marker)?.[1] ?? [])).size, 3);
});

test("缓存：同一组有序点不再调任何谷歌；换尺寸只再出图、折线取库里的；换顺序是另一张图、另一条折线；并发同一张只调一次", async () => {
  reset();
  const points = nextTrip(4);
  assert.equal((await itineraryMap(points)).status, 200);
  assert.equal((await itineraryMap(points)).status, 200);
  assert.deepEqual([routeCalls().length, maps.requests.length], [1, 1], "第二次全从库里来");
  const rows = await api.db.owner.query("select cache_key, cardinality(polylines) as n, expires_at - fetched_at as ttl from itinerary_route_polylines where cache_key like $1", [`i1:${points[0]?.lat.toFixed(3)},${points[0]?.lng.toFixed(3)}>%`]);
  assert.equal(rows.rows.length, 1);
  assert.equal(rows.rows[0].n, 3, "逐段 3 条折线");
  assert.equal(rows.rows[0].ttl.days, 7, "折线保留 7 天");

  // 新进程（进程内没有任何东西）、换尺寸：只调静态地图
  const other = await openSite();
  assert.equal((await itineraryMap(queryOf(points, { width: "400" }), other)).status, 200);
  assert.deepEqual([routeCalls().length, maps.requests.length], [1, 2]);

  // 换顺序：编号跟着顺序走，另取折线、另出一张
  const swapped = [points[0], points[2], points[1], points[3]] as LatLng[];
  assert.equal((await itineraryMap(swapped)).status, 200);
  assert.deepEqual([routeCalls().length, maps.requests.length], [2, 3]);

  reset();
  const fresh = nextTrip(3);
  const results = await Promise.all(Array.from({ length: 5 }, () => itineraryMap(fresh)));
  assert.deepEqual(results.map((r) => r.status), [200, 200, 200, 200, 200]);
  assert.deepEqual([routeCalls().length, maps.requests.length], [1, 1]);
});

test("只有整条折线（没给逐段的）时照样画；取不到路线、所有点同一个、官网没开 → UNAVAILABLE；没配密钥 → NOT_ENABLED", async () => {
  reset();
  const whole = nextTrip(3);
  routes.respond({ body: { routes: [{ polyline: { encodedPolyline: encode(whole) } }] } });
  assert.equal((await itineraryMap(whole)).status, 200);
  assert.equal(mapParams().get("path"), `color:0x1B2A5Cff|weight:5|enc:${encode(whole.map((p) => ({ lat: Number(p.lat.toFixed(3)), lng: Number(p.lng.toFixed(3)) })))}`);

  reset();
  routes.respond({ body: {} });
  unavailable(await itineraryMap(nextTrip(3)), "UNAVAILABLE", "没有路线");
  assert.equal(maps.requests.length, 0, "取不到折线就不调静态地图");

  reset();
  routes.respond({ body: { routes: [{}] } });
  unavailable(await itineraryMap(nextTrip(3)), "UNAVAILABLE", "有路线没折线");
  assert.equal(maps.requests.length, 0);

  reset();
  const same = nextTrip(1)[0] as LatLng;
  unavailable(await itineraryMap([same, same, { lat: same.lat + 0.0001, lng: same.lng }]), "UNAVAILABLE", "所有点同一个");
  assert.deepEqual([routes.requests.length, maps.requests.length], [0, 0]);

  const closed = await openSite({}, null);
  unavailable(await itineraryMap(nextTrip(3), closed), "UNAVAILABLE", "官网没开");
  const noKey = await openSite({ GOOGLE_MAPS_API_KEY: "" });
  unavailable(await itineraryMap(nextTrip(3), noKey), "NOT_ENABLED", "没配密钥");
  assert.deepEqual([routes.requests.length, maps.requests.length], [0, 0]);
});

test("每日上限：静态地图到了不调静态地图；路线到了不取折线、也不调静态地图——都 503 UNAVAILABLE", async () => {
  reset();
  const zeroStatic = await openSite({ GOOGLE_STATIC_MAPS_DAILY_LIMIT: "0" });
  unavailable(await itineraryMap(nextTrip(3), zeroStatic), "UNAVAILABLE", "静态地图上限 0");
  assert.equal(maps.requests.length, 0);

  reset();
  const used = await usage("route_api_usage");
  const cappedRoutes = await openSite({ GOOGLE_ROUTES_DAILY_LIMIT: String(used) });
  unavailable(await itineraryMap(nextTrip(3), cappedRoutes), "UNAVAILABLE", "到了路线的每日上限");
  assert.deepEqual([routes.requests.length, maps.requests.length], [0, 0]);
});

test("输入校验：少于 2 个点、多于 12 个、格式不对、超出范围、缺参数、多余参数 → 400，不调用谷歌", async () => {
  reset();
  const bad: [string, string][] = [
    [queryOf(nextTrip(1)), "只有 1 个点"],
    [queryOf(nextTrip(13)), "13 个点"],
    ["p=35.1,139.1&p=35.2&width=320&height=200", "点没有经度"],
    ["p=35.1,139.1&p=abc,def&width=320&height=200", "不是数字"],
    ["p=35.1,139.1&p=91,139&width=320&height=200", "纬度超出范围"],
    ["p=35.1,139.1&p=35.2,181&width=320&height=200", "经度超出范围"],
    ["width=320&height=200", "没有 p"],
    [`${queryOf(nextTrip(2)).replace(/&width=320/, "")}`, "没有宽"],
    [queryOf(nextTrip(2), { width: "100" }), "太窄"],
    [queryOf(nextTrip(2), { scale: "3" }), "倍率"],
    [queryOf(nextTrip(2), { theme: "blue" }), "主题"],
    [queryOf(nextTrip(2), { from_lat: "35" }), "多余参数"],
  ];
  for (const [query, message] of bad) {
    const res = await itineraryMap(query);
    assert.equal(res.status, 400, `${message}: ${res.text}`);
    assertMatchesOpenApi("GET", "/site/v1/itinerary-map", asApi(res));
  }
  assert.deepEqual([routes.requests.length, maps.requests.length], [0, 0]);
});

test("和路线小地图共用每个地址每分钟 30 次的额度：第 31 次 429", async () => {
  reset();
  const ip = nextIp();
  const points = nextTrip(2);
  for (let i = 0; i < 30; i++) assert.equal((await itineraryMap(points, site, ip)).status, 200);
  const res = await itineraryMap(points, site, ip);
  assert.equal(res.status, 429);
  assertMatchesOpenApi("GET", "/site/v1/itinerary-map", asApi(res));
});

test("密钥不外泄：应答、日志、缓存表里都没有密钥原文（谷歌的错误应答回显了密钥也一样）", async () => {
  reset();
  logs = "";
  routes.respond({ status: 403, body: { error: { code: 403, message: `bad key ${KEY}`, status: "PERMISSION_DENIED", details: [] } } });
  const failed = await itineraryMap(nextTrip(3), await openSite());
  assert.equal(failed.status, 503);
  reset();
  const fine = await itineraryMap(nextTrip(3), await openSite());
  assert.equal(fine.status, 200);
  for (const res of [failed, fine]) {
    assert.ok(!res.text.includes(KEY) && !res.raw.includes(Buffer.from(KEY)), "应答里有密钥");
    assert.ok(!JSON.stringify(res.headers).includes(KEY), "应答头里有密钥");
  }
  assert.ok(!allValues(failed.body).has(KEY));
  assert.match(logs, /"routeFailure":"PERMISSION_DENIED"/);
  assert.ok(!logs.includes(KEY), "日志里有密钥");
  const tables = await api.db.owner.query("select (select coalesce(string_agg(t::text, ''), '') from itinerary_route_polylines t) || (select coalesce(string_agg(cache_key, ''), '') from static_map_images) as dump");
  assert.ok(!String(tables.rows[0].dump).includes(KEY), "库里有密钥");
});
