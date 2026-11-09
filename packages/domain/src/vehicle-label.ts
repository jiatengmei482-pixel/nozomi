/**
 * 车型标识（M7，ADR 0068）：从车型组现有的两个字段算出给客人和后台看的 4 项，不另存一份。
 * - ① 代表车型：代表车型列表（sample_models）里的第一个；
 * - ② 同级车型说明：整个列表用「, 」连起来，后面加「or similar」，如「Toyota Alphard, Toyota Vellfire or similar」；
 * - ③ 最多乘客数、④ 最多行李数：人数 / 行李数组合（combos）里各自的最大值。
 *
 * 组合仍然是选车校验的唯一依据（报价引擎按「人数 ≤ 组合人数且行李 ≤ 组合行李」挑车，ADR 0020），这里只是显示：
 * ③④ 是各自的最大值，不一定能同时达到（6 人 + 4 件 或 5 人 + 5 件 → 最多 6 人、最多 5 件），所以页面上同时给出组合。
 */
import type { VehicleCombo } from "./master-data.ts";

export interface VehicleLabelSource {
  sample_models: readonly string[];
  combos: readonly VehicleCombo[];
}

export interface VehicleLabel {
  /** 列表为空时为 null（没有填代表车型就不显示这一项，不编造） */
  representative: string | null;
  similar: string | null;
  maxPassengers: number | null;
  maxLuggage: number | null;
}

export const SIMILAR_SUFFIX = "or similar";

export function vehicleLabel(group: VehicleLabelSource): VehicleLabel {
  const models = group.sample_models.map((model) => model.trim()).filter((model) => model !== "");
  const passengers = group.combos.map((combo) => combo.passengers);
  const luggage = group.combos.map((combo) => combo.luggage);
  return {
    representative: models[0] ?? null,
    similar: models.length === 0 ? null : `${models.join(", ")} ${SIMILAR_SUFFIX}`,
    maxPassengers: passengers.length === 0 ? null : Math.max(...passengers),
    maxLuggage: luggage.length === 0 ? null : Math.max(...luggage),
  };
}

export type VehicleLabelLanguage = "zh" | "ja" | "en";

export interface VehicleLabelTexts {
  representative: string;
  similar: string;
  maxPassengers: string;
  maxLuggage: string;
  passengers: (count: number) => string;
  luggage: (count: number) => string;
}

/** 4 项的标签。界面是哪种语言就用哪一套；日文界面上线前（ADR 0068 改进方案 2）先备好。 */
export const VEHICLE_LABEL_TEXTS: Readonly<Record<VehicleLabelLanguage, VehicleLabelTexts>> = {
  zh: { representative: "代表车型", similar: "同级车型", maxPassengers: "最多乘客", maxLuggage: "最多行李", passengers: (count) => `${count} 人`, luggage: (count) => `${count} 件` },
  ja: { representative: "代表車種", similar: "同等クラスの車種", maxPassengers: "最大乗車人数", maxLuggage: "最大荷物数", passengers: (count) => `${count}名`, luggage: (count) => `${count}個` },
  en: { representative: "Representative model", similar: "Similar models", maxPassengers: "Max passengers", maxLuggage: "Max luggage", passengers: (count) => `${count} ${count === 1 ? "passenger" : "passengers"}`, luggage: (count) => `${count} ${count === 1 ? "bag" : "bags"}` },
};

/** 按顺序排好的「标签 + 值」，空的项不出现。页面和邮件都用这一份，保证各处一致。 */
export function vehicleLabelLines(group: VehicleLabelSource, language: VehicleLabelLanguage = "zh"): { label: string; value: string }[] {
  const label = vehicleLabel(group);
  const texts = VEHICLE_LABEL_TEXTS[language];
  const lines: { label: string; value: string }[] = [];
  if (label.representative !== null) lines.push({ label: texts.representative, value: label.representative });
  if (label.similar !== null) lines.push({ label: texts.similar, value: label.similar });
  if (label.maxPassengers !== null) lines.push({ label: texts.maxPassengers, value: texts.passengers(label.maxPassengers) });
  if (label.maxLuggage !== null) lines.push({ label: texts.maxLuggage, value: texts.luggage(label.maxLuggage) });
  return lines;
}

/**
 * 邮件里的车型标识变量（M7-04，ADR 0068 第 3 节补记）：同级车型说明、最多乘客、最多行李，值用 `VEHICLE_LABEL_TEXTS` 的写法。
 * 代表车型就是同级说明的第一个，邮件里不单列。没填代表车型（或找不到车型组）时对应的值是空字符串：模板里那一行整行不出现。
 */
export function vehicleLabelMailVariables(group: VehicleLabelSource | null, language: VehicleLabelLanguage = "zh"): { vehicle_similar: string; vehicle_max_persons: string; vehicle_max_luggage: string } {
  if (group === null) return { vehicle_similar: "", vehicle_max_persons: "", vehicle_max_luggage: "" };
  const label = vehicleLabel(group);
  const texts = VEHICLE_LABEL_TEXTS[language];
  return {
    vehicle_similar: label.similar ?? "",
    vehicle_max_persons: label.maxPassengers === null ? "" : texts.passengers(label.maxPassengers),
    vehicle_max_luggage: label.maxLuggage === null ? "" : texts.luggage(label.maxLuggage),
  };
}
