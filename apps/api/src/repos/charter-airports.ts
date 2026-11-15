/** 包车机场绑定（M9P-21，ADR 0098 第三节第 2 小节，迁移 0520）的读写，和绑定要用到的机场、航站楼主数据。 */
import type { AirportScenarioKind, LocalizedText, PlaceType } from "@nozomi/domain";
import type { Db } from "../db/context.ts";

type Row = Record<string, any>;

export interface CharterAirportBindingRow {
  scenario: AirportScenarioKind;
  placeId: string;
  areaId: string;
  shortNameZh: string | null;
  /** 同一场景里的先后（从 0 起） */
  position: number;
}

export async function listCharterAirportBindings(db: Db, tenantId: string, productId: string): Promise<CharterAirportBindingRow[]> {
  const result = await db.query<Row>("select scenario, place_id, area_id, short_name_zh, position from charter_airport_bindings where tenant_id = $1 and product_id = $2 order by scenario, position", [tenantId, productId]);
  return result.rows.map((row) => ({ scenario: row["scenario"], placeId: row["place_id"], areaId: row["area_id"], shortNameZh: row["short_name_zh"], position: row["position"] }));
}

/** 整组替换（调用方已锁住商品） */
export async function replaceCharterAirportBindings(db: Db, tenantId: string, productId: string, rows: readonly CharterAirportBindingRow[], now: Date): Promise<void> {
  await db.query("delete from charter_airport_bindings where tenant_id = $1 and product_id = $2", [tenantId, productId]);
  if (rows.length === 0) return;
  await db.query(
    `insert into charter_airport_bindings (tenant_id, product_id, scenario, place_id, area_id, short_name_zh, position, created_at)
     select $1, $2, scenario, place_id, area_id, short_name_zh, position, $8
       from unnest($3::text[], $4::uuid[], $5::uuid[], $6::text[], $7::int[]) as given(scenario, place_id, area_id, short_name_zh, position)`,
    [tenantId, productId, rows.map((row) => row.scenario), rows.map((row) => row.placeId), rows.map((row) => row.areaId), rows.map((row) => row.shortNameZh), rows.map((row) => row.position), now],
  );
}

/** 这个区域是哪些商品的机场区域（删区域前查，ADR 0098 第三节第 2 小节：绑定着的区域不能删） */
export async function productsBindingArea(db: Db, tenantId: string, areaId: string): Promise<string[]> {
  const result = await db.query<Row>("select distinct product_id from charter_airport_bindings where tenant_id = $1 and area_id = $2 order by product_id", [tenantId, areaId]);
  return result.rows.map((row) => row["product_id"] as string);
}

export interface PlacePoint {
  id: string;
  type: PlaceType;
  code: string;
  name: LocalizedText;
  status: string;
  lng: number;
  lat: number;
}

/** 机场连同它下面的航站楼（主数据，所有启用 / 停用的都给，调用方自己挑） */
export async function listPlacesWithTerminals(db: Db, placeIds: readonly string[]): Promise<Map<string, PlacePoint & { terminals: PlacePoint[] }>> {
  if (placeIds.length === 0) return new Map();
  const result = await db.query<Row>("select id, type, code, name, status, lng, lat, parent_id from places where id = any($1::uuid[]) or parent_id = any($1::uuid[]) order by code", [[...new Set(placeIds)]]);
  const point = (row: Row): PlacePoint => ({ id: row["id"], type: row["type"], code: row["code"], name: row["name"], status: row["status"], lng: Number(row["lng"]), lat: Number(row["lat"]) });
  const found = new Map<string, PlacePoint & { terminals: PlacePoint[] }>();
  for (const row of result.rows) if (placeIds.includes(row["id"])) found.set(row["id"], { ...point(row), terminals: [] });
  for (const row of result.rows) {
    const parent = row["parent_id"] === null ? undefined : found.get(row["parent_id"]);
    if (parent !== undefined && row["type"] === "terminal") parent.terminals.push(point(row));
  }
  return found;
}
