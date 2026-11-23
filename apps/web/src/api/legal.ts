/**
 * 法律文案（M9E-24，ADR 0107）的接口：官网三份法律页面读的公开接口，和运营后台「官网设置 → 法律文案的待补项」读、改的接口。
 *
 * - `GET /site/v1/legal`：不要登录，官网没开放时也能读；待补项（没填的为 null）和平台当前的取消政策（キャンセルポリシー第 2 条的表按它生成）。
 * - `GET / PUT /platform/v1/legal-settings`：看要 `site_settings.read`，改要 `site_settings.manage`（只有超级管理员）。
 *   PUT 每次 10 个键全给（空字符串当没填）；已经设置过（版本 > 0）的带 If-Match，和「官网设置」其他几项同一种写法。
 */
import type { CancellationPolicy, LegalFieldKey, ServiceCategory, VehicleLevel } from "@nozomi/domain";
import { apiRequest } from "./client.ts";
import type { CancelTier } from "./order-money.ts";
import { PLATFORM_BASE } from "./platform.ts";
import { SITE_BASE } from "./site.ts";

export const SITE_LEGAL_PATH = `${SITE_BASE}/legal`;
export const LEGAL_SETTINGS_PATH = `${PLATFORM_BASE}/legal-settings`;

export type LegalFieldValues = Record<LegalFieldKey, string | null>;

export interface SiteLegalPolicyRule {
  category: ServiceCategory;
  level: VehicleLevel;
  tiers: CancelTier[];
}

export interface SiteLegal {
  fields: LegalFieldValues;
  complete: boolean;
  cancellation_policy: { version: number; effective_at: string | null; rules: SiteLegalPolicyRule[] };
}

export interface LegalSettings {
  fields: LegalFieldValues;
  /** 没填的键，按 `LEGAL_FIELD_KEYS` 的顺序 */
  missing: LegalFieldKey[];
  complete: boolean;
  /** 正式环境为 true：没填齐时官网不开放预订 */
  required_for_launch: boolean;
  /** 0 表示还没有设置过 */
  version: number;
  updated_at: string | null;
  updated_by: { id: string; name: string } | null;
}

/** 与 openapi.yaml 对账的字段（legal.contract.test.ts） */
export const SITE_LEGAL_FIELDS: readonly (keyof SiteLegal)[] = ["fields", "complete", "cancellation_policy"];
export const LEGAL_SETTINGS_FIELDS: readonly (keyof LegalSettings)[] = ["fields", "missing", "complete", "required_for_launch", "version", "updated_at", "updated_by"];

export function getSiteLegal(): Promise<SiteLegal> {
  return apiRequest("GET", SITE_LEGAL_PATH);
}

export function getLegalSettings(token: string): Promise<LegalSettings> {
  return apiRequest("GET", LEGAL_SETTINGS_PATH, { token });
}

export function updateLegalSettings(token: string, version: number, fields: LegalFieldValues): Promise<LegalSettings> {
  return apiRequest("PUT", LEGAL_SETTINGS_PATH, { token, body: { fields }, ...(version > 0 ? { headers: { "if-match": `"${version}"` } } : {}) });
}

/** 接口的取消政策（snake_case）→ domain 的写法，给 `cancellationTableRows` 用。 */
export function legalPolicyOf(rules: readonly SiteLegalPolicyRule[]): CancellationPolicy {
  return rules.map((rule) => ({ category: rule.category, level: rule.level, tiers: rule.tiers.map((tier) => ({ minHoursBefore: tier.min_hours_before, feeBp: tier.fee_bp })) }));
}
