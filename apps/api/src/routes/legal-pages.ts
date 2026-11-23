/**
 * 法律页面（M9E-24，ADR 0107）：
 * - `GET /site/v1/legal-pages`：官网、嵌入页的三页用（业主留空的几项 + 平台当前的取消政策，取消费表按它生成）
 * - `GET/PUT /platform/v1/legal-page-settings`：运营后台「官网设置」里填那几项（权限同官网设置）
 */
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { AppContext } from "../context.ts";
import type { LegalPageSettingsRow, LegalPageValues } from "../repos/legal-pages.ts";
import { legalPagesComplete } from "../repos/legal-pages.ts";
import { getCancellationPolicy } from "../services/cancellation-policy.ts";
import { getLegalPageSettings, publicLegalPageValues, updateLegalPageSettings } from "../services/legal-pages.ts";
import { authenticatePlatform, platformCredentials } from "../services/platform-auth.ts";
import { takeSiteSlot } from "../services/site.ts";
import { ifMatchVersion, parseInput } from "../validation.ts";
import { cancellationPolicyJson } from "./order-actions.ts";

type Json = Record<string, unknown>;

/** 空白算没填（null）；去掉首尾空白；限制长度、不许换行以外的控制字符 */
const text = (max: number) =>
  z
    .string()
    .max(max * 4)
    .nullable()
    .transform((value, issue) => {
      if (value === null) return null;
      const trimmed = value.trim();
      if (trimmed === "") return null;
      if ([...trimmed].length > max) issue.addIssue({ code: "custom", message: `最多 ${max} 个字` });
      if (/[\u0000-\u0009\u000b-\u001f\u007f]/.test(trimmed)) issue.addIssue({ code: "custom", message: "不能有控制字符" });
      return trimmed;
    });

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const settingsSchema = z
  .object({
    seller: text(200),
    japan_contact: text(300),
    email: text(254).superRefine((value, issue) => {
      if (value !== null && !EMAIL.test(value)) issue.addIssue({ code: "custom", message: "请填写邮箱地址，例如 support@example.com" });
    }),
    mail_provider: text(100),
    mail_provider_country: text(40),
    map_provider: text(100),
    map_provider_country: text(40),
    server_provider: text(100),
    server_provider_country: text(40),
    published_on: z
      .string()
      .nullable()
      .transform((value, issue) => {
        if (value === null || value.trim() === "") return null;
        const day = value.trim();
        const parsed = /^\d{4}-\d{2}-\d{2}$/.test(day) ? new Date(`${day}T00:00:00Z`) : null;
        // 不存在的日期（2026-13-01、2026-02-31）和公元 0 年（数据库不认）都不收；无效日期先判断，免得 toISOString 抛错变成 500
        const valid = parsed !== null && !Number.isNaN(parsed.getTime()) && parsed.getUTCFullYear() >= 1 && parsed.toISOString().slice(0, 10) === day;
        if (!valid) issue.addIssue({ code: "custom", message: "请填写日期，例如 2026-12-01" });
        return day;
      }),
  })
  .strict();

type SettingsBody = z.infer<typeof settingsSchema>;

function valuesOf(body: SettingsBody): LegalPageValues {
  return {
    seller: body.seller,
    japanContact: body.japan_contact,
    email: body.email,
    mailProvider: body.mail_provider,
    mailProviderCountry: body.mail_provider_country,
    mapProvider: body.map_provider,
    mapProviderCountry: body.map_provider_country,
    serverProvider: body.server_provider,
    serverProviderCountry: body.server_provider_country,
    publishedOn: body.published_on,
  };
}

function valuesJson(values: LegalPageValues): Json {
  return {
    seller: values.seller,
    japan_contact: values.japanContact,
    email: values.email,
    mail_provider: { name: values.mailProvider, country: values.mailProviderCountry },
    map_provider: { name: values.mapProvider, country: values.mapProviderCountry },
    server_provider: { name: values.serverProvider, country: values.serverProviderCountry },
    published_on: values.publishedOn,
    complete: legalPagesComplete(values),
  };
}

function settingsJson(row: LegalPageSettingsRow): Json {
  const { version, updatedAt, updatedBy, ...values } = row;
  return { ...valuesJson(values), version, updated_at: updatedAt === null ? null : updatedAt.toISOString(), updated_by: updatedBy };
}

export function registerLegalPageRoutes(app: FastifyInstance, ctx: AppContext): void {
  app.get("/site/v1/legal-pages", async (request) => {
    await takeSiteSlot(ctx, "site_read", { ip: request.ip });
    const [values, policy] = await Promise.all([publicLegalPageValues(ctx), getCancellationPolicy(ctx, "platform")]);
    return { ...valuesJson(values), cancellation_policy: cancellationPolicyJson(policy) };
  });

  app.get("/platform/v1/legal-page-settings", async (request) => {
    await authenticatePlatform(ctx, platformCredentials(request), { action: "site_settings.read" });
    return settingsJson(await getLegalPageSettings(ctx));
  });

  app.put("/platform/v1/legal-page-settings", async (request) => {
    const principal = await authenticatePlatform(ctx, platformCredentials(request), { action: "site_settings.manage" });
    const body = parseInput(settingsSchema, request.body, "body");
    const header = request.headers["if-match"];
    return settingsJson(await updateLegalPageSettings(ctx, principal, request.ip, valuesOf(body), header === undefined ? null : ifMatchVersion(header)));
  });
}
