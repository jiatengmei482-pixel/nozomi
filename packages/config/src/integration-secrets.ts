/**
 * 第三方密钥的两处来源（ADR 0041）：服务器配置文件（环境变量，`loadConfig` 读）和运营后台（超级管理员填写，加密存库，apps/api 读出后交给这里）。
 *
 * 这里是纯函数：打码、格式校验（Stripe 三项一组、测试 / 正式密钥前缀）、按优先顺序选出生效的值。
 * 优先顺序：**运营后台填写的优先；后台没填（或清空了）才用服务器配置文件里的值**。
 * 后台的值不适用于当前环境时（比如测试密钥的库被拿到正式环境用）不生效，回落到配置文件，并标出来（`adminIgnored`）。
 */
import type { AppConfig, AppEnv, StripeConfig } from "./index.ts";

/** 能在运营后台填写的集成。 */
export const INTEGRATION_SECRET_KEYS = ["google_maps", "stripe"] as const;
export type IntegrationSecretKey = (typeof INTEGRATION_SECRET_KEYS)[number];

export function isIntegrationSecretKey(value: string): value is IntegrationSecretKey {
  return (INTEGRATION_SECRET_KEYS as readonly string[]).includes(value);
}

/** 生效的值从哪里来。 */
export type SecretSource = "admin" | "env" | "none";

export const SECRET_SOURCE_LABELS: Readonly<Record<SecretSource, string>> = {
  admin: "后台设置",
  env: "服务器配置文件",
  none: "未配置",
};

/** 优先顺序的一句话说明（页面、接口、文档同一句）。 */
export const SECRET_PRECEDENCE_NOTE = "运营后台填写的优先；后台没填（或清空后）才用服务器配置文件里的值。";

const MASK_DOTS = "••••";
/** 短于这个长度的值只显示圆点：末 4 位占比太大。后台填写的值至少 20 个字符，所以后台的值总能显示末 4 位。 */
const LAST4_MIN_LENGTH = 16;

/** 打码：`••••` + 末 4 位。值太短时只有圆点，不露任何字符。 */
export function maskLast4(secret: string): string {
  return secret.length < LAST4_MIN_LENGTH ? MASK_DOTS : `${MASK_DOTS}${secret.slice(-4)}`;
}

export type SecretFieldIssueReason =
  /** 三项一组缺了这一项 */
  | "REQUIRED"
  /** 有空格、换行或别的不该出现的字符 */
  | "FORMAT"
  | "TOO_SHORT"
  | "TOO_LONG"
  /** 前缀不对（Stripe：sk_ / pk_ / whsec_） */
  | "PREFIX"
  /** Stripe 的 secret key 和 publishable key 一个是测试一个是正式 */
  | "MODE_MISMATCH"
  /** 非正式环境只能用测试密钥 */
  | "LIVE_KEY_NOT_ALLOWED"
  /** 正式环境只能用正式密钥 */
  | "TEST_KEY_NOT_ALLOWED";

export interface SecretFieldIssue {
  field: string;
  reason: SecretFieldIssueReason;
}

export interface StripeKeys {
  secretKey: string;
  publishableKey: string;
  webhookSecret: string;
}

/** 字段名（接口里用的写法）。 */
export const STRIPE_FIELDS = { secretKey: "secret_key", publishableKey: "publishable_key", webhookSecret: "webhook_secret" } as const;
export const GOOGLE_MAPS_FIELD = "api_key";

export function stripeModeOf(secretKey: string): "test" | "live" | null {
  return secretKey.startsWith("sk_live_") ? "live" : secretKey.startsWith("sk_test_") ? "test" : null;
}

/**
 * Stripe 三项的规则（服务器配置文件和后台填写共用）：三项一组、各自的前缀、secret key 和 publishable key 同为测试或同为正式、
 * 非正式环境只能用测试密钥、正式环境只能用正式密钥。三项都没给时没有问题（= 不配置）。
 */
export function stripeKeyIssues(appEnv: AppEnv, keys: Partial<StripeKeys>): SecretFieldIssue[] {
  const fields = Object.keys(STRIPE_FIELDS) as (keyof StripeKeys)[];
  const given = fields.filter((field) => (keys[field] ?? "") !== "");
  if (given.length === 0) return [];
  if (given.length < fields.length) return fields.filter((field) => !given.includes(field)).map((field) => ({ field: STRIPE_FIELDS[field], reason: "REQUIRED" }));
  const { secretKey, publishableKey, webhookSecret } = keys as StripeKeys;
  const issues: SecretFieldIssue[] = [];
  const mode = stripeModeOf(secretKey);
  if (mode === null) issues.push({ field: STRIPE_FIELDS.secretKey, reason: "PREFIX" });
  if (!/^pk_(test|live)_/.test(publishableKey)) issues.push({ field: STRIPE_FIELDS.publishableKey, reason: "PREFIX" });
  if (!webhookSecret.startsWith("whsec_")) issues.push({ field: STRIPE_FIELDS.webhookSecret, reason: "PREFIX" });
  if (mode !== null && /^pk_(test|live)_/.test(publishableKey) && !publishableKey.startsWith(mode === "live" ? "pk_live_" : "pk_test_")) {
    issues.push({ field: STRIPE_FIELDS.publishableKey, reason: "MODE_MISMATCH" });
  }
  if (mode === "live" && appEnv !== "production") issues.push({ field: STRIPE_FIELDS.secretKey, reason: "LIVE_KEY_NOT_ALLOWED" });
  if (mode === "test" && appEnv === "production") issues.push({ field: STRIPE_FIELDS.secretKey, reason: "TEST_KEY_NOT_ALLOWED" });
  return issues;
}

/** 后台填写的值的长度范围：真实的谷歌地图密钥 39 个字符，Stripe 的几项都在 30 个字符以上。 */
export const ADMIN_SECRET_MIN_LENGTH = 20;
export const ADMIN_SECRET_MAX_LENGTH = 255;

/** 后台填写的单个值的写法：只认字母、数字、下划线、连字符（两家的密钥都只用这些字符）。粘贴时带进来的首尾空白先由接口层去掉。 */
export function adminSecretFormatIssue(field: string, value: string): SecretFieldIssue | null {
  if (value.length < ADMIN_SECRET_MIN_LENGTH) return { field, reason: "TOO_SHORT" };
  if (value.length > ADMIN_SECRET_MAX_LENGTH) return { field, reason: "TOO_LONG" };
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return { field, reason: "FORMAT" };
  return null;
}

/** 后台填写谷歌地图密钥的校验。 */
export function googleMapsKeyIssues(apiKey: string): SecretFieldIssue[] {
  const issue = adminSecretFormatIssue(GOOGLE_MAPS_FIELD, apiKey);
  return issue === null ? [] : [issue];
}

/** 后台填写 Stripe 三项的校验：先看每项的写法，写法都对再按 `stripeKeyIssues` 的规则。 */
export function adminStripeKeyIssues(appEnv: AppEnv, keys: Partial<StripeKeys>): SecretFieldIssue[] {
  const format: SecretFieldIssue[] = [];
  for (const field of Object.keys(STRIPE_FIELDS) as (keyof StripeKeys)[]) {
    const value = keys[field] ?? "";
    if (value === "") format.push({ field: STRIPE_FIELDS[field], reason: "REQUIRED" });
    else {
      const issue = adminSecretFormatIssue(STRIPE_FIELDS[field], value);
      if (issue !== null) format.push(issue);
    }
  }
  return format.length > 0 ? format : stripeKeyIssues(appEnv, keys);
}

/** 运营后台里存着的值（已解密）；某一项后台没填时为 null。 */
export interface AdminIntegrationSecrets {
  googleMaps: { apiKey: string } | null;
  stripe: StripeKeys | null;
}

export const NO_ADMIN_SECRETS: AdminIntegrationSecrets = { googleMaps: null, stripe: null };

export interface EffectiveIntegrations {
  googleMaps: { apiKey: string | null; source: SecretSource };
  stripe: { config: StripeConfig | null; source: SecretSource };
  /** 后台有值，但不适用于当前环境（Stripe 的测试 / 正式规则），所以没有生效 */
  adminIgnored: { googleMaps: boolean; stripe: boolean };
}

/** 按优先顺序选出生效的值：后台的优先，其次配置文件，都没有就是未配置。 */
export function resolveIntegrations(config: AppConfig, admin: AdminIntegrationSecrets): EffectiveIntegrations {
  const adminMaps = admin.googleMaps !== null && googleMapsKeyIssues(admin.googleMaps.apiKey).length === 0 ? admin.googleMaps.apiKey : null;
  const adminStripe = admin.stripe !== null && adminStripeKeyIssues(config.appEnv, admin.stripe).length === 0 ? admin.stripe : null;
  const adminStripeMode = adminStripe === null ? null : stripeModeOf(adminStripe.secretKey);
  return {
    googleMaps:
      adminMaps !== null
        ? { apiKey: adminMaps, source: "admin" }
        : { apiKey: config.googleMapsApiKey, source: config.googleMapsApiKey === null ? "none" : "env" },
    stripe:
      adminStripe !== null && adminStripeMode !== null
        ? { config: { ...adminStripe, mode: adminStripeMode }, source: "admin" }
        : { config: config.stripe, source: config.stripe === null ? "none" : "env" },
    adminIgnored: { googleMaps: admin.googleMaps !== null && adminMaps === null, stripe: admin.stripe !== null && adminStripe === null },
  };
}

/** 只有服务器配置文件时的生效值（`pnpm config:check`、还没读到后台设置之前）。 */
export function envIntegrations(config: AppConfig): EffectiveIntegrations {
  return resolveIntegrations(config, NO_ADMIN_SECRETS);
}

/** 生效的 Stripe 三项、谷歌地图密钥的原文：日志脱敏要把它们都抹掉。 */
export function effectiveSecretValues(effective: EffectiveIntegrations): string[] {
  const stripe = effective.stripe.config;
  return [effective.googleMaps.apiKey, stripe?.secretKey, stripe?.webhookSecret, stripe?.publishableKey].filter((value): value is string => typeof value === "string");
}
