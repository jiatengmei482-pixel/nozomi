/**
 * 价格规则、调价规则、价格日历、缺价组合、子品牌取整单位、节假日日历的业务流程（M1-04）。
 *
 * - 规则和计算都在 @nozomi/domain 的 pricing.ts（浏览器里填表、算读回的话和日历预览用的是同一份）；这里负责取数据、调用、写库、写审计日志。
 * - 价格规则和调价规则属于商品：每次修改都锁住商品那一行、核对商品的版本号（`If-Match`）、让商品的版本号加一（ADR 0016「一个版本号」）。
 *   因为同一个商品的写入被这把锁排成了队，「同一个组合的生效日期不能重叠」在应用里检查就够了（ADR 0018）。
 * - 已上架的商品改完价格之后必须仍然满足上架条件（至少一条启用且未过期的价格），否则这次修改被拒绝。
 * - 全部在租户事务里：别的供应商的商品、区域、价格一律当作不存在。金额都是结算价，这里没有对外价和加价比例。
 */
import { isDeepStrictEqual } from "node:util";
import {
  type AdjustRule,
  type CalendarSegment,
  type CurrencyCode,
  type HolidayLookup,
  type LocalizedText,
  PRICE_LIMITS,
  type PriceCoverage,
  type PriceIssue,
  type PriceIssueReason,
  type PriceRule,
  type PricingModel,
  type TripDirection,
  addDays,
  adjustRuleIssues,
  adjustRuleNonPositivePrices,
  adjustRuleOverLimitPrices,
  applyAdjustRules,
  basePrice,
  sellablePriceRules,
  calendarDay,
  findPriceRuleOverlaps,
  hasVisibleText,
  holidayLookup,
  instantToLocal,
  isCountryCode,
  isLocalDate,
  priceCoverage,
  priceRuleIsActive,
  priceRuleIssues,
  pricingModelsFor,
  roundingUnitOptions,
} from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { type Db, withPlatformTx, withTenantTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import { type AuditAction, type AuditValue, type AuditValues, insertAuditLog } from "../repos/audit-logs.ts";
import {
  type Holiday,
  type ProductPriceOverview,
  type StoredAdjustRule,
  type StoredPriceRule,
  deleteAdjustRule as deleteAdjustRuleRow,
  deleteHoliday,
  deletePriceRules,
  findHoliday,
  insertAdjustRule,
  insertPriceRule,
  listAdjustRules,
  listHolidayCountries,
  listHolidays as listHolidayRows,
  listPriceCoverageInputs,
  listPriceRules,
  listAdjustRulesWithArea,
  listBrandSellablePrices,
  listPriceRulesInArea,
  listProductPriceOverview,
  setAdjustRuleOrder,
  setBrandRoundingUnit,
  updateAdjustRule as updateAdjustRuleRow,
  updatePriceRule,
  upsertHoliday,
} from "../repos/prices.ts";
import { type Product, findBrand, findProduct, updateProduct as bumpProduct } from "../repos/products.ts";
import { type InputIssue, validationFailed } from "../validation.ts";
import { consoleOrigin, platformActor, tenantActor } from "./audit.ts";
import { notFound, versionConflict } from "./errors.ts";
import { runIdempotent } from "./idempotency.ts";
import type { MasterWriter } from "./master-data.ts";
import { type ProductWriter, assertStillPublishable, detail, readTx, writeTx } from "./products.ts";

const ISSUE_MESSAGES: Readonly<Record<PriceIssueReason, string>> = {
  REQUIRED: "必填",
  NOT_INTEGER: "必须是整数（金额用最小货币单位，百分比用基点）",
  OUT_OF_RANGE: "超出了允许的范围",
  INVALID_DATE: "不是合法的日期（YYYY-MM-DD）",
  DATE_RANGE_REVERSED: "结束日期不能早于开始日期",
  NOT_APPLICABLE: "这个品类的商品不填这一项",
  MODEL_NOT_ALLOWED: "这个品类不能用这种计价方式",
  INVALID_TIME: "时间要写成 HH:mm（结束可以是 24:00）",
  EMPTY_WINDOW: "开始和结束不能相同；全天请不填时段",
  DUPLICATE: "重复了",
  TOO_MANY: "条数太多",
  TOO_LONG: "太长了",
  INVALID_COUNTRY: "不是合法的国家码（ISO 3166-1 两位大写字母）",
  ZERO_STEP: "调价的值不能是 0",
};

function inputIssues(issues: readonly PriceIssue[], prefix: string): InputIssue[] {
  return issues.map((issue) => ({ path: `${prefix}${issue.path}`, reason: issue.reason, message: ISSUE_MESSAGES[issue.reason], ...(issue.detail ? { detail: issue.detail } : {}) }));
}

function invalid(issues: InputIssue[]): never {
  throw validationFailed("body", issues);
}

function audit(db: Db, writer: ProductWriter, now: Date, event: { resource: "price_rule" | "adjust_rule" | "brand"; id: string; action: AuditAction; before: AuditValues | null; after: AuditValues | null }): Promise<void> {
  return insertAuditLog(db, consoleOrigin(tenantActor(writer.principal.user), writer.ip, now), {
    tenantId: writer.principal.tenantId,
    resource: event.resource,
    resourceId: event.id,
    action: event.action,
    before: event.before,
    after: event.after,
  });
}

// ---- 一个商品的定价上下文 ----

export interface PricingContext {
  product: Product;
  currency: CurrencyCode | null;
  roundingUnit: number;
  timezone: string;
  countryCode: string | null;
  /** 城市当地的今天 */
  today: string;
  /** 商品现在选的区域、车型组 */
  areaIds: string[];
  vehicleGroupIds: string[];
  priceRules: StoredPriceRule[];
  adjustRules: StoredAdjustRule[];
}

export async function loadPricingContext(db: Db, tenantId: string, productId: string, now: Date, options: { lock: boolean }): Promise<PricingContext> {
  const product = await findProduct(db, tenantId, productId, options);
  if (!product) throw notFound("商品");
  const view = await detail(db, tenantId, product);
  const timezone = view.city?.timezone ?? "UTC";
  return {
    product,
    currency: view.brand?.currency ?? null,
    roundingUnit: view.brand?.roundingUnit ?? 1,
    timezone,
    countryCode: view.city?.countryCode ?? null,
    today: instantToLocal(now, timezone).date,
    areaIds: (view.areas ?? []).map((area) => area.areaId),
    vehicleGroupIds: (view.vehicleGroups ?? []).map((group) => group.vehicleGroupId),
    priceRules: await listPriceRules(db, tenantId, productId),
    adjustRules: await listAdjustRules(db, tenantId, productId),
  };
}

// ---- 价格规则 ----

export interface PriceRulesView {
  version: number;
  currency: CurrencyCode | null;
  roundingUnit: number;
  /** 这个品类可以用的计价方式 */
  availableModels: PricingModel[];
  today: string;
  items: StoredPriceRule[];
  coverage: PriceCoverage;
}

function priceRulesView(context: PricingContext, product: Product, items: StoredPriceRule[]): PriceRulesView {
  return {
    version: product.version,
    currency: context.currency,
    roundingUnit: context.roundingUnit,
    availableModels: pricingModelsFor(product.category),
    today: context.today,
    items,
    coverage: priceCoverage({ category: product.category, areaIds: context.areaIds, vehicleGroupIds: context.vehicleGroupIds, rules: items, today: context.today }),
  };
}

export function getPriceRules(ctx: AppContext, tenantId: string, productId: string): Promise<PriceRulesView> {
  const now = ctx.now();
  return readTx(ctx, tenantId, async (db) => {
    const context = await loadPricingContext(db, tenantId, productId, now, { lock: false });
    return priceRulesView(context, context.product, context.priceRules);
  });
}

/** 一次保存里的改动：新增（可带页面自己起的 `ref`，冲突时用它指回去）、修改、删除。 */
export interface PriceChanges {
  create: { ref: string | null; rule: PriceRule }[];
  update: { id: string; rule: PriceRule }[];
  remove: string[];
}

function priceAudit(rule: PriceRule): AuditValues {
  const { model, ...params } = rule.pricing;
  return {
    area_id: rule.areaId,
    vehicle_group_id: rule.vehicleGroupId,
    direction: rule.direction,
    package_hours: rule.packageHours,
    pricing_model: model,
    params: params as unknown as AuditValue,
    valid_from: rule.validFrom,
    valid_to: rule.validTo,
    status: rule.status,
  };
}

export function samePriceRule(a: PriceRule, b: PriceRule): boolean {
  // 按内容比，不看键的先后：库里取出来的 jsonb 键的顺序和请求里的不一定一样
  return isDeepStrictEqual(priceAudit(a), priceAudit(b));
}

export interface PriceSaveResult {
  view: PriceRulesView;
  /** 这次新增的规则，和请求里 `create` 的顺序一一对应 */
  created: StoredPriceRule[];
}

/** 冲突里指代一条价格：已经在库里的用 `id`，这次新增的用请求里的 `ref`。 */
export type PriceConflictRef = { id?: string; ref?: string | null; valid_from: string; valid_to: string | null };
export type PriceConflict = PriceConflictRef & { with: PriceConflictRef[] };

export interface PriceChangeCheck {
  /** 写得不对的地方（路径指到是哪一条的哪一项） */
  issues: InputIssue[];
  /** 生效日期重叠：每一条被拒绝的规则和它撞上的那些。有 `issues` 时不再查重叠 */
  conflicts: PriceConflict[];
}

/**
 * 一批改动能不能存：只检查、不写库（保存和导入的预览共用）。
 * `single` 决定报错路径的前缀：批量是 `/create/N`、`/update/N`、`/delete/N`，单条没有前缀。
 */
export function checkPriceChanges(context: PricingContext, changes: PriceChanges, single: boolean): PriceChangeCheck {
  const { product } = context;
  const prefix = (kind: "create" | "update" | "delete", index: number): string => (single ? "" : `/${kind}/${index}`);
  const total = changes.create.length + changes.update.length + changes.remove.length;
  if (total > PRICE_LIMITS.maxBatchChanges) return { issues: [{ path: "/", reason: "TOO_MANY", message: `一次最多改 ${PRICE_LIMITS.maxBatchChanges} 条价格规则`, detail: { max: PRICE_LIMITS.maxBatchChanges } }], conflicts: [] };

  const stored = new Map(context.priceRules.map((rule) => [rule.id, rule]));
  const areas = new Set(context.areaIds);
  const groups = new Set(context.vehicleGroupIds);
  const issues: InputIssue[] = [];
  const touched = new Set<string>();
  // 每条问题的 detail 里带上是哪一条：新增的给请求里的 ref，修改、删除的给 id（页面凭它把出错指回那一行，不用靠下标）
  const checkRule = (rule: PriceRule, at: string, before: StoredPriceRule | null, who: Record<string, string>): void => {
    issues.push(...inputIssues(priceRuleIssues(rule, { category: product.category }), at).map((issue) => ({ ...issue, detail: { ...issue.detail, ...who } })));
    if (!areas.has(rule.areaId) && before?.areaId !== rule.areaId) issues.push({ path: `${at}/area_id`, reason: "AREA_NOT_IN_PRODUCT", message: "只能给这个商品选了的区域设价格", detail: who });
    if (!groups.has(rule.vehicleGroupId) && before?.vehicleGroupId !== rule.vehicleGroupId) {
      issues.push({ path: `${at}/vehicle_group_id`, reason: "VEHICLE_GROUP_NOT_IN_PRODUCT", message: "只能给这个商品选了的车型组设价格", detail: who });
    }
  };
  for (const [index, entry] of changes.create.entries()) checkRule(entry.rule, prefix("create", index), null, entry.ref === null ? {} : { ref: entry.ref });
  for (const [index, entry] of changes.update.entries()) {
    const at = prefix("update", index);
    const before = stored.get(entry.id);
    if (!before) issues.push({ path: `${at}/id`, reason: "UNKNOWN_PRICE_RULE", message: "这条价格规则不存在，或者不是这个商品的", detail: { id: entry.id } });
    else if (touched.has(entry.id)) issues.push({ path: `${at}/id`, reason: "DUPLICATE", message: "同一条价格规则在这次保存里出现了两次", detail: { id: entry.id } });
    else checkRule(entry.rule, at, before, { id: entry.id });
    touched.add(entry.id);
  }
  for (const [index, id] of changes.remove.entries()) {
    const at = prefix("delete", index) || "/id";
    if (!stored.has(id)) issues.push({ path: at, reason: "UNKNOWN_PRICE_RULE", message: "这条价格规则不存在，或者不是这个商品的", detail: { id } });
    else if (touched.has(id)) issues.push({ path: at, reason: "DUPLICATE", message: "同一条价格规则在这次保存里出现了两次", detail: { id } });
    touched.add(id);
  }
  const remaining = context.priceRules.filter((rule) => !touched.has(rule.id));
  if (remaining.length + changes.update.length + changes.create.length > PRICE_LIMITS.maxPriceRulesPerProduct) {
    issues.push({ path: "/", reason: "TOO_MANY", message: `一个商品最多 ${PRICE_LIMITS.maxPriceRulesPerProduct} 条价格规则`, detail: { max: PRICE_LIMITS.maxPriceRulesPerProduct } });
  }
  if (issues.length > 0) return { issues, conflicts: [] };

  // 唯一性：保存之后的全部规则里，同一个组合的生效日期不能重叠（停用的也算）
  type Entry = { rule: PriceRule; id: string | null; ref: string | null; changed: boolean };
  const after: Entry[] = [
    ...remaining.map((rule): Entry => ({ rule, id: rule.id, ref: null, changed: false })),
    ...changes.update.map((entry): Entry => ({ rule: entry.rule, id: entry.id, ref: null, changed: true })),
    ...changes.create.map((entry): Entry => ({ rule: entry.rule, id: null, ref: entry.ref, changed: true })),
  ];
  const overlaps = findPriceRuleOverlaps(after.map((entry) => entry.rule));
  const label = (entry: Entry): PriceConflictRef => ({ ...(entry.id === null ? { ref: entry.ref } : { id: entry.id }), valid_from: entry.rule.validFrom, valid_to: entry.rule.validTo });
  const conflicts = after.flatMap((entry, index) => {
    if (!entry.changed) return [];
    const others = overlaps.flatMap(([a, b]) => (a === index ? [b] : b === index ? [a] : []));
    return others.length === 0 ? [] : [{ ...label(entry), with: others.map((other) => label(after[other] as Entry)) }];
  });
  return { issues: [], conflicts };
}

export function priceRuleConflict(conflicts: PriceConflict[]): AppError {
  return new AppError(409, "PRICE_RULE_CONFLICT", "同一个区域、车型组、方向或套餐的价格，生效日期不能重叠（两头的日期都算在内，停用的也算）", { conflicts });
}

/**
 * 在已经锁住商品、核对过版本号的事务里，检查并写入一批价格改动（保存和导入共用）。
 * 写得不对抛 400，重叠抛 409，已上架的商品改完不满足上架条件抛 409；抛错时事务整体回滚。
 */
export async function applyPriceChanges(db: Db, writer: ProductWriter, context: PricingContext, changes: PriceChanges, single: boolean, now: Date): Promise<PriceSaveResult> {
  const tenantId = writer.principal.tenantId;
  const { product } = context;
  const productId = product.id;
  const stored = new Map(context.priceRules.map((rule) => [rule.id, rule]));
  // 单条的修改 / 删除：那一条不存在就是 404（批量里则指出是第几条）
  if (single && [...changes.update.map((entry) => entry.id), ...changes.remove].some((id) => !stored.has(id))) throw notFound("价格规则");
  const check = checkPriceChanges(context, changes, single);
  if (check.issues.length > 0) invalid(check.issues);
  if (check.conflicts.length > 0) throw priceRuleConflict(check.conflicts);

  const noChange = changes.create.length === 0 && changes.remove.length === 0 && changes.update.every((entry) => samePriceRule(entry.rule, stored.get(entry.id) as StoredPriceRule));
  if (noChange) return { view: priceRulesView(context, product, context.priceRules), created: [] };

  // 先删、再改、再加：数据库里没有唯一约束要躲，这个顺序只是让审计日志好读
  await deletePriceRules(db, tenantId, productId, changes.remove);
  for (const id of changes.remove) await audit(db, writer, now, { resource: "price_rule", id, action: "delete", before: { product_id: productId, ...priceAudit(stored.get(id) as StoredPriceRule) }, after: null });
  for (const entry of changes.update) {
    const before = stored.get(entry.id) as StoredPriceRule;
    if (samePriceRule(entry.rule, before)) continue;
    await updatePriceRule(db, tenantId, productId, entry.id, entry.rule, now);
    const [old, fresh] = [priceAudit(before), priceAudit(entry.rule)];
    const changedKeys = Object.keys(fresh).filter((key) => !isDeepStrictEqual(old[key], fresh[key]));
    await audit(db, writer, now, {
      resource: "price_rule",
      id: entry.id,
      action: "update",
      before: Object.fromEntries(changedKeys.map((key) => [key, old[key] ?? null])),
      after: Object.fromEntries(changedKeys.map((key) => [key, fresh[key] ?? null])),
    });
  }
  const created: StoredPriceRule[] = [];
  for (const entry of changes.create) {
    const row = await insertPriceRule(db, tenantId, productId, entry.rule, now);
    created.push(row);
    await audit(db, writer, now, { resource: "price_rule", id: row.id, action: "create", before: null, after: { product_id: productId, ...priceAudit(row) } });
  }
  const updated = await bumpProduct(db, tenantId, productId, {}, now);
  await assertStillPublishable(db, tenantId, updated, now);
  return { view: priceRulesView(context, updated, await listPriceRules(db, tenantId, productId)), created };
}

/**
 * 保存一批价格规则的改动：全部成功或全部失败（需求文档的 batch-upsert；单条的新增 / 修改 / 删除也走这里）。
 * - 写得不对：400，路径指到是哪一条的哪一项（`/create/3/base_price`）。区域、车型组必须是这个商品现在选的
 *   （修改时没换区域 / 车型组的不查：它们后来被商品去掉了，价格还可以改、可以删）。
 * - 同一个组合的生效日期重叠：409 `PRICE_RULE_CONFLICT`，`details.conflicts` 列出每一条被拒绝的和它撞上的那些。
 * - `paths` 决定报错路径的前缀：批量接口是 `/create/N`、`/update/N`、`/delete/N`，单条接口没有前缀。
 */
export async function savePriceRules(
  ctx: AppContext,
  writer: ProductWriter,
  productId: string,
  expectedVersion: number,
  changes: PriceChanges,
  options: { single: boolean; idempotency: { scope: string; key: string } | null; respond: (result: PriceSaveResult) => { status: number; body: Record<string, unknown> } },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const now = ctx.now();
  const tenantId = writer.principal.tenantId;
  const work = async (db: Db): Promise<{ status: number; body: Record<string, unknown> }> => {
    const context = await loadPricingContext(db, tenantId, productId, now, { lock: true });
    if (context.product.version !== expectedVersion) throw versionConflict(context.product.version);
    return options.respond(await applyPriceChanges(db, writer, context, changes, options.single, now));
  };
  return writeTx(ctx, tenantId, async (db) => {
    const { idempotency } = options;
    if (idempotency === null) return work(db);
    const result = await runIdempotent(db, { tenantId, scope: idempotency.scope, key: idempotency.key, request: { productId, expectedVersion, changes }, now }, () => work(db));
    return { status: result.status, body: result.body };
  });
}

export function getPriceCoverage(ctx: AppContext, tenantId: string, productId: string): Promise<{ today: string; coverage: PriceCoverage; rules: StoredPriceRule[] }> {
  const now = ctx.now();
  return readTx(ctx, tenantId, async (db) => {
    const context = await loadPricingContext(db, tenantId, productId, now, { lock: false });
    const coverage = priceCoverage({ category: context.product.category, areaIds: context.areaIds, vehicleGroupIds: context.vehicleGroupIds, rules: context.priceRules, today: context.today });
    return { today: context.today, coverage, rules: context.priceRules };
  });
}

// ---- 调价规则 ----

export interface AdjustRulesView {
  version: number;
  currency: CurrencyCode | null;
  roundingUnit: number;
  today: string;
  items: StoredAdjustRule[];
}

export function getAdjustRules(ctx: AppContext, tenantId: string, productId: string): Promise<AdjustRulesView> {
  const now = ctx.now();
  return readTx(ctx, tenantId, async (db) => {
    const context = await loadPricingContext(db, tenantId, productId, now, { lock: false });
    return { version: context.product.version, currency: context.currency, roundingUnit: context.roundingUnit, today: context.today, items: context.adjustRules };
  });
}

function adjustAudit(rule: AdjustRule): AuditValues {
  return {
    name: rule.name,
    travel_from: rule.travelFrom,
    travel_to: rule.travelTo,
    cycle: rule.cycle as unknown as AuditValue,
    time_slot: rule.timeSlot as unknown as AuditValue,
    area_ids: rule.areaIds,
    vehicle_group_ids: rule.vehicleGroupIds,
    directions: rule.directions,
    package_hours: rule.packageHours,
    steps: rule.steps as unknown as AuditValue,
    status: rule.status,
  };
}

/**
 * 一条调价规则能不能存：写得对不对（domain）；适用的区域、车型组必须是这个商品现在选的（原来就选着的可以留）；
 * 启用的规则单独作用在它碰得到的、可以卖的价格上，按取整单位取整之后不能不大于 0（400 `ADJUST_RESULT_NOT_POSITIVE`，`detail.count` 是几条价格），
 * 也不能超过结算价的上限（400 `ADJUST_RESULT_TOO_LARGE`）。几条规则叠加之后的问题保存时查不了（它们各自什么时候生效要逐天看），
 * 在上架校验的「调价规则」一项里指出，价格日历和报价遇到时给出「报不出价」的原因。
 */
function assertAdjustRule(context: PricingContext, rule: AdjustRule, before: StoredAdjustRule | null): void {
  const issues = inputIssues(adjustRuleIssues(rule, { category: context.product.category }), "");
  const areas = new Set([...context.areaIds, ...(before?.areaIds ?? [])]);
  const groups = new Set([...context.vehicleGroupIds, ...(before?.vehicleGroupIds ?? [])]);
  for (const [index, areaId] of rule.areaIds.entries()) if (!areas.has(areaId)) issues.push({ path: `/area_ids/${index}`, reason: "AREA_NOT_IN_PRODUCT", message: "只能选这个商品选了的区域" });
  for (const [index, groupId] of rule.vehicleGroupIds.entries()) {
    if (!groups.has(groupId)) issues.push({ path: `/vehicle_group_ids/${index}`, reason: "VEHICLE_GROUP_NOT_IN_PRODUCT", message: "只能选这个商品选了的车型组" });
  }
  if (issues.length === 0 && rule.status === "enabled") {
    // 只看「可以卖的价格」（启用、没过期、区域和车型组是商品现在选着的），按取整单位取整之后的结果
    const prices = sellablePriceRules(context.priceRules, context, context.today);
    const count = adjustRuleNonPositivePrices(rule, prices, context.roundingUnit).length;
    if (count > 0) issues.push({ path: "/steps", reason: "ADJUST_RESULT_NOT_POSITIVE", message: `按这条规则调完（再按取整单位取整），有 ${count} 条价格不大于 0（这样的价格报不出去）。请调小减价的幅度，或缩小适用范围`, detail: { count } });
    const tooLarge = adjustRuleOverLimitPrices(rule, prices).length;
    if (tooLarge > 0) {
      issues.push({ path: "/steps", reason: "ADJUST_RESULT_TOO_LARGE", message: `按这条规则调完，有 ${tooLarge} 条价格超过了结算价的上限（这样的价格报不出去）。请检查上调的幅度`, detail: { count: tooLarge, max: PRICE_LIMITS.maxSettlementMinor } });
    }
  }
  if (issues.length > 0) invalid(issues);
}

export interface AdjustSaveResult {
  version: number;
  /** 城市当地的今天（判断规则是不是已经结束用） */
  today: string;
  rule: StoredAdjustRule | null;
}

type AdjustRespond = (result: AdjustSaveResult) => { status: number; body: Record<string, unknown> };

/** 新增一条调价规则（带幂等键）：排在最后（最后执行）。 */
export function createAdjustRule(ctx: AppContext, writer: ProductWriter, productId: string, expectedVersion: number, rule: AdjustRule, idempotency: { scope: string; key: string }, respond: AdjustRespond): Promise<{ status: number; body: Record<string, unknown> }> {
  const now = ctx.now();
  const tenantId = writer.principal.tenantId;
  return writeTx(ctx, tenantId, async (db) => {
    const result = await runIdempotent(db, { tenantId, scope: idempotency.scope, key: idempotency.key, request: { productId, expectedVersion, rule }, now }, async () => {
      const context = await loadPricingContext(db, tenantId, productId, now, { lock: true });
      if (context.product.version !== expectedVersion) throw versionConflict(context.product.version);
      if (context.adjustRules.length >= PRICE_LIMITS.maxAdjustRulesPerProduct) {
        invalid([{ path: "/", reason: "TOO_MANY", message: `一个商品最多 ${PRICE_LIMITS.maxAdjustRulesPerProduct} 条调价规则`, detail: { max: PRICE_LIMITS.maxAdjustRulesPerProduct } }]);
      }
      assertAdjustRule(context, rule, null);
      const position = context.adjustRules.reduce((max, existing) => Math.max(max, existing.position), -1) + 1;
      const created = await insertAdjustRule(db, tenantId, productId, rule, position, now);
      await audit(db, writer, now, { resource: "adjust_rule", id: created.id, action: "create", before: null, after: { product_id: productId, position, ...adjustAudit(created) } });
      const updated = await bumpProduct(db, tenantId, productId, {}, now);
      return respond({ version: updated.version, today: context.today, rule: created });
    });
    return { status: result.status, body: result.body };
  });
}

/** 改一条调价规则里的东西。`change` 拿到现在的规则，返回改完的样子（整体修改、启用 / 停用都用它）；返回 null 表示删除。 */
async function changeAdjustRule(
  ctx: AppContext,
  writer: ProductWriter,
  productId: string,
  ruleId: string,
  expectedVersion: number | null,
  action: AuditAction,
  change: (current: StoredAdjustRule) => AdjustRule | null,
): Promise<AdjustSaveResult> {
  const now = ctx.now();
  const tenantId = writer.principal.tenantId;
  return writeTx(ctx, tenantId, async (db) => {
    const context = await loadPricingContext(db, tenantId, productId, now, { lock: true });
    const current = context.adjustRules.find((rule) => rule.id === ruleId);
    if (!current) throw notFound("调价规则");
    if (expectedVersion !== null && context.product.version !== expectedVersion) throw versionConflict(context.product.version);
    const next = change(current);
    if (next === null) {
      await deleteAdjustRuleRow(db, tenantId, productId, ruleId);
      await audit(db, writer, now, { resource: "adjust_rule", id: ruleId, action: "delete", before: { product_id: productId, position: current.position, ...adjustAudit(current) }, after: null });
      return { version: (await bumpProduct(db, tenantId, productId, {}, now)).version, today: context.today, rule: null };
    }
    const [old, fresh] = [adjustAudit(current), adjustAudit(next)];
    const changedKeys = Object.keys(fresh).filter((key) => !isDeepStrictEqual(old[key], fresh[key]));
    if (changedKeys.length === 0) return { version: context.product.version, today: context.today, rule: current };
    assertAdjustRule(context, next, current);
    const saved = await updateAdjustRuleRow(db, tenantId, productId, ruleId, next, now);
    await audit(db, writer, now, {
      resource: "adjust_rule",
      id: ruleId,
      action,
      before: Object.fromEntries(changedKeys.map((key) => [key, old[key] ?? null])),
      after: Object.fromEntries(changedKeys.map((key) => [key, fresh[key] ?? null])),
    });
    return { version: (await bumpProduct(db, tenantId, productId, {}, now)).version, today: context.today, rule: saved };
  });
}

export function updateAdjustRule(ctx: AppContext, writer: ProductWriter, productId: string, ruleId: string, expectedVersion: number, rule: AdjustRule): Promise<AdjustSaveResult> {
  return changeAdjustRule(ctx, writer, productId, ruleId, expectedVersion, "update", () => rule);
}

export function deleteAdjustRule(ctx: AppContext, writer: ProductWriter, productId: string, ruleId: string, expectedVersion: number): Promise<AdjustSaveResult> {
  return changeAdjustRule(ctx, writer, productId, ruleId, expectedVersion, "delete", () => null);
}

/** 启用 / 停用：不要求版本号（列表里的开关，和别人的修改不冲突）；已经是那个状态的原样返回。 */
export function setAdjustRuleStatus(ctx: AppContext, writer: ProductWriter, productId: string, ruleId: string, status: "enabled" | "disabled"): Promise<AdjustSaveResult> {
  return changeAdjustRule(ctx, writer, productId, ruleId, null, status === "enabled" ? "enable" : "disable", (current) => ({ ...current, status }));
}

/** 保存顺序（顺序即优先级，排在前面的先执行）：`ids` 必须正好是这个商品全部调价规则的编号。 */
export function reorderAdjustRules(ctx: AppContext, writer: ProductWriter, productId: string, expectedVersion: number, ids: readonly string[]): Promise<AdjustRulesView> {
  const now = ctx.now();
  const tenantId = writer.principal.tenantId;
  return writeTx(ctx, tenantId, async (db) => {
    const context = await loadPricingContext(db, tenantId, productId, now, { lock: true });
    if (context.product.version !== expectedVersion) throw versionConflict(context.product.version);
    const current = context.adjustRules.map((rule) => rule.id);
    if (ids.length !== current.length || new Set(ids).size !== ids.length || ids.some((id) => !current.includes(id))) {
      invalid([{ path: "/ids", reason: "IDS_MISMATCH", message: "要给出这个商品全部调价规则的编号，每个一次（不多不少）" }]);
    }
    const view = (version: number, items: StoredAdjustRule[]): AdjustRulesView => ({ version, currency: context.currency, roundingUnit: context.roundingUnit, today: context.today, items });
    if (ids.every((id, index) => id === current[index])) return view(context.product.version, context.adjustRules);
    await setAdjustRuleOrder(db, tenantId, productId, ids);
    // 顺序是商品层面的事：记在商品的日志里
    await insertAuditLog(db, consoleOrigin(tenantActor(writer.principal.user), writer.ip, now), {
      tenantId,
      resource: "product",
      resourceId: productId,
      action: "update",
      before: { adjust_rule_order: current },
      after: { adjust_rule_order: [...ids] },
    });
    const updated = await bumpProduct(db, tenantId, productId, {}, now);
    return view(updated.version, await listAdjustRules(db, tenantId, productId));
  });
}

// ---- 区域被删除时 ----

/**
 * 删除区域之前调用（在删除区域的事务里、已经锁住区域之后）：这个区域下的价格跟着区域一起没了，这里把它们明着删掉——
 * 每条各记一条删除日志（带删之前的内容），相关商品的版本号加一（别人手里的旧页面保存时会被告知有变化）。
 * 调价规则的适用范围里写着这个区域的：去掉它；只写了这一个区域的（去掉之后会变成「全部区域」）整条删除。同样记日志、加版本号。
 * 能走到这里的只有草稿、已下架的商品，以及已上架但已经不再选这个区域的商品（它留着的旧价格本来就不算数，不影响上架）。
 */
export async function removePricingOfArea(db: Db, writer: ProductWriter, areaId: string, now: Date): Promise<void> {
  const tenantId = writer.principal.tenantId;
  const prices = await listPriceRulesInArea(db, tenantId, areaId);
  const adjusts = await listAdjustRulesWithArea(db, tenantId, areaId);
  const productIds = [...new Set([...prices, ...adjusts].map((entry) => entry.productId))].sort();
  for (const productId of productIds) await findProduct(db, tenantId, productId, { lock: true });
  for (const { productId, rule } of prices) {
    await deletePriceRules(db, tenantId, productId, [rule.id]);
    await audit(db, writer, now, { resource: "price_rule", id: rule.id, action: "delete", before: { product_id: productId, ...priceAudit(rule) }, after: null });
  }
  for (const { productId, rule } of adjusts) {
    const areaIds = rule.areaIds.filter((id) => id !== areaId);
    if (areaIds.length === 0) {
      await deleteAdjustRuleRow(db, tenantId, productId, rule.id);
      await audit(db, writer, now, { resource: "adjust_rule", id: rule.id, action: "delete", before: { product_id: productId, position: rule.position, ...adjustAudit(rule) }, after: null });
    } else {
      await updateAdjustRuleRow(db, tenantId, productId, rule.id, { ...rule, areaIds }, now);
      await audit(db, writer, now, { resource: "adjust_rule", id: rule.id, action: "update", before: { area_ids: rule.areaIds }, after: { area_ids: areaIds } });
    }
  }
  for (const productId of productIds) await bumpProduct(db, tenantId, productId, {}, now);
}

// ---- 价格日历 ----

export interface CalendarQuery {
  areaId: string;
  /** 一次可以看几个车型组（对比表）；至少一个，最多 20 个 */
  vehicleGroupIds: string[];
  direction: TripDirection | null;
  packageHours: number | null;
  from: string;
  to: string;
}

export interface CalendarDay {
  date: string;
  /** 商品所在国家这一天的节假日名称；不是节假日为 null */
  holiday: LocalizedText | null;
  segments: CalendarSegment<StoredPriceRule, StoredAdjustRule>[];
}

export interface CalendarView {
  version: number;
  currency: CurrencyCode | null;
  roundingUnit: number;
  today: string;
  /** 每个车型组各一份，顺序和请求里的一样 */
  groups: { vehicleGroupId: string; days: CalendarDay[] }[];
}

/**
 * 价格日历：一个组合在一段日期里每天的结算价（基础价 → 调价 → 取整）和命中的规则。和以后的报价用同一个函数（domain 的 tripPrice）。
 * 里程 + 时长的价格按「不超出起步」算（起步价或最低消费）。最多 62 天；一天最多切成「带时段的调价规则数 × 2 + 1」段。
 */
export function getPriceCalendar(ctx: AppContext, tenantId: string, productId: string, query: CalendarQuery): Promise<CalendarView> {
  const now = ctx.now();
  return readTx(ctx, tenantId, async (db) => {
    const context = await loadPricingContext(db, tenantId, productId, now, { lock: false });
    const { category } = context.product;
    const issues: InputIssue[] = [];
    if (!isLocalDate(query.from)) issues.push({ path: "/from", reason: "INVALID_DATE", message: ISSUE_MESSAGES.INVALID_DATE });
    if (!isLocalDate(query.to)) issues.push({ path: "/to", reason: "INVALID_DATE", message: ISSUE_MESSAGES.INVALID_DATE });
    if (issues.length === 0 && query.to < query.from) issues.push({ path: "/to", reason: "DATE_RANGE_REVERSED", message: ISSUE_MESSAGES.DATE_RANGE_REVERSED });
    if (issues.length === 0 && addDays(query.from, PRICE_LIMITS.maxCalendarDays - 1) < query.to) {
      issues.push({ path: "/to", reason: "TOO_MANY", message: `一次最多取 ${PRICE_LIMITS.maxCalendarDays} 天`, detail: { max: PRICE_LIMITS.maxCalendarDays } });
    }
    if ((category === "airport_transfer") !== (query.direction !== null)) {
      issues.push({ path: "/direction", reason: category === "airport_transfer" ? "REQUIRED" : "NOT_APPLICABLE", message: category === "airport_transfer" ? "接送机商品要给方向（pickup / dropoff）" : ISSUE_MESSAGES.NOT_APPLICABLE });
    }
    if ((category === "charter") !== (query.packageHours !== null)) {
      issues.push({ path: "/package_hours", reason: category === "charter" ? "REQUIRED" : "NOT_APPLICABLE", message: category === "charter" ? "包车商品要给套餐时长" : ISSUE_MESSAGES.NOT_APPLICABLE });
    }
    if (issues.length > 0) throw validationFailed("querystring", issues);

    // 节假日：调价规则里提到的国家，加上商品所在的国家（格子上显示假日名）；多取前一天，跨午夜的时段要用
    const countries = new Set(context.adjustRules.flatMap((rule) => (rule.cycle.type === "holidays" ? rule.cycle.countries : [])));
    if (context.countryCode !== null) countries.add(context.countryCode);
    const holidays = await listHolidayRows(db, { countryCodes: [...countries], from: addDays(query.from, -1), to: query.to }, 10_000);
    const lookup: HolidayLookup = holidayLookup(holidays);
    const local = new Map(holidays.filter((holiday) => holiday.countryCode === context.countryCode).map((holiday) => [holiday.date, holiday.name]));

    const groups = query.vehicleGroupIds.map((vehicleGroupId) => {
      const days: CalendarDay[] = [];
      for (let date = query.from; date <= query.to; date = addDays(date, 1)) {
        days.push({
          date,
          holiday: local.get(date) ?? null,
          segments: calendarDay({
            priceRules: context.priceRules,
            adjustRules: context.adjustRules,
            query: { areaId: query.areaId, vehicleGroupId, direction: query.direction, packageHours: query.packageHours, date },
            roundingUnit: context.roundingUnit,
            holidays: lookup,
          }),
        });
      }
      return { vehicleGroupId, days };
    });
    return { version: context.product.version, currency: context.currency, roundingUnit: context.roundingUnit, today: context.today, groups };
  });
}

// ---- 各商品的价格概况（首页卡片、菜单里的「价格规则」）----

export interface PriceOverviewItem extends ProductPriceOverview {
  /** 「该有价格的组合」一共几个、几个没有价格（算法同 price-coverage） */
  coverage: { total: number; missing: number };
}

export interface PriceOverview {
  /** 只数草稿和已上架的商品：有 / 没有「启用且没过期」的价格 */
  productsWithPrice: number;
  productsWithoutPrice: number;
  /** 已上架、却已经没有可以卖的价格的商品有几个（价格的生效期自然过去了）：还挂着「已上架」，一个价都报不出 */
  publishedWithoutPrice: number;
  /** 已上架的商品里，库存是限量而从今天起没有可售库存的有几个（上了架却报不出价） */
  publishedWithoutInventory: number;
  /** 只要上面几个数时为 null */
  items: PriceOverviewItem[] | null;
}

const OVERVIEW_LIMIT = 1_000;

/**
 * 各商品的价格概况。`summaryOnly` 时只算首页要的两个数，不取每个商品的明细。
 * 明细里的缺价概况要用到每个商品选的区域、车型组和全部价格：三样各一条查询取回整个供应商的，在内存里按商品分开算。
 */
export function getPriceOverview(ctx: AppContext, tenantId: string, summaryOnly: boolean): Promise<PriceOverview> {
  const now = ctx.now();
  return readTx(ctx, tenantId, async (db) => {
    const rows = await listProductPriceOverview(db, tenantId, now, OVERVIEW_LIMIT);
    const counted = rows.filter((item) => item.status !== "unpublished");
    const withPrice = counted.filter((item) => item.activePriceRuleCount > 0).length;
    const totals = { productsWithPrice: withPrice, productsWithoutPrice: counted.length - withPrice, publishedWithoutPrice: rows.filter((item) => item.status === "published" && item.activePriceRuleCount === 0).length, publishedWithoutInventory: rows.filter((item) => item.status === "published" && item.noInventoryAhead).length };
    if (summaryOnly) return { ...totals, items: null };
    const shapes = await listPriceCoverageInputs(db, tenantId);
    const items = rows.map((row): PriceOverviewItem => {
      const shape = shapes.get(row.productId) ?? { areaIds: [], vehicleGroupIds: [], rules: [] };
      const coverage = priceCoverage({ category: row.category, areaIds: shape.areaIds, vehicleGroupIds: shape.vehicleGroupIds, rules: shape.rules, today: row.today });
      return { ...row, coverage: { total: coverage.total, missing: coverage.total - coverage.priced } };
    });
    return { ...totals, items };
  });
}

// ---- 子品牌的取整单位 ----

export interface RoundingUnitSaved {
  id: string;
  roundingUnit: number;
  version: number;
  /** 这次修改让多少条可以卖的价格取整后的数变了（按「不超出起步 / 套餐」的基础价算，不含调价）；没改时是 0 */
  changedPriceCount: number;
}

/** 一条价格的基础价（不超出起步 / 套餐）按取整单位取整后的数；不大于 0（报不出价）时为 null。 */
function roundedBase(rule: StoredPriceRule, roundingUnit: number): number | null {
  return applyAdjustRules(basePrice(rule.pricing, {}, rule.packageHours), [], roundingUnit).finalMinor;
}

/**
 * 改子品牌的取整单位（只有管理员）。可选的值由币种决定（domain 的 roundingUnitOptions）。对这个子品牌下所有商品生效。
 * 取整单位改大会让比半个单位还小的价格取整成 0（报不出价）：只要这个子品牌下有任何一条可以卖的价格会这样，就拒绝
 * （409 `ROUNDING_UNIT_ZEROES_PRICES`，列出是哪些商品、各几条）——已上架的商品不能悄悄报不出价，草稿也拦，免得上架之后才发现。
 */
export function setRoundingUnit(ctx: AppContext, writer: ProductWriter, brandId: string, expectedVersion: number, roundingUnit: number): Promise<RoundingUnitSaved> {
  const now = ctx.now();
  const tenantId = writer.principal.tenantId;
  return writeTx(ctx, tenantId, async (db) => {
    const brand = await findBrand(db, tenantId, brandId, { lock: true });
    if (!brand) throw notFound("子品牌");
    if (brand.version !== expectedVersion) throw versionConflict(brand.version);
    const options = roundingUnitOptions(brand.currency);
    if (!options.includes(roundingUnit)) invalid([{ path: "/rounding_unit", reason: "OUT_OF_RANGE", message: `${brand.currency} 的取整单位只能是（最小货币单位）：${options.join("、")}` }]);
    if (roundingUnit === brand.roundingUnit) return { id: brandId, roundingUnit, version: brand.version, changedPriceCount: 0 };

    const prices = await listBrandSellablePrices(db, tenantId, brandId, now);
    const zeroed = prices.filter((price) => roundedBase(price.rule, brand.roundingUnit) !== null && roundedBase(price.rule, roundingUnit) === null);
    if (zeroed.length > 0) {
      const byProduct = new Map<string, { product_id: string; code: string; status: string; price_count: number }>();
      for (const price of zeroed) {
        const entry = byProduct.get(price.productId) ?? { product_id: price.productId, code: price.code, status: price.status, price_count: 0 };
        entry.price_count += 1;
        byProduct.set(price.productId, entry);
      }
      const products = [...byProduct.values()];
      throw new AppError(
        409,
        "ROUNDING_UNIT_ZEROES_PRICES",
        `取整单位改成这个数之后，有 ${products.length} 个商品的 ${zeroed.length} 条价格取整后是 0（比半个取整单位还小），就报不出价了。请先把这些价格调高或停用，或者选一个小一些的取整单位`,
        { rounding_unit: roundingUnit, price_count: zeroed.length, product_count: products.length, published_product_count: products.filter((product) => product.status === "published").length, products: products.slice(0, ROUNDING_DETAIL_PRODUCTS) },
      );
    }
    const changedPriceCount = prices.filter((price) => roundedBase(price.rule, brand.roundingUnit) !== roundedBase(price.rule, roundingUnit)).length;
    const version = await setBrandRoundingUnit(db, tenantId, brandId, roundingUnit, now);
    await audit(db, writer, now, { resource: "brand", id: brandId, action: "update", before: { rounding_unit: brand.roundingUnit }, after: { rounding_unit: roundingUnit } });
    return { id: brandId, roundingUnit, version, changedPriceCount };
  });
}

/** 被拒时最多列出多少个商品（个数另给） */
const ROUNDING_DETAIL_PRODUCTS = 50;

// ---- 节假日日历（平台主数据）----

export type HolidayReader = { kind: "platform" } | { kind: "tenant"; tenantId: string };

function holidayTx<T>(ctx: AppContext, reader: HolidayReader, fn: (db: Db) => Promise<T>): Promise<T> {
  const options = { snapshot: true };
  return reader.kind === "platform" ? withPlatformTx(ctx.pool, fn, options) : withTenantTx(ctx.pool, reader.tenantId, fn, options);
}

export const HOLIDAY_QUERY_MAX_DAYS = 800;

/** 一段日期里的节假日（最多约两年），外加「哪些国家有节假日数据」。 */
export function listHolidays(ctx: AppContext, reader: HolidayReader, filter: { countryCodes: readonly string[] | null; from: string; to: string }): Promise<{ items: Holiday[]; countries: { countryCode: string; count: number; lastDate: string }[] }> {
  const issues: InputIssue[] = [];
  if (!isLocalDate(filter.from)) issues.push({ path: "/from", reason: "INVALID_DATE", message: ISSUE_MESSAGES.INVALID_DATE });
  if (!isLocalDate(filter.to)) issues.push({ path: "/to", reason: "INVALID_DATE", message: ISSUE_MESSAGES.INVALID_DATE });
  if (issues.length === 0 && filter.to < filter.from) issues.push({ path: "/to", reason: "DATE_RANGE_REVERSED", message: ISSUE_MESSAGES.DATE_RANGE_REVERSED });
  if (issues.length === 0 && addDays(filter.from, HOLIDAY_QUERY_MAX_DAYS - 1) < filter.to) issues.push({ path: "/to", reason: "TOO_MANY", message: `一次最多取 ${HOLIDAY_QUERY_MAX_DAYS} 天`, detail: { max: HOLIDAY_QUERY_MAX_DAYS } });
  for (const code of filter.countryCodes ?? []) if (!isCountryCode(code)) issues.push({ path: "/country_code", reason: "INVALID_COUNTRY", message: ISSUE_MESSAGES.INVALID_COUNTRY });
  if (issues.length > 0) throw validationFailed("querystring", issues);
  return holidayTx(ctx, reader, async (db) => ({ items: await listHolidayRows(db, filter, 20_000), countries: await listHolidayCountries(db) }));
}

function assertHolidayKey(countryCode: string, date: string): void {
  // 路径里的国家码、日期写得不对：这一天的节假日「不存在」
  if (!isCountryCode(countryCode) || !isLocalDate(date)) throw notFound("节假日");
}

/** 平台登记 / 修改某个国家某一天的节假日（名称至少一种语言）。写审计日志。 */
export function putHoliday(ctx: AppContext, writer: MasterWriter, countryCode: string, date: string, name: LocalizedText): Promise<{ holiday: Holiday; created: boolean }> {
  assertHolidayKey(countryCode, date);
  if (Object.values(name).length === 0 || Object.values(name).some((text) => !hasVisibleText(text))) invalid([{ path: "/name", reason: "REQUIRED", message: "名称至少要填一种语言，而且不能只有空白" }]);
  const now = ctx.now();
  return withPlatformTx(ctx.pool, async (db) => {
    const before = await findHoliday(db, countryCode, date);
    if (before && isDeepStrictEqual(before.name, name)) return { holiday: before, created: false };
    const holiday = await upsertHoliday(db, countryCode, date, name, now);
    await insertAuditLog(db, consoleOrigin(platformActor(writer.principal.user), writer.ip, now), {
      tenantId: null,
      resource: "holiday",
      resourceId: `${countryCode}:${date}`,
      action: before ? "update" : "create",
      before: before ? { name: before.name } : null,
      after: { country_code: countryCode, date, name },
    });
    return { holiday, created: before === null };
  });
}

export function removeHoliday(ctx: AppContext, writer: MasterWriter, countryCode: string, date: string): Promise<void> {
  assertHolidayKey(countryCode, date);
  const now = ctx.now();
  return withPlatformTx(ctx.pool, async (db) => {
    const before = await findHoliday(db, countryCode, date);
    if (!before) throw notFound("节假日");
    await deleteHoliday(db, countryCode, date);
    await insertAuditLog(db, consoleOrigin(platformActor(writer.principal.user), writer.ip, now), {
      tenantId: null,
      resource: "holiday",
      resourceId: `${countryCode}:${date}`,
      action: "delete",
      before: { country_code: countryCode, date, name: before.name },
      after: null,
    });
  });
}
