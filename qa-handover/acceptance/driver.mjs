import { open } from "./pw.mjs";
import { readFileSync } from "node:fs";
const links = JSON.parse(readFileSync(".driverlinks", "utf8"));
const { browser, context } = await open({ unlock: false, viewport: { width: 360, height: 740 } });
for (const [k, path] of Object.entries(links)) {
  const page = await context.newPage();
  await page.goto(path);
  await page.waitForTimeout(4000);
  const t = (await page.locator("body").innerText()).replace(/\n+/g, " | ").replace(/nz[a-z]_[A-Za-z0-9_-]+/g, "***");
  console.log(k, t.slice(0, 900));
  await page.screenshot({ path: `shots/${k}-7-driver-360.png`, fullPage: true });
  await page.close();
}
await browser.close();
