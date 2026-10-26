/**
 * 路线预估（M2-02，ADR 0042）：真实接口、真实 PostgreSQL，谷歌地图是本机的假服务器（testing/fake-integrations.ts），**从不调用真实的谷歌**。
 *
 * 市场：甲在成田接送机的经济 4 座卖一口价 12,000；乙同一个车型组卖里程 + 时长（起步 3,000 含 5 公里 20 分钟，超出每公里 400、每分钟 80）。
 * 路线取到时乙更便宜、中标；取不到时乙报 ROUTE_UNAVAILABLE（带原因代码），甲照常中标——这就是降级。
 *
 * 覆盖：成功（请求的样子：密钥只在请求头、字段掩码、坐标取整、不考虑实时路况）、缓存命中与过期、同一组起终点并发只调一次、
 * 超时、429 配额、400 坐标无效（负缓存）、应答过大、每日上限、密钥变更后立即用新值（冷却按密钥记）、密钥没配、
 * 渠道询价和官网同口径的原因码、询价日志的降级原因、系统状态的最近失败、日志和应答里没有密钥。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { routeUsageDay } from "@nozomi/domain";
import { type ApiResponse, type HttpMethod, type TenantFixture, type TestApi, createTestApi } from "./testing/api.ts";
import { type FakeService, googleErrorBody, googleRouteBody, startFakeGoogleRoutes } from "./testing/fake-integrations.ts";
import { FAKE_SECRETS } from "./testing/fixtures.ts";
import { type Market, buildMarket, ok, salesCredentials, newChannel } from "./testing/market.ts";
import { GoogleRouteEstimator } from "./services/route-estimates.ts";
import { computeRoute } from "./integrations/google-maps.ts";

let api: TestApi;
let google: FakeService;
let market: Market;
let metered: string;
let salesToken: string;
/** 每个测试用不同的终点，互不命中对方的缓存 */
let nextLng = 139.1;
const freshDropoff = (): { lng: number; lat: number } => {
  nextLng += 0.01;
  return { lng: Number(nextLng.toFixed(4)), lat: 35.6 };
};
/** 运营后台填写的谷歌密钥（换一把 = 冷却清零、立即用新的） */
const adminKeys: string[] = [];
const newAdminKey = async (): Promise<string> => {
  const key = `AIzaRouteTest${randomUUID().replaceAll("-", "")}`;
  adminKeys.push(key);
  await ok(api.call("PUT", "/platform/v1/integration-secrets/google-maps", { token: market.root, body: { api_key: key } }));
  return key;
};

const platform = (method: HttpMethod, path: string, body?: unknown): Promise<ApiResponse> => api.call(method, `/platform/v1${path}`, { token: market.root, ...(body === undefined ? {} : { body }) });
const ask = (dropoff: { lng: number; lat: number }): Record<string, unknown> => ({ city_id: market.ids.tokyo, category: "airport_transfer", place_id: market.ids.narita, currency: "JPY", direction: "pickup", dropoff, service_time: "2026-10-20T10:00", passengers: 2, luggage: 1, vehicle_group_ids: [market.ids.eco4] });
const preview = (dropoff: { lng: number; lat: number }): Promise<any> => ok(platform("POST", "/quotes/preview", ask(dropoff)));
const winnerOf = (body: any): string | undefined => body.groups.find((group: any) => group.vehicle_group_id === market.ids.eco4)?.winner.product_id;
const meteredRefusal = (body: any): string | undefined => body.refused.find((entry: any) => entry.product_id === metered)?.reason;
const salesQuote = (dropoff: { lng: number; lat: number }): Promise<any> =>
  ok(api.call("POST", "/sales/v1/quotes", { token: salesToken, body: { city_id: market.ids.tokyo, category: "airport_transfer", place_id: market.ids.narita, direction: "pickup", dropoff, service_time: "2026-10-20T10:00:00+09:00", passengers: 2, luggage: 1, currency: "JPY", vehicle_group_ids: [market.ids.eco4] } }));

/** 乙的里程 + 时长商品（成田接送机，经济 4 座） */
async function meteredProduct(who: TenantFixture): Promise<string> {
  const tenant = (method: HttpMethod, path: string, body: unknown, version?: number, status = 200): Promise<any> =>
    ok(api.call(method, `/tenant/v1${path}`, { token: who.adminToken, body, headers: { ...(version === undefined ? {} : { "if-match": `"${version}"` }), ...(method === "POST" && /^\/(products|brands|areas)$|\/price-rules$/.test(path) ? { "idempotency-key": randomUUID() } : {}) } }), status);
  const brand = (await tenant("POST", "/brands", { name: "乙 里程", currency: "JPY" }, undefined, 201)).id;
  api.clock.advance(1_000);
  const area = (await tenant("POST", "/areas", { city_id: market.ids.tokyo, name: { zh: "东京里程" }, biz_type: "general", polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [[[139.0, 35.0], [140.0, 35.0], [140.0, 36.0], [139.0, 36.0], [139.0, 35.0]]] } }] }, undefined, 201)).id;
  const created = await tenant("POST", "/products", { brand_id: brand, city_id: market.ids.tokyo, category: "airport_transfer", poi_id: market.ids.narita, areas: [{ area_id: area }], vehicle_groups: [{ vehicle_group_id: market.ids.eco4, passengers: 3, luggage: 2 }], dispatchers: [{ name: "调度", phone: "0312345678" }] }, undefined, 201);
  const saved = await tenant("PUT", `/products/${created.id}/service-rules`, { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { pickup: { mode: "limited", minutes: 90 }, dropoff: { mode: "limited", minutes: 15 } } }, 1);
  const content = await tenant("PUT", `/products/${created.id}/content`, { zh: { title: "成田里程接送", pickup_guide: "到达大厅 3 号门" } }, saved.version);
  await tenant("POST", `/products/${created.id}/price-rules`, { area_id: area, vehicle_group_id: market.ids.eco4, direction: "both", valid_from: "2026-01-01", pricing_model: "mileage_time", start_price: 3_000, start_meters: 5_000, start_minutes: 20, per_km: 400, per_minute: 80 }, content.version, 201);
  await tenant("POST", `/products/${created.id}/publish`, undefined);
  return created.id;
}

before(async () => {
  google = await startFakeGoogleRoutes();
  api = await createTestApi({ env: { GOOGLE_MAPS_ROUTES_URL: google.url }, integrationSecretsTtlMs: 0 });
  market = await buildMarket(api);
  metered = await meteredProduct(market.b);
  const channel = await newChannel(api, market.staff.cm1.token, { name: "路线测试渠道" });
  salesToken = (await salesCredentials(api, market, channel.id)).token;
});
after(async () => {
  await api.close();
  await google.close();
});

test("成功：调一次谷歌（密钥只在请求头、只要里程和时长、坐标取整、不考虑实时路况），里程 + 时长的商品按预估报价并中标", async () => {
  google.respond({ body: googleRouteBody(6_800, 1_085) });
  google.requests.length = 0;
  const body = await preview({ lng: 139.70004, lat: 35.60004 });
  assert.equal(google.requests.length, 1);
  const [request] = google.requests as [FakeService["requests"][number]];
  assert.equal(request.headers["x-goog-api-key"], FAKE_SECRETS.googleMapsApiKey);
  assert.equal(request.headers["x-goog-fieldmask"], "routes.distanceMeters,routes.duration");
  assert.ok(!request.path.includes(FAKE_SECRETS.googleMapsApiKey) && !request.body.includes(FAKE_SECRETS.googleMapsApiKey));
  const sent = JSON.parse(request.body);
  assert.deepEqual([sent.origin.location.latLng, sent.destination.location.latLng, sent.travelMode, sent.routingPreference], [{ latitude: 35.769, longitude: 140.389 }, { latitude: 35.6, longitude: 139.7 }, "DRIVE", "TRAFFIC_UNAWARE"]);
  // 1,085 秒四舍五入是 18 分钟：3,000 + 1.8 公里 × 400 = 3,720（时长没超起步的 20 分钟）
  assert.deepEqual(body.route, { meters: 6_800, minutes: 18 });
  assert.deepEqual(body.route_status, { status: "ok", source: "google", code: null, message: null });
  assert.equal(winnerOf(body), metered);
  assert.equal(body.groups[0].winner.settlement, 3_720);
});

test("缓存：同一组起终点（取整后相同）再问不调谷歌；过了 7 天过期，再问调一次", async () => {
  google.respond({ body: googleRouteBody(9_000, 1_500) });
  const dropoff = freshDropoff();
  google.requests.length = 0;
  assert.equal((await preview(dropoff)).route_status.source, "google");
  const again = await preview({ lng: dropoff.lng + 0.0002, lat: dropoff.lat - 0.0002 });
  assert.deepEqual([again.route_status.source, again.route, google.requests.length], ["cache", { meters: 9_000, minutes: 25 }, 1]);
  const row = (await api.db.owner.query("select cache_key, distance_meters, duration_seconds, failure_code, expires_at - fetched_at as ttl from route_estimates where cache_key like $1", [`%>35.600,${dropoff.lng.toFixed(3)}`])).rows[0];
  assert.deepEqual([row.distance_meters, row.duration_seconds, row.failure_code, row.ttl.days], [9_000, 1_500, null, 7]);
  // 到期：把这一行的过期时间拨到现在（拨动时钟 7 天会让登录过期），过期的当作没有
  await api.db.owner.query("update route_estimates set fetched_at = $2::timestamptz - interval '7 days', expires_at = $2 where cache_key = $1", [row.cache_key, api.clock.now()]);
  google.respond({ body: googleRouteBody(9_100, 1_500) });
  const expired = await preview(dropoff);
  assert.deepEqual([expired.route_status.source, expired.route.meters, google.requests.length], ["google", 9_100, 2]);
});

test("同一组起终点并发：十个询价同时到，只调一次谷歌，十个都拿到同一条路线", async () => {
  google.respond({ body: googleRouteBody(12_000, 1_800), delayMs: 300 });
  const dropoff = freshDropoff();
  google.requests.length = 0;
  const bodies = await Promise.all(Array.from({ length: 10 }, () => preview(dropoff)));
  assert.equal(google.requests.length, 1);
  for (const body of bodies) assert.deepEqual(body.route, { meters: 12_000, minutes: 30 });
});

test("超时：谷歌一直不应答，询价在时限内返回（不是 500），里程计价的报 ROUTE_UNAVAILABLE（原因 TIMEOUT），一口价照常中标；之后同一把密钥冷却，不再等", async () => {
  await newAdminKey();
  google.respond({ body: googleRouteBody(1, 1), delayMs: 5_000 });
  google.requests.length = 0;
  const started = performance.now();
  const body = await preview(freshDropoff());
  assert.ok(performance.now() - started < 2_500, `用了 ${performance.now() - started} 毫秒`);
  assert.deepEqual([body.route, body.route_status.status, body.route_status.code, meteredRefusal(body), winnerOf(body)], [null, "unavailable", "TIMEOUT", "ROUTE_UNAVAILABLE", market.ids.pa]);
  const tried = google.requests.length;
  assert.ok(tried >= 1 && tried <= 2, `试了 ${tried} 次`);
  const cooled = await preview(freshDropoff());
  assert.deepEqual([cooled.route_status.code, google.requests.length], ["TIMEOUT", tried]);
});

test("429 配额：QUOTA_EXCEEDED，不重试；系统状态里看得到最近一次失败；换一把密钥（运营后台）立即用新的、冷却不跟过去", async () => {
  const first = await newAdminKey();
  google.respond({ status: 429, body: googleErrorBody(429, "RESOURCE_EXHAUSTED", "RATE_LIMIT_EXCEEDED") });
  google.requests.length = 0;
  const body = await preview(freshDropoff());
  assert.deepEqual([body.route_status.code, meteredRefusal(body), google.requests.length], ["QUOTA_EXCEEDED", "ROUTE_UNAVAILABLE", 1]);
  assert.equal(google.requests[0]?.headers["x-goog-api-key"], first);
  assert.match(body.route_status.message, /用量/);
  const status = (await ok(platform("GET", "/integrations"))).routes;
  assert.equal(status.last_failure.code, "QUOTA_EXCEEDED");
  assert.equal(status.last_failure.at, api.clock.now().toISOString());
  assert.ok(status.failures >= 1);
  // 冷却中：不再调用
  assert.deepEqual([(await preview(freshDropoff())).route_status.code, google.requests.length], ["QUOTA_EXCEEDED", 1]);
  // 换了密钥：下一次询价就用新的
  const second = await newAdminKey();
  google.respond({ body: googleRouteBody(7_000, 1_200) });
  const recovered = await preview(freshDropoff());
  assert.deepEqual([recovered.route_status.status, google.requests.length, google.requests[1]?.headers["x-goog-api-key"]], ["ok", 2, second]);
  assert.ok((await ok(platform("GET", "/integrations"))).routes.last_success_at !== null);
});

test("400 坐标无效：INVALID_POINTS；只跟这组点有关，存 1 天负缓存（同一组再问不花钱），别的点照常", async () => {
  await newAdminKey();
  google.respond({ status: 400, body: googleErrorBody(400, "INVALID_ARGUMENT", null) });
  const bad = freshDropoff();
  google.requests.length = 0;
  const body = await preview(bad);
  assert.deepEqual([body.route_status.code, meteredRefusal(body), google.requests.length], ["INVALID_POINTS", "ROUTE_UNAVAILABLE", 1]);
  const again = await preview(bad);
  assert.deepEqual([again.route_status.code, google.requests.length], ["INVALID_POINTS", 1]);
  const row = (await api.db.owner.query("select failure_code, expires_at - fetched_at as ttl from route_estimates where cache_key like $1", [`%>35.600,${bad.lng.toFixed(3)}`])).rows[0];
  assert.deepEqual([row.failure_code, row.ttl.days], ["INVALID_POINTS", 1]);
  // 渠道看到的是面向客人的原因：没有路线
  const sales = await salesQuote(bad);
  assert.deepEqual(sales.unavailable, []);
  assert.equal(sales.quotes[0].vehicle_group_id, market.ids.eco4);
  google.respond({ body: googleRouteBody(5_000, 600) });
  assert.equal((await preview(freshDropoff())).route_status.status, "ok");
});

test("应答过大（超过 64 KB）：只读前 64 KB，当作看不懂（UNEXPECTED），不缓存", async () => {
  await newAdminKey();
  google.respond({ body: { ...(googleRouteBody(1_000, 100) as object), echo: "x".repeat(200 * 1024) } });
  const dropoff = freshDropoff();
  const body = await preview(dropoff);
  assert.deepEqual([body.route_status.code, meteredRefusal(body)], ["UNEXPECTED", "ROUTE_UNAVAILABLE"]);
  assert.equal((await api.db.owner.query("select count(*)::int as n from route_estimates where cache_key like $1", [`%>35.600,${dropoff.lng.toFixed(3)}`])).rows[0].n, 0);
});

test("渠道询价：谷歌不可用时降级——甲的一口价照常报出，询价日志记下降级原因；成功时日志记来源和里程时长", async () => {
  await newAdminKey();
  google.respond({ status: 503, body: {} });
  const failing = freshDropoff();
  const failed = await salesQuote(failing);
  // 甲的一口价照常报出（降级只影响里程计价的商品）
  assert.equal(failed.quotes.length, 1);
  const logOf = async (dropoff: { lng: number }): Promise<any> => (await api.db.owner.query("select route, rejects from quote_logs where (request->'dropoff'->>'lng')::numeric = $1", [dropoff.lng])).rows[0];
  const failLog = await logOf(failing);
  assert.deepEqual(failLog.route, { status: "unavailable", code: "UNAVAILABLE" });
  assert.ok(failLog.rejects.some((entry: any) => entry.product_id === metered && entry.reason === "ROUTE_UNAVAILABLE"));
  await newAdminKey();
  google.respond({ body: googleRouteBody(6_000, 900) });
  const succeeding = freshDropoff();
  await salesQuote(succeeding);
  const okLog = await logOf(succeeding);
  assert.deepEqual(okLog.route, { status: "ok", source: "google", meters: 6_000, minutes: 15 });
});

test("渠道和官网只看到面向客人的原因：甲的一口价下架后只剩里程商品，谷歌不可用 → TEMPORARILY_UNAVAILABLE，没有路线 → NO_ROUTE；不出现密钥、配额这些内部原因", async () => {
  await ok(api.call("POST", `/tenant/v1/products/${market.ids.pa}/unpublish`, { token: market.a.adminToken }));
  // 渠道询价用 30 秒的商品目录缓存（ADR 0020）：等它过期
  api.clock.advance(31_000);
  try {
    await newAdminKey();
    google.respond({ status: 403, body: googleErrorBody(403, "PERMISSION_DENIED", "BILLING_DISABLED") });
    const res = await api.call("POST", "/sales/v1/quotes", { token: salesToken, body: { city_id: market.ids.tokyo, category: "airport_transfer", place_id: market.ids.narita, direction: "pickup", dropoff: freshDropoff(), service_time: "2026-10-20T10:00:00+09:00", passengers: 2, luggage: 1, currency: "JPY", vehicle_group_ids: [market.ids.eco4] } });
    assert.equal(res.status, 200, res.text);
    // 乙另一个商品没有经济 4 座，那一条是原来就有的 NOT_AVAILABLE
    assert.deepEqual(res.body.unavailable, [{ vehicle_group_id: market.ids.eco4, reasons: ["NOT_AVAILABLE", "TEMPORARILY_UNAVAILABLE"] }]);
    assert.doesNotMatch(res.text, /BILLING|KEY_|QUOTA/);
    await newAdminKey();
    google.respond({ body: {} });
    const none = await salesQuote(freshDropoff());
    assert.deepEqual(none.unavailable, [{ vehicle_group_id: market.ids.eco4, reasons: ["NOT_AVAILABLE", "NO_ROUTE"] }]);
  } finally {
    await ok(api.call("POST", `/tenant/v1/products/${market.ids.pa}/publish`, { token: market.a.adminToken }));
    api.clock.advance(31_000);
  }
});

test("供应商试算：取不到路线时只给 TEMPORARILY_UNAVAILABLE / NO_ROUTE，不告诉供应商平台的密钥、配额问题", async () => {
  await newAdminKey();
  google.respond({ status: 429, body: googleErrorBody(429, "RESOURCE_EXHAUSTED", null) });
  const res = await api.call("POST", `/tenant/v1/products/${metered}/quote-preview`, { token: market.b.adminToken, body: { direction: "pickup", dropoff: freshDropoff(), service_time: "2026-10-20T10:00", passengers: 2, luggage: 1 } });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual([res.body.route_status.status, res.body.route_status.code, res.body.refused[0].reason], ["unavailable", "TEMPORARILY_UNAVAILABLE", "ROUTE_UNAVAILABLE"]);
  assert.doesNotMatch(res.text, /QUOTA|KEY_|用量/);
});

test("每日上限：今天的调用到了上限就不再调用（DAILY_LIMIT_REACHED），记一次被挡下；系统状态标出；东京时间第二天恢复", async () => {
  await newAdminKey();
  google.respond({ body: googleRouteBody(4_000, 500) });
  const day = routeUsageDay(api.clock.now());
  await api.db.owner.query("insert into route_api_usage (day, calls) values ($1, 1000) on conflict (day) do update set calls = 1000", [day]);
  google.requests.length = 0;
  const body = await preview(freshDropoff());
  assert.deepEqual([body.route_status.code, meteredRefusal(body), winnerOf(body), google.requests.length], ["DAILY_LIMIT_REACHED", "ROUTE_UNAVAILABLE", market.ids.pa, 0]);
  const status = (await ok(platform("GET", "/integrations"))).routes;
  assert.deepEqual([status.day, status.calls, status.daily_limit, status.daily_limit_reached, status.refused >= 1], [day, 1_000, 1_000, true, true]);
  // 第二天（东京时间 0 点之后），换一把密钥免得等冷却
  const now = api.clock.now();
  const nextMidnight = new Date(`${day}T15:00:00.000Z`).getTime() + 1_000;
  api.clock.advance(Math.max(nextMidnight - now.getTime(), 24 * 3_600_000));
  market.root = await api.superAdminToken("routes-next-day@platform.test");
  await newAdminKey();
  const next = await preview(freshDropoff());
  assert.deepEqual([next.route_status.status, google.requests.length], ["ok", 1]);
  const usage = (await api.db.owner.query("select calls from route_api_usage where day = $1", [routeUsageDay(api.clock.now())])).rows[0];
  assert.equal(usage.calls, 1);
});

test("每日上限的计数在并发下不超：上限 3 时 8 组不同的起终点同时问，只发出 3 次请求", async () => {
  google.respond({ body: googleRouteBody(4_000, 500), delayMs: 50 });
  google.requests.length = 0;
  const estimator = new GoogleRouteEstimator({
    pool: api.db.pool,
    now: () => new Date("2027-01-15T03:00:00.000Z"),
    apiKey: () => "AIzaConcurrentLimitKey0000000001",
    dailyLimit: 3,
    compute: (key, from, to, beforeAttempt) => computeRoute(key, from, to, { url: google.url, beforeAttempt }),
    log: { warn: () => undefined },
  });
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => estimator.estimate({ from: { lat: 35.5, lng: 139.5 }, to: { lat: 35.7, lng: 139.3 + i * 0.01 } })));
  assert.equal(results.filter((result) => result.ok).length, 3);
  assert.equal(results.filter((result) => !result.ok && result.code === "DAILY_LIMIT_REACHED").length, 5);
  assert.equal(google.requests.length, 3);
  const usage = (await api.db.owner.query("select calls, refused from route_api_usage where day = '2027-01-15'")).rows[0];
  assert.deepEqual([usage.calls, usage.refused], [3, 5]);
});

test("密钥没配：NOT_CONFIGURED，不调用谷歌；起终点取整后是同一个点：里程时长按 0、不调用", async () => {
  google.requests.length = 0;
  const estimator = new GoogleRouteEstimator({ pool: api.db.pool, now: api.clock.now, apiKey: () => null, dailyLimit: 1_000, compute: (key, from, to, beforeAttempt) => computeRoute(key, from, to, { url: google.url, beforeAttempt }), log: { warn: () => undefined } });
  assert.deepEqual(await estimator.estimate({ from: { lat: 35.11, lng: 139.11 }, to: { lat: 35.22, lng: 139.22 } }), { ok: false, code: "NOT_CONFIGURED" });
  assert.deepEqual(await estimator.estimate({ from: { lat: 35.11001, lng: 139.11001 }, to: { lat: 35.10999, lng: 139.10999 } }), { ok: true, route: { meters: 0, minutes: 0 }, source: "same_point" });
  assert.equal(google.requests.length, 0);
});

test("日志、应答、库里都没有谷歌密钥原文（配置文件的和运营后台填写的）", async () => {
  const logs = api.logs();
  assert.ok(logs.includes("路线预估取不到"), "失败时记了日志");
  const status = await platform("GET", "/integrations");
  const cached = (await api.db.owner.query("select * from route_estimates")).rows;
  const usage = (await api.db.owner.query("select * from route_api_usage")).rows;
  const quoteLogs = (await api.db.owner.query("select route from quote_logs")).rows;
  for (const key of [FAKE_SECRETS.googleMapsApiKey, ...adminKeys]) {
    for (const [name, text] of [["日志", logs], ["系统状态", status.text], ["缓存", JSON.stringify(cached)], ["计数", JSON.stringify(usage)], ["询价日志", JSON.stringify(quoteLogs)]] as const) assert.ok(!text.includes(key), `${name}里有密钥`);
  }
});
