/**
 * 运营后台首页的数量统计（M1-08）。只数数量，不取任何明细。只在平台事务（withPlatformTx）里调用。
 */
import type { MasterDataStatus, PlaceType } from "@nozomi/domain";
import type { Db } from "../db/context.ts";
import type { TenantStatus } from "./tenants.ts";

export async function countTenantsByStatus(db: Db): Promise<{ status: TenantStatus; count: number }[]> {
  const result = await db.query<{ status: TenantStatus; count: number }>("select status, count(*)::int as count from tenants group by status");
  return result.rows;
}

export type MasterCountTable = "cities" | "vehicle_groups" | "addons";

export async function countMasterByStatus(db: Db, table: MasterCountTable): Promise<{ status: MasterDataStatus; count: number }[]> {
  const result = await db.query<{ status: MasterDataStatus; count: number }>(`select status, count(*)::int as count from ${table} group by status`);
  return result.rows;
}

export async function countPlacesByTypeAndStatus(db: Db): Promise<{ type: PlaceType; status: MasterDataStatus; count: number }[]> {
  const result = await db.query<{ type: PlaceType; status: MasterDataStatus; count: number }>(
    "select type, status, count(*)::int as count from places group by type, status",
  );
  return result.rows;
}

/** 导入之后还没有指定所属城市的机场数量（等平台复核）。 */
export async function countAirportsWithoutCity(db: Db): Promise<number> {
  const result = await db.query<{ count: number }>("select count(*)::int as count from places where type = 'airport' and city_id is null");
  return result.rows[0]?.count ?? 0;
}
