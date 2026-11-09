/**
 * 官网路线小地图的谷歌调用（M8-10，ADR 0072）：`fetchStaticMap`。不联网：请求发到本机的假服务器，
 * 核对发出去的请求（GET、参数原样、密钥在最后）、图片的认法（看内容不看应答头）、大小上限、各种失败的归类（谷歌回显密钥也不转述）、重试和时限、不跟随跳转、每日上限的钩子。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { type IncomingMessage, type Server, createServer } from "node:http";
import { STATIC_MAP_RULES } from "@nozomi/domain";
import { classifyStaticMapError, fetchStaticMap, sniffImageType } from "./google-static-maps.ts";

type Reply = { status: number; body: Buffer | string; contentType?: string; delayMs?: number; headers?: Record<string, string>; hang?: boolean };

let server: Server;
let url = "";
let handler: () => Reply = () => ({ status: 200, body: PNG });
const seen: IncomingMessage[] = [];
const KEY = "AIzaFakeStaticStaticStatic000099";
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("fake-png-body")]);
const QUERY = "size=320x200&scale=2&path=enc%3A_p~iF~ps%7CU";

before(async () => {
  server = createServer((request, response) => {
    seen.push(request);
    request.resume();
    request.on("end", () => {
      const reply = handler();
      const send = (): void => {
        if (response.destroyed) return;
        response.writeHead(reply.status, { "content-type": reply.contentType ?? (Buffer.isBuffer(reply.body) ? "image/png" : "text/plain; charset=UTF-8"), ...reply.headers });
        if (reply.hang) {
          response.write(reply.body);
          return;
        }
        response.end(reply.body);
      };
      if (reply.delayMs) setTimeout(send, reply.delayMs).unref();
      else send();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  url = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}/maps/api/staticmap`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const run = (reply: Reply | (() => Reply), options: Partial<Parameters<typeof fetchStaticMap>[2]> = {}): ReturnType<typeof fetchStaticMap> => {
  seen.length = 0;
  handler = typeof reply === "function" ? reply : () => reply;
  return fetchStaticMap(KEY, QUERY, { url, ...options });
};

test("成功：GET、参数原样、密钥在最后一个参数；返回 PNG 的字节和按内容认出的类型", async () => {
  const result = await run({ status: 200, body: PNG });
  assert.deepEqual(result, { ok: true, contentType: "image/png", image: PNG });
  assert.equal(seen.length, 1);
  const [request] = seen as [IncomingMessage];
  assert.equal(request.method, "GET");
  assert.equal(request.url, `/maps/api/staticmap?${QUERY}&key=${KEY}`);
  assert.equal(request.headers["x-goog-api-key"], undefined);
});

test("图片认法：看内容开头（PNG、JPEG、GIF），不信应答头；应答头不是图片、内容不是图片都当作看不懂", async () => {
  assert.equal(sniffImageType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(sniffImageType(Buffer.from("GIF89a...")), "image/gif");
  assert.equal(sniffImageType(Buffer.from("<html>")), null);
  assert.deepEqual(await run({ status: 200, body: PNG, contentType: "image/jpeg" }), { ok: true, contentType: "image/png", image: PNG });
  assert.deepEqual(await run({ status: 200, body: "<html>not an image</html>", contentType: "image/png" }), { ok: false, code: "UNEXPECTED" });
  assert.deepEqual(await run({ status: 200, body: PNG, contentType: "text/html" }), { ok: false, code: "UNEXPECTED" });
});

test("大小上限：超过上限的图读到上限就停（对方不结束也不等），IMAGE_TOO_LARGE；正好等于上限的照收", async () => {
  const big = Buffer.concat([PNG, Buffer.alloc(STATIC_MAP_RULES.maxImageBytes)]);
  const started = performance.now();
  assert.deepEqual(await run({ status: 200, body: big, hang: true }), { ok: false, code: "IMAGE_TOO_LARGE" });
  assert.ok(performance.now() - started < 2_000);
  const exact = Buffer.concat([PNG, Buffer.alloc(100 - PNG.length)]);
  assert.deepEqual(await run({ status: 200, body: exact }, { maxBytes: 100 }), { ok: true, contentType: "image/png", image: exact });
  assert.deepEqual(await run({ status: 200, body: Buffer.concat([exact, Buffer.from([0])]) }, { maxBytes: 100 }), { ok: false, code: "IMAGE_TOO_LARGE" });
});

test("谷歌的错误归类：没开通、项目不允许用、密钥无效、referer / IP 限制、没绑卡、配额、其余 403、5xx、400；原文（含回显的密钥）不出现在结果里", async () => {
  const cases: [number, string, string][] = [
    [403, "This API is not activated on your API project. You may need to enable this API in the Google Cloud Console", "API_NOT_ENABLED"],
    [403, "The Google Maps Platform server rejected your request. This API project is not authorized to use this API.", "API_NOT_ENABLED"],
    [403, `The provided API key is invalid. key=${KEY}`, "KEY_INVALID"],
    [403, "API keys with referer restrictions cannot be used with this API.", "KEY_RESTRICTED"],
    [403, "This IP, site or mobile application is not authorized to use this API key.", "KEY_RESTRICTED"],
    [403, "You must enable Billing on the Google Cloud Project at https://console.cloud.google.com/project/_/billing/enable", "BILLING_DISABLED"],
    [403, "You have exceeded your daily request quota for this API.", "QUOTA_EXCEEDED"],
    [429, "Too many requests", "QUOTA_EXCEEDED"],
    [403, "Forbidden", "PERMISSION_DENIED"],
    [400, "The Google Maps Platform server rejected your request. Invalid request. Invalid 'size' parameter.", "UNEXPECTED"],
    [414, "Request-URI Too Large", "UNEXPECTED"],
  ];
  for (const [status, body, code] of cases) {
    const result = await run({ status, body });
    assert.deepEqual(result, { ok: false, code }, `${status} ${body}`);
    assert.equal(seen.length, 1, "4xx 不重试");
    assert.ok(!JSON.stringify(result).includes(KEY));
  }
  // 谷歌通用的 JSON 错误也认
  assert.equal(classifyStaticMapError(403, JSON.stringify({ error: { status: "PERMISSION_DENIED", details: [{ reason: "SERVICE_DISABLED" }] } })), "API_NOT_ENABLED");
  assert.equal(classifyStaticMapError(400, JSON.stringify({ error: { status: "INVALID_ARGUMENT", details: [{ reason: "API_KEY_INVALID" }] } })), "KEY_INVALID");
  assert.equal(classifyStaticMapError(503, "Service Unavailable"), "UNAVAILABLE");
});

test("5xx、连不上、超时再试 1 次；都失败按最后一次的原因；第二次成功就用第二次的", async () => {
  assert.deepEqual(await run({ status: 500, body: "oops" }), { ok: false, code: "UNAVAILABLE" });
  assert.equal(seen.length, 2);
  let n = 0;
  assert.deepEqual(await run(() => (++n === 1 ? { status: 503, body: "busy" } : { status: 200, body: PNG })), { ok: true, contentType: "image/png", image: PNG });
  assert.equal(seen.length, 2);
  assert.deepEqual(await run({ status: 200, body: PNG, delayMs: 400 }, { attemptTimeoutMs: 100, budgetMs: 1_000 }), { ok: false, code: "TIMEOUT" });
  assert.equal(seen.length, 2);
  assert.deepEqual(await fetchStaticMap(KEY, QUERY, { url: "http://127.0.0.1:1/maps/api/staticmap" }), { ok: false, code: "UNREACHABLE" });
});

test("时限：剩下的时间不够就不再重试；整次不超过预算", async () => {
  const started = performance.now();
  assert.deepEqual(await run({ status: 200, body: PNG, delayMs: 1_000 }, { attemptTimeoutMs: 400, budgetMs: 600 }), { ok: false, code: "TIMEOUT" });
  assert.equal(seen.length, 1, "剩下不到 0.5 秒，不再试");
  assert.ok(performance.now() - started < 900);
});

test("不跟随跳转：3xx 当作看不懂，不去跳转的地址（哪怕那里能出图）", async () => {
  let n = 0;
  const result = await run(() => (++n === 1 ? { status: 302, body: "", headers: { location: `${url}?again=1` } } : { status: 200, body: PNG }));
  assert.deepEqual(result, { ok: false, code: "UNEXPECTED" });
  assert.equal(seen.length, 1);
});

test("每日上限的钩子：每次真正发请求之前问一次；第一次就不允许 → DAILY_LIMIT_REACHED、不发请求；重试前不允许 → 按上一次的原因", async () => {
  let asked = 0;
  assert.deepEqual(await run({ status: 200, body: PNG }, { beforeAttempt: async () => (asked++, false) }), { ok: false, code: "DAILY_LIMIT_REACHED" });
  assert.deepEqual([asked, seen.length], [1, 0]);
  asked = 0;
  assert.deepEqual(await run({ status: 502, body: "bad gateway" }, { beforeAttempt: async () => ++asked === 1 }), { ok: false, code: "UNAVAILABLE" });
  assert.deepEqual([asked, seen.length], [2, 1]);
});
