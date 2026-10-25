/**
 * 运营后台首页的统计（M1-08）：按模块分组的数量。以后别的模块（渠道、订单、工单……）往 `DashboardSummary` 里加一组即可。
 *
 * 任何已登录的平台员工都能调；但每个模块只给有权看这个模块的角色（没有 `tenant.read` 的角色拿到的租户一组是 null），
 * 首页不会成为绕过权限看数量的口子。全部在一个事务里数，各组数字是同一时刻的。
 */
import { type CurrencyCode, type FxFetchStatus, type FxTableState, type MasterDataStatus, PLACE_TYPES, type PlaceType, type PlatformRole, fxStaleAt, fxTableState, platformRoleCan } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { withPlatformTx } from "../db/context.ts";
import { countAirportsWithoutCity, countMasterByStatus, countPlacesByTypeAndStatus, countTenantsByStatus } from "../repos/dashboard.ts";
import { activeFxLocks } from "../repos/fx-locks.ts";
import { latestFetch, latestRateSet, pendingHeldFetches } from "../repos/fx.ts";

export interface StatusCounts {
  total: number;
  active: number;
  disabled: number;
}

export interface DashboardSummary {
  tenants: { total: number; active: number; suspended: number } | null;
  masterData: {
    cities: StatusCounts;
    places: StatusCounts & { byType: Record<PlaceType, StatusCounts>; airportsWithoutCity: number };
    vehicleGroups: StatusCounts;
    addons: StatusCounts;
  } | null;
  /** 汇率中心（M2-03）：过期、挂起待确认要在首页醒目提醒。和主数据同一个权限 */
  fx: {
    state: FxTableState;
    asOf: Date | null;
    staleAt: Date | null;
    /** 有挂起、等人确认的一批 */
    held: boolean;
    lastAttemptStatus: FxFetchStatus | null;
    /** 生效中的人工锁定（M2-06）：首页卡片上提示哪些币种锁定到什么时候 */
    locks: { currency: CurrencyCode; rate: string; expiresAt: Date }[];
  } | null;
}

/** 把「状态 → 数量」的若干行合成一组；没有出现的状态是 0。 */
export function statusCounts(rows: readonly { status: MasterDataStatus; count: number }[]): StatusCounts {
  const of = (status: MasterDataStatus): number => rows.filter((row) => row.status === status).reduce((sum, row) => sum + row.count, 0);
  const active = of("active");
  const disabled = of("disabled");
  return { total: active + disabled, active, disabled };
}

export function getDashboardSummary(ctx: AppContext, role: PlatformRole): Promise<DashboardSummary> {
  return withPlatformTx(ctx.pool, async (db) => {
    let tenants: DashboardSummary["tenants"] = null;
    if (platformRoleCan(role, "tenant.read")) {
      const rows = await countTenantsByStatus(db);
      const of = (status: string): number => rows.find((row) => row.status === status)?.count ?? 0;
      tenants = { total: of("active") + of("suspended"), active: of("active"), suspended: of("suspended") };
    }
    let masterData: DashboardSummary["masterData"] = null;
    if (platformRoleCan(role, "master_data.read")) {
      const places = await countPlacesByTypeAndStatus(db);
      const byType = Object.fromEntries(
        PLACE_TYPES.map((type) => [type, statusCounts(places.filter((row) => row.type === type))]),
      ) as Record<PlaceType, StatusCounts>;
      masterData = {
        cities: statusCounts(await countMasterByStatus(db, "cities")),
        places: { ...statusCounts(places), byType, airportsWithoutCity: await countAirportsWithoutCity(db) },
        vehicleGroups: statusCounts(await countMasterByStatus(db, "vehicle_groups")),
        addons: statusCounts(await countMasterByStatus(db, "addons")),
      };
    }
    let fx: DashboardSummary["fx"] = null;
    if (platformRoleCan(role, "master_data.read")) {
      const current = await latestRateSet(db);
      const asOf = current?.asOf.toISOString() ?? null;
      const last = await latestFetch(db);
      fx = {
        state: fxTableState(asOf, ctx.now()),
        asOf: current?.asOf ?? null,
        staleAt: asOf === null ? null : fxStaleAt(asOf),
        held: (await pendingHeldFetches(db, current?.asOf ?? null)).length > 0,
        lastAttemptStatus: last?.status ?? null,
        locks: (await activeFxLocks(db, ctx.now())).map((lock) => ({ currency: lock.currency, rate: lock.rate, expiresAt: lock.expiresAt })),
      };
    }
    return { tenants, masterData, fx };
  });
}
