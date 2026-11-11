/**
 * 区域共享库（M8-31，ADR 0083）。
 *
 * - 共享库就是各供应商启用中的原创区域（测试供应商、已清退的不算），只给名称和形状、图形版本，不给创建者、价格、加价。
 * - 引用 = 复制一份到自己名下（新区域，租户隔离照旧），记住来源和当时的图形版本；之后来源改了图形，副本不变，
 *   详情里能看到「库里有新版本」，自己决定要不要切换（切换 = 把自己的图形换成来源现在的，走和修改区域同一套检查）。
 * - 新建区域时可以先查库里有没有同名或和营运区重叠的区域，直接引用。
 * 读库在平台事务里（跨租户、只读），写自己的区域在租户事务里（复用区域的新增、修改，检查和审计都一样）。
 */
import type { AreaBizType, AreaRole, LocalizedText, Ring } from "@nozomi/domain";
import { areaNameKeys, ringToGeoJson, ringsOverlap } from "@nozomi/domain";
import type { DbContext } from "../context.ts";
import { withPlatformTx, withTenantTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import { findArea } from "../repos/areas.ts";
import { type SharedArea, type SharedAreaShape, findSharedArea, listSharedAreaShapes, listSharedAreas, sharedShapeVersions } from "../repos/shared-areas.ts";
import { type AreaPolygonInput, type AreaView, type AreaWriter, createArea, getArea, updateArea } from "./areas.ts";
import { notFound } from "./errors.ts";

export type { SharedArea, SharedAreaShape } from "../repos/shared-areas.ts";

/** 列表最多给这么多；更多时 `truncated` 为真，请输入名称缩小范围。 */
export const SHARED_AREA_LIST_LIMIT = 50;
/** 相似区域最多提示这么多个。 */
export const SIMILAR_AREA_LIMIT = 5;

export function listSharedAreasFor(ctx: DbContext, tenantId: string, filter: { cityId: string; search?: string | undefined }): Promise<{ items: SharedArea[]; truncated: boolean }> {
  return withPlatformTx(ctx.pool, (db) => listSharedAreas(db, { ...filter, exceptTenantId: tenantId }, SHARED_AREA_LIST_LIMIT), { snapshot: true });
}

export async function getSharedArea(ctx: DbContext, id: string): Promise<{ area: SharedArea; shapes: SharedAreaShape[] }> {
  const found = await withPlatformTx(ctx.pool, (db) => findSharedArea(db, id), { snapshot: true });
  if (found === null) throw notFound("共享区域");
  return found;
}

export interface SimilarSharedArea {
  area: SharedArea;
  /** name：名称相同（任意一种语言归一后相同）；overlap：营运区和你画的营运区有重叠 */
  reasons: ("name" | "overlap")[];
}

/**
 * 新建区域前查库里有没有相似的：同一个城市里名称相同，或者营运区和你画的营运区重叠。名称相同的排在前面，最多 5 个。
 * 自己建的区域不算（它本来就在「我的区域」里，重名会在保存时直接报）。
 */
export async function similarSharedAreas(ctx: DbContext, tenantId: string, input: { cityId: string; name: LocalizedText | null; operateRings: readonly Ring[] }): Promise<SimilarSharedArea[]> {
  const candidates = await withPlatformTx(ctx.pool, (db) => listSharedAreaShapes(db, input.cityId, tenantId), { snapshot: true });
  const keys = input.name === null ? [] : areaNameKeys(input.name);
  const found: SimilarSharedArea[] = [];
  for (const candidate of candidates) {
    const reasons: SimilarSharedArea["reasons"] = [];
    if (keys.some((key) => candidate.nameKeys.includes(key))) reasons.push("name");
    const operate = candidate.shapes.filter((shape) => shape.kind === "operate");
    if (input.operateRings.some((ring) => operate.some((shape) => ringsOverlap(ring, shape.ring)))) reasons.push("overlap");
    if (reasons.length > 0) {
      const { shapes: _shapes, ...area } = candidate;
      found.push({ area, reasons });
    }
  }
  found.sort((a, b) => Number(b.reasons.includes("name")) - Number(a.reasons.includes("name")));
  return found.slice(0, SIMILAR_AREA_LIMIT);
}

/** 共享区域的图形 → 新增 / 修改区域的输入：只带种类和坐标（来源的备注名、圆心半径不带），算作「粘贴的」。 */
function polygonInputsOf(shapes: readonly SharedAreaShape[]): AreaPolygonInput[] {
  return shapes.map((shape) => ({ id: null, kind: shape.kind, label: null, source: "pasted", circle: null, geometry: ringToGeoJson(shape.ring) }));
}

/**
 * 引用共享库里的一个区域：在自己名下新建一个区域，图形照抄来源现在的版本，记住来源和版本。
 * 名称不给时用来源的名称；业务类型、用途由引用方自己定（来源的不共享）。同城重名照常 409 AREA_NAME_TAKEN。
 */
export async function createAreaFromShared(
  ctx: DbContext,
  writer: AreaWriter,
  sharedAreaId: string,
  input: { name: LocalizedText | null; bizType: AreaBizType; role: AreaRole },
  idempotency: { scope: string; key: string },
  respond: (view: AreaView) => Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const shared = await getSharedArea(ctx, sharedAreaId);
  return createArea(
    ctx,
    writer,
    { cityId: shared.area.cityId, name: input.name ?? shared.area.name, bizType: input.bizType, role: input.role, polygons: polygonInputsOf(shared.shapes) },
    idempotency,
    respond,
    { areaId: shared.area.id, shapeVersion: shared.area.shapeVersion },
  );
}

/**
 * 把引用来的区域切换到来源在共享库里的最新图形（名称、业务类型、用途不动）。
 * 和修改区域一样带版本号、走同样的检查（运营范围变小时报价区域不能多出「不在运营区域里」的部分等）、写审计。
 * 已经是最新版本时原样返回；来源已不在库里（停用、删除）时 409 SHARED_AREA_UNAVAILABLE。
 */
export async function syncAreaToShared(ctx: DbContext, writer: AreaWriter, areaId: string, expectedVersion: number): Promise<AreaView> {
  const tenantId = writer.principal.tenantId;
  const area = await withTenantTx(ctx.pool, tenantId, (db) => findArea(db, tenantId, areaId, { lock: false }), { snapshot: true });
  if (area === null) throw notFound("区域");
  if (area.sharedSource === null) throw new AppError(409, "NOT_FROM_SHARED_LIBRARY", "这个区域是自己画的，不是从共享库引用的");
  const shared = await withPlatformTx(ctx.pool, (db) => findSharedArea(db, (area.sharedSource as { areaId: string }).areaId), { snapshot: true });
  if (shared === null) throw new AppError(409, "SHARED_AREA_UNAVAILABLE", "来源区域已经不在共享库里了（可能被停用或删除），你的区域保持现在的图形");
  if (shared.area.shapeVersion === area.sharedSource.shapeVersion) return getArea(ctx, tenantId, areaId);
  return updateArea(
    ctx,
    writer,
    areaId,
    expectedVersion,
    { cityId: null, name: area.name, bizType: area.bizType, role: null, polygons: polygonInputsOf(shared.shapes) },
    shared.area.shapeVersion,
  );
}

/** 这些引用来源现在在库里的图形版本（不在库里的不出现）：区域列表、详情用来提示「库里有新版本」。 */
export function latestSharedVersions(ctx: DbContext, sourceIds: readonly string[]): Promise<Map<string, number>> {
  if (sourceIds.length === 0) return Promise.resolve(new Map());
  return withPlatformTx(ctx.pool, (db) => sharedShapeVersions(db, [...new Set(sourceIds)]), { snapshot: true });
}
