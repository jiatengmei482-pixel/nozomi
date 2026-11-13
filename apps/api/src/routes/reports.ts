/**
 * 平台的只读核对报告（M8-34，ADR 0086）。
 * - `GET /platform/v1/reports/area-role-preview?days=1..90&until=ISO 时间`（`quote.preview`）：区域用途和报价优先级的回放清单，
 *   和 `pnpm areas:role-preview --json` 同一份结构。`until`（可选，默认现在，不能晚于现在）固定回放的截止时间，引擎改动前后比对用。限定了数据范围的员工不能用（清单跨全部供应商、城市，切不开）。
 */
import { scopeIsRestricted } from "@nozomi/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.ts";
import { ROLE_PREVIEW_DEFAULT_DAYS, ROLE_PREVIEW_MAX_DAYS } from "../services/area-role-preview.ts";
import { ROLE_PREVIEW_REPORT_BUDGET_MS, runRolePreviewReport } from "../services/area-role-preview-report.ts";
import { dataScopeDenied } from "../services/errors.ts";
import { authenticatePlatform, platformCredentials } from "../services/platform-auth.ts";
import { dateTimeSchema, parseInput, validationFailed } from "../validation.ts";

const previewQuerySchema = z
  .object({
    days: z
      .string()
      .regex(/^\d{1,2}$/, "必须是十进制整数")
      .transform(Number)
      .pipe(z.number().int().min(1).max(ROLE_PREVIEW_MAX_DAYS))
      .default(String(ROLE_PREVIEW_DEFAULT_DAYS)),
    until: dateTimeSchema.optional(),
  })
  .strict();

export function registerReportRoutes(app: FastifyInstance, ctx: AppContext, budgetMs: number = ROLE_PREVIEW_REPORT_BUDGET_MS): void {
  app.get("/platform/v1/reports/area-role-preview", async (request) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "quote.preview" });
    if (scopeIsRestricted(principal.grant.scope)) throw dataScopeDenied();
    const query = parseInput(previewQuerySchema, request.query, "querystring");
    const now = ctx.now();
    if (query.until !== undefined && query.until.getTime() > now.getTime()) throw validationFailed("querystring", [{ path: "/until", message: "不能晚于现在" }]);
    return runRolePreviewReport(ctx, principal, { days: query.days, until: query.until ?? now, now }, request.ip, budgetMs);
  });
}
