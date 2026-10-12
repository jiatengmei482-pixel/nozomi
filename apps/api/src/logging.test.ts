import { test } from "node:test";
import assert from "node:assert/strict";
import { REDACTED, pathOnly, redactText, secretValues, serializeError, serializeRequest } from "./logging.ts";
import { FAKE_SECRETS, leakedSecrets, testConfig } from "./testing/fixtures.ts";

const secrets = secretValues(testConfig());

test("secretValues：包含各密钥、连接串、连接串里的密码（含转义前后两种写法和查询参数里的密码）", () => {
  for (const value of [
    FAKE_SECRETS.authJwtSecret,
    FAKE_SECRETS.stripeSecretKey,
    FAKE_SECRETS.stripeWebhookSecret,
    FAKE_SECRETS.googleMapsApiKey,
    FAKE_SECRETS.databasePassword,
  ]) {
    assert.ok(secrets.includes(value), value.slice(0, 6));
  }
  const encoded = secretValues(testConfig("postgres://app:p%40ss%2Fw0rd%3AZq7@127.0.0.1:1/nozomi"));
  assert.ok(encoded.includes("p%40ss%2Fw0rd%3AZq7"));
  assert.ok(encoded.includes("p@ss/w0rd:Zq7"));
  const inQuery = secretValues(testConfig("postgres://app@127.0.0.1:1/nozomi?password=query-pw-Zq7"));
  assert.ok(inQuery.includes("query-pw-Zq7"));
});

test("secretValues：未配置的集成和过短的值不产生条目", () => {
  const values = secretValues({ ...testConfig("postgres://app:pw@127.0.0.1:1/nozomi"), stripe: null, googleMapsApiKey: null });
  assert.ok(values.every((v) => v.length >= 8));
  assert.ok(!values.includes("pw"));
});

test("redactText：密钥原文被替换，其他文字不变", () => {
  const text = `签名失败 key=${FAKE_SECRETS.stripeSecretKey} 用户 42`;
  assert.equal(redactText(text, secrets), `签名失败 key=${REDACTED} 用户 42`);
});

test("redactText：任何「协议://…」内容都被抹掉，即使不在已知密钥里（含无法解析的连接串）", () => {
  const cases = [
    "connect failed postgres://other:unknown-pw@db.internal:5432/x",
    "Invalid URL postgres://app:unknown-pw@127.0.0.1:99999/nozomi",
    "bad host postgres://app:unknown-pw@db host/nozomi",
    "callback https://user:unknown-pw@example.com/hook?token=unknown-pw",
  ];
  for (const text of cases) {
    const result = redactText(text, []);
    assert.ok(!result.includes("unknown-pw"), result);
    assert.ok(result.includes(REDACTED));
  }
});

test("serializeError：只保留类型、错误码、说明、调用栈；input 之类带连接串的字段被丢弃", () => {
  const url = `postgres://app:${FAKE_SECRETS.databasePassword}@127.0.0.1:99999/nozomi`;
  let thrown: unknown;
  try {
    new URL(url);
  } catch (err) {
    thrown = err;
  }
  assert.ok(JSON.stringify({ ...(thrown as object) }).includes(FAKE_SECRETS.databasePassword), "前提：原始异常的字段里带密码");
  const logged = serializeError(thrown, secrets);
  assert.deepEqual(Object.keys(logged), ["type", "code", "message", "stack"]);
  assert.equal(logged.type, "TypeError");
  assert.equal(logged.code, "ERR_INVALID_URL");
  assert.deepEqual(leakedSecrets(JSON.stringify(logged)), []);
});

test("serializeError：说明和调用栈里的密钥、连接串被抹掉", () => {
  const err = new Error(`connect to postgres://app:whatever-pw@db:5432/x failed, jwt=${FAKE_SECRETS.authJwtSecret}`);
  const logged = serializeError(err, secrets);
  const text = JSON.stringify(logged);
  assert.ok(!text.includes("whatever-pw"));
  assert.deepEqual(leakedSecrets(text), []);
  assert.match(logged.stack, /logging\.test\.ts/);
});

test("serializeError：抛出的不是对象时也能记录", () => {
  assert.deepEqual(serializeError("boom", []), { type: "string", code: null, message: "boom", stack: "" });
  assert.deepEqual(serializeError(null, []), { type: "object", code: null, message: "null", stack: "" });
  assert.equal(serializeError(FAKE_SECRETS.authJwtSecret, secrets).message, REDACTED);
});

test("pathOnly / serializeRequest：不记查询串和片段", () => {
  assert.equal(pathOnly("/health"), "/health");
  assert.equal(pathOnly("/a/b?token=abc&x=1"), "/a/b");
  assert.equal(pathOnly("/a#frag"), "/a");
  assert.equal(pathOnly("?only"), "");
  assert.deepEqual(serializeRequest({ method: "GET", url: "/quotes?token=abc", ip: "10.0.0.1" }), {
    method: "GET",
    path: "/quotes",
    remoteAddress: "10.0.0.1",
  });
  assert.deepEqual(serializeRequest({}), { method: "", path: "", remoteAddress: "" });
});
