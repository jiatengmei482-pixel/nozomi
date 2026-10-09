import { test } from "node:test";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { checkPasswordStrength } from "./password-policy.ts";
import {
  TEMPORARY_PASSWORD_PATTERN,
  generateTemporaryPassword,
  passwordChangeRequiredFirst,
} from "./temporary-password.ts";

const EMAIL = "tanaka@example.com";
const secureRandom = (exclusiveMax: number): number => randomInt(exclusiveMax);

/** 按给定序列循环出数的假随机源。 */
function sequence(values: readonly number[]): (exclusiveMax: number) => number {
  let index = 0;
  return () => values[index++ % values.length] as number;
}

test("生成的临时密码：固定形状、通过现有的全部强度规则、含小写大写数字、没有容易看错的字符", () => {
  for (let round = 0; round < 500; round += 1) {
    const password = generateTemporaryPassword(EMAIL, secureRandom);
    assert.match(password, TEMPORARY_PASSWORD_PATTERN);
    assert.equal(password.length, 23);
    assert.deepEqual(checkPasswordStrength(password, EMAIL), []);
    assert.match(password, /[a-z]/);
    assert.match(password, /[A-Z]/);
    assert.match(password, /[0-9]/);
    assert.doesNotMatch(password, /[0Oo1lIi]/);
  }
});

test("每次都不一样：1000 个里没有重复", () => {
  const seen = new Set<string>();
  for (let round = 0; round < 1000; round += 1) seen.add(generateTemporaryPassword(EMAIL, secureRandom));
  assert.equal(seen.size, 1000);
});

test("字符取自随机源：同样的序列给出同样的密码，每个位置向随机源要一次、上限是字母表大小", () => {
  const asked: number[] = [];
  const values = [0, 23, 47, 1, 24, 48, 2, 25, 49, 3, 26, 50, 4, 27, 51, 5, 28, 52, 6, 29];
  const source = sequence(values);
  const password = generateTemporaryPassword(EMAIL, (max) => {
    asked.push(max);
    return source(max);
  });
  assert.equal(password, "aA2bB-3cC4d-D5eE6-fF7gG");
  assert.deepEqual(asked, new Array(20).fill(55));
  assert.equal(generateTemporaryPassword(EMAIL, sequence(values)), password);
});

test("缺一类字符的候选被整个丢弃重抽，不做修补", () => {
  const onlyLowercase = new Array<number>(20).fill(0).map((_, i) => i % 23);
  const good = [0, 23, 47, 1, 24, 48, 2, 25, 49, 3, 26, 50, 4, 27, 51, 5, 28, 52, 6, 29];
  let calls = 0;
  const values = [...onlyLowercase, ...good];
  const password = generateTemporaryPassword(EMAIL, () => values[calls++] as number);
  assert.equal(calls, 40);
  assert.equal(password, "aA2bB-3cC4d-D5eE6-fF7gG");
});

test("碰巧包含邮箱名的候选被丢弃：结果永远不含邮箱名", () => {
  // 邮箱名 abcd：第一轮候选以 abcd 开头，会被强度规则拒绝
  const containsEmailName = [0, 1, 2, 3, 23, 47, 24, 48, 25, 49, 4, 26, 50, 5, 27, 51, 6, 28, 52, 7];
  const good = [7, 23, 47, 8, 24, 48, 9, 25, 49, 10, 26, 50, 11, 27, 51, 12, 28, 52, 13, 29];
  let calls = 0;
  const values = [...containsEmailName, ...good];
  const password = generateTemporaryPassword("abcd@example.com", () => values[calls++] as number);
  assert.equal(calls, 40);
  assert.ok(!password.toLowerCase().includes("abcd"));
  assert.deepEqual(checkPasswordStrength(password, "abcd@example.com"), []);
});

test("随机源坏了（一直出同一个数、出范围外的数）：抛错，不会无限循环，也不会给出弱密码", () => {
  assert.throws(() => generateTemporaryPassword(EMAIL, () => 0), /没有给出合格的临时密码/);
  for (const bad of [-1, 55, 1.5, Number.NaN]) {
    assert.throws(() => generateTemporaryPassword(EMAIL, () => bad), RangeError);
  }
});

test("必须先修改密码：只放行查看自己、改密码、退出；没有标记时什么都不拦", () => {
  assert.equal(passwordChangeRequiredFirst(true, "general"), true);
  assert.equal(passwordChangeRequiredFirst(true, "self_service"), false);
  assert.equal(passwordChangeRequiredFirst(false, "general"), false);
  assert.equal(passwordChangeRequiredFirst(false, "self_service"), false);
});
