/**
 * 包车机场开始 / 机场结束套餐的固定文案（M9P-22，ADR 0098 第三节第 5 小节）。按 M11-01：新文案只做中文、走 i18n key；
 * M11-01 的公用 i18n 模块还没合并（#258），先在这里放一份只含中文的同名 key 表，M11 时并入公用模块（key 不变）。
 */
import type { SitePriceBreakdownItem } from "../api/site.ts";

export const CHARTER_AIRPORT_COPY = {
  "charter.scenario.airportStart": "{airport}接机 + {hours} 小时包车",
  "charter.scenario.airportEnd": "{hours} 小时包车 + {airport}送机",
  "book.charter.quickAirportStart": "机场接机开始",
  "book.charter.quickAirportEnd": "机场送机结束",
  "book.charter.pickTerminal": "选择航站楼",
  "book.charter.quickExit": "改填其他地点",
  "book.notes.flightHint": "如需司机知道航班号，请填在这里",
  "book.charter.airportTimingHint": "包车从预约的上车时间开始计时，没有免费等待；航班可能延误时请预留时间，或下单前联系客服",
  "order.charterScenario.airportStart": "{airport}接机",
  "order.charterScenario.airportEnd": "{airport}送机",
  "order.charterScenario.own": "单独定价，已含{end}加价",
  "order.charterScenario.inherit": "继承普通套餐价",
  "order.charterScenario.line": "机场套餐：{what}（{how}）",
  "order.charterScenario.endPickup": "上车",
  "order.charterScenario.endDropoff": "下车",
  "order.charterScenario.included": "含在机场套餐里，不另加",
} as const;

export type CharterAirportCopyKey = keyof typeof CHARTER_AIRPORT_COPY;

/** 按 key 取文案，`{name}` 换成给的值 */
export function charterAirportText(key: CharterAirportCopyKey, vars: Readonly<Record<string, string | number>> = {}): string {
  return CHARTER_AIRPORT_COPY[key].replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole));
}

type Scenario = NonNullable<SitePriceBreakdownItem["scenario"]>;

/** 套餐行的场景名：「成田机场接机 + 5 小时包车」「5 小时包车 + 羽田机场送机」（官网明细、司机页共用） */
export function scenarioPackageLabel(scenario: Pick<Scenario, "kind" | "airport_name">, hours: number): string {
  return charterAirportText(scenario.kind === "airport_start" ? "charter.scenario.airportStart" : "charter.scenario.airportEnd", { airport: scenario.airport_name, hours });
}

/** 这一份报价匹配到的机场场景（套餐那一项带的）；没有为 null */
export function quoteScenario(quote: { price_breakdown?: readonly SitePriceBreakdownItem[] }): Scenario | null {
  return quote.price_breakdown?.find((item) => item.kind === "base")?.scenario ?? null;
}
