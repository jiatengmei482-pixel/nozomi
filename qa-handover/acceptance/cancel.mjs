import { open } from "./pw.mjs";
import { readFileSync } from "node:fs";
const keys = process.argv.slice(2);
const rows = readFileSync(".orders", "utf8").trim().split("\n").map((l) => l.split("\t"));
const { browser, context } = await open({ unlock: false });
for (const k of keys) {
  const url = rows.filter((r) => r[0] === k).pop()[2];
  const page = await context.newPage();
  await page.goto(url);
  await page.getByRole("heading", { level: 1, name: /^订单 NZ/ }).waitFor();
  await page.getByRole("button", { name: "取消订单" }).last().click();
  await page.waitForTimeout(1500);
  const box = page.getByText(/按取消政策/).first();
  console.log(k, "CONFIRM:", (await box.innerText()).replace(/\n+/g, " | "));
  await page.screenshot({ path: `shots/${k}-8-cancel-confirm.png` });
  await page.getByRole("button", { name: "确认取消订单" }).click();
  await page.waitForTimeout(5000);
  await page.reload(); await page.getByRole("heading", { level: 1 }).waitFor(); await page.waitForTimeout(2500);
  const t = (await page.locator("main").innerText()).replace(/\n+/g, " | ");
  const i = t.indexOf("订单进度");
  console.log(k, "AFTER:", t.slice(0, 40), "...", t.slice(i, i + 500));
  await page.screenshot({ path: `shots/${k}-9-cancelled.png`, fullPage: true });
  await page.close();
}
await browser.close();
