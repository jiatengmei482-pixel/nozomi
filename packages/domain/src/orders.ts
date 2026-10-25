/**
 * 订单与付款（M3-01，ADR 0026）。纯函数，不碰数据库和网络。
 *
 * 需求：《用车报价服务平台》「API · 销售端接口」（下单必须带 quote_id 和 Idempotency-Key、预占库存；订单状态 pending_payment → confirmed → assigned → in_service → completed，
 * 服务开始前可到 cancelled；租户不能拒单）、「5. 商品 · ④ 库存」（下单时预占，支付确认后扣减，取消或超时未支付自动释放）、「8. 订单与履约」（支付后可见乘客姓名、电话、航班号）；
 * 第一轮决策（默认自动确认，租户不能拒单）；第五轮决策 ⑤（事后加收走 Stripe 保存的支付方式）；
 * 《平台运营端与渠道对接》「履约保障与服务标准」（救援改派的 rescue_pending）、「服务后加收费用」（付款时保存支付方式，下单页明确告知并勾选同意）、
 * 「客人通知」（下单时可选填 WhatsApp / LINE / 微信 / KakaoTalk）。
 */
import type { ServiceCategory } from "./master-data.ts";
import type { TripDirection } from "./pricing.ts";

// ---- 订单状态 ----

/**
 * 订单状态（ADR 0026 定义了前 7 个，M3-02 / ADR 0027 加了履约的 4 个：司机已出发、司机已到达、客人未出现待审核、客人未出现）。
 * 付款前的两条（待支付 → 已确认 / 已取消）在 M3-01；派车、履约、no-show 申请在 M3-02；付款后的取消在 M3-03；救援改派在 M3-04；no-show 审核在 M4-02。
 */
export const ORDER_STATUSES = [
  "pending_payment",
  "confirmed",
  "assigned",
  "departed",
  "arrived",
  "in_service",
  "completed",
  "no_show_claimed",
  "no_show",
  "cancelled",
  "rescue_pending",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_NAMES: Readonly<Record<OrderStatus, string>> = {
  pending_payment: "待支付",
  confirmed: "已确认",
  assigned: "已派车",
  departed: "司机已出发",
  arrived: "司机已到达",
  in_service: "服务中",
  completed: "已完成",
  no_show_claimed: "客人未出现（待审核）",
  no_show: "客人未出现",
  cancelled: "已取消",
  rescue_pending: "救援改派中",
};

/**
 * 允许的状态转换。`completed`、`no_show`、`cancelled` 是终态。
 * - 付款成功即自动确认（`pending_payment → confirmed`），租户不能拒单，所以没有「待确认」「已拒绝」。
 * - 履约按顺序走：已派车 → 司机已出发 → 司机已到达 → 服务中（接到客人）→ 已完成；不能跳步（需求「履约回传：已出发 → 已到达 → 已接到客人 → 已完成」）。
 * - 改派：服务开始前可换司机、换车。已派车时改派状态不变（流水里记一条「已派车 → 已派车」）；司机已出发后改派回到「已派车」（新司机重新出发）；
 *   司机已到达上车点后不能再改派（人已经在现场）。
 * - 服务开始（`in_service`）之前可以取消（需求：服务开始前可到 cancelled），之后不能。
 * - 客人未出现：司机到达后，在免费等待结束、证据齐全时提交（`arrived → no_show_claimed`）；平台审核通过 → `no_show`（按全额收费），
 *   驳回 → `cancelled`（客人全额退款，租户拿 0；审核在 M4-02）。
 * - 救援改派：已确认、已派车、司机已出发（到点仍未到达）的单可以进入 `rescue_pending`；救援租户接单后回到 `confirmed`（或直接带着司机到 `assigned`），无人可接时取消并全额退款。
 */
const TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  pending_payment: ["confirmed", "cancelled"],
  confirmed: ["assigned", "cancelled", "rescue_pending"],
  assigned: ["departed", "cancelled", "rescue_pending"],
  departed: ["assigned", "arrived", "cancelled", "rescue_pending"],
  arrived: ["in_service", "no_show_claimed", "cancelled"],
  in_service: ["completed"],
  no_show_claimed: ["no_show", "cancelled"],
  rescue_pending: ["confirmed", "assigned", "cancelled"],
  completed: [],
  no_show: [],
  cancelled: [],
};

export function orderTransitionAllowed(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function orderStatusIsFinal(status: OrderStatus): boolean {
  return TRANSITIONS[status].length === 0;
}

/**
 * 租户看不看得到这一单：只有付过款（确认过）的才看得到。待支付、没付款就取消的单对租户不存在——
 * 需求「支付后可见乘客姓名、电话、航班号」，而且没付款的单不需要租户做任何事。
 */
export function orderVisibleToTenant(confirmedAt: Date | string | null): boolean {
  return confirmedAt !== null;
}

// ---- 付款 ----

export const ORDER_PAYMENT_RULES = {
  /** 待支付多久没付款就自动取消、释放库存：30 分钟（和报价有效期一样长，需求没写，ADR 0026 推荐值） */
  paymentTimeoutMinutes: 30,
  /** 自动取消的检查间隔：每分钟一次，所以最晚在到期后约 1 分钟取消 */
  sweepIntervalSeconds: 60,
} as const;

/** 这一单最晚什么时候付款。到点的那一刻起就不再等（和报价有效期同样「到点即失效」）。 */
export function paymentDeadline(createdAt: Date): Date {
  return new Date(createdAt.getTime() + ORDER_PAYMENT_RULES.paymentTimeoutMinutes * 60_000);
}

export function paymentOverdue(dueAt: Date, now: Date): boolean {
  return now.getTime() >= dueAt.getTime();
}

/**
 * 平台记的付款状态（一单一笔）：
 * `creating` 已建单、还没在支付服务那边建好付款；`requires_payment` 等客人付款（含 3DS 验证中）；`processing` 支付服务处理中；
 * `succeeded` 已付款；`canceled` 付款已取消（超时、客人放弃）。
 */
export const PAYMENT_STATUSES = ["creating", "requires_payment", "processing", "succeeded", "canceled"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Stripe PaymentIntent 的状态（https://docs.stripe.com/payments/paymentintents/lifecycle）。 */
export const PAYMENT_INTENT_STATUSES = ["requires_payment_method", "requires_confirmation", "requires_action", "processing", "requires_capture", "canceled", "succeeded"] as const;
export type PaymentIntentStatus = (typeof PAYMENT_INTENT_STATUSES)[number];

/** PaymentIntent 的状态换成平台记的付款状态。不用手动扣款（capture），`requires_capture` 不会出现，出现了也当处理中。 */
export function paymentStatusOf(intent: PaymentIntentStatus): PaymentStatus {
  switch (intent) {
    case "succeeded":
      return "succeeded";
    case "canceled":
      return "canceled";
    case "processing":
    case "requires_capture":
      return "processing";
    default:
      return "requires_payment";
  }
}

/** 收到的付款和订单要收的是不是同一笔：金额（最小货币单位）和币种都要对上。对不上就不确认订单。 */
export function paymentMatchesOrder(expected: { minor: number; currency: string }, actual: { minor: number; currency: string }): boolean {
  return expected.minor === actual.minor && expected.currency.toUpperCase() === actual.currency.toUpperCase();
}

/**
 * 付款成功的通知到了，订单该怎么办：
 * - `confirm`：待支付 → 已确认（自动确认，库存从预占转为已售）；
 * - `already`：已经确认过（同一笔的重复通知、超时检查先一步确认了），什么都不做；
 * - `paid_after_cancel`：订单已经取消了钱却到了（取消付款和付款同时发生）：不复活订单，记成支付异常，由财务核实退款（异常队列在 M4-02）。
 */
export type PaymentSucceededAction = "confirm" | "already" | "paid_after_cancel";

export function onPaymentSucceeded(status: OrderStatus): PaymentSucceededAction {
  if (status === "pending_payment") return "confirm";
  return status === "cancelled" ? "paid_after_cancel" : "already";
}

// ---- 订单号 ----

/** 订单号里随机部分用的字符：数字和大写字母，去掉容易和 0、1 看混的 I、O。 */
export const ORDER_NO_ALPHABET = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ";
/** `NZ` + 下单日期（UTC，年月日）+ 8 位随机字符，如 `NZ20261007K3M9Q2XA`。全平台唯一（数据库唯一约束兜底）。 */
export const ORDER_NO_PATTERN = /^NZ\d{8}[0-9A-HJ-NP-Z]{8}$/;

export function orderNumber(createdAt: Date, random: string): string {
  if (!/^[0-9A-HJ-NP-Z]{8}$/.test(random)) throw new RangeError("订单号的随机部分应当是 8 位数字或大写字母（不含 I、O）");
  return `NZ${createdAt.toISOString().slice(0, 10).replaceAll("-", "")}${random}`;
}

// ---- 下单时客人填的信息 ----

export const MESSAGING_APPS = ["whatsapp", "line", "wechat", "kakaotalk"] as const;
export type MessagingApp = (typeof MESSAGING_APPS)[number];

export const ORDER_FIELD_LIMITS = {
  nameMax: 100,
  emailMax: 254,
  addressMax: 300,
  notesMax: 500,
  messagingHandleMax: 100,
  channelOrderNoMax: 64,
} as const;

export interface OrderDetailsInput {
  passenger: { name: string; phone: string; email: string };
  flightNo: string | null;
  pickupAddress: string | null;
  dropoffAddress: string | null;
  messaging: { app: MessagingApp; handle: string } | null;
  notes: string | null;
  channelOrderNo: string | null;
  /** 客人勾选了「同意保存支付方式，用于服务后加收」（第五轮决策 ⑤） */
  savePaymentMethodConsent: boolean;
}

/** 这一单的行程：从报价快照来。哪一端有坐标、接送点是机场还是车站。 */
export interface OrderTripShape {
  category: ServiceCategory;
  direction: TripDirection | null;
  /** 接送机的接送点类型；其他品类 null */
  placeType: "airport" | "station" | null;
  hasPickupPoint: boolean;
  hasDropoffPoint: boolean;
}

export type OrderDetailsIssueReason = "REQUIRED" | "NOT_APPLICABLE" | "INVALID_PHONE" | "INVALID_FLIGHT_NO" | "TOO_LONG" | "INVALID_FORMAT" | "CONSENT_REQUIRED";

export interface OrderDetailsIssue {
  path: string;
  reason: OrderDetailsIssueReason;
}

/** 电话去掉空格、连字符、括号、点之后的写法。 */
export function normalizePhone(phone: string): string {
  return phone.replace(/[\s\-().]/g, "");
}

/** 国际格式的电话（E.164）：`+` + 国家码 + 号码，共 8 ~ 15 位数字。客人来自不同国家，不带国家码的号码司机打不通。 */
export function isInternationalPhone(phone: string): boolean {
  return /^\+[1-9]\d{7,14}$/.test(normalizePhone(phone));
}

/** 航班号去掉空格并转大写：`nh 211` → `NH211`。 */
export function normalizeFlightNo(flightNo: string): string {
  return flightNo.replace(/\s+/g, "").toUpperCase();
}

/** 航班号：两位航司代码（字母或数字）+ 可选的第三个字母 + 1 ~ 4 位数字 + 可选的后缀字母，如 `NH211`、`MU5101`、`7C1101`。 */
export function isFlightNo(flightNo: string): boolean {
  return /^[A-Z0-9]{2}[A-Z]?\d{1,4}[A-Z]?$/.test(normalizeFlightNo(flightNo));
}

const blank = (value: string | null): boolean => value === null || value.trim() === "";
const tooLong = (value: string, max: number): boolean => [...value.trim()].length > max;

/**
 * 下单时客人填的信息写得对不对（空数组 = 没问题）。规则：
 * - 乘客姓名、电话（国际格式）、邮箱必填（确认邮件和订单页链接发到邮箱；需求「客人通知」不接短信）；
 * - 接机（机场）要航班号；送机可以填（司机参考）；接送站、点对点、包车不填航班号；
 * - 有坐标的那一端（不是机场 / 车站的那一端）要填地址或酒店名，司机靠它找人；没有坐标的那一端不填；
 * - 即时通讯（WhatsApp / LINE / 微信 / KakaoTalk）选填；备注、渠道订单号选填；
 * - 必须同意保存支付方式（第五轮决策 ⑤：事后加收扣保存的支付方式，下单页要明确告知并勾选同意）。
 */
export function orderDetailsIssues(input: OrderDetailsInput, trip: OrderTripShape): OrderDetailsIssue[] {
  const issues: OrderDetailsIssue[] = [];
  const { passenger } = input;
  if (blank(passenger.name)) issues.push({ path: "/passenger/name", reason: "REQUIRED" });
  else if (tooLong(passenger.name, ORDER_FIELD_LIMITS.nameMax)) issues.push({ path: "/passenger/name", reason: "TOO_LONG" });
  if (blank(passenger.phone)) issues.push({ path: "/passenger/phone", reason: "REQUIRED" });
  else if (!isInternationalPhone(passenger.phone)) issues.push({ path: "/passenger/phone", reason: "INVALID_PHONE" });
  if (blank(passenger.email)) issues.push({ path: "/passenger/email", reason: "REQUIRED" });
  else if (tooLong(passenger.email, ORDER_FIELD_LIMITS.emailMax)) issues.push({ path: "/passenger/email", reason: "TOO_LONG" });
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(passenger.email.trim())) issues.push({ path: "/passenger/email", reason: "INVALID_FORMAT" });

  const atAirport = trip.category === "airport_transfer" && trip.placeType === "airport";
  if (!atAirport) {
    if (!blank(input.flightNo)) issues.push({ path: "/flight_no", reason: "NOT_APPLICABLE" });
  } else if (blank(input.flightNo)) {
    if (trip.direction === "pickup") issues.push({ path: "/flight_no", reason: "REQUIRED" });
  } else if (!isFlightNo(input.flightNo as string)) {
    issues.push({ path: "/flight_no", reason: "INVALID_FLIGHT_NO" });
  }

  const address = (value: string | null, hasPoint: boolean, path: string): void => {
    if (!hasPoint) {
      if (!blank(value)) issues.push({ path, reason: "NOT_APPLICABLE" });
      return;
    }
    if (blank(value)) issues.push({ path, reason: "REQUIRED" });
    else if (tooLong(value as string, ORDER_FIELD_LIMITS.addressMax)) issues.push({ path, reason: "TOO_LONG" });
  };
  address(input.pickupAddress, trip.hasPickupPoint, "/pickup_address");
  address(input.dropoffAddress, trip.hasDropoffPoint, "/dropoff_address");

  if (input.messaging !== null) {
    if (blank(input.messaging.handle)) issues.push({ path: "/messaging/handle", reason: "REQUIRED" });
    else if (tooLong(input.messaging.handle, ORDER_FIELD_LIMITS.messagingHandleMax)) issues.push({ path: "/messaging/handle", reason: "TOO_LONG" });
  }
  if (input.notes !== null && tooLong(input.notes, ORDER_FIELD_LIMITS.notesMax)) issues.push({ path: "/notes", reason: "TOO_LONG" });
  if (input.channelOrderNo !== null) {
    if (input.channelOrderNo.length > ORDER_FIELD_LIMITS.channelOrderNoMax) issues.push({ path: "/channel_order_no", reason: "TOO_LONG" });
    else if (!/^[\x21-\x7E]+$/.test(input.channelOrderNo)) issues.push({ path: "/channel_order_no", reason: "INVALID_FORMAT" });
  }
  if (!input.savePaymentMethodConsent) issues.push({ path: "/save_payment_method", reason: "CONSENT_REQUIRED" });
  return issues;
}
