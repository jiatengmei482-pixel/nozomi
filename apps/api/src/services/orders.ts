/**
 * 下单与付款（M3-01，ADR 0026）。
 *
 * 下单（`POST /sales/v1/orders`）分三步，外部调用不占着数据库事务：
 * 1. 一个平台事务：幂等键（同一个渠道里同一个键 + 同样的内容 → 同一张订单）、报价（本渠道的、没过期、没下过单）、商品还在卖、
 *    客人填的信息（domain 的 `orderDetailsIssues`）、加急库存（咨询锁 + 计数）、每日库存（条件更新预占，防并发超卖）、
 *    建订单（待支付，30 分钟内付款）、销售端一侧（渠道、对外价、加价比例、汇率快照）、收款记录（待建）、状态流水、询价日志记「已下单」。
 *    金额全部来自报价快照，不重新报价。
 * 2. 事务之外：在收款服务（Stripe）建付款——Customer + PaymentIntent（保存支付方式，用于服务后加收）。以订单为准的幂等键，重试不会建出第二笔。
 * 3. 一个平台事务：锁住订单记下付款编号。这时订单如果已经不是待支付（超时被取消了），收款记录保持「已取消」，把刚建的付款取消掉。
 * 过了付款期限（渠道很晚才用同一个键重试）不再建付款、不给付款凭据：还没建付款的单就地取消。
 * 第 2 步失败：订单留在待支付、收款记录还是「待建」，应答 502 / 504 并带上订单号；渠道用同一个 Idempotency-Key 重试就会接着建付款。没人重试的由超时检查取消、释放库存。
 *
 * 付款结果只认收款服务的通知（services/payment-webhooks.ts）和超时检查（services/order-jobs.ts）主动去查，两条路都走这里的 `confirmPaidOrder` / `cancelPendingOrder`。
 */
import { randomInt, randomUUID } from "node:crypto";
import {
  DISPATCH_RULES,
  ORDER_NO_ALPHABET,
  type OrderCancelReason,
  type OrderDetailsInput,
  type OrderDetailsIssueReason,
  type OrderStatus,
  type PaymentStatus,
  type VehicleGrade,
  cancellationRuleFor,
  dispatchDeadline,
  freeCancelAfterUnconfirmedChange,
  landingReportIssue,
  localDateTimeToInstant,
  normalizeFlightNo,
  normalizePhone,
  onPaymentSucceeded,
  orderDetailsIssues,
  orderNumber,
  paymentDeadline,
  paymentMatchesOrder,
  paymentOverdue,
  paymentStatusOf,
  quoteSnapshotValid,
  TENANT_RULES,
  type TenantStatus,
  tenantBids,
  tenantDayStart,
  vehicleLevel,
} from "@nozomi/domain";
import { currentCancellationPolicy } from "../repos/cancellation-policies.ts";
import { type OrderChange, listOrderChanges } from "../repos/order-changes.ts";
import { type ExtraCharge, listExtraCharges } from "../repos/extra-charges.ts";
import { type ChangeSale, type OrderRefund, listChangeSales, listOrderRefunds } from "../repos/refunds.ts";
import type { AppContext } from "../context.ts";
import { type Db, isUniqueViolation, withPlatformTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import { type PaymentProvider, PaymentProviderError, type ProviderPayment } from "../integrations/payments.ts";
import {
  type Order,
  type OrderEventActor,
  type OrderPayment,
  type OrderSale,
  countUrgentOrders,
  findOrderForPlatform,
  findOrderPayment,
  findSale,
  findSaleByIdempotencyKey,
  findSaleByQuote,
  holdInventory,
  insertOrder,
  insertOrderEvent,
  insertOrderPayment,
  insertOrderSale,
  lockUrgentQuota,
  releaseHeldInventory,
  sellHeldInventory,
  updateOrderPayment,
  updateOrderStatus,
} from "../repos/orders.ts";
import { type InputIssue, validationFailed } from "../validation.ts";
import { requestHash } from "./idempotency.ts";
import { countOrdersSince } from "../repos/tenant-onboarding.ts";
import { idempotencyKeyReused, notFound } from "./errors.ts";
import type { SalesPrincipal } from "./sales-auth.ts";
import { QuoteExpired, type StoredQuoteSnapshot } from "./sales-quotes.ts";
import { enqueueTenantEvent } from "./tenant-webhooks.ts";
import { type Driver, type Vehicle, findDriversByIds, findVehiclesByIds } from "../repos/fleet.ts";
import { orderLandingApplies } from "./order-views.ts";
import { landingAlreadyReported, landingChange } from "./driver-trip.ts";

/** 记日志用：Fastify 的 `request.log` / `app.log` 都满足。 */
export interface OrderLog {
  info(entry: Record<string, unknown>, message: string): void;
  warn(entry: Record<string, unknown>, message: string): void;
  error(entry: Record<string, unknown>, message: string): void;
}

export const SILENT_ORDER_LOG: OrderLog = { info: () => undefined, warn: () => undefined, error: () => undefined };

/** Stripe 没配置（三个密钥没填）：不能收款，所以不能下单。和 /health、config:check 的「Stripe 支付：未配置，无法收款」是同一件事。 */
export function paymentNotConfigured(): AppError {
  return new AppError(503, "PAYMENT_NOT_CONFIGURED", "支付未配置（Stripe 还没有配置），现在不能下单。请平台在服务器的设置里填好 Stripe 的三个密钥");
}

export function requirePayments(ctx: AppContext): PaymentProvider {
  if (ctx.payments === null) throw paymentNotConfigured();
  return ctx.payments;
}

/** 收款服务出错 → 应答。订单已经建好时带上订单号，告诉渠道用同一个 Idempotency-Key 重试。 */
function providerFailed(err: PaymentProviderError, order: { id: string; orderNo: string } | null): AppError {
  const status = err.code === "PAYMENT_PROVIDER_TIMEOUT" ? 504 : 502;
  const retry = err.retryable ? "，请稍后用同一个 Idempotency-Key 重试（不会重复下单）" : "";
  return new AppError(status, err.code, `收款服务出错，付款还没有建好${retry}`, { retryable: err.retryable, ...(order === null ? {} : { order_id: order.id, order_no: order.orderNo }) });
}

const DETAIL_MESSAGES: Readonly<Record<OrderDetailsIssueReason, string>> = {
  REQUIRED: "必填",
  NOT_APPLICABLE: "这一单不填这一项",
  INVALID_PHONE: "电话要写成带国家码的国际格式，如 +81 90-1234-5678",
  INVALID_FLIGHT_NO: "航班号的格式不对，如 NH211",
  TOO_LONG: "太长了",
  INVALID_FORMAT: "格式不对",
  CONSENT_REQUIRED: "客人要勾选同意保存支付方式（用于服务后的超时、超公里等费用）才能下单",
};

export interface SalesOrderInput {
  quoteId: string;
  idempotencyKey: string;
  details: OrderDetailsInput;
}

export interface SalesOrderPayment {
  provider: "stripe";
  status: PaymentStatus;
  /** 前端确认付款用；订单不再待支付时为 null */
  clientSecret: string | null;
  publishableKey: string;
}

export interface SalesOrderView {
  order: Order;
  sale: OrderSale;
  payment: OrderPayment | null;
  /** 付款成功后、渠道设置了「付款后展示中标租户名」时才有 */
  winningTenant: { name: string } | null;
  /** 派的司机和车辆（M3-02）；还没派车为 null。司机电话只在用车前 24 小时起给（需求「9. 司机管理」：只展示给客人姓名、照片、语言、联系电话（用车前 24 小时起）） */
  driver: Driver | null;
  vehicle: Vehicle | null;
  /** 现在是不是已经到了可以给客人司机电话的时候 */
  driverPhoneVisible: boolean;
  /** M3-03：退款、改单（和改期的对外价）、事后加收、能不能按「改期没确认」免费取消 */
  refunds: OrderRefund[];
  changes: OrderChange[];
  changeSales: Map<string, ChangeSale>;
  extraCharges: ExtraCharge[];
  freeCancelAvailable: boolean;
}

function orderNoRandom(): string {
  let random = "";
  for (let i = 0; i < 8; i += 1) random += ORDER_NO_ALPHABET[randomInt(ORDER_NO_ALPHABET.length)];
  return random;
}

interface QuoteRow {
  snapshot: StoredQuoteSnapshot;
  quote_log_id: string;
}

interface ProductRow {
  status: string;
  inventory_mode: "unlimited" | "limited";
  service_rules: { urgent: { dailyQuota: number | null } };
  city_id: string;
  poi_id: string | null;
  tenant_status: string;
  timezone: string;
  place_type: string | null;
}

function noLongerAvailable(reason: "PRODUCT_UNPUBLISHED" | "TENANT_SUSPENDED" | "TENANT_NOT_ONBOARDED" | "TRIAL_DAILY_LIMIT"): AppError {
  return new AppError(409, "QUOTE_NO_LONGER_AVAILABLE", "这个报价的车已经不能预订了，请重新询价", { reason });
}

function soldOut(reason: "SOLD_OUT" | "URGENT_SOLD_OUT"): AppError {
  return new AppError(409, "SOLD_OUT", reason === "SOLD_OUT" ? "这一天已经订满了，请重新询价" : "这一天的加急名额已经用完了，请重新询价", { reason });
}

/** 第 1 步：在一个平台事务里校验、占库存、建单。同一个幂等键以前用过返回那张单的编号（`replayed`）。 */
async function placeOrder(ctx: AppContext, principal: SalesPrincipal, input: SalesOrderInput, hash: string): Promise<{ orderId: string; replayed: boolean }> {
  const now = ctx.now();
  return withPlatformTx(ctx.pool, async (db) => {
    const existing = await findSaleByIdempotencyKey(db, principal.channelId, input.idempotencyKey);
    if (existing !== null) {
      if (existing.requestHash !== hash) throw idempotencyKeyReused();
      return { orderId: existing.orderId, replayed: true };
    }
    const quote = (await db.query<QuoteRow>("select snapshot, quote_log_id from quotes where id = $1 and channel_id = $2", [input.quoteId, principal.channelId])).rows[0];
    // 别的渠道的报价和不存在一样
    if (quote === undefined) throw validationFailed("body", [{ path: "/quote_id", reason: "UNKNOWN_QUOTE", message: "报价不存在" }]);
    const snapshot = quote.snapshot;
    if (!quoteSnapshotValid(snapshot, now)) throw new QuoteExpired(snapshot.expiresAt);
    if ((await findSaleByQuote(db, input.quoteId)) !== null) throw new AppError(409, "QUOTE_ALREADY_ORDERED", "这个报价已经下过单了，一个报价只能下一单；要再订一辆请重新询价");
    const { winner } = snapshot;

    const product = (
      await db.query<ProductRow>(
        `select p.status, p.inventory_mode, p.service_rules, p.city_id, p.poi_id, t.status as tenant_status, c.timezone, pl.type as place_type
           from products p join tenants t on t.id = p.tenant_id join cities c on c.id = p.city_id left join places pl on pl.id = p.poi_id
          where p.tenant_id = $1 and p.id = $2`,
        [winner.tenantId, winner.productId],
      )
    ).rows[0];
    // 报价之后（30 分钟内）供应商被暂停、商品被下架：车没法派，不能下单。价格变了不影响——以快照为准
    if (product === undefined || product.status !== "published") throw noLongerAvailable("PRODUCT_UNPUBLISHED");
    if (!tenantBids(product.tenant_status as TenantStatus)) throw noLongerAvailable(product.tenant_status === "suspended" ? "TENANT_SUSPENDED" : "TENANT_NOT_ONBOARDED");
    // 试运营的每日订单上限（ADR 0028）：同一个供应商的下单在这把锁上排队，数完再建单，并发也不会超过上限
    if (product.tenant_status === "trial") {
      await db.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [`trial-daily-limit:${winner.tenantId}`]);
      const today = (await countOrdersSince(db, [winner.tenantId], tenantDayStart(now))).get(winner.tenantId) ?? 0;
      if (today >= TENANT_RULES.trialDailyOrderLimit) throw noLongerAvailable("TRIAL_DAILY_LIMIT");
    }

    const request = snapshot.request;
    const details = input.details;
    const issues: InputIssue[] = orderDetailsIssues(details, {
      category: request.category,
      direction: request.direction,
      placeType: product.place_type === "airport" || product.place_type === "station" ? product.place_type : null,
      hasPickupPoint: request.pickup !== null,
      hasDropoffPoint: request.dropoff !== null,
    }).map((issue) => ({ path: issue.path, reason: issue.reason, message: DETAIL_MESSAGES[issue.reason] }));
    if (issues.length > 0) throw validationFailed("body", issues);

    // 加急库存：同一个商品同一天的下单在这把锁上排队，数完再占
    const urgentQuota = snapshot.urgent ? product.service_rules.urgent.dailyQuota : null;
    if (urgentQuota !== null) {
      await lockUrgentQuota(db, winner.productId, snapshot.serviceDate);
      const used = (await countUrgentOrders(db, [{ tenantId: winner.tenantId, productId: winner.productId, date: snapshot.serviceDate }])).get(`${winner.productId}|${snapshot.serviceDate}`) ?? 0;
      if (used >= urgentQuota) throw soldOut("URGENT_SOLD_OUT");
    }
    // 每日库存（限量的商品）：一条条件更新里判断和预占
    const limited = product.inventory_mode === "limited";
    if (limited && !(await holdInventory(db, winner.tenantId, winner.productId, snapshot.serviceDate, now))) throw soldOut("SOLD_OUT");

    const orderId = randomUUID();
    const serviceAt = localDateTimeToInstant(request.serviceLocal, product.timezone) as Date;
    // 这一单适用的取消阶梯：下单这一刻的平台政策、按品类和车型级别（ADR 0029）。之后政策改了不影响这一单
    const group = (await db.query<{ grade: VehicleGrade; seats: number }>("select grade, seats from vehicle_groups where id = $1", [winner.offer.vehicleGroupId])).rows[0] as { grade: VehicleGrade; seats: number };
    const policy = await currentCancellationPolicy(db);
    const level = vehicleLevel(group.grade, group.seats);
    const cancelPolicy = { version: policy.version, category: request.category, level, tiers: cancellationRuleFor(policy.rules, request.category, level).tiers };
    const freeWait = winner.offer.settlement.freeWait.value;
    const point = (position: { lng: number; lat: number } | null, address: string | null) => (position === null ? null : { lng: position.lng, lat: position.lat, address: (address ?? "").trim() });
    const orderNo = orderNumber(now, orderNoRandom());
    await insertOrder(db, {
      tenantId: winner.tenantId,
      id: orderId,
      orderNo,
      category: request.category,
      cityId: product.city_id,
      placeId: product.poi_id,
      direction: request.direction,
      productId: winner.productId,
      productVersion: winner.productVersion,
      vehicleGroupId: winner.offer.vehicleGroupId,
      packageHours: winner.offer.packageHours,
      serviceAt,
      serviceLocal: request.serviceLocal,
      timezone: product.timezone,
      serviceDate: snapshot.serviceDate,
      urgent: snapshot.urgent,
      passengers: request.passengers,
      luggage: request.luggage,
      pickup: point(request.pickup, details.pickupAddress),
      dropoff: point(request.dropoff, details.dropoffAddress),
      addons: request.addons.map((addon) => ({ addonId: addon.addonId, quantity: addon.quantity })),
      driverLanguage: request.driverLanguage,
      flightNo: details.flightNo === null || details.flightNo.trim() === "" ? null : normalizeFlightNo(details.flightNo),
      passenger: { name: details.passenger.name.trim(), phone: normalizePhone(details.passenger.phone), email: details.passenger.email.trim() },
      messaging: details.messaging === null ? null : { app: details.messaging.app, handle: details.messaging.handle.trim() },
      notes: details.notes === null || details.notes.trim() === "" ? null : details.notes.trim(),
      settlementMinor: winner.offer.settlement.totalMinor,
      settlementCurrency: winner.offer.settlement.currency,
      settlement: winner.offer.settlement,
      freeWaitMinutes: freeWait !== null && freeWait.mode === "limited" ? freeWait.minutes : null,
      inventoryHeld: limited,
      paymentDueAt: paymentDeadline(now),
      createdAt: now,
      cancelPolicy,
    });
    await insertOrderEvent(db, { tenantId: winner.tenantId, id: orderId }, { fromStatus: null, toStatus: "pending_payment", actor: "channel", reason: null, occurredAt: now });
    await insertOrderSale(db, {
      orderId,
      supplierTenantId: winner.tenantId,
      channelId: principal.channelId,
      apiClientId: principal.apiClientId,
      quoteId: input.quoteId,
      idempotencyKey: input.idempotencyKey,
      requestHash: hash,
      channelOrderNo: details.channelOrderNo,
      currency: snapshot.currency,
      sellMinor: winner.sell.sellMinor,
      markupBp: winner.sell.markupBp,
      fx: winner.sell.fx,
      fxBufferBp: winner.sell.fxBufferBp,
      createdAt: now,
    });
    await insertOrderPayment(db, { orderId, supplierTenantId: winner.tenantId, amountMinor: winner.sell.sellMinor, currency: snapshot.currency, saveConsentAt: now, now });
    await db.query("update quote_logs set ordered = true where id = $1", [quote.quote_log_id]);
    return { orderId, replayed: false };
  });
}

/**
 * 第 2、3 步：这张单在收款服务里的付款——还没建就建，建好了就查出给前端用的凭据。订单已经不是待支付时不碰收款服务。
 */
async function ensurePayment(ctx: AppContext, provider: PaymentProvider, orderId: string, log: OrderLog): Promise<ProviderPayment | null> {
  const loaded = await withPlatformTx(ctx.pool, async (db) => ({ order: await findOrderForPlatform(db, orderId), payment: await findOrderPayment(db, orderId) }));
  const order = loaded.order as Order;
  const payment = loaded.payment as OrderPayment;
  if (order.status !== "pending_payment") return null;
  // 过了付款期限：不再建付款、也不再给付款凭据（客人不能再付）。还没建付款的就地取消；建好了的由超时检查先在收款服务取消再取消订单
  if (paymentOverdue(order.paymentDueAt, ctx.now())) {
    if (payment.intentId === null) await withPlatformTx(ctx.pool, (db) => cancelPendingOrder(db, orderId, "PAYMENT_TIMEOUT", "system", ctx.now()));
    return null;
  }
  try {
    if (payment.intentId !== null) return await provider.retrievePayment(payment.intentId);
    const created = await provider.createOrderPayment({
      orderId: order.id,
      orderNo: order.orderNo,
      amountMinor: payment.amountMinor,
      currency: payment.currency,
      customer: order.passenger,
      description: `NOZOMI ${order.orderNo}`,
    });
    const stillPending = await withPlatformTx(ctx.pool, async (db) => {
      const current = (await findOrderForPlatform(db, orderId, { lock: true })) as Order;
      const record = (await findOrderPayment(db, orderId, { lock: true })) as OrderPayment;
      const pending = current.status === "pending_payment" && record.status !== "canceled";
      // 建付款的这段时间里订单被取消了：只记下付款编号（排查用），收款记录保持「已取消」，不改回「等客人付款」
      if (record.intentId === null) await updateOrderPayment(db, record.id, { intentId: created.intentId, customerId: created.customerId, ...(pending ? { status: paymentStatusOf(created.status) } : {}) }, ctx.now());
      return pending;
    });
    if (!stillPending) {
      // 建付款的这段时间里订单被超时取消了：刚建的付款也取消，客人付不了一张已经取消的单
      await provider.cancelPayment(created.intentId).catch((err: unknown) => log.warn({ err, orderId }, "订单已取消，取消刚建的付款失败；超时检查不会再管它，需要人工在 Stripe 后台取消"));
      return null;
    }
    return created;
  } catch (err) {
    if (err instanceof PaymentProviderError) {
      log.warn({ err: { name: err.name, code: err.code, providerCode: err.providerCode }, orderId }, "收款服务出错，付款没有建好");
      throw providerFailed(err, { id: order.id, orderNo: order.orderNo });
    }
    throw err;
  }
}

/** 下单。返回订单和给前端的付款信息；同一个幂等键再来一次返回同一张单（`replayed`）。没配置 Stripe 时 503（`/sales/v1`）。 */
export async function createSalesOrder(ctx: AppContext, principal: SalesPrincipal, input: SalesOrderInput, log: OrderLog = SILENT_ORDER_LOG): Promise<{ view: SalesOrderView; payment: SalesOrderPayment; replayed: boolean }> {
  const provider = requirePayments(ctx);
  const created = await createOrder(ctx, principal, input, provider, log);
  return { ...created, payment: created.payment as SalesOrderPayment };
}

/**
 * 官网下单（ADR 0032）：和渠道下单同一个流程。唯一的不同是没配置 Stripe 时照样建单——订单停在待支付、`payment` 为 null，
 * 到付款期限由超时检查取消、释放库存（还没建付款的单在那里就地取消）。不伪造付款成功。
 */
export async function createSiteOrder(ctx: AppContext, principal: SalesPrincipal, input: SalesOrderInput, log: OrderLog = SILENT_ORDER_LOG): Promise<{ view: SalesOrderView; payment: SalesOrderPayment | null; replayed: boolean }> {
  return createOrder(ctx, principal, input, ctx.payments, log);
}

async function createOrder(ctx: AppContext, principal: SalesPrincipal, input: SalesOrderInput, provider: PaymentProvider | null, log: OrderLog): Promise<{ view: SalesOrderView; payment: SalesOrderPayment | null; replayed: boolean }> {
  const hash = requestHash({ quote_id: input.quoteId, details: input.details });
  let placed: { orderId: string; replayed: boolean };
  try {
    placed = await placeOrder(ctx, principal, input, hash);
  } catch (err) {
    // 同时来了两次（同一个键，或同一个报价）：后到的那次在唯一约束上等前一次提交、整体回滚，再走一遍——
    // 同一个键就按「用过的键」返回那张单，换了键就是「这个报价已经下过单了」
    if (isUniqueViolation(err, "order_sales_idempotency_key") || isUniqueViolation(err, "order_sales_quote_id_key")) placed = await placeOrder(ctx, principal, input, hash);
    else throw err;
  }
  const intent = provider === null ? null : await ensurePayment(ctx, provider, placed.orderId, log);
  const view = await getSalesOrderView(ctx, principal.channelId, placed.orderId);
  if (view === null) throw new Error("刚建的订单读不到");
  return { view, payment: provider === null ? null : paymentFor(view, intent, provider), replayed: placed.replayed };
}

function paymentFor(view: SalesOrderView, intent: ProviderPayment | null, provider: PaymentProvider): SalesOrderPayment {
  return { provider: "stripe", status: view.payment?.status ?? "creating", clientSecret: view.order.status === "pending_payment" ? (intent?.clientSecret ?? null) : null, publishableKey: provider.publishableKey };
}

/**
 * 客人回到订单页接着付款（官网，ADR 0032）：待支付的单还没建付款就建，建好了就查出前端确认付款用的凭据（和下单时同一个 `ensurePayment`）。
 * 没配置 Stripe 503；别的渠道的单和不存在一样。
 */
export async function orderPaymentForChannel(ctx: AppContext, channelId: string, orderId: string, log: OrderLog = SILENT_ORDER_LOG): Promise<SalesOrderPayment> {
  const provider = requirePayments(ctx);
  const before = await getSalesOrderView(ctx, channelId, orderId);
  if (before === null) throw notFound("订单");
  const intent = await ensurePayment(ctx, provider, orderId, log);
  const view = (await getSalesOrderView(ctx, channelId, orderId)) as SalesOrderView;
  return paymentFor(view, intent, provider);
}

/** 渠道查自己的一张订单；别的渠道的和不存在一样。 */
export async function getSalesOrderView(ctx: AppContext, channelId: string, orderId: string): Promise<SalesOrderView | null> {
  return withPlatformTx(
    ctx.pool,
    async (db) => {
      const sale = await findSale(db, orderId);
      if (sale === null || sale.channelId !== channelId) return null;
      const order = (await findOrderForPlatform(db, orderId)) as Order;
      const payment = await findOrderPayment(db, orderId);
      let winningTenant: { name: string } | null = null;
      // 付款前不显示中标租户（第二轮决策）；付款后看渠道的设置
      if (order.confirmedAt !== null) {
        const row = (await db.query<{ name: string; show: boolean }>("select t.name, c.show_tenant_after_pay as show from tenants t, channels c where t.id = $1 and c.id = $2", [order.tenantId, channelId])).rows[0];
        if (row?.show) winningTenant = { name: row.name };
      }
      const driver = order.dispatch.driverId === null ? null : ((await findDriversByIds(db, order.tenantId, [order.dispatch.driverId])).get(order.dispatch.driverId) ?? null);
      const vehicle = order.dispatch.vehicleId === null ? null : ((await findVehiclesByIds(db, order.tenantId, [order.dispatch.vehicleId])).get(order.dispatch.vehicleId) ?? null);
      const driverPhoneVisible = ctx.now().getTime() >= order.serviceAt.getTime() - DISPATCH_RULES.deadlineHoursBeforeService * 3_600_000;
      const changes = await listOrderChanges(db, order.tenantId, orderId);
      return {
        order,
        sale,
        payment,
        winningTenant,
        driver,
        vehicle,
        driverPhoneVisible,
        refunds: await listOrderRefunds(db, orderId),
        changes,
        changeSales: await listChangeSales(db, orderId),
        extraCharges: await listExtraCharges(db, order.tenantId, orderId),
        freeCancelAvailable: order.status !== "cancelled" && freeCancelAfterUnconfirmedChange(changes),
      };
    },
    { snapshot: true },
  );
}

/** 客人在订单页点「我已落地」的状态：付了款、还没接到客人之前都可以点；接机才有。 */
const GUEST_LANDING_STATUSES = new Set(["confirmed", "assigned", "departed", "arrived"]);

/**
 * 客人「我已落地」（`POST /sales/v1/orders/{id}/landed`，第五轮决策 ③：客人确认优先）：只认本渠道的单；时间用系统收到的时间；提交后不能改。
 * 写入后按规则重新取定这一单的落地时间（司机也填了且不一致时取较晚者）。官网的订单页（M3-05）调这个接口。
 */
export async function reportGuestLanding(ctx: AppContext, channelId: string, orderId: string): Promise<SalesOrderView> {
  const now = ctx.now();
  await withPlatformTx(ctx.pool, async (db) => {
    const sale = await findSale(db, orderId);
    const order = sale === null || sale.channelId !== channelId ? null : await findOrderForPlatform(db, orderId, { lock: true });
    if (order === null) throw notFound("订单");
    if (!orderLandingApplies(order)) throw new AppError(409, "LANDING_NOT_APPLICABLE", "这一单不是接机，不需要确认落地");
    if (!GUEST_LANDING_STATUSES.has(order.status)) throw new AppError(409, "ORDER_STATE_INVALID", "订单当前的状态不允许这个操作", { status: order.status, action: "landed" });
    if (order.dispatch.guestLandedAt !== null) throw landingAlreadyReported();
    if (landingReportIssue(now, order.serviceAt, now) !== null) throw new AppError(409, "LANDING_TOO_EARLY", "离计划到达还早，落地后再点「我已落地」");
    const settled = landingChange(order, { guestLandedAt: now, driverLandedAt: order.dispatch.driverLandedAt, driverHasPhoto: order.dispatch.driverLandedFileId !== null });
    await db.query("update orders set guest_landed_at = $3, landed_at = $4, landed_source = $5, version = version + 1, updated_at = $3 where tenant_id = $1 and id = $2", [order.tenantId, order.id, now, settled.landedAt, settled.landedSource]);
  });
  return (await getSalesOrderView(ctx, channelId, orderId)) as SalesOrderView;
}

// ---- 付款成功 / 取消：通知和超时检查共用 ----

export type ConfirmResult = "confirmed" | "already" | "paid_after_cancel" | "mismatch";

/**
 * 收款服务说这笔付款成功了：核对金额和币种，待支付的单自动确认（租户不能拒单），库存从预占转为已售。在调用方的平台事务里执行。
 * 金额或币种对不上：不确认，记日志，由财务核实（`mismatch`）。
 */
export async function confirmPaidOrder(db: Db, payment: OrderPayment, paid: ProviderPayment, actor: OrderEventActor, now: Date, log: OrderLog): Promise<ConfirmResult> {
  const order = (await findOrderForPlatform(db, payment.orderId, { lock: true })) as Order;
  if (!paymentMatchesOrder({ minor: payment.amountMinor, currency: payment.currency }, { minor: paid.amountMinor, currency: paid.currency })) {
    log.error({ orderId: order.id, expected: { minor: payment.amountMinor, currency: payment.currency }, actual: { minor: paid.amountMinor, currency: paid.currency } }, "收到的付款金额或币种和订单对不上，没有确认订单");
    return "mismatch";
  }
  const action = onPaymentSucceeded(order.status);
  await updateOrderPayment(db, payment.id, { status: "succeeded", customerId: paid.customerId, paymentMethodId: paid.paymentMethodId, succeededAt: payment.succeededAt ?? now, ...(action === "paid_after_cancel" ? { paidAfterCancel: true } : {}) }, now);
  if (action === "already") return "already";
  if (action === "paid_after_cancel") {
    log.error({ orderId: order.id, orderNo: order.orderNo }, "订单已经取消，钱却到了（取消付款和付款同时发生）：需要财务核实并退款");
    return "paid_after_cancel";
  }
  await updateOrderStatus(db, order, { status: "confirmed", confirmedAt: now, dispatchDueAt: dispatchDeadline(now, order.serviceAt) }, now);
  if (order.inventoryHeld) await sellHeldInventory(db, order.tenantId, order.productId, order.serviceDate, now);
  await insertOrderEvent(db, order, { fromStatus: "pending_payment", toStatus: "confirmed", actor, reason: "PAYMENT_SUCCEEDED", occurredAt: now });
  // 推单给中标租户（需求「下单转单：通过 Webhook 推送到租户调度系统」）：和确认在同一个事务里排队，确认了就一定会推（ADR 0027）
  await enqueueTenantEvent(db, { tenantId: order.tenantId, type: "order.confirmed", orderId: order.id, data: {} }, now);
  return "confirmed";
}

/** 取消一张待支付的单（超时、付款被取消）：释放预占的库存。已经不是待支付的不动，返回 false。在调用方的平台事务里执行。 */
export async function cancelPendingOrder(db: Db, orderId: string, reason: OrderCancelReason, actor: OrderEventActor, now: Date): Promise<boolean> {
  const order = (await findOrderForPlatform(db, orderId, { lock: true })) as Order;
  if (order.status !== "pending_payment") return false;
  await updateOrderStatus(db, order, { status: "cancelled" as OrderStatus, cancelledAt: now, cancelReason: reason }, now);
  if (order.inventoryHeld) await releaseHeldInventory(db, order.tenantId, order.productId, order.serviceDate, now);
  await insertOrderEvent(db, order, { fromStatus: "pending_payment", toStatus: "cancelled", actor, reason, occurredAt: now });
  const payment = await findOrderPayment(db, orderId, { lock: true });
  if (payment !== null && payment.status !== "succeeded") await updateOrderPayment(db, payment.id, { status: "canceled" }, now);
  return true;
}
