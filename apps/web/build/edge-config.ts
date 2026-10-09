/**
 * 反向代理（Caddy）里随前端一起变的两样配置，在构建前端镜像时由这里生成（ADR 0007「前端接入部署」）：
 *
 * 1. 归 API 的路径前缀——和开发 / 端到端测试的 Vite 代理用的是同一张表（`src/lib/api-prefixes.ts`），
 *    所以「哪些路径转给 API、其余归前端」在开发、测试、正式环境里不会各说各话；
 * 2. 内容安全策略（CSP）——`index.html` 里设置主题的那段内联脚本用哈希放行。哈希从构建产物里现算，
 *    不手抄：改了那段脚本、或构建工具改了它的输出，策略自动跟着变。
 *    唯一按环境变的部分是地图底图的图片来源（ADR 0015）：同一份镜像要部署到底图不同的环境，所以片段里留一个
 *    Caddy 的环境变量占位，由部署时的 `MAP_TILE_CSP_SOURCES` 填入；没配就是只认同源。
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

/**
 * 全站的内容安全策略。前端不加载任何站外的脚本、样式、字体，不用内联样式（ADR 0011），所以除了按哈希放行的内联脚本，一律只认同源。
 * 例外只有一个：地图底图的瓦片图片（ADR 0015）——`imageSources` 里的来源加进 `img-src`，别的指令不动。
 * `frame-ancestors 'none'` 与 X-Frame-Options: DENY 同义，两个都留：老浏览器只认后者。
 */
export function contentSecurityPolicy(scriptHashes: readonly string[], imageSources: readonly string[] = []): string {
  for (const hash of scriptHashes) {
    if (!/^sha256-[A-Za-z0-9+/]{43}=$/.test(hash)) throw new Error(`不是合法的 sha256 哈希：${hash}`);
  }
  for (const source of imageSources) {
    if (source !== MAP_TILE_CSP_PLACEHOLDER && !IMAGE_SOURCE.test(source)) throw new Error(`不能放进 img-src 的图片来源：${source}`);
  }
  const scriptSources = ["'self'", ...scriptHashes.map((hash) => `'${hash}'`)];
  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self'",
    ["img-src 'self'", ...imageSources].join(" "),
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
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

/** 生成给 deploy/Caddyfile import 的片段：`@api` 匹配器和 CSP 响应头。参数是构建好的 index.html 的内容。 */
export function renderEdgeConfig(indexHtml: string): string {
  const hashes = inlineScriptHashes(indexHtml);
  return [
    "# 构建前端镜像时由 apps/web/build/edge-config.ts 生成，不要手工修改。",
    `@api path ${apiPathPatterns().join(" ")}`,
    `header Content-Security-Policy "${contentSecurityPolicy(hashes, [MAP_TILE_CSP_PLACEHOLDER])}"`,
    "",
  ].join("\n");
}
