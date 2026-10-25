/**
 * 推送给供应商（租户 Webhook）的规则（M3-02，ADR 0027）：事件清单、失败重试的退避、接收地址的校验、出站地址的防 SSRF 判断。
 * 纯函数，不碰数据库和网络（域名解析和真正的请求在 apps/api/src/integrations/webhook-sender.ts）。
 *
 * 需求：《用车报价服务平台》「8. 订单与履约」（有自己调度系统的租户用 Webhook 收单）、「11. 账号、权限与 API 设置」（Webhook：填地址、选订阅事件、
 * 查看投递记录和失败原因、手动重发、发送测试事件）、「API · 租户配置接口」（调度对接 `GET/PUT /webhooks`、`GET /webhooks/deliveries`、
 * `POST /webhooks/deliveries/{id}:retry`、`POST /webhooks:test`；第五轮新增事件 `rescue.offered`、`order.rescued_away`）、
 * 「API · 销售端接口」（Webhook 用 HMAC 签名；5 秒内未返回 2xx 就重试，间隔 1–5–30 分钟、2–6–24 小时；事件带 event_id 供去重）、
 * 「API 通用约定」（HMAC-SHA256 签名，X-Timestamp + X-Signature，5 分钟防重放）。
 */

/**
 * 供应商可以订阅的事件。M3-02 发出前三个；改单、取消在 M3-03 发出；救援的两个在 M3-04 发出——事件名先定下来，供应商可以先订阅。
 */
export const TENANT_WEBHOOK_EVENTS = ["order.confirmed", "order.assigned", "order.status_changed", "order.changed", "order.cancelled", "rescue.offered", "order.rescued_away"] as const;
export type TenantWebhookEvent = (typeof TENANT_WEBHOOK_EVENTS)[number];

/** 「发送测试事件」用的事件类型：不能订阅，只在测试时发。 */
export const WEBHOOK_TEST_EVENT = "webhook.test";
export type WebhookEventType = TenantWebhookEvent | typeof WEBHOOK_TEST_EVENT;

export const TENANT_WEBHOOK_EVENT_NAMES: Readonly<Record<TenantWebhookEvent, string>> = {
  "order.confirmed": "新订单（客人付款后自动确认）",
  "order.assigned": "派车和改派（改派带 change=true）",
  "order.status_changed": "履约状态变化（出发、到达、接到客人、完成、客人未出现）",
  "order.changed": "改单（时间、航班、人数等）",
  "order.cancelled": "订单取消",
  "rescue.offered": "收到救援单",
  "order.rescued_away": "订单已转给救援租户",
};

export const WEBHOOK_RULES = {
  /** 一次推送最多等多久（毫秒）：需求「5 秒内未返回 2xx 就重试」 */
  timeoutMs: 5_000,
  /** 应答最多读多少字节（只看状态码，多余的内容丢弃） */
  maxResponseBytes: 64 * 1024,
  /** 接收地址最长多少字符 */
  maxUrlLength: 2_048,
  /** 签名里的时间戳：接收方应拒绝和自己的时钟相差超过 5 分钟的请求（防重放） */
  signatureToleranceSeconds: 300,
  /** 第一次失败后每次重试前等待的秒数：1 分钟、5 分钟、30 分钟、2 小时、6 小时、24 小时 */
  retryDelaysSeconds: [60, 300, 1_800, 7_200, 21_600, 86_400],
} as const;

/** 一次推送最多尝试几次（第一次 + 6 次重试）。 */
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_RULES.retryDelaysSeconds.length + 1;

/**
 * 已经失败了 `attemptsMade` 次之后，下一次在多少秒后重试；次数用完返回 null（最终失败，进入异常，等人工重推）。
 */
export function webhookRetryDelaySeconds(attemptsMade: number): number | null {
  if (!Number.isInteger(attemptsMade) || attemptsMade < 1) throw new RangeError("已尝试次数应当是正整数");
  return WEBHOOK_RULES.retryDelaysSeconds[attemptsMade - 1] ?? null;
}

/** 状态码算不算接收成功：只有 2xx。3xx 也算失败——不跟随重定向（防 SSRF）。 */
export function webhookAccepted(statusCode: number): boolean {
  return statusCode >= 200 && statusCode < 300;
}

/** 签名的原文：`<时间戳（秒）>.<请求体原文>`。签名 = HMAC-SHA256(签名密钥, 原文) 的十六进制，放在 `X-Signature: v1=<签名>`。 */
export function webhookSignedContent(timestampSeconds: number, body: string): string {
  return `${timestampSeconds}.${body}`;
}

// ---- 接收地址 ----

export type WebhookUrlIssue = "INVALID_URL" | "TOO_LONG" | "NOT_HTTPS" | "HAS_CREDENTIALS" | "HAS_FRAGMENT" | "FORBIDDEN_HOST";

/** 只认 https；不能带账号密码、不能带 `#`；主机不能是内网 / 回环 / 元数据地址或只在内网解析的名字。合格返回 null。 */
export function webhookUrlIssue(raw: string): WebhookUrlIssue | null {
  if (raw.length > WEBHOOK_RULES.maxUrlLength) return "TOO_LONG";
  if (!URL.canParse(raw)) return "INVALID_URL";
  const url = new URL(raw);
  if (url.protocol !== "https:") return "NOT_HTTPS";
  if (url.username !== "" || url.password !== "") return "HAS_CREDENTIALS";
  if (raw.includes("#")) return "HAS_FRAGMENT";
  if (!webhookHostAllowed(url.hostname)) return "FORBIDDEN_HOST";
  return null;
}

/** 只在内网解析的名字（和元数据服务的名字）：不用解析就能拒绝。 */
const INTERNAL_NAME = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain|home\.arpa)$/i;

/**
 * 主机名能不能作为推送目标（不做域名解析）：IP 写法的按地址判断；名字不能是 localhost、`.local`、`.internal` 这类只在内网有意义的，
 * 也不能没有点（单标签名字在内网解析）。真正发送前还要解析域名、逐个检查解析到的地址（`ipAddressAllowed`）。
 */
export function webhookHostAllowed(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (host === "") return false;
  if (parseIpv4(host) !== null || host.includes(":")) return ipAddressAllowed(host);
  // 十进制、八进制、十六进制写的「数字地址」（如 2130706433、0x7f.1）：浏览器和一些解析器会把它当成 IP，一律不认
  if (/^[0-9.]+$/.test(host) || /^0x[0-9a-f]+/i.test(host) || /(^|\.)0x[0-9a-f]*($|\.)/i.test(host)) return false;
  if (!host.includes(".")) return false;
  return !INTERNAL_NAME.test(host);
}

// ---- 出站地址（防 SSRF） ----

export type IpAddressClass =
  | "public"
  | "invalid"
  | "unspecified"
  | "loopback"
  | "private"
  | "shared"
  | "link_local"
  | "metadata"
  | "multicast"
  | "broadcast"
  | "documentation"
  | "benchmark"
  | "reserved";

/** 解析点分十进制的 IPv4（四段、每段 0–255、不带前导零）；不是返回 null。 */
export function parseIpv4(text: string): [number, number, number, number] | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const bytes = parts.map((part) => (/^(0|[1-9]\d{0,2})$/.test(part) ? Number(part) : NaN));
  if (bytes.some((byte) => Number.isNaN(byte) || byte > 255)) return null;
  return bytes as [number, number, number, number];
}

/** 解析 IPv6（含 `::` 缩写和末尾嵌 IPv4 的写法，不认带 `%` 的区域标识）为 8 个 16 位数；不是返回 null。 */
export function parseIpv6(text: string): number[] | null {
  if (text.includes("%") || !/^[0-9a-f:.]+$/i.test(text)) return null;
  let head = text;
  let tail: number[] = [];
  const lastColon = head.lastIndexOf(":");
  if (head.includes(".")) {
    const v4 = parseIpv4(head.slice(lastColon + 1));
    if (v4 === null) return null;
    tail = [(v4[0] << 8) | v4[1], (v4[2] << 8) | v4[3]];
    head = head.slice(0, lastColon + 1);
    if (head.endsWith(":") && !head.endsWith("::")) head = head.slice(0, -1);
  }
  const doubles = head.split("::");
  if (doubles.length > 2) return null;
  const group = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    for (const piece of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/i.test(piece)) return null;
      out.push(parseInt(piece, 16));
    }
    return out;
  };
  const left = group(doubles[0] as string);
  const right = doubles.length === 2 ? group(doubles[1] as string) : [];
  if (left === null || right === null) return null;
  const known = left.length + right.length + tail.length;
  if (doubles.length === 2) {
    if (known > 7) return null;
    return [...left, ...new Array<number>(8 - known).fill(0), ...right, ...tail];
  }
  return known === 8 ? [...left, ...tail] : null;
}

function ipv4Class(b: readonly number[]): IpAddressClass {
  const [a, c, d, e] = b as [number, number, number, number];
  if (a === 0) return "unspecified";
  if (a === 10) return "private";
  if (a === 100 && c >= 64 && c <= 127) return "shared";
  if (a === 127) return "loopback";
  if (a === 169 && c === 254) return d === 169 && e === 254 ? "metadata" : "link_local";
  if (a === 172 && c >= 16 && c <= 31) return "private";
  if (a === 192 && c === 0 && d === 0) return "reserved";
  if (a === 192 && c === 0 && d === 2) return "documentation";
  if (a === 192 && c === 88 && d === 99) return "reserved";
  if (a === 192 && c === 168) return "private";
  if (a === 198 && (c === 18 || c === 19)) return "benchmark";
  if (a === 198 && c === 51 && d === 100) return "documentation";
  if (a === 203 && c === 0 && d === 113) return "documentation";
  if (a >= 224 && a <= 239) return "multicast";
  if (a === 255 && c === 255 && d === 255 && e === 255) return "broadcast";
  if (a >= 240) return "reserved";
  return "public";
}

/**
 * 一个 IP 地址属于哪一类。只有 `public` 可以作为推送目标：内网（10/8、172.16/12、192.168/16、fc00::/7）、回环、链路本地、
 * 云服务器的元数据地址（169.254.169.254、fd00:ec2::254 在 fc00::/7 里）、运营商级 NAT、组播、广播、文档和测试用的地址、保留地址一律拒绝。
 * IPv6 里嵌着 IPv4 的写法（::ffff:a.b.c.d、64:ff9b::/96、6to4 的 2002::/16）按里面的 IPv4 判断。
 */
export function ipAddressClass(text: string): IpAddressClass {
  const address = text.replace(/^\[|\]$/g, "");
  const v4 = parseIpv4(address);
  if (v4 !== null) return ipv4Class(v4);
  const g = parseIpv6(address);
  if (g === null) return "invalid";
  const [g0, g1, g2, g3, g4, g5, g6, g7] = g as [number, number, number, number, number, number, number, number];
  const embedded = (hi: number, lo: number): IpAddressClass => ipv4Class([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff]);
  const zeroPrefix = g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0;
  if (zeroPrefix && g5 === 0 && g6 === 0) return g7 === 0 ? "unspecified" : g7 === 1 ? "loopback" : "reserved";
  if (zeroPrefix && g5 === 0xffff) return embedded(g6, g7);
  if (zeroPrefix && g5 === 0) return embedded(g6, g7);
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) return embedded(g6, g7);
  if (g0 === 0x2002) return embedded(g1, g2);
  if ((g0 & 0xfe00) === 0xfc00) return g0 === 0xfd00 && g1 === 0x0ec2 && g7 === 0x254 ? "metadata" : "private";
  if ((g0 & 0xffc0) === 0xfe80) return "link_local";
  if ((g0 & 0xffc0) === 0xfec0) return "private";
  if ((g0 & 0xff00) === 0xff00) return "multicast";
  if (g0 === 0x2001 && g1 === 0x0db8) return "documentation";
  if (g0 === 0x2001 && g1 < 0x0200) return "reserved";
  if (g0 === 0x0100 && g1 === 0 && g2 === 0 && g3 === 0) return "reserved";
  if ((g0 & 0xe000) !== 0x2000) return "reserved";
  return "public";
}

export function ipAddressAllowed(text: string): boolean {
  return ipAddressClass(text) === "public";
}
