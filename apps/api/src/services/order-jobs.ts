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
 */
import type { AppContext } from "../context.ts";
import { withPlatformTx } from "../db/context.ts";
import { PaymentProviderError, type ProviderPayment } from "../integrations/payments.ts";
import { findOrderForPlatform, findOrderPayment, listOverduePendingOrders } from "../repos/orders.ts";
import { type OrderLog, cancelPendingOrder, confirmPaidOrder } from "./orders.ts";

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
      this.ticking = this.tick()
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
