/**
 * 端到端测试：真实浏览器 → 构建好的前端（vite preview）→ 真实运行的 API → 真实 PostgreSQL。不 mock 任何接口。
 * 数据库用一个临时 schema，API 和前端各起在非默认端口上，全部由 e2e/global-setup.ts 准备和清理。
 */
import { defineConfig, devices } from "@playwright/test";

/** 默认端口避开开发时常用的 8080 / 5173 / 4173；本机有冲突时用环境变量改。 */
export const E2E_API_PORT = Number(process.env["E2E_API_PORT"] ?? 18080);
export const E2E_WEB_PORT = Number(process.env["E2E_WEB_PORT"] ?? 14173);

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: process.env["CI"] !== undefined,
  retries: 0,
  workers: 4,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: `http://127.0.0.1:${E2E_WEB_PORT}`,
    locale: "zh-CN",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
