// 一条线路：/book/new 选车 → 乘客信息 → 核对 → 去付款 → 订单页。参数：场景键
import { open, P } from "./pw.mjs";
import { writeFileSync, appendFileSync, chmodSync } from "node:fs";
const SC = {
  A: { from: "nrt", to: "shinjuku", vg: "经济5座", flight: "NH 9014", sign: "QA M814 AIRPORT" },
  B: { from: "shinjuku", to: "kawasaki", vg: "经济5座", sign: "QA M814 KMFEE" },
  C: { from: "shibuya", to: "kawasaki", vg: "经济5座", sign: "QA M814 METER" },
  D: { from: "chiba", to: "hachioji", vg: "经济5座", sign: "QA M814 CHARTER", mode: "charter" },
  F: { from: "shinjuku", to: "naritaSta", vg: "舒适5座", sign: "QA M814 USD" },
};
const key = process.argv[2]; const s = SC[key];
const { browser, context } = await open();
const page = await context.newPage();
const shot = (n) => page.screenshot({ path: `shots/${key}-${n}.png`, fullPage: true });
const pt = (k, nm) => `${k}=${P[nm].lat},${P[nm].lng}&${k}_name=${encodeURIComponent(P[nm].name)}`;
await page.goto(`/book/new?${s.mode ? `mode=${s.mode}&` : ""}${pt("from", s.from)}&${pt("to", s.to)}&date=2026-11-20&time=10:00&pax=2&bags=1`);
await page.getByRole("heading", { name: "选择车型" }).waitFor({ timeout: 30000 });
await page.waitForTimeout(1500);
await shot("2-vehicles");
const card = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: s.vg }) });
console.log("CARD:", (await card.innerText()).replace(/\n+/g, " | "));
await card.getByRole("button", { name: `选择 ${s.vg}` }).click();
await page.waitForTimeout(800);
const aside = page.getByRole("complementary", { name: "行程摘要" });
if (await aside.count()) console.log("ASIDE:", (await aside.first().innerText()).replace(/\n+/g, " | "));
await page.getByRole("button", { name: "下一步：填写乘客信息" }).click();
await page.getByRole("heading", { level: 2, name: "乘客信息" }).waitFor();
if (s.flight) await page.getByLabel("航班号").fill(s.flight);
await page.getByLabel("乘车人姓名").fill(`QA 验收 ${key}（M8-14）`);
const sign = page.getByLabel("举牌姓名（选填）");
if (await sign.count()) await sign.fill(s.sign);
await page.getByLabel("邮箱").fill(`m814-${key.toLowerCase()}@example.com`);
await page.getByLabel("手机号（含国家区号）").fill("+81 90-0000-1414");
await shot("3-passenger");
await page.getByRole("button", { name: "下一步：核对订单" }).click();
const review = page.getByRole("region", { name: "核对订单" });
await review.waitFor();
console.log("REVIEW:", (await review.innerText()).replace(/\n+/g, " | "));
await shot("4-review");
await page.getByRole("checkbox", { name: /同意保存/ }).check();
await page.getByRole("button", { name: "去付款 →" }).click();
await page.getByRole("heading", { level: 1, name: /^订单 NZ/ }).waitFor({ timeout: 30000 });
const h1 = await page.getByRole("heading", { level: 1 }).innerText();
await page.waitForTimeout(1500);
const m = (await page.locator("main").innerText()).match(/https:\/\/\S+#nzo_[A-Za-z0-9_-]+/);
const url = m ? m[0] : "NO-LINK";
appendFileSync(".orders", `${key}\t${h1}\t${url}\n`); chmodSync(".orders", 0o600);
console.log("ORDER:", h1);
await page.waitForTimeout(4000);
await page.screenshot({ path: `shots/${key}-5-order-pay.png`, fullPage: true });
await browser.close();
