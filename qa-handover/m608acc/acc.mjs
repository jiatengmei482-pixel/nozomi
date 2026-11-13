import { createRequire } from "node:module";
const require = createRequire("/workspaces/nozomi/apps/web/package.json");
const { chromium } = require("@playwright/test");
const B = "https://nozomi.moveglobal.io";
const browser = await chromium.launch();
const out = {};
for (const w of [320, 390]) {
  const ctx = await browser.newContext({ baseURL: B, viewport: { width: w, height: 800 }, locale: "zh-CN", timezoneId: "Asia/Tokyo", hasTouch: false });
  const page = await ctx.newPage();
  await page.goto(`/book/new?from=35.6896,139.7006&from_name=${encodeURIComponent("東京都新宿区西新宿一丁目新宿駅西口ロータリー")}&to=35.658,139.7016&to_name=${encodeURIComponent("東京都渋谷区道玄坂二丁目渋谷駅ハチ公口")}&date=2026-11-25&time=10:00&pax=2&bags=1`);
  await page.getByRole("heading", { name: "选择车型" }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(2500);
  const bar = page.getByRole("button", { name: /^行程摘要/ }).first();
  const info = await bar.evaluate((el) => ({ text: el.innerText.replace(/\n+/g, " | "), height: el.getBoundingClientRect().height }));
  const ends = await page.evaluate(() => [...document.querySelectorAll(".book-trip-bar__place, [class*='trip-bar'] [class*='place']")].map((e) => ({ t: e.textContent, ellipsis: getComputedStyle(e).textOverflow, ws: getComputedStyle(e).whiteSpace, over: e.scrollWidth > e.clientWidth })));
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  out[`step2-${w}`] = { info, ends, overflow };
  await page.screenshot({ path: `step2-${w}.png` });
  await ctx.close();
}
// 日期框聚焦环（电脑宽，第 1 步）
const ctx = await browser.newContext({ baseURL: B, viewport: { width: 1280, height: 900 }, locale: "zh-CN", timezoneId: "Asia/Tokyo" });
const page = await ctx.newPage();
await page.goto("/book/new");
await page.getByLabel("日期（当地）").first().waitFor();
const date = page.getByLabel("日期（当地）").first();
await date.focus();
const ring = await date.evaluate((el) => { const box = el.closest(".input, [class*='date']") ?? el; const s = getComputedStyle(box); return { outline: `${s.outlineStyle} ${s.outlineWidth} ${s.outlineColor}`, boxShadow: s.boxShadow, cls: box.className }; });
out.dateFocus = ring;
await page.screenshot({ path: "date-focus.png" });
// 路线图亮暗：带路线的点对点报价页，切换主题看底图层 class
await page.goto(`/book/new?from=35.6896,139.7006&from_name=${encodeURIComponent("新宿駅")}&to=35.658,139.7016&to_name=${encodeURIComponent("渋谷駅")}&date=2026-11-25&time=10:00&pax=2&bags=1`);
await page.getByRole("heading", { name: "选择车型" }).waitFor({ timeout: 30000 });
await page.waitForTimeout(3000);
const mapState = async () => page.evaluate(() => ({ leaflet: !!document.querySelector(".route-map .leaflet-container"), staticImg: !!document.querySelector(".route-map__image"), dim: !!document.querySelector(".area-map__canvas--dimmed, [class*='dimmed']"), src: document.querySelector(".route-map__image")?.getAttribute("src")?.replace(/[?&](key|sig|token)=[^&]+/g, "")?.slice(0, 120) ?? null }));
out.mapLight = await mapState();
await page.emulateMedia({ colorScheme: "dark" });
await page.waitForTimeout(2500);
out.mapDark = await mapState();
await page.screenshot({ path: "route-dark.png" });
console.log(JSON.stringify(out, null, 1));
await browser.close();
