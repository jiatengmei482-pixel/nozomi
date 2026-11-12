/**
 * 区域的用途（M8-20，ADR 0075；docs/design/pages/tenant-areas.md 第 20 节）：运营区域 / 报价区域 / 运营 + 报价 的说法、
 * 选区域时只列能挂价格的、「报价区域超出运营区域」的算法入参和说法、两个 409 的读法。不依赖浏览器，用 node:test 直接测。
 */
import { AREA_OVERLAP_MIN_M2, AREA_ROLE_NAMES, type AreaOverlapPiece, type AreaRole, type OverlapAreaInput, type Position, areaRoleCanOperate, areaRoleCanPrice, findPricingOutsideOperating } from "@nozomi/domain";
import { overlapAreaText } from "./area-overview.ts";

/** 接口在页面改版前可能不给用途：按「运营 + 报价」算（迁移前的区域都是它）。 */
export function roleOf(area: { role?: AreaRole | undefined }): AreaRole {
  return area.role ?? "both";
}

export function roleName(role: AreaRole): string {
  return AREA_ROLE_NAMES[role];
}

/** 新增、编辑页的三个选项（顺序：运营、报价、运营 + 报价）和每个的说明。 */
export const AREA_ROLE_OPTIONS: readonly { value: AreaRole; label: string; hint: string }[] = [
  { value: "operating", label: AREA_ROLE_NAMES.operating, hint: "只决定这一单能不能接，不带价格。可以画得很大（例如整个服务城市）；商品不勾选它，也不给它填价格。" },
  { value: "pricing", label: AREA_ROLE_NAMES.pricing, hint: "商品勾选后给它填价格或加价。要画在运营区域里面：超出运营区域的那部分不会报价。" },
  { value: "both", label: AREA_ROLE_NAMES.both, hint: "这块地方就是接单范围，也按它定价。只想画一个区域、按一个价时选它（以前画的区域都是这一种）。" },
];

/**
 * 区域编辑页地图图例「营运区」那一行的说明（M6-08）：纯运营区域不带价格，营运区只是能接单的范围，不能写「可以报价」；
 * 报价区域、运营 + 报价照旧。
 */
export function operateLegendText(role: AreaRole): string {
  return role === "operating" ? "能接单的范围，不带价格" : "可以报价";
}

export const AREA_ROLE_FIELD_HINT = "一个地点要同时在你的某个运营区域里、又在商品勾选的报价区域里，这个商品才报价。没勾选的地方不会被按别处的价格报出去。";

/** 能被商品勾选、挂价格的区域（商品的服务区域、包车区域加价、点对点线路两端的选择都只列这些）。 */
export function pricingCapable<T extends { role?: AreaRole | undefined }>(areas: readonly T[]): T[] {
  return areas.filter((area) => areaRoleCanPrice(roleOf(area)));
}

/** 选区域的地方「为什么有的区域不在这里」：有运营区域被藏掉时才说。 */
export function hiddenOperatingText(count: number): string | null {
  if (count <= 0) return null;
  return `另有 ${count} 个运营区域没有列出：运营区域只决定能不能接单，不带价格，所以不能给商品勾选。要在那里报价，请画一个报价区域（或把它改成「运营 + 报价」）。`;
}

/** 「报价区域超出运营区域」的一句话（区域编辑页、区域地图的列表、上架检查）。 */
export function outsideText(m2: number): string {
  return `这个报价区域有${overlapAreaText(m2)}不在任何运营区域里，那部分不会报价`;
}

/** 交给 domain 的样子：用途也带上（重叠只在报价区域之间算）。 */
export interface RoleShapeArea {
  id: string;
  bizType: OverlapAreaInput["bizType"];
  role: AreaRole;
  active: boolean;
  polygons: readonly { kind: OverlapAreaInput["polygons"][number]["kind"]; ring: readonly Position[] }[];
}

export interface OutsideResult {
  byArea: Map<string, number>;
  pieces: AreaOverlapPiece[];
}

/**
 * 每个报价区域（`pricing` / `both`）超出同一个供应商全部运营区域（`operating` / `both`，业务类型相容）的部分。
 * `ownerOf` 给出区域属于哪个供应商（运营后台一次看几家；供应商后台只有自己）。
 */
export function computeOutside<T extends RoleShapeArea>(areas: readonly T[], ownerOf: (area: T) => string = () => ""): OutsideResult {
  const groups = new Map<string, T[]>();
  for (const area of areas) groups.set(ownerOf(area), [...(groups.get(ownerOf(area)) ?? []), area]);
  const merged: OutsideResult = { byArea: new Map(), pieces: [] };
  for (const group of groups.values()) {
    const pricing = group.filter((area) => areaRoleCanPrice(area.role));
    const operating = group.filter((area) => areaRoleCanOperate(area.role));
    if (pricing.length === 0) continue;
    const found = findPricingOutsideOperating(pricing, operating);
    for (const [id, m2] of found.byArea) merged.byArea.set(id, m2);
    merged.pieces.push(...found.pieces);
  }
  return merged;
}

/**
 * 编辑页上正在画的这一个区域（还没保存）：按画面上的图形、选的用途和业务类型，算它超出运营区域的部分。
 * `others` 是这个供应商别的区域（不含自己）；自己是「运营 + 报价」时自己也算运营范围。
 */
export function editingOutside(current: RoleShapeArea, others: readonly RoleShapeArea[]): OutsideResult {
  if (!areaRoleCanPrice(current.role)) return { byArea: new Map(), pieces: [] };
  const operating = [...others.filter((area) => area.id !== current.id && areaRoleCanOperate(area.role)), ...(areaRoleCanOperate(current.role) ? [current] : [])];
  return findPricingOutsideOperating([current], operating);
}

/** 不到这么多平方米的不提醒（和后端、重叠的口径一致）。 */
export const OUTSIDE_MIN_M2 = AREA_OVERLAP_MIN_M2;

/** 409 `PRICING_AREA_OUTSIDE_OPERATING` 的 `details.items` 的一条。 */
export interface OutsideImpact {
  productId: string;
  productCode: string;
  areaId: string;
  outsideM2: number;
}

export function readOutsideImpacts(details: Readonly<Record<string, unknown>>): OutsideImpact[] {
  const items = Array.isArray(details["items"]) ? (details["items"] as unknown[]) : [];
  return items.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const item = entry as Record<string, unknown>;
    if (typeof item["product_id"] !== "string" || typeof item["area_id"] !== "string") return [];
    return [{ productId: item["product_id"], productCode: typeof item["product_code"] === "string" ? item["product_code"] : "", areaId: item["area_id"], outsideM2: typeof item["outside_m2"] === "number" ? item["outside_m2"] : 0 }];
  });
}

/** 一条影响的说法：「商品 P-001：报价区域「新宿」将有约 3.2 平方公里不在任何运营区域里」。 */
export function outsideImpactText(impact: OutsideImpact, areaName: string | null): string {
  const product = impact.productCode === "" ? "一个已上架的商品" : `商品 ${impact.productCode}`;
  return `${product}：报价区域${areaName === null ? "" : `「${areaName}」`}将有${overlapAreaText(impact.outsideM2)}不在任何运营区域里`;
}

/** 409 `PRICING_AREA_OUTSIDE_OPERATING` 时提示条的标题和后半句（按是什么操作）。 */
export function outsideRejectedText(action: "save" | "disable" | "delete"): { title: string; text: string } {
  const verb = action === "save" ? "保存" : action === "disable" ? "停用" : "删除";
  return {
    title: `现在不能${verb}：已上架的商品会有地方报不出价。`,
    text: `${verb}之后，下面这些已上架商品勾选的报价区域会有一部分不在任何运营区域里，那部分将报不出价。请先补画（或启用）覆盖它们的运营区域，或先把这些商品下架。`,
  };
}

/** 409 `AREA_IN_USE`（改成运营区域时）：有几个商品勾选着它。 */
export function roleInUseText(details: Readonly<Record<string, unknown>>): string {
  const count = typeof details["product_count"] === "number" ? details["product_count"] : null;
  const who = count === null ? "有商品" : `有 ${count} 个商品`;
  return `${who}把这个区域当报价区域用着（服务区域、包车区域加价或点对点线路价），不能改成运营区域：运营区域不带价格。请先在这些商品里换掉它，或改选「运营 + 报价」。`;
}
