import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError, errorBody, rawClientErrorResponse, toErrorResponse } from "./errors.ts";

test("errorBody 总是带 code、message、details 三项", () => {
  assert.deepEqual(errorBody("X", "说明"), { error: { code: "X", message: "说明", details: {} } });
});

test("AppError 按自身的状态码、错误码、详情返回", () => {
  const r = toErrorResponse(new AppError(409, "QUOTE_EXPIRED", "报价已过期", { quoteId: "q1" }));
  assert.equal(r.statusCode, 409);
  assert.equal(r.unexpected, false);
  assert.deepEqual(r.body, { error: { code: "QUOTE_EXPIRED", message: "报价已过期", details: { quoteId: "q1" } } });
});

test("5xx 的 AppError 仍算未预期，需要记日志", () => {
  assert.equal(toErrorResponse(new AppError(502, "UPSTREAM_FAILED", "上游服务出错")).unexpected, true);
});

test("未知异常变成 500 INTERNAL_ERROR，且不带原始报错", () => {
  const r = toErrorResponse(new Error("connect ECONNREFUSED postgres://app:pw@db:5432"));
  assert.equal(r.statusCode, 500);
  assert.equal(r.unexpected, true);
  assert.equal(r.body.error.code, "INTERNAL_ERROR");
  assert.ok(!JSON.stringify(r.body).includes("ECONNREFUSED"));
  assert.ok(!JSON.stringify(r.body).includes("pw@"));
});

test("抛出的不是 Error 对象时也返回 500", () => {
  for (const thrown of [null, undefined, "boom", 42]) {
    assert.equal(toErrorResponse(thrown).body.error.code, "INTERNAL_ERROR");
  }
});

test("参数校验错误变成 400 VALIDATION_FAILED，details 列出每一项", () => {
  const r = toErrorResponse({
    statusCode: 400,
    validationContext: "body",
    validation: [{ instancePath: "/amount", message: "must be integer" }, {}],
  });
  assert.equal(r.statusCode, 400);
  assert.equal(r.body.error.code, "VALIDATION_FAILED");
  assert.deepEqual(r.body.error.details, {
    location: "body",
    issues: [
      { path: "/amount", message: "must be integer" },
      { path: "", message: "" },
    ],
  });
});

test("框架抛出的 4xx 按状态码归类，不透出框架的英文报错", () => {
  const cases: [number, string][] = [
    [400, "BAD_REQUEST"],
    [413, "PAYLOAD_TOO_LARGE"],
    [415, "UNSUPPORTED_MEDIA_TYPE"],
    [418, "BAD_REQUEST"],
  ];
  for (const [statusCode, code] of cases) {
    const r = toErrorResponse(Object.assign(new Error("framework says no"), { statusCode }));
    assert.equal(r.statusCode, statusCode);
    assert.equal(r.body.error.code, code);
    assert.equal(r.unexpected, false);
    assert.ok(!r.body.error.message.includes("framework"));
  }
});

test("带 5xx statusCode 的未知异常仍按 500 处理", () => {
  const r = toErrorResponse(Object.assign(new Error("x"), { statusCode: 503 }));
  assert.equal(r.statusCode, 500);
  assert.equal(r.body.error.code, "INTERNAL_ERROR");
});

test("HTTP 解析阶段的错误：生成完整的原始应答，状态行、长度和统一格式的响应体都正确", () => {
  const cases: [string | null, number, string][] = [
    ["HPE_HEADER_OVERFLOW", 431, "REQUEST_HEADER_FIELDS_TOO_LARGE"],
    ["ERR_HTTP_REQUEST_TIMEOUT", 408, "REQUEST_TIMEOUT"],
    ["HPE_INVALID_METHOD", 400, "BAD_REQUEST"],
    [null, 400, "BAD_REQUEST"],
  ];
  for (const [parserCode, statusCode, code] of cases) {
    const raw = rawClientErrorResponse(parserCode);
    const [head, body] = raw.split("\r\n\r\n") as [string, string];
    assert.match(head, new RegExp(`^HTTP/1\\.1 ${statusCode} [A-Z][A-Za-z ]+\r\n`));
    assert.match(head, /\r\nConnection: close$/);
    assert.ok(head.includes(`Content-Length: ${Buffer.byteLength(body)}`));
    const parsed = JSON.parse(body) as { error: { code: string; message: string; details: unknown } };
    assert.deepEqual(Object.keys(parsed.error).sort(), ["code", "details", "message"]);
    assert.equal(parsed.error.code, code);
  }
});
