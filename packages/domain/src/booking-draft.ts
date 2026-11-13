/**
 * 预订条件（BookingDraft v1，需求 03 第 2.1 节、ADR 0087 第三节第 1 小节）：三个入口（主站 `/book`、模型线路、嵌入组件）交给 `/book` 的条件，
 * 放在链接 `/book?d=<base64url(JSON)>` 里。只在浏览器和链接里，不进库；**没有价格、没有报价编号**（价格只在 `/book` 上由引擎现算）。
 *
 * - 编码（`encodeBookingDraft`、`bookingDraftPath`）：地点名称清掉控制字符、超过 30 字截断加「…」，坐标留 6 位小数；
 *   `d` ≤ 7,000 字符、整个网址（路径 + 查询串）≤ 7,200 字符——整个请求行装进 nginx 默认的 8 KB 缓冲，不调 nginx。
 * - 解码（`parseBookingDraft`）：整份解不开（不是 base64url、不是 UTF-8 JSON 对象、超长、`v` 不是 1）返回 null，整份忽略；
 *   解得开时逐项校验，不合格的那一项为 null（地点不合格时这个地点为 null），并在 `issues` 里列出原因，页面据此提示（如「停留时长按 30 分钟一档」）。
 *
 * 前端 `/book` 和嵌入组件共用这一份（组件构建时打包进去）。纯函数，不依赖 Node 专有的 API（浏览器里也能跑）。
 */
import { PRICE_LIMITS } from "./pricing.ts";
import { QUOTE_RULES } from "./quote.ts";
import { ROUTE_CHARTER_LIMITS, stayMinutesIssue } from "./route-charter.ts";
import { localDateTimeToInstant } from "./service-time.ts";

export const BOOKING_DRAFT_LIMITS = {
  /** `d` 的值最长多少个字符 */
  maxParamChars: 7_000,
  /** 整个网址（`/book?d=…`）最长多少个字符 */
  maxUrlChars: 7_200,
  /** 链接里的地点名称最多多少字（按 Unicode 字符数）；超出截断，最后一个字是「…」 */
  linkPlaceNameMax: ROUTE_CHARTER_LIMITS.linkPlaceNameMax,
  /** 编码后仍超长时再试一次的名称长度（兜底，按上限算不会走到） */
  fallbackLinkPlaceNameMax: 20,
  /** 坐标保留的小数位数 */
  coordinateDecimals: 6,
  /** 来源凭证（嵌入组件签发，M9-04 核对签名）最长多少字符：载荷含 1,000 字符的返回地址时约 1,839 字符 */
  maxRefChars: 2_000,
} as const;

export const BOOKING_DRAFT_VERSION = 1;
export const BOOKING_DRAFT_TABS = ["transfer", "charter"] as const;
export type BookingDraftTab = (typeof BOOKING_DRAFT_TABS)[number];
export const BOOKING_DRAFT_CHARTER_MODES = ["route", "package"] as const;
export type BookingDraftCharterMode = (typeof BOOKING_DRAFT_CHARTER_MODES)[number];
export const BOOKING_DRAFT_LANGS = ["zh", "ja", "en"] as const;
export type BookingDraftLang = (typeof BOOKING_DRAFT_LANGS)[number];

/** 模型线路编码：3–40 位小写字母、数字、连字符，字母或数字开头（ADR 0087 第三节第 4 小节）。 */
export const ROUTE_TEMPLATE_CODE = /^[a-z0-9][a-z0-9-]{2,39}$/;
const REF = /^[A-Za-z0-9_.-]+$/;
const SERVICE_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
const BASE64URL = /^[A-Za-z0-9_-]*$/;

/** 地点：第一个是上车点（区间是出发地），最后一个是下车点（区间是目的地），中间是途经点；只有途经点有停留分钟。 */
export interface BookingDraftStop {
  name: string;
  lat: number;
  lng: number;
  stay_minutes: number | null;
}

export interface BookingDraft {
  v: 1;
  tab: BookingDraftTab;
  /** 包车方式：按行程 / 按时长；区间为 null */
  charter_mode: BookingDraftCharterMode | null;
  /** 按时长包车的套餐时长（小时）；其他为 null */
  package_hours: number | null;
  /** 城市当地的出发时间 `YYYY-MM-DDTHH:mm` */
  service_local: string | null;
  stops: BookingDraftStop[];
  passengers: number | null;
  luggage: number | null;
  /** 模型线路编码 */
  route_template: string | null;
  /** 嵌入组件的来源凭证（原样带到下单，服务端核对签名） */
  ref: string | null;
  lang: BookingDraftLang | null;
}

export type BookingDraftIssueReason = "REQUIRED" | "OUT_OF_RANGE" | "NOT_A_STEP" | "NOT_APPLICABLE" | "INVALID_FORMAT";

export interface BookingDraftIssue {
  path: string;
  reason: BookingDraftIssueReason;
}

/** 解开后的预订条件：每一项不合格时为 null（地点列表里不合格的地点为 null）。 */
export interface ParsedBookingDraft {
  tab: BookingDraftTab | null;
  charter_mode: BookingDraftCharterMode | null;
  package_hours: number | null;
  service_local: string | null;
  stops: (BookingDraftStop | null)[] | null;
  passengers: number | null;
  luggage: number | null;
  route_template: string | null;
  ref: string | null;
  lang: BookingDraftLang | null;
}

// ---- base64url（UTF-8）----

function bytesToBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlToBytes(text: string): Uint8Array | null {
  if (!BASE64URL.test(text) || text.length % 4 === 1) return null;
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

// ---- 名称、坐标 ----

/** 地点名称清理：控制字符和格式字符换成空格、连续空白并成一个、去掉首尾空白；空了返回 null。 */
export function cleanPlaceName(value: string): string | null {
  const text = value.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/gu, " ").trim();
  return text === "" ? null : text;
}

/** 链接里的地点名称：超过 `max` 字（按 Unicode 字符数）时截成 `max - 1` 字再加「…」，总长正好 `max`。 */
export function truncateLinkName(name: string, max: number = BOOKING_DRAFT_LIMITS.linkPlaceNameMax): string {
  const chars = [...name];
  return chars.length <= max ? name : `${chars.slice(0, max - 1).join("")}…`;
}

function roundCoordinate(value: number): number {
  const factor = 10 ** BOOKING_DRAFT_LIMITS.coordinateDecimals;
  return Math.round(value * factor) / factor;
}

const isLat = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90;
const isLng = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180;
const intIn = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

function oneOf<T extends string>(values: readonly T[], value: unknown): T | null {
  return typeof value === "string" && (values as readonly string[]).includes(value) ? (value as T) : null;
}

/** 城市当地时间 `YYYY-MM-DDTHH:mm`，日期时间本身要存在（2 月 30 日、25 点都不算）。 */
function validServiceLocal(value: unknown): value is string {
  return typeof value === "string" && SERVICE_LOCAL.test(value) && localDateTimeToInstant(value, "UTC") !== null;
}

// ---- 编码 ----

function draftForLink(draft: BookingDraft, nameMax: number): BookingDraft {
  return {
    v: 1,
    tab: draft.tab,
    charter_mode: draft.charter_mode,
    package_hours: draft.package_hours,
    service_local: draft.service_local,
    stops: draft.stops.map((stop) => ({
      name: truncateLinkName(cleanPlaceName(stop.name) ?? "", nameMax),
      lat: roundCoordinate(stop.lat),
      lng: roundCoordinate(stop.lng),
      stay_minutes: stop.stay_minutes,
    })),
    passengers: draft.passengers,
    luggage: draft.luggage,
    route_template: draft.route_template,
    ref: draft.ref,
    lang: draft.lang,
  };
}

/** 预订条件 → `d` 的值（base64url 的 UTF-8 JSON）。地点名称按 `nameMax`（默认 30 字）截断，坐标留 6 位小数。不检查长度（见 `bookingDraftPath`）。 */
export function encodeBookingDraft(draft: BookingDraft, options: { nameMax?: number } = {}): string {
  const linkDraft = draftForLink(draft, options.nameMax ?? BOOKING_DRAFT_LIMITS.linkPlaceNameMax);
  return bytesToBase64url(new TextEncoder().encode(JSON.stringify(linkDraft)));
}

/**
 * 预订条件 → 跳转用的网址 `<path>?d=…`（默认 `/book`）。`d` 超过 7,000 字符或网址超过 7,200 字符时，先把地点名称截到 20 字再编一次；
 * 仍超过返回 null（调用方提示「途经点太多或名称太长，请减少途经点」；按上限算不会走到这一步）。
 */
export function bookingDraftPath(draft: BookingDraft, path = "/book"): string | null {
  for (const nameMax of [BOOKING_DRAFT_LIMITS.linkPlaceNameMax, BOOKING_DRAFT_LIMITS.fallbackLinkPlaceNameMax]) {
    const d = encodeBookingDraft(draft, { nameMax });
    const url = `${path}?d=${d}`;
    if (d.length <= BOOKING_DRAFT_LIMITS.maxParamChars && url.length <= BOOKING_DRAFT_LIMITS.maxUrlChars) return url;
  }
  return null;
}

// ---- 解码 ----

function parseStop(raw: unknown, index: number, role: "pickup" | "via" | "dropoff", wantStay: boolean, issues: BookingDraftIssue[]): BookingDraftStop | null {
  const path = `/stops/${index}`;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    issues.push({ path, reason: "INVALID_FORMAT" });
    return null;
  }
  const value = raw as Record<string, unknown>;
  const name = typeof value["name"] === "string" ? cleanPlaceName(value["name"]) : null;
  if (name === null) issues.push({ path: `${path}/name`, reason: "REQUIRED" });
  if (!isLat(value["lat"])) issues.push({ path: `${path}/lat`, reason: "OUT_OF_RANGE" });
  if (!isLng(value["lng"])) issues.push({ path: `${path}/lng`, reason: "OUT_OF_RANGE" });
  if (name === null || !isLat(value["lat"]) || !isLng(value["lng"])) return null;
  let stay: number | null = null;
  const rawStay = value["stay_minutes"];
  if (role !== "via" || !wantStay) {
    if (rawStay !== null && rawStay !== undefined) issues.push({ path: `${path}/stay_minutes`, reason: "NOT_APPLICABLE" });
  } else {
    const issue = stayMinutesIssue(rawStay);
    if (issue === null) stay = rawStay as number;
    else issues.push({ path: `${path}/stay_minutes`, reason: issue });
  }
  return { name: truncateLinkName(name), lat: roundCoordinate(value["lat"] as number), lng: roundCoordinate(value["lng"] as number), stay_minutes: stay };
}

/** 地点列表：区间、按时长包车正好 2 个（没有途经点）；按行程 2–10 个，途经点带停留。个数不对整个列表为 null。 */
function parseStops(raw: unknown, tab: BookingDraftTab | null, mode: BookingDraftCharterMode | null, issues: BookingDraftIssue[]): (BookingDraftStop | null)[] | null {
  if (raw === null || raw === undefined) return null;
  if (!Array.isArray(raw)) {
    issues.push({ path: "/stops", reason: "INVALID_FORMAT" });
    return null;
  }
  const route = tab === "charter" && mode === "route";
  const [min, max] = route ? [ROUTE_CHARTER_LIMITS.minStops, ROUTE_CHARTER_LIMITS.maxStops] : [2, 2];
  if (raw.length < min || raw.length > max) {
    issues.push({ path: "/stops", reason: "OUT_OF_RANGE" });
    return null;
  }
  return raw.map((stop, index) => parseStop(stop, index, index === 0 ? "pickup" : index === raw.length - 1 ? "dropoff" : "via", route, issues));
}

/**
 * `d` 的值 → 预订条件。整份解不开（超过 7,000 字符、不是 base64url、不是 UTF-8 的 JSON 对象、`v` 不是 1）返回 null，整份忽略；
 * 否则逐项校验：不合格的那一项为 null、原因列在 `issues` 里（不报错）。
 */
export function parseBookingDraft(d: string | null | undefined): { draft: ParsedBookingDraft; issues: BookingDraftIssue[] } | null {
  if (typeof d !== "string" || d === "" || d.length > BOOKING_DRAFT_LIMITS.maxParamChars) return null;
  const bytes = base64urlToBytes(d);
  if (bytes === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (raw["v"] !== BOOKING_DRAFT_VERSION) return null;

  const issues: BookingDraftIssue[] = [];
  const field = <T>(path: string, input: unknown, parsed: T | null): T | null => {
    if (parsed === null && input !== null && input !== undefined) issues.push({ path, reason: "INVALID_FORMAT" });
    return parsed;
  };
  const tab = field("/tab", raw["tab"], oneOf(BOOKING_DRAFT_TABS, raw["tab"]));
  let mode: BookingDraftCharterMode | null = null;
  if (tab === "charter") mode = field("/charter_mode", raw["charter_mode"], oneOf(BOOKING_DRAFT_CHARTER_MODES, raw["charter_mode"]));
  else if (raw["charter_mode"] !== null && raw["charter_mode"] !== undefined) issues.push({ path: "/charter_mode", reason: "NOT_APPLICABLE" });
  let packageHours: number | null = null;
  if (tab === "charter" && mode === "package") {
    if (intIn(raw["package_hours"], 1, PRICE_LIMITS.maxPackageHours)) packageHours = raw["package_hours"];
    else if (raw["package_hours"] !== null && raw["package_hours"] !== undefined) issues.push({ path: "/package_hours", reason: "OUT_OF_RANGE" });
  } else if (raw["package_hours"] !== null && raw["package_hours"] !== undefined) {
    issues.push({ path: "/package_hours", reason: "NOT_APPLICABLE" });
  }
  const serviceLocal = field("/service_local", raw["service_local"], validServiceLocal(raw["service_local"]) ? raw["service_local"] : null);
  const stops = parseStops(raw["stops"], tab, mode, issues);
  const passengers = intIn(raw["passengers"], 1, QUOTE_RULES.maxPassengers) ? raw["passengers"] : null;
  if (passengers === null && raw["passengers"] !== null && raw["passengers"] !== undefined) issues.push({ path: "/passengers", reason: "OUT_OF_RANGE" });
  const luggage = intIn(raw["luggage"], 0, QUOTE_RULES.maxLuggage) ? raw["luggage"] : null;
  if (luggage === null && raw["luggage"] !== null && raw["luggage"] !== undefined) issues.push({ path: "/luggage", reason: "OUT_OF_RANGE" });
  const template = raw["route_template"];
  const routeTemplate = field("/route_template", template, typeof template === "string" && ROUTE_TEMPLATE_CODE.test(template) ? template : null);
  const ref = raw["ref"];
  const refValue = field("/ref", ref, typeof ref === "string" && ref.length <= BOOKING_DRAFT_LIMITS.maxRefChars && REF.test(ref) ? ref : null);
  const lang = field("/lang", raw["lang"], oneOf(BOOKING_DRAFT_LANGS, raw["lang"]));

  return {
    draft: { tab, charter_mode: mode, package_hours: packageHours, service_local: serviceLocal, stops, passengers, luggage, route_template: routeTemplate, ref: refValue, lang },
    issues,
  };
}
