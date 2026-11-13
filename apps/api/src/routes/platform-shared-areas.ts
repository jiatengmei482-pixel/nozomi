/**
 * 运营后台的区域共享库去重（M8-31b，ADR 0083 补充）：
 * - `GET /platform/v1/shared-areas`：一个城市里库里的全部区域（含隐藏中的），带疑似重复、副本数、隐藏标记（`master_data.read`）；
 * - `POST /platform/v1/shared-areas/{id}/mark-duplicate`：把它标成另一份的重复——共享库里隐藏它，以后引用它的改为引用保留的那份（`master_data.manage`）；
 * - `POST /platform/v1/shared-areas/{id}/unmark-duplicate`：撤销（`master_data.manage`）。
 * 不改任何供应商的区域、副本和报价，所以不走双人复核；每次标记、撤销写审计。这里只做鉴权、校验、调用、返回。
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { SHARED_DUPLICATE_REASON_MAX } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { authenticatePlatform, platformCredentials } from "../services/platform-auth.ts";
import { type PlatformSharedArea, type SharedAreaDuplicate, listSharedAreasForPlatform, markSharedAreaDuplicate, revokeSharedAreaDuplicate } from "../services/shared-areas.ts";
import { parseInput, resourceId, uuidSchema } from "../validation.ts";
import { sharedAreaJson } from "./areas.ts";
import { visibleText } from "./master-data.ts";

type Json = Record<string, unknown>;

const listQuerySchema = z.object({ city_id: uuidSchema, q: z.string().trim().min(1).max(100).optional() });
const markSchema = z.object({ keep_area_id: uuidSchema, reason: visibleText(SHARED_DUPLICATE_REASON_MAX) });
const unmarkSchema = z.object({ reason: visibleText(SHARED_DUPLICATE_REASON_MAX).nullable().default(null) });

function duplicateJson(mark: SharedAreaDuplicate): Json {
  return {
    id: mark.id,
    area_id: mark.areaId,
    keep_area_id: mark.keepAreaId,
    reason: mark.reason,
    marked_by: mark.markedBy,
    marked_at: mark.markedAt.toISOString(),
    revoked_by: mark.revokedBy,
    revoked_at: mark.revokedAt === null ? null : mark.revokedAt.toISOString(),
    revoke_reason: mark.revokeReason,
  };
}

function itemJson(item: PlatformSharedArea): Json {
  const mark = item.duplicate;
  return {
    ...sharedAreaJson(item.area),
    copy_count: item.copyCount,
    duplicate:
      mark === null
        ? null
        : { id: mark.id, keep_area_id: mark.keepAreaId, keep_area_name: mark.keepName, keep_area_listed: mark.keepInLibrary, reason: mark.reason, marked_by: mark.markedBy, marked_at: mark.markedAt.toISOString() },
    similar: item.similar,
  };
}

export function registerPlatformSharedAreaRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/platform/v1/shared-areas", async (request) => {
    await authenticatePlatform(ctx, platformCredentials(request), { action: "master_data.read" });
    const query = parseInput(listQuerySchema, request.query, "querystring");
    const found = await listSharedAreasForPlatform(ctx, { cityId: query.city_id.toLowerCase(), search: query.q });
    return { items: found.items.map(itemJson), truncated: found.truncated };
  });

  app.post("/platform/v1/shared-areas/:id/mark-duplicate", async (request) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "master_data.manage" });
    const id = resourceId(request.params, "共享区域");
    const input = parseInput(markSchema, request.body, "body");
    return duplicateJson(await markSharedAreaDuplicate(ctx, { principal, ip: request.ip }, id, { keepAreaId: input.keep_area_id.toLowerCase(), reason: input.reason }));
  });

  app.post("/platform/v1/shared-areas/:id/unmark-duplicate", async (request) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "master_data.manage" });
    const id = resourceId(request.params, "共享区域");
    const input = parseInput(unmarkSchema, request.body ?? {}, "body");
    return duplicateJson(await revokeSharedAreaDuplicate(ctx, { principal, ip: request.ip }, id, { reason: input.reason }));
  });
}
