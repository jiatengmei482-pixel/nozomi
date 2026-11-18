/**
 * 运营后台「人工报价」「官网设置」的地址、状态徽标和文字（M8-21，ADR 0076；规范 docs/design/pages/platform-tickets.md 第 9 节、platform-settings.md 第 9 节）。
 */
import { MANUAL_QUOTE_STATUSES, MANUAL_QUOTE_STATUS_NAMES, type ManualQuoteStatus, manualQuoteEmail, whatsappDigits } from "@nozomi/domain";
import type { ManualQuoteEvent, ManualQuoteSummary, ManualQuoteTrip, ManualQuoteTripItem, ManualQuoteTripPlan, ManualQuoteTripPlanKind } from "../api/manual-quotes.ts";
import type { BadgeSpec } from "../components/StatusBadge.tsx";
import { durationText } from "./charter-itinerary.ts";
import { moneyText } from "./dispatch-display.ts";
import { SERVICE_CATEGORY_NAMES, displayName } from "./master-display.ts";
import { SETTINGS_ROOT } from "./platform-paths.ts";

export const MANUAL_QUOTES_PAGE = "/platform/manual-quotes";
export const SITE_SETTINGS_PAGE = `${SETTINGS_ROOT}/site`;

export function manualQuotePath(id: string): string {
  return `${MANUAL_QUOTES_PAGE}/${encodeURIComponent(id)}`;
}

/** 「新」要有人看，用警告色；跟进中、已报价是进行中；已转订单成功；关闭中性。 */
export const MANUAL_QUOTE_STATUS_BADGES: Readonly<Record<ManualQuoteStatus, BadgeSpec>> = {
  new: { tone: "warning", label: MANUAL_QUOTE_STATUS_NAMES.new },
  following: { tone: "info", label: MANUAL_QUOTE_STATUS_NAMES.following },
  quoted: { tone: "info", label: MANUAL_QUOTE_STATUS_NAMES.quoted },
  converted: { tone: "success", label: MANUAL_QUOTE_STATUS_NAMES.converted },
  closed: { tone: "neutral", label: MANUAL_QUOTE_STATUS_NAMES.closed },
};

export const PURGED_BADGE: BadgeSpec = { tone: "neutral", label: "已清除联系方式" };

/** 验收留资（M8-39，ADR 0078 补充）：测试环境验收会话里提交的，不是真实客人。中性色，和测试供应商的「测试」徽标同一种写法。 */
export const ACCEPTANCE_BADGE: BadgeSpec = { tone: "neutral", label: "验收" };

/** 网址里的状态：认得的才用。 */
export function manualQuoteStatusOf(value: string | null): ManualQuoteStatus | null {
  return (MANUAL_QUOTE_STATUSES as readonly string[]).includes(value ?? "") ? (value as ManualQuoteStatus) : null;
}

/** 按联系方式查找：完整的邮箱，或带国家码的 WhatsApp 号码（+ 可有可无）。不完整的不去查（接口会 400）。 */
export function contactQueryValid(value: string): boolean {
  return manualQuoteEmail(value) !== null || whatsappDigits(value, { requirePlus: false }) !== null;
}

/** 行程一句话（列表、详情标题下）：「点对点 · 东京 · 2030-11-20 09:30（当地）· 2 人 1 件行李」，包车加时长。没有地点（地点是个人信息，只在详情里）。 */
export function manualQuoteTripText(request: Pick<ManualQuoteSummary, "category" | "city" | "service_local" | "passengers" | "luggage" | "package_hours">): string {
  const category = request.category === "charter" && request.package_hours !== null ? `包车 ${request.package_hours} 小时` : SERVICE_CATEGORY_NAMES[request.category];
  const city = request.city === null ? "城市未识别" : displayName(request.city.name).text;
  return `${category} · ${city} · ${request.service_local.replace("T", " ")}（当地）· ${request.passengers} 人 ${request.luggage} 件行李`;
}

/** 客人留了哪几项（列表只有「有没有」）。 */
export function contactKindsText(request: Pick<ManualQuoteSummary, "has_email" | "has_whatsapp">): string {
  const kinds = [request.has_email ? "邮箱" : null, request.has_whatsapp ? "WhatsApp" : null].filter((kind): kind is string => kind !== null);
  return kinds.length === 0 ? "—" : kinds.join("、");
}

/** 跟进记录的一句话。 */
export function manualQuoteEventText(event: ManualQuoteEvent): string {
  if (event.kind === "created") return "客人提交";
  if (event.kind === "status") return `状态：${event.from_status === null ? "—" : MANUAL_QUOTE_STATUS_NAMES[event.from_status]} → ${event.to_status === null ? "—" : MANUAL_QUOTE_STATUS_NAMES[event.to_status]}`;
  if (event.kind === "assign") return event.assignee === null ? "取消指派" : `指派给「${event.assignee.name}」`;
  return "备注";
}

/** 客人的 WhatsApp（`+819012345678`）去 wa.me 要的纯数字；认不出时为 null（只显示号码）。 */
export function guestWhatsappDigits(whatsapp: string): string | null {
  return whatsappDigits(whatsapp, { requirePlus: false });
}

/** 客服点客人的 WhatsApp 时预先写好的第一句（客服可以在 WhatsApp 里改）。 */
export function guestWhatsappGreeting(requestNo: string): string {
  return `您好，这里是 NOZOMI 用车的客服，关于您的用车报价申请（${requestNo}）：`;
}

/** 客服 WhatsApp 号码显示成「+81 0000000000」这样带 + 的写法（存的是纯数字）。 */
export function supportWhatsappText(digits: string): string {
  return `+${digits}`;
}

export const SUPPORT_WHATSAPP_HINT = "填带国家码的号码，如 +81 开头的日本号码；可以有空格、连字符。保存后官网报不出价时显示「通过 WhatsApp 联系我们」，清空就不显示。";
export const SUPPORT_WHATSAPP_INVALID = "号码的格式不对：要带国家码（不以 0 开头），共 8 到 15 位数字，如 +81 开头的日本号码";

// ───────────── 带行程单的申请（M9T-08，ADR 0101 第十二节第 2 条） ─────────────

/** 列表、详情上的「整张行程单」标记：客人从行程报价页转人工，带了整张行程单（单日的行程单也算，所以不叫「多日」）。 */
export const TRIP_ATTACHED_BADGE: BadgeSpec = { tone: "info", label: "整张行程单" };

/** 「整张行程」一块的文字（集中在这里，页面不散写）。 */
export const MANUAL_QUOTE_TRIP_COPY = {
  title: "整张行程",
  lead: "客人在行程报价页填的整张行程单和当时的报价结果。上面「行程」一栏只是第一天的一段。",
  purged: "行程单已清理（超过 30 天）",
  purgedHint: "行程单在建单 30 天后自动清理，现在只能按上面第一天的一段和客人沟通。",
  planKind: "客人当时看的方案",
  party: "人数和行李",
  readableUntil: "行程单保留到",
  plans: "报价结果",
  noPlans: "客人还没有报过价。",
  unquoted: "报不出的原因",
  idleDay: "空闲日（不用车）",
  nightAt: "当晚住在：",
} as const;

export const TRIP_PLAN_KIND_NAMES: Readonly<Record<ManualQuoteTripPlanKind, string>> = {
  one_car: "一车到底",
  daily_best: "每天各自最优",
};

export const TRIP_PLAN_STATUS_BADGES: Readonly<Record<ManualQuoteTripPlan["status"], BadgeSpec>> = {
  quoted: { tone: "success", label: "报得出" },
  unquoted: { tone: "warning", label: "报不出" },
};

export const TRIP_ITEM_KIND_NAMES: Readonly<Record<ManualQuoteTripItem["kind"], string>> = {
  arrive_flight: "接机",
  start: "出发",
  stop: "经停",
  end: "终点",
  depart_flight: "送机",
};

/** 行程报价报不出的原因码（官网行程报价应答的 `unquoted`）：认得的写中文，不认得的写通用的话并带上原因码。 */
const TRIP_UNQUOTED_REASON_NAMES: Readonly<Record<string, string>> = {
  NO_OFFER: "这一天没有供应商报得出价",
  NO_PRODUCT: "这一带没有可售的商品",
  NOT_AVAILABLE: "有商品，但这一天都不接",
  OUT_OF_SERVICE_AREA: "不在供应商的运营区域里",
  CAPACITY_EXCEEDED: "人数或行李超出车型",
  ITINERARY_TOO_LONG: "预计用时超过在线下单上限",
  WAYPOINT_NOT_PRICED: "经停点不在任何区域里",
  LEAD_TIME_TOO_SHORT: "离用车时间太近",
  SERVICE_TIME_PASSED: "用车时间已经过去",
  SOLD_OUT: "库存不足",
  OUTSIDE_SERVICE_TIME: "不在服务时间里",
  ADDON_NOT_OFFERED: "附加服务不提供",
  ROUTE_UNAVAILABLE: "取不到路线",
  CROSS_CITY_ONE_CAR: "跨城市的一车到底暂不支持在线报价",
  ONE_CAR_NOT_AVAILABLE: "没有一家能用同一辆车做完全程",
  WORK_HOURS_EXCEEDED: "司机工时超出，需要第二司机",
  WORK_HOURS_HARD_LIMIT: "司机工时超出上限，第二司机也不行",
  SECOND_DRIVER_PRICE_UNAVAILABLE: "需要第二司机，但供应商没设第二司机的价格",
  LODGING_PRICE_UNAVAILABLE: "需要司机住宿，但供应商没设住宿费",
  FEE_PRICE_UNAVAILABLE: "跨段费用没有价格",
};

export function tripUnquotedReasonText(reason: string): string {
  return TRIP_UNQUOTED_REASON_NAMES[reason] ?? `未能在线报价（原因码 ${reason}）`;
}

/** 「每天各自最优 · 第 2 天：这一天没有供应商报得出价」；不针对某一天的写「全程」。 */
export function tripUnquotedText(entry: ManualQuoteTrip["unquoted"][number]): string {
  return `${TRIP_PLAN_KIND_NAMES[entry.plan_kind]} · ${entry.day_index === null ? "全程" : `第 ${entry.day_index + 1} 天`}：${tripUnquotedReasonText(entry.reason)}`;
}

/** 「第 1 天 · 2026-12-01」 */
export function tripDayTitle(index: number, date: string): string {
  return `第 ${index + 1} 天 · ${date}`;
}

export function tripPartyText(party: ManualQuoteTrip["party"]): string {
  return `成人 ${party.adults} 人${party.children > 0 ? `、儿童 ${party.children} 人` : ""}，${party.luggage} 件行李`;
}

/**
 * 一个点的地点：客人页面上的名称，没有时用平台地点的名称（带语言，页面写 `lang`），再没有用坐标（都没有写「地点已不存在」）。
 * 客人写的名称不知道是哪种语言，不带 `lang`。
 */
export function tripItemPlaceText(item: ManualQuoteTripItem): { text: string; lang?: string } {
  if (item.label !== null) return { text: item.label };
  if (item.place_name !== null) return displayName(item.place_name);
  return { text: tripItemCoordsText(item) ?? "地点已不存在" };
}

/** 「当晚住在：…」的地点：坐标和当天某个点相同时用那个点的名称（没有名称的点不算），否则写坐标。 */
export function tripNightText(day: ManualQuoteTrip["days"][number]): { text: string; lang?: string } | null {
  const night = day.night_at;
  if (night === null) return null;
  const same = [...day.items].reverse().find((item) => item.lat === night.lat && item.lng === night.lng && (item.label !== null || item.place_name !== null));
  return same === undefined ? { text: tripItemCoordsText(night) as string } : tripItemPlaceText(same);
}

export function tripItemCoordsText(item: Pick<ManualQuoteTripItem, "lat" | "lng">): string | null {
  return item.lat === null || item.lng === null ? null : `${item.lat.toFixed(5)}, ${item.lng.toFixed(5)}`;
}

/** 一个点的说明：「接机 · 14:30」「经停 · 停留 1 小时」 */
export function tripItemMetaText(item: ManualQuoteTripItem): string {
  return [TRIP_ITEM_KIND_NAMES[item.kind], item.time, item.stay_minutes === null ? null : `停留 ${durationText(item.stay_minutes)}`].filter((part): part is string => part !== null).join(" · ");
}

/** 方案一行：「一车到底（推荐）· 120,000 JPY」；报不出的不写金额。 */
export function tripPlanText(plan: ManualQuoteTripPlan): string {
  const name = `${TRIP_PLAN_KIND_NAMES[plan.kind]}${plan.recommended ? "（推荐）" : ""}`;
  return plan.total === null ? name : `${name} · ${moneyText(plan.total)}`;
}
