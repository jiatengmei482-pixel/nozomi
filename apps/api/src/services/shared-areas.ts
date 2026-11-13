/**
 * 区域共享库（M8-31，ADR 0083）。
 *
 * - 共享库就是各供应商启用中的原创区域（测试供应商、已清退的不算），只给名称和形状、图形版本，不给创建者、价格、加价。
 * - 引用 = 复制一份到自己名下（新区域，租户隔离照旧），记住来源和当时的图形版本；之后来源改了图形，副本不变，
 *   详情里能看到「库里有新版本」，自己决定要不要切换（切换 = 把自己的图形换成来源现在的，走和修改区域同一套检查）。
 * - 新建区域时可以先查库里有没有同名或和营运区重叠的区域，直接引用。
 * 读库在平台事务里（跨租户、只读），写自己的区域在租户事务里（复用区域的新增、修改，检查和审计都一样）。
 *
 * 平台去重（M8-31b，ADR 0083 补充，业主 2026-11-13 选 B）：平台把一份标成另一份的重复 = 在库里隐藏它、以后引用它的改为引用保留的那份。
 * 不改任何供应商的区域和报价；已经从被隐藏那份引用的副本来源不变（照旧看得到它的新版本、能切换）。
 */
import type { AreaBizType, AreaRole, DuplicateMarkProblem, LocalizedText, Ring, SharedAreaSimilarity } from "@nozomi/domain";
import { areaNameKeys, duplicateMarkProblem, ringToGeoJson, sharedAreaSimilarity } from "@nozomi/domain";
import type { DbContext } from "../context.ts";
import { type Db, withPlatformTx, withTenantTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import { findArea } from "../repos/areas.ts";
import { insertAuditLog } from "../repos/audit-logs.ts";
import {
  type SharedArea,
  type SharedAreaDuplicate,
  type SharedAreaShape,
  activeDuplicates,
  duplicateCandidate,
  findSharedArea,
  insertDuplicate,
  keepAreaOf,
  listSharedAreaShapes,
  listSharedAreas,
  revokeDuplicate,
  SHARED_AREAS_PER_CITY,
  sharedCopyCounts,
  sharedShapeVersions,
} from "../repos/shared-areas.ts";
import { type AreaPolygonInput, type AreaView, type AreaWriter, createArea, getArea, updateArea } from "./areas.ts";
import { consoleOrigin, platformActor } from "./audit.ts";
import { notFound } from "./errors.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";

export type { SharedArea, SharedAreaDuplicate, SharedAreaShape } from "../repos/shared-areas.ts";

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
  reasons: SharedAreaSimilarity[];
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
    const reasons = sharedAreaSimilarity({ nameKeys: keys, operateRings: input.operateRings }, similarityOf(candidate));
    if (reasons.length > 0) {
      const { shapes: _shapes, ...area } = candidate;
      found.push({ area, reasons });
    }
  }
  found.sort((a, b) => Number(b.reasons.includes("name")) - Number(a.reasons.includes("name")));
  return found.slice(0, SIMILAR_AREA_LIMIT);
}

function similarityOf(area: SharedArea & { shapes: SharedAreaShape[] }): { nameKeys: string[]; operateRings: Ring[] } {
  return { nameKeys: area.nameKeys, operateRings: area.shapes.filter((shape) => shape.kind === "operate").map((shape) => shape.ring) };
}

/** 共享区域的图形 → 新增 / 修改区域的输入：只带种类和坐标（来源的备注名、圆心半径不带），算作「粘贴的」。 */
function polygonInputsOf(shapes: readonly SharedAreaShape[]): AreaPolygonInput[] {
  return shapes.map((shape) => ({ id: null, kind: shape.kind, label: null, source: "pasted", circle: null, geometry: ringToGeoJson(shape.ring) }));
}

/**
 * 引用共享库里的一个区域：在自己名下新建一个区域，图形照抄来源现在的版本，记住来源和版本。
 * 名称不给时用来源的名称；业务类型、用途由引用方自己定（来源的不共享）。同城重名照常 409 AREA_NAME_TAKEN。
 * 引用的是被平台隐藏的那份时，改为引用它指向的保留那份（来源记保留的那份，M8-31b）。
 */
export async function createAreaFromShared(
  ctx: DbContext,
  writer: AreaWriter,
  sharedAreaId: string,
  input: { name: LocalizedText | null; bizType: AreaBizType; role: AreaRole },
  idempotency: { scope: string; key: string },
  respond: (view: AreaView) => Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return createArea(
    ctx,
    writer,
    // 幂等键之后才读共享库（重试原样返回第一次的应答）
    async () => {
      const shared = await sharedAreaForReference(ctx, sharedAreaId);
      return {
        input: { cityId: shared.area.cityId, name: input.name ?? shared.area.name, bizType: input.bizType, role: input.role, polygons: polygonInputsOf(shared.shapes) },
        sharedSource: { areaId: shared.area.id, shapeVersion: shared.area.shapeVersion },
      };
    },
    { ...idempotency, request: { shared_area_id: sharedAreaId, name: input.name, biz_type: input.bizType, role: input.role } },
    respond,
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
  // 来源被平台隐藏了也照常切换：已有副本的来源不变（ADR 0083 补充）
  const shared = await withPlatformTx(ctx.pool, (db) => findSharedArea(db, (area.sharedSource as { areaId: string }).areaId, { includeHidden: true }), { snapshot: true });
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

/** 引用时实际复制的那份：被隐藏的转到保留的那份（规则保证最多转一次）；都不在库里时 404。 */
async function sharedAreaForReference(ctx: DbContext, id: string): Promise<{ area: SharedArea; shapes: SharedAreaShape[] }> {
  const found = await withPlatformTx(
    ctx.pool,
    async (db) => {
      const keep = await keepAreaOf(db, id);
      return findSharedArea(db, keep ?? id);
    },
    { snapshot: true },
  );
  if (found === null) throw notFound("共享区域");
  return found;
}

// ---- 平台：共享库去重（M8-31b） ----

export interface PlatformWriter {
  principal: PlatformPrincipal;
  ip: string;
}

export interface PlatformSharedArea {
  area: SharedArea;
  shapes: SharedAreaShape[];
  /** 各供应商从它引用的副本数 */
  copyCount: number;
  /** 被标成重复（隐藏中）时的标记；保留的那份的名称（不在库里了为 null） */
  duplicate: (SharedAreaDuplicate & { keepName: LocalizedText | null; keepInLibrary: boolean }) | null;
  /** 同城里和它相似、都没有隐藏的其他共享区域（隐藏中的不算疑似） */
  similar: { id: string; reasons: SharedAreaSimilarity[] }[];
}

/**
 * 运营后台的去重列表：一个城市里库里全部的区域（含隐藏中的，才能撤销），每个带疑似重复（同名或营运区重叠，和供应商新建时的提示同一个判断）、
 * 副本数和隐藏标记。不给创建者：平台只按名称和形状判断留哪份。`search` 按名称包含（不区分大小写）筛，疑似重复仍在全城范围里找。
 */
export async function listSharedAreasForPlatform(ctx: DbContext, filter: { cityId: string; search?: string | undefined }): Promise<{ items: PlatformSharedArea[]; truncated: boolean }> {
  return withPlatformTx(
    ctx.pool,
    async (db) => {
      const all = await listSharedAreaShapes(db, filter.cityId, null, { includeHidden: true });
      const ids = all.map((area) => area.id);
      const duplicates = await activeDuplicates(db, ids);
      const counts = await sharedCopyCounts(db, ids);
      const byId = new Map(all.map((area) => [area.id, area]));
      const visible = all.filter((area) => !duplicates.has(area.id));
      const needle = filter.search?.toLowerCase();
      const shown = needle === undefined ? all : all.filter((area) => Object.values(area.name).some((text) => text.toLowerCase().includes(needle)));
      const items = shown.map((area): PlatformSharedArea => {
        const mark = duplicates.get(area.id) ?? null;
        const keep = mark === null ? undefined : byId.get(mark.keepAreaId);
        const keepListed = keep !== undefined && !duplicates.has(keep.id);
        const similar =
          mark !== null
            ? []
            : visible.flatMap((other) => {
                if (other.id === area.id) return [];
                const reasons = sharedAreaSimilarity(similarityOf(area), similarityOf(other));
                return reasons.length === 0 ? [] : [{ id: other.id, reasons }];
              });
        const { shapes, ...summary } = area;
        return {
          area: summary,
          shapes,
          copyCount: counts.get(area.id) ?? 0,
          duplicate: mark === null ? null : { ...mark, keepName: keep?.name ?? null, keepInLibrary: keepListed },
          similar,
        };
      });
      return { items, truncated: all.length >= SHARED_AREAS_PER_CITY };
    },
    { snapshot: true },
  );
}

const MARK_ERRORS: Readonly<Record<DuplicateMarkProblem, { status: number; message: string }>> = {
  SHARED_AREA_NOT_FOUND: { status: 404, message: "共享区域不存在（可能已停用、删除，或是引用来的副本）" },
  SHARED_AREA_ALREADY_HIDDEN: { status: 409, message: "这个区域已经标为重复了；要改指向，先撤销" },
  SHARED_AREA_IS_KEEP_TARGET: { status: 409, message: "有别的区域被标成了它的重复（它是保留的那份）；先撤销那些标记" },
  DUPLICATE_KEEP_UNAVAILABLE: { status: 409, message: "保留的那份不在共享库里，或者自己也已标为重复" },
  DUPLICATE_CITY_MISMATCH: { status: 409, message: "两个区域不在同一个城市" },
  DUPLICATE_SAME_AREA: { status: 409, message: "不能把区域标成它自己的重复" },
};

/** 标记和撤销互相排队：两人同时把 A 标成 B、B 标成 A 时，后一个看得到前一个的结果（不会形成环）。 */
async function lockDuplicates(db: Db): Promise<void> {
  await db.query("select pg_advisory_xact_lock(hashtext(current_schema() || ':nozomi.shared-area-duplicates'))");
}

/**
 * 把 `areaId` 标成 `keepAreaId` 的重复：共享库里隐藏 areaId，以后引用它的改为引用 keepAreaId。
 * 只写平台的标记表和审计；不碰任何供应商的区域、副本、价格（所以不需要双人复核）。
 */
export async function markSharedAreaDuplicate(ctx: DbContext, writer: PlatformWriter, areaId: string, input: { keepAreaId: string; reason: string }): Promise<SharedAreaDuplicate> {
  const now = ctx.now();
  return withPlatformTx(ctx.pool, async (db) => {
    await lockDuplicates(db);
    const hide = await duplicateCandidate(db, areaId);
    const keep = await duplicateCandidate(db, input.keepAreaId);
    const problem = duplicateMarkProblem(hide, keep);
    if (problem !== null) {
      const error = MARK_ERRORS[problem];
      throw new AppError(error.status, problem === "SHARED_AREA_NOT_FOUND" ? "NOT_FOUND" : problem, error.message);
    }
    const mark = await insertDuplicate(db, { areaId, keepAreaId: input.keepAreaId, reason: input.reason, markedBy: writer.principal.user.id, now });
    await insertAuditLog(db, consoleOrigin(platformActor(writer.principal.user), writer.ip, now), {
      tenantId: null,
      resource: "shared_area_duplicate",
      resourceId: mark.id,
      action: "create",
      before: null,
      after: { area_id: areaId, keep_area_id: input.keepAreaId, reason: input.reason },
    });
    return mark;
  });
}

/** 撤销：区域重新出现在共享库里，以后引用它的照常引用它。之前转到保留那份的副本不变。没有生效中的标记时 409。 */
export async function revokeSharedAreaDuplicate(ctx: DbContext, writer: PlatformWriter, areaId: string, input: { reason: string | null }): Promise<SharedAreaDuplicate> {
  const now = ctx.now();
  return withPlatformTx(ctx.pool, async (db) => {
    await lockDuplicates(db);
    const revoked = await revokeDuplicate(db, areaId, { revokedBy: writer.principal.user.id, reason: input.reason, now });
    if (revoked === null) throw new AppError(409, "SHARED_AREA_NOT_HIDDEN", "这个区域没有标为重复，不用撤销");
    await insertAuditLog(db, consoleOrigin(platformActor(writer.principal.user), writer.ip, now), {
      tenantId: null,
      resource: "shared_area_duplicate",
      resourceId: revoked.id,
      action: "revoke",
      before: { area_id: areaId, keep_area_id: revoked.keepAreaId, revoked: false },
      after: { area_id: areaId, keep_area_id: revoked.keepAreaId, revoked: true, reason: input.reason },
    });
    return revoked;
  });
}
