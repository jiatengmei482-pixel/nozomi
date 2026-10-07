/**
 * 前端的开发服务器与构建配置。
 *
 * 正式环境里前端静态文件和 API 在同一个域名下，反向代理把下面这些前缀转给 API、其余走前端，
 * 所以前端一律用相对路径调 API。开发（vite）和端到端测试（vite preview）用同一张代理表模拟这件事。
 * 前端路由不能占用这些前缀。
 */
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { type ProxyOptions, defineConfig } from "vite";
import { API_PATH_PREFIXES } from "./src/lib/api-prefixes.ts";

const apiOrigin = process.env["NOZOMI_API_ORIGIN"] ?? "http://localhost:8080";
const proxy: Record<string, ProxyOptions> = Object.fromEntries(
  API_PATH_PREFIXES.map((prefix) => [`^${prefix}(/|\\?|$)`, { target: apiOrigin, changeOrigin: false }]),
);

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy,
    fs: { allow: [fileURLToPath(new URL("../..", import.meta.url))] },
  },
  preview: { port: 4173, strictPort: true, proxy },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: false },
});
