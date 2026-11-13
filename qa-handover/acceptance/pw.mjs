// M8-14 验收：Playwright 浏览器上下文。口令只读进变量、只放请求体；会话状态存 600 文件，结束删除。
import { createRequire } from "node:module";
import { readFileSync, writeFileSync, existsSync, chmodSync } from "node:fs";
import os from "node:os";
const require = createRequire("/workspaces/nozomi/apps/web/package.json");
export const { chromium } = require("@playwright/test");
export const BASE = "https://nozomi.moveglobal.io";
const STATE = `${os.homedir()}/nozomi-wt/m814acc/.state.json`;
export async function open({ viewport = { width: 1280, height: 900 }, unlock = true } = {}) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ baseURL: BASE, viewport, locale: "zh-CN", timezoneId: "Asia/Tokyo", ...(existsSync(STATE) ? { storageState: STATE } : {}) });
  if (unlock) {
    const s = await context.request.get("/site/v1/qa-acceptance/session");
    if (s.status() !== 200) {
      const token = readFileSync(`${os.homedir()}/.ssh/nozomi/qa-staging-acceptance-token`, "utf8").trim();
      const r = await context.request.post("/site/v1/qa-acceptance/session", { data: { token } });
      if (r.status() !== 201) throw new Error(`解锁失败 ${r.status()}`);
      await context.storageState({ path: STATE }); chmodSync(STATE, 0o600);
      console.error("unlocked new session");
    }
  }
  return { browser, context };
}
export const P = {
  nrt: { lat: 35.76858, lng: 140.388714, name: "成田国際空港" }, shinjuku: { lat: 35.6896, lng: 139.7006, name: "新宿駅" }, kawasaki: { lat: 35.5313, lng: 139.697, name: "川崎駅" },
  shibuya: { lat: 35.658, lng: 139.7016, name: "渋谷駅" }, naritaSta: { lat: 35.7763, lng: 140.3183, name: "成田駅" }, chiba: { lat: 35.6131, lng: 140.1134, name: "千葉駅" },
  hachioji: { lat: 35.6556, lng: 139.3389, name: "八王子駅" }, karuizawa: { lat: 36.3483, lng: 138.6355, name: "軽井沢駅" },
};
