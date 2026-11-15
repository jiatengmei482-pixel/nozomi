/**
 * 包车行程地图的折线缓存（M9P-20 P1，ADR 0096 第二节第 2 小节）：一个有序点列（domain 的 `itineraryPointsKey`）一行，保留 7 天。
 * 只在平台事务（withPlatformTx）里调用；平台表，租户角色没有权限。调用计数和路线预估共用 `route_api_usage`（repos/route-estimates.ts）。
 */
import type { Db } from "../db/context.ts";
import type { ItineraryLegMeasure } from "../integrations/google-itinerary-routes.ts";

export interface CachedItineraryRoute {
  polylines: string[];
  /** 逐段的里程和时长；谷歌没给时为 null */
  legs: ItineraryLegMeasure[] | null;
}

/** 查一组点的折线和逐段里程、时长；过期的当作没有。 */
export async function findItineraryPolylines(db: Db, key: string, now: Date): Promise<CachedItineraryRoute | null> {
  const result = await db.query<{ polylines: string[]; leg_meters: number[] | null; leg_seconds: number[] | null }>("select polylines, leg_meters, leg_seconds from itinerary_route_polylines where cache_key = $1 and expires_at > $2", [key, now]);
  const row = result.rows[0];
  if (row === undefined) return null;
  const seconds = row.leg_seconds;
  return { polylines: row.polylines, legs: row.leg_meters === null || seconds === null ? null : row.leg_meters.map((meters, i) => ({ meters, seconds: seconds[i] as number })) };
}

/** 写入（覆盖）一组点的折线和逐段里程、时长；顺手删掉一批已经过期的行（每次最多 100 行）。 */
export async function saveItineraryPolylines(db: Db, key: string, route: CachedItineraryRoute, fetchedAt: Date, expiresAt: Date): Promise<void> {
  await db.query(
    `insert into itinerary_route_polylines (cache_key, polylines, leg_meters, leg_seconds, fetched_at, expires_at) values ($1, $2, $3, $4, $5, $6)
     on conflict (cache_key) do update set polylines = excluded.polylines, leg_meters = excluded.leg_meters, leg_seconds = excluded.leg_seconds, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
    [key, route.polylines, route.legs?.map((leg) => leg.meters) ?? null, route.legs?.map((leg) => leg.seconds) ?? null, fetchedAt, expiresAt],
  );
  await db.query("delete from itinerary_route_polylines where ctid in (select ctid from itinerary_route_polylines where expires_at <= $1 limit 100)", [fetchedAt]);
}
