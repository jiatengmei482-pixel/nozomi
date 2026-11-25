/**
 * 机场名称核对表写入（M12-06）。命令行入口是 cli/masterdata-import-airport-names-reviewed.ts。
 * 做法和 GeoNames 名称导入（airport-name-import.ts）一样：算计划是 @nozomi/domain 的纯函数（reviewed-airport-names.ts），
 * 这里只负责读库、按计划写库、写审计日志；整次在一个平台事务里；和 GeoNames 名称导入共用同一把咨询锁，两者不会同时写；
 * 每次写入核对版本号，运行期间平台在后台改过的机场不覆盖。不动搜索别名。
 */
import { type ReviewedAirportName, type ReviewedAirportNamePlan, REVIEWED_AIRPORT_NAMES_SOURCE, planReviewedAirportNames } from "@nozomi/domain";
import { withPlatformTx } from "../db/context.ts";
import type { Pool } from "../db/pool.ts";
import { type AuditOrigin, insertAuditLog } from "../repos/audit-logs.ts";
import { PLACES, listAirportSearchNames, listAllAirports, tryLockAirportNameImport, updateMasterRowAtVersion } from "../repos/master-data.ts";
import { airportNameImportRunning } from "./airport-name-import.ts";

export interface ReviewedAirportNameOptions {
  countries: readonly string[];
  dryRun: boolean;
}

export function importReviewedAirportNames(pool: Pool, entries: readonly ReviewedAirportName[], now: Date, options: ReviewedAirportNameOptions): Promise<ReviewedAirportNamePlan> {
  const origin: AuditOrigin = { occurredAt: now, actor: { type: "system", id: null, email: null }, ip: null, source: "cli" };
  return withPlatformTx(pool, async (db) => {
    if (!options.dryRun && !(await tryLockAirportNameImport(db))) {
      throw airportNameImportRunning();
    }
    const existing = await listAllAirports(db);
    const searchNames = await listAirportSearchNames(db);
    const plan = planReviewedAirportNames(
      existing.map((place) => ({ id: place.id, code: place.code, countryCode: place.countryCode, name: place.name, lat: place.lat, lng: place.lng, nameSources: place.nameSources, searchNames: searchNames.get(place.id) ?? [] })),
      entries,
      options.countries,
    );
    if (options.dryRun) return plan;

    const byId = new Map(existing.map((place) => [place.id, place]));
    const applied: typeof plan.fills = [];
    for (const fill of plan.fills) {
      const current = byId.get(fill.id);
      if (!current) continue;
      const written = await updateMasterRowAtVersion(db, PLACES, fill.id, current.version, { name: fill.after, name_sources: fill.nameSources }, current.status, now);
      if (!written) {
        plan.conflicts.push({ code: fill.code, problem: "CHANGED_DURING_IMPORT" });
        continue;
      }
      applied.push(fill);
      await insertAuditLog(db, origin, {
        tenantId: null,
        resource: "place",
        resourceId: fill.id,
        action: "update",
        before: { name: fill.before },
        after: { name: fill.after, name_source: { source: REVIEWED_AIRPORT_NAMES_SOURCE, refs: fill.refs, languages: fill.languages } },
      });
    }
    plan.fills = applied;
    return plan;
  });
}
