/**
 * 嵌入预订流程的公用规则（M9E-16，ADR 0095 第三、六节）：组件脚本（宿主页那边的 `mountBooking`、`init` 的 `bookingUrl`）和
 * 主站的嵌入页 `/embed/book`（iframe 里）都用这里，两边说的是同一套话。纯逻辑，不碰 DOM、不调接口，单元测试直接测。
 *
 * - postMessage 协议 v1：`{ ns: "nozomi-booking", v: 1, ch, type, ... }`。收到的消息按白名单逐项取值、重新拼一个对象，
 *   多出来的键一律丢掉；消息里只有步骤名、高度、订单号、错误代码，不带姓名、电话、邮箱、价格、令牌、草稿内容。
 * - origin、source 的核对在两边调用处（要看 MessageEvent），这里只管内容。
 */

export const PROTOCOL_NS = "nozomi-booking";
export const PROTOCOL_VERSION = 1;

/** 嵌入页的路径（同一个前端包里的路由，ADR 0095 第四节第 2 小节） */
export const EMBED_BOOK_PATH = "/embed/book";
export const EMBED_BOOK_ORDER_PATH = "/embed/book/order";

export const BOOKING_STEPS = ["trip", "vehicle", "passenger", "review", "payment", "paid", "expired"] as const;
export type BookingStep = (typeof BOOKING_STEPS)[number];
export const BOOKING_ERROR_CODES = ["DRAFT_NOT_FOUND", "NOT_EMBEDDABLE", "SITE_NOT_OPEN", "LOAD_FAILED"] as const;
export type BookingErrorCode = (typeof BOOKING_ERROR_CODES)[number];
/** 订单号：和主站一样的写法（NZ + 数字字母），只做形状检查 */
const ORDER_NO = /^[A-Z0-9]{6,32}$/;
export const MAX_FRAME_HEIGHT = 20_000;

/** iframe → 宿主 */
export type FrameMessage =
  | { type: "ready"; lang: string }
  | { type: "resize"; height: number }
  | { type: "step"; step: BookingStep }
  | { type: "modal"; open: boolean }
  | { type: "completed"; orderNo: string; status: "submitted" | "confirmed" }
  | { type: "error"; code: BookingErrorCode };

/** 宿主 → iframe */
export type HostMessage = { type: "viewport"; height: number };

type Envelope = { ns: typeof PROTOCOL_NS; v: typeof PROTOCOL_VERSION; ch: string };

export function envelope<T extends FrameMessage | HostMessage>(ch: string, message: T): Envelope & T {
  return { ns: PROTOCOL_NS, v: PROTOCOL_VERSION, ch, ...message };
}

/** 频道号：mountBooking 每建一个 iframe 生成一个，放在 iframe 地址的 # 后面；只用来区分同一页面上的几个 iframe，不是安全凭据 */
export const CHANNEL_FORMAT = /^[A-Za-z0-9_-]{1,64}$/;

/** 高度：整数 px，截到 1–20000；不是有限数为 null */
export function clampHeight(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(MAX_FRAME_HEIGHT, Math.max(1, Math.round(value)));
}

function envelopeOk(data: unknown, ch: string): data is Record<string, unknown> {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return false;
  const record = data as Record<string, unknown>;
  return record["ns"] === PROTOCOL_NS && record["v"] === PROTOCOL_VERSION && typeof record["ch"] === "string" && record["ch"] === ch;
}

/** 宿主收到 iframe 的消息：频道对得上、type 认识、字段按白名单取值；其余为 null（丢弃） */
export function parseFrameMessage(data: unknown, ch: string): FrameMessage | null {
  if (!envelopeOk(data, ch)) return null;
  switch (data["type"]) {
    case "ready":
      return typeof data["lang"] === "string" && /^[a-z]{2}$/.test(data["lang"]) ? { type: "ready", lang: data["lang"] } : { type: "ready", lang: "" };
    case "resize": {
      const height = clampHeight(data["height"]);
      return height === null ? null : { type: "resize", height };
    }
    case "step":
      return BOOKING_STEPS.includes(data["step"] as BookingStep) ? { type: "step", step: data["step"] as BookingStep } : null;
    case "modal":
      return typeof data["open"] === "boolean" ? { type: "modal", open: data["open"] } : null;
    case "completed":
      return typeof data["orderNo"] === "string" && ORDER_NO.test(data["orderNo"]) && (data["status"] === "submitted" || data["status"] === "confirmed") ? { type: "completed", orderNo: data["orderNo"], status: data["status"] } : null;
    case "error":
      return BOOKING_ERROR_CODES.includes(data["code"] as BookingErrorCode) ? { type: "error", code: data["code"] as BookingErrorCode } : null;
    default:
      return null;
  }
}

/** iframe 收到宿主的消息：只认 viewport；宿主发来的只能影响显示位置，不能改预订内容 */
export function parseHostMessage(data: unknown, ch: string): HostMessage | null {
  if (!envelopeOk(data, ch) || data["type"] !== "viewport") return null;
  const height = clampHeight(data["height"]);
  return height === null ? null : { type: "viewport", height };
}

/** 交给合作网站的事件（onEvent、`nozomi:booking`）：只转 step、completed、error */
export type BookingEvent = Extract<FrameMessage, { type: "step" | "completed" | "error" }>;
export function hostEventOf(message: FrameMessage): BookingEvent | null {
  return message.type === "step" || message.type === "completed" || message.type === "error" ? message : null;
}

/** 草稿号：32 字节随机数的 base64url（43 字符，ADR 0090） */
export const DRAFT_ID = /^[A-Za-z0-9_-]{43}$/;
export const isDraftId = (value: unknown): value is string => typeof value === "string" && DRAFT_ID.test(value);

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * 合作网站给的 bookingUrl（ADR 0095 第三节第 1 小节）：WHATWG URL 能解析；https（本机另收 http://localhost、http://127.0.0.1）；
 * 不带用户名密码；origin 必须等于当前页面的 origin（草稿号只交给建草稿的这个网站）。合格返回 URL，不合格为 null（按没传处理）。
 */
export function bookingUrlOf(given: unknown, pageOrigin: string): URL | null {
  if (typeof given !== "string" || given.trim() === "" || given.length > 2_000) return null;
  let url: URL;
  try {
    url = new URL(given.trim());
  } catch {
    return null;
  }
  if (url.username !== "" || url.password !== "") return null;
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))) return null;
  return url.origin === pageOrigin ? url : null;
}

/** 跳回宿主预订页的地址：保留原有的查询参数和 #，已有的 nzdraft 覆盖 */
export function withDraft(bookingUrl: URL, draftId: string): string {
  const url = new URL(bookingUrl.href);
  url.searchParams.set("nzdraft", draftId);
  return url.href;
}

/** 宿主页地址去掉 nzdraft（其余查询参数、# 原样） */
export function withoutDraft(href: string): string {
  const url = new URL(href);
  url.searchParams.delete("nzdraft");
  return url.href;
}

/** 宿主页本标签页 sessionStorage 里的草稿号（ADR 0095 第三节第 2 小节第 0 步；存取在 host-draft-store.ts）：只存草稿号和时间，2 小时 */
export const HOST_DRAFT_TTL_MS = 2 * 3_600_000;

export function hostDraftRecord(id: string, now: number): string {
  return JSON.stringify({ id, at: now });
}

/** 存储里读出来的记录：格式对、没过期才给草稿号；过期或写坏了的返回 "stale"（调用方删掉） */
export function readHostDraftRecord(raw: string | null, now: number): string | null | "stale" {
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw) as { id?: unknown; at?: unknown };
    if (!isDraftId(parsed.id) || typeof parsed.at !== "number" || !Number.isFinite(parsed.at)) return "stale";
    if (parsed.at > now + 60_000 || now - parsed.at >= HOST_DRAFT_TTL_MS) return "stale";
    return parsed.id;
  } catch {
    return "stale";
  }
}

/** iframe 的地址：draft、key、lang（有才带）、host 在查询串里，频道号在 # 后面（不发给服务器、不进访问日志） */
export function embedFrameUrl(base: string, params: { draft: string; key: string; host: string; lang: string | null; ch: string }): string {
  const url = new URL(EMBED_BOOK_PATH, base);
  url.searchParams.set("draft", params.draft);
  url.searchParams.set("key", params.key);
  if (params.lang !== null) url.searchParams.set("lang", params.lang);
  url.searchParams.set("host", params.host);
  url.hash = `ch=${params.ch}`;
  return url.href;
}

/** 嵌入页读自己的地址：草稿号、嵌入码、宿主 origin、语言、频道号；宿主 origin 写法不对为 null（不知道该把消息发给谁，就一条都不发） */
export interface FrameParams {
  draft: string | null;
  key: string | null;
  host: string | null;
  lang: "zh" | "ja" | "en" | null;
  ch: string | null;
}
export function frameParamsOf(search: string, hash: string): FrameParams {
  const query = new URLSearchParams(search);
  const fragment = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  const draft = query.get("draft");
  const key = query.get("key");
  const lang = query.get("lang");
  const ch = fragment.get("ch");
  return {
    draft: isDraftId(draft) ? draft : null,
    key: key !== null && /^nze_[A-Za-z0-9_-]{32}$/.test(key) ? key : null,
    host: hostOriginOf(query.get("host")),
    lang: lang === "zh" || lang === "ja" || lang === "en" ? lang : null,
    ch: ch !== null && CHANNEL_FORMAT.test(ch) ? ch : null,
  };
}

/** host 参数只认规范的 origin（和 frame-check 同一个要求：解析后的 origin 和原文完全一样） */
export function hostOriginOf(value: string | null): string | null {
  if (value === null || value === "" || value.length > 300) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))) return null;
    return url.origin === value ? value : null;
  } catch {
    return null;
  }
}
