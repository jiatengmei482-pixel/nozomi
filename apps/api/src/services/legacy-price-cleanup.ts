/**
 * 包车三层的旧价格数据清理（M9P-12，ADR 0093 第五节「验证通过后另开 M9P-12 清理」；业主 2026-11-18 同意，只在测试环境执行）。
 *
 * 只动**迁移过三层**（`products.charter_layout = 'three_layer'`）的包车商品；没迁移过的商品（正式站全部是）一条不碰。
 * 用迁移账号（表的所有者）在一个事务里做完，`dry-run` 算完回滚、`apply` 提交：
 * 1. 备份：每条要删 / 要改的价格规则的整行存进 `legacy_price_cleanup_backups`（本次的 run_id）；
 * 2. 删掉按服务区域的旧套餐价（`charter_package` 且 `area_id` 不为空）：迁移过的商品报价只用整商品套餐价（`packageHoursFor`），这些行只读、不参与报价；
 * 3. ③上下车加价行（`charter_area_surcharge`）去掉途经加价（`params` 里的 `waypointSurchargeMinor`），整行保留：
 *    迁移过的商品经停、下车点行程加价只看②（`selectSurchargeRule` 的 `threeLayer`），这一项不参与报价；上 / 下车加价照旧。
 * 每个改动过的商品版本号加一（后台价格页按版本号刷新），每条规则写一条审计（操作人是系统、来源是命令行）。
 *
 * 报价不变：两类数据迁移过的商品报价本来就不读（回放应 0 变化）。会变的只有不是报价的两处，计数里单列：
 * - 官网包车「可选时长」按启用的套餐价规则列（`listBookableCharterPackages`）：只有旧行有、整商品没有的时长不再列出（这些时长本来就报不出）；
 * - 迁移不能再靠旧行回退（ADR 0093「迁移可以回退」）：要回退得从备份表恢复。
 * 「只有途经加价、上下车加价都是 0」的③行去掉途经加价后，上 / 下车点落在这里仍按 0 加价匹配（和现在一样），计数里列出来交运营看要不要删整行。
 */
import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "../db/pool.ts";
import { type AuditValues, insertAuditLog } from "../repos/audit-logs.ts";

export type LegacyPriceCleanupMode = "dry-run" | "apply";

type Row = Record<string, any>;

/** 日期按文本取（不经 JS 的 Date，免得时区挪一天） */
const RULE_COLUMNS = "id, product_id, area_id, vehicle_group_id, package_hours, pricing_model, params, valid_from::text as valid_from, valid_to::text as valid_to, status";

export interface LegacyPriceCleanupCounts {
  /** 迁移过三层的包车商品 */
  migratedProducts: number;
  /** 没迁移过的包车商品（不动） */
  untouchedProducts: number;
  /** 有改动的商品 */
  changedProducts: number;
  /** 删掉的按服务区域旧套餐价 */
  areaPackagesDeleted: number;
  /** 去掉途经加价的③行 */
  waypointsStripped: number;
  /** 其中上下车加价都是 0 的③行（去掉途经加价后仍按 0 匹配上 / 下车点，交运营看） */
  zeroUpdownRows: number;
  /** 只有旧行有、整商品套餐价没有的「车型组 × 时长」（启用的）：官网可选时长里不再出现 */
  hoursOnlyInLegacy: number;
}

export interface LegacyPriceCleanupReport {
  mode: LegacyPriceCleanupMode;
  runId: string;
  counts: LegacyPriceCleanupCounts;
  /** 每一处改动：只有编号和动作，不带金额（标准输出也不打它们） */
  changes: { action: "delete_area_package" | "strip_waypoint"; tenantId: string; productId: string; priceRuleId: string }[];
}

export async function runLegacyPriceCleanup(pool: Pool, options: { mode: LegacyPriceCleanupMode; now: Date }): Promise<LegacyPriceCleanupReport> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const report = await cleanup(client, options.mode, options.now);
    await client.query(options.mode === "apply" ? "commit" : "rollback");
    return report;
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function cleanup(db: PoolClient, mode: LegacyPriceCleanupMode, now: Date): Promise<LegacyPriceCleanupReport> {
  const runId = randomUUID();
  // 锁住所有包车商品行：清理期间供应商改不了这些商品的价格（价格保存同样先锁商品行）
  const products = await db.query<Row>("select id, tenant_id, version, charter_layout from products where category = 'charter' order by tenant_id, id for update");
  const migrated = products.rows.filter((row) => row["charter_layout"] === "three_layer");
  const counts: LegacyPriceCleanupCounts = { migratedProducts: migrated.length, untouchedProducts: products.rows.length - migrated.length, changedProducts: 0, areaPackagesDeleted: 0, waypointsStripped: 0, zeroUpdownRows: 0, hoursOnlyInLegacy: 0 };
  const changes: LegacyPriceCleanupReport["changes"] = [];
  const origin = { occurredAt: now, actor: { type: "system" as const, id: null, email: null }, ip: null, source: "cli" as const };

  for (const product of migrated) {
    const tenantId = product["tenant_id"] as string;
    const productId = product["id"] as string;
    const rules = (await db.query<Row>(`select ${RULE_COLUMNS} from price_rules where tenant_id = $1 and product_id = $2 order by created_at, id`, [tenantId, productId])).rows;
    const legacyPackages = rules.filter((rule) => rule["pricing_model"] === "charter_package" && rule["area_id"] !== null);
    const withWaypoint = rules.filter((rule) => rule["pricing_model"] === "charter_area_surcharge" && Object.hasOwn(rule["params"] ?? {}, "waypointSurchargeMinor"));
    if (legacyPackages.length === 0 && withWaypoint.length === 0) continue;

    const wideHours = new Set(rules.filter((rule) => rule["pricing_model"] === "charter_package" && rule["area_id"] === null && rule["status"] === "enabled").map((rule) => `${rule["vehicle_group_id"]}|${rule["package_hours"]}`));
    counts.hoursOnlyInLegacy += new Set(legacyPackages.filter((rule) => rule["status"] === "enabled").map((rule) => `${rule["vehicle_group_id"]}|${rule["package_hours"]}`).filter((key) => !wideHours.has(key))).size;
    counts.zeroUpdownRows += withWaypoint.filter((rule) => rule["params"]["pickupSurchargeMinor"] === 0 && rule["params"]["dropoffSurchargeMinor"] === 0).length;

    const backup = async (rule: Row, action: "delete_area_package" | "strip_waypoint"): Promise<void> => {
      await db.query(
        `insert into legacy_price_cleanup_backups (run_id, product_tenant_id, product_id, price_rule_id, action, price_rule, created_at)
         select $1, tenant_id, product_id, id, $4, to_jsonb(r), $5 from price_rules r where tenant_id = $2 and id = $3`,
        [runId, tenantId, rule["id"], action, now],
      );
      changes.push({ action, tenantId, productId, priceRuleId: rule["id"] });
    };
    for (const rule of legacyPackages) {
      await backup(rule, "delete_area_package");
      await db.query("delete from price_rules where tenant_id = $1 and id = $2", [tenantId, rule["id"]]);
      await insertAuditLog(db, origin, { tenantId, resource: "price_rule", resourceId: rule["id"], action: "delete", before: auditView(rule), after: { reason: "legacy_price_cleanup", run_id: runId } });
    }
    for (const rule of withWaypoint) {
      await backup(rule, "strip_waypoint");
      const updated = await db.query<Row>(`update price_rules set params = params - 'waypointSurchargeMinor', updated_at = $3 where tenant_id = $1 and id = $2 returning ${RULE_COLUMNS}`, [tenantId, rule["id"], now]);
      await insertAuditLog(db, origin, { tenantId, resource: "price_rule", resourceId: rule["id"], action: "update", before: auditView(rule), after: { ...auditView(updated.rows[0] as Row), reason: "legacy_price_cleanup", run_id: runId } });
    }
    counts.areaPackagesDeleted += legacyPackages.length;
    counts.waypointsStripped += withWaypoint.length;
    counts.changedProducts += 1;

    const bumped = await db.query<Row>("update products set version = version + 1, updated_at = $3 where tenant_id = $1 and id = $2 returning version", [tenantId, productId, now]);
    await insertAuditLog(db, origin, {
      tenantId,
      resource: "product",
      resourceId: productId,
      action: "update",
      before: { version: product["version"] },
      after: { version: (bumped.rows[0] as Row)["version"], reason: "legacy_price_cleanup", run_id: runId, area_packages_deleted: legacyPackages.length, waypoints_stripped: withWaypoint.length },
    });
  }

  await db.query("insert into legacy_price_cleanup_runs (id, mode, counts, changes, created_at) values ($1, $2, $3, $4, $5)", [runId, mode, JSON.stringify(counts), JSON.stringify(changes), now]);
  return { mode, runId, counts, changes };
}

/** 审计里记的规则内容（同价格接口的审计：区域、车型组、套餐、方式、参数、日期、状态） */
function auditView(rule: Row): AuditValues {
  return {
    product_id: rule["product_id"],
    area_id: rule["area_id"],
    vehicle_group_id: rule["vehicle_group_id"],
    package_hours: rule["package_hours"],
    pricing_model: rule["pricing_model"],
    params: rule["params"],
    valid_from: rule["valid_from"],
    valid_to: rule["valid_to"],
    status: rule["status"],
  };
}


/** 部署日志里的一行：只有计数和批次号 */
export function legacyCleanupCountsLine(report: LegacyPriceCleanupReport): string {
  const c = report.counts;
  return `包车旧价格清理（${report.mode}，批次 ${report.runId}）：迁移过三层的包车商品 ${c.migratedProducts} 个（没迁移过的 ${c.untouchedProducts} 个不动），有改动 ${c.changedProducts} 个；删掉按服务区域的旧套餐价 ${c.areaPackagesDeleted} 条；③行去掉途经加价 ${c.waypointsStripped} 条（其中上下车加价都是 0 的 ${c.zeroUpdownRows} 条）；只在旧行里有的车型组 × 时长 ${c.hoursOnlyInLegacy} 个`;
}
