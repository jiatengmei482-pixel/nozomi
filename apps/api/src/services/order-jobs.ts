/**
 * 订单的定时任务（M3-01，ADR 0026）：待支付超时自动取消、释放库存（需求「取消或超时未支付自动释放」）。
 *
 * 和汇率中心一样跑在 API 进程里（ADR 0022「定时任务和多实例」）：启动后 5 秒第一次，之后每 60 秒一轮（上一轮结束才排下一轮，`unref` 不拖住进程退出）。
 * 只有服务进程（`buildApp({ jobs: true })`）启动它；测试直接调 `tick()`。
 *
 * 每一轮：找出到了付款期限（下单后 30 分钟）还没付款的单，一张一张处理。处理每一张时先锁住订单、**重新读收款记录**
 * （列出之后到处理之间，渠道可能刚用同一个 Idempotency-Key 重试、建好了付款），再决定：
 * - 还没在收款服务建好付款的：在同一个事务里直接取消（下单第 3 步锁住订单后看到已取消，会把它刚建的付款取消掉）；
 * - 建好了的：先在收款服务**取消这笔付款**（事务之外），再看结果——
 *   已取消 → 取消订单、释放库存；其实已经付了（客人在最后一刻付款、通知还没到）→ 按付款成功确认订单；还在处理中 → 这一轮不动，等通知或下一轮；
 *   收款服务出错 → 这一轮跳过，下一轮再试。
 * 先取消付款再取消订单：保证不会出现「订单取消了，客人却还能付款」。
 * 多个实例同时跑：取消订单、确认订单都先锁住订单行再看状态，同一张单只会被处理一次；收款服务那边重复取消也没关系。
 *
 * 同一个定时任务里还做履约的提醒（M3-02，ADR 0027，`remind()`）：
 * - 过了派车截止时间还没派车：订单上记下发现的时间（供应商后台的订单列表标红置顶、运营后台看得到），服务日志记一条 `order.dispatch_overdue`；
 * - 用车前 1 小时仍未「已出发」：同样记下时间，日志 `order.departure_overdue`。
 * 每张单各提醒一次（记下了时间就不再提醒）；一条条件更新完成「找出来 + 记下」，多个实例同时跑也只提醒一次。
 * 邮件、LINE 等通知渠道在通知中心任务里接。
 *
 * 救援改派（M3-04，ADR 0031，`rescue()`）：用车前 6 小时（且过了派车截止时间）仍未派车的单自动进入救援；到点 15 分钟仍未到达的单记下提醒（进救援队列，由运营判定）；
 * 超时没接的救援单顺延下一家。
 *
 * 还有钱的事（M3-03，ADR 0029，`money()`）：
 * - 退款：到时候该发的（等着发的、收款服务出错后等重试的、租约到期的）发一次；
 * - 改单：供应商 30 分钟没确认的改期记为超时（补收的差价退回，客人可以免费取消）；补差价卡住的（收款服务出错、进程中途退出）接着扣；
 * - 事后加收：48 小时异议期到了的，不用审核的自动扣款、要审核的转待审核；审核通过的、等重试的扣款。
 */
import type { AppContext } from "../context.ts";
import { withPlatformTx } from "../db/context.ts";
import { PaymentProviderError, type ProviderPayment } from "../integrations/payments.ts";
import { findOrderForPlatform, findOrderPayment, listOverduePendingOrders } from "../repos/orders.ts";
import { DISPATCH_RULES } from "@nozomi/domain";
import { type OrderLog, cancelPendingOrder, confirmPaidOrder } from "./orders.ts";
import { processDueRefunds } from "./order-money.ts";
import { sweepOrderChanges } from "./order-changes.ts";
import { sweepExtraCharges } from "./extra-charges.ts";
import { type RescueSweepResult, sweepRescues } from "./rescues.ts";

const FIRST_TICK_MS = 5_000;
const TICK_INTERVAL_MS = 60_000;
const STOP_WAIT_MS = 3_000;
/** 一轮最多处理多少张：每张最多一次收款服务的调用，一轮不会拖太久 */
const BATCH = 50;

export interface OrderSweepResult {
  cancelled: number;
  confirmed: number;
  /** 还在处理中、或收款服务出错，留给下一轮 */
  deferred: number;
}

export interface MoneyResult {
  refunds: Awaited<ReturnType<typeof processDueRefunds>>;
  changes: Awaited<ReturnType<typeof sweepOrderChanges>>;
  extraCharges: Awaited<ReturnType<typeof sweepExtraCharges>>;
}

export interface ReminderResult {
  dispatchOverdue: number;
  departureOverdue: number;
}

export class OrderJobs {
  private readonly ctx: AppContext;
  private readonly log: OrderLog;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ticking: Promise<unknown> | null = null;
  private stopped = true;

  constructor(ctx: AppContext, log: OrderLog) {
    this.ctx = ctx;
    this.log = log;
  }

  /** 一轮：处理到期的待支付订单。 */
  async tick(): Promise<OrderSweepResult> {
    const now = this.ctx.now();
    const due = await withPlatformTx(this.ctx.pool, (db) => listOverduePendingOrders(db, now, BATCH));
    const result: OrderSweepResult = { cancelled: 0, confirmed: 0, deferred: 0 };
    for (const orderId of due) {
      const outcome = await this.expire(orderId);
      result[outcome] += 1;
    }
    return result;
  }

  /** 履约的提醒：超时未派车、用车前 1 小时仍未出发。每张单只提醒一次。 */
  async remind(): Promise<ReminderResult> {
    const now = this.ctx.now();
    const departureCutoff = new Date(now.getTime() + DISPATCH_RULES.departureReminderMinutesBeforeService * 60_000);
    const { dispatch, departure } = await withPlatformTx(this.ctx.pool, async (db) => {
      const dispatchRows = await db.query<{ id: string; tenant_id: string; order_no: string; dispatch_due_at: Date }>(
        `update orders set dispatch_overdue_at = $1 where (tenant_id, id) in (
           select tenant_id, id from orders where status = 'confirmed' and dispatch_due_at <= $1 and dispatch_overdue_at is null order by dispatch_due_at limit $2 for update skip locked)
         returning id, tenant_id, order_no, dispatch_due_at`,
        [now, BATCH],
      );
      const departureRows = await db.query<{ id: string; tenant_id: string; order_no: string; service_at: Date }>(
        `update orders set departure_overdue_at = $1 where (tenant_id, id) in (
           select tenant_id, id from orders where status = 'assigned' and service_at <= $2 and departure_overdue_at is null order by service_at limit $3 for update skip locked)
         returning id, tenant_id, order_no, service_at`,
        [now, departureCutoff, BATCH],
      );
      return { dispatch: dispatchRows.rows, departure: departureRows.rows };
    });
    for (const row of dispatch) this.log.warn({ event: "order.dispatch_overdue", orderId: row.id, tenantId: row.tenant_id, orderNo: row.order_no, dueAt: row.dispatch_due_at.toISOString() }, "超时未派车：过了派车截止时间还没有派司机和车辆");
    for (const row of departure) this.log.warn({ event: "order.departure_overdue", orderId: row.id, tenantId: row.tenant_id, orderNo: row.order_no, serviceAt: row.service_at.toISOString() }, "用车前 1 小时司机仍未出发");
    return { dispatchOverdue: dispatch.length, departureOverdue: departure.length };
  }

  /** 救援改派（M3-04）：未派车自动触发、司机未到的提醒、救援单超时顺延。 */
  async rescue(): Promise<RescueSweepResult> {
    return sweepRescues(this.ctx, this.log);
  }

  /** 退款、改单超时、事后加收（M3-03）。 */
  async money(): Promise<MoneyResult> {
    const changes = await sweepOrderChanges(this.ctx, this.log);
    const extraCharges = await sweepExtraCharges(this.ctx, this.log);
    const refunds = await processDueRefunds(this.ctx, this.log);
    return { refunds, changes, extraCharges };
  }

  private async expire(orderId: string): Promise<keyof OrderSweepResult> {
    // 锁住订单再读收款记录：还没建付款的就在这个事务里取消；建好了的拿到最新的付款编号，先去收款服务取消
    const first = await withPlatformTx(this.ctx.pool, async (db): Promise<{ outcome: keyof OrderSweepResult } | { intentId: string }> => {
      const order = await findOrderForPlatform(db, orderId, { lock: true });
      if (order === null || order.status !== "pending_payment") return { outcome: "deferred" };
      const record = await findOrderPayment(db, orderId, { lock: true });
      if (record === null || record.intentId === null || this.ctx.payments === null) {
        return { outcome: (await cancelPendingOrder(db, orderId, "PAYMENT_TIMEOUT", "system", this.ctx.now())) ? "cancelled" : "deferred" };
      }
      return { intentId: record.intentId };
    });
    if ("outcome" in first) return first.outcome;
    const intentId = first.intentId;
    let payment: ProviderPayment | null = null;
    if (this.ctx.payments !== null) {
      try {
        payment = await this.ctx.payments.cancelPayment(intentId);
      } catch (err) {
        const code = err instanceof PaymentProviderError ? err.code : null;
        this.log.warn({ orderId, code }, "超时取消：在收款服务取消付款失败，下一轮再试");
        return "deferred";
      }
      if (payment.status === "processing" || payment.status === "requires_capture") return "deferred";
    }
    const now = this.ctx.now();
    return withPlatformTx(this.ctx.pool, async (db) => {
      if (payment !== null && payment.status === "succeeded") {
        const record = await findOrderPayment(db, orderId);
        if (record === null) return "deferred";
        const confirmed = await confirmPaidOrder(db, record, payment, "system", now, this.log);
        return confirmed === "confirmed" ? "confirmed" : "deferred";
      }
      return (await cancelPendingOrder(db, orderId, "PAYMENT_TIMEOUT", "system", now)) ? "cancelled" : "deferred";
    });
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    const run = (): void => {
      // 每轮先看一眼运营后台填写的密钥过没过期（ADR 0041）：取消待支付订单要用生效的 Stripe 密钥
      this.ticking = this.ctx.integrations
        .ensureFresh()
        .then(() => this.tick())
        .then(() => this.remind())
        .then(() => this.rescue())
        .then(() => this.money())
        .catch((err: unknown) => this.log.warn({ err }, "订单定时任务这一轮出错，下一轮再试"))
        .finally(() => {
          this.ticking = null;
          if (!this.stopped) this.schedule(run, TICK_INTERVAL_MS);
        });
    };
    this.schedule(run, FIRST_TICK_MS);
  }

  private schedule(run: () => void, delayMs: number): void {
    this.timer = setTimeout(run, delayMs);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.ticking !== null) await Promise.race([this.ticking, new Promise((resolve) => setTimeout(resolve, STOP_WAIT_MS).unref())]);
  }
}
