/**
 * 城市导入（M1-09 验收标准「主要城市从注明来源和许可的公开数据导入，可重复运行，不覆盖人工修改」）。
 * 命令行入口是 cli/masterdata-import-cities.ts。做法和机场导入（airport-import.ts）完全一样：
 *
 * - 挑哪些城市、和库里的怎么比，是 @nozomi/domain 里的纯函数；这里只负责读库、按计划写库、写审计日志。
 * - 整次导入在一个平台事务里：要么全部写入，要么什么都不变。
 * - 同一时间只允许一次城市导入（咨询锁）；试运行不写库，不需要锁。
 * - 每次更新都核对版本号：导入运行期间平台在后台改过的城市不覆盖，列进「需要人工处理」。
 * - 新导入的城市默认是停用的（数据源不保证准确，等平台复核）；`activate` 为真时直接启用，审计日志里记明。
 *   `activate` 只影响这次新增的城市：以前导入的、被人停用的城市不会被它重新启用。
 */
import { type CityImportPlan, type CitySelection, GEONAMES, planCityImport } from "@nozomi/domain";
import { isUniqueViolation, withPlatformTx } from "../db/context.ts";
import type { Pool } from "../db/pool.ts";
import { type AuditOrigin, insertAuditLog } from "../repos/audit-logs.ts";
import { CITIES, insertMasterRow, isKnownTimeZone, listAllCities, markCitiesSynced, setCityPopulations, tryLockCityImport, updateMasterRowAtVersion } from "../repos/master-data.ts";
import { MasterImportError } from "./import-errors.ts";

/** 城市导入没有进行（或整体回滚了）、换个时间再运行即可的情况。 */
export class CityImportError extends MasterImportError {}

export interface CityImportOptions {
  /** 只算出要做什么，不写库 */
  dryRun: boolean;
  /** 新增的城市直接启用（不带时是停用，等平台复核） */
  activate: boolean;
}

export interface CityImportResult extends CityImportPlan {
  /** 时区不在数据库的时区名单里而没有导入的城市 */
  unknownTimeZones: { label: string; timezone: string }[];
  /** 人口和数据源不一样（多半是以前导入时还没存人口）而回填的城市个数；不算修改，不动版本号和「平台改过」 */
  populationBackfilled: number;
}

export async function importCities(pool: Pool, selection: CitySelection, now: Date, options: CityImportOptions): Promise<CityImportResult> {
  try {
    return await runImport(pool, selection, now, options);
  } catch (err) {
    if (isUniqueViolation(err, CITIES.codeConstraint)) {
      throw new CityImportError("IMPORT_CODE_CONFLICT", "导入期间有人在后台新增了编码相同的城市。数据库没有任何变化，请再运行一次");
    }
    throw err;
  }
}

function runImport(pool: Pool, selection: CitySelection, now: Date, options: CityImportOptions): Promise<CityImportResult> {
  const origin: AuditOrigin = { occurredAt: now, actor: { type: "system", id: null, email: null }, ip: null, source: "cli" };
  return withPlatformTx(pool, async (db) => {
    if (!options.dryRun && !(await tryLockCityImport(db))) {
      throw new CityImportError("IMPORT_ALREADY_RUNNING", "另一个城市导入正在运行。数据库没有任何变化，请等它结束后再试");
    }
    // 时区要和数据库的时区名单逐字核对（和后台新增城市同一条规则）：数据库不认识的时区，这个城市不导入
    const known = new Map<string, boolean>();
    for (const timezone of new Set(selection.cities.map((city) => city.timezone))) known.set(timezone, await isKnownTimeZone(db, timezone));
    const unknownTimeZones = selection.cities
      .filter((city) => known.get(city.timezone) !== true)
      .map((city) => ({ label: `${city.name.en ?? city.code}（${city.code}）`, timezone: city.timezone }));
    const usable = { ...selection, cities: selection.cities.filter((city) => known.get(city.timezone) === true) };

    const existing = await listAllCities(db);
    const plan = planCityImport(
      existing.map((city) => ({
        id: city.id,
        code: city.code,
        countryCode: city.countryCode,
        name: city.name,
        timezone: city.timezone,
        lng: city.centerLng,
        lat: city.centerLat,
        sourceRef: city.source === GEONAMES.source ? city.sourceRef : null,
        sourceOverridden: city.sourceOverridden,
      })),
      usable,
    );
    // 人口只用来给机场排建议的城市：按数据源编号回填到已有的城市上，平台改过的城市也回填（它改的是名称、时区、坐标）
    const populationByRef = new Map(usable.cities.map((city) => [city.sourceRef, city.population]));
    const stale = existing.filter((city) => city.source === GEONAMES.source && city.sourceRef !== null && populationByRef.has(city.sourceRef) && populationByRef.get(city.sourceRef) !== city.population);
    if (options.dryRun) return { ...plan, unknownTimeZones, populationBackfilled: stale.length };

    const status = options.activate ? "active" : "disabled";
    for (const city of plan.creates) {
      const created = await insertMasterRow(
        db,
        CITIES,
        {
          code: city.code,
          country_code: city.countryCode,
          name: city.name,
          timezone: city.timezone,
          center_lng: city.lng,
          center_lat: city.lat,
          source: GEONAMES.source,
          source_ref: city.sourceRef,
          source_synced_at: now,
          population: city.population,
        },
        status,
        now,
      );
      await insertAuditLog(db, origin, {
        tenantId: null,
        resource: "city",
        resourceId: created.id,
        action: "create",
        before: null,
        after: {
          code: created.code,
          country_code: created.countryCode,
          name: created.name,
          timezone: created.timezone,
          center_lng: created.centerLng,
          center_lat: created.centerLat,
          source: GEONAMES.source,
          source_ref: city.sourceRef,
          status: created.status,
          ...(options.activate ? { activated_on_import: true } : {}),
        },
      });
    }

    const byId = new Map(existing.map((city) => [city.id, city]));
    const applied: typeof plan.updates = [];
    for (const update of plan.updates) {
      const current = byId.get(update.id);
      if (!current) continue;
      const values = { name: update.after.name, timezone: update.after.timezone, center_lng: update.after.lng, center_lat: update.after.lat };
      const written = await updateMasterRowAtVersion(db, CITIES, update.id, current.version, values, current.status, now);
      if (!written) {
        plan.conflicts.push({ label: update.code, reason: "导入期间平台在后台改了这个城市，没有覆盖；需要的话请再运行一次导入" });
        continue;
      }
      applied.push(update);
      await insertAuditLog(db, origin, {
        tenantId: null,
        resource: "city",
        resourceId: update.id,
        action: "update",
        before: { name: update.before.name, timezone: update.before.timezone, center_lng: update.before.lng, center_lat: update.before.lat },
        after: { ...values, source: GEONAMES.source },
      });
    }
    plan.updates = applied;

    const checked = new Set([...plan.unchanged, ...plan.keptManual, ...plan.updates.map((update) => update.code)]);
    const refs = existing.flatMap((city) => (checked.has(city.code) && city.source === GEONAMES.source && city.sourceRef !== null ? [city.sourceRef] : []));
    if (refs.length > 0) await markCitiesSynced(db, GEONAMES.source, refs, now);
    const populationBackfilled = await setCityPopulations(
      db,
      GEONAMES.source,
      stale.flatMap((city) => (city.sourceRef === null ? [] : [{ sourceRef: city.sourceRef, population: populationByRef.get(city.sourceRef) ?? 0 }])),
    );
    return { ...plan, unknownTimeZones, populationBackfilled };
  });
}
