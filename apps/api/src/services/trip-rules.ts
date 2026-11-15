/**
 * 跨段规则配置（M9T-02，ADR 0100 第四、五节）：每个包车商品一份，存在租户表 `trip_rule_configs`。
 * - `GET`：保存的值（没存为 null）+ 合并默认值后的生效值（前端据此标「默认」）；只有结算价（规则 4）；
 * - `PUT`：整体替换，带商品版本号（`If-Match`）；成功后商品版本号加一、配置 `version` 加一、写审计（`resource: product`、`after.trip_rules`）；
 * - 只有包车商品能配（`TRIP_RULES_NOT_APPLICABLE`）；`byArea` 只认本商品的①③区域，`fixedByCity` 只认平台启用城市（domain `tripRuleIssues`）。
 * 租户只能读写自己的商品（`tenant_id` 只来自登录令牌，别家的商品 404）。
 */
import { isDeepStrictEqual } from "node:util";
import { type EffectiveTripRules, type TripRuleConfig, effectiveTripRules, surchargeAreaIds, tripRuleIssues } from "@nozomi/domain";
import type { DbContext } from "../context.ts";
import type { Db } from "../db/context.ts";
import { withPlatformTx } from "../db/context.ts";
import type { AppContext } from "../context.ts";
import { AppError } from "../errors.ts";
import { insertAuditLog } from "../repos/audit-logs.ts";
import { listPriceRules } from "../repos/prices.ts";
import { findBrand, findProduct, findProductAcrossTenants, listProductAreas, updateProduct as updateProductRow } from "../repos/products.ts";
import { validationFailed } from "../validation.ts";
import { tenantWriteOrigin } from "./audit.ts";
import { notFound, versionConflict } from "./errors.ts";
import { type ProductWriter, readTx, writeTx } from "./products.ts";

export interface TripRulesView {
  productId: string;
  /** 商品版本号（`If-Match` 用） */
  version: number;
  /** 配置自己的版本号：没存过为 0 */
  rulesVersion: number;
  settlementCurrency: string;
  saved: TripRuleConfig | null;
  effective: EffectiveTripRules;
}

interface StoredTripRules {
  version: number;
  config: TripRuleConfig;
}

async function findTripRules(db: Db, tenantId: string, productId: string, options: { lock: boolean }): Promise<StoredTripRules | null> {
  const result = await db.query<{ version: number; config: TripRuleConfig }>(`select version, config from trip_rule_configs where tenant_id = $1 and product_id = $2${options.lock ? " for update" : ""}`, [tenantId, productId]);
  const row = result.rows[0];
  return row === undefined ? null : { version: row.version, config: row.config };
}

async function view(db: Db, tenantId: string, productId: string, productVersion: number, brandId: string): Promise<TripRulesView> {
  const brand = await findBrand(db, tenantId, brandId, { lock: false });
  if (!brand) throw notFound("子品牌");
  const stored = await findTripRules(db, tenantId, productId, { lock: false });
  return { productId, version: productVersion, rulesVersion: stored?.version ?? 0, settlementCurrency: brand.currency, saved: stored?.config ?? null, effective: effectiveTripRules(stored?.config ?? null, brand.currency) };
}

export async function getTripRules(ctx: DbContext, tenantId: string, productId: string): Promise<TripRulesView> {
  return readTx(ctx, tenantId, async (db) => {
    const product = await findProduct(db, tenantId, productId, { lock: false });
    if (!product) throw notFound("商品");
    return view(db, tenantId, productId, product.version, product.brandId);
  });
}

/** 运营后台只读查看（任何一家的商品；平台可以看结算价） */
export function getPlatformTripRules(ctx: AppContext, productId: string): Promise<TripRulesView> {
  return withPlatformTx(
    ctx.pool,
    async (db) => {
      const found = await findProductAcrossTenants(db, productId);
      if (!found) throw notFound("商品");
      return view(db, found.tenantId, found.product.id, found.product.version, found.product.brandId);
    },
    { snapshot: true },
  );
}

/** 只留有值的键（PUT 的 body 是整份配置；空对象的分组去掉，便于比较和审计） */
function normalized(config: TripRuleConfig): TripRuleConfig {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (value === undefined || value === null) continue;
    const group = Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined));
    if (Object.keys(group).length > 0) out[key] = group;
  }
  return out as TripRuleConfig;
}

export async function putTripRules(ctx: DbContext, writer: ProductWriter, productId: string, expectedVersion: number, input: TripRuleConfig): Promise<TripRulesView> {
  const now = ctx.now();
  const tenantId = writer.principal.tenantId;
  return writeTx(ctx, tenantId, async (db) => {
    const product = await findProduct(db, tenantId, productId, { lock: true });
    if (!product) throw notFound("商品");
    if (product.version !== expectedVersion) throw versionConflict(product.version);
    if (product.category !== "charter") throw new AppError(400, "TRIP_RULES_NOT_APPLICABLE", "只有包车商品能设跨段规则");
    const areaIds = new Set([...(await listProductAreas(db, tenantId, productId)).map((area) => area.areaId), ...surchargeAreaIds(await listPriceRules(db, tenantId, productId))]);
    const cities = await db.query<{ id: string }>("select id from cities where status = 'active'");
    // 先校验原样的输入（不认识的键、空分组也要报），通过后再去掉空分组存
    const issues = tripRuleIssues(input, { productAreaIds: areaIds, cityIds: new Set(cities.rows.map((row) => row.id)) });
    if (issues.length > 0) throw validationFailed("body", issues.map((issue) => ({ path: issue.path, reason: issue.reason, message: issueMessage(issue.reason) })));
    const config = normalized(input);
    const before = await findTripRules(db, tenantId, productId, { lock: true });
    // 内容不变不写：已存的一样，或者没存过（全部默认值）又提交了空配置
    if ((before !== null && isDeepStrictEqual(before.config, config)) || (before === null && Object.keys(config).length === 0)) return view(db, tenantId, productId, product.version, product.brandId);
    if (before === null) {
      await db.query("insert into trip_rule_configs (tenant_id, product_id, version, config, created_at, updated_at) values ($1, $2, 1, $3, $4, $4)", [tenantId, productId, JSON.stringify(config), now]);
    } else {
      await db.query("update trip_rule_configs set version = version + 1, config = $3, updated_at = $4 where tenant_id = $1 and product_id = $2", [tenantId, productId, JSON.stringify(config), now]);
    }
    const updated = await updateProductRow(db, tenantId, productId, {}, now);
    await insertAuditLog(db, tenantWriteOrigin(writer, now), {
      tenantId,
      resource: "product",
      resourceId: productId,
      action: "update",
      before: { trip_rules: (before?.config ?? null) as never },
      after: { trip_rules: config as never },
    });
    return view(db, tenantId, productId, updated.version, product.brandId);
  });
}

function issueMessage(reason: string): string {
  switch (reason) {
    case "UNKNOWN_KEY":
      return "不认识的设置项";
    case "OUT_OF_RANGE":
      return "超出允许的范围";
    case "DUPLICATE":
      return "重复了";
    case "AREA_NOT_FOUND":
      return "只能选本商品的服务区域或上下车加价区域";
    case "CITY_NOT_FOUND":
      return "只能选平台启用中的城市";
    case "ORDER":
      return "上限不能低于常规值，绝对最短休息不能长于常规休息";
    default:
      return "格式不对";
  }
}
