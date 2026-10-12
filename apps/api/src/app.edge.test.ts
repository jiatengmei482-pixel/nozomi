/**
 * 接口层的边界与异常路径：其他请求方法、查询串、畸形 URL、超大或畸形请求体。
 * 目标是确认任何出错的响应都是统一格式 `{ error: { code, message, details } }`，且不透出框架原始报错。
 * 不需要数据库（连接池指向必然连不上的地址）。
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { connect } from "node:net";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.ts";
import { createPool } from "./db/pool.ts";
import { leakedSecrets, testConfig } from "./testing/fixtures.ts";

const pool = createPool(testConfig().databaseUrl, { connectionTimeoutMs: 1_000 });
after(() => pool.end());

function newApp(): FastifyInstance {
  const app = buildApp({ config: testConfig(), pool, migrationFiles: [], logger: false, healthTimeoutMs: 1_500 });
  app.post("/echo", async (request) => ({ type: typeof request.body }));
  return app;
}

/** 断言响应体是统一错误格式，并返回 error 对象。 */
function assertUnifiedError(text: string, code?: string): { code: string; message: string; details: unknown } {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    assert.fail(`响应体不是 JSON：${text.slice(0, 200)}`);
  }
  assert.ok(typeof body === "object" && body !== null, `响应体不是对象：${text.slice(0, 200)}`);
  assert.deepEqual(Object.keys(body), ["error"], `不是统一错误格式：${text.slice(0, 200)}`);
  const error = (body as { error: Record<string, unknown> }).error;
  assert.ok(typeof error === "object" && error !== null, `error 不是对象：${text.slice(0, 200)}`);
  assert.deepEqual(Object.keys(error).sort(), ["code", "details", "message"]);
  assert.equal(typeof error["code"], "string");
  if (code !== undefined) assert.equal(error["code"], code);
  assert.equal(typeof error["message"], "string");
  assert.ok(typeof error["details"] === "object" && error["details"] !== null);
  return error as { code: string; message: string; details: unknown };
}

test("/health 只支持 GET：POST / PUT / PATCH / DELETE / OPTIONS 都是 404 统一错误格式，不执行健康检查", async () => {
  const app = newApp();
  for (const method of ["POST", "PUT", "PATCH", "DELETE", "OPTIONS"] as const) {
    const res = await app.inject({ method, url: "/health" });
    assert.equal(res.statusCode, 404, method);
    const error = assertUnifiedError(res.body, "NOT_FOUND");
    assert.deepEqual(error.details, { method, path: "/health" });
    assert.ok(!res.body.includes("integrations"), `${method} 不应返回健康检查内容`);
  }
  await app.close();
});

test("HEAD /health：状态码与 GET 一致（数据库不通时 503），没有响应体", async () => {
  const app = newApp();
  const res = await app.inject({ method: "HEAD", url: "/health" });
  assert.equal(res.statusCode, 503);
  assert.equal(res.body, "");
  assert.equal(res.headers["cache-control"], "no-store");
  await app.close();
});

test("/health 带查询串（包括畸形的查询串）：结果和不带时一样，查询串内容不出现在响应里", async () => {
  const app = newApp();
  const plain = await app.inject({ method: "GET", url: "/health" });
  for (const query of ["?verbose=1&token=tok_should_not_echo", "?%zz", "?a[]=1&a[]=2", "?" + "x".repeat(5_000)]) {
    const res = await app.inject({ method: "GET", url: `/health${query}` });
    assert.equal(res.statusCode, plain.statusCode, query.slice(0, 20));
    assert.deepEqual(Object.keys(res.json()), Object.keys(plain.json()));
    assert.ok(!res.body.includes("tok_should_not_echo"));
    assert.deepEqual(leakedSecrets(res.body), []);
  }
  await app.close();
});

test("路径大小写或末尾斜杠不同：不是 /health，返回 404 统一错误格式", async () => {
  const app = newApp();
  for (const url of ["/health/", "/HEALTH", "//health", "/health/x"]) {
    const res = await app.inject({ method: "GET", url });
    assert.equal(res.statusCode, 404, url);
    assertUnifiedError(res.body, "NOT_FOUND");
  }
  await app.close();
});

test("请求体超过上限（默认 1MB）：413 PAYLOAD_TOO_LARGE，统一错误格式", async () => {
  const app = newApp();
  const res = await app.inject({
    method: "POST",
    url: "/echo",
    headers: { "content-type": "application/json" },
    payload: JSON.stringify({ blob: "x".repeat(2 * 1024 * 1024) }),
  });
  assert.equal(res.statusCode, 413);
  assertUnifiedError(res.body, "PAYLOAD_TOO_LARGE");
  await app.close();
});

test("不支持的内容类型：415 UNSUPPORTED_MEDIA_TYPE，统一错误格式", async () => {
  const app = newApp();
  const res = await app.inject({
    method: "POST",
    url: "/echo",
    headers: { "content-type": "application/xml" },
    payload: "<a/>",
  });
  assert.equal(res.statusCode, 415);
  assertUnifiedError(res.body, "UNSUPPORTED_MEDIA_TYPE");
  await app.close();
});

test("畸形的 JSON 请求体（空、截断、原型污染、长度不符）：400 BAD_REQUEST，统一错误格式且不透出框架英文报错", async () => {
  const app = newApp();
  const cases: { name: string; payload: string; headers?: Record<string, string> }[] = [
    { name: "空请求体", payload: "" },
    { name: "截断的 JSON", payload: '{"a":' },
    { name: "__proto__ 污染", payload: '{"__proto__":{"admin":true}}' },
    { name: "constructor.prototype 污染", payload: '{"constructor":{"prototype":{"admin":true}}}' },
    { name: "content-length 比实际短", payload: '{"a":1}', headers: { "content-length": "5" } },
  ];
  for (const { name, payload, headers } of cases) {
    const res = await app.inject({
      method: "POST",
      url: "/echo",
      headers: { "content-type": "application/json", ...headers },
      payload,
    });
    assert.equal(res.statusCode, 400, name);
    const error = assertUnifiedError(res.body, "BAD_REQUEST");
    assert.ok(!/FST_|Unexpected|JSON/i.test(error.message), `${name}：透出了框架报错 ${error.message}`);
  }
  assert.equal(({} as { admin?: boolean }).admin, undefined, "全局原型被污染了");
  await app.close();
});

test("向不存在的接口提交畸形 JSON：仍是统一错误格式", async () => {
  const app = newApp();
  const res = await app.inject({
    method: "POST",
    url: "/no-such-route",
    headers: { "content-type": "application/json" },
    payload: "{not json",
  });
  assert.ok(res.statusCode === 400 || res.statusCode === 404, `状态码 ${res.statusCode}`);
  assertUnifiedError(res.body, res.statusCode === 400 ? "BAD_REQUEST" : "NOT_FOUND");
  await app.close();
});

test("很长的路径：404 统一错误格式", async () => {
  const app = newApp();
  const res = await app.inject({ method: "GET", url: "/" + "a".repeat(20_000) });
  assert.equal(res.statusCode, 404);
  assertUnifiedError(res.body, "NOT_FOUND");
  await app.close();
});

test("畸形 URL（非法的百分号编码）：400，统一错误格式", async () => {
  const app = newApp();
  for (const url of ["/%zz", "/health%", "/%E0%A4%A"]) {
    const res = await app.inject({ method: "GET", url });
    assert.equal(res.statusCode, 400, url);
    const error = assertUnifiedError(res.body, "BAD_REQUEST");
    assert.ok(!/FST_ERR|not a valid url/i.test(res.body), `透出了框架报错：${error.message}`);
  }
  await app.close();
});

/** 经真实套接字发一段原始请求，返回服务器的全部应答。 */
async function rawExchange(port: number, data: string): Promise<string> {
  const socket = connect(port, "127.0.0.1");
  let response = "";
  socket.on("data", (chunk: Buffer) => (response += chunk.toString("utf8")));
  socket.on("error", () => {});
  socket.write(data);
  const timer = setTimeout(() => socket.destroy(), 3_000);
  await once(socket, "close");
  clearTimeout(timer);
  return response;
}

test("HTTP 层就被拒绝的请求（请求头过大、不是 HTTP 的内容）：响应体也是统一错误格式", async () => {
  const app = newApp();
  await app.listen({ host: "127.0.0.1", port: 0 });
  try {
    const address = app.server.address();
    assert.ok(typeof address === "object" && address !== null);
    const cases: { name: string; data: string; status: number }[] = [
      {
        name: "请求头过大",
        data: `GET /health HTTP/1.1\r\nHost: x\r\nX-Big: ${"a".repeat(100_000)}\r\n\r\n`,
        status: 431,
      },
      { name: "不是 HTTP 的内容", data: "GARBAGE\r\n\r\n", status: 400 },
    ];
    for (const { name, data, status } of cases) {
      const response = await rawExchange(address.port, data);
      assert.match(response, new RegExp(`^HTTP/1\\.1 ${status} `), name);
      const body = response.slice(response.indexOf("\r\n\r\n") + 4);
      assertUnifiedError(body);
    }
  } finally {
    await app.close();
  }
});
