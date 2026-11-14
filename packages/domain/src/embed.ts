/**
 * 嵌入组件的嵌入码与域名白名单（M9E-02，ADR 0090 第三、五节）。
 *
 * - origin 规范化：WHATWG URL 解析，只收 `https:`（测试类环境另收 `http://localhost:<端口>`、`http://127.0.0.1:<端口>`），
 *   主机名小写、punycode、去默认端口；不能有路径（`/` 除外）、查询、片段、用户名密码；不支持通配符。比较一律**完全相等**。
 * - 请求的 `Origin`：缺失、`null`、写法不对、不在白名单都不放行。
 * - `return_url`：≤ 2,000 字符，协议规则同上，不带用户名密码；它的 origin 必须完全等于白名单某项，并且等于建草稿请求的 `Origin`。
 */

export const EMBED_RULES = {
  maxNameLength: 60,
  minOrigins: 1,
  maxOrigins: 20,
  maxNoteLength: 500,
  maxReturnUrlLength: 2_000,
  /** 每个嵌入码同时有效（没过期）的草稿最多几个：防止有人伪造 Origin 用一个嵌入码把表刷大 */
  activeDraftsPerKey: 5_000,
  /** 到这个数写告警日志（上限的 80%） */
  activeDraftsWarnAt: 4_000,
  /** 配置应答的浏览器缓存（秒）：改白名单、停用后 60 秒内在浏览器侧生效 */
  configMaxAgeSeconds: 60,
} as const;

/** 公开嵌入码：`nze_` + 24 字节随机数的 base64url（32 字符）。不是密钥 */
export const EMBED_KEY_FORMAT = /^nze_[A-Za-z0-9_-]{32}$/;

export const EMBED_SERVICES = ["transfer", "charter"] as const;
export type EmbedService = (typeof EMBED_SERVICES)[number];
export const EMBED_LANGS = ["zh", "ja", "en"] as const;
export type EmbedLang = (typeof EMBED_LANGS)[number];
/** 组件的外观（M9E-10）：card 卡片（默认）、bar 横条 */
export const EMBED_LAYOUTS = ["card", "bar"] as const;
export type EmbedLayout = (typeof EMBED_LAYOUTS)[number];
export const EMBED_KEY_STATUSES = ["active", "disabled"] as const;
export type EmbedKeyStatus = (typeof EMBED_KEY_STATUSES)[number];

export interface EmbedOriginOptions {
  /** 测试类环境（local / ci / staging）另收本机的 http 地址 */
  allowLocalHttp: boolean;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

function parseHttpUrl(value: string, options: EmbedOriginOptions): URL | null {
  if (value.includes("*") || /\s/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.username !== "" || url.password !== "") return null;
  if (url.protocol === "https:") return url;
  if (url.protocol === "http:" && options.allowLocalHttp && LOCAL_HOSTS.has(url.hostname)) return url;
  return null;
}

/** 白名单的一项：规范化成 origin（`https://example.com`、`https://example.com:8443`）；写法不对为 null */
export function normalizeEmbedOrigin(value: string, options: EmbedOriginOptions): string | null {
  const url = parseHttpUrl(value.trim(), options);
  if (url === null) return null;
  if (url.pathname !== "/" || url.search !== "" || url.hash !== "" || value.trim().endsWith("?") || value.trim().endsWith("#")) return null;
  return url.origin;
}

/** 请求带来的 `Origin` 头在不在白名单（白名单里存的是规范化后的 origin）：缺失、`null`、写法不对都不放行 */
export function embedOriginAllowed(header: string | null | undefined, allowed: readonly string[], options: EmbedOriginOptions): string | null {
  if (header === null || header === undefined || header === "" || header === "null") return null;
  const origin = normalizeEmbedOrigin(header, options);
  return origin !== null && allowed.includes(origin) ? origin : null;
}

/**
 * 校验付款后「返回原网站」的地址：通过返回规范化后的完整地址，否则 null（调用方忽略它，不报错）。
 * `requestOrigin` 是建草稿那次请求的 `Origin`（已经核对过在白名单里）；下单时再对当前白名单核一次。
 */
export function embedReturnUrl(value: unknown, requestOrigin: string, allowed: readonly string[], options: EmbedOriginOptions): string | null {
  if (typeof value !== "string" || value === "" || value.length > EMBED_RULES.maxReturnUrlLength) return null;
  const url = parseHttpUrl(value, options);
  if (url === null) return null;
  if (url.origin !== requestOrigin || !allowed.includes(url.origin)) return null;
  return url.href.length > EMBED_RULES.maxReturnUrlLength ? null : url.href;
}

export interface EmbedKeyInput {
  name: string;
  allowed_origins: readonly string[];
  default_lang: string;
  default_services: readonly string[];
  /** 不填时不校验（新建按卡片、修改保持原值，由调用方处理） */
  layout?: string | undefined;
  note: string | null;
}

export type EmbedKeyIssueReason = "REQUIRED" | "OUT_OF_RANGE" | "INVALID" | "DUPLICATE";
export interface EmbedKeyIssue {
  path: string;
  reason: EmbedKeyIssueReason;
}

/** 新建、修改嵌入码时的校验；通过时 `origins` 是规范化、去掉首尾空格后的白名单 */
export function embedKeyIssues(input: EmbedKeyInput, options: EmbedOriginOptions): { issues: EmbedKeyIssue[]; origins: string[] } {
  const issues: EmbedKeyIssue[] = [];
  const name = input.name.trim();
  if (name === "") issues.push({ path: "/name", reason: "REQUIRED" });
  else if ([...name].length > EMBED_RULES.maxNameLength) issues.push({ path: "/name", reason: "OUT_OF_RANGE" });
  const origins: string[] = [];
  if (input.allowed_origins.length < EMBED_RULES.minOrigins) issues.push({ path: "/allowed_origins", reason: "REQUIRED" });
  else if (input.allowed_origins.length > EMBED_RULES.maxOrigins) issues.push({ path: "/allowed_origins", reason: "OUT_OF_RANGE" });
  else
    for (const [index, raw] of input.allowed_origins.entries()) {
      const origin = normalizeEmbedOrigin(raw, options);
      if (origin === null) issues.push({ path: `/allowed_origins/${index}`, reason: "INVALID" });
      else if (origins.includes(origin)) issues.push({ path: `/allowed_origins/${index}`, reason: "DUPLICATE" });
      else origins.push(origin);
    }
  if (!EMBED_LANGS.includes(input.default_lang as EmbedLang)) issues.push({ path: "/default_lang", reason: "INVALID" });
  const services = input.default_services;
  if (services.length === 0) issues.push({ path: "/default_services", reason: "REQUIRED" });
  else if (services.some((service) => !EMBED_SERVICES.includes(service as EmbedService))) issues.push({ path: "/default_services", reason: "INVALID" });
  else if (new Set(services).size !== services.length) issues.push({ path: "/default_services", reason: "DUPLICATE" });
  if (input.layout !== undefined && !EMBED_LAYOUTS.includes(input.layout as EmbedLayout)) issues.push({ path: "/layout", reason: "INVALID" });
  if (input.note !== null && [...input.note].length > EMBED_RULES.maxNoteLength) issues.push({ path: "/note", reason: "OUT_OF_RANGE" });
  return { issues, origins };
}

/** 合作网站要放的代码（ADR 0090 第六节）。`siteOrigin` 是主站的 origin */
export function embedSnippet(siteOrigin: string, key: string, lang: EmbedLang, services: readonly EmbedService[], layout: EmbedLayout): string {
  return [
    '<div id="nozomi-booking"></div>',
    `<script src="${siteOrigin}/embed/widget-v1.js" defer></script>`,
    "<script>",
    '  window.addEventListener("DOMContentLoaded", function () {',
    `    NozomiBooking.init({ key: "${key}", root: "#nozomi-booking", lang: "${lang}", services: ${JSON.stringify(services)}, layout: "${layout}" });`,
    "  });",
    "</script>",
  ].join("\n");
}
