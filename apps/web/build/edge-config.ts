/**
 * 反向代理（Caddy）里随前端一起变的两样配置，在构建前端镜像时由这里生成（ADR 0007「前端接入部署」）：
 *
 * 1. 归 API 的路径前缀——和开发 / 端到端测试的 Vite 代理用的是同一张表（`src/lib/api-prefixes.ts`），
 *    所以「哪些路径转给 API、其余归前端」在开发、测试、正式环境里不会各说各话；
 * 2. 内容安全策略（CSP）——`index.html` 里设置主题的那段内联脚本用哈希放行。哈希从构建产物里现算，
 *    不手抄：改了那段脚本、或构建工具改了它的输出，策略自动跟着变。
 *    唯一按环境变的部分是地图底图的图片来源（ADR 0015）：同一份镜像要部署到底图不同的环境，所以片段里留一个
 *    Caddy 的环境变量占位，由部署时的 `MAP_TILE_CSP_SOURCES` 填入；没配就是只认同源。
 *    策略分两条（ADR 0046）：官网页面（`/book` 和它下面）多放行 Stripe.js 必需的几个来源（付款），其余页面（两个后台、登录等）不放行。
 * 3. 嵌入预订页 `/embed/book`（M9E-16，ADR 0095 第五节第 1 小节）：第三条策略，同官网页面放行 Stripe，但 `frame-ancestors` 不是 `'none'`，
 *    而是 Caddy 先用 `forward_auth` 问 API 的 `/embed/v1/frame-check`（只转 `key`、`host`）、API 回的那一个宿主 origin。
 *
 * 纯函数，不读写文件；命令行入口在同目录的 edge-config-cli.ts。
 */
import { createHash } from "node:crypto";
import { API_PATH_PREFIXES } from "../src/lib/api-prefixes.ts";

/** 生成的 Caddy 片段在前端镜像里的位置；deploy/Caddyfile 按这个路径 import。 */
export const EDGE_CONFIG_PATH = "/etc/nozomi/web.caddy";
/** 前端静态文件在前端镜像里的位置；deploy/Caddyfile 的 root 指向这里。 */
export const WEB_ROOT_PATH = "/srv/web";

const SCRIPT_ELEMENT = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;

/**
 * 页面里每段内联脚本的 CSP 哈希（`sha256-…`），按出现顺序。带 `src` 的外部脚本不算。
 * 页面里有内联样式或内联事件处理时直接报错：策略不放行它们，与其上线后被浏览器悄悄拦掉，不如构建时就失败。
 */
export function inlineScriptHashes(html: string): string[] {
  if (html.includes("\r")) throw new Error("index.html 里有回车符：浏览器按换行符归一后的内容算哈希，结果会对不上");
  if (/<style\b/i.test(html)) throw new Error("index.html 里有内联 <style>：内容安全策略不放行内联样式，请改成外部样式文件");
  if (/<[^>]+\s(on[a-z]+|style)\s*=/i.test(html)) throw new Error("index.html 里有内联事件处理或 style 属性：内容安全策略不放行它们");
  const hashes: string[] = [];
  for (const match of html.matchAll(SCRIPT_ELEMENT)) {
    const attributes = match[1] ?? "";
    const content = match[2] ?? "";
    if (/\bsrc\s*=/i.test(attributes)) {
      if (content.trim() !== "") throw new Error("index.html 里有既带 src 又有内容的 <script>");
      continue;
    }
    hashes.push(`sha256-${createHash("sha256").update(content, "utf8").digest("base64")}`);
  }
  return hashes;
}

/** 部署时由反向代理填入「地图底图的图片来源」的环境变量名；值由 deploy/bin/compose.sh 从底图地址算出。 */
export const MAP_TILE_CSP_SOURCES_ENV = "MAP_TILE_CSP_SOURCES";
/** Caddy 配置里的环境变量占位：启动时被替换成变量的值，没设置时替换成空。 */
const MAP_TILE_CSP_PLACEHOLDER = `{$${MAP_TILE_CSP_SOURCES_ENV}}`;

/** 能放进 `img-src` 的图片来源：协议 + 主机名（+ 端口），不带路径、通配符、引号。本机地址给端到端测试的假瓦片服务用。 */
const IMAGE_SOURCE = /^(https:\/\/[A-Za-z0-9.-]+|http:\/\/(127\.0\.0\.1|localhost))(:[0-9]{1,5})?$/;

/** 官网页面的路径前缀（前端路由 `SITE_HOME_PATH`，src/lib/site-display.ts；site-csp.test.ts 核对两边一致）。 */
export const SITE_PAGE_PREFIX = "/book";

/**
 * 哪些请求地址算官网页面（只有它们的策略放行 Stripe，ADR 0046）。对着**没解码的原始地址**比，只认字面上就是官网三个页面的
 * （`/book`、`/book/checkout`、`/book/order`、M8-03 起的新预订页 `/book/new`，可带结尾斜杠和查询串；新预订页下单后在同一个文档里进订单页付款，也要放行 Stripe）：
 * - Caddy 的 `path` 匹配器会先解码、规整，`/platform/..%2Fbook` 会被它当成 `/book`，而浏览器和前端路由看到的是后台地址；
 * - `/book/别的` 前端路由对不上官网，落到供应商后台的页面，同样不能放行。
 * 不分大小写：前端路由不分大小写，`/Book/order` 渲染的就是订单页。没有反斜杠和花括号：要原样放进 Caddy 的 CEL 表达式。
 */
export const SITE_PAGE_URI_PATTERN = `^${SITE_PAGE_PREFIX}(/(order/?|checkout/?|new/?)?)?([?#].*)?$`;

/** `url`：请求行里的原始地址（路径 + 查询串）。和 Caddy 片段里的 `@site_pages` 同一个正则。 */
export function isSitePagePath(url: string): boolean {
  return new RegExp(SITE_PAGE_URI_PATTERN, "i").test(url);
}

/** 嵌入预订页的路径前缀（M9E-16，ADR 0095 第四节第 2 小节）；不在 API 前缀 `/embed/v1` 下，也不是组件脚本 `/embed/widget-v1.js`。 */
export const EMBED_BOOK_PREFIX = "/embed/book";

/**
 * 哪些请求地址算嵌入预订页（只有它们能被嵌入，ADR 0095 第五节第 1 小节）：字面上就是 `/embed/book`、`/embed/book/order`（可带结尾斜杠和查询串），
 * 同 `SITE_PAGE_URI_PATTERN` 对着没解码的原始地址比、不分大小写。`/embed/booking`、`/embed/book/别的`、`/embed/book%2F..` 不算：落到 `'none'` 那一条，嵌不进去。
 */
export const EMBED_BOOK_URI_PATTERN = `^${EMBED_BOOK_PREFIX}(/order)?/?([?#].*)?$`;

/** `url`：请求行里的原始地址（路径 + 查询串）。和 Caddy 片段里的 `@embed_book_pages` 同一个正则。 */
export function isEmbedBookPagePath(url: string): boolean {
  return new RegExp(EMBED_BOOK_URI_PATTERN, "i").test(url);
}

/** API 在 Caddy 网络里的地址（deploy/Caddyfile 的 `proxy_api` 用的是同一个，deploy-web.test.ts 核对）。 */
export const API_UPSTREAM = "api:8080";
/** 嵌入页能不能被嵌入，问 API 的这个接口（ADR 0095 第五节第 1 小节） */
export const FRAME_CHECK_PATH = "/embed/v1/frame-check";
/** API 放行时把宿主 origin 放在这个应答头里；Caddy 复制到请求上再拼进 frame-ancestors。客户端自己带的同名头先删掉（防伪造） */
export const FRAME_ANCESTOR_HEADER = "X-Nozomi-Frame-Ancestor";
/** Caddy 里取「API 回的宿主 origin」的占位 */
const FRAME_ANCESTOR_PLACEHOLDER = `{http.request.header.${FRAME_ANCESTOR_HEADER}}`;
/** frame-ancestors 里能放的宿主：协议 + 主机名（+ 端口），API 只回规范化后的 origin；本机 http 给端到端测试用 */
const ANCESTOR_SOURCE = /^(https:\/\/[A-Za-z0-9.-]+|http:\/\/(127\.0\.0\.1|localhost))(:[0-9]{1,5})?$/;

/** 宿主 origin 能不能原样写进 frame-ancestors（vite preview 插件对 API 的应答再核一次） */
export function isFrameAncestorSource(value: string): boolean {
  return ANCESTOR_SOURCE.test(value);
}

/**
 * Stripe.js（付款表单、3D 验证）必需的来源，按 Stripe 官方文档「Content Security Policy」的清单取最小集（ADR 0046）：
 * - script-src：Stripe.js 本身（js.stripe.com，及它按版本拆出去的 *.js.stripe.com）；
 * - frame-src：付款表单的 iframe（js.stripe.com、*.js.stripe.com）、3D 验证的 iframe（hooks.stripe.com）；
 * - connect-src：Stripe.js 调 Stripe 的接口（api.stripe.com）。
 * 不放 Stripe 文档里给地址自动补全用的 maps.googleapis.com（本站不用 Stripe 的地址表单）；不放 img-src（Stripe 的图片都在它自己的 iframe 里）。
 */
export const STRIPE_CSP_SOURCES = {
  script: ["https://js.stripe.com", "https://*.js.stripe.com"],
  frame: ["https://js.stripe.com", "https://*.js.stripe.com", "https://hooks.stripe.com"],
  connect: ["https://api.stripe.com"],
} as const;

/**
 * 内容安全策略。前端不加载任何站外的脚本、样式、字体，不用内联样式（ADR 0011），所以除了按哈希放行的内联脚本，一律只认同源。
 * 例外两个：地图底图的瓦片图片（ADR 0015）——`imageSources` 里的来源加进 `img-src`；
 * 官网页面的付款（ADR 0046）——`payments` 为真时按 `STRIPE_CSP_SOURCES` 加进 script-src、connect-src，另加一条 frame-src。
 * `frame-ancestors 'none'` 与 X-Frame-Options: DENY 同义，两个都留：老浏览器只认后者。
 * 嵌入预订页（M9E-16）用 `frameAncestor` 换掉 `'none'`：一个宿主 origin，或 Caddy 里 API 回的那个值的占位。
 */
export function contentSecurityPolicy(scriptHashes: readonly string[], imageSources: readonly string[] = [], options: { payments?: boolean; frameAncestor?: string } = {}): string {
  for (const hash of scriptHashes) {
    if (!/^sha256-[A-Za-z0-9+/]{43}=$/.test(hash)) throw new Error(`不是合法的 sha256 哈希：${hash}`);
  }
  for (const source of imageSources) {
    if (source !== MAP_TILE_CSP_PLACEHOLDER && !IMAGE_SOURCE.test(source)) throw new Error(`不能放进 img-src 的图片来源：${source}`);
  }
  const ancestor = options.frameAncestor;
  if (ancestor !== undefined && ancestor !== FRAME_ANCESTOR_PLACEHOLDER && !ANCESTOR_SOURCE.test(ancestor)) throw new Error(`不能放进 frame-ancestors 的来源：${ancestor}`);
  const payments = options.payments === true;
  const scriptSources = ["'self'", ...scriptHashes.map((hash) => `'${hash}'`), ...(payments ? STRIPE_CSP_SOURCES.script : [])];
  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self'",
    ["img-src 'self'", ...imageSources].join(" "),
    "font-src 'self'",
    ["connect-src 'self'", ...(payments ? STRIPE_CSP_SOURCES.connect : [])].join(" "),
    ...(payments ? [`frame-src ${STRIPE_CSP_SOURCES.frame.join(" ")}`] : []),
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    `frame-ancestors ${ancestor ?? "'none'"}`,
  ].join("; ");
}

/** Caddy 的 path 匹配器参数：每个前缀本身和它下面的全部路径（查询串不参与匹配，所以「前缀?x=1」也算）。 */
export function apiPathPatterns(prefixes: readonly string[] = API_PATH_PREFIXES): string[] {
  if (prefixes.length === 0) throw new Error("API 前缀表是空的");
  return prefixes.flatMap((prefix) => {
    if (!/^(\/[a-z0-9_-]+)+$/.test(prefix)) throw new Error(`API 前缀不能直接写进 Caddy 配置：${prefix}`);
    return [prefix, `${prefix}/*`];
  });
}

/** 三条策略（官网页面、嵌入预订页、其余），vite preview 插件和 Caddy 片段用的是同一份（edge-config.test.ts 核对） */
export function edgePolicies(scriptHashes: readonly string[], imageSources: readonly string[]): { site: string; other: string; embedBook(ancestor: string): string } {
  return {
    site: contentSecurityPolicy(scriptHashes, imageSources, { payments: true }),
    other: contentSecurityPolicy(scriptHashes, imageSources),
    // 同官网页面（嵌入页里以后要付款，ADR 0095 第五节第 1 小节），只是 frame-ancestors 换成那一个宿主
    embedBook: (ancestor) => contentSecurityPolicy(scriptHashes, imageSources, { payments: true, frameAncestor: ancestor }),
  };
}

/**
 * 生成给 deploy/Caddyfile import 的片段：`@api` 匹配器、CSP 响应头、嵌入预订页的路由。参数是构建好的 index.html 的内容。
 * CSP 三条：官网页面（`@site_pages`）带 Stripe 的来源，嵌入预订页（`@embed_book_pages`）同官网页面但 `frame-ancestors` 来自 API，
 * 其余（`@other_pages`）不带 Stripe、`frame-ancestors 'none'`；三个匹配器互斥，每个响应恰好一条。
 * 匹配用 `http.request.orig_uri`（请求行里的原始地址，没解码、没规整），不用 `path` 匹配器，原因见 `SITE_PAGE_URI_PATTERN`。
 *
 * 嵌入预订页整段写在 `route { }` 里（ADR 0095 第五节第 1 小节）：Caddyfile 在同一个 handle 里按固定的指令顺序执行（header 在 forward_auth 之前、
 * request_header 在 forward_auth 之后），只有 route 里按书写顺序。顺序是：删掉客户端自己带的 X-Nozomi-Frame-Ancestor → forward_auth 问 API
 * （只转 key、host 两个查询参数：银行回跳的地址上有 payment_intent_client_secret；X-Forwarded-Uri 换成 frame-check 自己的地址；不转 Cookie、Authorization）
 * → API 放行（2xx）时把它回的宿主写进 frame-ancestors、不缓存 → 返回 index.html。API 不放行时 forward_auth 把 API 的应答（403 / 429，frame-ancestors 'none'）原样回给浏览器。
 */
export function renderEdgeConfig(indexHtml: string): string {
  const hashes = inlineScriptHashes(indexHtml);
  const policies = edgePolicies(hashes, [MAP_TILE_CSP_PLACEHOLDER]);
  const isSitePage = `{http.request.orig_uri}.matches("(?i)${SITE_PAGE_URI_PATTERN}")`;
  const isEmbedBookPage = `{http.request.orig_uri}.matches("(?i)${EMBED_BOOK_URI_PATTERN}")`;
  return [
    "# 构建前端镜像时由 apps/web/build/edge-config.ts 生成，不要手工修改。",
    `@api path ${apiPathPatterns().join(" ")}`,
    `@site_pages expression \`${isSitePage}\``,
    `@embed_book_pages expression \`${isEmbedBookPage}\``,
    `@other_pages expression \`!${isSitePage} && !${isEmbedBookPage}\``,
    `header @site_pages Content-Security-Policy "${policies.site}"`,
    `header @other_pages Content-Security-Policy "${policies.other}"`,
    "handle @embed_book_pages {",
    "\troute {",
    `\t\trequest_header -${FRAME_ANCESTOR_HEADER}`,
    `\t\tforward_auth ${API_UPSTREAM} {`,
    `\t\t\turi ${FRAME_CHECK_PATH}?key={query.key}&host={query.host}`,
    `\t\t\theader_up X-Forwarded-Uri ${FRAME_CHECK_PATH}`,
    "\t\t\theader_up -Cookie",
    "\t\t\theader_up -Authorization",
    `\t\t\tcopy_headers ${FRAME_ANCESTOR_HEADER}`,
    "\t\t}",
    `\t\theader Content-Security-Policy "${policies.embedBook(FRAME_ANCESTOR_PLACEHOLDER)}"`,
    '\t\theader Cache-Control "no-store"',
    `\t\troot * ${WEB_ROOT_PATH}`,
    "\t\ttry_files {path} /index.html",
    "\t\tfile_server",
    "\t}",
    "}",
    "",
  ].join("\n");
}
