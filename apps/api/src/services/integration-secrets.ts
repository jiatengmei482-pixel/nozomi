/**
 * 运营后台填写的第三方密钥（M4-09，ADR 0041）：谷歌地图、Stripe。
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
  type IntegrationSecretKey,
  NO_ADMIN_SECRETS,
  SECRET_PRECEDENCE_NOTE,
  SECRET_SOURCE_LABELS,
  STRIPE_FIELDS,
  type SecretFieldIssue,
  type SecretSource,
  type StripeKeys,
  adminStripeKeyIssues,
  envIntegrations,
  googleMapsKeyIssues,
  isIntegrationSecretKey,
  maskLast4,
  resolveIntegrations,
} from "@nozomi/config";
import type { AppContext } from "../context.ts";
import { withPlatformTx } from "../db/context.ts";
import type { Pool } from "../db/pool.ts";
import { AppError } from "../errors.ts";
import { withTimeout } from "../health.ts";
import type { IntegrationCheckResult } from "../integrations/integration-check.ts";
import { type SecretBox, SecretBoxError } from "../integrations/secret-box.ts";
import { insertAuditLog } from "../repos/audit-logs.ts";
import { type IntegrationSecretRow, deleteIntegrationSecret, listIntegrationSecrets, lockIntegrationSecret, saveIntegrationSecret } from "../repos/integration-secrets.ts";
import { validationFailed } from "../validation.ts";
import { consoleOrigin, platformActor } from "./audit.ts";
import { notFound } from "./errors.ts";
import { type PlatformPrincipal, principalCan } from "./platform-auth.ts";

/** 缓存多久重读一次（毫秒）：别的进程改了密钥，本进程最迟这么久之后用上新值。 */
export const INTEGRATION_SECRETS_TTL_MS = 5_000;
/** 请求开始前等重读最多等多久（毫秒）：数据库慢或连不上时不拖住请求，先用手上的值。 */
export const INTEGRATION_SECRETS_WAIT_MS = 500;

const PURPOSE = "integration-secret";

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
    for (const row of rows) {
      const values = this.#open(row);
      admin[row.integration] = { hints: row.hints, version: row.version, updatedAt: row.updatedAt, updatedBy: row.updatedBy, problem: values === null ? "UNREADABLE" : null };
      if (values === null) continue;
      secretValues.push(...Object.values(values));
      if (row.integration === "google_maps") opened.googleMaps = { apiKey: values[GOOGLE_MAPS_FIELD] ?? "" };
      else opened.stripe = { secretKey: values[STRIPE_FIELDS.secretKey] ?? "", publishableKey: values[STRIPE_FIELDS.publishableKey] ?? "", webhookSecret: values[STRIPE_FIELDS.webhookSecret] ?? "" };
    }
    const effective = resolveIntegrations(this.#config, opened);
    if (effective.adminIgnored.googleMaps && admin.google_maps) admin.google_maps.problem = "NOT_ALLOWED_IN_ENV";
    if (effective.adminIgnored.stripe && admin.stripe) admin.stripe.problem = "NOT_ALLOWED_IN_ENV";
    return { effective, admin, secretValues };
  }

  #open(row: IntegrationSecretRow): Record<string, string> | null {
    if (this.#box === null) return null;
    try {
      const parsed = JSON.parse(this.#box.open(PURPOSE, row.integration, row.sealed)) as unknown;
      if (typeof parsed !== "object" || parsed === null) return null;
      return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    } catch (err) {
      if (err instanceof SecretBoxError || err instanceof SyntaxError) return null;
      throw err;
    }
  }
}

// ---- 接口用到的流程 ----

export interface IntegrationChecks {
  googleMaps(apiKey: string): Promise<IntegrationCheckResult>;
  stripe(config: NonNullable<EffectiveIntegrations["stripe"]["config"]>): Promise<IntegrationCheckResult>;
}

const LABELS: Readonly<Record<IntegrationSecretKey, string>> = { google_maps: "谷歌地图", stripe: "Stripe 支付" };

const FIELD_LABELS: Readonly<Record<IntegrationSecretKey, readonly { name: string; label: string }[]>> = {
  google_maps: [{ name: GOOGLE_MAPS_FIELD, label: "API 密钥" }],
  stripe: [
    { name: STRIPE_FIELDS.secretKey, label: "Secret key（sk_ 开头）" },
    { name: STRIPE_FIELDS.publishableKey, label: "Publishable key（pk_ 开头）" },
    { name: STRIPE_FIELDS.webhookSecret, label: "Webhook signing secret（whsec_ 开头）" },
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
};

/** 路径里的那一项：`google-maps` / `stripe`。 */
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
  return key === "google_maps" ? effective.googleMaps.source : effective.stripe.source;
}

/** 生效的那一份里用来打码显示的值：谷歌地图是密钥本身，Stripe 是 secret key。 */
function effectiveValue(effective: EffectiveIntegrations, key: IntegrationSecretKey): string | null {
  return key === "google_maps" ? effective.googleMaps.apiKey : (effective.stripe.config?.secretKey ?? null);
}

function envConfigured(config: AppConfig, key: IntegrationSecretKey): boolean {
  return key === "google_maps" ? config.googleMapsApiKey !== null : config.stripe !== null;
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
    items: (["google_maps", "stripe"] as const).map((key) => itemJson(ctx, key, canManage)),
  };
}

export function integrationItemJson(ctx: AppContext, key: IntegrationSecretKey): Record<string, unknown> {
  return itemJson(ctx, key, true);
}

/** 请求体里的值：去掉粘贴时带进来的首尾空白。 */
function cleaned(value: string): string {
  return value.trim();
}

function issuesOrThrow(issues: SecretFieldIssue[]): void {
  if (issues.length === 0) return;
  throw validationFailed(
    "body",
    issues.map((issue) => ({ path: `/${issue.field}`, message: ISSUE_MESSAGES[issue.reason], reason: issue.reason })),
  );
}

export type SecretInput = { key: "google_maps"; apiKey: string } | { key: "stripe"; keys: StripeKeys };

/** 填写或更换。返回填写（`set`）还是更换（`replace`）。 */
export async function saveIntegrationSecretValue(ctx: AppContext, principal: PlatformPrincipal, input: SecretInput, ip: string): Promise<"set" | "replace"> {
  if (ctx.secretBox === null) throw encryptionNotConfigured();
  let values: Record<string, string>;
  if (input.key === "google_maps") {
    const apiKey = cleaned(input.apiKey);
    issuesOrThrow(googleMapsKeyIssues(apiKey));
    values = { [GOOGLE_MAPS_FIELD]: apiKey };
  } else {
    const keys = { secretKey: cleaned(input.keys.secretKey), publishableKey: cleaned(input.keys.publishableKey), webhookSecret: cleaned(input.keys.webhookSecret) };
    issuesOrThrow(adminStripeKeyIssues(ctx.config.appEnv, keys));
    values = { [STRIPE_FIELDS.secretKey]: keys.secretKey, [STRIPE_FIELDS.publishableKey]: keys.publishableKey, [STRIPE_FIELDS.webhookSecret]: keys.webhookSecret };
  }
  const hints = Object.fromEntries(Object.entries(values).map(([field, value]) => [field, maskLast4(value)]));
  const sealed = ctx.secretBox.seal(PURPOSE, input.key, JSON.stringify(values));
  const now = ctx.now();
  const action = await withPlatformTx(ctx.pool, async (db) => {
    const before = await lockIntegrationSecret(db, input.key);
    await saveIntegrationSecret(db, { integration: input.key, sealed, hints, updatedAt: now, updatedBy: principal.user.id });
    const action = before === null ? "set" : "replace";
    await insertAuditLog(db, consoleOrigin(platformActor(principal.user), ip, now), {
      tenantId: null,
      resource: "integration_secret",
      resourceId: input.key,
      action,
      before: before === null ? null : { hints: before.hints },
      after: { hints },
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
    const before = await lockIntegrationSecret(db, key);
    if (before === null || !(await deleteIntegrationSecret(db, key))) throw new AppError(409, "INTEGRATION_SECRET_NOT_SET", "后台没有填写这一项，不用清空");
    await insertAuditLog(db, consoleOrigin(platformActor(principal.user), ip, now), {
      tenantId: null,
      resource: "integration_secret",
      resourceId: key,
      action: "clear",
      before: { hints: before.hints },
      after: null,
    });
  });
  await ctx.integrations.reloadNow();
}

/** 「测试一下」：用现在生效的那一份（不论来自后台还是配置文件）调一次对方最便宜的只读接口。 */
export async function testIntegrationSecret(ctx: AppContext, principal: PlatformPrincipal, key: IntegrationSecretKey, ip: string): Promise<Record<string, unknown>> {
  await ctx.integrations.ensureFresh();
  const effective = ctx.integrations.effective;
  const source = sourceOf(effective, key);
  let result: IntegrationCheckResult;
  if (key === "google_maps") {
    if (effective.googleMaps.apiKey === null) throw new AppError(409, "INTEGRATION_NOT_CONFIGURED", "谷歌地图还没有配置，先填写密钥再测试");
    result = await ctx.integrationChecks.googleMaps(effective.googleMaps.apiKey);
  } else {
    if (effective.stripe.config === null) throw new AppError(409, "INTEGRATION_NOT_CONFIGURED", "Stripe 还没有配置，先填写密钥再测试");
    result = await ctx.integrationChecks.stripe(effective.stripe.config);
  }
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
    message: result.ok ? `${LABELS[key]}可用` : result.message,
    source,
    source_label: SECRET_SOURCE_LABELS[source],
    tested_at: now.toISOString(),
  };
}
