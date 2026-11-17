/**
 * 方案组装（ADR 0101 第三节第 6 小节 + 第四节）：编排器把每一段报好价之后，在这里组出 `one_car` / `daily_best` 两个方案，
 * 加上跨段费用（住宿、停驻、第二司机、按次附加项去重）、工时告警和报不出的原因，再按 10% 门槛推荐。纯函数，不碰数据库和网络。
 *
 * - 跨段规则用**第 N+1 天那段所用商品**的配置（住宿记在次日的商品上；工时 / 第二司机看当天商品）。
 * - 「同一辆车」= 一车到底里不是按段选车的日子；按段选车（`otherVehicle`）那一天前后不收住宿、不算休息、不参与附加项去重。
 * - 跨段费用的对外价按它所属那天这辆车的段（优先包车段）的加价和汇率换算，不套渠道最低毛利、不按渠道取整（`feeSellMinor`）。
 * - 返程费 P1 不接入（B3）。
 */
import type { LatLng } from "../geo.ts";
import type { CurrencyCode } from "../money.ts";
import type { AddonChargeUnit } from "../master-data.ts";
import type { PriceRule } from "../pricing.ts";
import { type FxQuote, type QuoteArea, locateInAreas } from "../quote.ts";
import { type SegmentAddonLine, type ShortestPackage, type TripFeeDraft, bundleAddonDiscounts, feeSellMinor, idleDayFee, lodgingFee, secondDriverFee, shortestPackagePrice } from "./fees.ts";
import { type CarKey, type ChosenDay, type ChosenSegment, type QuotedDay, type QuotedSegment, type SegmentOffer, assembleDailyBest, oneCarCandidates, oneCarDays, recommendPlan } from "./plans.ts";
import type { EffectiveTripRules } from "./rules.ts";
import { type DayWorkInput, evaluateWorkHours } from "./work-hours.ts";

/** 一段里某个租户某个车型组的报价（`group.ranked[]` 的一项），带算跨段费用要的快照 */
export interface TripOffer extends SegmentOffer {
  settlementCurrency: CurrencyCode;
  markupBp: number;
  fxBufferBp: number;
  fx: FxQuote | null;
  /** 这一段用时（分钟）：包车 = 引擎的预计用时 T，接送机 / 点对点 = 免费等待 + 行驶；不知道为 null（用路线时长） */
  durationMinutes: number | null;
  /** ③上车 / 下车空驶加价的结算价（调价前，`settlement.areaSurcharge`）；没有为 null */
  surcharge: { pickupMinor: number; dropoffMinor: number } | null;
  /** 引擎明细里的附加项（结算价） */
  addons: readonly { addonId: string; chargeUnit: AddonChargeUnit; amountMinor: number }[];
}

/** 编排器按路线推算的这一段时间（行程首日零点起的分钟） */
export interface TripSegmentRoute {
  startMinute: number;
  /** 行驶 + 中间各点停留 */
  routeMinutes: number;
  driveMinutes: number;
  meters: number;
}

export interface BuildSegment extends QuotedSegment<TripOffer> {
  route: TripSegmentRoute;
  startPoint: LatLng;
  endPoint: LatLng;
  /** 一个报价都没有时的原因（对外原因码，取第一个当这一天的原因） */
  reasons: readonly string[];
}

export interface BuildDay {
  dayIndex: number;
  /** `YYYY-MM-DD` */
  date: string;
  /** 空闲日为空数组；路线取不到的用车日也是空数组，`reason` 给原因 */
  options: readonly { segments: readonly BuildSegment[] }[];
  /** 是不是用车日（路线取不到的用车日也是 true） */
  used: boolean;
  startPoint: LatLng | null;
  endPoint: LatLng | null;
  /** 当晚过夜点；没写时用当天终点 */
  nightAt: LatLng | null;
  lodgingProvided: boolean;
  /** 这一天整体报不出的原因（例如 `ROUTE_UNAVAILABLE`）；没有为 null */
  reason: string | null;
}

/** 跨段规则要的商品信息：①区域、生效规则、规则版本、价格规则（最短套餐价） */
export interface BuildProduct {
  areas: readonly QuoteArea[];
  rules: EffectiveTripRules;
  ruleVersion: number;
  priceRules: readonly (PriceRule & { id?: string })[];
}

export interface TripBuildInput {
  currency: CurrencyCode;
  days: readonly BuildDay[];
  /** 报价结果里的候选商品；不在结果里为 null（这一天不算跨段费用） */
  product: (productId: string) => BuildProduct | null;
}

export interface PlanFee extends TripFeeDraft {
  tenantId: string;
  productId: string;
  ruleVersion: number;
  settlementCurrency: CurrencyCode;
  sellMinor: number;
}

export type PlanWarningCode = "SECOND_DRIVER" | "SEGMENT_OTHER_VEHICLE" | "WORK_HOURS_HARD_LIMIT";
export interface PlanWarning {
  code: PlanWarningCode;
  dayIndex: number;
}

export interface PlanUnquoted {
  dayIndex: number | null;
  reason: string;
}

export interface BuiltPlan {
  kind: "one_car" | "daily_best";
  tenantId: string | null;
  vehicleGroupId: string | null;
  days: ChosenDay<TripOffer>[];
  fees: PlanFee[];
  warnings: PlanWarning[];
  unquoted: PlanUnquoted[];
  /** 报不出时为 null */
  sellMinor: number | null;
  /** 全部段和费用同一个结算币种时才有 */
  settlementMinor: number | null;
  recommended: boolean;
}

export interface TripBuildResult {
  plans: BuiltPlan[];
  unquoted: { planKind: BuiltPlan["kind"]; dayIndex: number | null; reason: string }[];
}

interface DayContext {
  chosen: ChosenDay<TripOffer>;
  day: BuildDay;
  segments: { chosen: ChosenSegment<TripOffer>; built: BuildSegment }[];
  /** 这辆车自己的段（每天各自最优里同一天可能有别家供应商的接送机段，工时只算这辆车的） */
  mine: { chosen: ChosenSegment<TripOffer>; built: BuildSegment }[];
  /** 这辆车这一天的主段（包车优先）：算跨段费用、换算对外价都看它 */
  main: { chosen: ChosenSegment<TripOffer>; built: BuildSegment } | null;
  productId: string | null;
  product: BuildProduct | null;
}

const inAreas = (product: BuildProduct, point: LatLng | null): string[] => (point === null ? [] : locateInAreas(product.areas, point).operating);
const nightPoint = (day: BuildDay): LatLng | null => day.nightAt ?? day.endPoint;
const segmentEnd = (s: { chosen: ChosenSegment<TripOffer>; built: BuildSegment }): number => s.built.route.startMinute + (s.chosen.offer.durationMinutes ?? s.built.route.routeMinutes);

/** 这一天报不出的原因：整体原因 → 「不拆」里第一个没有报价的段的原因 → `NO_OFFER` */
function dayReason(day: BuildDay): string {
  if (day.reason !== null) return day.reason;
  for (const option of day.options) for (const segment of option.segments) if (segment.offers.length === 0 && segment.reasons.length > 0) return segment.reasons[0] as string;
  return "NO_OFFER";
}

function contextOf(input: TripBuildInput, byIndex: ReadonlyMap<number, BuildDay>, chosen: ChosenDay<TripOffer>, own: (offer: TripOffer) => boolean): DayContext {
  const day = byIndex.get(chosen.dayIndex) as BuildDay;
  const option = day.options[chosen.optionIndex] as { segments: readonly BuildSegment[] };
  const segments = chosen.segments.map((segment, i) => ({ chosen: segment, built: option.segments[i] as BuildSegment }));
  const mine = segments.filter((s) => own(s.chosen.offer));
  const main = mine.find((s) => s.chosen.draft.type === "charter") ?? mine[0] ?? null;
  const productId = main?.chosen.offer.productId ?? null;
  return { chosen, day, segments, mine, main, productId, product: productId === null ? null : input.product(productId) };
}

/** 工时输入：只算这辆车自己的段（首段开始 → 末段结束；起终点按它自己的首末段） */
function workInput(ctx: DayContext, sameVehicleAsPrevious: boolean): DayWorkInput {
  const product = ctx.product as BuildProduct;
  const own = ctx.mine.length > 0 ? ctx.mine : ctx.segments;
  const first = own[0] as DayContext["segments"][number];
  const last = own[own.length - 1] as DayContext["segments"][number];
  return {
    dayIndex: ctx.chosen.dayIndex,
    startMinute: first.built.route.startMinute,
    endMinute: Math.max(...own.map(segmentEnd)),
    driveMinutes: own.reduce((sum, s) => sum + s.built.route.driveMinutes, 0),
    meters: own.reduce((sum, s) => sum + s.built.route.meters, 0),
    startInBase: inAreas(product, first.built.startPoint).length > 0,
    endInBase: inAreas(product, last.built.endPoint).length > 0,
    sameVehicleAsPrevious,
  };
}

function shortestFor(ctx: DayContext, vehicleGroupId: string, point: LatLng | null, date: string): ShortestPackage | null {
  if (ctx.product === null) return null;
  return shortestPackagePrice(ctx.product.priceRules, { vehicleGroupId, date, preferAreaIds: inAreas(ctx.product, point) });
}

class PlanBuilder {
  readonly fees: PlanFee[] = [];
  readonly warnings: PlanWarning[] = [];
  readonly unquoted: PlanUnquoted[] = [];
  private readonly currency: CurrencyCode;
  constructor(currency: CurrencyCode) {
    this.currency = currency;
  }

  /** 记一笔费用：换算对外价用 `basis` 那一天这辆车的主段 */
  fee(draft: TripFeeDraft, basis: DayContext, tenantId: string): void {
    const offer = basis.main?.chosen.offer;
    if (offer === undefined || basis.productId === null || basis.product === null) return;
    const sellMinor = feeSellMinor(draft.settlementMinor, { settlementCurrency: offer.settlementCurrency, currency: this.currency, markupBp: offer.markupBp, fxBufferBp: offer.fxBufferBp, fx: offer.fx });
    if (sellMinor === null) {
      this.unquoted.push({ dayIndex: draft.dayIndex ?? basis.chosen.dayIndex, reason: "FEE_PRICE_UNAVAILABLE" });
      return;
    }
    this.fees.push({ ...draft, tenantId, productId: basis.productId, ruleVersion: basis.product.ruleVersion, settlementCurrency: offer.settlementCurrency, sellMinor });
  }

  /** 工时与第二司机：`window` 是 [前一个同车用车日, 当天] 或 [当天] */
  workHours(window: readonly DayWorkInput[], ctx: DayContext, tenantId: string, vehicleGroupId: string, checkRest: boolean): void {
    if (ctx.product === null) return;
    const rules = ctx.product.rules;
    const result = evaluateWorkHours(window, rules.workHours, { secondDriverEnabled: rules.secondDriver.enabled, checkRest })[window.length - 1];
    if (result === undefined) return;
    const dayIndex = ctx.chosen.dayIndex;
    if (result.status === "unquoted") {
      this.unquoted.push({ dayIndex, reason: result.unquoted as string });
      if (result.unquoted === "WORK_HOURS_HARD_LIMIT") this.warnings.push({ code: "WORK_HOURS_HARD_LIMIT", dayIndex });
      return;
    }
    if (result.status !== "second_driver") return;
    const fee = secondDriverFee({ dayIndex, reasons: result.reasons, shortestPackage: shortestFor(ctx, vehicleGroupId, nightPoint(ctx.day), ctx.day.date) }, rules.secondDriver);
    if (fee === null) {
      this.unquoted.push({ dayIndex, reason: "SECOND_DRIVER_PRICE_UNAVAILABLE" });
      return;
    }
    this.fee(fee, ctx, tenantId);
    this.warnings.push({ code: "SECOND_DRIVER", dayIndex });
  }
}

function totals(days: readonly ChosenDay<TripOffer>[], fees: readonly PlanFee[]): { sellMinor: number; settlementMinor: number | null } {
  const offers = days.flatMap((day) => day.segments.map((segment) => segment.offer));
  const sellMinor = offers.reduce((sum, offer) => sum + offer.sellMinor, 0) + fees.reduce((sum, fee) => sum + fee.sellMinor, 0);
  const currencies = new Set([...offers.map((offer) => offer.settlementCurrency), ...fees.map((fee) => fee.settlementCurrency)]);
  const settlementMinor = currencies.size === 1 ? offers.reduce((sum, offer) => sum + offer.settlementMinor, 0) + fees.reduce((sum, fee) => sum + fee.settlementMinor, 0) : null;
  return { sellMinor, settlementMinor };
}

/** 某个租户 × 车型组的一车到底方案；不能一车到底（有包车段的一天它报不出）为 null */
function oneCarPlan(input: TripBuildInput, byIndex: ReadonlyMap<number, BuildDay>, quoted: readonly QuotedDay<TripOffer>[], key: CarKey): BuiltPlan | null {
  const chosen = oneCarDays(quoted, key);
  if (chosen === null) return null;
  const own = (offer: TripOffer): boolean => offer.tenantId === key.tenantId && offer.vehicleGroupId === key.vehicleGroupId;
  const contexts = chosen.map((day) => contextOf(input, byIndex, day, own));
  const plan = new PlanBuilder(input.currency);

  // 工时：每天用当天商品的规则，看 [前一个同车用车日, 当天]（休息不足记在当天，即次日）
  for (const [i, ctx] of contexts.entries()) {
    if (ctx.chosen.otherVehicle) {
      plan.warnings.push({ code: "SEGMENT_OTHER_VEHICLE", dayIndex: ctx.chosen.dayIndex });
      continue;
    }
    if (ctx.product === null) continue;
    const prev = i > 0 ? (contexts[i - 1] as DayContext) : null;
    const sameAsPrev = prev !== null && !prev.chosen.otherVehicle && prev.product !== null;
    const window = sameAsPrev ? [workInput(prev, false), workInput(ctx, true)] : [workInput(ctx, false)];
    plan.workHours(window, ctx, key.tenantId, key.vehicleGroupId, true);
  }

  // 住宿与停驻：相邻两个用车日（中间可夹空闲日），两天都是同一辆车时才算；规则看第 N+1 天的商品
  for (let k = 0; k + 1 < contexts.length; k++) {
    const a = contexts[k] as DayContext;
    const b = contexts[k + 1] as DayContext;
    if (a.chosen.otherVehicle || b.chosen.otherVehicle || b.product === null) continue;
    const product = b.product;
    const rules = product.rules;
    const inBase = (point: LatLng | null): boolean => inAreas(product, point).length > 0;
    const night = nightPoint(a.day);
    const lastA = a.segments[a.segments.length - 1];
    const firstB = b.segments[0];
    const dropoff = lastA !== undefined && own(lastA.chosen.offer) ? (lastA.chosen.offer.surcharge?.dropoffMinor ?? null) : null;
    const pickup = firstB !== undefined && own(firstB.chosen.offer) ? (firstB.chosen.offer.surcharge?.pickupMinor ?? null) : null;
    const offsetSum = (dropoff ?? 0) + (pickup ?? 0);
    const offset = dropoff === null && pickup === null ? null : offsetSum > 0 ? offsetSum : null;
    const idleDays: BuildDay[] = [];
    for (let d = a.chosen.dayIndex + 1; d < b.chosen.dayIndex; d++) {
      const idle = byIndex.get(d);
      if (idle !== undefined) idleDays.push(idle);
    }
    if (idleDays.length === 0) {
      const lodging = lodgingFee({ nightIndex: a.chosen.dayIndex, endInBase: inBase(a.day.endPoint), nextStartInBase: inBase(b.day.startPoint), sameVehicleNext: true, overnightAreaIds: inAreas(product, night), providedByGuest: a.day.lodgingProvided, surchargeOffsetMinor: offset }, rules.lodging);
      if (lodging.missingPrice) plan.unquoted.push({ dayIndex: b.chosen.dayIndex, reason: "LODGING_PRICE_UNAVAILABLE" });
      for (const fee of lodging.fees) plan.fee(fee, b, key.tenantId);
      continue;
    }
    // 夹了空闲日：车回基地（过夜点在①，或在③、空驶已由前后两天的③加价覆盖）成本 0，一定取它；否则车留在当地，每晚住宿 + 每个空闲日停驻
    if (inBase(night) || offset !== null) continue;
    const first = lodgingFee({ nightIndex: a.chosen.dayIndex, endInBase: false, nextStartInBase: false, sameVehicleNext: true, overnightAreaIds: inAreas(product, night), providedByGuest: a.day.lodgingProvided, surchargeOffsetMinor: null }, rules.lodging);
    if (first.missingPrice) plan.unquoted.push({ dayIndex: b.chosen.dayIndex, reason: "LODGING_PRICE_UNAVAILABLE" });
    for (const fee of first.fees) plan.fee(fee, b, key.tenantId);
    let point = night;
    for (const idle of idleDays) {
      point = idle.nightAt ?? point;
      const lodging = lodgingFee({ nightIndex: idle.dayIndex, endInBase: false, nextStartInBase: false, sameVehicleNext: true, overnightAreaIds: inAreas(product, point), providedByGuest: idle.lodgingProvided, surchargeOffsetMinor: null }, rules.lodging);
      if (lodging.missingPrice) plan.unquoted.push({ dayIndex: idle.dayIndex, reason: "LODGING_PRICE_UNAVAILABLE" });
      const stay = idleDayFee({ dayIndex: idle.dayIndex, returnToBaseAvailable: false, shortestPackage: shortestFor(b, key.vehicleGroupId, point, idle.date), lodging: lodging.fees }, rules.idleDay);
      if ("unquoted" in stay) plan.unquoted.push({ dayIndex: idle.dayIndex, reason: stay.unquoted });
      else for (const fee of stay.fees) plan.fee(fee, b, key.tenantId);
    }
  }

  // 按次附加项去重：只看同一辆车的段（不含按段选车的日子），规则看第一个用车日的商品
  const firstOwn = contexts.find((ctx) => !ctx.chosen.otherVehicle && ctx.product !== null);
  if (firstOwn !== undefined) {
    const lines: SegmentAddonLine[] = contexts
      .filter((ctx) => !ctx.chosen.otherVehicle)
      .flatMap((ctx) => ctx.segments.filter((s) => own(s.chosen.offer)).flatMap((s) => s.chosen.offer.addons.map((addon) => ({ dayIndex: ctx.chosen.dayIndex, addonId: addon.addonId, chargeUnit: addon.chargeUnit, amountMinor: addon.amountMinor }))));
    for (const fee of bundleAddonDiscounts(lines, (firstOwn.product as BuildProduct).rules.bundleAddons)) {
      const basis = contexts.find((ctx) => ctx.chosen.dayIndex === fee.dayIndex) ?? firstOwn;
      plan.fee(fee, basis, key.tenantId);
    }
  }

  const sum = totals(chosen, plan.fees);
  const ok = plan.unquoted.length === 0;
  return { kind: "one_car", tenantId: key.tenantId, vehicleGroupId: key.vehicleGroupId, days: chosen, fees: plan.fees, warnings: plan.warnings, unquoted: plan.unquoted, sellMinor: ok ? sum.sellMinor : null, settlementMinor: ok ? sum.settlementMinor : null, recommended: false };
}

function dailyBestPlan(input: TripBuildInput, byIndex: ReadonlyMap<number, BuildDay>, quoted: readonly QuotedDay<TripOffer>[]): BuiltPlan {
  const assembled = assembleDailyBest(quoted);
  const plan = new PlanBuilder(input.currency);
  for (const missing of assembled.unquoted) plan.unquoted.push({ dayIndex: missing.dayIndex, reason: dayReason(byIndex.get(missing.dayIndex) as BuildDay) });
  // 每天不是同一辆车：只按单日检查工时，用当天包车段中标商品的规则；只有接送机 / 点对点的一天不查
  for (const day of assembled.days) {
    const charter = day.segments.find((segment) => segment.draft.type === "charter");
    if (charter === undefined) continue;
    const key = { tenantId: charter.offer.tenantId, vehicleGroupId: charter.offer.vehicleGroupId };
    const ctx = contextOf(input, byIndex, day, (offer) => offer === charter.offer);
    if (ctx.product === null) continue;
    plan.workHours([workInput(ctx, false)], ctx, key.tenantId, key.vehicleGroupId, false);
  }
  const sum = totals(assembled.days, plan.fees);
  const ok = plan.unquoted.length === 0;
  return { kind: "daily_best", tenantId: null, vehicleGroupId: null, days: assembled.days, fees: plan.fees, warnings: plan.warnings, unquoted: plan.unquoted, sellMinor: ok ? sum.sellMinor : null, settlementMinor: ok ? sum.settlementMinor : null, recommended: false };
}

/**
 * 组出方案：2 天以上用车出 `one_car` 和 `daily_best`，只有 1 天用车只出 `one_car`。
 * `one_car` 在所有能贯穿全部用车日的租户 × 车型组里取报得出、总价（段 + 跨段费用）最低的；都报不出时给原因最少的那个组合的原因，
 * 一个组合都没有时给缺报价的那几天（没有这样的天时 `ONE_CAR_NOT_AVAILABLE`）。
 */
export function buildTripPlans(input: TripBuildInput): TripBuildResult {
  const byIndex = new Map(input.days.map((day) => [day.dayIndex, day]));
  const quoted: QuotedDay<TripOffer>[] = input.days.map((day) => ({ dayIndex: day.dayIndex, options: day.options }));
  // 路线取不到的用车日没有拆法，也要让两个方案都报不出：给它一个空拆法（一个没有报价的段）不方便，单独处理
  const brokenDays = input.days.filter((day) => day.used && day.options.length === 0);
  const usedCount = input.days.filter((day) => day.used).length;
  if (usedCount === 0) return { plans: [], unquoted: [] };

  const candidates = oneCarCandidates(quoted)
    .map((key) => oneCarPlan(input, byIndex, quoted, key))
    .filter((plan): plan is BuiltPlan => plan !== null);
  const complete = candidates.filter((plan) => plan.unquoted.length === 0 && plan.sellMinor !== null);
  let oneCar: BuiltPlan;
  if (complete.length > 0 && brokenDays.length === 0) {
    oneCar = complete.reduce((best, plan) => ((plan.sellMinor as number) < (best.sellMinor as number) ? plan : best));
  } else if (candidates.length > 0 && brokenDays.length === 0) {
    oneCar = candidates.reduce((best, plan) => (plan.unquoted.length < best.unquoted.length ? plan : best));
  } else {
    const missing = input.days.filter((day) => day.used && (day.options.length === 0 || assembleDailyBest([{ dayIndex: day.dayIndex, options: day.options }]).unquoted.length > 0));
    const unquoted = missing.length > 0 ? missing.map((day) => ({ dayIndex: day.dayIndex, reason: dayReason(day) })) : [{ dayIndex: null, reason: "ONE_CAR_NOT_AVAILABLE" }];
    oneCar = { kind: "one_car", tenantId: null, vehicleGroupId: null, days: [], fees: [], warnings: [], unquoted, sellMinor: null, settlementMinor: null, recommended: false };
  }

  const plans: BuiltPlan[] = [oneCar];
  if (usedCount >= 2) {
    const daily = dailyBestPlan(input, byIndex, quoted);
    for (const day of brokenDays) daily.unquoted.push({ dayIndex: day.dayIndex, reason: dayReason(day) });
    if (brokenDays.length > 0) {
      daily.sellMinor = null;
      daily.settlementMinor = null;
    }
    daily.unquoted.sort((x, y) => (x.dayIndex ?? -1) - (y.dayIndex ?? -1));
    plans.push(daily);
  }
  const pick = recommendPlan(plans.map((plan) => ({ kind: plan.kind, quoted: plan.sellMinor !== null, sellMinor: plan.sellMinor ?? 0 })));
  for (const plan of plans) plan.recommended = plan.kind === pick;
  return { plans, unquoted: plans.flatMap((plan) => plan.unquoted.map((entry) => ({ planKind: plan.kind, dayIndex: entry.dayIndex, reason: entry.reason }))) };
}
