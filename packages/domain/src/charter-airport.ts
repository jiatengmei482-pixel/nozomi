/**
 * 包车机场开始 / 机场结束套餐（M9P-21，ADR 0098）：
 * - 商品级机场绑定：场景 × 机场（主数据）× 机场区域（只用来判断上 / 下车点在不在机场，第三节第 2 小节）；
 * - 机场套餐价（价格方式 `charter_airport_package`）：有这一格 = 单独定价（替换普通套餐价、免掉场景那一端的机场加价），没有 = 继承。
 * 这里只放纯判断；怎么接进报价引擎见 `quote.ts` 的 `quoteProduct`（按场景各报一遍取低）和 `quoteAtHours`（场景参数）。
 */
import type { LatLng } from "./geo.ts";
import { type CharterPackagePricing, type PriceRule, priceRuleCoversDate, selectPriceRule } from "./pricing.ts";
import { type QuoteArea, locateInAreas } from "./quote.ts";

export const AIRPORT_SCENARIO_KINDS = ["airport_start", "airport_end"] as const;
export type AirportScenarioKind = (typeof AIRPORT_SCENARIO_KINDS)[number];

/** 商品的一条机场绑定（报价用）：`area` 是机场区域和它的图形，`name` 是前台名称里的机场名（中文简称，没填用主数据中文名） */
export interface AirportBinding {
  scenario: AirportScenarioKind;
  placeId: string;
  area: QuoteArea;
  name: string;
}

/** 这一单匹配到的一个场景 */
export interface AirportScenario {
  kind: AirportScenarioKind;
  placeId: string;
  areaId: string;
  name: string;
}

/** 场景对应的那一端：机场开始 = 上车，机场结束 = 下车（也是机场套餐价规则的 `direction`） */
export function scenarioEnd(kind: AirportScenarioKind): "pickup" | "dropoff" {
  return kind === "airport_start" ? "pickup" : "dropoff";
}

/**
 * 这一单能用的场景（ADR 0098 第三节第 4 小节第 1 步）：上车点落在某个「机场开始」绑定的机场区域里 → 机场开始；下车点落在某个「机场结束」绑定的机场区域里 → 机场结束。
 * 同一场景几个机场区域都包含这个点时按绑定的先后取第一个；停用的区域不算（`locateInAreas` 跳过）。机场开始排在前面（机场 → 机场一样价时取它）。
 */
export function airportScenarios(bindings: readonly AirportBinding[], pickup: LatLng | null, dropoff: LatLng | null): AirportScenario[] {
  const found: AirportScenario[] = [];
  for (const kind of AIRPORT_SCENARIO_KINDS) {
    const point = kind === "airport_start" ? pickup : dropoff;
    if (point === null) continue;
    const hit = bindings.find((binding) => binding.scenario === kind && locateInAreas([binding.area], point).operating.length > 0);
    if (hit !== undefined) found.push({ kind, placeId: hit.placeId, areaId: hit.area.areaId, name: hit.name });
  }
  return found;
}

/** 机场套餐价的一格：这个机场区域 × 方向 × 车型组 × 套餐时长、启用、用车日期在生效期内的那一条（没有 = 继承） */
export function airportPackageRule<T extends PriceRule>(rules: readonly T[], query: { scenario: AirportScenario; vehicleGroupId: string; packageHours: number | null; date: string }): T | null {
  const direction = scenarioEnd(query.scenario.kind);
  return (
    rules.find(
      (rule) =>
        rule.pricing.model === "charter_airport_package" &&
        rule.status === "enabled" &&
        rule.areaId === query.scenario.areaId &&
        rule.direction === direction &&
        rule.vehicleGroupId === query.vehicleGroupId &&
        rule.packageHours === query.packageHours &&
        priceRuleCoversDate(rule, query.date),
    ) ?? null
  );
}

/**
 * 机场套餐价补齐成一份完整的包车套餐价（ADR 0098 第三节第 3 小节）：含公里、超公里单价、超时单价没填的取同一车型组同一时长的普通套餐价（整商品套餐价）。
 * 普通套餐价没有、而机场套餐价又没填齐 → null（这一档报不出）。
 */
export function airportPackagePricing(rules: readonly PriceRule[], airport: PriceRule, date: string): CharterPackagePricing | null {
  if (airport.pricing.model !== "charter_airport_package") return null;
  const own = airport.pricing;
  const normalRule =
    own.packageKm !== undefined && own.overKmPerKmMinor !== undefined && own.overtimePerHourMinor !== undefined
      ? null
      : selectPriceRule(rules, { areaId: "", productWide: true, vehicleGroupId: airport.vehicleGroupId, direction: null, packageHours: airport.packageHours, date });
  const normal = normalRule !== null && normalRule.pricing.model === "charter_package" ? normalRule.pricing : null;
  const packageKm = own.packageKm ?? normal?.packageKm;
  const overKmPerKmMinor = own.overKmPerKmMinor ?? normal?.overKmPerKmMinor;
  const overtimePerHourMinor = own.overtimePerHourMinor ?? normal?.overtimePerHourMinor;
  if (packageKm === undefined || overKmPerKmMinor === undefined || overtimePerHourMinor === undefined) return null;
  return { model: "charter_package", packageKm, packagePriceMinor: own.packagePriceMinor, overKmPerKmMinor, overtimePerHourMinor };
}

/** 套餐行的前台名称（ADR 0098 第三节第 5 小节）：「成田机场接机 + 5 小时包车」「5 小时包车 + 羽田机场送机」。只有中文，多语言在 M11 */
export function charterScenarioLabel(kind: AirportScenarioKind, name: string, hours: number): string {
  return kind === "airport_start" ? `${name}接机 + ${hours} 小时包车` : `${hours} 小时包车 + ${name}送机`;
}
