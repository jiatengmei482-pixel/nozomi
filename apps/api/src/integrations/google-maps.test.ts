/**
 * 谷歌地图密钥的「测试一下」（M4-09，ADR 0041）。不联网：请求发到本机的假服务器，核对发出去的请求（密钥在请求头、只要一个字段）
 * 和各种应答的归类。应答的写法照谷歌的错误格式（`error.status`、`error.details[].reason`）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { type IncomingMessage, type Server, createServer } from "node:http";
import { checkGoogleMapsKey } from "./google-maps.ts";

interface Seen {
  method: string;
  path: string;
  headers: IncomingMessage["headers"];
  body: string;
}
type Handler = () => { status: number; body: unknown; delayMs?: number };

let server: Server;
let url = "";
let handler: Handler = () => ({ status: 200, body: {} });
const seen: Seen[] = [];
const KEY = "AIzaFakeFakeFakeFakeFakeFake00001234";

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
        response.writeHead(reply.status, { "content-type": "application/json" });
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

test("可用：发一次 computeRoutes，密钥在请求头里（不在网址里），只要 routes.distanceMeters", async () => {
  seen.length = 0;
  handler = () => ({ status: 200, body: { routes: [{ distanceMeters: 7_000 }] } });
  assert.deepEqual(await checkGoogleMapsKey(KEY, { url }), { ok: true });
  assert.equal(seen.length, 1);
  const [request] = seen;
  assert.equal(request?.method, "POST");
  assert.equal(request?.path, "/directions/v2:computeRoutes");
  assert.equal(request?.headers["x-goog-api-key"], KEY);
  assert.equal(request?.headers["x-goog-fieldmask"], "routes.distanceMeters");
  assert.ok(!request?.path.includes(KEY));
  assert.equal(JSON.parse(request?.body ?? "{}").travelMode, "DRIVE");
  // 两点之间没有路线（空对象）也说明密钥能用
  handler = () => ({ status: 200, body: {} });
  assert.deepEqual(await checkGoogleMapsKey(KEY, { url }), { ok: true });
});

test("各种不可用按谷歌的原因归类；结果里没有谷歌返回的原文，也没有密钥", async () => {
  const cases: [number, string, string | null, string][] = [
    [400, "INVALID_ARGUMENT", "API_KEY_INVALID", "KEY_INVALID"],
    [403, "PERMISSION_DENIED", "SERVICE_DISABLED", "API_NOT_ENABLED"],
    [403, "PERMISSION_DENIED", "API_KEY_SERVICE_BLOCKED", "KEY_RESTRICTED"],
    [403, "PERMISSION_DENIED", "API_KEY_IP_ADDRESS_BLOCKED", "KEY_RESTRICTED"],
    [403, "PERMISSION_DENIED", "BILLING_DISABLED", "BILLING_DISABLED"],
    [403, "PERMISSION_DENIED", null, "PERMISSION_DENIED"],
    [429, "RESOURCE_EXHAUSTED", "RATE_LIMIT_EXCEEDED", "QUOTA_EXCEEDED"],
    [400, "INVALID_ARGUMENT", null, "UNEXPECTED"],
  ];
  for (const [status, googleStatus, reason, expected] of cases) {
    seen.length = 0;
    handler = () => ({ status, body: googleError(status, googleStatus, reason) });
    const result = await checkGoogleMapsKey(KEY, { url });
    assert.equal(result.ok ? null : result.code, expected, `${status} ${reason}`);
    assert.equal(seen.length, 1, `${status} ${reason} 不重试`);
    assert.ok(!JSON.stringify(result).includes(KEY) && !JSON.stringify(result).includes("upstream"));
  }
});

test("对方 5xx、超时、连不上：再试一次；仍然不行给出对应的原因", async () => {
  seen.length = 0;
  handler = () => ({ status: 503, body: googleError(503, "UNAVAILABLE", null) });
  assert.deepEqual(await checkGoogleMapsKey(KEY, { url }).then((r) => (r.ok ? null : r.code)), "UNAVAILABLE");
  assert.equal(seen.length, 2);

  let calls = 0;
  handler = () => (++calls === 1 ? { status: 500, body: {} } : { status: 200, body: { routes: [] } });
  assert.deepEqual(await checkGoogleMapsKey(KEY, { url }), { ok: true }, "第二次成功就算可用");

  handler = () => ({ status: 200, body: {}, delayMs: 1_000 });
  assert.deepEqual(await checkGoogleMapsKey(KEY, { url, timeoutMs: 100 }).then((r) => (r.ok ? null : r.code)), "TIMEOUT");
  assert.deepEqual(await checkGoogleMapsKey(KEY, { url: "http://127.0.0.1:1/directions/v2:computeRoutes" }).then((r) => (r.ok ? null : r.code)), "UNREACHABLE");

  handler = () => ({ status: 200, body: "<html>not json</html>" });
  assert.deepEqual(await checkGoogleMapsKey(KEY, { url }).then((r) => (r.ok ? null : r.code)), "UNEXPECTED");
});

test("应答体边读边截：只读前 64 KB，后面的不读（对方回一个几十 MB 的应答也不会整个读进内存）", async () => {
  const total = 64 * 1024 * 1024;
  let written = 0;
  let finished = false;
  const big = createServer((request, response) => {
    request.resume();
    response.writeHead(200, { "content-type": "application/json" });
    const chunk = Buffer.alloc(1024 * 1024, 0x61);
    const pump = (): void => {
      while (written < total) {
        written += chunk.byteLength;
        if (!response.write(chunk)) {
          response.once("drain", pump);
          return;
        }
      }
      response.end(() => {
        finished = true;
      });
    };
    pump();
  });
  await new Promise<void>((resolve) => big.listen(0, "127.0.0.1", () => resolve()));
  const address = big.address();
  const bigUrl = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}/directions/v2:computeRoutes`;
  try {
    const result = await checkGoogleMapsKey(KEY, { url: bigUrl, timeoutMs: 5_000 });
    assert.deepEqual(result.ok ? null : result.code, "UNEXPECTED", "截断后不是完整的 JSON：看不懂");
    assert.equal(finished, false, "没有把整个应答读完");
    assert.ok(written < total, `对方只写出了一部分：${written}`);
  } finally {
    big.closeAllConnections();
    await new Promise<void>((resolve) => big.close(() => resolve()));
  }
});
