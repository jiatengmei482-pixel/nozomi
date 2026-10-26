/**
 * 测试里算两步验证的动态码（ADR 0030）。只在测试代码里用：生产代码里没有任何「跳过两步验证」的开关。
 */
import { createHmac } from "node:crypto";
import { base32Decode, totpCode, totpStep } from "@nozomi/domain";

const hmac = (key: Uint8Array, message: Uint8Array): Uint8Array => createHmac("sha1", key).update(message).digest();

/** 某个时刻（默认当前时间窗，`offsetSteps` 前后挪几个窗）的 6 位动态码。 */
export function totpAt(secretBase32: string, now: Date, offsetSteps = 0): string {
  const key = base32Decode(secretBase32);
  if (key === null) throw new Error("不是 Base32 的密钥");
  return totpCode(hmac, key, totpStep(now.getTime()) + offsetSteps);
}
