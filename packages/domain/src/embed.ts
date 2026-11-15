/**
 * 嵌入组件的嵌入码与域名白名单（M9E-02，ADR 0090 第三、五节）。
 *
 * - origin 规范化：WHATWG URL 解析，只收 `https:`（测试类环境另收 `http://localhost:<端口>`、`http://127.0.0.1:<端口>`），
 *   主机名小写、punycode、去默认端口；不能有路径（`/` 除外）、查询、片段、用户名密码；不支持通配符。比较一律**完全相等**。
 * - 请求的 `Origin`：缺失、`null`、写法不对、不在白名单都不放行。
 * - `return_url`：≤ 2,000 字符，协议规则同上，不带用户名密码；它的 origin 必须完全等于白名单某项，并且等于建草稿请求的 `Origin`。
 * - 预订页地址 `booking_url`（M9E-26，ADR 0095 附录 A）：嵌入码上选填的合作网站预订页，≤ 2,000 字符，协议规则同上，不带用户名密码；
 *   origin 必须完全等于这个嵌入码白名单的某一项（同源、带路径）。后台据此生成两段代码：①入口小程序（init 带 bookingUrl）、②预订程序（mountBooking）。
 */

export const EMBED_RULES = {
  maxNameLength: 60,
  minOrigins: 1,
  maxOrigins: 20,
  maxNoteLength: 500,
  maxReturnUrlLength: 2_000,
  /** 预订页地址（M9E-26）最长几个字符：和组件里 bookingUrl 的上限（booking-protocol.ts）一样 */
  maxBookingUrlLength: 2_000,
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
/** 组件的外观（M9E-10、M9E-14）：auto 按组件容器宽度自动选（默认，≥ 900 px 横条、窄了卡片）、card 卡片、bar 横条 */
export const EMBED_LAYOUTS = ["auto", "card", "bar"] as const;
export type EmbedLayout = (typeof EMBED_LAYOUTS)[number];
/**
 * 草稿交给谁接着走（M9E-16，ADR 0095 第三节第 1 小节、第九节第 1 小节）：redirect 整页跳主站 /book/new（旧行为，库里为空也按它算）、
 * host_page 跳合作网站自己的预订页、在那里嵌入预订流程（组件传了 bookingUrl）。只做统计
 */
export const EMBED_DELIVERIES = ["redirect", "host_page"] as const;
export type EmbedDelivery = (typeof EMBED_DELIVERIES)[number];
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
  /** 预订页地址（M9E-26）：null 或不填 = 没有；修改时「保持原值」由调用方先把原值填进来，照样按这次的白名单核对 */
  booking_url?: string | null | undefined;
  note: string | null;
}

/** NOT_ALLOWED_ORIGIN（M9E-26）：预订页地址的网站不在这个嵌入码的白名单里 */
export type EmbedKeyIssueReason = "REQUIRED" | "OUT_OF_RANGE" | "INVALID" | "DUPLICATE" | "NOT_ALLOWED_ORIGIN";
export interface EmbedKeyIssue {
  path: string;
  reason: EmbedKeyIssueReason;
}

/**
 * 预订页地址（M9E-26）的写法：WHATWG URL 能解析，https（测试类环境另收本机 http，同白名单），不带用户名密码，≤ 2,000 字符。
 * 合格返回规范化后的完整地址（主机名小写、去默认端口，保留路径、查询、#），否则 null。不核对白名单，见 embedBookingUrlCheck
 */
export function normalizeEmbedBookingUrl(value: string, options: EmbedOriginOptions): string | null {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > EMBED_RULES.maxBookingUrlLength) return null;
  const url = parseHttpUrl(trimmed, options);
  if (url === null || url.href.length > EMBED_RULES.maxBookingUrlLength) return null;
  return url.href;
}

/**
 * 预订页地址核对白名单（M9E-26）：`allowed` 是规范化后的白名单。太长 OUT_OF_RANGE、写法不对 INVALID、
 * 网站（origin）不完全等于白名单某一项 NOT_ALLOWED_ORIGIN；合格返回规范化后的地址
 */
export function embedBookingUrlCheck(value: string, allowed: readonly string[], options: EmbedOriginOptions): { reason: EmbedKeyIssueReason } | { url: string } {
  if (value.trim().length > EMBED_RULES.maxBookingUrlLength) return { reason: "OUT_OF_RANGE" };
  const url = normalizeEmbedBookingUrl(value, options);
  if (url === null) return { reason: "INVALID" };
  return allowed.includes(new URL(url).origin) ? { url } : { reason: "NOT_ALLOWED_ORIGIN" };
}

/**
 * 新建、修改嵌入码时的校验；通过时 `origins` 是规范化、去掉首尾空格后的白名单，`bookingUrl` 是规范化后的预订页地址（没填为 null）。
 * 预订页地址按**这次提交的**白名单核对：改白名单拿掉了预订页所在的网站，又没同时改、清空预订页地址，就不让保存（M9E-26）
 */
export function embedKeyIssues(input: EmbedKeyInput, options: EmbedOriginOptions): { issues: EmbedKeyIssue[]; origins: string[]; bookingUrl: string | null } {
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
  let bookingUrl: string | null = null;
  const rawBookingUrl = input.booking_url ?? null;
  // 白名单本身有问题时不核对预订页地址（不知道该对哪一份），只报白名单
  if (rawBookingUrl !== null && rawBookingUrl.trim() !== "" && !issues.some((issue) => issue.path.startsWith("/allowed_origins"))) {
    const checked = embedBookingUrlCheck(rawBookingUrl, origins, options);
    if ("url" in checked) bookingUrl = checked.url;
    else issues.push({ path: "/booking_url", reason: checked.reason });
  }
  return { issues, origins, bookingUrl };
}

/** 写进 <script> 里的字符串：JSON 转义，另把 `<` 写成 <，地址里怎么写都不会提前结束 <script> */
const scriptString = (value: string): string => JSON.stringify(value).replace(/</g, "\\u003c");

/**
 * 合作网站要放的代码（ADR 0090 第六节）= M9E-26 的①入口小程序。`siteOrigin` 是主站的 origin。
 * 不写 layout（M9E-14）：组件从 `/embed/v1/config` 取嵌入码的外观，运营在后台改了不用合作网站改代码。
 * `bookingUrl`（M9E-26，ADR 0095 第三节第 1 小节）：给了就在 init 里带上，客人填好行程后跳到合作网站自己的预订页；不给时和以前逐字一样
 */
export function embedSnippet(siteOrigin: string, key: string, lang: EmbedLang, services: readonly EmbedService[], bookingUrl: string | null = null): string {
  const booking = bookingUrl === null ? "" : `, bookingUrl: ${scriptString(bookingUrl)}`;
  return [
    '<div id="nozomi-booking"></div>',
    `<script src="${siteOrigin}/embed/widget-v1.js" defer></script>`,
    "<script>",
    '  window.addEventListener("DOMContentLoaded", function () {',
    `    NozomiBooking.init({ key: "${key}", root: "#nozomi-booking", lang: "${lang}", services: ${JSON.stringify(services)}${booking} });`,
    "  });",
    "</script>",
  ].join("\n");
}

/**
 * ②预订程序（M9E-26，ADR 0095 第三节第 2 小节、附录 A）：只放在合作网站的预订页，`NozomiBooking.mountBooking` 接收入口传来的行程（`?nzdraft=`），
 * 显示报价和下单流程。容器 id 和①不同（`nozomi-booking-flow`），两段放在同一页也不冲突。`redirectUrl`（付款后「返回原网站」）选填，不写进代码
 */
export function embedBookingSnippet(siteOrigin: string, key: string, lang: EmbedLang): string {
  return [
    '<div id="nozomi-booking-flow"></div>',
    `<script src="${siteOrigin}/embed/widget-v1.js" defer></script>`,
    "<script>",
    '  window.addEventListener("DOMContentLoaded", function () {',
    `    NozomiBooking.mountBooking({ key: "${key}", root: "#nozomi-booking-flow", lang: "${lang}" });`,
    "  });",
    "</script>",
  ].join("\n");
}

/** 为什么只有①（M9E-26）：没填预订页地址、没开「允许整页嵌入」、预订页地址的网站不在白名单（正常保存不会出现，读的时候再兜一次） */
export const EMBED_SNIPPET_FALLBACKS = ["no_booking_url", "host_page_off", "booking_url_not_allowed"] as const;
export type EmbedSnippetFallback = (typeof EMBED_SNIPPET_FALLBACKS)[number];

export interface EmbedSnippets {
  /** ①入口小程序：可以放在任何页面；能交付②时 init 带 bookingUrl */
  entry: string;
  /** ②预订程序：只放在预订页；只有①时为 null */
  booking: string | null;
  /** 只有①的原因；两段都有时为 null */
  fallback: EmbedSnippetFallback | null;
}

export interface EmbedSnippetKey {
  key: string;
  lang: EmbedLang;
  services: readonly EmbedService[];
  allowedOrigins: readonly string[];
  allowHostPage: boolean;
  bookingUrl: string | null;
}

/**
 * 合作网站要放的两段代码（M9E-26）：填了预订页地址、开了「允许整页嵌入」、预订页地址的网站在白名单里，才给②并在①里带 bookingUrl；
 * 否则只给①、①不带 bookingUrl（和以前逐字一样，客人照旧跳主站）
 */
export function embedSnippets(siteOrigin: string, key: EmbedSnippetKey): EmbedSnippets {
  const entryOnly = (fallback: EmbedSnippetFallback): EmbedSnippets => ({ entry: embedSnippet(siteOrigin, key.key, key.lang, key.services), booking: null, fallback });
  if (key.bookingUrl === null) return entryOnly("no_booking_url");
  if (!key.allowHostPage) return entryOnly("host_page_off");
  let origin: string;
  try {
    origin = new URL(key.bookingUrl).origin;
  } catch {
    return entryOnly("booking_url_not_allowed");
  }
  if (!key.allowedOrigins.includes(origin)) return entryOnly("booking_url_not_allowed");
  return { entry: embedSnippet(siteOrigin, key.key, key.lang, key.services, key.bookingUrl), booking: embedBookingSnippet(siteOrigin, key.key, key.lang), fallback: null };
}
