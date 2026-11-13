import { open, P } from "./pw.mjs";
const { browser, context } = await open();
const page = await context.newPage();
const pt = (k, nm) => `${k}=${P[nm].lat},${P[nm].lng}&${k}_name=${encodeURIComponent(P[nm].name)}`;
await page.goto(`/book/new?${pt("from", "karuizawa")}&${pt("to", "shinjuku")}&date=2026-11-20&time=10:00&pax=2&bags=1`);
await page.waitForTimeout(6000);
const form = page.getByRole("region", { name: "请客服人工报价" });
console.log("MAIN:", (await page.locator("main").innerText()).replace(/\n+/g, " | ").slice(0, 900));
await page.screenshot({ path: "shots/E-1-noquote.png", fullPage: true });
if (process.argv[2] === "submit") {
  await form.getByLabel("邮箱").fill("m814-e@example.com");
  const n = form.getByLabel(/称呼|姓名/); if (await n.count()) await n.first().fill("QA 验收 E（M8-14）");
  const resp = page.waitForResponse((r) => r.url().includes("/site/v1/manual-quote-requests"));
  await form.getByRole("button", { name: "提交" }).click();
  const r = await resp; console.log("POST", r.status(), await r.text());
  await page.waitForTimeout(1500);
  console.log("AFTER:", (await form.innerText()).replace(/\n+/g, " | ").slice(0, 400));
  await page.screenshot({ path: "shots/E-2-submitted.png", fullPage: true });
}
await browser.close();
