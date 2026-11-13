import { open, P } from "./pw.mjs";
const { browser, context } = await open({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
const pt = (k, n) => `${k}=${P[n].lat},${P[n].lng}&${k}_name=${encodeURIComponent(P[n].name)}`;
const out = {};
for (const [label, a, b] of [["distance_only", "shibuya", "kawasaki"], ["one_price_outside_km", "shinjuku", "kawasaki"]]) {
  await page.goto(`/book/new?${pt("from", a)}&${pt("to", b)}&date=2026-11-25&time=10:00&pax=2&bags=1`);
  await page.getByRole("heading", { name: "选择车型" }).waitFor({ timeout: 30000 });
  await page.waitForTimeout(2000);
  const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "经济5座" }) });
  const before = (await page.locator("main").innerText()).match(/(一口价包含|车费包含)/g);
  await card.getByRole("button", { name: "选择 经济5座" }).click();
  await page.waitForTimeout(1200);
  const main = (await page.locator("main").innerText()).replace(/\n+/g, " | ");
  const bar = await page.locator(".book-bar").first().innerText().catch(() => "");
  out[label] = { includesTitleBeforeSelect: before, includesSection: main.match(/(一口价包含|车费包含)[^|]*\|[^|]*\|/)?.[0], bottomBar: bar.replace(/\n+/g, " | "), hasYikoujiaAfterSelect: /一口价/.test(main + bar) };
  await page.screenshot({ path: `shots/m840-${label}-390.png`, fullPage: true });
}
console.log(JSON.stringify(out, null, 1));
await context.request.delete("/site/v1/qa-acceptance/session");
await browser.close();
