/**
 * 只读核对的接口版（M8-34，ADR 0086）：`GET /platform/v1/reports/area-role-preview`。
 * 和命令行 `pnpm areas:role-preview --json` 是同一份清单（`buildRolePreview`），给 GitHub Actions 的手动工作流用，不用登录服务器。
 *
 * - 先在一个普通平台事务里占一次限速额度（每个员工 10 分钟 3 次）、写一条审计（谁、几天）；
 * - 再在平台的只读快照事务里（`begin … read only`，可重复读）回放，数据库拒绝任何写入；
 * - 回放有时限（默认 `ROLE_PREVIEW_REPORT_BUDGET_MS`）：每条查询之前看剩下多少时间，到了就停；数据库端的单条语句时限（`statement_timeout`）
 *   跟着剩下的时间往下收，一条慢查询也不会越过时限。超过返回 503 `REPORT_TIMEOUT`，请调用方把天数改小。
 * 清单本身没有客人信息、没有坐标（见 area-role-preview.ts）。
 */
import { performance } from "node:perf_hooks";
import type { AppContext } from "../context.ts";
import { type Db, withPlatformTx } from "../db/context.ts";
import { DEFAULT_STATEMENT_TIMEOUT_MS } from "../db/pool.ts";
import { AppError } from "../errors.ts";
import { insertAuditLog } from "../repos/audit-logs.ts";
import { type RolePreview, RolePreviewTimeout, buildRolePreview } from "./area-role-preview.ts";
import { consoleOrigin, platformActor } from "./audit.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";
import { rateLimited, takeRateSlot } from "./rate-limit.ts";

/** 回放的时限：比反向代理常见的 60 秒应答时限短，超时时调用方拿到的是清楚的 503，而不是代理的 504 */
export const ROLE_PREVIEW_REPORT_BUDGET_MS = 45_000;

/** 数据库取消了超过时限的语句（`statement_timeout`） */
const QUERY_CANCELED = "57014";

export function reportTimeout(days: number, budgetMs: number): AppError {
  const seconds = Math.ceil(budgetMs / 1000);
  return new AppError(503, "REPORT_TIMEOUT", `回放超过 ${seconds} 秒还没算完，没有结果；请把天数改小再试`, { days, budget_seconds: seconds });
}

/**
 * 给只读事务套一个时限：每条查询之前看剩下的时间（没了就抛 `RolePreviewTimeout`）；剩下的时间比当前的 `statement_timeout` 短时，
 * 先 `set local statement_timeout` 收到剩下的时间（按整秒收，最后一秒按毫秒），被数据库取消的语句也算超时。
 * 事务开头先把 `statement_timeout` 设成「连接池的默认值」和「时限」中较小的一个。
 */
export async function withDeadline(db: Db, deadline: number, clock: () => number = () => performance.now()): Promise<Db> {
  let applied = Math.max(1, Math.min(DEFAULT_STATEMENT_TIMEOUT_MS, Math.floor(deadline - clock())));
  await db.query(`set local statement_timeout = ${applied}`);
  const query = async (input: unknown, values?: unknown[]): Promise<unknown> => {
    const remaining = Math.floor(deadline - clock());
    if (remaining <= 0) throw new RolePreviewTimeout();
    if (remaining < applied) {
      applied = remaining > 1000 ? Math.floor(remaining / 1000) * 1000 : remaining;
      await db.query(`set local statement_timeout = ${applied}`);
    }
    try {
      return await (db.query as (input: unknown, values?: unknown[]) => Promise<unknown>)(input, values);
    } catch (err) {
      if ((err as { code?: unknown } | null)?.code === QUERY_CANCELED) throw new RolePreviewTimeout();
      throw err;
    }
  };
  return { query } as Db;
}

export async function runRolePreviewReport(ctx: AppContext, principal: PlatformPrincipal, days: number, ip: string, budgetMs: number = ROLE_PREVIEW_REPORT_BUDGET_MS): Promise<RolePreview> {
  const now = ctx.now();
  await withPlatformTx(ctx.pool, async (db) => {
    const slot = await takeRateSlot(db, principal.user.id, "staff_role_preview", now);
    if (!slot.allowed) throw rateLimited(slot.retryAfterSeconds);
    await insertAuditLog(db, consoleOrigin(platformActor(principal.user), ip, now), { tenantId: null, resource: "area", resourceId: null, action: "view", before: null, after: { report: "area_role_preview", days } });
  });
  const deadline = performance.now() + budgetMs;
  try {
    return await withPlatformTx(
      ctx.pool,
      async (db) => buildRolePreview(await withDeadline(db, deadline), { days, now, expired: () => performance.now() > deadline }),
      { snapshot: true },
    );
  } catch (err) {
    if (err instanceof RolePreviewTimeout) throw reportTimeout(days, budgetMs);
    throw err;
  }
}
