/**
 * 官网（M3-05，ADR 0032）页面上的说法和小规则：客人看到的订单状态、报不出价的原因、「我已落地」什么时候能点、
 * 订单页地址里的令牌、城市当地的日期时间。文案用客人的说法（「付款」「用车时间」），不出现「供应商」「结算价」。
 */
import { type ExtraChargeStatus, LANDING_RULES, type OrderChangeStatus, type OrderStatus, addDays } from "@nozomi/domain";
import type { CancelTier } from "../api/order-money.ts";
import type { SiteCategory, SiteDirection, SiteOrder, SitePlace, SiteQuote, SiteUnavailableReason } from "../api/site.ts";
import type { BadgeSpec } from "../components/StatusBadge.tsx";

export const SITE_HOME_PATH = "/book";
export const SITE_CHECKOUT_PATH = "/book/checkout";
export const SITE_ORDER_PATH = "/book/order";

/** 客人看到的服务名称（M3-10）。 */
export const SITE_CATEGORY_NAMES: Readonly<Record<SiteCategory, string>> = { airport_transfer: "接送机", point_to_point: "点对点", charter: "包车" };

/** 选服务时每种服务下面的一句说明。 */
export const SITE_CATEGORY_HINTS: Readonly<Record<SiteCategory, string>> = {
  airport_transfer: "机场和酒店、地址之间",
  point_to_point: "市内两个地点之间",
  charter: "按小时包一辆车，司机全程陪同",
};

/** 价格包含什么（询价结果上方的一句）：包车的高速费、停车费和超出套餐的部分服务后按实际收（加收的类型只有包车有这几项）。 */
export function priceNote(category: SiteCategory): string {
  return category === "charter"
    ? "按车计价的套餐价。超出套餐的时长和公里、高速费、停车费服务后按实际收取：先通知您，48 小时内可以在订单页提异议。"
    : "按车计价的一口价，已含高速费和停车费。";
}

/** 一单要客人写哪几端的地址：接送机只写机场之外的那一端；点对点两端；包车只写上车点。 */
export function addressEnds(category: SiteCategory, direction: SiteDirection | null): ("pickup" | "dropoff")[] {
  if (category === "point_to_point") return ["pickup", "dropoff"];
  if (category === "charter") return ["pickup"];
  return direction === "pickup" ? ["dropoff"] : ["pickup"];
}

/** 地址那一栏的名字：接送机、点对点都按上车 / 下车说。 */
export const ADDRESS_LABELS: Readonly<Record<"pickup" | "dropoff", string>> = { pickup: "上车地址或酒店名", dropoff: "下车地址或酒店名" };

/** 用车时间那两栏的名字：接机填的是航班的计划到达时间。 */
export function serviceTimeLabels(category: SiteCategory, direction: SiteDirection | null): { date: string; time: string; fact: string } {
  return category === "airport_transfer" && direction === "pickup"
    ? { date: "航班到达日期（当地）", time: "航班计划到达时间（当地）", fact: "航班计划到达" }
    : { date: "用车日期（当地）", time: "上车时间（当地）", fact: "上车时间" };
}

/** 免费等待从什么时候算：只有接机从航班落地算。 */
export function freeWaitText(minutes: number | null, category: SiteCategory, direction: SiteDirection | null): string {
  if (minutes === null) return "不限时";
  return `${minutes} 分钟（${category === "airport_transfer" && direction === "pickup" ? "从航班落地起算" : "从约定的上车时间起算"}）`;
}

/** 包车套餐的说法：`8 小时，含 150 公里`；公里数不知道时只说时长。 */
export function packageText(hours: number, km: number | null): string {
  return km === null ? `${hours} 小时` : `${hours} 小时，含 ${countText(km)} 公里`;
}

export const SITE_PLACE_TYPE_NAMES: Readonly<Record<SitePlace["type"], string>> = { airport: "机场", station: "车站", poi: "地标" };

/** 订单页的地址：令牌在 `#` 后面，不会发给服务器、不进访问日志。 */
export function siteOrderUrl(token: string): string {
  return `${SITE_ORDER_PATH}#${token}`;
}

/** 地址里 `#` 后面的查看令牌；格式不对返回 null。 */
export function siteTokenFromHash(hash: string): string | null {
  const token = hash.replace(/^#/, "").trim();
  return /^nzo_[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}

/** 客人看到的订单状态：状态 = 颜色 + 文字；要客人去做事的（待付款）是提示色。 */
export const GUEST_STATUS_BADGES: Readonly<Record<OrderStatus, BadgeSpec>> = {
  pending_payment: { tone: "warning", label: "待付款" },
  confirmed: { tone: "success", label: "已确认" },
  assigned: { tone: "info", label: "已派车" },
  departed: { tone: "info", label: "司机已出发" },
  arrived: { tone: "info", label: "司机已到达" },
  in_service: { tone: "info", label: "服务中" },
  completed: { tone: "success", label: "已完成" },
  no_show_claimed: { tone: "warning", label: "司机报告未接到您（审核中）" },
  no_show: { tone: "neutral", label: "未接到乘客" },
  cancelled: { tone: "neutral", label: "已取消" },
  rescue_pending: { tone: "warning", label: "正在为您重新安排车辆" },
  // 原供应商那一行转给救援供应商后的状态；客人看的是当前那一行，一般看不到它，兜底写成已重新安排
  rescued: { tone: "info", label: "已为您重新安排车辆" },
};

/** 时间线上每一步的说法。 */
export const TIMELINE_NAMES: Readonly<Record<OrderStatus, string>> = {
  pending_payment: "已下单，等待付款",
  confirmed: "付款成功，订单已确认",
  assigned: "已安排司机和车辆",
  departed: "司机已出发",
  arrived: "司机已到达上车点",
  in_service: "已上车",
  completed: "服务完成",
  no_show_claimed: "司机报告未接到您，平台审核中",
  no_show: "审核结果：未接到乘客",
  cancelled: "订单已取消",
  rescue_pending: "正在为您重新安排车辆",
  rescued: "已为您重新安排车辆",
};

export const GUEST_CANCEL_REASON_NAMES: Readonly<Record<string, string>> = {
  PAYMENT_TIMEOUT: "超过付款期限没有付款，系统自动取消",
  PAYMENT_CANCELED: "付款被取消",
  GUEST_REQUEST: "您取消了订单（按取消政策退款）",
  CHANGE_NOT_CONFIRMED: "改期没有被确认，免费取消",
  FLIGHT_CANCELLED: "航班取消，免费取消",
  FORCE_MAJEURE: "不可抗力，免费取消",
  SUPPLIER_FAULT: "服务方原因，免费取消",
  PLATFORM_FAULT: "平台原因，免费取消",
};

/** 报不出价的原因：告诉客人可以怎么改。 */
export const UNAVAILABLE_REASON_TEXT: Readonly<Record<SiteUnavailableReason, string>> = {
  NO_PRODUCT: "这里暂时没有这种服务可预订，请换一种服务或换一个城市。",
  OUT_OF_SERVICE_AREA: "这个地址不在服务范围内，请换一个更靠近市区的地址。",
  LEAD_TIME_TOO_SHORT: "离用车时间太近了，请选晚一些的时间。",
  SOLD_OUT: "这一天已经订满了，请换一天。",
  OUTSIDE_SERVICE_TIME: "这个时间不在服务时间内，请换一个时间。",
  SERVICE_TIME_PASSED: "用车时间已经过了，请选一个以后的时间。",
  CAPACITY_EXCEEDED: "人数或行李超出了车辆能坐下的数量，请减少人数或行李。",
  ADDON_NOT_OFFERED: "所选的附加服务暂不提供。",
  DRIVER_LANGUAGE_NOT_OFFERED: "所选的司机语言暂不提供。",
  NO_ROUTE: "这两个地点之间没有可行驶的路线，请换一个地址。",
  TEMPORARILY_UNAVAILABLE: "暂时算不出这段路程的价格，请稍后再试，或改订包车。",
  NOT_AVAILABLE: "暂时没有可预订的车，请换一个时间再试。",
};

const GUEST_LANDING_STATUSES: ReadonlySet<OrderStatus> = new Set(["confirmed", "assigned", "departed", "arrived"]);

export type LandingAvailability =
  | { kind: "not_applicable" }
  | { kind: "reported"; at: string }
  | { kind: "unpaid" }
  | { kind: "too_early"; opensAt: Date }
  | { kind: "closed" }
  | { kind: "open" };

/**
 * 「我已落地」现在能不能点（和后端同一条规则：接机单、付款后、接到客人之前；计划到达前 3 小时起）。
 * 后端是最终的判断，这里只决定按钮要不要出现、旁边写什么。
 */
export function landingAvailability(order: Pick<SiteOrder, "landing" | "status">, now: Date): LandingAvailability {
  const landing = order.landing;
  if (landing === null) return { kind: "not_applicable" };
  if (landing.guest_reported_at !== null) return { kind: "reported", at: landing.guest_reported_at };
  if (order.status === "pending_payment") return { kind: "unpaid" };
  if (!GUEST_LANDING_STATUSES.has(order.status)) return { kind: "closed" };
  const opensAt = new Date(new Date(landing.scheduled_at).getTime() - LANDING_RULES.earliestHoursBeforeScheduled * 3_600_000);
  return now.getTime() < opensAt.getTime() ? { kind: "too_early", opensAt } : { kind: "open" };
}

/** 某个时刻在城市当地的 `YYYY-MM-DDTHH:mm`。 */
export function localDateTimeIn(timeZone: string, at: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
      .formatToParts(at)
      .map((part) => [part.type, part.value]),
  );
  return `${parts["year"]}-${parts["month"]}-${parts["day"]}T${parts["hour"]}:${parts["minute"]}`;
}

/** 询价表单默认的用车日期：城市当地的明天。 */
export function defaultServiceDate(timeZone: string, now: Date): string {
  return addDays(localDateTimeIn(timeZone, now).slice(0, 10), 1);
}

/** 千分位的整数：`2` → `2`，`12000` → `12,000`。 */
export function countText(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** 新的幂等键：每次「提交」一个，网络失败重试用同一个。 */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

/** 客人看到的事后加收状态。 */
export const GUEST_EXTRA_STATUS_BADGES: Readonly<Record<ExtraChargeStatus, BadgeSpec>> = {
  in_window: { tone: "warning", label: "可提异议" },
  review: { tone: "info", label: "平台审核中" },
  disputed: { tone: "info", label: "已提异议，平台审核中" },
  approved: { tone: "info", label: "审核通过，等待扣款" },
  charging: { tone: "info", label: "扣款中" },
  charged: { tone: "neutral", label: "已扣款" },
  charge_failed: { tone: "danger", label: "扣款没有成功，平台会联系您" },
  rejected: { tone: "success", label: "不收取" },
  withdrawn: { tone: "neutral", label: "已撤回" },
};

/** 客人看到的改单状态。 */
export const GUEST_CHANGE_STATUS_BADGES: Readonly<Record<OrderChangeStatus, BadgeSpec>> = {
  awaiting_payment: { tone: "info", label: "正在补收差价" },
  pending_confirmation: { tone: "warning", label: "等待确认（30 分钟内）" },
  applied: { tone: "success", label: "已修改" },
  rejected: { tone: "neutral", label: "没有被接受，可以免费取消" },
  expired: { tone: "neutral", label: "超时没有确认，可以免费取消" },
  failed: { tone: "danger", label: "没有改成" },
  cancelled: { tone: "neutral", label: "已作废" },
};

/** 基点写成百分数（只用于显示，整数运算）：`5000` → `50%`，`1250` → `12.5%`。 */
function percentOfBp(bp: number): string {
  const whole = Math.trunc(bp / 100);
  const rest = String(bp % 100).padStart(2, "0").replace(/0+$/, "");
  return `${whole}${rest === "" ? "" : `.${rest}`}%`;
}

/**
 * 客人看的取消政策（pages/site-booking.md 第 11 节 F7）：不用 ≥ < 符号、不说「扣 100%」。
 * 「用车前 48 小时以上取消免费；24–48 小时内取消收 50%；24 小时内取消收全额」。每档是「离用车不少于 N 小时」，后一档的上限是前一档的下限。
 */
export function guestCancelPolicyText(tiers: readonly CancelTier[]): string {
  return tiers
    .map((tier, index) => {
      const upper = index === 0 ? null : (tiers[index - 1] as CancelTier).min_hours_before;
      const when = upper === null ? (tier.min_hours_before === 0 ? "任何时候取消" : `用车前 ${tier.min_hours_before} 小时以上取消`) : tier.min_hours_before === 0 ? `${upper} 小时内取消` : `${tier.min_hours_before}–${upper} 小时内取消`;
      const fee = tier.fee_bp === 0 ? "免费" : tier.fee_bp >= 10_000 ? "收全额" : `收 ${percentOfBp(tier.fee_bp)}`;
      return `${when}${fee}`;
    })
    .join("；");
}

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

/**
 * 客人看的日期时间（F8）：城市当地的 `YYYY-MM-DDTHH:mm` 写成「10月26日（周一）17:45」；不在当地今年的带上年份「2027年1月3日（周日）09:00」。
 * 「当地时间」由调用处写在前面或后面。
 */
export function guestLocalText(local: string, timeZone: string, now: Date): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}:\d{2})/.exec(local);
  if (match === null) return local;
  const [, year = "", month = "", day = "", time = ""] = match;
  const weekday = WEEKDAYS[new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay()] as string;
  const thisYear = localDateTimeIn(timeZone, now).slice(0, 4);
  return `${year === thisYear ? "" : `${year}年`}${Number(month)}月${Number(day)}日（${weekday}）${time}`;
}

/** 某个时刻在城市当地的客人说法（见 guestLocalText）；没有时刻时写「—」。 */
export function guestInstantText(iso: string | null, timeZone: string, now: Date): string {
  if (iso === null) return "—";
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "—" : guestLocalText(localDateTimeIn(timeZone, at), timeZone, now);
}

/** 十进制金额字符串按数值比较（不经浮点）：小数位补齐后当整数比。 */
function compareDecimal(a: string, b: string): number {
  const [aWhole = "0", aFraction = ""] = a.split(".");
  const [bWhole = "0", bFraction = ""] = b.split(".");
  const digits = Math.max(aFraction.length, bFraction.length);
  const diff = BigInt(`${aWhole}${aFraction.padEnd(digits, "0")}`) - BigInt(`${bWhole}${bFraction.padEnd(digits, "0")}`);
  return diff < 0n ? -1 : diff > 0n ? 1 : 0;
}

/** 报价按总价从低到高（F6）；同价保持接口的顺序。同一次询价的报价是同一个币种。 */
export function quotesByTotal(quotes: readonly SiteQuote[]): SiteQuote[] {
  return [...quotes].sort((a, b) => compareDecimal(a.price.total.amount, b.price.total.amount));
}

/** 订单页上的区块（F1）：默认的先后顺序。 */
export const ORDER_SECTION_ORDER = ["trip", "timeline", "driver", "landing", "charges", "change", "cancel", "feedback", "help"] as const;
export type OrderSectionKey = "payment" | (typeof ORDER_SECTION_ORDER)[number];

/**
 * 客人进来要做的那件事（pages/site-booking.md 5.1）：待付款 → 付款；「我已落地」能点 → 航班落地；有还在异议期内的服务后费用 → 服务后的费用；其他 → 行程。
 */
export function primaryOrderSection(order: Pick<SiteOrder, "status" | "landing" | "extra_charges">, now: Date): OrderSectionKey {
  if (order.status === "pending_payment") return "payment";
  if (landingAvailability(order, now).kind === "open") return "landing";
  if (order.extra_charges.some((charge) => charge.dispute_open)) return "charges";
  return "trip";
}

/** 区块的先后：排第一的那块放最前，其余按默认顺序。付款区块只在待付款时有，总在第一。 */
export function orderSectionSequence(primary: OrderSectionKey): OrderSectionKey[] {
  return [primary, ...ORDER_SECTION_ORDER.filter((key) => key !== primary)];
}

// ---- 投诉和反馈（M4-03） ----

/** 客人能提的几类，用客人的说法。 */
export const GUEST_TICKET_TYPE_NAMES: Readonly<Record<string, string>> = { complaint: "投诉服务", order_change: "修改订单", lost_and_found: "失物招领", other: "其他问题" };
export const GUEST_TICKET_TYPE_HINTS: Readonly<Record<string, string>> = {
  complaint: "司机迟到、没举牌、车况或态度不好、车型不对等，服务结束后 14 天内可以投诉",
  order_change: "网上改不了的内容（时间、地址以外的）",
  lost_and_found: "东西落在车上了：写清楚是什么、坐的哪一程",
  other: "别的问题",
};

/** 客人看到的处理状态：没有结论的都是「处理中」，有结论的「已有结果」，关闭的「已结束」。 */
export function guestTicketBadge(status: string): BadgeSpec {
  if (status === "decided") return { tone: "success", label: "已有结果" };
  if (status === "closed") return { tone: "neutral", label: "已结束" };
  return { tone: "info", label: "处理中" };
}

/** 结论的客人说法。 */
export function guestTicketOutcome(type: string, outcome: string | null): string | null {
  if (outcome === null) return null;
  if (type === "complaint") return outcome === "upheld" ? "投诉成立，平台按赔付标准给您补偿" : outcome === "rejected" ? "经核实投诉不成立" : null;
  return outcome === "resolved" ? "已处理" : null;
}
