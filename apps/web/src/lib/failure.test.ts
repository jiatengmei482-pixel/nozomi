import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, NetworkError } from "../api/client.ts";
import { failureText, isThrottled, isUnauthenticated, throttledText, weakPasswordMessages } from "./failure.ts";

test("限流提示：有等待时间时向上取整到分钟，没有时不编数字", () => {
  assert.equal(throttledText(null), "尝试次数过多，请稍后再试。");
  assert.equal(throttledText(0), "尝试次数过多，请稍后再试。");
  assert.equal(throttledText(Number.NaN), "尝试次数过多，请稍后再试。");
  assert.equal(throttledText(1), "尝试次数过多，请 1 分钟后再试。");
  assert.equal(throttledText(60), "尝试次数过多，请 1 分钟后再试。");
  assert.equal(throttledText(61), "尝试次数过多，请 2 分钟后再试。");
  assert.equal(throttledText(900), "尝试次数过多，请 15 分钟后再试。");
});

test("失败说明：网络、限流、业务拒绝、服务器出错各有各的话", () => {
  assert.equal(failureText(new NetworkError(), "登录"), "网络连接失败，请检查网络后重试。");
  assert.equal(failureText(new ApiError(429, "TOO_MANY_LOGIN_ATTEMPTS", "x", {}, 120), "登录"), "尝试次数过多，请 2 分钟后再试。");
  assert.equal(failureText(new ApiError(409, "EMAIL_TAKEN", "邮箱已被使用", {}, null), "保存"), "邮箱已被使用");
  assert.equal(failureText(new ApiError(400, "VALIDATION_FAILED", "请求参数校验未通过", {}, null), "保存"), "提交的内容不符合要求，请检查后重试。");
  assert.equal(failureText(new ApiError(500, "INTERNAL_ERROR", "服务器内部错误", {}, null), "登录"), "系统暂时无法登录，请稍后再试。");
  assert.equal(failureText(new ApiError(502, "UNKNOWN", "", {}, null), "设置密码"), "系统暂时无法设置密码，请稍后再试。");
  assert.equal(failureText(new ApiError(400, "UNKNOWN", "", {}, null), "保存"), "系统暂时无法保存，请稍后再试。");
  assert.equal(failureText(new Error("boom"), "保存"), "系统暂时无法保存，请稍后再试。");
});

test("401 与 429 的判断", () => {
  assert.equal(isUnauthenticated(new ApiError(401, "UNAUTHENTICATED", "", {}, null)), true);
  assert.equal(isUnauthenticated(new ApiError(403, "FORBIDDEN", "", {}, null)), false);
  assert.equal(isUnauthenticated(new NetworkError()), false);
  assert.equal(isThrottled(new ApiError(429, "X", "", {}, null)), true);
  assert.equal(isThrottled(new NetworkError()), false);
});

test("取出后端返回的密码规则说明，格式不对的条目忽略", () => {
  const err = new ApiError(400, "WEAK_PASSWORD", "密码强度不够", { issues: [{ code: "A", message: "密码不能包含邮箱名" }, { code: "B" }, "x", null] }, null);
  assert.deepEqual(weakPasswordMessages(err), ["密码不能包含邮箱名"]);
  assert.deepEqual(weakPasswordMessages(new ApiError(400, "WEAK_PASSWORD", "", {}, null)), []);
});
