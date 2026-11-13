/**
 * 「包车带加价区域」的 golden 样例（M9W-01，ADR 0088「验证」）：引擎加经停点之前，用当时的引擎对这些样例算一遍、
 * 把结果写进 `charter-golden.json`；改引擎之后 `charter-golden.test.ts` 再算一遍，不带经停点的报价必须逐分、逐字段一致。
 *
 * 覆盖：重叠的加价区域取最高（M8-38）、大范围商品区域盖住小加价区（M8-38）、规则停用、未生效、只有别的车型组有规则、
 * 上车点只在加价区域里、两端都只在加价区域里、哪里都不在、商品报价区域 / 加价区域 / 运营区域的禁行区、没给下车点（DROPOFF_REQUIRED）、
 * 调价作用在合计上、取整单位、加急、夜间、跨币种的对外价参考（`sell.areaSurcharge`）。
 * 这里只构造测试数据，不进任何数据库。
 *
 * 重新生成（只在改引擎之前做过一次；以后不要重新生成，否则 golden 失去意义）：
 * `node -e 'import("./packages/domain/src/charter-golden.samples.ts").then((m) => process.stdout.write(JSON.stringify(m.charterGoldenResults(), null, 1) + "\n"))' > packages/domain/src/charter-golden.json`
 */
import { createHash } from "node:crypto";
import type { Position } from "./areas.ts";
import type { AdjustRule, PriceRule } from "./pricing.ts";
import { type ServiceRules, emptyServiceRules } from "./products.ts";
import { type FxQuote, type QuoteArea, type QuoteMoment, type QuoteProduct, type QuoteRequest, compareQuotes, quoteProduct } from "./quote.ts";

const square = (west: number, south: number, east: number, north: number): Position[] => [[west, south], [east, south], [east, north], [west, north], [west, south]];
const area = (areaId: string, ring: Position[], extra: Partial<QuoteArea> = {}): QuoteArea => ({ areaId, active: true, shapes: [{ id: `${areaId}-op`, kind: "operate", ring }], ...extra });
const withForbid = (base: QuoteArea, ring: Position[]): QuoteArea => ({ ...base, shapes: [...base.shapes, { id: `${base.areaId}-no`, kind: "forbid", ring }] });

/** 商品本身的区域（两种大小）和加价区域 */
export const GOLDEN_AREAS = {
  tokyo: area("tokyo", square(139.5, 35.5, 139.9, 35.9)),
  /** 大东京：包住八王子、富士山（像测试环境的东京运营区包住箱根、富士山，M8-38） */
  bigTokyo: area("tokyo", square(138.5, 35.1, 139.9, 35.9)),
  hachioji: area("hachioji", square(139.2, 35.5, 139.4, 35.9)),
  fuji: area("fuji", square(138.6, 35.2, 139.0, 35.45)),
  /** 和富士山重叠一块（138.8–139.0 × 35.3–35.45） */
  fujiNorth: area("fuji-north", square(138.8, 35.3, 139.1, 35.5)),
  chiba: area("chiba", square(140.0, 35.5, 140.3, 35.9)),
  /** 整个包住千叶 */
  wideChiba: area("wide-chiba", square(139.95, 35.4, 140.4, 36.0)),
  /** 规则停用了 */
  kamakura: area("kamakura", square(139.45, 35.25, 139.6, 35.35)),
  /** 规则还没生效 */
  karuizawa: area("karuizawa", square(138.5, 36.3, 138.7, 36.4)),
  /** 只有经济车型组有规则 */
  saitama: area("saitama", square(139.5, 35.95, 139.8, 36.1)),
} as const;

/** 样例里用到的点 */
export const GOLDEN_POINTS = {
  tokyo: { lng: 139.7, lat: 35.7 },
  tokyoForbid: { lng: 139.75, lat: 35.75 },
  hachioji: { lng: 139.3, lat: 35.7 },
  fuji: { lng: 138.7, lat: 35.3 },
  fujiOverlap: { lng: 138.9, lat: 35.4 },
  fujiNorth: { lng: 139.05, lat: 35.48 },
  chiba: { lng: 140.1, lat: 35.7 },
  wideOnly: { lng: 140.35, lat: 35.95 },
  kamakura: { lng: 139.5, lat: 35.3 },
  karuizawa: { lng: 138.6, lat: 36.35 },
  saitama: { lng: 139.6, lat: 36.0 },
  /** 在「operating」商品的运营范围里，但不在任何报价区域、加价区域里 */
  outskirts: { lng: 139.0, lat: 36.2 },
  nowhere: { lng: 141.5, lat: 37.0 },
} as const;
export type GoldenPoint = keyof typeof GOLDEN_POINTS;

const rule = (id: string, areaId: string, vehicleGroupId: string, packageHours: number, pricing: PriceRule["pricing"], extra: Partial<PriceRule> = {}): PriceRule & { id: string } => ({
  id,
  areaId,
  vehicleGroupId,
  direction: null,
  packageHours,
  pricing,
  validFrom: "2026-01-01",
  validTo: null,
  status: "enabled",
  ...extra,
});
const pkg = (id: string, vehicleGroupId: string, packageHours: number, packagePriceMinor: number): PriceRule & { id: string } =>
  rule(id, "tokyo", vehicleGroupId, packageHours, { model: "charter_package", packageKm: 150, packagePriceMinor, overtimePerHourMinor: 5_000, overKmPerKmMinor: 400 });
const surcharge = (id: string, areaId: string, vehicleGroupId: string, packageHours: number, pickup: number, dropoff: number, extra: Partial<PriceRule> = {}): PriceRule & { id: string } =>
  rule(id, areaId, vehicleGroupId, packageHours, { model: "charter_area_surcharge", pickupSurchargeMinor: pickup, dropoffSurchargeMinor: dropoff }, extra);
const adjust = (id: string, steps: AdjustRule["steps"], extra: Partial<AdjustRule> = {}): AdjustRule & { id: string } => ({ id, name: id, travelFrom: null, travelTo: null, cycle: { type: "daily" }, timeSlot: null, areaIds: [], vehicleGroupIds: [], directions: [], packageHours: [], steps, status: "enabled", ...extra });

export const GOLDEN_PRICE_RULES: readonly (PriceRule & { id: string })[] = [
  pkg("p-biz-8", "biz7", 8, 50_000),
  pkg("p-biz-10", "biz7", 10, 55_000),
  pkg("p-eco-8", "eco4", 8, 30_000),
  surcharge("s-fuji-biz-8", "fuji", "biz7", 8, 1_000, 1_000),
  surcharge("s-fujin-biz-8", "fuji-north", "biz7", 8, 1_500, 700),
  surcharge("s-hachi-biz-8", "hachioji", "biz7", 8, 800, 800),
  surcharge("s-chiba-biz-8", "chiba", "biz7", 8, 500, 500),
  surcharge("s-wide-biz-8", "wide-chiba", "biz7", 8, 300, 700),
  surcharge("s-kama-biz-8", "kamakura", "biz7", 8, 600, 600, { status: "disabled" }),
  surcharge("s-kama-biz-10", "kamakura", "biz7", 10, 600, 600),
  surcharge("s-karu-biz-8", "karuizawa", "biz7", 8, 900, 900, { validFrom: "2027-01-01" }),
  surcharge("s-fuji-biz-10", "fuji", "biz7", 10, 10_000, 10_000),
  surcharge("s-fujin-biz-10", "fuji-north", "biz7", 10, 2_000, 0),
  surcharge("s-chiba-biz-10", "chiba", "biz7", 10, 0, 0),
  surcharge("s-hachi-biz-10", "hachioji", "biz7", 10, 800, 800),
  surcharge("s-fuji-eco-8", "fuji", "eco4", 8, 700, 700),
  surcharge("s-chiba-eco-8", "chiba", "eco4", 8, 300, 300),
  surcharge("s-sai-eco-8", "saitama", "eco4", 8, 400, 400),
];

const SURCHARGE_AREAS = [GOLDEN_AREAS.fuji, GOLDEN_AREAS.fujiNorth, GOLDEN_AREAS.hachioji, GOLDEN_AREAS.chiba, GOLDEN_AREAS.wideChiba, GOLDEN_AREAS.kamakura, GOLDEN_AREAS.karuizawa, GOLDEN_AREAS.saitama];

const serviceRules = (extra: Partial<ServiceRules> = {}): ServiceRules => ({
  ...emptyServiceRules(),
  booking: { saleFrom: null, saleTo: null, serviceTime: { start: "00:00", end: "24:00" }, leadTimeHours: 24, note: null },
  freeWait: { pickup: null, dropoff: null, general: { mode: "limited", minutes: 0 } },
  ...extra,
});

const baseProduct = (productId: string, extra: Partial<QuoteProduct> = {}): QuoteProduct => ({
  productId,
  tenantId: "tenant-a",
  category: "charter",
  status: "published",
  tenantActive: true,
  brandActive: true,
  currency: "JPY",
  roundingUnit: 1,
  timeZone: "Asia/Tokyo",
  pickupPlace: null,
  areas: [GOLDEN_AREAS.tokyo],
  surchargeAreas: SURCHARGE_AREAS,
  vehicleGroups: [
    { vehicleGroupId: "biz7", passengers: 6, luggage: 4, active: true },
    { vehicleGroupId: "eco4", passengers: 3, luggage: 2, active: true },
  ],
  serviceRules: serviceRules(),
  addonCatalog: [],
  priceRules: GOLDEN_PRICE_RULES,
  adjustRules: [],
  inventoryMode: "unlimited",
  ...extra,
});

/** 几个商品：小东京、大东京（M8-38）、带禁行区、带运营范围（ADR 0075）、带调价 / 取整 / 加急 / 夜间 */
export const GOLDEN_PRODUCTS: readonly QuoteProduct[] = [
  baseProduct("small"),
  baseProduct("big", { areas: [GOLDEN_AREAS.bigTokyo] }),
  baseProduct("forbid", {
    areas: [withForbid(GOLDEN_AREAS.tokyo, square(139.72, 35.72, 139.78, 35.78))],
    surchargeAreas: SURCHARGE_AREAS.map((entry) => (entry.areaId === "chiba" ? withForbid(entry, square(140.05, 35.6, 140.15, 35.8)) : entry)),
  }),
  baseProduct("operating", {
    operatingAreas: [
      area("op-kanto", square(138.4, 35.0, 140.5, 36.5), { role: "both" }),
      withForbid(area("op-only", square(139.25, 35.6, 139.35, 35.8), { role: "operating" }), square(139.28, 35.68, 139.32, 35.72)),
    ],
  }),
  baseProduct("adjusted", {
    roundingUnit: 100,
    serviceRules: serviceRules({
      urgent: { enabled: true, dailyQuota: null, tiers: [{ withinHours: 12, surchargeMinor: 2_000 }] },
      night: { enabled: true, window: { start: "22:00", end: "06:00" }, amountMinor: 3_000, chargeUnit: "per_hour" },
    }),
    adjustRules: [adjust("weekend+10%", [{ type: "percent", value: 1_000 }], { cycle: { type: "weekly", weekdays: [6, 7] } }), adjust("10h-300", [{ type: "amount", value: -300 }], { packageHours: [10] }), adjust("fuji+5%", [{ type: "percent", value: 500 }], { areaIds: ["tokyo"] })],
  }),
];

const NOW = new Date("2026-10-07T01:00:00Z");
/** 平日白天、周六深夜（周末 + 夜间）、加急（12 小时内） */
const TIMES = ["2026-10-20T10:00", "2026-10-24T23:30", "2026-10-07T15:00"] as const;
const USD: FxQuote = { from: "JPY", to: "USD", rate: "0.0067", asOf: "2026-10-07T00:00:00Z" };

export interface GoldenSample {
  key: string;
  product: QuoteProduct;
  request: QuoteRequest;
  moment: QuoteMoment;
}

export function charterGoldenRequest(pickup: GoldenPoint, dropoff: GoldenPoint | null, packageHours: number, serviceLocal: string): QuoteRequest {
  return { category: "charter", pickup: GOLDEN_POINTS[pickup], dropoff: dropoff === null ? null : GOLDEN_POINTS[dropoff], direction: null, packageHours, serviceLocal, passengers: 2, luggage: 1, addons: [], driverLanguage: null, vehicleGroupIds: [] };
}

/** 全部样例（确定的顺序）：只有「adjusted」商品跑三个时间，别的只跑平日白天 */
export function charterGoldenSamples(): GoldenSample[] {
  const samples: GoldenSample[] = [];
  const points = Object.keys(GOLDEN_POINTS) as GoldenPoint[];
  for (const product of GOLDEN_PRODUCTS) {
    for (const serviceLocal of product.productId === "adjusted" ? TIMES : TIMES.slice(0, 1)) {
      const moment: QuoteMoment = { now: NOW, route: null, inventoryDay: null, urgentUsed: 0 };
      for (const hours of [8, 10]) {
        for (const pickup of points) {
          for (const dropoff of [...points, null]) {
            samples.push({ key: `${product.productId}|${serviceLocal}|${hours}h|${pickup}→${dropoff ?? "none"}`, product, request: charterGoldenRequest(pickup, dropoff, hours, serviceLocal), moment });
          }
        }
      }
    }
  }
  return samples;
}

/** 一个样例的全部输出：商品报价（整个对象）、日元和美元两次比价（快照里的中标对外价、对外价参考） */
export function charterGoldenOutput(sample: GoldenSample): unknown {
  const quote = quoteProduct(sample.product, sample.request, sample.moment);
  const entry = { quote, productVersion: 1, standing: { scoreCenti: null, completedOrders: 0, observation: false }, markupBp: () => 1_500 };
  const jpy = compareQuotes({ request: sample.request, currency: "JPY", now: sample.moment.now, entries: [{ ...entry, fx: null }] });
  const usd = compareQuotes({ request: sample.request, currency: "USD", now: sample.moment.now, entries: [{ ...entry, fx: USD }] });
  return JSON.parse(JSON.stringify({ quote, jpy, usd }));
}

/** 看得懂的摘要：每个车型组的结算价和两端加价（或原因） */
function summary(output: unknown): string {
  const { quote } = output as { quote: ReturnType<typeof quoteProduct> };
  if (!quote.ok) return quote.reason;
  const offers = quote.offers.map((offer) => {
    const surcharge = offer.settlement.areaSurcharge;
    const ends = surcharge === undefined || surcharge === null ? "" : `(${surcharge.pickup.areaId ?? "-"}+${surcharge.pickup.amountMinor},${surcharge.dropoff.areaId ?? "-"}+${surcharge.dropoff.amountMinor})`;
    return `${offer.vehicleGroupId}:${offer.settlement.totalMinor}${ends}`;
  });
  return [...offers, ...quote.refused.map((entry) => `${entry.vehicleGroupId}:${entry.reason}`)].join(" ");
}

/** golden 的一条：摘要（给人看）+ 全部输出的 SHA-256（逐字段比） */
export function charterGoldenEntry(sample: GoldenSample): { summary: string; sha256: string } {
  const output = charterGoldenOutput(sample);
  return { summary: summary(output), sha256: createHash("sha256").update(JSON.stringify(output)).digest("hex") };
}

export function charterGoldenResults(): Record<string, { summary: string; sha256: string }> {
  return Object.fromEntries(charterGoldenSamples().map((sample) => [sample.key, charterGoldenEntry(sample)]));
}
