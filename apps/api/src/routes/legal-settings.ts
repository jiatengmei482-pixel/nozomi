/**
 * 法律文案待补项（M9E-24，ADR 0107）：
 * - `GET /platform/v1/legal-settings`（`site_settings.read`）、`PUT`（`site_settings.manage`，只归超级管理员；保存过的要带 `If-Match`）；
 * - `GET /site/v1/legal`（公开）：待补项、填没填齐、平台当前的取消政策。官网没开放时也能读（三份文案本来就要先能看到）。
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { LEGAL_FIELD_KEYS, type LegalFieldKey, type LegalFields, legalFieldsComplete, missingLegalFields } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import type { LegalSettingsRow } from "../repos/legal-settings.ts";
import { getLegalSettings, legalRequiredForLaunch, sitePublicLegal, updateLegalSettings } from "../services/legal-settings.ts";
import { authenticatePlatform, platformCredentials } from "../services/platform-auth.ts";
import { takeSiteSlot } from "../services/site.ts";
import { ifMatchVersion, parseInput } from "../validation.ts";
import { cancellationPolicyJson } from "./order-actions.ts";

const fieldsSchema = z
  .object(Object.fromEntries(LEGAL_FIELD_KEYS.map((key) => [key, z.string().max(2_000).nullable()])) as Record<LegalFieldKey, z.ZodNullable<z.ZodString>>)
  .strict();

const updateSchema = z.object({ fields: fieldsSchema }).strict();

function fieldsJson(fields: LegalFields): Record<LegalFieldKey, string | null> {
  return Object.fromEntries(LEGAL_FIELD_KEYS.map((key) => [key, fields[key]])) as Record<LegalFieldKey, string | null>;
}

function settingsJson(ctx: AppContext, settings: LegalSettingsRow) {
  return {
    fields: fieldsJson(settings.fields),
    missing: missingLegalFields(settings.fields),
    complete: legalFieldsComplete(settings.fields),
    required_for_launch: legalRequiredForLaunch(ctx.config.appEnv),
    version: settings.version,
    updated_at: settings.updatedAt?.toISOString() ?? null,
    updated_by: settings.updatedBy,
  };
}

export function registerLegalSettingsRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/platform/v1/legal-settings", async (request) => {
    await authenticatePlatform(ctx, platformCredentials(request), { action: "site_settings.read" });
    return settingsJson(ctx, await getLegalSettings(ctx));
  });

  app.put("/platform/v1/legal-settings", async (request) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "site_settings.manage" });
    const body = parseInput(updateSchema, request.body, "body");
    const header = request.headers["if-match"];
    return settingsJson(ctx, await updateLegalSettings(ctx, principal, request.ip, body.fields, header === undefined ? null : ifMatchVersion(header)));
  });

  app.get("/site/v1/legal", async (request) => {
    await takeSiteSlot(ctx, "site_read", { ip: request.ip });
    const { fields, policy } = await sitePublicLegal(ctx);
    return { fields: fieldsJson(fields), complete: legalFieldsComplete(fields), cancellation_policy: cancellationPolicyJson(policy) };
  });
}
