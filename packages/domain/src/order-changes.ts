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
 * 业主（M4-29，ADR 0060）：改时间、地点、航班、人数不再直接覆盖，生成修改申请，供应商同意才生效；联系信息直接生效；任何修改和取消都立即通知。
 */
import { CANCELLABLE_STATUSES } from "./cancellation.ts";
import type { OrderStatus } from "./orders.ts";

/** 渠道（和运营代客人）能改的字段。坐标、车型、品类、城市不能改：要重新比价，按「取消重下」。 */
export const ORDER_CHANGE_FIELDS = ["passenger", "flight_no", "messaging", "notes", "pickup_address", "dropoff_address", "service_time", "passengers", "luggage"] as const;
export type OrderChangeField = (typeof ORDER_CHANGE_FIELDS)[number];

/** 「乘客信息」：出了免费取消期也能改（需求「只能改航班号和乘客信息」）。即时通讯是联系客人的方式，算乘客信息。 */
export const PASSENGER_INFO_FIELDS: readonly OrderChangeField[] = ["passenger", "flight_no", "messaging"];

/** 要重新算价的字段：日期或时间。 */
export const RESCHEDULE_FIELDS: readonly OrderChangeField[] = ["service_time"];

/** 只是联系信息：直接生效，通知供应商和已派的司机（ADR 0060）。 */
export const CONTACT_FIELDS: readonly OrderChangeField[] = ["passenger", "messaging", "notes"];

/** 影响履约：生成修改申请，供应商同意才生效。 */
export const CONFIRM_FIELDS: readonly OrderChangeField[] = ORDER_CHANGE_FIELDS.filter((field) => !CONTACT_FIELDS.includes(field));

export function changeFieldsNeedConfirmation(fields: readonly string[]): boolean {
  return fields.some((field) => (CONFIRM_FIELDS as readonly string[]).includes(field));
}

export const ORDER_CHANGE_RULES = {
  /** 离最早用车时间不到这么多小时，没确认的申请才会自动失效 */
  confirmWithinHours: 24,
  /** 进入上面的窗口之后，供应商多少分钟内确认；过时没确认算没确认（客人可以免费取消） */
  confirmMinutes: 30,
  /** 调整中：放宽时最多给到这么久 */
  adjustingMaxHours: 24,
  /** 调整中：至少给这么久（30 分钟换不好司机） */
  adjustingMinHours: 2,
  /** 调整中：期限不晚于最早用车前这么久 */
  adjustingLatestHoursBeforeService: 1,
  /** 调整中：远期的单期限不晚于最早用车前这么久 */
  adjustingFarLatestHoursBeforeService: 22,
  /** 提出后多久还没结论就提醒运营（离最早用车时间 ≤ 24 小时 / ≤ 48 小时 / 更远，进异常队列） */
  remindMinutes: { within24h: 15, within48h: 60, later: 240 },
} as const;

const HOUR_MS = 3_600_000;

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

/** 原用车时间和新用车时间里早的那个（没有改时间就是原用车时间）：期限和提醒都按它。 */
export function earliestServiceAt(serviceAt: Date, newServiceAt: Date | null): Date {
  return newServiceAt !== null && newServiceAt.getTime() < serviceAt.getTime() ? newServiceAt : serviceAt;
}

/**
 * 申请最晚什么时候有结论（到点那一刻起算没确认）：进入最早用车前 24 小时之后的 30 分钟。提出时已经在 24 小时内的，就是提出后 30 分钟。
 * 所以远期的申请不会自动失效，但也不可能挂到用车。改期的不晚于新的用车时间（过了就没有意义了）。
 */
export function changeConfirmDeadline(requestedAt: Date, earliest: Date, newServiceAt: Date | null): Date {
  const zoneStart = earliest.getTime() - ORDER_CHANGE_RULES.confirmWithinHours * HOUR_MS;
  const due = Math.max(requestedAt.getTime(), zoneStart) + ORDER_CHANGE_RULES.confirmMinutes * 60_000;
  return new Date(newServiceAt === null ? due : Math.min(due, newServiceAt.getTime()));
}

/**
 * 标了「调整中」之后的期限（只能标一次）。见 ADR 0060：**永远不缩短原期限**，只在原期限太紧时放宽：
 * 放宽到 min(现在 + 24 小时, 最早用车前 22 小时)，至少现在 + 2 小时，且不晚于最早用车前 1 小时。远期的原期限（最早用车前 23.5 小时）本来就够，不变。
 */
export function changeAdjustingDeadline(now: Date, currentDue: Date, earliest: Date): Date {
  const rules = ORDER_CHANGE_RULES;
  const at = now.getTime();
  const service = earliest.getTime();
  const limit = Math.max(Math.min(at + rules.adjustingMaxHours * HOUR_MS, service - rules.adjustingFarLatestHoursBeforeService * HOUR_MS), at + rules.adjustingMinHours * HOUR_MS);
  const capped = Math.min(limit, service - rules.adjustingLatestHoursBeforeService * HOUR_MS);
  return new Date(Math.max(capped, currentDue.getTime()));
}

/** 这次申请提出后多少分钟还没结论就要提醒运营（SQL 里同一套，见 repos/exceptions.ts）。 */
export function changeRemindAfterMinutes(earliest: Date, now: Date): number {
  const left = earliest.getTime() - now.getTime();
  const { within24h, within48h, later } = ORDER_CHANGE_RULES.remindMinutes;
  return left <= 24 * HOUR_MS ? within24h : left <= 48 * HOUR_MS ? within48h : later;
}

export function changeConfirmOverdue(dueAt: Date, now: Date): boolean {
  return now.getTime() >= dueAt.getTime();
}

/**
 * 一次改单的状态：
 * `awaiting_payment` 改期要补差价、正在用保存的支付方式扣（扣到了才往下走）；`pending_confirmation` 等供应商确认；`adjusting` 调整中（供应商在换司机或协调）；
 * `applied` 已生效；`rejected` 供应商拒绝；`expired` 期限内没确认，或订单已经走到这次修改不再适用；`failed` 补差价没扣到，没改成；`cancelled` 订单取消或进入救援，这次改单作废。
 * 拒绝、超时没确认的：已补收的差价退回，客人可以免费取消（`CHANGE_NOT_CONFIRMED`）。
 */
export const ORDER_CHANGE_STATUSES = ["awaiting_payment", "pending_confirmation", "adjusting", "applied", "rejected", "expired", "failed", "cancelled"] as const;
export type OrderChangeStatus = (typeof ORDER_CHANGE_STATUSES)[number];

const CHANGE_TRANSITIONS: Readonly<Record<OrderChangeStatus, readonly OrderChangeStatus[]>> = {
  awaiting_payment: ["pending_confirmation", "failed", "cancelled"],
  pending_confirmation: ["adjusting", "applied", "rejected", "expired", "cancelled"],
  adjusting: ["applied", "rejected", "expired", "cancelled"],
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
  return status === "awaiting_payment" || status === "pending_confirmation" || status === "adjusting";
}

/** 等供应商处理的两种状态：同意、拒绝只对它们。 */
export function orderChangeDecidable(status: OrderChangeStatus): boolean {
  return status === "pending_confirmation" || status === "adjusting";
}

/** 订单走到这个状态之后，这次改单还适用吗（和 `orderChangeRefusal` 同一套）。 */
export function orderChangeStillApplicable(orderStatus: OrderStatus, fields: readonly string[]): boolean {
  const trip = fields.some((field) => field === "service_time" || field === "passengers" || field === "luggage");
  return (trip ? TRIP_STATUSES : DETAIL_STATUSES).includes(orderStatus);
}

/** 判断能不能因为修改没被确认免费取消要用到的事实。 */
export interface UnconfirmedChangeFacts {
  status: OrderChangeStatus;
  before: Readonly<Record<string, unknown>>;
  after: Readonly<Record<string, unknown>>;
  requestedAt: Date;
}

/** 能按「修改没确认」免费取消的订单状态：司机已出发、已到达不给，服务开始、完成本来就取消不了。 */
const FREE_CANCEL_ORDER_STATUSES: readonly OrderStatus[] = ["confirmed", "assigned"];

/**
 * 客人能不能按 `CHANGE_NOT_CONFIRMED` 免费取消（ADR 0060，协调人按业主原话和第五轮决策定）。**这条规则只在这里**，放宽改这一个函数。同时满足才免费：
 * 1. 最近一次要确认的申请（按提出的先后；没扣到差价的、作废的不算）被拒或没确认，之后没有生效的修改；
 * 2. 这条申请改了日期或时间；
 * 3. 提出时距离当时的用车时间不足 24 小时（正好 24 小时不算）；
 * 4. 订单现在还是已确认、已派车。司机出发后定时任务把申请记成「不再适用」的也靠这一条挡住：订单不会再回到这两个状态。
 * 其余一律按现有阶梯。
 */
export function freeCancelAfterUnconfirmedChange(orderStatus: OrderStatus, changes: readonly UnconfirmedChangeFacts[]): boolean {
  if (!FREE_CANCEL_ORDER_STATUSES.includes(orderStatus)) return false;
  const last = [...changes].reverse().find((change) => changeFieldsNeedConfirmation(Object.keys(change.after)) && change.status !== "failed" && change.status !== "cancelled");
  if (last === undefined || (last.status !== "rejected" && last.status !== "expired")) return false;
  if (!Object.hasOwn(last.after, "service_time")) return false;
  const serviceAt = Date.parse(String(last.before["service_time"]));
  return !Number.isNaN(serviceAt) && serviceAt - last.requestedAt.getTime() < ORDER_CHANGE_RULES.confirmWithinHours * HOUR_MS;
}

/** 申请没通过时告诉客人接下来能做什么（只说符合实际的那句，见 notifications.ts 的 `CHANGE_DECLINE_ADVICE`）。这次申请此刻已经记成没通过。 */
export function changeDeclineAdvice(orderStatus: OrderStatus, change: UnconfirmedChangeFacts): "free_cancel" | "policy" | "started" {
  if (freeCancelAfterUnconfirmedChange(orderStatus, [change])) return "free_cancel";
  return (CANCELLABLE_STATUSES as readonly string[]).includes(orderStatus) ? "policy" : "started";
}

/** 供应商后台的待办种类（ADR 0060）。`change_request` 要做决定，有结论时系统关；其余看过点「知道了」。 */
export const ORDER_TODO_KINDS = ["change_request", "contact_changed", "change_applied", "change_expired", "order_cancelled", "rescue_started"] as const;
export type OrderTodoKind = (typeof ORDER_TODO_KINDS)[number];

/** 用车时间过了这么多天还没点「知道了」的不再计入（要决定的除外），角标不会只增不减。 */
export const ORDER_TODO_STALE_DAYS = 3;

/** 改期之后对外价的差：正数补收、负数退回、0 不动。 */
export function priceDifference(oldMinor: number, newMinor: number): { kind: "charge" | "refund" | "none"; amountMinor: number } {
  const diff = newMinor - oldMinor;
  if (diff === 0) return { kind: "none", amountMinor: 0 };
  return diff > 0 ? { kind: "charge", amountMinor: diff } : { kind: "refund", amountMinor: -diff };
}
