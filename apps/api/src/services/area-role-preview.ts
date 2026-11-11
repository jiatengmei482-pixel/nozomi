/**
 * 切换前的只读清单（M8-20，ADR 0075 第三部分第 3 节第 2 条）：`pnpm areas:role-preview`。测试环境、正式环境在部署迁移 0290 之前各跑一次。
 *
 * - 每个供应商的区域数（按业务类型、启停、用途分）；已上架商品勾选的报价区域（商品区域、加价区域、线路价两端）——迁移后全部是「运营 + 报价」；
 * - 回放最近 N 天（默认 30）询价日志里的请求：对每个候选商品用「迁移后的区域用途」和「不做运营判断」各算一遍，
 *   对外的结果（报不报、金额、区域、价格规则、对外原因）必须 0 处不同；只在内部原因上变细的（如 `OUT_OF_SERVICE_AREA` → `NO_PRICING_AREA`）单独计数。
 *
 * - M8-30（ADR 0080）另回放一遍：同一批请求、同一个候选商品，用「M8-30 之前的口径」（`legacyAreaRules`）和现在的优先级
 *   （一口价 → 一口价 + 区域外里程费 → 计程价）各算一遍：之前报得出的每一个价（车型组、区域、规则、结算价）必须 0 处不同；
 *   之前报不出、现在新报出的单独计数（这是业主要的变化）。上面 M8-20 的对比两边都按 M8-30 之前的口径算，只看区域用途带来的差别。
 *
 * 只读：全部在一个平台的只读事务里（`begin … read only`），数据库拒绝任何写入；不写库、不写日志表、不发通知。
 * 迁移之前区域还没有「用途」这一列：按迁移后的样子（每个区域都是运营 + 报价）算；迁移之后按现在的用途算。
 * 回放用的是现在的商品和规则（不是询价当时的）、询价当时的时刻和路线；库存、节假日两边一样地不看——只比较区域判断带来的差别。
 */
import {
  type LatLng,
  type LocalizedText,
  type ProductQuote,
  type QuoteRefusal,
  type QuoteRequest,
  type RouteEstimate,
  SERVICE_CATEGORIES,
  type VehicleOffer,
  type ServiceCategory,
  instantToLocal,
  quoteProduct,
  quoteRequestIssues,
} from "@nozomi/domain";
import type { Db } from "../db/context.ts";
import { type QuoteCandidate, findQuoteCity, findQuotePlace, loadQuoteCandidates } from "../repos/quotes.ts";

type Row = Record<string, any>;

export const ROLE_PREVIEW_DEFAULT_DAYS = 30;
export const ROLE_PREVIEW_MAX_DAYS = 90;
/** 清单里最多列出几处不同（全部的条数照样数） */
const MAX_LISTED_DIFFS = 50;

export interface SupplierAreas {
  tenantId: string;
  tenantName: string;
  total: number;
  byBizType: Record<string, number>;
  byStatus: Record<string, number>;
  /** 迁移前没有用途这一列：全部按迁移后的「运营 + 报价」算 */
  byRole: Record<string, number>;
}

export interface PublishedProductAreas {
  tenantName: string;
  code: string;
  category: ServiceCategory;
  productAreas: string[];
  surchargeAreas: string[];
  routeAreas: string[];
}

export interface ReplayDiff {
  logId: string;
  productCode: string;
  before: string;
  after: string;
}

export interface RolePreview {
  /** 迁移 0290 是不是已经执行过（区域有没有「用途」这一列） */
  migrated: boolean;
  suppliers: SupplierAreas[];
  totalAreas: number;
  published: PublishedProductAreas[];
  replay: {
    days: number;
    since: string;
    logs: number;
    replayed: number;
    /** 请求认不出（旧格式、城市或地点已经不在了）的询价 */
    skipped: number;
    /** 「候选商品 × 询价」算了几次 */
    evaluations: number;
    /** 对外的结果有不同的条数（必须是 0）；最多列出 50 条 */
    externalDiffCount: number;
    externalDiffs: ReplayDiff[];
    /** 对外一样、只是内部原因变细的：「原来 → 现在」→ 次数 */
    refinements: Record<string, number>;
    /** M8-30：之前报得出的价有变化的处数（必须是 0）、之前报不出现在新报出的价（按计价方式分） */
    priority: { changedCount: number; changed: ReplayDiff[]; keptOffers: number; newOffers: Record<string, number> };
  };
}

const nameOf = (name: LocalizedText): string => name["zh"] ?? name["en"] ?? Object.values(name)[0] ?? "";
const count = (target: Record<string, number>, key: string): void => {
  target[key] = (target[key] ?? 0) + 1;
};

/** 迁移 0290 是不是已经执行过 */
export async function areaRolesMigrated(db: Db): Promise<boolean> {
  const result = await db.query("select 1 from information_schema.columns where table_schema = current_schema() and table_name = 'areas' and column_name = 'role'");
  return result.rows.length > 0;
}

/** 区域原因对外都是「不在服务范围」（ADR 0075：`NO_PRICING_AREA` 对外映射为 `OUT_OF_SERVICE_AREA`） */
const AREA_REASONS: ReadonlySet<QuoteRefusal> = new Set(["OUT_OF_SERVICE_AREA", "IN_FORBIDDEN_AREA", "NO_PRICING_AREA"]);
const external = (reason: QuoteRefusal): string => (AREA_REASONS.has(reason) ? "OUT_OF_SERVICE_AREA" : reason);

/** 一次报价写成可比较的样子：对外的（报不报、金额、区域、规则、对外原因）和内部原因 */
export function previewOutcome(quote: ProductQuote): { external: string; internal: string } {
  if (!quote.ok) return { external: JSON.stringify({ reason: external(quote.reason) }), internal: quote.reason };
  const offers = quote.offers.map((offer) => [offer.vehicleGroupId, offer.packageHours, offer.areaId, offer.settlement.toAreaId ?? null, offer.priceRuleId, offer.settlement.totalMinor, offer.settlement.currency]);
  return {
    external: JSON.stringify({ offers, refused: quote.refused.map((entry) => [entry.vehicleGroupId, external(entry.reason)]) }),
    internal: JSON.stringify(quote.refused.map((entry) => entry.reason)),
  };
}

/** 询价日志里记的请求（渠道的、官网的两种写法）→ 报价引擎的请求；认不出返回 null */
async function replayRequest(db: Db, raw: Row, timezone: string): Promise<{ category: ServiceCategory; placeId: string | null; request: QuoteRequest } | null> {
  const category = raw["category"] as ServiceCategory;
  if (!(SERVICE_CATEGORIES as readonly string[]).includes(category)) return null;
  const pointOf = async (value: unknown): Promise<LatLng | null | undefined> => {
    if (value === null || value === undefined) return null;
    const point = value as Row;
    if (typeof point["place_id"] === "string") return (await findQuotePlace(db, point["place_id"]))?.location ?? undefined;
    return typeof point["lat"] === "number" && typeof point["lng"] === "number" ? { lat: point["lat"], lng: point["lng"] } : undefined;
  };
  const addons = Array.isArray(raw["addons"]) ? (raw["addons"] as Row[]).map((addon) => ({ addonId: String(addon["addon_id"]), quantity: Number(addon["quantity"] ?? 1) })) : [];
  let placeId: string | null;
  let direction: "pickup" | "dropoff" | null;
  let pickup: LatLng | null | undefined;
  let dropoff: LatLng | null | undefined;
  let serviceLocal: string;
  if (raw["source"] === "site") {
    serviceLocal = String(raw["service_local"] ?? "");
    placeId = category === "airport_transfer" ? (raw["airport_id"] ?? null) : null;
    direction = category === "airport_transfer" ? (raw["direction"] ?? null) : null;
    const address = await pointOf(raw["address"]);
    pickup = category === "airport_transfer" ? (direction === "dropoff" ? address : null) : await pointOf(raw["pickup"]);
    dropoff = category === "airport_transfer" ? (direction === "pickup" ? address : null) : await pointOf(raw["dropoff"]);
  } else {
    const at = new Date(String(raw["service_time"] ?? ""));
    if (Number.isNaN(at.getTime())) return null;
    serviceLocal = instantToLocal(at, timezone).dateTime;
    placeId = raw["place_id"] ?? null;
    direction = raw["direction"] ?? null;
    pickup = await pointOf(raw["pickup"]);
    dropoff = await pointOf(raw["dropoff"]);
  }
  if (pickup === undefined || dropoff === undefined) return null;
  const request: QuoteRequest = {
    category,
    pickup,
    dropoff,
    direction,
    packageHours: raw["package_hours"] ?? null,
    serviceLocal,
    passengers: Number(raw["passengers"]),
    luggage: Number(raw["luggage"] ?? 0),
    addons,
    driverLanguage: raw["driver_language"] ?? null,
    vehicleGroupIds: Array.isArray(raw["vehicle_group_ids"]) ? (raw["vehicle_group_ids"] as string[]) : [],
  };
  return quoteRequestIssues(request).length > 0 ? null : { category, placeId, request };
}

function routeOf(route: Row | null): RouteEstimate | null {
  if (route === null || (route["status"] !== "ok" && route["status"] !== "assumed")) return null;
  return typeof route["meters"] === "number" && typeof route["minutes"] === "number" ? { meters: route["meters"], minutes: route["minutes"] } : null;
}

/** 生成清单（调用方给只读事务） */
export async function buildRolePreview(db: Db, options: { days: number; now: Date }): Promise<RolePreview> {
  const migrated = await areaRolesMigrated(db);
  const areas = await db.query<Row>(`select a.tenant_id, t.name as tenant_name, a.id, a.name, a.biz_type, a.status, ${migrated ? "a.role" : "'both'::text as role"} from areas a join tenants t on t.id = a.tenant_id order by t.name, a.tenant_id, a.created_at, a.id`);
  const suppliers = new Map<string, SupplierAreas>();
  const areaNames = new Map<string, string>();
  for (const row of areas.rows) {
    const entry = suppliers.get(row["tenant_id"]) ?? { tenantId: row["tenant_id"], tenantName: row["tenant_name"], total: 0, byBizType: {}, byStatus: {}, byRole: {} };
    entry.total += 1;
    count(entry.byBizType, row["biz_type"]);
    count(entry.byStatus, row["status"]);
    count(entry.byRole, row["role"]);
    suppliers.set(row["tenant_id"], entry);
    areaNames.set(row["id"], nameOf(row["name"]));
  }
  const products = await db.query<Row>(
    `select t.name as tenant_name, p.code, p.category,
            array(select pa.area_id from product_areas pa where pa.tenant_id = p.tenant_id and pa.product_id = p.id order by pa.priority, pa.area_id) as product_areas,
            array(select distinct r.area_id from price_rules r where r.tenant_id = p.tenant_id and r.product_id = p.id and r.pricing_model = 'charter_area_surcharge') as surcharge_areas,
            array(select distinct x.area_id from price_rules r cross join lateral (values (r.area_id), (r.to_area_id)) as x(area_id)
                   where r.tenant_id = p.tenant_id and r.product_id = p.id and r.to_area_id is not null) as route_areas
       from products p join tenants t on t.id = p.tenant_id
      where p.status = 'published'
      order by t.name, p.code`,
  );
  const names = (ids: string[]): string[] => ids.map((id) => areaNames.get(id) ?? id);
  const published = products.rows.map((row) => ({ tenantName: row["tenant_name"], code: row["code"], category: row["category"], productAreas: names(row["product_areas"]), surchargeAreas: names(row["surcharge_areas"]), routeAreas: names(row["route_areas"]) }));

  // 回放
  const since = new Date(options.now.getTime() - options.days * 86_400_000);
  const logs = await db.query<Row>("select id, created_at, city_id, category, request, route from quote_logs where created_at >= $1 order by created_at, id", [since]);
  const replay: RolePreview["replay"] = { days: options.days, since: since.toISOString(), logs: logs.rows.length, replayed: 0, skipped: 0, evaluations: 0, externalDiffCount: 0, externalDiffs: [], refinements: {}, priority: { changedCount: 0, changed: [], keptOffers: 0, newOffers: {} } };
  const cities = new Map<string, { timezone: string } | null>();
  const catalogs = new Map<string, QuoteCandidate[]>();
  for (const log of logs.rows) {
    const cityId = log["city_id"] as string;
    if (!cities.has(cityId)) cities.set(cityId, await findQuoteCity(db, cityId));
    const city = cities.get(cityId);
    const parsed = city === null || city === undefined ? null : await replayRequest(db, log["request"] as Row, city.timezone);
    if (parsed === null) {
      replay.skipped += 1;
      continue;
    }
    const key = `${cityId}|${parsed.category}|${parsed.placeId ?? ""}`;
    if (!catalogs.has(key)) catalogs.set(key, await loadQuoteCandidates(db, { cityId, category: parsed.category, poiId: parsed.placeId, publishedOnly: true, everyAreaOperating: !migrated }));
    replay.replayed += 1;
    const moment = { now: log["created_at"] as Date, route: routeOf(log["route"] as Row | null), inventoryDay: null, urgentUsed: 0 };
    for (const candidate of catalogs.get(key) ?? []) {
      replay.evaluations += 1;
      const { operatingAreas: _operating, ...withoutOperating } = candidate.product;
      const legacy = { legacyAreaRules: true };
      const before = previewOutcome(quoteProduct(withoutOperating, parsed.request, moment, legacy));
      const legacyQuote = quoteProduct(candidate.product, parsed.request, moment, legacy);
      const after = previewOutcome(legacyQuote);
      comparePriority(replay.priority, log["id"], candidate.code, legacyQuote, quoteProduct(candidate.product, parsed.request, moment));
      if (before.external !== after.external) {
        replay.externalDiffCount += 1;
        if (replay.externalDiffs.length < MAX_LISTED_DIFFS) replay.externalDiffs.push({ logId: log["id"], productCode: candidate.code, before: before.external, after: after.external });
      } else if (before.internal !== after.internal) {
        count(replay.refinements, `${before.internal} → ${after.internal}`);
      }
    }
  }
  return { migrated, suppliers: [...suppliers.values()], totalAreas: areas.rows.length, published, replay };
}

/**
 * M8-30 的对比：之前（M8-30 之前的口径）报出的每一个价，现在要逐项一样（车型组、套餐、区域、线路、规则、结算价、币种，且没有新的计价方式）；
 * 之前商品层面报得出、现在报不出也算不同。之前报不出、现在报出来的按计价方式计数。
 */
export function comparePriority(target: RolePreview["replay"]["priority"], logId: string, productCode: string, before: ProductQuote, after: ProductQuote): void {
  const key = (offer: VehicleOffer): string => JSON.stringify([offer.vehicleGroupId, offer.packageHours, offer.areaId, offer.settlement.toAreaId ?? null, offer.priceRuleId, offer.settlement.totalMinor, offer.settlement.currency, offer.settlement.pricingBasis ?? "one_price"]);
  const beforeOffers = before.ok ? before.offers : [];
  const afterOffers = after.ok ? after.offers : [];
  const afterKeys = new Set(afterOffers.map(key));
  const missing = beforeOffers.filter((offer) => !afterKeys.has(key(offer)));
  if (missing.length > 0 || (before.ok && !after.ok)) {
    target.changedCount += 1;
    if (target.changed.length < MAX_LISTED_DIFFS) target.changed.push({ logId, productCode, before: JSON.stringify(beforeOffers.map(key)), after: after.ok ? JSON.stringify(afterOffers.map(key)) : after.reason });
  }
  target.keptOffers += beforeOffers.length - missing.length;
  const beforeGroups = new Set(beforeOffers.map((offer) => offer.vehicleGroupId));
  for (const offer of afterOffers) if (!beforeGroups.has(offer.vehicleGroupId)) count(target.newOffers, offer.settlement.pricingBasis ?? "one_price");
}

/** 清单的文字版（终端打印） */
export function renderRolePreview(preview: RolePreview): string {
  const lines: string[] = [];
  const counts = (record: Record<string, number>): string => Object.entries(record).map(([key, n]) => `${key} ${n}`).join("，");
  lines.push(`迁移 0290（区域用途）：${preview.migrated ? "已执行，按现在的用途算" : "还没执行，按迁移后的样子算（每个区域都是运营 + 报价）"}`);
  lines.push(`区域合计 ${preview.totalAreas} 个，供应商 ${preview.suppliers.length} 家：`);
  for (const supplier of preview.suppliers) lines.push(`- ${supplier.tenantName}：${supplier.total} 个（业务类型：${counts(supplier.byBizType)}；状态：${counts(supplier.byStatus)}；用途：${counts(supplier.byRole)}）`);
  lines.push(`已上架商品 ${preview.published.length} 个，勾选的报价区域${preview.migrated ? "" : "（迁移后全部是运营 + 报价）"}：`);
  for (const product of preview.published) {
    const parts = [`商品区域：${product.productAreas.join("、") || "无"}`];
    if (product.surchargeAreas.length > 0) parts.push(`加价区域：${product.surchargeAreas.join("、")}`);
    if (product.routeAreas.length > 0) parts.push(`线路价两端：${product.routeAreas.join("、")}`);
    lines.push(`- ${product.tenantName} ${product.code}（${product.category}）：${parts.join("；")}`);
  }
  const { replay } = preview;
  lines.push(`回放最近 ${replay.days} 天（${replay.since} 起）的询价日志 ${replay.logs} 条：回放 ${replay.replayed} 条、认不出跳过 ${replay.skipped} 条，算了 ${replay.evaluations} 次（候选商品 × 询价）`);
  lines.push(`对外结果不同：${replay.externalDiffCount} 处${replay.externalDiffCount === 0 ? "（可以上线）" : "（有不同，不能上线）"}`);
  for (const diff of replay.externalDiffs) lines.push(`  - 询价 ${diff.logId} 商品 ${diff.productCode}：之前 ${diff.before}；之后 ${diff.after}`);
  const refined = Object.entries(replay.refinements);
  lines.push(`只在内部原因上变细的：${refined.length === 0 ? "没有" : refined.map(([change, n]) => `${change} ${n} 次`).join("；")}`);
  const { priority } = replay;
  lines.push(`M8-30 报价优先级：之前报得出的 ${priority.keptOffers} 个价不变；有变化 ${priority.changedCount} 处${priority.changedCount === 0 ? "（可以上线）" : "（有变化，不能上线）"}`);
  for (const diff of priority.changed) lines.push(`  - 询价 ${diff.logId} 商品 ${diff.productCode}：之前 ${diff.before}；之后 ${diff.after}`);
  const added = Object.entries(priority.newOffers);
  lines.push(`之前报不出、现在新报出的价：${added.length === 0 ? "没有" : added.map(([basis, n]) => `${basis} ${n} 个`).join("；")}`);
  return lines.join("\n");
}

