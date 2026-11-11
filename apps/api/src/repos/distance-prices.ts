/**
 * 计程价的读写（M8-30，ADR 0080）。租户表：只在租户事务里写，每条语句仍然显式带 tenant_id，行级安全再兜一层；
 * 报价在平台事务里按一批商品只读（`listDistancePricesOf`）。
 */
import type { DistancePrice } from "@nozomi/domain";
import type { Db } from "../db/context.ts";

type Row = Record<string, any>;

export interface StoredDistancePrice extends DistancePrice {
  id: string;
  productId: string;
  createdAt: Date;
  updatedAt: Date;
}

// 日期按文字取：驱动会把 date 换成带时区的时刻，再换回来可能差一天
const COLUMNS = "id, product_id, vehicle_group_id, start_minor, per_km_minor, valid_from::text as valid_from, valid_to::text as valid_to, status, created_at, updated_at";

function toDistancePrice(row: Row): StoredDistancePrice {
  return {
    id: row["id"],
    productId: row["product_id"],
    vehicleGroupId: row["vehicle_group_id"],
    startMinor: row["start_minor"],
    perKmMinor: row["per_km_minor"],
    validFrom: row["valid_from"],
    validTo: row["valid_to"],
    status: row["status"],
    createdAt: row["created_at"],
    updatedAt: row["updated_at"],
  };
}

/** 一个商品的全部计程价，按创建的先后。 */
export async function listDistancePrices(db: Db, tenantId: string, productId: string): Promise<StoredDistancePrice[]> {
  const result = await db.query<Row>(`select ${COLUMNS} from distance_prices where tenant_id = $1 and product_id = $2 order by created_at, id`, [tenantId, productId]);
  return result.rows.map(toDistancePrice);
}

/** 一批商品的计程价（报价取数用；租户编号带上才走得上索引）。 */
export async function listDistancePricesOf(db: Db, tenantIds: readonly string[], productIds: readonly string[]): Promise<StoredDistancePrice[]> {
  if (productIds.length === 0) return [];
  const result = await db.query<Row>(`select ${COLUMNS} from distance_prices where tenant_id = any($1::uuid[]) and product_id = any($2::uuid[]) order by product_id, created_at, id`, [tenantIds, productIds]);
  return result.rows.map(toDistancePrice);
}

export async function insertDistancePrice(db: Db, tenantId: string, productId: string, price: DistancePrice, now: Date): Promise<StoredDistancePrice> {
  const result = await db.query<Row>(
    `insert into distance_prices (tenant_id, product_id, vehicle_group_id, start_minor, per_km_minor, valid_from, valid_to, status, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) returning ${COLUMNS}`,
    [tenantId, productId, price.vehicleGroupId, price.startMinor, price.perKmMinor, price.validFrom, price.validTo, price.status, now],
  );
  return toDistancePrice(result.rows[0] as Row);
}

export async function updateDistancePrice(db: Db, tenantId: string, productId: string, id: string, price: DistancePrice, now: Date): Promise<StoredDistancePrice> {
  const result = await db.query<Row>(
    `update distance_prices set vehicle_group_id = $4, start_minor = $5, per_km_minor = $6, valid_from = $7, valid_to = $8, status = $9, updated_at = $10
      where tenant_id = $1 and product_id = $2 and id = $3 returning ${COLUMNS}`,
    [tenantId, productId, id, price.vehicleGroupId, price.startMinor, price.perKmMinor, price.validFrom, price.validTo, price.status, now],
  );
  return toDistancePrice(result.rows[0] as Row);
}

export async function deleteDistancePrice(db: Db, tenantId: string, productId: string, id: string): Promise<void> {
  await db.query("delete from distance_prices where tenant_id = $1 and product_id = $2 and id = $3", [tenantId, productId, id]);
}
