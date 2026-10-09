/**
 * 子品牌和商品的业务流程（M1-03）：基础信息、服务区域、车型组、调度人、服务规则、商品详情、上架校验、上架 / 下架。
 *
 * - 规则在 @nozomi/domain 的 products.ts / service-time.ts（浏览器里填表用的是同一份）；这里负责取数据、调用规则、写库、写审计日志。
 * - 全部在租户事务里：租户编号只来自登录令牌，数据库的行级安全再兜一层。别的供应商的商品、区域、子品牌一律当作不存在。
 * - 分步保存：新增只要求创建后不能改的那几项（子品牌、城市、品类、接送点）；区域、车型组、调度人、服务规则、详情各自保存，
 *   可以只填一部分——保存时只查「填了的写得对不对」，缺什么留到上架校验。
 * - 商品只有一个版本号：它下面任何一部分变了都加一，各个修改接口都用同一个 `If-Match`。
 * - 已上架的商品可以直接改，但改完必须仍然通过上架校验，否则这次修改被拒绝（409 PUBLISH_CHECK_FAILED）——要大改请先下架。
 */
import { isDeepStrictEqual } from "node:util";
import {
  type CurrencyCode,
  type FreeWaitItem,
  MASTER_DATA_LANGUAGES,
  PRODUCT_LIMITS,
  type ProductContent,
  type ProductStatus,
  type PublishCheckItem,
  type PublishCheckSummary,
  type PublishFacts,
  type PublishIssue,
  type PublishIssueReason,
  type RuleIssue,
  type ServiceCategory,
  type ServiceRuleContext,
  type ServiceRules,
  addonAllowsFirstFree,
  adjustRuleNonPositivePrices,
  areaUsableByCategory,
  canPublish,
  contentIssues,
  emptyServiceRules,
  freeWaitItems,
  hasVisibleText,
  instantToLocal,
  isCurrencyCode,
  isPhoneNumber,
  isPickupPlaceType,
  minimumFreeWaitMinutes,
  priceRuleIsActive,
  publishCheck,
  publishCheckSummary,
  serviceRuleIssues,
} from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type Db, isUniqueViolation, withTenantTx } from "../db/context.ts";
import { AppError, isRetryableDbError } from "../errors.ts";
import type { TimeCursor } from "../pagination.ts";
import { type AreaCity, findAreaCities } from "../repos/areas.ts";
import { type AuditAction, type AuditValue, type AuditValues, insertAuditLog } from "../repos/audit-logs.ts";
import {
  BRAND_NAME_CONSTRAINT,
  type Brand,
  type Dispatcher,
  type Product,
  type ProductArea,
  type ProductFilter,
  type ProductPlace,
  type ProductVehicleGroup,
  type VehicleGroupChoice,
  countProductsByStatus,
  deleteProduct as deleteProductRow,
  findAddonsForProduct,
  findAreasForProduct,
  findBrand,
  findBrands,
  findPlacesForProduct,
  findProduct,
  findVehicleGroupsForProduct,
  insertBrand,
  insertProduct,
  listBrands as listBrandRows,
  listProductAreas,
  listProductDispatchers,
  listProductVehicleGroups,
  listProducts as listProductRows,
  lockProductAreas,
  nextProductCode,
  renameBrand,
  replaceProductAreas,
  replaceProductDispatchers,
  replaceProductVehicleGroups,
  updateProduct as updateProductRow,
} from "../repos/products.ts";
import { listAdjustRules, listPriceRules } from "../repos/prices.ts";
import { type InputIssue, validationFailed } from "../validation.ts";
import { consoleOrigin, tenantActor } from "./audit.ts";
import { fieldLocked, masterDataNotReady, notFound, versionConflict } from "./errors.ts";
import { runIdempotent } from "./idempotency.ts";
import type { TenantPrincipal } from "./tenant-auth.ts";

export interface ProductWriter {
  principal: TenantPrincipal;
  ip: string;
}

function invalid(issues: InputIssue[]): never {
  throw validationFailed("body", issues);
}

/** 数据库因为死锁、序列化失败放弃事务时自动重做（接口层对仍不成功的返回 409 CONCURRENT_UPDATE）。 */
export async function writeTx<T>(ctx: AppContext, tenantId: string, fn: (db: Db) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await withTenantTx(ctx.pool, tenantId, fn);
    } catch (err) {
      if (attempt >= 3 || !isRetryableDbError(err)) throw err;
    }
  }
}

export function readTx<T>(ctx: AppContext, tenantId: string, fn: (db: Db) => Promise<T>): Promise<T> {
  return withTenantTx(ctx.pool, tenantId, fn, { snapshot: true });
}

function audit(db: Db, writer: ProductWriter, now: Date, event: { resource: "product" | "brand"; id: string; action: AuditAction; before: AuditValues | null; after: AuditValues | null }): Promise<void> {
  return insertAuditLog(db, consoleOrigin(tenantActor(writer.principal.user), writer.ip, now), {
    tenantId: writer.principal.tenantId,
    resource: event.resource,
    resourceId: event.id,
    action: event.action,
    before: event.before,
    after: event.after,
  });
}

// ---- 子品牌 ----

function brandNameTaken(): AppError {
  return new AppError(409, "BRAND_NAME_TAKEN", "已经有同名的子品牌，请换一个名字");
}

export function listBrands(ctx: AppContext, tenantId: string): Promise<Brand[]> {
  return readTx(ctx, tenantId, (db) => listBrandRows(db, tenantId));
}

/** 新增子品牌（带幂等键）。币种创建后不能改：它下面商品的所有金额都按这个币种的最小货币单位存。 */
export async function createBrand(
  ctx: AppContext,
  writer: ProductWriter,
  input: { name: string; currency: string },
  idempotency: { scope: string; key: string },
  respond: (brand: Brand) => Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const now = ctx.now();
  const tenantId = writer.principal.tenantId;
  if (!isCurrencyCode(input.currency)) invalid([{ path: "/currency", reason: "UNSUPPORTED_CURRENCY", message: "不支持这个币种" }]);
  const currency: CurrencyCode = input.currency;
  try {
    return await writeTx(ctx, tenantId, (db) =>
      runIdempotent(db, { tenantId, scope: idempotency.scope, key: idempotency.key, request: input, now }, async () => {
        const brand = await insertBrand(db, tenantId, input.name, currency, now);
        await audit(db, writer, now, { resource: "brand", id: brand.id, action: "create", before: null, after: { name: brand.name, currency: brand.currency, status: brand.status } });
        return { status: 201, body: respond(brand) };
      }),
    );
  } catch (err) {
    if (isUniqueViolation(err, BRAND_NAME_CONSTRAINT)) throw brandNameTaken();
    throw err;
  }
}

/** 给子品牌改名。带了币种且和现有的不同 → 409 FIELD_LOCKED。 */
export async function updateBrand(ctx: AppContext, writer: ProductWriter, id: string, expectedVersion: number, input: { name: string; currency: string | null }): Promise<Brand> {
  const now = ctx.now();
  const tenantId = writer.principal.tenantId;
  try {
    return await writeTx(ctx, tenantId, async (db) => {
      const current = await findBrand(db, tenantId, id, { lock: true });
      if (!current) throw notFound("子品牌");
      if (current.version !== expectedVersion) throw versionConflict(current.version);
      if (input.currency !== null && input.currency !== current.currency) throw fieldLocked(["currency"]);
      if (input.name === current.name) return current;
      const updated = await renameBrand(db, tenantId, id, input.name, now);
      await audit(db, writer, now, { resource: "brand", id, action: "update", before: { name: current.name }, after: { name: updated.name } });
      return updated;
    });
  } catch (err) {
    if (isUniqueViolation(err, BRAND_NAME_CONSTRAINT)) throw brandNameTaken();
    throw err;
  }
}

// ---- 商品：读 ----

/** 一个商品连同它引用的东西现在的情况（读取时现查）。列表项没有 areas、vehicleGroups、dispatchers，只有个数，另带上架校验的概况。 */
export interface ProductView {
  product: Product;
  brand: Brand | null;
  city: AreaCity | null;
  poi: ProductPlace | null;
  areaCount: number;
  vehicleGroupCount: number;
  areas: ProductArea[] | null;
  vehicleGroups: ProductVehicleGroup[] | null;
  dispatchers: Dispatcher[] | null;
  /** 上架校验的概况：只有列表项带（详情页另取完整的 publish-check） */
  check: PublishCheckSummary | null;
}

export async function detail(db: Db, tenantId: string, product: Product): Promise<ProductView> {
  const areas = await listProductAreas(db, tenantId, product.id);
  const vehicleGroups = await listProductVehicleGroups(db, tenantId, product.id);
  const dispatchers = await listProductDispatchers(db, tenantId, product.id);
  return {
    product,
    brand: (await findBrands(db, tenantId, [product.brandId])).get(product.brandId) ?? null,
    city: (await findAreaCities(db, [product.cityId])).get(product.cityId) ?? null,
    poi: product.poiId === null ? null : ((await findPlacesForProduct(db, [product.poiId])).get(product.poiId) ?? null),
    areaCount: areas.length,
    vehicleGroupCount: vehicleGroups.length,
    areas,
    vehicleGroups,
    dispatchers,
    check: null,
  };
}

export async function listProducts(
  ctx: AppContext,
  tenantId: string,
  filter: ProductFilter,
  limit: number,
  after: TimeCursor | null,
): Promise<{ items: ProductView[]; nextCursor: string | null; total: number }> {
  const now = ctx.now();
  return readTx(ctx, tenantId, async (db) => {
    const page = await listProductRows(db, tenantId, filter, limit, after);
    const brands = await findBrands(db, tenantId, [...new Set(page.items.map((item) => item.brandId))]);
    const cities = await findAreaCities(db, [...new Set(page.items.map((item) => item.cityId))]);
    const places = await findPlacesForProduct(db, [...new Set(page.items.flatMap((item) => (item.poiId === null ? [] : [item.poiId])))]);
    const items: ProductView[] = [];
    for (const item of page.items) {
      const { areaCount, vehicleGroupCount, ...product } = item;
      items.push({
        product,
        brand: brands.get(item.brandId) ?? null,
        city: cities.get(item.cityId) ?? null,
        poi: item.poiId === null ? null : (places.get(item.poiId) ?? null),
        areaCount,
        vehicleGroupCount,
        areas: null,
        vehicleGroups: null,
        dispatchers: null,
        check: publishCheckSummary(await runPublishCheck(db, tenantId, product, now)),
      });
    }
    return { items, nextCursor: page.nextCursor, total: page.total };
  });
}

export async function getProduct(ctx: AppContext, tenantId: string, id: string): Promise<ProductView> {
  return readTx(ctx, tenantId, async (db) => {
    const product = await findProduct(db, tenantId, id, { lock: false });
    if (!product) throw notFound("商品");
    return detail(db, tenantId, product);
  });
}

/** 首页上本租户的商品数量。 */
export function productCounts(ctx: AppContext, tenantId: string): Promise<Record<ProductStatus, number>> {
  return readTx(ctx, tenantId, (db) => countProductsByStatus(db, tenantId));
}

// ---- 商品：基础信息 ----

export interface ProductRelations {
  /** 选的区域，顺序就是优先级；undefined = 这次不改 */
  areaIds?: string[] | undefined;
  vehicleGroups?: VehicleGroupChoice[] | undefined;
  dispatchers?: Dispatcher[] | undefined;
}

export interface ProductInput extends ProductRelations {
  brandId: string;
  cityId: string;
  category: ServiceCategory;
  poiId: string | null;
}

/**
 * 检查这次要保存的区域、车型组、调度人，有问题抛 400（每条带路径和原因代码）。
 * 已经选着的区域和车型组即使后来被停用也可以留着（上架校验会指出来）；新选的必须是启用中的。
 */
async function assertRelations(
  db: Db,
  tenantId: string,
  product: { cityId: string; category: ServiceCategory },
  relations: ProductRelations,
  already: { areaIds: ReadonlySet<string>; vehicleGroupIds: ReadonlySet<string> },
): Promise<void> {
  const issues: InputIssue[] = [];
  if (relations.areaIds !== undefined) {
    if (relations.areaIds.length > PRODUCT_LIMITS.maxAreas) issues.push({ path: "/areas", reason: "TOO_MANY", message: `一个商品最多选 ${PRODUCT_LIMITS.maxAreas} 个区域` });
    const found = await findAreasForProduct(db, tenantId, relations.areaIds);
    const seen = new Set<string>();
    for (const [index, areaId] of relations.areaIds.entries()) {
      const at = `/areas/${index}/area_id`;
      const area = found.get(areaId);
      if (seen.has(areaId)) issues.push({ path: at, reason: "DUPLICATE", message: "同一个区域选了两次" });
      else if (!area) issues.push({ path: at, reason: "UNKNOWN_AREA", message: "区域不存在" });
      else if (area.cityId !== product.cityId) issues.push({ path: at, reason: "AREA_OTHER_CITY", message: "只能选商品所在城市的区域" });
      else if (!areaUsableByCategory(product.category, area.bizType)) issues.push({ path: at, reason: "AREA_NOT_USABLE", message: "只能选业务类型和商品品类相同的区域，或「通用」的区域" });
      else if (area.status !== "active" && !already.areaIds.has(areaId)) issues.push({ path: at, reason: "AREA_DISABLED", message: "这个区域已停用，不能新选" });
      seen.add(areaId);
    }
  }
  if (relations.vehicleGroups !== undefined) {
    if (relations.vehicleGroups.length > PRODUCT_LIMITS.maxVehicleGroups) issues.push({ path: "/vehicle_groups", reason: "TOO_MANY", message: `一个商品最多选 ${PRODUCT_LIMITS.maxVehicleGroups} 个车型组` });
    const found = await findVehicleGroupsForProduct(db, relations.vehicleGroups.map((choice) => choice.vehicleGroupId));
    const seen = new Set<string>();
    for (const [index, choice] of relations.vehicleGroups.entries()) {
      const at = `/vehicle_groups/${index}`;
      const group = found.get(choice.vehicleGroupId);
      if (seen.has(choice.vehicleGroupId)) issues.push({ path: `${at}/vehicle_group_id`, reason: "DUPLICATE", message: "同一个车型组选了两次" });
      else if (!group) issues.push({ path: `${at}/vehicle_group_id`, reason: "UNKNOWN_VEHICLE_GROUP", message: "车型组不存在" });
      else if (group.status !== "active" && !already.vehicleGroupIds.has(choice.vehicleGroupId)) issues.push({ path: `${at}/vehicle_group_id`, reason: "VEHICLE_GROUP_DISABLED", message: "这个车型组已被平台停用，不能新选" });
      else if (!group.combos.some((combo) => combo.passengers === choice.passengers && combo.luggage === choice.luggage)) {
        issues.push({ path: at, reason: "VEHICLE_COMBO_NOT_OFFERED", message: "「人数 / 行李数」必须是这个车型组可选的组合之一" });
      }
      seen.add(choice.vehicleGroupId);
    }
  }
  if (relations.dispatchers !== undefined) {
    if (relations.dispatchers.length > PRODUCT_LIMITS.maxDispatchers) issues.push({ path: "/dispatchers", reason: "TOO_MANY", message: `调度人最多 ${PRODUCT_LIMITS.maxDispatchers} 个` });
    for (const [index, dispatcher] of relations.dispatchers.entries()) {
      if (!hasVisibleText(dispatcher.name) || dispatcher.name.length > PRODUCT_LIMITS.maxDispatcherNameLength) {
        issues.push({ path: `/dispatchers/${index}/name`, reason: "REQUIRED", message: `调度人姓名必填，最多 ${PRODUCT_LIMITS.maxDispatcherNameLength} 个字` });
      }
      if (!isPhoneNumber(dispatcher.phone)) issues.push({ path: `/dispatchers/${index}/phone`, reason: "INVALID_PHONE", message: "电话只能是数字，可以带开头的 + 和中间的空格、横线，6 到 20 位" });
    }
  }
  if (issues.length > 0) invalid(issues);
}

async function saveRelations(db: Db, tenantId: string, productId: string, relations: ProductRelations): Promise<void> {
  if (relations.areaIds !== undefined) await replaceProductAreas(db, tenantId, productId, relations.areaIds);
  if (relations.vehicleGroups !== undefined) await replaceProductVehicleGroups(db, tenantId, productId, relations.vehicleGroups);
  if (relations.dispatchers !== undefined) await replaceProductDispatchers(db, tenantId, productId, relations.dispatchers);
}

function relationsAudit(view: ProductView): AuditValues {
  return {
    areas: (view.areas ?? []).map((area) => area.areaId),
    vehicle_groups: (view.vehicleGroups ?? []).map((group): AuditValue => ({ vehicle_group_id: group.vehicleGroupId, passengers: group.passengers, luggage: group.luggage })),
    dispatchers: (view.dispatchers ?? []).map((dispatcher): AuditValue => ({ name: dispatcher.name, phone: dispatcher.phone })),
  };
}

/**
 * 新增商品（带幂等键）：创建即草稿。子品牌、城市、品类、接送点创建后不能改，所以新增时就要给全；
 * 子品牌和城市必须是启用中的；接送机商品必须选一个本城市、启用中的机场或车站，其他品类不能有接送点。
 */
export async function createProduct(
  ctx: AppContext,
  writer: ProductWriter,
  input: ProductInput,
  idempotency: { scope: string; key: string },
  respond: (view: ProductView) => Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const now = ctx.now();
  const tenantId = writer.principal.tenantId;
  return writeTx(ctx, tenantId, (db) =>
    runIdempotent(db, { tenantId, scope: idempotency.scope, key: idempotency.key, request: input, now }, async () => {
      const issues: InputIssue[] = [];
      const brand = await findBrand(db, tenantId, input.brandId, { lock: false });
      if (!brand) issues.push({ path: "/brand_id", reason: "UNKNOWN_BRAND", message: "子品牌不存在" });
      else if (brand.status !== "active") issues.push({ path: "/brand_id", reason: "BRAND_DISABLED", message: "这个子品牌已停用" });
      const city = (await findAreaCities(db, [input.cityId])).get(input.cityId);
      if (!city) issues.push({ path: "/city_id", reason: "UNKNOWN_CITY", message: "城市不存在" });
      // 引用的平台主数据存在但已停用：和区域一样是 409 MASTER_DATA_NOT_READY（请求本身没写错，是主数据的状态不允许）
      const notReady: AppError[] = [];
      if (city && city.status !== "active") notReady.push(masterDataNotReady("CITY_DISABLED", "这个城市已被平台停用，不能在它下面新增商品"));
      if (input.category !== "airport_transfer") {
        if (input.poiId !== null) issues.push({ path: "/poi_id", reason: "NOT_APPLICABLE", message: "只有接送机商品有接送点" });
      } else if (input.poiId === null) {
        issues.push({ path: "/poi_id", reason: "REQUIRED", message: "接送机商品必须选一个机场或车站" });
      } else {
        const place = (await findPlacesForProduct(db, [input.poiId])).get(input.poiId);
        if (!place || !isPickupPlaceType(place.type)) issues.push({ path: "/poi_id", reason: "UNKNOWN_PLACE", message: "接送点不存在，或不是机场、车站" });
        else if (place.cityId !== input.cityId) issues.push({ path: "/poi_id", reason: "PLACE_OTHER_CITY", message: "接送点不在商品所在的城市" });
        else if (place.status !== "active") notReady.push(masterDataNotReady("PICKUP_PLACE_DISABLED", "这个接送点已被平台停用，不能用它新增商品"));
      }
      if (issues.length > 0) invalid(issues);
      if (notReady[0]) throw notReady[0];
      await assertRelations(db, tenantId, input, input, { areaIds: new Set(), vehicleGroupIds: new Set() });
      const product = await insertProduct(
        db,
        tenantId,
        { code: await nextProductCode(db, now), brandId: input.brandId, cityId: input.cityId, category: input.category, poiId: input.poiId, serviceRules: emptyServiceRules(), content: {} },
        now,
      );
      await saveRelations(db, tenantId, product.id, input);
      const view = await detail(db, tenantId, product);
      await audit(db, writer, now, {
        resource: "product",
        id: product.id,
        action: "create",
        before: null,
        after: { code: product.code, brand_id: product.brandId, city_id: product.cityId, category: product.category, poi_id: product.poiId, status: product.status, ...relationsAudit(view) },
      });
      return { status: 201, body: respond(view) };
    }),
  );
}

export interface ProductPatch extends ProductRelations {
  /** 创建后不能改的字段：带了且和现有的不同 → 409 FIELD_LOCKED */
  brandId?: string | undefined;
  cityId?: string | undefined;
  category?: ServiceCategory | undefined;
  poiId?: string | null | undefined;
}

/** 这个商品如果是已上架的，改完之后必须仍然通过上架校验。 */
export async function assertStillPublishable(db: Db, tenantId: string, product: Product, now: Date): Promise<void> {
  if (product.status !== "published") return;
  await lockProductAreas(db, tenantId, product.id);
  const items = await runPublishCheck(db, tenantId, product, now);
  if (!canPublish(items)) throw publishCheckFailed(items, "这样修改之后商品就不满足上架的条件了。请调整后再保存，或者先下架再改");
}

/** 修改基础信息里创建后能改的部分：区域（含优先级）、车型组、调度人。带了的整体替换，没带的不动。 */
export async function updateProduct(ctx: AppContext, writer: ProductWriter, id: string, expectedVersion: number, patch: ProductPatch): Promise<ProductView> {
  const now = ctx.now();
  const tenantId = writer.principal.tenantId;
  return writeTx(ctx, tenantId, async (db) => {
    const current = await findProduct(db, tenantId, id, { lock: true });
    if (!current) throw notFound("商品");
    if (current.version !== expectedVersion) throw versionConflict(current.version);
    const locked = (
      [["brand_id", patch.brandId, current.brandId], ["city_id", patch.cityId, current.cityId], ["category", patch.category, current.category], ["poi_id", patch.poiId, current.poiId]] as const
    )
      .filter(([, given, stored]) => given !== undefined && given !== stored)
      .map(([field]) => field);
    if (locked.length > 0) throw fieldLocked(locked);

    const before = await detail(db, tenantId, current);
    const already = { areaIds: new Set((before.areas ?? []).map((area) => area.areaId)), vehicleGroupIds: new Set((before.vehicleGroups ?? []).map((group) => group.vehicleGroupId)) };
    await assertRelations(db, tenantId, current, patch, already);

    const beforeAudit = relationsAudit(before);
    const afterAudit: AuditValues = {
      areas: patch.areaIds ?? beforeAudit["areas"] ?? [],
      vehicle_groups: patch.vehicleGroups?.map((choice): AuditValue => ({ vehicle_group_id: choice.vehicleGroupId, passengers: choice.passengers, luggage: choice.luggage })) ?? beforeAudit["vehicle_groups"] ?? [],
      dispatchers: patch.dispatchers?.map((dispatcher): AuditValue => ({ name: dispatcher.name, phone: dispatcher.phone })) ?? beforeAudit["dispatchers"] ?? [],
    };
    const changed = Object.keys(afterAudit).filter((key) => !isDeepStrictEqual(afterAudit[key], beforeAudit[key]));
    if (changed.length === 0) return before;

    await saveRelations(db, tenantId, id, patch);
    const updated = await updateProductRow(db, tenantId, id, {}, now);
    await assertStillPublishable(db, tenantId, updated, now);
    await audit(db, writer, now, {
      resource: "product",
      id,
      action: "update",
      before: Object.fromEntries(changed.map((key) => [key, beforeAudit[key] ?? null])),
      after: Object.fromEntries(changed.map((key) => [key, afterAudit[key] ?? null])),
    });
    return detail(db, tenantId, updated);
  });
}

/** 删除商品：只有草稿可以删除（需求文档）。上过架的商品可能已经有订单引用它，只能下架。 */
export async function deleteProduct(ctx: AppContext, writer: ProductWriter, id: string): Promise<void> {
  const now = ctx.now();
  const tenantId = writer.principal.tenantId;
  await writeTx(ctx, tenantId, async (db) => {
    const current = await findProduct(db, tenantId, id, { lock: true });
    if (!current) throw notFound("商品");
    if (current.status !== "draft") throw new AppError(409, "PRODUCT_NOT_DRAFT", "只有草稿可以删除；上过架的商品请下架", { status: current.status });
    const view = await detail(db, tenantId, current);
    await deleteProductRow(db, tenantId, id);
    await audit(db, writer, now, {
      resource: "product",
      id,
      action: "delete",
      before: { code: current.code, brand_id: current.brandId, city_id: current.cityId, category: current.category, poi_id: current.poiId, status: current.status, ...relationsAudit(view), service_rules: current.serviceRules as unknown as AuditValue, content: current.content as AuditValue },
      after: null,
    });
  });
}

// ---- 服务规则 ----

const RULE_MESSAGES: Readonly<Record<PublishIssueReason, string>> = {
  REQUIRED: "必填",
  INVALID_DATE: "不是合法的日期（YYYY-MM-DD）",
  DATE_RANGE_REVERSED: "结束日期不能早于开始日期",
  INVALID_TIME: "时间要写成 HH:mm（结束可以是 24:00）",
  EMPTY_WINDOW: "开始和结束不能相同；全天请写 00:00 到 24:00",
  OUT_OF_RANGE: "超出了允许的范围",
  NOT_INTEGER: "必须是整数",
  TOO_MANY: "条数太多",
  TOO_LONG: "太长了",
  DUPLICATE: "重复了",
  TIER_NOT_WITHIN_LEAD_TIME: "加急的小时数不能超过提前预订时长",
  BELOW_PLATFORM_MINIMUM: "不能短于平台规定的免等时长",
  NOT_APPLICABLE: "这个品类的商品不填这一项",
  INVALID_LANGUAGE: "语言要写成两位小写的代码，例如 zh",
  INVALID_PHONE: "电话格式不对",
  NO_AREA: "至少要选一个区域",
  NO_VEHICLE_GROUP: "至少要选一个车型组",
  NO_DISPATCHER: "至少要有一个调度人",
  BRAND_DISABLED: "子品牌已停用",
  CITY_DISABLED: "城市已被平台停用",
  PICKUP_PLACE_MISSING: "还没有选接送点",
  PICKUP_PLACE_DISABLED: "接送点已被平台停用",
  AREA_DISABLED: "这个区域已停用",
  AREA_CITY_DISABLED: "这个区域所属的城市已被平台停用",
  AREA_NOT_USABLE: "这个区域的业务类型和商品品类不一致",
  VEHICLE_GROUP_DISABLED: "这个车型组已被平台停用",
  VEHICLE_COMBO_NOT_OFFERED: "选的「人数 / 行李数」已经不在这个车型组的可选组合里",
  ADDON_DISABLED: "这个附加服务已被平台停用",
  ADDON_NOT_APPLICABLE: "这个附加服务不适用于这个品类",
  NO_ACTIVE_PRICE_RULE: "至少要有一条启用且未过期的价格规则",
  ALL_PRICE_RULES_DISABLED: "价格规则都停用了：至少要有一条启用且未过期的",
  ALL_PRICE_RULES_EXPIRED: "启用的价格规则都过期了：至少要有一条启用且未过期的",
  ADJUST_RESULT_NOT_POSITIVE: "这条调价规则会把某些价格调到不大于 0，它生效时那些组合报不出价",
  FEATURE_NOT_AVAILABLE: "这项功能还没有上线",
};

function ruleIssues(issues: readonly (RuleIssue | PublishIssue)[]): InputIssue[] {
  return issues.map((issue) => ({ path: issue.path, reason: issue.reason, message: RULE_MESSAGES[issue.reason], ...(issue.detail ? { detail: issue.detail } : {}) }));
}

async function ruleContext(db: Db, product: Product): Promise<ServiceRuleContext> {
  const place = product.poiId === null ? undefined : (await findPlacesForProduct(db, [product.poiId])).get(product.poiId);
  return { category: product.category, pickupPlace: place ? { type: place.type, flightScope: place.flightScope } : null };
}

export interface ServiceRulesView {
  product: Product;
  /** 金额的币种（子品牌的币种） */
  currency: CurrencyCode | null;
  /** 这个商品每一项免等最少要设多少分钟（平台规定）；这个品类不填的项是 null */
  freeWaitMinimums: Record<FreeWaitItem, number | null>;
}

async function serviceRulesView(db: Db, tenantId: string, product: Product): Promise<ServiceRulesView> {
  const context = await ruleContext(db, product);
  const applicable = freeWaitItems(product.category);
  const minimum = (item: FreeWaitItem): number | null => (applicable.includes(item) ? minimumFreeWaitMinutes(product.category, item, context.pickupPlace) : null);
  return {
    product,
    currency: (await findBrands(db, tenantId, [product.brandId])).get(product.brandId)?.currency ?? null,
    freeWaitMinimums: { pickup: minimum("pickup"), dropoff: minimum("dropoff"), general: minimum("general") },
  };
}

export async function getServiceRules(ctx: AppContext, tenantId: string, id: string): Promise<ServiceRulesView> {
  return readTx(ctx, tenantId, async (db) => {
    const product = await findProduct(db, tenantId, id, { lock: false });
    if (!product) throw notFound("商品");
    return serviceRulesView(db, tenantId, product);
  });
}

/**
 * 整体保存服务规则。可以只填一部分（草稿）：只查填了的写得对不对。
 * 附加服务必须是平台目录里的；开着的必须是启用中、适用于这个品类的；「首个免费」只有按个计费的附加服务能设。
 */
export async function putServiceRules(ctx: AppContext, writer: ProductWriter, id: string, expectedVersion: number, rules: ServiceRules): Promise<ServiceRulesView> {
  const now = ctx.now();
  const tenantId = writer.principal.tenantId;
  return writeTx(ctx, tenantId, async (db) => {
    const current = await findProduct(db, tenantId, id, { lock: true });
    if (!current) throw notFound("商品");
    if (current.version !== expectedVersion) throw versionConflict(current.version);
    const issues = ruleIssues(serviceRuleIssues(rules, await ruleContext(db, current)));
    const addons = await findAddonsForProduct(db, rules.addons.map((addon) => addon.addonId));
    for (const [index, chosen] of rules.addons.entries()) {
      const at = `/addons/${index}`;
      const addon = addons.get(chosen.addonId);
      if (!addon) issues.push({ path: `${at}/addon_id`, reason: "UNKNOWN_ADDON", message: "附加服务不存在" });
      else {
        if (chosen.enabled && addon.status !== "active") issues.push({ path: `${at}/addon_id`, reason: "ADDON_DISABLED", message: RULE_MESSAGES.ADDON_DISABLED });
        else if (chosen.enabled && !addon.categories.includes(current.category)) issues.push({ path: `${at}/addon_id`, reason: "ADDON_NOT_APPLICABLE", message: RULE_MESSAGES.ADDON_NOT_APPLICABLE });
        if (chosen.firstFree && !addonAllowsFirstFree(addon.chargeUnit)) issues.push({ path: `${at}/first_free`, reason: "NOT_APPLICABLE", message: "只有按个计费的附加服务（如儿童座椅）可以设「首个免费」" });
      }
    }
    if (issues.length > 0) invalid(issues);
    if (isDeepStrictEqual(rules, current.serviceRules)) return serviceRulesView(db, tenantId, current);
    const updated = await updateProductRow(db, tenantId, id, { serviceRules: rules }, now);
    await assertStillPublishable(db, tenantId, updated, now);
    await audit(db, writer, now, {
      resource: "product",
      id,
      action: "update",
      before: { service_rules: current.serviceRules as unknown as AuditValue },
      after: { service_rules: updated.serviceRules as unknown as AuditValue },
    });
    return serviceRulesView(db, tenantId, updated);
  });
}

// ---- 商品详情 ----

/** 整体保存商品详情（各语言的标题、简介、包含 / 不含、行程、接机指引）。可以只填一部分。 */
export async function putContent(ctx: AppContext, writer: ProductWriter, id: string, expectedVersion: number, content: ProductContent): Promise<Product> {
  const now = ctx.now();
  const tenantId = writer.principal.tenantId;
  return writeTx(ctx, tenantId, async (db) => {
    const current = await findProduct(db, tenantId, id, { lock: true });
    if (!current) throw notFound("商品");
    if (current.version !== expectedVersion) throw versionConflict(current.version);
    const issues = ruleIssues(contentIssues(content));
    if (issues.length > 0) invalid(issues);
    // 一种语言什么都没填就不存这种语言
    const cleaned: ProductContent = {};
    for (const language of MASTER_DATA_LANGUAGES) {
      const text = content[language];
      if (text && (text.title !== null || text.summary !== null || text.itinerary !== null || text.pickupGuide !== null || text.includes.length > 0 || text.excludes.length > 0)) cleaned[language] = text;
    }
    if (isDeepStrictEqual(cleaned, current.content)) return current;
    const updated = await updateProductRow(db, tenantId, id, { content: cleaned }, now);
    await assertStillPublishable(db, tenantId, updated, now);
    await audit(db, writer, now, { resource: "product", id, action: "update", before: { content: current.content as AuditValue }, after: { content: updated.content as AuditValue } });
    return updated;
  });
}

// ---- 上架校验、上架、下架 ----

export interface PublishCheckView {
  canPublish: boolean;
  items: (Omit<PublishCheckItem, "issues"> & { issues: InputIssue[] })[];
}

function publishCheckView(items: readonly PublishCheckItem[]): PublishCheckView {
  return { canPublish: canPublish(items), items: items.map((item) => ({ ...item, issues: ruleIssues(item.issues) })) };
}

function publishCheckFailed(items: readonly PublishCheckItem[], message: string): AppError {
  const view = publishCheckView(items);
  return new AppError(409, "PUBLISH_CHECK_FAILED", message, {
    items: view.items.map((item) => ({ key: item.key, required: item.required, passed: item.passed, issues: item.issues })),
  });
}

/** 从库里取出上架校验要看的全部事实，交给 domain 的 publishCheck。 */
async function runPublishCheck(db: Db, tenantId: string, product: Product, now: Date): Promise<PublishCheckItem[]> {
  const view = await detail(db, tenantId, product);
  // 价格过没过期按商品所在城市当地的今天算
  const today = instantToLocal(now, view.city?.timezone ?? "UTC").date;
  const priceRules = await listPriceRules(db, tenantId, product.id);
  const adjustRules = await listAdjustRules(db, tenantId, product.id);
  const activePrices = priceRules.filter((rule) => priceRuleIsActive(rule, today));
  const areaCities = await findAreaCities(db, [...new Set((view.areas ?? []).map((area) => area.cityId))]);
  const addons = await findAddonsForProduct(db, product.serviceRules.addons.map((addon) => addon.addonId));
  const facts: PublishFacts = {
    category: product.category,
    brandActive: view.brand?.status === "active",
    cityActive: view.city?.status === "active",
    pickupPlace: view.poi === null ? null : { active: view.poi.status === "active", type: view.poi.type, flightScope: view.poi.flightScope },
    areas: (view.areas ?? []).map((area) => ({ status: area.status, bizType: area.bizType, cityActive: area.cityId === product.cityId && areaCities.get(area.cityId)?.status === "active" })),
    vehicleGroups: (view.vehicleGroups ?? []).map((group) => ({
      active: group.status === "active",
      comboOffered: group.combos.some((combo) => combo.passengers === group.passengers && combo.luggage === group.luggage),
    })),
    dispatcherCount: view.dispatchers?.length ?? 0,
    serviceRules: product.serviceRules,
    addons: product.serviceRules.addons.map((chosen) => {
      const addon = addons.get(chosen.addonId);
      return { enabled: chosen.enabled, active: addon?.status === "active", applicable: addon?.categories.includes(product.category) === true };
    }),
    content: product.content,
    activePriceRuleCount: priceRules.filter((rule) => priceRuleIsActive(rule, today)).length,
    priceRuleStats: { total: priceRules.length, enabled: priceRules.filter((rule) => rule.status === "enabled").length },
    nonPositiveAdjustRules: adjustRules.flatMap((rule, index) => (rule.status === "enabled" && adjustRuleNonPositivePrices(rule, activePrices).length > 0 ? [index] : [])),
  };
  return publishCheck(facts);
}

export async function getPublishCheck(ctx: AppContext, tenantId: string, id: string): Promise<PublishCheckView> {
  const now = ctx.now();
  return readTx(ctx, tenantId, async (db) => {
    const product = await findProduct(db, tenantId, id, { lock: false });
    if (!product) throw notFound("商品");
    return publishCheckView(await runPublishCheck(db, tenantId, product, now));
  });
}

/** 上架：必须的校验项全部通过才行，否则 409 PUBLISH_CHECK_FAILED 并带上逐项结果。已经上架的原样返回。 */
export async function publishProduct(ctx: AppContext, writer: ProductWriter, id: string): Promise<ProductView> {
  const now = ctx.now();
  const tenantId = writer.principal.tenantId;
  return writeTx(ctx, tenantId, async (db) => {
    const current = await findProduct(db, tenantId, id, { lock: true });
    if (!current) throw notFound("商品");
    if (current.status === "published") return detail(db, tenantId, current);
    await lockProductAreas(db, tenantId, id);
    const items = await runPublishCheck(db, tenantId, current, now);
    if (!canPublish(items)) throw publishCheckFailed(items, "还有上架条件没有满足");
    const updated = await updateProductRow(db, tenantId, id, { status: "published", publishedAt: now }, now);
    await audit(db, writer, now, { resource: "product", id, action: "publish", before: { status: current.status }, after: { status: updated.status } });
    return detail(db, tenantId, updated);
  });
}

/** 下架：已上架 → 已下架。已经下架的原样返回；草稿没有上过架，不能下架。 */
export async function unpublishProduct(ctx: AppContext, writer: ProductWriter, id: string): Promise<ProductView> {
  const now = ctx.now();
  const tenantId = writer.principal.tenantId;
  return writeTx(ctx, tenantId, async (db) => {
    const current = await findProduct(db, tenantId, id, { lock: true });
    if (!current) throw notFound("商品");
    if (current.status === "unpublished") return detail(db, tenantId, current);
    if (current.status === "draft") throw new AppError(409, "PRODUCT_STATE_INVALID", "草稿还没有上过架，不能下架", { status: current.status });
    const updated = await updateProductRow(db, tenantId, id, { status: "unpublished" }, now);
    await audit(db, writer, now, { resource: "product", id, action: "unpublish", before: { status: current.status }, after: { status: updated.status } });
    return detail(db, tenantId, updated);
  });
}
