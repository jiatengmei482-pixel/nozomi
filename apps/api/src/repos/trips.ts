/**
 * 行程单、方案、段、跨段费用的读写（M9T-03，ADR 0100 第二节）。全部是平台表，在平台事务里调用。
 * 一次报价在同一个事务里删掉这一行程的旧方案（段、费用级联），写新方案，把行程单改成 `quoted`。
 */
import type { LocalizedText, TripItinerary, TripRuleConfig } from "@nozomi/domain";
import type { Db } from "../db/context.ts";

export interface TripRow {
  id: string;
  channelId: string;
  status: "draft" | "quoted";
  itinerary: TripItinerary;
  currency: string;
  isAcceptance: boolean;
  createdAt: Date;
  updatedAt: Date;
  readableUntil: Date;
}

export async function insertTrip(db: Db, row: Omit<TripRow, "status" | "updatedAt">): Promise<void> {
  await db.query(
    "insert into trips (id, channel_id, source, status, itinerary, currency, is_acceptance, created_at, updated_at, readable_until) values ($1, $2, 'form', 'draft', $3::jsonb, $4, $5, $6, $6, $7)",
    [row.id, row.channelId, JSON.stringify(row.itinerary), row.currency, row.isAcceptance, row.createdAt, row.readableUntil],
  );
}

/** 这个渠道、还可读的行程单；过期、不存在、别的渠道的都是 null。`lock` 时锁行（报价时防并发重写方案） */
export async function findReadableTrip(db: Db, id: string, channelId: string, now: Date, options: { lock?: boolean } = {}): Promise<TripRow | null> {
  const result = await db.query<{ id: string; channel_id: string; status: "draft" | "quoted"; itinerary: TripItinerary; currency: string; is_acceptance: boolean; created_at: Date; updated_at: Date; readable_until: Date }>(
    `select id, channel_id, status, itinerary, currency, is_acceptance, created_at, updated_at, readable_until from trips where id = $1 and channel_id = $2 and readable_until > $3${options.lock === true ? " for update" : ""}`,
    [id, channelId, now],
  );
  const row = result.rows[0];
  if (row === undefined) return null;
  return { id: row.id, channelId: row.channel_id, status: row.status, itinerary: row.itinerary, currency: row.currency, isAcceptance: row.is_acceptance, createdAt: row.created_at, updatedAt: row.updated_at, readableUntil: row.readable_until };
}

export interface TripPlanInsert {
  seq: number;
  kind: "one_car" | "daily_best";
  recommended: boolean;
  supplierTenantId: string | null;
  vehicleGroupId: string | null;
  status: "quoted" | "unquoted";
  sellMinor: number | null;
  settlementMinor: number | null;
  currency: string;
  unquoted: { day_index: number | null; reason: string }[];
  warnings: { code: string; day_index: number | null }[];
  expiresAt: Date | null;
  segments: TripSegmentInsert[];
  fees: TripFeeInsert[];
}

export interface TripSegmentInsert {
  dayIndex: number;
  serviceDate: string;
  segmentType: string;
  startLocal: string | null;
  endLocal: string | null;
  points: unknown;
  category: string | null;
  cityId: string | null;
  productId: string | null;
  supplierTenantId: string | null;
  vehicleGroupId: string | null;
  packageHours: number | null;
  settlementMinor: number | null;
  settlementCurrency: string | null;
  sellMinor: number | null;
  markupBp: number | null;
  fx: unknown;
  breakdown: unknown;
  route: unknown;
  otherVehicle: boolean;
}

export interface TripFeeInsert {
  feeType: string;
  supplierTenantId: string;
  productId: string;
  ruleVersion: number;
  settlementMinor: number;
  settlementCurrency: string;
  sellMinor: number;
  nightIndex: number | null;
  dayIndex: number | null;
  areaId: string | null;
  label: LocalizedText;
  calc: unknown;
}

const json = (value: unknown): string | null => (value === null || value === undefined ? null : JSON.stringify(value));

/** 删掉旧方案、写新方案、行程单改成 quoted（调用方在同一个平台事务里、已锁行程单） */
export async function replaceTripPlans(db: Db, tripId: string, plans: readonly TripPlanInsert[], now: Date): Promise<void> {
  await db.query("delete from trip_plans where trip_id = $1", [tripId]);
  for (const plan of plans) {
    const inserted = await db.query<{ id: string }>(
      `insert into trip_plans (trip_id, seq, kind, recommended, supplier_tenant_id, vehicle_group_id, status, sell_minor, settlement_minor, currency, unquoted, warnings, quoted_at, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13, $14) returning id`,
      [tripId, plan.seq, plan.kind, plan.recommended, plan.supplierTenantId, plan.vehicleGroupId, plan.status, plan.sellMinor, plan.settlementMinor, plan.currency, JSON.stringify(plan.unquoted), JSON.stringify(plan.warnings), now, plan.expiresAt],
    );
    const planId = (inserted.rows[0] as { id: string }).id;
    for (const [seq, segment] of plan.segments.entries()) {
      await db.query(
        `insert into trip_segments (plan_id, seq, day_index, service_date, segment_type, start_local, end_local, points, category, city_id, product_id, supplier_tenant_id, vehicle_group_id,
                                    package_hours, settlement_minor, settlement_currency, sell_minor, markup_bp, fx, breakdown, route, other_vehicle)
         values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, $20::jsonb, $21::jsonb, $22)`,
        [
          planId, seq, segment.dayIndex, segment.serviceDate, segment.segmentType, segment.startLocal, segment.endLocal, JSON.stringify(segment.points), segment.category, segment.cityId, segment.productId, segment.supplierTenantId,
          segment.vehicleGroupId, segment.packageHours, segment.settlementMinor, segment.settlementCurrency, segment.sellMinor, segment.markupBp, json(segment.fx), json(segment.breakdown), json(segment.route), segment.otherVehicle,
        ],
      );
    }
    for (const [seq, fee] of plan.fees.entries()) {
      await db.query(
        `insert into trip_fees (trip_id, plan_id, seq, fee_type, supplier_tenant_id, product_id, rule_version, settlement_minor, settlement_currency, sell_minor, night_index, day_index, area_id, label, calc)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb, $15::jsonb)`,
        [tripId, planId, seq, fee.feeType, fee.supplierTenantId, fee.productId, fee.ruleVersion, fee.settlementMinor, fee.settlementCurrency, fee.sellMinor, fee.nightIndex, fee.dayIndex, fee.areaId, JSON.stringify(fee.label), JSON.stringify(fee.calc)],
      );
    }
  }
  await db.query("update trips set status = 'quoted', updated_at = $2 where id = $1", [tripId, now]);
}

export interface StoredTripPlan {
  id: string;
  seq: number;
  kind: "one_car" | "daily_best";
  recommended: boolean;
  vehicleGroupId: string | null;
  status: "quoted" | "unquoted";
  sellMinor: number | null;
  currency: string;
  unquoted: { day_index: number | null; reason: string }[];
  warnings: { code: string; day_index: number | null }[];
  quotedAt: Date;
  expiresAt: Date | null;
  segments: StoredTripSegment[];
  fees: StoredTripFee[];
}

export interface StoredTripSegment {
  id: string;
  dayIndex: number;
  serviceDate: string;
  segmentType: string;
  startLocal: string | null;
  endLocal: string | null;
  packageHours: number | null;
  sellMinor: number | null;
  vehicleGroupId: string | null;
  otherVehicle: boolean;
  breakdown: { sell?: { kind: string; areaId: string | null; stopSeqs?: number[]; fromDropoff?: true; amountMinor: number }[] } | null;
  route: { meters: number; minutes: number; drive_minutes: number; stay_minutes: number } | null;
}

export interface StoredTripFee {
  feeType: string;
  sellMinor: number;
  nightIndex: number | null;
  dayIndex: number | null;
  label: LocalizedText;
}

/** 这一行程最近一次报价的全部方案（按 seq），各自的段（按 seq）和费用（按 seq）。没报过价为空数组 */
export async function listTripPlans(db: Db, tripId: string): Promise<StoredTripPlan[]> {
  const plans = await db.query<{ id: string; seq: number; kind: "one_car" | "daily_best"; recommended: boolean; vehicle_group_id: string | null; status: "quoted" | "unquoted"; sell_minor: string | null; currency: string; unquoted: StoredTripPlan["unquoted"]; warnings: StoredTripPlan["warnings"]; quoted_at: Date; expires_at: Date | null }>(
    "select id, seq, kind, recommended, vehicle_group_id, status, sell_minor, currency, unquoted, warnings, quoted_at, expires_at from trip_plans where trip_id = $1 order by seq",
    [tripId],
  );
  if (plans.rows.length === 0) return [];
  const ids = plans.rows.map((row) => row.id);
  const segments = await db.query<{ id: string; plan_id: string; day_index: number; service_date: string; segment_type: string; start_local: string | null; end_local: string | null; package_hours: number | null; sell_minor: string | null; vehicle_group_id: string | null; other_vehicle: boolean; breakdown: StoredTripSegment["breakdown"]; route: StoredTripSegment["route"] }>(
    `select id, plan_id, day_index, to_char(service_date, 'YYYY-MM-DD') as service_date, segment_type, to_char(start_local, 'YYYY-MM-DD"T"HH24:MI') as start_local, to_char(end_local, 'YYYY-MM-DD"T"HH24:MI') as end_local,
            package_hours, sell_minor, vehicle_group_id, other_vehicle, breakdown, route
       from trip_segments where plan_id = any($1::uuid[]) order by plan_id, seq`,
    [ids],
  );
  const fees = await db.query<{ plan_id: string; fee_type: string; sell_minor: string; night_index: number | null; day_index: number | null; label: LocalizedText }>(
    "select plan_id, fee_type, sell_minor, night_index, day_index, label from trip_fees where trip_id = $1 order by plan_id, seq",
    [tripId],
  );
  return plans.rows.map((row) => ({
    id: row.id,
    seq: row.seq,
    kind: row.kind,
    recommended: row.recommended,
    vehicleGroupId: row.vehicle_group_id,
    status: row.status,
    sellMinor: row.sell_minor === null ? null : Number(row.sell_minor),
    currency: row.currency,
    unquoted: row.unquoted,
    warnings: row.warnings,
    quotedAt: row.quoted_at,
    expiresAt: row.expires_at,
    segments: segments.rows
      .filter((segment) => segment.plan_id === row.id)
      .map((segment) => ({
        id: segment.id,
        dayIndex: segment.day_index,
        serviceDate: segment.service_date,
        segmentType: segment.segment_type,
        startLocal: segment.start_local,
        endLocal: segment.end_local,
        packageHours: segment.package_hours,
        sellMinor: segment.sell_minor === null ? null : Number(segment.sell_minor),
        vehicleGroupId: segment.vehicle_group_id,
        otherVehicle: segment.other_vehicle,
        breakdown: segment.breakdown,
        route: segment.route,
      })),
    fees: fees.rows.filter((fee) => fee.plan_id === row.id).map((fee) => ({ feeType: fee.fee_type, sellMinor: Number(fee.sell_minor), nightIndex: fee.night_index, dayIndex: fee.day_index, label: fee.label })),
  }));
}

/** 编排时读各商品的跨段规则（平台只读策略）：没有配置的商品不在结果里 */
export async function listTripRuleConfigs(db: Db, productIds: readonly string[]): Promise<Map<string, { version: number; config: TripRuleConfig }>> {
  if (productIds.length === 0) return new Map();
  const result = await db.query<{ product_id: string; version: number; config: TripRuleConfig }>("select product_id, version, config from trip_rule_configs where product_id = any($1::uuid[])", [productIds]);
  return new Map(result.rows.map((row) => [row.product_id, { version: row.version, config: row.config }]));
}
