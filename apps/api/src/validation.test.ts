import { test } from "node:test";
import assert from "node:assert/strict";
import { AppError } from "./errors.ts";
import { z } from "zod";
import { acceptInviteSchema, auditFilterSchema, ifMatchVersion, loginSchema, pageQuerySchema, parseInput, resourceId } from "./validation.ts";

function failure(run: () => unknown): AppError {
  try {
    run();
  } catch (err) {
    assert.ok(err instanceof AppError);
    return err;
  }
  throw new Error("应该校验失败");
}

test("登录参数：邮箱去空格并转小写；结构里没有的字段（如 tenant_id）被丢掉", () => {
  const parsed = parseInput(
    loginSchema,
    { email: "  Admin@Example.COM ", password: "x", tenant_id: "11111111-1111-4111-8111-111111111111" },
    "body",
  );
  assert.deepEqual(parsed, { email: "admin@example.com", password: "x" });
});

test("校验失败：400 VALIDATION_FAILED，逐项列出字段路径和中文原因，不回显提交的值", () => {
  const err = failure(() => parseInput(loginSchema, { email: "not-an-email", password: "" }, "body"));
  assert.equal(err.statusCode, 400);
  assert.equal(err.code, "VALIDATION_FAILED");
  assert.deepEqual(err.details, {
    location: "body",
    issues: [
      { path: "/email", message: "不是合法的邮箱" },
      { path: "/password", message: "至少 1 个字符" },
    ],
  });
});

test("没有请求体、字段缺失、类型不对", () => {
  assert.deepEqual(failure(() => parseInput(loginSchema, undefined, "body")).details["issues"], [
    { path: "/email", message: "必填" },
    { path: "/password", message: "必填" },
  ]);
  assert.deepEqual(failure(() => parseInput(acceptInviteSchema, { token: 5, password: "x" }, "body")).details["issues"], [
    { path: "/token", message: "类型不正确" },
  ]);
});

test("超长输入被拒绝：邮箱 254、密码 1024", () => {
  const longEmail = `${"a".repeat(250)}@example.com`;
  assert.equal(failure(() => parseInput(loginSchema, { email: longEmail, password: "x" }, "body")).code, "VALIDATION_FAILED");
  assert.equal(
    failure(() => parseInput(loginSchema, { email: "a@example.com", password: "x".repeat(1025) }, "body")).code,
    "VALIDATION_FAILED",
  );
});

test("分页参数：默认 50，最大 200，查询串里的数字字符串能识别", () => {
  assert.deepEqual(parseInput(pageQuerySchema, {}, "querystring"), { limit: 50 });
  assert.deepEqual(parseInput(pageQuerySchema, { limit: "200", cursor: "abc" }, "querystring"), { limit: 200, cursor: "abc" });
  assert.deepEqual(parseInput(pageQuerySchema, { limit: "007" }, "querystring"), { limit: 7 });
  for (const limit of ["0", "201", "abc", "1.5", "0x10", "1e2", "1.0", " 5", "5 ", "+5", "-1", "", "٥", ["5", "6"], 5]) {
    const err = failure(() => parseInput(pageQuerySchema, { limit }, "querystring"));
    assert.equal(err.details["location"], "querystring");
  }
});

test("路径里的编号不是 UUID：按资源不存在处理（404），不会带着它去查数据库", () => {
  assert.equal(resourceId({ id: "AAAAAAAA-1111-4111-8111-111111111111" }, "账号"), "aaaaaaaa-1111-4111-8111-111111111111");
  for (const params of [{ id: "1" }, { id: "' or 1=1 --" }, {}, null]) {
    const err = failure(() => resourceId(params, "账号"));
    assert.equal(err.statusCode, 404);
    assert.equal(err.code, "NOT_FOUND");
  }
});

test("任何位置的字符串带 NUL 字符都是 400：顶层字段、嵌套对象、数组、结构里没声明的字段、字段名", () => {
  const schema = z.object({ name: z.string(), admin: z.object({ name: z.string() }).optional(), tags: z.array(z.string()).optional() });
  const cases: [unknown, string][] = [
    [{ name: "甲\u0000乙" }, "/name"],
    [{ name: "甲", admin: { name: "\u0000" } }, "/admin/name"],
    [{ name: "甲", tags: ["好", "坏\u0000"] }, "/tags/1"],
    [{ name: "甲", undeclared: "x\u0000" }, "/undeclared"],
    [{ name: "甲", ["键\u0000"]: "x" }, "/"],
  ];
  for (const [value, path] of cases) {
    const err = failure(() => parseInput(schema, value, "body"));
    assert.equal(err.statusCode, 400);
    assert.equal(err.code, "VALIDATION_FAILED");
    assert.deepEqual(err.details, { location: "body", issues: [{ path, message: "不能包含空字符（NUL）" }] });
  }
  assert.deepEqual(parseInput(schema, { name: "正常 的\n名字\t" }, "body"), { name: "正常 的\n名字\t" });
});

test("审计筛选的时间：格式对但换算不出时刻的（时区偏移越界）也是 400；合法的偏移按绝对时刻换算", () => {
  for (const value of ["2026-10-07T00:00:00+99:99", "2026-10-07T00:00:00-24:60", "2026-10-07T00:00:00+25:00", "2026-10-07T00:00:00", "2026-10-07"]) {
    for (const name of ["from", "to"]) {
      const err = failure(() => parseInput(auditFilterSchema, { [name]: value }, "querystring"));
      assert.equal(err.code, "VALIDATION_FAILED", `${name}=${value}`);
    }
  }
  const parsed = parseInput(auditFilterSchema, { from: "2026-10-07T09:00:00+09:00" }, "querystring");
  assert.equal(parsed.from?.toISOString(), "2026-10-07T00:00:00.000Z");
});

test("If-Match 里的版本号：带引号和不带引号都接受；没带是 428；不是正整数是 400", () => {
  assert.equal(ifMatchVersion('"3"'), 3);
  assert.equal(ifMatchVersion("3"), 3);
  assert.equal(ifMatchVersion(' "12" '), 12);
  const missing = failure(() => ifMatchVersion(undefined));
  assert.deepEqual([missing.statusCode, missing.code], [428, "PRECONDITION_REQUIRED"]);
  for (const header of ["", "0", "-1", "1.5", "abc", '"3', 'W/"3"', "*", '"3", "4"', "9999999999", ["1", "2"], 3]) {
    const err = failure(() => ifMatchVersion(header));
    assert.deepEqual([err.statusCode, err.code], [400, "VALIDATION_FAILED"], JSON.stringify(header));
    assert.deepEqual(err.details, { location: "headers", issues: [{ path: "/if-match", message: '必须是版本号（正整数），例如 "3"' }] });
  }
});

test("数据库存不了的字符串：孤立的代理字符（半个表情符号）和 NUL 一样在校验阶段拒绝，指出字段；完整的表情符号可以", () => {
  const schema = z.object({ name: z.object({ zh: z.string() }), tags: z.array(z.string()).optional() });
  assert.deepEqual(parseInput(schema, { name: { zh: "出租车🚕" } }, "body"), { name: { zh: "出租车🚕" } });
  for (const [value, path] of [
    [{ name: { zh: "abc\ud83d" } }, "/name/zh"],
    [{ name: { zh: "\udc00abc" } }, "/name/zh"],
    [{ name: { zh: "a\ud83d\ud83db" } }, "/name/zh"],
    [{ name: { zh: "ok" }, tags: ["fine", "bad\udfff"] }, "/tags/1"],
    [{ name: { zh: "ok" }, ["key\ud800"]: 1 }, "/"],
  ] as const) {
    const err = failure(() => parseInput(schema, value, "body"));
    assert.deepEqual([err.statusCode, err.code], [400, "VALIDATION_FAILED"]);
    assert.deepEqual(err.details["issues"], [{ path, message: "包含不完整的字符（多半是被截断的表情符号），请删掉后重试" }]);
  }
});

test("提示都是中文：无穷大的数字、数组的个数、可辨识联合的类型", () => {
  const schema = z.object({
    lng: z.number().finite().optional(),
    items: z.array(z.string()).min(1).max(2).optional(),
    shape: z.discriminatedUnion("type", [z.object({ type: z.literal("Polygon") }), z.object({ type: z.literal("MultiPolygon") })]).optional(),
  });
  const messages = (value: unknown): unknown => failure(() => parseInput(schema, value, "body")).details["issues"];
  assert.deepEqual(messages({ lng: Number.POSITIVE_INFINITY }), [{ path: "/lng", message: "必须是有限的数字" }]);
  assert.deepEqual(messages({ items: [] }), [{ path: "/items", message: "至少 1 项" }]);
  assert.deepEqual(messages({ items: ["a", "b", "c"] }), [{ path: "/items", message: "最多 2 项" }]);
  assert.deepEqual(messages({ shape: { type: "Point" } }), [{ path: "/shape/type", message: "只能是：Polygon、MultiPolygon" }]);
});
