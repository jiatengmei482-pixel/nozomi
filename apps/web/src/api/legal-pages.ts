/**
 * 法律页面（M9E-24，ADR 0107）：公开的 `GET /site/v1/legal-pages` 和运营后台的 `GET/PUT /platform/v1/legal-page-settings`。
 */
import { apiRequest } from "./client.ts";
import type { CancellationPolicy } from "./order-money.ts";

export interface LegalProvider {
  name: string | null;
  /** 所在国（照填写原样显示） */
  country: string | null;
}

/** 三页里业主留空、运营后台填的几项；没填为 null */
export interface LegalPageValues {
  seller: string | null;
  japan_contact: string | null;
  email: string | null;
  mail_provider: LegalProvider;
  map_provider: LegalProvider;
  server_provider: LegalProvider;
  /** YYYY-MM-DD */
  published_on: string | null;
  complete: boolean;
}

export interface SiteLegalPages extends LegalPageValues {
  cancellation_policy: CancellationPolicy;
}

export interface LegalPageSettings extends LegalPageValues {
  version: number;
  updated_at: string | null;
  updated_by: { id: string; name: string } | null;
}

/** 保存时整份替换（null = 清空） */
export interface LegalPageSettingsInput {
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

export function getSiteLegalPages(): Promise<SiteLegalPages> {
  return apiRequest("GET", "/site/v1/legal-pages");
}

const ifMatch = (version: number): Record<string, string> => ({ "if-match": `"${version}"` });

export function getLegalPageSettings(token: string): Promise<LegalPageSettings> {
  return apiRequest("GET", "/platform/v1/legal-page-settings", { token });
}

export function saveLegalPageSettings(token: string, version: number, input: LegalPageSettingsInput): Promise<LegalPageSettings> {
  return apiRequest("PUT", "/platform/v1/legal-page-settings", { token, body: input, ...(version > 0 ? { headers: ifMatch(version) } : {}) });
}
