/**
 * 区域重叠清理（ADR 0102 第五节第 3 步，业主 2026-11-18「直接清理」；只在测试环境执行）。
 *
 * 用迁移账号（表的所有者）在一个事务里做完，`dry-run` 算完回滚、`apply` 提交：
 * 1. 备份：每个区域的整行、图形和全部关联（商品服务区域、价格行、调价规则、机场绑定）存进 `area_cleanup_backups`（本次的 run_id）；
 * 2. 标平台共享：名称（中文）带「·通用」的启用区域标成 `shared`；
 * 3. 停用没人用的重复：同一供应商、同一分类、业务类型、用途，中文名相同，营运范围重合度（交 / 并）≥ 0.9 的一组里，
 *    有至少一份在用时，把一处都没被引用（商品服务区域、价格行、线路价下车区域、调价规则、机场绑定都没有）的几份停用。
 *    不合并：这些重复大多分在不同城市（价格表导入时每个城市各建一份），商品只能用本城市的区域（AREA_OTHER_CITY），各城市那份都要留着；
 *    它们在报价时也不会互相影响（一个商品只看自己选的区域）。
 * 4. 切掉包车商品同一层里剩下的真重叠：用和上架检查同一个口径（`charterLayerOverlaps`）找出来，
 *    同层：面积大的减去面积小的；①和③：③减去①（①优先本来就是规则）。减不动的（减完没剩、带洞切不开）记「没解决」。
 * 每一步只动启用中的区域；订单里存的是快照，停用、改图形不影响已下的单。
 */
import type { PoolClient } from "pg";
import { type OverlapAreaInput, charterLayerOverlaps, findAreaOverlaps, priceImportRingAreaM2, subtractAreaRange } from "@nozomi/domain";
import type { Pool } from "pg";
import { type AreaPolygon, type AreaPolygonDraft, listAreaPolygons, replaceAreaPolygons } from "../repos/areas.ts";

export type AreaCleanupMode = "dry-run" | "apply";

type Row = Record<string, any>;

export interface AreaCleanupCounts {
  areas: number;
  markedShared: number;
  duplicateGroups: number;
  disabled: number;
  overlapsBefore: number;
  subtracted: number;
  unresolved: number;
  overlapsAfter: number;
}

export interface AreaCleanupReport {
  mode: AreaCleanupMode;
  runId: string;
  counts: AreaCleanupCounts;
  /** 每一处改动：只有编号和动作，不带名称、价格（标准输出也不打它们） */
  changes: { action: "mark_shared" | "disable" | "subtract" | "unresolved"; tenantId: string; areaId: string; keepAreaId?: string; productId?: string; removedM2?: number; reason?: string }[];
}

/** 「完全重复」的门槛：营运范围的交 / 并 */
export const DUPLICATE_MIN_IOU = 0.9;

interface AreaRow {
  id: string;
  tenantId: string;
  cityId: string;
  nameZh: string;
  bizType: OverlapAreaInput["bizType"];
  role: NonNullable<OverlapAreaInput["role"]>;
  sharing: "shared" | "own";
  createdAt: Date;
  polygons: { kind: "operate" | "forbid"; ring: [number, number][] }[];
}

const operateM2 = (area: AreaRow): number => area.polygons.filter((p) => p.kind === "operate").reduce((sum, p) => sum + priceImportRingAreaM2(p.ring), 0);
const inputOf = (area: AreaRow): OverlapAreaInput => ({ id: area.id, bizType: area.bizType, role: area.role, active: true, sharing: area.sharing, polygons: area.polygons });

async function loadAreas(db: PoolClient): Promise<AreaRow[]> {
  const areas = await db.query<Row>("select id, tenant_id, city_id, name, biz_type, role, sharing, created_at from areas where status = 'active' order by tenant_id, created_at, id");
  const polygons = await db.query<Row>("select area_id, kind, geometry from area_polygons p join areas a on a.tenant_id = p.tenant_id and a.id = p.area_id where a.status = 'active' order by area_id, position");
  const byArea = new Map<string, AreaRow["polygons"]>();
  for (const row of polygons.rows) byArea.set(row["area_id"], [...(byArea.get(row["area_id"]) ?? []), { kind: row["kind"], ring: ((row["geometry"] as { coordinates: [number, number][][] }).coordinates[0] ?? []).slice(0, -1) }]);
  return areas.rows.map((row) => ({
    id: row["id"],
    tenantId: row["tenant_id"],
    cityId: row["city_id"],
    nameZh: ((row["name"] as Record<string, string>)["zh"] ?? "").trim(),
    bizType: row["biz_type"],
    role: row["role"],
    sharing: row["sharing"],
    createdAt: row["created_at"],
    polygons: byArea.get(row["id"]) ?? [],
  }));
}

/** 1. 备份：整行、图形、全部关联 */
async function backup(db: PoolClient, runId: string, now: Date): Promise<void> {
  await db.query(
    `insert into area_cleanup_backups (run_id, area_tenant_id, area_id, area, polygons, refs, created_at)
     select $1, a.tenant_id, a.id, to_jsonb(a),
            coalesce((select jsonb_agg(to_jsonb(p) order by p.position) from area_polygons p where p.tenant_id = a.tenant_id and p.area_id = a.id), '[]'::jsonb),
            jsonb_build_object(
              'product_areas', coalesce((select jsonb_agg(to_jsonb(x)) from product_areas x where x.tenant_id = a.tenant_id and x.area_id = a.id), '[]'::jsonb),
              'price_rules', coalesce((select jsonb_agg(to_jsonb(x)) from price_rules x where x.tenant_id = a.tenant_id and (x.area_id = a.id or x.to_area_id = a.id)), '[]'::jsonb),
              'adjust_rules', coalesce((select jsonb_agg(to_jsonb(x)) from adjust_rules x where x.tenant_id = a.tenant_id and a.id = any(x.area_ids)), '[]'::jsonb),
              'airport_bindings', coalesce((select jsonb_agg(to_jsonb(x)) from charter_airport_bindings x where x.tenant_id = a.tenant_id and x.area_id = a.id), '[]'::jsonb)
            ),
            $2
       from areas a`,
    [runId, now],
  );
}

/** 3. 找完全重复的组（不分城市）：键相同、和组里最早的那个重合度 ≥ 0.9 */
export function duplicateGroups(areas: readonly AreaRow[]): { keep: AreaRow; drop: AreaRow[] }[] {
  const byKey = new Map<string, AreaRow[]>();
  for (const area of areas) {
    if (area.nameZh === "") continue;
    const key = [area.tenantId, area.sharing, area.bizType, area.role, area.nameZh].join("\u0000");
    byKey.set(key, [...(byKey.get(key) ?? []), area]);
  }
  const groups: { keep: AreaRow; drop: AreaRow[] }[] = [];
  for (const list of byKey.values()) {
    if (list.length < 2) continue;
    const [keep, ...rest] = [...list].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)) as [AreaRow, ...AreaRow[]];
    const keepM2 = operateM2(keep);
    const drop = rest.filter((other) => {
      const shared = findAreaOverlaps([inputOf(keep), inputOf(other)]).pairs[0]?.areaM2 ?? 0;
      const union = keepM2 + operateM2(other) - shared;
      return union > 0 && shared / union >= DUPLICATE_MIN_IOU;
    });
    if (drop.length > 0) groups.push({ keep, drop });
  }
  return groups;
}

/** 这个区域有没有被引用（商品服务区域、价格行、线路价下车区域、调价规则、机场绑定） */
async function referenced(db: PoolClient, tenantId: string, areaId: string): Promise<boolean> {
  const row = (
    await db.query<Row>(
      `select exists (select 1 from product_areas where tenant_id = $1 and area_id = $2)
           or exists (select 1 from price_rules where tenant_id = $1 and (area_id = $2 or to_area_id = $2))
           or exists (select 1 from adjust_rules where tenant_id = $1 and $2 = any(area_ids))
           or exists (select 1 from charter_airport_bindings where tenant_id = $1 and area_id = $2) as used`,
      [tenantId, areaId],
    )
  ).rows[0];
  return row?.["used"] === true;
}

/** 包车商品各层的区域：①商品服务区域、②行程加价、③上下车加价（规则不分启停，和上架检查一样） */
async function charterLayers(db: PoolClient): Promise<{ productId: string; tenantId: string; layers: { base: string[]; itinerary: string[]; updown: string[] } }[]> {
  const products = await db.query<Row>("select id, tenant_id from products where category = 'charter' order by tenant_id, id");
  const base = await db.query<Row>("select product_id, area_id from product_areas where product_id = any($1::uuid[])", [products.rows.map((row) => row["id"])]);
  const rules = await db.query<Row>("select product_id, area_id, pricing_model from price_rules where product_id = any($1::uuid[]) and area_id is not null and pricing_model in ('charter_itinerary_surcharge', 'charter_area_surcharge')", [products.rows.map((row) => row["id"])]);
  return products.rows.map((product) => {
    const id = product["id"] as string;
    const of = (model: string) => [...new Set(rules.rows.filter((row) => row["product_id"] === id && row["pricing_model"] === model).map((row) => row["area_id"] as string))];
    return { productId: id, tenantId: product["tenant_id"], layers: { base: base.rows.filter((row) => row["product_id"] === id).map((row) => row["area_id"] as string), itinerary: of("charter_itinerary_surcharge"), updown: of("charter_area_surcharge") } };
  });
}

async function layerOverlaps(db: PoolClient): Promise<{ productId: string; tenantId: string; layer: string; a: string; b: string; areaM2: number }[]> {
  const areas = await loadAreas(db);
  const byTenant = new Map<string, OverlapAreaInput[]>();
  for (const area of areas) byTenant.set(area.tenantId, [...(byTenant.get(area.tenantId) ?? []), inputOf(area)]);
  const found: { productId: string; tenantId: string; layer: string; a: string; b: string; areaM2: number }[] = [];
  for (const product of await charterLayers(db)) {
    const { layers } = product;
    if (layers.base.length + layers.itinerary.length + layers.updown.length < 2) continue;
    for (const entry of charterLayerOverlaps(byTenant.get(product.tenantId) ?? [], layers, layers)) found.push({ productId: product.productId, tenantId: product.tenantId, layer: entry.layer, a: entry.a, b: entry.b, areaM2: entry.areaM2 });
  }
  return found;
}

/** 4. 从一个区域里减去另一个，写回图形（形状版本加一）：没碰到的块原样留（圆还是圆），碰到的换成减完的多边形，禁行区不动 */
async function subtract(db: PoolClient, tenantId: string, targetId: string, cutterId: string, now: Date): Promise<{ ok: true; removedM2: number } | { ok: false; reason: string }> {
  const target = await listAreaPolygons(db, tenantId, targetId);
  const cutter = await listAreaPolygons(db, tenantId, cutterId);
  const result = subtractAreaRange(target.map((shape) => ({ kind: shape.kind, ring: shape.ring })), cutter.map((shape) => ({ kind: shape.kind, ring: shape.ring })));
  if (!result.ok) return { ok: false, reason: result.reason };
  const kept = result.keptIndexes.map((index) => target[index] as AreaPolygon);
  if (kept.length + result.rings.length === 0) return { ok: false, reason: "NOTHING_LEFT" };
  const operate = [...kept.map((shape) => ({ ...shape, id: shape.id as string | null })), ...result.rings.map((ring) => ({ id: null, kind: "operate" as const, seq: 0, label: null, source: "drawn" as const, circle: null, ring }))];
  const forbid = target.filter((shape) => shape.kind === "forbid").map((shape) => ({ ...shape, id: shape.id as string | null }));
  const drafts: AreaPolygonDraft[] = [...operate.map((shape, index) => ({ ...shape, seq: index + 1 })), ...forbid.map((shape, index) => ({ ...shape, seq: index + 1 }))];
  await replaceAreaPolygons(db, tenantId, targetId, drafts);
  await db.query("update areas set shape_version = shape_version + 1, version = version + 1, updated_at = $3 where tenant_id = $1 and id = $2", [tenantId, targetId, now]);
  return { ok: true, removedM2: Math.round(result.removedM2) };
}

async function cleanupAll(db: PoolClient, mode: AreaCleanupMode, now: Date): Promise<AreaCleanupReport> {
  const runId = (await db.query<Row>("select gen_random_uuid() as id")).rows[0]?.["id"] as string;
  // 清理期间不让别人改区域、商品挂载和价格：锁住这几张表的写（读照常）
  await db.query("lock table areas, area_polygons, product_areas, price_rules, adjust_rules, charter_airport_bindings in share row exclusive mode");
  await backup(db, runId, now);
  const counts: AreaCleanupCounts = { areas: 0, markedShared: 0, duplicateGroups: 0, disabled: 0, overlapsBefore: 0, subtracted: 0, unresolved: 0, overlapsAfter: 0 };
  const changes: AreaCleanupReport["changes"] = [];
  counts.overlapsBefore = (await layerOverlaps(db)).length;

  const shared = await db.query<Row>("update areas set sharing = 'shared', version = version + 1, updated_at = $1 where status = 'active' and sharing = 'own' and name->>'zh' like '%·通用%' returning tenant_id, id", [now]);
  counts.markedShared = shared.rowCount ?? 0;
  for (const row of shared.rows) changes.push({ action: "mark_shared", tenantId: row["tenant_id"], areaId: row["id"] });

  const areas = await loadAreas(db);
  counts.areas = areas.length;
  const groups = duplicateGroups(areas);
  counts.duplicateGroups = groups.length;
  for (const group of groups) {
    const members = [group.keep, ...group.drop];
    const used = new Map<string, boolean>();
    for (const member of members) used.set(member.id, await referenced(db, member.tenantId, member.id));
    if (![...used.values()].some(Boolean)) continue;
    for (const member of members) {
      if (used.get(member.id) === true) continue;
      await db.query("update areas set status = 'disabled', version = version + 1, updated_at = $3 where tenant_id = $1 and id = $2", [member.tenantId, member.id, now]);
      counts.disabled += 1;
      changes.push({ action: "disable", tenantId: member.tenantId, areaId: member.id, keepAreaId: members.find((other) => used.get(other.id) === true)?.id as string });
    }
  }

  // 一对区域可能在好几个商品里都重叠：每对只切一次；切过之后图形变了，重新算还剩哪些
  const done = new Set<string>();
  for (let round = 0; round < 3; round += 1) {
    const overlaps = await layerOverlaps(db);
    const todo = overlaps.filter((entry) => !done.has([entry.a, entry.b].sort().join(",")));
    if (todo.length === 0) break;
    const sizes = new Map((await loadAreas(db)).map((area) => [area.id, operateM2(area)]));
    for (const entry of todo) {
      const key = [entry.a, entry.b].sort().join(",");
      if (done.has(key)) continue;
      done.add(key);
      // ①∩③：③减去①；同层：大的减去小的
      const [target, cutter] = entry.layer === "base_pickup_dropoff" ? [entry.b, entry.a] : (sizes.get(entry.a) ?? 0) >= (sizes.get(entry.b) ?? 0) ? [entry.a, entry.b] : [entry.b, entry.a];
      const cut = await subtract(db, entry.tenantId, target, cutter, now);
      if (cut.ok) {
        counts.subtracted += 1;
        changes.push({ action: "subtract", tenantId: entry.tenantId, areaId: target, keepAreaId: cutter, productId: entry.productId, removedM2: cut.removedM2 });
      } else {
        counts.unresolved += 1;
        changes.push({ action: "unresolved", tenantId: entry.tenantId, areaId: target, keepAreaId: cutter, productId: entry.productId, reason: cut.reason });
      }
    }
  }
  counts.overlapsAfter = (await layerOverlaps(db)).length;
  await db.query("insert into area_cleanup_runs (id, mode, counts, changes, created_at) values ($1, $2, $3, $4, $5)", [runId, mode, JSON.stringify(counts), JSON.stringify(changes), now]);
  return { mode, runId, counts, changes };
}

export async function runAreaCleanup(pool: Pool, options: { mode: AreaCleanupMode; now: Date }): Promise<AreaCleanupReport> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const report = await cleanupAll(client, options.mode, options.now);
    await client.query(options.mode === "apply" ? "commit" : "rollback");
    return report;
  } catch (err) {
    await client.query("rollback").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** 标准输出的一行：只有计数（部署日志谁都能看，不打名称、编号、价格） */
export function cleanupCountsLine(report: AreaCleanupReport): string {
  const c = report.counts;
  return [
    `区域重叠清理（${report.mode === "apply" ? "已执行" : "试跑，没有写库"}）：启用区域 ${c.areas} 个`,
    `标平台共享 ${c.markedShared} 个`,
    `完全重复 ${c.duplicateGroups} 组、停用其中没人用的 ${c.disabled} 个`,
    `包车三层重叠 清理前 ${c.overlapsBefore} 处 → 切掉 ${c.subtracted} 对、没解决 ${c.unresolved} 对 → 清理后 ${c.overlapsAfter} 处`,
    `批次 ${report.runId}`,
  ].join("；");
}
