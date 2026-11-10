/**
 * 人工报价申请（M8-21，ADR 0076）：官网一家都报不出价时，客人留下邮箱或 WhatsApp，客服人工报价。
 *
 * - 只收两项联系方式：邮箱、WhatsApp（国际格式的号码），至少一项（业主 2026-11-10 定）；不收姓名。
 * - 行程由页面自动带上（用车类型、两端地点和坐标、用车时间、人数、行李、包车时长），客人不用再填。
 * - 联系方式和两端地点按乘客信息的方案加密存（ADR 0057）；关闭（或转订单）180 天后、最晚提交 365 天后清除。
 * - 同一处的「通过 WhatsApp 联系我们」：号码在运营后台「官网设置」里填（`whatsappDigits`），消息只有行程要点，没有客人的个人信息。
 */
import type { ServiceCategory } from "./master-data.ts";
import { viewLinkLookupEmail } from "./view-link.ts";

export const MANUAL_QUOTE_STATUSES = ["new", "following", "quoted", "converted", "closed"] as const;
export type ManualQuoteStatus = (typeof MANUAL_QUOTE_STATUSES)[number];

export const MANUAL_QUOTE_STATUS_NAMES: Readonly<Record<ManualQuoteStatus, string>> = {
  new: "新",
  following: "跟进中",
  quoted: "已报价",
  converted: "已转订单",
  closed: "关闭",
};

/** 进入这两种状态算「结束」：记结束时间，保留期从这时算起。 */
export const MANUAL_QUOTE_FINISHED: readonly ManualQuoteStatus[] = ["converted", "closed"];

export const MANUAL_QUOTE_RULES = {
  /** 结束（已转订单或关闭）之后保留多少天，到期清除联系方式、地点和备注 */
  retentionDaysAfterFinish: 180,
  /** 不管状态，提交之后最多保留多少天（一直没人处理的申请不能无限期留着） */
  retentionDaysMax: 365,
  /** 客服备注最长多少字 */
  maxNoteLength: 2_000,
  /** 地点名称最长多少字（和按坐标报价的地址名称一样） */
  maxPlaceName: 300,
  /** 同一个联系方式、同一个行程在这段时间里重复提交只算一次 */
  duplicateWindowMs: 24 * 3_600_000,
  maxPassengers: 60,
  maxLuggage: 60,
  /** 包车套餐时长的上限（和价格规则的 `PRICE_LIMITS.maxPackageHours` 一样） */
  maxPackageHours: 72,
} as const;

/**
 * 提交的限速（ADR 0076）：每个来源地址 15 分钟 3 次、每天 10 次；每个联系方式每天 3 次；全站每小时 300 次。
 * 全站上限防的是换地址刷库：到了上限所有人都要等，客人还能用页面上的 WhatsApp 按钮和客服电话。
 */
export const MANUAL_QUOTE_LIMITS = {
  ip: { max: 3, windowMs: 15 * 60_000 },
  ipDay: { max: 10, windowMs: 86_400_000 },
  contactDay: { max: 3, windowMs: 86_400_000 },
  globalHour: { max: 300, windowMs: 3_600_000 },
} as const;

/** 申请编号：MQ + 提交日（UTC）+ 8 位（数字和大写字母）。 */
export const MANUAL_QUOTE_NO_FORMAT = /^MQ\d{8}[0-9A-Z]{8}$/;

/** 客人填的邮箱：规范化（全角转半角、去掉首尾空白、小写）后核对格式；不合格返回 null。 */
export function manualQuoteEmail(value: string): string | null {
  return viewLinkLookupEmail(value);
}

/**
 * WhatsApp 号码：去掉空格、连字符、括号、点之后是「国家码 + 号码」，共 8–15 位数字、不以 0 开头（wa.me 要的写法）。
 * 返回纯数字（`819012345678`），不合格返回 null。
 * - 客人填的（`requirePlus`）：必须以 + 开头——不带 + 的「090…」「90…」分不清是不是本地号码；
 * - 运营后台填的：+ 可有可无（照 wa.me 的说明直接写数字也行）；`00` 开头的国际冠码不认，免得多出两个 0。
 */
export function whatsappDigits(value: string, options: { requirePlus: boolean }): string | null {
  const compact = value.normalize("NFKC").trim().replace(/[\s\-().]/g, "");
  const plus = compact.startsWith("+");
  if (options.requirePlus && !plus) return null;
  const digits = plus ? compact.slice(1) : compact;
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

export interface ManualQuotePlace {
  name: string;
  lat: number;
  lng: number;
}

/** 页面自动带上的行程（客人不用再填）。 */
export interface ManualQuoteTrip {
  category: ServiceCategory;
  pickup: ManualQuotePlace;
  /** 包车可以没有（旧预订页只选上车地点）；接送机、点对点必填 */
  dropoff: ManualQuotePlace | null;
  /** 当地时间 YYYY-MM-DDTHH:mm */
  serviceLocal: string;
  passengers: number;
  luggage: number;
  /** 包车套餐时长，只有包车有、而且必填 */
  packageHours: number | null;
}

export type ManualQuoteTripIssue = { field: "dropoff" | "package_hours" | "service_local"; reason: "REQUIRED" | "NOT_APPLICABLE" | "INVALID" };

/** 用车时间是不是真实存在的日期和时刻（格式由接口先核对）。 */
export function isRealLocalDateTime(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (match === null) return false;
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [number, number, number, number, number];
  if (hour > 23 || minute > 59 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** 行程各项按用车类型核对：哪些必填、哪些不该有。 */
export function manualQuoteTripIssues(trip: ManualQuoteTrip): ManualQuoteTripIssue[] {
  const issues: ManualQuoteTripIssue[] = [];
  if (trip.category !== "charter" && trip.dropoff === null) issues.push({ field: "dropoff", reason: "REQUIRED" });
  if (trip.category === "charter" && trip.packageHours === null) issues.push({ field: "package_hours", reason: "REQUIRED" });
  if (trip.category !== "charter" && trip.packageHours !== null) issues.push({ field: "package_hours", reason: "NOT_APPLICABLE" });
  if (!isRealLocalDateTime(trip.serviceLocal)) issues.push({ field: "service_local", reason: "INVALID" });
  return issues;
}

/** 状态能不能这样改：只能改成别的状态；不能改回「新」（「新」只表示还没人看过）。 */
export function manualQuoteStatusChangeAllowed(from: ManualQuoteStatus, to: ManualQuoteStatus): boolean {
  return from !== to && to !== "new";
}

/** 这一条该不该清除了：结束满 180 天，或者提交满 365 天（不管状态）。 */
export function manualQuotePurgeDue(row: { createdAt: Date; finishedAt: Date | null }, now: Date): boolean {
  const day = 86_400_000;
  if (now.getTime() - row.createdAt.getTime() >= MANUAL_QUOTE_RULES.retentionDaysMax * day) return true;
  return row.finishedAt !== null && now.getTime() - row.finishedAt.getTime() >= MANUAL_QUOTE_RULES.retentionDaysAfterFinish * day;
}

/** 两个截止时刻：结束早于前者、或提交早于后者的要清除（和 `manualQuotePurgeDue` 同一个口径，给 SQL 用）。 */
export function manualQuotePurgeCutoffs(now: Date): { finishedBefore: Date; createdBefore: Date } {
  const day = 86_400_000;
  return { finishedBefore: new Date(now.getTime() - MANUAL_QUOTE_RULES.retentionDaysAfterFinish * day), createdBefore: new Date(now.getTime() - MANUAL_QUOTE_RULES.retentionDaysMax * day) };
}

const CATEGORY_WORDS: Readonly<Record<ServiceCategory, string>> = { airport_transfer: "接送机", point_to_point: "点对点", charter: "包车" };

/**
 * 「通过 WhatsApp 联系我们」预先写好的一句话：用车类型、上车 → 下车、用车时间、人数（包车加时长）。
 * 只有行程要点——客人还没留任何个人信息，这里也不放。地点名称太长时截短，整句不超过 500 字。
 */
export function manualQuoteWhatsappText(trip: Pick<ManualQuoteTrip, "category" | "serviceLocal" | "passengers" | "packageHours"> & { pickup: { name: string }; dropoff: { name: string } | null }): string {
  const clip = (name: string): string => {
    const clean = name.replace(/\s+/gu, " ").trim();
    return [...clean].length > 80 ? `${[...clean].slice(0, 79).join("")}…` : clean;
  };
  const route = trip.dropoff === null ? clip(trip.pickup.name) : `${clip(trip.pickup.name)} → ${clip(trip.dropoff.name)}`;
  const hours = trip.category === "charter" && trip.packageHours !== null ? ` ${trip.packageHours} 小时` : "";
  const when = trip.serviceLocal.replace("T", " ");
  return `您好，我想咨询用车报价：${CATEGORY_WORDS[trip.category]}${hours}，${route}，${when}，${trip.passengers} 人。`;
}

/** wa.me 链接：号码是 `whatsappDigits` 规范化过的纯数字。 */
export function whatsappChatUrl(digits: string, text: string): string {
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}
