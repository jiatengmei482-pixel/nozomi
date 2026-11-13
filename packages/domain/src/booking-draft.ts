/**
 * 预订草稿（M9E-01，ADR 0090 第二节）：嵌入组件把预订条件交给主站暂存，再跳 `/book/new?draft=<编号>`。
 *
 * - 内容只有预订条件：用车类型、上 / 下车点、经停点和停留、日期时间、人数行李、包车时长、语言；
 *   **不含价格、报价编号、任何客人个人信息**——多一个键就拒。
 * - 规则和 `/site/v1/quotes`、`/book/new` 页面同一口径：经停点只有包车能有（≤ 10 个，停留 30 分钟一档、30–480），
 *   有经停点时按行程计价（ADR 0089），包车时长必须为空。
 * - 编号 32 字节随机数的 base64url（43 字符），有效期 2 小时；过期和不存在不区分。
 */
import { PRICE_LIMITS } from "./pricing.ts";
import { QUOTE_RULES } from "./quote.ts";
import { localDateTimeToInstant } from "./service-time.ts";

export const BOOKING_DRAFT_RULES = {
  /** 有效期（分钟）：够比价、填信息、付款（报价、待支付各 30 分钟）并允许刷新 */
  ttlMinutes: 120,
  /** 序列化后的上限（字节），库里有同样的 check 约束 */
  maxBytes: 16_384,
  /** 地点名称的长度（同 `/site/v1/quotes` 经停点名称） */
  maxNameLength: 200,
  /** 经停点停留：30 分钟一档，30–480（同 `/book/new` 页面的选项） */
  stayStepMinutes: 30,
  minStayMinutes: 30,
  maxStayMinutes: 480,
} as const;

/** 编号：43 个 base64url 字符（32 字节随机数，不补 `=`） */
export const BOOKING_DRAFT_ID_FORMAT = /^[A-Za-z0-9_-]{43}$/;

export const BOOKING_DRAFT_TABS = ["transfer", "charter"] as const;
export type BookingDraftTab = (typeof BOOKING_DRAFT_TABS)[number];
export const BOOKING_DRAFT_LANGS = ["zh", "ja", "en"] as const;
export type BookingDraftLang = (typeof BOOKING_DRAFT_LANGS)[number];

export interface BookingDraftPoint {
  name: string;
  lat: number;
  lng: number;
}

export interface BookingDraftWaypoint extends BookingDraftPoint {
  stay_minutes: number;
}

/** 预订条件 v1。键名和接口里的 JSON 一样（snake_case），原样存库、原样返回。 */
export interface BookingDraft {
  v: 1;
  tab: BookingDraftTab;
  /** 城市当地 `YYYY-MM-DDTHH:mm` */
  service_local: string;
  pickup: BookingDraftPoint;
  dropoff: BookingDraftPoint;
  waypoints: BookingDraftWaypoint[];
  package_hours: number | null;
  passengers: number;
  luggage: number;
  lang: BookingDraftLang;
}

export type BookingDraftIssueReason = "REQUIRED" | "NOT_APPLICABLE" | "OUT_OF_RANGE" | "INVALID" | "UNKNOWN_KEY" | "TOO_LARGE";
export interface BookingDraftIssue {
  path: string;
  reason: BookingDraftIssueReason;
}

const DRAFT_KEYS = ["v", "tab", "service_local", "pickup", "dropoff", "waypoints", "package_hours", "passengers", "luggage", "lang"] as const;
const POINT_KEYS = ["name", "lat", "lng"] as const;
const WAYPOINT_KEYS = [...POINT_KEYS, "stay_minutes"] as const;
const LOCAL_FORMAT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isIntIn = (value: unknown, min: number, max: number): value is number => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
const isCoord = (value: unknown, limit: number): value is number => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= limit;

function unknownKeys(value: Record<string, unknown>, allowed: readonly string[], path: string, issues: BookingDraftIssue[]): void {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) issues.push({ path: `${path}/${key}`, reason: "UNKNOWN_KEY" });
}

function pointIssues(value: unknown, path: string, keys: readonly string[], issues: BookingDraftIssue[]): void {
  if (value === undefined || value === null) return void issues.push({ path, reason: "REQUIRED" });
  if (!isRecord(value)) return void issues.push({ path, reason: "INVALID" });
  unknownKeys(value, keys, path, issues);
  const name = value.name;
  if (typeof name !== "string" || name.trim() === "") issues.push({ path: `${path}/name`, reason: "REQUIRED" });
  else if (name !== name.trim() || [...name].length > BOOKING_DRAFT_RULES.maxNameLength) issues.push({ path: `${path}/name`, reason: "OUT_OF_RANGE" });
  if (!isCoord(value.lat, 90)) issues.push({ path: `${path}/lat`, reason: "OUT_OF_RANGE" });
  if (!isCoord(value.lng, 180)) issues.push({ path: `${path}/lng`, reason: "OUT_OF_RANGE" });
}

/** 序列化后的字节数（UTF-8） */
export function bookingDraftBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/**
 * 校验一份来路不明的预订条件（来自嵌入组件的请求体，或库里读出来的）。没有问题返回空数组。
 * 只检查写法和范围；日期是否已过去、地点在不在服务范围，由 `/book/new` 和询价现有的校验负责。
 */
export function bookingDraftIssues(value: unknown): BookingDraftIssue[] {
  const issues: BookingDraftIssue[] = [];
  if (!isRecord(value)) return [{ path: "", reason: "INVALID" }];
  if (bookingDraftBytes(value) > BOOKING_DRAFT_RULES.maxBytes) return [{ path: "", reason: "TOO_LARGE" }];
  unknownKeys(value, DRAFT_KEYS, "", issues);
  if (value.v !== 1) issues.push({ path: "/v", reason: "INVALID" });
  const tab = value.tab;
  if (!BOOKING_DRAFT_TABS.includes(tab as BookingDraftTab)) issues.push({ path: "/tab", reason: tab === undefined ? "REQUIRED" : "INVALID" });
  const local = value.service_local;
  if (typeof local !== "string" || !LOCAL_FORMAT.test(local) || localDateTimeToInstant(local, "UTC") === null) issues.push({ path: "/service_local", reason: local === undefined ? "REQUIRED" : "INVALID" });
  pointIssues(value.pickup, "/pickup", POINT_KEYS, issues);
  pointIssues(value.dropoff, "/dropoff", POINT_KEYS, issues);
  const waypoints = value.waypoints;
  if (!Array.isArray(waypoints)) issues.push({ path: "/waypoints", reason: waypoints === undefined ? "REQUIRED" : "INVALID" });
  else if (waypoints.length > 0 && tab !== "charter") issues.push({ path: "/waypoints", reason: "NOT_APPLICABLE" });
  else if (waypoints.length > QUOTE_RULES.maxWaypoints) issues.push({ path: "/waypoints", reason: "OUT_OF_RANGE" });
  else
    for (const [index, waypoint] of waypoints.entries()) {
      const path = `/waypoints/${index}`;
      pointIssues(waypoint, path, WAYPOINT_KEYS, issues);
      const stay = isRecord(waypoint) ? waypoint.stay_minutes : undefined;
      if (isRecord(waypoint) && (!isIntIn(stay, BOOKING_DRAFT_RULES.minStayMinutes, BOOKING_DRAFT_RULES.maxStayMinutes) || stay % BOOKING_DRAFT_RULES.stayStepMinutes !== 0)) issues.push({ path: `${path}/stay_minutes`, reason: stay === undefined ? "REQUIRED" : "OUT_OF_RANGE" });
    }
  const hours = value.package_hours;
  if (hours === undefined) issues.push({ path: "/package_hours", reason: "REQUIRED" });
  else if (hours !== null) {
    if (tab !== "charter" || (Array.isArray(waypoints) && waypoints.length > 0)) issues.push({ path: "/package_hours", reason: "NOT_APPLICABLE" });
    else if (!isIntIn(hours, 1, PRICE_LIMITS.maxPackageHours)) issues.push({ path: "/package_hours", reason: "OUT_OF_RANGE" });
  }
  if (!isIntIn(value.passengers, 1, QUOTE_RULES.maxPassengers)) issues.push({ path: "/passengers", reason: value.passengers === undefined ? "REQUIRED" : "OUT_OF_RANGE" });
  if (!isIntIn(value.luggage, 0, QUOTE_RULES.maxLuggage)) issues.push({ path: "/luggage", reason: value.luggage === undefined ? "REQUIRED" : "OUT_OF_RANGE" });
  if (!BOOKING_DRAFT_LANGS.includes(value.lang as BookingDraftLang)) issues.push({ path: "/lang", reason: value.lang === undefined ? "REQUIRED" : "INVALID" });
  return issues;
}

/** 校验通过时返回类型化的草稿，否则 null */
export function parseBookingDraft(value: unknown): BookingDraft | null {
  return bookingDraftIssues(value).length === 0 ? (value as BookingDraft) : null;
}

/** 编号的写法对不对（不对就直接 404，不查库） */
export function isBookingDraftId(id: string): boolean {
  return BOOKING_DRAFT_ID_FORMAT.test(id);
}

/** 草稿的到期时刻 */
export function bookingDraftExpiresAt(createdAt: Date): Date {
  return new Date(createdAt.getTime() + BOOKING_DRAFT_RULES.ttlMinutes * 60_000);
}
