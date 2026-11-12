/**
 * 只读核对的接口版（M8-34，ADR 0086）：`GET /platform/v1/reports/area-role-preview`。
 * 和命令行 `pnpm areas:role-preview --json` 是同一份清单（`buildRolePreview`），给 GitHub Actions 的手动工作流用，不用登录服务器。
 *
 * - 先在一个普通平台事务里占一次限速额度（每个员工 10 分钟 3 次）、写一条审计（谁、几天）；
 * - 再在平台的只读快照事务里（`begin … read only`，可重复读）回放，数据库拒绝任何写入；
 * - 回放有墙钟时限（`ROLE_PREVIEW_REPORT_BUDGET_MS`），超过就停下返回 503 `REPORT_TIMEOUT`，请调用方把天数改小。
 * 清单本身没有客人信息、没有坐标（见 area-role-preview.ts）。
 */
import { performance } from "node:perf_hooks";
import type { AppContext } from "../context.ts";
import { withPlatformTx } from "../db/context.ts";
import { AppError } from "../errors.ts";
import { insertAuditLog } from "../repos/audit-logs.ts";
import { type RolePreview, RolePreviewTimeout, buildRolePreview } from "./area-role-preview.ts";
import { consoleOrigin, platformActor } from "./audit.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";
import { rateLimited, takeRateSlot } from "./rate-limit.ts";

/** 回放的墙钟时限：比反向代理常见的 60 秒应答时限短，超时时调用方拿到的是清楚的 503，而不是代理的 504 */
export const ROLE_PREVIEW_REPORT_BUDGET_MS = 45_000;

export function reportTimeout(days: number): AppError {
  return new AppError(503, "REPORT_TIMEOUT", `回放超过 ${ROLE_PREVIEW_REPORT_BUDGET_MS / 1000} 秒还没算完，没有结果；请把天数改小再试`, { days, budget_seconds: ROLE_PREVIEW_REPORT_BUDGET_MS / 1000 });
}

export async function runRolePreviewReport(ctx: AppContext, principal: PlatformPrincipal, days: number, ip: string): Promise<RolePreview> {
  const now = ctx.now();
  await withPlatformTx(ctx.pool, async (db) => {
    const slot = await takeRateSlot(db, principal.user.id, "staff_role_preview", now);
    if (!slot.allowed) throw rateLimited(slot.retryAfterSeconds);
    await insertAuditLog(db, consoleOrigin(platformActor(principal.user), ip, now), { tenantId: null, resource: "area", resourceId: null, action: "view", before: null, after: { report: "area_role_preview", days } });
  });
  const deadline = performance.now() + ROLE_PREVIEW_REPORT_BUDGET_MS;
  try {
    return await withPlatformTx(ctx.pool, (db) => buildRolePreview(db, { days, now, expired: () => performance.now() > deadline }), { snapshot: true });
  } catch (err) {
    if (err instanceof RolePreviewTimeout) throw reportTimeout(days);
    throw err;
  }
}
