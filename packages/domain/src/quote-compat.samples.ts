/**
 * 报价兼容对比的样例（M8-15，ADR 0073「不变的」）：三个品类各一个带调价、夜间费、加急、附加服务、多区域、禁行区的商品，
 * 对一批上车 / 下车点、用车时间、路线预估的组合各报一次价。
 *
 * `quote-compat.golden.json` 是 M8-15 改报价引擎**之前**的引擎对这些样例算出来的结果（逐分）；
 * `quote-compat.test.ts` 用改过的引擎再算一遍，除了 ADR 0073 写明的包车下车点变化以外必须一模一样。
 * 这里只构造测试数据，不进任何数据库。
 */
import type { Position } from "./areas.ts";
import type { AdjustRule, PriceRule, Pricing } from "./pricing.ts";
import { type ServiceRules, emptyServiceRules } from "./products.ts";
import { type ProductQuote, type QuoteMoment, type QuoteProduct, type QuoteRequest, quoteProduct } from "./quote.ts";

const square = (west: number, south: number, east: number, north: number): Position[] => [[west, south], [east, south], [east, north], [west, north], [west, south]];
const AREA_1 = { areaId: "a1", active: true, shapes: [{ id: "a1-op", kind: "operate" as const, ring: square(139.0, 35.0, 139.6, 36.0) }] };
const AREA_2 = { areaId: "a2", active: true, shapes: [{ id: "a2-op", kind: "operate" as const, ring: square(139.5, 35.0, 140.0, 36.0) }, { id: "a2-no", kind: "forbid" as const, ring: square(139.8, 35.4, 139.9, 35.6) }] };
const AREA_3_OFF = { areaId: "a3", active: false, shapes: [{ id: "a3-op", kind: "operate" as const, ring: square(140.5, 35.0, 141.5, 36.0) }] };

/** 样例里用到的点：名字 → 坐标 */
export const COMPAT_POINTS = {
  west: { lng: 139.2, lat: 35.5 },
  overlap: { lng: 139.55, lat: 35.5 },
  east: { lng: 139.7, lat: 35.5 },
  forbidden: { lng: 139.85, lat: 35.5 },
  disabledArea: { lng: 141.0, lat: 35.5 },
  far: { lng: 142.5, lat: 35.5 },
} as const;
export type CompatPoint = keyof typeof COMPAT_POINTS;

/** 每个点在不在样例商品自己的区域里（营运区内、不在那个区域的禁行区里）：包车下车点的判断要用 */
export const COMPAT_POINT_IN_PRODUCT_AREA: Readonly<Record<CompatPoint, boolean>> = { west: true, overlap: true, east: true, forbidden: false, disabledArea: false, far: false };

const price = (id: string, pricing: Pricing, extra: Partial<PriceRule>): PriceRule & { id: string } => ({ id, areaId: "a1", vehicleGroupId: "biz7", direction: null, packageHours: null, pricing, validFrom: "2026-01-01", validTo: null, status: "enabled", ...extra });
const adjust = (id: string, steps: AdjustRule["steps"], extra: Partial<AdjustRule> = {}): AdjustRule & { id: string } => ({ id, name: id, travelFrom: null, travelTo: null, cycle: { type: "daily" }, timeSlot: null, areaIds: [], vehicleGroupIds: [], directions: [], packageHours: [], steps, status: "enabled", ...extra });

const rules = (extra: Partial<ServiceRules>): ServiceRules => ({
  ...emptyServiceRules(),
  booking: { saleFrom: null, saleTo: null, serviceTime: { start: "00:00", end: "24:00" }, leadTimeHours: 24, note: null },
  urgent: { enabled: true, dailyQuota: 3, tiers: [{ withinHours: 12, surchargeMinor: 2_000 }, { withinHours: 6, surchargeMinor: 5_000 }] },
  night: { enabled: true, window: { start: "22:00", end: "06:00" }, amountMinor: 3_000, chargeUnit: "per_hour" },
  addons: [
    { addonId: "seat", enabled: true, unitPriceMinor: 1_000, firstFree: true },
    { addonId: "sign", enabled: true, unitPriceMinor: 500, firstFree: false },
  ],
  driverLanguages: [{ language: "zh", unitPriceMinor: 1_500 }],
  ...extra,
});

const base = {
  tenantId: "tenant-a",
  status: "published" as const,
  tenantActive: true,
  brandActive: true,
  currency: "JPY" as const,
  timeZone: "Asia/Tokyo",
  areas: [AREA_1, AREA_2, AREA_3_OFF],
  vehicleGroups: [{ vehicleGroupId: "biz7", passengers: 6, luggage: 4, active: true }, { vehicleGroupId: "eco4", passengers: 3, luggage: 2, active: true }, { vehicleGroupId: "lux3", passengers: 2, luggage: 2, active: false }],
  addonCatalog: [{ addonId: "seat", chargeUnit: "per_item" as const, usable: true }, { addonId: "sign", chargeUnit: "per_order" as const, usable: true }],
  inventoryMode: "unlimited" as const,
};

const weekend = adjust("weekend+20%", [{ type: "percent", value: 2_000 }], { cycle: { type: "weekly", weekdays: [6, 7] } });
const lateNight = adjust("late+15%-300", [{ type: "percent", value: 1_500 }, { type: "amount", value: -300 }], { timeSlot: { start: "21:00", end: "02:00" } });
const a2Discount = adjust("a2-7%", [{ type: "percent", value: -700 }], { areaIds: ["a2"] });

/** 三个样例商品 */
export const COMPAT_PRODUCTS: readonly QuoteProduct[] = [
  {
    ...base,
    productId: "airport",
    category: "airport_transfer",
    roundingUnit: 10,
    pickupPlace: { type: "airport", flightScope: "international" },
    serviceRules: rules({ freeWait: { pickup: { mode: "limited", minutes: 90 }, dropoff: { mode: "limited", minutes: 15 }, general: null } }),
    priceRules: [
      price("t-a1-biz-both", { model: "fixed", basePriceMinor: 20_000 }, { direction: "both" }),
      price("t-a2-biz-pickup", { model: "fixed", basePriceMinor: 18_500 }, { areaId: "a2", direction: "pickup" }),
      price("t-a2-biz-dropoff-old", { model: "fixed", basePriceMinor: 17_000 }, { areaId: "a2", direction: "dropoff", validTo: "2026-10-31" }),
      price("t-a1-eco-both", { model: "mileage_time", startPriceMinor: 4_000, startMeters: 10_000, startMinutes: 30, perKmMinor: 333, perMinuteMinor: 47, minPriceMinor: 6_000 }, { vehicleGroupId: "eco4", direction: "both" }),
      price("t-a2-eco-both-off", { model: "fixed", basePriceMinor: 9_000 }, { areaId: "a2", vehicleGroupId: "eco4", direction: "both", status: "disabled" }),
    ],
    adjustRules: [weekend, lateNight, a2Discount],
  },
  {
    ...base,
    productId: "p2p",
    category: "point_to_point",
    roundingUnit: 1,
    pickupPlace: null,
    serviceRules: rules({ freeWait: { pickup: null, dropoff: null, general: { mode: "limited", minutes: 15 } } }),
    priceRules: [
      price("p-a1-biz", { model: "mileage_time", startPriceMinor: 5_000, startMeters: 8_000, startMinutes: 20, perKmMinor: 401, perMinuteMinor: 33, minPriceMinor: null }, {}),
      price("p-a2-biz", { model: "fixed", basePriceMinor: 12_345 }, { areaId: "a2" }),
      price("p-a1-eco", { model: "fixed", basePriceMinor: 7_777 }, { vehicleGroupId: "eco4", validFrom: "2026-11-01" }),
    ],
    adjustRules: [lateNight, a2Discount, weekend],
  },
  {
    ...base,
    productId: "charter",
    category: "charter",
    roundingUnit: 100,
    pickupPlace: null,
    serviceRules: rules({ night: { enabled: true, window: { start: "22:00", end: "06:00" }, amountMinor: 2_500, chargeUnit: "per_order" }, freeWait: { pickup: null, dropoff: null, general: { mode: "unlimited" } } }),
    priceRules: [
      price("c-a1-biz-5", { model: "charter_package", packageKm: 150, packagePriceMinor: 55_000, overtimePerHourMinor: 5_000, overKmPerKmMinor: 400 }, { packageHours: 5 }),
      price("c-a1-biz-10", { model: "charter_package", packageKm: 300, packagePriceMinor: 98_050, overtimePerHourMinor: 5_000, overKmPerKmMinor: 400 }, { packageHours: 10 }),
      price("c-a2-biz-10", { model: "charter_package", packageKm: 300, packagePriceMinor: 96_000, overtimePerHourMinor: 5_000, overKmPerKmMinor: 400 }, { areaId: "a2", packageHours: 10 }),
      price("c-a2-eco-5", { model: "charter_package", packageKm: 120, packagePriceMinor: 41_234, overtimePerHourMinor: 3_000, overKmPerKmMinor: 300 }, { areaId: "a2", vehicleGroupId: "eco4", packageHours: 5 }),
    ],
    adjustRules: [weekend, a2Discount, lateNight, adjust("10h-only+1000", [{ type: "amount", value: 1_000 }], { packageHours: [10] })],
  },
];

// 现在是东京 2026-10-07 10:00
const NOW = new Date("2026-10-07T01:00:00Z");
/** 用车时间：平日白天、周六深夜（周末 + 夜间）、加急（6 小时内）、跨过一条价格的生效期之后 */
const TIMES = ["2026-10-20T10:00", "2026-10-24T23:30", "2026-10-07T15:00", "2026-11-03T01:30"] as const;
const ROUTES = [null, { meters: 23_456, minutes: 37 }] as const;
const POINTS = Object.keys(COMPAT_POINTS) as CompatPoint[];

export interface CompatSample {
  /** 样例的名字（golden 文件里的键） */
  key: string;
  product: QuoteProduct;
  request: QuoteRequest;
  moment: QuoteMoment;
  /** 包车：下车点在哪（没给为 null）；其他品类为 null */
  charterDropoff: CompatPoint | null;
}

/** 全部样例（确定的顺序） */
export function compatSamples(): CompatSample[] {
  const samples: CompatSample[] = [];
  const common = { passengers: 2, luggage: 1, addons: [{ addonId: "seat", quantity: 2 }, { addonId: "sign", quantity: 1 }], driverLanguage: "zh", vehicleGroupIds: [] as string[] };
  for (const product of COMPAT_PRODUCTS) {
    for (const serviceLocal of TIMES) {
      // 包车不看路线预估：只算一遍
      for (const [routeIndex, route] of (product.category === "charter" ? ROUTES.slice(0, 1) : ROUTES).entries()) {
        const moment: QuoteMoment = { now: NOW, route, inventoryDay: null, urgentUsed: 1 };
        const push = (name: string, request: Omit<QuoteRequest, keyof typeof common | "serviceLocal" | "category">, charterDropoff: CompatPoint | null = null): void => {
          samples.push({ key: `${product.productId}|${serviceLocal}|route${routeIndex}|${name}`, product, request: { ...common, ...request, category: product.category, serviceLocal }, moment, charterDropoff });
        };
        for (const point of POINTS) {
          if (product.category === "airport_transfer") {
            push(`pickup→${point}`, { pickup: null, dropoff: COMPAT_POINTS[point], direction: "pickup", packageHours: null });
            push(`${point}→dropoff`, { pickup: COMPAT_POINTS[point], dropoff: null, direction: "dropoff", packageHours: null });
          } else if (product.category === "point_to_point") {
            for (const to of POINTS) push(`${point}→${to}`, { pickup: COMPAT_POINTS[point], dropoff: COMPAT_POINTS[to], direction: null, packageHours: null });
          } else {
            for (const hours of [5, 10, 8]) {
              push(`${point}→none|${hours}h`, { pickup: COMPAT_POINTS[point], dropoff: null, direction: null, packageHours: hours });
              for (const to of POINTS) push(`${point}→${to}|${hours}h`, { pickup: COMPAT_POINTS[point], dropoff: COMPAT_POINTS[to], direction: null, packageHours: hours }, to);
            }
          }
        }
      }
    }
  }
  return samples;
}

/**
 * 一次报价写成可比较的样子：商品层面被拒给原因；否则每个车型组给结算价、各项明细、精确值、命中的区域和价格规则，或原因。
 * 只取改之前就有的字段（新加的字段不在对比里）。
 */
export function compatOutcome(quoted: ProductQuote): unknown {
  if (!quoted.ok) return quoted.reason;
  return {
    serviceDate: quoted.serviceDate,
    urgent: quoted.urgent,
    offers: quoted.offers.map((offer) => {
      const s = offer.settlement;
      return [offer.vehicleGroupId, offer.packageHours, offer.areaId, offer.priceRuleId, s.currency, s.roundingUnit, s.totalMinor, s.baseMinor, s.adjustMinor, s.urgentMinor, s.nightMinor, s.addonsMinor, s.driverLanguageMinor, s.exact, s.adjusts, s.urgentTier, s.night, s.addons, s.usage, s.freeWait];
    }),
    refused: quoted.refused,
  };
}

/** 用现在的引擎算一遍全部样例 */
export function compatResults(): Record<string, unknown> {
  return Object.fromEntries(compatSamples().map((sample) => [sample.key, compatOutcome(quoteProduct(sample.product, sample.request, sample.moment))]));
}
