/**
 * M8-45：每个来源地址每天的地址提示额度只计**真要调谷歌**的请求（`site_places_google_day`，300 次，IPv6 按 /64），经真实接口、真实 PostgreSQL；
 * 谷歌（Autocomplete、Place Details、Text Search、Geocoding）全是本机的假服务器（testing/fake-integrations.ts），**从不调用真实的谷歌**。
 *
 * 业主 2026-11-14 在测试站实测：命中缓存、不花钱的请求也扣日额度，打满后整整 24 小时都 429、页面说「输入太快了」。改为：
 * - 同一个地址反复问同一个词（命中进程内缓存）不扣日额度；问新词（调谷歌）每次扣一次；
 * - 扣满以后不 429：不调谷歌，200 + `available: false` + `unavailable_reason: "IP_DAILY_LIMIT"`，平台的机场、车站照常给；
 *   输入即提示、取坐标、搜索、反查共用这份额度；别的地址照常调谷歌（不冷却、不记进全站的计数）；还在缓存里的词照常有谷歌的候选；
 * - 每分钟 60 次（`site_autocomplete`）仍在入口扣，超了 429；
 * - IPv6 按 /64；嵌入组件 `/embed/v1/places/*` 和官网同一份日额度、同一口径；
 * - 并发：同一个新词，额度用完的地址和没用完的地址同时问，没用完的那位照样拿到谷歌的候选。
 * 测试数据全在本文件里经接口建出来，随测试 schema 一起删除。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { rateLimitKeyOf, routeUsageDay } from "@nozomi/domain";
import { type TestApi, createTestApi } from "./testing/api.ts";
import {
  type FakeService,
  googleAutocompleteBody,
  googleDetailsBody,
  googleGeocodeBody,
  googlePlace,
  googlePlacesBody,
  googlePrediction,
  startFakeGoogleAutocomplete,
  startFakeGoogleGeocode,
  startFakeGooglePlaceDetails,
  startFakeGooglePlaces,
} from "./testing/fake-integrations.ts";
import { type Market, buildMarket, newChannel, ok, salesCredentials } from "./testing/market.ts";
import { assertMatchesOpenApi } from "./testing/openapi.ts";
import { FakePaymentProvider } from "./testing/payments.ts";
import { type SiteApi, siteApi } from "./testing/site.ts";

let api: TestApi;
let m: Market;
let site: SiteApi;
let autocomplete: FakeService;
let details: FakeService;
let places: FakeService;
let geocode: FakeService;
let embedKey: string;
const PARTNER = "https://partner.example";
const SESSION = "m845-session-0123456789";
const DAILY = 300;
const TOKYO_STATION = { lat: 35.6812, lng: 139.7671 };

let seq = 0;
/** 每次一个没人问过的词（不命中缓存，一定调谷歌） */
const freshWord = (): string => `酒店 ${++seq}`;
const googleCalls = (): number => autocomplete.requests.length + details.requests.length + places.requests.length + geocode.requests.length;
const ask = (word: string, ip: string, app: SiteApi = site) => app.call("GET", `/site/v1/places/autocomplete?q=${encodeURIComponent(word)}&session=${SESSION}`, { ip });
const embedAsk = (word: string, ip: string) => site.call("GET", `/embed/v1/places/autocomplete?q=${encodeURIComponent(word)}&session=${SESSION}&key=${encodeURIComponent(embedKey)}`, { ip, headers: { origin: PARTNER } });
/** 这个地址（的限流键）今天的谷歌额度已经扣了几次 */
const charged = async (ip: string): Promise<number> => {
  const bucket = createHash("sha256").update(`site-ip:${rateLimitKeyOf(ip)}`, "utf8").digest("hex");
  const row = (await api.db.owner.query<{ attempt_count: number }>("select attempt_count from sales_rate_limits where bucket = $1", [`site_places_google_day:${bucket}`])).rows[0];
  return row?.attempt_count ?? 0;
};
const globalCalls = async (): Promise<number> => (await api.db.owner.query<{ calls: number }>("select calls from place_api_usage where day = $1", [routeUsageDay(api.clock.now())])).rows[0]?.calls ?? 0;

/** 用 `ipOf(i)` 的地址问 300 个新词（每个都调谷歌），每分钟不超过 60 次 */
async function useUp(ipOf: (i: number) => string): Promise<void> {
  for (let i = 0; i < DAILY; i++) {
    if (i % 60 === 0) api.clock.advance(61_000);
    const res = await ask(freshWord(), ipOf(i));
    assert.deepEqual([res.status, res.body.available, res.body.unavailable_reason], [200, true, undefined], `第 ${i + 1} 次`);
  }
  api.clock.advance(61_000);
}

before(async () => {
  autocomplete = await startFakeGoogleAutocomplete();
  details = await startFakeGooglePlaceDetails();
  places = await startFakeGooglePlaces();
  geocode = await startFakeGoogleGeocode();
  autocomplete.respond({ body: googleAutocompleteBody([googlePrediction("ChIJfakeHotel", "ホテル", "日本、東京都新宿区", ["lodging"])]) });
  details.respond({ body: googleDetailsBody("ChIJfakeHotel", 35.69, 139.7, "日本、東京都新宿区", ["lodging"]) });
  places.respond({ body: googlePlacesBody([googlePlace("ChIJfakeHotel", "ホテル", 35.69, 139.7, "日本、東京都新宿区")]) });
  geocode.respond({ body: googleGeocodeBody("日本、東京都新宿区") });
  api = await createTestApi({ payments: new FakePaymentProvider(), integrationSecretsTtlMs: 0 });
  m = await buildMarket(api);
  await ok(api.call("POST", "/platform/v1/master/places", { token: m.root, body: { type: "station", code: "STN-JP-M845", city_id: m.ids.tokyo, category: "shinkansen", name: { zh: "东京站" }, location: TOKYO_STATION } }), 201);
  const channel = await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" });
  const env = {
    GOOGLE_PLACES_AUTOCOMPLETE_URL: autocomplete.url,
    GOOGLE_PLACE_DETAILS_URL: details.url,
    GOOGLE_PLACES_SEARCH_URL: places.url,
    GOOGLE_GEOCODE_URL: geocode.url,
    // 全站的每日上限放宽：本文件测的是每个地址的额度
    GOOGLE_PLACES_DAILY_LIMIT: "100000",
  };
  site = await siteApi(api, (await salesCredentials(api, m, channel.id)).clientId, new FakePaymentProvider(), env, { integrationSecretsTtlMs: 0 });
  const key = await api.call("POST", "/platform/v1/embed-keys", { token: m.staff.operations.token, body: { name: "合作网站", allowed_origins: [PARTNER], default_lang: "ja", default_services: ["transfer"] } });
  assert.equal(key.status, 201, key.text);
  embedKey = key.body.key;
});
after(async () => {
  await site?.close();
  await api.close();
  for (const fake of [autocomplete, details, places, geocode]) await fake.close();
});

test("命中缓存不扣日额度：同一个地址问同一个词 120 次（跨三分钟），只调一次谷歌、只扣 1 次；问别的新词再扣 1 次", async () => {
  const ip = "203.0.113.45";
  const word = freshWord();
  const before = googleCalls();
  for (let i = 0; i < 120; i++) {
    if (i % 60 === 0) api.clock.advance(61_000);
    const res = await ask(word, ip);
    assert.deepEqual([res.status, res.body.available], [200, true], `第 ${i + 1} 次`);
  }
  assert.equal(googleCalls() - before, 1);
  assert.equal(await charged(ip), 1);
  api.clock.advance(61_000);
  assert.equal((await ask(freshWord(), ip)).body.available, true);
  assert.equal(await charged(ip), 2);
  // 回头再问第一个词：还在缓存里，不扣
  assert.equal((await ask(word, ip)).body.available, true);
  assert.equal(await charged(ip), 2);
  api.clock.advance(61_000);
});

test("调谷歌的扣额度：300 个新词后，第 301 个不调谷歌，200 + available false + unavailable_reason，平台地点照常；取坐标、搜索、反查共用；缓存里的词照常；别的地址照常；每分钟 60 次仍 429", async () => {
  const ip = "203.0.113.46";
  const cachedWord = `酒店 ${seq + 1}`;
  await useUp(() => ip);
  assert.equal(await charged(ip), DAILY);
  const callsBefore = googleCalls();
  const globalBefore = await globalCalls();

  const limited = await ask("东京站", ip);
  assertMatchesOpenApi("GET", "/site/v1/places/autocomplete", limited);
  assert.equal(limited.status, 200, "日额度用完不 429");
  assert.equal(limited.body.available, false);
  assert.equal(limited.body.unavailable_reason, "IP_DAILY_LIMIT");
  assert.deepEqual(limited.body.items.map((item: any) => [item.source, item.name]), [["platform", "东京站"]], "平台的车站照常给");

  const picked = await site.call("GET", `/site/v1/places/details?id=ChIJfakeOther&session=${SESSION}`, { ip });
  assertMatchesOpenApi("GET", "/site/v1/places/details", picked);
  assert.deepEqual(picked.body, { available: false, unavailable_reason: "IP_DAILY_LIMIT", place: null });
  const searched = await site.call("GET", `/site/v1/places/search?city_id=${m.ids.tokyo}&q=${encodeURIComponent(freshWord())}`, { ip });
  assertMatchesOpenApi("GET", "/site/v1/places/search", searched);
  assert.deepEqual(searched.body, { available: false, unavailable_reason: "IP_DAILY_LIMIT", items: [] });
  const reversed = await site.call("GET", `/site/v1/places/reverse?city_id=${m.ids.tokyo}&lat=35.61&lng=139.61`, { ip });
  assertMatchesOpenApi("GET", "/site/v1/places/reverse", reversed);
  assert.deepEqual(reversed.body, { available: false, unavailable_reason: "IP_DAILY_LIMIT", address: null });
  assert.equal(googleCalls(), callsBefore, "一次谷歌都没调");
  assert.equal(await globalCalls(), globalBefore, "不占全站的每日名额");

  const cached = await ask(cachedWord, ip);
  assert.deepEqual([cached.body.available, cached.body.unavailable_reason, cached.body.items.at(-1)?.source], [true, undefined, "google"], "还在缓存里的词照常有谷歌的候选");

  const other = await ask(freshWord(), "203.0.113.47");
  assert.deepEqual([other.status, other.body.available, other.body.unavailable_reason], [200, true, undefined], "别的地址照常调谷歌（没有被冷却）");
  assert.equal(googleCalls(), callsBefore + 1);

  // 每分钟 60 次照旧在入口扣（输入即提示和取坐标合计）：这一分钟已经问了 3 次
  const statuses: number[] = [];
  for (let i = 0; i < 58; i++) statuses.push((await ask(cachedWord, ip)).status);
  assert.deepEqual([statuses.slice(0, 57).every((status) => status === 200), statuses[57]], [true, 429]);
  const tooFast = await ask(cachedWord, ip);
  assertMatchesOpenApi("GET", "/site/v1/places/autocomplete", tooFast);
  assert.equal(tooFast.body.error.code, "RATE_LIMITED");
  api.clock.advance(61_000);
});

test("IPv6 按 /64：同一 /64 里每次换地址用满 300 次，同一 /64 的另一个地址也用完；别的 /64 照常", async () => {
  await useUp((i) => `2001:db8:845:1::${(i + 1).toString(16)}`);
  const same = await ask(freshWord(), "2001:db8:845:1:ffff::9");
  assert.deepEqual([same.status, same.body.available, same.body.unavailable_reason], [200, false, "IP_DAILY_LIMIT"]);
  const other = await ask(freshWord(), "2001:db8:845:2::1");
  assert.deepEqual([other.status, other.body.available, other.body.unavailable_reason], [200, true, undefined]);
  api.clock.advance(61_000);
});

test("嵌入组件和官网同一份日额度、同一口径：命中缓存不扣、调谷歌扣；官网用完的地址在嵌入组件里也是 available false + unavailable_reason，不 429", async () => {
  const ip = "203.0.113.48";
  const word = freshWord();
  for (let i = 0; i < 5; i++) {
    const res = await embedAsk(word, ip);
    assertMatchesOpenApi("GET", "/embed/v1/places/autocomplete", res);
    assert.deepEqual([res.status, res.body.available], [200, true]);
  }
  assert.equal(await charged(ip), 1, "嵌入组件的缓存命中也不扣");
  assert.equal((await ask(freshWord(), ip)).body.available, true);
  assert.equal(await charged(ip), 2, "官网和嵌入组件扣的是同一份");

  const usedUp = "203.0.113.46";
  const limited = await embedAsk(freshWord(), usedUp);
  assertMatchesOpenApi("GET", "/embed/v1/places/autocomplete", limited);
  assert.deepEqual([limited.status, limited.body.available, limited.body.unavailable_reason], [200, false, "IP_DAILY_LIMIT"]);
  assert.equal(limited.headers["access-control-allow-origin"], PARTNER);
  const picked = await site.call("GET", `/embed/v1/places/details?id=ChIJfakeEmbed&session=${SESSION}&key=${encodeURIComponent(embedKey)}`, { ip: usedUp, headers: { origin: PARTNER } });
  assertMatchesOpenApi("GET", "/embed/v1/places/details", picked);
  assert.deepEqual(picked.body, { available: false, unavailable_reason: "IP_DAILY_LIMIT", place: null });
  api.clock.advance(61_000);
});

test("并发：同一个新词，额度用完的地址和没用完的地址同时问——没用完的那位照样拿到谷歌的候选，谷歌只调一次", async () => {
  autocomplete.respond({ body: googleAutocompleteBody([googlePrediction("ChIJfakeHotel", "ホテル", "日本、東京都新宿区", ["lodging"])]), delayMs: 200 });
  try {
    for (const order of ["limited-first", "fresh-first"] as const) {
      const word = freshWord();
      const before = autocomplete.requests.length;
      const limitedCall = (): ReturnType<typeof ask> => ask(word, "203.0.113.46");
      const freshCall = (): ReturnType<typeof ask> => ask(word, `203.0.113.${order === "limited-first" ? 49 : 50}`);
      const [first, second] = order === "limited-first" ? [limitedCall(), freshCall()] : [freshCall(), limitedCall()];
      const [a, b] = await Promise.all([first, second]);
      const fresh = order === "limited-first" ? b : a;
      assert.deepEqual([fresh.status, fresh.body.available, fresh.body.items.at(-1)?.source], [200, true, "google"], order);
      assert.equal(autocomplete.requests.length - before, 1, order);
    }
  } finally {
    autocomplete.respond({ body: googleAutocompleteBody([googlePrediction("ChIJfakeHotel", "ホテル", "日本、東京都新宿区", ["lodging"])]) });
  }
});
