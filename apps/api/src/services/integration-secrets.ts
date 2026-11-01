/**
 * 运营后台填写的第三方密钥（M4-09，ADR 0041）：谷歌地图、Stripe；邮件发送（M4-14，ADR 0048）。
 *
 * - 只有超级管理员能填写、更换、清空、测试（`integration.manage`，自建角色勾不了）；有 `integration.read` 的人只看得到「已配置 / 未配置」和来源。
 * - 存：用 `SecretBox`（数据加密密钥 `DATA_ENCRYPTION_KEY`，用途 `integration-secret`，附加数据是这一项的名字）加密后存库；另存每一项打码后的样子（`••••` + 末 4 位）。
 *   没配置数据加密密钥时不能填写（503）。
 * - 优先顺序（`@nozomi/config` 的 `resolveIntegrations`）：后台填写的优先，后台没填（或清空后）用服务器配置文件里的值。
 * - 立即生效：每个进程有一份缓存（`IntegrationSecretCache`），本进程改了立刻重读；别的进程（以后多开的服务进程）最迟 `INTEGRATION_SECRETS_TTL_MS` 之后重读——
 *   每个请求开始前、每轮定时任务开始前看一眼缓存过没过期，过期了先重读再往下走。
 * - 原文只在这几处出现：请求体（进来就校验、加密）、缓存里解密后的值（给收款、测试一下用）。接口返回、错误信息、审计、日志里都没有原文；
 *   审计只记「哪一项、什么动作、打码后的末 4 位、测试结果」。
 */
import {
  type AdminIntegrationSecrets,
  type AppConfig,
  type EffectiveIntegrations,
  GOOGLE_MAPS_FIELD,
  INTEGRATION_SECRET_KEYS,
  type IntegrationSecretKey,
  NO_ADMIN_SECRETS,
  SECRET_PRECEDENCE_NOTE,
  SECRET_SOURCE_LABELS,
  SMTP_FIELDS,
  STRIPE_FIELDS,
  type SecretFieldIssue,
  type SecretSource,
  type SmtpEncryption,
  type SmtpSettings,
  type StripeKeys,
  adminStripeKeyIssues,
  envIntegrations,
  googleMapsKeyIssues,
  isIntegrationSecretKey,
  maskLast4,
  resolveIntegrations,
  smtpSettingsIssues,
} from "@nozomi/config";
import { smtpHostAllowed } from "@nozomi/domain";
import type { AppContext } from "../context.ts";
import { withPlatformTx } from "../db/context.ts";
import type { Pool } from "../db/pool.ts";
import { AppError } from "../errors.ts";
import { withTimeout } from "../health.ts";
import type { IntegrationCheckResult } from "../integrations/integration-check.ts";
import { type SecretBox, SecretBoxError } from "../integrations/secret-box.ts";
import type { SmtpFailureCode } from "../integrations/smtp.ts";
import { insertAuditLog } from "../repos/audit-logs.ts";
import { type IntegrationSecretRow, deleteIntegrationSecret, listIntegrationSecrets, lockIntegrationSecret, queueIntegrationSecretChange, saveIntegrationSecret } from "../repos/integration-secrets.ts";
import { validationFailed } from "../validation.ts";
import { consoleOrigin, platformActor } from "./audit.ts";
import { notFound } from "./errors.ts";
import { sendMailWith } from "./mail.ts";
import { type PlatformPrincipal, principalCan } from "./platform-auth.ts";

/** 缓存多久重读一次（毫秒）：别的进程改了密钥，本进程最迟这么久之后用上新值。 */
export const INTEGRATION_SECRETS_TTL_MS = 5_000;
/** 请求开始前等重读最多等多久（毫秒）：数据库慢或连不上时不拖住请求，先用手上的值。 */
export const INTEGRATION_SECRETS_WAIT_MS = 500;

const PURPOSE = "integration-secret";

/** 「测试一下」的限速：同一项每 5 秒最多一次（不分人）。谷歌地图每次测试都会产生一次计费调用，连点、被人刷都不该放大费用。 */
export const INTEGRATION_TEST_INTERVAL_MS = 5_000;

/** 后台这一份的状况。 */
export type AdminSecretProblem =
  /** 解不开（数据加密密钥换了，或者库里的内容被改过）：不生效，需要重新填写 */
  | "UNREADABLE"
  /** 解开了，但不适用于当前环境（如测试密钥到了正式环境）：不生效 */
  | "NOT_ALLOWED_IN_ENV";

export interface AdminSecretState {
  hints: Record<string, string>;
  version: number;
  updatedAt: Date;
  updatedBy: { id: string; name: string };
  problem: AdminSecretProblem | null;
}

interface Snapshot {
  effective: EffectiveIntegrations;
  admin: Partial<Record<IntegrationSecretKey, AdminSecretState>>;
  /** 后台的值（解开了的）原文：日志脱敏要抹掉它们 */
  secretValues: string[];
}

export interface CacheLog {
  warn(obj: object, msg: string): void;
}

/**
 * 每个进程一份的缓存。`effective` 是同步读的（收款、/health、日志脱敏都在同步代码里取值），
 * 所以靠「请求开始前 / 定时任务每轮开始前调 `ensureFresh`」保证取到的不旧于 TTL；本进程改了之后调 `reloadNow` 立刻换掉。
 */
export class IntegrationSecretCache {
  readonly #pool: Pool;
  readonly #config: AppConfig;
  readonly #box: SecretBox | null;
  readonly #log: CacheLog;
  readonly #ttlMs: number;
  #snapshot: Snapshot;
  /** 上一次重读开始的时刻（单调时钟，和测试拨动的业务时钟无关） */
  #loadedAt = Number.NEGATIVE_INFINITY;
  #inflight: Promise<void> | null = null;
  /** 每一项上一次「测试一下」的时刻（业务时钟） */
  readonly #lastTests = new Map<IntegrationSecretKey, number>();

  constructor(deps: { pool: Pool; config: AppConfig; secretBox: SecretBox | null; log: CacheLog; ttlMs?: number }) {
    this.#ttlMs = deps.ttlMs ?? INTEGRATION_SECRETS_TTL_MS;
    this.#pool = deps.pool;
    this.#config = deps.config;
    this.#box = deps.secretBox;
    this.#log = deps.log;
    this.#snapshot = { effective: envIntegrations(deps.config), admin: {}, secretValues: [] };
  }

  /** 现在生效的谷歌地图、Stripe。 */
  get effective(): EffectiveIntegrations {
    return this.#snapshot.effective;
  }

  /** 后台那一份的状况（打码后的样子、谁什么时候改的、生没生效）；后台没填的项没有。 */
  adminState(key: IntegrationSecretKey): AdminSecretState | null {
    return this.#snapshot.admin[key] ?? null;
  }

  /**
   * 占一次「测试一下」：距这一项上一次不到 `INTEGRATION_TEST_INTERVAL_MS` 时不占，返回还要等几秒；占到了返回 null。
   * 判断和记下在同一个同步步骤里，同时到的两个请求只有一个占得到。只管本进程（ADR 0041：现在只有一个服务进程）。
   */
  claimTest(key: IntegrationSecretKey, now: Date): number | null {
    const last = this.#lastTests.get(key);
    const waitMs = last === undefined ? 0 : last + INTEGRATION_TEST_INTERVAL_MS - now.getTime();
    if (waitMs > 0) return Math.ceil(waitMs / 1000);
    this.#lastTests.set(key, now.getTime());
    return null;
  }

  /** 后台填写的值的原文（日志脱敏用）。 */
  secretValues(): string[] {
    return this.#snapshot.secretValues;
  }

  /** 过期了就重读；最多等 `waitMs`，等不到先用手上的值。不抛异常。 */
  async ensureFresh(waitMs: number = INTEGRATION_SECRETS_WAIT_MS): Promise<void> {
    if (performance.now() - this.#loadedAt < this.#ttlMs) return;
    try {
      await withTimeout(this.#start(), waitMs);
    } catch {
      // 等不及：这一次先用手上的值，重读在后台接着做
    }
  }

  /**
   * 立刻重读（本进程改了之后调）：正在读的那一次可能是改之前开始的，等它读完再读一次。不抛异常。
   */
  async reloadNow(): Promise<void> {
    if (this.#inflight !== null) await this.#inflight;
    await this.#start();
  }

  /** 开始重读；同时只有一次在读。不抛异常——读失败时保留手上的值，过 TTL 再试。 */
  #start(): Promise<void> {
    if (this.#inflight !== null) return this.#inflight;
    this.#loadedAt = performance.now();
    this.#inflight = this.#load()
      .then((snapshot) => {
        this.#snapshot = snapshot;
      })
      .catch((err: unknown) => {
        this.#log.warn({ err }, "读取运营后台填写的第三方密钥失败，先沿用之前的值");
      })
      .finally(() => {
        this.#inflight = null;
      });
    return this.#inflight;
  }

  async #load(): Promise<Snapshot> {
    const rows = await withPlatformTx(this.#pool, (db) => listIntegrationSecrets(db), { queryTimeoutMs: 2_000 });
    const opened: AdminIntegrationSecrets = { ...NO_ADMIN_SECRETS };
    const admin: Snapshot["admin"] = {};
    const secretValues: string[] = [];
    let hostForbidden = false;
    for (const row of rows) {
      const values = this.#open(row);
      admin[row.integration] = { hints: row.hints, version: row.version, updatedAt: row.updatedAt, updatedBy: row.updatedBy, problem: values === null ? "UNREADABLE" : null };
      if (values === null) continue;
      if (row.integration === "email") {
        // 只有密码是密钥；其余几项（`587`、`tls`）不该被日志脱敏抹掉
        if ((values[SMTP_FIELDS.password] ?? "") !== "") secretValues.push(values[SMTP_FIELDS.password] as string);
        const settings = smtpSettingsOf(values);
        if (smtpHostAllowed(settings.host, { allowLoopback: isLocalEnv(this.#config) })) opened.email = settings;
        else hostForbidden = true;
        continue;
      }
      secretValues.push(...Object.values(values));
      if (row.integration === "google_maps") opened.googleMaps = { apiKey: values[GOOGLE_MAPS_FIELD] ?? "" };
      else opened.stripe = { secretKey: values[STRIPE_FIELDS.secretKey] ?? "", publishableKey: values[STRIPE_FIELDS.publishableKey] ?? "", webhookSecret: values[STRIPE_FIELDS.webhookSecret] ?? "" };
    }
    const effective = resolveIntegrations(this.#config, opened);
    if (effective.adminIgnored.googleMaps && admin.google_maps) admin.google_maps.problem = "NOT_ALLOWED_IN_ENV";
    if (effective.adminIgnored.stripe && admin.stripe) admin.stripe.problem = "NOT_ALLOWED_IN_ENV";
    if ((effective.adminIgnored.email || hostForbidden) && admin.email) admin.email.problem = "NOT_ALLOWED_IN_ENV";
    return { effective, admin, secretValues };
  }

  #open(row: IntegrationSecretRow): Record<string, string> | null {
    return openSecretRow(this.#box, row);
  }
}

/** 解开库里的一行；没有数据加密密钥、解不开时返回 null。 */
function openSecretRow(box: SecretBox | null, row: IntegrationSecretRow): Record<string, string> | null {
  if (box === null) return null;
  try {
    const parsed = JSON.parse(box.open(PURPOSE, row.integration, row.sealed)) as unknown;
    if (typeof parsed !== "object" || parsed === null) return null;
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch (err) {
    if (err instanceof SecretBoxError || err instanceof SyntaxError) return null;
    throw err;
  }
}

function isLocalEnv(config: AppConfig): boolean {
  return config.appEnv === "local" || config.appEnv === "ci";
}

/** 库里的一组值 → SMTP 配置（全是字符串，端口也是）。写法不对的由 `resolveIntegrations` 的校验挡下。 */
function smtpSettingsOf(values: Record<string, string>): SmtpSettings {
  return {
    host: values[SMTP_FIELDS.host] ?? "",
    port: Number(values[SMTP_FIELDS.port] ?? ""),
    encryption: (values[SMTP_FIELDS.encryption] ?? "") as SmtpEncryption,
    username: values[SMTP_FIELDS.username] ?? "",
    password: values[SMTP_FIELDS.password] ?? "",
    fromName: values[SMTP_FIELDS.fromName] ?? "",
    fromAddress: values[SMTP_FIELDS.fromAddress] ?? "",
  };
}

// ---- 接口用到的流程 ----

export interface IntegrationChecks {
  googleMaps(apiKey: string): Promise<IntegrationCheckResult>;
  stripe(config: NonNullable<EffectiveIntegrations["stripe"]["config"]>): Promise<IntegrationCheckResult>;
}

const LABELS: Readonly<Record<IntegrationSecretKey, string>> = { google_maps: "谷歌地图", stripe: "Stripe 支付", email: "邮件发送" };

const FIELD_LABELS: Readonly<Record<IntegrationSecretKey, readonly { name: string; label: string }[]>> = {
  google_maps: [{ name: GOOGLE_MAPS_FIELD, label: "API 密钥" }],
  stripe: [
    { name: STRIPE_FIELDS.secretKey, label: "Secret key（sk_ 开头）" },
    { name: STRIPE_FIELDS.publishableKey, label: "Publishable key（pk_ 开头）" },
    { name: STRIPE_FIELDS.webhookSecret, label: "Webhook signing secret（whsec_ 开头）" },
  ],
  email: [
    { name: SMTP_FIELDS.host, label: "SMTP 主机" },
    { name: SMTP_FIELDS.port, label: "端口（25、465、587、2525）" },
    { name: SMTP_FIELDS.encryption, label: "加密方式" },
    { name: SMTP_FIELDS.username, label: "用户名" },
    { name: SMTP_FIELDS.password, label: "密码" },
    { name: SMTP_FIELDS.fromName, label: "发件人名称" },
    { name: SMTP_FIELDS.fromAddress, label: "发件人地址" },
  ],
};

const ISSUE_MESSAGES: Readonly<Record<SecretFieldIssue["reason"], string>> = {
  REQUIRED: "必填（Stripe 的三项要一起填）",
  FORMAT: "只能有英文字母、数字、下划线和连字符，请检查复制时是否带进了空格或别的字符",
  TOO_SHORT: "太短了，请检查是否复制完整",
  TOO_LONG: "太长了，请检查是否多复制了内容",
  PREFIX: "开头不对：secret key 以 sk_test_ 或 sk_live_ 开头，publishable key 以 pk_test_ 或 pk_live_ 开头，webhook signing secret 以 whsec_ 开头",
  MODE_MISMATCH: "secret key 和 publishable key 必须同为测试（test）或同为正式（live）",
  LIVE_KEY_NOT_ALLOWED: "这个环境只能用 Stripe 的测试密钥（sk_test_ 开头）",
  TEST_KEY_NOT_ALLOWED: "正式环境只能用 Stripe 的正式密钥（sk_live_ 开头）",
  PORT_NOT_ALLOWED: "端口只能是 25、465、587、2525",
  ENCRYPTION_NOT_ALLOWED: "这个环境不能用明文发信，请选 TLS 或 STARTTLS",
  HOST_FORBIDDEN: "不能填内网地址：请填写邮件服务商给的公网主机名",
};

/** 邮件发送这一项的说法：沿用 Stripe 的 `REQUIRED`、`FORMAT` 说法会让人以为要填别的东西。 */
const EMAIL_ISSUE_MESSAGES: Readonly<Partial<Record<SecretFieldIssue["reason"], string>>> = {
  REQUIRED: "必填（七项要一起填）",
  FORMAT: "写法不对，请检查是否带进了换行或别的字符",
};

function issueMessage(key: IntegrationSecretKey, issue: SecretFieldIssue): string {
  return (key === "email" ? EMAIL_ISSUE_MESSAGES[issue.reason] : undefined) ?? ISSUE_MESSAGES[issue.reason];
}

/** 路径里的那一项：`google-maps` / `stripe` / `email`。 */
export function integrationKeyOf(params: unknown): IntegrationSecretKey {
  const raw = typeof params === "object" && params !== null ? (params as { key?: unknown }).key : undefined;
  const key = typeof raw === "string" ? raw.replaceAll("-", "_") : "";
  if (typeof raw !== "string" || raw.includes("_") || !isIntegrationSecretKey(key)) throw notFound("这一项第三方密钥");
  return key;
}

function encryptionNotConfigured(): AppError {
  return new AppError(503, "INTEGRATION_ENCRYPTION_NOT_CONFIGURED", "服务器还没有配置数据加密密钥（DATA_ENCRYPTION_KEY），现在不能在后台填写第三方密钥。请联系技术人员");
}

function sourceOf(effective: EffectiveIntegrations, key: IntegrationSecretKey): SecretSource {
  return key === "google_maps" ? effective.googleMaps.source : key === "stripe" ? effective.stripe.source : effective.email.source;
}

/** 生效的那一份里用来打码显示的值：谷歌地图是密钥本身，Stripe 是 secret key，邮件发送是密码。 */
function effectiveValue(effective: EffectiveIntegrations, key: IntegrationSecretKey): string | null {
  return key === "google_maps" ? effective.googleMaps.apiKey : key === "stripe" ? (effective.stripe.config?.secretKey ?? null) : (effective.email.config?.password ?? null);
}

function envConfigured(config: AppConfig, key: IntegrationSecretKey): boolean {
  return key === "google_maps" ? config.googleMapsApiKey !== null : key === "stripe" ? config.stripe !== null : config.smtp !== null;
}

/** SMTP 配置里不是密钥的几项：页面显示给超级管理员。 */
function smtpSettingsJson(settings: SmtpSettings): Record<string, unknown> {
  return { host: settings.host, port: settings.port, encryption: settings.encryption, username: settings.username, from_name: settings.fromName, from_address: settings.fromAddress };
}

/** 页面上的一项。没有 `integration.manage` 的人只拿到状态和来源，没有任何打码的片段。 */
function itemJson(ctx: AppContext, key: IntegrationSecretKey, canManage: boolean): Record<string, unknown> {
  const effective = ctx.integrations.effective;
  const source = sourceOf(effective, key);
  const value = effectiveValue(effective, key);
  const admin = ctx.integrations.adminState(key);
  return {
    key,
    label: LABELS[key],
    fields: FIELD_LABELS[key],
    state: value === null ? "missing" : "configured",
    source,
    source_label: SECRET_SOURCE_LABELS[source],
    mode: key === "stripe" ? (effective.stripe.config?.mode ?? null) : null,
    masked: canManage && value !== null ? maskLast4(value) : null,
    settings: canManage && key === "email" && effective.email.config !== null ? smtpSettingsJson(effective.email.config) : null,
    env_configured: envConfigured(ctx.config, key),
    admin: !canManage
      ? null
      : admin === null
        ? { configured: false, hints: null, updated_at: null, updated_by: null, problem: null }
        : { configured: true, hints: admin.hints, updated_at: admin.updatedAt.toISOString(), updated_by: admin.updatedBy, problem: admin.problem },
  };
}

export function listIntegrationSecretsJson(ctx: AppContext, principal: PlatformPrincipal): Record<string, unknown> {
  const canManage = principalCan(principal, "integration.manage");
  return {
    precedence_note: SECRET_PRECEDENCE_NOTE,
    can_manage: canManage,
    encryption_configured: ctx.secretBox !== null,
    items: INTEGRATION_SECRET_KEYS.map((key) => itemJson(ctx, key, canManage)),
  };
}

export function integrationItemJson(ctx: AppContext, key: IntegrationSecretKey): Record<string, unknown> {
  return itemJson(ctx, key, true);
}

/** 请求体里的值：去掉粘贴时带进来的首尾空白。 */
function cleaned(value: string): string {
  return value.trim();
}

function issuesOrThrow(key: IntegrationSecretKey, issues: SecretFieldIssue[]): void {
  if (issues.length === 0) return;
  throw validationFailed(
    "body",
    issues.map((issue) => ({ path: `/${issue.field}`, message: issueMessage(key, issue), reason: issue.reason })),
  );
}

export interface EmailInput {
  host: string;
  port: number;
  encryption: string;
  username: string;
  password: string;
  fromName: string;
  fromAddress: string;
}

export type SecretInput = { key: "google_maps"; apiKey: string } | { key: "stripe"; keys: StripeKeys } | { key: "email"; settings: EmailInput };

/** 邮件发送的校验 + 去空白：写法的规则在 config，主机是不是内网的规则在 domain。不合格抛 400，不回显填的值。 */
function cleanedEmailSettings(ctx: AppContext, input: EmailInput): SmtpSettings {
  const settings = {
    host: cleaned(input.host).toLowerCase(),
    port: input.port,
    encryption: cleaned(input.encryption),
    username: cleaned(input.username),
    password: cleaned(input.password),
    fromName: cleaned(input.fromName),
    fromAddress: cleaned(input.fromAddress),
  };
  const issues = smtpSettingsIssues(ctx.config.appEnv, settings);
  if (settings.host !== "" && !issues.some((issue) => issue.field === SMTP_FIELDS.host) && !smtpHostAllowed(settings.host, { allowLoopback: isLocalEnv(ctx.config) })) {
    issues.push({ field: SMTP_FIELDS.host, reason: "HOST_FORBIDDEN" });
  }
  issuesOrThrow("email", issues);
  return { ...settings, encryption: settings.encryption as SmtpEncryption };
}

/** 审计里记的邮件发送配置：记主机（「服务器被改去连哪里」正是要查的），不记密码和用户名（审计的读者比这张卡片多）。 */
function emailAuditSettings(settings: SmtpSettings): Record<string, unknown> {
  return { host: settings.host, port: settings.port, encryption: settings.encryption, from_name: settings.fromName, from_address: settings.fromAddress };
}

/** 审计「更换 / 清空」前的邮件发送配置：库里是整组密文，在同一把锁里解开这一行。解不开时不记主机这些，只有打码的密码。 */
function emailBeforeAudit(ctx: AppContext, row: IntegrationSecretRow): Record<string, unknown> {
  if (row.integration !== "email") return {};
  const values = openSecretRow(ctx.secretBox, row);
  return values === null ? {} : { settings: emailAuditSettings(smtpSettingsOf(values)) };
}

/** 填写或更换。返回填写（`set`）还是更换（`replace`）。 */
export async function saveIntegrationSecretValue(ctx: AppContext, principal: PlatformPrincipal, input: SecretInput, ip: string): Promise<"set" | "replace"> {
  if (ctx.secretBox === null) throw encryptionNotConfigured();
  let values: Record<string, string>;
  let auditExtra: Record<string, unknown> = {};
  if (input.key === "google_maps") {
    const apiKey = cleaned(input.apiKey);
    issuesOrThrow(input.key, googleMapsKeyIssues(apiKey));
    values = { [GOOGLE_MAPS_FIELD]: apiKey };
  } else if (input.key === "stripe") {
    const keys = { secretKey: cleaned(input.keys.secretKey), publishableKey: cleaned(input.keys.publishableKey), webhookSecret: cleaned(input.keys.webhookSecret) };
    issuesOrThrow(input.key, adminStripeKeyIssues(ctx.config.appEnv, keys));
    values = { [STRIPE_FIELDS.secretKey]: keys.secretKey, [STRIPE_FIELDS.publishableKey]: keys.publishableKey, [STRIPE_FIELDS.webhookSecret]: keys.webhookSecret };
  } else {
    const settings = cleanedEmailSettings(ctx, input.settings);
    values = {
      [SMTP_FIELDS.host]: settings.host,
      [SMTP_FIELDS.port]: String(settings.port),
      [SMTP_FIELDS.encryption]: settings.encryption,
      [SMTP_FIELDS.username]: settings.username,
      [SMTP_FIELDS.password]: settings.password,
      [SMTP_FIELDS.fromName]: settings.fromName,
      [SMTP_FIELDS.fromAddress]: settings.fromAddress,
    };
    auditExtra = { settings: emailAuditSettings(settings) };
  }
  // 打码的只有密钥：邮件发送只有密码，其余几项不是密钥
  const hints = Object.fromEntries(Object.entries(input.key === "email" ? { [SMTP_FIELDS.password]: values[SMTP_FIELDS.password] as string } : values).map(([field, value]) => [field, maskLast4(value)]));
  const sealed = ctx.secretBox.seal(PURPOSE, input.key, JSON.stringify(values));
  const now = ctx.now();
  const action = await withPlatformTx(ctx.pool, async (db) => {
    await queueIntegrationSecretChange(db, input.key);
    const before = await lockIntegrationSecret(db, input.key);
    await saveIntegrationSecret(db, { integration: input.key, sealed, hints, updatedAt: now, updatedBy: principal.user.id });
    const action = before === null ? "set" : "replace";
    await insertAuditLog(db, consoleOrigin(platformActor(principal.user), ip, now), {
      tenantId: null,
      resource: "integration_secret",
      resourceId: input.key,
      action,
      before: before === null ? null : { hints: before.hints, ...emailBeforeAudit(ctx, before) },
      after: { hints, ...auditExtra },
    });
    return action;
  });
  await ctx.integrations.reloadNow();
  return action;
}

/** 清空：删掉后台这一份，回落到服务器配置文件。后台本来就没填时 409。 */
export async function clearIntegrationSecretValue(ctx: AppContext, principal: PlatformPrincipal, key: IntegrationSecretKey, ip: string): Promise<void> {
  const now = ctx.now();
  await withPlatformTx(ctx.pool, async (db) => {
    await queueIntegrationSecretChange(db, key);
    const before = await lockIntegrationSecret(db, key);
    if (before === null || !(await deleteIntegrationSecret(db, key))) throw new AppError(409, "INTEGRATION_SECRET_NOT_SET", "后台没有填写这一项，不用清空");
    await insertAuditLog(db, consoleOrigin(platformActor(principal.user), ip, now), {
      tenantId: null,
      resource: "integration_secret",
      resourceId: key,
      action: "clear",
      before: { hints: before.hints, ...emailBeforeAudit(ctx, before) },
      after: null,
    });
  });
  await ctx.integrations.reloadNow();
}

/** 测试邮件：只发给当前操作的超级管理员（ADR 0048：接口不接受收件人，不会被当成发信工具）。 */
async function checkEmail(ctx: AppContext, principal: PlatformPrincipal, settings: SmtpSettings): Promise<EmailCheckResult> {
  const to = principal.user.email;
  const sent = await sendMailWith(ctx, settings, {
    to,
    subject: "NOZOMI 邮件发送测试",
    text: `这是一封测试邮件：${principal.user.name} 在运营后台「系统设置 → 系统状态 → 第三方密钥」点了「测试一下」（环境：${ctx.config.appEnv}）。\n收到这封邮件，说明邮件发送配置可用。不需要回复。`,
  });
  return sent.ok ? { ok: true } : { ok: false, code: sent.code, message: sent.message };
}

type EmailCheckResult = { ok: true } | { ok: false; code: SmtpFailureCode | "MESSAGE_INVALID"; message: string };

const TEST_NOT_CONFIGURED: Readonly<Record<IntegrationSecretKey, string>> = { google_maps: "谷歌地图 还没有配置，先填写密钥再测试", stripe: "Stripe 还没有配置，先填写密钥再测试", email: "邮件发送还没有配置，先填写再测试" };

/** 「测试一下」：用现在生效的那一份（不论来自后台还是配置文件）调一次对方最便宜的只读接口；邮件发送是发一封测试邮件给自己。 */
export async function testIntegrationSecret(ctx: AppContext, principal: PlatformPrincipal, key: IntegrationSecretKey, ip: string): Promise<Record<string, unknown>> {
  await ctx.integrations.ensureFresh();
  const effective = ctx.integrations.effective;
  const source = sourceOf(effective, key);
  const mapsKey = effective.googleMaps.apiKey;
  const stripe = effective.stripe.config;
  const smtp = effective.email.config;
  if (key === "google_maps" ? mapsKey === null : key === "stripe" ? stripe === null : smtp === null) {
    throw new AppError(409, "INTEGRATION_NOT_CONFIGURED", TEST_NOT_CONFIGURED[key]);
  }
  const retryAfter = ctx.integrations.claimTest(key, ctx.now());
  if (retryAfter !== null) throw new AppError(429, "INTEGRATION_TEST_RATE_LIMITED", "刚测过，请过几秒再试", { retry_after_seconds: retryAfter });
  // 上面已经确认这一项有生效的值
  const result: IntegrationCheckResult | EmailCheckResult =
    key === "google_maps"
      ? await ctx.integrationChecks.googleMaps(mapsKey as string)
      : key === "stripe"
        ? await ctx.integrationChecks.stripe(stripe as NonNullable<typeof stripe>)
        : await checkEmail(ctx, principal, smtp as SmtpSettings);
  const now = ctx.now();
  await withPlatformTx(ctx.pool, (db) =>
    insertAuditLog(db, consoleOrigin(platformActor(principal.user), ip, now), {
      tenantId: null,
      resource: "integration_secret",
      resourceId: key,
      action: "test",
      before: null,
      after: { source, ok: result.ok, code: result.ok ? null : result.code },
    }),
  );
  return {
    key,
    ok: result.ok,
    code: result.ok ? null : result.code,
    message: result.ok ? (key === "email" ? `邮件服务器已接收，测试邮件发到了 ${principal.user.email}，请去邮箱确认（也看看垃圾邮件）` : `${LABELS[key]}可用`) : result.message,
    source,
    source_label: SECRET_SOURCE_LABELS[source],
    tested_at: now.toISOString(),
  };
}
