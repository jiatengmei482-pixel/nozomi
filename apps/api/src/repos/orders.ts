/**
 * 订单、状态流水、订单的销售端一侧、收款、支付通知的数据访问（M3-01，ADR 0026）。
 *
 * - `orders`、`order_events` 是租户表：租户事务里只读得到自己的（行级安全），每条租户侧的查询仍显式带 tenant_id；
 *   平台事务（销售端下单、支付回调、超时取消、运营后台）跨租户读写，查询自己带好条件。
 * - `order_sales`、`order_payments`、`payment_events` 是平台表，只在平台事务里用；租户角色对它们没有任何权限。
 * - 租户侧的查询只取租户可以看的列（`TENANT_COLUMNS`），而且只取付过款的单。
 */
import type { CurrencyCode, FxQuote, MessagingApp, OrderCancelReason, OrderStatus, PaymentStatus, ServiceCategory, SettlementBreakdown, TripDirection } from "@nozomi/domain";
import type { Db } from "../db/context.ts";
import { type Page, type TimeCursor, toPage } from "../pagination.ts";

type Row = Record<string, any>;

export interface OrderPoint {
  lng: number;
  lat: number;
  address: string;
}

/** 订单本身（租户也能看的部分）。 */
export interface Order {
  tenantId: string;
  id: string;
  orderNo: string;
  status: OrderStatus;
  category: ServiceCategory;
  cityId: string;
  placeId: string | null;
  direction: TripDirection | null;
  productId: string;
  productVersion: number;
  vehicleGroupId: string;
  packageHours: number | null;
  serviceAt: Date;
  serviceLocal: string;
  timezone: string;
  serviceDate: string;
  urgent: boolean;
  passengers: number;
  luggage: number;
  pickup: OrderPoint | null;
  dropoff: OrderPoint | null;
  addons: { addonId: string; quantity: number }[];
  driverLanguage: string | null;
  flightNo: string | null;
  passenger: { name: string; phone: string; email: string };
  messaging: { app: MessagingApp; handle: string } | null;
  notes: string | null;
  settlementMinor: number;
  settlementCurrency: CurrencyCode;
  settlement: SettlementBreakdown;
  freeWaitMinutes: number | null;
  inventoryHeld: boolean;
  paymentDueAt: Date;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
  cancelReason: OrderCancelReason | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const ORDER_COLUMNS = `o.tenant_id, o.id, o.order_no, o.status, o.category, o.city_id, o.place_id, o.direction, o.product_id, o.product_version, o.vehicle_group_id, o.package_hours,
  o.service_at, o.service_local, o.timezone, o.service_date::text as service_date, o.urgent, o.passengers, o.luggage, o.pickup, o.dropoff, o.addons, o.driver_language, o.flight_no,
  o.passenger, o.messaging, o.notes, o.settlement_minor, o.settlement_currency, o.settlement, o.free_wait_minutes, o.inventory_held, o.payment_due_at, o.confirmed_at, o.cancelled_at,
  o.cancel_reason, o.version, o.created_at, o.updated_at`;

function toOrder(row: Row): Order {
  return {
    tenantId: row["tenant_id"],
    id: row["id"],
    orderNo: row["order_no"],
    status: row["status"],
    category: row["category"],
    cityId: row["city_id"],
    placeId: row["place_id"],
    direction: row["direction"],
    productId: row["product_id"],
    productVersion: row["product_version"],
    vehicleGroupId: row["vehicle_group_id"],
    packageHours: row["package_hours"],
    serviceAt: row["service_at"],
    serviceLocal: row["service_local"],
    timezone: row["timezone"],
    serviceDate: row["service_date"],
    urgent: row["urgent"],
    passengers: row["passengers"],
    luggage: row["luggage"],
    pickup: row["pickup"],
    dropoff: row["dropoff"],
    addons: row["addons"],
    driverLanguage: row["driver_language"],
    flightNo: row["flight_no"],
    passenger: row["passenger"],
    messaging: row["messaging"],
    notes: row["notes"],
    settlementMinor: Number(row["settlement_minor"]),
    settlementCurrency: row["settlement_currency"],
    settlement: row["settlement"],
    freeWaitMinutes: row["free_wait_minutes"],
    inventoryHeld: row["inventory_held"],
    paymentDueAt: row["payment_due_at"],
    confirmedAt: row["confirmed_at"],
    cancelledAt: row["cancelled_at"],
    cancelReason: row["cancel_reason"],
    version: row["version"],
    createdAt: row["created_at"],
    updatedAt: row["updated_at"],
  };
}

export type NewOrder = Omit<Order, "status" | "confirmedAt" | "cancelledAt" | "cancelReason" | "version" | "updatedAt">;

export async function insertOrder(db: Db, order: NewOrder): Promise<void> {
  await db.query(
    `insert into orders (tenant_id, id, order_no, status, category, city_id, place_id, direction, product_id, product_version, vehicle_group_id, package_hours,
                         service_at, service_local, timezone, service_date, urgent, passengers, luggage, pickup, dropoff, addons, driver_language, flight_no,
                         passenger, messaging, notes, settlement_minor, settlement_currency, settlement, free_wait_minutes, inventory_held, payment_due_at, created_at, updated_at)
     values ($1, $2, $3, 'pending_payment', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19::jsonb, $20::jsonb, $21::jsonb, $22, $23,
             $24::jsonb, $25::jsonb, $26, $27, $28, $29::jsonb, $30, $31, $32, $33, $33)`,
    [
      order.tenantId, order.id, order.orderNo, order.category, order.cityId, order.placeId, order.direction, order.productId, order.productVersion, order.vehicleGroupId, order.packageHours,
      order.serviceAt, order.serviceLocal, order.timezone, order.serviceDate, order.urgent, order.passengers, order.luggage, json(order.pickup), json(order.dropoff), JSON.stringify(order.addons),
      order.driverLanguage, order.flightNo, JSON.stringify(order.passenger), json(order.messaging), order.notes, order.settlementMinor, order.settlementCurrency, JSON.stringify(order.settlement),
      order.freeWaitMinutes, order.inventoryHeld, order.paymentDueAt, order.createdAt,
    ],
  );
}

const json = (value: unknown): string | null => (value === null ? null : JSON.stringify(value));

/** 平台事务：一张订单（任何状态）。`lock` 时锁住这一行（改状态之前）。 */
export async function findOrderForPlatform(db: Db, orderId: string, options: { lock?: boolean } = {}): Promise<Order | null> {
  const result = await db.query<Row>(`select ${ORDER_COLUMNS} from orders o where o.id = $1 ${options.lock ? "for update" : ""}`, [orderId]);
  const row = result.rows[0];
  return row === undefined ? null : toOrder(row);
}

export async function updateOrderStatus(db: Db, order: Pick<Order, "tenantId" | "id">, change: { status: OrderStatus; confirmedAt?: Date; cancelledAt?: Date; cancelReason?: OrderCancelReason }, now: Date): Promise<void> {
  await db.query(
    `update orders set status = $3, confirmed_at = coalesce($4, confirmed_at), cancelled_at = coalesce($5, cancelled_at), cancel_reason = coalesce($6, cancel_reason), version = version + 1, updated_at = $7
      where tenant_id = $1 and id = $2`,
    [order.tenantId, order.id, change.status, change.confirmedAt ?? null, change.cancelledAt ?? null, change.cancelReason ?? null, now],
  );
}

export type OrderEventActor = "channel" | "payment" | "system" | "platform_user";

export interface OrderEvent {
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  actor: OrderEventActor;
  reason: string | null;
  occurredAt: Date;
}

export async function insertOrderEvent(db: Db, order: Pick<Order, "tenantId" | "id">, event: OrderEvent): Promise<void> {
  await db.query("insert into order_events (tenant_id, order_id, from_status, to_status, actor, reason, occurred_at) values ($1, $2, $3, $4, $5, $6, $7)", [
    order.tenantId, order.id, event.fromStatus, event.toStatus, event.actor, event.reason, event.occurredAt,
  ]);
}

export async function listOrderEvents(db: Db, tenantId: string, orderId: string): Promise<OrderEvent[]> {
  const result = await db.query<Row>("select from_status, to_status, actor, reason, occurred_at from order_events where tenant_id = $1 and order_id = $2 order by occurred_at, seq", [tenantId, orderId]);
  return result.rows.map((row) => ({ fromStatus: row["from_status"], toStatus: row["to_status"], actor: row["actor"], reason: row["reason"], occurredAt: row["occurred_at"] }));
}

// ---- 库存 ----

/** 预占一单：剩余 ≥ 1 时 held 加一（一条语句里判断和扣减，并发下单不会超卖）。返回是否占到了。 */
export async function holdInventory(db: Db, tenantId: string, productId: string, date: string, now: Date): Promise<boolean> {
  const result = await db.query(
    `update inventory_days set held = held + 1, updated_at = $4
      where tenant_id = $1 and product_id = $2 and day = $3 and vehicle_group_id is null and total - held - sold >= 1`,
    [tenantId, productId, date, now],
  );
  return result.rowCount === 1;
}

/** 付款成功：预占转为已售。 */
export async function sellHeldInventory(db: Db, tenantId: string, productId: string, date: string, now: Date): Promise<void> {
  await db.query(
    `update inventory_days set held = held - 1, sold = sold + 1, updated_at = $4
      where tenant_id = $1 and product_id = $2 and day = $3 and vehicle_group_id is null and held >= 1`,
    [tenantId, productId, date, now],
  );
}

/** 待支付的单取消：释放预占。 */
export async function releaseHeldInventory(db: Db, tenantId: string, productId: string, date: string, now: Date): Promise<void> {
  await db.query(
    `update inventory_days set held = held - 1, updated_at = $4
      where tenant_id = $1 and product_id = $2 and day = $3 and vehicle_group_id is null and held >= 1`,
    [tenantId, productId, date, now],
  );
}

/**
 * 某个商品某一天已经用掉的加急库存：走加急、没取消的单数（报价引擎第 3 步的 `urgentUsed`，下单时再查一次）。
 * 下单时在调用之前先拿这个「商品 + 日期」的咨询锁，判断和占用之间不会插进别的下单。
 */
export async function countUrgentOrders(db: Db, entries: readonly { tenantId: string; productId: string; date: string }[]): Promise<Map<string, number>> {
  if (entries.length === 0) return new Map();
  const result = await db.query<Row>(
    `select o.product_id, o.service_date::text as day, count(*)::int as n
       from orders o join unnest($1::uuid[], $2::date[]) as wanted(product_id, day) on wanted.product_id = o.product_id and wanted.day = o.service_date
      where o.tenant_id = any($3::uuid[]) and o.urgent and o.status <> 'cancelled'
      group by o.product_id, o.service_date`,
    [entries.map((entry) => entry.productId), entries.map((entry) => entry.date), [...new Set(entries.map((entry) => entry.tenantId))]],
  );
  return new Map(result.rows.map((row) => [`${row["product_id"]}|${row["day"]}`, row["n"] as number]));
}

/** 加急库存的咨询锁（事务结束自动释放）：锁名带 schema，集成测试各用各的 schema，互不排队。 */
export async function lockUrgentQuota(db: Db, productId: string, date: string): Promise<void> {
  await db.query("select pg_advisory_xact_lock(hashtext(current_schema() || ':nozomi.urgent:' || $1 || ':' || $2))", [productId, date]);
}

// ---- 订单的销售端一侧 ----

export interface OrderSale {
  orderId: string;
  supplierTenantId: string;
  channelId: string;
  apiClientId: string;
  quoteId: string;
  idempotencyKey: string;
  requestHash: string;
  channelOrderNo: string | null;
  currency: CurrencyCode;
  sellMinor: number;
  markupBp: number;
  /** 报价快照里的汇率（含人工锁定 `lock`，M2-06）；同币种为 null */
  fx: FxQuote | null;
  fxBufferBp: number;
  createdAt: Date;
}

const SALE_COLUMNS = "s.order_id, s.supplier_tenant_id, s.channel_id, s.api_client_id, s.quote_id, s.idempotency_key, s.request_hash, s.channel_order_no, s.currency, s.sell_minor, s.markup_bp, s.fx, s.fx_buffer_bp, s.created_at";

function toSale(row: Row): OrderSale {
  return {
    orderId: row["order_id"],
    supplierTenantId: row["supplier_tenant_id"],
    channelId: row["channel_id"],
    apiClientId: row["api_client_id"],
    quoteId: row["quote_id"],
    idempotencyKey: row["idempotency_key"],
    requestHash: row["request_hash"],
    channelOrderNo: row["channel_order_no"],
    currency: row["currency"],
    sellMinor: Number(row["sell_minor"]),
    markupBp: row["markup_bp"],
    fx: row["fx"],
    fxBufferBp: row["fx_buffer_bp"],
    createdAt: row["created_at"],
  };
}

export async function insertOrderSale(db: Db, sale: OrderSale): Promise<void> {
  await db.query(
    `insert into order_sales (order_id, supplier_tenant_id, channel_id, api_client_id, quote_id, idempotency_key, request_hash, channel_order_no, currency, sell_minor, markup_bp, fx, fx_buffer_bp, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14)`,
    [sale.orderId, sale.supplierTenantId, sale.channelId, sale.apiClientId, sale.quoteId, sale.idempotencyKey, sale.requestHash, sale.channelOrderNo, sale.currency, sale.sellMinor, sale.markupBp, json(sale.fx), sale.fxBufferBp, sale.createdAt],
  );
}

export async function findSaleByIdempotencyKey(db: Db, channelId: string, key: string): Promise<OrderSale | null> {
  const result = await db.query<Row>(`select ${SALE_COLUMNS} from order_sales s where s.channel_id = $1 and s.idempotency_key = $2`, [channelId, key]);
  const row = result.rows[0];
  return row === undefined ? null : toSale(row);
}

export async function findSaleByQuote(db: Db, quoteId: string): Promise<OrderSale | null> {
  const result = await db.query<Row>(`select ${SALE_COLUMNS} from order_sales s where s.quote_id = $1`, [quoteId]);
  const row = result.rows[0];
  return row === undefined ? null : toSale(row);
}

export async function findSale(db: Db, orderId: string): Promise<OrderSale | null> {
  const result = await db.query<Row>(`select ${SALE_COLUMNS} from order_sales s where s.order_id = $1`, [orderId]);
  const row = result.rows[0];
  return row === undefined ? null : toSale(row);
}

// ---- 收款 ----

export interface OrderPayment {
  id: string;
  orderId: string;
  supplierTenantId: string;
  provider: "stripe";
  intentId: string | null;
  customerId: string | null;
  paymentMethodId: string | null;
  amountMinor: number;
  currency: CurrencyCode;
  status: PaymentStatus;
  lastError: { code: string | null; decline_code: string | null; message: string | null } | null;
  refundedMinor: number;
  disputed: boolean;
  paidAfterCancel: boolean;
  saveConsentAt: Date;
  succeededAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const PAYMENT_COLUMNS = `p.id, p.order_id, p.supplier_tenant_id, p.provider, p.intent_id, p.customer_id, p.payment_method_id, p.amount_minor, p.currency, p.status, p.last_error, p.refunded_minor,
  p.disputed, p.paid_after_cancel, p.save_consent_at, p.succeeded_at, p.created_at, p.updated_at`;

function toPayment(row: Row): OrderPayment {
  return {
    id: row["id"],
    orderId: row["order_id"],
    supplierTenantId: row["supplier_tenant_id"],
    provider: row["provider"],
    intentId: row["intent_id"],
    customerId: row["customer_id"],
    paymentMethodId: row["payment_method_id"],
    amountMinor: Number(row["amount_minor"]),
    currency: row["currency"],
    status: row["status"],
    lastError: row["last_error"],
    refundedMinor: Number(row["refunded_minor"]),
    disputed: row["disputed"],
    paidAfterCancel: row["paid_after_cancel"],
    saveConsentAt: row["save_consent_at"],
    succeededAt: row["succeeded_at"],
    createdAt: row["created_at"],
    updatedAt: row["updated_at"],
  };
}

export async function insertOrderPayment(db: Db, payment: { orderId: string; supplierTenantId: string; amountMinor: number; currency: CurrencyCode; saveConsentAt: Date; now: Date }): Promise<void> {
  await db.query(
    `insert into order_payments (order_id, supplier_tenant_id, kind, provider, amount_minor, currency, status, save_consent_at, created_at, updated_at)
     values ($1, $2, 'order', 'stripe', $3, $4, 'creating', $5, $6, $6)`,
    [payment.orderId, payment.supplierTenantId, payment.amountMinor, payment.currency, payment.saveConsentAt, payment.now],
  );
}

export async function findOrderPayment(db: Db, orderId: string, options: { lock?: boolean } = {}): Promise<OrderPayment | null> {
  const result = await db.query<Row>(`select ${PAYMENT_COLUMNS} from order_payments p where p.order_id = $1 and p.kind = 'order' ${options.lock ? "for update" : ""}`, [orderId]);
  const row = result.rows[0];
  return row === undefined ? null : toPayment(row);
}

export async function findPaymentByIntent(db: Db, intentId: string, options: { lock?: boolean } = {}): Promise<OrderPayment | null> {
  const result = await db.query<Row>(`select ${PAYMENT_COLUMNS} from order_payments p where p.intent_id = $1 ${options.lock ? "for update" : ""}`, [intentId]);
  const row = result.rows[0];
  return row === undefined ? null : toPayment(row);
}

export interface PaymentChange {
  intentId?: string;
  customerId?: string | null;
  paymentMethodId?: string | null;
  status?: PaymentStatus;
  lastError?: OrderPayment["lastError"];
  refundedMinor?: number;
  disputed?: boolean;
  paidAfterCancel?: boolean;
  succeededAt?: Date;
}

/** 改收款记录：只改给了的字段。 */
export async function updateOrderPayment(db: Db, paymentId: string, change: PaymentChange, now: Date): Promise<void> {
  await db.query(
    `update order_payments set
       intent_id = coalesce($2, intent_id),
       customer_id = coalesce($3, customer_id),
       payment_method_id = coalesce($4, payment_method_id),
       status = coalesce($5, status),
       last_error = case when $6::boolean then $7::jsonb else last_error end,
       refunded_minor = coalesce($8, refunded_minor),
       disputed = coalesce($9, disputed),
       paid_after_cancel = coalesce($10, paid_after_cancel),
       succeeded_at = coalesce($11, succeeded_at),
       updated_at = $12
     where id = $1`,
    [
      paymentId, change.intentId ?? null, change.customerId ?? null, change.paymentMethodId ?? null, change.status ?? null, change.lastError !== undefined, json(change.lastError ?? null),
      change.refundedMinor ?? null, change.disputed ?? null, change.paidAfterCancel ?? null, change.succeededAt ?? null, now,
    ],
  );
}

// ---- 支付通知 ----

export type PaymentEventResult = "processing" | "applied" | "ignored" | "unmatched" | "mismatch" | "livemode_mismatch";

/** 登记一条通知；同一个事件编号已经登记过（处理过或正在处理）返回 false。并发的同一事件：后到的在这里等前一个事务结束。 */
export async function claimPaymentEvent(db: Db, event: { id: string; type: string; livemode: boolean; objectId: string | null; createdAt: Date; receivedAt: Date }): Promise<boolean> {
  const result = await db.query(
    `insert into payment_events (id, provider, type, livemode, object_id, event_created_at, received_at, result) values ($1, 'stripe', $2, $3, $4, $5, $6, 'processing')
     on conflict (id) do nothing`,
    [event.id, event.type, event.livemode, event.objectId, event.createdAt, event.receivedAt],
  );
  return result.rowCount === 1;
}

export async function finishPaymentEvent(db: Db, eventId: string, result: Exclude<PaymentEventResult, "processing">, orderId: string | null, detail: Record<string, unknown> | null): Promise<void> {
  await db.query("update payment_events set result = $2, order_id = $3, detail = $4::jsonb where id = $1", [eventId, result, orderId, json(detail)]);
}

export interface PaymentEventRecord {
  id: string;
  type: string;
  result: PaymentEventResult;
  eventCreatedAt: Date;
  receivedAt: Date;
  detail: Record<string, unknown> | null;
}

export async function listPaymentEvents(db: Db, orderId: string): Promise<PaymentEventRecord[]> {
  const result = await db.query<Row>("select id, type, result, event_created_at, received_at, detail from payment_events where order_id = $1 order by received_at, id", [orderId]);
  return result.rows.map((row) => ({ id: row["id"], type: row["type"], result: row["result"], eventCreatedAt: row["event_created_at"], receivedAt: row["received_at"], detail: row["detail"] }));
}

// ---- 超时检查 ----

/** 到了付款期限还没付的单（跨租户），最早到期的在前。 */
/** 到了付款期限还待支付的单（只给编号：付款编号要在锁住订单之后重新读，列出之后到处理之间可能刚建好付款）。 */
export async function listOverduePendingOrders(db: Db, now: Date, limit: number): Promise<string[]> {
  const result = await db.query<Row>("select o.id from orders o where o.status = 'pending_payment' and o.payment_due_at <= $1 order by o.payment_due_at, o.id limit $2", [now, limit]);
  return result.rows.map((row) => row["id"] as string);
}

// ---- 列表 ----

export interface TenantOrderFilter {
  status: OrderStatus | null;
  from: string | null;
  to: string | null;
}

/** 租户的订单列表：只有付过款的，按用车时间从早到晚。 */
export async function listTenantOrders(db: Db, tenantId: string, filter: TenantOrderFilter, limit: number, after: TimeCursor | null): Promise<Page<Order> & { total: number }> {
  const where = `o.tenant_id = $1 and o.confirmed_at is not null and ($2::text is null or o.status = $2) and ($3::date is null or o.service_date >= $3) and ($4::date is null or o.service_date <= $4)`;
  const params = [tenantId, filter.status, filter.from, filter.to];
  const result = await db.query<Row>(
    `select ${ORDER_COLUMNS}, o.service_at::text as cursor_time from orders o
      where ${where} and ($5::timestamptz is null or (o.service_at, o.id) > ($5::timestamptz, $6::uuid))
      order by o.service_at, o.id limit $7`,
    [...params, after?.t ?? null, after?.id ?? null, limit + 1],
  );
  const total = await db.query<{ n: number }>(`select count(*)::int as n from orders o where ${where}`, params);
  return { ...toPage(result.rows, limit, toOrder, (row) => ({ t: row["cursor_time"], id: row["id"] })), total: (total.rows[0] as { n: number }).n };
}

/** 租户自己的一张订单（付过款的）；别的租户的、没付款的都当作不存在。 */
export async function findTenantOrder(db: Db, tenantId: string, orderId: string): Promise<Order | null> {
  const result = await db.query<Row>(`select ${ORDER_COLUMNS} from orders o where o.tenant_id = $1 and o.id = $2 and o.confirmed_at is not null`, [tenantId, orderId]);
  const row = result.rows[0];
  return row === undefined ? null : toOrder(row);
}

export interface PlatformOrderFilter {
  status: OrderStatus | null;
  tenantId: string | null;
  channelId: string | null;
  q: string | null;
}

export interface PlatformOrderRow {
  order: Order;
  sale: OrderSale;
  payment: OrderPayment | null;
  tenantName: string;
  channelName: string;
}

/** 运营后台的订单列表：跨租户、跨渠道，按下单时间从新到旧。`q` 按订单号、渠道订单号精确找。销售端一侧、收款、租户和渠道的名字按这一页的订单各一条查询取回。 */
export async function listPlatformOrders(db: Db, filter: PlatformOrderFilter, limit: number, after: TimeCursor | null): Promise<Page<PlatformOrderRow> & { total: number }> {
  const where = `($1::text is null or o.status = $1) and ($2::uuid is null or o.tenant_id = $2) and ($3::uuid is null or s.channel_id = $3) and ($4::text is null or o.order_no = $4 or s.channel_order_no = $4)`;
  const params = [filter.status, filter.tenantId, filter.channelId, filter.q];
  const result = await db.query<Row>(
    `select ${ORDER_COLUMNS}, o.created_at::text as cursor_time from orders o join order_sales s on s.order_id = o.id
      where ${where} and ($5::timestamptz is null or (o.created_at, o.id) < ($5::timestamptz, $6::uuid))
      order by o.created_at desc, o.id desc limit $7`,
    [...params, after?.t ?? null, after?.id ?? null, limit + 1],
  );
  const total = await db.query<{ n: number }>(`select count(*)::int as n from orders o join order_sales s on s.order_id = o.id where ${where}`, params);
  const page = toPage(result.rows, limit, toOrder, (row) => ({ t: row["cursor_time"], id: row["id"] }));
  const ids = page.items.map((order) => order.id);
  const sales = new Map((await db.query<Row>(`select ${SALE_COLUMNS} from order_sales s where s.order_id = any($1::uuid[])`, [ids])).rows.map((row) => [row["order_id"] as string, toSale(row)]));
  const payments = new Map((await db.query<Row>(`select ${PAYMENT_COLUMNS} from order_payments p where p.order_id = any($1::uuid[]) and p.kind = 'order'`, [ids])).rows.map((row) => [row["order_id"] as string, toPayment(row)]));
  const tenants = new Map((await db.query<Row>("select id, name from tenants where id = any($1::uuid[])", [[...new Set(page.items.map((order) => order.tenantId))]])).rows.map((row) => [row["id"] as string, row["name"] as string]));
  const channelIds = [...new Set([...sales.values()].map((sale) => sale.channelId))];
  const channels = new Map((await db.query<Row>("select id, name from channels where id = any($1::uuid[])", [channelIds])).rows.map((row) => [row["id"] as string, row["name"] as string]));
  const items = page.items.map((order): PlatformOrderRow => {
    const sale = sales.get(order.id) as OrderSale;
    return { order, sale, payment: payments.get(order.id) ?? null, tenantName: tenants.get(order.tenantId) ?? "", channelName: channels.get(sale.channelId) ?? "" };
  });
  return { items, nextCursor: page.nextCursor, total: (total.rows[0] as { n: number }).n };
}
