/**
 * 端到端测试：真实浏览器 → 构建好的前端（vite preview）→ 真实运行的 API → 真实 PostgreSQL。不 mock 任何接口。
 * 数据库用一个临时 schema，API 和前端各起在非默认端口上，全部由 e2e/global-setup.ts 准备和清理。
 */
import { defineConfig, devices } from "@playwright/test";

/** 默认端口避开开发时常用的 8080 / 5173 / 4173；本机有冲突时用环境变量改。 */
export const E2E_API_PORT = Number(process.env["E2E_API_PORT"] ?? 18080);
export const E2E_WEB_PORT = Number(process.env["E2E_WEB_PORT"] ?? 14173);
/** 本机的假瓦片服务（地图底图）、假汇率源和一个「没有配置底图」的第二个 API 进程；端口跟着上面两个走，不用另外配置。 */
export const E2E_TILE_PORT = E2E_WEB_PORT + 1;
export const E2E_API_NO_MAP_PORT = E2E_API_PORT + 1;
/** 本机的假汇率源（测试从不访问真实的汇率源）。 */
export const E2E_FX_PORT = E2E_API_PORT + 2;
/**
 * 官网地址搜索（M3-12，ADR 0044）专用的一组：配置文件里有一把假的谷歌密钥的 API 进程和指向它的前端。
 * 主 API 的谷歌密钥只能由用例在运营后台临时填写（别的用例会填、会清空），地址搜索的用例要一个确定「有密钥」的环境；
 * 谷歌的地址都指向本机的假服务器（global-setup），从不调用真实的谷歌。
 */
export const E2E_API_PLACES_PORT = E2E_API_PORT + 3;
export const E2E_WEB_PLACES_PORT = E2E_WEB_PORT + 2;
/**
 * 官网付款（M3-08，ADR 0046）专用的一组：配置文件里有一套本次运行随机生成的 Stripe 测试密钥（sk_test_ / pk_test_ / whsec_）的 API 进程和指向它的前端。
 * 主 API 不配 Stripe（别的官网用例要「付款暂未开放」）；这组的 Stripe 指向本机的假 Stripe（e2e/fake-stripe.ts），从不调用真实的 Stripe。
 */
export const E2E_API_STRIPE_PORT = E2E_API_PORT + 4;
export const E2E_WEB_STRIPE_PORT = E2E_WEB_PORT + 3;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  outputDir: "./test-results",
  fullyParallel: true,
  forbidOnly: process.env["CI"] !== undefined,
  // 不重跑：偶发失败当场暴露（M4-07 根治后连续 5 次 CI 没有偶发，2026-10-26 改回 0）
  retries: 0,
  workers: 4,
  // 运营后台每次登录多一步两步验证（ADR 0030），同一个人同一个 30 秒里的动态码只能用一次，偶尔要等下一个时间窗
  timeout: 60_000,
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
