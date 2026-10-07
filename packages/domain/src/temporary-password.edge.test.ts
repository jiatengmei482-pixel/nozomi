/**
 * 临时密码规则的边界（M0-12，ADR 0013）：测试角色补的用例。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, checkPasswordStrength } from "./password-policy.ts";
import {
  type RandomInt,
  type SessionPurpose,
  TEMPORARY_PASSWORD_GROUPS,
  TEMPORARY_PASSWORD_GROUP_LENGTH,
  TEMPORARY_PASSWORD_PATTERN,
  generateTemporaryPassword,
  passwordChangeRequiredFirst,
} from "./temporary-password.ts";

const ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const secureRandom: RandomInt = (exclusiveMax) => randomInt(exclusiveMax);
const indexOf = (character: string): number => {
  const index = ALPHABET.indexOf(character);
  assert.ok(index >= 0, `测试自己写错了：${character} 不在字母表里`);
  return index;
};
/** 让随机源依次「抽出」这些候选（不带连字符的 20 个字符一组）；用完之后抛错。 */
function drawing(...candidates: string[]): { source: RandomInt; used: () => number } {
  const values = candidates.flatMap((candidate) => [...candidate.replaceAll("-", "")].map(indexOf));
  let index = 0;
  return {
    source: () => {
      if (index >= values.length) throw new Error("随机源被多要了一次");
      return values[index++] as number;
    },
    used: () => index,
  };
}
const GOOD = "hA2jB-3kC4m-D5nE6-pF7qG";

test("字母表：恰好 55 个互不相同的字符，没有 0 O o 1 l I i；固定形状的正则只认这 55 个", () => {
  assert.equal(new Set(ALPHABET).size, 55);
  for (const confusing of "0Oo1lIi") {
    assert.ok(!ALPHABET.includes(confusing));
    assert.doesNotMatch(`${confusing}B3de-Fg4hJ-k5LmN-6pQrS`, TEMPORARY_PASSWORD_PATTERN);
  }
  for (const character of ALPHABET) assert.match(`${character}B3de-Fg4hJ-k5LmN-6pQrS`, TEMPORARY_PASSWORD_PATTERN);
  for (const wrong of ["aB3de-Fg4hJ-k5LmN", "aB3de-Fg4hJ-k5LmN-6pQrS-aB3de", "aB3deFg4hJk5LmN6pQrS", "aB3de_Fg4hJ_k5LmN_6pQrS", " aB3de-Fg4hJ-k5LmN-6pQrS", "aB3de-Fg4hJ-k5LmN-6pQr", ""]) {
    assert.doesNotMatch(wrong, TEMPORARY_PASSWORD_PATTERN);
  }
});

test("形状与长度：4 组 × 5 个字符 + 3 个连字符 = 23 个字符，落在密码长度规则之内；连字符只在第 6、12、18 位", () => {
  assert.equal(TEMPORARY_PASSWORD_GROUPS * TEMPORARY_PASSWORD_GROUP_LENGTH, 20);
  const password = generateTemporaryPassword("someone@example.com", secureRandom);
  assert.equal(password.length, 23);
  assert.ok(password.length >= PASSWORD_MIN_LENGTH && password.length <= PASSWORD_MAX_LENGTH);
  assert.deepEqual([...password].flatMap((character, index) => (character === "-" ? [index] : [])), [5, 11, 17]);
});

test("分布：4000 个密码的 80000 个随机字符里，55 个字符每个都出现、出现次数都在期望值的 ±15% 以内；20 个位置上没有哪个位置偏向某一类", () => {
  const counts = new Map<string, number>();
  const digitsAt = new Array<number>(20).fill(0);
  const rounds = 4000;
  for (let round = 0; round < rounds; round += 1) {
    const characters = [...generateTemporaryPassword("someone@example.com", secureRandom).replaceAll("-", "")];
    assert.equal(characters.length, 20);
    for (const [position, character] of characters.entries()) {
      counts.set(character, (counts.get(character) ?? 0) + 1);
      if (/[0-9]/.test(character)) digitsAt[position] = (digitsAt[position] as number) + 1;
    }
  }
  assert.equal(counts.size, 55);
  const expected = (rounds * 20) / 55;
  for (const [character, count] of counts) {
    assert.ok(Math.abs(count - expected) < expected * 0.15, `字符 ${character} 出现了 ${count} 次，期望约 ${Math.round(expected)} 次`);
  }
  // 数字占 8/55；如果实现为了凑齐三类而把数字塞在固定位置，那个位置会明显偏高
  const expectedDigits = (rounds * 8) / 55;
  for (const [position, count] of digitsAt.entries()) {
    assert.ok(Math.abs(count - expectedDigits) < expectedDigits * 0.25, `第 ${position} 位出现了 ${count} 次数字，期望约 ${Math.round(expectedDigits)} 次`);
  }
});

test("不含邮箱名：邮箱名大小写不同、横跨一组的边界（含连字符）、正好是整个一组时，撞上的候选都被整个丢弃重抽", () => {
  for (const [email, colliding] of [
    ["HJKM@example.com", "hjkmA-2bB3c-C4dD5-eE6fF"],
    ["hjkm@example.com", "HjKmA-2bB3c-C4dD5-eE6fF"],
    ["a2bde-fg@example.com", "A2bDe-Fg3hJ-k5LmN-6pQrS"],
    ["fg4hj@example.com", "aB3de-Fg4hJ-k5LmN-6pQrS"],
    ["6pqrs@example.com", "aB3de-Fg4hJ-k5LmN-6pQrS"],
  ] as const) {
    assert.ok(checkPasswordStrength(colliding, email).includes("PASSWORD_CONTAINS_EMAIL"), `测试前提：${colliding} 含 ${email} 的邮箱名`);
    const { source, used } = drawing(colliding, GOOD);
    const password = generateTemporaryPassword(email, source);
    assert.equal(password, GOOD, email);
    assert.equal(used(), 40, "撞上的候选整个丢弃，重抽了完整的 20 个字符");
    assert.deepEqual(checkPasswordStrength(password, email), []);
  }
});

test("邮箱名不足 4 个字符（强度规则不检查）时不白白丢弃候选；没有 @ 的、空的、很怪的邮箱不会让生成出错", () => {
  const { source, used } = drawing("abcA2-bB3cC-4dD5e-E6fF7");
  assert.equal(generateTemporaryPassword("abc@example.com", source), "abcA2-bB3cC-4dD5e-E6fF7");
  assert.equal(used(), 20);
  for (const email of ["", "@", "no-at-sign", "a@b@c", "名字@例子.测试", "x".repeat(300), "a.b+tag@example.com", "----@example.com", "abcd"]) {
    for (let round = 0; round < 50; round += 1) {
      const password = generateTemporaryPassword(email, secureRandom);
      assert.match(password, TEMPORARY_PASSWORD_PATTERN);
      assert.deepEqual(checkPasswordStrength(password, email), [], email);
    }
  }
});

test("重抽次数的上限：前 99 个候选都不合格、第 100 个合格——给出第 100 个；100 个都不合格——抛错而不是给出不合格的密码", () => {
  const bad = "aaaaa-aaaaa-aaaaa-aaaaa";
  const ninetyNine = drawing(...new Array<string>(99).fill(bad), GOOD);
  assert.equal(generateTemporaryPassword("someone@example.com", ninetyNine.source), GOOD);
  assert.equal(ninetyNine.used(), 2000);

  const hundred = drawing(...new Array<string>(100).fill(bad), GOOD);
  assert.throws(() => generateTemporaryPassword("someone@example.com", hundred.source), /没有给出合格的临时密码/);
  assert.equal(hundred.used(), 2000, "到上限就停，没有多要随机数");

  // 每个候选都撞上邮箱名：同样抛错，不会把含邮箱名的密码交出去
  const colliding = drawing(...new Array<string>(100).fill("hjkmA-2bB3c-C4dD5-eE6fF"));
  assert.throws(() => generateTemporaryPassword("hjkm@example.com", colliding.source), /没有给出合格的临时密码/);
});

test("缺任何一类字符的候选都不合格：只缺数字、只缺大写、只缺小写（即使加上连字符已经满足「四类占三类」）", () => {
  for (const lacking of ["aBcde-FghJk-mNpqR-sTuvW", "a2cde-3ghjk-m4pqr-s5uvw", "A2CDE-3GHJK-M4PQR-S5UVW"]) {
    assert.deepEqual(checkPasswordStrength(lacking, "someone@example.com"), [], "测试前提：一般的强度规则是放行它的");
    const { source, used } = drawing(lacking, GOOD);
    assert.equal(generateTemporaryPassword("someone@example.com", source), GOOD);
    assert.equal(used(), 40);
  }
});

test("随机源出错时原样抛出，不吞掉、不退回到别的随机源", () => {
  const failure = new Error("熵源不可用");
  assert.throws(
    () =>
      generateTemporaryPassword("someone@example.com", () => {
        throw failure;
      }),
    (err: unknown) => err === failure,
  );
  for (const bad of [Number.POSITIVE_INFINITY, -0.5, 54.999, "3" as unknown as number, null as unknown as number, undefined as unknown as number]) {
    assert.throws(() => generateTemporaryPassword("someone@example.com", () => bad), RangeError);
  }
});

test("放行规则是白名单：用途只有写明 self_service 才放行；拼错的、大小写不同的、缺失的用途一律按普通请求拦下", () => {
  for (const purpose of ["SELF_SERVICE", "self-service", "selfService", " self_service", "", "general", "admin", undefined, null, true, 1]) {
    assert.equal(passwordChangeRequiredFirst(true, purpose as SessionPurpose), true, `用途 ${String(purpose)} 不应放行`);
    assert.equal(passwordChangeRequiredFirst(false, purpose as SessionPurpose), false);
  }
  assert.equal(passwordChangeRequiredFirst(true, "self_service"), false);
});
