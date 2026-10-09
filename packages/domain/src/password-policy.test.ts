import { test } from "node:test";
import assert from "node:assert/strict";
import {
  PASSWORD_ISSUE_MESSAGES,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  checkPasswordStrength,
} from "./password-policy.ts";

const EMAIL = "tanaka@example.com";

test("够长、三类字符、不重复、不含邮箱名：通过", () => {
  assert.deepEqual(checkPasswordStrength("Blue-Harbor-2026", EMAIL), []);
  assert.deepEqual(checkPasswordStrength("correct horse Battery 9", EMAIL), []);
  assert.deepEqual(checkPasswordStrength("密码也可以是中文Abc123", EMAIL), []);
});

test("长度边界：11 个字符太短，12 个通过；128 个通过，129 个太长", () => {
  assert.deepEqual(checkPasswordStrength("Abcdef-12345", EMAIL), []);
  assert.deepEqual(checkPasswordStrength("Abcdef-1234", EMAIL), ["PASSWORD_TOO_SHORT"]);
  const filler = "Abcdef-1234567890";
  const exactlyMax = filler.repeat(8).slice(0, PASSWORD_MAX_LENGTH);
  assert.equal(exactlyMax.length, PASSWORD_MAX_LENGTH);
  assert.deepEqual(checkPasswordStrength(exactlyMax, EMAIL), []);
  assert.deepEqual(checkPasswordStrength(`${exactlyMax}x`, EMAIL), ["PASSWORD_TOO_LONG"]);
});

test("长度按字符数算，不按字节数：12 个表情符号不算太短", () => {
  const issues = checkPasswordStrength("😀😁😂🤣😃😄😅😆😉😊😋😎", EMAIL);
  assert.ok(!issues.includes("PASSWORD_TOO_SHORT"));
});

test("字符种类不足三类", () => {
  assert.deepEqual(checkPasswordStrength("abcdefghijklmnop", EMAIL), ["PASSWORD_TOO_FEW_CHARACTER_CLASSES"]);
  assert.deepEqual(checkPasswordStrength("abcdefgh12345678", EMAIL), ["PASSWORD_TOO_FEW_CHARACTER_CLASSES"]);
  assert.deepEqual(checkPasswordStrength("abcdefgh1234567X", EMAIL), []);
});

test("重复串：不同字符少于 6 个", () => {
  assert.deepEqual(checkPasswordStrength("Aa1Aa1Aa1Aa1", EMAIL), ["PASSWORD_TOO_REPETITIVE"]);
  assert.deepEqual(checkPasswordStrength("Aa1Bb2Aa1Bb2", EMAIL), []);
});

test("包含邮箱名（不分大小写）；邮箱名短于 4 个字符时不检查", () => {
  assert.deepEqual(checkPasswordStrength("TANAKA-harbor-2026", EMAIL), ["PASSWORD_CONTAINS_EMAIL"]);
  assert.deepEqual(checkPasswordStrength("Li-harbor-2026!", "li@example.com"), []);
  assert.deepEqual(checkPasswordStrength("Blue-Harbor-2026", ""), []);
});

test("多项不满足时全部列出，每一项都有中文说明", () => {
  const issues = checkPasswordStrength("aaaa", EMAIL);
  assert.deepEqual(issues, ["PASSWORD_TOO_SHORT", "PASSWORD_TOO_FEW_CHARACTER_CLASSES", "PASSWORD_TOO_REPETITIVE"]);
  for (const issue of issues) assert.ok(PASSWORD_ISSUE_MESSAGES[issue].length > 0);
  assert.match(PASSWORD_ISSUE_MESSAGES.PASSWORD_TOO_SHORT, new RegExp(String(PASSWORD_MIN_LENGTH)));
});
