/**
 * 订单异常队列（M4-02，ADR 0034；需求「订单中心与异常处理 · 异常队列」：系统自动生成，处理完标记关闭）。
 *
 * - 生成：订单定时任务每一轮（`OrderJobs.exceptions()`）按触发条件生成、条件解除的自动关闭（`repos/exceptions.ts` 的 `syncExceptions`）；
 *   同一轮给还没有审核工单的 no-show 申请建工单（「no-show 待审核：转工单审核」）。
 * - 处理：运营后台认领（不给人就是自己，也可以转给别人）、写处理说明后关闭（`exception.manage`），全部写审计日志。
 *   处理本身（催供应商、发起救援、重发推送、重试退款……）用订单上已有的操作；这里记谁在处理、什么结论。
 */
import { exceptionActionRefusal } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { withPlatformTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import { insertAuditLog } from "../repos/audit-logs.ts";
import { type ExceptionFilter, type ExceptionRow, type OrderException, findException, findExceptionRow, listExceptions, syncExceptions, updateException } from "../repos/exceptions.ts";
import type { Page, TimeCursor } from "../pagination.ts";
import { consoleOrigin, platformActor } from "./audit.ts";
import { notFound } from "./errors.ts";
import type { OrderLog } from "./orders.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";
import { createNoShowReviewTickets } from "./tickets.ts";

export interface ExceptionSweepResult {
  opened: number;
  cleared: number;
  noShowTickets: number;
}

/** 一轮：生成新的异常、关闭条件已解除的、给 no-show 申请建审核工单。 */
export async function sweepExceptions(ctx: AppContext, log: OrderLog): Promise<ExceptionSweepResult> {
  const now = ctx.now();
  const result = await withPlatformTx(ctx.pool, async (db) => {
    const noShowTickets = await createNoShowReviewTickets(db, now);
    const synced = await syncExceptions(db, now);
    return { ...synced, noShowTickets };
  });
  for (const row of result.opened) log.warn({ event: "order.exception_opened", exceptionId: row.id, type: row.type, orderId: row.orderId, tenantId: row.tenantId }, "异常队列：新的异常");
  return { opened: result.opened.length, cleared: result.cleared.length, noShowTickets: result.noShowTickets };
}

export async function listExceptionsForPlatform(ctx: AppContext, filter: ExceptionFilter, limit: number, after: TimeCursor | null): Promise<Page<ExceptionRow> & { total: number }> {
  return withPlatformTx(ctx.pool, (db) => listExceptions(db, filter, limit, after), { snapshot: true });
}

export async function getException(ctx: AppContext, id: string): Promise<ExceptionRow> {
  return withPlatformTx(
    ctx.pool,
    async (db) => {
      const found = await findExceptionRow(db, id);
      if (found === null) throw notFound("异常");
      return found;
    },
    { snapshot: true },
  );
}

function auditValues(exception: OrderException): Record<string, string | null> {
  return { type: exception.type, status: exception.status, order_id: exception.orderId, assignee_id: exception.assigneeId };
}

function closedError(exception: OrderException): AppError {
  return new AppError(409, "EXCEPTION_CLOSED", "这条异常已经关闭了", { status: exception.status, close_kind: exception.closeKind });
}

/** 认领：不给人就是自己；给了就是转给那个人（在用的平台员工）。 */
export async function claimException(ctx: AppContext, principal: PlatformPrincipal, id: string, assigneeId: string | null, ip: string): Promise<ExceptionRow> {
  const now = ctx.now();
  const origin = consoleOrigin(platformActor(principal.user), ip, now);
  await withPlatformTx(ctx.pool, async (db) => {
    const exception = await findException(db, id, { lock: true });
    if (exception === null) throw notFound("异常");
    if (exceptionActionRefusal(exception.status) !== null) throw closedError(exception);
    const target = assigneeId ?? principal.user.id;
    const staff = (await db.query<{ status: string }>("select status from platform_users where id = $1", [target])).rows[0];
    if (staff === undefined || staff.status !== "active") throw new AppError(422, "ASSIGNEE_INVALID", "指定的人不存在或没有在用", { assignee_id: target });
    const updated = (await updateException(db, exception, { status: "claimed", assigneeId: target, claimedAt: now }, now)) as OrderException;
    await insertAuditLog(db, origin, { tenantId: null, resource: "order_exception", resourceId: id, action: "claim", before: auditValues(exception), after: auditValues(updated) });
  });
  return getException(ctx, id);
}

/** 关闭：写处理说明（必填）。 */
export async function closeException(ctx: AppContext, principal: PlatformPrincipal, id: string, resolution: string, ip: string): Promise<ExceptionRow> {
  const now = ctx.now();
  const origin = consoleOrigin(platformActor(principal.user), ip, now);
  await withPlatformTx(ctx.pool, async (db) => {
    const exception = await findException(db, id, { lock: true });
    if (exception === null) throw notFound("异常");
    if (exceptionActionRefusal(exception.status) !== null) throw closedError(exception);
    const updated = (await updateException(db, exception, { status: "closed", closeKind: "resolved", closedAt: now, closedBy: principal.user.id, resolution }, now)) as OrderException;
    await insertAuditLog(db, origin, { tenantId: null, resource: "order_exception", resourceId: id, action: "close", before: auditValues(exception), after: { ...auditValues(updated), resolution } });
  });
  return getException(ctx, id);
}
