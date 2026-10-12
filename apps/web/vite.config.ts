/**
 * 前端的开发服务器与构建配置。
 *
 * 正式环境里前端静态文件和 API 在同一个域名下，反向代理把下面这些前缀转给 API、其余走前端，
 * 所以前端一律用相对路径调 API。开发（vite）和端到端测试（vite preview）用同一张代理表模拟这件事。
 * 前端路由不能占用这些前缀。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { type Plugin, type ProxyOptions, defineConfig } from "vite";
import { contentSecurityPolicy, inlineScriptHashes } from "./build/edge-config.ts";
import { API_PATH_PREFIXES } from "./src/lib/api-prefixes.ts";

const apiOrigin = process.env["NOZOMI_API_ORIGIN"] ?? "http://localhost:8080";
const proxy: Record<string, ProxyOptions> = Object.fromEntries(
  API_PATH_PREFIXES.map((prefix) => [`^${prefix}(/|\\?|$)`, { target: apiOrigin, changeOrigin: false }]),
);

/**
 * `vite preview`（端到端测试用它提供构建好的前端）带上和正式环境同一条内容安全策略：
 * 策略由同一个函数从同一份构建产物算出，所以策略一旦会拦掉页面需要的东西，端到端测试先失败。
 * 开发服务器（`vite`）不加：热更新要用内联脚本。
 * 地图底图的图片来源在正式环境由部署时的 MAP_TILE_CSP_SOURCES 填进策略（ADR 0015）；这里对应的是 NOZOMI_MAP_TILE_CSP_SOURCES
 *（空格分隔），端到端测试把本机的假瓦片服务填进来。没设就是只认同源。
 */
function previewContentSecurityPolicy(): Plugin {
  return {
    name: "nozomi:preview-content-security-policy",
    configurePreviewServer(server) {
      const indexHtml = readFileSync(new URL("./dist/index.html", import.meta.url), "utf8");
      const imageSources = (process.env["NOZOMI_MAP_TILE_CSP_SOURCES"] ?? "").split(/\s+/).filter((source) => source !== "");
      const policy = imageSources.length === 0 ? contentSecurityPolicy(inlineScriptHashes(indexHtml)) : contentSecurityPolicy(inlineScriptHashes(indexHtml), imageSources);
      server.middlewares.use((_request, response, next) => {
        response.setHeader("Content-Security-Policy", policy);
        next();
      });
    },
  };
}

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react(), previewContentSecurityPolicy()],
  server: {
    port: 5173,
    strictPort: true,
    proxy,
    fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
  },
  preview: { port: 4173, strictPort: true, proxy },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
});
