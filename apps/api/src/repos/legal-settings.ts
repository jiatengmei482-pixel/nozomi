/**
 * 法律文案待补项的数据访问（M9E-24，ADR 0107）：平台表 `site_legal_settings`，全站一行，只在平台事务里用。
 * 这里只读写列；校验、审计在 `services/legal-settings.ts`。
 */
import { type LegalFields, legalFieldsOf } from "@nozomi/domain";
import type { Db } from "../db/context.ts";
import { timedQuery } from "../db/pool.ts";

export interface LegalSettingsRow {
  fields: LegalFields;
  /** 0 = 还没有保存过 */
  version: number;
  updatedAt: Date | null;
  updatedBy: { id: string; name: string } | null;
}

/** `queryTimeoutMs`：健康检查用，查询带客户端时限 */
export async function readLegalSettings(db: Db, options: { lock?: boolean; queryTimeoutMs?: number } = {}): Promise<LegalSettingsRow> {
  const row = (
    await db.query<{ fields: Record<string, unknown>; version: number; updated_at: Date; updated_by: string; updated_by_name: string }>(
      timedQuery(
        `select s.fields, s.version, s.updated_at, s.updated_by, u.name as updated_by_name
           from site_legal_settings s join platform_users u on u.id = s.updated_by${options.lock === true ? " for update of s" : ""}`,
        options.queryTimeoutMs,
      ),
    )
  ).rows[0];
  if (row === undefined) return { fields: legalFieldsOf(null), version: 0, updatedAt: null, updatedBy: null };
  return { fields: legalFieldsOf(row.fields), version: row.version, updatedAt: row.updated_at, updatedBy: { id: row.updated_by, name: row.updated_by_name } };
}

/** 保存（第一次写入那一行）；`expectedVersion` 对不上返回 false。 */
export async function saveLegalSettings(db: Db, fields: LegalFields, expectedVersion: number, userId: string, now: Date): Promise<boolean> {
  const value = JSON.stringify(fields);
  const result =
    expectedVersion === 0
      ? await db.query("insert into site_legal_settings (id, fields, version, updated_at, updated_by) values (true, $1::jsonb, 1, $2, $3) on conflict (id) do nothing", [value, now, userId])
      : await db.query("update site_legal_settings set fields = $1::jsonb, version = version + 1, updated_at = $2, updated_by = $3 where version = $4", [value, now, userId, expectedVersion]);
  return (result.rowCount ?? 0) === 1;
}
