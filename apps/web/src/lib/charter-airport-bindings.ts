/**
 * 商品页「机场套餐」绑定的编辑模型（M9P-22，ADR 0098 第三节第 2、8 小节）：两组（机场开始 / 机场结束），每组一行一个机场：
 * 机场（主数据）、机场区域、可选中文简称；保存即整组替换（`PUT /tenant/v1/products/{id}/charter-airports`）。
 * 页面先查能查的（必填、简称长度、每组最多 10 个、同组重复），其余（覆盖、航站楼在不在区域里、区域停用）以后端为准，
 * 后端的 `issues[].path`（`/bindings/{序号}/{字段}`）对回到页面上的那一行那一格。不依赖浏览器。
 */
import type { AirportScenarioKind } from "@nozomi/domain";
import type { CharterAirportBinding, CharterAirportBindingInput } from "../api/charter-airports.ts";
import { charterAirportText } from "./charter-airport-copy.ts";

/** 和后端同一个数（services/charter-airports.ts） */
export const MAX_AIRPORTS_PER_SCENARIO = 10;
export const SHORT_NAME_MAX = 20;

export type BindingField = "place_id" | "area_id" | "short_name_zh";

export interface BindingDraft {
  /** 页面上的记号（保存时不提交） */
  key: string;
  scenario: AirportScenarioKind;
  placeId: string;
  areaId: string;
  shortName: string;
}

export interface BindingProblem {
  /** 哪一行；null = 整组的问题 */
  key: string | null;
  field: BindingField | null;
  text: string;
}

export const bindingFieldId = (key: string, field: BindingField): string => `airport-binding-${key}-${field}`;

export function bindingDraftsOf(bindings: readonly CharterAirportBinding[]): BindingDraft[] {
  return bindings.map((binding, index) => ({ key: `b${index}-${binding.scenario}-${binding.place_id}`, scenario: binding.scenario, placeId: binding.place_id, areaId: binding.area_id, shortName: binding.short_name_zh ?? "" }));
}

/** 提交的顺序：机场开始在前、机场结束在后，组内按页面上的先后（后端按这个顺序给 `/bindings/{序号}`） */
export function orderedDrafts(drafts: readonly BindingDraft[]): BindingDraft[] {
  return [...drafts.filter((draft) => draft.scenario === "airport_start"), ...drafts.filter((draft) => draft.scenario === "airport_end")];
}

export function bindingInputs(drafts: readonly BindingDraft[]): CharterAirportBindingInput[] {
  return orderedDrafts(drafts).map((draft) => ({ scenario: draft.scenario, place_id: draft.placeId, area_id: draft.areaId, short_name_zh: draft.shortName.trim() === "" ? null : draft.shortName.trim() }));
}

/** 页面上先查的问题 */
export function bindingProblems(drafts: readonly BindingDraft[]): BindingProblem[] {
  const problems: BindingProblem[] = [];
  for (const scenario of ["airport_start", "airport_end"] as const) {
    const group = drafts.filter((draft) => draft.scenario === scenario);
    if (group.length > MAX_AIRPORTS_PER_SCENARIO) problems.push({ key: null, field: null, text: charterAirportText("tenant.charterAirport.tooMany", { max: MAX_AIRPORTS_PER_SCENARIO }) });
    const places = new Set<string>();
    const areas = new Set<string>();
    for (const draft of group) {
      if (draft.placeId === "") problems.push({ key: draft.key, field: "place_id", text: charterAirportText("tenant.charterAirport.required.airport") });
      else if (places.has(draft.placeId)) problems.push({ key: draft.key, field: "place_id", text: charterAirportText("tenant.charterAirport.duplicateAirport") });
      if (draft.areaId === "") problems.push({ key: draft.key, field: "area_id", text: charterAirportText("tenant.charterAirport.required.area") });
      else if (areas.has(draft.areaId)) problems.push({ key: draft.key, field: "area_id", text: charterAirportText("tenant.charterAirport.duplicateArea") });
      if ([...draft.shortName.trim()].length > SHORT_NAME_MAX) problems.push({ key: draft.key, field: "short_name_zh", text: charterAirportText("tenant.charterAirport.shortNameTooLong", { max: SHORT_NAME_MAX }) });
      places.add(draft.placeId);
      areas.add(draft.areaId);
    }
  }
  return problems;
}

export interface ServerBindingIssue {
  path?: string;
  reason?: string;
  message?: string;
}

/** 后端的校验问题（`VALIDATION_FAILED` 的 `details.issues`）→ 页面上的哪一行哪一格；对不上的当整组的问题 */
export function placeBindingIssues(issues: readonly ServerBindingIssue[], drafts: readonly BindingDraft[]): BindingProblem[] {
  const sent = orderedDrafts(drafts);
  return issues.map((issue) => {
    const match = /^\/bindings\/(\d+)\/(place_id|area_id|short_name_zh)/.exec(issue.path ?? "");
    const draft = match ? sent[Number(match[1])] : undefined;
    const text = issue.reason === "TOO_MANY" ? charterAirportText("tenant.charterAirport.tooMany", { max: MAX_AIRPORTS_PER_SCENARIO }) : (issue.message ?? "");
    return draft && match ? { key: draft.key, field: match[2] as BindingField, text } : { key: null, field: null, text };
  });
}

/** 页面上的内容和保存的一样吗（有没有未保存的修改） */
export function bindingsDirty(drafts: readonly BindingDraft[], saved: readonly CharterAirportBinding[]): boolean {
  return JSON.stringify(bindingInputs(drafts)) !== JSON.stringify(bindingInputs(bindingDraftsOf(saved)));
}
