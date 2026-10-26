/**
 * 平台员工的两步验证（M4-05，ADR 0030）：基于时间的一次性密码 TOTP（RFC 6238，建立在 RFC 4226 的 HOTP 之上），
 * 以及一次性恢复码。纯函数：HMAC 和随机数由调用方传入（domain 不依赖 node:crypto，前端也能引用这个包）。
 *
 * 参数取各家验证器 App（Google Authenticator、Microsoft Authenticator、1Password 等）都支持的默认值：
 * HMAC-SHA1、30 秒一个时间窗、6 位数字、T0 = 0。
 */
import type { RandomInt } from "./temporary-password.ts";

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** 前后各容忍一个时间窗（手机时钟偏差、输入耗时）：一个码最多在 90 秒里有效 */
export const TOTP_DRIFT_STEPS = 1;
/** 密钥长度：20 字节（160 位），RFC 4226 推荐的 HMAC-SHA1 密钥长度 */
export const TOTP_SECRET_BYTES = 20;

/** HMAC-SHA1。调用方用 node:crypto 实现；单元测试里也是。 */
export type HmacSha1 = (key: Uint8Array, message: Uint8Array) => Uint8Array;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** RFC 4648 的 Base32，不加补位（验证器 App 的 otpauth 链接里就是这种写法）。 */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
    value &= (1 << bits) - 1;
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Base32 解码：忽略大小写、空格和补位的 `=`；有别的字符时返回 null。 */
export function base32Decode(text: string): Uint8Array | null {
  const clean = text.replace(/[\s=]/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) return null;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
    value &= (1 << bits) - 1;
  }
  return Uint8Array.from(out);
}

/** 时间窗编号：从 1970-01-01T00:00:00Z 起第几个 30 秒。 */
export function totpStep(nowMs: number, periodSeconds: number = TOTP_PERIOD_SECONDS): number {
  return Math.floor(nowMs / 1000 / periodSeconds);
}

/** 这个时间窗什么时候结束（毫秒）。 */
export function totpStepEndsAt(step: number, periodSeconds: number = TOTP_PERIOD_SECONDS): number {
  return (step + 1) * periodSeconds * 1000;
}

function counterBytes(counter: number): Uint8Array {
  const bytes = new Uint8Array(8);
  let rest = BigInt(counter);
  for (let i = 7; i >= 0; i -= 1) {
    bytes[i] = Number(rest & 255n);
    rest >>= 8n;
  }
  return bytes;
}

/** RFC 4226 的 HOTP：HMAC 之后「动态截取」31 位，取后 `digits` 位十进制，不足前面补 0。 */
export function hotp(hmac: HmacSha1, key: Uint8Array, counter: number, digits: number = TOTP_DIGITS): string {
  if (!Number.isSafeInteger(counter) || counter < 0) throw new RangeError("计数必须是非负整数");
  const mac = hmac(key, counterBytes(counter));
  const offset = (mac[mac.length - 1] as number) & 0x0f;
  const binary =
    (((mac[offset] as number) & 0x7f) << 24) |
    ((mac[offset + 1] as number) << 16) |
    ((mac[offset + 2] as number) << 8) |
    (mac[offset + 3] as number);
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/** 某个时间窗的动态码。 */
export function totpCode(hmac: HmacSha1, key: Uint8Array, step: number, digits: number = TOTP_DIGITS): string {
  return hotp(hmac, key, step, digits);
}

/** 两个等长字符串的比较，耗时与内容无关。 */
function sameText(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** 输入的动态码：去掉空格和连字符后必须正好是 6 位数字。 */
export function normalizeTotpInput(input: string): string | null {
  const clean = input.replace(/[\s-]/g, "");
  return /^[0-9]{6}$/.test(clean) ? clean : null;
}

export type TotpCheck =
  | { ok: true; step: number }
  /** INVALID：不对（或格式不对）；REUSED：这个码对，但它所在的时间窗已经用过（防重放） */
  | { ok: false; reason: "INVALID" | "REUSED" };

/**
 * 核对动态码。当前时间窗前后各容忍一个；**同一个账号用过的时间窗不能再用**：
 * 接受的时间窗必须比上次用过的（`lastUsedStep`）晚。所以同一个码只能用一次，而且用了较晚的码之后，
 * 较早时间窗的码也不能再用（不会出现「先用 t+1、再用 t」）。
 * 通过时返回接受的时间窗编号，调用方原子地写回「上次用过的」（写的条件是新值更大，并发的两个请求只有一个成功）。
 */
export function checkTotp(hmac: HmacSha1, key: Uint8Array, input: string, nowMs: number, lastUsedStep: number | null): TotpCheck {
  const code = normalizeTotpInput(input);
  if (code === null) return { ok: false, reason: "INVALID" };
  const current = totpStep(nowMs);
  let reused = false;
  for (let step = current - TOTP_DRIFT_STEPS; step <= current + TOTP_DRIFT_STEPS; step += 1) {
    if (step < 0) continue;
    if (!sameText(totpCode(hmac, key, step), code)) continue;
    if (lastUsedStep !== null && step <= lastUsedStep) {
      reused = true;
      continue;
    }
    return { ok: true, step };
  }
  return { ok: false, reason: reused ? "REUSED" : "INVALID" };
}

/**
 * 验证器 App 扫的 otpauth 链接（Google Authenticator 的 Key Uri Format）。
 * 标签是「发行方:账号」，发行方另在参数里写一遍（老版本的 App 只认参数）。
 */
export function otpauthUri(input: { issuer: string; account: string; secretBase32: string }): string {
  const label = `${encodeURIComponent(input.issuer)}:${encodeURIComponent(input.account)}`;
  const params = new URLSearchParams({
    secret: input.secretBase32,
    issuer: input.issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ---- 恢复码 ----

/** 一次生成几个恢复码 */
export const RECOVERY_CODE_COUNT = 10;
/** 每个恢复码 16 个字符（4 组，每组 4 个），字母表 31 个字符：约 79 位随机，库里只存 SHA-256 也无法穷举 */
export const RECOVERY_CODE_LENGTH = 16;
/** 去掉了易混的 0 o 1 l i 之后的 31 个字符（小写字母 + 数字） */
export const RECOVERY_CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";


function groupRecoveryCode(raw: string): string {
  return raw.match(/.{1,4}/g)?.join("-") ?? raw;
}

/** 生成一个恢复码，显示格式 `abcd-efgh-jkmn-pqrs`。 */
export function newRecoveryCode(randomInt: RandomInt): string {
  let raw = "";
  for (let i = 0; i < RECOVERY_CODE_LENGTH; i += 1) {
    const index = randomInt(RECOVERY_CODE_ALPHABET.length);
    if (!Number.isInteger(index) || index < 0 || index >= RECOVERY_CODE_ALPHABET.length) throw new RangeError("随机源给出了范围外的数");
    raw += RECOVERY_CODE_ALPHABET[index];
  }
  return groupRecoveryCode(raw);
}

/** 生成一组恢复码，组内不重复。 */
export function newRecoveryCodes(randomInt: RandomInt, count: number = RECOVERY_CODE_COUNT): string[] {
  const codes = new Set<string>();
  // 79 位随机数重复的概率可以忽略；坏随机源（总给同一个数）最多试这么多次就报错，不会死循环
  for (let attempt = 0; codes.size < count; attempt += 1) {
    if (attempt >= count * 10) throw new RangeError("随机源总是给出重复的恢复码");
    codes.add(newRecoveryCode(randomInt));
  }
  return [...codes];
}

/**
 * 输入的恢复码归一化：忽略大小写、空格和连字符。长度或字符不对返回 null（不去查库）。
 * 库里存的是归一化之后的 SHA-256。
 */
export function normalizeRecoveryCode(input: string): string | null {
  const clean = input.replace(/[\s-]/g, "").toLowerCase();
  if (clean.length !== RECOVERY_CODE_LENGTH) return null;
  for (const char of clean) if (!RECOVERY_CODE_ALPHABET.includes(char)) return null;
  return clean;
}
