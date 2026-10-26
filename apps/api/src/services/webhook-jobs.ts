/**
 * 推送给供应商的投递任务（M3-02，ADR 0027）：取到期的推送、签名、发送、记结果，失败按退避重试，次数用完记为最终失败。
 *
 * 和汇率中心、订单的定时任务一样跑在 API 进程里（ADR 0022「定时任务和多实例」）：启动后 5 秒第一次，之后每 5 秒一轮（上一轮结束才排下一轮）。
 * 只有服务进程（`buildApp({ jobs: true })`）启动它；测试直接调 `tick()`。
 *
 * - 退避：第一次失败后按 1 分钟、5 分钟、30 分钟、2 小时、6 小时、24 小时重试（需求「销售端接口」的间隔，@nozomi/domain 的 `webhookRetryDelaySeconds`），
 *   第 7 次仍失败就是最终失败：供应商后台和运营后台的投递记录里看得到（状态「失败」和原因），服务日志记一条 `webhook.delivery_failed`（错误级别），可以手动重推。
 * - 多个实例：取到期的推送在一个短事务里「租下」（`for update skip locked` + 把下一次时间改成租约到期的时间），同一条推送同一时刻只有一个实例在发；
 *   发送在事务之外（最多 5 秒）；进程在发送中途退出时，租约（60 秒）到期后别的实例接着发——所以接收方可能偶尔收到同一个 `event_id` 两次，按它去重。
 * - 同一张订单的推送按排队的先后依次投（前一条没投完，后一条不取），接收方不会先收到「改派」再收到「新订单」。
 * - 订阅已删除或暂停：不发，直接记为失败（`WEBHOOK_NOT_CONFIGURED`）。签名密钥解不开（数据加密密钥被换了）：`WEBHOOK_SECRET_UNAVAILABLE`，按失败重试。
 */
import { webhookRetryDelaySeconds } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { withPlatformTx } from "../db/context.ts";
import { SecretBoxError } from "../integrations/secret-box.ts";
import type { WebhookResult } from "../integrations/webhook-sender.ts";
import { type WebhookAttempt, type WebhookDelivery, abandonDelivery, claimDueDeliveries, findDelivery, findTenantWebhook, finishDeliveryAttempt, insertAttempt } from "../repos/webhooks.ts";
import type { OrderLog } from "./orders.ts";
import { type SignedRequest, attemptRecord, deliveryBody, signedRequest } from "./tenant-webhooks.ts";

const FIRST_TICK_MS = 5_000;
const TICK_INTERVAL_MS = 5_000;
const STOP_WAIT_MS = 3_000;
/** 一轮最多取多少条 */
const BATCH = 20;
/** 同时发几条 */
const CONCURRENCY = 4;
/** 租约：比一次发送的时限（5 秒）长得多 */
const LEASE_MS = 60_000;

/** 手动重推的结果：`sent` 发了一次（成败看投递的状态）；`in_flight` 推送任务正在发，这次什么都没做；`not_configured` 设置已删除或暂停，没发。 */
export type DeliverResult = "sent" | "in_flight" | "not_configured";

export interface WebhookSweepResult {
  succeeded: number;
  retrying: number;
  failed: number;
}

export class WebhookJobs {
  private readonly ctx: AppContext;
  private readonly log: OrderLog;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private ticking: Promise<unknown> | null = null;
  private stopped = true;

  constructor(ctx: AppContext, log: OrderLog) {
    this.ctx = ctx;
    this.log = log;
  }

  /** 一轮：取到期的推送，逐条发送（同时最多 4 条）。 */
  async tick(): Promise<WebhookSweepResult> {
    const now = this.ctx.now();
    const due = await withPlatformTx(this.ctx.pool, (db) => claimDueDeliveries(db, now, new Date(now.getTime() + LEASE_MS), BATCH));
    const result: WebhookSweepResult = { succeeded: 0, retrying: 0, failed: 0 };
    const queue = [...due];
    const worker = async (): Promise<void> => {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        const { delivery: done } = await this.deliver(next, "schedule");
        if (done.status === "succeeded") result.succeeded += 1;
        else if (done.status === "failed") result.failed += 1;
        else result.retrying += 1;
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
    return result;
  }

  /**
   * 手动重推之后马上投一次（不等下一轮）：和推送任务一样先租下（写租约令牌）再发。
   * 这条推送已经被推送任务或别的实例租走时什么都不做（`in_flight`），返回现在的状态。
   */
  async deliverNow(tenantId: string, deliveryId: string): Promise<{ delivery: WebhookDelivery; result: DeliverResult }> {
    const now = this.ctx.now();
    const claimed = await withPlatformTx(this.ctx.pool, async (db) => {
      const result = await db.query<{ id: string }>(
        "update webhook_deliveries set next_attempt_at = $3, lease_token = gen_random_uuid() where tenant_id = $1 and id = $2 and status = 'pending' and next_attempt_at <= $4 returning id",
        [tenantId, deliveryId, new Date(now.getTime() + LEASE_MS), now],
      );
      return (result.rowCount ?? 0) === 1 ? findDelivery(db, tenantId, deliveryId) : null;
    });
    if (claimed === null) return { delivery: await this.current({ tenantId, id: deliveryId }), result: "in_flight" };
    return this.deliver(claimed, "manual");
  }

  private async current(delivery: Pick<WebhookDelivery, "tenantId" | "id">): Promise<WebhookDelivery> {
    return (await withPlatformTx(this.ctx.pool, (db) => findDelivery(db, delivery.tenantId, delivery.id))) as WebhookDelivery;
  }

  /** 发一次并记结果：`sent` 发了并记上；`not_configured` 设置已删除或暂停，没发、记为最终失败；`in_flight` 租约已被接手，结果没记。 */
  private async deliver(delivery: WebhookDelivery, trigger: WebhookAttempt["trigger"]): Promise<{ delivery: WebhookDelivery; result: DeliverResult }> {
    const startedAt = this.ctx.now();
    const attemptNo = delivery.attempts + 1;
    const prepared = await withPlatformTx(this.ctx.pool, async (db) => {
      const webhook = await findTenantWebhook(db, delivery.tenantId);
      if (webhook === null || webhook.status !== "active") return null;
      return { webhook, body: await deliveryBody(db, delivery, startedAt) };
    });
    if (prepared === null) {
      this.log.warn({ event: "webhook.delivery_abandoned", tenantId: delivery.tenantId, eventId: delivery.eventId }, "供应商的 Webhook 已删除或暂停，这条推送不再发送");
      const abandoned = await withPlatformTx(this.ctx.pool, (db) => abandonDelivery(db, delivery, "WEBHOOK_NOT_CONFIGURED", startedAt));
      return abandoned === null ? { delivery: await this.leaseLost(delivery), result: "in_flight" } : { delivery: abandoned, result: "not_configured" };
    }
    let request: SignedRequest | null = null;
    let result: WebhookResult;
    try {
      request = signedRequest(this.ctx, prepared.webhook, delivery, prepared.body, attemptNo, startedAt);
      result = await this.ctx.webhookSender.send(request);
    } catch (err) {
      if (!(err instanceof SecretBoxError)) throw err;
      result = { statusCode: null, errorCode: null, durationMs: 0, targetHost: new URL(prepared.webhook.url).host };
    }
    const outcome = { ...result, errorCode: request === null ? "WEBHOOK_SECRET_UNAVAILABLE" : result.errorCode };
    const finishedAt = this.ctx.now();
    const ok = outcome.errorCode === null;
    const delay = ok ? null : webhookRetryDelaySeconds(attemptNo);
    const next = ok ? { status: "succeeded" as const, nextAttemptAt: null } : delay === null ? { status: "failed" as const, nextAttemptAt: null } : { status: "pending" as const, nextAttemptAt: new Date(finishedAt.getTime() + delay * 1000) };
    // 先核对租约再记尝试：租约已被别人接手（到期后别的实例取走、手动重推收回）时这一方什么都不记
    const saved = await withPlatformTx(this.ctx.pool, async (db) => {
      const finished = await finishDeliveryAttempt(db, delivery, { statusCode: outcome.statusCode, errorCode: outcome.errorCode, durationMs: outcome.durationMs, at: finishedAt }, next);
      if (finished !== null) await insertAttempt(db, delivery.tenantId, delivery.id, attemptRecord(outcome, request, attemptNo, trigger, startedAt));
      return finished;
    });
    if (saved === null) return { delivery: await this.leaseLost(delivery), result: "in_flight" };
    if (saved.status === "failed") {
      this.log.error({ event: "webhook.delivery_failed", tenantId: delivery.tenantId, eventId: delivery.eventId, eventType: delivery.eventType, attempts: saved.attempts, errorCode: outcome.errorCode, statusCode: outcome.statusCode }, "推送给供应商的 Webhook 重试用完仍然失败，需要人工处理（可在后台手动重推）");
    } else if (saved.status === "pending") {
      this.log.warn({ event: "webhook.delivery_retry", tenantId: delivery.tenantId, eventId: delivery.eventId, attempts: saved.attempts, errorCode: outcome.errorCode, statusCode: outcome.statusCode }, "推送给供应商的 Webhook 失败，稍后重试");
    }
    return { delivery: saved, result: "sent" };
  }

  private async leaseLost(delivery: WebhookDelivery): Promise<WebhookDelivery> {
    this.log.warn({ event: "webhook.lease_lost", tenantId: delivery.tenantId, eventId: delivery.eventId }, "这条推送的租约已被接手，本次结果不记");
    return this.current(delivery);
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    const run = (): void => {
      this.ticking = this.tick()
        .catch((err: unknown) => this.log.warn({ err }, "Webhook 推送任务这一轮出错，下一轮再试"))
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
