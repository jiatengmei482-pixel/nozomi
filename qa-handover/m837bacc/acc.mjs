import { createRequire } from "node:module";
const require = createRequire("/workspaces/nozomi/apps/web/package.json");
const { webkit, devices } = require("@playwright/test");
const browser = await webkit.launch();
const out = [];
for (const dev of ["iPhone 13", "iPhone SE"]) {
  const ctx = await browser.newContext({ ...devices[dev], baseURL: "http://127.0.0.1:18443", locale: "zh-CN", timezoneId: "Asia/Tokyo" });
  const page = await ctx.newPage();
  for (const [mode, labels, q] of [["transfer", ["出发地", "目的地"], "新宿駅"], ["charter", ["上车地点", "下车地点"], "東京駅"]]) {
    await page.goto(`/book/new${mode === "charter" ? "?mode=charter" : ""}`);
    await page.waitForTimeout(2500);
    for (const label of labels) {
      await page.getByRole("button", { name: new RegExp(`^${label}`) }).first().tap();
      const sheet = page.getByRole("dialog", { name: label });
      await sheet.waitFor();
      const cb = sheet.getByRole("combobox", { name: label });
      await cb.fill(q);
      const list = sheet.getByRole("listbox", { name: `${label}的候选` });
      await list.getByRole("option").first().waitFor({ timeout: 15000 });
      await page.waitForTimeout(600);
      const s = await sheet.boundingBox(), c = await cb.boundingBox(), l = await list.boundingBox();
      const first = (await list.getByRole("option").first().innerText()).replace(/\n+/g, " / ");
      out.push({ dev, mode, label, sheetW: Math.round(s.width), inputW: Math.round(c.width), inputBottom: Math.round(c.y + c.height), listX: Math.round(l.x), inputX: Math.round(c.x), listY: Math.round(l.y), listW: Math.round(l.width), first: first.slice(0, 40) });
      await page.screenshot({ path: `staging-webkit-${dev.replace(" ", "")}-${mode}-${label}.png` });
      await sheet.getByRole("button", { name: "取消" }).tap();
      await sheet.waitFor({ state: "hidden" });
    }
  }
  await ctx.close();
}
console.table(out);
await browser.close();
