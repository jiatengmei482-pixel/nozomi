/**
 * 第三方密钥的两处来源（ADR 0041）：服务器配置文件（环境变量，`loadConfig` 读）和运营后台（超级管理员填写，加密存库，apps/api 读出后交给这里）。
 *
 * 这里是纯函数：打码、格式校验（Stripe 三项一组、测试 / 正式密钥前缀）、按优先顺序选出生效的值。
 * 优先顺序：**运营后台填写的优先；后台没填（或清空了）才用服务器配置文件里的值**。
 * 后台的值不适用于当前环境时（比如测试密钥的库被拿到正式环境用）不生效，回落到配置文件，并标出来（`adminIgnored`）。
 */
import type { AppConfig, AppEnv, StripeConfig } from "./index.ts";

/** 能在运营后台填写的集成。 */
export const INTEGRATION_SECRET_KEYS = ["google_maps", "stripe", "email"] as const;
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

/** 打码：`••••` + 末 4 个字符（按完整字符数，不切开表情；孤立代理项换成替换符，否则写不进 jsonb）。值太短时只有圆点，不露任何字符。 */
export function maskLast4(secret: string): string {
  return secret.length < LAST4_MIN_LENGTH ? MASK_DOTS : `${MASK_DOTS}${Array.from(secret).slice(-4).join("").replace(/\p{Cs}/gu, "\uFFFD")}`;
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
  | "TEST_KEY_NOT_ALLOWED"
  /** SMTP：端口不在 25、465、587、2525 里 */
  | "PORT_NOT_ALLOWED"
  /** SMTP：这个环境不能用明文（none 只有 local / ci 可以） */
  | "ENCRYPTION_NOT_ALLOWED"
  /** SMTP：主机是内网、回环、链路本地地址，或只在内网解析的名字（在 apps/api 按 domain 的规则判断） */
  | "HOST_FORBIDDEN";

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

// ---- 邮件发送（通用 SMTP，ADR 0048）----

export const SMTP_ENCRYPTIONS = ["tls", "starttls", "none"] as const;
export type SmtpEncryption = (typeof SMTP_ENCRYPTIONS)[number];

/** 能连的端口：常见的 SMTP 端口。防止把这个表单当成端口扫描工具，或对内部的其他服务说 SMTP。 */
export const SMTP_ALLOWED_PORTS: readonly number[] = [25, 465, 587, 2525];

/** 七项是一组。只有 `password` 是密钥。 */
export interface SmtpSettings {
  host: string;
  port: number;
  encryption: SmtpEncryption;
  username: string;
  password: string;
  fromName: string;
  fromAddress: string;
}

/** 字段名（接口里用的写法）。 */
export const SMTP_FIELDS = { host: "host", port: "port", encryption: "encryption", username: "username", password: "password", fromName: "from_name", fromAddress: "from_address" } as const;

const SMTP_HOST_MAX_LENGTH = 253;
const SMTP_USERNAME_MAX_LENGTH = 255;
/** 不短于日志脱敏的最短长度（apps/api/src/logging.ts 的 MIN_SECRET_LENGTH），否则短密码抹不掉。 */
export const SMTP_PASSWORD_MIN_LENGTH = 8;
const SMTP_PASSWORD_MAX_LENGTH = 255;
const SMTP_FROM_NAME_MAX_LENGTH = 100;
const SMTP_ADDRESS_MAX_LENGTH = 254;

const SMTP_HOST_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$/;
const SMTP_HOST_IPV6 = /^[0-9A-Fa-f:.]+$/;
/** 和 @nozomi/domain 的 `isSingleMailAddress` 同一条写法（config 不依赖 domain；apps/api/src/integrations/smtp.test.ts 核对两边一致）。 */
const SMTP_ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;
/** C0、DEL、C1 控制字符和 Unicode 的行、段分隔符：发件人名称要进邮件头，用户名和密码要进 SMTP 命令。 */
const SMTP_FORBIDDEN_CHARS = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;

function isLocalEnv(appEnv: AppEnv): boolean {
  return appEnv === "local" || appEnv === "ci";
}

function isLoopbackHostText(host: string): boolean {
  return host.toLowerCase() === "localhost" || /^127(\.\d{1,3}){3}$/.test(host) || host === "::1";
}

export function isSmtpEncryption(value: string): value is SmtpEncryption {
  return (SMTP_ENCRYPTIONS as readonly string[]).includes(value);
}

function textIssue(field: string, value: string | undefined, minLength: number, maxLength: number): SecretFieldIssue | null {
  if (value === undefined || value === "") return { field, reason: "REQUIRED" };
  if (SMTP_FORBIDDEN_CHARS.test(value)) return { field, reason: "FORMAT" };
  if (value.length < minLength) return { field, reason: "TOO_SHORT" };
  if (value.length > maxLength) return { field, reason: "TOO_LONG" };
  return null;
}

/**
 * SMTP 七项的规则（服务器配置文件和后台填写共用）：七项一组；端口只认常见的几个；none 只有 local / ci 可以。
 * local / ci 的回环地址不限端口：本机假 SMTP 服务器的端口是随机的。
 * 「主机是不是内网」不在这里：地址分类在 @nozomi/domain（`smtpHostAllowed`），由 apps/api 判断。
 */
export function smtpSettingsIssues(appEnv: AppEnv, input: { [K in keyof SmtpSettings]?: K extends "encryption" ? string : SmtpSettings[K] }): SecretFieldIssue[] {
  const issues: SecretFieldIssue[] = [];
  const add = (issue: SecretFieldIssue | null): void => {
    if (issue !== null) issues.push(issue);
  };
  const host = input.host ?? "";
  if (host === "") issues.push({ field: SMTP_FIELDS.host, reason: "REQUIRED" });
  else if (host.length > SMTP_HOST_MAX_LENGTH) issues.push({ field: SMTP_FIELDS.host, reason: "TOO_LONG" });
  else if (!SMTP_HOST_NAME.test(host) && !(host.includes(":") && SMTP_HOST_IPV6.test(host))) issues.push({ field: SMTP_FIELDS.host, reason: "FORMAT" });

  const port = input.port;
  if (port === undefined) issues.push({ field: SMTP_FIELDS.port, reason: "REQUIRED" });
  else if (!Number.isInteger(port) || port < 1 || port > 65_535) issues.push({ field: SMTP_FIELDS.port, reason: "FORMAT" });
  else if (!SMTP_ALLOWED_PORTS.includes(port) && !(isLocalEnv(appEnv) && isLoopbackHostText(host))) issues.push({ field: SMTP_FIELDS.port, reason: "PORT_NOT_ALLOWED" });

  const encryption = input.encryption ?? "";
  if (encryption === "") issues.push({ field: SMTP_FIELDS.encryption, reason: "REQUIRED" });
  else if (!isSmtpEncryption(encryption)) issues.push({ field: SMTP_FIELDS.encryption, reason: "FORMAT" });
  else if (encryption === "none" && !isLocalEnv(appEnv)) issues.push({ field: SMTP_FIELDS.encryption, reason: "ENCRYPTION_NOT_ALLOWED" });

  add(textIssue(SMTP_FIELDS.username, input.username, 1, SMTP_USERNAME_MAX_LENGTH));
  add(textIssue(SMTP_FIELDS.password, input.password, SMTP_PASSWORD_MIN_LENGTH, SMTP_PASSWORD_MAX_LENGTH));
  add(textIssue(SMTP_FIELDS.fromName, input.fromName, 1, SMTP_FROM_NAME_MAX_LENGTH));

  const address = input.fromAddress ?? "";
  if (address === "") issues.push({ field: SMTP_FIELDS.fromAddress, reason: "REQUIRED" });
  else if (address.length > SMTP_ADDRESS_MAX_LENGTH) issues.push({ field: SMTP_FIELDS.fromAddress, reason: "TOO_LONG" });
  else if (!SMTP_ADDRESS.test(address)) issues.push({ field: SMTP_FIELDS.fromAddress, reason: "FORMAT" });
  return issues;
}

/** 运营后台里存着的值（已解密）；某一项后台没填时为 null。 */
export interface AdminIntegrationSecrets {
  googleMaps: { apiKey: string } | null;
  stripe: StripeKeys | null;
  email: SmtpSettings | null;
}

export const NO_ADMIN_SECRETS: AdminIntegrationSecrets = { googleMaps: null, stripe: null, email: null };

export interface EffectiveIntegrations {
  googleMaps: { apiKey: string | null; source: SecretSource };
  stripe: { config: StripeConfig | null; source: SecretSource };
  email: { config: SmtpSettings | null; source: SecretSource };
  /** 后台有值，但不适用于当前环境（Stripe 的测试 / 正式规则、SMTP 的明文），所以没有生效 */
  adminIgnored: { googleMaps: boolean; stripe: boolean; email: boolean };
}

/** 按优先顺序选出生效的值：后台的优先，其次配置文件，都没有就是未配置。 */
export function resolveIntegrations(config: AppConfig, admin: AdminIntegrationSecrets): EffectiveIntegrations {
  const adminMaps = admin.googleMaps !== null && googleMapsKeyIssues(admin.googleMaps.apiKey).length === 0 ? admin.googleMaps.apiKey : null;
  const adminStripe = admin.stripe !== null && adminStripeKeyIssues(config.appEnv, admin.stripe).length === 0 ? admin.stripe : null;
  const adminStripeMode = adminStripe === null ? null : stripeModeOf(adminStripe.secretKey);
  const adminEmail = admin.email !== null && smtpSettingsIssues(config.appEnv, admin.email).length === 0 ? admin.email : null;
  return {
    googleMaps:
      adminMaps !== null
        ? { apiKey: adminMaps, source: "admin" }
        : { apiKey: config.googleMapsApiKey, source: config.googleMapsApiKey === null ? "none" : "env" },
    stripe:
      adminStripe !== null && adminStripeMode !== null
        ? { config: { ...adminStripe, mode: adminStripeMode }, source: "admin" }
        : { config: config.stripe, source: config.stripe === null ? "none" : "env" },
    email: adminEmail !== null ? { config: adminEmail, source: "admin" } : { config: config.smtp, source: config.smtp === null ? "none" : "env" },
    adminIgnored: { googleMaps: admin.googleMaps !== null && adminMaps === null, stripe: admin.stripe !== null && adminStripe === null, email: admin.email !== null && adminEmail === null },
  };
}

/** 只有服务器配置文件时的生效值（`pnpm config:check`、还没读到后台设置之前）。 */
export function envIntegrations(config: AppConfig): EffectiveIntegrations {
  return resolveIntegrations(config, NO_ADMIN_SECRETS);
}

/** 生效的 Stripe 三项、谷歌地图密钥、SMTP 密码的原文：日志脱敏要把它们都抹掉。SMTP 的其他项不是密钥（`587`、`tls` 不该被抹掉）。 */
export function effectiveSecretValues(effective: EffectiveIntegrations): string[] {
  const stripe = effective.stripe.config;
  return [effective.googleMaps.apiKey, stripe?.secretKey, stripe?.webhookSecret, stripe?.publishableKey, effective.email.config?.password].filter((value): value is string => typeof value === "string");
}
