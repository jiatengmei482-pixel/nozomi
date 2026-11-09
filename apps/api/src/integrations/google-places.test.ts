/**
 * 官网地址搜索和反查的谷歌调用（M3-12，ADR 0044）：`searchPlaces`、`reverseGeocode`。不联网：请求发到本机的假服务器，
 * 核对发出去的请求（密钥只在请求头、字段掩码、范围限制、语言）、应答的解析和清理、各种失败的归类、重试和时限、不跟随重定向、64 KB、每日上限的钩子。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { type IncomingMessage, type Server, createServer } from "node:http";
import { cityBounds } from "@nozomi/domain";
import { MAX_RESPONSE_BYTES } from "./google-maps.ts";
import {
  PLACE_AUTOCOMPLETE_FIELD_MASK,
  PLACE_DETAILS_FIELD_MASK,
  PLACE_SEARCH_FIELD_MASK,
  REVERSE_FIELD_MASK,
  autocompletePlaces,
  parsePlaceAutocomplete,
  parsePlaceDetails,
  parsePlaceSearch,
  parseReverse,
  placeDetails,
  placeDetailsUrl,
  reverseGeocode,
  reverseGeocodeUrl,
  searchPlaces,
} from "./google-places.ts";

interface Seen {
  method: string;
  path: string;
  headers: IncomingMessage["headers"];
  body: string;
}
type Reply = { status: number; body: unknown; delayMs?: number; headers?: Record<string, string> };

let server: Server;
let origin = "";
let handler: () => Reply = () => ({ status: 200, body: {} });
const seen: Seen[] = [];
const KEY = "AIzaFakePlacePlacePlacePlace00001234";
const TOKYO = { lat: 35.6812, lng: 139.7671 };
const BOUNDS = cityBounds(TOKYO);
const SEARCH = { query: "东京站 酒店", bounds: BOUNDS, regionCode: "JP" };

before(async () => {
  server = createServer((request, response) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => (raw += chunk));
    request.on("end", () => {
      seen.push({ method: request.method ?? "", path: request.url ?? "", headers: request.headers, body: raw });
      const reply = handler();
      const send = (): void => {
        if (response.destroyed) return;
        response.writeHead(reply.status, { "content-type": "application/json", ...reply.headers });
        response.end(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body));
      };
      if (reply.delayMs) setTimeout(send, reply.delayMs).unref();
      else send();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  origin = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const googleError = (code: number, status: string, reason: string | null): unknown => ({
  error: { code, message: `upstream says something about ${KEY}`, status, details: reason === null ? [] : [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason, domain: "googleapis.com" }] },
});
const place = (id: string, name: string, lat: number, lng: number, address = "日本東京都千代田区丸の内1丁目"): unknown => ({ id, displayName: { text: name, languageCode: "ja" }, formattedAddress: address, location: { latitude: lat, longitude: lng } });

const search = (reply: Reply | (() => Reply), options: Partial<Parameters<typeof searchPlaces>[2]> = {}): ReturnType<typeof searchPlaces> => {
  seen.length = 0;
  handler = typeof reply === "function" ? reply : () => reply;
  return searchPlaces(KEY, SEARCH, { url: `${origin}/v1/places:searchText`, ...options });
};
const reverse = (reply: Reply | (() => Reply), options: Partial<Parameters<typeof reverseGeocode>[3]> = {}): ReturnType<typeof reverseGeocode> => {
  seen.length = 0;
  handler = typeof reply === "function" ? reply : () => reply;
  return reverseGeocode(KEY, { lat: 35.6812, lng: 139.7671 }, "JP", { url: `${origin}/v4beta/geocode/location`, ...options });
};

test("搜索成功：POST Text Search，字段掩码只要 ID、名称、地址、坐标、主类型；结果限制在城市范围里、最多 5 条、中文；密钥只在请求头；主类型是机场的 kind 为 airport", async () => {
  const result = await search({ status: 200, body: { places: [place("ChIJa", "東京駅", 35.6812, 139.7671), { ...(place("ChIJb", "羽田空港", 35.55, 139.78, "日本東京都大田区") as object), primaryType: "international_airport" }] } });
  assert.deepEqual(result, {
    ok: true,
    value: [
      { id: "ChIJa", name: "東京駅", address: "日本東京都千代田区丸の内1丁目", location: { lat: 35.6812, lng: 139.7671 }, kind: "other" },
      { id: "ChIJb", name: "羽田空港", address: "日本東京都大田区", location: { lat: 35.55, lng: 139.78 }, kind: "airport" },
    ],
  });
  assert.equal(seen.length, 1);
  const [request] = seen as [Seen];
  assert.equal(request.method, "POST");
  assert.equal(request.path, "/v1/places:searchText");
  assert.equal(request.headers["x-goog-api-key"], KEY);
  assert.equal(request.headers["x-goog-fieldmask"], PLACE_SEARCH_FIELD_MASK);
  assert.equal(PLACE_SEARCH_FIELD_MASK, "places.id,places.displayName,places.formattedAddress,places.location,places.primaryType");
  assert.ok(!request.path.includes(KEY) && !request.body.includes(KEY));
  assert.deepEqual(JSON.parse(request.body), {
    textQuery: "东京站 酒店",
    languageCode: "zh-CN",
    regionCode: "JP",
    pageSize: 5,
    locationRestriction: { rectangle: { low: { latitude: BOUNDS.low.lat, longitude: BOUNDS.low.lng }, high: { latitude: BOUNDS.high.lat, longitude: BOUNDS.high.lng } } },
  });
});

test("搜索的应答：没有 places 是没找到；缺名称 / 坐标、坐标不合法、超出城市范围、ID 重复的丢掉；最多 5 条；名称和地址清理过", () => {
  assert.deepEqual(parsePlaceSearch({}, BOUNDS), { ok: true, value: [] });
  assert.deepEqual(parsePlaceSearch({ places: "x" }, BOUNDS), { ok: false, code: "UNEXPECTED" });
  const messy = parsePlaceSearch(
    {
      places: [
        null,
        { id: "ChIJ1", location: { latitude: 35.6, longitude: 139.7 } },
        { id: "ChIJ2", displayName: { text: "无坐标" } },
        place("ChIJ3", "大阪", 34.69, 135.5),
        place("ChIJ4", "坏坐标", 135, 35),
        place("bad id!", "坏 ID", 35.6, 139.7),
        { ...(place("ChIJ5", "  新宿\n站 ", 35.69, 139.7) as object), formattedAddress: undefined },
        place("ChIJ5", "重复", 35.69, 139.7),
        ...Array.from({ length: 8 }, (_, index) => place(`ChIJx${index}`, `第${index}个`, 35.6, 139.7)),
      ],
    },
    BOUNDS,
  );
  assert.ok(messy.ok);
  assert.deepEqual(
    messy.value.map((entry) => [entry.id, entry.name, entry.address]),
    [["ChIJ5", "新宿 站", ""], ["ChIJx0", "第0个", "日本東京都千代田区丸の内1丁目"], ["ChIJx1", "第1个", "日本東京都千代田区丸の内1丁目"], ["ChIJx2", "第2个", "日本東京都千代田区丸の内1丁目"], ["ChIJx3", "第3个", "日本東京都千代田区丸の内1丁目"]],
  );
});

test("反查成功：GET 取整后的坐标，字段掩码只要地址；网址里没有密钥；取第一条地址", async () => {
  assert.deepEqual(await reverse({ status: 200, body: { results: [{ formattedAddress: "日本、〒100-0005 東京都千代田区丸の内１丁目９" }, { formattedAddress: "東京都" }] } }), { ok: true, value: "日本、〒100-0005 東京都千代田区丸の内１丁目９" });
  const [request] = seen as [Seen];
  assert.equal(request.method, "GET");
  assert.equal(request.path, "/v4beta/geocode/location/35.6812,139.7671?languageCode=zh-CN&regionCode=JP");
  assert.equal(request.headers["x-goog-api-key"], KEY);
  assert.equal(request.headers["x-goog-fieldmask"], REVERSE_FIELD_MASK);
  assert.ok(!request.path.includes(KEY));
  assert.equal(request.body, "");
  assert.equal(reverseGeocodeUrl("http://h/x/", { lat: -33.1, lng: 151 }, "AU"), "http://h/x/-33.1,151?languageCode=zh-CN&regionCode=AU");
});

test("反查的应答：没有 results、空数组、只有空地址是「这里没有地址」（null）；results 不是数组当作看不懂", () => {
  assert.deepEqual(parseReverse({}), { ok: true, value: null });
  assert.deepEqual(parseReverse({ results: [] }), { ok: true, value: null });
  assert.deepEqual(parseReverse({ results: [{ formattedAddress: " " }, null, { formattedAddress: "海上" }] }), { ok: true, value: "海上" });
  assert.deepEqual(parseReverse({ results: {} }), { ok: false, code: "UNEXPECTED" });
});

test("看不懂的应答：不是 JSON、是数组 → UNEXPECTED", async () => {
  for (const body of ["not json", []]) {
    assert.deepEqual(await search({ status: 200, body }), { ok: false, code: "UNEXPECTED" });
    assert.deepEqual(await reverse({ status: 200, body }), { ok: false, code: "UNEXPECTED" });
  }
});

test("400：请求无效是 INVALID_REQUEST，密钥无效是 KEY_INVALID；403、429 按原因归类；都不重试，结果里没有对方的原文", async () => {
  const cases: [Reply, string][] = [
    [{ status: 400, body: googleError(400, "INVALID_ARGUMENT", null) }, "INVALID_REQUEST"],
    [{ status: 400, body: googleError(400, "INVALID_ARGUMENT", "API_KEY_INVALID") }, "KEY_INVALID"],
    [{ status: 403, body: googleError(403, "PERMISSION_DENIED", "SERVICE_DISABLED") }, "API_NOT_ENABLED"],
    [{ status: 403, body: googleError(403, "PERMISSION_DENIED", "API_KEY_SERVICE_BLOCKED") }, "KEY_RESTRICTED"],
    [{ status: 403, body: googleError(403, "PERMISSION_DENIED", "BILLING_DISABLED") }, "BILLING_DISABLED"],
    [{ status: 429, body: googleError(429, "RESOURCE_EXHAUSTED", "RATE_LIMIT_EXCEEDED") }, "QUOTA_EXCEEDED"],
  ];
  for (const [reply, code] of cases) {
    for (const run of [search, reverse]) {
      const result = await run(reply);
      assert.deepEqual(result, { ok: false, code }, code);
      assert.equal(seen.length, 1, code);
      assert.doesNotMatch(JSON.stringify(result), /upstream|AIza/);
    }
  }
});

test("5xx：再试一次；第二次成功就用第二次的", async () => {
  let calls = 0;
  assert.deepEqual(await search(() => (++calls === 1 ? { status: 503, body: {} } : { status: 200, body: {} })), { ok: true, value: [] });
  assert.equal(seen.length, 2);
  assert.deepEqual(await reverse({ status: 500, body: {} }), { ok: false, code: "UNAVAILABLE" });
  assert.equal(seen.length, 2);
});

test("超时：每次尝试有时限，整次不超过总时限；剩下的时间不够就不再重试", async () => {
  const started = performance.now();
  assert.deepEqual(await search({ status: 200, body: {}, delayMs: 3_000 }, { attemptTimeoutMs: 150, budgetMs: 800 }), { ok: false, code: "TIMEOUT" });
  assert.ok(performance.now() - started < 1_100, `用了 ${performance.now() - started} 毫秒`);
  assert.equal(seen.length, 2);
  assert.deepEqual(await reverse({ status: 200, body: {}, delayMs: 3_000 }, { attemptTimeoutMs: 1_000, budgetMs: 300 }), { ok: false, code: "TIMEOUT" });
  assert.equal(seen.length, 1);
});

test("连不上：UNREACHABLE", async () => {
  assert.deepEqual(await searchPlaces(KEY, SEARCH, { url: "http://127.0.0.1:1/v1/places:searchText", budgetMs: 2_000 }), { ok: false, code: "UNREACHABLE" });
  assert.deepEqual(await reverseGeocode(KEY, TOKYO, "JP", { url: "http://127.0.0.1:1/geocode", budgetMs: 2_000 }), { ok: false, code: "UNREACHABLE" });
});

test("不跟随重定向：3xx 当作看不懂，不去新地址", async () => {
  assert.deepEqual(await search({ status: 302, body: {}, headers: { location: "http://127.0.0.1:1/steal" } }), { ok: false, code: "UNEXPECTED" });
  assert.equal(seen.length, 1);
  assert.deepEqual(await reverse({ status: 307, body: {}, headers: { location: "http://127.0.0.1:1/steal" } }), { ok: false, code: "UNEXPECTED" });
  assert.equal(seen.length, 1);
});

test("应答过大：只读前 64 KB，截断后看不懂 → UNEXPECTED", async () => {
  const huge = "x".repeat(MAX_RESPONSE_BYTES * 4);
  assert.deepEqual(await search({ status: 200, body: { places: [], echo: huge } }), { ok: false, code: "UNEXPECTED" });
  assert.deepEqual(await reverse({ status: 200, body: { results: [], echo: huge } }), { ok: false, code: "UNEXPECTED" });
});

test("每日上限：发请求之前问一次，不允许就不发（DAILY_LIMIT_REACHED）；重试前也问", async () => {
  let asked = 0;
  assert.deepEqual(await search({ status: 200, body: {} }, { beforeAttempt: async () => (++asked, false) }), { ok: false, code: "DAILY_LIMIT_REACHED" });
  assert.deepEqual([seen.length, asked], [0, 1]);
  asked = 0;
  assert.deepEqual(await reverse({ status: 503, body: {} }, { beforeAttempt: async () => ++asked === 1 }), { ok: false, code: "UNAVAILABLE" });
  assert.deepEqual([seen.length, asked], [1, 2]);
});

test("不带城市的搜索（M8-02）：没有国家时不给 regionCode；范围里的结果再按 accept 筛一遍", async () => {
  seen.length = 0;
  handler = () => ({ status: 200, body: { places: [place("ChIJin", "在城市里", 35.68, 139.76), place("ChIJout", "在矩形里、不在城市里", 35.6, 139.7)] } });
  const result = await searchPlaces(KEY, { query: "酒店 甲", bounds: BOUNDS, regionCode: null, accept: (location) => location.lat > 35.65 }, { url: `${origin}/v1/places:searchText` });
  assert.deepEqual(result.ok && result.value.map((item) => item.id), ["ChIJin"]);
  const body = JSON.parse((seen[0] as Seen).body) as Record<string, unknown>;
  assert.equal("regionCode" in body, false);
  assert.equal(body["textQuery"], "酒店 甲");
});

const autocomplete = (reply: Reply, regionCodes: string[] = ["JP"]): ReturnType<typeof autocompletePlaces> => {
  seen.length = 0;
  handler = () => reply;
  return autocompletePlaces(KEY, { query: "東京 ヒルトン", sessionToken: "3f2c1e9a-5b7d-4c1e-9a2b-1234567890ab", regionCodes, bounds: BOUNDS }, { url: `${origin}/v1/places:autocomplete` });
};
const prediction = (placeId: unknown, main: unknown, secondary: unknown, types: unknown = ["lodging"]): unknown => ({ placePrediction: { placeId, text: { text: `${String(main)}, ${String(secondary)}` }, structuredFormat: { mainText: { text: main }, secondaryText: { text: secondary } }, types } });

test("输入即提示（M8-02）：POST Autocomplete，带会话令牌、只要地点预测的几个字段、中文、只要授权的国家和范围；密钥只在请求头", async () => {
  const result = await autocomplete({ status: 200, body: { suggestions: [prediction("ChIJh", "ヒルトン東京", "日本、東京都新宿区"), prediction("ChIJa", "羽田空港", "日本、東京都大田区", ["airport", "point_of_interest"])] } });
  assert.deepEqual(result, {
    ok: true,
    value: [
      { id: "ChIJh", name: "ヒルトン東京", address: "日本、東京都新宿区", kind: "other" },
      { id: "ChIJa", name: "羽田空港", address: "日本、東京都大田区", kind: "airport" },
    ],
  });
  const [request] = seen as [Seen];
  assert.equal(request.method, "POST");
  assert.equal(request.path, "/v1/places:autocomplete");
  assert.equal(request.headers["x-goog-api-key"], KEY);
  assert.equal(request.headers["x-goog-fieldmask"], PLACE_AUTOCOMPLETE_FIELD_MASK);
  assert.ok(!request.path.includes(KEY) && !request.body.includes(KEY));
  assert.deepEqual(JSON.parse(request.body), {
    input: "東京 ヒルトン",
    sessionToken: "3f2c1e9a-5b7d-4c1e-9a2b-1234567890ab",
    languageCode: "zh-CN",
    includedRegionCodes: ["JP"],
    locationRestriction: { rectangle: { low: { latitude: BOUNDS.low.lat, longitude: BOUNDS.low.lng }, high: { latitude: BOUNDS.high.lat, longitude: BOUNDS.high.lng } } },
  });
  await autocomplete({ status: 200, body: {} }, Array.from({ length: 20 }, (_, index) => `C${String.fromCharCode(65 + index)}`));
  assert.equal((JSON.parse((seen[0] as Seen).body) as { includedRegionCodes: string[] }).includedRegionCodes.length, 15, "谷歌最多收 15 个国家");
});

test("输入即提示的应答：没有 suggestions 是没有候选；查询预测、缺 ID / 名称、ID 不合法、重复的丢掉；没有第二行时地址为空；最多 5 条；不是数组看不懂", () => {
  assert.deepEqual(parsePlaceAutocomplete({}), { ok: true, value: [] });
  assert.deepEqual(parsePlaceAutocomplete({ suggestions: {} }), { ok: false, code: "UNEXPECTED" });
  const messy = parsePlaceAutocomplete({
    suggestions: [
      null,
      { queryPrediction: { text: { text: "东京 酒店" } } },
      prediction("bad id!", "坏 ID", "x"),
      { placePrediction: { placeId: "ChIJ1", structuredFormat: { secondaryText: { text: "没有名称" } } } },
      { placePrediction: { placeId: "ChIJ2", text: { text: "只有整段 文字" } } },
      prediction("ChIJ2", "重复", "x"),
      ...Array.from({ length: 8 }, (_, index) => prediction(`ChIJx${index}`, `第${index}个`, "东京")),
    ],
  });
  assert.ok(messy.ok);
  assert.deepEqual(
    messy.value.map((entry) => [entry.id, entry.name, entry.address, entry.kind]),
    [["ChIJ2", "只有整段 文字", "", "other"], ["ChIJx0", "第0个", "东京", "other"], ["ChIJx1", "第1个", "东京", "other"], ["ChIJx2", "第2个", "东京", "other"], ["ChIJx3", "第3个", "东京", "other"]],
  );
});

test("取坐标（M8-02）：GET Place Details，地点 ID 在路径里、同一个会话令牌、中文；字段掩码是 Essentials 一档；类型是机场的 kind 为 airport", async () => {
  seen.length = 0;
  handler = () => ({ status: 200, body: { id: "ChIJa", formattedAddress: "日本、東京都大田区羽田空港", location: { latitude: 35.5494, longitude: 139.7798 }, types: ["international_airport", "airport"] } });
  const result = await placeDetails(KEY, "ChIJa", "3f2c1e9a-5b7d-4c1e-9a2b-1234567890ab", { url: `${origin}/v1/places` });
  assert.deepEqual(result, { ok: true, value: { id: "ChIJa", address: "日本、東京都大田区羽田空港", location: { lat: 35.5494, lng: 139.7798 }, kind: "airport" } });
  const [request] = seen as [Seen];
  assert.equal(request.method, "GET");
  assert.equal(request.path, "/v1/places/ChIJa?languageCode=zh-CN&sessionToken=3f2c1e9a-5b7d-4c1e-9a2b-1234567890ab");
  assert.equal(request.headers["x-goog-fieldmask"], PLACE_DETAILS_FIELD_MASK);
  assert.equal(PLACE_DETAILS_FIELD_MASK, "id,formattedAddress,location,types");
  assert.equal(request.headers["x-goog-api-key"], KEY);
  assert.ok(!request.path.includes(KEY));
  assert.equal(placeDetailsUrl("http://h/v1/places/", "ChIJb", null), "http://h/v1/places/ChIJb?languageCode=zh-CN");
  assert.deepEqual(parsePlaceDetails({ id: "x" }, "ChIJa"), { ok: false, code: "UNEXPECTED" });
  assert.deepEqual(parsePlaceDetails({ location: { latitude: 95, longitude: 139 } }, "ChIJa"), { ok: false, code: "UNEXPECTED" });
  assert.deepEqual(parsePlaceDetails({ location: { latitude: 35, longitude: 139 } }, "ChIJa"), { ok: true, value: { id: "ChIJa", address: "", location: { lat: 35, lng: 139 }, kind: "other" } });
});

test("输入即提示、取坐标的失败和搜索一样归类：429 不重试、400 是请求无效、每日上限不发请求", async () => {
  assert.deepEqual(await autocomplete({ status: 429, body: googleError(429, "RESOURCE_EXHAUSTED", "RATE_LIMIT_EXCEEDED") }), { ok: false, code: "QUOTA_EXCEEDED" });
  assert.equal(seen.length, 1);
  assert.deepEqual(await autocomplete({ status: 400, body: googleError(400, "INVALID_ARGUMENT", null) }), { ok: false, code: "INVALID_REQUEST" });
  seen.length = 0;
  handler = () => ({ status: 200, body: {} });
  assert.deepEqual(await placeDetails(KEY, "ChIJa", null, { url: `${origin}/v1/places`, beforeAttempt: async () => false }), { ok: false, code: "DAILY_LIMIT_REACHED" });
  assert.equal(seen.length, 0);
});
