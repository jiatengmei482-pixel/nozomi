/**
 * 包车三层区域的保存校验（M9P-06，ADR 0093 第七节第 1、2 条；规格第四节第 2 小节）：价格（②③规则）和商品基础信息（①服务区域）保存时共用。
 * 同一个商品同一层（①基础价、②行程、③上下车加价）的区域不能重叠，①和③不能重叠；①②、②③可以。只看这次新加进某一层的区域，
 * 已有的重叠不回头拦（第七节第 6 条：那些在迁移报告里列出，由运营处理）。只有边界接触（小于 0.01 平方公里）不算。
 */
import { type CharterLayerOverlap, type LocalizedText, charterLayerOverlaps } from "@nozomi/domain";
import type { Db } from "../db/context.ts";
import { AppError } from "../errors.ts";
import { areaShapeInput, listTenantAreaShapes } from "../repos/areas.ts";

const LAYER_NAMES: Readonly<Record<CharterLayerOverlap["layer"], string>> = {
  base: "基础价区域（服务区域）",
  itinerary: "行程加价的区域",
  pickup_dropoff: "上下车加价的区域",
  base_pickup_dropoff: "基础价区域和上下车加价的区域",
};

const nameOf = (name: LocalizedText | undefined): string => name?.zh ?? name?.ja ?? name?.en ?? name?.ko ?? "";

/**
 * 查这次保存之后的三层区域，有新的重叠抛 400：同层 `AREA_LAYER_OVERLAP`、①和③ `AREA_BASE_SURCHARGE_OVERLAP`。
 * `details`：`areas`（两个区域的名称）、`area_ids`、`overlap_km2`（两位小数）、`layer`，另有 `overlaps` 列出全部（第一条就是 `areas` 那一对）。
 */
export async function assertNoCharterLayerOverlap(
  db: Db,
  tenantId: string,
  layers: { base: readonly string[]; itinerary: readonly string[]; updown: readonly string[] },
  added: { base?: readonly string[]; itinerary?: readonly string[]; updown?: readonly string[] },
  names: (areaId: string) => LocalizedText | undefined,
): Promise<void> {
  if ((added.base?.length ?? 0) + (added.itinerary?.length ?? 0) + (added.updown?.length ?? 0) === 0) return;
  const shapes = (await listTenantAreaShapes(db, tenantId)).map(areaShapeInput);
  const overlaps = charterLayerOverlaps(shapes, layers, added);
  const [first] = overlaps;
  if (first === undefined) return;
  // 两位小数：0.01 平方公里（阈值）以上的重叠都显示得出来，不会显示成 0
  const km2 = (m2: number): number => Math.round(m2 / 10_000) / 100;
  const describe = (entry: CharterLayerOverlap) => ({ code: entry.code, layer: entry.layer, areas: [nameOf(names(entry.a)), nameOf(names(entry.b))], area_ids: [entry.a, entry.b], overlap_km2: km2(entry.areaM2) });
  const [a, b] = [nameOf(names(first.a)), nameOf(names(first.b))];
  const message =
    first.code === "AREA_LAYER_OVERLAP"
      ? `「${a}」和「${b}」重叠约 ${km2(first.areaM2)} 平方公里：同一个商品的${LAYER_NAMES[first.layer]}不能重叠（一个点只能有一个答案）。请先在区域页面切掉重叠的部分`
      : `基础价区域「${a}」和上下车加价的区域「${b}」重叠约 ${km2(first.areaM2)} 平方公里：在基础价区域里上下车不加价，两者不能重叠。请先在区域页面切掉重叠的部分`;
  throw new AppError(400, first.code, message, { ...describe(first), overlaps: overlaps.map(describe) });
}
