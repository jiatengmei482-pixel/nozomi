/** 必填文字不能只有看不见的字符（M4-18，ADR 0052）。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasVisibleText, visibleText } from "./validation.ts";

test("零宽、控制、双向控制、BOM、软连字符、各种空白、组合符号、显示成空白的字母都不算内容", () => {
  for (const blank of ["", " ", "　", "​‌‍", "\u0007\u0008", "‮⁠", "﻿­", "  ", "́", "️", "ㅤ", "⠀", "\u{E0020}"]) assert.equal(hasVisibleText(blank), false, JSON.stringify(blank));
  for (const real of ["故障", "a", "1", "。", "🚗", "故​障"]) assert.equal(hasVisibleText(real), true, real);
});

test("visibleText：内容原样保存（只去前后空白），长度照常限制", () => {
  const schema = visibleText(5);
  assert.equal(schema.parse("  故​障  "), "故​障");
  assert.equal(schema.safeParse("​​").success, false);
  assert.equal(schema.safeParse("字字字字字字").success, false);
});
