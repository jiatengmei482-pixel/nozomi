/**
 * 客人赔付表（M4-02，ADR 0034）。纯函数，不碰数据库和网络。
 *
 * 需求：《平台运营端与渠道对接》「履约保障与服务标准 · 客人赔付表」（投诉成立时自动带出金额；每笔赔付至少等值 ¥500，由平台先付给客人；
 * 租户按同一比例乘以结算价承担，加价部分由平台承担；司机未到的报销金额全部由租户承担；租户免费升级车型不算违规；投诉时限：服务后 14 天内）、
 * 「客服与工单」（成立时选赔付方式；赔付按责任方扣款；判定金额超过阈值需主管复核）、「第五轮新增接口」（`GET /platform/v1/compensation-table`，赔付表可配置）。
 * 文末决策：第五轮 ⑥「统一赔付表；租户按结算价同比例承担」。
 *
 * 金额一律是最小货币单位整数，比例是基点（规则 3），取整走 money.ts（四舍五入，0.5 远离零；「至少等值 ¥500」换币种时向上取整，保证不少于）。
 * 换币种只用快照里的汇率：订单报价快照的「结算币种 → 客人支付币种」，以及判定时从汇率中心取的「JPY → 客人支付币种」（记进赔付记录）。
 */
import { type CurrencyCode, ceilFractionToUnit, minorDigits, portionBasisPoints, roundFractionHalfAwayFromZero } from "./money.ts";
import { type FxQuote, rateFraction, sellPrice } from "./quote.ts";

// ---- 赔付情形 ----

/** 赔付表里的问题（需求原表的 7 行）。 */
export const COMPENSATION_SCENARIOS = ["late_15_29", "late_30_plus", "driver_no_show", "vehicle_downgrade", "no_signboard", "not_delivered", "service_complaint"] as const;
export type CompensationScenario = (typeof COMPENSATION_SCENARIOS)[number];

export const COMPENSATION_SCENARIO_NAMES: Readonly<Record<CompensationScenario, string>> = {
  late_15_29: "司机迟到 15–29 分钟",
  late_30_plus: "司机迟到 30 分钟及以上",
  driver_no_show: "司机未到",
  vehicle_downgrade: "车型降级",
  no_signboard: "未举牌（商品含举牌）",
  not_delivered: "没送到目的地",
  service_complaint: "车况、司机态度投诉成立",
};

/**
 * 每种问题的固定做法（不随配置变）：
 * - `fullRefund`：司机未到——客人这一单付的钱全部退回（不是按比例），另加凭票报销替代交通；
 * - `downgradeDifference`：车型降级——按比例之外再赔差价；
 * - `failureType`：成立时记一次履约失败（评分输入，ADR 0028）：司机未到、迟到 30 分钟及以上（重大迟到）。
 */
export const COMPENSATION_SCENARIO_RULES: Readonly<Record<CompensationScenario, { fullRefund: boolean; reimbursement: boolean; downgradeDifference: boolean; failureType: "driver_no_show" | "major_delay" | null }>> = {
  late_15_29: { fullRefund: false, reimbursement: false, downgradeDifference: false, failureType: null },
  late_30_plus: { fullRefund: false, reimbursement: false, downgradeDifference: false, failureType: "major_delay" },
  driver_no_show: { fullRefund: true, reimbursement: true, downgradeDifference: false, failureType: "driver_no_show" },
  vehicle_downgrade: { fullRefund: false, reimbursement: false, downgradeDifference: true, failureType: null },
  no_signboard: { fullRefund: false, reimbursement: false, downgradeDifference: false, failureType: null },
  not_delivered: { fullRefund: false, reimbursement: false, downgradeDifference: false, failureType: null },
  service_complaint: { fullRefund: false, reimbursement: false, downgradeDifference: false, failureType: null },
};

/** 谁承担：租户（按结算价同比例 + 差价 + 报销）或平台（全部由平台承担，租户 0）。 */
export const LIABLE_PARTIES = ["tenant", "platform"] as const;
export type LiableParty = (typeof LIABLE_PARTIES)[number];

// ---- 赔付表（可配置，按版本） ----

/**
 * 一版赔付表：每种问题赔客人对外价的多少（基点）；每笔至少等值多少日元；替代交通报销上限（对外价的倍数，基点）；
 * 赔给客人的钱达到对外价的多少需要第二个人复核（「判定金额超过阈值需主管复核」）。
 * 司机未到是「全额退款」，比例固定 10000，不能改。
 */
export interface CompensationTable {
  /** 0 = 写在这里的默认表（没有人改过）；之后每次批准的修改加一 */
  version: number;
  customerBp: Readonly<Record<CompensationScenario, number>>;
  /** 每笔至少等值多少日元（JPY 的最小单位就是 1 日元） */
  minimumJpy: number;
  /** 替代交通报销上限：订单对外价 × 这个比例 */
  reimbursementCapBp: number;
  /** 赔给客人的钱（不含司机未到时退回的原价）≥ 对外价 × 这个比例时，要第二个人复核 */
  reviewAtOrAboveSellBp: number;
}

/**
 * 默认赔付表（版本 0）：需求原表的数字；复核阈值需求没给，先按对外价的 50%（ADR 0034 待定事项，待负责人确认）。
 * 和取消政策一样只写在这里、不进库（规则 1：迁移不写业务数据）；运营第一次改动批准后存成版本 1。
 */
export const DEFAULT_COMPENSATION_TABLE: CompensationTable = {
  version: 0,
  customerBp: {
    late_15_29: 1000,
    late_30_plus: 5000,
    driver_no_show: 10_000,
    vehicle_downgrade: 2000,
    no_signboard: 1000,
    not_delivered: 2500,
    service_complaint: 1000,
  },
  minimumJpy: 500,
  reimbursementCapBp: 15_000,
  reviewAtOrAboveSellBp: 5000,
};

/** 和赔付有关、但不放进可配置表的时限（需求原文的数字）。 */
export const COMPENSATION_RULES = {
  /** 投诉时限：服务后 14 天内 */
  complaintWindowDays: 14,
  /** 迟到多少分钟起赔（含）、多少分钟起算重大迟到（含） */
  lateMinutesMinor: 15,
  lateMinutesMajor: 30,
  /** 配置的上限：每笔最低额不超过 10 万日元、报销上限不超过对外价的 5 倍（防止填错数量级） */
  maxMinimumJpy: 100_000,
  maxReimbursementCapBp: 50_000,
} as const;

export interface CompensationTableIssue {
  path: string;
  reason: "OUT_OF_RANGE" | "FIXED";
}

/** 一版赔付表合不合规则：比例 0–100%（司机未到固定 100%）；最低额 0–10 万日元；报销上限 0–5 倍；复核阈值 0–100%（0 = 每一笔都复核）。 */
export function compensationTableIssues(table: Omit<CompensationTable, "version">): CompensationTableIssue[] {
  const issues: CompensationTableIssue[] = [];
  const inRange = (value: number, max: number): boolean => Number.isSafeInteger(value) && value >= 0 && value <= max;
  for (const scenario of COMPENSATION_SCENARIOS) {
    const bp = table.customerBp[scenario];
    if (scenario === "driver_no_show") {
      if (bp !== 10_000) issues.push({ path: `/customer_bp/${scenario}`, reason: "FIXED" });
    } else if (!inRange(bp, 10_000)) issues.push({ path: `/customer_bp/${scenario}`, reason: "OUT_OF_RANGE" });
  }
  if (!inRange(table.minimumJpy, COMPENSATION_RULES.maxMinimumJpy)) issues.push({ path: "/minimum_jpy", reason: "OUT_OF_RANGE" });
  if (!inRange(table.reimbursementCapBp, COMPENSATION_RULES.maxReimbursementCapBp)) issues.push({ path: "/reimbursement_cap_bp", reason: "OUT_OF_RANGE" });
  if (!inRange(table.reviewAtOrAboveSellBp, 10_000)) issues.push({ path: "/review_at_or_above_sell_bp", reason: "OUT_OF_RANGE" });
  return issues;
}

/** 两版赔付表的内容一样（不看版本号）：一样的修改不进复核队列。 */
export function sameCompensationTable(a: Omit<CompensationTable, "version">, b: Omit<CompensationTable, "version">): boolean {
  return (
    COMPENSATION_SCENARIOS.every((scenario) => a.customerBp[scenario] === b.customerBp[scenario]) &&
    a.minimumJpy === b.minimumJpy &&
    a.reimbursementCapBp === b.reimbursementCapBp &&
    a.reviewAtOrAboveSellBp === b.reviewAtOrAboveSellBp
  );
}

// ---- 迟到 ----

/** 按迟到的分钟数选赔付情形：不到 15 分钟不赔（null）；15–29 分钟；30 分钟及以上。 */
export function lateScenario(lateMinutes: number): "late_15_29" | "late_30_plus" | null {
  if (!Number.isFinite(lateMinutes) || lateMinutes < COMPENSATION_RULES.lateMinutesMinor) return null;
  return lateMinutes < COMPENSATION_RULES.lateMinutesMajor ? "late_15_29" : "late_30_plus";
}

// ---- 投诉时限 ----

/** 投诉的截止时刻：服务结束后 14 天（正好 14 天还算，按毫秒）。 */
export function complaintDeadline(serviceEndAt: Date): Date {
  return new Date(serviceEndAt.getTime() + COMPENSATION_RULES.complaintWindowDays * 86_400_000);
}

export function complaintWindowOpen(serviceEndAt: Date, now: Date): boolean {
  return now.getTime() <= complaintDeadline(serviceEndAt).getTime();
}

// ---- 最低额 ----

type Rate = Pick<FxQuote, "from" | "to" | "rate">;

/**
 * 「每笔至少等值 ¥500」换到客人支付的币种：JPY 直接是 500；别的币种用判定时汇率中心的「JPY → 该币种」汇率，**向上**取整到最小单位（保证不少于等值）。
 * 要换却没有对得上的汇率返回 null（调用方报 `FX_RATE_UNAVAILABLE`）。
 */
export function minimumCompensationMinor(table: Pick<CompensationTable, "minimumJpy">, currency: CurrencyCode, jpyFx: Rate | null): number | null {
  if (table.minimumJpy === 0) return 0;
  if (currency === "JPY") return table.minimumJpy;
  if (jpyFx === null || jpyFx.from !== "JPY" || jpyFx.to !== currency) return null;
  const rate = rateFraction(jpyFx.rate);
  if (rate === null) return null;
  // 日元（最小单位 = 主单位）× 汇率 → 目标币种的主单位 → × 10^小数位
  return ceilFractionToUnit(BigInt(table.minimumJpy) * rate.numerator * 10n ** BigInt(minorDigits(currency)), rate.denominator, 1);
}

// ---- 一笔赔付 ----

export interface CompensationInput {
  scenario: CompensationScenario;
  liable: LiableParty;
  /** 客人支付的币种、这一单现在的对外价 */
  currency: CurrencyCode;
  sellMinor: number;
  /** 被投诉的供应商那一行的结算价（它的结算币种） */
  settlementMinor: number;
  settlementCurrency: CurrencyCode;
  /** 订单报价快照：加价比例、汇率缓冲、结算币种 → 客人支付币种的汇率（同币种为 null） */
  markupBp: number;
  fxBufferBp: number;
  fx: FxQuote | null;
  /** 「至少等值 ¥500」换到客人支付币种的金额（`minimumCompensationMinor`） */
  minimumMinor: number;
  /** 车型降级：两个车型组的结算价之差（被投诉供应商的结算币种），按订单快照换成客人的差价；其他情形必须为 null */
  downgradeSettlementDifferenceMinor: number | null;
  /** 司机未到：客人凭票申请报销的替代交通（客人支付币种）；其他情形必须为 null */
  reimbursementClaimedMinor: number | null;
  /** 这一单现在还能退给客人的钱（实际付了的 − 已退和正在退的） */
  refundableMinor: number;
  /** 司机未到：这一单的违约金（原结算价 100%）已经按救援记过了（ADR 0031），这里不再按比例扣第二次 */
  settlementShareAlreadyDeducted: boolean;
}

export type CompensationInputIssue = "DOWNGRADE_DIFFERENCE_REQUIRED" | "DOWNGRADE_DIFFERENCE_NOT_ALLOWED" | "REIMBURSEMENT_NOT_ALLOWED" | "AMOUNT_INVALID";

/** 输入对不对得上情形：车型降级必须给差价（正数），其他情形不能给；只有司机未到可以有报销。 */
export function compensationInputIssues(input: Pick<CompensationInput, "scenario" | "downgradeSettlementDifferenceMinor" | "reimbursementClaimedMinor">): CompensationInputIssue[] {
  const rules = COMPENSATION_SCENARIO_RULES[input.scenario];
  const issues: CompensationInputIssue[] = [];
  const diff = input.downgradeSettlementDifferenceMinor;
  if (rules.downgradeDifference && diff === null) issues.push("DOWNGRADE_DIFFERENCE_REQUIRED");
  if (!rules.downgradeDifference && diff !== null) issues.push("DOWNGRADE_DIFFERENCE_NOT_ALLOWED");
  if (!rules.reimbursement && input.reimbursementClaimedMinor !== null) issues.push("REIMBURSEMENT_NOT_ALLOWED");
  const claimed = input.reimbursementClaimedMinor;
  const diffInvalid = diff !== null && (!Number.isSafeInteger(diff) || diff <= 0);
  const claimedInvalid = claimed !== null && (!Number.isSafeInteger(claimed) || claimed < 0);
  if (diffInvalid || claimedInvalid) issues.push("AMOUNT_INVALID");
  return issues;
}

export interface CompensationAmounts {
  scenario: CompensationScenario;
  liable: LiableParty;
  /** 用的赔付表版本、比例 */
  tableVersion: number;
  customerBp: number;
  customer: {
    currency: CurrencyCode;
    /** 对外价 × 比例（司机未到是全额） */
    ratioMinor: number;
    /** 车型降级的差价（客人支付币种：结算价之差 × 快照汇率 ×（1 + 缓冲）×（1 + 加价比例）） */
    downgradeDifferenceMinor: number;
    /** 每笔最低额（客人支付币种） */
    minimumMinor: number;
    /** 按比例 + 差价不到最低额、补到了最低额 */
    toppedUp: boolean;
    /** 赔付额 = max(比例 + 差价, 最低额) */
    compensationMinor: number;
    /** 替代交通报销：客人申请的、上限（对外价 × 上限比例）、实际给的（不超过上限） */
    reimbursementClaimedMinor: number;
    reimbursementCapMinor: number;
    reimbursementMinor: number;
    /**
     * 怎么付给客人：
     * - `refundMinor`：从这一单的收款里退（走收款服务的退款，不超过还能退的）；
     * - `manualPayoutMinor`：退不回去的部分（报销、超过还能退的），由财务另行支付（银行转账等）后登记。
     */
    refundMinor: number;
    manualPayoutMinor: number;
    /** 判断要不要复核用的金额：赔给客人的钱（司机未到时不含退回的原价，只算超出原价的部分和报销） */
    reviewBasisMinor: number;
  };
  /** 供应商承担的（它的结算币种）：比例 × 结算价、车型降级的结算价之差、报销（按快照汇率换成结算币种）。责任在平台时全为 0 */
  tenant: {
    currency: CurrencyCode;
    ratioMinor: number;
    downgradeDifferenceMinor: number;
    reimbursementMinor: number;
    totalMinor: number;
  };
  /** 要第二个人复核 */
  needsReview: boolean;
}

export type CompensationOutcome = { ok: true; amounts: CompensationAmounts } | { ok: false; reason: "FX_RATE_UNAVAILABLE" | CompensationInputIssue };

/** 客人支付币种 → 结算币种（快照汇率的反方向），四舍五入一次。 */
function toSettlement(minor: number, input: Pick<CompensationInput, "currency" | "settlementCurrency" | "fx">): number | null {
  if (input.currency === input.settlementCurrency) return minor;
  const fx = input.fx;
  if (fx === null || fx.from !== input.settlementCurrency || fx.to !== input.currency) return null;
  const rate = rateFraction(fx.rate);
  if (rate === null) return null;
  // 客人最小单位 → 主单位 → ÷ 汇率 → 结算币种主单位 → 最小单位
  const value = roundFractionHalfAwayFromZero(BigInt(minor) * rate.denominator * 10n ** BigInt(minorDigits(input.settlementCurrency)), rate.numerator * 10n ** BigInt(minorDigits(input.currency)));
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new RangeError("报销金额换算后超出了安全整数范围");
  return result;
}

/**
 * 按赔付表算一笔赔付（投诉成立时自动带出金额）。
 *
 * 客人：
 * - 赔付额 = max(对外价 × 比例 + 差价, 等值 ¥500)；司机未到是全额退款（对外价 100%）。
 * - 司机未到另加替代交通报销：不超过对外价 × 1.5（上限比例可配置）。
 * - 付法：普通情形从这一单的收款里退赔付额，退不回去的（超过还能退的）由财务另付；
 *   司机未到把这一单还没退的钱全部退回（已经按取消退过的不再退），超出原价的部分（最低额补足）和报销由财务另付。
 * 供应商（责任在它时）：结算价 × 同一比例（司机未到的违约金已按救援记过时不再记）+ 车型降级的结算价之差 + 报销（按快照汇率换成结算币种）。
 * 平台：其余部分（加价部分、补足的最低额）。
 */
export function compensationAmounts(input: CompensationInput, table: CompensationTable = DEFAULT_COMPENSATION_TABLE): CompensationOutcome {
  const issues = compensationInputIssues(input);
  if (issues.length > 0) return { ok: false, reason: issues[0] as CompensationInputIssue };
  const rules = COMPENSATION_SCENARIO_RULES[input.scenario];
  const bp = table.customerBp[input.scenario];
  const ratioMinor = portionBasisPoints(input.sellMinor, bp);

  let downgradeCustomer = 0;
  const diff = input.downgradeSettlementDifferenceMinor ?? 0;
  if (diff > 0) {
    const price = sellPrice({ settlementMinor: diff, settlementCurrency: input.settlementCurrency, currency: input.currency, markupBp: input.markupBp, markupFloorBp: 0, fxBufferBp: input.fxBufferBp, fx: input.fx });
    if ("failure" in price) return { ok: false, reason: "FX_RATE_UNAVAILABLE" };
    downgradeCustomer = price.sellMinor;
  }

  const byTable = ratioMinor + downgradeCustomer;
  const compensationMinor = Math.max(byTable, input.minimumMinor);
  const claimed = input.reimbursementClaimedMinor ?? 0;
  const capMinor = rules.reimbursement ? portionBasisPoints(input.sellMinor, table.reimbursementCapBp) : 0;
  const reimbursementMinor = Math.min(claimed, capMinor);
  const refundable = Math.max(0, input.refundableMinor);

  let refundMinor: number;
  let manualPayoutMinor: number;
  let reviewBasisMinor: number;
  if (rules.fullRefund) {
    // 全额退款：退回这一单还没退的全部；超出对外价的（最低额补足）和报销另付
    refundMinor = refundable;
    const beyondSell = Math.max(0, compensationMinor - input.sellMinor);
    manualPayoutMinor = beyondSell + reimbursementMinor;
    reviewBasisMinor = beyondSell + reimbursementMinor;
  } else {
    refundMinor = Math.min(compensationMinor, refundable);
    manualPayoutMinor = compensationMinor - refundMinor;
    reviewBasisMinor = compensationMinor;
  }

  let tenant = { currency: input.settlementCurrency, ratioMinor: 0, downgradeDifferenceMinor: 0, reimbursementMinor: 0, totalMinor: 0 };
  if (input.liable === "tenant") {
    const tenantRatio = input.settlementShareAlreadyDeducted ? 0 : portionBasisPoints(input.settlementMinor, bp);
    const tenantReimbursement = reimbursementMinor === 0 ? 0 : toSettlement(reimbursementMinor, input);
    if (tenantReimbursement === null) return { ok: false, reason: "FX_RATE_UNAVAILABLE" };
    tenant = { currency: input.settlementCurrency, ratioMinor: tenantRatio, downgradeDifferenceMinor: diff, reimbursementMinor: tenantReimbursement, totalMinor: tenantRatio + diff + tenantReimbursement };
  }

  return {
    ok: true,
    amounts: {
      scenario: input.scenario,
      liable: input.liable,
      tableVersion: table.version,
      customerBp: bp,
      customer: {
        currency: input.currency,
        ratioMinor,
        downgradeDifferenceMinor: downgradeCustomer,
        minimumMinor: input.minimumMinor,
        toppedUp: compensationMinor > byTable,
        compensationMinor,
        reimbursementClaimedMinor: claimed,
        reimbursementCapMinor: capMinor,
        reimbursementMinor,
        refundMinor,
        manualPayoutMinor,
        reviewBasisMinor,
      },
      tenant,
      needsReview: compensationNeedsReview(reviewBasisMinor, input.sellMinor, table),
    },
  };
}

/** 赔给客人的钱达到对外价 × 阈值（含）要第二个人复核。阈值为 0 时每一笔都复核；赔 0 的不用。 */
export function compensationNeedsReview(reviewBasisMinor: number, sellMinor: number, table: Pick<CompensationTable, "reviewAtOrAboveSellBp">): boolean {
  if (reviewBasisMinor <= 0) return false;
  return BigInt(reviewBasisMinor) * 10_000n >= BigInt(sellMinor) * BigInt(table.reviewAtOrAboveSellBp);
}
