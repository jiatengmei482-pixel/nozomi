/**
 * 平台员工的 IP 白名单（M4-05，ADR 0030）：地址段（CIDR）的解析、规范写法和匹配。IPv4、IPv6 都支持。
 *
 * - IPv4 映射的 IPv6 地址（`::ffff:203.0.113.5`，双栈的服务端常把 IPv4 来源写成这样）一律当作对应的 IPv4 地址：
 *   名单里写 `203.0.113.0/24`，来源是 `::ffff:203.0.113.5` 也算在内；反过来名单里写成映射形式的地址段也会换成 IPv4 存。
 * - 地址段的主机位必须是 0（`10.0.0.1/8` 不收，提示写成 `10.0.0.0/8`）：写错的多半是把单个地址和地址段弄混了。
 * - 只写地址不写前缀长度 = 只放行这一个地址（/32 或 /128）。
 * - 空名单 = 不限制（默认）。
 */

export type IpVersion = 4 | 6;

export interface IpAddress {
  version: IpVersion;
  value: bigint;
}

export interface Cidr {
  version: IpVersion;
  network: bigint;
  prefix: number;
}

/** 一份名单最多几条（一个公司的办公室、VPN 出口用不了这么多；防止误粘贴一大段） */
export const IP_ALLOWLIST_MAX_ENTRIES = 50;

const BITS: Readonly<Record<IpVersion, number>> = { 4: 32, 6: 128 };

function parseIpv4(text: string): bigint | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  let value = 0n;
  for (const part of parts) {
    // 不收前导 0（「010」在有的实现里是八进制）和空段
    if (!/^(0|[1-9][0-9]{0,2})$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = (value << 8n) | BigInt(n);
  }
  return value;
}

function parseIpv6(text: string): bigint | null {
  if (text.length === 0 || text.length > 45) return null;
  let head = text;
  let ipv4Tail: bigint | null = null;
  const lastColon = head.lastIndexOf(":");
  if (head.includes(".")) {
    ipv4Tail = parseIpv4(head.slice(lastColon + 1));
    if (ipv4Tail === null) return null;
    head = `${head.slice(0, lastColon + 1)}0:0`;
  }
  const doubleColon = head.indexOf("::");
  if (doubleColon !== head.lastIndexOf("::")) return null;
  const split = (part: string): string[] => (part === "" ? [] : part.split(":"));
  let groups: string[];
  if (doubleColon >= 0) {
    const left = split(head.slice(0, doubleColon));
    const right = split(head.slice(doubleColon + 2));
    const missing = 8 - left.length - right.length;
    if (missing < 1) return null;
    groups = [...left, ...Array<string>(missing).fill("0"), ...right];
  } else {
    groups = split(head);
  }
  if (groups.length !== 8) return null;
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    value = (value << 16n) | BigInt(parseInt(group, 16));
  }
  if (ipv4Tail !== null) value = (value & ~0xffffffffn) | ipv4Tail;
  return value;
}

/** IPv4 映射的 IPv6 地址换成 IPv4。 */
function unmap(address: IpAddress): IpAddress {
  if (address.version === 6 && address.value >> 32n === 0xffffn) return { version: 4, value: address.value & 0xffffffffn };
  return address;
}

/** 解析一个地址（来源地址或名单里的单个地址）。IPv6 的区域标识（`%eth0`）不收。 */
export function parseIpAddress(text: string): IpAddress | null {
  const trimmed = text.trim();
  if (trimmed.includes(":")) {
    const value = parseIpv6(trimmed);
    return value === null ? null : unmap({ version: 6, value });
  }
  const value = parseIpv4(trimmed);
  return value === null ? null : { version: 4, value };
}

export type CidrIssue = "INVALID" | "HOST_BITS_SET";

/** 解析一个地址段。返回规范后的地址段，或者问题。 */
export function parseCidr(text: string): { ok: true; cidr: Cidr } | { ok: false; reason: CidrIssue; suggestion?: string } {
  const trimmed = text.trim();
  const slash = trimmed.indexOf("/");
  const addressText = slash < 0 ? trimmed : trimmed.slice(0, slash);
  const prefixText = slash < 0 ? null : trimmed.slice(slash + 1);
  const raw = addressText.includes(":") ? parseIpv6(addressText) : parseIpv4(addressText);
  if (raw === null) return { ok: false, reason: "INVALID" };
  const rawVersion: IpVersion = addressText.includes(":") ? 6 : 4;
  let prefix = BITS[rawVersion];
  if (prefixText !== null) {
    if (!/^(0|[1-9][0-9]{0,2})$/.test(prefixText)) return { ok: false, reason: "INVALID" };
    prefix = Number(prefixText);
    if (prefix > BITS[rawVersion]) return { ok: false, reason: "INVALID" };
  }
  let version = rawVersion;
  let value = raw;
  // 映射形式的地址段（::ffff:0:0/96 之内）换成 IPv4 的写法
  if (rawVersion === 6 && raw >> 32n === 0xffffn && prefix >= 96) {
    version = 4;
    value = raw & 0xffffffffn;
    prefix -= 96;
  }
  const hostBits = BigInt(BITS[version] - prefix);
  const network = (value >> hostBits) << hostBits;
  if (network !== value) {
    return { ok: false, reason: "HOST_BITS_SET", suggestion: formatCidr({ version, network, prefix }) };
  }
  return { ok: true, cidr: { version, network, prefix } };
}

function formatIpv4(value: bigint): string {
  return [24n, 16n, 8n, 0n].map((shift) => String((value >> shift) & 255n)).join(".");
}

/** IPv6 的规范写法（RFC 5952）：小写、去掉前导 0、最长的一段连续 0（至少两组）压成 `::`。 */
function formatIpv6(value: bigint): string {
  const groups = Array.from({ length: 8 }, (_, i) => Number((value >> BigInt((7 - i) * 16)) & 0xffffn));
  let bestStart = -1;
  let bestLength = 0;
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j += 1;
    if (j - i > bestLength) {
      bestStart = i;
      bestLength = j - i;
    }
    i = j;
  }
  const hex = groups.map((group) => group.toString(16));
  if (bestLength < 2) return hex.join(":");
  return `${hex.slice(0, bestStart).join(":")}::${hex.slice(bestStart + bestLength).join(":")}`;
}

export function formatIpAddress(address: IpAddress): string {
  return address.version === 4 ? formatIpv4(address.value) : formatIpv6(address.value);
}

export function formatCidr(cidr: Cidr): string {
  return `${cidr.version === 4 ? formatIpv4(cidr.network) : formatIpv6(cidr.network)}/${cidr.prefix}`;
}

export function cidrContains(cidr: Cidr, address: IpAddress): boolean {
  if (cidr.version !== address.version) return false;
  const hostBits = BigInt(BITS[cidr.version] - cidr.prefix);
  return address.value >> hostBits === cidr.network >> hostBits;
}

export interface AllowlistEntryIssue {
  index: number;
  value: string;
  reason: CidrIssue | "DUPLICATE";
  suggestion?: string;
}

/**
 * 校验并规范一份名单（保存前用）。返回规范写法（去重前的顺序）和问题清单；有问题就不保存。
 * 规范写法相同的两条算重复（`10.0.0.0/8` 和 `::ffff:10.0.0.0/104`）。
 */
export function normalizeAllowlist(entries: readonly string[]): { cidrs: string[]; issues: AllowlistEntryIssue[] } {
  const cidrs: string[] = [];
  const issues: AllowlistEntryIssue[] = [];
  entries.forEach((value, index) => {
    const parsed = parseCidr(value);
    if (!parsed.ok) {
      issues.push({ index, value, reason: parsed.reason, ...(parsed.suggestion === undefined ? {} : { suggestion: parsed.suggestion }) });
      return;
    }
    const text = formatCidr(parsed.cidr);
    if (cidrs.includes(text)) issues.push({ index, value, reason: "DUPLICATE" });
    else cidrs.push(text);
  });
  return { cidrs, issues };
}

/**
 * 来源地址在不在名单里。空名单 = 不限制（总是 true）。
 * 来源地址解析不了时（理论上不会：它来自连接本身）按不在名单里处理——名单不空时宁可拒绝。
 */
export function ipAllowed(ip: string, allowlist: readonly string[]): boolean {
  if (allowlist.length === 0) return true;
  const address = parseIpAddress(ip);
  if (address === null) return false;
  return allowlist.some((entry) => {
    const parsed = parseCidr(entry);
    return parsed.ok && cidrContains(parsed.cidr, address);
  });
}

/**
 * 一个员工实际生效的名单：**员工自己的名单不空就用员工的，否则用角色的**（更具体的设置优先）。
 * 两个都空 = 不限制。所以可以给角色设办公室的地址段，再给个别人单独放开（或收得更紧）。
 */
export function effectiveAllowlist(userList: readonly string[], roleList: readonly string[]): readonly string[] {
  return userList.length > 0 ? userList : roleList;
}
