import { chromium } from "@playwright/test";
import { readFileSync, existsSync, writeFileSync, chmodSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
export const BASE = "https://nozomi.moveglobal.io";
export const SHOT = "/home/codespace/nozomi-wt/qa/acceptance/";
const SCR = "/tmp/claude-1000/-workspaces-nozomi/3c52977f-7ec6-45a6-91fb-337c30e17c9c/scratchpad/";
export const totp = (secretFile) => execFileSync("python3", [SCR + (secretFile ? "totp2.py" : "totp.py")].concat(secretFile ? [secretFile] : [])).toString().trim();
export async function browser() { return chromium.launch(); }
export async function platformPage(b, opts = {}) {
  const state = SCR + (opts.stateName ?? "pstate.json");
  const ctx = await b.newContext({ viewport: opts.viewport ?? { width: 1280, height: 900 }, locale: "zh-CN", colorScheme: opts.colorScheme ?? "light", storageState: existsSync(state) ? state : undefined });
  const p = await ctx.newPage();
  await p.goto(BASE + (opts.path ?? "/platform"), { waitUntil: "networkidle" });
  if (await p.getByLabel("密码", { exact: true }).count()) {
    const email = opts.email ?? "qa-acceptance@nozomi.moveglobal.io";
    const pw = readFileSync(opts.pwFile ?? homedir() + "/.ssh/nozomi/qa-password", "utf8").trim();
    await p.getByLabel("邮箱").fill(email);
    await p.getByLabel("密码", { exact: true }).fill(pw);
    await p.getByRole("button", { name: /登录/ }).click();
    await p.waitForTimeout(1500);
    const code = totp(opts.totpFile);
    await p.getByLabel(/动态码|验证码/).first().fill(code);
    await p.getByRole("button", { name: /验证|确认|登录|继续/ }).first().click();
    await p.waitForLoadState("networkidle");
    await p.waitForTimeout(1000);
    await ctx.storageState({ path: state }); chmodSync(state, 0o600);
    if (opts.path) await p.goto(BASE + opts.path, { waitUntil: "networkidle" });
  }
  return p;
}
export async function tenantPage(b, opts = {}) {
  const state = SCR + "tstate.json";
  const ctx = await b.newContext({ viewport: opts.viewport ?? { width: 1280, height: 900 }, locale: "zh-CN", colorScheme: opts.colorScheme ?? "light", storageState: existsSync(state) ? state : undefined });
  const p = await ctx.newPage();
  await p.goto(BASE + (opts.path ?? "/"), { waitUntil: "networkidle" });
  if (await p.getByLabel("密码", { exact: true }).count()) {
    await p.getByLabel("邮箱").fill("qa-m401-20261026@nozomi.moveglobal.io");
    await p.getByLabel("密码", { exact: true }).fill(readFileSync(SCR + "tenant_pw", "utf8").trim());
    await p.getByRole("button", { name: /登录/ }).click();
    await p.waitForLoadState("networkidle"); await p.waitForTimeout(1000);
    await ctx.storageState({ path: state }); chmodSync(state, 0o600);
    if (opts.path) await p.goto(BASE + opts.path, { waitUntil: "networkidle" });
  }
  return p;
}
