/**
 * 端到端：/book/trip 的「一句话描述你的行程」（M9T-33，ADR 0104）。真实浏览器 → 前端 → 真实 API（`/site/v1/trips/parse-status`、`/parse`）→ 假 Claude。
 *
 * 假 Claude（global-setup，`startFakeAnthropicMessages`）：默认回固定行程（成田 → 浅草寺 → 新宿的酒店；第 3 天京王广场酒店 → 羽田；4 人，行李没说；航班 NH211），
 * 客人的话里有「讲个笑话」回空行程，有「AI 出错」回 529。地名经假地址搜索换坐标。
 * 配置文件里没有 Claude 密钥：用例开始时在运营后台填一把假的 `sk-ant-` 密钥（PUT /platform/v1/integration-secrets/anthropic），结束时清空。
 * 用一个随机的文档专用来源地址：解析接口按来源地址限频（每分钟 3 次），本用例正好 3 次，不占别的用例的额度。
 *
 * - 填了密钥：输入框出现 → 帮我填好 → 摘要框（几天行程、请补填里有行李、没有用上的信息里有航班号）、表单里有「AI 填的，可改」标记；
 * - 「讲个笑话」→「没看出行程…」；「AI 出错」→「暂时没法自动整理…」；表单不动；
 * - 清空密钥后刷新：输入框不显示，手填照旧。亮暗两色 axe。
 */
import { type APIRequestContext, expect, test } from "@playwright/test";
import { E2E_WEB_STRIPE_PORT } from "../playwright.config.ts";
import { expectAccessible } from "./catalog.ts";
import { charterWorld } from "./charter-support.ts";
import { platformAdminHeaders, randomLetters } from "./support.ts";

const SITE = `http://127.0.0.1:${E2E_WEB_STRIPE_PORT}`;

async function setClaudeKey(request: APIRequestContext, on: boolean): Promise<void> {
  const headers = await platformAdminHeaders(request);
  const response = on
    ? await request.put("/platform/v1/integration-secrets/anthropic", { headers, data: { api_key: `sk-ant-e2e-${randomLetters(24)}` } })
    : await request.delete("/platform/v1/integration-secrets/anthropic", { headers });
  expect(response.ok(), await response.text()).toBe(true);
}

// 用例超时时 finally 里的 request 可能已经拆掉：再兜底清空一次，别让 Claude 密钥留在库里影响别的用例
test.afterAll(async ({ request }) => {
  const headers = await platformAdminHeaders(request);
  await request.delete("/platform/v1/integration-secrets/anthropic", { headers });
});

test("一句话行程：填了密钥后输入框可用——整理成表单和摘要；没看出行程、AI 出错各一句话；清空密钥后不显示；亮暗 axe", async ({ page, request }) => {
  test.setTimeout(120_000);
  await charterWorld(request);
  await setClaudeKey(request, true);
  try {
    await page.setExtraHTTPHeaders({ "x-forwarded-for": `198.51.100.${1 + Math.floor(Math.random() * 250)}` });
    await page.setViewportSize({ width: 1280, height: 900 });
    // 页面开在另一个 API 进程（官网付款那组）：那边的密钥缓存最多 5 秒才更新，页面只在打开时问一次 parse-status —— 刷新到输入框出现为止
    await expect(async () => {
      await page.goto(`${SITE}/book/trip`);
      await expect(page.getByRole("heading", { name: "一句话描述你的行程", level: 2 })).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 30_000 });
    const section = page.locator(".trip-ai");
    const box = page.getByLabel("行程描述");
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expectAccessible(page, `一句话输入框（${scheme === "light" ? "亮色" : "暗色"}）`);
    }
    await page.emulateMedia({ colorScheme: "light" });

    await box.fill("11月25日成田接机先去浅草寺玩两个小时再去新宿的酒店，第三天从京王广场酒店去羽田，4个人，航班NH211");
    await page.getByRole("button", { name: "帮我填好" }).click();
    const summary = page.locator(".trip-ai-summary");
    await expect(summary).toBeVisible({ timeout: 30_000 });
    await expect(summary).toContainText(/已按你的描述填好 \d+ 天行程/);
    await expect(summary).toContainText("航班号 NH211");
    await expect(summary.getByRole("heading", { name: "请补填" })).toBeVisible();
    await expect(page.locator(".trip-ai-cell--filled").first()).toBeVisible();
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expectAccessible(page, `整理后的表单（${scheme === "light" ? "亮色" : "暗色"}）`);
    }
    await page.emulateMedia({ colorScheme: "light" });
    await page.screenshot({ path: test.info().outputPath("m9t33-ai-filled.png"), fullPage: true });

    await box.fill("讲个笑话");
    await page.getByRole("button", { name: "帮我填好" }).click();
    await expect(section).toContainText("没看出行程，请写上日期、地点，或直接在下面填写", { timeout: 30_000 });

    await box.fill("AI 出错");
    await page.getByRole("button", { name: "帮我填好" }).click();
    await expect(section).toContainText("暂时没法自动整理，请直接在下面填写", { timeout: 30_000 });
    await expect(summary).toBeVisible();
  } finally {
    await setClaudeKey(request, false);
  }
  // 清空后最多 5 秒别的进程才知道：刷新到输入框不见为止
  await expect(async () => {
    await page.reload();
    await expect(page.getByRole("heading", { name: "你的行程", level: 2 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "一句话描述你的行程" })).toHaveCount(0);
  }).toPass({ timeout: 20_000 });
});
