/**
 * 邮箱验证码登录（M4-06，ADR 0050），真实浏览器 → 构建好的前端 → 真实 API → 真实 PostgreSQL + 本机假 SMTP（从不连真实的邮件服务）。
 * 这组有自己的 schema、API 和前端（global-setup）：别的用例填写、清空 SMTP 影响不到这里。用例按顺序跑：先是没配置邮件（就是现在测试环境的样子），再配上。
 * 假 SMTP 的账号密码是本次运行随机生成的假值。
 */
import { randomBytes } from "node:crypto";
import { AxeBuilder } from "@axe-core/playwright";
import { type APIRequestContext, type Page, expect, test } from "@playwright/test";
import { decodedMailText } from "../../api/src/testing/fake-integrations.ts";
import { E2E_WEB_MAIL_PORT } from "../playwright.config.ts";
import { apiSecondFactor, uiSecondFactor } from "./mfa.ts";
import { expectNoHorizontalOverflow, fillLogin, newPassword, settleAnimations, snapshot, uniqueEmail } from "./support.ts";

test.use({ baseURL: `http://127.0.0.1:${E2E_WEB_MAIL_PORT}` });
test.describe.configure({ mode: "serial" });

const admin = (): { email: string; password: string } => JSON.parse(process.env["E2E_MAIL_ADMIN"] as string) as { email: string; password: string };
const SWITCH = "改用邮箱验证码";

async function adminToken(request: APIRequestContext): Promise<string> {
  const { email, password } = admin();
  const response = await request.post("/platform/v1/auth/login", { data: { email, password } });
  expect(response.ok(), `登录失败：HTTP ${response.status()}`).toBe(true);
  const body = (await response.json()) as { access_token: string; second_factor: { status: string } };
  return apiSecondFactor(request, email, body.access_token, body.second_factor.status);
}

async function latestCode(email: string, after: number): Promise<string> {
  let code: string | undefined;
  await expect
    .poll(async () => {
      const stats = (await (await fetch(process.env["E2E_FAKE_SMTP_STATS_URL"] as string)).json()) as { messages: { to: string[]; data: string }[] };
      const mine = stats.messages.filter((message) => message.to.includes(email));
      if (mine.length <= after) return false;
      code = /^(\d{6})$/m.exec(decodedMailText((mine.at(-1) as { data: string }).data))?.[1];
      return code !== undefined;
    }, { message: `${email} 没有收到验证码`, timeout: 20_000 })
    .toBe(true);
  return code as string;
}

async function mailCount(email: string): Promise<number> {
  const stats = (await (await fetch(process.env["E2E_FAKE_SMTP_STATS_URL"] as string)).json()) as { messages: { to: string[] }[] };
  return stats.messages.filter((message) => message.to.includes(email)).length;
}

async function expectAxeClean(page: Page, what: string): Promise<void> {
  await settleAnimations(page);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  expect(results.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`), what).toEqual([]);
}

test("邮件没配置（现在测试环境的样子）：登录页只有密码，发码接口 503，平台员工用密码 + 两步验证能登录", async ({ page, request }) => {
  const methods = await request.get("/platform/v1/auth/login-methods");
  expect(await methods.json()).toEqual({ email_code: false, password: true });
  expect((await request.post("/platform/v1/auth/email-code/request", { data: { email: admin().email } })).status()).toBe(503);

  await page.goto("/platform/login");
  const answered = page.waitForResponse((response) => response.url().endsWith("/auth/login-methods"));
  await page.reload();
  await answered;
  await expect(page.getByRole("button", { name: SWITCH })).toHaveCount(0);
  await expect(page.getByText("验证码")).toHaveCount(0);
  await fillLogin(page, admin().email, admin().password);
  await expect(page.getByRole("heading", { level: 1, name: "首页" })).toBeVisible();
});

test("配上邮件：运营后台验证码登录走完——发码、错码被拒、输入正确的码，接着仍要两步验证，完成后进首页；亮暗 axe，360 宽不横向滚动", async ({ page, request }) => {
  const smtpPassword = `smtp-${randomBytes(18).toString("base64url")}`;
  const saved = await request.put("/platform/v1/integration-secrets/email", {
    headers: { authorization: `Bearer ${await adminToken(request)}` },
    data: { host: process.env["E2E_FAKE_SMTP_HOST"], port: Number(process.env["E2E_FAKE_SMTP_PORT"]), encryption: "starttls", username: "mailer@example.com", password: smtpPassword, from_name: "NOZOMI", from_address: "noreply@example.com" },
  });
  expect(saved.ok(), await saved.text()).toBe(true);
  const { email } = admin();

  await page.goto("/platform/login");
  await expect(page.getByLabel("密码", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: SWITCH }).click();
  await expect(page.getByLabel("密码", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("邮箱")).toBeFocused();
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAxeClean(page, `填邮箱这一步（${scheme}）`);
  }
  await page.emulateMedia({ colorScheme: "light" });

  const before = await mailCount(email);
  await page.getByLabel("邮箱").fill(email);
  await page.getByRole("button", { name: "发送验证码" }).click();
  await expect(page.getByLabel("验证码")).toBeFocused();
  await expect(page.getByRole("status")).toContainText("如果这个邮箱有账号");
  await expect(page.getByRole("button", { name: /^重新发送（\d+ 秒）$/ })).toBeDisabled();
  for (const scheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expectAxeClean(page, `输验证码这一步（${scheme}）`);
    await snapshot(page, `m4-06-email-code-${scheme}`);
  }
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 360, height: 640 });
  await expectNoHorizontalOverflow(page, "360px 宽的输验证码这一步");
  await page.setViewportSize({ width: 1280, height: 720 });

  const code = await latestCode(email, before);
  const wrong = code === "000000" ? "000001" : "000000";
  await page.getByLabel("验证码").fill(wrong);
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("alert")).toContainText("验证码不正确或已失效");
  await expect(page.getByLabel("验证码")).toHaveValue("");

  await page.getByLabel("验证码").fill(code);
  await page.getByRole("button", { name: "登录" }).click();
  await uiSecondFactor(page, email, "verify_required");
  await expect(page.getByRole("heading", { level: 1, name: "首页" })).toBeVisible();

  const state = await page.evaluate(() => JSON.stringify({ ...sessionStorage }));
  expect(state.includes(code), "验证码没有留在浏览器存储里").toBe(false);
});

test("没有账号的邮箱：页面和真实账号完全一样，不收信；验证码一律被拒", async ({ page }) => {
  const nobody = uniqueEmail("nobody");
  await page.goto("/platform/login");
  await page.getByRole("button", { name: SWITCH }).click();
  await page.getByLabel("邮箱").fill(nobody);
  await page.getByRole("button", { name: "发送验证码" }).click();
  await expect(page.getByLabel("验证码")).toBeVisible();
  await expect(page.getByRole("status")).toContainText("如果这个邮箱有账号");
  await page.getByLabel("验证码").fill("123456");
  await page.getByRole("button", { name: "登录" }).click();
  await expect(page.getByRole("alert")).toContainText("验证码不正确或已失效");
  expect(await mailCount(nobody)).toBe(0);
});

test("邮件可用时密码仍然可用：点「改用密码」回去，密码 + 两步验证能登录", async ({ page }) => {
  await page.goto("/platform/login");
  await page.getByRole("button", { name: SWITCH }).click();
  await page.getByRole("button", { name: "改用密码" }).click();
  await fillLogin(page, admin().email, admin().password);
  await expect(page.getByRole("heading", { level: 1, name: "首页" })).toBeVisible();
});

test("供应商后台：验证码通过直接进后台（供应商没有两步验证）；令牌只给自己的租户", async ({ page, request }) => {
  const token = await adminToken(request);
  const adminEmail = uniqueEmail("code-tenant");
  const created = await request.post("/platform/v1/tenants", { headers: { authorization: `Bearer ${token}` }, data: { name: `验证码供应商 ${randomBytes(3).toString("hex")}`, admin: { email: adminEmail, name: "验证码管理员" } } });
  expect(created.ok(), await created.text()).toBe(true);
  const body = (await created.json()) as { tenant: { id: string }; invite: { token: string } };
  expect((await request.post("/tenant/v1/auth/accept-invite", { data: { token: body.invite.token, password: newPassword() } })).ok()).toBe(true);

  await page.goto("/login");
  await page.getByRole("button", { name: SWITCH }).click();
  await page.getByLabel("邮箱").fill(adminEmail);
  await page.getByRole("button", { name: "发送验证码" }).click();
  await expect(page.getByLabel("验证码")).toBeVisible();
  await page.getByLabel("验证码").fill(await latestCode(adminEmail, 0));
  const answered = page.waitForResponse((response) => response.url().endsWith("/tenant/v1/auth/email-code/verify"));
  await page.getByRole("button", { name: "登录" }).click();
  const login = (await (await answered).json()) as { tenant: { id: string } };
  expect(login.tenant.id).toBe(body.tenant.id);
  await expect(page.getByRole("heading", { level: 1, name: "首页" })).toBeVisible();
});
