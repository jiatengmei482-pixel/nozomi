import { chromium } from "@playwright/test";
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 360, height: 740 }, locale: "zh-CN" });
await p.goto("https://nozomi.moveglobal.io/book", { waitUntil: "networkidle" });
await p.screenshot({ path: "/home/codespace/nozomi-wt/qa/acceptance/smoke-book-360.png", fullPage: true });
console.log(await p.locator("main").innerText());
await b.close();
