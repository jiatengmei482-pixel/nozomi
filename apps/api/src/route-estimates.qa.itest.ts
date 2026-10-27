/**
 * 路线预估（M2-02，ADR 0042）测试角色补充：真实接口、真实 PostgreSQL，谷歌地图是本文件里的本机假服务器，**从不调用真实的谷歌**
 * （服务进程的密钥配置为空，只用运营后台填写的假密钥；地址指向本机）。
 *
 * - 计价：路线 → 价格和独立手算一致（米不凑整、秒四舍五入到分钟、总价按 money.ts 四舍五入）；同一个格子按 0；A → B 和 B → A 分开缓存。
 * - 缓存：7 天 / 1 天过期按毫秒的边界、过期后重新调用并覆盖、清理过期行最多 100 行；同一组并发只调一次（含失败、含格子内不同的原始坐标）。
 * - 冷却：60 秒 / 15 秒的边界（单调时钟）、不冷却的原因、换密钥立即生效、冷却中缓存照常可用。
 * - 每日上限：东京日期跨午夜、并发含重试不超、上限 0 不调用、记不了数不调用（UNAVAILABLE）。
 * - 降级：14 个原因码各自的谷歌应答 / 网络情况 → 平台完整码、供应商两种、渠道和官网两种客人原因；一口价照常；没有 500；询价日志有原因。
 * - 安全：请求只带要的字段、密钥只在请求头；所有应答、日志、全部表按值比对都没有密钥原文（谷歌错误应答里回显了密钥也一样）；
 *   跳转不跟随（跳到能用的地址也不去）、超大应答读到 64 KB 就停（对方不结束也不等）；系统状态的 routes 只给有 integration.read 的平台员工。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type IncomingHttpHeaders, type Server, createServer } from "node:http";
import { type LatLng, ROUTE_FAILURE_CODES, ROUTE_FAILURE_MESSAGES, type RouteFailureCode, guestRouteReason, routeCacheKey, routeUsageDay } from "@nozomi/domain";
import type { Pool } from "./db/pool.ts";
import { type ComputedRoute, computeRoute } from "./integrations/google-maps.ts";
import { GoogleRouteEstimator } from "./services/route-estimates.ts";
import { type ApiResponse, type HttpMethod, type TenantFixture, type TestApi, createTestApi } from "./testing/api.ts";
import { type Market, addStaff, allValues, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

// ---- 本机假谷歌：每个请求按测试给的规则应答（状态、JSON、原文、延迟、跳转、断开、超大且不结束） ----

interface Seen {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
}
interface Behavior {
  status?: number;
  body?: unknown;
  /** 原样写出的应答体（不是 JSON） */
  raw?: string;
  delayMs?: number;
  headers?: Record<string, string>;
  /** 读完请求就断开连接（连不上） */
  destroy?: boolean;
  /** 先写这么多字节，然后既不结束也不断开 */
  hangAfterBytes?: number;
}

let server: Server;
let googleUrl = "";
const seen: Seen[] = [];
let behave: (request: Seen) => Behavior = () => ({ body: route(6_800, 1_080) });

const route = (meters: number, seconds: number | string): unknown => ({ routes: [{ distanceMeters: meters, duration: typeof seconds === "string" ? seconds : `${seconds}s` }] });
/** 谷歌的错误应答；message 里故意回显请求用的密钥，核对它不会被转述到任何地方 */
const googleError = (code: number, status: string, reason: string | null, echo: string): unknown => ({
  error: { code, message: `API key ${echo} rejected`, status, details: reason === null ? [] : [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason, domain: "googleapis.com", metadata: { key: echo } }] },
});

async function startGoogle(): Promise<void> {
  server = createServer((request, response) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => (raw += chunk));
    request.on("end", () => {
      const entry: Seen = { method: request.method ?? "", path: request.url ?? "", headers: request.headers, body: raw };
      seen.push(entry);
      const reply = behave(entry);
      if (reply.destroy) {
        request.socket.destroy();
        return;
      }
      const send = (): void => {
        if (response.destroyed) return;
        response.writeHead(reply.status ?? 200, { "content-type": "application/json", ...reply.headers });
        if (reply.hangAfterBytes !== undefined) {
          response.write("{\"routes\":[{\"distanceMeters\":1,\"duration\":\"1s\"}],\"pad\":\"" + "x".repeat(reply.hangAfterBytes));
          return;
        }
        response.end(reply.raw ?? JSON.stringify(reply.body ?? {}));
      };
      if (reply.delayMs) setTimeout(send, reply.delayMs).unref();
      else send();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  googleUrl = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}/directions/v2:computeRoutes`;
}

// ---- 市场：甲成田经济 4 座一口价 12,000（market 自带）；乙同组里程 + 时长（起步 3,000 含 5 公里 20 分钟，超出每公里 333、每分钟 55，不设最低消费） ----

let api: TestApi;
let market: Market;
let metered: string;
let salesToken: string;
let siteClientId: string;
let tech: string;
const NARITA = { lng: 140.3887, lat: 35.7686 };
const adminKeys: string[] = [];
/** 测试里收到的每个应答原文（最后统一核对没有密钥） */
const responses: ApiResponse[] = [];

let nextLng = 139.2;
const freshDropoff = (): { lng: number; lat: number } => {
  nextLng += 0.01;
  return { lng: Number(nextLng.toFixed(4)), lat: 35.55 };
};

const call = async (method: HttpMethod, url: string, options: Parameters<TestApi["call"]>[2] = {}): Promise<ApiResponse> => {
  const res = await api.call(method, url, options);
  responses.push(res);
  return res;
};
const newAdminKey = async (): Promise<string> => {
  const key = `AIzaQaRoute${randomUUID().replaceAll("-", "")}`;
  adminKeys.push(key);
  await ok(call("PUT", "/platform/v1/integration-secrets/google-maps", { token: market.root, body: { api_key: key } }));
  return key;
};
const clearAdminKey = async (): Promise<void> => {
  await ok(call("DELETE", "/platform/v1/integration-secrets/google-maps", { token: market.root }));
};
const currentKey = (): string => adminKeys[adminKeys.length - 1] as string;

const platformPreview = (dropoff: LatLng, direction: "pickup" | "dropoff" = "pickup"): Promise<ApiResponse> =>
  call("POST", "/platform/v1/quotes/preview", { token: market.root, body: { city_id: market.ids.tokyo, category: "airport_transfer", place_id: market.ids.narita, currency: "JPY", direction, [direction === "pickup" ? "dropoff" : "pickup"]: dropoff, service_time: "2026-10-20T10:00", passengers: 2, luggage: 1, vehicle_group_ids: [market.ids.eco4] } });
const tenantPreview = (dropoff: LatLng, direction: "pickup" | "dropoff" = "pickup"): Promise<ApiResponse> =>
  call("POST", `/tenant/v1/products/${metered}/quote-preview`, { token: market.b.adminToken, body: { direction, [direction === "pickup" ? "dropoff" : "pickup"]: dropoff, service_time: "2026-10-20T10:00", passengers: 2, luggage: 1 } });
const salesQuote = (dropoff: LatLng): Promise<ApiResponse> =>
  call("POST", "/sales/v1/quotes", { token: salesToken, body: { city_id: market.ids.tokyo, category: "airport_transfer", place_id: market.ids.narita, direction: "pickup", dropoff, service_time: "2026-10-20T10:00:00+09:00", passengers: 2, luggage: 1, currency: "JPY", vehicle_group_ids: [market.ids.eco4] } });
const meteredTotal = (body: any): number | undefined => body.offers.find((offer: any) => offer.vehicle_group_id === market.ids.eco4)?.settlement.total;
const winnerOf = (body: any): any => body.groups.find((group: any) => group.vehicle_group_id === market.ids.eco4)?.winner;
const quoteLogRoute = async (dropoff: LatLng): Promise<any> => (await api.db.owner.query("select route from quote_logs where (request->'dropoff'->>'lng')::numeric = $1 order by created_at desc limit 1", [dropoff.lng])).rows[0]?.route;

async function meteredProduct(who: TenantFixture): Promise<string> {
  const tenant = (method: HttpMethod, path: string, body: unknown, version?: number, status = 200): Promise<any> =>
    ok(call(method, `/tenant/v1${path}`, { token: who.adminToken, body, headers: { ...(version === undefined ? {} : { "if-match": `"${version}"` }), ...(method === "POST" && /^\/(products|brands|areas)$|\/price-rules$/.test(path) ? { "idempotency-key": randomUUID() } : {}) } }), status);
  const brand = (await tenant("POST", "/brands", { name: "乙 里程 QA", currency: "JPY" }, undefined, 201)).id;
  api.clock.advance(1_000);
  const area = (await tenant("POST", "/areas", { city_id: market.ids.tokyo, name: { zh: "东京里程 QA" }, biz_type: "general", polygons: [{ kind: "operate", geometry: { type: "Polygon", coordinates: [[[139.0, 35.0], [141.0, 35.0], [141.0, 36.5], [139.0, 36.5], [139.0, 35.0]]] } }] }, undefined, 201)).id;
  const created = await tenant("POST", "/products", { brand_id: brand, city_id: market.ids.tokyo, category: "airport_transfer", poi_id: market.ids.narita, areas: [{ area_id: area }], vehicle_groups: [{ vehicle_group_id: market.ids.eco4, passengers: 3, luggage: 2 }], dispatchers: [{ name: "调度", phone: "0312345678" }] }, undefined, 201);
  const saved = await tenant("PUT", `/products/${created.id}/service-rules`, { booking: { service_time: { start: "00:00", end: "24:00" }, lead_time_hours: 24 }, free_wait: { pickup: { mode: "limited", minutes: 90 }, dropoff: { mode: "limited", minutes: 15 } } }, 1);
  const content = await tenant("PUT", `/products/${created.id}/content`, { zh: { title: "成田里程接送 QA", pickup_guide: "到达大厅 3 号门" } }, saved.version);
  await tenant("POST", `/products/${created.id}/price-rules`, { area_id: area, vehicle_group_id: market.ids.eco4, direction: "both", valid_from: "2026-01-01", pricing_model: "mileage_time", start_price: 3_000, start_meters: 5_000, start_minutes: 20, per_km: 333, per_minute: 55 }, content.version, 201);
  await tenant("POST", `/products/${created.id}/publish`, undefined);
  return created.id;
}

before(async () => {
  await startGoogle();
  // 服务进程的谷歌密钥为空：只有运营后台填写的（假）密钥，删掉就是「没有配置」
  api = await createTestApi({ env: { GOOGLE_MAPS_ROUTES_URL: googleUrl, GOOGLE_MAPS_API_KEY: "" }, integrationSecretsTtlMs: 0 });
  market = await buildMarket(api);
  metered = await meteredProduct(market.b);
  const channel = await newChannel(api, market.staff.cm1.token, { name: "路线 QA 渠道" });
  salesToken = (await salesCredentials(api, market, channel.id)).token;
  const siteChannel = await newChannel(api, market.staff.cm1.token, { name: "NOZOMI 官网 QA" });
  siteClientId = (await salesCredentials(api, market, siteChannel.id, "198.51.100.11")).clientId;
  tech = (await addStaff(api, market.root, "tech@platform.test", "tech")).token;
  await newAdminKey();
});
after(async () => {
  await api.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ---- 计价 ----

test("计价：谷歌的里程（米）和时长（秒）→ 结算价，和手算一致（超出的米不凑整、秒四舍五入到分钟、总价四舍五入到 1 日元）", async () => {
  // 手算：3,000 + max(0, 米 − 5,000) × 333 / 1,000 + max(0, 分钟 − 20) × 55，最后四舍五入（.5 进）
  const cases: [meters: number | undefined, duration: string, minutes: number, total: number][] = [
    [6_500, "1199s", 20, 3_500], // 1,500 米 × 0.333 = 499.5 → 进位；19 分 59 秒 → 20 分钟，不超
    [6_499, "1230s", 21, 3_554], // 499.167 + 55 = 554.167 → 3,554；20 分 30 秒 → 21 分钟
    [5_000, "1229s", 20, 3_000], // 正好起步里程；20 分 29 秒 → 20 分钟
    [5_001, "1229s", 20, 3_000], // 0.333 → 舍
    [5_002, "1229s", 20, 3_001], // 0.666 → 进
    [undefined, "0s", 0, 3_000], // 谷歌省略 distanceMeters = 0 米
    [5_000, "1229.9s", 20, 3_000], // 带小数的秒取整秒：20 分 29.9 秒仍是 20 分钟
    [20_000, "3600s", 60, 3_000 + 4_995 + 2_200], // 15 公里 × 333 = 4,995；超 40 分钟 × 55 = 2,200
  ];
  for (const [meters, duration, minutes, total] of cases) {
    behave = () => ({ body: { routes: [{ ...(meters === undefined ? {} : { distanceMeters: meters }), duration }] } });
    const dropoff = freshDropoff();
    const res = await tenantPreview(dropoff);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.rounding_unit, 1);
    assert.deepEqual([res.body.route, res.body.route_status.source, meteredTotal(res.body)], [{ meters: meters ?? 0, minutes }, "google", total], `${meters} 米 ${duration}`);
    // 平台试算同一组点走缓存，同一个价（乙比甲的 12,000 便宜，中标）
    const platform = await platformPreview(dropoff);
    assert.deepEqual([platform.body.route_status.source, winnerOf(platform.body)?.product_id, winnerOf(platform.body)?.settlement], ["cache", metered, total], `${meters} 米 ${duration}`);
  }
});

test("同一个格子：起终点取整后重合（接机，终点就在机场边上）→ 不调用谷歌，里程时长按 0，收起步价；跨过格子边界哪怕只差几米也要调用", async () => {
  seen.length = 0;
  const res = await tenantPreview({ lng: 140.3889, lat: 35.7688 });
  assert.equal(res.status, 200, res.text);
  assert.deepEqual([res.body.route, res.body.route_status, meteredTotal(res.body), seen.length], [{ meters: 0, minutes: 0 }, { status: "ok", source: "same_point", code: null, message: null }, 3_000, 0]);
  // 35.7686 → 35.769；35.76849 → 35.768：相距约 12 米，但是两个格子
  behave = () => ({ body: route(150, 40) });
  const near = await tenantPreview({ lng: 140.3887, lat: 35.76849 });
  assert.deepEqual([near.body.route_status.source, near.body.route, seen.length], ["google", { meters: 150, minutes: 1 }, 1]);
});

test("方向：接机（机场 → 地址）和送机（地址 → 机场）分开缓存、分开调用，价格各按各的路线；再问同一个方向走缓存", async () => {
  const dropoff = freshDropoff();
  const key = routeCacheKey(NARITA, dropoff);
  const reverse = routeCacheKey(dropoff, NARITA);
  // 假谷歌按起点给不同的路线：从机场出发 60 公里，往机场去 62 公里
  behave = (request) => {
    const body = JSON.parse(request.body);
    return { body: body.origin.location.latLng.latitude === key.from.lat ? route(60_000, 3_600) : route(62_000, 3_900) };
  };
  seen.length = 0;
  const pickup = await tenantPreview(dropoff, "pickup");
  const drop = await tenantPreview(dropoff, "dropoff");
  assert.equal(seen.length, 2);
  assert.deepEqual([JSON.parse((seen[0] as Seen).body).origin.location.latLng, JSON.parse((seen[1] as Seen).body).origin.location.latLng], [{ latitude: key.from.lat, longitude: key.from.lng }, { latitude: reverse.from.lat, longitude: reverse.from.lng }]);
  // 接机：55 公里 × 333 = 18,315；超 40 分钟 × 55 = 2,200 → 23,515。送机：57 公里 × 333 = 18,981；超 45 分钟 × 55 = 2,475 → 24,456
  assert.deepEqual([pickup.body.route, meteredTotal(pickup.body), drop.body.route, meteredTotal(drop.body)], [{ meters: 60_000, minutes: 60 }, 23_515, { meters: 62_000, minutes: 65 }, 24_456]);
  const rows = (await api.db.owner.query("select cache_key, distance_meters from route_estimates where cache_key = any($1) order by distance_meters", [[key.key, reverse.key]])).rows;
  assert.deepEqual(rows.map((row) => [row.cache_key, row.distance_meters]), [[key.key, 60_000], [reverse.key, 62_000]]);
  const again = await tenantPreview(dropoff, "dropoff");
  assert.deepEqual([again.body.route_status.source, again.body.route.meters, seen.length], ["cache", 62_000, 2]);
});

// ---- 缓存、并发、冷却、每日上限（直接用 GoogleRouteEstimator：真实的库，时钟可控） ----

type Compute = (apiKey: string, from: LatLng, to: LatLng, beforeAttempt: () => Promise<boolean>) => Promise<ComputedRoute>;
const warnings: { obj: object; msg: string }[] = [];
/** 这些测试用 2030 年的时钟：结束后删掉它们写的缓存和计数（不然「最近一次失败」按日期排在今天前面） */
async function cleanupFuture(): Promise<void> {
  await api.db.owner.query("delete from route_api_usage where day >= '2030-01-01'");
  await api.db.owner.query("delete from route_estimates where fetched_at >= '2030-01-01'");
}
function estimator(options: { now: () => Date; compute: Compute; apiKey?: () => string | null; dailyLimit?: number; pool?: Pool }): GoogleRouteEstimator {
  return new GoogleRouteEstimator({ pool: options.pool ?? api.db.pool, now: options.now, apiKey: options.apiKey ?? (() => "AIzaQaEstimatorKey000000000000001"), dailyLimit: options.dailyLimit ?? 1_000, compute: options.compute, log: { warn: (obj, msg) => void warnings.push({ obj, msg }) } });
}
/** 不联网的谷歌替身：记下调用次数，按 `next` 给结果；照真实实现，发请求前先占名额 */
function countingCompute(next: () => ComputedRoute, delayMs = 0): { compute: Compute; calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    compute: async (_key, _from, _to, beforeAttempt) => {
      if (!(await beforeAttempt())) return { ok: false, code: "DAILY_LIMIT_REACHED" };
      calls++;
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return next();
    },
  };
}

test("缓存过期按毫秒：成功的 7 天减 1 毫秒还命中、正好 7 天就过期重新调用并覆盖；没有路线 / 坐标无效的 1 天同理", async (t) => {
  t.after(cleanupFuture);
  const t0 = new Date("2030-03-10T05:00:00.000Z").getTime();
  let now = t0;
  let result: ComputedRoute = { ok: true, meters: 8_000, seconds: 900 };
  const google = countingCompute(() => result);
  const routes = estimator({ now: () => new Date(now), compute: google.compute });
  const ab = { from: { lat: 34.11, lng: 135.11 }, to: { lat: 34.21, lng: 135.21 } };
  assert.deepEqual(await routes.estimate(ab), { ok: true, route: { meters: 8_000, minutes: 15 }, source: "google" });
  now = t0 + 7 * 86_400_000 - 1;
  assert.deepEqual([(await routes.estimate(ab)).ok, google.calls()], [true, 1]);
  assert.equal(((await routes.estimate(ab)) as any).source, "cache");
  now = t0 + 7 * 86_400_000;
  result = { ok: true, meters: 8_200, seconds: 960 };
  assert.deepEqual(await routes.estimate(ab), { ok: true, route: { meters: 8_200, minutes: 16 }, source: "google" });
  assert.equal(google.calls(), 2);
  const row = (await api.db.owner.query("select distance_meters, fetched_at, expires_at from route_estimates where cache_key = $1", [routeCacheKey(ab.from, ab.to).key])).rows[0];
  assert.deepEqual([row.distance_meters, row.fetched_at.getTime(), row.expires_at.getTime() - row.fetched_at.getTime()], [8_200, now, 604_800_000]);

  for (const code of ["NO_ROUTE", "INVALID_POINTS"] as const) {
    now = t0;
    result = { ok: false, code };
    const before = google.calls();
    const pair = { from: { lat: 34.31, lng: 135.31 }, to: { lat: 34.41, lng: code === "NO_ROUTE" ? 135.41 : 135.51 } };
    assert.deepEqual(await routes.estimate(pair), { ok: false, code });
    now = t0 + 86_400_000 - 1;
    assert.deepEqual([await routes.estimate(pair), google.calls() - before], [{ ok: false, code }, 1]);
    now = t0 + 86_400_000;
    result = { ok: true, meters: 1_000, seconds: 60 };
    assert.deepEqual([(await routes.estimate(pair)).ok, google.calls() - before], [true, 2]);
  }
});

test("其他失败不进缓存：超时、配额、看不懂之后同一组点（换了密钥、不在冷却）会再问", async (t) => {
  t.after(cleanupFuture);
  let key = "AIzaQaNoNegativeCache00000000001";
  let result: ComputedRoute = { ok: false, code: "UNAVAILABLE" };
  const google = countingCompute(() => result);
  const routes = estimator({ now: () => new Date("2030-04-01T00:00:00.000Z"), compute: google.compute, apiKey: () => key });
  const pair = { from: { lat: 33.1, lng: 130.1 }, to: { lat: 33.2, lng: 130.2 } };
  for (const code of ["TIMEOUT", "QUOTA_EXCEEDED", "UNEXPECTED", "KEY_INVALID"] as const) {
    result = { ok: false, code };
    key = `AIzaQaNoNegativeCache${code}`;
    assert.deepEqual(await routes.estimate(pair), { ok: false, code });
  }
  assert.equal(google.calls(), 4);
  assert.equal((await api.db.owner.query("select count(*)::int as n from route_estimates where cache_key = $1", [routeCacheKey(pair.from, pair.to).key])).rows[0].n, 0);
});

test("写缓存时顺手清理：过期一天以上的行每次最多删 100 行，过期不到一天的留着", async (t) => {
  t.after(cleanupFuture);
  const at = new Date("2030-05-01T00:00:00.000Z");
  const cutoff = new Date(at.getTime() - 86_400_000);
  await api.db.owner.query(
    `insert into route_estimates (cache_key, distance_meters, duration_seconds, fetched_at, expires_at)
     select format('v1:%s.000,1.000>2.000,2.000', g), 1, 1, $1::timestamptz - interval '1 day', $1 from generate_series(101, 250) g`,
    [new Date(cutoff.getTime() - 1)],
  );
  await api.db.owner.query("insert into route_estimates (cache_key, distance_meters, duration_seconds, fetched_at, expires_at) values ('v1:99.000,1.000>2.000,2.000', 1, 1, $1::timestamptz - interval '1 day', $1)", [new Date(cutoff.getTime() + 1)]);
  const countOld = async (): Promise<number> => (await api.db.owner.query("select count(*)::int as n from route_estimates where expires_at < $1", [cutoff])).rows[0].n;
  const before = await countOld();
  assert.ok(before >= 150);
  const google = countingCompute(() => ({ ok: true, meters: 1, seconds: 1 }));
  await estimator({ now: () => at, compute: google.compute }).estimate({ from: { lat: 32.1, lng: 131.1 }, to: { lat: 32.2, lng: 131.2 } });
  assert.equal(before - (await countOld()), 100);
  assert.equal((await api.db.owner.query("select count(*)::int as n from route_estimates where cache_key = 'v1:99.000,1.000>2.000,2.000'")).rows[0].n, 1);
  await api.db.owner.query("delete from route_estimates where cache_key ~ '^v1:(99|1[0-9][0-9]|2[0-5][0-9])\\.000,1\\.000>2\\.000,2\\.000$'");
});

test("并发：同一个格子里 20 个原始坐标不同的询价同时到，只调一次；反方向是另一组，另调一次；查完以后再问走缓存", async (t) => {
  t.after(cleanupFuture);
  const google = countingCompute(() => ({ ok: true, meters: 12_345, seconds: 1_500 }), 150);
  const routes = estimator({ now: () => new Date("2030-06-01T00:00:00.000Z"), compute: google.compute });
  const a = { lat: 31.1, lng: 130.5 };
  const b = { lat: 31.3, lng: 130.7 };
  const jitter = (point: LatLng, i: number): LatLng => ({ lat: point.lat + (i % 5) * 0.0001 - 0.0002, lng: point.lng - (i % 4) * 0.0001 + 0.0001 });
  const results = await Promise.all([...Array.from({ length: 20 }, (_, i) => routes.estimate({ from: jitter(a, i), to: jitter(b, i + 1) })), routes.estimate({ from: b, to: a })]);
  assert.equal(google.calls(), 2);
  for (const result of results) assert.deepEqual(result, { ok: true, route: { meters: 12_345, minutes: 25 }, source: "google" });
  assert.deepEqual(await routes.estimate({ from: a, to: b }), { ok: true, route: { meters: 12_345, minutes: 25 }, source: "cache" });
  assert.equal(google.calls(), 2);
});

test("并发：同一组正在查时失败了，等着的都拿到同一个原因（只调一次）；不进缓存的失败查完就放开，下一次（冷却过后）会重新调用", async (t) => {
  t.after(cleanupFuture);
  let key = "AIzaQaConcurrentFailure000000001";
  const google = countingCompute(() => ({ ok: false, code: "UNAVAILABLE" }), 150);
  const routes = estimator({ now: () => new Date("2030-06-02T00:00:00.000Z"), compute: google.compute, apiKey: () => key });
  const pair = { from: { lat: 31.5, lng: 130.5 }, to: { lat: 31.6, lng: 130.6 } };
  const results = await Promise.all(Array.from({ length: 10 }, () => routes.estimate(pair)));
  assert.equal(google.calls(), 1);
  for (const result of results) assert.deepEqual(result, { ok: false, code: "UNAVAILABLE" });
  key = "AIzaQaConcurrentFailure000000002";
  await routes.estimate(pair);
  assert.equal(google.calls(), 2);
});

/** 把单调时钟（冷却用的 performance.now）换成可控的；只在不经网络的替身测试里用 */
async function withMonotonic<T>(start: number, fn: (set: (ms: number) => void) => Promise<T>): Promise<T> {
  let current = start;
  Object.defineProperty(performance, "now", { value: () => current, configurable: true, writable: true });
  try {
    return await fn((ms) => {
      current = ms;
    });
  } finally {
    delete (performance as unknown as { now?: unknown }).now;
  }
}

test("冷却的边界：密钥 / 配额类 60 秒（59.999 秒还挡、60 秒放行），网络类 15 秒；冷却中直接按上次的原因降级、不调用；冷却中缓存照常可用", async (t) => {
  t.after(cleanupFuture);
  const cachedPair = { from: { lat: 30.01, lng: 130.01 }, to: { lat: 30.02, lng: 130.02 } };
  const warm = countingCompute(() => ({ ok: true, meters: 2_000, seconds: 300 }));
  await estimator({ now: () => new Date("2030-07-01T00:00:00.000Z"), compute: warm.compute }).estimate(cachedPair);
  const cases: [RouteFailureCode, number][] = [
    ["KEY_INVALID", 60_000], ["API_NOT_ENABLED", 60_000], ["KEY_RESTRICTED", 60_000], ["BILLING_DISABLED", 60_000], ["PERMISSION_DENIED", 60_000], ["QUOTA_EXCEEDED", 60_000],
    ["TIMEOUT", 15_000], ["UNREACHABLE", 15_000], ["UNAVAILABLE", 15_000], ["UNEXPECTED", 15_000],
  ];
  let n = 0;
  for (const [code, cooldown] of cases) {
    await withMonotonic(1_000_000, async (setNow) => {
      let result: ComputedRoute = { ok: false, code };
      const google = countingCompute(() => result);
      const routes = estimator({ now: () => new Date("2030-07-01T00:00:00.000Z"), compute: google.compute, apiKey: () => `AIzaQaCooldown${code}` });
      const pair = (): { from: LatLng; to: LatLng } => ({ from: { lat: 30.5, lng: 131 + n * 0.01 }, to: { lat: 30.6, lng: 131 + (n++) * 0.01 } });
      assert.deepEqual(await routes.estimate(pair()), { ok: false, code });
      setNow(1_000_000 + cooldown - 1);
      result = { ok: true, meters: 1_000, seconds: 60 };
      assert.deepEqual(await routes.estimate(pair()), { ok: false, code }, `${code} 冷却中`);
      assert.equal(google.calls(), 1, code);
      // 冷却中缓存照常可用
      assert.equal((await routes.estimate(cachedPair)).ok, true, code);
      setNow(1_000_000 + cooldown);
      assert.equal((await routes.estimate(pair())).ok, true, `${code} 冷却结束`);
      assert.equal(google.calls(), 2, code);
    });
  }
});

test("不冷却：没有路线、坐标无效之后别的点立即照常调用；密钥没配之后一配上立即调用；冷却中换了密钥立即用新的", async (t) => {
  t.after(cleanupFuture);
  await withMonotonic(5_000_000, async () => {
    let result: ComputedRoute = { ok: false, code: "NO_ROUTE" };
    let key: string | null = "AIzaQaNoCooldown0000000000000001";
    const google = countingCompute(() => result);
    const routes = estimator({ now: () => new Date("2030-07-02T00:00:00.000Z"), compute: google.compute, apiKey: () => key });
    const pair = (i: number): { from: LatLng; to: LatLng } => ({ from: { lat: 29.5, lng: 129 + i * 0.01 }, to: { lat: 29.6, lng: 129 + i * 0.01 } });
    assert.deepEqual(await routes.estimate(pair(1)), { ok: false, code: "NO_ROUTE" });
    result = { ok: false, code: "INVALID_POINTS" };
    assert.deepEqual(await routes.estimate(pair(2)), { ok: false, code: "INVALID_POINTS" });
    result = { ok: true, meters: 1, seconds: 1 };
    assert.equal((await routes.estimate(pair(3))).ok, true);
    assert.equal(google.calls(), 3);
    key = null;
    assert.deepEqual(await routes.estimate(pair(4)), { ok: false, code: "NOT_CONFIGURED" });
    key = "AIzaQaNoCooldown0000000000000002";
    assert.equal((await routes.estimate(pair(4))).ok, true);
    result = { ok: false, code: "BILLING_DISABLED" };
    assert.deepEqual(await routes.estimate(pair(5)), { ok: false, code: "BILLING_DISABLED" });
    assert.deepEqual(await routes.estimate(pair(6)), { ok: false, code: "BILLING_DISABLED" });
    assert.equal(google.calls(), 5);
    key = "AIzaQaNoCooldown0000000000000003";
    result = { ok: true, meters: 2, seconds: 2 };
    assert.equal((await routes.estimate(pair(6))).ok, true);
    assert.equal(google.calls(), 6);
  });
});

test("每日上限按东京日期：东京 23:59:59.999 还算当天（已满、被挡下、不发请求），东京 0 点整换新的一天、从 1 开始计", async (t) => {
  t.after(cleanupFuture);
  behave = () => ({ body: route(3_000, 400) });
  seen.length = 0;
  let now = new Date("2030-08-31T14:59:59.999Z");
  const make = (key: string): GoogleRouteEstimator =>
    estimator({ now: () => now, dailyLimit: 5, apiKey: () => key, compute: (apiKey, from, to, beforeAttempt) => computeRoute(apiKey, from, to, { url: googleUrl, beforeAttempt }) });
  await api.db.owner.query("insert into route_api_usage (day, calls) values ('2030-08-31', 5)");
  assert.deepEqual(await make("AIzaQaMidnight00000000000000001").estimate({ from: { lat: 28.1, lng: 129.1 }, to: { lat: 28.2, lng: 129.2 } }), { ok: false, code: "DAILY_LIMIT_REACHED" });
  assert.equal(seen.length, 0);
  now = new Date("2030-08-31T15:00:00.000Z");
  // 换一把密钥，免得被上一把的冷却（60 秒，单调时钟）挡住
  assert.equal((await make("AIzaQaMidnight00000000000000002").estimate({ from: { lat: 28.1, lng: 129.1 }, to: { lat: 28.2, lng: 129.2 } })).ok, true);
  assert.equal(seen.length, 1);
  const rows = (await api.db.owner.query("select day::text, calls, refused from route_api_usage where day in ('2030-08-31', '2030-09-01') order by day")).rows;
  assert.deepEqual(rows.map((row) => [row.day, row.calls, row.refused]), [["2030-08-31", 5, 1], ["2030-09-01", 1, 0]]);
});

test("每日上限跨午夜（同一个进程、同一把密钥）：东京 23:59:59 到了上限（冷却 60 秒）后，0 点整换了新的一天立即恢复调用；前一天的冷却不挡、不把新一天记成被挡下", async (t) => {
  t.after(cleanupFuture);
  await withMonotonic(5_000_000, async (setNow) => {
    let now = new Date("2030-09-24T14:59:59.000Z");
    const google = countingCompute(() => ({ ok: true, meters: 3_000, seconds: 400 }));
    const routes = estimator({ now: () => now, dailyLimit: 1, compute: google.compute, apiKey: () => "AIzaQaMidnightSameKey0000000001" });
    assert.equal((await routes.estimate({ from: { lat: 27.1, lng: 128.1 }, to: { lat: 27.2, lng: 128.2 } })).ok, true);
    assert.deepEqual(await routes.estimate({ from: { lat: 27.3, lng: 128.3 }, to: { lat: 27.4, lng: 128.4 } }), { ok: false, code: "DAILY_LIMIT_REACHED" });
    // 单调时钟只过了 1 秒（还在 60 秒的冷却里），东京已经是 9 月 25 日 0 点
    now = new Date("2030-09-24T15:00:00.000Z");
    setNow(5_001_000);
    assert.equal((await routes.estimate({ from: { lat: 27.5, lng: 128.5 }, to: { lat: 27.6, lng: 128.6 } })).ok, true);
    assert.equal(google.calls(), 2);
    const rows = (await api.db.owner.query("select day::text, calls, refused from route_api_usage where day in ('2030-09-24', '2030-09-25') order by day")).rows;
    assert.deepEqual(rows.map((row) => [row.day, row.calls, row.refused]), [["2030-09-24", 1, 1], ["2030-09-25", 1, 0]]);
  });
});

test("每日上限含重试：上限 3，两组点同时问、谷歌每组第一次 503 第二次成功——总共只发出 3 次请求（计数 3、被挡下 1），不超", async (t) => {
  t.after(cleanupFuture);
  const attempts = new Map<string, number>();
  behave = (request) => {
    const n = (attempts.get(request.body) ?? 0) + 1;
    attempts.set(request.body, n);
    return n === 1 ? { status: 503, raw: "busy" } : { body: route(4_000, 500) };
  };
  seen.length = 0;
  const routes = estimator({ now: () => new Date("2030-09-15T03:00:00.000Z"), dailyLimit: 3, compute: (apiKey, from, to, beforeAttempt) => computeRoute(apiKey, from, to, { url: googleUrl, beforeAttempt }) });
  const results = await Promise.all([routes.estimate({ from: { lat: 27.1, lng: 128.1 }, to: { lat: 27.2, lng: 128.2 } }), routes.estimate({ from: { lat: 27.3, lng: 128.3 }, to: { lat: 27.4, lng: 128.4 } })]);
  assert.equal(seen.length, 3);
  assert.deepEqual(results.map((result) => (result.ok ? "ok" : result.code)).sort(), ["UNAVAILABLE", "ok"]);
  const usage = (await api.db.owner.query("select calls, refused from route_api_usage where day = '2030-09-15'")).rows[0];
  assert.deepEqual([usage.calls, usage.refused], [3, 1]);
});

test("每日上限跨进程：两个服务进程（各自的路线预估实例、共用一个库）同时问 12 组不同的点，上限 5 时合计只发出 5 次", async (t) => {
  t.after(cleanupFuture);
  behave = () => ({ body: route(4_000, 500), delayMs: 20 });
  seen.length = 0;
  const make = (): GoogleRouteEstimator => estimator({ now: () => new Date("2030-09-18T03:00:00.000Z"), dailyLimit: 5, compute: (apiKey, from, to, beforeAttempt) => computeRoute(apiKey, from, to, { url: googleUrl, beforeAttempt }) });
  const [one, two] = [make(), make()];
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? one : two).estimate({ from: { lat: 24.1, lng: 125.1 }, to: { lat: 24.2, lng: 125.1 + i * 0.01 } })));
  assert.equal(seen.length, 5);
  assert.deepEqual([results.filter((r) => r.ok).length, results.filter((r) => !r.ok && r.code === "DAILY_LIMIT_REACHED").length], [5, 7]);
  const usage = (await api.db.owner.query("select calls, refused from route_api_usage where day = '2030-09-18'")).rows[0];
  assert.deepEqual([usage.calls, usage.refused], [5, 7]);
});

test("高并发不误伤：上限够用时 60 组不同的点同时问，全部取到路线（占名额排队不会因为库的时限变成 UNAVAILABLE），计数正好 60", async (t) => {
  t.after(cleanupFuture);
  behave = () => ({ body: route(4_000, 500), delayMs: 20 });
  seen.length = 0;
  const routes = estimator({ now: () => new Date("2030-09-19T03:00:00.000Z"), compute: (apiKey, from, to, beforeAttempt) => computeRoute(apiKey, from, to, { url: googleUrl, beforeAttempt }) });
  const results = await Promise.all(Array.from({ length: 60 }, (_, i) => routes.estimate({ from: { lat: 23.1, lng: 124.1 }, to: { lat: 23.2 + Math.floor(i / 10) * 0.01, lng: 124.1 + (i % 10) * 0.01 } })));
  assert.deepEqual(results.filter((r) => !r.ok).map((r) => (r.ok ? "" : r.code)), []);
  assert.equal(seen.length, 60);
  assert.equal((await api.db.owner.query("select calls from route_api_usage where day = '2030-09-19'")).rows[0].calls, 60);
});

test("每日上限 0：不发任何请求（DAILY_LIMIT_REACHED），只记被挡下", async (t) => {
  t.after(cleanupFuture);
  seen.length = 0;
  const routes = estimator({ now: () => new Date("2030-09-16T03:00:00.000Z"), dailyLimit: 0, compute: (apiKey, from, to, beforeAttempt) => computeRoute(apiKey, from, to, { url: googleUrl, beforeAttempt }) });
  assert.deepEqual(await routes.estimate({ from: { lat: 26.1, lng: 127.1 }, to: { lat: 26.2, lng: 127.2 } }), { ok: false, code: "DAILY_LIMIT_REACHED" });
  assert.equal(seen.length, 0);
  const usage = (await api.db.owner.query("select calls, refused from route_api_usage where day = '2030-09-16'")).rows[0];
  assert.deepEqual([usage.calls, usage.refused], [0, 1]);
});

test("记不了数（数据库连不上）：不调用谷歌（宁可少调），原因是 UNAVAILABLE 而不是到了上限；日志里没有密钥", async () => {
  seen.length = 0;
  warnings.length = 0;
  const broken = { connect: async () => Promise.reject(new Error("connection refused")) } as unknown as Pool;
  const key = "AIzaQaBrokenPool0000000000000001";
  const routes = estimator({ pool: broken, apiKey: () => key, now: () => new Date("2030-09-17T03:00:00.000Z"), compute: (apiKey, from, to, beforeAttempt) => computeRoute(apiKey, from, to, { url: googleUrl, beforeAttempt }) });
  assert.deepEqual(await routes.estimate({ from: { lat: 25.1, lng: 126.1 }, to: { lat: 25.2, lng: 126.2 } }), { ok: false, code: "UNAVAILABLE" });
  assert.equal(seen.length, 0);
  assert.ok(warnings.length >= 2);
  for (const warning of warnings) assert.ok(![...allValues(warning.obj)].some((value) => value.includes(key)) && !warning.msg.includes(key));
});

// ---- 降级：14 个原因码，从谷歌应答 / 网络情况到每一种看的人 ----

const PROVOKE: Record<RouteFailureCode, "no-key" | "limit" | ((key: string) => Behavior)> = {
  NOT_CONFIGURED: "no-key",
  DAILY_LIMIT_REACHED: "limit",
  KEY_INVALID: (key) => ({ status: 400, body: googleError(400, "INVALID_ARGUMENT", "API_KEY_INVALID", key) }),
  API_NOT_ENABLED: (key) => ({ status: 403, body: googleError(403, "PERMISSION_DENIED", "SERVICE_DISABLED", key) }),
  KEY_RESTRICTED: (key) => ({ status: 403, body: googleError(403, "PERMISSION_DENIED", "API_KEY_IP_ADDRESS_BLOCKED", key) }),
  BILLING_DISABLED: (key) => ({ status: 403, body: googleError(403, "PERMISSION_DENIED", "BILLING_DISABLED", key) }),
  PERMISSION_DENIED: (key) => ({ status: 403, body: googleError(403, "PERMISSION_DENIED", null, key) }),
  QUOTA_EXCEEDED: (key) => ({ status: 429, body: googleError(429, "RESOURCE_EXHAUSTED", null, key) }),
  TIMEOUT: () => ({ body: route(1_000, 100), delayMs: 2_500 }),
  UNREACHABLE: () => ({ destroy: true }),
  UNAVAILABLE: (key) => ({ status: 503, raw: `<html>backend error for ${key}</html>` }),
  UNEXPECTED: (key) => ({ status: 200, raw: `<html>${key}</html>` }),
  INVALID_POINTS: (key) => ({ status: 400, body: googleError(400, "INVALID_ARGUMENT", null, key) }),
  NO_ROUTE: () => ({ body: {} }),
};

/** 让下一次路线预估得到 `code`：每次换一把新密钥（不受上一个原因的冷却影响）。返回收尾。 */
async function provoke(code: RouteFailureCode): Promise<() => Promise<void>> {
  const how = PROVOKE[code];
  if (how === "no-key") {
    await clearAdminKey();
    return async () => void (await newAdminKey());
  }
  await newAdminKey();
  if (how === "limit") {
    const day = routeUsageDay(api.clock.now());
    const before = (await api.db.owner.query("select calls from route_api_usage where day = $1", [day])).rows[0]?.calls ?? 0;
    await api.db.owner.query("insert into route_api_usage (day, calls) values ($1, 1000) on conflict (day) do update set calls = 1000", [day]);
    behave = () => ({ body: route(1_000, 100) });
    return async () => void (await api.db.owner.query("update route_api_usage set calls = $2 where day = $1", [day, before]));
  }
  const key = currentKey();
  behave = () => how(key);
  return async () => undefined;
}

const INTERNAL_CODES = ROUTE_FAILURE_CODES.filter((code) => code !== "NO_ROUTE");
const INTERNAL_MESSAGES = ROUTE_FAILURE_CODES.filter((code) => code !== "NO_ROUTE").map((code) => ROUTE_FAILURE_MESSAGES[code]);
function assertNoInternalReason(body: unknown, what: string): void {
  const values = [...allValues(body)];
  for (const value of values) {
    assert.ok(!(INTERNAL_CODES as readonly string[]).includes(value), `${what}里出现了内部原因 ${value}`);
    assert.ok(!INTERNAL_MESSAGES.includes(value), `${what}里出现了内部说明 ${value}`);
  }
}

test("14 个原因码（甲的一口价在）：平台试算看到完整的码和说明、一口价照常中标；供应商只看到两种；渠道询价 200、照常报出一口价，询价日志记下原因码", async () => {
  for (const code of ROUTE_FAILURE_CODES) {
    const restore = await provoke(code);
    try {
      const dropoff = freshDropoff();
      const platform = await platformPreview(dropoff);
      assert.equal(platform.status, 200, `${code}: ${platform.text}`);
      assert.deepEqual(platform.body.route_status, { status: "unavailable", source: null, code, message: ROUTE_FAILURE_MESSAGES[code] }, code);
      assert.equal(platform.body.route, null, code);
      assert.deepEqual([winnerOf(platform.body)?.product_id, winnerOf(platform.body)?.settlement], [market.ids.pa, 12_000], code);
      assert.equal(platform.body.refused.find((entry: any) => entry.product_id === metered)?.reason, "ROUTE_UNAVAILABLE", code);

      const tenant = await tenantPreview(dropoff);
      assert.equal(tenant.status, 200, `${code}: ${tenant.text}`);
      assert.deepEqual([tenant.body.route_status.status, tenant.body.route_status.code, tenant.body.refused[0]?.reason], ["unavailable", guestRouteReason(code), "ROUTE_UNAVAILABLE"], code);
      assertNoInternalReason(tenant.body, `${code} 供应商试算`);

      const sales = await salesQuote(dropoff);
      assert.equal(sales.status, 200, `${code}: ${sales.text}`);
      assert.deepEqual(sales.body.quotes.map((quote: any) => quote.vehicle_group_id), [market.ids.eco4], code);
      assert.deepEqual(sales.body.unavailable, [], code);
      assertNoInternalReason(sales.body, `${code} 渠道询价`);
      assert.deepEqual(await quoteLogRoute(dropoff), { status: "unavailable", code }, `${code} 询价日志`);
    } finally {
      await restore();
    }
  }
  // 系统状态：最近一次失败是最后一个原因，带中文说明
  const status = (await ok(call("GET", "/platform/v1/integrations", { token: market.root }))).routes;
  assert.deepEqual([status.last_failure.code, status.last_failure.message], ["NO_ROUTE", ROUTE_FAILURE_MESSAGES.NO_ROUTE]);
  // 真正调用了谷歌的失败都记了一条只有原因代码的 warn
  const logged = new Set(api.logs().split("\n").filter((line) => line.includes("routeFailure")).map((line) => JSON.parse(line).routeFailure));
  for (const code of ROUTE_FAILURE_CODES.filter((c) => c !== "NOT_CONFIGURED")) assert.ok(logged.has(code), `日志里没有 ${code}`);
});

test("14 个原因码（只剩里程商品）：渠道和官网的 unavailable 里只有 NO_ROUTE / TEMPORARILY_UNAVAILABLE 两种客人原因，没有内部原因", async () => {
  let site: SiteApi | undefined;
  await ok(call("POST", `/tenant/v1/products/${market.ids.pa}/unpublish`, { token: market.a.adminToken }));
  api.clock.advance(31_000);
  try {
    for (const code of ROUTE_FAILURE_CODES) {
      const restore = await provoke(code);
      try {
        const sales = await salesQuote(freshDropoff());
        assert.equal(sales.status, 200, `${code}: ${sales.text}`);
        const reasons = sales.body.unavailable.find((entry: any) => entry.vehicle_group_id === market.ids.eco4)?.reasons ?? [];
        assert.ok(reasons.includes(guestRouteReason(code)), `${code}: ${JSON.stringify(reasons)}`);
        assert.ok(!reasons.includes(guestRouteReason(code) === "NO_ROUTE" ? "TEMPORARILY_UNAVAILABLE" : "NO_ROUTE"), `${code}: ${JSON.stringify(reasons)}`);
        assertNoInternalReason(sales.body, `${code} 渠道询价`);
      } finally {
        await restore();
      }
    }
    // 官网：另一个服务进程（自己的路线预估实例），谷歌同样指向本机假服务器。官网不指定车型组，全都报不出时才给原因：乙的商务 7 座也先下架
    await ok(call("POST", `/tenant/v1/products/${market.ids.pb}/unpublish`, { token: market.b.adminToken }));
    site = await siteApi(api, siteClientId, null, { GOOGLE_MAPS_ROUTES_URL: googleUrl, GOOGLE_MAPS_API_KEY: "" });
    for (const [code, reason] of [["NO_ROUTE", "NO_ROUTE"], ["UNAVAILABLE", "TEMPORARILY_UNAVAILABLE"]] as const) {
      const restore = await provoke(code);
      try {
        seen.length = 0;
        const res = await site.call("POST", "/site/v1/quotes", { body: { city_id: market.ids.tokyo, airport_id: market.ids.narita, direction: "pickup", address: freshDropoff(), service_local: "2026-10-20T10:00", passengers: 2, luggage: 1 } });
        responses.push(res);
        assert.equal(res.status, 200, res.text);
        assert.ok(seen.length >= 1, "官网询价调用了（本机的）谷歌");
        assert.deepEqual(res.body.quotes, [], res.text);
        const reasons = res.body.unavailable.find((entry: any) => entry.vehicle_group_id === null)?.reasons ?? [];
        assert.ok(reasons.includes(reason), `${code}: ${res.text}`);
        assertNoInternalReason(res.body, `${code} 官网询价`);
      } finally {
        await restore();
      }
    }
  } finally {
    await site?.close();
    await ok(call("POST", `/tenant/v1/products/${market.ids.pa}/publish`, { token: market.a.adminToken }));
    await ok(call("POST", `/tenant/v1/products/${market.ids.pb}/publish`, { token: market.b.adminToken }));
    api.clock.advance(31_000);
  }
});

// ---- 安全 ----

test("发给谷歌的请求：POST、网址没有查询参数、只有字段掩码要的两个字段、请求体只有起终点和三项选项、密钥只在 X-Goog-Api-Key", async () => {
  const key = await newAdminKey();
  behave = () => ({ body: route(5_500, 700) });
  seen.length = 0;
  assert.equal((await platformPreview(freshDropoff())).body.route_status.status, "ok");
  assert.equal(seen.length, 1);
  const [request] = seen as [Seen];
  assert.equal(request.method, "POST");
  assert.equal(request.path, "/directions/v2:computeRoutes");
  assert.equal(request.headers["x-goog-fieldmask"], "routes.distanceMeters,routes.duration");
  assert.equal(request.headers["x-goog-api-key"], key);
  assert.deepEqual(Object.keys(request.headers).filter((name) => name.startsWith("x-goog")).sort(), ["x-goog-api-key", "x-goog-fieldmask"]);
  for (const [name, value] of Object.entries(request.headers)) if (name !== "x-goog-api-key") assert.ok(!String(value).includes(key), name);
  const body = JSON.parse(request.body);
  assert.deepEqual(Object.keys(body).sort(), ["computeAlternativeRoutes", "destination", "origin", "routingPreference", "travelMode"]);
  assert.deepEqual([body.travelMode, body.routingPreference, body.computeAlternativeRoutes], ["DRIVE", "TRAFFIC_UNAWARE", false]);
  assert.ok(!request.body.includes(key));
});

test("跳转不跟随：谷歌回 307 / 301 指向一个能用的地址，也只发一次请求、当作看不懂（UNEXPECTED）", async () => {
  for (const status of [307, 301]) {
    await newAdminKey();
    behave = (request) => (request.path.startsWith("/elsewhere") ? { body: route(9_999, 999) } : { status, headers: { location: `${new URL(googleUrl).origin}/elsewhere` } });
    seen.length = 0;
    const res = await platformPreview(freshDropoff());
    assert.equal(res.status, 200, res.text);
    assert.deepEqual([res.body.route_status.code, seen.map((entry) => entry.path)], ["UNEXPECTED", ["/directions/v2:computeRoutes"]], String(status));
  }
});

test("超大应答：先给 70 KB 然后既不结束也不断开——读到 64 KB 就停，马上当作看不懂（不等到超时）", async () => {
  await newAdminKey();
  behave = () => ({ hangAfterBytes: 70 * 1024 });
  const started = performance.now();
  const res = await platformPreview(freshDropoff());
  const elapsed = performance.now() - started;
  assert.equal(res.status, 200, res.text);
  assert.equal(res.body.route_status.code, "UNEXPECTED");
  assert.ok(elapsed < 900, `用了 ${elapsed} 毫秒（按超时处理了）`);
});

test("系统状态的路线统计：超级管理员和技术看得到；渠道经理、只读、运营、供应商、渠道令牌、不登录都拿不到", async () => {
  for (const token of [market.root, tech]) {
    const res = await call("GET", "/platform/v1/integrations", { token });
    assert.equal(res.status, 200, res.text);
    assert.deepEqual(Object.keys(res.body.routes).sort(), ["calls", "daily_limit", "daily_limit_reached", "day", "failures", "last_failure", "last_success_at", "refused"]);
  }
  for (const [who, token, status] of [
    ["渠道经理", market.staff.cm1.token, 403],
    ["只读", market.staff.readonly.token, 403],
    ["运营", market.staff.operations.token, 403],
    ["主数据", market.staff.masterData.token, 403],
    ["供应商管理员", market.b.adminToken, 401],
    ["渠道令牌", salesToken, 401],
  ] as const) {
    const res = await call("GET", "/platform/v1/integrations", { token });
    assert.equal(res.status, status, `${who}: ${res.status} ${res.text}`);
    assert.equal(res.body?.routes, undefined, who);
  }
  assert.equal((await call("GET", "/platform/v1/integrations")).status, 401);
});

test("没有密钥原文（按值比对）：本文件收到的全部应答、每一行日志、库里每一张表的每个值（谷歌的错误应答里回显了密钥也一样）", async () => {
  assert.ok(adminKeys.length > 20);
  const keys = adminKeys;
  const leaked = (values: Iterable<string>): string[] => [...values].filter((value) => keys.some((key) => value.includes(key)));
  for (const res of responses) {
    // 运营后台填写密钥的接口只回打码后的末 4 位
    assert.deepEqual(leaked(allValues(res.body)), [], res.text.slice(0, 200));
    assert.ok(!keys.some((key) => res.text.includes(key)), res.text.slice(0, 200));
  }
  for (const line of api.logs().split("\n").filter((l) => l.trim() !== "")) assert.deepEqual(leaked(allValues(JSON.parse(line))), [], line.slice(0, 200));
  const tables = (await api.db.owner.query("select table_name from information_schema.tables where table_schema = current_schema() and table_type = 'BASE TABLE'")).rows.map((row) => row.table_name as string);
  assert.ok(tables.includes("route_estimates") && tables.includes("route_api_usage") && tables.includes("quote_logs"));
  for (const table of tables) {
    const rows = (await api.db.owner.query(`select * from "${table}"`)).rows;
    assert.deepEqual(leaked(allValues(rows)), [], table);
  }
});
