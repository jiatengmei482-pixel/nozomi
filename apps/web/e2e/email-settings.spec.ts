/**
 * 运营后台填写邮件发送（M4-14，ADR 0048），真实后端 + 真实 PostgreSQL + global-setup 起的本机假 SMTP 服务器（从不连真实的邮件服务）：
 * 超级管理员在「系统设置 → 系统状态」填写七项（内网主机被后端拒绝、错误落到字段）→ 只显示打码 → 测试一下（假 SMTP 收到发给本人的信，走 STARTTLS）→
 * 更换时密码是空的 → 用键盘清空 → 回到未配置。亮暗两套主题过 axe；320 / 768 宽不横向滚动；页面、请求地址、存储、控制台、审计日志里都没有密码原文。
 * 密码是本次运行随机生成的假值；用例结束时已经清空。
 */
import { randomBytes } from "node:crypto";
import { AxeBuilder } from "@axe-core/playwright";
import { type Locator, type Page, expect, test } from "@playwright/test";
import { adminCredentials, expectNoHorizontalOverflow, loginAs, platformAdminHeaders, settleAnimations, snapshot } from "./support.ts";

async function expectAxeClean(page: Page, what: string): Promise<void> {
  await settleAnimations(page);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`), what).toEqual([]);
}

async function expectNowhereOnPage(page: Page, secret: string): Promise<void> {
  const dump = await page.evaluate(() => {
    const storage = [localStorage, sessionStorage].flatMap((store) => Object.keys(store).map((key) => `${key}=${store.getItem(key) ?? ""}`)).join("\n");
    return { html: document.documentElement.outerHTML, storage, url: location.href };
  });
  for (const piece of [secret, secret.slice(0, 12), secret.slice(-8)]) {
    expect(dump.html.includes(piece), "页面的文字和属性里没有密码").toBe(false);
    expect(dump.storage.includes(piece), "浏览器存储里没有密码").toBe(false);
    expect(dump.url.includes(piece), "地址里没有密码").toBe(false);
  }
}

interface SmtpStats {
  auths: { method: string; user: string; pass: string }[];
  messages: { from: string; to: string[]; data: string; secure: boolean }[];
}

async function smtpStats(): Promise<SmtpStats> {
  const response = await fetch(process.env["E2E_FAKE_SMTP_STATS_URL"] as string);
  return (await response.json()) as SmtpStats;
}

const PORT_LABEL = "端口（25、465、587、2525）";

async function fillForm(dialog: Locator, values: { host: string; port: string; password: string }): Promise<void> {
  await dialog.getByLabel("SMTP 主机").fill(values.host);
  await dialog.getByLabel(PORT_LABEL).fill(values.port);
  await dialog.getByLabel("加密方式").selectOption("starttls");
  await dialog.getByLabel("用户名", { exact: true }).fill("mailer@example.com");
  await dialog.getByLabel("密码", { exact: true }).fill(values.password);
  await dialog.getByLabel("发件人名称").fill("NOZOMI 端到端测试");
  await dialog.getByLabel("发件人地址").fill("noreply@example.com");
}

test("超级管理员填写邮件发送 → 只显示打码 → 测试一下发出邮件（假 SMTP 收到）→ 更换时密码要重填 → 用键盘清空；亮暗 axe，320 / 768 宽不横向滚动，密码原文不出现", async ({ page, request }) => {
  const password = `smtp-${randomBytes(21).toString("base64url")}`;
  const last4 = password.slice(-4);
  const host = process.env["E2E_FAKE_SMTP_HOST"] as string;
  const port = process.env["E2E_FAKE_SMTP_PORT"] as string;
  const requested: string[] = [];
  page.on("request", (sent) => requested.push(sent.url()));
  const consoleLines: string[] = [];
  page.on("console", (message) => consoleLines.push(message.text()));

  const { email, password: adminPassword } = adminCredentials();
  await loginAs(page, "platform", email, adminPassword);
  await page.goto("/platform/settings/integrations");
  const card = page.getByRole("region", { name: "邮件发送", exact: true });
  await expect(card).toContainText("现在用的未配置");
  await expect(card.getByRole("button", { name: "测试一下" })).toHaveCount(0);

  // 填写：先填内网主机，后端拒绝，错误落到主机下面，焦点也在那里
  await card.getByRole("button", { name: "填写" }).click();
  const dialog = page.getByRole("dialog", { name: "填写「邮件发送」的设置" });
  await expect(dialog.getByLabel("SMTP 主机")).toBeFocused();
  await expect(dialog).toContainText("每次保存都要重新填密码");
  await expect(dialog.getByLabel("密码", { exact: true })).toHaveAttribute("type", "password");
  await expect(dialog.getByLabel("加密方式").locator("option")).toHaveText(["TLS（推荐，常用端口 465）", "STARTTLS（常用端口 587）"]);
  await fillForm(dialog, { host: "10.0.0.5", port: "587", password });
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(dialog.getByText("不能填内网地址：请填写邮件服务商给的公网主机名")).toBeVisible();
  await expect(dialog.getByLabel("SMTP 主机")).toBeFocused();
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAxeClean(page, `带出错的填写对话框（${scheme}）`);
    await snapshot(page, `m4-14-email-dialog-${scheme}`);
  }
  await page.emulateMedia({ colorScheme: "light" });
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 700 });
    await expectNoHorizontalOverflow(page, `${width}px 宽的填写对话框`);
    await snapshot(page, `m4-14-email-dialog-${width}`);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await expectNowhereOnPage(page, password);

  // 改成本机假 SMTP：只有 ci / local 的回环地址能这样填
  await dialog.getByLabel("SMTP 主机").fill(host);
  await dialog.getByLabel(PORT_LABEL).fill(port);
  await dialog.getByRole("button", { name: "保存" }).click();
  await expect(page.getByText("已填写「邮件发送」的设置")).toBeVisible();
  await expect(dialog).toHaveCount(0);
  await expect(card).toContainText(`现在用的后台设置（••••${last4}）`);
  await expect(card).toContainText(`邮件服务器${host}:${port}`);
  await expect(card).toContainText("加密方式STARTTLS");
  await expect(card).toContainText("发件人NOZOMI 端到端测试 <noreply@example.com>");
  await expect(page.getByRole("region", { name: "系统状态" }).getByRole("row").filter({ hasText: "邮件发送" })).toContainText("已配置");

  // 测试一下：假 SMTP 收到发给当前登录人的信，走加密连接，用的是刚填的账号密码
  await expect(card).toContainText("会发一封测试邮件到你自己的登录邮箱");
  // 通知中心（ADR 0049）的后台任务在配置生效后也会发信，这里只数发给当前登录人的
  const toMe = (stats: SmtpStats) => stats.messages.filter((sent) => sent.to.includes(email));
  const before = toMe(await smtpStats()).length;
  await card.getByRole("button", { name: "测试一下" }).click();
  await expect(card.getByRole("status")).toContainText(`邮件服务器已接收，测试邮件发到了 ${email}`);
  await expect(card.getByRole("status")).toContainText(/测的是后台设置里的那一份。测试时间 \d{4}-\d\d-\d\d \d\d:\d\d:\d\d/);
  const stats = await smtpStats();
  expect(toMe(stats).length).toBe(before + 1);
  const message = toMe(stats).at(-1);
  expect(message?.to).toEqual([email]);
  expect(message?.from).toBe("noreply@example.com");
  expect(message?.secure).toBe(true);
  expect(stats.auths.at(-1)?.user).toBe("mailer@example.com");
  expect(stats.auths.at(-1)?.pass === password, "假 SMTP 收到的是刚填的密码").toBe(true);

  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAxeClean(page, `填好后的系统状态页（${scheme}）`);
    await snapshot(page, `m4-14-email-card-${scheme}`);
  }
  await page.emulateMedia({ colorScheme: "light" });
  for (const width of [320, 768]) {
    await page.setViewportSize({ width, height: 800 });
    await expectNoHorizontalOverflow(page, `${width}px 宽的系统状态页`);
    await snapshot(page, `m4-14-email-card-${width}`);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await expectNowhereOnPage(page, password);

  // 更换：不是密钥的几项带着现在的值，密码是空的，不填不能保存
  await card.getByRole("button", { name: "更换" }).click();
  const replace = page.getByRole("dialog", { name: "更换「邮件发送」的设置" });
  await expect(replace.getByLabel("SMTP 主机")).toHaveValue(host);
  await expect(replace.getByLabel(PORT_LABEL)).toHaveValue(port);
  await expect(replace.getByLabel("密码", { exact: true })).toHaveValue("");
  await replace.getByRole("button", { name: "保存" }).click();
  await expect(replace.getByText("请重新填写密码（每次保存都要填）")).toBeVisible();
  await expect(replace.getByLabel("密码", { exact: true })).toBeFocused();
  await replace.getByRole("button", { name: "取消" }).click();

  // 用键盘清空：确认对话框默认焦点在「取消」，Tab 到「清空」再回车
  await card.getByRole("button", { name: "清空" }).focus();
  await page.keyboard.press("Enter");
  const confirm = page.getByRole("dialog", { name: "清空「邮件发送」在后台填写的设置？" });
  await expect(confirm).toContainText("清空后邮件发送就是「未配置」");
  await expect(confirm.getByRole("button", { name: "取消" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(confirm.getByRole("button", { name: "清空" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText("已清空「邮件发送」在后台填写的设置")).toBeVisible();
  await expect(card).toContainText("现在用的未配置");
  await expect(card).not.toContainText("邮件服务器");
  await expect(card.getByRole("button", { name: "填写" })).toBeFocused();

  // 原文：页面、所有请求地址、控制台、审计日志里都没有
  await expectNowhereOnPage(page, password);
  expect(requested.filter((url) => url.includes(password) || url.includes(password.slice(-8))), "请求地址里没有密码").toEqual([]);
  expect(consoleLines.filter((line) => line.includes(password.slice(-8))), "控制台里没有密码").toEqual([]);
  const audit = await request.get("/platform/v1/audit-logs?resource=integration_secret&resource_id=email&limit=50", { headers: await platformAdminHeaders(request) });
  expect(audit.ok()).toBe(true);
  const auditText = await audit.text();
  for (const action of ["set", "test", "clear"]) expect(auditText).toContain(`"action":"${action}"`);
  expect(auditText.includes(password) || auditText.includes(password.slice(0, 12)), "审计日志里只有末 4 位").toBe(false);
});
