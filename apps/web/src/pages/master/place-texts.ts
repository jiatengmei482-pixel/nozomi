/**
 * 主数据地点编辑页里机场、航站楼的「地址」「集合地点说明」（M12-06）新增的固定文案，按键取。
 * 写法同 `apps/web/src/lib/checkout-texts.ts`：中文必填；日文、英文暂时留空，取不到时退回中文。`{名字}` 是占位，由 `placeCopy` 按参数替换。
 */
export type PlaceLang = "zh" | "ja" | "en";

export type PlaceTextKey =
  | "addressHintAirport"
  | "meetingPointLegend"
  | "meetingPointHintAirport"
  | "meetingPointHintTerminal"
  | "meetingPointZh"
  | "meetingPointJa"
  | "meetingPointEn"
  | "meetingPointZhRequired"
  | "meetingPointTooLong";

const ZH: Readonly<Record<PlaceTextKey, string>> = {
  addressHintAirport: "日文地址，含邮编，例如 〒144-0041 東京都大田区羽田空港3-3-2。",
  meetingPointLegend: "集合地点说明",
  meetingPointHintAirport: "司机在哪里等客人、客人怎么找到司机。只有一个航站楼的机场写在这里；有多个航站楼的写在各航站楼上。选填；填的话中文必填，日文、英文选填。供应商也看得到。",
  meetingPointHintTerminal: "司机在这个航站楼的哪里等客人、客人怎么找到司机。选填；填的话中文必填，日文、英文选填。供应商也看得到。",
  meetingPointZh: "中文",
  meetingPointJa: "日文（选填）",
  meetingPointEn: "英文（选填）",
  meetingPointZhRequired: "填了日文或英文时，中文必填",
  meetingPointTooLong: "最多 {max} 个字",
};

export const PLACE_TEXTS: Readonly<Record<PlaceLang, Partial<Record<PlaceTextKey, string>>>> = { zh: ZH, ja: {}, en: {} };

export function placeCopy(key: PlaceTextKey, params: Readonly<Record<string, string | number>> = {}, lang: PlaceLang = "zh"): string {
  const template = PLACE_TEXTS[lang][key] ?? ZH[key];
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}
