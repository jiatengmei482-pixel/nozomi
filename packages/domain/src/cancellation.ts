/**
 * 平台统一取消政策（M3-03，ADR 0029）。纯函数，不碰数据库和网络。
 *
 * 需求：《平台运营端与渠道对接》「履约保障与服务标准 · 平台统一取消政策」（按品类和车型级别统一，租户商品里只读；
 * 扣款按同一比例拆：租户得结算价 × 扣款比例，平台得加价 × 扣款比例；平台或租户原因、航班取消（有证明）、不可抗力导致的取消一律免费）、
 * 「订单中心 · 人工介入」（代取消，可选「免收取消费」，需填原因）、「敏感操作双人复核」（人工退款超过阈值）；
 * 《用车报价服务平台》「3. 商品 · ② 服务规则」（取消规则：阶梯「出发前 N 小时以前取消 → 扣款 M%」，第五轮起由平台统一设置，租户只读）；第五轮决策 ④。
 *
 * 时间一律按时刻（毫秒）算「距用车还有多久」，不看当地日期：跨午夜、跨时区、夏令时切换都不影响（取消的那一刻离用车的那一刻差多少毫秒就是多少）。
 * 金额是最小货币单位整数，比例是基点（规则 3），四舍五入用 money.ts。
 */
import type { ServiceCategory } from "./master-data.ts";
import { SERVICE_CATEGORIES, type VehicleGrade } from "./master-data.ts";
import { portionBasisPoints } from "./money.ts";

// ---- 车型级别 ----

/**
 * 取消政策用的车型级别：主数据车型组的四个等级，加上「中巴」。需求的表里「中巴」和商务、豪华并列，但主数据的车型组没有「中巴」这个等级，
 * 所以按座位数判断：10 座及以上（不论等级）算中巴（ADR 0029 待定事项 1）。
 */
export const VEHICLE_LEVELS = ["economy", "comfort", "business", "luxury", "minibus"] as const;
export type VehicleLevel = (typeof VEHICLE_LEVELS)[number];

export const VEHICLE_LEVEL_NAMES: Readonly<Record<VehicleLevel, string>> = {
  economy: "经济",
  comfort: "舒适",
  business: "商务",
  luxury: "豪华",
  minibus: "中巴（10 座及以上）",
};

/** 多少座起算中巴。 */
export const MINIBUS_MIN_SEATS = 10;

export function vehicleLevel(grade: VehicleGrade, seats: number): VehicleLevel {
  return seats >= MINIBUS_MIN_SEATS ? "minibus" : grade;
}

// ---- 政策 ----

/** 阶梯的一档：距用车不少于 `minHoursBefore` 小时取消，扣对外价的 `feeBp`（基点，10000 = 100%）。 */
export interface CancellationTier {
  minHoursBefore: number;
  feeBp: number;
}

/** 一个「品类 × 车型级别」的阶梯：按 `minHoursBefore` 从大到小排，最后一档是 0 小时（到用车时间为止，以及用车时间之后）。 */
export interface CancellationRule {
  category: ServiceCategory;
  level: VehicleLevel;
  tiers: CancellationTier[];
}

/** 整份政策：每个「品类 × 车型级别」正好一条（3 × 5 = 15 条）。 */
export type CancellationPolicy = readonly CancellationRule[];

export const CANCELLATION_RULES = {
  /** 一条阶梯最多几档 */
  maxTiers: 5,
  /** 「距用车多少小时」最大能写多少：30 天 */
  maxHours: 720,
  /** 同一份政策里同时有几个版本在等审核：不限；批准时核对版本，后批的那条会是「已过时」 */
} as const;

const tiers = (free: number, half: number): CancellationTier[] => [
  { minHoursBefore: free, feeBp: 0 },
  { minHoursBefore: half, feeBp: 5_000 },
  { minHoursBefore: 0, feeBp: 10_000 },
];

/**
 * 需求表里的政策（运营还没在后台改过时用它，版本 0）：
 * - 接送机、点对点 · 经济 / 舒适：用车前 ≥ 24 小时免费，6–24 小时扣 50%，< 6 小时扣 100%；
 * - 接送机、点对点 · 商务 / 豪华 / 中巴：≥ 48 小时免费，24–48 小时扣 50%，< 24 小时扣 100%；
 * - 包车（全部车型）：≥ 48 小时免费，24–48 小时扣 50%，< 24 小时扣 100%。
 * 「6–24 小时」两端：正好 24 小时算免费（「≥ 24 小时」），正好 6 小时算 50%。no-show 不是取消，按全额（no-show 审核在 M4-02）。
 */
export const DEFAULT_CANCELLATION_POLICY: CancellationPolicy = SERVICE_CATEGORIES.flatMap((category) =>
  VEHICLE_LEVELS.map((level): CancellationRule => ({ category, level, tiers: category !== "charter" && (level === "economy" || level === "comfort") ? tiers(24, 6) : tiers(48, 24) })),
);

export type CancellationPolicyIssueReason = "MISSING_RULE" | "DUPLICATE_RULE" | "UNKNOWN_RULE" | "TIER_COUNT" | "HOURS_INVALID" | "HOURS_NOT_DESCENDING" | "LAST_TIER_NOT_ZERO" | "FEE_INVALID" | "FEE_DECREASING";

export interface CancellationPolicyIssue {
  path: string;
  reason: CancellationPolicyIssueReason;
}

/**
 * 运营改的政策对不对（空数组 = 对）：
 * - 每个「品类 × 车型级别」正好一条；
 * - 每条 1–5 档，「距用车小时数」是 0–720 的整数、从大到小严格递减，最后一档是 0；
 * - 扣款比例是 0–10000 的整数基点，越接近用车扣得越多（不能比前一档少）——否则客人等到更晚取消反而更便宜。
 */
export function cancellationPolicyIssues(policy: readonly CancellationRule[]): CancellationPolicyIssue[] {
  const issues: CancellationPolicyIssue[] = [];
  const seen = new Set<string>();
  policy.forEach((rule, index) => {
    const key = `${rule.category}|${rule.level}`;
    if (!(SERVICE_CATEGORIES as readonly string[]).includes(rule.category) || !(VEHICLE_LEVELS as readonly string[]).includes(rule.level)) {
      issues.push({ path: `/rules/${index}`, reason: "UNKNOWN_RULE" });
      return;
    }
    if (seen.has(key)) issues.push({ path: `/rules/${index}`, reason: "DUPLICATE_RULE" });
    seen.add(key);
    const list = rule.tiers;
    if (list.length < 1 || list.length > CANCELLATION_RULES.maxTiers) {
      issues.push({ path: `/rules/${index}/tiers`, reason: "TIER_COUNT" });
      return;
    }
    list.forEach((tier, at) => {
      const path = `/rules/${index}/tiers/${at}`;
      if (!Number.isInteger(tier.minHoursBefore) || tier.minHoursBefore < 0 || tier.minHoursBefore > CANCELLATION_RULES.maxHours) issues.push({ path: `${path}/min_hours_before`, reason: "HOURS_INVALID" });
      else if (at > 0 && tier.minHoursBefore >= (list[at - 1] as CancellationTier).minHoursBefore) issues.push({ path: `${path}/min_hours_before`, reason: "HOURS_NOT_DESCENDING" });
      if (!Number.isInteger(tier.feeBp) || tier.feeBp < 0 || tier.feeBp > 10_000) issues.push({ path: `${path}/fee_bp`, reason: "FEE_INVALID" });
      else if (at > 0 && tier.feeBp < (list[at - 1] as CancellationTier).feeBp) issues.push({ path: `${path}/fee_bp`, reason: "FEE_DECREASING" });
    });
    if ((list[list.length - 1] as CancellationTier).minHoursBefore !== 0) issues.push({ path: `/rules/${index}/tiers/${list.length - 1}/min_hours_before`, reason: "LAST_TIER_NOT_ZERO" });
  });
  for (const category of SERVICE_CATEGORIES) {
    for (const level of VEHICLE_LEVELS) if (!seen.has(`${category}|${level}`)) issues.push({ path: "/rules", reason: "MISSING_RULE" });
  }
  return issues;
}

/** 政策里这个「品类 × 车型级别」的阶梯。政策是校验过的，一定找得到。 */
export function cancellationRuleFor(policy: CancellationPolicy, category: ServiceCategory, level: VehicleLevel): CancellationRule {
  const rule = policy.find((entry) => entry.category === category && entry.level === level);
  if (rule === undefined) throw new RangeError(`取消政策里没有 ${category} / ${level}`);
  return rule;
}

/** 两份阶梯是不是一样（运营提交的和现在的一样就不用发起复核）。 */
export function sameCancellationPolicy(a: CancellationPolicy, b: CancellationPolicy): boolean {
  if (a.length !== b.length) return false;
  return a.every((rule) => {
    const other = b.find((entry) => entry.category === rule.category && entry.level === rule.level);
    return other !== undefined && other.tiers.length === rule.tiers.length && other.tiers.every((tier, i) => tier.minHoursBefore === rule.tiers[i]?.minHoursBefore && tier.feeBp === rule.tiers[i]?.feeBp);
  });
}

// ---- 一单的取消 ----

const HOUR_MS = 3_600_000;

export interface CancellationTierMatch {
  /** 第几档（0 起） */
  index: number;
  tier: CancellationTier;
  feeBp: number;
  /** 取消的那一刻离用车还有多少毫秒（已过用车时间为负） */
  msBeforeService: number;
}

/**
 * 在这一刻取消落在哪一档：离用车还有多少毫秒 ≥ 这一档的小时数（按毫秒比较）的第一档。用车时间已过（负数）落在最后一档。
 * 例：免费 ≥ 24 小时、50% 6–24 小时、100% < 6 小时——差 24 小时整免费，差 24 小时少 1 毫秒扣 50%；差 6 小时整扣 50%，少 1 毫秒扣 100%。
 */
export function cancellationTierAt(rule: Pick<CancellationRule, "tiers">, serviceAt: Date, cancelAt: Date): CancellationTierMatch {
  const msBeforeService = serviceAt.getTime() - cancelAt.getTime();
  const index = rule.tiers.findIndex((tier) => msBeforeService >= tier.minHoursBefore * HOUR_MS);
  const at = index === -1 ? rule.tiers.length - 1 : index;
  const tier = rule.tiers[at] as CancellationTier;
  return { index: at, tier, feeBp: tier.feeBp, msBeforeService };
}

/** 这一刻取消是不是免费（还在免费取消期里）。改单的「已进入免费取消期以外只能改航班号和乘客信息」用它。 */
export function inFreeCancellationWindow(rule: Pick<CancellationRule, "tiers">, serviceAt: Date, at: Date): boolean {
  return cancellationTierAt(rule, serviceAt, at).feeBp === 0;
}

/**
 * 订单为什么被取消（ADR 0026 的付款前两种，M3-03 加了付款后的几种）：
 * - `PAYMENT_TIMEOUT` 超时未支付；`PAYMENT_CANCELED` 付款被取消（付款前，没有退款）；
 * - `GUEST_REQUEST` 客人（经渠道，或运营代客人）取消：按阶梯扣款；
 * - `CHANGE_NOT_CONFIRMED` 改期没有得到供应商确认（拒绝或 30 分钟内没确认）后客人取消：免费（需求「改单补充」）；
 * - `FLIGHT_CANCELLED` 航班取消（有证明）、`FORCE_MAJEURE` 不可抗力、`SUPPLIER_FAULT` 供应商原因、`PLATFORM_FAULT` 平台原因：免费（只有运营能选）。
 */
export const ORDER_CANCEL_REASONS = ["PAYMENT_TIMEOUT", "PAYMENT_CANCELED", "GUEST_REQUEST", "CHANGE_NOT_CONFIRMED", "FLIGHT_CANCELLED", "FORCE_MAJEURE", "SUPPLIER_FAULT", "PLATFORM_FAULT"] as const;
export type OrderCancelReason = (typeof ORDER_CANCEL_REASONS)[number];

export const ORDER_CANCEL_REASON_NAMES: Readonly<Record<OrderCancelReason, string>> = {
  PAYMENT_TIMEOUT: "超时未支付，系统自动取消",
  PAYMENT_CANCELED: "付款被取消",
  GUEST_REQUEST: "客人取消（按取消政策扣款）",
  CHANGE_NOT_CONFIRMED: "改期没有得到供应商确认，客人免费取消",
  FLIGHT_CANCELLED: "航班取消（有证明），免费取消",
  FORCE_MAJEURE: "不可抗力，免费取消",
  SUPPLIER_FAULT: "供应商原因，免费取消",
  PLATFORM_FAULT: "平台原因，免费取消",
};

/** 一律免费的原因（需求「平台或租户原因、航班取消（有证明）、不可抗力导致的取消一律免费」「改单补充」）。 */
export const FREE_CANCEL_REASONS: readonly OrderCancelReason[] = ["CHANGE_NOT_CONFIRMED", "FLIGHT_CANCELLED", "FORCE_MAJEURE", "SUPPLIER_FAULT", "PLATFORM_FAULT"];

/** 只有运营能选的原因（要人判断：证明、不可抗力、责任方）。 */
export const PLATFORM_ONLY_CANCEL_REASONS: readonly OrderCancelReason[] = ["FLIGHT_CANCELLED", "FORCE_MAJEURE", "SUPPLIER_FAULT", "PLATFORM_FAULT"];

/** 付款后还能取消的状态：服务开始（接到客人）之前。救援改派中的也可以（无人可接时全额退款，M3-04）。 */
export const CANCELLABLE_STATUSES = ["pending_payment", "confirmed", "assigned", "departed", "arrived", "rescue_pending"] as const;

export interface CancellationAmounts {
  feeBp: number;
  /** 客人被扣的取消费（客人支付币种）= 对外价 × 扣款比例，四舍五入 */
  customerFeeMinor: number;
  /** 退给客人的钱 = 对外价 − 取消费（两者相加正好是对外价，不会因为四舍五入多退或少退 1） */
  refundMinor: number;
  /** 供应商应得（结算币种）= 结算价 × 扣款比例，四舍五入 */
  tenantShareMinor: number;
}

/**
 * 按同一比例拆（需求「扣款按同一比例拆：租户得结算价 × 扣款比例，平台得加价 × 扣款比例」）：
 * 客人付的对外价里扣 M%，其中结算价 × M% 给供应商，余下（加价 × M%）是平台的。免费取消 M = 0：全额退、供应商 0。
 */
export function cancellationAmounts(input: { sellMinor: number; settlementMinor: number; feeBp: number }): CancellationAmounts {
  if (!Number.isInteger(input.feeBp) || input.feeBp < 0 || input.feeBp > 10_000) throw new RangeError(`扣款比例必须是 0 到 10000 的整数基点：${input.feeBp}`);
  const customerFeeMinor = portionBasisPoints(input.sellMinor, input.feeBp);
  return { feeBp: input.feeBp, customerFeeMinor, refundMinor: input.sellMinor - customerFeeMinor, tenantShareMinor: portionBasisPoints(input.settlementMinor, input.feeBp) };
}

/**
 * 运营代取消时要不要双人复核（需求「敏感操作双人复核：人工退款超过阈值」）：退给客人的比按阶梯算的多（免收取消费、选了免费的原因）就要。
 * 阈值需求没给，先按 0（多退一分钱也要第二个人批准；ADR 0029 待定事项 3）。
 */
export const MANUAL_REFUND_REVIEW_THRESHOLD_MINOR = 0;

export function cancellationNeedsReview(policyRefundMinor: number, refundMinor: number): boolean {
  return refundMinor - policyRefundMinor > MANUAL_REFUND_REVIEW_THRESHOLD_MINOR;
}

// ---- 退款 ----

/**
 * 一笔退款（在收款服务那边的一次 refund）：
 * `pending` 等着发给收款服务；`processing` 正在发（或收款服务说还在处理）；`succeeded` 退好了；`failed` 失败（重试用完、或收款服务明确拒绝，等财务处理）。
 */
export const REFUND_STATUSES = ["pending", "processing", "succeeded", "failed"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

const REFUND_TRANSITIONS: Readonly<Record<RefundStatus, readonly RefundStatus[]>> = {
  pending: ["processing"],
  // 收款服务出错（超时、连不上）回到 pending 等下一次；明确的结果是退好了或失败
  processing: ["pending", "succeeded", "failed"],
  // 财务处理后可以手动重试
  failed: ["processing"],
  succeeded: [],
};

export function refundTransitionAllowed(from: RefundStatus, to: RefundStatus): boolean {
  return REFUND_TRANSITIONS[from].includes(to);
}

export const REFUND_RULES = {
  /** 收款服务出错时自动重试几次（之后记为失败，等财务处理） */
  maxAttempts: 5,
  /** 第 n 次失败后隔多久再试（分钟） */
  retryMinutes: [1, 5, 30, 120, 360],
  /** 「正在发」的租约：进程中途退出时，过了这个时间别的实例接着发（同一个幂等键，不会退两次） */
  leaseSeconds: 120,
} as const;

/** 第 `attempts` 次失败之后下一次什么时候试；次数用完返回 null。 */
export function nextRefundAttemptAt(attempts: number, now: Date): Date | null {
  if (attempts >= REFUND_RULES.maxAttempts) return null;
  const minutes = REFUND_RULES.retryMinutes[Math.max(0, attempts - 1)] ?? (REFUND_RULES.retryMinutes[REFUND_RULES.retryMinutes.length - 1] as number);
  return new Date(now.getTime() + minutes * 60_000);
}

/** 一笔已收的钱（下单付款、改单补收的差价）：还能退多少。 */
export interface RefundableCharge {
  paymentId: string;
  /** 收到的 */
  amountMinor: number;
  /** 已经退了的和正在退的 */
  refundedMinor: number;
}

/**
 * 退一笔钱要从哪几笔已收的钱里退（收款服务的退款只能对着某一笔付款，且不能超过那一笔）：从最近收的那一笔开始退。
 * 例：下单付 20,000，改单补收 2,000，取消退 22,000 → 先退补收的 2,000，再退下单的 20,000。可退的不够时抛 RangeError（调用方保证不会多退）。
 */
export function allocateRefund(charges: readonly RefundableCharge[], amountMinor: number): { paymentId: string; amountMinor: number }[] {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) throw new RangeError(`退款金额必须是非负整数：${amountMinor}`);
  let left = amountMinor;
  const parts: { paymentId: string; amountMinor: number }[] = [];
  for (const charge of [...charges].reverse()) {
    if (left === 0) break;
    const available = charge.amountMinor - charge.refundedMinor;
    if (available <= 0) continue;
    const take = Math.min(available, left);
    parts.push({ paymentId: charge.paymentId, amountMinor: take });
    left -= take;
  }
  if (left > 0) throw new RangeError(`可退的钱不够：还差 ${left}`);
  return parts;
}

/**
 * 退款之后客人至少要留下多少（客人支付币种）：没取消的单是现在的对外价；取消了的是取消费（对外价 × 取消时的扣款比例；没有扣款比例的按 0）。
 * 工单判定的赔付要从收款里退（M4-02，ADR 0034）：再减去这一单该退的赔付合计（`compensatedMinor`），不低于 0。
 * 「实际付了的」（下单付款 + 改期补收 − 已退和正在退的，失败的不算已退）减去任何一笔退款之后都不能少于它。
 */
export function retainedAfterRefundsMinor(order: { cancelled: boolean; sellMinor: number; cancelFeeBp: number | null; compensatedMinor?: number }): number {
  const base = !order.cancelled ? order.sellMinor : order.cancelFeeBp === null ? 0 : portionBasisPoints(order.sellMinor, order.cancelFeeBp);
  return Math.max(0, base - (order.compensatedMinor ?? 0));
}

/**
 * 财务手动重试一笔失败的退款前的核对（ADR 0029「补充：钱的口径与审核时机」）：
 * - `SUPERSEDED`：取消时的退款已经把这一笔包含进去了（取消按「实际付了的」退，失败的退款不算已退），再退就是多退；
 * - `EXCEEDS_PAID`：重试之后「实际付了的」会少于应留下的（`retainedAfterRefundsMinor`），或者超过了这一笔收款还能退的。
 * 可以重试返回 null。
 */
export type RefundRetryRefusal = "SUPERSEDED" | "EXCEEDS_PAID";

export function refundRetryRefusal(input: { superseded: boolean; amountMinor: number; netPaidMinor: number; paymentAvailableMinor: number; retainedMinor: number }): RefundRetryRefusal | null {
  if (input.superseded) return "SUPERSEDED";
  if (input.amountMinor > input.paymentAvailableMinor || input.netPaidMinor - input.amountMinor < input.retainedMinor) return "EXCEEDS_PAID";
  return null;
}
