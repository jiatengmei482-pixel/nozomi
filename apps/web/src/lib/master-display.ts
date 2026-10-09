/**
 * 主数据各种值在界面上的写法（docs/design/04-data-display.md 第 6 节）。全站只有这一处，页面不各自决定。
 */
import {
  type AddonChargeUnit,
  type FlightScope,
  type LocalizedText,
  type MasterDataLanguage,
  type MasterDataStatus,
  PLACE_CATEGORY_NAMES,
  type PlaceCategory,
  type PlaceType,
  type ServiceCategory,
  VEHICLE_GRADE_NAMES,
  type VehicleGrade,
  type VehiclePower,
  hasVisibleText,
} from "@nozomi/domain";
import type { Point } from "../api/master.ts";
import type { BadgeSpec } from "../components/StatusBadge.tsx";

/** 输入时四种语言的顺序。 */
export const INPUT_LANGUAGES: readonly { key: MasterDataLanguage; label: string; lang: string }[] = [
  { key: "zh", label: "中文", lang: "zh-Hans" },
  { key: "ja", label: "日语", lang: "ja" },
  { key: "en", label: "英语", lang: "en" },
  { key: "ko", label: "韩语", lang: "ko" },
];
const DISPLAY_ORDER: readonly MasterDataLanguage[] = ["zh", "en", "ja", "ko"];
const HTML_LANG: Readonly<Record<MasterDataLanguage, string>> = { zh: "zh-Hans", ja: "ja", en: "en", ko: "ko" };

export interface DisplayText {
  text: string;
  lang: string;
}

/** 显示名：按 中文 → 英语 → 日语 → 韩语 取第一个有内容的。 */
export function displayName(name: LocalizedText | null | undefined): DisplayText {
  for (const key of DISPLAY_ORDER) {
    const text = name?.[key];
    if (text !== undefined && hasVisibleText(text)) return { text, lang: HTML_LANG[key] };
  }
  return { text: "—", lang: "zh-Hans" };
}

/** 显示名之外其余语言的名称。 */
export function otherNames(name: LocalizedText | null | undefined): DisplayText[] {
  const shown = displayName(name);
  return DISPLAY_ORDER.flatMap((key) => {
    const text = name?.[key];
    return text !== undefined && hasVisibleText(text) && !(text === shown.text && HTML_LANG[key] === shown.lang) ? [{ text, lang: HTML_LANG[key] }] : [];
  });
}

export const MASTER_STATUS_BADGES: Readonly<Record<MasterDataStatus, BadgeSpec>> = {
  active: { tone: "success", label: "启用" },
  disabled: { tone: "neutral", label: "已停用" },
};

let regionNames: Intl.DisplayNames | null = null;
/** 中文国名；取不到名字的返回 null。 */
export function countryName(code: string): string | null {
  try {
    regionNames ??= new Intl.DisplayNames("zh-Hans", { type: "region" });
    const name = regionNames.of(code);
    return name !== undefined && name !== code ? name : null;
  } catch {
    return null;
  }
}

/** 「日本（JP）」；取不到国名时只有代码。 */
export function countryLabel(code: string): string {
  const name = countryName(code);
  return name === null ? code : `${name}（${code}）`;
}

/** 时区今天实际生效的偏移，写成「UTC+9」「UTC-3:30」；认不出的时区返回 null。 */
export function timeZoneOffset(timeZone: string, at: Date = new Date()): string | null {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(at).find((entry) => entry.type === "timeZoneName");
    const match = /GMT(?:([+-])(\d{2}):(\d{2}))?/.exec(part?.value ?? "");
    if (!match) return null;
    if (match[1] === undefined) return "UTC+0";
    const hours = Number(match[2]);
    return `UTC${match[1]}${hours}${match[3] === "00" ? "" : `:${match[3]}`}`;
  } catch {
    return null;
  }
}

export function timeZoneLabel(timeZone: string, at: Date = new Date()): string {
  const offset = timeZoneOffset(timeZone, at);
  return offset === null ? timeZone : `${timeZone}（${offset}）`;
}

export function formatCoordinate(value: number): string {
  return value.toFixed(6);
}

/** 界面上永远是「纬度, 经度」。 */
export function formatPoint(point: Point): string {
  return `${formatCoordinate(point.lat)}, ${formatCoordinate(point.lng)}`;
}

export const PLACE_TYPE_NAMES: Readonly<Record<PlaceType, string>> = { airport: "机场", station: "车站", poi: "地标", terminal: "航站楼", exit: "出口" };
export const FLIGHT_SCOPE_NAMES: Readonly<Record<FlightScope, string>> = { international: "国际", domestic: "国内", mixed: "国际和国内" };
export const VEHICLE_POWER_NAMES: Readonly<Record<VehiclePower, string>> = { fuel: "燃油", ev: "电动" };
export const SERVICE_CATEGORY_NAMES: Readonly<Record<ServiceCategory, string>> = { airport_transfer: "接送机", point_to_point: "点对点", charter: "包车" };
export const CHARGE_UNIT_NAMES: Readonly<Record<AddonChargeUnit, string>> = { per_order: "按次", per_item: "按个", per_person: "按人", per_duration: "按时长" };
export const CHARGE_UNIT_HINTS: Readonly<Record<AddonChargeUnit, string>> = {
  per_order: "每个订单收一次",
  per_item: "按数量收，例如每个座椅",
  per_person: "按乘客人数收",
  per_duration: "按服务时长收",
};

export function placeCategoryName(category: PlaceCategory | null): string {
  return category === null ? "—" : PLACE_CATEGORY_NAMES[category];
}
export function flightScopeName(scope: FlightScope | null): string {
  return scope === null ? "—" : FLIGHT_SCOPE_NAMES[scope];
}
export function vehicleGradeName(grade: VehicleGrade): string {
  return VEHICLE_GRADE_NAMES[grade];
}

const countFormat = new Intl.NumberFormat("zh-Hans");
/** 带千分位的数量。 */
export function formatCount(value: number): string {
  return countFormat.format(value);
}

/** 与操作有关的时间：按查看者本地时区，`YYYY-MM-DD HH:mm`。 */
export function formatLocalDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** 提交前整理多语言内容：去掉首尾空格，只留有内容的语言。 */
export function cleanLocalized(value: LocalizedText): LocalizedText {
  const result: LocalizedText = {};
  for (const { key } of INPUT_LANGUAGES) {
    const text = (value[key] ?? "").trim();
    if (hasVisibleText(text)) result[key] = text;
  }
  return result;
}

export function sameLocalized(a: LocalizedText, b: LocalizedText): boolean {
  const left = cleanLocalized(a);
  const right = cleanLocalized(b);
  return INPUT_LANGUAGES.every(({ key }) => (left[key] ?? "") === (right[key] ?? ""));
}

/** Toast 里的对象名超过 20 个字时截断。 */
export function shortName(text: string): string {
  const characters = [...text];
  return characters.length > 20 ? `${characters.slice(0, 20).join("")}…` : text;
}
