// M6-10 测试站验收：QA 测试供应商只读浏览商品分步配置（不点保存）。邮箱密码从文件读，不打印。
import { createRequire } from "node:module"; import { readFileSync } from "node:fs"; import os from "node:os";
const require = createRequire("/workspaces/nozomi/apps/web/package.json");
const { chromium } = require("@playwright/test");
const rd = (n) => readFileSync(`${os.homedir()}/.ssh/nozomi/${n}`, "utf8").trim();
const browser = await chromium.launch();
const out = [];
for (const [label, ctxOpts] of [["desktop-mouse", { viewport: { width: 1280, height: 800 } }], ["touch-390", { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }]]) {
  const ctx = await browser.newContext({ baseURL: "https://nozomi.moveglobal.io", locale: "zh-CN", timezoneId: "Asia/Tokyo", ...ctxOpts });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("邮箱").fill(rd("qa-staging-tenant-email"));
  await page.getByLabel("密码", { exact: true }).fill(rd("qa-staging-tenant-password"));
  await page.getByRole("button", { name: /^登录/ }).click();
  await page.getByRole("heading", { level: 1, name: "首页" }).waitFor({ timeout: 30000 });
  const ring = async () => page.evaluate(() => { const a = document.activeElement; if (!a) return "nothing"; const s = getComputedStyle(a); return `${a.tagName}.${a.className} "${(a.textContent || "").trim().slice(0, 12)}" src=${a.getAttribute("data-focus-source")} outline=${s.outlineStyle === "none" || s.outlineWidth === "0px" ? "none" : s.outlineWidth + " " + s.outlineStyle}`; });
  const nav = page.getByRole("navigation", { name: "配置步骤" });
  await page.goto("/products/dae3db20-5df8-4e99-86e3-02b2978a5cf9/basic"); await page.waitForTimeout(2500);
  out.push([label, "直接打开网址", await ring()]);
  if (label === "desktop-mouse") {
    await nav.getByRole("link", { name: /服务规则/ }).click(); await page.waitForTimeout(2000);
    out.push([label, "鼠标点步骤导航", await ring()]);
    await page.keyboard.press("ArrowDown"); await page.waitForTimeout(300);
    out.push([label, "之后按方向键", await ring()]);
    await nav.getByRole("link", { name: /基础信息/ }).focus(); await page.keyboard.press("Enter"); await page.waitForTimeout(2000);
    out.push([label, "键盘 Enter 换步", await ring()]);
    await page.goBack(); await page.waitForTimeout(2000);
    out.push([label, "浏览器后退", await ring()]);
    await page.screenshot({ path: `${os.homedir()}/nozomi-wt/m610acc/back.png` });
  } else {
    const toggle = page.getByRole("button", { name: /步骤|配置步骤|第 . 步/ }).first();
    if (await toggle.count()) { await toggle.tap(); await page.waitForTimeout(500); }
    await nav.getByRole("link", { name: /服务规则/ }).tap(); await page.waitForTimeout(2000);
    out.push([label, "触屏点步骤导航", await ring()]);
    await page.screenshot({ path: `${os.homedir()}/nozomi-wt/m610acc/touch.png` });
  }
  await ctx.close();
}
for (const r of out) console.log(r.join(" | "));
await browser.close();
