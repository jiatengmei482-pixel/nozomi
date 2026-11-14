/**
 * 包车三层区域的数据迁移（M9P-05，ADR 0093 第六节）：只做加法，一个事务，可以重复执行。
 *
 * 对每个还没迁移过（`products.charter_layout` 为空）的包车商品：
 * - 「基础价来源区域」的套餐价（`charter_package`）原样复制成整商品套餐价（`area_id` 为空）。来源区域：商品服务区域里叫「东京市内」的
 *   （东京包车，ADR 0093 第十三节第 4 条），没有就取优先级排第一的；报告写明取的是哪个；
 * - ③上下车加价行里设了途经加价（`waypointSurchargeMinor`）的，复制成②行程加价（同区域、车型组、套餐、日期、状态，金额不变）。
 *   规格表以外的区域同样照搬（业务方已定 B）；没设途经加价的行不搬（没设 = 不报，迁移后没有②同样不报）；
 * - 同一个事务里把商品的 `charter_layout` 设为 `three_layer`、版本号加一，写审计（操作人是系统、来源是命令行、操作 `migrate`）。
 * 不改、不删任何已有的规则：要运营处理的（套餐价不一致、①上的③、重叠、只有途经加价的行、空格）只列进报告。
 *
 * 报告里有供应商的结算价和区域名：完整报告只写到服务器本地的报告目录，标准输出只打计数（仓库公开，Actions 日志谁都能看）。
 * 只由 `apps/api/src/db/charter-three-layer-cli.ts` 用迁移账号（表的所有者）执行，不开接口。
 */
import { type AreaOverlapPair, type CharterAreaSurchargePricing, type LocalizedText, type Pricing, findAreaOverlaps } from "@nozomi/domain";
import type { Pool, PoolClient } from "../db/pool.ts";
import { insertAuditLog } from "../repos/audit-logs.ts";
import { areaShapeInput, listTenantAreaShapes } from "../repos/areas.ts";

type Row = Record<string, any>;

export type CharterMigrationMode = "dry-run" | "apply";

/** 东京包车的基础价来源区域（ADR 0093 第五节、第十三节第 4 条） */
const PREFERRED_SOURCE_AREA_NAME = "东京市内";

/**
 * 业务方 2026-11-14 已定 B（ADR 0093 第六节第 2 小节）：规格表以外、设了途经加价的区域和金额（结算价，日元）。
 * 只用来在报告里逐行核对搬过去的金额（不一致的列出，不改数据），脚本不为它们写特例。
 */
const CONFIRMED_ITINERARY_JPY: Readonly<Record<string, number>> = {
  横滨: 3_000,
  千叶: 3_000,
  埼玉: 3_000,
  八王子: 3_000,
  横须贺: 6_000,
  木更津: 6_000,
  神奈川西部: 6_000,
  埼玉北部: 6_000,
  秩父: 9_000,
  成田市: 12_000,
  成田北部: 12_000,
  千叶超远: 12_000,
  成田机场: 14_000,
  静冈: 15_000,
  群马温泉: 20_000,
};

/** 业务方已定 A：成田机场外围和这两个区域的重叠维持按机场收 14,000，将来切这两个区域的包车副本 */
const NARITA_AIRPORT = "成田机场";
const NARITA_NEIGHBOURS = ["成田市", "千叶超远"];
const NARITA_NOTE = "已定 A：按机场收 14,000，待切割成田市、千叶超远的包车副本";

export interface PackageMismatch {
  area: string;
  vehicleGroup: string;
  packageHours: number | null;
  validFrom: string;
  /** 来源区域 / 这个区域的那条（没有为 null）：套餐价、含公里、超时单价、超公里单价、状态 */
  source: PackageTerms | null;
  other: PackageTerms | null;
}
interface PackageTerms {
  packagePriceMinor: number;
  packageKm: number;
  overtimePerHourMinor: number;
  overKmPerKmMinor: number;
  validTo: string | null;
  status: string;
}

export interface OverlapEntry {
  layer: "①①" | "②②" | "③③" | "①③";
  a: string;
  b: string;
  /** 平方公里，一位小数 */
  km2: number;
  note?: string;
}

export interface ProductMigrationReport {
  productId: string;
  code: string;
  tenantName: string;
  outcome: "migrated" | "already_migrated" | "no_package";
  sourceArea: string | null;
  layoutBefore: string | null;
  layoutAfter: string | null;
  versionBefore: number;
  versionAfter: number;
  createdPackages: number;
  createdItinerary: number;
  /** 搬进②的金额，按区域（去重、从小到大） */
  itineraryByArea: { area: string; amountsMinor: number[] }[];
  /** 搬过去的金额和业务方已定 B 的金额不一致的区域 */
  itineraryMismatches: { area: string; expectedMinor: number; amountsMinor: number[] }[];
  packageMismatches: PackageMismatch[];
  /** ①上设了③（规格第四节第 3 条禁止） */
  baseAreaSurcharges: { area: string; vehicleGroup: string; packageHours: number | null }[];
  overlaps: OverlapEntry[];
  /** 上下车加价两格都是 0、只有途经加价的③行（可能本意只管经停，迁移后仍能让上 / 下车点匹配） */
  waypointOnlyRows: { area: string; vehicleGroup: string; packageHours: number | null }[];
  /** ②③表里某车型组一条启用的规则都没有的格（= 不报价） */
  emptyCells: { layer: "②" | "③"; area: string; vehicleGroup: string }[];
}

export interface CharterMigrationReport {
  mode: CharterMigrationMode;
  generatedAt: string;
  /** 城市热门景点覆盖（ADR 0093 第七节第 4 条）：清单由 M9P-06 建，现在没有 */
  coverage: "未配置";
  products: ProductMigrationReport[];
}

export interface CharterMigrationCounts {
  products: number;
  migrated: number;
  alreadyMigrated: number;
  noPackage: number;
  createdPackages: number;
  createdItinerary: number;
  packageMismatches: number;
  baseAreaSurcharges: number;
  overlaps: number;
  waypointOnlyRows: number;
  emptyCells: number;
  itineraryMismatches: number;
}

export function countReport(report: CharterMigrationReport): CharterMigrationCounts {
  const sum = (pick: (product: ProductMigrationReport) => number): number => report.products.reduce((total, product) => total + pick(product), 0);
  return {
    products: report.products.length,
    migrated: report.products.filter((product) => product.outcome === "migrated").length,
    alreadyMigrated: report.products.filter((product) => product.outcome === "already_migrated").length,
    noPackage: report.products.filter((product) => product.outcome === "no_package").length,
    createdPackages: sum((product) => product.createdPackages),
    createdItinerary: sum((product) => product.createdItinerary),
    packageMismatches: sum((product) => product.packageMismatches.length),
    baseAreaSurcharges: sum((product) => product.baseAreaSurcharges.length),
    overlaps: sum((product) => product.overlaps.length),
    waypointOnlyRows: sum((product) => product.waypointOnlyRows.length),
    emptyCells: sum((product) => product.emptyCells.length),
    itineraryMismatches: sum((product) => product.itineraryMismatches.length),
  };
}

/** 计数摘要（只有数，没有商品、区域名和金额）：部署日志、PR、验收记录里只写它 */
export function countsLine(mode: CharterMigrationMode, counts: CharterMigrationCounts): string {
  return (
    `三层区域迁移（${mode}）：包车商品 ${counts.products} 个，迁移 ${counts.migrated}、已迁过跳过 ${counts.alreadyMigrated}、没有套餐价跳过 ${counts.noPackage}；` +
    `新建整商品套餐价 ${counts.createdPackages} 条、行程加价 ${counts.createdItinerary} 条；` +
    `报告：套餐价不一致 ${counts.packageMismatches}、基础价区域上的上下车加价 ${counts.baseAreaSurcharges}、重叠 ${counts.overlaps}、只有途经加价的行 ${counts.waypointOnlyRows}、空格 ${counts.emptyCells}、行程加价与已定金额不一致 ${counts.itineraryMismatches}`
  );
}

const nameOf = (name: LocalizedText | null | undefined): string => name?.zh ?? name?.ja ?? name?.en ?? name?.ko ?? "";

interface RuleRow {
  id: string;
  areaId: string | null;
  vehicleGroupId: string;
  packageHours: number | null;
  pricing: Pricing;
  validFrom: string;
  validTo: string | null;
  status: string;
}

const toRule = (row: Row): RuleRow => ({
  id: row["id"],
  areaId: row["area_id"],
  vehicleGroupId: row["vehicle_group_id"],
  packageHours: row["package_hours"],
  pricing: { model: row["pricing_model"], ...row["params"] } as Pricing,
  validFrom: row["valid_from"],
  validTo: row["valid_to"],
  status: row["status"],
});

const termsOf = (rule: RuleRow): PackageTerms | null =>
  rule.pricing.model !== "charter_package"
    ? null
    : { packagePriceMinor: rule.pricing.packagePriceMinor, packageKm: rule.pricing.packageKm, overtimePerHourMinor: rule.pricing.overtimePerHourMinor, overKmPerKmMinor: rule.pricing.overKmPerKmMinor, validTo: rule.validTo, status: rule.status };

/**
 * 执行一次迁移：`dry-run` 在事务里算完报告后回滚（不写库）；`apply` 提交。`productId` 只迁这一个商品。
 * 出错时事务整体回滚、抛出（调用方中止部署）。
 */
export async function runCharterThreeLayerMigration(pool: Pool, options: { mode: CharterMigrationMode; productId?: string | null; now: Date }): Promise<CharterMigrationReport> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const report = await migrateAll(client, options);
    await client.query(options.mode === "apply" ? "commit" : "rollback");
    return report;
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

async function migrateAll(db: PoolClient, options: { mode: CharterMigrationMode; productId?: string | null; now: Date }): Promise<CharterMigrationReport> {
  // 锁住要迁的商品行：迁移期间供应商改不了这些商品的价格（价格保存同样先锁商品行）
  const products = await db.query<Row>(
    `select p.id, p.tenant_id, p.code, p.version, p.charter_layout, t.name as tenant_name
       from products p join tenants t on t.id = p.tenant_id
      where p.category = 'charter' and ($1::uuid is null or p.id = $1)
      order by p.tenant_id, p.code
      for update of p`,
    [options.productId ?? null],
  );
  if (options.productId && products.rows.length === 0) throw new Error("没有这个包车商品");
  const reports: ProductMigrationReport[] = [];
  const shapesByTenant = new Map<string, Awaited<ReturnType<typeof listTenantAreaShapes>>>();
  for (const product of products.rows) {
    const tenantId = product["tenant_id"] as string;
    if (!shapesByTenant.has(tenantId)) shapesByTenant.set(tenantId, await listTenantAreaShapes(db, tenantId));
    reports.push(await migrateProduct(db, product, shapesByTenant.get(tenantId) ?? [], options.now));
  }
  return { mode: options.mode, generatedAt: options.now.toISOString(), coverage: "未配置", products: reports };
}

async function migrateProduct(db: PoolClient, product: Row, shapes: Awaited<ReturnType<typeof listTenantAreaShapes>>, now: Date): Promise<ProductMigrationReport> {
  const tenantId = product["tenant_id"] as string;
  const productId = product["id"] as string;
  const areas = await db.query<Row>("select a.id, a.name from areas a where a.tenant_id = $1", [tenantId]);
  const areaName = new Map(areas.rows.map((row) => [row["id"] as string, nameOf(row["name"])]));
  const groups = await db.query<Row>("select vg.id, vg.code from product_vehicle_groups pv join vehicle_groups vg on vg.id = pv.vehicle_group_id where pv.tenant_id = $1 and pv.product_id = $2 order by pv.position", [tenantId, productId]);
  const groupCode = new Map(groups.rows.map((row) => [row["id"] as string, row["code"] as string]));
  const own = (await db.query<Row>("select area_id from product_areas where tenant_id = $1 and product_id = $2 order by priority, area_id", [tenantId, productId])).rows.map((row) => row["area_id"] as string);
  const rules = (await db.query<Row>(`select id, area_id, vehicle_group_id, package_hours, pricing_model, params, valid_from::text as valid_from, valid_to::text as valid_to, status from price_rules where tenant_id = $1 and product_id = $2 order by created_at, id`, [tenantId, productId])).rows.map(toRule);
  const area = (id: string | null): string => (id === null ? "（整个商品）" : (areaName.get(id) ?? id));
  const group = (id: string): string => groupCode.get(id) ?? id;

  const updown = rules.filter((rule): rule is RuleRow & { pricing: CharterAreaSurchargePricing } => rule.pricing.model === "charter_area_surcharge");
  const withWaypoint = updown.filter((rule) => rule.pricing.waypointSurchargeMinor !== undefined);
  const layoutBefore = (product["charter_layout"] as string | null) ?? null;
  const versionBefore = product["version"] as number;
  const sourceAreaId = own.find((id) => areaName.get(id) === PREFERRED_SOURCE_AREA_NAME) ?? own[0] ?? null;
  const packagesOf = (areaId: string): RuleRow[] => rules.filter((rule) => rule.pricing.model === "charter_package" && rule.areaId === areaId);
  const sourcePackages = sourceAreaId === null ? [] : packagesOf(sourceAreaId);

  // ---- 报告（迁移前后都一样能算：只看旧行）----
  const key = (rule: RuleRow): string => `${rule.vehicleGroupId}|${rule.packageHours}|${rule.validFrom}`;
  const packageMismatches: PackageMismatch[] = [];
  if (sourceAreaId !== null) {
    const source = new Map(sourcePackages.map((rule) => [key(rule), rule]));
    for (const other of own.filter((id) => id !== sourceAreaId)) {
      const mine = new Map(packagesOf(other).map((rule) => [key(rule), rule]));
      for (const combo of [...new Set([...source.keys(), ...mine.keys()])]) {
        const [a, b] = [source.get(combo), mine.get(combo)];
        const [ta, tb] = [a === undefined ? null : termsOf(a), b === undefined ? null : termsOf(b)];
        if (JSON.stringify(ta) === JSON.stringify(tb)) continue;
        const ref = (a ?? b) as RuleRow;
        packageMismatches.push({ area: area(other), vehicleGroup: group(ref.vehicleGroupId), packageHours: ref.packageHours, validFrom: ref.validFrom, source: ta, other: tb });
      }
    }
  }
  const baseAreaSurcharges = updown.filter((rule) => rule.areaId !== null && own.includes(rule.areaId)).map((rule) => ({ area: area(rule.areaId), vehicleGroup: group(rule.vehicleGroupId), packageHours: rule.packageHours }));
  const waypointOnlyRows = withWaypoint.filter((rule) => rule.pricing.pickupSurchargeMinor === 0 && rule.pricing.dropoffSurchargeMinor === 0).map((rule) => ({ area: area(rule.areaId), vehicleGroup: group(rule.vehicleGroupId), packageHours: rule.packageHours }));

  const enabled = (list: readonly RuleRow[]): string[] => [...new Set(list.filter((rule) => rule.status === "enabled" && rule.areaId !== null).map((rule) => rule.areaId as string))];
  const layer3 = enabled(updown);
  // ②：迁移后的行程区域 = 已有的②规则 + 设了途经加价的③行
  const itineraryRules = [...rules.filter((rule) => rule.pricing.model === "charter_itinerary_surcharge"), ...withWaypoint];
  const layer2 = enabled(itineraryRules);
  const overlaps = layerOverlaps(shapes, { own, layer2, layer3 }, area);

  const emptyCells: ProductMigrationReport["emptyCells"] = [];
  for (const [layer, ids, list] of [["②", layer2, itineraryRules], ["③", layer3, updown]] as const) {
    for (const areaId of ids) {
      for (const groupId of groupCode.keys()) {
        if (!list.some((rule) => rule.areaId === areaId && rule.vehicleGroupId === groupId && rule.status === "enabled")) emptyCells.push({ layer, area: area(areaId), vehicleGroup: group(groupId) });
      }
    }
  }
  const amounts = new Map<string, number[]>();
  for (const rule of withWaypoint) {
    const name = area(rule.areaId);
    amounts.set(name, [...new Set([...(amounts.get(name) ?? []), rule.pricing.waypointSurchargeMinor as number])].sort((x, y) => x - y));
  }
  const itineraryByArea = [...amounts].map(([name, list]) => ({ area: name, amountsMinor: list }));
  const itineraryMismatches = itineraryByArea.flatMap((entry) => {
    const expected = CONFIRMED_ITINERARY_JPY[entry.area];
    return expected === undefined || entry.amountsMinor.every((amount) => amount === expected) ? [] : [{ area: entry.area, expectedMinor: expected, amountsMinor: entry.amountsMinor }];
  });

  const base: ProductMigrationReport = {
    productId,
    code: product["code"],
    tenantName: product["tenant_name"],
    outcome: "migrated",
    sourceArea: sourceAreaId === null ? null : area(sourceAreaId),
    layoutBefore,
    layoutAfter: layoutBefore,
    versionBefore,
    versionAfter: versionBefore,
    createdPackages: 0,
    createdItinerary: 0,
    itineraryByArea,
    itineraryMismatches,
    packageMismatches,
    baseAreaSurcharges,
    overlaps,
    waypointOnlyRows,
    emptyCells,
  };
  if (layoutBefore === "three_layer") return { ...base, outcome: "already_migrated" };
  // 一条套餐价都没有的商品不迁：迁了也报不出价（整商品套餐价是空的），留给供应商先填
  if (sourcePackages.length === 0) return { ...base, outcome: "no_package" };

  // ---- 写入（dry-run 时由调用方回滚）----
  const origin = { occurredAt: now, actor: { type: "system" as const, id: null, email: null }, ip: null, source: "cli" as const };
  const insert = async (rule: Omit<RuleRow, "id">, from: string): Promise<void> => {
    const { model, ...params } = rule.pricing;
    const created = await db.query<Row>(
      `insert into price_rules (tenant_id, product_id, area_id, vehicle_group_id, direction, package_hours, pricing_model, params, valid_from, valid_to, status, created_at, updated_at)
       values ($1, $2, $3, $4, null, $5, $6, $7::jsonb, $8, $9, $10, $11, $11) returning id`,
      [tenantId, productId, rule.areaId, rule.vehicleGroupId, rule.packageHours, model, JSON.stringify(params), rule.validFrom, rule.validTo, rule.status, now],
    );
    await insertAuditLog(db, origin, {
      tenantId,
      resource: "price_rule",
      resourceId: (created.rows[0] as Row)["id"],
      action: "migrate",
      before: null,
      after: { product_id: productId, from_price_rule_id: from, area_id: rule.areaId, vehicle_group_id: rule.vehicleGroupId, package_hours: rule.packageHours, pricing_model: model, params: params as Record<string, number>, valid_from: rule.validFrom, valid_to: rule.validTo, status: rule.status },
    });
  };
  for (const rule of sourcePackages) await insert({ ...rule, areaId: null }, rule.id);
  for (const rule of withWaypoint) await insert({ ...rule, pricing: { model: "charter_itinerary_surcharge", surchargeMinor: rule.pricing.waypointSurchargeMinor as number } }, rule.id);
  const updated = await db.query<Row>("update products set charter_layout = 'three_layer', version = version + 1, updated_at = $3 where tenant_id = $1 and id = $2 returning version", [tenantId, productId, now]);
  const versionAfter = (updated.rows[0] as Row)["version"] as number;
  await insertAuditLog(db, origin, {
    tenantId,
    resource: "product",
    resourceId: productId,
    action: "migrate",
    before: { charter_layout: null, version: versionBefore },
    after: { charter_layout: "three_layer", version: versionAfter, source_area_id: sourceAreaId, created_packages: sourcePackages.length, created_itinerary: withWaypoint.length },
  });
  return { ...base, layoutAfter: "three_layer", versionAfter, createdPackages: sourcePackages.length, createdItinerary: withWaypoint.length };
}

/** 几何重叠（`findAreaOverlaps`）：①①、②②、③③ 同层两两；①③ 只取一边在①、一边在③的对 */
function layerOverlaps(shapes: Awaited<ReturnType<typeof listTenantAreaShapes>>, layers: { own: string[]; layer2: string[]; layer3: string[] }, area: (id: string) => string): OverlapEntry[] {
  // 不看用途（运营区域本来就不会在这几层里）、不看业务类型：同一个商品里的区域都会被同时用到
  const inputs = (ids: readonly string[]) => shapes.filter((shape) => ids.includes(shape.id)).map((shape) => ({ ...areaShapeInput(shape), role: "pricing" as const, bizType: "charter" as const }));
  const entries: OverlapEntry[] = [];
  const push = (layer: OverlapEntry["layer"], pair: AreaOverlapPair): void => {
    // 只有边界接触的不算（ADR 0093 第七节第 1 条：小于 0.01 平方公里）
    if (pair.areaM2 < 10_000) return;
    const [a, b] = [area(pair.a), area(pair.b)];
    const narita = (a === NARITA_AIRPORT && NARITA_NEIGHBOURS.includes(b)) || (b === NARITA_AIRPORT && NARITA_NEIGHBOURS.includes(a));
    entries.push({ layer, a, b, km2: Math.round(pair.areaM2 / 100_000) / 10, ...(narita ? { note: NARITA_NOTE } : {}) });
  };
  for (const [layer, ids] of [["①①", layers.own], ["②②", layers.layer2], ["③③", layers.layer3]] as const) {
    for (const pair of findAreaOverlaps(inputs(ids)).pairs) push(layer, pair);
  }
  const crossing = findAreaOverlaps(inputs([...new Set([...layers.own, ...layers.layer3])])).pairs.filter((pair) => (layers.own.includes(pair.a) && layers.layer3.includes(pair.b) && !layers.own.includes(pair.b)) || (layers.own.includes(pair.b) && layers.layer3.includes(pair.a) && !layers.own.includes(pair.a)));
  for (const pair of crossing) push("①③", pair);
  return entries;
}
