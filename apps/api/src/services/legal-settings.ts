/**
 * 官网、嵌入页三份法律文案的待补项（M9E-24，ADR 0107）。
 *
 * - 运营后台：`site_settings.read` 能看，`site_settings.manage`（只归超级管理员）能改；带版本号，改了留审计（前后值原样记：都是要公开的公司信息）。
 * - 官网公开读：待补项、填没填齐、平台当前的取消政策（キャンセルポリシー的表按它实时生成）。官网没开放时也能读。
 * - 正式环境没填齐：官网不开放预订（`legalGateClosed`，`services/site.ts` 判断开没开时用），`/health` 的 `legal` 显示「未填齐」。
 */
import { type LegalFields, legalFieldIssues, legalFieldsComplete, legalFieldsOf } from "@nozomi/domain";
import type { AppEnv } from "@nozomi/config";
import type { AppContext } from "../context.ts";
import { type Db, withPlatformTx } from "../db/context.ts";
import { type LegalSettingsRow, readLegalSettings, saveLegalSettings } from "../repos/legal-settings.ts";
import { insertAuditLog } from "../repos/audit-logs.ts";
import { type StoredCancellationPolicy, currentCancellationPolicy } from "../repos/cancellation-policies.ts";
import { validationFailed } from "../validation.ts";
import { consoleOrigin, platformActor } from "./audit.ts";
import { versionConflict } from "./errors.ts";
import type { PlatformPrincipal } from "./platform-auth.ts";

/** 哪个环境要求填齐才开放预订：只有正式环境（测试站照常开放，页面上显示「未設定」） */
export function legalRequiredForLaunch(env: AppEnv): boolean {
  return env === "production";
}

/** 这个环境的官网因为法律文案没填齐而不开放 */
export function legalGateClosed(env: AppEnv, fields: LegalFields): boolean {
  return legalRequiredForLaunch(env) && !legalFieldsComplete(fields);
}

export async function readLegalFields(db: Db): Promise<LegalFields> {
  return (await readLegalSettings(db)).fields;
}

export async function getLegalSettings(ctx: AppContext): Promise<LegalSettingsRow> {
  return withPlatformTx(ctx.pool, (db) => readLegalSettings(db), { snapshot: true });
}

/** 改待补项：整份提交（10 个键都要给，null 或空白是没填）。不合规则 400（路径 `/fields/<键>`）；版本对不上 409；和现在一样不写。 */
export async function updateLegalSettings(ctx: AppContext, principal: PlatformPrincipal, ip: string, input: Readonly<Record<string, string | null>>, version: number | null): Promise<LegalSettingsRow> {
  const issues = legalFieldIssues(input);
  if (issues.length > 0) throw validationFailed("body", issues.map((issue) => ({ path: `/fields/${issue.key}`, message: issue.reason, reason: issue.reason })));
  const next = legalFieldsOf(input);
  return withPlatformTx(ctx.pool, async (db) => {
    const before = await readLegalSettings(db, { lock: true });
    if ((version ?? 0) !== before.version) throw versionConflict(before.version);
    if (before.version > 0 && JSON.stringify(before.fields) === JSON.stringify(next)) return before;
    const now = ctx.now();
    if (!(await saveLegalSettings(db, next, before.version, principal.user.id, now))) throw versionConflict(before.version);
    await insertAuditLog(db, consoleOrigin(platformActor(principal.user), ip, now), {
      tenantId: null,
      resource: "site_legal_settings",
      resourceId: null,
      action: "update",
      before: { fields: before.fields },
      after: { fields: next },
    });
    return readLegalSettings(db);
  });
}

/** 官网公开读：待补项和平台当前的取消政策（同一个快照）。 */
export async function sitePublicLegal(ctx: AppContext): Promise<{ fields: LegalFields; policy: StoredCancellationPolicy }> {
  return withPlatformTx(ctx.pool, async (db) => ({ fields: await readLegalFields(db), policy: await currentCancellationPolicy(db) }), { snapshot: true });
}
