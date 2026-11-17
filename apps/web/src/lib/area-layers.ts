/**
 * 区域在商品里当哪一层（M9P-13，规格第四节第 3 小节、ADR 0093 第一节）：区域详情的「在哪些商品里用」、编辑时的三层重叠提醒、
 * 区域地图按商品和层筛选、标红重叠，和「从本区域减去另一个区域」的说法。纯函数，不依赖 React。
 * 三层：① 基础价区域（商品的服务区域）、② 行程区域（行程加价）、③ 上下车加价区域（上下车加价）；接送机、点对点只有服务区域。
 * 重叠的口径和后端保存校验一样（@nozomi/domain `charterLayerOverlaps` / `charterLayerConflictPieces`）：同层、①∩③ 不允许，①②、②③ 可以。
 */
import { type CharterLayerConflictPiece, type CharterLayerOverlap, type OverlapAreaInput, charterLayerConflictPieces, charterLayerOverlaps } from "@nozomi/domain";
import type { AreaCharterOverlap, ProductAreaLayers } from "../api/areas.ts";
import { productName } from "./product-display.ts";

export const AREA_LAYERS = ["base", "itinerary", "pickup_dropoff"] as const;
export type AreaLayer = (typeof AREA_LAYERS)[number];

export const AREA_LAYER_NAMES: Readonly<Record<AreaLayer, string>> = { base: "① 基础价区域", itinerary: "② 行程区域", pickup_dropoff: "③ 上下车加价区域" };
/** 层的短名（地图筛选、标签里用） */
export const AREA_LAYER_SHORT: Readonly<Record<AreaLayer, string>> = { base: "①基础价", itinerary: "②行程", pickup_dropoff: "③上下车加价" };

const layerIds = (product: ProductAreaLayers, layer: AreaLayer): readonly string[] => (layer === "base" ? product.base : layer === "itinerary" ? product.itinerary : product.pickup_dropoff);

export function productLabel(product: Pick<ProductAreaLayers, "title" | "category" | "code">): string {
  const name = productName(product);
  return `${name.text}（${product.code}）`;
}

export interface AreaUse {
  product: ProductAreaLayers;
  layers: AreaLayer[];
}

/** 这个区域在哪些商品里用、当哪一层（商品按接口给的顺序：编码） */
export function areaUses(areaId: string, products: readonly ProductAreaLayers[]): AreaUse[] {
  return products.flatMap((product) => {
    const layers = AREA_LAYERS.filter((layer) => layerIds(product, layer).includes(areaId));
    return layers.length === 0 ? [] : [{ product, layers }];
  });
}

/** 一个商品里当哪一层的说法：包车写①②③，接送机、点对点只有「服务区域」 */
export function useLayerText(use: AreaUse): string {
  if (use.product.category !== "charter") return "服务区域";
  return use.layers.map((layer) => AREA_LAYER_NAMES[layer]).join("、");
}

const LAYER_PAIR: Readonly<Record<CharterLayerOverlap["layer"], string>> = {
  base: "同为 ① 基础价区域",
  itinerary: "同为 ② 行程区域",
  pickup_dropoff: "同为 ③ 上下车加价区域",
  base_pickup_dropoff: "① 基础价区域和 ③ 上下车加价区域",
};

/** 面积写成平方公里（两位小数；不到 0.01 写「不到 0.01」） */
export function km2Text(m2: number): string {
  const km2 = Math.round(m2 / 10_000) / 100;
  return km2 < 0.01 ? "不到 0.01 平方公里" : `约 ${km2.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} 平方公里`;
}

/** 三层重叠的一条提醒：「东京包车（CH-1）」里和「横滨」同为 ③ 上下车加价区域，重叠约 12.34 平方公里 */
export function overlapLine(entry: { productLabel: string; otherName: string; layer: CharterLayerOverlap["layer"]; areaM2: number }): string {
  return `「${entry.productLabel}」里和「${entry.otherName}」${LAYER_PAIR[entry.layer]}，重叠${km2Text(entry.areaM2)}`;
}

export interface EditingOverlap {
  product: ProductAreaLayers;
  otherAreaId: string;
  layer: CharterLayerOverlap["layer"];
  areaM2: number;
}

/**
 * 编辑时现算（M9P-13，#247 审查建议）：按画面上的图形，用到这个区域的包车商品里它和同商品别的区域的三层重叠。
 * 只提醒、不拦保存；保存后后端同样算一遍（应答的 `charter_layer_overlaps`），上架检查也列出。
 */
export function editingOverlaps(current: OverlapAreaInput, others: readonly OverlapAreaInput[], products: readonly ProductAreaLayers[]): EditingOverlap[] {
  const shapes = [current, ...others.filter((other) => other.id !== current.id)];
  return products.flatMap((product) => {
    if (product.category !== "charter") return [];
    const layers = { base: product.base, itinerary: product.itinerary, updown: product.pickup_dropoff };
    const mine = (ids: readonly string[]): string[] => (ids.includes(current.id) ? [current.id] : []);
    if (mine(layers.base).length + mine(layers.itinerary).length + mine(layers.updown).length === 0) return [];
    return charterLayerOverlaps(shapes, layers, { base: mine(layers.base), itinerary: mine(layers.itinerary), updown: mine(layers.updown) }).flatMap((entry) =>
      entry.a === current.id || entry.b === current.id ? [{ product, otherAreaId: entry.a === current.id ? entry.b : entry.a, layer: entry.layer, areaM2: entry.areaM2 }] : [],
    );
  });
}

/** 保存应答里的三层重叠（后端算的）→ 一句话的提醒 */
export function savedOverlapsText(overlaps: readonly AreaCharterOverlap[]): string | null {
  if (overlaps.length === 0) return null;
  return `注意：用到它的包车商品里有 ${overlaps.length} 处三层区域重叠，报价时一个点只能有一个答案。请打开这个区域看重叠在哪，用「从本区域减去另一个区域」切掉。`;
}

// ---- 区域地图：按商品和层筛选 ----

/** 商品筛选：`all` = 不按商品（全部区域，和以前一样）；`charter` = 全部包车商品；其余是商品编号 */
export type ProductFilter = "all" | "charter" | string;

export type LayerSelection = Readonly<Record<AreaLayer, boolean>>;
export const ALL_LAYERS: LayerSelection = { base: true, itinerary: true, pickup_dropoff: true };

function pickedProducts(products: readonly ProductAreaLayers[], filter: ProductFilter): ProductAreaLayers[] {
  if (filter === "all") return [];
  return filter === "charter" ? products.filter((product) => product.category === "charter") : products.filter((product) => product.product_id === filter);
}

/** 按商品和层筛选时：每个区域在选中的商品里当哪几层（只有选中的层）。`filter` 是 `all` 时返回 null（不筛） */
export function layerMembership(products: readonly ProductAreaLayers[], filter: ProductFilter, layers: LayerSelection): Map<string, Set<AreaLayer>> | null {
  if (filter === "all") return null;
  const found = new Map<string, Set<AreaLayer>>();
  for (const product of pickedProducts(products, filter)) {
    for (const layer of AREA_LAYERS) {
      if (!layers[layer]) continue;
      for (const id of layerIds(product, layer)) found.set(id, new Set([...(found.get(id) ?? []), layer]));
    }
  }
  return found;
}

export interface LayerConflict extends CharterLayerConflictPiece {
  productId: string;
}

/**
 * 选中的包车商品里不允许的重叠部分（标红）：每个商品分开算（不同商品之间的区域重叠没关系），只算选中的层；①∩③ 要①和③都选上才算。
 * 同一个区域对的面积按商品分开给（`pairs`），列表里写「和谁重叠、哪一层、多大」。
 */
export function layerConflicts(products: readonly ProductAreaLayers[], filter: ProductFilter, layers: LayerSelection, shapes: readonly OverlapAreaInput[]): { pieces: LayerConflict[]; pairs: (CharterLayerOverlap & { productId: string })[] } {
  const pieces: LayerConflict[] = [];
  const pairs: (CharterLayerOverlap & { productId: string })[] = [];
  for (const product of pickedProducts(products, filter)) {
    if (product.category !== "charter") continue;
    const chosen = { base: layers.base ? product.base : [], itinerary: layers.itinerary ? product.itinerary : [], updown: layers.pickup_dropoff ? product.pickup_dropoff : [] };
    for (const piece of charterLayerConflictPieces(shapes, chosen)) pieces.push({ ...piece, productId: product.product_id });
    for (const pair of charterLayerOverlaps(shapes, chosen, chosen)) pairs.push({ ...pair, productId: product.product_id });
  }
  return { pieces, pairs };
}

// ---- 从本区域减去另一个区域 ----

export function subtractFailureText(reason: "NO_OVERLAP" | "NOTHING_LEFT" | "TOO_COMPLEX" | "SHAPE_PROBLEMS"): string {
  switch (reason) {
    case "NO_OVERLAP":
      return "这两个区域没有重叠，不用减。";
    case "NOTHING_LEFT":
      return "本区域的营运区整个都在那个区域里，减完什么都不剩。不需要这个区域的话，可以停用或删除它。";
    case "TOO_COMPLEX":
      return "减完的图形太复杂（块数或点数超过上限，或有极细的缝），没法自动切。请手工调整图形。";
    case "SHAPE_PROBLEMS":
      return "现在的图形还有要修改的地方，请先改好再减。";
  }
}

/** 减之前的预览：切掉多少、换成几块 */
export function subtractPreviewText(result: { removedM2: number; rings: readonly unknown[]; removeKeys: readonly unknown[]; split: boolean }): string {
  const parts = [`会切掉${km2Text(result.removedM2)}`, `碰到的 ${result.removeKeys.length} 块营运区换成减完的 ${result.rings.length} 块`];
  if (result.split) parts.push("那个区域在本区域中间，区域的图形不能带洞，所以竖着切成了几块");
  return `${parts.join("；")}。确认后图形换到画面上，保存后才生效；不满意可以撤销。`;
}
