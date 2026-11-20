/**
 * Claude 密钥的「测试一下」（M9T-31，ADR 0104 第六节）。不联网：请求发到本机的假服务器，核对发出去的请求
 * （GET 模型列表、密钥在请求头、带版本头、不生成内容）和各种应答的归类（照 Anthropic 的错误格式 `error.type`）。
 */
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { type IncomingMessage, type Server, createServer } from "node:http";
import { ANTHROPIC_VERSION, checkAnthropicKey } from "./anthropic.ts";

interface Seen {
  method: string;
  path: string;
  headers: IncomingMessage["headers"];
}
type Handler = () => { status: number; body: unknown; delayMs?: number };

let server: Server;
let url = "";
let handler: Handler = () => ({ status: 200, body: { data: [] } });
const seen: Seen[] = [];
// 测试用的假值（不是真密钥）
const KEY = `sk-ant-${"x".repeat(24)}0001`;

before(async () => {
  server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      seen.push({ method: request.method ?? "", path: request.url ?? "", headers: request.headers });
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
  url = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}/v1/models`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const anthropicError = (type: string): unknown => ({ type: "error", error: { type, message: `upstream says something about ${KEY}` } });

test("可用：GET 一次模型列表（limit=1，不生成内容、不产生 token 费用），密钥在 x-api-key 请求头里、带 anthropic-version", async () => {
  seen.length = 0;
  handler = () => ({ status: 200, body: { data: [{ id: "claude-sonnet-5-5", type: "model" }], has_more: true } });
  assert.deepEqual(await checkAnthropicKey(KEY, { url }), { ok: true });
  assert.equal(seen.length, 1);
  const [request] = seen;
  assert.equal(request?.method, "GET");
  assert.equal(request?.path, "/v1/models?limit=1");
  assert.equal(request?.headers["x-api-key"], KEY);
  assert.equal(request?.headers["anthropic-version"], ANTHROPIC_VERSION);
  assert.ok(!request?.path.includes(KEY), "密钥不在网址里");
});

test("按状态和 error.type 归类；说明是自己写的，不带对方原文和密钥；4xx 不重试", async () => {
  const cases: [number, string, string][] = [
    [401, "authentication_error", "KEY_INVALID"],
    [403, "permission_error", "PERMISSION_DENIED"],
    [429, "rate_limit_error", "QUOTA_EXCEEDED"],
    [404, "not_found_error", "UNEXPECTED"],
  ];
  for (const [status, type, code] of cases) {
    seen.length = 0;
    handler = () => ({ status, body: anthropicError(type) });
    const result = await checkAnthropicKey(KEY, { url });
    assert.equal(result.ok, false);
    assert.equal(!result.ok && result.code, code, type);
    assert.ok(!JSON.stringify(result).includes(KEY) && !JSON.stringify(result).includes("upstream"));
    assert.equal(seen.length, 1, `${status} 不重试`);
  }
});

test("5xx / 529 过载再试一次，两次都不行是 UNAVAILABLE；第二次成功就是可用", async () => {
  seen.length = 0;
  handler = () => ({ status: 529, body: anthropicError("overloaded_error") });
  const failed = await checkAnthropicKey(KEY, { url });
  assert.equal(!failed.ok && failed.code, "UNAVAILABLE");
  assert.equal(seen.length, 2);

  seen.length = 0;
  let calls = 0;
  handler = () => (++calls === 1 ? { status: 500, body: anthropicError("api_error") } : { status: 200, body: { data: [] } });
  assert.deepEqual(await checkAnthropicKey(KEY, { url }), { ok: true });
  assert.equal(seen.length, 2);
});

test("200 但应答看不懂：UNEXPECTED；超时：TIMEOUT；连不上：UNREACHABLE", async () => {
  handler = () => ({ status: 200, body: "not json" });
  const garbled = await checkAnthropicKey(KEY, { url });
  assert.equal(!garbled.ok && garbled.code, "UNEXPECTED");
  handler = () => ({ status: 200, body: { models: [] } });
  const shape = await checkAnthropicKey(KEY, { url });
  assert.equal(!shape.ok && shape.code, "UNEXPECTED");

  handler = () => ({ status: 200, body: { data: [] }, delayMs: 500 });
  const slow = await checkAnthropicKey(KEY, { url, timeoutMs: 50 });
  assert.equal(!slow.ok && slow.code, "TIMEOUT");

  const closed = await checkAnthropicKey(KEY, { url: "http://127.0.0.1:1/v1/models", attempts: 1 });
  assert.equal(!closed.ok && closed.code, "UNREACHABLE");
});
