import { browser, platformPage, SHOT } from "./qa-tmp-lib.mjs";
import { writeFileSync } from "node:fs";
const SCR = "/tmp/claude-1000/-workspaces-nozomi/3c52977f-7ec6-45a6-91fb-337c30e17c9c/scratchpad/";
const b = await browser();
const p = await platformPage(b, { path: "/platform/settings/staff" });
console.log(p.url(), await p.getByRole("button").allInnerTexts(), await p.getByRole("link", { name: /新|邀请/ }).allInnerTexts());
await p.getByRole("link", { name: "新增员工" }).click(); await p.waitForTimeout(1000);

await p.getByLabel("邮箱").fill("qa-m405-20261026@nozomi.moveglobal.io");
await p.getByLabel("姓名").fill("M4-05 验收临时员工（自建角色）");
await p.locator('input[value="custom_4a16c6195b8bd3aa"]').check();
await p.getByRole("button", { name: /邀请|新建|发出/ }).last().click(); await p.waitForTimeout(2500);
const html = await p.content();
const m = html.match(/https:\/\/nozomi\.moveglobal\.io\/[^"'<\s]*invite[^"'<\s]*/);
if (m) writeFileSync(SCR + "invite-staff.txt", m[0].replace(/&amp;/g,"&"), { mode: 0o600 });
console.log("link saved:", !!m);
console.log((await p.getByRole("dialog").innerText().catch(()=>"(no dialog)")).replace(/https:\S+/g,"<link>"));
await b.close();
