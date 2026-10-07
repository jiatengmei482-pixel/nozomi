/**
 * 应用配置与第三方账号密钥的唯一入口。
 *
 * 规则：
 * - 所有配置只从环境变量读取，代码里不写任何密钥。
 * - 启动时校验一次，缺失或格式不对立即报错退出（fail fast）。
 * - staging / production 必须配齐 Stripe、谷歌地图；local / ci 可以缺，缺的集成在功能上显示为「未配置」。
 * - 测试密钥和正式密钥不能混用：非 production 环境禁止使用 Stripe live 密钥。
 */
import { z } from "zod";

export const APP_ENVS = ["local", "ci", "staging", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

const optionalString = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional();

const rawSchema = z.object({
  APP_ENV: z.enum(APP_ENVS).default("local"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:8080"),

  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, "DATABASE_URL 必须是 postgres:// 连接串"),
  AUTH_JWT_SECRET: z.string().min(32, "AUTH_JWT_SECRET 至少 32 个字符"),

  STRIPE_SECRET_KEY: optionalString,
  STRIPE_PUBLISHABLE_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,

  GOOGLE_MAPS_API_KEY: optionalString,

  FX_SOURCE_URL: z.string().url().default("https://open.er-api.com/v6/latest/USD"),
  FX_BUFFER_PERCENT: z.coerce.number().min(0).max(10).default(1.5),
});

export type RawEnv = z.input<typeof rawSchema>;

export interface StripeConfig {
  secretKey: string;
  publishableKey: string;
  webhookSecret: string;
  mode: "test" | "live";
}

export interface AppConfig {
  appEnv: AppEnv;
  port: number;
  publicBaseUrl: string;
  databaseUrl: string;
  authJwtSecret: string;
  stripe: StripeConfig | null;
  googleMapsApiKey: string | null;
  fx: { sourceUrl: string; bufferPercent: number };
}

export class ConfigError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`配置有误：\n- ${issues.join("\n- ")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

const STRICT_ENVS: ReadonlySet<AppEnv> = new Set(["staging", "production"]);

function parseStripe(
  env: z.output<typeof rawSchema>,
  issues: string[],
): StripeConfig | null {
  const { STRIPE_SECRET_KEY: sk, STRIPE_PUBLISHABLE_KEY: pk, STRIPE_WEBHOOK_SECRET: wh } = env;
  const given = [sk, pk, wh].filter(Boolean).length;
  if (given === 0) {
    if (STRICT_ENVS.has(env.APP_ENV)) issues.push(`${env.APP_ENV} 环境必须配置 Stripe 三个密钥`);
    return null;
  }
  if (given < 3) {
    issues.push("Stripe 需要同时配置 STRIPE_SECRET_KEY、STRIPE_PUBLISHABLE_KEY、STRIPE_WEBHOOK_SECRET");
    return null;
  }
  const secretKey = sk as string;
  const publishableKey = pk as string;
  const webhookSecret = wh as string;
  const mode = secretKey.startsWith("sk_live_") ? "live" : secretKey.startsWith("sk_test_") ? "test" : null;
  if (!mode) issues.push("STRIPE_SECRET_KEY 应以 sk_test_ 或 sk_live_ 开头");
  if (!/^pk_(test|live)_/.test(publishableKey)) issues.push("STRIPE_PUBLISHABLE_KEY 应以 pk_test_ 或 pk_live_ 开头");
  if (!webhookSecret.startsWith("whsec_")) issues.push("STRIPE_WEBHOOK_SECRET 应以 whsec_ 开头");
  if (mode && !publishableKey.startsWith(mode === "live" ? "pk_live_" : "pk_test_")) {
    issues.push("Stripe 的 secret key 和 publishable key 必须同为测试或同为正式");
  }
  if (mode === "live" && env.APP_ENV !== "production") {
    issues.push(`${env.APP_ENV} 环境禁止使用 Stripe 正式（live）密钥，请改用 sk_test_ 测试密钥`);
  }
  if (mode === "test" && env.APP_ENV === "production") {
    issues.push("production 环境必须使用 Stripe 正式（live）密钥");
  }
  return mode ? { secretKey, publishableKey, webhookSecret, mode } : null;
}

/** 从环境变量构建配置；有任何问题都抛出 ConfigError，列出全部问题。 */
export function loadConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = rawSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  const env = parsed.data;
  const issues: string[] = [];

  const stripe = parseStripe(env, issues);
  const googleMapsApiKey = env.GOOGLE_MAPS_API_KEY ?? null;
  if (!googleMapsApiKey && STRICT_ENVS.has(env.APP_ENV)) {
    issues.push(`${env.APP_ENV} 环境必须配置 GOOGLE_MAPS_API_KEY`);
  }
  if (env.APP_ENV === "production" && env.AUTH_JWT_SECRET.length < 64) {
    issues.push("production 环境的 AUTH_JWT_SECRET 至少 64 个字符");
  }
  if (issues.length) throw new ConfigError(issues);

  return {
    appEnv: env.APP_ENV,
    port: env.PORT,
    publicBaseUrl: env.PUBLIC_BASE_URL,
    databaseUrl: env.DATABASE_URL,
    authJwtSecret: env.AUTH_JWT_SECRET,
    stripe,
    googleMapsApiKey,
    fx: { sourceUrl: env.FX_SOURCE_URL, bufferPercent: env.FX_BUFFER_PERCENT },
  };
}

export type IntegrationState = "configured" | "missing";

export interface IntegrationStatus {
  key: "database" | "auth" | "stripe" | "googleMaps" | "fx";
  label: string;
  state: IntegrationState;
  detail: string;
}

/** 只给出「是否已配置」和脱敏信息，永远不返回密钥原文。可用于健康检查和后台的集成状态页。 */
export function integrationStatus(config: AppConfig): IntegrationStatus[] {
  return [
    { key: "database", label: "数据库", state: "configured", detail: maskUrl(config.databaseUrl) },
    { key: "auth", label: "登录签名密钥", state: "configured", detail: `${config.authJwtSecret.length} 个字符` },
    config.stripe
      ? { key: "stripe", label: "Stripe 支付", state: "configured", detail: `${config.stripe.mode === "live" ? "正式" : "测试"}模式 · ${mask(config.stripe.secretKey)}` }
      : { key: "stripe", label: "Stripe 支付", state: "missing", detail: "未配置，无法收款" },
    config.googleMapsApiKey
      ? { key: "googleMaps", label: "谷歌地图", state: "configured", detail: mask(config.googleMapsApiKey) }
      : { key: "googleMaps", label: "谷歌地图", state: "missing", detail: "未配置，里程 + 时长报价不可用" },
    { key: "fx", label: "汇率数据源", state: "configured", detail: `${new URL(config.fx.sourceUrl).host} · 缓冲 ${config.fx.bufferPercent}%` },
  ];
}

export function mask(secret: string): string {
  if (secret.length <= 10) return "•".repeat(secret.length);
  return `${secret.slice(0, 7)}…${secret.slice(-4)}`;
}

function maskUrl(url: string): string {
  const u = new URL(url);
  if (u.password) u.password = "•••";
  return `${u.protocol}//${u.username ? u.username + ":•••@" : ""}${u.host}${u.pathname}`;
}
