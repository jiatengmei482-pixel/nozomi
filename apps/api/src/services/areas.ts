/**
 * 区域的业务流程（M1-02）：供应商自己的营运区和禁行区的查看、新增、修改、停用、启用、删除、自测。
 *
 * - 图形的规则（圆变多边形、一圈点合不合法、区域的上限、点在区域的哪里）都在 @nozomi/domain 的 areas.ts，
 *   浏览器里画图用的是同一份；这里负责取数据、调用规则、写库、写审计日志。
 * - 全部在租户事务里：租户编号只来自登录令牌，数据库的行级安全再兜一层。别的供应商的区域一律当作不存在（404）。
 * - 新增带幂等键；修改必须带版本号；内容没变的修改不加版本、不写日志。
 * - 所属城市必须是平台启用中的城市；城市后来被平台停用时，区域原样保留、仍然可以看和改，只是不能再启用（ADR 0015）。
 * - 供应商被平台暂停时仍然可以改自己的区域（需求文档：暂停 = 商品不参与比价，已有订单继续履约；账号照常能用）。
 */
import { isDeepStrictEqual } from "node:util";
import {
  AREA_LIMITS,
  type AreaBizType,
  type AreaPolygonKind,
  type AreaPolygonSource,
  type AreaShapeIssue,
  type AreaStatus,
  type LocalizedText,
  type PointLocation,
  type Position,
  areaNameKeys,
  areaShapeIssues,
  circleToRing,
  isLatitude,
  isLongitude,
  circleIssues,
  locatePoint,
  normalizeRing,
  roundCoordinate,
} from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type Db, withTenantTx } from "../db/context.ts";
import { isRetryableDbError } from "../errors.ts";
import type { TimeCursor } from "../pagination.ts";
import {
  type Area,
  type AreaCity,
  type AreaFilter,
  type AreaListItem,
  type AreaPolygon,
  type AreaPolygonDraft,
  areaNameTaken as nameTaken,
  countAreasByStatus,
  deleteArea as deleteAreaRow,
  findArea,
  findAreaCities,
  insertArea,
  listAreaPolygons,
  listAreas as listAreaRows,
  lockAreaNames,
  replaceAreaPolygons,
  updateArea as updateAreaRow,
} from "../repos/areas.ts";
import { type AuditValue, type AuditValues, insertAuditLog } from "../repos/audit-logs.ts";
import { type InputIssue, validationFailed } from "../validation.ts";
import { consoleOrigin, tenantActor } from "./audit.ts";
import { areaNameTaken, fieldLocked, masterDataNotReady, notFound, versionConflict } from "./errors.ts";
import { runIdempotent } from "./idempotency.ts";
import type { TenantPrincipal } from "./tenant-auth.ts";

/** 接口收到的一块图形：圆给圆心和半径，多边形给 GeoJSON；已有的图形带上编号。 */
export interface AreaPolygonInput {
  id: string | null;
  kind: AreaPolygonKind;
  label: string | null;
  source: AreaPolygonSource | null;
  circle: { center: { lat: number; lng: number }; radiusM: number } | null;
  geometry: { type: "Polygon"; coordinates: Position[][] } | null;
}

export interface AreaInput {
  cityId: string;
  name: LocalizedText;
  bizType: AreaBizType;
  polygons: AreaPolygonInput[];
}

/** 一个区域连同它的城市、块数；详情另带全部图形。 */
export interface AreaView {
  area: Area;
  city: AreaCity | null;
  operatePolygonCount: number;
  forbidPolygonCount: number;
  polygons: AreaPolygon[] | null;
}

export interface AreaWriter {
  principal: TenantPrincipal;
  ip: string;
}

/** 图形问题的中文说明（接口的 message；前端按 reason 显示自己的定稿文字）。 */
const SHAPE_MESSAGES: Readonly<Record<AreaShapeIssue["reason"], string>> = {
  NO_OPERATE_POLYGON: "至少要有一块营运区",
  TOO_MANY_POLYGONS: `一个区域最多 ${AREA_LIMITS.maxPolygons} 块图形`,
  TOO_MANY_TOTAL_VERTICES: `一个区域的全部图形加起来最多 ${AREA_LIMITS.maxTotalVertices} 个点`,
  INVALID_COORDINATE: "有坐标不合法：纬度必须在 -90 到 90 之间，经度必须在 -180 到 180 之间",
  TOO_FEW_POINTS: `至少要 ${AREA_LIMITS.minRingVertices} 个点才能围成一个范围`,
  TOO_MANY_VERTICES: `一个多边形最多 ${AREA_LIMITS.maxRingVertices} 个点`,
  DUPLICATE_POINT: "相邻的两个点在同一个位置",
  CROSSES_ANTIMERIDIAN: "不支持跨过 180° 经线的图形",
  COLLINEAR: "这些点在一条直线上，围不成一个范围",
  SELF_INTERSECTION: "有两条边交叉了",
};

function invalid(issues: InputIssue[]): never {
  throw validationFailed("body", issues);
}

function shapeIssue(issue: AreaShapeIssue): InputIssue {
  const { reason, ...rest } = issue;
  const detail = Object.fromEntries(Object.entries(rest).filter(([key]) => key !== "polygon")) as Record<string, number>;
  const path = "polygon" in issue ? `/polygons/${issue.polygon}/geometry` : "/polygons";
  return { path, reason, message: SHAPE_MESSAGES[reason], ...(Object.keys(detail).length > 0 ? { detail } : {}) };
}

/**
 * 把接口收到的图形变成要保存的样子，并做全部检查；有问题抛 400（每条带路径和原因代码）。
 * - 圆：按圆心和半径用 domain 的同一个函数算出多边形（前端提交的 geometry 不看）。
 * - 多边形：只能有一圈（不带洞）；坐标取 6 位小数、去掉闭合点、统一成逆时针。
 * - 已有的图形（带编号）保留编号；同一类里保留原来的序号。新图形的序号 = 这一类保存前的最大序号往上数，删掉的序号不再用。
 */
function buildPolygons(inputs: readonly AreaPolygonInput[], stored: readonly AreaPolygon[]): AreaPolygonDraft[] {
  const issues: InputIssue[] = [];
  const storedById = new Map(stored.map((polygon) => [polygon.id, polygon]));
  const nextSeq: Record<AreaPolygonKind, number> = {
    operate: Math.max(0, ...stored.filter((polygon) => polygon.kind === "operate").map((polygon) => polygon.seq)),
    forbid: Math.max(0, ...stored.filter((polygon) => polygon.kind === "forbid").map((polygon) => polygon.seq)),
  };
  const seenIds = new Set<string>();
  const drafts = inputs.map((input, index): AreaPolygonDraft => {
    const at = `/polygons/${index}`;
    const existing = input.id === null ? undefined : storedById.get(input.id);
    if (input.id !== null && (existing === undefined || seenIds.has(input.id))) {
      issues.push({ path: `${at}/id`, reason: "UNKNOWN_POLYGON", message: "这块图形不在这个区域里（新加的图形不要带编号），或者同一个编号出现了两次" });
    }
    if (input.id !== null) seenIds.add(input.id);
    const seq = existing !== undefined && existing.kind === input.kind ? existing.seq : (nextSeq[input.kind] += 1);
    let ring: Position[] = [];
    let circle: AreaPolygonDraft["circle"] = null;
    let source: AreaPolygonSource = input.source ?? "drawn";
    if (input.circle !== null) {
      const { center, radiusM } = input.circle;
      // 圆能不能存由 domain 的 circleIssues 说了算（前端保存前用的是同一个函数）。圆心、半径的问题在这里报；
      // 算出来的多边形的问题（跨 180° 经线、盖住极点）和手画的多边形一样，由下面的 areaShapeIssues 报在 geometry 上。
      const found = new Set(circleIssues(center, radiusM).map((issue) => issue.reason));
      if (found.has("INVALID_COORDINATE")) issues.push({ path: `${at}/circle/center`, reason: "INVALID_COORDINATE", message: SHAPE_MESSAGES.INVALID_COORDINATE });
      if (found.has("RADIUS_OUT_OF_RANGE")) {
        issues.push({ path: `${at}/circle/radius_m`, reason: "RADIUS_OUT_OF_RANGE", message: "半径要在 0.1 到 100 公里之间（100 到 100000 的整数米）" });
      }
      if (input.source !== null && input.source !== "circle") issues.push({ path: `${at}/source`, message: "带了圆心和半径的图形，来源只能是 circle" });
      source = "circle";
      if (!found.has("INVALID_COORDINATE") && !found.has("RADIUS_OUT_OF_RANGE")) {
        circle = { center: { lat: roundCoordinate(center.lat), lng: roundCoordinate(center.lng) }, radiusM };
        ring = circleToRing(circle.center, radiusM);
      }
    } else if (input.geometry === null) {
      issues.push({ path: `${at}/geometry`, message: "必填：多边形要给 geometry，圆要给 circle" });
    } else {
      if (source === "circle") issues.push({ path: `${at}/circle`, message: "来源是 circle 的图形必须给圆心和半径" });
      if (input.geometry.coordinates.length !== 1) {
        issues.push({ path: `${at}/geometry`, reason: "HAS_HOLES", message: "图形不能带洞，也不能是空的：要在营运区中间挖掉一块，请在那里画一块禁行区" });
      } else {
        ring = normalizeRing(input.geometry.coordinates[0] as Position[]);
      }
    }
    return { id: input.id, kind: input.kind, seq, label: input.label, source, circle, ring };
  });
  if (issues.length > 0) invalid(issues);
  const shapeIssues = areaShapeIssues(drafts);
  if (shapeIssues.length > 0) invalid(shapeIssues.map(shapeIssue));
  return drafts;
}

/** 审计日志里一块图形的样子：够看出是哪一块、改成了什么形状。 */
function polygonAudit(polygon: AreaPolygon | AreaPolygonDraft): AuditValue {
  return {
    kind: polygon.kind,
    seq: polygon.seq,
    label: polygon.label,
    source: polygon.source,
    circle: polygon.circle === null ? null : { center: { lat: polygon.circle.center.lat, lng: polygon.circle.center.lng }, radius_m: polygon.circle.radiusM },
    ring: polygon.ring.map((point) => [point[0], point[1]]),
  };
}

function areaAudit(area: Area, polygons: readonly (AreaPolygon | AreaPolygonDraft)[]): AuditValues {
  return { city_id: area.cityId, name: area.name, biz_type: area.bizType, status: area.status, polygons: polygons.map(polygonAudit) };
}

function counts(polygons: readonly { kind: AreaPolygonKind }[]): { operatePolygonCount: number; forbidPolygonCount: number } {
  return {
    operatePolygonCount: polygons.filter((polygon) => polygon.kind === "operate").length,
    forbidPolygonCount: polygons.filter((polygon) => polygon.kind === "forbid").length,
  };
}

async function detail(db: Db, tenantId: string, area: Area): Promise<AreaView> {
  const polygons = await listAreaPolygons(db, tenantId, area.id);
  const city = (await findAreaCities(db, [area.cityId])).get(area.cityId) ?? null;
  return { area, city, ...counts(polygons), polygons };
}

/** 数据库因为死锁、序列化失败放弃事务时自动重做（接口层对仍不成功的返回 409 CONCURRENT_UPDATE）。 */
async function writeTx<T>(ctx: AppContext, tenantId: string, fn: (db: Db) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await withTenantTx(ctx.pool, tenantId, fn);
    } catch (err) {
      if (attempt >= 3 || !isRetryableDbError(err)) throw err;
    }
  }
}

function audit(db: Db, ctx: AppContext, writer: AreaWriter, now: Date, event: { areaId: string; action: "create" | "update" | "delete" | "disable" | "enable"; before: AuditValues | null; after: AuditValues | null }): Promise<void> {
  return insertAuditLog(db, consoleOrigin(tenantActor(writer.principal.user), writer.ip, now), {
    tenantId: writer.principal.tenantId,
    resource: "area",
    resourceId: event.areaId,
    action: event.action,
    before: event.before,
    after: event.after,
  });
}

export async function listAreas(
  ctx: AppContext,
  tenantId: string,
  filter: AreaFilter,
  limit: number,
  after: TimeCursor | null,
): Promise<{ items: AreaView[]; nextCursor: string | null; total: number }> {
  return withTenantTx(
    ctx.pool,
    tenantId,
    async (db) => {
      const page = await listAreaRows(db, tenantId, filter, limit, after);
      const cities = await findAreaCities(db, [...new Set(page.items.map((item) => item.cityId))]);
      const items = page.items.map((item: AreaListItem): AreaView => {
        const { operatePolygonCount, forbidPolygonCount, ...area } = item;
        return { area, city: cities.get(item.cityId) ?? null, operatePolygonCount, forbidPolygonCount, polygons: null };
      });
      return { items, nextCursor: page.nextCursor, total: page.total };
    },
    { snapshot: true },
  );
}

export async function getArea(ctx: AppContext, tenantId: string, id: string): Promise<AreaView> {
  return withTenantTx(
    ctx.pool,
    tenantId,
    async (db) => {
      const area = await findArea(db, tenantId, id, { lock: false });
      if (!area) throw notFound("区域");
      return detail(db, tenantId, area);
    },
    { snapshot: true },
  );
}

/**
 * 新增区域（带幂等键）。新增的区域直接是启用的，所以所属城市必须是平台启用中的城市。
 * `respond` 把结果变成接口的应答：幂等键的记录里存的就是它，同一个键再来时原样返回。
 */
export async function createArea(
  ctx: AppContext,
  writer: AreaWriter,
  input: AreaInput,
  idempotency: { scope: string; key: string },
  respond: (view: AreaView) => Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const now = ctx.now();
  const tenantId = writer.principal.tenantId;
  return writeTx(ctx, tenantId, (db) =>
    runIdempotent(db, { tenantId, scope: idempotency.scope, key: idempotency.key, request: input, now }, async () => {
      const city = (await findAreaCities(db, [input.cityId])).get(input.cityId);
      if (!city) invalid([{ path: "/city_id", message: "城市不存在" }]);
      const drafts = buildPolygons(input.polygons, []);
      if (city.status !== "active") throw masterDataNotReady("CITY_DISABLED", "所属城市已被平台停用，不能在它下面新增区域");
      const nameKeys = areaNameKeys(input.name);
      await lockAreaNames(db, tenantId, input.cityId);
      if (await nameTaken(db, tenantId, input.cityId, nameKeys, null)) throw areaNameTaken();
      const area = await insertArea(db, tenantId, input.cityId, { name: input.name, nameKeys, bizType: input.bizType }, now);
      await replaceAreaPolygons(db, tenantId, area.id, drafts);
      await audit(db, ctx, writer, now, { areaId: area.id, action: "create", before: null, after: areaAudit(area, drafts) });
      return { status: 201, body: respond(await detail(db, tenantId, area)) };
    }),
  );
}

export interface AreaUpdate {
  /** 带了且和现有的不同 → 409 FIELD_LOCKED */
  cityId: string | null;
  name: LocalizedText;
  bizType: AreaBizType;
  polygons: AreaPolygonInput[];
}

/** 两块图形（保存前的和要保存的）是不是一模一样。 */
function samePolygon(stored: AreaPolygon, draft: AreaPolygonDraft): boolean {
  return (
    draft.id === stored.id &&
    draft.kind === stored.kind &&
    draft.seq === stored.seq &&
    draft.label === stored.label &&
    draft.source === stored.source &&
    isDeepStrictEqual(draft.circle, stored.circle) &&
    isDeepStrictEqual(draft.ring, stored.ring)
  );
}

/** 修改区域：名称、业务类型、图形整体替换。城市创建后不能改。内容没变时原样返回，不加版本、不写日志。 */
export async function updateArea(ctx: AppContext, writer: AreaWriter, id: string, expectedVersion: number, input: AreaUpdate): Promise<AreaView> {
  const now = ctx.now();
  const tenantId = writer.principal.tenantId;
  return writeTx(ctx, tenantId, async (db) => {
    const current = await findArea(db, tenantId, id, { lock: true });
    if (!current) throw notFound("区域");
    if (current.version !== expectedVersion) throw versionConflict(current.version);
    if (input.cityId !== null && input.cityId !== current.cityId) throw fieldLocked(["city_id"]);
    const stored = await listAreaPolygons(db, tenantId, id);
    const drafts = buildPolygons(input.polygons, stored);

    const nameChanged = !isDeepStrictEqual(input.name, current.name);
    const bizTypeChanged = input.bizType !== current.bizType;
    const polygonsChanged = drafts.length !== stored.length || drafts.some((draft, index) => !samePolygon(stored[index] as AreaPolygon, draft));
    if (!nameChanged && !bizTypeChanged && !polygonsChanged) return detail(db, tenantId, current);

    const nameKeys = areaNameKeys(input.name);
    if (nameChanged) {
      await lockAreaNames(db, tenantId, current.cityId);
      if (await nameTaken(db, tenantId, current.cityId, nameKeys, id)) throw areaNameTaken();
    }
    const updated = await updateAreaRow(db, tenantId, id, { name: input.name, nameKeys, bizType: input.bizType }, current.status, now);
    if (polygonsChanged) await replaceAreaPolygons(db, tenantId, id, drafts);
    const before: AuditValues = {};
    const after: AuditValues = {};
    if (nameChanged) [before["name"], after["name"]] = [current.name, updated.name];
    if (bizTypeChanged) [before["biz_type"], after["biz_type"]] = [current.bizType, updated.bizType];
    if (polygonsChanged) [before["polygons"], after["polygons"]] = [stored.map(polygonAudit), drafts.map(polygonAudit)];
    await audit(db, ctx, writer, now, { areaId: id, action: "update", before, after });
    return detail(db, tenantId, updated);
  });
}

/**
 * 停用 / 启用。启用时所属城市必须是启用中的。已经是目标状态时原样返回。
 * 「被已上架的商品用着的不能停用」等有了商品（M1-03）在这里加检查，返回 409 AREA_IN_USE。
 */
export async function setAreaStatus(ctx: AppContext, writer: AreaWriter, id: string, status: AreaStatus): Promise<AreaView> {
  const now = ctx.now();
  const tenantId = writer.principal.tenantId;
  return writeTx(ctx, tenantId, async (db) => {
    const current = await findArea(db, tenantId, id, { lock: true });
    if (!current) throw notFound("区域");
    if (current.status === status) return detail(db, tenantId, current);
    if (status === "active") {
      const city = (await findAreaCities(db, [current.cityId])).get(current.cityId);
      if (!city || city.status !== "active") throw masterDataNotReady("CITY_DISABLED", "所属城市已被平台停用，不能启用这个区域");
    }
    const updated = await updateAreaRow(db, tenantId, id, null, status, now);
    await audit(db, ctx, writer, now, {
      areaId: id,
      action: status === "disabled" ? "disable" : "enable",
      before: { status: current.status },
      after: { status: updated.status },
    });
    return detail(db, tenantId, updated);
  });
}

/**
 * 删除区域（真的删除，连同它的图形；不能恢复）。删除前的完整内容记在审计日志里。
 * 「被已上架的商品用着的不能删除」等有了商品（M1-03）在这里加检查，返回 409 AREA_IN_USE。
 */
export async function deleteArea(ctx: AppContext, writer: AreaWriter, id: string): Promise<void> {
  const now = ctx.now();
  const tenantId = writer.principal.tenantId;
  await writeTx(ctx, tenantId, async (db) => {
    const current = await findArea(db, tenantId, id, { lock: true });
    if (!current) throw notFound("区域");
    const stored = await listAreaPolygons(db, tenantId, id);
    await deleteAreaRow(db, tenantId, id);
    await audit(db, ctx, writer, now, { areaId: id, action: "delete", before: areaAudit(current, stored), after: null });
  });
}

/** 自测：一个位置在这个区域的营运区里、禁行区里，还是都不在。不管在不在都正常返回；停用的区域也能测。 */
export async function checkAreaPoint(ctx: AppContext, tenantId: string, id: string, point: { lat: number; lng: number }): Promise<PointLocation> {
  if (!isLatitude(point.lat)) invalid([{ path: "/lat", reason: "INVALID_COORDINATE", message: "纬度必须在 -90 到 90 之间" }]);
  if (!isLongitude(point.lng)) invalid([{ path: "/lng", reason: "INVALID_COORDINATE", message: "经度必须在 -180 到 180 之间" }]);
  const polygons = await withTenantTx(
    ctx.pool,
    tenantId,
    async (db) => {
      const area = await findArea(db, tenantId, id, { lock: false });
      if (!area) throw notFound("区域");
      return listAreaPolygons(db, tenantId, id);
    },
    { snapshot: true },
  );
  return locatePoint(polygons, point);
}

/** 首页上本租户的区域数量。 */
export function areaCounts(ctx: AppContext, tenantId: string): Promise<{ active: number; disabled: number }> {
  return withTenantTx(ctx.pool, tenantId, (db) => countAreasByStatus(db, tenantId), { snapshot: true });
}

