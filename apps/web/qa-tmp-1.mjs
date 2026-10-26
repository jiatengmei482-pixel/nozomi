import { browser, platformPage, SHOT } from "./qa-tmp-lib.mjs";
const b = await browser();
const p = await platformPage(b, { path: "/platform/tenant-documents" });
await p.waitForTimeout(1000);
console.log(p.url());
console.log((await p.locator("main").innerText()).slice(0,2500));
await p.screenshot({ path: SHOT + "M4-01-platform-doc-queue.png", fullPage: true });
await b.close();
