/**
 * 密码哈希（ADR 0008）：Node 内置的 scrypt，不引入原生依赖。
 *
 * 存储格式：`scrypt$<参数版本>$<盐>$<哈希>`，盐和哈希用 base64url。
 * 参数版本写在哈希里，以后调高强度时新增一个版本即可，旧哈希仍按自己的版本验证。
 * 密码先做 Unicode NFKC 归一化，避免同一个字符的不同编码方式导致登录不上。
 */
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

interface ScryptParams {
  N: number;
  r: number;
  p: number;
  keyLength: number;
}

/** 版本 1：N=2^15、r=8、p=3（OWASP 推荐的等强度组合之一，单次约占 32MB 内存）。 */
const PARAMS_BY_VERSION: Readonly<Record<string, ScryptParams>> = {
  "1": { N: 32_768, r: 8, p: 3, keyLength: 32 },
};
const CURRENT_VERSION = "1";
const SALT_LENGTH = 16;
const MAX_MEMORY_BYTES = 64 * 1024 * 1024;

function derive(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      params.keyLength,
      { N: params.N, r: params.r, p: params.p, maxmem: MAX_MEMORY_BYTES },
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await derive(password, salt, PARAMS_BY_VERSION[CURRENT_VERSION] as ScryptParams);
  return `scrypt$${CURRENT_VERSION}$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

/** 验证密码。存储值格式不对或版本未知时一律返回 false，不抛错。 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, version, saltText, keyText, ...extra] = stored.split("$");
  const params = version === undefined ? undefined : PARAMS_BY_VERSION[version];
  if (scheme !== "scrypt" || !params || !saltText || !keyText || extra.length > 0) return false;
  const expected = Buffer.from(keyText, "base64url");
  if (expected.length !== params.keyLength) return false;
  const actual = await derive(password, Buffer.from(saltText, "base64url"), params);
  return timingSafeEqual(actual, expected);
}

const DUMMY_SALT = Buffer.alloc(SALT_LENGTH);

/**
 * 邮箱不存在或账号还没有密码时也做一次同样耗时的计算，
 * 这样从响应时间上分辨不出「邮箱不存在」和「密码错误」。永远返回 false。
 */
export async function verifyPasswordAgainstNothing(password: string): Promise<false> {
  await derive(password, DUMMY_SALT, PARAMS_BY_VERSION[CURRENT_VERSION] as ScryptParams);
  return false;
}
