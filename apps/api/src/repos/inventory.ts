/**
 * 库存的读写（M1-05）。租户表：只在租户事务里调用，每条语句显式带 tenant_id，行级安全再兜一层。
 * 这里只有供应商配置库存用的读写；下单时的预占、扣减、释放是 M3-01 的事（做法见 ADR 0019）。
 */
import type { InventoryDay, InventoryMode } from "@nozomi/domain";
import type { Db } from "../db/context.ts";

type Row = Record<string, any>;

export interface StoredInventoryDay extends InventoryDay {
  date: string;
}

export async function findInventoryMode(db: Db, tenantId: string, productId: string): Promise<InventoryMode | null> {
  const result = await db.query<{ inventory_mode: InventoryMode }>("select inventory_mode from products where tenant_id = $1 and id = $2", [tenantId, productId]);
  return result.rows[0]?.inventory_mode ?? null;
}

export async function setInventoryMode(db: Db, tenantId: string, productId: string, mode: InventoryMode): Promise<void> {
  await db.query("update products set inventory_mode = $3 where tenant_id = $1 and id = $2", [tenantId, productId, mode]);
}

/** 一段日期里（两端都含）设过库存的日子，从早到晚。`lock` 时锁住这些行（批量设置前先锁，和下单的预占互斥）。 */
export async function listInventoryDays(db: Db, tenantId: string, productId: string, from: string, to: string, options: { lock: boolean } = { lock: false }): Promise<StoredInventoryDay[]> {
  const result = await db.query<Row>(
    `select day::text as day, total, held, sold from inventory_days
      where tenant_id = $1 and product_id = $2 and vehicle_group_id is null and day between $3 and $4
      order by day ${options.lock ? "for update" : ""}`,
    [tenantId, productId, from, to],
  );
  return result.rows.map((row) => ({ date: row["day"], total: row["total"], held: row["held"], sold: row["sold"] }));
}

/** 把这些日期的可售总数设成各自的数（没有行就新建，有就改总数，不动 held / sold）。 */
export async function upsertInventoryTotals(db: Db, tenantId: string, productId: string, entries: readonly { date: string; total: number }[], now: Date): Promise<void> {
  if (entries.length === 0) return;
  await db.query(
    `insert into inventory_days (tenant_id, product_id, day, total, created_at, updated_at)
     select $1, $2, v.day, v.total, $5, $5 from unnest($3::date[], $4::int[]) as v(day, total)
     on conflict (tenant_id, product_id, day) where vehicle_group_id is null
     do update set total = excluded.total, updated_at = excluded.updated_at`,
    [tenantId, productId, entries.map((entry) => entry.date), entries.map((entry) => entry.total), now],
  );
}

/** 清除这些日期的库存（回到没设过）。只删没有占用的行——有占用的由调用方先拦下，这里的条件是第二道保险。 */
export async function clearInventoryDays(db: Db, tenantId: string, productId: string, dates: readonly string[]): Promise<void> {
  if (dates.length === 0) return;
  await db.query("delete from inventory_days where tenant_id = $1 and product_id = $2 and vehicle_group_id is null and day = any($3::date[]) and held = 0 and sold = 0", [tenantId, productId, dates]);
}

/** 从这一天起（含）还有剩余库存的日子有几天（上架校验的提醒用）。 */
export async function countSellableDays(db: Db, tenantId: string, productId: string, from: string): Promise<number> {
  const result = await db.query<{ n: number }>(
    "select count(*)::int as n from inventory_days where tenant_id = $1 and product_id = $2 and vehicle_group_id is null and day >= $3 and total - held - sold > 0",
    [tenantId, productId, from],
  );
  return result.rows[0]?.n ?? 0;
}
