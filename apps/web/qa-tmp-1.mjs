import { browser, platformPage, SHOT } from "./qa-tmp-lib.mjs";
const b = await browser();
const p = await platformPage(b, { path: "/platform/tenants/a4f24caa-d0cd-421c-a582-7a440312cc24" });
await p.waitForTimeout(800);
let t = await p.locator("main").innerText(); console.log(t.slice(t.indexOf("入驻进度"), t.indexOf("入驻进度") + 300).replace(/\n+/g," | "));
await p.getByRole("button", { name: "签约" }).click(); await p.waitForTimeout(800);
let d = p.getByRole("dialog"); if (await d.count()) { console.log("DLG:", (await d.innerText()).replace(/\n+/g," | ")); await d.getByRole("button", { name: /签约|确认/ }).last().click(); }
await p.waitForTimeout(2000);
t = await p.locator("main").innerText(); console.log("AFTER SIGN:", t.slice(t.indexOf("入驻进度"), t.indexOf("入驻进度") + 400).replace(/\n+/g," | "));
const btns = await p.getByRole("button").allInnerTexts(); console.log(btns.filter(x=>/试运营/.test(x)));
if (btns.some(x=>/试运营/.test(x))) {
  await p.getByRole("button", { name: /试运营/ }).first().click(); await p.waitForTimeout(800);
  d = p.getByRole("dialog"); if (await d.count()) { console.log("DLG2:", (await d.innerText()).replace(/\n+/g," | ")); await d.getByRole("button", { name: /试运营|确认|开始/ }).last().click(); }
  await p.waitForTimeout(2000);
  t = await p.locator("main").innerText(); console.log("AFTER TRIAL:", t.slice(0, 200).replace(/\n+/g," | "), t.slice(t.indexOf("入驻进度"), t.indexOf("入驻进度") + 400).replace(/\n+/g," | "));
}
await p.screenshot({ path: SHOT + "M4-01-after-sign-trial.png", fullPage: true });
await b.close();
