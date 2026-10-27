/**
 * 应用配置与第三方账号密钥的唯一入口。
 *
 * 规则：
 * - 所有配置只从环境变量读取，代码里不写任何密钥。
 * - 启动时校验一次，缺失或格式不对立即报错退出（fail fast）。
 * - Stripe、谷歌地图哪个环境都可以不在这里配：也可以由超级管理员在运营后台填写（ADR 0041，后台的优先）；两处都没有的显示为「未配置」。
 * - 测试密钥和正式密钥不能混用：非 production 环境禁止使用 Stripe live 密钥。
 * - 数据库有两个连接串（ADR 0010）：`DATABASE_URL` 是服务进程用的应用账号（最小权限）；
 *   `DATABASE_MIGRATION_URL` 是迁移账号（表的所有者），只有 `pnpm db:migrate`、`pnpm db:provision` 读它，
 *   服务进程的环境里不应该有它。两者不能是同一个账号。
 */
import { z } from "zod";
import { type EffectiveIntegrations, SECRET_SOURCE_LABELS, STRIPE_FIELDS, envIntegrations, maskLast4, stripeKeyIssues, stripeModeOf } from "./integration-secrets.ts";

export * from "./integration-secrets.ts";

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

/** 汇率缓冲的上限：10%（1000 基点） */
const FX_BUFFER_MAX_BP = 1_000;

/**
 * 把十进制写的百分比（如 `1.5`、`1.005`）精确换成基点整数（规则 3：百分比用基点，不经过浮点数）：
 * 在字符串上取整数部分和前两位小数，第三位小数起按统一的四舍五入（远离零）进位，`1.005` → 101 基点。
 * 只认非负的普通十进制写法（不认正负号、指数、千分位）；不认时返回 null。
 */
export function percentToBasisPoints(text: string): number | null {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (match === null) return null;
  const whole = BigInt(match[1] as string);
  const fraction = (match[2] ?? "").padEnd(3, "0");
  let bp = whole * 100n + BigInt(fraction.slice(0, 2));
  if (Number(fraction[2]) >= 5) bp += 1n;
  return bp > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(bp);
}

/** 基点整数写成百分比文本（展示用）：150 → `1.5`，101 → `1.01`，200 → `2`。 */
export function basisPointsToPercentText(bp: number): string {
  const sign = bp < 0 ? "-" : "";
  const abs = Math.abs(bp);
  const rest = abs % 100;
  const fraction = String(rest).padStart(2, "0").replace(/0+$/, "");
  return `${sign}${(abs - rest) / 100}${fraction === "" ? "" : `.${fraction}`}`;
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

/** 和 @nozomi/domain 的 `LOGIN_MAX_ATTEMPTS_PER_IP` 相同（config 不依赖 domain；单元测试核对两边一致）。 */
export const DEFAULT_LOGIN_MAX_ATTEMPTS_PER_IP = 50;

const rawSchema = z.object({
  APP_ENV: z.enum(APP_ENVS).default("local"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:8080"),
  // 服务前面有几层自己的反向代理（Nginx / Caddy 等）。0 表示直接对外，不信任 X-Forwarded-For。
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  // 登录限速里「同一来源地址」这一层的上限（窗口 15 分钟内的失败次数，ADR 0008、0030）。默认 50，staging / production 不能调高；
  // 只给端到端测试用：全部用例都从 127.0.0.1 发起，几百个用例的失败尝试（错码、并行进程用掉的动态码）会把这一层顶满
  LOGIN_MAX_ATTEMPTS_PER_IP: z.preprocess((value) => (value === "" ? undefined : value), z.coerce.number().int().min(1).max(100_000).default(DEFAULT_LOGIN_MAX_ATTEMPTS_PER_IP)),

  DATABASE_URL: databaseUrlSchema("DATABASE_URL"),
  DATABASE_MIGRATION_URL: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    databaseUrlSchema("DATABASE_MIGRATION_URL").optional(),
  ),
  AUTH_JWT_SECRET: z.string().min(32, "AUTH_JWT_SECRET 至少 32 个字符"),
  // 数据加密密钥（ADR 0027、0030）：加密库里需要还原原文的密钥（供应商的 Webhook 签名密钥、平台员工的两步验证密钥）。服务器上由初始化 / 部署脚本自动生成；
  // 只有 production 必须配置，其他环境不配时供应商不能设置 Webhook、平台员工不能绑定、验证两步验证（接口 503，/health 和 config:check 显示「未配置」）
  DATA_ENCRYPTION_KEY: optionalString,

  STRIPE_SECRET_KEY: optionalString,
  STRIPE_PUBLISHABLE_KEY: optionalString,
  STRIPE_WEBHOOK_SECRET: optionalString,

  GOOGLE_MAPS_API_KEY: optionalString,
  // 路线预估每天（东京时间）最多调用谷歌 Routes API 几次（ADR 0042，费用控制；不是密钥）。默认 1000，0 = 不调用（里程 + 时长的商品暂时无法报价）
  GOOGLE_ROUTES_DAILY_LIMIT: z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), z.coerce.number().int().min(0).max(1_000_000).default(1_000)),
  // 官网的地址搜索和坐标反查每天（东京时间）最多调用谷歌几次（两者合计，ADR 0044，费用控制；不是密钥）。默认 500，0 = 不调用（官网只能从常用地点选、在地图上点选或手填）
  GOOGLE_PLACES_DAILY_LIMIT: z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), z.coerce.number().int().min(0).max(1_000_000).default(500)),
  // 「测试一下」、路线、地址搜索、反查和收款连到哪里（ADR 0041、0044）：只给本机和 CI 的测试用（指到本机的假服务器），staging / production 不能改
  GOOGLE_MAPS_ROUTES_URL: optionalString,
  GOOGLE_PLACES_SEARCH_URL: optionalString,
  GOOGLE_GEOCODE_URL: optionalString,
  STRIPE_API_URL: optionalString,

  // 地图底图（栅格瓦片）。不是密钥：这些值会经接口下发给浏览器。没配 = 这个环境没有底图。见 ADR 0015。
  MAP_TILE_URL_TEMPLATE: optionalString,
  MAP_TILE_DARK_URL_TEMPLATE: optionalString,
  MAP_TILE_ATTRIBUTION: optionalString,
  MAP_TILE_REFERRER_POLICY: z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), z.enum(MAP_TILE_REFERRER_POLICIES).default("strict-origin")),
  MAP_TILE_MIN_ZOOM: z.preprocess((value) => (value === "" ? undefined : value), z.coerce.number().int().min(0).max(22).default(3)),
  MAP_TILE_MAX_ZOOM: z.preprocess((value) => (value === "" ? undefined : value), z.coerce.number().int().min(1).max(22).default(19)),
  MAP_TILE_SIZE: z.preprocess((value) => (value === "" ? undefined : value), z.coerce.number().int().refine((size) => size === 256 || size === 512, "只能是 256 或 512").default(256)),

  FX_SOURCE_URL: z.string().url().default("https://open.er-api.com/v6/latest/USD"),
  // 跨币种的汇率缓冲，百分比（默认 1.5）。按十进制精确换成基点整数，不经过浮点数（ADR 0022「汇率缓冲」）
  FX_BUFFER_PERCENT: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z
      .string()
      .default("1.5")
      .transform((value, ctx) => {
        const bp = percentToBasisPoints(value);
        if (bp === null || bp > FX_BUFFER_MAX_BP) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "只能是 0 ~ 10 之间的十进制数（百分比，如 1.5）" });
          return z.NEVER;
        }
        return bp;
      }),
  ),
  // 服务进程里的汇率定时拉取（ADR 0022）。默认开；集成测试启动的服务进程关掉它（测试不访问外网）
  FX_AUTO_FETCH: z.preprocess((value) => (typeof value === "string" && value.trim() === "" ? undefined : value), z.enum(["true", "false"]).default("true")),

  // 报价：渠道和加价规则（M2-04）上线之前，试算用的默认加价比例，基点（1000 = 10%，也是需求里渠道加价的默认下限）。不是密钥
  QUOTE_DEFAULT_MARKUP_BP: z.preprocess((value) => (value === "" ? undefined : value), z.coerce.number().int().min(0).max(100_000).default(1_000)),

  // 官网用哪个渠道（ADR 0032）：运营后台给官网渠道发的那个 API 客户端的 client_id（nzc_ 开头，公开值，不是密钥）。
  // 不配 = 官网显示「暂未开放」
  SITE_CLIENT_ID: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : typeof value === "string" ? value.trim() : value),
    z.string().regex(/^nzc_[0-9a-f]{24}$/, "SITE_CLIENT_ID 应当是运营后台「API 客户端与密钥」里显示的 client_id（nzc_ 加 24 位十六进制）").optional(),
  ),
  // 官网订单页「需要帮助」里的客服电话（ADR 0032 待定事项 6；公开值，不是密钥）。不配 = 订单页不显示客服区块
  SITE_SUPPORT_PHONE: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : typeof value === "string" ? value.trim() : value),
    z
      .string()
      // 和客人手机号同口径（domain 的 isInternationalPhone，E.164）：+ 国家码不以 0 开头，共 8–15 位数字；写法上只允许空格和连字符分隔
      .refine((value) => /^\+[0-9][0-9 -]*[0-9]$/.test(value) && /^[1-9]\d{7,14}$/.test(value.replace(/[ -]/g, "").slice(1)), "SITE_SUPPORT_PHONE 应当是带国家码的电话号码：以 + 开头，国家码不以 0 开头，共 8–15 位数字，只用空格和连字符分隔，如 +81 3-1234-5678")
      .optional(),
  ),
});

export type RawEnv = z.input<typeof rawSchema>;

export interface StripeConfig {
  secretKey: string;
  publishableKey: string;
  webhookSecret: string;
  mode: "test" | "live";
}

export interface IntegrationEndpoints {
  /** 谷歌地图 Routes API 的 computeRoutes 地址 */
  googleMapsRoutesUrl: string;
  /** 谷歌 Places API (New) 的 Text Search 地址（官网地址搜索，ADR 0044） */
  googlePlacesSearchUrl: string;
  /** 谷歌 Geocoding API 反查的地址前缀（后面接 `/纬度,经度`，ADR 0044） */
  googleGeocodeUrl: string;
  /** Stripe 接口的主机；null = Stripe 官方地址 */
  stripeApi: { host: string; port: number; protocol: "http" | "https" } | null;
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
  /** 数据加密密钥（ADR 0027、0030）；没有配置时为 null：供应商不能设置 Webhook，平台员工不能绑定、验证两步验证 */
  dataEncryptionKey: string | null;
  stripe: StripeConfig | null;
  googleMapsApiKey: string | null;
  /** 路线预估（ADR 0042）：每天（东京时间）最多调用谷歌 Routes API 几次；0 = 不调用 */
  routes: { dailyLimit: number };
  /** 官网的地址搜索和反查（ADR 0044）：每天（东京时间）最多调用谷歌几次（两者合计）；0 = 不调用 */
  places: { dailyLimit: number };
  /** 地图底图；这个环境没有配置时为 null */
  mapTiles: MapTilesConfig | null;
  /** 汇率：数据源地址、跨币种缓冲（基点整数，150 = 1.5%）、服务进程是否定时拉取 */
  fx: { sourceUrl: string; bufferBp: number; autoFetch: boolean };
  /** 报价的默认参数（渠道和加价规则上线之前用） */
  quote: { defaultMarkupBp: number };
  /** 官网（ADR 0032）：以哪个 API 客户端的身份调用询价、下单；没有配置时为 null（官网暂未开放） */
  site: { clientId: string } | null;
  /** 登录限速（ADR 0008、0030）：同一来源地址 15 分钟内最多失败几次；默认 50，只有 local / ci 可以调高 */
  loginThrottle: { maxAttemptsPerIp: number };
  /** 第三方服务的地址（ADR 0041）：正式的地址是默认值，只有 local / ci 能指到本机的假服务器 */
  integrationEndpoints: IntegrationEndpoints;
  /** 官网订单页显示的客服电话（`+81 3-1234-5678` 这样的写法，原样显示）；没有登记时为 null，订单页不显示客服区块 */
  siteSupportPhone: string | null;
}

export class ConfigError extends Error {
  readonly issues: string[];
  constructor(issues: string[]) {
    super(`配置有误：\n- ${issues.join("\n- ")}`);
    this.name = "ConfigError";
    this.issues = issues;
  }
}

const STRIPE_ENV_NAMES: Readonly<Record<string, string>> = {
  [STRIPE_FIELDS.secretKey]: "STRIPE_SECRET_KEY",
  [STRIPE_FIELDS.publishableKey]: "STRIPE_PUBLISHABLE_KEY",
  [STRIPE_FIELDS.webhookSecret]: "STRIPE_WEBHOOK_SECRET",
};

/** 服务器配置文件里的 Stripe 三项：规则和后台填写共用 `stripeKeyIssues`（ADR 0041），这里把问题写成配置报错的说法。 */
function parseStripe(
  env: z.output<typeof rawSchema>,
  issues: string[],
): StripeConfig | null {
  const keys = { secretKey: env.STRIPE_SECRET_KEY ?? "", publishableKey: env.STRIPE_PUBLISHABLE_KEY ?? "", webhookSecret: env.STRIPE_WEBHOOK_SECRET ?? "" };
  if (keys.secretKey === "" && keys.publishableKey === "" && keys.webhookSecret === "") return null;
  const found = stripeKeyIssues(env.APP_ENV, keys);
  if (found.some((issue) => issue.reason === "REQUIRED")) {
    issues.push("Stripe 需要同时配置 STRIPE_SECRET_KEY、STRIPE_PUBLISHABLE_KEY、STRIPE_WEBHOOK_SECRET");
    return null;
  }
  for (const issue of found) {
    const name = STRIPE_ENV_NAMES[issue.field] ?? issue.field;
    if (issue.reason === "PREFIX") {
      issues.push(name === "STRIPE_WEBHOOK_SECRET" ? "STRIPE_WEBHOOK_SECRET 应以 whsec_ 开头" : name === "STRIPE_SECRET_KEY" ? "STRIPE_SECRET_KEY 应以 sk_test_ 或 sk_live_ 开头" : "STRIPE_PUBLISHABLE_KEY 应以 pk_test_ 或 pk_live_ 开头");
    } else if (issue.reason === "MODE_MISMATCH") {
      issues.push("Stripe 的 secret key 和 publishable key 必须同为测试或同为正式");
    } else if (issue.reason === "LIVE_KEY_NOT_ALLOWED") {
      issues.push(`${env.APP_ENV} 环境禁止使用 Stripe 正式（live）密钥，请改用 sk_test_ 测试密钥`);
    } else if (issue.reason === "TEST_KEY_NOT_ALLOWED") {
      issues.push("production 环境必须使用 Stripe 正式（live）密钥");
    }
  }
  const mode = stripeModeOf(keys.secretKey);
  return mode ? { ...keys, mode } : null;
}

const DEFAULT_GOOGLE_MAPS_ROUTES_URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
const DEFAULT_GOOGLE_PLACES_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const DEFAULT_GOOGLE_GEOCODE_URL = "https://geocode.googleapis.com/v4beta/geocode/location";

/**
 * 「测试一下」和收款连到哪里（ADR 0041）。正式的地址是默认值；只有 local / ci 可以改到本机的假服务器上（端到端测试用），
 * staging / production 改了就报错——否则改一行配置就能把密钥发到别处。
 */
function parseIntegrationEndpoints(env: z.output<typeof rawSchema>, issues: string[]): IntegrationEndpoints {
  const local = env.APP_ENV === "local" || env.APP_ENV === "ci";
  const routesUrl = env.GOOGLE_MAPS_ROUTES_URL ?? DEFAULT_GOOGLE_MAPS_ROUTES_URL;
  if (routesUrl !== DEFAULT_GOOGLE_MAPS_ROUTES_URL && !local) issues.push(`${env.APP_ENV} 环境不能修改 GOOGLE_MAPS_ROUTES_URL（只给本机和 CI 的测试用）`);
  if (!URL.canParse(routesUrl)) issues.push("GOOGLE_MAPS_ROUTES_URL 不是合法的网址");
  const fixed = (name: "GOOGLE_PLACES_SEARCH_URL" | "GOOGLE_GEOCODE_URL", fallback: string): string => {
    const value = env[name] ?? fallback;
    if (value !== fallback && !local) issues.push(`${env.APP_ENV} 环境不能修改 ${name}（只给本机和 CI 的测试用）`);
    if (!URL.canParse(value)) issues.push(`${name} 不是合法的网址`);
    return value;
  };
  const placesSearchUrl = fixed("GOOGLE_PLACES_SEARCH_URL", DEFAULT_GOOGLE_PLACES_SEARCH_URL);
  const geocodeUrl = fixed("GOOGLE_GEOCODE_URL", DEFAULT_GOOGLE_GEOCODE_URL);
  let stripeApi: IntegrationEndpoints["stripeApi"] = null;
  if (env.STRIPE_API_URL !== undefined) {
    if (!local) issues.push(`${env.APP_ENV} 环境不能配置 STRIPE_API_URL（只给本机和 CI 的测试用）`);
    if (!URL.canParse(env.STRIPE_API_URL)) issues.push("STRIPE_API_URL 不是合法的网址");
    else {
      const url = new URL(env.STRIPE_API_URL);
      const protocol = url.protocol === "https:" ? "https" : "http";
      stripeApi = { host: url.hostname, port: url.port === "" ? (protocol === "https" ? 443 : 80) : Number(url.port), protocol };
    }
  }
  return { googleMapsRoutesUrl: routesUrl, googlePlacesSearchUrl: placesSearchUrl, googleGeocodeUrl: geocodeUrl, stripeApi };
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
  // 正式环境不再要求配置文件里有谷歌地图和 Stripe（ADR 0041）：可以在运营后台填写，两处都没有时 /health 显示「未配置」
  const googleMapsApiKey = env.GOOGLE_MAPS_API_KEY ?? null;
  const integrationEndpoints = parseIntegrationEndpoints(env, issues);
  const dataEncryptionKey = env.DATA_ENCRYPTION_KEY ?? null;
  if (dataEncryptionKey === null && env.APP_ENV === "production") {
    issues.push("production 环境必须配置 DATA_ENCRYPTION_KEY（服务器初始化 / 部署脚本会自动生成）");
  }
  if (dataEncryptionKey !== null && dataEncryptionKey.length < 32) issues.push("DATA_ENCRYPTION_KEY 至少 32 个字符");
  if (dataEncryptionKey !== null && dataEncryptionKey === env.AUTH_JWT_SECRET) issues.push("DATA_ENCRYPTION_KEY 不能和 AUTH_JWT_SECRET 相同：两把密钥各管一件事，一把泄露不连累另一把");
  if (env.APP_ENV === "production" && env.AUTH_JWT_SECRET.length < 64) {
    issues.push("production 环境的 AUTH_JWT_SECRET 至少 64 个字符");
  }
  if ((env.APP_ENV === "staging" || env.APP_ENV === "production") && env.LOGIN_MAX_ATTEMPTS_PER_IP > DEFAULT_LOGIN_MAX_ATTEMPTS_PER_IP) {
    issues.push(`${env.APP_ENV} 环境的 LOGIN_MAX_ATTEMPTS_PER_IP 不能超过 ${DEFAULT_LOGIN_MAX_ATTEMPTS_PER_IP}（调高只给本机和 CI 的端到端测试用）`);
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
    dataEncryptionKey,
    stripe,
    googleMapsApiKey,
    routes: { dailyLimit: env.GOOGLE_ROUTES_DAILY_LIMIT },
    places: { dailyLimit: env.GOOGLE_PLACES_DAILY_LIMIT },
    mapTiles,
    fx: { sourceUrl: env.FX_SOURCE_URL, bufferBp: env.FX_BUFFER_PERCENT, autoFetch: env.FX_AUTO_FETCH === "true" },
    quote: { defaultMarkupBp: env.QUOTE_DEFAULT_MARKUP_BP },
    site: env.SITE_CLIENT_ID === undefined ? null : { clientId: env.SITE_CLIENT_ID },
    loginThrottle: { maxAttemptsPerIp: env.LOGIN_MAX_ATTEMPTS_PER_IP },
    siteSupportPhone: env.SITE_SUPPORT_PHONE ?? null,
    integrationEndpoints,
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
  key: "database" | "auth" | "dataEncryption" | "stripe" | "googleMaps" | "fx";
  label: string;
  state: IntegrationState;
  detail: string;
}

export interface IntegrationStatusOptions {
  /** 生效的 Stripe、谷歌地图（ADR 0041）；不给时只看服务器配置文件 */
  effective?: EffectiveIntegrations;
  /** 说明里带不带打码后的末 4 位：只有能管理密钥的人（超级管理员）和服务器上的 `pnpm config:check` 带 */
  hints?: boolean;
}

/** 只给出「是否已配置」和脱敏信息，永远不返回密钥原文。可用于健康检查和后台的集成状态页。 */
export function integrationStatus(config: AppConfig, options: IntegrationStatusOptions = {}): IntegrationStatus[] {
  const effective = options.effective ?? envIntegrations(config);
  const hints = options.hints ?? true;
  const stripe = effective.stripe.config;
  const mapsKey = effective.googleMaps.apiKey;
  const origin = (source: EffectiveIntegrations["stripe"]["source"], secret: string): string => `${SECRET_SOURCE_LABELS[source]}${hints ? `（${maskLast4(secret)}）` : ""}`;
  return [
    { key: "database", label: "数据库", state: "configured", detail: maskUrl(config.databaseUrl) },
    { key: "auth", label: "登录签名密钥", state: "configured", detail: `${config.authJwtSecret.length} 个字符` },
    config.dataEncryptionKey
      ? { key: "dataEncryption", label: "数据加密密钥", state: "configured", detail: `${config.dataEncryptionKey.length} 个字符` }
      : { key: "dataEncryption", label: "数据加密密钥", state: "missing", detail: "未配置，供应商不能设置 Webhook，平台员工不能绑定两步验证（登录不了运营后台），运营后台不能填写第三方密钥" },
    stripe
      ? { key: "stripe", label: "Stripe 支付", state: "configured", detail: `${stripe.mode === "live" ? "正式" : "测试"}模式 · ${origin(effective.stripe.source, stripe.secretKey)}` }
      : { key: "stripe", label: "Stripe 支付", state: "missing", detail: "未配置，无法收款" },
    mapsKey
      ? { key: "googleMaps", label: "谷歌地图", state: "configured", detail: origin(effective.googleMaps.source, mapsKey) }
      : { key: "googleMaps", label: "谷歌地图", state: "missing", detail: "未配置，里程 + 时长报价不可用" },
    { key: "fx", label: "汇率数据源", state: "configured", detail: `${new URL(config.fx.sourceUrl).host} · 缓冲 ${basisPointsToPercentText(config.fx.bufferBp)}%` },
  ];
}

/** 连接串脱敏：只留协议、用户名、主机、库名；密码和查询参数一律不输出。解析不了时不输出任何原文。 */
function maskUrl(url: string): string {
  if (!URL.canParse(url)) return "连接串无法解析";
  const u = new URL(url);
  return `${u.protocol}//${u.username ? u.username + ":•••@" : ""}${u.host}${u.pathname}`;
}
