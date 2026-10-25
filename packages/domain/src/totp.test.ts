import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import {
  RECOVERY_CODE_ALPHABET,
  RECOVERY_CODE_COUNT,
  base32Decode,
  base32Encode,
  checkTotp,
  hotp,
  newRecoveryCode,
  newRecoveryCodes,
  normalizeRecoveryCode,
  normalizeTotpInput,
  otpauthUri,
  totpCode,
  totpStep,
  totpStepEndsAt,
} from "./totp.ts";

const hmac = (key: Uint8Array, message: Uint8Array): Uint8Array => createHmac("sha1", key).update(message).digest();
/** RFC 4226 / RFC 6238 附录里 SHA1 用的密钥：ASCII 的 "12345678901234567890" */
const RFC_KEY = new TextEncoder().encode("12345678901234567890");

test("HOTP 对照 RFC 4226 附录 D 的 10 个测试向量", () => {
  const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
  expected.forEach((code, counter) => assert.equal(hotp(hmac, RFC_KEY, counter), code, `计数 ${counter}`));
});

test("TOTP 对照 RFC 6238 附录 B 的 SHA1 测试向量（8 位）", () => {
  const vectors: [number, string][] = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];
  for (const [seconds, code] of vectors) {
    assert.equal(totpCode(hmac, RFC_KEY, totpStep(seconds * 1000), 8), code, `T = ${seconds}`);
  }
  // 6 位就是 8 位的后 6 位（同一个截取值对 10^6 取余）
  assert.equal(totpCode(hmac, RFC_KEY, totpStep(59_000)), "287082");
});

test("时间窗：30 秒一个，边界那一毫秒属于下一个", () => {
  assert.equal(totpStep(0), 0);
  assert.equal(totpStep(29_999), 0);
  assert.equal(totpStep(30_000), 1);
  assert.equal(totpStepEndsAt(0), 30_000);
  assert.equal(totpStepEndsAt(totpStep(1_234_567_890_000)), 1_234_567_890_000 - (1_234_567_890_000 % 30_000) + 30_000);
});

test("核对动态码：当前时间窗前后各容忍一个，再远就不收", () => {
  const now = 1_700_000_015_000;
  const step = totpStep(now);
  const at = (s: number): string => totpCode(hmac, RFC_KEY, s);
  for (const s of [step - 1, step, step + 1]) assert.deepEqual(checkTotp(hmac, RFC_KEY, at(s), now, null), { ok: true, step: s });
  for (const s of [step - 2, step + 2]) assert.deepEqual(checkTotp(hmac, RFC_KEY, at(s), now, null), { ok: false, reason: "INVALID" });
  // 时间窗的边界：上一窗的最后一毫秒、下一窗的第一毫秒
  const boundary = totpStepEndsAt(step);
  assert.deepEqual(checkTotp(hmac, RFC_KEY, at(step - 1), boundary - 1, null), { ok: true, step: step - 1 });
  assert.deepEqual(checkTotp(hmac, RFC_KEY, at(step - 1), boundary, null), { ok: false, reason: "INVALID" }, "到了 step+1 窗，step-1 已经差两个窗");
});

test("防重放：用过的时间窗（和比它早的）不能再用；更晚的还能用", () => {
  const now = 1_700_000_015_000;
  const step = totpStep(now);
  const at = (s: number): string => totpCode(hmac, RFC_KEY, s);
  assert.deepEqual(checkTotp(hmac, RFC_KEY, at(step), now, step), { ok: false, reason: "REUSED" });
  assert.deepEqual(checkTotp(hmac, RFC_KEY, at(step - 1), now, step), { ok: false, reason: "REUSED" }, "用了较晚的之后较早的也不行");
  assert.deepEqual(checkTotp(hmac, RFC_KEY, at(step + 1), now, step), { ok: true, step: step + 1 });
  assert.deepEqual(checkTotp(hmac, RFC_KEY, at(step + 1), now, step + 1), { ok: false, reason: "REUSED" });
});

test("动态码的输入：去掉空格、连字符；不是 6 位数字一律不收（不去算 HMAC）", () => {
  assert.equal(normalizeTotpInput(" 123 456 "), "123456");
  assert.equal(normalizeTotpInput("123-456"), "123456");
  for (const bad of ["", "12345", "1234567", "12345a", "１２３４５６", "123456\n7"]) assert.equal(normalizeTotpInput(bad), null, bad);
  const now = 1_700_000_015_000;
  assert.deepEqual(checkTotp(hmac, RFC_KEY, "abcdef", now, null), { ok: false, reason: "INVALID" });
  let called = 0;
  checkTotp(() => ((called += 1), new Uint8Array(20)), RFC_KEY, "12345", now, null);
  assert.equal(called, 0);
});

test("Base32：与 RFC 4648 的测试向量一致，往返不变，不认识的字符返回 null", () => {
  const vectors: [string, string][] = [
    ["", ""],
    ["f", "MY"],
    ["fo", "MZXQ"],
    ["foo", "MZXW6"],
    ["foob", "MZXW6YQ"],
    ["fooba", "MZXW6YTB"],
    ["foobar", "MZXW6YTBOI"],
  ];
  for (const [plain, encoded] of vectors) {
    assert.equal(base32Encode(new TextEncoder().encode(plain)), encoded);
    assert.equal(new TextDecoder().decode(base32Decode(encoded) ?? new Uint8Array()), plain);
  }
  assert.equal(base32Encode(RFC_KEY), "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.deepEqual(base32Decode("gezd gnbv gy3t qojq gezd gnbv gy3t qojq"), Uint8Array.from(RFC_KEY));
  assert.deepEqual(base32Decode("MZXW6YQ="), new TextEncoder().encode("foob"));
  assert.equal(base32Decode("MZXW1"), null);
  const random = Uint8Array.from({ length: 20 }, (_, i) => (i * 37 + 11) & 255);
  assert.deepEqual(base32Decode(base32Encode(random)), random);
});

test("otpauth 链接：标签和发行方转义，带上算法、位数、时间窗", () => {
  const uri = otpauthUri({ issuer: "NOZOMI 运营后台", account: "a+b@example.com", secretBase32: "GEZDGNBVGY3TQOJQ" });
  assert.ok(uri.startsWith("otpauth://totp/NOZOMI%20%E8%BF%90%E8%90%A5%E5%90%8E%E5%8F%B0:a%2Bb%40example.com?"));
  const params = new URL(uri.replace("otpauth://", "https://")).searchParams;
  assert.equal(params.get("secret"), "GEZDGNBVGY3TQOJQ");
  assert.equal(params.get("issuer"), "NOZOMI 运营后台");
  assert.equal(params.get("algorithm"), "SHA1");
  assert.equal(params.get("digits"), "6");
  assert.equal(params.get("period"), "30");
});

test("恢复码：10 个、互不相同、16 个字符分 4 组、不含易混字符；输入时忽略大小写和连字符", () => {
  let seed = 7;
  const randomInt = (max: number): number => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed % max;
  };
  const codes = newRecoveryCodes(randomInt);
  assert.equal(codes.length, RECOVERY_CODE_COUNT);
  assert.equal(new Set(codes).size, codes.length);
  for (const code of codes) {
    assert.match(code, /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    assert.ok(![..."0o1li"].some((c) => code.includes(c)), code);
    assert.equal(normalizeRecoveryCode(code.toUpperCase().replace(/-/g, " ")), code.replace(/-/g, ""));
  }
  assert.equal(RECOVERY_CODE_ALPHABET.length, 31);
  assert.equal(new Set(RECOVERY_CODE_ALPHABET).size, 31);
  for (const bad of ["", "abcd-efgh-jkmn", "abcd-efgh-jkmn-pqrs-t", "abcd-efgh-jkmn-pqr0", "abcd-efgh-jkmn-pqrl"]) assert.equal(normalizeRecoveryCode(bad), null, bad);
});

test("恢复码：坏随机源报错，不会死循环、不会给出范围外的字符", () => {
  assert.throws(() => newRecoveryCodes(() => 0), RangeError);
  assert.throws(() => newRecoveryCode(() => RECOVERY_CODE_ALPHABET.length), RangeError);
  assert.throws(() => newRecoveryCode(() => -1), RangeError);
  assert.throws(() => newRecoveryCode(() => 0.5), RangeError);
});
