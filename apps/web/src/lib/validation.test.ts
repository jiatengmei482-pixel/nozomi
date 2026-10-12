import { test } from "node:test";
import assert from "node:assert/strict";
import { PASSWORD_ISSUE_MESSAGES, PASSWORD_MIN_LENGTH } from "@nozomi/domain";
import {
  PASSWORD_RULES_HINT,
  validateLoginEmail,
  validateLoginPassword,
  validateNewPassword,
  validatePasswordConfirmation,
} from "./validation.ts";

test("登录邮箱：空、格式不对、首尾空格", () => {
  assert.equal(validateLoginEmail(""), "请输入邮箱");
  assert.equal(validateLoginEmail("   "), "请输入邮箱");
  assert.equal(validateLoginEmail("abc"), "邮箱格式不正确");
  assert.equal(validateLoginEmail("a@b"), "邮箱格式不正确");
  assert.equal(validateLoginEmail("a b@c.co"), "邮箱格式不正确");
  assert.equal(validateLoginEmail("  a@b.co  "), null);
});

test("登录密码只查是否为空，不查强度，不去空格", () => {
  assert.equal(validateLoginPassword(""), "请输入密码");
  assert.equal(validateLoginPassword(" "), null);
  assert.equal(validateLoginPassword("x"), null);
});

test("新密码：文案与后端同一份，逐条列出没满足的规则", () => {
  assert.deepEqual(validateNewPassword("", "a@b.co"), ["请输入新密码"]);
  assert.deepEqual(validateNewPassword("Abc1", ""), [PASSWORD_ISSUE_MESSAGES.PASSWORD_TOO_SHORT, PASSWORD_ISSUE_MESSAGES.PASSWORD_TOO_REPETITIVE]);
  assert.deepEqual(validateNewPassword("zhangsan-Pass-2026", "zhangsan@b.co"), [PASSWORD_ISSUE_MESSAGES.PASSWORD_CONTAINS_EMAIL]);
  assert.deepEqual(validateNewPassword("zhangsan-Pass-2026", ""), []);
});

test("再输入一次：空、不一致、一致", () => {
  assert.equal(validatePasswordConfirmation("abc", ""), "请再输入一次新密码");
  assert.equal(validatePasswordConfirmation("abc", "abd"), "两次输入的密码不一致");
  assert.equal(validatePasswordConfirmation("abc", "abc"), null);
});

test("规则说明里的最短长度取自常量", () => {
  assert.ok(PASSWORD_RULES_HINT.includes(`至少 ${PASSWORD_MIN_LENGTH} 个字符`));
});
