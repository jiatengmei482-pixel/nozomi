/**
 * 包车行程地图的折线缓存（M9P-20 P1，ADR 0096 第二节第 2 小节）：一个有序点列（domain 的 `itineraryPointsKey`）一行，保留 7 天。
 * 只在平台事务（withPlatformTx）里调用；平台表，租户角色没有权限。调用计数和路线预估共用 `route_api_usage`（repos/route-estimates.ts）。
 */
import type { Db } from "../db/context.ts";

/** 查一组点的折线；过期的当作没有。 */
export async function findItineraryPolylines(db: Db, key: string, now: Date): Promise<string[] | null> {
  const result = await db.query<{ polylines: string[] }>("select polylines from itinerary_route_polylines where cache_key = $1 and expires_at > $2", [key, now]);
  return result.rows[0]?.polylines ?? null;
}

/** 写入（覆盖）一组点的折线；顺手删掉一批已经过期的行（每次最多 100 行）。 */
export async function saveItineraryPolylines(db: Db, key: string, polylines: readonly string[], fetchedAt: Date, expiresAt: Date): Promise<void> {
  await db.query(
    `insert into itinerary_route_polylines (cache_key, polylines, fetched_at, expires_at) values ($1, $2, $3, $4)
     on conflict (cache_key) do update set polylines = excluded.polylines, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
    [key, polylines, fetchedAt, expiresAt],
  );
  await db.query("delete from itinerary_route_polylines where ctid in (select ctid from itinerary_route_polylines where expires_at <= $1 limit 100)", [fetchedAt]);
}
