/**
 * 「包车按行程计价」的 golden 样例（M9W-11，ADR 0091 第四节第 5 小节）：引擎加「经停点默认占用、整单缓冲、最低套餐」之前，
 * 用当时的引擎对这些样例（不传 `packageCheck`、`lockedItinerary`）算一遍、写进 `itinerary-golden.json`；改引擎之后
 * `itinerary-golden.test.ts` 再算一遍，必须逐分、逐字段一致。
 *
 * 覆盖：各档（8、10 小时）、能覆盖的档 / 比行程短的档（超时）、正好等于套餐时长、超公里、带 0 / 1 / 2 个经停点（途经加价、经停点报不出）、
 * 加价区域、调价 / 取整 / 加急 / 夜间（「adjusted」商品），日元和美元两次比价。商品的服务规则用 charter-golden 的（没有新配置）。
 * 这里只构造测试数据，不进任何数据库。
 *
 * 重新生成（只在改引擎之前做过一次；以后不要重新生成，否则 golden 失去意义）：
 * `node -e 'import("./packages/domain/src/itinerary-golden.samples.ts").then((m) => process.stdout.write(JSON.stringify(m.itineraryGoldenResults(), null, 1) + "\n"))' > packages/domain/src/itinerary-golden.json`
 */
import { createHash } from "node:crypto";
import { GOLDEN_PRODUCTS, type GoldenPoint, GOLDEN_POINTS, charterGoldenRequest } from "./charter-golden.samples.ts";
import type { PriceRule } from "./pricing.ts";
import { type FxQuote, type QuoteMoment, type QuoteProduct, type QuoteRequest, type RouteUsage, compareQuotes, quoteProduct } from "./quote.ts";

const NOW = new Date("2026-10-07T01:00:00Z");
const TIMES = ["2026-10-20T10:00", "2026-10-24T23:30", "2026-10-07T15:00"] as const;
const USD: FxQuote = { from: "JPY", to: "USD", rate: "0.0067", asOf: "2026-10-07T00:00:00Z" };

/** 富士山、千叶两个加价区域另设途经加价（ADR 0088），其余规则和 charter-golden 一样 */
const withWaypointSurcharge = (rule: PriceRule & { id: string }): PriceRule & { id: string } =>
  rule.pricing.model === "charter_area_surcharge" && (rule.areaId === "fuji" || rule.areaId === "chiba") ? { ...rule, pricing: { ...rule.pricing, waypointSurchargeMinor: rule.areaId === "fuji" ? 3_000 : 1_200 } } : rule;

/** 用 small、big、operating、adjusted 四个商品（禁行区那个和行程计价无关） */
export const ITINERARY_GOLDEN_PRODUCTS: readonly QuoteProduct[] = GOLDEN_PRODUCTS.filter((product) => product.productId !== "forbid").map((product) => ({ ...product, priceRules: product.priceRules.map(withWaypointSurcharge) }));

/** 全程米数、总时长（分钟）：短（两档都能覆盖）、正好 8 小时、8–10 小时之间、正好 10 小时、超过 10 小时、很长 */
const USAGES: readonly RouteUsage[] = [
  { meters: 80_000, minutes: 240, legs: [{ meters: 80_000, minutes: 240 }], stayMinutes: 0 },
  { meters: 150_000, minutes: 480 },
  { meters: 160_400, minutes: 540 },
  { meters: 260_000, minutes: 600 },
  { meters: 260_000, minutes: 650 },
  { meters: 520_500, minutes: 1_333 },
];

/** 上 / 下车和经停点的组合 */
const TRIPS: readonly { pickup: GoldenPoint; dropoff: GoldenPoint; waypoints: GoldenPoint[] }[] = [
  { pickup: "tokyo", dropoff: "tokyo", waypoints: [] },
  { pickup: "tokyo", dropoff: "tokyo", waypoints: ["fuji"] },
  { pickup: "tokyo", dropoff: "tokyo", waypoints: ["fuji", "chiba"] },
  { pickup: "tokyo", dropoff: "fuji", waypoints: ["fuji"] },
  { pickup: "hachioji", dropoff: "tokyo", waypoints: ["chiba", "kamakura"] },
  { pickup: "tokyo", dropoff: "tokyo", waypoints: ["nowhere"] },
  { pickup: "fujiOverlap", dropoff: "chiba", waypoints: ["saitama"] },
];

export interface ItineraryGoldenSample {
  key: string;
  product: QuoteProduct;
  request: QuoteRequest;
  moment: QuoteMoment;
}

export function itineraryGoldenRequest(trip: (typeof TRIPS)[number], routeUsage: RouteUsage, packageHours: number, serviceLocal: string): QuoteRequest {
  const base = charterGoldenRequest(trip.pickup, trip.dropoff, packageHours, serviceLocal);
  return { ...base, ...(trip.waypoints.length === 0 ? {} : { waypoints: trip.waypoints.map((point, index) => ({ ...GOLDEN_POINTS[point], name: `stop-${index + 1}`, stay_minutes: 30 })) }), routeUsage };
}

/** 全部样例（确定的顺序）：只有「adjusted」商品跑三个时间 */
export function itineraryGoldenSamples(): ItineraryGoldenSample[] {
  const samples: ItineraryGoldenSample[] = [];
  for (const product of ITINERARY_GOLDEN_PRODUCTS) {
    for (const serviceLocal of product.productId === "adjusted" ? TIMES : TIMES.slice(0, 1)) {
      const moment: QuoteMoment = { now: NOW, route: null, inventoryDay: null, urgentUsed: 0 };
      for (const hours of [8, 10]) {
        for (const usage of USAGES) {
          for (const trip of TRIPS) {
            const key = `${product.productId}|${serviceLocal}|${hours}h|${usage.meters}m/${usage.minutes}min|${trip.pickup}→${trip.waypoints.join("+") || "-"}→${trip.dropoff}`;
            samples.push({ key, product, request: itineraryGoldenRequest(trip, usage, hours, serviceLocal), moment });
          }
        }
      }
    }
  }
  return samples;
}

/** 一个样例的全部输出：商品报价（整个对象）、日元和美元两次比价 */
export function itineraryGoldenOutput(sample: ItineraryGoldenSample, options: Parameters<typeof quoteProduct>[3] = {}): unknown {
  const quote = quoteProduct(sample.product, sample.request, sample.moment, options);
  const entry = { quote, productVersion: 1, standing: { scoreCenti: null, completedOrders: 0, observation: false }, markupBp: () => 1_500 };
  const jpy = compareQuotes({ request: sample.request, currency: "JPY", now: sample.moment.now, entries: [{ ...entry, fx: null }] });
  const usd = compareQuotes({ request: sample.request, currency: "USD", now: sample.moment.now, entries: [{ ...entry, fx: USD }] });
  return JSON.parse(JSON.stringify({ quote, jpy, usd }));
}

function summary(output: unknown): string {
  const { quote } = output as { quote: ReturnType<typeof quoteProduct> };
  if (!quote.ok) return quote.reason;
  const offers = quote.offers.map((offer) => `${offer.vehicleGroupId}:${offer.settlement.totalMinor}(km+${offer.settlement.itinerary?.overKmMinor ?? "-"},ot+${offer.settlement.itinerary?.overtimeMinor ?? "-"})`);
  return [...offers, ...quote.refused.map((entry) => `${entry.vehicleGroupId}:${entry.reason}${entry.stopSeq === undefined ? "" : `@${entry.stopSeq}`}`)].join(" ");
}

export function itineraryGoldenEntry(sample: ItineraryGoldenSample, options: Parameters<typeof quoteProduct>[3] = {}): { summary: string; sha256: string } {
  const output = itineraryGoldenOutput(sample, options);
  return { summary: summary(output), sha256: createHash("sha256").update(JSON.stringify(output)).digest("hex") };
}

export function itineraryGoldenResults(): Record<string, { summary: string; sha256: string }> {
  return Object.fromEntries(itineraryGoldenSamples().map((sample) => [sample.key, itineraryGoldenEntry(sample)]));
}
