/**
 * 按来源地址限流时，「来源地址 → 限流键」的唯一入口（M4-11，ADR 0045）。所有按来源地址计数的地方都先过这里，再拿结果去算哈希、计数。
 *
 * - IPv4：原样（规范写法，如 `203.0.113.5`）。
 * - IPv4 映射的 IPv6（`::ffff:203.0.113.5`、`::ffff:cb00:7105`）：当作对应的 IPv4。
 * - IPv6：只取前 64 位，写成规范的压缩写法加 `/64`（如 `2001:db8:1:2::/64`）。运营商一般给每个用户一个 /64 或更大的网段，
 *   同一个人在自己的 /64 里随便换地址，限流键都一样。大小写、零压缩、前导 0 的写法不同不影响结果。
 * - 来源地址可能带的外壳先去掉：首尾空白、方括号（`[2001:db8::1]`）、端口（`[2001:db8::1]:443`、`203.0.113.5:8080`）、
 *   区域标识（`fe80::1%eth0`、`fe80::1%25eth0`）。
 * - 解析不了的：`raw:` 加原文。不同的原文是不同的键（不会让所有解析不了的来源共用一个桶、一个人刷满挡住所有人），
 *   前缀保证它和任何合法地址的键都不相同。
 */
import { formatIpAddress, parseIpAddress } from "./ip-allowlist.ts";

/** IPv6 按多长的前缀计数 */
export const IPV6_RATE_LIMIT_PREFIX = 64;

const HOST_BITS = BigInt(128 - IPV6_RATE_LIMIT_PREFIX);

/** 去掉方括号、端口、区域标识；不是这些写法的原样返回（交给解析判断）。 */
function stripWrapping(text: string): string {
  let address = text.trim();
  const bracketed = /^\[([^\]]*)\](?::[0-9]{1,5})?$/.exec(address);
  if (bracketed !== null) address = bracketed[1] ?? "";
  else if (/^[0-9.]+:[0-9]{1,5}$/.test(address)) address = address.slice(0, address.indexOf(":"));
  const zone = address.indexOf("%");
  if (zone >= 0 && address.includes(":")) address = address.slice(0, zone);
  return address;
}

/** 来源地址对应的限流键。 */
export function rateLimitKeyOf(sourceAddress: string): string {
  const address = parseIpAddress(stripWrapping(sourceAddress));
  if (address === null) return `raw:${sourceAddress}`;
  if (address.version === 4) return formatIpAddress(address);
  const network = (address.value >> HOST_BITS) << HOST_BITS;
  return `${formatIpAddress({ version: 6, value: network })}/${IPV6_RATE_LIMIT_PREFIX}`;
}
