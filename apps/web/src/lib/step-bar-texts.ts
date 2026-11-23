/**
 * 新预订页每一步的按钮条（M9E-32，ADR 0100：手机上固定在屏幕底部）新增的固定文案，按键取。
 * 写法同 `checkout-texts.ts`：中文必填；日文、英文暂时留空，取不到时退回中文，以后补译（M11-04）只改这里。
 */
export type StepBarLang = "zh" | "ja" | "en";

export type StepBarTextKey = "label" | "needVehicle" | "quoting" | "quoteFailed";

const ZH: Readonly<Record<StepBarTextKey, string>> = {
  label: "本步操作",
  needVehicle: "请先选择车型",
  quoting: "正在查询价格，查好后请选择车型",
  quoteFailed: "价格查询失败，请先点「重试」",
};

export const STEP_BAR_TEXTS: Readonly<Record<StepBarLang, Partial<Record<StepBarTextKey, string>>>> = { zh: ZH, ja: {}, en: {} };

export function stepBarCopy(key: StepBarTextKey, lang: StepBarLang = "zh"): string {
  return STEP_BAR_TEXTS[lang][key] ?? ZH[key];
}

/** 第 2 步「下一步」点不了时的原因（选了车、或只能人工报价不出「下一步」时为 null） */
export function vehicleStepReason(state: { selected: boolean; manualOnly: boolean; quote: "none" | "loading" | "failed" | "ready" }): StepBarTextKey | null {
  if (state.selected || state.manualOnly) return null;
  if (state.quote === "loading") return "quoting";
  if (state.quote === "failed") return "quoteFailed";
  return "needVehicle";
}
