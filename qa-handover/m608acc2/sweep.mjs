// M6-08 供应商后台实地验收：QA 测试供应商（is_test_tenant）只读浏览，不写数据。邮箱、密码从文件读，不打印。
import { createRequire } from "node:module";
import { readFileSync } from "node:fs"; import os from "node:os";
const require = createRequire("/workspaces/nozomi/apps/web/package.json");
const { chromium } = require("@playwright/test");
const AxeBuilder = require("@axe-core/playwright").default;
const rd = (n) => readFileSync(`${os.homedir()}/.ssh/nozomi/${n}`, "utf8").trim();
const browser = await chromium.launch();
const results = [];
for (const vp of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
  const ctx = await browser.newContext({ baseURL: "https://nozomi.moveglobal.io", viewport: vp, locale: "zh-CN", timezoneId: "Asia/Tokyo" });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(rd("qa-staging-tenant-email"));
  await page.getByLabel("密码", { exact: true }).fill(rd("qa-staging-tenant-password"));
  await page.getByRole("button", { name: /^登录/ }).click();
  await page.getByRole("heading", { level: 1, name: "首页" }).waitFor({ timeout: 30000 });
  const paths = ["/", "/areas", "/areas/bf94606a-53db-4d4a-b3c3-9f1b35dd8896", "/products", "/orders", "/drivers"];
  for (const p of paths) {
    for (const scheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: scheme });
      const r = await page.goto(p); await page.waitForTimeout(2500);
      const h1 = await page.getByRole("heading", { level: 1 }).first().innerText().catch(() => "?");
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const legend = p.startsWith("/areas/") ? (await page.locator("body").innerText()).match(/营运区[^\n]{0,20}/g) : null;
      results.push({ w: vp.width, p, scheme, status: r?.status(), h1, overflow, axe: axe.violations.map((v) => `${v.id}(${v.nodes.length})`).join(",") || "0", legend: legend?.join(" | ") ?? "" });
      await page.screenshot({ path: `${os.homedir()}/nozomi-wt/m608acc2/${vp.width}-${p.replaceAll("/", "_") || "home"}-${scheme}.png`, fullPage: true });
    }
  }
  await ctx.close();
}
console.table(results);
await browser.close();
