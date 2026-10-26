/**
 * M3-12 官网地址搜索与地图选点（ADR 0044）测试角色补充：真实接口、真实 PostgreSQL；谷歌是本文件里的本机假服务器，**从不调用真实的谷歌**
 * （服务进程的密钥只用运营后台填写的假密钥；搜索、反查地址都指向本机）。
 *
 * - 费用控制：每日上限按东京日期（23:59:59.999 / 0 点整）、同一进程跨午夜不被前一天的冷却挡、并发和含重试不超、两个进程合计不超、0 不调用、
 *   和路线预估分开（路线上限 0 / 已用满时地址搜索照常）；缓存命中不计次、10 分钟按毫秒的边界、500 条先进先出、同一个键（含反查格子）并发只调一次、
 *   请求无效缓存而其他失败不缓存（15 秒冷却之后重新调用）。
 * - 限速：按来源地址每分钟 20 次（第 21 次 429 + Retry-After，等够 Retry-After 恢复）、每天 300 次（第 301 次 429，24 小时后恢复）；
 *   TRUST_PROXY_HOPS=0 时 X-Forwarded-For 不起作用、=1 时只认最近一层代理写的地址——伪造都绕不过。
 * - 输入：规范化后 2 / 100 字的两侧（按字符，含表情）、全角半角、零宽和方向控制字符；坐标的各种不合法写法；城市范围的边上和刚出界；
 *   反查也检查渠道授权；城市停用；官网渠道暂停。
 * - 降级：每种谷歌失败（401、403 三种、429、500、502、超时、断开、跳转、超大应答、结构不对、HTML）都是 200 + available false，
 *   不转述对方原文；反查同样。
 * - 报价按坐标：营运区边上的点算在里面、刚出边界就是 OUT_OF_SERVICE_AREA。
 * - 安全：日志里没有关键字、坐标、密钥（谷歌错误应答回显了密钥也一样）；计数表、限流表里没有来源地址原文和密钥。
 * 测试数据全在本文件里建出来，随测试 schema 一起删除；用 2030 年时钟的直接调用测试结束后删掉自己写的计数。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type IncomingHttpHeaders, type Server, createServer } from "node:http";
import { type LatLng, type PlaceCandidate, cityBounds, routeUsageDay } from "@nozomi/domain";
import type { Pool } from "./db/pool.ts";
import { type PlaceCallResult, reverseGeocode, searchPlaces } from "./integrations/google-places.ts";
import { GooglePlaceSearch } from "./services/place-search.ts";
import { type TestApi, createTestApi } from "./testing/api.ts";
import { type Market, allValues, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

// ---- 本机假谷歌：一个服务同时当 Text Search 和 Geocoding，每个请求按测试给的规则应答 ----

interface Seen {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
}
interface Behavior {
  status?: number;
  body?: unknown;
  raw?: string;
  delayMs?: number;
  headers?: Record<string, string>;
  destroy?: boolean;
  hangAfterBytes?: number;
}

let server: Server;
let origin = "";
const seen: Seen[] = [];
const searches = (): Seen[] => seen.filter((entry) => entry.path.startsWith("/v1/places:searchText"));
const reverses = (): Seen[] => seen.filter((entry) => entry.path.startsWith("/v4beta/geocode/location"));
const PLACE = { id: "ChIJqaTokyoStation", displayName: { text: "東京駅", languageCode: "ja" }, formattedAddress: "日本、〒100-0005 東京都千代田区丸の内１丁目", location: { latitude: 35.6812, longitude: 139.7671 } };
const okBehavior = (request: Seen): Behavior => (request.path.startsWith("/v1/") ? { body: { places: [PLACE] } } : { body: { results: [{ formattedAddress: "日本、〒100-0005 東京都千代田区丸の内１丁目９" }] } });
let behave: (request: Seen) => Behavior = okBehavior;
const reset = (): void => {
  seen.length = 0;
  behave = okBehavior;
};
/** 谷歌的错误应答；message 和 metadata 里故意回显密钥，核对它不会被转述到任何地方 */
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
          response.write(`{"places":[],"pad":"${"x".repeat(reply.hangAfterBytes)}`);
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
  origin = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}`;
}

// ---- 市场与官网 ----

let api: TestApi;
let m: Market;
let siteChannelId: string;
let siteClientId: string;
let site: SiteApi;
let logs = "";
const opened: SiteApi[] = [];
const adminKeys: string[] = [];
const TOKYO_CENTER = { lng: 139.6917, lat: 35.6895 };

const googleEnv = (): Record<string, string> => ({ GOOGLE_PLACES_SEARCH_URL: `${origin}/v1/places:searchText`, GOOGLE_GEOCODE_URL: `${origin}/v4beta/geocode/location`, GOOGLE_MAPS_API_KEY: "" });
const openSite = async (env: Record<string, string> = {}, deps: Parameters<typeof siteApi>[4] = {}, clientId = siteClientId): Promise<SiteApi> => {
  const app = await siteApi(api, clientId, new FakePaymentProvider(), { ...googleEnv(), ...env }, { integrationSecretsTtlMs: 0, logDestination: { write: (line) => void (logs += line) }, ...deps });
  opened.push(app);
  return app;
};
let ipSeq = 0;
const nextIp = (): string => `10.77.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;
const searchUrl = (q: string, cityId = m.ids.tokyo): string => `/site/v1/places/search?city_id=${cityId}&q=${encodeURIComponent(q)}`;
const reverseUrl = (point: { lat: number | string; lng: number | string }, cityId = m.ids.tokyo): string => `/site/v1/places/reverse?city_id=${cityId}&lat=${point.lat}&lng=${point.lng}`;
let seq = 0;
const freshQuery = (): string => `QA酒店 ${++seq}`;
const freshPoint = (): { lat: number; lng: number } => ({ lat: 35.55, lng: Number((139.3 + ++seq * 0.001).toFixed(4)) });
const newAdminKey = async (): Promise<string> => {
  const key = `AIzaQaPlace${randomUUID().replaceAll("-", "")}`;
  adminKeys.push(key);
  await ok(api.call("PUT", "/platform/v1/integration-secrets/google-maps", { token: m.root, body: { api_key: key } }));
  return key;
};
const currentKey = (): string => adminKeys[adminKeys.length - 1] as string;
const usage = async (day = routeUsageDay(api.clock.now())): Promise<{ calls: number; failures: number; refused: number; last_failure_code: string | null }> =>
  (await api.db.owner.query("select calls, failures, refused, last_failure_code from place_api_usage where day = $1", [day])).rows[0] ?? { calls: 0, failures: 0, refused: 0, last_failure_code: null };

before(async () => {
  await startGoogle();
  api = await createTestApi({ payments: new FakePaymentProvider(), integrationSecretsTtlMs: 0 });
  m = await buildMarket(api);
  const channel = await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网 QA" });
  siteChannelId = channel.id;
  siteClientId = (await salesCredentials(api, m, channel.id)).clientId;
  await newAdminKey();
  site = await openSite();
});
after(async () => {
  for (const app of opened) await app.close();
  await api.db.owner.query("delete from place_api_usage where day >= '2030-01-01'");
  await api.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

// ---- 直接调用服务层（可控的东京时钟和单调时钟；谷歌是替身或本机假服务器） ----

const warnings: { obj: object; msg: string }[] = [];
type SearchFn = (apiKey: string, request: { query: string }, beforeAttempt: () => Promise<boolean>) => Promise<PlaceCallResult<PlaceCandidate[]>>;
function service(options: { now: () => Date; search?: SearchFn; dailyLimit?: number; apiKey?: () => string | null; pool?: Pool; cacheTtlMs?: number }): GooglePlaceSearch {
  return new GooglePlaceSearch({
    pool: options.pool ?? api.db.pool,
    now: options.now,
    apiKey: options.apiKey ?? (() => "AIzaQaPlaceService0000000000001"),
    dailyLimit: options.dailyLimit ?? 1_000_000,
    search: options.search ?? (async () => ({ ok: true, value: [] })),
    reverse: async (_key, _point, _region, beforeAttempt) => ((await beforeAttempt()) ? { ok: true, value: "替身地址" } : { ok: false, code: "DAILY_LIMIT_REACHED" }),
    log: { warn: (obj, msg) => void warnings.push({ obj, msg }) },
    ...(options.cacheTtlMs === undefined ? {} : { cacheTtlMs: options.cacheTtlMs }),
  });
}
/** 不联网的谷歌替身：照真实实现，发请求前先占名额；记下调用次数 */
function counting(next: (query: string) => PlaceCallResult<PlaceCandidate[]> = () => ({ ok: true, value: [] }), delayMs = 0): { search: SearchFn; calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    search: async (_key, request, beforeAttempt) => {
      if (!(await beforeAttempt())) return { ok: false, code: "DAILY_LIMIT_REACHED" };
      calls++;
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return next(request.query);
    },
  };
}
const BOUNDS = cityBounds(TOKYO_CENTER);
const ask = (places: GooglePlaceSearch, query: string, cityId = "c-qa") => places.search({ cityId, query, bounds: BOUNDS, regionCode: "JP" });

/** 把单调时钟（缓存和冷却用的 performance.now）换成可控的 */
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

test("每日上限按东京日期：东京 23:59:59.999 还算当天（已满、被挡下、不调用），东京 0 点整换新的一天、从 1 开始计（和路线的表无关）", async () => {
  let now = new Date("2030-08-31T14:59:59.999Z");
  await api.db.owner.query("insert into place_api_usage (day, calls) values ('2030-08-31', 2)");
  const before = counting();
  assert.deepEqual(await ask(service({ now: () => now, dailyLimit: 2, search: before.search, apiKey: () => "AIzaQaMidnightA000000000000001" }), "新宿 酒店"), { ok: false, code: "DAILY_LIMIT_REACHED" });
  assert.equal(before.calls(), 0);
  now = new Date("2030-08-31T15:00:00.000Z");
  const afterMidnight = counting();
  // 另一个进程（新的服务实例，没有前一天的冷却）
  assert.equal((await ask(service({ now: () => now, dailyLimit: 2, search: afterMidnight.search, apiKey: () => "AIzaQaMidnightA000000000000001" }), "新宿 酒店")).ok, true);
  assert.equal(afterMidnight.calls(), 1);
  const rows = (await api.db.owner.query("select day::text, calls, refused from place_api_usage where day in ('2030-08-31', '2030-09-01') order by day")).rows;
  assert.deepEqual(rows.map((row) => [row.day, row.calls, row.refused]), [["2030-08-31", 2, 1], ["2030-09-01", 1, 0]]);
  assert.equal((await api.db.owner.query("select count(*)::int as n from route_api_usage where day in ('2030-08-31', '2030-09-01')")).rows[0].n, 0);
});

test("【缺陷】每日上限跨午夜：同一个进程在东京 23:59:59 用满后，0 点整换了新的一天应当立即恢复；实际被前一天「到了上限」的 60 秒冷却继续挡下，还把这次挡下记到新的一天", async () => {
  await withMonotonic(9_000_000, async (setMono) => {
    let now = new Date("2030-09-30T14:59:59.000Z");
    const google = counting();
    const places = service({ now: () => now, dailyLimit: 1, search: google.search, apiKey: () => "AIzaQaMidnightB000000000000001" });
    assert.equal((await ask(places, "上野 酒店")).ok, true);
    assert.deepEqual(await ask(places, "浅草 酒店"), { ok: false, code: "DAILY_LIMIT_REACHED" });
    // 东京 0 点整（单调时钟只过了 1 秒）：10 月 1 日一次都没用过
    now = new Date("2030-09-30T15:00:00.000Z");
    setMono(9_001_000);
    const next = await ask(places, "银座 酒店");
    const newDay = await usage("2030-10-01");
    assert.deepEqual(
      { result: next.ok, calls: google.calls(), newDay: [newDay.calls, newDay.refused] },
      { result: true, calls: 2, newDay: [1, 0] },
      "换天后同一进程仍被前一天的冷却挡下（并记成新一天的「被挡下」）",
    );
  });
});

test("每日上限并发不超：上限 3 时 12 个不同的关键字同时搜——只调用 3 次，计数 3、被挡下 9；两个进程共用一个库、上限 5 时合计只调用 5 次", async () => {
  const now = (): Date => new Date("2030-10-05T03:00:00.000Z");
  const google = counting(() => ({ ok: true, value: [] }), 30);
  const places = service({ now, dailyLimit: 3, search: google.search, apiKey: () => "AIzaQaConcurrent00000000000001" });
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => ask(places, `并发 ${i}`)));
  assert.equal(results.filter((result) => result.ok).length, 3);
  assert.equal(google.calls(), 3);
  const day = await usage("2030-10-05");
  assert.deepEqual([day.calls, day.refused], [3, 9]);

  const later = (): Date => new Date("2030-10-06T03:00:00.000Z");
  const shared = counting(() => ({ ok: true, value: [] }), 20);
  const one = service({ now: later, dailyLimit: 5, search: shared.search, apiKey: () => "AIzaQaProcessOne00000000000001" });
  const two = service({ now: later, dailyLimit: 5, search: shared.search, apiKey: () => "AIzaQaProcessTwo00000000000001" });
  await Promise.all(Array.from({ length: 16 }, (_, i) => ask(i % 2 === 0 ? one : two, `两个进程 ${i}`)));
  assert.equal(shared.calls(), 5);
  assert.equal((await usage("2030-10-06")).calls, 5);
});

test("每日上限含重试：上限 3，两个关键字同时搜、谷歌每次第一回 503 第二回成功——真正发出的请求合计只有 3 次（计数 3）", async () => {
  reset();
  const attempts = new Map<string, number>();
  behave = (request) => {
    const query = (JSON.parse(request.body) as { textQuery: string }).textQuery;
    const n = (attempts.get(query) ?? 0) + 1;
    attempts.set(query, n);
    return n === 1 ? { status: 503, body: {} } : { body: { places: [PLACE] } };
  };
  const now = (): Date => new Date("2030-10-07T03:00:00.000Z");
  const places = new GooglePlaceSearch({
    pool: api.db.pool,
    now,
    apiKey: () => "AIzaQaRetryLimit00000000000001",
    dailyLimit: 3,
    search: (apiKey, request, beforeAttempt) => searchPlaces(apiKey, request, { url: `${origin}/v1/places:searchText`, beforeAttempt }),
    reverse: async () => ({ ok: false, code: "UNREACHABLE" }),
    log: { warn: () => undefined },
  });
  await Promise.all([ask(places, "重试 一"), ask(places, "重试 二")]);
  assert.equal(searches().length, 3);
  assert.equal((await usage("2030-10-07")).calls, 3);
  reset();
});

test("每日上限 0：搜索和反查都不发请求，不计调用次数；页面不显示搜索", async () => {
  reset();
  const before = await usage();
  const off = await openSite({ GOOGLE_PLACES_DAILY_LIMIT: "0" });
  assert.equal((await ok(off.call("GET", "/site/v1/config"))).address_search, false);
  assert.deepEqual((await off.call("GET", searchUrl(freshQuery()), { ip: nextIp() })).body, { available: false, items: [] });
  assert.deepEqual((await off.call("GET", reverseUrl(freshPoint()), { ip: nextIp() })).body, { available: false, address: null });
  assert.equal(seen.length, 0);
  assert.equal((await usage()).calls, before.calls);
});

test("和路线预估分开：路线上限 0、今天路线已用满时，地址搜索照常；地址搜索不往路线的表里记", async () => {
  await newAdminKey();
  reset();
  const today = routeUsageDay(api.clock.now());
  await api.db.owner.query("insert into route_api_usage (day, calls) values ($1, 100000) on conflict (day) do update set calls = 100000", [today]);
  const routesBefore = (await api.db.owner.query("select calls, refused, failures from route_api_usage where day = $1", [today])).rows[0];
  const noRoutes = await openSite({ GOOGLE_ROUTES_DAILY_LIMIT: "0" });
  assert.equal((await ok(noRoutes.call("GET", "/site/v1/config"))).address_search, true);
  assert.equal((await ok(noRoutes.call("GET", searchUrl(freshQuery()), { ip: nextIp() }))).available, true);
  assert.equal((await ok(noRoutes.call("GET", reverseUrl(freshPoint()), { ip: nextIp() }))).available, true);
  assert.deepEqual([searches().length, reverses().length], [1, 1]);
  assert.deepEqual((await api.db.owner.query("select calls, refused, failures from route_api_usage where day = $1", [today])).rows[0], routesBefore);
});

// ---- 缓存 ----

test("缓存命中不计次：同一个关键字、同一个 11 米格子再问，不调谷歌，计数表的调用次数不变", async () => {
  await newAdminKey();
  reset();
  const q = freshQuery();
  const point = freshPoint();
  await ok(site.call("GET", searchUrl(q), { ip: nextIp() }));
  await ok(site.call("GET", reverseUrl(point), { ip: nextIp() }));
  const used = (await usage()).calls;
  for (let i = 0; i < 5; i++) {
    await ok(site.call("GET", searchUrl(q.toUpperCase()), { ip: nextIp() }));
    await ok(site.call("GET", reverseUrl({ lat: point.lat + 0.00004, lng: point.lng - 0.00004 }), { ip: nextIp() }));
  }
  assert.deepEqual([searches().length, reverses().length], [1, 1]);
  assert.equal((await usage()).calls, used);
});

test("缓存 10 分钟按毫秒：10 分钟减 1 毫秒还命中，正好 10 分钟过期重新调用；「没找到」也缓存", async () => {
  await withMonotonic(20_000_000, async (setMono) => {
    const google = counting();
    const places = service({ now: () => new Date("2030-10-08T03:00:00.000Z"), search: google.search });
    assert.deepEqual(await ask(places, "十分钟"), { ok: true, value: [], source: "google" });
    setMono(20_000_000 + 600_000 - 1);
    assert.deepEqual(await ask(places, "十分钟"), { ok: true, value: [], source: "cache" });
    assert.equal(google.calls(), 1);
    setMono(20_000_000 + 600_000);
    assert.deepEqual(await ask(places, "十分钟"), { ok: true, value: [], source: "google" });
    assert.equal(google.calls(), 2);
  });
});

test("缓存最多 500 条、先进先出：第 501 条挤掉最早的那条（命中不会让它变新），其余照常命中", async () => {
  const google = counting();
  const places = service({ now: () => new Date("2030-10-09T03:00:00.000Z"), search: google.search });
  for (let i = 0; i < 500; i++) await ask(places, `条目 ${i}`);
  assert.equal(google.calls(), 500);
  // 500 条都在；命中最早那条不改变它的先后
  assert.equal((await ask(places, "条目 0")).ok && google.calls(), 500);
  await ask(places, "条目 500");
  assert.equal(google.calls(), 501);
  const hit = await ask(places, "条目 2");
  assert.deepEqual([hit.ok && hit.source, google.calls()], ["cache", 501]);
  const evicted = await ask(places, "条目 0");
  assert.deepEqual([evicted.ok && evicted.source, google.calls()], ["google", 502]);
  // 「条目 0」重新进来挤掉了「条目 1」
  const second = await ask(places, "条目 1");
  assert.deepEqual([second.ok && second.source, google.calls()], ["google", 503]);
  const last = await ask(places, "条目 500");
  assert.deepEqual([last.ok && last.source, google.calls()], ["cache", 503]);
});

test("并发只调一次：同一个 11 米格子里十个不同的点同时反查，只调一次谷歌，十个都拿到地址", async () => {
  await newAdminKey();
  reset();
  behave = (request) => ({ ...okBehavior(request), delayMs: 200 });
  const base = freshPoint();
  const all = await Promise.all(Array.from({ length: 10 }, (_, i) => site.call("GET", reverseUrl({ lat: Number((base.lat + i * 0.000004).toFixed(6)), lng: base.lng }), { ip: nextIp() })));
  assert.equal(reverses().length, 1);
  for (const res of all) assert.deepEqual([res.status, res.body.available, typeof res.body.address], [200, true, "string"]);
  reset();
});

test("失败的缓存：请求无效记 10 分钟（同一个关键字不再问）；超时不缓存，15 秒冷却（14.999 秒还挡）过后同一个关键字重新调用", async () => {
  await withMonotonic(30_000_000, async (setMono) => {
    let result: PlaceCallResult<PlaceCandidate[]> = { ok: false, code: "INVALID_REQUEST" };
    const google = counting(() => result);
    const places = service({ now: () => new Date("2030-10-10T03:00:00.000Z"), search: google.search, apiKey: () => "AIzaQaFailCache00000000000001" });
    assert.deepEqual(await ask(places, "无效 请求"), { ok: false, code: "INVALID_REQUEST" });
    result = { ok: true, value: [] };
    assert.deepEqual(await ask(places, "无效 请求"), { ok: false, code: "INVALID_REQUEST" });
    assert.equal(google.calls(), 1);
    result = { ok: false, code: "TIMEOUT" };
    assert.deepEqual(await ask(places, "超时 一次"), { ok: false, code: "TIMEOUT" });
    result = { ok: true, value: [] };
    setMono(30_000_000 + 14_999);
    assert.deepEqual(await ask(places, "超时 一次"), { ok: false, code: "TIMEOUT" });
    assert.equal(google.calls(), 2);
    setMono(30_000_000 + 15_000);
    assert.equal((await ask(places, "超时 一次")).ok, true);
    assert.equal(google.calls(), 3);
  });
});

// ---- 输入 ----

test("关键字：规范化后正好 2 字、正好 100 字（含全角、表情按字符数）可以搜，1 字和 101 字不行；零宽、方向控制、换行当空白", async () => {
  await newAdminKey();
  reset();
  const searched = async (q: string): Promise<string> => {
    seen.length = 0;
    const res = await site.call("GET", searchUrl(q), { ip: nextIp() });
    assert.equal(res.status, 200, `${JSON.stringify(q)} ${res.text}`);
    return (JSON.parse((searches()[0] as Seen).body) as { textQuery: string }).textQuery;
  };
  const refused = async (q: string, reason: string): Promise<void> => {
    seen.length = 0;
    const res = await site.call("GET", searchUrl(q), { ip: nextIp() });
    assert.equal(res.status, 400, JSON.stringify(q));
    assert.ok(res.body.error.details.issues.some((issue: any) => issue.reason === reason), `${JSON.stringify(q)} ${res.text}`);
    assert.equal(seen.length, 0);
  };
  assert.equal(await searched("ＱＡ"), "QA");
  assert.equal(await searched(" 　渋谷　 "), "渋谷");
  assert.equal(await searched("新\u0007宿"), "新 宿");
  assert.equal(await searched("新宿\r\nX-Injected: 1"), "新宿 X-Injected: 1");
  assert.equal(await searched("‮新宿‬駅"), "新宿 駅");
  assert.equal(await searched("あ".repeat(100)), "あ".repeat(100));
  // 纯表情不能搜（字母、数字、汉字、假名至少 2 个，协调方的决定）；夹着表情、按字符数正好 100 个可以
  assert.equal(await searched(`新宿${"😀".repeat(98)}`), `新宿${"😀".repeat(98)}`);
  await refused("😀".repeat(100), "TOO_SHORT");
  await refused("😀😀", "TOO_SHORT");
  await refused("!?#*", "TOO_SHORT");
  assert.equal(await searched(`${"い".repeat(50)}${" ".repeat(200)}${"う".repeat(49)}`), `${"い".repeat(50)} ${"う".repeat(49)}`);
  await refused("😀", "TOO_SHORT");
  await refused("​新​", "TOO_SHORT");
  await refused("\u0001\u0002\u0003", "TOO_SHORT");
  await refused("あ".repeat(101), "TOO_LONG");
  await refused("😀".repeat(101), "TOO_LONG");
  await refused("Ａ".repeat(101), "TOO_LONG");
});

test("坐标：空、非数字、NaN、无穷、超大、重复的参数、缺经度、越过 ±90 / ±180 都是 400，不调用谷歌", async () => {
  reset();
  const base = `/site/v1/places/reverse?city_id=${m.ids.tokyo}`;
  for (const query of ["&lat=&lng=", "&lat=abc&lng=139.6", "&lat=NaN&lng=139.6", "&lat=Infinity&lng=139.6", "&lat=1e999&lng=139.6", "&lat=35.6&lat=35.7&lng=139.6", "&lat=35.6", "&lat=90.0001&lng=139.6", "&lat=35.6&lng=-180.0001", "&lat=35.6&lng=139.6&q=x"]) {
    const res = await site.call("GET", `${base}${query}`, { ip: nextIp() });
    assert.equal(res.status, 400, `${query} ${res.text}`);
  }
  // 留空、缺一项：REQUIRED（不能被当成 0）
  for (const [query, missing] of [["&lat=&lng=", ["/lat", "/lng"]], ["&lat=35.6&lng=", ["/lng"]], ["&lat=%20&lng=139.6", ["/lat"]], ["&lat=35.6", ["/lng"]]] as const) {
    const res = await site.call("GET", `${base}${query}`, { ip: nextIp() });
    assert.equal(res.body.error.code, "VALIDATION_FAILED", query);
    assert.deepEqual(res.body.error.details.issues.filter((issue: any) => issue.reason === "REQUIRED").map((issue: any) => issue.path), [...missing], query);
  }
  assert.equal(seen.length, 0);
});

test("城市范围的边：正好在 80 公里正方形的角上可以反查，刚出界（1e-7 度）是 OUT_OF_CITY，不调用", async () => {
  await newAdminKey();
  reset();
  for (const corner of [BOUNDS.high, BOUNDS.low, { lat: BOUNDS.high.lat, lng: BOUNDS.low.lng }]) {
    const res = await site.call("GET", reverseUrl(corner), { ip: nextIp() });
    assert.deepEqual([res.status, res.body.available], [200, true], JSON.stringify(corner));
  }
  assert.equal(reverses().length, 3);
  seen.length = 0;
  for (const outside of [{ lat: BOUNDS.high.lat + 1e-7, lng: TOKYO_CENTER.lng }, { lat: TOKYO_CENTER.lat, lng: BOUNDS.low.lng - 1e-7 }]) {
    const res = await site.call("GET", reverseUrl(outside), { ip: nextIp() });
    assert.deepEqual([res.status, res.body.error?.details?.issues?.[0]?.reason], [400, "OUT_OF_CITY"], JSON.stringify(outside));
  }
  assert.equal(seen.length, 0);
});

test("城市：反查也检查渠道授权；停用的城市 UNKNOWN_CITY；官网渠道暂停时 503 SITE_NOT_OPEN——都不调用谷歌", async () => {
  reset();
  const osakaOnly = await newChannel(api, m.staff.cm1.token, { name: "只卖大阪的官网 QA", scope: { city_ids: [m.ids.osaka] } });
  const osakaSite = await openSite({}, {}, (await salesCredentials(api, m, osakaOnly.id)).clientId);
  const outside = await osakaSite.call("GET", reverseUrl({ lat: 35.68, lng: 139.76 }), { ip: nextIp() });
  assert.deepEqual([outside.status, outside.body.error?.details?.issues?.[0]?.reason], [400, "UNKNOWN_CITY"]);

  await api.db.owner.query("update cities set status = 'disabled' where id = $1", [m.ids.osaka]);
  try {
    for (const url of [searchUrl("梅田 酒店", m.ids.osaka), reverseUrl({ lat: 34.7, lng: 135.5 }, m.ids.osaka)]) {
      const res = await site.call("GET", url, { ip: nextIp() });
      assert.deepEqual([res.status, res.body.error?.details?.issues?.[0]?.reason], [400, "UNKNOWN_CITY"], url);
    }
  } finally {
    await api.db.owner.query("update cities set status = 'active' where id = $1", [m.ids.osaka]);
  }

  const pausedChannel = await newChannel(api, m.staff.cm1.token, { name: "暂停的官网 QA" });
  const pausedSite = await openSite({}, {}, (await salesCredentials(api, m, pausedChannel.id)).clientId);
  await api.db.owner.query("update channels set status = 'paused' where id = $1", [pausedChannel.id]);
  for (const url of [searchUrl(freshQuery()), reverseUrl(freshPoint())]) {
    const res = await pausedSite.call("GET", url, { ip: nextIp() });
    assert.deepEqual([res.status, res.body.error?.code], [503, "SITE_NOT_OPEN"], url);
  }
  assert.equal((await ok(pausedSite.call("GET", "/site/v1/config"))).address_search, false);
  assert.equal(seen.length, 0);
  assert.ok(siteChannelId !== pausedChannel.id);
});

// ---- 降级 ----

test("每种谷歌失败都是 200 + available false（搜索和反查），不转述对方原文；计数表记下原因码", async () => {
  const cases: [string, (key: string) => Behavior, string][] = [
    ["401", (key) => ({ status: 401, body: googleError(401, "UNAUTHENTICATED", null, key) }), "KEY_INVALID"],
    ["400 密钥无效", (key) => ({ status: 400, body: googleError(400, "INVALID_ARGUMENT", "API_KEY_INVALID", key) }), "KEY_INVALID"],
    ["403 没开通", (key) => ({ status: 403, body: googleError(403, "PERMISSION_DENIED", "SERVICE_DISABLED", key) }), "API_NOT_ENABLED"],
    ["403 密钥限制", (key) => ({ status: 403, body: googleError(403, "PERMISSION_DENIED", "API_KEY_SERVICE_BLOCKED", key) }), "KEY_RESTRICTED"],
    ["403 没开结算", (key) => ({ status: 403, body: googleError(403, "PERMISSION_DENIED", "BILLING_DISABLED", key) }), "BILLING_DISABLED"],
    ["429", (key) => ({ status: 429, body: googleError(429, "RESOURCE_EXHAUSTED", "RATE_LIMIT_EXCEEDED", key) }), "QUOTA_EXCEEDED"],
    ["500", (key) => ({ status: 500, body: googleError(500, "INTERNAL", null, key) }), "UNAVAILABLE"],
    ["502 HTML", () => ({ status: 502, raw: "<html>Bad Gateway</html>", headers: { "content-type": "text/html" } }), "UNAVAILABLE"],
    ["超时", () => ({ body: {}, delayMs: 5_000 }), "TIMEOUT"],
    ["断开", () => ({ destroy: true }), "UNREACHABLE"],
    ["跳转", () => ({ status: 302, headers: { location: `${origin}/v1/places:searchText?redirected=1` } }), "UNEXPECTED"],
    ["超大且不结束", () => ({ hangAfterBytes: 70 * 1024 }), "UNEXPECTED"],
    ["places 不是数组", () => ({ body: { places: { id: "x" } } }), "UNEXPECTED"],
    ["200 但是 HTML", () => ({ raw: "<html>ok</html>", headers: { "content-type": "text/html" } }), "UNEXPECTED"],
  ];
  for (const [what, make, code] of cases) {
    const key = await newAdminKey();
    reset();
    behave = () => make(key);
    const started = performance.now();
    const res = await site.call("GET", searchUrl(freshQuery()), { ip: nextIp() });
    assert.ok(performance.now() - started < 3_600, `${what} 用了 ${Math.round(performance.now() - started)} 毫秒`);
    assert.deepEqual([res.status, res.body], [200, { available: false, items: [] }], `${what}: ${res.text}`);
    assert.ok(!res.text.includes(key) && !res.text.includes("rejected") && !res.text.includes("Bad Gateway"), what);
    assert.equal((await usage()).last_failure_code, code, what);
    assert.ok(!searches().some((entry) => entry.path.includes("redirected")), `${what}: 跟随了跳转`);
  }
  for (const [what, make, code] of cases.filter(([what]) => ["401", "429", "超时", "跳转"].includes(what))) {
    const key = await newAdminKey();
    reset();
    behave = () => make(key);
    const res = await site.call("GET", reverseUrl(freshPoint()), { ip: nextIp() });
    assert.deepEqual([res.status, res.body], [200, { available: false, address: null }], `反查 ${what}: ${res.text}`);
    assert.equal((await usage()).last_failure_code, code, `反查 ${what}`);
  }
  await newAdminKey();
  reset();
});

// ---- 报价按坐标 ----

test("报价按坐标：营运区（139–140, 35–36）边上的点算在里面，刚出边界 0.0001 度就是 OUT_OF_SERVICE_AREA", async () => {
  const quote = (address: LatLng) =>
    site.call("POST", "/site/v1/quotes", { ip: nextIp(), body: { city_id: m.ids.tokyo, airport_id: m.ids.narita, direction: "pickup", address, service_local: "2026-10-20T10:00", passengers: 2, luggage: 1 } });
  for (const edge of [{ lng: 139.0, lat: 35.6 }, { lng: 139.5, lat: 36.0 }, { lng: 139.0, lat: 35.0 }]) {
    const inside = await ok(quote(edge));
    assert.ok(inside.quotes.length > 0, `${JSON.stringify(edge)} ${JSON.stringify(inside)}`);
  }
  for (const beyond of [{ lng: 138.9999, lat: 35.6 }, { lng: 139.5, lat: 36.0001 }]) {
    const outside = await ok(quote(beyond));
    assert.equal(outside.quotes.length, 0, JSON.stringify(beyond));
    assert.ok(outside.unavailable.some((entry: any) => entry.reasons.includes("OUT_OF_SERVICE_AREA")), JSON.stringify(outside));
  }
});

// ---- 不外泄 ----

test("日志只有原因码：失败的搜索和反查之后，日志里没有关键字、坐标、任何一把密钥；计数表、限流表里没有来源地址原文和密钥", async () => {
  const key = await newAdminKey();
  reset();
  behave = () => ({ status: 403, body: googleError(403, "PERMISSION_DENIED", "API_KEY_SERVICE_BLOCKED", key) });
  const marker = `QA日志标记${randomUUID().slice(0, 8)}`;
  const ip = "203.0.113.199";
  logs = "";
  await site.call("GET", searchUrl(marker), { ip });
  await newAdminKey();
  behave = () => ({ status: 500, body: googleError(500, "INTERNAL", null, currentKey()) });
  await site.call("GET", reverseUrl({ lat: 35.612345, lng: 139.654321 }), { ip });
  assert.match(logs, /"placeFailure":"KEY_RESTRICTED"/);
  assert.match(logs, /"placeFailure":"UNAVAILABLE"/);
  for (const needle of [marker, encodeURIComponent(marker), "35.6123", "139.6543", ...adminKeys]) assert.ok(!logs.includes(needle), `日志里有 ${needle.slice(0, 16)}`);
  const usageRows = (await api.db.owner.query("select * from place_api_usage")).rows;
  const limitRows = (await api.db.owner.query("select * from sales_rate_limits")).rows;
  for (const [what, rows] of [["place_api_usage", usageRows], ["sales_rate_limits", limitRows]] as const) {
    const values = [...allValues(rows)];
    for (const needle of [ip, marker, ...adminKeys]) assert.ok(!values.some((value) => value.includes(needle)), `${what} 里有 ${needle.slice(0, 16)}`);
  }
  reset();
});

// ---- 限速（按来源地址） ----

test("每分钟 20 次：第 21 次 429 + Retry-After（1–60 秒）；等满 Retry-After 秒后恢复；搜索和反查共用", async () => {
  const ip = "203.0.113.120";
  const q = freshQuery();
  for (let i = 0; i < 20; i++) assert.equal((await site.call("GET", i % 2 === 0 ? searchUrl(q) : reverseUrl({ lat: 35.6, lng: 139.6 }), { ip })).status, 200, `第 ${i + 1} 次`);
  const limited = await site.call("GET", searchUrl(q), { ip });
  assert.deepEqual([limited.status, limited.body.error.code], [429, "RATE_LIMITED"]);
  const wait = Number(limited.headers["retry-after"]);
  assert.ok(Number.isInteger(wait) && wait >= 1 && wait <= 60, `Retry-After ${limited.headers["retry-after"]}`);
  api.clock.advance(wait * 1_000);
  assert.equal((await site.call("GET", reverseUrl({ lat: 35.6, lng: 139.6 }), { ip })).status, 200);
});

test("伪造 X-Forwarded-For 绕不过：TRUST_PROXY_HOPS=0 时这个头不起作用；=1 时只认最近一层代理追加的地址，客户端塞在前面的不算", async () => {
  const q = freshQuery();
  const direct = "203.0.113.122";
  for (let i = 0; i < 20; i++) assert.equal((await site.call("GET", searchUrl(q), { ip: direct, headers: { "x-forwarded-for": `198.51.100.${i}` } })).status, 200);
  assert.equal((await site.call("GET", searchUrl(q), { ip: direct, headers: { "x-forwarded-for": "198.51.100.99" } })).status, 429);

  const proxied = await openSite({ TRUST_PROXY_HOPS: "1" });
  const viaProxy = (forwarded: string) => proxied.call("GET", searchUrl(q), { ip: "10.0.0.2", headers: { "x-forwarded-for": forwarded } });
  for (let i = 0; i < 20; i++) assert.equal((await viaProxy(`1.1.1.${i}, 203.0.113.123`)).status, 200);
  assert.equal((await viaProxy("1.1.1.250, 203.0.113.123")).status, 429, "换着伪造前面的地址就绕过了限速");
  assert.equal((await viaProxy("1.1.1.250, 203.0.113.124")).status, 200, "代理后面的另一个真实客人不受影响");
});

// 放在最后：时钟往前拨了 24 小时以上，之后员工的登录令牌都过期了
test("每天 300 次：第 301 次 429，Retry-After 是小时级的；过了 24 小时恢复", async () => {
  const ip = "203.0.113.121";
  const q = freshQuery();
  for (let used = 0; used < 300; used++) {
    if (used % 20 === 0) api.clock.advance(61_000);
    assert.equal((await site.call("GET", searchUrl(q), { ip })).status, 200, `第 ${used + 1} 次`);
  }
  api.clock.advance(61_000);
  const limited = await site.call("GET", searchUrl(q), { ip });
  assert.equal(limited.status, 429);
  assert.ok(Number(limited.headers["retry-after"]) > 3_600, `Retry-After ${limited.headers["retry-after"]}`);
  api.clock.advance(24 * 3_600_000);
  assert.equal((await site.call("GET", searchUrl(q), { ip })).status, 200);
});
