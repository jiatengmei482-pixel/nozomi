/**
 * 包车机场开始 / 机场结束套餐的机场绑定（M9P-21，ADR 0098 第三节第 2 小节）：商品 × 场景 × 机场（主数据）× 机场区域 × 可选中文简称。
 * - 只有迁移过三层区域的包车商品能配（`CHARTER_LAYOUT_NOT_MIGRATED`）；
 * - 机场区域只用来判断上 / 下车点在不在机场：本租户任何业务类型、任何用途的区域都行，不进商品区域；新选的不能是停用的；
 * - 机场区域要被本商品的①基础价区域 ∪ ③上下车加价区域完全覆盖（`AIRPORT_AREA_NOT_COVERED`）；
 * - 机场和它所有启用的航站楼都要落在机场区域里（`AIRPORT_NOT_IN_AREA`，列出不在的航站楼）；
 * - 解绑时这个机场区域 × 场景还有机场套餐价 → 409 `AIRPORT_PRICES_EXIST`（先删价格）。
 * 整组替换，带商品版本号；保存后商品版本号加一、记审计。
 */
import { isDeepStrictEqual } from "node:util";
import {
  AIRPORT_SCENARIO_KINDS,
  type AirportScenarioKind,
  type LocalizedText,
  type Position,
  findPricingOutsideOperating,
  locatePoint,
  scenarioEnd,
  surchargeAreaIds,
} from "@nozomi/domain";
import type { DbContext } from "../context.ts";
import type { Db } from "../db/context.ts";
import { AppError } from "../errors.ts";
import { areaShapeInput, listTenantAreaShapes } from "../repos/areas.ts";
import { type AuditValue, insertAuditLog } from "../repos/audit-logs.ts";
import { type CharterAirportBindingRow, listCharterAirportBindings, listPlacesWithTerminals, replaceCharterAirportBindings } from "../repos/charter-airports.ts";
import { findProduct, listProductAreas, updateProduct as updateProductRow } from "../repos/products.ts";
import { listPriceRules } from "../repos/prices.ts";
import { type InputIssue, validationFailed } from "../validation.ts";
import { tenantWriteOrigin } from "./audit.ts";
import { notFound, versionConflict } from "./errors.ts";
import { type ProductWriter, readTx, writeTx } from "./products.ts";

/** 一个场景最多绑几个机场（Q12） */
export const MAX_AIRPORTS_PER_SCENARIO = 10;

export interface CharterAirportBindingInput {
  scenario: AirportScenarioKind;
  placeId: string;
  areaId: string;
  shortNameZh: string | null;
}

export interface CharterAirportBindingView extends CharterAirportBindingRow {
  placeCode: string;
  placeName: LocalizedText;
  areaName: LocalizedText;
  /** 现在还能不能生效：机场区域启用中、机场启用中（停用的照留、报价时不生效，商品页标红） */
  effective: boolean;
}

export interface CharterAirportsView {
  productId: string;
  version: number;
  bindings: CharterAirportBindingView[];
}

function invalid(issues: InputIssue[]): never {
  throw validationFailed("body", issues);
}

async function view(db: Db, tenantId: string, productId: string, version: number): Promise<CharterAirportsView> {
  const rows = await listCharterAirportBindings(db, tenantId, productId);
  const places = await listPlacesWithTerminals(db, rows.map((row) => row.placeId));
  const areas = await db.query<{ id: string; name: LocalizedText; status: string }>("select id, name, status from areas where tenant_id = $1 and id = any($2::uuid[])", [tenantId, rows.map((row) => row.areaId)]);
  const areaById = new Map(areas.rows.map((row) => [row.id, row]));
  return {
    productId,
    version,
    bindings: rows.map((row) => {
      const place = places.get(row.placeId);
      const area = areaById.get(row.areaId);
      return { ...row, placeCode: place?.code ?? "", placeName: place?.name ?? {}, areaName: area?.name ?? {}, effective: area?.status === "active" && place?.status === "active" };
    }),
  };
}

export async function getCharterAirports(ctx: DbContext, tenantId: string, productId: string): Promise<CharterAirportsView> {
  return readTx(ctx, tenantId, async (db) => {
    const product = await findProduct(db, tenantId, productId, { lock: false });
    if (!product) throw notFound("商品");
    return view(db, tenantId, productId, product.version);
  });
}

/** 平台运营只读查看（任何一家的商品） */
export async function getCharterAirportsForPlatform(db: Db, tenantId: string, productId: string, version: number): Promise<CharterAirportsView> {
  return view(db, tenantId, productId, version);
}

export async function putCharterAirports(ctx: DbContext, writer: ProductWriter, productId: string, expectedVersion: number, inputs: readonly CharterAirportBindingInput[]): Promise<CharterAirportsView> {
  const now = ctx.now();
  const tenantId = writer.principal.tenantId;
  return writeTx(ctx, tenantId, async (db) => {
    const product = await findProduct(db, tenantId, productId, { lock: true });
    if (!product) throw notFound("商品");
    if (product.version !== expectedVersion) throw versionConflict(product.version);
    if (product.category !== "charter" || product.charterLayout !== "three_layer") {
      throw new AppError(400, "CHARTER_LAYOUT_NOT_MIGRATED", "只有迁移到三层区域的包车商品能设机场套餐");
    }
    const before = await listCharterAirportBindings(db, tenantId, productId);
    const issues: InputIssue[] = [];
    const seen = new Set<string>();
    for (const [index, input] of inputs.entries()) {
      const at = `/bindings/${index}`;
      if (inputs.filter((entry) => entry.scenario === input.scenario).length > MAX_AIRPORTS_PER_SCENARIO && inputs.findIndex((entry) => entry.scenario === input.scenario) === index) {
        issues.push({ path: "/bindings", reason: "TOO_MANY", message: `一个场景最多绑 ${MAX_AIRPORTS_PER_SCENARIO} 个机场` });
      }
      for (const key of [`place|${input.scenario}|${input.placeId}`, `area|${input.scenario}|${input.areaId}`]) {
        if (seen.has(key)) issues.push({ path: `${at}/${key.startsWith("place") ? "place_id" : "area_id"}`, reason: "DUPLICATE", message: key.startsWith("place") ? "同一场景里这个机场绑了两次" : "同一场景里一个机场区域只能绑一个机场" });
        seen.add(key);
      }
      if (input.shortNameZh !== null && (input.shortNameZh.length < 1 || input.shortNameZh.length > 20)) issues.push({ path: `${at}/short_name_zh`, reason: "OUT_OF_RANGE", message: "中文简称 1–20 个字" });
    }

    const shapes = await listTenantAreaShapes(db, tenantId);
    const shapeById = new Map(shapes.map((shape) => [shape.id, shape]));
    // 别的租户的、不存在的区域：按 404（不说是哪种）
    if (inputs.some((input) => !shapeById.has(input.areaId))) throw notFound("区域");
    const places = await listPlacesWithTerminals(db, inputs.map((input) => input.placeId));
    const priceRules = await listPriceRules(db, tenantId, productId);
    const productAreas = (await listProductAreas(db, tenantId, productId)).map((area) => area.areaId);
    // ①∪③：商品的服务区域 + 有启用上下车加价规则的区域
    const coverIds = new Set([...productAreas, ...surchargeAreaIds(priceRules)]);
    const cover = shapes.filter((shape) => coverIds.has(shape.id)).map(areaShapeInput);
    for (const [index, input] of inputs.entries()) {
      const at = `/bindings/${index}`;
      const kept = before.some((row) => row.scenario === input.scenario && row.placeId === input.placeId && row.areaId === input.areaId);
      const shape = shapeById.get(input.areaId);
      if (shape === undefined) continue;
      if (shape.status !== "active" && !kept) issues.push({ path: `${at}/area_id`, reason: "AREA_DISABLED", message: "这个区域已停用，不能新选" });
      const place = places.get(input.placeId);
      if (place === undefined || place.type !== "airport" || (place.status !== "active" && !kept)) {
        issues.push({ path: `${at}/place_id`, reason: "UNKNOWN_AIRPORT", message: "请选择启用中的机场" });
        continue;
      }
      const shapesWithId = shape.polygons.map((polygon, position) => ({ id: `${shape.id}-${position}`, kind: polygon.kind, ring: polygon.ring as Position[] }));
      const inside = (point: { lng: number; lat: number }): boolean => locatePoint(shapesWithId, point).result === "operate";
      const outside = [place, ...place.terminals.filter((terminal) => terminal.status === "active")].filter((point) => !inside(point));
      if (outside.length > 0) {
        issues.push({
          path: `${at}/area_id`,
          reason: "AIRPORT_NOT_IN_AREA",
          message: `机场或航站楼不在这个机场区域里：${outside.map((point) => point.name.zh ?? point.name.ja ?? point.code).join("、")}`,
          detail: { places: outside.map((point) => point.code).join(",") },
        });
      }
      const uncovered = findPricingOutsideOperating([areaShapeInput(shape)], cover, () => true).byArea.get(shape.id);
      if (uncovered !== undefined) {
        issues.push({ path: `${at}/area_id`, reason: "AIRPORT_AREA_NOT_COVERED", message: `机场区域有约 ${uncovered} 平方米不在本商品的服务区域或上下车加价区域里（在那里上下车报不出价）`, detail: { uncovered_m2: uncovered } });
      }
    }
    if (issues.length > 0) invalid(issues);

    // 解绑的机场区域 × 场景还有机场套餐价：先删价格
    const removed = before.filter((row) => !inputs.some((input) => input.scenario === row.scenario && input.areaId === row.areaId));
    const orphaned = removed.filter((row) => priceRules.some((rule) => rule.pricing.model === "charter_airport_package" && rule.areaId === row.areaId && rule.direction === scenarioEnd(row.scenario)));
    if (orphaned.length > 0) {
      throw new AppError(409, "AIRPORT_PRICES_EXIST", "这个机场还有机场套餐价，先在价格页删掉再解绑", { area_ids: orphaned.map((row) => row.areaId) });
    }

    const rows: CharterAirportBindingRow[] = AIRPORT_SCENARIO_KINDS.flatMap((scenario) =>
      inputs.filter((input) => input.scenario === scenario).map((input, position) => ({ scenario, placeId: input.placeId, areaId: input.areaId, shortNameZh: input.shortNameZh, position })),
    );
    if (isDeepStrictEqual(rows, before)) return view(db, tenantId, productId, product.version);
    await replaceCharterAirportBindings(db, tenantId, productId, rows, now);
    const updated = await updateProductRow(db, tenantId, productId, {}, now);
    const auditRows = (list: readonly CharterAirportBindingRow[]): AuditValue => list.map((row) => ({ scenario: row.scenario, place_id: row.placeId, area_id: row.areaId, short_name_zh: row.shortNameZh }));
    await insertAuditLog(db, tenantWriteOrigin(writer, now), {
      tenantId,
      resource: "product",
      resourceId: productId,
      action: "update",
      before: { charter_airports: auditRows(before) },
      after: { charter_airports: auditRows(rows) },
    });
    return view(db, tenantId, productId, updated.version);
  });
}
