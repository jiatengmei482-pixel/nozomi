/**
 * 日志内容的测试：把日志截到内存里，确认请求日志不含查询串和请求头，异常日志不含密钥和连接串。
 * 不需要数据库。
 */
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "./app.ts";
import { createPool } from "./db/pool.ts";
import { FAKE_SECRETS, leakedSecrets, testConfig } from "./testing/fixtures.ts";

const pool = createPool(testConfig().databaseUrl, { connectionTimeoutMs: 1_000 });
after(() => pool.end());

function appWithCapturedLogs(): { app: ReturnType<typeof buildApp>; lines: () => Record<string, any>[]; text: () => string } {
  let captured = "";
  const app = buildApp({
    config: testConfig(),
    pool,
    migrationFiles: [],
    logDestination: { write: (line) => void (captured += line) },
    healthTimeoutMs: 1_500,
  });
  return {
    app,
    text: () => captured,
    lines: () =>
      captured
        .split("\n")
        .filter((line) => line !== "")
        .map((line) => JSON.parse(line) as Record<string, any>),
  };
}

test("请求日志只记方法和路径：查询串、请求头里的凭证都不出现", async () => {
  const { app, lines, text } = appWithCapturedLogs();
  await app.inject({
    method: "GET",
    url: "/no-such-route?token=tok_in_query_string&email=a%40b.c",
    headers: { authorization: "Bearer fake-user-token-1a2b3c", cookie: "session=fake-cookie-9z8y", "x-api-key": "fake-api-key-7q" },
  });
  await app.close();
  const incoming = lines().find((line) => line["msg"] === "incoming request");
  assert.ok(incoming, "没有请求日志");
  assert.deepEqual(Object.keys(incoming["req"]).sort(), ["method", "path", "remoteAddress"]);
  assert.equal(incoming["req"].method, "GET");
  assert.equal(incoming["req"].path, "/no-such-route");
  for (const forbidden of ["tok_in_query_string", "token=", "fake-user-token-1a2b3c", "fake-cookie-9z8y", "fake-api-key-7q"]) {
    assert.ok(!text().includes(forbidden), `日志里出现了 ${forbidden}`);
  }
  assert.ok(lines().some((line) => line["msg"] === "request completed" && line["res"]?.statusCode === 404));
});

test("未预期的异常进日志时：带连接串的附加字段被丢弃，说明和调用栈里的密钥被抹掉", async () => {
  const { app, lines, text } = appWithCapturedLogs();
  const badUrl = `postgres://app:${FAKE_SECRETS.databasePassword}@127.0.0.1:99999/nozomi`;
  app.get("/invalid-url", async () => new URL(badUrl).host);
  app.get("/leaky-message", async () => {
    throw Object.assign(new Error(`upstream rejected key ${FAKE_SECRETS.stripeSecretKey} at https://u:another-pw-5t@api.example.com/x`), {
      config: { connectionString: badUrl },
    });
  });
  assert.equal((await app.inject({ method: "GET", url: "/invalid-url" })).statusCode, 500);
  assert.equal((await app.inject({ method: "GET", url: "/leaky-message" })).statusCode, 500);
  await app.close();

  const errors = lines().filter((line) => line["msg"] === "未预期的异常");
  assert.equal(errors.length, 2);
  for (const line of errors) {
    assert.deepEqual(Object.keys(line["err"]).sort(), ["code", "message", "stack", "type"]);
  }
  assert.equal(errors[0]?.["err"].code, "ERR_INVALID_URL");
  assert.deepEqual(leakedSecrets(text()), []);
  assert.ok(!text().includes("another-pw-5t"));
  assert.ok(!text().includes("127.0.0.1:99999"), "连接串的片段进了日志");
});

test("数据库拒绝了一条语句（如违反检查约束）而变成 500 时：日志里有数据库的错误码、说明（哪张表、哪个约束）、请求编号和是哪个请求，足够定位", async () => {
  const { app, lines } = appWithCapturedLogs();
  app.post("/constraint", async () => {
    throw Object.assign(new Error('new row for relation "login_throttles" violates check constraint "login_throttles_count_positive"'), { name: "error", code: "23514", detail: "Failing row contains (k, 0, 2026-10-07)." });
  });
  const res = await app.inject({ method: "POST", url: "/constraint?x=1" });
  assert.deepEqual([res.statusCode, res.json().error.code], [500, "INTERNAL_ERROR"]);
  assert.ok(!res.body.includes("login_throttles"), "数据库的报错不给调用方看");
  await app.close();
  const logged = lines().find((line) => line["msg"] === "未预期的异常");
  assert.ok(logged, "500 一定有一条 error 级别的日志");
  assert.deepEqual([logged["level"], logged["err"].code, typeof logged["reqId"]], [50, "23514", "string"]);
  assert.match(logged["err"].message, /login_throttles_count_positive/);
  assert.match(logged["err"].stack, /app\.logging\.test/);
  // 同一个请求编号的「收到请求」那一行带着方法和路径
  const incoming = lines().find((line) => line["reqId"] === logged["reqId"] && line["req"] !== undefined);
  assert.deepEqual([incoming?.["req"].method, incoming?.["req"].path], ["POST", "/constraint"]);
});

test("开始关闭后才完成的请求：应答带 Connection: close，让保持连接的客户端立即断开", async () => {
  const { app } = appWithCapturedLogs();
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered: () => void = () => {};
  const inHandler = new Promise<void>((resolve) => {
    entered = resolve;
  });
  app.get("/slow", async () => {
    entered();
    await gate;
    return { ok: true };
  });
  const before = await app.inject({ method: "GET", url: "/health" });
  assert.notEqual(before.headers["connection"], "close");

  const pending = app.inject({ method: "GET", url: "/slow" });
  await inHandler;
  const closed = app.close();
  await new Promise((resolve) => setImmediate(resolve));
  release();
  const res = await pending;
  await closed;
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers["connection"], "close");
});
