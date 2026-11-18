/**
 * 包车按上下车点匹配商品、选询价城市（M9P-02，ADR 0093 第三节；业主规格 2026-11-14 步骤 1）。
 *
 * 包车不再按「上车点所在城市」筛商品：上车点、下车点都落在某个商品的①基础价区域（商品自己的区域）或③上下车加价区域
 * （有启用的区域加价规则的区域）里，这个商品就参与报价。经停点不影响匹配（只影响行程加价，由 `quoteProduct` 判断）。
 * 这里只决定「按哪个城市询价」：报不报、加多少仍由报价引擎逐个商品判断（运营范围、禁行区、规则齐不齐）。
 */
import type { LatLng } from "./geo.ts";
import { type PriceRule, surchargeAreaIds } from "./pricing.ts";
import { type QuoteProduct, locateInAreas } from "./quote.ts";

/** 匹配要看的那几项：①的图形、③的图形和区域加价规则（只看规则的区域、状态、价格方式） */
export type CharterMatchProduct = Pick<QuoteProduct, "areas" | "surchargeAreas"> & { priceRules: readonly Pick<PriceRule, "areaId" | "status" | "pricing">[] };

/**
 * 这个包车商品能不能参与报价：上车点、下车点都落在①（启用的区域的营运区里，不在它的禁行区里）或③里。
 * 和报价引擎 `charterEnds` 用同一套判断（`locateInAreas`、`surchargeAreaIds`）：③只认有启用的区域加价规则（`charter_area_surcharge`）的区域。
 */
export function charterMatches(product: CharterMatchProduct, pickup: LatLng, dropoff: LatLng): boolean {
  const ids = surchargeAreaIds(product.priceRules);
  const surcharge = (product.surchargeAreas ?? []).filter((area) => ids.includes(area.areaId));
  const inside = (point: LatLng): boolean => locateInAreas(product.areas, point).operating.length > 0 || locateInAreas(surcharge, point).operating.length > 0;
  return inside(pickup) && inside(dropoff);
}

/** 怎么选出的城市：只有一个；多个时按请求的 `city_id`、按上车点所在城市（`serviceCityOf`）、或取编号最小的 */
export type CharterCityChoice = "only" | "requested" | "pickup_city" | "smallest_id";

/**
 * 匹配到的商品分属几个城市时取哪一个（ADR 0093 第三节第 2 条）：只有一个就用它；多个时依次取
 * 请求带的 `city_id`（在匹配到的城市里时）→ 上车点所在城市（在匹配到的城市里时）→ 编号最小的。不逐城询价合并。
 * 一个都没匹配到为 null。
 */
export function chooseCharterCity(matchedCityIds: readonly string[], options: { requestedCityId: string | null; pickupCityId: string | null }): { cityId: string; by: CharterCityChoice } | null {
  const cities = [...new Set(matchedCityIds)].sort();
  const [first] = cities;
  if (first === undefined) return null;
  if (cities.length === 1) return { cityId: first, by: "only" };
  if (options.requestedCityId !== null && cities.includes(options.requestedCityId)) return { cityId: options.requestedCityId, by: "requested" };
  if (options.pickupCityId !== null && cities.includes(options.pickupCityId)) return { cityId: options.pickupCityId, by: "pickup_city" };
  return { cityId: first, by: "smallest_id" };
}
