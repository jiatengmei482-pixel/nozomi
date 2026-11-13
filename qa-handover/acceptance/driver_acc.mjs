import { open } from "./pw.mjs";
import { readFileSync } from "node:fs";
const path = JSON.parse(readFileSync(".driverlinks", "utf8")).B;
const { browser, context } = await open({ unlock: false, viewport: { width: 360, height: 640 } });
const page = await context.newPage();
for (const scheme of ["light", "dark"]) {
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto(path); await page.waitForTimeout(3000);
  const btn = page.getByRole("button", { name: "我出发了" });
  const box = await btn.boundingBox();
  const bar = await page.locator(".driver-next-bar").boundingBox();
  const pos = await page.locator(".driver-next-bar").evaluate((e) => getComputedStyle(e).position);
  const scrollY = await page.evaluate(() => window.scrollY);
  await page.screenshot({ path: `shots/m608-driver-360-${scheme}-top.png` });
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await page.waitForTimeout(500);
  const last = await page.getByText(/链接有效期到/).boundingBox();
  const bar2 = await page.locator(".driver-next-bar").boundingBox();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await page.screenshot({ path: `shots/m608-driver-360-${scheme}-bottom.png` });
  console.log(scheme, JSON.stringify({ scrollY, btnInView: box && box.y >= 0 && box.y + box.height <= 640, barPos: pos, barTop: Math.round(bar.y), lastBottom: Math.round(last.y + last.height), barTopAfterScroll: Math.round(bar2.y), overflow }));
}
await browser.close();
