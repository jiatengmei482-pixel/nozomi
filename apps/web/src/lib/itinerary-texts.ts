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
  | "navigateTo";

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
};

export const ITINERARY_TEXTS: Readonly<Record<ItineraryLang, Partial<Record<ItineraryTextKey, string>>>> = { zh: ZH, ja: {}, en: {} };

/** 按键取文案，替换 `{占位}`；这个语言没有译文时用中文。 */
export function itineraryCopy(key: ItineraryTextKey, params: Readonly<Record<string, string | number>> = {}, lang: ItineraryLang = "zh"): string {
  const template = ITINERARY_TEXTS[lang][key] || ZH[key];
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}
