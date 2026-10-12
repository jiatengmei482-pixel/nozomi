/**
 * 平台主数据的业务流程（M1-01）：城市、地点、车型组、附加服务的查看、新增、修改、停用、启用。
 *
 * - 规则本身在 @nozomi/domain 的 master-data.ts（纯函数）；这里负责取数据、调用规则、写库、写审计日志。
 * - 平台员工的每次改动都在一个平台事务里完成并写审计日志（改了哪些字段、前后值）；没有变化的修改不记日志、版本号不变。
 * - 修改必须带当前版本号：和库里的不一致说明别人先改过了，返回 409，不会互相覆盖。
 * - 没有删除，只有停用（需求文档「主数据只做停用，不做物理删除」）。还有启用中的下级在用时不能停用。
 * - 租户只能读：读也走租户事务，数据库里租户角色对这些表只有 select 权限。
 */
import { isDeepStrictEqual } from "node:util";
import {
  type AddonChargeUnit,
  type CitySuggestionReason,
  type FlightScope,
  type GeoJsonMultiPolygon,
  type GeoJsonPolygon,
  type LocalizedText,
  type MasterDataStatus,
  PLACE_ENABLE_BLOCKER_MESSAGES,
  type PlaceCategory,
  type PlaceType,
  type ServiceCategory,
  type VehicleCombo,
  type VehicleGrade,
  type VehiclePower,
  addonCodeIssue,
  boundaryIssues,
  cityCodeIssue,
  isCountryCode,
  isIanaTimeZone,
  isLatitude,
  isLongitude,
  placeAttributeIssues,
  placeCodeIssue,
  placeEnableBlocker,
  requiredParentType,
  roundCoordinate,
  vehicleComboIssues,
  vehicleGroupCodeIssue,
  rankCitySuggestions,
} from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { isRetryableDbError } from "../errors.ts";
import { type Db, isUniqueViolation, withPlatformTx, withTenantTx } from "../db/context.ts";
import { type AuditResource, type AuditValue, type AuditValues, insertAuditLog } from "../repos/audit-logs.ts";
import {
  ADDONS,
  type Addon,
  CITIES,
  type City,
  type ColumnValues,
  type MasterFilter,
  type MasterOrder,
  type MasterPage,
  type MasterTable,
  PLACES,
  type Place,
  VEHICLE_GROUPS,
  type VehicleGroup,
  countActiveChildPlaces,
  countActivePlacesInCity,
  type MasterRef,
  findCityRefs,
  findMasterRow,
  findPlaceParentId,
  findPlaceRefs,
  insertMasterRow,
  isKnownTimeZone,
  listActiveCityCandidates,
  listMasterRows,
  lockMasterReferenceExclusive,
  moveChildPlacesToCity,
  updateMasterRow,
} from "../repos/master-data.ts";
import { type MasterReference, countPublishedProductsUsing } from "../repos/products.ts";
import { type InputIssue, validationFailed } from "../validation.ts";
import { consoleOrigin, platformActor } from "./audit.ts";
import { codeTaken, fieldLocked, masterDataInUse, masterDataNotReady, notFound, versionConflict } from "./errors.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";

type Item = City | Place | VehicleGroup | Addon;

/** 一类主数据：对应哪张表、审计日志里叫什么、给人看的名字，以及一条记录在审计日志里记哪些字段。 */
export interface MasterResource<T extends Item> {
  spec: MasterTable<T>;
  audit: AuditResource;
  label: string;
  /** 列名 → 值：既用来比较「改了哪些字段」，也是审计日志里的前后值 */
  columns(item: T): Record<string, AuditValue>;
}

export const CITY: MasterResource<City> = {
  spec: CITIES,
  audit: "city",
  label: "城市",
  columns: (city) => ({
    code: city.code,
    country_code: city.countryCode,
    name: city.name,
    timezone: city.timezone,
    center_lng: city.centerLng,
    center_lat: city.centerLat,
    boundary: city.boundary as AuditValue,
    // 来源只有导入的城市才记：手工录入的城市的审计内容和以前一样
    ...(city.source === null ? {} : { source: city.source, source_ref: city.sourceRef, source_overridden: city.sourceOverridden }),
  }),
};

export const PLACE: MasterResource<Place> = {
  spec: PLACES,
  audit: "place",
  label: "地点",
  columns: (place) => ({
    type: place.type,
    code: place.code,
    country_code: place.countryCode,
    city_id: place.cityId,
    parent_id: place.parentId,
    name: place.name,
    lng: place.lng,
    lat: place.lat,
    category: place.category,
    flight_scope: place.flightScope,
    address: place.address,
    source: place.source,
    source_ref: place.sourceRef,
    source_overridden: place.sourceOverridden,
  }),
};

export const VEHICLE_GROUP: MasterResource<VehicleGroup> = {
  spec: VEHICLE_GROUPS,
  audit: "vehicle_group",
  label: "车型组",
  columns: (group) => ({
    code: group.code,
    grade: group.grade,
    seats: group.seats,
    name: group.name,
    sample_models: group.sampleModels,
    power: group.power,
    combos: group.combos.map((combo) => ({ passengers: combo.passengers, luggage: combo.luggage })),
  }),
};

export const ADDON: MasterResource<Addon> = {
  spec: ADDONS,
  audit: "addon",
  label: "附加服务",
  columns: (addon) => ({
    code: addon.code,
    categories: addon.categories,
    charge_unit: addon.chargeUnit,
    name: addon.name,
    description: addon.description,
  }),
};

/** 谁在读：平台员工，或某个租户的用户（租户编号来自登录令牌）。 */
export type MasterReader = { kind: "platform" } | { kind: "tenant"; tenantId: string };

/** 读事务：只读，而且整个事务读同一个快照——列表的总数和当页内容是先后两条查询，这样才对得上。 */
function readTx<T>(ctx: AppContext, reader: MasterReader, fn: (db: Db) => Promise<T>): Promise<T> {
  const options = { snapshot: true };
  return reader.kind === "platform" ? withPlatformTx(ctx.pool, fn, options) : withTenantTx(ctx.pool, reader.tenantId, fn, options);
}

export function listMaster<T extends Item>(
  ctx: AppContext,
  reader: MasterReader,
  resource: MasterResource<T>,
  filter: MasterFilter,
  limit: number,
  order: MasterOrder,
): Promise<MasterPage<T>> {
  return readTx(ctx, reader, (db) => listMasterRows(db, resource.spec, filter, limit, order));
}

export async function getMaster<T extends Item>(
  ctx: AppContext,
  reader: MasterReader,
  resource: MasterResource<T>,
  id: string,
): Promise<T> {
  const item = await readTx(ctx, reader, (db) => findMasterRow(db, resource.spec, id, { lock: false }));
  if (!item) throw notFound(resource.label);
  return item;
}

/** 平台员工的一次写操作：谁、从哪来、什么时间。 */
export interface MasterWriter {
  principal: PlatformPrincipal;
  ip: string;
}

/** 数据库因为死锁、序列化失败放弃事务时，最多重做几次 */
const WRITE_ATTEMPTS = 3;

/**
 * 写操作的平台事务。数据库主动放弃的事务（死锁、序列化失败）已经整体回滚，重做一遍即可：
 * 这里自动重做，仍不成功才把错误交出去（接口层会返回 409 CONCURRENT_UPDATE，而不是 500）。
 */
async function writeTx<T>(ctx: AppContext, fn: (db: Db) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await withPlatformTx(ctx.pool, fn);
    } catch (err) {
      if (attempt >= WRITE_ATTEMPTS || !isRetryableDbError(err)) throw err;
    }
  }
}

/**
 * 加锁顺序统一是「先上级、后下级」：要锁航站楼 / 出口之前，先锁它的机场 / 车站。
 * 机场换城市时是先锁机场、再改它下面的航站楼；启用航站楼如果反过来先锁航站楼、再锁机场，两边就会互相等死。
 * 上级创建后不能改，所以先不加锁读出上级编号是安全的。
 */
async function lockParentFirst<T extends Item>(db: Db, resource: MasterResource<T>, id: string): Promise<void> {
  if (resource.spec.table !== PLACES.table) return;
  const parentId = await findPlaceParentId(db, id);
  if (parentId !== null) await findMasterRow(db, PLACES, parentId, { lock: true });
}

function invalid(issues: InputIssue[]): never {
  throw validationFailed("body", issues);
}

async function create<T extends Item>(
  ctx: AppContext,
  writer: MasterWriter,
  resource: MasterResource<T>,
  build: (db: Db) => Promise<ColumnValues>,
): Promise<T> {
  const now = ctx.now();
  try {
    return await writeTx(ctx, async (db) => {
      const created = await insertMasterRow(db, resource.spec, await build(db), "active", now);
      await insertAuditLog(db, consoleOrigin(platformActor(writer.principal.user), writer.ip, now), {
        tenantId: null,
        resource: resource.audit,
        resourceId: created.id,
        action: "create",
        before: null,
        after: { ...resource.columns(created), status: created.status },
      });
      return created;
    });
  } catch (err) {
    if (isUniqueViolation(err, resource.spec.codeConstraint)) throw codeTaken();
    throw err;
  }
}

/** 修改请求：每个字段都可以不带（不带 = 不改）。 */
type Patch<T> = { [K in keyof T]?: T[K] | undefined };

interface Change<T> {
  /** 这次请求里带了的字段的新值（列名 → 值）；和现有值相同的会被忽略 */
  values: ColumnValues;
  /** 写完之后还要做的事（如让下级跟着换城市）；返回值并入审计日志的 after */
  afterWrite?: (db: Db, updated: T, now: Date) => Promise<AuditValues>;
}

async function update<T extends Item>(
  ctx: AppContext,
  writer: MasterWriter,
  resource: MasterResource<T>,
  id: string,
  expectedVersion: number,
  locked: Readonly<Record<string, unknown>>,
  change: (db: Db, current: T) => Promise<Change<T>>,
): Promise<T> {
  const now = ctx.now();
  return writeTx(ctx, async (db) => {
    await lockParentFirst(db, resource, id);
    const current = await findMasterRow(db, resource.spec, id, { lock: true });
    if (!current) throw notFound(resource.label);
    if (current.version !== expectedVersion) throw versionConflict(current.version);
    const before = resource.columns(current);
    const touchedLocked = Object.entries(locked)
      .filter(([field, value]) => value !== undefined && !isDeepStrictEqual(value, before[field]))
      .map(([field]) => field);
    if (touchedLocked.length > 0) throw fieldLocked(touchedLocked);

    const { values, afterWrite } = await change(db, current);
    const changed = Object.fromEntries(Object.entries(values).filter(([column, value]) => !isDeepStrictEqual(value, before[column])));
    if (Object.keys(changed).length === 0) return current;
    const updated = await updateMasterRow(db, resource.spec, id, changed, current.status, now);
    const extra = afterWrite ? await afterWrite(db, updated, now) : {};
    await insertAuditLog(db, consoleOrigin(platformActor(writer.principal.user), writer.ip, now), {
      tenantId: null,
      resource: resource.audit,
      resourceId: id,
      action: "update",
      before: Object.fromEntries(Object.keys(changed).map((column) => [column, before[column] ?? null])),
      after: { ...(changed as AuditValues), ...extra },
    });
    return updated;
  });
}

async function setStatus<T extends Item>(
  ctx: AppContext,
  writer: MasterWriter,
  resource: MasterResource<T>,
  id: string,
  status: MasterDataStatus,
  /** 检查能不能改；可以返回要和状态一起改的列（如启用地点的同时指定城市） */
  guard: (db: Db, current: T) => Promise<ColumnValues | void>,
  /** 状态已经是目标状态时也要做的检查 */
  precheck: (current: T) => void = () => {},
): Promise<T> {
  const now = ctx.now();
  return writeTx(ctx, async (db) => {
    // 停用：先和「正在上架、要用这一条」的商品互斥（先于任何行锁），再去数有多少已上架的商品在用
    if (status === "disabled") await lockMasterReferenceExclusive(db, id);
    await lockParentFirst(db, resource, id);
    const current = await findMasterRow(db, resource.spec, id, { lock: true });
    if (!current) throw notFound(resource.label);
    precheck(current);
    if (current.status === status) return current;
    const columnsBefore = resource.columns(current);
    const extra = Object.fromEntries(
      Object.entries((await guard(db, current)) ?? {}).filter(([column, value]) => !isDeepStrictEqual(value, columnsBefore[column])),
    );
    const updated = await updateMasterRow(db, resource.spec, id, extra, status, now);
    await insertAuditLog(db, consoleOrigin(platformActor(writer.principal.user), writer.ip, now), {
      tenantId: null,
      resource: resource.audit,
      resourceId: id,
      action: status === "disabled" ? "disable" : "enable",
      before: { status: current.status, ...Object.fromEntries(Object.keys(extra).map((column) => [column, columnsBefore[column] ?? null])) },
      after: { status: updated.status, ...(extra as AuditValues) },
    });
    return updated;
  });
}

/** 把 `undefined`（请求里没带）的字段去掉，只留下这次要改的。 */
function supplied(values: Record<string, unknown>): ColumnValues {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined));
}

function coordinateIssues(lng: number, lat: number, lngPath: string, latPath: string): InputIssue[] {
  const issues: InputIssue[] = [];
  if (!isLongitude(lng)) issues.push({ path: lngPath, message: "经度必须在 -180 到 180 之间" });
  if (!isLatitude(lat)) issues.push({ path: latPath, message: "纬度必须在 -90 到 90 之间" });
  return issues;
}

/**
 * 有已上架的商品在用这条主数据时不能停用（ADR 0012 留下的检查，ADR 0016 补上）：
 * 停用会让那些商品报不出价，要供应商先下架或换掉。草稿、已下架的商品不拦——它们上架时的校验会指出来。
 */
async function assertNoPublishedProducts(db: Db, reference: MasterReference, id: string, what: string): Promise<void> {
  const count = await countPublishedProductsUsing(db, reference, id);
  if (count > 0) throw masterDataInUse(`有 ${count} 个已上架的商品在用${what}，不能停用。请先让供应商下架这些商品或换掉它`, count);
}

// ---- 城市 ----

export interface CityInput {
  code: string;
  countryCode: string;
  name: LocalizedText;
  timezone: string;
  centerLng: number;
  centerLat: number;
  boundary: GeoJsonPolygon | GeoJsonMultiPolygon | null;
}

export type CityPatch = Patch<CityInput>;

const TIME_ZONE_ISSUE: InputIssue = { path: "/timezone", message: "不是合法的 IANA 时区名，例如 Asia/Tokyo" };

/** 时区名先过规则（形状、运行环境认识），再和数据库的时区名单逐字核对（区分大小写）。 */
async function assertCity(db: Db, city: CityInput): Promise<void> {
  const issues = cityIssues(city);
  if (!issues.includes(TIME_ZONE_ISSUE) && !(await isKnownTimeZone(db, city.timezone))) issues.push(TIME_ZONE_ISSUE);
  if (issues.length > 0) invalid(issues);
}

function cityIssues(city: CityInput): InputIssue[] {
  const issues: InputIssue[] = [];
  if (!isCountryCode(city.countryCode)) issues.push({ path: "/country_code", message: "不是合法的国家码（ISO 3166-1 两位大写字母）" });
  else {
    const codeIssue = cityCodeIssue(city.code, city.countryCode);
    if (codeIssue !== null) issues.push({ path: "/code", message: codeIssue });
  }
  if (!isIanaTimeZone(city.timezone)) issues.push(TIME_ZONE_ISSUE);
  issues.push(...coordinateIssues(city.centerLng, city.centerLat, "/center/lng", "/center/lat"));
  if (city.boundary !== null) issues.push(...boundaryIssues(city.boundary).map((message) => ({ path: "/boundary", message })));
  return issues;
}

function cityColumns(city: Patch<CityInput>): ColumnValues {
  return supplied({
    code: city.code,
    country_code: city.countryCode,
    name: city.name,
    timezone: city.timezone,
    center_lng: city.centerLng === undefined ? undefined : roundCoordinate(city.centerLng),
    center_lat: city.centerLat === undefined ? undefined : roundCoordinate(city.centerLat),
    boundary: city.boundary,
  });
}

export function createCity(ctx: AppContext, writer: MasterWriter, input: CityInput): Promise<City> {
  return create(ctx, writer, CITY, async (db) => {
    await assertCity(db, input);
    return cityColumns(input);
  });
}

export function updateCity(ctx: AppContext, writer: MasterWriter, id: string, version: number, patch: CityPatch): Promise<City> {
  return update(ctx, writer, CITY, id, version, { code: patch.code, country_code: patch.countryCode }, async (db, current) => {
    const merged: CityInput = {
      code: current.code,
      countryCode: current.countryCode,
      name: patch.name ?? current.name,
      timezone: patch.timezone ?? current.timezone,
      centerLng: patch.centerLng ?? current.centerLng,
      centerLat: patch.centerLat ?? current.centerLat,
      boundary: patch.boundary === undefined ? current.boundary : patch.boundary,
    };
    await assertCity(db, merged);
    const values = cityColumns({ ...patch, code: undefined, countryCode: undefined });
    // 导入的城市被改了名称、时区或中心坐标：记下「平台改过」，以后再导入不会覆盖这次修改
    const sourceFieldChanged =
      (patch.name !== undefined && !isDeepStrictEqual(patch.name, current.name)) ||
      merged.timezone !== current.timezone ||
      (values["center_lng"] !== undefined && values["center_lng"] !== current.centerLng) ||
      (values["center_lat"] !== undefined && values["center_lat"] !== current.centerLat);
    return { values: current.source !== null && sourceFieldChanged ? { ...values, source_overridden: true } : values };
  });
}

export function setCityStatus(ctx: AppContext, writer: MasterWriter, id: string, status: MasterDataStatus): Promise<City> {
  return setStatus(ctx, writer, CITY, id, status, async (db, city) => {
    if (status !== "disabled") return;
    const active = await countActivePlacesInCity(db, city.id);
    if (active > 0) throw masterDataInUse(`这个城市下还有 ${active} 个启用中的地点，请先停用它们`, active);
    await assertNoPublishedProducts(db, "city", city.id, "这个城市");
  });
}

// ---- 地点 ----

export interface PlaceInput {
  type: PlaceType;
  code: string;
  cityId: string | null;
  parentId: string | null;
  name: LocalizedText;
  lng: number;
  lat: number;
  category: PlaceCategory | null;
  flightScope: FlightScope | null;
  address: string | null;
}

export interface PlacePatch {
  type?: PlaceType | undefined;
  code?: string | undefined;
  parentId?: string | null | undefined;
  cityId?: string | undefined;
  name?: LocalizedText | undefined;
  lng?: number | undefined;
  lat?: number | undefined;
  category?: PlaceCategory | null | undefined;
  flightScope?: FlightScope | null | undefined;
  address?: string | null | undefined;
}

function placeFieldIssues(type: PlaceType, place: Pick<PlaceInput, "lng" | "lat" | "category" | "flightScope" | "address">): InputIssue[] {
  const paths = { category: "/category", flightScope: "/flight_scope", address: "/address" } as const;
  return [
    ...coordinateIssues(place.lng, place.lat, "/location/lng", "/location/lat"),
    ...placeAttributeIssues(type, place).map(([field, message]) => ({ path: paths[field], message })),
  ];
}

function notReady(blocker: keyof typeof PLACE_ENABLE_BLOCKER_MESSAGES): never {
  throw masterDataNotReady(blocker, PLACE_ENABLE_BLOCKER_MESSAGES[blocker]);
}

/**
 * 新增地点。新增的地点直接是启用的，所以它的城市（航站楼 / 出口则是它的上级）必须已经启用。
 * 航站楼和出口的城市、国家跟随上级，不单独指定。
 */
export function createPlace(ctx: AppContext, writer: MasterWriter, input: PlaceInput): Promise<Place> {
  return create(ctx, writer, PLACE, async (db) => {
    const parentType = requiredParentType(input.type);
    let countryCode: string;
    let cityId: string;
    let parentCode: string | null = null;
    if (parentType !== null) {
      if (input.parentId === null) invalid([{ path: "/parent_id", message: input.type === "terminal" ? "航站楼必须指定所属机场" : "出口必须指定所属车站" }]);
      const parent = await findMasterRow(db, PLACES, input.parentId, { lock: true });
      if (!parent || parent.type !== parentType) {
        invalid([{ path: "/parent_id", message: parentType === "airport" ? "所属机场不存在" : "所属车站不存在" }]);
      }
      if (input.cityId !== null && input.cityId !== parent.cityId) {
        invalid([{ path: "/city_id", message: "航站楼和出口的城市跟随上级，不用单独指定" }]);
      }
      if (parent.status !== "active" || parent.cityId === null) notReady("PARENT_DISABLED");
      countryCode = parent.countryCode;
      cityId = parent.cityId;
      parentCode = parent.code;
    } else {
      if (input.parentId !== null) invalid([{ path: "/parent_id", message: "只有航站楼和出口有上级" }]);
      if (input.cityId === null) invalid([{ path: "/city_id", message: "必填" }]);
      const city = await findMasterRow(db, CITIES, input.cityId, { lock: true });
      if (!city) invalid([{ path: "/city_id", message: "城市不存在" }]);
      if (city.status !== "active") notReady("CITY_DISABLED");
      countryCode = city.countryCode;
      cityId = city.id;
    }
    const issues = placeFieldIssues(input.type, input);
    const codeIssue = placeCodeIssue(input.type, input.code, { countryCode, parentCode });
    if (codeIssue !== null) issues.unshift({ path: "/code", message: codeIssue });
    if (issues.length > 0) invalid(issues);
    return {
      type: input.type,
      code: input.code,
      country_code: countryCode,
      city_id: cityId,
      parent_id: input.parentId,
      name: input.name,
      lng: roundCoordinate(input.lng),
      lat: roundCoordinate(input.lat),
      category: input.category,
      flight_scope: input.flightScope,
      address: input.address,
    };
  });
}

/**
 * 修改地点。类型、编码、上级创建后不能改。
 * - 换城市：新城市必须在同一个国家；地点是启用的话新城市也必须是启用的。机场、车站换城市时，它下面的航站楼、出口跟着换。
 * - 导入的机场被改了英文名或坐标：记下「平台改过」，以后再导入不会覆盖这次修改。
 */
export function updatePlace(ctx: AppContext, writer: MasterWriter, id: string, version: number, patch: PlacePatch): Promise<Place> {
  const locked = { type: patch.type, code: patch.code, parent_id: patch.parentId };
  return update(ctx, writer, PLACE, id, version, locked, async (db, current) => {
    const cityChanged = patch.cityId !== undefined && patch.cityId !== current.cityId;
    if (cityChanged) {
      if (current.parentId !== null) invalid([{ path: "/city_id", message: "航站楼和出口的城市跟随上级，不用单独指定" }]);
      const city = await findMasterRow(db, CITIES, patch.cityId as string, { lock: true });
      if (!city) invalid([{ path: "/city_id", message: "城市不存在" }]);
      if (city.countryCode !== current.countryCode) {
        invalid([{ path: "/city_id", message: `这个城市属于 ${city.countryCode}，而地点在 ${current.countryCode}` }]);
      }
      if (current.status === "active" && city.status !== "active") notReady("CITY_DISABLED");
    }
    const merged = {
      lng: patch.lng ?? current.lng,
      lat: patch.lat ?? current.lat,
      category: patch.category === undefined ? current.category : patch.category,
      flightScope: patch.flightScope === undefined ? current.flightScope : patch.flightScope,
      address: patch.address === undefined ? current.address : patch.address,
    };
    const issues = placeFieldIssues(current.type, merged);
    if (issues.length > 0) invalid(issues);

    const lng = patch.lng === undefined ? undefined : roundCoordinate(patch.lng);
    const lat = patch.lat === undefined ? undefined : roundCoordinate(patch.lat);
    const sourceFieldChanged =
      (lng !== undefined && lng !== current.lng) ||
      (lat !== undefined && lat !== current.lat) ||
      (patch.name !== undefined && (patch.name.en ?? null) !== (current.name.en ?? null));
    return {
      values: supplied({
        city_id: patch.cityId,
        name: patch.name,
        lng,
        lat,
        category: patch.category,
        flight_scope: patch.flightScope,
        address: patch.address,
        source_overridden: current.source !== null && sourceFieldChanged ? true : undefined,
      }),
      afterWrite: async (tx, updated, now) => {
        if (!cityChanged || updated.cityId === null) return {};
        const moved = await moveChildPlacesToCity(tx, updated.id, updated.cityId, now);
        return moved > 0 ? { children_moved: moved } : {};
      },
    };
  });
}

/**
 * 停用 / 启用地点。启用时可以顺带指定所属城市（`cityId`）：导入的机场「指定城市并启用」在一个事务里完成，
 * 不会出现城市写进去了、启用却失败的半截状态。只能给还没有城市的地点指定；已经有城市的要换城市请用修改接口（带版本号）。
 */
export function setPlaceStatus(
  ctx: AppContext,
  writer: MasterWriter,
  id: string,
  status: MasterDataStatus,
  cityId?: string | undefined,
): Promise<Place> {
  return setStatus(
    ctx,
    writer,
    PLACE,
    id,
    status,
    async (db, place) => {
      if (status === "disabled") {
        const active = await countActiveChildPlaces(db, place.id);
        if (active > 0) throw masterDataInUse(`它下面还有 ${active} 个启用中的航站楼或出口，请先停用它们`, active);
        await assertNoPublishedProducts(db, "place", place.id, "这个地点");
        return;
      }
      const targetCityId = place.cityId ?? cityId ?? null;
      const city = targetCityId === null ? null : await findMasterRow(db, CITIES, targetCityId, { lock: true });
      if (targetCityId !== null && !city) invalid([{ path: "/city_id", message: "城市不存在" }]);
      if (city && city.countryCode !== place.countryCode) {
        invalid([{ path: "/city_id", message: `这个城市属于 ${city.countryCode}，而地点在 ${place.countryCode}` }]);
      }
      const parent = place.parentId === null ? null : await findMasterRow(db, PLACES, place.parentId, { lock: true });
      const blocker = placeEnableBlocker({ cityStatus: city?.status ?? null, parentStatus: parent?.status ?? null });
      if (blocker !== null) notReady(blocker);
      return { city_id: targetCityId };
    },
    (place) => {
      if (cityId === undefined || cityId === place.cityId) return;
      if (place.parentId !== null) invalid([{ path: "/city_id", message: "航站楼和出口的城市跟随上级，不用单独指定" }]);
      if (place.cityId !== null) invalid([{ path: "/city_id", message: "这个地点已经有所属城市；要换城市请用修改接口" }]);
    },
  );
}

/** 一批地点引用到的城市和上级地点（编号 → 编码和名称），给接口的应答用。 */
export interface PlaceRefs {
  cities: ReadonlyMap<string, MasterRef>;
  parents: ReadonlyMap<string, MasterRef & { type: PlaceType }>;
}

export function loadPlaceRefs(ctx: AppContext, reader: MasterReader, places: readonly Place[]): Promise<PlaceRefs> {
  const cityIds = [...new Set(places.flatMap((place) => (place.cityId === null ? [] : [place.cityId])))];
  const parentIds = [...new Set(places.flatMap((place) => (place.parentId === null ? [] : [place.parentId])))];
  return readTx(ctx, reader, async (db) => ({
    cities: new Map((await findCityRefs(db, cityIds)).map((ref) => [ref.id, ref])),
    parents: new Map((await findPlaceRefs(db, parentIds)).map((ref) => [ref.id, ref])),
  }));
}

/** 给一个还没有城市的地点建议的城市：编号、编码、名称、距离，以及为什么建议它。 */
export interface CitySuggestion extends MasterRef {
  distanceKm: number;
  reason: CitySuggestionReason;
}

/**
 * 给这批地点里还没有城市的那些找建议的城市，最多 3 个，第一个是首选：同一个国家、启用中的城市里，
 * 名称和数据源说的「机场所属的城市」对得上的排第一；其余是 80 公里以内的，大城市优先（规则见 @nozomi/domain 的 city-suggestion.ts）。
 * 返回 地点编号 → 候选列表（没有合适的城市时是空列表）；已经有城市的地点不在返回里。只是建议，要人确认。
 */
export async function suggestCities(ctx: AppContext, places: readonly Place[]): Promise<Map<string, CitySuggestion[]>> {
  const pending = places.filter((place) => place.cityId === null);
  const result = new Map<string, CitySuggestion[]>();
  if (pending.length === 0) return result;
  const candidates = await readTx(ctx, { kind: "platform" }, (db) => listActiveCityCandidates(db, [...new Set(pending.map((place) => place.countryCode))]));
  for (const place of pending) {
    const sameCountry = candidates.filter((city) => city.countryCode === place.countryCode);
    const ranked = rankCitySuggestions({ lat: place.lat, lng: place.lng, municipality: place.municipality }, sameCountry);
    result.set(
      place.id,
      ranked.map(({ item, meters, reason }) => ({ id: item.id, code: item.code, name: item.name, distanceKm: Math.round(meters / 100) / 10, reason })),
    );
  }
  return result;
}

// ---- 车型组 ----

export interface VehicleGroupInput {
  code: string;
  grade: VehicleGrade;
  seats: number;
  name: LocalizedText;
  sampleModels: string[];
  power: VehiclePower;
  combos: VehicleCombo[];
}

export type VehicleGroupPatch = Patch<VehicleGroupInput>;

function vehicleGroupColumns(group: Patch<VehicleGroupInput>): ColumnValues {
  return supplied({
    code: group.code,
    grade: group.grade,
    seats: group.seats,
    name: group.name,
    sample_models: group.sampleModels,
    power: group.power,
    combos: group.combos?.map((combo) => ({ passengers: combo.passengers, luggage: combo.luggage })),
  });
}

export function createVehicleGroup(ctx: AppContext, writer: MasterWriter, input: VehicleGroupInput): Promise<VehicleGroup> {
  return create(ctx, writer, VEHICLE_GROUP, async () => {
    const issues: InputIssue[] = [];
    const codeIssue = vehicleGroupCodeIssue(input.code, input.seats, input.grade);
    if (codeIssue !== null) issues.push({ path: "/code", message: codeIssue });
    issues.push(...vehicleComboIssues(input.seats, input.combos).map((message) => ({ path: "/combos", message })));
    if (issues.length > 0) invalid(issues);
    return vehicleGroupColumns(input);
  });
}

/** 修改车型组。编码、等级、座位数创建后不能改：它们决定了「这是哪个车型组」，价格、库存、订单都按它引用。 */
export function updateVehicleGroup(
  ctx: AppContext,
  writer: MasterWriter,
  id: string,
  version: number,
  patch: VehicleGroupPatch,
): Promise<VehicleGroup> {
  const locked = { code: patch.code, grade: patch.grade, seats: patch.seats };
  return update(ctx, writer, VEHICLE_GROUP, id, version, locked, async (_db, current) => {
    if (patch.combos !== undefined) {
      const issues = vehicleComboIssues(current.seats, patch.combos).map((message) => ({ path: "/combos", message }));
      if (issues.length > 0) invalid(issues);
    }
    return { values: vehicleGroupColumns({ name: patch.name, sampleModels: patch.sampleModels, power: patch.power, combos: patch.combos }) };
  });
}

export function setVehicleGroupStatus(ctx: AppContext, writer: MasterWriter, id: string, status: MasterDataStatus): Promise<VehicleGroup> {
  return setStatus(ctx, writer, VEHICLE_GROUP, id, status, async (db, group) => {
    if (status === "disabled") await assertNoPublishedProducts(db, "vehicle_group", group.id, "这个车型组");
  });
}

// ---- 附加服务 ----

export interface AddonInput {
  code: string;
  categories: ServiceCategory[];
  chargeUnit: AddonChargeUnit;
  name: LocalizedText;
  description: LocalizedText;
}

export type AddonPatch = Patch<AddonInput>;

function addonColumns(addon: Patch<AddonInput>): ColumnValues {
  return supplied({
    code: addon.code,
    // 品类按固定顺序存：同一组品类不会因为提交顺序不同而被当成一次修改
    categories: addon.categories === undefined ? undefined : [...new Set(addon.categories)].sort(),
    charge_unit: addon.chargeUnit,
    name: addon.name,
    description: addon.description,
  });
}

export function createAddon(ctx: AppContext, writer: MasterWriter, input: AddonInput): Promise<Addon> {
  return create(ctx, writer, ADDON, async () => {
    const codeIssue = addonCodeIssue(input.code);
    if (codeIssue !== null) invalid([{ path: "/code", message: codeIssue }]);
    return addonColumns(input);
  });
}

export function updateAddon(ctx: AppContext, writer: MasterWriter, id: string, version: number, patch: AddonPatch): Promise<Addon> {
  return update(ctx, writer, ADDON, id, version, { code: patch.code }, async () => ({
    values: addonColumns({ ...patch, code: undefined }),
  }));
}

export function setAddonStatus(ctx: AppContext, writer: MasterWriter, id: string, status: MasterDataStatus): Promise<Addon> {
  return setStatus(ctx, writer, ADDON, id, status, async (db, addon) => {
    if (status === "disabled") await assertNoPublishedProducts(db, "addon", addon.id, "这个附加服务");
  });
}
