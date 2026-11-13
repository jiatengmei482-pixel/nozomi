// 临时截图脚本：node .shots.tmp.mjs <标签> [基址] [路径,路径]
import { chromium } from "@playwright/test";
const [label, base = "https://nozomi.moveglobal.io", pathsArg = "/platform/login,/login"] = process.argv.slice(2);
const out = "/home/codespace/import/ui-screens";
const paths = pathsArg.split(",");
const browser = await chromium.launch();
const devices = {
  desktop: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 },
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
for (const [dev, opts] of Object.entries(devices)) {
  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ ...opts, colorScheme: scheme, locale: "zh-CN" });
    const page = await ctx.newPage();
    for (const p of paths) {
      await page.goto(base + p, { waitUntil: "networkidle" });
      await page.waitForTimeout(400);
      const name = `${label}-${dev}-${scheme}-${p.replace(/^\//, "").replace(/\//g, "_") || "root"}.png`;
      await page.screenshot({ path: `${out}/${name}`, fullPage: true });
      console.log(name);
    }
    await ctx.close();
  }
}
await browser.close();
