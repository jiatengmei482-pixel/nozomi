/**
 * 应用配置与第三方账号密钥的唯一入口。
 *
 * 规则：
 * - 所有配置只从环境变量读取，代码里不写任何密钥。
 * - 启动时校验一次，缺失或格式不对立即报错退出（fail fast）。
 * - 只有 production 必须配齐 Stripe、谷歌地图；local / ci / staging 可以缺，缺的集成在功能上显示为「未配置」
 *   （staging 放宽的原因见 ADR 0007「测试环境的配置校验」）。
 * - 测试密钥和正式密钥不能混用：非 production 环境禁止使用 Stripe live 密钥。
 */
import { z } from "zod";

export const APP_ENVS = ["local", "ci", "staging", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

/** 能否被解析成 URL。报错信息里永远不带原值（连接串里有密码）。 */
function isParsableUrl(value: string): boolean {
  return URL.canParse(value);
}

const optionalString = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional();

const rawSchema = z.object({
  APP_ENV: z.enum(APP_ENVS).default("local"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:8080"),
  // 服务前面有几层自己的反向代理（Nginx / Caddy 等）。0 表示直接对外，不信任 X-Forwarded-For。
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),

  DATABASE_URL: z
    .string()
    .regex(/^postgres(ql)?:\/\//, "DATABASE_URL 必须是 postgres:// 连接串")
    .refine(isParsableUrl, "DATABASE_URL 不是合法的连接串（无法解析，请检查主机名、端口和特殊字符是否转义）"),
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
  /** 前置反向代理的层数：决定从 X-Forwarded-For 的哪一段取客户端地址（审计日志、登录限速用） */
  trustProxyHops: number;
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

function parseStripe(
  env: z.output<typeof rawSchema>,
  issues: string[],
): StripeConfig | null {
  const { STRIPE_SECRET_KEY: sk, STRIPE_PUBLISHABLE_KEY: pk, STRIPE_WEBHOOK_SECRET: wh } = env;
  const given = [sk, pk, wh].filter(Boolean).length;
  if (given === 0) {
    if (env.APP_ENV === "production") issues.push("production 环境必须配置 Stripe 三个密钥");
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
  if (!googleMapsApiKey && env.APP_ENV === "production") {
    issues.push("production 环境必须配置 GOOGLE_MAPS_API_KEY");
  }
  if (env.APP_ENV === "production" && env.AUTH_JWT_SECRET.length < 64) {
    issues.push("production 环境的 AUTH_JWT_SECRET 至少 64 个字符");
  }
  if (issues.length) throw new ConfigError(issues);

  return {
    appEnv: env.APP_ENV,
    port: env.PORT,
    publicBaseUrl: env.PUBLIC_BASE_URL,
    trustProxyHops: env.TRUST_PROXY_HOPS,
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

/** 露出首尾所需的最短长度：短于它时首 7 位 + 末 4 位会占掉大半甚至全部，所以整体打码。 */
const MASK_MIN_LENGTH = 20;

/** 密钥脱敏：足够长时只露首 7 位和末 4 位（至少遮住 9 位），否则全部打码。 */
export function mask(secret: string): string {
  if (secret.length < MASK_MIN_LENGTH) return "•".repeat(secret.length);
  return `${secret.slice(0, 7)}…${secret.slice(-4)}`;
}

/** 连接串脱敏：只留协议、用户名、主机、库名；密码和查询参数一律不输出。解析不了时不输出任何原文。 */
function maskUrl(url: string): string {
  if (!URL.canParse(url)) return "连接串无法解析";
  const u = new URL(url);
  return `${u.protocol}//${u.username ? u.username + ":•••@" : ""}${u.host}${u.pathname}`;
}
