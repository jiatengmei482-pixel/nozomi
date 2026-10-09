/**
 * 应用配置与第三方账号密钥的唯一入口。
 *
 * 规则：
 * - 所有配置只从环境变量读取，代码里不写任何密钥。
 * - 启动时校验一次，缺失或格式不对立即报错退出（fail fast）。
 * - 只有 production 必须配齐 Stripe、谷歌地图；local / ci / staging 可以缺，缺的集成在功能上显示为「未配置」
 *   （staging 放宽的原因见 ADR 0007「测试环境的配置校验」）。
 * - 测试密钥和正式密钥不能混用：非 production 环境禁止使用 Stripe live 密钥。
 * - 数据库有两个连接串（ADR 0010）：`DATABASE_URL` 是服务进程用的应用账号（最小权限）；
 *   `DATABASE_MIGRATION_URL` 是迁移账号（表的所有者），只有 `pnpm db:migrate`、`pnpm db:provision` 读它，
 *   服务进程的环境里不应该有它。两者不能是同一个账号。
 */
import { z } from "zod";

export const APP_ENVS = ["local", "ci", "staging", "production"] as const;
export type AppEnv = (typeof APP_ENVS)[number];

/** 能否被解析成 URL。报错信息里永远不带原值（连接串里有密码）。 */
function isParsableUrl(value: string): boolean {
  return URL.canParse(value);
}

function databaseUrlSchema(name: string): z.ZodType<string, z.ZodTypeDef, string> {
  return z
    .string({ required_error: `缺少 ${name}` })
    .regex(/^postgres(ql)?:\/\//, `${name} 必须是 postgres:// 连接串`)
    .refine(isParsableUrl, `${name} 不是合法的连接串（无法解析，请检查主机名、端口和特殊字符是否转义）`);
}

/** 连接串里的账号名；解析不了时返回 null。 */
export function databaseUserOf(url: string): string | null {
  if (!URL.canParse(url)) return null;
  const user = decodeURIComponent(new URL(url).username);
  return user === "" ? null : user;
}

const SAME_DATABASE_ACCOUNT =
  "DATABASE_URL 和 DATABASE_MIGRATION_URL 不能是同一个数据库账号：服务进程必须用权限最小的应用账号，迁移账号只给 pnpm db:migrate 用（docs/secrets.md）";

function sameDatabaseAccount(appUrl: string, migrationUrl: string): boolean {
  const appUser = databaseUserOf(appUrl);
  return appUser !== null && appUser === databaseUserOf(migrationUrl);
}

const optionalString = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional();

/** 浏览器请求瓦片图片时可以用的来源页策略（全站是 no-referrer；多数瓦片服务要求带上来源域名）。 */
export const MAP_TILE_REFERRER_POLICIES = ["no-referrer", "origin", "strict-origin", "strict-origin-when-cross-origin"] as const;
export type MapTileReferrerPolicy = (typeof MAP_TILE_REFERRER_POLICIES)[number];

export interface MapTileAttribution {
  text: string;
  /** 署名链接；没有链接时为 null */
  href: string | null;
}

/** 地图底图的配置。接口原样下发给浏览器（`GET /tenant/v1/map/config`）。 */
export interface MapTilesConfig {
  urlTemplate: string;
  darkUrlTemplate: string | null;
  minZoom: number;
  maxZoom: number;
  tileSize: number;
  referrerPolicy: MapTileReferrerPolicy;
  attribution: MapTileAttribution[];
}

/**
 * 瓦片地址模板的写法：`https://主机[:端口]/路径`，路径里有 {z}、{x}、{y}。只接受这一种形状——
 * 它的「协议 + 主机 + 端口」要原样拼进内容安全策略（deploy/bin/compose.sh 用同一条规则取），不能带引号、空白、分号这些字符。
 */
const TILE_URL_TEMPLATE = /^(https:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?)\/[A-Za-z0-9._~\-\/{}?=&%@:+,]*$/;

/**
 * 瓦片地址的来源（协议 + 主机 + 端口），就是要放进内容安全策略 `img-src` 的那个值；地址不合规返回 null。
 * 本机调试和端到端测试用的 `http://127.0.0.1:端口/…`、`http://localhost:端口/…` 也认。
 */
export function mapTileOrigin(urlTemplate: string): string | null {
  const match = TILE_URL_TEMPLATE.exec(urlTemplate) ?? /^(http:\/\/(?:127\.0\.0\.1|localhost)(?::[0-9]{1,5})?)\/[A-Za-z0-9._~\-\/{}?=&%@:+,]*$/.exec(urlTemplate);
  if (!match) return null;
  return ["{z}", "{x}", "{y}"].every((part) => urlTemplate.includes(part)) ? (match[1] as string) : null;
}

/** 署名的写法：`文字|链接`，多条用 `;;` 隔开；链接可以不写。例如 `© OpenStreetMap 贡献者|https://www.openstreetmap.org/copyright`。 */
function parseAttribution(value: string): MapTileAttribution[] | null {
  const items = value.split(";;").map((item) => item.trim()).filter((item) => item !== "");
  const parsed = items.map((item): MapTileAttribution | null => {
    const [text = "", href = "", ...rest] = item.split("|").map((part) => part.trim());
    if (text === "" || text.length > 200 || rest.length > 0) return null;
    if (href !== "" && !/^https:\/\/[^\s"'<>]+$/.test(href)) return null;
    return { text, href: href === "" ? null : href };
  });
  return parsed.length > 0 && parsed.every((item) => item !== null) ? (parsed as MapTileAttribution[]) : null;
}

function parseMapTiles(env: z.output<typeof rawSchema>, issues: string[]): MapTilesConfig | null {
  const url = env.MAP_TILE_URL_TEMPLATE;
  if (url === undefined) {
    if (env.MAP_TILE_DARK_URL_TEMPLATE !== undefined || env.MAP_TILE_ATTRIBUTION !== undefined) {
      issues.push("配置了 MAP_TILE_DARK_URL_TEMPLATE 或 MAP_TILE_ATTRIBUTION，却没有 MAP_TILE_URL_TEMPLATE");
    }
    return null;
  }
  const local = env.APP_ENV === "local" || env.APP_ENV === "ci";
  const acceptable = (template: string): boolean => {
    const origin = mapTileOrigin(template);
    return origin !== null && (origin.startsWith("https://") || local);
  };
  const shape = "应当是 https://主机/…{z}/{x}/{y}… 这样的地址，包含 {z}、{x}、{y}，不能有空格和引号";
  if (!acceptable(url)) issues.push(`MAP_TILE_URL_TEMPLATE ${shape}`);
  const dark = env.MAP_TILE_DARK_URL_TEMPLATE ?? null;
  if (dark !== null && !acceptable(dark)) issues.push(`MAP_TILE_DARK_URL_TEMPLATE ${shape}`);
  const attribution = env.MAP_TILE_ATTRIBUTION === undefined ? null : parseAttribution(env.MAP_TILE_ATTRIBUTION);
  if (attribution === null) {
    issues.push("配置了地图底图就必须配置 MAP_TILE_ATTRIBUTION（版权署名，写法：文字|https://链接，多条用 ;; 隔开）：底图服务的使用条款都要求在地图上显示署名");
  }
  if (env.MAP_TILE_MIN_ZOOM > env.MAP_TILE_MAX_ZOOM) issues.push("MAP_TILE_MIN_ZOOM 不能大于 MAP_TILE_MAX_ZOOM");
  return {
    urlTemplate: url,
    darkUrlTemplate: dark,
    minZoom: env.MAP_TILE_MIN_ZOOM,
    maxZoom: env.MAP_TILE_MAX_ZOOM,
    tileSize: env.MAP_TILE_SIZE,
    referrerPolicy: env.MAP_TILE_REFERRER_POLICY,
    attribution: attribution ?? [],
  };
}

const rawSchema = z.object({
  APP_ENV: z.enum(APP_ENVS).default("local"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:8080"),
  // 服务前面有几层自己的反向代理（Nginx / Caddy 等）。0 表示直接对外，不信任 X-Forwarded-For。
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),

  DATABASE_URL: databaseUrlSchema("DATABASE_URL"),
  DATABASE_MIGRATION_URL: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    databaseUrlSchema("DATABASE_MIGRATION_URL").optional(),
  ),
  AUTH_JWT_SECRET: z.string().min(32, "AUTH_JWT_SECRET 至少 32 个字符"),

  STRIPE_SECRET_KEY: optionalString,
  STRIPE_PUBLISHABLE_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,

  GOOGLE_MAPS_API_KEY: optionalString,

  // 地图底图（栅格瓦片）。不是密钥：这些值会经接口下发给浏览器。没配 = 这个环境没有底图。见 ADR 0015。
  MAP_TILE_URL_TEMPLATE: optionalString,
  MAP_TILE_DARK_URL_TEMPLATE: optionalString,
  MAP_TILE_ATTRIBUTION: optionalString,
  MAP_TILE_REFERRER_POLICY: z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), z.enum(MAP_TILE_REFERRER_POLICIES).default("strict-origin")),
  MAP_TILE_MIN_ZOOM: z.preprocess((value) => (value === "" ? undefined : value), z.coerce.number().int().min(0).max(22).default(3)),
  MAP_TILE_MAX_ZOOM: z.preprocess((value) => (value === "" ? undefined : value), z.coerce.number().int().min(1).max(22).default(19)),
  MAP_TILE_SIZE: z.preprocess((value) => (value === "" ? undefined : value), z.coerce.number().int().refine((size) => size === 256 || size === 512, "只能是 256 或 512").default(256)),

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
  /** 应用账号的连接串：服务进程和管理员命令行用它 */
  databaseUrl: string;
  /** 迁移账号的连接串；服务进程的环境里没有它时为 null */
  databaseMigrationUrl: string | null;
  authJwtSecret: string;
  stripe: StripeConfig | null;
  googleMapsApiKey: string | null;
  /** 地图底图；这个环境没有配置时为 null */
  mapTiles: MapTilesConfig | null;
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
  const mapTiles = parseMapTiles(env, issues);
  const googleMapsApiKey = env.GOOGLE_MAPS_API_KEY ?? null;
  if (!googleMapsApiKey && env.APP_ENV === "production") {
    issues.push("production 环境必须配置 GOOGLE_MAPS_API_KEY");
  }
  if (env.APP_ENV === "production" && env.AUTH_JWT_SECRET.length < 64) {
    issues.push("production 环境的 AUTH_JWT_SECRET 至少 64 个字符");
  }
  const databaseMigrationUrl = env.DATABASE_MIGRATION_URL ?? null;
  if (databaseMigrationUrl !== null && sameDatabaseAccount(env.DATABASE_URL, databaseMigrationUrl)) {
    issues.push(SAME_DATABASE_ACCOUNT);
  }
  if (issues.length) throw new ConfigError(issues);

  return {
    appEnv: env.APP_ENV,
    port: env.PORT,
    publicBaseUrl: env.PUBLIC_BASE_URL,
    trustProxyHops: env.TRUST_PROXY_HOPS,
    databaseUrl: env.DATABASE_URL,
    databaseMigrationUrl,
    authJwtSecret: env.AUTH_JWT_SECRET,
    stripe,
    googleMapsApiKey,
    mapTiles,
    fx: { sourceUrl: env.FX_SOURCE_URL, bufferPercent: env.FX_BUFFER_PERCENT },
  };
}

const migrationSchema = z.object({
  DATABASE_MIGRATION_URL: databaseUrlSchema("DATABASE_MIGRATION_URL"),
  DATABASE_URL: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    databaseUrlSchema("DATABASE_URL").optional(),
  ),
});

export interface MigrationConfig {
  /** 迁移账号（表的所有者）的连接串 */
  databaseMigrationUrl: string;
  /** 应用账号的连接串；`pnpm db:provision` 从这里取应用账号的名字和密码，`pnpm db:migrate` 不需要它 */
  databaseUrl: string | null;
}

/**
 * 迁移和建应用账号这两个命令的配置：只读两个连接串，不要求登录签名密钥等服务进程才用的项，
 * 这样执行迁移的容器里不必放那些密钥。
 */
export function loadMigrationConfig(source: Record<string, string | undefined> = process.env): MigrationConfig {
  const parsed = migrationSchema.safeParse(source);
  if (!parsed.success) {
    throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`));
  }
  const databaseUrl = parsed.data.DATABASE_URL ?? null;
  if (databaseUrl !== null && sameDatabaseAccount(databaseUrl, parsed.data.DATABASE_MIGRATION_URL)) {
    throw new ConfigError([SAME_DATABASE_ACCOUNT]);
  }
  return { databaseMigrationUrl: parsed.data.DATABASE_MIGRATION_URL, databaseUrl };
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
