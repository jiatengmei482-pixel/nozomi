/**
 * 法律页面设置（M9E-24，ADR 0107）：业主定稿的三页里留空（【 】）的几项，全站一行。
 */
import type { Db } from "../db/context.ts";

export interface LegalPageValues {
  seller: string | null;
  japanContact: string | null;
  email: string | null;
  mailProvider: string | null;
  mailProviderCountry: string | null;
  mapProvider: string | null;
  mapProviderCountry: string | null;
  serverProvider: string | null;
  serverProviderCountry: string | null;
  /** YYYY-MM-DD */
  publishedOn: string | null;
}

export interface LegalPageSettingsRow extends LegalPageValues {
  version: number;
  updatedAt: Date | null;
  updatedBy: { id: string; name: string } | null;
}

export const EMPTY_LEGAL_PAGE_VALUES: LegalPageValues = {
  seller: null,
  japanContact: null,
  email: null,
  mailProvider: null,
  mailProviderCountry: null,
  mapProvider: null,
  mapProviderCountry: null,
  serverProvider: null,
  serverProviderCountry: null,
  publishedOn: null,
};

/** 页面要的每一项都填了（ADR 0107 第三节：正式环境没填齐时 /health 的 legal_pages 为 incomplete） */
export function legalPagesComplete(values: LegalPageValues): boolean {
  return Object.values(values).every((value) => value !== null);
}

const COLUMNS = "seller, japan_contact, email, mail_provider, mail_provider_country, map_provider, map_provider_country, server_provider, server_provider_country, to_char(published_on, 'YYYY-MM-DD') as published_on";

interface RawRow {
  seller: string | null;
  japan_contact: string | null;
  email: string | null;
  mail_provider: string | null;
  mail_provider_country: string | null;
  map_provider: string | null;
  map_provider_country: string | null;
  server_provider: string | null;
  server_provider_country: string | null;
  published_on: string | null;
}

function valuesOf(row: RawRow): LegalPageValues {
  return {
    seller: row.seller,
    japanContact: row.japan_contact,
    email: row.email,
    mailProvider: row.mail_provider,
    mailProviderCountry: row.mail_provider_country,
    mapProvider: row.map_provider,
    mapProviderCountry: row.map_provider_country,
    serverProvider: row.server_provider,
    serverProviderCountry: row.server_provider_country,
    publishedOn: row.published_on,
  };
}

export async function readLegalPageSettings(db: Db, lock = false): Promise<LegalPageSettingsRow> {
  const result = await db.query<RawRow & { version: number; updated_at: Date; updated_by: string; updated_by_name: string }>(
    `select s.seller, s.japan_contact, s.email, s.mail_provider, s.mail_provider_country, s.map_provider, s.map_provider_country, s.server_provider, s.server_provider_country,
            to_char(s.published_on, 'YYYY-MM-DD') as published_on, s.version, s.updated_at, s.updated_by, u.name as updated_by_name
       from legal_page_settings s join platform_users u on u.id = s.updated_by${lock ? " for update of s" : ""}`,
  );
  const row = result.rows[0];
  if (row === undefined) return { ...EMPTY_LEGAL_PAGE_VALUES, version: 0, updatedAt: null, updatedBy: null };
  return { ...valuesOf(row), version: row.version, updatedAt: row.updated_at, updatedBy: { id: row.updated_by, name: row.updated_by_name } };
}

/** 公开页面用：只要这几项（没设置过全是 null） */
export async function readPublicLegalPageValues(db: Db): Promise<LegalPageValues> {
  const row = (await db.query<RawRow>(`select ${COLUMNS} from legal_page_settings`)).rows[0];
  return row === undefined ? { ...EMPTY_LEGAL_PAGE_VALUES } : valuesOf(row);
}

/** 保存（第一次写入那一行）；`expectedVersion` 对不上返回 false。 */
export async function saveLegalPageSettings(db: Db, values: LegalPageValues, expectedVersion: number, userId: string, now: Date): Promise<boolean> {
  const params = [
    values.seller,
    values.japanContact,
    values.email,
    values.mailProvider,
    values.mailProviderCountry,
    values.mapProvider,
    values.mapProviderCountry,
    values.serverProvider,
    values.serverProviderCountry,
    values.publishedOn,
    now,
    userId,
  ];
  const result =
    expectedVersion === 0
      ? await db.query(
          `insert into legal_page_settings (id, seller, japan_contact, email, mail_provider, mail_provider_country, map_provider, map_provider_country, server_provider, server_provider_country, published_on, version, updated_at, updated_by)
           values (true, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::date, 1, $11, $12) on conflict (id) do nothing`,
          params,
        )
      : await db.query(
          `update legal_page_settings set seller = $1, japan_contact = $2, email = $3, mail_provider = $4, mail_provider_country = $5, map_provider = $6, map_provider_country = $7,
                  server_provider = $8, server_provider_country = $9, published_on = $10::date, version = version + 1, updated_at = $11, updated_by = $12
            where version = $13`,
          [...params, expectedVersion],
        );
  return (result.rowCount ?? 0) === 1;
}
