/**
 * 法律页面（M9E-24，ADR 0107）：特定商取引法表記・キャンセルポリシー・プライバシーポリシー。
 * 正文是业主定稿的日文（只在前端，不在这里）；这里只管业主留空（【 】）的几项设置和公开读取。
 */
import type { AppContext } from "../context.ts";
import { withPlatformTx } from "../db/context.ts";
import { insertAuditLog } from "../repos/audit-logs.ts";
import { EMPTY_LEGAL_PAGE_VALUES, type LegalPageSettingsRow, type LegalPageValues, legalPagesComplete, readLegalPageSettings, readPublicLegalPageValues, saveLegalPageSettings } from "../repos/legal-pages.ts";
import { consoleOrigin, platformActor } from "./audit.ts";
import { versionConflict } from "./errors.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";

export async function getLegalPageSettings(ctx: AppContext): Promise<LegalPageSettingsRow> {
  return withPlatformTx(ctx.pool, (db) => readLegalPageSettings(db), { snapshot: true });
}

function same(a: LegalPageValues, b: LegalPageValues): boolean {
  // 只比这几项（a 可能是带版本号、修改人的整行）
  return (Object.keys(EMPTY_LEGAL_PAGE_VALUES) as (keyof LegalPageValues)[]).every((key) => a[key] === b[key]);
}

const auditJson = (values: LegalPageValues): Record<string, string | null> => ({
  seller: values.seller,
  japan_contact: values.japanContact,
  email: values.email,
  mail_provider: values.mailProvider,
  mail_provider_country: values.mailProviderCountry,
  map_provider: values.mapProvider,
  map_provider_country: values.mapProviderCountry,
  server_provider: values.serverProvider,
  server_provider_country: values.serverProviderCountry,
  published_on: values.publishedOn,
});

/** 整份替换（每一项都给，null = 清空）。版本对不上 409；没变化不写；写审计（前后值原样记：这些都是要公开在页面上的内容）。 */
export async function updateLegalPageSettings(ctx: AppContext, principal: PlatformPrincipal, ip: string, values: LegalPageValues, version: number | null): Promise<LegalPageSettingsRow> {
  return withPlatformTx(ctx.pool, async (db) => {
    const before = await readLegalPageSettings(db, true);
    if ((version ?? 0) !== before.version) throw versionConflict(before.version);
    if (before.version > 0 && same(before, values)) return before;
    const now = ctx.now();
    if (!(await saveLegalPageSettings(db, values, before.version, principal.user.id, now))) throw versionConflict(before.version);
    await insertAuditLog(db, consoleOrigin(platformActor(principal.user), ip, now), {
      tenantId: null,
      resource: "legal_page_settings",
      resourceId: null,
      action: "update",
      before: auditJson(before),
      after: auditJson(values),
    });
    return readLegalPageSettings(db);
  });
}

/** 公开页面用的几项（没设置过全是 null，页面显示「未設定」） */
export async function publicLegalPageValues(ctx: AppContext): Promise<LegalPageValues> {
  return withPlatformTx(ctx.pool, (db) => readPublicLegalPageValues(db), { snapshot: true });
}

/** /health 用：填齐了没有（读不到时抛出，由调用方当 unknown） */
export async function legalPagesFilled(ctx: Pick<AppContext, "pool">): Promise<boolean> {
  return legalPagesComplete(await withPlatformTx(ctx.pool, (db) => readPublicLegalPageValues(db), { snapshot: true }));
}
