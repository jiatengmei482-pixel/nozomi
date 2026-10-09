/**
 * 库存的业务流程（M1-05）：模式（不限量 / 限量）、库存日历、按日期范围批量设置。
 *
 * - 规则在 @nozomi/domain 的 inventory.ts；这里负责取数据、调用、写库、写审计日志。
 * - 库存属于商品：修改锁住商品那一行、核对商品的版本号（`If-Match`）、让商品的版本号加一（ADR 0016「一个版本号」）。
 * - 日期都是商品所在城市当地的日期；过去的日子只能看、不能改。
 * - 已经预占、已售的单不能被改没：可售总数不能小于占用数，有占用的日子不能清除（409 INVENTORY_BELOW_OCCUPIED）。
 * - 全部在租户事务里：别的供应商的商品一律当作不存在。
 */
import {
  INVENTORY_LIMITS,
  type InventoryBatch,
  type InventoryDayStatus,
  type InventoryIssue,
  type InventoryIssueReason,
  type InventoryMode,
  addDays,
  instantToLocal,
  inventoryBatchDates,
  inventoryBatchIssues,
  inventoryDayStatus,
  inventoryOccupiedBlocking,
  inventoryRemaining,
  isLocalDate,
} from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import type { Db } from "../db/context.ts";
import { AppError } from "../errors.ts";
import { findAreaCities } from "../repos/areas.ts";
import { type AuditValue, insertAuditLog } from "../repos/audit-logs.ts";
import { type StoredInventoryDay, clearInventoryDays, findInventoryMode, listInventoryDays, setInventoryMode as setInventoryModeRow, upsertInventoryTotals } from "../repos/inventory.ts";
import { type Product, findProduct, updateProduct as bumpProduct } from "../repos/products.ts";
import { type InputIssue, validationFailed } from "../validation.ts";
import { consoleOrigin, tenantActor } from "./audit.ts";
import { notFound, versionConflict } from "./errors.ts";
import { type ProductWriter, readTx, writeTx } from "./products.ts";

export const INVENTORY_ISSUE_MESSAGES: Readonly<Record<InventoryIssueReason, string>> = {
  INVALID_DATE: "不是合法的日期（YYYY-MM-DD）",
  DATE_RANGE_REVERSED: "结束日期不能早于开始日期",
  DATE_IN_PAST: "过去的日期不能设库存",
  TOO_FAR_AHEAD: `最远只能设到 ${INVENTORY_LIMITS.maxDaysAhead} 天以后`,
  TOO_MANY: `一次最多 ${INVENTORY_LIMITS.maxRangeDays} 天`,
  NOT_INTEGER: "必须是整数",
  OUT_OF_RANGE: "超出了允许的范围",
  DUPLICATE: "重复了",
  NO_DAY_SELECTED: "这段日期里没有一天符合选的星期",
};

export function inventoryInputIssues(issues: readonly InventoryIssue[], prefix = ""): InputIssue[] {
  return issues.map((issue) => ({ path: `${prefix}${issue.path}`, reason: issue.reason, message: INVENTORY_ISSUE_MESSAGES[issue.reason], ...(issue.detail ? { detail: issue.detail } : {}) }));
}

export interface InventoryContext {
  product: Product;
  mode: InventoryMode;
  /** 城市当地的今天 */
  today: string;
}

export async function loadInventoryContext(db: Db, tenantId: string, productId: string, now: Date, options: { lock: boolean }): Promise<InventoryContext> {
  const product = await findProduct(db, tenantId, productId, options);
  if (!product) throw notFound("商品");
  const city = (await findAreaCities(db, [product.cityId])).get(product.cityId);
  return { product, mode: (await findInventoryMode(db, tenantId, productId)) ?? "unlimited", today: instantToLocal(now, city?.timezone ?? "UTC").date };
}

export interface InventoryDayView {
  date: string;
  /** 设的可售总数；这一天没设过为 null */
  total: number | null;
  held: number;
  sold: number;
  /** 还剩多少可售；不限量时为 null */
  remaining: number | null;
  status: InventoryDayStatus;
}

export interface InventoryView {
  version: number;
  mode: InventoryMode;
  today: string;
  days: InventoryDayView[];
}

function dayViews(mode: InventoryMode, stored: readonly StoredInventoryDay[], from: string, to: string): InventoryDayView[] {
  const byDate = new Map(stored.map((day) => [day.date, day]));
  const days: InventoryDayView[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const day = byDate.get(date) ?? null;
    days.push({ date, total: day?.total ?? null, held: day?.held ?? 0, sold: day?.sold ?? 0, remaining: inventoryRemaining(mode, day), status: inventoryDayStatus(mode, day) });
  }
  return days;
}

function assertRange(from: string, to: string): void {
  const issues: InputIssue[] = [];
  if (!isLocalDate(from)) issues.push({ path: "/from", reason: "INVALID_DATE", message: INVENTORY_ISSUE_MESSAGES.INVALID_DATE });
  if (!isLocalDate(to)) issues.push({ path: "/to", reason: "INVALID_DATE", message: INVENTORY_ISSUE_MESSAGES.INVALID_DATE });
  if (issues.length === 0 && to < from) issues.push({ path: "/to", reason: "DATE_RANGE_REVERSED", message: INVENTORY_ISSUE_MESSAGES.DATE_RANGE_REVERSED });
  if (issues.length === 0 && addDays(from, INVENTORY_LIMITS.maxRangeDays - 1) < to) issues.push({ path: "/to", reason: "TOO_MANY", message: INVENTORY_ISSUE_MESSAGES.TOO_MANY, detail: { max: INVENTORY_LIMITS.maxRangeDays } });
  if (issues.length > 0) throw validationFailed("querystring", issues);
}

/** 库存日历：一段日期里（两端都含，最多 366 天）每天的可售总数、已预占、已售、剩余。过去的日子也可以看。 */
export function getInventory(ctx: AppContext, tenantId: string, productId: string, from: string, to: string): Promise<InventoryView> {
  assertRange(from, to);
  const now = ctx.now();
  return readTx(ctx, tenantId, async (db) => {
    const context = await loadInventoryContext(db, tenantId, productId, now, { lock: false });
    return { version: context.product.version, mode: context.mode, today: context.today, days: dayViews(context.mode, await listInventoryDays(db, tenantId, productId, from, to), from, to) };
  });
}

/**
 * 切换库存模式。每日库存的数不动：切到不限量之后它们不起作用，切回限量时还在。
 * （需求文档「切回无限需二次确认」是页面上的确认；接口不拦。）
 */
export function setInventoryMode(ctx: AppContext, writer: ProductWriter, productId: string, expectedVersion: number, mode: InventoryMode): Promise<{ version: number; mode: InventoryMode }> {
  const now = ctx.now();
  const tenantId = writer.principal.tenantId;
  return writeTx(ctx, tenantId, async (db) => {
    const context = await loadInventoryContext(db, tenantId, productId, now, { lock: true });
    if (context.product.version !== expectedVersion) throw versionConflict(context.product.version);
    if (context.mode === mode) return { version: context.product.version, mode };
    await setInventoryModeRow(db, tenantId, productId, mode);
    const updated = await bumpProduct(db, tenantId, productId, {}, now);
    await insertAuditLog(db, consoleOrigin(tenantActor(writer.principal.user), writer.ip, now), {
      tenantId,
      resource: "product",
      resourceId: productId,
      action: "update",
      before: { inventory_mode: context.mode },
      after: { inventory_mode: mode },
    });
    return { version: updated.version, mode };
  });
}

/** 一天要改成多少：`total` 为 null = 清除。 */
export interface InventoryChange {
  date: string;
  total: number | null;
}

export interface InventoryApplied {
  version: number;
  /** 实际变了的日子（和原来一样的不算） */
  changed: InventoryChange[];
}

/**
 * 在已经锁住商品的事务里，把这些日期改成各自的数。批量设置和导入共用。
 * - 有占用（预占 + 已售）的日子不能改到占用数以下、不能清除：409，`details.days` 列出是哪几天、各占用了多少；什么都不写。
 * - 没有变化时不加版本、不写日志。
 * - 审计日志：一次保存记一条，`before` / `after` 是变了的那些日子各自的前后值（日期 → 可售总数，null = 没设），外加调用方给的概况。
 */
export async function applyInventoryChanges(db: Db, writer: ProductWriter, context: InventoryContext, changes: readonly InventoryChange[], summary: Record<string, AuditValue>, now: Date): Promise<InventoryApplied> {
  const tenantId = writer.principal.tenantId;
  const productId = context.product.id;
  const dates = changes.map((change) => change.date).sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (first === undefined || last === undefined) return { version: context.product.version, changed: [] };
  const current = new Map((await listInventoryDays(db, tenantId, productId, first, last, { lock: true })).map((day) => [day.date, day]));
  const blocked = changes.flatMap((change) => {
    const occupied = inventoryOccupiedBlocking(current.get(change.date) ?? null, change.total);
    return occupied === null ? [] : [{ date: change.date, occupied }];
  });
  if (blocked.length > 0) {
    throw new AppError(409, "INVENTORY_BELOW_OCCUPIED", `有 ${blocked.length} 天已经有订单占着库存：可售单数不能改到已占用的数以下，也不能清除`, { days: blocked });
  }
  const changed = changes.filter((change) => (current.get(change.date)?.total ?? null) !== change.total);
  if (changed.length === 0) return { version: context.product.version, changed: [] };
  await upsertInventoryTotals(db, tenantId, productId, changed.flatMap((change) => (change.total === null ? [] : [{ date: change.date, total: change.total }])), now);
  await clearInventoryDays(db, tenantId, productId, changed.flatMap((change) => (change.total === null ? [change.date] : [])));
  const updated = await bumpProduct(db, tenantId, productId, {}, now);
  await insertAuditLog(db, consoleOrigin(tenantActor(writer.principal.user), writer.ip, now), {
    tenantId,
    resource: "inventory",
    resourceId: productId,
    action: "update",
    before: { days: Object.fromEntries(changed.map((change) => [change.date, current.get(change.date)?.total ?? null])) },
    after: { ...summary, changed_days: changed.length, days: Object.fromEntries(changed.map((change) => [change.date, change.total])) },
  });
  return { version: updated.version, changed };
}

/**
 * 批量设置（需求文档的 `inventory:batch-set`）：日期范围（两端都含）× 星期（空 = 每天）设成同一个数；不填数量 = 清除；0 = 停售。
 * 日历上点某一天直接改，就是开始和结束是同一天的批量设置。不限量模式下也可以先设好，切到限量时生效。
 */
export function batchSetInventory(ctx: AppContext, writer: ProductWriter, productId: string, expectedVersion: number, batch: InventoryBatch): Promise<InventoryView & { changedDays: number }> {
  const now = ctx.now();
  const tenantId = writer.principal.tenantId;
  return writeTx(ctx, tenantId, async (db) => {
    const context = await loadInventoryContext(db, tenantId, productId, now, { lock: true });
    if (context.product.version !== expectedVersion) throw versionConflict(context.product.version);
    const issues = inventoryBatchIssues(batch, context.today);
    if (issues.length > 0) throw validationFailed("body", inventoryInputIssues(issues));
    const dates = inventoryBatchDates(batch);
    const applied = await applyInventoryChanges(db, writer, context, dates.map((date) => ({ date, total: batch.total })), { from: batch.from, to: batch.to, weekdays: batch.weekdays, total: batch.total }, now);
    return { version: applied.version, mode: context.mode, today: context.today, days: dayViews(context.mode, await listInventoryDays(db, tenantId, productId, batch.from, batch.to), batch.from, batch.to), changedDays: applied.changed.length };
  });
}
