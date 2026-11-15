/**
 * 跨段费用（ADR 0100 第四节第 0–2、4–6 条）：住宿、停驻、第二司机、按次附加项去重、长途返程（只做函数，P1 不接入编排），
 * 以及跨段费用的对外价换算。金额都是商品结算币种的最小单位整数；`calc` 是算式快照，写进 `trip_fees.calc`。
 */
import { type CurrencyCode, roundFractionHalfAwayFromZero } from "../money.ts";
import type { PriceRule } from "../pricing.ts";
import { type FxQuote, sellPrice } from "../quote.ts";
import type { AddonChargeUnit } from "../master-data.ts";
import type { EffectiveTripRules } from "./rules.ts";

export const TRIP_FEE_TYPES = ["lodging", "lodging_offset", "idle", "second_driver", "bundle_discount", "return"] as const;
export type TripFeeType = (typeof TRIP_FEE_TYPES)[number];

export interface TripFeeDraft {
  type: TripFeeType;
  /** 结算价（可为负：抵扣） */
  settlementMinor: number;
  nightIndex: number | null;
  dayIndex: number | null;
  areaId: string | null;
  calc: Record<string, unknown>;
}

/** 最短套餐价（第四节第 0 条）：取哪个①、哪条规则、几小时 */
export interface ShortestPackage {
  minor: number;
  priceRuleId: string | null;
  areaId: string | null;
  packageHours: number;
}

const effectiveOn = (rule: Pick<PriceRule, "validFrom" | "validTo" | "status">, date: string): boolean => rule.status === "enabled" && rule.validFrom <= date && (rule.validTo === null || rule.validTo >= date);

/**
 * 这一商品这一车型组在 `date` 当天最短那档包车套餐的结算价（数据来自这次试算返回的候选商品价格规则）：
 * 先在 `preferAreaIds`（过夜点所在的①）里找；都没有时取这个商品所有①（含不限区域的套餐，`areaId` 为空）里最短档、同档取最便宜。取不到为 null。
 */
export function shortestPackagePrice(rules: readonly (PriceRule & { id?: string })[], input: { vehicleGroupId: string; date: string; preferAreaIds: readonly string[] }): ShortestPackage | null {
  const packages = rules.filter((rule) => rule.pricing.model === "charter_package" && rule.vehicleGroupId === input.vehicleGroupId && rule.packageHours !== null && effectiveOn(rule, input.date));
  const pick = (list: typeof packages): ShortestPackage | null => {
    let best: ShortestPackage | null = null;
    for (const rule of list) {
      const hours = rule.packageHours as number;
      const minor = rule.pricing.model === "charter_package" ? rule.pricing.packagePriceMinor : 0;
      if (best === null || hours < best.packageHours || (hours === best.packageHours && minor < best.minor)) best = { minor, priceRuleId: rule.id ?? null, areaId: rule.areaId, packageHours: hours };
    }
    return best;
  };
  const preferred = pick(packages.filter((rule) => rule.areaId !== null && input.preferAreaIds.includes(rule.areaId)));
  return preferred ?? pick(packages);
}

export interface LodgingInput {
  nightIndex: number;
  /** 第 N 天结束点、第 N+1 天开始点在不在这个商品任一①里 */
  endInBase: boolean;
  nextStartInBase: boolean;
  /** 第 N+1 天还是同一辆车（一车到底且没有换车） */
  sameVehicleNext: boolean;
  /** 过夜点落在本商品哪些区域里（用来匹配 `byArea`） */
  overnightAreaIds: readonly string[];
  /** 客人当晚给司机提供住宿 */
  providedByGuest: boolean;
  /**
   * 第 N 天③下车加价 + 第 N+1 天③上车加价的结算价（调价前，取两段的 `settlement.areaSurcharge`）；
   * 两端都没有③加价（车回不了基地，或过夜点不在③）为 null
   */
  surchargeOffsetMinor: number | null;
}

export interface LodgingResult {
  /** `lodging` = 收住宿（车留在当地）；`return_to_base` = 车回基地（不收住宿、保留③加价）；`none` = 不涉及 */
  choice: "lodging" | "return_to_base" | "none";
  fees: TripFeeDraft[];
  /** 该收住宿却没有可用金额（非日元商品没填） */
  missingPrice: boolean;
}

/**
 * 住宿（3.1、D4 口径，监工 2026-11-15 确认）：第 N 天结束点和第 N+1 天开始点**都不在**①里、次日还是同一辆车 → 一晚住宿；
 * 过夜点落在 `byArea` 的区域取区域金额，否则 `perNightMinor`；客人提供 → 0。
 * `offsetSurcharges` 开且有③加价时：收住宿就记一笔 `lodging_offset`（负数）抵掉两笔③空驶加价，再与「车回基地」（不收住宿、保留③加价）比，
 * 取总价低者（一样时取车回基地，少两行费用）。
 */
export function lodgingFee(input: LodgingInput, rules: EffectiveTripRules["lodging"]): LodgingResult {
  const none: LodgingResult = { choice: "none", fees: [], missingPrice: false };
  if (!input.sameVehicleNext || input.endInBase || input.nextStartInBase || !rules.enabled) return none;
  const byArea = rules.byArea.find((entry) => input.overnightAreaIds.includes(entry.areaId));
  const source = input.providedByGuest ? "provided_by_guest" : byArea !== undefined ? "byArea" : "perNight";
  const amount = input.providedByGuest ? 0 : (byArea?.perNightMinor ?? rules.perNightMinor);
  if (amount === null) return { choice: "none", fees: [], missingPrice: true };
  const lodging: TripFeeDraft = { type: "lodging", settlementMinor: amount, nightIndex: input.nightIndex, dayIndex: null, areaId: byArea?.areaId ?? null, calc: { rule: "lodging", night: input.nightIndex, source, perNightMinor: amount } };
  const offset = rules.offsetSurcharges ? input.surchargeOffsetMinor : null;
  if (offset === null || offset <= 0) return { choice: "lodging", fees: [lodging], missingPrice: false };
  const stayTotal = amount - offset;
  if (stayTotal >= 0) return { choice: "return_to_base", fees: [], missingPrice: false };
  return {
    choice: "lodging",
    fees: [
      { ...lodging, calc: { ...lodging.calc, compared: { stay: stayTotal, returnToBase: 0 } } },
      { type: "lodging_offset", settlementMinor: -offset, nightIndex: input.nightIndex, dayIndex: null, areaId: null, calc: { rule: "lodging_offset", night: input.nightIndex, surchargeMinor: offset, basis: "before_adjustment" } },
    ],
    missingPrice: false,
  };
}

export interface IdleDayInput {
  dayIndex: number;
  /** 车回基地再来可不可行（过夜点在①里，或在③里、空驶已由前后两天的③加价覆盖） */
  returnToBaseAvailable: boolean;
  shortestPackage: ShortestPackage | null;
  /** 车留在当地时当晚的住宿（第 1 条算好的，可为空） */
  lodging: readonly TripFeeDraft[];
}

/**
 * 多日停驻（3.3）：两个用车日之间的空闲日，两种做法取低——
 * a. 车留在当地：停驻费 `min(perDayMinor, 最短套餐价)`（`orShortestPackage` 开时）+ 当晚住宿；
 * b. 车回基地再来：可行时不收停驻、不收住宿（成本 0）。
 * 都不可行（a 没有金额、b 不可行）→ `unquoted`。
 */
export function idleDayFee(input: IdleDayInput, rules: EffectiveTripRules["idleDay"]): { choice: "stay" | "return_to_base"; fees: TripFeeDraft[] } | { unquoted: "IDLE_DAY_PRICE_UNAVAILABLE" } {
  if (input.returnToBaseAvailable) return { choice: "return_to_base", fees: [] };
  if (!rules.enabled) return { choice: "stay", fees: [...input.lodging] };
  const candidates: { minor: number; source: string }[] = [];
  if (rules.perDayMinor !== null) candidates.push({ minor: rules.perDayMinor, source: "perDay" });
  if (rules.orShortestPackage && input.shortestPackage !== null) candidates.push({ minor: input.shortestPackage.minor, source: "shortestPackage" });
  if (candidates.length === 0) return { unquoted: "IDLE_DAY_PRICE_UNAVAILABLE" };
  const chosen = candidates.reduce((min, c) => (c.minor < min.minor ? c : min));
  const idle: TripFeeDraft = {
    type: "idle",
    settlementMinor: chosen.minor,
    nightIndex: null,
    dayIndex: input.dayIndex,
    areaId: input.shortestPackage?.areaId ?? null,
    calc: { rule: "idle", day: input.dayIndex, source: chosen.source, perDayMinor: rules.perDayMinor, shortestPackage: input.shortestPackage },
  };
  return { choice: "stay", fees: [idle, ...input.lodging] };
}

/** 第二司机费（3.4）：`shortest_package` = 最短套餐价；`fixed` = 固定金额。取不到为 null（这一天 `SECOND_DRIVER_PRICE_UNAVAILABLE`） */
export function secondDriverFee(input: { dayIndex: number; reasons: readonly string[]; shortestPackage: ShortestPackage | null }, rules: EffectiveTripRules["secondDriver"]): TripFeeDraft | null {
  const minor = rules.mode === "fixed" ? rules.fixedMinor : (input.shortestPackage?.minor ?? rules.fixedMinor);
  if (minor === null) return null;
  const source = rules.mode === "fixed" || input.shortestPackage === null ? "fixed" : "shortestPackage";
  return { type: "second_driver", settlementMinor: minor, nightIndex: null, dayIndex: input.dayIndex, areaId: null, calc: { rule: "second_driver", day: input.dayIndex, reasons: [...input.reasons], source, shortestPackage: source === "shortestPackage" ? input.shortestPackage : null } };
}

export interface SegmentAddonLine {
  dayIndex: number;
  addonId: string;
  chargeUnit: AddonChargeUnit;
  /** 这一段这一项的结算价（引擎明细 `addons[].amountMinor`） */
  amountMinor: number;
}

/** 按次附加项去重（设计篇第四节第 9 条）：同一辆车里儿童座椅等「按次」项从第二次起每段记一笔等额负数抵掉；按件 / 按人 / 按时长照收 */
export function bundleAddonDiscounts(lines: readonly SegmentAddonLine[], rules: EffectiveTripRules["bundleAddons"]): TripFeeDraft[] {
  if (!rules.enabled) return [];
  const seen = new Set<string>();
  const fees: TripFeeDraft[] = [];
  for (const line of lines) {
    if (line.chargeUnit !== "per_order") continue;
    if (!seen.has(line.addonId)) {
      seen.add(line.addonId);
      continue;
    }
    if (line.amountMinor === 0) continue;
    fees.push({ type: "bundle_discount", settlementMinor: -line.amountMinor, nightIndex: null, dayIndex: line.dayIndex, areaId: null, calc: { rule: "bundle_discount", addonId: line.addonId, amountMinor: line.amountMinor } });
  }
  return fees;
}

/**
 * 长途返程（3.2）：`min(返程公里 × 超公里单价 × ratioBp / 10000, 城市固定金额)`，只取有配置的项；超 `maxOneWayKm` → 转人工。
 * **P1 编排不调用**（ADR 0100 第四节第 4 条，监工确认 B3），P1d 接入。
 */
export function returnFee(input: { returnKm: number; overKmPerKmMinor: number | null; fixedByCityMinor: number | null }, rules: EffectiveTripRules["returnTrip"]): { minor: number; source: "ratio" | "fixed" } | { handoff: "RETURN_TOO_FAR" | "RETURN_PRICE_UNAVAILABLE" } | null {
  if (!rules.enabled) return null;
  if (!Number.isFinite(input.returnKm) || input.returnKm < 0) throw new RangeError(`返程公里必须是非负数：${input.returnKm}`);
  if (input.returnKm > rules.maxOneWayKm) return { handoff: "RETURN_TOO_FAR" };
  const options: { minor: number; source: "ratio" | "fixed" }[] = [];
  if (input.overKmPerKmMinor !== null) {
    const thousandths = BigInt(Math.round(input.returnKm * 1000));
    options.push({ minor: Number(roundFractionHalfAwayFromZero(thousandths * BigInt(input.overKmPerKmMinor) * BigInt(rules.ratioBp), 1000n * 10_000n)), source: "ratio" });
  }
  if (input.fixedByCityMinor !== null) options.push({ minor: input.fixedByCityMinor, source: "fixed" });
  if (options.length === 0) return { handoff: "RETURN_PRICE_UNAVAILABLE" };
  return options.reduce((min, o) => (o.minor < min.minor ? o : min));
}

/** 换算对外价要的那一段的加价快照（所属那天、那个商品、那个车型组的包车段） */
export interface FeeSellBasis {
  settlementCurrency: CurrencyCode;
  currency: CurrencyCode;
  markupBp: number;
  fxBufferBp: number;
  fx: FxQuote | null;
}

/**
 * 跨段费用的对外价（第四节第 6 条）：按所属段的加价比例和汇率换算，**不套渠道最低毛利、不按渠道取整单位**（那是按一单设计的，已在段价里收过）；
 * 负数按绝对值换算再取负。换不了（缺汇率等）为 null。
 */
export function feeSellMinor(settlementMinor: number, basis: FeeSellBasis): number | null {
  if (settlementMinor === 0) return 0;
  const result = sellPrice({ settlementMinor: Math.abs(settlementMinor), settlementCurrency: basis.settlementCurrency, currency: basis.currency, markupBp: basis.markupBp, markupFloorBp: 0, fxBufferBp: basis.fxBufferBp, fx: basis.fx });
  if ("failure" in result) return null;
  return settlementMinor < 0 ? -result.sellMinor : result.sellMinor;
}
