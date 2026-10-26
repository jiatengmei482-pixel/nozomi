/**
 * 运营后台填写第三方密钥（M4-09，ADR 0041），真实后端 + 真实 PostgreSQL：
 * 超级管理员在「系统设置 → 系统状态」填写谷歌地图的密钥 → 只显示末 4 位 → 测试一下（打到 global-setup 起的本机假谷歌地图）→ 清空 → 回到未配置。
 * 亮暗两套主题过 axe；320 / 768 宽不横向滚动；清空只用键盘完成；页面、请求地址、浏览器存储、审计日志里都没有密钥原文。
 * 密钥是本次运行随机生成的假值；用例结束时已经清空（同一个库里别的用例看系统状态时，谷歌地图最多短暂显示为已配置）。
 */
import { randomBytes } from "node:crypto";
import { AxeBuilder } from "@axe-core/playwright";
import { type Page, expect, test } from "@playwright/test";
import { adminCredentials, expectNoHorizontalOverflow, loginAs, platformAdminHeaders, snapshot, settleAnimations } from "./support.ts";

async function expectAxeClean(page: Page, what: string): Promise<void> {
  await settleAnimations(page);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`), what).toEqual([]);
}

/** 页面的整份 HTML、地址、localStorage / sessionStorage 里都没有这个值（也没有它的前 12、后 8 个字符）。 */
async function expectNowhereOnPage(page: Page, secret: string): Promise<void> {
  const dump = await page.evaluate(() => {
    const storage = [localStorage, sessionStorage].flatMap((store) => Object.keys(store).map((key) => `${key}=${store.getItem(key) ?? ""}`)).join("\n");
    return { html: document.documentElement.outerHTML, storage, url: location.href };
  });
  for (const piece of [secret, secret.slice(0, 12), secret.slice(-8)]) {
    expect(dump.html.includes(piece), "页面的文字和属性里没有密钥").toBe(false);
    expect(dump.storage.includes(piece), "浏览器存储里没有密钥").toBe(false);
    expect(dump.url.includes(piece), "地址里没有密钥").toBe(false);
  }
}

test("超级管理员填写谷歌地图密钥 → 只显示末 4 位 → 测试一下可用 → 用键盘清空 → 回到未配置；亮暗主题 axe 通过，320 / 768 宽不横向滚动，原文不出现在页面、请求地址、存储和审计日志里", async ({ page, request }) => {
  const secret = `AIza${randomBytes(21).toString("base64url")}`;
  const last4 = secret.slice(-4);
  const requested: string[] = [];
  const bodies: string[] = [];
  page.on("request", (sent) => {
    requested.push(sent.url());
    if (sent.method() === "PUT") bodies.push(sent.postData() ?? "");
  });
  const consoleLines: string[] = [];
  page.on("console", (message) => consoleLines.push(message.text()));

  const { email, password } = adminCredentials();
  await loginAs(page, "platform", email, password);
  await page.goto("/platform/settings/integrations");
  const maps = page.getByRole("region", { name: "谷歌地图", exact: true });
  await expect(maps).toContainText("现在用的未配置");
  await expect(page.getByText("哪一份生效：运营后台填写的优先；后台没填（或清空后）才用服务器配置文件里的值。")).toBeVisible();
  await expect(maps.getByRole("button", { name: "测试一下" })).toHaveCount(0);
  // 路线预估的用量（M2-02）：真实后端给的今天的次数和每日上限；下面的 axe、320 / 768 宽检查同样覆盖这张卡片
  await expect(page.getByRole("region", { name: "路线预估（谷歌地图）" })).toContainText(/今天的调用（\d{4}-\d\d-\d\d）\d+ \/ \d+ 次（含重试）每日上限/);

  // 填写
  await maps.getByRole("button", { name: "填写" }).click();
  const dialog = page.getByRole("dialog", { name: "填写「谷歌地图」的密钥" });
  const input = dialog.getByLabel("API 密钥");
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("type", "password");
  await input.fill(secret);
  await expectNowhereOnPage(page, secret);
  await page.setViewportSize({ width: 320, height: 700 });
  await expectNoHorizontalOverflow(page, "320px 宽的填写对话框");
  await page.setViewportSize({ width: 1280, height: 800 });
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("已填写「谷歌地图」的密钥")).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(maps).toContainText(`现在用的后台设置（••••${last4}）`);
  await expect(maps).toContainText("服务器配置文件里没有");
  expect(bodies.some((body) => body.includes(secret)), "密钥只在保存的请求体里发出去").toBe(true);

  // 测试一下：打到本机的假谷歌地图
  await maps.getByRole("button", { name: "测试一下" }).click();
  await expect(maps.getByRole("status")).toContainText(/可用测的是后台设置里的那一份。测试时间 \d{4}-\d\d-\d\d \d\d:\d\d:\d\d/);
  await expect(page.getByRole("region", { name: "系统状态" }).getByRole("row").filter({ hasText: "谷歌地图" })).toContainText("已配置");

  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAxeClean(page, `${scheme === "light" ? "亮色" : "暗色"}主题`);
    await snapshot(page, `m4-09-integration-secrets-${scheme}`);
  }
  await page.emulateMedia({ colorScheme: "light" });
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 800 });
    await expectNoHorizontalOverflow(page, `${width}px 宽的系统状态页`);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await expectNowhereOnPage(page, secret);

  // 用键盘清空：确认对话框默认焦点在「取消」，Tab 到「清空」再回车
  await maps.getByRole("button", { name: "清空" }).focus();
  await page.keyboard.press("Enter");
  const confirm = page.getByRole("dialog", { name: "清空「谷歌地图」在后台填写的密钥？" });
  await expect(confirm).toContainText("清空后改用服务器配置文件里的值（如果有）。");
  await expect(confirm.getByRole("button", { name: "取消" })).toBeFocused();
  await expectAxeClean(page, "清空的确认对话框");
  await page.keyboard.press("Tab");
  await expect(confirm.getByRole("button", { name: "清空" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("已清空「谷歌地图」在后台填写的密钥")).toBeVisible();
  await expect(maps).toContainText("现在用的未配置");
  await expect(maps.getByRole("button", { name: "清空" })).toHaveCount(0);
  await expect(maps.getByRole("button", { name: "填写" })).toBeFocused();

  // 原文：页面、所有请求地址、控制台、审计日志里都没有
  await expectNowhereOnPage(page, secret);
  expect(requested.filter((url) => url.includes(secret) || url.includes(secret.slice(-8))), "请求地址里没有密钥").toEqual([]);
  expect(consoleLines.filter((line) => line.includes(secret.slice(-8))), "控制台里没有密钥").toEqual([]);
  const audit = await request.get("/platform/v1/audit-logs?resource=integration_secret&resource_id=google_maps&limit=50", { headers: await platformAdminHeaders(request) });
  expect(audit.ok()).toBe(true);
  const auditText = await audit.text();
  for (const action of ["set", "test", "clear"]) expect(auditText).toContain(`"action":"${action}"`);
  expect(auditText.includes(secret) || auditText.includes(secret.slice(0, 12)), "审计日志里只有末 4 位").toBe(false);
});
