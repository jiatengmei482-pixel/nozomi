/**
 * 机场导入（验收标准「机场坐标从公开数据源导入并注明来源」）。命令行入口是 cli/masterdata-import-airports.ts。
 *
 * 挑哪些机场、和库里的怎么比，是 @nozomi/domain 里的纯函数；这里只负责读库、按计划写库、写审计日志。
 * 整次导入在一个平台事务里：要么全部写入，要么什么都不变。
 * 新导入的机场是停用的、没有所属城市——数据源不保证准确，也不知道平台怎么划分城市，要由平台指定城市后再启用。
 */
import { type AirportImportPlan, type AirportSelection, OURAIRPORTS, planAirportImport } from "@nozomi/domain";
import { isUniqueViolation, withPlatformTx } from "../db/context.ts";
import type { Pool } from "../db/pool.ts";
import { MasterImportError, type MasterImportErrorCode } from "./import-errors.ts";
import { type AuditOrigin, insertAuditLog } from "../repos/audit-logs.ts";
import {
  PLACES,
  insertMasterRow,
  listAllAirports,
  markAirportsSynced,
  tryLockAirportImport,
  updateMasterRowAtVersion,
} from "../repos/master-data.ts";

export type AirportImportErrorCode = MasterImportErrorCode;

/** 机场导入没有进行（或整体回滚了）、换个时间再运行即可的情况。 */
export class AirportImportError extends MasterImportError {}

export interface AirportImportOptions {
  /** 只算出要做什么，不写库 */
  dryRun: boolean;
}

/**
 * 并发：
 * - 同一时间只允许一次导入（咨询锁，事务结束自动释放）；后到的那次立即报「另一个导入正在运行」。试运行不写库，不需要锁。
 * - 导入读完机场之后、写入之前，平台可能在后台改了同一个机场。所以每次更新都核对版本号：
 *   版本变了说明有人改过，这条就不覆盖，列进「需要人工处理」，下次导入会按最新的内容重新比较。
 */
export async function importAirports(
  pool: Pool,
  selection: AirportSelection,
  now: Date,
  options: AirportImportOptions,
): Promise<AirportImportPlan> {
  try {
    return await runImport(pool, selection, now, options);
  } catch (err) {
    if (isUniqueViolation(err, PLACES.codeConstraint)) {
      throw new AirportImportError("IMPORT_CODE_CONFLICT", "导入期间有人在后台新增了三字码相同的机场。数据库没有任何变化，请再运行一次");
    }
    throw err;
  }
}

function runImport(pool: Pool, selection: AirportSelection, now: Date, options: AirportImportOptions): Promise<AirportImportPlan> {
  const origin: AuditOrigin = { occurredAt: now, actor: { type: "system", id: null, email: null }, ip: null, source: "cli" };
  return withPlatformTx(pool, async (db) => {
    if (!options.dryRun && !(await tryLockAirportImport(db))) {
      throw new AirportImportError("IMPORT_ALREADY_RUNNING", "另一个机场导入正在运行。数据库没有任何变化，请等它结束后再试");
    }
    const existing = await listAllAirports(db);
    const plan = planAirportImport(
      existing.map((place) => ({
        id: place.id,
        code: place.code,
        countryCode: place.countryCode,
        nameEn: place.name.en ?? null,
        lng: place.lng,
        lat: place.lat,
        sourceRef: place.source === OURAIRPORTS.source ? place.sourceRef : null,
        sourceOverridden: place.sourceOverridden,
      })),
      selection,
    );
    if (options.dryRun) return plan;

    for (const airport of plan.creates) {
      const created = await insertMasterRow(
        db,
        PLACES,
        {
          type: "airport",
          code: airport.iata,
          country_code: airport.countryCode,
          name: { en: airport.name },
          lng: airport.lng,
          lat: airport.lat,
          source: OURAIRPORTS.source,
          source_ref: airport.sourceRef,
          source_synced_at: now,
        },
        "disabled",
        now,
      );
      await insertAuditLog(db, origin, {
        tenantId: null,
        resource: "place",
        resourceId: created.id,
        action: "create",
        before: null,
        after: {
          type: "airport",
          code: created.code,
          country_code: created.countryCode,
          name: created.name,
          lng: created.lng,
          lat: created.lat,
          source: OURAIRPORTS.source,
          source_ref: airport.sourceRef,
          status: created.status,
        },
      });
    }

    const byId = new Map(existing.map((place) => [place.id, place]));
    const applied: typeof plan.updates = [];
    for (const update of plan.updates) {
      const current = byId.get(update.id);
      if (!current) continue;
      const name = { ...current.name, en: update.after.nameEn };
      const written = await updateMasterRowAtVersion(
        db,
        PLACES,
        update.id,
        current.version,
        { name, lng: update.after.lng, lat: update.after.lat },
        current.status,
        now,
      );
      if (!written) {
        plan.conflicts.push({ iata: update.code, reason: "导入期间平台在后台改了这个机场，没有覆盖；需要的话请再运行一次导入" });
        continue;
      }
      applied.push(update);
      await insertAuditLog(db, origin, {
        tenantId: null,
        resource: "place",
        resourceId: update.id,
        action: "update",
        before: { name: current.name, lng: update.before.lng, lat: update.before.lat },
        after: { name, lng: update.after.lng, lat: update.after.lat, source: OURAIRPORTS.source },
      });
    }

    plan.updates = applied;
    const checked = new Set([...plan.unchanged, ...plan.keptManual, ...plan.updates.map((update) => update.code)]);
    const refs = existing.flatMap((place) => (checked.has(place.code) && place.sourceRef !== null ? [place.sourceRef] : []));
    if (refs.length > 0) await markAirportsSynced(db, OURAIRPORTS.source, refs, now);
    return plan;
  });
}
