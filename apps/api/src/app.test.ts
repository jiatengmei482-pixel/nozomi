import { after, test } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.ts";
import { createPool } from "./db/pool.ts";
import { AppError } from "./errors.ts";
import { FAKE_SECRETS, leakedSecrets, testConfig } from "./testing/fixtures.ts";

/** 连接池指向必然连不上的地址：这些测试不需要数据库，同时覆盖「数据库不通」的情况。 */
const pool = createPool(testConfig().databaseUrl, { connectionTimeoutMs: 1_000 });
after(() => pool.end());

function newApp(): FastifyInstance {
  return buildApp({ config: testConfig(), pool, migrationFiles: [], logger: false, healthTimeoutMs: 1_500 });
}

function assertErrorShape(body: unknown, code: string): void {
  assert.ok(typeof body === "object" && body !== null);
  assert.deepEqual(Object.keys(body), ["error"]);
  const error = (body as { error: Record<string, unknown> }).error;
  assert.deepEqual(Object.keys(error).sort(), ["code", "details", "message"]);
  assert.equal(error["code"], code);
  assert.equal(typeof error["message"], "string");
  assert.ok(typeof error["details"] === "object" && error["details"] !== null);
}

test("不存在的接口：404，统一错误格式", async () => {
  const app = newApp();
  const res = await app.inject({ method: "GET", url: "/no-such-route?token=abc" });
  assert.equal(res.statusCode, 404);
  assertErrorShape(res.json(), "NOT_FOUND");
  assert.deepEqual(res.json().error.details, { method: "GET", path: "/no-such-route" });
  await app.close();
});

test("未捕获的异常：500 INTERNAL_ERROR，响应里没有异常内容", async () => {
  const app = newApp();
  app.get("/boom", async () => {
    throw new Error(`内部细节 ${FAKE_SECRETS.authJwtSecret}`);
  });
  const res = await app.inject({ method: "GET", url: "/boom" });
  assert.equal(res.statusCode, 500);
  assertErrorShape(res.json(), "INTERNAL_ERROR");
  assert.ok(!res.body.includes("内部细节"));
  assert.deepEqual(leakedSecrets(res.body), []);
  await app.close();
});

test("业务抛出的 AppError：按其状态码和错误码返回", async () => {
  const app = newApp();
  app.get("/conflict", async () => {
    throw new AppError(409, "ALREADY_EXISTS", "已存在", { id: "x" });
  });
  const res = await app.inject({ method: "GET", url: "/conflict" });
  assert.equal(res.statusCode, 409);
  assert.deepEqual(res.json(), { error: { code: "ALREADY_EXISTS", message: "已存在", details: { id: "x" } } });
  await app.close();
});

test("参数校验失败：400 VALIDATION_FAILED", async () => {
  const app = newApp();
  app.post(
    "/echo",
    { schema: { body: { type: "object", required: ["n"], properties: { n: { type: "integer" } } } } },
    async () => ({}),
  );
  const res = await app.inject({ method: "POST", url: "/echo", payload: { n: "不是数字" } });
  assert.equal(res.statusCode, 400);
  assertErrorShape(res.json(), "VALIDATION_FAILED");
  assert.equal(res.json().error.details.location, "body");
  assert.equal(res.json().error.details.issues[0].path, "/n");
  await app.close();
});

test("请求体不是合法 JSON：400 BAD_REQUEST，统一错误格式", async () => {
  const app = newApp();
  app.post("/echo", async () => ({}));
  const res = await app.inject({
    method: "POST",
    url: "/echo",
    headers: { "content-type": "application/json" },
    payload: "{not json",
  });
  assert.equal(res.statusCode, 400);
  assertErrorShape(res.json(), "BAD_REQUEST");
  await app.close();
});

test("/health：数据库连不上时返回 503，内容仍是完整结构，且不含任何密钥原文", async () => {
  const app = newApp();
  const res = await app.inject({ method: "GET", url: "/health" });
  assert.equal(res.statusCode, 503);
  const body = res.json();
  assert.equal(body.status, "degraded");
  assert.deepEqual(body.database, { state: "down", latencyMs: null, errorCode: "DB_UNREACHABLE" });
  assert.equal(body.migrations.state, "unknown");
  assert.equal(body.integrations.length, 5);
  assert.equal(res.headers["cache-control"], "no-store");
  assert.deepEqual(leakedSecrets(res.body), []);
  assert.ok(!res.body.includes("ECONNREFUSED"));
  await app.close();
});
