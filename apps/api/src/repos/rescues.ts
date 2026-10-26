/**
 * 救援改派与违约金的数据访问（M3-04，ADR 0031）。
 *
 * - `order_rescues`（救援）、`order_rescue_quotes`（救援单的平台一侧：对外价、加价比例、汇率、名次）是平台表，只在平台事务里用；
 * - `order_rescue_offers`（救援单）、`tenant_deductions`（供应商应扣款项）是租户表：供应商在租户事务里只读自己的（行级安全），
 *   接 / 拒救援单在平台事务里做，所有查询都带着令牌里的租户编号。
 * - 改派时原供应商的那一行改成「已转给救援供应商」，救援供应商的那一行照着原来的那一行另起（同一个订单编号）。
 */
import type { CurrencyCode, DeductionKind, DeductionStatus, FxQuote, OrderStatus, PenaltyTier, RescueOfferStatus, RescueStatus, RescueTrigger, SettlementBreakdown } from "@nozomi/domain";
import type { Db } from "../db/context.ts";

type Row = Record<string, any>;

export type RescueActorType = "tenant_user" | "system" | "platform_user";

export interface Rescue {
  id: string;
  orderId: string;
  originalTenantId: string;
  trigger: RescueTrigger;
  triggeredByType: RescueActorType;
  triggeredBy: string | null;
  reason: string | null;
  triggeredAt: Date;
  fromStatus: OrderStatus;
  serviceAt: Date;
  originalSettlementMinor: number;
  originalSettlementCurrency: CurrencyCode;
  /** 原结算币种 → 客人支付币种（原供应商那一单的报价快照里的）；同币种为 null */
  originalFx: FxQuote | null;
  penaltyBp: number;
  penaltyTier: PenaltyTier;
  status: RescueStatus;
  rescueTenantId: string | null;
  rescueSettlementMinor: number | null;
  rescueSettlementCurrency: CurrencyCode | null;
  rescueFx: FxQuote | null;
  rescuedVia: "offer" | "manual" | null;
  rescuedAt: Date | null;
  forceMajeureAt: Date | null;
  forceMajeureBy: string | null;
  forceMajeureNote: string | null;
  closedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const RESCUE_COLUMNS = `r.id, r.order_id, r.original_tenant_id, r.trigger, r.triggered_by_type, r.triggered_by, r.reason, r.triggered_at, r.from_status, r.service_at, r.original_settlement_minor,
  r.original_settlement_currency, r.original_fx, r.penalty_bp, r.penalty_tier, r.status, r.rescue_tenant_id, r.rescue_settlement_minor, r.rescue_settlement_currency, r.rescue_fx, r.rescued_via, r.rescued_at,
  r.force_majeure_at, r.force_majeure_by, r.force_majeure_note, r.closed_at, r.version, r.created_at, r.updated_at`;

function toRescue(row: Row): Rescue {
  return {
    id: row["id"],
    orderId: row["order_id"],
    originalTenantId: row["original_tenant_id"],
    trigger: row["trigger"],
    triggeredByType: row["triggered_by_type"],
    triggeredBy: row["triggered_by"],
    reason: row["reason"],
    triggeredAt: row["triggered_at"],
    fromStatus: row["from_status"],
    serviceAt: row["service_at"],
    originalSettlementMinor: Number(row["original_settlement_minor"]),
    originalSettlementCurrency: row["original_settlement_currency"],
    originalFx: row["original_fx"],
    penaltyBp: row["penalty_bp"],
    penaltyTier: row["penalty_tier"],
    status: row["status"],
    rescueTenantId: row["rescue_tenant_id"],
    rescueSettlementMinor: row["rescue_settlement_minor"] === null ? null : Number(row["rescue_settlement_minor"]),
    rescueSettlementCurrency: row["rescue_settlement_currency"],
    rescueFx: row["rescue_fx"],
    rescuedVia: row["rescued_via"],
    rescuedAt: row["rescued_at"],
    forceMajeureAt: row["force_majeure_at"],
    forceMajeureBy: row["force_majeure_by"],
    forceMajeureNote: row["force_majeure_note"],
    closedAt: row["closed_at"],
    version: row["version"],
    createdAt: row["created_at"],
    updatedAt: row["updated_at"],
  };
}

export type NewRescue = Pick<Rescue, "orderId" | "originalTenantId" | "trigger" | "triggeredByType" | "triggeredBy" | "reason" | "triggeredAt" | "fromStatus" | "serviceAt" | "originalSettlementMinor" | "originalSettlementCurrency" | "originalFx" | "penaltyBp" | "penaltyTier">;

export async function insertRescue(db: Db, rescue: NewRescue): Promise<Rescue> {
  const result = await db.query<Row>(
    `insert into order_rescues as r (order_id, original_tenant_id, trigger, triggered_by_type, triggered_by, reason, triggered_at, from_status, service_at, original_settlement_minor,
                                     original_settlement_currency, original_fx, penalty_bp, penalty_tier, status, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, 'open', $7, $7)
     returning ${RESCUE_COLUMNS}`,
    [
      rescue.orderId, rescue.originalTenantId, rescue.trigger, rescue.triggeredByType, rescue.triggeredBy, rescue.reason, rescue.triggeredAt, rescue.fromStatus, rescue.serviceAt, rescue.originalSettlementMinor, rescue.originalSettlementCurrency,
      rescue.originalFx === null ? null : JSON.stringify(rescue.originalFx), rescue.penaltyBp, rescue.penaltyTier,
    ],
  );
  return toRescue(result.rows[0] as Row);
}

/** 这张单没有结论的那一次救援（最多一次，唯一索引保证）。 */
export async function findOpenRescue(db: Db, orderId: string, options: { lock?: boolean } = {}): Promise<Rescue | null> {
  const result = await db.query<Row>(`select ${RESCUE_COLUMNS} from order_rescues r where r.order_id = $1 and r.status in ('open', 'offering', 'exhausted') ${options.lock ? "for update" : ""}`, [orderId]);
  const row = result.rows[0];
  return row === undefined ? null : toRescue(row);
}

export async function findRescue(db: Db, rescueId: string, options: { lock?: boolean } = {}): Promise<Rescue | null> {
  const result = await db.query<Row>(`select ${RESCUE_COLUMNS} from order_rescues r where r.id = $1 ${options.lock ? "for update" : ""}`, [rescueId]);
  const row = result.rows[0];
  return row === undefined ? null : toRescue(row);
}

/** 一张单的全部救援（含已经有结论的），按触发时间。 */
export async function listOrderRescues(db: Db, orderId: string): Promise<Rescue[]> {
  const result = await db.query<Row>(`select ${RESCUE_COLUMNS} from order_rescues r where r.order_id = $1 order by r.triggered_at, r.id`, [orderId]);
  return result.rows.map(toRescue);
}

/** 原供应商这一行对应的那次救援（转出或救援中的那次）。 */
export async function findRescueOfOriginal(db: Db, tenantId: string, orderId: string): Promise<Rescue | null> {
  const result = await db.query<Row>(`select ${RESCUE_COLUMNS} from order_rescues r where r.original_tenant_id = $1 and r.order_id = $2 order by r.triggered_at desc, r.id desc limit 1`, [tenantId, orderId]);
  const row = result.rows[0];
  return row === undefined ? null : toRescue(row);
}

/** 救援供应商这一行是哪次救援转来的。 */
export async function findRescueOfRescuer(db: Db, tenantId: string, orderId: string): Promise<Rescue | null> {
  const result = await db.query<Row>(`select ${RESCUE_COLUMNS} from order_rescues r where r.rescue_tenant_id = $1 and r.order_id = $2 order by r.triggered_at desc limit 1`, [tenantId, orderId]);
  const row = result.rows[0];
  return row === undefined ? null : toRescue(row);
}

export interface RescueChange {
  status?: RescueStatus;
  rescueTenantId?: string;
  rescueSettlementMinor?: number;
  rescueSettlementCurrency?: CurrencyCode;
  rescueFx?: FxQuote | null;
  rescuedVia?: "offer" | "manual";
  rescuedAt?: Date;
  forceMajeure?: { at: Date; by: string; note: string };
  closedAt?: Date;
}

export async function updateRescue(db: Db, rescueId: string, change: RescueChange, now: Date): Promise<void> {
  await db.query(
    `update order_rescues set status = coalesce($2, status), rescue_tenant_id = coalesce($3, rescue_tenant_id), rescue_settlement_minor = coalesce($4, rescue_settlement_minor),
            rescue_settlement_currency = coalesce($5, rescue_settlement_currency), rescued_via = coalesce($6, rescued_via), rescued_at = coalesce($7, rescued_at),
            force_majeure_at = coalesce($8, force_majeure_at), force_majeure_by = coalesce($9, force_majeure_by), force_majeure_note = coalesce($10, force_majeure_note),
            closed_at = coalesce($11, closed_at), rescue_fx = case when $13::boolean then $14::jsonb else rescue_fx end, version = version + 1, updated_at = $12
      where id = $1`,
    [
      rescueId, change.status ?? null, change.rescueTenantId ?? null, change.rescueSettlementMinor ?? null, change.rescueSettlementCurrency ?? null, change.rescuedVia ?? null, change.rescuedAt ?? null,
      change.forceMajeure?.at ?? null, change.forceMajeure?.by ?? null, change.forceMajeure?.note ?? null, change.closedAt ?? null, now,
      change.rescueFx !== undefined, change.rescueFx === undefined || change.rescueFx === null ? null : JSON.stringify(change.rescueFx),
    ],
  );
}

export interface RescueQueueFilter {
  /** open：没有结论的；closed：已改派、已取消的（最近的在前） */
  state: "open" | "closed";
  limit: number;
}

export async function listRescues(db: Db, filter: RescueQueueFilter): Promise<Rescue[]> {
  const result =
    filter.state === "open"
      ? await db.query<Row>(`select ${RESCUE_COLUMNS} from order_rescues r where r.status in ('open', 'offering', 'exhausted') order by r.service_at, r.triggered_at limit $1`, [filter.limit])
      : await db.query<Row>(`select ${RESCUE_COLUMNS} from order_rescues r where r.status in ('rescued', 'cancelled') order by r.closed_at desc, r.id desc limit $1`, [filter.limit]);
  return result.rows.map(toRescue);
}

// ---- 救援单 ----

/** 救援单上的行程：品类、城市、接送点、方向、用车时间、人数行李、上下车点的坐标和地址、附加服务、司机语言。没有乘客的联系方式和航班号。 */
export interface RescueTrip {
  category: string;
  city_id: string;
  place_id: string | null;
  direction: string | null;
  vehicle_group_id: string;
  package_hours: number | null;
  service_time: string;
  service_local: string;
  timezone: string;
  passengers: number;
  luggage: number;
  pickup: { lng: number; lat: number; address: string } | null;
  dropoff: { lng: number; lat: number; address: string } | null;
  addons: { addon_id: string; quantity: number }[];
  driver_language: string | null;
}

export interface RescueOffer {
  tenantId: string;
  id: string;
  rescueId: string;
  orderId: string;
  productId: string;
  productVersion: number;
  vehicleGroupId: string;
  trip: RescueTrip;
  settlementMinor: number;
  settlementCurrency: CurrencyCode;
  settlement: SettlementBreakdown;
  status: RescueOfferStatus;
  offeredByType: "platform_user" | "system";
  offeredBy: string | null;
  offeredAt: Date;
  expiresAt: Date;
  decidedAt: Date | null;
  decidedBy: string | null;
  declineReason: string | null;
}

const OFFER_COLUMNS = `f.tenant_id, f.id, f.rescue_id, f.order_id, f.product_id, f.product_version, f.vehicle_group_id, f.trip, f.settlement_minor, f.settlement_currency, f.settlement, f.status,
  f.offered_by_type, f.offered_by, f.offered_at, f.expires_at, f.decided_at, f.decided_by, f.decline_reason`;

function toOffer(row: Row): RescueOffer {
  return {
    tenantId: row["tenant_id"],
    id: row["id"],
    rescueId: row["rescue_id"],
    orderId: row["order_id"],
    productId: row["product_id"],
    productVersion: row["product_version"],
    vehicleGroupId: row["vehicle_group_id"],
    trip: row["trip"],
    settlementMinor: Number(row["settlement_minor"]),
    settlementCurrency: row["settlement_currency"],
    settlement: row["settlement"],
    status: row["status"],
    offeredByType: row["offered_by_type"],
    offeredBy: row["offered_by"],
    offeredAt: row["offered_at"],
    expiresAt: row["expires_at"],
    decidedAt: row["decided_at"],
    decidedBy: row["decided_by"],
    declineReason: row["decline_reason"],
  };
}

export type NewRescueOffer = Omit<RescueOffer, "id" | "status" | "decidedAt" | "decidedBy" | "declineReason">;

export async function insertRescueOffer(db: Db, offer: NewRescueOffer): Promise<RescueOffer> {
  const result = await db.query<Row>(
    `insert into order_rescue_offers as f (tenant_id, rescue_id, order_id, product_id, product_version, vehicle_group_id, trip, settlement_minor, settlement_currency, settlement, status, offered_by_type, offered_by, offered_at, expires_at)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10::jsonb, 'pending', $11, $12, $13, $14)
     returning ${OFFER_COLUMNS}`,
    [offer.tenantId, offer.rescueId, offer.orderId, offer.productId, offer.productVersion, offer.vehicleGroupId, JSON.stringify(offer.trip), offer.settlementMinor, offer.settlementCurrency, JSON.stringify(offer.settlement), offer.offeredByType, offer.offeredBy, offer.offeredAt, offer.expiresAt],
  );
  return toOffer(result.rows[0] as Row);
}

/** 平台事务：某个供应商的一张救援单（租户编号来自令牌，别的供应商的当作不存在）。 */
export async function findTenantOffer(db: Db, tenantId: string, offerId: string, options: { lock?: boolean } = {}): Promise<RescueOffer | null> {
  const result = await db.query<Row>(`select ${OFFER_COLUMNS} from order_rescue_offers f where f.tenant_id = $1 and f.id = $2 ${options.lock ? "for update" : ""}`, [tenantId, offerId]);
  const row = result.rows[0];
  return row === undefined ? null : toOffer(row);
}

/** 一次救援发过的全部救援单，按发出的先后。 */
export async function listRescueOffers(db: Db, rescueId: string, options: { lock?: boolean } = {}): Promise<RescueOffer[]> {
  const result = await db.query<Row>(`select ${OFFER_COLUMNS} from order_rescue_offers f where f.rescue_id = $1 order by f.offered_at, f.id ${options.lock ? "for update" : ""}`, [rescueId]);
  return result.rows.map(toOffer);
}

/** 供应商自己的救援单（租户事务，行级安全），最近发出的在前。`pending` 只看待接的。 */
export async function listTenantOffers(db: Db, tenantId: string, filter: { pendingOnly: boolean; limit: number }): Promise<RescueOffer[]> {
  const result = await db.query<Row>(
    `select ${OFFER_COLUMNS} from order_rescue_offers f where f.tenant_id = $1 and ($2::boolean is false or f.status = 'pending') order by f.offered_at desc, f.id desc limit $3`,
    [tenantId, filter.pendingOnly, filter.limit],
  );
  return result.rows.map(toOffer);
}

export async function updateOfferStatus(db: Db, offer: Pick<RescueOffer, "tenantId" | "id">, change: { status: Exclude<RescueOfferStatus, "pending">; decidedAt: Date; decidedBy?: string | null; declineReason?: string | null }): Promise<void> {
  await db.query("update order_rescue_offers set status = $3, decided_at = $4, decided_by = $5, decline_reason = $6 where tenant_id = $1 and id = $2 and status = 'pending'", [
    offer.tenantId, offer.id, change.status, change.decidedAt, change.decidedBy ?? null, change.declineReason ?? null,
  ]);
}

/** 到了期限还没接的救援单（跨租户），最早到期的在前。 */
export async function listExpiredOffers(db: Db, now: Date, limit: number): Promise<{ tenantId: string; id: string; orderId: string }[]> {
  const result = await db.query<Row>("select tenant_id, id, order_id from order_rescue_offers where status = 'pending' and expires_at <= $1 order by expires_at, id limit $2", [now, limit]);
  return result.rows.map((row) => ({ tenantId: row["tenant_id"], id: row["id"], orderId: row["order_id"] }));
}

// ---- 救援单的平台一侧 ----

export interface RescueQuoteCandidate {
  tenantId: string;
  productId: string;
  productVersion: number;
  settlementMinor: number;
  settlementCurrency: CurrencyCode;
  sellMinor: number;
  markupBp: number;
  position: number;
}

export interface RescueQuote {
  offerId: string;
  supplierTenantId: string;
  rescueId: string;
  currency: CurrencyCode;
  sellMinor: number;
  markupBp: number;
  fx: FxQuote | null;
  position: number;
  candidates: RescueQuoteCandidate[];
  quotedAt: Date;
}

export async function insertRescueQuote(db: Db, quote: RescueQuote): Promise<void> {
  await db.query(
    `insert into order_rescue_quotes (offer_id, supplier_tenant_id, rescue_id, currency, sell_minor, markup_bp, fx, position, candidates, quoted_at)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10)`,
    [quote.offerId, quote.supplierTenantId, quote.rescueId, quote.currency, quote.sellMinor, quote.markupBp, quote.fx === null ? null : JSON.stringify(quote.fx), quote.position, JSON.stringify(quote.candidates), quote.quotedAt],
  );
}

export async function listRescueQuotes(db: Db, rescueId: string): Promise<Map<string, RescueQuote>> {
  const result = await db.query<Row>("select offer_id, supplier_tenant_id, rescue_id, currency, sell_minor, markup_bp, fx, position, candidates, quoted_at from order_rescue_quotes where rescue_id = $1", [rescueId]);
  return new Map(
    result.rows.map((row) => [
      row["offer_id"] as string,
      { offerId: row["offer_id"], supplierTenantId: row["supplier_tenant_id"], rescueId: row["rescue_id"], currency: row["currency"], sellMinor: Number(row["sell_minor"]), markupBp: row["markup_bp"], fx: row["fx"], position: row["position"], candidates: row["candidates"], quotedAt: row["quoted_at"] },
    ]),
  );
}

// ---- 供应商应扣款项 ----

export interface Deduction {
  tenantId: string;
  id: string;
  orderId: string;
  rescueId: string;
  kind: DeductionKind;
  amountMinor: number;
  currency: CurrencyCode;
  basis: Record<string, unknown>;
  status: DeductionStatus;
  waivedAt: Date | null;
  waiveReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const DEDUCTION_COLUMNS = "d.tenant_id, d.id, d.order_id, d.rescue_id, d.kind, d.amount_minor, d.currency, d.basis, d.status, d.waived_at, d.waive_reason, d.created_at, d.updated_at";

function toDeduction(row: Row): Deduction {
  return {
    tenantId: row["tenant_id"],
    id: row["id"],
    orderId: row["order_id"],
    rescueId: row["rescue_id"],
    kind: row["kind"],
    amountMinor: Number(row["amount_minor"]),
    currency: row["currency"],
    basis: row["basis"],
    status: row["status"],
    waivedAt: row["waived_at"],
    waiveReason: row["waive_reason"],
    createdAt: row["created_at"],
    updatedAt: row["updated_at"],
  };
}

export async function insertDeduction(db: Db, deduction: Pick<Deduction, "tenantId" | "orderId" | "rescueId" | "kind" | "amountMinor" | "currency" | "basis"> & { waived: { at: Date; reason: string } | null; now: Date }): Promise<void> {
  await db.query(
    `insert into tenant_deductions (tenant_id, order_id, rescue_id, kind, amount_minor, currency, basis, status, waived_at, waive_reason, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $11)`,
    [deduction.tenantId, deduction.orderId, deduction.rescueId, deduction.kind, deduction.amountMinor, deduction.currency, JSON.stringify(deduction.basis), deduction.waived === null ? "pending" : "waived", deduction.waived?.at ?? null, deduction.waived?.reason ?? null, deduction.now],
  );
}

/** 不可抗力：这次救援还没免除的应扣款项全部免除。返回免除了几条。 */
export async function waiveDeductions(db: Db, rescueId: string, reason: string, now: Date): Promise<number> {
  const result = await db.query("update tenant_deductions set status = 'waived', waived_at = $2, waive_reason = $3, updated_at = $2 where rescue_id = $1 and status = 'pending'", [rescueId, now, reason]);
  return result.rowCount ?? 0;
}

export async function listRescueDeductions(db: Db, rescueIds: readonly string[]): Promise<Deduction[]> {
  if (rescueIds.length === 0) return [];
  const result = await db.query<Row>(`select ${DEDUCTION_COLUMNS} from tenant_deductions d where d.rescue_id = any($1::uuid[]) order by d.created_at, d.kind`, [[...rescueIds]]);
  return result.rows.map(toDeduction);
}

/** 供应商自己的应扣款项（租户事务，行级安全）；`orderId` 给了只看这一单。最近的在前。 */
export async function listTenantDeductions(db: Db, tenantId: string, filter: { orderId: string | null; limit: number }): Promise<(Deduction & { orderNo: string; serviceAt: Date })[]> {
  const result = await db.query<Row>(
    `select ${DEDUCTION_COLUMNS}, o.order_no, o.service_at from tenant_deductions d join orders o on o.tenant_id = d.tenant_id and o.id = d.order_id
      where d.tenant_id = $1 and ($2::uuid is null or d.order_id = $2) order by d.created_at desc, d.id desc limit $3`,
    [tenantId, filter.orderId, filter.limit],
  );
  return result.rows.map((row) => ({ ...toDeduction(row), orderNo: row["order_no"], serviceAt: row["service_at"] }));
}

// ---- 订单：改派、救援的提醒 ----

/** 原供应商的这一行：救援中 → 已转给救援供应商。 */
export async function markOrderRescued(db: Db, order: { tenantId: string; id: string }, now: Date): Promise<void> {
  await db.query("update orders set status = 'rescued', rescued_at = $3, version = version + 1, updated_at = $3 where tenant_id = $1 and id = $2 and status = 'rescue_pending'", [order.tenantId, order.id, now]);
}

/**
 * 照着原供应商的那一行给救援供应商另起一行：行程、乘客、即时通讯、备注、免费等待（客人下单时的承诺）、取消阶梯（下单时的平台政策）、客人确认的落地时间照抄；
 * 商品、结算价和明细用救援供应商的；派车、履约、司机填的落地时间、提醒都从头开始；从「已确认」开始，确认时间 = 改派的时间（派车截止时间按它算）。
 * 版本号接着原来的往上加（渠道手里的旧版本号不会碰巧对上新的一行）。
 */
export async function insertRescuedOrder(
  db: Db,
  input: { original: { tenantId: string; id: string }; tenantId: string; productId: string; productVersion: number; settlementMinor: number; settlementCurrency: CurrencyCode; settlement: SettlementBreakdown; urgent: boolean; inventoryHeld: boolean; dispatchDueAt: Date; now: Date },
): Promise<void> {
  await db.query(
    `insert into orders (tenant_id, id, order_no, status, category, city_id, place_id, direction, product_id, product_version, vehicle_group_id, package_hours,
                         service_at, service_local, timezone, service_date, urgent, passengers, luggage, pickup, dropoff, addons, driver_language, flight_no,
                         passenger, messaging, notes, settlement_minor, settlement_currency, settlement, free_wait_minutes, inventory_held, payment_due_at, confirmed_at,
                         dispatch_due_at, guest_landed_at, landed_at, landed_source, cancel_policy, version, created_at, updated_at)
     select $3, o.id, o.order_no, 'confirmed', o.category, o.city_id, o.place_id, o.direction, $4, $5, o.vehicle_group_id, o.package_hours,
            o.service_at, o.service_local, o.timezone, o.service_date, $6, o.passengers, o.luggage, o.pickup, o.dropoff, o.addons, o.driver_language, o.flight_no,
            o.passenger, o.messaging, o.notes, $7, $8, $9::jsonb, o.free_wait_minutes, $10, o.payment_due_at, $11,
            $12, o.guest_landed_at, o.guest_landed_at, case when o.guest_landed_at is null then null else 'guest' end, o.cancel_policy, o.version + 1, o.created_at, $11
       from orders o where o.tenant_id = $1 and o.id = $2`,
    [input.original.tenantId, input.original.id, input.tenantId, input.productId, input.productVersion, input.urgent, input.settlementMinor, input.settlementCurrency, JSON.stringify(input.settlement), input.inventoryHeld, input.now, input.dispatchDueAt],
  );
}

/** 订单的销售端一侧：现在的供应商换成救援供应商。 */
export async function moveSaleToTenant(db: Db, orderId: string, tenantId: string): Promise<void> {
  await db.query("update order_sales set supplier_tenant_id = $2 where order_id = $1", [orderId, tenantId]);
}

/** 原来的司机链接立即作废（进入救援时）。 */
export async function revokeDriverLinksForRescue(db: Db, order: { tenantId: string; id: string }, now: Date): Promise<number> {
  const result = await db.query("update driver_links set revoked_at = $3, revoke_reason = 'rescue' where tenant_id = $1 and order_id = $2 and revoked_at is null", [order.tenantId, order.id, now]);
  return result.rowCount ?? 0;
}

/** 客人报告司机没到：只记第一次。返回这一次是不是第一次。 */
export async function markDriverMissingReported(db: Db, order: { tenantId: string; id: string }, now: Date): Promise<boolean> {
  const result = await db.query("update orders set driver_missing_reported_at = $3 where tenant_id = $1 and id = $2 and driver_missing_reported_at is null", [order.tenantId, order.id, now]);
  return result.rowCount === 1;
}

/** 救援队列里的提醒：司机到点 15 分钟仍未到达（系统发现的）或客人报告司机没到，还没进入救援的单。 */
export async function listDriverAlerts(db: Db, limit: number): Promise<{ tenantId: string; id: string; orderNo: string; status: OrderStatus; serviceAt: Date; arrivalOverdueAt: Date | null; driverMissingReportedAt: Date | null }[]> {
  const result = await db.query<Row>(
    `select tenant_id, id, order_no, status, service_at, arrival_overdue_at, driver_missing_reported_at from orders
      where status in ('confirmed', 'assigned', 'departed') and (arrival_overdue_at is not null or driver_missing_reported_at is not null)
      order by service_at, id limit $1`,
    [limit],
  );
  return result.rows.map((row) => ({ tenantId: row["tenant_id"], id: row["id"], orderNo: row["order_no"], status: row["status"], serviceAt: row["service_at"], arrivalOverdueAt: row["arrival_overdue_at"], driverMissingReportedAt: row["driver_missing_reported_at"] }));
}

/** 暂停中的供应商名下还有几张未来订单（运营批量发起救援用）。 */
export async function listSuspendedTenantsWithFutureOrders(db: Db, now: Date): Promise<{ tenantId: string; name: string; orders: number }[]> {
  const result = await db.query<Row>(
    `select t.id, t.name, count(o.id)::int as n from tenants t join orders o on o.tenant_id = t.id
      where t.status = 'suspended' and o.status in ('confirmed', 'assigned', 'departed') and o.service_at > $1
      group by t.id, t.name order by t.name, t.id`,
    [now],
  );
  return result.rows.map((row) => ({ tenantId: row["id"], name: row["name"], orders: row["n"] }));
}

/** 暂停中的供应商名下的未来订单（编号）。 */
export async function listFutureOrdersOfTenant(db: Db, tenantId: string, now: Date, limit: number): Promise<string[]> {
  const result = await db.query<Row>("select id from orders where tenant_id = $1 and status in ('confirmed', 'assigned', 'departed') and service_at > $2 order by service_at, id limit $3", [tenantId, now, limit]);
  return result.rows.map((row) => row["id"] as string);
}
