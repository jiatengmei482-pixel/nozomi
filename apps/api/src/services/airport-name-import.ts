/**
 * 机场的中文名、日文名从 GeoNames 导入（M1-15，ADR 0024）。命令行入口是 cli/masterdata-import-airport-names.ts。
 * 做法和机场导入、城市导入一样：
 *
 * - 挑哪些名称、给哪个机场填哪种语言，是 @nozomi/domain 里的纯函数（geonames-airports.ts）；这里只负责读库、按计划写库、写审计日志。
 * - 整次导入在一个平台事务里：要么全部写入，要么什么都不变。
 * - 同一时间只允许一次机场名称导入（咨询锁）；试运行不写库，不需要锁。
 * - 每次写入都核对版本号：导入运行期间平台在后台改过的机场不覆盖，列进「需要人工处理」。
 * - 填名称是一次真正的修改：版本号加一、更新时间改为现在、写审计日志（操作者「系统」，入口「命令行」）。
 *   不改机场的启用状态，也不动 OurAirports 那一套来源标记（source / source_overridden）。
 */
import { type AirportNamePlan, type AirportNameSelection, GEONAMES, planAirportNameImport } from "@nozomi/domain";
import { withPlatformTx } from "../db/context.ts";
import type { Pool } from "../db/pool.ts";
import { type AuditOrigin, insertAuditLog } from "../repos/audit-logs.ts";
import { PLACES, listAllAirports, tryLockAirportNameImport, updateMasterRowAtVersion } from "../repos/master-data.ts";
import { MasterImportError } from "./import-errors.ts";

/** 机场名称导入没有进行（或整体回滚了）、换个时间再运行即可的情况。 */
export class AirportNameImportError extends MasterImportError {}

export interface AirportNameImportOptions {
  /** 只看这些国家的机场 */
  countries: readonly string[];
  /** 只算出要做什么，不写库 */
  dryRun: boolean;
}

export function importAirportNames(pool: Pool, selection: AirportNameSelection, now: Date, options: AirportNameImportOptions): Promise<AirportNamePlan> {
  const origin: AuditOrigin = { occurredAt: now, actor: { type: "system", id: null, email: null }, ip: null, source: "cli" };
  return withPlatformTx(pool, async (db) => {
    if (!options.dryRun && !(await tryLockAirportNameImport(db))) {
      throw new AirportNameImportError("IMPORT_ALREADY_RUNNING", "另一个机场名称导入正在运行。数据库没有任何变化，请等它结束后再试");
    }
    const existing = await listAllAirports(db);
    const plan = planAirportNameImport(
      existing.map((place) => ({ id: place.id, code: place.code, countryCode: place.countryCode, name: place.name, lat: place.lat, lng: place.lng, nameSources: place.nameSources })),
      selection,
      options.countries,
      GEONAMES.source,
    );
    if (options.dryRun) return plan;

    const byId = new Map(existing.map((place) => [place.id, place]));
    const applied: typeof plan.fills = [];
    for (const fill of plan.fills) {
      const current = byId.get(fill.id);
      if (!current) continue;
      const written = await updateMasterRowAtVersion(db, PLACES, fill.id, current.version, { name: fill.after, name_sources: fill.nameSources }, current.status, now);
      if (!written) {
        plan.conflicts.push({ code: fill.code, reason: "导入期间平台在后台改了这个机场，没有填；需要的话请再运行一次导入" });
        continue;
      }
      applied.push(fill);
      await insertAuditLog(db, origin, {
        tenantId: null,
        resource: "place",
        resourceId: fill.id,
        action: "update",
        before: { name: fill.before },
        after: { name: fill.after, name_source: { source: GEONAMES.source, source_ref: fill.sourceRef, languages: fill.languages } },
      });
    }
    plan.fills = applied;
    return plan;
  });
}
