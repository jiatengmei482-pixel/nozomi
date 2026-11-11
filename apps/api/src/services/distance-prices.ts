/**
 * 计程价的业务流程（M8-30，ADR 0080）：接送机、点对点商品按车型组的「起步价 + 每公里单价」，不挂区域。
 *
 * - 规则在 @nozomi/domain 的 distance-price.ts；这里取数据、调用、写库、写审计日志。
 * - 计程价属于商品：每次修改都锁住商品那一行、核对商品的版本号（`If-Match`；启用 / 停用不要求，同调价规则）、让商品的版本号加一。
 *   同一个商品的写入被这把锁排成了队，「同一车型组的生效日期不能重叠」在应用里检查（同 ADR 0018），冲突 409 `DISTANCE_PRICE_CONFLICT`。
 * - 只有接送机、点对点能设（包车 400 `DISTANCE_PRICE_NOT_ALLOWED`）；车型组必须是商品现在选的（改的时候原来就选着的可以留）。
 * - 计程价不是上架条件（它是兜底，可以不设）：增删改不影响能不能上架。
 * - 全部在租户事务里：别的供应商的商品、计程价一律当作不存在（404）。金额都是结算价，这里没有对外价和加价比例（规则 4）。
 */
import { type DistancePrice, distancePriceAllowed, distancePriceConflicts, distancePriceIssues } from "@nozomi/domain";
import type { DbContext } from "../context.ts";
import type { Db } from "../db/context.ts";
import { AppError } from "../errors.ts";
import { type AuditAction, type AuditValues, insertAuditLog } from "../repos/audit-logs.ts";
import { type StoredDistancePrice, deleteDistancePrice as deleteRow, insertDistancePrice, listDistancePrices, updateDistancePrice } from "../repos/distance-prices.ts";
import { updateProduct as bumpProduct } from "../repos/products.ts";
import { type InputIssue, validationFailed } from "../validation.ts";
import { tenantWriteOrigin } from "./audit.ts";
import { notFound, versionConflict } from "./errors.ts";
import { runIdempotent } from "./idempotency.ts";
import { type PricingContext, loadPricingContext } from "./prices.ts";
import { type ProductWriter, readTx, writeTx } from "./products.ts";

/** 一个商品最多多少条计程价 */
export const MAX_DISTANCE_PRICES_PER_PRODUCT = 200;

const ISSUE_MESSAGES: Readonly<Record<string, string>> = {
  NOT_INTEGER: "必须是整数（金额用最小货币单位）",
  OUT_OF_RANGE: "超出了允许的范围（起步价和每公里单价不能都是 0）",
  INVALID_DATE: "不是合法的日期（YYYY-MM-DD）",
  DATE_RANGE_REVERSED: "结束日期不能早于开始日期",
};

export interface DistancePricesView {
  version: number;
  currency: string | null;
  today: string;
  items: StoredDistancePrice[];
}

export interface DistancePriceSaveResult {
  version: number;
  price: StoredDistancePrice | null;
}

function priceAudit(price: DistancePrice): AuditValues {
  return { vehicle_group_id: price.vehicleGroupId, start_price: price.startMinor, per_km: price.perKmMinor, valid_from: price.validFrom, valid_to: price.validTo, status: price.status };
}

function audit(db: Db, writer: ProductWriter, now: Date, event: { id: string; action: AuditAction; before: AuditValues | null; after: AuditValues | null }): Promise<void> {
  return insertAuditLog(db, tenantWriteOrigin(writer, now), { tenantId: writer.principal.tenantId, resource: "distance_price", resourceId: event.id, action: event.action, before: event.before, after: event.after });
}

function assertAllowed(context: PricingContext): void {
  if (!distancePriceAllowed(context.product.category)) throw new AppError(400, "DISTANCE_PRICE_NOT_ALLOWED", "计程价只有接送机、点对点商品能设（包车不用计程兜底）");
}

/** 一条计程价能不能存：写得对不对（domain）、车型组是商品选的、和同车型组的别的计程价生效日期不重叠 */
function assertPrice(context: PricingContext, others: readonly StoredDistancePrice[], price: DistancePrice, before: StoredDistancePrice | null): void {
  const issues: InputIssue[] = distancePriceIssues(price).map((issue) => ({ path: issue.path, reason: issue.reason, message: ISSUE_MESSAGES[issue.reason] ?? "不正确", ...(issue.detail ? { detail: issue.detail } : {}) }));
  const groupKept = before !== null && before.vehicleGroupId === price.vehicleGroupId;
  if (!groupKept && !context.vehicleGroupIds.includes(price.vehicleGroupId)) issues.push({ path: "/vehicle_group_id", reason: "VEHICLE_GROUP_NOT_IN_PRODUCT", message: "只能选这个商品选了的车型组" });
  if (issues.length > 0) throw validationFailed("body", issues);
  const conflicts = distancePriceConflicts(price, others).map((index) => others[index] as StoredDistancePrice);
  if (conflicts.length > 0) {
    throw new AppError(409, "DISTANCE_PRICE_CONFLICT", "同一个车型组的计程价，生效日期不能重叠（两头的日期都算在内，停用的也算）", {
      conflicts: conflicts.map((other) => ({ id: other.id, valid_from: other.validFrom, valid_to: other.validTo })),
    });
  }
}

export function getDistancePrices(ctx: DbContext, tenantId: string, productId: string): Promise<DistancePricesView> {
  const now = ctx.now();
  return readTx(ctx, tenantId, async (db) => {
    const context = await loadPricingContext(db, tenantId, productId, now, { lock: false });
    return { version: context.product.version, currency: context.currency, today: context.today, items: await listDistancePrices(db, tenantId, productId) };
  });
}

/** 新增一条计程价（带幂等键）。 */
export function createDistancePrice(
  ctx: DbContext,
  writer: ProductWriter,
  productId: string,
  expectedVersion: number,
  price: DistancePrice,
  idempotency: { scope: string; key: string },
  respond: (result: DistancePriceSaveResult) => { status: number; body: Record<string, unknown> },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const now = ctx.now();
  const tenantId = writer.principal.tenantId;
  return writeTx(ctx, tenantId, async (db) => {
    const result = await runIdempotent(db, { tenantId, scope: idempotency.scope, key: idempotency.key, request: { productId, expectedVersion, price }, now }, async () => {
      const context = await loadPricingContext(db, tenantId, productId, now, { lock: true });
      if (context.product.version !== expectedVersion) throw versionConflict(context.product.version);
      assertAllowed(context);
      const existing = await listDistancePrices(db, tenantId, productId);
      if (existing.length >= MAX_DISTANCE_PRICES_PER_PRODUCT) {
        throw validationFailed("body", [{ path: "/", reason: "TOO_MANY", message: `一个商品最多 ${MAX_DISTANCE_PRICES_PER_PRODUCT} 条计程价`, detail: { max: MAX_DISTANCE_PRICES_PER_PRODUCT } }]);
      }
      assertPrice(context, existing, price, null);
      const created = await insertDistancePrice(db, tenantId, productId, price, now);
      await audit(db, writer, now, { id: created.id, action: "create", before: null, after: { product_id: productId, ...priceAudit(created) } });
      const updated = await bumpProduct(db, tenantId, productId, {}, now);
      return respond({ version: updated.version, price: created });
    });
    return { status: result.status, body: result.body };
  });
}

/** 改一条计程价。`change` 拿到现在的样子，返回改完的样子（整体修改、启用 / 停用都用它）；返回 null 表示删除。 */
function changeDistancePrice(ctx: DbContext, writer: ProductWriter, productId: string, priceId: string, expectedVersion: number | null, action: AuditAction, change: (current: StoredDistancePrice) => DistancePrice | null): Promise<DistancePriceSaveResult> {
  const now = ctx.now();
  const tenantId = writer.principal.tenantId;
  return writeTx(ctx, tenantId, async (db) => {
    const context = await loadPricingContext(db, tenantId, productId, now, { lock: true });
    const all = await listDistancePrices(db, tenantId, productId);
    const current = all.find((price) => price.id === priceId);
    if (!current) throw notFound("计程价");
    if (expectedVersion !== null && context.product.version !== expectedVersion) throw versionConflict(context.product.version);
    const next = change(current);
    if (next === null) {
      await deleteRow(db, tenantId, productId, priceId);
      await audit(db, writer, now, { id: priceId, action: "delete", before: { product_id: productId, ...priceAudit(current) }, after: null });
      return { version: (await bumpProduct(db, tenantId, productId, {}, now)).version, price: null };
    }
    const [old, fresh] = [priceAudit(current), priceAudit(next)];
    const changed = Object.keys(fresh).filter((key) => old[key] !== fresh[key]);
    if (changed.length === 0) return { version: context.product.version, price: current };
    assertPrice(
      context,
      all.filter((price) => price.id !== priceId),
      next,
      current,
    );
    const saved = await updateDistancePrice(db, tenantId, productId, priceId, next, now);
    await audit(db, writer, now, { id: priceId, action, before: Object.fromEntries(changed.map((key) => [key, old[key] ?? null])), after: Object.fromEntries(changed.map((key) => [key, fresh[key] ?? null])) });
    return { version: (await bumpProduct(db, tenantId, productId, {}, now)).version, price: saved };
  });
}

export function updateDistancePriceRule(ctx: DbContext, writer: ProductWriter, productId: string, priceId: string, expectedVersion: number, price: DistancePrice): Promise<DistancePriceSaveResult> {
  return changeDistancePrice(ctx, writer, productId, priceId, expectedVersion, "update", () => price);
}

export function deleteDistancePrice(ctx: DbContext, writer: ProductWriter, productId: string, priceId: string, expectedVersion: number): Promise<DistancePriceSaveResult> {
  return changeDistancePrice(ctx, writer, productId, priceId, expectedVersion, "delete", () => null);
}

/** 启用 / 停用：不要求版本号（列表里的开关）；已经是那个状态的原样返回。启用时同样查冲突 */
export function setDistancePriceStatus(ctx: DbContext, writer: ProductWriter, productId: string, priceId: string, status: "enabled" | "disabled"): Promise<DistancePriceSaveResult> {
  return changeDistancePrice(ctx, writer, productId, priceId, null, status === "enabled" ? "enable" : "disable", (current) => ({ ...current, status }));
}
