/**
 * 改单（M3-03，ADR 0029）。纯函数，不碰数据库和网络。
 *
 * 需求：《平台运营端与渠道对接》「客服与工单 · 客人修改订单规则」：
 * | 航班号、乘客信息、备注 | 直接修改，通知租户 |
 * | 日期或时间（同一租户仍可服务） | 按新时间重算该租户的结算价，对外价按原加价比例；差价多退少补；不重新比价 |
 * | 人数、行李（仍在车型容量内） | 直接修改 |
 * | 车型、品类、城市、超出容量 | 按「取消重下」处理，取消部分按取消规则 |
 * | 已进入免费取消期以外 | 只能改航班号和乘客信息 |
 * 「改单补充」（第五轮）：用车前 24 小时内改日期或时间，需租户在 30 分钟内确认；不确认或拒绝时，客人可免费取消后重新下单，这不计入租户履约失败。
 * 《用车报价服务平台》「修改单处理」：客人改时间、航班、人数时，租户收到 `order.changed`，并看到改前改后对比；改时间后派车结果自动重新校验（冲突时提示改派）。
 */
import type { OrderStatus } from "./orders.ts";

/** 渠道（和运营代客人）能改的字段。坐标、车型、品类、城市不能改：要重新比价，按「取消重下」。 */
export const ORDER_CHANGE_FIELDS = ["passenger", "flight_no", "messaging", "notes", "pickup_address", "dropoff_address", "service_time", "passengers", "luggage"] as const;
export type OrderChangeField = (typeof ORDER_CHANGE_FIELDS)[number];

/** 「乘客信息」：出了免费取消期也能改（需求「只能改航班号和乘客信息」）。即时通讯是联系客人的方式，算乘客信息。 */
export const PASSENGER_INFO_FIELDS: readonly OrderChangeField[] = ["passenger", "flight_no", "messaging"];

/** 要重新算价的字段：日期或时间。 */
export const RESCHEDULE_FIELDS: readonly OrderChangeField[] = ["service_time"];

export const ORDER_CHANGE_RULES = {
  /** 新的或原来的用车时间离现在不到这么多小时的改期，要供应商确认 */
  confirmWithinHours: 24,
  /** 供应商多少分钟内确认；过时没确认算没确认（客人可以免费取消） */
  confirmMinutes: 30,
} as const;

/** 只改乘客信息、备注、地址的单：服务开始（接到客人）前都能改。 */
const DETAIL_STATUSES: readonly OrderStatus[] = ["confirmed", "assigned", "departed", "arrived"];
/** 改时间、人数、行李：司机出发之前（出发后再改人和车都已经在路上了）。 */
const TRIP_STATUSES: readonly OrderStatus[] = ["confirmed", "assigned"];

export type OrderChangeRefusal =
  /** 订单现在的状态不能这样改 */
  | "ORDER_STATE_INVALID"
  /** 已经过了免费取消期：只能改航班号和乘客信息 */
  | "OUTSIDE_FREE_WINDOW"
  /** 人数或行李超出车型容量：按取消重下 */
  | "CAPACITY_EXCEEDED"
  /** 新的用车时间已经过了 */
  | "SERVICE_TIME_PASSED"
  /** 什么都没变 */
  | "NO_CHANGE";

export interface OrderChangeCheck {
  status: OrderStatus;
  /** 这一次要改的字段（已经去掉了和现在一样的） */
  fields: readonly OrderChangeField[];
  /** 现在是不是还在免费取消期里（按这一单的取消阶梯） */
  inFreeWindow: boolean;
  /** 改后的人数、行李，和这一单车型的容量（商品里这个车型组设的最多人数、行李数） */
  passengers: number;
  luggage: number;
  capacity: { passengers: number; luggage: number };
  /** 改后的用车时间（改期时） */
  newServiceAt: Date | null;
  now: Date;
}

/** 这次改单能不能做；能做返回 null。按顺序检查：有没有改、状态、免费取消期、容量、新时间。 */
export function orderChangeRefusal(check: OrderChangeCheck): { reason: OrderChangeRefusal; fields?: OrderChangeField[] } | null {
  if (check.fields.length === 0) return { reason: "NO_CHANGE" };
  const tripFields = check.fields.filter((field) => field === "service_time" || field === "passengers" || field === "luggage");
  if (!DETAIL_STATUSES.includes(check.status) || (tripFields.length > 0 && !TRIP_STATUSES.includes(check.status))) return { reason: "ORDER_STATE_INVALID", fields: tripFields.length > 0 ? tripFields : [...check.fields] };
  if (!check.inFreeWindow) {
    const locked = check.fields.filter((field) => !PASSENGER_INFO_FIELDS.includes(field));
    if (locked.length > 0) return { reason: "OUTSIDE_FREE_WINDOW", fields: locked };
  }
  if (check.passengers > check.capacity.passengers || check.luggage > check.capacity.luggage) return { reason: "CAPACITY_EXCEEDED", fields: tripFields.filter((field) => field !== "service_time") };
  if (check.newServiceAt !== null && check.newServiceAt.getTime() <= check.now.getTime()) return { reason: "SERVICE_TIME_PASSED", fields: ["service_time"] };
  return null;
}

/**
 * 改期要不要供应商确认：原来的或新的用车时间离现在不到 24 小时（按毫秒比较，正好 24 小时不用确认）。
 * 需求写的是「用车前 24 小时内改日期或时间」：按默认的取消阶梯，原来的用车时间进了 24 小时就已经出了免费取消期、不能再改期，
 * 所以实际会走到这里的多半是「把一单改到明天」——供应商未必排得出车，要它确认。
 */
export function rescheduleNeedsConfirmation(oldServiceAt: Date, newServiceAt: Date, now: Date): boolean {
  const limit = ORDER_CHANGE_RULES.confirmWithinHours * 3_600_000;
  return oldServiceAt.getTime() - now.getTime() < limit || newServiceAt.getTime() - now.getTime() < limit;
}

/** 供应商最晚什么时候确认：提出改期后 30 分钟（到点那一刻起算没确认）。 */
export function changeConfirmDeadline(requestedAt: Date): Date {
  return new Date(requestedAt.getTime() + ORDER_CHANGE_RULES.confirmMinutes * 60_000);
}

export function changeConfirmOverdue(dueAt: Date, now: Date): boolean {
  return now.getTime() >= dueAt.getTime();
}

/**
 * 一次改单的状态：
 * `awaiting_payment` 改期要补差价、正在用保存的支付方式扣（扣到了才往下走）；`pending_confirmation` 等供应商确认（30 分钟）；
 * `applied` 已生效；`rejected` 供应商拒绝；`expired` 供应商 30 分钟内没确认；`failed` 补差价没扣到，没改成；`cancelled` 订单取消了，这次改单作废。
 * 拒绝、超时没确认的：已补收的差价退回，客人可以免费取消（`CHANGE_NOT_CONFIRMED`）。
 */
export const ORDER_CHANGE_STATUSES = ["awaiting_payment", "pending_confirmation", "applied", "rejected", "expired", "failed", "cancelled"] as const;
export type OrderChangeStatus = (typeof ORDER_CHANGE_STATUSES)[number];

const CHANGE_TRANSITIONS: Readonly<Record<OrderChangeStatus, readonly OrderChangeStatus[]>> = {
  awaiting_payment: ["pending_confirmation", "applied", "failed", "cancelled"],
  pending_confirmation: ["applied", "rejected", "expired", "cancelled"],
  applied: [],
  rejected: [],
  expired: [],
  failed: [],
  cancelled: [],
};

export function orderChangeTransitionAllowed(from: OrderChangeStatus, to: OrderChangeStatus): boolean {
  return CHANGE_TRANSITIONS[from].includes(to);
}

/** 还没有结论的改单（一张单同时只能有一个：数据库唯一约束兜底）。 */
export function orderChangeOpen(status: OrderChangeStatus): boolean {
  return status === "awaiting_payment" || status === "pending_confirmation";
}

/**
 * 客人能不能因为「改期没被确认」免费取消：这张单最近一次改期被供应商拒绝或 30 分钟内没确认，之后也没有生效的改期。
 * `changes` 是这张单的改期，按提出的先后。
 */
export function freeCancelAfterUnconfirmedChange(changes: readonly { status: OrderChangeStatus; reschedule: boolean }[]): boolean {
  const last = [...changes].reverse().find((change) => change.reschedule && change.status !== "failed" && change.status !== "cancelled");
  return last !== undefined && (last.status === "rejected" || last.status === "expired");
}

/** 改期之后对外价的差：正数补收、负数退回、0 不动。 */
export function priceDifference(oldMinor: number, newMinor: number): { kind: "charge" | "refund" | "none"; amountMinor: number } {
  const diff = newMinor - oldMinor;
  if (diff === 0) return { kind: "none", amountMinor: 0 };
  return diff > 0 ? { kind: "charge", amountMinor: diff } : { kind: "refund", amountMinor: -diff };
}
