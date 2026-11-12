/**
 * 平台的只读核对报告（M8-34，ADR 0086）。
 * - `GET /platform/v1/reports/area-role-preview?days=1..90`（`quote.preview`）：区域用途和报价优先级的回放清单，
 *   和 `pnpm areas:role-preview --json` 同一份结构。限定了数据范围的员工不能用（清单跨全部供应商、城市，切不开）。
 */
import { scopeIsRestricted } from "@nozomi/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.ts";
import { ROLE_PREVIEW_DEFAULT_DAYS, ROLE_PREVIEW_MAX_DAYS } from "../services/area-role-preview.ts";
import { runRolePreviewReport } from "../services/area-role-preview-report.ts";
import { dataScopeDenied } from "../services/errors.ts";
import { authenticatePlatform, platformCredentials } from "../services/platform-auth.ts";
import { parseInput } from "../validation.ts";

const previewQuerySchema = z
  .object({
    days: z
      .string()
      .regex(/^\d{1,2}$/, "必须是十进制整数")
      .transform(Number)
      .pipe(z.number().int().min(1).max(ROLE_PREVIEW_MAX_DAYS))
      .default(String(ROLE_PREVIEW_DEFAULT_DAYS)),
  })
  .strict();

export function registerReportRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/platform/v1/reports/area-role-preview", async (request) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "quote.preview" });
    if (scopeIsRestricted(principal.grant.scope)) throw dataScopeDenied();
    const query = parseInput(previewQuerySchema, request.query, "querystring");
    return runRolePreviewReport(ctx, principal, query.days, request.ip);
  });
}
