/**
 * 包车行程地图的折线（M9P-20 P1，ADR 0096）：`computeItineraryPolyline`。不联网：请求发到本机的假服务器，
 * 核对请求（中间点 `via: false`、字段掩码只要折线、密钥只在请求头）、应答的解析（逐段、整条、没有路线）、失败的归类和重试、每日上限的钩子。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { type IncomingMessage, type Server, createServer } from "node:http";
import { ITINERARY_POLYLINE_FIELD_MASK, computeItineraryPolyline, parseItineraryPolyline } from "./google-itinerary-routes.ts";

interface Seen {
  headers: IncomingMessage["headers"];
  body: string;
}
type Reply = { status: number; body: unknown };

let server: Server;
let url = "";
let handler: () => Reply = () => ({ status: 200, body: {} });
const seen: Seen[] = [];
const KEY = "AIzaFakeItineraryItineraryItin00009999";
const POINTS = [
  { lat: 35.69, lng: 139.7 },
  { lat: 35.499, lng: 138.769 },
  { lat: 35.233, lng: 139.105 },
  { lat: 35.69, lng: 139.7 },
];
const LEG = "_p~iF~ps|U_ulLnnqC";

before(async () => {
  server = createServer((request, response) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => (raw += chunk));
    request.on("end", () => {
      seen.push({ headers: request.headers, body: raw });
      const reply = handler();
      response.writeHead(reply.status, { "content-type": "application/json" });
      response.end(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  url = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}/directions/v2:computeRoutes`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const run = (reply: Reply | (() => Reply), options: { beforeAttempt?: () => Promise<boolean> } = {}) => {
  seen.length = 0;
  handler = typeof reply === "function" ? reply : () => reply;
  return computeItineraryPolyline(KEY, POINTS, { url, ...options });
};

test("请求：起点、终点、中间点按顺序作 intermediates（via: false），驾车、不考虑路况、不要备选；字段掩码只要折线；密钥只在请求头", async () => {
  const legs = [LEG, LEG, LEG].map((encodedPolyline) => ({ polyline: { encodedPolyline } }));
  assert.deepEqual(await run({ status: 200, body: { routes: [{ polyline: { encodedPolyline: LEG }, legs }] } }), { ok: true, polylines: [LEG, LEG, LEG], legs: null });
  assert.equal(seen.length, 1);
  const sent = JSON.parse(seen[0]?.body ?? "{}");
  assert.deepEqual(sent, {
    origin: { location: { latLng: { latitude: 35.69, longitude: 139.7 } } },
    destination: { location: { latLng: { latitude: 35.69, longitude: 139.7 } } },
    intermediates: [
      { location: { latLng: { latitude: 35.499, longitude: 138.769 } }, via: false },
      { location: { latLng: { latitude: 35.233, longitude: 139.105 } }, via: false },
    ],
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_UNAWARE",
    computeAlternativeRoutes: false,
  });
  assert.equal(seen[0]?.headers["x-goog-fieldmask"], ITINERARY_POLYLINE_FIELD_MASK);
  assert.equal(ITINERARY_POLYLINE_FIELD_MASK, "routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.distanceMeters,routes.legs.duration,routes.legs.polyline.encodedPolyline");
  assert.equal(seen[0]?.headers["x-goog-api-key"], KEY);
  assert.ok(!(seen[0]?.body ?? "").includes(KEY));
});

test("应答：逐段齐了用逐段；段数不对或某段看不懂时用整条；都没有为空数组；没有 routes 是 NO_ROUTE；看不懂是 UNEXPECTED", () => {
  const legs = (n: number, bad = -1) => Array.from({ length: n }, (_, i) => ({ polyline: { encodedPolyline: i === bad ? "has space" : LEG } }));
  assert.deepEqual(parseItineraryPolyline(JSON.stringify({ routes: [{ polyline: { encodedPolyline: "whole" }, legs: legs(3) }] }), 3), { ok: true, polylines: [LEG, LEG, LEG], legs: null });
  assert.deepEqual(parseItineraryPolyline(JSON.stringify({ routes: [{ polyline: { encodedPolyline: "whole" }, legs: legs(2) }] }), 3), { ok: true, polylines: ["whole"], legs: null });
  assert.deepEqual(parseItineraryPolyline(JSON.stringify({ routes: [{ polyline: { encodedPolyline: "whole" }, legs: legs(3, 1) }] }), 3), { ok: true, polylines: ["whole"], legs: null });
  assert.deepEqual(parseItineraryPolyline(JSON.stringify({ routes: [{ legs: [null, 1, "x"] }] }), 3), { ok: true, polylines: [], legs: null });
  // 逐段的里程、时长：段数对得上、每段都看得懂才给；谷歌省略 0 米；只有一段而没有逐段时认整条路线的
  const measured = [{ distanceMeters: 1200, duration: "300s" }, { duration: "60.5s" }, { distanceMeters: 5, duration: "0s" }];
  assert.deepEqual(parseItineraryPolyline(JSON.stringify({ routes: [{ legs: measured }] }), 3), { ok: true, polylines: [], legs: [{ meters: 1200, seconds: 300 }, { meters: 0, seconds: 60 }, { meters: 5, seconds: 0 }] });
  assert.equal((parseItineraryPolyline(JSON.stringify({ routes: [{ legs: [measured[0], { distanceMeters: 1 }, measured[2]] }] }), 3) as { legs: unknown }).legs, null, "一段没有时长");
  assert.equal((parseItineraryPolyline(JSON.stringify({ routes: [{ legs: [measured[0], { distanceMeters: -1, duration: "1s" }, measured[2]] }] }), 3) as { legs: unknown }).legs, null, "负数");
  assert.deepEqual((parseItineraryPolyline(JSON.stringify({ routes: [{ distanceMeters: 6800, duration: "1080s" }] }), 1) as { legs: unknown }).legs, [{ meters: 6800, seconds: 1080 }]);
  assert.equal((parseItineraryPolyline(JSON.stringify({ routes: [{ distanceMeters: 6800, duration: "1080s" }] }), 2) as { legs: unknown }).legs, null, "两段时不拿整条的当一段");
  assert.deepEqual(parseItineraryPolyline("{}", 3), { ok: false, code: "NO_ROUTE" });
  assert.deepEqual(parseItineraryPolyline(JSON.stringify({ routes: [] }), 3), { ok: false, code: "NO_ROUTE" });
  assert.deepEqual(parseItineraryPolyline("not json", 3), { ok: false, code: "UNEXPECTED" });
  assert.deepEqual(parseItineraryPolyline(JSON.stringify({ routes: "x" }), 3), { ok: false, code: "UNEXPECTED" });
  assert.deepEqual(parseItineraryPolyline(JSON.stringify([1]), 3), { ok: false, code: "UNEXPECTED" });
});

test("失败：密钥问题按原因归类不重试；5xx 再试 1 次；每日上限的钩子说不行就不发", async () => {
  assert.deepEqual(await run({ status: 403, body: { error: { code: 403, status: "PERMISSION_DENIED", details: [{ reason: "API_KEY_SERVICE_BLOCKED" }] } } }), { ok: false, code: "KEY_RESTRICTED" });
  assert.equal(seen.length, 1);
  assert.deepEqual(await run({ status: 400, body: { error: { code: 400, status: "INVALID_ARGUMENT" } } }), { ok: false, code: "INVALID_POINTS" });
  assert.deepEqual(await run({ status: 503, body: {} }), { ok: false, code: "UNAVAILABLE" });
  assert.equal(seen.length, 2, "5xx 再试 1 次");
  let asked = 0;
  assert.deepEqual(
    await run({ status: 200, body: { routes: [{}] } }, {
      beforeAttempt: async () => {
        asked += 1;
        return false;
      },
    }),
    { ok: false, code: "DAILY_LIMIT_REACHED" },
  );
  assert.deepEqual([asked, seen.length], [1, 0]);
});
