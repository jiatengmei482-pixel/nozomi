/**
 * 救援改派与违约金（M3-04，ADR 0031）。纯函数，不碰数据库和网络。
 *
 * 需求：《平台运营端与渠道对接》「履约保障与服务标准」（4 种触发情形、违约金阶梯 0 / 30% / 100%、救援差价、不可抗力免违约金、救援流程）、
 * 「订单中心 · 异常队列」（超时未派车：用车前 6 小时仍未派车自动进入救援；司机未到达：到点 15 分钟仍未到达且联系不上，启动救援）、
 * 「人工介入能力」（救援改派只在 4 种情形下可用，客人价格不变）、「财务结算 · 一单的账务分录」（履约失败：应付租户 − 结算价 − 违约金）；
 * 第五轮决策 ①（平时不改派；4 种情形启动救援改派，客人价格不变，差价和违约金 0 / 30% / 100% 由原租户承担）。
 */
import { dispatchDeadline, dispatchEscalationAt } from "./dispatch.ts";
import { rateToFraction } from "./fx.ts";
import { type CurrencyCode, minorDigits, portionBasisPoints, roundFractionHalfAwayFromZero } from "./money.ts";
import type { OrderStatus } from "./orders.ts";
import type { FxQuote } from "./quote.ts";
import { type TenantStatus, tenantBids } from "./tenants.ts";

const HOUR = 3_600_000;
const MINUTE = 60_000;

export const RESCUE_RULES = {
  /** 用车前至少多少小时声明无法履约：不收违约金（只承担救援差价） */
  noPenaltyHoursBefore: 24,
  /** 用车前至少多少小时（不到 24 小时）声明：原结算价 30%；再晚 100% */
  partialPenaltyHoursBefore: 2,
  partialPenaltyBp: 3_000,
  fullPenaltyBp: 10_000,
  /** 司机未到：用车时间（接机按实际落地时间，晚于用车时间时）之后多少分钟仍未「已到达」 */
  driverLateMinutes: 15,
  /** 救援单多久不接就顺延下一家；用车前 2 小时内缩短为 5 分钟 */
  offerMinutes: 15,
  shortOfferMinutes: 5,
  shortOfferWithinHours: 2,
  /** 改派给救援供应商之后，派车截止时间至少留多少分钟（司机未到这类到点之后才改派的单，按普通规则截止时间已经过了） */
  rescuedDispatchMinutes: 30,
  /**
   * 改派给救援供应商之后，「到点」最早从改派后多少分钟起算（再过 15 分钟仍未到达才算司机未到）：
   * 派车截止至少留 30 分钟，司机接单后还要赶到上车点，再给 30 分钟。到点之后才改派的单不至于一接手就被当成司机未到。
   */
  rescuedArrivalMinutes: 60,
  /** 声明无法履约、不可抗力说明、人工指定说明的最大长度 */
  noteMaxLength: 500,
} as const;

// ---- 触发情形 ----

/**
 * 4 种触发情形（需求「触发情形与违约金阶梯」）：
 * - `tenant_declared` 供应商在后台或经接口声明无法履约（必须写原因）；
 * - `dispatch_overdue` 用车前 6 小时仍未派车（系统定时任务自动触发）；
 * - `driver_no_show` 司机未到：到点 15 分钟仍未「已到达」且联系不上（系统提醒、客人反馈之后由运营判定）；
 * - `tenant_suspended` 供应商被暂停或清退、名下还有未来订单（运营批量发起）。
 */
export const RESCUE_TRIGGERS = ["tenant_declared", "dispatch_overdue", "driver_no_show", "tenant_suspended"] as const;
export type RescueTrigger = (typeof RESCUE_TRIGGERS)[number];

export const RESCUE_TRIGGER_NAMES: Readonly<Record<RescueTrigger, string>> = {
  tenant_declared: "供应商声明无法履约",
  dispatch_overdue: "用车前 6 小时仍未派车",
  driver_no_show: "司机未到",
  tenant_suspended: "供应商被暂停",
};

/** 每种情形能从哪些订单状态触发（都在服务开始之前：司机到了上车点就不是「无法履约」）。 */
export const RESCUE_TRIGGER_STATUSES: Readonly<Record<RescueTrigger, readonly OrderStatus[]>> = {
  tenant_declared: ["confirmed", "assigned", "departed"],
  // 只看还没派车的：派了车就不是「未派车」
  dispatch_overdue: ["confirmed"],
  driver_no_show: ["confirmed", "assigned", "departed"],
  tenant_suspended: ["confirmed", "assigned", "departed"],
};

/**
 * 「用车前 6 小时仍未派车」从什么时候起自动触发：用车前 6 小时，但不早于派车截止时间。
 * 付款时离用车已不足 6 小时的单，派车截止时间是付款后 2 小时（ADR 0027）——不能一付款就判它「未派车」。
 */
export function dispatchRescueDueAt(serviceAt: Date, dispatchDueAt: Date): Date {
  return new Date(Math.max(dispatchEscalationAt(serviceAt).getTime(), dispatchDueAt.getTime()));
}

/**
 * 「司机未到」从什么时候起成立：到点 15 分钟（含那一刻）仍未「已到达」。
 * 「到点」是用车时间；接机的航班晚点、已经取定了比用车时间晚的实际落地时间时，从落地时间算（免费等待也从落地起算，ADR 0027）。
 * 改派给救援供应商的那一行（`rescuedAt` 是改派生效的时刻），「到点」不早于改派后 60 分钟（派车和赶到上车点的时间）。
 */
export function driverLateAt(serviceAt: Date, landedAt: Date | null, rescuedAt: Date | null = null): Date {
  const reference = Math.max(
    serviceAt.getTime(),
    landedAt === null ? serviceAt.getTime() : landedAt.getTime(),
    rescuedAt === null ? serviceAt.getTime() : rescuedAt.getTime() + RESCUE_RULES.rescuedArrivalMinutes * MINUTE,
  );
  return new Date(reference + RESCUE_RULES.driverLateMinutes * MINUTE);
}

export interface RescueTriggerFacts {
  status: OrderStatus;
  serviceAt: Date;
  /** 派车截止时间（付款确认时算好的） */
  dispatchDueAt: Date | null;
  /** 接机已取定的实际落地时间 */
  landedAt: Date | null;
  /** 这一行是改派转来的：改派生效的时刻（救援供应商接手的时候）；不是转来的为 null 或不填 */
  rescuedAt?: Date | null;
  /** 原供应商现在是不是暂停（或清退）中 */
  tenantSuspended: boolean;
  now: Date;
}

/** 为什么不能按这种情形触发：状态不对、时间还没到、供应商没有被暂停、用车时间已过（暂停的只救未来订单）。 */
export type RescueTriggerRefusal = "ORDER_STATE_INVALID" | "TOO_EARLY" | "TENANT_NOT_SUSPENDED" | "SERVICE_TIME_PASSED";

export function rescueTriggerRefusal(trigger: RescueTrigger, facts: RescueTriggerFacts): RescueTriggerRefusal | null {
  if (!RESCUE_TRIGGER_STATUSES[trigger].includes(facts.status)) return "ORDER_STATE_INVALID";
  const now = facts.now.getTime();
  switch (trigger) {
    case "tenant_declared":
      return null;
    case "dispatch_overdue":
      if (facts.dispatchDueAt === null) return "ORDER_STATE_INVALID";
      return now >= dispatchRescueDueAt(facts.serviceAt, facts.dispatchDueAt).getTime() ? null : "TOO_EARLY";
    case "driver_no_show":
      return now >= driverLateAt(facts.serviceAt, facts.landedAt, facts.rescuedAt ?? null).getTime() ? null : "TOO_EARLY";
    case "tenant_suspended":
      if (!facts.tenantSuspended) return "TENANT_NOT_SUSPENDED";
      return facts.serviceAt.getTime() > now ? null : "SERVICE_TIME_PASSED";
  }
}

/**
 * 「供应商被暂停或解约」这种情形认哪些状态（ADR 0028 的状态机）：暂停中（不管有几个暂停原因）、已清退。
 * 观察期只是试运营 / 正式身上的标记，不是暂停，不能按这种情形救援。
 */
export function tenantOutOfService(status: TenantStatus): boolean {
  return status === "suspended" || status === "terminated";
}

/** 能接救援单、能被人工指定的供应商：和参加比价同一个条件（试运营、正式；观察期照样可以）。 */
export function tenantCanRescue(status: TenantStatus): boolean {
  return tenantBids(status);
}

// ---- 违约金 ----

export const PENALTY_TIERS = ["none", "partial", "full"] as const;
export type PenaltyTier = (typeof PENALTY_TIERS)[number];

export interface RescuePenalty {
  tier: PenaltyTier;
  /** 违约金比例（基点），基数是原结算价 */
  bp: number;
  /** 触发时离用车还有多少毫秒（用车时间之后为负） */
  msBeforeService: number;
}

/** 按距用车时间套阶梯：≥ 24 小时 0；2–24 小时 30%；< 2 小时 100%。按毫秒比较，正好等于边界算宽松的那一档。 */
function penaltyByLeadTime(msBeforeService: number): Pick<RescuePenalty, "tier" | "bp"> {
  if (msBeforeService >= RESCUE_RULES.noPenaltyHoursBefore * HOUR) return { tier: "none", bp: 0 };
  if (msBeforeService >= RESCUE_RULES.partialPenaltyHoursBefore * HOUR) return { tier: "partial", bp: RESCUE_RULES.partialPenaltyBp };
  return { tier: "full", bp: RESCUE_RULES.fullPenaltyBp };
}

/**
 * 违约金阶梯（需求表原文）：
 * - 供应商声明无法履约：用车前 ≥ 24 小时 0；2–24 小时 30%；< 2 小时 100%（正好 24 小时算 0，正好 2 小时算 30%，按毫秒）；
 * - 用车前 6 小时仍未派车：100%；
 * - 司机未到：100%（另加报销金额——报销在投诉 / 赔付任务里记）；
 * - 供应商被暂停或清退：按触发时距用车时间套用前 3 行（即和声明一样的阶梯）。
 */
export function rescuePenalty(trigger: RescueTrigger, serviceAt: Date, triggeredAt: Date): RescuePenalty {
  const msBeforeService = serviceAt.getTime() - triggeredAt.getTime();
  if (trigger === "dispatch_overdue" || trigger === "driver_no_show") return { tier: "full", bp: RESCUE_RULES.fullPenaltyBp, msBeforeService };
  return { ...penaltyByLeadTime(msBeforeService), msBeforeService };
}

/** 违约金金额 = 原结算价 × 比例（结算币种的最小单位，四舍五入）。 */
export function rescuePenaltyMinor(settlementMinor: number, bp: number): number {
  if (!Number.isInteger(bp) || bp < 0 || bp > 10_000) throw new RangeError(`违约金比例必须是 0 到 10000 的整数基点：${bp}`);
  return portionBasisPoints(settlementMinor, bp);
}

// ---- 救援差价 ----

export interface RescueDifferenceInput {
  /** 原结算价（原供应商的结算币种） */
  originalMinor: number;
  originalCurrency: CurrencyCode;
  /** 原订单快照里的汇率：原结算币种 → 客人支付币种；同币种为 null */
  originalFx: Pick<FxQuote, "from" | "to" | "rate"> | null;
  /** 救援供应商的结算价（它的结算币种） */
  rescueMinor: number;
  rescueCurrency: CurrencyCode;
  /** 救援报价快照里的汇率：救援结算币种 → 客人支付币种；同币种为 null */
  rescueFx: Pick<FxQuote, "from" | "to" | "rate"> | null;
  /** 客人支付的币种（两边的快照汇率都换到它） */
  customerCurrency: CurrencyCode;
}

export type RescueDifference =
  | {
      ok: true;
      /** 原供应商承担的差价（原结算币种的最小单位）：为负时记 0 */
      minor: number;
      /** 没有截到 0 之前的差（四舍五入后的整数，可以为负），对账用 */
      rawMinor: number;
      /** 救援结算价换到原结算币种的金额（四舍五入，只用于显示）；同币种就是救援结算价 */
      rescueInOriginalMinor: number;
    }
  | { ok: false; reason: "FX_RATE_UNAVAILABLE" };

interface Fraction {
  numerator: bigint;
  denominator: bigint;
}

/** 结算币种 → 客人支付币种的汇率（精确分数，主单位之比）；同币种为 1；要换却没有对得上的汇率为 null。 */
function rateToCustomer(currency: CurrencyCode, fx: RescueDifferenceInput["originalFx"], customer: CurrencyCode): Fraction | null {
  if (currency === customer) return { numerator: 1n, denominator: 1n };
  if (fx === null || fx.from !== currency || fx.to !== customer) return null;
  return rateToFraction(fx.rate);
}

/**
 * 救援差价 = 救援租户结算价 − 原结算价（按快照汇率换算，为负时记 0）。
 * 两边不同币种时：救援结算价按**救援报价快照**的汇率换到客人支付的币种，再按**原订单快照**的汇率换回原结算币种——
 * 两个汇率都是各自报价时记下的，不用现在的汇率（需求「按快照汇率换算」）。全程精确分数，只在最后四舍五入一次（0.5 远离零），
 * 和报价引擎一样不经过浮点数。同币种时直接相减。
 */
export function rescueDifference(input: RescueDifferenceInput): RescueDifference {
  if (input.rescueCurrency === input.originalCurrency) {
    const raw = input.rescueMinor - input.originalMinor;
    return { ok: true, minor: Math.max(0, raw), rawMinor: raw, rescueInOriginalMinor: input.rescueMinor };
  }
  const rescueRate = rateToCustomer(input.rescueCurrency, input.rescueFx, input.customerCurrency);
  const originalRate = rateToCustomer(input.originalCurrency, input.originalFx, input.customerCurrency);
  if (rescueRate === null || originalRate === null) return { ok: false, reason: "FX_RATE_UNAVAILABLE" };
  // 救援结算价（最小单位）→ 主单位 → × 救援汇率 → ÷ 原汇率 → 原结算币种的最小单位
  const numerator = BigInt(input.rescueMinor) * rescueRate.numerator * originalRate.denominator * 10n ** BigInt(minorDigits(input.originalCurrency));
  const denominator = rescueRate.denominator * originalRate.numerator * 10n ** BigInt(minorDigits(input.rescueCurrency));
  const rawExact = numerator - BigInt(input.originalMinor) * denominator;
  const raw = Number(roundFractionHalfAwayFromZero(rawExact, denominator));
  const converted = Number(roundFractionHalfAwayFromZero(numerator, denominator));
  if (!Number.isSafeInteger(raw) || !Number.isSafeInteger(converted)) throw new RangeError("救援差价超出了安全整数范围");
  return { ok: true, minor: Math.max(0, raw), rawMinor: raw, rescueInOriginalMinor: converted };
}

// ---- 救援单 ----

/** 救援单的接单期限：发出后 15 分钟；发出时离用车已不足 2 小时的，5 分钟（正好 2 小时还是 15 分钟）。 */
export function rescueOfferDeadline(offeredAt: Date, serviceAt: Date): Date {
  const short = serviceAt.getTime() - offeredAt.getTime() < RESCUE_RULES.shortOfferWithinHours * HOUR;
  return new Date(offeredAt.getTime() + (short ? RESCUE_RULES.shortOfferMinutes : RESCUE_RULES.offerMinutes) * MINUTE);
}

/**
 * 救援供应商接单后的派车截止时间：按普通订单的规则（确认时间 = 接单时间，ADR 0027），但至少留 30 分钟。
 * 到点之后才改派的单（司机未到）按普通规则截止时间已经过了，不留时间的话定时任务会马上又判它「未派车」再救援一次。
 */
export function rescuedDispatchDeadline(acceptedAt: Date, serviceAt: Date): Date {
  return new Date(Math.max(dispatchDeadline(acceptedAt, serviceAt).getTime(), acceptedAt.getTime() + RESCUE_RULES.rescuedDispatchMinutes * MINUTE));
}

/** 到了期限的那一刻起不能再接（按毫秒）。 */
export function rescueOfferExpired(expiresAt: Date, now: Date): boolean {
  return now.getTime() >= expiresAt.getTime();
}

/**
 * 一次救援的状态：
 * - `open` 待处理：已触发，订单进入「救援改派中」，等运营看候选、发救援单（或认定不可抗力、取消退款）；
 * - `offering` 救援单发出中：有一家候选在接单期限内，不接、拒绝、超时就自动顺延下一家；
 * - `exhausted` 候选都不接（或一个候选都没有）：运营人工指定（双人复核）或取消订单全额退款；
 * - `rescued` 已改派给救援供应商；`cancelled` 订单取消了（无人可接时全额退款、客人自己取消、不可抗力）。
 */
export const RESCUE_STATUSES = ["open", "offering", "exhausted", "rescued", "cancelled"] as const;
export type RescueStatus = (typeof RESCUE_STATUSES)[number];

export const RESCUE_STATUS_NAMES: Readonly<Record<RescueStatus, string>> = {
  open: "待处理",
  offering: "救援单待接",
  exhausted: "候选都不接，待人工处理",
  rescued: "已改派",
  cancelled: "已取消订单",
};

const RESCUE_TRANSITIONS: Readonly<Record<RescueStatus, readonly RescueStatus[]>> = {
  open: ["offering", "exhausted", "rescued", "cancelled"],
  offering: ["exhausted", "rescued", "cancelled"],
  exhausted: ["offering", "rescued", "cancelled"],
  rescued: [],
  cancelled: [],
};

export function rescueTransitionAllowed(from: RescueStatus, to: RescueStatus): boolean {
  return RESCUE_TRANSITIONS[from].includes(to);
}

/** 还没有结论的救援（同一张单同时只能有一个）。 */
export const OPEN_RESCUE_STATUSES: readonly RescueStatus[] = ["open", "offering", "exhausted"];

/** 救援单：`pending` 待接；`accepted` 已接；`declined` 已拒绝；`expired` 超时没接；`withdrawn` 收回（订单取消、人工指定了别家）。 */
export const RESCUE_OFFER_STATUSES = ["pending", "accepted", "declined", "expired", "withdrawn"] as const;
export type RescueOfferStatus = (typeof RESCUE_OFFER_STATUSES)[number];

export const RESCUE_OFFER_STATUS_NAMES: Readonly<Record<RescueOfferStatus, string>> = {
  pending: "待接单",
  accepted: "已接单",
  declined: "已拒绝",
  expired: "超时未接",
  withdrawn: "已收回",
};

// ---- 供应商应扣款项 ----

/** 原供应商的应扣款项：违约金、救援差价。现在只记账，M5 结算时从当期或下一期账单里扣。 */
export const DEDUCTION_KINDS = ["penalty", "rescue_difference"] as const;
export type DeductionKind = (typeof DEDUCTION_KINDS)[number];

export const DEDUCTION_KIND_NAMES: Readonly<Record<DeductionKind, string>> = {
  penalty: "违约金",
  rescue_difference: "救援差价",
};

/** `pending` 待结算时扣；`waived` 不可抗力免除。M5 结算时加「已扣」。 */
export const DEDUCTION_STATUSES = ["pending", "waived"] as const;
export type DeductionStatus = (typeof DEDUCTION_STATUSES)[number];

export const DEDUCTION_STATUS_NAMES: Readonly<Record<DeductionStatus, string>> = {
  pending: "待结算时扣除",
  waived: "不可抗力，已免除",
};
