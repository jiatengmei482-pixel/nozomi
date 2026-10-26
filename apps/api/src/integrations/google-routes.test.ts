/**
 * 路线预估的谷歌调用（M2-02，ADR 0042）：`computeRoute`。不联网：请求发到本机的假服务器，
 * 核对发出去的请求（密钥只在请求头、字段掩码只要里程和时长、不考虑实时路况）、应答的解析和各种失败的归类、重试和时限、每日上限的钩子。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { type IncomingMessage, type Server, createServer } from "node:http";
import { MAX_RESPONSE_BYTES, ROUTE_FIELD_MASK, computeRoute } from "./google-maps.ts";

interface Seen {
  path: string;
  headers: IncomingMessage["headers"];
  body: string;
}
type Reply = { status: number; body: unknown; delayMs?: number; headers?: Record<string, string> };

let server: Server;
let url = "";
let handler: () => Reply = () => ({ status: 200, body: {} });
const seen: Seen[] = [];
const KEY = "AIzaFakeRouteRouteRouteRoute00005678";
const FROM = { lat: 35.681, lng: 139.767 };
const TO = { lat: 35.69, lng: 139.701 };

before(async () => {
  server = createServer((request, response) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => (raw += chunk));
    request.on("end", () => {
      seen.push({ path: request.url ?? "", headers: request.headers, body: raw });
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
  url = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}/directions/v2:computeRoutes`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const googleError = (code: number, status: string, reason: string | null): unknown => ({
  error: { code, message: `upstream says something about ${KEY}`, status, details: reason === null ? [] : [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason, domain: "googleapis.com" }] },
});

const run = (reply: Reply | (() => Reply), options: Partial<Parameters<typeof computeRoute>[3]> = {}): ReturnType<typeof computeRoute> => {
  seen.length = 0;
  handler = typeof reply === "function" ? reply : () => reply;
  return computeRoute(KEY, FROM, TO, { url, ...options });
};

test("成功：驾车、不考虑实时路况、只要里程和时长；密钥只在请求头里", async () => {
  assert.deepEqual(await run({ status: 200, body: { routes: [{ distanceMeters: 6_812, duration: "1085s" }] } }), { ok: true, meters: 6_812, seconds: 1_085 });
  assert.equal(seen.length, 1);
  const [request] = seen as [Seen];
  assert.equal(request.path, "/directions/v2:computeRoutes");
  assert.equal(request.headers["x-goog-api-key"], KEY);
  assert.equal(request.headers["x-goog-fieldmask"], ROUTE_FIELD_MASK);
  assert.equal(ROUTE_FIELD_MASK, "routes.distanceMeters,routes.duration");
  assert.ok(!request.path.includes(KEY));
  assert.ok(!request.body.includes(KEY));
  assert.deepEqual(JSON.parse(request.body), {
    origin: { location: { latLng: { latitude: 35.681, longitude: 139.767 } } },
    destination: { location: { latLng: { latitude: 35.69, longitude: 139.701 } } },
    travelMode: "DRIVE",
    routingPreference: "TRAFFIC_UNAWARE",
    computeAlternativeRoutes: false,
  });
});

test("谷歌省略取默认值的字段：没有 distanceMeters 是 0 米；时长带小数的取整秒", async () => {
  assert.deepEqual(await run({ status: 200, body: { routes: [{ duration: "0s" }] } }), { ok: true, meters: 0, seconds: 0 });
  assert.deepEqual(await run({ status: 200, body: { routes: [{ distanceMeters: 10, duration: "61.5s" }] } }), { ok: true, meters: 10, seconds: 61 });
});

test("没有路线（空对象、空数组）：NO_ROUTE，不重试", async () => {
  assert.deepEqual(await run({ status: 200, body: {} }), { ok: false, code: "NO_ROUTE" });
  assert.equal(seen.length, 1);
  assert.deepEqual(await run({ status: 200, body: { routes: [] } }), { ok: false, code: "NO_ROUTE" });
});

test("看不懂的应答：不是 JSON、没有时长、时长写法不对、里程不合理 → UNEXPECTED", async () => {
  for (const body of ["not json", [], { routes: "x" }, { routes: [null] }, { routes: [{ distanceMeters: 100 }] }, { routes: [{ distanceMeters: 100, duration: "5m" }] }, { routes: [{ distanceMeters: "100", duration: "5s" }] }, { routes: [{ distanceMeters: 5_000_001, duration: "5s" }] }, { routes: [{ distanceMeters: -1, duration: "5s" }] }, { routes: [{ distanceMeters: 1, duration: "604801s" }] }]) {
    assert.deepEqual(await run({ status: 200, body }), { ok: false, code: "UNEXPECTED" }, JSON.stringify(body));
  }
});

test("400：坐标无效是 INVALID_POINTS，密钥无效是 KEY_INVALID；都不重试", async () => {
  assert.deepEqual(await run({ status: 400, body: googleError(400, "INVALID_ARGUMENT", null) }), { ok: false, code: "INVALID_POINTS" });
  assert.equal(seen.length, 1);
  assert.deepEqual(await run({ status: 400, body: googleError(400, "INVALID_ARGUMENT", "API_KEY_INVALID") }), { ok: false, code: "KEY_INVALID" });
  assert.equal(seen.length, 1);
});

test("403、429 按谷歌的原因归类，不重试；结果里没有对方的原文", async () => {
  const cases: [Reply, string][] = [
    [{ status: 403, body: googleError(403, "PERMISSION_DENIED", "SERVICE_DISABLED") }, "API_NOT_ENABLED"],
    [{ status: 403, body: googleError(403, "PERMISSION_DENIED", "API_KEY_SERVICE_BLOCKED") }, "KEY_RESTRICTED"],
    [{ status: 403, body: googleError(403, "PERMISSION_DENIED", "BILLING_DISABLED") }, "BILLING_DISABLED"],
    [{ status: 403, body: googleError(403, "PERMISSION_DENIED", null) }, "PERMISSION_DENIED"],
    [{ status: 429, body: googleError(429, "RESOURCE_EXHAUSTED", "RATE_LIMIT_EXCEEDED") }, "QUOTA_EXCEEDED"],
  ];
  for (const [reply, code] of cases) {
    const result = await run(reply);
    assert.deepEqual(result, { ok: false, code }, code);
    assert.equal(seen.length, 1, code);
    assert.doesNotMatch(JSON.stringify(result), /upstream|AIza/);
  }
});

test("5xx：再试一次；第二次成功就用第二次的", async () => {
  let calls = 0;
  assert.deepEqual(await run(() => (++calls === 1 ? { status: 503, body: {} } : { status: 200, body: { routes: [{ distanceMeters: 1, duration: "1s" }] } })), { ok: true, meters: 1, seconds: 1 });
  assert.equal(seen.length, 2);
  assert.deepEqual(await run({ status: 500, body: {} }), { ok: false, code: "UNAVAILABLE" });
  assert.equal(seen.length, 2);
});

test("超时：每次尝试有时限，整次不超过总时限；剩下的时间不够就不再重试", async () => {
  const started = performance.now();
  assert.deepEqual(await run({ status: 200, body: {}, delayMs: 2_000 }, { attemptTimeoutMs: 150, budgetMs: 600 }), { ok: false, code: "TIMEOUT" });
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 900, `用了 ${elapsed} 毫秒`);
  assert.equal(seen.length, 2);
  assert.deepEqual(await run({ status: 200, body: {}, delayMs: 2_000 }, { attemptTimeoutMs: 1_000, budgetMs: 300 }), { ok: false, code: "TIMEOUT" });
  assert.equal(seen.length, 1);
});

test("连不上：UNREACHABLE", async () => {
  assert.deepEqual(await computeRoute(KEY, FROM, TO, { url: "http://127.0.0.1:1/directions/v2:computeRoutes", budgetMs: 2_000 }), { ok: false, code: "UNREACHABLE" });
});

test("不跟随重定向：3xx 当作看不懂的应答，不去新地址", async () => {
  assert.deepEqual(await run({ status: 302, body: {}, headers: { location: "http://127.0.0.1:1/steal" } }), { ok: false, code: "UNEXPECTED" });
  assert.equal(seen.length, 1);
});

test("应答过大：只读前 64 KB，截断后看不懂 → UNEXPECTED", async () => {
  const huge = "x".repeat(MAX_RESPONSE_BYTES * 4);
  assert.deepEqual(await run({ status: 200, body: { routes: [{ distanceMeters: 1, duration: "1s" }], echo: huge } }), { ok: false, code: "UNEXPECTED" });
});

test("每日上限：发请求之前问一次，不允许就不发（DAILY_LIMIT_REACHED）；重试前也问", async () => {
  let asked = 0;
  assert.deepEqual(await run({ status: 200, body: {} }, { beforeAttempt: async () => (++asked, false) }), { ok: false, code: "DAILY_LIMIT_REACHED" });
  assert.equal(seen.length, 0);
  assert.equal(asked, 1);
  asked = 0;
  assert.deepEqual(await run({ status: 503, body: {} }, { beforeAttempt: async () => ++asked === 1 }), { ok: false, code: "UNAVAILABLE" });
  assert.equal(seen.length, 1);
  assert.equal(asked, 2);
});
