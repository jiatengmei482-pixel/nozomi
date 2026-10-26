/**
 * M4-11 测试角色补的边界（ADR 0045）：rateLimitKeyOf 的各种输入写法。
 * 三条底线：不抛异常；不同的人不并到同一个桶（尤其解析不了的不共用一个键）；同一个 /64 不分到不同的桶。
 * 随机部分用固定种子，失败时可以原样复现。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { rateLimitKeyOf } from "./rate-limit-key.ts";

/** 固定种子的伪随机数（mulberry32），每次运行生成同一批地址。 */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(random: () => number, items: readonly T[]): T => items[Math.floor(random() * items.length)] as T;
const group16 = (random: () => number): number => (random() < 0.3 ? 0 : Math.floor(random() * 0x10000));

/** 128 位里的第 i 组（0..7）。 */
const groupsOf = (value: bigint): number[] => Array.from({ length: 8 }, (_, i) => Number((value >> BigInt((7 - i) * 16)) & 0xffffn));

/**
 * 同一个地址的一种合法写法（随机选）：全写 / 去前导 0 / 补前导 0 到 4 位、大小写随机、
 * 任意一段连续的 0 组压成 `::`（不一定是最长的那段，RFC 4291 都算合法）、末尾 32 位写成点分、外面套方括号加端口、加区域标识。
 */
function randomSpelling(random: () => number, value: bigint): string {
  const groups = groupsOf(value);
  const dottedTail = random() < 0.2;
  const hexCount = dottedTail ? 6 : 8;
  let parts = groups.slice(0, hexCount).map((group) => {
    const hex = group.toString(16);
    const padded = random() < 0.4 ? hex.padStart(4, "0") : hex;
    return Array.from(padded, (ch) => (random() < 0.5 ? ch.toUpperCase() : ch)).join("");
  });
  // 找出所有连续 0 组的区间，随机选一段压成 ::
  const runs: Array<[number, number]> = [];
  for (let i = 0; i < hexCount; ) {
    if (groups[i] !== 0) {
      i += 1;
      continue;
    }
    let j = i;
    while (j < hexCount && groups[j] === 0) j += 1;
    runs.push([i, j]);
    i = j;
  }
  let text: string;
  const tail = dottedTail ? [24n, 16n, 8n, 0n].map((shift) => String((value >> shift) & 255n)).join(".") : null;
  if (runs.length > 0 && random() < 0.7) {
    const [start, end] = pick(random, runs);
    const left = parts.slice(0, start).join(":");
    const rightParts = parts.slice(end);
    if (tail !== null) rightParts.push(tail);
    text = `${left}::${rightParts.join(":")}`;
  } else {
    if (tail !== null) parts = [...parts, tail];
    text = parts.join(":");
  }
  const shell = random();
  if (shell < 0.15) return `[${text}]:${1 + Math.floor(random() * 65535)}`;
  if (shell < 0.25) return `[${text}]`;
  if (shell < 0.35) return `${text}%${pick(random, ["eth0", "25eth0", "en0", "wlan1"])}`;
  if (shell < 0.45) return `  ${text}\t`;
  return text;
}

/** 随机的 /64 网段（避开 ::ffff:0:0/96 映射段所在的 ::/64，那一段按 IPv4 算，另有测试）。 */
function randomPrefix(random: () => number): bigint {
  let prefix = 0n;
  for (let i = 0; i < 4; i += 1) prefix = (prefix << 16n) | BigInt(group16(random));
  if (prefix === 0n) prefix = 0x20010db8n << 32n;
  return prefix << 64n;
}

function randomHost(random: () => number): bigint {
  let host = 0n;
  for (let i = 0; i < 4; i += 1) host = (host << 16n) | BigInt(group16(random));
  return host;
}

test("随机（固定种子）：同一个 /64 里随机换后 64 位、随机换写法，限流键都一样；200 个不同的 /64 两两不同", () => {
  const random = seeded(0x4d0411);
  const keyByPrefix = new Map<bigint, string>();
  for (let n = 0; n < 200; n += 1) {
    const prefix = randomPrefix(random);
    if (keyByPrefix.has(prefix)) continue;
    const spellings = Array.from({ length: 25 }, () => randomSpelling(random, prefix | randomHost(random)));
    const keys = new Set(spellings.map(rateLimitKeyOf));
    assert.equal(keys.size, 1, `同一个 /64 分到了不同的桶：${spellings.map((s, i) => `${JSON.stringify(s)} → ${rateLimitKeyOf(s)}`).filter((_, i) => i < 25).join("\n")}`);
    const key = [...keys][0] as string;
    assert.ok(!key.startsWith("raw:"), `合法写法没解析出来：${spellings.find((s) => rateLimitKeyOf(s).startsWith("raw:"))}`);
    keyByPrefix.set(prefix, key);
  }
  const all = [...keyByPrefix.values()];
  assert.equal(new Set(all).size, all.length, "不同的 /64 不能共用一个键");
});

test("随机（固定种子）：只差第 64 位 / 第 1 位的两个网段键不同；只差第 65 位或最后一位的地址键相同", () => {
  const random = seeded(0x64);
  for (let n = 0; n < 200; n += 1) {
    const address = randomPrefix(random) | randomHost(random);
    const flip = (bit: number) => address ^ (1n << BigInt(127 - bit));
    const spell = (value: bigint) => randomSpelling(random, value);
    assert.notEqual(rateLimitKeyOf(spell(address)), rateLimitKeyOf(spell(flip(63))), "第 64 位不同的是两个网段");
    assert.notEqual(rateLimitKeyOf(spell(address)), rateLimitKeyOf(spell(flip(0))), "第 1 位不同的是两个网段");
    assert.equal(rateLimitKeyOf(spell(address)), rateLimitKeyOf(spell(flip(64))), "第 65 位属于主机部分");
    assert.equal(rateLimitKeyOf(spell(address)), rateLimitKeyOf(spell(flip(127))), "最后一位属于主机部分");
  }
});

test("随机（固定种子）：规范写法的 IPv4 限流键就是它本身（上线后 IPv4 的计数沿用原来的桶，不从零开始），且两两不同", () => {
  const random = seeded(4);
  const seen = new Map<string, string>();
  for (let n = 0; n < 500; n += 1) {
    const text = Array.from({ length: 4 }, () => String(Math.floor(random() * 256))).join(".");
    const key = rateLimitKeyOf(text);
    assert.equal(key, text);
    seen.set(text, key);
  }
  assert.equal(new Set(seen.values()).size, seen.size);
});

test("随机（固定种子）：IPv4 映射写法（点分 / 十六进制 / 大小写 / 方括号加端口）和 IPv4 是同一个键", () => {
  const random = seeded(0xffff);
  for (let n = 0; n < 200; n += 1) {
    const octets = Array.from({ length: 4 }, () => Math.floor(random() * 256));
    const v4 = octets.join(".");
    const hi = ((octets[0] as number) * 256 + (octets[1] as number)).toString(16);
    const lo = ((octets[2] as number) * 256 + (octets[3] as number)).toString(16);
    for (const text of [`::ffff:${v4}`, `::FFFF:${v4}`, `::ffff:${hi}:${lo}`, `0:0:0:0:0:ffff:${hi.toUpperCase()}:${lo}`, `[::ffff:${v4}]:443`, `0000:0000:0000:0000:0000:ffff:${v4}`]) {
      assert.equal(rateLimitKeyOf(text), v4, text);
    }
  }
});

test("各种特殊地址段都能算出键、不抛异常，并按 /64 归并：全零、::、::1、链路本地带区域、站点本地、多播、6to4", () => {
  const cases: Array<[string, string]> = [
    ["0:0:0:0:0:0:0:0", "::/64"],
    ["::", "::/64"],
    ["::1", "::/64"],
    ["[::1]:443", "::/64"],
    ["fe80::1%eth0", "fe80::/64"],
    ["FE80::ABCD%ETH0", "fe80::/64"],
    ["fe80::1%25en0", "fe80::/64"],
    ["fec0:0:0:1::1", "fec0:0:0:1::/64"],
    ["FEC0::1:0:0:1", "fec0::/64"],
    ["ff02::1", "ff02::/64"],
    ["ff05::1:3", "ff05::/64"],
    ["2002:cb00:7105::1", "2002:cb00:7105::/64"],
    ["2002:CB00:7105:0001::abcd", "2002:cb00:7105:1::/64"],
  ];
  for (const [text, key] of cases) assert.equal(rateLimitKeyOf(text), key, text);
  assert.notEqual(rateLimitKeyOf("2002:cb00:7105::1"), rateLimitKeyOf("2002:cb00:7106::1"), "6to4：前缀里嵌的 IPv4 不同，是不同的人");
  assert.notEqual(rateLimitKeyOf("fe80::1%eth0"), rateLimitKeyOf("fe81::1%eth0"), "fe80::/10 里不同的 /64 各算各的");
});

test("IPv4 映射（::ffff:a.b.c.d）按 IPv4；IPv4 兼容（::a.b.c.d）也取末 32 位按 IPv4（ADR 0045：内嵌 IPv4 的写法和映射同样处理）", () => {
  assert.equal(rateLimitKeyOf("::ffff:1.2.3.4"), "1.2.3.4");
  assert.equal(rateLimitKeyOf("::1.2.3.4"), "1.2.3.4");
  assert.ok(!rateLimitKeyOf("::1.2.3.4").startsWith("raw:"), "IPv4 兼容写法是合法的 IPv6");
});

test("缺陷：内嵌 IPv4 的 IPv6 写法（IPv4 兼容 ::a.b.c.d、NAT64 64:ff9b::/96、SIIT ::ffff:0:a.b.c.d）按 /64 截断后，所有 IPv4 客人并进同一个桶", () => {
  // 这些写法的「人」是末尾 32 位的那个 IPv4 地址，前 64 位全一样。服务端在 4→6 转换（NAT64 / SIIT-DC，RFC 6052 / 7755）后面时，
  // 所有 IPv4 客人的来源地址都长这样：按 /64 截断等于全体 IPv4 客人共用一份额度，一个人刷满挡住所有人。
  for (const [a, b] of [
    ["::1.2.3.4", "::5.6.7.8"],
    ["64:ff9b::1.2.3.4", "64:ff9b::5.6.7.8"],
    ["64:ff9b::102:304", "64:ff9b::506:708"],
    ["::ffff:0:1.2.3.4", "::ffff:0:5.6.7.8"],
  ] as const) {
    assert.notEqual(rateLimitKeyOf(a), rateLimitKeyOf(b), `${a} 和 ${b} 是两个不同的 IPv4 客人，却得到同一个键 ${rateLimitKeyOf(a)}`);
  }
});

test("缺陷：Teredo（2001::/32）的前 64 位是 Teredo 服务器地址，同一台服务器后面的所有客户端并进一个桶", () => {
  // 2001:0:4136:e378::/64 = Teredo 前缀 + 服务器 65.54.227.120；客户端各自的公网地址和端口（取反）在后 64 位。
  const a = "2001:0:4136:e378:8000:63bf:3fff:fdd2"; // 客户端 192.0.2.45:40000
  const b = "2001:0:4136:e378:8000:63bf:fbff:fffe"; // 客户端 4.0.0.1:40000
  assert.notEqual(rateLimitKeyOf(a), rateLimitKeyOf(b), `两个不同公网地址的 Teredo 客户端得到同一个键 ${rateLimitKeyOf(a)}`);
});

test("错误写法：不抛异常，各自一个 raw: 键，不会和任何合法地址撞上，也不会彼此共用一个桶", () => {
  const junk = [
    "1::2::3",
    ":::",
    "1:2:3:4:5:6:7:8:9",
    "1:2:3:4:5:6:7::8",
    "00001::1",
    `2001:db8::${"1".repeat(60)}`,
    "1".repeat(10_000),
    "",
    " ",
    "\t\n",
    "  　 ",
    "[::1]:",
    "[::1",
    "::1]",
    "[]",
    "[]:80",
    "1.2.3.4:",
    "01.02.03.04",
    "01.02.03.04:80",
    "1.2.3.04",
    "1.2.3.4.",
    "1.2.3",
    "0x1.2.3.4",
    "１.２.３.４",
    "1.2.3.4%eth0",
    "%eth0",
    "1.2.3.4, 5.6.7.8",
    "1.2.3.4\n5.6.7.8",
    "2001:db8::g",
    "2001:db8:: 1",
    "2001:db8::1/64",
    "::1.2.3",
    "::1.2.3.4.5",
    "::ffff:01.2.3.4",
    "1:2:3:4:5:6:7:1.2.3.4",
    "unknown",
    "raw:1.2.3.4",
    "raw:",
  ];
  const keys = junk.map((text) => {
    assert.doesNotThrow(() => rateLimitKeyOf(text), JSON.stringify(text));
    return rateLimitKeyOf(text);
  });
  junk.forEach((text, i) => assert.ok(keys[i]?.startsWith("raw:"), `${JSON.stringify(text)} → ${keys[i]}`));
  assert.equal(new Set(keys).size, junk.length, "解析不了的不能落到同一个键");
  const legal = ["1.2.3.4", "::/64", "2001:db8::/64", "5.6.7.8"].map(rateLimitKeyOf);
  for (const key of keys) assert.ok(!legal.includes(key), key);
});

test("只有空白、空串彼此不同，但都不和合法地址共用桶", () => {
  const blanks = ["", " ", "  ", "\t", "\n", "\r\n"];
  const keys = blanks.map(rateLimitKeyOf);
  assert.equal(new Set(keys).size, blanks.length);
  for (const key of keys) assert.ok(key.startsWith("raw:"));
});

test("带端口：IPv4 a.b.c.d:port、[IPv4]:port、[IPv6]:port 和不带端口是同一个键；不同端口不会分出不同的桶", () => {
  for (const port of [0, 1, 80, 443, 8080, 65535]) {
    assert.equal(rateLimitKeyOf(`1.2.3.4:${port}`), "1.2.3.4");
    assert.equal(rateLimitKeyOf(`[1.2.3.4]:${port}`), "1.2.3.4");
    assert.equal(rateLimitKeyOf(`[::1]:${port}`), "::/64");
    assert.equal(rateLimitKeyOf(`[2001:db8:1:2::1]:${port}`), "2001:db8:1:2::/64");
    assert.equal(rateLimitKeyOf(`[::ffff:1.2.3.4]:${port}`), "1.2.3.4");
  }
});

test("区域标识：不同网卡名、%25 编码、空区域，都不影响网段", () => {
  for (const zone of ["eth0", "25eth0", "en0", "1", "25", "", "eth0%eth1"]) {
    assert.equal(rateLimitKeyOf(`fe80::1:2:3:4%${zone}`), "fe80::/64", zone);
    assert.equal(rateLimitKeyOf(`[2001:db8:a:b::1%${zone}]:443`), "2001:db8:a:b::/64", zone);
  }
});

test("运行时拿到的不是字符串（连接已断开时 socket.remoteAddress 为 undefined）：不抛异常，得到 raw: 键", () => {
  // Fastify 不信任代理时 request.ip 就是 socket.remoteAddress；客户端在处理前断开时它是 undefined（logging.ts 已经按 `request.ip ?? ""` 处理）。
  // 原来拼进字符串再算哈希不会出错，接上 rateLimitKeyOf 之后在 text.trim() 抛 TypeError，请求变成 500。
  for (const value of [undefined, null]) {
    assert.doesNotThrow(() => rateLimitKeyOf(value as unknown as string), String(value));
    assert.ok(rateLimitKeyOf(value as unknown as string).startsWith("raw:"));
  }
});
