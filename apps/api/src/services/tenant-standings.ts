/**
 * 报价引擎的 `TenantStandings`（ADR 0020 留给 M4-01 的接口）的实现：评分、近 90 天完成订单数、是否观察期，
 * 取自每日检查写在供应商主体上的最新结果（ADR 0028）。每次询价现查（不进商品目录的缓存），一条按主键的查询。
 *
 * - 评分给的是「按数据算出的分」（没有数据为 null）和完成订单数：完成不足 20 单的由引擎换成默认 4.5（`effectiveScoreCenti`）；
 * - 观察期：观察原因不为空（评分低于 4.0、近 30 天司机未到 2 次），排序价 ×1.05。
 */
import { DEFAULT_TENANT_STANDING, type TenantStanding } from "@nozomi/domain";
import type { TenantStandings } from "./quote-deps.ts";

export const DB_TENANT_STANDINGS: TenantStandings = {
  async load(db, tenantIds) {
    const standings = new Map<string, TenantStanding>(tenantIds.map((tenantId) => [tenantId, DEFAULT_TENANT_STANDING]));
    if (tenantIds.length === 0) return standings;
    const result = await db.query<{ id: string; score_raw_centi: number | null; score_completed_orders: number; observation: boolean }>(
      "select id, score_raw_centi, score_completed_orders, cardinality(observation_reasons) > 0 as observation from tenants where id = any($1::uuid[])",
      [[...tenantIds]],
    );
    for (const row of result.rows) standings.set(row.id, { scoreCenti: row.score_raw_centi, completedOrders: row.score_completed_orders, observation: row.observation });
    return standings;
  },
};
