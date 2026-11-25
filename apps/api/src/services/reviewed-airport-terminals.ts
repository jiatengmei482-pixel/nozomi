/**
 * 航站楼核对表写入（M12-06）。命令行入口是 cli/masterdata-import-airport-terminals-reviewed.ts。
 * 算计划是 @nozomi/domain 的纯函数（reviewed-airport-terminals.ts），这里只负责读库、按计划写库、写审计日志：
 * - 整次在一个平台事务里，失败则什么都不变；同一时间只允许一次（咨询锁）。
 * - 给已有的机场 / 航站楼填空着的项时核对版本号：运行期间平台在后台改过的不覆盖，列为需要人工处理。
 * - 新建航站楼和填写都写审计日志（操作者「系统」、入口「命令行」），记下每一项的来源。
 */
import {
  type ExistingPlaceContent,
  REVIEWED_AIRPORT_TERMINALS_SOURCE,
  type ReviewedAirportTerminals,
  type ReviewedTerminalPlan,
  type TerminalNameSources,
  planReviewedAirportTerminals,
  placeContentText,
} from "@nozomi/domain";
import { isUniqueViolation, withPlatformTx } from "../db/context.ts";
import type { Pool } from "../db/pool.ts";
import { type AuditOrigin, type AuditValues, insertAuditLog } from "../repos/audit-logs.ts";
import { PLACES, type Place, insertMasterRow, listAllAirports, listAllTerminals, tryLockAirportTerminalImport, updateMasterRowAtVersion } from "../repos/master-data.ts";
import { MasterImportError } from "./import-errors.ts";

/** 航站楼核对表导入没有进行（或整体回滚了）、换个时间再运行即可的情况。 */
export class AirportTerminalImportError extends MasterImportError {}

export interface ReviewedAirportTerminalOptions {
  countries: readonly string[];
  dryRun: boolean;
}

function existing(place: Place): ExistingPlaceContent {
  return {
    id: place.id,
    code: place.code,
    countryCode: place.countryCode,
    parentId: place.parentId,
    cityId: place.cityId,
    status: place.status,
    lat: place.lat,
    lng: place.lng,
    name: place.name,
    nameSources: place.nameSources as TerminalNameSources,
    address: place.address,
    meetingPoint: place.meetingPoint,
    contentSources: place.contentSources as ExistingPlaceContent["contentSources"],
  };
}

export async function importReviewedAirportTerminals(pool: Pool, entries: readonly ReviewedAirportTerminals[], now: Date, options: ReviewedAirportTerminalOptions): Promise<ReviewedTerminalPlan> {
  try {
    return await runImport(pool, entries, now, options);
  } catch (err) {
    if (isUniqueViolation(err, PLACES.codeConstraint)) {
      throw new AirportTerminalImportError("IMPORT_CODE_CONFLICT", placeContentText("terminalImportCodeConflict"));
    }
    throw err;
  }
}

function runImport(pool: Pool, entries: readonly ReviewedAirportTerminals[], now: Date, options: ReviewedAirportTerminalOptions): Promise<ReviewedTerminalPlan> {
  const origin: AuditOrigin = { occurredAt: now, actor: { type: "system", id: null, email: null }, ip: null, source: "cli" };
  return withPlatformTx(pool, async (db) => {
    if (!options.dryRun && !(await tryLockAirportTerminalImport(db))) {
      throw new AirportTerminalImportError("IMPORT_ALREADY_RUNNING", placeContentText("terminalImportRunning"));
    }
    const airports = await listAllAirports(db);
    const terminals = await listAllTerminals(db);
    const plan = planReviewedAirportTerminals(airports.map(existing), terminals.map(existing), entries, options.countries);
    if (options.dryRun) return plan;

    const byId = new Map([...airports, ...terminals].map((place) => [place.id, place]));
    const applied: typeof plan.fills = [];
    for (const fill of plan.fills) {
      const current = byId.get(fill.id);
      if (!current) continue;
      const written = await updateMasterRowAtVersion(db, PLACES, fill.id, current.version, fill.values, current.status, now);
      if (!written) {
        plan.conflicts.push({ code: fill.code, problem: "CHANGED_DURING_IMPORT" });
        continue;
      }
      applied.push(fill);
      const { name_sources: _names, content_sources: _contents, ...after } = fill.values;
      await insertAuditLog(db, origin, {
        tenantId: null,
        resource: "place",
        resourceId: fill.id,
        action: "update",
        before: fill.before as AuditValues,
        after: { ...(after as AuditValues), fill_source: { source: REVIEWED_AIRPORT_TERMINALS_SOURCE, refs: fill.refs, fields: fill.fields } },
      });
    }
    plan.fills = applied;

    for (const create of plan.creates) {
      const created = await insertMasterRow(
        db,
        PLACES,
        {
          type: "terminal",
          code: create.code,
          country_code: create.countryCode,
          city_id: create.cityId,
          parent_id: create.airportId,
          name: create.name,
          lng: create.lng,
          lat: create.lat,
          flight_scope: create.flightScope,
          address: create.address,
          meeting_point: create.meetingPoint,
          name_sources: create.nameSources,
          content_sources: create.contentSources,
        },
        create.status,
        now,
      );
      await insertAuditLog(db, origin, {
        tenantId: null,
        resource: "place",
        resourceId: created.id,
        action: "create",
        before: null,
        after: {
          type: created.type,
          code: created.code,
          country_code: created.countryCode,
          city_id: created.cityId,
          parent_id: created.parentId,
          name: created.name,
          lng: created.lng,
          lat: created.lat,
          flight_scope: created.flightScope,
          address: created.address,
          meeting_point: created.meetingPoint,
          status: created.status,
          fill_source: { source: REVIEWED_AIRPORT_TERMINALS_SOURCE, refs: create.refs, distance_m: create.distanceMeters },
        },
      });
    }
    return plan;
  });
}
