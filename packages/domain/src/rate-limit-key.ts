/**
 * 按来源地址限流时，「来源地址 → 限流键」的唯一入口（M4-11，ADR 0045）。所有按来源地址计数的地方都先过这里，再拿结果去算哈希、计数。
 *
 * - IPv4：原样（规范写法，如 `203.0.113.5`）。
 * - IPv4 映射的 IPv6（`::ffff:203.0.113.5`、`::ffff:cb00:7105`）：当作对应的 IPv4。
 * - IPv6：只取前 64 位，写成规范的压缩写法加 `/64`（如 `2001:db8:1:2::/64`）。运营商一般给每个用户一个 /64 或更大的网段，
 *   同一个人在自己的 /64 里随便换地址，限流键都一样。大小写、零压缩、前导 0 的写法不同不影响结果。
 * - 来源地址可能带的外壳先去掉：首尾空白、方括号（`[2001:db8::1]`）、端口（`[2001:db8::1]:443`、`203.0.113.5:8080`）、
 *   区域标识（`fe80::1%eth0`、`fe80::1%25eth0`）。
 * - 末 32 位内嵌 IPv4 的 IPv6（IPv4 兼容 `::a.b.c.d`、NAT64 知名前缀 `64:ff9b::/96`、SIIT `::ffff:0:0:0/96`）：当作末尾那个 IPv4
 *   （服务端在 4→6 转换后面时，所有 IPv4 客人都长这样，按 /64 截断会让他们共用一个桶）。`::` 和 `::1` 不算（RFC 4291），照常按 /64。
 * - Teredo（`2001::/32`）：前 64 位是 Teredo 服务器，客户端在后 64 位，所以按完整地址（`/128`）计。
 * - 解析不了的：`raw:` 加原文。不同的原文是不同的键（不会让所有解析不了的来源共用一个桶、一个人刷满挡住所有人），
 *   前缀保证它和任何合法地址的键都不相同。
 * - 运行时拿到的不是字符串（客户端在处理前断开时 `request.ip` 是 undefined）：固定的 `raw:(none)`，不抛异常——连接已经断了，共用一个桶可以接受。
 */
import { formatIpAddress, parseIpAddress } from "./ip-allowlist.ts";

/** IPv6 按多长的前缀计数 */
export const IPV6_RATE_LIMIT_PREFIX = 64;

const HOST_BITS = BigInt(128 - IPV6_RATE_LIMIT_PREFIX);

/** 来源地址不是字符串时的键 */
export const RATE_LIMIT_KEY_NO_ADDRESS = "raw:(none)";

/** 末 32 位内嵌 IPv4 的 /96 前缀（高 96 位）：IPv4 兼容、NAT64 知名前缀、SIIT */
const EMBEDDED_IPV4_PREFIXES: readonly bigint[] = [0n, 0x0064ff9b_00000000_00000000n, 0x00000000_00000000_ffff0000n];
const LOW_32 = 0xffffffffn;
/** Teredo 2001::/32 的高 32 位 */
const TEREDO_PREFIX = 0x20010000n;

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
export function rateLimitKeyOf(sourceAddress: string | undefined | null): string {
  if (typeof sourceAddress !== "string") return RATE_LIMIT_KEY_NO_ADDRESS;
  const address = parseIpAddress(stripWrapping(sourceAddress));
  if (address === null) return `raw:${sourceAddress}`;
  if (address.version === 4) return formatIpAddress(address);
  const high96 = address.value >> 32n;
  if (EMBEDDED_IPV4_PREFIXES.includes(high96) && !(high96 === 0n && address.value <= 1n)) {
    return formatIpAddress({ version: 4, value: address.value & LOW_32 });
  }
  if (address.value >> 96n === TEREDO_PREFIX) return `${formatIpAddress(address)}/128`;
  const network = (address.value >> HOST_BITS) << HOST_BITS;
  return `${formatIpAddress({ version: 6, value: network })}/${IPV6_RATE_LIMIT_PREFIX}`;
}
