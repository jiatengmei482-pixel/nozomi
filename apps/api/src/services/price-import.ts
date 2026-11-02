/**
 * 价格表导入第 1 阶段的写入（ADR 0062，M4-28）：在指定租户下新建一个子品牌、这一批的区域、每个机场一个草稿商品和它们的价格规则。
 *
 * - 写全部走现有的服务函数（`createBrand`、`createArea`、`createProduct`、`updateProduct`、`savePriceRules`、`deleteProduct`、`deleteArea`），
 *   校验、审计、行级安全和后台操作完全一样；操作者记为「系统 / 命令行」。这里不拼任何写入的 SQL。
 * - 默认只读（dry-run）：读目标环境、算出要做什么、列出拦住的原因，不写。`apply` 为 true 且没有拦住的原因时才写。
 * - 可以重复执行：子品牌按名字（含批次号）认，区域按营运区图形的备注名（批次标记）+ 城市 + 名称认，商品按子品牌 + 接送点认，
 *   价格按「区域 × 车型组 × 方向 × 开始日期」认。已经有的不再建；已有的价格和这次算出的不一样时不改，列为冲突、整批不写。
 * - 只建草稿，从不上架；不碰这一批以外的商品、区域、价格和账号。
 * - 撤回：删这一批子品牌下的全部商品（都还是草稿时）和这一批的区域；有一个不满足就整批不动。子品牌不能删除（ADR 0016），留下一个空的。
 */
import { randomUUID } from "node:crypto";
import {
  type CurrencyCode,
  type MarkupRule,
  type PriceImportPlan,
  type PriceImportPrecheckIssue,
  type PriceImportRevertBlocker,
  type PriceImportTarget,
  type PricedImportCell,
  type PriceRule,
  areaNameKeys,
  groupPriceImport,
  parsePriceImportTarget,
  planPriceImportRevert,
  priceImportBatchLabel,
  priceImportBrandName,
  pricePriceImportCells,
  resolvePriceImportTarget,
  sitePriceRulesFor,
} from "@nozomi/domain";
import type { DbContext } from "../context.ts";
import { withPlatformTx } from "../db/context.ts";
import { MAX_PAGE_LIMIT, type TimeCursor, decodeTimeCursor } from "../pagination.ts";
import { findTenantAreaKeys, loadPriceImportTarget } from "../repos/price-import.ts";
import { type Brand, type VehicleGroupChoice, listProducts as listProductRows } from "../repos/products.ts";
import type { StoredPriceRule } from "../repos/prices.ts";
import type { SystemTenantPrincipal } from "./audit.ts";
import { createArea, deleteArea } from "./areas.ts";
import { getPriceRules, savePriceRules } from "./prices.ts";
import { type ProductWriter, createBrand, createProduct, deleteProduct, getProduct, listBrands, readTx, updateProduct } from "./products.ts";

/** 一次批量保存价格最多多少条（和接口的上限一致，PRICE_LIMITS.maxBatchChanges） */
const PRICE_CHUNK = 500;
const IDEMPOTENCY_SCOPE = "price-import";

function systemWriter(tenantId: string): ProductWriter {
  const principal: SystemTenantPrincipal = { tenantId, user: null };
  return { principal, ip: "" };
}

/** 读目标环境（平台事务、只读快照）。租户、渠道不存在时说清楚，不让解析报一个看不懂的错。 */
export async function readPriceImportTarget(ctx: DbContext, input: { tenantId: string; channelId: string; countryCode: string }): Promise<PriceImportTarget> {
  const raw = await withPlatformTx(ctx.pool, (db) => loadPriceImportTarget(db, input.tenantId, input.channelId, input.countryCode), { snapshot: true });
  const record = raw as { tenant?: unknown; channel?: unknown } | null;
  if (record === null || record.tenant === null) throw new PriceImportRunError("TENANT_NOT_FOUND", "目标租户不存在");
  if (record.channel === null) throw new PriceImportRunError("CHANNEL_NOT_FOUND", "官网渠道不存在");
  return parsePriceImportTarget(raw);
}

export class PriceImportRunError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "PriceImportRunError";
    this.code = code;
  }
}

export type PriceImportBlocker =
  | PriceImportPrecheckIssue
  | { code: "BRAND_CURRENCY"; detail: string }
  | { code: "AREA_NAME_TAKEN"; cityId: string; region: string; detail: string }
  | { code: "PRODUCT_NOT_DRAFT"; iata: string; detail: string }
  | { code: "PRICE_CONFLICT"; iata: string; region: string; vehicleGroupId: string; direction: string; detail: string }
  | { code: "NOTHING_TO_PRICE"; detail: string };

export interface PriceImportOutcome {
  mode: "dry_run" | "applied" | "blocked";
  batch: string;
  brandName: string;
  tenant: { id: string; name: string };
  channel: { id: string; name: string };
  blockers: PriceImportBlocker[];
  /** 每一格的倒算结果（偏差清单的来源） */
  priced: PricedImportCell[];
  /** 加价规则里带日期范围（促销）、会让这一格在促销期显示价不同的 */
  datedRules: MarkupRule[];
  /** 机场 → 商品的城市（机场在主数据里的城市） */
  airportCities: { iata: string; cityId: string; cityCode: string }[];
  planned: { brand: "create" | "exists"; areas: { create: number; exists: number }; products: { create: number; extend: number; exists: number }; prices: { create: number; exists: number; skippedImpossible: number } };
  written: { brand: number; areas: number; products: number; prices: number };
}

interface ExistingProduct {
  id: string;
  status: string;
  version: number;
  areaIds: string[];
  vehicleGroups: VehicleGroupChoice[];
  rules: StoredPriceRule[];
}

const priceKey = (areaId: string, vehicleGroupId: string, direction: string, validFrom: string): string => JSON.stringify([areaId, vehicleGroupId, direction, validFrom]);

/** 本租户这一批的子品牌（按名字认）。 */
async function findBatchBrand(ctx: DbContext, tenantId: string, batch: string): Promise<Brand | null> {
  const name = priceImportBrandName(batch).toLowerCase();
  return (await listBrands(ctx, tenantId)).find((brand) => brand.name.toLowerCase() === name) ?? null;
}

/** 这一批子品牌下的全部商品（含区域、车型组、价格规则）。 */
async function batchProducts(ctx: DbContext, tenantId: string, brandId: string): Promise<Map<string, ExistingProduct>> {
  const ids = await readTx(ctx, tenantId, async (db) => {
    const found: { id: string; poiId: string | null }[] = [];
    let cursor: TimeCursor | null = null;
    for (;;) {
      const page: Awaited<ReturnType<typeof listProductRows>> = await listProductRows(db, tenantId, { brandId }, MAX_PAGE_LIMIT, cursor);
      found.push(...page.items.map((item) => ({ id: item.id, poiId: item.poiId })));
      cursor = decodeTimeCursor(page.nextCursor);
      if (cursor === null) break;
    }
    return found;
  });
  const result = new Map<string, ExistingProduct>();
  for (const { id, poiId } of ids) {
    const view = await getProduct(ctx, tenantId, id);
    const rules = await getPriceRules(ctx, tenantId, id);
    result.set(poiId ?? id, {
      id,
      status: view.product.status,
      version: rules.version,
      areaIds: (view.areas ?? []).map((area) => area.areaId),
      vehicleGroups: (view.vehicleGroups ?? []).map((group) => ({ vehicleGroupId: group.vehicleGroupId, passengers: group.passengers, luggage: group.luggage })),
      rules: rules.items,
    });
  }
  return result;
}

/**
 * 导入（默认 dry-run）。`plan` 是 domain 的 `planPriceSheetImport` 的结果；价格的开始日期是 `validFrom`，没有结束日期。
 */
export async function runPriceImport(
  ctx: DbContext,
  input: { tenantId: string; channelId: string; countryCode: string; batch: string; currency: CurrencyCode; validFrom: string; plan: PriceImportPlan; apply: boolean },
): Promise<PriceImportOutcome> {
  const target = await readPriceImportTarget(ctx, input);
  const tenantId = target.tenant.id;
  const brandName = priceImportBrandName(input.batch);
  const label = priceImportBatchLabel(input.batch);
  const blockers: PriceImportBlocker[] = [];

  // 前置检查：机场、城市、车型组（含人数 / 行李组合）、渠道币种。缺了由平台按现有流程建，工具不建平台主数据
  const draft = groupPriceImport(input.plan.cells, () => "");
  const resolved = resolvePriceImportTarget(target, draft.products, input.currency);
  blockers.push(...resolved.issues);
  const cells = input.plan.cells.filter((cell) => resolved.airports.has(cell.iata) && resolved.vehicleGroups.has(cell.vehicleGroupCode));
  const cityOf = (iata: string): string => (resolved.airports.get(iata) as { cityId: string }).cityId;
  const groupOf = (code: string): string => resolved.vehicleGroups.get(code) as string;

  const brand = await findBatchBrand(ctx, tenantId, input.batch);
  if (brand !== null && brand.currency !== input.currency) blockers.push({ code: "BRAND_CURRENCY", detail: `这一批的子品牌已存在，币种是 ${brand.currency}` });
  const roundingUnit = brand?.roundingUnit ?? 1;

  // 倒算：每一格按它适用的加价比例（租户 × 机场所属城市 × 接送机 × 车型组，不带日期的规则）
  const datedRules = new Map<string, MarkupRule>();
  const priced = pricePriceImportCells(cells, (cell) => {
    const found = sitePriceRulesFor(target, { cityId: cityOf(cell.iata), vehicleGroupId: groupOf(cell.vehicleGroupCode), validFrom: input.validFrom }, { currency: input.currency, roundingUnit });
    for (const rule of found.datedRules) datedRules.set(rule.id, rule);
    return found.rules;
  });
  const sellable = priced.filter((cell) => cell.result.baseMinor !== null);
  const grouped = groupPriceImport(sellable, cityOf);

  // 现在的样子：这一批的区域、商品、价格；同城市里这一批以外的同名区域
  const tenantAreas = await readTx(ctx, tenantId, (db) => findTenantAreaKeys(db, tenantId, label, null));
  const areaIdOf = new Map<string, string>();
  const areasToCreate: typeof grouped.areas = [];
  for (const area of grouped.areas) {
    const keys = areaNameKeys({ zh: area.region });
    const same = tenantAreas.filter((existing) => existing.cityId === area.city && existing.nameKeys.some((key) => keys.includes(key)));
    const mine = same.find((existing) => existing.inBatch);
    if (mine) areaIdOf.set(JSON.stringify([area.city, area.region]), mine.id);
    else if (same.length > 0) blockers.push({ code: "AREA_NAME_TAKEN", cityId: area.city, region: area.region, detail: "这个城市里已经有同名的区域（不是这一批建的），不动它，也不能再建同名的" });
    else areasToCreate.push(area);
  }
  const products = brand === null ? new Map<string, ExistingProduct>() : await batchProducts(ctx, tenantId, brand.id);
  for (const product of grouped.products) {
    const existing = products.get(resolved.airports.get(product.iata)?.placeId ?? "");
    if (existing && existing.status !== "draft") blockers.push({ code: "PRODUCT_NOT_DRAFT", iata: product.iata, detail: "这一批的商品已经不是草稿，不再改它" });
  }
  // 已有的价格：同一个「区域 × 车型组 × 方向 × 开始日期」、同一个价的算已有；同一区域车型组上方向重叠（通用和接机 / 送机）或价不同的，
  // 是表改过或有人改过，不覆盖，整批不写
  let pricesExisting = 0;
  const overlaps = (a: string, b: string): boolean => a === b || a === "both" || b === "both";
  for (const cell of sellable) {
    const existing = products.get(resolved.airports.get(cell.iata)?.placeId ?? "");
    const areaId = areaIdOf.get(JSON.stringify([cityOf(cell.iata), cell.region]));
    if (!existing || areaId === undefined) continue;
    const vehicleGroupId = groupOf(cell.vehicleGroupCode);
    const clashing = existing.rules.filter((rule) => rule.areaId === areaId && rule.vehicleGroupId === vehicleGroupId && overlaps(rule.direction ?? "", cell.direction));
    if (clashing.length === 0) continue;
    const same = clashing.length === 1 && clashing.every((rule) => rule.direction === cell.direction && rule.validFrom === input.validFrom && rule.validTo === null && rule.status === "enabled" && rule.pricing.model === "fixed" && rule.pricing.basePriceMinor === cell.result.baseMinor);
    if (same) pricesExisting += 1;
    else blockers.push({ code: "PRICE_CONFLICT", iata: cell.iata, region: cell.region, vehicleGroupId, direction: cell.direction, detail: "已有的价格和这次算出的不同（价、方向、日期或状态），不改" });
  }
  if (sellable.length === 0) blockers.push({ code: "NOTHING_TO_PRICE", detail: "没有一格能导入" });

  const outcome: PriceImportOutcome = {
    mode: blockers.length > 0 ? "blocked" : input.apply ? "applied" : "dry_run",
    batch: input.batch,
    brandName,
    tenant: { id: tenantId, name: target.tenant.name },
    channel: { id: target.channel.id, name: target.channel.name },
    blockers,
    priced,
    datedRules: [...datedRules.values()],
    airportCities: [...resolved.airports].map(([iata, airport]) => ({ iata, cityId: airport.cityId, cityCode: airport.cityCode })),
    planned: {
      brand: brand === null ? "create" : "exists",
      areas: { create: areasToCreate.length, exists: grouped.areas.length - areasToCreate.length },
      products: {
        create: grouped.products.filter((product) => !products.has(resolved.airports.get(product.iata)?.placeId ?? "")).length,
        extend: 0,
        exists: grouped.products.filter((product) => products.has(resolved.airports.get(product.iata)?.placeId ?? "")).length,
      },
      prices: { create: sellable.length - pricesExisting, exists: pricesExisting, skippedImpossible: priced.length - sellable.length },
    },
    written: { brand: 0, areas: 0, products: 0, prices: 0 },
  };
  if (outcome.mode !== "applied") return outcome;

  // ---- 写入：子品牌 → 区域 → 商品 → 价格。每一步都是现有的服务函数，各自一个事务；中途失败重跑会从断点接着做 ----
  const writer = systemWriter(tenantId);
  const key = (): { scope: string; key: string } => ({ scope: IDEMPOTENCY_SCOPE, key: randomUUID() });
  let brandId = brand?.id ?? null;
  if (brandId === null) {
    const created = await createBrand(ctx, writer, { name: brandName, currency: input.currency }, key(), (row) => ({ id: row.id }));
    brandId = created.body["id"] as string;
    outcome.written.brand = 1;
  }
  for (const area of areasToCreate) {
    const created = await createArea(
      ctx,
      writer,
      {
        cityId: area.city,
        name: { zh: area.region },
        bizType: "airport_transfer",
        polygons: [{ id: null, kind: "operate", label, source: "circle", circle: { center: { lat: area.shape.lat, lng: area.shape.lng }, radiusM: area.shape.radiusM }, geometry: null }],
      },
      key(),
      (view) => ({ id: view.area.id }),
    );
    areaIdOf.set(JSON.stringify([area.city, area.region]), created.body["id"] as string);
    outcome.written.areas += 1;
  }
  for (const product of grouped.products) {
    const airport = resolved.airports.get(product.iata) as { placeId: string; cityId: string };
    const areaIds = product.regions.map((region) => areaIdOf.get(JSON.stringify([product.city, region])) as string);
    const vehicleGroups = product.vehicles.map((vehicle) => ({ vehicleGroupId: groupOf(vehicle.code), passengers: vehicle.capacity.passengers, luggage: vehicle.capacity.luggage }));
    let existing = products.get(airport.placeId);
    if (!existing) {
      const created = await createProduct(ctx, writer, { brandId, cityId: airport.cityId, category: "airport_transfer", poiId: airport.placeId, areaIds, vehicleGroups }, key(), (view) => ({ id: view.product.id, version: view.product.version }));
      existing = { id: created.body["id"] as string, status: "draft", version: created.body["version"] as number, areaIds, vehicleGroups, rules: [] };
      outcome.written.products += 1;
    } else {
      // 这一批以后又加了地区或车型：在原来的后面补上，不去掉已有的
      const moreAreas = areaIds.filter((id) => !existing?.areaIds.includes(id));
      const moreGroups = vehicleGroups.filter((choice) => !existing?.vehicleGroups.some((group) => group.vehicleGroupId === choice.vehicleGroupId));
      if (moreAreas.length > 0 || moreGroups.length > 0) {
        const view = await updateProduct(ctx, writer, existing.id, existing.version, { areaIds: [...existing.areaIds, ...moreAreas], vehicleGroups: [...existing.vehicleGroups, ...moreGroups] });
        existing = { ...existing, version: view.product.version, areaIds: [...existing.areaIds, ...moreAreas], vehicleGroups: [...existing.vehicleGroups, ...moreGroups] };
        outcome.planned.products.extend += 1;
      }
    }
    const have = new Set(existing.rules.map((rule) => priceKey(rule.areaId, rule.vehicleGroupId, rule.direction ?? "", rule.validFrom)));
    const creates = sellable
      .filter((cell) => cell.iata === product.iata)
      .map((cell): PriceRule => ({
        areaId: areaIdOf.get(JSON.stringify([product.city, cell.region])) as string,
        vehicleGroupId: groupOf(cell.vehicleGroupCode),
        direction: cell.direction,
        packageHours: null,
        pricing: { model: "fixed", basePriceMinor: cell.result.baseMinor as number },
        validFrom: input.validFrom,
        validTo: null,
        status: "enabled",
      }))
      .filter((rule) => !have.has(priceKey(rule.areaId, rule.vehicleGroupId, rule.direction ?? "", rule.validFrom)));
    let version = existing.version;
    for (let start = 0; start < creates.length; start += PRICE_CHUNK) {
      const chunk = creates.slice(start, start + PRICE_CHUNK);
      const saved = await savePriceRules(ctx, writer, existing.id, version, { create: chunk.map((rule) => ({ ref: null, rule })), update: [], remove: [] }, { single: false, idempotency: null, respond: (result) => ({ status: 200, body: { version: result.view.version } }) });
      version = saved.body["version"] as number;
      outcome.written.prices += chunk.length;
    }
  }
  return outcome;
}

export interface PriceImportRevertOutcome {
  mode: "dry_run" | "applied" | "blocked" | "nothing";
  brandName: string;
  products: number;
  areas: number;
  blockers: PriceImportRevertBlocker[];
}

/** 撤回一批（默认 dry-run）。 */
export async function revertPriceImport(ctx: DbContext, input: { tenantId: string; batch: string; apply: boolean }): Promise<PriceImportRevertOutcome> {
  const brandName = priceImportBrandName(input.batch);
  const brand = await findBatchBrand(ctx, input.tenantId, input.batch);
  const label = priceImportBatchLabel(input.batch);
  const products = brand === null ? new Map<string, ExistingProduct>() : await batchProducts(ctx, input.tenantId, brand.id);
  const areas = (await readTx(ctx, input.tenantId, (db) => findTenantAreaKeys(db, input.tenantId, label, null))).filter((area) => area.inBatch);
  if (brand === null && areas.length === 0) return { mode: "nothing", brandName, products: 0, areas: 0, blockers: [] };
  const plan = planPriceImportRevert({ products: [...products.values()].map((product) => ({ id: product.id, status: product.status })), areas: areas.map((area) => ({ id: area.id, usedBy: area.usedBy })) });
  if (!plan.ok) return { mode: "blocked", brandName, products: products.size, areas: areas.length, blockers: plan.blockers };
  if (!input.apply) return { mode: "dry_run", brandName, products: plan.deleteProducts.length, areas: plan.deleteAreas.length, blockers: [] };
  const writer = systemWriter(input.tenantId);
  for (const id of plan.deleteProducts) await deleteProduct(ctx, writer, id);
  for (const id of plan.deleteAreas) await deleteArea(ctx, writer, id);
  return { mode: "applied", brandName, products: plan.deleteProducts.length, areas: plan.deleteAreas.length, blockers: [] };
}
