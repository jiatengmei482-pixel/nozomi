/**
 * 包车行程地图和编号（M9P-20，ADR 0096）新增的固定文案，按键取（负责人 2026-11-15 定：新功能先只做中文，文案一律走键，不写死在组件里，M11-01）。
 * 写法同嵌入页的 `EMBED_TEXTS`（按语言一张表）：中文必填；日文、英文暂时留空，取不到时退回中文，以后补译只改这里。
 * `{名字}` 是占位，由 `itineraryCopy` 按参数替换。
 */
export type ItineraryLang = "zh" | "ja" | "en";

export type ItineraryTextKey =
  | "pickup"
  | "stop"
  | "dropoff"
  | "routeTitle"
  | "listOnly"
  | "updating"
  | "mapAlt"
  | "mapAltTotal"
  | "drive"
  | "driveKm"
  | "breakdownStops"
  | "unavailableStop"
  | "legFailure"
  | "areaStops"
  | "navigateTo"
  | "suggestTitle"
  | "suggestTitleSame"
  | "suggestTooLong"
  | "suggestPending"
  | "suggestCurrent"
  | "suggestSuggested"
  | "suggestAdopt"
  | "suggestKeep"
  | "suggestRecomputing"
  | "suggestRestore"
  | "suggestAdopted"
  | "suggestRestored"
  | "suggestPriceUpdated"
  | "suggestPrice"
  | "suggestRegion"
  | "optimizeTitle"
  | "optimizeIntro"
  | "optimizeCalls"
  | "optimizeLimit"
  | "optimizeRefused"
  | "rulesSuggestLegend"
  | "rulesSuggestLabel"
  | "rulesSuggestHint"
  | "arriveByLabel"
  | "arriveByNextDay"
  | "arriveByLaterDay"
  | "arriveByFormat"
  | "arriveByDeadline"
  | "arriveByLocked"
  | "arriveByLockedIcon"
  | "arriveByLate"
  | "arriveByLateStop"
  | "arriveByFieldHint"
  | "etaDepart"
  | "etaArrive"
  | "etaSummary"
  | "etaNote";

const ZH: Readonly<Record<ItineraryTextKey, string>> = {
  pickup: "上车",
  stop: "经停",
  dropoff: "下车",
  routeTitle: "行程路线",
  listOnly: "经停较多，仅显示列表",
  updating: "路线更新中",
  mapAlt: "路线图：{chain}",
  mapAltTotal: "路线图：{chain}，约 {duration} · {km}",
  drive: "行驶约 {duration}",
  driveKm: "行驶约 {duration} · {km}",
  breakdownStops: "{numbers} · 经停",
  unavailableStop: "{number} 号点「{name}」",
  legFailure: "第 {leg} 段（{from}「{fromName}」→ {to}「{toName}」）",
  areaStops: "经停（{numbers} 号点）",
  navigateTo: "导航到 {number} 号点",
  suggestTitle: "建议顺序，可省 {saved}",
  suggestTitleSame: "建议顺序，可省 {saved}，价格不变",
  suggestTooLong: "当前顺序超过在线下单时长，按建议顺序约 {duration}，可以在线下单",
  suggestPending: "建议顺序：计算中…",
  suggestCurrent: "当前顺序",
  suggestSuggested: "建议顺序",
  suggestAdopt: "采用建议顺序",
  suggestKeep: "保持我的顺序",
  suggestRecomputing: "正在按最新行程重算建议…",
  suggestRestore: "恢复原来的顺序",
  suggestAdopted: "已按建议顺序排列：{chain}",
  suggestRestored: "已恢复原来的顺序",
  suggestPriceUpdated: "价格已更新：{vehicle} {price}",
  suggestPrice: "{vehicle} {price}",
  suggestRegion: "经停顺序建议",
  optimizeTitle: "经停顺序建议（谷歌地图）",
  optimizeIntro: "包车客人填 2 个以上经停时，用谷歌地图算更省路程的顺序（按调用次数计费，比路线预估贵一倍）。同一组经停 24 小时内不再调用；次数按东京时间每天 0 点重新计。",
  optimizeCalls: "今天的调用（{day}）",
  optimizeLimit: "{calls} / {limit} 次（含重试）",
  optimizeRefused: "今天被上限挡下",
  rulesSuggestLegend: "经停顺序建议",
  rulesSuggestLabel: "提示更省路程的经停顺序",
  rulesSuggestHint: "客人填 2 个以上经停时，提示更省路程的顺序，并给出按建议顺序的价格。关了只是这个商品不显示建议价，客人自己排的任何顺序照常报价。默认开。",
  arriveByLabel: "经停点 {number} 指定到达时间（选填）",
  arriveByNextDay: "次日 {time}",
  arriveByLaterDay: "第 {day} 天 {time}",
  arriveByFormat: "请按 HH:MM 填写到达时间，或清空",
  arriveByDeadline: "须在 {time} 前到达",
  arriveByLocked: "{name}，须在 {time} 前到达，已锁定，不参与建议顺序，只能用上移 / 下移调整",
  arriveByLockedIcon: "已锁定",
  arriveByLate: "预计 {eta} 到，晚于指定的 {time}，请把上车时间提前至少 {minutes} 分钟",
  arriveByLateStop: "{name}：预计 {eta} 到，晚于指定的 {time}",
  arriveByFieldHint: "填了指定到达时间的经停会锁定位置，不参与建议顺序。",
  etaDepart: "{time} 出发",
  etaArrive: "{time} 到达{name}",
  etaSummary: "预计 {arrive} 到，{depart} 出发",
  etaNote: "到达、出发时间按路线和停留预计，实际以路况为准。",
};

export const ITINERARY_TEXTS: Readonly<Record<ItineraryLang, Partial<Record<ItineraryTextKey, string>>>> = { zh: ZH, ja: {}, en: {} };

/** 按键取文案，替换 `{占位}`；这个语言没有译文时用中文。 */
export function itineraryCopy(key: ItineraryTextKey, params: Readonly<Record<string, string | number>> = {}, lang: ItineraryLang = "zh"): string {
  const template = ITINERARY_TEXTS[lang][key] || ZH[key];
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}
