/**
 * M12-07：地址搜索按客人输入的语言请求谷歌（ADR 0108），经真实接口、真实 PostgreSQL；谷歌（Text Search、Autocomplete、Place Details、Geocoding）
 * 全是本机的假服务器（testing/fake-integrations.ts），**从不调用真实的谷歌**。
 *
 * 覆盖：
 * - 地址搜索、输入即提示：中文、日文、英文输入各一条，请求谷歌带的 `languageCode` 分别是 zh-CN、ja、en；中日写法相同的按页面语言 `lang`，不带时 zh-CN；
 * - 缓存键带语言：同一关键字不同语言各调一次谷歌、互不覆盖；同一语言再问命中缓存；
 * - 取坐标沿用同一会话输入即提示的语言（页面语言不同也一样）；没带会话按页面语言；同一地点不同语言分开缓存；
 * - 反查按页面语言，不带时 zh-CN，不同语言分开缓存；
 * - 嵌入组件不带 `lang` 时用嵌入码的默认语言；
 * - `lang` 只收 zh / ja / en；全站每日计数、每个地址每天的额度照旧只计真调谷歌的（换语言算一次新的调用）。
 * 官网公开接口，不涉及租户隔离。测试数据全在本文件里经接口建出来，随测试 schema 一起删除。
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
let places: FakeService;
let autocomplete: FakeService;
let details: FakeService;
let geocode: FakeService;
let embedKey: string;
const PARTNER = "https://partner.example";

let ipSeq = 0;
const nextIp = (): string => `10.77.${Math.floor(++ipSeq / 200)}.${ipSeq % 200}`;
let seq = 0;
/** 每条用例自己的后缀，互不命中对方的缓存 */
const fresh = (): number => ++seq;
const session = (): string => `m1207-session-${String(fresh()).padStart(10, "0")}`;
const qs = (params: Record<string, string | number | undefined>): string =>
  Object.entries(params)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([name, value]) => `${name}=${encodeURIComponent(String(value))}`)
    .join("&");

const search = (q: string, lang?: string, ip = nextIp()) => site.call("GET", `/site/v1/places/search?${qs({ city_id: m.ids.tokyo, q, lang })}`, { ip });
const suggest = (q: string, sessionToken: string, lang?: string, ip = nextIp()) => site.call("GET", `/site/v1/places/autocomplete?${qs({ q, session: sessionToken, lang })}`, { ip });
const pick = (id: string, sessionToken: string | undefined, lang?: string, ip = nextIp()) => site.call("GET", `/site/v1/places/details?${qs({ id, session: sessionToken, lang })}`, { ip });
const reverse = (point: { lat: number; lng: number }, lang?: string, ip = nextIp()) => site.call("GET", `/site/v1/places/reverse?${qs({ city_id: m.ids.tokyo, lat: point.lat, lng: point.lng, lang })}`, { ip });

/** 假谷歌收到的请求里的语言：搜索、输入即提示在请求体，取坐标、反查在网址 */
const bodyLanguages = (fake: FakeService): string[] => fake.requests.map((request) => (JSON.parse(request.body) as { languageCode: string }).languageCode);
const urlLanguages = (fake: FakeService): string[] => fake.requests.map((request) => new URL(request.path, "http://x").searchParams.get("languageCode") ?? "");
const reset = (): void => {
  for (const fake of [places, autocomplete, details, geocode]) fake.requests.length = 0;
};
const globalCalls = async (): Promise<number> => (await api.db.owner.query<{ calls: number }>("select calls from place_api_usage where day = $1", [routeUsageDay(api.clock.now())])).rows[0]?.calls ?? 0;
/** 这个地址今天调谷歌的额度扣了几次（M8-45） */
const charged = async (ip: string): Promise<number> => {
  const bucket = createHash("sha256").update(`site-ip:${rateLimitKeyOf(ip)}`, "utf8").digest("hex");
  return (await api.db.owner.query<{ attempt_count: number }>("select attempt_count from sales_rate_limits where bucket = $1", [`site_places_google_day:${bucket}`])).rows[0]?.attempt_count ?? 0;
};

before(async () => {
  places = await startFakeGooglePlaces();
  autocomplete = await startFakeGoogleAutocomplete();
  details = await startFakeGooglePlaceDetails();
  geocode = await startFakeGoogleGeocode();
  places.respond({ body: googlePlacesBody([googlePlace("ChIJfakeTokyoStation", "東京駅", 35.6812, 139.7671, "日本、〒100-0005 東京都千代田区丸の内１丁目")]) });
  autocomplete.respond({ body: googleAutocompleteBody([googlePrediction("ChIJfakeTokyoStation", "東京駅", "日本、東京都千代田区", ["train_station"])]) });
  details.respond({ body: googleDetailsBody("ChIJfakeTokyoStation", 35.6812, 139.7671, "日本、〒100-0005 東京都千代田区丸の内１丁目", ["train_station"]) });
  geocode.respond({ body: googleGeocodeBody("日本、〒100-0005 東京都千代田区丸の内１丁目９") });
  api = await createTestApi({ payments: new FakePaymentProvider(), integrationSecretsTtlMs: 0 });
  m = await buildMarket(api);
  const channel = await newChannel(api, m.staff.cm1.token, { name: "NOZOMI 官网" });
  const env = { GOOGLE_PLACES_SEARCH_URL: places.url, GOOGLE_PLACES_AUTOCOMPLETE_URL: autocomplete.url, GOOGLE_PLACE_DETAILS_URL: details.url, GOOGLE_GEOCODE_URL: geocode.url };
  site = await siteApi(api, (await salesCredentials(api, m, channel.id)).clientId, new FakePaymentProvider(), env, { integrationSecretsTtlMs: 0 });
  const key = await api.call("POST", "/platform/v1/embed-keys", { token: m.staff.operations.token, body: { name: "合作网站", allowed_origins: [PARTNER], default_lang: "ja", default_services: ["transfer"] } });
  assert.equal(key.status, 201, key.text);
  embedKey = key.body.key;
});
after(async () => {
  await site?.close();
  await api.close();
  for (const fake of [places, autocomplete, details, geocode]) await fake.close();
});

test("地址搜索：中文输入给中文、日文给日文、英文给英文（请求谷歌的 languageCode）；判断不出按页面语言，不带时 zh-CN", async () => {
  reset();
  const n = fresh();
  const cases: [string, string | undefined, string][] = [
    [`银座 酒店 ${n}`, undefined, "zh-CN"],
    [`渋谷 ホテル ${n}`, undefined, "ja"],
    [`Shinjuku Station ${n}`, undefined, "en"],
    [`银座 酒店 ${n} 二`, "ja", "zh-CN"],
    [`新宿 ${n}`, undefined, "zh-CN"],
    [`新宿 ${n} 二`, "ja", "ja"],
    [`新宿 ${n} 三`, "en", "en"],
  ];
  for (const [q, lang] of cases) {
    const res = await search(q, lang);
    assertMatchesOpenApi("GET", "/site/v1/places/search", res);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.body.available, true);
  }
  assert.deepEqual(bodyLanguages(places), cases.map((entry) => entry[2]));
  assert.deepEqual(places.requests.map((request) => (JSON.parse(request.body) as { textQuery: string }).textQuery), cases.map((entry) => entry[0]));
});

test("缓存键带语言：同一关键字不同语言各调一次谷歌、互不覆盖；同一语言再问（大小写、全角半角不同）命中缓存；全站计数和每个地址的额度只计真调谷歌的", async () => {
  reset();
  const q = `新宿 ${fresh()}`;
  const ip = nextIp();
  const [callsBefore, chargedBefore] = [await globalCalls(), await charged(ip)];
  await ok(search(q, "zh", ip));
  await ok(search(q, "ja", ip));
  await ok(search(q, "en", ip));
  assert.deepEqual(bodyLanguages(places), ["zh-CN", "ja", "en"], "三种语言各调一次");
  await ok(search(q, undefined, ip));
  await ok(search(q.normalize("NFKC").replace(/\d/g, (digit) => String.fromCharCode(digit.charCodeAt(0) + 0xfee0)), "ja", ip));
  await ok(search(q, "en", ip));
  assert.equal(places.requests.length, 3, "不带 lang 就是 zh-CN，和全角数字的日文、英文都命中各自的缓存");
  assert.equal((await globalCalls()) - callsBefore, 3, "全站每日计数：三次真调谷歌");
  assert.equal((await charged(ip)) - chargedBefore, 3, "这个地址的日额度：三次真调谷歌，命中缓存的不扣");
  // 判断得出语言的关键字不看页面语言：不同页面语言共用一份缓存
  const english = `Hilton Ginza ${fresh()}`;
  await ok(search(english, "zh"));
  await ok(search(english, "ja"));
  assert.deepEqual(bodyLanguages(places).slice(3), ["en"]);
});

test("输入即提示：中文、日文、英文输入各一条；同一关键字不同页面语言分开缓存；同一会话选中后取坐标沿用输入即提示的语言", async () => {
  reset();
  const n = fresh();
  const cases: [string, string | undefined, string][] = [
    [`东京站 ${n}`, "en", "zh-CN"],
    [`東京駅 ${n}`, "en", "ja"],
    [`Tokyo Station ${n}`, "ja", "en"],
    [`大阪 ${n}`, undefined, "zh-CN"],
    [`大阪 ${n}`, "en", "en"],
    [`大阪 ${n}`, "en", "en"],
  ];
  for (const [q, lang] of cases) {
    const res = await suggest(q, session(), lang);
    assertMatchesOpenApi("GET", "/site/v1/places/autocomplete", res);
    assert.equal(res.status, 200, res.text);
  }
  assert.deepEqual(bodyLanguages(autocomplete), ["zh-CN", "ja", "en", "zh-CN", "en"], "最后一条命中英文的缓存");

  // 英文输入的会话：页面是中文，选中后取坐标照样用英文
  const english = session();
  await ok(suggest(`Hilton Tokyo ${fresh()}`, english, "zh"));
  const picked = await pick("ChIJlangEnglish", english, "zh");
  assertMatchesOpenApi("GET", "/site/v1/places/details", picked);
  assert.equal(picked.body.available, true);
  // 日文输入的会话、输入即提示命中缓存的也一样记下语言
  const japanese = session();
  await ok(suggest(`東京駅 ${n}`, japanese, "en"));
  await ok(pick("ChIJlangJapanese", japanese, "en"));
  // 同一会话先输入英文、又改成中文：按最后一次
  const changed = session();
  await ok(suggest(`Ginza ${fresh()}`, changed));
  await ok(suggest(`银座 ${fresh()}`, changed, "en"));
  await ok(pick("ChIJlangChanged", changed, "en"));
  // 没带会话：按页面语言，不带时 zh-CN；没见过的会话同样
  await ok(pick("ChIJlangNoSession", undefined, "ja"));
  await ok(pick("ChIJlangNoSession2", undefined));
  await ok(pick("ChIJlangUnknown", session(), "en"));
  assert.deepEqual(
    details.requests.map((request) => [request.path.split("?")[0], new URL(request.path, "http://x").searchParams.get("languageCode")]),
    [
      ["/v1/places/ChIJlangEnglish", "en"],
      ["/v1/places/ChIJlangJapanese", "ja"],
      ["/v1/places/ChIJlangChanged", "zh-CN"],
      ["/v1/places/ChIJlangNoSession", "ja"],
      ["/v1/places/ChIJlangNoSession2", "zh-CN"],
      ["/v1/places/ChIJlangUnknown", "en"],
    ],
  );
  assert.equal(new URL((details.requests[0] as FakeService["requests"][number]).path, "http://x").searchParams.get("sessionToken"), english, "会话令牌照传");
});

test("取坐标的缓存键带语言：同一地点不同语言各调一次，同一语言命中缓存", async () => {
  reset();
  const id = `ChIJlangCache${fresh()}`;
  await ok(pick(id, undefined, "zh"));
  await ok(pick(id, undefined, "ja"));
  await ok(pick(id, undefined));
  await ok(pick(id, undefined, "ja"));
  const english = session();
  await ok(suggest(`Hotel ${fresh()}`, english));
  await ok(pick(id, english, "ja"));
  assert.deepEqual(urlLanguages(details), ["zh-CN", "ja", "en"]);
});

test("反查：按页面语言（没有输入的文字），不带时 zh-CN；同一个格子不同语言分开缓存", async () => {
  reset();
  const point = { lat: 35.6, lng: Number((139.6 + fresh() * 0.001).toFixed(4)) };
  for (const lang of [undefined, "ja", "en", "zh", "ja"]) {
    const res = await reverse(point, lang);
    assertMatchesOpenApi("GET", "/site/v1/places/reverse", res);
    assert.deepEqual(res.body, { available: true, address: "日本、〒100-0005 東京都千代田区丸の内１丁目９" });
  }
  assert.deepEqual(urlLanguages(geocode), ["zh-CN", "ja", "en"]);
  assert.equal(new URL((geocode.requests[1] as FakeService["requests"][number]).path, "http://x").searchParams.get("regionCode"), "JP");
});

test("嵌入组件：不带 lang 时用嵌入码的默认语言（这把是日文），带了按带的；判断得出的照旧按输入", async () => {
  reset();
  const n = fresh();
  const embed = (path: string) => site.call("GET", `${path}&key=${encodeURIComponent(embedKey)}`, { ip: nextIp(), headers: { origin: PARTNER } });
  const sessionToken = session();
  for (const [q, lang] of [[`新宿 ${n}`, undefined], [`新宿 ${n} 二`, "en"], [`东京站 ${n}`, undefined]] as const) {
    const res = await embed(`/embed/v1/places/autocomplete?${qs({ q, session: sessionToken, lang })}`);
    assertMatchesOpenApi("GET", "/embed/v1/places/autocomplete", res);
    assert.equal(res.status, 200, res.text);
  }
  assert.deepEqual(bodyLanguages(autocomplete), ["ja", "en", "zh-CN"]);
  const picked = await embed(`/embed/v1/places/details?${qs({ id: `ChIJlangEmbed${n}`, session: sessionToken })}`);
  assertMatchesOpenApi("GET", "/embed/v1/places/details", picked);
  await ok(embed(`/embed/v1/places/details?${qs({ id: `ChIJlangEmbedNoSession${n}` })}`));
  assert.deepEqual(urlLanguages(details), ["zh-CN", "ja"], "同一会话沿用最后一次输入（中文）；没带会话用嵌入码的默认语言");
});

test("lang 只收 zh / ja / en：别的写法 400 VALIDATION_FAILED，不调谷歌", async () => {
  reset();
  for (const res of [await search("新宿 酒店", "zh-CN"), await suggest("新宿 酒店", session(), "ko"), await pick("ChIJx", undefined, "JA"), await reverse({ lat: 35.6, lng: 139.6 }, "fr")]) {
    assert.equal(res.status, 400, res.text);
    assert.equal(res.body.error.code, "VALIDATION_FAILED");
  }
  assert.equal(places.requests.length + autocomplete.requests.length + details.requests.length + geocode.requests.length, 0);
});
