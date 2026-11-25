/**
 * 机场 / 航站楼的地址、集合地点说明（M12-06）的校验说明和航站楼核对表导入的提示，按键取（docs/workflow.md「固定文案走 key」）。
 * 写法同 apps/web/src/lib/checkout-texts.ts：中文必填；日文、英文暂时留空，取不到时退回中文。`{名字}` 是占位，由 `placeContentText` 按参数替换。
 */
export type PlaceContentLang = "zh" | "ja" | "en";

export type PlaceContentTextKey =
  | "blank"
  | "untrimmed"
  | "tooLong"
  | "notObject"
  | "unknownLanguage"
  | "noLanguage"
  | "zhRequired"
  | "addressType"
  | "meetingPointType"
  | "terminalImportRunning"
  | "terminalImportCodeConflict";

const ZH: Readonly<Record<PlaceContentTextKey, string>> = {
  blank: "不能只有空白或不可见字符",
  untrimmed: "首尾不能有空白",
  tooLong: "最多 {max} 个字",
  notObject: "要是一个按语言分开的文字对象，例如 {\"zh\": \"…\"}",
  unknownLanguage: "只支持这些语言：{languages}",
  noLanguage: "至少填一种语言",
  zhRequired: "中文必填",
  addressType: "只有地标、机场和航站楼有地址",
  meetingPointType: "只有机场和航站楼有集合地点说明",
  terminalImportRunning: "另一个航站楼核对表导入正在运行。数据库没有任何变化，请等它结束后再试",
  terminalImportCodeConflict: "导入期间有人在后台新增了编码相同的航站楼。数据库没有任何变化，请再运行一次",
};

export const PLACE_CONTENT_TEXTS: Readonly<Record<PlaceContentLang, Partial<Record<PlaceContentTextKey, string>>>> = { zh: ZH, ja: {}, en: {} };

export function placeContentText(key: PlaceContentTextKey, params: Readonly<Record<string, string | number>> = {}, lang: PlaceContentLang = "zh"): string {
  const template = PLACE_CONTENT_TEXTS[lang][key] ?? ZH[key];
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in params ? String(params[name]) : whole));
}
