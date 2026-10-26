import { browser, platformPage, SHOT } from "./qa-tmp-lib.mjs";
const b = await browser();
const p = await platformPage(b, { path: "/platform/settings/staff/new" });
console.log(await p.getByRole("button").allInnerTexts());
await b.close();
